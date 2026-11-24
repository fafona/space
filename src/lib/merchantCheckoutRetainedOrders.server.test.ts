import assert from "node:assert/strict";
import test from "node:test";
import { cartReviewFixture } from "../../scripts/fixtures/member-checkout-cart-review";
import { createMerchantOrder, normalizeMerchantOrderRecords, type MerchantOrderRecord } from "./merchantOrders";
import { bridgeLegacyCheckoutMutation, legacyCheckoutPointTransitions, preserveCheckoutOrderStorage, saveCheckoutAwareMerchantOrders, type CheckoutLegacyBoundaryDependencies } from "./merchantCheckoutLegacyBoundary.server";
import { retainedCheckoutOrderCues, verifyRetainedCheckoutOrders } from "./merchantCheckoutRetainedOrders.server";
import { updateMerchantOrderBySite, updateMerchantOrdersBatchBySite, type MerchantOrderUpdateDependencies } from "./merchantOrders.server";
import type { CheckoutReportingRow } from "./merchantCheckoutReporting";
import { handleMerchantOrderPatch } from "../app/api/orders/route-handler";
async function fixture(method: "points" | "on_site" = "points") {
  const x = await cartReviewFixture(method), raw = { ...x.prepared.plan.record, futurePrivate: { keep: true } }, previous = normalizeMerchantOrderRecords([raw])[0], next = { ...previous, status: "completed" as const };
  x.result.resource = { status: raw.status, updatedAt: raw.updatedAt };
  const rows = [{ id: "synthetic-row", slug: `__merchant_orders__:${x.f.siteId}`, updated_at: x.result.resource!.updatedAt, blocks: [raw] }], calls: string[] = [];
  const rpc = () => async (name: string, args: Record<string, unknown>) => {
    calls.push(name); assert.equal(name, "faolla_member_checkout_reporting_v3");
    return { data: { version: 3, siteId: x.f.siteId, rows: (args.p_resources as Array<{ kind: string; id: string }>).map(r => ({ ...r, result: null, cart: r.id === raw.id ? x.result : null, termsMatch: r.id === raw.id })) }, error: null };
  };
  const deps = { enabled: () => false, cashEnabled: () => false, cartEnabled: () => false, intentEnabled: () => false, rpc };
  return { ...x, raw, previous, next, rows, calls, rpc, deps };
}
test("closing all purchase gates cannot make a retained checkout order eligible for legacy completion points", async () => {
  for (const method of ["points", "on_site"] as const) { const x = await fixture(method);
    const transitions = await legacyCheckoutPointTransitions([{ previous: x.previous, next: x.next }], x.deps, x.rows);
    assert.deepEqual(transitions, []); assert.deepEqual(x.calls, ["faolla_member_checkout_reporting_v3"]);
  }
});

for (const base of [false, true]) for (const cash of [false, true]) for (const cart of [false, true]) test(`retained cart storage and rewards survive gate matrix base=${base},cash=${cash},cart=${cart}`, async () => {
  for (const method of ["points", "on_site"] as const) {
    const x = await fixture(method), deps = { ...x.deps, enabled: () => base, cashEnabled: () => cash, cartEnabled: () => cart };
    assert.deepEqual(await legacyCheckoutPointTransitions([{ previous: x.previous, next: x.next }], deps, x.rows), []);
    const kept = (await preserveCheckoutOrderStorage(x.f.siteId, [x.next], x.rows, deps))[0] as unknown as Record<string, unknown>;
    assert.equal(kept.status, "completed"); assert.deepEqual(kept.items, x.raw.items);
    assert.equal(kept.checkoutOperationKey, x.result.operationKey); assert.deepEqual(kept.futurePrivate, x.raw.futurePrivate);
    assert.deepEqual(x.calls, ["faolla_member_checkout_reporting_v3", "faolla_member_checkout_reporting_v3"]);
  }
});

