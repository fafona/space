import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { normalizePlatformState } from "@/data/platformControlStore";
import { createPlatformAdminDataBackupEntry } from "./platformAdminDataBackup";
import { buildPlatformAdminBackupRestorePreview } from "./platformAdminBackupRestorePreview.server";
import { buildPlatformAdminBackupRestoreRequest, parsePlatformAdminBackupRestorePreview,
  requestPlatformAdminBackupRestoreOnce, createPlatformAdminBackupRestoreSyncGuard } from "./platformAdminBackupRestoreClient";
import { createPlatformAdminBackupRestoreReceiptAttempt, lookupPlatformAdminBackupRestoreReceiptForAttempt,
  parsePlatformAdminBackupRestoreReceiptReply, readPlatformAdminBackupRestoreIdentityOnce } from "./platformAdminBackupRestoreReceiptWorkflow";

function fixture() {
  const backup = createPlatformAdminDataBackupEntry({ source: "manual", operator: "Synthetic", snapshot: {
    platformState: normalizePlatformState({}), merchantSnapshot: null, merchantConfigArchive: { backups: [], audits: [] },
    supportInbox: { threads: [] }, merchantAccounts: [],
  } });
  const preview = { ...buildPlatformAdminBackupRestorePreview(backup, { scope: "support_messages", supportInbox: { threads: [] } }), receiptProtocol: 1 as const };
  const attempt = createPlatformAdminBackupRestoreReceiptAttempt(preview, true, "verified-device-A");
  const receipt = { version: 1, ...attempt.binding, planHash: "a".repeat(64), resultHash: "b".repeat(64), committedAt: "2026-09-09T10:00:00.000001Z" };
  return { preview, attempt, receipt };
}
const identity = (deviceId = "verified-device-A") => Response.json({ ok: true, authenticated: true, deviceId, deviceLabel: "Synthetic" });
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; };

test("receipt protocol is explicit, typed and preserved; malformed advertised protocol is not downgraded", () => {
  const { preview } = fixture();
  assert.equal(parsePlatformAdminBackupRestorePreview({ ok: true, preview }, preview)?.receiptProtocol, 1);
  for (const receiptProtocol of [0, 2, "1", null, undefined, true]) {
    assert.equal(parsePlatformAdminBackupRestorePreview({ ok: true, preview: { ...preview, receiptProtocol } }, preview), null);
  }
  const { receiptProtocol: _protocol, ...legacy } = preview;
  assert.equal(_protocol, 1);
  assert.equal(parsePlatformAdminBackupRestorePreview({ ok: true, preview: legacy }, preview)?.receiptProtocol, undefined);
});

test("atomic confirm must supply one valid operation; legacy cannot accept a receipt operation", () => {
  const { preview, attempt } = fixture();
  assert.equal(buildPlatformAdminBackupRestoreRequest(preview, true), null);
  assert.equal(buildPlatformAdminBackupRestoreRequest(preview, true, "fake"), null);
  assert.equal(buildPlatformAdminBackupRestoreRequest(preview, false, attempt.binding.operationId), null);
  const body = buildPlatformAdminBackupRestoreRequest(preview, true, attempt.binding.operationId);
  assert.equal(body?.operationId, attempt.binding.operationId);
  assert.ok(body && !Object.hasOwn(body, "actorKey") && !Object.hasOwn(body, "deviceId"));
  const { receiptProtocol: _protocol, ...legacy } = preview;
  assert.equal(_protocol, 1);
  assert.equal(buildPlatformAdminBackupRestoreRequest(legacy, true, attempt.binding.operationId), null);
  assert.ok(buildPlatformAdminBackupRestoreRequest(legacy, true));
});

test("attempt captures immutable public binding and identity and uses distinct strong UUIDs", () => {
  const { preview, attempt } = fixture();
  const another = createPlatformAdminBackupRestoreReceiptAttempt(preview, true, "verified-device-A");
  assert.notEqual(another.binding.operationId, attempt.binding.operationId);
  assert.equal(Object.isFrozen(attempt), true); assert.equal(Object.isFrozen(attempt.binding), true);
  preview.backupId = "changed"; assert.notEqual(attempt.binding.backupId, preview.backupId);
  for (const device of ["", " ", "a".repeat(501)]) assert.throws(() => createPlatformAdminBackupRestoreReceiptAttempt(preview, true, device));
  assert.throws(() => createPlatformAdminBackupRestoreReceiptAttempt({ ...preview, receiptProtocol: undefined }, true, "device"));
});

