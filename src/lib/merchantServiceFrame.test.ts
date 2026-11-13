import test from "node:test";
import assert from "node:assert/strict";
import { isServiceFrameMessage, buildServiceFrameUrl, SERVICE_FRAME_EVENT } from "./merchantServiceFrame";
import { isBoundMerchantServiceOrigin } from "./merchantServiceOrigin.server";
import { buildServiceLoginHref, readServiceWebsiteLoginReturn } from "./merchantServiceLogin";

test("service messages require the exact child window, origin, site and per-mount channel", () => {
  const source = {} as Window;
  const binding = { source, origin: "https://launch.faolla.com", siteId: "10909095", nonce: "synthetic-channel" };
  const event = { source, origin: binding.origin, data: { type: SERVICE_FRAME_EVENT, nonce: binding.nonce, siteId: binding.siteId, event: "favorite", favorited: true } };
  assert.equal(isServiceFrameMessage(event, binding), true);
  for (const change of [{ source: {} as Window }, { origin: "https://evil.invalid" }, { data: { ...event.data, siteId: "10000000" } }, { data: { ...event.data, nonce: "wrong" } }, { data: null }])
    assert.equal(isServiceFrameMessage({ ...event, ...change }, binding), false);
  const url = buildServiceFrameUrl({ origin: binding.origin, parentOrigin: "https://cyberspace.faolla.com", siteId: binding.siteId, section: "orders", nonce: binding.nonce, locale: "es-ES" });
  assert.equal(new URL(url).pathname, "/service-center"); assert.doesNotMatch(url, /access.token|refresh.token|userId|email|accountId/);
});
test("only the bound published merchant origin and public portal can frame services", () => {
  const site = { id: "10909095", domainPrefix: "cyberspace" }, canonical = "https://launch.faolla.com";
  for (const origin of ["https://cyberspace.faolla.com", canonical, "https://faolla.com"]) assert.equal(isBoundMerchantServiceOrigin(origin, site, canonical), true);
  for (const origin of ["null", "https://other.faolla.com", "https://cyberspace.faolla.com.evil.invalid", "http://cyberspace.faolla.com", "https://cyberspace.faolla.com/path", "https://user@cyberspace.faolla.com", "https://cyberspace.faolla.com:443/"])
    assert.equal(isBoundMerchantServiceOrigin(origin, site, canonical), false);
});
test("service login returns to the merchant webpage, never to a nested personal app shell", () => {
  const href = buildServiceLoginHref("https://launch.faolla.com/service-center?parentOrigin=https%3A%2F%2Fcyberspace.faolla.com&siteId=10909095&returnTo=" + encodeURIComponent("https://cyberspace.faolla.com/?page=page-2&uiLocale=es-ES"));
  const login = new URL(href, "https://launch.faolla.com");
  assert.equal(readServiceWebsiteLoginReturn(login.searchParams.get("loginFrom") || ""), "https://cyberspace.faolla.com/?page=page-2&uiLocale=es-ES");
  assert.equal(readServiceWebsiteLoginReturn("https://evil.invalid/?entry=web"), "");
  assert.equal(readServiceWebsiteLoginReturn("https://launch.faolla.com/admin?entry=web"), "");
  assert.equal(readServiceWebsiteLoginReturn("https://faolla.com/site/10909095"), "", "old personal/native navigation stays unchanged");
});
