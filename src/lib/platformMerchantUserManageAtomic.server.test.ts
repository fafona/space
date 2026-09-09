import assert from "node:assert/strict";
import test from "node:test";
import { isDeepStrictEqual } from "node:util";
import { createDefaultMerchantPermissionConfig, createDefaultMerchantContactVisibility,
  createDefaultMerchantSortConfig } from "@/data/platformControlStore";
import {
  buildPlatformMerchantSnapshotBlocks, normalizePlatformMerchantSnapshotPayload,
  PLATFORM_MERCHANT_SNAPSHOT_SLUG as PRIMARY, PLATFORM_MERCHANT_SNAPSHOT_HISTORY_SLUG as HISTORY,
  PLATFORM_MERCHANT_SNAPSHOT_HISTORY_BACKUP_SLUG as HISTORY_BACKUP,
  type PlatformMerchantSnapshotPayload,
} from "./platformMerchantSnapshot";
import {
  buildPlatformMerchantConfigArchiveBlocks, derivePlatformMerchantConfigArchiveEntries,
  PLATFORM_MERCHANT_CONFIG_ARCHIVE_SLUG as ARCHIVE, PLATFORM_MERCHANT_CONFIG_ARCHIVE_BACKUP_SLUG as ARCHIVE_BACKUP,
  type PlatformMerchantConfigArchivePayload,
} from "./platformMerchantConfigArchive";
import { readPlatformMerchantUserManageAtomic, savePlatformMerchantUserManageAtomic } from "./platformMerchantUserManageAtomic.server";
import { loadStoredPlatformMerchantSnapshot, loadAuthoritativeStoredPlatformMerchantSnapshot,
  savePlatformMerchantSnapshot, type PlatformMerchantSnapshotStoreClient } from "./platformMerchantSnapshotStore";
import { loadStoredPlatformMerchantConfigArchive, savePlatformMerchantConfigArchive,
  type PlatformMerchantConfigArchiveStoreClient } from "./platformMerchantConfigArchiveStore";
import { PLATFORM_SNAPSHOT_ATOMIC_SCOPES, type PlatformSnapshotAtomicClient, type PlatformSnapshotAtomicExpected,
  type PlatformSnapshotAtomicView, type PlatformSnapshotAtomicWrite, type PlatformSnapshotJson } from "./platformSnapshotAtomic.server";

