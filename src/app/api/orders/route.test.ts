import assert from "node:assert/strict";
import test from "node:test";
import {
  handleMerchantOrderPatch,
  handleMerchantOrderPost,
  handleMerchantOrdersGet,
  type MerchantOrderPatchRouteDependencies,
  type MerchantOrderPostRouteDependencies,
} from "@/app/api/orders/route";
import type { Block } from "@/data/homeBlocks";
import type { MerchantCatalog } from "@/lib/merchantCatalog";
import { createMerchantOrder, type MerchantOrderCreateInput } from "@/lib/merchantOrders";

const SITE_ID = "10000000";
const BLOCK_ID = "product-block";
const PRODUCT_ID = "product-a";
const CATALOG_CHANGED_MESSAGE = "商品目录已更新，请刷新商品列表并确认最新价格后重新提交。";

function assertPrivateOrderGetHeaders(response: Response) {
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("pragma"), "no-cache");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("cross-origin-resource-policy"), "same-origin");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.match(response.headers.get("content-type") ?? "", /^application\/json\b/i);
}

type SnapshotSite = NonNullable<
  Awaited<ReturnType<MerchantOrderPostRouteDependencies["loadSnapshotSite"]>>
>;
type PublishedSite = NonNullable<
  Awaited<ReturnType<MerchantOrderPostRouteDependencies["loadPublishedSite"]>>
>;

type Scenario = {
  snapshots: [SnapshotSite | null, SnapshotSite | null];
  catalogs: [MerchantCatalog | null, MerchantCatalog | null];
  publishedSites: [PublishedSite | null, PublishedSite | null];
};

function snapshotSite(enabled = true): SnapshotSite {
  return {
    id: SITE_ID,
    merchantName: "Fresh Quote Merchant",
    name: "Fresh Quote Merchant",
    permissionConfig: {
      allowProductBlock: enabled,
      allowOrderManagement: enabled,
    },
  } as SnapshotSite;
}

function productBlock(price = "10.00"): Extract<Block, { type: "product" }> {
  return {
    id: BLOCK_ID,
    type: "product",
    props: {
      productPricePrefix: "€",
      products: [
        {
          id: PRODUCT_ID,
          code: "SKU-001",
          name: "Published product",
          description: "Published description",
          price,
          imageUrl: "https://example.com/published.jpg",
          thumbnailUrl: "",
          tag: "Drinks",
        },
      ],
    },
  };
}

function publishedSite(price = "10.00"): PublishedSite {
  return {
    siteId: SITE_ID,
    slug: "fresh-quote-merchant",
    blocks: [productBlock(price)],
    orderManagementEnabled: true,
  };
}

function operatingCatalog(
  revision = 3,
  options: { bound?: boolean; price?: string } = {},
): MerchantCatalog {
  const bound = options.bound ?? true;
  return {
    revision,
    updatedAt: `2026-08-17T10:0${revision}:00.000Z`,
    pricePrefix: "€",
    categories: [],
    products: [
      {
        id: PRODUCT_ID,
        code: "OPS-001",
        name: "Workbench product",
        description: "Operating description",
        price: options.price ?? "12.50",
        imageUrl: "https://example.com/operating.jpg",
        thumbnailUrl: "",
        tag: "Drinks",
        availability: "available",
      },
    ],
    collections: bound
      ? [
          {
            id: "desktop-collection",
            blockId: BLOCK_ID,
            viewport: "desktop",
            productIds: [PRODUCT_ID],
          },
        ]
      : [],
  };
}

function orderRequest(input: { operating?: boolean } = {}) {
  return new Request("https://merchant.faolla.test/api/orders", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      host: "merchant.faolla.test",
      origin: "https://merchant.faolla.test",
    },
    body: JSON.stringify({
      siteId: SITE_ID,
      blockId: BLOCK_ID,
      clientRequestId: "fresh-quote-sequence",
      catalogViewport: "desktop",
      ...(input.operating ? { catalogRevision: 3 } : {}),
      customer: {
        name: "Customer",
        email: "customer@example.com",
      },
      items: [{ productId: PRODUCT_ID, quantity: 2 }],
    }),
  });
}

function orderPatchRequest(body: Record<string, unknown>) {
  return new Request("https://merchant.faolla.test/api/orders", {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      host: "merchant.faolla.test",
      origin: "https://merchant.faolla.test",
    },
    body: JSON.stringify(body),
  });
}