test("single restore transport consumes supplied binding, rejects abort before I/O and never retries", async () => {
  const { preview, attempt } = fixture(); let calls = 0;
  for (const status of [401, 403, 500]) {
    const before = calls;
    await requestPlatformAdminBackupRestoreOnce(async (url, init) => {
      calls++; assert.equal(url, "/api/super-admin/data-backups"); assert.equal(init.redirect, "error");
      assert.equal(init.mode, "same-origin"); assert.equal(JSON.parse(String(init.body)).operationId, attempt.binding.operationId);
      return new Response(null, { status });
    }, preview, true, undefined, attempt.binding.operationId);
    assert.equal(calls, before + 1);
  }
  const controller = new AbortController(); controller.abort();
  await assert.rejects(requestPlatformAdminBackupRestoreOnce(async () => { calls++; throw new Error(); }, preview, true, controller.signal, attempt.binding.operationId));
  assert.equal(calls, 3);
});

test("first receipt response and metadata-only replay require exact binding and no actor leakage", () => {
  const { attempt, receipt } = fixture();
  const body = { ok: true, scope: attempt.binding.scope, outcome: "committed", receipt, replayed: false };
  assert.equal(parsePlatformAdminBackupRestoreReceiptReply(body, attempt)?.replayed, false);
  assert.equal(parsePlatformAdminBackupRestoreReceiptReply({ ...body, replayed: true }, attempt)?.replayed, true);
  for (const change of [{ ok: false }, { scope: "user_manage" }, { replayed: "false" }, { outcome: "unknown" },
    { receipt: { ...receipt, operationId: "00000000-0000-0000-0000-000000000000" } }, { receipt: { ...receipt, actorKey: "private" } }]) {
    assert.equal(parsePlatformAdminBackupRestoreReceiptReply({ ...body, ...change }, attempt), null);
  }
  for (const key of ["platformState", "threads", "merchantSnapshot", "merchantConfigArchive", "merchantAccounts", "backup", "result"]) {
    assert.equal(parsePlatformAdminBackupRestoreReceiptReply({ ...body, replayed: true, [key]: null }, attempt), null);
  }
});

test("identity check uses a fresh fixed no-store session GET and no local device authority", async () => {
  assert.equal(await readPlatformAdminBackupRestoreIdentityOnce(async (url, init) => {
    assert.equal(url, "/api/super-admin/auth/session"); assert.equal(init.method, "GET");
    assert.equal(init.cache, "no-store"); assert.equal(init.credentials, "same-origin"); assert.equal(init.redirect, "error");
    return identity();
  }), "verified-device-A");
  for (const response of [identity("device-B"), Response.json({ ok: true, authenticated: false, deviceId: "verified-device-A" }),
    new Response(null, { status: 401 }), Response.json({ ok: true, authenticated: true, deviceId: " " })]) {
    await assert.rejects(readPlatformAdminBackupRestoreIdentityOnce(async () => response, { expected: "verified-device-A" }), /identity_unconfirmed/);
  }
});

test("identity body cap, abort and total deadline reject hanging or oversized responses", async () => {
  await assert.rejects(readPlatformAdminBackupRestoreIdentityOnce(async () => new Response(" ".repeat(32769)), { timeoutMs: 100 }), /identity_unconfirmed/);
  const hanging = () => new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('{"ok":')); } }));
  await assert.rejects(readPlatformAdminBackupRestoreIdentityOnce(async () => hanging(), { timeoutMs: 5 }), /identity_unconfirmed/);
  const gate = deferred<Response>(); let cancelled = false;
  await assert.rejects(readPlatformAdminBackupRestoreIdentityOnce(() => gate.promise, { timeoutMs: 5 }), /identity_unconfirmed/);
  gate.resolve(new Response(new ReadableStream({ cancel() { cancelled = true; } })));
  await new Promise((done) => setTimeout(done, 0)); assert.equal(cancelled, true);
  const controller = new AbortController(); controller.abort(); let calls = 0;
  await assert.rejects(readPlatformAdminBackupRestoreIdentityOnce(async () => { calls++; return identity(); }, { signal: controller.signal }));
  assert.equal(calls, 0);
});

test("same identity lookup is GET-only, keeps the original binding and never unlocks unknown writers", async () => {
  const { attempt, receipt } = fixture(); const calls: string[] = [];
  const guard = createPlatformAdminBackupRestoreSyncGuard(); guard.block();
  for (const committed of [true, false]) {
    const result = await lookupPlatformAdminBackupRestoreReceiptForAttempt(async (url, init) => {
      calls.push(url); assert.equal(init.method, "GET"); assert.equal(init.body, undefined);
      return url.endsWith("/auth/session") ? identity() : Response.json({ ok: true, outcome: committed ? "committed" : "unknown", receipt: committed ? receipt : null });
    }, attempt);
    assert.equal(result.outcome, committed ? "committed" : "unknown");
    assert.equal(guard.isPaused(), true); assert.equal(guard.resume(), false);
  }
  assert.equal(calls.length, 6);
  assert.equal(calls.filter((url) => url.includes("/restore-operations?")).length, 2);
  assert.ok(calls.filter((url) => url.includes("/restore-operations?")).every((url) => url.includes(attempt.binding.operationId)));
});

