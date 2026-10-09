// Pure fixture contracts, not execution evidence. Root owns actual PostgreSQL.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {verifyPeriodMissingContextNative} from './attendance-period-missing-context-native.mjs';
const text=readFileSync(new URL('./attendance-period-missing-context-native.mjs',import.meta.url),'utf8');
const has=(...parts)=>{for(const part of parts)assert(text.includes(part),part);};

test('inert export rejects wrong version and non-synthetic inputs before connection',async()=>{
  assert.equal(typeof verifyPeriodMissingContextNative,'function');
  await assert.rejects(verifyPeriodMissingContextNative({expected:'150'}),/missing_probe_explicit_version_required/);
  await assert.rejects(verifyPeriodMissingContextNative({expected:'152',d:{syntheticOnly:false}}));
  has('assertLifecycleSandbox','assert.deepEqual(owned,d.owned)','assert.equal(owned.schema,scope.schema)',
    'h.syntheticHistoricalRows===10',"'missing_probe_before_period_creation'","'missing_probe_version_exact'");
  assert.doesNotMatch(text,/child_process|spawn\(|execFile|process\.env|process\.argv|statement_timeout|lock_timeout|disable trigger|session_replication_role|pg_sleep/i);
});
test('separate version calls never install migrations and restore facts, functions and catalog',()=>{
  has("['begin;'+prefix+initial+mark('protected_before')","'set constraints all immediate;rollback;'",
    'statements.length<=60','stepCount<=24','finally{restore(label);}',
    'finally{await connection.close();restore(label);}','d.fingerprint(),baseline','d.definitions(),definitions','d.tableCatalog(),catalog');
  assert.doesNotMatch(text,/\bcommit;|create(?: or replace)? function|alter table|drop table|truncate table|delete from public\./i);
});
test('actual103 A-inside approved B-outside pending proves151 omission and152 complete context',()=>{
  has('public.faolla_attendance_missing_v1(',"action:parent?'revise':'submit'",'supersedesRequestId:parent,expectedApprovalOperationId:approval',
    "terminal(a,aa,'approve')","'actual_outward_pending_and_withdraw'","expected==='151'?[a]:[a,b]",
    "pending(proposed.raw),expected==='152'",'equalTotals(approved,proposed)','approved.raw.sourceFingerprint,withdrawn.raw.sourceFingerprint',
    'proposed.raw.sourceFingerprint===approved.raw.sourceFingerprint');
  has('offset(h.slot.startAt,-120)','offset(h.slot.startAt,1320)',"'missing_actual_decision_eligible'");
});
test('withdraw/reject/approve and reverse moved-in exercise real terminal commands, not mocked outcomes',()=>{
  has("terminal(b,bt,'withdraw')","terminal(b,bt,'reject')","terminal(b,bt,'approve')",
    "'actual_outward_reject'","'actual_outward_approve_preserves_old_report_semantics'","'actual_reverse_moved_in'",
    "assert.deepEqual(current(after.raw),[])",'equalTotals(empty,after)',"assert.deepEqual(current(approved.raw),[b])");
  assert.doesNotMatch(text,/mockResult|fakeArtifact|sampleArtifact|rpc:\s*async/);
});
test('chain scope explicitly checks direct-child-only without claiming recursive lineage completeness',()=>{
  has("'actual_chain_direct_boundary_only'",'submit(c,anotherOutside,b,bt)',"terminal(c,ct,'withdraw')",'submit(t,inside,b,bt)',
    'assert.deepEqual(ids(outsideChild.raw),[a])','assert.equal(pending(outsideChild.raw),false)',
    'assert.deepEqual(ids(insideChild.raw),[a,t])','recursiveWholeRootClaim:false');
});
test('read-only owner/self fingerprints and real legacy report/projected totals are checked',()=>{
  has('faolla_attendance_unified_report_v1(',"const {projectPeriodClosureSource}=require(",
    'digest(raw.sourceText)','JSON.parse(raw.sourceText)','assert.deepEqual(x.sourceCanonical,y.sourceCanonical)',
    'assert.deepEqual(x.report.missing,row.legacy.missing)','assert.deepEqual(x.report.base.items,row.legacy.base.items)',
    'ownerProjection.artifact.report.totals,selfProjection.artifact.report.totals',"'missing_source_read_must_not_write'");
});
test('identity and union-cap negatives keep append-only templates, exact100/101 and failed-read atomicity',()=>{
  has("'outside_child_historical_identity_fails_closed'","reject('old_auth','attendance_period_source_identity_changed')",
    'r.actor_auth_user_id:=',"'exact_union_100_101'",'first<=97;first+=10','copies(98,98)',
    "reject('union_101','attendance_period_source_too_large')",'raw.context.missing.length,100',
    "'missing_failed_read_partial_write'",'insert into public.merchant_attendance_missing_requests select (r).*');
  assert.doesNotMatch(text,/update public\.merchant_attendance_missing_(requests|entries)/);
});
test('actual149 seal rejection follows real Node artifact and successful self confirmation',()=>{
  has("'actual_send_confirm_then_blocked_seal'",'connection=native.connect()',
    'saved=validateRead(observed[1],observed[0],observed[2])','faolla_attendance_period_closure_v1(',
    "closure('owner',command('send',fid(101),0,0),saved.artifact)","closure('self',command('confirm',fid(102),sent.period.revision,1))",
    'assert.equal(confirmed.period.confirmedVersion,1)',"'missing_seal_must_be_confirmed'",
    "sqlerrm<>'attendance_period_blocked'", "'missing_blocked_seal_partial_write'",'not unresolved_dispute and not sealed');
  assert.doesNotMatch(text,/update public\.merchant_attendance_period_closures/);
});
