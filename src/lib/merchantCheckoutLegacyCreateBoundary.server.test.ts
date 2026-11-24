import assert from "node:assert/strict";
import test from "node:test";
import { createMerchantOrder, normalizeMerchantOrderRecords, type MerchantOrderCreateInput, type MerchantOrderRecord } from "./merchantOrders";
import { saveCheckoutAwareMerchantOrders, checkoutLegacyErrorDetails, legacyCheckoutPointTransitions, preserveCheckoutOrderStorage } from "./merchantCheckoutLegacyBoundary.server";
import { commitLegacyOrderWithCheckoutIntent } from "./merchantCheckoutLegacyCreateBoundary.server";
import { createMerchantOrderRecord, type MerchantOrderCreateDependencies } from "./merchantOrders.server";
import { handleMerchantOrderPost, type MerchantOrderPostRouteDependencies } from "../app/api/orders/route-handler";
import type { PersonalAccountSession } from "./personalAccountSession.server";
import type { Block } from "../data/homeBlocks";
import { cartReviewFixture } from "../../scripts/fixtures/member-checkout-cart-review";

test("new intent mode protects ordinary order creation in the final CAS instead of relying on a pre-read", async () => {
  const siteId = "10909994", order = createMerchantOrder({ siteId, customerAccountId: "59000001", customerUserId: "synthetic-user", items: [{ productId: "p", name: "Synthetic", quantity: 1, unitPrice: 10 }] }, { id: "O-synthetic", createdAt: new Date().toISOString() });
  const calls: string[] = [];
  const client = { from: () => { throw new Error("no direct page writes"); }, rpc: async (name: string) => {
    calls.push(name); return name === "faolla_checkout_legacy_order_commit_v1" ? { data: null, error: { message: "checkout_original_pending" } } : { data: { updatedAt: new Date().toISOString() }, error: null };
  } };
  const deps = { enabled: () => true, cartEnabled: () => true, cashEnabled: () => false, intentEnabled: () => true,
    rpc: () => async (name: string) => name === "faolla_checkout_legacy_order_commit_v1" ? client.rpc(name)
      : ({ data: { version: 3, siteId, rows: [{ kind: "order", id: order.id, result: null, termsMatch: false }] }, error: null }) };
  await assert.rejects(saveCheckoutAwareMerchantOrders(client, { siteId, orders: [order], expectedRows: [] }, deps), /checkout_original_pending/);
  assert.deepEqual(calls, ["faolla_checkout_legacy_order_commit_v1"]);
});

test("enabled legacy intent uses only the restricted RPC port; disabled ordinary save keeps its old client", async () => {
  const siteId = "10909994", order = createMerchantOrder({ siteId, customerAccountId: "59000001", customerUserId: "synthetic-user", items: [{ name: "Synthetic", quantity: 1, unitPrice: 10 }] });
  const calls: string[] = [], client = { from: () => { throw Error("no raw writes"); }, rpc: async (name: string) => {
    calls.push("ordinary:" + name); assert.equal(name, "faolla_commit_order_membership_v1"); return { data: { updatedAt: new Date().toISOString() }, error: null };
  } };
  const options = { enabled: () => true, intentEnabled: () => true, cartEnabled: () => true, rpc: () => async (name: string) => {
    calls.push("restricted:" + name);
    if (name === "faolla_member_checkout_reporting_v3") return { data: { version: 3, siteId, rows: [{ kind: "order", id: order.id, result: null, termsMatch: false }] }, error: null };
    assert.equal(name, "faolla_checkout_legacy_order_commit_v1"); return { data: null, error: { message: "checkout_original_pending" } };
  } };
  await assert.rejects(saveCheckoutAwareMerchantOrders(client, { siteId, orders: [order], expectedRows: [] }, options), /checkout_original_pending/);
  assert.deepEqual(calls, ["restricted:faolla_member_checkout_reporting_v3", "restricted:faolla_checkout_legacy_order_commit_v1"]);
  calls.length = 0;
  assert.deepEqual(await saveCheckoutAwareMerchantOrders(client, { siteId, orders: [order], expectedRows: [] }, { ...options, enabled: () => false }), { error: null });
  assert.deepEqual(calls, ["ordinary:faolla_commit_order_membership_v1"]);
});

