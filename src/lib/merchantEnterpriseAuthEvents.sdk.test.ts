import assert from "node:assert/strict";
import test from "node:test";
import { GoTrueClient, processLock, type AuthChangeEvent, type Session, type User } from "@supabase/auth-js";
import { shouldApplyEnterpriseAuthEvent } from "./merchantEnterpriseAuthEvents";
import { createEnterpriseLogoutBoundary } from "./merchantEnterpriseLogout";

// The installed SDK runs unchanged. Only its public fetch/storage/lock options
// are supplied; this is not a browser, live Auth, or BroadcastChannel test.
const origin = "https://synthetic-enterprise-auth.invalid";
const email = "employee-sdk@example.invalid";
const userId = "00000000-0000-4000-8000-000000000101";
let nextHarness = 0;

function syntheticUser(): User {
  return {
    id: userId,
    aud: "authenticated",
    role: "authenticated",
    email,
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: {},
    created_at: "2026-01-01T00:00:00.000Z",
  };
}

function syntheticSession(serial: number, user = syntheticUser()): Session {
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  // This synthetic JWT is decoded by setSession; fake /user supplies the user.
  // No claim is made that this signature was verified by a real Auth server.
  return {
    access_token: `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: user.id, exp: expiresAt, jti: serial })}.${Buffer.from("synthetic-signature-only").toString("base64url")}`,
    refresh_token: `synthetic-refresh-${serial}`,
    token_type: "bearer",
    expires_in: 3600,
    expires_at: expiresAt,
    user,
  };
}

type RequestRecord = { path: string; method: string; body: Record<string, unknown>; authorization: string | null };
type EventRecord = { event: AuthChangeEvent; session: Session | null; saved: Session | null; allowed: boolean };

async function harness(seed: Session | null = null) {
  const key = `synthetic-sdk-${++nextHarness}-enterprise-auth-token`;
  const values = new Map<string, string>(seed ? [[key, JSON.stringify(seed)]] : []);
  const boundary = createEnterpriseLogoutBoundary({
    getItem: name => values.get(name) ?? null,
    setItem: (name, value) => { values.set(name, value); },
    removeItem: name => { values.delete(name); },
  }, key);
  const calls: RequestRecord[] = [];
  const unexpected: string[] = [];
  let user = seed?.user ?? syntheticUser();
  let serial = 100;
  let failRefresh = false;
  const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
    status, headers: { "content-type": "application/json", "x-supabase-api-version": "2024-01-01" },
  });
  const fetcher: typeof fetch = async (input, options) => {
    const request = new Request(input, options);
    const url = new URL(request.url);
    const raw = await request.text();
    const body = raw ? JSON.parse(raw) as Record<string, unknown> : {};
    calls.push({ path: url.pathname + url.search, method: request.method, body, authorization: request.headers.get("authorization") });
    if (url.origin === origin) {
      if (request.method === "POST" && url.pathname === "/auth/v1/token") {
        const grant = url.searchParams.get("grant_type");
        if (grant === "refresh_token" && failRefresh) {
          return json({ code: "refresh_token_not_found", message: "Synthetic refresh revoked" }, 400);
        }
        if (["password", "refresh_token", "pkce"].includes(grant ?? "")) return json(syntheticSession(++serial, user));
      }
      if (request.method === "GET" && url.pathname === "/auth/v1/user") return json(user);
      if (request.method === "PUT" && url.pathname === "/auth/v1/user") {
        user = { ...user, user_metadata: body.data as Record<string, unknown> };
        return json(user);
      }
      if (request.method === "POST" && url.pathname === "/auth/v1/logout") return new Response(null, { status: 204 });
      if (request.method === "POST" && url.pathname === "/auth/v1/recover") return json({});
      if (request.method === "POST" && url.pathname === "/auth/v1/verify" && body.type === "recovery") return json(syntheticSession(++serial, user));
    }
    // Never fall through to global fetch, even for an unexpected SDK request.
    unexpected.push(`${request.method} ${url.pathname}`);
    return json({ code: "unexpected_request", message: "Unexpected synthetic Auth request" }, 400);
  };
  const client = new GoTrueClient({
    url: `${origin}/auth/v1`,
    storageKey: key,
    storage: boundary.storage,
    fetch: fetcher,
    lock: processLock,
    // processLock otherwise leaves acquisition timers alive after success.
    // The actual exclusive lock remains; each test supplies a 5-second bound.
    lockAcquireTimeout: -1,
    persistSession: true,
    autoRefreshToken: false,
    detectSessionInUrl: false,
    flowType: "pkce",
  });
  const observed: EventRecord[] = [];
  const delivered: EventRecord[] = [];
  let ready!: () => void;
  const initial = new Promise<void>(resolve => { ready = resolve; });
  const { data: { subscription } } = client.onAuthStateChange((event, session) => {
    const allowed = shouldApplyEnterpriseAuthEvent(session, () => boundary.storage.getItem(key), boundary.isBlocked);
    const raw = values.get(key);
    const record = { event, session, saved: raw ? JSON.parse(raw) as Session : null, allowed };
    observed.push(record);
    if (allowed) delivered.push(record);
    if (event === "INITIAL_SESSION") ready();
  });
  await initial;
  return {
    client, key, values, calls, observed, delivered, boundary,
    failNextRefresh: () => { failRefresh = true; },
    login: () => boundary.signIn(() => client.signInWithPassword({ email, password: "Synthetic-sdk-test-only!" })),
    close: async () => {
      subscription.unsubscribe();
      await client.stopAutoRefresh();
      assert.deepEqual(unexpected, [], "SDK requests stay on the explicit in-memory Auth allowlist");
    },
  };
}

