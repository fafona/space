import test from "node:test";
import assert from "node:assert/strict";
import {
  clearMerchantSignInBridge,
  hasMerchantSignInBridge,
  setMerchantSignInBridge,
} from "@/lib/merchantSignInBridge";

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

test("merchant sign-in bridge survives when only durable localStorage remains", () => {
  const harness = installWindowStorage();
  try {
    clearMerchantSignInBridge();
    assert.equal(setMerchantSignInBridge("12345678"), true);
    assert.equal(hasMerchantSignInBridge("12345678"), true);

    harness.sessionStorage.clear();
    assert.equal(hasMerchantSignInBridge("12345678"), true);

    clearMerchantSignInBridge("12345678");
    assert.equal(hasMerchantSignInBridge("12345678"), false);
    assert.equal(harness.localStorage.length, 0);
  } finally {
    harness.restore();
  }
});
