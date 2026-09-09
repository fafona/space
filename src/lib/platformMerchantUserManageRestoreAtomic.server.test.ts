import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultMerchantPermissionConfig, createDefaultMerchantContactVisibility,
  createDefaultMerchantSortConfig } from "@/data/platformControlStore";
import { normalizePlatformMerchantSnapshotPayload, buildPlatformMerchantSnapshotBlocks,
  PLATFORM_MERCHANT_SNAPSHOT_SLUG as PRIMARY, PLATFORM_MERCHANT_SNAPSHOT_BACKUP_SLUG as BACKUP,
  PLATFORM_MERCHANT_SNAPSHOT_HISTORY_SLUG as HISTORY, PLATFORM_MERCHANT_SNAPSHOT_HISTORY_BACKUP_SLUG as HISTORY_BACKUP,
  type PlatformMerchantSnapshotPayload } from "./platformMerchantSnapshot";
import { normalizePlatformMerchantConfigArchivePayload, buildPlatformMerchantConfigArchiveBlocks,
  derivePlatformMerchantConfigArchiveEntries, PLATFORM_MERCHANT_CONFIG_ARCHIVE_SLUG as ARCHIVE,
  PLATFORM_MERCHANT_CONFIG_ARCHIVE_BACKUP_SLUG as ARCHIVE_BACKUP } from "./platformMerchantConfigArchive";
import { preparePlatformMerchantUserManageRestoreAtomic } from "./platformMerchantUserManageRestoreAtomic.server";
import { readPlatformMerchantUserManageAtomicView } from "./platformMerchantUserManageAtomic.server";
import { PLATFORM_SNAPSHOT_ATOMIC_SCOPES, type PlatformSnapshotAtomicView,
  type PlatformSnapshotJson } from "./platformSnapshotAtomic.server";

function payload(historyId?: string): PlatformMerchantSnapshotPayload {
  const config = { permissionConfig: createDefaultMerchantPermissionConfig(), serviceExpiresAt: null,
    merchantCardImageUrl: "", merchantCardImageOpacity: 1, chatAvatarImageUrl: "",
    contactVisibility: createDefaultMerchantContactVisibility(), sortConfig: createDefaultMerchantSortConfig() };
  return normalizePlatformMerchantSnapshotPayload({ revision: "current-revision", defaultSortRule: "created_desc", snapshot: [{
    id: "10000000", merchantName: "Synthetic current", name: "Synthetic current", domain: "synthetic", category: "服务",
    industry: "服务", sortConfig: createDefaultMerchantSortConfig(), createdAt: "2026-09-08T00:00:00.000Z",
    location: { countryCode: "ES", country: "Spain", provinceCode: "", province: "", city: "" },
  }], merchantConfigHistoryBySiteId: historyId ? { "10000000": [{ id: historyId, at: "2026-09-08T00:00:00.000Z",
    operator: "synthetic", summary: "Synthetic config update", changes: ["test"], before: config, after: config }] } : {} });
}
const json = (value: unknown): PlatformSnapshotJson => JSON.parse(JSON.stringify(value));
const archiveFor = (id: string) => derivePlatformMerchantConfigArchiveEntries({ nextHistoryBySiteId: payload(id).merchantConfigHistoryBySiteId });
function rawView(snapshot = payload("current-history"), archive = archiveFor("current-archive")): PlatformSnapshotAtomicView {
  return { version: 1, scope: "user_manage", rows: PLATFORM_SNAPSHOT_ATOMIC_SCOPES.user_manage.map((slug, index) => ({ slug, row: {
    id: `00000000-0000-0000-0000-${String(index + 1).padStart(12, "0")}`,
    updatedAt: "2026-09-08T12:34:56.123456+00:00",
    blocks: json([ARCHIVE, ARCHIVE_BACKUP].includes(slug) ? buildPlatformMerchantConfigArchiveBlocks(archive)
      : buildPlatformMerchantSnapshotBlocks(snapshot, { includeHistory: [HISTORY, HISTORY_BACKUP].includes(slug) })),
  } })) };
}
function freezeDeep<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) freezeDeep(item);
    Object.freeze(value);
  }
  return value;
}
function plannedView(view: PlatformSnapshotAtomicView, writes: ReturnType<typeof preparePlatformMerchantUserManageRestoreAtomic>["writes"]) {
  return { ...view, rows: writes.map(({ slug, blocks }, index) => ({ slug, row: {
    id: view.rows[index].row?.id ?? `00000000-0000-0000-0000-${String(index + 10).padStart(12, "0")}`,
    updatedAt: "2026-09-08T12:35:56.654321+00:00", blocks,
  } })) } satisfies PlatformSnapshotAtomicView;
}

