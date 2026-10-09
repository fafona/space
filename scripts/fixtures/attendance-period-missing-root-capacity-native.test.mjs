// Pure/static fixture checks only, not PostgreSQL execution evidence.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {verifyPeriodMissingRootCapacityNative} from './attendance-period-missing-root-capacity-native.mjs';
const text=readFileSync(new URL('./attendance-period-missing-root-capacity-native.mjs',import.meta.url),'utf8');
const has=(...parts)=>{for(const part of parts)assert(text.includes(part),part);};

test('inert diagnostic accepts only the caller-owned synthetic153 namespace',async()=>{
  assert.equal(typeof verifyPeriodMissingRootCapacityNative,'function');
  await assert.rejects(verifyPeriodMissingRootCapacityNative({d:{syntheticOnly:false}}));
  has('assertLifecycleSandbox','assert.deepEqual(owned,d.owned)','assert.equal(owned.schema,scope.schema)',
    'h.syntheticHistoricalRows===10',"'root_capacity_requires153'","'root_capacity_before_period_creation'",
    "'root_capacity_empty_missing_history'","'root_capacity_existing_request_permission'","'root_capacity_enabled_triggers'");
  assert.doesNotMatch(text,/child_process|spawn\(|execFile|process\.env|process\.argv|statement_timeout|lock_timeout|disable trigger|session_replication_role|pg_sleep/i);
});
test('one bounded rollback protects other tables and restores all facts, definitions and catalog',()=>{
  has("['begin;'+prefix+initial+marker('protected_before',protectedHash)","'set constraints all immediate;rollback;'",
    'steps.length<=26','outerRollbackTransactions:1','d.fingerprint(),baseline','d.definitions(),definitions','d.tableCatalog(),catalog',
    "'root_capacity_protected_facts'","const writable=['merchant_attendance_correction_controls','merchant_attendance_missing_requests','merchant_attendance_missing_entries']");
  assert.doesNotMatch(text,/\bcommit;|create(?: or replace)? function|alter table|drop table|truncate table|delete from public\.|update public\./i);
});
test('actual103 creates approved parent then withdrawn and rejected outside children',()=>{
  has('public.faolla_attendance_missing_v1(',"action:revise?'revise':'submit'",'supersedesRequestId:a,expectedApprovalOperationId:aa',
    "submit(a)","decide(a,aa,'approve')","submit(b,true)","action:'withdraw'","submit(c,true)","decide(c,ct,'reject')",
    "'root_capacity_real_decision_eligible'",'offset(h.slot.startAt,-120)','offset(h.slot.startAt,1320)',
    'actualMissingWriteCalls:6,actualMissingReviewReads:2,actualPolicyWriteCalls:1');
  assert(text.indexOf("oracle(1)+reads('root1')")<text.indexOf('submit(b,true)'),'root1 read occurs before historical children');
  assert.doesNotMatch(text,/mockResult|fakeArtifact|rpc:\s*async/);
});
test('private version reads are setup-only while every actual writer still runs as service_role',()=>{
  has('const versions=JSON.parse(d.exec(',"'root_capacity_safe_settings_version'","'root_capacity_safe_policy_revision'",
    'Number.isSafeInteger(versions.settingsVersion)','Number.isSafeInteger(versions.policyRevision)',
    'policyRevision=previousPolicyRevision+1',"'root_capacity_prepared_versions_stable'","'root_capacity_actual_policy_revision'",
    'expectedRevision:previousPolicyRevision,expectedSettingsVersion:settingsVersion',
    'expectedSettingsVersion:settingsVersion,expectedPolicyRevision:policyRevision',
    "prefix+'set local role service_role;'+setPolicy+prefix+policyChecked",
    "prefix+'set local role service_role;'+submit(a)","prefix+'set local role service_role;'+submit(b,true)",
    "prefix+'set local role service_role;'+submit(c,true)");
  assert.doesNotMatch(text.slice(text.indexOf('const setPolicy='),text.indexOf('const policyChecked=')),/select\s|from public\./i);
  assert.doesNotMatch(text.slice(text.indexOf('const submit='),text.indexOf('const decide=')),/select\s|from public\./i);
  assert.doesNotMatch(text,/grant\s|revoke\s/i);
});
test('density preserves paired receipts with deferred validation reset at each batch',()=>{
  has('const copy=(first,last)=>`set constraints all deferred;do $root_capacity_copy$',
    'insert into public.merchant_attendance_missing_requests select (r).*',
    'insert into public.merchant_attendance_missing_entries select (first_entry).*',
    'insert into public.merchant_attendance_missing_entries select (terminal).*',
    'end;$root_capacity_copy$;set constraints all immediate;',"assert terminal.action='withdraw'",
    "jsonb_build_object('operationId',new_id)","jsonb_build_object('operationId',new_op,'requestId',new_id)",
    'first<=97;first+=10','prefix+copy(98,98)','syntheticWithdrawnChildCopies:98');
  assert.doesNotMatch(text,/r\.(supersedes_request_id|supersedes_operation_id|root_request_id|actor_auth_user_id)\s*:=/);
});
test('oracle distinguishes total root rows from historical children and relevant pending count',()=>{
  has('coalesce(root_request_id,request_id)=${quote(a)}','and start_at<','and end_at>',
    "terminal.revision=2","e.action='withdraw'","e.action='reject'",
    'roots=${total} and related=1 and pending=0',"'root_capacity_parent_still_current'",
    '[[1,0,1,0],[100,99,1,0],[101,100,1,0]]','rootRows:[1,100,101],historicalChildren:[0,99,100]');
});
test('four independent actual entrypoints retain per-read hashes, exact reports and real projection',()=>{
  has('public.faolla_attendance_unified_report_v1(', 'public.faolla_attendance_period_source_v1(',
    "['owner','self'].flatMap(access=>['report','source'].map(kind=>read(label,access,kind)))",
    "'before_read'","'after_read'","'root_capacity_read_wrote_rows'",
    'rawReport.missing.map(item=>item.requestId),[a]','rawReport.missing[0].proposal,inside',
    'rawReport.base.items[0].startEventId,h.startEventId','parseUnifiedSource(rawReport,uq(access))',
    'parsed.totals.missingSelected.workedUs,3600000000','projectPeriodClosureSource(raw,',
    'withoutObservation(raw.report),withoutObservation(rawReport)','assert.equal(successfulReads,10)');
});
test('root1 and root100 canonical evidence match owner/self without adding terminal child context',()=>{
  has('digest(raw.sourceText),raw.sourceFingerprint','JSON.parse(raw.sourceText),raw.sourceCanonical',
    "Buffer.byteLength(raw.sourceText,'utf8')<=1048576","Buffer.byteLength(JSON.stringify(raw),'utf8')<=4194304",
    'raw.context.missing.map(item=>item.requestId),[a]','raw.context.missing[0].isCurrentApproved,true',
    "raw.blockers.includes('pending_missing'),false",'group.ownersource.sourceFingerprint,group.selfsource.sourceFingerprint',
    'group.ownersource.sourceCanonical,group.selfsource.sourceCanonical',"fingerprints.root1,fingerprints.root100,'root_history_changed_semantic_source'");
});
test('root101 old reports still pass while only source raises its exact capacity error with zero writes',()=>{
  has("oracle(101)+read('root101','owner','report')+read('root101','self','report')+failedSource('owner')+failedSource('self')",
    'set local role service_role;do $root_capacity_reject$',"sqlerrm<>'attendance_period_source_too_large'",
    "'before_failure'","'after_failure'","'root_capacity_failed_read_wrote_rows'",'expectedSourceRejections:2',
    "diagnosticOnly:true,readerVersion:'153'",'readerFixed:false','callerOwnsRuntimeAndCleanup:true',
    '98 constrained copies','Root100 means parent1+historicalchildren99');
  assert.doesNotMatch(text,/attendance_report_too_large|boundClockMigrationBody|sourceCanonical\s*=/);
});
