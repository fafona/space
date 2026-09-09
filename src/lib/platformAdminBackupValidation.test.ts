import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultMerchantContactVisibility, createDefaultMerchantPermissionConfig,
  createDefaultMerchantSortConfig, loadPlatformState, normalizePlatformState } from "@/data/platformControlStore";
import { createDefaultMerchantBusinessCardDraft } from "@/lib/merchantBusinessCards";
import { buildPlatformAdminDataBackupBlocks, createPlatformAdminDataBackupEntry,
  PLATFORM_ADMIN_DATA_BACKUP_SLUG, PLATFORM_ADMIN_DATA_BACKUP_BACKUP_SLUG } from "./platformAdminDataBackup";
import { buildPlatformMerchantConfigArchiveBlocks, PLATFORM_MERCHANT_CONFIG_ARCHIVE_SLUG,
  PLATFORM_MERCHANT_CONFIG_ARCHIVE_BACKUP_SLUG } from "./platformMerchantConfigArchive";
import { buildPlatformMerchantSnapshotBlocks, PLATFORM_MERCHANT_SNAPSHOT_SLUG, PLATFORM_MERCHANT_SNAPSHOT_BACKUP_SLUG,
  PLATFORM_MERCHANT_SNAPSHOT_HISTORY_SLUG, PLATFORM_MERCHANT_SNAPSHOT_HISTORY_BACKUP_SLUG } from "./platformMerchantSnapshot";
import { buildPlatformSupportInboxBlocks, PLATFORM_SUPPORT_INBOX_SLUG, readPlatformSupportInboxFromBlocks } from "./platformSupportInbox";
import { assertPlatformAdminBackupCopiesConsistent, assertPlatformAdminBackupMerchantAccounts, assertPlatformAdminBackupPlatformState,
  assertPlatformAdminBackupSnapshot, readPlatformAdminDataBackupBlocksValidated,
  readPlatformMerchantConfigArchiveBlocksValidated, readPlatformMerchantSnapshotBlocksValidated,
  readPlatformSupportInboxBlocksValidated } from "./platformAdminBackupValidation";
import { PLATFORM_ADMIN_BACKUP_READ_UNAVAILABLE } from "./platformAdminBackupStrictRead";
import { loadStoredPlatformAdminDataBackups, type PlatformAdminDataBackupStoreClient } from "./platformAdminDataBackupStore";
import { loadStoredPlatformMerchantSnapshot, type PlatformMerchantSnapshotStoreClient } from "./platformMerchantSnapshotStore";
import { loadStoredPlatformMerchantConfigArchive, type PlatformMerchantConfigArchiveStoreClient } from "./platformMerchantConfigArchiveStore";
import { loadStoredPlatformSupportInbox, type PlatformSupportInboxStoreClient } from "./platformSupportInboxStore";

