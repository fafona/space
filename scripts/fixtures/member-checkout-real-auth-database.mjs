// Synthetic data in the NEW disposable CI database only. Same pinned SQL and
// domain builders as the original Windows PostgreSQL acceptance; no migration
// discovery, production installer, Auth schema edits or fixture auth responses.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import membership from '../../src/lib/merchantMemberships.ts';
import settings from '../../src/lib/merchantMembershipSettings.ts';
import coupons from '../../src/lib/merchantCoupons.ts';
import bookingTime from '../../src/lib/merchantBookingTime.ts';
import bookingRules from '../../src/lib/merchantBookingRules.ts';
import workbench from '../../src/lib/merchantBookingWorkbench.ts';
import platformControl from '../../src/data/platformControlStore.ts';
import platformSnapshot from '../../src/lib/platformMerchantSnapshot.ts';
import sources from '../../src/lib/merchantCheckoutSources.server.ts';
import { loadCompatibilityBaseline } from '../member-checkout-compatibility-check.mjs';
import { checkoutCompatibilityCases } from '../member-checkout-compatibility-postgres-cases.mjs';
import { installOwnedRuntimePrototype } from '../member-checkout-runtime-postgres-cases.mjs';
import { database, databasePort } from '../member-checkout-real-auth-support.mjs';
import {assertCheckout047CiOptIn,installOwnedCheckout047Revision} from '../member-checkout-047-ci-cases.mjs';

