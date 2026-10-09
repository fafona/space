import assert from "node:assert/strict";
import test from "node:test";
import { createEnterpriseLogoutBoundary } from "./merchantEnterpriseLogout";

const key = "faolla-enterprise-auth-token", marker = key + ".logout-pending", userKey = key + "-user", verifierKey = key + "-code-verifier";
const oldSession = JSON.stringify({ access_token: "old-access", refresh_token: "old-refresh", user: { id: "old-employee" } });
const newSession = JSON.stringify({ access_token: "new-access", refresh_token: "new-refresh", user: { id: "new-employee" } });
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function flush() { for (let index = 0; index < 12; index++) await Promise.resolve(); }
function memory(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  const failGet = new Set<string>(), failSet = new Set<string>(), failRemove = new Set<string>(), ignoreSet = new Set<string>(), ignoreRemove = new Set<string>();
  const writes: { operation: "set" | "remove"; key: string; value?: string }[] = [];
  const storage = {
    getItem: (name: string) => { if (failGet.has(name)) throw Error("synthetic read denied"); return values.get(name) ?? null; },
    setItem: (name: string, value: string) => { writes.push({ operation: "set", key: name, value }); if (failSet.has(name)) throw Error("synthetic write denied"); if (!ignoreSet.has(name)) values.set(name, value); },
    removeItem: (name: string) => { writes.push({ operation: "remove", key: name }); if (failRemove.has(name)) throw Error("synthetic removal denied"); if (!ignoreRemove.has(name)) values.delete(name); },
  };
  return { storage, values, writes, failGet, failSet, failRemove, ignoreSet, ignoreRemove };
}
const seeded = () => memory({ [key]: oldSession, [userKey]: "old-user", [verifierKey]: "old-pkce" });
const assertOwnedCleared = (store: ReturnType<typeof memory>) => {
  for (const owned of [key, userKey, verifierKey]) assert.equal(store.values.has(owned), false, owned);
};

test("boundary validates only the enterprise token namespace and leaves normal SDK callbacks compatible", () => {
  for (const invalid of ["", "faolla-auth-token", "merchant-space:password-reset-session:v1", "faolla-enterprise-auth-token-user", "faolla-enterprise-auth-token.logout-pending"])
    assert.throws(() => createEnterpriseLogoutBoundary(memory().storage, invalid));
  const store = seeded(), boundary = createEnterpriseLogoutBoundary(store.storage, key);
  assert.equal(boundary.isBlocked(), false); assert.equal(boundary.storage.getItem(key), oldSession);
  boundary.storage.setItem(key, newSession); assert.equal(boundary.storage.getItem(key), newSession);
  boundary.storage.removeItem(key); assert.equal(store.values.has(key), false);
  boundary.storage.setItem(verifierKey, "fresh-invitation-pkce"); assert.equal(store.values.get(verifierKey), "fresh-invitation-pkce");
});

test("logout synchronously fences persistence before SDK action, lending old session only in RAM for revocation", async () => {
  const store = seeded(), pending = deferred<{ error: Error | null }>(), boundary = createEnterpriseLogoutBoundary(store.storage, key);
  let invoked = 0;
  const logout = boundary.signOut(async () => {
    invoked++; assert.equal(boundary.isBlocked(), true); assertOwnedCleared(store);
    assert.equal(boundary.storage.getItem(key), oldSession, "SDK still receives original JWT for remote revocation");
    assert.equal(boundary.storage.getItem(userKey), null); assert.equal(boundary.storage.getItem(verifierKey), null);
    return pending.promise;
  });
  assert.equal(boundary.isBlocked(), true); assertOwnedCleared(store); assert.notEqual(store.values.get(marker), undefined);
  assert.equal([...store.values.values()].some(value => value.includes("old-access") || value.includes("old-refresh")), false);
  await flush(); assert.equal(invoked, 1);
  pending.resolve({ error: null }); assert.deepEqual(await logout, { error: null, localCleared: true });
  assert.equal(boundary.storage.getItem(key), null); assert.equal(boundary.isBlocked(), true); assertOwnedCleared(store);
});

