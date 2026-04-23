import assert from "node:assert/strict";
import test from "node:test";

import {
  FAOLLA_LAST_ENTRY_STORAGE_KEY,
  buildBackendFaollaHref,
  buildFaollaShellHref,
  resolveFaollaEntryUrlFromBrowser,
} from "./faollaEntry";

function makeStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}

function installBrowser(origin = "https://faolla.com", referrer = "") {
  const sessionStorage = makeStorage();
  const localStorage = makeStorage();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      location: { origin },
      localStorage,
      sessionStorage,
    },
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { referrer },
  });
  return { localStorage, sessionStorage };
}

test("uses only explicit Faolla frontend URL query as backend shell entry", () => {
  installBrowser();

  assert.equal(
    resolveFaollaEntryUrlFromBrowser("?section=faolla&faollaUrl=https%3A%2F%2Ffafona.faolla.com%2F", "https://faolla.com"),
    "https://fafona.faolla.com/",
  );
  assert.equal(
    buildBackendFaollaHref("/me", "https://fafona.faolla.com/", "https://faolla.com"),
    "/me?section=faolla&faollaUrl=https%3A%2F%2Ffafona.faolla.com%2F",
  );
});

test("does not use cached or referrer guesses for Faolla shell entry", () => {
  const { localStorage, sessionStorage } = installBrowser("https://faolla.com", "https://fafona.faolla.com/");

  localStorage.setItem(FAOLLA_LAST_ENTRY_STORAGE_KEY, "https://fafona.faolla.com/");
  sessionStorage.setItem(FAOLLA_LAST_ENTRY_STORAGE_KEY, "https://faolla.com/me");

  assert.equal(resolveFaollaEntryUrlFromBrowser("", "https://faolla.com"), "");
  assert.equal(localStorage.getItem(FAOLLA_LAST_ENTRY_STORAGE_KEY), null);
  assert.equal(sessionStorage.getItem(FAOLLA_LAST_ENTRY_STORAGE_KEY), null);
});

test("rejects backend routes as Faolla frontend entries", () => {
  installBrowser();

  assert.equal(buildBackendFaollaHref("/me", "https://faolla.com/me", "https://faolla.com"), "/me");
  assert.equal(buildBackendFaollaHref("/me", "https://faolla.com/admin", "https://faolla.com"), "/me");
  assert.equal(buildBackendFaollaHref("/me", "https://faolla.com/10000000", "https://faolla.com"), "/me");
  assert.equal(
    resolveFaollaEntryUrlFromBrowser("?section=faolla&faollaUrl=https%3A%2F%2Ffaolla.com%2F10000000", "https://faolla.com"),
    "",
  );
});

test("defaults the Faolla shell to the portal home instead of the backend origin", () => {
  installBrowser("https://fafona.faolla.com");

  assert.equal(buildFaollaShellHref("", "zh-CN", "https://fafona.faolla.com"), "https://faolla.com/?uiLocale=zh-CN&appShell=faolla");
  assert.equal(
    buildFaollaShellHref("https://faolla.com/me", "zh-CN", "https://faolla.com"),
    "https://faolla.com/?uiLocale=zh-CN&appShell=faolla",
  );
});
