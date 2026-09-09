import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultMerchantPermissionConfig, createDefaultMerchantContactVisibility,
  createDefaultMerchantSortConfig } from "@/data/platformControlStore";
import { buildPlatformMerchantSnapshotBlocks, readPlatformMerchantSnapshotFromBlocks,
  PLATFORM_MERCHANT_SNAPSHOT_SLUG as PRIMARY, PLATFORM_MERCHANT_SNAPSHOT_HISTORY_SLUG as HISTORY,
  PLATFORM_MERCHANT_SNAPSHOT_BACKUP_SLUG as BACKUP, PLATFORM_MERCHANT_SNAPSHOT_HISTORY_BACKUP_SLUG as HISTORY_BACKUP,
  type PlatformMerchantSnapshotPayload } from "./platformMerchantSnapshot";
import { savePlatformMerchantSnapshot, type PlatformMerchantSnapshotStoreClient } from "./platformMerchantSnapshotStore";
import { savePlatformMerchantConfigArchive, loadStoredPlatformMerchantConfigArchive,
  type PlatformMerchantConfigArchiveStoreClient } from "./platformMerchantConfigArchiveStore";
import { buildPlatformMerchantConfigArchiveBlocks, derivePlatformMerchantConfigArchiveEntries,
  readPlatformMerchantConfigArchiveFromBlocks, PLATFORM_MERCHANT_CONFIG_ARCHIVE_SLUG as ARCHIVE,
  PLATFORM_MERCHANT_CONFIG_ARCHIVE_BACKUP_SLUG as ARCHIVE_BACKUP } from "./platformMerchantConfigArchive";

type Row = { id: number; slug: string; merchant_id: string | null; blocks: unknown; updated_at?: string };
type Failure = "error" | "throw" | "suppress" | "tamper";
function fixture(historyId?: string): PlatformMerchantSnapshotPayload {
  const config = { permissionConfig: createDefaultMerchantPermissionConfig(), serviceExpiresAt: null,
    merchantCardImageUrl: "", merchantCardImageOpacity: 1, chatAvatarImageUrl: "",
    contactVisibility: createDefaultMerchantContactVisibility(), sortConfig: createDefaultMerchantSortConfig() };
  return { revision: "snapshot-original", defaultSortRule: "created_desc", snapshot: [{
    id: "10000000", merchantName: "Synthetic", name: "Synthetic", domain: "synthetic", category: "服务",
    industry: "服务", sortConfig: createDefaultMerchantSortConfig(), createdAt: "2026-09-08T00:00:00.000Z",
    location: { countryCode: "", country: "", provinceCode: "", province: "", city: "" },
  }], merchantConfigHistoryBySiteId: historyId ? { "10000000": [{ id: historyId, at: "2026-09-08T00:00:00.000Z",
    operator: "synthetic", summary: "Synthetic update", changes: ["test"], before: config, after: config }] } : {} };
}
function rowsFor(payload = fixture()): Row[] {
  return [PRIMARY, HISTORY, BACKUP, HISTORY_BACKUP].map((slug, index) => ({ id: index + 1, slug, merchant_id: null,
    blocks: buildPlatformMerchantSnapshotBlocks(payload, { includeHistory: slug === HISTORY || slug === HISTORY_BACKUP }) }));
}
function deferred() {
  let resolve!: () => void; const promise = new Promise<void>((yes) => { resolve = yes; }); return { promise, resolve };
}
function store(initial = rowsFor(), options: { failures?: Record<string, Failure>; beforeWrite?: (slug: string) => Promise<void> } = {}) {
  const rows = structuredClone(initial); const writes: string[] = []; const filtersSeen: Array<Record<string, unknown>> = [];
  class Query {
    private filters: Record<string, unknown> = {}; private action = "select"; private body: Record<string, unknown> = {}; private max = Infinity;
    select() { return this; }
    update(body: Record<string, unknown>) { this.action = "update"; this.body = body; return this; }
    insert(body: Record<string, unknown>) { this.action = "insert"; this.body = body; return this; }
    is(key: string, value: unknown) { this.filters[key] = value; return this; }
    eq(key: string, value: unknown) { this.filters[key] = value; return this; }
    limit(max: number) { this.max = max; return this; }
    async execute(single: boolean): Promise<{ data: unknown; error: unknown }> {
      const matches = rows.filter((row) => Object.entries(this.filters).every(([key, value]) => row[key as keyof Row] === value));
      if (this.action === "select") {
        const limited = matches.slice(0, this.max);
        return single && limited.length > 1 ? { data: null, error: { message: "multiple rows" } }
          : { data: structuredClone(single ? limited[0] ?? null : limited), error: null };
      }
      const slug = String(this.action === "insert" ? this.body.slug : this.filters.slug ?? matches[0]?.slug ?? "");
      writes.push(slug); filtersSeen.push({ ...this.filters }); await options.beforeWrite?.(slug);
      const failure = options.failures?.[slug];
      if (failure === "throw") throw new Error("PRIVATE simulated transport failure");
      if (failure === "error") return { data: null, error: { message: "PRIVATE simulated SQL error" } };
      if (failure === "suppress") return { data: null, error: null };
      let changed: Row[];
      if (this.action === "insert") {
        if (rows.some((row) => row.slug === slug && row.merchant_id === this.body.merchant_id)) return { data: null, error: { message: "duplicate" } };
        const row = { id: Math.max(0, ...rows.map((item) => item.id)) + 1, ...structuredClone(this.body) } as Row;
        rows.push(row); changed = [row];
      } else { changed = matches; for (const row of changed) Object.assign(row, structuredClone(this.body)); }
      if (failure === "tamper") for (const row of changed) row.blocks = [];
      return { data: structuredClone(single ? changed[0] ?? null : changed), error: null };
    }
    maybeSingle() { return this.execute(true); }
    then<TResult1 = { data: unknown; error: unknown }, TResult2 = never>(
      yes?: ((value: { data: unknown; error: unknown }) => TResult1 | PromiseLike<TResult1>) | null,
      no?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ) { return this.execute(false).then(yes, no); }
  }
  const client = { from: (table: string) => { assert.equal(table, "pages"); return new Query(); } };
  return { client: client as unknown as PlatformMerchantSnapshotStoreClient & PlatformMerchantConfigArchiveStoreClient, rows, writes, filtersSeen };
}

