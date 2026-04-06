import assert from "node:assert/strict";
import test from "node:test";
import {
  RECENT_MERCHANT_LAUNCH_STORAGE_KEY,
  clearRecentMerchantLaunchState,
  persistRecentMerchantLaunchState,
  readRecentMerchantLaunchMerchantId,
} from "@/lib/merchantLaunchState";

class MemoryStorage implements Storage {
  #store = new Map<string, string>();

  get length() {
    return this.#store.size;
  }

  clear() {
    this.#store.clear();
  }

  getItem(key: string) {
    return this.#store.has(key) ? this.#store.get(key) ?? null : null;
  }

  key(index: number) {
    return Array.from(this.#store.keys())[index] ?? null;
  }

  removeItem(key: string) {
    this.#store.delete(key);
  }

  setItem(key: string, value: string) {
    this.#store.set(key, value);
  }
}

function installWindowStorage() {
  const previousWindow = globalThis.window;
  const windowMock = {
    sessionStorage: new MemoryStorage(),
    localStorage: new MemoryStorage(),
  } as Window & typeof globalThis;
  Object.assign(globalThis, { window: windowMock });
  return {
    sessionStorage: windowMock.sessionStorage,
    localStorage: windowMock.localStorage,
    restore() {
      if (previousWindow) {
        Object.assign(globalThis, { window: previousWindow });
        return;
      }
      Reflect.deleteProperty(globalThis, "window");
    },
  };
}

test("recent merchant launch state survives when only localStorage remains", () => {
  const harness = installWindowStorage();
  try {
    clearRecentMerchantLaunchState();
    assert.equal(persistRecentMerchantLaunchState("12345678", 1_700_000_000_000), true);
    assert.equal(readRecentMerchantLaunchMerchantId(Number.MAX_SAFE_INTEGER), "12345678");

    harness.sessionStorage.clear();
    assert.equal(readRecentMerchantLaunchMerchantId(Number.MAX_SAFE_INTEGER), "12345678");
    assert.ok(harness.sessionStorage.getItem(RECENT_MERCHANT_LAUNCH_STORAGE_KEY));
  } finally {
    harness.restore();
  }
});

test("recent merchant launch state ignores stale or malformed snapshots", () => {
  const harness = installWindowStorage();
  try {
    harness.localStorage.setItem(
      RECENT_MERCHANT_LAUNCH_STORAGE_KEY,
      JSON.stringify({ merchantId: "12345678", updatedAt: Date.now() - 40 * 24 * 60 * 60 * 1000 }),
    );
    assert.equal(readRecentMerchantLaunchMerchantId(), "");
    assert.equal(harness.localStorage.getItem(RECENT_MERCHANT_LAUNCH_STORAGE_KEY), null);
  } finally {
    harness.restore();
  }
});
