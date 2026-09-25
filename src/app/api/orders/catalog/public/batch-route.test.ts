import assert from "node:assert/strict";
import test from "node:test";
import type { Block } from "@/data/homeBlocks";
import type { MerchantCatalog } from "@/lib/merchantCatalog";
import { decodePublicCatalogBatch, type PublicCatalogBatchResponse } from "@/lib/merchantPublicCatalog";
import { handleMerchantCatalogPublicGet, type MerchantCatalogPublicRouteDependencies } from "./route-handler";
import { handleMerchantCatalogPublicPost, MAX_PUBLIC_CATALOG_BATCH_BODY_BYTES } from "./batch-route-handler";

const siteId = "12345678";
const url = "https://example.test/api/orders/catalog/public";
const blockIds = ["one", "two", "empty", "wrong-viewport", "unpublished", "legacy"];
function fixture(): MerchantCatalog {
  return {
    revision: 7, updatedAt: "2026-09-25T05:00:00.000Z", pricePrefix: "€",
    products: ["a", "b", "hidden", "unpublished-only"].map((id) => ({
      id, code: id, name: id, description: "", price: "10", imageUrl: "", thumbnailUrl: "", tag: "",
      availability: id === "hidden" ? "hidden" : id === "b" ? "sold_out" : "available",
    })),
    categories: [
      { id: "category", name: "Ordered", productIds: ["a", "b", "a", "hidden", "unpublished-only"] },
      { id: "empty-category", name: "Always retained", productIds: [] },
    ],
    collections: [
      { id: "one-shared", blockId: "one", viewport: "shared", productIds: ["b"] },
      { id: "one-desktop", blockId: "one", viewport: "desktop", productIds: ["b", "a", "a", "hidden", "missing"], browsingRules: { searchEnabled: true, searchPlaceholder: "Find", hideUnselectedCategory: false, groupByCategory: true } },
      { id: "two", blockId: "two", viewport: "shared", productIds: ["a", "b"] },
      { id: "empty", blockId: "empty", viewport: "shared", productIds: [] },
      { id: "mobile-only", blockId: "wrong-viewport", viewport: "mobile", productIds: ["a"] },
      { id: "private", blockId: "unpublished", viewport: "shared", productIds: ["unpublished-only"] },
    ],
  };
}
function setup(catalog: MerchantCatalog | null = fixture(), allowed = true) {
  const calls = { snapshot: 0, catalog: 0, published: 0 };
  const dependencies: Partial<MerchantCatalogPublicRouteDependencies> = {
    loadSnapshotSite: async (actualSiteId) => {
      assert.equal(actualSiteId, siteId);
      calls.snapshot++;
      return { permissionConfig: { allowProductBlock: allowed, allowOrderManagement: false } } as never;
    },
    loadCatalog: async () => { calls.catalog++; return catalog; },
    fetchPublishedBlocks: async () => {
      calls.published++;
      return { blocks: ["one", "two", "empty", "wrong-viewport"].map((id): Block => ({ id, type: "product", props: {} })) } as never;
    },
  };
  return { calls, dependencies };
}
function request(body: unknown) {
  return new Request(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

for (const viewport of ["desktop", "mobile"] as const) {
  test(`batch reconstructs the exact existing GET results for every mixed ${viewport} scope`, async () => {
    const context = setup();
    const response = await handleMerchantCatalogPublicPost(request({ siteId, viewport, blockIds }), context.dependencies);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store, max-age=0");
    assert.deepEqual(context.calls, { snapshot: 1, catalog: 1, published: 1 });
    const wire = await response.json() as PublicCatalogBatchResponse;
    const states = decodePublicCatalogBatch(wire, { siteId, viewport, blockIds });
    for (const blockId of blockIds) {
      const single = await handleMerchantCatalogPublicGet(new Request(`${url}?siteId=${siteId}&viewport=${viewport}&blockId=${blockId}`), context.dependencies);
      const payload = await single.json();
      if (single.status === 200) assert.deepEqual(states.get(blockId), { status: "ready", catalog: payload.catalog });
      else {
        assert.deepEqual(states.get(blockId), { status: "error", catalog: null });
        assert.deepEqual(wire.results.find((entry) => entry.blockId === blockId), { blockId, status: "error", error: payload.error, statusCode: single.status });
      }
    }
    assert.equal(JSON.stringify(wire).includes("unpublished-only"), false);
    assert.equal(wire.catalog?.products.some((product) => product.availability === "hidden"), false);
    assert.ok(wire.catalog?.products.some((product) => product.availability === "sold_out"));
  });
}

test("category union keeps source order instead of per-block arrival order, including duplicate membership", async () => {
  const catalog = fixture();
  catalog.collections = catalog.collections.filter((entry) => entry.id !== "one-desktop");
  const response = await handleMerchantCatalogPublicPost(request({ siteId, viewport: "desktop", blockIds: ["one", "two"] }), setup(catalog).dependencies);
  const wire = await response.json() as PublicCatalogBatchResponse;
  assert.deepEqual(wire.catalog?.categories[0].productIds, ["a", "b", "a"]);
  assert.deepEqual(decodePublicCatalogBatch(wire, { siteId, viewport: "desktop", blockIds: ["two"] }).get("two")?.catalog?.categories[0].productIds, ["a", "b", "a"]);
});

test("a catalog with duplicate products matches GET's last-product-wins semantics", async () => {
  const catalog = fixture();
  catalog.products.push({ ...catalog.products[0], price: "25" });
  const response = await handleMerchantCatalogPublicPost(request({ siteId, viewport: "desktop", blockIds: ["two"] }), setup(catalog).dependencies);
  const wire = await response.json();
  const single = await handleMerchantCatalogPublicGet(new Request(`${url}?siteId=${siteId}&viewport=desktop&blockId=two`), setup(catalog).dependencies);
  assert.deepEqual(decodePublicCatalogBatch(wire, { siteId, viewport: "desktop", blockIds: ["two"] }).get("two")?.catalog, (await single.json()).catalog);
});

test("absent catalog still loads publication once and returns explicit legacy states", async () => {
  const context = setup(null);
  const response = await handleMerchantCatalogPublicPost(request({ siteId, viewport: "desktop", blockIds }), context.dependencies);
  assert.equal(response.status, 200);
  assert.deepEqual(context.calls, { snapshot: 1, catalog: 1, published: 1 });
  const body = await response.json();
  assert.equal(body.catalog, null);
  for (const state of decodePublicCatalogBatch(body, { siteId, viewport: "desktop", blockIds }).values()) {
    assert.deepEqual(state, { status: "ready", catalog: null });
  }
});

test("product permission, not order management permission, controls access; denial stops other loaders", async () => {
  const context = setup(fixture(), false);
  const response = await handleMerchantCatalogPublicPost(request({ siteId, viewport: "desktop", blockIds }), context.dependencies);
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "product_catalog_disabled" });
  assert.deepEqual(context.calls, { snapshot: 1, catalog: 0, published: 0 });
});

