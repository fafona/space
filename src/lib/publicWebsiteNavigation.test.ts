import assert from "node:assert/strict";
import test from "node:test";
import { buildDirectMerchantWebsiteHref, buildPublicWebsiteWorkspaceHref, buildWebsitePlatformModeHref, cleanPublicWebsiteReturnUrl, PUBLIC_WEBSITE_WORKSPACE_SECTIONS, readPublicWebsiteWorkspaceSection } from "./publicWebsiteNavigation";

const origin = "https://launch.faolla.com";
const source = origin + "/site/99990001?page=page-2&uiLocale=es-ES&appShell=faolla&entry=app&__faollaInlineBuild=old#contact";
const clean = origin + "/site/99990001?page=page-2&uiLocale=es-ES#contact";

test("direct merchant links keep original tenant paths and never carry an app-shell or account token", () => {
  assert.equal(buildDirectMerchantWebsiteHref("99990001", "es-ES"), "/site/99990001?uiLocale=es-ES");
  assert.equal(buildDirectMerchantWebsiteHref("x/y"), "/site/x%2Fy");
  assert.equal(buildDirectMerchantWebsiteHref("99990001", "es-ES", "store"), "/store?uiLocale=es-ES");
});

test("public return URLs preserve the page, language and anchor, not shell/build markers", () => {
  assert.equal(cleanPublicWebsiteReturnUrl(source, origin), clean);
  assert.equal(cleanPublicWebsiteReturnUrl("https://shop.faolla.com/?page=2", origin), "https://shop.faolla.com/?page=2");
  assert.equal(cleanPublicWebsiteReturnUrl("/site/99990001", origin), origin + "/site/99990001");
});

test("return URLs cannot send visitors to arbitrary sites, credentials, backend or API routes", () => {
  for (const value of ["", "javascript:alert(1)", "data:text/html,x", "//evil.invalid/", "https://faolla.com.evil.invalid/", "https://user:password@launch.faolla.com/site/99990001", "/me", "/login", "/api/orders", "/admin", "/10909095", "/super-admin/latest"]) {
    assert.equal(cleanPublicWebsiteReturnUrl(value, origin), "", value);
  }
});

test("each personal feature is explicit, preserves a safe return and only chat receives a merchant ID", () => {
  for (const section of PUBLIC_WEBSITE_WORKSPACE_SECTIONS) {
    const url = new URL(buildPublicWebsiteWorkspaceHref(section, source, origin, "99990001"), origin);
    assert.equal(url.pathname, "/me");
    assert.equal(url.searchParams.get("returnTo"), clean);
    assert.equal(url.searchParams.get("uiLocale"), "es-ES");
    assert.equal(url.searchParams.get("peerMerchantId"), section === "conversations" ? "99990001" : null);
    assert.equal(url.searchParams.get("section"), null);
    assert.equal(readPublicWebsiteWorkspaceSection(url.search), section);
  }
  assert.equal(readPublicWebsiteWorkspaceSection("?personalSection=admin"), null);
  assert.equal(readPublicWebsiteWorkspaceSection("?section=faolla"), null);
  assert.equal(new URL(buildPublicWebsiteWorkspaceHref("conversations", "", origin, "../admin"), origin).searchParams.get("peerMerchantId"), null);
});

test("platform mode remains an explicit opt-in to the existing favorite workflow", () => {
  const url = new URL(buildWebsitePlatformModeHref(source, origin), origin);
  assert.equal(url.pathname, "/me");
  assert.equal(url.searchParams.get("section"), "faolla");
  assert.equal(url.searchParams.get("faollaUrl"), clean);
  assert.equal(url.searchParams.get("uiLocale"), "es-ES");
  assert.equal(url.searchParams.get("returnTo"), clean);
  assert.equal(buildWebsitePlatformModeHref("https://evil.invalid", origin), "/me");
});
