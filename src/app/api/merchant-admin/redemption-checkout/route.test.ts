import assert from "node:assert/strict";
import test from "node:test";
import {
  handleMerchantRedemptionCheckoutGet,
  handleMerchantRedemptionCheckoutPost,
  type MerchantRedemptionCheckoutRouteDependencies,
} from "@/app/api/merchant-admin/redemption-checkout/route-handler";
import { MerchantBusinessAccessError, type MerchantBusinessActor } from "@/lib/merchantBusinessActor.server";
import { normalizeMerchantMembershipRecord, toMerchantMembershipListItem } from "@/lib/merchantMemberships";
import type { MerchantRedemptionCheckoutContext, MerchantRedemptionCheckoutReceipt } from "@/lib/merchantRedemptionCheckout";
import type { MerchantStaffBusinessPermission } from "@/lib/merchantStaffBusiness";

const SITE = "10000000";
const OP = "checkout:one";
const STAMP = "2026-09-08T12:00:00.000Z";
const URL_BASE = "https://launch.faolla.com/api/merchant-admin/redemption-checkout";

function employee(permissions: MerchantStaffBusinessPermission[] = ["redemptions.checkout"]): MerchantBusinessActor {
  return { type: "employee", siteId: SITE, authUserId: "auth-one", employeeId: "employee-one", roleId: "role-one",
    employeeVersion: 1, roleVersion: 1, principalKey: "employee:employee-one", authorizationVersion: "1:1",
    displayName: "Cashier", email: "cashier@example.test", collaborationPermissions: [], businessPermissions: permissions };
}

function receipt(): MerchantRedemptionCheckoutReceipt {
  return { version: 1, operationId: OP, siteId: SITE, membershipId: "membership-one", transactionId: "checkout-transaction",
    createdAt: STAMP, beforePointBalance: 100, afterPointBalance: 90, totalQuantity: 1, grossPoints: 10,
    couponPointDiscountTotal: 0, totalPoints: 10, couponCount: 0, note: "Checkout",
    lines: [{ code: "item-one", name: "Item", categoryName: "Category", quantity: 1, unitPoints: 10,
      subtotalPoints: 10, couponDiscountLabel: "", couponPointDiscount: 0 }] };
}

function context(status: MerchantRedemptionCheckoutContext["status"] = "pending"): MerchantRedemptionCheckoutContext {
  return { operationId: OP, status, createdAt: STAMP, acknowledgedAt: null, result: status === "committed" ? receipt() : null,
    fingerprint: "a".repeat(64), membershipId: "membership-one",
    request: { membershipId: "membership-one", items: [{ couponSettlementCode: "PRIVATE-SETTLEMENT-CODE" }],
      note: "PRIVATE-SAVED-REQUEST", settingsVersion: STAMP, couponVersion: null,
      quote: { totalQuantity: 1, grossPoints: 10, totalPoints: 10, couponPointDiscountTotal: 0, couponCount: 0, lines: receipt().lines } } };
}

function membership() {
  const record = normalizeMerchantMembershipRecord({ id: "membership-one", siteId: SITE, memberNo: "CARD-ONE", serial: 1,
    accountId: "PRIVATE-ACCOUNT", userId: "PRIVATE-USER", email: "PRIVATE-EMAIL@example.test", name: "PRIVATE-NAME",
    phone: "PRIVATE-PHONE", address: "PRIVATE-ADDRESS", pointBalance: 90, balanceAmount: 20, status: "active",
    transactions: [{ id: "OTHER-TRANSACTION", type: "recharge", at: STAMP, pointDelta: 50, balanceDelta: 20,
      growthDelta: 0, status: "completed", note: "PRIVATE-HISTORY", operatorId: "OTHER-OPERATOR" }], joinedAt: STAMP, updatedAt: STAMP });
  assert.ok(record);
  return toMerchantMembershipListItem(record);
}

function request(action: unknown = "retry", extras: Record<string, unknown> = {}, origin = "https://launch.faolla.com") {
  return new Request(URL_BASE, { method: "POST", headers: { "content-type": "application/json", origin },
    body: JSON.stringify({ siteId: SITE, operationId: OP, action, ...extras }) });
}

function dependencies(overrides: Partial<MerchantRedemptionCheckoutRouteDependencies> = {}, actor = employee()) {
  return { authorizeActor: async () => actor, reauthorizeActor: async () => actor,
    getCheckout: async () => context(), cancelCheckout: async () => context("cancelled"),
    ackCheckout: async () => ({ ...context("committed"), acknowledgedAt: STAMP }),
    retryCheckout: async () => ({ membership: membership(), receipt: receipt(), replayed: true }),
    ...overrides } satisfies Partial<MerchantRedemptionCheckoutRouteDependencies>;
}

