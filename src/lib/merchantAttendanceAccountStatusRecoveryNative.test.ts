import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../../scripts/fixtures/attendance-account-status-recovery-native.mjs", import.meta.url), "utf8");

test("native status recovery requires owned synthetic scope and a genuine manager operation matching the browser pending", () => {
  for (const text of ["d?.syntheticOnly===true&&h?.syntheticOnly===true", "assertLifecycleSandbox", "assert.deepEqual(owned,d.owned)", "assert.equal(scope.schema,owned.schema)",
    "parseKnownAccountStatusRecovery(pending.key,pending.raw,d.auth)", "actor_auth_user_id=${auth} and actor_employee_id=${employee}",
    "expected_version=${command.version} and version=${command.version+1}", "command_fingerprint=${quote(entry.commandFingerprint)}"])
    assert(source.includes(text), text);
  assert.doesNotMatch(source, /insert into|delete from|truncate |disable trigger|session_replication_role|process\.argv|spawn\(/i);
});

test("disabled same Auth reads then active rebound old and replacement actors receive exact denial", () => {
  assert.match(source, /set status='disabled'.*auth_user_id=\$\{auth\} and status='active'/);
  assert.match(source, /set status='active',auth_user_id=\$\{replacement\}/);
  assert.match(source, /deny\('old_auth_after_rebind',d\.auth\)\+deny\('new_auth_cannot_inherit',replacementAuth\)/);
  assert.match(source, /if sqlerrm<>'attendance_access_denied' then raise/);
  assert.match(source, /assert\.deepEqual\(results\[1\],results\[0\]/);
  assert.match(source, /parseAccountSuspensionResult\(row\.value,query,d\.auth\)/);
  assert.match(source, /accountStatusReceiptMatches\(result\.statusReceipt,command,entry\.commandFingerprint\)/);
  assert.doesNotMatch(source, /faolla_update_merchant_enterprise_employee_v1|allow_restore.*true|\.auth\.getUser/);
});

test("one four-step rollback transaction preserves facts per read/rejection and restores definitions/catalog in finally", () => {
  assert.match(source, /const steps=\[prepare,disable,rebind,`\$\{prefix\}set constraints all immediate;rollback;`\]/);
  assert.match(source, /assert\.equal\(steps\.length,4\)/);
  assert.match(source, /native\.querySteps\(steps\.map\(\(step,index\)=>scope\.sql/);
  assert.equal((source.match(/assert \$\{facts\}=before_hash/g) ?? []).length, 2);
  for (const text of ["finally{for", "status_recovery_all_facts_restored", "status_recovery_definitions_unchanged", "status_recovery_catalog_unchanged",
    "new AggregateError", "This is not HTTP/browser authentication", "businessRpcWrites:0"])
    assert(source.includes(text), text);
  assert.doesNotMatch(source, /commit;|statement_timeout|lock_timeout/);
  const returned = source.slice(source.indexOf("return {sqlReads:"));
  assert.doesNotMatch(returned, /pending\.raw|commandFingerprint|statusReceipt|employeeId/);
});