test("strict snapshot persists all four rows and derived archive, while retaining directory/history merge", async () => {
  const old = fixture("old-history"); const current = rowsFor(old);
  const incoming = fixture("new-history"); incoming.snapshot = [{ ...incoming.snapshot[0], id: "10000001", name: "Second", merchantName: "Second" }];
  const mock = store(current); const saved = await savePlatformMerchantSnapshot(mock.client, incoming, { requireAllWrites: true });
  assert.equal(saved.error, null);
  assert.deepEqual(new Set(saved.payload?.snapshot.map((item) => item.id)), new Set(["10000000", "10000001"]));
  assert.equal(saved.payload?.merchantConfigHistoryBySiteId["10000000"]?.length, 2);
  assert.deepEqual(new Set(mock.writes), new Set([PRIMARY, HISTORY, BACKUP, HISTORY_BACKUP, ARCHIVE, ARCHIVE_BACKUP]));
  for (const filter of mock.filtersSeen.slice(0, 4)) {
    assert.equal(filter.merchant_id, null); assert.equal(typeof filter.id, "number"); assert.equal(typeof filter.slug, "string");
  }
  const archive = readPlatformMerchantConfigArchiveFromBlocks(mock.rows.find((row) => row.slug === ARCHIVE)?.blocks);
  assert.equal(archive.audits.length, 1); assert.equal(archive.audits[0].id, "new-history");
});

test("strict snapshot retains history-only stored payloads even when their directory is empty", async () => {
  const onlyHistory = fixture("old-history"); onlyHistory.snapshot = [];
  const mock = store([{ id: 1, slug: HISTORY, merchant_id: null, blocks: buildPlatformMerchantSnapshotBlocks(onlyHistory) }]);
  const incoming = fixture(); incoming.snapshot = [];
  const saved = await savePlatformMerchantSnapshot(mock.client, incoming, { requireAllWrites: true });
  assert.equal(saved.error, null); assert.equal(saved.payload?.snapshot.length, 0);
  assert.equal(saved.payload?.merchantConfigHistoryBySiteId["10000000"]?.[0].id, "old-history");
});

for (const slug of [PRIMARY, HISTORY, BACKUP, HISTORY_BACKUP, ARCHIVE, ARCHIVE_BACKUP]) {
  for (const failure of ["error", "throw", "suppress", "tamper"] as const) {
    test(`strict snapshot fails closed for ${slug} ${failure}`, async () => {
      const mock = store(rowsFor(), { failures: { [slug]: failure } });
      const result = await savePlatformMerchantSnapshot(mock.client, fixture("delta"), { requireAllWrites: true });
      assert.equal(result.error, "super_admin_backup_write_unconfirmed"); assert.equal(result.payload, undefined);
      assert.doesNotMatch(JSON.stringify(result), /PRIVATE/);
    });
  }
}

test("strict snapshot waits delayed sibling after main rejection and never starts auxiliary", async () => {
  const gate = deferred(); const started = deferred(); let completed = false;
  const mock = store(rowsFor(), { failures: { [PRIMARY]: "throw" }, beforeWrite: async (slug) => {
    if (slug === HISTORY) { started.resolve(); await gate.promise; }
  } });
  const pending = savePlatformMerchantSnapshot(mock.client, fixture(), { requireAllWrites: true }).then((value) => { completed = true; return value; });
  await started.promise; await Promise.resolve(); assert.equal(completed, false);
  assert.deepEqual(new Set(mock.writes), new Set([PRIMARY, HISTORY])); gate.resolve();
  assert.equal((await pending).error, "super_admin_backup_write_unconfirmed");
});