test("late token refresh writes are ignored both during logout and after its completion", async () => {
  const store = seeded(), pending = deferred<{ error: Error | null }>(), boundary = createEnterpriseLogoutBoundary(store.storage, key);
  const logout = boundary.signOut(() => pending.promise);
  for (const owned of [key, userKey, verifierKey]) boundary.storage.setItem(owned, "late-secret");
  assertOwnedCleared(store); assert.equal(boundary.storage.getItem(key), oldSession);
  pending.resolve({ error: null }); await logout;
  for (const owned of [key, userKey, verifierKey]) boundary.storage.setItem(owned, "late-secret");
  assertOwnedCleared(store); assert.equal(boundary.storage.getItem(key), null); assert.equal(boundary.isBlocked(), true);
});

test("concurrent duplicate logout is single-flight and returns the same promise", async () => {
  const store = seeded(), pending = deferred<{ error: Error | null }>(), boundary = createEnterpriseLogoutBoundary(store.storage, key);
  let calls = 0;
  const action = () => { calls++; return pending.promise; };
  const first = boundary.signOut(action), second = boundary.signOut(action);
  assert.equal(first, second); await flush(); assert.equal(calls, 1);
  pending.resolve({ error: null }); assert.deepEqual(await first, await second); assert.equal(calls, 1);
});

test("remote returned failure and thrown failure both clean locally and preserve the signed-out barrier", async () => {
  for (const thrown of [false, true]) {
    const store = seeded(), boundary = createEnterpriseLogoutBoundary(store.storage, key), error = Error("synthetic remote failure");
    const result = await boundary.signOut(async () => { if (thrown) throw error; return { error }; });
    assert(result.error instanceof Error); if (!thrown) assert.equal(result.error, error);
    assert.equal(result.localCleared, true); assert.equal(boundary.isBlocked(), true);
    assert.equal(boundary.storage.getItem(key), null); assertOwnedCleared(store);
  }
});

test("a non-Error thrown value is normalized without preventing final local cleanup", async () => {
  const store = seeded(), boundary = createEnterpriseLogoutBoundary(store.storage, key);
  const result = await boundary.signOut(async () => { throw "synthetic failure"; });
  assert(result.error instanceof Error); assert.equal(result.localCleared, true); assert.equal(boundary.isBlocked(), true); assertOwnedCleared(store);
});

test("logout preserves owner, password-recovery, other employee namespace and attendance pending keys", async () => {
  const unrelated = { "sb-project-auth-token": "merchant-owner-session", "merchant-space:password-reset-session:v1": "password-recovery",
    "other-enterprise-auth-token": "other-tab-namespace", "faolla:attendance:onsite:pending:99990001:employee": "immutable-operation-id",
    "enterprise-invitation:99990001": "invitation-recovery" };
  const store = memory({ ...unrelated, [key]: oldSession, [userKey]: "old-user", [verifierKey]: "old-pkce" });
  const boundary = createEnterpriseLogoutBoundary(store.storage, key); await boundary.signOut(async () => ({ error: null }));
  for (const [name, value] of Object.entries(unrelated)) assert.equal(store.values.get(name), value);
  assert(store.writes.every(write => [key, userKey, verifierKey, marker].includes(write.key)));
  boundary.storage.setItem("ordinary-application-key", "unchanged"); assert.equal(boundary.storage.getItem("ordinary-application-key"), "unchanged");
  boundary.storage.removeItem("ordinary-application-key"); assert.equal(store.values.has("ordinary-application-key"), false);
});

test("explicit new login waits for SDK logout cleanup before creating the fresh session", async () => {
  const store = seeded(), pending = deferred<{ error: Error | null }>(), boundary = createEnterpriseLogoutBoundary(store.storage, key);
  let started = false;
  const logout = boundary.signOut(async () => {
    const result = await pending.promise;
    boundary.storage.removeItem(key); boundary.storage.removeItem(userKey); boundary.storage.removeItem(verifierKey);
    return result;
  });
  const login = boundary.signIn(async () => {
    started = true; boundary.storage.setItem(key, newSession); boundary.storage.setItem(userKey, "new-user"); return { error: null, session: "fresh" };
  });
  await flush(); assert.equal(started, false); assertOwnedCleared(store);
  pending.resolve({ error: null }); await logout; assert.deepEqual(await login, { error: null, session: "fresh" });
  assert.equal(started, true); assert.equal(boundary.isBlocked(), false); assert.equal(store.values.get(key), newSession);
  assert.equal(boundary.storage.getItem(key), newSession);
});

