import assert from "node:assert/strict";
import test from "node:test";
import {
  commitMerchantOrderMembershipTransaction,
  type MerchantTransactionClient,
} from "@/lib/merchantOrderMembershipTransaction.server";

const mutation = { orders: { expectedRows: [], next: [] } };

test("transaction client sends the exact scoped RPC and requires a commit receipt", async () => {
  const calls: unknown[] = [];
  const result = await commitMerchantOrderMembershipTransaction({
    rpc: async (name, args) => {
      calls.push({ name, args });
      return { data: { updatedAt: "2026-09-08T12:00:00.001Z" }, error: null };
    },
  }, "10000000", mutation);
  assert.equal(result.error, null);
  assert.deepEqual(calls, [{ name: "faolla_commit_order_membership_v1", args: {
    p_site_id: "10000000", p_mutation: mutation,
  } }]);
});

test("missing RPC is unavailable, not a legacy write fallback", async () => {
  assert.deepEqual(await commitMerchantOrderMembershipTransaction({}, "10000000", mutation), {
    error: "merchant_transaction_unavailable",
  });
});

for (const message of ["order_update_conflict", "merchant_memberships_conflict"]) {
  test(`CAS ${message} is retained for safe conflict handling`, async () => {
    assert.equal((await commitMerchantOrderMembershipTransaction({
      rpc: async () => ({ error: { message } }),
    }, "10000000", mutation)).error, message);
  });
}

test("transport and SQL details are sanitized without retry or compensation", async () => {
  for (const throws of [false, true]) {
    let count = 0;
    const client: MerchantTransactionClient = { rpc: async () => {
      count += 1;
      if (throws) throw new Error("network dropped after COMMIT; private details");
      return { error: { message: "SQL private row contents" } };
    } };
    assert.equal((await commitMerchantOrderMembershipTransaction(client, "10000000", mutation)).error,
      "merchant_transaction_unavailable");
    assert.equal(count, 1);
  }
});

test("empty and malformed success receipts are not false positives", async () => {
  for (const data of [null, [], {}, { updatedAt: "bad" }, { updatedAt: 1 }]) {
    assert.equal((await commitMerchantOrderMembershipTransaction({ rpc: async () => ({ data }) },
      "10000000", mutation)).error, "merchant_transaction_unavailable");
  }
});

test("invalid or wildcard tenant identifiers are rejected before RPC", async () => {
  for (const siteId of ["", " 10000000", "site:chunk:1", "site%", "a".repeat(65)]) {
    assert.equal((await commitMerchantOrderMembershipTransaction({ rpc: async () => {
      assert.fail("invalid tenant must not reach database");
    } }, siteId, mutation)).error, "invalid_site_id");
  }
});
