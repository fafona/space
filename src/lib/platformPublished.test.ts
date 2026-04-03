import assert from "node:assert/strict";
import test from "node:test";
import type { Block, MerchantListPublishedSite } from "@/data/homeBlocks";
import {
  blocksNeedPublishedMerchantSnapshot,
  buildPublishedMerchantSnapshotFromRows,
  collectPublishedMerchantSnapshotsFromBlocks,
  injectPublishedMerchantSnapshotIntoBlocks,
  mergePublishedMerchantSnapshots,
} from "./platformPublished";

test("buildPublishedMerchantSnapshotFromRows maps published merchant pages into runtime snapshot entries", () => {
  const snapshot = buildPublishedMerchantSnapshotFromRows(
    [
      {
        merchant_id: "site-main",
        slug: "home",
        updated_at: "2026-03-01T00:00:00.000Z",
        created_at: "2026-03-01T00:00:00.000Z",
      },
      {
        merchant_id: "10000001",
        slug: "home",
        updated_at: "2026-03-03T03:30:03.459Z",
        created_at: "2026-03-03T03:30:04.550Z",
      },
      {
        merchant_id: "10000000",
        slug: "fafona",
        updated_at: "2026-03-29T17:36:59.114Z",
        created_at: "2026-03-03T05:30:48.733Z",
      },
    ],
    [
      {
        id: "10000000",
        name: "fafona",
        created_at: "2026-03-02T13:51:41.778Z",
      },
      {
        id: "10000001",
        name: "20889576",
        created_at: "2026-03-03T01:35:32.499Z",
      },
    ],
  );

  assert.equal(snapshot.length, 2);
  const byId = new Map(snapshot.map((item) => [item.id, item] as const));
  assert.equal(byId.get("10000000")?.merchantName, "fafona");
  assert.equal(byId.get("10000000")?.domainPrefix, "fafona");
  assert.equal(byId.get("10000000")?.domain, "fafona");
  assert.equal(byId.get("10000000")?.merchantCardImageOpacity, 1);
  assert.equal(byId.get("10000001")?.merchantName, "20889576");
  assert.equal(byId.get("10000001")?.domainPrefix, "");
  assert.equal(byId.get("10000001")?.domain, "10000001");
  assert.equal(byId.get("10000001")?.merchantCardImageOpacity, 1);
});

test("injectPublishedMerchantSnapshotIntoBlocks patches empty merchant snapshots recursively", () => {
  const blocks: Block[] = [
    {
      id: "merchant-root",
      type: "merchant-list",
      props: {
        heading: "商户列表",
        publishedMerchantSnapshot: [],
      } as never,
    },
    {
      id: "common-root",
      type: "common",
      props: {
        commonTextBoxes: [],
        pagePlanConfig: {
          activePlanId: "plan-1",
          plans: [
            {
              id: "plan-1",
              activePageId: "page-1",
              pages: [
                {
                  id: "page-1",
                  name: "首页",
                  blocks: [
                    {
                      id: "merchant-nested",
                      type: "merchant-list",
                      props: {
                        heading: "嵌套商户列表",
                      } as never,
                    },
                  ],
                },
              ],
            },
          ],
        },
      } as never,
    },
  ];

  assert.equal(blocksNeedPublishedMerchantSnapshot(blocks), true);

  const next = injectPublishedMerchantSnapshotIntoBlocks(blocks, [
    {
      id: "10000000",
      merchantName: "fafona",
      domainPrefix: "fafona",
      domainSuffix: "",
      name: "fafona",
      domain: "fafona",
      category: "",
      industry: "",
      location: {
        countryCode: "",
        country: "",
        provinceCode: "",
        province: "",
        city: "",
      },
      merchantCardImageUrl: "",
      merchantCardImageOpacity: 1,
      sortConfig: {
        recommendedCountryRank: null,
        recommendedProvinceRank: null,
        recommendedCityRank: null,
        industryCountryRank: null,
        industryProvinceRank: null,
        industryCityRank: null,
      },
      createdAt: "2026-03-29T17:36:59.114Z",
    },
  ]);

  const rootProps = next[0].props as {
    publishedMerchantSnapshot?: Array<{ id: string }>;
    publishedMerchantDefaultSortRule?: string;
  };
  assert.equal(rootProps.publishedMerchantSnapshot?.length, 1);
  assert.equal(rootProps.publishedMerchantDefaultSortRule, "created_desc");

  const nestedBlocks =
    (((next[1].props as {
      pagePlanConfig?: {
        plans?: Array<{ pages?: Array<{ blocks?: Block[] }> }>;
      };
    }).pagePlanConfig?.plans?.[0]?.pages?.[0]?.blocks ?? []) as Block[]);
  const nestedProps = nestedBlocks[0]?.props as {
    publishedMerchantSnapshot?: Array<{ id: string }>;
    publishedMerchantDefaultSortRule?: string;
  };
  assert.equal(nestedProps.publishedMerchantSnapshot?.length, 1);
  assert.equal(nestedProps.publishedMerchantSnapshot?.[0]?.id, "10000000");
  assert.equal(blocksNeedPublishedMerchantSnapshot(next), false);
});