test("explicit successful login can recover from remote logout failure once local cleanup has settled", async () => {
  const store = seeded(), boundary = createEnterpriseLogoutBoundary(store.storage, key);
  await boundary.signOut(async () => ({ error: Error("remote unavailable") }));
  const result = await boundary.signIn(async () => { boundary.storage.setItem(key, newSession); return { error: null }; });
  assert.deepEqual(result, { error: null }); assert.equal(boundary.isBlocked(), false); assert.equal(store.values.get(key), newSession);
});

test("failed explicit login response purges a partially persisted session and stays blocked", async () => {
  const store = seeded(), boundary = createEnterpriseLogoutBoundary(store.storage, key);
  await boundary.signOut(async () => ({ error: null })); const error = Error("invalid credentials");
  const result = await boundary.signIn(async () => {
    boundary.storage.setItem(key, newSession); boundary.storage.setItem(userKey, "partial-user"); boundary.storage.setItem(verifierKey, "partial-verifier");
    return { error };
  });
  assert.equal(result.error, error); assert.equal(boundary.isBlocked(), true); assertOwnedCleared(store); assert.equal(boundary.storage.getItem(key), null);
});

test("thrown explicit login failure purges partial keys and does not suppress the error", async () => {
  const store = seeded(), boundary = createEnterpriseLogoutBoundary(store.storage, key);
  await boundary.signOut(async () => ({ error: null })); const error = Error("network login failure");
  await assert.rejects(boundary.signIn(async () => {
    boundary.storage.setItem(key, newSession); boundary.storage.setItem(userKey, "partial-user"); boundary.storage.setItem(verifierKey, "partial-verifier"); throw error;
  }), value => value === error);
  assert.equal(boundary.isBlocked(), true); assertOwnedCleared(store);
});

test("successful action without a verified main-session write cannot release the barrier", async () => {
  const store = seeded(), boundary = createEnterpriseLogoutBoundary(store.storage, key);
  await boundary.signOut(async () => ({ error: null }));
  await boundary.signIn(async () => ({ error: null }));
  assert.equal(boundary.isBlocked(), true); assertOwnedCleared(store);
});

test("concurrent sign-in and sign-out-during-sign-in reject without invoking a competing action", async () => {
  const store = memory(), boundary = createEnterpriseLogoutBoundary(store.storage, key), pending = deferred<{ error: null }>();
  let firstCalls = 0, competingCalls = 0;
  const login = boundary.signIn(async () => { firstCalls++; const result = await pending.promise; boundary.storage.setItem(key, newSession); return result; });
  await flush(); assert.equal(firstCalls, 1);
  await assert.rejects(boundary.signIn(async () => { competingCalls++; return { error: null }; }));
  const logout = await boundary.signOut(async () => { competingCalls++; return { error: null }; });
  assert(logout.error instanceof Error); assert.equal(logout.localCleared, false);
  assert.equal(competingCalls, 0); pending.resolve({ error: null }); await login; assert.equal(store.values.get(key), newSession);
});

test("a newly loaded boundary consumes durable logout intent without borrowing the old document's RAM token", async () => {
  const store = seeded(), pending = deferred<{ error: Error | null }>(), first = createEnterpriseLogoutBoundary(store.storage, key);
  const logout = first.signOut(() => pending.promise);
  assert.equal(first.storage.getItem(key), oldSession);
  // Simulate storage left behind by an older SDK instance after navigation.
  store.values.set(key, oldSession); store.values.set(userKey, "stale-user"); store.values.set(verifierKey, "stale-verifier");
  const second = createEnterpriseLogoutBoundary(store.storage, key);
  assert.equal(second.storage.getItem(key), null); assertOwnedCleared(store);
  assert.equal(second.isBlocked(), false, "verified reload cleanup permits fresh invitation callbacks");
  pending.resolve({ error: null }); await logout;
  second.storage.setItem(verifierKey, "fresh-callback-pkce"); second.storage.setItem(key, newSession);
  assert.equal(second.storage.getItem(key), newSession); assert.equal(second.isBlocked(), false);
});

