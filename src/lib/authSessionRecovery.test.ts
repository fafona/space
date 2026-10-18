import test from "node:test";
import assert from "node:assert/strict";
import {
  clearStoredBrowserSupabaseSessionTokens,
  hasStoredBrowserSupabaseSessionTokens,
  invalidateMerchantSessionPayloadCache,
  persistBrowserSupabaseSessionSnapshot,
  readMerchantSessionMerchantIds,
  readMerchantSessionPayload,
  readMerchantSessionResult,
  startMerchantSessionKeepAlive,
} from "@/lib/authSessionRecovery";
import { legacySupabaseAuthStorageKey, resolvedSupabaseAuthStorageKey, supabase } from "@/lib/supabase";

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
  } as unknown as Window & typeof globalThis;
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

test("persisted browser auth snapshot remains in the current tab and clears durable legacy copies", () => {
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
      assert.equal(harness.localStorage.getItem(key), null);
    });
    assert.equal(hasStoredBrowserSupabaseSessionTokens(), true);
  } finally {
    harness.restore();
  }
});

test("durable legacy browser auth snapshots are rejected and removed", () => {
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

    const storageKeys = [resolvedSupabaseAuthStorageKey, legacySupabaseAuthStorageKey].filter(Boolean);
    harness.sessionStorage.clear();
    storageKeys.forEach((key) => {
      harness.localStorage.setItem(
        key,
        JSON.stringify({ access_token: "legacy-access", refresh_token: "legacy-refresh" }),
      );
    });
    assert.equal(hasStoredBrowserSupabaseSessionTokens(), false);
    storageKeys.forEach((key) => assert.equal(harness.localStorage.getItem(key), null));

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

test("only explicit 401/403 session rejections confirm unauthenticated status", async () => {
  const harness = installWindowStorage();
  const previousFetch = globalThis.fetch;
  try {
    for (const status of [401, 403]) {
      invalidateMerchantSessionPayloadCache();
      let calls = 0;
      globalThis.fetch = async () => {
        calls += 1;
        return new Response(null, { status });
      };
      assert.deepEqual(await readMerchantSessionResult(), { status: "unauthenticated", payload: null });
      assert.equal(await readMerchantSessionPayload(), null);
      assert.equal(calls, 1);
    }
  } finally {
    invalidateMerchantSessionPayloadCache();
    globalThis.fetch = previousFetch;
    harness.restore();
  }
});

test("service errors, origin rejection and malformed responses are unknown, never signed out or cached", async () => {
  const harness = installWindowStorage();
  const previousFetch = globalThis.fetch;
  const failures = [
    ...[421, 429, 500, 503].map((status) => async () => new Response(null, { status })),
    async () => { throw new TypeError("synthetic offline"); },
    async () => new Response("<html>proxy error</html>"),
    async () => Response.json(null),
    async () => Response.json({ authenticated: false }),
    async () => Response.json({ authenticated: true, user: {} }),
    async () => Response.json({ authenticated: true, user: { id: 1 } }),
  ];
  try {
    for (const failure of failures) {
      invalidateMerchantSessionPayloadCache();
      let calls = 0;
      globalThis.fetch = async () => { calls += 1; return failure(); };
      assert.deepEqual(await readMerchantSessionResult(), { status: "unavailable", payload: null });
      assert.equal(await readMerchantSessionPayload(), null);
      assert.equal(calls, 2, "temporary failure must not populate the signed-out cache");
    }
  } finally {
    invalidateMerchantSessionPayloadCache();
    globalThis.fetch = previousFetch;
    harness.restore();
  }
});

test("force recheck bypasses a cached identity and shares its result with identity-only callers", async () => {
  const harness = installWindowStorage();
  const previousFetch = globalThis.fetch;
  let calls = 0;
  try {
    invalidateMerchantSessionPayloadCache();
    globalThis.fetch = async () => {
      calls += 1;
      return calls === 1
        ? Response.json({ authenticated: true, user: { id: "synthetic-user" } })
        : new Response(null, { status: 401 });
    };
    assert.equal((await readMerchantSessionResult()).status, "authenticated");
    assert.equal((await readMerchantSessionPayload())?.user?.id, "synthetic-user");
    assert.equal(calls, 1);
    assert.equal((await readMerchantSessionResult(4500, { forceRefresh: true })).status, "unauthenticated");
    assert.equal(await readMerchantSessionPayload(), null);
    assert.equal(calls, 2);
  } finally {
    invalidateMerchantSessionPayloadCache();
    globalThis.fetch = previousFetch;
    harness.restore();
  }
});

test("concurrent status and identity readers share one session request", async () => {
  const harness = installWindowStorage();
  const previousFetch = globalThis.fetch;
  let release: (() => void) | undefined;
  let calls = 0;
  try {
    invalidateMerchantSessionPayloadCache();
    globalThis.fetch = async () => {
      calls += 1;
      await new Promise<void>((resolve) => { release = resolve; });
      return Response.json({ authenticated: true, user: { id: "synthetic-user" } });
    };
    const status = readMerchantSessionResult();
    const identity = readMerchantSessionPayload();
    release?.();
    assert.equal((await status).status, "authenticated");
    assert.equal((await identity)?.user?.id, "synthetic-user");
    assert.equal(calls, 1);
  } finally {
    release?.();
    invalidateMerchantSessionPayloadCache();
    globalThis.fetch = previousFetch;
    harness.restore();
  }
});

test("session timeout bounds JSON body reads as well as response headers", async () => {
  const harness = installWindowStorage();
  const previousFetch = globalThis.fetch;
  try {
    invalidateMerchantSessionPayloadCache();
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      json: () => new Promise(() => {}),
    }) as Response;
    assert.deepEqual(await readMerchantSessionResult(1200), { status: "unavailable", payload: null });
  } finally {
    invalidateMerchantSessionPayloadCache();
    globalThis.fetch = previousFetch;
    harness.restore();
  }
});

test("keepalive does not attempt SDK recovery or cookie sync during a service outage", async () => {
  const harness = installWindowStorage();
  const previousFetch = globalThis.fetch;
  const previousDocument = globalThis.document;
  const originalGetSession = supabase.auth.getSession;
  let sdkCalls = 0;
  let fetchCalls = 0;
  let dispose: (() => void) | undefined;
  try {
    invalidateMerchantSessionPayloadCache();
    Object.assign(window, { setInterval, clearInterval, addEventListener() {}, removeEventListener() {} });
    Object.assign(globalThis, { document: { visibilityState: "visible", addEventListener() {}, removeEventListener() {} } });
    supabase.auth.getSession = async () => { sdkCalls += 1; return { data: { session: null }, error: null }; };
    globalThis.fetch = async (_input, init) => {
      fetchCalls += 1;
      assert.equal(init?.method, "GET");
      return new Response(null, { status: 503 });
    };
    dispose = startMerchantSessionKeepAlive();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(fetchCalls, 1);
    assert.equal(sdkCalls, 0);
  } finally {
    dispose?.();
    invalidateMerchantSessionPayloadCache();
    globalThis.fetch = previousFetch;
    supabase.auth.getSession = originalGetSession;
    if (previousDocument === undefined) Reflect.deleteProperty(globalThis, "document");
    else Object.assign(globalThis, { document: previousDocument });
    harness.restore();
  }
});
