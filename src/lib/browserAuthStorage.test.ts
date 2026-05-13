import assert from "node:assert/strict";
import test from "node:test";
import { createMirroredBrowserAuthStorageAdapter, readBrowserAuthStorageCookie } from "@/lib/browserAuthStorage";

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

function withWindowStorageHarness(
  run: (harness: { sessionStorage: MemoryStorage; localStorage: MemoryStorage }) => void,
  options: { cookies?: boolean } = {},
) {
  const sessionStorage = new MemoryStorage();
  const localStorage = new MemoryStorage();
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const cookieJar = new Map<string, string>();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      sessionStorage,
      localStorage,
      location: {
        hostname: "www.faolla.com",
        protocol: "https:",
      },
    },
  });
  if (options.cookies) {
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        get cookie() {
          return [...cookieJar.entries()].map(([key, value]) => `${key}=${value}`).join("; ");
        },
        set cookie(value: string) {
          const [pair, ...attributes] = String(value).split(";");
          const separatorIndex = pair.indexOf("=");
          if (separatorIndex < 0) return;
          const key = pair.slice(0, separatorIndex);
          const cookieValue = pair.slice(separatorIndex + 1);
          const isExpired = attributes.some((attribute) => /^ max-age=0$/i.test(attribute));
          if (isExpired) {
            cookieJar.delete(key);
            return;
          }
          cookieJar.set(key, cookieValue);
        },
      },
    });
  }
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
    if (typeof previousDocument === "undefined") {
      Reflect.deleteProperty(globalThis, "document");
    } else {
      Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: previousDocument,
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

test("browser auth storage adapter writes a compact cookie snapshot for PWA recovery", () => {
  withWindowStorageHarness(
    () => {
      const adapter = createMirroredBrowserAuthStorageAdapter();
      adapter.setItem(
        "sb-demo-auth-token",
        JSON.stringify({
          currentSession: {
            access_token: "access-token",
            refresh_token: "refresh-token",
            token_type: "bearer",
            user: {
              email: "person@example.com",
            },
          },
        }),
      );

      const cookieValue = readBrowserAuthStorageCookie("sb-demo-auth-token");
      assert.match(String(cookieValue), /access-token/);
      assert.doesNotMatch(String(cookieValue), /person@example.com/);

      adapter.removeItem("sb-demo-auth-token");
      assert.equal(readBrowserAuthStorageCookie("sb-demo-auth-token"), null);
    },
    { cookies: true },
  );
});

test("browser auth storage adapter preserves OAuth verifier fallback in cookies", () => {
  withWindowStorageHarness(
    ({ sessionStorage, localStorage }) => {
      const adapter = createMirroredBrowserAuthStorageAdapter();
      const key = "sb-demo-auth-token-code-verifier";
      adapter.setItem(key, "oauth-verifier-value");
      sessionStorage.removeItem(key);
      localStorage.removeItem(key);

      assert.equal(readBrowserAuthStorageCookie(key), "oauth-verifier-value");
      assert.equal(adapter.getItem(key), "oauth-verifier-value");
      assert.equal(sessionStorage.getItem(key), "oauth-verifier-value");
      assert.equal(localStorage.getItem(key), "oauth-verifier-value");
    },
    { cookies: true },
  );
});