const AT = "2026-09-08T12:00:00.000Z";
const SITE = "10000000";
const failure = { message: PLATFORM_ADMIN_BACKUP_READ_UNAVAILABLE };
type Raw = Record<string, unknown>;
function stored<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
function fixture() {
  const config = { serviceExpiresAt: null, permissionConfig: createDefaultMerchantPermissionConfig(), merchantCardImageUrl: "",
    merchantCardImageOpacity: 1, chatAvatarImageUrl: "", contactVisibility: createDefaultMerchantContactVisibility(), sortConfig: createDefaultMerchantSortConfig() };
  const history = { id: "history-1", at: AT, operator: "Synthetic admin", summary: "changed", changes: ["one change"], before: config, after: config };
  const card = { ...createDefaultMerchantBusinessCardDraft({}), id: "card-1", imageUrl: "https://example.test/card.png",
    targetUrl: "https://example.test", createdAt: AT };
  const snapshot = { revision: "snapshot-one", defaultSortRule: "created_desc" as const,
    snapshot: [{ id: SITE, merchantName: "Synthetic merchant", name: "Synthetic", domain: "synthetic", category: "服务", industry: "服务" as const,
      location: { countryCode: "ES", country: "Spain", provinceCode: "AN", province: "Sevilla", city: "Sevilla" },
      ...config, createdAt: AT, businessCards: [card] }], merchantConfigHistoryBySiteId: { [SITE]: [history] } };
  const archive = { audits: [{ ...history, siteId: SITE, merchantName: "Synthetic", source: "update" as const }],
    backups: [{ id: "config-backup-1", siteId: SITE, merchantName: "Synthetic", at: AT, operator: "Synthetic admin",
      source: "update" as const, summary: "backup", changes: ["one change"], snapshot: config, sourceHistoryEntryId: history.id }] };
  const support = { threads: [{ merchantId: SITE, siteId: SITE, merchantName: "Synthetic", merchantEmail: "user@example.test",
    updatedAt: AT, messages: [{ id: "message-1", sender: "merchant" as const, text: "hello", createdAt: AT }] }] };
  const entry = createPlatformAdminDataBackupEntry({ source: "manual", operator: "Synthetic admin", snapshot: {
    platformState: loadPlatformState(), merchantSnapshot: snapshot, merchantConfigArchive: archive, supportInbox: support,
    merchantAccounts: [{ merchantId: SITE, merchantName: "Synthetic", email: "user@example.test", username: "synthetic", loginId: SITE,
      createdAt: AT, authUserId: "auth-one", emailConfirmed: true, emailConfirmedAt: AT, lastSignInAt: null, manualCreated: true,
      hasPublishedSite: true, siteSlug: "synthetic", siteUpdatedAt: AT, publishedBytes: 20_000_000, publishedBytesKnown: true,
      visits: { today: 0, day7: 20, day30: 300, total: 3_000_000 }, visitsKnown: true }] } });
  return stored({ config, history, snapshot, archive, support, entry,
    backupBlocks: buildPlatformAdminDataBackupBlocks({ backups: [entry] }), snapshotBlocks: buildPlatformMerchantSnapshotBlocks(snapshot),
    archiveBlocks: buildPlatformMerchantConfigArchiveBlocks(archive), supportBlocks: buildPlatformSupportInboxBlocks(support) });
}
function setAt(value: unknown, path: string, replacement: unknown) {
  const parts = path.split("."); let current = value as Raw;
  for (const part of parts.slice(0, -1)) current = current[part] as Raw;
  current[parts.at(-1)!] = replacement;
}
function getAt(value: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((current, key) => (current as Raw)[key], value);
}

test("all current builders and complete built-in platform state pass without dropping records", () => {
  const f = fixture(); assertPlatformAdminBackupPlatformState(normalizePlatformState({}));
  assertPlatformAdminBackupPlatformState(loadPlatformState()); assertPlatformAdminBackupSnapshot(f.entry.snapshot);
  assert.equal(readPlatformAdminDataBackupBlocksValidated(f.backupBlocks).backups[0]?.id, f.entry.id);
  assert.equal(readPlatformMerchantSnapshotBlocksValidated(f.snapshotBlocks)?.snapshot.length, 1);
  assert.equal(readPlatformMerchantConfigArchiveBlocksValidated(f.archiveBlocks).audits.length, 1);
  assert.equal(readPlatformSupportInboxBlocksValidated(f.supportBlocks).threads[0]?.messages.length, 1);
});

test("summary bytes and visit counters greater than one million remain legitimate", () => {
  const f = fixture(); const accounts = f.entry.snapshot.merchantAccounts;
  accounts[0].publishedBytes = 20_000_000; accounts[0].visits.total = 3_000_000;
  assert.doesNotThrow(() => assertPlatformAdminBackupMerchantAccounts(accounts));
  const value = readPlatformAdminDataBackupBlocksValidated(buildPlatformAdminDataBackupBlocks({ backups: [f.entry] }));
  assert.equal(value.backups[0].snapshot.merchantAccounts[0].publishedBytes, 20_000_000);
  assert.equal(value.backups[0].snapshot.merchantAccounts[0].visits.total, 3_000_000);
});

