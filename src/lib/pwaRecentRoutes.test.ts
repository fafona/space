import assert from "node:assert/strict";
import test from "node:test";
import {
  PWA_RECENT_ROUTES_STORAGE_KEY,
  clearRecentPwaRoutes,
  collectPwaWarmRoutes,
  persistRecentPwaRoute,
  resolvePreferredPwaLaunchPath,
  shouldAutoWarmPwaRoutes,
} from "@/lib/pwaRecentRoutes";
import { RECENT_MERCHANT_LAUNCH_STORAGE_KEY } from "@/lib/merchantLaunchState";

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

function installBrowserHarness(connection?: { saveData?: boolean; effectiveType?: string }) {
  const previousWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  const previousNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const windowMock = {
    sessionStorage: new MemoryStorage(),
    localStorage: new MemoryStorage(),
  } as Window & typeof globalThis;
  const navigatorMock = {
    connection: connection ?? {},
  } as Navigator;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    writable: true,
    value: windowMock,
  });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    writable: true,
    value: navigatorMock,
  });
  return {
    sessionStorage: windowMock.sessionStorage,
    localStorage: windowMock.localStorage,
    restore() {
      if (previousWindowDescriptor) {
        Object.defineProperty(globalThis, "window", previousWindowDescriptor);
      } else {
        Reflect.deleteProperty(globalThis, "window");
      }
      if (previousNavigatorDescriptor) {
        Object.defineProperty(globalThis, "navigator", previousNavigatorDescriptor);
      } else {
        Reflect.deleteProperty(globalThis, "navigator");
      }
    },
  };
}

test("collectPwaWarmRoutes includes current path, recent routes, and the recent merchant workspace", () => {
  const harness = installBrowserHarness();
  try {
    clearRecentPwaRoutes();
    harness.localStorage.setItem(
      RECENT_MERCHANT_LAUNCH_STORAGE_KEY,
      JSON.stringify({ merchantId: "12345678", updatedAt: Date.now() }),
    );
    persistRecentPwaRoute("/site/abc", Date.now() - 1_000);
    persistRecentPwaRoute("/industry/demo", Date.now() - 500);

    const routes = collectPwaWarmRoutes("/card/demo");
    assert.deepEqual(routes, ["/card/demo", "/12345678", "/industry/demo", "/site/abc", "/"]);
    assert.ok(harness.localStorage.getItem(PWA_RECENT_ROUTES_STORAGE_KEY));
  } finally {
    harness.restore();
  }
});

test("resolvePreferredPwaLaunchPath prefers the current merchant workspace path", () => {
  const harness = installBrowserHarness();
  try {
    harness.localStorage.setItem(
      RECENT_MERCHANT_LAUNCH_STORAGE_KEY,
      JSON.stringify({ merchantId: "12345678", updatedAt: Date.now() }),
    );
    assert.equal(resolvePreferredPwaLaunchPath("/87654321"), "/87654321");
    assert.equal(resolvePreferredPwaLaunchPath("/portal"), "/12345678");
  } finally {
    harness.restore();
  }
});

test("resolvePreferredPwaLaunchPath supports the personal center as an app launch target", () => {
  const harness = installBrowserHarness();
  try {
    persistRecentPwaRoute("/me", Date.now() - 1_000);
    assert.equal(resolvePreferredPwaLaunchPath("/portal"), "/me");
    assert.equal(resolvePreferredPwaLaunchPath("/me"), "/me");

    const routes = collectPwaWarmRoutes("/card/demo");
    assert.deepEqual(routes, ["/card/demo", "/me", "/"]);
  } finally {
    harness.restore();
  }
});

test("shouldAutoWarmPwaRoutes respects data saver and slow 2g connections", () => {
  const saveDataHarness = installBrowserHarness({ saveData: true, effectiveType: "4g" });
  try {
    assert.equal(shouldAutoWarmPwaRoutes(), false);
  } finally {
    saveDataHarness.restore();
  }

  const slowHarness = installBrowserHarness({ effectiveType: "2g" });
  try {
    assert.equal(shouldAutoWarmPwaRoutes(), false);
  } finally {
    slowHarness.restore();
  }

  const normalHarness = installBrowserHarness({ effectiveType: "4g" });
  try {
    assert.equal(shouldAutoWarmPwaRoutes(), true);
  } finally {
    normalHarness.restore();
  }
});