function orderPatchDependencies(
  updateOrder: MerchantOrderPatchRouteDependencies["updateOrder"],
): Partial<MerchantOrderPatchRouteDependencies> {
  return {
    async resolveAdminSession(_request, siteId) {
      assert.equal(siteId, SITE_ID);
      return { merchantId: SITE_ID };
    },
    async isManagementEnabled(siteId) {
      assert.equal(siteId, SITE_ID);
      return true;
    },
    updateOrder,
  };
}

function scenarioDependencies(scenario: Scenario) {
  const calls = {
    snapshots: 0,
    catalogs: 0,
    publishedSites: 0,
    personalSessions: 0,
    createOrders: 0,
    notifications: 0,
    events: [] as string[],
  };
  const createdInputs: MerchantOrderCreateInput[] = [];

  const dependencies: MerchantOrderPostRouteDependencies = {
    async loadSnapshotSite(siteId) {
      assert.equal(siteId, SITE_ID);
      const index = calls.snapshots++;
      calls.events.push(`snapshot:${index}`);
      return scenario.snapshots[index] ?? null;
    },
    async loadOperatingCatalog(siteId) {
      assert.equal(siteId, SITE_ID);
      const index = calls.catalogs++;
      calls.events.push(`catalog:${index}`);
      return scenario.catalogs[index] ?? null;
    },
    async loadPublishedSite(siteId, options) {
      assert.equal(siteId, SITE_ID);
      assert.deepEqual(options, { fresh: true });
      const index = calls.publishedSites++;
      calls.events.push(`published:${index}`);
      return scenario.publishedSites[index] ?? null;
    },
    async resolvePersonalSession() {
      calls.personalSessions += 1;
      calls.events.push("personal-session");
      return null;
    },
    async createOrder(input) {
      calls.createOrders += 1;
      calls.events.push("create-order");
      createdInputs.push(structuredClone(input));
      return createMerchantOrder(input, {
        id: "O10000000202608170001",
        createdAt: "2026-08-17T12:00:00.000Z",
        updatedAt: "2026-08-17T12:00:00.000Z",
      });
    },
    async notifyOrderCreated(siteId, order) {
      assert.equal(siteId, SITE_ID);
      assert.equal(order.id, "O10000000202608170001");
      calls.notifications += 1;
      calls.events.push("notify-order");
    },
  };

  return { dependencies, calls, createdInputs };
}

async function assertFreshCatalogRejected(
  response: Response,
  harness: ReturnType<typeof scenarioDependencies>,
) {
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    error: "order_create_failed",
    message: CATALOG_CHANGED_MESSAGE,
  });
  assert.equal(harness.calls.snapshots, 2);
  assert.equal(harness.calls.catalogs, 2);
  assert.equal(harness.calls.publishedSites, 2);
  assert.equal(harness.calls.personalSessions, 1);
  assert.equal(harness.calls.createOrders, 0);
  assert.equal(harness.calls.notifications, 0);
  assert.deepEqual(harness.createdInputs, []);
  assert.deepEqual(harness.calls.events, [
    "snapshot:0",
    "catalog:0",
    "published:0",
    "personal-session",
    "snapshot:1",
    "catalog:1",
    "published:1",
  ]);
}

test("POST rejects when the operating catalog revision changes during customer resolution", async () => {
  const harness = scenarioDependencies({
    snapshots: [snapshotSite(), snapshotSite()],
    catalogs: [operatingCatalog(3), operatingCatalog(4)],
    publishedSites: [publishedSite(), publishedSite()],
  });

  const response = await handleMerchantOrderPost(
    orderRequest({ operating: true }),
    harness.dependencies,
  );

  await assertFreshCatalogRejected(response, harness);
});

test("POST rejects when an operating collection is unbound before persistence", async () => {
  const harness = scenarioDependencies({
    snapshots: [snapshotSite(), snapshotSite()],
    catalogs: [operatingCatalog(3), operatingCatalog(3, { bound: false })],
    publishedSites: [publishedSite(), publishedSite()],
  });

  const response = await handleMerchantOrderPost(
    orderRequest({ operating: true }),
    harness.dependencies,
  );

  await assertFreshCatalogRejected(response, harness);
});

test("POST rejects a legacy quote when the block migrates to the operating catalog", async () => {
  const harness = scenarioDependencies({
    snapshots: [snapshotSite(), snapshotSite()],
    catalogs: [null, operatingCatalog(1)],
    publishedSites: [publishedSite(), publishedSite()],
  });

  const response = await handleMerchantOrderPost(orderRequest(), harness.dependencies);

  await assertFreshCatalogRejected(response, harness);
});

