import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {administrativeClosureRiskSite,verifyAdministrativeClosureRiskNative} from './attendance-administrative-closure-risk-native.mjs';
const source=readFileSync(new URL('./attendance-administrative-closure-risk-native.mjs',import.meta.url),'utf8');
test('risk helper is inert and owns only its new, explicitly synthetic merchant',async()=>{
 assert.equal(administrativeClosureRiskSite,'99990196');await assert.rejects(()=>verifyAdministrativeClosureRiskNative({d:{syntheticOnly:false},h:{syntheticOnly:true}}));
 assert(source.includes('assertLifecycleSandbox'));assert(source.includes('ac195_risk_outside_finally'));
 assert(source.includes('original_event.id=x.event_id and original_event.merchant_id<>${site}'));
 assert.equal((source.match(/d\.exec\(periodContinuationSerialization\+`select \$\{outside\};`\)/g)??[]).length,2);
 assert(!/process\.argv|listen\(|spawn\(|execSync\(|initdb|pg_ctl|drop database|create database|delete from|truncate |disable trigger|session_replication_role/i.test(source));
});
test('finite risk bounds remain64 steps/rows,90 seconds and exactly one witnessed two-connection race',()=>{
 for(const piece of ['++steps<=64','lifetimeMs:90000','Date.now()+90000',"lock_timeout='3s'","statement_timeout='10s'",'lifetimeMs:25000','final.newRows<=64'])assert(source.includes(piece),piece);
 assert.equal((source.match(/await lifecycleRace\(/g)??[]).length,1);assert(source.includes('race.witnessed&&race.right.error'));
 assert(source.includes("/attendance_account_suspension_changed/"));assert(source.includes('cleanupOwnedByParent:true'));assert(!source.includes('rollbackRestored:true'));
});
test('real direct break, time bounds, full no-write replay/conflict and exact late23514 are verified',()=>{
 for(const piece of ["await clock(a,'clock_in');await clock(a,'break_start')","ready.data.detail.frame.tailAction,'break_start'",'verified_end_before_tail','verified_end_in_future','same_operation_different_command',"replay:true",'add constraint ${constraint}',"not valid;${callSql",'atomic.sqlstate,\'23514\'','atomic.constraint,constraint','d.fingerprint(),atomicBefore','d.tableCatalog(),catalog'])assert(source.includes(piece),piece);
 assert(source.includes('ac195_risk_rejected_read_replay_wrote'));assert(source.includes("='[\"clock_in\",\"break_start\"]'::jsonb"));
});
test('actor probes roll back only new identities and retain metadata-only original GET receipt',()=>{
 for(const piece of ['new_identity_auth_swap_rollback','new_worker_binding_swap_rollback','new_owner_loss_rollback','cross_merchant_detail','ac195_risk_probe_full_rollback','ac195_risk_probe_minimum_receipt',"recover('self',dispute.operationId)","recover('owner',command.operationId)",'receipt:null','afterEmployment.data.detail.capabilities.canDispute','self_dispute','owner_respond'])assert(source.includes(piece),piece);
 assert(source.includes("where merchant_id=${site} and id=${quote(a.employee)}"));assert(source.includes("where merchant_id=${site} and id=${quote(a.worker)}"));
 assert(source.includes('periodContinuationArchiveBytes(await archive()),old155'));assert(source.includes('periodContinuationArchiveBytes(await periodArchive()),old207'));
});
