//230 inert local acceptance. Existing174/204 historical facts stay untouched.
//The native probe rolls back; the separately named browser preparation commits
//only real RPCs in the parent's owned temporary schema, which the parent cleans.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {assertLifecycleSandbox,lifecycleId as id,lifecycleJson as json} from '../merchant-attendance-lifecycle-native-support.mjs';
import {quote} from './attendance-bound-clocks-native.mjs';
import {outageNativeFingerprintSql} from './attendance-outage-native.mjs';

const require=createRequire(import.meta.url),slotId=id(174701),periodId=id(204900001);
//Whole-row JSON compares timestamptz text, so snapshot and comparisons must
//share serialization settings even when the parent connection defaults differ.
const rowSerializationPrefix="reset role;set local time zone 'UTC';set local datestyle='ISO, YMD';";
const periodTables=['merchant_attendance_period_closures','merchant_attendance_period_artifacts','merchant_attendance_period_versions','merchant_attendance_period_entries'];
const leaveTables=['merchant_attendance_leave_requests','merchant_attendance_leave_entries'];
const adoptionTables=['merchant_attendance_plan_posthoc_operations','merchant_attendance_plan_posthoc_claims'];
const reviewTables=['merchant_attendance_plan_exception_cases','merchant_attendance_plan_exception_entries','merchant_attendance_event_notifications'];
export const posthocPartialLeaveWriteTables=Object.freeze([...leaveTables,...adoptionTables,...reviewTables,...periodTables]);
const map=(value,fn)=>value&&typeof value.then==='function'?value.then(fn):fn(value);
const sha=text=>createHash('sha256').update(text,'utf8').digest('hex');
export function partialLeaveArchiveBytes(value){
  assert.equal(typeof value.artifactText,'string');assert.equal(value.artifactBytes,Buffer.byteLength(value.artifactText,'utf8'));
  assert.equal(value.artifactSha256,sha(value.artifactText));assert.deepEqual(JSON.parse(value.artifactText),value.artifact);
  return {artifactText:value.artifactText,artifactBytes:value.artifactBytes,artifactSha256:value.artifactSha256};
}
export function partialLeaveIntervals(current){
  assert.equal(current.protocol,'plan-exception-source-v3');assert.equal(current.eligible,true);assert.deepEqual(current.blockers,[]);
  assert.equal(current.candidate.late.state,'triggered');assert.equal(current.candidate.early.state,'not_triggered');
  assert.equal(current.candidate.early.minutes,10);assert.equal(current.candidate.early.rawDeltaUs,'300000000');
  const {slot,candidate}=current,normalize=value=>{
    assert.match(value,/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\.000(?:000)?Z$/,'partial_leave_saved_minute_endpoint');
    return new Date(value).toISOString();
  };
  const start=normalize(slot.startAt),end=normalize(slot.endAt),workStart=normalize(candidate.selected.startAt),workEnd=normalize(candidate.selected.endAt);
  assert(start<workStart&&workStart<workEnd&&workEnd<end);assert.equal(slot.timeZone,'UTC');
  return [{timeZone:'UTC',startAt:start,endAt:workStart},{timeZone:'UTC',startAt:workEnd,endAt:end}];
}

