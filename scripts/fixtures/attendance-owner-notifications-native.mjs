//236 INERT. Real source writers and strict Node projectors in one caller-owned
//bounded transaction. Synthetic identities already belong to the parent; no
//source/history row is fabricated, no background process or database is opened.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {assertLifecycleSandbox,lifecycleId as id,lifecycleJson as json} from '../merchant-attendance-lifecycle-native-support.mjs';
import {quote} from './attendance-bound-clocks-native.mjs';
import {outageNativeFingerprintSql} from './attendance-outage-native.mjs';
import {periodContinuationArchiveBytes,periodContinuationSerialization} from './attendance-period-continuation-native.mjs';

const require=createRequire(import.meta.url),uid=n=>id(236400000+n),table=n=>'merchant_attendance_'+n;
const mutablePeriod=['revision','current_version','state','sealed','confirmed_version','unresolved_dispute','updated_at'];
export const ownerNotificationsNativeTables=Object.freeze([table('owner_notifications'),table('owner_notification_reads'),table('owner_notification_operations')]);
export function ownerNotificationsNativePlan(){return {oldNote:uid(1),oldDispute:uid(2),note:uid(3),disputeV1:uid(3),disputeV2:uid(4),
 page:Array.from({length:23},(_,i)=>uid(10+i)),mark:uid(100),markAgain:uid(101),failed:uid(200),probe:uid(201),otherOwner:uid(900),otherAuth:uid(901)};}
