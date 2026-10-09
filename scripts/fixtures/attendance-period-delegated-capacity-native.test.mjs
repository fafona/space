// Pure models/static/failure orchestration only; none of these is SQL evidence.
import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {runInNewContext} from 'node:vm';
import {lifecycleId as id} from '../merchant-attendance-lifecycle-native-support.mjs';
import {employeeManagementFixturePlan} from '../merchant-attendance-employee-management-fixture.mjs';
import {periodContinuationArchiveBytes,periodContinuationSerialization} from './attendance-period-continuation-native.mjs';
import {periodContinuationCapacityLimit as LIMIT,periodContinuationCapacityRemaining} from './attendance-period-continuation-capacity-native.mjs';
import {delegatedCapacityPlan,delegatedCapacityScopes,delegatedCapacityHash,delegatedCapacityCallScopes,
 assertDelegatedCapacityFootprint,verifyPeriodDelegatedCapacityNative} from './attendance-period-delegated-capacity-native.mjs';
const source=readFileSync(new URL('./attendance-period-delegated-capacity-native.mjs',import.meta.url),'utf8'),site='99990001',table=s=>'merchant_attendance_'+s;
const has=(...values)=>values.forEach(value=>assert(source.includes(value),value));
const order=(...values)=>{let at=-1;for(const value of values){at=source.indexOf(value,at+1);assert(at>=0,value);}};
const permissions=['enterprise.view','attendance.period.view','attendance.period.send','attendance.period.respond','attendance.period.seal','attendance.period.reopen'];