test("v3 retention verifies earlier single points and single venue originals as well as carts", async () => {
  const x = await fixture(), siteId = x.f.siteId, operationKey = x.result.operationKey;
  for (const method of ["points", "on_site"] as const) {
    const common = { version: 1 as const, siteId, operationKey, resourceKind: "order" as const, resourceId: x.raw.id, totalPoints: 100, couponCount: 0,
      closed: false, resource: x.result.resource, cancellation: null, cancellationAvailable: false, cancellationPolicy: { returnPoints: true, returnCoupons: false, advanceMinutes: 0, cancellableUntil: null } };
    const row: CheckoutReportingRow = method === "points" ? { kind: "order", id: x.raw.id, termsMatch: true, result: common }
      : { kind: "order", id: x.raw.id, termsMatch: true, result: null, onSite: { version: 2, siteId, operationKey,
        terms: { version: 2, method: "on_site", resourceKind: "order", resourceId: x.raw.id, currency: "eur", grossMinor: 1000, discountMinor: 0, dueMinor: 1000, capturedMinor: 0, totalPoints: null, couponCount: 0, paymentState: "unpaid" },
        resource: x.result.resource, termsMatch: true, closed: false, collection: null, cancellation: null, cancellationAvailable: false,
        cancellationPolicy: { returnCoupons: false, advanceMinutes: 0, cancellableUntil: null } } };
    const deps = { ...x.deps, rpc: () => async (name: string) => { assert.equal(name, "faolla_member_checkout_reporting_v3"); return { data: { version: 3, siteId, rows: [row] }, error: null }; } };
    assert.deepEqual(await legacyCheckoutPointTransitions([{ previous: x.previous, next: x.next }], deps, x.rows), []);
    assert.deepEqual((await preserveCheckoutOrderStorage(siteId, [x.next], x.rows, deps))[0].items, x.raw.items);
  }
});

test("only canonical trusted CAS markers trigger retention; unmarked default-off orders keep identity and zero ledger IO", async () => {
  const x = await fixture(), siteId = x.f.siteId, ordinary = createMerchantOrder({ siteId, items: [{ name: "Ordinary", quantity: 1, unitPrice: 15 }] }, { id: "ordinary" });
  const rows = [{ ...x.rows[0], blocks: [ordinary] }], next = { ...ordinary, status: "completed" as const }, transitions = [{ previous: ordinary, next }];
  // A browser/normalized next marker is NOT a trusted source cue.
  Object.assign(next, { checkoutOperationKey: x.result.operationKey });
  const deps = { ...x.deps, rpc: () => { throw new Error("must not instantiate private client"); } };
  assert.equal(await legacyCheckoutPointTransitions(transitions, deps, rows), transitions);
  const values = [next]; assert.equal(await preserveCheckoutOrderStorage(siteId, values, rows, deps), values);
  assert.equal((await verifyRetainedCheckoutOrders(siteId, new Map(), deps.rpc)).size, 0);
  const root = x.rows[0], chunk = { ...root, slug: `${root.slug}:chunk:0`, blocks: [ordinary] };
  assert.equal(retainedCheckoutOrderCues(siteId, [root, chunk]).size, 0, "stale aggregate marker cannot override chunks");
  assert.equal(retainedCheckoutOrderCues(siteId, [chunk, { ...root, slug: "__merchant_orders__:99999999" }]).size, 0);
  const client = { from: () => { throw new Error("no raw page writes"); }, rpc: async (name: string, args: Record<string, unknown>) => {
    assert.equal(name, "faolla_commit_order_membership_v1"); const mutation = args.p_mutation as { orders: { next: unknown[]; expectedRows: unknown } };
    assert.equal(mutation.orders.expectedRows, rows); assert.deepEqual(mutation.orders.next, normalizeMerchantOrderRecords(values)); return { data: { updatedAt: ordinary.updatedAt }, error: null };
  } };
  assert.deepEqual(await saveCheckoutAwareMerchantOrders(client, { siteId, orders: values, expectedRows: rows }, deps), { error: null });
  for (const expectedRows of [null, undefined, {}]) assert.deepEqual(await saveCheckoutAwareMerchantOrders(client, { siteId, orders: values, expectedRows: expectedRows as never }, deps), { error: "order_update_conflict" });
});

test("malformed, foreign or duplicate source markers fail closed without private lookup", async () => {
  const x = await fixture(), source = x.rows[0];
  for (const blocks of [[{ ...x.raw, checkoutOperationKey: "bad" }], [{ ...x.raw, siteId: "99999999" }], [{ ...x.raw, id: "bad id" }],
    [{ ...x.raw, checkoutOperationKey: null }], [x.raw, x.raw], [x.raw, { id: x.raw.id }]]) {
    await assert.rejects(legacyCheckoutPointTransitions([{ previous: x.previous, next: x.next }], x.deps, [{ ...source, blocks }]), /checkout_unavailable/);
  }
  assert.throws(() => retainedCheckoutOrderCues(x.f.siteId, [source, source]), /checkout_unavailable/);
  assert.deepEqual(x.calls, []);
});

