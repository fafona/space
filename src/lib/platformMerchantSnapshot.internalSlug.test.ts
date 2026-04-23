import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPlatformMerchantSnapshotBlocks,
  readPlatformMerchantSnapshotFromBlocks,
} from "./platformMerchantSnapshot";

test("platform merchant snapshot normalizes internal storage slugs out of public domains", () => {
  const stored = buildPlatformMerchantSnapshotBlocks({
    revision: "snapshot-internal-slug",
    snapshot: [
      {
        id: "10000000",
        merchantName: "fafona",
        domainPrefix: "__merchant_orders__:10000000:chunk:0",
        domainSuffix: "__merchant_orders__:10000000:chunk:0",
        name: "fafona",
        domain: "__merchant_orders__:10000000:chunk:0",
        category: "",
        industry: "",
        location: {
          countryCode: "",
          country: "",
          provinceCode: "",
          province: "",
          city: "",
        },
        merchantCardImageUrl: "https://example.com/card.webp",
        merchantCardImageOpacity: 0.5,
        sortConfig: {
          recommendedCountryRank: null,
          recommendedProvinceRank: null,
          recommendedCityRank: null,
          industryCountryRank: null,
          industryProvinceRank: null,
          industryCityRank: null,
        },
        createdAt: "2026-04-23T12:00:00.000Z",
      },
    ],
    defaultSortRule: "created_desc",
    merchantConfigHistoryBySiteId: {},
  });

  const payload = readPlatformMerchantSnapshotFromBlocks(stored);
  assert.ok(payload);
  assert.equal(payload.snapshot[0]?.domainPrefix, "");
  assert.equal(payload.snapshot[0]?.domainSuffix, "");
  assert.equal(payload.snapshot[0]?.domain, "10000000");
});