test("distinct merchants may share a display username without losing either summary", () => {
  const f = fixture();
  f.entry.snapshot.merchantAccounts = [
    { ...f.entry.snapshot.merchantAccounts[0], authUserId: null, username: "个人用户" },
    { ...f.entry.snapshot.merchantAccounts[0], authUserId: null, merchantId: "10000001", loginId: "10000001",
      email: "other@example.test", username: "个人用户" },
  ];
  assert.doesNotThrow(() => assertPlatformAdminBackupMerchantAccounts(f.entry.snapshot.merchantAccounts));
  const saved = readPlatformAdminDataBackupBlocksValidated(buildPlatformAdminDataBackupBlocks({ backups: [f.entry] }));
  assert.equal(saved.backups[0].snapshot.merchantAccounts.length, 2);
});

test("distinct auth identities may share lower-priority account aliases", () => {
  const account = fixture().entry.snapshot.merchantAccounts[0];
  assert.doesNotThrow(() => assertPlatformAdminBackupMerchantAccounts([
    { ...account, authUserId: "auth-one" }, { ...account, authUserId: "auth-two" },
  ]));
});

for (const key of ["authUserId", "merchantId", "loginId"] as const) {
  test(`duplicate primary ${key} remains invalid even when display aliases differ`, () => {
    const shared = { [key]: "primary-identity" };
    assert.throws(() => assertPlatformAdminBackupMerchantAccounts([
      { ...shared, username: "first", email: "first@example.test" },
      { ...shared, [key]: " primary-identity ", username: "second", email: "second@example.test" },
    ]), failure);
  });
}

test("email fallback uses trimmed case-insensitive identity when no stable ID exists", () => {
  assert.throws(() => assertPlatformAdminBackupMerchantAccounts([
    { email: "Same@Example.test", username: "first" },
    { email: " same@example.test ", username: "second" },
  ]), failure);
  assert.doesNotThrow(() => assertPlatformAdminBackupMerchantAccounts([
    { email: "first@example.test", username: "个人用户" },
    { email: "second@example.test", username: "个人用户" },
  ]));
});

test("username-only fallback rejects duplicate identity without rejecting typed-key collisions", () => {
  assert.throws(() => assertPlatformAdminBackupMerchantAccounts([
    { username: "legacy-user" }, { username: " legacy-user " },
  ]), failure);
  assert.doesNotThrow(() => assertPlatformAdminBackupMerchantAccounts([
    { merchantId: "legacy-user" }, { loginId: "legacy-user" }, { username: "legacy-user" },
  ]));
});

test("auth-only summary that the existing normalizer would discard is rejected", () => {
  assert.throws(() => assertPlatformAdminBackupMerchantAccounts([{ authUserId: "auth-only" }]), failure);
});

const readers = [
  { key: "backupBlocks", read: readPlatformAdminDataBackupBlocksValidated },
  { key: "snapshotBlocks", read: readPlatformMerchantSnapshotBlocksValidated },
  { key: "archiveBlocks", read: readPlatformMerchantConfigArchiveBlocksValidated },
  { key: "supportBlocks", read: readPlatformSupportInboxBlocksValidated },
] as const;
for (const { key, read } of readers) {
  test(`${key}: missing storage is accepted but empty or repeated envelopes are rejected`, () => {
    const raw = fixture()[key]; assert.doesNotThrow(() => read(null));
    for (const malformed of [[], [{}], [raw[0], raw[0]], [raw[0], { props: { unknownPayload: [] } }]]) {
      assert.throws(() => read(malformed), failure);
    }
  });
  test(`${key}: unsupported payload version and unknown critical envelope structure are rejected`, () => {
    const raw = fixture()[key] as Raw[];
    (raw[0].props as Raw)[key === "snapshotBlocks" ? "platformMerchantSnapshotVersion" : "version"] = 999;
    assert.throws(() => read(raw), failure);
    const other = fixture()[key] as Raw[]; (other[0].props as Raw).unknownPermissions = { admin: true };
    assert.throws(() => read(other), failure);
  });
}

