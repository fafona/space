//195 INERT, owned-schema acceptance. A is actual present-time RPC activity.
//B/C are explicitly new, constrained historical templates; never past RPCs.
//No clock/timezone change, original-row rewrite, disabled guard or second DB.
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {createRequire} from 'node:module';
import {assertLifecycleSandbox,lifecycleId as id,lifecycleJson as json} from '../merchant-attendance-lifecycle-native-support.mjs';
import {quote,boundClockRpcExpression} from './attendance-bound-clocks-native.mjs';
import {outageNativeFingerprintSql} from './attendance-outage-native.mjs';
import {periodContinuationSerialization,periodContinuationArchiveBytes} from './attendance-period-continuation-native.mjs';
import {employmentLifecycleCommandFromDetail} from './attendance-employment-lifecycle-native.mjs';
import {operationalPunchNativeFinishCommand} from './attendance-operational-punch-native.mjs';

const require=createRequire(import.meta.url),uid=n=>id(245600000+n);
export const administrativeClosureNativeSite='99990195';
export const administrativeClosureNativeTables=Object.freeze([
 'merchant_enterprise_employees','merchant_attendance_workers','merchant_attendance_employment_periods','merchant_attendance_events',
 'merchant_attendance_account_suspensions','merchant_attendance_account_epochs','merchant_attendance_account_status_operations',
 'merchant_attendance_account_restores','merchant_attendance_employment_operations',
 'merchant_attendance_administrative_closures','merchant_attendance_administrative_closure_entries',
 'merchant_attendance_shift_schedule_relations','merchant_attendance_shift_plan_adoptions']);
const ids=Object.freeze({role:uid(1),location:uid(2),geo:uid(3),terminal:uid(4),worker:uid(5),employee:uid(6),auth:uid(7)});
const shiftDate=(text,days)=>new Date(Date.parse(text.slice(0,10)+'T00:00:00Z')+days*86400000).toISOString().slice(0,10)+text.slice(10);
export function administrativeClosureNativeRpcExpression(name,args){
 assert.equal(args.p_site??args.p_site_id??args.p_query?.siteId,administrativeClosureNativeSite);
 const exact=keys=>assert.deepEqual(Object.keys(args).sort(),keys.sort());
 if(name==='faolla_attendance_period_closure_source_v1'){
  exact(['p_query','p_auth_user_id']);return `public.${name}(${json(args.p_query)},${quote(args.p_auth_user_id)})`;
 }
 if(name==='faolla_attendance_period_closure_v2'){
  exact(['p_query','p_auth_user_id','p_command','p_artifact','p_allow_write']);assert.equal(typeof args.p_allow_write,'boolean');
  return `public.${name}(${json(args.p_query)},${quote(args.p_auth_user_id)},${json(args.p_command)},${json(args.p_artifact)},${args.p_allow_write})`;
 }
 const channel=/^faolla_attendance_operational_punch_(self|pin|onsite|location)_v1$/.exec(name)?.[1];
 if(channel){
  const flags=['p_allow_new_sessions','p_allow_operational_start','p_allow_schedule','p_bind_rules'];
  exact(['p_site','p_query','p_command',...flags,...(channel==='pin'?['p_terminal','p_secret_hash','p_no','p_lease','p_verified']:['p_auth']),
   ...(channel==='location'?['p_expected_worker','p_assertion','p_require_clock']:channel==='onsite'?['p_claims']:[])]);
  for(const k of [...flags,...(channel==='pin'?['p_verified']:channel==='location'?['p_require_clock']:[])])assert.equal(typeof args[k],'boolean');
  const first=channel==='pin'?[quote(args.p_site),quote(args.p_terminal),quote(args.p_secret_hash),quote(args.p_no),quote(args.p_lease),args.p_verified]:
   channel==='location'?[quote(args.p_site),quote(args.p_auth),quote(args.p_expected_worker)]:
   channel==='onsite'?[quote(args.p_site),quote(args.p_auth),json(args.p_claims)]:[quote(args.p_site),quote(args.p_auth)];
  const gates=flags.map(k=>args[k]),last=channel==='location'?[json(args.p_assertion),gates[0],args.p_require_clock,...gates.slice(1)]:gates;
  return `public.${name}(${[...first,json(args.p_query),json(args.p_command),...last].join(',')})`;
 }
 assert(['faolla_attendance_pin_admin_v1','faolla_attendance_pin_begin_v1','faolla_attendance_onsite_issue_v1'].includes(name));
 return boundClockRpcExpression(name,args);
}