test("wrong identity before lookup denies receipt I/O and identity change after lookup rejects late metadata", async () => {
  const { attempt, receipt } = fixture(); let calls = 0;
  await assert.rejects(lookupPlatformAdminBackupRestoreReceiptForAttempt(async () => { calls++; return identity("device-B"); }, attempt));
  assert.equal(calls, 1); calls = 0;
  await assert.rejects(lookupPlatformAdminBackupRestoreReceiptForAttempt(async () => {
    calls++; return calls === 1 ? identity() : calls === 2 ? Response.json({ ok: true, outcome: "committed", receipt }) : identity("device-B");
  }, attempt));
  assert.equal(calls, 3);
});

test("lookup failures never try login recovery, replace the operation or proceed to additional writes", async () => {
  const { attempt } = fixture();
  for (const status of [401, 403, 503]) {
    let calls = 0;
    await assert.rejects(lookupPlatformAdminBackupRestoreReceiptForAttempt(async () => {
      calls++; return calls === 1 ? identity() : new Response(null, { status });
    }, attempt));
    assert.equal(calls, 2);
  }
});

test("aborted pending lookup rejects its late committed response", async () => {
  const { attempt, receipt } = fixture(); const gate = deferred<Response>(); const controller = new AbortController(); let calls = 0;
  const pending = lookupPlatformAdminBackupRestoreReceiptForAttempt(async () => { calls++; return calls === 1 ? identity() : gate.promise; }, attempt, controller.signal);
  while (calls < 2) await new Promise((done) => setTimeout(done, 0));
  controller.abort(); await assert.rejects(pending);
  gate.resolve(Response.json({ ok: true, outcome: "committed", receipt }));
  await new Promise((done) => setTimeout(done, 0)); assert.equal(calls, 2);
});

test("actual UI query has no apply/unlock/retry path and guards session, unmount and synchronous logout", () => {
  const source = readFileSync(new URL("../app/super-admin/SuperAdminClient.tsx", import.meta.url), "utf8");
  const query = source.slice(source.indexOf("async function queryDataBackupRestoreReceiptAction()"), source.indexOf("async function confirmDataBackupRestoreAction()"));
  assert.match(query, /lookupPlatformAdminBackupRestoreReceiptForAttempt/);
  assert.match(query, /dataBackupReceiptAttemptRef.current === attempt/);
  assert.match(query, /isCurrent\(generation\)/);
  assert.doesNotMatch(query, /\.resume\(|\.block\(|savePlatformState\(|setState\(|setAuthed\(|requestPlatformAdminBackupRestoreOnce\(|dataBackupRestoreAttemptedRef.current\s*=/);
  const confirm = source.slice(source.indexOf("async function confirmDataBackupRestoreAction()"), source.indexOf("void loadDataBackupsAction({ silent: true });"));
  assert.equal(confirm.match(/createPlatformAdminBackupRestoreReceiptAttempt\(/g)?.length, 1);
  assert.ok(confirm.indexOf("dataBackupRestoreBusyRef.current = true") < confirm.indexOf("await readPlatformAdminBackupRestoreIdentityOnce"));
  assert.ok(confirm.indexOf("dataBackupReceiptAttemptRef.current = attempt") < confirm.indexOf("await requestPlatformAdminBackupRestoreOnce"));
  assert.match(confirm, /if \(committed.replayed\)[\s\S]*?\.block\(\);[\s\S]*?return;/);
  assert.match(source, /function logoutSuperAdmin\(\) \{\s*\/\/[^\n]*\n\s*invalidateDataBackupReceiptIdentity\(\)/);
  const identityChange = source.slice(source.indexOf("const invalidateDataBackupReceiptIdentity ="), source.indexOf("useEffect(() => { invalidateDataBackupReceiptIdentity();"));
  assert.match(identityChange, /dataBackupReceiptAttemptRef.current = null/);
  assert.match(identityChange, /setDataBackupReceiptProgress\(null\)/);
  assert.doesNotMatch(identityChange, /\.resume\(|dataBackupRestoreAttemptedRef.current\s*=/);
  assert.match(source, /window.addEventListener\("storage", changed\)/);
  assert.match(source, /window.addEventListener\("pagehide", invalidate\)/);
});