function context(ctx){
  const {d,h,native,scope,archive,oldArchive}=ctx;
  assert(d?.syntheticOnly===true&&h?.syntheticOnly===true,'partial_leave_synthetic_context_required');
  assert.equal(h.slot.id,slotId,'partial_leave_requires207_original_day2_context');assert.equal(h.slot.timeZone,'UTC');
  assert.equal(typeof archive,'function');assert.equal(typeof d.guard,'string');assert.equal(typeof native.connect,'function');
  const owned=assertLifecycleSandbox(sql=>native.query(scope.sql(sql)));assert.deepEqual(owned,d.owned);assert.equal(owned.schema,scope.schema);
  const names=d.inventory();for(const table of posthocPartialLeaveWriteTables)assert(names.includes(table),table);
  const baseline=d.fingerprint(),definitions=d.definitions(),catalog=d.tableCatalog(),old155=partialLeaveArchiveBytes(archive());
  assert.deepEqual(old155,partialLeaveArchiveBytes(oldArchive));
  const rows=JSON.parse(d.exec(rowSerializationPrefix+d.guard+'select jsonb_build_object('+posthocPartialLeaveWriteTables.map(table=>{
    const where=table==='merchant_attendance_period_closures'?`where not(r.merchant_id=${quote(d.site)} and r.period_id=${quote(periodId)})`:'';
    return `${quote(table)},(select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) from public.${table} r ${where})`;
  }).join(',')+');'));
  assert(Buffer.byteLength(JSON.stringify(rows),'utf8')<=4194304,'partial_leave_bounded_original_rows');
  assert.equal(scope.sql(json(rows)),json(rows),'partial_leave_row_snapshot_schema_rewrite');
  assert(!rows.merchant_attendance_plan_posthoc_claims.some(row=>row.merchant_id===d.site&&row.slot_id===slotId),'partial_leave_revoke_must_have_no_existing_target_claim');
  assert.equal(d.fingerprint(),baseline);
  return {d,h,native,scope,owned,names,rows,baseline,definitions,catalog,old155,archive};
}
function operations(state,execute,base){
  const {d,h,names,rows}=state,site=quote(d.site),owner=quote(d.owner),auth=quote(h.employeeAuthUserId),worker=quote(h.workerId);
  const fullHash=outageNativeFingerprintSql(names),protectedHash=allowed=>outageNativeFingerprintSql(names.filter(n=>!allowed.includes(n)));
  const oldRowsGuard=allowed=>allowed.map(table=>{assert(posthocPartialLeaveWriteTables.includes(table));return `assert not exists(
    select before_rows.value from jsonb_array_elements(${json(rows[table])}) before_rows(value)
    except select to_jsonb(original_row) from public.${table} original_row),'partial_leave_old_row_changed:${table}';`;}).join('\n');
  const {parseLeaveResult}=require('../../src/lib/merchantAttendanceLeave.ts');
  const {projectPlanPosthocResult}=require('../../src/lib/merchantAttendancePlanPosthoc.server.ts');
  const {parsePlanExceptionResult}=require('../../src/lib/merchantAttendancePlanExceptions.ts');
  const {projectPeriodClosureSource}=require('../../src/lib/merchantAttendancePeriodClosure.server.ts');
  const {parsePeriodClosureQuery,parsePeriodClosureCommand,parsePeriodClosureResult}=require('../../src/lib/merchantAttendancePeriodClosure.ts');
  let serial=0,reads=0,submissions=0,rejections=0,projections=0;
  const next=()=>{assert(++serial<1000);return id(base+serial);},reason='Synthetic230 explicit approved-leave edge acceptance, not payroll';
  const actor=access=>access==='owner'?d.owner:h.employeeAuthUserId;
  const call=(label,{q,c=null,who=d.owner,expression,allowed=[],error=null,parse=value=>value})=>{
    assert.equal(q.siteId,d.site);assert([d.owner,h.employeeAuthUserId].includes(who));
    if(q.workerId)assert.equal(q.workerId,h.workerId);if(q.slotId)assert.equal(q.slotId,slotId);
    const hash=c&&!error?protectedHash(allowed):fullHash;
    return map(execute(label,`do $partial_call$ declare before_hash text;after_hash text;probe_value jsonb;failure text;begin
      before_hash:=${hash};begin set local role service_role;assert current_user='service_role','partial_actual_service_role_required';probe_value:=${expression};set constraints all immediate;set constraints all deferred;
      exception when others then if ${error===null?'true':'sqlerrm<>'+quote(error)} then raise;end if;failure:=sqlerrm;end;
      reset role;after_hash:=${hash};assert before_hash=after_hash,'partial_leave_read_rejection_or_protected_fact_changed';
      ${c&&!error?oldRowsGuard(allowed):''}
      assert failure is not distinct from ${error===null?'null::text':quote(error)},'partial_leave_expected_rejection_missing';
      perform set_config('faolla.partial230_result',jsonb_build_object('value',probe_value,'error',failure,'before',before_hash,'after',after_hash)::text,true);
    end;$partial_call$;select current_setting('faolla.partial230_result')::jsonb;`),output=>{
      const value=JSON.parse(output);assert.equal(value.before,value.after);assert.equal(value.error,error);
      if(error){rejections++;return null;}if(c)submissions++;else reads++;return parse(value.value,q,c,who);
    });
  };
  const rq=(mode='detail',access='owner',operationId=null)=>({siteId:d.site,access,mode,workerId:h.workerId,slotId,operationId,beforeAt:null,beforeId:null});
  const raw=(q=rq(),c=null,{allow=true,posthoc=true,clearance=true,capture=true}={})=>call('review_'+q.mode,{q,c,who:actor(q.access),allowed:reviewTables,
    expression:`public.faolla_attendance_plan_exception_posthoc_review_v1(${json(q)},${quote(actor(q.access))},${json(c)},${allow},${posthoc},${clearance},${capture})`});
  const review=(q=rq(),c=null,options={})=>map(raw(q,c,options),value=>parsePlanExceptionResult(value,q,{authUserId:actor(q.access)},c));
  const make=(value,outcome='cleared')=>({operationId:next(),expectedRevision:value.detail.revision,expectedFingerprint:value.detail.current.fingerprint,
    employeeId:h.employeeId,employeeAuthUserId:h.employeeAuthUserId,outcome,note:reason});
  const aq={siteId:d.site,workerId:h.workerId,slotId,mode:'detail',operationId:null};
  const adopt=(c=null)=>call('adoption',{q:aq,c,allowed:adoptionTables,parse:(v,q,c)=>projectPlanPosthocResult(v,q,d.owner,c),
    expression:`public.faolla_attendance_plan_posthoc_adoption_v1(${json(aq)},${owner},${json(c)},true)`});
  const lq=(access='self',requestId=null)=>({siteId:d.site,access,requestId,operationId:null,beforeAt:null,beforeId:null});
  const leave=(q,c=null)=>call('leave_'+(c?.action??'detail'),{q,c,who:actor(q.access),allowed:leaveTables,parse:(v,q,c,who)=>parseLeaveResult(v,q,c,who),
    expression:`public.faolla_attendance_leave_v1(${json(q)},${quote(actor(q.access))},${json(c)},true)`});
  const pq=(mode='detail',access='owner',patch={})=>({siteId:d.site,access,workerId:h.workerId,fromDate:h.slot.workDate,throughDate:h.slot.workDate,mode,periodId,operationId:null,version:null,...patch});
  const periodRaw=(q=pq(),c=null,artifact=null)=>call('period_'+(c?.action??q.mode),{q,c,who:actor(q.access),allowed:periodTables,
    expression:`public.faolla_attendance_period_closure_v1(${json(q)},${quote(actor(q.access))},${json(c)},${json(artifact)},true)`});
  const period=(q=pq(),c=null,artifact=null)=>{
    parsePeriodClosureQuery(q);if(c)parsePeriodClosureCommand(q,c);
    return map(periodRaw(q,c,artifact),value=>{if(value.artifact!==null)partialLeaveArchiveBytes(value);
      const clean={...value};delete clean.artifactText;delete clean.artifactSha256;delete clean.artifactBytes;
      return parsePeriodClosureResult(clean,q,{authUserId:actor(q.access)},c);});
  };
  const source=()=>{
    const q=pq('preview'),sourceQuery=Object.fromEntries(['siteId','access','workerId','fromDate','throughDate','periodId'].map(k=>[k,q[k]]));
    return map(call('period_source',{q,expression:`public.faolla_attendance_period_closure_source_v1(${json(sourceQuery)},${owner})`}),value=>{
      projections++;assert.equal(value.employeeId,h.employeeId);assert.equal(value.employeeAuthUserId,h.employeeAuthUserId);return projectPeriodClosureSource(value,q);
    });
  };
  const pc=(action,value,fingerprint=value.artifact.sourceFingerprint)=>({action,operationId:next(),periodId,expectedRevision:value.period.revision,
    expectedVersion:value.period.currentVersion,expectedFingerprint:fingerprint,reason});
  const guard=()=>execute('old_rows_guard',`do $partial_guard$ begin ${oldRowsGuard(posthocPartialLeaveWriteTables)}
    assert exists(select 1 from public.merchant_attendance_period_closures where merchant_id=${site} and period_id=${quote(periodId)} and worker_id=${worker}),'partial_period_identity';
    end;$partial_guard$;`);
  return {next,reason,actor,call,rq,raw,review,read:review,make,adopt,lq,leave,pq,periodRaw,period,source,pc,guard,
    summary:()=>({reads,submissions,rejections,sourceProjections:projections}),site,owner,auth};
}
async function prepare(state,op,selected){
  assert(Array.isArray(selected)&&selected.length===2,'partial_original204_selected_required');
  const priorPeriod=await op.period();assert.equal(priorPeriod.period.sealed,false);assert.equal(priorPeriod.period.state,'open');
  const baselineSource=await op.source(),baselineTotals=baselineSource.artifact.report.totals;
  const available=await op.adopt();assert(available.preview.eligible,JSON.stringify(available.preview.blockers));
  assert.equal(available.current.action,'revoke');
  for(const ref of selected){const candidate=available.preview.candidates.find(c=>JSON.stringify(c.reference)===JSON.stringify(ref));assert(candidate?.available,'partial_exact_current_source');}
  await op.adopt({action:'apply',operationId:op.next(),expectedRevision:available.revision,expectedFingerprint:available.preview.fingerprint,
    employeeId:state.h.employeeId,employeeAuthUserId:state.h.employeeAuthUserId,reason:op.reason,sources:selected});
  const before=await op.read(),intervals=partialLeaveIntervals(before.detail.current),requestIds=[];
  const settings=await op.leave(op.lq());assert.equal(settings.canSubmit,true);
  for(let i=0;i<intervals.length;i++){
    const requestId=op.next();requestIds.push(requestId);
    await op.leave(op.lq(),{action:'submit',operationId:requestId,reason:op.reason,expectedWorkerId:state.h.workerId,expectedSettingsVersion:settings.settingsVersion,...intervals[i]});
    const pending=await op.read();assert(pending.detail.current.blockers.includes('leave_pending'));
    await op.leave(op.lq('owner',requestId),{action:'approve',operationId:op.next(),requestId,expectedRevision:1,reason:op.reason});
    const current=await op.read();assert(current.detail.current.eligible);assert.equal(current.detail.current.candidate.late.state,'not_triggered');
    assert.equal(current.detail.current.candidate.late.rawDeltaUs,'0');
    assert.equal(current.detail.current.candidate.early.rawDeltaUs,i===0?'300000000':'0');
    assert.equal(current.detail.current.candidate.early.state,'not_triggered');
  }
  const prepared=await op.read();assert.equal(prepared.detail.current.state,'required');assert.equal(prepared.detail.current.leaveEdges.fullCoverage,false);
  assert.deepEqual(prepared.detail.current.leaveEdges.workLeaveOverlaps,[]);assert.equal(prepared.detail.current.leaveEdges.remainingRequired.length,1);
  assert.equal(prepared.detail.current.leaveEdges.requiredStartAt,prepared.detail.current.candidate.selected.startAt);
  assert.equal(prepared.detail.current.leaveEdges.requiredEndAt,prepared.detail.current.candidate.selected.endAt);
  assert.equal(prepared.detail.stale,true);assert.notEqual(prepared.detail.latestDecision.outcome,'cleared');
  const after=await op.source();assert.deepEqual(after.artifact.report.totals,baselineTotals);
  return {prepared,before,requestIds,intervals,baselineTotals,priorPeriod};
}
function completion(state,op,prepared){
  let sealed=null,sealedArchive=null,receipt=null,cancelled=false;
  const periodArchive=()=>{assert(sealed,'partial_period_not_sealed');return op.periodRaw(op.pq('export','owner',{version:sealed.period.currentVersion}));};
  const seal=async()=>{
    assert.equal(sealed,null,'partial_seal_once');const current=await op.read();assert.equal(current.detail.latestDecision.outcome,'cleared');
    assert.equal(current.detail.revision,prepared.prepared.detail.revision+1);assert.equal(current.detail.stale,false);
    assert.equal(current.detail.latestDecision.evidence.fingerprint,prepared.prepared.detail.current.fingerprint);
    receipt=(await op.read(op.rq('recover','owner',current.detail.latestDecision.operationId))).receipt;assert(receipt);
    const self=await op.read(op.rq('detail','self'));assert.equal(self.detail.current,null);assert.equal(self.detail.currentValidation,'not_checked');
    assert.deepEqual(self.detail.latestDecision.evidence,receipt.item.evidence);
    const source=await op.source();assert.deepEqual(source.blockers,[]);assert.deepEqual(source.artifact.report.totals,prepared.baselineTotals);
    let period=await op.period();period=await op.period(op.pq(),op.pc('send',period,source.artifact.sourceFingerprint),source.artifact);
    period=await op.period(op.pq('detail','self'),op.pc('confirm',period));sealed=await op.period(op.pq(),op.pc('seal',period));assert(sealed.period.sealed);
    assert.equal((await op.period()).sourceChanged,false);sealedArchive=partialLeaveArchiveBytes(await periodArchive());
    assert.equal((await op.read()).detail.stale,false);return sealed;
  };
  const cancel=async()=>{
    assert(sealed&&!cancelled,'partial_cancel_after_seal_once');cancelled=true;
    await op.leave(op.lq('owner',prepared.requestIds[0]),{action:'cancel',operationId:op.next(),requestId:prepared.requestIds[0],expectedRevision:2,reason:op.reason});
    const changed=await op.read();assert.equal(changed.detail.stale,true);assert.equal(changed.detail.current.candidate.late.state,'triggered');
    assert.equal(changed.detail.current.candidate.late.rawDeltaUs,prepared.before.detail.current.candidate.late.rawDeltaUs);
    const period=await op.period();assert(period.period.sealed);assert.equal(period.sourceChanged,true);
    assert.deepEqual(partialLeaveArchiveBytes(await periodArchive()),sealedArchive);
    const self=await op.read(op.rq('detail','self'));assert.equal(self.detail.latestDecision.outcome,'cleared');assert.equal(self.detail.current,null);
    assert.deepEqual((await op.read(op.rq('recover','owner',receipt.operationId))).receipt,receipt);
    assert.deepEqual((await op.source()).artifact.report.totals,prepared.baselineTotals);
    const command=op.make(changed,'follow_up'),q=op.rq('decide','owner',command.operationId);
    await op.call('sealed_fresh_review_rejected',{q,c:command,error:'attendance_period_sealed',
      expression:`public.faolla_attendance_plan_exception_posthoc_review_v1(${json(q)},${op.owner},${json(command)},true,true,true,true)`});
    await op.guard();return {changed,period};
  };
  return {seal,cancel,periodArchive,status:()=>({sealed:!!sealed,cancelled,savedOperationId:receipt?.operationId??null})};
}

