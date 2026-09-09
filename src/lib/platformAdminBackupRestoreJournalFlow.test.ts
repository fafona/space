import assert from "node:assert/strict";
import test from "node:test";
import { normalizePlatformState } from "@/data/platformControlStore";
import { createPlatformAdminDataBackupEntry } from "./platformAdminDataBackup";
import { buildPlatformAdminBackupRestorePreview } from "./platformAdminBackupRestorePreview.server";
import { createPlatformAdminBackupRestoreSyncGuard, isPlatformAdminBackupRestoreRejectedBeforeWrite,
  requestPlatformAdminBackupRestoreOnce } from "./platformAdminBackupRestoreClient";
import { createPlatformAdminBackupRestoreReceiptAttempt, lookupPlatformAdminBackupRestoreReceiptForAttempt,
  parsePlatformAdminBackupRestoreReceiptReply } from "./platformAdminBackupRestoreReceiptWorkflow";
import { STORAGE_KEY, LOCK_NAME, readRestoreJournal, writeRestoreJournalAhead, clearRestoreJournalExact,
  withRestoreJournalExclusive, withRestoreJournalWriter, type RestoreJournalLockManager,
  type RestoreJournalStorage } from "./platformAdminBackupRestoreJournal";

// Functional helper composition only: the fetcher and browser facilities below
// are memory fakes, not real HTTP, Auth, Web Locks, localStorage or SQL evidence.
function fixture() {
  const backup = createPlatformAdminDataBackupEntry({ source: "manual", operator: "Synthetic", snapshot: {
    platformState: normalizePlatformState({}), merchantSnapshot: null, merchantConfigArchive: { backups: [], audits: [] },
    supportInbox: { threads: [] }, merchantAccounts: [],
  } });
  const preview = { ...buildPlatformAdminBackupRestorePreview(backup, { scope: "support_messages", supportInbox: { threads: [] } }), receiptProtocol: 1 as const };
  const attempt = createPlatformAdminBackupRestoreReceiptAttempt(preview, true, "verified-device-a");
  const receipt = { version: 1, ...attempt.binding, planHash: "a".repeat(64), resultHash: "b".repeat(64), committedAt: "2026-09-09T10:00:00.123456Z" };
  let text: string | null = null; let committed = false; let deviceId = attempt.deviceId;
  let fault = ""; let removes = 0; let exclusive = false; let shared = 0;
  const events: string[] = []; const requests: Array<{ method: string; path: string }> = [];
  const storage: RestoreJournalStorage = {
    getItem(key) { assert.equal(key, STORAGE_KEY); return text; },
    setItem(key, value) { assert.equal(key, STORAGE_KEY); events.push("write-ahead"); text = value; },
    removeItem(key) { assert.equal(key, STORAGE_KEY); events.push("clear"); removes++; text = null; },
  };
  const locks: RestoreJournalLockManager = { async request(name, options, callback) {
    assert.equal(name, LOCK_NAME); assert.equal(options.ifAvailable, true);
    if (exclusive || (options.mode === "exclusive" && shared > 0)) return callback(null);
    if (options.mode === "exclusive") exclusive = true; else shared++;
    try { return await callback({ name, mode: options.mode }); }
    finally { if (options.mode === "exclusive") exclusive = false; else shared--; }
  } };
  const fetcher = async (path: string, init: RequestInit) => {
    const url = new URL(path, "https://synthetic.invalid"); const method = init.method ?? "GET";
    requests.push({ method, path: url.pathname });
    if (url.pathname === "/api/super-admin/auth/session") {
      assert.equal(method, "GET"); return Response.json({ ok: true, authenticated: true, deviceId });
    }
    if (url.pathname === "/api/super-admin/data-backups/restore-operations") {
      assert.equal(method, "GET");
      for (const [key, value] of Object.entries(attempt.binding)) assert.equal(url.searchParams.get(key), value);
      return Response.json({ ok: true, outcome: committed ? "committed" : "unknown", receipt: committed ? receipt : null });
    }
    assert.equal(url.pathname, "/api/super-admin/data-backups"); assert.equal(method, "PATCH");
    assert.equal(exclusive, true, "the restore transport must remain inside the exclusive callback");
    assert.deepEqual(readRestoreJournal(storage), { status: "pending", attempt });
    const body = JSON.parse(String(init.body)); assert.equal(body.operationId, attempt.binding.operationId);
    assert.equal(Object.hasOwn(body, "deviceId"), false); events.push("PATCH");
    if (fault === "prewrite-reject") return Response.json({ error: "super_admin_backup_restore_preview_stale", outcome: "not_started" }, { status: 409 });
    committed = true;
    if (fault === "lost-response") throw new Error("synthetic response lost after commit");
    if (fault === "unknown-response") return Response.json({ error: "super_admin_backup_restore_incomplete", outcome: "partial_or_unknown", retrySafe: false }, { status: 500 });
    return Response.json({ ok: true, scope: preview.scope, outcome: "committed", replayed: false, receipt });
  };
  const submit = () => requestPlatformAdminBackupRestoreOnce(fetcher, preview, true, undefined, attempt.binding.operationId);
  return { storage, locks, preview, attempt, events, requests, fetcher, submit,
    get removes() { return removes; }, get text() { return text; },
    setFault(value: string) { fault = value; }, setDevice(value: string) { deviceId = value; },
    patches: () => requests.filter((item) => item.method === "PATCH").length };
}

