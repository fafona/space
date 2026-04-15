import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultMerchantContactVisibility, createDefaultMerchantPermissionConfig, createDefaultMerchantSortConfig } from "@/data/platformControlStore";
import {
  PLATFORM_MERCHANT_CONFIG_ARCHIVE_BACKUP_SLUG,
  PLATFORM_MERCHANT_CONFIG_ARCHIVE_SLUG,
  buildPlatformMerchantConfigArchiveBlocks,
  readPlatformMerchantConfigArchiveFromBlocks,
  type PlatformMerchantConfigArchivePayload,
} from "./platformMerchantConfigArchive";
import {
  loadStoredPlatformMerchantConfigArchive,
  savePlatformMerchantConfigArchive,
  type PlatformMerchantConfigArchiveStoreClient,
} from "./platformMerchantConfigArchiveStore";

type PageRow = {
  id: number;
  slug: string;
  merchant_id: null;
  updated_at?: string;
  blocks?: unknown;
};

function createArchivePayload(idSuffix: string): PlatformMerchantConfigArchivePayload {
  return {
    audits: [
      {
        id: `audit-${idSuffix}`,
        siteId: "10000000",
        merchantName: "fafona",
        at: "2026-04-15T12:00:00.000Z",
        operator: "super-admin",
        source: "update",
        summary: `配置更新 ${idSuffix}`,
        changes: ["方案数量上限：1 -> 2"],
        before: {
          serviceExpiresAt: null,
          permissionConfig: createDefaultMerchantPermissionConfig(),
          merchantCardImageUrl: "",
          merchantCardImageOpacity: 1,
          chatAvatarImageUrl: "",
          contactVisibility: createDefaultMerchantContactVisibility(),
          sortConfig: createDefaultMerchantSortConfig(),
        },
        after: {
          serviceExpiresAt: "2027-07-07T00:00:00.000Z",
          permissionConfig: {
            ...createDefaultMerchantPermissionConfig(),
            planLimit: 2,
          },
          merchantCardImageUrl: "",
          merchantCardImageOpacity: 1,
          chatAvatarImageUrl: "",
          contactVisibility: createDefaultMerchantContactVisibility(),
          sortConfig: createDefaultMerchantSortConfig(),
        },
      },
    ],
    backups: [
      {
        id: `backup-${idSuffix}`,
        siteId: "10000000",
        merchantName: "fafona",
        at: "2026-04-15T12:00:00.000Z",
        operator: "super-admin",
        source: "update",
        summary: `配置备份 ${idSuffix}`,
        changes: ["方案数量上限：1 -> 2"],
        snapshot: {
          serviceExpiresAt: "2027-07-07T00:00:00.000Z",
          permissionConfig: {
            ...createDefaultMerchantPermissionConfig(),
            planLimit: 2,
          },
          merchantCardImageUrl: "",
          merchantCardImageOpacity: 1,
          chatAvatarImageUrl: "",
          contactVisibility: createDefaultMerchantContactVisibility(),
          sortConfig: createDefaultMerchantSortConfig(),
        },
        sourceHistoryEntryId: `history-${idSuffix}`,
      },
    ],
  };
}

function createStoredRow(id: number, slug: string, payload: PlatformMerchantConfigArchivePayload): PageRow {
  return {
    id,
    slug,
    merchant_id: null,
    updated_at: "2026-04-15T12:00:00.000Z",
    blocks: buildPlatformMerchantConfigArchiveBlocks(payload),
  };
}

function createMockArchiveStore(initialRows: PageRow[]) {
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
      rows.push({
        id: nextId,
        slug: String(payload.slug ?? ""),
        merchant_id: (payload.merchant_id ?? null) as null,
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

  const client: PlatformMerchantConfigArchiveStoreClient & {
    read: (slug: string) => PlatformMerchantConfigArchivePayload | null;
  } = {
    from: () => new QueryBuilder() as never,
    read: (slug: string) => {
      const row = rows.find((item) => item.slug === slug) ?? null;
      return row ? readPlatformMerchantConfigArchiveFromBlocks(row.blocks) : null;
    },
  };

  return client;
}

test("loadStoredPlatformMerchantConfigArchive merges primary and backup rows", async () => {
  const client = createMockArchiveStore([
    createStoredRow(1, PLATFORM_MERCHANT_CONFIG_ARCHIVE_SLUG, createArchivePayload("one")),
    createStoredRow(2, PLATFORM_MERCHANT_CONFIG_ARCHIVE_BACKUP_SLUG, createArchivePayload("two")),
  ]);

  const payload = await loadStoredPlatformMerchantConfigArchive(client);

  assert.equal(payload.audits.length, 2);
  assert.equal(payload.backups.length, 2);
});

test("savePlatformMerchantConfigArchive writes primary and backup rows", async () => {
  const client = createMockArchiveStore([]);

  const result = await savePlatformMerchantConfigArchive(client, createArchivePayload("save"));

  assert.equal(result.error, null);
  assert.equal(client.read(PLATFORM_MERCHANT_CONFIG_ARCHIVE_SLUG)?.audits.length, 1);
  assert.equal(client.read(PLATFORM_MERCHANT_CONFIG_ARCHIVE_BACKUP_SLUG)?.backups.length, 1);
});
