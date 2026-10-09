//208 finite pure/SOURCE tests only; no database, KDF, browser or real Auth.
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {delegatedRevisionsNativeSite,delegatedRevisionsNativeIds,delegatedRevisionsNativeGroupBudgets,delegatedRevisionsNativeRpcExpression,
 delegatedRevisionsNativeDecision,delegatedRevisionsNativeSubmit,delegatedRevisionsNativeFaultSql,delegatedRevisionsNativeCleanup,verifyDelegatedRevisionsNative} from './attendance-delegated-revisions-native.mjs';
const require=createRequire(import.meta.url),source=readFileSync(new URL('./attendance-delegated-revisions-native.mjs',import.meta.url),'utf8'),p=delegatedRevisionsNativeIds;
test('208 exactly eight bounded rollback groups, actual source writers only and honest seal boundary',async()=>{
 assert.equal(delegatedRevisionsNativeSite,'99990208');assert.equal(delegatedRevisionsNativeGroupBudgets.length,8);
 assert(delegatedRevisionsNativeGroupBudgets.reduce((n,g)=>n+g.rpcs,0)<=90);assert(delegatedRevisionsNativeGroupBudgets.reduce((n,g)=>n+g.steps,0)+2<=140);
 for(const value of Object.values(p))assert.match(value,/^[0-9a-f-]{36}$/);
 for(const token of['native.connect({lifetimeMs:90000})','++rpcs<=90','++steps<=140','Date.now()+120000','pendingStep=dispatched','await connection.close()',
  'executeAttendanceAdmin','executeCorrectionControls','executeAttendanceSelf','executeAttendanceCorrection','executeCurrentCorrectionDecision','executeRevisionCycle','executeRevisionApprovalReview','executeRevisionDecision',
  'executeManagementDelegation','createDelegatedRevisionsService','newSealBusinessCases:0','rawClockUnchanged:true','actual202_self_approval_grant_refused','allNotificationTablesProtected:true'])assert(source.includes(token),token);
 assert.doesNotMatch(source,/initdb|createdb|pg_ctl|browser\.launch|session_replication_role|disable trigger|fakeTimers|setSystemTime|process\.argv|commit;|sealed\s*=\s*true/);
 assert.doesNotMatch(source,/insert into public\.merchant_attendance_(?:events|revision_|correction_|effect_|management_|workers|locations|employment_periods)/);
 for(const ctx of[undefined,{}, {d:{syntheticOnly:false},h:{syntheticOnly:true}}])await assert.rejects(verifyDelegatedRevisionsNative(ctx));
});
test('208 named four-parameter bridge binds actual actor, old submit eight keys and old decision seven keys',()=>{
 const query={siteId:delegatedRevisionsNativeSite,grantId:p.role,mode:'context',requestId:p.worker},args={p_query:query,p_auth_user_id:p.delegateAuth,p_command:null,p_allow_write:true};
 const expression=delegatedRevisionsNativeRpcExpression('faolla_attendance_delegated_revisions_v1',args);assert.match(expression,/p_query=>.+,p_auth_user_id=>.+,p_command=>null,p_allow_write=>true\)$/);
 for(const changed of[{...args,p_owner:p.employeeAuth},{...args,p_material:null},{...args,p_grant_id:p.role},{...args,p_allow_write:'true'},{...args,p_auth_user_id:'system'}])assert.throws(()=>delegatedRevisionsNativeRpcExpression('faolla_attendance_delegated_revisions_v1',changed));
 assert.throws(()=>delegatedRevisionsNativeRpcExpression('faolla_attendance_delegated_revisions_decide_core_v1',args));
 const model=require('./attendance-revision-approval-model.ts'),review=model.revisionApprovalResponse();
 for(const action of['approve','reject']){const c=delegatedRevisionsNativeDecision(review,action,p.role);assert.equal(Object.keys(c).length,7);assert.equal(c.action,action);assert.equal(c.expectedRevision,review.review.submittedRevision);assert.equal(c.expectedEvidence,review.evidenceToken);assert.equal(c.expectedBaseOperationId,review.current.operationId);}
 assert.throws(()=>delegatedRevisionsNativeDecision(review,'annul',p.role));
 const prepared={revision:3,current:{operationId:p.employee,lineage:{rootOperationId:p.worker}},currentRules:{policy:{revision:1}}};
 const c=delegatedRevisionsNativeSubmit(prepared,p.role,{startAt:'2026-10-01T08:00:00.000000Z',endAt:'2026-10-01T09:00:00.000000Z',breaks:[]});
 assert.equal(Object.keys(c).length,8);assert.equal(c.expectedEffectiveOperationId,p.employee);assert.equal(c.expectedBaseOperationId,p.worker);assert.equal(c.expectedRevision,3);
});
test('208 millisecond self receipt becomes the same instant in the canonical proposal required by the old strict service (mock RPC only)',async()=>{
 const {parseCorrectionProposal}=require('../../src/lib/merchantAttendanceCorrection.ts');
 const {executeAttendanceCorrection}=require('../../src/lib/merchantAttendanceCorrection.server.ts');
 const m=require('./attendance-correction-model.ts'),basis=m.correctionBasis(),requestId=m.correctionId(20);
 const raw={startAt:'2026-09-28T07:59:00.000000Z',endAt:'2026-09-28T16:00:00.000Z',breaks:[]},initialProposal=parseCorrectionProposal(raw);
 assert.equal(initialProposal.endAt,'2026-09-28T16:00:00.000000Z');assert.equal(Date.parse(initialProposal.endAt),Date.parse(raw.endAt));
 assert.equal(initialProposal.startAt,raw.startAt);assert.deepEqual(initialProposal.breaks,raw.breaks);
 assert.notEqual(JSON.stringify(initialProposal),JSON.stringify(raw));
 const command={action:'submit',operationId:requestId,expectedRevision:0,expectedPolicyRevision:1,startEventId:m.correctionStart,
  expectedLastEventId:basis.events.at(-1).id,proposal:initialProposal,reason:'Synthetic208 canonical first correction'};
 const query={siteId:m.correctionSite,mode:'detail',expectedWorkerId:m.correctionWorker,requestId,operationId:null};let calls=0;
 const service={rpc:async(name,args)=>{calls++;assert.equal(name,'faolla_attendance_correction_self_v3');assert.equal(args.p_query.operationId,null);
  return{error:null,data:{siteId:m.correctionSite,employeeId:m.correctionEmployee,workerId:m.correctionWorker,asOf:m.correctionNow,
   canRequest:true,rulesEnforced:true,decisionsAvailable:true,mode:'detail',basis,proposal:initialProposal,reason:command.reason,
   rules:m.correctionRules('bound'),withdrawal:null,item:{requestId,startEventId:m.correctionStart,revision:1,status:'submitted',decision:null,
    submittedAt:m.correctionNow,startAt:initialProposal.startAt,endAt:initialProposal.endAt},
   receipt:{operationId:requestId,requestId,revision:1,action:'submit',recordedAt:m.correctionNow}}};}};
 const input={query,command,authUserId:m.correctionId(99),moduleEnabled:true};
 await assert.rejects(executeAttendanceCorrection({...input,command:{...command,proposal:raw}},service),error=>error.code==='attendance_unavailable');
 const confirmed=await executeAttendanceCorrection(input,service);assert.deepEqual(confirmed.proposal,initialProposal);assert.equal(calls,2);
 assert(source.includes("initialProposal=parseCorrectionProposal({startAt:stamp6(Date.parse(startEvent.occurredAt)-60000),endAt:lastEvent.occurredAt,breaks:[]});rootRequest=next();"));
 assert(source.includes('proposal:initialProposal,reason:'));assert(source.includes('const proposal={...initialProposal,startAt:'));
});

