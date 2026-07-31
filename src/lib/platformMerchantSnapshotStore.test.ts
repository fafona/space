import assert from "node:assert/strict";
import test from "node:test";
import {
  createDefaultMerchantPermissionConfig,
  createDefaultMerchantSortConfig,
} from "@/data/platformControlStore";
import {
  PLATFORM_MERCHANT_SNAPSHOT_BACKUP_SLUG,
  PLATFORM_MERCHANT_SNAPSHOT_HISTORY_BACKUP_SLUG,
  PLATFORM_MERCHANT_SNAPSHOT_HISTORY_SLUG,
  PLATFORM_MERCHANT_SNAPSHOT_SLUG,
  buildPlatformMerchantSnapshotBlocks,
  readPlatformMerchantSnapshotFromBlocks,
  type PlatformMerchantSnapshotPayload,
} from "./platformMerchantSnapshot";
import {
  loadAuthoritativeStoredPlatformMerchantSnapshot,
  loadStoredPlatformMerchantSnapshot,
  savePlatformMerchantSnapshot,
  type PlatformMerchantSnapshotStoreClient,
} from "./platformMerchantSnapshotStore";

type PageRow = {
  id: number;
  slug: string;
  merchant_id: string | null;
  updated_at?: string;
  blocks?: unknown;
};

