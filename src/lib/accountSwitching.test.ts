import assert from "node:assert/strict";
import test from "node:test";
import {
  LEGACY_ACCOUNT_SWITCH_STORAGE_KEY,
  getAccountSwitchHomeHref,
  readAccountSwitchEntries,
  restoreAccountSwitchEntry,
} from "./accountSwitching";

test("getAccountSwitchHomeHref sends personal accounts to the personal home", () => {
  assert.equal(getAccountSwitchHomeHref({ accountType: "personal", accountId: "12345678" }), "/me");
});

test("getAccountSwitchHomeHref sends merchant accounts to the existing admin route", () => {
  assert.equal(
    getAccountSwitchHomeHref({
      accountType: "merchant",
      accountId: "12345678",
      merchantId: "87654321",
      merchantIds: ["87654321"],
    }),
    "/admin",
  );
});

test("legacy account-switch token storage is purged and never returned", () => {
  const removed: string[] = [];
  const previousWindow = globalThis.window;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      sessionStorage: { removeItem: (key: string) => removed.push(`session:${key}`) },
      localStorage: { removeItem: (key: string) => removed.push(`local:${key}`) },
    },
  });
  try {
    assert.deepEqual(readAccountSwitchEntries(), []);
    assert.deepEqual(removed, [
      `session:${LEGACY_ACCOUNT_SWITCH_STORAGE_KEY}`,
      `local:${LEGACY_ACCOUNT_SWITCH_STORAGE_KEY}`,
    ]);
  } finally {
    if (previousWindow === undefined) Reflect.deleteProperty(globalThis, "window");
    else Object.defineProperty(globalThis, "window", { configurable: true, value: previousWindow });
  }
});

test("stored account switch entries require a fresh sign-in", async () => {
  await assert.rejects(
    restoreAccountSwitchEntry({
      key: "personal:1",
      accountType: "personal",
      accountId: "1",
      merchantId: "",
      merchantIds: [],
      email: "person@example.com",
      displayName: "Person",
      avatarUrl: "",
      accessToken: "stolen-access",
      refreshToken: "stolen-refresh",
      updatedAt: Date.now(),
      lastUsedAt: Date.now(),
    }),
    /account_switch_reauthentication_required/,
  );
});
