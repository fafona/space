import test from "node:test";
import assert from "node:assert/strict";
import { hasConflictingMerchantSlug } from "@/app/api/merchant-domain-binding/route";

test("hasConflictingMerchantSlug ignores rows owned by the same merchant", () => {
  assert.equal(
    hasConflictingMerchantSlug(
      [
        { merchant_id: "10000000", slug: "abc" },
        { merchant_id: "10000000", slug: "abc" },
      ],
      "10000000",
    ),
    false,
  );
});

test("hasConflictingMerchantSlug blocks rows owned by another merchant", () => {
  assert.equal(
    hasConflictingMerchantSlug(
      [
        { merchant_id: "10000000", slug: "abc" },
        { merchant_id: "10000001", slug: "abc" },
      ],
      "10000000",
    ),
    true,
  );
});