for (const alias of ["snapshot", "sites", "publishedMerchantSnapshot"]) {
  test(`known legacy ${alias} snapshot shape is accepted with absent newer display fields`, () => {
    const raw = [{ id: "__platform_merchant_snapshot__", type: "common", props: { [alias]: [{ id: SITE, name: "Legacy" }] } }];
    assert.equal(readPlatformMerchantSnapshotBlocksValidated(raw)?.snapshot[0]?.id, SITE);
  });
}
test("ambiguous simultaneously supplied snapshot aliases are rejected, not priority-selected", () => {
  const raw = fixture().snapshotBlocks as Raw[];
  (raw[0].props as Raw).sites = [];
  assert.throws(() => readPlatformMerchantSnapshotBlocksValidated(raw), failure);
});
test("valid empty directory retains nonempty configuration history and differs from absent storage", () => {
  const f = fixture(); f.snapshot.snapshot = [];
  const result = readPlatformMerchantSnapshotBlocksValidated(buildPlatformMerchantSnapshotBlocks(f.snapshot));
  assert.ok(result); assert.deepEqual(result.snapshot, []);
  assert.equal(result.merchantConfigHistoryBySiteId[SITE][0].id, f.history.id);
  assert.equal(readPlatformMerchantSnapshotBlocksValidated(null), null);
});

const badSnapshotPaths: Array<[string, unknown]> = [
  ["platformState", []], ["platformState.roles", {}], ["platformState.users", null], ["platformState.sites", "broken"],
  ["platformState.planTemplates.0.blocks", {}], ["platformState.planTemplates.0.planPreviewImageUrls", []],
  ["platformState.roles.0.permissions", ["dashboard.view", "unrecognized.manage"]],
  ["platformState.roles.0.permissions", ["dashboard.view", "dashboard.view"]],
  ["platformState.users.0.roleIds", {}], ["platformState.users.0.roleIds", ["same", "same"]],
  ["platformState.homeLayout.sections", null], ["platformState.homeLayout.featuredCategoryIds", [42]],
  ["platformState.sites.0.features", { made_up_permission: true }], ["platformState.sites.0.permissionConfig", { allowPointsRedemption: "true" }],
  ["platformState.sites.0.location", []], ["merchantSnapshot", []], ["merchantSnapshot.snapshot", {}],
  ["merchantSnapshot.snapshot.0.id", "invalid"], ["merchantSnapshot.snapshot.0.status", "new-superuser-state"],
  ["merchantSnapshot.snapshot.0.permissionConfig", { unknownModule: { allow: true } }],
  ["merchantSnapshot.snapshot.0.permissionConfig.pageLimit", 9999], ["merchantSnapshot.snapshot.0.contactVisibility.phoneHidden", "false"],
  ["merchantSnapshot.snapshot.0.sortConfig", []], ["merchantSnapshot.snapshot.0.businessCards", {}],
  ["merchantSnapshot.snapshot.0.businessCards.0.imageUrl", ""], ["merchantSnapshot.snapshot.0.businessCards.0.contacts", []],
  ["merchantSnapshot.snapshot.0.businessCards.0.contacts.phones", ["1", "2", "3"]],
  ["merchantSnapshot.snapshot.0.businessCards.0.customContactLinks", [{ id: "link-1", url: "", displayText: "" }]],
  ["merchantSnapshot.snapshot.0.businessCards.0.contactFieldOrder", ["phone", "bad-field"]],
  ["merchantSnapshot.snapshot.0.businessCards.0.typography.info.fontWeight", "unknown"],
  ["merchantSnapshot.snapshot.0.businessCards.0.fieldTypography.phone.fontSize", -50],
  ["merchantSnapshot.snapshot.0.businessCards.0.qr.size", 0],
  ["merchantSnapshot.snapshot.0.businessCards.0.width", 1],
  ["merchantSnapshot.merchantConfigHistoryBySiteId", []], ["merchantSnapshot.merchantConfigHistoryBySiteId.bad-site", []],
  [`merchantSnapshot.merchantConfigHistoryBySiteId.${SITE}`, {}],
  [`merchantSnapshot.merchantConfigHistoryBySiteId.${SITE}.0.before`, null],
  [`merchantSnapshot.merchantConfigHistoryBySiteId.${SITE}.0.after.permissionConfig.allowBookingBlock`, "yes"],
  [`merchantSnapshot.merchantConfigHistoryBySiteId.${SITE}.0.at`, "2026-02-30T12:00:00Z"],
  ["merchantConfigArchive.audits", {}], ["merchantConfigArchive.audits.0.siteId", ""], ["merchantConfigArchive.audits.0.before", []],
  ["merchantConfigArchive.backups.0.snapshot", {}], ["merchantConfigArchive.backups.0.source", "unknown"],
  ["supportInbox.threads", null], ["supportInbox.threads.0.messages", {}], ["supportInbox.threads.0.merchantId", ""],
  ["supportInbox.threads.0.messages.0.sender", "owner"], ["supportInbox.threads.0.messages.0.text", " "],
  ["supportInbox.threads.0.messages.0.id", ""], ["supportInbox.threads.0.messages.0.createdAt", "not-a-date"],
  ["merchantAccounts", {}], ["merchantAccounts.0.emailConfirmed", "true"], ["merchantAccounts.0.visits.total", -1],
  ["merchantAccounts.0.visits", []], ["merchantAccounts.0.publishedBytes", Number.MAX_SAFE_INTEGER + 1],
  ["unknownFutureBusinessData", { pointsLedger: [] }],
];
for (const [path, value] of badSnapshotPaths) {
  test(`raw malformed nested snapshot is rejected before normalization: ${path}`, () => {
    const f = fixture(); setAt(f.entry.snapshot, path, value);
    assert.throws(() => assertPlatformAdminBackupSnapshot(f.entry.snapshot), failure);
  });
}

