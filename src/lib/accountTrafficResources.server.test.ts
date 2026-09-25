import assert from "node:assert/strict";
import test from "node:test";
import type { Block } from "@/data/homeBlocks";
import type { TrafficResource } from "@/lib/accountTraffic";
import { resolveTrafficResources } from "@/lib/accountTrafficResources.server";
import {
  resolveMerchantCatalogCollection,
  type MerchantCatalog,
  type MerchantCatalogCollection,
  type MerchantCatalogProduct,
} from "@/lib/merchantCatalog";
import { normalizePollConfig } from "@/lib/merchantPolls";
import { getPagePlanConfigFromBlocks } from "@/lib/pagePlans";
import { normalizeProductItems } from "@/lib/productBlock";

type ResourceInput = Parameters<typeof resolveTrafficResources>[0];

// Frozen baseline algorithm: assertions compare complete ordered resources,
// not just counts, so the read index cannot silently change signing inputs.
function baselineResources(input: ResourceInput): TrafficResource[] {
  let blocks = input.blocks;
  if (!blocks.length) return [];
  if (input.viewport === "mobile") {
    blocks = blocks.map((block) => {
      const props = block.props as Record<string, unknown>;
      return props.pagePlanConfigMobile
        ? { ...block, props: { ...props, pagePlanConfig: props.pagePlanConfigMobile } } as Block
        : block;
    });
  }
  const config = getPagePlanConfigFromBlocks(blocks);
  const plan = config.plans.find((item) => item.id === config.activePlanId) ?? config.plans[0];
  const page = plan?.pages.find((item) => item.id === input.pageId);
  if (!page) return [];
  const result: TrafficResource[] = [
    { siteId: input.siteId, module: "website", objectId: page.id, label: page.name || "网站页面" },
    { siteId: input.siteId, module: "membership", objectId: "membership-entry", label: "会员入口" },
  ];
  for (const block of page.blocks) {
    if (block.type !== "product" && block.type !== "booking" && block.type !== "coupon" && block.type !== "poll") continue;
    const heading = (block.props as { heading?: string }).heading;
    const objectId = block.type === "poll" ? `${block.id}/${normalizePollConfig(block.props, block.id).pollId}` : block.id;
    const defaults = { product: "产品模块", booking: "预约模块", coupon: "优惠券模块", poll: "投票模块" };
    result.push({ siteId: input.siteId, module: block.type, objectId, label: heading || defaults[block.type] });
    if (block.type !== "product") continue;
    const collection = input.catalog && resolveMerchantCatalogCollection(input.catalog, block.id, input.viewport);
    const products = collection && input.catalog
      ? input.catalog.products.filter((item) => collection.productIds.includes(item.id) && item.availability !== "hidden")
      : normalizeProductItems(block.props.products);
    for (const product of products) {
      const objectId = `${block.id}/${product.id}`;
      if (objectId.length <= 240) result.push({ siteId: input.siteId, module: "product", objectId, label: product.name || product.id });
    }
  }
  return result.filter((item) => item.objectId.length <= 240);
}

function product(id: string, name = id, availability: MerchantCatalogProduct["availability"] = "available"): MerchantCatalogProduct {
  return { id, code: id, name, description: "", price: "1.00", imageUrl: "", thumbnailUrl: "", tag: "", availability };
}

function collection(id: string, blockId: string, productIds: string[], viewport: MerchantCatalogCollection["viewport"] = "shared"): MerchantCatalogCollection {
  return { id, blockId, productIds, viewport };
}

function catalog(products: MerchantCatalogProduct[], collections: MerchantCatalogCollection[]): MerchantCatalog {
  return { revision: 1, updatedAt: "2026-09-25T00:00:00.000Z", pricePrefix: "€", categories: [], products, collections };
}

function block(id: string, type: string, props: Record<string, unknown> = {}): Block {
  return { id, type, props } as Block;
}

function scope(blocks: Block[], operatingCatalog: MerchantCatalog | null = null): ResourceInput {
  return { siteId: "10000000", blocks, pageId: "page-1", viewport: "desktop", catalog: operatingCatalog };
}

function exactBaseline(input: ResourceInput) {
  const expected = baselineResources(input);
  const actual = resolveTrafficResources(input);
  assert.deepEqual(actual, expected);
  return actual;
}

function pagePlans(pageId: string, label: string, blocks: Block[], activePlanId = "plan-1") {
  return {
    activePlanId,
    plans: [
      { id: "plan-1", pages: [{ id: pageId, name: label, blocks }], activePageId: pageId, blocks },
      { id: "plan-2", pages: [{ id: "draft-page", name: "未发布", blocks: [block("draft-product", "product", { products: [{ id: "draft", name: "草稿" }] })] }] },
    ],
  };
}

