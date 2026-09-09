import assert from "node:assert/strict";
import test from "node:test";
import { normalizePlatformState } from "@/data/platformControlStore";
import { PLATFORM_ADMIN_BACKUP_READ_UNAVAILABLE, readPlatformAdminBackupBlocksStrict } from "./platformAdminBackupStrictRead";
import { createPlatformAdminDataBackupHandlers } from "./platformAdminDataBackupRoute";
import { buildPlatformAdminDataBackupBlocks, createPlatformAdminDataBackupEntry,
  PLATFORM_ADMIN_DATA_BACKUP_SLUG, PLATFORM_ADMIN_DATA_BACKUP_BACKUP_SLUG } from "./platformAdminDataBackup";
import { loadStoredPlatformAdminDataBackups, type PlatformAdminDataBackupStoreClient } from "./platformAdminDataBackupStore";
import { buildPlatformMerchantConfigArchiveBlocks, PLATFORM_MERCHANT_CONFIG_ARCHIVE_SLUG,
  PLATFORM_MERCHANT_CONFIG_ARCHIVE_BACKUP_SLUG } from "./platformMerchantConfigArchive";
import { loadStoredPlatformMerchantConfigArchive, type PlatformMerchantConfigArchiveStoreClient } from "./platformMerchantConfigArchiveStore";
import { buildPlatformMerchantSnapshotBlocks, PLATFORM_MERCHANT_SNAPSHOT_SLUG, PLATFORM_MERCHANT_SNAPSHOT_BACKUP_SLUG,
  PLATFORM_MERCHANT_SNAPSHOT_HISTORY_SLUG, PLATFORM_MERCHANT_SNAPSHOT_HISTORY_BACKUP_SLUG } from "./platformMerchantSnapshot";
import { loadStoredPlatformMerchantSnapshot, type PlatformMerchantSnapshotStoreClient } from "./platformMerchantSnapshotStore";
import { buildPlatformSupportInboxBlocks, PLATFORM_SUPPORT_INBOX_SLUG } from "./platformSupportInbox";
import { loadStoredPlatformSupportInbox, type PlatformSupportInboxStoreClient } from "./platformSupportInboxStore";

type Client = PlatformAdminDataBackupStoreClient & PlatformMerchantConfigArchiveStoreClient &
  PlatformMerchantSnapshotStoreClient & PlatformSupportInboxStoreClient;
type Failure = "error" | "missing-column" | "throw" | "undefined-data" | "malformed-row";
const BACKUP_SLUGS = [PLATFORM_ADMIN_DATA_BACKUP_SLUG, PLATFORM_ADMIN_DATA_BACKUP_BACKUP_SLUG];
const SNAPSHOT_SLUGS = [PLATFORM_MERCHANT_SNAPSHOT_SLUG, PLATFORM_MERCHANT_SNAPSHOT_BACKUP_SLUG,
  PLATFORM_MERCHANT_SNAPSHOT_HISTORY_SLUG, PLATFORM_MERCHANT_SNAPSHOT_HISTORY_BACKUP_SLUG];
const ARCHIVE_SLUGS = [PLATFORM_MERCHANT_CONFIG_ARCHIVE_SLUG, PLATFORM_MERCHANT_CONFIG_ARCHIVE_BACKUP_SLUG];
const ALL_SLUGS = [...BACKUP_SLUGS, ...SNAPSHOT_SLUGS, ...ARCHIVE_SLUGS, PLATFORM_SUPPORT_INBOX_SLUG];

