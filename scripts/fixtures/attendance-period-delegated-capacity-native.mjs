// INERT235. An explicitly owned test connection injects a quota projection,
// not physical64MiB. Real Node projection and service-role187 RPCs remain in
// one bounded transaction, with normal constraints and unconditional cleanup.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {assertLifecycleSandbox,lifecycleId as id,lifecycleJson as json} from '../merchant-attendance-lifecycle-native-support.mjs';
import {quote} from './attendance-bound-clocks-native.mjs';
import {outageNativeFingerprintSql} from './attendance-outage-native.mjs';
import {periodContinuationArchiveBytes,periodContinuationSerialization} from './attendance-period-continuation-native.mjs';
import {periodContinuationCapacityLimit as LIMIT,periodContinuationCapacityRemaining} from './attendance-period-continuation-capacity-native.mjs';

const require=createRequire(import.meta.url),uid=n=>id(235300000+n),table=s=>'merchant_attendance_'+s;
const permissions=['enterprise.view','attendance.period.view','attendance.period.send','attendance.period.respond','attendance.period.seal','attendance.period.reopen'];
const frameKeys=['revision','current_version','state','sealed','confirmed_version','unresolved_dispute','updated_at'];
const without=(value,keys)=>Object.fromEntries(Object.entries(value).filter(([key])=>!keys.includes(key)));
export function delegatedCapacityPlan(){return {role:uid(1),delegate:uid(2),auth:uid(3),grant:uid(4),periodId:uid(5),date:'2010-01-08',
 send:uid(10),respond:uid(11),confirm:uid(12),seal:uid(13),reopen:uid(14),reuse:uid(15)};}
