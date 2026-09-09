import assert from "node:assert/strict";
import test from "node:test";
import { isDeepStrictEqual } from "node:util";
import { normalizePlatformState } from "@/data/platformControlStore";
import { createPlatformAdminDataBackupHandlers } from "./platformAdminDataBackupRoute";
import { createPlatformAdminBackupRestoreReceiptGET } from "./platformAdminBackupRestoreReceiptRoute";
import { buildPlatformAdminDataBackupBlocks, createPlatformAdminDataBackupEntry } from "./platformAdminDataBackup";
import { buildPlatformMerchantSnapshotBlocks, normalizePlatformMerchantSnapshotPayload } from "./platformMerchantSnapshot";
import { buildPlatformMerchantConfigArchiveBlocks } from "./platformMerchantConfigArchive";
import { buildPlatformSupportInboxBlocks } from "./platformSupportInbox";
import { PLATFORM_SNAPSHOT_ATOMIC_SCOPES, type PlatformSnapshotAtomicClient, type PlatformSnapshotAtomicScope,
  type PlatformSnapshotAtomicView, type PlatformSnapshotAtomicWrite, type PlatformSnapshotRestoreAtomicScope,
  type PlatformSnapshotRestoreAtomicView, type PlatformSnapshotJson } from "./platformSnapshotAtomic.server";
import type { PlatformSnapshotRestoreReceipt } from "./platformSnapshotRestoreReceipt.server";
import { buildPlatformAdminBackupRestoreRequest, createPlatformAdminBackupRestoreSyncGuard,
  parsePlatformAdminBackupRestorePreview, parsePlatformAdminBackupRestoreResult,
  requestPlatformAdminBackupRestoreOnce } from "./platformAdminBackupRestoreClient";
import { createPlatformAdminBackupRestoreReceiptAttempt, lookupPlatformAdminBackupRestoreReceiptForAttempt,
  parsePlatformAdminBackupRestoreReceiptReply } from "./platformAdminBackupRestoreReceiptWorkflow";

