//200 INERT finite acceptance. Actual192/200 and old period services are used;
//the only direct rule seed is explicitly disclosed, never a past publish claim.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {lifecycleJson as json} from '../merchant-attendance-lifecycle-native-support.mjs';
import {quote} from './attendance-bound-clocks-native.mjs';
import {periodContinuationSerialization} from './attendance-period-continuation-native.mjs';
import {operationalCycleNativeBudget as caps} from '../merchant-attendance-cycle-native.mjs';
import {cycleNativeSite as siteId,cycleNativeId as uid,cycleNativePeople as people,cycleNativeIds as ids,
 cycleNativeFixedUuids,cycleNativeRules,cycleNativeIdentitySeed,cycleNativeHistoricalRuleSeed} from './attendance-cycle-native-seed.mjs';
const require=createRequire(import.meta.url);
export const cycleNativeGroups=Object.freeze([
 'A_actual192_defaultoff_accept_CAS_original_receipt',
 'B_actualV2_send_self_confirm_seal_future_rule_saved_bytes',
 'C_cancel_sameframe_reaccept_three_legacy_firstsend_gates',
 'D_original_actor_minimal_recovery_currentowner_explicit_cancel',
 'E_actual185_qualified_delegate_accept_send_revoke_recovery',
 'F_late23514_sidecar_full_old_triple_atomic_rollback',
 'G_two_actual_accept_transactions_exact_blocking_PID',
 'H_actual_send_versus_cancel_exact_blocking_PID_unique_adoption',
]);
//Worst-case dispatch forecast, not an execution result. Every observer poll,
//BEGIN/COMMIT/getPID and real RPC is charged at runtime; assertions hide none.
export const cycleNativeDispatchForecast=Object.freeze({maximumSteps:180,businessMilliseconds:120000,groups:8,
 maximumPidObserverQueries:68,maximumNonObserverSteps:112,estimatedSqlStepsWithMaxPolls:177,estimatedRpcCalls:101,actualRpcHardCap:120,connections:3,
 actualHistoricalPublishCalls:0,disclosedHistoricalTemplates:1,newSite:siteId});
