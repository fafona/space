import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { cartQuoteFixture } from "../../scripts/fixtures/member-checkout-cart-quote";
import { quoteCheckoutCartSnapshot } from "./merchantCheckoutCartQuote.server";
import { allocateCartGrowth, cartConfirmationHash, cartSubmissionIdentity, parseCartSubmissionRequest, planCartSubmission } from "./merchantCheckoutCartSubmissionPlan.server";
import { checkoutSubmissionRecoveryIdentity } from "./merchantCheckoutSubmissionPlan.server";
import { previewCartSubmission, submitCartCheckout, recoverCartCheckout, cancelCartCheckout, type CartSubmissionRpc } from "./merchantCheckoutCartSubmission.server";
import { parseCartCheckoutResult } from "./merchantCheckoutCartResult";

async function fixture(method: "points" | "on_site" = "points", change?: (f: ReturnType<typeof cartQuoteFixture>) => void) {
  const f = cartQuoteFixture(method); change?.(f);
  const quote = await quoteCheckoutCartSnapshot(f.refresh(), f.identity(), f.principal);
  const request = { ...f.request, nonce: randomUUID(), confirmationHash: cartConfirmationHash(quote, f.principal),
    customer: { name: "Synthetic", title: "Mx", email: "synthetic@example.invalid", phone: "000", note: "" } };
  const identity = cartSubmissionIdentity(request, f.principal);
  const snapshot = { version: 1 as const, purpose: "product_cart_submission" as const, ...{ siteId: identity.siteId, principalKey: identity.principalKey, operationKey: identity.operationKey, requestHash: identity.requestHash },
    quoteSnapshot: f.snapshot, orderRows: [] };
  const prepared = await planCartSubmission(snapshot, identity, f.principal);
  const result = { version: 3, purpose: "product_cart_result", siteId: f.siteId, operationKey: identity.operationKey, resourceKind: "order", resourceId: prepared.plan.record.id,
    method, currency: method === "points" ? null : "eur", ...prepared.plan.terms, capturedMinor: 0, lines: prepared.plan.lines.map(l => ({ ...l, couponCount: l.couponClaims.length })), closed: false, reviewRequired: false,
    cancellationAvailable: true, resource: { status: "pending", updatedAt: new Date().toISOString() }, cancellation: null };
  return { f, request, identity, snapshot, prepared, result, input: { request, principal: f.principal, authorize: async () => f.principal as typeof f.principal | null, enabled: () => true } };
}
test("cart financial request has separate confirmation/customer binding but shares the original nonce identity", async () => {
  const x = await fixture(); assert.equal(x.identity.operationKey, checkoutSubmissionRecoveryIdentity({ siteId: x.f.siteId, nonce: x.request.nonce }, x.f.principal).operationKey);
  assert.equal(cartSubmissionIdentity({ ...x.request, lines: [...x.request.lines].reverse() }, x.f.principal).requestHash, x.identity.requestHash);
  const changed = cartSubmissionIdentity({ ...x.request, customer: { ...x.request.customer, note: "changed" } }, x.f.principal);
  assert.equal(changed.operationKey, x.identity.operationKey); assert.notEqual(changed.requestHash, x.identity.requestHash);
  assert.notEqual(x.request.confirmationHash, x.prepared.quote.quoteHash);
  for (const extra of [{ memberId: "other" }, { totalPoints: 1 }, { principalKey: "other" }, { paid: true }]) assert.throws(() => parseCartSubmissionRequest({ ...x.request, ...extra }));
  for (const key of ["name", "email", "phone", "title"]) assert.throws(() => parseCartSubmissionRequest({ ...x.request, customer: { ...x.request.customer, [key]: "x\ny" } }));
  assert.throws(() => parseCartSubmissionRequest(x.prepared.quote));
});
test("whole-cart points debit prepares benefits once, one order and exact per-line refundable debit allocation", async () => {
  const x = await fixture("points", f => { f.settings.growthRules.spendPointGrowth = 0.3333; f.offers[1].checkoutBinding.pointsReturnOnCancel = false; });
  const p = x.prepared.plan, debits = p.membership!.transactions.filter(t => t.operatorId.startsWith("customer:"));
  assert.equal(p.record.items.length, 2); assert.equal(p.record.totalQuantity, 2); assert.equal(p.record.totalAmount, 0); assert.equal(p.terms.totalPoints, 200);
  assert.equal(debits.length, 2); assert.equal(debits.reduce((s, t) => s + t.pointDelta, 0), -200);
  // Existing settings canonicalize the rate to 0.33; do not invent a new rate.
  assert.equal(Math.round(debits.reduce((s, t) => s + t.growthDelta, 0) * 100), 6600);
  assert.equal(p.membership!.nextState.pointBalance, 800); assert.equal(p.lines.filter(l => l.returnPoints).length, 1);
  for (const line of p.lines) assert.equal(debits.find(t => t.id === line.pointTransactionId)!.pointDelta, -line.points!);
  assert.equal(x.f.member.pointBalance, 1000); assert.deepEqual(x.f.member.transactions, []);
});
test("deterministic growth allocation preserves hundredths exactly without gifting or re-pricing another line", () => {
  assert.deepEqual(allocateCartGrowth([1, 1, 1], 1), [0.34, 0.33, 0.33]);
  assert.deepEqual(allocateCartGrowth([0, 2, 1], 0.02), [0, 0.01, 0.01]);
  assert.deepEqual(allocateCartGrowth([99_999_998, 1], 99_999_999.99), [99_999_998.99, 1]);
  assert.throws(() => allocateCartGrowth([0, 0], 2)); assert.throws(() => allocateCartGrowth([1], Infinity));
});
test("cash cart prepares no membership mutation and keeps original gross product prices separate from coupon due", async () => {
  const x = await fixture("on_site", f => { f.request.lines[0].couponClaims = [{ couponId: f.coupons[0].id, claimEventId: f.coupons[0].claimEvents[0].id }]; });
  const p = x.prepared.plan; assert.equal(p.membership, null); assert.equal(p.record.totalAmount, 25); assert.equal(p.terms.grossMinor, 2500);
  assert.equal(p.terms.discountMinor, 200); assert.equal(p.terms.dueMinor, 2300); assert.equal(p.terms.capturedMinor, 0);
  assert.equal(p.terms.totalPoints, null); assert.ok(p.lines.every(l => l.pointTransactionId === null));
  assert.deepEqual(x.f.member.transactions, []);
});
test("preparation rejects a changed confirmation, actual scope or raw orders without changing any inputs", async () => {
  const x = await fixture(), before = structuredClone(x.snapshot);
  const id = cartSubmissionIdentity({ ...x.request, confirmationHash: "0".repeat(64) }, x.f.principal);
  await assert.rejects(planCartSubmission({ ...x.snapshot, requestHash: id.requestHash }, id, x.f.principal), /checkout_quote_changed/);
  await assert.rejects(planCartSubmission(x.snapshot, { ...x.identity, principalKey: "other" }, x.f.principal), /checkout_unauthorized/);
  await assert.rejects(planCartSubmission({ ...x.snapshot, orderRows: [{ id: randomUUID(), merchant_id: "10909993", slug: "__merchant_orders__:10909993", blocks: [], updated_at: new Date().toISOString() }] }, x.identity, x.f.principal));
  assert.deepEqual(x.snapshot, before);
});
test("service defaults closed, previews without a write and submits exactly one complete plan", async () => {
  const x = await fixture(), calls: string[] = [];
  const rpc: CartSubmissionRpc = async (name, args, signal) => {
    calls.push(name); assert.ok(signal instanceof AbortSignal);
    if (name.includes("snapshot")) return { data: { replayed: false, snapshot: x.snapshot }, error: null };
    assert.equal(name, "faolla_member_checkout_cart_commit_v1"); assert.equal((args.p_plan as typeof x.prepared.plan).lines.length, 2);
    const p = args.p_plan as typeof x.prepared.plan;
    return { data: { replayed: false, result: { ...x.result, resourceId: p.record.id } }, error: null };
  };
  await assert.rejects(submitCartCheckout({ ...x.input, enabled: undefined }, rpc)); assert.equal(calls.length, 0);
  const preview = await previewCartSubmission(x.input, rpc); assert.ok("quote" in preview); assert.equal(calls.length, 1);
  const submitted = await submitCartCheckout(x.input, rpc); assert.equal(submitted.result!.totalPoints, 200); assert.equal(calls.length, 3);
  assert.ok(!/private-cart|stock-|customer:|transactions|example.invalid|couponClaims/.test(JSON.stringify(submitted)));
});
test("a confirmed original is replayed before current-offer planning, never producing a second write", async () => {
  const x = await fixture(); let calls = 0;
  const r = await submitCartCheckout(x.input, async name => { calls++; assert.ok(name.includes("snapshot")); return { data: { replayed: true, result: x.result }, error: null }; });
  assert.equal(r.replayed, true); assert.equal(calls, 1);
});
test("lost commit, late response, bad receipt and identity loss after write stay unknown without another dispatch", async () => {
  for (const kind of ["lost", "bad", "identity", "late"] as const) {
    const x = await fixture(); let writes = 0, now = Date.now();
    await assert.rejects(submitCartCheckout({ ...x.input, now: () => now, authorize: async () => writes && kind === "identity" ? null : x.f.principal }, async name => {
      if (name.includes("snapshot")) return { data: { replayed: false, snapshot: x.snapshot }, error: null }; writes++;
      if (kind === "lost") throw new Error("connection lost"); if (kind === "late") now += 13_000;
      return { data: { replayed: false, result: kind === "bad" ? {} : x.result }, error: null };
    }), /checkout_unconfirmed/); assert.equal(writes, 1);
  }
});
test("identity loss or deadline after snapshot cannot send a financial request", async () => {
  for (const kind of ["identity", "late"] as const) {
    const x = await fixture(); let reads = 0, now = Date.now();
    await assert.rejects(submitCartCheckout({ ...x.input, now: () => now, authorize: async () => reads && kind === "identity" ? null : x.f.principal }, async name => {
      assert.ok(name.includes("snapshot")); reads++; if (kind === "late") now += 13_000; return { data: { replayed: false, snapshot: x.snapshot }, error: null };
    })); assert.equal(reads, 1);
  }
});
test("recovery is read-only and works after closing pilot; null is not a new-order authorization", async () => {
  const x = await fixture(); let calls = 0;
  const recovered = await recoverCartCheckout({ siteId: x.f.siteId, nonce: x.request.nonce }, { ...x.input, enabled: () => false }, async name => {
    calls++; assert.equal(name, "faolla_member_checkout_cart_result_v1"); return { data: x.result, error: null };
  }); assert.equal(recovered!.totalPoints, 200); assert.equal(calls, 1);
  assert.equal(await recoverCartCheckout({ siteId: x.f.siteId, nonce: x.request.nonce }, x.input, async () => ({ data: null, error: null })), null);
});
test("whole-cart cancellation is explicit, single-dispatch and only returns the whitelisted closed original", async () => {
  const x = await fixture(), cancellation = { pointsReturned: 200, couponsReturned: 0, stockReleased: 2, cancelledAt: new Date().toISOString() }; let calls = 0;
  const result = { ...x.result, closed: true, cancellationAvailable: false, resource: { ...x.result.resource, status: "cancelled" }, cancellation };
  const r = await cancelCartCheckout({ siteId: x.f.siteId, operationKey: x.identity.operationKey, expectedUpdatedAt: x.result.resource.updatedAt }, x.input, async name => {
    calls++; assert.equal(name, "faolla_member_checkout_cart_cancel_v1"); return { data: { replayed: false, result }, error: null };
  }); assert.equal(r.result.cancellation!.pointsReturned, 200); assert.equal(calls, 1);
});
test("result parser refuses inconsistent totals, false cancellation or fake cash paid and strips private metadata", async () => {
  const x = await fixture(), scope = { siteId: x.f.siteId, operationKey: x.identity.operationKey };
  const parsed = parseCartCheckoutResult({ ...x.result, memberId: "PRIVATE", contacts: "PRIVATE" }, scope);
  assert.ok(!/PRIVATE|stockItemId|pointTransactionId|couponClaims/.test(JSON.stringify(parsed)));
  for (const edit of [{ totalPoints: 201 }, { capturedMinor: 1 }, { closed: true }, { lines: [] }, { purpose: "other" }, { reviewRequired: true }])
    assert.throws(() => parseCartCheckoutResult({ ...x.result, ...edit }, scope));
});
test("self-consistent but different product receipt is still unknown, never accepted as this cart", async () => {
  const x = await fixture(); let writes = 0;
  await assert.rejects(submitCartCheckout(x.input, async (name, args) => {
    if (name.includes("snapshot")) return { data: { replayed: false, snapshot: x.snapshot }, error: null };
    writes++; const p = args.p_plan as typeof x.prepared.plan;
    return { data: { replayed: false, result: { ...x.result, resourceId: p.record.id, lines: x.result.lines.map((l, i) => ({ ...l, title: i ? l.title : "Another product" })) } }, error: null };
  }), /checkout_unconfirmed/); assert.equal(writes, 1);
});
test("a replay of a different requested selection or tender cannot trigger a new order", async () => {
  const x = await fixture(); let calls = 0;
  await assert.rejects(submitCartCheckout(x.input, async () => { calls++; return { data: { replayed: true, result: { ...x.result, lines: x.result.lines.map((l, i) => ({ ...l, offerId: i ? l.offerId : randomUUID() })) } }, error: null }; }));
  assert.equal(calls, 1);
});
test("cancellation results must respect the frozen per-line return policy, not merely the whole-cart total", async () => {
  const x = await fixture("points", f => { f.offers[1].checkoutBinding.pointsReturnOnCancel = false; });
  const scope = { siteId: x.f.siteId, operationKey: x.identity.operationKey };
  assert.throws(() => parseCartCheckoutResult({ ...x.result, closed: true, cancellationAvailable: false, resource: { ...x.result.resource, status: "cancelled" },
    cancellation: { pointsReturned: 200, couponsReturned: 0, stockReleased: 2, cancelledAt: new Date().toISOString() } }, scope));
});
test("lost cancel response remains unknown; read-only recovery, not automatic cancel replay, resolves it", async () => {
  const x = await fixture(); let writes = 0;
  const closed = { ...x.result, closed: true, cancellationAvailable: false, resource: { ...x.result.resource, status: "cancelled" },
    cancellation: { pointsReturned: 200, couponsReturned: 0, stockReleased: 2, cancelledAt: new Date().toISOString() } };
  await assert.rejects(cancelCartCheckout({ siteId: x.f.siteId, operationKey: x.identity.operationKey, expectedUpdatedAt: x.result.resource.updatedAt }, x.input, async () => { writes++; throw new Error("lost"); }), /checkout_unconfirmed/);
  const result = await recoverCartCheckout({ siteId: x.f.siteId, nonce: x.request.nonce }, x.input, async name => {
    assert.equal(name, "faolla_member_checkout_cart_result_v1"); return { data: closed, error: null };
  }); assert.equal(result!.closed, true); assert.equal(writes, 1);
});
test("closing the write pilot after snapshot cannot dispatch a financial request", async () => {
  const x = await fixture(); let enabled = true, reads = 0;
  await assert.rejects(submitCartCheckout({ ...x.input, enabled: () => enabled }, async name => {
    assert.ok(name.includes("snapshot")); reads++; enabled = false; return { data: { replayed: false, snapshot: x.snapshot }, error: null };
  })); assert.equal(reads, 1);
});
test("aborting an unresponsive financial snapshot settles without a late write", async () => {
  const x = await fixture(), controller = new AbortController(); let start!: () => void, calls = 0;
  const started = new Promise<void>(resolve => { start = resolve; });
  const pending = submitCartCheckout({ ...x.input, signal: controller.signal }, async name => {
    assert.ok(name.includes("snapshot")); calls++; start(); return new Promise(() => {});
  }); await started; controller.abort(); await assert.rejects(pending); assert.equal(calls, 1);
});
