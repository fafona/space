import assert from "node:assert/strict";
import test from "node:test";
import {
  readStoredLocaleCookieFromString,
  resolveLocaleCookieDomainFromHost,
} from "@/lib/i18n";

test("reads locale preference from cookie string", () => {
  assert.equal(readStoredLocaleCookieFromString("merchant-space-locale-v1=en-GB"), "en-GB");
  assert.equal(readStoredLocaleCookieFromString("foo=bar; merchant-space-locale-v1=es-ES; hello=world"), "es-ES");
});

test("normalizes invalid or missing locale cookies", () => {
  assert.equal(readStoredLocaleCookieFromString("merchant-space-locale-v1=english"), null);
  assert.equal(readStoredLocaleCookieFromString("merchant-space-locale-v1=en"), "en-GB");
  assert.equal(readStoredLocaleCookieFromString("foo=bar"), null);
  assert.equal(readStoredLocaleCookieFromString(""), null);
});

test("resolves shared locale cookie domain for faolla hosts", () => {
  assert.equal(resolveLocaleCookieDomainFromHost("faolla.com"), "faolla.com");
  assert.equal(resolveLocaleCookieDomainFromHost("www.faolla.com"), "faolla.com");
  assert.equal(resolveLocaleCookieDomainFromHost("merchant.faolla.com"), "faolla.com");
});

test("avoids shared locale cookie domain for local development hosts", () => {
  assert.equal(resolveLocaleCookieDomainFromHost("localhost:3000"), "");
  assert.equal(resolveLocaleCookieDomainFromHost("127.0.0.1:3000"), "");
  assert.equal(resolveLocaleCookieDomainFromHost("demo.localhost:3000"), "");
});
