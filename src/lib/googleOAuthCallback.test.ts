import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCleanGoogleOAuthReturnPath,
  hasGoogleOAuthCode,
  hasGoogleOAuthReturnPayload,
  readGoogleOAuthUrlTokens,
  readGoogleOAuthUrlCode,
  readGoogleOAuthUrlError,
} from "./googleOAuthCallback";

test("reads Google OAuth implicit tokens from hash or search", () => {
  assert.deepEqual(
    readGoogleOAuthUrlTokens("https://faolla.com/login?oauth=google#access_token=a&refresh_token=r&expires_in=3600"),
    {
      access_token: "a",
      refresh_token: "r",
      expires_in: 3600,
      token_type: undefined,
    },
  );
  assert.deepEqual(
    readGoogleOAuthUrlTokens("https://faolla.com/login?oauth=google&access_token=a&refresh_token=r&token_type=bearer"),
    {
      access_token: "a",
      refresh_token: "r",
      expires_in: undefined,
      token_type: "bearer",
    },
  );
});

test("detects Google OAuth callback payload without treating an empty marker as payload", () => {
  assert.equal(hasGoogleOAuthCode("https://faolla.com/login?oauth=google&code=abc&state=xyz"), true);
  assert.equal(hasGoogleOAuthCode("https://faolla.com/login?oauth=google#code=abc&state=xyz"), true);
  assert.equal(readGoogleOAuthUrlCode("https://faolla.com/login?oauth=google#code=abc&state=xyz"), "abc");
  assert.equal(readGoogleOAuthUrlError("https://faolla.com/login?oauth=google#error=access_denied"), "access_denied");
  assert.equal(hasGoogleOAuthReturnPayload("https://faolla.com/login?oauth=google&code=abc&state=xyz"), true);
  assert.equal(hasGoogleOAuthReturnPayload("https://faolla.com/login?oauth=google#code=abc&state=xyz"), true);
  assert.equal(hasGoogleOAuthReturnPayload("https://faolla.com/login?oauth=google#error=access_denied"), true);
  assert.equal(hasGoogleOAuthReturnPayload("https://faolla.com/login?oauth=google"), false);
});

test("cleans transient Google OAuth return params but preserves entry context", () => {
  assert.equal(
    buildCleanGoogleOAuthReturnPath(
      "https://faolla.com/login?oauth=google&accountType=personal&loginFrom=https%3A%2F%2Ffaolla.com%2F&code=abc&state=xyz#__provider_token=hidden",
    ),
    "/login?accountType=personal&loginFrom=https%3A%2F%2Ffaolla.com%2F",
  );
});