test("resumed old-document logout cannot erase a new document's fresh callback session or verifier", async () => {
  const store = seeded(), pending = deferred<void>(), first = createEnterpriseLogoutBoundary(store.storage, key);
  let oldSdkCleanup = 0;
  const logout = first.signOut(async () => {
    await pending.promise;
    // The previous SDK resumes _removeSession after the new document has
    // already consumed its durable logout marker and established fresh auth.
    oldSdkCleanup++;
    first.storage.removeItem(key);
    first.storage.removeItem(userKey);
    first.storage.removeItem(verifierKey);
    return { error: null };
  });
  assert.equal(first.storage.getItem(key), oldSession);
  const second = createEnterpriseLogoutBoundary(store.storage, key);
  assertOwnedCleared(store); assert.equal(second.isBlocked(), false);
  second.storage.setItem(key, newSession);
  second.storage.setItem(userKey, "new-document-user");
  second.storage.setItem(verifierKey, "new-document-pkce");
  assert.equal(second.storage.getItem(key), newSession);
  pending.resolve(); await logout;
  assert.equal(oldSdkCleanup, 1, "the original SDK actually resumed its removal calls");
  assert.equal(store.values.get(key), newSession);
  assert.equal(store.values.get(userKey), "new-document-user");
  assert.equal(store.values.get(verifierKey), "new-document-pkce");
  assert.equal(second.storage.getItem(key), newSession); assert.equal(second.isBlocked(), false);
  assert.equal(first.isBlocked(), true, "old document remains signed out even though another document is authenticated");
});

test("new document stays blocked if the original logout marker cannot be consumed, even after session removal", async () => {
  for (const failure of ["throw", "ignore"] as const) {
    const store = seeded(), pending = deferred<void>(), first = createEnterpriseLogoutBoundary(store.storage, key);
    const logout = first.signOut(async () => {
      await pending.promise;
      first.storage.removeItem(key); first.storage.removeItem(userKey); first.storage.removeItem(verifierKey);
      return { error: null };
    });
    const originalMarker = store.values.get(marker); assert.notEqual(originalMarker, undefined);
    if (failure === "throw") store.failRemove.add(marker); else store.ignoreRemove.add(marker);
    const second = createEnterpriseLogoutBoundary(store.storage, key);
    assertOwnedCleared(store); assert.equal(store.values.get(marker), originalMarker);
    assert.equal(second.isBlocked(), true, `${failure}: old document still owns its durable marker`);
    second.storage.setItem(key, newSession); second.storage.setItem(userKey, "new-user"); second.storage.setItem(verifierKey, "new-pkce");
    assertOwnedCleared(store); assert.equal(second.storage.getItem(key), null);
    pending.resolve(); await logout; assertOwnedCleared(store); assert.equal(second.isBlocked(), true);
    store.failRemove.clear(); store.ignoreRemove.clear();
    const recovered = createEnterpriseLogoutBoundary(store.storage, key);
    assert.equal(recovered.isBlocked(), false); assert.equal(store.values.has(marker), false);
    recovered.storage.setItem(key, newSession); assert.equal(store.values.get(key), newSession);
  }
});

test("standalone marker recovery verifies removal before allowing regular callback session writes", () => {
  const store = memory({ [marker]: "1", [key]: oldSession, [userKey]: "old-user", [verifierKey]: "old-pkce" });
  const boundary = createEnterpriseLogoutBoundary(store.storage, key); assertOwnedCleared(store);
  assert.equal(boundary.isBlocked(), false); boundary.storage.setItem(key, newSession); assert.equal(store.values.get(key), newSession);
});

test("failed marker recovery stays blocked and hides a persisted old session", () => {
  for (const failure of ["throw", "ignore", "read"] as const) {
    const store = memory({ [marker]: "1", [key]: oldSession });
    if (failure === "throw") store.failRemove.add(key);
    if (failure === "ignore") store.ignoreRemove.add(key);
    if (failure === "read") store.failGet.add(key);
    const boundary = createEnterpriseLogoutBoundary(store.storage, key);
    assert.equal(boundary.isBlocked(), true); assert.equal(boundary.storage.getItem(key), null);
    boundary.storage.setItem(key, newSession); assert.notEqual(store.values.get(key), newSession);
  }
});