const stamp = "2026-09-08T12:34:56.123456+00:00";
const nextStamp = "2026-09-08T12:34:57.654321+00:00";
function fixture(historyId?: string): PlatformMerchantSnapshotPayload {
  const config = { permissionConfig: createDefaultMerchantPermissionConfig(), serviceExpiresAt: null,
    merchantCardImageUrl: "", merchantCardImageOpacity: 1, chatAvatarImageUrl: "",
    contactVisibility: createDefaultMerchantContactVisibility(), sortConfig: createDefaultMerchantSortConfig() };
  return normalizePlatformMerchantSnapshotPayload({ revision: "snapshot-original", defaultSortRule: "created_desc", snapshot: [{
    id: "10000000", merchantName: "Synthetic", name: "Synthetic", domain: "synthetic", category: "服务",
    industry: "服务", sortConfig: createDefaultMerchantSortConfig(), createdAt: "2026-09-08T00:00:00.000Z",
    location: { countryCode: "", country: "", provinceCode: "", province: "", city: "" },
  }], merchantConfigHistoryBySiteId: historyId ? { "10000000": [{ id: historyId, at: "2026-09-08T00:00:00.000Z",
    operator: "synthetic", summary: "Synthetic update", changes: ["test"], before: config, after: config }] } : {} });
}
const json = (value: unknown): PlatformSnapshotJson => JSON.parse(JSON.stringify(value));
function viewFor(payload = fixture(), archive: PlatformMerchantConfigArchivePayload = { audits: [], backups: [] }): PlatformSnapshotAtomicView {
  return { version: 1, scope: "user_manage", rows: PLATFORM_SNAPSHOT_ATOMIC_SCOPES.user_manage.map((slug, index) => ({ slug,
    row: { id: `00000000-0000-0000-0000-${String(index + 1).padStart(12, "0")}`, updatedAt: stamp,
      blocks: json([ARCHIVE, ARCHIVE_BACKUP].includes(slug) ? buildPlatformMerchantConfigArchiveBlocks(archive)
        : buildPlatformMerchantSnapshotBlocks(payload, { includeHistory: [HISTORY, HISTORY_BACKUP].includes(slug) })) },
  })) };
}
type RpcOptions = {
  readError?: unknown;
  commitError?: unknown;
  beforeRead?: () => Promise<void>;
  beforeCommit?: () => Promise<void>;
  mutateReceipt?: (view: PlatformSnapshotAtomicView) => unknown;
};
function mock(initial = viewFor(), options: RpcOptions = {}) {
  let view = structuredClone(initial);
  let pagesCalls = 0;
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const client = {
    from: () => { pagesCalls++; throw new Error("Unexpected legacy pages I/O"); },
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args: structuredClone(args) }); assert.equal(args.p_scope, "user_manage");
      if (name === "faolla_read_platform_snapshot_rows_v1") {
        await options.beforeRead?.();
        return options.readError ? { data: null, error: options.readError } : { data: structuredClone(view), error: null };
      }
      assert.equal(name, "faolla_commit_platform_snapshot_rows_v1");
      await options.beforeCommit?.();
      if (options.commitError) return { data: null, error: options.commitError };
      const expected = args.p_expected as PlatformSnapshotAtomicExpected[];
      const writes = args.p_writes as PlatformSnapshotAtomicWrite[];
      assert.deepEqual(expected, view.rows, "CAS uses the original, complete physical view");
      assert.deepEqual(writes.map((entry) => entry.slug), PLATFORM_SNAPSHOT_ATOMIC_SCOPES.user_manage);
      view = { version: 1, scope: "user_manage", rows: writes.map(({ slug, blocks }, index) => ({ slug, row: {
        id: view.rows[index].row?.id ?? `00000000-0000-0000-0000-${String(index + 10).padStart(12, "0")}`,
        blocks: structuredClone(blocks),
        updatedAt: view.rows[index].row && isDeepStrictEqual(view.rows[index].row?.blocks, blocks) ? view.rows[index].row!.updatedAt : nextStamp,
      } })) };
      return { data: options.mutateReceipt ? options.mutateReceipt(structuredClone(view)) : structuredClone(view), error: null };
    },
  };
  return { client: client as unknown as PlatformSnapshotAtomicClient & PlatformMerchantSnapshotStoreClient & PlatformMerchantConfigArchiveStoreClient,
    calls, current: () => structuredClone(view), pagesCalls: () => pagesCalls };
}
async function atomic<T>(action: () => Promise<T>) {
  const old = process.env.FAOLLA_PLATFORM_SNAPSHOT_WRITE_MODE;
  process.env.FAOLLA_PLATFORM_SNAPSHOT_WRITE_MODE = "atomic";
  try { return await action(); } finally {
    if (old === undefined) delete process.env.FAOLLA_PLATFORM_SNAPSHOT_WRITE_MODE;
    else process.env.FAOLLA_PLATFORM_SNAPSHOT_WRITE_MODE = old;
  }
}