test("strict snapshot waits all auxiliary writes even when another auxiliary rejects", async () => {
  const gate = deferred(); const started = deferred(); let completed = false;
  const mock = store(rowsFor(), { failures: { [BACKUP]: "throw" }, beforeWrite: async (slug) => {
    if (slug === HISTORY_BACKUP) { started.resolve(); await gate.promise; }
  } });
  const pending = savePlatformMerchantSnapshot(mock.client, fixture("delta"), { requireAllWrites: true }).then((value) => { completed = true; return value; });
  await started.promise; await Promise.resolve(); assert.equal(completed, false); gate.resolve();
  assert.equal((await pending).error, "super_admin_backup_write_unconfirmed");
});

test("strict snapshot does not skip a still-running auxiliary at the legacy 3.5 second deadline", async () => {
  const gate = deferred(); const started = deferred(); let completed = false;
  const mock = store(rowsFor(), { beforeWrite: async (slug) => { if (slug === BACKUP) { started.resolve(); await gate.promise; } } });
  const pending = savePlatformMerchantSnapshot(mock.client, fixture(), { requireAllWrites: true }).then((value) => { completed = true; return value; });
  await started.promise;
  await new Promise((resolve) => setTimeout(resolve, 3550));
  assert.equal(completed, false); gate.resolve(); assert.equal((await pending).error, null);
});

test("strict snapshot rejects duplicate, foreign-owned, damaged JSON and bad input before writes", async () => {
  const cases = [
    [...rowsFor(), { ...rowsFor()[0], id: 5 }],
    rowsFor().map((row) => ({ ...row, merchant_id: "legacy-owner" })),
    rowsFor().map((row) => row.slug === HISTORY_BACKUP ? { ...row, blocks: null } : row),
  ];
  for (const initial of cases) {
    const mock = store(initial); const saved = await savePlatformMerchantSnapshot(mock.client, fixture(), { requireAllWrites: true });
    assert.equal(saved.error, "super_admin_backup_write_unconfirmed"); assert.deepEqual(mock.writes, []);
  }
  const mock = store();
  assert.equal((await savePlatformMerchantSnapshot(mock.client, { ...fixture(), snapshot: [null] } as never, { requireAllWrites: true })).error,
    "super_admin_backup_write_unconfirmed"); assert.deepEqual(mock.writes, []);
});

test("strict archive replaces supplied content, requires both copies and does not populate failed success cache", async () => {
  const old = derivePlatformMerchantConfigArchiveEntries({ nextHistoryBySiteId: fixture("old").merchantConfigHistoryBySiteId });
  const next = derivePlatformMerchantConfigArchiveEntries({ nextHistoryBySiteId: fixture("next").merchantConfigHistoryBySiteId });
  const initial = [ARCHIVE, ARCHIVE_BACKUP].map((slug, index) => ({ id: index + 1, slug, merchant_id: null,
    blocks: buildPlatformMerchantConfigArchiveBlocks(old) }));
  const failures: Record<string, Failure> = {};
  const mock = store(initial, { failures });
  assert.equal((await savePlatformMerchantConfigArchive(mock.client, next, { requireAllWrites: true })).error, null);
  assert.equal(readPlatformMerchantConfigArchiveFromBlocks(mock.rows[0].blocks).audits[0].id, "next");
  failures[ARCHIVE] = "suppress"; failures[ARCHIVE_BACKUP] = "suppress";
  assert.equal((await savePlatformMerchantConfigArchive(mock.client, old, { requireAllWrites: true })).error, "super_admin_backup_write_unconfirmed");
  const loaded = await loadStoredPlatformMerchantConfigArchive(mock.client);
  assert.equal(loaded.audits[0].id, "next");
});

test("strict archive waits sibling when primary rejects and validates existing backup even when primary is present", async () => {
  const payload = { audits: [], backups: [] }; const gate = deferred(); const started = deferred(); let complete = false;
  const mock = store([], { failures: { [ARCHIVE]: "throw" }, beforeWrite: async (slug) => {
    if (slug === ARCHIVE_BACKUP) { started.resolve(); await gate.promise; }
  } });
  const pending = savePlatformMerchantConfigArchive(mock.client, payload, { requireAllWrites: true }).then((result) => { complete = true; return result; });
  await started.promise; assert.equal(complete, false); gate.resolve(); assert.equal((await pending).error, "super_admin_backup_write_unconfirmed");
  const bad = store([{ id: 1, slug: ARCHIVE, merchant_id: null, blocks: buildPlatformMerchantConfigArchiveBlocks(payload) },
    { id: 2, slug: ARCHIVE_BACKUP, merchant_id: null, blocks: [] }]);
  assert.equal((await savePlatformMerchantConfigArchive(bad.client, payload, { requireAllWrites: true })).error, "super_admin_backup_write_unconfirmed");
  assert.deepEqual(bad.writes, []);
});

test("strict snapshot honors an explicitly supplied expected revision without writes", async () => {
  const mock = store(); const result = await savePlatformMerchantSnapshot(mock.client, fixture(), { requireAllWrites: true, expectedRevision: "old" });
  assert.equal(result.code, "conflict"); assert.deepEqual(mock.writes, []);
  assert.equal(readPlatformMerchantSnapshotFromBlocks(mock.rows[0].blocks)?.revision, "snapshot-original");
});
