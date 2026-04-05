import assert from "node:assert/strict";
import test from "node:test";
import { config, isLocalLikeRequestHostname, resolveHttpsRedirectUrl } from "../middleware";

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
  assert.deepEqual(config.matcher, ["/", "/((?!_next/static|_next/image|favicon.ico|icon.svg|.*\\..*).*)"]);
});
