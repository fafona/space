//234: existing disclosed174/204 synthetic history; fresh grants, leave and
//period writes use real RPCs/Node projectors. No actual Auth or new runtime.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {assertLifecycleSandbox,lifecycleId as id,lifecycleJson as json} from '../merchant-attendance-lifecycle-native-support.mjs';
import {quote} from './attendance-bound-clocks-native.mjs';
import {outageNativeFingerprintSql} from './attendance-outage-native.mjs';
const require=createRequire(import.meta.url),uid=n=>id(234400000+n);
const sourceIds={start:id(204710),end:id(204711),missing:id(204715),slot:id(174701),period:id(204900001)};
const serialization="reset role;set local time zone 'UTC';set local datestyle='ISO,YMD';set local extra_float_digits=3;";
export const delegatedMixedWriteTables=Object.freeze(['merchant_enterprise_roles','merchant_enterprise_employees','merchant_enterprise_audit_events',
 'merchant_attendance_period_delegations','merchant_attendance_period_closures','merchant_attendance_period_storage',
 'merchant_attendance_period_artifacts','merchant_attendance_period_versions','merchant_attendance_period_entries',
 'merchant_attendance_period_artifact_metadata','merchant_attendance_period_delegation_operations',
 'merchant_attendance_leave_requests','merchant_attendance_leave_entries']);
