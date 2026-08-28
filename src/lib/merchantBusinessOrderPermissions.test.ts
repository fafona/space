import assert from "node:assert/strict";
import test from "node:test";
import {
  getMerchantOrderMutationRequiredPermissions,
  redactMerchantOrderForBusinessActor,
  redactMerchantOrderWorkbenchForBusinessActor,
} from "@/lib/merchantBusinessOrderPermissions";
import type { MerchantOrderRecord } from "@/lib/merchantOrders";

test("order mutation permissions are derived from every requested operation", () => {
  assert.deepEqual(
    getMerchantOrderMutationRequiredPermissions({ action: "confirm" }),
    ["orders.status.manage"],
  );
  assert.deepEqual(
    getMerchantOrderMutationRequiredPermissions({ action: "complete" }),
    ["orders.complete"],
  );
  assert.deepEqual(
    getMerchantOrderMutationRequiredPermissions({ action: "print" }),
    ["orders.print"],
  );
  assert.deepEqual(
    getMerchantOrderMutationRequiredPermissions({ action: "touch" }),
    ["orders.view"],
  );
  assert.deepEqual(
    getMerchantOrderMutationRequiredPermissions({
      status: "cancelled",
      items: [],
    }),
    ["orders.items.update", "orders.status.manage"],
  );
  assert.deepEqual(
    getMerchantOrderMutationRequiredPermissions({ status: "completed" }),
    ["orders.complete"],
  );
  assert.equal(
    getMerchantOrderMutationRequiredPermissions({
      action: "complete",
      status: "completed",
    }),
    null,
  );
  assert.equal(
    getMerchantOrderMutationRequiredPermissions({
      action: "confirm",
      items: [],
    }),
    null,
  );
  assert.equal(
    getMerchantOrderMutationRequiredPermissions({ status: "unknown" }),
    null,
  );
  assert.equal(
    getMerchantOrderMutationRequiredPermissions({ action: "unknown" }),
    null,
  );
  assert.equal(getMerchantOrderMutationRequiredPermissions({}), null);
});

test("order workbench projection removes todo customer data", () => {
  const dashboard = {
    generatedAt: "2026-08-28T00:00:00.000Z",
    timezoneOffsetMinutes: 0,
    thresholds: {
      confirmationOverdueMinutes: 15,
      processingOverdueMinutes: 120,
    },
    summary: {
      total: 1,
      pending: 1,
      confirmationOverdue: 0,
      processing: 0,
      processingOverdue: 0,
      completedToday: 0,
      cancelledToday: 0,
      customerNote: 1,
    },
    amounts: [],
    analytics: {
      dailyTrend: [],
      statusDistribution: {
        pending: 1,
        confirmed: 0,
        completed: 0,
        cancelled: 0,
      },
      recent30Days: {
        createdCount: 1,
        completedCount: 0,
        cancelledCount: 0,
      },
      topProducts: [],
      averageOrderAmounts: [],
    },
    todos: [
      {
        id: "customer_note:O1",
        orderId: "O1",
        kind: "customer_note" as const,
        status: "pending" as const,
        createdAt: "2026-08-28T00:00:00.000Z",
        updatedAt: "2026-08-28T00:00:00.000Z",
        ageMinutes: 0,
        customerName: "Private Customer",
        totalAmount: 10,
        pricePrefix: "€",
        note: "Private note",
      },
    ],
  };
  const redacted = redactMerchantOrderWorkbenchForBusinessActor(dashboard, {
    type: "employee",
    businessPermissions: ["orders.view", "orders.analytics.view"],
  });
  assert.equal(redacted.todos[0]?.customerName, "客户");
  assert.equal(redacted.todos[0]?.note, undefined);
  assert.equal(JSON.stringify(redacted).includes("Private"), false);
});

test("order projection removes every customer identifier without customer-data permission", () => {
  const order = {
    id: "O1",
    siteId: "10000000",
    siteName: "Site",
    blockId: "block",
    customerAccountId: "50010105",
    customerUserId: "auth-user",
    customerLoginEmail: "login@example.com",
    customerGuestHash: "secret-hash",
    createdAt: "2026-08-28T00:00:00.000Z",
    updatedAt: "2026-08-28T00:00:00.000Z",
    status: "pending",
    customer: {
      name: "Private Name",
      phone: "+34 600000000",
      email: "private@example.com",
      note: "private note",
    },
    items: [],
    totalQuantity: 0,
    totalAmount: 0,
    pricePrefix: "€",
    confirmedAt: null,
    completedAt: null,
    cancelledAt: null,
    printedAt: null,
    printCount: 0,
  } satisfies MerchantOrderRecord;
  const redacted = redactMerchantOrderForBusinessActor(order, {
    type: "employee",
    businessPermissions: ["orders.view"],
  });
  assert.notEqual(redacted, order);
  assert.deepEqual(redacted.customer, {
    name: "客户",
    phone: "",
    email: "",
    note: "",
  });
  assert.equal(redacted.customerAccountId, "");
  assert.equal(redacted.customerUserId, "");
  assert.equal(redacted.customerLoginEmail, "");
  assert.equal(redacted.customerGuestHash, "");
  assert.equal(redacted.id, order.id);
  assert.equal(redacted.totalAmount, order.totalAmount);

  assert.equal(
    redactMerchantOrderForBusinessActor(order, {
      type: "employee",
      businessPermissions: ["orders.view", "orders.customer_data.view"],
    }),
    order,
  );
});