export async function installRealAuthCheckoutFixture(t, db) {
  assert.equal(db.connectionParameters.host, '127.0.0.1');
  assert.equal(db.connectionParameters.port, databasePort);
  assert.equal(db.connectionParameters.database, database);
  const identity = (await db.query('select current_database() db,current_user::text actor')).rows[0];
  assert.deepEqual(identity, { db: database, actor: 'checkout_ci_admin' });
  assert.equal((await db.query("select count(*)::int n from pg_tables where schemaname not in ('pg_catalog','information_schema')")).rows[0].n, 0);
  assert.equal((await db.query("select count(*)::int n from pg_roles where rolname in ('anon','authenticated','service_role','faolla_checkout_runtime','faolla_checkout_executor')")).rows[0].n, 0);
  const baseline = await loadCompatibilityBaseline(); assert.deepEqual(baseline.issues, []);
  await db.query(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create table public.pages(id uuid primary key default gen_random_uuid(),merchant_id text,slug text,blocks jsonb,updated_at timestamptz default clock_timestamp());
    create table public.faolla_schema_migrations(version bigint primary key,name text not null);
    grant usage on schema public to anon,authenticated,service_role; grant select,insert,update,delete on pages to service_role;
    create function public.set_pages_updated_at() returns trigger language plpgsql as $$begin new.updated_at=now();return new;end;$$;
    create trigger set_pages_updated_at before update on pages for each row execute function public.set_pages_updated_at();`);
  await db.query('insert into pages(merchant_id,slug,blocks) values($1,$2,$3)', ['__faolla_booking_persistence__', '__merchant_booking_records__:v1', { version: 1, records: [] }]);
  for (const source of baseline.manifest.sources) await db.query(await readFile(source.file, 'utf8'));
  await checkoutCompatibilityCases(t, { db });
  const runtimeCall = await installOwnedRuntimePrototype(t, { db });
  const revision047=assertCheckout047CiOptIn()?await installOwnedCheckout047Revision(t,db):undefined;
  // Only ordinary reads needed by unchanged login/identity code. No fake rows.
  await db.query(`create table public.merchant_enterprise_employees(id text primary key,auth_user_id text not null);
    create table public.merchants(id text primary key,user_id text,auth_user_id text,owner_user_id text,owner_id text,auth_id text,created_by text,created_by_user_id text,email text,owner_email text,contact_email text,user_email text);
    grant select on public.merchant_enterprise_employees,public.merchants to service_role;
    create role checkout_local_gateway login noinherit nosuperuser nocreatedb nocreaterole nobypassrls password 'disposable-gateway-ci-only';
    grant faolla_checkout_runtime,anon,authenticated,service_role to checkout_local_gateway;
    -- Official hack/init_postgres.sql precreates the namespace/owner and sets
    -- auth search_path. Later original migrations grant SELECT to postgres.
    -- Reproduce those prerequisites ONLY in this fresh disposable CI database.
    create role postgres nologin nosuperuser nocreatedb nocreaterole nobypassrls;
    create role checkout_ci_auth login noinherit nosuperuser nocreatedb nocreaterole nobypassrls password 'disposable-auth-ci-only';
    create schema auth authorization checkout_ci_auth;
    grant create on database faolla_member_checkout_auth_test to checkout_ci_auth;
    alter role checkout_ci_auth set search_path=auth;`);
  const financial=await createOwnedCheckoutData(db,runtimeCall);
  return {...financial,...(revision047?{revision047}:{})};
}

// Shared synthetic financial data only, after the caller's owned CI installation.
// The existing Auth fixture and the independent atomic-install rehearsal use
// identical real domain builders. This is not an Auth or SQL response mock.
export async function createOwnedCheckoutData(db,runtimeCall) {
  assert.equal(db.connectionParameters.host,'127.0.0.1');assert.equal(db.connectionParameters.port,databasePort);
  assert.equal(db.connectionParameters.database,database);assert.equal(db.connectionParameters.user,'checkout_ci_admin');
  const site = '10909992';
  for (const table of ['bundle_pilots', 'intent_pilots']) await db.query(`insert into faolla_checkout_design.${table}(site_id,enabled) values($1,true)`, [site]);
  await db.query('update public.faolla_booking_atomic_control set active=true where singleton');
  const page = async slug => (await db.query('select * from public.pages where slug=$1', [slug])).rows[0];
  const savePage = async (merchant, slug, value) => {
    const found = (await db.query('select id from public.pages where merchant_id is not distinct from $1 and slug=$2', [merchant, slug])).rows[0];
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
  const seed = async userId => {
    const at = new Date().toISOString(), principal = { accountId: String(57000000 + (++index)), userId };
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
    const memberSlug = `__merchant_memberships__:${site}`;
    await savePage(site, memberSlug, [...((await page(memberSlug))?.blocks ?? []), member]);
    const config = settings.createEmptyMerchantMembershipSettings(site);
    config.redemptionItems = [{ id: 'booking-stock', categoryId: '', code: 'S', barcode: '', name: 'Synthetic', imageUrl: '', iconName: '', description: '', enabled: true, pointsCost: 100, referenceAmount: null, memberPrice: null, taxRate: null, stock: 10, pointProduct: true, recommended: false, sort: 0 }];
    await savePage(site, `__merchant_membership_settings__:${site}`, config);
    const coupon = coupons.normalizeMerchantCouponRecord({ id: `coupon-${randomUUID()}`, siteId: site, code: `CO${randomUUID().replaceAll('-', '').slice(0, 16)}`, title: 'Synthetic booking coupon', status: 'active',
      discountType: 'points_voucher', discountValue: 20, usageScenarios: ['points_redemption'], createdAt: at, updatedAt: at,
      claimEvents: [{ id: `claim-${randomUUID()}`, at, ...principal, email: 'synthetic@example.invalid', customerName: 'Synthetic', code: '', settlementType: 'qr', settlementCode: `PRIVATE-${randomUUID()}`, validUntil: '2036-01-01T00:00:00.000Z' }] }); assert.ok(coupon);
    const couponSlug = `__merchant_coupons__:${site}`;
    await savePage(site, couponSlug, [...((await page(couponSlug))?.blocks ?? []), coupon]);
    const offer = { version: 1, id: randomUUID(), revision: randomUUID(), siteId: site, enabled: true, title: 'Synthetic booking', maxQuantity: 1,
      source: { kind: 'booking', blockId, serviceId: randomUUID(), timeZone: 'Europe/Madrid' }, cash: { currency: 'eur', unitAmountMinor: 1000, initialPolicy: { mode: 'full' } }, unitPoints: 100, allowOnSite: true, couponReturnOnCancel: true,
      checkoutBinding: { sourceKey: source.key, sourceVersion: source.sourceVersion, viewport: source.viewport, store: source.store, item: source.item, stockItemId: 'booking-stock', voucherCouponIds: [], durationMinutes: 60, pointsReturnOnCancel: true, cancellationAdvanceMinutes: 60 } };
    const current = await runtimeCall('faolla_member_checkout_catalog_snapshot_v1', { p_site_id: site });
    await runtimeCall('faolla_member_checkout_catalog_save_v1', { p_site_id: site, p_expected_version: current.version, p_next_version: randomUUID(), p_actor_key: 'owner:synthetic-owner', p_offer: offer });
    return { principal, member, offer, selection: { siteId: site, offerId: offer.id, offerRevision: offer.revision, quantity: 1, appointmentAt, couponClaims: [{ couponId: coupon.id, claimEventId: coupon.claimEvents[0].id }] },
      customer: { name: 'Synthetic', title: 'Mx', email: 'synthetic@example.invalid', phone: '000000000', note: 'Preserved booking note' } };
  };
  return { site, page, state, seed };
}