function assertPrivate(response: Response) {
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("pragma"), "no-cache");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("cross-origin-resource-policy"), "same-origin");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
}

test("GET scopes unresolved context to current actor and strips original request and fingerprint", async () => {
  const calls: string[] = [];
  const response = await handleMerchantRedemptionCheckoutGet(new Request(`${URL_BASE}?siteId=${SITE}&operatorId=owner:forged`), dependencies({
    authorizeActor: async (_request, input) => { assert.deepEqual(input, { siteId: SITE, requiredPermission: "redemptions.checkout" }); calls.push("auth"); return employee(); },
    getCheckout: async (siteId, operatorId, operationId) => {
      assert.equal(siteId, SITE); assert.equal(operatorId, "employee:employee-one"); assert.equal(operationId, undefined);
      calls.push("read"); return context();
    },
    reauthorizeActor: async (_request, input) => { assert.equal(input.actor.principalKey, "employee:employee-one");
      assert.deepEqual(input.requiredPermissions, ["redemptions.checkout"]); calls.push("reauth"); return employee(); },
  }));
  assert.equal(response.status, 200); assertPrivate(response);
  const body = await response.json();
  assert.deepEqual(Object.keys(body.checkout).sort(), ["operationId", "status", "createdAt", "acknowledgedAt", "result"].sort());
  assert.equal(body.checkout.status, "pending");
  assert.doesNotMatch(JSON.stringify(body), /PRIVATE-|fingerprint|membershipId|request/);
  assert.deepEqual(calls, ["auth", "read", "reauth"]);
});

test("GET preserves unacknowledged committed authority result and allows explicit same-actor operation lookup", async () => {
  const response = await handleMerchantRedemptionCheckoutGet(new Request(`${URL_BASE}?siteId=${SITE}&operationId=${OP}`), dependencies({
    getCheckout: async (_siteId, operatorId, operationId) => { assert.equal(operatorId, "employee:employee-one"); assert.equal(operationId, OP); return context("committed"); },
  }));
  const body = await response.json();
  assert.deepEqual(body.checkout.result, receipt());
  assert.equal(body.checkout.acknowledgedAt, null);
  assert.equal("request" in body.checkout, false);
});

test("GET returns null only after a successful scoped lookup and reauthorization", async () => {
  const response = await handleMerchantRedemptionCheckoutGet(new Request(`${URL_BASE}?siteId=${SITE}`), dependencies({ getCheckout: async () => null }));
  assert.deepEqual(await response.json(), { ok: true, checkout: null }); assertPrivate(response);
});

test("GET rejects duplicate or malformed site and operation identifiers before authorization", async () => {
  for (const query of [`siteId=${SITE}&siteId=${SITE}`, "siteId=10000000%20", "siteId=other", "", `siteId=${SITE}&operationId=x&operationId=x`,
    `siteId=${SITE}&operationId=${"x".repeat(121)}`, `siteId=${SITE}&operationId=bad%2Fcode`, `siteId=${SITE}&operationId=`]) {
    const response = await handleMerchantRedemptionCheckoutGet(new Request(`${URL_BASE}?${query}`), dependencies({ authorizeActor: async () => { assert.fail("invalid input reached auth"); } }));
    assert.equal(response.status, 400); assertPrivate(response);
  }
});

test("GET authorization denial never reads saved context", async () => {
  const response = await handleMerchantRedemptionCheckoutGet(new Request(`${URL_BASE}?siteId=${SITE}`), dependencies({
    authorizeActor: async () => { throw new MerchantBusinessAccessError("permission_denied", 403); },
    getCheckout: async () => { assert.fail("unauthorized context read"); },
  }));
  assert.equal(response.status, 403); assertPrivate(response);
  assert.deepEqual(await response.json(), { error: "permission_denied" });
});

test("GET discards saved context if identity or role becomes invalid during the read", async () => {
  const response = await handleMerchantRedemptionCheckoutGet(new Request(`${URL_BASE}?siteId=${SITE}`), dependencies({
    getCheckout: async () => context("committed"),
    reauthorizeActor: async () => { throw new MerchantBusinessAccessError("permission_denied", 403); },
  }));
  assert.equal(response.status, 403); assertPrivate(response);
  assert.doesNotMatch(await response.text(), /membership-one|checkout-transaction|PRIVATE-|result/);
});

test("GET read failures are unavailable, never null-success or private storage details", async () => {
  const response = await handleMerchantRedemptionCheckoutGet(new Request(`${URL_BASE}?siteId=${SITE}`), dependencies({
    getCheckout: async () => { throw new Error("SQL PRIVATE-REQUEST token=private-value"); },
  }));
  assert.equal(response.status, 503); assertPrivate(response);
  assert.deepEqual(await response.json(), { error: "merchant_transaction_unavailable", message: "merchant_transaction_unavailable" });
});

