import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("backup confirmation fixture requires development and explicit local-only opt in", () => {
  const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
  assert.match(source, /process\.env\.NODE_ENV !== "development" \|\|/);
  assert.match(source, /process\.env\.FAOLLA_BACKUP_RESTORE_HARNESS !== "enabled-for-local-browser-tests"\) notFound\(\)/);
  assert.ok(source.indexOf("notFound();") < source.indexOf("return <BackupRestoreHarness"));
  assert.match(source, /index: false, follow: false/);
});

test("confirmation fixture reuses production dialog without auth, business requests or application storage", () => {
  const source = readFileSync(new URL("./BackupRestoreHarness.tsx", import.meta.url), "utf8");
  assert.match(source, /import PlatformAdminBackupRestoreDialog from "@\/components\/admin\/PlatformAdminBackupRestoreDialog"/);
  assert.match(source, /<PlatformAdminBackupRestoreDialog/);
  assert.match(source, /import PlatformAdminBackupRestoreInspectionPanel from "@\/components\/admin\/PlatformAdminBackupRestoreInspectionPanel"/);
  assert.match(source, /<PlatformAdminBackupRestoreInspectionPanel/);
  assert.doesNotMatch(source, /\bfetch\s*\(|supabase|sessionStorage|document\.cookie|\/api\//);
  assert.match(source, /const testJournalKey = "faolla:test-harness:restore-journal:v1"/);
  assert.doesNotMatch(source, /faolla:platform-admin:restore-journal:v1|\bSTORAGE_KEY\b|localStorage\.clear\s*\(/);
  assert.equal((source.match(/window\.localStorage\./g) ?? []).length, 3);
  assert.match(source, /getItem: \(\) => window\.localStorage\.getItem\(testJournalKey\)/);
  assert.match(source, /setItem: \(_key: string, value: string\) => window\.localStorage\.setItem\(testJournalKey, value\)/);
  assert.match(source, /removeItem: \(\) => window\.localStorage\.removeItem\(testJournalKey\)/);
  assert.match(source, /clearRestoreJournalExact\(testStorage, testAttempt\)/);
  assert.match(source, /useSyncExternalStore\(subscribeSyntheticJournal, syntheticJournalSnapshot/);
  assert.match(source, /const \[confirmEmpty, setConfirmEmpty\] = useState\(false\)/);
});