for (const path of ["platformState.roles", "platformState.users", "platformState.sites", "platformState.tenants", "platformState.planTemplates",
  "platformState.industryCategories", "platformState.homeLayout.sections", "merchantSnapshot.snapshot",
  `merchantSnapshot.merchantConfigHistoryBySiteId.${SITE}`, "merchantConfigArchive.audits", "merchantConfigArchive.backups",
  "supportInbox.threads", "supportInbox.threads.0.messages", "merchantAccounts", "merchantSnapshot.snapshot.0.businessCards"]) {
  test(`duplicate identities cannot silently collapse: ${path}`, () => {
    const f = fixture(); const entries = getAt(f.entry.snapshot, path) as unknown[];
    assert.ok(entries.length > 0, `positive fixture must exercise ${path}`);
    entries.push(stored(entries[0])); assert.throws(() => assertPlatformAdminBackupSnapshot(f.entry.snapshot), failure);
  });
}

test("invalid backup entry metadata is rejected instead of discarding entry or generating a new id", () => {
  for (const [path, value] of [["id", ""], ["at", "bad"], ["source", "unexpected"], ["snapshot", {}]] as const) {
    const raw = fixture().backupBlocks as Raw[];
    setAt(raw, `0.props.payload.backups.0.${path}`, value);
    assert.throws(() => readPlatformAdminDataBackupBlocksValidated(raw), failure);
  }
  const raw = fixture().backupBlocks as Raw[];
  const entries = getAt(raw, "0.props.payload.backups") as unknown[]; entries.push(stored(entries[0]));
  assert.throws(() => readPlatformAdminDataBackupBlocksValidated(raw), failure);
});
test("opaque template JSON keeps extension fields but rejects non-JSON values and excessive recursion", () => {
  const f = fixture(); const template = f.entry.snapshot.platformState.planTemplates[0];
  template.blocks = [{ id: "custom", type: "future-template-block", props: { arbitraryNested: [{ answer: 42 }] } }];
  assert.doesNotThrow(() => assertPlatformAdminBackupSnapshot(f.entry.snapshot));
  for (const value of [new Date(), Number.NaN, undefined, () => 1]) {
    template.blocks = [value]; assert.throws(() => assertPlatformAdminBackupSnapshot(f.entry.snapshot), failure);
  }
  const cycle: Raw = {}; cycle.self = cycle; template.blocks = [cycle];
  assert.throws(() => assertPlatformAdminBackupSnapshot(f.entry.snapshot), failure);
  let deep: unknown = {}; for (let index = 0; index < 70; index++) deep = { next: deep };
  template.blocks = [deep]; assert.throws(() => assertPlatformAdminBackupSnapshot(f.entry.snapshot), failure);
});
test("legacy missing newer optional permission flags and card presentation settings remain accepted", () => {
  const f = fixture();
  const config = getAt(f.entry.snapshot, `merchantSnapshot.merchantConfigHistoryBySiteId.${SITE}.0.before.permissionConfig`) as Raw;
  delete config.allowBusinessCardIntroVideo; delete config.allowEnterpriseManagement;
  setAt(f.entry.snapshot, "merchantSnapshot.snapshot.0.businessCards.0", { id: "legacy", imageUrl: "https://example.test/legacy.png", createdAt: AT });
  assert.doesNotThrow(() => assertPlatformAdminBackupSnapshot(f.entry.snapshot));
});
test("normal non-backup parser keeps its original permissive compatibility behavior", () => {
  const raw = fixture().supportBlocks as Raw[]; setAt(raw, "0.props.payload.threads.0.messages", [null]);
  assert.deepEqual(readPlatformSupportInboxFromBlocks(raw).threads[0].messages, []);
  assert.throws(() => readPlatformSupportInboxBlocksValidated(raw), failure);
});