// In-process integration of production client helpers and handler factories.
// Only authorization/session responses and SQL RPCs are synthetic. No HTTP,
// external Auth, database connection, storage, retries or browser is involved.
function fixture(t: { after(fn: () => void): void }, scope: PlatformSnapshotRestoreAtomicScope = "user_manage") {
  const flags = ["FAOLLA_PLATFORM_SNAPSHOT_WRITE_MODE", "MERCHANT_CONVERSATION_V1_DUAL_WRITE_MODE", "MERCHANT_CONVERSATION_V1_DUAL_WRITE_SITE_IDS"];
  const previous = flags.map((name) => process.env[name]);
  t.after(() => flags.forEach((name, index) => {
    if (previous[index] === undefined) delete process.env[name]; else process.env[name] = previous[index];
  }));
  process.env[flags[0]] = "atomic"; process.env[flags[1]] = "off"; process.env[flags[2]] = "";
  const at = "2026-09-09T12:00:00.123456Z";
  const snapshot = normalizePlatformMerchantSnapshotPayload({ revision: "synthetic", snapshot: [],
    defaultSortRule: "created_desc", merchantConfigHistoryBySiteId: {} });
  const archive = { backups: [], audits: [] }; const inbox = { threads: [] };
  const backup = createPlatformAdminDataBackupEntry({ source: "manual", operator: "synthetic", snapshot: {
    platformState: normalizePlatformState({}), merchantSnapshot: snapshot,
    merchantConfigArchive: archive, supportInbox: inbox, merchantAccounts: [],
  } });
  const make = (kind: PlatformSnapshotAtomicScope, offset: number): PlatformSnapshotAtomicView => ({ version: 1, scope: kind,
    rows: PLATFORM_SNAPSHOT_ATOMIC_SCOPES[kind].map((slug, index) => ({ slug, row: {
      id: `00000000-0000-4000-8000-${String(offset + index).padStart(12, "0")}`, updatedAt: at,
      blocks: (kind === "backup_catalog" ? buildPlatformAdminDataBackupBlocks({ backups: [backup] })
        : kind === "user_manage" ? slug.includes("config_archive") ? buildPlatformMerchantConfigArchiveBlocks(archive)
          : buildPlatformMerchantSnapshotBlocks(snapshot)
          : slug.includes("inbox_history") ? { siteId: "platform-support-inbox", updatedAt: null, entries: [] }
            : buildPlatformSupportInboxBlocks(inbox)) as unknown as PlatformSnapshotJson,
    } })) });
  const state: PlatformSnapshotRestoreAtomicView = { version: 1, scope, catalog: make("backup_catalog", 1), target: make(scope, 3) };
  let deviceId: string | null = "verified-synthetic-a"; let fault = "";
  let afterReceipt: (() => void) | null = null;
  const rpcCalls: string[] = []; const requests: Array<{ method: string; path: string; body: Record<string, unknown> | null }> = [];
  const receipts = new Map<string, PlatformSnapshotRestoreReceipt>();
  const client: PlatformSnapshotAtomicClient = { rpc: async (name, args) => {
    rpcCalls.push(name);
    if (name === "faolla_read_platform_snapshot_restore_v1") return { error: null, data: structuredClone(state) };
    if (name === "faolla_read_platform_snapshot_restore_receipt_v1") {
      const existing = receipts.get(String(args.p_operation_id));
      const matches = existing && existing.actorKey === args.p_actor_key && existing.scope === args.p_scope &&
        existing.backupId === args.p_backup_id && existing.confirmationToken === args.p_confirmation_token;
      return { error: null, data: { version: 1, receipt: matches ? structuredClone(existing) : null } };
    }
    assert.equal(name, "faolla_commit_platform_snapshot_restore_receipt_v1");
    assert.deepEqual(args.p_catalog_expected, state.catalog.rows); assert.deepEqual(args.p_target_expected, state.target.rows);
    const writes = args.p_writes as PlatformSnapshotAtomicWrite[];
    for (const [index, entry] of state.target.rows.entries()) {
      assert.ok(entry.row);
      if (!isDeepStrictEqual(entry.row.blocks, writes[index].blocks)) {
        entry.row.blocks = structuredClone(writes[index].blocks); entry.row.updatedAt = "2026-09-09T12:00:01.123456Z";
      }
    }
    const receipt: PlatformSnapshotRestoreReceipt = { version: 1, operationId: String(args.p_operation_id), scope,
      actorKey: String(args.p_actor_key), backupId: String(args.p_backup_id), confirmationToken: String(args.p_confirmation_token),
      planHash: "c".repeat(64), resultHash: "d".repeat(64), committedAt: at };
    receipts.set(receipt.operationId, receipt);
    if (fault === "rpc-lost-ack") throw new Error("synthetic ACK loss");
    return { error: null, data: { version: 1, receipt, replayed: fault === "rpc-replay",
      result: fault === "rpc-replay" ? null : structuredClone(state) } };
  } };
  const session = async () => deviceId ? { deviceId } : null;
  const handlers = createPlatformAdminDataBackupHandlers({ authorize: async () => deviceId !== null,
    readAuthorizedSession: session, createClient: () => client });
  const getReceipt = createPlatformAdminBackupRestoreReceiptGET({ readAuthorizedSession: session, createClient: () => client, readMode: () => "atomic" });
  const fetcher = async (path: string, init: RequestInit): Promise<Response> => {
    const url = new URL(path, "https://synthetic.invalid"); const method = init.method ?? "GET";
    const body = typeof init.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : null;
    requests.push({ method, path: url.pathname, body });
    assert.equal(init.credentials, "same-origin"); assert.equal(init.cache, "no-store");
    if (url.pathname === "/api/super-admin/auth/session") {
      assert.equal(method, "GET"); return Response.json(deviceId ? { ok: true, authenticated: true, deviceId }
        : { ok: false, authenticated: false }, { status: deviceId ? 200 : 401 });
    }
    const headers = new Headers(init.headers); if (method === "PATCH") headers.set("origin", url.origin);
    const request = new Request(url, { ...init, headers });
    if (url.pathname === "/api/super-admin/data-backups/restore-operations") {
      assert.equal(method, "GET"); const response = await getReceipt(request); afterReceipt?.(); return response;
    }
    assert.equal(url.pathname, "/api/super-admin/data-backups"); assert.equal(method, "PATCH");
    const response = await handlers.PATCH(request);
    if (body?.action === "restore" && fault === "transport-lost-response") {
      assert.equal(response.status, 200); throw new Error("synthetic response dropped after handler committed");
    }
    return response;
  };
  return { fetcher, requests, rpcCalls, state, setDevice(value: string | null) { deviceId = value; },
    setFault(value: string) { fault = value; }, afterReceipt(fn: () => void) { afterReceipt = fn; },
    restores: () => requests.filter((item) => item.body?.action === "restore"),
    async begin() {
      const response = await fetcher("/api/super-admin/data-backups", { method: "PATCH", credentials: "same-origin", cache: "no-store",
        headers: { "content-type": "application/json" }, body: JSON.stringify({ backupId: backup.id, scope, action: "preview" }) });
      assert.equal(response.status, 200);
      const preview = parsePlatformAdminBackupRestorePreview(await response.json(), { backupId: backup.id, scope }); assert.ok(preview);
      assert.ok(deviceId); const attempt = createPlatformAdminBackupRestoreReceiptAttempt(preview, true, deviceId);
      return { preview, attempt };
    },
  };
}