export function delegatedMixedArchiveBytes(value){
 assert.equal(typeof value?.artifactText,'string');assert.equal(value.artifactBytes,Buffer.byteLength(value.artifactText,'utf8'));
 assert.equal(value.artifactSha256,createHash('sha256').update(value.artifactText,'utf8').digest('hex'));assert.deepEqual(JSON.parse(value.artifactText),value.artifact);
 return{artifactText:value.artifactText,artifactBytes:value.artifactBytes,artifactSha256:value.artifactSha256};
}
export function delegatedMixedInterval(events,missing){
 assert.deepEqual(events.map(x=>[x.id,x.sequence,x.action]),[[sourceIds.start,3,'clock_in'],[sourceIds.end,4,'clock_out']]);
 const start=Date.parse(events[0].occurredAt),end=Date.parse(events[1].occurredAt);assert.equal(end-start,300000);
 assert.equal(Date.parse(missing.startAt)-end,300000);assert.equal(end%60000,0);
 return{timeZone:'UTC',startAt:new Date(end).toISOString(),endAt:new Date(end+60000).toISOString()};
}
export function assertDelegatedMixedSourceProofs(profile,identity){
 const original=profile.originalSession,fresh=profile.session;
 //174 seeded137 relation +140 fixed adoption, NOT a135 rule binding. The real
 //148 reader validates that separate historical identity channel and all raw
 //actor_employee_id values. A null binding must not become invented evidence.
 assert.equal(original.ruleBinding,null);assert.equal(original.item.effect,null);
 assert.equal(original.relation.startEventId,id(174704));assert.equal(original.relation.operationId,id(174706));
 assert.equal(original.relation.status,'linked');assert.equal(original.relation.selection.slotId,sourceIds.slot);assert.equal(original.relation.slot.id,sourceIds.slot);
 assert.equal(original.adoption.status,'adopted');assert.equal(original.adoption.approval.operationId,id(174702));
 assert.equal(original.planRuleApproval.operationId,id(174702));assert.equal(original.planRuleApproval.source.workerId,identity.workerId);
 assert.equal(original.planRuleApproval.source.employeeId,identity.employeeId);assert.equal(original.planRuleApproval.source.employeeAuthUserId,identity.employeeAuthUserId);
 assert.deepEqual(profile.originalEventIdentities,[174704,174705].map((n,index)=>({eventId:id(n),operationId:id(174706+index),
  workerId:identity.workerId,actorEmployeeId:identity.employeeId,source:'web'})));
 //204 explicitly seeded an unverified135 binding, with historical double IDs;
 //it did not have a137 relation or a140 adoption. Keep the channels distinct.
 assert.equal(fresh.item.effect,null);assert.equal(fresh.ruleBinding.employeeId,identity.employeeId);assert.equal(fresh.ruleBinding.employeeAuthUserId,identity.employeeAuthUserId);
 assert.equal(fresh.ruleBinding.status,'unverified');assert.equal(fresh.ruleBinding.reason,'source_unavailable');assert.equal(fresh.ruleBinding.source,null);
 assert.equal(fresh.relation,null);assert.equal(fresh.adoption,null);assert.equal(fresh.planRuleApproval,null);
}
export function assertDelegatedMixedReport(artifact,profile,identity){
 const report=artifact.report;assert.equal(report.access,'delegate');assert.equal(report.base.workerId,identity.workerId);assert.equal(report.base.employeeId,identity.employeeId);
 assert.deepEqual(artifact.worker.employeeId,identity.employeeId);assert.equal(artifact.worker.employeeAuthUserId,identity.employeeAuthUserId);
 assert.deepEqual(report.base.rows.map(r=>r.startEventId),[id(174704),sourceIds.start]);assert.equal(report.missing.length,1);
 for(const [index,events] of [profile.originalSession.item.events,profile.session.item.events].entries()){
  const row=report.base.rows[index];assert.deepEqual(row.eventIds,events.map(e=>e.id));assert.equal(row.correction,null);assert.equal(row.source,'original');
  assert.equal(row.selected.startAt,events[0].occurredAt);assert.equal(row.selected.endAt,events.at(-1).occurredAt);
  assert.deepEqual(row.selected,row.original);assert.equal(row.selected.totals.workedUs,(Date.parse(events.at(-1).occurredAt)-Date.parse(events[0].occurredAt))*1000);
 }
 const missing=report.missing[0];assert.equal(missing.requestId,sourceIds.missing);assert.equal(missing.operationId,profile.missing.approvalOperationId);
 assert.equal(missing.workerId,identity.workerId);assert.equal(missing.employeeId,null);assert.equal(missing.proposal.startAt,profile.missing.startAt);
 assert.equal(missing.proposal.endAt,profile.missing.endAt);assert.deepEqual(missing.proposal.breaks,[]);
 assert.equal(report.totals.recordedSelected.workedUs,5100000000);assert.equal(report.totals.missingSelected.workedUs,300000000);
 assert.equal(report.totals.selected.workedUs,5400000000);assert.equal(report.totals.original.workedUs,5100000000);
 assert.equal(artifact.source.context.plans.items.length,1);const plan=artifact.source.context.plans.items[0];assert.equal(plan.slot.id,sourceIds.slot);
 assert.equal(plan.slot.startAt,profile.slot.startAt);assert.equal(plan.slot.endAt,profile.slot.endAt);
 assert.equal(plan.publication.employeeId,identity.employeeId);assert.equal(plan.publication.employeeAuthUserId,identity.employeeAuthUserId);
}
export async function verifyPeriodDelegatedMixedNative(ctx){
 const {d,h,native,scope,archive,oldArchive,periodArchive}=ctx;
 assert.equal(d?.syntheticOnly,true);assert.equal(h?.syntheticOnly,true);assert.equal(typeof native.connect,'function');
 assert.deepEqual(assertLifecycleSandbox(sql=>native.query(scope.sql(sql))),d.owned);assert.equal(scope.schema,d.owned.schema);
 const before=d.fingerprint(),defs=d.definitions(),catalog=d.tableCatalog(),names=d.inventory();
 const old155=delegatedMixedArchiveBytes(archive()),old207=delegatedMixedArchiveBytes(periodArchive());
 assert.deepEqual(old155,delegatedMixedArchiveBytes(oldArchive));for(const name of delegatedMixedWriteTables)assert(names.includes(name),name);
 const site=quote(d.site),worker=quote(h.workerId),employee=quote(h.employeeId),auth=quote(h.employeeAuthUserId),pid=sourceIds.period;
 const delegate=uid(1),delegateAuth=uid(2),role=uid(3),grantId=uid(4),leaveId=uid(5),prefix=serialization+d.guard;
 //Point-read the original204 identities/date:207 h.slot is another sealed day.
 const profile=JSON.parse(d.exec(prefix+`select jsonb_build_object('session',public.faolla_attendance_period_session_v1(${site},${worker},${quote(sourceIds.start)},${employee},${auth},clock_timestamp()),
  'originalSession',public.faolla_attendance_period_session_v1(${site},${worker},${quote(id(174704))},${employee},${auth},clock_timestamp()),
  'originalEventIdentities',(select jsonb_agg(jsonb_build_object('eventId',ev.id,'operationId',ev.operation_id,'workerId',ev.worker_id,
    'actorEmployeeId',ev.actor_employee_id,'source',ev.source) order by ev.sequence) from public.merchant_attendance_events ev
    where ev.merchant_id=${site} and ev.worker_id=${worker} and ev.id in(${quote(id(174704))},${quote(id(174705))})),
  'period',(select to_jsonb(p) from public.merchant_attendance_period_closures p where p.merchant_id=${site} and p.period_id=${quote(pid)} and p.worker_id=${worker}),
  'slot',(select public.faolla_attendance_self_schedule_slot_v1(s)->'slot' from public.merchant_attendance_schedule_slots s where s.merchant_id=${site} and s.id=${quote(sourceIds.slot)} and s.worker_id=${worker}),
  'missing',(select jsonb_build_object('requestId',m.request_id,'approvalOperationId',approval.operation_id,
    'startAt',to_char(m.start_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'endAt',to_char(m.end_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
   from public.merchant_attendance_missing_current_v1 m join public.merchant_attendance_missing_entries approval
    on approval.merchant_id=m.merchant_id and approval.request_id=m.request_id and approval.action='approve' and approval.revision=2
   where m.merchant_id=${site} and m.worker_id=${worker} and m.employee_id=${employee}
    and m.actor_auth_user_id=${auth} and coalesce(m.root_request_id,m.request_id)=${quote(sourceIds.missing)}),
  'from',to_char((clock_timestamp()-interval '1 minute') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'until',to_char((clock_timestamp()+interval '1 day') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));`));
 assert(profile.session&&profile.originalSession&&profile.period&&profile.slot&&profile.missing,'delegated_mixed_exact204_sources');
 assert.equal(profile.period.sealed,false);assert.equal(profile.period.state,'open');assert.equal(profile.period.employee_id,h.employeeId);
 assert.equal(profile.period.employee_auth_user_id,h.employeeAuthUserId);assert.notEqual(profile.period.period_id,ctx.periodId);
 assertDelegatedMixedSourceProofs(profile,h);assert.equal(profile.missing.requestId,sourceIds.missing);
 assert.deepEqual(profile.originalSession.item.events.map(e=>[e.id,e.sequence,e.action]),[[id(174704),1,'clock_in'],[id(174705),2,'clock_out']]);
 assert.equal(Date.parse(profile.originalSession.item.events[1].occurredAt)-Date.parse(profile.originalSession.item.events[0].occurredAt),4800000);
 const interval=delegatedMixedInterval(profile.session.item.events,profile.missing),day=interval.startAt.slice(0,10);
 assert.equal(profile.period.from_date,day);assert.equal(profile.period.through_date,day);assert.equal(profile.slot.workDate,day);assert.equal(profile.slot.timeZone,'UTC');
 assert.equal(d.fingerprint(),before,'delegated_mixed_profile_wrote');
 const {executePeriodDelegation}=require('../../src/lib/merchantAttendancePeriodDelegation.server.ts');
 const {executePeriodDelegatedClosures}=require('../../src/lib/merchantAttendancePeriodDelegatedClosure.server.ts');
 const {executePeriodClosuresV2}=require('../../src/lib/merchantAttendancePeriodClosureV2.server.ts');
 const {parseLeaveResult}=require('../../src/lib/merchantAttendanceLeave.ts');
 const fullHash=outageNativeFingerprintSql(names),snapTables=delegatedMixedWriteTables.filter(n=>!['merchant_attendance_period_closures','merchant_attendance_period_storage'].includes(n));
 const snapshot=`jsonb_build_object(${snapTables.map(n=>`${quote(n)},(select coalesce(jsonb_agg(to_jsonb(original_row)),'[]') from public.${n} original_row)`).join(',')})`;
 const preserve=snapTables.map(n=>`assert not exists(select old.value from jsonb_array_elements(current_setting('faolla.dm234_original')::jsonb->${quote(n)}) old(value)
  except select to_jsonb(original_row) from public.${n} original_row),'delegated_mixed_old_row:${n}';`).join('\n');
 const immutablePeriod=`(select to_jsonb(p)-array['revision','current_version','state','sealed','confirmed_version','unresolved_dispute','updated_at']
  from public.merchant_attendance_period_closures p where p.merchant_id=${site} and p.period_id=${quote(pid)})`;
 const connection=native.connect();let steps=0,reads=0,writes=0,rejections=0,serial=100,stage='begin',rolledBack=false,lastRpc=null,result;
 const failures=[];
 const step=async(label,sql)=>{stage=label;assert(++steps<=100,'delegated_mixed_max100_steps');return connection.step(scope.sql((label==='begin'?'begin;':'')+prefix+sql));};
 const outside=allow=>`(select md5(jsonb_object_agg(table_name,rows order by table_name)::text) from (${names.map(n=>
  `select ${quote(n)} table_name,(select coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),'[]') from public.${n} r${allow[n]?` where (${allow[n]}) is not true`:''}) rows`).join(' union all ')}) protected_facts)`;
 const allowance=(name,c)=>{
  if(!c)return{};const op=quote(c.operationId),row=`r.merchant_id=${site} and r.operation_id=${op}`;
  if(name==='faolla_attendance_period_delegation_v1')return{merchant_attendance_period_delegations:`r.merchant_id=${site} and r.grant_id=${op}`};
  if(name==='faolla_attendance_leave_v1')return{merchant_attendance_leave_entries:row,...(c.action==='submit'?{merchant_attendance_leave_requests:`r.merchant_id=${site} and r.request_id=${op}`}:{})};
  return{merchant_attendance_period_closures:`r.merchant_id=${site} and r.period_id=${quote(pid)}`,merchant_attendance_period_storage:`r.merchant_id=${site}`,
   merchant_attendance_period_entries:row,merchant_attendance_period_versions:row,merchant_attendance_period_delegation_operations:row,
   merchant_attendance_period_artifacts:`r.merchant_id=${site} and r.artifact_id=${op}`,merchant_attendance_period_artifact_metadata:`r.merchant_id=${site} and r.artifact_id=${op}`};
 };
 const invoke=async(name,args,expression)=>{
  const c=args.p_command??null,allowed=allowance(name,c),protectedHash=outside(allowed);
  const value=JSON.parse(await step('rpc_'+name+'_'+(c?.action??args.p_query.mode??'source'),`do $dm_rpc$ declare all_before text;other_before text;answer jsonb;failure text;failure_context text;begin
   all_before:=${fullHash};other_before:=${protectedHash};
   begin set local role service_role;assert current_user='service_role';answer:=${expression};set constraints all immediate;set constraints all deferred;
    exception when others then get stacked diagnostics failure=message_text,failure_context=pg_exception_context;end;reset role;
   if failure is not null or ${c===null} then assert ${fullHash}=all_before,'delegated_mixed_read_or_rejection_wrote';end if;
   assert ${protectedHash}=other_before,'delegated_mixed_write_outside_exact_scope';${preserve}
   assert ${immutablePeriod}=current_setting('faolla.dm234_frame')::jsonb,'delegated_mixed_period_frame_changed';
   assert (select used_bytes from public.merchant_attendance_period_storage where merchant_id=${site})=(select coalesce(sum(artifact_bytes),0) from public.merchant_attendance_period_artifacts where merchant_id=${site}),'delegated_mixed_budget_not_exact';
   perform set_config('faolla.dm234_result',jsonb_build_object('value',answer,'error',failure,'context',failure_context)::text,true);
  end;$dm_rpc$;select current_setting('faolla.dm234_result')::jsonb;`));lastRpc=value;
  if(value.error){rejections++;return{data:null,error:{message:value.error}};}if(c)writes++;else reads++;return{data:value.value,error:null};
 };
 const rpc=async(name,args)=>{
  assert(['faolla_attendance_period_delegation_v1','faolla_attendance_period_delegated_closure_v1','faolla_attendance_period_closure_v2','faolla_attendance_period_closure_source_v1'].includes(name));
  assert.equal(args.p_query.siteId,d.site);assert([d.owner,delegateAuth,h.employeeAuthUserId].includes(args.p_auth_user_id));
  const params=[json(args.p_query),quote(args.p_auth_user_id)];
  if(name!=='faolla_attendance_period_closure_source_v1'){params.push(json(args.p_command));if(name!=='faolla_attendance_period_delegation_v1')params.push(json(args.p_artifact));params.push(String(args.p_allow_write));}
  return invoke(name,args,`public.${name}(${params.join(',')})`);
 };
 const q=(mode='detail',patch={})=>({siteId:d.site,access:'delegate',grantId,workerId:h.workerId,fromDate:day,throughDate:day,mode,periodId:pid,operationId:null,version:null,cursor:null,...patch});
 const run=(query,command=null,moduleEnabled=true)=>executePeriodDelegatedClosures({query,command,authUserId:delegateAuth,moduleEnabled},{rpc});
 const oldq=access=>({siteId:d.site,access,workerId:h.workerId,fromDate:day,throughDate:day,mode:'detail',periodId:pid,operationId:null,version:null,cursor:null});
 const original=(access,command=null)=>executePeriodClosuresV2({query:oldq(access),command,authUserId:access==='owner'?d.owner:h.employeeAuthUserId,moduleEnabled:true},{rpc});
 const cmd=(action,head,fp=null)=>({action,operationId:uid(++serial),periodId:pid,expectedRevision:head.revision,expectedVersion:head.currentVersion,expectedFingerprint:fp,reason:'Synthetic234 explicit mixed '+action});
 const lq=(access='self',requestId=null)=>({siteId:d.site,access,requestId,operationId:null,beforeAt:null,beforeId:null});
 const leave=async(query,command=null)=>{const who=query.access==='owner'?d.owner:h.employeeAuthUserId;
  const value=await invoke('faolla_attendance_leave_v1',{p_query:query,p_command:command},`public.faolla_attendance_leave_v1(${json(query)},${quote(who)},${json(command)},true)`);
  assert.equal(value.error,null,JSON.stringify(lastRpc));return parseLeaveResult(value.data,query,command,who);
 };
 const mixed=artifact=>assertDelegatedMixedReport(artifact,profile,h);
 try{
  await step('begin',`set local lock_timeout='3s';set local statement_timeout='10s';do $dm_seed$ declare old_hash text;original_rows jsonb;begin
   assert not exists(select 1 from public.merchant_enterprise_employees where id=${quote(delegate)} or auth_user_id=${quote(delegateAuth)});
   assert not exists(select 1 from public.merchant_enterprise_roles where id=${quote(role)});
   assert not exists(select 1 from public.merchant_attendance_period_delegations where grant_id=${quote(grantId)});
   assert not exists(select 1 from public.merchant_attendance_leave_requests where request_id=${quote(leaveId)});
   assert exists(select 1 from public.merchant_attendance_period_closures where merchant_id=${site} and period_id=${quote(ctx.periodId)} and sealed),'delegated_mixed_old207_sealed';
   original_rows:=${snapshot};assert octet_length(original_rows::text)<=4194304;perform set_config('faolla.dm234_original',original_rows::text,true);
   perform set_config('faolla.dm234_frame',${immutablePeriod}::text,true);
   old_hash:=${outside({merchant_enterprise_roles:`r.merchant_id=${site} and r.id=${quote(role)}`,merchant_enterprise_employees:`r.merchant_id=${site} and r.id=${quote(delegate)}`,
    merchant_enterprise_audit_events:`r.merchant_id=${site} and r.entity_id in(${quote(role)},${quote(delegate)})`})};
   insert into public.merchant_enterprise_roles(id,merchant_id,name,permissions) values(${quote(role)},${site},'Synthetic234 mixed supervisor',array['enterprise.view','attendance.period.view','attendance.period.send','attendance.period.seal']);
   insert into public.merchant_enterprise_employees(id,merchant_id,auth_user_id,email,display_name,role_id,status,accepted_at,version)
    values(${quote(delegate)},${site},${quote(delegateAuth)},'synthetic234-mixed@example.test','Synthetic234 mixed supervisor',${quote(role)},'active',clock_timestamp(),1);
   assert old_hash=${outside({merchant_enterprise_roles:`r.merchant_id=${site} and r.id=${quote(role)}`,merchant_enterprise_employees:`r.merchant_id=${site} and r.id=${quote(delegate)}`,
    merchant_enterprise_audit_events:`r.merchant_id=${site} and r.entity_id in(${quote(role)},${quote(delegate)})`})};${preserve}
  end;$dm_seed$;`);
  await executePeriodDelegation({query:{siteId:d.site,access:'owner',mode:'list',catalog:null,grantId:null,afterId:null,operationId:null},authUserId:d.owner,allowWrite:true,
   command:{action:'grant',operationId:grantId,delegateEmployeeId:delegate,delegateAuthUserId:delegateAuth,workerId:h.workerId,employeeId:h.employeeId,employeeAuthUserId:h.employeeAuthUserId,
    fromDate:day,throughDate:day,actions:['view','send','seal'],includeExisting:true,validFrom:profile.from,validUntil:profile.until,reason:'Synthetic234 one existing mixed period'}},{rpc});
  const baseline=await run(q('preview'));assert.equal(baseline.kind,'preview');mixed(baseline.preview.artifact);
  const home=await leave(lq());assert.equal(home.canSubmit,true);
  await leave(lq(),{action:'submit',operationId:leaveId,expectedWorkerId:h.workerId,expectedSettingsVersion:home.settingsVersion,...interval,reason:'Synthetic234 one-minute internal leave'});
  const pending=await run(q('preview'));mixed(pending.preview.artifact);assert(pending.preview.blockers.includes('pending_leave'));
  assert.notEqual(pending.preview.artifact.sourceFingerprint,baseline.preview.artifact.sourceFingerprint);
  assert.deepEqual(pending.preview.artifact.report.totals,baseline.preview.artifact.report.totals);
  const send=cmd('send',pending.preview.period,pending.preview.artifact.sourceFingerprint),saved=await run(q(),send);assert.equal(saved.kind,'receipt');assert(saved.receipt);
  let detail=await run(q());assert.equal(detail.artifact.protocol,'attendance-period-artifact-v2');mixed(detail.artifact);
  assert.equal(detail.artifact.authority.grantId,grantId);assert.equal(detail.artifact.authority.actorEmployeeId,delegate);assert.equal(detail.artifact.authority.actorAuthUserId,delegateAuth);
  const body=JSON.stringify(detail.artifact),fp=detail.artifact.sourceFingerprint;
  assert.equal(JSON.stringify((await original('owner')).artifact),body);assert.equal(JSON.stringify((await original('self')).artifact),body);
  await original('self',cmd('confirm',detail.period,fp));detail=await run(q());assert.equal(detail.period.confirmedVersion,detail.period.currentVersion);
  const review=(await leave(lq('owner',leaveId))).detail;assert.equal(review.status,'submitted');assert(review.canApprove);
  const approved=await leave(lq('owner',leaveId),{action:'approve',operationId:uid(++serial),requestId:leaveId,expectedRevision:review.revision,reason:'Synthetic234 explicit owner approval'});
  assert.equal(approved.detail.status,'approved');
  const changed=await run(q());assert.equal(changed.sourceChanged,true);assert.equal(JSON.stringify(changed.artifact),body);
  await assert.rejects(run(q(),cmd('seal',changed.period,fp)),error=>error.code==='attendance_period_source_changed');
  const current=await run(q('preview'));mixed(current.preview.artifact);assert.notEqual(current.preview.artifact.sourceFingerprint,fp);
  assert(!current.preview.blockers.includes('pending_leave'));assert.deepEqual(current.preview.artifact.report.totals,pending.preview.artifact.report.totals);
  assert.deepEqual((await run(q('recover',{operationId:send.operationId}),null,false)).receipt,saved.receipt);
  assert.equal(JSON.stringify((await original('owner')).artifact),body);assert.equal(JSON.stringify((await original('self')).artifact),body);
  await step('final_old_rows',`do $dm_final$ begin ${preserve}
   assert exists(select 1 from public.merchant_attendance_period_closures where merchant_id=${site} and period_id=${quote(ctx.periodId)} and sealed);
   assert exists(select 1 from public.merchant_attendance_period_closures where merchant_id=${site} and period_id=${quote(pid)} and not sealed);
  end;$dm_final$;set constraints all immediate;`);
  await step('rollback','rollback;');rolledBack=true;
  result={phase:234,steps,reads,writes,rejections,actualMixedDelegatedPreview:true,recordedSessions:2,approvedMissingSources:1,scheduleSlots:1,
   recordedWorkedUs:5100000000,missingWorkedUs:300000000,selectedWorkedUs:5400000000,existingRecordedSession:true,existingApprovedMissing:true,existingSchedule:true,
   actualGrant:true,actualDelegatedSend:true,oldOwnerSelfReadSavedV2:true,actualSelfConfirmation:true,actualLeaveSubmissionAndApproval:true,
   sourceChanged:true,staleSealRejectedZeroWrites:true,originalReceiptPreserved:true,workedTotalsUnchanged:true,oldArchiveBytesPreserved:true,
   originalFactsPreserved:true,rollbackRestored:true,syntheticIdentitySeed:true,historicalClockRowsSynthetic:true,
   original174IdentityProof:'137-relation-and-140-fixed-adoption',session204IdentityProof:'135-unverified-binding',realAuth:false,browser:false,callerOwnsRuntimeAndCleanup:true};
 }catch(error){failures.push(new Error(`delegated_mixed:${stage}:${String(error?.stack??error)}:${JSON.stringify(lastRpc?.error?lastRpc:null)}`,{cause:error}));}
 finally{
  if(!rolledBack)try{await connection.step('rollback;');}catch(error){failures.push(error);}
  try{await connection.close();}catch(error){failures.push(error);}
  for(const verify of [()=>assert.equal(d.fingerprint(),before,'delegated_mixed_rollback_facts'),()=>assert.equal(d.definitions(),defs,'delegated_mixed_rollback_definitions'),
   ()=>assert.equal(d.tableCatalog(),catalog,'delegated_mixed_rollback_catalog'),()=>assert.deepEqual(delegatedMixedArchiveBytes(archive()),old155),()=>assert.deepEqual(delegatedMixedArchiveBytes(periodArchive()),old207)]){
   try{verify();}catch(error){failures.push(error);}
  }
 }
 if(failures.length)throw new AggregateError(failures,'delegated_mixed_failed:'+failures.map(e=>String(e.message).slice(0,4000)).join(' | '),{cause:failures[0]});
 return result;
}