test("restore preserves directory/history merge but precisely replaces both archives without deriving new audit entries", () => {
  const current = payload("current-history"); current.snapshot.push({ ...current.snapshot[0], id: "10000001", name: "Retained merchant" });
  const backup = payload("restored-history"); backup.revision = "backup-revision"; backup.snapshot[0].merchantName = "Restored name";
  const backupArchive = archiveFor("backup-archive"); const view = rawView(current);
  const plan = preparePlatformMerchantUserManageRestoreAtomic(view, backup, backupArchive);
  assert.deepEqual(new Set(plan.snapshot.snapshot.map((item) => item.id)), new Set(["10000000", "10000001"]));
  assert.equal(plan.snapshot.snapshot.find((site) => site.id === "10000000")!.merchantName, "Restored name");
  assert.deepEqual(new Set(plan.snapshot.merchantConfigHistoryBySiteId["10000000"].map((item) => item.id)),
    new Set(["current-history", "restored-history"]));
  assert.notEqual(plan.snapshot.revision, current.revision); assert.notEqual(plan.snapshot.revision, backup.revision);
  assert.deepEqual(plan.archive, normalizePlatformMerchantConfigArchivePayload(backupArchive));
  assert.deepEqual(plan.archive.audits.map((item) => item.id), ["backup-archive"]);
  assert.deepEqual(plan.writes.map((item) => item.slug), PLATFORM_SNAPSHOT_ATOMIC_SCOPES.user_manage);
  const parsed = readPlatformMerchantUserManageAtomicView(plannedView(view, plan.writes));
  assert.deepEqual(parsed.snapshot, plan.snapshot); assert.deepEqual(parsed.archive, plan.archive);
});

test("restored empty text, null expiry, image and missing sort-rank preserve existing merge fallbacks", () => {
  const current = payload(); const site = current.snapshot[0];
  site.contactEmail = "synthetic@example.invalid"; site.merchantCardImageUrl = "https://example.invalid/current.png";
  site.merchantCardImageOpacity = 0.4; site.serviceExpiresAt = "2030-09-08T00:00:00.000Z";
  site.sortConfig = { ...createDefaultMerchantSortConfig(), recommendedCountryRank: 2 };
  site.permissionConfig = { ...createDefaultMerchantPermissionConfig(), allowEnterpriseManagement: true };
  const backup = payload(); backup.snapshot[0].contactEmail = ""; backup.snapshot[0].serviceExpiresAt = null;
  backup.snapshot[0].permissionConfig = { ...createDefaultMerchantPermissionConfig(), allowEnterpriseManagement: false };
  const plan = preparePlatformMerchantUserManageRestoreAtomic(rawView(current), backup, { audits: [], backups: [] });
  const restored = plan.snapshot.snapshot[0];
  assert.equal(restored.contactEmail, site.contactEmail); assert.equal(restored.serviceExpiresAt, site.serviceExpiresAt);
  assert.equal(restored.merchantCardImageUrl, site.merchantCardImageUrl); assert.equal(restored.merchantCardImageOpacity, 0.4);
  assert.equal(restored.sortConfig?.recommendedCountryRank, 2);
  // Restoring service configuration is intentional; this never writes Auth/employee role tables.
  assert.equal(restored.permissionConfig?.allowEnterpriseManagement, false);
});

