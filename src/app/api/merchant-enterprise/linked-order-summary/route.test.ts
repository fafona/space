import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMerchantLinkedOrderSummary,
  handleMerchantLinkedOrderSummaryGet,
  type MerchantLinkedOrderSummaryRouteDependencies,
} from "@/app/api/merchant-enterprise/linked-order-summary/route";
import type {
  MerchantEnterpriseActor,
  MerchantEnterprisePermission,
} from "@/lib/merchantEnterprise";
import { MerchantEnterpriseAccessError } from "@/lib/merchantEnterpriseAuth.server";
import type { MerchantEnterpriseStoreClient } from "@/lib/merchantEnterpriseStore.server";
import type { MerchantOrderRecord } from "@/lib/merchantOrders";

const SITE_ID = "10000000";
const TASK_ID = "11111111-1111-4111-8111-111111111111";
const EMPLOYEE_ID = "77777777-7777-4777-8777-777777777777";
const ORDER_ID = "O10000000202608010001";
const LINKED_ORDER_PERMISSION =
  "orders.linked.view" as MerchantEnterprisePermission;

function request(query = { siteId: SITE_ID, taskId: TASK_ID }) {
  const params = new URLSearchParams(query);
  return new Request(
    `https://www.faolla.com/api/merchant-enterprise/linked-order-summary?${params.toString()}`,
  );
}

function employeeActor(): MerchantEnterpriseActor {
  return {
    type: "employee",
    id: EMPLOYEE_ID,
    siteId: SITE_ID,
    displayName: "Assigned employee",
    email: "employee@example.com",
    roleId: "88888888-8888-4888-8888-888888888888",
    permissions: ["enterprise.view", "tasks.view", LINKED_ORDER_PERMISSION],
    accessScope: "restricted",
    allowedBoardIds: ["22222222-2222-4222-8222-222222222222"],
  };
}

function ownerActor(): MerchantEnterpriseActor {
  return {
    type: "owner",
    id: "99999999-9999-4999-8999-999999999999",
    siteId: SITE_ID,
    displayName: "Owner",
    email: "owner@example.com",
    permissions: [],
    accessScope: "all",
    allowedBoardIds: [],
  };
}

function privateOrder(overrides: Partial<MerchantOrderRecord> = {}): MerchantOrderRecord {
  return {
    id: ORDER_ID,
    siteId: SITE_ID,
    siteName: "Private merchant name",
    blockId: "private-block-id",
    clientRequestId: "private-client-request",
    customerAccountId: "private-account-id",
    customerUserId: "private-user-id",
    customerLoginEmail: "login-secret@example.com",
    customerGuestHash: "private-guest-hash",
    createdAt: "2026-08-01T10:00:00.000Z",
    updatedAt: "2026-08-01T10:05:00.000Z",
    merchantTouchedAt: "2026-08-01T10:05:00.000Z",
    status: "confirmed",
    customer: {
      name: "Private Customer",
      phone: "+34 600 000 000",
      email: "customer-secret@example.com",
      note: "Private delivery note",
    },
    items: [
      {
        productId: "private-product-id",
        code: "SKU-001",
        name: "Coffee beans",
        description: "1 kg · medium roast",
        imageUrl: "https://private.example/item.png",
        tag: "Private category",
        quantity: 2,
        unitPrice: 12,
        unitPriceText: "private formatted price",
        subtotal: 24,
      },
    ],
    totalQuantity: 2,
    totalAmount: 24,
    pricePrefix: "€",
    confirmedAt: "2026-08-01T10:05:00.000Z",
    completedAt: null,
    cancelledAt: null,
    printedAt: "2026-08-01T10:06:00.000Z",
    printCount: 3,
    ...overrides,
  };
}

