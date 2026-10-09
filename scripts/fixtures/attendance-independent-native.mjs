//196 INERT finite acceptance source. All facts are synthetic, in the existing
//owned namespace. Core rolls back; two PID races require tiny new-site commits
//and are explicitly cleaned by the owning parent, not append-only DELETEs.
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {createRequire} from 'node:module';
import {assertLifecycleSandbox,lifecycleId as id,lifecycleJson as json} from '../merchant-attendance-lifecycle-native-support.mjs';
import {quote} from './attendance-bound-clocks-native.mjs';
import {outageNativeFingerprintSql} from './attendance-outage-native.mjs';
import {periodContinuationSerialization} from './attendance-period-continuation-native.mjs';
import {independentNativeBudget} from '../merchant-attendance-independent-native.mjs';
import {createIndependentNativeProtection} from './attendance-independent-native-protection.mjs';

const require=createRequire(import.meta.url),uid=n=>id(246800000+n),sha=s=>createHash('sha256').update(s).digest('hex');
//Deliberately synthetic, not KDF. Explicit fields keep equivalent bindings
//identical across the owner issue and terminal read DTO property orders.
export const independentNativeSyntheticVerifier=(value,salt,binding)=>sha(JSON.stringify([
 'synthetic196-not-KDF',value,salt,binding.siteId,binding.workerId,binding.subjectId,binding.generation,binding.credentialRevision,
]));
export const independentNativeSite='99990198';
export const independentNativeIds=Object.freeze({role:uid(1),location:uid(2),terminal:uid(3),otherOwner:uid(4),
 main:Object.freeze({subject:uid(10),worker:uid(11),employee:uid(12),auth:uid(13),workerNo:'SYNTHETIC196-MAIN'}),
 self:Object.freeze({subject:uid(20),worker:uid(21),employee:uid(22),auth:uid(23),workerNo:'SYNTHETIC196-SELF'}),
 pin:Object.freeze({subject:uid(30),worker:uid(31),employee:uid(32),auth:uid(33),workerNo:'SYNTHETIC196-PIN'}),
 onsite:Object.freeze({subject:uid(40),worker:uid(41),employee:uid(42),auth:uid(43),workerNo:'SYNTHETIC196-ONSITE'}),
 locationWorker:Object.freeze({subject:uid(50),worker:uid(51),employee:uid(52),auth:uid(53),workerNo:'SYNTHETIC196-GEO'}),
 raceRevoke:Object.freeze({subject:uid(60),worker:uid(61),employee:uid(62),auth:uid(63),workerNo:'SYNTHETIC196-R-REVOKE'}),
 raceBind:Object.freeze({subject:uid(70),worker:uid(71),employee:uid(72),auth:uid(73),workerNo:'SYNTHETIC196-R-BIND'})});
export const independentNativeGroups=Object.freeze([
 'A_owner_disabled_create_issue_enable_exact_replay',
 'B_four_actions_loss_recovery_complete_raw_personal',
 'C_finite_auth_scope_geofence_employment_flag_shared_budget',
 'D_sidecar_atomicity_null_nonadoption_private_acl_immutability',
 'E_generation_revocation_owner_handoff_minimal_recovery',
 'F_four_old_channels_before_after_exact_closed_binding',
 'G_revoke_holder_finish_waiter_exact_pid',
 'H_clock_holder_bind_waiter_exact_pid_final_protection',
]);
export const independentNativeAcceptanceCaps=Object.freeze({rpcCalls:180,businessSqlSteps:250,pidPollsPerRace:34,pidPollIntervalMs:75,pidPollDeadlineMs:2500});
//SOURCE forecast, not execution evidence. Runtime verifies each group's actual
//RPC delta and reports every SQL/RPC dispatch independently.
export const independentNativeRpcPlan=Object.freeze({groups:Object.freeze([23,19,9,5,16,80,16,12]),total:180,
 owner:Object.freeze({detail:30,candidates:2,history:2,recover:12,write:34,total:80}),terminal:Object.freeze({begin:41,finish:30,total:71}),oldAndSetup:29,
 raceIncluded:Object.freeze({ownerWrite:2,terminalFinish:2}),businessSqlEstimate:233});

//Two actual RPC transactions, not pre-acquired artificial locks. The main
//connection is closed first; two participants + one read-only observer is max3.
export async function independentNativePidRace({connect,query,sql},holderSql,waiterSql){
 const holder=connect();let waiter,waiting;
 try{
  waiter=connect();assert.match(waiter.name,/^attendance_race_[a-f0-9]{32}$/);
  const pid=Number(await holder.step('select pg_backend_pid();'));assert(Number.isSafeInteger(pid)&&pid>0);
  const left=await holder.step(sql('begin;'+holderSql));
  waiting=waiter.step(sql('begin;'+waiterSql+'commit;')).then(output=>({output,error:null}),error=>({output:null,error}));
  let witnessed=false,polls=0;const until=Date.now()+independentNativeAcceptanceCaps.pidPollDeadlineMs;
  while(polls<independentNativeAcceptanceCaps.pidPollsPerRace&&Date.now()<until){
   polls++;witnessed=query(`select count(*) from pg_stat_activity where application_name=${quote(waiter.name)} and wait_event_type='Lock' and ${pid}=any(pg_blocking_pids(pid));`)==='1';
   if(witnessed)break;
   if(polls<independentNativeAcceptanceCaps.pidPollsPerRace)await new Promise(resolve=>setTimeout(resolve,independentNativeAcceptanceCaps.pidPollIntervalMs));
  }
  assert(witnessed,'independent_actual_blocking_PID_not_witnessed');await holder.step('commit;');return{left,right:await waiting,witnessed,polls};
 }finally{await Promise.all([holder.close(),waiter?.close()]);if(waiting)await waiting;}
}

