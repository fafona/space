import assert from "node:assert/strict";
import test from "node:test";
import { cartReviewFixture } from "../../scripts/fixtures/member-checkout-cart-review";
import { parseCheckoutIntentAcknowledgement, parseCheckoutIntentAckResult, parsePendingCheckoutSnapshot } from "./merchantCheckoutPendingIntent";
import { acknowledgePendingCheckoutIntent, readPendingCheckoutIntent, type CheckoutIntentRpc } from "./merchantCheckoutPendingIntent.server";
import { MerchantCheckoutError } from "./merchantCheckoutQuote.server";

async function fixture() {
  const x = await cartReviewFixture(), siteId = x.f.siteId;
  const acknowledgement = { siteId, operationKey: x.result.operationKey, generation: 1, reviewHash: "a".repeat(64) };
  const snapshot = { version: 1, siteId, pending: { ...acknowledgement, reviewRequired: false, original: { kind: "cart", result: x.result } } };
  const ackResult = { version: 1, ...acknowledgement, acknowledged: true, replayed: false };
  const ports = { principal: x.f.principal, authorize: async () => x.f.principal };
  return { ...x, siteId, acknowledgement, snapshot, ackResult, ports };
}
const errorIs = (code: string, status: number) => (error: unknown) => error instanceof MerchantCheckoutError && error.code === code && error.status === status;

test("pending-original DTO reconstructs safe display fields and never exposes private receipt or session data", async () => {
  const x = await fixture();
  const parsed = parsePendingCheckoutSnapshot({ ...x.snapshot, principal: "PRIVATE", pending: { ...x.snapshot.pending, nonce: "PRIVATE", memberId: "PRIVATE",
    original: { ...x.snapshot.pending.original, result: { ...x.result, contacts: "PRIVATE", lines: x.result.lines.map(l => ({ ...l, couponClaims: "PRIVATE", stockItemId: "PRIVATE" })) } } } }, x.siteId);
  assert.equal(parsed.pending!.operationKey, x.result.operationKey); assert.equal(parsed.pending!.generation, 1);
  assert.ok(!/PRIVATE|nonce|contacts|memberId|stockItemId|couponClaims|principal/.test(JSON.stringify(parsed)));
  assert.deepEqual(parsePendingCheckoutSnapshot({ version: 1, siteId: x.siteId, pending: null }, x.siteId), { version: 1, siteId: x.siteId, pending: null });
});

test("wrong site, version, original key, unsafe generation or missing pending metadata fails closed", async () => {
  const x = await fixture();
  for (const raw of [null, {}, { ...x.snapshot, version: 2 }, { ...x.snapshot, siteId: "00000000" }, { version: 1, siteId: x.siteId },
    ...[0, -1, 0.5, Number.MAX_SAFE_INTEGER + 1, "1"].map(generation => ({ ...x.snapshot, pending: { ...x.snapshot.pending, generation } })),
    ...[{ operationKey: "f".repeat(64) }, { reviewHash: "A".repeat(64) }, { reviewHash: null }, { reviewRequired: "false" }, { original: null }]
      .map(change => ({ ...x.snapshot, pending: { ...x.snapshot.pending, ...change } }))]) assert.throws(() => parsePendingCheckoutSnapshot(raw, x.siteId));
});

test("visible resource mismatch cannot hide behind a false review flag; conservative review remains blocked", async () => {
  const x = await fixture(), original = { kind: "cart", result: { ...x.result, resource: null, reviewRequired: true, cancellationAvailable: false } };
  assert.throws(() => parsePendingCheckoutSnapshot({ ...x.snapshot, pending: { ...x.snapshot.pending, original } }, x.siteId));
  assert.equal(parsePendingCheckoutSnapshot({ ...x.snapshot, pending: { ...x.snapshot.pending, original, reviewRequired: true } }, x.siteId).pending!.reviewRequired, true);
  assert.equal(parsePendingCheckoutSnapshot({ ...x.snapshot, pending: { ...x.snapshot.pending, reviewRequired: true } }, x.siteId).pending!.reviewRequired, true);
});

