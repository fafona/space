import assert from "node:assert/strict";
import test from "node:test";
import type { Block } from "@/data/homeBlocks";
import {
  normalizeMerchantCatalog,
  type MerchantCatalog,
  type MerchantCatalogBrowsingRules,
} from "@/lib/merchantCatalog";
import {
  handleMerchantCatalogPublicGet,
  type MerchantCatalogPublicRouteDependencies,
} from "./route";

const SITE_ID = "12345678";
const BLOCK_ID = "product-block";

const publishedProductBlock: Block = {
  id: BLOCK_ID,
  type: "product",
  props: {
    products: [{ id: "product-a", code: "A", name: "Product A", price: "10.00" }],
  },
};

function catalogWithCollections(input: {
  sharedRules?: MerchantCatalogBrowsingRules;
  desktopRules?: MerchantCatalogBrowsingRules;
}): MerchantCatalog {
  return normalizeMerchantCatalog({
    revision: 2,
    updatedAt: "2026-08-17T10:00:00.000Z",
    pricePrefix: "€",
    products: [
      {
        id: "product-a",
        code: "A",
        name: "Product A",
        description: "",
        price: "10.00",
        imageUrl: "",
        thumbnailUrl: "",
        tag: "",
        availability: "available",
      },
    ],
    categories: [],
    collections: [
      {
        id: "shared",
        blockId: BLOCK_ID,
        viewport: "shared",
        productIds: ["product-a"],
        ...(input.sharedRules ? { browsingRules: input.sharedRules } : {}),
      },
      ...(input.desktopRules
        ? [{
            id: "desktop",
            blockId: BLOCK_ID,
            viewport: "desktop",
            productIds: ["product-a"],
            browsingRules: input.desktopRules,
          }]
        : []),
    ],
  });
}

function dependencies(catalog: MerchantCatalog): Partial<MerchantCatalogPublicRouteDependencies> {
  return {
    loadSnapshotSite: async () => ({
      permissionConfig: { allowProductBlock: true },
    } as never),
    loadCatalog: async () => catalog,
    fetchPublishedBlocks: async () => ({ blocks: [publishedProductBlock] } as never),
  };
}

async function readCatalog(catalog: MerchantCatalog, viewport: "desktop" | "mobile") {
  const response = await handleMerchantCatalogPublicGet(
    new Request(
      `https://example.test/api/orders/catalog/public?siteId=${SITE_ID}&blockId=${BLOCK_ID}&viewport=${viewport}`,
    ),
    dependencies(catalog),
  );
  assert.equal(response.status, 200);
  return (await response.json()) as { catalog?: Record<string, unknown> };
}

test("public catalog returns browsing rules from the exact viewport before shared fallback", async () => {
  const sharedRules: MerchantCatalogBrowsingRules = {
    searchEnabled: true,
    searchPlaceholder: "Shared",
    hideUnselectedCategory: true,
    groupByCategory: false,
  };
  const desktopRules: MerchantCatalogBrowsingRules = {
    searchEnabled: false,
    searchPlaceholder: "Desktop",
    hideUnselectedCategory: false,
    groupByCategory: true,
  };
  const catalog = catalogWithCollections({ sharedRules, desktopRules });

  const desktop = await readCatalog(catalog, "desktop");
  assert.deepEqual(desktop.catalog?.browsingRules, desktopRules);
  assert.deepEqual(desktop.catalog?.collection, {
    id: "desktop",
    blockId: BLOCK_ID,
    viewport: "desktop",
  });

  const mobile = await readCatalog(catalog, "mobile");
  assert.deepEqual(mobile.catalog?.browsingRules, sharedRules);
  assert.deepEqual(mobile.catalog?.collection, {
    id: "shared",
    blockId: BLOCK_ID,
    viewport: "shared",
  });
});

test("public catalog omits browsing rules for a legacy collection instead of inventing defaults", async () => {
  const payload = await readCatalog(catalogWithCollections({}), "mobile");

  assert.equal(Object.prototype.hasOwnProperty.call(payload.catalog, "browsingRules"), false);
});
