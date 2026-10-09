//219 inert caller-owned authorization probes, all on one rollback connection.
//Real176/177/178 create receipts; real164 supplies disabled -> active/paused.
//Role/Auth/worker/settings changes and a missing invitation acceptance fact are
//explicit synthetic savepoint prerequisites, not tested management APIs.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {assertLifecycleSandbox,lifecycleId as id,lifecycleJson as json} from '../merchant-attendance-lifecycle-native-support.mjs';
import {quote} from './attendance-bound-clocks-native.mjs';
import {outageNativeFingerprintSql,outageNativeTables} from './attendance-outage-native.mjs';
import {outageLinksNativeTables} from './attendance-outage-links-native.mjs';
import {outageReviewsNativeTables} from './attendance-outage-reviews-native.mjs';
const require=createRequire(import.meta.url),fresh=n=>id(219300000+n),stamp=ms=>new Date(ms).toISOString().replace(/Z$/,'000Z');

export function createOutageAuthorizationNativePlan(input){
 const events=input.session.item.events,last=events.at(-1),effect=input.session.item.effect;
 assert(events.length>=2&&events[0].action==='clock_in'&&last.action==='clock_out');
 const interval={startAt:stamp(Date.parse(events[0].occurredAt)),endAt:stamp(Date.parse(last.occurredAt)),timeZone:'UTC',startOffsetMinutes:0,endOffsetMinutes:0};
 assert(Date.parse(interval.startAt)<Date.parse(interval.endAt)&&Date.parse(interval.endAt)<Date.parse(input.now));
 assert(Date.parse(interval.endAt)-Date.parse(interval.startAt)<=31*86400000);
 assert(!(interval.startAt<input.sealedEnd&&interval.endAt>input.sealedStart),'authorization_source_must_not_overlap_sealed_fixture');
 for(const key of ['workerVersion','employeeVersion'])assert(Number.isSafeInteger(input[key])&&input[key]>0);
 assert(Number.isSafeInteger(input.generation)&&input.generation>=0);
 const incident={action:'create_incident',operationId:fresh(1),incidentId:fresh(2),type:'network',channel:'web',locationId:input.location,interval,
  reason:'Synthetic219 authorization incident, not a reconstructed clock event'};
 const declaration={action:'declare',operationId:fresh(3),declarationId:fresh(4),incidentId:incident.incidentId,workerId:input.worker,
  employeeId:input.employee,employeeAuthUserId:input.auth,expectedWorkerVersion:input.workerVersion,expectedEmployeeVersion:input.employeeVersion,
  expectedGeneration:input.generation,interval,statement:'Synthetic219 actual self declaration for receipt authorization',originalOperationId:null,originalChannel:null,paperReference:null};
 const reference={kind:'session',startEventId:events[0].id,lastEventId:last.id,lastSequence:last.sequence,
  effectOperationId:effect?.operationId??null,effectRevision:effect?.revision??null};
 return {incident,declaration,reference,wrongAuth:fresh(999)};
}

//Exclude only the prospective row keys of ONE real command. All older rows in
//these same ledgers, including caller-owned218 commits, remain protected.
export function outageAuthorizationProtectedFingerprintSql(names,kind){
 const keys=kind==='outages'?{merchant_attendance_outage_operations:'operation_id:operationId',merchant_attendance_outage_incidents:'incident_id:incidentId',
  merchant_attendance_outage_declarations:'declaration_id:declarationId'}:kind==='links'?{merchant_attendance_outage_link_operations:'operation_id:operationId'}:
  kind==='reviews'?{merchant_attendance_outage_review_operations:'operation_id:operationId'}:null;
 assert(keys&&Array.isArray(names)&&names.length>0&&new Set(names).size===names.length);
 return '(select md5(jsonb_object_agg(authorization_name,authorization_rows order by authorization_name)::text) from ('+names.map(name=>{
  assert(/^(?:merchants|faolla_schema_migrations|merchant_[a-z0-9_]+)$/.test(name)&&name.length<=63);
  const [column,field]=(keys[name]??'').split(':');
  //For create_incident only the incident key is new; declare references an
  //existing incident whose complete row must still be included in the hash.
  const where=!column?'':name==='merchant_attendance_outage_incidents'
   ?" where authorization_command->>'action' is distinct from 'create_incident' or authorization_row.incident_id::text is distinct from authorization_command->>'incidentId'"
   :` where authorization_row.${column}::text is distinct from authorization_command->>'${field}'`;
  return `select ${quote(name)} authorization_name,(select coalesce(jsonb_agg(to_jsonb(authorization_row) order by to_jsonb(authorization_row)::text),'[]') from public.${name} authorization_row${where}) authorization_rows`;
 }).join(' union all ')+') authorization_facts)';
}