for (const kind of ["null", "empty"] as const) {
  test(`${kind} backup snapshot retains existing directory/history while empty archive clears only archive content`, () => {
    const current = payload("retained-history"); current.defaultSortRule = "created_asc";
    const backup = kind === "null" ? null : normalizePlatformMerchantSnapshotPayload({ snapshot: [] });
    const plan = preparePlatformMerchantUserManageRestoreAtomic(rawView(current), backup, { audits: [], backups: [] });
    assert.deepEqual(plan.snapshot.snapshot, current.snapshot);
    assert.deepEqual(plan.snapshot.merchantConfigHistoryBySiteId, current.merchantConfigHistoryBySiteId);
    assert.equal(plan.snapshot.defaultSortRule, "created_desc");
    assert.deepEqual(plan.archive, { audits: [], backups: [] });
    assert.notEqual(plan.snapshot.revision, current.revision);
  });
}

test("all missing target rows form six valid envelopes without resurrecting any omitted archive entry", () => {
  const view = rawView(); view.rows.forEach((entry) => { entry.row = null; });
  const plan = preparePlatformMerchantUserManageRestoreAtomic(view, null, { audits: [], backups: [] });
  assert.equal(plan.writes.length, 6); assert.ok(plan.snapshot.revision);
  assert.deepEqual(plan.snapshot.snapshot, []); assert.deepEqual(plan.snapshot.merchantConfigHistoryBySiteId, {});
  const parsed = readPlatformMerchantUserManageAtomicView(plannedView(view, plan.writes));
  assert.deepEqual(parsed.snapshot, plan.snapshot); assert.deepEqual(parsed.archive, plan.archive);
});

test("history-only existing row and backup-only history survive restore", () => {
  const history = payload("history-only"); history.snapshot = [];
  const view = rawView(); view.rows.forEach((entry) => { if (entry.slug !== HISTORY_BACKUP) entry.row = null; });
  view.rows.find((entry) => entry.slug === HISTORY_BACKUP)!.row!.blocks = json(buildPlatformMerchantSnapshotBlocks(history));
  const plan = preparePlatformMerchantUserManageRestoreAtomic(view, payload("restored"), { audits: [], backups: [] });
  assert.deepEqual(new Set(plan.snapshot.merchantConfigHistoryBySiteId["10000000"].map((item) => item.id)), new Set(["history-only", "restored"]));
  assert.equal(plan.archive.audits.length, 0);
});

test("history identity merge retains the latest existing entry rather than silently restoring an older duplicate", () => {
  const current = payload("same-id"); current.merchantConfigHistoryBySiteId["10000000"][0].at = "2026-09-08T12:00:00.000Z";
  current.merchantConfigHistoryBySiteId["10000000"][0].summary = "Current latest";
  const backup = payload("same-id");
  const plan = preparePlatformMerchantUserManageRestoreAtomic(rawView(current), backup, archiveFor("only-backup-archive"));
  assert.equal(plan.snapshot.merchantConfigHistoryBySiteId["10000000"].length, 1);
  assert.equal(plan.snapshot.merchantConfigHistoryBySiteId["10000000"][0].summary, "Current latest");
});

test("no input mutation or reference-sharing between physical CAS rows, backup values and constructed writes", () => {
  const view = rawView(); const backup = payload("restore"); const archive = archiveFor("archive");
  const before = structuredClone({ view, backup, archive });
  freezeDeep(view); freezeDeep(backup); freezeDeep(archive);
  const plan = preparePlatformMerchantUserManageRestoreAtomic(view, backup, archive);
  assert.deepEqual({ view, backup, archive }, before);
  const originalWrites = structuredClone(plan.writes);
  plan.snapshot.snapshot[0].name = "Mutated returned business view";
  plan.archive.audits[0].summary = "Mutated returned archive";
  assert.deepEqual(plan.writes, originalWrites);
  const parsed = readPlatformMerchantUserManageAtomicView(view);
  parsed.view.rows[0].row!.blocks = []; parsed.snapshot!.snapshot[0].name = "Mutated read view";
  assert.deepEqual({ view, backup, archive }, before);
  const first = plan.writes.find((entry) => entry.slug === PRIMARY)!;
  const second = plan.writes.find((entry) => entry.slug === BACKUP)!;
  (first.blocks as PlatformSnapshotJson[]).push(null);
  assert.notDeepEqual(first.blocks, second.blocks);
});

