import assert from "node:assert/strict";
import test from "node:test";
import { handleMerchantMembershipsPatch, type MerchantMembershipPatchRouteDependencies } from "./route";
import { MerchantBusinessAccessError, type MerchantBusinessActor } from "@/lib/merchantBusinessActor.server";
import { normalizeMerchantMembershipRecord, toMerchantMembershipListItem } from "@/lib/merchantMemberships";
import { applyMerchantMembershipAccountOperation, type MerchantMembershipRedemptionCheckoutResult } from "@/lib/merchantMemberships.server";
import type { MerchantStaffBusinessPermission } from "@/lib/merchantStaffBusiness";

const SITE = "10000000";
function actor(permissions: MerchantStaffBusinessPermission[] = ["redemptions.checkout"]): MerchantBusinessActor {
  return { type: "employee", siteId: SITE, authUserId: "auth-one", employeeId: "staff-one", roleId: "role-one",
    employeeVersion: 1, roleVersion: 1, principalKey: "employee:staff-one", authorizationVersion: "1:1",
    displayName: "Synthetic staff", email: "staff@example.test", collaborationPermissions: [], businessPermissions: permissions };
}
function result(): MerchantMembershipRedemptionCheckoutResult {
  const member = normalizeMerchantMembershipRecord({ id: "member-one", siteId: SITE, memberNo: "10000000000001", serial: 1,
    accountId: "secret-account", email: "private@example.test", name: "Private member", status: "active", pointBalance: 20,
    balanceAmount: 0, growthValue: 0, joinedAt: "2026-09-08T10:00:00.000Z", updatedAt: "2026-09-08T10:00:00.000Z",
    transactions: [{ id: "unrelated-transaction", type: "recharge", status: "completed", at: "2026-09-08T10:00:00.000Z",
      note: "unrelated private details", pointDelta: 100, balanceDelta: 0, growthDelta: 0, operatorId: "somebody-else" }] });
  assert.ok(member);
  return { membership: toMerchantMembershipListItem(member), replayed: false,
    receipt: { version: 1, siteId: SITE, operationId: "member-operation:original", membershipId: "member-one",
      transactionId: "redemption-one", createdAt: "2026-09-08T10:00:00.000Z", beforePointBalance: 100, afterPointBalance: 20,
      totalQuantity: 2, grossPoints: 80, couponPointDiscountTotal: 0, totalPoints: 80, couponCount: 0, note: "original note",
      lines: [{ code: "SKU", name: "Product", categoryName: "", quantity: 2, unitPoints: 40, subtotalPoints: 80,
        couponDiscountLabel: "", couponPointDiscount: 0 }] } };
}
function request(body: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
  return new Request("https://launch.faolla.com/api/memberships", { method: "PATCH",
    headers: { "content-type": "application/json", origin: "https://launch.faolla.com", ...headers },
    body: JSON.stringify({ action: "member_operation", type: "redeem", siteId: SITE, membershipId: "member-one",
      redemptionItemId: "item-one", redemptionQuantity: 2, operationId: "member-operation:original", note: "original note", ...body }) });
}
function dependencies(overrides: Partial<MerchantMembershipPatchRouteDependencies> = {}) {
  const identity = actor();
  return { authorizeActor: async () => identity, reauthorizeActor: async () => identity,
    applyRedemptionCheckout: async () => result(),
    applyAccountOperation: async () => { assert.fail("product checkout must not enter the membership-only writer"); },
    ...overrides } satisfies Partial<MerchantMembershipPatchRouteDependencies>;
}
function privateHeaders(response: Response) {
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("pragma"), "no-cache");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("cross-origin-resource-policy"), "same-origin");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
}

