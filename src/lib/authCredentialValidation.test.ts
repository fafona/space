import assert from "node:assert/strict";
import test from "node:test";
import {
  AUTH_ACCOUNT_MAX_LENGTH,
  AUTH_EMAIL_MAX_LENGTH,
  AUTH_PASSWORD_MAX_LENGTH,
  isAuthRateLimitError,
  isValidAuthAccount,
  isValidAuthEmail,
  isValidAuthPassword,
  isValidAuthVerificationCode,
  normalizeAuthEmail,
  normalizeAuthVerificationCode,
} from "@/lib/authCredentialValidation";

test("auth credential validation normalizes email and verification codes", () => {
  assert.equal(normalizeAuthEmail("  USER@Example.COM "), "user@example.com");
  assert.equal(normalizeAuthVerificationCode(" 12 34 56 "), "123456");
});

test("auth credential validation enforces bounded account and email input", () => {
  assert.equal(isValidAuthAccount("merchant name"), true);
  assert.equal(isValidAuthAccount("a".repeat(AUTH_ACCOUNT_MAX_LENGTH + 1)), false);
  assert.equal(isValidAuthAccount("merchant\nname"), false);
  assert.equal(isValidAuthEmail("member@example.com"), true);
  assert.equal(isValidAuthEmail("member@example"), false);
  assert.equal(isValidAuthEmail(`${"a".repeat(AUTH_EMAIL_MAX_LENGTH)}@example.com`), false);
});

test("auth credential validation enforces password and code limits", () => {
  assert.equal(isValidAuthPassword("12345"), false);
  assert.equal(isValidAuthPassword("123456"), true);
  assert.equal(isValidAuthPassword("x".repeat(AUTH_PASSWORD_MAX_LENGTH + 1)), false);
  assert.equal(isValidAuthVerificationCode("123456"), true);
  assert.equal(isValidAuthVerificationCode("12ab56"), false);
  assert.equal(isValidAuthVerificationCode("123"), false);
});

test("auth credential validation recognizes upstream rate limits", () => {
  assert.equal(isAuthRateLimitError({ status: 429 }), true);
  assert.equal(isAuthRateLimitError({ message: "Email rate limit exceeded" }), true);
  assert.equal(isAuthRateLimitError({ status: 503, message: "temporarily unavailable" }), false);
});
