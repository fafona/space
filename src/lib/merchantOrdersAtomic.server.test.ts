import assert from "node:assert/strict";
import test from "node:test";
import { createMerchantOrder, type MerchantOrderRecord } from "@/lib/merchantOrders";
import {
  updateMerchantOrderBySite,
  updateMerchantOrdersBatchBySite,
  type MerchantOrderUpdateDependencies,
} from "@/lib/merchantOrders.server";

function fixture(status: MerchantOrderRecord["status"] = "confirmed", id = "order-1") {
  return {
    ...createMerchantOrder({ siteId: "10000000", items: [{ productId: "p-1", name: "P", quantity: 1, unitPrice: 10 }] },
      { id, createdAt: "2026-09-08T10:00:00Z", updatedAt: "2026-09-08T10:00:00Z" }),
    status,
  };
}

function harness(orders = [fixture()]) {
  const events: string[] = [];
  const saved: Parameters<MerchantOrderUpdateDependencies["saveOrders"]>[1][] = [];
  const rows = [{ id: "1", slug: "__merchant_orders__:10000000:chunk:0", blocks: orders,
    updated_at: "2026-09-08T10:00:00Z" }];
  const mutation = { expectedUpdatedAt: "2026-09-08T10:00:00Z", next: [] };
  const dependencies: MerchantOrderUpdateDependencies = {
    createClient: () => ({ from: () => assert.fail("only injected stores may run"), rpc: async () => ({ data: null }) }),
    loadOrders: async () => {
      events.push("read");
      return { siteId: "10000000", orders, updatedAt: rows[0].updated_at, storageRows: rows };
    },
    prepareMemberships: async () => {
      events.push("prepare");
      return { mutation, previousMemberships: [] };
    },
    saveOrders: async (_client, input) => { events.push("commit"); saved.push(input); return { error: null }; },
    mirrorOrders: async () => { events.push("order-shadow"); return { status: "written", count: orders.length }; },
    mirrorMemberships: async () => { events.push("membership-shadow"); },
  };
  return { events, saved, rows, mutation, dependencies };
}

test("single completion sends order and prepared points in one commit after reauthorization", async () => {
  const h = harness();
  const result = await updateMerchantOrderBySite({ siteId: "10000000", orderId: "order-1", status: "completed",
    assertAuthorizationCurrent: async () => { h.events.push("authorize"); },
  }, h.dependencies);
  assert.equal(result.status, "completed");
  assert.deepEqual(h.events, ["authorize", "read", "prepare", "authorize", "commit", "membership-shadow", "order-shadow"]);
  assert.equal(h.saved.length, 1);
  assert.equal(h.saved[0].expectedRows, h.rows);
  assert.equal(h.saved[0].memberships, h.mutation);
  assert.equal(h.saved[0].orders[0].status, "completed");
});

test("failed or ambiguous order commit does not issue inverse point compensation or shadow writes", async () => {
  for (const error of ["order_update_conflict", "merchant_memberships_conflict", "merchant_transaction_unavailable"]) {
    const h = harness();
    h.dependencies.saveOrders = async () => { h.events.push("commit-failed"); return { error }; };
    await assert.rejects(() => updateMerchantOrderBySite({ siteId: "10000000", orderId: "order-1", status: "completed" },
      h.dependencies), new RegExp(error));
    assert.deepEqual(h.events, ["read", "prepare", "commit-failed"]);
  }
});

test("points preparation failure leaves all order writes untouched", async () => {
  const h = harness([fixture("completed")]);
  h.dependencies.prepareMemberships = async () => { throw new Error("order_points_reversal_balance_insufficient"); };
  await assert.rejects(() => updateMerchantOrderBySite({ siteId: "10000000", orderId: "order-1", status: "confirmed" },
    h.dependencies), /order_points_reversal_balance_insufficient/);
  assert.deepEqual(h.events, ["read"]);
});

test("role revoked during preparation is rejected before committing", async () => {
  const h = harness();
  let authorizations = 0;
  await assert.rejects(() => updateMerchantOrderBySite({
    siteId: "10000000", orderId: "order-1", status: "completed",
    assertAuthorizationCurrent: async () => { if (++authorizations === 2) throw new Error("permission_denied"); },
  }, h.dependencies), /permission_denied/);
  assert.deepEqual(h.events, ["read", "prepare"]);
  assert.equal(h.saved.length, 0);
});

