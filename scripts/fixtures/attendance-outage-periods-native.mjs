//215 caller-owned rollback probe. SQL supplies every current source/context;
//the unchanged closed-work report is computed by the real Node projector and
//each actual sent artifact is checked again through the real service afterward.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {assertLifecycleSandbox,lifecycleId as id,lifecycleJson as json} from '../merchant-attendance-lifecycle-native-support.mjs';
import {quote} from './attendance-bound-clocks-native.mjs';
import {outageNativeFingerprintSql,outageNativeTables} from './attendance-outage-native.mjs';
import {outageLinksNativeTables} from './attendance-outage-links-native.mjs';
import {outageReviewsNativeTables} from './attendance-outage-reviews-native.mjs';
const require=createRequire(import.meta.url),fresh=n=>id(215000000+n),stamp=ms=>new Date(ms).toISOString().replace(/Z$/,'000Z');
export const outagePeriodWriteTables=Object.freeze(['merchant_attendance_period_closures','merchant_attendance_period_artifacts','merchant_attendance_period_versions','merchant_attendance_period_entries']);
export function createOutagePeriodNativePlan(input){
 const interval={startAt:stamp(Math.min(Date.parse(input.sealedStart),Date.parse(input.startAt))),
  endAt:stamp(Math.max(Date.parse(input.sealedEnd),Date.parse(input.endAt))+900000),timeZone:'UTC',startOffsetMinutes:0,endOffsetMinutes:0};
 assert(Date.parse(interval.startAt)<Date.parse(interval.endAt)&&Date.parse(interval.endAt)<Date.parse(input.now));
 assert(Date.parse(interval.endAt)-Date.parse(interval.startAt)<31*86400000);
 const incident={action:'create_incident',operationId:fresh(1),incidentId:fresh(2),type:'network',channel:'web',locationId:input.location,interval,
  reason:'Synthetic215 declared outage; no raw work reconstruction'};
 const declaration={action:'declare',operationId:fresh(3),declarationId:fresh(4),incidentId:incident.incidentId,workerId:input.worker,
  employeeId:input.employee,employeeAuthUserId:input.auth,expectedWorkerVersion:input.workerVersion,expectedEmployeeVersion:input.employeeVersion,
  expectedGeneration:input.generation,interval,statement:'Synthetic215 current employee statement for period verification',originalOperationId:null,originalChannel:null,paperReference:null};
 const second={...declaration,operationId:fresh(21),declarationId:fresh(22),statement:'Synthetic215 later statement must not rewrite an earlier archive'};
 return {incident,declaration,second,reference:{kind:'session',startEventId:id(204710),lastEventId:id(204711),lastSequence:4,effectOperationId:null,effectRevision:null}};
}
export async function verifyAttendanceOutagePeriodsNative(ctx,{firstV4=false}={}){
 const {d,h,native,scope,period,pq,periodId:existingPeriodId,periodArchive,archive,oldArchive,legacySources}=ctx;
 assert.equal(typeof firstV4,'boolean');
 const periodId=firstV4?fresh(500):existingPeriodId;
 const firstDate=new Date(Date.parse(h.slot.startAt.slice(0,10)+'T00:00:00.000Z')-86400000).toISOString().slice(0,10);
 assert(d?.syntheticOnly===true&&h?.syntheticOnly===true);assert.equal(typeof native.querySteps,'function');
 const owned=assertLifecycleSandbox(sql=>native.query(scope.sql(sql)));assert.deepEqual(owned,d.owned);
 assert((await period(pq('detail','owner',existingPeriodId))).period.sealed);
 const baseline=d.fingerprint(),defs=d.definitions(),catalog=d.tableCatalog(),names=d.inventory(),sealedArchive=periodArchive();
 const fullHash=outageNativeFingerprintSql(names),protectedHash=allowed=>outageNativeFingerprintSql(names.filter(name=>!allowed.includes(name)));
 const site=quote(d.site),owner=quote(d.owner),worker=quote(h.workerId),employee=quote(h.employeeId),auth=quote(h.employeeAuthUserId),fmt='YYYY-MM-DD"T"HH24:MI:SS.US"Z"';
 const profile=JSON.parse(d.exec(`select jsonb_build_object('workerVersion',w.version,'employeeVersion',e.version,'generation',coalesce(ep.generation,0),
  'now',to_char(clock_timestamp() at time zone 'UTC',${quote(fmt)}),'session',public.faolla_attendance_period_session_v1(${site},w.id,${quote(id(204710))},e.id,e.auth_user_id,clock_timestamp()))
  from public.merchant_attendance_workers w join public.merchant_enterprise_employees e on e.merchant_id=w.merchant_id and e.id=w.employee_id
  left join public.merchant_attendance_account_epochs ep on ep.merchant_id=e.merchant_id and ep.employee_id=e.id
  where w.merchant_id=${site} and w.id=${worker} and e.id=${employee} and e.auth_user_id=${auth} and w.active and e.status='active' and not coalesce(ep.paused,false);`));
 assert(profile?.session);assert.equal(d.fingerprint(),baseline);
 const events=profile.session.item.events;assert.deepEqual(events.map(e=>[e.id,e.sequence,e.action]),[[id(204710),3,'clock_in'],[id(204711),4,'clock_out']]);
 assert.equal(profile.session.item.effect,null);
 const p=createOutagePeriodNativePlan({site:d.site,worker:h.workerId,employee:h.employeeId,auth:h.employeeAuthUserId,location:h.slot.locationId,...profile,
  sealedStart:firstV4?firstDate+'T00:00:00.000000Z':h.slot.startAt,sealedEnd:h.slot.endAt,startAt:events[0].occurredAt,endAt:events.at(-1).occurredAt});
 const {executePeriodClosures,projectPeriodClosureSource}=require('../../src/lib/merchantAttendancePeriodClosure.server.ts');
 const {projectOutageResult}=require('../../src/lib/merchantAttendanceOutage.server.ts');
 const {projectOutageLinksResult}=require('../../src/lib/merchantAttendanceOutageLinks.server.ts');
 const {projectOutageReviewResult}=require('../../src/lib/merchantAttendanceOutageReview.server.ts');
 const q=(mode='detail',access='owner',operationId=null,version=null)=>({...pq(mode,access,firstV4&&mode==='preview'?null:periodId),operationId,version,
  ...(firstV4?{fromDate:firstDate,throughDate:firstDate}:{})});
 const sourceQ=access=>Object.fromEntries(['siteId','access','workerId','fromDate','throughDate','periodId'].map(k=>[k,q('detail',access)[k]]));
 const baselinePreviews=Object.fromEntries(['owner','self'].map(access=>{
  const sourceBefore=firstV4?JSON.parse(d.exec(`select public.faolla_attendance_period_closure_source_v1(${json(sourceQ(access))},${access==='owner'?owner:auth})::text;`)):legacySources[access];
  const preview=projectPeriodClosureSource(sourceBefore,q('preview',access));
  assert.equal(d.fingerprint(),baseline,'outage_period_baseline_read_zero_writes_'+access);
  assert(!preview.blockers.includes('unresolved_outage'),'outage_period_no_declaration_baseline_'+access);
  return [access,preview];
 }));
 const baselineArtifact=baselinePreviews.owner.artifact;
 assert.equal(baselineArtifact.report.base.openSessionCount,0);assert.equal(baselineArtifact.report.base.periodInProgress,false);
 if(firstV4){assert.equal(h.slot.timeZone,'UTC');assert.equal(baselineArtifact.report.base.rows.length,0);assert.equal(baselineArtifact.report.missing.length,0);}
 const originalSource=baselineArtifact.source,sourceScope={...originalSource};delete sourceScope.context;delete sourceScope.sourceVersion;
 const prefix="reset role;set local time zone 'UTC';set local datestyle='ISO, YMD';"+d.guard;
 const saved=label=>`(current_setting('faolla.outage215_${label}')::jsonb->'value')`;
 const savedCommand=label=>`(current_setting('faolla.outage215_${label}')::jsonb->'command')`;
 const scopeQuery=json(sourceQ('owner')),steps=[],expected=new Map();let reads=0,writes=0,rejections=0;
 const pc=(n,action,head,preview=null)=>`jsonb_build_object('action',${quote(action)},'operationId',${quote(fresh(n))},'periodId',${quote(periodId)},
  'expectedRevision',${head?saved(head)+"->'period'->'revision'":'0'},'expectedVersion',${head?saved(head)+"->'period'->'currentVersion'":'0'},
  'expectedFingerprint',${action==='send'?saved(preview)+"->'source'->'sourceFingerprint'":action==='reopen'?'null':saved(head)+"->'artifact'->'sourceFingerprint'"},
  'reason','Synthetic215 explicit period '||${quote(action)})`;
 //This is not a new calculator. Assert the actual raw canonical work report,
 //identity and fixed frame are unchanged; only carry current SQL asOf through
 //the already-computed closed report. Node's real service must produce EXACTLY
 //this artifact from the captured raw source before the test can pass.
 const prepareArtifact=`
  begin perform public.faolla_attendance_period_closure_v1(period_query||jsonb_build_object('mode','recover','operationId',period_command->'operationId'),${owner},null,null,false);
   raise exception 'outage_period_expected_new_operation';exception when raise_exception then
   if sqlerrm<>'attendance_operation_not_found' then raise;end if;period_recovery_error:=sqlerrm;end;
  period_source:=public.faolla_attendance_period_closure_source_v1(${scopeQuery},${owner});
  assert ((period_source->'sourceCanonical')-'context'-'sourceVersion')=${json(sourceScope)},'outage_period_report_or_frame_changed';
  assert ((period_source->'sourceCanonical'->'context')-'outages')=${json(originalSource.context)},'outage_period_other_context_changed';
  assert period_source->'dayBoundaries'=${json(baselineArtifact.dayBoundaries)},'outage_period_saved_boundaries_changed';
  assert period_source->'report'->'base'->>'asOf'>=${quote(baselineArtifact.report.base.asOf)},'outage_period_source_time_regressed';
  period_artifact:=jsonb_set(jsonb_set(jsonb_set(${json(baselineArtifact)},'{source}',period_source->'sourceCanonical'),
   '{sourceFingerprint}',period_source->'sourceFingerprint'),'{report,base,asOf}',period_source->'report'->'base'->'asOf');`;
 const tables=kind=>kind==='period'?outagePeriodWriteTables:kind==='outage'?outageNativeTables:kind==='links'?outageLinksNativeTables:outageReviewsNativeTables;
 const call=(label,{query=q(),command='null',kind='period',actor=d.owner,allow=true,write=false,replay=false,send=false,expression,error=null}={})=>{
  assert(/^[a-z_]+$/.test(label)&&!expected.has(label));expected.set(label,{kind,error,write,replay,send});
  if(error)rejections++;else if(write&&!replay)writes++;else reads++;
  const hash=error||!write||replay?fullHash:protectedHash(tables(kind));
  const expr=expression??`public.faolla_attendance_period_closure_v1(period_query,${quote(actor)},period_command,period_artifact,${allow})`;
  steps.push(prefix+`do $outage_period_call$ declare period_before text;period_after text;period_query jsonb;period_command jsonb;period_value jsonb;
   period_source jsonb;period_artifact jsonb;period_recovery_error text;period_error text;begin
   period_before:=${hash};period_query:=${json(query)};period_command:=${command};set local role service_role;
   ${send?prepareArtifact:''}
   ${error?`begin perform ${expr};raise exception 'outage_period_expected_rejection_missing';exception when others then
    period_error:=sqlerrm;if period_error<>${quote(error)} then raise;end if;end;`:`period_value:=${expr};`}
   set constraints all immediate;set constraints all deferred;reset role;period_after:=${hash};
   assert period_before=period_after,'outage_period_read_or_protected_facts_changed';
   perform set_config(${quote('faolla.outage215_'+label)},jsonb_build_object('label',${quote(label)},'kind',${quote(kind)},'query',period_query,'actor',${quote(actor)},
    'command',period_command,'value',period_value,'source',period_source,'artifact',period_artifact,'recoveryError',period_recovery_error,
    'error',period_error,'before',period_before,'after',period_after)::text,true);
   end;$outage_period_call$;select current_setting(${quote('faolla.outage215_'+label)})::jsonb;`);
 };
 const oq=(mode='detail',access='owner')=>({siteId:d.site,access,mode,declarationId:p.declaration.declarationId});
 const rc=(n,action,head)=>`jsonb_build_object('action',${quote(action)},'operationId',${quote(fresh(n))},'expectedRevision',${saved(head)}->'revision',
  'expectedResultVersion',${saved(head)}->'resultVersion','expectedFingerprint',${saved(head)}${action==='propose'?"->'status'->'basisFingerprint'":"->'proposal'->'resultFingerprint'"},'reason','Synthetic215 '||${quote(action)})`;
 const seal=`assert exists(select 1 from public.merchant_attendance_period_closures where merchant_id=${site} and period_id=${quote(existingPeriodId)} and sealed),'outage_period_real_seal_required';`;
 steps.push('begin;'+prefix+`do $outage_period_start$ begin ${seal}
  ${firstV4?`assert not exists(select 1 from public.merchant_attendance_period_closures where merchant_id=${site} and worker_id=${worker}
   and start_at<${quote(baselineArtifact.period.endAt)}::timestamptz and end_at>${quote(baselineArtifact.period.startAt)}::timestamptz),'outage_period_fresh_range_must_not_overlap';`:''}
  assert not exists(select 1 from public.merchant_attendance_outage_operations where merchant_id=${site}),'outage_period_empty176_required';
  assert not exists(select 1 from public.merchant_attendance_outage_link_operations where merchant_id=${site}),'outage_period_empty177_required';
  assert not exists(select 1 from public.merchant_attendance_outage_review_operations where merchant_id=${site}),'outage_period_empty178_required';
  assert not exists(select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid where c.relnamespace=${owned.oid} and t.tgenabled<>'O'),'outage_period_guards_enabled';end;$outage_period_start$;`);
 if(!firstV4){
  call('original_detail');call('reopen',{command:pc(100,'reopen','original_detail'),write:true});
  call('clean_preview',{query:q('preview')});
  call('clean_send',{command:pc(101,'send','reopen','clean_preview'),write:true,send:true});
  call('clean_confirm',{query:q('detail','self'),actor:h.employeeAuthUserId,command:pc(102,'confirm','clean_send'),write:true});
 }
 call('incident',{query:{siteId:d.site,access:'owner',mode:'incident',incidentId:p.incident.incidentId},command:json(p.incident),kind:'outage',write:true,
  expression:`public.faolla_attendance_outage_v1(period_query,${owner},period_command,true)`});
 call('declaration',{query:{siteId:d.site,access:'owner',mode:'declaration',declarationId:p.declaration.declarationId},command:json(p.declaration),kind:'outage',write:true,
  expression:`public.faolla_attendance_outage_v1(period_query,${owner},period_command,true)`});
 call('unresolved_preview',{query:q('preview')});call('unresolved_self_preview',{query:q('preview','self'),actor:h.employeeAuthUserId});
 call('unresolved_send_denied',{command:pc(103,'send',firstV4?null:'clean_confirm','unresolved_preview'),send:true,error:'attendance_period_blocked'});
 if(!firstV4){
  call('old_confirm_denied',{query:q('detail','self'),actor:h.employeeAuthUserId,command:pc(104,'confirm','clean_confirm'),error:'attendance_period_source_changed'});
  call('old_seal_denied',{command:pc(105,'seal','clean_confirm'),error:'attendance_period_source_changed'});
 }
 call('link_preview',{query:{...oq('preview'),sources:[p.reference]},kind:'links',expression:`public.faolla_attendance_outage_links_v1(period_query,${owner},null,true)`});
 call('link_apply',{query:oq(),kind:'links',write:true,
  command:`jsonb_build_object('action','apply','operationId',${quote(fresh(5))},'expectedRevision',0,'expectedFingerprint',${saved('link_preview')}->'preview'->'fingerprint','sources',${json([p.reference])},'reason','Synthetic215 linked evidence')`,
  expression:`public.faolla_attendance_outage_links_v1(period_query,${owner},period_command,true)`});
 call('review_detail',{query:oq(),kind:'review',expression:`public.faolla_attendance_outage_review_v1(period_query,${owner},null,true)`});
 call('propose',{query:oq(),kind:'review',command:rc(10,'propose','review_detail'),write:true,expression:`public.faolla_attendance_outage_review_v1(period_query,${owner},period_command,true)`});
 call('self_review',{query:oq('detail','self'),actor:h.employeeAuthUserId,kind:'review',expression:`public.faolla_attendance_outage_review_v1(period_query,${auth},null,true)`});
 call('confirm_review',{query:oq('detail','self'),actor:h.employeeAuthUserId,kind:'review',command:rc(11,'confirm','self_review'),write:true,
  expression:`public.faolla_attendance_outage_review_v1(period_query,${auth},period_command,true)`});
 call('confirmed_review',{query:oq(),kind:'review',expression:`public.faolla_attendance_outage_review_v1(period_query,${owner},null,true)`});
 call('resolve_review',{query:oq(),kind:'review',command:rc(12,'resolve','confirmed_review'),write:true,
  expression:`public.faolla_attendance_outage_review_v1(period_query,${owner},period_command,true)`});
 call('resolved_preview',{query:q('preview')});call('resolved_self_preview',{query:q('preview','self'),actor:h.employeeAuthUserId});
 call('resolved_send',{command:pc(106,'send',firstV4?null:'clean_confirm','resolved_preview'),write:true,send:true});
 call('seal_without_reconfirmation',{command:pc(107,'seal','resolved_send'),error:'attendance_period_not_confirmed'});
 call('reconfirm',{query:q('detail','self'),actor:h.employeeAuthUserId,command:pc(108,'confirm','resolved_send'),write:true});
 call('reseal',{command:pc(109,'seal','reconfirm'),write:true});call('sealed_detail');
 const savedVersion=firstV4?1:3;
 if(firstV4)call('first_new_version_fixed_preview',{query:{...q('preview'),periodId}});
 call('new_archive',{query:q('export','owner',null,savedVersion),allow:false});
 if(!firstV4){
  call('later_declaration',{query:{siteId:d.site,access:'owner',mode:'declaration',declarationId:p.second.declarationId},command:json(p.second),kind:'outage',write:true,
   expression:`public.faolla_attendance_outage_v1(period_query,${owner},period_command,true)`});
  call('later_preview',{query:q('preview')});call('later_detail');
 }
 call('fixed_new_archive',{query:q('export','owner',null,savedVersion),allow:false});
 if(!firstV4)call('fixed_old_archive',{query:q('export','owner',null,1),allow:false});
 call('send_recovery',{query:q('recover','owner',fresh(106)),allow:false});
 call('send_exact_replay',{command:savedCommand('resolved_send'),write:true,replay:true,allow:false});
 call('self_confirm_recovery',{query:q('recover','self',fresh(108)),actor:h.employeeAuthUserId,allow:false});
 steps.push(prefix+`do $outage_period_finish$ begin ${seal}end;$outage_period_finish$;set constraints all immediate;
  ${firstV4?`do $outage_first_v4_sealed$ begin assert exists(select 1 from public.merchant_attendance_period_closures where merchant_id=${site} and period_id=${quote(periodId)} and sealed and current_version=1),'outage_period_first_v4_real_seal_required';end;$outage_first_v4_sealed$;`:''}
  select jsonb_build_object('kind','counts','outageOperations',(select count(*) from public.merchant_attendance_outage_operations where merchant_id=${site}),
   'links',(select count(*) from public.merchant_attendance_outage_link_operations where merchant_id=${site}),
   'reviews',(select count(*) from public.merchant_attendance_outage_review_operations where merchant_id=${site}));rollback;`);
 assert(steps.length<=60,'outage_period_bounded_steps');let rows;const failures=[];
 try{rows=(await native.querySteps(steps.map(sql=>scope.sql(sql)))).trim().split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line));}
 catch(error){failures.push(new Error('outage_period_actual_sql_failed:'+String(error?.message??error),{cause:error}));}
 finally{
  for(const [label,read,want]of [['facts',()=>d.fingerprint(),baseline],['definitions',()=>d.definitions(),defs],['catalog',()=>d.tableCatalog(),catalog],
   ['old155_text',()=>archive().artifactText,oldArchive.artifactText],['old155_sha',()=>archive().artifactSha256,oldArchive.artifactSha256],
   ['sealed_text',()=>periodArchive().artifactText,sealedArchive.artifactText],['sealed_sha',()=>periodArchive().artifactSha256,sealedArchive.artifactSha256]]){
   try{assert.equal(read(),want,'outage_period_rollback_'+label);}catch(error){failures.push(error);}
  }
 }
 if(failures.length)throw new AggregateError(failures,'outage_period_native_failed:'+failures.map(e=>e.message).join(' | '));
 const parsed=new Map(),raw=new Map();
 for(const row of rows){
  if(row.kind==='counts')continue;const meta=expected.get(row.label);assert(meta);assert.equal(row.before,row.after);raw.set(row.label,row);
  try{
   if(row.kind==='period'){
    let sourceUsed=false,recoveryUsed=false,writeUsed=false;
    const service={rpc:async(name,a)=>{
     if(meta.send&&a.p_query.mode==='recover'){
      assert.equal(name,'faolla_attendance_period_closure_v1');assert.equal(row.recoveryError,'attendance_operation_not_found');recoveryUsed=true;
      assert.equal(a.p_query.operationId,row.command.operationId);return {data:null,error:{message:row.recoveryError}};
     }
     if(meta.send&&name==='faolla_attendance_period_closure_source_v1'){
      assert(recoveryUsed);assert.deepEqual(a.p_query,sourceQ('owner'));sourceUsed=true;return {data:row.source,error:null};
     }
     assert.equal(name,'faolla_attendance_period_closure_v1');assert.equal(a.p_auth_user_id,row.actor);
     if(meta.send){assert(sourceUsed);assert.deepEqual(a.p_artifact,row.artifact,'outage_period_real_projector_matches_actual_sent_artifact');}
     assert.deepEqual(a.p_command,row.command);writeUsed=true;
     return row.error?{data:null,error:{message:row.error}}:{data:row.value,error:null};
    }};
    const input={query:row.query,command:row.command,authUserId:row.actor,moduleEnabled:true};
    //An exact send replay uses the actual saved operation result as the normal
    //service's first GET-recovery response; no source recollection or POST.
    if(meta.replay){
     const replayService={rpc:async(name,a)=>{assert.equal(name,'faolla_attendance_period_closure_v1');assert.equal(a.p_query.mode,'recover');assert.equal(a.p_query.operationId,row.command.operationId);return {data:row.value,error:null};}};
     parsed.set(row.label,await executePeriodClosures(input,replayService));
    }else if(row.error){await assert.rejects(()=>executePeriodClosures(input,service),error=>error?.code===row.error);assert(writeUsed);}
    else{parsed.set(row.label,await executePeriodClosures(input,service));assert(writeUsed);}
   }else if(row.kind==='outage')parsed.set(row.label,projectOutageResult(row.value,row.query,row.actor,row.command));
   else if(row.kind==='links')parsed.set(row.label,projectOutageLinksResult(row.value,row.query,row.actor,row.command));
   else parsed.set(row.label,projectOutageReviewResult(row.value,row.query,row.actor,row.command));
  }catch(error){throw new Error('outage_period_projection_failed:'+row.label+':'+String(error?.message??error),{cause:error});}
 }
 assert.equal(raw.size,expected.size);assert.equal(rows.filter(r=>r.error).length,rejections);
 assert.deepEqual(rows.find(r=>r.kind==='counts'),{kind:'counts',outageOperations:firstV4?2:3,links:1,reviews:3});
 if(!firstV4)assert.equal(parsed.get('clean_send').period.currentVersion,2);
 assert.equal(parsed.get('resolved_send').period.currentVersion,savedVersion);
 assert.equal(parsed.get('resolved_send').period.confirmedVersion,null);assert.equal(parsed.get('reconfirm').period.confirmedVersion,savedVersion);assert(parsed.get('reseal').period.sealed);
 //175 self previews deliberately retain unresolved_review: only the owner
 //can perform the fresh review check. Outage resolution must preserve EACH
 //role's preexisting blockers, not turn an employee preview into owner proof.
 for(const [label,access]of [['unresolved_preview','owner'],['unresolved_self_preview','self'],...(!firstV4?[['later_preview','owner']]:[])])
  assert.deepEqual(parsed.get(label).preview.blockers,[...baselinePreviews[access].blockers,'unresolved_outage'],label);
 for(const [label,access]of [['resolved_preview','owner'],['resolved_self_preview','self']])
  assert.deepEqual(parsed.get(label).preview.blockers,baselinePreviews[access].blockers,label);
 const un=parsed.get('unresolved_preview').preview.artifact,done=parsed.get('resolved_preview').preview.artifact;
 assert.equal(un.source.sourceVersion,'attendance-period-source-v4');assert.equal(un.source.context.outages.length,1);assert.equal(un.source.context.outages[0].status.resolved,false);
 assert.equal(done.source.context.outages[0].status.resolved,true);assert.equal(done.source.context.outages[0].current.operationId,fresh(12));
 assert.deepEqual(done.source.context.outages,parsed.get('resolved_self_preview').preview.artifact.source.context.outages);
 assert.deepEqual(done.report.totals,baselineArtifact.report.totals);assert.deepEqual(done.report.days,baselineArtifact.report.days);
 assert.equal(parsed.get('sealed_detail').sourceChanged,false);
 if(!firstV4){
  assert.equal(parsed.get('later_detail').sourceChanged,true);assert(parsed.get('later_detail').period.sealed);
  assert.equal(parsed.get('later_preview').preview.artifact.source.context.outages.length,2);
 }else{
  assert.equal(parsed.get('new_archive').artifact.source.sourceVersion,'attendance-period-source-v4');
  assert.equal(parsed.get('new_archive').artifactVersion,1);
  assert.deepEqual(parsed.get('first_new_version_fixed_preview').preview.artifact.source,parsed.get('resolved_send').artifact.source);
  assert.deepEqual(parsed.get('first_new_version_fixed_preview').preview.artifact.dayBoundaries,parsed.get('resolved_send').artifact.dayBoundaries);
 }
 for(const k of ['artifactText','artifactSha256','artifactBytes'])assert.deepEqual(raw.get('fixed_new_archive').value[k],raw.get('new_archive').value[k],k);
 if(!firstV4){assert.equal(raw.get('fixed_old_archive').value.artifactText,sealedArchive.artifactText);assert.equal(raw.get('fixed_old_archive').value.artifactSha256,sealedArchive.artifactSha256);}
 for(const label of ['send_recovery','send_exact_replay']){
  assert.deepEqual(parsed.get(label).operation,parsed.get('resolved_send').operation);assert.deepEqual(parsed.get(label).artifact,parsed.get('resolved_send').artifact);
 }
 assert.deepEqual(parsed.get('self_confirm_recovery').operation,parsed.get('reconfirm').operation);
 native.pass(firstV4?'215 real first-version v4 period send-confirm-seal and fixed-frame reread/export/recovery without preexisting period overlap':
  '215 real unresolved outage blocks send and old confirmation/seal; resolve requires new version and employee reconfirmation; later statement preserves fixed archives/recovery');
 const result={scenario:firstV4?'first_v4_archive':'existing_v3_archive',reads,submissions:writes,rejections,transactionSteps:steps.length,noDeclarationCanonicalUnchanged:true,
  actualOutageResolution:true,unresolvedBlocksSend:true,unresolvedInvalidatesOldConfirmationAndSeal:!firstV4,
  actualPeriodReopenResendReconfirmSeal:!firstV4,firstV4FixedFrameRead:firstV4,laterDeclarationDoesNotRewriteArchive:!firstV4,exactSavedRecovery:true,
  realServiceProjectedSentArtifacts:true,allReadsAndRejectionsZeroWrites:true,allTransactionsRolledBack:true,definitionsAndCatalogUnchanged:true,
  unchangedWorkTotals:true,old155ArchivePreserved:true,actualSealedArchivePreserved:true,
  syntheticHistoricalOriginalEvent:true,actualHistoricalClockRequests:false,newSyntheticClockRows:0,
  browser:false,productionAccess:false,newCluster:false,concurrency:false};
 if(!firstV4)return {...result,firstV4:await verifyAttendanceOutagePeriodsNative(ctx,{firstV4:true})};
 return result;
}