export function cycleNativeFactsSql(names,outside=false){
 names.forEach(n=>assert.match(n,/^(?:merchants|faolla_schema_migrations|merchant_[a-z0-9_]+)$/));
 const site=quote(siteId),op=outside?'<>':'=';
 return `(select md5(jsonb_object_agg(n,rows order by n)::text) from (${names.map(n=>{
  const where=n==='merchants'?`x.id${op}${site}`:n==='faolla_schema_migrations'?(outside?'true':'false'):n==='merchant_attendance_location_results'?
   `exists(select 1 from public.merchant_attendance_events e where e.id=x.event_id and e.merchant_id${op}${site})`:`x.merchant_id${op}${site}`;
  return `select ${quote(n)} n,(select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]'::jsonb) from public.${n} x where ${where}) rows`;
 }).join(' union all ')}) cycle200_facts)`;
}
export function cycleNativeRpcExpression(name,a){
 const keyMap={faolla_attendance_operational_cycle_v1:['p_query','p_auth_user_id','p_command','p_allow_accept'],
  faolla_attendance_operational_cycle_send_v1:['p_query','p_auth_user_id','p_command','p_artifact','p_intent','p_allow_write'],
  faolla_attendance_operational_cycle_send_recover_v1:['p_query','p_auth_user_id','p_intent','p_expected_fingerprint'],
  faolla_attendance_period_closure_v1:['p_query','p_auth_user_id','p_command','p_artifact','p_allow_write'],
  faolla_attendance_period_closure_v2:['p_query','p_auth_user_id','p_command','p_artifact','p_allow_write'],
  faolla_attendance_period_closure_source_v1:['p_query','p_auth_user_id'],
  faolla_attendance_period_delegated_closure_v1:['p_query','p_auth_user_id','p_command','p_artifact','p_allow_write'],
  faolla_attendance_period_delegation_v1:['p_query','p_auth_user_id','p_command','p_allow_write'],
  faolla_attendance_operational_rules_v1:['p_query','p_auth_user_id','p_command','p_allow_write'],
  faolla_attendance_operational_consumer_activation_v1:['p_query','p_auth_user_id','p_command','p_allow_activate']};
 const keys=keyMap[name];assert(keys,'cycle200_RPC_allowlist');assert.deepEqual(Object.keys(a).sort(),[...keys].sort());
 assert.equal(a.p_query.siteId,siteId);assert.match(a.p_auth_user_id,/^[a-f0-9-]{36}$/);
 const scalar=k=>k==='p_auth_user_id'||k==='p_expected_fingerprint'?quote(a[k]):k.startsWith('p_allow_')?(assert.equal(typeof a[k],'boolean'),String(a[k])):json(a[k]);
 return `public.${name}(${keys.map(scalar).join(',')})`;
}
export function cycleNativeFailure(stage,steps,last){return {stage,steps,error:last?.error?.slice(0,500)??null,
 sqlstate:last?.sqlstate??null,context:last?.context?.slice(0,4000)??null};}

//Private fixture transport only, never a public RPC response. The holder still
//owns the real settings lock while producing this complete logical postimage.
export function cycleNativeRaceExpectedFacts(output){
 assert.equal(typeof output,'string');const result=JSON.parse(output);
 assert(result&&typeof result==='object'&&!Array.isArray(result));
 assert.deepEqual(Object.keys(result).sort(),['context','error','expectedFactsHash','sqlstate','value']);
 assert.equal(result.error,null);assert.equal(result.sqlstate,null);assert.equal(result.context,null);
 assert(result.value&&typeof result.value==='object'&&!Array.isArray(result.value));
 assert.equal(typeof result.expectedFactsHash,'string');assert.match(result.expectedFactsHash,/^[a-f0-9]{32}$/);
 return result.expectedFactsHash;
}

//Two real writer transactions. No artificial advisory/pre-lock substitutes.
export async function cycleNativePidRace({connect,observe,sql,charge},holderSql,waiterSql){
 assert.equal(typeof holderSql,'string');assert(['string','function'].includes(typeof waiterSql));
 const holder=connect();let waiter,waiting;
 try{
  charge('race_holder_PID');const pid=Number(await holder.step('select pg_backend_pid();'));assert(Number.isSafeInteger(pid)&&pid>0);
  charge('race_holder_actual_RPC');const left=await holder.step(sql('begin;'+holderSql));
  const actualWaiterSql=typeof waiterSql==='function'?waiterSql(left):waiterSql;assert.equal(typeof actualWaiterSql,'string');
  waiter=connect();assert.match(waiter.name,/^attendance_race_[a-f0-9]{32}$/);
  charge('race_waiter_actual_RPC');waiting=waiter.step(sql('begin;'+actualWaiterSql+'commit;')).then(output=>({output,error:null}),error=>({output:null,error}));
  let witnessed=false,polls=0;const until=Date.now()+caps.pidPollDeadlineMs;
  while(polls<caps.pidPollsPerRace&&Date.now()<until){
   charge('race_PID_observer');polls++;
   witnessed=observe(`select count(*) from pg_stat_activity where application_name=${quote(waiter.name)} and wait_event_type='Lock' and ${pid}=any(pg_blocking_pids(pid));`)==='1';
   if(witnessed)break;
   if(polls<caps.pidPollsPerRace)await new Promise(resolve=>setTimeout(resolve,caps.pidPollIntervalMs));
  }
  assert(witnessed,'cycle200_actual_blocking_PID_not_witnessed');charge('race_holder_commit');await holder.step('commit;');
  const right=await waiting;assert.equal(right.error,null,'cycle200_waiter_transport_failure');return{left,right:right.output,witnessed,polls};
 }finally{await Promise.all([holder.close(),waiter?.close()]);if(waiting)await waiting;}
}

export async function verifyOperationalCycleNative(ctx={}){
 const {d,h,native,scope,cycleAudit:audit}=ctx;
 assert(d?.syntheticOnly===true&&h?.syntheticOnly===true&&audit,'cycle200_owned_parent_required');
 assert.equal(scope.schema,d.owned.schema);assert.match(scope.schema,/^attendance_race_[a-f0-9]{32}$/);
 const {executeCycleIntent}=require('../../src/lib/merchantAttendanceCycleIntent.server.ts');
 const {executeCycleSend}=require('../../src/lib/merchantAttendanceCycleSend.server.ts');
 const {parseCycleSendResult}=require('../../src/lib/merchantAttendanceCycleSendResult.ts');
 const {cycleSendPeriodQuery,cycleSendIntent,cycleSendCommandFingerprint}=require('../../src/lib/merchantAttendanceCycleSend.ts');
 const {executePeriodClosuresV2}=require('../../src/lib/merchantAttendancePeriodClosureV2.server.ts');
 const {executePeriodDelegatedClosures}=require('../../src/lib/merchantAttendancePeriodDelegatedClosure.server.ts');
 const {executePeriodDelegation}=require('../../src/lib/merchantAttendancePeriodDelegation.server.ts');
 const {executeOperationalRuleLedger}=require('../../src/lib/merchantAttendanceOperationalRuleLedger.server.ts');
 const {executeOperationalConsumerActivation}=require('../../src/lib/merchantAttendanceOperationalConsumerActivation.server.ts');
 const names=audit.inventory(),site=quote(siteId),small=cycleNativeFactsSql(names),outside=cycleNativeFactsSql(names,true);
 assert.equal(audit.run('cycle_unused_site',`select count(*) from public.merchants where id=${site};`),'0');
 const unscoped=JSON.parse(audit.run('cycle_relation_scope_inventory',`select coalesce(jsonb_agg(c.relname order by c.relname),'[]') from pg_class c
  where c.relnamespace=${d.owned.oid} and c.relkind in('r','p') and c.relname<>all(array['merchants','faolla_schema_migrations'])
  and not exists(select 1 from pg_attribute a where a.attrelid=c.oid and a.attname='merchant_id' and not a.attisdropped);`));
 assert.deepEqual(unscoped,['merchant_attendance_location_results']);
 const oldOutside=audit.run('cycle_outside_before',`select ${outside};`),baseline=audit.fingerprint(names);
 const prefix=periodContinuationSerialization+d.guard+"set local lock_timeout='3s';set local statement_timeout='10s';";
 const deadline=Date.now()+caps.milliseconds;let connection=native.connect({lifetimeMs:180000}),committed=false,rolledBack=false;
 let serial=1000,steps=0,rpcCalls=0,stage='begin',last=null,replayOnly=false,reads=0,writes=0,rejections=0;
 const groups=[],statistics=[],rpcByName={},dispatches=[],races=[];let groupStart={steps:0,rpcCalls:0};const next=()=>uid(++serial);
 const charge=label=>{stage=label;assert(++steps<=caps.steps,'cycle200_max180_actual_SQL_dispatches');assert(Date.now()<deadline,'cycle200_120s_business_deadline');dispatches.push(label);};
 const step=async(label,text)=>{charge(label);return connection.step(scope.sql(text));};
 const tx=body=>committed?'begin;'+prefix+body+'commit;':body;
 const mark=index=>{groups.push(cycleNativeGroups[index]);statistics.push({group:cycleNativeGroups[index],steps:steps-groupStart.steps,rpcCalls:rpcCalls-groupStart.rpcCalls});groupStart={steps,rpcCalls};};
 const count=name=>{assert(++rpcCalls<=cycleNativeDispatchForecast.actualRpcHardCap,'cycle200_max120_RPC');rpcByName[name]=(rpcByName[name]??0)+1;};
 const callSql=(expression,{write=false,replay=false,prepare='',captureRaceFacts=false,expectedFactsHash=null}={})=>{
  if(expectedFactsHash!==null){assert.equal(typeof expectedFactsHash,'string');assert.match(expectedFactsHash,/^[a-f0-9]{32}$/);}
  assert.equal(typeof captureRaceFacts,'boolean');assert(!captureRaceFacts||write&&expectedFactsHash===null);
  return `do $cycle200_call$ declare before_hash text;v jsonb;e text;s text;c text;prepared_command jsonb;begin
  before_hash:=${expectedFactsHash===null?small:quote(expectedFactsHash)};${prepare}begin set local role service_role;assert current_user='service_role';v:=${expression};set constraints all immediate;set constraints all deferred;
  exception when others then get stacked diagnostics e=message_text,s=returned_sqlstate,c=pg_exception_context;end;reset role;
  if e is not null or ${!write||replay||expectedFactsHash!==null} then assert ${small}=before_hash,'cycle200_read_reject_replay_changed_facts';end if;
  perform set_config('faolla.cycle200_result',(jsonb_build_object('value',v,'error',e,'sqlstate',s,'context',c)${captureRaceFacts?`||jsonb_build_object('expectedFactsHash',${small})`:''})::text,true);
 end;$cycle200_call$;select current_setting('faolla.cycle200_result')::jsonb;`;};
 const call=async(label,expression,options={})=>{last=JSON.parse(await step(label,tx(callSql(expression,options))));if(last.error)rejections++;else if(options.write)writes++;else reads++;return last;};
 const ok=async(label,expression,options={})=>{const r=await call(label,expression,options);assert.equal(r.error,null,JSON.stringify(cycleNativeFailure(label,steps,r)));return r.value;};
 const service={rpc:async(name,args)=>{
  count(name);assert.equal(scope.sql(json(args)),json(args),'cycle200_no_literal_schema_rewrite');
  const result=await call('rpc_'+name+'_'+(args.p_command?.action??args.p_query.mode??'source'),cycleNativeRpcExpression(name,args),{write:!!args.p_command,replay:replayOnly});
  return {data:result.value,error:result.error?{message:result.error}:null};
 }};
 const deny=async(run,codes)=>{const before=rpcCalls;await assert.rejects(run,error=>codes.includes(error.code));assert.equal(rpcCalls,before+1,'cycle200_denial_one_actual_RPC');assert(last.error,'cycle200_denial_must_reach_SQL');};
 const rawDeny=async(name,args,code)=>{const result=await service.rpc(name,args);assert.equal(result.error?.message,code);return result;};
 const admin=async(kind,values)=>{count('faolla_attendance_admin_v1');return ok('setup_admin_'+kind,`public.faolla_attendance_admin_v1(${site},${quote(d.owner)},'{"view":"workers","cursor":null,"search":""}'::jsonb,prepared_command,null)`,{write:true,
  prepare:`prepared_command:=jsonb_build_object('kind',${quote(kind)},'operationId',${quote(next())},'expectedVersion',coalesce((select version from public.merchant_attendance_settings where merchant_id=${site}),0),'values',${json(values)});`});};
 const setup=async()=>{
  await step('new_identity_seed',tx(cycleNativeIdentitySeed(d.owner,names,scope.schema)));
  await admin('settings',{timeZone:'UTC',enabled:true,webClockEnabled:true,webBreakPaid:false});
  await admin('location',{id:ids.location,name:'Synthetic200 ordinary place',timeZone:'UTC',active:true});
  for(const [name,p]of Object.entries(people))await admin('worker',{id:p.worker,employeeId:p.employee,workerNo:p.workerNo,displayName:'Synthetic200 '+name,locationId:ids.location,active:true,startsOn:'2000-01-01'});
  await step('disclosed_historical_rule_SOURCE_only',tx(cycleNativeHistoricalRuleSeed(d.owner)));
 };
 const profileSql=`select jsonb_build_object('anchor',((clock_timestamp() at time zone 'UTC')::date-7)::text,'tomorrow',((clock_timestamp() at time zone 'UTC')::date+1)::text,
  'validFrom',to_char((clock_timestamp()-interval '1 minute') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'validUntil',to_char((clock_timestamp()+interval '1 day') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));`;
 let profile;const sc=(p,access='owner',grantId=null)=>({siteId,access,workerId:p.worker,grantId});
 const intent=(q,c=null,auth=d.owner,allowed=true)=>executeCycleIntent({query:q,command:c,authUserId:auth,allowAccept:allowed},service);
 const prepare=(p,access='owner',grantId=null,auth=d.owner)=>intent({...sc(p,access,grantId),mode:'prepare',anchorDate:profile.anchor},null,auth);
 const detailQ=(p,intentId,access='owner',grantId=null)=>({...sc(p,access,grantId),mode:'detail',intentId});
 const acceptCommand=(prep,intentId)=>{const v=prep.data.preparation;assert.equal(v.state,'ready');return{action:'accept',operationId:intentId,intentId,
  anchorDate:v.anchorDate,fromDate:v.range.fromDate,throughDate:v.range.throughDate,employeeId:v.workerIdentity.employeeId,employeeAuthUserId:v.workerIdentity.employeeAuthUserId,
  expectedWorkerVersion:v.workerIdentity.workerVersion,expectedEmployeeVersion:v.workerIdentity.employeeVersion,expectedSettingsVersion:v.settingsRef.version,
  expectedActivationRevision:v.activation.revision,expectedPreparationFingerprint:v.preparationFingerprint,
  expectedFrameRevision:prep.data.frameHead.revision,expectedFrameHeadOperationId:prep.data.frameHead.lastOperationId,reason:'Synthetic200 explicit accepted frame'};};
 const accept=async(p,access='owner',grantId=null,auth=d.owner,prepared=null)=>{const prep=prepared??await prepare(p,access,grantId,auth),iid=next(),q=detailQ(p,iid,access,grantId),command=acceptCommand(prep,iid),receipt=await intent(q,command,auth);
  const saved=await intent(q,null,auth);assert.equal(saved.data.intent.intentId,iid);return{p,q,command,receipt,saved};};
 const cancelCommand=saved=>({action:'cancel',operationId:next(),intentId:saved.data.intent.intentId,expectedRevision:1,
  expectedHeadOperationId:saved.data.intent.intentId,expectedIntentFingerprint:saved.data.intent.intentFingerprint,reason:'Synthetic200 explicit cancellation'});
 const frameOf=(a,periodId=next())=>{const i=a.saved.data.intent;return{siteId,access:i.access,workerId:i.workerId,grantId:i.grantId,
  fromDate:i.fromDate,throughDate:i.throughDate,periodId,intentId:i.intentId,expectedIntentFingerprint:i.intentFingerprint};};
 const oldQ=(f,mode='detail',access=f.access)=>({siteId,access,...(access==='delegate'?{grantId:f.grantId}:{}),workerId:f.workerId,
  fromDate:f.fromDate,throughDate:f.throughDate,mode,periodId:f.periodId,operationId:null,version:null,cursor:null});
 const old=(f,mode='detail',c=null,auth=d.owner,access='owner')=>executePeriodClosuresV2({query:oldQ(f,mode,access),command:c,authUserId:auth,moduleEnabled:true},service);
 const preview=(f,auth=d.owner)=>f.access==='delegate'?executePeriodDelegatedClosures({query:{...oldQ(f,'preview'),periodId:null},authUserId:auth,moduleEnabled:true},service)
  :executePeriodClosuresV2({query:{...oldQ(f,'preview'),periodId:null},authUserId:auth,moduleEnabled:true},service);
 const firstCommand=(f,artifact)=>({action:'send',operationId:next(),periodId:f.periodId,expectedRevision:0,expectedVersion:0,
  expectedFingerprint:artifact.sourceFingerprint,reason:'Synthetic200 actual first managed send'});
 const sendArgs=(f,c,artifact,auth=d.owner,allowed=true)=>({p_query:cycleSendPeriodQuery(f,'detail',null),p_auth_user_id:auth,p_command:c,p_artifact:artifact,p_intent:cycleSendIntent(f),p_allow_write:allowed});
 const send=async(f,c,artifact,auth=d.owner,allowed=true)=>{const args=sendArgs(f,c,artifact,auth,allowed),r=await service.rpc('faolla_attendance_operational_cycle_send_v1',args);
  assert.equal(r.error,null,JSON.stringify(cycleNativeFailure(stage,steps,last)));return parseCycleSendResult(r.data,f,auth,c.operationId,await cycleSendCommandFingerprint(f,c,auth),c);};
 const recoverSend=async(f,c,auth=d.owner,hash=null)=>{const r=await service.rpc('faolla_attendance_operational_cycle_send_recover_v1',{
  p_query:cycleSendPeriodQuery(f,'recover',c.operationId),p_auth_user_id:auth,p_intent:cycleSendIntent(f),p_expected_fingerprint:hash??await cycleSendCommandFingerprint(f,c,auth)});
  assert.equal(r.error,null,JSON.stringify(cycleNativeFailure(stage,steps,last)));return parseCycleSendResult(r.data,f,auth,c.operationId,hash??await cycleSendCommandFingerprint(f,c,auth));};
 const activate=()=>executeOperationalConsumerActivation({query:{siteId,consumer:'timesheet_cycle',mode:'current'},authUserId:d.owner,allowActivate:true,
  command:{siteId,consumer:'timesheet_cycle',action:'activate',operationId:next(),expectedRevision:0,reason:'Synthetic200 explicit activation'}},service);
 const save=async name=>step('save_'+name,`savepoint ${name};select ${small};`);
 const restore=async(name,before)=>assert.equal(await step('restore_'+name,`rollback to savepoint ${name};release savepoint ${name};select ${small};`),before);
 const outsideCheck=label=>assert.equal(audit.run('cycle_outside_'+label,`select ${outside};`),oldOutside,'cycle200_preexisting_facts_changed');
 try{
  await step('begin','begin;'+prefix);await setup();profile=JSON.parse(await step('profile',profileSql));
  //A real source is present, but activation is absent/defaultoff.
  const disabled=await prepare(people.main);assert.equal(disabled.data.preparation.state,'consumer_disabled');assert.equal(disabled.data.frameHead,null);
  await activate();const active=await prepare(people.main),probeId=next(),probe=acceptCommand(active,probeId),probeQ=detailQ(people.main,probeId);
  await deny(()=>intent(probeQ,probe,d.owner,false),['attendance_operational_cycle_disabled']);
  await deny(()=>intent(probeQ,{...probe,expectedPreparationFingerprint:'0'.repeat(64)}),['attendance_operational_cycle_changed']);
  const a=await accept(people.main,'owner',null,d.owner,active);
  replayOnly=true;try{assert.deepEqual((await intent(a.q,a.command,d.owner,false)).receipt,a.receipt.receipt);}finally{replayOnly=false;}
  assert.deepEqual((await intent({...a.q,mode:'recover',operationId:a.command.operationId},null,d.owner,false)).receipt,a.receipt.receipt);
  await deny(()=>intent(a.q,{...a.command,reason:'Synthetic200 changed original command'}),['attendance_operation_conflict']);
  const listed=await intent({...sc(people.main),mode:'list',cursor:null});assert.equal(listed.data.items.length,1);assert.equal(listed.data.nextCursor,null);
  const altered={...a.command,intentId:next(),operationId:null};altered.operationId=altered.intentId;
  await deny(()=>intent({...a.q,intentId:altered.intentId},altered),['attendance_operational_cycle_changed']);mark(0);outsideCheck('a');
  //B actual new Node coordinator: original-id read, fresh real intent/source,
  //then originalV2+atomic200 link. Its three extra RPCs are separately charged.
  const frame=frameOf(a),pv=await preview(frame);assert.deepEqual(pv.preview.blockers,[]);const c=firstCommand(frame,pv.preview.artifact),linked=await executeCycleSend({body:{frame,command:c},authUserId:d.owner,allowWrite:true},service);
  assert.equal(linked.receipt.action,'link');let head=await old(frame),body=JSON.stringify(head.artifact),savedFrame=JSON.stringify(head.period);
  const follow=(action,value)=>({action,operationId:next(),periodId:frame.periodId,expectedRevision:value.period.revision,expectedVersion:value.period.currentVersion,
   expectedFingerprint:value.artifact.sourceFingerprint,reason:'Synthetic200 actual '+action});
  head=await old(frame,'detail',follow('confirm',head),people.main.auth,'self');head=await old(frame,'detail',follow('seal',head));assert.equal(head.period.sealed,true);
  const ruleQ={siteId,scope:{kind:'enterprise'},mode:'detail'},rule=await executeOperationalRuleLedger({query:ruleQ,command:null,authUserId:d.owner,allowWrite:true},service);
  const draftId=next();await executeOperationalRuleLedger({query:ruleQ,authUserId:d.owner,allowWrite:true,command:{siteId,scope:{kind:'enterprise'},action:'save_draft',operationId:draftId,
   expectedRevision:rule.data.revision,reason:'Synthetic200 later real future rule',expectedContext:rule.data.context,rules:cycleNativeRules('monthly')}},service);
  const future=await executeOperationalRuleLedger({query:{...ruleQ,mode:'preview',sourceDraftRevision:rule.data.revision+1,effectiveOn:profile.tomorrow,endsOn:null},command:null,authUserId:d.owner,allowWrite:true},service);
  await executeOperationalRuleLedger({query:ruleQ,authUserId:d.owner,allowWrite:true,command:{siteId,scope:{kind:'enterprise'},action:'publish',operationId:next(),expectedRevision:rule.data.revision+1,
   reason:'Synthetic200 later real future publication',sourceDraftRevision:rule.data.revision+1,effectiveOn:profile.tomorrow,endsOn:null,previewFingerprint:future.data.previewFingerprint}},service);
  assert.deepEqual((await intent(a.q)).data.intent,a.saved.data.intent);const afterRule=await old(frame);assert.equal(JSON.stringify(afterRule.artifact),body);
  assert.equal(afterRule.period.fromDate,JSON.parse(savedFrame).fromDate);assert.equal(afterRule.period.throughDate,JSON.parse(savedFrame).throughDate);mark(1);outsideCheck('b');
  //C cancellation advances the derived frame head; same frame may be accepted.
  const b=await accept(people.cancel),bf=frameOf(b),bp=await preview(bf),bc=firstCommand(bf,bp.preview.artifact);
  const legacyArgs={p_query:oldQ(bf),p_auth_user_id:d.owner,p_command:bc,p_artifact:bp.preview.artifact,p_allow_write:true};
  await rawDeny('faolla_attendance_period_closure_v2',legacyArgs,'attendance_operational_cycle_protocol_required');
  await rawDeny('faolla_attendance_period_closure_v1',{...legacyArgs,p_query:Object.fromEntries(Object.entries(legacyArgs.p_query).filter(([k])=>k!=='cursor'))},'attendance_operational_cycle_protocol_required');
  await intent(b.q,cancelCommand(b.saved));const again=await accept(people.cancel);assert.equal(again.command.expectedFrameRevision,2);
  await intent(again.q,cancelCommand(again.saved));const manual=await old(bf,'detail',bc);assert.equal(manual.period.revision,1);
  mark(2);outsideCheck('c');
  //D ownership change never changes immutable accept or grants a send handover.
  const hand=await accept(people.handoff),prior=await save('cycle200_owner');
  await step('synthetic_owner_handoff',`update public.merchants set user_id=${quote(ids.otherOwner)} where id=${site};select 1;`);
  assert.deepEqual((await intent({...hand.q,mode:'recover',operationId:hand.command.operationId},null,d.owner,false)).receipt,hand.receipt.receipt);
  assert.deepEqual((await recoverSend(frame,c)).receipt,linked.receipt);
  const unknown={...c,operationId:next()};assert.equal((await recoverSend(frame,unknown)).receipt,null);
  await deny(()=>intent(hand.q),['attendance_access_denied']);const closed=await intent(hand.q,cancelCommand(hand.saved),ids.otherOwner,false);assert.equal(closed.receipt.actorId,ids.otherOwner);
  await restore('cycle200_owner',prior);mark(3);outsideCheck('d');
  //E use a genuine185 grant, never a role name as grant or fake grant row.
  const eprep=await prepare(people.delegateTarget),range=eprep.data.preparation.range,grantId=next();
  const managementQ={siteId,access:'owner',mode:'list',catalog:null,grantId:null,afterId:null,operationId:null};
  await executePeriodDelegation({query:managementQ,authUserId:d.owner,allowWrite:true,command:{action:'grant',operationId:grantId,delegateEmployeeId:ids.delegate,delegateAuthUserId:ids.delegateAuth,
   workerId:people.delegateTarget.worker,employeeId:people.delegateTarget.employee,employeeAuthUserId:people.delegateTarget.auth,fromDate:range.fromDate,throughDate:range.throughDate,
   actions:['view','send','respond','seal','reopen'],includeExisting:false,validFrom:profile.validFrom,validUntil:profile.validUntil,reason:'Synthetic200 exact whole frame delegation'}},service);
  const e=await accept(people.delegateTarget,'delegate',grantId,ids.delegateAuth),ef=frameOf(e),epv=await preview(ef,ids.delegateAuth),ec=firstCommand(ef,epv.preview.artifact);
  await rawDeny('faolla_attendance_period_delegated_closure_v1',{p_query:oldQ(ef),p_auth_user_id:ids.delegateAuth,p_command:ec,p_artifact:epv.preview.artifact,p_allow_write:true},'attendance_operational_cycle_protocol_required');
  const elink=await send(ef,ec,epv.preview.artifact,ids.delegateAuth);
  await executePeriodDelegation({query:{...managementQ,mode:'detail',grantId},authUserId:d.owner,allowWrite:false,
   command:{action:'revoke',operationId:next(),grantId,expectedRevision:1,reason:'Synthetic200 explicit revoke'}},service);
  assert.deepEqual((await recoverSend(ef,ec,ids.delegateAuth)).receipt,elink.receipt);mark(4);outsideCheck('e');
  //F defer a real CHECK until the original triple has been attempted; the
  //subtransaction must roll back entries/versions/body/budget/link together.
  const f=await accept(people.fault),ff=frameOf(f),fpv=await preview(ff),fc=firstCommand(ff,fpv.preview.artifact),faultBefore=await save('cycle200_fault');
  await step('late_sidecar23514',`alter table public.merchant_attendance_period_cycle_adoptions add constraint synthetic200_late_fault check(send_operation_id<>${quote(fc.operationId)}) not valid;select 1;`);
  const failure=await service.rpc('faolla_attendance_operational_cycle_send_v1',sendArgs(ff,fc,fpv.preview.artifact));assert(failure.error);assert.equal(last.sqlstate,'23514');
  await restore('cycle200_fault',faultBefore);assert.equal((await recoverSend(ff,fc)).receipt,null);assert.equal((await intent(f.q)).data.head.action,'accept');
  mark(5);outsideCheck('f');await step('main_rollback','rollback;');rolledBack=true;await connection.close();connection=null;
  assert.equal(audit.fingerprint(names),baseline,'cycle200_main_rollback_all_facts_exact');
  //Approved bounded microcommit: only new site/identities/source/activation.
  //G/H use independent real transactions; parent drops this owned schema.
  committed=true;connection=native.connect({lifetimeMs:180000});await setup();profile=JSON.parse(await step('race_profile',tx(profileSql)));await activate();await connection.close();connection=null;
  connection=native.connect({lifetimeMs:180000});const gp=await prepare(people.race),gi=next(),gq=detailQ(people.race,gi),gc=acceptCommand(gp,gi),gc2={...gc,operationId:next(),intentId:null};gc2.intentId=gc2.operationId;
  const gq2={...gq,intentId:gc2.intentId};await connection.close();connection=null;
  const raceEnv={connect:()=>native.connect({lifetimeMs:25000}),observe:s=>native.query(scope.sql('begin read only;'+prefix+s+'commit;')),
   sql:s=>scope.sql(s.startsWith('begin;')?'begin;'+prefix+s.slice(6):s),charge};
  const gargs={p_query:gq,p_auth_user_id:d.owner,p_command:gc,p_allow_accept:true},gargs2={...gargs,p_query:gq2,p_command:gc2};
  count('faolla_attendance_operational_cycle_v1');count('faolla_attendance_operational_cycle_v1');
  //The waiter starts before the holder COMMIT but must remain equal to the
  //holder's already-proven complete postimage, not its pre-COMMIT snapshot.
  const gr=await cycleNativePidRace(raceEnv,callSql(cycleNativeRpcExpression('faolla_attendance_operational_cycle_v1',gargs),{write:true,captureRaceFacts:true}),
   left=>callSql(cycleNativeRpcExpression('faolla_attendance_operational_cycle_v1',gargs2),{write:true,expectedFactsHash:cycleNativeRaceExpectedFacts(left)}));
  const gl=JSON.parse(gr.left),gw=JSON.parse(gr.right);last=gw;assert.equal(gl.error,null);assert.equal(gw.error,'attendance_operational_cycle_changed');races.push({kind:'accept_accept',witnessed:gr.witnessed,polls:gr.polls});mark(6);outsideCheck('g');
  connection=native.connect({lifetimeMs:180000});const gs=await intent(gq),ga={p:people.race,q:gq,command:gc,saved:gs},gf=frameOf(ga),gpv=await preview(gf),gsc=firstCommand(gf,gpv.preview.artifact),gcc=cancelCommand(gs);await connection.close();connection=null;
  count('faolla_attendance_operational_cycle_send_v1');count('faolla_attendance_operational_cycle_v1');
  const hr=await cycleNativePidRace(raceEnv,callSql(cycleNativeRpcExpression('faolla_attendance_operational_cycle_send_v1',sendArgs(gf,gsc,gpv.preview.artifact)),{write:true,captureRaceFacts:true}),
   left=>callSql(cycleNativeRpcExpression('faolla_attendance_operational_cycle_v1',{p_query:gq,p_auth_user_id:d.owner,p_command:gcc,p_allow_accept:false}),{write:true,expectedFactsHash:cycleNativeRaceExpectedFacts(left)}));
  const hl=JSON.parse(hr.left),hw=JSON.parse(hr.right);last=hw;assert.equal(hl.error,null);assert.equal(hw.error,'attendance_operational_cycle_changed');
  await parseCycleSendResult(hl.value,gf,d.owner,gsc.operationId,await cycleSendCommandFingerprint(gf,gsc,d.owner),gsc);
  races.push({kind:'send_cancel',witnessed:hr.witnessed,polls:hr.polls});
  const footprint=JSON.parse(audit.run('cycle_microcommit_footprint',`do $cycle200_final_proofs$ declare o public.merchant_attendance_cycle_operations%rowtype;begin
   for o in select * from public.merchant_attendance_cycle_operations where merchant_id=${site} loop perform public.faolla_attendance_cycle_operation_proof_v1(o);end loop;
  end;$cycle200_final_proofs$;select jsonb_build_object('merchants',(select count(*) from public.merchants where id=${site}),
   'workers',(select count(*) from public.merchant_attendance_workers where merchant_id=${site}),'employees',(select count(*) from public.merchant_enterprise_employees where merchant_id=${site}),
   'intents',(select count(*) from public.merchant_attendance_cycle_intents where merchant_id=${site}),'operations',(select count(*) from public.merchant_attendance_cycle_operations where merchant_id=${site}),
   'adoptions',(select count(*) from public.merchant_attendance_period_cycle_adoptions where merchant_id=${site}),'periods',(select count(*) from public.merchant_attendance_period_closures where merchant_id=${site}),
   'sourceRules',(select count(*) from public.merchant_attendance_operational_rule_operations where merchant_id=${site}));`));
  assert.deepEqual(footprint,{merchants:1,workers:6,employees:7,intents:1,operations:2,adoptions:1,periods:1,sourceRules:2});mark(7);outsideCheck('h');
  assert(Date.now()<deadline,'cycle200_120s_business_deadline');
  return{groups,statistics,steps,rpcCalls,rpcByName,reads,writes,rejections,dispatches,pidObserverQueries:races.reduce((n,r)=>n+r.polls,0),races,
   oldFactsUnchanged:true,mainRollbackRestored:true,microcommit:{siteId,fixedUuids:cycleNativeFixedUuids,footprint,cleanupOwnedByParent:true,cleanupConfirmed:false},
   disclosedHistoricalSource:{templates:1,actualPastPublishRpc:false,canonicalPrivate191Checks:true,actualFuturePublishRpc:true},actualNodeFirstSendCoordinator:true,
   realAuth:false,browser:false,kdf:false,production:false};
 }catch(error){throw new Error('cycle200_native:'+JSON.stringify(cycleNativeFailure(stage,steps,last))+':'+(error?.stack??error));}
 finally{
  if(connection){try{if(!committed&&!rolledBack)await connection.step('rollback;');}finally{await connection.close();}}
  outsideCheck('finally');
  if(!committed)assert.equal(audit.fingerprint(names),baseline,'cycle200_failed_main_rollback_exact');
 }
}
