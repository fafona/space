// NEW owned loopback TEMP PostgreSQL only; never loads .env or contacts services.
// Actual single controllers -> HTTP handlers -> trusted planners -> booking SQL.
// Identity is synthetic/injected; this is not live Next/PostgREST or phone QA.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, mkdtemp } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import membership from '../src/lib/merchantMemberships.ts';
import settings from '../src/lib/merchantMembershipSettings.ts';
import coupons from '../src/lib/merchantCoupons.ts';
import bookingTime from '../src/lib/merchantBookingTime.ts';
import bookingRules from '../src/lib/merchantBookingRules.ts';
import workbench from '../src/lib/merchantBookingWorkbench.ts';
import platformControl from '../src/data/platformControlStore.ts';
import platformSnapshot from '../src/lib/platformMerchantSnapshot.ts';
import sources from '../src/lib/merchantCheckoutSources.server.ts';
import pointsPlan from '../src/lib/merchantCheckoutSubmissionPlan.server.ts';
import singleHttp from '../src/app/api/member-checkout/single/route-handler.ts';
import singleClient from '../src/lib/merchantCheckoutSingleIntentClient.ts';
import commonClient from '../src/lib/merchantCheckoutClient.ts';
import cartHttp from '../src/lib/merchantCheckoutCartHttp.server.ts';
import intentHttp from '../src/lib/merchantCheckoutIntentHttp.server.ts';
import resultHttp from '../src/app/api/member-checkout/result/route-handler.ts';
import { checkoutCompatibilityCases } from './member-checkout-compatibility-postgres-cases.mjs';
import resultService from '../src/lib/merchantMemberCheckoutResult.server.ts';
import cashHttp from '../src/lib/merchantCheckoutOnSiteHttp.server.ts';
import { unusedReferenceCases } from './member-checkout-unused-reference-postgres-cases.mjs';
import { boundCheckoutCases } from './member-checkout-bound-postgres-cases.mjs';
import { originalServiceCases } from './member-checkout-original-service-postgres-cases.mjs';

