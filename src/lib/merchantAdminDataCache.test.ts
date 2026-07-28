import assert from "node:assert/strict";
import test from "node:test";
import {
  invalidateMerchantAdminDataCache,
  makeMerchantAdminDataCacheKey,
  readMerchantAdminDataCache,
  readMerchantAdminDataCacheSnapshot,
  writeMerchantAdminDataCache,
} from "./merchantAdminDataCache";

class MemoryStorage {
  private readonly values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  clear() {
    this.values.clear();
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  key(index: number) {
    return Array.from(this.values.keys())[index] ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

function withBrowserStorage(run: (storage: MemoryStorage) => void) {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const storage = new MemoryStorage();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage: storage },
  });
  try {
    run(storage);
  } finally {
    if (previousWindow) {
      Object.defineProperty(globalThis, "window", previousWindow);
    } else {
      Reflect.deleteProperty(globalThis, "window");
    }
  }
}

test("merchant admin data cache reuses writes and exposes freshness metadata", () => {
  withBrowserStorage(() => {
    const key = makeMerchantAdminDataCacheKey("test", "10000000", Date.now());
    const payload = { memberships: [{ id: "member-1" }] };
    writeMerchantAdminDataCache(key, payload, { version: "v1" });

    assert.equal(readMerchantAdminDataCache(key), payload);
    const snapshot = readMerchantAdminDataCacheSnapshot<typeof payload>(key);
    assert.equal(snapshot?.data, payload);
    assert.equal(snapshot?.fresh, true);
    assert.equal(snapshot?.version, "v1");

    invalidateMerchantAdminDataCache(key);
    assert.equal(readMerchantAdminDataCache(key), null);
  });
});

test("merchant admin data cache notices storage changes made outside the module", () => {
  withBrowserStorage((storage) => {
    const key = makeMerchantAdminDataCacheKey("test-external", "10000000", Date.now());
    writeMerchantAdminDataCache(key, { value: 1 });
    assert.deepEqual(readMerchantAdminDataCache(key), { value: 1 });

    storage.setItem(
      key,
      JSON.stringify({
        savedAt: Date.now(),
        data: { value: 2 },
        version: "v2",
      }),
    );

    assert.deepEqual(readMerchantAdminDataCache(key), { value: 2 });
    assert.equal(readMerchantAdminDataCacheSnapshot<{ value: number }>(key)?.version, "v2");
  });
});
