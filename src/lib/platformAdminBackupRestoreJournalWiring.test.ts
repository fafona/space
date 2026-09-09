import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Source contracts only: these tests neither mount React nor exercise browser
// storage/Web Locks/network. Journal behavior has separate in-memory tests.
const source = readFileSync(new URL("../app/super-admin/SuperAdminClient.tsx", import.meta.url), "utf8").replaceAll("\r\n", "\n");
function between(start: string, end: string, input = source) {
  const begin = input.indexOf(start);
  assert.ok(begin >= 0, `Missing source boundary: ${start}`);
  const finish = input.indexOf(end, begin + start.length);
  assert.ok(finish > begin, `Missing source boundary: ${end}`);
  return input.slice(begin, finish);
}
function ordered(input: string, ...tokens: string[]) {
  let cursor = 0;
  for (const token of tokens) {
    const next = input.indexOf(token, cursor);
    assert.ok(next >= cursor, `Missing or incorrectly ordered source token: ${token}`);
    cursor = next + token.length;
  }
}
const confirm = between("async function confirmDataBackupRestoreAction()", "void loadDataBackupsAction({ silent: true });");
const query = between("async function queryDataBackupRestoreReceiptAction()", "async function confirmDataBackupRestoreAction()");
const journalStartup = between("const journal = readRestoreJournal(getRestoreJournalStorage());", "const invalidate = () => invalidateDataBackupReceiptIdentity();");
const snapshotLoad = between("const loadPlatformMerchantSnapshotFromServer =", "const loadMerchantConfigArchiveAction =");
const snapshotSave = between("const syncPlatformMerchantSnapshotToServer =", "const withAudit =");
const backupCreate = between("const createDataBackupAction =", "async function viewDataBackupDetailAction(");

test("journal wiring: initial render pauses before hydration and a preview requires the journal readiness gate", () => {
  assert.match(source, /\[dataBackupSyncPaused, setDataBackupSyncPaused\] = useState\(true\)/);
  assert.match(source, /\[dataBackupJournalReady, setDataBackupJournalReady\] = useState\(false\)/);
  assert.match(source, /dataBackupJournalReadyRef = useRef\(false\)/);
  assert.match(source, /createPlatformAdminBackupRestoreSyncGuard\(\{ initiallyPaused: true \}\)/);
  const preview = between("async function restoreDataBackupAction(", "async function queryDataBackupRestoreReceiptAction()");
  ordered(preview, "!dataBackupJournalReadyRef.current", "dataBackupRestoreAttemptedRef.current", "await dataBackupRestoreSyncGuardRef.current.pause()", 'action: "preview"');
  assert.match(source, /if \(!hydrated \|\| !authed \|\| !dataBackupJournalReady\) return;/);
});

