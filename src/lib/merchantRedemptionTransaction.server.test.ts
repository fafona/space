import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMerchantRedemptionFingerprint,
  commitMerchantRedemptionTransaction,
  lookupMerchantRedemptionOperation,
  requireMerchantRedemptionOperationId,
  type MerchantRedemptionMutation,
} from "@/lib/merchantRedemptionTransaction.server";
import { createEmptyMerchantMembershipSettings } from "@/lib/merchantMembershipSettings";
import type { MerchantTransactionClient } from "@/lib/merchantOrderMembershipTransaction.server";

const SITE = "10000000";
const STAMP = "2026-09-08T10:00:00.001Z";
const intent = {
  siteId: SITE, membershipId: "member-a", operatorId: "staff:one", note: "Front desk",
  items: [{ itemId: "one", quantity: 1 }, { itemId: "two", quantity: 2 }],
};
const operation = { id: "checkout:one", membershipId: "member-a", fingerprint: buildMerchantRedemptionFingerprint(intent) };
const mutation: MerchantRedemptionMutation = {
  operation,
  settings: { expectedUpdatedAt: null, next: createEmptyMerchantMembershipSettings(SITE) },
  coupons: { expectedUpdatedAt: null, next: [] },
  memberships: { expectedUpdatedAt: STAMP, next: [] },
};

function receipt() {
  return { updatedAt: STAMP, replayed: false, membershipId: "member-a", versions: { settings: STAMP, coupons: null, memberships: STAMP } };
}

test("redemption fingerprints canonicalize object keys and cart item order without losing multiplicity", () => {
  const original = buildMerchantRedemptionFingerprint(intent);
  assert.match(original, /^[0-9a-f]{64}$/);
  assert.equal(original, buildMerchantRedemptionFingerprint({ ...intent, items: [
    { quantity: 2, itemId: "two" }, { quantity: 1, itemId: "one" },
  ] }));
  assert.equal(buildMerchantRedemptionFingerprint({ ...intent, items: [{ nested: { z: 2, a: 1 }, itemId: "one" }] }),
    buildMerchantRedemptionFingerprint({ ...intent, items: [{ itemId: "one", nested: { a: 1, z: 2 } }] }));
  assert.notEqual(original, buildMerchantRedemptionFingerprint({ ...intent, items: [...intent.items, intent.items[0]] }));
});

test("redemption fingerprint binds tenant, member, operator, note and normalized cart contents", () => {
  const original = buildMerchantRedemptionFingerprint(intent);
  for (const patch of [
    { siteId: "20000000" }, { membershipId: "member-b" }, { operatorId: "staff:two" },
    { note: "Other note" }, { items: [{ itemId: "one", quantity: 2 }, intent.items[1]] },
    { items: [{ itemId: "other", quantity: 1 }, intent.items[1]] },
    { items: [{ itemId: "one", quantity: 1, couponSettlementCode: "other-code" }, intent.items[1]] },
  ]) assert.notEqual(original, buildMerchantRedemptionFingerprint({ ...intent, ...patch }));
});

test("operation IDs accept only the fixed alphabet and never truncate or replace invalid input", () => {
  assert.equal(requireMerchantRedemptionOperationId(" checkout.A-b_c:001 "), "checkout.A-b_c:001");
  assert.equal(requireMerchantRedemptionOperationId("x".repeat(120)), "x".repeat(120));
  for (const value of [null, undefined, "", "   ", 123]) {
    assert.throws(() => requireMerchantRedemptionOperationId(value), /mutation_operation_id_required/);
  }
  for (const value of ["x".repeat(121), "bad operation", "checkout/1", "checkout?1", "checkout\n1", "结算-1"]) {
    assert.throws(() => requireMerchantRedemptionOperationId(value), /mutation_operation_id_invalid/);
  }
  assert.notEqual(requireMerchantRedemptionOperationId("checkout-1"), requireMerchantRedemptionOperationId("checkout_1"));
});

test("redemption transaction sends exactly the scoped prepared mutation and returns confirmed versions", async () => {
  const calls: unknown[] = [];
  const result = await commitMerchantRedemptionTransaction({ rpc: async (name, args) => {
    calls.push({ name, args }); return { data: receipt(), error: null };
  } }, SITE, mutation);
  assert.deepEqual(calls, [{ name: "faolla_commit_redemption_v1", args: { p_site_id: SITE, p_mutation: mutation } }]);
  assert.deepEqual(result, { error: null, replayed: false, membershipId: "member-a", versions: receipt().versions });
});

test("durable operation replay requires the bound member and may omit obsolete domain versions", async () => {
  const result = await commitMerchantRedemptionTransaction({ rpc: async () => ({
    data: { updatedAt: STAMP, replayed: true, membershipId: "member-a", versions: {} },
  }) }, SITE, mutation);
  assert.deepEqual(result, { error: null, replayed: true, membershipId: "member-a", versions: {} });
  for (const membershipId of [undefined, "member-b"]) {
    assert.equal((await commitMerchantRedemptionTransaction({ rpc: async () => ({
      data: { updatedAt: STAMP, replayed: true, membershipId, versions: {} },
    }) }, SITE, mutation)).error, "merchant_transaction_unavailable");
  }
});

