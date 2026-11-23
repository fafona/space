import assert from "node:assert/strict";
import test from "node:test";
import { bridgeLegacyCheckoutMutation, checkoutLegacyErrorDetails, CheckoutLegacyBoundaryError, legacyCheckoutPointTransitions, preserveCheckoutOrderStorage, saveCheckoutAwareMerchantOrders, type CheckoutLegacyBoundaryDependencies } from "./merchantCheckoutLegacyBoundary.server";
import { createMerchantOrder, normalizeMerchantOrderRecords } from "./merchantOrders";
import { handleMerchantOrderPatch } from "@/app/api/orders/route-handler";
import type { MerchantBusinessActor } from "./merchantBusinessActor.server";

const siteId = "10909095", operationKey = "a".repeat(64), stamp = "2026-11-23T12:00:00Z";
function fixture(kind: "booking" | "order" = "booking") {
  const calls: Array<[string, Record<string, unknown>]> = [];
  const actor: Extract<MerchantBusinessActor, { type: "owner" }> = { type: "owner", siteId, authUserId: "synthetic-owner", principalKey: "owner:synthetic-owner", authorizationVersion: "owner",
    displayName: "Synthetic", email: "synthetic@example.invalid", authorizationSource: "database", businessPermissions: [], collaborationPermissions: [] };
  const user = { email_confirmed_at: stamp as string | undefined };
  const session = { accountId: "50010105", userId: "synthetic-user", user, servicePaused: false } as unknown as NonNullable<Awaited<ReturnType<CheckoutLegacyBoundaryDependencies["session"]>>>;
  let link = { siteId, kind, id: "resource-synthetic", operationKey,
    record: { id: "resource-synthetic", siteId, siteName: "Synthetic", createdAt: stamp, updatedAt: stamp, status: kind === "booking" ? "active" : "pending",
      customerAccountId: "50010105", customerUserId: "synthetic-user", store: "Main", item: "Play", appointmentAt: "2030-01-01T12:00", customerName: "Synthetic", title: "Mx", email: "synthetic@example.invalid", phone: "", note: "",
      items: [{ name: "Play", quantity: 1, unitPrice: 0 }], editToken: "PRIVATE-TOKEN", privatePlan: "PRIVATE-PLAN" },
    result: { version: 1, siteId, operationKey, resourceKind: kind, resourceId: "resource-synthetic", totalPoints: 100, couponCount: 1, closed: false,
      resource: { status: kind === "booking" ? "active" : "pending", updatedAt: stamp }, cancellationAvailable: true,
      cancellationPolicy: { returnPoints: true, returnCoupons: false, advanceMinutes: 0, cancellableUntil: kind === "booking" ? "2030-01-01T00:00:00Z" : null },
      cancellation: null as null | { pointsReturned: number; couponsReturned: number; stockReleased: number; cancelledAt: string } } };
  let missing = false;
  const rpc: ReturnType<CheckoutLegacyBoundaryDependencies["rpc"]> = async (name, args) => {
    calls.push([name, args]);
    if (name === "faolla_checkout_resource_link_v1") return { data: missing ? null : structuredClone(link), error: null };
    if (name === "faolla_member_checkout_reporting_v1") {
      const refs = args.p_resources as Array<{ id: string; kind: string }>;
      return { data: { version: 1, siteId, rows: refs.map(r => ({ ...r, result: r.id === link.id ? structuredClone(link.result) : null, termsMatch: r.id === link.id })) }, error: null };
    }
    assert.ok(["faolla_member_checkout_cancel_v2", "faolla_checkout_merchant_cancel_v1"].includes(name));
    const cancellation = { pointsReturned: 100, couponsReturned: 0, stockReleased: 1, cancelledAt: stamp };
    link = { ...link, record: { ...link.record, status: "cancelled" }, result: { ...link.result, closed: true, cancellationAvailable: false, resource: { status: "cancelled", updatedAt: stamp }, cancellation } };
    return { data: { replayed: false, receipt: { ...cancellation, siteId, operationKey, closed: true } }, error: null };
  };
  const deps: CheckoutLegacyBoundaryDependencies = { enabled: () => true, anyEnabled: () => true, session: async () => session, actor: async () => actor, rpc: () => rpc };
  const input = { request: new Request("https://launch.faolla.com/api/orders"), mode: "personal" as "personal" | "merchant", siteId, kind, ids: [link.id], action: "cancel", actor };
  return { deps, input, session, user, actor, calls, rpc, missing: () => { missing = true; }, link: () => link, replace: (next: typeof link) => { link = next; } };
}
const writes = (f: ReturnType<typeof fixture>) => f.calls.filter(([name]) => name.includes("cancel"));
test("off pilot and unlinked legacy records preserve old behavior, including old unverified identities", async () => {
  const f = fixture(); f.deps.enabled = () => false; f.deps.anyEnabled = () => false;
  assert.equal(await bridgeLegacyCheckoutMutation(f.input, f.deps), null); assert.deepEqual(f.calls, []);
  f.deps.enabled = () => true; f.missing(); f.user.email_confirmed_at = undefined;
  assert.equal(await bridgeLegacyCheckoutMutation(f.input, f.deps), null); assert.equal(writes(f).length, 0);
  const before = f.calls.length;
  assert.equal(await bridgeLegacyCheckoutMutation({ ...f.input, ids: ["历史编号/中文"] }, f.deps), null); assert.equal(f.calls.length, before);
});
test("personal original cancellation is exactly one original-principal write and fresh read, with no secret or old-writer fallback", async () => {
  for (const kind of ["booking", "order"] as const) {
    const f = fixture(kind), result = await bridgeLegacyCheckoutMutation(f.input, f.deps);
    assert.ok(result); assert.equal(result.record.status, "cancelled"); assert.equal(writes(f).length, 1);
    assert.deepEqual(writes(f)[0], ["faolla_member_checkout_cancel_v2", { p_site_id: siteId, p_operation_key: operationKey, p_principal_key: "account:50010105:synthetic-user", p_expected_updated_at: stamp }]);
    assert.ok(!/PRIVATE|editToken|operationKey|membershipId/.test(JSON.stringify(result)));
    const previous = f.calls.length; assert.ok(await bridgeLegacyCheckoutMutation(f.input, f.deps));
    assert.equal(writes(f).length, 1); assert.ok(f.calls.length > previous);
  }
});
test("owner cancellation uses actual owner audit identity, not a fabricated customer principal", async () => {
  const f = fixture(); f.input.mode = "merchant";
  assert.ok(await bridgeLegacyCheckoutMutation(f.input, f.deps)); assert.equal(writes(f).length, 1);
  assert.deepEqual(writes(f)[0], ["faolla_checkout_merchant_cancel_v1", { p_site_id: siteId, p_operation_key: operationKey, p_actor_key: "owner:synthetic-owner", p_expected_updated_at: stamp }]);
});
test("new linked records reject unverified/paused/wrong customers, staff and revoked owner before any cancellation", async () => {
  for (const mode of ["unverified", "paused", "wrong", "employee", "revoked", "shared-owner-change"] as const) {
    const f = fixture();
    if (mode === "unverified") f.user.email_confirmed_at = undefined;
    if (mode === "paused") f.session.servicePaused = true;
    if (mode === "wrong") f.session.accountId = "50010106";
    if (["employee", "revoked", "shared-owner-change"].includes(mode)) f.input.mode = "merchant";
    if (mode === "employee") f.deps.actor = async () => ({ ...f.actor, type: "employee" } as unknown as MerchantBusinessActor);
    if (mode === "revoked") f.deps.actor = async () => ({ ...f.actor, principalKey: "owner:changed-owner" });
    if (mode === "shared-owner-change") f.deps.rpc = () => async (name, args) => { const r = await f.rpc(name, args); f.actor.principalKey = "owner:changed-shared-owner"; return r; };
    await assert.rejects(bridgeLegacyCheckoutMutation(f.input, f.deps)); assert.equal(writes(f).length, 0);
  }
});
test("price/project/time edits, mixed cancellation edits, closed restore and stale versions are explicit and never write", async () => {
  const variants = [{ items: [] }, { updates: { appointmentAt: "2030-01-02T12:00" } }, { updates: { item: "Other" } }, { updates: { note: "Edit plus cancel" } },
    { bookingViewport: "mobile" }, { status: "completed" }, { expectedUpdatedAt: "stale" }, { action: "restore", closed: true }];
  for (const variant of variants) {
    const f = fixture(); if ("closed" in variant) { const link = f.link(); f.replace({ ...link, result: { ...link.result, closed: true, cancellationAvailable: false, resource: { ...link.result.resource, status: "cancelled" }, cancellation: { pointsReturned: 100, couponsReturned: 0, stockReleased: 1, cancelledAt: stamp } }, record: { ...link.record, status: "cancelled" } }); }
    await assert.rejects(bridgeLegacyCheckoutMutation({ ...f.input, ...variant }, f.deps)); assert.equal(writes(f).length, 0);
  }
});
test("one financial record in a mixed batch rejects all cancellations; unrelated batch still uses the original path", async () => {
  const f = fixture(); f.input.mode = "merchant";
  await assert.rejects(bridgeLegacyCheckoutMutation({ ...f.input, ids: ["legacy", "resource-synthetic"] }, f.deps), /checkout_batch_requires_single/); assert.equal(writes(f).length, 0);
  assert.equal(await bridgeLegacyCheckoutMutation({ ...f.input, ids: ["legacy-one", "legacy-two"] }, f.deps), null);
  await assert.rejects(bridgeLegacyCheckoutMutation({ ...f.input, batch: true, ids: ["resource-synthetic"] }, f.deps), /checkout_batch_requires_single/);
  await assert.rejects(bridgeLegacyCheckoutMutation({ ...f.input, ids: ["历史编号/中文", "resource-synthetic"] }, f.deps), /checkout_batch_requires_single/);
});
test("lost write, malformed receipt, failed post-read and post-write auth loss keep outcome unknown and never retry", async () => {
  for (const mode of ["lost", "malformed", "post-read", "auth"] as const) {
    const f = fixture(); let reads = 0, sessions = 0;
    f.deps.session = async () => ++sessions > 2 && mode === "auth" ? null : f.session;
    f.deps.rpc = () => async (name, args) => {
      if (name.includes("link")) { reads++; if (reads > 1 && mode === "post-read") throw new Error("private read"); }
      const r = await f.rpc(name, args);
      if (name.includes("cancel") && mode === "lost") throw new Error("private transport");
      return name.includes("cancel") && mode === "malformed" ? { data: {}, error: null } : r;
    };
    await assert.rejects(bridgeLegacyCheckoutMutation(f.input, f.deps), /checkout_unconfirmed/); assert.equal(writes(f).length, 1);
  }
});
test("missing/cross-site/wrong-resource private lookup cannot escape or fall back to legacy mutation", async () => {
  for (const patch of [{ siteId: "10909096" }, { id: "other" }, { operationKey: "bad" }, { result: null }]) {
    const f = fixture(); f.deps.rpc = () => async () => ({ data: { ...f.link(), ...patch }, error: null });
    await assert.rejects(bridgeLegacyCheckoutMutation(f.input, f.deps), /checkout_unavailable/); assert.equal(writes(f).length, 0);
  }
});
test("old business-only confirmation/completion pass through without a financial command", async () => {
  const f = fixture(); f.input.mode = "merchant";
  assert.equal(await bridgeLegacyCheckoutMutation({ ...f.input, action: undefined, status: "completed" }, f.deps), null);
  assert.equal(writes(f).length, 0);
});
test("only explicit checkout error codes receive sanitized user messages", () => {
  assert.equal(checkoutLegacyErrorDetails(new Error("private SQL email")), null);
  const known = checkoutLegacyErrorDetails(new CheckoutLegacyBoundaryError("checkout_original_cancellation_required"));
  assert.equal(known?.status, 409); assert.ok(known?.message.includes("原结算"));
});
test("completion isolates linked orders from legacy point/growth preparation, leaving original transitions intact", async () => {
  const f = fixture("order"), make = (id: string) => createMerchantOrder({ siteId, items: [{ name: "Synthetic", quantity: 1, unitPrice: 0 }] }, { id, createdAt: stamp, updatedAt: stamp });
  const linked = make("resource-synthetic"), legacy = make("legacy"), transitions = [linked, legacy].map(previous => ({ previous, next: { ...previous, status: "completed" as const } }));
  const next = await legacyCheckoutPointTransitions(transitions, { enabled: () => true, rpc: () => f.rpc });
  assert.deepEqual(next, [transitions[1]]); assert.equal(transitions.length, 2); assert.equal(writes(f).length, 0);
  assert.equal(await legacyCheckoutPointTransitions(transitions, { enabled: () => false, rpc: () => { throw new Error("must not read"); } }), transitions);
});
test("actual existing personal order HTTP handler returns the original cancelled record and never invokes the legacy cancellation", async () => {
  const f = fixture("order"); let oldCalls = 0;
  const request = new Request("https://launch.faolla.com/api/orders", { method: "PATCH", headers: { origin: "https://launch.faolla.com", "content-type": "application/json" }, body: JSON.stringify({ scope: "personal", siteId, orderId: "resource-synthetic", action: "cancel" }) });
  const response = await handleMerchantOrderPatch(request, { resolvePersonalSession: f.deps.session,
    checkoutBridge: input => bridgeLegacyCheckoutMutation(input, f.deps), cancelPersonalOrder: async () => { oldCalls++; throw new Error("old write forbidden"); } });
  assert.equal(response.status, 200); const body = await response.json(); assert.equal(body.order.status, "cancelled"); assert.equal(oldCalls, 0); assert.equal(writes(f).length, 1);
  assert.equal(response.headers.get("cache-control"), "private, no-store"); assert.ok(!/PRIVATE|operationKey|principalKey/.test(JSON.stringify(body)));
});
test("invalid old batch input is rejected before the new financial bridge; stable protected errors reach the client privately", async () => {
  for (const invalid of [true, false]) {
    const f = fixture("order"); let bridges = 0, oldCalls = 0;
    const response = await handleMerchantOrderPatch(new Request("https://launch.faolla.com/api/orders", { method: "PATCH", headers: { origin: "https://launch.faolla.com", "content-type": "application/json" },
      body: JSON.stringify({ siteId, orderIds: ["resource-synthetic"], action: "cancel", ...(invalid ? { expectedUpdatedAt: stamp } : {}) }) }),
    { resolveAdminSession: async () => ({ merchantId: siteId, actor: f.actor, assertAuthorizationCurrent: async () => {} }), isManagementEnabled: async () => true,
      checkoutBridge: async input => { bridges++; return bridgeLegacyCheckoutMutation(input, f.deps); }, updateOrdersBatch: async () => { oldCalls++; throw new Error("old batch forbidden"); } });
    assert.equal(response.status, invalid ? 400 : 409); assert.equal((await response.json()).error, invalid ? "invalid_order_action" : "checkout_batch_requires_single");
    assert.equal(bridges, invalid ? 0 : 1); assert.equal(oldCalls, 0); assert.equal(writes(f).length, 0);
  }
});
test("legacy whole-store normalization cannot rewrite a linked original cart or discard its unknown fields", async () => {
  const f = fixture("order"), original = { ...createMerchantOrder({ siteId, items: [{ name: "Synthetic", quantity: 1, unitPrice: 0 }] }, { id: "resource-synthetic", createdAt: stamp, updatedAt: stamp }),
    // Future/raw source fields must remain the EXACT original JSON; these are
    // not inputs from an HTTP item editor or a new trusted purchase planner.
    totalQuantity: 2, unknownCheckoutField: { preserved: true }, checkoutOperationKey: operationKey };
  const legacy = createMerchantOrder({ siteId, items: [{ name: "Old", quantity: 1, unitPrice: 10 }] }, { id: "legacy", createdAt: stamp, updatedAt: stamp });
  const next = normalizeMerchantOrderRecords([original, legacy]); next.find(r => r.id === original.id)!.status = "completed";
  const preserved = await preserveCheckoutOrderStorage(siteId, next, [{ slug: `__merchant_orders__:${siteId}:chunk:0`, blocks: [original, legacy] }], { enabled: () => true, rpc: () => f.rpc });
  assert.equal(preserved[0].totalQuantity, 2); assert.equal(preserved[0].status, "completed");
  assert.deepEqual((preserved[0] as unknown as Record<string, unknown>).unknownCheckoutField, { preserved: true });
  assert.equal((preserved[0] as unknown as Record<string, unknown>).checkoutOperationKey, operationKey); assert.equal(preserved[1], next[1]);
  const changed = structuredClone(next); changed[0].items[0].quantity = 2;
  await assert.rejects(preserveCheckoutOrderStorage(siteId, changed, [{ slug: `__merchant_orders__:${siteId}:chunk:0`, blocks: [original, legacy] }], { enabled: () => true, rpc: () => f.rpc }), /checkout_change_requires_review/);
  assert.equal(original.status, "pending"); assert.equal(original.totalQuantity, 2);
  const untouched = await preserveCheckoutOrderStorage(siteId, normalizeMerchantOrderRecords([original, legacy]), [{ slug: `__merchant_orders__:${siteId}:chunk:0`, blocks: [original, legacy] }], { enabled: () => true, rpc: () => f.rpc });
  assert.deepEqual(untouched[0], original); assert.notEqual(untouched[0], original);
});

