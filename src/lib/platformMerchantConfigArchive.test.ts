import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultMerchantContactVisibility, createDefaultMerchantPermissionConfig, createDefaultMerchantSortConfig } from "@/data/platformControlStore";
import { derivePlatformMerchantConfigArchiveEntries } from "./platformMerchantConfigArchive";

function createSnapshot(overrides: Partial<ReturnType<typeof buildConfigSnapshot>> = {}) {
  return buildConfigSnapshot(overrides);
}

function buildConfigSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    serviceExpiresAt: "2027-07-07T00:00:00.000Z",
    permissionConfig: createDefaultMerchantPermissionConfig(),
    merchantCardImageUrl: "https://example.com/card.webp",
    merchantCardImageOpacity: 0.85,
    chatAvatarImageUrl: "https://example.com/avatar.webp",
    contactVisibility: createDefaultMerchantContactVisibility(),
    sortConfig: createDefaultMerchantSortConfig(),
    ...overrides,
  };
}

test("derivePlatformMerchantConfigArchiveEntries only appends new history rows", () => {
  const previousHistoryBySiteId = {
    "10000000": [
      {
        id: "cfg-1",
        at: "2026-04-14T10:00:00.000Z",
        operator: "super-admin",
        summary: "配置更新",
        changes: ["到期时间变更"],
        before: createSnapshot({ serviceExpiresAt: null }),
        after: createSnapshot(),
      },
    ],
  };
  const nextHistoryBySiteId = {
    "10000000": [
      ...previousHistoryBySiteId["10000000"],
      {
        id: "cfg-2",
        at: "2026-04-15T11:00:00.000Z",
        operator: "super-admin",
        summary: "从备份恢复 2026-04-10 配置",
        changes: ["方案数量上限：1 -> 3"],
        before: createSnapshot({
          permissionConfig: {
            ...createDefaultMerchantPermissionConfig(),
            planLimit: 1,
          },
        }),
        after: createSnapshot({
          permissionConfig: {
            ...createDefaultMerchantPermissionConfig(),
            planLimit: 3,
          },
        }),
      },
    ],
  };

  const payload = derivePlatformMerchantConfigArchiveEntries({
    previousHistoryBySiteId,
    nextHistoryBySiteId,
    nextSnapshot: [
      {
        id: "10000000",
        merchantName: "fafona",
        domainPrefix: "fafona",
        domainSuffix: "fafona",
        name: "fafona",
        domain: "fafona.com",
        category: "品牌官网",
        industry: "娱乐",
        location: {
          countryCode: "ES",
          country: "Spain",
          provinceCode: "AN",
          province: "Sevilla",
          city: "Sevilla",
        },
        createdAt: "2026-04-01T00:00:00.000Z",
        serviceExpiresAt: "2027-07-07T00:00:00.000Z",
        permissionConfig: {
          ...createDefaultMerchantPermissionConfig(),
          planLimit: 3,
        },
        merchantCardImageUrl: "https://example.com/current-card.webp",
        merchantCardImageOpacity: 0.65,
        chatAvatarImageUrl: "https://example.com/current-avatar.webp",
        contactVisibility: createDefaultMerchantContactVisibility(),
        sortConfig: createDefaultMerchantSortConfig(),
      },
    ],
  });

  assert.equal(payload.audits.length, 1);
  assert.equal(payload.backups.length, 1);
  assert.equal(payload.audits[0]?.id, "cfg-2");
  assert.equal(payload.audits[0]?.source, "restore");
  assert.equal(payload.backups[0]?.id, "backup-cfg-2");
  assert.equal(payload.backups[0]?.sourceHistoryEntryId, "cfg-2");
  assert.equal(payload.backups[0]?.snapshot.permissionConfig.planLimit, 3);
  assert.equal(payload.backups[0]?.snapshot.merchantCardImageUrl, "https://example.com/current-card.webp");
});