export function independentNativeOutsideSql(names,site=independentNativeSite){
 assert.equal(site,independentNativeSite);
 return `(select md5(jsonb_object_agg(n,rows order by n)::text) from (${names.map(n=>{
  assert(/^(?:merchants|faolla_schema_migrations|merchant_[a-z0-9_]+)$/.test(n));
  const where=n==='merchants'?`x.id<>${quote(site)}`:n==='faolla_schema_migrations'?'true':n==='merchant_attendance_location_results'?
   `exists(select 1 from public.merchant_attendance_events e where e.id=x.event_id and e.merchant_id<>${quote(site)})`:`x.merchant_id<>${quote(site)}`;
  return `select ${quote(n)} n,(select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]'::jsonb) from public.${n} x where ${where}) rows`;
 }).join(' union all ')}) independent_originals)`;
}

//Exact RPC keys, not object insertion order, define the database adapter. The
//three RPCs are the ONLY independent service surface; private helpers stay private.
export function independentNativeRpcExpression(name,a){
 let keys,values;
 if(name==='faolla_attendance_independent_admin_v1'){
  keys=['p_site','p_auth','p_query','p_command','p_material','p_allow_new'];
  values=[quote(a.p_site),quote(a.p_auth),json(a.p_query),json(a.p_command),json(a.p_material),a.p_allow_new];
 }else if(name==='faolla_attendance_independent_begin_v1'){
  keys=['p_site','p_terminal','p_secret_hash','p_no','p_lease','p_allow_new'];
  values=[quote(a.p_site),quote(a.p_terminal),quote(a.p_secret_hash),quote(a.p_no),quote(a.p_lease),a.p_allow_new];
 }else if(name==='faolla_attendance_independent_finish_v1'){
  keys=['p_site','p_terminal','p_secret_hash','p_no','p_lease','p_verified','p_request','p_allow_new'];
  values=[quote(a.p_site),quote(a.p_terminal),quote(a.p_secret_hash),quote(a.p_no),quote(a.p_lease),a.p_verified,json(a.p_request),a.p_allow_new];
 }else throw Error('independent_native_RPC_not_allowed');
 assert.deepEqual(Object.keys(a).sort(),keys.sort());assert.equal(a.p_site,independentNativeSite);assert.equal(typeof a.p_allow_new,'boolean');
 if(keys.includes('p_verified'))assert.equal(typeof a.p_verified,'boolean');
 return `public.${name}(${values.join(',')})`;
}

export async function verifyIndependentWorkersNative(ctx={}){
 const {d,h,native,scope}=ctx;
 assert(d?.syntheticOnly===true&&h?.syntheticOnly===true,'independent_synthetic_context_required');
 const audit=ctx.independentAudit??createIndependentNativeProtection(ctx);
 assert.deepEqual(assertLifecycleSandbox(s=>audit.run('fixture_owned_schema',s)),d.owned);assert.equal(scope.schema,d.owned.schema);
 const pure=require('../../src/lib/merchantAttendanceIndependent.ts');
 const {createIndependentAttendanceService}=require('../../src/lib/merchantAttendanceIndependent.server.ts');
 const {independentAttendanceMaterialCommitment}=require('../../src/lib/merchantAttendanceIndependentPinKdf.server.ts');
 const {terminalHash}=require('../../src/lib/merchantAttendanceTerminal.server.ts');
 const {parseAttendanceSelfResult}=require('../../src/lib/merchantAttendanceSelf.ts');
 const {parsePinClockResult}=require('../../src/lib/merchantAttendancePinClock.ts');
 const {parseOnsiteClockResult,parseOnsiteClaims}=require('../../src/lib/merchantAttendanceOnsiteQr.ts');
 const {executeAttendanceLocationClock}=require('../../src/lib/merchantAttendanceLocationClock.server.ts');
 const p=independentNativeIds,siteId=independentNativeSite,site=quote(siteId),owner=quote(d.owner),names=audit.inventory();
 const definitions=audit.definitions(),catalog=audit.catalog(),baseline=audit.fingerprint(names);
 const old155=await audit.archiveBytes('155'),old207=await audit.archiveBytes('207');
 const noMerchant=()=>audit.run('unused_site',`select count(*) from public.merchants where id=${site};`);assert.equal(noMerchant(),'0','independent_unused_site_required');
 const scoped=JSON.parse(audit.run('relation_scope_inventory',`select coalesce(jsonb_agg(c.relname order by c.relname),'[]') from pg_class c where c.relnamespace=${d.owned.oid}
  and c.relkind in('r','p') and c.relname<>all(array['merchants','faolla_schema_migrations']) and not exists(select 1 from pg_attribute a where a.attrelid=c.oid and a.attname='merchant_id' and not a.attisdropped);`));
 assert.deepEqual(scoped,['merchant_attendance_location_results']);
 const outside=independentNativeOutsideSql(names),outsideBefore=audit.run('fixture_outside_before',`select ${outside};`);
 const all=outageNativeFingerprintSql(names),authTables=['merchant_attendance_pin_attempts','merchant_attendance_pin_credentials','merchant_attendance_independent_credentials','merchant_attendance_independent_leases'];
 const business=outageNativeFingerprintSql(names.filter(n=>!authTables.includes(n)));
 const prefix=periodContinuationSerialization+d.guard+"set local lock_timeout='3s';set local statement_timeout='10s';";
 const secret=randomBytes(32).toString('base64url'),pair=randomBytes(32).toString('base64url'),pin='19619619',secretHash=terminalHash(secret);
 // Use an already-supported transport ceiling. The independent fixture's
 // original 120s deadline below still bounds every logical/SQL operation;
 // do not broaden the shared connection-options allowlist.
 const deadline=Date.now()+independentNativeBudget.milliseconds;let phaseDeadline=deadline,connection=native.connect({lifetimeMs:180000});
 let serial=100,steps=0,sqlSteps=0,rpcCalls=0,reads=0,writes=0,rejections=0,stage='begin',coreRollbackRestored=false,flag=true,replay=false,lastCode=null,lastMetadata=null,operationDepth=0;
 const groups=[],groupStats=[],rpcByName={},rpcCategories={ownerDetail:0,ownerCandidates:0,ownerHistory:0,ownerRecover:0,ownerWrite:0,terminalBegin:0,terminalFinish:0,oldAndSetup:0};let priorGroupRpc=0;const next=()=>uid(++serial);
 const mark=index=>{const actual=rpcCalls-priorGroupRpc;assert.equal(actual,independentNativeRpcPlan.groups[index],'independent_group_RPC_forecast_drift:'+index);
  groups.push(independentNativeGroups[index]);groupStats.push({group:independentNativeGroups[index],rpcCalls:actual});priorGroupRpc=rpcCalls;};
 const charge=label=>{stage=label;assert(++steps<=independentNativeBudget.logicalSteps,'independent_max180_steps');assert(Date.now()<deadline,'independent_120s_deadline');assert(Date.now()<phaseDeadline,'independent_phase_deadline');};
 const step=async(label,sql)=>{assert(++sqlSteps<=independentNativeAcceptanceCaps.businessSqlSteps,'independent_max250_business_SQL');if(!operationDepth)charge(label);assert(Date.now()<deadline,'independent_120s_deadline');assert(Date.now()<phaseDeadline,'independent_phase_deadline');return connection.step(scope.sql(sql));};
 //One production coordinator call is one logical operation but every internal
 //RPC and SQL round-trip is counted separately. No assertion hides a write.
 const operation=async(label,run)=>{charge(label);operationDepth++;try{return await run();}finally{operationDepth--;}};
 const callSql=(expression,{write=false,auth=false,replayOnly=false,prepare=''}={})=>`do $ind196_call$ declare before_hash text;v jsonb;failure text;sqlstate_value text;constraint_value text;prepared_command jsonb;begin
  before_hash:=${auth?business:all};${prepare}begin set local role service_role;assert current_user='service_role';v:=${expression};set constraints all immediate;set constraints all deferred;
  exception when others then get stacked diagnostics failure=message_text,sqlstate_value=returned_sqlstate,constraint_value=constraint_name;end;reset role;
  if failure is not null or v ? 'error' or ${!write||replayOnly} then assert ${auth?business:all}=before_hash,'ind196_read_reject_replay_changed_business';end if;
  assert ${outside}=${quote(outsideBefore)},'ind196_preexisting_fact_changed';
  perform set_config('faolla.ind196_result',jsonb_build_object('value',v,'error',failure,'sqlstate',sqlstate_value,'constraint',constraint_value)::text,true);
 end;$ind196_call$;select current_setting('faolla.ind196_result')::jsonb;`;
 let committed=false;
 const call=async(label,expression,options={})=>{
  const text=callSql(expression,options),r=JSON.parse(await step(label,committed?`begin;${prefix}${text}commit;`:text));
  lastCode=r.error??r.value?.error??null;lastMetadata={sqlstate:r.sqlstate,constraint:r.constraint};if(lastCode)rejections++;else if(options.write)writes++;else reads++;return r;
 };
 const countRpc=(name,args={})=>{assert(++rpcCalls<=independentNativeAcceptanceCaps.rpcCalls,'independent_max180_actual_RPC');rpcByName[name]=(rpcByName[name]??0)+1;
  const category=name==='faolla_attendance_independent_admin_v1'?(args.p_command?'ownerWrite':args.p_query.mode==='detail'?'ownerDetail':['members','locations'].includes(args.p_query.mode)?'ownerCandidates':args.p_query.mode==='history'?'ownerHistory':'ownerRecover'):
   name==='faolla_attendance_independent_begin_v1'?'terminalBegin':name==='faolla_attendance_independent_finish_v1'?'terminalFinish':'oldAndSetup';rpcCategories[category]++;};
 const raw=async(label,name,args,options={})=>{countRpc(name,args);return call(label,independentNativeRpcExpression(name,args),options);};
 const ok=async(label,expression,options={})=>{const r=await call(label,expression,options);assert.equal(r.error,null,label+':'+r.error);assert(!r.value?.error,label+':'+r.value?.error);return r.value;};
 const service={rpc:async(name,args)=>{
  const auth=name!=='faolla_attendance_independent_admin_v1';const write=!!args.p_command||args.p_request?.kind==='clock';
  const r=await raw('rpc_'+name+'_'+(args.p_command?.action??args.p_request?.kind??args.p_query?.mode??'begin'),name,args,{auth,write,replayOnly:replay});
  return{data:r.value,error:r.error?{message:r.error}:null};
 }};
 //Synthetic verifier injection tests SQL/server coordination, NOT real KDF/PIN
 //cryptography. Production defaults remain untouched; no pepper is read here.
 const verifier=independentNativeSyntheticVerifier;
 const engine=createIndependentAttendanceService(service,{environment:()=>({FAOLLA_ATTENDANCE_INDEPENDENT_WORKERS_ENABLED:flag?'1':'0',FAOLLA_ATTENDANCE_INDEPENDENT_WORKERS_SITE_IDS:siteId}),
  issuePin:async(value,binding,operationId)=>{const salt=sha(JSON.stringify(['synthetic196-salt',binding,operationId])).slice(0,32),v=verifier(value,salt,binding);
   return{salt,verifier:v,commitment:independentAttendanceMaterialCommitment(binding,operationId,salt,v)};},
  checkPin:async(value,salt,binding,saved)=>verifier(value,salt,binding)===saved});
 const q=subject=>({siteId,mode:'detail',subjectId:subject.subject});
 const ownerCall=(query,command=null,value=null,auth=d.owner,allow=true)=>operation('owner_'+(command?.action??query.mode),()=>engine.executeAdmin({query,command,pin:value,authUserId:auth,allowNew:allow}));
 const detail=subject=>ownerCall(q(subject));
 const command=(subject,home,action,patch={})=>({action,operationId:next(),subjectId:subject.subject,
  expectedSubjectRevision:home.data.subject.revision,expectedGeneration:home.data.subject.generation,expectedWorkerVersion:home.data.subject.workerVersion,
  expectedSettingsVersion:home.settingsVersion,reason:'Synthetic196 actual '+action,...(['issue_pin','revoke_pin','bind_member'].includes(action)?{expectedCredentialRevision:home.data.credential.revision}:{}),...patch});
 const change=async(subject,action,patch={})=>{const home=await detail(subject),c=command(subject,home,action,patch);const r=await ownerCall(q(subject),c,action==='issue_pin'?pin:null);return{home,command:c,result:r};};
 const terminal=(subject,request={kind:'state'},value=pin,allow=true)=>operation('terminal_'+request.kind,()=>engine.executeTerminal({siteId,terminalId:p.terminal,workerNo:subject.workerNo,pin:value,request},{siteId,terminalId:p.terminal,secret,allowNew:allow}));
 const clockCommand=(subject,state,action,patch={})=>pure.parseIndependentClockCommand({operationId:next(),subjectId:subject.subject,workerId:subject.worker,
  generation:state.data.subject.generation,credentialId:state.data.subject.credentialId,credentialRevision:state.data.subject.credentialRevision,
  expectedWorkerVersion:state.data.subject.workerVersion,expectedSettingsVersion:state.data.subject.settingsVersion,locationId:state.data.subject.locationId,
  expectedLocationVersion:state.data.subject.locationVersion,expectedSequence:state.data.head.sequence,action,breakPaid:action==='break_start'?false:null,...patch});
 const deny=async(run,code)=>{await assert.rejects(run,error=>error.code===code);if(lastCode!==null)assert.equal(lastCode,code);};
 const save=async name=>{assert(/^[a-z0-9_]+$/.test(name));return step('save_'+name,`savepoint ${name};select ${all};`);};
 const restore=async(name,hash)=>assert.equal(await step('restore_'+name,`rollback to savepoint ${name};release savepoint ${name};select ${all};`),hash);
 const identities=[p.main,p.self,p.pin,p.onsite,p.locationWorker,p.raceRevoke,p.raceBind];
 const fixedUuids=[p.role,p.location,p.terminal,p.otherOwner,...identities.flatMap(v=>[v.subject,v.worker,v.employee,v.auth])];assert.equal(new Set(fixedUuids).size,32);
 const seed=()=>`do $ind196_unused$ declare n text;found_uuid boolean;begin assert current_user='postgres';assert not exists(select 1 from public.merchants where id=${site});
  for n in select unnest(array[${names.map(quote).join(',')}]) loop
   execute format('select exists(select 1 from %I.%I x where to_jsonb(x)::text ~ $1)',${quote(scope.schema)},n) into found_uuid using ${quote(fixedUuids.join('|'))};
   assert not found_uuid,'ind196_all_fixed_UUIDs_must_be_unused';
  end loop;
  assert not exists(select 1 from public.merchant_enterprise_roles where id=${quote(p.role)});
  assert not exists(select 1 from public.merchant_attendance_locations where id=${quote(p.location)});
  assert not exists(select 1 from public.merchant_attendance_terminals where id=${quote(p.terminal)});
  assert not exists(select 1 from public.merchant_enterprise_employees where id=any(array[${identities.map(v=>quote(v.employee)).join(',')}]::uuid[]) or auth_user_id=any(array[${identities.map(v=>quote(v.auth)).join(',')}]::uuid[]));
  assert not exists(select 1 from public.merchant_attendance_workers where id=any(array[${identities.map(v=>quote(v.worker)).join(',')}]::uuid[]));
  assert not exists(select 1 from public.merchant_attendance_independent_subjects where subject_id=any(array[${identities.map(v=>quote(v.subject)).join(',')}]::uuid[]));end;$ind196_unused$;
  insert into public.merchants(id,user_id,name,email) values(${site},${owner},'Synthetic196 independent','synthetic196@example.test');
  insert into public.merchant_enterprise_roles(id,merchant_id,name,permissions) values(${quote(p.role)},${site},'Synthetic196 explicit self',array['enterprise.view','attendance.self.view','attendance.self.clock']);
  insert into public.merchant_enterprise_employees(id,merchant_id,auth_user_id,email,display_name,role_id,status,accepted_at,version) values
   ${identities.map((v,i)=>`(${quote(v.employee)},${site},${quote(v.auth)},${quote('synthetic196-'+i+'@example.test')},'Synthetic196 existing accepted target',${quote(p.role)},'active',clock_timestamp(),1)`).join(',')};select (clock_timestamp() at time zone 'UTC')::date::text;`;
 const admin=async(kind,values)=>{countRpc('faolla_attendance_admin_v1');return ok('setup_admin_'+kind,`public.faolla_attendance_admin_v1(${site},${owner},'{"view":"workers","cursor":null,"search":""}'::jsonb,prepared_command,null)`,{write:true,
  prepare:`prepared_command:=jsonb_build_object('kind',${quote(kind)},'operationId',${quote(next())},'expectedVersion',coalesce((select version from public.merchant_attendance_settings where merchant_id=${site}),0),'values',${json(values)});`});};
 const setup=async()=>{
  //Capture the real database day in the existing setup dispatch, not a second
  //SQL/logical step. The subsequent RPC results must not replace this value.
  const today=await step('new_site_setup',committed?`begin;${prefix}${seed()}commit;`:seed());
  await admin('settings',{timeZone:'UTC',enabled:true,webClockEnabled:true,webBreakPaid:false});
  await admin('location',{id:p.location,name:'Synthetic196 plain place',timeZone:'UTC',active:true});
  countRpc('faolla_attendance_terminal_admin_v1');await ok('terminal_create',`public.faolla_attendance_terminal_admin_v1(${site},${owner},'{"terminalId":null,"cursor":null}'::jsonb,${json({action:'create',terminalId:p.terminal,locationId:p.location,label:'Synthetic196 terminal',pairHash:terminalHash(pair)})},true)`,{write:true});
  countRpc('faolla_attendance_terminal_device_v1');await ok('terminal_pair',`public.faolla_attendance_terminal_device_v1(${site},${quote(p.terminal)},${quote(terminalHash(pair))},${quote(secretHash)},true)`,{write:true});
  return today;
 };
 const create=async(subject)=>{
  const settings=Number(await step('create_settings_version',`${committed?'begin;'+prefix:''}select version from public.merchant_attendance_settings where merchant_id=${site};${committed?'commit;':''}`));
  const c={action:'create',operationId:next(),subjectId:subject.subject,workerId:subject.worker,expectedSettingsVersion:settings,
   workerNo:subject.workerNo,displayName:'Synthetic196 '+subject.workerNo,locationId:p.location,startsOn:'2000-01-01',reason:'Synthetic196 explicit create'};
  const result=await ownerCall(q(subject),c),home=await detail(subject);assert.equal(home.data.subject.enabled,false);assert.equal(home.data.subject.generation,0);assert.equal(home.data.subject.workerVersion,1);
  return{command:c,result,home};
 };
 const usable=async(subject)=>{
  const created=await create(subject),issue=command(subject,created.home,'issue_pin'),issued=await ownerCall(q(subject),issue,pin);
  //The saved receipt is the exact CAS returned by the real writer. Building the
  //next command from it is not synthesizing a read DTO or bypassing SQL checks.
  const r=issued.receipt,enable={action:'enable',operationId:next(),subjectId:subject.subject,expectedSubjectRevision:r.subjectRevision,
   expectedGeneration:r.generation,expectedWorkerVersion:r.workerVersion,expectedSettingsVersion:created.home.settingsVersion,reason:'Synthetic196 explicit enable after receipt'};
  await ownerCall(q(subject),enable);return terminal(subject);
 };
 const beginArgs=(subject,lease)=>({p_site:siteId,p_terminal:p.terminal,p_secret_hash:secretHash,p_no:subject.workerNo,p_lease:lease,p_allow_new:true});
 const finishArgs=(subject,lease,request,allow=true)=>({...beginArgs(subject,lease),p_verified:true,p_request:request,p_allow_new:allow});
 const directOk=async(label,name,args,options={})=>{const r=await raw(label,name,args,options);assert.equal(r.error,null,label+':'+r.error);assert(!r.value?.error,label+':'+r.value?.error);return r.value;};
 const probe=async(label,sql,run)=>{const hash=await save(label);try{await step('mutate_'+label,sql+'select 1;');await run();}finally{await restore(label,hash);}};
 let mainState,originalReceipt,mainCreate,mainIssue,mainToday;
 try{
  await step('begin',`begin;${prefix}select 1;`);mainToday=await setup();
  const members=await ownerCall({siteId,mode:'members',cursor:null,search:''},null,null,d.owner,false);
  assert.equal(members.data.kind,'members');assert.deepEqual(members.data.items.map(v=>[v.employeeId,v.authUserId]),identities.map(v=>[v.employee,v.auth]));assert.equal(members.data.nextCursor,null);
  const locations=await ownerCall({siteId,mode:'locations',cursor:null,search:''},null,null,d.owner,false);
  assert.deepEqual(locations.data,{kind:'locations',items:[{locationId:p.location,name:'Synthetic196 plain place',timeZone:'UTC'}],nextCursor:null});
  mainCreate=await create(p.main);
  await deny(()=>terminal(p.main),'attendance_pin_invalid');
  const issueFromCreate=command(p.main,mainCreate.home,'issue_pin');mainIssue={home:mainCreate.home,command:issueFromCreate,result:await ownerCall(q(p.main),issueFromCreate,pin)};
  await change(p.main,'enable');mainState=await terminal(p.main);
  assert.equal(mainState.data.head.sequence,0);assert.equal(mainState.data.head.status,'off');
  replay=true;try{assert.deepEqual((await ownerCall(q(p.main),mainCreate.command)).receipt,mainCreate.result.receipt);
   assert.deepEqual((await ownerCall(q(p.main),mainIssue.command,pin)).receipt,mainIssue.result.receipt);}finally{replay=false;}
  await deny(()=>ownerCall(q(p.main),mainIssue.command,'00000000'),'attendance_operation_conflict');
  mark(0);
  const mainReadyHash=await save('main_ready');
  for(const action of ['clock_in','break_start','break_end','clock_out']){
   if(action==='break_end')flag=false; //Gate-off authenticates and safely finishes, never starts a new span.
   const c=clockCommand(p.main,mainState,action);mainState=await terminal(p.main,{kind:'clock',command:c});
   assert.equal(mainState.data.receipt.event.actorEmployeeId,null);assert.equal(mainState.data.receipt.source.subjectId,p.main.subject);
   if(action==='clock_in')originalReceipt=mainState.data.receipt;
  }
  assert.equal(mainState.data.head.sequence,4);assert.equal(mainState.data.head.status,'off');
  await deny(()=>terminal(p.main,{kind:'clock',command:clockCommand(p.main,mainState,'clock_in')}),'attendance_independent_disabled');
  replay=true;try{assert.deepEqual((await terminal(p.main,{kind:'clock',command:originalReceipt.command})).data.receipt,originalReceipt);}finally{replay=false;}
  assert.deepEqual((await terminal(p.main,{kind:'recover',subjectId:p.main.subject,workerId:p.main.worker,operationId:originalReceipt.operationId,commandFingerprint:originalReceipt.commandFingerprint})).data.receipt,originalReceipt);
  const personal=await terminal(p.main,{kind:'personal',subjectId:p.main.subject,workerId:p.main.worker,fromDate:mainToday,throughDate:mainToday,cursor:null});
  assert.equal(personal.data.report.items.length,1);assert.equal(personal.data.report.items[0].events.length,4);assert(personal.data.report.items[0].complete&&personal.data.report.rangeComplete);
  assert.equal(personal.data.report.rulesAssessment,'unassessed');assert.equal(personal.data.report.fixedPeriodEligible,false);
  const ownerReport=await ownerCall({siteId,mode:'history',subjectId:p.main.subject,fromDate:mainToday,throughDate:mainToday,cursor:null});
  assert.deepEqual(ownerReport.data.report.items,personal.data.report.items);
  flag=true;await restore('main_ready',mainReadyHash);mainState=await terminal(p.main);mark(1);
  //Each finite denial branch returns exactly to the same successful state.
  await probe('wrong_pin','',()=>deny(()=>terminal(p.main,{kind:'state'},'00000000'),'attendance_pin_invalid'));
  await probe('geofence',`update public.merchant_attendance_locations set latitude=37.3,longitude=-5.9,radius_meters=100 where merchant_id=${site} and id=${quote(p.location)};`,()=>deny(()=>terminal(p.main),'attendance_pin_invalid'));
  await probe('employment',`update public.merchant_attendance_employment_periods set starts_on='2099-01-01' where merchant_id=${site} and worker_id=${quote(p.main.worker)};`,()=>deny(()=>terminal(p.main),'attendance_pin_invalid'));
  await probe('shared60',`update public.merchant_attendance_pin_attempts set attempts=60 where merchant_id=${site} and terminal_id=${quote(p.terminal)};`,()=>deny(()=>terminal(p.main),'attendance_pin_invalid'));
  await probe('credential10',`update public.merchant_attendance_independent_credentials set attempts=10 where merchant_id=${site} and subject_id=${quote(p.main.subject)};`,()=>deny(()=>terminal(p.main),'attendance_pin_invalid'));
  await probe('shared_old_begin','',async()=>{
   const lease=next(),b=await directOk('new_ind_lease','faolla_attendance_independent_begin_v1',beginArgs(p.main,lease),{auth:true});assert(b.allowed);
   countRpc('faolla_attendance_pin_begin_v1');const old=await ok('old_begin_invalidates_new_ordinal',`public.faolla_attendance_pin_begin_v1(${site},${quote(p.terminal)},${quote(secretHash)},'SYNTHETIC196-UNKNOWN',${quote(next())},true)`,{auth:true});assert(old.denied);
   const lost=await raw('old_budget_invalidates_new_finish','faolla_attendance_independent_finish_v1',finishArgs(p.main,lease,{kind:'state'}),{auth:true});assert.equal(lost.value.error,'attendance_pin_invalid');
  });
  mark(2);
  const faultHash=await save('source_fault'),fault=clockCommand(p.main,mainState,'clock_in'),constraint='ind196_owned_exact_source_fault';
  try{await step('source_fault_constraint',`alter table public.merchant_attendance_independent_event_sources add constraint ${constraint} check(operation_id<>${quote(fault.operationId)}::uuid) not valid;select 1;`);
   await assert.rejects(()=>terminal(p.main,{kind:'clock',command:fault}),error=>error.code==='attendance_independent_invalid');
   assert.deepEqual(lastMetadata,{sqlstate:'23514',constraint});
   await step('source_fault_no_orphan',`do $ind196_atomic$ begin assert not exists(select 1 from public.merchant_attendance_events where merchant_id=${site} and operation_id=${quote(fault.operationId)});
    assert not exists(select 1 from public.merchant_attendance_independent_event_sources where merchant_id=${site} and operation_id=${quote(fault.operationId)});end;$ind196_atomic$;select 1;`);
  }finally{await restore('source_fault',faultHash);}
  await probe('legacy_null','',async()=>{
   await step('disclosed_new_null_without_sidecar',`insert into public.merchant_attendance_events(merchant_id,worker_id,location_id,operation_id,sequence,action,source,break_paid,occurred_at,received_at,time_zone,actor_employee_id)
    values(${site},${quote(p.main.worker)},${quote(p.location)},${quote(next())},1,'clock_in','kiosk',null,clock_timestamp(),clock_timestamp(),'UTC',null);select 1;`);
   await deny(()=>terminal(p.main),'attendance_independent_identity_changed');
   await deny(()=>ownerCall({siteId,mode:'history',subjectId:p.main.subject,fromDate:mainToday,throughDate:mainToday,cursor:null}),'attendance_independent_identity_changed');
  });
  await step('private_acl_immutable',`do $ind196_private$ declare failed boolean;begin
   begin set local role service_role;perform public.faolla_attendance_independent_head_v1(${site},${quote(p.main.worker)},${quote(p.main.subject)});raise exception 'ind196_private_execute_allowed';exception when insufficient_privilege then null;end;reset role;
   begin set local role service_role;update public.merchant_attendance_independent_subjects set enabled=enabled where merchant_id=${site};raise exception 'ind196_private_dml_allowed';exception when insufficient_privilege then null;end;reset role;
   begin update public.merchant_attendance_independent_entries set command=command where merchant_id=${site};raise exception 'ind196_ledger_rewrite_allowed';exception when raise_exception then if sqlerrm<>'attendance_independent_immutable' then raise;end if;end;
  end;$ind196_private$;select 1;`);
  mark(3);
  //The actual state just read after rollback already binds these credential
  //values. Reuse it instead of spending a duplicate owner detail RPC in group E.
  const oldGeneration=mainState.data.subject.generation,oldCredential={revision:mainState.data.subject.credentialRevision,credentialId:mainState.data.subject.credentialId};
  await change(p.main,'disable');await change(p.main,'enable');await deny(()=>terminal(p.main),'attendance_pin_invalid');
  const disabled=await detail(p.main);assert.equal(disabled.data.subject.generation,oldGeneration+1);assert.equal(disabled.data.credential.revision,oldCredential.revision+1);assert.equal(disabled.data.credential.credentialId,oldCredential.credentialId);assert(!disabled.data.credential.enabled);
  const reissued=await change(p.main,'issue_pin');assert.equal(reissued.result.receipt.generation,oldGeneration+1);
  const revoked=await change(p.main,'revoke_pin');assert.equal(revoked.result.receipt.generation,oldGeneration+2);await deny(()=>terminal(p.main),'attendance_pin_invalid');
  await probe('owner_handoff',`update public.merchants set user_id=${quote(p.otherOwner)} where id=${site};`,async()=>{
   await deny(()=>detail(p.main),'attendance_access_denied');
   const recovered=await ownerCall({siteId,mode:'recover',subjectId:p.main.subject,operationId:mainCreate.command.operationId},null,null,d.owner,false);assert.deepEqual(recovered.receipt,mainCreate.result.receipt);assert.deepEqual(recovered.data,{kind:'receipt'});
   const current=await ownerCall({siteId,mode:'recover',subjectId:p.main.subject,operationId:mainCreate.command.operationId},null,null,p.otherOwner,false);assert.deepEqual(current.receipt,mainCreate.result.receipt);
  });
  mark(4);
  const channels=[];
  for(const [channel,subject] of [['self',p.self],['pin',p.pin],['onsite',p.onsite],['location',p.locationWorker]]){
   let s=await usable(subject);s=await terminal(subject,{kind:'clock',command:clockCommand(subject,s,'clock_in')});s=await terminal(subject,{kind:'clock',command:clockCommand(subject,s,'clock_out')});
   const independentTail=s.data.receipt,home=await detail(subject);
   //Each actual old entry, not four copies of one reader, refuses this unbound
   //subject before the explicit owner bind. No PIN/KDF or real GPS is claimed.
   if(channel==='pin'){
    countRpc('faolla_attendance_pin_begin_v1');const before=await ok('old_pin_before_binding',`public.faolla_attendance_pin_begin_v1(${site},${quote(p.terminal)},${quote(secretHash)},${quote(subject.workerNo)},${quote(next())},true)`,{auth:true});assert.equal(before.denied,true);
   }else{
    const name=channel==='self'?'faolla_attendance_self_v1':channel==='onsite'?'faolla_attendance_onsite_clock_v1':'faolla_attendance_location_clock_v2';countRpc(name);
    const expression=channel==='self'?`public.${name}(${site},${quote(subject.auth)},null,null)`:channel==='onsite'?`public.${name}(${site},${quote(subject.auth)},null,null,null,true)`:
     `public.${name}(${site},${quote(subject.auth)},${quote(subject.worker)},null,null,null,true,false)`;
    const before=await call('old_'+channel+'_before_binding',expression);assert.equal(before.error,'attendance_access_denied');
   }
   const bind=command(subject,home,'bind_member',{targetEmployeeId:subject.employee,targetAuthUserId:subject.auth,expectedLastEventId:home.data.head.lastEventId,expectedSequence:home.data.head.sequence});
   await ownerCall(q(subject),bind);await deny(()=>terminal(subject),'attendance_pin_invalid');
   const oldInput={siteId,command:null,operationId:null};let state;
   const oldClock=async(c=null,operationId=null)=>{
    const input={...oldInput,command:c,operationId};let value;
    if(channel==='self'){
     countRpc('faolla_attendance_self_v1');value=await ok('old_self_'+(c?'clock':'state'),`public.faolla_attendance_self_v1(${site},${quote(subject.auth)},${json(c)},${quote(operationId)})`,{write:!!c});return parseAttendanceSelfResult(value,input);
    }
    if(channel==='pin'){
     const lease=next();countRpc('faolla_attendance_pin_begin_v1');const b=await ok('old_member_pin_begin',`public.faolla_attendance_pin_begin_v1(${site},${quote(p.terminal)},${quote(secretHash)},${quote(subject.workerNo)},${quote(lease)},true)`,{auth:true});assert.equal(b.workerId,subject.worker);
     countRpc('faolla_attendance_pin_clock_v1');value=await ok('old_pin_'+(c?'clock':'state'),`public.faolla_attendance_pin_clock_v1(${site},${quote(p.terminal)},${quote(secretHash)},${quote(subject.workerNo)},${quote(lease)},true,${json({command:c,operationId})},true)`,{write:!!c,auth:true});return parsePinClockResult(value,{...input,terminalId:p.terminal,workerNo:subject.workerNo});
    }
    if(channel==='onsite'){
     let claims=null;if(c){countRpc('faolla_attendance_onsite_issue_v1');const issued=await ok('old_onsite_issue',`public.faolla_attendance_onsite_issue_v1(${site},${quote(p.terminal)},${quote(secretHash)})`);
      claims=parseOnsiteClaims({v:1,purpose:'faolla.attendance.onsite',...issued,nonce:next()});}
     countRpc('faolla_attendance_onsite_clock_v1');value=await ok('old_onsite_'+(c?'clock':'state'),`public.faolla_attendance_onsite_clock_v1(${site},${quote(subject.auth)},${json(claims)},${json(c)},${quote(operationId)},true)`,{write:!!c});return parseOnsiteClockResult(value,input);
    }
    const oldService={rpc:async(name,args)=>{assert(['faolla_attendance_location_clock_v2','faolla_attendance_location_clock_bound_v1'].includes(name));countRpc(name);
     const r=await call('old_location_'+(args.p_command?'clock':'state'),`public.${name}(${site},${quote(args.p_auth_user_id)},${quote(args.p_expected_worker_id)},${json(args.p_command)},${quote(args.p_operation_id)},${json(args.p_assertion)},${args.p_allow_new_sessions},${args.p_require_clock})`,{write:!!args.p_command});return{data:r.value,error:r.error?{message:r.error}:null};}};
    return executeAttendanceLocationClock({...input,expectedWorkerId:subject.worker,authUserId:subject.auth,moduleEnabled:true},oldService);
   };
   if(channel==='pin'){
    const payload={action:'set',operationId:next(),expectedRevision:0,workerId:subject.worker,employeeId:subject.employee,salt:'19619619619619619619619619619619',verifier:'1'.repeat(64)};
    countRpc('faolla_attendance_pin_admin_v1');await ok('old_pin_synthetic_material_not_KDF',`public.faolla_attendance_pin_admin_v1(${site},${owner},${quote(subject.workerNo)},null,${json({...payload,commandHash:sha(JSON.stringify(payload))})},true)`,{write:true});
   }
   if(channel==='location'){
    await step('disclosed_new_location_fence',`update public.merchant_attendance_settings set location_clock_enabled=true where merchant_id=${site};update public.merchant_attendance_locations set latitude=37.3,longitude=-5.9,radius_meters=100 where merchant_id=${site} and id=${quote(p.location)};select 1;`);
    const values={purpose:'Synthetic196 binding location',notice:'No real GPS claim',contact:'Synthetic owner',alternative:'Manual review',retentionDays:90,latitude:37.3,longitude:-5.9,radiusMeters:100};
    countRpc('faolla_attendance_location_policy_draft_v1');await ok('old_location_draft',`public.faolla_attendance_location_policy_draft_v1(${site},${owner},${quote(p.location)},prepared_command,null,true)`,{write:true,prepare:`prepared_command:=jsonb_build_object('operationId',${quote(next())},'expectedRevision',0,'expectedSettingsVersion',(select version from public.merchant_attendance_settings where merchant_id=${site}),'expectedLocationVersion',(select version from public.merchant_attendance_locations where id=${quote(p.location)}),'values',${json(values)});`});
    const nq={access:'owner',locationId:p.location,expectedWorkerId:null,operationId:null};
    countRpc('faolla_attendance_location_notice_v1');await ok('old_location_publish',`public.faolla_attendance_location_notice_v1(${site},${owner},${json(nq)},prepared_command,true)`,{write:true,prepare:`prepared_command:=jsonb_build_object('action','publish','operationId',${quote(next())},'expectedRevision',0,'draftRevision',1,'expectedSettingsVersion',(select version from public.merchant_attendance_settings where merchant_id=${site}),'expectedLocationVersion',(select version from public.merchant_attendance_locations where id=${quote(p.location)}),'reason','Synthetic196 actual notice');`});
    countRpc('faolla_attendance_location_notice_v1');await ok('old_location_acknowledge',`public.faolla_attendance_location_notice_v1(${site},${quote(subject.auth)},${json({...nq,access:'self',expectedWorkerId:subject.worker})},${json({action:'acknowledge',operationId:next(),expectedRevision:1})},true)`,{write:true});
   }
   state=await oldClock();assert.equal(state.state.status,'off');assert.equal(state.state.sequence,2);assert.equal(state.state.lastEvent.id,independentTail.event.id);
   const c={operationId:next(),expectedWorkerId:subject.worker,locationId:p.location,expectedSequence:2,action:'clock_in',...(['pin','onsite'].includes(channel)?{expectedEmployeeId:subject.employee}:{})};
   if(channel==='location')Object.assign(c,{settingsVersion:state.policy.settingsVersion,workerVersion:state.policy.workerVersion,locationVersion:state.policy.locationVersion,noticeRevision:state.noticeGate.revision,safeFinish:false,
    position:{latitude:37.3,longitude:-5.9,accuracyMeters:10,capturedAt:new Date().toISOString()},positionFailure:null});
   const started=await oldClock(c);assert.equal(started.state.status,'working');assert.equal(started.receipt.sequence,3);
   //The old public writer's original receipt gate remains strict; the new member
   //cannot claim the earlier NULL-actor independent operation as its receipt.
   const rows=await step('old_actor_tail_exact',`select jsonb_build_object('actor',(select actor_employee_id from public.merchant_attendance_events where merchant_id=${site} and worker_id=${quote(subject.worker)} and sequence=3),
    'old',(select public.faolla_attendance_independent_clock_receipt_v1(x) from public.merchant_attendance_independent_event_sources x where event_id=${quote(independentTail.event.id)}));`);
   assert.equal(JSON.parse(rows).actor,subject.employee);assert.deepEqual(JSON.parse(rows).old,independentTail);channels.push(channel);
  }
  assert.deepEqual(channels,['self','pin','onsite','location']);mark(5);
  await step('core_rollback','rollback;');await connection.close();connection=null;
  assert.equal(audit.fingerprint(names),baseline,'independent_core_not_rolled_back');assert.equal(audit.catalog(),catalog);coreRollbackRestored=true;
  //Two real races, only newly created owned rows. No explicit/artificial locks
  //are taken to create evidence; each holder executes the actual business RPC.
  committed=true;phaseDeadline=Math.min(deadline,Date.now()+45000);connection=native.connect({lifetimeMs:90000});await setup();
  const r1=await usable(p.raceRevoke),home1=await detail(p.raceRevoke),revoke=command(p.raceRevoke,home1,'revoke_pin'),lease1=next();
  assert((await directOk('race_revoke_begin','faolla_attendance_independent_begin_v1',beginArgs(p.raceRevoke,lease1),{auth:true})).allowed);
  await connection.close();connection=null;charge('race_revoke_holder_finish_waiter');
  const racePrefix=prefix+'set local role service_role;';
  const rpc1=independentNativeRpcExpression('faolla_attendance_independent_admin_v1',{p_site:siteId,p_auth:d.owner,p_query:q(p.raceRevoke),p_command:revoke,p_material:null,p_allow_new:true});
  const finish1=finishArgs(p.raceRevoke,lease1,{kind:'clock',command:clockCommand(p.raceRevoke,r1,'clock_in')});
  const revokeArgs={p_site:siteId,p_auth:d.owner,p_query:q(p.raceRevoke),p_command:revoke,p_material:null,p_allow_new:true};
  countRpc('faolla_attendance_independent_admin_v1',revokeArgs);countRpc('faolla_attendance_independent_finish_v1',finish1);
  const raceConnection=()=>{const c=native.connect({lifetimeMs:25000});return{name:c.name,close:()=>c.close(),step:s=>{assert(++sqlSteps<=250,'independent_max250_business_SQL');assert(Date.now()<deadline&&Date.now()<phaseDeadline,'independent_phase_deadline');return c.step(s);}};};
  const race1=await independentNativePidRace({connect:raceConnection,query:s=>native.query(s),sql:scope.sql},racePrefix+'select '+rpc1+';',racePrefix+'select '+independentNativeRpcExpression('faolla_attendance_independent_finish_v1',finish1)+';');
  assert(race1.witnessed);assert.equal(race1.right.error,null);assert.equal(JSON.parse(race1.right.output).error,'attendance_pin_invalid');
  assert.equal(JSON.parse(race1.left).receipt.operationId,revoke.operationId);mark(6);
  phaseDeadline=Math.min(deadline,Date.now()+30000);connection=native.connect({lifetimeMs:90000});const r2=await usable(p.raceBind),home2=await detail(p.raceBind),lease2=next();
  const bind=command(p.raceBind,home2,'bind_member',{targetEmployeeId:p.raceBind.employee,targetAuthUserId:p.raceBind.auth,expectedLastEventId:null,expectedSequence:0});
  assert((await directOk('race_bind_begin','faolla_attendance_independent_begin_v1',beginArgs(p.raceBind,lease2),{auth:true})).allowed);
  await connection.close();connection=null;charge('race_clock_holder_bind_waiter');
  const c2=clockCommand(p.raceBind,r2,'clock_in'),bindArgs={p_site:siteId,p_auth:d.owner,p_query:q(p.raceBind),p_command:bind,p_material:null,p_allow_new:true};
  countRpc('faolla_attendance_independent_finish_v1',finishArgs(p.raceBind,lease2,{kind:'clock',command:c2}));countRpc('faolla_attendance_independent_admin_v1',bindArgs);
  const race2=await independentNativePidRace({connect:raceConnection,query:s=>native.query(s),sql:scope.sql},
   racePrefix+'select '+independentNativeRpcExpression('faolla_attendance_independent_finish_v1',finishArgs(p.raceBind,lease2,{kind:'clock',command:c2}))+';',
   racePrefix+'select '+independentNativeRpcExpression('faolla_attendance_independent_admin_v1',{p_site:siteId,p_auth:d.owner,p_query:q(p.raceBind),p_command:bind,p_material:null,p_allow_new:true})+';');
  assert(race2.witnessed&&race2.right.error);assert.match(String(race2.right.error),/attendance_open_sessions/);assert.equal(JSON.parse(race2.left).data.receipt.operationId,c2.operationId);
  charge('final_race_facts');assert(++sqlSteps<=250);const final=JSON.parse(native.query(scope.sql(`begin;${prefix}do $ind196_final$ begin assert ${outside}=${quote(outsideBefore)};
   assert not exists(select 1 from public.merchant_attendance_events where merchant_id=${site} and worker_id=${quote(p.raceRevoke.worker)});
   assert not exists(select 1 from public.merchant_attendance_independent_member_bindings where merchant_id=${site});
   assert (select count(*) from public.merchant_attendance_events where merchant_id=${site} and worker_id=${quote(p.raceBind.worker)})=1;
  end;$ind196_final$;select jsonb_build_object('events',(select count(*) from public.merchant_attendance_events where merchant_id=${site}),'sources',(select count(*) from public.merchant_attendance_independent_event_sources where merchant_id=${site}));commit;`)));
  assert.deepEqual(final,{events:1,sources:1});mark(7);assert.deepEqual(groups,independentNativeGroups);
  assert.deepEqual(rpcCategories,{ownerDetail:30,ownerCandidates:2,ownerHistory:2,ownerRecover:12,ownerWrite:34,terminalBegin:41,terminalFinish:30,oldAndSetup:29});
  return{phase:196,groups,groupStats,steps,logicalSteps:steps,sqlSteps,rpcCalls,rpcByName,rpcCategories,pidObserverQueries:race1.polls+race2.polls,reads,writes,rejections,coreRollbackRestored,exactPidRaces:2,maxConnections:3,
   fourActualOldChannelFirstStarts:channels,newMerchant:siteId,raceRawEvents:1,raceRawSources:1,microCommitsForRealRaces:true,cleanupOwnedByParent:true,
   oldFactsUnchanged:true,oldArchivesUnchanged:true,realAuth:false,hardware:false,browser:false,kdf:false,syntheticVerifierInjection:true,production:false};
 }catch(error){throw new Error('independent_native_stage:'+stage+':'+String(error?.message??error).slice(0,1800)+':code='+String(lastCode),{cause:error});}
 finally{
  if(connection){try{await connection.step('rollback;');}catch(error){if(!String(error).includes('attendance_concurrency_closed'))throw error;}finally{await connection.close();}}
  assert.equal(audit.run('fixture_outside_finally',`select ${outside};`),outsideBefore,'independent_originals_finally');assert.equal(audit.definitions(),definitions);assert.equal(audit.catalog(),catalog);
  assert.deepEqual(await audit.archiveBytes('155'),old155);assert.deepEqual(await audit.archiveBytes('207'),old207);
 }
}