test("journal flow: write-ahead precedes the sole PATCH; confirmed fresh success clears only after explicit application", async () => {
  const f = fixture();
  await withRestoreJournalExclusive(f.locks, async () => {
    const captured = writeRestoreJournalAhead(f.storage, f.attempt);
    const response = await f.submit(); assert.equal(response.status, 200);
    const reply = parsePlatformAdminBackupRestoreReceiptReply(await response.json(), captured); assert.ok(reply); assert.equal(reply.replayed, false);
    f.events.push("synthetic-local-application-succeeded"); clearRestoreJournalExact(f.storage, captured);
  });
  assert.deepEqual(f.events, ["write-ahead", "PATCH", "synthetic-local-application-succeeded", "clear"]);
  assert.equal(f.patches(), 1); assert.equal(f.removes, 1); assert.deepEqual(readRestoreJournal(f.storage), { status: "empty" });
});

test("journal flow: a new page recovers a lost response with three read-only GETs, not another PATCH or automatic clear", async () => {
  const f = fixture(); f.setFault("lost-response");
  await assert.rejects(withRestoreJournalExclusive(f.locks, async () => {
    writeRestoreJournalAhead(f.storage, f.attempt); await f.submit();
  }), /synthetic response lost/);
  const persisted = f.text; const reloaded = readRestoreJournal(f.storage); assert.equal(reloaded.status, "pending");
  if (reloaded.status !== "pending") assert.fail("new page must retain the pending attempt");
  const newPageGuard = createPlatformAdminBackupRestoreSyncGuard(); newPageGuard.block();
  const count = f.requests.length;
  const lookup = await lookupPlatformAdminBackupRestoreReceiptForAttempt(f.fetcher, reloaded.attempt);
  assert.equal(lookup.outcome, "committed");
  assert.deepEqual(f.requests.slice(count), [
    { method: "GET", path: "/api/super-admin/auth/session" },
    { method: "GET", path: "/api/super-admin/data-backups/restore-operations" },
    { method: "GET", path: "/api/super-admin/auth/session" },
  ]);
  assert.equal(f.patches(), 1); assert.equal(f.removes, 0); assert.equal(f.text, persisted);
  assert.equal(newPageGuard.resume(), false); assert.equal(newPageGuard.isPaused(), true);
});

test("journal flow: exact known pre-write rejection permits explicit clear without inventing a committed receipt", async () => {
  const f = fixture(); f.setFault("prewrite-reject");
  await withRestoreJournalExclusive(f.locks, async () => {
    writeRestoreJournalAhead(f.storage, f.attempt); const response = await f.submit(); const value = await response.json();
    assert.equal(isPlatformAdminBackupRestoreRejectedBeforeWrite(response.status, value), true);
    assert.equal(parsePlatformAdminBackupRestoreReceiptReply(value, f.attempt), null);
    clearRestoreJournalExact(f.storage, f.attempt);
  });
  assert.equal(f.patches(), 1); assert.equal(f.removes, 1); assert.deepEqual(readRestoreJournal(f.storage), { status: "empty" });
});