export async function verifyPosthocPartialLeaveNative(ctx){
  const state=context(ctx),{d,native,scope}=state,prefix=rowSerializationPrefix+d.guard;
  let steps=0,stage='connect',rolledBack=false,result;const failures=[],connection=native.connect();
  const step=(label,sql)=>{stage=label;assert(++steps<=100,'partial_leave_bounded100_steps');return connection.step(scope.sql((label==='begin'?'begin;':'')+prefix+sql));};
  try{
    await step('begin',"set local lock_timeout='3s';set local statement_timeout='10s';");
    const op=operations(state,step,230100000),prepared=await prepare(state,op,ctx.selected),command=op.make(prepared.prepared);
    await op.review(op.rq('decide','owner',command.operationId),command);
    const finish=completion(state,op,prepared);await finish.seal();await finish.cancel();
    await step('rollback','rollback;');rolledBack=true;
    result={phase:230,...op.summary(),transactionSteps:steps,rollbackRestored:true,actualLeaveApprovals:2,actualCleared:true,actualSelfSaved:true,
      actualPeriodReseal:true,cancelMakesCurrentStale:true,sealedFreshWriteRejected:true,oldArchivePreserved:true,originalFactsUnchanged:true,
      lateTriggeredToNotTriggered:true,earlyWasWithinGrace:true,earlyRawDeltaUsBefore:'300000000',earlyRawDeltaUsAfter:'0',syntheticOnly:true,browser:false};
  }catch(error){failures.push(new Error('partial_leave_native:'+stage+':'+String(error?.message??error),{cause:error}));}
  finally{
    try{await connection.close();}catch(error){failures.push(error);}
    for(const [label,read,want]of [['facts',()=>d.fingerprint(),state.baseline],['definitions',()=>d.definitions(),state.definitions],['catalog',()=>d.tableCatalog(),state.catalog]]){
      try{assert.equal(read(),want,'partial_rollback_'+label);}catch(error){failures.push(error);}
    }
    try{assert.deepEqual(partialLeaveArchiveBytes(state.archive()),state.old155);}catch(error){failures.push(error);}
  }
  if(failures.length){
    //The parent wraps String(error.stack), which does not expand AggregateError
    //.errors or cause. Keep the originals while surfacing bounded diagnostics.
    const detail=failures.slice(0,6).map((error,index)=>`[${index+1}] ${String(error?.message??error)}\n${String(error?.cause?.stack??error?.stack??'')}`.slice(0,3000)).join('\n').slice(0,12000);
    throw new AggregateError(failures,'partial_leave_native_failed:'+detail,{cause:failures[0]});
  }
  assert(rolledBack);
  native.pass('230 actual prefix/suffix leave, late cleared, self saved, period reseal, cancel stale and immutable archives; one rollback');return result;
}

