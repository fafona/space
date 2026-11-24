import assert from "node:assert/strict";
import test from "node:test";
import { checkoutResumeFixture } from "../../scripts/fixtures/member-checkout-resume";
import { handleCheckoutHistoryPending, type CheckoutHistoryPendingDependencies } from "./merchantCheckoutHistoryPending.server";
import { handleCheckoutIntent } from "./merchantCheckoutIntentHttp.server";
import { handleCheckoutEntry } from "../app/api/member-checkout/entry/route-handler";
import { createCheckoutResumeController } from "./merchantCheckoutResumeClient";
import { checkoutHistoryPendingTransport } from "./merchantCheckoutHistoryTransport";

const origin = "https://history-resume.synthetic.invalid";
async function fixture(kind: Parameters<typeof checkoutResumeFixture>[0] = "cart_points") {
  const x = await checkoutResumeFixture(kind), calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  // Only this explicit synthetic session port is used; no admin client exists.
  const session = { accountId: x.accountId, userId: x.userId, servicePaused: false, user: { email_confirmed_at: "2026-11-24T12:00:00Z" } } as unknown as Awaited<ReturnType<CheckoutHistoryPendingDependencies["session"]>>;
  const deps: CheckoutHistoryPendingDependencies = { enabled: () => true, session: async () => session, call: async (name, args, signal) => {
    assert.ok(signal instanceof AbortSignal); calls.push({ name, args }); return { data: x.snapshot, error: null };
  } };
  const req = (body: unknown = { siteId: x.siteId }, headers: Record<string, string> = {}, query = "") => new Request(`${origin}/api/member-checkout/history/pending${query}`, {
    method: "POST", headers: { origin, "content-type": "application/json", "x-checkout-account-scope": x.accountId, ...headers }, body: JSON.stringify(body),
  });
  return { ...x, calls, session, deps, req };
}

test("history pending reads four exact-principal originals and never gives a review/ack/write capability", async () => {
  for (const kind of ["cart_points", "cart_on_site", "single_points", "single_on_site"] as const) {
    const x = await fixture(kind), response = await handleCheckoutHistoryPending(x.req(), x.deps), value = await response.json();
    assert.equal(response.status, 200); assert.equal(value.readOnly, true); assert.deepEqual(value.snapshot, x.snapshot);
    assert.deepEqual(Object.keys(value).sort(), ["ok", "readOnly", "snapshot"]);
    assert.deepEqual(x.calls, [{ name: "faolla_member_checkout_pending_intent_v1", args: { p_site_id: x.siteId, p_principal_key: `account:${x.accountId}:${x.userId}` } }]);
    assert.match(response.headers.get("cache-control")!, /private, no-store/); assert.match(response.headers.get("vary")!, /X-Checkout-Account-Scope/);
    // The old action handler still requires its own full gate, for all actions.
    for (const action of ["pending", "review", "acknowledge"] as const) {
      const body = action === "pending" ? { siteId: x.siteId } : { siteId: x.siteId, operationKey: x.snapshot.pending!.operationKey,
        ...(action === "acknowledge" ? { generation: 1, reviewHash: "a".repeat(64) } : {}) };
      const denied = await handleCheckoutIntent(action, x.req(body), { ...x.deps, enabled: () => false, call: async () => assert.fail("no intent grant") });
      assert.equal(denied.status, 503);
    }
  }
});

test("default-closed history scope performs no identity/storage IO and cannot be activated by a purchase hint", async () => {
  const x = await fixture(); let auth = 0;
  const response = await handleCheckoutHistoryPending(x.req(), { ...x.deps, enabled: () => false, session: async () => { auth++; return x.session; } });
  assert.equal(response.status, 503); assert.equal(auth, 0); assert.equal(x.calls.length, 0);
});

