//Pure/SOURCE only. No fake SQL evaluator and no native/KDF pass claim.
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {delegatedCredentialsNativeSite,delegatedCredentialsNativeIds,delegatedCredentialsNativeGroupBudgets,
 delegatedCredentialsNativeRpcExpression,delegatedCredentialsNativeIndependentChange,delegatedCredentialsNativeFaultSql,delegatedCredentialsNativeCleanup,verifyDelegatedCredentialsNative} from './attendance-delegated-credentials-native.mjs';
const require=createRequire(import.meta.url),source=readFileSync(new URL('./attendance-delegated-credentials-native.mjs',import.meta.url),'utf8'),p=delegatedCredentialsNativeIds;
test('207 finite8 groups actualRPC hardcap90 includes all Node prereads, one bounded rollback connection',()=>{
 assert.equal(delegatedCredentialsNativeSite,'99990207');assert.equal(delegatedCredentialsNativeGroupBudgets.length,8);
 assert.equal(delegatedCredentialsNativeGroupBudgets.reduce((n,g)=>n+g.rpcs,0),90);assert(delegatedCredentialsNativeGroupBudgets.reduce((n,g)=>n+g.steps,0)+2<140);
 assert.equal(new Set(delegatedCredentialsNativeGroupBudgets.map(g=>g.name)).size,8);assert(Object.values(p).every(v=>/^[0-9a-f-]{36}$/.test(v)));
 for(const token of['native.connect({lifetimeMs:90000})','++rpcs<=90','++steps<=140','pendingStep=dispatched','await connection.close()','rollbackRestored:true'])assert(source.includes(token),token);
 assert.doesNotMatch(source,/initdb|createdb|pg_ctl|browser\.launch|session_replication_role|disable trigger|fakeTimers|setSystemTime|process\.argv|commit;/);
});
test('207 bad owned context rejects before any process, DB or source load',async()=>{
 for(const ctx of[undefined,{}, {d:{syntheticOnly:false},h:{syntheticOnly:true}}])await assert.rejects(verifyDelegatedCredentialsNative(ctx));
});
test('207 actual five named RPC parameters preserve material position, no owner/private authority wire',()=>{
 const q={siteId:delegatedCredentialsNativeSite,grantId:p.role,mode:'context',operationId:null},args={p_query:q,p_auth_user_id:p.delegateAuth,p_command:null,p_allow_write:false,p_material:null};
 const expr=delegatedCredentialsNativeRpcExpression('faolla_attendance_delegated_pin_v1',args);assert.match(expr,/p_allow_write=>false,p_material=>null\)$/);
 assert.match(delegatedCredentialsNativeRpcExpression('faolla_attendance_independent_admin_v1',{p_site:delegatedCredentialsNativeSite,p_auth:p.delegateAuth,p_query:{siteId:delegatedCredentialsNativeSite,mode:'detail',subjectId:p.subject},p_command:null,p_material:null,p_allow_new:false}),/p_material=>null,p_allow_new=>false\)$/);
 for(const changed of[{...args,p_owner:p.employeeAuth},{...args,p_grant_id:p.role},{...args,p_allow_write:'true'},{...args,p_auth_user_id:'system'}])assert.throws(()=>delegatedCredentialsNativeRpcExpression('faolla_attendance_delegated_pin_v1',changed));
 assert.throws(()=>delegatedCredentialsNativeRpcExpression('faolla_attendance_delegated_credentials_member_core_v1',args));
 assert.throws(()=>delegatedCredentialsNativeRpcExpression('faolla_attendance_management_delegations_v1',args));
});
test('207 all six action forms pass frozen production DTO, independent lifecycle setup uses old196 command parser',()=>{
 const {parseDelegatedTerminalCommand,parseDelegatedPinCommand}=require('../../src/lib/merchantAttendanceDelegatedCredentials.ts');
 const {parseIndependentCommand}=require('../../src/lib/merchantAttendanceIndependent.ts');
 const reason='Synthetic207 actual scoped action',operationId=p.role;
 const terminal={operationId,terminalId:p.terminal,locationId:p.location,reason};
 assert.equal(parseDelegatedTerminalCommand({...terminal,action:'terminal_prepare',label:'Synthetic207 ordinary terminal',pairHash:'a'.repeat(64)}).action,'terminal_prepare');
 assert.equal(parseDelegatedTerminalCommand({...terminal,action:'terminal_revoke'}).action,'terminal_revoke');
 for(const action of['pin_issue','pin_revoke']){
  assert.equal(parseDelegatedPinCommand({kind:'member_pin',action,operationId,workerId:p.worker,employeeId:p.employee,employeeAuthUserId:p.employeeAuth,workerNo:'SYNTHETIC207-MEMBER',expectedRevision:2,reason}).action,action);
  assert.equal(parseDelegatedPinCommand({kind:'independent_pin',action,operationId,workerId:p.independentWorker,subjectId:p.subject,expectedSubjectRevision:4,expectedGeneration:1,expectedWorkerVersion:4,expectedSettingsVersion:4,expectedCredentialRevision:1,reason}).action,action);
 }
 assert.equal(parseIndependentCommand({action:'create',operationId,subjectId:p.subject,workerId:p.independentWorker,expectedSettingsVersion:4,workerNo:'SYNTHETIC207-INDEPENDENT',displayName:'Synthetic207 independent',locationId:p.location,startsOn:'2000-01-01',reason}).action,'create');
 for(const action of['enable','disable'])assert.equal(parseIndependentCommand({action,operationId,subjectId:p.subject,expectedSubjectRevision:2,expectedGeneration:0,expectedWorkerVersion:2,expectedSettingsVersion:4,reason}).action,action);
});
test('207 independent lifecycle next CAS uses strict196 write receipts, never a nonexistent detail subject or extra read',async()=>{
 const {INDEPENDENT_ADMIN_PROTOCOL,parseIndependentAdminResult,parseIndependentCommand,independentAdminCommandFingerprint}=require('../../src/lib/merchantAttendanceIndependent.ts');
 const siteId=delegatedCredentialsNativeSite,actor=p.delegateAuth,query={siteId,mode:'detail',subjectId:p.subject},at='2026-10-09T12:00:00.000001Z',settingsVersion=43;
 const create=parseIndependentCommand({action:'create',operationId:p.role,subjectId:p.subject,workerId:p.independentWorker,expectedSettingsVersion:settingsVersion,
  workerNo:'SYNTHETIC207-INDEPENDENT',displayName:'Synthetic207 independent',locationId:p.location,startsOn:'2000-01-01',reason:'Synthetic207 real196 independent create'});
 const result=async(command,subjectRevision,generation,workerVersion)=>parseIndependentAdminResult({protocol:INDEPENDENT_ADMIN_PROTOCOL,siteId,actorId:actor,readAt:at,settingsVersion,data:{kind:'receipt'},
  receipt:{operationId:command.operationId,subjectId:p.subject,workerId:p.independentWorker,action:command.action,actorId:actor,subjectRevision,generation,workerVersion,credentialRevision:command.action==='disable'?0:null,recordedAt:at,
   commandFingerprint:await independentAdminCommandFingerprint(siteId,actor,command)}},query,actor,command);
 let state=await result(create,1,0,1);
 for(const [action,operationId,revision,generation]of [['enable',p.plainRole,1,0],['disable',p.delegate,2,0],['enable',p.delegateAuth,3,1]]){
  assert.deepEqual(state.data,{kind:'receipt'});assert.equal(state.data.subject,undefined);
  const command=delegatedCredentialsNativeIndependentChange(action,operationId,state);assert.deepEqual(parseIndependentCommand(command),command);
  assert.equal(command.expectedSubjectRevision,revision);assert.equal(command.expectedGeneration,generation);assert.equal(command.expectedWorkerVersion,revision);assert.equal(command.expectedSettingsVersion,settingsVersion);
  state=await result(command,revision+1,generation+(action==='disable'?1:0),revision+1);
 }
 assert.equal(state.receipt.subjectRevision,4);assert.equal(state.receipt.generation,1);assert.equal(state.receipt.workerVersion,4);
 for(const bad of [{...state,data:{kind:'detail'}},{...state,receipt:null},{...state,receipt:{...state.receipt,workerId:p.worker}}])assert.throws(()=>delegatedCredentialsNativeIndependentChange('enable',p.plain,bad));
 assert(source.includes('const independentChange=action=>delegatedCredentialsNativeIndependentChange(action,next(),independentState)'));
 assert(!source.includes('expectedSubjectRevision:independentState.data.subject'));
});
test('207 actual owner seven-row seed, real202 grants and old NULL core writers, no direct credential/audit/proof rows',()=>{
 for(const token of['seedRows:7','createDelegatedCredentialsService','executeManagementDelegation','executeAttendanceAdmin','createIndependentAttendanceService',
  "for(const action of['enable','disable','enable'])",'independentState.data.subject.generation,1','legacy104_NULL_owner_create','legacy106_NULL_owner_',
  "grant('terminal_prepare'","grant('terminal_revoke'","grant('pin_issue',memberScope)","grant('pin_revoke',memberScope)","grant('pin_issue',independentScope(1))","grant('pin_revoke',independentScope(1))"])assert(source.includes(token),token);
 assert.doesNotMatch(source,/insert into public\.merchant_attendance_(?:pin_|terminal_|terminals|independent_|management_|delegated_credential_|workers|locations|employment_periods)/);
 for(const cap of['attendance.terminals.pair','attendance.terminals.revoke','attendance.pin.issue','attendance.pin.revoke','attendance.self.view','attendance.self.clock'])assert(source.includes(cap));
 assert(!source.includes('attendance.pin.manage'));assert(!source.includes('p_auth=>d.owner'));
});
test('207 historical device issuer is real pair/read after grant revoke; actual revoke still stops issued terminal',()=>{
 for(const token of['actual104_pair_after207_prepare','actual104_device_survives_management_grant_revoke','revoke management not issued device','device.terminal.state,\'active\'',
  'actual207_prepare_three_real_proofs','faolla_attendance_delegated_credentials_issuer_v1','terminalRevoke={action:\'terminal_revoke\'','tr.receipt.reference.auditAction,\'revoke\'','actual104_explicit_revoke_stops_device'])assert(source.includes(token),token);
 assert.doesNotMatch(source,/auditOrdinal|device_expires_at\s*=|update public\.merchant_attendance_terminals/);
});
test('207 deterministic verifier doubles do zero scrypt, actual same/different PIN POSTs count all prereads and recheck material',()=>{
 for(const token of['verifierDoubleCalls++','memberVerifier:async','independentMaterial:async','independentAttendanceMaterialCommitment','realKdfCalls:0',
  "await pin(g,c,'12345678')","await deny(pin(g,c,'87654321'),'attendance_operation_conflict')",'replayOps.add(c.operationId)','replay:c!==null&&replayOps.has(c.operationId)',
  'assert.equal(verifierDoubleCalls,before)','same_original_body_conflict','already_revoked_terminal_is_not_new_sidecar','already_revoked_member_PIN_is_not_new_sidecar','already_revoked_independent_PIN_is_not_new_sidecar'])assert(source.includes(token),token);
 assert.doesNotMatch(source,/scrypt\(|deriveAttendancePin\(|deriveIndependentAttendanceIssuePin\(/);
 assert(source.includes('expectedGeneration:generation'));assert(source.includes('ir.receipt.reference.generation,2'));assert(source.includes('ir.receipt.reference.credentialRevision,2'));
});
test('207 actual delegate epoch pause/restore does not revive oldgrant; minimal original receipt survives',()=>{
 for(const token of["await status('disabled')","await status('active')",'faolla_update_merchant_enterprise_employee_v1(prepared_command)','faolla_attendance_account_suspensions_v1',
  'expectedGeneration:1','generation=1 and paused','employeeId:p.delegate,employeeAuthUserId:p.delegateAuth','recoverPin(memberIssueGrant,memberIssue)',"restore('dc207_epoch',branch)",
  'offNode.executeTerminal','offNode.executePin','await legacy(\'settings\',{timeZone:\'UTC\',enabled:false'])assert(source.includes(token),token);
 assert.doesNotMatch(source,/update public\.merchant_attendance_account_epochs|insert into public\.merchant_attendance_account_epochs|update public\.merchant_enterprise_employees/);
});
test('207 unique AFTER23514 within savepoint proves whole3ledger rollback; full old row/catalog/archive protection',()=>{
 const fault=delegatedCredentialsNativeFaultSql(p.role);for(const token of['synthetic207_owned_late_credentials_fault_v1','after insert on public.merchant_attendance_management_delegation_operations',"errcode='23514'","constraint='synthetic207_owned_late_credentials_fault'"])assert(fault.includes(token),token);
 assert.doesNotMatch(fault,/create or replace|alter table|disable trigger|delete from|truncate|update public\./);assert.throws(()=>delegatedCredentialsNativeFaultSql(p.role,'99990206'));
 for(const token of['dc207_old_row_changed:','dc207_external_scope_added:','dc207_unrelated_table_changed','dc207_read_rejection_replay_wrote',"lastRpc.sqlstate,'23514'",'fault_catalog_exact_restored',
  "restore('dc207_fault',branch)",'dc207_full_rollback_facts','d.definitions(),definitions','d.tableCatalog(),catalog','periodContinuationArchiveBytes(await archive())','periodContinuationArchiveBytes(await periodArchive())',
  'dc207_clock_source_side_effect','authority.actor_auth_user_id=','faolla_attendance_delegated_credentials_proof_v1(authority,false)','realAuth:false','production:false'])assert(source.includes(token),token);
 assert(source.includes('Never put input material'));assert(source.includes("filter(s=>/^(?:PL\\/pgSQL|SQL) function /.test(s))"));
});

test('207 pending lifetime cleanup closes before settlement and all protections, preserving the original stage and cause',async()=>{
 const events=[],cause=new Error('original_Node_deadline'),primary=new Error('delegated_credentials_native_stage:actual_pin_issue:steps=75:rpcs=60',{cause});let rejectPending;
 const pending=new Promise((_,reject)=>{rejectPending=reject;}),connection={close:async()=>{events.push('close');rejectPending(new Error('attendance_concurrency_lifetime'));},step:()=>assert.fail('cleanup SQL must not run')};
 const protections=['facts','definitions','catalog','archive155','archive207'].map(label=>[label,()=>{events.push(label);if(label==='facts')throw new Error('secondary_facts_mismatch');}]);
 await delegatedCredentialsNativeCleanup(connection,pending,protections,primary);
 assert.deepEqual(events,['close','facts','definitions','catalog','archive155','archive207']);assert.equal(primary.cause,cause);
 assert(primary.message.startsWith('delegated_credentials_native_stage:actual_pin_issue:steps=75:rpcs=60'));
 assert.match(primary.message,/cleanup_secondary:pending:attendance_concurrency_lifetime\|facts:secondary_facts_mismatch/);
 assert.match(primary.stack,/secondary_facts_mismatch/);assert(source.includes('primaryError=failure(error);throw primaryError;'));
 assert(source.includes('],primaryError);'));assert(!source.includes("connection.step(scope.sql('rollback;'))"));
});

test('207 cleanup without a primary refuses late transport and protection errors but attempts all five checks',async()=>{
 const events=[],pending=Promise.reject(new Error('late_SQL_failure'));
 const protections=['facts','definitions','catalog','archive155','archive207'].map(label=>[label,()=>{events.push(label);if(label==='catalog')throw new Error('catalog_mismatch');}]);
 await assert.rejects(delegatedCredentialsNativeCleanup({close:async()=>{events.push('close');}},pending,protections),error=>error instanceof AggregateError
  &&error.errors.length===2&&error.message.includes('pending:late_SQL_failure')&&error.message.includes('catalog:catalog_mismatch'));
 assert.deepEqual(events,['close','facts','definitions','catalog','archive155','archive207']);
});

test('207 normal cleanup closes once without SQL; its original budgeted normal rollback stays explicit',async()=>{
 const events=[],protections=['facts','definitions','catalog','archive155','archive207'].map(label=>[label,()=>events.push(label)]);
 await delegatedCredentialsNativeCleanup({close:async()=>{events.push('close');},step:()=>assert.fail('cleanup SQL forbidden')},null,protections);
 assert.deepEqual(events,['close','facts','definitions','catalog','archive155','archive207']);
 assert(source.includes("await step('rollback','rollback;')"));assert(source.includes('catch(error){throw failure(error);}'));
 const previous=readFileSync(new URL('./attendance-delegated-rules-native.mjs',import.meta.url),'utf8');
 const extract=text=>text.slice(text.indexOf(' const failures=[],settled='),text.indexOf('\nexport async function verify'));
 assert.equal(extract(source).replaceAll('delegated_credentials_native_cleanup','delegated_rules_native_cleanup'),extract(previous));
});
