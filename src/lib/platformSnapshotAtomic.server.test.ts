import assert from "node:assert/strict";
import test from "node:test";
import {
  PLATFORM_SNAPSHOT_ATOMIC_SCOPES, readPlatformSnapshotAtomic, commitPlatformSnapshotAtomic,
  type PlatformSnapshotAtomicScope, type PlatformSnapshotAtomicExpected, type PlatformSnapshotAtomicWrite,
  type PlatformSnapshotAtomicView, type PlatformSnapshotJson,
} from "./platformSnapshotAtomic.server";

const stamp = "2026-09-08T12:34:56.123456+00:00";
function payload(slug: string): PlatformSnapshotJson {
  return slug.startsWith("__platform_support_inbox_history")
    ? { siteId: "__platform__", updatedAt: null, entries: [], unknown: { preserve: true } }
    : [{ id: "raw-wrapper", content: "keep", props: { future: { empty: [], zero: 0, no: false } } }];
}
function fixture(scope: PlatformSnapshotAtomicScope) {
  const expected: PlatformSnapshotAtomicExpected[] = PLATFORM_SNAPSHOT_ATOMIC_SCOPES[scope].map((slug, index) => ({
    slug, row: { id: `00000000-0000-0000-0000-${String(index + 1).padStart(12, "0")}`, blocks: payload(slug), updatedAt: stamp },
  }));
  const writes: PlatformSnapshotAtomicWrite[] = expected.map(({ slug, row }) => ({ slug, blocks: structuredClone(row!.blocks) }));
  const view: PlatformSnapshotAtomicView = { version: 1, scope, rows: structuredClone(expected) };
  return { expected, writes, view };
}

for (const scope of Object.keys(PLATFORM_SNAPSHOT_ATOMIC_SCOPES) as PlatformSnapshotAtomicScope[]) {
  test(`read ${scope} keeps complete physical rows and microseconds without business normalization`, async () => {
    const { view } = fixture(scope);
    let calls = 0;
    const result = await readPlatformSnapshotAtomic({ rpc: async (name, args) => {
      calls++; assert.equal(name, "faolla_read_platform_snapshot_rows_v1"); assert.deepEqual(args, { p_scope: scope });
      return { data: view, error: null };
    } }, scope);
    assert.equal(calls, 1); assert.deepEqual(result, view); assert.notEqual(result, view);
    assert.equal(result.rows[0].row!.updatedAt, stamp);
  });
  test(`commit ${scope} submits all expectations and writes to a single RPC`, async () => {
    const { expected, writes, view } = fixture(scope);
    let calls = 0;
    const result = await commitPlatformSnapshotAtomic({ rpc: async (name, args) => {
      calls++; assert.equal(name, "faolla_commit_platform_snapshot_rows_v1");
      assert.deepEqual(args, { p_scope: scope, p_expected: expected, p_writes: writes });
      return { data: view, error: null };
    } }, scope, expected, writes);
    assert.equal(calls, 1); assert.deepEqual(result, view);
  });
  test(`insert ${scope} distinguishes missing row from an existing empty payload`, async () => {
    const { expected, writes, view } = fixture(scope);
    expected.forEach((entry) => { entry.row = null; });
    const result = await commitPlatformSnapshotAtomic({ rpc: async () => ({ data: view, error: null }) }, scope, expected, writes);
    assert.ok(result.rows.every((entry) => entry.row !== null));
    const emptyView: PlatformSnapshotAtomicView = { version: 1, scope, rows: expected };
    assert.deepEqual(await readPlatformSnapshotAtomic({ rpc: async () => ({ data: emptyView, error: null }) }, scope), emptyView);
  });
}

test("an intentional changed payload permits a new actual version while preserving the row identity", async () => {
  const { expected, writes, view } = fixture("backup_catalog");
  writes[0].blocks = []; view.rows[0].row!.blocks = [];
  view.rows[0].row!.updatedAt = "2026-09-08T12:34:57.999999+00:00";
  assert.deepEqual(await commitPlatformSnapshotAtomic({ rpc: async () => ({ data: view, error: null }) }, "backup_catalog", expected, writes), view);
});
test("nullable legacy timestamps remain nullable on a physical no-op", async () => {
  const { expected, writes, view } = fixture("backup_catalog");
  expected[0].row!.updatedAt = null; view.rows[0].row!.updatedAt = null;
  const result = await commitPlatformSnapshotAtomic({ rpc: async () => ({ data: view, error: null }) }, "backup_catalog", expected, writes);
  assert.equal(result.rows[0].row!.updatedAt, null);
});
test("JSON object order is insignificant but unknown nested content is retained", async () => {
  const { expected, writes, view } = fixture("backup_catalog");
  expected[0].row!.blocks = [{ a: 1, b: { x: [], y: false } }];
  writes[0].blocks = [{ b: { y: false, x: [] }, a: 1 }];
  view.rows[0].row!.blocks = [{ a: 1, b: { x: [], y: false } }];
  const result = await commitPlatformSnapshotAtomic({ rpc: async () => ({ data: view, error: null }) }, "backup_catalog", expected, writes);
  assert.deepEqual(result.rows[0].row!.blocks, expected[0].row!.blocks);
});
test("caller mutations after invocation cannot rewrite the captured plan", async () => {
  const { expected, writes, view } = fixture("backup_catalog");
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => { release = resolve; });
  const promise = commitPlatformSnapshotAtomic({ rpc: async (_name, args) => {
    await barrier;
    assert.notEqual((args.p_expected as PlatformSnapshotAtomicExpected[])[0].row!.id, expected[0].row!.id);
    assert.deepEqual((args.p_writes as PlatformSnapshotAtomicWrite[])[0].blocks, view.rows[0].row!.blocks);
    return { data: view, error: null };
  } }, "backup_catalog", expected, writes);
  expected[0].row!.id = "00000000-0000-0000-0000-999999999999";
  writes[0].blocks = []; release();
  assert.deepEqual(await promise, view);
});
test("fixed scope lists are immutable and lexicographically ordered", () => {
  assert.ok(Object.isFrozen(PLATFORM_SNAPSHOT_ATOMIC_SCOPES));
  const all = Object.values(PLATFORM_SNAPSHOT_ATOMIC_SCOPES).flat();
  assert.equal(all.length, 11); assert.equal(new Set(all).size, 11);
  for (const slugs of Object.values(PLATFORM_SNAPSHOT_ATOMIC_SCOPES)) {
    assert.ok(Object.isFrozen(slugs)); assert.deepEqual(slugs, [...slugs].sort());
  }
});