test('208 real original recovery, defaultoff and includePending remain immutable and actor-scoped',()=>{
 for(const token of["grant('approve',false)","grant('reject',true)","lateGrant=await grant('approve',false)","pendingGrant=await grant('approve',true)",
  'dropReplyOperation=approvedCommand.operationId','synthetic208_lost_POST_response','recover(approveGrant,approvedCommand)','recover(pendingGrant,pendingCommand,p.otherAuth)',
  'actual208_no_adopt_existing_owner_decision','expectedEvidence:\'0\'.repeat(32)','expectedBaseOperationId:uid(998)',"{action:'reject'},'attendance_access_denied'",
  'actual208_delegate_generation_captured','generation=1 and paused',"restore('rv208_epoch',epoch)",'actual208_wrong_merchant_grant',
  'offNode.execute','allowWrite:false','replayOps.add(rejectedCommand.operationId)','actual208_three_ledgers_full_actor_proof_appendonly_raw_unchanged'])assert(source.includes(token),token);
 assert.doesNotMatch(source,/update public\.merchant_attendance_account_epochs|insert into public\.merchant_attendance_account_epochs|update public\.merchant_enterprise_employees/);
 assert(source.includes("filter(s=>/^(?:PL\\/pgSQL|SQL) function /.test(s))"));
});
test('208 unique late23514 keeps real guards and verifies all ledgers and notification facts before exact same-number retry',()=>{
 const fault=delegatedRevisionsNativeFaultSql(p.role);for(const token of['synthetic208_owned_late_revision_fault_v1','after insert on public.merchant_attendance_management_delegation_operations',"errcode='23514'","constraint='synthetic208_owned_late_revision_fault'"])assert(fault.includes(token));
 assert.throws(()=>delegatedRevisionsNativeFaultSql(p.role,'99990207'));assert.doesNotMatch(fault,/create or replace|alter table|disable trigger|delete from|truncate|update public\./);
 for(const token of['rv208_read_rejection_replay_wrote','rv208_unrelated_table_changed','rv208_old_row_changed:','rv208_external_scope_added:',
  'all_notification_tables_before_fault','failed208_all_decision_effect_sidecar_and_notifications_absent',"lastRpc.sqlstate,'23514'",'owned_fault_objects_catalog_exact_restored',
  "restore('rv208_fault',branch)",'atomicReceipt=(await run(pendingGrant,pendingCommand.requestId,pendingCommand)).receipt','faolla_attendance_delegated_revisions_operation_v1(authority,false)',
  'rv208_full_rollback_facts','rv208_full_rollback_function_OID_ACL','rv208_full_rollback_catalog','periodContinuationArchiveBytes(await archive())','periodContinuationArchiveBytes(await periodArchive())'])assert(source.includes(token),token);
});
test('208 pending lifetime failure closes before all five protections and preserves primary stage/counts despite secondary errors',async()=>{
 const events=[],primary=new Error('delegated_revisions_native_stage:actual_revision_decision:steps=120:rpcs=88:original_business_error');let rejectPending;
 const pending=new Promise((_,reject)=>{rejectPending=reject;}),connection={close:async()=>{events.push('close');rejectPending(new Error('attendance_concurrency_lifetime'));},step:()=>assert.fail('cleanup must not dispatch rollback SQL')};
 const protections=['facts','definitions','catalog','archive155','archive207'].map(label=>[label,async()=>{events.push(label);if(label==='facts')throw new Error('secondary_facts_mismatch');}]);
 await delegatedRevisionsNativeCleanup(connection,pending,protections,primary);
 assert.deepEqual(events,['close','facts','definitions','catalog','archive155','archive207']);
 assert(primary.message.startsWith('delegated_revisions_native_stage:actual_revision_decision:steps=120:rpcs=88:original_business_error'));
 assert.match(primary.message,/cleanup_secondary:pending:attendance_concurrency_lifetime\|facts:secondary_facts_mismatch/);
 assert.match(primary.stack,/original_business_error/);assert.match(primary.stack,/secondary_facts_mismatch/);
 assert(source.includes('primaryError=failure(error);throw primaryError;'));assert(source.includes('],primaryError);'));
 assert(!source.includes("connection.step(scope.sql('rollback;'))"));
});
test('208 cleanup without primary refuses late transport/protection failure, while still attempting the complete protection set',async()=>{
 const events=[],pending=Promise.reject(new Error('late_SQL_failure'));
 const protections=['facts','definitions','catalog','archive155','archive207'].map(label=>[label,()=>{events.push(label);if(label==='catalog')throw new Error('catalog_mismatch');}]);
 await assert.rejects(delegatedRevisionsNativeCleanup({close:async()=>{events.push('close');}},pending,protections),error=>error instanceof AggregateError
  &&error.errors.length===2&&error.message.includes('pending:late_SQL_failure')&&error.message.includes('catalog:catalog_mismatch'));
 assert.deepEqual(events,['close','facts','definitions','catalog','archive155','archive207']);
});
test('208 close failure also retains primary while all independent protections run',async()=>{
 const events=[],primary=new Error('original_business_error'),protections=['facts','definitions','catalog','archive155','archive207'].map(label=>[label,()=>{events.push(label);if(label==='definitions')throw new Error('definitions_mismatch');}]);
 await delegatedRevisionsNativeCleanup({close:async()=>{events.push('close');throw new Error('close_failure');}},null,protections,primary);
 assert.deepEqual(events,['close','facts','definitions','catalog','archive155','archive207']);
 assert.match(primary.message,/^original_business_error\ndelegated_revisions_native_cleanup_secondary:close:close_failure\|definitions:definitions_mismatch$/);
});
test('208 settled normal cleanup closes once, executes no SQL and retains the explicit budgeted normal rollback',async()=>{
 const events=[],protections=['facts','definitions','catalog','archive155','archive207'].map(label=>[label,()=>{events.push(label);}]);
 await delegatedRevisionsNativeCleanup({close:async()=>{events.push('close');},step:()=>assert.fail('cleanup SQL forbidden')},null,protections);
 assert.deepEqual(events,['close','facts','definitions','catalog','archive155','archive207']);
 assert(source.includes("await step('rollback','rollback;')"));assert(source.includes('catch(error){throw failure(error);}'));
});