function assertSavedBeforeDelivery(record: EventRecord) {
  assert.equal(record.allowed, true);
  assert(record.session);
  assert(record.saved);
  assert.equal(record.session.access_token, record.saved.access_token);
  assert.equal(record.session.refresh_token, record.saved.refresh_token);
  assert.equal(record.session.user.id, record.saved.user.id);
}

test("real SDK initial empty session, password login, refresh, global logout and explicit re-login pass the synchronous filter", { timeout: 5000 }, async t => {
  const h = await harness();
  t.after(h.close);
  assert.deepEqual(h.delivered.map(row => [row.event, row.session]), [["INITIAL_SESSION", null]]);
  const signedIn = await h.login();
  assert.equal(signedIn.error, null);
  assertSavedBeforeDelivery(h.delivered.at(-1)!);
  assert.equal(h.delivered.at(-1)!.event, "SIGNED_IN");
  const refreshed = await h.client.refreshSession();
  assert.equal(refreshed.error, null);
  assert.notEqual(refreshed.data.session?.access_token, signedIn.data.session?.access_token);
  assert.equal(h.delivered.at(-1)!.event, "TOKEN_REFRESHED");
  assertSavedBeforeDelivery(h.delivered.at(-1)!);
  assert.equal(h.calls.at(-1)!.body.refresh_token, signedIn.data.session?.refresh_token);
  assert.equal((await h.client.getSession()).data.session?.access_token, refreshed.data.session?.access_token);

  const signedOut = await h.boundary.signOut(() => h.client.signOut());
  assert.equal(signedOut.error, null);
  assert.equal(signedOut.localCleared, true);
  assert.equal(h.boundary.isBlocked(), true);
  assert.equal(h.values.has(h.key), false);
  assert.deepEqual(h.delivered.at(-1), { event: "SIGNED_OUT", session: null, saved: null, allowed: true });
  assert.equal(h.calls.at(-1)!.path, "/auth/v1/logout?scope=global");
  assert.equal(h.calls.at(-1)!.authorization, `Bearer ${refreshed.data.session?.access_token}`);
  assert.equal((await h.client.getSession()).data.session, null);

  assert.equal((await h.login()).error, null);
  assert.equal(h.boundary.isBlocked(), false);
  assertSavedBeforeDelivery(h.delivered.at(-1)!);
  assert.deepEqual(h.delivered.map(row => row.event), ["INITIAL_SESSION", "SIGNED_IN", "TOKEN_REFRESHED", "SIGNED_OUT", "SIGNED_IN"]);
  assert.equal(h.observed.every(row => row.allowed), true);
});

test("real SDK INITIAL_SESSION restores the exact persisted identity without a fetch", { timeout: 5000 }, async t => {
  const original = syntheticSession(1);
  const h = await harness(original);
  t.after(h.close);
  const initial = h.delivered.find(row => row.event === "INITIAL_SESSION");
  assert(initial);
  assertSavedBeforeDelivery(initial);
  assert.equal(initial.session?.access_token, original.access_token);
  assert.equal((await h.client.getSession()).data.session?.user.id, original.user.id);
  assert.deepEqual(h.calls, []);
  assert.equal(h.observed.every(row => row.allowed), true);
});

test("real SDK USER_UPDATED saves changed user metadata before delivery and releases its lock", { timeout: 5000 }, async t => {
  const h = await harness();
  t.after(h.close);
  const signedIn = await h.login();
  assert.equal(signedIn.error, null);
  const updated = await h.client.updateUser({ data: { display_name: "Synthetic employee update" } });
  assert.equal(updated.error, null);
  const event = h.delivered.at(-1)!;
  assert.equal(event.event, "USER_UPDATED");
  assertSavedBeforeDelivery(event);
  assert.equal(event.session?.access_token, signedIn.data.session?.access_token);
  assert.equal(event.session?.user.user_metadata.display_name, "Synthetic employee update");
  assert.equal(event.saved?.user.user_metadata.display_name, "Synthetic employee update");
  assert.equal((await h.client.getSession()).data.session?.user.user_metadata.display_name, "Synthetic employee update");
  assert.equal(h.calls.at(-1)!.method, "PUT");
});