//Only fixture-generated rows, exactly two copies, fixed tables and bounded IDs.
//Rehashing below happens in PostgreSQL's canonical jsonb text, not JS stringify.
export function administrativeClosureHistoricalTemplate(input,copy){
 assert(copy===1||copy===2,'administrative_history_copy');
 assert.deepEqual(Object.keys(input).sort(),[...administrativeClosureNativeTables].sort());
 const rows=structuredClone(input),employee=rows.merchant_enterprise_employees[0],worker=rows.merchant_attendance_workers[0];
 assert.equal(rows.merchant_enterprise_employees.length,1);assert.equal(rows.merchant_attendance_workers.length,1);
 assert.equal(employee.id,worker.employee_id);assert.equal(worker.merchant_id,administrativeClosureNativeSite);
 assert(Object.values(rows).every(v=>Array.isArray(v)&&v.length<=12));assert(Object.values(rows).flat().length<=60);
 assert(Buffer.byteLength(JSON.stringify(rows),'utf8')<=262144);
 const remap=new Map(),first=copy===1?1000:2000;let serial=first;
 const add=value=>{assert.match(value,/^[a-f0-9-]{36}$/);if(!remap.has(value))remap.set(value,uid(++serial));};
 add(worker.id);add(employee.id);add(employee.auth_user_id);
 for(const [table,keys] of [
  ['merchant_attendance_employment_periods',['id']],['merchant_attendance_events',['id','operation_id']],
  ['merchant_attendance_account_suspensions',['suspension_id']],['merchant_attendance_account_status_operations',['operation_id']],
  ['merchant_attendance_account_restores',['operation_id']],['merchant_attendance_employment_operations',['operation_id']],
  ['merchant_attendance_administrative_closure_entries',['operation_id']],
 ])for(const row of rows[table])for(const key of keys)add(row[key]);
 const days=copy===1?-3:-2;
 const map=value=>{
  if(typeof value==='string')return remap.get(value)??(/^20\d\d-\d\d-\d\d(?:$|[T ])/.test(value)&&value!=='2000-01-01'?shiftDate(value,days):value);
  if(Array.isArray(value))return value.map(map);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,map(v)]));
  return value;
 };
 for(const entry of rows.merchant_attendance_administrative_closure_entries)if(entry.source_text!==null)entry.source_text=JSON.parse(entry.source_text);
 const mapped=map(rows);mapped.merchant_enterprise_employees[0].email=`synthetic195-history-${copy}@example.test`;
 mapped.merchant_attendance_workers[0].worker_no=`SYNTHETIC195-HISTORY-${copy}`;
 assert(Object.values(mapped).flat().every(r=>r.merchant_id===administrativeClosureNativeSite));
 return {rows:mapped,identity:{worker:mapped.merchant_attendance_workers[0].id,employee:mapped.merchant_enterprise_employees[0].id,
  auth:mapped.merchant_enterprise_employees[0].auth_user_id,workerNo:mapped.merchant_attendance_workers[0].worker_no},
  copiedRows:Object.values(mapped).flat().length,days,copy};
}

export function administrativeClosureHistoricalSeed(template){
 assert(template.copy===1||template.copy===2);const {rows,identity}=template;
 assert.equal(identity.worker,rows.merchant_attendance_workers[0].id);
 const pieces=administrativeClosureNativeTables.map(table=>{
  if(table==='merchant_attendance_administrative_closures')return '';
  let patch='';
  if(table==='merchant_attendance_account_status_operations')patch=`r.command_fingerprint:=public.faolla_attendance_account_hash_v1(jsonb_build_array('attendance-account-status-v1',r.merchant_id,r.operation_id::text,r.employee_id::text,
   (r.input->>'expected_version')::bigint,r.input->>'status',r.input->>'offboarding_mode',r.input->>'replacement_employee_id'));`;
  if(table==='merchant_attendance_account_restores')patch=`r.command_fingerprint:=public.faolla_attendance_account_hash_v1(jsonb_build_array('attendance-account-restore-v1',r.merchant_id,r.command->>'action',r.command->>'operationId',r.command->>'suspensionId',
   (r.command->>'expectedGeneration')::bigint,r.command->>'workerId',(r.command->>'expectedWorkerVersion')::bigint,(r.command->>'expectedEmployeeVersion')::bigint,r.command->>'employeeId',r.command->>'employeeAuthUserId',r.command->>'reason'));`;
  if(table==='merchant_attendance_employment_operations')patch='r.command_fingerprint:=public.faolla_attendance_employment_hash_v1(r.merchant_id,r.command);';
  if(table==='merchant_attendance_administrative_closure_entries')patch=`if v->'source_text'<>'null'::jsonb then
   r.source_text:=(v->'source_text')::text;r.source_bytes:=octet_length(convert_to(r.source_text,'UTF8'));r.source_sha256:=encode(sha256(convert_to(r.source_text,'UTF8')),'hex');
   r.context:=jsonb_set(r.context,'{sourceFingerprint}',to_jsonb(r.source_sha256));r.command:=jsonb_set(r.command,'{expectedSourceFingerprint}',to_jsonb(r.source_sha256));end if;
   r.command_fingerprint:=public.faolla_attendance_administrative_hash_v1(r.merchant_id,r.actor_auth_user_id,r.actor_access,r.command);
   if r.revision=1 then
    head_value:=jsonb_populate_record(null::public.merchant_attendance_administrative_closures,${json(rows.merchant_attendance_administrative_closures[0])});
    head_value.revision:=1;head_value.latest_source_operation_id:=r.operation_id;head_value.closed_operation_id:=case when r.action='close' then r.operation_id else null end;
    insert into public.merchant_attendance_administrative_closures select(head_value).*;
   else update public.merchant_attendance_administrative_closures set revision=r.revision,
    latest_source_operation_id=case when r.action in('record_unknown','close') then r.operation_id else latest_source_operation_id end,
    closed_operation_id=case when r.action='close' then r.operation_id else closed_operation_id end
    where merchant_id=r.merchant_id and start_event_id=r.start_event_id and revision=r.revision-1;assert found,'ac195_seed_exact_head_cas';end if;`;
  return `do $ac195_seed_row$ declare v jsonb;r public.${table}%rowtype;${table==='merchant_attendance_administrative_closure_entries'?'head_value public.merchant_attendance_administrative_closures%rowtype;':''}begin
   for v in select value from jsonb_array_elements(${json(rows[table])}) loop
    r:=jsonb_populate_record(null::public.${table},v);${patch}insert into public.${table} select(r).*;
   end loop;end;$ac195_seed_row$;`;
 });
 return `do $ac195_seed_pre$ begin assert current_user='postgres';
  assert not exists(select 1 from public.merchant_attendance_workers where id=${quote(identity.worker)}),'ac195_seed_worker_unused';
  assert not exists(select 1 from public.merchant_enterprise_employees where id=${quote(identity.employee)} or auth_user_id=${quote(identity.auth)}),'ac195_seed_identity_unused';end;$ac195_seed_pre$;
  ${pieces.join('\n')}
  set constraints all immediate;set constraints all deferred;
  do $ac195_seed_checked$ declare chain_value jsonb;begin
   perform public.faolla_attendance_administrative_entry_v1(e) from public.merchant_attendance_administrative_closure_entries e
    where e.merchant_id=${quote(administrativeClosureNativeSite)} and e.start_event_id in(select start_event_id from public.merchant_attendance_administrative_closures where worker_id=${quote(identity.worker)});
   chain_value:=public.faolla_attendance_employment_chain_v1(${quote(administrativeClosureNativeSite)},${quote(identity.worker)},${quote(identity.employee)},${quote(identity.auth)});
   assert chain_value->'valid'='true'::jsonb and chain_value->'limited'='false'::jsonb,'ac195_seed_actual_employment_checker';
   assert exists(select 1 from public.merchant_attendance_administrative_closures where worker_id=${quote(identity.worker)} and closed_operation_id is not null),'ac195_seed_checked_boundary';
   assert not exists(select 1 from public.merchant_attendance_shift_schedule_relations rel
    left join public.merchant_attendance_shift_plan_adoptions sidecar on sidecar.start_event_id=rel.start_event_id
    where rel.merchant_id=${quote(administrativeClosureNativeSite)} and rel.worker_id=${quote(identity.worker)} and
     (sidecar.start_event_id is null or sidecar.adoption is distinct from public.faolla_attendance_shift_plan_adoption_v1(rel,${quote(identity.auth)},sidecar.approval_operation_id,false,sidecar.channel))),
    'ac195_seed_actual_adoption_checker';
  end;$ac195_seed_checked$;`;
}

