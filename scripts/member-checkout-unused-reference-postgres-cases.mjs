// Called only inside the owning booking TEMP-cluster harness. Synthetic identity,
// actual single financial planners/SQL + new HTTP; no production or provider IO.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pointsPlan from '../src/lib/merchantCheckoutSubmissionPlan.server.ts';
import pointsService from '../src/lib/merchantCheckoutSubmission.server.ts';
import cashService from '../src/lib/merchantCheckoutOnSiteSubmission.server.ts';
import unusedHttp from '../src/lib/merchantCheckoutUnusedReference.server.ts';
import cartFixtures from './fixtures/member-checkout-cart-quote.ts';
import cartService from '../src/lib/merchantCheckoutCartSubmission.server.ts';

export async function unusedReferenceCases(t, { db, peer, one, site, seed, state, rpc, requestFor, sessionFor, decode }) {
  const reviewRpc = 'faolla_member_checkout_unused_reference_review_v1', closeRpc = 'faolla_member_checkout_close_unused_reference_v1';
  assert.equal((await one(db, 'select count(*)::int n from faolla_checkout_design.unused_reference_pilots where enabled')).n, 0);
  await db.query('insert into faolla_checkout_design.unused_reference_pilots(site_id,enabled) values($1,true)', [site]);
  const input = f => ({ siteId: site, nonce: f.nonce });
  const invoke = (f, close, hash, call = rpc) => unusedHttp.handleUnusedCheckoutReference(close,
    requestFor(f, '/api/member-checkout/intent/test', { ...input(f), ...(close ? { reviewHash: hash } : {}) }), { enabled: () => true, session: sessionFor(f), call });
  const prepare = async (method = 'points') => {
    const f = await seed(method, true), nonce = randomUUID();
    const request = { ...f.selection, method, nonce, confirmationHash: '0'.repeat(64), customer: f.customer };
    const principal = f.principal, submitInput = { request, principal, authorize: async () => principal };
    if (method === 'points') {
      const id = pointsPlan.checkoutSubmissionIdentity(request, principal);
      const read = await rpc('faolla_member_checkout_submission_snapshot_v2', { p_site_id: site, p_operation_key: id.operationKey, p_principal_key: id.principalKey, p_request_hash: id.requestHash, p_offer_id: f.offer.id });
      assert.equal(read.error, null);
      request.confirmationHash = (await pointsPlan.quoteCheckoutSubmissionSnapshot(pointsPlan.parseCheckoutSubmissionSnapshot(read.data.snapshot, id), id, principal)).confirmationHash;
    } else request.confirmationHash = (await cashService.previewOnSiteCheckout(submitInput, rpc)).quote.confirmationHash;
    let prepared;
    const capture = async (name, args, signal) => {
      if (/(?:submission_commit_v2|on_site_commit_v1)$/.test(name)) { prepared = { name, args: structuredClone(args) }; throw Error('synthetic transport stopped BEFORE SQL'); }
      return rpc(name, args, signal);
    };
    await assert.rejects(method === 'points' ? pointsService.submitMemberCheckout(submitInput, capture) : cashService.submitOnSiteCheckout(submitInput, capture), /checkout_unconfirmed/);
    assert.ok(prepared); return { ...f, nonce, prepared, operationKey: prepared.args.p_operation_key, principalKey: prepared.args.p_principal_key };
  };
  const raw = (name, args) => rpc(name, args);
  const args = f => ({ p_site_id: site, p_operation_key: f.operationKey, p_principal_key: f.principalKey });
  const closeArgs = (f, reviewHash) => ({ ...args(f), p_review_hash: reviewHash, p_not_after: new Date(Date.now() + 10_000).toISOString() });
  const unchangedExceptMarkers = (before, after) => {
    for (const key of Object.keys(before)) if (key !== 'faolla_checkout_design.closed_unused_references') assert.deepEqual(after[key], before[key], key);
  };

  for (const method of ['points', 'on_site']) {
    await t.test(`${method}: lost-before-SQL reference can close once; actual late booking write fully rolls back even after pilot closure`, async () => {
      const f = await prepare(method), before = await state();
      const review = (await decode(await invoke(f, false))).review; assert.equal(review.state, 'unused'); assert.deepEqual(await state(), before);
      const closure = (await decode(await invoke(f, true, review.reviewHash))).closure; assert.equal(closure.closed, true); assert.equal(closure.replayed, false);
      const closed = await state(); unchangedExceptMarkers(before, closed);
      assert.equal(closed['faolla_checkout_design.closed_unused_references'].length, before['faolla_checkout_design.closed_unused_references'].length + 1);
      assert.equal((await decode(await invoke(f, true, review.reviewHash))).closure.replayed, true); assert.deepEqual(await state(), closed);
      // Losing the close response is recovered by a READ; no financial retry.
      assert.equal((await decode(await invoke(f, false))).review.state, 'closed'); assert.deepEqual(await state(), closed);
      for (const enabled of [true, false]) {
        await db.query('update faolla_checkout_design.unused_reference_pilots set enabled=$2 where site_id=$1', [site, enabled]);
        await db.query('update faolla_checkout_design.intent_pilots set enabled=$2 where site_id=$1', [site, enabled]);
        try {
          const snapshot = await state(), late = await raw(f.prepared.name, f.prepared.args);
          assert.equal(late.data, null); assert.equal(late.error.message, 'checkout_reference_closed'); assert.deepEqual(await state(), snapshot);
        } finally {
          await db.query('update faolla_checkout_design.unused_reference_pilots set enabled=true where site_id=$1', [site]);
          await db.query('update faolla_checkout_design.intent_pilots set enabled=true where site_id=$1', [site]);
        }
      }
      assert.equal((await one(db, 'select count(*)::int n from faolla_checkout_design.bundle_results where site_id=$1 and operation_key=$2', [site, f.operationKey])).n, 0);
    });
    await t.test(`${method}: actual booking commit winning after unused review prevents closure; original and all financial facts remain`, async () => {
      const f = await prepare(method), review = (await decode(await invoke(f, false))).review;
      assert.equal(review.state, 'unused'); const written = await raw(f.prepared.name, f.prepared.args); assert.equal(written.error, null);
      const saved = await state(), response = await invoke(f, true, review.reviewHash); assert.equal(response.status, 409);
      assert.deepEqual(await response.json(), { error: 'checkout_original_exists' }); assert.deepEqual(await state(), saved);
      const found = (await decode(await invoke(f, false))).review; assert.equal(found.state, 'original'); assert.equal(found.reviewHash, null); assert.equal(found.closedAt, null);
      assert.deepEqual(await state(), saved);
    });
  }
  await t.test('another transaction holding the site lock prevents both review and close, without waiting or changing tables', async () => {
    const f = await prepare(), review = (await decode(await invoke(f, false))).review, before = await state();
    await peer.query('begin');
    try {
      await peer.query("select pg_advisory_xact_lock(hashtextextended('faolla-customer-checkout:'||$1,0))", [site]);
      for (const close of [false, true]) {
        const response = await invoke(f, close, review.reviewHash); assert.equal(response.status, 409); assert.deepEqual(await response.json(), { error: 'checkout_unused_busy' });
      }
    } finally { await peer.query('rollback'); }
    assert.deepEqual(await state(), before);
  });
  await t.test('wrong hash, foreign ownership, invalid deadlines, closed rollout and retained snapshots cannot close an operation', async () => {
    const f = await prepare(), review = (await decode(await invoke(f, false))).review, before = await state();
    for (const [patch, code] of [[{ p_review_hash: 'f'.repeat(64) }, 'checkout_unused_changed'], [{ p_principal_key: 'account:59999999:foreign-synthetic' }, 'checkout_unused_changed'],
      [{ p_not_after: new Date(Date.now() - 1000).toISOString() }, 'checkout_unused_expired'], [{ p_not_after: new Date(Date.now() + 60000).toISOString() }, 'checkout_unused_expired'],
      [{ p_principal_key: null }, 'checkout_invalid_request']]) {
      const r = await raw(closeRpc, { ...closeArgs(f, review.reviewHash), ...patch }); assert.equal(r.data, null); assert.equal(r.error.message, code); assert.deepEqual(await state(), before);
    }
    for (const table of ['unused_reference_pilots', 'intent_pilots']) {
      await db.query(`update faolla_checkout_design.${table} set enabled=false where site_id=$1`, [site]);
      try { const snapshot = await state(), r = await raw(closeRpc, closeArgs(f, review.reviewHash)); assert.equal(r.error.message, 'checkout_unused_disabled'); assert.deepEqual(await state(), snapshot); }
      finally { await db.query(`update faolla_checkout_design.${table} set enabled=true where site_id=$1`, [site]); }
    }
    await db.query('begin isolation level repeatable read');
    try { const r = await raw(closeRpc, closeArgs(f, review.reviewHash)); assert.equal(r.error.message, 'checkout_unused_unavailable'); }
    finally { await db.query('rollback'); }
    assert.deepEqual(await state(), before);
  });
  await t.test('closure expiring during insertion rolls back the marker rather than returning false proof', async () => {
    const f = await prepare(), review = (await decode(await invoke(f, false))).review;
    await db.query("create sequence public.synthetic_unused_close_ticks;create function public.synthetic_slow_unused_close() returns trigger language plpgsql as $$begin perform nextval('public.synthetic_unused_close_ticks');perform pg_sleep(0.08);return NEW;end;$$; create trigger synthetic_slow_unused_close before insert on faolla_checkout_design.closed_unused_references for each row execute function public.synthetic_slow_unused_close();");
    try {
      const before = await state(), r = await raw(closeRpc, { ...closeArgs(f, review.reviewHash), p_not_after: new Date(Date.now() + 40).toISOString() });
      assert.equal(r.error.message, 'checkout_unused_expired'); assert.equal((await one(db, 'select is_called from public.synthetic_unused_close_ticks')).is_called, true); assert.deepEqual(await state(), before);
    } finally { await db.query('drop trigger synthetic_slow_unused_close on faolla_checkout_design.closed_unused_references;drop function public.synthetic_slow_unused_close();drop sequence public.synthetic_unused_close_ticks;'); }
  });
  await t.test('closure is immutable, API roles gain no authority and another principal cannot reuse a closed marker', async () => {
    const f = await prepare(), review = (await decode(await invoke(f, false))).review; await decode(await invoke(f, true, review.reviewHash)); const before = await state();
    for (const sql of ['delete from faolla_checkout_design.closed_unused_references where site_id=$1 and operation_key=$2', "update faolla_checkout_design.closed_unused_references set review_hash=repeat('f',64) where site_id=$1 and operation_key=$2"])
      await assert.rejects(db.query(sql, [site, f.operationKey]), /checkout_history_immutable/);
    const foreign = await raw(reviewRpc, { ...args(f), p_principal_key: 'account:59999999:foreign-synthetic' }); assert.equal(foreign.error.message, 'checkout_unused_unavailable');
    for (const role of ['anon', 'authenticated', 'service_role']) for (const signature of [reviewRpc + '(text,text,text)', closeRpc + '(text,text,text,text,text)'])
      assert.equal((await one(db, 'select has_function_privilege($1,$2,$3) allowed', [role, 'public.' + signature, 'EXECUTE'])).allowed, false);
    for (const role of ['anon', 'authenticated', 'service_role']) for (const table of ['unused_reference_pilots', 'closed_unused_references'])
      assert.equal((await one(db, 'select has_table_privilege($1,$2,$3) allowed', [role, 'faolla_checkout_design.' + table, 'SELECT,INSERT,UPDATE,DELETE'])).allowed, false);
    assert.deepEqual(await state(), before);
  });
  for (const method of ['points', 'on_site']) await t.test(`${method}: actual two-product cart effects also roll back after its exact reference closes`, async () => {
    const f = cartFixtures.cartQuoteFixture(method), cartSite = f.siteId;
    for (const table of ['bundle_pilots', 'cart_quote_pilots', 'cart_submission_pilots', 'intent_pilots', 'unused_reference_pilots'])
      await db.query(`insert into faolla_checkout_design.${table}(site_id,enabled) values($1,true) on conflict(site_id) do update set enabled=true`, [cartSite]);
    for (const row of [...f.snapshot.sourceRows, ...f.snapshot.domainRows]) {
      const existing = await one(db, 'select id from pages where merchant_id is not distinct from $1 and slug=$2', [row.merchant_id, row.slug]);
      if (existing) await db.query('update pages set blocks=$2 where id=$1', [existing.id, JSON.stringify(row.blocks)]);
      else await db.query('insert into pages(id,merchant_id,slug,blocks) values($1,$2,$3,$4)', [row.id, row.merchant_id, row.slug, JSON.stringify(row.blocks)]);
    }
    let version = (await one(db, 'select public.faolla_member_checkout_catalog_snapshot_v1($1) result', [cartSite])).result.version;
    for (let i = 0; i < f.offers.length; i++) {
      const previous = await one(db, 'select v.offer_id from faolla_checkout_design.offer_heads h join faolla_checkout_design.offer_versions v using(site_id,offer_id,revision) where h.site_id=$1 and v.source_key=$2', [cartSite, f.offers[i].checkoutBinding.sourceKey]);
      if (previous) { f.offers[i].id = previous.offer_id; f.request.lines[i].offerId = previous.offer_id; }
      const next = randomUUID(); await db.query('select public.faolla_member_checkout_catalog_save_v1($1,$2,$3,$4,$5)', [cartSite, version, next, 'owner:synthetic-owner', f.offers[i]]); version = next;
      f.request.lines[i].couponClaims = [{ couponId: f.coupons[i].id, claimEventId: f.coupons[i].claimEvents[0].id }];
    }
    const request = { ...f.request, nonce: randomUUID(), confirmationHash: '0'.repeat(64), customer: { name: 'Synthetic', title: '', email: 'synthetic@example.invalid', phone: '000', note: '' } };
    const cartRpc = async (name, values) => {
      const names = { faolla_member_checkout_cart_submission_snapshot_v1: ['p_site_id', 'p_operation_key', 'p_principal_key', 'p_request_hash', 'p_quote_request_hash', 'p_offer_ids'],
        faolla_member_checkout_cart_commit_v1: ['p_site_id', 'p_operation_key', 'p_principal_key', 'p_request_hash', 'p_snapshot', 'p_plan', 'p_not_after'] };
      const list = names[name]; assert.ok(list, name);
      try { return { data: (await one(db, `select public.${name}(${list.map((_, i) => '$' + (i + 1)).join(',')}) result`, list.map(k => k === 'p_offer_ids' ? JSON.stringify(values[k]) : values[k]))).result, error: null }; }
      catch (error) { return { data: null, error: { message: error.message } }; }
    };
    const submitInput = { request, principal: f.principal, authorize: async () => f.principal, enabled: () => true };
    if (method === 'on_site') {
      // Existing cash policy forbids stacking two amount coupons across lines.
      // Keep that rejection, then use one valid coupon for the actual late write.
      const before = await state(); await assert.rejects(cartService.previewCartSubmission(submitInput, cartRpc), /checkout_coupon_stack_not_allowed/); assert.deepEqual(await state(), before);
      request.lines[1].couponClaims = [];
    }
    const preview = await cartService.previewCartSubmission(submitInput, cartRpc);
    assert.equal(preview.quote.lines.length, 2); assert.equal(preview.quote.couponCount, method === 'points' ? 2 : 1);
    if (method === 'points') assert.equal(preview.quote.duePoints, 160); else assert.equal(preview.quote.dueMinor, 2300);
    request.confirmationHash = preview.confirmationHash;
    let held;
    await assert.rejects(cartService.submitCartCheckout(submitInput, async (name, values, signal) => {
      if (name === 'faolla_member_checkout_cart_commit_v1') { held = structuredClone(values); throw Error('synthetic held cart commit'); }
      return cartRpc(name, values, signal);
    }), /checkout_unconfirmed/); assert.ok(held);
    const call = close => unusedHttp.handleUnusedCheckoutReference(close, requestFor(f, '/api/member-checkout/intent/test', { siteId: cartSite, nonce: request.nonce, ...(close ? { reviewHash: hash } : {}) }), { enabled: () => true, session: sessionFor(f), call: rpc });
    const before = await state(), review = (await decode(await call(false))).review, hash = review.reviewHash;
    assert.equal(review.state, 'unused'); assert.deepEqual(await state(), before);
    const closure = (await decode(await call(true))).closure; assert.equal(closure.closed, true);
    const closed = await state(); unchangedExceptMarkers(before, closed);
    const late = await cartRpc('faolla_member_checkout_cart_commit_v1', held); assert.equal(late.error.message, 'checkout_reference_closed'); assert.deepEqual(await state(), closed);
  });
}
