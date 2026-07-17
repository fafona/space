import assert from "node:assert/strict";
import test from "node:test";
import {
  createGoogleBusinessProfileOAuthState,
  decryptGoogleBusinessProfileSecret,
  encryptGoogleBusinessProfileSecret,
  verifyGoogleBusinessProfileOAuthState,
} from "./googleBusinessProfileCrypto";

function mutate(value: string) {
  if (!value) return "x";
  return `${value[0] === "a" ? "b" : "a"}${value.slice(1)}`;
}

test("encrypts Google tokens and rejects modified ciphertext", { concurrency: false }, () => {
  const previous = process.env.GOOGLE_BUSINESS_PROFILE_TOKEN_KEY;
  process.env.GOOGLE_BUSINESS_PROFILE_TOKEN_KEY = "test-only-google-business-profile-key";
  try {
    const encrypted = encryptGoogleBusinessProfileSecret("refresh-token-value");
    assert.equal(decryptGoogleBusinessProfileSecret(encrypted), "refresh-token-value");
    assert.throws(
      () => decryptGoogleBusinessProfileSecret({ ...encrypted, ciphertext: mutate(encrypted.ciphertext) }),
      /google_business_profile_secret_decrypt_failed/,
    );
  } finally {
    if (previous === undefined) delete process.env.GOOGLE_BUSINESS_PROFILE_TOKEN_KEY;
    else process.env.GOOGLE_BUSINESS_PROFILE_TOKEN_KEY = previous;
  }
});

test("signs OAuth state and rejects a modified signature", { concurrency: false }, () => {
  const previous = process.env.GOOGLE_BUSINESS_PROFILE_TOKEN_KEY;
  process.env.GOOGLE_BUSINESS_PROFILE_TOKEN_KEY = "test-only-google-business-profile-key";
  try {
    const state = createGoogleBusinessProfileOAuthState("10000000");
    assert.equal(verifyGoogleBusinessProfileOAuthState(state)?.siteId, "10000000");
    const [payload, signature] = state.split(".");
    assert.equal(verifyGoogleBusinessProfileOAuthState(`${payload}.${mutate(signature)}`), null);
  } finally {
    if (previous === undefined) delete process.env.GOOGLE_BUSINESS_PROFILE_TOKEN_KEY;
    else process.env.GOOGLE_BUSINESS_PROFILE_TOKEN_KEY = previous;
  }
});
