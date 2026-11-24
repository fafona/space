import assert from "node:assert/strict";
import test from "node:test";
import { accountCartStorageKey, createAccountCartDraft, parseAccountCartData } from "./merchantCheckoutAccountDraft";
import { assertCheckoutDraftLease, withCheckoutDraftLease, type CheckoutDraftLease } from "./merchantCheckoutDraftLease";
const scope = { siteId: "10909095", blockId: "products", accountId: "50010105" };
const item = { productId: "p1", quantity: 1, checked: true, product: { id: "p1", name: "Product", code: "P1", price: "10", description: "", imageUrl: "", thumbnailUrl: "", tag: "" }, unitPrice: 10, unitPriceText: "€10" };
function fixture() {
  const values = new Map<string, string>(), events: string[] = []; let held = false;
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { events.push(key); values.set(key, value); } };
  const exclusive = async (_key: string, run: () => Promise<void>) => { if (held) return false; held = true; try { await run(); return true; } finally { held = false; } };
  const create = (override = scope) => createAccountCartDraft(override, { storage, exclusive });
  return { values, events, storage, exclusive, create };
}
test("unknown shared v1 contact/products are preserved byte-for-byte and never imported", async () => {
  const x = fixture(), c = x.create(), raw = JSON.stringify({ items: [item], customer: { name: "Another user", email: "private@synthetic.invalid" }, clientRequestId: "" });
  x.values.set(c.legacyKey, raw); await c.activate(); assert.deepEqual(c.getSnapshot().data.items, []); assert.equal(c.getSnapshot().data.customer.name, "");
  assert.equal(c.getSnapshot().legacyPresent, true); assert.equal(c.getSnapshot().legacyPending, false); assert.equal(x.values.get(c.legacyKey), raw); assert.equal(x.events.length, 0);
});
test("owned drafts survive reopening and accounts/site/block never inherit each other's fields", async () => {
  const x = fixture(), a = x.create(); await a.activate(); await a.edit(d => ({ ...d, items: [item], customer: { name: "A", phone: "1", email: "a@synthetic.invalid", note: "note" } }));
  const raw = x.values.get(a.storageKey); a.deactivate(); assert.equal(a.getSnapshot().data.items.length, 0);
  for (const other of [{ ...scope, accountId: "50010106" }, { ...scope, siteId: "10909096" }, { ...scope, blockId: "other" }]) {
    const b = x.create(other); await b.activate(); assert.equal(b.getSnapshot().data.items.length, 0); assert.equal(b.getSnapshot().data.customer.email, ""); b.deactivate();
  }
  const reopened = x.create(); await reopened.activate(); assert.equal(reopened.getSnapshot().data.customer.name, "A"); assert.equal(x.values.get(a.storageKey), raw);
});
test("same-account stale edit refuses overwrite, preserves the other page, and requires explicit reread", async () => {
  const x = fixture(), a = x.create(), b = x.create(); await a.activate(); await b.activate();
  await a.edit(d => ({ ...d, items: [item] })); const saved = x.values.get(a.storageKey);
  await b.edit(d => ({ ...d, customer: { name: "stale", phone: "", email: "", note: "" } }));
  assert.equal(b.getSnapshot().error, "checkout_cart_changed"); assert.equal(b.getSnapshot().ready, false); assert.equal(x.values.get(a.storageKey), saved);
  await b.refresh(); await b.edit(d => ({ ...d, items: d.items.map(i => ({ ...i, quantity: 2 })) }));
  await a.refresh(); assert.equal(a.getSnapshot().data.items[0].quantity, 2); assert.equal(a.getSnapshot().revision, 2);
});
test("overlapping edits use the financial account/site lock; contention does not write", async () => {
  const x = fixture(), c = x.create(); await c.activate(); let begin!: () => void, finish!: () => void;
  const began = new Promise<void>(r => { begin = r; }), held = new Promise<void>(r => { finish = r; });
  const lock = x.exclusive(c.lockKey, async () => { begin(); await held; }); await began;
  await c.edit(d => ({ ...d, items: [item] })); assert.equal(c.getSnapshot().error, "checkout_other_tab"); assert.equal(x.events.length, 0); finish(); await lock;
});
test("financial callback can persist inside its existing live lease, without reacquiring or deadlocking", async () => {
  const x = fixture(), c = x.create(); await c.activate(); let savedLease: CheckoutDraftLease | undefined;
  await x.exclusive(c.lockKey, () => withCheckoutDraftLease(c.lockKey, async lease => { savedLease = lease;
    const raw = await c.persist(null, { ...c.getSnapshot().data, items: [item] }, lease); assert.equal(x.values.get(c.storageKey), raw);
  }));
  assert.throws(() => assertCheckoutDraftLease(savedLease, c.lockKey));
  await assert.rejects(c.persist(c.getSnapshot().raw, c.getSnapshot().data, savedLease)); assert.equal(c.getSnapshot().revision, 1);
});
test("missing, forged and different-account leases cannot persist", async () => {
  const x = fixture(), c = x.create(); await c.activate();
  await assert.rejects(c.persist(null, c.getSnapshot().data)); await assert.rejects(c.persist(null, c.getSnapshot().data, { key: c.lockKey }));
  await withCheckoutDraftLease("another", async lease => { await assert.rejects(c.persist(null, c.getSnapshot().data, lease)); }); assert.equal(x.events.length, 0);
});
test("deactivation clears in-memory personal fields and prevents held callbacks from writing later", async () => {
  const x = fixture(); let resolve!: () => void, started!: () => void;
  const gate = new Promise<void>(r => { resolve = r; }), began = new Promise<void>(r => { started = r; });
  const c = createAccountCartDraft(scope, { storage: x.storage, exclusive: async (_key, run) => { started(); await gate; await run(); return true; } });
  const loading = c.activate(); await began; c.deactivate(); resolve(); await loading; assert.equal(c.getSnapshot().ready, false); assert.equal(x.events.length, 0);
});
test("wrong-owner envelope is not shown, migrated, repaired or overwritten", async () => {
  const x = fixture(), c = x.create(), wrong = JSON.stringify({ version: 1, scope: { ...scope, accountId: "50010106" }, revision: 1, data: { items: [item], customer: { name: "private", phone: "", email: "", note: "" }, clientRequestId: "" } });
  x.values.set(c.storageKey, wrong); await c.activate(); assert.equal(c.getSnapshot().ready, false); assert.equal(c.getSnapshot().data.items.length, 0);
  await c.edit(d => d); assert.equal(x.values.get(c.storageKey), wrong); assert.equal(x.events.length, 0);
});
test("ordinary original reference or malformed shared state is a barrier, not an empty migrated draft", async () => {
  for (const raw of ['{"clientRequestId":"old-original"}', "bad-json", '{}']) {
    const x = fixture(), c = x.create(); x.values.set(c.legacyKey, raw); await c.activate(); assert.equal(c.getSnapshot().legacyPending, true); assert.equal(x.values.get(c.legacyKey), raw);
  }
});
test("storage refusal and silent discard never publish a successful mutation", async () => {
  for (const mode of ["refuse", "drop"] as const) {
    const x = fixture(), c = createAccountCartDraft(scope, { exclusive: x.exclusive, storage: { getItem: x.storage.getItem, setItem: () => { if (mode === "refuse") throw new Error("denied"); } } });
    await c.activate(); await c.edit(d => ({ ...d, items: [item] })); assert.equal(c.getSnapshot().ready, false); assert.equal(c.getSnapshot().revision, 0); assert.equal(x.values.size, 0);
  }
});
test("corrupt, overlong, duplicate, fractional, and extra-field drafts fail without normalization or dropping items", () => {
  const data = { items: [item], customer: { name: "", phone: "", email: "", note: "" }, clientRequestId: "" };
  for (const invalid of [{ ...data, clientRequestId: "legacy" }, { ...data, items: [item, item] }, { ...data, customer: { ...data.customer, memberId: "secret" } },
    { ...data, items: [{ ...item, quantity: 1.5 }] }, { ...data, items: [{ ...item, product: { ...item.product, id: "different" } }] }, { ...data, extra: true }]) assert.throws(() => parseAccountCartData(invalid));
  assert.throws(() => accountCartStorageKey({ ...scope, blockId: "bad/path" }));
});
test("a legacy original appearing after activation is rechecked inside the write lock", async () => {
  const x = fixture(), c = x.create(); await c.activate(); x.values.set(c.legacyKey, '{"clientRequestId":"unknown-original"}');
  await c.edit(d => ({ ...d, items: [item] })); assert.equal(c.getSnapshot().ready, false); assert.equal(x.values.has(c.storageKey), false);
  assert.equal(x.values.get(c.legacyKey), '{"clientRequestId":"unknown-original"}');
});
test("a retained financial nonce blocks ordinary edits/saves even before the other page's storage event arrives", async () => {
  const x = fixture(), c = x.create(); await c.activate(); x.values.set(c.lockKey, '{"version":1,"nonce":"33333333-3333-4333-8333-333333333333"}');
  await c.edit(d => ({ ...d, items: [item] })); assert.equal(c.getSnapshot().error, "checkout_other_tab"); assert.equal(x.values.has(c.storageKey), false);
  await assert.rejects(c.save(null, { ...c.getSnapshot().data, items: [item] })); assert.equal(x.events.length, 0);
  await withCheckoutDraftLease(c.lockKey, async lease => { await c.persist(null, { ...c.getSnapshot().data, items: [item] }, lease); });
  assert.equal(c.getSnapshot().data.items.length, 1, "only the explicit financial callback's live lease may reconcile its draft");
});
test("revision exhaustion cannot create an envelope that later fails its own parser", async () => {
  const x = fixture(), c = x.create(), raw = JSON.stringify({ version: 1, scope, revision: Number.MAX_SAFE_INTEGER - 1, data: { items: [], customer: { name: "", phone: "", email: "", note: "" }, clientRequestId: "" } });
  x.values.set(c.storageKey, raw); await c.activate(); await c.edit(d => ({ ...d, items: [item] })); assert.equal(c.getSnapshot().ready, false); assert.equal(x.values.get(c.storageKey), raw); assert.equal(x.events.length, 0);
});

