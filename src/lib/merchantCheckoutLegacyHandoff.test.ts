import assert from "node:assert/strict";
import test from "node:test";
import { createAccountCartDraft } from "./merchantCheckoutAccountDraft";
import { createLegacyCartHandoff, legacyHandoffStorageKey, legacyHandoffTransport } from "./merchantCheckoutLegacyHandoff";
import { handleCheckoutLegacyHandoffReview } from "./merchantCheckoutLegacyHandoff.server";
import { isMemberCheckoutLegacyHandoffEnabled } from "./merchantCheckoutLegacyHandoffPilot.server";
import { checkoutClientStorageKey } from "./merchantCheckoutClient";
import type { LegacyReviewDependencies } from "./merchantCheckoutLegacyReview.server";
import { withCheckoutDraftLease, type CheckoutDraftLease } from "./merchantCheckoutDraftLease";
test("root gap: old reference review alone cannot provide an explicit isolated-account handoff", async () => {
  const values = new Map<string, string>(), writes: string[] = [], scope = { siteId: "10909994", blockId: "products", accountId: "58000001" };
  const c = createAccountCartDraft(scope, { storage: { getItem: k => values.get(k) ?? null, setItem: (k, v) => { writes.push(k); values.set(k, v); } }, exclusive: async (_k, run) => { await run(); return true; } });
  const raw = JSON.stringify({ clientRequestId: "old-request", customer: { name: "unowned" }, items: [] }); values.set(c.legacyKey, raw); await c.activate();
  assert.equal(c.getSnapshot().legacyPending, true); assert.equal(values.get(c.legacyKey), raw); assert.deepEqual(writes, []);
  assert.equal(typeof (c as unknown as { confirmLegacyHandoff?: unknown }).confirmLegacyHandoff, "function", "there is no separately gated, explicit handoff command yet");
});

