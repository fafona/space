import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { normalizePlatformState } from "@/data/platformControlStore";
import { createPlatformAdminDataBackupEntry } from "./platformAdminDataBackup";
import { buildPlatformAdminBackupRestorePreview } from "./platformAdminBackupRestorePreview.server";
import type { PlatformSupportThread } from "./platformSupportInbox";
import {
  buildPlatformAdminBackupRestoreRequest, createPlatformAdminBackupRestoreRequestGuard,
  createPlatformAdminBackupRestoreSyncGuard, isPlatformAdminBackupRestoreRejectedBeforeWrite,
  parsePlatformAdminBackupRestoreAuthoritativeSnapshot, parsePlatformAdminBackupRestorePreview,
  parsePlatformAdminBackupRestoreResult, platformAdminBackupRestoreFailureMessage,
  parsePlatformAdminBackupRestoreSnapshotWriteAck,
  readPlatformAdminBackupRestoreJson, requestPlatformAdminBackupRestoreOnce,
} from "./platformAdminBackupRestoreClient";

const thread: PlatformSupportThread = {
  merchantId: "10000000", siteId: "10000000", merchantName: "Synthetic", merchantEmail: "synthetic@example.invalid",
  updatedAt: "2026-09-08T00:00:00.000Z", messages: [{ id: "message-1", sender: "merchant", text: "Synthetic only",
    createdAt: "2026-09-08T00:00:00.000Z" }],
};
function fixture(scope: "user_manage" | "support_messages" = "support_messages", empty = false) {
  const backup = createPlatformAdminDataBackupEntry({ source: "manual", operator: "Synthetic", snapshot: {
    platformState: normalizePlatformState({}), merchantSnapshot: null,
    merchantConfigArchive: { backups: [], audits: [] }, supportInbox: { threads: empty ? [] : [structuredClone(thread)] }, merchantAccounts: [],
  } });
  const preview = buildPlatformAdminBackupRestorePreview(backup, scope === "support_messages"
    ? { scope, supportInbox: { threads: [structuredClone(thread)] } }
    : { scope, merchantSnapshot: null, merchantConfigArchive: { backups: [], audits: [] } });
  const response = { ok: true, scope, backup: { id: backup.id, at: backup.at },
    ...(scope === "support_messages" ? { threads: backup.snapshot.supportInbox.threads }
      : { platformState: backup.snapshot.platformState, merchantAccounts: backup.snapshot.merchantAccounts }) };
  return { backup, preview, response };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test("client accepts actual server preview builders for both scopes and browser unknown counts", () => {
  for (const scope of ["user_manage", "support_messages"] as const) {
    const { preview } = fixture(scope);
    assert.deepEqual(parsePlatformAdminBackupRestorePreview({ ok: true, preview }, preview), preview);
    if (scope === "user_manage") assert.ok(preview.counts.filter((item) => item.source === "browser").every((item) => item.current === null));
  }
});

test("preview requires matching identity/scope, exact count contract and intact empty warnings", () => {
  const { preview } = fixture("support_messages", true);
  const malformed: unknown[] = [null, {}, { ok: false, preview }, { preview }];
  for (const change of [
    { backupId: "other" }, { scope: "user_manage" }, { version: 2 }, { confirmationToken: "v1.fake" },
    { counts: [] }, { counts: preview.counts.map((item) => ({ ...item, target: -1 })) },
    { counts: preview.counts.map((item) => ({ ...item, current: null })) },
    { requiresEmptyConfirmation: false }, { emptyKeys: [] }, { excluded: [] }, { warning: "" },
  ]) malformed.push({ ok: true, preview: { ...preview, ...change } });
  for (const value of malformed) assert.equal(parsePlatformAdminBackupRestorePreview(value, preview), null);
  assert.equal(parsePlatformAdminBackupRestorePreview({ ok: true, preview }, { ...preview, scope: "bad" as never }), null);
  assert.equal(parsePlatformAdminBackupRestorePreview({ ok: true, preview }, { ...preview, backupId: "" }), null);
});

test("empty restore needs a separate true confirmation; valid body binds the single preview", () => {
  const { preview } = fixture("support_messages", true);
  assert.equal(buildPlatformAdminBackupRestoreRequest(preview, false), null);
  assert.deepEqual(buildPlatformAdminBackupRestoreRequest(preview, true), {
    backupId: preview.backupId, scope: preview.scope, action: "restore", confirmationToken: preview.confirmationToken, confirmEmpty: true,
  });
  assert.equal(buildPlatformAdminBackupRestoreRequest({ ...preview, confirmationToken: "stale" }, true), null);
});

test("destructive transport makes exactly one request on 401, 403, 500 or network failure", async () => {
  const { preview } = fixture();
  for (const status of [401, 403, 500]) {
    const requests: RequestInit[] = [];
    const response = await requestPlatformAdminBackupRestoreOnce(async (url, init) => {
      assert.equal(url, "/api/super-admin/data-backups"); requests.push(init); return new Response("{}", { status });
    }, preview, false);
    assert.equal(response.status, status); assert.equal(requests.length, 1);
    assert.equal(requests[0].credentials, "same-origin"); assert.equal(requests[0].cache, "no-store");
    assert.equal(JSON.parse(String(requests[0].body)).action, "restore");
  }
  let requests = 0;
  await assert.rejects(requestPlatformAdminBackupRestoreOnce(async () => { requests += 1; throw new Error("lost response"); }, preview, false));
  assert.equal(requests, 1);
  await assert.rejects(requestPlatformAdminBackupRestoreOnce(async () => { requests += 1; return new Response(); }, fixture("support_messages", true).preview, false));
  assert.equal(requests, 1);
});

test("valid nonempty real support threads use merchantId, not an invented id field", () => {
  const { preview, response } = fixture();
  assert.equal("id" in thread, false);
  assert.deepEqual(parsePlatformAdminBackupRestoreResult(response, preview), { scope: "support_messages", threads: [thread] });
  assert.ok(parsePlatformAdminBackupRestoreResult({ ...response, threads: [{ ...thread,
    messages: [{ ...thread.messages[0], text: "x".repeat(1_000_001) }] }] }, preview));
  assert.equal(parsePlatformAdminBackupRestoreResult({ ...response, threads: [{ ...thread, merchantId: undefined, id: "invented" }] }, preview), null);
});

test("successful restore requires ok, exact backup id AND date, scope and real result counts", () => {
  for (const scope of ["user_manage", "support_messages"] as const) {
    const { preview, response } = fixture(scope);
    assert.ok(parsePlatformAdminBackupRestoreResult(response, preview));
    for (const changed of [
      { ...response, ok: false }, { ...response, ok: undefined }, { ...response, scope: "other" },
      { ...response, backup: { ...response.backup, id: "different" } },
      { ...response, backup: { ...response.backup, at: "2026-01-01T00:00:00.000Z" } },
      { ...response, platformState: undefined, threads: undefined },
    ]) assert.equal(parsePlatformAdminBackupRestoreResult(changed, preview), null);
  }
  const { preview, backup, response } = fixture("user_manage");
  assert.equal(parsePlatformAdminBackupRestoreResult({ ...response, platformState: { ...backup.snapshot.platformState, version: 0 } }, preview), null);
  assert.equal(parsePlatformAdminBackupRestoreResult({ ...response, platformState: { ...backup.snapshot.platformState, sites: [{}] } }, preview), null);
});

test("invalid support messages cannot be locally applied after server success", () => {
  const { preview, response } = fixture();
  for (const change of [{ sender: "owner" }, { id: "" }, { text: null }, { createdAt: "invalid" }]) {
    assert.equal(parsePlatformAdminBackupRestoreResult({ ...response, threads: [{ ...thread,
      messages: [{ ...thread.messages[0], ...change }] }] }, preview), null);
  }
});

test("only exact status/code pairs without unknown outcomes permit safe pre-write rejection", () => {
  const safe = [[400, "super_admin_backup_restore_preview_required"], [400, "super_admin_backup_restore_empty_confirmation_required"],
    [401, "unauthorized"], [403, "forbidden_origin"], [409, "super_admin_backup_restore_preview_stale"],
    [503, "super_admin_backup_read_unavailable"]] as const;
  for (const [status, error] of safe) {
    assert.equal(isPlatformAdminBackupRestoreRejectedBeforeWrite(status, { error }), true);
    for (const extra of [{ ok: true }, { outcome: "partial_or_unknown" }, { retrySafe: false }]) {
      assert.equal(isPlatformAdminBackupRestoreRejectedBeforeWrite(status, { error, ...extra }), false);
    }
    assert.equal(isPlatformAdminBackupRestoreRejectedBeforeWrite(500, { error }), false);
  }
  for (const value of [null, {}, { error: "unknown" }]) assert.equal(isPlatformAdminBackupRestoreRejectedBeforeWrite(409, value), false);
  assert.match(platformAdminBackupRestoreFailureMessage("wrong", 409), /可能已有部分写入/);
  assert.match(platformAdminBackupRestoreFailureMessage("super_admin_backup_restore_preview_stale", 500), /可能已有部分写入/);
});

test("new atomic not-found and shadow rejections require explicit not_started before manual re-preview", () => {
  for (const [status, error] of [[404, "super_admin_backup_not_found"], [503, "platform_snapshot_atomic_shadow_unsupported"]] as const) {
    assert.equal(isPlatformAdminBackupRestoreRejectedBeforeWrite(status, { error, outcome: "not_started" }), true);
    assert.equal(isPlatformAdminBackupRestoreRejectedBeforeWrite(status, { error }), false);
    for (const extra of [{ ok: true }, { retrySafe: false }, { outcome: "partial_or_unknown" }, { outcome: null }, { outcome: "unknown" }]) {
      assert.equal(isPlatformAdminBackupRestoreRejectedBeforeWrite(status, { error, outcome: "not_started", ...extra }), false);
    }
    assert.equal(isPlatformAdminBackupRestoreRejectedBeforeWrite(500, { error, outcome: "not_started" }), false);
    assert.match(platformAdminBackupRestoreFailureMessage(error, status), /尚未开始恢复/);
    assert.match(platformAdminBackupRestoreFailureMessage(error, 500), /可能已有部分写入/);
  }
});

test("legacy pre-write codes preserve compatibility but never accept explicit unknown outcome values", () => {
  for (const [status, error] of [[409, "super_admin_backup_restore_preview_stale"],
    [400, "super_admin_backup_restore_empty_confirmation_required"], [503, "super_admin_backup_read_unavailable"]] as const) {
    assert.equal(isPlatformAdminBackupRestoreRejectedBeforeWrite(status, { error }), true);
    assert.equal(isPlatformAdminBackupRestoreRejectedBeforeWrite(status, { error, outcome: "not_started" }), true);
    for (const outcome of [undefined, null, false, 0, {}, [], "", "NOT_STARTED", "committed", "partial_or_unknown"]) {
      assert.equal(isPlatformAdminBackupRestoreRejectedBeforeWrite(status, { error, outcome }), false);
    }
    assert.equal(isPlatformAdminBackupRestoreRejectedBeforeWrite(status, { error, outcome: "not_started", retrySafe: false }), false);
  }
});

test("authoritative reread validates real schema before normalizing and preserves one revision", () => {
  const payload = { revision: "snapshot-new", snapshot: [], defaultSortRule: "created_desc", merchantConfigHistoryBySiteId: {} };
  assert.deepEqual(parsePlatformAdminBackupRestoreAuthoritativeSnapshot({ ok: true, payload }), payload);
  for (const value of [null, {}, { ok: true }, { ok: false, payload }, { ok: true, payload: { revision: 123 } },
    { ok: true, payload: { ...payload, revision: "" } },
    { ok: true, payload: { ...payload, snapshot: [{ id: "bad-id" }] } },
    { ok: true, payload: { ...payload, defaultSortRule: "bad-sort" } },
    { ok: true, payload: { ...payload, merchantConfigHistoryBySiteId: null } }]) {
    assert.equal(parsePlatformAdminBackupRestoreAuthoritativeSnapshot(value), null);
  }
});

test("generation guard rejects stale A/B, changed scope, cancelled, logout and late execution replies", () => {
  const guard = createPlatformAdminBackupRestoreRequestGuard();
  const previewA = guard.begin(); const previewB = guard.begin();
  assert.equal(guard.isCurrent(previewA), false); assert.equal(guard.isCurrent(previewB), true);
  const execution = guard.begin(); assert.equal(guard.isCurrent(previewB), false);
  guard.invalidate(); assert.equal(guard.isCurrent(execution), false);
});

test("real snapshot POST compact acknowledgement is valid without a GET directory", () => {
  const acknowledgement = { ok: true, count: 1, defaultSortRule: "created_desc", revision: "snapshot-saved",
    payload: { revision: "snapshot-saved" } };
  assert.equal(parsePlatformAdminBackupRestoreSnapshotWriteAck(acknowledgement), "snapshot-saved");
  assert.equal(parsePlatformAdminBackupRestoreAuthoritativeSnapshot(acknowledgement), null);
  for (const value of [null, {}, { ok: true }, { ok: true, payload: {} }, { ok: true, payload: { revision: "" } },
    { ok: true, payload: { revision: 123 } }, { ...acknowledgement, revision: "different" }, { ...acknowledgement, ok: false }]) {
    assert.equal(parsePlatformAdminBackupRestoreSnapshotWriteAck(value), null);
  }
});

test("pause waits for page-local writers and invalidates late callbacks before a read-only preview", async () => {
  const guard = createPlatformAdminBackupRestoreSyncGuard(); const gate = deferred<void>(); let applied = false;
  const writer = guard.runWrite(async (isCurrent) => { await gate.promise; applied = isCurrent(); });
  let finished = false; const pause = guard.pause().then((known) => { finished = true; return known; });
  await Promise.resolve(); assert.equal(finished, false); assert.equal(guard.isPaused(), true);
  assert.equal(guard.resume(), false);
  await assert.rejects(guard.runWrite(async () => { throw new Error("must not send"); }), /sync_paused/);
  gate.resolve(); await writer; assert.equal(await pause, true); assert.equal(applied, false);
  assert.equal(guard.resume(), true); assert.equal(guard.isPaused(), false);
});

test("unknown writer failure and timed out wait never unlock sync; delayed completion cannot apply", async () => {
  const failed = createPlatformAdminBackupRestoreSyncGuard();
  await assert.rejects(failed.runWrite(async () => { throw new Error("lost response"); }));
  assert.equal(await failed.pause(), false); assert.equal(failed.resume(), false);
  const guard = createPlatformAdminBackupRestoreSyncGuard(); const gate = deferred<void>(); let applied = false;
  const pending = guard.runWrite(async (current) => { await gate.promise; applied = current(); });
  assert.equal(await guard.pause(5), false); assert.equal(guard.resume(), false);
  gate.resolve(); await pending; assert.equal(applied, false); assert.equal(guard.resume(), false);
});

test("known conflict returns through guard before UI throws and does not poison later preview", async () => {
  const guard = createPlatformAdminBackupRestoreSyncGuard();
  const outcome = await guard.runWrite(async () => "conflict");
  assert.equal(outcome, "conflict"); assert.equal(await guard.pause(), true); assert.equal(guard.resume(), true);
  guard.block(); assert.equal(guard.resume(), false);
});

test("response-body deadline and abort include a never-ending body after headers already arrived", async () => {
  const hanging = () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{"ok":')); } }));
  await assert.rejects(readPlatformAdminBackupRestoreJson(hanging(), 5), /response_unconfirmed/);
  const controller = new AbortController();
  const body = readPlatformAdminBackupRestoreJson(hanging(), 1000, controller.signal); controller.abort();
  await assert.rejects(body, /response_unconfirmed/);
  await assert.rejects(readPlatformAdminBackupRestoreJson(hanging(), 1000, controller.signal), /response_unconfirmed/);
  assert.deepEqual(await readPlatformAdminBackupRestoreJson(Response.json({ ok: true }), 1000), { ok: true });
});

test("actual UI consumes one preview, waits writers, checks local save, and aligns authoritative state", () => {
  const source = readFileSync(new URL("../app/super-admin/SuperAdminClient.tsx", import.meta.url), "utf8");
  const restore = source.slice(source.indexOf("async function confirmDataBackupRestoreAction()"), source.indexOf("async function sendSupportReplyAction()"));
  assert.match(restore, /requestPlatformAdminBackupRestoreOnce/);
  assert.doesNotMatch(restore, /requestDataBackupsWithSessionRecovery/);
  assert.match(restore, /isPlatformAdminBackupRestoreRejectedBeforeWrite\(response.status, payload\)/);
  assert.match(restore, /applyServerMerchantSnapshotPayloadToState\(result.platformState, authoritative\)/);
  assert.match(restore, /if \(!savePlatformState\(nextState\)\)/);
  assert.match(restore, /platformSnapshotRevisionRef.current = authoritative.revision/);
  const supportOnly = restore.slice(restore.indexOf("applySupportThreadsState(result.threads)"));
  assert.doesNotMatch(supportOnly, /platformSnapshotRevisionRef.current =|setPlatformSnapshotServerReady/);
  assert.ok(source.includes("await dataBackupRestoreSyncGuardRef.current.pause()"));
  assert.ok(source.includes("dataBackupPreviewLocalStateRef.current !== state"));
  assert.equal(source.match(/response.ok && !parsePlatformAdminBackupRestoreSnapshotWriteAck\(result\)/g)?.length, 2);
});

test("actual shared dialog separately gates empty targets and all controls during execution", () => {
  const source = readFileSync(new URL("../components/admin/PlatformAdminBackupRestoreDialog.tsx", import.meta.url), "utf8");
  assert.match(source, /role="dialog" aria-modal="true"/);
  assert.match(source, /disabled=\{submitting \|\| \(preview.requiresEmptyConfirmation && !confirmEmpty\)\}/);
  assert.match(source, /checked=\{confirmEmpty\} disabled=\{submitting\}/);
  assert.match(source, /未核对（浏览器）/);
  assert.match(source, /不保证原子性/);
});