function fixture() {
  const siteId = "10909994", at = new Date().toISOString(), calls: Array<[string, Record<string, unknown>]> = [], events: string[] = [];
  let stored: MerchantOrderRecord[] = [], failure: string | null = "checkout_original_pending", intent = true;
  const input: MerchantOrderCreateInput = { siteId, clientRequestId: "synthetic-request", blockId: "products", customerAccountId: "59000001", customerUserId: "synthetic-user", customerLoginEmail: "synthetic@example.invalid",
    customer: { name: "Synthetic", email: "synthetic@example.invalid", phone: "000", note: "" }, items: [{ productId: "p", name: "Synthetic", quantity: 1, unitPrice: 10 }] };
  const client = { from: () => { throw new Error("no raw writes"); }, rpc: async (name: string, args: Record<string, unknown>) => {
    calls.push([name, args]);
    if (failure) return { data: null, error: { message: failure } };
    const mutation = args.p_mutation as { orders: { next: MerchantOrderRecord[] } }; stored = mutation.orders.next;
    return { data: { updatedAt: at }, error: null };
  } };
  const deps = { enabled: () => true, cartEnabled: () => true, cashEnabled: () => false, intentEnabled: () => intent,
    rpc: () => async (name: string, args: Record<string, unknown>) => {
      if (name === "faolla_checkout_legacy_order_commit_v1") return client.rpc(name, args);
      assert.equal(name, "faolla_member_checkout_reporting_v3"); return { data: { version: 3, siteId, rows: (args.p_resources as Array<{ kind: string; id: string }>).map(r => ({ ...r, result: null, termsMatch: false })) }, error: null };
    } };
  const createDeps: MerchantOrderCreateDependencies = { createClient: () => client, loadOrders: async () => ({ siteId, orders: stored, storageRows: [], updatedAt: null }),
    saveOrders: (client, input) => saveCheckoutAwareMerchantOrders(client, input, deps), mirrorOrders: async () => { events.push("mirror"); return { status: "disabled", count: 0 }; } };
  return { siteId, input, client, deps, calls, events, createDeps, create: (value = input) => createMerchantOrderRecord(value, createDeps),
    allow: () => { failure = null; }, fail: (code: string) => { failure = code; }, off: () => { intent = false; } };
}
test("actual ordinary creator preserves its old successful path and request replay; intent-off uses the unchanged CAS", async () => {
  for (const guarded of [false, true]) {
    const x = fixture(); x.allow(); if (!guarded) x.off();
    const result = await x.create(), replay = await x.create(); assert.equal(replay.id, result.id); assert.equal(x.calls.length, 1);
    assert.equal(x.calls[0][0], guarded ? "faolla_checkout_legacy_order_commit_v1" : "faolla_commit_order_membership_v1");
    assert.equal(x.events.length, 2); assert.equal(result.status, "pending");
  }
});
test("blocked/ambiguous creator never performs ordinary fallback, a shadow write, or another commit", async () => {
  for (const code of ["checkout_original_pending", "checkout_intent_review_required", "PRIVATE SQL exception", "order_update_conflict"]) {
    const x = fixture(); x.fail(code); await assert.rejects(x.create(), code.startsWith("PRIVATE") ? /checkout_create_unconfirmed/ : new RegExp(code));
    assert.equal(x.calls.length, 1); assert.equal(x.calls[0][0], "faolla_checkout_legacy_order_commit_v1"); assert.deepEqual(x.events, []);
  }
});
test("guarded transaction sends one original mutation with a trusted bounded deadline and validates its acknowledgement", async () => {
  const x = fixture(); x.allow(); await x.create(); const args = x.calls[0][1];
  assert.equal(args.p_site_id, x.siteId); assert.ok(Date.parse(args.p_not_after as string) > Date.now() && Date.parse(args.p_not_after as string) <= Date.now() + 11_000);
  for (const mode of ["lost", "malformed", "unsafe", "expired"] as const) {
    let calls = 0;
    const client = { rpc: async () => { calls++; if (mode === "lost") throw new Error("PRIVATE transport");
      return mode === "malformed" ? { data: { updatedAt: false }, error: null } : { data: null, error: { message: mode === "expired" ? "checkout_intent_expired" : "PRIVATE payload" } };
    } };
    if (mode === "expired") assert.deepEqual(await commitLegacyOrderWithCheckoutIntent(client, x.siteId, {}), { error: "order_update_conflict" });
    else await assert.rejects(commitLegacyOrderWithCheckoutIntent(client, x.siteId, {}), /checkout_create_unconfirmed/);
    assert.equal(calls, 1);
  }
});
test("protected creation errors carry bounded safe messages, while unrelated legacy failures retain their old mapping", () => {
  for (const code of ["checkout_original_pending", "checkout_intent_review_required", "checkout_create_unconfirmed"]) {
    const error = checkoutLegacyErrorDetails(new Error(code)); assert.ok(error); assert.ok(error.message.length < 600); assert.ok(!error.message.includes("PRIVATE"));
    assert.equal(error.status, code === "checkout_create_unconfirmed" ? 503 : 409);
  }
  assert.equal(checkoutLegacyErrorDetails(new Error("PRIVATE SQL error")), null);
});

