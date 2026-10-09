// Pure model/static checks only. These synthetic objects are not SQL evidence.
import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {lifecycleId as id} from '../merchant-attendance-lifecycle-native-support.mjs';
import {employeeManagementFixturePlan} from '../merchant-attendance-employee-management-fixture.mjs';
import {delegatedRacesPlan,delegatedRacesScopes,delegatedRacesProtectedHash,assertDelegatedRacesFootprint,verifyPeriodDelegatedClosureRacesNative} from './attendance-period-delegated-closure-races-native.mjs';
const source=readFileSync(new URL('./attendance-period-delegated-closure-races-native.mjs',import.meta.url),'utf8'),site='99990001',table=s=>'merchant_attendance_'+s;
const has=(...values)=>values.forEach(value=>assert(source.includes(value),value));
const ordered=(...values)=>{let at=-1;for(const value of values){at=source.indexOf(value,at+1);assert(at>=0,value);}};
const permissions=['enterprise.view','attendance.period.view','attendance.period.send','attendance.period.respond','attendance.period.seal','attendance.period.reopen'];

test('inert fixture rejects non-owned contexts before connecting or requiring application modules',async()=>{
 await assert.rejects(verifyPeriodDelegatedClosureRacesNative({}),/delegated_races_owned_synthetic_context_required/);
 assert.doesNotMatch(source,/process\.argv|process\.env|spawn\(|listen\(|initdb|pg_ctl|CREATE DATABASE|playwright|chromium|closeAll\(/);
 ordered("'delegated_races_owned_synthetic_context_required'",'assertLifecycleSandbox','const {executePeriodDelegation}=require');
});
test('exact plan uses two new members, one role, four grants and only one successful period',()=>{
 const p=delegatedRacesPlan(),ids=[p.role,...p.members.flatMap(x=>[x.employeeId,x.authId,x.pause]),p.period.periodId,p.period.send,p.period.respond,p.period.confirm,p.period.seal,
  p.failed.periodId,p.failed.send,p.rejectedRespond,...p.grants,...p.revokes];
 assert.equal(new Set(ids).size,ids.length);assert(ids.every(x=>x.startsWith('00000000-0000-4000-8000-000234300')));
 assert.equal(p.period.date,'2010-01-05');assert.equal(p.failed.date,'2010-01-06');assert.equal(p.grants.length,4);assert.equal(p.members.length,2);
});
test('protected hash includes all old rows, nullable out-of-scope audits and rejected operation IDs',()=>{
 const p=delegatedRacesPlan(),scopes=delegatedRacesScopes(site),names=[...Object.keys(scopes),table('period_storage'),table('events')],sql=delegatedRacesProtectedHash(names,site);
 assert(!Object.values(scopes).join(' ').includes(p.failed.send));assert(!Object.values(scopes).join(' ').includes(p.rejectedRespond));assert(!Object.values(scopes).join(' ').includes(p.failed.periodId));
 has('initial.rows))assert.deepEqual(rows,[]','initial.failedFootprint,0');assert(sql.includes('is not true'));assert(sql.includes('t.version=1'));assert(sql.includes('t.generation=1'));
 assert(sql.includes('from public.merchant_attendance_events t)'));assert.throws(()=>delegatedRacesScopes('bad'));
 assert.throws(()=>delegatedRacesProtectedHash(['bad;drop'],site));assert.throws(()=>delegatedRacesProtectedHash(['merchants','merchants'],site));
});
function model(){
 const plan=delegatedRacesPlan(),p=plan.period,[a,b]=plan.members,workerId=id(101),employeeId=id(102),employeeAuthUserId=id(103),owner=id(104),stamp='2026-10-08T12:00:00.000001+00:00';
 const state={site,workerId,employeeId,employeeAuthUserId,owner,baseline:1000,seeded:true,previous:null,accepted:new Map(),plan};
 const proof={rows:Object.fromEntries(Object.keys(delegatedRacesScopes(site)).map(name=>[name,[]])),usedBytes:1000,actualBytes:1000,sidecarsValid:true,delegateWorkers:0,failedFootprint:0},rows=proof.rows;
 rows.merchant_enterprise_roles=[{id:plan.role,status:'active',permissions}];
 rows.merchant_enterprise_employees=plan.members.map(m=>({id:m.employeeId,merchant_id:site,auth_user_id:m.authId,role_id:plan.role,status:'disabled',version:2,updated_at:stamp}));
 rows.merchant_enterprise_audit_events=plan.members.flatMap((m,i)=>{
  const common={merchant_id:site,entity_type:'employee',entity_id:m.employeeId,actor_id:null,operation_id:'',dedupe_key:null},fields={display_name:`Synthetic234 supervisor ${i}`,role_id:plan.role,auth_bound:true};
  return [{...common,id:id(901+i*2),event_type:'employee.created',actor_type:'system',before_data:{},after_data:{...fields,status:'active'}},
   {...common,id:id(902+i*2),event_type:'employee.disabled',actor_type:'owner',before_data:{...fields,status:'active'},after_data:{...fields,status:'disabled'}}];
 });
 for(const [i,grantId]of plan.grants.entries()){
  const command={action:'grant',operationId:grantId,delegateEmployeeId:i===3?b.employeeId:a.employeeId},query={siteId:site,access:'owner',mode:'list'};
  state.accepted.set(grantId,{kind:'management',actor:owner,command,query});rows[table('period_delegations')].push({grant_id:grantId,actor_auth_user_id:owner,command,query});
 }
 for(const [i,op]of plan.revokes.entries()){
  const command={action:'revoke',operationId:op,grantId:plan.grants[i]},query={siteId:site,access:'owner',mode:'detail',grantId:plan.grants[i]};
  state.accepted.set(op,{kind:'management',actor:owner,command,query});rows[table('period_delegation_revocations')].push({operation_id:op,grant_id:command.grantId,actor_auth_user_id:owner,command,query});
 }
 const ops=[['send',p.send,0],['respond',p.respond,1],['confirm',p.confirm,null],['seal',p.seal,2]];
 for(const [index,[action,op,grantIndex]]of ops.entries()){
  const actor=action==='confirm'?employeeAuthUserId:a.authId,command={action,operationId:op,periodId:p.periodId,expectedRevision:index,expectedVersion:index?1:0},query={grantId:grantIndex===null?null:plan.grants[grantIndex]};
  state.accepted.set(op,{kind:action==='confirm'?'self':'delegate',actor,command,query});rows[table('period_entries')].push({merchant_id:site,period_id:p.periodId,operation_id:op,revision:index+1,version:1,actor_auth_user_id:actor,command,recorded_at:stamp});
  if(action!=='confirm')rows[table('period_delegation_operations')].push({operation_id:op,period_id:p.periodId,grant_id:query.grantId,command,query,actor_auth_user_id:actor,worker_id:workerId,employee_id:employeeId,employee_auth_user_id:employeeAuthUserId,period_revision:index+1});
 }
 rows[table('period_closures')]=[{period_id:p.periodId,worker_id:workerId,employee_id:employeeId,employee_auth_user_id:employeeAuthUserId,from_date:p.date,through_date:p.date,time_zone:'UTC',revision:4,current_version:1,state:'sealed',sealed:true,confirmed_version:1,unresolved_dispute:false,opened_at:stamp,updated_at:stamp}];
 rows[table('period_versions')]=[{merchant_id:site,period_id:p.periodId,version:1,artifact_id:p.send,operation_id:p.send,recorded_at:stamp}];
 const artifact={protocol:'attendance-period-artifact-v2',report:{access:'delegate'},authority:{grantId:plan.grants[0],action:'send'},sourceFingerprint:'a'.repeat(64),worker:{workerName:'Pure mock only',workerNo:'QA'}};
 const artifactText=JSON.stringify(artifact),bytes=Buffer.byteLength(artifactText);rows[table('period_artifacts')]=[{artifact_id:p.send,period_id:p.periodId,source_fingerprint:artifact.sourceFingerprint,artifact_text:artifactText,artifact_bytes:bytes,artifact_sha256:createHash('sha256').update(artifactText).digest('hex'),recorded_at:stamp}];
 rows[table('period_artifact_metadata')]=[{merchant_id:site,artifact_id:p.send,worker_name:artifact.worker.workerName,worker_no:artifact.worker.workerNo}];
 for(const [i,m]of plan.members.entries()){
  const input={merchant_id:site,employee_id:m.employeeId,expected_version:1,actor_type:'owner',actor_id:owner,status:'disabled',offboarding_mode:'unassign',attendance_operation_id:m.pause,attendance_suspension_enabled:true},suspensionId=id(910+i);
  state.accepted.set(m.pause,{kind:'pause',actor:owner,input});rows[table('account_epochs')].push({employee_id:m.employeeId,generation:1,paused:true,suspension_id:suspensionId});
  rows[table('account_suspensions')].push({employee_id:m.employeeId,employee_auth_user_id:m.authId,worker_id:null,was_active:null,suspension_id:suspensionId});
  const {attendance_operation_id,attendance_suspension_enabled,...saved}=input;rows[table('account_status_operations')].push({operation_id:m.pause,employee_id:m.employeeId,actor_auth_user_id:owner,expected_version:1,version:2,status:'disabled',suspension_id:suspensionId,input:saved});
 }
 proof.usedBytes+=bytes;proof.actualBytes+=bytes;return {proof,state,bytes};
}
test('pure final footprint matches only four period entries, three immutable sidecars and actual body byte charge',()=>{
 const {proof,state,bytes}=model();assert.equal(state.accepted.size,12);assert.equal(assertDelegatedRacesFootprint(proof,state),bytes);
 assert.equal(assertDelegatedRacesFootprint(proof,{...state,previous:structuredClone(proof)}),bytes);
});
test('seed audit expectation follows the actual employee-only preparation, not the full production019 migration',()=>{
 const preparation=employeeManagementFixturePlan(fileURLToPath(new URL('../../',import.meta.url)));
 assert(preparation.triggers.includes('merchant_enterprise_employees_audit'));assert(!preparation.triggers.includes('merchant_enterprise_roles_audit'));
 const migration=readFileSync(new URL('../supabase-migrations/202608020019_merchant_enterprise_audit.sql',import.meta.url),'utf8');
 assert.match(migration,/create trigger merchant_enterprise_roles_audit\s+after insert or update on public\.merchant_enterprise_roles/);
 assert.match(migration,/create trigger merchant_enterprise_employees_audit\s+after insert or update or delete on public\.merchant_enterprise_employees/);
 has("profile.auditTriggers,{employeeAudit:true,roleAudits:0}","tgenabled='O' and tgtype=29",'seeded?2+paused.length:0');
 assert(!delegatedRacesScopes(site).merchant_enterprise_audit_events.includes(delegatedRacesPlan().role));
});
test('audit proof rejects invented role creation, changed actor, wrong transition or leaked owner UUID',()=>{
 const mutations=[p=>p.rows.merchant_enterprise_audit_events.push({entity_id:delegatedRacesPlan().role,event_type:'role.created'}),
  p=>p.rows.merchant_enterprise_audit_events[0].actor_type='owner',p=>p.rows.merchant_enterprise_audit_events[1].actor_type='system',
  p=>p.rows.merchant_enterprise_audit_events[1].actor_id=id(104),p=>p.rows.merchant_enterprise_audit_events[1].before_data.status='disabled',
  p=>p.rows.merchant_enterprise_audit_events[1].after_data.role_id=id(998),p=>p.rows.merchant_enterprise_audit_events[1].operation_id=delegatedRacesPlan().members[0].pause];
 for(const change of mutations){const {proof,state}=model();change(proof);assert.throws(()=>assertDelegatedRacesFootprint(proof,state));}
});
test('footprint refuses loser residue, extra grants, wrong identities, altered commands, invalid proof and quota drift',()=>{
 const changes=[p=>p.failedFootprint++,p=>p.sidecarsValid=false,p=>p.delegateWorkers++,p=>p.usedBytes++,p=>p.actualBytes--,
  p=>p.rows[table('period_entries')].push({...p.rows[table('period_entries')][0],operation_id:delegatedRacesPlan().rejectedRespond}),
  p=>p.rows[table('period_delegations')].push({...p.rows[table('period_delegations')][0],grant_id:id(999)}),
  p=>p.rows.merchant_enterprise_employees[0].auth_user_id=id(998),p=>p.rows.merchant_enterprise_employees[0].version=3,
  p=>p.rows[table('period_entries')][1].command.expectedRevision=0,p=>p.rows[table('period_closures')][0].confirmed_version=null,
  p=>p.rows[table('period_artifacts')][0].artifact_text+=' ',p=>p.rows[table('period_artifacts')][0].artifact_bytes++,
  p=>p.rows[table('account_epochs')][0].generation=2,p=>p.rows[table('account_epochs')][0].paused=false,p=>p.rows[table('account_suspensions')][0].worker_id=id(997),
  p=>p.rows[table('account_status_operations')][0].input.expected_version=2,p=>p.rows.merchant_enterprise_audit_events.pop()];
 for(const change of changes){const {proof,state}=model(),copy=structuredClone(proof);change(copy);assert.throws(()=>assertDelegatedRacesFootprint(copy,state));}
});
test('already observed full immutable rows and non-status membership fields cannot be changed',()=>{
 for(const change of [p=>p.rows[table('period_delegations')][0].synthetic_extra='tampered',p=>p.rows.merchant_enterprise_employees[0].email='changed',p=>p.rows[table('period_closures')][0].start_at='changed',p=>p.rows.merchant_enterprise_audit_events[0].label='changed']){
  const {proof,state}=model(),previous=structuredClone(proof);change(proof);assert.throws(()=>assertDelegatedRacesFootprint(proof,{...state,previous}));
 }
});
test('four real races cover both revoke orders and both pause orders, not a timing sleep',()=>{
 has("race('revoke_before_respond'","race('respond_before_revoke'","race('seal_before_pause'","race('pause_before_prepared_send'",'pg_blocking_pids(pid)',"wait_event_type='Lock'",'Date.now()+2500');
 ordered('await Promise.all([holder.ready(),waiter.ready()])','holder.release();const won=await holder.outcome','waiter.release();let witnessed=false',"await holder.step('commit;');const lost=await waiter.outcome");
 assert.doesNotMatch(source,/pg_sleep\(|for update|for share/i); // No fixture lock can impersonate the real RPC's lock.
 has("assert.equal(waiter.last.sqlstate,'P0001')",'check(waiter.last.proof)',"await waiter.step('rollback;')");
});
test('real delegated service completes Node preview before gate; archive data is never hand-built',()=>{
 has('executePeriodDelegatedClosures({query:input.query','reachGate({name,args});await gate',"ready[1].args.p_artifact.protocol,'attendance-period-artifact-v2'",
  "!Object.hasOwn(ready[1].args.p_artifact,'authority')",'set local role service_role',"assert current_user='service_role'",'rpc_value:=${expression}');
 assert.doesNotMatch(source,/insert into public\.merchant_attendance_(?:period|events|workers)/i);
 assert.doesNotMatch(source,/update public\./i);has('faolla_update_merchant_enterprise_employee_v1','expected_version:1','attendance_suspension_enabled:true');
});
test('after revoke/pause only explicit minimal receipt recovery occurs; genuine self performs confirmation',()=>{
 has("request('self',h.employeeAuthUserId",'oldQuery(\'self\')',"command('confirm',p.confirm",'input.query.mode!==\'recover\'',
  "query(plan.grants[index],p,'recover',{operationId})","assert.deepEqual(recovered.usableActions,[])");
 has('receipts=new Map()','receipts.set(op,structuredClone(result.receipt))','assert.deepEqual(recovered.receipt,receipts.get(operationId))');
 ordered("race('pause_before_prepared_send'",'for(const [operationId,index]of [[p.send,0],[p.respond,1],[p.seal,2]])');
});
test('bounded sessions preserve original serialization, timeouts, old archives and parent-only disposal',()=>{
 has("set local lock_timeout='3s';set local statement_timeout='10s';",'assert(++steps<=100',"const execRead=sql=>d.exec(periodContinuationSerialization+d.guard+sql)",
  'await connection.close()','for(const s of [...sessions])','await s.outcome',"['definitions',()=>d.definitions(),definitions]","['catalog',()=>d.tableCatalog(),catalog]",
  "assert.equal(saved.sourceChanged,false)",'ownedSchemaCleanupRequired:true','committedSyntheticRows:true');
 assert.equal(source.match(/d\.exec\(/g)?.length,1);assert.doesNotMatch(source,/drop schema|delete from|truncate|disable trigger|session_replication_role|setTimeout\([^\n]*25000/i);
});
test('SQL locals do not shadow proof table aliases',()=>{
 const declaration=source.match(/do \$delegated_race_rpc\$ declare ([^\n]+);begin/)?.[1];assert(declaration);
 assert.deepEqual(declaration.split(';').map(s=>s.trim().split(/\s+/)[0]),['rpc_value','rpc_failure','rpc_state','rpc_context','before_proof']);
 assert.doesNotMatch(declaration,/\bt\s/);has('rpc_failure=message_text,rpc_state=returned_sqlstate,rpc_context=pg_exception_context');
});