test("legacy product request returns authority receipt and never trusts client money, balance or operator", async () => {
  let calls = 0; let checks = 0;
  const response = await handleMerchantMembershipsPatch(request({ points: 1, balanceAmount: 1000, operatorId: "owner:forged", pointBalance: 999 }), dependencies({
    authorizeActor: async (_request, input) => { assert.equal(input.requiredPermission, "redemptions.checkout"); assert.equal(input.siteId, SITE); return actor(); },
    reauthorizeActor: async (_request, input) => { checks += 1; assert.deepEqual(input.requiredPermissions, ["redemptions.checkout"]); return actor(); },
    applyRedemptionCheckout: async (input) => { calls += 1;
      assert.deepEqual(input.items, [{ redemptionItemId: "item-one", quantity: 2 }]);
      assert.equal(input.operatorId, "employee:staff-one"); assert.equal(input.operationId, "member-operation:original");
      assert.equal(input.membershipId, "member-one"); assert.equal(input.note, "original note");
      assert.equal("points" in input, false); assert.equal("balanceAmount" in input, false); assert.equal("pointBalance" in input, false);
      await input.assertAuthorizationCurrent?.(); return result(); },
  }));
  assert.equal(response.status, 200); privateHeaders(response);
  assert.equal(calls, 1); assert.equal(checks, 2);
  const body = await response.json();
  assert.deepEqual(body.receipt, result().receipt); assert.equal(body.replayed, false);
  assert.equal(body.membership.email, ""); assert.equal(body.membership.name, "");
  assert.deepEqual(body.membership.transactions, []); assert.equal(body.membership.insight, undefined);
  assert.equal(body.membership.pointBalance, 20);
});

test("members profile permission alone does not reveal redemption customer details", async () => {
  const identity = actor(["redemptions.checkout", "members.customer_data.view", "members.account.view"]);
  const response = await handleMerchantMembershipsPatch(request(), dependencies({ authorizeActor: async () => identity, reauthorizeActor: async () => identity }));
  const body = await response.json(); assert.equal(response.status, 200);
  assert.equal(body.membership.email, ""); assert.deepEqual(body.membership.transactions, []);
});

test("return uses the latest authorized permission snapshot and never unrelated transactions", async () => {
  const original = actor(["redemptions.checkout", "redemptions.customer_data.view"]);
  const current = actor(["redemptions.checkout"]);
  const response = await handleMerchantMembershipsPatch(request(), dependencies({ authorizeActor: async () => original, reauthorizeActor: async () => current }));
  assert.equal(response.status, 200); const body = await response.json();
  assert.equal(body.membership.email, ""); assert.deepEqual(body.membership.transactions, []);
});

test("a committed service result with no remaining member retains its successful receipt envelope", async () => {
  const saved = { ...result(), membership: null, replayed: true };
  const response = await handleMerchantMembershipsPatch(request(), dependencies({ applyRedemptionCheckout: async () => saved }));
  assert.equal(response.status, 200); privateHeaders(response);
  assert.deepEqual(await response.json(), { ok: true, ...saved });
});

test("cashier and legacy product actions expose the same safe success shape", async () => {
  const legacy = await handleMerchantMembershipsPatch(request(), dependencies());
  const cashier = await handleMerchantMembershipsPatch(request({ action: "member_redemption_checkout", redemptionItems: [{ redemptionItemId: "item-one", quantity: 2 }] }), dependencies({
    applyRedemptionCheckout: async (input) => { assert.deepEqual(input.items, [{ redemptionItemId: "item-one", quantity: 2 }]); return result(); },
  }));
  assert.equal(cashier.status, 200); assert.deepEqual(await legacy.json(), await cashier.json());
});

for (const [code, status] of [["unauthorized", 401], ["permission_denied", 403]] as const) {
  test(`${code} prevents any checkout or legacy write`, async () => {
    const response = await handleMerchantMembershipsPatch(request(), dependencies({
      authorizeActor: async () => { throw new MerchantBusinessAccessError(code, status); },
      applyRedemptionCheckout: async () => { assert.fail("denied checkout cannot write"); },
    }));
    assert.equal(response.status, status); privateHeaders(response); assert.deepEqual(await response.json(), { error: code });
  });
}

