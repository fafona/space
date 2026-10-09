//228 inert, caller-owned mixed-source acceptance. Existing174/204 past punches
//and schedule are disclosed synthetic history; all new business facts below use
//their real RPCs. One existing bounded connection, one BEGIN, one ROLLBACK.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {assertLifecycleSandbox,lifecycleId as id,lifecycleJson as json} from '../merchant-attendance-lifecycle-native-support.mjs';
import {quote} from './attendance-bound-clocks-native.mjs';
import {outageNativeFingerprintSql,outageNativeTables} from './attendance-outage-native.mjs';

const require=createRequire(import.meta.url),startId=id(204710),endId=id(204711),missingId=id(204715),slotId=id(174701),mixedPeriodId=id(204900001);
const stamp=ms=>new Date(ms).toISOString().replace(/Z$/,'000Z');
const sha=text=>createHash('sha256').update(text,'utf8').digest('hex');
const periodTables=['merchant_attendance_period_closures','merchant_attendance_period_artifacts','merchant_attendance_period_versions','merchant_attendance_period_entries'];
const archiveBytes=value=>{
 assert.equal(typeof value.artifactText,'string');assert.equal(value.artifactBytes,Buffer.byteLength(value.artifactText,'utf8'));
 assert.equal(value.artifactSha256,sha(value.artifactText));assert.deepEqual(JSON.parse(value.artifactText),value.artifact);
 return {artifactText:value.artifactText,artifactSha256:value.artifactSha256,artifactBytes:value.artifactBytes};
};

