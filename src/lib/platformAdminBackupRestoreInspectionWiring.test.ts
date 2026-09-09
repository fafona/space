import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

// Source contracts supplement, not replace, actual component lifecycle acceptance.
const source = readFileSync(new URL("../app/super-admin/SuperAdminClient.tsx", import.meta.url), "utf8");
const action = source.slice(source.indexOf("async function inspectDataBackupRestoreAction()"), source.indexOf("async function confirmDataBackupRestoreAction()"));
test("inspection action requires retained operation, current screen and no other in-flight operation", () => {
  for (const field of ["!authed", "!hydrated", 'activeMenu !== "stats"', "!attempt", "!dataBackupReceiptRetained",
    "dataBackupRestoreBusyRef.current", "dataBackupReceiptQueryRef.current", "dataBackupInspectionRequestRef.current"]) assert.ok(action.includes(field));
  assert.equal((action.match(/await inspectPlatformAdminBackupRestoreForAttempt\(/g) ?? []).length, 1);
});
test("inspection never applies business state, clears a journal, unlocks or requests a restore", () => {
  assert.doesNotMatch(action, /clearRestoreJournalExact|savePlatformState|applySupportThreadsState|\.resume\(|requestPlatformAdminBackupRestoreOnce|setDataBackupSyncPaused|setDataBackupReceiptRetained/);
  assert.doesNotMatch(action, /dataBackupRestoreAttemptedRef\.current\s*=/);
  assert.match(action, /setDataBackupInspection\(null\)/);
  assert.match(action, /if \(!current\(\)\) return;/);
});
test("old inspection generations are cancelled and their report is hidden on the existing identity/menu lifecycle", () => {
  const cancel = source.slice(source.indexOf("const cancelDataBackupReceiptQuery ="), source.indexOf("const closeDataBackupRestorePreview ="));
  assert.match(cancel, /dataBackupInspectionGuardRef\.current\.invalidate\(\)/);
  assert.match(cancel, /dataBackupInspectionRequestRef\.current\?\.abort\(\)/);
  assert.match(cancel, /setDataBackupInspection\(null\)/);
  assert.match(action, /dataBackupReceiptAttemptRef\.current === attempt/);
  assert.match(source, /dataBackupInspection\?\.attempt === dataBackupReceiptProgress\.attempt/);
});
test("public inspection endpoint exposes only a GET wired to a fresh authorized session", () => {
  const route = readFileSync(new URL("../app/api/super-admin/data-backups/restore-inspection/route.ts", import.meta.url), "utf8");
  assert.match(route, /createPlatformAdminBackupRestoreInspectionGET/);
  assert.match(route, /readSuperAdminAuthorizedSession/);
  assert.doesNotMatch(route, /export (?:const|async function|function) (?:POST|PUT|PATCH|DELETE)\b/);
});

test("journal identity rebind retires both read-only requests before replacing the attempt object", () => {
  const continuation = source.slice(source.indexOf("const journal = readRestoreJournal(getRestoreJournalStorage());"),
    source.indexOf("const invalidate = () => invalidateDataBackupReceiptIdentity();"));
  const rebind = continuation.indexOf("dataBackupReceiptAttemptRef.current = attempt;");
  const retire = continuation.indexOf("cancelDataBackupReceiptQuery();");
  assert.ok(retire >= 0 && retire < rebind);
  const cancel = source.slice(source.indexOf("const cancelDataBackupReceiptQuery ="), source.indexOf("const closeDataBackupRestorePreview ="));
  for (const ref of ["dataBackupReceiptQueryRef", "dataBackupInspectionRequestRef"]) {
    assert.ok(cancel.includes(`${ref}.current?.abort()`));
    assert.ok(cancel.includes(`${ref}.current = null`));
  }
  assert.match(cancel, /setDataBackupReceiptQuerying\(false\)/);
  assert.match(cancel, /setDataBackupInspecting\(false\)/);
  assert.doesNotMatch(cancel, /clearRestoreJournalExact|\.resume\(|dataBackupRestoreAttemptedRef\.current\s*=/);
});
