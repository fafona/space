//201 INERT finite SOURCE acceptance. No import starts a process or database.
//One disclosed191 SOURCE template is NOT a historical publish/real Auth claim.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {lifecycleId as id,lifecycleJson as json} from '../merchant-attendance-lifecycle-native-support.mjs';
import {quote} from './attendance-bound-clocks-native.mjs';
import {periodContinuationSerialization} from './attendance-period-continuation-native.mjs';
import {cycleNativeHistoricalRuleSeed,cycleNativeRules,cycleNativeIds} from './attendance-cycle-native-seed.mjs';
import {reminderNativeBudget as caps} from '../merchant-attendance-reminders-native.mjs';
const require=createRequire(import.meta.url);
export const reminderNativeSite='99990201';
export const reminderNativeId=n=>id(201900000+n);
export const reminderNativeIds=Object.freeze({selfRole:reminderNativeId(1),reviewRole:reminderNativeId(2),location:reminderNativeId(3),
 reviewer:reminderNativeId(4),reviewerAuth:reminderNativeId(5),otherOwner:reminderNativeId(6),draft:reminderNativeId(7),publication:reminderNativeId(8)});
export const reminderNativePeople=Object.freeze(Object.fromEntries(['main','period'].map((name,n)=>[name,Object.freeze({
 worker:reminderNativeId(20+n*3),employee:reminderNativeId(21+n*3),auth:reminderNativeId(22+n*3),workerNo:'SYNTHETIC201-'+name.toUpperCase()})])));
export const reminderNativeFixedUuids=Object.freeze([...Object.values(reminderNativeIds),...Object.values(reminderNativePeople).flatMap(p=>[p.worker,p.employee,p.auth]),
 ...Array.from({length:300},(_,n)=>reminderNativeId(1001+n))]);
export const reminderNativeGroups=Object.freeze([
 'A_actual_source_atomic_registration_activation_no_backfill_no_revive',
 'B_one_real_60second_due_25plus1_three_categories_hour_merge',
 'C_exact_continuation_samehour_deferral_without_spending_ordinal',
 'D_original_command_receipt_first_read_and_current_recipient',
 'E_late23514_full_batch_event_head_receipt_atomic_rollback',
 'F_real193_finish_leave_review_and_Node200_firstsend_stop_sources',
 'G_explicit198_takeover_carries_actual_budget_without_granting_rights',
 'H_same_and_distinct_operation_two_real_PID_transactions',
]);
export const reminderNativeDispatchForecast=Object.freeze({groups:8,sqlSteps:176,rpcCalls:78,nonRpcSql:30,pidObserverQueries:68,
 rpcByGroup:Object.freeze({A:43,B:2,C:3,D:8,E:2,F:9,G:7,H:4}),sqlHardCap:180,rpcHardCap:120,
 milliseconds:120000,connections:3,actualWaits:1,actualWaitMilliseconds:60000,newSite:reminderNativeSite,
 actualPastPublishRpc:false,disclosedHistoricalTemplates:1,repeat60MinuteExpiryActuallyWaited:false});
export function reminderNativeRules(){return {...cycleNativeRules(),reviewRouting:{mode:'value',value:Object.fromEntries(
 ['correction','missing','leave','work_arrangement'].map(k=>[k,'owner']))},reminders:{mode:'value',value:Object.fromEntries(
 ['open_session','pending_review','period_due'].map(k=>[k,{mode:'enabled',afterMinutes:1,repeatMinutes:60,maxOccurrences:2}]))}};}