for (const failingLoader of ["loadSnapshotSite", "loadCatalog", "fetchPublishedBlocks"] as const) {
  test(`shared ${failingLoader} failure remains 503, including absent catalog`, async () => {
    const context = setup(null);
    context.dependencies[failingLoader] = async () => { throw new Error("unavailable"); };
    const response = await handleMerchantCatalogPublicPost(request({ siteId, viewport: "desktop", blockIds }), context.dependencies);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: "order_catalog_unavailable" });
  });
}

test("no successful scope discloses no shared metadata/products/categories", async () => {
  const response = await handleMerchantCatalogPublicPost(request({ siteId, viewport: "desktop", blockIds: ["unpublished", "wrong-viewport", "legacy"] }), setup().dependencies);
  const wire = await response.json();
  assert.equal(wire.catalog, null);
  assert.equal(JSON.stringify(wire).includes("unpublished-only"), false);
});

test("nested publication viewport and ambiguous collections retain GET failure precedence", async () => {
  const catalog = fixture();
  catalog.collections.push({ id: "two-ambiguous-shared", blockId: "two", viewport: "shared", productIds: ["b"] });
  const context = setup(catalog);
  context.dependencies.fetchPublishedBlocks = async () => ({
    blocks: [{
      id: "wrapper", type: "contact", props: {},
      pagePlanConfig: { plans: [{ pages: [{ blocks: [{ id: "one", type: "product", props: {} }] }] }] },
      pagePlanConfigMobile: { plans: [{ pages: [{ blocks: [{ id: "empty", type: "product", props: {} }] }] }] },
    }],
  } as never);
  for (const viewport of ["desktop", "mobile"] as const) {
    const requested = ["one", "two", "empty", "wrong-viewport", "legacy"];
    const response = await handleMerchantCatalogPublicPost(request({ siteId, viewport, blockIds: requested }), context.dependencies);
    const wire = await response.json() as PublicCatalogBatchResponse;
    const decoded = decodePublicCatalogBatch(wire, { siteId, viewport, blockIds: requested });
    for (const blockId of requested) {
      const single = await handleMerchantCatalogPublicGet(new Request(`${url}?siteId=${siteId}&viewport=${viewport}&blockId=${blockId}`), context.dependencies);
      const old = await single.json();
      if (single.ok) assert.deepEqual(decoded.get(blockId), { status: "ready", catalog: old.catalog });
      else assert.deepEqual(wire.results.find((entry) => entry.blockId === blockId), { blockId, status: "error", error: old.error, statusCode: single.status });
    }
    assert.deepEqual(wire.results.find((entry) => entry.blockId === "two"), { blockId: "two", status: "error", error: "merchant_catalog_scope_unavailable", statusCode: 409 });
  }
});

