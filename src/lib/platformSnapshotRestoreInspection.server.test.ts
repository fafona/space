import assert from "node:assert/strict";
import test from "node:test";
import { readPlatformSnapshotRestoreInspection } from "./platformSnapshotRestoreInspection.server";
import type { PlatformSnapshotRestoreReceiptBinding } from "./platformSnapshotRestoreReceipt.server";

function fixture(scope: PlatformSnapshotRestoreReceiptBinding["scope"] = "user_manage") {
  const binding: PlatformSnapshotRestoreReceiptBinding = { operationId: "00000000-0000-4000-8000-000000000001",
    actorKey: "a".repeat(64), scope, backupId: "synthetic-backup", confirmationToken: `v1.${"b".repeat(64)}` };
  const receipt = { version: 1, ...binding, planHash: "c".repeat(64), resultHash: "d".repeat(64), committedAt: "2026-09-09T11:12:13.123456+00:00" };
  const inspection = { version: 1, observedAt: "2026-09-09T14:12:15.654321+02:00", targetState: "matches_commit", targetHash: receipt.resultHash };
  return { binding, receipt, inspection, data: { version: 1, receipt, inspection } };
}

for (const scope of ["user_manage", "support_messages"] as const) {
  test(`inspection ${scope}: exactly one five-argument read captures receipt and matching target metadata`, async () => {
    const f = fixture(scope); let calls = 0;
    const result = await readPlatformSnapshotRestoreInspection({ rpc: async (name, args) => {
      calls++; assert.equal(name, "faolla_inspect_platform_snapshot_restore_receipt_v1");
      assert.deepEqual(args, { p_operation_id: f.binding.operationId, p_actor_key: f.binding.actorKey, p_scope: scope,
        p_backup_id: f.binding.backupId, p_confirmation_token: f.binding.confirmationToken });
      return { error: null, data: f.data };
    } }, f.binding);
    assert.equal(calls, 1); assert.deepEqual(result, { receipt: f.receipt, inspection: f.inspection });
    assert.notEqual(result.receipt, f.receipt); assert.notEqual(result.inspection, f.inspection);
  });
}

test("inspection differences remain a committed historical receipt, with no inferred restore or writes", async () => {
  const f = fixture(); const inspection = { ...f.inspection, targetState: "differs_from_commit", targetHash: "e".repeat(64) };
  const result = await readPlatformSnapshotRestoreInspection({ rpc: async () => ({ error: null, data: { ...f.data, inspection } }) }, f.binding);
  assert.deepEqual(result, { receipt: f.receipt, inspection });
});

test("unknown receipt requires exactly null inspection and never invents current data", async () => {
  const f = fixture(); let calls = 0;
  const result = await readPlatformSnapshotRestoreInspection({ rpc: async () => {
    calls++; return { error: null, data: { version: 1, receipt: null, inspection: null } };
  } }, f.binding);
  assert.deepEqual(result, { receipt: null, inspection: null }); assert.equal(calls, 1);
  for (const data of [{ version: 1, receipt: null, inspection: f.inspection }, { version: 1, receipt: f.receipt, inspection: null }]) {
    await assert.rejects(readPlatformSnapshotRestoreInspection({ rpc: async () => ({ error: null, data }) }, f.binding), /inspection_unconfirmed/);
  }
});

test("inspection captures all binding primitives before await and returns detached data", async () => {
  const f = fixture(); const expected = structuredClone(f.binding); let release!: () => void;
  const barrier = new Promise<void>((resolve) => { release = resolve; });
  const response = structuredClone(f.data);
  const running = readPlatformSnapshotRestoreInspection({ rpc: async (_name, args) => {
    await barrier; assert.equal(args.p_actor_key, expected.actorKey); assert.equal(args.p_backup_id, expected.backupId);
    return { error: null, data: response };
  } }, f.binding);
  f.binding.actorKey = "f".repeat(64); f.binding.backupId = "mutated"; release();
  const result = await running; response.inspection.targetHash = "e".repeat(64);
  assert.equal(result.receipt?.actorKey, expected.actorKey); assert.equal(result.inspection?.targetHash, "d".repeat(64));
});