test("initial authorization, stale expected order version and locked items fail before point calculation", async () => {
  const cases: Array<{ order: MerchantOrderRecord; input: Parameters<typeof updateMerchantOrderBySite>[0]; error: RegExp }> = [
    { order: fixture(), input: { siteId: "10000000", orderId: "order-1", status: "completed",
      assertAuthorizationCurrent: async () => { throw new Error("permission_denied"); } }, error: /permission_denied/ },
    { order: fixture(), input: { siteId: "10000000", orderId: "order-1", status: "completed", expectedUpdatedAt: "2026-01-01T00:00:00Z" },
      error: /order_update_conflict/ },
    { order: fixture("completed"), input: { siteId: "10000000", orderId: "order-1", items: [] }, error: /order_items_locked/ },
  ];
  for (const item of cases) {
    const h = harness([item.order]);
    await assert.rejects(() => updateMerchantOrderBySite(item.input, h.dependencies), item.error);
    assert.ok(!h.events.includes("prepare"));
    assert.equal(h.saved.length, 0);
  }
});

test("completion permission remains required both entering and leaving completed status", async () => {
  for (const [from, to] of [["confirmed", "completed"], ["completed", "cancelled"]] as const) {
    const h = harness([fixture(from)]);
    await assert.rejects(() => updateMerchantOrderBySite({ siteId: "10000000", orderId: "order-1", status: to,
      allowCompletedTransition: false }, h.dependencies), /permission_denied/);
    assert.deepEqual(h.events, ["read"]);
  }
});

test("batch deduplicates IDs, ignores missing IDs and commits all affected orders together", async () => {
  const h = harness([fixture("confirmed", "order-1"), fixture("pending", "order-2"), fixture("pending", "order-3")]);
  const result = await updateMerchantOrdersBatchBySite({ siteId: "10000000", orderIds: ["order-1", "order-1", "missing", "order-2"],
    status: "completed" }, h.dependencies);
  assert.equal(result.length, 2);
  assert.equal(h.saved.length, 1);
  assert.deepEqual(h.saved[0].orders.map((order) => [order.id, order.status]).sort(),
    [["order-1", "completed"], ["order-2", "completed"], ["order-3", "pending"]]);
  assert.equal(h.saved[0].memberships, h.mutation);
});

test("a batch with one forbidden completion transition rejects the entire batch", async () => {
  const h = harness([fixture("confirmed", "order-1"), fixture("completed", "order-2")]);
  await assert.rejects(() => updateMerchantOrdersBatchBySite({ siteId: "10000000", orderIds: ["order-1", "order-2"],
    status: "cancelled", allowCompletedTransition: false }, h.dependencies), /permission_denied/);
  assert.deepEqual(h.events, ["read"]);
});

test("a batch commit failure never compensates all or any partially perceived orders", async () => {
  const h = harness([fixture(), fixture("confirmed", "order-2")]);
  h.dependencies.saveOrders = async () => { h.events.push("commit-failed"); return { error: "merchant_transaction_unavailable" }; };
  await assert.rejects(() => updateMerchantOrdersBatchBySite({ siteId: "10000000", orderIds: ["order-1", "order-2"],
    status: "completed" }, h.dependencies), /merchant_transaction_unavailable/);
  assert.deepEqual(h.events, ["read", "prepare", "commit-failed"]);
});

test("unmatched batch is still not found and does not calculate or write points", async () => {
  const h = harness();
  await assert.rejects(() => updateMerchantOrdersBatchBySite({ siteId: "10000000", orderIds: ["missing"], status: "completed" },
    h.dependencies), /order_not_found/);
  assert.deepEqual(h.events, ["read"]);
});

test("order-only updates can commit without a membership mutation", async () => {
  const h = harness();
  h.dependencies.prepareMemberships = async () => null;
  await updateMerchantOrderBySite({ siteId: "10000000", orderId: "order-1", action: "print" }, h.dependencies);
  assert.equal(h.saved[0].memberships, undefined);
  assert.deepEqual(h.events, ["read", "commit", "order-shadow"]);
});
