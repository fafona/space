import assert from "node:assert/strict";
import test from "node:test";
import {
  completeOrdinarySignupIntentRecord,
  createOrdinarySignupIntent,
  matchesOrdinarySignupIntent,
  readOrdinarySignupIntentRecord,
  reissueOrdinarySignupIntent,
  verifyOrdinarySignupIntentToken,
} from "@/lib/ordinarySignupIntent.server";

test("ordinary signup intent binds Auth UUID, email, type, nonce and expiry", () => {
  const previous = process.env.ORDINARY_SIGNUP_INTENT_SECRET;
  process.env.ORDINARY_SIGNUP_INTENT_SECRET = "signup-intent-unit-secret";
  const now = Date.UTC(2026, 7, 19, 12, 0, 0);
  try {
    const created = createOrdinarySignupIntent({
      userId: "11111111-1111-4111-8111-111111111111",
      email: "member@example.com",
      accountType: "personal",
      nonce: "n".repeat(43),
      now,
    });
    assert.ok(created);
    const token = verifyOrdinarySignupIntentToken(created.token, now);
    const record = readOrdinarySignupIntentRecord({
      ordinary_signup_intent_v1: created.record,
    });
    assert.equal(
      matchesOrdinarySignupIntent({
        record,
        token,
        userId: created.payload.userId,
        email: created.payload.email,
        accountType: "personal",
        requirePending: true,
        now,
      }),
      true,
    );
    for (const mismatch of [
      { userId: "22222222-2222-4222-8222-222222222222" },
      { email: "other@example.com" },
      { accountType: "merchant" as const },
    ]) {
      assert.equal(
        matchesOrdinarySignupIntent({
          record,
          token,
          userId: mismatch.userId ?? created.payload.userId,
          email: mismatch.email ?? created.payload.email,
          accountType: mismatch.accountType ?? "personal",
          requirePending: true,
          now,
        }),
        false,
      );
    }
    assert.equal(
      verifyOrdinarySignupIntentToken(created.token, now + 31 * 60_000),
      null,
    );
    assert.equal(
      matchesOrdinarySignupIntent({
        record: completeOrdinarySignupIntentRecord(created.record, now),
        token,
        userId: created.payload.userId,
        email: created.payload.email,
        accountType: "personal",
        requirePending: true,
        now,
      }),
      false,
    );
  } finally {
    process.env.ORDINARY_SIGNUP_INTENT_SECRET = previous;
  }
});

test("ordinary signup intent can reissue only its exact pending deterministic proof", () => {
  const previous = process.env.ORDINARY_SIGNUP_INTENT_SECRET;
  process.env.ORDINARY_SIGNUP_INTENT_SECRET = "signup-intent-reissue-secret";
  const now = Date.UTC(2026, 7, 19, 12, 0, 0);
  try {
    const created = createOrdinarySignupIntent({
      userId: "33333333-3333-4333-8333-333333333333",
      email: "recovery@example.com",
      accountType: "merchant",
      now,
    });
    assert.ok(created);
    const reissued = reissueOrdinarySignupIntent({
      record: created.record,
      userId: created.payload.userId,
      email: created.payload.email,
      accountType: "merchant",
      now: now + 10_000,
    });
    assert.ok(reissued);
    assert.deepEqual(
      verifyOrdinarySignupIntentToken(reissued.token, now + 10_000),
      created.payload,
    );
    for (const candidate of [
      { email: "other@example.com", accountType: "merchant" as const },
      { email: created.payload.email, accountType: "personal" as const },
    ]) {
      assert.equal(
        reissueOrdinarySignupIntent({
          record: created.record,
          userId: created.payload.userId,
          email: candidate.email,
          accountType: candidate.accountType,
          now: now + 10_000,
        }),
        null,
      );
    }
    assert.equal(
      reissueOrdinarySignupIntent({
        record: created.record,
        userId: "44444444-4444-4444-8444-444444444444",
        email: created.payload.email,
        accountType: "merchant",
        now: now + 10_000,
      }),
      null,
    );
    assert.equal(
      reissueOrdinarySignupIntent({
        record: created.record,
        userId: created.payload.userId,
        email: created.payload.email,
        accountType: "merchant",
        now: now + 31 * 60_000,
      }),
      null,
    );
    assert.equal(
      reissueOrdinarySignupIntent({
        record: { ...created.record, nonceHash: "a".repeat(43) },
        userId: created.payload.userId,
        email: created.payload.email,
        accountType: "merchant",
        now: now + 10_000,
      }),
      null,
    );
  } finally {
    process.env.ORDINARY_SIGNUP_INTENT_SECRET = previous;
  }
});