for (const slug of PLATFORM_SNAPSHOT_ATOMIC_SCOPES.user_manage) {
  test(`damaged target copy ${slug} rejects even though the restore would otherwise replace that copy`, () => {
    const view = rawView(); view.rows.find((entry) => entry.slug === slug)!.row!.blocks = [];
    assert.throws(() => preparePlatformMerchantUserManageRestoreAtomic(view, payload(), { audits: [], backups: [] }),
      /platform_snapshot_atomic_store_corrupt/);
  });
}

test("complete raw vector validation rejects wrong scope, omitted or duplicate rows and forged versions", () => {
  const variants: Array<(view: PlatformSnapshotAtomicView) => void> = [
    (view) => { view.scope = "backup_catalog"; },
    (view) => { view.rows.pop(); },
    (view) => { view.rows[0] = structuredClone(view.rows[1]); },
    (view) => { view.rows.reverse(); },
    (view) => { view.rows[0].row!.id = "not-a-uuid"; },
    (view) => { view.rows[0].row!.updatedAt = "not-a-timestamp"; },
    (view) => { Object.assign(view.rows[0].row!, { merchant_id: "10000000" }); },
    (view) => { view.version = 2 as never; },
  ];
  for (const mutate of variants) {
    const view = rawView(); mutate(view);
    assert.throws(() => preparePlatformMerchantUserManageRestoreAtomic(view, payload(), { audits: [], backups: [] }),
      /platform_snapshot_atomic_store_corrupt/);
  }
});

test("invalid backup shape rejects before normalization can discard damaged entries or unknown fields", () => {
  const invalidBackups = [undefined, { ...payload(), snapshot: [null] }, { ...payload(), snapshot: [payload().snapshot[0], payload().snapshot[0]] },
    { ...payload(), employeeRoles: [] }, { ...payload(), merchantConfigHistoryBySiteId: { bad: [] } }];
  for (const backup of invalidBackups) {
    assert.throws(() => preparePlatformMerchantUserManageRestoreAtomic(rawView(), backup as never, { audits: [], backups: [] }),
      /platform_snapshot_atomic_invalid_request/);
  }
});

test("invalid archive input rejects rather than silently dropping or deduplicating entries", () => {
  const archive = archiveFor("archive");
  const variants = [null, undefined, { audits: [null], backups: [] }, { ...archive, audits: [...archive.audits, ...archive.audits] },
    { ...archive, backups: [{ ...archive.backups[0], at: "bad" }] }, { ...archive, extra: "not supported" }];
  for (const input of variants) {
    assert.throws(() => preparePlatformMerchantUserManageRestoreAtomic(rawView(), payload(), input as never),
      /platform_snapshot_atomic_invalid_request/);
  }
});

test("planner emits only the exact six target writes: no catalog, account, support or employee-role writes", () => {
  const plan = preparePlatformMerchantUserManageRestoreAtomic(rawView(), payload("restore"), archiveFor("archive"));
  assert.deepEqual(plan.writes.map((item) => item.slug), PLATFORM_SNAPSHOT_ATOMIC_SCOPES.user_manage);
  assert.ok(plan.writes.every((write) => Object.keys(write).sort().join(",") === "blocks,slug"));
  assert.deepEqual(Object.keys(plan).sort(), ["archive", "snapshot", "writes"]);
});
