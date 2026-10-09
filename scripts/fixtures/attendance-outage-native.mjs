//211 caller-owned foundation probes. All new records and temporary identity /
//permission scenarios use one rollback-only transaction under enabled guards.
//Statements are declarations, never reconstructed clock events or resolutions.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {assertLifecycleSandbox,lifecycleId as id,lifecycleJson as json} from '../merchant-attendance-lifecycle-native-support.mjs';
import {quote} from './attendance-bound-clocks-native.mjs';
const require=createRequire(import.meta.url);
export const outageNativeTables=Object.freeze(['merchant_attendance_outage_incidents','merchant_attendance_outage_declarations','merchant_attendance_outage_operations']);
const fid=n=>id(211000000+n),utc6=ms=>new Date(ms).toISOString().replace(/\.([0-9]{3})Z$/,'.$1000Z');
export function outageNativeFingerprintSql(names){
 assert(Array.isArray(names)&&names.length>0&&new Set(names).size===names.length);
 return '(select md5(jsonb_object_agg(outage_fact_name,outage_fact_rows order by outage_fact_name)::text) from ('+names.map(name=>{
  assert(/^(?:merchants|faolla_schema_migrations|merchant_[a-z0-9_]+)$/.test(name)&&name.length<=63);
  return `select ${quote(name)} outage_fact_name,(select coalesce(jsonb_agg(to_jsonb(outage_row) order by to_jsonb(outage_row)::text),'[]') from public.${name} outage_row) outage_fact_rows`;
 }).join(' union all ')+') outage_all_facts)';
}
export function outageNativeExpression(query,actor,command=null,allow=false){
 assert.equal(typeof allow,'boolean');return 'public.faolla_attendance_outage_v1('+json(query)+','+quote(actor)+','+json(command)+','+allow+')';
}
export function createOutageNativePlan({site,owner,employee,auth,worker,location,workerVersion,employeeVersion,generation,startAt,endAt,now}){
 for(const value of [workerVersion,employeeVersion])assert(Number.isSafeInteger(value)&&value>=1);
 assert(Number.isSafeInteger(generation)&&generation>=0);
 const a=Date.parse(startAt),b=Date.parse(endAt),clock=Date.parse(now);assert(a<b&&b<clock);
 const interval={startAt:utc6(a),endAt:utc6(b),timeZone:'UTC',startOffsetMinutes:0,endOffsetMinutes:0};
 const incident={action:'create_incident',operationId:fid(1),incidentId:fid(2),type:'network',channel:'web',locationId:location,
  interval:{...interval,startAt:utc6(a-1800000),endAt:utc6(b+1800000)},reason:'Synthetic211 reported disruption, not a trusted clock event'};
 assert(Date.parse(incident.interval.endAt)<clock);
 const declaration={action:'declare',operationId:fid(3),declarationId:fid(4),incidentId:incident.incidentId,workerId:worker,employeeId:employee,employeeAuthUserId:auth,
  expectedWorkerVersion:workerVersion,expectedEmployeeVersion:employeeVersion,expectedGeneration:generation,interval,
  statement:'Synthetic211 owner transcribes a paper statement; unresolved',originalOperationId:fid(900),originalChannel:'web',paperReference:'PAPER-211-A'};
 const self={...declaration,operationId:fid(5),declarationId:fid(6),statement:'Synthetic211 employee statement, not approval',originalOperationId:null,originalChannel:null,paperReference:null};
 const partial={...declaration,operationId:fid(7),declarationId:fid(8),interval:{...interval,startAt:utc6(a-2700000),endAt:utc6(a-900000)},statement:'Synthetic211 partial overlap declaration'};
 const dst={...incident,operationId:fid(9),incidentId:fid(10),locationId:null,channel:'other',interval:{startAt:'2025-10-26T00:15:00.000000Z',endAt:'2025-10-26T01:45:00.000000Z',timeZone:'Europe/Madrid',startOffsetMinutes:120,endOffsetMinutes:60},reason:'Synthetic211 historical autumn fold declared with both explicit offsets'};
 assert(Date.parse(dst.interval.endAt)<clock);
 //Only the immutable intent is prepared here. The pause scenario reads its
 //actual worker/employee/generation versions after accepted_at touch + status.
 const paused={...declaration,operationId:fid(11),declarationId:fid(12),
  statement:'Synthetic211 owner preserves a statement while attendance remains paused'};
 const query=(access,mode,value=null)=>({siteId:site,access,mode,...(mode==='incidents'?{afterId:value}:mode==='declarations'?{incidentId:incident.incidentId,afterId:value}:mode==='incident'?{incidentId:value??incident.incidentId}:mode==='declaration'?{declarationId:value??declaration.declarationId}:{operationId:value})});
 return {site,owner,employee,auth,worker,location,interval,incident,declaration,self,partial,dst,paused,query,
  future:{...incident,operationId:fid(13),incidentId:fid(14),interval:{...interval,startAt:utc6(clock+3600000),endAt:utc6(clock+7200000)}},
  statusOperations:[fid(20),fid(21)],freshId:fid(30),wrongAuth:fid(901)};
}

