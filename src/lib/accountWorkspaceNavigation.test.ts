import assert from "node:assert/strict";
import test from "node:test";
import { buildAccountWorkspaceHref } from "@/lib/accountWorkspaceNavigation";
import { buildBackendAppShellHref } from "@/lib/faollaEntry";

test("personal workspace navigation can return to the public page that opened login", () => {
  const href = buildAccountWorkspaceHref({
    accountType: "personal",
    sourceUrl: "https://www.faolla.com/?category=new#products",
  });
  const url = new URL(href, "https://launch.faolla.com");

  assert.equal(url.pathname, "/me");
  assert.equal(url.searchParams.get("section"), "faolla");
  assert.equal(
    url.searchParams.get("faollaUrl"),
    "https://www.faolla.com/?category=new#products",
  );
});

test("merchant workspace navigation never embeds the public login source", () => {
  for (const sourceUrl of [
    "https://www.faolla.com/",
    "https://fafona.faolla.com/products",
    "https://launch.faolla.com/10000000?section=faolla",
  ]) {
    const href = buildAccountWorkspaceHref({
      accountType: "merchant",
      merchantId: "10000000",
      sourceUrl,
    });
    const url = new URL(href, "https://launch.faolla.com");

    assert.equal(href, "/10000000");
    assert.equal(url.searchParams.has("section"), false);
    assert.equal(url.searchParams.has("faollaUrl"), false);
  }
});

test("merchant workspace navigation falls back to admin without exposing a public source", () => {
  for (const merchantId of ["", "not-a-merchant", "1234567", null]) {
    assert.equal(
      buildAccountWorkspaceHref({
        accountType: "merchant",
        merchantId,
        sourceUrl: "https://www.faolla.com/",
      }),
      "/admin",
    );
  }
});

test("native merchant workspace keeps only the app shell marker", () => {
  const workspaceHref = buildAccountWorkspaceHref({
    accountType: "merchant",
    merchantId: "10000000",
    sourceUrl: "https://www.faolla.com/",
  });
  const href = buildBackendAppShellHref(workspaceHref, "https://launch.faolla.com");
  const url = new URL(href, "https://launch.faolla.com");

  assert.equal(url.pathname, "/10000000");
  assert.equal(url.searchParams.get("appShell"), "faolla");
  assert.equal(url.searchParams.has("section"), false);
  assert.equal(url.searchParams.has("faollaUrl"), false);
});