function fixture() {
  const entry = createPlatformAdminDataBackupEntry({ source: "manual", operator: "Synthetic admin", snapshot: {
    platformState: normalizePlatformState({}), merchantSnapshot: null,
    merchantConfigArchive: { audits: [], backups: [] }, supportInbox: { threads: [] }, merchantAccounts: [],
  } });
  entry.id = "synthetic-backup";
  const rows = new Map<string, unknown>([
    [BACKUP_SLUGS[0], buildPlatformAdminDataBackupBlocks({ backups: [entry] })],
    [BACKUP_SLUGS[1], buildPlatformAdminDataBackupBlocks({ backups: [entry] })],
    ...SNAPSHOT_SLUGS.map((slug): [string, unknown] => [slug, buildPlatformMerchantSnapshotBlocks({
      revision: "synthetic", snapshot: [], defaultSortRule: "created_desc", merchantConfigHistoryBySiteId: {},
    })]),
    ...ARCHIVE_SLUGS.map((slug): [string, unknown] => [slug, buildPlatformMerchantConfigArchiveBlocks({ audits: [], backups: [] })]),
    [PLATFORM_SUPPORT_INBOX_SLUG, buildPlatformSupportInboxBlocks({ threads: [] })],
  ]);
  const reads: string[] = [];
  const writes: string[] = [];
  const legacyOnly = new Set<string>();
  const duplicateRows = new Set<string>();
  let failureSlug = "";
  let failure: Failure = "error";
  const client = { from(table: string) {
    assert.equal(table, "pages");
    let slug = "";
    let scoped = false;
    let limit = 1;
    let updateBody: Record<string, unknown> | null = null;
    const builder = {
      select(columns: string) { assert.ok(columns === "blocks" || columns === "id" || columns === "id,blocks"); return builder; },
      is(column: string, value: unknown) { assert.equal(column, "merchant_id"); assert.equal(value, null); scoped = true; return builder; },
      eq(column: string, value: unknown) { assert.ok(column === "slug" || column === "id"); slug = String(value); return builder; },
      limit(value: number) { assert.ok(value === 1 || value === 2); limit = value; return builder; },
      async maybeSingle() {
        if (updateBody) {
          assert.ok(scoped, "strict writes must retain the null-owner filter");
          writes.push(slug); rows.set(slug, updateBody.blocks);
          return { data: { id: slug }, error: null };
        }
        if (!scoped) assert.ok(reads.includes(slug), "unscoped existence probe must follow a scoped read");
        reads.push(scoped ? slug : `existence:${slug}`);
        if (duplicateRows.has(slug) && limit > 1) return { data: null, error: { message: "JSON object requested, multiple rows returned" } };
        if (slug === failureSlug) {
          if (failure === "throw") throw new Error("PRIVATE-CONNECTION-DETAIL");
          if (failure === "undefined-data") return { error: null };
          if (failure === "malformed-row") return { data: { blocks: "not-an-array" }, error: null };
          return { data: null, error: { message: failure === "missing-column" ? "column pages.merchant_id does not exist" : "PRIVATE-DB-DETAIL" } };
        }
        return { data: rows.has(slug) && !(scoped && legacyOnly.has(slug)) ? { id: slug, blocks: rows.get(slug) } : null, error: null };
      },
      update(body: Record<string, unknown>) { updateBody = body; return builder; },
      async insert(body: Record<string, unknown>) { writes.push(String(body.slug)); rows.set(String(body.slug), body.blocks); return { error: null }; },
      then(resolve: (result: { error: null }) => unknown) {
        assert.ok(updateBody, "only updates should await the builder itself");
        writes.push(slug); rows.set(slug, updateBody.blocks); return Promise.resolve(resolve({ error: null }));
      },
    };
    return builder;
  } } as unknown as Client;
  return { entry, client, rows, reads, writes, legacyOnly, duplicateRows,
    fail(slug: string, mode: Failure = "error") { failureSlug = slug; failure = mode; } };
}

const readers = [
  { name: "backup set", slugs: BACKUP_SLUGS, read: (client: Client, strict: boolean) => loadStoredPlatformAdminDataBackups(client, { strict }) },
  { name: "merchant snapshot and history", slugs: SNAPSHOT_SLUGS, read: (client: Client, strict: boolean) => loadStoredPlatformMerchantSnapshot(client, { strict, bypassCache: true }) },
  { name: "config archive", slugs: ARCHIVE_SLUGS, read: (client: Client, strict: boolean) => loadStoredPlatformMerchantConfigArchive(client, { strict }) },
  { name: "platform support inbox", slugs: [PLATFORM_SUPPORT_INBOX_SLUG], read: (client: Client, strict: boolean) => loadStoredPlatformSupportInbox(client, { strict, bypassCache: true }) },
];

for (const reader of readers) {
  for (const slug of reader.slugs) {
    test(`strict ${reader.name} rejects duplicate null-owner rows for ${slug}`, async () => {
      const f = fixture(); f.duplicateRows.add(slug);
      await assert.rejects(reader.read(f.client, true), { message: PLATFORM_ADMIN_BACKUP_READ_UNAVAILABLE });
      assert.deepEqual(f.writes, []);
    });
    for (const mode of ["error", "missing-column", "throw"] as const) {
      test(`strict ${reader.name} rejects ${mode} on ${slug}, even with a healthy other copy`, async () => {
        const f = fixture(); f.fail(slug, mode);
        await assert.rejects(reader.read(f.client, true), { message: PLATFORM_ADMIN_BACKUP_READ_UNAVAILABLE });
        assert.deepEqual(f.writes, []);
      });
    }
  }
  test(`strict ${reader.name} bypasses a warmed ordinary-read cache`, async () => {
    const f = fixture(); await reader.read(f.client, false);
    f.fail(reader.slugs[0]);
    await assert.rejects(reader.read(f.client, true), { message: PLATFORM_ADMIN_BACKUP_READ_UNAVAILABLE });
  });
}