test("normal central save commits exactly six physical rows once, retaining directory/history and deriving archive", () => atomic(async () => {
  const initial = fixture("old-history"); const mockStore = mock(viewFor(initial));
  const incoming = fixture("new-history"); incoming.snapshot = [{ ...incoming.snapshot[0], id: "10000001", name: "Second" }];
  const result = await savePlatformMerchantSnapshot(mockStore.client, incoming, { expectedRevision: initial.revision });
  assert.equal(result.error, null); assert.notEqual(result.payload?.revision, initial.revision);
  assert.deepEqual(new Set(result.payload?.snapshot.map((item) => item.id)), new Set(["10000000", "10000001"]));
  assert.deepEqual(new Set(result.payload?.merchantConfigHistoryBySiteId["10000000"].map((item) => item.id)), new Set(["old-history", "new-history"]));
  assert.deepEqual(mockStore.calls.map((item) => item.name), ["faolla_read_platform_snapshot_rows_v1", "faolla_commit_platform_snapshot_rows_v1"]);
  assert.equal(mockStore.pagesCalls(), 0);
  const saved = await readPlatformMerchantUserManageAtomic(mockStore.client);
  assert.deepEqual(result.payload, saved.snapshot); assert.equal(saved.archive.audits.length, 1);
  assert.equal(saved.archive.audits[0].id, "new-history"); assert.equal(saved.archive.backups[0].sourceHistoryEntryId, "new-history");
}));

test("backup-only histories participate in validation, merge, and delta detection", async () => {
  const initial = viewFor(); const old = fixture("backup-history");
  initial.rows.find((entry) => entry.slug === HISTORY_BACKUP)!.row!.blocks = json(buildPlatformMerchantSnapshotBlocks(old));
  const mockStore = mock(initial); const saved = await savePlatformMerchantUserManageAtomic(mockStore.client, fixture("new-history"), "snapshot-original");
  assert.equal(saved.error, null); if (saved.error) return;
  assert.equal(saved.payload.merchantConfigHistoryBySiteId["10000000"].length, 2);
  assert.deepEqual(saved.archive.audits.map((entry) => entry.id), ["new-history"]);
});

test("no history delta preserves unequal valid archive copies and original physical timestamps", async () => {
  const archive = derivePlatformMerchantConfigArchiveEntries({ nextHistoryBySiteId: fixture("existing-audit").merchantConfigHistoryBySiteId });
  const initial = viewFor(fixture(), archive);
  initial.rows[1].row!.blocks = json(buildPlatformMerchantConfigArchiveBlocks({ audits: [], backups: [] }));
  initial.rows[0].row!.updatedAt = null;
  const mockStore = mock(initial);
  assert.equal((await savePlatformMerchantUserManageAtomic(mockStore.client, fixture(), "snapshot-original")).error, null);
  assert.deepEqual(mockStore.current().rows.slice(0, 2), initial.rows.slice(0, 2));
});

test("first snapshot creates all six rows; absent archive is represented by a valid empty envelope", async () => {
  const initial = viewFor(); initial.rows.forEach((entry) => { entry.row = null; });
  const mockStore = mock(initial); const saved = await savePlatformMerchantUserManageAtomic(mockStore.client, fixture(), null);
  assert.equal(saved.error, null); assert.ok(mockStore.current().rows.every((entry) => entry.row !== null));
  assert.deepEqual((await readPlatformMerchantUserManageAtomic(mockStore.client)).archive, { audits: [], backups: [] });
});

test("history-only missing-primary state is retained, not mistaken for a new empty store", async () => {
  const onlyHistory = fixture("retained"); onlyHistory.snapshot = [];
  const initial = viewFor(); initial.rows.forEach((entry) => { if (entry.slug !== HISTORY) entry.row = null; });
  initial.rows.find((entry) => entry.slug === HISTORY)!.row!.blocks = json(buildPlatformMerchantSnapshotBlocks(onlyHistory));
  const mockStore = mock(initial); const saved = await savePlatformMerchantUserManageAtomic(mockStore.client, fixture(), onlyHistory.revision);
  assert.equal(saved.error, null); if (saved.error) return;
  assert.equal(saved.payload.merchantConfigHistoryBySiteId["10000000"][0].id, "retained");
  assert.equal(saved.archive.audits.length, 0);
});

