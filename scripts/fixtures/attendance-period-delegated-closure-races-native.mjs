// INERT234: caller-owned synthetic namespace only. No connection on import.
// Successful NEW rows commit for real two-session visibility; the parent owns
// schema disposal. Existing rows/archives are never excluded from protection.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {assertLifecycleSandbox,lifecycleId as id,lifecycleJson as json} from '../merchant-attendance-lifecycle-native-support.mjs';
import {quote} from './attendance-bound-clocks-native.mjs';
import {periodContinuationArchiveBytes,periodContinuationSerialization} from './attendance-period-continuation-native.mjs';
const require=createRequire(import.meta.url),rid=n=>id(234300000+n);
const table=s=>'merchant_attendance_'+s,permissions=['enterprise.view','attendance.period.view','attendance.period.send','attendance.period.respond','attendance.period.seal','attendance.period.reopen'];
export function delegatedRacesPlan(){return {role:rid(1),members:[{employeeId:rid(2),authId:rid(3),pause:rid(31)},{employeeId:rid(4),authId:rid(5),pause:rid(32)}],
 period:{date:'2010-01-05',periodId:rid(10),send:rid(20),respond:rid(21),confirm:rid(22),seal:rid(23)},
 failed:{date:'2010-01-06',periodId:rid(11),send:rid(24)},rejectedRespond:rid(25),grants:[rid(40),rid(41),rid(42),rid(43)],revokes:[rid(50),rid(51)]};}