function dependencies(
  overrides: Partial<MerchantLinkedOrderSummaryRouteDependencies> = {},
): MerchantLinkedOrderSummaryRouteDependencies {
  const store = {} as MerchantEnterpriseStoreClient;
  return {
    async resolveActor(_request, input) {
      assert.deepEqual(input, {
        siteId: SITE_ID,
        requiredPermission: "orders.linked.view",
      });
      return employeeActor();
    },
    async requireEnterpriseEntitlement(siteId) {
      assert.equal(siteId, SITE_ID);
      return {
        permissionConfig: {
          allowProductBlock: true,
          allowOrderManagement: true,
        },
      };
    },
    async authorizeSource(client, input) {
      assert.equal(client, store);
      assert.deepEqual(input, {
        siteId: SITE_ID,
        taskId: TASK_ID,
        employeeId: EMPLOYEE_ID,
      });
      return ORDER_ID;
    },
    async getOrder(siteId, orderId) {
      assert.deepEqual([siteId, orderId], [SITE_ID, ORDER_ID]);
      return privateOrder();
    },
    createStoreClient() {
      return store;
    },
    ...overrides,
  };
}

test("linked-order summary query accepts only one siteId and taskId", async () => {
  let authorizationCalls = 0;
  const invalidUrls = [
    "https://www.faolla.com/api/merchant-enterprise/linked-order-summary",
    `https://www.faolla.com/api/merchant-enterprise/linked-order-summary?siteId=${SITE_ID}`,
    `https://www.faolla.com/api/merchant-enterprise/linked-order-summary?taskId=${TASK_ID}`,
    `https://www.faolla.com/api/merchant-enterprise/linked-order-summary?siteId=${SITE_ID}&siteId=${SITE_ID}&taskId=${TASK_ID}`,
    `https://www.faolla.com/api/merchant-enterprise/linked-order-summary?siteId=${SITE_ID}&taskId=${TASK_ID}&taskId=${TASK_ID}`,
    `https://www.faolla.com/api/merchant-enterprise/linked-order-summary?siteId=${SITE_ID}&taskId=${TASK_ID}&orderId=${ORDER_ID}`,
    `https://www.faolla.com/api/merchant-enterprise/linked-order-summary?siteId=${SITE_ID}&taskId=${TASK_ID}&extra=1`,
    `https://www.faolla.com/api/merchant-enterprise/linked-order-summary?siteId=not-a-site&taskId=${TASK_ID}`,
    `https://www.faolla.com/api/merchant-enterprise/linked-order-summary?siteId=${SITE_ID}&taskId=not-a-task`,
    `https://www.faolla.com/api/merchant-enterprise/linked-order-summary?siteId=%20${SITE_ID}%20&taskId=${TASK_ID}`,
  ];

  for (const url of invalidUrls) {
    const response = await handleMerchantLinkedOrderSummaryGet(new Request(url), {
      async resolveActor() {
        authorizationCalls += 1;
        return employeeActor();
      },
    });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      ok: false,
      error: "invalid_linked_order_summary_request",
    });
    assert.equal(response.headers.get("cache-control"), "private, no-store");
  }
  assert.equal(authorizationCalls, 0);
});

test("linked-order summary requires employee permission before downstream reads", async () => {
  let downstreamCalls = 0;
  const response = await handleMerchantLinkedOrderSummaryGet(
    request(),
    dependencies({
      async resolveActor(_request, input) {
        assert.equal(input.requiredPermission, "orders.linked.view");
        throw new MerchantEnterpriseAccessError("permission_denied", 403);
      },
      async requireEnterpriseEntitlement() {
        downstreamCalls += 1;
        return null;
      },
      createStoreClient() {
        downstreamCalls += 1;
        return {} as MerchantEnterpriseStoreClient;
      },
      async authorizeSource() {
        downstreamCalls += 1;
        return ORDER_ID;
      },
      async getOrder() {
        downstreamCalls += 1;
        return privateOrder();
      },
    }),
  );

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { ok: false, error: "permission_denied" });
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(downstreamCalls, 0);
});

test("linked-order summary is employee-only while owners keep the full-order route", async () => {
  let downstreamCalls = 0;
  const response = await handleMerchantLinkedOrderSummaryGet(
    request(),
    dependencies({
      async resolveActor() {
        return ownerActor();
      },
      async requireEnterpriseEntitlement() {
        downstreamCalls += 1;
        return null;
      },
      createStoreClient() {
        downstreamCalls += 1;
        return {} as MerchantEnterpriseStoreClient;
      },
    }),
  );

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { ok: false, error: "permission_denied" });
  assert.equal(downstreamCalls, 0);
});

