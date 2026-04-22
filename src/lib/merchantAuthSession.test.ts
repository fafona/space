import assert from "node:assert/strict";
import test from "node:test";
import { NextResponse } from "next/server";
import {
  MERCHANT_AUTH_COOKIE,
  MERCHANT_AUTH_MERCHANT_ID_COOKIE,
  MERCHANT_AUTH_REFRESH_COOKIE,
  parseCookieValue,
  parseCookieValues,
  readMerchantAuthMerchantIdCookie,
  readMerchantAuthRefreshCookie,
  readMerchantRequestAccessTokens,
  readMerchantRequestRefreshTokens,
  setMerchantAuthCookies,
} from "./merchantAuthSession";

test("parseCookieValue reads the merchant auth cookie from a header", () => {
  assert.equal(
    parseCookieValue(`foo=bar; ${MERCHANT_AUTH_COOKIE}=token-123; hello=world`, MERCHANT_AUTH_COOKIE),
    "token-123",
  );
});

test("parseCookieValue prefers the latest non-empty duplicate cookie value", () => {
  assert.equal(
    parseCookieValue(
      `${MERCHANT_AUTH_COOKIE}=; ${MERCHANT_AUTH_COOKIE}=stale-token; ${MERCHANT_AUTH_COOKIE}=fresh-token`,
      MERCHANT_AUTH_COOKIE,
    ),
    "fresh-token",
  );
  assert.deepEqual(
    parseCookieValues(
      `${MERCHANT_AUTH_COOKIE}=; ${MERCHANT_AUTH_COOKIE}=stale-token; ${MERCHANT_AUTH_COOKIE}=fresh-token`,
      MERCHANT_AUTH_COOKIE,
    ),
    ["", "stale-token", "fresh-token"],
  );
});

test("readMerchantRequestAccessTokens only reads the httpOnly merchant auth cookie", () => {
  const request = new Request("http://localhost/api/business-card-share", {
    headers: {
      authorization: "Bearer bearer-token",
      cookie: `${MERCHANT_AUTH_COOKIE}=cookie-token`,
    },
  });

  assert.deepEqual(readMerchantRequestAccessTokens(request), ["cookie-token"]);
});

test("readMerchantRequestAccessTokens ignores duplicate cookie tokens", () => {
  const request = new Request("http://localhost/api/business-card-share", {
    headers: {
      authorization: "Bearer same-token",
      cookie: `${MERCHANT_AUTH_COOKIE}=same-token`,
    },
  });

  assert.deepEqual(readMerchantRequestAccessTokens(request), ["same-token"]);
});

test("readMerchantRequestAccessTokens prefers the newest value but keeps older candidates for fallback", () => {
  const request = new Request("http://localhost/api/business-card-share", {
    headers: {
      cookie: `${MERCHANT_AUTH_COOKIE}=fresh-token; ${MERCHANT_AUTH_COOKIE}=stale-token; ${MERCHANT_AUTH_COOKIE}=fresh-token`,
    },
  });

  assert.deepEqual(readMerchantRequestAccessTokens(request), ["fresh-token", "stale-token"]);
});

test("readMerchantAuthRefreshCookie reads the refresh token cookie", () => {
  const request = new Request("http://localhost/api/business-card-share", {
    headers: {
      cookie: `${MERCHANT_AUTH_COOKIE}=access-token; ${MERCHANT_AUTH_REFRESH_COOKIE}=refresh-token`,
    },
  });

  assert.equal(readMerchantAuthRefreshCookie(request), "refresh-token");
});

test("readMerchantRequestRefreshTokens preserves older refresh cookies for session fallback", () => {
  const request = new Request("http://localhost/api/business-card-share", {
    headers: {
      cookie: `${MERCHANT_AUTH_REFRESH_COOKIE}=fresh-refresh; ${MERCHANT_AUTH_REFRESH_COOKIE}=stale-refresh`,
    },
  });

  assert.deepEqual(readMerchantRequestRefreshTokens(request), ["stale-refresh", "fresh-refresh"]);
});