test("safe pending wrapper preserves both original single points and venue result formats", async () => {
  const x = await fixture(), resource = x.result.resource;
  const singles = [
    { method: "points", result: { version: 1, siteId: x.siteId, operationKey: x.result.operationKey, resourceKind: "order", resourceId: x.result.resourceId,
      totalPoints: 100, couponCount: 0, closed: false, resource, cancellationAvailable: false, cancellationPolicy: null, cancellation: null } },
    { method: "on_site", result: { version: 2, siteId: x.siteId, operationKey: x.result.operationKey, terms: { version: 2, method: "on_site", resourceKind: "order", resourceId: x.result.resourceId,
      currency: "eur", grossMinor: 1000, discountMinor: 0, dueMinor: 1000, capturedMinor: 0, totalPoints: null, couponCount: 0, paymentState: "unpaid" }, closed: false, termsMatch: true,
      resource, collection: null, cancellation: null, cancellationAvailable: true, cancellationPolicy: { returnCoupons: false, advanceMinutes: 0, cancellableUntil: null } } },
  ];
  for (const original of singles) {
    const parsed = parsePendingCheckoutSnapshot({ ...x.snapshot, pending: { ...x.snapshot.pending, original: { kind: "single", original } } }, x.siteId);
    assert.equal(parsed.pending!.original.kind, "single"); assert.deepEqual(parsed.pending!.original, { kind: "single", original });
  }
});

test("acknowledgement accepts only the four review coordinates, never browser identity, nonce or financial overrides", async () => {
  const x = await fixture(); assert.deepEqual(parseCheckoutIntentAcknowledgement(x.acknowledgement), x.acknowledgement);
  for (const raw of [null, {}, { ...x.acknowledgement, generation: 0 }, { ...x.acknowledgement, reviewHash: "bad" },
    ...["principalKey", "accountId", "nonce", "memberId", "dueMinor", "acknowledged", "p_not_after"].map(key => ({ ...x.acknowledgement, [key]: "untrusted" }))])
    assert.throws(() => parseCheckoutIntentAcknowledgement(raw), /checkout_invalid_request/);
});

test("ack result must identify the same generation and original, strips extras and distinguishes a replay", async () => {
  const x = await fixture(), parsed = parseCheckoutIntentAckResult({ ...x.ackResult, private: "PRIVATE", replayed: true }, x.acknowledgement);
  assert.equal(parsed.replayed, true); assert.ok(!JSON.stringify(parsed).includes("PRIVATE"));
  for (const change of [{ siteId: "00000000" }, { generation: 2 }, { operationKey: "f".repeat(64) }, { acknowledged: false }, { replayed: "true" }, { version: 2 }])
    assert.throws(() => parseCheckoutIntentAckResult({ ...x.ackResult, ...change }, x.acknowledgement));
});

test("read derives principal only from matching injected authorization and performs one safe bounded lookup", async () => {
  const x = await fixture(); let calls = 0, auth = 0;
  const result = await readPendingCheckoutIntent({ siteId: x.siteId }, { ...x.ports, authorize: async () => { auth++; return x.f.principal; } }, async (name, args, signal) => {
    calls++; assert.equal(name, "faolla_member_checkout_pending_intent_v1"); assert.ok(signal instanceof AbortSignal);
    assert.deepEqual(args, { p_site_id: x.siteId, p_principal_key: `account:${x.f.principal.accountId}:${x.f.principal.userId}` });
    return { data: x.snapshot, error: null };
  });
  assert.equal(result.pending!.generation, 1); assert.equal(calls, 1); assert.equal(auth, 2);
});

test("none is a read-only response and never dispatches acknowledgement or any financial RPC", async () => {
  const x = await fixture(), calls: string[] = [];
  const result = await readPendingCheckoutIntent({ siteId: x.siteId }, x.ports, async name => { calls.push(name); return { data: { version: 1, siteId: x.siteId, pending: null }, error: null }; });
  assert.equal(result.pending, null); assert.deepEqual(calls, ["faolla_member_checkout_pending_intent_v1"]);
});