type Client = PlatformAdminDataBackupStoreClient & PlatformMerchantSnapshotStoreClient & PlatformMerchantConfigArchiveStoreClient & PlatformSupportInboxStoreClient;
function clientFor(rows: Map<string, unknown[]>) {
  const readSlugs: string[] = [];
  const client = { from() {
    let slug = "";
    const query = { select() { return query; }, is() { return query; }, eq(_key: string, value: unknown) { slug = String(value); return query; },
      limit() { return query; }, async maybeSingle() { readSlugs.push(slug); return { data: rows.has(slug) ? { blocks: rows.get(slug) } : null, error: null }; },
      update() { assert.fail("strict reads cannot write"); }, insert() { assert.fail("strict reads cannot write"); } };
    return query;
  } } as unknown as Client;
  return { client, readSlugs };
}
const storeCases = [
  { slugs: [PLATFORM_ADMIN_DATA_BACKUP_SLUG, PLATFORM_ADMIN_DATA_BACKUP_BACKUP_SLUG], key: "backupBlocks", read: (client: Client) => loadStoredPlatformAdminDataBackups(client, { strict: true }) },
  { slugs: [PLATFORM_MERCHANT_SNAPSHOT_SLUG, PLATFORM_MERCHANT_SNAPSHOT_BACKUP_SLUG, PLATFORM_MERCHANT_SNAPSHOT_HISTORY_SLUG, PLATFORM_MERCHANT_SNAPSHOT_HISTORY_BACKUP_SLUG], key: "snapshotBlocks", read: (client: Client) => loadStoredPlatformMerchantSnapshot(client, { strict: true }) },
  { slugs: [PLATFORM_MERCHANT_CONFIG_ARCHIVE_SLUG, PLATFORM_MERCHANT_CONFIG_ARCHIVE_BACKUP_SLUG], key: "archiveBlocks", read: (client: Client) => loadStoredPlatformMerchantConfigArchive(client, { strict: true }) },
  { slugs: [PLATFORM_SUPPORT_INBOX_SLUG], key: "supportBlocks", read: (client: Client) => loadStoredPlatformSupportInbox(client, { strict: true }) },
] as const;
for (const entry of storeCases) {
  for (const badSlug of entry.slugs) {
    test(`strict store rejects malformed original payload even when another copy is valid: ${badSlug}`, async () => {
      const f = fixture(); const rows = new Map<string, unknown[]>(entry.slugs.map((slug) => [slug, f[entry.key]]));
      rows.set(badSlug, [{ type: "common", props: { unknownPayload: [] } }]);
      const { client } = clientFor(rows); await assert.rejects(entry.read(client), failure);
    });
  }
  test(`strict ${entry.key} accepts ordinary identical primary/backup copies`, async () => {
    const f = fixture(); const rows = new Map<string, unknown[]>(entry.slugs.map((slug) => [slug, f[entry.key]]));
    const { client } = clientFor(rows); await assert.doesNotReject(entry.read(client));
  });
}
test("strict merchant snapshot store preserves history-only rows while combining copies", async () => {
  const f = fixture(); f.snapshot.snapshot = [];
  const rows = new Map([[PLATFORM_MERCHANT_SNAPSHOT_HISTORY_SLUG, buildPlatformMerchantSnapshotBlocks(f.snapshot)]]);
  const { client } = clientFor(rows);
  const result = await loadStoredPlatformMerchantSnapshot(client, { strict: true });
  assert.equal(result?.merchantConfigHistoryBySiteId[SITE][0].id, f.history.id);
});