test("journal wiring: pending or unreadable startup records block before exposing only fresh-identity-checked metadata", () => {
  ordered(journalStartup, 'if (journal.status === "empty")', "dataBackupRestoreSyncGuardRef.current.resume()",
    "dataBackupRestoreSyncGuardRef.current.block()", "dataBackupRestoreAttemptedRef.current = true",
    'journal.status !== "pending" || !authed', "const attempt = journal.attempt",
    "readPlatformAdminBackupRestoreIdentityOnce(fetch, { expected: attempt.deviceId", "const latest = readRestoreJournal",
    "JSON.stringify(latest.attempt) !== JSON.stringify(attempt)", "dataBackupReceiptAttemptRef.current = attempt",
    'status: "unknown", receipt: null, application: "unconfirmed"');
  assert.match(journalStartup, /controller.signal.aborted/);
  assert.doesNotMatch(journalStartup.slice(journalStartup.indexOf("dataBackupRestoreSyncGuardRef.current.block()")), /\.resume\(|clearRestoreJournalExact\(|writeRestoreJournalAhead\(|lookupPlatformAdminBackupRestoreReceiptForAttempt\(|requestPlatformAdminBackupRestoreOnce\(|savePlatformState\(/);
});

test("journal wiring: empty startup never advances an already-live generation or unlocks an active/unknown restore", () => {
  const empty = between('if (journal.status === "empty")', "dataBackupRestoreSyncGuardRef.current.block()", journalStartup);
  ordered(empty, "dataBackupRestoreSyncGuardRef.current.isPaused()", "!dataBackupRestoreRequestRef.current",
    "!dataBackupPreviewLocalStateRef.current", "!dataBackupRestoreAttemptedRef.current", "dataBackupRestoreSyncGuardRef.current.resume()");
  assert.equal(empty.match(/\.resume\(/g)?.length, 1);
  assert.doesNotMatch(empty, /dataBackupRestoreAttemptedRef.current\s*=|clearRestoreJournalExact\(/);
});

test("journal wiring: shared writer lock wraps the page guard and both physical snapshot POST sites", () => {
  const wrapper = between("const runDataBackupSnapshotWrite =", "const [dataBackupDetail,");
  ordered(wrapper, ".runWrite((isCurrent)", "withRestoreJournalWriter(getRestoreJournalStorage(), navigator.locks",
    "if (!isCurrent()) throw", "return write(isCurrent)");
  assert.equal(source.match(/dataBackupRestoreSyncGuardRef\.current\.runWrite\(/g)?.length, 1, "Only the journal-aware wrapper may call runWrite");
  assert.equal(source.match(/"\/api\/super-admin\/platform-merchant-snapshot",\s*\{\s*method: "POST"/g)?.length, 2);
  const background = between("if (dataBackupSyncPaused || dataBackupRestoreSyncGuardRef.current.isPaused()) return;", "const refreshSupportThreads =");
  ordered(background, "runDataBackupSnapshotWrite(async (isCurrent)", "fetchWithTimeout(", 'method: "POST"', "readPlatformAdminBackupRestoreJson(", "if (!isCurrent()) return;");
  ordered(snapshotSave, "runDataBackupSnapshotWrite(async (isCurrent)", "const sendSnapshotRequest =", "if (!isCurrent()) throw", "fetchWithTimeout(", 'method: "POST"');
  assert.equal(snapshotSave.match(/await sendSnapshotRequest\(\)/g)?.length, 2, "Auth recovery must reuse the guarded send function");
  assert.match(snapshotSave, /response.status === 401 \|\| response.status === 403/);
});

test("journal wiring: server snapshot GET holds the shared lock through bounded body consumption and rejects stale local hydration", () => {
  ordered(snapshotLoad, ".captureCurrent()", "withRestoreJournalWriter(getRestoreJournalStorage(), navigator.locks",
    "if (!isCurrent()) throw", "fetchWithTimeout(", 'method: "GET"',
    "readPlatformAdminBackupRestoreJson(response, PLATFORM_MERCHANT_SNAPSHOT_LOAD_TIMEOUT_MS, options.signal)",
    "if (!isCurrent())", "hydratePlatformMerchantSnapshotFromServerPayload(payload");
  assert.doesNotMatch(snapshotLoad, /response\.json\(/);
});

test("journal wiring: backup catalog creation enters the same writer guard and automatic creation waits for startup", () => {
  ordered(backupCreate, "dataBackupRestoreSyncGuardRef.current.isPaused()", "runDataBackupSnapshotWrite(async (isCurrent)",
    'method: "POST"', "readPlatformAdminBackupRestoreJson(response, PLATFORM_MERCHANT_SNAPSHOT_SAVE_TIMEOUT_MS)", "if (!isCurrent())");
  const automatic = between("if (!hydrated || !authed || !dataBackupJournalReady || dataBackupSyncPaused) return;", "async function sendSupportReplyAction()");
  ordered(automatic, "!dataBackupJournalReady || dataBackupSyncPaused", "setDataBackupAutoChecked(true)", 'createDataBackupAction("auto")');
});

test("journal wiring: catalog creation sends once with bounded headers/body and throws uncertain acknowledgements inside the guard", () => {
  ordered(backupCreate, "runDataBackupSnapshotWrite(async (isCurrent)", 'fetchWithTimeout("/api/super-admin/data-backups",',
    "}, PLATFORM_MERCHANT_SNAPSHOT_SAVE_TIMEOUT_MS)", "readPlatformAdminBackupRestoreJson(response, PLATFORM_MERCHANT_SNAPSHOT_SAVE_TIMEOUT_MS)",
    "if (!isCurrent()) throw", "if (!response.ok)", 'throw new Error("super_admin_backup_create_unconfirmed")',
    "parsePlatformAdminBackupCreateAck(payload)", 'if (!acknowledgement) throw new Error("super_admin_backup_create_unconfirmed")',
    "setDataBackups(acknowledgement.backups)");
  assert.equal(backupCreate.match(/fetchWithTimeout\(/g)?.length, 1);
  assert.doesNotMatch(backupCreate, /requestDataBackupsWithSessionRecovery\(|refreshSuperAdminAuthenticatedState\(|response\.json\(/);
  const rejected = between("if (!response.ok)", "const acknowledgement", backupCreate);
  assert.doesNotMatch(rejected, /return false/);
  const failure = between("} catch {", "} finally {", backupCreate);
  ordered(failure, ".block()", "setDataBackupSyncPaused(true)", "return false");
});

test("journal wiring: receipt-enabled confirmation owns the exclusive lock and writes the captured attempt before exactly one PATCH", () => {
  assert.match(confirm, /if \(preview.receiptProtocol === 1\) await withRestoreJournalExclusive\(navigator.locks, execute\);/);
  ordered(confirm, "const execute = async () =>", "await readPlatformAdminBackupRestoreIdentityOnce(",
    "createPlatformAdminBackupRestoreReceiptAttempt(", "journalTouched = true", "writeRestoreJournalAhead(getRestoreJournalStorage(), attempt)",
    "dataBackupReceiptAttemptRef.current = attempt", "dataBackupRestoreAttemptedRef.current = true", "sent = true",
    "await requestPlatformAdminBackupRestoreOnce(");
  assert.equal(confirm.match(/requestPlatformAdminBackupRestoreOnce\(/g)?.length, 1);
  assert.equal(confirm.match(/createPlatformAdminBackupRestoreReceiptAttempt\(/g)?.length, 1);
  assert.match(confirm, /attempt\?\.binding\.operationId/);
  assert.doesNotMatch(confirm, /requestDataBackupsWithSessionRecovery\(/);
});

test("journal wiring: the two exact journal clears live only in current confirmation's known rejection or fully applied success", () => {
  assert.equal(source.match(/clearRestoreJournalExact\(/g)?.length, 2);
  assert.equal(confirm.match(/clearRestoreJournalExact\(getRestoreJournalStorage\(\), attempt\)/g)?.length, 2);
  const rejected = between("if (!result) {", 'if (result.scope === "user_manage")', confirm);
  ordered(rejected, "isPlatformAdminBackupRestoreRejectedBeforeWrite(response.status, payload)",
    "if (rejectedBeforeWrite && attempt)", "clearRestoreJournalExact(getRestoreJournalStorage(), attempt)",
    "dataBackupRestoreAttemptedRef.current = !rejectedBeforeWrite");
  const applied = confirm.slice(confirm.indexOf('if (result.scope === "user_manage")'));
  ordered(applied, "parsePlatformAdminBackupRestoreAuthoritativeSnapshot(", "applyServerMerchantSnapshotPayloadToState(result.platformState, authoritative)",
    "if (!savePlatformState(nextState))", "platformSnapshotRevisionRef.current = authoritative.revision", "applySupportThreadsState(result.threads)",
    'application: "applied"', "clearRestoreJournalExact(getRestoreJournalStorage(), attempt)",
    "dataBackupRestoreAttemptedRef.current = false", "dataBackupRestoreSyncGuardRef.current.resume()");
});

test("journal wiring: replay, failed authoritative read and failed local save retain the journal rather than clearing it", () => {
  const replay = between("if (committed.replayed) {", "} else if (response.ok)", confirm);
  assert.match(replay, /\.block\(\)/); assert.match(replay, /return;/);
  assert.doesNotMatch(replay, /clearRestoreJournalExact\(|\.resume\(|savePlatformState\(/);
  const unavailable = between("if (!authoritative) {", "const nextState =", confirm);
  assert.match(unavailable, /\.block\(\)/); assert.match(unavailable, /return;/);
  assert.doesNotMatch(unavailable, /clearRestoreJournalExact\(|\.resume\(/);
  const localFailure = between("if (!savePlatformState(nextState)) {", "stateRef.current = nextState", confirm);
  assert.match(localFailure, /\.block\(\)/); assert.match(localFailure, /return;/);
  assert.doesNotMatch(localFailure, /clearRestoreJournalExact\(|\.resume\(/);
});

test("journal wiring: write-ahead uncertainty is sticky and cleanup never deletes or unlocks", () => {
  const failure = between("} catch {", "};\n    try {", confirm);
  ordered(failure, "if (sent || journalTouched)", ".block()", "dataBackupRestoreAttemptedRef.current = true", "setDataBackupSyncPaused(true)");
  assert.doesNotMatch(failure, /clearRestoreJournalExact\(|\.resume\(|removeItem\(/);
  const preCallbackFailure = confirm.slice(confirm.indexOf("// Failure before the lock callback"));
  ordered(preCallbackFailure, 'readRestoreJournal(getRestoreJournalStorage()).status !== "empty"', ".block()", "dataBackupRestoreAttemptedRef.current = true");
  assert.doesNotMatch(preCallbackFailure, /clearRestoreJournalExact\(|writeRestoreJournalAhead\(|\.resume\(/);
});

test("journal wiring: receipt lookup remains read-only and never clears, reapplies or unlocks a retained attempt", () => {
  assert.match(query, /lookupPlatformAdminBackupRestoreReceiptForAttempt\(fetch, attempt, controller.signal\)/);
  assert.match(query, /dataBackupReceiptAttemptRef.current === attempt/);
  assert.match(query, /isCurrent\(generation\)/);
  assert.doesNotMatch(query, /clearRestoreJournalExact\(|writeRestoreJournalAhead\(|withRestoreJournalExclusive\(|\.resume\(|\.block\(|savePlatformState\(|setState\(|requestPlatformAdminBackupRestoreOnce\(|dataBackupRestoreAttemptedRef.current\s*=/);
});

test("journal wiring: foreign journal change or clear blocks synchronously; identity loss only hides metadata", () => {
  const storage = between("const changed = (event: StorageEvent) =>", "const shown =");
  ordered(storage, "event.key === null || event.key === RESTORE_JOURNAL_KEY", ".block()",
    "dataBackupRestoreAttemptedRef.current = true", "setDataBackupSyncPaused(true)", "invalidate()", "setDataBackupJournalEpoch(", "return;");
  assert.doesNotMatch(storage, /clearRestoreJournalExact\(|writeRestoreJournalAhead\(|\.resume\(/);
  const invalidate = between("const invalidateDataBackupReceiptIdentity =", "useEffect(() => { invalidateDataBackupReceiptIdentity();");
  assert.match(invalidate, /dataBackupReceiptAttemptRef.current = null/);
  assert.match(invalidate, /setDataBackupReceiptProgress\(null\)/);
  assert.doesNotMatch(invalidate, /clearRestoreJournalExact\(|writeRestoreJournalAhead\(|\.resume\(|dataBackupRestoreAttemptedRef.current\s*=/);
  assert.match(source, /window.addEventListener\("pagehide", invalidate\)/);
  assert.match(source, /window.addEventListener\("storage", changed\)/);
  assert.match(source, /window.addEventListener\("pageshow", shown\)/);
});

test("journal wiring: preview cancellation cannot release startup or an attempted/unknown restore", () => {
  const close = between("const closeDataBackupRestorePreview =", "const invalidateDataBackupReceiptIdentity =");
  ordered(close, "if (dataBackupRestoreAttemptedRef.current)", ".block()", "dataBackupJournalReadyRef.current && dataBackupRestoreSyncGuardRef.current.resume()");
  assert.doesNotMatch(close, /clearRestoreJournalExact\(|writeRestoreJournalAhead\(|removeItem\(/);
});