export async function verifyAttendanceOutageNative(ctx){
 const {d,h,native,scope,periodId,period,pq,periodArchive,archive,oldArchive}=ctx;
 assert(d?.syntheticOnly===true&&h?.syntheticOnly===true);assert.equal(typeof native.querySteps,'function');
 const owned=assertLifecycleSandbox(sql=>native.query(scope.sql(sql)));assert.deepEqual(owned,d.owned);assert.equal(owned.schema,scope.schema);
 const names=d.inventory();for(const table of outageNativeTables)assert(names.includes(table));
 const baseline=d.fingerprint(),defs=d.definitions(),catalog=d.tableCatalog();
 const sealed=await period(pq('detail','owner',periodId));assert(sealed.period.sealed,'outage_requires_actual_sealed_period');
 const saved=periodArchive();assert.equal(saved.period.periodId,periodId);
 const profile=JSON.parse(d.exec(`select jsonb_build_object('workerVersion',w.version,'employeeVersion',e.version,'generation',coalesce(ep.generation,0),
  'active',w.active,'status',e.status,'paused',coalesce(ep.paused,false),'now',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
  from public.merchant_attendance_workers w join public.merchant_enterprise_employees e on e.merchant_id=w.merchant_id and e.id=w.employee_id
  left join public.merchant_attendance_account_epochs ep on ep.merchant_id=e.merchant_id and ep.employee_id=e.id
  where w.merchant_id=${quote(d.site)} and w.id=${quote(h.workerId)} and e.id=${quote(h.employeeId)} and e.auth_user_id=${quote(h.employeeAuthUserId)};`));
 assert(profile.active&&profile.status==='active'&&!profile.paused);assert.equal(d.fingerprint(),baseline);
 const p=createOutageNativePlan({site:d.site,owner:d.owner,employee:h.employeeId,auth:h.employeeAuthUserId,worker:h.workerId,location:h.slot.locationId,
  ...profile,startAt:h.slot.startAt,endAt:h.slot.endAt});
 const {projectOutageResult}=require('../../src/lib/merchantAttendanceOutage.server.ts');
 const {parseOutageQuery,parseOutageCommand}=require('../../src/lib/merchantAttendanceOutage.ts');
 const {parseOutageInterval}=require('../../src/lib/merchantAttendanceOutageTime.ts');
 for(const command of [p.incident,p.declaration,p.self,p.partial,p.dst,p.paused]){parseOutageCommand(command);parseOutageInterval(command.interval);}
 const fullHash=outageNativeFingerprintSql(names),oldHash=outageNativeFingerprintSql(names.filter(name=>!outageNativeTables.includes(name)));
 const prefix="reset role;set local time zone 'UTC';set local datestyle='ISO, YMD';"+d.guard;
 const steps=[],expected=new Map();let reads=0,rejections=0,submissions=0;
 const actor=q=>q.access==='owner'?d.owner:h.employeeAuthUserId;
 const versionsSql="current_setting('faolla.outage_native_versions')::jsonb";
 const commandSql=(command,currentVersions)=>currentVersions?'('+json(command)+'||'+versionsSql+')':json(command);
 const expression=(q,auth,c,allow,currentVersions=false)=>currentVersions?
  'public.faolla_attendance_outage_v1('+json(q)+','+quote(auth)+','+commandSql(c,true)+','+allow+')':outageNativeExpression(q,auth,c,allow);
 const record=(kind,label,hash)=>`select jsonb_build_object('kind',${quote(kind)},'label',${quote(label)},'hash',${hash});`;
 const call=(label,q,c=null,{auth=actor(q),allow=c!==null,readOnly=c===null,currentVersions=false}={})=>{
  parseOutageQuery(q);if(c)parseOutageCommand(c);assert(!expected.has(label));expected.set(label,{q,c,auth,readOnly,currentVersions});
  if(c&&!readOnly)submissions++;else reads++;
  const fingerprint=readOnly?fullHash:oldHash;
  return prefix+record('before',label,fingerprint)+`set local role service_role;select jsonb_build_object('kind','result','label',${quote(label)},'value',${expression(q,auth,c,allow,currentVersions)}${currentVersions?",'command',"+commandSql(c,true):''});
   set constraints all immediate;set constraints all deferred;reset role;`+record('after',label,fingerprint);
 };
 const reject=(label,q,c,code,{auth=actor(q),allow=true,setup='',currentVersions=false}={})=>{
  rejections++;return prefix+`do $outage_denied$ declare outage_before text;outage_error text;begin outage_before:=${fullHash};
   begin ${setup} set local role service_role;perform ${expression(q,auth,c,allow,currentVersions)};raise exception 'outage_expected_rejection_missing';
   exception when others then outage_error:=sqlerrm;if outage_error<>${quote(code)} then raise;end if;end;
   reset role;assert ${fullHash}=outage_before,'outage_failed_operation_wrote';end;$outage_denied$;
   select jsonb_build_object('kind','rejection','label',${quote(label)},'code',${quote(code)});`;
 };
 const iq=p.query('owner','incident'),dq=c=>p.query('owner','declaration',c.declarationId),sq=c=>p.query('self','declaration',c.declarationId);
 const unchanged=label=>prefix+record('scope',label,fullHash);
 const assertSealed=`do $outage_seal$ begin assert exists(select 1 from public.merchant_attendance_period_closures where merchant_id=${quote(d.site)} and period_id=${quote(periodId)} and sealed),'outage_actual_seal_missing';end;$outage_seal$;`;
 steps.push('begin;'+prefix+assertSealed+`do $outage_start$ begin
  assert not exists(select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid where c.relnamespace=${owned.oid} and t.tgenabled<>'O'),'outage_all_triggers_enabled';
  assert not exists(select 1 from public.merchant_attendance_outage_operations where merchant_id=${quote(d.site)}),'outage_fixture_requires_empty_ledger';end;$outage_start$;`+record('scope','transaction_before',fullHash));
 steps.push(call('empty_incidents',p.query('owner','incidents')));
 steps.push(reject('fresh_gate_off',iq,p.incident,'attendance_outage_disabled',{allow:false}));
 steps.push(reject('employee_cannot_register_incident',iq,p.incident,'attendance_access_denied',{auth:p.auth}));
 steps.push(call('incident',iq,p.incident));
 steps.push(call('incident_replay_gate_off',iq,p.incident,{allow:false,readOnly:true}));
 steps.push(call('incident_recover',p.query('owner','recover',p.incident.operationId)));
 steps.push(reject('same_id_different_body',iq,{...p.incident,reason:'Not the original operation'},'attendance_operation_conflict'));
 steps.push(reject('unknown_original_receipt',p.query('owner','recover',p.freshId),null,'attendance_outage_not_found',{allow:false}));
 steps.push(reject('self_cannot_read_unrelated_incident',p.query('self','incident'),null,'attendance_outage_not_found'));
 steps.push(call('owner_declaration',dq(p.declaration),p.declaration));
 steps.push(call('owner_detail',dq(p.declaration)));
 steps.push(call('self_declaration',sq(p.self),p.self));
 steps.push(call('self_detail',sq(p.self)));
 steps.push(call('partial_overlap_declaration',dq(p.partial),p.partial));
 steps.push(call('self_incident',p.query('self','incident')));
 steps.push(call('self_declarations',p.query('self','declarations')));
 steps.push(call('owner_declarations',p.query('owner','declarations')));
 steps.push(call('self_replay_gate_off',sq(p.self),p.self,{allow:false,readOnly:true}));
 steps.push(call('self_recover_gate_off',p.query('self','recover',p.self.operationId)));
 steps.push(reject('other_actor_cannot_recover',p.query('owner','recover',p.self.operationId),null,'attendance_access_denied'));
 steps.push(reject('declare_fingerprint_conflict',sq(p.self),{...p.self,statement:'Changed after saved'},'attendance_operation_conflict'));
 const fresh={...p.self,operationId:fid(31),declarationId:fid(32)},fq=sq(fresh);
 steps.push(reject('stale_worker_version',fq,{...fresh,expectedWorkerVersion:profile.workerVersion+1},'attendance_outage_changed'));
 steps.push(reject('wrong_target_identity',fq,{...fresh,employeeAuthUserId:p.wrongAuth},'attendance_access_denied'));
 steps.push(reject('cross_merchant', {...p.query('owner','incident'),siteId:'99990002'},null,'attendance_access_denied'));
 const removePermission=`update public.merchant_enterprise_roles set permissions=array_remove(permissions,'attendance.self.request') where merchant_id=${quote(d.site)} and id=(select role_id from public.merchant_enterprise_employees where merchant_id=${quote(d.site)} and id=${quote(p.employee)});`;
 steps.push(reject('revoked_permission_detail',sq(p.self),null,'attendance_access_denied',{setup:removePermission}));
 steps.push(reject('revoked_permission_recover',p.query('self','recover',p.self.operationId),null,'attendance_access_denied',{setup:removePermission}));
 const rebind=`update public.merchant_enterprise_employees set auth_user_id=${quote(p.wrongAuth)} where merchant_id=${quote(d.site)} and id=${quote(p.employee)};`;
 steps.push(reject('old_auth_after_rebinding',sq(p.self),null,'attendance_access_denied',{setup:rebind}));
 steps.push(reject('new_auth_cannot_read_old_declaration',sq(p.self),null,'attendance_outage_not_found',{setup:rebind,auth:p.wrongAuth}));
 steps.push(reject('platform_pause_new_declaration',fq,fresh,'attendance_platform_paused',{setup:`update public.merchant_attendance_settings set enabled=false where merchant_id=${quote(d.site)};`}));
 steps.push(reject('future_time',p.query('owner','incident',p.future.incidentId),p.future,'attendance_invalid_request'));
 const badOffset={...p.incident,operationId:fid(33),incidentId:fid(34),interval:{...p.incident.interval,startOffsetMinutes:60}};
 steps.push(reject('utc_offset_mismatch',p.query('owner','incident',badOffset.incidentId),badOffset,'attendance_invalid_request'));
 steps.push(call('dst_fold_incident',p.query('owner','incident',p.dst.incidentId),p.dst));
 steps.push(call('dst_fold_detail',p.query('owner','incident',p.dst.incidentId)));
 const badDst={...p.dst,operationId:fid(35),incidentId:fid(36),interval:{...p.dst.interval,endOffsetMinutes:120}};
 steps.push(reject('dst_fold_wrong_occurrence_offset',p.query('owner','incident',badDst.incidentId),badDst,'attendance_invalid_request'));
 const adjacent={...fresh,interval:{...p.incident.interval,startAt:p.incident.interval.endAt,endAt:utc6(Date.parse(p.incident.interval.endAt)+60000)}};
 steps.push(reject('half_open_touch_is_not_overlap',fq,adjacent,'attendance_invalid_request'));
 steps.push(unchanged('before_actual_pause')+'savepoint outage_pause;');
 //011 (renamed unchecked017) rejects reactivation without accepted_at. This
 //attendance-only subject never exercised invitation acceptance. Seed only
 //this disclosed synthetic prerequisite INSIDE the rollback savepoint; keep
 //all touch/version/audit triggers, then use their actual resulting versions.
 steps.push(prefix+`with outage_accepted as (
  update public.merchant_enterprise_employees set accepted_at=clock_timestamp()
   where merchant_id=${quote(d.site)} and id=${quote(p.employee)} and auth_user_id=${quote(p.auth)} and accepted_at is null
   returning version)
  select jsonb_build_object('kind','synthetic_acceptance_prerequisite','rows',count(*),'version',max(version)) from outage_accepted;`);
 for(const [index,status]of ['disabled','active'].entries()){
  const input={merchant_id:d.site,employee_id:p.employee,actor_type:'owner',actor_id:d.owner,status,
   ...(status==='disabled'?{offboarding_mode:'unassign'}:{}),attendance_operation_id:p.statusOperations[index],attendance_suspension_enabled:true};
  steps.push(prefix+`do $outage_status$ declare outage_employee_version bigint;outage_status_input jsonb;outage_status_result jsonb;begin
   select version into strict outage_employee_version from public.merchant_enterprise_employees
    where merchant_id=${quote(d.site)} and id=${quote(p.employee)} and auth_user_id=${quote(p.auth)} and accepted_at is not null;
   outage_status_input:=${json(input)}||jsonb_build_object('expected_version',outage_employee_version);
   set local role service_role;outage_status_result:=public.faolla_update_merchant_enterprise_employee_v1(outage_status_input);
   set constraints all immediate;set constraints all deferred;reset role;
   perform set_config('faolla.outage_native_status',jsonb_build_object('expectedVersion',outage_employee_version,'value',outage_status_result)::text,true);
  end;$outage_status$;select jsonb_build_object('kind','actual_status','status',${quote(status)},'result',current_setting('faolla.outage_native_status')::jsonb);`);
 }
 steps.push(prefix+`do $outage_paused$ begin assert exists(select 1 from public.merchant_attendance_account_epochs where merchant_id=${quote(d.site)} and employee_id=${quote(p.employee)} and paused and generation=${profile.generation+1}),'outage_actual_pause_required';
  assert exists(select 1 from public.merchant_attendance_workers where merchant_id=${quote(d.site)} and id=${quote(p.worker)} and not active and version=${profile.workerVersion+1}),'outage_paused_worker_required';
  perform set_config('faolla.outage_native_versions',(select jsonb_build_object('expectedWorkerVersion',w.version,'expectedEmployeeVersion',e.version,'expectedGeneration',ep.generation)::text
   from public.merchant_attendance_workers w join public.merchant_enterprise_employees e on e.merchant_id=w.merchant_id and e.id=w.employee_id
   join public.merchant_attendance_account_epochs ep on ep.merchant_id=e.merchant_id and ep.employee_id=e.id
   where w.merchant_id=${quote(d.site)} and w.id=${quote(p.worker)} and e.id=${quote(p.employee)} and e.auth_user_id=${quote(p.auth)} and e.status='active' and ep.paused),true);
 end;$outage_paused$;`);
 steps.push(call('paused_owner_declaration',dq(p.paused),p.paused,{currentVersions:true}));
 steps.push(call('paused_owner_detail',dq(p.paused)));
 const pausedSelf={...p.paused,operationId:fid(37),declarationId:fid(38),statement:'Synthetic211 self must not reactivate attendance'};
 steps.push(reject('paused_self_fresh_denied',sq(pausedSelf),pausedSelf,'attendance_account_suspended',{currentVersions:true}));
 steps.push(prefix+'rollback to savepoint outage_pause;release savepoint outage_pause;'+record('scope','after_actual_pause',fullHash));
 steps.push(prefix+assertSealed+`set constraints all immediate;select jsonb_build_object('kind','counts','incidents',(select count(*) from public.merchant_attendance_outage_incidents where merchant_id=${quote(d.site)}),
  'declarations',(select count(*) from public.merchant_attendance_outage_declarations where merchant_id=${quote(d.site)}),'operations',(select count(*) from public.merchant_attendance_outage_operations where merchant_id=${quote(d.site)}));rollback;`);
 assert(steps.length<=75,'outage_bounded_steps');let rows;const failures=[];
 try{rows=(await native.querySteps(steps.map(step=>scope.sql(step)))).trim().split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line));}
 catch(error){failures.push(new Error('outage_actual_sql_failed:'+String(error?.message??error),{cause:error}));}
 finally{
  for(const [label,readBaseline,wanted]of [['outage_rollback_facts',()=>d.fingerprint(),baseline],['outage_definitions',()=>d.definitions(),defs],['outage_catalog',()=>d.tableCatalog(),catalog],
   ['outage_old155_text',()=>archive().artifactText,oldArchive.artifactText],['outage_old155_sha',()=>archive().artifactSha256,oldArchive.artifactSha256],
   ['outage_current_sealed_text',()=>periodArchive().artifactText,saved.artifactText],['outage_current_sealed_sha',()=>periodArchive().artifactSha256,saved.artifactSha256]]){
   try{assert.equal(readBaseline(),wanted,label);}catch(error){failures.push(error);}
  }
 }
 if(failures.length)throw new AggregateError(failures,'outage_native_failed: '+failures.map(error=>error.message).join(' | '));
 const parsed=new Map(),actualCommands=new Map();
 for(let at=0;at<rows.length;at++)if(rows[at].kind==='result'){
  const row=rows[at],metadata=expected.get(row.label);assert(metadata);
  assert.equal(rows[at-1].kind,'before');assert.equal(rows[at+1].kind,'after');
  assert.equal(rows[at-1].label,row.label);assert.equal(rows[at+1].label,row.label);
  assert.equal(rows[at-1].hash,rows[at+1].hash,'outage_read_or_old_facts_changed:'+row.label);
  let command=metadata.c;
  if(metadata.currentVersions){
   command=parseOutageCommand(row.command);
   assert.deepEqual({...command,expectedWorkerVersion:metadata.c.expectedWorkerVersion,expectedEmployeeVersion:metadata.c.expectedEmployeeVersion,expectedGeneration:metadata.c.expectedGeneration},metadata.c,'outage_dynamic_versions_changed_intent');
  }
  actualCommands.set(row.label,command);
  parsed.set(row.label,projectOutageResult(row.value,metadata.q,metadata.auth,command));
 }
 assert.equal(parsed.size,expected.size);
 for(const [first,replay,recovery]of [['incident','incident_replay_gate_off','incident_recover'],['self_declaration','self_replay_gate_off','self_recover_gate_off']]){
  assert.deepEqual(parsed.get(replay).receipt,parsed.get(first).receipt);assert.deepEqual(parsed.get(recovery).receipt,parsed.get(first).receipt);
 }
 const ownerDetail=parsed.get('owner_detail').detail,selfDetail=parsed.get('self_detail').detail,pausedDetail=parsed.get('paused_owner_detail').detail;
 assert.equal(ownerDetail.recordedBy,'owner');assert.equal(ownerDetail.actorId,d.owner);assert.equal(ownerDetail.actorEmployeeId,null);
 assert.equal(selfDetail.recordedBy,'self');assert.equal(selfDetail.actorId,p.auth);assert.equal(selfDetail.actorEmployeeId,p.employee);
 assert.equal(ownerDetail.originalOperationId,p.declaration.originalOperationId);assert.equal(ownerDetail.paperReference,'PAPER-211-A');
 assert.equal(pausedDetail.generation,profile.generation+1);assert.equal(pausedDetail.recordedBy,'owner');
 const pausedCommand=actualCommands.get('paused_owner_declaration');assert.equal(pausedDetail.workerVersion,pausedCommand.expectedWorkerVersion);
 assert.equal(pausedDetail.employeeVersion,pausedCommand.expectedEmployeeVersion);assert.equal(pausedDetail.generation,pausedCommand.expectedGeneration);
 const acceptance=rows.find(row=>row.kind==='synthetic_acceptance_prerequisite');assert(acceptance&&[0,1].includes(acceptance.rows));
 const statuses=rows.filter(row=>row.kind==='actual_status');assert.deepEqual(statuses.map(row=>row.status),['disabled','active']);
 if(acceptance.rows===1){assert(acceptance.version>profile.employeeVersion,'outage_acceptance_touch_must_increment_version');assert.equal(statuses[0].result.expectedVersion,acceptance.version);}
 assert.equal(pausedCommand.expectedEmployeeVersion,statuses[1].result.expectedVersion+1);
 assert.deepEqual(parsed.get('dst_fold_detail').detail.interval,p.dst.interval);
 for(const label of ['owner_declarations','self_declarations'])assert.deepEqual(parsed.get(label).items.map(item=>item.id),[p.declaration.declarationId,p.self.declarationId,p.partial.declarationId].sort());
 const beforePause=rows.find(row=>row.kind==='scope'&&row.label==='before_actual_pause'),afterPause=rows.find(row=>row.kind==='scope'&&row.label==='after_actual_pause');assert.equal(beforePause.hash,afterPause.hash);
 assert.deepEqual(rows.find(row=>row.kind==='counts'),{kind:'counts',incidents:2,declarations:3,operations:5});
 assert.equal(rows.filter(row=>row.kind==='rejection').length,rejections);
 native.pass('211 real outage registration, owner/self statements, minimal exact recovery and denied identity/time writes; actual sealed archives preserved');
 return {successfulSubmissions:submissions,successfulReadOrReplayChecks:reads,rejections,transactionSteps:steps.length,committedOutageRows:0,
  rolledBackIncidentRows:2,rolledBackDeclarationRows:3,rolledBackOperationRows:5,temporaryPausedOwnerDeclaration:1,actualAccountStatusOperations:2,
  syntheticInvitationAcceptanceRows:acceptance.rows,actualInvitationAcceptance:false,
  exactReplayAndRecovery:true,allReadsAndRejectionsZeroWrites:true,oldFactsAndArchivesUnchanged:true,actualSealedDeclarationAllowed:true,
  ownerPausedStatementDoesNotRestore:true,explicitDstOffsets:true,strictSqlToNodeProjection:true,rollbackRestored:true,definitionsAndCatalogUnchanged:true,
  sourceResolutionImplemented:false,periodOutageGateImplemented:false,browser:false,productionAccess:false,newCluster:false};
}