test("missing or invalid expectedRevision rejects before even the first read", () => atomic(async () => {
  for (const expectedRevision of [undefined, 42, {}]) {
    const mockStore = mock();
    const saved = await savePlatformMerchantSnapshot(mockStore.client, fixture(), { expectedRevision: expectedRevision as never, requireAllWrites: true });
    assert.equal(saved.error, "platform_snapshot_atomic_invalid_request"); assert.equal(mockStore.calls.length, 0); assert.equal(mockStore.pagesCalls(), 0);
  }
}));

test("known pre-read revision conflict returns that exact read payload and performs no write", () => atomic(async () => {
  const mockStore = mock(); const saved = await savePlatformMerchantSnapshot(mockStore.client, fixture(), { expectedRevision: "stale" });
  assert.equal(saved.code, "conflict"); assert.equal(saved.payload?.revision, "snapshot-original");
  assert.equal(mockStore.calls.length, 1); assert.equal(mockStore.pagesCalls(), 0);
}));

test("late physical CAS conflict is not retried, re-read, or mislabeled as an authoritative conflict payload", () => atomic(async () => {
  const mockStore = mock(viewFor(), { commitError: { code: "P0001", message: "platform_snapshot_atomic_conflict" } });
  const saved = await savePlatformMerchantSnapshot(mockStore.client, fixture(), { expectedRevision: "snapshot-original" });
  assert.deepEqual(saved, { error: "platform_snapshot_atomic_conflict" }); assert.equal(mockStore.calls.length, 2); assert.equal(mockStore.pagesCalls(), 0);
}));

for (const slug of PLATFORM_SNAPSHOT_ATOMIC_SCOPES.user_manage) {
  test(`invalid existing business envelope ${slug} rejects the complete plan without writes`, () => atomic(async () => {
    const initial = viewFor(); initial.rows.find((entry) => entry.slug === slug)!.row!.blocks = [];
    const mockStore = mock(initial);
    const result = await savePlatformMerchantSnapshot(mockStore.client, fixture(), { expectedRevision: "snapshot-original" });
    assert.equal(result.error, "platform_snapshot_atomic_store_corrupt"); assert.equal(mockStore.calls.length, 1); assert.equal(mockStore.pagesCalls(), 0);
  }));
}

test("input validation runs before normalization or I/O and caller mutation cannot change an in-flight plan", async () => {
  const invalid = mock(); await assert.rejects(savePlatformMerchantUserManageAtomic(invalid.client,
    { ...fixture(), snapshot: [null] } as never, "snapshot-original"), /platform_snapshot_atomic_invalid_request/);
  assert.equal(invalid.calls.length, 0);
  let release!: () => void; const gate = new Promise<void>((resolve) => { release = resolve; });
  const mockStore = mock(viewFor(), { beforeRead: () => gate }); const incoming = fixture("captured");
  const saving = savePlatformMerchantUserManageAtomic(mockStore.client, incoming, "snapshot-original");
  incoming.snapshot[0].merchantName = "Late mutation"; incoming.merchantConfigHistoryBySiteId = {}; release();
  const saved = await saving; assert.equal(saved.error, null); if (saved.error) return;
  assert.equal(saved.payload.snapshot[0].merchantName, "Synthetic"); assert.equal(saved.archive.audits[0].id, "captured");
});

test("atomic takes precedence over requireAllWrites and missing RPC never falls back to legacy writes", () => atomic(async () => {
  const mockStore = mock(); const client = { from: mockStore.client.from } as PlatformMerchantSnapshotStoreClient;
  const saved = await savePlatformMerchantSnapshot(client, fixture(), { expectedRevision: "snapshot-original", requireAllWrites: true });
  assert.equal(saved.error, "platform_snapshot_atomic_write_unconfirmed"); assert.equal(mockStore.pagesCalls(), 0);
  const archived = await savePlatformMerchantConfigArchive(mockStore.client, { audits: [], backups: [] }, { requireAllWrites: true });
  assert.deepEqual(archived, { error: "platform_snapshot_atomic_restore_unavailable" }); assert.equal(mockStore.calls.length, 0);
}));

