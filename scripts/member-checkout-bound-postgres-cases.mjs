// Called only by the owning TEMP PostgreSQL harness. Actual composed client ->
// bound HTTP -> trusted single planner -> SQL. Synthetic identity/transport only.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import boundClient from '../src/lib/merchantCheckoutBoundClient.ts';
import boundHttp from '../src/lib/merchantCheckoutBoundSubmit.server.ts';
import singleHttp from '../src/app/api/member-checkout/single/route-handler.ts';
import unusedHttp from '../src/lib/merchantCheckoutUnusedReference.server.ts';
import cartHttp from '../src/lib/merchantCheckoutCartHttp.server.ts';
import intentHttp from '../src/lib/merchantCheckoutIntentHttp.server.ts';
import pointsPlan from '../src/lib/merchantCheckoutSubmissionPlan.server.ts';
import common from '../src/lib/merchantCheckoutClient.ts';

export async function boundCheckoutCases(t, { db, one, site, seed, state, rpc, requestFor, sessionFor }) {
  for (const method of ['points', 'on_site']) for (const committed of [false, true]) {
    await t.test(`${method}: fresh bound client ${committed ? 'recovers real original after lost reply without closing it' : 'closes unused reference and rejects actual late SQL without changing its host'}`, async () => {
      const f = await seed(method, true), session = sessionFor(f), kind = method === 'points' ? 'points' : 'on-site';
      const key = common.checkoutClientStorageKey(site, f.principal.accountId), bindingKey = boundClient.checkoutReferenceBindingKey(site, f.principal.accountId);
      const store = new Map([['host-cart', 'KEEP original products and member'], ['host-form', JSON.stringify(f.customer)]]), paths = [];
      let held = null, firstCloseLost = !committed;
      const pointsPreview = { preview: async input => {
        const who = await input.authorize(), id = pointsPlan.checkoutSubmissionIdentity({ ...input.request, method: 'points', nonce: randomUUID(), confirmationHash: '0'.repeat(64), customer: f.customer }, who);
        const read = await rpc('faolla_member_checkout_submission_snapshot_v2', { p_site_id: site, p_operation_key: id.operationKey, p_principal_key: id.principalKey, p_request_hash: id.requestHash, p_offer_id: f.offer.id });
        assert.equal(read.error, null); return pointsPlan.quoteCheckoutSubmissionSnapshot(pointsPlan.parseCheckoutSubmissionSnapshot(read.data.snapshot, id), id, who);
      } };
      const capture = async (name, args, signal) => {
        if (/(?:submission_commit_v2|on_site_commit_v1)$/.test(name)) {
          assert.equal(held, null); held = { name, args: structuredClone(args) };
          // The new client has durably bound the original identity BEFORE any
          // financial SQL. This is not a sidecar reconstructed during recovery.
          const saved = JSON.parse(store.get(bindingKey)); assert.equal(saved.reference, store.get(key)); assert.equal(saved.operationKey, args.p_operation_key);
          if (!committed) throw Error('synthetic held BEFORE actual financial SQL');
        }
        return rpc(name, args, signal);
      };
      const transport = async (path, body, signal, operationKey) => {
        paths.push(path); const r = requestFor(f, path, body, signal), headers = new Headers(r.headers);
        if (operationKey) headers.set('x-checkout-operation-scope', operationKey);
        const request = new Request(r, { headers }), deps = { enabled: () => true, session, call: rpc };
        let response;
        if (path.includes('/bound-submit/')) response = await boundHttp.handleBoundCheckoutSubmit(kind, request, { enabled: () => true, call: capture, single: { ...deps, cashEnabled: () => true } });
        else if (/\/(unused-review|close-unused)$/.test(path)) response = await unusedHttp.handleUnusedCheckoutReference(path.endsWith('/close-unused'), request, deps);
        else if (path.endsWith('/preview')) response = await singleHttp.handleSingleIntentCheckout(kind, 'preview', request, { ...deps, cashEnabled: () => true, pointsPreview });
        else if (path.endsWith('/cart/recover')) response = await cartHttp.handleCartCheckout('recover', request, { ...deps, intentEnabled: () => true });
        else response = await intentHttp.handleCheckoutIntent(path.endsWith('/pending') ? 'pending' : 'review', request, deps);
        const value = await response.json(); if (!response.ok) throw new common.CheckoutClientError(value.error, response.status);
        if (path.includes('/bound-submit/') && committed) throw new common.CheckoutClientError('checkout_unconfirmed', 503);
        if (path.endsWith('/close-unused') && firstCloseLost) { firstCloseLost = false; throw new common.CheckoutClientError('checkout_unused_unconfirmed', 503); }
        return value;
      };
      const make = method === 'points' ? boundClient.createBoundPointsCheckoutController : boundClient.createBoundOnSiteCheckoutController;
      const options = { siteId: site, accountId: f.principal.accountId, boundRequest: transport, randomNonce: randomUUID,
        storage: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k) },
        exclusive: async (_key, run) => { await run(); return true; } };
      let c = make(options);
      try {
        await c.activate(); const before = await state();
        if (method === 'points') await c.preview(f.selection); else await c.preview(f.selection, f.customer);
        assert.equal(c.getSnapshot().phase, 'ready', JSON.stringify(c.getSnapshot())); assert.deepEqual(await state(), before);
        await c.submit(f.customer); assert.ok(held); assert.equal(paths.filter(p => p.includes('/bound-submit/')).length, 1);
        const saved = new Map(store), afterSubmit = await state();
        if (committed) {
          assert.equal(c.getSnapshot().phase, 'confirmed', JSON.stringify(c.getSnapshot())); assert.equal(c.getSnapshot().originalReview.kind, 'single');
          const closureCount = (await one(db, 'select count(*)::int n from faolla_checkout_design.closed_unused_references')).n;
          await c.reviewUnused(); await c.closeUnused(true);
          assert.equal((await one(db, 'select count(*)::int n from faolla_checkout_design.closed_unused_references')).n, closureCount);
          assert.deepEqual(await state(), afterSubmit); assert.deepEqual(store, saved); assert.equal(paths.some(p => p.endsWith('/close-unused')), false);
        } else {
          assert.equal(c.getSnapshot().phase, 'unconfirmed'); assert.deepEqual(afterSubmit, before);
          // Same public account ID with a changed auth user cannot clear the
          // former operation; the actual new HTTP rejects it before any RPC.
          let calls = 0;
          const wrong = await unusedHttp.handleUnusedCheckoutReference(false, new Request(requestFor(f, '/api/member-checkout/intent/unused-review', { siteId: site, nonce: JSON.parse(store.get(key)).nonce }), { headers: {
            origin: 'https://booking-intent-pg.synthetic.invalid', 'content-type': 'application/json', 'x-checkout-account-scope': f.principal.accountId, 'x-checkout-operation-scope': held.args.p_operation_key,
          } }), { enabled: () => true, session: async () => ({ ...await session(), userId: 'changed-synthetic-user' }), call: async (...args) => { calls++; return rpc(...args); } });
          assert.equal(wrong.status, 401); assert.equal(calls, 0); assert.deepEqual(store, saved);
          await c.reviewUnused(); assert.equal(c.getSnapshot().unusedReferenceReview.state, 'unused'); await c.closeUnused(false); assert.deepEqual(await state(), before);
          await c.closeUnused(true); assert.ok(store.has(key), 'lost close reply retains local reference');
          const closed = await state(); for (const table of Object.keys(before)) if (table !== 'faolla_checkout_design.closed_unused_references') assert.deepEqual(closed[table], before[table], table);
          c.deactivate(); c = make(options); await c.activate(); await c.reviewUnused(); assert.equal(c.getSnapshot().unusedReferenceReview.state, 'closed');
          await c.closeUnused(true); assert.equal(c.getSnapshot().phase, 'idle'); assert.equal(c.getSnapshot().pending, false); assert.equal(store.has(key), false);
          for (const [k, value] of saved) if (k !== key) assert.equal(store.get(k), value, k);
          const late = await rpc(held.name, held.args); assert.equal(late.error.message, 'checkout_reference_closed'); assert.deepEqual(await state(), closed);
        }
        assert.equal(paths.filter(p => p.includes('/bound-submit/')).length, 1);
      } finally { c.deactivate(); }
    });
  }
}