test("explicit ack sends a server deadline and exactly one metadata append, not a new order or cancel", async () => {
  const x = await fixture(); let calls = 0;
  const result = await acknowledgePendingCheckoutIntent(x.acknowledgement, x.ports, async (name, args, signal) => {
    calls++; assert.equal(name, "faolla_member_checkout_acknowledge_intent_v1"); assert.ok(signal instanceof AbortSignal);
    assert.deepEqual(Object.keys(args).sort(), ["p_site_id", "p_principal_key", "p_operation_key", "p_generation", "p_review_hash", "p_not_after"].sort());
    assert.equal(args.p_generation, 1); assert.equal(args.p_review_hash, x.acknowledgement.reviewHash);
    const remaining = Date.parse(String(args.p_not_after)) - Date.now(); assert.ok(remaining > 0 && remaining <= 11_000);
    return { data: x.ackResult, error: null };
  }); assert.equal(result.acknowledged, true); assert.equal(calls, 1);
});

test("invalid inputs and principal coordinates never reach either injected RPC", async () => {
  const x = await fixture(); let calls = 0; const rpc: CheckoutIntentRpc = async () => { calls++; throw new Error("must not call"); };
  await assert.rejects(readPendingCheckoutIntent({ siteId: x.siteId, principalKey: "other" } as { siteId: string }, x.ports, rpc), errorIs("checkout_invalid_request", 400));
  await assert.rejects(acknowledgePendingCheckoutIntent({ ...x.acknowledgement, amount: 1 }, x.ports, rpc), errorIs("checkout_invalid_request", 400));
  await assert.rejects(readPendingCheckoutIntent({ siteId: x.siteId }, { ...x.ports, principal: { accountId: "bad", userId: "bad" } }, rpc), errorIs("checkout_unauthorized", 401));
  assert.equal(calls, 0);
});

test("missing or changed authorization before dispatch cannot read or acknowledge another account", async () => {
  const x = await fixture(); let calls = 0; const rpc: CheckoutIntentRpc = async () => { calls++; throw new Error("must not call"); };
  for (const principal of [null, { ...x.f.principal, accountId: "59999999" }]) {
    const ports = { ...x.ports, authorize: async () => principal };
    await assert.rejects(readPendingCheckoutIntent({ siteId: x.siteId }, ports, rpc), errorIs("checkout_unauthorized", 401));
    await assert.rejects(acknowledgePendingCheckoutIntent(x.acknowledgement, ports, rpc), errorIs("checkout_unauthorized", 401));
  } assert.equal(calls, 0);
});

test("post-read identity loss hides the original; post-append identity loss remains unconfirmed", async () => {
  const x = await fixture();
  for (const action of ["read", "ack"] as const) {
    let dispatched = 0; const ports = { ...x.ports, authorize: async () => dispatched ? null : x.f.principal };
    const rpc: CheckoutIntentRpc = async () => { dispatched++; return { data: action === "read" ? x.snapshot : x.ackResult, error: null }; };
    await assert.rejects(action === "read" ? readPendingCheckoutIntent({ siteId: x.siteId }, ports, rpc) : acknowledgePendingCheckoutIntent(x.acknowledgement, ports, rpc),
      errorIs(action === "read" ? "checkout_intent_unavailable" : "checkout_intent_unconfirmed", 503)); assert.equal(dispatched, 1);
  }
});

test("known atomic refusal codes are preserved, while SQL details and network failures are never disclosed", async () => {
  const x = await fixture();
  for (const code of ["checkout_intent_busy", "checkout_intent_not_found", "checkout_intent_changed", "checkout_intent_expired", "checkout_intent_review_required", "checkout_original_pending"]) {
    let calls = 0; await assert.rejects(acknowledgePendingCheckoutIntent(x.acknowledgement, x.ports, async () => { calls++; return { data: null, error: { message: code } }; }), errorIs(code, 409)); assert.equal(calls, 1);
  }
  for (const thrown of [false, true]) {
    const rpc: CheckoutIntentRpc = async () => { if (thrown) throw new Error("PRIVATE SQL credentials"); return { data: null, error: { message: "PRIVATE SQL credentials" } }; };
    await assert.rejects(readPendingCheckoutIntent({ siteId: x.siteId }, x.ports, rpc), errorIs("checkout_intent_unavailable", 503));
    await assert.rejects(acknowledgePendingCheckoutIntent(x.acknowledgement, x.ports, rpc), errorIs("checkout_intent_unconfirmed", 503));
  }
});