test("missing, stale, mismatched or unavailable ledger proof never becomes ordinary, paid, or an older-version retry", async () => {
  const x = await fixture(), scope = { kind: "order", id: x.raw.id }, good = { ...scope, result: null, cart: x.result, termsMatch: true };
  const variants = [null, { version: 2, siteId: x.f.siteId, rows: [] }, { version: 3, siteId: x.f.siteId, rows: [{ ...scope, result: null, termsMatch: false }] },
    { version: 3, siteId: "99999999", rows: [good] }, { version: 3, siteId: x.f.siteId, rows: [{ ...good, id: "other" }] },
    ...[{ operationKey: "c".repeat(64) }, { resourceId: "other" }, { resource: null, reviewRequired: true, cancellationAvailable: false },
      { resource: { ...x.result.resource, updatedAt: "2000-01-01T00:00:00Z" } }, { resource: { ...x.result.resource, status: "completed" } },
    ].map(patch => ({ version: 3, siteId: x.f.siteId, rows: [{ ...good, cart: { ...x.result, ...patch }, termsMatch: !patch.reviewRequired }] }))];
  for (const data of variants) {
    let reads = 0; const deps = { ...x.deps, rpc: () => async (name: string) => { assert.equal(name, "faolla_member_checkout_reporting_v3"); reads++; return { data, error: null }; } };
    await assert.rejects(legacyCheckoutPointTransitions([{ previous: x.previous, next: x.next }], deps, x.rows), /checkout_unavailable/);
    assert.equal(reads, 1);
  }
  for (const failure of ["sql", "transport"] as const) {
    let calls = 0;
    const rpc = () => async () => { calls++; if (failure === "transport") throw new Error("PRIVATE transport"); return { data: null, error: { message: "PRIVATE SQL" } }; };
    await assert.rejects(preserveCheckoutOrderStorage(x.f.siteId, [x.next], x.rows, { ...x.deps, rpc }), error => error instanceof Error && error.message === "checkout_unavailable");
    assert.equal(calls, 1);
  }
});

test("retained save rejects financial edits, removals, duplicates and cancellation/restoration without an original financial command", async () => {
  const x = await fixture();
  for (const patch of [{ items: [] }, { totalAmount: 999 }, { totalQuantity: 3 }, { pricePrefix: "$" }]) {
    await assert.rejects(preserveCheckoutOrderStorage(x.f.siteId, [{ ...x.next, ...patch }], x.rows, x.deps), /checkout_change_requires_review/);
  }
  for (const next of [[], [{ ...x.next, id: "other" }], [x.next, x.next]]) await assert.rejects(preserveCheckoutOrderStorage(x.f.siteId, next, x.rows, x.deps), /checkout_resource_locked/);
  await assert.rejects(preserveCheckoutOrderStorage(x.f.siteId, [{ ...x.next, status: "cancelled" }], x.rows, x.deps), /checkout_original_cancellation_required/);
  const unchanged = await preserveCheckoutOrderStorage(x.f.siteId, [x.previous], x.rows, x.deps); assert.deepEqual(unchanged[0], x.raw); assert.notEqual(unchanged[0], x.raw);
  const poisoned = { ...x.next, checkoutOperationKey: "d".repeat(64) };
  assert.equal(((await preserveCheckoutOrderStorage(x.f.siteId, [poisoned], x.rows, x.deps))[0] as unknown as Record<string, unknown>).checkoutOperationKey, x.result.operationKey);
  const closed = { ...x.result, closed: true, cancellationAvailable: false, resource: { status: "cancelled", updatedAt: x.raw.updatedAt }, cancellation: {
    pointsReturned: x.result.lines.reduce((s, l) => s + (l.returnPoints ? l.points ?? 0 : 0), 0),
    couponsReturned: x.result.lines.reduce((s, l) => s + (l.returnCoupons ? l.couponCount : 0), 0), stockReleased: 0, cancelledAt: x.raw.updatedAt } };
  const closedRows = [{ ...x.rows[0], blocks: [{ ...x.raw, status: "cancelled" }] }];
  const deps = { ...x.deps, rpc: () => async () => ({ data: { version: 3, siteId: x.f.siteId, rows: [{ kind: "order", id: x.raw.id, result: null, termsMatch: true, cart: closed }] }, error: null }) };
  await assert.rejects(preserveCheckoutOrderStorage(x.f.siteId, [{ ...x.previous, status: "confirmed" }], closedRows, deps), /checkout_original_cancellation_required/);
  assert.equal((await preserveCheckoutOrderStorage(x.f.siteId, [{ ...x.previous, status: "cancelled" }], closedRows, deps))[0].status, "cancelled");
});