const scope = { siteId: "10909994", blockId: "products", accountId: "58000001" }, q = { siteId: scope.siteId, blockId: scope.blockId, requestId: "old-request" };
const order = { id: "O-synthetic-old", status: "pending", createdAt: "2026-11-24T10:00:00.000Z", updatedAt: "2026-11-24T10:00:00.000Z" }, review = { version: 1 as const, ...q, order: { ...order, status: "pending" as const } };
async function fixture() {
  const values = new Map<string, string>(), writes: string[] = [], calls: string[] = []; let held = false;
  const storage = { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { writes.push(k); values.set(k, v); } };
  const exclusive = async (_k: string, run: () => Promise<void>) => { if (held) return false; held = true; try { await run(); return true; } finally { held = false; } };
  const session = { accountId: scope.accountId, userId: "handoff-synthetic-user", servicePaused: false, user: { email_confirmed_at: "2026-11-24T00:00:00Z" } } as unknown as NonNullable<Awaited<ReturnType<LegacyReviewDependencies["session"]>>>;
  let data: unknown = review, enabled = true;
  const req = (body: unknown = q) => new Request("https://handoff.synthetic.invalid/api/member-checkout/legacy/handoff-review", { method: "POST", headers: { origin: "https://handoff.synthetic.invalid", "content-type": "application/json", "x-checkout-account-scope": scope.accountId }, body: JSON.stringify(body) });
  const request = async (path: string, body: unknown, signal: AbortSignal) => { calls.push(path); assert.equal(path, "/api/member-checkout/legacy/handoff-review"); assert.deepEqual(body, q);
    const response = await handleCheckoutLegacyHandoffReview(new Request(req(body), { signal }), { enabled: () => enabled, session: async () => session, call: async (name, args) => { assert.equal(name, "faolla_member_checkout_legacy_review_v1"); assert.equal(args.p_principal_key, `account:${scope.accountId}:${session.userId}`); return { data, error: null }; } });
    if (!response.ok) throw Error("unavailable"); return response.json(); };
  const initial = createAccountCartDraft(scope, { storage, exclusive }); await initial.activate(); await initial.edit(d => ({ ...d, customer: { name: "Owned name", phone: "123", email: "owned@synthetic.invalid", note: "Owned note" } }));
  const legacy = JSON.stringify({ clientRequestId: q.requestId, customer: { name: "PRIVATE unowned", email: "private@synthetic.invalid" }, items: [{ productId: "PRIVATE", quantity: 99 }] }); values.set(initial.legacyKey, legacy); initial.deactivate(); writes.length = 0;
  const handoff = createLegacyCartHandoff(scope, { storage, request }), create = () => createAccountCartDraft(scope, { storage, exclusive, legacyHandoff: handoff }), c = create();
  await c.activate();
  return { values, writes, calls, storage, exclusive, handoff, c, create, legacy, session, req, request, key: legacyHandoffStorageKey(scope), nonceKey: checkoutClientStorageKey(scope.siteId, scope.accountId),
    data: (v: unknown) => { data = v; }, revoke: () => { enabled = false; } };
}
test("handoff is a separately strict default-closed scope; history/review grants alone are insufficient", () => {
  const env = { MERCHANT_MEMBER_CHECKOUT_HISTORY_READ_SITES: scope.siteId, MERCHANT_MEMBER_CHECKOUT_LEGACY_REVIEW_SITES: scope.siteId, MERCHANT_MEMBER_CHECKOUT_LEGACY_HANDOFF_SITES: scope.siteId };
  assert.equal(isMemberCheckoutLegacyHandoffEnabled(scope.siteId, env), true);
  for (const name of Object.keys(env)) for (const value of ["", "*", "other", scope.siteId + ",invalid"]) assert.equal(isMemberCheckoutLegacyHandoffEnabled(scope.siteId, { ...env, [name]: value }), false);
  assert.equal(isMemberCheckoutLegacyHandoffEnabled(scope.siteId, {}), false);
});
test("without a marker activation is read-only and never auto-reviews or silently acknowledges a local shared draft", async () => {
  const x = await fixture(); assert.equal(x.c.getSnapshot().legacyPending, true); assert.equal(x.calls.length, 0); assert.deepEqual(x.writes, []);
  await assert.rejects(x.c.confirmLegacyHandoff(review, false), /confirmation_required/); assert.equal(x.calls.length, 0); assert.deepEqual(x.writes, []); assert.equal(x.values.get(x.c.legacyKey), x.legacy);
});
test("explicit confirmation rechecks actual HTTP and writes ONLY the scoped decision, retaining owned cart, shared cart and nonce absence", async () => {
  const x = await fixture(), before = new Map(x.values), data = x.c.getSnapshot().data, raw = x.c.getSnapshot().raw;
  await x.c.confirmLegacyHandoff(review, true); assert.equal(x.c.getSnapshot().legacyPending, false); assert.deepEqual(x.c.getSnapshot().data, data); assert.equal(x.c.getSnapshot().raw, raw); assert.deepEqual(x.calls, ["/api/member-checkout/legacy/handoff-review"]); assert.deepEqual(x.writes, [x.key]);
  for (const [k, v] of before) assert.equal(x.values.get(k), v); assert.equal(x.values.get(x.nonceKey), undefined);
  const marker = JSON.parse(x.values.get(x.key)!); assert.deepEqual(Object.keys(marker).sort(), ["confirmedAt", "legacyHash", "review", "scope", "version"]); assert.match(marker.legacyHash, /^[a-f0-9]{64}$/); assert.equal(JSON.stringify(marker).includes("PRIVATE"), false); assert.equal(JSON.stringify(marker).includes("Owned name"), false);
  await x.c.edit(d => ({ ...d, customer: { ...d.customer, note: "New own note" } })); assert.equal(x.c.getSnapshot().data.customer.name, "Owned name"); assert.equal(x.c.getSnapshot().data.customer.note, "New own note"); assert.equal(x.values.get(x.c.legacyKey), x.legacy); assert.equal(x.values.get(x.key), JSON.stringify(marker));
});