for (const scope of ["user_manage", "support_messages"] as const) {
  test(`in-process ${scope}: preview creates one operation and the first response binds a valid receipt plus business result`, async (t) => {
    const f = fixture(t, scope); const { preview, attempt } = await f.begin();
    const body = buildPlatformAdminBackupRestoreRequest(preview, true, attempt.binding.operationId); assert.ok(body);
    assert.equal(Object.hasOwn(body, "deviceId"), false); assert.equal(Object.hasOwn(body, "actorKey"), false);
    const response = await requestPlatformAdminBackupRestoreOnce(f.fetcher, preview, true, undefined, attempt.binding.operationId);
    assert.equal(response.status, 200); const value = await response.json();
    const receipt = parsePlatformAdminBackupRestoreReceiptReply(value, attempt); assert.ok(receipt);
    assert.equal(receipt.replayed, false); assert.ok(parsePlatformAdminBackupRestoreResult(value, preview));
    assert.equal(f.restores().length, 1); assert.deepEqual(f.restores()[0].body, body);
    assert.equal(f.rpcCalls.filter((name) => name.includes("commit")).length, 1);
  });

  test(`in-process ${scope}: lost HTTP-like response resolves through GET only and never sends a second restore`, async (t) => {
    const f = fixture(t, scope); const { preview, attempt } = await f.begin(); f.setFault("transport-lost-response");
    await assert.rejects(requestPlatformAdminBackupRestoreOnce(f.fetcher, preview, true, undefined, attempt.binding.operationId), /synthetic response dropped/);
    const before = structuredClone(f.state); const requestCount = f.requests.length;
    const guard = createPlatformAdminBackupRestoreSyncGuard(); guard.block();
    const result = await lookupPlatformAdminBackupRestoreReceiptForAttempt(f.fetcher, attempt);
    assert.equal(result.outcome, "committed"); assert.equal(result.receipt?.operationId, attempt.binding.operationId);
    assert.deepEqual(f.requests.slice(requestCount).map((item) => [item.method, item.path]), [
      ["GET", "/api/super-admin/auth/session"], ["GET", "/api/super-admin/data-backups/restore-operations"], ["GET", "/api/super-admin/auth/session"],
    ]);
    assert.equal(f.restores().length, 1); assert.equal(f.rpcCalls.filter((name) => name.includes("commit")).length, 1);
    assert.deepEqual(f.state, before); assert.equal(guard.resume(), false); assert.equal(guard.isPaused(), true);
  });
}