test("injectPublishedMerchantSnapshotIntoBlocks can replace stale merchant snapshots when forced", () => {
  const blocks: Block[] = [
    {
      id: "merchant-root",
      type: "merchant-list",
      props: {
        heading: "鍟嗘埛鍒楄〃",
        publishedMerchantSnapshot: [
          {
            id: "10000000",
            merchantName: "fafona",
            domainPrefix: "fafona",
            domainSuffix: "",
            name: "fafona",
            domain: "fafona",
            category: "",
            industry: "",
            location: {
              countryCode: "",
              country: "",
              provinceCode: "",
              province: "",
              city: "",
            },
            merchantCardImageUrl: "",
            merchantCardImageOpacity: 1,
            sortConfig: {
              recommendedCountryRank: null,
              recommendedProvinceRank: null,
              recommendedCityRank: null,
              industryCountryRank: null,
              industryProvinceRank: null,
              industryCityRank: null,
            },
            createdAt: "2026-03-29T17:36:59.114Z",
          },
        ],
        publishedMerchantDefaultSortRule: "name_asc",
      } as never,
    },
  ];

  const next = injectPublishedMerchantSnapshotIntoBlocks(
    blocks,
    [
      {
        id: "10000000",
        merchantName: "fafona",
        domainPrefix: "fafona",
        domainSuffix: "",
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
        merchantCardImageOpacity: 0.45,
        sortConfig: {
          recommendedCountryRank: null,
          recommendedProvinceRank: null,
          recommendedCityRank: null,
          industryCountryRank: 1,
          industryProvinceRank: null,
          industryCityRank: null,
        },
        createdAt: "2026-03-29T17:36:59.114Z",
      },
    ],
    "monthly_views_desc",
    { forceReplace: true },
  );

  const rootProps = next[0].props as {
    publishedMerchantSnapshot?: Array<{
      industry?: string;
      location?: { city?: string };
      merchantCardImageUrl?: string;
      merchantCardImageOpacity?: number;
    }>;
    publishedMerchantDefaultSortRule?: string;
  };
  assert.equal(rootProps.publishedMerchantSnapshot?.[0]?.industry, "娱乐");
  assert.equal(rootProps.publishedMerchantSnapshot?.[0]?.location?.city, "Sevilla");
  assert.equal(rootProps.publishedMerchantSnapshot?.[0]?.merchantCardImageUrl, "https://example.com/card.webp");
  assert.equal(rootProps.publishedMerchantSnapshot?.[0]?.merchantCardImageOpacity, 0.45);
  assert.equal(rootProps.publishedMerchantDefaultSortRule, "monthly_views_desc");
});