test('inert import and non-owned context cannot connect or load application services',async()=>{
 await assert.rejects(verifyPeriodDelegatedCapacityNative({}),/delegated_capacity_owned_synthetic_context_required/);
 assert.doesNotMatch(source,/process\.argv|process\.env|spawn\(|listen\(|initdb|pg_ctl|CREATE DATABASE|playwright|chromium|closeAll\(/);
 order("'delegated_capacity_owned_synthetic_context_required'",'assertLifecycleSandbox','const {executePeriodDelegation}=require');
});
test('one empty period, six operations and only exact2353 ID scope',()=>{
 const p=delegatedCapacityPlan(),ids=Object.entries(p).filter(([key])=>key!=='date').map(([,value])=>value);
 assert.equal(new Set(ids).size,11);assert(ids.every(x=>x.startsWith('00000000-0000-4000-8000-000235300')));assert.equal(p.date,'2010-01-08');
 const scopes=delegatedCapacityScopes(site);assert.equal(Object.keys(scopes).length,10);assert(!scopes.merchant_enterprise_audit_events.includes(p.role));
 assert(!scopes[table('period_artifacts')].includes(p.reuse));assert(!scopes[table('period_delegation_operations')].includes(p.confirm));
});
test('outside hash preserves all unlisted and nullable rows; exact writer allowance never opens a whole table',()=>{
 const p=delegatedCapacityPlan(),names=[...Object.keys(delegatedCapacityScopes(site)),table('period_storage'),table('events')];
 const read=delegatedCapacityHash(names);assert(!read.includes('where '));
 const send=delegatedCapacityHash(names,delegatedCapacityCallScopes(site,p,'faolla_attendance_period_delegated_closure_v1',{action:'send',operationId:p.send}));
 assert(send.includes('is not true'));assert(send.includes(`t.period_id='${p.periodId}' and t.artifact_id='${p.send}'`));assert(send.includes(`t.merchant_id='${site}'`));
 assert(send.includes('from public.merchant_attendance_events t)'));assert(send.includes('from public.merchant_enterprise_employees t)'));
 const respond=delegatedCapacityCallScopes(site,p,'faolla_attendance_period_delegated_closure_v1',{action:'respond',operationId:p.respond});
 assert.deepEqual(Object.keys(respond).sort(),[table('period_closures'),table('period_entries'),table('period_delegation_operations')].sort());
 const self=delegatedCapacityCallScopes(site,p,'faolla_attendance_period_closure_v2',{action:'confirm',operationId:p.confirm});assert(!self[table('period_delegation_operations')]);
 assert.deepEqual(Object.keys(delegatedCapacityCallScopes(site,p,'faolla_attendance_period_delegation_v1',{action:'grant',operationId:p.grant})),[table('period_delegations')]);
 assert.throws(()=>delegatedCapacityHash(['bad;drop']));assert.throws(()=>delegatedCapacityHash([]));assert.throws(()=>delegatedCapacityHash(['merchants','merchants']));assert.throws(()=>delegatedCapacityScopes('bad'));
});

function model(){
 const p=delegatedCapacityPlan(),workerId=id(101),employeeId=id(102),employeeAuthUserId=id(103),owner=id(104),stamp='2026-10-08T12:00:00.000001+00:00';
 const state={site,workerId,employeeId,employeeAuthUserId,owner,baseline:1000,expectedUsed:LIMIT,seeded:true,previous:null,accepted:new Map(),plan:p};
 const proof={rows:Object.fromEntries(Object.keys(delegatedCapacityScopes(site)).map(name=>[name,[]])),usedBytes:LIMIT,actualBytes:1000,sidecarsValid:true,delegateWorkers:0},rows=proof.rows;
 rows.merchant_enterprise_roles=[{id:p.role,status:'active',permissions}];rows.merchant_enterprise_employees=[{id:p.delegate,merchant_id:site,auth_user_id:p.auth,role_id:p.role,status:'active',version:1}];
 rows.merchant_enterprise_audit_events=[{entity_id:p.delegate,entity_type:'employee',event_type:'employee.created',actor_type:'system',actor_id:null,operation_id:'',dedupe_key:null,
  before_data:{},after_data:{display_name:'Synthetic235 quota supervisor',role_id:p.role,auth_bound:true,status:'active'}}];
 const grant={action:'grant',operationId:p.grant},grantQuery={siteId:site,access:'owner',mode:'list'};state.accepted.set(p.grant,{actor:owner,command:grant,query:grantQuery});
 rows[table('period_delegations')]=[{grant_id:p.grant,actor_auth_user_id:owner,command:grant,query:grantQuery}];
 const ops=[['send',p.send],['respond',p.respond],['confirm',p.confirm],['seal',p.seal],['reopen',p.reopen],['send',p.reuse]];
 for(const [index,[action,operationId]]of ops.entries()){
  const actor=action==='confirm'?employeeAuthUserId:p.auth,command={action,operationId,periodId:p.periodId,expectedRevision:index,expectedVersion:index?1:0},query={grantId:p.grant};
  state.accepted.set(operationId,{actor,command,query});const version=operationId===p.reuse?2:1;
  rows[table('period_entries')].push({operation_id:operationId,period_id:p.periodId,actor_auth_user_id:actor,revision:index+1,version,action,command,recorded_at:stamp});
  if(action!=='confirm')rows[table('period_delegation_operations')].push({operation_id:operationId,grant_id:p.grant,period_revision:index+1,period_version:version,
   worker_id:workerId,employee_id:employeeId,employee_auth_user_id:employeeAuthUserId,actor_auth_user_id:p.auth,actor_employee_id:p.delegate,command,query});
 }
 rows[table('period_closures')]=[{period_id:p.periodId,worker_id:workerId,employee_id:employeeId,employee_auth_user_id:employeeAuthUserId,from_date:p.date,through_date:p.date,time_zone:'UTC',
  revision:6,current_version:2,state:'review',sealed:false,confirmed_version:null,unresolved_dispute:false,opened_at:stamp,updated_at:stamp}];
 rows[table('period_versions')]=[p.send,p.reuse].map((op,index)=>({merchant_id:site,period_id:p.periodId,version:index+1,artifact_id:p.send,operation_id:op,recorded_at:stamp}));
 const artifact={protocol:'attendance-period-artifact-v2',report:{access:'delegate'},authority:{grantId:p.grant,actorAuthUserId:p.auth,actorEmployeeId:p.delegate,action:'send'},
  sourceFingerprint:'a'.repeat(64),worker:{workerName:'Pure model, not SQL evidence',workerNo:'QA'}};
 const artifactText=JSON.stringify(artifact),bytes=Buffer.byteLength(artifactText);rows[table('period_artifacts')]=[{artifact_id:p.send,source_fingerprint:artifact.sourceFingerprint,
  artifact_text:artifactText,artifact_bytes:bytes,artifact_sha256:createHash('sha256').update(artifactText).digest('hex'),recorded_at:stamp}];
 rows[table('period_artifact_metadata')]=[{merchant_id:site,artifact_id:p.send,worker_name:artifact.worker.workerName,worker_no:artifact.worker.workerNo}];proof.actualBytes+=bytes;return {proof,state,bytes};
}
test('pure final footprint requires six entries, two versions, five proofs but one unchanged body',()=>{
 const {proof,state,bytes}=model();assert.equal(state.accepted.size,7);assert.equal(assertDelegatedCapacityFootprint(proof,state),bytes);
 assert.equal(assertDelegatedCapacityFootprint(proof,{...state,previous:structuredClone(proof)}),bytes);assert.notEqual(proof.usedBytes,proof.actualBytes);
});
test('exact footprint rejects half rows, wrong identity/confirmation, extra bodies or hidden quota drift',()=>{
 const changes=[p=>p.rows[table('period_entries')].pop(),p=>p.rows[table('period_delegation_operations')].pop(),p=>p.sidecarsValid=false,p=>p.delegateWorkers++,
  p=>p.usedBytes--,p=>p.actualBytes++,p=>p.rows[table('period_versions')][1].artifact_id=delegatedCapacityPlan().reuse,
  p=>p.rows[table('period_artifacts')].push({...p.rows[table('period_artifacts')][0],artifact_id:delegatedCapacityPlan().reuse}),
  p=>p.rows[table('period_entries')][0].command.expectedRevision++,p=>p.rows[table('period_delegation_operations')][0].actor_employee_id=id(998),
  p=>p.rows[table('period_closures')][0].confirmed_version=2,p=>p.rows[table('period_closures')][0].sealed=true,
  p=>p.rows[table('period_artifacts')][0].artifact_text+=' ',p=>p.rows.merchant_enterprise_employees[0].status='disabled',
  p=>p.rows.merchant_enterprise_audit_events.push({entity_id:delegatedCapacityPlan().role,event_type:'role.created'})];
 for(const change of changes){const {proof,state}=model(),copy=structuredClone(proof);change(copy);assert.throws(()=>assertDelegatedCapacityFootprint(copy,state));}
});
test('already observed new rows remain full-row immutable, except the exact period mutable head',()=>{
 for(const change of [p=>p.rows[table('period_delegations')][0].extra='changed',p=>p.rows.merchant_enterprise_employees[0].email='changed',
  p=>p.rows[table('period_closures')][0].start_at='changed',p=>p.rows[table('period_artifacts')][0].extra='changed',p=>p.rows.merchant_enterprise_audit_events[0].label='changed']){
  const {proof,state}=model(),previous=structuredClone(proof);change(proof);assert.throws(()=>assertDelegatedCapacityFootprint(proof,{...state,previous}));
 }
});
test('seed audit pins inherited employee-only fixture and does not fabricate a role audit',()=>{
 const preparation=employeeManagementFixturePlan(fileURLToPath(new URL('../../',import.meta.url)));
 assert(preparation.triggers.includes('merchant_enterprise_employees_audit'));assert(!preparation.triggers.includes('merchant_enterprise_roles_audit'));
 has('initial.auditTriggers,{employeeAudit:true,roleAudits:0}',"tgenabled='O' and tgtype=29",'assert.equal(audit.length,Number(seeded))');
 assert(!delegatedCapacityScopes(site).merchant_enterprise_audit_events.includes(delegatedCapacityPlan().role));
});
test('stored bytes include real private185 authority measured by owned test connection, never hand-authored authority',()=>{
 has('cap_authority:=public.faolla_attendance_period_delegation_guard_v1(',"cap_bytes:=octet_length(convert_to((${json(args.p_artifact)}||jsonb_build_object('authority',cap_authority))::text,'UTF8'))",
  "assert ${fullHash}=cap_before,'delegated_capacity_measurement_wrote'",'measurementPrivateGuardByOwnedTestConnection:true','assert.equal(chargedBytes,measured.bytes)',
  "without(head.artifact.authority,['authorizedAt']),without(measured.authority,['authorizedAt'])",'head.artifact.authority.authorizedAt.length,measured.authority.authorizedAt.length');
 assert.doesNotMatch(source,/args\.p_artifact\s*=|p_artifact:\s*\{|authority:\s*\{/);
 order('cap_authority:=public.faolla_attendance_period_delegation_guard_v1','cap_bytes:=octet_length','periodContinuationCapacityRemaining(value.bytes,shortage)',"await step('inject_exact_projection'");
 const privateMeasure=source.slice(source.indexOf('const measureAndInject='),source.indexOf(' const rpc=async'));
 assert(!privateMeasure.includes('set local role service_role'));
});
test('injection CAS permits only known same-site padding and rejection has full zero-write guard',()=>{
 has('where merchant_id=${site} and used_bytes=${expected}',"assert found,'delegated_capacity_projection_cas'",'assert(target>=state.baseline)',
  "assert ${noStorage}=cap_before,'delegated_capacity_projection_changed_other_facts'",'proof.usedBytes>=proof.actualBytes&&proof.usedBytes<=LIMIT',
  "assert ${fullHash}=cap_before,'delegated_capacity_read_replay_rejection_wrote'",'delegated_capacity_write_outside_exact_operation');
 order('shortage=1;await assert.rejects',"assert.equal(state.accepted.has(p.send),false)","q('recover',{operationId:p.send}),null,false)).receipt,null",'shortage=0;const sent=await run(q(),first)');
 assert.equal(periodContinuationCapacityRemaining(5000,1)+5000,LIMIT+1);assert.equal(periodContinuationCapacityRemaining(5000)+5000,LIMIT);
 const directWrites=[...source.matchAll(/(?:insert into|update) public\.(merchant_\w+)/gi)].map(m=>m[1]);
 assert.deepEqual(directWrites,['merchant_attendance_period_storage','merchant_enterprise_roles','merchant_enterprise_employees']);
 assert.doesNotMatch(source,/disable trigger|drop (?:schema|table|trigger)|alter table|truncate|delete from|session_replication_role/i);
});
test('POST replay is genuine187 with original command and strict Node minimal-receipt validation',()=>{
 has("const response=await rpc('faolla_attendance_period_delegated_closure_v1',args)",'projectPeriodDelegatedClosureResult(response.data,args.p_query,args.p_auth_user_id,args.p_command)',
  'assert(firstArgs?.p_command)','assert.deepEqual((await raw(firstArgs)).receipt,savedReceipt)',
  "await raw({...firstArgs,p_allow_write:false},'attendance_period_delegation_disabled')",'replays,1','rejections,4');
 order('const savedReceipt=sent.receipt','await raw(firstArgs)','p_allow_write:false');
});
test('full projection covers actual respond, actual self consent, seal/reopen and source reuse without another body',()=>{
 has("await run(q(),respond)",'authUserId:h.employeeAuthUserId,moduleEnabled:true',"command('confirm',p.confirm,head.period,fp)",
  "command('seal',p.seal,head.period,fp)",'await run(q(),reopen)',"command('send',p.reuse,head.period,fp)",
  'assert.deepEqual(periodContinuationArchiveBytes(lastRpc.value),stored)','assert.equal(final.actualBytes,state.baseline+chargedBytes)',
  'injectedQuotaProjection:true,physicallyFilledBudget:false','actualNodeProjectionAndServiceRoleRpc:true,syntheticAuth:true,realAuth:false');
});
test('one bounded connection uses UTC throughout; no external query while its transaction is open',()=>{
 assert.equal(source.match(/native\.connect\(\)/g)?.length,1);
 const body=source.slice(source.indexOf(' try{\n  const initial='),source.indexOf('\n finally{'));
 assert.doesNotMatch(body,/d\.(?:fingerprint|definitions|tableCatalog|exec|inventory)\(|native\.query\(|await (?:periodArchive|archive)\(/);
 has('const prefix=periodContinuationSerialization+d.guard',"set local lock_timeout='3s';set local statement_timeout='10s';",'assert(++steps<=100',
  "assert current_user='service_role'",'set constraints all immediate;set constraints all deferred','cap_failure=message_text,cap_state=returned_sqlstate,cap_context=pg_exception_context');
 for(const [,declaration]of source.matchAll(/do \$dcap_\w+\$ declare ([^\n]+);begin/g))for(const local of declaration.split(';').map(x=>x.trim().split(/\s+/)[0]))assert(local.startsWith('cap_'));
 order('const facts=d.fingerprint()', 'connection=native.connect()',"await step('constraints_and_rollback'",'await connection.close()',"['facts',()=>d.fingerprint(),facts]");
});

function failureHarness({mutate=false,closeFails=false}={}){
 const events=[],artifactText='{"pure":"failure harness only"}',artifact={artifactText,artifact:JSON.parse(artifactText),artifactBytes:Buffer.byteLength(artifactText),artifactSha256:createHash('sha256').update(artifactText).digest('hex')};
 const owned={schema:'attendance_race_'+'a'.repeat(32)},values={facts:'facts',defs:'defs',catalog:'catalog'},names=[...Object.keys(delegatedCapacityScopes(site)),table('period_storage'),table('events')];
 const d={syntheticOnly:true,owned,site,owner:id(99),guard:'--owned\n',inventory:()=>names,fingerprint:()=>{events.push('external_facts');return values.facts;},definitions:()=>values.defs,tableCatalog:()=>values.catalog};
 const ctx={d,h:{syntheticOnly:true,workerId:id(101),employeeId:id(102),employeeAuthUserId:id(103)},periodArchive:()=>artifact,archive:()=>artifact,oldArchive:artifact,
  scope:{schema:owned.schema,sql:s=>s},native:{query:()=>'',pass:()=>events.push('pass'),connect:()=>{events.push('connect');return {step:async sql=>{events.push(sql);if(mutate)values.facts='changed';throw Error('synthetic first-step failure');},
   close:async()=>{events.push('close');if(closeFails)throw Error('synthetic close failure');}};}}};
 const code=source.replace(/^import .*;\r?$/gm,'').replace(/^export /gm,'').replaceAll('import.meta.url','moduleUrl')+'\nverifyPeriodDelegatedCapacityNative;';
 const fn=runInNewContext(code,{assert,Buffer,JSON,id,LIMIT,structuredClone,moduleUrl:'file:///synthetic/delegated-capacity.mjs',assertLifecycleSandbox:()=>owned,
  quote:v=>"'"+v+"'",json:v=>"'"+JSON.stringify(v)+"'::jsonb",outageNativeFingerprintSql:()=>"'facts'",periodContinuationCapacityRemaining,
  periodContinuationArchiveBytes,periodContinuationSerialization,createRequire:()=>()=>({})},{timeout:1000});
 return {events,run:()=>fn(ctx)};
}
test('first-step failure closes only owned connection before all external guards, never claims success',async()=>{
 const h=failureHarness();await assert.rejects(h.run(),e=>{assert.match(e.message,/delegated_capacity_native_failed:.*delegated_capacity:begin:synthetic first-step failure/s);
  assert.match(e.message,/lastStepFailure:\{"stage":"begin","detail":"Error: synthetic first-step failure/);assert.equal(e.errors.length,1);return true;});
 const started=h.events.indexOf('connect'),closed=h.events.indexOf('close');assert(closed>started);assert.match(h.events[started+1],/^begin;reset role;set local time zone 'UTC'/);
 assert.equal(h.events.indexOf('external_facts',started),closed+1);assert(!h.events.includes('pass'));
});
test('cleanup and baseline errors remain visible alongside original failure; no blind quota repair',async()=>{
 const h=failureHarness({mutate:true,closeFails:true});await assert.rejects(h.run(),e=>{assert.equal(e.errors.length,3);assert.equal(e.cause,e.errors[0]);
  assert.match(e.message,/synthetic close failure/);assert.match(e.message,/delegated_capacity_rollback_facts/);return true;});
 assert(!h.events.includes('pass'));assert.doesNotMatch(source.slice(source.indexOf('\n finally{')),/update public|\.step\(/);
});