test("confirmed absent rows are empty, not a failed read", async () => {
  const f = fixture(); f.rows.clear();
  assert.deepEqual(await loadStoredPlatformAdminDataBackups(f.client, { strict: true }), { backups: [] });
  assert.equal(await loadStoredPlatformMerchantSnapshot(f.client, { strict: true }), null);
  assert.deepEqual(await loadStoredPlatformMerchantConfigArchive(f.client, { strict: true }), { audits: [], backups: [] });
  assert.deepEqual(await loadStoredPlatformSupportInbox(f.client, { strict: true }), { threads: [] });
  assert.deepEqual(new Set(f.reads.filter((slug) => !slug.startsWith("existence:"))), new Set(ALL_SLUGS));
});

test("missing one backup row preserves the successfully read other copy", async () => {
  const f = fixture(); f.rows.delete(BACKUP_SLUGS[0]);
  const value = await loadStoredPlatformAdminDataBackups(f.client, { strict: true });
  assert.equal(value.backups[0]?.id, f.entry.id);
});

for (const reader of readers) {
  test(`strict ${reader.name} rejects an existing legacy or foreign-owner internal row rather than calling it absent`, async () => {
    const f = fixture(); f.legacyOnly.add(reader.slugs[0]);
    await assert.rejects(reader.read(f.client, true), { message: PLATFORM_ADMIN_BACKUP_READ_UNAVAILABLE });
    assert.deepEqual(f.writes, []);
  });
}

for (const mode of ["undefined-data", "malformed-row"] as const) {
  test(`strict helper does not mistake ${mode} for absence`, async () => {
    const f = fixture(); f.fail(BACKUP_SLUGS[0], mode);
    await assert.rejects(readPlatformAdminBackupBlocksStrict(f.client, BACKUP_SLUGS[0]), { message: PLATFORM_ADMIN_BACKUP_READ_UNAVAILABLE });
  });
}

function request(method: "POST" | "PATCH", body: Record<string, unknown>, origin = "https://launch.faolla.com") {
  return new Request("https://launch.faolla.com/api/super-admin/data-backups", {
    method, headers: { "content-type": "application/json", origin }, body: JSON.stringify(body),
  });
}

test("strict POST validates the ninth entry before retaining the latest eight snapshots", async () => {
  const f = fixture();
  const backups = Array.from({ length: 8 }, (_, index) => ({ ...structuredClone(f.entry),
    id: `older-${index}`, at: `2026-01-${String(index + 1).padStart(2, "0")}T00:00:00.000Z` }));
  for (const slug of BACKUP_SLUGS) f.rows.set(slug, buildPlatformAdminDataBackupBlocks({ backups }));
  const handlers = createPlatformAdminDataBackupHandlers({ authorize: async () => true, createClient: () => f.client });
  const response = await handlers.POST(request("POST", { source: "manual", platformState: f.entry.snapshot.platformState, merchantAccounts: [] }));
  assert.equal(response.status, 200, await response.clone().text());
  const result = await response.json(); assert.equal(result.backups.length, 8);
  assert.ok(!result.backups.some((entry: { id: string }) => entry.id === "older-0"));
  assert.deepEqual(f.rows.get(BACKUP_SLUGS[0]), f.rows.get(BACKUP_SLUGS[1]));
});

for (const slug of BACKUP_SLUGS) {
  test(`GET list and detail return 503, not an empty list or 404, if ${slug} cannot be read`, async () => {
    const f = fixture(); f.fail(slug);
    const handlers = createPlatformAdminDataBackupHandlers({ authorize: async () => true, createClient: () => f.client });
    for (const suffix of ["", `?backupId=${f.entry.id}`]) {
      const response = await handlers.GET(new Request(`https://launch.faolla.com/api/super-admin/data-backups${suffix}`));
      assert.equal(response.status, 503); assert.equal(response.headers.get("cache-control"), "no-store");
      assert.deepEqual(await response.json(), { error: PLATFORM_ADMIN_BACKUP_READ_UNAVAILABLE });
    }
    assert.deepEqual(f.writes, []);
  });
}