const invalidBodies = [
  null, [], {}, { siteId: "wrong", viewport: "desktop", blockIds: ["one"] },
  { siteId, viewport: "shared", blockIds: ["one"] },
  ...[[], Array(33).fill("one"), [""], [" "] , ["x".repeat(201)], [null], ["one", 3], "one"]
    .map((ids) => ({ siteId, viewport: "desktop", blockIds: ids })),
];
for (const [index, body] of invalidBodies.entries()) {
  test(`invalid batch body ${index + 1} is rejected before any loader`, async () => {
    const context = setup();
    const response = await handleMerchantCatalogPublicPost(request(body), context.dependencies);
    assert.equal(response.status, 400);
    assert.deepEqual(context.calls, { snapshot: 0, catalog: 0, published: 0 });
    assert.equal(response.headers.get("cache-control"), "no-store, max-age=0");
  });
}

test("32 IDs are accepted before dedup, trimming matches GET, and a 200-character ID stays valid", async () => {
  const context = setup();
  const ids = [...Array(30).fill(" one "), "two", "x".repeat(200)];
  const response = await handleMerchantCatalogPublicPost(request({ siteId: ` ${siteId} `, viewport: " desktop ", blockIds: ids }), context.dependencies);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).results.map((entry: { blockId: string }) => entry.blockId), ["one", "two", "x".repeat(200)]);
  assert.deepEqual(context.calls, { snapshot: 1, catalog: 1, published: 1 });
});

test("streamed body limit is enforced without content-length and cancels at the boundary", async () => {
  const context = setup();
  let cancelled = false;
  const oversized = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(MAX_PUBLIC_CATALOG_BATCH_BODY_BYTES));
      controller.enqueue(new Uint8Array(1));
    },
    cancel() { cancelled = true; },
  });
  const req = new Request(url, { method: "POST", body: oversized, duplex: "half" } as RequestInit);
  const response = await handleMerchantCatalogPublicPost(req, context.dependencies);
  assert.equal(response.status, 413);
  assert.equal(cancelled, true);
  assert.deepEqual(context.calls, { snapshot: 0, catalog: 0, published: 0 });
});