export function delegatedRacesScopes(site,plan=delegatedRacesPlan()){
 assert(/^\d{8}$/.test(site));const s=quote(site),p=plan.period,m=plan.members.map(x=>quote(x.employeeId)).join(','),inSite=x=>`t.merchant_id=${s} and (${x})`;
 return {merchant_enterprise_roles:inSite(`t.id=${quote(plan.role)}`),merchant_enterprise_employees:inSite(`t.id in(${m})`),
  merchant_enterprise_audit_events:inSite(`t.entity_id in(${m})`),
  [table('period_closures')]:inSite(`t.period_id=${quote(p.periodId)}`),
  [table('period_entries')]:inSite(`t.period_id=${quote(p.periodId)} and t.operation_id in(${[p.send,p.respond,p.confirm,p.seal].map(quote).join(',')})`),
  [table('period_versions')]:inSite(`t.period_id=${quote(p.periodId)} and t.version=1 and t.operation_id=${quote(p.send)}`),
  [table('period_artifacts')]:inSite(`t.period_id=${quote(p.periodId)} and t.artifact_id=${quote(p.send)}`),
  [table('period_artifact_metadata')]:inSite(`t.artifact_id=${quote(p.send)}`),
  [table('period_delegations')]:inSite(`t.grant_id in(${plan.grants.map(quote).join(',')})`),
  [table('period_delegation_revocations')]:inSite(`t.operation_id in(${plan.revokes.map(quote).join(',')})`),
  [table('period_delegation_operations')]:inSite(`t.period_id=${quote(p.periodId)} and t.operation_id in(${[p.send,p.respond,p.seal].map(quote).join(',')})`),
  [table('account_epochs')]:inSite(`t.employee_id in(${m}) and t.generation=1`),
  [table('account_suspensions')]:inSite(`t.employee_id in(${m}) and t.generation=1`),
  [table('account_status_operations')]:inSite(`t.operation_id in(${plan.members.map(x=>quote(x.pause)).join(',')})`)};
}
export function delegatedRacesProtectedHash(names,site,plan=delegatedRacesPlan()){
 assert(names.length&&new Set(names).size===names.length);const scopes={...delegatedRacesScopes(site,plan),[table('period_storage')]:`t.merchant_id=${quote(site)}`};
 return `(select md5(jsonb_object_agg(dr_name,dr_rows order by dr_name)::text) from (${names.map(name=>{
  assert(/^(?:merchants|faolla_schema_migrations|merchant_[a-z0-9_]+)$/.test(name)&&name.length<=63);
  return `select ${quote(name)} dr_name,(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]') from public.${name} t${scopes[name]?` where (${scopes[name]}) is not true`:''}) dr_rows`;
 }).join(' union all ')}) dr_facts)`;
}
const without=(object,keys)=>Object.fromEntries(Object.entries(object).filter(([key])=>!keys.includes(key)));
// Compare independently read committed/transaction-visible facts to the exact
// submitted commands. Previously observed immutable NEW rows remain immutable.
export function assertDelegatedRacesFootprint(proof,state){
 const {site,workerId,employeeId,employeeAuthUserId,owner,baseline,accepted,seeded,previous,plan=delegatedRacesPlan()}=state,p=plan.period;
 const rows=name=>proof.rows[name],get=short=>rows(table(short)),has=op=>accepted.has(op),ownedOps=[p.send,p.respond,p.confirm,p.seal].filter(has);
 const ids=(values,key)=>values.map(x=>x[key]).sort(),sameIds=(values,key,expected)=>assert.deepEqual(ids(values,key),[...expected].sort());
 sameIds(rows('merchant_enterprise_roles'),'id',seeded?[plan.role]:[]);sameIds(rows('merchant_enterprise_employees'),'id',seeded?plan.members.map(x=>x.employeeId):[]);
 if(seeded){assert.deepEqual(rows('merchant_enterprise_roles')[0].permissions,permissions);assert.equal(rows('merchant_enterprise_roles')[0].status,'active');}
 for(const member of rows('merchant_enterprise_employees')){const wanted=plan.members.find(x=>x.employeeId===member.id);
  assert.equal(member.merchant_id,site);assert.equal(member.auth_user_id,wanted.authId);assert.equal(member.role_id,plan.role);
  assert.equal(member.status,has(wanted.pause)?'disabled':'active');assert.equal(member.version,has(wanted.pause)?2:1);
 }
 const grants=plan.grants.filter(has),revokes=plan.revokes.filter(has),paused=plan.members.filter(x=>has(x.pause));
 sameIds(get('period_delegations'),'grant_id',grants);sameIds(get('period_delegation_revocations'),'operation_id',revokes);
 for(const row of [...get('period_delegations'),...get('period_delegation_revocations')]){const request=accepted.get(row.grant_id&&row.command.action==='grant'?row.grant_id:row.operation_id);
  assert.deepEqual(row.command,request.command);assert.deepEqual(row.query,request.query);assert.equal(row.actor_auth_user_id,owner);}
 sameIds(get('period_entries'),'operation_id',ownedOps);sameIds(get('period_delegation_operations'),'operation_id',ownedOps.filter(x=>x!==p.confirm));
 for(const row of get('period_entries')){const request=accepted.get(row.operation_id);assert.deepEqual(row.command,request.command);assert.equal(row.actor_auth_user_id,request.actor);
  assert.equal(row.period_id,p.periodId);assert.equal(row.revision,request.command.expectedRevision+1);assert.equal(row.version,1);}
 for(const row of get('period_delegation_operations')){const request=accepted.get(row.operation_id);assert.deepEqual(row.command,request.command);assert.deepEqual(row.query,request.query);
  assert.equal(row.grant_id,request.query.grantId);assert.equal(row.actor_auth_user_id,request.actor);assert.equal(row.worker_id,workerId);
  assert.equal(row.employee_id,employeeId);assert.equal(row.employee_auth_user_id,employeeAuthUserId);assert.equal(row.period_revision,request.command.expectedRevision+1);}
 assert.equal(proof.sidecarsValid,true);assert.equal(proof.delegateWorkers,0);
 const exists=has(p.send);sameIds(get('period_closures'),'period_id',exists?[p.periodId]:[]);assert.equal(get('period_versions').length,Number(exists));
 sameIds(get('period_artifacts'),'artifact_id',exists?[p.send]:[]);sameIds(get('period_artifact_metadata'),'artifact_id',exists?[p.send]:[]);
 let added=0;
 if(exists){const head=get('period_closures')[0],entries=get('period_entries'),first=entries.find(x=>x.operation_id===p.send),last=entries.find(x=>x.revision===ownedOps.length),body=get('period_artifacts')[0];
  assert.equal(head.worker_id,workerId);assert.equal(head.employee_id,employeeId);assert.equal(head.employee_auth_user_id,employeeAuthUserId);
  assert.equal(head.from_date,p.date);assert.equal(head.through_date,p.date);assert.equal(head.time_zone,'UTC');assert.equal(head.revision,ownedOps.length);assert.equal(head.current_version,1);
  assert.equal(head.state,has(p.seal)?'sealed':has(p.confirm)?'confirmed':'review');assert.equal(head.sealed,has(p.seal));assert.equal(head.confirmed_version,has(p.confirm)?1:null);assert.equal(head.unresolved_dispute,false);
  assert.equal(head.opened_at,first.recorded_at);assert.equal(head.updated_at,last.recorded_at);
  assert.deepEqual(get('period_versions')[0],{merchant_id:site,period_id:p.periodId,version:1,artifact_id:p.send,operation_id:p.send,recorded_at:first.recorded_at});
  const artifact=JSON.parse(body.artifact_text);periodContinuationArchiveBytes({artifact,artifactText:body.artifact_text,artifactBytes:body.artifact_bytes,artifactSha256:body.artifact_sha256});
  assert.equal(artifact.protocol,'attendance-period-artifact-v2');assert.equal(artifact.report.access,'delegate');assert.equal(artifact.authority.grantId,plan.grants[0]);assert.equal(artifact.authority.action,'send');
  assert.equal(body.source_fingerprint,artifact.sourceFingerprint);assert.equal(body.recorded_at,first.recorded_at);assert(body.artifact_bytes>0&&body.artifact_bytes<=262144);added=body.artifact_bytes;
  assert.deepEqual(get('period_artifact_metadata')[0],{merchant_id:site,artifact_id:p.send,worker_name:artifact.worker.workerName,worker_no:artifact.worker.workerNo});
 }
 sameIds(get('account_epochs'),'employee_id',paused.map(x=>x.employeeId));sameIds(get('account_suspensions'),'employee_id',paused.map(x=>x.employeeId));sameIds(get('account_status_operations'),'operation_id',paused.map(x=>x.pause));
 for(const member of paused){const epoch=get('account_epochs').find(x=>x.employee_id===member.employeeId),stop=get('account_suspensions').find(x=>x.employee_id===member.employeeId),op=get('account_status_operations').find(x=>x.operation_id===member.pause);
  assert.equal(epoch.generation,1);assert.equal(epoch.paused,true);assert.equal(epoch.suspension_id,stop.suspension_id);assert.equal(stop.employee_auth_user_id,member.authId);assert.equal(stop.worker_id,null);assert.equal(stop.was_active,null);
  assert.equal(op.suspension_id,stop.suspension_id);assert.equal(op.employee_id,member.employeeId);assert.equal(op.actor_auth_user_id,owner);assert.equal(op.version,2);assert.equal(op.expected_version,1);assert.equal(op.status,'disabled');
  assert.deepEqual(op.input,without(accepted.get(member.pause).input,['attendance_operation_id','attendance_suspension_enabled']));
 }
 // The inherited employee-management fixture copies019's employee trigger,
 // not its separate role-editor trigger. Catalog preflight below pins this
 // narrower fixture, rather than pretending production roles lack auditing.
 const audit=rows('merchant_enterprise_audit_events');assert.equal(audit.length,seeded?2+paused.length:0);
 if(seeded)for(const [index,member]of plan.members.entries()){
  const created=audit.filter(x=>x.entity_id===member.employeeId&&x.event_type==='employee.created');assert.equal(created.length,1);
  assert.equal(created[0].actor_type,'system');assert.deepEqual(created[0].before_data,{});
  const stopped=audit.filter(x=>x.entity_id===member.employeeId&&x.event_type==='employee.disabled');assert.equal(stopped.length,Number(has(member.pause)));
  for(const row of [...created,...stopped]){
   assert.equal(row.merchant_id,site);assert.equal(row.entity_type,'employee');assert.equal(row.actor_id,null);assert.equal(row.operation_id,'');assert.equal(row.dedupe_key,null);
   assert.equal(row.after_data.display_name,`Synthetic234 supervisor ${index}`);assert.equal(row.after_data.role_id,plan.role);assert.equal(row.after_data.auth_bound,true);
   assert.equal(row.after_data.status,row.event_type==='employee.created'?'active':'disabled');
  }
  if(stopped.length){assert.equal(stopped[0].actor_type,'owner');assert.equal(stopped[0].before_data.status,'active');
   assert.deepEqual(without(stopped[0].before_data,['status']),without(stopped[0].after_data,['status']));}
 }
 for(const row of audit)assert(plan.members.some(member=>member.employeeId===row.entity_id));
 assert.equal(proof.usedBytes,baseline+added);assert.equal(proof.actualBytes,baseline+added);assert(proof.usedBytes<=67108864);assert.equal(proof.failedFootprint,0);
 if(previous)for(const [name,old]of Object.entries(previous.rows)){
  if(name===table('period_closures')){if(old.length)assert.deepEqual(without(rows(name)[0],['revision','current_version','state','sealed','confirmed_version','unresolved_dispute','updated_at']),without(old[0],['revision','current_version','state','sealed','confirmed_version','unresolved_dispute','updated_at']));}
  else if(name==='merchant_enterprise_employees'){for(const row of old)assert.deepEqual(without(rows(name).find(x=>x.id===row.id),['status','version','updated_at']),without(row,['status','version','updated_at']));}
  else for(const row of old)assert(rows(name).some(current=>JSON.stringify(current)===JSON.stringify(row)),'delegated_races_immutable_new_row:'+name);
 }
 return added;
}

export async function verifyPeriodDelegatedClosureRacesNative(ctx){
 const {d,h,native,scope,archive,oldArchive,periodArchive,period,pq,periodId}=ctx;
 assert(d?.syntheticOnly===true&&h?.syntheticOnly===true,'delegated_races_owned_synthetic_context_required');
 assert.deepEqual(assertLifecycleSandbox(sql=>native.query(scope.sql(sql))),d.owned);assert.equal(scope.schema,d.owned.schema);
 const {executePeriodDelegation}=require('../../src/lib/merchantAttendancePeriodDelegation.server.ts');
 const {executePeriodDelegatedClosures}=require('../../src/lib/merchantAttendancePeriodDelegatedClosure.server.ts');
 const {executePeriodClosuresV2}=require('../../src/lib/merchantAttendancePeriodClosureV2.server.ts');
 const plan=delegatedRacesPlan(),p=plan.period,[a,b]=plan.members,site=quote(d.site),names=d.inventory(),scopes=delegatedRacesScopes(d.site,plan);
 for(const name of Object.keys(scopes))assert(names.includes(name));
 const execRead=sql=>d.exec(periodContinuationSerialization+d.guard+sql),protectedSql=delegatedRacesProtectedHash(names,d.site,plan),protectedBefore=execRead('select '+protectedSql+';');
 const definitions=d.definitions(),catalog=d.tableCatalog(),old155=periodContinuationArchiveBytes(archive()),old207=periodContinuationArchiveBytes(periodArchive());assert.deepEqual(old155,periodContinuationArchiveBytes(oldArchive));
 const proofSql=`jsonb_build_object('rows',jsonb_build_object(${Object.entries(scopes).map(([name,where])=>`${quote(name)},(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]') from public.${name} t where ${where})`).join(',')}),
  'usedBytes',(select used_bytes from public.merchant_attendance_period_storage where merchant_id=${site}),
  'actualBytes',(select coalesce(sum(artifact_bytes),0) from public.merchant_attendance_period_artifacts where merchant_id=${site}),
  'sidecarsValid',not exists(select 1 from public.merchant_attendance_period_delegation_operations t where ${scopes[table('period_delegation_operations')]} and public.faolla_attendance_period_delegation_proof_v1(t) is distinct from true),
  'delegateWorkers',(select count(*) from public.merchant_attendance_workers where merchant_id=${site} and employee_id in(${quote(a.employeeId)},${quote(b.employeeId)})),
  'failedFootprint',(select count(*) from public.merchant_attendance_period_closures where period_id=${quote(plan.failed.periodId)})+
   (select count(*) from public.merchant_attendance_period_entries where operation_id in(${quote(plan.rejectedRespond)},${quote(plan.failed.send)}) or period_id=${quote(plan.failed.periodId)})+
   (select count(*) from public.merchant_attendance_period_artifacts where artifact_id=${quote(plan.failed.send)} or period_id=${quote(plan.failed.periodId)})+
   (select count(*) from public.merchant_attendance_period_versions where operation_id=${quote(plan.failed.send)} or period_id=${quote(plan.failed.periodId)})+
   (select count(*) from public.merchant_attendance_period_artifact_metadata where artifact_id=${quote(plan.failed.send)})+
   (select count(*) from public.merchant_attendance_period_delegation_operations where operation_id in(${quote(plan.rejectedRespond)},${quote(plan.failed.send)}) or period_id=${quote(plan.failed.periodId)}))`;
 const proof=()=>JSON.parse(execRead('select '+proofSql+';')),initial=proof();for(const rows of Object.values(initial.rows))assert.deepEqual(rows,[],'delegated_races_ids_already_exist');
 assert.equal(initial.failedFootprint,0);assert.equal(initial.usedBytes,initial.actualBytes);assert(initial.usedBytes>0&&initial.usedBytes<67108864);
 const profile=JSON.parse(execRead(`select jsonb_build_object('from',to_char((clock_timestamp()-interval '1 minute') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'until',to_char((clock_timestamp()+interval '1 day') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'employeeId',(select employee_id from public.merchant_attendance_workers where merchant_id=${site} and id=${quote(h.workerId)}),
  'employeeAuthUserId',(select auth_user_id from public.merchant_enterprise_employees where merchant_id=${site} and id=${quote(h.employeeId)}),
  'auditTriggers',jsonb_build_object('employeeAudit',exists(select 1 from pg_trigger where tgrelid='public.merchant_enterprise_employees'::regclass
   and tgname='merchant_enterprise_employees_audit' and not tgisinternal and tgenabled='O' and tgtype=29 and tgfoid='public.faolla_capture_merchant_enterprise_audit_v1()'::regprocedure),
   'roleAudits',(select count(*) from pg_trigger where tgrelid='public.merchant_enterprise_roles'::regclass and not tgisinternal and tgfoid='public.faolla_capture_merchant_enterprise_audit_v1()'::regprocedure)),
  'overlap',(select count(*) from public.merchant_attendance_period_closures where merchant_id=${site} and worker_id=${quote(h.workerId)} and start_at<'2010-01-07T00:00:00Z'::timestamptz and end_at>'2010-01-05T00:00:00Z'::timestamptz));`));
 assert.equal(profile.overlap,0);assert.equal(profile.employeeId,h.employeeId);assert.equal(profile.employeeAuthUserId,h.employeeAuthUserId);
 assert.deepEqual(profile.auditTriggers,{employeeAudit:true,roleAudits:0},'delegated_races_employee_only_audit_fixture_required');
 const state={site:d.site,workerId:h.workerId,employeeId:h.employeeId,employeeAuthUserId:h.employeeAuthUserId,owner:d.owner,baseline:initial.usedBytes,accepted:new Map(),seeded:false,previous:initial,plan};
 const sessions=new Set(),receipts=new Map(),failures=[],groups=[];let steps=0,rpcCalls=0,stage='seed',lastRpc=null,completed=false;
 const prefix=periodContinuationSerialization+"set local lock_timeout='3s';set local statement_timeout='10s';"+d.guard;
 const oldGuard=`assert ${protectedSql}=${quote(protectedBefore)},'delegated_races_old_or_unlisted_row_changed';`;
 const check=value=>{assertDelegatedRacesFootprint(value,state);state.previous=value;return value;};
 const current=()=>{assert.equal(execRead('select '+protectedSql+';'),protectedBefore);return check(proof());};
 const managementQuery={siteId:d.site,access:'owner',mode:'list',catalog:null,grantId:null,afterId:null,operationId:null};
 const query=(grantId,which=p,mode='detail',extra={})=>({siteId:d.site,access:'delegate',workerId:h.workerId,grantId,fromDate:which.date,throughDate:which.date,mode,
  periodId:mode==='preview'?null:which.periodId,operationId:null,version:null,cursor:null,...extra});
 const oldQuery=(access='owner')=>({siteId:d.site,access,workerId:h.workerId,fromDate:p.date,throughDate:p.date,mode:'detail',periodId:p.periodId,operationId:null,version:null,cursor:null});
 const command=(action,operationId,head=null,fingerprint=null,which=p)=>({action,operationId,periodId:which.periodId,expectedRevision:head?.revision??0,expectedVersion:head?.currentVersion??0,
  expectedFingerprint:['send','confirm','seal'].includes(action)?fingerprint:null,reason:'Synthetic234 explicit local race, not real employee consent'});
 const request=(kind,actor,query,command=null)=>({kind,actor,query,command});
 const grant=(index,member=a,which=p)=>request('management',d.owner,managementQuery,{action:'grant',operationId:plan.grants[index],delegateEmployeeId:member.employeeId,delegateAuthUserId:member.authId,
  workerId:h.workerId,employeeId:h.employeeId,employeeAuthUserId:h.employeeAuthUserId,fromDate:which.date,throughDate:which.date,actions:['view','send','respond','seal','reopen'],includeExisting:index>0,
  validFrom:profile.from,validUntil:profile.until,reason:'Synthetic234 one exact empty employee period'});
 const revoke=index=>request('management',d.owner,{...managementQuery,mode:'detail',grantId:plan.grants[index]},
  {action:'revoke',operationId:plan.revokes[index],grantId:plan.grants[index],expectedRevision:1,reason:'Synthetic234 explicit owner revocation'});
 const pause=member=>({kind:'pause',actor:d.owner,input:{merchant_id:d.site,employee_id:member.employeeId,expected_version:1,actor_type:'owner',actor_id:d.owner,status:'disabled',offboarding_mode:'unassign',attendance_operation_id:member.pause,attendance_suspension_enabled:true}});
 const prepare=input=>{
  const connection=native.connect();let releaseGate,reachGate,cancelled=false;const gate=new Promise(resolve=>{releaseGate=resolve;}),reached=new Promise(resolve=>{reachGate=resolve;});
  const session={connection,input,last:null,closed:false,release:()=>releaseGate(),cancel:()=>{cancelled=true;releaseGate();},
   step:sql=>{assert(++steps<=100,'delegated_races_max100_steps');return connection.step(scope.sql(sql));},
   async close(){if(!session.closed){session.cancel();await connection.close();session.closed=true;sessions.delete(session);}}};sessions.add(session);
  const service={rpc:async(name,args)=>{
   const keys=name==='faolla_update_merchant_enterprise_employee_v1'?['p_input']:name==='faolla_attendance_period_delegation_v1'?['p_query','p_auth_user_id','p_command','p_allow_write']:
    name==='faolla_attendance_period_closure_source_v1'?['p_query','p_auth_user_id']:['p_query','p_auth_user_id','p_command','p_artifact','p_allow_write'];
   assert(['faolla_update_merchant_enterprise_employee_v1','faolla_attendance_period_delegation_v1','faolla_attendance_period_delegated_closure_v1','faolla_attendance_period_closure_v2','faolla_attendance_period_closure_source_v1'].includes(name));
   assert.deepEqual(Object.keys(args).sort(),[...keys].sort());assert.equal(args.p_query?.siteId??args.p_input?.merchant_id,d.site);assert.equal(args.p_auth_user_id??args.p_input.actor_id,input.actor);
   assert.equal(scope.sql(json(args)),json(args),'delegated_races_literal_schema_rewrite');
   const final=input.kind==='pause'||(input.command?args.p_command!=null:name!=='faolla_attendance_period_closure_source_v1');
   if(final){reachGate({name,args});await gate;if(cancelled)throw Error('delegated_races_cancelled');}
   const expression=`public.${name}(${keys.map(k=>k==='p_auth_user_id'?quote(args[k]):k==='p_allow_write'?String(args[k]):json(args[k])).join(',')})`;
   let output;try{output=await session.step(`begin;${prefix}do $delegated_race_rpc$ declare rpc_value jsonb;rpc_failure text;rpc_state text;rpc_context text;before_proof jsonb;begin
    ${oldGuard}before_proof:=${proofSql};begin set local role service_role;assert current_user='service_role';rpc_value:=${expression};set constraints all immediate;set constraints all deferred;
    exception when others then get stacked diagnostics rpc_failure=message_text,rpc_state=returned_sqlstate,rpc_context=pg_exception_context;end;reset role;${oldGuard}
    ${!final||!input.command&&input.kind!=='pause'?`assert ${proofSql}=before_proof,'delegated_races_read_changed_facts';`:''}
    assert (select used_bytes from public.merchant_attendance_period_storage where merchant_id=${site})=(select sum(artifact_bytes) from public.merchant_attendance_period_artifacts where merchant_id=${site}),'delegated_races_quota_exact';
    perform set_config('faolla.dr234_result',jsonb_build_object('value',rpc_value,'error',rpc_failure,'sqlstate',rpc_state,'context',rpc_context,'proof',${proofSql})::text,true);
   end;$delegated_race_rpc$;select current_setting('faolla.dr234_result')::jsonb;${final?'':'rollback;'}`);
   }catch(error){lastRpc=session.last={name,args,error:'transport_or_guard',context:String(error?.stack??error)};throw error;}
   const value=JSON.parse(output);rpcCalls++;lastRpc=session.last={name,args,...value};return value.error?{data:null,error:{message:value.error}}:{data:value.value,error:null};
  }};
  const run=input.kind==='management'?()=>executePeriodDelegation({query:input.query,command:input.command,authUserId:input.actor,allowWrite:true},service):
   input.kind==='delegate'?()=>executePeriodDelegatedClosures({query:input.query,command:input.command,authUserId:input.actor,moduleEnabled:input.query.mode!=='recover'},service):
   input.kind==='pause'?async()=>{const r=await service.rpc('faolla_update_merchant_enterprise_employee_v1',{p_input:input.input});if(r.error)throw Object.assign(Error(r.error.message),{code:r.error.message});return r.data;}:
   ()=>executePeriodClosuresV2({query:input.query,command:input.command,authUserId:input.actor,moduleEnabled:!!input.command},service);
  session.outcome=run().then(value=>({value,error:null}),error=>({value:null,error}));
  session.ready=()=>Promise.race([reached,session.outcome]).then(value=>{if(!value.args)throw value.error??Error('delegated_races_missing_final_rpc');return value;});return session;
 };
 const accept=(session,result)=>{const input=session.input,op=input.command?.operationId??input.input?.attendance_operation_id;
  if(op){assert(!state.accepted.has(op));if(input.kind==='pause'){assert.equal(result.employee.id,input.input.employee_id);assert.equal(result.employee.status,'disabled');assert.equal(result.employee.version,2);}
   else if(input.kind==='delegate'){assert.equal(result.kind,'receipt');assert.equal(result.receipt.operationId,op);assert.equal(result.receipt.actorId,input.actor);receipts.set(op,structuredClone(result.receipt));}
   state.accepted.set(op,input);}
  check(session.last.proof);
 };
 const one=async input=>{const s=prepare(input);try{await s.ready();s.release();const outcome=await s.outcome;if(outcome.error)throw outcome.error;accept(s,outcome.value);await s.step('commit;');current();return outcome.value;}finally{await s.close();await s.outcome;}};
 const race=async(label,left,right,expectedError=null)=>{
  stage=label;const holder=prepare(left),waiter=prepare(right);try{
   const ready=await Promise.all([holder.ready(),waiter.ready()]);
   if(right.command?.action==='send'){assert.equal(ready[1].args.p_artifact.protocol,'attendance-period-artifact-v2');assert(!Object.hasOwn(ready[1].args.p_artifact,'authority'));}
   holder.release();const won=await holder.outcome;if(won.error)throw won.error;accept(holder,won.value);
   const pid=Number(await holder.step('select pg_backend_pid();'));assert(Number.isSafeInteger(pid)&&pid>0);assert.match(waiter.connection.name,/^attendance_race_[a-f0-9]{32}$/);
   waiter.release();let witnessed=false,evidence=null;const until=Date.now()+2500;
   while(Date.now()<until){evidence=JSON.parse(native.query(`select coalesce((select jsonb_build_object('waiterPid',pid,'blockers',pg_blocking_pids(pid)) from pg_stat_activity where application_name=${quote(waiter.connection.name)} and wait_event_type='Lock' and ${pid}=any(pg_blocking_pids(pid))),'null'::jsonb);`));
    witnessed=Number.isSafeInteger(evidence?.waiterPid)&&evidence.waiterPid>0&&evidence.waiterPid!==pid&&evidence.blockers.includes(pid);
    if(witnessed)break;await new Promise(resolve=>setTimeout(resolve,15));}
   assert(witnessed,'delegated_races_exact_blocker_not_witnessed');await holder.step('commit;');const lost=await waiter.outcome;
   if(expectedError){assert.equal(lost.error?.code,expectedError,String(lost.error?.stack??'unexpected success'));assert.equal(waiter.last.sqlstate,'P0001');check(waiter.last.proof);await waiter.step('rollback;');}
   else{if(lost.error)throw lost.error;accept(waiter,lost.value);await waiter.step('commit;');}
   current();groups.push({label,exactBlockerPidWitnessed:true,holderPid:pid,waiterPid:evidence.waiterPid,blockingPids:evidence.blockers,waiterError:expectedError});
  }finally{await Promise.all([holder.close(),waiter.close()]);await Promise.all([holder.outcome,waiter.outcome]);}
 };
 try{
  // Only new synthetic membership metadata is seeded; no workers/events or
  // archive/version rows are fabricated. All period facts come from real RPCs.
  const seed=native.connect();try{assert(++steps<=100);const output=await seed.step(scope.sql(`begin;${prefix}do $dr_seed$ begin ${oldGuard}
   assert not exists(select 1 from public.merchant_enterprise_employees where auth_user_id in(${quote(a.authId)},${quote(b.authId)}));
   insert into public.merchant_enterprise_roles(id,merchant_id,name,permissions) values(${quote(plan.role)},${site},'Synthetic234 race role',array[${permissions.map(quote).join(',')}]);
   ${plan.members.map((m,i)=>`insert into public.merchant_enterprise_employees(id,merchant_id,auth_user_id,email,display_name,role_id,status,accepted_at,version) values(${quote(m.employeeId)},${site},${quote(m.authId)},'synthetic234-${i}@example.test','Synthetic234 supervisor ${i}',${quote(plan.role)},'active',clock_timestamp(),1);`).join('\n')}
   ${oldGuard}end;$dr_seed$;select ${proofSql};`));state.seeded=true;check(JSON.parse(output));assert(++steps<=100);await seed.step('commit;');}finally{await seed.close();}current();
  await one(grant(0));const preview=await one(request('delegate',a.authId,query(plan.grants[0],p,'preview')));
  assert.deepEqual(preview.preview.blockers,[]);assert.deepEqual(preview.preview.artifact.report.base.rows,[]);assert.deepEqual(preview.preview.artifact.report.missing,[]);
  const fp=preview.preview.artifact.sourceFingerprint;await one(request('delegate',a.authId,query(plan.grants[0]),command('send',p.send,null,fp)));
  let head=(await one(request('owner',d.owner,oldQuery()))).period;
  await race('revoke_before_respond',revoke(0),request('delegate',a.authId,query(plan.grants[0]),command('respond',plan.rejectedRespond,head)),'attendance_access_denied');
  await one(grant(1));await race('respond_before_revoke',request('delegate',a.authId,query(plan.grants[1]),command('respond',p.respond,head)),revoke(1));
  head=(await one(request('owner',d.owner,oldQuery()))).period;head=(await one(request('self',h.employeeAuthUserId,oldQuery('self'),command('confirm',p.confirm,head,fp)))).period;
  await one(grant(2));await race('seal_before_pause',request('delegate',a.authId,query(plan.grants[2]),command('seal',p.seal,head,fp)),pause(a));
  await one(grant(3,b,plan.failed));const second=await one(request('delegate',b.authId,query(plan.grants[3],plan.failed,'preview')));
  assert.deepEqual(second.preview.blockers,[]);assert.deepEqual(second.preview.artifact.report.base.rows,[]);assert.deepEqual(second.preview.artifact.report.missing,[]);
  await race('pause_before_prepared_send',pause(b),request('delegate',b.authId,query(plan.grants[3],plan.failed),command('send',plan.failed.send,null,second.preview.artifact.sourceFingerprint,plan.failed)),'attendance_access_denied');
  for(const [operationId,index]of [[p.send,0],[p.respond,1],[p.seal,2]]){const recovered=await one(request('delegate',a.authId,query(plan.grants[index],p,'recover',{operationId})));
   assert.equal(recovered.kind,'receipt');assert.equal(recovered.receipt.operationId,operationId);assert.deepEqual(recovered.receipt,receipts.get(operationId));assert.deepEqual(recovered.usableActions,[]);}
  const final=current();assert.equal(state.accepted.size,12);assert.equal(final.rows[table('period_entries')].length,4);completed=true;
  return {phase:234,groups,transactionSteps:steps,rpcCalls,newRoles:1,newMembers:2,newGrants:4,newRevocations:2,newPeriods:1,newEntries:4,newVersions:1,newArtifacts:1,newSidecars:3,
   realPauseWrites:2,failedOperationsZeroRows:true,actualQuotaIncrement:final.usedBytes-state.baseline,oldFactsUnchanged:true,oldArchivesPreserved:true,
   actualServiceSql:true,realNodeProjection:true,syntheticAuth:true,realAuth:false,committedSyntheticRows:true,ownedSchemaCleanupRequired:true,productionAccess:false,browser:false};
 }catch(error){failures.push(new Error('delegated_closure_races:'+stage+':'+String(error?.stack??error),{cause:error}));}
 finally{
  for(const s of [...sessions]){s.cancel();try{await s.close();await s.outcome;}catch(error){failures.push(error);}}
  for(const[label,read,want]of [['old facts',()=>execRead('select '+protectedSql+';'),protectedBefore],['definitions',()=>d.definitions(),definitions],['catalog',()=>d.tableCatalog(),catalog],
   ['old155',()=>periodContinuationArchiveBytes(archive()),old155],['old207',()=>periodContinuationArchiveBytes(periodArchive()),old207]]){
   try{assert.deepEqual(await read(),want,'delegated_races_preserve_'+label);}catch(error){failures.push(error);}}
  try{const saved=await period(pq('detail','owner',periodId));assert.equal(saved.period.sealed,true);assert.equal(saved.sourceChanged,false);}catch(error){failures.push(error);}
  if(failures.length)throw new AggregateError(failures,'delegated_closure_races_failed:'+failures.slice(0,5).map(x=>String(x.stack)).join('\n').slice(0,10000)+'\nlastRpcError:'+JSON.stringify(lastRpc?.error?without(lastRpc,['args','proof','value']):null));
  assert(completed);assert.equal(sessions.size,0);
 }
}
