//201 INERT diagnostic only. Two real Node leave submissions, one owned tx.
//No import starts PostgreSQL; no wall-time wait, microcommit, KDF or real Auth.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {lifecycleJson as json} from '../merchant-attendance-lifecycle-native-support.mjs';
import {createReminderNativeProtection} from '../merchant-attendance-reminders-native.mjs';
import {quote} from './attendance-bound-clocks-native.mjs';
import {periodContinuationSerialization} from './attendance-period-continuation-native.mjs';
import {reminderNativeSite,reminderNativeId,reminderNativeIds,reminderNativePeople,reminderNativeFactsSql,
 reminderNativeIdentitySeed,reminderNativeHistoricalSeed,reminderNativeRpcExpression,reminderNativeCloseTransaction,
 reminderNativeCleanupPreservingFailure} from './attendance-reminders-native.mjs';
const require=createRequire(import.meta.url);
export const reminderSourceProfileLimits=Object.freeze({sql:30,rpc:15,milliseconds:30000,statementMs:10000,
 sessionMs:25000,connections:1,controlledLeaves:2,functionTop:8,waits:0,microcommits:0,newClusters:0});

export function reminderSourceProfileRpcExpression(name,args){
 if(name!=='faolla_attendance_admin_v1')return reminderNativeRpcExpression(name,args);
 assert.deepEqual(Object.keys(args).sort(),['p_auth_user_id','p_command','p_operation_id','p_query','p_site_id']);
 assert.equal(args.p_site_id,reminderNativeSite);assert.match(args.p_auth_user_id,/^[a-f0-9-]{36}$/);
 assert.equal(args.p_operation_id,null);
 return `public.faolla_attendance_admin_v1(${quote(args.p_site_id)},${quote(args.p_auth_user_id)},${json(args.p_query)},${json(args.p_command)},null)`;
}
export function reminderSourceProfileCallSql({expression,facts,outside,oid,write,profile=false,prepare=''}){
 assert.equal(typeof expression,'string');assert.equal(typeof facts,'string');assert.equal(typeof outside,'string');assert(Number.isSafeInteger(oid)&&oid>0);
 assert.equal(typeof write,'boolean');assert.equal(typeof profile,'boolean');assert.equal(typeof prepare,'string');
 //The before snapshot includes ALL tracked functions in the owned namespace;
 //only the final per-invocation delta is ranked/limited. No top8-before bias.
 const beforeStats=profile?`select coalesce(jsonb_object_agg(f.funcid::text,jsonb_build_array(f.calls,f.total_time,f.self_time)),'{}') into prior_functions
  from pg_stat_xact_user_functions f join pg_proc p on p.oid=f.funcid where p.pronamespace=${oid};
  if (select count(*) from jsonb_object_keys(prior_functions))>512 then raise exception 'reminder_source_profile_function_budget';end if;`:'';
 const afterStats=profile?`select coalesce(jsonb_agg(jsonb_build_object('name',funcname,'calls',calls,'selfTime',self_time,'totalTime',total_time)
  order by self_time desc,total_time desc,funcname),'[]') into functions_value from (
   select f.funcname,f.calls-coalesce((prior_functions->f.funcid::text->>0)::bigint,0) calls,
    f.total_time-coalesce((prior_functions->f.funcid::text->>1)::double precision,0) total_time,
    f.self_time-coalesce((prior_functions->f.funcid::text->>2)::double precision,0) self_time
   from pg_stat_xact_user_functions f join pg_proc p on p.oid=f.funcid where p.pronamespace=${oid}
    and f.calls>coalesce((prior_functions->f.funcid::text->>0)::bigint,0)
   order by self_time desc,total_time desc,f.funcname limit 8) profile_functions;`:'';
 return `do $reminder_source_profile$ declare before_hash text;outside_before text;v jsonb;e text;st text;cx text;phase text:='before_hash';
  t0 timestamptz;t1 timestamptz;t2 timestamptz;t3 timestamptz;t4 timestamptz;failed_at timestamptz;
  outside_t0 timestamptz;outside_t1 timestamptz;outside_t2 timestamptz;outside_t3 timestamptz;
  prior_functions jsonb;functions_value jsonb:='[]';timing_value jsonb;
 begin outside_t0:=clock_timestamp();outside_before:=${outside};outside_t1:=clock_timestamp();${beforeStats}
  t0:=clock_timestamp();before_hash:=${facts};t1:=clock_timestamp();phase:='expression';${prepare}
  begin set local role service_role;assert current_user='service_role';v:=${expression};t2:=clock_timestamp();phase:='constraints';
   set constraints all immediate;set constraints all deferred;t3:=clock_timestamp();
  exception when others then failed_at:=clock_timestamp();get stacked diagnostics e=message_text,st=returned_sqlstate,cx=pg_exception_context;end;
  reset role;if e is not null or ${!write} then assert ${facts}=before_hash,'reminder_source_profile_read_reject_changed_facts';end if;t4:=clock_timestamp();
  ${afterStats}
  outside_t2:=clock_timestamp();assert ${outside}=outside_before,'reminder_source_profile_old_rows_changed';outside_t3:=clock_timestamp();
  timing_value:=jsonb_build_object('beforeHashMs',extract(epoch from(t1-t0))*1000,
   'expressionMs',extract(epoch from(coalesce(t2,failed_at)-t1))*1000,
   'constraintsMs',(case when t2 is null then null else extract(epoch from(coalesce(t3,failed_at)-t2))*1000 end),
   'afterHashMs',extract(epoch from(t4-coalesce(t3,failed_at)))*1000,
   'outsideGuardMs',extract(epoch from((outside_t1-outside_t0)+(outside_t3-outside_t2)))*1000,
   'failedPhase',(case when e is null then null else phase end));
  perform set_config('faolla.reminder_source_profile_result',jsonb_build_object('value',v,'error',e,'sqlstate',st,
   'functionContext',(select coalesce(jsonb_agg(line),'[]') from (select left(line,512) line from unnest(string_to_array(coalesce(cx,''),E'\n')) line
    where line like 'PL/pgSQL function %' limit 8) bounded_function_context),
   'components',timing_value,'functions',functions_value)::text,true);
 end;$reminder_source_profile$;select current_setting('faolla.reminder_source_profile_result')::jsonb;`;
}
export function validateReminderSourceProfileDiagnostic(raw){
 assert(raw&&typeof raw==='object'&&!Array.isArray(raw));assert.deepEqual(Object.keys(raw).sort(),['components','functions']);
 const c=raw.components;assert(c&&typeof c==='object');
 assert.deepEqual(Object.keys(c).sort(),['afterHashMs','beforeHashMs','constraintsMs','expressionMs','failedPhase','outsideGuardMs']);
 for(const name of ['beforeHashMs','expressionMs','afterHashMs','outsideGuardMs'])assert(Number.isFinite(c[name])&&c[name]>=0);
 assert(c.constraintsMs===null||Number.isFinite(c.constraintsMs)&&c.constraintsMs>=0);
 assert(c.failedPhase===null||['expression','constraints'].includes(c.failedPhase));
 assert(Array.isArray(raw.functions)&&raw.functions.length<=8);
 for(const f of raw.functions){assert(f&&typeof f==='object');assert.deepEqual(Object.keys(f).sort(),['calls','name','selfTime','totalTime']);
  assert(typeof f.name==='string'&&/^[a-z0-9_]{1,100}$/.test(f.name));assert(Number.isSafeInteger(f.calls)&&f.calls>0);
  assert(Number.isFinite(f.selfTime)&&f.selfTime>=0&&Number.isFinite(f.totalTime)&&f.totalTime>=f.selfTime);}
 return {components:{...c},functions:raw.functions.map(f=>({...f}))};
}