test("retained read batches at 50 and stops after the shared deadline; abort ignores late transport results", async context => {
  const x = await fixture(), records = Array.from({ length: 51 }, (_, i) => ({ ...x.raw, id: `retained-${i}` })), source = [{ ...x.rows[0], blocks: records }];
  const cues = retainedCheckoutOrderCues(x.f.siteId, source); let reads = 0;
  const rpc = () => async (_name: string, args: Record<string, unknown>) => {
    reads++; const refs = args.p_resources as Array<{ id: string; kind: string }>; assert.ok(refs.length <= 50);
    return { data: { version: 3, siteId: x.f.siteId, rows: refs.map(ref => ({ ...ref, result: null, cart: { ...x.result, resourceId: ref.id }, termsMatch: true })) }, error: null };
  };
  assert.equal((await verifyRetainedCheckoutOrders(x.f.siteId, cues, rpc)).size, 51); assert.equal(reads, 2);
  let now = Date.now(); context.mock.method(Date, "now", () => now); reads = 0;
  await assert.rejects(verifyRetainedCheckoutOrders(x.f.siteId, cues, () => async (...args) => { const result = await rpc()(...args); now += 12_001; return result; }), /checkout_unavailable/); assert.equal(reads, 1);
  const abort = new AbortController(); let begin!: () => void, finish!: (v: Awaited<ReturnType<ReturnType<typeof rpc>>>) => void;
  const began = new Promise<void>(r => { begin = r; }), pending = new Promise<Awaited<ReturnType<ReturnType<typeof rpc>>>>(r => { finish = r; });
  const reading = verifyRetainedCheckoutOrders(x.f.siteId, cues, () => () => { begin(); return pending; }, abort.signal);
  await began; abort.abort(); await assert.rejects(reading, /checkout_unavailable/);
  finish(await rpc()("unused", { p_resources: [{ kind: "order", id: records[0].id }] })); await new Promise(r => setImmediate(r)); assert.equal(reads, 2);
});

function writer(x: Awaited<ReturnType<typeof fixture>>, options: { ordinary?: MerchantOrderRecord; failRead?: number; failCommit?: string; batch?: boolean; partial?: boolean } = {}) {
  const source = structuredClone(x.rows); if (options.ordinary) source[0].blocks.push(options.ordinary as typeof x.raw);
  const sent: Array<Record<string, unknown>> = [], prepared: string[][] = [], events: string[] = []; let reads = 0;
  const gates = options.partial ? { ...x.deps, enabled: () => true, intentEnabled: () => false } : x.deps;
  const rpc = () => async (...args: Parameters<ReturnType<typeof x.rpc>>) => { events.push("ledger"); if (++reads === options.failRead) return { data: null, error: { message: "PRIVATE" } };
    if (options.partial && ["faolla_member_checkout_reporting_v1", "faolla_member_checkout_reporting_v2"].includes(args[0])) {
      const refs = args[1].p_resources as Array<{ kind: string; id: string }>; assert.ok(refs.every(r => r.id !== x.raw.id));
      return { data: { version: args[0].endsWith("_v2") ? 2 : 1, siteId: x.f.siteId, rows: refs.map(r => ({ ...r, result: null, termsMatch: false })) }, error: null };
    } return x.rpc()(...args);
  };
  const client = { from: () => { throw new Error("no direct pages"); }, rpc: async (name: string, args: Record<string, unknown>) => {
    assert.equal(name, "faolla_commit_order_membership_v1"); events.push("commit"); sent.push(args);
    return { data: options.failCommit ? null : { updatedAt: x.raw.updatedAt }, error: options.failCommit ? { message: options.failCommit } : null };
  } };
  const deps: MerchantOrderUpdateDependencies = {
    createClient: () => client,
    loadOrders: async () => ({ siteId: x.f.siteId, orders: normalizeMerchantOrderRecords(source[0].blocks), updatedAt: x.raw.updatedAt, storageRows: source }),
    pointTransitions: (transitions, _overrides, rows) => { assert.equal(rows, source); return legacyCheckoutPointTransitions(transitions, { ...gates, rpc }, rows); },
    prepareMemberships: async transitions => { events.push("prepare"); prepared.push(transitions.map(t => t.next.id)); return { previousMemberships: [], mutation: { expectedUpdatedAt: null, next: [] } }; },
    saveOrders: (client, input) => saveCheckoutAwareMerchantOrders(client, input, { ...gates, rpc, intentEnabled: () => !options.partial }),
    mirrorMemberships: async () => { events.push("mirror-member"); }, mirrorOrders: async () => { events.push("mirror-order"); return { status: "disabled", count: 0 }; },
  };
  const run = options.batch ? () => updateMerchantOrdersBatchBySite({ siteId: x.f.siteId, orderIds: [x.raw.id, ...(options.ordinary ? [options.ordinary.id] : [])], status: "completed" }, deps)
    : () => updateMerchantOrderBySite({ siteId: x.f.siteId, orderId: x.raw.id, status: "completed" }, deps);
  return { run, events, prepared, sent, source, deps };
}

