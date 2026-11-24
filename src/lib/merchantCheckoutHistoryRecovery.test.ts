import assert from "node:assert/strict";
import test from "node:test";
import { historyRecoveryFixture } from "../../scripts/fixtures/member-checkout-history-recovery";
import { handleCheckoutHistoryRecovery, type CheckoutHistoryRecoveryDependencies } from "./merchantCheckoutHistoryRecovery.server";
import { checkoutHistoryRecoveryReference, parseCheckoutHistoryRecovery, parseCheckoutHistoryRecoveryRequest } from "./merchantCheckoutHistoryRecovery";
import { createCheckoutHistoryRecoveryController } from "./merchantCheckoutHistoryRecoveryClient";
import { checkoutClientStorageKey } from "./merchantCheckoutClient";
import { checkoutHistoryRecoveryTransport, checkoutHistoryPendingTransport } from "./merchantCheckoutHistoryTransport";

const origin = "https://local-recovery.synthetic.invalid";
async function fixture(kind: Parameters<typeof historyRecoveryFixture>[0] = "cart_points") {
  const x = await historyRecoveryFixture(kind), calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const session = { ...x.principal, servicePaused: false, user: { email_confirmed_at: "2026-11-24T00:00:00Z" } } as unknown as Awaited<ReturnType<CheckoutHistoryRecoveryDependencies["session"]>>;
  const deps: CheckoutHistoryRecoveryDependencies = { enabled: () => true, session: async () => session, call: async (name, args, signal) => {
    assert.ok(signal instanceof AbortSignal); calls.push({ name, args }); return { data: x.recovery, error: null };
  } };
  const req = (body: unknown = { siteId: x.siteId, nonce: x.nonce }, headers: Record<string, string> = {}, query = "") => new Request(origin + "/api/member-checkout/history/recover" + query,
    { method: "POST", headers: { origin, "content-type": "application/json", "x-checkout-account-scope": x.accountId, ...headers }, body: JSON.stringify(body) });
  return { ...x, calls, session, deps, req };
}

