import assert from "node:assert/strict";
import test from "node:test";
import { PLATFORM_SNAPSHOT_ATOMIC_SCOPES, readPlatformSnapshotRestoreAtomic, commitPlatformSnapshotRestoreAtomic,
  parsePlatformSnapshotAtomicView, type PlatformSnapshotAtomicScope, type PlatformSnapshotAtomicView,
  type PlatformSnapshotRestoreAtomicScope, type PlatformSnapshotRestoreAtomicView, type PlatformSnapshotJson,
  type PlatformSnapshotAtomicWrite } from "./platformSnapshotAtomic.server";

const stamp = "2026-09-08T12:00:00.123456+00:00";
function fixture(scope: PlatformSnapshotRestoreAtomicScope = "user_manage") {
  const make = (kind: PlatformSnapshotAtomicScope, offset: number): PlatformSnapshotAtomicView => ({ version: 1, scope: kind,
    rows: PLATFORM_SNAPSHOT_ATOMIC_SCOPES[kind].map((slug, i) => ({ slug, row: {
      id: `00000000-0000-0000-0000-${String(offset + i).padStart(12, "0")}`, updatedAt: stamp,
      blocks: (slug.includes("support_inbox_history") ? { entries: [], untouched: "中文" } : [{ raw: "中文", future: [] }]) as PlatformSnapshotJson,
    } })) });
  const bundle: PlatformSnapshotRestoreAtomicView = { version: 1, scope, catalog: make("backup_catalog", 1), target: make(scope, 3) };
  const writes: PlatformSnapshotAtomicWrite[] = bundle.target.rows.map(({ slug, row }) => ({ slug, blocks: structuredClone(row!.blocks) }));
  return { bundle, writes };
}
for (const scope of ["user_manage", "support_messages"] as const) {
  test(`restore ${scope}: one read captures source and target without changing raw microseconds`, async () => {
    const { bundle } = fixture(scope); let calls = 0;
    const actual = await readPlatformSnapshotRestoreAtomic({ rpc: async (name, args) => {
      calls++; assert.equal(name, "faolla_read_platform_snapshot_restore_v1"); assert.deepEqual(args, { p_scope: scope });
      return { error: null, data: bundle };
    } }, scope);
    assert.equal(calls, 1); assert.deepEqual(actual, bundle); assert.notEqual(actual, bundle);
  });
  test(`restore ${scope}: one commit sends source as read-only CAS and only target writes`, async () => {
    const { bundle, writes } = fixture(scope); let calls = 0;
    const actual = await commitPlatformSnapshotRestoreAtomic({ rpc: async (name, args) => {
      calls++; assert.equal(name, "faolla_commit_platform_snapshot_restore_v1");
      assert.deepEqual(args, { p_scope: scope, p_catalog_expected: bundle.catalog.rows, p_target_expected: bundle.target.rows, p_writes: writes });
      return { error: null, data: bundle };
    } }, bundle, writes);
    assert.equal(calls, 1); assert.deepEqual(actual, bundle);
  });
}
test("restore captures all expected and write content before awaiting transport", async () => {
  const { bundle, writes } = fixture(); const original = structuredClone(bundle);
  let release!: () => void; const barrier = new Promise<void>((resolve) => { release = resolve; });
  const promise = commitPlatformSnapshotRestoreAtomic({ rpc: async (_name, args) => {
    await barrier; assert.deepEqual(args.p_catalog_expected, original.catalog.rows);
    assert.deepEqual(args.p_target_expected, original.target.rows);
    return { error: null, data: original };
  } }, bundle, writes);
  bundle.catalog.rows[0].row!.blocks = []; bundle.target.rows[0].row!.blocks = []; writes[0].blocks = [];
  release(); assert.deepEqual(await promise, original);
});
test("restore source receipt must retain every ID, JSON field, microsecond and missing row", async () => {
  for (const mutation of [
    (v: PlatformSnapshotRestoreAtomicView) => { v.catalog.rows[0].row!.blocks = []; },
    (v: PlatformSnapshotRestoreAtomicView) => { v.catalog.rows[0].row!.updatedAt = "2026-09-08T12:00:00.123457Z"; },
    (v: PlatformSnapshotRestoreAtomicView) => { v.catalog.rows[0].row!.id = "00000000-0000-0000-0000-999999999999"; },
    (v: PlatformSnapshotRestoreAtomicView) => { v.catalog.rows[0].row = null; },
  ]) {
    const { bundle, writes } = fixture(); const actual = structuredClone(bundle); mutation(actual);
    await assert.rejects(commitPlatformSnapshotRestoreAtomic({ rpc: async () => ({ error: null, data: actual }) }, bundle, writes),
      /platform_snapshot_atomic_write_unconfirmed/);
  }
  const { bundle, writes } = fixture(); bundle.catalog.rows[1].row = null;
  const actual = structuredClone(bundle); actual.catalog.rows[1].row = structuredClone(actual.catalog.rows[0].row);
  await assert.rejects(commitPlatformSnapshotRestoreAtomic({ rpc: async () => ({ error: null, data: actual }) }, bundle, writes),
    /platform_snapshot_atomic_write_unconfirmed/);
});
test("restore target receipt verifies exact contents, row identity and no-op timestamps", async () => {
  for (const property of ["blocks", "id", "updatedAt"] as const) {
    const { bundle, writes } = fixture(); const actual = structuredClone(bundle);
    if (property === "blocks") actual.target.rows[0].row!.blocks = [];
    if (property === "id") actual.target.rows[0].row!.id = "00000000-0000-0000-0000-999999999999";
    if (property === "updatedAt") actual.target.rows[0].row!.updatedAt = "2026-09-08T12:00:01Z";
    await assert.rejects(commitPlatformSnapshotRestoreAtomic({ rpc: async () => ({ error: null, data: actual }) }, bundle, writes), /write_unconfirmed/);
  }
});
test("restore source timestamp equality accepts equivalent offsets without truncating microseconds", async () => {
  const { bundle, writes } = fixture(); const actual = structuredClone(bundle);
  actual.catalog.rows[0].row!.updatedAt = "2026-09-08T14:00:00.123456+02:00";
  assert.deepEqual(await commitPlatformSnapshotRestoreAtomic({ rpc: async () => ({ error: null, data: actual }) }, bundle, writes), actual);
});
test("restore malformed scope, source, target or duplicate cross-scope IDs reject before RPC", async () => {
  const mutations = [
    (v: PlatformSnapshotRestoreAtomicView) => { (v as { scope: string }).scope = "backup_catalog"; },
    (v: PlatformSnapshotRestoreAtomicView) => { v.catalog.rows.reverse(); },
    (v: PlatformSnapshotRestoreAtomicView) => { v.catalog.rows.pop(); },
    (v: PlatformSnapshotRestoreAtomicView) => { v.catalog.rows.forEach((row) => { row.row = null; }); },
    (v: PlatformSnapshotRestoreAtomicView) => { v.target.rows[0].row!.id = v.catalog.rows[0].row!.id; },
    (v: PlatformSnapshotRestoreAtomicView) => { v.target.rows[0].row!.updatedAt = "not-a-date"; },
  ];
  for (const mutate of mutations) {
    const { bundle, writes } = fixture(); mutate(bundle); let calls = 0;
    await assert.rejects(commitPlatformSnapshotRestoreAtomic({ rpc: async () => { calls++; throw new Error("should-not-run"); } }, bundle, writes), /invalid_request/);
    assert.equal(calls, 0);
  }
});
test("restore malformed reads and misleading transport receipts stay unconfirmed with no retry", async () => {
  for (const response of [{ data: fixture().bundle }, { data: fixture().bundle, error: {} }, { data: null, error: null },
    { data: { ...fixture().bundle, secret: "PRIVATE" }, error: null }]) {
    let calls = 0;
    await assert.rejects(readPlatformSnapshotRestoreAtomic({ rpc: async () => { calls++; return response; } }, "user_manage"), /write_unconfirmed/);
    assert.equal(calls, 1);
  }
  const { bundle, writes } = fixture(); let calls = 0;
  await assert.rejects(commitPlatformSnapshotRestoreAtomic({ rpc: async () => { calls++; throw new Error("PRIVATE"); } }, bundle, writes),
    (error: unknown) => { assert.ok(error instanceof Error); assert.equal(error.message, "platform_snapshot_atomic_write_unconfirmed"); return true; });
  assert.equal(calls, 1);
});
test("restore preserves explicit server conflicts while keeping retrySafe false", async () => {
  const { bundle, writes } = fixture();
  await assert.rejects(commitPlatformSnapshotRestoreAtomic({ rpc: async () => ({ data: null,
    error: { code: "P0001", message: "platform_snapshot_atomic_conflict" } }) }, bundle, writes),
  (error: unknown) => { assert.ok(error instanceof Error); assert.equal(error.message, "platform_snapshot_atomic_conflict");
    assert.equal((error as Error & { retrySafe: boolean }).retrySafe, false); return true; });
});
test("pure view parsing detaches data and rejects non-JSON/accessor input without executing getters", () => {
  const { bundle } = fixture(); const parsed = parsePlatformSnapshotAtomicView("user_manage", bundle.target);
  assert.deepEqual(parsed, bundle.target); assert.notEqual(parsed, bundle.target);
  let reads = 0; Object.defineProperty(bundle.target, "rows", { enumerable: true, get() { reads++; return []; } });
  assert.throws(() => parsePlatformSnapshotAtomicView("user_manage", bundle.target), /invalid_request/); assert.equal(reads, 0);
});
