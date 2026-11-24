import assert from "node:assert/strict";
import test from "node:test";
import { originalServiceFixture } from "../../scripts/fixtures/member-checkout-original-service";
import { parseOriginalServiceRequest, parseOriginalServiceReview, parseOriginalServiceCancellation, originalServiceHref } from "./merchantCheckoutOriginalService";
import { handleCheckoutOriginalService, isMemberCheckoutOriginalServiceEnabled, type OriginalServiceDependencies } from "./merchantCheckoutOriginalService.server";
import { createOriginalServiceController } from "./merchantCheckoutOriginalServiceClient";
import { CheckoutClientError } from "./merchantCheckoutClient";
import { isMemberCheckoutPilotEnabled } from "./merchantMemberCheckoutPilot.server";
import { isMemberCheckoutIntentPilotEnabled } from "./merchantCheckoutCartPilot.server";
const kinds = ["single_points", "single_on_site", "cart_points", "cart_on_site"] as const;
async function fixture(kind: typeof kinds[number] = "single_points") {
  const f = await originalServiceFixture(kind), calls: string[] = [], args: Array<Record<string, unknown>> = [];
  const session = { accountId: f.accountId, userId: f.userId, servicePaused: false, user: { email_confirmed_at: "2026-01-01T00:00:00Z" } } as unknown as Awaited<ReturnType<OriginalServiceDependencies["session"]>>;
  const deps: OriginalServiceDependencies = { enabled: () => true, session: async () => session, call: async (name, input, signal) => {
    assert.equal(signal.aborted, false); calls.push(name); args.push(input); return { data: name.endsWith("review_v1") ? f.review : f.cancellation, error: null };
  } };
  const origin = "https://original-service.synthetic.invalid", req = (cancel = false, headers: Record<string, string> = {}, body: unknown = cancel ? f.input : { siteId: f.siteId, operationKey: f.review.operationKey }) => new Request(origin + "/api/member-checkout/original-service/" + (cancel ? "cancel" : "review"),
    { method: "POST", headers: { origin, "content-type": "application/json", "x-checkout-account-scope": f.accountId, ...headers }, body: JSON.stringify(body) });
  return { ...f, calls, args, session, deps, req };
}
test("original servicing is independently closed and cannot enable purchases or intent writes", () => {
  const site = "10909994", env = { MERCHANT_MEMBER_CHECKOUT_HISTORY_READ_SITES: site, MERCHANT_MEMBER_CHECKOUT_ORIGINAL_SERVICE_SITES: site };
  assert.equal(isMemberCheckoutOriginalServiceEnabled(site, {}), false); assert.equal(isMemberCheckoutOriginalServiceEnabled(site, env), true);
  assert.equal(isMemberCheckoutPilotEnabled(site, env), false); assert.equal(isMemberCheckoutIntentPilotEnabled(site, env), false);
  for (const value of ["", "*", site + ",", "bad", new Array(51).fill(site).join(",")]) assert.equal(isMemberCheckoutOriginalServiceEnabled(site, { ...env, MERCHANT_MEMBER_CHECKOUT_ORIGINAL_SERVICE_SITES: value }), false);
  assert.equal(isMemberCheckoutOriginalServiceEnabled(site, { ...env, MERCHANT_MEMBER_CHECKOUT_HISTORY_READ_SITES: "" }), false);
});
for (const kind of kinds) test(`${kind}: exact original-only projection and one fixed atomic cancellation RPC`, async () => {
  const f = await fixture(kind); assert.equal(parseOriginalServiceRequest(f.input, true).reviewHash, f.review.reviewHash);
  assert.equal(parseOriginalServiceReview(f.review, f.input).reviewRequired, false); assert.equal(parseOriginalServiceCancellation(f.cancellation, f.input).review.original.kind, f.review.original.kind);
  const read = await handleCheckoutOriginalService(false, f.req(), f.deps); assert.equal(read.status, 200); assert.equal((await read.json()).readOnly, true);
  const cancel = await handleCheckoutOriginalService(true, f.req(true), f.deps); assert.equal(cancel.status, 200); assert.ok((await cancel.json()).cancellation.review);
  assert.deepEqual(f.calls, ["faolla_member_checkout_original_service_review_v1", "faolla_member_checkout_original_service_cancel_v1"]);
  assert.equal(f.args[1].p_principal_key, `account:${f.accountId}:${f.userId}`); assert.ok(Date.parse(String(f.args[1].p_not_after)) <= Date.now() + 11_000);
});
test("strict requests/reviews reject extra authority, wrong originals, mismatched compare tokens and unclosed results", async () => {
  const f = await fixture();
  for (const input of [{ ...f.input, principal: "forged" }, { ...f.input, amount: 0 }, { ...f.input, reviewHash: "" }, { ...f.input, expectedUpdatedAt: "bad" }]) assert.throws(() => parseOriginalServiceRequest(input, true));
  for (const value of [{ ...f.review, rawReceipt: {} }, { ...f.review, original: null }, { ...f.review, operationKey: "f".repeat(64) }]) assert.throws(() => parseOriginalServiceReview(value, f.input));
  for (const value of [{ ...f.cancellation, review: f.review }, { ...f.cancellation, requestedReviewHash: "f".repeat(64) }, { ...f.cancellation, review: { ...f.closed, reviewRequired: true } }]) assert.throws(() => parseOriginalServiceCancellation(value, f.input));
  assert.match(originalServiceHref(f.siteId, f.review.operationKey, "es-ES"), /uiLocale=es-ES$/); assert.throws(() => originalServiceHref(f.siteId, f.review.operationKey, "../bad"));
});
test("origin, staff, account, verified identity, closed scope and malformed bodies reject before SQL", async () => {
  const f = await fixture();
  for (const [req, status] of [[f.req(true, { origin: "https://foreign.invalid" }), 403], [f.req(true, { "x-merchant-access-token": "staff" }), 401], [f.req(true, { "x-checkout-account-scope": "" }), 401],
    [f.req(true, {}, { ...f.input, extra: true }), 400], [new Request(f.req(true), { body: new Uint8Array([123, 255]) }), 400]] as const) assert.equal((await handleCheckoutOriginalService(true, req, f.deps)).status, status);
  for (const session of [null, { ...f.session, accountId: "59999999" }, { ...f.session, servicePaused: true }, { ...f.session, user: {} }]) assert.equal((await handleCheckoutOriginalService(true, f.req(true), { ...f.deps, session: async () => session as typeof f.session })).status, 401);
  assert.equal((await handleCheckoutOriginalService(true, f.req(true), { ...f.deps, enabled: () => false })).status, 503); assert.deepEqual(f.calls, []);
});
test("post-dispatch gate/identity loss, bad proof, abort and lost reply remain unknown with no retry", async () => {
  for (const mode of ["identity", "gate", "bad", "abort", "lost"]) {
    const f = await fixture(), abort = new AbortController(); let sent = false;
    const response = await handleCheckoutOriginalService(true, new Request(f.req(true), { signal: abort.signal }), { ...f.deps,
      enabled: () => !(sent && mode === "gate"), session: async () => sent && mode === "identity" ? { ...f.session!, userId: "other-synthetic-user" } : f.session,
      call: async (...args) => { sent = true; if (mode === "lost") throw Error("PRIVATE"); if (mode === "abort") { abort.abort(); return new Promise(() => {}); } if (mode === "bad") return { data: {}, error: null }; return f.deps.call(...args); } });
    assert.equal(response.status, 503); assert.deepEqual(await response.json(), { error: "checkout_service_unconfirmed" }); assert.equal(sent, true); assert.ok(f.calls.length <= 1);
  }
});