test("setMerchantAuthCookies writes browser-session cookies", () => {
  const response = NextResponse.json({ ok: true });
  setMerchantAuthCookies(response, {
    accessToken: "access-token",
    refreshToken: "refresh-token",
    maxAgeSeconds: 3600,
    merchantId: "12345678",
  });

  assert.equal(response.cookies.get(MERCHANT_AUTH_COOKIE)?.maxAge, 3600);
  assert.equal(response.cookies.get(MERCHANT_AUTH_REFRESH_COOKIE)?.maxAge, 30 * 24 * 60 * 60);
  assert.equal(response.cookies.get(MERCHANT_AUTH_MERCHANT_ID_COOKIE)?.value, "12345678");
});

test("setMerchantAuthCookies can update access without clearing refresh cookie", () => {
  const response = NextResponse.json({ ok: true });
  setMerchantAuthCookies(response, {
    accessToken: "access-token",
    maxAgeSeconds: 3600,
    merchantId: "12345678",
    preserveRefreshToken: true,
  });

  assert.equal(response.cookies.get(MERCHANT_AUTH_COOKIE)?.value, "access-token");
  assert.equal(response.cookies.get(MERCHANT_AUTH_REFRESH_COOKIE), undefined);
  assert.equal(response.cookies.get(MERCHANT_AUTH_MERCHANT_ID_COOKIE)?.value, "12345678");
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
      merchantId: "12345678",
    },
    request,
  );

  assert.equal(response.cookies.get(MERCHANT_AUTH_COOKIE)?.domain, "faolla.com");
  assert.equal(response.cookies.get(MERCHANT_AUTH_REFRESH_COOKIE)?.domain, "faolla.com");
  assert.equal(response.cookies.get(MERCHANT_AUTH_MERCHANT_ID_COOKIE)?.domain, "faolla.com");
  assert.equal(response.cookies.get(MERCHANT_AUTH_COOKIE)?.secure, true);
  assert.equal(response.cookies.get(MERCHANT_AUTH_REFRESH_COOKIE)?.secure, true);
  assert.equal(response.cookies.get(MERCHANT_AUTH_MERCHANT_ID_COOKIE)?.secure, true);
});

test("setMerchantAuthCookies falls back to the live request domain when portal config is stale", () => {
  const previousBaseDomain = process.env.NEXT_PUBLIC_PORTAL_BASE_DOMAIN;
  process.env.NEXT_PUBLIC_PORTAL_BASE_DOMAIN = "https://www.fafona.com";
  try {
    const response = NextResponse.json({ ok: true });
    const request = new Request("https://www.faolla.com/api/auth/merchant-login");
    setMerchantAuthCookies(
      response,
      {
        accessToken: "access-token",
        refreshToken: "refresh-token",
        maxAgeSeconds: 3600,
        merchantId: "12345678",
      },
      request,
    );

    assert.equal(response.cookies.get(MERCHANT_AUTH_COOKIE)?.domain, "faolla.com");
    assert.equal(response.cookies.get(MERCHANT_AUTH_REFRESH_COOKIE)?.domain, "faolla.com");
    assert.equal(response.cookies.get(MERCHANT_AUTH_MERCHANT_ID_COOKIE)?.domain, "faolla.com");
  } finally {
    process.env.NEXT_PUBLIC_PORTAL_BASE_DOMAIN = previousBaseDomain;
  }
});

test("setMerchantAuthCookies keeps localhost cookies non-secure for local development", () => {
  const response = NextResponse.json({ ok: true });
  const request = new Request("http://localhost:3000/api/auth/merchant-login");
  setMerchantAuthCookies(
    response,
    {
      accessToken: "access-token",
      refreshToken: "refresh-token",
      maxAgeSeconds: 3600,
      merchantId: "12345678",
    },
    request,
  );

  assert.equal(response.cookies.get(MERCHANT_AUTH_COOKIE)?.secure, false);
  assert.equal(response.cookies.get(MERCHANT_AUTH_REFRESH_COOKIE)?.secure, false);
  assert.equal(response.cookies.get(MERCHANT_AUTH_MERCHANT_ID_COOKIE)?.secure, false);
});

test("readMerchantAuthMerchantIdCookie reads the merchant id cookie", () => {
  const request = new Request("http://localhost/api/business-card-share", {
    headers: {
      cookie: `${MERCHANT_AUTH_MERCHANT_ID_COOKIE}=12345678`,
    },
  });

  assert.equal(readMerchantAuthMerchantIdCookie(request), "12345678");
});