test("lost, malformed or wrong-original acknowledgement never retries or falsely releases the pending original", async () => {
  const x = await fixture();
  for (const data of [null, {}, { ...x.ackResult, generation: 2 }, { ...x.ackResult, acknowledged: false }]) {
    let calls = 0; await assert.rejects(acknowledgePendingCheckoutIntent(x.acknowledgement, x.ports, async () => { calls++; return { data, error: null }; }), errorIs("checkout_intent_unconfirmed", 503)); assert.equal(calls, 1);
  }
  await assert.rejects(readPendingCheckoutIntent({ siteId: x.siteId }, x.ports, async () => ({ data: null, error: null })), errorIs("checkout_intent_unavailable", 503));
});

test("aborting before work starts cannot dispatch either read or acknowledgement", async () => {
  const x = await fixture(), controller = new AbortController(); controller.abort(); let calls = 0;
  const rpc: CheckoutIntentRpc = async () => { calls++; return { data: x.ackResult, error: null }; }, ports = { ...x.ports, signal: controller.signal };
  await assert.rejects(readPendingCheckoutIntent({ siteId: x.siteId }, ports, rpc), errorIs("checkout_intent_unavailable", 503));
  await assert.rejects(acknowledgePendingCheckoutIntent(x.acknowledgement, ports, rpc), errorIs("checkout_intent_unavailable", 503)); assert.equal(calls, 0);
});

test("aborted authorization settles without a late read or append after that authorization eventually resolves", async () => {
  const x = await fixture(), controller = new AbortController(); let release!: (value: typeof x.f.principal) => void, begin!: () => void, calls = 0;
  const started = new Promise<void>(resolve => { begin = resolve; }), authorization = new Promise<typeof x.f.principal>(resolve => { release = resolve; });
  const pending = acknowledgePendingCheckoutIntent(x.acknowledgement, { ...x.ports, signal: controller.signal, authorize: async () => { begin(); return authorization; } },
    async () => { calls++; return { data: x.ackResult, error: null }; });
  const rejected = assert.rejects(pending, errorIs("checkout_intent_unavailable", 503)); await started; controller.abort(); await rejected;
  release(x.f.principal); await new Promise(resolve => setImmediate(resolve)); assert.equal(calls, 0);
});

test("slow authorization cannot renew the append deadline or dispatch after the original time budget", async context => {
  const x = await fixture(); let now = Date.now(), calls = 0;
  context.mock.method(Date, "now", () => now);
  await assert.rejects(acknowledgePendingCheckoutIntent(x.acknowledgement, { ...x.ports, authorize: async () => { now += 11_001; return x.f.principal; } },
    async () => { calls++; return { data: x.ackResult, error: null }; }), errorIs("checkout_intent_unavailable", 503));
  assert.equal(calls, 0);
});

test("unresponsive read and lost acknowledgement settle on abort even when transport ignores cancellation", async () => {
  const x = await fixture();
  for (const action of ["read", "ack"] as const) {
    const controller = new AbortController(); let release!: (value: { data: unknown; error: null }) => void, begin!: () => void, calls = 0, auth = 0;
    const started = new Promise<void>(resolve => { begin = resolve; }), transport = new Promise<{ data: unknown; error: null }>(resolve => { release = resolve; });
    const rpc: CheckoutIntentRpc = async () => { calls++; begin(); return transport; }, ports = { ...x.ports, signal: controller.signal, authorize: async () => { auth++; return x.f.principal; } };
    const pending = action === "read" ? readPendingCheckoutIntent({ siteId: x.siteId }, ports, rpc) : acknowledgePendingCheckoutIntent(x.acknowledgement, ports, rpc);
    const rejected = assert.rejects(pending, errorIs(action === "read" ? "checkout_intent_unavailable" : "checkout_intent_unconfirmed", 503));
    await started; controller.abort(); await rejected; release({ data: action === "read" ? x.snapshot : x.ackResult, error: null });
    await new Promise(resolve => setImmediate(resolve)); assert.equal(calls, 1); assert.equal(auth, 1);
  }
});
