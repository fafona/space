//209 PURE/SOURCE only. These tests neither start SQL nor claim business proof.
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {delegatedPlanExceptionsNativeSite as site,delegatedPlanExceptionsNativeIds as p,delegatedPlanExceptionsNativeGroupBudgets as budgets,
 delegatedPlanExceptionsNativeRpcExpression as rpc,delegatedPlanExceptionsNativeDecision as decision,
 delegatedPlanExceptionsNativeLegacyReviewArgs as legacyArgs,
 delegatedPlanExceptionsNativeHistorySql as history,delegatedPlanExceptionsNativeFaultSql as fault,verifyDelegatedPlanExceptionsNative as verify} from './attendance-delegated-plan-exceptions-native.mjs';
const require=createRequire(import.meta.url),source=readFileSync(new URL('./attendance-delegated-plan-exceptions-native.mjs',import.meta.url),'utf8');
test('209 import is inert, eight bounded groups and no parent sealed business target',async()=>{
 assert.equal(site,'99990209');assert.equal(budgets.length,8);assert.equal(budgets.reduce((n,g)=>n+g.rpcs,0),90);
 assert(budgets.reduce((n,g)=>n+g.steps,0)+2<=140);for(const value of Object.values(p))assert.match(value,/^[0-9a-f-]{36}$/);
 for(const token of ['native.connect({lifetimeMs:90000})','Date.now()+120000','++steps<=140','++rpcs<=90',"await step('rollback','rollback;')",
  'executeAttendanceAdmin','executeRules','executePlanRuleApprovals','parseScheduleResult','executeManagementDelegation','executeLeave','projectPlanPosthocResult',
  'createDelegatedPlanExceptionsService','parsePlanExceptionResult','actualPastPublication:false','actualPastApproval:false','syntheticHistoricalInputRows:33',
  'newSealBusinessCases:0','realAuth:false,browser:false,kdf:false,production:false'])assert(source.includes(token),token);
 assert.doesNotMatch(source,/initdb|createdb|pg_ctl|session_replication_role|disable trigger|fakeTimers|setSystemTime|process\.argv|commit;|sealed\s*=\s*true/);
 assert.doesNotMatch(source,/h\.(?:slot|workerId|employeeId|employeeAuthUserId|query)/);
 for(const ctx of [undefined,{}, {d:{syntheticOnly:false},h:{syntheticOnly:true}}])await assert.rejects(verify(ctx));
});
test('209 real Node fresh POST dispatch forecast counts recovery/context/write, not just business writes',()=>{
 //Every addend names actual dispatches, not elapsed-time forecasts or mocks.
 const freshPost=3,keep=1+freshPost,recover=1,read=1;
 const forecast=[4+2+1+1+2+read+freshPost,
  4*(read+1)+recover,
  read+1+read+freshPost+recover+keep,
  4*read+3+read+read,
  read+3+recover+1+1+read+read+1+freshPost+3+2+read+read+1+freshPost+read,
  1+read+recover+1+read+recover+2*recover+1+recover,
  freshPost+recover+freshPost,
  1+read+2*recover+recover];
 assert.deepEqual(forecast,[14,9,11,9,25,10,7,5]);assert.equal(forecast.reduce((a,b)=>a+b,0),90);
 assert.deepEqual(budgets.map(g=>g.rpcs),forecast);assert(source.includes('actual.rpcs<=spec.rpcs&&actual.steps<=spec.steps'));
});
test('209 seven named args bind actual actor and reject private cores, owner substitution and guessed gate fields',()=>{
 const args={p_query:{siteId:site,grantId:p.role,mode:'context',workerId:p.worker,slotId:p.location},p_auth_user_id:p.delegateAuth,
  p_command:null,p_allow_write:true,p_allow_posthoc:false,p_allow_clearance:false,p_capture_notifications:false};
 const expression=rpc('faolla_attendance_delegated_plan_exceptions_v1',args);assert(expression.includes('p_auth_user_id=>'));assert(expression.endsWith('p_capture_notifications=>false)'));
 for(const bad of [{...args,p_owner:p.employeeAuth},{...args,p_grant_id:p.role},{...args,p_material:{}},{...args,p_allow_posthoc:'true'},{...args,p_capture_notifications:1}])assert.throws(()=>rpc('faolla_attendance_delegated_plan_exceptions_v1',bad));
 assert.throws(()=>rpc('faolla_attendance_delegated_plan_exceptions_posthoc_core_v1',args));
 const m=require('./attendance-delegated-plan-exceptions-model.ts').delegatedPlanExceptionsModel();
 const c=decision(m.context,'confirmed',p.role);assert.equal(Object.keys(c).length,7);assert.equal(c.expectedRevision,m.command.expectedRevision);assert.equal(c.expectedFingerprint,m.command.expectedFingerprint);
 assert.throws(()=>decision(m.context,'annul',p.role));assert.throws(()=>decision(m.context,'cleared',p.role));
});
test('209 legacy original receipt recover sends NULL command, query keeps original number and strict DTO retains complete expected command',()=>{
 const m=require('./attendance-delegated-plan-exceptions-model.ts').delegatedPlanExceptionsModel(),c=decision(m.context,'confirmed',p.role);
 const detail=legacyArgs(site,p.delegateAuth,p.worker,p.location),write=legacyArgs(site,p.delegateAuth,p.worker,p.location,c),recover=legacyArgs(site,p.delegateAuth,p.worker,p.location,c,'recover');
 assert.equal(detail.p_command,null);assert.equal(detail.p_query.operationId,null);assert.equal(detail.p_query.mode,'detail');
 assert.equal(write.p_command,c);assert.equal(write.p_query.operationId,c.operationId);assert.equal(write.p_query.mode,'decide');
 assert.equal(recover.p_command,null);assert.equal(recover.p_query.operationId,c.operationId);assert.equal(recover.p_query.mode,'recover');
 assert.deepEqual(Object.keys(c).sort(),['operationId','expectedRevision','expectedFingerprint','employeeId','employeeAuthUserId','outcome','note'].sort());
 assert(rpc('faolla_attendance_plan_exception_posthoc_review_v1',recover).includes('p_command=>null'));
 assert(source.includes('parsePlanExceptionResult(raw.data,args.p_query,{authUserId:d.owner},command)'));
 assert.throws(()=>legacyArgs(site,p.delegateAuth,p.worker,p.location,null,'recover'));
 assert.throws(()=>legacyArgs(site,p.delegateAuth,p.worker,p.location,c,'detail'));
 assert.throws(()=>legacyArgs('99990208',p.delegateAuth,p.worker,p.location,c,'recover'));
});
test('209 33 explicitly disclosed guarded historical inputs never fabricate case, decision, grant or sidecar',()=>{
 const sql=history(site,p.delegateAuth,p);assert(sql.includes('for seed in 0..3 loop'));assert(sql.includes('if seed<3 then'));
 assert.equal((sql.match(/insert into public\./g)||[]).length,9);
 const expected=['schedule_commands','schedule_slots','schedule_publication_evidence','plan_rule_artifacts','plan_rule_operations','plan_rule_streams','events','shift_schedule_relations','shift_plan_adoptions'];
 for(const table of expected)assert(sql.includes('insert into public.merchant_attendance_'+table));
 assert.doesNotMatch(sql,/insert into public\.merchant_attendance_(?:plan_exception|management_delegation|event_notification|leave_)/);
 assert(sql.includes("when seed=0 then 'unverified' else 'linked'"));assert(sql.includes('Synthetic209 historical template, not actual past publication'));
 assert.doesNotMatch(sql,/disable trigger|create or replace|alter table|update public\.|delete from|truncate|set_config|clock_timestamp\(\)\s*:=/);
 assert.throws(()=>history('99990208',p.delegateAuth,p));
});
test('209 real grant cutoff/old CAS/gates/lowest-disclosure originals, disable and revoke recover but Auth rebind rejects',()=>{
 for(const token of ["defaultGrant=await grant(false)","includeGrant=await grant(true)","run(uid(241),null,defaultGrant)",'synthetic209_lost_POST_response',
  'actual209_wrong_target_worker','actual209_wrong_merchant_grant','actual209_missing_real_slot','run(uid(201))','synthetic_new_target_auth_rebinding_only',
  'actual209_no_adopt_owner_decision','attendance_plan_exception_review_source_changed','actual209_independent_clearance_flagoff','actual209_independent_posthoc_flagoff',
  "action:'revoke'","await status('disabled')",'generation=1 and paused','synthetic_original_delegate_auth_binding_changed','recover(confirmedCommand,includeGrant,p.otherAuth)',
  'Object.keys(receipt).sort()',"allowWrite:false",'replayOps.add(notApplicableCommand.operationId)'])assert(source.includes(token),token);
 assert.doesNotMatch(source,/update public\.merchant_attendance_account_epochs|insert into public\.merchant_attendance_account_epochs/);
 assert(source.includes("filter(s=>/^(?:PL\\/pgSQL|SQL) function /.test(s))"));
});
test('209 one owned AFTER23514 fault keeps all real guards and full three-ledger/notification/catalog/facts/archive protections',()=>{
 const sql=fault(p.role);for(const token of ['synthetic209_owned_late_exception_fault_v1','after insert on public.merchant_attendance_management_delegation_operations',"errcode='23514'","constraint='synthetic209_owned_late_exception_fault'"])assert(sql.includes(token));
 assert.throws(()=>fault(p.role,'99990208'));assert.doesNotMatch(sql,/create or replace|alter table|disable trigger|delete from|truncate|update public\./);
 for(const token of ['ex209_read_rejection_replay_wrote','ex209_unrelated_table_changed','ex209_old_row_changed:','ex209_external_scope_added:',
  'failed209_case_entry_sidecar_notification_complete_rollback','all_notification_tables_before_fault',"lastRpc.sqlstate,'23514'",'owned209_fault_catalog_exact_restored',
  "restore('ex209_fault',branch)",'atomicReceipt=(await run(uid(241),atomicCommand)).receipt','faolla_attendance_delegated_plan_exceptions_operation_v1(authority,false)',
  'ex209_full_rollback_facts','ex209_full_rollback_function_OID_ACL','ex209_full_rollback_catalog','periodContinuationArchiveBytes(await archive())','periodContinuationArchiveBytes(await periodArchive())'])assert(source.includes(token),token);
});
