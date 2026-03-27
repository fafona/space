import assert from "node:assert/strict";
import test from "node:test";
import { MERCHANT_AUTH_COOKIE, parseCookieValue, readMerchantRequestAccessTokens } from "./merchantAuthSession";

test("parseCookieValue reads the merchant auth cookie from a header", () => {
  assert.equal(
    parseCookieValue(`foo=bar; ${MERCHANT_AUTH_COOKIE}=token-123; hello=world`, MERCHANT_AUTH_COOKIE),
    "token-123",
  );
});

test("readMerchantRequestAccessTokens prefers bearer token and keeps cookie fallback", () => {
  const request = new Request("http://localhost/api/business-card-share", {
    headers: {
      authorization: "Bearer bearer-token",
      cookie: `${MERCHANT_AUTH_COOKIE}=cookie-token`,
    },
  });

  assert.deepEqual(readMerchantRequestAccessTokens(request), ["bearer-token", "cookie-token"]);
});

test("readMerchantRequestAccessTokens removes duplicate request tokens", () => {
  const request = new Request("http://localhost/api/business-card-share", {
    headers: {
      authorization: "Bearer same-token",
      cookie: `${MERCHANT_AUTH_COOKIE}=same-token`,
    },
  });

  assert.deepEqual(readMerchantRequestAccessTokens(request), ["same-token"]);
});