test("resource index preserves exact module labels, order, namespaces and tenant IDs", () => {
  const input = scope([
    block("intro", "text", { text: "不是统计资源" }),
    block("booking", "booking"),
    block("products", "product", { heading: " 商品展示 ", products: [{ id: "legacy", name: "旧商品" }] }),
    block("coupon", "coupon", { heading: "优惠" }),
    block("poll", "poll", { heading: "", pollId: "fixed-poll" }),
  ], catalog([product("p", "新商品")], [collection("c", "products", ["p"])]));
  const actual = exactBaseline(input);
  assert.deepEqual(actual.map(({ module, objectId, label }) => ({ module, objectId, label })), [
    { module: "website", objectId: "page-1", label: "页面1" },
    { module: "membership", objectId: "membership-entry", label: "会员入口" },
    { module: "booking", objectId: "booking", label: "预约模块" },
    { module: "product", objectId: "products", label: " 商品展示 " },
    { module: "product", objectId: "products/p", label: "新商品" },
    { module: "coupon", objectId: "coupon", label: "优惠" },
    { module: "poll", objectId: "poll/fixed-poll", label: "投票模块" },
  ]);
  assert.equal(actual.every((item) => item.siteId === input.siteId), true);
  assert.equal(exactBaseline({ ...input, siteId: "20000000" }).every((item) => item.siteId === "20000000"), true);
});

test("membership sets preserve original product order, duplicates and labels instead of normalized collection order", () => {
  const input = scope([block("products", "product")], catalog([
    product("second", "  原字段名称  ", "sold_out"),
    product("first", ""),
    product("hidden", "不显示", "hidden"),
    product("second", "同 ID 第二项"),
    product("outside", "不在此集合"),
  ], [collection("c", "products", ["first", "hidden", "second"])]));
  const products = exactBaseline(input).filter((item) => item.objectId.includes("/"));
  assert.deepEqual(products.map((item) => [item.objectId, item.label]), [
    ["products/second", "  原字段名称  "],
    ["products/first", "first"],
    ["products/second", "同 ID 第二项"],
  ]);
});

test("missing, ambiguous, and empty bindings retain exact legacy fallback rules", () => {
  const blocks = [block("products", "product", { products: [{ id: "legacy", name: "原区块商品" }] })];
  const products = [product("p", "目录商品")];
  const variants: Array<MerchantCatalog | null> = [
    null,
    catalog(products, [collection("other", "another-block", ["p"])]),
    catalog(products, [collection("mobile", "products", ["p"], "mobile")]),
    catalog(products, [collection("a", "products", ["p"]), collection("b", "products", ["p"])]),
    catalog(products, [collection("a", "products", ["p"], "desktop"), collection("b", "products", ["p"], "desktop")]),
  ];
  for (const operatingCatalog of variants) {
    assert.equal(exactBaseline(scope(blocks, operatingCatalog)).at(-1)?.objectId, "products/legacy");
  }
  const empty = exactBaseline(scope(blocks, catalog(products, [collection("empty", "products", [])])));
  assert.equal(empty.length, 3);
  assert.equal(empty.at(-1)?.objectId, "products");
});

test("desktop/mobile exact bindings win over shared and active published plans exclude drafts", () => {
  const sharedBlock = block("products", "product", { heading: "产品" });
  const blocks = [block("carrier", "text", {
    pagePlanConfig: pagePlans("page-1", "桌面页面", [sharedBlock]),
    pagePlanConfigMobile: pagePlans("page-1", "移动页面", [sharedBlock, block("mobile-coupon", "coupon")]),
  })];
  const operatingCatalog = catalog([product("desktop"), product("mobile"), product("shared")], [
    collection("shared", "products", ["shared"]),
    collection("desktop", "products", ["desktop"], "desktop"),
    collection("mobile", "products", ["mobile"], "mobile"),
  ]);
  const input = scope(blocks, operatingCatalog);
  const desktop = exactBaseline(input);
  const mobile = exactBaseline({ ...input, viewport: "mobile" });
  assert.equal(desktop[0].label, "桌面页面");
  assert.equal(mobile[0].label, "移动页面");
  assert.equal(desktop.some((item) => item.objectId === "products/desktop"), true);
  assert.equal(mobile.some((item) => item.objectId === "products/mobile"), true);
  assert.equal(desktop.some((item) => item.objectId === "mobile-coupon"), false);
  assert.equal(mobile.some((item) => item.objectId === "mobile-coupon"), true);
  assert.equal([...desktop, ...mobile].some((item) => item.objectId.includes("draft") || item.objectId === "products/shared"), false);
  assert.deepEqual(exactBaseline({ ...input, pageId: "draft-page" }), []);
  assert.deepEqual(exactBaseline({ ...input, pageId: "missing-page", viewport: "mobile" }), []);
});