test("journal flow: unknown server outcome remains pending even when a later lookup confirms the historical commit", async () => {
  const f = fixture(); f.setFault("unknown-response");
  await withRestoreJournalExclusive(f.locks, async () => {
    writeRestoreJournalAhead(f.storage, f.attempt); const response = await f.submit(); const value = await response.json();
    assert.equal(isPlatformAdminBackupRestoreRejectedBeforeWrite(response.status, value), false);
    assert.equal(parsePlatformAdminBackupRestoreReceiptReply(value, f.attempt), null);
  });
  assert.equal((await lookupPlatformAdminBackupRestoreReceiptForAttempt(f.fetcher, f.attempt)).outcome, "committed");
  assert.equal(readRestoreJournal(f.storage).status, "pending"); assert.equal(f.removes, 0); assert.equal(f.patches(), 1);
});

test("journal flow: reloaded record owned by another current identity causes zero receipt requests and no deletion", async () => {
  const f = fixture(); writeRestoreJournalAhead(f.storage, f.attempt); f.setDevice("verified-device-b");
  const reloaded = readRestoreJournal(f.storage); assert.equal(reloaded.status, "pending");
  if (reloaded.status !== "pending") assert.fail("pending record");
  await assert.rejects(lookupPlatformAdminBackupRestoreReceiptForAttempt(f.fetcher, reloaded.attempt), /super_admin_backup_restore_identity_unconfirmed/);
  assert.deepEqual(f.requests, [{ method: "GET", path: "/api/super-admin/auth/session" }]);
  assert.equal(f.patches(), 0); assert.equal(f.removes, 0); assert.equal(readRestoreJournal(f.storage).status, "pending");
});

test("journal flow: an in-flight shared writer prevents an exclusive restore from recording or sending", async () => {
  const f = fixture(); let enter!: () => void; let finish!: () => void;
  const entered = new Promise<void>((resolve) => { enter = resolve; }); const pending = new Promise<void>((resolve) => { finish = resolve; });
  const writer = withRestoreJournalWriter(f.storage, f.locks, async () => { enter(); await pending; });
  await entered;
  try {
    await assert.rejects(withRestoreJournalExclusive(f.locks, async () => {
      writeRestoreJournalAhead(f.storage, f.attempt); await f.submit();
    }), /restore_journal_lock_unavailable/);
    assert.equal(f.patches(), 0); assert.equal(f.text, null);
  } finally { finish(); await writer; }
});

for (const failure of ["quota", "silent-readback"]) {
  test(`journal flow: ${failure} failure stops before sending any PATCH`, async () => {
    const f = fixture(); f.storage.setItem = () => { if (failure === "quota") throw new Error("synthetic quota"); };
    await assert.rejects(withRestoreJournalExclusive(f.locks, async () => {
      writeRestoreJournalAhead(f.storage, f.attempt); await f.submit();
    }), /restore_journal_write_unconfirmed/);
    assert.equal(f.patches(), 0); assert.equal(f.removes, 0);
  });
}

test("journal flow: another pending attempt cannot be overwritten to start a fresh restore", async () => {
  const f = fixture(); const other = createPlatformAdminBackupRestoreReceiptAttempt(f.preview, true, f.attempt.deviceId);
  writeRestoreJournalAhead(f.storage, other); const persisted = f.text;
  await assert.rejects(withRestoreJournalExclusive(f.locks, async () => {
    writeRestoreJournalAhead(f.storage, f.attempt); await f.submit();
  }), /restore_journal_pending/);
  assert.equal(f.patches(), 0); assert.equal(f.text, persisted); assert.equal(f.removes, 0);
});

test("journal flow: confirmed server commit cannot clear the record when separate local application fails", async () => {
  const f = fixture();
  await assert.rejects(withRestoreJournalExclusive(f.locks, async () => {
    writeRestoreJournalAhead(f.storage, f.attempt);
    const response = await f.submit(); assert.ok(parsePlatformAdminBackupRestoreReceiptReply(await response.json(), f.attempt));
    throw new Error("synthetic local application failed");
  }), /synthetic local application failed/);
  assert.equal(f.patches(), 1); assert.equal(f.removes, 0); assert.equal(readRestoreJournal(f.storage).status, "pending");
  await assert.rejects(withRestoreJournalWriter(f.storage, f.locks, () => assert.fail("stale writer")), /restore_journal_pending/);
});