export async function verifyAttendancePeriodMixedNative(ctx){
 const {d,h,native,scope,archive,oldArchive,periodArchive,periodId:sealedPeriodId,outagePeriodsFoundation}=ctx;
 assert(d?.syntheticOnly===true&&h?.syntheticOnly===true);assert.equal(outagePeriodsFoundation?.phase,215);
 assert.equal(outagePeriodsFoundation.rollbackRestored,true);assert.equal(typeof native.connect,'function');
 const owned=assertLifecycleSandbox(sql=>native.query(scope.sql(sql)));assert.deepEqual(owned,d.owned);assert.equal(owned.schema,scope.schema);
 const baseline=d.fingerprint(),definitions=d.definitions(),catalog=d.tableCatalog(),names=d.inventory();
 const old155=archiveBytes(archive()),old207=archiveBytes(periodArchive());assert.deepEqual(old155,archiveBytes(oldArchive));
 const fullHash=outageNativeFingerprintSql(names),protectedHash=allowed=>outageNativeFingerprintSql(names.filter(n=>!allowed.includes(n)));
 const site=quote(d.site),owner=quote(d.owner),worker=quote(h.workerId),employee=quote(h.employeeId),auth=quote(h.employeeAuthUserId);
 const oldRowTables=[...periodTables,'merchant_enterprise_roles','merchant_attendance_correction_entries','merchant_attendance_correction_rule_bindings',
  'merchant_attendance_correction_decisions','merchant_attendance_correction_effects','merchant_attendance_leave_requests','merchant_attendance_leave_entries',
  'merchant_attendance_work_arrangement_requests','merchant_attendance_work_arrangement_entries',...outageNativeTables,
  'merchant_attendance_outage_link_operations','merchant_attendance_outage_review_operations','merchant_attendance_plan_posthoc_operations',
  'merchant_attendance_plan_posthoc_claims','merchant_attendance_plan_exception_cases','merchant_attendance_plan_exception_entries','merchant_attendance_event_notifications'];
 for(const table of oldRowTables)assert(names.includes(table),table);
 const oldRowFilter=table=>table==='merchant_attendance_period_closures'?`where not(r.merchant_id=${site} and r.period_id=${quote(mixedPeriodId)})`
  :table==='merchant_enterprise_roles'?`where not(r.merchant_id=${site} and r.id=(select role_id from public.merchant_enterprise_employees where merchant_id=${site} and id=${employee}))`:'';
 const oldRowsSnapshot='jsonb_build_object('+oldRowTables.map(table=>`${quote(table)},(select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) from public.${table} r ${oldRowFilter(table)})`).join(',')+')';
 //Whole-row equality includes the original primary key AND every field. EXCEPT
 //is intentional: JSON containment would miss additions inside nested objects.
 //Only the exact204 mutable period head and disclosed owned role are omitted.
 const oldRowsGuard=tables=>tables.map(table=>{assert(oldRowTables.includes(table));return `assert not exists(
  select old.value from jsonb_array_elements(current_setting('faolla.mixed228_original_rows')::jsonb->${quote(table)}) old(value)
  except select to_jsonb(r) from public.${table} r),'mixed_original_rows_changed:${table}';`;}).join('\n');
 const fmt='YYYY-MM-DD"T"HH24:MI:SS.US"Z"';
 //ctx.h.slot belongs to207's DIFFERENT, sealed full-leave day. Never use it to
 //invent the204 source date or a second period overlapping the existing one.
 const profile=JSON.parse(d.exec(`select jsonb_build_object('workerVersion',w.version,'employeeVersion',e.version,'generation',coalesce(ep.generation,0),
  'now',to_char(clock_timestamp() at time zone 'UTC',${quote(fmt)}),
  'session',public.faolla_attendance_period_session_v1(${site},w.id,${quote(startId)},e.id,e.auth_user_id,clock_timestamp()),
  'slot',(select public.faolla_attendance_self_schedule_slot_v1(s)->'slot' from public.merchant_attendance_schedule_slots s where s.merchant_id=${site} and s.id=${quote(slotId)} and s.worker_id=w.id),
  'period',(select jsonb_build_object('periodId',p.period_id,'fromDate',p.from_date,'throughDate',p.through_date,'sealed',p.sealed,
   'startAt',to_char(p.start_at at time zone 'UTC',${quote(fmt)}),'endAt',to_char(p.end_at at time zone 'UTC',${quote(fmt)}))
   from public.merchant_attendance_period_closures p where p.merchant_id=${site} and p.period_id=${quote(mixedPeriodId)} and p.worker_id=w.id),
  'missing',(select jsonb_build_object('reference',jsonb_build_object('kind','missing','requestId',m.request_id,'rootRequestId',coalesce(m.root_request_id,m.request_id),'approvalOperationId',a.operation_id),
   'startAt',to_char(m.start_at at time zone 'UTC',${quote(fmt)}),'endAt',to_char(m.end_at at time zone 'UTC',${quote(fmt)}))
   from public.merchant_attendance_missing_current_v1 m join public.merchant_attendance_missing_entries a on a.merchant_id=m.merchant_id and a.request_id=m.request_id and a.action='approve' and a.revision=2
   where m.merchant_id=${site} and m.worker_id=w.id and m.employee_id=e.id and m.actor_auth_user_id=e.auth_user_id and coalesce(m.root_request_id,m.request_id)=${quote(missingId)}))
  from public.merchant_attendance_workers w join public.merchant_enterprise_employees e on e.merchant_id=w.merchant_id and e.id=w.employee_id
  left join public.merchant_attendance_account_epochs ep on ep.merchant_id=e.merchant_id and ep.employee_id=e.id
  where w.merchant_id=${site} and w.id=${worker} and e.id=${employee} and e.auth_user_id=${auth} and w.active and e.status='active' and not coalesce(ep.paused,false);`));
 assert(profile?.session&&profile.slot&&profile.period&&profile.missing,'mixed_exact204_sources_required');assert.equal(d.fingerprint(),baseline);
 const events=profile.session.item.events;
 assert.deepEqual(events.map(e=>[e.id,e.sequence,e.action]),[[startId,3,'clock_in'],[endId,4,'clock_out']]);
 assert.equal(profile.session.item.effect,null);assert.equal(profile.session.ruleBinding.employeeId,h.employeeId);
 assert.equal(profile.session.ruleBinding.employeeAuthUserId,h.employeeAuthUserId);assert.equal(profile.slot.id,slotId);assert.equal(profile.slot.timeZone,'UTC');
 assert.equal(profile.period.sealed,false);assert.notEqual(mixedPeriodId,sealedPeriodId);
 const day=events[0].occurredAt.slice(0,10),start=Date.parse(events[0].occurredAt),finish=Date.parse(events[1].occurredAt);
 assert.equal(profile.period.fromDate,day);assert.equal(profile.period.throughDate,day);assert.equal(profile.slot.workDate,day);
 assert.equal(finish-start,300000);assert.equal(profile.missing.startAt.slice(0,10),day);assert.equal(profile.missing.endAt.slice(0,10),day);
 assert.equal(Date.parse(profile.missing.startAt)-finish,300000);assert.equal(Date.parse(profile.missing.endAt)-Date.parse(profile.missing.startAt),300000);
 assert.equal(Date.parse(profile.slot.endAt)-Date.parse(profile.missing.endAt),300000);
 const proposal={startAt:stamp(start),endAt:stamp(finish+60000),breaks:[]};
 const partialLeave={timeZone:'UTC',startAt:new Date(start-300000).toISOString(),endAt:new Date(start).toISOString()};
 const arrangement={kind:'trip',timeZone:'UTC',startAt:new Date(Date.parse(profile.missing.endAt)).toISOString(),endAt:new Date(Date.parse(profile.slot.endAt)).toISOString()};
 assert(Date.parse(proposal.endAt)<Date.parse(profile.missing.startAt));assert(Date.parse(partialLeave.startAt)>Date.parse(profile.slot.startAt));
 assert(Date.parse(arrangement.endAt)<Date.parse(profile.now));

 //Load the real strict projectors BEFORE opening the existing25s connection.
 const {projectPeriodClosureSource}=require('../../src/lib/merchantAttendancePeriodClosure.server.ts');
 const {parsePeriodClosureResult,parsePeriodClosureCommand,parsePeriodClosureQuery}=require('../../src/lib/merchantAttendancePeriodClosure.ts');
 const {parseCorrectionResult}=require('../../src/lib/merchantAttendanceCorrection.ts');
 const {parseCurrentCorrectionDecision}=require('../../src/lib/merchantAttendanceCurrentCorrectionDecision.ts');
 const {parseLeaveResult}=require('../../src/lib/merchantAttendanceLeave.ts');
 const {parseWorkArrangementResult}=require('../../src/lib/merchantAttendanceWorkArrangement.ts');
 const {projectOutageResult}=require('../../src/lib/merchantAttendanceOutage.server.ts');
 const {projectOutageLinksResult}=require('../../src/lib/merchantAttendanceOutageLinks.server.ts');
 const {projectOutageReviewResult}=require('../../src/lib/merchantAttendanceOutageReview.server.ts');
 const {projectPlanPosthocResult}=require('../../src/lib/merchantAttendancePlanPosthoc.server.ts');
 const {parsePlanExceptionResult}=require('../../src/lib/merchantAttendancePlanExceptions.ts');
 const pq=(mode='detail',access='owner',patch={})=>({siteId:d.site,access,workerId:h.workerId,fromDate:day,throughDate:day,mode,periodId:mixedPeriodId,operationId:null,version:null,...patch});
 const sourceQuery=q=>Object.fromEntries(['siteId','access','workerId','fromDate','throughDate','periodId'].map(k=>[k,q[k]]));
 const actor=access=>access==='owner'?d.owner:h.employeeAuthUserId;
 const prefix="reset role;set local time zone 'UTC';set local datestyle='ISO, YMD';"+d.guard;
 let serial=0,steps=0,reads=0,writes=0,rejections=0,sourceProjections=0,stage='connect',rolledBack=false,result;
 const next=()=>id(228000000+(++serial)),reason='Synthetic228 explicit mixed-source acceptance, not payroll';
 const connection=native.connect(),failures=[];
 const step=async(label,sql)=>{stage=label;assert(++steps<=100,'mixed_bounded100_steps');return connection.step(scope.sql((label==='begin'?'begin;':'')+prefix+sql));};
 const parsePeriod=(value,q,c,who)=>{
  if(value.artifact!==null)archiveBytes(value);
  const clean={...value};delete clean.artifactText;delete clean.artifactSha256;delete clean.artifactBytes;
  return parsePeriodClosureResult(clean,q,{authUserId:who},c);
 };
 //SQL reads/rejections have zero write allowance. Every accepted write protects
 //all other tables, including original events and BOTH missing tables. No raw
 //fact inserts, trigger replacement, altered timeout or fake success response.
 const call=async(label,{q,c=null,who=d.owner,expression,allowed=[],error=null,parse=null})=>{
  const hash=c&&!error?protectedHash(allowed):fullHash;
  const output=JSON.parse(await step(label,`do $mixed_call$ declare before_hash text;after_hash text;value jsonb;failure text;begin
   before_hash:=${hash};begin set local role service_role;value:=${expression};set constraints all immediate;set constraints all deferred;
    exception when others then if ${error===null?'true':'sqlerrm<>'+quote(error)} then raise;end if;failure:=sqlerrm;end;
   reset role;after_hash:=${hash};assert before_hash=after_hash,'mixed_read_rejection_or_protected_fact_changed';
   ${c&&!error?oldRowsGuard(allowed):''}
   assert failure is not distinct from ${error===null?'null::text':quote(error)},'mixed_expected_rejection_missing';
   perform set_config('faolla.mixed228_result',jsonb_build_object('value',value,'error',failure,'before',before_hash,'after',after_hash)::text,true);
  end;$mixed_call$;select current_setting('faolla.mixed228_result')::jsonb;`));
  assert.equal(output.before,output.after);assert.equal(output.error,error);
  if(error){rejections++;return null;}if(c)writes++;else reads++;
  return parse?parse(output.value,q,c,who):output.value;
 };
 const periodCall=(label,q,c=null,artifact=null,error=null)=>{
  parsePeriodClosureQuery(q);if(c)parsePeriodClosureCommand(q,c);
  return call(label,{q,c,who:actor(q.access),allowed:periodTables,error,parse:parsePeriod,
   expression:`public.faolla_attendance_period_closure_v1(${json(q)},${quote(actor(q.access))},${json(c)},${json(artifact)},true)`});
 };
 const pc=(action,current,fingerprint=current.artifact.sourceFingerprint)=>({action,operationId:next(),periodId:mixedPeriodId,
  expectedRevision:current.period.revision,expectedVersion:current.period.currentVersion,expectedFingerprint:fingerprint,reason});
 const source=async(label,access='owner')=>{
  const q=pq('preview',access),raw=await call(label,{q,who:actor(access),expression:`public.faolla_attendance_period_closure_source_v1(${json(sourceQuery(q))},${quote(actor(access))})`});
  const projected=projectPeriodClosureSource(raw,q);sourceProjections++;
  assert.equal(raw.employeeId,h.employeeId);assert.equal(raw.employeeAuthUserId,h.employeeAuthUserId);
  assert.equal(projected.artifact.period.startAt,profile.period.startAt);assert.equal(projected.artifact.period.endAt,profile.period.endAt);
  return {raw,...projected};
 };
 const sameSource=(a,b)=>{assert.equal(a.raw.sourceFingerprint,b.raw.sourceFingerprint);assert.deepEqual(a.raw.sourceCanonical,b.raw.sourceCanonical);assert.deepEqual(a.artifact.report.totals,b.artifact.report.totals);};
 const leaveQuery=(access='self',requestId=null)=>({siteId:d.site,access,requestId,operationId:null,beforeAt:null,beforeId:null});
 const leave=(label,q,c=null)=>call(label,{q,c,who:actor(q.access),allowed:['merchant_attendance_leave_requests','merchant_attendance_leave_entries'],
  parse:(v,q,c,who)=>parseLeaveResult(v,q,c,who),expression:`public.faolla_attendance_leave_v1(${json(q)},${quote(actor(q.access))},${json(c)},true)`});
 const workQuery=(access='self',requestId=null)=>({...leaveQuery(access,requestId),preview:null});
 const work=(label,q,c=null)=>call(label,{q,c,who:actor(q.access),allowed:['merchant_attendance_work_arrangement_requests','merchant_attendance_work_arrangement_entries'],
  parse:(v,q,c,who)=>parseWorkArrangementResult(v,q,c,{authUserId:who}),expression:`public.faolla_attendance_work_arrangement_v1(${json(q)},${quote(actor(q.access))},${json(c)},true)`});
 try{
  await step('begin',`set local lock_timeout='3s';set local statement_timeout='10s';do $mixed_start$ declare original_rows jsonb;begin
   assert exists(select 1 from public.merchant_attendance_period_closures where merchant_id=${site} and period_id=${quote(sealedPeriodId)} and sealed),'mixed_keep207_sealed';
   assert exists(select 1 from public.merchant_attendance_period_closures where merchant_id=${site} and period_id=${quote(mixedPeriodId)} and worker_id=${worker} and not sealed),'mixed_reuse204_open_period';
   assert not exists(select 1 from public.merchant_attendance_period_closures where merchant_id=${site} and worker_id=${worker} and sealed and start_at<${quote(profile.period.endAt)}::timestamptz and end_at>${quote(profile.period.startAt)}::timestamptz),'mixed_source_range_unsealed';
   assert not exists(select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid where c.relnamespace=${owned.oid} and t.tgenabled<>'O'),'mixed_all_guards_enabled';
   assert not exists(select 1 from pg_constraint c join pg_class t on t.oid=c.conrelid where t.relnamespace=${owned.oid} and not c.convalidated),'mixed_all_constraints_valid';
   assert not exists(select 1 from public.merchant_attendance_outage_operations where merchant_id=${site}),'mixed_existing_outage_probes_must_rollback';
   original_rows:=${oldRowsSnapshot};assert octet_length(original_rows::text)<=4194304,'mixed_original_rows_bounded';
   perform set_config('faolla.mixed228_original_rows',original_rows::text,true);
  end;$mixed_start$;`);
  //The sole explicitly authorized non-RPC fixture setup: this synthetic role,
  //this one permission, only when absent, and only inside the outer rollback.
  await step('owned_role_setup',`do $mixed_role$ declare before_hash text;begin before_hash:=${protectedHash(['merchant_enterprise_roles'])};
   assert exists(select 1 from public.merchant_enterprise_employees e join public.merchant_enterprise_roles r on r.merchant_id=e.merchant_id and r.id=e.role_id
    where e.merchant_id=${site} and e.id=${employee} and e.auth_user_id=${auth} and array['attendance.self.request','attendance.self.leave','attendance.self.export']<@r.permissions),'mixed_existing_self_permissions_required';
   update public.merchant_enterprise_roles set permissions=array(select distinct p from unnest(permissions||array['attendance.self.work_arrangement']) p order by p)
    where merchant_id=${site} and id=(select role_id from public.merchant_enterprise_employees where merchant_id=${site} and id=${employee}) and not('attendance.self.work_arrangement'=any(permissions));
   assert before_hash=${protectedHash(['merchant_enterprise_roles'])},'mixed_role_setup_only_disclosed_table';
   ${oldRowsGuard(['merchant_enterprise_roles'])}end;$mixed_role$;`);
  let current=await periodCall('existing_open_period',pq());assert.equal(current.period.state,'open');assert.equal(current.period.sealed,false);
  const original=await source('baseline_source');assert.equal(original.artifact.report.missing.length,1);assert.equal(original.artifact.report.missing[0].requestId,missingId);
  const prepareQ={siteId:d.site,expectedWorkerId:h.workerId,mode:'prepare',startEventId:startId};
  //The old correction service sends siteId as its own RPC argument, not as an
  //extra JSON query key. Retain siteId only for the actual Node parser context.
  const correctionWire=q=>Object.fromEntries(Object.entries(q).filter(([key])=>key!=='siteId'));
  const correctionPrepare=await call('correction_prepare',{q:prepareQ,who:h.employeeAuthUserId,parse:(v,q)=>parseCorrectionResult(v,q,true,true),
   expression:`public.faolla_attendance_correction_self_v3(${site},${auth},${json(correctionWire(prepareQ))},null,true)`});
  assert(correctionPrepare.canRequest&&correctionPrepare.rules.policy);assert.equal(correctionPrepare.pendingRequestId,null);
  const correctionId=next(),cq={siteId:d.site,expectedWorkerId:h.workerId,mode:'detail',requestId:correctionId,operationId:null};
  const correctionCommand={action:'submit',operationId:correctionId,expectedRevision:correctionPrepare.revision,expectedPolicyRevision:correctionPrepare.rules.policy.revision,
   startEventId:startId,expectedLastEventId:endId,proposal,reason};
  await call('correction_submit',{q:cq,c:correctionCommand,who:h.employeeAuthUserId,allowed:['merchant_attendance_correction_entries','merchant_attendance_correction_rule_bindings'],
   parse:(v,q,c)=>parseCorrectionResult(v,{...q,operationId:c.operationId},true,true),
   expression:`public.faolla_attendance_correction_self_v3(${site},${auth},${json(correctionWire(cq))},${json(correctionCommand)},true)`});
  const dq={siteId:d.site,requestId:correctionId,operationId:null};
  const decision=await call('correction_review',{q:dq,parse:(v,q)=>parseCurrentCorrectionDecision(v,q),
   expression:`public.faolla_attendance_correction_decide_v2(${site},${owner},${quote(correctionId)},null,null,true)`});
  assert.equal(decision.canApprove,true,JSON.stringify(decision.blockers));
  const correctionApproval={action:'approve',operationId:next(),requestId:correctionId,expectedRevision:decision.review.application.item.revision,expectedEvidence:decision.evidenceToken,reason};
  const approved=await call('correction_approve',{q:dq,c:correctionApproval,allowed:['merchant_attendance_correction_decisions','merchant_attendance_correction_effects'],
   parse:(v,q,c)=>parseCurrentCorrectionDecision(v,{...q,operationId:c.operationId}),
   expression:`public.faolla_attendance_correction_decide_v2(${site},${owner},${quote(correctionId)},${json(correctionApproval)},null,true)`});
  assert.equal(approved.current.operationId,correctionApproval.operationId);assert.equal(approved.current.workedUs,360000000);
  const corrected=await source('corrected_source'),correctedTotals=corrected.artifact.report.totals;
  assert.equal(correctedTotals.selected.workedUs-original.artifact.report.totals.selected.workedUs,60000000);
  assert.equal(correctedTotals.recordedSelected.workedUs-original.artifact.report.totals.recordedSelected.workedUs,60000000);
  assert.deepEqual(correctedTotals.original,original.artifact.report.totals.original);assert.deepEqual(corrected.artifact.report.missing,original.artifact.report.missing);
  const selectedRow=corrected.artifact.report.base.rows.find(r=>r.startEventId===startId);assert(selectedRow);
  assert.equal(selectedRow.original.totals.workedUs,300000000);assert.equal(selectedRow.selected.totals.workedUs,360000000);
  const leaveHome=await leave('leave_home',leaveQuery()),leaveId=next();
  await leave('partial_leave_submit',leaveQuery(),{action:'submit',operationId:leaveId,reason,expectedWorkerId:h.workerId,expectedSettingsVersion:leaveHome.settingsVersion,...partialLeave});
  const workHome=await work('work_home',workQuery()),workId=next();
  await work('work_submit',workQuery(),{action:'submit',operationId:workId,reason,expectedWorkerId:h.workerId,expectedSettingsVersion:workHome.settingsVersion,
   expectedPolicyRevision:workHome.policy.revision,...arrangement});
  const workDetail=(await work('work_owner_detail',workQuery('owner',workId))).detail;assert(workDetail.canApprove);assert(workDetail.conflicts.some(x=>x.source==='schedule'));
  const workApproved=await work('work_approve',workQuery('owner',workId),{action:'approve',operationId:next(),requestId:workId,expectedRevision:workDetail.revision,
   expectedConflictsFingerprint:workDetail.conflictsFingerprint,confirmConflicts:true,reason});assert.equal(workApproved.detail.status,'approved');
  const interval={startAt:stamp(start),endAt:profile.missing.endAt,timeZone:'UTC',startOffsetMinutes:0,endOffsetMinutes:0};
  const incident={action:'create_incident',operationId:next(),incidentId:next(),type:'network',channel:'web',locationId:events[0].locationId,interval,reason};
  const declaration={action:'declare',operationId:next(),declarationId:next(),incidentId:incident.incidentId,workerId:h.workerId,employeeId:h.employeeId,employeeAuthUserId:h.employeeAuthUserId,
   expectedWorkerVersion:profile.workerVersion,expectedEmployeeVersion:profile.employeeVersion,expectedGeneration:profile.generation,interval,
   statement:'Synthetic228 mixed-source statement; not reconstructed clock work',originalOperationId:null,originalChannel:null,paperReference:null};
  const outage=(label,q,c)=>call(label,{q,c,allowed:outageNativeTables,parse:(v,q,c,who)=>projectOutageResult(v,q,who,c),
   expression:`public.faolla_attendance_outage_v1(${json(q)},${owner},${json(c)},true)`});
  await outage('incident',{siteId:d.site,access:'owner',mode:'incident',incidentId:incident.incidentId},incident);
  await outage('declaration',{siteId:d.site,access:'owner',mode:'declaration',declarationId:declaration.declarationId},declaration);
  const references=[{kind:'session',startEventId:startId,lastEventId:endId,lastSequence:4,effectOperationId:approved.current.operationId,effectRevision:approved.current.revision},profile.missing.reference];
  const oq=(mode='detail',access='owner')=>({siteId:d.site,access,mode,declarationId:declaration.declarationId});
  const links=(label,q,c=null)=>call(label,{q,c,allowed:['merchant_attendance_outage_link_operations'],parse:(v,q,c,who)=>projectOutageLinksResult(v,q,who,c),
   expression:`public.faolla_attendance_outage_links_v1(${json(q)},${owner},${json(c)},true)`});
  const linkPreview=await links('link_preview',{...oq('preview'),sources:references});assert(linkPreview.preview.eligible);
  await links('link_apply',oq(),{action:'apply',operationId:next(),expectedRevision:linkPreview.revision,expectedFingerprint:linkPreview.preview.fingerprint,sources:references,reason});
  const review=(label,q,c=null)=>call(label,{q,c,who:actor(q.access),allowed:['merchant_attendance_outage_review_operations'],parse:(v,q,c,who)=>projectOutageReviewResult(v,q,who,c),
   expression:`public.faolla_attendance_outage_review_v1(${json(q)},${quote(actor(q.access))},${json(c)},true)`});
  const rc=(action,v)=>({action,operationId:next(),expectedRevision:v.revision,expectedResultVersion:v.resultVersion,
   expectedFingerprint:action==='propose'?v.status.basisFingerprint:v.proposal.resultFingerprint,reason});
  const initialReview=await review('outage_review',oq());assert(initialReview.status.canPropose,JSON.stringify(initialReview.status.blockers));
  await review('outage_propose',oq(),rc('propose',initialReview));
  const employeeReview=await review('outage_self_review',oq('detail','self'));assert(employeeReview.status.canConfirm);
  await review('outage_self_confirm',oq('detail','self'),rc('confirm',employeeReview));
  const ownerReview=await review('outage_owner_confirmed',oq());assert(ownerReview.status.canResolve);
  const resolved=await review('outage_resolve',oq(),rc('resolve',ownerReview));assert.equal(resolved.receipt.entry.action,'resolve');
  const resolvedDetail=await review('outage_resolved_detail',oq());assert(resolvedDetail.status.resolved);
  const pending=await source('mixed_pending_owner'),pendingSelf=await source('mixed_pending_self','self');sameSource(pending,pendingSelf);
  assert.equal(pending.raw.sourceVersion,'attendance-period-source-v4');assert(pending.blockers.includes('pending_leave'));
  assert(!pending.blockers.includes('unresolved_outage'));assert.deepEqual(pending.artifact.report.totals,correctedTotals);
  assert.equal(pending.raw.context.leave.find(x=>x.summary.requestId===leaveId).summary.status,'submitted');
  assert.equal(pending.raw.context.workArrangements.find(x=>x.requestId===workId).status,'approved');assert.equal(pending.raw.context.outages.length,1);
  current=await periodCall('mixed_pending_send',pq(),pc('send',current,pending.artifact.sourceFingerprint),pending.artifact);
  current=await periodCall('mixed_pending_self_confirm',pq('detail','self'),pc('confirm',current));
  await periodCall('mixed_pending_seal_blocked',pq(),pc('seal',current),null,'attendance_period_blocked');
  const leaveDetail=(await leave('partial_leave_owner_detail',leaveQuery('owner',leaveId))).detail;assert.equal(leaveDetail.status,'submitted');
  const leaveApproved=await leave('partial_leave_approve',leaveQuery('owner',leaveId),{action:'approve',operationId:next(),requestId:leaveId,expectedRevision:leaveDetail.revision,reason});
  assert.equal(leaveApproved.detail.status,'approved');
  await periodCall('mixed_old_seal_source_changed',pq(),pc('seal',current),null,'attendance_period_source_changed');
  const aq={siteId:d.site,workerId:h.workerId,slotId,mode:'detail',operationId:null};
  const adopt=(label,c=null)=>call(label,{q:aq,c,allowed:['merchant_attendance_plan_posthoc_operations','merchant_attendance_plan_posthoc_claims'],parse:(v,q,c,who)=>projectPlanPosthocResult(v,q,who,c),
   expression:`public.faolla_attendance_plan_posthoc_adoption_v1(${json(aq)},${owner},${json(c)},true)`});
  const available=await adopt('fresh_posthoc_preview');assert(available.preview.eligible,JSON.stringify(available.preview.blockers));
  for(const reference of references){
   const candidate=available.preview.candidates.find(x=>x.reference.kind===reference.kind&&(reference.kind==='session'?x.reference.startEventId===reference.startEventId:x.reference.requestId===reference.requestId));
   assert(candidate?.available,'mixed_current_reference_available');assert.deepEqual(candidate.reference,reference);
  }
  await adopt('fresh_posthoc_apply',{action:'apply',operationId:next(),expectedRevision:available.revision,expectedFingerprint:available.preview.fingerprint,
   employeeId:h.employeeId,employeeAuthUserId:h.employeeAuthUserId,reason,sources:references});
  const rq=(mode='detail',op=null)=>({siteId:d.site,access:'owner',mode,workerId:h.workerId,slotId,operationId:op,beforeAt:null,beforeId:null});
  const formal=(label,q,c=null)=>call(label,{q,c,allowed:['merchant_attendance_plan_exception_cases','merchant_attendance_plan_exception_entries','merchant_attendance_event_notifications'],
   parse:(v,q,c,who)=>parsePlanExceptionResult(v,q,{authUserId:who},c),
   expression:`public.faolla_attendance_plan_exception_posthoc_review_v1(${json(q)},${owner},${json(c)},true,true,true,true)`});
  const freshReview=await formal('fresh_formal_review',rq());assert(freshReview.detail.current.eligible,JSON.stringify(freshReview.detail.current.blockers));
  const formalCommand={operationId:next(),expectedRevision:freshReview.detail.revision,expectedFingerprint:freshReview.detail.current.fingerprint,
   employeeId:h.employeeId,employeeAuthUserId:h.employeeAuthUserId,outcome:'excused',note:reason};
  const judged=await formal('fresh_formal_decision',rq('decide',formalCommand.operationId),formalCommand);assert.equal(judged.detail.stale,false);
  const ready=await source('mixed_ready_owner'),readySelf=await source('mixed_ready_self','self');sameSource(ready,readySelf);
  assert.deepEqual(ready.blockers,[]);assert.equal(ready.raw.sourceVersion,'attendance-period-source-v4');
  assert.notEqual(ready.artifact.sourceFingerprint,pending.artifact.sourceFingerprint);assert.deepEqual(ready.artifact.report.totals,correctedTotals);
  assert.equal(ready.raw.context.leave.find(x=>x.summary.requestId===leaveId).summary.status,'approved');
  assert.equal(ready.artifact.report.missing.length,1);assert.equal(ready.artifact.report.missing[0].requestId,missingId);
  assert.equal(ready.artifact.report.totals.missingSelected.workedUs,300000000);assert.equal(ready.raw.context.outages[0].status.resolved,true);
  current=await periodCall('mixed_ready_send',pq(),pc('send',current,ready.artifact.sourceFingerprint),ready.artifact);
  await periodCall('mixed_new_version_needs_confirmation',pq(),pc('seal',current),null,'attendance_period_not_confirmed');
  current=await periodCall('mixed_ready_self_confirm',pq('detail','self'),pc('confirm',current));
  current=await periodCall('mixed_ready_seal',pq(),pc('seal',current));assert.equal(current.period.sealed,true);
  //Completed POSTs preserve a saved artifact and return sourceChanged=null.
  //Only an explicit fresh detail read proves the current source still matches.
  const sealedDetail=await periodCall('mixed_sealed_current_detail',pq());assert.equal(sealedDetail.sourceChanged,false);assert.equal(sealedDetail.period.sealed,true);
  const fixed=await periodCall('mixed_fixed_export',pq('export','owner',{version:current.period.currentVersion}));
  assert.deepEqual(fixed.artifact,ready.artifact);assert.equal(fixed.period.confirmedVersion,fixed.period.currentVersion);
  const rawArchive=async(label,q)=>call(label,{q,expression:`public.faolla_attendance_period_closure_v1(${json(q)},${owner},null,null,false)`});
  assert.deepEqual(archiveBytes(await rawArchive('old155_fixed_export',pq('export','owner',{version:1}))),old155);
  assert.deepEqual(archiveBytes(await rawArchive('old207_fixed_export',{...ctx.pq('export','owner',sealedPeriodId),version:1})),old207);
  await step('final_original_guards',`do $mixed_final$ begin
   ${oldRowsGuard(oldRowTables)}
   assert exists(select 1 from public.merchant_attendance_period_closures where merchant_id=${site} and period_id=${quote(sealedPeriodId)} and sealed),'mixed207_seal_changed';
   assert (select count(*) from public.merchant_attendance_missing_requests where merchant_id=${site} and worker_id=${worker})=1,'mixed_must_not_duplicate_missing';
  end;$mixed_final$;set constraints all immediate;`);
  await step('rollback','rollback;');rolledBack=true;
  result={phase:228,groups:[{group:'actual_mixed_period',reads,writes,rejections,sourceProjections,transactionSteps:steps,rollbackRestored:true}],
   actualCorrectionApproval:true,correctionAddedWorkedUs:60000000,existingApprovedMissing:true,missingCount:1,
   actualPartialLeaveApproval:true,actualWorkArrangementApproval:true,actualOutageResolution:true,actualMixedSendConfirmSeal:true,
   pendingLeaveSendConfirmAllowed:true,pendingSealRefused:true,staleSealRefused:true,newVersionNeedsConfirmation:true,
   contextDoesNotAddWorkedTime:true,ownerSelfFingerprintEqual:true,originalEventsUnchanged:true,allowedTableOriginalRowsPreserved:true,
   old155ArchivePreserved:true,actualSealedArchivePreserved:true,rollbackRestored:true,syntheticOnly:true,callerOwnsRuntimeAndCleanup:true,
   fixtureDisclosure:'Existing174/204 historical punches/schedule are synthetic. New correction, partial leave, work arrangement, outage, adoption, review and period requests use real RPCs; no real Auth, production, payroll or capacity claim. The sole non-RPC setup adds one permission to the owned synthetic role inside this same rollback.'};
 }catch(error){failures.push(new Error('period_mixed_actual_failed:'+stage+':'+String(error?.message??error),{cause:error}));}
 finally{
  //Closing the owned connection also rolls back any failed/incomplete BEGIN;
  //never touch another session or increase the existing lifetime/deadline.
  try{await connection.close();}catch(error){failures.push(error);}
  for(const [label,read,want]of [['facts',()=>d.fingerprint(),baseline],['definitions',()=>d.definitions(),definitions],['catalog',()=>d.tableCatalog(),catalog]]){
   try{assert.equal(read(),want,'mixed_rollback_'+label);}catch(error){failures.push(error);}
  }
  try{assert.deepEqual(archiveBytes(archive()),old155);assert.deepEqual(archiveBytes(periodArchive()),old207);}catch(error){failures.push(error);}
 }
 if(failures.length)throw new AggregateError(failures,'period_mixed_native_failed:'+failures.map(e=>e.message).join(' | '));
 assert(rolledBack);native.pass('228 actual mixed correction/missing/partial-leave/arrangement/outage source: strict Node artifact, stale seal refusal, reconfirmed seal, one exact rollback');
 return result;
}