export function ownerNotificationsNativeHash(names,{site,periodId,exceptions={}}){
 assert(/^\d{8}$/.test(site)&&names.length&&new Set(names).size===names.length);
 return `(select md5(jsonb_object_agg(on_name,on_rows order by on_name)::text) from (${names.map(name=>{
  assert(/^(?:merchants|faolla_schema_migrations|merchant_[a-z0-9_]+)$/.test(name)&&name.length<=63);
  const projected=name===table('period_closures')?`case when t.merchant_id=${quote(site)} and t.period_id=${quote(periodId)} then to_jsonb(t)-array[${mutablePeriod.map(quote).join(',')}] else to_jsonb(t) end`:'to_jsonb(t)';
  return `select ${quote(name)} on_name,(select coalesce(jsonb_agg(${projected} order by (${projected})::text),'[]') from public.${name} t${exceptions[name]?` where (${exceptions[name]}) is not true`:''}) on_rows`;
 }).join(' union all ')}) on_facts)`;
}
export function ownerNotificationsNativeQuery(siteId,mode='list',extra={}){return {siteId,mode,notificationId:null,operationId:null,beforeAt:null,beforeId:null,...extra};}
export function assertOwnerNotificationSource(item,{siteId,workerId,employeeId,employeeAuthUserId,caseId,slotId,periodId,fromDate,throughDate}){
 void siteId;assert.equal(item.workerId,workerId);assert.equal(item.employeeId,employeeId);assert.equal(item.employeeAuthUserId,employeeAuthUserId);
 if(item.sourceCategory==='plan_exception'){assert.equal(item.sourceId,caseId);assert.deepEqual(item.target,{slotId});}
 else{assert.equal(item.sourceCategory,'period');assert.equal(item.sourceId,periodId);assert.deepEqual(item.target,{periodId,fromDate,throughDate});}
 assert(!Object.hasOwn(item,'note')&&!Object.hasOwn(item,'reason')&&!Object.hasOwn(item,'evidence'));
}
export async function verifyOwnerNotificationsNative(ctx){
 const {d,h,native,scope,archive,oldArchive,periodArchive,periodId,pq}=ctx;
 assert(d?.syntheticOnly===true&&h?.syntheticOnly===true,'owner_notifications_owned_synthetic_context_required');
 assert.deepEqual(assertLifecycleSandbox(sql=>native.query(scope.sql(sql))),d.owned);assert.equal(scope.schema,d.owned.schema);assert.equal(typeof native.connect,'function');
 const {executePlanExceptions}=require('../../src/lib/merchantAttendancePlanExceptions.server.ts');
 const {executePeriodClosures}=require('../../src/lib/merchantAttendancePeriodClosure.server.ts');
 const {executePeriodClosuresV2}=require('../../src/lib/merchantAttendancePeriodClosureV2.server.ts');
 const {parseOwnerNotificationsResult}=require('../../src/lib/merchantAttendanceOwnerNotifications.ts');
 const {executeOwnerNotifications}=require('../../src/lib/merchantAttendanceOwnerNotifications.server.ts');
 const names=d.inventory(),p=ownerNotificationsNativePlan(),site=quote(d.site),pid=quote(periodId);
 for(const name of ownerNotificationsNativeTables)assert(names.includes(name),name);
 const facts=d.fingerprint(),definitions=d.definitions(),catalog=d.tableCatalog(),old155=periodContinuationArchiveBytes(await archive()),old207=periodContinuationArchiveBytes(await periodArchive());
 assert.deepEqual(old155,periodContinuationArchiveBytes(oldArchive));
 const noteIds=[p.oldNote,p.note],periodIds=[p.oldDispute,p.disputeV1,p.disputeV2,...p.page],marks=[p.mark,p.markAgain];
 const inSite=where=>`t.merchant_id=${site} and (${where})`,inIds=(field,ids)=>`${field} in(${ids.map(quote).join(',')})`;
 const exceptions={
  [table('plan_exception_entries')]:inSite(inIds('t.operation_id',noteIds)),
  [table('period_entries')]:inSite(`t.period_id=${pid} and ${inIds('t.operation_id',periodIds)}`),
  [table('owner_notifications')]:inSite(`(t.source_category='plan_exception' and ${inIds('t.operation_id',noteIds)}) or (t.source_category='period' and t.source_id=${pid} and ${inIds('t.operation_id',periodIds)})`),
  [table('owner_notification_reads')]:inSite(`exists(select 1 from public.merchant_attendance_owner_notifications z where z.merchant_id=t.merchant_id and z.notification_id=t.notification_id and z.source_category='plan_exception' and z.operation_id=${quote(p.note)})`),
  [table('owner_notification_operations')]:inSite(inIds('t.operation_id',marks)),
 };
 const outside=ownerNotificationsNativeHash(names,{site:d.site,periodId,exceptions}),fullHash=outageNativeFingerprintSql(names);
 const oldGuard=`assert ${outside}=current_setting('faolla.owner236_outside'),'owner_notifications_old_row_changed';`;
 const newRows=`jsonb_build_object(${Object.entries(exceptions).map(([name,where])=>`${quote(name)},(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]') from public.${name} t where ${where})`).join(',')})`;
 const state={accepted:new Map(),previous:null,periodHead:null,caseRevision:null,caseId:null,slotId:null};
 const fingerprintFields=['merchant_id','period_id','worker_id','employee_id','employee_auth_user_id','from_date','through_date','time_zone','start_at','end_at','opened_at'];
 const keys=['FAOLLA_ATTENDANCE_OWNER_NOTIFICATIONS_CAPTURE_ENABLED','FAOLLA_ATTENDANCE_OWNER_NOTIFICATIONS_CAPTURE_SITES'];
 const prior=keys.map(k=>process.env[k]);const capture=value=>{process.env[keys[0]]=value?'1':'0';process.env[keys[1]]=d.site;};
 const connection=native.connect(),prefix=periodContinuationSerialization+d.guard,failures=[];
 let stage='begin',steps=0,reads=0,writes=0,rejections=0,replays=0,probes=0,roleAssertions=0,lastRpc=null,lastStepFailure=null,rolledBack=false,result,profile;
 const step=async(label,sql)=>{stage=label;assert(++steps<=100,'owner_notifications_max100_steps');try{return await connection.step(scope.sql((label==='begin'?'begin;':'')+prefix+sql));}
  catch(error){lastStepFailure={stage:label,detail:String(error?.stack??error).slice(0,6000)};throw new Error(`owner_notifications_step:${label}:${String(error?.message??error)}`,{cause:error});}};
 const proofSql=`jsonb_build_object('rows',${newRows},'period',(select to_jsonb(t) from public.merchant_attendance_period_closures t where merchant_id=${site} and period_id=${pid}),
  'owner',(select user_id from public.merchants where id=${site}))`;
 const check=proof=>{
  assert.equal(proof.owner,d.owner);assert(proof.period);
  if(state.periodHead)for(const key of fingerprintFields)assert.deepEqual(proof.period[key],state.periodHead[key],key);
  const accepted=[...state.accepted.values()],note=accepted.filter(x=>x.category==='plan_exception'),period=accepted.filter(x=>x.category==='period'),mark=accepted.filter(x=>x.category==='mark');
  const exact=(name,field,ids)=>assert.deepEqual(proof.rows[table(name)].map(r=>r[field]).sort(),[...ids].sort(),name);
  exact('plan_exception_entries','operation_id',note.map(x=>x.command.operationId));exact('period_entries','operation_id',period.map(x=>x.command.operationId));
  exact('owner_notification_operations','operation_id',mark.map(x=>x.command.operationId));
  const events=proof.rows[table('owner_notifications')],expected=accepted.filter(x=>x.capture);
  assert.deepEqual(events.map(x=>x.source_category+':'+x.operation_id).sort(),expected.map(x=>x.category+':'+x.command.operationId).sort());
  for(const item of events){const source=expected.find(x=>x.category===item.source_category&&x.command.operationId===item.operation_id);assert(source);
   assert.equal(item.recipient_auth_user_id,d.owner);assert.equal(item.employee_id,h.employeeId);assert.equal(item.employee_auth_user_id,h.employeeAuthUserId);assert.equal(item.worker_id,h.workerId);
   assert.equal(item.source_revision,source.command.expectedRevision+1);assert.equal(item.source_id,source.category==='period'?periodId:state.caseId);
   const entry=proof.rows[table(source.category==='period'?'period_entries':'plan_exception_entries')].find(x=>x.operation_id===item.operation_id);assert(entry);
   assert.equal(item.occurred_at,entry.recorded_at);
   assert.deepEqual(item.target,source.category==='period'?{periodId,fromDate:state.periodHead.from_date,throughDate:state.periodHead.through_date}:{slotId:state.slotId});
  }
  for(const item of [...proof.rows[table('period_entries')],...proof.rows[table('plan_exception_entries')]]){
   const source=accepted.find(x=>x.category===(item.kind?'plan_exception':'period')&&x.command.operationId===item.operation_id);assert(source);
   assert.deepEqual(item.command,source.command);assert.equal(item.actor_auth_user_id,h.employeeAuthUserId);assert.equal(item.revision,source.command.expectedRevision+1);
  }
  if(state.periodHead){assert.equal(proof.period.revision,state.periodHead.revision+period.length);assert.equal(proof.period.current_version,state.periodHead.current_version);
   assert.equal(proof.period.sealed,true);assert.equal(proof.period.state,'sealed');assert.equal(proof.period.confirmed_version,state.periodHead.confirmed_version);
   assert.equal(proof.period.unresolved_dispute,period.length?true:state.periodHead.unresolved_dispute);
   assert.equal(proof.period.updated_at,period.length?proof.rows[table('period_entries')].find(x=>x.revision===proof.period.revision).recorded_at:state.periodHead.updated_at);}
  const readRows=proof.rows[table('owner_notification_reads')];assert.equal(readRows.length,mark.length?1:0);
  for(const row of readRows){assert.equal(row.recipient_auth_user_id,d.owner);assert.equal(row.notification_id,mark[0].command.notificationId);}
  for(const op of proof.rows[table('owner_notification_operations')]){const request=mark.find(x=>x.command.operationId===op.operation_id);assert.deepEqual(op.command,request.command);
   assert.equal(op.actor_auth_user_id,d.owner);assert.equal(op.notification_id,request.command.notificationId);assert.equal(op.read_at,readRows[0].read_at);}
  if(state.previous)for(const [name,rows]of Object.entries(state.previous.rows))for(const old of rows)assert(proof.rows[name].some(value=>JSON.stringify(value)===JSON.stringify(old)),'owner_notifications_new_row_changed:'+name);
  state.previous=proof;
 };
 const argKeys=name=>name==='faolla_attendance_owner_notifications_v1'?['p_query','p_auth_user_id','p_command','p_allow_write']:
  name.includes('plan_exception')?['p_query','p_auth_user_id','p_command','p_allow_write','p_allow_posthoc','p_allow_clearance','p_capture_notifications',...(name.includes('_owner_event_')?['p_capture_owner_notifications']:[])]:
   name==='faolla_attendance_period_closure_source_v1'?['p_query','p_auth_user_id']:['p_query','p_auth_user_id','p_command','p_artifact','p_allow_write',...(name.includes('_owner_event_')?['p_capture_owner_notifications']:[])];
 const expression=(name,args)=>`public.${name}(${argKeys(name).map(k=>k==='p_auth_user_id'?quote(args[k]):typeof args[k]==='boolean'?String(args[k]):json(args[k])).join(',')})`;
 const rpc=async(name,args)=>{
  assert(['faolla_attendance_owner_notifications_v1','faolla_attendance_plan_exception_posthoc_review_v1','faolla_attendance_plan_exception_owner_event_v1',
   'faolla_attendance_period_closure_v1','faolla_attendance_period_closure_v2','faolla_attendance_period_closure_owner_event_v1','faolla_attendance_period_closure_owner_event_v2','faolla_attendance_period_closure_source_v1'].includes(name),name);
  assert.deepEqual(Object.keys(args).sort(),argKeys(name).sort());assert.equal(args.p_query.siteId,d.site);assert([d.owner,h.employeeAuthUserId].includes(args.p_auth_user_id));
  assert.equal(scope.sql(json(args)),json(args),'owner_notifications_literal_schema_rewrite');
  const command=args.p_command??null,category=name.includes('plan_exception')?'plan_exception':name==='faolla_attendance_owner_notifications_v1'?'mark':'period';
  const key=command?category+':'+command.operationId:null,replay=key!==null&&state.accepted.has(key),fresh=command&&!replay;
  const callExceptions={};if(fresh){
   if(category==='mark'){callExceptions[table('owner_notification_operations')]=inSite(`t.operation_id=${quote(command.operationId)}`);
    callExceptions[table('owner_notification_reads')]=inSite(`t.notification_id=${quote(command.notificationId)}`);}
   else{callExceptions[table(category==='period'?'period_entries':'plan_exception_entries')]=inSite(`t.operation_id=${quote(command.operationId)}`);
    if(args.p_capture_owner_notifications)callExceptions[table('owner_notifications')]=inSite(`t.source_category=${quote(category)} and t.operation_id=${quote(command.operationId)}`);}
  }
  const allowed=ownerNotificationsNativeHash(names,{site:d.site,periodId,exceptions:callExceptions});
  const output=JSON.parse(await step('rpc_'+category+'_'+(command?.action??args.p_query.mode),`do $on_rpc$ declare on_before text;on_allowed text;on_answer jsonb;on_error text;on_state text;on_context text;begin
   ${oldGuard}on_before:=${fullHash};on_allowed:=${allowed};begin set local role service_role;assert current_user='service_role';
    on_answer:=${expression(name,args)};set constraints all immediate;set constraints all deferred;
   exception when others then get stacked diagnostics on_error=message_text,on_state=returned_sqlstate,on_context=pg_exception_context;end;reset role;
   if on_error is not null or ${!fresh?'true':'false'} then assert ${fullHash}=on_before,'owner_notifications_read_replay_rejection_wrote';
   else assert ${allowed}=on_allowed,'owner_notifications_operation_scope_changed';end if;${oldGuard}
   perform set_config('faolla.owner236_result',jsonb_build_object('value',on_answer,'error',on_error,'sqlstate',on_state,'context',on_context,'proof',${proofSql})::text,true);
  end;$on_rpc$;select current_setting('faolla.owner236_result')::jsonb;`));lastRpc={name,args,...output};roleAssertions++;
  if(!output.error&&fresh)state.accepted.set(key,{category,command,capture:args.p_capture_owner_notifications===true});
  check(output.proof);
  if(output.error){rejections++;return {data:null,error:{message:output.error}};}
  if(replay)replays++;else if(command)writes++;else reads++;return {data:output.value,error:null};
 };
 // One savepoint-like PL/pgSQL subtransaction. The forced sentinel rolls back
 //both setup and any success, including audit/DDL; returned local variables are
 //only evidence. Do not issue an external connection read while locks are held.
 const probe=async(label,setup,body,expectedError=null)=>{
  const output=JSON.parse(await step(label,`do $on_probe$ declare on_before text;on_answer jsonb;on_error text;on_state text;begin
   ${oldGuard}on_before:=${fullHash};begin ${setup} set local role service_role;assert current_user='service_role';${body}
    set constraints all immediate;raise exception 'owner236_probe_rollback';
   exception when others then get stacked diagnostics on_error=message_text,on_state=returned_sqlstate;
    if on_error='owner236_probe_rollback' then on_error:=null;end if;end;reset role;
   assert ${fullHash}=on_before,'owner_notifications_probe_not_rolled_back';${oldGuard}
   perform set_config('faolla.owner236_probe',jsonb_build_object('value',on_answer,'error',on_error,'sqlstate',on_state)::text,true);
  end;$on_probe$;select current_setting('faolla.owner236_probe')::jsonb;`));probes++;roleAssertions++;
  assert.equal(output.error,expectedError,label);return output.value;
 };
 let noteQuery,periodQuery;
 const noticeQ=(mode='list',extra={})=>ownerNotificationsNativeQuery(d.site,mode,extra);
 const notice=(q=noticeQ(),c=null,allow=true)=>executeOwnerNotifications({query:q,command:c,authUserId:d.owner,allowWrite:allow},{rpc});
 const runNote=(c=null)=>executePlanExceptions({query:{...noteQuery,mode:c?'note':'detail',operationId:c?.operationId??null},command:c,authUserId:h.employeeAuthUserId,moduleEnabled:true},{rpc});
 const runPeriod=(version=2,c=null)=>{
  const input={query:version===1?Object.fromEntries(Object.entries(periodQuery).filter(([k])=>k!=='cursor')):periodQuery,command:c,authUserId:h.employeeAuthUserId,moduleEnabled:true};
  return (version===1?executePeriodClosures:executePeriodClosuresV2)(input,{rpc});
 };
 const dispute=(operationId,head)=>({action:'dispute',operationId,periodId,expectedRevision:head.period.revision,expectedVersion:head.period.currentVersion,expectedFingerprint:null,reason:'Synthetic236 employee dispute; no actual employee consent'});
 const note=(operationId,head)=>({operationId,expectedRevision:head.detail.revision,decisionOperationId:head.detail.latestDecision.operationId,note:'Synthetic236 explicit employee explanation'});
 try{
  capture(false);
  const frame=pq('detail','self',periodId);
  profile=JSON.parse(await step('begin',`set local lock_timeout='3s';set local statement_timeout='10s';do $on_begin$ begin
   assert not exists(select 1 from public.merchant_attendance_plan_exception_entries where operation_id between ${quote(uid(0))} and ${quote(uid(9999))})
    and not exists(select 1 from public.merchant_attendance_period_entries where operation_id between ${quote(uid(0))} and ${quote(uid(9999))}),'owner_notifications_operation_collision';
   assert not exists(select 1 from public.merchant_attendance_owner_notifications) and not exists(select 1 from public.merchant_attendance_owner_notification_reads)
    and not exists(select 1 from public.merchant_attendance_owner_notification_operations),'owner_notifications_new_ledgers_not_empty';
   perform set_config('faolla.owner236_outside',${outside},true);
  end;$on_begin$;
  select jsonb_build_object('proof',${proofSql},'case',(select to_jsonb(c) from public.merchant_attendance_plan_exception_cases c
   where c.merchant_id=${site} and c.worker_id=${quote(h.workerId)} and c.employee_id=${quote(h.employeeId)} and c.employee_auth_user_id=${quote(h.employeeAuthUserId)} order by c.opened_at desc,c.case_id desc limit 1));`));
  assert(profile.case,'owner_notifications_actual_case_required');assert(profile.proof.period.sealed);assert(profile.proof.period.revision<60&&profile.proof.period.current_version<=20,'owner_notifications_v1_safe_existing_head');
  state.periodHead=profile.proof.period;state.caseId=profile.case.case_id;state.slotId=profile.case.slot_id;check(profile.proof);
  assert.equal(profile.proof.period.worker_id,h.workerId);assert.equal(profile.proof.period.employee_id,h.employeeId);assert.equal(profile.proof.period.employee_auth_user_id,h.employeeAuthUserId);
  assert.equal(frame.fromDate,profile.proof.period.from_date);assert.equal(frame.throughDate,profile.proof.period.through_date);
  periodQuery={...frame,cursor:null};noteQuery={siteId:d.site,access:'self',mode:'detail',workerId:h.workerId,slotId:state.slotId,operationId:null,beforeAt:null,beforeId:null};
  let nh=await runNote(),ph=await runPeriod(1);assert(nh.detail.latestDecision&&nh.detail.revision<170);assert.equal(ph.period.sealed,true);
  const originalNote=note(p.oldNote,nh),originalDispute=dispute(p.oldDispute,ph);
  nh=await runNote(originalNote);assert.equal(lastRpc.name,'faolla_attendance_plan_exception_posthoc_review_v1');
  ph=await runPeriod(1,originalDispute);assert.equal(lastRpc.name,'faolla_attendance_period_closure_v1');assert.equal(ph.period.sealed,true);
  capture(true);const beforeOld=state.accepted.size;
  assert.deepEqual((await runNote(originalNote)).receipt,nh.receipt);assert.equal(lastRpc.name,'faolla_attendance_plan_exception_owner_event_v1');
  assert.deepEqual((await runPeriod(1,originalDispute)).operation,ph.operation);assert.equal(lastRpc.name,'faolla_attendance_period_closure_owner_event_v1');
  assert.equal(state.accepted.size,beforeOld);assert.equal(lastRpc.proof.rows[table('owner_notifications')].length,0);
  nh=await runNote(note(p.note,nh));assert.equal(lastRpc.name,'faolla_attendance_plan_exception_owner_event_v1');
  ph=await runPeriod(1,dispute(p.disputeV1,ph));assert.equal(lastRpc.name,'faolla_attendance_period_closure_owner_event_v1');
  ph=await runPeriod(2,dispute(p.disputeV2,ph));assert.equal(lastRpc.name,'faolla_attendance_period_closure_owner_event_v2');
  assert.equal(lastRpc.proof.rows[table('owner_notifications')].length,3,'same_operation_uuid_two_categories');
  //Constraint rejection is injected only inside a rolled-back subtransaction;
  //actual wrappers must roll back their original source entry/head as well.
  const fault=`alter table public.merchant_attendance_owner_notifications add constraint owner236_test_capture_failure check(false) not valid;`;
  const failureArgs={p_query:periodQuery,p_auth_user_id:h.employeeAuthUserId,p_command:dispute(p.failed,ph),p_artifact:null,p_allow_write:true,p_capture_owner_notifications:true};
  await probe('capture_failure_atomic',fault,`on_answer:=${expression('faolla_attendance_period_closure_owner_event_v2',failureArgs)};`,
   'new row for relation "merchant_attendance_owner_notifications" violates check constraint "owner236_test_capture_failure"');
  for(const operationId of p.page)ph=await runPeriod(2,dispute(operationId,ph));
  const firstPage=await notice();assert.equal(firstPage.items.length,25);assert(firstPage.nextCursor);
  const secondPage=await notice(noticeQ('list',{beforeAt:firstPage.nextCursor.at,beforeId:firstPage.nextCursor.id}));assert.equal(secondPage.items.length,1);assert.equal(secondPage.nextCursor,null);
  const items=[...firstPage.items,...secondPage.items];assert.equal(new Set(items.map(x=>x.notificationId)).size,26);
  const identity={siteId:d.site,workerId:h.workerId,employeeId:h.employeeId,employeeAuthUserId:h.employeeAuthUserId,caseId:state.caseId,slotId:state.slotId,
   periodId,fromDate:frame.fromDate,throughDate:frame.throughDate};items.forEach(item=>assertOwnerNotificationSource(item,identity));
  const noteItem=items.find(x=>x.sourceCategory==='plan_exception'),periodItem=items.find(x=>x.sourceCategory==='period');assert(noteItem&&periodItem);
  const detailQ=noticeQ('detail',{notificationId:noteItem.notificationId}),mark={action:'mark_read',operationId:p.mark,notificationId:noteItem.notificationId};
  const sourceQ={siteId:d.site,access:'self',workerId:h.workerId,fromDate:frame.fromDate,throughDate:frame.throughDate,periodId};
  const sourceBefore=await rpc('faolla_attendance_period_closure_source_v1',{p_query:sourceQ,p_auth_user_id:h.employeeAuthUserId});assert.equal(sourceBefore.error,null);
  const businessBefore=await step('read_business_hash',`select ${outageNativeFingerprintSql(names.filter(n=>!ownerNotificationsNativeTables.includes(n)))};`);
  assert.equal((await notice(detailQ)).item.readAt,null);const saved=await notice(detailQ,mark);assert(saved.receipt);
  assert.deepEqual((await notice(detailQ,mark)).receipt,saved.receipt);
  const again=await notice(detailQ,{...mark,operationId:p.markAgain});assert.equal(again.receipt.readAt,saved.receipt.readAt);
  const recoverQ=noticeQ('recover',{notificationId:noteItem.notificationId,operationId:p.mark});
  assert.deepEqual((await notice(recoverQ,null,false)).receipt,saved.receipt);
  await assert.rejects(notice(noticeQ('detail',{notificationId:periodItem.notificationId}),{...mark,notificationId:periodItem.notificationId}),e=>e.code==='attendance_operation_conflict');
  const off=await rpc('faolla_attendance_owner_notifications_v1',{p_query:detailQ,p_auth_user_id:d.owner,p_command:mark,p_allow_write:false});assert.equal(off.error?.message,'attendance_platform_paused');
  const sourceAfter=await rpc('faolla_attendance_period_closure_source_v1',{p_query:sourceQ,p_auth_user_id:h.employeeAuthUserId});assert.equal(sourceAfter.error,null);
  assert.equal(sourceBefore.data.sourceFingerprint,sourceAfter.data.sourceFingerprint);assert.deepEqual(sourceBefore.data.sourceCanonical,sourceAfter.data.sourceCanonical);
  assert.equal(await step('read_business_hash_after',`select ${outageNativeFingerprintSql(names.filter(n=>!ownerNotificationsNativeTables.includes(n)))};`),businessBefore);
  const noticeExpression=(q,c=null,auth=d.owner,allow=true)=>expression('faolla_attendance_owner_notifications_v1',{p_query:q,p_auth_user_id:auth,p_command:c,p_allow_write:allow});
  const handoff=`update public.merchants set user_id=${quote(p.otherOwner)} where id=${site};`;
  await probe('handoff_old_owner_no_body',handoff,`on_answer:=${noticeExpression(detailQ)};`,'attendance_access_denied');
  await probe('handoff_old_owner_no_mark',handoff,`on_answer:=${noticeExpression(detailQ,mark)};`,'attendance_access_denied');
  await probe('handoff_new_owner_no_old_message',handoff,`on_answer:=${noticeExpression(detailQ,null,p.otherOwner)};`,'attendance_owner_notification_not_found');
  const recovered=await probe('handoff_original_minimal_receipt',handoff,`on_answer:=${noticeExpression(recoverQ,null,d.owner,false)};`);
  assert.deepEqual(parseOwnerNotificationsResult(recovered,recoverQ,d.owner).receipt,saved.receipt);
  await probe('handoff_new_owner_wrong_receipt',handoff,`on_answer:=${noticeExpression(recoverQ,null,p.otherOwner,false)};`,'attendance_access_denied');
  const wrongId=await probe('unknown_original_receipt','',`on_answer:=${noticeExpression(noticeQ('recover',{notificationId:noteItem.notificationId,operationId:p.probe}),null,d.owner,false)};`);
  assert.equal(parseOwnerNotificationsResult(wrongId,noticeQ('recover',{notificationId:noteItem.notificationId,operationId:p.probe}),d.owner).receipt,null);
  //Existing historical messages verify saved source identity, never today's Auth.
  for(const [label,setup]of [['source_auth_changed',`update public.merchant_enterprise_employees set auth_user_id=${quote(p.otherAuth)} where merchant_id=${site} and id=${quote(h.employeeId)};`],
   ['source_paused',`update public.merchant_enterprise_employees set status='disabled' where merchant_id=${site} and id=${quote(h.employeeId)};`]]){
   const historical=await probe(label,setup,`on_answer:=${noticeExpression(detailQ)};`);
   assert.deepEqual(parseOwnerNotificationsResult(historical,detailQ,d.owner).item,{...noteItem,readAt:saved.receipt.readAt});
  }
  //Current-owner change affects only fresh capture; no stored message is moved.
  const handoffDispute={...failureArgs,p_command:dispute(p.probe,ph)};
  const newOwner=await probe('new_owner_fresh_event',handoff,`perform ${expression('faolla_attendance_period_closure_owner_event_v2',handoffDispute)};
   on_answer:=${noticeExpression(noticeQ(),null,p.otherOwner)};`);
  const newOwnerList=parseOwnerNotificationsResult(newOwner,noticeQ(),p.otherOwner);assert.equal(newOwnerList.items.length,1);assert.equal(newOwnerList.items[0].sourceOperationId,p.probe);
  const final=JSON.parse(await step('final_guards',`do $on_final$ begin ${oldGuard}set constraints all immediate;end;$on_final$;select ${proofSql};`));check(final);
  assert.equal(final.rows[table('owner_notifications')].length,26);assert.equal(final.rows[table('owner_notification_reads')].length,1);assert.equal(final.rows[table('owner_notification_operations')].length,2);
  await step('rollback','rollback;');rolledBack=true;
  result={phase:236,transactionSteps:steps,reads,writes,replays,rejections,probes,roleAssertions,actualSourceEvents:28,actualNotifications:26,
   actualPlanNoteVia174Then170:true,actualV1AndV2SealedDisputes:true,captureOffOriginalBehavior:true,oldOperationNoBackfill:true,
   sameUuidDifferentCategories:true,captureFailureAtomicRollback:true,ownerHandoffNoRetarget:true,formerOwnerMinimalRecovery:true,
   sourceIdentityHistoryPreserved:true,actualPageSizes:[25,1],markDoesNotChangeSourceOrBusiness:true,originalImmutableRowsPreserved:true,
   old155ArchivePreserved:true,old207ArchivePreserved:true,rollbackRestored:true,actualServiceRoleAndStrictProjection:true,syntheticAuth:true,realAuth:false,browser:false};
 }catch(error){failures.push(new Error(`owner_notifications:${stage}:${String(error?.message??error)}`,{cause:error}));}
 finally{
  keys.forEach((key,i)=>{if(prior[i]===undefined)delete process.env[key];else process.env[key]=prior[i];});
  try{await connection.close();}catch(error){failures.push(error);}
  for(const [label,read,want]of [['facts',()=>d.fingerprint(),facts],['definitions',()=>d.definitions(),definitions],['catalog',()=>d.tableCatalog(),catalog],
   ['old155',async()=>periodContinuationArchiveBytes(await archive()),old155],['old207',async()=>periodContinuationArchiveBytes(await periodArchive()),old207]]){
   try{assert.deepEqual(await read(),want,'owner_notifications_rollback_'+label);}catch(error){failures.push(error);}
  }
 }
 if(failures.length)throw new AggregateError(failures,'owner_notifications_native_failed:'+failures.slice(0,6).map(e=>String(e.stack)+'\n'+String(e.cause?.stack??'')).join('\n').slice(0,10000)
  +'\nlastRpcError:'+JSON.stringify(lastRpc?.error?{name:lastRpc.name,error:lastRpc.error,sqlstate:lastRpc.sqlstate,context:lastRpc.context?.slice(0,2000)}:null)
  +'\nlastStepFailure:'+JSON.stringify(lastStepFailure),{cause:failures[0]});
 assert(rolledBack);native.pass('236 actual employee notes/disputes, owner-only delivery and minimal read receipts; all facts and archives rolled back');return result;
}