test("injectPublishedMerchantSnapshotIntoBlocks keeps richer existing merchant card config when force replacing", () => {
  const blocks: Block[] = [
    {
      id: "merchant-root",
      type: "merchant-list",
      props: {
        heading: "商户列表",
        publishedMerchantSnapshot: [
          {
            id: "10909091",
            merchantName: "ABC",
            domainPrefix: "abc",
            domainSuffix: "abc",
            name: "ABC",
            domain: "abc.faolla.com",
            category: "品牌官网",
            industry: "零售",
            location: {
              countryCode: "ES",
              country: "Spain",
              provinceCode: "41",
              province: "Sevilla",
              city: "Sevilla",
            },
            contactAddress: "C.Transporte,55",
            contactName: "Felix",
            contactPhone: "633130577",
            contactEmail: "fafona.felix@gmail.com",
            merchantCardImageUrl: "https://example.com/abc.webp",
            merchantCardImageOpacity: 0.57,
            sortConfig: {
              recommendedCountryRank: null,
              recommendedProvinceRank: null,
              recommendedCityRank: null,
              industryCountryRank: null,
              industryProvinceRank: null,
              industryCityRank: null,
            },
            createdAt: "2026-03-30T22:30:25.281331+00:00",
          },
          {
            id: "10000000",
            merchantName: "fafona",
            domainPrefix: "fafona",
            domainSuffix: "fafona",
            name: "fafona",
            domain: "fafona.faolla.com",
            category: "品牌官网",
            industry: "娱乐",
            location: {
              countryCode: "ES",
              country: "Spain",
              provinceCode: "41",
              province: "Sevilla",
              city: "Sevilla",
            },
            contactAddress: "C. Transporte, 12",
            contactName: "Felix",
            contactPhone: "633130577",
            contactEmail: "caimin00x@gmail.com",
            merchantCardImageUrl: "https://example.com/fafona.webp",
            merchantCardImageOpacity: 0.5,
            sortConfig: {
              recommendedCountryRank: null,
              recommendedProvinceRank: null,
              recommendedCityRank: null,
              industryCountryRank: null,
              industryProvinceRank: null,
              industryCityRank: null,
            },
            createdAt: "2026-03-23T00:02:47.824Z",
          },
        ],
        publishedMerchantDefaultSortRule: "name_asc",
      } as never,
    },
  ];

  const next = injectPublishedMerchantSnapshotIntoBlocks(
    blocks,
    [
      {
        id: "10909091",
        merchantName: "ABC",
        domainPrefix: "abc",
        domainSuffix: "",
        name: "ABC",
        domain: "10909091",
        category: "",
        industry: "",
        location: {
          countryCode: "",
          country: "",
          provinceCode: "",
          province: "",
          city: "",
        },
        merchantCardImageUrl: "",
        merchantCardImageOpacity: 1,
        sortConfig: {
          recommendedCountryRank: null,
          recommendedProvinceRank: null,
          recommendedCityRank: null,
          industryCountryRank: null,
          industryProvinceRank: null,
          industryCityRank: null,
        },
        createdAt: "2026-03-30T22:30:25.281331+00:00",
      },
      {
        id: "10000001",
        merchantName: "20889576",
        domainPrefix: "",
        domainSuffix: "",
        name: "20889576",
        domain: "10000001",
        category: "",
        industry: "",
        location: {
          countryCode: "",
          country: "",
          provinceCode: "",
          province: "",
          city: "",
        },
        merchantCardImageUrl: "",
        merchantCardImageOpacity: 1,
        sortConfig: {
          recommendedCountryRank: null,
          recommendedProvinceRank: null,
          recommendedCityRank: null,
          industryCountryRank: null,
          industryProvinceRank: null,
          industryCityRank: null,
        },
        createdAt: "2026-03-03T03:30:04.550Z",
      },
      {
        id: "10000000",
        merchantName: "fafona",
        domainPrefix: "fafona",
        domainSuffix: "",
        name: "fafona",
        domain: "fafona",
        category: "",
        industry: "",
        location: {
          countryCode: "",
          country: "",
          provinceCode: "",
          province: "",
          city: "",
        },
        merchantCardImageUrl: "",
        merchantCardImageOpacity: 1,
        sortConfig: {
          recommendedCountryRank: null,
          recommendedProvinceRank: null,
          recommendedCityRank: null,
          industryCountryRank: null,
          industryProvinceRank: null,
          industryCityRank: null,
        },
        createdAt: "2026-03-23T00:02:47.824Z",
      },
    ],
    "monthly_views_desc",
    { forceReplace: true },
  );

  const rootProps = next[0].props as {
    publishedMerchantSnapshot?: MerchantListPublishedSite[];
    publishedMerchantDefaultSortRule?: string;
  };
  assert.equal(rootProps.publishedMerchantSnapshot?.length, 3);
  const byId = new Map((rootProps.publishedMerchantSnapshot ?? []).map((item) => [item.id, item] as const));
  assert.equal(byId.get("10909091")?.merchantCardImageUrl, "https://example.com/abc.webp");
  assert.equal(byId.get("10909091")?.category, "品牌官网");
  assert.equal(byId.get("10909091")?.industry, "零售");
  assert.equal(byId.get("10000000")?.merchantCardImageUrl, "https://example.com/fafona.webp");
  assert.equal(byId.get("10000001")?.merchantName, "20889576");
  assert.equal(rootProps.publishedMerchantDefaultSortRule, "monthly_views_desc");
});