test("ordinary writes cannot use an impossible replay receipt to bypass domain version checks", async () => {
  assert.equal((await commitMerchantRedemptionTransaction({ rpc: async () => ({
    data: { updatedAt: STAMP, replayed: true, versions: {} },
  }) }, SITE, { coupons: { expectedUpdatedAt: null, next: [] } })).error, "merchant_transaction_unavailable");
});

test("fresh receipts require every requested domain, including explicit null for absent no-op documents", async () => {
  for (const missingDomain of ["settings", "coupons", "memberships"]) {
    const versions: Record<string, string | null> = { ...receipt().versions };
    delete versions[missingDomain];
    assert.equal((await commitMerchantRedemptionTransaction({ rpc: async () => ({ data: { ...receipt(), versions } }) }, SITE, mutation)).error,
      "merchant_transaction_unavailable");
  }
  assert.equal((await commitMerchantRedemptionTransaction({ rpc: async () => ({
    data: { updatedAt: STAMP, replayed: false, versions: { coupons: null } },
  }) }, SITE, { coupons: { expectedUpdatedAt: null, next: [] } })).error, null);
});

test("malformed or mismatched success receipts fail closed", async () => {
  for (const data of [
    null, [], {}, { ...receipt(), updatedAt: "invalid" }, { ...receipt(), updatedAt: 1 },
    { ...receipt(), replayed: undefined }, { ...receipt(), replayed: "false" },
    { ...receipt(), versions: null }, { ...receipt(), versions: [] },
    { ...receipt(), versions: { ...receipt().versions, coupons: "invalid" } },
    { ...receipt(), versions: { ...receipt().versions, coupons: 1 } },
    { ...receipt(), membershipId: "member-b" },
  ]) assert.equal((await commitMerchantRedemptionTransaction({ rpc: async () => ({ data }) }, SITE, mutation)).error,
    "merchant_transaction_unavailable");
});

test("receipt lookup uses the exact tenant and bound operation without performing a mutation", async () => {
  const calls: unknown[] = [];
  assert.deepEqual(await lookupMerchantRedemptionOperation({ rpc: async (name, args) => {
    calls.push({ name, args }); return { data: { committed: true, membershipId: "member-a" } };
  } }, SITE, operation), { error: null, committed: true, membershipId: "member-a" });
  assert.deepEqual(calls, [{ name: "faolla_get_redemption_operation_v1", args: {
    p_site_id: SITE, p_operation_id: operation.id, p_fingerprint: operation.fingerprint, p_membership_id: "member-a",
  } }]);
  assert.deepEqual(await lookupMerchantRedemptionOperation({ rpc: async () => ({ data: { committed: false } }) }, SITE, operation),
    { error: null, committed: false });
});

test("lookup rejects malformed receipts or another member instead of inventing a committed operation", async () => {
  for (const data of [null, [], {}, { committed: "true" }, { committed: true }, { committed: true, membershipId: "member-b" }]) {
    assert.equal((await lookupMerchantRedemptionOperation({ rpc: async () => ({ data }) }, SITE, operation)).error,
      "merchant_transaction_unavailable");
  }
});

test("invalid tenants and missing RPC are rejected without fallback", async () => {
  const forbidden: MerchantTransactionClient = { rpc: async () => { assert.fail("RPC must not be called"); } };
  for (const siteId of ["", " 10000000", "site%", "site:chunk:1", "x".repeat(65)]) {
    assert.equal((await commitMerchantRedemptionTransaction(forbidden, siteId, mutation)).error, "invalid_site_id");
    assert.equal((await lookupMerchantRedemptionOperation(forbidden, siteId, operation)).error, "invalid_site_id");
  }
  assert.equal((await commitMerchantRedemptionTransaction({}, SITE, mutation)).error, "merchant_transaction_unavailable");
  assert.equal((await lookupMerchantRedemptionOperation({}, SITE, operation)).error, "merchant_transaction_unavailable");
});

test("known conflict errors survive without retry while private database and transport errors are contained", async () => {
  for (const message of [
    "invalid_site_id", "merchant_membership_settings_conflict", "merchant_coupons_conflict",
    "merchant_memberships_conflict", "redemption_operation_conflict", "SQL internal private data",
  ]) {
    for (const throws of [false, true]) {
      let calls = 0;
      const client: MerchantTransactionClient = { rpc: async () => {
        calls += 1;
        if (throws) throw new Error(message);
        return { error: { message } };
      } };
      const expected = message === "SQL internal private data" ? "merchant_transaction_unavailable" : message;
      assert.equal((await commitMerchantRedemptionTransaction(client, SITE, mutation)).error, expected);
      assert.equal(calls, 1);
      assert.equal((await lookupMerchantRedemptionOperation(client, SITE, operation)).error, expected);
      assert.equal(calls, 2);
    }
  }
});