test("same immutable backup id with different original contents is rejected across copies", async () => {
  const f = fixture(); const conflicting = stored(f.backupBlocks);
  setAt(conflicting, "0.props.payload.backups.0.snapshot.supportInbox.threads.0.messages.0.text", "conflicting content");
  assert.throws(() => assertPlatformAdminBackupCopiesConsistent([f.backupBlocks, conflicting]), failure);
  const { client } = clientFor(new Map([[PLATFORM_ADMIN_DATA_BACKUP_SLUG, f.backupBlocks], [PLATFORM_ADMIN_DATA_BACKUP_BACKUP_SLUG, conflicting]]));
  await assert.rejects(loadStoredPlatformAdminDataBackups(client, { strict: true }), failure);
});

test("changing a timestamp does not authorize redefining an existing backup id", () => {
  const f = fixture(); const conflicting = stored(f.backupBlocks);
  setAt(conflicting, "0.props.payload.backups.0.at", "2026-09-09T12:00:00.000Z");
  assert.throws(() => assertPlatformAdminBackupCopiesConsistent([f.backupBlocks, conflicting]), failure);
});

test("identical backup contents with different object-key order are accepted", () => {
  const f = fixture(); const reordered = stored(f.backupBlocks);
  const entry = getAt(reordered, "0.props.payload.backups.0") as Raw;
  setAt(reordered, "0.props.payload.backups.0", Object.fromEntries(Object.entries(entry).reverse()));
  assert.doesNotThrow(() => assertPlatformAdminBackupCopiesConsistent([f.backupBlocks, reordered]));
});

test("different backup id sets are allowed and merge retains the latest eight entries", async () => {
  const f = fixture();
  const entries = Array.from({ length: 10 }, (_, index) => ({ ...stored(f.entry), id: `backup-${index}`,
    at: new Date(Date.UTC(2026, 8, index + 1, 12)).toISOString() }));
  const primary = buildPlatformAdminDataBackupBlocks({ backups: entries.slice(0, 6) });
  const backup = buildPlatformAdminDataBackupBlocks({ backups: entries.slice(4) });
  const { client } = clientFor(new Map([[PLATFORM_ADMIN_DATA_BACKUP_SLUG, primary], [PLATFORM_ADMIN_DATA_BACKUP_BACKUP_SLUG, backup]]));
  const merged = await loadStoredPlatformAdminDataBackups(client, { strict: true });
  assert.equal(merged.backups.length, 8);
  assert.deepEqual(merged.backups.map((entry) => entry.id), ["backup-9", "backup-8", "backup-7", "backup-6", "backup-5", "backup-4", "backup-3", "backup-2"]);
});
