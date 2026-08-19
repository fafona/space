import assert from "node:assert/strict";
import test from "node:test";
import {
  isCanonicalPersonalAccountId,
  normalizeCanonicalPersonalAccountId,
} from "@/lib/personalAccountId";

test("personal account ids use only the reserved eight-digit product range", () => {
  for (const value of ["50010105", "59999999"]) {
    assert.equal(normalizeCanonicalPersonalAccountId(value), value);
    assert.equal(isCanonicalPersonalAccountId(value), true);
  }
  for (const value of [
    "50010104",
    "60000000",
    "12345678",
    "personal",
    " 50010105",
    "50010105 ",
    "5001\u0000105",
    "😀".repeat(128),
  ]) {
    assert.equal(normalizeCanonicalPersonalAccountId(value), "");
    assert.equal(isCanonicalPersonalAccountId(value), false);
  }
});