test("consumer intent mode without owner-management still preserves raw cart metadata and excludes duplicate completion points", async () => {
  const x = await cartReviewFixture(), siteId = x.f.siteId;
  const keys = ["MERCHANT_MEMBER_CHECKOUT_PILOT_SITES", "MERCHANT_MEMBER_CHECKOUT_CART_PILOT_SITES", "MERCHANT_MEMBER_CHECKOUT_CART_UI_PILOT_SITES", "MERCHANT_MEMBER_CHECKOUT_INTENT_PILOT_SITES", "MERCHANT_MEMBER_CHECKOUT_CART_MANAGEMENT_PILOT_SITES"];
  const saved = keys.map(key => process.env[key]);
  try {
    keys.forEach(key => { process.env[key] = key.includes("MANAGEMENT") ? "" : siteId; });
    const raw = { ...x.prepared.plan.record, unknownFutureField: { keep: true } }, previous = normalizeMerchantOrderRecords([raw])[0], next = { ...previous, status: "completed" as const };
    const rpc = () => async (name: string) => { assert.equal(name, "faolla_member_checkout_reporting_v3"); return { data: { version: 3, siteId, rows: [{ kind: "order", id: raw.id, result: null, cart: x.result, termsMatch: true }] }, error: null }; };
    assert.deepEqual(await legacyCheckoutPointTransitions([{ previous, next }], { rpc }), []);
    const preserved = await preserveCheckoutOrderStorage(siteId, [next], [{ slug: `__merchant_orders__:${siteId}:chunk:0`, blocks: [raw] }], { rpc });
    assert.equal(preserved[0].status, "completed"); assert.deepEqual(preserved[0].items, raw.items);
    const record = preserved[0] as unknown as Record<string, unknown>; assert.deepEqual(record.unknownFutureField, raw.unknownFutureField); assert.equal(record.checkoutOperationKey, raw.checkoutOperationKey);
  } finally { keys.forEach((key, i) => { if (saved[i] === undefined) delete process.env[key]; else process.env[key] = saved[i]; }); }
});
test("actual old order POST binds account fields to the actual personal session and returns explicit protected rejection", async () => {
  const x = fixture(), origin = "https://ordinary-order.synthetic.invalid", session = { accountId: "59000001", userId: "synthetic-user", email: "synthetic@example.invalid", user: {}, servicePaused: false } as unknown as PersonalAccountSession;
  const blocks = [{ id: "products", type: "product", props: { productPricePrefix: "€", products: [{ id: "p", name: "Synthetic", price: "10" }] } }] as Block[];
  let notifications = 0;
  const response = await handleMerchantOrderPost(new Request(origin + "/api/orders", { method: "POST", headers: { origin, "content-type": "application/json", dnt: "1" }, body: JSON.stringify({ ...x.input, customerAccountId: "99999999", customerUserId: "forged" }) }), {
    loadSnapshotSite: async () => ({ id: x.siteId, permissionConfig: { allowProductBlock: true, allowOrderManagement: true } } as Awaited<ReturnType<MerchantOrderPostRouteDependencies["loadSnapshotSite"]>>), loadOperatingCatalog: async () => null,
    loadPublishedSite: async () => ({ siteId: x.siteId, slug: "synthetic", blocks, orderManagementEnabled: true }), resolvePersonalSession: async () => session,
    createOrder: input => { assert.equal(input.customerAccountId, session.accountId); assert.equal(input.customerUserId, session.userId); return x.create(input); },
    notifyOrderCreated: async () => { notifications++; },
  });
  assert.equal(response.status, 409); const body = await response.json(); assert.equal(body.error, "checkout_original_pending"); assert.match(body.message, /原单/);
  assert.equal(response.headers.get("cache-control"), "private, no-store"); assert.equal(notifications, 0); assert.deepEqual(x.events, []); assert.equal(x.calls.length, 1);
});