test("release verification reads exact durable owned bytes under the live shared lease without writing", async () => {
  const x = fixture(), c = x.create(); await c.activate(); await c.edit(d => ({ ...d, items: [item], customer: { name: "Kept", phone: "1", email: "kept@synthetic.invalid", note: "Keep note" } }));
  const raw = c.getSnapshot().raw!, state = c.getSnapshot(), before = new Map(x.values), writes = [...x.events];
  await x.exclusive(c.lockKey, () => withCheckoutDraftLease(c.lockKey, async lease => {
    assert.equal(c.verify(raw, lease), undefined); assert.equal(c.verify(raw, lease), undefined);
  }));
  assert.deepEqual(x.values, before); assert.deepEqual(x.events, writes); assert.equal(c.getSnapshot(), state);
});

test("release verification rejects missing, changed, corrupt or wrong-owner data without adopting or repairing it", async () => {
  for (const mode of ["absent", "changed", "corrupt", "owner"] as const) {
    const x = fixture(), c = x.create(); await c.activate(); await c.edit(d => ({ ...d, items: [item] }));
    const raw = c.getSnapshot().raw!, state = c.getSnapshot(), writes = [...x.events];
    if (mode === "absent") x.values.delete(c.storageKey);
    else if (mode === "corrupt") x.values.set(c.storageKey, "broken-json");
    else { const next = JSON.parse(raw); if (mode === "changed") { next.revision++; next.data.customer.note = "newer"; } else next.scope.accountId = "59999999"; x.values.set(c.storageKey, JSON.stringify(next)); }
    const before = new Map(x.values);
    await withCheckoutDraftLease(c.lockKey, async lease => { assert.throws(() => c.verify(raw, lease)); });
    assert.deepEqual(x.values, before); assert.deepEqual(x.events, writes); assert.equal(c.getSnapshot(), state);
  }
});

