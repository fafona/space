import assert from "node:assert/strict";
import test from "node:test";
import { handleMemberCheckoutRecover, type MemberCheckoutRecoverDependencies } from "./route-handler";
import { checkoutSubmissionRecoveryIdentity } from "@/lib/merchantCheckoutSubmissionPlan.server";

function fixture() {
  const body = { siteId: "10909095", nonce: "11111111-1111-4111-8111-111111111111" }, at = "2026-11-22T12:00:00Z";
  const user = { id: "customer-synthetic", email_confirmed_at: at };
  const session = { accountId: "50010105", userId: user.id, servicePaused: false, user } as unknown as NonNullable<Awaited<ReturnType<MemberCheckoutRecoverDependencies["session"]>>>;
  const identity = checkoutSubmissionRecoveryIdentity(body, session), calls: string[] = [];
  const result = { version: 1 as const, siteId: body.siteId, operationKey: identity.operationKey, resourceKind: "booking" as const, resourceId: "synthetic", totalPoints: 80, couponCount: 1,
    closed: false, resource: { status: "active", updatedAt: at }, cancellationAvailable: false,
    cancellationPolicy: { returnPoints: true, returnCoupons: true, advanceMinutes: 60, cancellableUntil: "2030-01-01T11:00:00Z" }, cancellation: null };
  const deps: MemberCheckoutRecoverDependencies = { session: async () => { calls.push("auth"); return session; }, enabled: () => true,
    read: async value => { calls.push("read"); assert.deepEqual(value, identity); return { ...result, memberId: "PRIVATE" }; } };
  const request = (value: unknown = body, headers: HeadersInit = {}, query = "") => new Request(`https://synthetic.faolla.invalid/api/member-checkout/recover${query}`, {
    method: "POST", headers: { origin: "https://synthetic.faolla.invalid", "content-type": "application/json", ...headers }, body: JSON.stringify(value) });
  return { body, user, session, identity, result, deps, calls, request };
}
test("nonce recovery reads the current personal account's original result and exposes only the safe DTO", async () => {
  const f = fixture(), response = await handleMemberCheckoutRecover(f.request(), f.deps);
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { ok: true, state: "confirmed", result: f.result });
  assert.deepEqual(f.calls, ["auth", "read", "auth"]); assert.match(response.headers.get("cache-control")!, /no-store/);
});
test("not-yet-visible result remains explicitly unconfirmed, never failed, and dispatches no submit", async () => {
  const f = fixture(); f.deps.read = async () => null;
  const response = await handleMemberCheckoutRecover(f.request(), f.deps);
  assert.deepEqual(await response.json(), { ok: true, state: "unconfirmed" });
});
test("recovery cannot take a principal, amount, operation key or nonce through query parameters", async () => {
  const f = fixture();
  for (const value of [{ ...f.body, accountId: "50010106" }, { ...f.body, totalPoints: 0 }, { ...f.body, operationKey: "a".repeat(64) }, { ...f.body, nonce: "invalid" }, { ...f.body, extra: "x".repeat(1100) }]) {
    assert.equal((await handleMemberCheckoutRecover(f.request(value), f.deps)).status, 400);
  }
  assert.equal((await handleMemberCheckoutRecover(f.request(undefined, {}, "?nonce=private"), f.deps)).status, 400);
  assert.equal(f.calls.includes("read"), false);
});
test("recovery denies signed-out, unverified, paused, disabled, business-token and foreign-origin requests", async () => {
  for (const mode of ["out", "unverified", "paused", "disabled", "business", "foreign"]) {
    const f = fixture(); if (mode === "out") f.deps.session = async () => null;
    if (mode === "unverified") f.user.email_confirmed_at = ""; if (mode === "paused") f.session.servicePaused = true;
    if (mode === "disabled") f.deps.enabled = () => false;
    const response = await handleMemberCheckoutRecover(f.request(undefined, mode === "business" ? { "x-merchant-access-token": "synthetic" }
      : mode === "foreign" ? { origin: "https://foreign.invalid" } : {}), f.deps);
    assert.equal(response.status, mode === "disabled" ? 503 : mode === "foreign" ? 403 : 401); assert.equal(f.calls.includes("read"), false);
  }
});
test("changed identity, malformed result or transport details cannot expose a previous account's record", async () => {
  const f = fixture(); let auth = 0; f.deps.session = async () => ++auth === 1 ? f.session : { ...f.session, accountId: "50010106" };
  assert.deepEqual(await (await handleMemberCheckoutRecover(f.request(), f.deps)).json(), { error: "checkout_unauthorized" });
  const bad = fixture(); bad.deps.read = async () => ({ ...bad.result, operationKey: "a".repeat(64) });
  assert.deepEqual(await (await handleMemberCheckoutRecover(bad.request(), bad.deps)).json(), { error: "checkout_unavailable" });
  bad.deps.read = async () => { throw new Error("SQL private_account secret"); };
  assert.deepEqual(await (await handleMemberCheckoutRecover(bad.request(), bad.deps)).json(), { error: "checkout_unavailable" });
});
