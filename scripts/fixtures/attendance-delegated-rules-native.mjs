//206 INERT SOURCE. One existing owned connection, eight finite groups, ROLLBACK.
//Only7 identity/role rows are explicitly synthetic. Rules, employment, grants,
//suspensions/restores and both actual generation changes use production RPCs.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {assertLifecycleSandbox,lifecycleId as id,lifecycleJson as json} from '../merchant-attendance-lifecycle-native-support.mjs';
import {quote} from './attendance-bound-clocks-native.mjs';
import {outageNativeFingerprintSql} from './attendance-outage-native.mjs';
import {periodContinuationSerialization,periodContinuationArchiveBytes} from './attendance-period-continuation-native.mjs';
import {managementAuditNativeCatalogSql} from './attendance-management-audit-native.mjs';
const require=createRequire(import.meta.url),uid=n=>id(206600000+n);
export const delegatedRulesNativeSite='99990206';
export const delegatedRulesNativeIds=Object.freeze({role:uid(1),plainRole:uid(2),delegate:uid(3),delegateAuth:uid(4),plain:uid(5),plainAuth:uid(6),
 employee:uid(7),employeeAuth:uid(8),other:uid(9),otherAuth:uid(10),worker:uid(11),location:uid(12),otherLocation:uid(13)});