test("body limit counts bytes rather than characters and rejects forged small content-length", async () => {
  const context = setup();
  const req = new Request(url, {
    method: "POST", headers: { "Content-Length": "1" },
    body: JSON.stringify({ siteId, viewport: "desktop", blockIds: ["one"], padding: "界".repeat(23000) }),
  });
  const response = await handleMerchantCatalogPublicPost(req, context.dependencies);
  assert.equal(response.status, 413);
  assert.deepEqual(context.calls, { snapshot: 0, catalog: 0, published: 0 });
});

test("exact byte boundary succeeds and one byte over fails; malformed JSON/UTF-8 fail closed", async () => {
  const body = JSON.stringify({ siteId, viewport: "desktop", blockIds: ["one"] });
  const boundary = body.padEnd(MAX_PUBLIC_CATALOG_BATCH_BODY_BYTES, " ");
  assert.equal((await handleMerchantCatalogPublicPost(new Request(url, { method: "POST", body: boundary }), setup().dependencies)).status, 200);
  assert.equal((await handleMerchantCatalogPublicPost(new Request(url, { method: "POST", body: boundary + " " }), setup().dependencies)).status, 413);
  for (const invalid of ["{", "", new Uint8Array([0xff])]) {
    const context = setup();
    const response = await handleMerchantCatalogPublicPost(new Request(url, { method: "POST", body: invalid }), context.dependencies);
    assert.equal(response.status, 400);
    assert.deepEqual(context.calls, { snapshot: 0, catalog: 0, published: 0 });
  }
});

test("twenty overlapping blocks share loader calls and wire products without changing reconstructed GET payloads", async () => {
  const catalog = fixture();
  catalog.products = Array.from({ length: 200 }, (_, index) => ({
    ...catalog.products[0], id: `product-${index}`, code: `SKU-${index}`, name: `Product ${index}`,
    description: "Repeated descriptive information belongs in the response snapshot only once.",
  }));
  const requested = Array.from({ length: 20 }, (_, index) => `block-${index}`);
  const ids = catalog.products.map((product) => product.id);
  catalog.categories = [{ id: "all", name: "All", productIds: ids }];
  catalog.collections = requested.map((blockId) => ({ id: blockId, blockId, viewport: "shared", productIds: ids }));
  const batch = setup(catalog);
  const originalPublished = batch.dependencies.fetchPublishedBlocks!;
  batch.dependencies.fetchPublishedBlocks = async (...args) => {
    await originalPublished(...args);
    return { blocks: requested.map((id): Block => ({ id, type: "product", props: {} })) } as never;
  };
  const response = await handleMerchantCatalogPublicPost(request({ siteId, viewport: "desktop", blockIds: requested }), batch.dependencies);
  const wire = await response.json() as PublicCatalogBatchResponse;
  assert.deepEqual(batch.calls, { snapshot: 1, catalog: 1, published: 1 });
  assert.equal(wire.catalog?.products.length, 200);
  const decoded = decodePublicCatalogBatch(wire, { siteId, viewport: "desktop", blockIds: requested });
  let originalBytes = 0;
  for (const blockId of requested) {
    const oldResponse = await handleMerchantCatalogPublicGet(new Request(`${url}?siteId=${siteId}&viewport=desktop&blockId=${blockId}`), batch.dependencies);
    const oldBody = await oldResponse.json();
    originalBytes += new TextEncoder().encode(JSON.stringify(oldBody)).byteLength;
    assert.deepEqual(decoded.get(blockId), { status: "ready", catalog: oldBody.catalog });
  }
  assert.deepEqual(batch.calls, { snapshot: 21, catalog: 21, published: 21 });
  const batchBytes = new TextEncoder().encode(JSON.stringify(wire)).byteLength;
  // A deterministic high-overlap fixture, not a general production latency claim.
  assert.ok(batchBytes < originalBytes * 0.35, `${batchBytes} batch bytes versus ${originalBytes} single-request bytes`);
});