test("RPC errors and malformed success receipts never populate success or expose transport details", () => atomic(async () => {
  for (const options of [
    { readError: { message: "PRIVATE SQL detail" } },
    { commitError: { message: "PRIVATE SQL detail" } },
    { mutateReceipt: () => ({ ok: true }) },
    { mutateReceipt: (view: PlatformSnapshotAtomicView) => { view.rows[2].row!.blocks = []; return view; } },
  ]) {
    const mockStore = mock(viewFor(), options);
    const saved = await savePlatformMerchantSnapshot(mockStore.client, fixture(), { expectedRevision: "snapshot-original" });
    assert.deepEqual(saved, { error: "platform_snapshot_atomic_write_unconfirmed" }); assert.equal(mockStore.pagesCalls(), 0);
    assert.ok(mockStore.calls.length <= 2);
  }
}));

test("atomic reads bypass successful old cache and fail closed; authoritative reads use the physical primary", () => atomic(async () => {
  const good = mock(); assert.equal((await savePlatformMerchantSnapshot(good.client, fixture(), { expectedRevision: "snapshot-original" })).error, null);
  const bad = mock(viewFor(), { readError: { message: "PRIVATE read unavailable" } });
  await assert.rejects(loadStoredPlatformMerchantSnapshot(bad.client), /platform_snapshot_atomic_write_unconfirmed/);
  await assert.rejects(loadStoredPlatformMerchantConfigArchive(bad.client), /platform_snapshot_atomic_write_unconfirmed/);
  const initial = viewFor(fixture("history")); initial.rows.find((entry) => entry.slug === PRIMARY)!.row = null;
  const fallback = mock(initial);
  assert.equal((await loadAuthoritativeStoredPlatformMerchantSnapshot(fallback.client)).error, "platform_merchant_snapshot_missing");
  const visible = await loadStoredPlatformMerchantSnapshot(fallback.client, { includeHistory: false });
  assert.equal(visible?.snapshot.length, 1); assert.deepEqual(visible?.merchantConfigHistoryBySiteId, {});
  assert.equal(fallback.pagesCalls(), 0);
}));

test("the central save awaits the one commit; no auxiliary timeout can return success first", () => atomic(async () => {
  let release!: () => void; const gate = new Promise<void>((resolve) => { release = resolve; });
  const mockStore = mock(viewFor(), { beforeCommit: () => gate }); let completed = false;
  const saving = savePlatformMerchantSnapshot(mockStore.client, fixture("history"), { expectedRevision: "snapshot-original" })
    .then((value) => { completed = true; return value; });
  await new Promise<void>((resolve) => { setImmediate(resolve); }); assert.equal(completed, false);
  release(); assert.equal((await saving).error, null); assert.equal(mockStore.calls.length, 2);
}));

test("invalid opt-in configuration fails before strict or ordinary storage can run", async () => {
  const previous = process.env.FAOLLA_PLATFORM_SNAPSHOT_WRITE_MODE; process.env.FAOLLA_PLATFORM_SNAPSHOT_WRITE_MODE = "Atomic";
  try {
    const mockStore = mock();
    await assert.rejects(savePlatformMerchantSnapshot(mockStore.client, fixture(), { requireAllWrites: true }), /platform_snapshot_atomic_configuration_invalid/);
    await assert.rejects(savePlatformMerchantConfigArchive(mockStore.client, { audits: [], backups: [] }), /platform_snapshot_atomic_configuration_invalid/);
    assert.equal(mockStore.pagesCalls(), 0); assert.equal(mockStore.calls.length, 0);
  } finally {
    if (previous === undefined) delete process.env.FAOLLA_PLATFORM_SNAPSHOT_WRITE_MODE;
    else process.env.FAOLLA_PLATFORM_SNAPSHOT_WRITE_MODE = previous;
  }
});
