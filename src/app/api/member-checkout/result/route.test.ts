import assert from "node:assert/strict";
import test from "node:test";
import { handleMemberCheckoutResult, type MemberCheckoutResultDependencies } from "./route-handler";
import { parseMemberCheckoutResult } from "@/lib/merchantMemberCheckoutResult";
import { readMemberCheckoutResult, cancelMemberCheckout, type MemberCheckoutResultRpc } from "@/lib/merchantMemberCheckoutResult.server";
const siteId = "10909095", operationKey = "a".repeat(64), at = "2026-11-22T12:00:00Z", principalKey = "account:50010105:customer-synthetic";
const cancellation = { pointsReturned: 100, couponsReturned: 1, stockReleased: 1, cancelledAt: at };
const view = () => ({ version: 1 as const, siteId, operationKey, resourceKind: "booking" as const, resourceId: "synthetic-booking", totalPoints: 100, couponCount: 1,
  closed: false, resource: { status: "active", updatedAt: at }, cancellationAvailable: true,
  cancellationPolicy: { returnPoints: true, returnCoupons: true, advanceMinutes: 60, cancellableUntil: "2030-01-01T12:00:00Z" }, cancellation: null });
function fixture() {
  const calls: string[] = [], user = { id: "customer-synthetic", email_confirmed_at: at };
  const session = { accountId: "50010105", userId: user.id, servicePaused: false, user } as unknown as NonNullable<Awaited<ReturnType<MemberCheckoutResultDependencies["session"]>>>;
  const deps: MemberCheckoutResultDependencies = { enabled: () => true, session: async () => { calls.push("session"); return session; },
    read: async input => { calls.push("read"); assert.equal(input.principalKey, principalKey); return view(); },
    cancel: async input => { calls.push("cancel"); assert.deepEqual(input, { siteId, operationKey, principalKey, expectedUpdatedAt: at }); return { replayed: false, cancellation }; } };
  const request = (method = "GET", body: unknown = { siteId, operationKey, expectedUpdatedAt: at }, headers: HeadersInit = {}) => new Request(
    `https://synthetic.faolla.invalid/api/member-checkout/${method === "GET" ? `result?siteId=${siteId}&operationKey=${operationKey}` : "cancel"}`, {
      method, headers: { origin: "https://synthetic.faolla.invalid", "content-type": "application/json", ...headers }, ...(method === "GET" ? {} : { body: JSON.stringify(body) }) });
  return { deps, calls, session, user, request };
}
test("customer reads only their own safe result; original entitlement does not require active membership or today's merchant modules", async () => {
  const f = fixture(), response = await handleMemberCheckoutResult(f.request(), f.deps);
  assert.equal(response.status, 200); assert.deepEqual((await response.json()).result, view());
  assert.deepEqual(f.calls, ["session", "read", "session"]); assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
});
test("cancellation is one identity-bound call with no amount, policy or member selected by the browser", async () => {
  const f = fixture(), response = await handleMemberCheckoutResult(f.request("POST"), f.deps);
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { ok: true, replayed: false, cancellation });
  assert.deepEqual(f.calls, ["session", "cancel", "session"]);
});
test("unverified, paused, signed-out, business-token and disabled pilot callers never reach the result or financial port", async () => {
  for (const mode of ["unverified", "paused", "signed-out", "business", "off"]) {
    const f = fixture(); if (mode === "unverified") f.user.email_confirmed_at = "";
    if (mode === "paused") f.session.servicePaused = true;
    if (mode === "signed-out") f.deps.session = async () => null;
    if (mode === "off") f.deps.enabled = () => false;
    const response = await handleMemberCheckoutResult(f.request("POST", undefined, mode === "business" ? { "x-merchant-access-token": "test" } : {}), f.deps);
    assert.equal(response.status, mode === "off" ? 503 : 401); assert.ok(!f.calls.includes("cancel") && !f.calls.includes("read"));
  }
});
test("cross-origin, oversized, duplicate query, malformed and browser-authoritative payloads never dispatch", async () => {
  const f = fixture();
  const invalid = [f.request("POST", undefined, { origin: "https://foreign.invalid" }),
    f.request("POST", { siteId, operationKey, expectedUpdatedAt: at, points: 999 }),
    f.request("POST", { siteId, operationKey, expectedUpdatedAt: at, note: "x".repeat(5000) }),
    f.request("POST", { siteId, operationKey, expectedUpdatedAt: "invalid" }),
    new Request(`https://synthetic.faolla.invalid/api/member-checkout/result?siteId=${siteId}&siteId=10909096&operationKey=${operationKey}`)];
  for (const request of invalid) assert.ok([400, 403].includes((await handleMemberCheckoutResult(request, f.deps)).status));
  assert.equal(f.calls.includes("cancel"), false);
});
test("account changes after reads hide the old data; after a cancellation the result stays unknown, never repeated or compensated", async () => {
  for (const method of ["GET", "POST"]) {
    const f = fixture(); let count = 0; f.deps.session = async () => ++count === 1 ? f.session : null;
    const response = await handleMemberCheckoutResult(f.request(method), f.deps);
    assert.equal(response.status, method === "POST" ? 503 : 401);
    assert.equal((await response.json()).error, method === "POST" ? "checkout_unconfirmed" : "checkout_unauthorized");
    assert.equal(f.calls.filter(call => call === "cancel").length, method === "POST" ? 1 : 0);
  }
});
test("private database errors are sanitized, definite cancellation conflicts are preserved, and not-found results leak no receipt", async () => {
  const f = fixture(); f.deps.read = async () => null;
  assert.equal((await handleMemberCheckoutResult(f.request(), f.deps)).status, 404);
  f.deps.cancel = async () => { throw new Error("SQL private_customer_email service_role secret"); };
  const response = await handleMemberCheckoutResult(f.request("POST"), f.deps); assert.deepEqual(await response.json(), { error: "checkout_unconfirmed" });
  f.deps.cancel = async () => { throw new Error("checkout_cancellation_deadline"); };
  assert.equal((await handleMemberCheckoutResult(f.request("POST"), f.deps)).status, 409);
});
test("safe result projection drops internal receipt/owner fields, even when the scope object also carries private identity", () => {
  const scope = { siteId, operationKey, principalKey }, value = { ...view(), membershipId: "secret-member", pointTransactions: [{ note: "secret" }], couponUses: [{ settlementCode: "secret" }] };
  const result = parseMemberCheckoutResult(value, scope); assert.deepEqual(result, view()); assert.ok(!JSON.stringify(result).includes("secret"));
  assert.throws(() => parseMemberCheckoutResult({ ...view(), operationKey: "b".repeat(64) }, scope));
  assert.throws(() => parseMemberCheckoutResult({ ...view(), closed: true, cancellationAvailable: false, cancellation: { ...cancellation, pointsReturned: 101 } }, scope));
});
test("RPC adapter sends one cancelled operation and sanitizes timeouts or malformed receipts without retry", async () => {
  const input = { siteId, operationKey, principalKey, expectedUpdatedAt: at }, calls: string[] = [];
  const call: MemberCheckoutResultRpc = async name => { calls.push(name); return { data: name.includes("result") ? view() : { replayed: true, receipt: { siteId, operationKey, closed: true, ...cancellation } }, error: null }; };
  assert.deepEqual(await readMemberCheckoutResult(input, call), view());
  assert.deepEqual(await cancelMemberCheckout(input, call), { replayed: true, cancellation });
  assert.deepEqual(calls, ["faolla_member_checkout_result_v2", "faolla_member_checkout_cancel_v2"]);
  let attempts = 0; await assert.rejects(cancelMemberCheckout(input, async () => { attempts++; throw new Error("network"); }), /checkout_unconfirmed/); assert.equal(attempts, 1);
  await assert.rejects(cancelMemberCheckout(input, async () => ({ data: { replayed: true, receipt: { siteId: "10909096", operationKey, closed: true, ...cancellation } }, error: null })), /checkout_unconfirmed/);
  await assert.rejects(cancelMemberCheckout(input, async () => ({ data: null, error: { message: "order_update_conflict" } })), /checkout_conflict/);
});