test("only known atomic refusals are public; SQL details and missing proofs stay unconfirmed", async () => {
  const f = await fixture();
  for (const code of ["checkout_service_changed", "checkout_service_busy", "checkout_cancellation_requires_refund", "checkout_cancellation_not_allowed", "checkout_cancellation_deadline", "checkout_not_found", "PRIVATE DATABASE DETAIL"] as const) {
    let calls = 0;
    const r = await handleCheckoutOriginalService(true, f.req(true), { ...f.deps, call: async () => { calls++; return { data: null, error: { message: code } }; } });
    const privateError = code === "PRIVATE DATABASE DETAIL";
    assert.equal(r.status, privateError ? 503 : code === "checkout_not_found" ? 404 : 409);
    assert.deepEqual(await r.json(), { error: privateError ? "checkout_service_unconfirmed" : code }); assert.equal(calls, 1);
  }
});
test("stalled auth and late authorization cannot resume a cancellation past its original deadline", async ctx => {
  const f = await fixture(), abort = new AbortController(); let release!: (s: typeof f.session) => void;
  const pending = handleCheckoutOriginalService(true, new Request(f.req(true), { signal: abort.signal }), { ...f.deps, session: () => new Promise(r => { release = r; }) });
  while (!release) await new Promise(r => setImmediate(r)); abort.abort(); assert.equal((await pending).status, 503); release(f.session); await new Promise(r => setImmediate(r)); assert.equal(f.calls.length, 0);
  let now = Date.now(); ctx.mock.method(Date, "now", () => now);
  assert.equal((await handleCheckoutOriginalService(true, f.req(true), { ...f.deps, session: async () => { now += 11_500; return f.session; } })).status, 503); assert.equal(f.calls.length, 0);
});
for (const kind of kinds) test(`${kind}: client needs explicit confirmation; lost cancellation requires a read, never automatic retry`, async () => {
  const f = await fixture(kind), paths: string[] = []; let closed = false;
  const c = createOriginalServiceController({ siteId: f.siteId, operationKey: f.input.operationKey, accountId: f.accountId, request: async (path, body) => {
    paths.push(path); if (path.endsWith("review")) return { ok: true, readOnly: true, review: closed ? f.closed : f.review };
    assert.deepEqual(body, f.input); closed = true; throw new CheckoutClientError("checkout_service_unconfirmed", 503);
  } });
  await c.activate(); await c.cancel(false); assert.equal(paths.length, 1); await Promise.all([c.cancel(true), c.cancel(true)]);
  assert.equal(c.getSnapshot().phase, "unconfirmed"); assert.equal(paths.length, 2); await c.cancel(true); assert.equal(paths.length, 2);
  await c.read(); assert.equal(c.getSnapshot().phase, "ready"); assert.equal(c.getSnapshot().review!.original.kind, f.review.original.kind); await c.cancel(true); assert.equal(paths.length, 3); c.deactivate();
});
test("deactivated client ignores a late original/cancellation reply without changing any local storage", async () => {
  const f = await fixture(); let finish!: (v: unknown) => void;
  const c = createOriginalServiceController({ siteId: f.siteId, operationKey: f.input.operationKey, accountId: f.accountId, request: async () => new Promise(r => { finish = r; }) });
  const pending = c.activate(); while (!finish) await new Promise(r => setImmediate(r)); c.deactivate(); await pending; finish({ ok: true, readOnly: true, review: f.review }); await new Promise(r => setImmediate(r)); assert.equal(c.getSnapshot().phase, "idle");
});