test("POST rejects foreign origin before authorization or any mutation", async () => {
  const response = await handleMerchantRedemptionCheckoutPost(request("cancel", {}, "https://attacker.test"), dependencies({
    authorizeActor: async () => { assert.fail("foreign-origin request reached auth"); },
  }));
  assert.equal(response.status, 403); assertPrivate(response);
});

test("POST validates tiny recovery command and refuses malformed JSON before authorization", async () => {
  const invalid = [request("stage"), request("retry", { siteId: "not-a-site" }), request("retry", { operationId: "bad/op" }),
    request("retry", { operationId: "x".repeat(121) }), request("retry", { operationId: null }),
    new Request(URL_BASE, { method: "POST", headers: { origin: "https://launch.faolla.com", "content-type": "application/json" }, body: "{" })];
  for (const entry of invalid) {
    const response = await handleMerchantRedemptionCheckoutPost(entry, dependencies({ authorizeActor: async () => { assert.fail("invalid request reached auth"); } }));
    assert.equal(response.status, 400); assertPrivate(response);
  }
});

test("retry uses only authenticated operator and immutable operation, never caller cart or membership", async () => {
  let reauthorizations = 0;
  const response = await handleMerchantRedemptionCheckoutPost(request("retry", {
    operatorId: "owner:forged", membershipId: "foreign-member", redemptionItems: [{ id: "forged-item" }],
  }), dependencies({
    reauthorizeActor: async () => { reauthorizations += 1; return employee(); },
    retryCheckout: async (input) => {
      assert.deepEqual(Object.keys(input).sort(), ["siteId", "operatorId", "operationId", "assertAuthorizationCurrent"].sort());
      assert.equal(input.siteId, SITE); assert.equal(input.operatorId, "employee:employee-one"); assert.equal(input.operationId, OP);
      assert.equal(reauthorizations, 1); await input.assertAuthorizationCurrent?.();
      return { membership: membership(), receipt: receipt(), replayed: true };
    },
  }));
  assert.equal(response.status, 200); assertPrivate(response); assert.equal(reauthorizations, 3);
  const body = await response.json();
  assert.equal(body.replayed, true); assert.deepEqual(body.receipt, receipt());
  assert.equal(body.membership.pointBalance, 90); assert.equal(body.membership.email, "");
  assert.deepEqual(body.membership.transactions, []);
  assert.doesNotMatch(JSON.stringify(body.membership), /PRIVATE-|OTHER-TRANSACTION|OTHER-OPERATOR/);
});

test("customer-data permission allows current profile but never unrelated member transaction history", async () => {
  const actor = employee(["redemptions.checkout", "redemptions.customer_data.view"]);
  const response = await handleMerchantRedemptionCheckoutPost(request(), dependencies({}, actor));
  const body = await response.json();
  assert.equal(body.membership.name, "PRIVATE-NAME");
  assert.deepEqual(body.membership.transactions, []); assert.equal("insight" in body.membership, false);
  assert.deepEqual(body.receipt, receipt());
});

test("owner recovery uses the authenticated owner principal and still omits unrelated financial history", async () => {
  const actor: MerchantBusinessActor = { type: "owner", siteId: SITE, authUserId: "current-owner",
    principalKey: "owner:current-owner", authorizationVersion: "owner", displayName: "Owner", email: "owner@example.test",
    authorizationSource: "database", collaborationPermissions: [], businessPermissions: ["redemptions.checkout"] };
  const response = await handleMerchantRedemptionCheckoutPost(request("retry", { operatorId: "owner:previous-owner" }), dependencies({
    retryCheckout: async (input) => {
      assert.equal(input.operatorId, "owner:current-owner");
      return { membership: membership(), receipt: receipt(), replayed: true };
    },
  }, actor));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.membership.name, "PRIVATE-NAME"); assert.deepEqual(body.membership.transactions, []);
});

test("profile redaction uses the last reauthorized permission snapshot", async () => {
  const actor = employee(["redemptions.checkout", "redemptions.customer_data.view"]);
  const response = await handleMerchantRedemptionCheckoutPost(request(), dependencies({
    reauthorizeActor: async () => employee(),
  }, actor));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.doesNotMatch(JSON.stringify(body.membership), /PRIVATE-|OTHER-TRANSACTION/);
  assert.deepEqual(body.receipt, receipt());
});