test("in-process committed RPC ACK loss produces unknown PATCH then a metadata-only successful lookup", async (t) => {
  const f = fixture(t); const { preview, attempt } = await f.begin(); f.setFault("rpc-lost-ack");
  const response = await requestPlatformAdminBackupRestoreOnce(f.fetcher, preview, true, undefined, attempt.binding.operationId);
  const value = await response.json(); assert.equal(response.status, 500); assert.equal(value.outcome, "partial_or_unknown");
  assert.equal(parsePlatformAdminBackupRestoreReceiptReply(value, attempt), null);
  assert.equal((await lookupPlatformAdminBackupRestoreReceiptForAttempt(f.fetcher, attempt)).outcome, "committed");
  assert.equal(f.restores().length, 1); assert.equal(f.rpcCalls.filter((name) => name.includes("commit")).length, 1);
});

test("in-process RPC replay accepts only metadata and cannot smuggle business state into application", async (t) => {
  const f = fixture(t); const { preview, attempt } = await f.begin(); f.setFault("rpc-replay");
  const value = await (await requestPlatformAdminBackupRestoreOnce(f.fetcher, preview, true, undefined, attempt.binding.operationId)).json();
  const receipt = parsePlatformAdminBackupRestoreReceiptReply(value, attempt); assert.ok(receipt); assert.equal(receipt.replayed, true);
  assert.equal(parsePlatformAdminBackupRestoreResult(value, preview), null);
  assert.equal(parsePlatformAdminBackupRestoreReceiptReply({ ...value, platformState: {} }, attempt), null);
  assert.equal(Object.hasOwn(value.receipt, "actorKey"), false); assert.equal(f.restores().length, 1);
});

test("in-process changed device rejects the captured preview and lookup fails before querying a foreign receipt", async (t) => {
  const f = fixture(t); const { preview, attempt } = await f.begin(); f.setDevice("verified-synthetic-b");
  const response = await requestPlatformAdminBackupRestoreOnce(f.fetcher, preview, true, undefined, attempt.binding.operationId);
  assert.equal(response.status, 409); assert.equal((await response.json()).outcome, "not_started");
  const calls = f.rpcCalls.length;
  await assert.rejects(lookupPlatformAdminBackupRestoreReceiptForAttempt(f.fetcher, attempt), /super_admin_backup_restore_identity_unconfirmed/);
  assert.equal(f.rpcCalls.length, calls); assert.equal(f.rpcCalls.filter((name) => name.includes("commit")).length, 0);
});

test("in-process device switch after a matching receipt response discards the result at the final identity check", async (t) => {
  const f = fixture(t); const { preview, attempt } = await f.begin();
  await requestPlatformAdminBackupRestoreOnce(f.fetcher, preview, true, undefined, attempt.binding.operationId);
  f.afterReceipt(() => f.setDevice("verified-synthetic-b"));
  await assert.rejects(lookupPlatformAdminBackupRestoreReceiptForAttempt(f.fetcher, attempt), /super_admin_backup_restore_identity_unconfirmed/);
  assert.equal(f.restores().length, 1); assert.equal(f.rpcCalls.filter((name) => name.includes("commit")).length, 1);
});

test("in-process absent receipt remains unknown and does not unlock or attempt any restore", async (t) => {
  const f = fixture(t); const { attempt } = await f.begin(); const guard = createPlatformAdminBackupRestoreSyncGuard(); guard.block();
  assert.deepEqual(await lookupPlatformAdminBackupRestoreReceiptForAttempt(f.fetcher, attempt), { ok: true, outcome: "unknown", receipt: null });
  assert.equal(f.restores().length, 0); assert.equal(guard.resume(), false);
});

test("in-process receipt reply rejects a substituted operation even when the handler response otherwise succeeded", async (t) => {
  const f = fixture(t); const { preview, attempt } = await f.begin();
  const value = await (await requestPlatformAdminBackupRestoreOnce(f.fetcher, preview, true, undefined, attempt.binding.operationId)).json();
  const otherAttempt = createPlatformAdminBackupRestoreReceiptAttempt(preview, true, attempt.deviceId);
  assert.notEqual(otherAttempt.binding.operationId, attempt.binding.operationId);
  assert.equal(parsePlatformAdminBackupRestoreReceiptReply(value, otherAttempt), null); assert.equal(f.restores().length, 1);
});