test("release verification cannot treat an absent draft or a newly pending legacy original as saved", async () => {
  const x = fixture(), c = x.create(); await c.activate();
  await withCheckoutDraftLease(c.lockKey, async lease => { assert.throws(() => c.verify(null, lease)); });
  await c.edit(d => ({ ...d, items: [item] })); const raw = c.getSnapshot().raw!;
  x.values.set(c.legacyKey, JSON.stringify({ clientRequestId: "ordinary-original" })); const before = new Map(x.values), writes = [...x.events];
  await withCheckoutDraftLease(c.lockKey, async lease => { assert.throws(() => c.verify(raw, lease), /checkout_legacy_original_pending/); });
  assert.deepEqual(x.values, before); assert.deepEqual(x.events, writes);
});

test("release verification refuses forged, foreign, expired leases and an inactive owner", async () => {
  const x = fixture(), c = x.create(); await c.activate(); await c.edit(d => ({ ...d, items: [item] })); const raw = c.getSnapshot().raw!, before = new Map(x.values), writes = [...x.events];
  assert.throws(() => c.verify(raw, { key: c.lockKey }));
  await withCheckoutDraftLease("another", async lease => { assert.throws(() => c.verify(raw, lease)); });
  let expired!: CheckoutDraftLease;
  await withCheckoutDraftLease(c.lockKey, async lease => { expired = lease; }); assert.throws(() => c.verify(raw, expired));
  c.deactivate(); await withCheckoutDraftLease(c.lockKey, async lease => { assert.throws(() => c.verify(raw, lease), /checkout_draft_inactive/); });
  assert.deepEqual(x.values, before); assert.deepEqual(x.events, writes);
});

test("release verification fails closed when storage becomes unreadable after a successful save", async () => {
  const x = fixture(); let blocked = false;
  const c = createAccountCartDraft(scope, { exclusive: x.exclusive, storage: { ...x.storage, getItem: k => { if (blocked && k === accountCartStorageKey(scope)) throw new Error("denied"); return x.storage.getItem(k); } } });
  await c.activate(); await c.edit(d => ({ ...d, items: [item] })); const raw = c.getSnapshot().raw!, before = new Map(x.values), writes = [...x.events]; blocked = true;
  await withCheckoutDraftLease(c.lockKey, async lease => { assert.throws(() => c.verify(raw, lease), /denied/); });
  assert.deepEqual(x.values, before); assert.deepEqual(x.events, writes);
});