test("GET returns an empty list only after both copies were successfully confirmed absent", async () => {
  const f = fixture(); f.rows.clear();
  const handlers = createPlatformAdminDataBackupHandlers({ authorize: async () => true, createClient: () => f.client });
  const response = await handlers.GET(new Request("https://launch.faolla.com/api/super-admin/data-backups"));
  assert.equal(response.status, 200);
  const body = await response.json(); assert.deepEqual(body.backups, []); assert.equal(body.backupScope.fullDatabaseBackup, false);
  assert.deepEqual(f.writes, []);
});

for (const slug of ALL_SLUGS) {
  test(`POST returns sanitized 503 and performs no write if ${slug} fails`, async () => {
    const f = fixture(); f.fail(slug);
    const original = JSON.stringify([...f.rows]);
    const handlers = createPlatformAdminDataBackupHandlers({ authorize: async () => true, createClient: () => f.client });
    const response = await handlers.POST(request("POST", { source: "manual", platformState: normalizePlatformState({}), merchantAccounts: [] }));
    assert.equal(response.status, 503); assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), { error: PLATFORM_ADMIN_BACKUP_READ_UNAVAILABLE });
    assert.deepEqual(f.writes, []); assert.equal(JSON.stringify([...f.rows]), original);
  });
}

for (const [scope, slugs] of [
  ["user_manage", [...BACKUP_SLUGS, ...SNAPSHOT_SLUGS, ...ARCHIVE_SLUGS]],
  ["support_messages", [...BACKUP_SLUGS, PLATFORM_SUPPORT_INBOX_SLUG]],
] as const) {
  for (const slug of slugs) {
    test(`PATCH ${scope} reads ${slug} before any restore write and rejects its failure`, async () => {
      const f = fixture(); f.fail(slug);
      const original = JSON.stringify([...f.rows]);
      const handlers = createPlatformAdminDataBackupHandlers({ authorize: async () => true, createClient: () => f.client });
      const response = await handlers.PATCH(request("PATCH", { backupId: f.entry.id, scope, action: "preview" }));
      assert.equal(response.status, 503); assert.equal(response.headers.get("cache-control"), "no-store");
      assert.deepEqual(await response.json(), { error: PLATFORM_ADMIN_BACKUP_READ_UNAVAILABLE });
      assert.deepEqual(f.writes, []); assert.equal(JSON.stringify([...f.rows]), original);
    });
  }
}

test("POST may create a genuine first snapshot after all rows were confirmed absent", async () => {
  const f = fixture(); f.rows.clear();
  const handlers = createPlatformAdminDataBackupHandlers({ authorize: async () => true, createClient: () => f.client });
  const response = await handlers.POST(request("POST", { source: "manual", platformState: normalizePlatformState({}), merchantAccounts: [] }));
  assert.equal(response.status, 200);
  const body = await response.json(); assert.equal(body.created, true);
  assert.equal(body.backupScope.fullDatabaseBackup, false);
  assert.deepEqual(f.writes, BACKUP_SLUGS);
});

test("PATCH distinguishes a successfully read missing backup from read failure", async () => {
  const f = fixture(); f.rows.clear();
  const handlers = createPlatformAdminDataBackupHandlers({ authorize: async () => true, createClient: () => f.client });
  const response = await handlers.PATCH(request("PATCH", { backupId: "absent", scope: "user_manage", action: "preview" }));
  assert.equal(response.status, 404); assert.deepEqual(f.writes, []);
});

test("super-admin authorization and same-origin mutation guards remain in front of all reads", async () => {
  const f = fixture();
  const handlers = createPlatformAdminDataBackupHandlers({ authorize: async () => false, createClient: () => { throw new Error("must not create client"); } });
  for (const method of ["POST", "PATCH"] as const) {
    assert.equal((await handlers[method](request(method, {}))).status, 401);
    assert.equal((await handlers[method](request(method, {}, "https://attacker.invalid"))).status, 403);
  }
  assert.deepEqual(f.reads, []);
});

test("legacy single-step PATCH cannot write without the explicit preview protocol", async () => {
  const f = fixture();
  const handlers = createPlatformAdminDataBackupHandlers({ authorize: async () => true, createClient: () => f.client });
  const response = await handlers.PATCH(request("PATCH", { backupId: f.entry.id, scope: "user_manage" }));
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "super_admin_backup_restore_preview_required" });
  assert.deepEqual(f.reads, []); assert.deepEqual(f.writes, []);
});