function partialBridge(x: Awaited<ReturnType<typeof fixture>>) {
  const actor = { type: "owner" as const, siteId: x.f.siteId, authUserId: "synthetic-owner", principalKey: "owner:synthetic-owner" as const, authorizationVersion: "owner" as const,
    displayName: "Synthetic", email: "synthetic@example.invalid", authorizationSource: "database" as const, businessPermissions: [], collaborationPermissions: [] };
  const calls: string[] = [], deps: Partial<CheckoutLegacyBoundaryDependencies> = { ...x.deps, enabled: () => true, actor: async () => actor, cartSite: async () => x.f.site,
    rpc: () => async (name, args) => { calls.push(name);
      if (name === "faolla_checkout_cart_resource_link_v1") return { data: { siteId: x.f.siteId, kind: "order", id: x.raw.id, operationKey: x.result.operationKey, record: x.raw, cart: x.result, refundRequired: false }, error: null };
      return x.rpc()(name, args);
    } };
  return { actor, calls, deps };
}

test("actual merchant PATCH completes single/batch originals with cart management off, without financial authority or legacy gifts", async () => {
  for (const method of ["points", "on_site"] as const) for (const batch of [false, true]) {
    const x = await fixture(method), h = writer(x, { batch, partial: true }), bridge = partialBridge(x), origin = "https://partial-gate.synthetic.invalid";
    const r = await handleMerchantOrderPatch(new Request(origin + "/api/orders", { method: "PATCH", headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({ siteId: x.f.siteId, ...(batch ? { orderIds: [x.raw.id] } : { orderId: x.raw.id }), status: "completed" }) }), {
      resolveAdminSession: async () => ({ merchantId: x.f.siteId, actor: bridge.actor, assertAuthorizationCurrent: async () => {} }), isManagementEnabled: async () => true,
      checkoutBridge: input => bridgeLegacyCheckoutMutation(input, bridge.deps), updateOrder: input => updateMerchantOrderBySite(input, h.deps), updateOrdersBatch: input => updateMerchantOrdersBatchBySite(input, h.deps),
    });
    const v = await r.json(); assert.equal(r.status, 200, JSON.stringify(v)); assert.equal((v.order ?? v.orders[0]).status, "completed");
    assert.deepEqual(bridge.calls, [batch ? "faolla_member_checkout_reporting_v3" : "faolla_checkout_cart_resource_link_v1"]);
    assert.deepEqual(h.prepared, []); assert.equal(h.sent.length, 1); assert.equal((h.sent[0].p_mutation as { memberships?: unknown }).memberships, undefined);
    assert.ok(!/checkoutOperationKey|futurePrivate|PRIVATE|memberId/.test(JSON.stringify(v)));
  }
});

