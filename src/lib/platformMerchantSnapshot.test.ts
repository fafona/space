import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPlatformMerchantSnapshotBlocks,
  buildPlatformMerchantSnapshotPayloadFromState,
  readPlatformMerchantSnapshotFromBlocks,
} from "./platformMerchantSnapshot";

test("buildPlatformMerchantSnapshotPayloadFromState keeps merchant info and card settings", () => {
  const payload = buildPlatformMerchantSnapshotPayloadFromState({
    sites: [
      {
        id: "10000000",
        tenantId: "tenant-1",
        merchantName: "fafona",
        domainPrefix: "fafona",
        domainSuffix: "fafona",
        contactAddress: "",
        contactName: "",
        contactPhone: "",
        contactEmail: "",
        name: "fafona",
        domain: "fafona",
        categoryId: "category-1",
        category: "品牌官网",
        industry: "娱乐",
        status: "online",
        publishedVersion: 1,
        lastPublishedAt: null,
        features: {
          multi_page_editor: false,
          schedule_publish: false,
          ai_copywriting: false,
          custom_domain: false,
          member_center: false,
          ab_test: false,
          api_access: false,
          advanced_analytics: false,
        },
        location: {
          countryCode: "ES",
          country: "Spain",
          provinceCode: "AN",
          province: "Sevilla",
          city: "Sevilla",
        },
        merchantCardImageUrl: "https://example.com/card.webp",
        sortConfig: {
          recommendedCountryRank: 2,
          recommendedProvinceRank: null,
          recommendedCityRank: null,
          industryCountryRank: 1,
          industryProvinceRank: null,
          industryCityRank: null,
        },
        createdAt: "2026-03-29T12:00:00.000Z",
        updatedAt: "2026-03-29T12:00:00.000Z",
      },
    ],
    homeLayout: {
      heroTitle: "",
      heroSubtitle: "",
      featuredCategoryIds: [],
      merchantDefaultSortRule: "name_desc",
      sections: [],
    },
  });

  assert.equal(payload.defaultSortRule, "name_desc");
  assert.equal(payload.snapshot.length, 1);
  assert.equal(payload.snapshot[0]?.industry, "娱乐");
  assert.equal(payload.snapshot[0]?.location.country, "Spain");
  assert.equal(payload.snapshot[0]?.merchantCardImageUrl, "https://example.com/card.webp");
});

test("platform merchant snapshot blocks round-trip through storage payload", () => {
  const stored = buildPlatformMerchantSnapshotBlocks({
    snapshot: [
      {
        id: "10000000",
        merchantName: "fafona",
        domainPrefix: "fafona",
        domainSuffix: "fafona",
        name: "fafona",
        domain: "fafona",
        category: "品牌官网",
        industry: "娱乐",
        location: {
          countryCode: "ES",
          country: "Spain",
          provinceCode: "AN",
          province: "Sevilla",
          city: "Sevilla",
        },
        merchantCardImageUrl: "https://example.com/card.webp",
        sortConfig: {
          recommendedCountryRank: 2,
          recommendedProvinceRank: null,
          recommendedCityRank: null,
          industryCountryRank: 1,
          industryProvinceRank: null,
          industryCityRank: null,
        },
        createdAt: "2026-03-29T12:00:00.000Z",
      },
    ],
    defaultSortRule: "monthly_views_desc",
  });

  const payload = readPlatformMerchantSnapshotFromBlocks(stored);
  assert.ok(payload);
  assert.equal(payload?.defaultSortRule, "monthly_views_desc");
  assert.equal(payload?.snapshot[0]?.location.city, "Sevilla");
  assert.equal(payload?.snapshot[0]?.merchantCardImageUrl, "https://example.com/card.webp");
});
