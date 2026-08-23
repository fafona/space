import assert from "node:assert/strict";
import test from "node:test";
import { buildPersonalLoginHref } from "@/lib/personalLoginNavigation";

test("personal login href preserves the public return URL but removes shell-only markers", () => {
  const href = buildPersonalLoginHref(
    "https://faolla.com/10909094?category=new&appShell=faolla&__faollaWebBuild=abc&nativeBuild=123#products",
  );
  const url = new URL(href, "https://www.faolla.com");
  const loginFrom = new URL(url.searchParams.get("loginFrom") ?? "");

  assert.equal(url.pathname, "/login");
  assert.equal(url.searchParams.get("accountType"), "personal");
  assert.equal(loginFrom.origin, "https://faolla.com");
  assert.equal(loginFrom.pathname, "/10909094");
  assert.equal(loginFrom.searchParams.get("category"), "new");
  assert.equal(loginFrom.searchParams.has("appShell"), false);
  assert.equal(loginFrom.searchParams.has("__faollaWebBuild"), false);
  assert.equal(loginFrom.searchParams.has("nativeBuild"), false);
  assert.equal(loginFrom.hash, "#products");
});

test("personal login href accepts Faolla subdomains and local development", () => {
  for (const currentHref of [
    "https://fafona.faolla.com/products",
    "http://localhost:3000/10909094",
    "http://127.0.0.1:3000/10909094",
    "http://[::1]:3000/10909094",
  ]) {
    const url = new URL(buildPersonalLoginHref(currentHref), "https://www.faolla.com");
    assert.equal(url.searchParams.get("loginFrom"), currentHref);
  }
});

test("personal login href rejects untrusted and non-http return targets", () => {
  for (const currentHref of [
    "https://faolla.com.evil.example/10909094",
    "https://evil.example/10909094",
    "javascript:alert(1)",
    "//evil.example/10909094",
  ]) {
    const url = new URL(buildPersonalLoginHref(currentHref), "https://www.faolla.com");
    assert.equal(url.searchParams.get("accountType"), "personal");
    assert.equal(url.searchParams.has("loginFrom"), false);
  }
});