export async function preparePosthocPartialLeaveBrowser(ctx){
  const state=context(ctx),{d,native}=state,prefix=rowSerializationPrefix+d.guard;
  //EXPLICIT persistent synthetic branch. Each d.exec transaction uses the real
  //writer. The parent207 sandbox owns final schema/public-baseline cleanup.
  const op=operations(state,(_label,sql)=>d.exec(prefix+sql),230200000),prepared=await prepare(state,op,ctx.selected),finish=completion(state,op,prepared);
  const assertPreserved=()=>{
    assert.equal(d.definitions(),state.definitions);assert.equal(d.tableCatalog(),state.catalog);op.guard();
    assert.deepEqual(partialLeaveArchiveBytes(state.archive()),state.old155);
  };
  assertPreserved();
  return {...ctx,...op,...finish,beforeLeave:prepared.before,prepared:prepared.prepared,all:()=>d.fingerprint(),periodId,
    read:op.read,review:op.review,rq:op.rq,assertPreserved,
    summary:()=>({phase:230,...op.summary(),...finish.status(),syntheticOnly:true,perCaseRollback:false,parentOwnsSchemaCleanup:true,
      lateTriggeredToNotTriggered:true,earlyWasWithinGrace:true,earlyRawDeltaUsBefore:'300000000',earlyRawDeltaUsAfter:'0'}),
    native};
}
