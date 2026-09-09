import assert from "node:assert/strict";
import test from "node:test";
import { normalizePlatformState } from "@/data/platformControlStore";
import { createPlatformAdminDataBackupEntry, buildPlatformAdminDataBackupBlocks,
  type PlatformAdminDataBackupPayload } from "./platformAdminDataBackup";
import { loadPlatformAdminDataBackupsAtomic, savePlatformAdminDataBackupsAtomic } from "./platformAdminDataBackupAtomic.server";
import { loadStoredPlatformAdminDataBackups, savePlatformAdminDataBackups,
  type PlatformAdminDataBackupStoreClient } from "./platformAdminDataBackupStore";
import { createPlatformAdminDataBackupHandlers } from "./platformAdminDataBackupRoute";
import { PLATFORM_SNAPSHOT_ATOMIC_SCOPES, type PlatformSnapshotAtomicView, type PlatformSnapshotAtomicClient,
  type PlatformSnapshotAtomicWrite, type PlatformSnapshotJson } from "./platformSnapshotAtomic.server";

function entry(id = "backup-1", day = 1) {
  const backup = createPlatformAdminDataBackupEntry({ source: "manual", operator: "synthetic",
    snapshot: { platformState: normalizePlatformState({}), merchantSnapshot: null,
      merchantConfigArchive: { audits: [], backups: [] }, supportInbox: { threads: [] }, merchantAccounts: [] } });
  backup.id = id; backup.at = new Date(Date.UTC(2026, 8, day)).toISOString(); return backup;
}
function mock(payload: PlatformAdminDataBackupPayload = { backups: [] }) {
  let view: PlatformSnapshotAtomicView = { version: 1, scope: "backup_catalog",
    rows: PLATFORM_SNAPSHOT_ATOMIC_SCOPES.backup_catalog.map((slug, index) => ({ slug, row: {
      id: `00000000-0000-0000-0000-${String(index + 1).padStart(12, "0")}`,
      blocks: buildPlatformAdminDataBackupBlocks(payload) as unknown as PlatformSnapshotJson,
      updatedAt: "2026-09-08T00:00:00.123456+00:00",
    } })) };
  const calls: string[] = [];
  let failure = "";
  const client: PlatformSnapshotAtomicClient = { rpc: async (name, args) => {
    calls.push(name);
    assert.equal(args.p_scope, "backup_catalog");
    if (failure) return { data: null, error: { code: "P0001", message: failure, detail: "private@example.invalid" } };
    if (name === "faolla_read_platform_snapshot_rows_v1") return { data: structuredClone(view), error: null };
    assert.equal(name, "faolla_commit_platform_snapshot_rows_v1");
    assert.deepEqual(args.p_expected, view.rows);
    const writes = args.p_writes as PlatformSnapshotAtomicWrite[];
    view = { ...view, rows: view.rows.map((row, i) => ({ slug: row.slug, row: { ...row.row!, blocks: writes[i].blocks } })) };
    return { data: structuredClone(view), error: null };
  } };
  return { client, calls, get view() { return view; }, fail(code: string) { failure = code; } };
}
async function mode<T>(value: string, run: () => Promise<T>) {
  const original = process.env.FAOLLA_PLATFORM_SNAPSHOT_WRITE_MODE;
  process.env.FAOLLA_PLATFORM_SNAPSHOT_WRITE_MODE = value;
  try { return await run(); } finally {
    if (original === undefined) delete process.env.FAOLLA_PLATFORM_SNAPSHOT_WRITE_MODE;
    else process.env.FAOLLA_PLATFORM_SNAPSHOT_WRITE_MODE = original;
  }
}
test("catalog reads a complete fresh RPC view and validates immutable copies", async () => {
  const payload = { backups: [entry()] }; const state = mock(payload);
  assert.deepEqual(await loadPlatformAdminDataBackupsAtomic(state.client), payload);
  assert.deepEqual(state.calls, ["faolla_read_platform_snapshot_rows_v1"]);
});
test("catalog append uses its actual business baseline and one physical CAS commit", async () => {
  const baseline = { backups: [entry()] }; const next = { backups: [entry("backup-2", 2), ...baseline.backups] };
  const state = mock(baseline);
  assert.deepEqual(await savePlatformAdminDataBackupsAtomic(state.client, next, baseline), next);
  assert.deepEqual(state.calls, ["faolla_read_platform_snapshot_rows_v1", "faolla_commit_platform_snapshot_rows_v1"]);
});
test("eight previous backups plus a new entry retain the latest eight only after raw validation", async () => {
  const baseline = { backups: Array.from({ length: 8 }, (_, i) => entry(`backup-${8 - i}`, 8 - i)) };
  const next = { backups: [entry("backup-9", 9), ...baseline.backups] }; const state = mock(baseline);
  const saved = await savePlatformAdminDataBackupsAtomic(state.client, next, baseline);
  assert.equal(saved.backups.length, 8); assert.equal(saved.backups[0].id, "backup-9"); assert.equal(saved.backups[7].id, "backup-2");
});
test("a newer catalog read during save cannot legitimize a stale prepared overwrite", async () => {
  const baseline = { backups: [entry()] }; const latest = { backups: [entry("concurrent", 3), ...baseline.backups] };
  const state = mock(latest);
  await assert.rejects(savePlatformAdminDataBackupsAtomic(state.client, { backups: [entry("stale-append", 2), ...baseline.backups] }, baseline),
    { message: "platform_snapshot_atomic_conflict" });
  assert.equal(state.calls.length, 1);
});
test("catalog baseline is required before any read and existing IDs cannot be rewritten", async () => {
  const baseline = { backups: [entry()] }; const state = mock(baseline);
  await assert.rejects(savePlatformAdminDataBackupsAtomic(state.client, baseline, undefined), { message: "platform_snapshot_atomic_baseline_required" });
  assert.equal(state.calls.length, 0);
  const changed = structuredClone(baseline); changed.backups[0].operator = "changed";
  await assert.rejects(savePlatformAdminDataBackupsAtomic(state.client, changed, baseline));
  assert.equal(state.calls.length, 1);
});
test("corrupt physical copies and RPC errors are not replaced or retried", async () => {
  const state = mock({ backups: [entry()] });
  state.view.rows[1].row!.blocks = [];
  await assert.rejects(savePlatformAdminDataBackupsAtomic(state.client, { backups: [] }, { backups: [] }));
  assert.equal(state.calls.length, 1);
  const failed = mock(); failed.fail("platform_snapshot_atomic_store_corrupt");
  await assert.rejects(loadPlatformAdminDataBackupsAtomic(failed.client), { message: "platform_snapshot_atomic_store_corrupt" });
  assert.equal(failed.calls.length, 1);
});
test("central catalog stores prefer atomic mode over requireAllWrites and never use from/cache", async () => mode("atomic", async () => {
  const state = mock();
  const client = { ...state.client, from() { assert.fail("legacy read/write fallback"); } } as unknown as PlatformAdminDataBackupStoreClient;
  await loadStoredPlatformAdminDataBackups(client); await loadStoredPlatformAdminDataBackups(client);
  const saved = await savePlatformAdminDataBackups(client, { backups: [entry()] }, { requireAllWrites: true, expectedPayload: { backups: [] } });
  assert.equal(saved.error, null); assert.equal(state.calls.length, 4);
}));
test("atomic mode missing RPC and invalid modes never run a legacy read or write", async () => {
  const client = { from() { assert.fail("legacy table access"); } } as unknown as PlatformAdminDataBackupStoreClient;
  for (const value of ["atomic", "atomic "]) await mode(value, async () => {
    await assert.rejects(loadStoredPlatformAdminDataBackups(client));
    assert.ok((await savePlatformAdminDataBackups(client, { backups: [] }, { requireAllWrites: true, expectedPayload: { backups: [] } })).error);
  });
});
function request(action: string, scope: string, origin = "https://launch.faolla.com") {
  return new Request("https://launch.faolla.com/api/super-admin/data-backups", { method: "PATCH",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify({ action, scope, backupId: "synthetic", ...(action === "restore" ? {
      operationId: "11111111-2222-4333-8444-555555555555", confirmationToken: "v1." + "a".repeat(64), confirmEmpty: true,
    } : {}) }) });
}
test("atomic preview and receipt lookup require their RPCs and never fall back when missing", async () => mode("atomic", async () => {
  const calls: string[] = [];
  const handlers = createPlatformAdminDataBackupHandlers({ authorize: async () => true,
    readAuthorizedSession: async () => ({ deviceId: "synthetic-device" }),
    createClient: () => ({ from() { assert.fail("legacy access"); }, rpc(name: string) {
      calls.push(name); return Promise.resolve({ data: null, error: { code: "42883", message: "private missing function detail" } });
    } }) });
  for (const scope of ["user_manage", "support_messages"]) for (const action of ["preview", "restore"]) {
    const response = await handlers.PATCH(request(action, scope));
    assert.equal(response.status, 503); assert.equal(response.headers.get("cache-control"), "no-store");
    const body = await response.json();
    assert.equal(body.error, action === "preview" ? "super_admin_backup_read_unavailable" : "super_admin_backup_restore_incomplete");
    assert.equal(body.outcome, action === "preview" ? "not_started" : "partial_or_unknown");
    assert.equal(body.retrySafe, action === "preview" ? undefined : false);
  }
  assert.deepEqual(calls, ["faolla_read_platform_snapshot_restore_v1", "faolla_read_platform_snapshot_restore_receipt_v1",
    "faolla_read_platform_snapshot_restore_v1", "faolla_read_platform_snapshot_restore_receipt_v1"]);
}));
test("restore mode checks never weaken same-origin or super-admin authorization", async () => mode("atomic", async () => {
  let clientCalls = 0;
  const handlers = createPlatformAdminDataBackupHandlers({ authorize: async () => false,
    createClient: () => { clientCalls++; return {}; } });
  assert.equal((await handlers.PATCH(request("restore", "user_manage"))).status, 401);
  assert.equal((await handlers.PATCH(request("restore", "user_manage", "https://evil.invalid"))).status, 403);
  assert.equal(clientCalls, 0);
}));
test("malformed mode blocks restore without exposing config or touching data", async () => mode("atomic ", async () => {
  const handlers = createPlatformAdminDataBackupHandlers({ authorize: async () => true,
    createClient: () => ({ from() { assert.fail("legacy access"); }, rpc() { assert.fail("RPC access"); } }) });
  const response = await handlers.PATCH(request("restore", "support_messages"));
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "platform_snapshot_atomic_configuration_invalid", outcome: "not_started", retrySafe: false });
}));