test("cross-merchant authorization failure cannot reach the checkout service", async () => {
  const response = await handleMerchantMembershipsPatch(request({ siteId: "20000000" }), dependencies({
    authorizeActor: async (_request, input) => { assert.equal(input.siteId, "20000000"); throw new MerchantBusinessAccessError("permission_denied", 403); },
    applyRedemptionCheckout: async () => { assert.fail("cross-site cannot write"); },
  }));
  assert.equal(response.status, 403); privateHeaders(response);
});

test("untrusted origin is rejected before auth, input parsing or writes", async () => {
  const response = await handleMerchantMembershipsPatch(request({}, { origin: "https://attacker.example" }), dependencies({
    authorizeActor: async () => { assert.fail("must reject first"); },
  }));
  assert.equal(response.status, 403); privateHeaders(response);
});

test("authorization revoked inside the operation or before response never releases a success payload", async () => {
  for (const insideOperation of [true, false]) {
    const response = await handleMerchantMembershipsPatch(request(), dependencies({
      reauthorizeActor: async () => { throw new MerchantBusinessAccessError("permission_denied", 403); },
      applyRedemptionCheckout: async (input) => { if (insideOperation) await input.assertAuthorizationCurrent?.(); return result(); },
    }));
    assert.equal(response.status, 403); assert.deepEqual(await response.json(), { error: "permission_denied" });
  }
});

for (const redemptionItemId of [" ", "x".repeat(121), 123, {}, []]) {
  test(`invalid product selection ${JSON.stringify(redemptionItemId).slice(0, 32)} never becomes a manual debit`, async () => {
    const response = await handleMerchantMembershipsPatch(request({ redemptionItemId, points: 80 }), dependencies({
      applyRedemptionCheckout: async () => { assert.fail("invalid selection cannot write"); },
    }));
    assert.equal(response.status, 400); assert.equal((await response.json()).message, "membership_redemption_item_invalid");
  });
}

test("unavailable commit and internal storage errors expose only the safe unknown-result code", async () => {
  const response = await handleMerchantMembershipsPatch(request(), dependencies({
    applyRedemptionCheckout: async () => { throw new Error("SQL private@example.test credential=secret transaction response missing"); },
  }));
  assert.equal(response.status, 503); privateHeaders(response);
  assert.deepEqual(await response.json(), { error: "merchant_transaction_unavailable", message: "merchant_transaction_unavailable" });
});

for (const code of ["redemption_pending_checkout_exists", "redemption_checkout_cancelled", "redemption_checkout_quote_changed", "redemption_operation_conflict"]) {
  test(`${code} is preserved as a conflict without legacy fallback`, async () => {
    const response = await handleMerchantMembershipsPatch(request(), dependencies({ applyRedemptionCheckout: async () => { throw new Error(code); } }));
    assert.equal(response.status, 409); assert.equal((await response.json()).message, code);
  });
}

for (const type of ["recharge", "redeem"] as const) {
  test(`non-product ${type} preserves its original membership-only contract`, async () => {
    const member = result().membership!;
    const response = await handleMerchantMembershipsPatch(request({ type, redemptionItemId: "", points: 7, balanceAmount: 1 }), dependencies({
      authorizeActor: async (_request, input) => { assert.equal(input.requiredPermission, type === "recharge" ? "redemptions.recharge" : "redemptions.checkout"); return actor(); },
      applyRedemptionCheckout: async () => { assert.fail("must retain original operation"); },
      applyAccountOperation: async (input) => { assert.equal(input.type, type); assert.equal(input.points, 7); assert.equal(input.balanceAmount, 1); return member; },
    }));
    assert.equal(response.status, 200); const body = await response.json();
    assert.ok(body.membership); assert.equal("receipt" in body, false); assert.equal("replayed" in body, false);
  });
}

test("the membership-only service fails closed for product checkout rather than swallowing its receipt", async () => {
  for (const redemptionItemId of ["item-one", " ", 123, {}, []]) {
    await assert.rejects(() => applyMerchantMembershipAccountOperation({ siteId: SITE, membershipId: "member-one", type: "redeem", redemptionItemId }), /redemption_checkout_context_required/);
  }
});