export const delegatedRulesNativeGroupBudgets=Object.freeze([
 ['actual_legacy_NULL_owner_and_minimal_baselines',5,10],['eight_actual202_scoped_grants_contexts_defaultoff',12,12],
 ['eight_production_Node_actions_actual_preview_sameactor_sidecars',17,19],['partialkey_UUID_routing_CAS_and_otheraction_denials',8,9],
 ['one_actual26_history_anchor_not_allfamilies_matrix',23,24],['actual_revoke_futurevalidity_and_original_recovery',6,6],
 ['both_real_pause_restore_generations_do_not_revive_authority',11,16],['late23514_atomic_retry_oldanchor_and_disabled_recovery',8,15],
].map(([name,rpcs,steps])=>Object.freeze({name,rpcs,steps})));
export function delegatedRulesNativeRevokeCommand(operationId,grantId){
 return {action:'revoke',operationId,grantId,expectedRevision:1,reason:'Synthetic206 actual revoke'};
}
export function delegatedRulesNativeChoiceDefaults(family){
 assert(['base','personal','operational'].includes(family));
 return Object.fromEntries((family==='operational'?['allowedChannels','locationScope','shiftSource','breakTypes','correctionWindow','reviewRouting','timesheetCycle','reminders']:
  ['lateGraceMinutes','earlyGraceMinutes','openSpanWarningMinutes','completedBreakMinimumMinutes']).map(k=>[k,{mode:'inherit'}]));
}
export function delegatedRulesNativeRpcExpression(name,args){
 const flag=name==='faolla_attendance_management_delegations_v1'?'p_allow_grant':'p_allow_write';
 assert(['faolla_attendance_delegated_rules_v1','faolla_attendance_management_delegations_v1','faolla_attendance_rules_v1','faolla_attendance_personal_rules_v1','faolla_attendance_operational_rules_v1'].includes(name));
 assert.deepEqual(Object.keys(args).sort(),['p_query','p_auth_user_id','p_command',flag].sort());assert.equal(typeof args[flag],'boolean');
 assert.match(args.p_query.siteId,/^9999[0-9]{4}$/);assert.match(args.p_auth_user_id,/^[a-f0-9-]{36}$/);
 return `public.${name}(${json(args.p_query)},${quote(args.p_auth_user_id)},${json(args.p_command)},${args[flag]})`;
}
export function delegatedRulesNativeFaultSql(operationId,site=delegatedRulesNativeSite){
 assert.match(operationId,/^[a-f0-9-]{36}$/);assert.equal(site,delegatedRulesNativeSite);
 return `create function public.synthetic206_owned_late_rules_fault_v1() returns trigger language plpgsql set search_path=pg_catalog as $owned206_fault$
 begin if new.merchant_id=${quote(site)} and new.operation_id=${quote(operationId)} then raise exception using errcode='23514',message='synthetic206_late_sidecar_failure',constraint='synthetic206_owned_late_rules_fault';end if;return new;end;$owned206_fault$;
 create trigger synthetic206_owned_late_rules_fault after insert on public.merchant_attendance_management_delegation_operations
 for each row execute function public.synthetic206_owned_late_rules_fault_v1();select 1;`;
}
//Reuse only the code/query plans in this owned session. Both complete blocks
//still read the original GUC and every current table anew on EVERY RPC.
export function delegatedRulesNativeGuardSql(preserve,external){
 assert.equal(typeof preserve,'string');assert.equal(typeof external,'string');assert(preserve.length>0&&external.length>0);
 assert(!preserve.includes('$owned206_preserve$'));assert(!external.includes('$owned206_external$'));
 return `create function pg_temp.synthetic206_owned_preserve_rows_v1() returns void language plpgsql volatile security invoker set search_path=pg_catalog as $owned206_preserve$begin
${preserve}
end;$owned206_preserve$;
create function pg_temp.synthetic206_owned_external_rows_v1() returns void language plpgsql volatile security invoker set search_path=pg_catalog as $owned206_external$begin
${external}
end;$owned206_external$;
revoke all on function pg_temp.synthetic206_owned_preserve_rows_v1() from public,anon,authenticated,service_role;
revoke all on function pg_temp.synthetic206_owned_external_rows_v1() from public,anon,authenticated,service_role;`;
}
//Diagnostic clocks do not include this DO's parsing/compilation before its first
//statement. JS outsideBodyMs also includes the owned prefix, transport/encoding;
//it is not a measurement of compile time. No SQL arguments are retained here.
const timingSqlFields=Object.freeze(['beforeHashMs','prepareMs','rpcMs','constraintsMs','postHashMs','preserveMs','externalMs','doBodyMs']);
const timingFields=Object.freeze([...timingSqlFields,'roundTripMs','outsideBodyMs']);
const timingNumber=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=90000?value:null;
const timingRound=value=>value===null?null:Math.round(value*1000)/1000;
export function delegatedRulesNativeTiming(tableCount){
 assert(Number.isSafeInteger(tableCount)&&tableCount>0);const records=[];
 const summary=()=>({tableCount,assertionsPerRpc:2*tableCount,recordCount:records.length,
  sqlTimingsReturned:records.filter(r=>r.doBodyMs!==null).length,maxSqlBytes:Math.max(0,...records.map(r=>r.sqlBytes)),
  totalsMs:Object.fromEntries(timingFields.map(k=>[k,timingRound(records.reduce((sum,r)=>sum+(r[k]??0),0))])),
  missingCounts:Object.fromEntries(timingFields.map(k=>[k,records.filter(r=>r[k]===null).length])),
  slowest:[...records].sort((a,b)=>(b.roundTripMs??-1)-(a.roundTripMs??-1)||a.call-b.call).slice(0,8).map(r=>({...r})),
  last:records.length?{...records[records.length-1]}:null});
 return {record(label,sqlBytes,components,roundTripMs){
  assert(records.length<90,'dr206_timing_max90');assert(Number.isSafeInteger(sqlBytes)&&sqlBytes>0);
  const row={call:records.length+1,label:/^[a-z0-9_]{1,160}$/.test(label)?label:'invalid_label',sqlBytes};
  for(const field of timingSqlFields){const descriptor=components&&Object.getOwnPropertyDescriptor(components,field);
   row[field]=timingRound(timingNumber(descriptor&&Object.hasOwn(descriptor,'value')?descriptor.value:null));}
  row.roundTripMs=timingRound(timingNumber(roundTripMs));
  row.outsideBodyMs=row.roundTripMs!==null&&row.doBodyMs!==null?timingRound(timingNumber(row.roundTripMs-row.doBodyMs)):null;
  const phase=components&&Object.getOwnPropertyDescriptor(components,'failedPhase');
  row.failedPhase=phase&&Object.hasOwn(phase,'value')&&['role','rpc','constraints'].includes(phase.value)?phase.value:null;
  records.push(row);
 },summary,snapshot:()=>({records:records.map(r=>({...r})),summary:summary()})};
}
export function delegatedRulesNativeCallSql({all,outside,prepare,role,expression,preserve,external,write,replay}){
 for(const value of[all,prepare,expression,preserve,external])assert.equal(typeof value,'string');
 assert(outside===null||typeof outside==='string');assert.match(role,/^[a-z_][a-z0-9_]*$/);assert.equal(typeof write,'boolean');assert.equal(typeof replay,'boolean');
 return `do $dr206_call$ declare old_hash text;outside_hash text;value jsonb;prepared_command jsonb;failure text;state_code text;context_text text;constraint_text text;
  timing_body0 timestamptz;timing_before1 timestamptz;timing_prepare1 timestamptz;timing_rpc0 timestamptz;timing_rpc1 timestamptz;timing_constraints1 timestamptz;
  timing_post0 timestamptz;timing_post1 timestamptz;timing_preserve1 timestamptz;timing_external1 timestamptz;timing_failed_at timestamptz;timing_phase text;begin
   timing_body0:=clock_timestamp();old_hash:=${all};${outside?'outside_hash:='+outside+';':''}timing_before1:=clock_timestamp();${prepare}timing_prepare1:=clock_timestamp();
   begin timing_phase:='role';set local role ${role};assert current_user=${quote(role)};timing_rpc0:=clock_timestamp();timing_phase:='rpc';value:=${expression};timing_rpc1:=clock_timestamp();timing_phase:='constraints';set constraints all immediate;set constraints all deferred;timing_constraints1:=clock_timestamp();
    exception when others then get stacked diagnostics failure=message_text,state_code=returned_sqlstate,context_text=pg_exception_context,constraint_text=constraint_name;timing_failed_at:=clock_timestamp();end;reset role;
   timing_post0:=clock_timestamp();if failure is not null or value ? 'error' or ${!write||replay} then assert ${all}=old_hash,'dr206_read_reject_replay_wrote';end if;
   ${outside?'assert '+outside+"=outside_hash,'dr206_unrelated_table_changed';":''}timing_post1:=clock_timestamp();${preserve}timing_preserve1:=clock_timestamp();${external}timing_external1:=clock_timestamp();
   perform set_config('faolla.dr206_result',jsonb_build_object('value',value,'error',failure,'sqlstate',state_code,'context',context_text,'constraint',constraint_text,
    'timing',jsonb_build_object('beforeHashMs',extract(epoch from(timing_before1-timing_body0))*1000,'prepareMs',extract(epoch from(timing_prepare1-timing_before1))*1000,
     'rpcMs',extract(epoch from((case when timing_rpc1 is not null then timing_rpc1 when timing_phase='rpc' then timing_failed_at else null end)-timing_rpc0))*1000,
     'constraintsMs',extract(epoch from((case when timing_constraints1 is not null then timing_constraints1 when timing_phase='constraints' then timing_failed_at else null end)-timing_rpc1))*1000,
     'postHashMs',extract(epoch from(timing_post1-timing_post0))*1000,'preserveMs',extract(epoch from(timing_preserve1-timing_post1))*1000,
     'externalMs',extract(epoch from(timing_external1-timing_preserve1))*1000,'doBodyMs',extract(epoch from(timing_external1-timing_body0))*1000,
     'failedPhase',(case when failure is null then null else timing_phase end)))::text,true);
  end;$dr206_call$;select current_setting('faolla.dr206_result')::jsonb;`;
}
//Closing this owned session rolls back any unfinished transaction. Never send
//another SQL command while a timed-out Node request may still have one pending.
export async function delegatedRulesNativeCleanup(connection,pending,protections,primary=null){
 const failures=[],settled=pending?pending.then(()=>null,error=>error):null;
 try{await connection.close();}catch(error){failures.push({label:'close',error});}
 if(settled){const error=await settled;if(error)failures.push({label:'pending',error});}
 for(const [label,check]of protections){try{await check();}catch(error){failures.push({label,error});}}
 if(failures.length){
  const detail=failures.map(({label,error})=>label+':'+String(error?.message??error).slice(0,1000)).join('|');
  if(primary){const note='\ndelegated_rules_native_cleanup_secondary:'+detail;primary.message+=note;primary.stack=(primary.stack??primary.message)+note;}
  else throw new AggregateError(failures.map(item=>item.error),'delegated_rules_native_cleanup_failed:'+detail);
 }
}
export async function verifyDelegatedRulesNative(ctx){
 const {d,h,native,scope,archive,periodArchive}=ctx??{};assert(d?.syntheticOnly===true&&h?.syntheticOnly===true);
 assert.deepEqual(assertLifecycleSandbox(sql=>native.query(scope.sql(sql))),d.owned);assert.equal(scope.schema,d.owned.schema);
 const {createDelegatedRulesService}=require('../../src/lib/merchantAttendanceDelegatedRules.server.ts');
 const {executeManagementDelegation}=require('../../src/lib/merchantAttendanceManagementDelegation.server.ts');
 const {executeAttendanceAdmin}=require('../../src/lib/merchantAttendanceAdmin.server.ts');
 const {executeRules}=require('../../src/lib/merchantAttendanceRules.server.ts');
 const {delegatedRulesCommandFingerprint}=require('../../src/lib/merchantAttendanceDelegatedRules.ts');
 const p=delegatedRulesNativeIds,siteId=delegatedRulesNativeSite,site=quote(siteId),owner=quote(d.owner),names=d.inventory();
 const baseline=d.fingerprint(),definitions=d.definitions(),catalog=d.tableCatalog(),old155=periodContinuationArchiveBytes(await archive()),old207=periodContinuationArchiveBytes(await periodArchive());
 const all=outageNativeFingerprintSql(names),prefix=periodContinuationSerialization+d.guard,connection=native.connect({lifetimeMs:90000}),timing=delegatedRulesNativeTiming(names.length);
 const originals=`(select jsonb_object_agg(n,rows) from(${names.map(n=>`select ${quote(n)} n,(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from public.${n} x) rows`).join(' union all ')}) original_rows)`;
 const preserve=names.map(n=>`assert not exists(select previous.value from jsonb_array_elements(current_setting('faolla.dr206_originals')::jsonb->${quote(n)}) previous(value) except select to_jsonb(x) from public.${n} x),'dr206_old_row_changed:${n}';`).join('\n');
 const external=names.map(n=>`assert not exists(select to_jsonb(x) from public.${n} x where coalesce(to_jsonb(x)->>'merchant_id',case when ${quote(n)}='merchants' then to_jsonb(x)->>'id' end,'')<>${site}
 except select previous.value from jsonb_array_elements(current_setting('faolla.dr206_originals')::jsonb->${quote(n)}) previous(value)),'dr206_external_scope_added:${n}';`).join('\n');
 const ruleTables=['merchant_attendance_rule_streams','merchant_attendance_rule_operations','merchant_attendance_personal_rule_streams','merchant_attendance_personal_rule_operations',
  'merchant_attendance_operational_rule_streams','merchant_attendance_operational_rule_operations','merchant_attendance_operational_rule_publications'];
 const rawNames=names.filter(n=>/merchant_attendance_(?:events|correction_|missing_|leave_|work_arrangement_|period_|schedule_|shift_|plan_|calendar_|outage_)/.test(n)),raw=outageNativeFingerprintSql(rawNames);assert(rawNames.length>10);
 let rawBaseline,steps=0,rpcs=0,reads=0,writes=0,rejections=0,serial=100,stage='begin',lastRpc=null,profile,settingsVersion=0,pendingStep=null,primaryError=null;
 const groups=[],next=()=>uid(++serial);
 const step=async(label,sql)=>{stage=label;assert(++steps<=140,'dr206_max140_SQLsteps');const dispatched=connection.step(scope.sql((label==='begin'?'begin;':'')+prefix+sql));pendingStep=dispatched;
  try{return await dispatched;}finally{if(pendingStep===dispatched)pendingStep=null;}};
 const failure=error=>new Error('delegated_rules_native_stage:'+stage+':steps='+steps+':rpcs='+rpcs+':'+(error?.stack??error)+':'+JSON.stringify(lastRpc)+':timing='+JSON.stringify(timing.summary()),{cause:error});
 const call=async(label,expression,{write=false,replay=false,prepare='',role='service_role',allowed=null}={})=>{
  assert(++rpcs<=90,'dr206_max90_actualRPCs');const outside=allowed===null?null:outageNativeFingerprintSql(names.filter(n=>!allowed.includes(n)));
  const sql=delegatedRulesNativeCallSql({all,outside,prepare,role,expression,preserve:'perform pg_temp.synthetic206_owned_preserve_rows_v1();',
   external:'perform pg_temp.synthetic206_owned_external_rows_v1();',write,replay}),sqlBytes=Buffer.byteLength(scope.sql(prefix+sql),'utf8'),started=performance.now();let r;
  try{r=JSON.parse(await step(label,sql));}finally{timing.record(label,sqlBytes,r?.timing??null,performance.now()-started);}
  lastRpc={error:r.error??r.value?.error??null,sqlstate:r.sqlstate,constraint:r.constraint,context:r.context?.slice(0,6000)??null,kind:r.value?.kind??null,protocol:r.value?.protocol??null};
  if(lastRpc.error)rejections++;else if(write&&!replay)writes++;else reads++;return r;
 };
 const service={rpc:async(name,args)=>{
  let expression,allowed;
  if(name==='faolla_attendance_admin_v1'){
   assert.deepEqual(Object.keys(args).sort(),['p_site_id','p_auth_user_id','p_query','p_command','p_operation_id'].sort());assert.equal(args.p_site_id,siteId);
   expression=`public.${name}(${site},${quote(args.p_auth_user_id)},${json(args.p_query)},${json(args.p_command)},${args.p_operation_id===null?'null':quote(args.p_operation_id)})`;
   allowed=['merchant_attendance_settings','merchant_attendance_config_operations','merchant_attendance_workers','merchant_attendance_locations','merchant_attendance_employment_periods'];
  }else{
   expression=delegatedRulesNativeRpcExpression(name,args);allowed=name==='faolla_attendance_management_delegations_v1'?['merchant_attendance_management_delegations','merchant_attendance_management_delegation_revocations']:
    [...ruleTables,...(name==='faolla_attendance_delegated_rules_v1'?['merchant_attendance_management_delegation_operations']:[])];
  }
  const r=await call('actual_'+name+'_'+(args.p_command?.decision?.action??args.p_command?.action??args.p_command?.kind??args.p_query?.mode??args.p_query?.view),expression,{write:args.p_command!==null,allowed});
  return{data:r.value,error:r.error?{message:r.error}:null};
 }};
 const node=createDelegatedRulesService(service,{enabled:s=>s===siteId}),offNode=createDelegatedRulesService(service,{enabled:()=>false});
 const group=async(index,run)=>{const startRpcs=rpcs,startSteps=steps;await run();const spec=delegatedRulesNativeGroupBudgets[index],actual={name:spec.name,rpcs:rpcs-startRpcs,steps:steps-startSteps};
  assert(actual.rpcs<=spec.rpcs&&actual.steps<=spec.steps,'dr206_group_budget:'+JSON.stringify(actual));groups.push(actual);native.pass('206 group'+(index+1)+' '+JSON.stringify(actual));};
 const ok=async(label,expression,options)=>{const r=await call(label,expression,options);assert.equal(r.error,null,JSON.stringify(lastRpc));assert(!r.value?.error,JSON.stringify(lastRpc));return r.value;};
 const deny=(promise,code)=>assert.rejects(promise,e=>e?.code===code||e?.message===code);
 const save=async label=>{assert(/^[a-z0-9_]+$/.test(label));return step('save_'+label,`savepoint ${label};select ${all};`);};
 const restore=async(label,hash)=>assert.equal(await step('restore_'+label,`rollback to savepoint ${label};release savepoint ${label};select ${all};`),hash,'dr206_savepoint_not_exact');
 const query=grantId=>({siteId,grantId,mode:'context',operationId:null}),history=(grantId,cursor=null)=>({siteId,grantId,mode:'history',cursor}),recoverQuery=(grantId,operationId)=>({siteId,grantId,mode:'recover',operationId});
 const execute=(grantId,command=null,authUserId=p.delegateAuth)=>node.execute({query:query(grantId),command,authUserId,allowWrite:true});
 const recover=(grantId,expectedCommand,authUserId=p.delegateAuth)=>node.recover({query:recoverQuery(grantId,expectedCommand.decision.operationId),expectedCommand,authUserId});
 const foundation=(q,c=null)=>executeManagementDelegation({query:q,command:c,authUserId:d.owner,allowGrant:true},service);
 const personalSubject={kind:'personal',workerId:p.worker,employeeId:p.employee,employeeAuthUserId:p.employeeAuth},enterprise={kind:'enterprise'};
 const four=()=>delegatedRulesNativeChoiceDefaults('base'),eight=()=>delegatedRulesNativeChoiceDefaults('operational');
 const baseRules=()=>({...four(),lateGraceMinutes:{mode:'value',minutes:5}}),operationalRules=()=>({...eight(),allowedChannels:{mode:'value',value:['self']}});
 const common=(action,revision)=>({action,operationId:next(),expectedRevision:revision,reason:'Synthetic206 actual scoped rule decision'});
 const baseDraft=revision=>({...common('save_draft',revision),expectedSettingsVersion:settingsVersion,expectedGroupRevision:null,timeZone:'UTC',rules:baseRules()});
 const ownerBase=(command=null)=>executeRules({query:{siteId,groupId:null,operationId:null,beforeRevision:null},command,authUserId:d.owner,allowWrite:true},service);
 const grant=async(action,family,patch={})=>{const c={action:'grant',operationId:next(),delegateEmployeeId:p.delegate,delegateAuthUserId:p.delegateAuth,delegatedAction:action,
  scope:{kind:'rules',family,subject:family==='personal'?personalSubject:enterprise,allowedRuleKeys:family==='operational'?['allowedChannels','locationScope','reviewRouting']:['lateGraceMinutes'],locationIds:[p.location]},
  validFrom:profile.from,validUntil:profile.until,reason:'Synthetic206 explicit single action rule authority',...patch};const result=await foundation({siteId,mode:'write'},c);assert.equal(result.receipt.grantId,c.operationId);return c.operationId;};
 const admin=async c=>{const r=await executeAttendanceAdmin({siteId,view:'settings',cursor:null,search:'',operationId:null,command:c,authUserId:d.owner},service);settingsVersion=r.version;return r;};
 const status=(employeeId,value)=>ok('actual206_employee_'+value,'public.faolla_update_merchant_enterprise_employee_v1(prepared_command)',{write:true,prepare:`prepared_command:=jsonb_build_object('merchant_id',${site},'employee_id',${quote(employeeId)},
  'expected_version',(select version from public.merchant_enterprise_employees where merchant_id=${site} and id=${quote(employeeId)}),'actor_type','owner','actor_id',${owner},'status',${quote(value)},'attendance_operation_id',${quote(next())},'attendance_suspension_enabled',true)${value==='disabled'?`||'{"offboarding_mode":"unassign"}'::jsonb`:''};`});
 const grants={},saved={};let baseContext,personalContext,opContext,historyAnchor;
 try{
  await step('begin',`set local lock_timeout='3s';set local statement_timeout='10s';do $dr206_begin$ begin assert current_user='postgres';assert not exists(select 1 from public.merchants where id=${site});
   assert to_regprocedure('public.synthetic206_owned_late_rules_fault_v1()') is null;
   assert to_regprocedure('pg_temp.synthetic206_owned_preserve_rows_v1()') is null;assert to_regprocedure('pg_temp.synthetic206_owned_external_rows_v1()') is null;
   perform set_config('faolla.dr206_originals',${originals}::text,true);end;$dr206_begin$;${delegatedRulesNativeGuardSql(preserve,external)}select 1;`);
  await group(0,async()=>{
   profile=JSON.parse(await step('seven_explicit_synthetic_identity_role_rows',`insert into public.merchants(id,user_id,name,email) values(${site},${owner},'Synthetic206 rules','synthetic206@example.test');
    insert into public.merchant_enterprise_roles(id,merchant_id,name,permissions) values
    (${quote(p.role)},${site},'Synthetic206 explicit rules',array['enterprise.view','attendance.rules.draft','attendance.rules.publish','attendance.rules.withdraw']),
    (${quote(p.plainRole)},${site},'Synthetic206 no management',array['enterprise.view','attendance.self.view','attendance.self.clock']);
    insert into public.merchant_enterprise_employees(id,merchant_id,auth_user_id,email,display_name,role_id,status,accepted_at,version) values
    ${[['delegate','delegateAuth','role'],['plain','plainAuth','plainRole'],['employee','employeeAuth','plainRole'],['other','otherAuth','plainRole']].map(([e,a,r],i)=>`(${quote(p[e])},${site},${quote(p[a])},'synthetic206-${i}@example.test','Synthetic206 member ${i}',${quote(p[r])},'active',clock_timestamp(),1)`).join(',')};
    select jsonb_build_object('from',to_char((clock_timestamp()-interval '1 minute') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
     'until',to_char((clock_timestamp()+interval '1 day') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'futureUntil',to_char((clock_timestamp()+interval '2 days') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
     'day',to_char((clock_timestamp() at time zone 'UTC')::date+2,'YYYY-MM-DD'));`));
   await admin({kind:'settings',values:{timeZone:'UTC',enabled:true,webClockEnabled:true,webBreakPaid:false},operationId:next(),expectedVersion:settingsVersion});
   for(const locationId of[p.location,p.otherLocation])await admin({kind:'location',values:{id:locationId,name:'Synthetic206 location',timeZone:'UTC',active:true},operationId:next(),expectedVersion:settingsVersion});
   await admin({kind:'worker',values:{id:p.worker,employeeId:p.employee,workerNo:'SYNTHETIC206',displayName:'Synthetic206 target',locationId:p.location,active:true,startsOn:'2000-01-01'},operationId:next(),expectedVersion:settingsVersion});
   rawBaseline=await step('actual_raw_source_baseline','select '+raw+';');
   const old=await ownerBase(baseDraft(0));assert.equal(old.revision,1);assert.equal(old.draft.revision,1);
  });
  await group(1,async()=>{
   for(const [action,family]of[['rule_draft','base'],['rule_publish','base'],['rule_withdraw','base'],['personal_rule_approve','personal'],['personal_rule_withdraw','personal'],['operational_rule_draft','operational'],['operational_rule_publish','operational'],['operational_rule_withdraw','operational']])grants[action]=await grant(action,family);
   baseContext=(await execute(grants.rule_draft)).context;personalContext=(await execute(grants.personal_rule_approve)).context;opContext=(await execute(grants.operational_rule_draft)).context;
   assert.equal(baseContext.baselineKind,'draft');assert.equal(baseContext.baselineRevision,1);assert.deepEqual(baseContext.baselineRules,baseRules());assert.equal(personalContext.worker.employeeId,p.employee);
   assert.equal(opContext.baselineKind,'default');assert.deepEqual(opContext.baselineRules,eight());
   await deny(offNode.execute({query:query(grants.rule_draft),command:{family:'base',decision:baseDraft(1)},authUserId:p.delegateAuth,allowWrite:true}),'attendance_delegated_rules_disabled');
  });
  await group(2,async()=>{
   const send=async(action,family,decision)=>{const command={family,decision},result=await execute(grants[action],command);assert.equal(result.receipt.actorId,p.delegateAuth);assert.equal(result.receipt.commandFingerprint,await delegatedRulesCommandFingerprint(query(grants[action]),p.delegateAuth,command));saved[action]={command,result};return result.receipt.revision;};
   let rev=await send('rule_draft','base',baseDraft(1));rev=await send('rule_publish','base',{...common('publish',rev),expectedSettingsVersion:settingsVersion,expectedGroupRevision:null,timeZone:'UTC',effectiveOn:profile.day});
   await send('rule_withdraw','base',{...common('withdraw',rev),publishedRevision:rev});
   rev=await send('personal_rule_approve','personal',{...common('approve',0),expectedWorkerVersion:personalContext.worker.version,expectedSettingsVersion:settingsVersion,employeeId:p.employee,employeeAuthUserId:p.employeeAuth,timeZone:'UTC',startsOn:profile.day,endsOn:profile.day,rules:baseRules()});
   await send('personal_rule_withdraw','personal',{...common('withdraw',rev),approvedRevision:rev});
   rev=await send('operational_rule_draft','operational',{...common('save_draft',0),siteId,scope:enterprise,expectedContext:opContext.detail.context,rules:operationalRules()});
   const preview=await node.execute({query:{siteId,grantId:grants.operational_rule_publish,mode:'preview',sourceDraftRevision:rev,effectiveOn:profile.day,endsOn:null},command:null,authUserId:p.delegateAuth,allowWrite:true});
   assert.equal(preview.kind,'preview');assert.equal(preview.preview.applied,false);
   rev=await send('operational_rule_publish','operational',{...common('publish',rev),siteId,scope:enterprise,sourceDraftRevision:rev,effectiveOn:profile.day,endsOn:null,previewFingerprint:preview.preview.previewFingerprint});
   await send('operational_rule_withdraw','operational',{...common('withdraw',rev),siteId,scope:enterprise,publishedRevision:rev});
   await step('actual_eight_business_rows_same_actor_authority',`do $dr206_proofs$ declare authority public.merchant_attendance_management_delegation_operations%rowtype;begin
    assert (select count(*) from public.merchant_attendance_management_delegation_operations where merchant_id=${site})=8;
    for authority in select * from public.merchant_attendance_management_delegation_operations where merchant_id=${site} loop
     assert authority.actor_auth_user_id=${quote(p.delegateAuth)} and authority.delegate_employee_id=${quote(p.delegate)} and authority.delegate_generation=0;
     perform public.faolla_attendance_delegated_rules_operation_v1(authority,false);end loop;
    assert (select count(*) from public.merchant_attendance_rule_operations where merchant_id=${site} and actor_auth_user_id=${quote(p.delegateAuth)})=3;
    assert (select count(*) from public.merchant_attendance_personal_rule_operations where merchant_id=${site} and actor_auth_user_id=${quote(p.delegateAuth)})=2;
    assert (select count(*) from public.merchant_attendance_operational_rule_operations where merchant_id=${site} and actor_auth_user_id=${quote(p.delegateAuth)})=3;
   end;$dr206_proofs$;select 1;`);
  });
  await group(3,async()=>{
   await deny(execute(grants.rule_draft,{family:'base',decision:{...baseDraft(4),rules:{...four(),earlyGraceMinutes:{mode:'value',minutes:2}}}}),'attendance_delegated_rules_key_denied');
   await deny(execute(grants.operational_rule_draft,{family:'operational',decision:{...common('save_draft',3),siteId,scope:enterprise,expectedContext:opContext.detail.context,rules:{...eight(),locationScope:{mode:'value',value:[p.otherLocation]}}}}),'attendance_delegated_rules_reference_denied');
   const routing={correction:{delegateEmployeeId:p.other,delegateAuthUserId:p.otherAuth},missing:'owner',leave:'owner',work_arrangement:'owner'};
   await deny(execute(grants.operational_rule_draft,{family:'operational',decision:{...common('save_draft',3),siteId,scope:enterprise,expectedContext:opContext.detail.context,rules:{...eight(),reviewRouting:{mode:'value',value:routing}}}}),'attendance_delegated_rules_reference_denied');
   await deny(execute(grants.rule_draft,{family:'base',decision:baseDraft(3)}),'attendance_version_conflict');
   const beforeRpcs=rpcs;await deny(execute(grants.rule_draft,{family:'terminal',decision:{}}),'attendance_invalid_request');assert.equal(rpcs,beforeRpcs);
  });
  await group(4,async()=>{
   for(let revision=4;revision<26;revision++)assert.equal((await ownerBase(baseDraft(revision))).revision,revision+1);
   const first=await node.execute({query:history(grants.rule_draft),command:null,authUserId:p.delegateAuth,allowWrite:false});
   assert.equal(first.items.length,25);assert.equal(first.atRevision,26);assert.equal(first.nextCursor.beforeRevision,2);historyAnchor=first.nextCursor;
  });
  await group(5,async()=>{
   await foundation({siteId,mode:'write'},delegatedRulesNativeRevokeCommand(next(),grants.rule_publish));
   assert.deepEqual((await recover(grants.rule_publish,saved.rule_publish.command)).receipt,saved.rule_publish.result.receipt);
   await deny(execute(grants.rule_publish),'attendance_access_denied');await deny(recover(grants.rule_publish,saved.rule_publish.command,p.plainAuth),'attendance_access_denied');
   const future=await grant('rule_draft','base',{validFrom:profile.until,validUntil:profile.futureUntil});await deny(execute(future),'attendance_access_denied');
  });
  await group(6,async()=>{
   const branch=await save('dr206_epochs');await status(p.delegate,'disabled');await status(p.employee,'disabled');await deny(execute(grants.personal_rule_approve),'attendance_access_denied');
   assert.deepEqual((await recover(grants.personal_rule_approve,saved.personal_rule_approve.command)).receipt,saved.personal_rule_approve.result.receipt);
   const epochs=JSON.parse(await step('actual206_two_paused_generations',`select jsonb_agg(jsonb_build_object('employeeId',employee_id,'generation',generation,'paused',paused,'suspensionId',suspension_id) order by employee_id) from public.merchant_attendance_account_epochs where merchant_id=${site} and employee_id in(${quote(p.delegate)},${quote(p.employee)});`));
   assert.equal(epochs.length,2);assert(epochs.every(e=>e.generation===1&&e.paused&&e.suspensionId));
   await status(p.delegate,'active');await status(p.employee,'active');
   for(const [employeeId,authUserId,workerId]of[[p.delegate,p.delegateAuth,null],[p.employee,p.employeeAuth,p.worker]]){
    const epoch=epochs.find(e=>e.employeeId===employeeId),q={siteId,mode:'detail',afterId:null,suspensionId:epoch.suspensionId,operationId:null};
    const prepared=await ok('actual206_164_restore_prepare',`public.faolla_attendance_account_suspensions_v1(${json(q)},${owner},null,true)`);assert(prepared.detail.canRestore);
    const c={action:'restore',operationId:next(),suspensionId:epoch.suspensionId,expectedGeneration:1,workerId,expectedWorkerVersion:prepared.detail.workerVersion,expectedEmployeeVersion:prepared.detail.employeeVersion,
     employeeId,employeeAuthUserId:authUserId,reason:'Synthetic206 explicit same identity restore'};
    await ok('actual206_164_restore',`public.faolla_attendance_account_suspensions_v1(${json(q)},${owner},${json(c)},true)`,{write:true});
   }
   await deny(execute(grants.personal_rule_approve),'attendance_access_denied');
   await step('restored_both_real_generations_not_original_grant',`do $dr206_epochs$ begin assert (select count(*) from public.merchant_attendance_account_epochs where merchant_id=${site} and employee_id in(${quote(p.delegate)},${quote(p.employee)}) and generation=1 and not paused)=2;
    assert exists(select 1 from public.merchant_attendance_management_delegations g where g.merchant_id=${site} and g.grant_id=${quote(grants.personal_rule_approve)} and g.delegate_generation=0 and g.employee_generation=0 and public.faolla_attendance_management_current_v1(g,clock_timestamp()) is distinct from true);end;$dr206_epochs$;select 1;`);
   await restore('dr206_epochs',branch);
  });
  await group(7,async()=>{
   const command={family:'base',decision:{...baseDraft(26),rules:{...baseRules(),lateGraceMinutes:{mode:'value',minutes:7}}}},beforeCatalog=await step('fault_catalog_before','select '+managementAuditNativeCatalogSql(d.owned.oid)+';'),branch=await save('dr206_fault');
   await step('unique_owned_AFTER23514_fault',delegatedRulesNativeFaultSql(command.decision.operationId));await deny(execute(grants.rule_draft,command),'attendance_delegated_rules_invalid');
   assert.equal(lastRpc.error,'synthetic206_late_sidecar_failure');assert.equal(lastRpc.sqlstate,'23514');assert.equal(lastRpc.constraint,'synthetic206_owned_late_rules_fault');
   assert.equal((await recover(grants.rule_draft,command)).receipt,null);await restore('dr206_fault',branch);
   await step('fault_catalog_exact_restored',`do $dr206_catalog$ begin assert to_regprocedure('public.synthetic206_owned_late_rules_fault_v1()') is null;assert ${managementAuditNativeCatalogSql(d.owned.oid)}=${quote(beforeCatalog)};end;$dr206_catalog$;select 1;`);
   const retried=await execute(grants.rule_draft,command);assert.equal(retried.receipt.revision,27);
   const last=await node.execute({query:history(grants.rule_draft,historyAnchor),command:null,authUserId:p.delegateAuth,allowWrite:false});assert.equal(last.atRevision,26);assert.equal(last.items.length,1);assert.equal(last.items[0].item.revision,1);assert.equal(last.nextCursor,null);
   await admin({kind:'settings',values:{timeZone:'UTC',enabled:false,webClockEnabled:true,webBreakPaid:false},operationId:next(),expectedVersion:settingsVersion});
   assert.deepEqual((await recover(grants.rule_draft,command)).receipt,retried.receipt);
   await step('appendonly_originals_no_clock_source_effects',`do $dr206_immutable$ declare denied boolean:=false;begin
    begin update public.merchant_attendance_rule_operations set snapshot=snapshot where merchant_id=${site};exception when others then assert sqlerrm='attendance_events_append_only';denied:=true;end;assert denied;
    denied:=false;begin update public.merchant_attendance_management_delegation_operations set business_revision=business_revision where merchant_id=${site};exception when others then assert sqlerrm='attendance_events_append_only';denied:=true;end;assert denied;
    assert ${raw}=${quote(rawBaseline)},'dr206_clock_source_side_effect';${preserve}${external}end;$dr206_immutable$;select 1;`);
  });
   assert.equal(groups.length,8);assert(rpcs<=90&&steps<140);await step('rollback','rollback;');
  return{phase:206,groups,steps,rpcs,reads,writes,rejections,timing:timing.snapshot(),seedRows:7,newSite:siteId,rollbackRestored:true,actualNodeCoordinator:true,actualOwnerGrants:true,actualEightDelegatedActions:true,
   actualBusinessActorAndSidecar:true,actualDualGenerations:true,actualAnchored26History:true,receiptOnlyRecovery:true,late23514AtomicFailure:true,noClockSourceSideEffects:true,realAuth:false,browser:false,production:false,
   missingCoverage:['Real Auth/UI, settings-lock competition, expiry by elapsed wall time, group/personal operational publications and raw26-publication refusal are not claimed by this one bounded enterprise/personal rollback fixture',
    'Conservative delegated routing: a future segment whose before state is inherit/default cannot introduce a nonowner pair; an owner must handle that case. Preview remains candidate-only, not authority to publish.']};
 }catch(error){primaryError=failure(error);throw primaryError;}
 finally{try{await delegatedRulesNativeCleanup(connection,pendingStep,[
   ['facts',()=>assert.equal(d.fingerprint(),baseline,'dr206_full_rollback_facts')],
   ['definitions',()=>assert.equal(d.definitions(),definitions)],['catalog',()=>assert.equal(d.tableCatalog(),catalog)],
   ['archive155',async()=>assert.deepEqual(periodContinuationArchiveBytes(await archive()),old155)],
   ['archive207',async()=>assert.deepEqual(periodContinuationArchiveBytes(await periodArchive()),old207)],
  ],primaryError);}catch(error){throw failure(error);}}
}