function createPayload(
  revision: string,
  historyCount = 0,
): PlatformMerchantSnapshotPayload {
  return {
    revision,
    snapshot: [
      {
        id: "10000000",
        merchantName: "fafona",
        domainPrefix: "fafona",
        domainSuffix: "fafona",
        name: "fafona",
        domain: "fafona",
        category: "娱乐",
        industry: "娱乐",
        location: {
          countryCode: "ES",
          country: "Spain",
          provinceCode: "AN",
          province: "Sevilla",
          city: "Sevilla",
        },
        sortConfig: createDefaultMerchantSortConfig(),
        createdAt: "2026-04-01T00:00:00.000Z",
      },
    ],
    defaultSortRule: "created_desc",
    merchantConfigHistoryBySiteId:
      historyCount > 0
        ? {
            "10000000": Array.from({ length: historyCount }, (_, index) => ({
              id: `cfg-${index + 1}`,
              at: `2026-04-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
              operator: "super-admin",
              summary: `配置更新 ${index + 1}`,
              changes: [`变更 ${index + 1}`],
              before: {
                serviceExpiresAt: null,
                permissionConfig: {
                  ...createDefaultMerchantPermissionConfig(),
                  planLimit: 1,
                  pageLimit: 10,
                  businessCardLimit: 1,
                  allowBusinessCardLinkMode: false,
                  allowBookingEmailPrefill: false,
                  allowBookingAutoEmail: false,
                  businessCardBackgroundImageLimitKb: 200,
                  businessCardContactImageLimitKb: 200,
                  businessCardExportImageLimitKb: 400,
                  commonBlockImageLimitKb: 300,
                  galleryBlockImageLimitKb: 300,
                  allowInsertBackground: false,
                  allowThemeEffects: false,
                  allowButtonBlock: false,
                  allowGalleryBlock: false,
                  allowMusicBlock: false,
                  allowProductBlock: false,
                  allowBookingBlock: false,
                  publishSizeLimitMb: 1,
                },
                merchantCardImageUrl: "",
                merchantCardImageOpacity: 1,
                chatAvatarImageUrl: "",
                contactVisibility: {
                  phoneHidden: false,
                  emailHidden: false,
                  businessCardHidden: false,
                },
                sortConfig: {
                  recommendedCountryRank: null,
                  recommendedProvinceRank: null,
                  recommendedCityRank: null,
                  industryCountryRank: null,
                  industryProvinceRank: null,
                  industryCityRank: null,
                },
              },
              after: {
                serviceExpiresAt: "2027-07-07T00:00:00.000Z",
                permissionConfig: {
                  ...createDefaultMerchantPermissionConfig(),
                  planLimit: 1,
                  pageLimit: 10,
                  businessCardLimit: 1,
                  allowBusinessCardLinkMode: false,
                  allowBookingEmailPrefill: false,
                  allowBookingAutoEmail: false,
                  businessCardBackgroundImageLimitKb: 200,
                  businessCardContactImageLimitKb: 200,
                  businessCardExportImageLimitKb: 400,
                  commonBlockImageLimitKb: 300,
                  galleryBlockImageLimitKb: 300,
                  allowInsertBackground: false,
                  allowThemeEffects: false,
                  allowButtonBlock: false,
                  allowGalleryBlock: false,
                  allowMusicBlock: false,
                  allowProductBlock: false,
                  allowBookingBlock: false,
                  publishSizeLimitMb: 1,
                },
                merchantCardImageUrl: "",
                merchantCardImageOpacity: 1,
                chatAvatarImageUrl: "",
                contactVisibility: {
                  phoneHidden: false,
                  emailHidden: false,
                  businessCardHidden: false,
                },
                sortConfig: {
                  recommendedCountryRank: null,
                  recommendedProvinceRank: null,
                  recommendedCityRank: null,
                  industryCountryRank: null,
                  industryProvinceRank: null,
                  industryCityRank: null,
                },
              },
            })),
          }
        : {},
  };
}

function createStoredRow(id: number, slug: string, payload: PlatformMerchantSnapshotPayload): PageRow {
  return {
    id,
    slug,
    merchant_id: null,
    updated_at: "2026-04-15T00:00:00.000Z",
    blocks: buildPlatformMerchantSnapshotBlocks(payload),
  };
}

function createLegacyInternalStoredRow(
  id: number,
  slug: string,
  payload: PlatformMerchantSnapshotPayload,
): PageRow {
  return {
    ...createStoredRow(id, slug, payload),
    merchant_id: "legacy-internal-owner",
  };
}

function createPayloadWithSite(revision: string, siteId: string, merchantName: string): PlatformMerchantSnapshotPayload {
  const base = createPayload(revision, 0);
  const site = base.snapshot[0];
  assert.ok(site);
  return {
    ...base,
    snapshot: [
      {
        ...site,
        id: siteId,
        merchantName,
        name: merchantName,
        domainPrefix: merchantName.toLowerCase(),
        domainSuffix: merchantName.toLowerCase(),
        domain: merchantName.toLowerCase(),
      },
    ],
    merchantConfigHistoryBySiteId: {},
  };
}

function createMockSnapshotStore(
  initialRows: PageRow[],
  options: {
    beforeUpdate?: (row: PageRow | null) => void | Promise<void>;
    onUpdate?: (row: PageRow | null) => void;
    selectErrorBySlug?: Record<string, string>;
  } = {},
) {
  let rows = initialRows.map((row) => ({ ...row }));
  let nextId = rows.reduce((max, row) => Math.max(max, row.id), 0) + 1;

  class QueryBuilder {
    private readonly filters: Array<(row: PageRow) => boolean> = [];
    private readonly filterValues = new Map<string, unknown>();
    private action: "select" | "update" | null = null;
    private payload: Record<string, unknown> | null = null;

    select() {
      this.action = "select";
      return this;
    }

    update(payload: Record<string, unknown>) {
      this.action = "update";
      this.payload = payload;
      return this;
    }

    insert(payload: Record<string, unknown>) {
      if (rows.some((row) => row.slug === String(payload.slug ?? ""))) {
        return Promise.resolve({
          data: null,
          error: {
            message: 'duplicate key value violates unique constraint "pages_merchant_slug_unique_idx"',
          },
        });
      }
      rows.push({
        id: nextId,
        slug: String(payload.slug ?? ""),
        merchant_id: (typeof payload.merchant_id === "string" ? payload.merchant_id : null),
        updated_at: typeof payload.updated_at === "string" ? payload.updated_at : undefined,
        blocks: payload.blocks,
      });
      nextId += 1;
      return Promise.resolve({ data: null, error: null });
    }

    is(column: string, value: unknown) {
      this.filters.push((row) => (row as Record<string, unknown>)[column] === value);
      this.filterValues.set(column, value);
      return this;
    }

    eq(column: string, value: unknown) {
      this.filters.push((row) => (row as Record<string, unknown>)[column] === value);
      this.filterValues.set(column, value);
      return this;
    }

    limit() {
      return this;
    }

    maybeSingle() {
      const slug = String(this.filterValues.get("slug") ?? "");
      const selectError = options.selectErrorBySlug?.[slug];
      if (selectError) {
        return Promise.resolve({
          data: null,
          error: { message: selectError },
        });
      }
      const matched = rows.find((row) => this.filters.every((filter) => filter(row))) ?? null;
      return Promise.resolve({ data: matched, error: null });
    }

    then<TResult1 = { data?: unknown; error: null }, TResult2 = never>(
      onfulfilled?: ((value: { data?: unknown; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ) {
      if (this.action !== "update" || !this.payload) {
        return Promise.resolve({ data: null, error: null }).then(onfulfilled, onrejected);
      }
      const matchedRow = rows.find((row) => this.filters.every((filter) => filter(row))) ?? null;
      options.onUpdate?.(matchedRow);
      return Promise.resolve(options.beforeUpdate?.(matchedRow))
        .then(() => {
          rows = rows.map((row) =>
            this.filters.every((filter) => filter(row))
              ? {
                  ...row,
                  ...this.payload,
                }
              : row,
          );
          return { data: null, error: null } as const;
        })
        .then(onfulfilled, onrejected);
    }
  }

  const client: PlatformMerchantSnapshotStoreClient & { read: (slug: string) => PlatformMerchantSnapshotPayload | null } = {
    from: () => new QueryBuilder() as never,
    read: (slug: string) => {
      const row = rows.find((item) => item.slug === slug) ?? null;
      return row ? readPlatformMerchantSnapshotFromBlocks(row.blocks) : null;
    },
  };

  return client;
}

test("loadStoredPlatformMerchantSnapshot merges history from dedicated history snapshot rows", async () => {
  const client = createMockSnapshotStore([
    createStoredRow(1, PLATFORM_MERCHANT_SNAPSHOT_SLUG, createPayload("revision-main", 0)),
    createStoredRow(2, PLATFORM_MERCHANT_SNAPSHOT_HISTORY_SLUG, createPayload("revision-history", 2)),
  ]);

  const payload = await loadStoredPlatformMerchantSnapshot(client);

  assert.ok(payload);
  assert.equal(payload?.revision, "revision-main");
  assert.equal(payload?.merchantConfigHistoryBySiteId["10000000"]?.length, 2);
});

test("savePlatformMerchantSnapshot preserves existing history when incoming payload history is empty", async () => {
  const client = createMockSnapshotStore([
    createStoredRow(1, PLATFORM_MERCHANT_SNAPSHOT_SLUG, createPayload("revision-main", 0)),
    createStoredRow(2, PLATFORM_MERCHANT_SNAPSHOT_BACKUP_SLUG, createPayload("revision-backup", 0)),
    createStoredRow(3, PLATFORM_MERCHANT_SNAPSHOT_HISTORY_SLUG, createPayload("revision-history", 1)),
    createStoredRow(4, PLATFORM_MERCHANT_SNAPSHOT_HISTORY_BACKUP_SLUG, createPayload("revision-history-backup", 1)),
  ]);

  const result = await savePlatformMerchantSnapshot(client, createPayload("revision-main", 0), {
    expectedRevision: "revision-main",
  });

  assert.equal(result.error, null);
  assert.equal(client.read(PLATFORM_MERCHANT_SNAPSHOT_SLUG)?.merchantConfigHistoryBySiteId["10000000"]?.length ?? 0, 0);
  assert.equal(client.read(PLATFORM_MERCHANT_SNAPSHOT_HISTORY_SLUG)?.merchantConfigHistoryBySiteId["10000000"]?.length, 1);
  assert.equal(
    client.read(PLATFORM_MERCHANT_SNAPSHOT_HISTORY_BACKUP_SLUG)?.merchantConfigHistoryBySiteId["10000000"]?.length,
    1,
  );
  const merged = await loadStoredPlatformMerchantSnapshot(client, { bypassCache: true });
  assert.equal(merged?.merchantConfigHistoryBySiteId["10000000"]?.length, 1);
});

test("savePlatformMerchantSnapshot starts primary and history writes in parallel", async () => {
  let releasePrimary: (() => void) | undefined;
  let releaseHistory: (() => void) | undefined;
  const primaryReleased = new Promise<void>((resolve) => {
    releasePrimary = resolve;
  });
  const historyReleased = new Promise<void>((resolve) => {
    releaseHistory = resolve;
  });
  let markBothStarted: (() => void) | undefined;
  const bothStarted = new Promise<void>((resolve) => {
    markBothStarted = resolve;
  });
  const startedIds = new Set<number>();
  const client = createMockSnapshotStore(
    [
      createStoredRow(1, PLATFORM_MERCHANT_SNAPSHOT_SLUG, createPayload("revision-main", 0)),
      createStoredRow(2, PLATFORM_MERCHANT_SNAPSHOT_HISTORY_SLUG, createPayload("revision-history", 0)),
    ],
    {
      beforeUpdate: (row) => {
        if (row?.id !== 1 && row?.id !== 2) return;
        startedIds.add(row.id);
        if (startedIds.size === 2) {
          markBothStarted?.();
        }
        return row.id === 1 ? primaryReleased : historyReleased;
      },
    },
  );

  const savePromise = savePlatformMerchantSnapshot(client, createPayload("revision-main", 0), {
    expectedRevision: "revision-main",
  });
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      bothStarted,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("main snapshot writes did not start in parallel")), 500);
      }),
    ]);
    assert.deepEqual([...startedIds].sort(), [1, 2]);
  } finally {
    if (timeout) clearTimeout(timeout);
    releasePrimary?.();
    releaseHistory?.();
  }

  const result = await savePromise;
  assert.equal(result.error, null);
});

test("savePlatformMerchantSnapshot never writes when a required snapshot read fails", async () => {
  let updateCalls = 0;
  const client = createMockSnapshotStore(
    [
      createStoredRow(1, PLATFORM_MERCHANT_SNAPSHOT_SLUG, createPayload("revision-main", 0)),
      createStoredRow(2, PLATFORM_MERCHANT_SNAPSHOT_HISTORY_SLUG, createPayload("revision-history", 1)),
    ],
    {
      selectErrorBySlug: {
        [PLATFORM_MERCHANT_SNAPSHOT_SLUG]: "TypeError: fetch failed",
      },
      onUpdate: () => {
        updateCalls += 1;
      },
    },
  );

  const result = await savePlatformMerchantSnapshot(client, createPayload("revision-main", 1), {
    expectedRevision: "revision-main",
  });

  assert.equal(
    result.error,
    "platform_merchant_snapshot_primary_load_failed:TypeError: fetch failed",
  );
  assert.equal(updateCalls, 0);
  assert.equal(client.read(PLATFORM_MERCHANT_SNAPSHOT_SLUG)?.revision, "revision-main");
  assert.equal(client.read(PLATFORM_MERCHANT_SNAPSHOT_HISTORY_SLUG)?.revision, "revision-history");
});

test("savePlatformMerchantSnapshot rejects stale revisions without writing", async () => {
  const client = createMockSnapshotStore([
    createStoredRow(1, PLATFORM_MERCHANT_SNAPSHOT_SLUG, createPayload("revision-current", 0)),
  ]);

  const result = await savePlatformMerchantSnapshot(client, createPayload("revision-stale", 0), {
    expectedRevision: "revision-stale",
  });

  assert.equal(result.code, "conflict");
  assert.equal(result.error, "platform_merchant_snapshot_conflict");
  assert.equal(client.read(PLATFORM_MERCHANT_SNAPSHOT_SLUG)?.revision, "revision-current");
});

test("savePlatformMerchantSnapshot keeps existing merchants missing from incoming payload", async () => {
  const client = createMockSnapshotStore([
    createStoredRow(1, PLATFORM_MERCHANT_SNAPSHOT_SLUG, createPayloadWithSite("revision-main", "10000000", "Alpha")),
  ]);

  const result = await savePlatformMerchantSnapshot(
    client,
    createPayloadWithSite("revision-main", "20000000", "Beta"),
    { expectedRevision: "revision-main" },
  );

  assert.equal(result.error, null);
  const saved = client.read(PLATFORM_MERCHANT_SNAPSHOT_SLUG);
  assert.ok(saved);
  assert.deepEqual(
    saved.snapshot.map((site) => site.id).sort(),
    ["10000000", "20000000"],
  );
});

test("savePlatformMerchantSnapshot updates legacy internal rows whose merchant id is not null", async () => {
  const client = createMockSnapshotStore([
    createLegacyInternalStoredRow(1, PLATFORM_MERCHANT_SNAPSHOT_SLUG, createPayload("revision-main", 0)),
  ]);

  const result = await savePlatformMerchantSnapshot(client, createPayload("revision-main", 1), {
    expectedRevision: "revision-main",
  });

  assert.equal(result.error, null);
  const saved = await loadStoredPlatformMerchantSnapshot(client, { bypassCache: true });
  assert.ok(saved);
  assert.notEqual(saved.revision, "revision-main");
  assert.equal(saved.merchantConfigHistoryBySiteId["10000000"]?.length, 1);
});

test("loadStoredPlatformMerchantSnapshot can return lightweight current snapshot without history", async () => {
  const client = createMockSnapshotStore([
    createStoredRow(1, PLATFORM_MERCHANT_SNAPSHOT_SLUG, createPayload("revision-main", 3)),
    createStoredRow(2, PLATFORM_MERCHANT_SNAPSHOT_HISTORY_SLUG, createPayload("revision-history", 5)),
  ]);

  const lightweight = await loadStoredPlatformMerchantSnapshot(client, {
    bypassCache: true,
    includeHistory: false,
  });
  const full = await loadStoredPlatformMerchantSnapshot(client, { bypassCache: true });

  assert.ok(lightweight);
  assert.equal(lightweight.revision, "revision-main");
  assert.equal(lightweight.merchantConfigHistoryBySiteId["10000000"]?.length ?? 0, 0);
  assert.equal(full?.merchantConfigHistoryBySiteId["10000000"]?.length, 5);
});

test("authoritative snapshot loading never falls back to a stale backup", async () => {
  const missingPrimaryClient = createMockSnapshotStore([
    createStoredRow(
      2,
      PLATFORM_MERCHANT_SNAPSHOT_BACKUP_SLUG,
      createPayload("revision-backup", 0),
    ),
  ]);
  const missingPrimary = await loadAuthoritativeStoredPlatformMerchantSnapshot(
    missingPrimaryClient,
  );
  assert.equal(missingPrimary.payload, null);
  assert.equal(missingPrimary.error, "platform_merchant_snapshot_missing");

  const primaryClient = createMockSnapshotStore([
    createStoredRow(
      1,
      PLATFORM_MERCHANT_SNAPSHOT_SLUG,
      createPayload("revision-primary", 0),
    ),
  ]);
  const primary = await loadAuthoritativeStoredPlatformMerchantSnapshot(
    primaryClient,
  );
  assert.equal(primary.error, null);
  assert.equal(primary.payload?.revision, "revision-primary");
});