test("unauthenticated and cross-tenant recovery commands cannot reach context storage", async () => {
  for (const [code, status] of [["unauthorized", 401], ["business_access_denied", 403]] as const) {
    const forbidden = async () => { assert.fail("denied actor reached storage"); };
    const response = await handleMerchantRedemptionCheckoutPost(request("retry", { siteId: "20000000" }), dependencies({
      authorizeActor: async (_request, input) => { assert.equal(input.siteId, "20000000"); throw new MerchantBusinessAccessError(code, status); },
      retryCheckout: forbidden, getCheckout: forbidden, cancelCheckout: forbidden, ackCheckout: forbidden,
    }));
    assert.equal(response.status, status); assertPrivate(response); assert.deepEqual(await response.json(), { error: code });
  }
});

test("committed receipt remains readable when its member has since been deleted", async () => {
  const response = await handleMerchantRedemptionCheckoutPost(request(), dependencies({
    retryCheckout: async () => ({ membership: null, receipt: receipt(), replayed: true }),
  }));
  assert.deepEqual(await response.json(), { ok: true, membership: null, receipt: receipt(), replayed: true });
});

test("cancel and ack use current principal, reauthorize before mutation and before returning summary", async () => {
  for (const action of ["cancel", "ack"] as const) {
    const events: string[] = [];
    const mutate = async (siteId: string, operatorId: string, operationId: string) => {
      assert.equal(siteId, SITE); assert.equal(operatorId, "employee:employee-one"); assert.equal(operationId, OP);
      events.push(action); return action === "cancel" ? context("cancelled") : { ...context("committed"), acknowledgedAt: STAMP };
    };
    const response = await handleMerchantRedemptionCheckoutPost(request(action, { operatorId: "owner:forged" }), dependencies({
      reauthorizeActor: async () => { events.push("reauth"); return employee(); }, cancelCheckout: mutate, ackCheckout: mutate,
    }));
    assert.equal(response.status, 200); assertPrivate(response);
    assert.deepEqual(events, ["reauth", action, "reauth"]);
    const body = await response.json();
    assert.equal("request" in body.checkout, false); assert.equal("fingerprint" in body.checkout, false);
    assert.equal("membershipId" in body.checkout, false);
  }
});

test("cancel racing a completed commit returns committed authority rather than pretending cancellation", async () => {
  const response = await handleMerchantRedemptionCheckoutPost(request("cancel"), dependencies({ cancelCheckout: async () => context("committed") }));
  const body = await response.json(); assert.equal(body.checkout.status, "committed"); assert.deepEqual(body.checkout.result, receipt());
});

test("every POST command fails before writes if the role was revoked", async () => {
  for (const action of ["retry", "cancel", "ack"]) {
    const forbidden = async () => { assert.fail("revoked operator mutated checkout"); };
    const response = await handleMerchantRedemptionCheckoutPost(request(action), dependencies({
      reauthorizeActor: async () => { throw new MerchantBusinessAccessError("permission_denied", 403); },
      retryCheckout: forbidden, cancelCheckout: forbidden, ackCheckout: forbidden,
    }));
    assert.equal(response.status, 403); assertPrivate(response);
  }
});

test("late reauthorization rejection never publishes the old actor's result", async () => {
  let reauthorizations = 0;
  const response = await handleMerchantRedemptionCheckoutPost(request("cancel"), dependencies({
    reauthorizeActor: async () => { reauthorizations += 1; if (reauthorizations === 2) throw new MerchantBusinessAccessError("permission_denied", 403); return employee(); },
    cancelCheckout: async () => context("committed"),
  }));
  assert.equal(response.status, 403); assertPrivate(response); assert.doesNotMatch(await response.text(), /result|checkout-transaction|membership-one/);
});

test("known pending/cancel/conflict failures have stable codes; unknown failure never retries or compensates", async () => {
  for (const [message, status] of [
    ["redemption_checkout_pending", 409], ["redemption_checkout_not_terminal", 409], ["redemption_checkout_cancelled", 409], ["redemption_operation_conflict", 409],
    ["redemption_checkout_quote_changed", 409], ["redemption_checkout_not_found", 404], ["SQL PRIVATE-RESPONSE", 503],
  ] as const) {
    let calls = 0;
    const response = await handleMerchantRedemptionCheckoutPost(request("ack"), dependencies({
      ackCheckout: async () => { calls += 1; throw new Error(message); },
      cancelCheckout: async () => { assert.fail("no compensating cancellation"); },
    }));
    assert.equal(response.status, status); assert.equal(calls, 1); assertPrivate(response);
    const body = await response.json(); assert.equal(body.error, status === 503 ? "merchant_transaction_unavailable" : message);
    assert.doesNotMatch(JSON.stringify(body), /PRIVATE-/);
  }
});
