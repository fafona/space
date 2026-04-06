import assert from "node:assert/strict";
import test from "node:test";
import { createMirroredBrowserAuthStorageAdapter } from "@/lib/browserAuthStorage";

class MemoryStorage implements Storage {
  private store = new Map<string, string>();

  get length() {
    return this.store.size;
  }

  clear() {
    this.store.clear();
  }

  getItem(key: string) {
    return this.store.has(key) ? this.store.get(key)! : null;
  }

  key(index: number) {
    return [...this.store.keys()][index] ?? null;
  }

  removeItem(key: string) {
    this.store.delete(key);
  }

  setItem(key: string, value: string) {
    this.store.set(key, String(value));
  }
}

function withWindowStorageHarness(run: (harness: { sessionStorage: MemoryStorage; localStorage: MemoryStorage }) => void) {
  const sessionStorage = new MemoryStorage();
  const localStorage = new MemoryStorage();
  const previousWindow = globalThis.window;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      sessionStorage,
      localStorage,
    },
  });
  try {
    run({ sessionStorage, localStorage });
  } finally {
    if (typeof previousWindow === "undefined") {
      Reflect.deleteProperty(globalThis, "window");
    } else {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: previousWindow,
      });
    }
  }
}

test("browser auth storage adapter mirrors writes into session and local storage", () => {
  withWindowStorageHarness(({ sessionStorage, localStorage }) => {
    const adapter = createMirroredBrowserAuthStorageAdapter();
    adapter.setItem("sb-demo-auth-token", '{"access_token":"access-token","refresh_token":"refresh-token"}');
    assert.match(String(sessionStorage.getItem("sb-demo-auth-token")), /access-token/);
    assert.match(String(localStorage.getItem("sb-demo-auth-token")), /access-token/);
  });
});

test("browser auth storage adapter falls back to localStorage and rehydrates sessionStorage", () => {
  withWindowStorageHarness(({ sessionStorage, localStorage }) => {
    const adapter = createMirroredBrowserAuthStorageAdapter();
    localStorage.setItem("sb-demo-auth-token", '{"access_token":"access-token","refresh_token":"refresh-token"}');
    assert.match(String(adapter.getItem("sb-demo-auth-token")), /access-token/);
    assert.match(String(sessionStorage.getItem("sb-demo-auth-token")), /access-token/);
  });
});

test("browser auth storage adapter clears both storage layers", () => {
  withWindowStorageHarness(({ sessionStorage, localStorage }) => {
    const adapter = createMirroredBrowserAuthStorageAdapter();
    adapter.setItem("sb-demo-auth-token", '{"access_token":"access-token","refresh_token":"refresh-token"}');
    adapter.removeItem("sb-demo-auth-token");
    assert.equal(sessionStorage.getItem("sb-demo-auth-token"), null);
    assert.equal(localStorage.getItem("sb-demo-auth-token"), null);
  });
});