test('owned booking intent lifecycle preserves coupons, points, slots and exact originals', { timeout: 120000 }, async t => {
  const runtime = path.resolve(process.env.FAOLLA_BOOKING_TEST_RUNTIME_DIR || '.missing-test-runtime');
  const relative = path.relative(tmpdir(), runtime);
  assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative) && path.basename(runtime).startsWith('faolla-booking-pg-'));
  const requireTest = createRequire(path.join(runtime, 'test-loader.cjs'));
  const pgRoot = path.join(runtime, 'node_modules/@embedded-postgres/windows-x64');
  assert.equal(JSON.parse(await readFile(path.join(pgRoot, 'package.json'), 'utf8')).version, '17.10.0-beta.17');
  assert.equal(JSON.parse(await readFile(path.join(runtime, 'node_modules/pg/package.json'), 'utf8')).version, '8.23.1');
  const { Client } = requireTest('pg');
  const binaries = await import(pathToFileURL(path.join(pgRoot, 'dist/index.js')).href), exec = promisify(execFile);
  const evidence = await mkdtemp(path.join(tmpdir(), 'faolla-checkout-booking-intent-test-')), cluster = path.join(evidence, 'cluster');
  const socket = net.createServer();
  await new Promise((resolve, reject) => { socket.once('error', reject); socket.listen(0, '127.0.0.1', resolve); });
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  const clients = []; let started = false;
  const one = async (c, sql, args = []) => (await c.query(sql, args)).rows[0];
  const site = '10909992', origin = 'https://booking-intent-pg.synthetic.invalid';
  const memberSlug = `__merchant_memberships__:${site}`, settingsSlug = `__merchant_membership_settings__:${site}`, couponSlug = `__merchant_coupons__:${site}`;
  try {
    await exec(binaries.initdb, ['-D', cluster, '-U', 'booking_intent_admin', '-A', 'trust', '--encoding=UTF8', '--locale=C'], { windowsHide: true, timeout: 60000 });
    await exec(binaries.pg_ctl, ['-D', cluster, '-l', path.join(evidence, 'postgres.log'), '-w', '-t', '30', '-o', `-h 127.0.0.1 -p ${port} -c shared_buffers=16MB -c max_connections=12`, 'start'], { windowsHide: true, timeout: 45000 });
    started = true;
    const connection = { host: '127.0.0.1', port, user: 'booking_intent_admin', database: 'postgres', password: '', ssl: false,
      connectionTimeoutMillis: 5000, statement_timeout: 15000, query_timeout: 20000, application_name: 'faolla-booking-intent-isolated' };
    const db = new Client(connection), peer = new Client(connection);
    await db.connect(); clients.push(db);
    await peer.connect(); clients.push(peer);
    assert.equal(path.resolve((await one(db, 'show data_directory')).data_directory).toLowerCase(), path.resolve(cluster).toLowerCase());
    await db.query(`create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;
      create table public.pages(id uuid primary key default gen_random_uuid(),merchant_id text,slug text,blocks jsonb,updated_at timestamptz default clock_timestamp());
      create table public.faolla_schema_migrations(version bigint primary key,name text not null);
      grant usage on schema public to anon,authenticated,service_role;grant select,insert,update,delete on pages to service_role;
      create function public.set_pages_updated_at() returns trigger language plpgsql as $$begin new.updated_at=now();return new;end;$$;
      create trigger set_pages_updated_at before update on pages for each row execute function public.set_pages_updated_at();`);
    await db.query('insert into pages(merchant_id,slug,blocks) values($1,$2,$3)', ['__faolla_booking_persistence__', '__merchant_booking_records__:v1', { version: 1, records: [] }]);
    const migrations = ['202609080045_order_membership_atomic_mutation', '202609080046_redemption_atomic_mutation', '202610250211_booking_atomic_preparation',
      '202610250212_booking_atomic_runtime', '202611050213_booking_atomic_safeupdate_singleton'];
    for (const name of migrations) await db.query(await readFile(path.resolve(`scripts/supabase-migrations/${name}.sql`), 'utf8'));
    const oldDefinitions = async () => (await db.query("select p.oid::regprocedure::text name,pg_get_functiondef(p.oid) definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f' and (p.proname like 'faolla_booking_atomic_%' or p.proname in ('faolla_commit_redemption_v1','faolla_commit_order_membership_v1')) order by name")).rows;
    const baseline = await oldDefinitions();
    for (const name of ['20261122_member_checkout_design', '20261122_member_checkout_catalog', '20261122_member_checkout_bundle', '20261122_member_checkout_cancellation',
      '20261122_member_checkout_queries', '20261123_member_checkout_legacy_boundary', '20261123_member_checkout_on_site_pending', '20261123_member_checkout_on_site_cancellation',
      '20261122_member_checkout_submission', '20261123_member_checkout_on_site_submission', '20261123_member_checkout_reporting', '20261123_member_checkout_presentation',
      '20261123_member_checkout_on_site_management', '20261123_member_checkout_cart_quote', '20261123_member_checkout_cart_collection', '20261123_member_checkout_cart_submission',
      '20261123_member_checkout_cart_cancellation', '20261123_member_checkout_cart_presentation', '20261123_member_checkout_pending_intents', '20261123_member_checkout_intent_review',
      '20261124_member_checkout_history_original', '20261124_member_checkout_legacy_review', '20261124_member_checkout_retained_intent', '20261124_member_checkout_history_inventory',
      '20261124_member_checkout_legacy_order_rewards', '20261123_member_checkout_legacy_order_intent', '20261123_member_checkout_legacy_booking_intent', '20261123_member_checkout_closed_gate_creation'])
      await db.query(await readFile(path.resolve(`database/proposals/${name}.sql`), 'utf8'));
    // The new actual merchant PATCH cases need the already-existing private
    // cart resource lookup. This installs no production SQL or API-role grant.
    await db.query(await readFile(path.resolve('database/proposals/20261123_member_checkout_cart_management.sql'), 'utf8'));
    await db.query(await readFile(path.resolve('database/proposals/20261124_member_checkout_unused_reference.sql'), 'utf8'));
    await db.query(await readFile(path.resolve('database/proposals/20261124_member_checkout_original_service.sql'), 'utf8'));
    // Full private protocol inventory also requires the existing customer cart
    // lookup, previously absent from this specific owned TEMP installation.
    await db.query(await readFile(path.resolve('database/proposals/20261123_member_checkout_cart_personal_boundary.sql'), 'utf8'));
    assert.deepEqual(await oldDefinitions(), baseline);
    await checkoutCompatibilityCases(t, { db });
    for (const table of ['bundle_pilots', 'intent_pilots']) {
      assert.equal((await one(db, `select count(*)::int n from faolla_checkout_design.${table} where enabled`)).n, 0);
      await db.query(`insert into faolla_checkout_design.${table}(site_id,enabled) values($1,true)`, [site]);
    }
    await db.query('update public.faolla_booking_atomic_control set active=true where singleton');
    const page = slug => one(db, 'select *,updated_at::text stamp from public.pages where slug=$1', [slug]);
    const savePage = async (merchant, slug, value) => {
      const found = await one(db, 'select id from public.pages where merchant_id is not distinct from $1 and slug=$2', [merchant, slug]);
      if (found) await db.query('update public.pages set blocks=$2 where id=$1', [found.id, JSON.stringify(value)]);
      else await db.query('insert into public.pages(merchant_id,slug,blocks) values($1,$2,$3)', [merchant, slug, JSON.stringify(value)]);
    };
    const state = async () => {
      const value = {};
      for (const row of (await db.query("select schemaname,tablename from pg_tables where schemaname in ('public','faolla_checkout_design') order by schemaname,tablename")).rows) {
        assert.match(row.tablename, /^[a-z0-9_]+$/);
        value[`${row.schemaname}.${row.tablename}`] = (await db.query(`select to_jsonb(t) r from ${row.schemaname}.${row.tablename} t order by to_jsonb(t)::text`)).rows;
      }
      return value;
    };
    let index = 0;
    const seed = async (method, returns) => {
      const at = new Date().toISOString(), principal = { accountId: String(57000000 + (++index)), userId: `booking-intent-synthetic-${index}` };
      const blockId = `booking-${randomUUID()}`, appointmentAt = `${bookingTime.bookingWallTimeAt(new Date(Date.now() + 3 * 86400000), 'Europe/Madrid').slice(0, 10)}T12:00`;
      const blocks = [{ id: blockId, type: 'booking', props: { bookingStoreOptions: [`Synthetic ${index}`], bookingItemOptions: ['Play'], bookingTitleOptions: ['Mx'], bookingTimeSlotRules: [{ timeRange: '10:00-18:00', maxBookings: 1 }] } }];
      const source = sources.buildCheckoutSourceChoices({ siteId: site, siteName: 'Synthetic', blocks, catalog: null, allowBooking: true, allowOrder: false })[0]; assert.ok(source);
      const permissionConfig = { ...platformControl.createDefaultMerchantPermissionConfig(), allowBookingBlock: true, allowMembershipManagement: true, allowPointsRedemption: true, allowCouponModule: true, allowBookingAutoEmail: false };
      const siteView = platformSnapshot.buildPlatformMerchantSnapshotSite({ id: site, name: 'Synthetic', status: 'online', serviceExpiresAt: '2099-01-01T00:00:00Z', permissionConfig }); assert.ok(siteView);
      await savePage(null, '__platform_merchant_snapshot__', platformSnapshot.buildPlatformMerchantSnapshotBlocks(platformSnapshot.normalizePlatformMerchantSnapshotPayload({ revision: randomUUID(), snapshot: [siteView], defaultSortRule: 'created_desc', merchantConfigHistoryBySiteId: {} })));
      await savePage(site, 'booking-intent-synthetic-public', blocks);
      for (const [key, property, value] of [['rules', 'snapshots', bookingRules.buildMerchantBookingRulesSnapshot(site, blocks, at)], ['workbench', 'settingsBySiteId', { ...workbench.createDefaultMerchantBookingWorkbenchSettings(), timeZone: 'Europe/Madrid' }]]) {
        const slug = key === 'rules' ? '__merchant_booking_rules__:v1' : '__merchant_booking_workbench__:v1';
        const current = (await page(slug))?.blocks ?? { version: 1, [property]: {} };
        await db.query('select public.faolla_booking_atomic_configuration_v2($1,$2,$3)', [site, key, { ...current, [property]: { ...current[property], [site]: value } }]);
      }
      const member = membership.normalizeMerchantMembershipRecord({ id: `member-${index}`, siteId: site, ...principal, status: 'active', pointBalance: 1000, balanceAmount: 33, growthValue: 0, joinedAt: at, updatedAt: at }); assert.ok(member);
      await savePage(site, memberSlug, [...((await page(memberSlug))?.blocks ?? []), member]);
      const config = settings.createEmptyMerchantMembershipSettings(site);
      config.redemptionItems = [{ id: 'booking-stock', categoryId: '', code: 'S', barcode: '', name: 'Synthetic', imageUrl: '', iconName: '', description: '', enabled: true, pointsCost: 100, referenceAmount: null, memberPrice: null, taxRate: null, stock: 10, pointProduct: true, recommended: false, sort: 0 }];
      await savePage(site, settingsSlug, config);
      const coupon = coupons.normalizeMerchantCouponRecord({ id: `coupon-${randomUUID()}`, siteId: site, code: `CO${randomUUID().replaceAll('-', '').slice(0, 16)}`, title: 'Synthetic booking coupon', status: 'active',
        discountType: method === 'points' ? 'points_voucher' : 'amount_off', discountValue: method === 'points' ? 20 : 2, usageScenarios: [method === 'points' ? 'points_redemption' : 'order_cart'], createdAt: at, updatedAt: at,
        claimEvents: [{ id: `claim-${randomUUID()}`, at, ...principal, email: 'synthetic@example.invalid', customerName: 'Synthetic', code: '', settlementType: 'qr', settlementCode: `PRIVATE-${randomUUID()}`, validUntil: '2036-01-01T00:00:00.000Z' }] }); assert.ok(coupon);
      await savePage(site, couponSlug, [...((await page(couponSlug))?.blocks ?? []), coupon]);
      const offer = { version: 1, id: randomUUID(), revision: randomUUID(), siteId: site, enabled: true, title: 'Synthetic booking', maxQuantity: 1,
        source: { kind: 'booking', blockId, serviceId: randomUUID(), timeZone: 'Europe/Madrid' }, cash: { currency: 'eur', unitAmountMinor: 1000, initialPolicy: { mode: 'full' } }, unitPoints: 100, allowOnSite: true, couponReturnOnCancel: returns,
        checkoutBinding: { sourceKey: source.key, sourceVersion: source.sourceVersion, viewport: source.viewport, store: source.store, item: source.item, stockItemId: 'booking-stock', voucherCouponIds: [], durationMinutes: 60, pointsReturnOnCancel: returns, cancellationAdvanceMinutes: 60 } };
      const current = (await one(db, 'select public.faolla_member_checkout_catalog_snapshot_v1($1) result', [site])).result;
      await db.query('select public.faolla_member_checkout_catalog_save_v1($1,$2,$3,$4,$5)', [site, current.version, randomUUID(), 'owner:synthetic-owner', offer]);
      return { method, returns, principal, member, offer, coupon, appointmentAt,
        selection: { siteId: site, offerId: offer.id, offerRevision: offer.revision, quantity: 1, appointmentAt, couponClaims: [{ couponId: coupon.id, claimEventId: coupon.claimEvents[0].id }] },
        customer: { name: 'Synthetic', title: 'Mx', email: 'synthetic@example.invalid', phone: '000000000', note: 'Preserved booking note' } };
    };
    const keys = {
      faolla_member_checkout_submission_snapshot_v2: ['p_site_id', 'p_operation_key', 'p_principal_key', 'p_request_hash', 'p_offer_id'],
      faolla_member_checkout_on_site_snapshot_v1: ['p_site_id', 'p_operation_key', 'p_principal_key', 'p_request_hash', 'p_offer_id'],
      faolla_member_checkout_submission_commit_v2: ['p_site_id', 'p_operation_key', 'p_principal_key', 'p_request_hash', 'p_snapshot', 'p_plan', 'p_not_after'],
      faolla_member_checkout_on_site_commit_v1: ['p_site_id', 'p_operation_key', 'p_principal_key', 'p_request_hash', 'p_snapshot', 'p_plan', 'p_not_after'],
      faolla_member_checkout_cart_result_v1: ['p_site_id', 'p_operation_key', 'p_principal_key'],
      faolla_member_checkout_original_result_v1: ['p_site_id', 'p_operation_key', 'p_principal_key'],
      faolla_member_checkout_intent_review_v1: ['p_site_id', 'p_operation_key', 'p_principal_key'],
      faolla_member_checkout_pending_intent_v1: ['p_site_id', 'p_principal_key'],
      faolla_member_checkout_acknowledge_intent_v1: ['p_site_id', 'p_operation_key', 'p_principal_key', 'p_generation', 'p_review_hash', 'p_not_after'],
      faolla_member_checkout_result_v2: ['p_site_id', 'p_operation_key', 'p_principal_key'],
      faolla_member_checkout_cancel_v2: ['p_site_id', 'p_operation_key', 'p_principal_key', 'p_expected_updated_at'],
      faolla_member_checkout_on_site_result_v1: ['p_site_id', 'p_operation_key', 'p_principal_key'],
      faolla_member_checkout_on_site_cancel_v1: ['p_site_id', 'p_operation_key', 'p_principal_key', 'p_expected_updated_at'],
      faolla_member_checkout_unused_reference_review_v1: ['p_site_id', 'p_operation_key', 'p_principal_key'],
      faolla_member_checkout_close_unused_reference_v1: ['p_site_id', 'p_operation_key', 'p_principal_key', 'p_review_hash', 'p_not_after'],
      faolla_member_checkout_original_service_review_v1: ['p_site_id', 'p_operation_key', 'p_principal_key'],
      faolla_member_checkout_original_service_cancel_v1: ['p_site_id', 'p_operation_key', 'p_principal_key', 'p_review_hash', 'p_expected_updated_at', 'p_not_after'],
    };
    const calls = [];
    const rpc = async (name, args, signal) => {
      assert.ok(keys[name], `unexpected private RPC ${name}`); if (signal) assert.equal(signal.aborted, false);
      calls.push(name);
      try { return { data: (await one(db, `select public.${name}(${keys[name].map((_, i) => '$' + (i + 1)).join(',')}) result`, keys[name].map(k => args[k]))).result, error: null }; }
      catch (error) { return { data: null, error: { message: error.message } }; }
    };
    const requestFor = (f, route, body, signal) => new Request(origin + route, { method: 'POST', headers: { origin, 'content-type': 'application/json', 'x-checkout-account-scope': f.principal.accountId }, body: JSON.stringify(body), signal });
    const sessionFor = f => async () => ({ ...f.principal, servicePaused: false, user: { email_confirmed_at: '2026-01-01T00:00:00.000Z' } });
    const decode = async response => { const value = await response.json(); assert.equal(response.status, 200, JSON.stringify(value)); return value; };

    for (const method of ['points', 'on_site']) for (const returns of [true, false]) {
      await t.test(`${method}: booking/coupon original survives lost acknowledgement and reopen; frozen return=${returns}`, async () => {
        const f = await seed(method, returns), session = sessionFor(f), paths = [];
        let dropSubmit = true, recoveryBlocked = false;
        const transport = async (route, body, signal) => {
          paths.push(route);
          if (recoveryBlocked && !route.endsWith('/submit')) throw new commonClient.CheckoutClientError('checkout_unconfirmed', 503);
          const request = requestFor(f, route, body, signal), deps = { enabled: () => true, intentEnabled: () => true, session, call: rpc };
          let response;
          if (/\/(?:preview|submit)$/.test(route)) response = await singleHttp.handleSingleIntentCheckout(method === 'points' ? 'points' : 'on-site', route.split('/').at(-1), request, { ...deps, cashEnabled: () => true,
            pointsPreview: { preview: async input => {
              const who = await input.authorize(); assert.deepEqual(who, f.principal);
              const identity = pointsPlan.checkoutSubmissionIdentity({ ...input.request, method: 'points', nonce: randomUUID(), confirmationHash: '0'.repeat(64), customer: f.customer }, who);
              const read = await rpc('faolla_member_checkout_submission_snapshot_v2', { p_site_id: site, p_operation_key: identity.operationKey, p_principal_key: identity.principalKey, p_request_hash: identity.requestHash, p_offer_id: f.offer.id }, signal);
              assert.equal(read.error, null); return pointsPlan.quoteCheckoutSubmissionSnapshot(pointsPlan.parseCheckoutSubmissionSnapshot(read.data.snapshot, identity), identity, who);
            } } });
          else if (route.endsWith('/cart/recover')) response = await cartHttp.handleCartCheckout('recover', request, deps);
          else response = await intentHttp.handleCheckoutIntent(route.endsWith('/pending') ? 'pending' : route.endsWith('/acknowledge') ? 'acknowledge' : 'review', request, deps);
          const value = await response.json();
          if (!response.ok) throw new commonClient.CheckoutClientError(value.error, response.status);
          if (dropSubmit && route.endsWith('/submit')) { dropSubmit = false; recoveryBlocked = true; throw new commonClient.CheckoutClientError('checkout_unconfirmed', 503); }
          return value;
        };
        const storageKey = commonClient.checkoutClientStorageKey(site, f.principal.accountId), store = new Map([['opaque-host-form', 'UNCHANGED contact and draft'], ['opaque-host-cart', 'UNCHANGED items and member']]);
        const options = { siteId: site, accountId: f.principal.accountId, request: transport, randomNonce: randomUUID,
          storage: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k) }, exclusive: async (_key, run) => { await run(); return true; } };
        const make = method === 'points' ? singleClient.createIntentPointsCheckoutController : singleClient.createIntentOnSiteCheckoutController;
        let c = make(options);
        try {
          await c.activate(); const beforePreview = await state(), bookingBefore = (await page('__merchant_booking_records__:v1')).blocks.records;
          const membersBefore = (await page(memberSlug)).blocks;
          if (method === 'points') await c.preview(f.selection); else await c.preview(f.selection, f.customer);
          assert.equal(c.getSnapshot().phase, 'ready', JSON.stringify(c.getSnapshot())); assert.deepEqual(await state(), beforePreview);
          const start = calls.length;
          await Promise.all([c.submit(f.customer), c.submit(f.customer)]);
          assert.equal(paths.filter(p => p.endsWith('/submit')).length, 1); assert.equal(c.getSnapshot().pending, true); assert.ok(store.has(storageKey));
          assert.equal(c.getSnapshot().phase, 'unconfirmed');
          assert.equal(calls.slice(start).filter(n => /(?:submission_commit_v2|on_site_commit_v1)$/.test(n)).length, 1);
          const committed = await state(); recoveryBlocked = false; await c.recover();
          assert.deepEqual(await state(), committed);
          const original = c.getSnapshot().originalReview; assert.equal(original.kind, 'single'); assert.equal(original.original.method, method);
          const receipt = original.original.result, operationKey = receipt.operationKey;
          const resourceId = method === 'points' ? receipt.resourceId : receipt.terms.resourceId;
          assert.ok(!/PRIVATE-|memberId|booking-intent-synthetic|editToken|sourceRows|principalKey/.test(JSON.stringify(original)));
          const records = (await page('__merchant_booking_records__:v1')).blocks.records, record = records.find(r => r.id === resourceId); assert.ok(record);
          assert.equal(records.length, bookingBefore.length + 1); assert.deepEqual(records.filter(r => r.id !== resourceId), bookingBefore);
          assert.equal((await one(db, 'select count(*)::int n from faolla_checkout_design.bundle_results where site_id=$1 and operation_key=$2', [site, operationKey])).n, 1);
          assert.equal((await one(db, 'select count(*)::int n from faolla_checkout_design.intent_claims where site_id=$1 and operation_key=$2', [site, operationKey])).n, 1);
          assert.equal(record.appointmentTimeZone, 'Europe/Madrid'); assert.equal(record.appointmentAt, f.appointmentAt); assert.equal(record.note, f.customer.note);
          const memberAfter = (await page(memberSlug)).blocks.find(m => m.id === f.member.id);
          assert.equal(memberAfter.pointBalance, method === 'points' ? 920 : 1000); assert.equal(memberAfter.balanceAmount, 33);
          assert.deepEqual((await page(memberSlug)).blocks.filter(m => m.id !== f.member.id), membersBefore.filter(m => m.id !== f.member.id));
          if (method === 'on_site') assert.deepEqual(memberAfter, f.member);
          assert.equal((await page(settingsSlug)).blocks.redemptionItems[0].stock, 9);
          assert.equal((await page(couponSlug)).blocks.find(v => v.id === f.coupon.id).redeemEvents.length, 1);
          if (method === 'points') assert.equal(receipt.totalPoints, 80);
          else { assert.equal(receipt.terms.dueMinor, 800); assert.equal(receipt.terms.capturedMinor, 0); assert.equal(receipt.terms.paymentState, 'unpaid'); }
          c.deactivate(); c = make(options); const beforeReopen = await state(); await c.activate();
          assert.equal(c.getSnapshot().originalReview.kind, 'single'); assert.deepEqual(await state(), beforeReopen);
          assert.equal(paths.filter(p => p.endsWith('/submit')).length, 1);
          // Editing today's offer cannot rewrite the ORIGINAL cancellation policy.
          const catalog = (await one(db, 'select public.faolla_member_checkout_catalog_snapshot_v1($1) result', [site])).result;
          await db.query('select public.faolla_member_checkout_catalog_save_v1($1,$2,$3,$4,$5)', [site, catalog.version, randomUUID(), 'owner:synthetic-owner', { ...f.offer, revision: randomUUID(), couponReturnOnCancel: !returns, checkoutBinding: { ...f.offer.checkoutBinding, pointsReturnOnCancel: !returns } }]);
          const cancelBody = { siteId: site, operationKey, expectedUpdatedAt: record.updatedAt };
          const cancel = async () => method === 'points'
            ? resultHttp.handleMemberCheckoutResult(requestFor(f, '/api/member-checkout/result', cancelBody), { enabled: () => true, session, read: input => resultService.readMemberCheckoutResult(input, rpc), cancel: input => resultService.cancelMemberCheckout(input, rpc) })
            : cashHttp.handleOnSiteCheckout('cancel', requestFor(f, '/api/member-checkout/on-site/cancel', cancelBody), { enabled: () => true, session, call: rpc });
          const cancelled = await decode(await cancel()); assert.equal(cancelled.replayed, false);
          assert.equal(cancelled.cancellation.pointsReturned, method === 'points' && returns ? 80 : 0);
          assert.equal(cancelled.cancellation.couponsReturned, returns ? 1 : 0); assert.equal(cancelled.cancellation.stockReleased, 1);
          if (method === 'on_site') assert.equal(cancelled.cancellation.cashReturnedMinor, 0);
          const afterCancel = await state(), replay = await decode(await cancel()); assert.equal(replay.replayed, true); assert.deepEqual(await state(), afterCancel);
          assert.equal((await page(memberSlug)).blocks.find(m => m.id === f.member.id).pointBalance, method === 'points' && !returns ? 920 : 1000);
          assert.equal((await page(settingsSlug)).blocks.redemptionItems[0].stock, 10);
          const couponAfter = (await page(couponSlug)).blocks.find(v => v.id === f.coupon.id);
          assert.equal(couponAfter.claimEvents[0].validUntil, f.coupon.claimEvents[0].validUntil);
          assert.equal(couponAfter.redeemEvents.length, returns ? 0 : 1);
          assert.equal((await page('__merchant_booking_records__:v1')).blocks.records.find(r => r.id === resourceId).status, 'cancelled');
          const returnCount = (await one(db, 'select count(*)::int n from faolla_checkout_design.bundle_coupon_returns where site_id=$1 and operation_key=$2', [site, operationKey])).n;
          assert.equal(returnCount, returns ? 1 : 0);
          await c.recover(); const beforeAck = await state(); await c.startAnother();
          assert.equal(c.getSnapshot().pending, false, JSON.stringify(c.getSnapshot())); assert.equal(store.has(storageKey), false);
          const afterAck = await state();
          for (const key of Object.keys(beforeAck)) if (key !== 'faolla_checkout_design.intent_acknowledgements') assert.deepEqual(afterAck[key], beforeAck[key], key);
          assert.equal(afterAck['faolla_checkout_design.intent_acknowledgements'].length, beforeAck['faolla_checkout_design.intent_acknowledgements'].length + 1);
          assert.equal(store.get('opaque-host-form'), 'UNCHANGED contact and draft'); assert.equal(store.get('opaque-host-cart'), 'UNCHANGED items and member');
          assert.equal(paths.filter(p => p.endsWith('/acknowledge')).length, 1); assert.equal(paths.filter(p => p.endsWith('/submit')).length, 1);
        } finally { c.deactivate(); }
      });
    }
    await unusedReferenceCases(t, { db, peer, one, site, seed, state, rpc, requestFor, sessionFor, decode });
    await boundCheckoutCases(t, { db, one, site, seed, state, rpc, requestFor, sessionFor });
    await originalServiceCases(t, { db, peer, one, site, seed, state, rpc, requestFor, sessionFor, decode });
    await t.test('all original writers and public-role execution boundaries remain unchanged', async () => {
      assert.deepEqual(await oldDefinitions(), baseline);
      for (const role of ['anon', 'authenticated', 'service_role']) for (const signature of ['faolla_member_checkout_submission_commit_v2(text,text,text,text,jsonb,jsonb,text)', 'faolla_member_checkout_acknowledge_intent_v1(text,text,text,bigint,text,text)'])
        assert.equal((await one(db, 'select has_function_privilege($1,$2,$3) allowed', [role, 'public.' + signature, 'EXECUTE'])).allowed, false);
    });
    console.log(`BOOKING_INTENT_POSTGRES_EVIDENCE=${evidence}`);
  } finally {
    await Promise.all(clients.map(c => c.end().catch(() => {})));
    if (started) {
      const lines = (await readFile(path.join(cluster, 'postmaster.pid'), 'utf8')).split(/\r?\n/);
      assert.equal(path.resolve(lines[1]).toLowerCase(), path.resolve(cluster).toLowerCase()); assert.equal(Number(lines[3]), port);
      await exec(binaries.pg_ctl, ['-D', cluster, '-w', '-t', '30', 'stop', '-m', 'fast'], { windowsHide: true, timeout: 45000 });
    }
    console.log(`BOOKING_INTENT_CLUSTER_STOPPED=${evidence}`);
  }
});
