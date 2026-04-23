import assert from "node:assert/strict";
import test from "node:test";

import {
  FAOLLA_LAST_ENTRY_STORAGE_KEY,
  buildBackendFaollaHref,
  buildFaollaShellHref,
  resolveFaollaEntryUrlFromBrowser,
  writeStoredFaollaEntryUrl,
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

function installBrowser(referrer = "") {
  const sessionStorage = makeStorage();
  const localStorage = makeStorage();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      location: { origin: "https://faolla.com" },
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

test("stores and restores trusted Faolla frontend entry URLs", () => {
  installBrowser();

  assert.equal(writeStoredFaollaEntryUrl("https://fafona.faolla.com/", "https://faolla.com"), "https://fafona.faolla.com/");
  assert.equal(resolveFaollaEntryUrlFromBrowser("", "https://faolla.com"), "https://fafona.faolla.com/");
  assert.equal(
    buildBackendFaollaHref("/me", "https://fafona.faolla.com/", "https://faolla.com"),
    "/me?section=faolla&faollaUrl=https%3A%2F%2Ffafona.faolla.com%2F",
  );
});

test("does not persist backend or api paths as Faolla frontend entries", () => {
  const { localStorage, sessionStorage } = installBrowser();

  assert.equal(writeStoredFaollaEntryUrl("https://faolla.com/me", "https://faolla.com"), "");
  assert.equal(writeStoredFaollaEntryUrl("https://faolla.com/admin", "https://faolla.com"), "");
  assert.equal(localStorage.getItem(FAOLLA_LAST_ENTRY_STORAGE_KEY), null);
  assert.equal(sessionStorage.getItem(FAOLLA_LAST_ENTRY_STORAGE_KEY), null);
});

test("clears stale backend entries from Faolla frontend storage", () => {
  const { localStorage, sessionStorage } = installBrowser();

  localStorage.setItem(FAOLLA_LAST_ENTRY_STORAGE_KEY, "https://faolla.com/me");
  sessionStorage.setItem(FAOLLA_LAST_ENTRY_STORAGE_KEY, "https://faolla.com/admin");

  assert.equal(resolveFaollaEntryUrlFromBrowser("", "https://faolla.com"), "");
  assert.equal(localStorage.getItem(FAOLLA_LAST_ENTRY_STORAGE_KEY), null);
  assert.equal(sessionStorage.getItem(FAOLLA_LAST_ENTRY_STORAGE_KEY), null);
});

test("uses trusted Faolla referrer as a fallback when query and storage are empty", () => {
  installBrowser("https://fafona.faolla.com/");

  assert.equal(resolveFaollaEntryUrlFromBrowser("", "https://faolla.com"), "https://fafona.faolla.com/");
});

test("does not use backend referrer or shell source as a Faolla frontend entry", () => {
  installBrowser("https://faolla.com/me");

  assert.equal(resolveFaollaEntryUrlFromBrowser("", "https://faolla.com"), "");
  assert.equal(buildBackendFaollaHref("/me", "https://faolla.com/me", "https://faolla.com"), "/me");
  assert.equal(buildFaollaShellHref("https://faolla.com/me", "zh-CN", "https://faolla.com"), "/");
});
