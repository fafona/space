import assert from "node:assert/strict";
import test from "node:test";
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

function createMockSnapshotStore(initialRows: PageRow[]) {
  let rows = initialRows.map((row) => ({ ...row }));
  let nextId = rows.reduce((max, row) => Math.max(max, row.id), 0) + 1;

  class QueryBuilder {
    private readonly filters: Array<(row: PageRow) => boolean> = [];
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
      return this;
    }

    eq(column: string, value: unknown) {
      this.filters.push((row) => (row as Record<string, unknown>)[column] === value);
      return this;
    }

    limit() {
      return this;
    }

    maybeSingle() {
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
      rows = rows.map((row) =>
        this.filters.every((filter) => filter(row))
          ? {
              ...row,
              ...this.payload,
            }
          : row,
      );
      return Promise.resolve({ data: null, error: null }).then(onfulfilled, onrejected);
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
  assert.equal(client.read(PLATFORM_MERCHANT_SNAPSHOT_SLUG)?.merchantConfigHistoryBySiteId["10000000"]?.length, 1);
  assert.equal(client.read(PLATFORM_MERCHANT_SNAPSHOT_HISTORY_SLUG)?.merchantConfigHistoryBySiteId["10000000"]?.length, 1);
  assert.equal(
    client.read(PLATFORM_MERCHANT_SNAPSHOT_HISTORY_BACKUP_SLUG)?.merchantConfigHistoryBySiteId["10000000"]?.length,
    1,
  );
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
  const saved = client.read(PLATFORM_MERCHANT_SNAPSHOT_SLUG);
  assert.ok(saved);
  assert.notEqual(saved.revision, "revision-main");
  assert.equal(saved.merchantConfigHistoryBySiteId["10000000"]?.length, 1);
});