test("invalid binding and timeout options fail before any RPC", async () => {
  const { binding } = fixture(); let calls = 0; const rpc = async () => { calls++; throw new Error("must not call"); };
  for (const change of [{ actorKey: "raw-device" }, { scope: "backup_catalog" }, { operationId: "invalid" },
    { backupId: " space " }, { confirmationToken: "v1.short" }, { extra: "PRIVATE" }]) {
    await assert.rejects(readPlatformSnapshotRestoreInspection({ rpc }, { ...binding, ...change } as PlatformSnapshotRestoreReceiptBinding), /invalid_request/);
  }
  for (const timeoutMs of [0, -1, 0.5, NaN, 60_001]) {
    await assert.rejects(readPlatformSnapshotRestoreInspection({ rpc }, binding, { timeoutMs }), /invalid_request/);
  }
  assert.equal(calls, 0);
});

test("receipt identity, exact metadata, calendar and target hash consistency all fail closed", async () => {
  const f = fixture();
  const receipts: unknown[] = [
    { ...f.receipt, actorKey: "e".repeat(64) }, { ...f.receipt, operationId: "00000000-0000-4000-8000-000000000002" },
    { ...f.receipt, scope: "support_messages" }, { ...f.receipt, backupId: "other" },
    { ...f.receipt, confirmationToken: `v1.${"e".repeat(64)}` }, { ...f.receipt, committedAt: "2026-02-30T12:00:00Z" },
    { ...f.receipt, planHash: "not-a-digest" }, { ...f.receipt, rawBusiness: [] },
  ];
  const inspections: unknown[] = [
    { ...f.inspection, version: "1" }, { ...f.inspection, observedAt: "2026-02-30T12:00:00Z" },
    { ...f.inspection, observedAt: "2026-09-09T12:00:00.1234567Z" }, { ...f.inspection, observedAt: " " },
    { ...f.inspection, targetState: "unknown" }, { ...f.inspection, targetHash: "D".repeat(64) },
    { ...f.inspection, targetState: "differs_from_commit" }, { ...f.inspection, targetHash: "e".repeat(64) },
    { ...f.inspection, targetRows: [] }, { ...f.inspection, actorKey: f.binding.actorKey },
  ];
  for (const data of [...receipts.map((receipt) => ({ ...f.data, receipt })), ...inspections.map((inspection) => ({ ...f.data, inspection })),
    { ...f.data, version: 2 }, { ...f.data, rawBusiness: [] }, [f.data]]) {
    await assert.rejects(readPlatformSnapshotRestoreInspection({ rpc: async () => ({ error: null, data }) }, f.binding),
      /^PlatformSnapshotAtomicError: platform_snapshot_restore_inspection_unconfirmed$/);
  }
});

test("accessor and nonplain RPC payloads are rejected without invoking business getters", async () => {
  const f = fixture(); let called = 0;
  const getter = Object.defineProperty({ ...f.inspection }, "targetHash", { enumerable: true, get() { called++; return "d".repeat(64); } });
  for (const data of [{ ...f.data, inspection: getter }, Object.assign(Object.create({ hidden: true }), f.data)]) {
    await assert.rejects(readPlatformSnapshotRestoreInspection({ rpc: async () => ({ error: null, data }) }, f.binding), /inspection_unconfirmed/);
  }
  assert.equal(called, 0);
});

test("RPC SQL errors and malformed acknowledgements are redacted, never retried or mapped to a clean result", async () => {
  const f = fixture();
  for (const response of [{ data: f.data }, { data: f.data, error: undefined }, { data: f.data, error: false },
    { data: f.data, error: 0 }, { data: f.data, error: "" }, { data: null, error: null },
    { data: null, error: { code: "P0001", message: "PRIVATE SQL DETAIL" } }]) {
    let calls = 0;
    await assert.rejects(readPlatformSnapshotRestoreInspection({ rpc: async () => { calls++; return response; } }, f.binding),
      /^PlatformSnapshotAtomicError: platform_snapshot_restore_inspection_unconfirmed$/);
    assert.equal(calls, 1);
  }
  let calls = 0;
  await assert.rejects(readPlatformSnapshotRestoreInspection({ rpc: async () => { calls++; throw new Error("PRIVATE NETWORK"); } }, f.binding), /inspection_unconfirmed/);
  assert.equal(calls, 1);
});

test("inspection read timeout abandons one pending request without replay or pretending to cancel SQL", async () => {
  const f = fixture(); let calls = 0; let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  try {
    await assert.rejects(readPlatformSnapshotRestoreInspection({ rpc: async () => {
      calls++; await pending; return { error: null, data: f.data };
    } }, f.binding, { timeoutMs: 5 }), /inspection_unconfirmed/);
  } finally { release(); }
  assert.equal(calls, 1);
});