test("collectPublishedMerchantSnapshotsFromBlocks merges richer existing homepage card config with nested snapshots", () => {
  const blocks: Block[] = [
    {
      id: "merchant-root",
      type: "merchant-list",
      props: {
        publishedMerchantSnapshot: [
          {
            id: "10909091",
            merchantName: "ABC",
            domainPrefix: "abc",
            domainSuffix: "abc",
            name: "ABC",
            domain: "abc.faolla.com",
            category: "品牌官网",
            industry: "零售",
            location: {
              countryCode: "ES",
              country: "Spain",
              provinceCode: "41",
              province: "Sevilla",
              city: "Sevilla",
            },
            contactAddress: "C.Transporte,55",
            contactName: "Felix",
            contactPhone: "633130577",
            contactEmail: "fafona.felix@gmail.com",
            merchantCardImageUrl: "https://example.com/abc.webp",
            merchantCardImageOpacity: 0.57,
            sortConfig: {
              recommendedCountryRank: null,
              recommendedProvinceRank: null,
              recommendedCityRank: null,
              industryCountryRank: null,
              industryProvinceRank: null,
              industryCityRank: null,
            },
            createdAt: "2026-03-30T22:30:25.281331+00:00",
          },
        ],
      } as never,
    },
    {
      id: "common-root",
      type: "common",
      props: {
        pagePlanConfig: {
          activePlanId: "plan-1",
          plans: [
            {
              id: "plan-1",
              pages: [
                {
                  id: "page-1",
                  blocks: [
                    {
                      id: "merchant-nested",
                      type: "merchant-list",
                      props: {
                        publishedMerchantSnapshot: [
                          {
                            id: "10909091",
                            merchantName: "ABC",
                            domainPrefix: "abc",
                            domainSuffix: "",
                            name: "ABC",
                            domain: "10909091",
                            category: "",
                            industry: "",
                            location: {
                              countryCode: "",
                              country: "",
                              provinceCode: "",
                              province: "",
                              city: "",
                            },
                            merchantCardImageUrl: "",
                            merchantCardImageOpacity: 1,
                            sortConfig: {
                              recommendedCountryRank: null,
                              recommendedProvinceRank: null,
                              recommendedCityRank: null,
                              industryCountryRank: null,
                              industryProvinceRank: null,
                              industryCityRank: null,
                            },
                            createdAt: "2026-03-30T22:30:25.281331+00:00",
                          },
                          {
                            id: "10000001",
                            merchantName: "20889576",
                            domainPrefix: "",
                            domainSuffix: "",
                            name: "20889576",
                            domain: "10000001",
                            category: "",
                            industry: "",
                            location: {
                              countryCode: "",
                              country: "",
                              provinceCode: "",
                              province: "",
                              city: "",
                            },
                            merchantCardImageUrl: "",
                            merchantCardImageOpacity: 1,
                            sortConfig: {
                              recommendedCountryRank: null,
                              recommendedProvinceRank: null,
                              recommendedCityRank: null,
                              industryCountryRank: null,
                              industryProvinceRank: null,
                              industryCityRank: null,
                            },
                            createdAt: "2026-03-03T03:30:04.550Z",
                          },
                        ],
                      } as never,
                    },
                  ],
                },
              ],
            },
          ],
        },
      } as never,
    },
  ];

  const snapshot = collectPublishedMerchantSnapshotsFromBlocks(blocks);
  assert.equal(snapshot.length, 2);
  const byId = new Map(snapshot.map((item) => [item.id, item] as const));
  assert.equal(byId.get("10909091")?.merchantCardImageUrl, "https://example.com/abc.webp");
  assert.equal(byId.get("10909091")?.category, "品牌官网");
  assert.equal(byId.get("10000001")?.merchantName, "20889576");
});