export async function verifyAttendanceOutageAuthorizationNative(ctx){
 const {d,h,native,scope,period,pq,periodId,archive,oldArchive,periodArchive}=ctx;
 assert(d?.syntheticOnly===true&&h?.syntheticOnly===true);assert.equal(typeof native.querySteps,'function');
 const owned=assertLifecycleSandbox(sql=>native.query(scope.sql(sql)));assert.deepEqual(owned,d.owned);assert.equal(owned.schema,scope.schema);
 assert((await period(pq('detail','owner',periodId))).period.sealed);
 const baseline=d.fingerprint(),definitions=d.definitions(),catalog=d.tableCatalog(),names=d.inventory(),sealed=periodArchive();
 for(const table of [...outageNativeTables,...outageLinksNativeTables,...outageReviewsNativeTables])assert(names.includes(table));
 const fullHash=outageNativeFingerprintSql(names),protectedHash=kind=>outageAuthorizationProtectedFingerprintSql(names,kind);
 const site=quote(d.site),worker=quote(h.workerId),employee=quote(h.employeeId),auth=quote(h.employeeAuthUserId);
 const profile=JSON.parse(d.exec(`select jsonb_build_object('workerVersion',w.version,'employeeVersion',e.version,'generation',coalesce(ep.generation,0),
  'now',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'session',public.faolla_attendance_period_session_v1(${site},w.id,${quote(id(204710))},e.id,e.auth_user_id,clock_timestamp()))
  from public.merchant_attendance_workers w join public.merchant_enterprise_employees e on e.merchant_id=w.merchant_id and e.id=w.employee_id
  left join public.merchant_attendance_account_epochs ep on ep.merchant_id=e.merchant_id and ep.employee_id=e.id
  where w.merchant_id=${site} and w.id=${worker} and e.id=${employee} and e.auth_user_id=${auth} and w.active and e.status='active' and not coalesce(ep.paused,false);`));
 assert(profile?.session);assert.equal(d.fingerprint(),baseline,'authorization_preparation_zero_writes');
 const p=createOutageAuthorizationNativePlan({site:d.site,worker:h.workerId,employee:h.employeeId,auth:h.employeeAuthUserId,location:h.slot.locationId,
  sealedStart:h.slot.startAt,sealedEnd:h.slot.endAt,...profile});
 const prefix="reset role;set local time zone 'UTC';set local datestyle='ISO, YMD';"+d.guard;
 const steps=[],metadata=new Map(),scenarios=[];let reads=0,writes=0,rejections=0;
 const saved=label=>`(current_setting('faolla.outage219_${label}')::jsonb->'value')`;
 const savedCommand=label=>`(current_setting('faolla.outage219_${label}')::jsonb->'command')`;
 const query=(mode='detail',access='owner',operationId=null)=>({siteId:d.site,access,mode,declarationId:p.declaration.declarationId,
  ...(mode==='history'?{beforeRevision:null}:mode==='recover'?{operationId}:{})});
 const oq=(mode='declaration',access='self',operationId=p.declaration.operationId)=>({siteId:d.site,access,mode,
  ...(mode==='recover'?{operationId}:mode==='incident'?{incidentId:p.incident.incidentId}:{declarationId:p.declaration.declarationId})});
 const command=(n,action,basis='head')=>`jsonb_build_object('action',${quote(action)},'operationId',${quote(fresh(n))},'expectedRevision',${saved(basis)}->'revision',
  'expectedResultVersion',${saved(basis)}->'resultVersion','expectedFingerprint',${saved(basis)}${action==='propose'?"->'status'->'basisFingerprint'":"->'proposal'->'resultFingerprint'"},'reason',${quote('Synthetic219 explicit '+action)})`;
 const revoke=n=>`jsonb_build_object('action','revoke','operationId',${quote(fresh(n))},'expectedRevision',1,'expectedFingerprint',${saved('link_apply')}->'receipt'->'entry'->'fingerprint','reason','Synthetic219 explicit revoke')`;
 const call=(label,{kind='reviews',q=query(),c='null',actor=d.owner,allow=true,write=false,error=null,receiptOf=null}={})=>{
  assert(/^[a-z_]+$/.test(label)&&!metadata.has(label));metadata.set(label,{kind,error,receiptOf,write});
  if(error)rejections++;else if(write)writes++;else reads++;
  const hash=write&&!error?protectedHash(kind):fullHash;
  const rpc=kind==='outages'?'faolla_attendance_outage_v1':kind==='links'?'faolla_attendance_outage_links_v1':'faolla_attendance_outage_review_v1';
  steps.push(prefix+`do $outage_authorization_call$ declare authorization_before text;authorization_query jsonb;authorization_command jsonb;authorization_value jsonb;authorization_error text;authorization_context text;begin
   authorization_query:=${json(q)};authorization_command:=${c};authorization_before:=${hash};set local role service_role;
   ${error?`begin perform public.${rpc}(authorization_query,${quote(actor)},authorization_command,${allow});raise exception 'authorization_expected_rejection_missing';
    exception when others then authorization_error:=sqlerrm;get stacked diagnostics authorization_context=pg_exception_context;
     if authorization_error<>${quote(error)} then raise exception using errcode=sqlstate,
      message=${quote('authorization_case:'+label+' expected:'+error+' actual:')}||authorization_error,detail=authorization_context;end if;end;`
    :`authorization_value:=public.${rpc}(authorization_query,${quote(actor)},authorization_command,${allow});`}
   set constraints all immediate;set constraints all deferred;reset role;assert authorization_before=${hash},'authorization_read_reject_or_old_facts_changed';
   perform set_config(${quote('faolla.outage219_'+label)},jsonb_build_object('label',${quote(label)},'kind',${quote(kind)},'query',authorization_query,'actor',${quote(actor)},
    'command',authorization_command,'value',authorization_value,'error',authorization_error,'before',authorization_before,'after',${hash})::text,true);
   end;$outage_authorization_call$;select current_setting(${quote('faolla.outage219_'+label)})::jsonb;`);
 };
 const beginScenario=(label,setup)=>{
  assert(/^[a-z_]+$/.test(label)&&!scenarios.includes(label));scenarios.push(label);
  steps.push(prefix+`do $authorization_scenario_before$ begin perform set_config(${quote('faolla.outage219_before_'+label)},${fullHash},true);end;$authorization_scenario_before$;
   savepoint authorization_${label};${setup}`);
 };
 const endScenario=label=>steps.push(prefix+`rollback to savepoint authorization_${label};release savepoint authorization_${label};
  do $authorization_scenario_after$ begin assert ${fullHash}=current_setting(${quote('faolla.outage219_before_'+label)}),'authorization_scenario_full_rollback';end;$authorization_scenario_after$;`);
 const self={actor:h.employeeAuthUserId},selfHistory={...self,q:query('history','self')},selfRecovery={...self,q:query('recover','self',fresh(11)),receiptOf:'confirm'},
  selfReplay={...self,q:query('detail','self'),c:savedCommand('confirm'),receiptOf:'confirm'};
 const outageRecovery={kind:'outages',...self,q:oq('recover'),receiptOf:'declaration'},linkRecovery={kind:'links',q:query('recover','owner',fresh(5)),receiptOf:'link_apply'},
  proposalRecovery={q:query('recover','owner',fresh(10)),receiptOf:'propose'};
 const seal=`assert exists(select 1 from public.merchant_attendance_period_closures where merchant_id=${site} and period_id=${quote(periodId)} and sealed),'authorization_seal_preserved';`;
 steps.push('begin;'+prefix+`do $authorization_start$ begin ${seal}
  assert not exists(select 1 from public.merchant_attendance_outage_operations where operation_id between ${quote(fresh(1))}::uuid and ${quote(fresh(999))}::uuid),'authorization_fresh176_ids_required';
  assert not exists(select 1 from public.merchant_attendance_outage_link_operations where operation_id between ${quote(fresh(1))}::uuid and ${quote(fresh(999))}::uuid),'authorization_fresh177_ids_required';
  assert not exists(select 1 from public.merchant_attendance_outage_review_operations where operation_id between ${quote(fresh(1))}::uuid and ${quote(fresh(999))}::uuid),'authorization_fresh178_ids_required';
  assert not exists(select 1 from public.merchant_attendance_outage_incidents where incident_id=${quote(p.incident.incidentId)}),'authorization_fresh_incident_required';
  assert not exists(select 1 from public.merchant_attendance_outage_declarations where declaration_id=${quote(p.declaration.declarationId)}),'authorization_fresh_declaration_required';
  assert not exists(select 1 from public.merchant_attendance_period_closures where merchant_id=${site} and worker_id=${worker} and sealed
   and start_at<${quote(p.declaration.interval.endAt)}::timestamptz and end_at>${quote(p.declaration.interval.startAt)}::timestamptz),'authorization_source_range_unsealed';
  assert not exists(select 1 from public.merchant_enterprise_employees where auth_user_id=${quote(p.wrongAuth)}),'authorization_unused_auth_required';
  assert not exists(select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid where c.relnamespace=${owned.oid} and t.tgenabled<>'O'),'authorization_guards_enabled';end;$authorization_start$;`);
 call('incident',{kind:'outages',q:oq('incident','owner'),c:json(p.incident),write:true});
 call('declaration',{kind:'outages',q:oq(),...self,c:json(p.declaration),write:true});
 call('link_preview',{kind:'links',q:{...query('preview'),sources:[p.reference]}});
 call('link_apply',{kind:'links',c:`jsonb_build_object('action','apply','operationId',${quote(fresh(5))},'expectedRevision',0,'expectedFingerprint',${saved('link_preview')}->'preview'->'fingerprint',
  'sources',${json([p.reference])},'reason','Synthetic219 owner source association')`,write:true});
 call('initial');call('propose',{c:command(10,'propose','initial'),write:true});call('self_proposal',{q:query('detail','self'),...self});
 call('confirm',{q:query('detail','self'),...self,c:command(11,'confirm','self_proposal'),write:true});call('head');
 call('self_link_history',{kind:'links',...selfHistory});call('self_review_history',selfHistory);
 //177 has no self-write receipt. Its recover mode is structurally owner-only.
 call('self_link_recover_invalid',{kind:'links',...self,q:query('recover','self',fresh(5)),error:'attendance_invalid_request'});
 call('outage_conflict',{kind:'outages',q:oq(),...self,c:`${json(p.declaration)}||jsonb_build_object('statement','Different original body')`,allow:false,error:'attendance_operation_conflict'});
 call('link_conflict',{kind:'links',c:`${savedCommand('link_apply')}||jsonb_build_object('reason','Different original body')`,allow:false,error:'attendance_operation_conflict'});
 call('confirmation_conflict',{...selfReplay,c:`${savedCommand('confirm')}||jsonb_build_object('reason','Different original body')`,allow:false,error:'attendance_operation_conflict',receiptOf:null});

 beginScenario('permission',`update public.merchant_enterprise_roles set permissions=array_remove(permissions,'attendance.self.request') where merchant_id=${site}
  and id=(select role_id from public.merchant_enterprise_employees where merchant_id=${site} and id=${employee});`);
 call('permission_outage_recovery',{...outageRecovery,error:'attendance_access_denied'});
 call('permission_link_history',{kind:'links',...selfHistory,error:'attendance_access_denied'});
 call('permission_review_recovery',{...selfRecovery,error:'attendance_access_denied'});
 call('permission_review_replay',{...selfReplay,error:'attendance_access_denied'});endScenario('permission');
 beginScenario('role_archived',`update public.merchant_enterprise_roles set status='archived' where merchant_id=${site}
  and id=(select role_id from public.merchant_enterprise_employees where merchant_id=${site} and id=${employee});`);
 call('archived_role_link_detail',{kind:'links',q:query('detail','self'),...self,error:'attendance_access_denied'});
 call('archived_role_review_history',{...selfHistory,error:'attendance_access_denied'});endScenario('role_archived');
 beginScenario('auth_rebound',`update public.merchant_enterprise_employees set auth_user_id=${quote(p.wrongAuth)} where merchant_id=${site} and id=${employee};`);
 call('old_auth_link_history',{kind:'links',...selfHistory,error:'attendance_access_denied'});
 call('old_auth_review_recovery',{...selfRecovery,error:'attendance_access_denied'});
 call('new_auth_link_detail',{kind:'links',q:query('detail','self'),actor:p.wrongAuth,error:'attendance_access_denied'});
 call('new_auth_review_recovery',{...selfRecovery,actor:p.wrongAuth,error:'attendance_access_denied'});endScenario('auth_rebound');

 beginScenario('worker_inactive',`update public.merchant_attendance_workers set active=false where merchant_id=${site} and id=${worker};`);
 call('inactive_worker_link_history',{kind:'links',...selfHistory});
 call('inactive_worker_review_detail',{q:query('detail','self'),...self});call('inactive_worker_review_recovery',selfRecovery);
 call('inactive_worker_resolve',{c:command(30,'resolve'),error:'attendance_outage_review_blocked'});
 call('inactive_worker_dispute',{q:query('detail','self'),...self,c:command(31,'dispute'),write:true});endScenario('worker_inactive');
 beginScenario('settings_off',`update public.merchant_attendance_settings set enabled=false where merchant_id=${site};`);
 call('settings_link_recovery',linkRecovery);call('settings_owner_proposal_recovery',proposalRecovery);call('settings_self_confirmation_recovery',selfRecovery);
 call('settings_confirmation_replay',selfReplay);
 call('settings_link_fresh_revoke',{kind:'links',c:revoke(40),error:'attendance_platform_paused'});
 call('settings_fresh_proposal',{c:command(41,'propose'),error:'attendance_platform_paused'});
 call('settings_safety_dispute',{q:query('detail','self'),...self,c:command(42,'dispute'),write:true});endScenario('settings_off');
 call('allow_off_outage_recovery',{...outageRecovery,allow:false});
 call('allow_off_link_replay',{kind:'links',c:savedCommand('link_apply'),receiptOf:'link_apply',allow:false});
 call('allow_off_self_replay',{...selfReplay,allow:false});
 call('allow_off_link_fresh',{kind:'links',c:revoke(50),allow:false,error:'attendance_outage_links_disabled'});
 call('allow_off_safety_fresh',{q:query('detail','self'),...self,c:command(51,'dispute'),allow:false,error:'attendance_outage_review_disabled'});

 beginScenario('actual_pause',`with authorization_accepted as (update public.merchant_enterprise_employees set accepted_at=clock_timestamp()
  where merchant_id=${site} and id=${employee} and auth_user_id=${auth} and accepted_at is null returning version)
  select jsonb_build_object('kind','synthetic_acceptance','rows',count(*),'version',max(version)) from authorization_accepted;`);
 const status=(status,n)=>{
  const input={merchant_id:d.site,employee_id:h.employeeId,actor_type:'owner',actor_id:d.owner,status,
   ...(status==='disabled'?{offboarding_mode:'unassign'}:{}),attendance_operation_id:fresh(n),attendance_suspension_enabled:true};
  steps.push(prefix+`do $authorization_real_status$ declare authorization_version bigint;authorization_value jsonb;begin
   select version into strict authorization_version from public.merchant_enterprise_employees where merchant_id=${site} and id=${employee} and auth_user_id=${auth} and accepted_at is not null;
   set local role service_role;authorization_value:=public.faolla_update_merchant_enterprise_employee_v1(${json(input)}||jsonb_build_object('expected_version',authorization_version));
   set constraints all immediate;set constraints all deferred;reset role;
   assert exists(select 1 from public.merchant_enterprise_employees where merchant_id=${site} and id=${employee} and status=${quote(status)}),'authorization_actual_employee_status';
   assert exists(select 1 from public.merchant_attendance_account_epochs where merchant_id=${site} and employee_id=${employee} and paused and generation=${profile.generation+1}),'authorization_actual_pause_retained';
   perform set_config('faolla.outage219_status',jsonb_build_object('kind','actual_status','status',${quote(status)},'value',authorization_value)::text,true);
   end;$authorization_real_status$;select current_setting('faolla.outage219_status')::jsonb;`);
 };
 status('disabled',60);
 call('disabled_employee_link_history',{kind:'links',...selfHistory,error:'attendance_access_denied'});
 call('disabled_employee_review_recovery',{...selfRecovery,error:'attendance_access_denied'});
 call('disabled_employee_owner_recovery',proposalRecovery);
 status('active',61);
 call('paused_link_history',{kind:'links',...selfHistory});call('paused_self_review_detail',{q:query('detail','self'),...self});
 call('paused_self_confirmation_recovery',selfRecovery);
 call('paused_fresh_resolve',{c:command(62,'resolve'),error:'attendance_outage_review_blocked'});
 call('paused_safety_dispute',{q:query('detail','self'),...self,c:command(63,'dispute'),write:true});endScenario('actual_pause');
 steps.push(prefix+`set constraints all immediate;do $authorization_finish$ begin ${seal}end;$authorization_finish$;
  select jsonb_build_object('kind','counts','outages',(select count(*) from public.merchant_attendance_outage_operations where merchant_id=${site} and operation_id in (${quote(p.incident.operationId)},${quote(p.declaration.operationId)})),
   'links',(select count(*) from public.merchant_attendance_outage_link_operations where merchant_id=${site} and declaration_id=${quote(p.declaration.declarationId)}),
   'reviews',(select count(*) from public.merchant_attendance_outage_review_operations where merchant_id=${site} and declaration_id=${quote(p.declaration.declarationId)}));rollback;`);
 assert(steps.length<=80,'authorization_bounded_steps');let rows;const failures=[];
 try{rows=(await native.querySteps(steps.map(sql=>scope.sql(sql)))).trim().split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line));}
 catch(error){failures.push(new Error('outage_authorization_actual_sql_failed:'+String(error?.message??error),{cause:error}));}
 finally{
  for(const [label,get,want]of [['facts',()=>d.fingerprint(),baseline],['definitions',()=>d.definitions(),definitions],['catalog',()=>d.tableCatalog(),catalog],
   ['old155_text',()=>archive().artifactText,oldArchive.artifactText],['old155_sha',()=>archive().artifactSha256,oldArchive.artifactSha256],
   ['sealed_text',()=>periodArchive().artifactText,sealed.artifactText],['sealed_sha',()=>periodArchive().artifactSha256,sealed.artifactSha256]]){
   try{assert.equal(get(),want,'authorization_rollback_'+label);}catch(error){failures.push(error);}
  }
 }
 if(failures.length)throw new AggregateError(failures,'outage_authorization_native_failed:'+failures.map(e=>e.message).join(' | '));
 const projectors={outages:require('../../src/lib/merchantAttendanceOutage.server.ts').projectOutageResult,
  links:require('../../src/lib/merchantAttendanceOutageLinks.server.ts').projectOutageLinksResult,
  reviews:require('../../src/lib/merchantAttendanceOutageReview.server.ts').projectOutageReviewResult};
 const parsed=new Map();let seen=0;
 for(const row of rows){if(!row.label)continue;seen++;const expected=metadata.get(row.label);assert(expected);assert.equal(row.kind,expected.kind);
  assert.equal(row.before,row.after);assert.equal(row.error,expected.error);if(row.error)continue;
  const result=projectors[row.kind](row.value,row.query,row.actor,row.command);parsed.set(row.label,result);
  if(expected.receiptOf)assert.deepEqual(result.receipt,parsed.get(expected.receiptOf).receipt,'authorization_exact_saved_receipt_'+row.label);
 }
 assert.equal(seen,metadata.size);assert.equal(parsed.get('declaration').receipt.actorId,h.employeeAuthUserId);
 assert.equal(parsed.get('propose').receipt.entry.actorId,d.owner);assert.equal(parsed.get('confirm').receipt.entry.actorId,h.employeeAuthUserId);
 assert.equal(parsed.get('head').status.canResolve,true);assert.deepEqual(parsed.get('self_link_history').history.map(e=>e.action),['apply']);
 assert.deepEqual(parsed.get('self_review_history').history.map(e=>e.action),['confirm','propose']);
 for(const label of ['inactive_worker_review_detail','paused_self_review_detail']){
  const result=parsed.get(label);assert.equal(result.status.canConfirm,false);assert.equal(result.status.canResolve,false);assert.equal(result.status.resolved,false);
  assert(result.status.blockers.includes('employee_unavailable'));assert.equal(result.response.action,'confirm');
 }
 assert(parsed.get('paused_self_review_detail').status.blockers.includes('account_suspended'));
 for(const label of ['inactive_worker_dispute','settings_safety_dispute','paused_safety_dispute'])assert.equal(parsed.get(label).receipt.entry.action,'dispute');
 for(const label of ['inactive_worker_link_history','paused_link_history'])assert.deepEqual(parsed.get(label).history,parsed.get('self_link_history').history);
 assert.deepEqual(rows.filter(r=>r.kind==='actual_status').map(r=>r.status),['disabled','active']);
 const acceptance=rows.find(r=>r.kind==='synthetic_acceptance');assert([0,1].includes(acceptance.rows));
 assert.deepEqual(rows.find(r=>r.kind==='counts'),{kind:'counts',outages:2,links:1,reviews:2});
 native.pass('219176/177/178 current authorization before immutable recovery, real164 pause, flag gates and deliberate safety actions; all savepoints and archives restored');
 return {reads,submissions:writes,rejections,transactionSteps:steps.length,scenarios,realAccountStatusOperations:2,
  syntheticInvitationAcceptanceRows:acceptance.rows,actualInvitationAcceptance:false,syntheticDirectRoleAuthWorkerSettingsChanges:true,
  exactReceiptProjection:true,selfLinksRecoveryUnsupported:true,readsAndRejectionsZeroWrites:true,rollbackRestored:true,
  definitionsAndCatalogUnchanged:true,oldFactsAndArchivesUnchanged:true,syntheticOnly:true,browser:false,productionAccess:false,newCluster:false};
}