for (const scope of ["user_manage", "support_messages"] as const) {
  test(`PATCH ${scope} preview is read-only and execution requires its unchanged content token`, async () => {
    const f = fixture();
    const handlers = createPlatformAdminDataBackupHandlers({ authorize: async () => true, createClient: () => f.client });
    const result = await handlers.PATCH(request("PATCH", { backupId: f.entry.id, scope, action: "preview" }));
    assert.equal(result.status, 200); assert.equal(result.headers.get("cache-control"), "no-store");
    const { preview } = await result.json();
    assert.equal(preview.backupId, f.entry.id); assert.equal(preview.scope, scope);
    assert.match(preview.confirmationToken, /^v1\.[a-f0-9]{64}$/);
    assert.equal(preview.requiresEmptyConfirmation, true);
    assert.deepEqual(f.writes, []);
    for (const confirmationToken of [undefined, "", "v1." + "0".repeat(64)]) {
      const response = await handlers.PATCH(request("PATCH", { backupId: f.entry.id, scope, action: "restore", confirmationToken, confirmEmpty: true }));
      assert.equal(response.status, 409); assert.deepEqual(f.writes, []);
    }
    const unconfirmed = await handlers.PATCH(request("PATCH", {
      backupId: f.entry.id, scope, action: "restore", confirmationToken: preview.confirmationToken, confirmEmpty: "true",
    }));
    assert.equal(unconfirmed.status, 400);
    assert.deepEqual(await unconfirmed.json(), { error: "super_admin_backup_restore_empty_confirmation_required" });
    assert.deepEqual(f.writes, []);
    // Change only content, retaining the same backup ID and counts.
    f.entry.snapshot.platformState.homeLayout.heroTitle = "Changed since preview";
    for (const slug of BACKUP_SLUGS) f.rows.set(slug, buildPlatformAdminDataBackupBlocks({ backups: [f.entry] }));
    const stale = await handlers.PATCH(request("PATCH", {
      backupId: f.entry.id, scope, action: "restore", confirmationToken: preview.confirmationToken, confirmEmpty: true,
    }));
    assert.equal(stale.status, 409); assert.deepEqual(f.writes, []);
  });
}

test("POST cannot normalize invalid client input into an apparently empty snapshot", async () => {
  const f = fixture();
  const handlers = createPlatformAdminDataBackupHandlers({ authorize: async () => true, createClient: () => f.client });
  for (const input of [{}, { source: "manual" },
    { source: "manual", platformState: [], merchantAccounts: [] },
    { source: "manual", platformState: normalizePlatformState({}), merchantAccounts: "bad" },
    { source: "manual", platformState: { ...normalizePlatformState({}), sites: "bad" }, merchantAccounts: [] },
  ]) {
    const response = await handlers.POST(request("POST", input));
    assert.equal(response.status, 400); assert.deepEqual(await response.json(), { error: "super_admin_backup_invalid_payload" });
  }
  assert.deepEqual(f.reads, []); assert.deepEqual(f.writes, []);
});

test("POST stores only documented account summaries without truncating legitimate size and visits", async () => {
  const f = fixture(); f.rows.clear();
  const handlers = createPlatformAdminDataBackupHandlers({ authorize: async () => true, createClient: () => f.client });
  const response = await handlers.POST(request("POST", { source: "manual", platformState: normalizePlatformState({}),
    merchantAccounts: [{ merchantId: "10000000", email: "synthetic@example.invalid", publishedBytes: 12_000_001,
      visits: { today: 1, day7: 2, day30: 3, total: 3_000_005 },
      accountType: "merchant", accountId: "synthetic", profileSnapshot: { neverBackedUp: "PRIVATE-EXCLUDED" },
      profileConfigHistory: [], personalServiceConfig: null, personalServicePaused: false }],
  }));
  assert.equal(response.status, 200);
  const stored = await loadStoredPlatformAdminDataBackups(f.client, { strict: true });
  assert.equal(stored.backups[0].snapshot.merchantAccounts[0].publishedBytes, 12_000_001);
  assert.equal(stored.backups[0].snapshot.merchantAccounts[0].visits.total, 3_000_005);
  assert.doesNotMatch(JSON.stringify([...f.rows]), /PRIVATE-EXCLUDED|profileSnapshot|personalServiceConfig/);
});

test("POST rejects unrecognized account fields instead of silently stripping future snapshot content", async () => {
  const f = fixture();
  const handlers = createPlatformAdminDataBackupHandlers({ authorize: async () => true, createClient: () => f.client });
  const response = await handlers.POST(request("POST", { source: "manual", platformState: normalizePlatformState({}),
    merchantAccounts: [{ merchantId: "10000000", unrecognizedData: { detail: "not in scope" } }],
  }));
  assert.equal(response.status, 400); assert.deepEqual(f.reads, []); assert.deepEqual(f.writes, []);
});