test("resource IDs retain the exact 240-character boundary for modules, pages and products", () => {
  const acceptedProduct = "p".repeat(238);
  const excludedProduct = "p".repeat(239);
  const input = scope([
    block("b", "product"),
    block("c".repeat(240), "coupon"),
    block("c".repeat(241), "coupon"),
  ], catalog([product(acceptedProduct), product(excludedProduct)], [collection("c", "b", [excludedProduct, acceptedProduct])]));
  const actual = exactBaseline(input);
  assert.equal(actual.some((item) => item.objectId === `b/${acceptedProduct}`), true);
  assert.equal(actual.some((item) => item.objectId === `b/${excludedProduct}`), false);
  assert.equal(actual.some((item) => item.objectId === "c".repeat(240)), true);
  assert.equal(actual.every((item) => item.objectId.length <= 240), true);
  for (const length of [240, 241]) {
    const pageId = "x".repeat(length);
    const resources = exactBaseline({ ...input, pageId, blocks: [block("carrier", "text", { pagePlanConfig: pagePlans(pageId, "长标识", input.blocks) })] });
    assert.equal(resources.some((item) => item.module === "website"), length === 240);
  }
});

test("prototype-looking and delimiter-containing keys stay isolated across collections", () => {
  const keys = ["__proto__", "constructor", "toString", "a\u0001desktop", "a\u0000shared"];
  const products = keys.map((key, index) => product(key, `商品 ${index}`));
  const blocks = keys.map((key) => block(key, "product"));
  const collections = keys.map((key, index) => collection(`collection-${index}`, key, [key]));
  const actual = exactBaseline(scope(blocks, catalog(products, collections)));
  assert.deepEqual(actual.filter((item) => item.objectId.includes("/")).map((item) => item.objectId), keys.map((key) => `${key}/${key}`));
  assert.equal(Object.prototype.hasOwnProperty.call(Object.prototype, "polluted"), false);
});

test("empty, missing-page and non-product resource paths never inspect a catalog", () => {
  const unreadable = new Proxy({} as MerchantCatalog, { get() { throw new Error("catalog_must_not_be_read"); } });
  assert.deepEqual(resolveTrafficResources(scope([], unreadable)), []);
  const input = scope([block("book", "booking"), block("coupon", "coupon"), block("poll", "poll", { pollId: "poll-id" })], unreadable);
  assert.deepEqual(resolveTrafficResources({ ...input, pageId: "missing" }), []);
  assert.equal(exactBaseline(input).length, 5);
});

test("new calls observe in-place changes to the same catalog without cross-call cache", () => {
  const operatingCatalog = catalog([product("before", "修改前")], [collection("c", "products", ["before"])]);
  const input = scope([block("products", "product")], operatingCatalog);
  const before = exactBaseline(input);
  assert.equal(before.at(-1)?.objectId, "products/before");
  operatingCatalog.products.push(product("after", "修改后"));
  operatingCatalog.products[0].availability = "hidden";
  operatingCatalog.collections[0].productIds = ["after", "before"];
  operatingCatalog.revision += 1;
  const after = exactBaseline(input);
  assert.equal(after.at(-1)?.objectId, "products/after");
  assert.equal(after.some((item) => item.objectId === "products/before"), false);
  assert.equal(before.at(-1)?.label, "修改前");
});

test("resource preparation does not change input blocks, catalog or published metadata", () => {
  const input = scope([block("products", "product")], catalog([product("p")], [collection("c", "products", ["p"])]));
  const snapshot = structuredClone(input);
  const freeze = (value: unknown): void => {
    if (!value || typeof value !== "object" || Object.isFrozen(value)) return;
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  };
  freeze(input);
  const actual = exactBaseline(input);
  actual[0].label = "只修改返回值";
  assert.deepEqual(input, snapshot);
});

test("twenty product blocks normalize one thousand products once and perform no linear membership includes", () => {
  let priceReads = 0;
  const products = Array.from({ length: 1000 }, (_, index) => {
    const item = product(`scale-product-${index}`);
    Object.defineProperty(item, "price", { enumerable: true, get() { priceReads += 1; return "1.00"; } });
    return item;
  });
  const ids = products.map((item) => item.id);
  const blocks = Array.from({ length: 20 }, (_, index) => block(`products-${index}`, "product"));
  const input = scope(blocks, catalog(products, blocks.map((item, index) => collection(`c-${index}`, item.id, [...ids].reverse()))));
  const expected = baselineResources(input);
  assert.equal(priceReads, 20_000);
  priceReads = 0;
  let membershipIncludes = 0;
  const originalIncludes = Array.prototype.includes;
  let actual: TrafficResource[];
  try {
    Array.prototype.includes = function (this: unknown[], value: unknown, fromIndex?: number) {
      if (typeof value === "string" && value.startsWith("scale-product-")) membershipIncludes += 1;
      return originalIncludes.call(this, value, fromIndex);
    };
    actual = resolveTrafficResources(input);
  } finally {
    Array.prototype.includes = originalIncludes;
  }
  assert.deepEqual(actual, expected);
  assert.equal(actual.length, 20_022);
  assert.equal(priceReads, 1000, "one normalization per resource-resolution invocation");
  assert.equal(membershipIncludes, 0, "product membership must use indexed lookup rather than array scans");
});
