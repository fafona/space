// Pure/static fixture contracts. These are not evidence of PostgreSQL runs.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {verifyPeriodMissingRootRepairNative,verifyPeriodMissingRootRepairInstallNative} from './attendance-period-missing-root-repair-native.mjs';
const text=readFileSync(new URL('./attendance-period-missing-root-repair-native.mjs',import.meta.url),'utf8');
const has=(...parts)=>{for(const part of parts)assert(text.includes(part),part);};

test('both inert exports fail before connection without explicit synthetic ownership',async()=>{
  assert.equal(typeof verifyPeriodMissingRootRepairNative,'function');assert.equal(typeof verifyPeriodMissingRootRepairInstallNative,'function');
  await assert.rejects(verifyPeriodMissingRootRepairNative({d:{syntheticOnly:false}}));
  await assert.rejects(verifyPeriodMissingRootRepairInstallNative({d:{syntheticOnly:false}}));
  has('assertLifecycleSandbox','assert.deepEqual(owned,d.owned)','assert.equal(owned.schema,scope.schema)',
    'h.syntheticHistoricalRows===10',"'repair_exact153'","'repair_before_period_creation'","'repair_empty_missing_history'","'repair_guards_enabled'");
  assert.doesNotMatch(text,/child_process|spawn\(|execFile|process\.env|process\.argv|statement_timeout|lock_timeout|disable trigger|session_replication_role|pg_sleep/i);
});
test('bounded groups retain enabled constraints and per-entrypoint service_role hashes',()=>{
  has('statements.length<=40',"'set constraints all immediate;rollback;'",'finally{restore(label);}',
    'd.fingerprint(),baseline','d.definitions(),definitions','d.tableCatalog(),catalog',
    "'repair_protected_tables'","'before_read'","'after_read'","'before_failure'","'after_failure'","'repair_read_or_failure_wrote'",
    'set local role service_role;do $repair_reject$','allReadsAndFailuresZeroWrites:true','outerRollbackTransactions:4',
    'assert.equal(successfulReads,40);assert.equal(rejectedReads,20)',
    'actualMissingWriteCalls:20,actualMissingReviewReads:8,actualPolicyWriteCalls:4');
  assert.doesNotMatch(text,/\bcommit;|grant\s|revoke\s|alter table|drop table|truncate table|delete from public\.|update public\./i);
});
test('private setup versions never become private subqueries evaluated by service_role',()=>{
  has('const v=JSON.parse(d.exec(', 'Number.isSafeInteger(v.settings)','Number.isSafeInteger(v.policy)',
    "'repair_prepared_versions_stable'","'repair_actual_policy_revision'",'expectedSettingsVersion:v.settings,expectedPolicyRevision:v.policy+1',
    "const role=sql=>'set local role service_role;'+sql");
  const submit=text.slice(text.indexOf('const submit='),text.indexOf('const terminal='));
  assert.doesNotMatch(submit,/select\s|from public\./i);
});
test('root1 then101 and103 have only one relevant current parent and no extra pending',()=>{
  has("f.run('unrelated_terminal_history'","f.reads('root1')","m.terminal(m.b,m.bt,'withdraw')","m.terminal(m.c,m.ct,'reject')",
    "...batches(m.b,98),f.reads('root101'),m.copies(m.b,99,100),f.reads('root103')", "'repair_exact_root103'","'repair_no_pending_extra'",
    'g.ownersource.sourceFingerprint,first.ownersource.sourceFingerprint','g.ownersource.sourceCanonical,first.ownersource.sourceCanonical',
    'observedReport(g.ownerreport),observedReport(first.ownerreport)','rootRows:[1,101,103],irrelevantTerminalChildren:102');
  assert(text.indexOf("f.reads('root1')")<text.indexOf('m.submit(m.b,m.outside,m.a,m.aa)'));
});
test('dense templates keep deferred request/receipt pairs while relevant100/101 cap remains real',()=>{
  has('const copies=(template,first,last,pending=false)=>`set constraints all deferred;',
    'insert into public.merchant_attendance_missing_requests select (r).*','insert into public.merchant_attendance_missing_entries select (s).*',
    'end;$repair_copies$;set constraints all immediate;',"f.run('related_100_101'",'...batches(m.a,99,true)',
    "f.reads('related100')","m.copies(m.a,100,100,true)","f.reject('related101','attendance_period_source_too_large')",
    'cap.ownersource.context.missing.length,100',"cap.ownersource.blockers.includes('pending_missing'),true");
});
test('actual103 Ainside Boutside Cinside chain compares unchanged unified current semantics',()=>{
  has("f.run('actual103_multihop'","m.terminal(m.b,m.bt,'approve')","m.submit(m.c,m.movedInside,m.b,m.bt)","m.terminal(m.c,m.ct,'approve')",
    "m.submit(m.z,m.outside,m.c,m.ct)","m.terminal(m.z,m.zt,'withdraw')",
    "currentIds(chain.get('B_outside')),[]","contextIds(chain.get('B_outside')),[m.a]",
    "contextIds(chain.get('C_inside')),[m.a,m.c].sort()","contextIds(chain.get('C_with_pending_outside')),[m.a,m.c,m.z].sort()",
    "chain.get('C_inside').ownersource.sourceFingerprint,chain.get('C_after_withdraw').ownersource.sourceFingerprint");
});
test('incoming and outgoing corrupt local edges are isolated by savepoints with exact failures',()=>{
  has("['identity','root','approval','time','submit_receipt','approval_receipt','duplicate','incoming_approval','incoming_time']",
    "variant.startsWith('incoming_')",'proposal=incoming?m.movedInside:m.outside',"m.terminal(m.z,m.zt,'approve')",
    "'savepoint bad_case;'", "'rollback to savepoint bad_case;release savepoint bad_case;'",
    "kind==='duplicate'?seed('valid',2):''","kind==='identity'?'attendance_period_source_identity_changed':'attendance_period_source_invalid'",
    "r.submitted_at:=parent_at-interval '1 microsecond'",'r.supersedes_operation_id:=','r.root_request_id:=',
    "jsonb_build_object('action','submit')","jsonb_build_object('requestId',${quote(m.a)})",'cases.length*2');
});
test('different historical approval actor and equal-microsecond child receipt are explicitly synthetic',()=>{
  has("'savepoint prior_owner;'+seed('historical_owner')","t.actor_auth_user_id:=${quote(fid(901))};t.recorded_at:=r.submitted_at;",
    'historicalApprovalActorAccepted:true,syntheticHistoricalApprovalActorOnly:true,actualOwnerTransfer:false',
    'schema-valid but semantically','not outputs claimed to be reachable','No disabled constraints, real data, complete ancestry audit');
});
test('owner/self source bytes and Node projection are checked against independent old unified reads',()=>{
  has('public.faolla_attendance_unified_report_v1(', 'public.faolla_attendance_period_source_v1(',
    'sha(raw.sourceText),raw.sourceFingerprint','JSON.parse(raw.sourceText),raw.sourceCanonical',
    "Buffer.byteLength(raw.sourceText,'utf8')<=1048576","Buffer.byteLength(JSON.stringify(raw),'utf8')<=4194304",
    'observedReport(raw.report),observedReport(report)','projectPeriodClosureSource(raw,',
    'g.ownersource.sourceFingerprint,g.selfsource.sourceFingerprint','g.ownerprojection.artifact.report.totals,g.selfprojection.artifact.report.totals');
});
test('actual153 archive precedes missing changes and survives actual154 install and reapply',()=>{
  has('202610050154_merchant_attendance_period_missing_root_capacity.sql','boundClockMigrationBody(native.root,migration)',
    'source?.ownerProjection?.artifact','sha(source.ownerRaw.sourceText),artifact.sourceFingerprint','public.faolla_attendance_period_closure_v1(',
    "...m.setup,m.submit(m.b,m.outside,m.a,m.aa),m.terminal(m.b,m.bt,'approve'),f.reads('before154')",
    "f.mark('before_install',business),body,f.mark('after_install',business)",
    "f.mark('before_reapply',f.allHash)+f.mark('before_reapply_meta',metadata),body",
    "'repair_reapply_changed_rows_including_registry'","'repair_reapply_changed_definitions_indexes_catalog'",
    'pg_get_functiondef(p.oid)','pg_get_indexdef(c.oid)','pg_get_triggerdef(t.oid)',
    "read('after154_owner','owner'),read('after154_self','self')",
    "'repair_saved_archive_precedes_actual_revision'",'r.artifactText,exports[0].raw.artifactText',
    'archivedMetadata(r),archivedMetadata(exports[0].raw)', 'actual103ApprovedEdgeCompared:true');
  assert.equal((text.match(/boundClockMigrationBody\(native.root,/g)||[]).length,1,'only154 may be installed');
});