test("verb, origin, token, account hint, query, unknown action and bounded UTF8 body are checked before ledger access", async () => {
  const x = await fixture();
  for (const [request, status] of [[new Request(origin), 405], [x.req(undefined, { origin: "https://foreign.invalid" }), 403],
    [x.req(undefined, { "x-merchant-access-token": "private" }), 401], [x.req(undefined, { "x-checkout-account-scope": "" }), 401],
    [x.req(undefined, {}, "?readOnly=false"), 400], [x.req({ siteId: x.siteId, action: "acknowledge" }), 400],
    [x.req({ siteId: x.siteId, nonce: "untrusted" }), 400], [x.req({ siteId: x.siteId, principalKey: "other" }), 400],
    [x.req({ siteId: x.siteId, other: "x".repeat(2100) }), 400], [x.req(undefined, { "content-type": "text/plain" }), 400],
    [new Request(x.req(), { body: new Uint8Array([123, 255, 125]) }), 400]] as const) {
    assert.equal((await handleCheckoutHistoryPending(request, x.deps)).status, status);
  }
  assert.equal(x.calls.length, 0);
});

test("unverified/paused/other identity cannot read; same account but changed userId also hides late facts", async () => {
  const x = await fixture();
  for (const session of [null, { ...x.session!, servicePaused: true }, { ...x.session!, accountId: "59999999" }, { ...x.session!, user: { email_confirmed_at: "" } }]) {
    assert.equal((await handleCheckoutHistoryPending(x.req(), { ...x.deps, session: async () => session as typeof x.session })).status, 401);
  }
  assert.equal(x.calls.length, 0); let sent = false;
  const response = await handleCheckoutHistoryPending(x.req(), { ...x.deps,
    session: async () => sent ? { ...x.session!, userId: "changed-synthetic-user" } : x.session,
    call: async (...args) => { sent = true; return x.deps.call(...args); },
  });
  assert.equal(response.status, 503); assert.deepEqual(await response.json(), { error: "checkout_intent_unavailable" });
});

test("scope loss, malformed/cross-site data, missing SQL/ACL and private failures never fall back or imply no original", async () => {
  const x = await fixture();
  for (const mode of ["scope", "malformed", "cross-site", "sql-disabled", "missing-acl", "throw"]) {
    let sent = false;
    const response = await handleCheckoutHistoryPending(x.req(), { ...x.deps, enabled: () => !sent || mode !== "scope", call: async () => {
      sent = true; if (mode === "throw") throw Error("PRIVATE failure");
      return { data: mode === "scope" ? x.snapshot : mode === "cross-site" ? { ...x.snapshot, siteId: "00000000" } : {},
        error: mode === "sql-disabled" ? { message: "checkout_intent_disabled" } : mode === "missing-acl" ? { message: "PRIVATE permission denied" } : null };
    } });
    assert.equal(response.status, 503); assert.deepEqual(await response.json(), { error: "checkout_intent_unavailable" });
  }
});

test("shared deadline bounds uncooperative session/SQL and never authorizes a late read", async t => {
  const x = await fixture(), timeout = AbortSignal.timeout.bind(AbortSignal); t.mock.method(AbortSignal, "timeout", () => timeout(10));
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    for (const stage of ["session", "sql"]) {
      let release!: (v: unknown) => void, reads = 0;
      const held = new Promise<unknown>(r => { release = r; });
      const response = await handleCheckoutHistoryPending(x.req(), { ...x.deps,
        session: async () => stage === "session" ? await held as typeof x.session : x.session,
        call: async () => { reads++; return stage === "sql" ? await held as Awaited<ReturnType<typeof x.deps.call>> : { data: x.snapshot, error: null }; },
      });
      assert.equal(response.status, 503); assert.equal(reads, stage === "session" ? 0 : 1);
      release(stage === "session" ? x.session : { data: x.snapshot, error: null }); await new Promise(r => setImmediate(r));
      assert.equal(reads, stage === "session" ? 0 : 1);
    }
  } finally { clearTimeout(keepAlive); }
});

