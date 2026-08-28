import assert from "node:assert/strict";
import test from "node:test";

import {
  MERCHANT_ORDER_OWNER_CACHE_POLICY,
  canOpenMerchantOrderWorkbenchView,
  canRunMerchantOrderAction,
  canRunMerchantOrderStatusTransition,
  createMerchantOrderApiRequest,
  getMerchantOrderActionPermission,
  isMerchantOrderEmployeeFrontend,
  resolveMerchantOrderWorkbenchView,
} from "@/lib/merchantOrderFrontendAccess";

test("owner defaults retain the existing persistent cache and full order UI", () => {
  assert.equal(MERCHANT_ORDER_OWNER_CACHE_POLICY.allowPersistentRead, true);
  assert.equal(MERCHANT_ORDER_OWNER_CACHE_POLICY.allowPersistentWrite, true);
  assert.equal(MERCHANT_ORDER_OWNER_CACHE_POLICY.allowStaleOnError, true);
  assert.equal(canRunMerchantOrderAction(undefined, "complete"), true);
  assert.equal(canOpenMerchantOrderWorkbenchView(undefined, "catalog"), true);
});

test("order actions are mapped to their semantic permissions", () => {
  assert.equal(getMerchantOrderActionPermission("complete"), "orders.complete");
  assert.equal(getMerchantOrderActionPermission("uncomplete"), "orders.complete");
  assert.equal(getMerchantOrderActionPermission("print"), "orders.print");
  assert.equal(getMerchantOrderActionPermission("touch"), "orders.view");
  assert.equal(getMerchantOrderActionPermission("confirm"), "orders.status.manage");

  assert.equal(canRunMerchantOrderAction(["orders.status.manage"], "confirm"), true);
  assert.equal(canRunMerchantOrderAction(["orders.status.manage"], "complete"), false);
  assert.equal(canRunMerchantOrderAction(["orders.complete"], "uncomplete"), true);
});

test("completed transitions cannot be authorized by ordinary status management", () => {
  assert.equal(
    canRunMerchantOrderStatusTransition(
      ["orders.status.manage"],
      "confirmed",
      "completed",
    ),
    false,
  );
  assert.equal(
    canRunMerchantOrderStatusTransition(
      ["orders.complete"],
      "completed",
      "confirmed",
    ),
    true,
  );
  assert.equal(
    canRunMerchantOrderStatusTransition(
      ["orders.status.manage"],
      "pending",
      "confirmed",
    ),
    true,
  );
});

test("employee workbench navigation follows granular permissions including catalog view", () => {
  const permissions = [
    "orders.view",
    "orders.analytics.view",
    "orders.catalog.view",
  ] as const;
  assert.equal(canOpenMerchantOrderWorkbenchView(permissions, "orders"), true);
  assert.equal(canOpenMerchantOrderWorkbenchView(permissions, "analysis"), true);
  assert.equal(canOpenMerchantOrderWorkbenchView(permissions, "export"), false);
  assert.equal(canOpenMerchantOrderWorkbenchView(permissions, "catalog"), true);
  assert.equal(resolveMerchantOrderWorkbenchView("export", permissions), "orders");
});

test("an injected request client is fail-closed as an employee surface", () => {
  assert.equal(
    isMerchantOrderEmployeeFrontend({ apiClient: async () => new Response() }),
    true,
  );
});

test("employee requests never fall back to an owner cookie request", async () => {
  let ownerCalls = 0;
  const request = createMerchantOrderApiRequest({
    employeeMode: true,
    ownerFetch: async () => {
      ownerCalls += 1;
      return new Response();
    },
  });

  await assert.rejects(request("/api/orders"), /employee_order_api_client_required/);
  assert.equal(ownerCalls, 0);
});

test("an injected client is the only request path in employee mode", async () => {
  const calls: string[] = [];
  const request = createMerchantOrderApiRequest({
    employeeMode: true,
    apiClient: async (path) => {
      calls.push(path);
      return new Response("ok");
    },
    ownerFetch: async () => {
      throw new Error("owner fallback must not run");
    },
  });

  const response = await request("/api/orders?siteId=10000000");
  assert.equal(await response.text(), "ok");
  assert.deepEqual(calls, ["/api/orders?siteId=10000000"]);
});