test("real SDK setSession verifies its user through fake Auth then delivers the saved SIGNED_IN session", { timeout: 5000 }, async t => {
  const h = await harness();
  t.after(h.close);
  const callbackSession = syntheticSession(7);
  const result = await h.client.setSession({ access_token: callbackSession.access_token, refresh_token: callbackSession.refresh_token });
  assert.equal(result.error, null);
  assert.deepEqual(h.delivered.map(row => row.event), ["INITIAL_SESSION", "SIGNED_IN"]);
  assertSavedBeforeDelivery(h.delivered.at(-1)!);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].path, "/auth/v1/user");
  assert.equal(h.calls[0].method, "GET");
  assert.equal(h.calls[0].authorization, `Bearer ${callbackSession.access_token}`);
  assert.equal((await h.client.getSession()).data.session?.access_token, callbackSession.access_token);
});

test("real SDK recovery PKCE generation and public code exchange preserve the verifier and saved-session event", { timeout: 5000 }, async t => {
  const h = await harness();
  t.after(h.close);
  assert.equal((await h.client.resetPasswordForEmail(email)).error, null);
  const verifierKey = `${h.key}-code-verifier`;
  const rawVerifier = h.values.get(verifierKey);
  assert(rawVerifier);
  const storedVerifier = JSON.parse(rawVerifier) as string;
  const [verifier, redirectType] = storedVerifier.split("/");
  assert.equal(redirectType, "PASSWORD_RECOVERY");
  assert(verifier.length > 0);
  assert.equal(h.calls[0].path, "/auth/v1/recover");
  assert.equal(typeof h.calls[0].body.code_challenge, "string");
  assert.equal(h.values.has(h.key), false, "requesting recovery alone cannot create an employee session");
  const exchanged = await h.client.exchangeCodeForSession("synthetic-recovery-code");
  assert.equal(exchanged.error, null);
  // This installed SDK returns the field at runtime but omits it from the
  // public method's declared result; assert its presence before narrowing.
  assert("redirectType" in exchanged.data);
  assert.equal(exchanged.data.redirectType, "PASSWORD_RECOVERY");
  assert.equal(h.calls.at(-1)!.path, "/auth/v1/token?grant_type=pkce");
  assert.deepEqual(h.calls.at(-1)!.body, { auth_code: "synthetic-recovery-code", code_verifier: verifier });
  assert.equal(h.values.has(verifierKey), false);
  // Manual exchange in this SDK emits SIGNED_IN; recovery is returned separately.
  assert.deepEqual(h.delivered.map(row => row.event), ["INITIAL_SESSION", "SIGNED_IN"]);
  assertSavedBeforeDelivery(h.delivered.at(-1)!);
  assert.equal((await h.client.getSession()).data.session?.access_token, exchanged.data.session?.access_token);
});

test("real SDK non-retryable refresh rejection removes persistence before accepted SIGNED_OUT", { timeout: 5000 }, async t => {
  const h = await harness();
  t.after(h.close);
  assert.equal((await h.login()).error, null);
  h.failNextRefresh();
  const result = await h.client.refreshSession();
  assert.equal(result.error?.code, "refresh_token_not_found");
  assert.equal(h.values.has(h.key), false);
  assert.deepEqual(h.delivered.at(-1), { event: "SIGNED_OUT", session: null, saved: null, allowed: true });
  assert.equal((await h.client.getSession()).data.session, null);
  assert.equal(h.observed.every(row => row.allowed), true);
});

test("real SDK public recovery verification preserves PASSWORD_RECOVERY rather than rewriting the event", { timeout: 5000 }, async t => {
  const h = await harness();
  t.after(h.close);
  const result = await h.client.verifyOtp({ token_hash: "synthetic-recovery-hash", type: "recovery" });
  assert.equal(result.error, null);
  assert.deepEqual(h.delivered.map(row => row.event), ["INITIAL_SESSION", "PASSWORD_RECOVERY"]);
  assertSavedBeforeDelivery(h.delivered.at(-1)!);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].path, "/auth/v1/verify");
  assert.equal(h.calls[0].body.type, "recovery");
  assert.equal(h.calls[0].body.token_hash, "synthetic-recovery-hash");
  assert.equal((await h.client.getSession()).data.session?.access_token, result.data.session?.access_token);
});