test("public source with purchase closed supplies only a history link, with no catalog/session/ledger or cart authority", async () => {
  const x = await fixture(), query = { siteId: x.siteId, kind: "booking", blockId: "b1", viewport: "mobile" };
  const response = await handleCheckoutEntry(x.req(query), { enabled: () => false, historyEnabled: () => true,
    recoveryEnabled: () => assert.fail("not an intent grant"), session: async () => assert.fail("navigation only"), read: async () => assert.fail("navigation only") });
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { ok: true, entry: null, recovery: { siteId: x.siteId } });
  const closed = await handleCheckoutEntry(x.req(query), { enabled: () => false, historyEnabled: () => false });
  assert.deepEqual(await closed.json(), { ok: true, entry: null });
});

test("final read-only envelope conversion cannot revive an aborted, expired or revoked response", async t => {
  for (const mode of ["abort", "deadline", "scope", "scope-error"]) {
    const x = await fixture(), abort = new AbortController(), original = Response.prototype.json, now = Date.now(); let converted = false;
    const jsonMock = t.mock.method(Response.prototype, "json", async function (this: Response) {
      const value = await original.call(this); converted = true; if (mode === "abort") abort.abort(); return value;
    });
    const clock = t.mock.method(Date, "now", () => now + (converted && mode === "deadline" ? 12_001 : 0));
    let response: Response;
    try { response = await handleCheckoutHistoryPending(new Request(x.req(), { signal: abort.signal }), { ...x.deps, enabled: () => {
      if (converted && mode === "scope-error") throw Error("PRIVATE scope failure"); return !converted || mode !== "scope";
    } }); } finally { jsonMock.mock.restore(); clock.mock.restore(); }
    assert.equal(response.status, 503); assert.deepEqual(await response.json(), { error: "checkout_intent_unavailable" });
  }
});

test("history controller accepts only explicit read-only envelopes and exposes no nonce/draft/write methods", async () => {
  const x = await fixture(); let raw: unknown = { ok: true, readOnly: true, snapshot: x.snapshot }; const paths: string[] = [];
  const c = createCheckoutResumeController({ ...x, readOnly: true, request: async (path, body) => { paths.push(path); assert.deepEqual(body, { siteId: x.siteId }); return raw; } });
  await c.activate(); assert.deepEqual(c.getSnapshot().snapshot, x.snapshot);
  assert.deepEqual(Object.keys(c).sort(), ["activate", "deactivate", "getSnapshot", "read", "subscribe"]);
  for (const readOnly of [undefined, false, "true"]) {
    raw = { ok: true, readOnly, snapshot: x.snapshot }; await c.read(); assert.equal(c.getSnapshot().snapshot, null); assert.equal(c.getSnapshot().phase, "error");
  }
  raw = { ok: true, readOnly: true, snapshot: { version: 1, siteId: x.siteId, pending: null } }; await c.read(); assert.equal(c.getSnapshot().snapshot?.pending, null);
  assert.ok(paths.every(p => p === "/api/member-checkout/history/pending")); c.deactivate();
});

test("default history transport uses the exact account header and cannot call ack, cancel, quote or submit", async t => {
  const x = await fixture(), calls: Array<{ path: string; init: RequestInit }> = [];
  t.mock.method(globalThis, "fetch", async (path: string, init: RequestInit) => { calls.push({ path, init }); return Response.json({ ok: true, readOnly: true, snapshot: x.snapshot }); });
  const c = createCheckoutResumeController({ ...x, readOnly: true }); await c.activate(); assert.equal(c.getSnapshot().phase, "ready");
  const sent = calls[0]; assert.equal(sent.path, "/api/member-checkout/history/pending"); assert.equal(sent.init.method, "POST"); assert.equal(sent.init.credentials, "same-origin"); assert.equal(sent.init.cache, "no-store");
  assert.equal(new Headers(sent.init.headers).get("x-checkout-account-scope"), x.accountId); assert.equal(sent.init.body, JSON.stringify({ siteId: x.siteId }));
  const transport = checkoutHistoryPendingTransport(x.accountId);
  for (const path of ["/api/member-checkout/intent/acknowledge", "/api/member-checkout/intent/pending", "/api/member-checkout/cart/submit", "/api/member-checkout/cancel", "https://foreign.invalid"]) {
    await assert.rejects(transport(path, {}, new AbortController().signal), /checkout_invalid_request/);
  }
  assert.equal(calls.length, 1); c.deactivate();
});
