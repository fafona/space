import assert from "node:assert/strict";
import test from "node:test";
import {
  isCanonicalPersonalAccountId,
  matchesExactPersonalIdentity,
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

test("stored personal ownership requires every present canonical identifier and never falls back", () => {
  assert.equal(
    matchesExactPersonalIdentity(
      { accountId: "50010105", userId: "11111111-1111-4111-8111-111111111111" },
      { accountId: "50010105", userId: "11111111-1111-4111-8111-111111111111" },
    ),
    true,
  );
  assert.equal(
    matchesExactPersonalIdentity(
      { accountId: "50010105", userId: "11111111-1111-4111-8111-111111111111" },
      { accountId: "50010105", userId: "22222222-2222-4222-8222-222222222222" },
    ),
    false,
  );
  assert.equal(
    matchesExactPersonalIdentity(
      { accountId: "50010105" },
      { accountId: "50010105", userId: "22222222-2222-4222-8222-222222222222" },
    ),
    true,
  );
  assert.equal(
    matchesExactPersonalIdentity(
      { accountId: "", userId: "" },
      { accountId: "50010105", userId: "11111111-1111-4111-8111-111111111111" },
    ),
    false,
  );
  assert.equal(
    matchesExactPersonalIdentity(
      { accountId: " 50010105", userId: "" },
      { accountId: "50010105", userId: "" },
    ),
    false,
  );
});