test("linked-order summary requires both authoritative order entitlements", async () => {
  let authorizationCalls = 0;
  let orderReads = 0;
  for (const permissionConfig of [
    { allowProductBlock: false, allowOrderManagement: true },
    { allowProductBlock: true, allowOrderManagement: false },
  ]) {
    const response = await handleMerchantLinkedOrderSummaryGet(
      request(),
      dependencies({
        async requireEnterpriseEntitlement() {
          return { permissionConfig };
        },
        async authorizeSource() {
          authorizationCalls += 1;
          return ORDER_ID;
        },
        async getOrder() {
          orderReads += 1;
          return privateOrder();
        },
      }),
    );
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), {
      ok: false,
      error: "order_management_disabled",
    });
  }
  assert.equal(authorizationCalls, 0);
  assert.equal(orderReads, 0);
});

test("invisible linked tasks are one 404 and never trigger an order read", async () => {
  let orderReads = 0;
  const response = await handleMerchantLinkedOrderSummaryGet(
    request(),
    dependencies({
      async authorizeSource() {
        throw new Error("task_not_found");
      },
      async getOrder() {
        orderReads += 1;
        return privateOrder();
      },
    }),
  );

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { ok: false, error: "task_not_found" });
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(orderReads, 0);
});

test("linked-order summary reads the RPC-derived exact order and returns only whitelisted fields", async () => {
  const calls: Array<{ operation: string; values: unknown[] }> = [];
  const response = await handleMerchantLinkedOrderSummaryGet(
    request(),
    dependencies({
      async authorizeSource(_client, input) {
        calls.push({ operation: "authorizeSource", values: [input] });
        return ORDER_ID;
      },
      async getOrder(siteId, orderId) {
        calls.push({ operation: "getOrder", values: [siteId, orderId] });
        return privateOrder();
      },
    }),
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  const payload = (await response.json()) as {
    ok: boolean;
    summary: ReturnType<typeof buildMerchantLinkedOrderSummary>;
  };
  assert.deepEqual(payload, {
    ok: true,
    summary: {
      id: ORDER_ID,
      status: "confirmed",
      createdAt: "2026-08-01T10:00:00.000Z",
      items: [
        {
          name: "Coffee beans",
          code: "SKU-001",
          specification: "1 kg · medium roast",
          quantity: 2,
          unitPrice: 12,
          subtotal: 24,
        },
      ],
      totalQuantity: 2,
      totalAmount: 24,
      pricePrefix: "€",
    },
  });
  assert.deepEqual(calls, [
    {
      operation: "authorizeSource",
      values: [
        {
          siteId: SITE_ID,
          taskId: TASK_ID,
          employeeId: EMPLOYEE_ID,
        },
      ],
    },
    { operation: "getOrder", values: [SITE_ID, ORDER_ID] },
  ]);

  const serialized = JSON.stringify(payload);
  for (const secret of [
    "Private Customer",
    "+34 600 000 000",
    "customer-secret@example.com",
    "Private delivery note",
    "login-secret@example.com",
    "private-account-id",
    "private-user-id",
    "private-guest-hash",
    "private-client-request",
    "private-block-id",
    "private-product-id",
    "https://private.example/item.png",
    "Private category",
    "private formatted price",
    "printCount",
    "printedAt",
  ]) {
    assert.equal(serialized.includes(secret), false, `response leaked ${secret}`);
  }
  assert.deepEqual(Object.keys(payload.summary), [
    "id",
    "status",
    "createdAt",
    "items",
    "totalQuantity",
    "totalAmount",
    "pricePrefix",
  ]);
  assert.deepEqual(Object.keys(payload.summary.items[0] ?? {}), [
    "name",
    "code",
    "specification",
    "quantity",
    "unitPrice",
    "subtotal",
  ]);
});

test("linked-order summary fails closed for a missing or cross-tenant derived order", async () => {
  const candidates: Array<MerchantOrderRecord | null> = [
    null,
    privateOrder({ siteId: "20000000" }),
    privateOrder({ id: "O20000000202608010001" }),
  ];
  for (const candidate of candidates) {
    const response = await handleMerchantLinkedOrderSummaryGet(
      request(),
      dependencies({
        async getOrder() {
          return candidate;
        },
      }),
    );
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { ok: false, error: "order_not_found" });
    assert.equal(response.headers.get("cache-control"), "private, no-store");
  }
});
