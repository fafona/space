import test from "node:test";
import assert from "node:assert/strict";
import { normalizeMerchantEmail } from "@/lib/merchantAuthIdentity";

test("merchant auth email normalization is a bounded login hint, not an account binding", () => {
  assert.equal(
    normalizeMerchantEmail("", " Owner@Example.COM "),
    "owner@example.com",
  );
});
