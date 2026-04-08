import assert from "node:assert/strict";
import test from "node:test";
import {
  readPreferredLocaleFromAcceptLanguage,
  readRequestedLocaleFromSearch,
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

test("reads requested locale from query string", () => {
  assert.equal(readRequestedLocaleFromSearch("?uiLocale=en-GB"), "en-GB");
  assert.equal(readRequestedLocaleFromSearch("uiLocale=en"), "en-GB");
  assert.equal(readRequestedLocaleFromSearch("?uiLocale=english"), null);
  assert.equal(readRequestedLocaleFromSearch("?foo=bar"), null);
});

test("reads preferred locale from accept-language", () => {
  assert.equal(readPreferredLocaleFromAcceptLanguage("es-ES,es;q=0.9,en;q=0.8"), "es-ES");
  assert.equal(readPreferredLocaleFromAcceptLanguage("en-US,en;q=0.9,zh-CN;q=0.8"), "en-GB");
  assert.equal(readPreferredLocaleFromAcceptLanguage("pt-BR,pt;q=0.9"), "pt-PT");
  assert.equal(readPreferredLocaleFromAcceptLanguage("xx-YY,zz;q=0.9"), null);
  assert.equal(readPreferredLocaleFromAcceptLanguage(""), null);
});
