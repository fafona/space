import assert from "node:assert/strict";
import test from "node:test";
import { NextResponse } from "next/server";
import {
  MERCHANT_AUTH_COOKIE,
  MERCHANT_AUTH_REFRESH_COOKIE,
  parseCookieValue,
  readMerchantAuthRefreshCookie,
  readMerchantRequestAccessTokens,
  setMerchantAuthCookies,
} from "./merchantAuthSession";

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

test("readMerchantAuthRefreshCookie reads the refresh token cookie", () => {
  const request = new Request("http://localhost/api/business-card-share", {
    headers: {
      cookie: `${MERCHANT_AUTH_COOKIE}=access-token; ${MERCHANT_AUTH_REFRESH_COOKIE}=refresh-token`,
    },
  });

  assert.equal(readMerchantAuthRefreshCookie(request), "refresh-token");
});

test("setMerchantAuthCookies writes browser-session cookies", () => {
  const response = NextResponse.json({ ok: true });
  setMerchantAuthCookies(response, {
    accessToken: "access-token",
    refreshToken: "refresh-token",
    maxAgeSeconds: 3600,
  });

  assert.equal(response.cookies.get(MERCHANT_AUTH_COOKIE)?.maxAge, 3600);
  assert.equal(response.cookies.get(MERCHANT_AUTH_REFRESH_COOKIE)?.maxAge, 30 * 24 * 60 * 60);
});

test("setMerchantAuthCookies shares cookies across faolla subdomains", () => {
  const response = NextResponse.json({ ok: true });
  const request = new Request("https://fafona.faolla.com/api/auth/merchant-login");
  setMerchantAuthCookies(
    response,
    {
      accessToken: "access-token",
      refreshToken: "refresh-token",
      maxAgeSeconds: 3600,
    },
    request,
  );

  assert.equal(response.cookies.get(MERCHANT_AUTH_COOKIE)?.domain, "faolla.com");
  assert.equal(response.cookies.get(MERCHANT_AUTH_REFRESH_COOKIE)?.domain, "faolla.com");
});