test("all four ordinary business states can be explicitly reviewed without cancellation, financial completion or payment assertions", async () => {
  for (const status of ["pending", "confirmed", "completed", "cancelled"] as const) {
    const x = await fixture(), expected = { ...review, order: { ...review.order, status } }; x.data(expected); const before = new Map(x.values);
    await x.c.confirmLegacyHandoff(expected, true); assert.equal(x.c.getSnapshot().legacyPending, false); for (const [k, v] of before) assert.equal(x.values.get(k), v);
    assert.deepEqual(JSON.parse(x.values.get(x.key)!).review, expected); assert.equal(x.values.get(x.nonceKey), undefined); assert.deepEqual(x.writes, [x.key]);
  }
});
test("reopening revalidates a saved decision with the server; it is neither a payment token nor automatic import", async () => {
  const x = await fixture(); await x.c.confirmLegacyHandoff(review, true); const before = new Map(x.values), writes = [...x.writes]; x.c.deactivate(); const c = x.create(); await c.activate();
  assert.equal(c.getSnapshot().legacyPending, false); assert.equal(c.getSnapshot().data.customer.name, "Owned name"); assert.equal(x.calls.length, 2); assert.deepEqual(x.values, before); assert.deepEqual(x.writes, writes);
  x.data({ ...review, order: { ...review.order, status: "confirmed", updatedAt: "2026-11-24T10:01:00.000Z" } }); await c.refresh(); assert.equal(c.getSnapshot().ready, true); assert.equal(c.getSnapshot().legacyPending, true);
  await c.confirmLegacyHandoff({ ...review, order: { ...review.order, status: "confirmed", updatedAt: "2026-11-24T10:01:00.000Z" } }, true); assert.equal(c.getSnapshot().legacyPending, false); assert.equal(x.values.get(c.legacyKey), x.legacy);
});
test("different accounts/site/block cannot reuse a decision; wrong-scope injected controllers are refused", async () => {
  const x = await fixture(); await x.c.confirmLegacyHandoff(review, true); const before = new Map(x.values);
  for (const s of [{ ...scope, accountId: "58000002" }, { ...scope, siteId: "10909993" }, { ...scope, blockId: "other" }]) {
    assert.throws(() => createAccountCartDraft(s, { storage: x.storage, exclusive: x.exclusive, legacyHandoff: x.handoff }), /draft_invalid/);
    const h = createLegacyCartHandoff(s, { storage: x.storage, request: async () => { throw Error("must not read another scope"); } }), c = createAccountCartDraft(s, { storage: x.storage, exclusive: x.exclusive, legacyHandoff: h }); await c.activate(); assert.equal(c.getSnapshot().data.customer.name, ""); assert.equal(c.getSnapshot().legacyPending, s.accountId !== scope.accountId); c.deactivate();
  } assert.deepEqual(x.values, before);
});
test("financial nonce, lock contention and changed owner draft reject confirmation before any read or marker write", async () => {
  for (const mode of ["nonce", "lock", "owned"]) {
    const x = await fixture(); let release!: () => void, run: Promise<boolean> | undefined;
    if (mode === "nonce") x.values.set(x.nonceKey, "unknown-retained-finance");
    if (mode === "owned") x.values.set(x.c.storageKey, "changed-owned-draft");
    if (mode === "lock") { let begin!: () => void; const began = new Promise<void>(r => { begin = r; }); run = x.exclusive(x.c.lockKey, async () => { begin(); await new Promise<void>(r => { release = r; }); }); await began; }
    const before = new Map(x.values); try { await assert.rejects(x.c.confirmLegacyHandoff(review, true)); assert.equal(x.calls.length, 0); assert.deepEqual(x.writes, []); assert.deepEqual(x.values, before); } finally { release?.(); await run; }
  }
});
test("unknown/foreign/unsafe/changed order evidence and closed scope cannot acknowledge, import, clear or release anything", async () => {
  for (const value of [null, { ...review, order: null }, { ...review, blockId: "other" }, { ...review, order: { ...review.order, memberId: "PRIVATE" } }, { ...review, order: { ...review.order, status: "cancelled" } }, "off"]) {
    const x = await fixture(), before = new Map(x.values); if (value === "off") x.revoke(); else x.data(value);
    await assert.rejects(x.c.confirmLegacyHandoff(review, true)); assert.deepEqual(x.values, before); assert.deepEqual(x.writes, []); assert.equal(x.c.getSnapshot().legacyPending, true);
  }
});
test("deleting/changing a saved marker or shared bytes restores the barrier before any owned edit", async () => {
  for (const mode of ["delete", "marker", "legacy"]) {
    const x = await fixture(); await x.c.confirmLegacyHandoff(review, true); const writes = [...x.writes];
    if (mode === "delete") x.values.delete(x.key); else if (mode === "marker") x.values.set(x.key, "changed"); else x.values.set(x.c.legacyKey, x.legacy + " ");
    const before = new Map(x.values); await x.c.edit(d => ({ ...d, customer: { ...d.customer, name: "must not save" } })); assert.equal(x.c.getSnapshot().ready, false); assert.deepEqual(x.values, before); assert.deepEqual(x.writes, writes);
  }
});

test("final synchronous financial-draft verification still rejects a changed isolation decision under the original live lease", async () => {
  const x = await fixture(); await x.c.confirmLegacyHandoff(review, true); const raw = x.c.getSnapshot().raw, writes = [...x.writes];
  await withCheckoutDraftLease(x.c.lockKey, async lease => { assert.equal(x.c.verify(raw, lease), undefined); x.values.delete(x.key); const before = new Map(x.values); assert.throws(() => x.c.verify(raw, lease), /legacy_original_pending/); assert.deepEqual(x.values, before); }); assert.deepEqual(x.writes, writes);
});