test("actual history HTTP derives four original operations from the retained nonce and current exact principal, with one read-only RPC", async () => {
  for (const kind of ["cart_points", "cart_on_site", "single_points", "single_on_site"] as const) {
    const x = await fixture(kind), response = await handleCheckoutHistoryRecovery(x.req(), x.deps);
    assert.equal(response.status, 200); assert.deepEqual(await response.json(), x.envelope);
    assert.deepEqual(x.calls, [{ name: "faolla_member_checkout_history_original_v1", args: { p_site_id: x.siteId, p_operation_key: x.identity.operationKey, p_principal_key: x.identity.principalKey } }]);
    assert.match(response.headers.get("cache-control")!, /private, no-store/); assert.match(response.headers.get("vary")!, /X-Checkout-Account-Scope/);
    assert.ok(!JSON.stringify(x.envelope).includes(x.nonce));
  }
});
test("request parser and reference accept only exact site/nonce coordinates; consistency fingerprints are scope-bound, not an authority", async () => {
  const x = await fixture();
  assert.deepEqual(parseCheckoutHistoryRecoveryRequest({ siteId: x.siteId, nonce: x.nonce.toUpperCase() }), { siteId: x.siteId, nonce: x.nonce });
  for (const key of ["accountId", "userId", "principalKey", "operationKey", "method", "amount", "acknowledged"]) assert.throws(() => parseCheckoutHistoryRecoveryRequest({ siteId: x.siteId, nonce: x.nonce, [key]: "untrusted" }));
  assert.notEqual(await checkoutHistoryRecoveryReference(x.siteId, "59999999", x.nonce), x.reference);
  assert.notEqual(await checkoutHistoryRecoveryReference("10909993", x.accountId, x.nonce), x.reference);
});
test("malformed bodies, wrong verb/origin/account hint/token and query authority cannot access identity or ledger", async () => {
  const x = await fixture(); let auth = 0;
  for (const [request, status] of [[new Request(origin), 405], [x.req(undefined, { origin: "https://other.invalid" }), 403], [x.req(undefined, { "x-merchant-access-token": "private" }), 401],
    [x.req(undefined, { "x-checkout-account-scope": "" }), 401], [x.req(undefined, {}, "?nonce=other"), 400], [x.req({ siteId: x.siteId, nonce: "bad" }), 400],
    [x.req({ siteId: x.siteId, nonce: x.nonce, accountId: "59999999" }), 400], [x.req({ siteId: x.siteId, nonce: x.nonce, extra: "x".repeat(1100) }), 400],
    [new Request(x.req(), { body: "{" }), 400], [new Request(x.req(), { body: new Uint8Array([123, 255, 125]) }), 400], [x.req(undefined, { "content-type": "text/plain" }), 400]] as const)
    assert.equal((await handleCheckoutHistoryRecovery(request, { ...x.deps, session: async () => { auth++; return x.session; } })).status, status);
  assert.equal(auth, 0); assert.equal(x.calls.length, 0);
});
test("history is independently default-closed and rejects unverified, paused and other accounts before lookup", async () => {
  const x = await fixture(); let auth = 0;
  assert.equal((await handleCheckoutHistoryRecovery(x.req(), { ...x.deps, enabled: () => false, session: async () => { auth++; return x.session; } })).status, 503); assert.equal(auth, 0);
  for (const session of [null, { ...x.session!, servicePaused: true }, { ...x.session!, accountId: "59999999" }, { ...x.session!, user: { email_confirmed_at: "" } }])
    assert.equal((await handleCheckoutHistoryRecovery(x.req(), { ...x.deps, session: async () => session as typeof x.session })).status, 401);
  assert.equal(x.calls.length, 0);
});
test("lost identity (including same account/new userId) or history scope after the read suppresses every original", async () => {
  for (const mode of ["identity", "user", "scope"]) {
    const x = await fixture(); let called = false;
    const response = await handleCheckoutHistoryRecovery(x.req(), { ...x.deps, enabled: () => !called || mode !== "scope",
      session: async () => called && mode === "identity" ? null : called && mode === "user" ? { ...x.session!, userId: "other-synthetic-user" } : x.session,
      call: async (...args) => { called = true; return x.deps.call(...args); } });
    assert.equal(response.status, mode === "scope" ? 503 : 401); assert.ok(!(await response.text()).includes(x.identity.operationKey));
  }
});
test("explicit absence remains unconfirmed; SQL null, missing ACL, transport loss, malformed/wrong-scope facts never fall back or become absence", async () => {
  const x = await fixture(), absent = { version: 1, siteId: x.siteId, operationKey: x.identity.operationKey, original: null, reviewRequired: null };
  const response = await handleCheckoutHistoryRecovery(x.req(), { ...x.deps, call: async () => ({ data: absent, error: null }) });
  assert.equal(response.status, 200); assert.deepEqual((await response.json()).recovery, absent);
  for (const value of [{ data: null, error: null }, { data: absent, error: { message: "PRIVATE denied" } }, { data: {}, error: null },
    { data: { ...x.recovery, operationKey: "f".repeat(64) }, error: null }, { data: { ...x.recovery, siteId: "00000000" }, error: null }]) {
    let calls = 0; const reply = await handleCheckoutHistoryRecovery(x.req(), { ...x.deps, call: async () => { calls++; return value; } });
    assert.equal(reply.status, 503); assert.equal(calls, 1); assert.deepEqual(await reply.json(), { error: "checkout_history_unavailable" });
  }
  assert.equal((await handleCheckoutHistoryRecovery(x.req(), { ...x.deps, call: async () => { throw Error("PRIVATE SQL"); } })).status, 503);
});
test("safe recovery DTO strips private fields and cannot conceal a missing or inconsistent original behind reviewRequired=false", async () => {
  const x = await fixture(), original = x.recovery.original!;
  assert.ok(!JSON.stringify(parseCheckoutHistoryRecovery({ ...x.recovery, nonce: "PRIVATE", principal: "PRIVATE", original: { ...original, private: "PRIVATE" } }, x.identity)).includes("PRIVATE"));
  assert.throws(() => parseCheckoutHistoryRecovery({ ...x.recovery, original: null }, x.identity));
  if (original.kind !== "cart") assert.fail("fixture");
  const invalid = { ...x.recovery, original: { kind: "cart", result: { ...original.result, resource: null, reviewRequired: true, cancellationAvailable: false } } };
  assert.throws(() => parseCheckoutHistoryRecovery(invalid, x.identity));
  assert.equal(parseCheckoutHistoryRecovery({ ...invalid, reviewRequired: true }, x.identity).reviewRequired, true);
});
test("aborted stalled body and uncooperative identity/SQL are bounded, with no late dispatch or raw errors", async () => {
  const x = await fixture();
  for (const stage of ["body", "identity", "sql"]) {
    const abort = new AbortController(); let started!: () => void, release!: (value: unknown) => void, calls = 0;
    const began = new Promise<void>(r => { started = r; }), held = new Promise<unknown>(r => { release = r; });
    const request = new Request(x.req(), { signal: abort.signal, ...(stage === "body" ? { body: new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode("{")); started(); } }), duplex: "half" } : {}) } as RequestInit);
    const pending = handleCheckoutHistoryRecovery(request, { ...x.deps, session: async () => { if (stage === "identity") { started(); return await held as typeof x.session; } return x.session; },
      call: async () => { calls++; started(); return await held as Awaited<ReturnType<typeof x.deps.call>>; } });
    await began; abort.abort(); assert.equal((await pending).status, 503); assert.equal(calls, stage === "sql" ? 1 : 0);
    release(stage === "identity" ? x.session : { data: x.recovery, error: null }); await new Promise(r => setImmediate(r)); assert.equal(calls, stage === "sql" ? 1 : 0);
  }
});
test("wall-clock budget covers the complete read and prevents an identity result from authorizing a late lookup", async t => {
  const x = await fixture(), now = Date.now(); let expired = false;
  const clock = t.mock.method(Date, "now", () => now + (expired ? 12_001 : 0));
  try { const response = await handleCheckoutHistoryRecovery(x.req(), { ...x.deps, session: async () => { expired = true; return x.session; } }); assert.equal(response.status, 503); assert.equal(x.calls.length, 0); }
  finally { clock.mock.restore(); }
});