test("POST rejects when the fresh published quote changes before persistence", async () => {
  const harness = scenarioDependencies({
    snapshots: [snapshotSite(), snapshotSite()],
    catalogs: [null, null],
    publishedSites: [publishedSite("10.00"), publishedSite("11.00")],
  });

  const response = await handleMerchantOrderPost(orderRequest(), harness.dependencies);

  await assertFreshCatalogRejected(response, harness);
});

test("POST rechecks entitlement and rejects when order permission is revoked", async () => {
  const harness = scenarioDependencies({
    snapshots: [snapshotSite(), snapshotSite(false)],
    catalogs: [operatingCatalog(3), operatingCatalog(3)],
    publishedSites: [publishedSite(), publishedSite()],
  });

  const response = await handleMerchantOrderPost(
    orderRequest({ operating: true }),
    harness.dependencies,
  );

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), {
    error: "order_create_failed",
    message: "当前商户未启用订单管理功能，暂时无法查看或提交订单。",
  });
  assert.equal(harness.calls.snapshots, 2);
  assert.equal(harness.calls.catalogs, 2);
  assert.equal(harness.calls.publishedSites, 2);
  assert.equal(harness.calls.personalSessions, 1);
  assert.equal(harness.calls.createOrders, 0);
  assert.equal(harness.calls.notifications, 0);
  assert.deepEqual(harness.calls.events, [
    "snapshot:0",
    "catalog:0",
    "published:0",
    "personal-session",
    "snapshot:1",
    "catalog:1",
    "published:1",
  ]);
});

test("POST persists exactly once when both fresh snapshots are unchanged", async () => {
  const catalog = operatingCatalog(3);
  const published = publishedSite();
  const harness = scenarioDependencies({
    snapshots: [snapshotSite(), snapshotSite()],
    catalogs: [catalog, structuredClone(catalog)],
    publishedSites: [published, structuredClone(published)],
  });

  const response = await handleMerchantOrderPost(
    orderRequest({ operating: true }),
    harness.dependencies,
  );
  const payload = (await response.json()) as {
    ok?: boolean;
    order?: { id?: string; items?: Array<{ name?: string; unitPrice?: number }> };
  };

  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.order?.id, "O10000000202608170001");
  assert.equal(payload.order?.items?.[0]?.name, "Workbench product");
  assert.equal(payload.order?.items?.[0]?.unitPrice, 12.5);
  assert.equal(harness.calls.snapshots, 2);
  assert.equal(harness.calls.catalogs, 2);
  assert.equal(harness.calls.publishedSites, 2);
  assert.equal(harness.calls.personalSessions, 1);
  assert.equal(harness.calls.createOrders, 1);
  assert.equal(harness.calls.notifications, 1);
  assert.equal(harness.createdInputs.length, 1);
  assert.equal(harness.createdInputs[0]?.pricePrefix, "€");
  assert.equal(harness.createdInputs[0]?.items?.[0]?.name, "Workbench product");
  assert.equal(harness.createdInputs[0]?.items?.[0]?.unitPrice, 12.5);
  assert.deepEqual(harness.calls.events, [
    "snapshot:0",
    "catalog:0",
    "published:0",
    "personal-session",
    "snapshot:1",
    "catalog:1",
    "published:1",
    "create-order",
    "notify-order",
  ]);
});

test("GET rejects an admin order read when order management is disabled", async () => {
  let listCalls = 0;
  const response = await handleMerchantOrdersGet(
    new Request(`https://merchant.faolla.test/api/orders?siteId=${SITE_ID}`),
    {
      async resolveAdminSession(_request, siteId) {
        assert.equal(siteId, SITE_ID);
        return { merchantId: SITE_ID };
      },
      async isManagementEnabled(siteId) {
        assert.equal(siteId, SITE_ID);
        return false;
      },
      async listOrders() {
        listCalls += 1;
        return [];
      },
    },
  );

  assert.equal(response.status, 403);
  assertPrivateOrderGetHeaders(response);
  assert.deepEqual(await response.json(), { error: "order_management_disabled" });
  assert.equal(listCalls, 0);
});