test("a handoff helper cannot be used outside the correct live account lease, including read-only revalidation", async () => {
  const x = await fixture(), before = new Map(x.values); let expired!: CheckoutDraftLease;
  await withCheckoutDraftLease(x.c.lockKey, async lease => { expired = lease; });
  for (const lease of [undefined, { key: x.c.lockKey }, expired]) {
    await assert.rejects(x.handoff.confirm(x.legacy, review, true, () => {}, lease as CheckoutDraftLease), /lock_required/);
    await assert.rejects(x.handoff.prepare(x.legacy, () => {}, lease as CheckoutDraftLease), /lock_required/);
  }
  await withCheckoutDraftLease("other-account", async lease => { await assert.rejects(x.handoff.confirm(x.legacy, review, true, () => {}, lease), /lock_required/); });
  assert.equal(x.calls.length, 0); assert.deepEqual(x.values, before); assert.deepEqual(x.writes, []);
});

test("revoked or unavailable recheck on reopening cannot reuse even a previously valid local decision", async () => {
  for (const mode of ["off", "unknown", "unverified"]) {
    const x = await fixture(); await x.c.confirmLegacyHandoff(review, true); const before = new Map(x.values), writes = [...x.writes]; x.c.deactivate();
    if (mode === "off") x.revoke(); if (mode === "unknown") x.data({ ...review, order: null }); if (mode === "unverified") (x.session.user as { email_confirmed_at?: string }).email_confirmed_at = undefined;
    const c = x.create(); await c.activate(); assert.equal(c.getSnapshot().ready, false); assert.deepEqual(x.values, before); assert.deepEqual(x.writes, writes);
  }
});
test("changed shared bytes require another explicit confirmation, but valid old decisions are not overwritten automatically", async () => {
  const x = await fixture(); await x.c.confirmLegacyHandoff(review, true); const marker = x.values.get(x.key); x.values.set(x.c.legacyKey, x.legacy + " "); await x.c.refresh(); assert.equal(x.c.getSnapshot().legacyPending, true); assert.equal(x.values.get(x.key), marker);
  await x.c.confirmLegacyHandoff(review, true); assert.equal(x.c.getSnapshot().legacyPending, false); assert.notEqual(x.values.get(x.key), marker); assert.equal(x.values.get(x.c.legacyKey), x.legacy + " ");
});
test("corrupt/foreign/future marker data is neither authority nor permission to overwrite it", async () => {
  for (const mode of ["corrupt", "foreign", "extra", "oversize"]) {
    const x = await fixture(); await x.c.confirmLegacyHandoff(review, true); const parsed = JSON.parse(x.values.get(x.key)!);
    if (mode === "foreign") parsed.scope.accountId = "59999999"; if (mode === "extra") parsed.paid = true;
    x.values.set(x.key, mode === "corrupt" ? "{" : mode === "oversize" ? "x".repeat(4097) : JSON.stringify(parsed)); const before = new Map(x.values), writes = [...x.writes];
    await x.c.refresh(); assert.equal(x.c.getSnapshot().ready, false); await assert.rejects(x.c.confirmLegacyHandoff(review, true)); assert.deepEqual(x.values, before); assert.deepEqual(x.writes, writes);
  }
});
test("same-frame duplicate confirmation and a retained nonce appearing during a held read cannot write twice or release finance", async () => {
  const x = await fixture(); let release!: (v: unknown) => void, started!: () => void; const began = new Promise<void>(r => { started = r; });
  const h = createLegacyCartHandoff(scope, { storage: x.storage, request: async () => { started(); return new Promise(r => { release = r; }); } }), c = createAccountCartDraft(scope, { storage: x.storage, exclusive: x.exclusive, legacyHandoff: h }); await c.activate();
  const first = c.confirmLegacyHandoff(review, true); first.catch(() => {}); await began; await assert.rejects(c.confirmLegacyHandoff(review, true)); x.values.set(x.nonceKey, "financial-original"); const before = new Map(x.values); release({ ok: true, readOnly: true, review }); await assert.rejects(first); assert.deepEqual(x.values, before); assert.deepEqual(x.writes, []);
});
test("shared/owned/marker mutation or identity loss during a read prevents late marker persistence", async () => {
  for (const mode of ["shared", "owned", "marker", "identity"]) {
    const x = await fixture(); let release!: (v: unknown) => void, start!: () => void; const began = new Promise<void>(r => { start = r; });
    const h = createLegacyCartHandoff(scope, { storage: x.storage, request: async () => { start(); return new Promise(r => { release = r; }); } }), c = createAccountCartDraft(scope, { storage: x.storage, exclusive: x.exclusive, legacyHandoff: h }); await c.activate();
    const run = c.confirmLegacyHandoff(review, true); run.catch(() => {}); await began;
    if (mode === "shared") x.values.set(c.legacyKey, "changed"); if (mode === "owned") x.values.set(c.storageKey, "changed"); if (mode === "marker") x.values.set(x.key, "changed"); if (mode === "identity") c.deactivate();
    const before = new Map(x.values); release({ ok: true, readOnly: true, review }); await assert.rejects(run); assert.deepEqual(x.values, before); assert.deepEqual(x.writes, []);
  }
});
test("refused/discarded marker writes never report successful handoff, touch either cart or clear the financial reference", async () => {
  for (const mode of ["refuse", "discard"]) {
    const x = await fixture(), storage = { ...x.storage, setItem: (k: string) => { assert.equal(k, x.key); if (mode === "refuse") throw Error("denied"); } };
    const h = createLegacyCartHandoff(scope, { storage, request: x.request }), c = createAccountCartDraft(scope, { storage, exclusive: x.exclusive, legacyHandoff: h }); await c.activate(); const before = new Map(x.values);
    await assert.rejects(c.confirmLegacyHandoff(review, true)); assert.equal(c.getSnapshot().ready, false); assert.deepEqual(x.values, before); assert.deepEqual(x.writes, []);
  }
});
test("handoff timeout settles even when transport ignores abort, with zero writes", async t => {
  const x = await fixture(), timeout = AbortSignal.timeout.bind(AbortSignal), keep = setTimeout(() => {}, 1000); t.mock.method(AbortSignal, "timeout", () => timeout(10));
  const h = createLegacyCartHandoff(scope, { storage: x.storage, request: async () => new Promise(() => {}) }), c = createAccountCartDraft(scope, { storage: x.storage, exclusive: x.exclusive, legacyHandoff: h }); await c.activate(); const before = new Map(x.values);
  try { await assert.rejects(c.confirmLegacyHandoff(review, true)); assert.deepEqual(x.values, before); assert.deepEqual(x.writes, []); } finally { clearTimeout(keep); c.deactivate(); }
});

