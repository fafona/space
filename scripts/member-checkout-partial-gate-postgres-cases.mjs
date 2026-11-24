// Actual merchant PATCH -> compatibility bridge -> order updater -> original
// CAS, in the parent-owned TEMP cluster only. Auth and shadow IO are synthetic.
import assert from 'node:assert/strict';
import boundary from '../src/lib/merchantCheckoutLegacyBoundary.server.ts';
import orders from '../src/lib/merchantOrders.ts';
import updater from '../src/lib/merchantOrders.server.ts';
import route from '../src/app/api/orders/route-handler.ts';
import reporting from '../src/lib/merchantCheckoutReporting.ts';

export async function partialGateOrderCases(t, { db, one, state, original, result }) {
  const siteId = original.siteId, refs = [{ kind: 'order', id: result.resourceId }];
  const earlier = (await one(db, 'select public.faolla_member_checkout_reporting_v1($1,$2) result', [siteId, JSON.stringify(refs)])).result;
  if (result.method === 'on_site') assert.throws(() => reporting.parseCheckoutReportingSnapshot(earlier, { siteId, resources: refs }), /checkout_invalid_response/);
  else {
    const lossy = reporting.parseCheckoutReportingSnapshot(earlier, { siteId, resources: refs });
    assert.equal(lossy.version, 1); assert.equal(lossy.rows[0].cart, undefined); assert.equal(lossy.rows[0].result.totalPoints, result.totalPoints);
  }
  const actor = { type: 'owner', siteId, authUserId: 'synthetic-owner', principalKey: 'owner:synthetic-owner', authorizationVersion: 'owner',
    displayName: 'Synthetic', email: 'synthetic@example.invalid', authorizationSource: 'database', businessPermissions: [], collaborationPermissions: [] };
  const sourceRows = async () => (await db.query('select id,slug,blocks,updated_at from public.pages where merchant_id=$1 and (slug=$2 or slug~$3) order by slug,id', [siteId, `__merchant_orders__:${siteId}`, `^__merchant_orders__:${siteId}:chunk:[0-9]+$`])).rows;
  const records = rows => { const chunks = rows.filter(r => r.slug.includes(':chunk:')); return (chunks.length ? chunks : rows).flatMap(r => r.blocks); };
  const before = await state();
  for (const base of [false, true]) for (const cash of [false, true]) for (const cart of [false, true]) await t.test(`${result.method} merchant completion base=${base},cash=${cash},cart=${cart} preserves finance and immutable cart`, async () => {
    const calls = [], writes = [], mirrors = [];
    const dispatch = async (name, args) => {
      const keys = {
        faolla_checkout_cart_resource_link_v1: ['p_site_id', 'p_id'], faolla_member_checkout_reporting_v3: ['p_site_id', 'p_resources'],
        faolla_member_checkout_reporting_v1: ['p_site_id', 'p_resources'], faolla_member_checkout_reporting_v2: ['p_site_id', 'p_resources'],
        faolla_commit_order_membership_v1: ['p_site_id', 'p_mutation'],
      }[name]; assert.ok(keys, name); calls.push(name);
      if (name === 'faolla_commit_order_membership_v1') { writes.push(args.p_mutation); assert.equal(args.p_mutation.memberships, undefined); }
      try { return { data: (await one(db, `select public.${name}(${keys.map((_, i) => '$' + (i + 1)).join(',')}) result`, keys.map(k => k === 'p_resources' ? JSON.stringify(args[k]) : args[k]))).result, error: null }; }
      catch (error) { return { data: null, error: { message: error.message } }; }
    };
    const gates = { enabled: () => base, cashEnabled: () => base && cash, cartEnabled: () => base && cart, intentEnabled: () => false, rpc: () => dispatch };
    const client = { from: () => { throw Error('no raw page writes'); }, rpc: dispatch };
    const deps = {
      createClient: () => client,
      loadOrders: async () => { const rows = await sourceRows(); return { siteId, orders: orders.normalizeMerchantOrderRecords(records(rows)), storageRows: rows, updatedAt: null }; },
      pointTransitions: (transitions, _overrides, rows) => boundary.legacyCheckoutPointTransitions(transitions, gates, rows),
      prepareMemberships: async () => { throw Error('no legacy reward or reversal for an original'); },
      saveOrders: (c, input) => boundary.saveCheckoutAwareMerchantOrders(c, input, gates),
      mirrorMemberships: async () => { throw Error('no membership shadow write'); },
      mirrorOrders: async () => { mirrors.push('order'); return { status: 'disabled', count: 0 }; },
    };
    await db.query('begin');
    try {
      await db.query('update faolla_checkout_design.bundle_pilots set enabled=$2 where site_id=$1', [siteId, base]);
      for (const table of ['cart_quote_pilots', 'cart_submission_pilots']) await db.query(`update faolla_checkout_design.${table} set enabled=$2 where site_id=$1`, [siteId, base && cart]);
      await db.query('update faolla_checkout_design.intent_pilots set enabled=false where site_id=$1', [siteId]);
      const protectedBefore = await state(), stored = records(await sourceRows()), target = stored.find(r => r.id === result.resourceId);
      const origin = 'https://partial-gate-pg.synthetic.invalid', request = new Request(origin + '/api/orders', { method: 'PATCH', headers: { origin, 'content-type': 'application/json' },
        body: JSON.stringify({ siteId, ...(cash ? { orderIds: [result.resourceId] } : { orderId: result.resourceId }), status: 'completed' }) });
      const response = await route.handleMerchantOrderPatch(request, {
        resolveAdminSession: async () => ({ merchantId: siteId, actor, assertAuthorizationCurrent: async () => {} }), isManagementEnabled: async () => true,
        checkoutBridge: input => boundary.bridgeLegacyCheckoutMutation(input, { ...gates, actor: async () => actor, cartSite: async () => original.site }),
        updateOrder: input => updater.updateMerchantOrderBySite(input, deps), updateOrdersBatch: input => updater.updateMerchantOrdersBatchBySite(input, deps),
      });
      const body = await response.json(); assert.equal(response.status, 200, JSON.stringify(body)); assert.equal((body.order ?? body.orders[0]).status, 'completed');
      assert.ok(!/checkoutOperationKey|pointTransaction|couponClaims|PRIVATE/.test(JSON.stringify(body)));
      // Validate deferred enforcement too, not only a write that would fail at COMMIT.
      await db.query('set constraints all immediate');
      const after = await state(), saved = records(await sourceRows()), next = saved.find(r => r.id === result.resourceId);
      assert.equal(writes.length, 1); assert.deepEqual(mirrors, ['order']); assert.equal(next.status, 'completed'); assert.deepEqual(next.items, target.items);
      assert.equal(next.checkoutOperationKey, target.checkoutOperationKey); assert.equal(next.totalAmount, target.totalAmount); assert.equal(next.totalQuantity, target.totalQuantity);
      assert.deepEqual(saved.filter(r => r.id !== result.resourceId), stored.filter(r => r.id !== result.resourceId));
      for (const [table, rows] of Object.entries(protectedBefore)) {
        if (table === 'public.pages') continue; assert.deepEqual(after[table], rows, table);
      }
      const finance = rows => rows.filter(({ r }) => !r.slug.startsWith(`__merchant_orders__:${siteId}`) && !r.slug.startsWith(`__merchant_orders_history_v2__:${siteId}`) && !r.slug.startsWith(`__merchant_orders_history_backup_v2__:${siteId}`));
      assert.deepEqual(finance(after['public.pages']), finance(protectedBefore['public.pages']));
      assert.ok(calls.every(name => /reporting|resource_link|^faolla_commit_order_membership_v1$/.test(name)));
    } finally { await db.query('rollback'); }
    assert.deepEqual(await state(), before);
  });
}
