//217 actual SQL in one rollback-only transaction. The later Node/client bridge
//validates captured real SQL results and exact sent commands; it is not a browser
//or a second database execution. Temporary acceptance is disclosed test data.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {assertLifecycleSandbox,lifecycleId as id,lifecycleJson as json} from '../merchant-attendance-lifecycle-native-support.mjs';
import {quote} from './attendance-bound-clocks-native.mjs';
import {outageNativeFingerprintSql,outageNativeTables} from './attendance-outage-native.mjs';
const require=createRequire(import.meta.url),fresh=n=>id(217000000+n);
export function createOutageSubjectNativePlan({site,worker,employee,auth,location,startAt,endAt}){
 const utc6=s=>new Date(s).toISOString().replace(/Z$/,'000Z');
 const interval={startAt:utc6(startAt),endAt:utc6(endAt),timeZone:'UTC',startOffsetMinutes:0,endOffsetMinutes:0};
 assert(Date.parse(interval.startAt)<Date.parse(interval.endAt));
 const incident={action:'create_incident',operationId:fresh(1),incidentId:fresh(2),type:'network',channel:'web',locationId:location,interval,
  reason:'Synthetic217 private owner incident reason, not disclosed by preparation'};
 const declare={action:'declare',operationId:fresh(3),declarationId:fresh(4),incidentId:incident.incidentId,workerId:worker,employeeId:employee,employeeAuthUserId:auth,
  interval,statement:'Synthetic217 first employee declaration uses actual prepared identity and versions',originalOperationId:null,originalChannel:null,paperReference:null};
 const q=access=>({siteId:site,access,workerId:access==='owner'?worker:null,incidentId:incident.incidentId});
 return {incident,declare,q};
}
export async function verifyAttendanceOutageSubjectNative(ctx){
 const {d,h,native,scope,period,pq,periodId,periodArchive,archive,oldArchive}=ctx;
 assert(d?.syntheticOnly===true&&h?.syntheticOnly===true);assert.equal(typeof native.querySteps,'function');
 const owned=assertLifecycleSandbox(sql=>native.query(scope.sql(sql)));assert.deepEqual(owned,d.owned);
 assert((await period(pq('detail','owner',periodId))).period.sealed);
 const names=d.inventory(),baseline=d.fingerprint(),defs=d.definitions(),catalog=d.tableCatalog(),sealed=periodArchive();
 const fullHash=outageNativeFingerprintSql(names),oldHash=outageNativeFingerprintSql(names.filter(n=>!outageNativeTables.includes(n)));
 const p=createOutageSubjectNativePlan({site:d.site,worker:h.workerId,employee:h.employeeId,auth:h.employeeAuthUserId,location:h.slot.locationId,startAt:h.slot.startAt,endAt:h.slot.endAt});
 const prefix="reset role;set local time zone 'UTC';set local datestyle='ISO, YMD';"+d.guard;
 const site=quote(d.site),auth=quote(h.employeeAuthUserId),employee=quote(h.employeeId);
 const saved=label=>`(current_setting('faolla.outage217_${label}')::jsonb->'value')`;
 const commandFrom=(draft,label)=>`${json(draft)}||jsonb_build_object('workerId',${saved(label)}->'subject'->'workerId','employeeId',${saved(label)}->'subject'->'employeeId',
  'employeeAuthUserId',${saved(label)}->'subject'->'employeeAuthUserId','expectedWorkerVersion',${saved(label)}->'subject'->'workerVersion',
  'expectedEmployeeVersion',${saved(label)}->'subject'->'employeeVersion','expectedGeneration',${saved(label)}->'subject'->'generation')`;
 const steps=[],metadata=new Map();let reads=0,writes=0,rejections=0;
 const call=(label,{kind='subject',query=p.q('owner'),actor=d.owner,command='null',allow=true,write=false,error=null,setup=''}={})=>{
  assert(/^[a-z_]+$/.test(label)&&!metadata.has(label));metadata.set(label,{kind,error,write});
  if(error)rejections++;else if(write)writes++;else reads++;
  const facts=write&&!error?oldHash:fullHash;
  const expr=kind==='subject'?`public.faolla_attendance_outage_subject_v1(subject_query,${quote(actor)},${allow})`
   :`public.faolla_attendance_outage_v1(subject_query,${quote(actor)},subject_command,${allow})`;
  steps.push(prefix+`do $subject_call$ declare subject_before text;subject_after text;subject_query jsonb;subject_command jsonb;subject_value jsonb;subject_error text;begin
   subject_before:=${facts};subject_query:=${json(query)};subject_command:=${command};
   ${error?`begin ${setup} set local role service_role;perform ${expr};raise exception 'outage_subject_expected_rejection_missing';
    exception when others then subject_error:=sqlerrm;if subject_error<>${quote(error)} then raise;end if;end;`:`set local role service_role;subject_value:=${expr};`}
   set constraints all immediate;set constraints all deferred;reset role;subject_after:=${facts};
   assert subject_before=subject_after,'outage_subject_read_rejection_or_old_facts_changed';
   perform set_config(${quote('faolla.outage217_'+label)},jsonb_build_object('label',${quote(label)},'kind',${quote(kind)},'query',subject_query,'actor',${quote(actor)},
    'allow',${allow},'command',subject_command,'value',subject_value,'error',subject_error,'before',subject_before,'after',subject_after)::text,true);
   end;$subject_call$;select current_setting(${quote('faolla.outage217_'+label)})::jsonb;`);
 };
 const iq=access=>({siteId:d.site,access,mode:'incident',incidentId:p.incident.incidentId});
 const dq=(access,decl=p.declare.declarationId)=>({siteId:d.site,access,mode:'declaration',declarationId:decl});
 const sealedCheck=`assert exists(select 1 from public.merchant_attendance_period_closures where merchant_id=${site} and period_id=${quote(periodId)} and sealed),'outage_subject_actual_seal_required';`;
 steps.push('begin;'+prefix+`do $subject_start$ begin ${sealedCheck}
  assert not exists(select 1 from public.merchant_attendance_outage_operations where merchant_id=${site}),'outage_subject_empty_ledger_required';
  assert not exists(select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid where c.relnamespace=${owned.oid} and t.tgenabled<>'O'),'outage_subject_guards_enabled';
  end;$subject_start$;select jsonb_build_object('kind','epoch_before','count',(select count(*) from public.merchant_attendance_account_epochs where merchant_id=${site} and employee_id=${employee}));`);
 call('incident',{kind:'outage',query:iq('owner'),command:json(p.incident),write:true});
 call('old_self_incident_before_declaration',{kind:'outage',query:iq('self'),actor:h.employeeAuthUserId,error:'attendance_outage_not_found'});
 call('owner_prepare');call('self_prepare',{query:p.q('self'),actor:h.employeeAuthUserId});
 call('owner_gate_off',{allow:false});call('self_gate_off',{query:p.q('self'),actor:h.employeeAuthUserId,allow:false});
 call('wrong_owner',{actor:h.employeeAuthUserId,error:'attendance_access_denied'});
 call('unknown_worker',{query:{...p.q('owner'),workerId:fresh(900)},error:'attendance_access_denied'});
 call('unknown_incident',{query:{...p.q('owner'),incidentId:fresh(901)},error:'attendance_outage_subject_not_found'});
 call('cross_merchant',{query:{...p.q('owner'),siteId:'99990002'},error:'attendance_access_denied'});
 call('self_cannot_select_worker',{query:{...p.q('self'),workerId:h.workerId},actor:h.employeeAuthUserId,error:'attendance_invalid_request'});
 const revoke=`update public.merchant_enterprise_roles set permissions=array_remove(permissions,'attendance.self.request') where merchant_id=${site}
  and id=(select role_id from public.merchant_enterprise_employees where merchant_id=${site} and id=${employee});`;
 call('role_revoked',{query:p.q('self'),actor:h.employeeAuthUserId,error:'attendance_access_denied',setup:revoke});
 call('old_auth_rebound',{query:p.q('self'),actor:h.employeeAuthUserId,error:'attendance_access_denied',setup:`update public.merchant_enterprise_employees set auth_user_id=${quote(fresh(902))} where merchant_id=${site} and id=${employee};`});
 call('first_self_declaration',{kind:'outage',query:dq('self'),actor:h.employeeAuthUserId,command:commandFrom(p.declare,'self_prepare'),write:true});
 call('self_declared_detail',{kind:'outage',query:dq('self'),actor:h.employeeAuthUserId});
 call('old_self_incident_after_declaration',{kind:'outage',query:iq('self'),actor:h.employeeAuthUserId});
 const later={...p.declare,operationId:fresh(5),declarationId:fresh(6)};
 call('stale_prepared_version',{kind:'outage',query:dq('self',later.declarationId),actor:h.employeeAuthUserId,
  command:`(${commandFrom(later,'self_prepare')})||jsonb_build_object('expectedWorkerVersion',(${saved('self_prepare')}->'subject'->>'workerVersion')::bigint+1)`,error:'attendance_outage_changed'});
 call('closed_gate_fresh',{kind:'outage',query:dq('self',later.declarationId),actor:h.employeeAuthUserId,command:commandFrom(later,'self_prepare'),allow:false,error:'attendance_outage_disabled'});
 call('self_recovery_gate_off',{kind:'outage',query:{siteId:d.site,access:'self',mode:'recover',operationId:p.declare.operationId},actor:h.employeeAuthUserId,allow:false});
 call('self_exact_replay_gate_off',{kind:'outage',query:dq('self'),actor:h.employeeAuthUserId,command:commandFrom(p.declare,'self_prepare'),allow:false});
 steps.push(prefix+`do $subject_pause_baseline$ begin perform set_config('faolla.outage217_pause_before',${fullHash},true);end;$subject_pause_baseline$;savepoint subject_pause;
  with subject_accepted as (update public.merchant_enterprise_employees set accepted_at=clock_timestamp()
   where merchant_id=${site} and id=${employee} and auth_user_id=${auth} and accepted_at is null returning version)
  select jsonb_build_object('kind','synthetic_acceptance','rows',count(*),'version',max(version)) from subject_accepted;`);
 //Only this rollback savepoint supplies the legacy accepted invitation fact.
 //Real164 status calls and all touch/audit/version constraints remain enabled.
 for(const [i,status]of ['disabled','active'].entries()){
  const command={merchant_id:d.site,employee_id:h.employeeId,actor_type:'owner',actor_id:d.owner,status,
   ...(status==='disabled'?{offboarding_mode:'unassign'}:{}),attendance_operation_id:fresh(20+i),attendance_suspension_enabled:true};
  steps.push(prefix+`do $subject_status$ declare version_no bigint;status_result jsonb;begin
   select version into strict version_no from public.merchant_enterprise_employees where merchant_id=${site} and id=${employee} and auth_user_id=${auth} and accepted_at is not null;
   set local role service_role;status_result:=public.faolla_update_merchant_enterprise_employee_v1(${json(command)}||jsonb_build_object('expected_version',version_no));
   set constraints all immediate;set constraints all deferred;reset role;
   perform set_config('faolla.outage217_status',jsonb_build_object('kind','actual_status','status',${quote(status)},'expectedVersion',version_no,'value',status_result)::text,true);
   end;$subject_status$;select current_setting('faolla.outage217_status')::jsonb;`);
 }
 call('paused_owner_prepare');
 call('paused_self_denied',{query:p.q('self'),actor:h.employeeAuthUserId,error:'attendance_account_suspended'});
 const paused={...p.declare,operationId:fresh(7),declarationId:fresh(8),statement:'Synthetic217 owner transcribes while current attendance remains paused'};
 call('paused_owner_declaration',{kind:'outage',query:dq('owner',paused.declarationId),command:commandFrom(paused,'paused_owner_prepare'),write:true});
 steps.push(prefix+`rollback to savepoint subject_pause;release savepoint subject_pause;do $subject_pause_restored$ begin
  assert ${fullHash}=current_setting('faolla.outage217_pause_before'),'outage_subject_pause_not_rolled_back';end;$subject_pause_restored$;`);
 steps.push(prefix+`do $subject_finish$ begin ${sealedCheck}end;$subject_finish$;set constraints all immediate;
  select jsonb_build_object('kind','counts','incidents',(select count(*) from public.merchant_attendance_outage_incidents where merchant_id=${site}),
   'declarations',(select count(*) from public.merchant_attendance_outage_declarations where merchant_id=${site}),
   'operations',(select count(*) from public.merchant_attendance_outage_operations where merchant_id=${site}),
   'epochCount',(select count(*) from public.merchant_attendance_account_epochs where merchant_id=${site} and employee_id=${employee}));rollback;`);
 assert(steps.length<=40);let rows;const failures=[];
 try{rows=(await native.querySteps(steps.map(sql=>scope.sql(sql)))).trim().split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line));}
 catch(error){failures.push(new Error('outage_subject_actual_sql_failed:'+String(error?.message??error),{cause:error}));}
 finally{
  for(const [label,read,want]of [['facts',()=>d.fingerprint(),baseline],['definitions',()=>d.definitions(),defs],['catalog',()=>d.tableCatalog(),catalog],
   ['old155_text',()=>archive().artifactText,oldArchive.artifactText],['old155_sha',()=>archive().artifactSha256,oldArchive.artifactSha256],
   ['sealed_text',()=>periodArchive().artifactText,sealed.artifactText],['sealed_sha',()=>periodArchive().artifactSha256,sealed.artifactSha256]]){
   try{assert.equal(read(),want,'outage_subject_rollback_'+label);}catch(error){failures.push(error);}
  }
 }
 if(failures.length)throw new AggregateError(failures,'outage_subject_native_failed:'+failures.map(e=>e.message).join(' | '));
 const {parseOutageSubjectResult}=require('../../src/lib/merchantAttendanceOutageSubject.ts');
 const {projectOutageResult}=require('../../src/lib/merchantAttendanceOutage.server.ts');
 const raw=new Map(),parsed=new Map();
 for(const row of rows){if(!row.label)continue;const expected=metadata.get(row.label);assert(expected);assert.equal(row.before,row.after);raw.set(row.label,row);
  assert.equal(row.error,expected.error);if(row.error)continue;
  try{parsed.set(row.label,row.kind==='subject'?parseOutageSubjectResult(row.value,row.query,row.actor):projectOutageResult(row.value,row.query,row.actor,row.command));}
  catch(error){throw new Error('outage_subject_projection_failed:'+row.label+':'+String(error?.message??error),{cause:error});}
 }
 assert.equal(raw.size,metadata.size);assert.equal(rows.filter(r=>r.error).length,rejections);
 const before=rows.find(r=>r.kind==='epoch_before').count,counts=rows.find(r=>r.kind==='counts');
 assert.deepEqual(counts,{kind:'counts',incidents:1,declarations:1,operations:2,epochCount:before});
 const self=parsed.get('self_prepare'),ownerPrepared=parsed.get('owner_prepare'),pause=parsed.get('paused_owner_prepare');
 assert.deepEqual(self.subject,ownerPrepared.subject);assert.equal(self.actorId,h.employeeAuthUserId);
 assert.equal(self.subject.employeeId,h.employeeId);assert.equal(self.subject.workerId,h.workerId);assert.equal(self.subject.employeeAuthUserId,h.employeeAuthUserId);
 assert.equal(parsed.get('owner_gate_off').canWrite,false);assert.equal(parsed.get('self_gate_off').canWrite,false);
 assert.equal(Object.keys(self.incident).length,5);assert.equal('reason' in self.incident,false);
 assert.equal(pause.subject.paused,true);assert.equal(pause.subject.active,false);assert.equal(pause.subject.generation,self.subject.generation+1);
 assert(pause.subject.workerVersion>self.subject.workerVersion);assert(pause.subject.employeeVersion>self.subject.employeeVersion);
 const declared=parsed.get('self_declared_detail').detail;
 assert.equal(declared.workerVersion,self.subject.workerVersion);assert.equal(declared.employeeVersion,self.subject.employeeVersion);assert.equal(declared.generation,self.subject.generation);
 assert.equal(declared.recordedBy,'self');assert.equal(declared.actorEmployeeId,h.employeeId);
 for(const label of ['self_recovery_gate_off','self_exact_replay_gate_off'])assert.deepEqual(parsed.get(label).receipt,parsed.get('first_self_declaration').receipt);
 const acceptance=rows.find(r=>r.kind==='synthetic_acceptance');assert([0,1].includes(acceptance.rows));
 assert.deepEqual(rows.filter(r=>r.kind==='actual_status').map(r=>r.status),['disabled','active']);
 //Feed actual SQL output and the exact SQL command through the real new GET
 //handler, existing POST handler/services and durable client after rollback.
 const bridge=await verifyCapturedClient({d,h,prepare:raw.get('self_prepare'),write:raw.get('first_self_declaration')});
 native.pass('217180 real owner/self subject preparation and first declaration preserve old self incident privacy, current CAS, actual pause boundaries and all archives');
 return {reads,submissions:writes,rejections,transactionSteps:steps.length,realAccountStatusOperations:2,syntheticInvitationAcceptanceRows:acceptance.rows,
  actualInvitationAcceptance:false,firstSelfDeclaration:true,oldIncidentPrivacyUnchanged:true,ownerPausedTranscription:true,currentVersionsVerified:true,
  readsAndRejectionsZeroWrites:true,noEpochCreatedByReads:true,rollbackRestored:true,oldFactsAndArchivesUnchanged:true,definitionsAndCatalogUnchanged:true,
  ...bridge,browser:false,productionAccess:false,newCluster:false};
}
async function verifyCapturedClient({d,h,prepare,write}){
 const {AttendanceOutageClient}=require('../../src/lib/merchantAttendanceOutageClient.ts');
 const {handleOutageSubject}=require('../../src/app/api/merchant-enterprise/attendance/outage-subject/route-handler.ts');
 const {handleOutage}=require('../../src/app/api/merchant-enterprise/attendance/outages/route-handler.ts');
 const {executeOutageSubject}=require('../../src/lib/merchantAttendanceOutageSubject.server.ts');
 const {executeOutage}=require('../../src/lib/merchantAttendanceOutage.server.ts');
 const keys=['FAOLLA_ATTENDANCE_OUTAGE_ENABLED','FAOLLA_ATTENDANCE_OUTAGE_SITE_IDS'],previous=keys.map(k=>process.env[k]);
 process.env[keys[0]]='1';process.env[keys[1]]=d.site;
 const memory=new Map([['unrelated','preserved']]),requests=[];
 const storage={getItem:k=>memory.get(k)??null,setItem:(k,v)=>memory.set(k,v),removeItem:k=>memory.delete(k)};
 const common={authenticate:async()=>({user:{id:h.employeeAuthUserId},accessToken:'synthetic-auth-boundary',authenticationMethods:['password']}),
  entitlement:async()=>({permissionConfig:{allowEnterpriseManagement:true,allowEmployeeAttendance:true}}),allow:()=>true,siteEnabled:()=>true};
 let client;
 try{
  client=new AttendanceOutageClient({kind:'outages',siteId:d.site,access:'self',actorId:h.employeeAuthUserId,enabled:true,storage:()=>storage,operationId:()=>write.command.operationId,
   apiFetch:async(url,init)=>{
    const req=new Request('https://www.faolla.com'+url,{...init,headers:{...init.headers,origin:'https://www.faolla.com','sec-fetch-site':'same-origin'}});
    requests.push({method:req.method,path:new URL(req.url).pathname});
    if(new URL(req.url).pathname==='/api/merchant-enterprise/attendance/outage-subject')return handleOutageSubject(req,{...common,
     execute:input=>executeOutageSubject(input,{rpc:async(name,args)=>{assert.equal(name,'faolla_attendance_outage_subject_v1');
      assert.deepEqual(args,{p_query:prepare.query,p_auth_user_id:prepare.actor,p_allow_write:true});return {data:prepare.value,error:null};}})});
    assert.equal(new URL(req.url).pathname,'/api/merchant-enterprise/attendance/outages');assert.equal(req.method,'POST');
    return handleOutage(req,{...common,execute:input=>executeOutage(input,{rpc:async(name,args)=>{assert.equal(name,'faolla_attendance_outage_v1');
     assert.deepEqual(args,{p_query:write.query,p_auth_user_id:write.actor,p_command:write.command,p_allow_write:true});return {data:write.value,error:null};}})});
   }});
  await client.initialize();assert.equal(requests.length,0);await client.prepare(prepare.query);
  assert.deepEqual(client.getSnapshot().prepared.subject,prepare.value.subject);assert.equal(client.getSnapshot().canWrite,true);
  const {operationId:omitted,...draft}=write.command;void omitted;await client.submit(write.query,draft);
  assert.equal(client.getSnapshot().pending,null);assert.deepEqual(client.getSnapshot().result.receipt,write.value.receipt);
  assert.deepEqual(requests,[{method:'GET',path:'/api/merchant-enterprise/attendance/outage-subject'},{method:'POST',path:'/api/merchant-enterprise/attendance/outages'}]);
  assert.deepEqual([...memory],[['unrelated','preserved']]);
  return {capturedSqlThroughActualClientAndHandlers:true,capturedBridgeRequests:requests.length,capturedBridgePost:1,liveBrowser:false};
 }finally{client?.pause();keys.forEach((key,i)=>{if(previous[i]===undefined)delete process.env[key];else process.env[key]=previous[i];});}
}