test("the whole handoff deadline covers hashing and a late read response before any marker can persist", async t => {
  const x = await fixture(), now = Date.now(); let expired = false, called = false; const clock = t.mock.method(Date, "now", () => now + (expired ? 12_001 : 0));
  const h = createLegacyCartHandoff(scope, { storage: x.storage, request: async () => { called = true; expired = true; return { ok: true, readOnly: true, review }; } }), c = createAccountCartDraft(scope, { storage: x.storage, exclusive: x.exclusive, legacyHandoff: h });
  try { await c.activate(); const before = new Map(x.values); await assert.rejects(c.confirmLegacyHandoff(review, true)); assert.equal(called, true); assert.deepEqual(x.values, before); assert.deepEqual(x.writes, []); } finally { clock.mock.restore(); c.deactivate(); }
});
test("handoff HTTP remains read-only, independently gated and session-derived; no browser confirmation/payment authority is accepted", async () => {
  const x = await fixture(); const denied = await handleCheckoutLegacyHandoffReview(x.req(), { enabled: () => false, session: async () => { throw Error("must not read"); } }); assert.equal(denied.status, 503);
  for (const extra of [{ confirmed: true }, { accountId: scope.accountId }, { legacyHash: "f".repeat(64) }, { paid: true }]) { const r = await handleCheckoutLegacyHandoffReview(x.req({ ...q, ...extra }), { enabled: () => true, session: async () => { throw Error("must not read"); } }); assert.equal(r.status, 400); }
});
test("handoff transport accepts only its private recheck route, never financial or ordinary writes", async t => {
  let calls = 0; t.mock.method(globalThis, "fetch", async (_path: string, init: RequestInit) => { calls++; assert.equal(init.credentials, "same-origin"); assert.equal(init.cache, "no-store"); assert.equal(init.method, "POST"); assert.equal(new Headers(init.headers).get("x-checkout-account-scope"), scope.accountId); return Response.json({ ok: true, readOnly: true, review }); });
  const send = legacyHandoffTransport(scope.accountId), signal = new AbortController().signal; await send("/api/member-checkout/legacy/handoff-review", q, signal);
  for (const path of ["/api/member-checkout/legacy/review", "/api/orders", "/api/member-checkout/intent/acknowledge", "/api/member-checkout/cart/submit", "https://foreign.invalid"]) await assert.rejects(send(path, {}, signal)); assert.equal(calls, 1);
});