export function delegatedCapacityScopes(site,p=delegatedCapacityPlan()){
 assert(/^\d{8}$/.test(site));const owned=where=>`t.merchant_id=${quote(site)} and (${where})`,ops=[p.send,p.respond,p.confirm,p.seal,p.reopen,p.reuse];
 return {merchant_enterprise_roles:owned(`t.id=${quote(p.role)}`),merchant_enterprise_employees:owned(`t.id=${quote(p.delegate)}`),
  merchant_enterprise_audit_events:owned(`t.entity_id=${quote(p.delegate)}`),
  [table('period_delegations')]:owned(`t.grant_id=${quote(p.grant)}`),[table('period_closures')]:owned(`t.period_id=${quote(p.periodId)}`),
  [table('period_entries')]:owned(`t.period_id=${quote(p.periodId)} and t.operation_id in(${ops.map(quote).join(',')})`),
  [table('period_versions')]:owned(`t.period_id=${quote(p.periodId)} and t.operation_id in(${[p.send,p.reuse].map(quote).join(',')})`),
  [table('period_artifacts')]:owned(`t.period_id=${quote(p.periodId)} and t.artifact_id=${quote(p.send)}`),
  [table('period_artifact_metadata')]:owned(`t.artifact_id=${quote(p.send)}`),
  [table('period_delegation_operations')]:owned(`t.period_id=${quote(p.periodId)} and t.operation_id in(${ops.filter(x=>x!==p.confirm).map(quote).join(',')})`)};
}
export function delegatedCapacityHash(names,exceptions={}){
 assert(names.length&&new Set(names).size===names.length);
 return `(select md5(jsonb_object_agg(cap_name,cap_rows order by cap_name)::text) from (${names.map(name=>{
  assert(/^(?:merchants|faolla_schema_migrations|merchant_[a-z0-9_]+)$/.test(name)&&name.length<=63);
  return `select ${quote(name)} cap_name,(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]') from public.${name} t${exceptions[name]?` where (${exceptions[name]}) is not true`:''}) cap_rows`;
 }).join(' union all ')}) cap_facts)`;
}
export function delegatedCapacityCallScopes(site,p,rpc,command){
 if(!command)return {};
 const op=quote(command.operationId),owned=where=>`t.merchant_id=${quote(site)} and (${where})`;
 if(rpc==='faolla_attendance_period_delegation_v1')return {[table('period_delegations')]:owned(`t.grant_id=${op}`)};
 const scopes={[table('period_closures')]:owned(`t.period_id=${quote(p.periodId)}`),[table('period_entries')]:owned(`t.operation_id=${op}`)};
 if(rpc==='faolla_attendance_period_delegated_closure_v1')scopes[table('period_delegation_operations')]=owned(`t.operation_id=${op}`);
 if(command.action==='send')Object.assign(scopes,{[table('period_versions')]:owned(`t.period_id=${quote(p.periodId)} and t.operation_id=${op}`),
  [table('period_artifacts')]:owned(`t.period_id=${quote(p.periodId)} and t.artifact_id=${op}`),[table('period_artifact_metadata')]:owned(`t.artifact_id=${op}`),
  [table('period_storage')]:`t.merchant_id=${quote(site)}`});
 return scopes;
}
// Independent raw-table evidence, not a fabricated success result. Every new
// immutable row observed on an earlier step must remain byte-for-byte equal.
export function assertDelegatedCapacityFootprint(proof,state){
 const {site,workerId,employeeId,employeeAuthUserId,owner,baseline,expectedUsed,accepted,seeded,previous,plan:p}=state;
 const get=name=>proof.rows[table(name)],has=op=>accepted.has(op),ops=[p.send,p.respond,p.confirm,p.seal,p.reopen,p.reuse].filter(has);
 const exact=(rows,key,ids)=>assert.deepEqual(rows.map(x=>x[key]).sort(),[...ids].sort());
 exact(proof.rows.merchant_enterprise_roles,'id',seeded?[p.role]:[]);exact(proof.rows.merchant_enterprise_employees,'id',seeded?[p.delegate]:[]);
 if(seeded){const role=proof.rows.merchant_enterprise_roles[0],member=proof.rows.merchant_enterprise_employees[0];
  assert.deepEqual(role.permissions,permissions);assert.equal(role.status,'active');assert.equal(member.auth_user_id,p.auth);assert.equal(member.role_id,p.role);
  assert.equal(member.status,'active');assert.equal(member.version,1);assert.equal(member.merchant_id,site);
 }
 const audit=proof.rows.merchant_enterprise_audit_events;assert.equal(audit.length,Number(seeded));
 if(seeded){const row=audit[0];assert.equal(row.entity_id,p.delegate);assert.equal(row.entity_type,'employee');assert.equal(row.event_type,'employee.created');
  assert.equal(row.actor_type,'system');assert.equal(row.actor_id,null);assert.equal(row.operation_id,'');assert.equal(row.dedupe_key,null);
  assert.deepEqual(row.before_data,{});assert.equal(row.after_data.status,'active');assert.equal(row.after_data.auth_bound,true);
  assert.equal(row.after_data.display_name,'Synthetic235 quota supervisor');assert.equal(row.after_data.role_id,p.role);
 }
 exact(get('period_delegations'),'grant_id',has(p.grant)?[p.grant]:[]);
 for(const row of get('period_delegations')){assert.deepEqual(row.command,accepted.get(p.grant).command);assert.deepEqual(row.query,accepted.get(p.grant).query);assert.equal(row.actor_auth_user_id,owner);}
 exact(get('period_entries'),'operation_id',ops);exact(get('period_delegation_operations'),'operation_id',ops.filter(x=>x!==p.confirm));
 for(const row of get('period_entries')){const request=accepted.get(row.operation_id);assert.deepEqual(row.command,request.command);assert.equal(row.actor_auth_user_id,request.actor);
  assert.equal(row.period_id,p.periodId);assert.equal(row.revision,request.command.expectedRevision+1);assert.equal(row.version,row.operation_id===p.reuse?2:1);assert.equal(row.action,request.command.action);}
 for(const row of get('period_delegation_operations')){const request=accepted.get(row.operation_id);assert.deepEqual(row.command,request.command);assert.deepEqual(row.query,request.query);
  assert.equal(row.actor_auth_user_id,p.auth);assert.equal(row.actor_employee_id,p.delegate);assert.equal(row.grant_id,p.grant);
  assert.equal(row.worker_id,workerId);assert.equal(row.employee_id,employeeId);assert.equal(row.employee_auth_user_id,employeeAuthUserId);
  assert.equal(row.period_revision,request.command.expectedRevision+1);assert.equal(row.period_version,row.operation_id===p.reuse?2:1);}
 assert.equal(proof.sidecarsValid,true);assert.equal(proof.delegateWorkers,0);
 const exists=has(p.send);exact(get('period_closures'),'period_id',exists?[p.periodId]:[]);exact(get('period_artifacts'),'artifact_id',exists?[p.send]:[]);
 exact(get('period_artifact_metadata'),'artifact_id',exists?[p.send]:[]);exact(get('period_versions'),'operation_id',[p.send,p.reuse].filter(has));
 let bytes=0;
 if(exists){const head=get('period_closures')[0],body=get('period_artifacts')[0],entries=get('period_entries'),first=entries.find(x=>x.operation_id===p.send),last=entries.find(x=>x.revision===ops.length);
  assert.equal(head.worker_id,workerId);assert.equal(head.employee_id,employeeId);assert.equal(head.employee_auth_user_id,employeeAuthUserId);
  assert.equal(head.from_date,p.date);assert.equal(head.through_date,p.date);assert.equal(head.time_zone,'UTC');assert.equal(head.revision,ops.length);assert.equal(head.current_version,has(p.reuse)?2:1);
  assert.equal(head.state,has(p.reuse)?'review':has(p.reopen)?'open':has(p.seal)?'sealed':has(p.confirm)?'confirmed':'review');
  assert.equal(head.sealed,has(p.seal)&&!has(p.reopen));assert.equal(head.confirmed_version,has(p.confirm)&&!has(p.reopen)?1:null);assert.equal(head.unresolved_dispute,false);
  assert.equal(head.opened_at,first.recorded_at);assert.equal(head.updated_at,last.recorded_at);
  for(const row of get('period_versions')){const entry=entries.find(x=>x.operation_id===row.operation_id);assert.deepEqual(row,{merchant_id:site,period_id:p.periodId,
   version:row.operation_id===p.send?1:2,artifact_id:p.send,operation_id:entry.operation_id,recorded_at:entry.recorded_at});}
  const artifact=JSON.parse(body.artifact_text);periodContinuationArchiveBytes({artifact,artifactText:body.artifact_text,artifactBytes:body.artifact_bytes,artifactSha256:body.artifact_sha256});
  assert.equal(artifact.protocol,'attendance-period-artifact-v2');assert.equal(artifact.report.access,'delegate');assert.equal(artifact.authority.grantId,p.grant);
  assert.equal(artifact.authority.actorAuthUserId,p.auth);assert.equal(artifact.authority.actorEmployeeId,p.delegate);assert.equal(artifact.authority.action,'send');
  assert.equal(body.source_fingerprint,artifact.sourceFingerprint);assert.equal(body.recorded_at,first.recorded_at);bytes=body.artifact_bytes;periodContinuationCapacityRemaining(bytes);
  assert.deepEqual(get('period_artifact_metadata')[0],{merchant_id:site,artifact_id:p.send,worker_name:artifact.worker.workerName,worker_no:artifact.worker.workerNo});
 }
 assert.equal(proof.actualBytes,baseline+bytes);assert.equal(proof.usedBytes,expectedUsed);assert(proof.usedBytes>=proof.actualBytes&&proof.usedBytes<=LIMIT,'delegated_capacity_known_padding_only');
 if(previous)for(const [name,rows]of Object.entries(previous.rows))for(const old of rows){
  if(name===table('period_closures'))assert.deepEqual(without(proof.rows[name][0],frameKeys),without(old,frameKeys));
  else assert(proof.rows[name].some(current=>JSON.stringify(current)===JSON.stringify(old)),'delegated_capacity_immutable_new_row:'+name);
 }
 return bytes;
}

export async function verifyPeriodDelegatedCapacityNative(ctx){
 const {d,h,native,scope,archive,oldArchive,periodArchive}=ctx;
 assert(d?.syntheticOnly===true&&h?.syntheticOnly===true,'delegated_capacity_owned_synthetic_context_required');
 assert.deepEqual(assertLifecycleSandbox(sql=>native.query(scope.sql(sql))),d.owned);assert.equal(scope.schema,d.owned.schema);assert.equal(typeof native.connect,'function');
 const {executePeriodDelegation}=require('../../src/lib/merchantAttendancePeriodDelegation.server.ts');
 const {executePeriodDelegatedClosures,projectPeriodDelegatedClosureResult}=require('../../src/lib/merchantAttendancePeriodDelegatedClosure.server.ts');
 const {executePeriodClosuresV2}=require('../../src/lib/merchantAttendancePeriodClosureV2.server.ts');
 const p=delegatedCapacityPlan(),site=quote(d.site),pid=quote(p.periodId),names=d.inventory(),scopes=delegatedCapacityScopes(d.site,p);
 for(const name of [...Object.keys(scopes),table('period_storage')])assert(names.includes(name),name);
 const facts=d.fingerprint(),definitions=d.definitions(),catalog=d.tableCatalog(),old155=periodContinuationArchiveBytes(await archive()),old207=periodContinuationArchiveBytes(await periodArchive());
 assert.deepEqual(old155,periodContinuationArchiveBytes(oldArchive));
 const fullHash=outageNativeFingerprintSql(names),outside=delegatedCapacityHash(names,{...scopes,[table('period_storage')]:`t.merchant_id=${site}`});
 const noStorage=delegatedCapacityHash(names,{[table('period_storage')]:`t.merchant_id=${site}`});
 const proofSql=`jsonb_build_object('rows',jsonb_build_object(${Object.entries(scopes).map(([name,where])=>`${quote(name)},(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]') from public.${name} t where ${where})`).join(',')}),
  'usedBytes',(select used_bytes from public.merchant_attendance_period_storage where merchant_id=${site}),
  'actualBytes',(select coalesce(sum(artifact_bytes),0) from public.merchant_attendance_period_artifacts where merchant_id=${site}),
  'sidecarsValid',not exists(select 1 from public.merchant_attendance_period_delegation_operations t where ${scopes[table('period_delegation_operations')]} and public.faolla_attendance_period_delegation_proof_v1(t) is distinct from true),
  'delegateWorkers',(select count(*) from public.merchant_attendance_workers where merchant_id=${site} and employee_id=${quote(p.delegate)}))`;
 const oldGuard=`assert ${outside}=current_setting('faolla.capacity235_outside'),'delegated_capacity_old_or_unlisted_row_changed';`;
 const prefix=periodContinuationSerialization+d.guard,connection=native.connect(),failures=[];
 let steps=0,stage='begin',reads=0,writes=0,replays=0,rejections=0,measurements=0,roleAssertions=0,lastRpc=null,lastStepFailure=null,shortage=null,measured=null,firstArgs=null,rolledBack=false,result;
 const state={site:d.site,workerId:h.workerId,employeeId:h.employeeId,employeeAuthUserId:h.employeeAuthUserId,owner:d.owner,baseline:null,expectedUsed:null,accepted:new Map(),seeded:false,previous:null,plan:p};
 const step=async(label,sql)=>{stage=label;assert(++steps<=100,'delegated_capacity_max100_steps');
  try{return await connection.step(scope.sql((label==='begin'?'begin;':'')+prefix+sql));}
  catch(error){lastStepFailure={stage:label,detail:String(error?.stack??error).slice(0,5000)};throw error;}
 };
 const check=proof=>{const bytes=assertDelegatedCapacityFootprint(proof,state);state.previous=proof;return bytes;};
 const current=async label=>{const proof=JSON.parse(await step(label,`do $dcap_check$ begin ${oldGuard}end;$dcap_check$;select ${proofSql};`));check(proof);return proof;};
 // This measurement is deliberately the OWNED test connection, NOT a public
 // service API. The private guard takes the actual settings/worker/role locks.
 //187 re-authorizes and constructs its own authority. Only authorizedAt can
 //advance; its fixed six-digit UTC length is verified by the saved actual N.
 const measureAndInject=async args=>{
  const value=JSON.parse(await step('measure_authorized_stored_body',`do $dcap_measure$ declare cap_before text;cap_authority jsonb;cap_bytes integer;begin
   cap_before:=${fullHash};cap_authority:=public.faolla_attendance_period_delegation_guard_v1(${site},${quote(p.grant)},${quote(p.auth)},'send',${quote(h.workerId)},${quote(p.date)}::date,${quote(p.date)}::date,${pid},true);
   cap_bytes:=octet_length(convert_to((${json(args.p_artifact)}||jsonb_build_object('authority',cap_authority))::text,'UTF8'));
   assert ${fullHash}=cap_before,'delegated_capacity_measurement_wrote';${oldGuard}
   perform set_config('faolla.capacity235_measure',jsonb_build_object('bytes',cap_bytes,'authority',cap_authority)::text,true);
  end;$dcap_measure$;select current_setting('faolla.capacity235_measure')::jsonb;`));measurements++;
  const target=periodContinuationCapacityRemaining(value.bytes,shortage),expected=state.expectedUsed;assert(target>=state.baseline);shortage=null;
  await step('inject_exact_projection',`do $dcap_inject$ declare cap_before text;begin cap_before:=${noStorage};
   perform 1 from public.merchant_attendance_settings where merchant_id=${site} for update;
   update public.merchant_attendance_period_storage set used_bytes=${target} where merchant_id=${site} and used_bytes=${expected};assert found,'delegated_capacity_projection_cas';
   assert ${noStorage}=cap_before,'delegated_capacity_projection_changed_other_facts';${oldGuard}
  end;$dcap_inject$;`);state.expectedUsed=target;measured=value;await current('proof_injected_projection');
 };
 const rpc=async(name,args)=>{
  assert(['faolla_attendance_period_delegation_v1','faolla_attendance_period_delegated_closure_v1','faolla_attendance_period_closure_v2','faolla_attendance_period_closure_source_v1'].includes(name));
  assert.equal(args.p_query.siteId,d.site);assert([d.owner,p.auth,h.employeeAuthUserId].includes(args.p_auth_user_id));
  const keys=name==='faolla_attendance_period_closure_source_v1'?['p_query','p_auth_user_id']:name==='faolla_attendance_period_delegation_v1'?['p_query','p_auth_user_id','p_command','p_allow_write']:['p_query','p_auth_user_id','p_command','p_artifact','p_allow_write'];
  assert.deepEqual(Object.keys(args).sort(),[...keys].sort());assert.equal(scope.sql(json(args)),json(args),'delegated_capacity_literal_schema_rewrite');
  const command=args.p_command??null,replay=!!command&&state.accepted.has(command.operationId);
  if(name!=='faolla_attendance_period_delegation_v1'){assert.equal(args.p_query.workerId,h.workerId);assert.equal(args.p_query.fromDate,p.date);assert.equal(args.p_query.throughDate,p.date);assert([null,p.periodId].includes(args.p_query.periodId));}
  if(shortage!==null&&command?.action==='send'){assert.equal(name,'faolla_attendance_period_delegated_closure_v1');assert.equal(command.operationId,p.send);await measureAndInject(args);}
  if(command?.operationId===p.send&&args.p_allow_write===true&&!replay)firstArgs=structuredClone(args);
  const expression=`public.${name}(${keys.map(k=>k==='p_auth_user_id'?quote(args[k]):k==='p_allow_write'?String(args[k]):json(args[k])).join(',')})`;
  const allowed=delegatedCapacityHash(names,delegatedCapacityCallScopes(d.site,p,name,command));
  const output=JSON.parse(await step('rpc_'+name+'_'+(command?.action??args.p_query.mode??'source'),`do $dcap_rpc$ declare cap_before text;cap_allowed text;cap_value jsonb;cap_failure text;cap_state text;cap_context text;begin
   ${oldGuard}cap_before:=${fullHash};cap_allowed:=${allowed};begin
    set local role service_role;assert current_user='service_role','delegated_capacity_actual_service_role';cap_value:=${expression};set constraints all immediate;set constraints all deferred;
   exception when others then get stacked diagnostics cap_failure=message_text,cap_state=returned_sqlstate,cap_context=pg_exception_context;end;reset role;
   if cap_failure is not null or ${command===null||replay?'true':'false'} then assert ${fullHash}=cap_before,'delegated_capacity_read_replay_rejection_wrote';
   else assert ${allowed}=cap_allowed,'delegated_capacity_write_outside_exact_operation';end if;${oldGuard}
   perform set_config('faolla.capacity235_result',jsonb_build_object('value',cap_value,'error',cap_failure,'sqlstate',cap_state,'context',cap_context,'proof',${proofSql})::text,true);
  end;$dcap_rpc$;select current_setting('faolla.capacity235_result')::jsonb;`));lastRpc={name,...output};roleAssertions++;
  if(!output.error&&command&&!replay){state.accepted.set(command.operationId,{query:args.p_query,command,actor:args.p_auth_user_id});
   if(command.operationId===p.send){assert(measured);state.expectedUsed+=measured.bytes;assert.equal(state.expectedUsed,LIMIT);}
  }
  check(output.proof);
  if(output.error){rejections++;return {data:null,error:{message:output.error}};}
  if(replay)replays++;else if(command)writes++;else reads++;return {data:output.value,error:null};
 };
 const q=(mode='detail',extra={})=>({siteId:d.site,access:'delegate',grantId:p.grant,workerId:h.workerId,fromDate:p.date,throughDate:p.date,mode,
  periodId:mode==='preview'?null:p.periodId,operationId:null,version:null,cursor:null,...extra});
 const run=(query,command=null,moduleEnabled=true)=>executePeriodDelegatedClosures({query,command,authUserId:p.auth,moduleEnabled},{rpc});
 const command=(action,operationId,head=null,fp=null)=>({action,operationId,periodId:p.periodId,expectedRevision:head?.revision??0,expectedVersion:head?.currentVersion??0,
  expectedFingerprint:['send','confirm','seal'].includes(action)?fp:null,reason:'Synthetic235 explicit quota acceptance; complete rollback, not real employee consent'});
 const raw=async(args,error=null)=>{const response=await rpc('faolla_attendance_period_delegated_closure_v1',args);
  if(error){assert.equal(response.error?.message,error);assert.equal(lastRpc.sqlstate,'P0001');return null;}
  assert.equal(response.error,null);return projectPeriodDelegatedClosureResult(response.data,args.p_query,args.p_auth_user_id,args.p_command);
 };
 try{
  const initial=JSON.parse(await step('begin',`set local lock_timeout='3s';set local statement_timeout='10s';
   do $dcap_begin$ begin
    assert not exists(select 1 from public.merchant_enterprise_roles where id=${quote(p.role)}) and not exists(select 1 from public.merchant_enterprise_employees where id=${quote(p.delegate)} or auth_user_id=${quote(p.auth)}),'delegated_capacity_seed_collision';
    assert not exists(select 1 from public.merchant_attendance_period_closures where period_id=${pid} or merchant_id=${site} and worker_id=${quote(h.workerId)} and start_at<'2010-01-09T00:00:00Z'::timestamptz and end_at>'2010-01-08T00:00:00Z'::timestamptz),'delegated_capacity_period_collision';
    assert not exists(select 1 from public.merchant_attendance_period_entries where operation_id between ${quote(uid(0))} and ${quote(uid(9999))})
     and not exists(select 1 from public.merchant_attendance_period_delegations where grant_id between ${quote(uid(0))} and ${quote(uid(9999))})
     and not exists(select 1 from public.merchant_attendance_period_delegation_operations where operation_id between ${quote(uid(0))} and ${quote(uid(9999))}),'delegated_capacity_operation_collision';
    perform set_config('faolla.capacity235_outside',${outside},true);
   end;$dcap_begin$;
   select jsonb_build_object('proof',${proofSql},'from',to_char((clock_timestamp()-interval '1 minute') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'until',to_char((clock_timestamp()+interval '1 day') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'auditTriggers',jsonb_build_object('employeeAudit',exists(select 1 from pg_trigger where tgrelid='public.merchant_enterprise_employees'::regclass and tgname='merchant_enterprise_employees_audit' and not tgisinternal and tgenabled='O' and tgtype=29 and tgfoid='public.faolla_capture_merchant_enterprise_audit_v1()'::regprocedure),
     'roleAudits',(select count(*) from pg_trigger where tgrelid='public.merchant_enterprise_roles'::regclass and not tgisinternal and tgfoid='public.faolla_capture_merchant_enterprise_audit_v1()'::regprocedure)));`));
  for(const rows of Object.values(initial.proof.rows))assert.deepEqual(rows,[],'delegated_capacity_ids_must_be_unused');
  assert.deepEqual(initial.auditTriggers,{employeeAudit:true,roleAudits:0},'delegated_capacity_inherited_employee_only_audit');
  assert.equal(initial.proof.usedBytes,initial.proof.actualBytes);assert(initial.proof.usedBytes>0&&initial.proof.usedBytes<LIMIT-262144);
  state.baseline=state.expectedUsed=initial.proof.usedBytes;check(initial.proof);
  await step('seed_exact_supervisor',`do $dcap_seed$ begin ${oldGuard}
   insert into public.merchant_enterprise_roles(id,merchant_id,name,permissions) values(${quote(p.role)},${site},'Synthetic235 quota supervisor',array[${permissions.map(quote).join(',')}]);
   insert into public.merchant_enterprise_employees(id,merchant_id,auth_user_id,email,display_name,role_id,status,accepted_at,version)
    values(${quote(p.delegate)},${site},${quote(p.auth)},'synthetic235-quota@example.test','Synthetic235 quota supervisor',${quote(p.role)},'active',clock_timestamp(),1);
   ${oldGuard}end;$dcap_seed$;`);state.seeded=true;await current('proof_seed');
  const managementQuery={siteId:d.site,access:'owner',mode:'list',catalog:null,grantId:null,afterId:null,operationId:null};
  await executePeriodDelegation({query:managementQuery,authUserId:d.owner,allowWrite:true,command:{action:'grant',operationId:p.grant,
   delegateEmployeeId:p.delegate,delegateAuthUserId:p.auth,workerId:h.workerId,employeeId:h.employeeId,employeeAuthUserId:h.employeeAuthUserId,
   fromDate:p.date,throughDate:p.date,actions:['view','send','respond','seal','reopen'],includeExisting:false,validFrom:initial.from,validUntil:initial.until,
   reason:'Synthetic235 exact single empty period capacity test'}},{rpc});
  const preview=await run(q('preview'));assert.equal(preview.kind,'preview');assert.deepEqual(preview.preview.blockers,[]);
  const fp=preview.preview.artifact.sourceFingerprint,first=command('send',p.send,null,fp);
  shortage=1;await assert.rejects(run(q(),first),e=>e.code==='attendance_period_storage_limit');assert.equal(shortage,null);assert.equal(lastRpc.sqlstate,'P0001');
  assert.equal(state.accepted.has(p.send),false);assert.equal(lastRpc.proof.rows[table('period_closures')].length,0);const rejectedBytes=measured.bytes;
  assert.equal((await run(q('recover',{operationId:p.send}),null,false)).receipt,null);
  // Definite zero-write rejection above permits this EXPLICIT same-id retry.
  // It is not an unknown-response client auto-POST or receipt replay.
  shortage=0;const sent=await run(q(),first);assert.equal(shortage,null);assert.equal(sent.kind,'receipt');assert.equal(sent.receipt.operationId,p.send);
  const savedReceipt=sent.receipt;assert.equal(state.expectedUsed,LIMIT);let head=await run(q());
  const stored=periodContinuationArchiveBytes(lastRpc.value),chargedBytes=stored.artifactBytes;assert.equal(chargedBytes,measured.bytes);
  assert.deepEqual(without(head.artifact.authority,['authorizedAt']),without(measured.authority,['authorizedAt']));
  assert.equal(head.artifact.authority.authorizedAt.length,measured.authority.authorizedAt.length);assert(head.artifact.authority.authorizedAt>=measured.authority.authorizedAt);
  assert.equal(head.sourceChanged,false);assert.equal(head.period.revision,1);
  assert.deepEqual((await run(q('recover',{operationId:p.send}),null,false)).receipt,savedReceipt);
  // Bypass only the service's GET optimization to test the actual SQL POST
  // replay; the normal Node strict result parser still validates its receipt.
  assert(firstArgs?.p_command);assert.deepEqual((await raw(firstArgs)).receipt,savedReceipt);
  await raw({...firstArgs,p_allow_write:false},'attendance_period_delegation_disabled');
  const respond=command('respond',p.respond,head.period);
  await raw({p_query:q(),p_auth_user_id:p.auth,p_command:respond,p_artifact:null,p_allow_write:false},'attendance_period_delegation_disabled');
  await run(q(),respond);head=await run(q());assert.equal(head.period.confirmedVersion,null);
  const selfQuery={siteId:d.site,access:'self',workerId:h.workerId,fromDate:p.date,throughDate:p.date,mode:'detail',periodId:p.periodId,operationId:null,version:null,cursor:null};
  await executePeriodClosuresV2({query:selfQuery,command:command('confirm',p.confirm,head.period,fp),authUserId:h.employeeAuthUserId,moduleEnabled:true},{rpc});
  head=await run(q());assert.equal(head.period.confirmedVersion,1);await run(q(),command('seal',p.seal,head.period,fp));head=await run(q());assert.equal(head.period.sealed,true);
  const reopen=command('reopen',p.reopen,head.period);
  await raw({p_query:q(),p_auth_user_id:p.auth,p_command:reopen,p_artifact:null,p_allow_write:false},'attendance_period_delegation_disabled');
  await run(q(),reopen);head=await run(q());assert.equal(head.period.state,'open');assert.equal(head.period.confirmedVersion,null);
  await run(q(),command('send',p.reuse,head.period,fp));head=await run(q());assert.equal(head.period.currentVersion,2);assert.deepEqual(periodContinuationArchiveBytes(lastRpc.value),stored);
  assert.deepEqual((await run(q('recover',{operationId:p.send}),null,false)).receipt,savedReceipt);
  const final=await current('final_exact_footprint');assert.equal(final.usedBytes,LIMIT);assert.equal(final.actualBytes,state.baseline+chargedBytes);
  assert.equal(final.rows[table('period_entries')].length,6);assert.equal(final.rows[table('period_versions')].length,2);assert.equal(final.rows[table('period_delegation_operations')].length,5);
  assert.equal(final.rows[table('period_artifacts')].length,1);assert.equal(measurements,2);assert.equal(replays,1);assert.equal(rejections,4);
  await step('constraints_and_rollback',`do $dcap_final$ begin ${oldGuard}set constraints all immediate;end;$dcap_final$;rollback;`);rolledBack=true;
  result={phase:235,transactionSteps:steps,reads,writes,replays,rejections,roleAssertions,measurements,actualNewArtifacts:1,newArtifactBytes:chargedBytes,rejectedCandidateBytes:rejectedBytes,
   entries:6,versions:2,delegateSidecars:5,injectedQuotaProjection:true,physicallyFilledBudget:false,budgetLimitBytes:LIMIT,
   measurementPrivateGuardByOwnedTestConnection:true,actualStoredAuthorityByteSizeVerified:true,oneByteOverflowRejectedWithZeroRows:true,explicitSameIdRetry:true,
   exactBoundaryCharged:true,sameSourceReuseUncharged:true,fullQuotaRespondReopen:true,actualSqlPostReplayUncharged:true,flagOffPostRejected:true,flagOffOriginalRecoveryUncharged:true,
   originalImmutableRowsPreserved:true,old155ArchivePreserved:true,old207ArchivePreserved:true,rollbackRestored:true,
   actualNodeProjectionAndServiceRoleRpc:true,syntheticAuth:true,realAuth:false,browser:false,productionAccess:false};
 }catch(error){failures.push(new Error('delegated_capacity:'+stage+':'+String(error?.message??error),{cause:error}));}
 finally{
  try{await connection.close();}catch(error){failures.push(error);}
  for(const[label,read,want]of[['facts',()=>d.fingerprint(),facts],['definitions',()=>d.definitions(),definitions],['catalog',()=>d.tableCatalog(),catalog],
   ['old155',async()=>periodContinuationArchiveBytes(await archive()),old155],['old207',async()=>periodContinuationArchiveBytes(await periodArchive()),old207]]){
   try{assert.deepEqual(await read(),want,'delegated_capacity_rollback_'+label);}catch(error){failures.push(error);}
  }
 }
 if(failures.length)throw new AggregateError(failures,'delegated_capacity_native_failed:'+failures.slice(0,6).map(e=>String(e?.stack??e)+'\n'+String(e?.cause?.stack??'')).join('\n').slice(0,9000)
  +'\nlastStepFailure:'+JSON.stringify(lastStepFailure)+'\nlastRpcError:'+JSON.stringify(lastRpc?.error?{name:lastRpc.name,error:lastRpc.error,sqlstate:lastRpc.sqlstate,context:lastRpc.context?.slice(0,2000)}:null),{cause:failures[0]});
 assert(rolledBack);native.pass('235 delegated quota: disclosed projection, real187 one-byte rejection/exact charge/reuse/replay and complete rollback');return result;
}
