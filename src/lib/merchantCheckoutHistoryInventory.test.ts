import assert from "node:assert/strict";
import test from "node:test";
import { checkoutResumeFixture } from "../../scripts/fixtures/member-checkout-resume";
import { parseCheckoutHistoryInventory, parseCheckoutHistoryInventoryRequest } from "./merchantCheckoutHistoryInventory";
import { handleCheckoutHistoryInventory, type CheckoutHistoryInventoryDependencies } from "./merchantCheckoutHistoryInventory.server";
import { createCheckoutHistoryInventoryController, checkoutHistoryInventoryTransport } from "./merchantCheckoutHistoryInventoryClient";
import { checkoutHistoryPendingTransport } from "./merchantCheckoutHistoryTransport";

const origin = "https://inventory.synthetic.invalid", op = (n: number) => n.toString(16).padStart(64, "0");
async function fixture(kind: Parameters<typeof checkoutResumeFixture>[0] = "cart_points") {
  const f = await checkoutResumeFixture(kind), original = structuredClone(f.original);
  const r = original.kind === "cart" ? original.result : original.original.result; r.operationKey = op(1);
  const item = { operationKey: r.operationKey, original, reviewRequired: false };
  let data: unknown = { version: 1, siteId: f.siteId, after: null, items: [item], nextCursor: null };
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const session = { accountId: f.accountId, userId: f.userId, servicePaused: false, user: { email_confirmed_at: "2026-11-24T12:00:00Z" } } as unknown as Awaited<ReturnType<CheckoutHistoryInventoryDependencies["session"]>>;
  const deps: CheckoutHistoryInventoryDependencies = { enabled: () => true, session: async () => session, call: async (name, args, signal) => {
    assert.ok(signal instanceof AbortSignal); calls.push({ name, args }); return { data, error: null };
  } };
  const req = (body: unknown = { siteId: f.siteId, after: null }, headers: Record<string, string> = {}, query = "") => new Request(`${origin}/api/member-checkout/history/retained${query}`, {
    method: "POST", headers: { origin, "content-type": "application/json", "x-checkout-account-scope": f.accountId, ...headers }, body: JSON.stringify(body),
  });
  return { ...f, item, session, deps, req, calls, setData: (v: unknown) => { data = v; }, getData: () => structuredClone(data) as Record<string, unknown> };
}
test("inventory strictly validates cursor, ordering, bounded pages, exact original and safe DTO", async () => {
  const x = await fixture(); const scope = { siteId: x.siteId, after: null };
  assert.deepEqual(parseCheckoutHistoryInventoryRequest(scope), scope);
  assert.equal(parseCheckoutHistoryInventory(x.getData(), scope).items[0].original.kind, "cart");
  for (const bad of [{ siteId: x.siteId }, { ...scope, nonce: op(1) }, { ...scope, after: "BAD" }, { ...scope, principalKey: "other" }, { ...scope, siteId: "bad" }]) assert.throws(() => parseCheckoutHistoryInventoryRequest(bad));
  const items = Array.from({ length: 10 }, (_, n) => { const v = structuredClone(x.item); v.operationKey = op(n + 1); if (v.original.kind === "cart") v.original.result.operationKey = v.operationKey; return v; });
  const complete = { ...x.getData(), items, nextCursor: op(10) }; assert.equal(parseCheckoutHistoryInventory(complete, scope).nextCursor, op(10));
  for (const bad of [{ ...complete, nextCursor: op(9) }, { ...complete, items: [...items, items[9]] }, { ...complete, items: [items[0], items[0]], nextCursor: null },
    { ...complete, items: [...items].reverse() }, { ...complete, after: op(1) }, { ...complete, siteId: "00000000" }, { ...complete, nonce: "private" },
    { ...x.getData(), items: [{ ...x.item, generation: 1 }] }, { ...x.getData(), items: [{ ...x.item, original: null, reviewRequired: null }] },
    { ...x.getData(), items: [{ ...x.item, operationKey: op(2) }] }, { ...x.getData(), nextCursor: op(1) }]) assert.throws(() => parseCheckoutHistoryInventory(bad, scope));
  const unsafe = structuredClone(x.item); if (unsafe.original.kind === "cart") { unsafe.original.result.resource = null; unsafe.original.result.reviewRequired = true; unsafe.original.result.cancellationAvailable = false; }
  assert.throws(() => parseCheckoutHistoryInventory({ ...x.getData(), items: [unsafe] }, scope));
  assert.equal(parseCheckoutHistoryInventory({ ...x.getData(), items: [{ ...unsafe, reviewRequired: true }] }, scope).items[0].reviewRequired, true);
});
test("actual inventory HTTP reads four original kinds with exact verified dual principal and no purchase authority", async () => {
  for (const kind of ["cart_points", "cart_on_site", "single_points", "single_on_site"] as const) {
    const x = await fixture(kind), response = await handleCheckoutHistoryInventory(x.req(), x.deps), body = await response.json();
    assert.equal(response.status, 200); assert.equal(body.readOnly, true); assert.deepEqual(Object.keys(body).sort(), ["inventory", "ok", "readOnly"]);
    assert.equal(body.inventory.items.length, 1); assert.equal(body.inventory.items[0].original.kind, x.original.kind);
    assert.deepEqual(parseCheckoutHistoryInventory(body.inventory, { siteId: x.siteId, after: null }), body.inventory);
    assert.deepEqual(x.calls, [{ name: "faolla_member_checkout_history_inventory_v1", args: { p_site_id: x.siteId, p_principal_key: `account:${x.accountId}:${x.userId}`, p_after: null } }]);
    assert.match(response.headers.get("cache-control")!, /private, no-store/); assert.match(response.headers.get("vary")!, /X-Checkout-Account-Scope/);
    assert.equal(body.inventory.items[0].generation, undefined); assert.equal(body.inventory.items[0].reviewHash, undefined);
  }
});
test("closed gate and malformed methods/origin/body/cursor perform no private reads", async () => {
  const x = await fixture(); let auth = 0;
  assert.equal((await handleCheckoutHistoryInventory(x.req(), { ...x.deps, enabled: () => false, session: async () => { auth++; return x.session; } })).status, 503); assert.equal(auth, 0);
  for (const [request, status] of [[new Request(origin), 405], [x.req(undefined, { origin: "https://other.invalid" }), 403], [x.req(undefined, { "x-merchant-access-token": "private" }), 401],
    [x.req(undefined, { "x-checkout-account-scope": "" }), 401], [x.req(undefined, {}, "?after=x"), 400], [x.req({ siteId: x.siteId, after: op(1), limit: 100 }), 400],
    [x.req({ siteId: x.siteId, after: "x" }), 400], [x.req({ siteId: x.siteId, after: null, extra: "x".repeat(1024) }), 400],
    [x.req(undefined, { "content-type": "text/plain" }), 400], [new Request(x.req(), { body: new Uint8Array([123, 255, 125]) }), 400]] as const) assert.equal((await handleCheckoutHistoryInventory(request, x.deps)).status, status);
  assert.equal(x.calls.length, 0);
});
test("unverified, paused, changed account/user, revoked scope and malformed private results never become an empty page", async () => {
  const x = await fixture();
  for (const session of [null, { ...x.session!, servicePaused: true }, { ...x.session!, accountId: "59999999" }, { ...x.session!, user: { email_confirmed_at: "" } }])
    assert.equal((await handleCheckoutHistoryInventory(x.req(), { ...x.deps, session: async () => session as typeof x.session })).status, 401);
  assert.equal(x.calls.length, 0);
  for (const mode of ["user", "account", "scope", "private", "missing", "cross", "throw"]) {
    let sent = false;
    const response = await handleCheckoutHistoryInventory(x.req(), { ...x.deps, enabled: () => !sent || mode !== "scope",
      session: async () => sent && ["user", "account"].includes(mode) ? { ...x.session!, ...(mode === "user" ? { userId: "changed-synthetic-user" } : { accountId: "59999999" }) } as typeof x.session : x.session,
      call: async () => { sent = true; if (mode === "throw") throw Error("PRIVATE"); return { data: mode === "missing" ? {} : mode === "cross" ? { ...x.getData(), siteId: "00000000" } : x.getData(), error: mode === "private" ? { message: "PRIVATE" } : null }; },
    });
    assert.ok([401, 503].includes(response.status)); assert.equal((await response.json()).inventory, undefined);
  }
});
test("one whole deadline bounds body/auth/RPC and hides expired reads without late IO", async t => {
  const x = await fixture(), timeout = AbortSignal.timeout.bind(AbortSignal); t.mock.method(AbortSignal, "timeout", () => timeout(10));
  const timer = setTimeout(() => {}, 1000);
  try { for (const stage of ["body", "auth", "sql"]) {
    let release!: (v: unknown) => void, reads = 0; const held = new Promise<unknown>(r => { release = r; });
    const request = stage === "body" ? new Request(x.req(), { body: new ReadableStream({ start() {} }), duplex: "half" } as RequestInit) : x.req();
    const response = await handleCheckoutHistoryInventory(request, { ...x.deps, session: async () => stage === "auth" ? await held as typeof x.session : x.session,
      call: async () => { reads++; return stage === "sql" ? await held as { data: unknown; error: unknown } : { data: x.getData(), error: null }; } });
    assert.equal(response.status, 503); assert.equal(reads, stage === "sql" ? 1 : 0); release(stage === "auth" ? x.session : { data: x.getData(), error: null });
    await new Promise(r => setImmediate(r)); assert.equal(reads, stage === "sql" ? 1 : 0);
  } } finally { clearTimeout(timer); }
});
test("explicit controller reads/next pages only, cannot clear storage or call old transport paths", async () => {
  const x = await fixture(), sent: Array<{ siteId: string; after: string | null }> = [];
  const rows = Array.from({ length: 10 }, (_, n) => { const item = structuredClone(x.item); item.operationKey = op(n + 1); if (item.original.kind === "cart") item.original.result.operationKey = item.operationKey; return item; });
  const c = createCheckoutHistoryInventoryController({ ...x, request: async (path, body) => {
    assert.equal(path, "/api/member-checkout/history/retained"); const scope = body as { siteId: string; after: string | null }; sent.push(scope);
    return { ok: true, readOnly: true, inventory: { version: 1, ...scope, items: scope.after ? [] : rows, nextCursor: scope.after ? null : op(10) } };
  } });
  c.activate(); assert.equal(sent.length, 0); await c.next(); assert.equal(sent.length, 0); await Promise.all([c.read(), c.read()]);
  assert.equal(sent.length, 1); assert.equal(c.getSnapshot().inventory!.items.length, 10); await c.next();
  assert.deepEqual(sent, [{ siteId: x.siteId, after: null }, { siteId: x.siteId, after: op(10) }]); assert.equal(c.getSnapshot().phase, "ready");
  assert.deepEqual(Object.keys(c).sort(), ["activate", "deactivate", "getSnapshot", "next", "read", "subscribe"]);
  c.deactivate(); await c.read(); assert.equal(sent.length, 2);
  for (const p of ["/api/member-checkout/intent/acknowledge", "/api/member-checkout/intent/register-retained", "/api/member-checkout/cart/submit", "/api/member-checkout/history/pending"])
    await assert.rejects(checkoutHistoryInventoryTransport(x.accountId)(p, {}, new AbortController().signal));
  await assert.rejects(checkoutHistoryPendingTransport(x.accountId)("/api/member-checkout/history/retained", {}, new AbortController().signal));
});
test("client hides malformed, stale, late and timed-out pages and never automatically retries", async t => {
  const x = await fixture();
  for (const response of [{ ok: true, inventory: x.getData() }, { ok: true, readOnly: true, inventory: { ...x.getData(), after: op(1) } }]) {
    let calls = 0; const c = createCheckoutHistoryInventoryController({ ...x, request: async () => { calls++; return response; } }); c.activate(); await c.read(); assert.equal(c.getSnapshot().phase, "error"); assert.equal(c.getSnapshot().inventory, null); assert.equal(calls, 1); c.deactivate();
  }
  const timeout = AbortSignal.timeout.bind(AbortSignal); t.mock.method(AbortSignal, "timeout", () => timeout(10)); const timer = setTimeout(() => {}, 1000);
  try { for (const mode of ["late", "timeout"]) {
    let release!: (v: unknown) => void, calls = 0; const held = new Promise<unknown>(r => { release = r; });
    const c = createCheckoutHistoryInventoryController({ ...x, request: async () => { calls++; return held; } }); c.activate(); const reading = c.read();
    await new Promise(r => setImmediate(r)); if (mode === "late") c.deactivate(); await reading;
    assert.equal(c.getSnapshot().inventory, null); assert.equal(c.getSnapshot().phase, mode === "late" ? "idle" : "error");
    release({ ok: true, readOnly: true, inventory: x.getData() }); await new Promise(r => setImmediate(r)); assert.equal(c.getSnapshot().inventory, null); assert.equal(calls, 1); c.deactivate();
  } } finally { clearTimeout(timer); }
});