test("unreadable marker purges old state but blocks callbacks until marker absence can be verified", () => {
  const store = seeded(); store.failGet.add(marker);
  const boundary = createEnterpriseLogoutBoundary(store.storage, key);
  assertOwnedCleared(store); assert.equal(boundary.isBlocked(), true); assert.equal(boundary.storage.getItem(key), null);
  boundary.storage.setItem(key, newSession); assertOwnedCleared(store);
  const failed = seeded(); failed.failGet.add(marker); failed.failRemove.add(key);
  const blocked = createEnterpriseLogoutBoundary(failed.storage, key);
  assert.equal(blocked.isBlocked(), true); assert.equal(blocked.storage.getItem(key), null); assert.equal(failed.values.get(key), oldSession);
});

test("localCleared is false if any owned key survives cleanup or cannot be verified", async () => {
  for (const owned of [key, userKey, verifierKey]) {
    for (const failure of ["throw", "ignore", "read"] as const) {
      const store = seeded(), boundary = createEnterpriseLogoutBoundary(store.storage, key);
      if (failure === "throw") store.failRemove.add(owned);
      if (failure === "ignore") store.ignoreRemove.add(owned);
      if (failure === "read") store.failGet.add(owned);
      const result = await boundary.signOut(async () => ({ error: null }));
      assert.equal(result.localCleared, false, `${owned}:${failure}`); assert.equal(boundary.isBlocked(), true); assert.equal(boundary.storage.getItem(key), null);
    }
  }
});

test("failure to persist marker plus failed token removal never claims navigation-safe cleanup", async () => {
  const store = seeded(), boundary = createEnterpriseLogoutBoundary(store.storage, key);
  store.failSet.add(marker); store.failRemove.add(key);
  const result = await boundary.signOut(async () => ({ error: null }));
  assert.equal(result.localCleared, false); assert.equal(store.values.get(key), oldSession); assert.equal(boundary.isBlocked(), true);
  assert.equal(boundary.storage.getItem(key), null);
});

test("a marker write failure does not prevent verified local purge or preserve a RAM token after logout", async () => {
  const store = seeded(), boundary = createEnterpriseLogoutBoundary(store.storage, key); store.failSet.add(marker);
  const result = await boundary.signOut(async () => ({ error: null }));
  assert.equal(result.localCleared, true); assertOwnedCleared(store); assert.equal(boundary.storage.getItem(key), null); assert.equal(boundary.isBlocked(), true);
});

test("fresh login persistence must read back exactly; thrown, dropped and unreadable writes cannot open auth", async () => {
  for (const failure of ["throw", "ignore", "read"] as const) {
    const store = seeded(), boundary = createEnterpriseLogoutBoundary(store.storage, key); await boundary.signOut(async () => ({ error: null }));
    if (failure === "throw") store.failSet.add(key);
    if (failure === "ignore") store.ignoreSet.add(key);
    if (failure === "read") store.failGet.add(key);
    try { await boundary.signIn(async () => { boundary.storage.setItem(key, newSession); return { error: null }; }); } catch { /* A persistence exception may propagate, but must never open auth. */ }
    assert.equal(boundary.isBlocked(), true); assert.equal(boundary.storage.getItem(key), null);
    store.failGet.clear(); assert.equal(store.storage.getItem(key), null);
  }
});

test("explicit fresh login also requires verified marker removal before opening the boundary", async () => {
  for (const failure of ["throw", "ignore", "read"] as const) {
    const store = seeded(), boundary = createEnterpriseLogoutBoundary(store.storage, key);
    await boundary.signOut(async () => ({ error: Error("remote unavailable") }));
    assert.notEqual(store.values.get(marker), undefined);
    if (failure === "throw") store.failRemove.add(marker);
    if (failure === "ignore") store.ignoreRemove.add(marker);
    if (failure === "read") store.failGet.add(marker);
    await assert.rejects(boundary.signIn(async () => { boundary.storage.setItem(key, newSession); return { error: null }; }));
    assert.equal(boundary.isBlocked(), true); assertOwnedCleared(store); assert.equal(boundary.storage.getItem(key), null);
  }
});

test("logout finalization removes a raw stale write even when the SDK action reports failure", async () => {
  const store = seeded(), boundary = createEnterpriseLogoutBoundary(store.storage, key);
  const result = await boundary.signOut(async () => {
    store.values.set(key, oldSession); store.values.set(userKey, "late-user"); store.values.set(verifierKey, "late-verifier");
    return { error: Error("server rejected logout") };
  });
  assert(result.error instanceof Error); assert.equal(result.localCleared, true); assertOwnedCleared(store);
});