export async function profileReminderSourceNative(ctx={}){
 const {d,h,native,scope}=ctx;
 assert(d?.syntheticOnly===true&&h?.syntheticOnly===true,'reminder_source_profile_owned_context_required');
 assert.equal(scope?.schema,d.owned.schema);assert.match(scope.schema,/^attendance_race_[a-f0-9]{32}$/);
 assert.equal(typeof native?.connect,'function');assert.equal(typeof d.guard,'string');
 const started=performance.now(),deadline=started+reminderSourceProfileLimits.milliseconds;
 let sqlSteps=0,rpcCalls=0,stage='protection_before',pending=null,connection=null,primary=null,last=null,profileLabel=null,serial=1250;
 const profiles=[],calls=[];
 const guard=()=>assert(performance.now()<deadline,'reminder_source_profile_30s_deadline');
 const charge=label=>{stage=label;assert(++sqlSteps<=30,'reminder_source_profile_max30_SQL');guard();};
 const audit=createReminderNativeProtection(ctx),names=audit.inventory();sqlSteps++;
 const protectedRead=(label,read)=>{charge(label);const value=read();guard();return value;};
 const oldFacts=protectedRead('facts_before',()=>audit.fingerprint(names)),definitions=protectedRead('definitions_before',()=>audit.definitions()),
  catalog=protectedRead('catalog_before',()=>audit.catalog());
 const old155=await audit.archiveBytes('155'),old207=await audit.archiveBytes('207');guard();
 const siteId=reminderNativeSite,s=quote(siteId),p=reminderNativeIds,person=reminderNativePeople.main,
  facts=reminderNativeFactsSql(names),outside=reminderNativeFactsSql(names,true);
 const next=()=>{assert(serial<1280);return reminderNativeId(++serial);};
 const step=async(label,text)=>{charge(label);const dispatch=connection.step(scope.sql(text));pending=dispatch;
  try{const value=await dispatch;guard();return value;}finally{if(pending===dispatch)pending=null;}};
 const service={rpc:async(name,args)=>{
  assert(++rpcCalls<=15,'reminder_source_profile_max15_RPC');
  assert.equal(scope.sql(json(args)),json(args),'reminder_source_profile_no_literal_schema_rewrite');
  const label=profileLabel,expression=reminderSourceProfileRpcExpression(name,args),write=args.p_command!==null;
  const prepare=label==='reminders_off'?`assert not exists(select 1 from public.merchant_attendance_operational_consumer_activations where merchant_id=${s} and consumer='reminders');`:
   label==='reminders_active'?`assert exists(select 1 from public.merchant_attendance_operational_consumer_activations where merchant_id=${s} and consumer='reminders' and action='activate' and revision=1);
    assert not exists(select 1 from public.merchant_attendance_reminder_plans where merchant_id=${s});`:'';
  last=JSON.parse(await step('rpc_'+name,reminderSourceProfileCallSql({expression,facts,outside,oid:d.owned.oid,write,profile:label!==null,prepare})));
  const diagnostic=validateReminderSourceProfileDiagnostic({components:last.components,functions:last.functions});
  calls.push({name,controlled:label,components:diagnostic.components});if(label!==null)profiles.push({kind:label,...diagnostic});
  return {data:last.value,error:last.error?{message:last.error}:null};
 }};
 const {executeAttendanceAdmin}=require('../../src/lib/merchantAttendanceAdmin.server.ts');
 const {executeLeave}=require('../../src/lib/merchantAttendanceLeave.server.ts');
 const {executeOperationalConsumerActivation}=require('../../src/lib/merchantAttendanceOperationalConsumerActivation.server.ts');
 let version=0;
 const admin=async(kind,values)=>{const result=await executeAttendanceAdmin({siteId,view:'workers',cursor:null,search:'',operationId:null,authUserId:d.owner,
  command:{kind,operationId:next(),expectedVersion:version,values}},service);version=result.version;return result;};
 const activate=consumer=>executeOperationalConsumerActivation({query:{siteId,consumer,mode:'current'},authUserId:d.owner,allowActivate:true,
  command:{siteId,consumer,action:'activate',expectedRevision:0,operationId:next(),reason:'Synthetic201 source-profile activation'}},service);
 const query={siteId,access:'self',requestId:null,operationId:null,beforeAt:null,beforeId:null};
 try{
  //The shared transport's default25s session is intentionally stricter than
  //the30s diagnostic budget, which also includes outside full protections.
  connection=native.connect();
  //Include non-inlined SQL helpers so a PL/pgSQL caller's self time is not
  //mistaken for its own work. Inlined SQL still has no separate counter.
  await step('begin',`begin;${periodContinuationSerialization}${d.guard}set local statement_timeout='10s';set local lock_timeout='3s';set local track_functions='all';`);
  await step('owned_unused_identity_seed',reminderNativeIdentitySeed(d.owner,names,scope.schema));
  await admin('settings',{timeZone:'UTC',enabled:true,webClockEnabled:true,webBreakPaid:false});
  await admin('location',{id:p.location,name:'Synthetic201 profile place',timeZone:'UTC',active:true});
  await admin('worker',{id:person.worker,employeeId:person.employee,workerNo:person.workerNo,displayName:'Synthetic201 main',locationId:p.location,active:true,startsOn:'2000-01-01'});
  await step('disclosed_historical191_source',reminderNativeHistoricalSeed(d.owner));
  const days=JSON.parse(await step('actual_future_days',`select jsonb_build_array(((clock_timestamp() at time zone 'UTC')::date+1)::text,((clock_timestamp() at time zone 'UTC')::date+2)::text);`));
  assert(Array.isArray(days)&&days.length===2&&days.every(x=>/^\d{4}-\d{2}-\d{2}$/.test(x))&&days[0]<days[1]);
  await activate('review_routing');
  const home=await executeLeave({query,command:null,authUserId:person.auth,allowWrite:true},service);assert(home.canSubmit);
  const submit=async(kind,day)=>{assert(rpcCalls<15);assert(deadline-performance.now()>=10000,'reminder_source_profile_no_budget_for_controlled_leave');
   const command={action:'submit',operationId:next(),reason:'Synthetic201 '+kind+' source profile',expectedWorkerId:person.worker,
    expectedSettingsVersion:home.settingsVersion,timeZone:home.timeZone,startAt:day+'T05:00:00.000Z',endAt:day+'T06:00:00.000Z'};
   profileLabel=kind;try{const result=await executeLeave({query,command,authUserId:person.auth,allowWrite:true},service);
    assert.equal(result.detail.status,'submitted');assert.equal(result.detail.requestId,command.operationId);return command.operationId;
   }finally{profileLabel=null;}};
  const off=await submit('reminders_off',days[0]);
  await activate('reminders');
  const on=await submit('reminders_active',days[1]);
  const proof=JSON.parse(await step('two_real_source_point_proof',`select jsonb_build_object('reviewHeads',(select count(*) from public.merchant_attendance_review_responsibility_heads where merchant_id=${s} and family='leave' and request_id in(${quote(off)},${quote(on)})),
   'plans',(select count(*) from public.merchant_attendance_reminder_plans where merchant_id=${s}),
   'candidatePlans',(select count(*) from public.merchant_attendance_reminder_plans where merchant_id=${s} and source_id=${quote(on)} and category='pending_review'),
   'baselinePlans',(select count(*) from public.merchant_attendance_reminder_plans where merchant_id=${s} and source_id=${quote(off)}),
   'trackFunctions',current_setting('track_functions'));`));
  assert.deepEqual(proof,{reviewHeads:2,plans:1,candidatePlans:1,baselinePlans:0,trackFunctions:'all'});
  assert.deepEqual(profiles.map(x=>x.kind),['reminders_off','reminders_active']);assert.equal(rpcCalls,8);
  assert(profiles.every(x=>x.functions.length>0),'reminder_source_profile_actual_function_stats_required');
  await step('rollback','rollback;');await connection.close();connection=null;
 }catch(error){primary=new Error('reminder201_source_profile:'+JSON.stringify({stage,sqlSteps,rpcCalls,totalElapsedMs:performance.now()-started,
  error:last?.error?.slice(0,500)??null,sqlstate:last?.sqlstate??null,functionContext:last?.functionContext??null,
  profiles,transportPending:pending!==null})+':'+String(error?.message??error),{cause:error});throw primary;}
 finally{await reminderNativeCleanupPreservingFailure(primary,async()=>{
  if(connection&&!pending)sqlSteps++; //The fallback rollback is an actual dispatch, too.
  const lateFailure=connection?await reminderNativeCloseTransaction(connection,pending,false):null;
  //Cleanup/protection MUST run even after the diagnostic deadline is reached.
  sqlSteps+=3;assert.equal(audit.fingerprint(names),oldFacts,'reminder_source_profile_all_facts_exact');
  assert.equal(audit.definitions(),definitions,'reminder_source_profile_definitions_exact');assert.equal(audit.catalog(),catalog,'reminder_source_profile_catalog_exact');
  assert.deepEqual(await audit.archiveBytes('155'),old155);assert.deepEqual(await audit.archiveBytes('207'),old207);
  assert(sqlSteps<=30,'reminder_source_profile_max30_SQL_including_cleanup');
  if(lateFailure)throw lateFailure;
 });}
 assert(sqlSteps<=30&&rpcCalls<=15);guard();
 return {diagnosticOnly:true,profiles,calls,sqlSteps,rpcCalls,totalElapsedMs:performance.now()-started,rollbackRestored:true,
  allFactsUnchanged:true,definitionsUnchanged:true,catalogUnchanged:true,archivesUnchanged:true,protection:audit.summary(),
  //Archive callbacks reuse the parent's opaque transport. They are counted
  //separately by audit.summary(), never misreported as this connection's SQL.
  protectionDispatches:7,archiveCallbacks:4,sessionMs:25000,
  realNodeAdmin:true,realNodeLeave:true,realConsumerActivation:true,disclosedHistoricalTemplates:1,actualPastPublishRpc:false,
  actualWaits:0,microcommits:0,newClusters:0,realAuth:false,kdf:false,production:false};
}