export function reminderNativeHistoricalSeed(owner){
 let sql=cycleNativeHistoricalRuleSeed(owner);const old=json(cycleNativeRules()),replacement=json(reminderNativeRules());
 assert.equal(sql.split(old).length-1,1);sql=sql.replace(old,replacement).replaceAll('99990200',reminderNativeSite).replaceAll('Synthetic200','Synthetic201').replaceAll('cycle200','reminder201');
 for(const k of ['draft','publication'])sql=sql.replaceAll(cycleNativeIds[k],reminderNativeIds[k]);
 assert(!sql.includes('99990200'));return sql;
}
export function reminderNativeIdentitySeed(owner,names,schema){
 assert.match(owner,/^[a-f0-9-]{36}$/);assert.match(schema,/^attendance_race_[a-f0-9]{32}$/);
 assert.equal(new Set(reminderNativeFixedUuids).size,reminderNativeFixedUuids.length);
 const s=quote(reminderNativeSite),p=reminderNativeIds;
 return `do $reminder201_unused$ declare n text;hit boolean;begin assert current_user='postgres';
 assert not exists(select 1 from public.merchants where id=${s}),'reminder201_unused_site_required';
 for n in select unnest(array[${names.map(quote).join(',')}]) loop
  execute format('select exists(select 1 from %I.%I x where to_jsonb(x)::text ~ $1)',${quote(schema)},n) into hit using ${quote(reminderNativeFixedUuids.join('|'))};
  assert not hit,'reminder201_all_fixed_UUIDs_unused';end loop;end;$reminder201_unused$;
 insert into public.merchants(id,user_id,name,email) values(${s},${quote(owner)},'Synthetic201 owned reminders','synthetic201@example.test');
 insert into public.merchant_enterprise_roles(id,merchant_id,name,permissions) values
 (${quote(p.selfRole)},${s},'Synthetic201 explicit self',array['enterprise.view','attendance.self.view','attendance.self.clock','attendance.self.leave']),
 (${quote(p.reviewRole)},${s},'Synthetic201 explicit reviewer',array['enterprise.view','attendance.self.view','attendance.leave.review']);
 insert into public.merchant_enterprise_employees(id,merchant_id,auth_user_id,email,display_name,role_id,status,accepted_at,version) values
 ${Object.entries(reminderNativePeople).map(([name,v])=>`(${quote(v.employee)},${s},${quote(v.auth)},${quote('synthetic201-'+name+'@example.test')},${quote('Synthetic201 '+name)},${quote(p.selfRole)},'active',clock_timestamp(),1)`).join(',')},
 (${quote(p.reviewer)},${s},${quote(p.reviewerAuth)},'synthetic201-reviewer@example.test','Synthetic201 reviewer',${quote(p.reviewRole)},'active',clock_timestamp(),1);select 1;`;
}
export function reminderNativeFactsSql(names,outside=false){
 names.forEach(n=>assert.match(n,/^(?:merchants|faolla_schema_migrations|merchant_[a-z0-9_]+)$/));const s=quote(reminderNativeSite),op=outside?'<>':'=';
 return `(select md5(jsonb_object_agg(n,rows order by n)::text) from (${names.map(n=>{
 const where=n==='merchants'?`x.id${op}${s}`:n==='faolla_schema_migrations'?(outside?'true':'false'):n==='merchant_attendance_location_results'?
 `exists(select 1 from public.merchant_attendance_events e where e.id=x.event_id and e.merchant_id${op}${s})`:`x.merchant_id${op}${s}`;
 return `select ${quote(n)} n,(select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]'::jsonb) from public.${n} x where ${where}) rows`;
 }).join(' union all ')}) reminder201_facts)`;
}
export function reminderNativeRpcExpression(name,a){
 const keys={
 faolla_attendance_reminders_v1:['p_query','p_auth_user_id','p_command','p_allow_write'],
 faolla_attendance_reminders_run_v1:['p_query','p_allow_run'],
 faolla_attendance_operational_punch_self_v1:['p_site','p_auth','p_query','p_command','p_allow_new_sessions','p_allow_operational_start','p_allow_schedule','p_bind_rules'],
 faolla_attendance_operational_punch_activation_v1:['p_query','p_auth_user_id','p_command','p_allow_activate'],
 faolla_attendance_operational_consumer_activation_v1:['p_query','p_auth_user_id','p_command','p_allow_activate'],
 faolla_attendance_leave_v1:['p_query','p_auth_user_id','p_command','p_allow_write'],
 faolla_attendance_review_routing_v1:['p_query','p_auth_user_id','p_command','p_allow_write'],
 faolla_attendance_application_delegations_v1:['p_query','p_auth_user_id','p_command','p_allow_write','p_capture_notifications'],
 faolla_attendance_operational_cycle_v1:['p_query','p_auth_user_id','p_command','p_allow_accept'],
 faolla_attendance_operational_cycle_send_v1:['p_query','p_auth_user_id','p_command','p_artifact','p_intent','p_allow_write'],
 faolla_attendance_operational_cycle_send_recover_v1:['p_query','p_auth_user_id','p_intent','p_expected_fingerprint'],
 faolla_attendance_period_closure_v2:['p_query','p_auth_user_id','p_command','p_artifact','p_allow_write'],
 faolla_attendance_period_closure_source_v1:['p_query','p_auth_user_id'],
 }[name];assert(keys,'reminder201_RPC_allowlist');assert.deepEqual(Object.keys(a).sort(),[...keys].sort());
 assert.equal(a.p_site??a.p_query.siteId,reminderNativeSite);
 for(const k of ['p_auth_user_id','p_auth'])if(k in a)assert.match(a[k],/^[a-f0-9-]{36}$/);
 const scalar=k=>k==='p_site'||k==='p_auth_user_id'||k==='p_auth'||k==='p_expected_fingerprint'?quote(a[k]):
 k.startsWith('p_allow_')||k==='p_bind_rules'||k==='p_capture_notifications'?(assert.equal(typeof a[k],'boolean'),String(a[k])):json(a[k]);
 return `public.${name}(${keys.map(scalar).join(',')})`;
}
export function reminderNativeFailure(stage,sqlSteps,last){return {stage,sqlSteps,error:last?.error?.slice(0,500)??null,
 sqlstate:last?.sqlstate??null,context:last?.context?.slice(0,4000)??null};}
//Diagnostics only: monotonic round-trip durations, never SQL/args/body. The
//existing Date.now deadline and every query/protection check remain unchanged.
export function reminderNativeTimings(clock=()=>performance.now()){
 const started=clock(),sql=[],outside=[];let waitMs=null,waitElapsedMs=null;
 const elapsed=from=>Math.max(0,Math.round((clock()-from)*1000)/1000);
 const record=(items,maximum,stage,from,dispatched)=>{
  if(items.length>=maximum)return false;
  assert.equal(typeof stage,'string');assert.match(stage,/^[A-Za-z0-9_]{1,100}$/);assert.equal(typeof dispatched,'boolean');
  items.push({stage,elapsedMs:elapsed(from),dispatched});return true;
 };
 const total=items=>Math.round(items.reduce((sum,item)=>sum+item.elapsedMs,0)*1000)/1000;
 const slowest=items=>[...items].sort((a,b)=>b.elapsedMs-a.elapsedMs||a.stage.localeCompare(b.stage)).slice(0,8).map(item=>({...item}));
 return Object.freeze({now:clock,
  sql:(stage,from,dispatched=true)=>record(sql,180,stage,from,dispatched),
  outside:(stage,from)=>record(outside,10,stage,from,true),
  wait:(milliseconds,from)=>{assert.equal(waitMs,null);assert(Number.isSafeInteger(milliseconds)&&milliseconds>=0&&milliseconds<=60000);waitMs=milliseconds;waitElapsedMs=elapsed(from);},
  summary:()=>({totalElapsedMs:elapsed(started),waitMs,waitElapsedMs,sqlElapsedMs:total(sql),outsideElapsedMs:total(outside),
   mainSqlRecorded:sql.length,outsideRecorded:outside.length,slowestSql:slowest(sql),slowestOutside:slowest(outside)}),
  records:()=>({sql:sql.map(item=>({...item})),outside:outside.map(item=>({...item}))}),
 });
}
//A and F now interleave useful work with the one real wait. Count only these
//five disjoint, contiguous counter ranges; never subtract F from an A total.
export function reminderNativeInitialSegmentStatistics(segments){
 const expected=[['A_sources','A',48,39],['F_preparation','F',8,7],['A_due_wait_query','A',1,0],
  ['F_due_scan_restore','F',3,2],['A_activation_probe','A',6,4]];
 assert.equal(segments.length,expected.length);let previous={sqlSteps:0,rpcCalls:0};
 const result={A:{sqlSteps:0,rpcCalls:0,segments:[]},F:{sqlSteps:0,rpcCalls:0,segments:[]}};
 for(let n=0;n<expected.length;n++){
  const [name,group,sqlCount,rpcCount]=expected[n],segment=segments[n];
  assert.equal(segment.name,name);assert.deepEqual(segment.from,previous);
  for(const key of ['sqlSteps','rpcCalls'])assert(Number.isSafeInteger(segment.to[key])&&segment.to[key]>=segment.from[key]);
  const actual={name,sqlSteps:segment.to.sqlSteps-segment.from.sqlSteps,rpcCalls:segment.to.rpcCalls-segment.from.rpcCalls};
  assert.equal(actual.sqlSteps,sqlCount,'reminder201_segment_actual_SQL_forecast');
  assert.equal(actual.rpcCalls,rpcCount,'reminder201_segment_actual_RPC_forecast');
  result[group].sqlSteps+=actual.sqlSteps;result[group].rpcCalls+=actual.rpcCalls;result[group].segments.push(actual);previous=segment.to;
 }
 assert.equal(result.A.rpcCalls,reminderNativeDispatchForecast.rpcByGroup.A);
 assert.equal(result.F.rpcCalls,reminderNativeDispatchForecast.rpcByGroup.F);return result;
}
//The Node deadline can reject while this owned session still has its one SQL
//command in flight. Closing that session rolls back its uncommitted transaction;
//never send a second rollback command until the first command has settled.
export async function reminderNativeCloseTransaction(connection,pending,committed){
 if(pending){const settled=pending.then(()=>null,error=>error);await connection.close();return settled;}
 try{if(!committed)await connection.step('rollback;');}finally{await connection.close();}return null;
}
export async function reminderNativeCleanupPreservingFailure(primary,cleanup){
 try{return await cleanup();}catch(error){
  if(!primary)throw error;
  const note='reminder201_cleanup_secondary:'+String(error?.stack??error).slice(0,2000);
  primary.message+='\n'+note;primary.stack+='\n'+note;
 }
}
//A successful source COMMIT cannot be forgotten if the later owned-session
//close fails. Still seal its exact parent footprint; retain both close/seal
//failures instead of accepting either or masking the original transport cause.
export async function reminderNativeCloseAndSealCommitted(connection,pending,committed,seal){
 let lateFailure=null,closeFailure=null;
 try{lateFailure=await reminderNativeCloseTransaction(connection,pending,committed);}catch(error){closeFailure=error;}
 if(committed)await reminderNativeCleanupPreservingFailure(closeFailure??lateFailure,seal);
 if(closeFailure)throw closeFailure;return lateFailure;
}
export async function reminderNativePidRace({connect,observe,sql,charge},holderSql,waiterSql){
 const holder=connect();let waiter,waiting;
 try{waiter=connect();assert.match(waiter.name,/^attendance_race_[a-f0-9]{32}$/);
 charge('race_holder_PID');const pid=Number(await holder.step('select pg_backend_pid();'));assert(Number.isSafeInteger(pid)&&pid>0);
 charge('race_holder_RPC');const left=await holder.step(sql('begin;'+holderSql));
 charge('race_waiter_RPC');waiting=waiter.step(sql('begin;'+waiterSql+'commit;')).then(output=>({output,error:null}),error=>({output:null,error}));
 let witnessed=false,polls=0;const until=Date.now()+caps.pidPollDeadlineMs;
 while(polls<caps.pidPollsPerRace&&Date.now()<until){charge('race_PID_observer');polls++;
 witnessed=observe(`select count(*) from pg_stat_activity where application_name=${quote(waiter.name)} and wait_event_type='Lock' and ${pid}=any(pg_blocking_pids(pid));`)==='1';
 if(witnessed)break;if(polls<caps.pidPollsPerRace)await new Promise(resolve=>setTimeout(resolve,caps.pidPollIntervalMs));}
 assert(witnessed,'reminder201_actual_blocking_PID_not_witnessed');charge('race_holder_commit');await holder.step('commit;');
 const right=await waiting;assert.equal(right.error,null,'reminder201_waiter_transport_failure');return {left,right:right.output,witnessed,polls};
 }finally{await Promise.all([holder.close(),waiter?.close()]);if(waiting)await waiting;}
}

export async function verifyRemindersNative(ctx={}){
 const {d,h,native,scope,reminderAudit:audit}=ctx;
 assert(d?.syntheticOnly===true&&h?.syntheticOnly===true&&audit,'reminder201_owned_context_required');
 assert.equal(scope.schema,d.owned.schema);assert.match(scope.schema,/^attendance_race_[a-f0-9]{32}$/);
 const parentEvents=ctx.posthocReminderEvents;
 assert(parentEvents&&typeof parentEvents.arm==='function'&&typeof parentEvents.seal==='function','reminder201_fixed_parent_footprint_required');
 parentEvents.arm();
 const {createAttendanceReminderSystemRunner,createAttendanceRemindersService}=require('../../src/lib/merchantAttendanceReminders.server.ts');
 const {parseAttendanceReminderSystemResult,parseAttendanceReminderResult}=require('../../src/lib/merchantAttendanceReminders.ts');
 const {executeReminderRunner,parseReminderRunnerArgs}=await import('../run-merchant-attendance-reminders.ts');
 const {executeOperationalPunch}=require('../../src/lib/merchantAttendanceOperationalPunch.server.ts');
 const {executeOperationalPunchActivation}=require('../../src/lib/merchantAttendanceOperationalPunchActivation.server.ts');
 const {executeOperationalConsumerActivation}=require('../../src/lib/merchantAttendanceOperationalConsumerActivation.server.ts');
 const {executeLeave}=require('../../src/lib/merchantAttendanceLeave.server.ts');
 const {executeReviewRouting}=require('../../src/lib/merchantAttendanceReviewRouting.server.ts');
 const {executeApplicationDelegation}=require('../../src/lib/merchantAttendanceApplicationDelegation.server.ts');
 const {executeCycleIntent}=require('../../src/lib/merchantAttendanceCycleIntent.server.ts');
 const {executeCycleSend}=require('../../src/lib/merchantAttendanceCycleSend.server.ts');
 const {executePeriodClosuresV2}=require('../../src/lib/merchantAttendancePeriodClosureV2.server.ts');
 const siteId=reminderNativeSite,s=quote(siteId),p=reminderNativeIds,people=reminderNativePeople,names=audit.inventory();
 const small=reminderNativeFactsSql(names),outside=reminderNativeFactsSql(names,true);
 assert.equal(audit.run('reminder_unused_site',`select count(*) from public.merchants where id=${s};`),'0');
 assert.deepEqual(JSON.parse(audit.run('reminder_unscoped_relations',`select coalesce(jsonb_agg(c.relname order by c.relname),'[]') from pg_class c
  where c.relnamespace=${d.owned.oid} and c.relkind in('r','p') and c.relname<>all(array['merchants','faolla_schema_migrations'])
  and not exists(select 1 from pg_attribute a where a.attrelid=c.oid and a.attname='merchant_id' and not a.attisdropped);`)),['merchant_attendance_location_results']);
 const baseline=audit.fingerprint(names),oldOutside=audit.run('reminder_outside_before',`select ${outside};`);
 const prefix=periodContinuationSerialization+d.guard+"set local lock_timeout='3s';set local statement_timeout='10s';";
 const deadline=Date.now()+caps.milliseconds,timing=reminderNativeTimings();let connection=native.connect({lifetimeMs:180000}),committed=false,rolledBack=false;
 let serial=1000,sqlSteps=0,rpcCalls=0,stage='begin',last=null,lastRpc=null,pendingStep=null,primaryFailure=null,replayOnly=false,parentFootprintSealed=false;
 const groups=[],statistics=[],dispatches=[],rpcByName={},races=[],initialSegments=[];let groupStart={sqlSteps:0,rpcCalls:0};
 const next=()=>{assert(serial<1300,'reminder201_reserved_UUID_pool');return reminderNativeId(++serial);};
 const charge=label=>{stage=label;assert(++sqlSteps<=caps.sql,'reminder201_max180_actual_SQL');assert(Date.now()<deadline,'reminder201_120s_deadline');dispatches.push(label);};
 const step=async(label,text)=>{const from=timing.now();let sent=false;
  try{charge(label);const dispatched=connection.step(scope.sql(text));pendingStep=dispatched;sent=true;
   try{return await dispatched;}finally{if(pendingStep===dispatched)pendingStep=null;}}
  finally{timing.sql(label,from,sent);}};
 const count=name=>{assert(++rpcCalls<=caps.rpc,'reminder201_max120_actual_RPC');rpcByName[name]=(rpcByName[name]??0)+1;};
 const segment=name=>initialSegments.push({name,from:initialSegments.at(-1)?.to??{sqlSteps:0,rpcCalls:0},to:{sqlSteps,rpcCalls}});
 const mark=(index,segmented=null)=>{assert(!groups.includes(reminderNativeGroups[index]));
  const actual=segmented??{sqlSteps:sqlSteps-groupStart.sqlSteps,rpcCalls:rpcCalls-groupStart.rpcCalls};
  assert.equal(actual.rpcCalls,reminderNativeDispatchForecast.rpcByGroup['ABCDEFGH'[index]],'reminder201_group_actual_RPC_forecast');
  groups.push(reminderNativeGroups[index]);statistics.push({group:reminderNativeGroups[index],...actual});groupStart={sqlSteps,rpcCalls};};
 const callSql=(expression,{write=false,replay=false,prepare=''}={})=>`do $reminder201_call$ declare before_hash text;v jsonb;e text;st text;cx text;prepared_command jsonb;begin
 before_hash:=${small};${prepare}begin set local role service_role;assert current_user='service_role';v:=${expression};set constraints all immediate;set constraints all deferred;
 exception when others then get stacked diagnostics e=message_text,st=returned_sqlstate,cx=pg_exception_context;end;reset role;
 if e is not null or ${!write||replay} then assert ${small}=before_hash,'reminder201_read_reject_replay_changed_facts';end if;
 perform set_config('faolla.reminder201_result',jsonb_build_object('value',v,'error',e,'sqlstate',st,'context',cx)::text,true);
 end;$reminder201_call$;select current_setting('faolla.reminder201_result')::jsonb;`;
 const call=async(label,expression,options={})=>{last=JSON.parse(await step(label,callSql(expression,options)));return last;};
 const ok=async(label,expression,options={})=>{const r=await call(label,expression,options);assert.equal(r.error,null,JSON.stringify(reminderNativeFailure(label,sqlSteps,r)));return r.value;};
 const service={rpc:async(name,args)=>{count(name);assert.equal(scope.sql(json(args)),json(args),'reminder201_no_literal_schema_rewrite');
  const write=!!args.p_command||name==='faolla_attendance_reminders_run_v1'&&args.p_query.mode==='run';
  lastRpc={name,operationId:args.p_command?.operationId??args.p_query?.operationId??null};
  const r=await call('rpc_'+name+'_'+(args.p_command?.action??args.p_query.mode??'source'),reminderNativeRpcExpression(name,args),{write,replay:replayOnly});
  return {data:r.value,error:r.error?{message:r.error}:null};}};
 const environment=()=>({FAOLLA_ATTENDANCE_REMINDERS_ENABLED:'1',FAOLLA_ATTENDANCE_REMINDERS_SITE_IDS:siteId,
  FAOLLA_ATTENDANCE_REMINDERS_RUNNER_ENABLED:'1',FAOLLA_ATTENDANCE_REMINDERS_RUNNER_SITE_IDS:siteId});
 const runner=createAttendanceReminderSystemRunner(service,{environment}),authService=createAttendanceRemindersService(service,{environment});
 const offRunner=createAttendanceReminderSystemRunner(service,{environment:()=>({})});
 const runQ=(operationId=next(),cursor=null)=>({siteId,mode:'run',operationId,cursor});
 const authQ=(mode,patch={})=>({siteId,mode,batchId:null,operationId:null,cursor:null,...patch});
 const read=(q,auth=d.owner)=>authService.execute({query:q,command:null,authUserId:auth,allowWrite:false});
 const rawRun=async(q,allow=true)=>{const r=await service.rpc('faolla_attendance_reminders_run_v1',{p_query:q,p_allow_run:allow});
  assert.equal(r.error,null,JSON.stringify(reminderNativeFailure(stage,sqlSteps,last)));return parseAttendanceReminderSystemResult(r.data,q);};
 const recover=async(q)=>runner.recover({...q,mode:'recover',cursor:null},q);
 const save=async name=>step('save_'+name,`savepoint ${name};select ${small};`);
 const restore=async(name,before,assertions='',restoredAssertions='')=>assert.equal(await step('restore_'+name,`${assertions}rollback to savepoint ${name};release savepoint ${name};${restoredAssertions}select ${small};`),before);
 const outsideCheck=label=>{const from=timing.now();try{return assert.equal(audit.run('reminder_outside_'+label,`select ${outside};`),oldOutside,'reminder201_old_facts_changed');}
  finally{timing.outside('outside_'+label,from);}};
 const admin=async(kind,values)=>{count('faolla_attendance_admin_v1');return ok('setup_admin_'+kind,
  `public.faolla_attendance_admin_v1(${s},${quote(d.owner)},'{"view":"workers","cursor":null,"search":""}'::jsonb,prepared_command,null)`,{write:true,
  prepare:`prepared_command:=jsonb_build_object('kind',${quote(kind)},'operationId',${quote(next())},'expectedVersion',coalesce((select version from public.merchant_attendance_settings where merchant_id=${s}),0),'values',${json(values)});`});};
 const activate=(consumer,action='activate',expectedRevision=0)=>executeOperationalConsumerActivation({query:{siteId,consumer,mode:'current'},authUserId:d.owner,allowActivate:true,
  command:{siteId,consumer,action,expectedRevision,operationId:next(),reason:'Synthetic201 explicit '+consumer+' '+action}},service);
 const leaveQ=(patch={})=>({siteId,access:'self',requestId:null,operationId:null,beforeAt:null,beforeId:null,...patch});
 const leave=(q,c=null,actor=people.main.auth)=>executeLeave({query:q,command:c,authUserId:actor,allowWrite:true},service);
 const punch=c=>executeOperationalPunch({siteId,channel:'self',authUserId:people.main.auth,query:c?{mode:'recover',operationId:c.clock.operationId}:{mode:'prepare'},command:c,
  moduleEnabled:true,allowOperationalStart:true,allowSchedule:true,bindRules:true},service);
 let profile,home,opened,accepted,sourceState;const requests=[];
 const leaveCommand=n=>({action:'submit',operationId:next(),reason:'Synthetic201 real future leave '+n,expectedWorkerId:people.main.worker,
  expectedSettingsVersion:home.settingsVersion,timeZone:home.timeZone,startAt:profile.future[n]+'T05:00:00.000Z',endAt:profile.future[n]+'T06:00:00.000Z'});
 try{
  await step('begin','begin;'+prefix);
  await step('new_identity_seed',reminderNativeIdentitySeed(d.owner,names,scope.schema));
  await admin('settings',{timeZone:'UTC',enabled:true,webClockEnabled:true,webBreakPaid:false});
  await admin('location',{id:p.location,name:'Synthetic201 ordinary place',timeZone:'UTC',active:true});
  for(const [name,v]of Object.entries(people))await admin('worker',{id:v.worker,employeeId:v.employee,workerNo:v.workerNo,displayName:'Synthetic201 '+name,locationId:p.location,active:true,startsOn:'2000-01-01'});
  await step('disclosed_historical191_SOURCE',reminderNativeHistoricalSeed(d.owner));
  profile=JSON.parse(await step('actual_DB_profile',`select jsonb_build_object('anchor',((clock_timestamp() at time zone 'UTC')::date-7)::text,
   'future',(select jsonb_agg(((clock_timestamp() at time zone 'UTC')::date+i)::text order by i) from generate_series(1,25) i),
   'from',to_char((clock_timestamp()-interval '1 minute') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
   'until',to_char((clock_timestamp()+interval '1 day') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));`));
  await executeOperationalPunchActivation({query:{siteId,mode:'current'},authUserId:d.owner,allowActivate:true,
   command:{siteId,operationId:next(),action:'activate',expectedRevision:0,reason:'Synthetic201 actual193 activation'}},service);
  await activate('review_routing');await activate('timesheet_cycle');
  home=await leave(leaveQ());assert(home.canSubmit);const oldLeave=leaveCommand(0);await leave(leaveQ(),oldLeave);
  await activate('reminders');
  const prepared=await punch(null);assert(prepared.canStart);const start={clock:{expectedWorkerId:people.main.worker,operationId:next(),locationId:p.location,action:'clock_in',expectedSequence:0},
   choice:{kind:'start',expectedPolicyFingerprint:prepared.policy.policyFingerprint,selection:null}};
  const fault=await save('reminder201_fault');
  await step('registration_fault_trigger',`create function pg_temp.synthetic201_registration_fault() returns trigger language plpgsql as $f$begin raise exception 'synthetic201_registration_fault' using errcode='23514';end;$f$;
   create trigger reminder_native_fault before insert on public.merchant_attendance_reminder_plans for each row execute function pg_temp.synthetic201_registration_fault();select 1;`);
  await assert.rejects(()=>punch(start));assert.equal(last.sqlstate,'23514');assert.equal(last.error,'synthetic201_registration_fault');
  await step('remove_registration_fault',`drop trigger reminder_native_fault on public.merchant_attendance_reminder_plans;drop function pg_temp.synthetic201_registration_fault();select 1;`);
  await restore('reminder201_fault',fault);opened=await punch(start);assert.equal(opened.clock.state.status,'working');assert(opened.session);
  for(let n=1;n<=24;n++){const c=leaveCommand(n);requests.push(c.operationId);assert.equal((await leave(leaveQ(),c)).detail.status,'submitted');}
  const cq={siteId,access:'owner',workerId:people.period.worker,grantId:null},prep=await executeCycleIntent({query:{...cq,mode:'prepare',anchorDate:profile.anchor},command:null,authUserId:d.owner,allowAccept:true},service);
  const v=prep.data.preparation;assert.equal(v.state,'ready');const iid=next(),accept={action:'accept',operationId:iid,intentId:iid,anchorDate:v.anchorDate,fromDate:v.range.fromDate,throughDate:v.range.throughDate,
   employeeId:v.workerIdentity.employeeId,employeeAuthUserId:v.workerIdentity.employeeAuthUserId,expectedWorkerVersion:v.workerIdentity.workerVersion,
   expectedEmployeeVersion:v.workerIdentity.employeeVersion,expectedSettingsVersion:v.settingsRef.version,expectedActivationRevision:v.activation.revision,
   expectedPreparationFingerprint:v.preparationFingerprint,expectedFrameRevision:prep.data.frameHead.revision,expectedFrameHeadOperationId:prep.data.frameHead.lastOperationId,reason:'Synthetic201 actual accepted due frame'};
  accepted=await executeCycleIntent({query:{...cq,mode:'detail',intentId:iid},command:accept,authUserId:d.owner,allowAccept:true},service);assert(accepted.receipt);
  sourceState=JSON.parse(await step('initial_sources_savepoint',`set constraints all immediate;set constraints all deferred;savepoint reminder201_sources;
   do $s$begin assert (select count(*) from public.merchant_attendance_reminder_plans where merchant_id=${s})=26;
   assert not exists(select 1 from public.merchant_attendance_reminder_plans where merchant_id=${s} and source_id=${quote(oldLeave.operationId)});
   assert (select count(*) from public.merchant_attendance_reminder_heads where merchant_id=${s} and state='active' and delivered_count=0 and next_due_at is not null)=26;end;$s$;
   select jsonb_build_object('facts',${small},'intent',(select to_jsonb(i) from public.merchant_attendance_cycle_intents i where merchant_id=${s} and intent_id=${quote(iid)}),
    'maxDueAt',public.faolla_attendance_operational_punch_stamp_v1((select max(next_due_at) from public.merchant_attendance_reminder_heads where merchant_id=${s} and state='active')));`));
  assert.match(sourceState.maxDueAt,/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/);segment('A_sources');
  //F's original seven preparation RPCs use the real due window. Keep the
  //preview and first send together; never reuse an artifact across the wait.
  const finishBefore=await save('reminder201_finish');
  assert.equal(finishBefore,sourceState.facts,'reminder201_finish_starts_at_original26');
  await punch({clock:{expectedWorkerId:people.main.worker,operationId:next(),locationId:p.location,action:'clock_out',expectedSequence:opened.clock.state.sequence},choice:{kind:'finish'}});
  await leave(leaveQ({access:'owner',requestId:requests[0]}),{action:'reject',operationId:next(),requestId:requests[0],expectedRevision:1,reason:'Synthetic201 real original leave reject'},d.owner);
  const i=sourceState.intent,frame={siteId,access:'owner',workerId:people.period.worker,grantId:null,fromDate:i.from_date,throughDate:i.through_date,
   periodId:next(),intentId:iid,expectedIntentFingerprint:i.intent_fingerprint};
  const pv=await executePeriodClosuresV2({query:{siteId,access:'owner',workerId:frame.workerId,fromDate:frame.fromDate,throughDate:frame.throughDate,mode:'preview',periodId:null,operationId:null,version:null,cursor:null},command:null,authUserId:d.owner,moduleEnabled:true},service);
  assert.deepEqual(pv.preview.blockers,[]);const send={action:'send',operationId:next(),periodId:frame.periodId,expectedRevision:0,expectedVersion:0,expectedFingerprint:pv.preview.artifact.sourceFingerprint,reason:'Synthetic201 real Node200 managed send'};
  const sent=await executeCycleSend({body:{frame,command:send},authUserId:d.owner,allowWrite:true},service);assert.equal(sent.receipt.action,'link');
  segment('F_preparation');
  //Exactly one genuine wait for the ORIGINAL26 maximum, even though the real
  //200 link has now stopped its period head. No timestamp UPDATE or fake clock.
  const waitMs=Number(await step('real_due_wait_duration',`select ceil(greatest(0,extract(epoch from(${quote(sourceState.maxDueAt)}::timestamptz-clock_timestamp()))*1000))::bigint;`));
  segment('A_due_wait_query');
  assert(Number.isSafeInteger(waitMs)&&waitMs>=0&&waitMs<=60000);assert(Date.now()+waitMs<deadline,'reminder201_real_wait_budget');
   const waitFrom=timing.now();try{await new Promise(resolve=>setTimeout(resolve,waitMs));}finally{timing.wait(waitMs,waitFrom);}
  const finished=await runner.run(runQ());assert.equal(finished.receipt.result.stoppedCount,2);
  await restore('reminder201_finish',finishBefore,`do $f$begin assert (select state from public.merchant_attendance_reminder_heads h join public.merchant_attendance_reminder_plans p using(merchant_id,plan_id) where h.merchant_id=${s} and p.category='period_due')='stopped';end;$f$;`,
   `do $due$begin assert (select count(*) from public.merchant_attendance_reminder_plans where merchant_id=${s})=26;
    assert (select count(*) from public.merchant_attendance_reminder_heads where merchant_id=${s} and state='active' and delivered_count=0 and next_due_at<=clock_timestamp())=26,'reminder201_original26_not_all_due';
    assert (select max(next_due_at) from public.merchant_attendance_reminder_heads where merchant_id=${s} and state='active')=${quote(sourceState.maxDueAt)}::timestamptz,'reminder201_original26_due_max_changed';end;$due$;`);
  segment('F_due_scan_restore');outsideCheck('f');
  //A again sees the exact original26, not the25 left active during F. Both A
  //and F are reported in their original order using explicit disjoint ranges.
  const probe=await save('reminder201_activation');await activate('reminders','deactivate',1);await activate('reminders','activate',2);
  const pr=await runner.run(runQ());assert.equal(pr.receipt.result.deliveredCount,0);assert.equal(pr.receipt.result.stoppedCount,25);
  await restore('reminder201_activation',probe);segment('A_activation_probe');
  const initialStatistics=reminderNativeInitialSegmentStatistics(initialSegments);
  mark(0,initialStatistics.A);outsideCheck('a');mark(5,initialStatistics.F);
  //E fails AFTER real batches/events/head updates but before receipt commit.
  const lateBefore=await save('reminder201_late'),late=runQ();
  await step('late_receipt23514',`alter table public.merchant_attendance_reminder_operations add constraint synthetic201_late_fault check(operation_id<>${quote(late.operationId)}) not valid;select 1;`);
  const failed=await service.rpc('faolla_attendance_reminders_run_v1',{p_query:late,p_allow_run:true});assert(failed.error);assert.equal(last.sqlstate,'23514');
  await restore('reminder201_late',lateBefore);assert.equal((await recover(late)).receipt,null);mark(4);outsideCheck('e');
  //B one explicit CLI-parse/Node entry consumes25; same original id/cursor and two RPCs, no extra run.
  const bq=runQ(),entry=parseReminderRunnerArgs(['--once','--site',bq.siteId,'--operation',bq.operationId,'--cursor',JSON.stringify(bq.cursor)]);
  assert.deepEqual(entry.originalRun,bq);
  const b=await executeReminderRunner(entry,{service,environment}),br=b.receipt.result;assert.equal(br.checkedCount,25);assert.equal(br.deliveredCount,25);assert.equal(br.deferredCount,0);assert.equal(br.stoppedCount,0);
  assert.equal(br.batchIds.length,3);assert(br.nextCursor);mark(1);outsideCheck('b');
  const continuationBefore=await save('reminder201_continuation'),cont=await rawRun(runQ(next(),br.nextCursor));assert.equal(cont.receipt.result.checkedCount,1);assert.equal(cont.receipt.result.nextCursor,null);
  //open-session's recipient is the actual employee, not a fake owner.
  const listed=await read(authQ('list'));assert.equal(listed.data.items.length,cont.receipt.recordedAt.slice(0,13)===b.receipt.recordedAt.slice(0,13)?2:3);
  const pendingSummary=listed.data.items.find(x=>x.category==='pending_review'&&x.itemCount===23);assert(pendingSummary);
  const detail=await read(authQ('detail',{batchId:pendingSummary.batchId}));assert.equal(detail.data.batch.items.length,23);
  if(cont.receipt.recordedAt.slice(0,13)===b.receipt.recordedAt.slice(0,13)){assert.equal(cont.receipt.result.deferredCount,1);assert.equal(cont.receipt.result.deliveredCount,0);}
  else {assert.equal(cont.receipt.result.deliveredCount,1);assert.equal(cont.receipt.result.deferredCount,0);}
  await restore('reminder201_continuation',continuationBefore);mark(2);outsideCheck('c');
  //D recovery remains minimal and immutable even with the Node gate off.
  assert.deepEqual((await offRunner.run(bq)).receipt,b.receipt);
  replayOnly=true;try{assert.deepEqual((await rawRun(bq,false)).receipt,b.receipt);}finally{replayOnly=false;}
  const changed=await service.rpc('faolla_attendance_reminders_run_v1',{p_query:{...bq,cursor:br.nextCursor},p_allow_run:false});assert.equal(changed.error?.message,'attendance_operation_conflict');
  const mc={action:'mark_read',operationId:next(),batchId:pendingSummary.batchId},mq=authQ('detail',{batchId:mc.batchId});
  const marked=await authService.execute({query:mq,command:mc,authUserId:d.owner,allowWrite:true});assert.equal(marked.receipt.result.kind,'mark_read');
  const recovered=await authService.recover({query:authQ('recover',{operationId:mc.operationId}),authUserId:d.owner,expectedCommand:mc});assert.deepEqual(recovered.receipt,marked.receipt);
  await assert.rejects(()=>read(mq,people.main.auth),e=>e.code==='attendance_access_denied');
  const afterMark=await read(authQ('list'));assert.equal(afterMark.data.items.find(x=>x.batchId===mc.batchId).readAt,marked.receipt.result.readAt);mark(3);outsideCheck('d');
  //G explicit business takeover changes routing only; it carries count/time,
  //does NOT advance real time60min or claim a due repeat was scanned.
  const routeTarget=detail.data.batch.items[0].target,requestId=routeTarget.requestId;
  const handoffBefore=await step('save_owner_handoff',`savepoint reminder201_handoff;do $h$begin perform set_config('faolla.reminder201_handoff_before',${small},true);
   update public.merchants set user_id=${quote(p.otherOwner)} where id=${s};end;$h$;select current_setting('faolla.reminder201_handoff_before');`);
  const grantId=next(),gq={siteId,access:'owner',mode:'list',catalog:null,afterId:null,grantId:null,operationId:null};
  const gcmd={action:'grant',operationId:grantId,delegateEmployeeId:p.reviewer,delegateAuthUserId:p.reviewerAuth,workerId:people.main.worker,employeeId:people.main.employee,employeeAuthUserId:people.main.auth,
   category:'leave',kinds:[],includePending:true,validFrom:profile.from,validUntil:profile.until,reason:'Synthetic201 actual162 explicit authority'};
  await executeApplicationDelegation({query:gq,command:gcmd,authUserId:p.otherOwner,allowWrite:true},service);
  const rq={siteId,mode:'detail',family:'leave',requestId},routing=(command=null)=>executeReviewRouting({query:rq,command,authUserId:p.otherOwner,allowWrite:true},service);
  const route=(await routing()).data;assert.equal(route.observation.routeState,'handover_needed');
  const routeCommand=(r,action,selectedGrant)=>({action,operationId:next(),expectedResponsibilityRevision:r.current.revision,expectedResponsibilityOperationId:r.current.operationId,
   expectedRequestRevision:r.observation.requestRevision,expectedObservationFingerprint:r.observation.observationFingerprint,grantId:selectedGrant,reason:'Synthetic201 explicit '+action});
  await routing(routeCommand(route,'register',grantId));
  const carry=JSON.parse(await step('takeover_budget_point',`select jsonb_build_object('count',h.delivered_count,'last',public.faolla_attendance_operational_punch_stamp_v1(h.last_delivered_at),
   'eligible',public.faolla_attendance_reminder_eligible_v1(p,clock_timestamp()),'revision',h.revision) from public.merchant_attendance_reminder_heads h
   join public.merchant_attendance_reminder_plans p using(merchant_id,plan_id) where p.merchant_id=${s} and p.source_id=${quote(requestId)};`));
  assert.equal(carry.count,1);assert.equal(carry.last,b.receipt.recordedAt);assert.equal(carry.eligible,'active');
  await assert.rejects(()=>read(mq),e=>e.code==='attendance_access_denied');
  await executeApplicationDelegation({query:{...gq,mode:'detail',grantId},command:{action:'revoke',operationId:next(),grantId,expectedRevision:1,reason:'Synthetic201 real162 revoke'},authUserId:p.otherOwner,allowWrite:true},service);
  const revoked=(await routing()).data;assert.equal(revoked.observation.routeState,'handover_needed');await routing(routeCommand(revoked,'take_over',null));
  const finalCarry=JSON.parse(await step('owner_takeover_budget_point',`select jsonb_build_object('count',h.delivered_count,'last',public.faolla_attendance_operational_punch_stamp_v1(h.last_delivered_at),
   'eligible',public.faolla_attendance_reminder_eligible_v1(p,clock_timestamp())) from public.merchant_attendance_reminder_heads h
   join public.merchant_attendance_reminder_plans p using(merchant_id,plan_id) where p.merchant_id=${s} and p.source_id=${quote(requestId)};`));
  assert.deepEqual(finalCarry,{count:1,last:b.receipt.recordedAt,eligible:'active'});
  await restore('reminder201_handoff',handoffBefore);
  mark(6);outsideCheck('g');
  //H commit only the approved initial newsite source rows, never any case.
  const committedFacts=await step('rollback_cases_commit_source_only',`rollback to savepoint reminder201_sources;release savepoint reminder201_sources;set constraints all immediate;select ${small};commit;`);
  committed=true;rolledBack=true;assert.equal(committedFacts,sourceState.facts,'reminder201_all_cases_rollback_to_initial_source');await connection.close();connection=null;
  parentEvents.seal();parentFootprintSealed=true;
  const raceEnv={connect:()=>native.connect({lifetimeMs:25000}),observe:text=>native.query(scope.sql('begin read only;'+prefix+text+'commit;')),
   sql:text=>scope.sql(text.startsWith('begin;')?'begin;'+prefix+text.slice(6):text),charge};
  const raceCall=q=>callSql(reminderNativeRpcExpression('faolla_attendance_reminders_run_v1',{p_query:q,p_allow_run:true}),{write:true});
  const same=runQ();count('faolla_attendance_reminders_run_v1');count('faolla_attendance_reminders_run_v1');
  const sr=await reminderNativePidRace(raceEnv,raceCall(same),raceCall(same)),sl=JSON.parse(sr.left),sw=JSON.parse(sr.right);assert.equal(sl.error,null);assert.equal(sw.error,null);
  const sameLeft=await parseAttendanceReminderSystemResult(sl.value,same),sameRight=await parseAttendanceReminderSystemResult(sw.value,same);assert.deepEqual(sameLeft.receipt,sameRight.receipt);
  races.push({kind:'same_operation',witnessed:sr.witnessed,polls:sr.polls});
  const raceProof=`do $r$declare p public.merchant_attendance_reminder_plans%rowtype;b public.merchant_attendance_reminder_batches%rowtype;e public.merchant_attendance_reminder_events%rowtype;begin
   for p in select * from public.merchant_attendance_reminder_plans where merchant_id=${s} loop perform public.faolla_attendance_reminder_plan_proof_v1(p);end loop;
   for b in select * from public.merchant_attendance_reminder_batches where merchant_id=${s} loop perform public.faolla_attendance_reminder_batch_proof_v1(b);end loop;
   for e in select * from public.merchant_attendance_reminder_events where merchant_id=${s} loop perform public.faolla_attendance_reminder_event_proof_v1(e);end loop;
   assert not exists(select 1 from public.merchant_attendance_reminder_batches where merchant_id=${s} group by recipient_key,category,window_start having count(*)>1);
   assert not exists(select 1 from public.merchant_attendance_reminder_events where merchant_id=${s} and action='delivery' group by budget_key,ordinal having count(*)>1);end;$r$;
   select jsonb_build_object('ok',1,'ownerBatchId',(select batch_id from public.merchant_attendance_reminder_batches
    where merchant_id=${s} and category='pending_review' and recipient_auth_user_id=${quote(d.owner)} order by recorded_at,batch_id limit 1));`;
  charge('race_same_postconditions');const raceFacts=JSON.parse(raceEnv.observe(raceProof));assert.equal(raceFacts.ok,1);assert(sameLeft.receipt.result.batchIds.includes(raceFacts.ownerBatchId));
  const raceBatch=raceFacts.ownerBatchId,raceMark={action:'mark_read',operationId:next(),batchId:raceBatch},raceMarkQ=authQ('detail',{batchId:raceBatch});
  const markArgs=allow=>({p_query:raceMarkQ,p_auth_user_id:d.owner,p_command:raceMark,p_allow_write:allow});
  count('faolla_attendance_reminders_v1');count('faolla_attendance_reminders_v1');
  //waiter sees no original operation, waits on the genuine settings lock, then
  //must recover holder's committed receipt even though allow_write=false.
  const mr=await reminderNativePidRace(raceEnv,callSql(reminderNativeRpcExpression('faolla_attendance_reminders_v1',markArgs(true)),{write:true}),
   callSql(reminderNativeRpcExpression('faolla_attendance_reminders_v1',markArgs(false)),{write:true})),ml=JSON.parse(mr.left),mw=JSON.parse(mr.right);
  assert.equal(ml.error,null);assert.equal(mw.error,null);
  const markedLeft=await parseAttendanceReminderResult(ml.value,raceMarkQ,d.owner,raceMark),markedRight=await parseAttendanceReminderResult(mw.value,raceMarkQ,d.owner,raceMark);
  assert.deepEqual(markedLeft.receipt,markedRight.receipt);races.push({kind:'same_mark_after_settings_wait_allow_false',witnessed:mr.witnessed,polls:mr.polls});
  charge('race_mark_postconditions');assert.deepEqual(JSON.parse(raceEnv.observe(raceProof)),raceFacts);
  mark(7);outsideCheck('h');assert(Date.now()<deadline,'reminder201_final_120s_deadline');
  return {groups,statistics,sqlSteps,rpcCalls,rpcByName,dispatches,races,pidObserverQueries:races.reduce((n,r)=>n+r.polls,0),oldFactsUnchanged:true,
   allCasesRolledBackBeforeMicrocommit:true,mainRollbackRestored:false,microcommit:{siteId,fixedUuids:reminderNativeFixedUuids,cleanupOwnedByParent:true,cleanupConfirmed:false},
   actualWait:{count:1,milliseconds:waitMs,repeat60MinuteExpiryActuallyWaited:false},distinctOperationConcurrentRunActuallyTested:false,
   disclosedHistoricalSource:{templates:1,actualPastPublishRpc:false,canonicalPrivate191Checks:true},
   actualNodeRunner:true,actualNodeMarkRead:true,actualNode200ManagedSend:true,timings:{...timing.summary(),...timing.records()},browser:false,realAuth:false,kdf:false,production:false};
 }catch(error){primaryFailure=new Error('reminder201_native:'+JSON.stringify({...reminderNativeFailure(stage,sqlSteps,last),lastRpc,transportPending:pendingStep!==null,timings:timing.summary()})+':'+(error?.stack??error),{cause:error});throw primaryFailure;}
 finally{await reminderNativeCleanupPreservingFailure(primaryFailure,async()=>{
  const lateFailure=connection?await reminderNativeCloseAndSealCommitted(connection,pendingStep,committed,async()=>{
   if(!parentFootprintSealed){parentEvents.seal();parentFootprintSealed=true;}
  }):null;
  if(committed&&!parentFootprintSealed){parentEvents.seal();parentFootprintSealed=true;}
  outsideCheck('finally');if(!committed){assert.equal(audit.fingerprint(names),baseline,'reminder201_failed_rollback_all_facts_exact');rolledBack=true;}
  assert(rolledBack||committed,'reminder201_cleanup_unknown');if(lateFailure)throw lateFailure;
 });}
}