test("partial-gate business reads cannot authorize cancellation, edits, personal servicing or stale actors", async () => {
  const x = await fixture();
  for (const patch of [{ action: "cancel" }, { status: "cancelled" }, { action: "restore" }, { action: "complete", items: [] }, { action: "complete", updates: {} }, { mode: "personal" as const, action: "complete" }]) {
    const b = partialBridge(x); await assert.rejects(bridgeLegacyCheckoutMutation({ request: new Request("https://partial.synthetic.invalid/api/orders", { method: "PATCH", headers: { origin: "https://partial.synthetic.invalid" } }),
      mode: "merchant", siteId: x.f.siteId, kind: "order", ids: [x.raw.id], actor: b.actor, ...patch }, b.deps));
    assert.ok(!b.calls.some(name => /cancel|commit|collect/.test(name))); assert.ok(!b.calls.includes("faolla_checkout_cart_resource_link_v1"));
  }
  const b = partialBridge(x);
  await assert.rejects(bridgeLegacyCheckoutMutation({ request: new Request("https://partial.synthetic.invalid/api/orders", { method: "PATCH", headers: { origin: "https://partial.synthetic.invalid" } }), mode: "merchant", siteId: x.f.siteId, kind: "order", ids: [x.raw.id], status: "completed", actor: b.actor },
    { ...b.deps, actor: async () => ({ ...b.actor, authUserId: "changed-owner" }) }), /checkout_unauthorized/);
  assert.deepEqual(b.calls, []);
});

test("undoing business completion under partial shutdown never reverses a checkout original's points or invents a cash refund", async () => {
  for (const method of ["points", "on_site"] as const) {
    const x = await fixture(method); x.raw.status = "completed"; x.result.resource!.status = "completed"; x.result.cancellationAvailable = false;
    const previous = normalizeMerchantOrderRecords([x.raw])[0], next = { ...previous, status: "confirmed" as const }, b = partialBridge(x);
    assert.equal(await bridgeLegacyCheckoutMutation({ request: new Request("https://partial.synthetic.invalid/api/orders", { method: "PATCH", headers: { origin: "https://partial.synthetic.invalid" } }),
      mode: "merchant", siteId: x.f.siteId, kind: "order", ids: [x.raw.id], actor: b.actor, action: "uncomplete" }, b.deps), null);
    assert.deepEqual(await legacyCheckoutPointTransitions([{ previous, next }], b.deps, x.rows), []);
    const kept = (await preserveCheckoutOrderStorage(x.f.siteId, [next], x.rows, b.deps))[0]; assert.equal(kept.status, "confirmed"); assert.deepEqual(kept.items, x.raw.items);
    assert.deepEqual(b.calls, ["faolla_checkout_cart_resource_link_v1", "faolla_member_checkout_reporting_v3", "faolla_member_checkout_reporting_v3"]);
    assert.equal(x.result.closed, false); assert.equal(x.result.collection, undefined); assert.equal(x.result.cancellation, null);
  }
});

test("partial shutdown still checks unmarked rows and keeps ordinary completion rewards separate", async () => {
  const x = await fixture(), ordinary = createMerchantOrder({ siteId: x.f.siteId, items: [{ name: "Ordinary", quantity: 1, unitPrice: 15 }] }, { id: "ordinary-partial" });
  const h = writer(x, { partial: true, ordinary, batch: true }); await h.run(); assert.deepEqual(h.prepared, [[ordinary.id]]); assert.equal(h.sent.length, 1);
  assert.equal(h.events.filter(e => e === "ledger").length, 4);
  for (const failRead of [1, 2, 3, 4]) { const failed = writer(x, { partial: true, ordinary, batch: true, failRead }); await assert.rejects(failed.run(), /checkout_unavailable/);
    assert.equal(failed.sent.length, 0); assert.ok(!failed.events.some(e => e.includes("mirror")));
  }
});

