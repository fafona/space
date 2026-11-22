import assert from "node:assert/strict";
import test from "node:test";
import { handleMemberCheckoutSubmit, type MemberCheckoutSubmitDependencies } from "./route-handler";
import { MerchantCheckoutError } from "@/lib/merchantCheckoutQuote.server";
const siteId = "10909095", at = "2026-11-22T12:00:00Z";
function fixture() {
  const calls: string[] = [], user = { id: "customer-synthetic", email_confirmed_at: at };
  const session = { accountId: "50010105", userId: user.id, servicePaused: false, user } as unknown as NonNullable<Awaited<ReturnType<MemberCheckoutSubmitDependencies["session"]>>>;
  const body = { siteId, offerId: "12345678-1234-4234-8234-123456789abc", offerRevision: "87654321-4321-4321-8321-cba987654321", quantity: 1, appointmentAt: "2030-01-01T12:00",
    nonce: "11111111-1111-4111-8111-111111111111", confirmationHash: "a".repeat(64), method: "points", customer: { name: "Synthetic", title: "Mx", email: "synthetic@example.invalid", phone: "000", note: "" } };
  const result = { version: 1 as const, siteId, operationKey: "b".repeat(64), resourceKind: "booking" as const, resourceId: "synthetic", totalPoints: 100, couponCount: 0,
    closed: false, resource: { status: "active", updatedAt: at }, cancellationAvailable: true, cancellationPolicy: { returnPoints: true, returnCoupons: false, advanceMinutes: 60, cancellableUntil: "2030-01-01T11:00:00Z" }, cancellation: null };
  const deps: MemberCheckoutSubmitDependencies = { enabled: () => true, session: async () => { calls.push("auth"); return session; },
    submit: async input => { calls.push("submit"); assert.deepEqual(input.principal, { accountId: session.accountId, userId: session.userId }); assert.deepEqual(input.request, body); return { replayed: false, result }; } };
  const request = (value: unknown = body, headers: HeadersInit = {}) => new Request("https://synthetic.faolla.invalid/api/member-checkout/submit", {
    method: "POST", headers: { origin: "https://synthetic.faolla.invalid", "content-type": "application/json", ...headers }, body: JSON.stringify(value) });
  return { body, result, deps, session, user, calls, request };
}
test("submit API passes only a verified personal identity and one immutable request to the composite service", async () => {
  const f = fixture(), response = await handleMemberCheckoutSubmit(f.request(), f.deps);
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { ok: true, replayed: false, result: f.result });
  assert.deepEqual(f.calls, ["auth", "submit", "auth"]); assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
});
test("unverified, paused, signed-out, disabled and business-token requests cannot dispatch a financial write", async () => {
  for (const mode of ["unverified", "paused", "out", "off", "business"]) {
    const f = fixture(); if (mode === "unverified") f.user.email_confirmed_at = ""; if (mode === "paused") f.session.servicePaused = true;
    if (mode === "out") f.deps.session = async () => null; if (mode === "off") f.deps.enabled = () => false;
    const response = await handleMemberCheckoutSubmit(f.request(undefined, mode === "business" ? { "x-merchant-access-token": "synthetic" } : {}), f.deps);
    assert.equal(response.status, mode === "off" ? 503 : 401); assert.equal(f.calls.includes("submit"), false);
  }
});
test("cross-origin, oversized and client-authoritative payloads are rejected before identity or write I/O", async () => {
  const f = fixture();
  for (const extra of [{ totalPoints: 0 }, { paid: true }, { membershipId: "other" }, { method: "online" }, { confirmationHash: "no" }, { customer: { ...f.body.customer, accountId: "other" } }, { note: "x".repeat(17_000) }]) {
    assert.equal((await handleMemberCheckoutSubmit(f.request({ ...f.body, ...extra }), f.deps)).status, 400);
  }
  assert.equal((await handleMemberCheckoutSubmit(f.request(undefined, { origin: "https://foreign.invalid" }), f.deps)).status, 403); assert.deepEqual(f.calls, []);
});
test("identity changes after submit never expose the old result or repeat/compensate the write", async () => {
  const f = fixture(); let count = 0; f.deps.session = async () => ++count === 1 ? f.session : null;
  const response = await handleMemberCheckoutSubmit(f.request(), f.deps); assert.equal(response.status, 503); assert.deepEqual(await response.json(), { error: "checkout_unconfirmed" });
  assert.equal(f.calls.filter(call => call === "submit").length, 1);
});
test("known no-write conflicts are recoverable errors, unknown database/transport details stay private", async () => {
  const f = fixture(); let count = 0; f.deps.submit = async () => { count++; throw new MerchantCheckoutError("checkout_conflict", 409); };
  assert.equal((await handleMemberCheckoutSubmit(f.request(), f.deps)).status, 409); assert.equal(count, 1);
  f.deps.submit = async () => { throw new Error("SQL private_account secret credential"); };
  const response = await handleMemberCheckoutSubmit(f.request(), f.deps); assert.equal(response.status, 503); assert.deepEqual(await response.json(), { error: "checkout_unconfirmed" });
});