test("GET marks successful admin order data as private and non-cacheable", async () => {
  let listCalls = 0;
  const response = await handleMerchantOrdersGet(
    new Request(`https://merchant.faolla.test/api/orders?siteId=${SITE_ID}`),
    {
      async resolveAdminSession(_request, siteId) {
        assert.equal(siteId, SITE_ID);
        return { merchantId: SITE_ID };
      },
      async isManagementEnabled(siteId) {
        assert.equal(siteId, SITE_ID);
        return true;
      },
      async listOrders(siteId) {
        assert.equal(siteId, SITE_ID);
        listCalls += 1;
        return [];
      },
    },
  );

  assert.equal(response.status, 200);
  assertPrivateOrderGetHeaders(response);
  assert.deepEqual(await response.json(), { ok: true, orders: [] });
  assert.equal(listCalls, 1);
});

test("GET applies private headers to unauthenticated personal reads", async () => {
  let personalListCalls = 0;
  const response = await handleMerchantOrdersGet(
    new Request("https://merchant.faolla.test/api/orders?scope=personal"),
    {
      async resolvePersonalSession() {
        return null;
      },
      async listPersonalOrders() {
        personalListCalls += 1;
        return [];
      },
    },
  );

  assert.equal(response.status, 401);
  assertPrivateOrderGetHeaders(response);
  assert.deepEqual(await response.json(), { error: "unauthorized" });
  assert.equal(personalListCalls, 0);
});

test("GET applies private headers to unexpected read failures", async () => {
  const response = await handleMerchantOrdersGet(
    new Request(`https://merchant.faolla.test/api/orders?siteId=${SITE_ID}`),
    {
      async resolveAdminSession() {
        throw new Error("orders_store_unavailable");
      },
    },
  );

  assert.equal(response.status, 503);
  assertPrivateOrderGetHeaders(response);
  assert.deepEqual(await response.json(), {
    error: "order_list_failed",
    message: "订单服务暂时不可用，请稍后重试。",
  });
});

test("PATCH forwards expectedUpdatedAt for both status and print mutations", async () => {
  const expectedUpdatedAt = "2026-08-17T12:00:00.000Z";
  const order = createMerchantOrder(
    {
      siteId: SITE_ID,
      items: [{ productId: PRODUCT_ID, name: "Product", quantity: 1, unitPrice: 10 }],
    },
    {
      id: "O10000000202608170001",
      createdAt: expectedUpdatedAt,
      updatedAt: expectedUpdatedAt,
    },
  );
  type UpdateInput = Parameters<MerchantOrderPatchRouteDependencies["updateOrder"]>[0];
  const received: UpdateInput[] = [];
  const dependencies = orderPatchDependencies(async (input) => {
    received.push(input);
    return order;
  });

  const statusResponse = await handleMerchantOrderPatch(
    orderPatchRequest({
      siteId: SITE_ID,
      orderId: order.id,
      status: "confirmed",
      expectedUpdatedAt,
    }),
    dependencies,
  );
  const printResponse = await handleMerchantOrderPatch(
    orderPatchRequest({
      siteId: SITE_ID,
      orderId: order.id,
      action: "print",
      expectedUpdatedAt,
    }),
    dependencies,
  );

  assert.equal(statusResponse.status, 200);
  assert.equal(printResponse.status, 200);
  assert.equal(received.length, 2);
  assert.equal(received[0]?.status, "confirmed");
  assert.equal(received[0]?.expectedUpdatedAt, expectedUpdatedAt);
  assert.equal(received[1]?.action, "print");
  assert.equal(received[1]?.expectedUpdatedAt, expectedUpdatedAt);
});

test("PATCH exposes a stable 409 response for stale order versions", async () => {
  const response = await handleMerchantOrderPatch(
    orderPatchRequest({
      siteId: SITE_ID,
      orderId: "O10000000202608170001",
      status: "confirmed",
      expectedUpdatedAt: "2026-08-17T11:59:59.000Z",
    }),
    orderPatchDependencies(async () => {
      throw new Error("order_update_conflict");
    }),
  );

  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    error: "order_update_conflict",
    message: "订单已被其他操作更新，请刷新后重试。",
  });
});

test("PATCH rejects expectedUpdatedAt on batch mutations", async () => {
  const order = createMerchantOrder({
    siteId: SITE_ID,
    items: [{ productId: PRODUCT_ID, name: "Product", quantity: 1, unitPrice: 10 }],
  });
  let batchCalls = 0;
  const response = await handleMerchantOrderPatch(
    orderPatchRequest({
      siteId: SITE_ID,
      orderIds: [order.id],
      status: "confirmed",
      expectedUpdatedAt: order.updatedAt,
    }),
    {
      ...orderPatchDependencies(async () => order),
      async updateOrdersBatch() {
        batchCalls += 1;
        return [];
      },
    },
  );

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "invalid_order_action" });
  assert.equal(batchCalls, 0);
});
