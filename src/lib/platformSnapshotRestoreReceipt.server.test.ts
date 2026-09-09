import assert from "node:assert/strict";
import test from "node:test";
import { PLATFORM_SNAPSHOT_ATOMIC_SCOPES, type PlatformSnapshotAtomicScope, type PlatformSnapshotAtomicView,
  type PlatformSnapshotRestoreAtomicScope, type PlatformSnapshotRestoreAtomicView } from "./platformSnapshotAtomic.server";
import { commitPlatformSnapshotRestoreReceipt, readPlatformSnapshotRestoreReceipt,
  platformSnapshotRestoreReceiptActorKey, publicPlatformSnapshotRestoreReceipt,
  type PlatformSnapshotRestoreReceiptBinding } from "./platformSnapshotRestoreReceipt.server";

const stamp = "2026-09-09T11:12:13.123456+00:00";
function fixture(scope: PlatformSnapshotRestoreAtomicScope = "user_manage") {
  const make = (kind: PlatformSnapshotAtomicScope, offset: number): PlatformSnapshotAtomicView => ({ version: 1, scope: kind,
    rows: PLATFORM_SNAPSHOT_ATOMIC_SCOPES[kind].map((slug, i) => ({ slug, row: {
      id: `00000000-0000-0000-0000-${String(offset + i).padStart(12, "0")}`, updatedAt: stamp,
      blocks: slug.includes("support_inbox_history") ? { entries: [] } : [],
    } })) });
  const bundle: PlatformSnapshotRestoreAtomicView = { version: 1, scope, catalog: make("backup_catalog", 1), target: make(scope, 3) };
  const binding: PlatformSnapshotRestoreReceiptBinding = { operationId: "00000000-0000-4000-8000-000000000001",
    actorKey: "a".repeat(64), scope, backupId: "备份-1", confirmationToken: `v1.${"b".repeat(64)}` };
  const receipt = { version: 1 as const, ...binding, planHash: "c".repeat(64), resultHash: "d".repeat(64), committedAt: stamp };
  const writes = bundle.target.rows.map(({ slug, row }) => ({ slug, blocks: structuredClone(row!.blocks) }));
  return { bundle, binding, receipt, writes };
}
test("receipt actor derives from verified device identity, not session renewal timestamps", () => {
  const a = { deviceId: "device-a", issuedAt: 1 };
  const b = { ...a, issuedAt: 2 };
  assert.match(platformSnapshotRestoreReceiptActorKey(a), /^[0-9a-f]{64}$/);
  assert.equal(platformSnapshotRestoreReceiptActorKey(a), platformSnapshotRestoreReceiptActorKey(b));
  assert.notEqual(platformSnapshotRestoreReceiptActorKey(a), platformSnapshotRestoreReceiptActorKey({ deviceId: "device-b" }));
  for (const deviceId of ["", " ", "x".repeat(501)]) assert.throws(() => platformSnapshotRestoreReceiptActorKey({ deviceId }), /invalid_request/);
});
for (const scope of ["user_manage", "support_messages"] as const) {
  test(`${scope}: one receipt commit verifies physical target and source`, async () => {
    const { binding, bundle, writes, receipt } = fixture(scope); let calls = 0;
    const result = await commitPlatformSnapshotRestoreReceipt({ rpc: async (name, args) => {
      calls++; assert.equal(name, "faolla_commit_platform_snapshot_restore_receipt_v1");
      assert.equal(args.p_actor_key, binding.actorKey); assert.equal(args.p_operation_id, binding.operationId);
      assert.deepEqual(args.p_catalog_expected, bundle.catalog.rows); assert.deepEqual(args.p_target_expected, bundle.target.rows);
      assert.deepEqual(args.p_writes, writes);
      return { error: null, data: { version: 1, receipt, result: bundle, replayed: false } };
    } }, binding, bundle, writes);
    assert.equal(calls, 1); assert.deepEqual(result, { receipt, result: bundle, replayed: false });
    assert.notEqual(result.receipt, receipt); assert.notEqual(result.result, bundle);
  });
}
test("receipt replay exposes only historical metadata, never a stale physical result", async () => {
  const { binding, bundle, writes, receipt } = fixture(); let calls = 0;
  const replay = await commitPlatformSnapshotRestoreReceipt({ rpc: async () => {
    calls++; return { error: null, data: { version: 1, receipt, result: null, replayed: true } };
  } }, binding, bundle, writes);
  assert.deepEqual(replay, { receipt, result: null, replayed: true }); assert.equal(calls, 1);
  await assert.rejects(commitPlatformSnapshotRestoreReceipt({ rpc: async () => ({ error: null,
    data: { version: 1, receipt, result: bundle, replayed: true } }) }, binding, bundle, writes), /write_unconfirmed/);
});
test("receipt capture prevents caller mutation during delayed RPC", async () => {
  const { binding, bundle, writes, receipt } = fixture(); const captured = structuredClone({ binding, bundle, writes });
  let release!: () => void; const barrier = new Promise<void>((resolve) => { release = resolve; });
  const pending = commitPlatformSnapshotRestoreReceipt({ rpc: async (_name, args) => {
    await barrier;
    assert.equal(args.p_actor_key, captured.binding.actorKey);
    assert.deepEqual(args.p_catalog_expected, captured.bundle.catalog.rows);
    assert.deepEqual(args.p_writes, captured.writes);
    return { error: null, data: { version: 1, receipt, result: captured.bundle, replayed: false } };
  } }, binding, bundle, writes);
  binding.actorKey = "e".repeat(64); binding.backupId = "changed";
  bundle.catalog.rows[0].row!.blocks = [{ changed: true }]; writes[0].blocks = [{ changed: true }];
  release(); assert.deepEqual((await pending).result, captured.bundle);
});
test("malformed/foreign binding and unsafe plans reject before any RPC", async () => {
  for (const [key, value] of [["actorKey", "raw-device"], ["operationId", "not-uuid"], ["scope", "backup_catalog"],
    ["backupId", " space "], ["confirmationToken", "v1.short"], ["extra", true]]) {
    const { binding, bundle, writes } = fixture(); let calls = 0;
    await assert.rejects(commitPlatformSnapshotRestoreReceipt({ rpc: async () => { calls++; throw new Error(); } },
      { ...binding, [key as string]: value }, bundle, writes), /invalid_request/);
    assert.equal(calls, 0);
  }
  const { binding, bundle, writes } = fixture(); let calls = 0;
  const rpc = async () => { calls++; throw new Error(); };
  await assert.rejects(commitPlatformSnapshotRestoreReceipt({ rpc }, { ...binding, scope: "support_messages" }, bundle, writes), /invalid_request/);
  bundle.catalog.rows.forEach((row) => { row.row = null; });
  await assert.rejects(commitPlatformSnapshotRestoreReceipt({ rpc }, binding, bundle, writes), /invalid_request/);
  assert.equal(calls, 0);
});
test("every receipt binding field and exact envelope are verified", async () => {
  const { binding, bundle, writes, receipt } = fixture();
  const altered = [null, { ...receipt, actorKey: "e".repeat(64) }, { ...receipt, operationId: "00000000-0000-4000-8000-000000000002" },
    { ...receipt, scope: "support_messages" }, { ...receipt, backupId: "other" }, { ...receipt, confirmationToken: `v1.${"e".repeat(64)}` },
    { ...receipt, planHash: "x" }, { ...receipt, resultHash: "x" }, { ...receipt, committedAt: "2026-02-30T12:00:00Z" },
    { ...receipt, privateData: "must-not-pass" }];
  for (const fake of altered) await assert.rejects(commitPlatformSnapshotRestoreReceipt({ rpc: async () => ({ error: null,
    data: { version: 1, receipt: fake, result: bundle, replayed: false } }) }, binding, bundle, writes), /write_unconfirmed/);
  for (const envelope of [{ version: 2, receipt, result: bundle, replayed: false },
    { version: 1, receipt, result: null, replayed: false }, { version: 1, receipt, result: bundle, replayed: "false" },
    { version: 1, receipt, result: bundle, replayed: false, extra: true }]) {
    await assert.rejects(commitPlatformSnapshotRestoreReceipt({ rpc: async () => ({ error: null, data: envelope }) }, binding, bundle, writes), /write_unconfirmed/);
  }
});
test("fresh receipt cannot hide source/target body or microsecond tampering", async () => {
  for (const side of ["catalog", "target"] as const) for (const key of ["blocks", "updatedAt"] as const) {
    const { binding, bundle, writes, receipt } = fixture(); const actual = structuredClone(bundle);
    if (key === "blocks") actual[side].rows[0].row!.blocks = [{ altered: true }];
    else actual[side].rows[0].row!.updatedAt = "2026-09-09T11:12:13.123457+00:00";
    await assert.rejects(commitPlatformSnapshotRestoreReceipt({ rpc: async () => ({ error: null,
      data: { version: 1, receipt, result: actual, replayed: false } }) }, binding, bundle, writes), /write_unconfirmed/);
  }
});
test("lost ACK and ambiguous errors never retry or claim no write", async () => {
  const { binding, bundle, writes, receipt } = fixture();
  for (const response of [undefined, { data: { version: 1, receipt, result: bundle, replayed: false } },
    { data: null, error: { code: "NETWORK", message: "platform_snapshot_atomic_conflict" } },
    { data: bundle, error: { code: "P0001", message: "platform_snapshot_atomic_conflict" } }]) {
    let calls = 0;
    await assert.rejects(commitPlatformSnapshotRestoreReceipt({ rpc: async () => { calls++; if (!response) throw new Error("lost"); return response; } },
      binding, bundle, writes), (error: unknown) => error instanceof Error && error.message.endsWith("write_unconfirmed") && "retrySafe" in error && error.retrySafe === false);
    assert.equal(calls, 1);
  }
  await assert.rejects(commitPlatformSnapshotRestoreReceipt({ rpc: async () => ({ data: null,
    error: { code: "P0001", message: "platform_snapshot_atomic_conflict" } }) }, binding, bundle, writes), /atomic_conflict/);
});
test("lookup is one metadata-only RPC; missing stays null and mismatched evidence fails", async () => {
  const { binding, receipt } = fixture();
  for (const stored of [receipt, null]) {
    let calls = 0;
    const found = await readPlatformSnapshotRestoreReceipt({ rpc: async (name, args) => {
      calls++; assert.equal(name, "faolla_read_platform_snapshot_restore_receipt_v1");
      assert.deepEqual(Object.keys(args).sort(), ["p_actor_key", "p_backup_id", "p_confirmation_token", "p_operation_id", "p_scope"]);
      return { error: null, data: { version: 1, receipt: stored } };
    } }, binding);
    assert.deepEqual(found, stored); assert.equal(calls, 1);
  }
  await assert.rejects(readPlatformSnapshotRestoreReceipt({ rpc: async () => ({ error: null,
    data: { version: 1, receipt: { ...receipt, actorKey: "e".repeat(64) } } }) }, binding), /write_unconfirmed/);
  assert.equal(Object.hasOwn(publicPlatformSnapshotRestoreReceipt(receipt), "actorKey"), false);
});
