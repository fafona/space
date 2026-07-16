import assert from "node:assert/strict";
import test from "node:test";
import {
  ADMIN_AUTO_RELOAD_STORAGE_KEY,
  ADMIN_AUTO_RELOAD_WINDOW_MS,
  claimAdminAutoReload,
  clearAdminAutoReload,
  type AdminAutoReloadStorage,
} from "./adminAutoReload";

function createMemoryStorage(): AdminAutoReloadStorage & { has(key: string): boolean } {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
    has: (key) => values.has(key),
  };
}

test("admin automatic reload can be claimed once per recovery window", () => {
  const storage = createMemoryStorage();
  assert.equal(claimAdminAutoReload(storage, "/10000000", 1_000), true);
  assert.equal(claimAdminAutoReload(storage, "/10000000", 2_000), false);
});

test("admin automatic reload can be claimed again after the recovery window", () => {
  const storage = createMemoryStorage();
  assert.equal(claimAdminAutoReload(storage, "/10000000", 1_000), true);
  assert.equal(claimAdminAutoReload(storage, "/10000000", 1_000 + ADMIN_AUTO_RELOAD_WINDOW_MS + 1), true);
});

test("admin automatic reload claims are scoped to the current path", () => {
  const storage = createMemoryStorage();
  assert.equal(claimAdminAutoReload(storage, "/10000000", 1_000), true);
  assert.equal(claimAdminAutoReload(storage, "/10000001", 2_000), true);
});

test("successful recovery clears the automatic reload claim", () => {
  const storage = createMemoryStorage();
  assert.equal(claimAdminAutoReload(storage, "/10000000", 1_000), true);
  clearAdminAutoReload(storage, "/10000000");
  assert.equal(storage.has(ADMIN_AUTO_RELOAD_STORAGE_KEY), false);
  assert.equal(claimAdminAutoReload(storage, "/10000000", 2_000), true);
});

test("unavailable storage does not risk a reload loop", () => {
  const storage: AdminAutoReloadStorage = {
    getItem: () => {
      throw new Error("unavailable");
    },
    setItem: () => {
      throw new Error("unavailable");
    },
    removeItem: () => {
      throw new Error("unavailable");
    },
  };
  assert.equal(claimAdminAutoReload(storage, "/10000000", 1_000), false);
});
