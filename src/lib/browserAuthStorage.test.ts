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
  run: (harness: { sessionStorage: MemoryStorage; localStorage: MemoryStorage; cookieWrites: string[] }) => void,
  options: { cookies?: boolean } = {},
) {
  const sessionStorage = new MemoryStorage();
  const localStorage = new MemoryStorage();
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const cookieJar = new Map<string, string>();
  const cookieWrites: string[] = [];
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
          cookieWrites.push(String(value));
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
    run({ sessionStorage, localStorage, cookieWrites });
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

test("browser auth storage adapter keeps bearer sessions in the current tab only", () => {
  withWindowStorageHarness(({ sessionStorage, localStorage }) => {
    const adapter = createMirroredBrowserAuthStorageAdapter();
    adapter.setItem("sb-demo-auth-token", '{"access_token":"access-token","refresh_token":"refresh-token"}');
    assert.match(String(sessionStorage.getItem("sb-demo-auth-token")), /access-token/);
    assert.equal(localStorage.getItem("sb-demo-auth-token"), null);
  });
});

test("browser auth storage adapter rejects and clears legacy localStorage bearer sessions", () => {
  withWindowStorageHarness(({ sessionStorage, localStorage }) => {
    const adapter = createMirroredBrowserAuthStorageAdapter();
    localStorage.setItem("sb-demo-auth-token", '{"access_token":"access-token","refresh_token":"refresh-token"}');
    assert.equal(adapter.getItem("sb-demo-auth-token"), null);
    assert.equal(sessionStorage.getItem("sb-demo-auth-token"), null);
    assert.equal(localStorage.getItem("sb-demo-auth-token"), null);
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

test("browser auth storage adapter never mirrors bearer tokens into cookies", () => {
  withWindowStorageHarness(
    ({ cookieWrites }) => {
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
      assert.equal(cookieValue, null);
      assert.equal(cookieWrites.some((value) => value.includes("access-token")), false);
      assert.equal(cookieWrites.some((value) => value.includes("refresh-token")), false);
      assert.ok(cookieWrites.some((value) => value.includes("Domain=.faolla.com") && value.includes("Max-Age=0")));

      adapter.removeItem("sb-demo-auth-token");
      assert.equal(readBrowserAuthStorageCookie("sb-demo-auth-token"), null);
    },
    { cookies: true },
  );
});

test("browser auth storage adapter rejects legacy OAuth verifier cookies", () => {
  withWindowStorageHarness(
    ({ sessionStorage, localStorage, cookieWrites }) => {
      const adapter = createMirroredBrowserAuthStorageAdapter();
      const key = "sb-demo-auth-token-code-verifier";
      adapter.setItem(key, "oauth-verifier-value");
      sessionStorage.removeItem(key);
      localStorage.removeItem(key);

      assert.equal(readBrowserAuthStorageCookie(key), null);
      assert.equal(adapter.getItem(key), null);
      assert.equal(sessionStorage.getItem(key), null);
      assert.equal(localStorage.getItem(key), null);
      assert.ok(cookieWrites.some((value) => value.includes("Domain=.faolla.com") && value.includes("Max-Age=0")));
    },
    { cookies: true },
  );
});

test("browser auth storage adapter bounds same-origin OAuth transient persistence", () => {
  withWindowStorageHarness(({ sessionStorage, localStorage }) => {
    const adapter = createMirroredBrowserAuthStorageAdapter();
    const key = "sb-demo-auth-token-code-verifier";
    adapter.setItem(key, "oauth-verifier-value");

    assert.equal(sessionStorage.getItem(key), null);
    assert.equal(localStorage.getItem(key), "oauth-verifier-value");
    assert.equal(adapter.getItem(key), "oauth-verifier-value");

    localStorage.setItem(`${key}.faolla-created-at`, String(Date.now() - 16 * 60 * 1000));
    assert.equal(adapter.getItem(key), null);
    assert.equal(localStorage.getItem(key), null);
    assert.equal(localStorage.getItem(`${key}.faolla-created-at`), null);
  });
});
