import assert from "node:assert/strict";
import test from "node:test";
import { NextResponse } from "next/server";
import {
  MERCHANT_AUTH_ACCOUNT_TYPE_COOKIE,
  MERCHANT_AUTH_COOKIE,
  MERCHANT_AUTH_MERCHANT_ID_COOKIE,
  MERCHANT_AUTH_REFRESH_COOKIE,
  parseCookieValue,
  parseCookieValues,
  readMerchantAuthAccountTypeCookie,
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

test("readMerchantRequestAccessTokens reads the merchant cookie and internal token fallback", () => {
  const request = new Request("http://localhost/api/business-card-share", {
    headers: {
      authorization: "Bearer bearer-token",
      cookie: `${MERCHANT_AUTH_COOKIE}=cookie-token`,
      "x-merchant-access-token": "header-token",
    },
  });

  assert.deepEqual(readMerchantRequestAccessTokens(request), ["header-token", "cookie-token"]);
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
      "x-merchant-refresh-token": "header-refresh",
    },
  });

  assert.deepEqual(readMerchantRequestRefreshTokens(request), ["header-refresh", "stale-refresh", "fresh-refresh"]);
});

test("setMerchantAuthCookies writes browser-session cookies", () => {
  const response = NextResponse.json({ ok: true });
  setMerchantAuthCookies(response, {
    accessToken: "access-token",
    refreshToken: "refresh-token",
    maxAgeSeconds: 3600,
    merchantId: "12345678",
    accountType: "merchant",
  });

  assert.equal(response.cookies.get(MERCHANT_AUTH_COOKIE)?.maxAge, 3600);
  assert.equal(response.cookies.get(MERCHANT_AUTH_REFRESH_COOKIE)?.maxAge, 30 * 24 * 60 * 60);
  assert.equal(response.cookies.get(MERCHANT_AUTH_MERCHANT_ID_COOKIE)?.value, "12345678");
  assert.equal(response.cookies.get(MERCHANT_AUTH_ACCOUNT_TYPE_COOKIE)?.value, "merchant");
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
  assert.equal(response.cookies.get(MERCHANT_AUTH_ACCOUNT_TYPE_COOKIE), undefined);
});

test("setMerchantAuthCookies refuses merchant subdomains", () => {
  const response = NextResponse.json({ ok: true });
  const request = new Request("https://fafona.faolla.com/api/auth/merchant-login");
  setMerchantAuthCookies(
    response,
    {
      accessToken: "access-token",
      refreshToken: "refresh-token",
      maxAgeSeconds: 3600,
      merchantId: "12345678",
      accountType: "merchant",
    },
    request,
  );

  assert.equal(response.cookies.get(MERCHANT_AUTH_COOKIE), undefined);
  assert.equal(response.cookies.get(MERCHANT_AUTH_REFRESH_COOKIE), undefined);
  assert.equal(response.cookies.get(MERCHANT_AUTH_MERCHANT_ID_COOKIE), undefined);
  assert.equal(response.cookies.get(MERCHANT_AUTH_ACCOUNT_TYPE_COOKIE), undefined);
});

test("setMerchantAuthCookies writes secure host-only cookies on the exact portal", () => {
  const previousOrigin = process.env.FAOLLA_CANONICAL_PORTAL_ORIGIN;
  process.env.FAOLLA_CANONICAL_PORTAL_ORIGIN = "https://www.faolla.com";
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

    assert.equal(response.cookies.get(MERCHANT_AUTH_COOKIE)?.domain, undefined);
    assert.equal(response.cookies.get(MERCHANT_AUTH_REFRESH_COOKIE)?.domain, undefined);
    assert.equal(response.cookies.get(MERCHANT_AUTH_MERCHANT_ID_COOKIE)?.domain, undefined);
    assert.equal(response.cookies.get(MERCHANT_AUTH_COOKIE)?.secure, true);
    assert.equal(response.cookies.get(MERCHANT_AUTH_REFRESH_COOKIE)?.secure, true);
    assert.match(response.headers.get("set-cookie") ?? "", /Domain=faolla\.com/i);
    assert.equal(
      (response.headers.get("set-cookie")?.match(/merchant-space-merchant-auth=/g) ?? []).length,
      2,
    );
  } finally {
    if (previousOrigin === undefined) delete process.env.FAOLLA_CANONICAL_PORTAL_ORIGIN;
    else process.env.FAOLLA_CANONICAL_PORTAL_ORIGIN = previousOrigin;
  }
});

test("host-prefixed localhost cookies remain Secure", () => {
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

  assert.equal(response.cookies.get(MERCHANT_AUTH_COOKIE)?.secure, true);
  assert.equal(response.cookies.get(MERCHANT_AUTH_REFRESH_COOKIE)?.secure, true);
  assert.equal(response.cookies.get(MERCHANT_AUTH_MERCHANT_ID_COOKIE)?.secure, true);
});

test("legacy domain cookie names are ignored", () => {
  const request = new Request("https://www.faolla.com/api/auth/merchant-session", {
    headers: { cookie: "merchant-space-merchant-auth=legacy-token" },
  });
  assert.deepEqual(readMerchantRequestAccessTokens(request), []);
});

test("readMerchantAuthMerchantIdCookie reads the merchant id cookie", () => {
  const request = new Request("http://localhost/api/business-card-share", {
    headers: {
      cookie: `${MERCHANT_AUTH_MERCHANT_ID_COOKIE}=12345678`,
    },
  });

  assert.equal(readMerchantAuthMerchantIdCookie(request), "12345678");
});

test("readMerchantAuthAccountTypeCookie reads a valid account type cookie", () => {
  const request = new Request("http://localhost/api/business-card-share", {
    headers: {
      cookie: `${MERCHANT_AUTH_ACCOUNT_TYPE_COOKIE}=personal`,
    },
  });

  assert.equal(readMerchantAuthAccountTypeCookie(request), "personal");
});