function local(x: Awaited<ReturnType<typeof fixture>>) {
  const key = checkoutClientStorageKey(x.siteId, x.accountId); let value: string | null = JSON.stringify({ version: 1, nonce: x.nonce }); const keys: string[] = [];
  const storage = { getItem(k: string) { keys.push(k); assert.equal(k, key); return value; } };
  return { key, storage, keys, value: () => value, change: (next: string | null) => { value = next; } };
}
test("local recovery has only getItem/read methods, retains exact bytes on confirmed/unknown/error and performs actual HTTP without finance", async () => {
  const x = await fixture(), s = local(x), before = s.value(); let mode = "confirmed"; const paths: string[] = [];
  const c = createCheckoutHistoryRecoveryController({ ...x, storage: s.storage, request: async (path, body, signal) => {
    paths.push(path); const response = await handleCheckoutHistoryRecovery(new Request(x.req(body), { signal }), { ...x.deps, call: async () => {
      if (mode === "error") throw Error("PRIVATE"); return { data: mode === "confirmed" ? x.recovery : { version: 1, siteId: x.siteId, operationKey: x.identity.operationKey, original: null, reviewRequired: null }, error: null };
    } }); const raw = await response.json(); if (!response.ok) throw Error("unavailable"); return raw;
  } });
  await c.activate(); assert.equal(c.getSnapshot().phase, "confirmed"); assert.deepEqual(Object.keys(c).sort(), ["activate", "deactivate", "getSnapshot", "recover", "subscribe"]);
  mode = "unknown"; await c.recover(); assert.equal(c.getSnapshot().phase, "unconfirmed"); mode = "error"; await c.recover(); assert.equal(c.getSnapshot().phase, "error");
  assert.equal(c.getSnapshot().recovery, null); c.deactivate(); assert.equal(s.value(), before); assert.ok(paths.every(p => p === "/api/member-checkout/history/recover"));
});
test("empty/malformed local storage cannot create or discard a reference or read another account/shared draft", async () => {
  const x = await fixture(), s = local(x); let calls = 0;
  for (const raw of [null, "", "{", JSON.stringify({ version: 1, nonce: "bad" }), JSON.stringify({ version: 1, nonce: x.nonce, memberId: "private" }), "x".repeat(257)]) {
    s.change(raw); const c = createCheckoutHistoryRecoveryController({ ...x, storage: s.storage, request: async () => { calls++; return x.envelope; } });
    await c.activate(); assert.equal(c.getSnapshot().phase, raw === null ? "empty" : "error"); assert.equal(s.value(), raw); c.deactivate();
  }assert.equal(calls, 0); assert.ok(s.keys.every(k => k === s.key));
});
test("another tab replacing/removing a captured reference invalidates the display and cannot silently adopt the replacement", async () => {
  for (const next of [null, JSON.stringify({ version: 1, nonce: "44444444-4444-4444-8444-444444444444" })]) {
    const x = await fixture(), s = local(x); let calls = 0;
    const c = createCheckoutHistoryRecoveryController({ ...x, storage: s.storage, request: async () => { calls++; return x.envelope; } });
    await c.activate(); s.change(next); await c.recover(); assert.equal(c.getSnapshot().phase, "error"); assert.equal(c.getSnapshot().recovery, null); assert.equal(calls, 1); assert.equal(s.value(), next); c.deactivate();
  }
});
test("mismatched request fingerprint/read-only metadata/site, late scope changes and ignored abort never expose stale facts", async () => {
  const x = await fixture();
  for (const change of [{ reference: "f".repeat(64) }, { readOnly: false }, { recovery: { ...x.recovery, siteId: "00000000" } }]) {
    const s = local(x), c = createCheckoutHistoryRecoveryController({ ...x, storage: s.storage, request: async () => ({ ...x.envelope, ...change }) });
    await c.activate(); assert.equal(c.getSnapshot().phase, "error"); assert.equal(c.getSnapshot().recovery, null); c.deactivate();
  }
  const s = local(x); let release!: (v: unknown) => void, started!: () => void, calls = 0;
  const began = new Promise<void>(r => { started = r; });
  const c = createCheckoutHistoryRecoveryController({ ...x, storage: s.storage, request: async () => { calls++; started(); return new Promise(r => { release = r; }); } });
  const pending = c.activate(); await began; await c.recover(); assert.equal(calls, 1); c.deactivate(); await pending; release(x.envelope); await new Promise(r => setImmediate(r)); assert.equal(c.getSnapshot().recovery, null);
});
test("client timeouts settle even if the transport ignores abort, retaining the original local bytes", async t => {
  const x = await fixture(), s = local(x), timeout = AbortSignal.timeout.bind(AbortSignal), keepAlive = setTimeout(() => {}, 1000);
  t.mock.method(AbortSignal, "timeout", () => timeout(15)); const c = createCheckoutHistoryRecoveryController({ ...x, storage: s.storage, request: async () => new Promise(() => {}) });
  const before = s.value(); try { await c.activate(); assert.equal(c.getSnapshot().phase, "error"); assert.equal(s.value(), before); } finally { clearTimeout(keepAlive); c.deactivate(); }
});
test("a late client response past the wall-clock budget becomes an error, never a stuck loading or confirmed original", async t => {
  const x = await fixture(), s = local(x), now = Date.now(); let expired = false;
  const clock = t.mock.method(Date, "now", () => now + (expired ? 12_001 : 0));
  const c = createCheckoutHistoryRecoveryController({ ...x, storage: s.storage, request: async () => { expired = true; return x.envelope; } });
  const before = s.value(); try { await c.activate(); assert.equal(c.getSnapshot().phase, "error"); assert.equal(c.getSnapshot().recovery, null); assert.equal(s.value(), before); }
  finally { c.deactivate(); clock.mock.restore(); }
});
test("production recovery transport is exact-path same-origin private POST; pending transport gains no recover/write route", async t => {
  const x = await fixture(), s = local(x), calls: Array<{ path: string; init: RequestInit }> = [];
  t.mock.method(globalThis, "fetch", async (path: string, init: RequestInit) => { calls.push({ path, init }); return Response.json(x.envelope); });
  const c = createCheckoutHistoryRecoveryController({ ...x, storage: s.storage }); await c.activate(); assert.equal(c.getSnapshot().phase, "confirmed");
  assert.equal(calls[0].path, "/api/member-checkout/history/recover"); assert.equal(calls[0].init.credentials, "same-origin"); assert.equal(calls[0].init.cache, "no-store"); assert.equal(calls[0].init.method, "POST");
  assert.equal(new Headers(calls[0].init.headers).get("x-checkout-account-scope"), x.accountId); assert.deepEqual(JSON.parse(calls[0].init.body as string), { siteId: x.siteId, nonce: x.nonce });
  for (const path of ["/api/member-checkout/intent/acknowledge", "/api/member-checkout/cart/submit", "/api/member-checkout/history/pending", "https://foreign.invalid"]) await assert.rejects(checkoutHistoryRecoveryTransport(x.accountId)(path, {}, new AbortController().signal));
  await assert.rejects(checkoutHistoryPendingTransport(x.accountId)("/api/member-checkout/history/recover", {}, new AbortController().signal)); assert.equal(calls.length, 1); c.deactivate();
});