test("actual single and batch order writers carry trusted CAS context, omit linked gifts and use only the original order CAS", async () => {
  for (const method of ["points", "on_site"] as const) for (const batch of [false, true]) {
    const x = await fixture(method), h = writer(x, { batch }); await h.run();
    assert.deepEqual(h.prepared, []); assert.deepEqual(h.events, ["ledger", "ledger", "commit", "mirror-order"]); assert.equal(h.sent.length, 1);
    const mutation = h.sent[0].p_mutation as { orders: { expectedRows: unknown; next: Array<Record<string, unknown>> }; memberships?: unknown };
    assert.equal(mutation.orders.expectedRows, h.source); assert.equal(mutation.memberships, undefined);
    assert.equal(mutation.orders.next[0].status, "completed"); assert.equal(mutation.orders.next[0].checkoutOperationKey, x.result.operationKey);
    assert.deepEqual(mutation.orders.next[0].futurePrivate, x.raw.futurePrivate); assert.deepEqual(mutation.orders.next[0].items, x.raw.items);
    assert.equal(x.raw.status, "pending");
  }
});

test("mixed actual batch awards only ordinary legacy orders; lookup/commit failure cannot mirror or compensate", async () => {
  const x = await fixture(), ordinary = createMerchantOrder({ siteId: x.f.siteId, items: [{ name: "Legacy", quantity: 1, unitPrice: 25 }] }, { id: "old-order" });
  const h = writer(x, { ordinary, batch: true }); await h.run(); assert.deepEqual(h.prepared, [[ordinary.id]]);
  assert.deepEqual(h.events, ["ledger", "prepare", "ledger", "commit", "mirror-member", "mirror-order"]);
  for (const batch of [false, true]) for (const failRead of [1, 2]) {
    const failed = writer(x, { batch, failRead }); await assert.rejects(failed.run(), /checkout_unavailable/);
    assert.equal(failed.sent.length, 0); assert.deepEqual(failed.prepared, []); assert.ok(!failed.events.some(e => e.includes("mirror")));
  }
  for (const failCommit of ["order_update_conflict", "PRIVATE"]) {
    const failed = writer(x, { failCommit }); await assert.rejects(failed.run(), failCommit === "PRIVATE" ? /merchant_transaction_unavailable/ : /order_update_conflict/);
    assert.equal(failed.sent.length, 1); assert.deepEqual(failed.prepared, []); assert.ok(!failed.events.some(e => e.includes("mirror")));
  }
});

test("existing merchant PATCH keeps authority checks and exposes only safe closed-gate success/unavailable outcomes", async () => {
  for (const batch of [false, true]) for (const failRead of [0, 1]) {
    const x = await fixture(), h = writer(x, { batch, failRead }), origin = "https://retained-order.synthetic.invalid";
    let authorizations = 0;
    const response = await handleMerchantOrderPatch(new Request(`${origin}/api/orders`, { method: "PATCH", headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({ siteId: x.f.siteId, ...(batch ? { orderIds: [x.raw.id] } : { orderId: x.raw.id }), status: "completed" }) }), {
      resolveAdminSession: async (_req, siteId, permissions) => {
        assert.equal(siteId, x.f.siteId); assert.ok(permissions.includes("orders.complete"));
        return { merchantId: siteId, assertAuthorizationCurrent: async () => { authorizations++; } };
      }, isManagementEnabled: async () => true, checkoutBridge: async () => null,
      updateOrder: input => updateMerchantOrderBySite(input, h.deps), updateOrdersBatch: input => updateMerchantOrdersBatchBySite(input, h.deps),
    });
    const body = await response.json(); assert.equal(response.status, failRead ? 503 : 200); assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.ok(!/checkoutOperationKey|futurePrivate|PRIVATE|memberId/.test(JSON.stringify(body)));
    if (failRead) { assert.equal(body.error, "checkout_unavailable"); assert.equal(h.sent.length, 0); }
    else { assert.equal((body.order ?? body.orders[0]).status, "completed"); assert.equal(h.sent.length, 1); }
    assert.ok(authorizations >= (failRead ? 1 : 2)); assert.deepEqual(h.prepared, []);
  }
});
test("closing all purchase gates cannot strip a retained original's immutable items, operation marker or future fields", async () => {
  const x = await fixture(), preserved = await preserveCheckoutOrderStorage(x.f.siteId, [x.next], x.rows, x.deps);
  assert.equal(preserved[0].status, "completed"); assert.deepEqual(preserved[0].items, x.raw.items);
  assert.equal((preserved[0] as unknown as Record<string, unknown>).checkoutOperationKey, x.result.operationKey);
  assert.deepEqual((preserved[0] as unknown as Record<string, unknown>).futurePrivate, x.raw.futurePrivate);
});
