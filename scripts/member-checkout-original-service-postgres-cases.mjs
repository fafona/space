// Owned TEMP-cluster cases only. Real atomic writers/servicing SQL and actual
// client/HTTP; synthetic identities, no live Next/PostgREST or provider IO.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import serviceHttp from '../src/lib/merchantCheckoutOriginalService.server.ts';
import serviceClient from '../src/lib/merchantCheckoutOriginalServiceClient.ts';
import common from '../src/lib/merchantCheckoutClient.ts';
import pointsPlan from '../src/lib/merchantCheckoutSubmissionPlan.server.ts';
import pointsService from '../src/lib/merchantCheckoutSubmission.server.ts';
import cashService from '../src/lib/merchantCheckoutOnSiteSubmission.server.ts';
import cartFixtures from './fixtures/member-checkout-cart-quote.ts';
import cartService from '../src/lib/merchantCheckoutCartSubmission.server.ts';
import boundHttp from '../src/lib/merchantCheckoutBoundSubmit.server.ts';

export async function originalServiceCases(t, { db, peer, one, site, seed, state, rpc, requestFor, sessionFor, decode }) {
  assert.equal((await one(db, 'select count(*)::int n from faolla_checkout_design.original_service_pilots where enabled')).n, 0);
  const enable = id => db.query('insert into faolla_checkout_design.original_service_pilots values($1,true) on conflict(site_id) do update set enabled=true', [id]);
  const stopPurchases = async id => {
    const saved = [];
    for (const { tablename } of (await db.query("select tablename from pg_tables where schemaname='faolla_checkout_design' and tablename like '%pilots' and tablename<>'original_service_pilots'")).rows) {
      assert.match(tablename, /^[a-z0-9_]+$/); const prior = await one(db, `select enabled from faolla_checkout_design.${tablename} where site_id=$1`, [id]);
      if (prior) { saved.push([tablename, prior.enabled]); await db.query(`update faolla_checkout_design.${tablename} set enabled=false where site_id=$1`, [id]); }
    }
    return async () => { for (const [table, enabled] of saved) await db.query(`update faolla_checkout_design.${table} set enabled=$2 where site_id=$1`, [id, enabled]); };
  };
  const prepare = async (method, returns = true) => {
    const f = await seed(method, returns), request = { ...f.selection, method, nonce: randomUUID(), confirmationHash: '0'.repeat(64), customer: f.customer }, input = { request, principal: f.principal, authorize: async () => f.principal };
    if (method === 'points') {
      const id = pointsPlan.checkoutSubmissionIdentity(request, f.principal), r = await rpc('faolla_member_checkout_submission_snapshot_v2', { p_site_id: site, p_operation_key: id.operationKey, p_principal_key: id.principalKey, p_request_hash: id.requestHash, p_offer_id: f.offer.id }); assert.equal(r.error, null);
      request.confirmationHash = (await pointsPlan.quoteCheckoutSubmissionSnapshot(pointsPlan.parseCheckoutSubmissionSnapshot(r.data.snapshot, id), id, f.principal)).confirmationHash;
    } else request.confirmationHash = (await cashService.previewOnSiteCheckout(input, rpc)).quote.confirmationHash;
    const created = method === 'points' ? await pointsService.submitMemberCheckout(input, rpc) : await cashService.submitOnSiteCheckout(input, rpc);
    return { ...f, siteId: site, operationKey: created.result.operationKey, request };
  };
  const invoke = (f, cancel, body, call = rpc) => serviceHttp.handleCheckoutOriginalService(cancel, requestFor(f, '/api/member-checkout/original-service/' + (cancel ? 'cancel' : 'review'), body ?? { siteId: f.siteId, operationKey: f.operationKey }), { enabled: () => true, session: sessionFor(f), call });
  const bodyFor = review => ({ siteId: review.siteId, operationKey: review.operationKey, reviewHash: review.reviewHash,
    expectedUpdatedAt: (review.original.kind === 'cart' ? review.original.result : review.original.original.result).resource.updatedAt });
  const serviceArgs = (f, review) => ({ p_site_id: f.siteId, p_operation_key: f.operationKey, p_principal_key: `account:${f.principal.accountId}:${f.principal.userId}`,
    p_review_hash: review.reviewHash, p_expected_updated_at: bodyFor(review).expectedUpdatedAt, p_not_after: new Date(Date.now() + 10_000).toISOString() });
  for (const method of ['points', 'on_site']) for (const returns of [true, false]) await t.test(`${method}: purchases stopped, original cancellation/lost reply/replay follows frozen return=${returns}`, async () => {
    const f = await prepare(method, returns); await enable(site); const restore = await stopPurchases(site); const savedOriginal = await one(db, 'select to_jsonb(r) original from faolla_checkout_design.bundle_results r where site_id=$1 and operation_key=$2', [site, f.operationKey]);
    const before = await state(); let cancels = 0, firstLost = true;
    const c = serviceClient.createOriginalServiceController({ siteId: site, operationKey: f.operationKey, accountId: f.principal.accountId, request: async (path, body) => {
      const cancel = path.endsWith('/cancel'), r = await invoke(f, cancel, body), v = await r.json(); if (!r.ok) throw new common.CheckoutClientError(v.error, r.status);
      if (cancel) { cancels++; if (firstLost) { firstLost = false; throw new common.CheckoutClientError('checkout_service_unconfirmed', 503); } } return v;
    } });
    try {
      let creationCalls = 0; const req = requestFor(f, '/api/member-checkout/intent/bound-submit/' + (method === 'points' ? 'points' : 'on-site'), f.request), headers = new Headers(req.headers); headers.set('x-checkout-operation-scope', f.operationKey);
      assert.equal((await boundHttp.handleBoundCheckoutSubmit(method === 'points' ? 'points' : 'on-site', new Request(req, { headers }), { enabled: () => false, call: async () => { creationCalls++; throw Error('no creation'); }, single: { session: sessionFor(f) } })).status, 503); assert.equal(creationCalls, 0);
      await c.activate(); assert.equal(c.getSnapshot().phase, 'ready', JSON.stringify(c.getSnapshot())); assert.deepEqual(await state(), before);
      await c.cancel(false); assert.deepEqual(await state(), before); await c.cancel(true); assert.equal(c.getSnapshot().phase, 'unconfirmed'); const after = await state();
      await c.cancel(true); assert.equal(cancels, 1); assert.deepEqual(await state(), after); await c.read();
      const review = c.getSnapshot().review, result = review.original.original.result; assert.equal(result.closed, true); assert.equal(result.cancellation.pointsReturned, method === 'points' && returns ? 80 : 0);
      assert.equal(result.cancellation.couponsReturned, returns ? 1 : 0); assert.equal(result.cancellation.stockReleased, 1);
      if (method === 'on_site') assert.equal(result.cancellation.cashReturnedMinor, 0);
      const replay = (await decode(await invoke(f, true, bodyFor(review)))).cancellation; assert.equal(replay.replayed, true); assert.deepEqual(await state(), after);
      assert.deepEqual(await one(db, 'select to_jsonb(r) original from faolla_checkout_design.bundle_results r where site_id=$1 and operation_key=$2', [site, f.operationKey]), savedOriginal);
      for (const table of ['intent_claims', 'intent_acknowledgements', 'closed_unused_references']) assert.deepEqual(after['faolla_checkout_design.' + table], before['faolla_checkout_design.' + table], table);
      const member = (await one(db, 'select blocks from pages where merchant_id=$1 and slug=$2', [site, '__merchant_memberships__:' + site])).blocks.find(m => m.id === f.member.id);
      assert.equal(member.pointBalance, method === 'points' && !returns ? 920 : 1000);
      const coupon = (await one(db, 'select blocks from pages where merchant_id=$1 and slug=$2', [site, '__merchant_coupons__:' + site])).blocks.find(v => v.id === f.coupon.id);
      assert.equal(coupon.claimEvents[0].validUntil, f.coupon.claimEvents[0].validUntil); assert.equal(coupon.redeemEvents.length, returns ? 0 : 1);
    } finally { c.deactivate(); await restore(); }
  });
  await t.test('wrong owner/hash, disabled service, retained snapshot and real lock contention do not change an original', async () => {
    const f = await prepare('points'); await enable(site); const restore = await stopPurchases(site);
    try { const review = (await decode(await invoke(f, false))).review, before = await state();
      for (const patch of [{ p_review_hash: 'f'.repeat(64) }, { p_principal_key: 'account:59999999:foreign-synthetic' }]) assert.notEqual((await rpc('faolla_member_checkout_original_service_cancel_v1', { ...serviceArgs(f, review), ...patch })).error, null);
      await peer.query('begin'); try { await peer.query("select pg_advisory_xact_lock(hashtextextended('faolla-customer-checkout:'||$1,0))", [site]);
        const r = await invoke(f, true, bodyFor(review)); assert.equal(r.status, 409); assert.deepEqual(await r.json(), { error: 'checkout_service_busy' });
      } finally { await peer.query('rollback'); }
      await db.query('begin isolation level repeatable read'); try { assert.equal((await rpc('faolla_member_checkout_original_service_cancel_v1', serviceArgs(f, review))).error.message, 'checkout_service_unavailable'); } finally { await db.query('rollback'); }
      assert.deepEqual(await state(), before);
      await db.query('update faolla_checkout_design.original_service_pilots set enabled=false where site_id=$1', [site]);
      const disabled = await state(); assert.equal((await rpc('faolla_member_checkout_original_service_cancel_v1', serviceArgs(f, review))).error.message, 'checkout_service_disabled'); assert.deepEqual(await state(), disabled);
    } finally { await enable(site); await restore(); }
  });
  await t.test('cancellation expiring inside the old atomic writer rolls back all domain effects and the return receipt', async () => {
    const f = await prepare('points'); await enable(site); const review = (await decode(await invoke(f, false))).review;
    await db.query("create sequence public.synthetic_service_ticks;create function public.synthetic_slow_service() returns trigger language plpgsql as $$begin perform nextval('public.synthetic_service_ticks');perform pg_sleep(0.12);return NEW;end;$$;create trigger synthetic_slow_service before insert on faolla_checkout_design.bundle_cancellations for each row execute function public.synthetic_slow_service();");
    try { const before = await state(), r = await rpc('faolla_member_checkout_original_service_cancel_v1', { ...serviceArgs(f, review), p_not_after: new Date(Date.now() + 80).toISOString() });
      assert.equal(r.error.message, 'checkout_service_expired'); assert.equal((await one(db, 'select is_called from public.synthetic_service_ticks')).is_called, true); assert.deepEqual(await state(), before);
    } finally { await db.query('drop trigger synthetic_slow_service on faolla_checkout_design.bundle_cancellations;drop function public.synthetic_slow_service();drop sequence public.synthetic_service_ticks'); }
  });
  await t.test('an actual venue receipt remains visible after purchase shutdown but cannot be cancelled or silently refunded', async () => {
    const f = await prepare('on_site'); await enable(site);
    const prior = (await decode(await invoke(f, false))).review, result = prior.original.original.result;
    await db.query('select public.faolla_checkout_on_site_collect_v1($1,$2,$3,$4,$5,$6)', [site, f.operationKey, 'owner:synthetic-owner', result.resource.updatedAt, result.terms.dueMinor, new Date(Date.now() + 10_000).toISOString()]);
    const restore = await stopPurchases(site);
    try {
      const before = await state(), review = (await decode(await invoke(f, false))).review, original = review.original.original.result;
      assert.equal(original.collection.amountMinor, 800); assert.equal(original.collection.currency, 'eur'); assert.equal(original.cancellationAvailable, false); assert.deepEqual(await state(), before);
      const stale = await invoke(f, true, bodyFor(prior)); assert.equal(stale.status, 409); assert.deepEqual(await stale.json(), { error: 'checkout_service_changed' });
      const forced = await invoke(f, true, bodyFor(review)); assert.equal(forced.status, 409); assert.deepEqual(await forced.json(), { error: 'checkout_cancellation_requires_refund' });
      assert.deepEqual(await state(), before);
    } finally { await restore(); }
  });
  for (const method of ['points', 'on_site']) await t.test(`${method}: two-product original is cancelled as one cart after every purchase pilot stops`, async () => {
    const f = cartFixtures.cartQuoteFixture(method), id = f.siteId;
    // Servicing deliberately does not acknowledge an original. Use a separate
    // synthetic owner per case instead of erasing that retained pending claim.
    Object.assign(f.principal, { accountId: method === 'points' ? '50010106' : '50010107', userId: `service-cart-${method}-synthetic` });
    Object.assign(f.member, f.principal);
    for (const coupon of f.coupons) for (const claim of coupon.claimEvents) Object.assign(claim, f.principal);
    for (const table of ['bundle_pilots', 'cart_quote_pilots', 'cart_submission_pilots', 'intent_pilots']) await db.query(`insert into faolla_checkout_design.${table} values($1,true) on conflict(site_id) do update set enabled=true`, [id]);
    for (const row of [...f.snapshot.sourceRows, ...f.snapshot.domainRows]) {
      const old = await one(db, 'select id from pages where merchant_id is not distinct from $1 and slug=$2', [row.merchant_id, row.slug]);
      if (old) await db.query('update pages set blocks=$2 where id=$1', [old.id, JSON.stringify(row.blocks)]); else await db.query('insert into pages(id,merchant_id,slug,blocks) values($1,$2,$3,$4)', [row.id, row.merchant_id, row.slug, JSON.stringify(row.blocks)]);
    }
    let version = (await one(db, 'select public.faolla_member_checkout_catalog_snapshot_v1($1) result', [id])).result.version;
    for (let i = 0; i < f.offers.length; i++) {
      const old = await one(db, 'select v.offer_id from faolla_checkout_design.offer_heads h join faolla_checkout_design.offer_versions v using(site_id,offer_id,revision) where h.site_id=$1 and v.source_key=$2', [id, f.offers[i].checkoutBinding.sourceKey]);
      if (old) { f.offers[i].id = old.offer_id; f.request.lines[i].offerId = old.offer_id; }
      const next = randomUUID(); await db.query('select public.faolla_member_checkout_catalog_save_v1($1,$2,$3,$4,$5)', [id, version, next, 'owner:synthetic-owner', f.offers[i]]); version = next;
      f.request.lines[i].couponClaims = method === 'points' || i === 0 ? [{ couponId: f.coupons[i].id, claimEventId: f.coupons[i].claimEvents[0].id }] : [];
    }
    const request = { ...f.request, nonce: randomUUID(), confirmationHash: '0'.repeat(64), customer: { name: 'Synthetic', title: '', email: 'synthetic@example.invalid', phone: '000', note: '' } };
    const cartRpc = async (name, values) => { const map = { faolla_member_checkout_cart_submission_snapshot_v1: ['p_site_id', 'p_operation_key', 'p_principal_key', 'p_request_hash', 'p_quote_request_hash', 'p_offer_ids'], faolla_member_checkout_cart_commit_v1: ['p_site_id', 'p_operation_key', 'p_principal_key', 'p_request_hash', 'p_snapshot', 'p_plan', 'p_not_after'] }, keys = map[name]; assert.ok(keys, name);
      try { return { data: (await one(db, `select public.${name}(${keys.map((_, i) => '$' + (i + 1)).join(',')}) result`, keys.map(k => k === 'p_offer_ids' ? JSON.stringify(values[k]) : values[k]))).result, error: null }; } catch (e) { return { data: null, error: { message: e.message } }; } };
    const input = { request, principal: f.principal, authorize: async () => f.principal, enabled: () => true }; request.confirmationHash = (await cartService.previewCartSubmission(input, cartRpc)).confirmationHash;
    const result = await cartService.submitCartCheckout(input, cartRpc), original = { ...f, operationKey: result.result.operationKey }; await enable(id); const restore = await stopPurchases(id);
    try { const before = await state(), review = (await decode(await invoke(original, false))).review; assert.deepEqual(await state(), before);
      const cancelled = (await decode(await invoke(original, true, bodyFor(review)))).cancellation, cart = cancelled.review.original.result; assert.equal(cart.closed, true);
      assert.equal(cart.cancellation.pointsReturned, method === 'points' ? 160 : 0); assert.equal(cart.cancellation.couponsReturned, method === 'points' ? 2 : 1); assert.equal(cart.cancellation.stockReleased, 2);
      const after = await state(); assert.equal((await decode(await invoke(original, true, bodyFor(cancelled.review)))).cancellation.replayed, true); assert.deepEqual(await state(), after);
      assert.deepEqual(after['faolla_checkout_design.intent_acknowledgements'], before['faolla_checkout_design.intent_acknowledgements']);
    } finally { await restore(); }
  });
  await t.test('new service table/functions stay inaccessible to API roles', async () => {
    for (const role of ['anon', 'authenticated', 'service_role']) {
      assert.equal((await one(db, 'select has_table_privilege($1,$2,$3) allowed', [role, 'faolla_checkout_design.original_service_pilots', 'SELECT,INSERT,UPDATE,DELETE'])).allowed, false);
      for (const signature of ['faolla_member_checkout_original_service_review_v1(text,text,text)', 'faolla_member_checkout_original_service_cancel_v1(text,text,text,text,text,text)']) assert.equal((await one(db, 'select has_function_privilege($1,$2,$3) allowed', [role, 'public.' + signature, 'EXECUTE'])).allowed, false);
    }
  });
}