test("server snapshot-aware saver keeps the original CAS command; disabled pilot never looks up a ledger", async () => {
  const f = fixture("order"), raw = { ...createMerchantOrder({ siteId, items: [{ name: "Original", quantity: 1, unitPrice: 0 }] }, { id: "resource-synthetic", createdAt: stamp, updatedAt: stamp }),
    checkoutOperationKey: operationKey, futureField: { untouched: true } };
  const source = [{ id: "row-synthetic", slug: `__merchant_orders__:${siteId}:chunk:0`, blocks: [raw], updated_at: stamp }];
  const sent: Array<Record<string, unknown>> = [], client = { from: () => { throw new Error("no page writes or rereads"); }, rpc: async (name: string, args: Record<string, unknown>) => {
    assert.equal(name, "faolla_commit_order_membership_v1"); sent.push(args); return { data: { updatedAt: stamp }, error: null };
  } };
  const orders = normalizeMerchantOrderRecords([raw]); orders[0].status = "completed";
  assert.deepEqual(await saveCheckoutAwareMerchantOrders(client, { siteId, orders, expectedRows: source }, { enabled: () => false, rpc: () => { throw new Error("gate off"); } }), { error: null });
  const old = sent[0].p_mutation as { orders: { next: unknown[]; expectedRows: unknown } };
  assert.deepEqual(old.orders.next, orders); assert.equal(old.orders.expectedRows, source);
  assert.deepEqual(await saveCheckoutAwareMerchantOrders(client, { siteId, orders, expectedRows: source }, { enabled: () => true, rpc: () => f.rpc }), { error: null });
  const guarded = sent[1].p_mutation as { orders: { next: Array<Record<string, unknown>>; expectedRows: unknown } };
  assert.deepEqual(guarded.orders.next[0].futureField, raw.futureField); assert.equal(guarded.orders.next[0].status, "completed"); assert.equal(guarded.orders.expectedRows, source);
  assert.equal(writes(f).length, 0); assert.equal(sent.length, 2);
});