test("mergePublishedMerchantSnapshots restores missing published merchants while keeping richer stored card data", () => {
  const merged = mergePublishedMerchantSnapshots(
    [
      {
        id: "10000001",
        merchantName: "ABC",
        domainPrefix: "",
        domainSuffix: "",
        name: "ABC",
        domain: "10000001",
        category: "",
        industry: "",
        location: {
          countryCode: "",
          country: "",
          provinceCode: "",
          province: "",
          city: "",
        },
        merchantCardImageUrl: "",
        merchantCardImageOpacity: 1,
        sortConfig: {
          recommendedCountryRank: null,
          recommendedProvinceRank: null,
          recommendedCityRank: null,
          industryCountryRank: null,
          industryProvinceRank: null,
          industryCityRank: null,
        },
        createdAt: "2026-03-03T03:30:04.550Z",
      },
      {
        id: "10000000",
        merchantName: "fafona",
        domainPrefix: "fafona",
        domainSuffix: "",
        name: "fafona",
        domain: "fafona",
        category: "",
        industry: "",
        location: {
          countryCode: "",
          country: "",
          provinceCode: "",
          province: "",
          city: "",
        },
        merchantCardImageUrl: "",
        merchantCardImageOpacity: 1,
        sortConfig: {
          recommendedCountryRank: null,
          recommendedProvinceRank: null,
          recommendedCityRank: null,
          industryCountryRank: null,
          industryProvinceRank: null,
          industryCityRank: null,
        },
        createdAt: "2026-03-29T17:36:59.114Z",
      },
    ],
    [
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
        merchantCardImageOpacity: 0.45,
        sortConfig: {
          recommendedCountryRank: null,
          recommendedProvinceRank: null,
          recommendedCityRank: null,
          industryCountryRank: 1,
          industryProvinceRank: null,
          industryCityRank: null,
        },
        createdAt: "2026-03-29T17:36:59.114Z",
      },
    ],
  );

  assert.equal(merged.length, 2);
  const byId = new Map(merged.map((item) => [item.id, item] as const));
  assert.equal(byId.get("10000000")?.merchantCardImageUrl, "https://example.com/card.webp");
  assert.equal(byId.get("10000000")?.merchantCardImageOpacity, 0.45);
  assert.equal(byId.get("10000000")?.industry, "娱乐");
  assert.equal(byId.get("10000001")?.merchantName, "ABC");
});
