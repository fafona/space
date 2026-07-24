import test from "node:test";
import assert from "node:assert/strict";
import {
  clearStoredBrowserSupabaseSessionTokens,
  hasStoredBrowserSupabaseSessionTokens,
  invalidateMerchantSessionPayloadCache,
  persistBrowserSupabaseSessionSnapshot,
  readMerchantSessionMerchantIds,
  readMerchantSessionPayload,
} from "@/lib/authSessionRecovery";
import { legacySupabaseAuthStorageKey, resolvedSupabaseAuthStorageKey } from "@/lib/supabase";

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

test("persisted browser auth snapshot is mirrored to durable localStorage fallback", () => {
  const harness = installWindowStorage();
  try {
    clearStoredBrowserSupabaseSessionTokens();
    const stored = persistBrowserSupabaseSessionSnapshot({
      currentSession: {
        access_token: "access-token",
        refresh_token: "refresh-token",
      },
      session: {
        access_token: "access-token",
        refresh_token: "refresh-token",
      },
    });

    assert.equal(stored, true);
    const storageKeys = [resolvedSupabaseAuthStorageKey, legacySupabaseAuthStorageKey].filter(Boolean);
    assert.ok(storageKeys.length > 0);
    storageKeys.forEach((key) => {
      assert.match(String(harness.sessionStorage.getItem(key)), /access-token/);
      assert.match(String(harness.localStorage.getItem(key)), /access-token/);
    });
    assert.equal(hasStoredBrowserSupabaseSessionTokens(), true);
  } finally {
    harness.restore();
  }
});

test("stored browser auth snapshot still counts when only durable localStorage remains", () => {
  const harness = installWindowStorage();
  try {
    clearStoredBrowserSupabaseSessionTokens();
    persistBrowserSupabaseSessionSnapshot({
      currentSession: {
        access_token: "access-token",
        refresh_token: "refresh-token",
      },
      session: {
        access_token: "access-token",
        refresh_token: "refresh-token",
      },
    });

    harness.sessionStorage.clear();
    assert.equal(hasStoredBrowserSupabaseSessionTokens(), true);

    clearStoredBrowserSupabaseSessionTokens();
    assert.equal(hasStoredBrowserSupabaseSessionTokens(), false);
  } finally {
    harness.restore();
  }
});

test("merchant session payload ids keep server primary id first and dedupe extras", () => {
  assert.deepEqual(
    readMerchantSessionMerchantIds({
      merchantId: "10000002",
      merchantIds: ["10000003", "10000002", "10000004", "", null],
    }),
    ["10000002", "10000003", "10000004"],
  );
});

test("merchant session payload reuses a recent authenticated response", async () => {
  const harness = installWindowStorage();
  const previousFetch = globalThis.fetch;
  let requestCount = 0;
  Object.assign(globalThis, {
    fetch: async () => {
      requestCount += 1;
      return new Response(
        JSON.stringify({
          authenticated: true,
          merchantId: "10000002",
          user: { id: "merchant-user", email: "merchant@example.com" },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    },
  });

  try {
    invalidateMerchantSessionPayloadCache();
    const first = await readMerchantSessionPayload();
    const second = await readMerchantSessionPayload();

    assert.equal(first?.authenticated, true);
    assert.equal(second?.merchantId, "10000002");
    assert.equal(requestCount, 1);

    invalidateMerchantSessionPayloadCache();
    await readMerchantSessionPayload();
    assert.equal(requestCount, 2);
  } finally {
    invalidateMerchantSessionPayloadCache();
    Object.assign(globalThis, { fetch: previousFetch });
    harness.restore();
  }
});

test("merchant session payload briefly dedupes an unauthenticated response", async () => {
  const harness = installWindowStorage();
  const previousFetch = globalThis.fetch;
  let requestCount = 0;
  Object.assign(globalThis, {
    fetch: async () => {
      requestCount += 1;
      return new Response(null, { status: 401 });
    },
  });

  try {
    invalidateMerchantSessionPayloadCache();
    assert.equal(await readMerchantSessionPayload(), null);
    assert.equal(await readMerchantSessionPayload(), null);
    assert.equal(requestCount, 1);
  } finally {
    invalidateMerchantSessionPayloadCache();
    Object.assign(globalThis, { fetch: previousFetch });
    harness.restore();
  }
});
