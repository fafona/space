import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { config, isLocalLikeRequestHostname, middleware, resolveHttpsRedirectUrl } from "../middleware";
import {
  MERCHANT_AUTH_ACCOUNT_TYPE_COOKIE,
  MERCHANT_AUTH_COOKIE,
  MERCHANT_AUTH_MERCHANT_ID_COOKIE,
  MERCHANT_AUTH_REFRESH_COOKIE,
} from "./lib/merchantAuthSession";

test("isLocalLikeRequestHostname only treats local hosts and IPs as local-like", () => {
  assert.equal(isLocalLikeRequestHostname("localhost"), true);
  assert.equal(isLocalLikeRequestHostname("127.0.0.1"), true);
  assert.equal(isLocalLikeRequestHostname("[::1]:3000"), true);
  assert.equal(isLocalLikeRequestHostname("faolla.com"), false);
});

test("resolveHttpsRedirectUrl upgrades direct public http requests", () => {
  const redirectUrl = resolveHttpsRedirectUrl(
    new URL("http://faolla.com/admin?scope=site-10000000"),
    new Headers({
      host: "faolla.com",
    }),
  );

  assert.equal(redirectUrl?.toString(), "https://faolla.com/admin?scope=site-10000000");
});

test("resolveHttpsRedirectUrl upgrades proxy-reported public http requests", () => {
  const redirectUrl = resolveHttpsRedirectUrl(
    new URL("http://127.0.0.1:3000/api/auth/signin"),
    new Headers({
      host: "127.0.0.1:3000",
      "x-forwarded-host": "fafona.faolla.com",
      "x-forwarded-proto": "http",
    }),
  );

  assert.equal(redirectUrl?.toString(), "https://fafona.faolla.com/api/auth/signin");
});

test("resolveHttpsRedirectUrl leaves local development requests alone", () => {
  const redirectUrl = resolveHttpsRedirectUrl(
    new URL("http://localhost:3000/admin"),
    new Headers({
      host: "localhost:3000",
    }),
  );

  assert.equal(redirectUrl, null);
});

test("resolveHttpsRedirectUrl avoids redirecting when a proxy omits forwarded proto", () => {
  const redirectUrl = resolveHttpsRedirectUrl(
    new URL("http://127.0.0.1:3000/admin"),
    new Headers({
      host: "127.0.0.1:3000",
      "x-forwarded-host": "faolla.com",
      "x-forwarded-for": "203.0.113.10",
    }),
  );

  assert.equal(redirectUrl, null);
});

test("middleware matcher now covers api routes for https enforcement", () => {
  assert.deepEqual(config.matcher, ["/", "/_next/static/:path*", "/((?!_next/image|favicon.ico|icon.svg|.*\\..*).*)"]);
});

test("middleware redirects authenticated personal launch requests before page render", async () => {
  const request = new NextRequest("https://faolla.com/launch?appShell=faolla", {
    headers: {
      cookie: `${MERCHANT_AUTH_COOKIE}=access-token; ${MERCHANT_AUTH_ACCOUNT_TYPE_COOKIE}=personal`,
    },
  });

  const response = await middleware(request);

  assert.equal(response.status, 307);
  assert.equal(response.headers.get("location"), "https://faolla.com/me?appShell=faolla");
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);
});

test("middleware redirects authenticated merchant launch requests before page render", async () => {
  const request = new NextRequest("https://faolla.com/launch?appShell=faolla&nativeStart=1", {
    headers: {
      cookie: `${MERCHANT_AUTH_REFRESH_COOKIE}=refresh-token; ${MERCHANT_AUTH_ACCOUNT_TYPE_COOKIE}=merchant; ${MERCHANT_AUTH_MERCHANT_ID_COOKIE}=10000003`,
    },
  });

  const response = await middleware(request);

  assert.equal(response.status, 307);
  assert.equal(response.headers.get("location"), "https://faolla.com/10000003?appShell=faolla");
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);
});