export async function verifyAdministrativeClosureNative(ctx){
 const {d,h,native,scope,archive,periodArchive}=ctx;assert(d?.syntheticOnly===true&&h?.syntheticOnly===true);
 assert.deepEqual(assertLifecycleSandbox(sql=>native.query(scope.sql(sql))),d.owned);assert.equal(d.owned.schema,scope.schema);
 const pure=require('../../src/lib/merchantAttendanceAdministrativeClosure.ts');
 const {parseEmploymentLifecycleResult}=require('../../src/lib/merchantAttendanceEmploymentLifecycle.ts');
 const {executeOperationalPunch}=require('../../src/lib/merchantAttendanceOperationalPunch.server.ts');
 const {executeOnsiteIssue}=require('../../src/lib/merchantAttendanceOnsiteQr.server.ts');
 const {executePinAdmin}=require('../../src/lib/merchantAttendancePin.server.ts');
 const {terminalHash}=require('../../src/lib/merchantAttendanceTerminal.server.ts');
 const {executePeriodClosuresV2}=require('../../src/lib/merchantAttendancePeriodClosureV2.server.ts');
 const names=d.inventory(),baseline=d.fingerprint(),definitions=d.definitions(),catalog=d.tableCatalog();
 const oldArchive=periodContinuationArchiveBytes(await archive()),oldPeriod=periodContinuationArchiveBytes(await periodArchive());
 const siteId=administrativeClosureNativeSite,site=quote(siteId),owner=quote(d.owner),all=outageNativeFingerprintSql(names);
 const business=outageNativeFingerprintSql(names.filter(n=>!['merchant_attendance_pin_credentials','merchant_attendance_pin_attempts'].includes(n)));
 for(const n of names)assert(/^(?:merchants|faolla_schema_migrations|merchant_[a-z0-9_]+)$/.test(n));
 const eventScoped=JSON.parse(d.exec(`select coalesce(jsonb_agg(c.relname order by c.relname),'[]')::text from pg_class c where c.relnamespace=${d.owned.oid}
  and c.relkind in('r','p') and c.relname<>all(array['merchants','faolla_schema_migrations']) and not exists(select 1 from pg_attribute a where a.attrelid=c.oid and a.attname='merchant_id' and not a.attisdropped);`));
 assert.deepEqual(eventScoped,['merchant_attendance_location_results'],'administrative_fixture_scoped_table_columns');
 const outside=`(select md5(jsonb_object_agg(n,rows order by n)::text) from (${names.map(n=>`select ${quote(n)} n,(select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]'::jsonb) from public.${n} x where ${n==='merchants'?`x.id<>${site}`:n==='faolla_schema_migrations'?'true':n==='merchant_attendance_location_results'?`exists(select 1 from public.merchant_attendance_events original_event where original_event.id=x.event_id and original_event.merchant_id<>${site})`:`x.merchant_id<>${site}`}) rows`).join(' union all ')}) original_tables)`;
 const prefix=periodContinuationSerialization+d.guard,connection=native.connect({lifetimeMs:90000});
 let steps=0,reads=0,writes=0,rejections=0,serial=100,stage='begin',lastRpc=null,lastStepFailure=null,rolledBack=false;
 const groups=[],historical=[];const next=()=>uid(++serial);
 const step=async(label,sql)=>{stage=label;assert(++steps<=120,'administrative_max120_steps');try{return await connection.step(scope.sql((label==='begin'?'begin;':'')+prefix+sql));}
  catch(error){lastStepFailure=String(error?.stack??error).slice(0,1800);throw error;}};
 const call=async(label,expression,{write=false,auth=false,replay=false,role='service_role',prepare=''}={})=>{
  const value=JSON.parse(await step(label,`do $ac195_call$ declare before_hash text;rpc_value jsonb;prepared_command jsonb;failure text;state_value text;context_value text;begin
   before_hash:=${auth?business:all};${prepare}begin set local role ${role};assert current_user=${quote(role)};
    rpc_value:=${expression};set constraints all immediate;set constraints all deferred;
   exception when others then get stacked diagnostics failure=message_text,state_value=returned_sqlstate,context_value=pg_exception_context;end;reset role;
   if failure is not null or rpc_value ? 'error' or ${!write||replay} then assert ${auth?business:all}=before_hash,'ac195_read_reject_replay_wrote';end if;
   assert ${outside}=current_setting('faolla.ac195_outside'),'ac195_original_rows_changed';
   perform set_config('faolla.ac195_result',jsonb_build_object('value',rpc_value,'error',failure,'sqlstate',state_value,'context',context_value)::text,true);
  end;$ac195_call$;select current_setting('faolla.ac195_result')::jsonb;`));
  lastRpc=value;if(value.error||value.value?.error)rejections++;else if(write)writes++;else reads++;return value;
 };
 const ok=async(label,expression,options)=>{const r=await call(label,expression,options);assert.equal(r.error,null,JSON.stringify(r));assert(!r.value?.error,JSON.stringify(r));return r.value;};
 const rejected=async(label,expression,code,options={})=>{const r=await call(label,expression,{...options,write:true});assert.equal(r.error??r.value?.error,code,JSON.stringify(r));return r;};
 const save=async name=>{assert(/^[a-z0-9_]+$/.test(name));return step('save_'+name,`savepoint ${name};select ${all};`);};
 const restore=async(name,hash)=>assert.equal(await step('restore_'+name,`rollback to savepoint ${name};release savepoint ${name};select ${all};`),hash);
 const sourceQuery=p=>({siteId,access:'owner',mode:'candidate',workerId:p.worker});
 const closureExpression=(query,actor,command=null,allow=true)=>`public.faolla_attendance_administrative_closures_v1(${json(query)},${quote(actor)},${json(command)},${allow})`;
 const closure=async(query,actor=d.owner,command=null,allow=true)=>pure.parseAdministrativeClosureResult(await ok('closure_'+(command?.action??query.mode),closureExpression(query,actor,command,allow),{write:!!command}),query,actor,command);
 const sourceCommand=(p,r,action,verifiedEndAt=null)=>({operationId:next(),startEventId:r.data.detail.frame.startEventId,action,workerId:p.worker,
  expectedRevision:r.data.detail.summary?.revision??0,expectedSourceFingerprint:r.data.detail.context.sourceFingerprint,verifiedEndAt,reason:'Synthetic195 explicit '+action});
 const eq=p=>({siteId,mode:'detail',workerId:p.worker,afterId:null,afterRevision:null,operationId:null});
 const employmentExpression=(p,command=null)=>`public.faolla_attendance_employment_lifecycle_v1(${json(eq(p))},${owner},${json(command)},true)`;
 const employment=async(p,command=null)=>parseEmploymentLifecycleResult(await ok('employment_'+(command?.action??'detail'),employmentExpression(p,command),{write:!!command}),eq(p),d.owner,command);
 const sq=sid=>({siteId,mode:'detail',afterId:null,suspensionId:sid,operationId:null});
 const suspensionExpression=(sid,command=null)=>`public.faolla_attendance_account_suspensions_v1(${json(sq(sid))},${owner},${json(command)},true)`;
 const suspension=sid=>ok('pause_detail',suspensionExpression(sid));
 const status=async(p,value)=>ok('employee_'+value,'public.faolla_update_merchant_enterprise_employee_v1(prepared_command)',{write:true,prepare:`prepared_command:=jsonb_build_object('merchant_id',${site},'employee_id',${quote(p.employee)},
  'expected_version',(select version from public.merchant_enterprise_employees where merchant_id=${site} and id=${quote(p.employee)}),'actor_type','owner','actor_id',${owner},'status',${quote(value)},
  'attendance_operation_id',${quote(next())},'attendance_suspension_enabled',true)${value==='disabled'?`||'{"offboarding_mode":"unassign"}'::jsonb`:''};`});
 const currentPause=async p=>JSON.parse(await step('current_pause',`select jsonb_build_object('id',suspension_id,'generation',generation) from public.merchant_attendance_account_epochs where merchant_id=${site} and employee_id=${quote(p.employee)};`));
 const restoreCommand=(p,sid,r)=>({action:'restore',operationId:next(),suspensionId:sid,expectedGeneration:r.detail.suspension.generation,
  workerId:p.worker,expectedWorkerVersion:r.detail.workerVersion,expectedEmployeeVersion:r.detail.employeeVersion,employeeId:p.employee,employeeAuthUserId:p.auth,reason:'Synthetic195 explicit same-identity restore'});
 const legacyClock=async(p,action)=>ok('legacy_'+action,`public.faolla_attendance_self_v1(${site},${quote(p.auth)},prepared_command,null)`,{write:true,prepare:`prepared_command:=jsonb_build_object('operationId',${quote(next())},'expectedWorkerId',${quote(p.worker)},
  'locationId',${quote(ids.location)},'action',${quote(action)},'expectedSequence',(select coalesce(max(sequence),0) from public.merchant_attendance_events where merchant_id=${site} and worker_id=${quote(p.worker)}));`});
 const capture=async p=>JSON.parse(await step('capture_historical_template',`select jsonb_build_object(${administrativeClosureNativeTables.map(n=>{
  const filter=n==='merchant_enterprise_employees'?`id=${quote(p.employee)}`:n==='merchant_attendance_workers'?`id=${quote(p.worker)}`:
   ['merchant_attendance_account_epochs','merchant_attendance_account_status_operations'].includes(n)?`employee_id=${quote(p.employee)}`:
   n==='merchant_attendance_administrative_closure_entries'?`start_event_id in(select start_event_id from public.merchant_attendance_administrative_closures where merchant_id=${site} and worker_id=${quote(p.worker)})`:`worker_id=${quote(p.worker)}`;
  return `${quote(n)},(select coalesce(jsonb_agg(to_jsonb(x) order by ${['merchant_attendance_administrative_closure_entries','merchant_attendance_employment_operations'].includes(n)?'revision':n==='merchant_attendance_events'?'sequence':'to_jsonb(x)::text'}),'[]'::jsonb) from public.${n} x where merchant_id=${site} and ${filter})`;
 }).join(',')});`));
 const secret=randomBytes(32).toString('base64url'),pair=randomBytes(32).toString('base64url'),pin='01738264';
 const {terminalSecret}=require('../../src/lib/merchantAttendanceTerminal.ts');terminalSecret(secret);terminalSecret(pair);
 const service={rpc:async(name,args)=>{
  const expression=administrativeClosureNativeRpcExpression(name,args),command=args.p_command??args.p_request?.command??null;
  const r=await call('service_'+name+'_'+(command?.clock?.action??command?.action??args.p_query?.mode??'read'),expression,{write:!!command,auth:name.includes('_pin_')});
  return {data:r.value,error:r.error?{message:r.error}:null};
 }};
 const punch=async(p,channel,command=null)=>{
  const common={siteId,channel,moduleEnabled:true,allowOperationalStart:true,allowSchedule:true,bindRules:false,query:command?{mode:'recover',operationId:command.clock.operationId}:{mode:'prepare'},command};
  const input=channel==='pin'?{...common,terminalId:ids.terminal,secret,workerNo:p.workerNo,pin}:channel==='onsite'?{...common,authUserId:p.auth,token:command?(await executeOnsiteIssue({siteId,terminalId:ids.terminal,secret},service)).token:null}:
   channel==='location'?{...common,authUserId:p.auth,expectedWorkerId:p.worker,position:command?{latitude:37.3,longitude:-5.9,accuracyMeters:10,capturedAt:new Date().toISOString()}:null,positionFailure:null}:{...common,authUserId:p.auth};
  return executeOperationalPunch(input,service);
 };
 const startCommand=(p,channel,r)=>({clock:{operationId:next(),action:'clock_in',expectedWorkerId:p.worker,locationId:r.clock.locationId,expectedSequence:r.clock.state.sequence,
  ...(['pin','onsite'].includes(channel)?{expectedEmployeeId:p.employee}:{}),...(channel==='location'?{settingsVersion:r.clock.policy.settingsVersion,workerVersion:r.clock.policy.workerVersion,
   locationVersion:r.clock.policy.locationVersion,noticeRevision:r.clock.noticeGate.revision,safeFinish:false}:{})},choice:{kind:'start',expectedPolicyFingerprint:r.policy.policyFingerprint,selection:null}});
 try{
  await step('begin',`set local lock_timeout='3s';set local statement_timeout='10s';do $ac195_begin$ begin assert current_user='postgres';
   assert not exists(select 1 from public.merchants where id=${site}),'ac195_unused_site';
   assert exists(select 1 from public.faolla_schema_migrations where version=202610080195),'ac195_requires_migration';
   perform set_config('faolla.ac195_outside',${outside},true);end;$ac195_begin$;select 1;`);
  await step('new_synthetic_identity',`insert into public.merchants(id,user_id,name,email) values(${site},${owner},'Synthetic195 closure acceptance','synthetic195@example.test');
   insert into public.merchant_enterprise_roles(id,merchant_id,name,permissions) values(${quote(ids.role)},${site},'Synthetic195 self role',array['enterprise.view','attendance.self.view','attendance.self.clock','attendance.self.request','attendance.self.export']);
   insert into public.merchant_enterprise_employees(id,merchant_id,auth_user_id,email,display_name,role_id,status,accepted_at,version) values(${quote(ids.employee)},${site},${quote(ids.auth)},'synthetic195-now@example.test','Synthetic195 present member',${quote(ids.role)},'active',clock_timestamp(),1);select 1;`);
  const admin=async(kind,values)=>ok('admin_'+kind,`public.faolla_attendance_admin_v1(${site},${owner},'{"view":"workers","cursor":null,"search":""}'::jsonb,prepared_command,null)`,{write:true,
   prepare:`prepared_command:=jsonb_build_object('kind',${quote(kind)},'operationId',${quote(next())},'expectedVersion',coalesce((select version from public.merchant_attendance_settings where merchant_id=${site}),0),'values',${json(values)});`});
  await admin('settings',{timeZone:'UTC',enabled:true,webClockEnabled:true,webBreakPaid:false});
  await admin('location',{id:ids.location,name:'Synthetic195 plain place',timeZone:'UTC',active:true});
  await admin('worker',{id:ids.worker,employeeId:ids.employee,workerNo:'SYNTHETIC195-NOW',displayName:'Synthetic195 present worker',locationId:ids.location,active:true,startsOn:'2000-01-01'});
  const a={...ids,workerNo:'SYNTHETIC195-NOW'};const started=await legacyClock(a,'clock_in');await legacyClock(a,'break_start');
  await status(a,'disabled');const firstPause=await currentPause(a),first=await closure(sourceQuery(a));
  assert.equal(first.data.detail.frame.tailAction,'break_start');assert.equal(first.data.detail.capabilities.canClose,true);
  const unknown=sourceCommand(a,first,'record_unknown');await rejected('flagoff_unknown',closureExpression(sourceQuery(a),d.owner,unknown,false),'attendance_administrative_closure_disabled');
  const unknownReceipt=await closure(sourceQuery(a),d.owner,unknown);assert.equal(unknownReceipt.data.receipt.action,'record_unknown');
  const detailQuery={siteId,access:'self',mode:'detail',startEventId:unknown.startEventId},self=await closure(detailQuery,a.auth,null,false);
  assert(self.data.detail.capabilities.canDispute);assert.equal(self.data.detail.capabilities.canClose,false);
  const dispute={action:'self_dispute',operationId:next(),startEventId:unknown.startEventId,expectedRevision:1,expectedClosedOperationId:null,reason:'Synthetic195 actual employee disputes unknown evidence'};
  await closure(detailQuery,a.auth,dispute,false);
  await closure({...detailQuery,access:'owner'},d.owner,{action:'owner_respond',operationId:next(),startEventId:unknown.startEventId,expectedRevision:2,disputeOperationId:dispute.operationId,reason:'Synthetic195 owner explanation does not decide hours'},false);
  await status(a,'active');let pauseDetail=await suspension(firstPause.id);assert.equal(pauseDetail.detail.canRestore,true);
  await ok('restore_unknown_not_closed',suspensionExpression(firstPause.id,restoreCommand(a,firstPause.id,pauseDetail)),{write:true});
  await legacyClock(a,'break_end');await status(a,'disabled');const secondPause=await currentPause(a),current=await closure(sourceQuery(a));
  assert.equal(current.data.detail.frame.startEventId,unknown.startEventId);assert.notEqual(current.data.detail.frame.suspensionId,first.data.detail.frame.suspensionId);
  assert.equal(current.data.detail.frame.tailSequence,first.data.detail.frame.tailSequence+1);assert.notEqual(current.data.detail.context.sourceFingerprint,first.data.detail.context.sourceFingerprint);
  await rejected('stale_old_unknown_source',closureExpression(sourceQuery(a),d.owner,{...unknown,operationId:next(),expectedRevision:3}),'attendance_administrative_closure_changed');
  const close=sourceCommand(a,current,'close',current.readAt),closed=await closure(sourceQuery(a),d.owner,close);assert.equal(closed.data.receipt.revision,4);
  const history=await closure({siteId,access:'owner',mode:'history',startEventId:unknown.startEventId,beforeRevision:null});
  assert.equal(history.data.items.length,4);assert.deepEqual(history.data.items.at(-1).frame,first.data.detail.frame);
  const saved=await closure({...detailQuery,access:'owner'});assert.equal(saved.data.detail.capabilities.canClose,false);assert.equal(saved.data.detail.closure.verifiedEndAt,close.verifiedEndAt);
  await status(a,'active');pauseDetail=await suspension(secondPause.id);assert.equal(pauseDetail.detail.canRestore,false);
  await rejected('no_restore_before_employment_close',suspensionExpression(secondPause.id,restoreCommand(a,secondPause.id,pauseDetail)),'attendance_account_suspension_changed');
  const employmentReady=await employment(a);assert.equal(employmentReady.detail.canClose,true);assert.equal(employmentReady.detail.currentAction,'break_end');
  const employmentClose=employmentLifecycleCommandFromDetail(employmentReady.detail,'close',next()),actualClose=await employment(a,employmentClose);assert(actualClose.receipt.endsOn);
  const sameDay=await employment(a);assert.equal(sameDay.detail.canRejoin,false);assert(sameDay.detail.rejoinBlockers.includes('date_not_after_end'));
  await rejected('same_day_rejoin',employmentExpression(a,employmentLifecycleCommandFromDetail(sameDay.detail,'rejoin',next())),'attendance_employment_lifecycle_blocked');
  await rejected('history_timezone_unchanged',`public.faolla_attendance_admin_v1(${site},${owner},'{"view":"workers","cursor":null,"search":""}'::jsonb,prepared_command,null)`,'attendance_history_protected',
   {prepare:`prepared_command:=jsonb_build_object('kind','settings','operationId',${quote(next())},'expectedVersion',(select version from public.merchant_attendance_settings where merchant_id=${site}),
   'values','{"timeZone":"Pacific/Kiritimati","enabled":true,"webClockEnabled":true,"webBreakPaid":false}'::jsonb);`});
  groups.push('A_real_unknown_tail_advance_close_dispute_employment_and_same_day_rejection');
  const templateA=await capture(a),bTemplate=administrativeClosureHistoricalTemplate(templateA,1);historical.push({copy:1,rows:bTemplate.copiedRows,shiftDays:bTemplate.days,actualHistoricalRpc:false});
  await step('B_disclosed_past_complete_chain',administrativeClosureHistoricalSeed(bTemplate)+'select 1;');const b=bTemplate.identity;
  const ready=await employment(b);assert.equal(ready.detail.canRejoin,true);assert.equal(ready.detail.currentAction,'break_end');
  const rejoinCommand=employmentLifecycleCommandFromDetail(ready.detail,'rejoin',next()),rejoined=await employment(b,rejoinCommand);assert.equal(rejoined.receipt.startsOn,ready.detail.today);
  const bPause=await currentPause(b),bPauseDetail=await suspension(bPause.id);assert.equal(bPauseDetail.detail.canRestore,true);
  await ok('B_actual_restore',suspensionExpression(bPause.id,restoreCommand(b,bPause.id,bPauseDetail)),{write:true});
  // Credential setup is real and entirely within the new synthetic merchant.
  await ok('new_terminal',`public.faolla_attendance_terminal_admin_v1(${site},${owner},'{"terminalId":null,"cursor":null}'::jsonb,${json({action:'create',terminalId:ids.terminal,locationId:ids.location,label:'Synthetic195 terminal',pairHash:terminalHash(pair)})},true)`,{write:true});
  await ok('pair_terminal',`public.faolla_attendance_terminal_device_v1(${site},${quote(ids.terminal)},${quote(terminalHash(pair))},${quote(terminalHash(secret))},true)`,{write:true});
  await executePinAdmin({siteId,authUserId:d.owner,workerNo:b.workerNo,operationId:null,allowSet:true,command:{action:'set',operationId:next(),expectedRevision:0,workerId:b.worker,employeeId:b.employee,pin,salt:'19519519519519519519519519519519'}},service);
  await ok('operational_activation',`public.faolla_attendance_operational_punch_activation_v1(${json({siteId,mode:'current'})},${owner},${json({siteId,action:'activate',operationId:next(),expectedRevision:0,reason:'Synthetic195 explicit new channel activation'})},true)`,{write:true});
  const channels=[];
  for(const channel of ['pin','onsite','location','self']){
   const branch=channel==='self'?null:await save('ac195_'+channel);
   if(channel==='location'){
    // Owner notice publication supplies the fence; no fake GPS or real device claim.
    await step('disclosed_location_fence_setup',`do $ac195_geo$ begin
     update public.merchant_attendance_settings set location_clock_enabled=true where merchant_id=${site} and not location_clock_enabled;assert found;
     update public.merchant_attendance_locations set latitude=37.3,longitude=-5.9,radius_meters=100 where merchant_id=${site} and id=${quote(ids.location)} and latitude is null and longitude is null and radius_meters is null;assert found;
    end;$ac195_geo$;select 1;`);
    const values={purpose:'Synthetic195 location check',notice:'Synthetic195 no real GPS',contact:'Synthetic owner',alternative:'Administrative review',retentionDays:90,latitude:37.3,longitude:-5.9,radiusMeters:100};
    await ok('location_draft',`public.faolla_attendance_location_policy_draft_v1(${site},${owner},${quote(ids.location)},prepared_command,null,true)`,{write:true,prepare:`prepared_command:=jsonb_build_object('operationId',${quote(next())},'expectedRevision',0,
     'expectedSettingsVersion',(select version from public.merchant_attendance_settings where merchant_id=${site}),'expectedLocationVersion',(select version from public.merchant_attendance_locations where id=${quote(ids.location)}),'values',${json(values)});`});
    const noticeOwner={access:'owner',locationId:ids.location,expectedWorkerId:null,operationId:null};
    await ok('location_publish',`public.faolla_attendance_location_notice_v1(${site},${owner},${json(noticeOwner)},prepared_command,true)`,{write:true,prepare:`prepared_command:=jsonb_build_object('action','publish','operationId',${quote(next())},'expectedRevision',0,'draftRevision',1,
     'expectedSettingsVersion',(select version from public.merchant_attendance_settings where merchant_id=${site}),'expectedLocationVersion',(select version from public.merchant_attendance_locations where id=${quote(ids.location)}),'reason','Synthetic195 actual notice');`});
    await ok('location_acknowledge',`public.faolla_attendance_location_notice_v1(${site},${quote(b.auth)},${json({...noticeOwner,access:'self',expectedWorkerId:b.worker})},${json({action:'acknowledge',operationId:next(),expectedRevision:1})},true)`,{write:true});
   }
   const before=await punch(b,channel);assert.equal(before.clock.state.status,'off');assert(before.clock.state.administrativeBoundary);assert(before.canStart);
   const staleFinish={clock:{...startCommand(b,channel,before).clock,action:'clock_out'},choice:{kind:'finish'}};
   await assert.rejects(()=>punch(b,channel,staleFinish),error=>error.code==='attendance_not_clocked_in');
   assert.equal(lastRpc.error??lastRpc.value?.error,'attendance_not_clocked_in',JSON.stringify(lastRpc));
   const fresh=await punch(b,channel,startCommand(b,channel,before));assert.equal(fresh.clock.state.status,'working');assert.equal(fresh.clock.receipt.sequence,4);
   const working=await punch(b,channel),finished=await punch(b,channel,operationalPunchNativeFinishCommand(channel,working,next()));assert.equal(finished.clock.state.status,'off');
   assert.equal(finished.clock.receipt.sequence,5);channels.push(channel);
   if(branch!==null)await restore('ac195_'+channel,branch);
  }
  groups.push('B_real_today_rejoin_restore_four_channels_after_disclosed_past_chain');
  const cTemplate=administrativeClosureHistoricalTemplate(await capture(b),2);historical.push({copy:2,rows:cTemplate.copiedRows,shiftDays:cTemplate.days,actualHistoricalRpc:false});
  await step('C_disclosed_past_rejoined_complete_successor',administrativeClosureHistoricalSeed(cTemplate)+'select 1;');const c=cTemplate.identity;
  const dates=JSON.parse(await step('C_saved_dates',`select jsonb_build_object('oldDay',(select (start_at at time zone 'UTC')::date::text from (select (case_scope->>'startAt')::timestamptz start_at from public.merchant_attendance_administrative_closures where worker_id=${quote(c.worker)}) x),
   'newDay',(select max(starts_on)::text from public.merchant_attendance_employment_periods where worker_id=${quote(c.worker)}));`));assert(dates.oldDay<dates.newDay);
  const pq=(day,periodId,access='owner',mode='detail')=>({siteId,access,workerId:c.worker,fromDate:day,throughDate:day,mode,periodId,operationId:null,version:null,cursor:null});
  const period=(query,command=null)=>executePeriodClosuresV2({query,command,authUserId:query.access==='owner'?d.owner:c.auth,moduleEnabled:true},service);
  const pc=(action,pid,r=null,fp=null)=>({action,periodId:pid,operationId:next(),expectedRevision:r?.period.revision??0,expectedVersion:r?.period.currentVersion??0,
   expectedFingerprint:['send','confirm','seal'].includes(action)?r?.artifact.sourceFingerprint??fp:null,reason:'Synthetic195 actual period '+action});
  const oldPid=next(),oldPreview=await period(pq(dates.oldDay,null,'owner','preview'));
  assert(oldPreview.preview.blockers.includes('administrative_hours_unassessed'));assert.equal(oldPreview.preview.artifact.report.base.totalsComplete,false);
  const oldSource=oldPreview.preview.artifact.source;
  await ok('candidate_saved_source_nullable_time',`to_jsonb(public.faolla_attendance_administrative_saved_source_v1(${json(oldSource)},null))`,{role:'postgres'});
  await rejected('saved_source_cannot_predate_proof',`to_jsonb(public.faolla_attendance_administrative_saved_source_v1(${json(oldSource)},'2000-01-01T00:00:00.000000Z'::timestamptz))`,'attendance_period_closure_invalid',{role:'postgres'});
  const oldSent=await period(pq(dates.oldDay,oldPid),pc('send',oldPid,null,oldPreview.preview.artifact.sourceFingerprint));
  const oldConfirmed=await period(pq(dates.oldDay,oldPid,'self'),pc('confirm',oldPid,oldSent));
  await assert.rejects(()=>period(pq(dates.oldDay,oldPid),pc('seal',oldPid,oldConfirmed)));assert.equal(lastRpc.error,'attendance_period_blocked',JSON.stringify(lastRpc));
  const oldDisputed=await period(pq(dates.oldDay,oldPid,'self'),pc('dispute',oldPid,oldConfirmed));assert(oldDisputed.period.unresolvedDispute);
  const newPid=next(),newPreview=await period(pq(dates.newDay,null,'owner','preview'));assert.deepEqual(newPreview.preview.blockers,[]);
  assert.equal(newPreview.preview.artifact.source.sourceVersion,'attendance-period-source-v5');assert.equal(newPreview.preview.artifact.report.base.totalsComplete,true);
  let savedPeriod=await period(pq(dates.newDay,newPid),pc('send',newPid,null,newPreview.preview.artifact.sourceFingerprint));
  savedPeriod=await period(pq(dates.newDay,newPid,'self'),pc('confirm',newPid,savedPeriod));savedPeriod=await period(pq(dates.newDay,newPid),pc('seal',newPid,savedPeriod));assert(savedPeriod.period.sealed);
  groups.push('C_unknown_hours_saved_confirmed_not_sealed_completed_successor_actually_sealed');
  const recovered=await closure({siteId,access:'owner',mode:'recover',operationId:close.operationId},d.owner,null,false);assert.deepEqual(recovered.data.receipt,closed.data.receipt);
  const originalRaw=JSON.parse(await step('A_immutable_raw_prefix',`select jsonb_agg(action order by sequence) from public.merchant_attendance_events where merchant_id=${site} and worker_id=${quote(a.worker)};`));
  assert.deepEqual(originalRaw,['clock_in','break_start','break_end']);assert.equal(started.receipt.action,'clock_in');
  await step('final_preserved',`do $ac195_end$ begin assert ${outside}=current_setting('faolla.ac195_outside'),'ac195_final_originals';end;$ac195_end$;set constraints all immediate;select 1;`);
  await step('rollback','rollback;');rolledBack=true;
  return {phase:195,groups,steps,reads,writes,rejections,actualChannels:channels,historicalTemplates:historical,
   realCurrentClose:true,realSameDayRejoinRejected:true,realRejoinAfterSyntheticPast:true,administrativeCloseInsertedRawEvents:false,unknownHoursRemainNull:true,
   fourOldChannelFinishesRejected:true,oldPeriodSealRejected:true,oldPeriodActualDispute:true,historicalSuccessorRealSendConfirmSeal:true,syntheticSetup:{newMerchant:siteId,locationEnabledAndThreeFenceColumnsInSavepoint:true,normalConstraintsAndCheckers:true},
   rollbackRestored:true,oldFactsUnchanged:true,oldArchivesUnchanged:true,realAuth:false,realGps:false,production:false};
 }catch(error){throw new Error('administrative_closure_native_stage:'+stage+':'+String(error?.stack??error).slice(0,1800)+':'+JSON.stringify({lastRpc,lastStepFailure}).slice(0,6000),{cause:error});}
 finally{try{if(!rolledBack)await connection.step('rollback;');}catch(error){if(!String(error).includes('attendance_concurrency_closed'))throw error;}finally{await connection.close();}
  assert.equal(d.fingerprint(),baseline,'ac195_full_rollback');assert.equal(d.definitions(),definitions);assert.equal(d.tableCatalog(),catalog);
  assert.deepEqual(periodContinuationArchiveBytes(await archive()),oldArchive);assert.deepEqual(periodContinuationArchiveBytes(await periodArchive()),oldPeriod);
 }
}
