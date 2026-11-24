// Parent-owned TEMP cluster only. Actual PATCH/service/runtime/SQL; synthetic
// authentication/site IO, no running Next/PostgREST, production, file or mail IO.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import boundary from '../src/lib/merchantCheckoutLegacyBoundary.server.ts';
import runtime from '../src/lib/merchantBookingAtomicRuntime.server.ts';
import pointResult from '../src/lib/merchantMemberCheckoutResult.ts';

export async function partialGateBookingCases(t, { db, one, state, original }) {
  const siteId = original.siteId, primary = '__merchant_booking_records__:v1', effects = [];
  const retained = (await one(db, 'select public.faolla_checkout_resource_link_v2($1,$2,resource_id,null) result from faolla_checkout_design.bundle_results where site_id=$1 and operation_key=$3', [siteId, 'booking', original.operationKey])).result;
  assert.ok(retained); const bookingId = retained.id, method = retained.original.method;
  const earlier = (await one(db, 'select public.faolla_checkout_resource_link_v1($1,$2,$3,null) result', [siteId, 'booking', bookingId])).result;
  if (method === 'on_site') assert.throws(() => pointResult.parseMemberCheckoutResult(earlier.result, { siteId, operationKey: original.operationKey }), /checkout_invalid_response/);
  else assert.equal(pointResult.parseMemberCheckoutResult(earlier.result, { siteId, operationKey: original.operationKey }).resourceId, bookingId);

  const root = process.cwd(), requireRepo = createRequire(path.join(root, 'package.json')), ts = requireRepo('typescript');
  const moduleFrom = async (relative, overrides) => {
    const file = path.join(root, relative), compiled = ts.transpileModule(await readFile(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText, m = { exports: {} };
    const require = name => {
      if (Object.hasOwn(overrides, name)) return overrides[name];
      if (name.startsWith('@/')) return requireRepo(path.join(root, 'src', name.slice(2) + '.ts'));
      if (name.startsWith('./')) return requireRepo(path.join(path.dirname(file), name + '.ts'));
      return requireRepo(name);
    };
    runInNewContext(compiled, { module: m, exports: m.exports, require, process: { cwd: () => root }, Date, Buffer, Promise, JSON, Math, structuredClone, Request, Response, URL }, { filename: file }); return m.exports;
  };
  const forbidden = name => () => { effects.push(name); throw Error('forbidden ' + name); };
  const core = await moduleFrom('src/lib/merchantBookings.server.ts', {
    './publishedMerchantService': { loadCurrentMerchantSnapshotSiteBySiteId: async id => ({ id, merchantName: 'Synthetic', domain: 'https://booking.synthetic.invalid', permissionConfig: { allowBookingBlock: true, allowBookingAutoEmail: false }, location: { countryCode: 'ES' } }) },
    './superAdminServer': { createServerSupabaseServiceClient: () => null }, './resilientJsonFileStore': { readJsonFileWithBackup: forbidden('local read'), writeJsonFileWithBackup: forbidden('local write') },
    './merchantBookingEmails': { sendMerchantBookingStatusEmail: forbidden('email'), sendMerchantBookingReminderEmail: forbidden('reminder') }, './webPush': { notifyMerchantPushSubscribers: forbidden('push') },
  });
  const owner = { type: 'owner', siteId, authUserId: 'synthetic-owner', principalKey: 'owner:synthetic-owner', authorizationVersion: 'owner',
    displayName: 'Synthetic', email: 'synthetic@example.invalid', authorizationSource: 'database', businessPermissions: ['bookings.status.manage', 'bookings.customer_data.view'], collaborationPermissions: [] };
  const employee = { ...owner, type: 'employee', authUserId: 'synthetic-employee', principalKey: 'employee:synthetic-employee', authorizationVersion: 'staff-version',
    employeeId: 'synthetic-employee', roleId: 'synthetic-role', employeeVersion: 1, roleVersion: 1, businessPermissions: ['bookings.status.manage'] };
  const before = await state();
  for (const base of [false, true]) for (const cash of [false, true]) for (const batch of [false, true]) await t.test(`${method} booking status base=${base},cash=${cash},batch=${batch} keeps original terms and finance`, async () => {
    const calls = [], actor = batch ? employee : owner;
    let authorizations = 0;
    const dispatch = async (name, args) => {
      const fields = {
        faolla_checkout_resource_link_v1: ['p_site_id', 'p_kind', 'p_id', 'p_principal_key'], faolla_checkout_resource_link_v2: ['p_site_id', 'p_kind', 'p_id', 'p_principal_key'],
        faolla_member_checkout_reporting_v1: ['p_site_id', 'p_resources'], faolla_member_checkout_reporting_v2: ['p_site_id', 'p_resources'],
        faolla_booking_atomic_read_v2: [], faolla_booking_atomic_snapshot_v1: ['p_site_id', 'p_command_key', 'p_request_hash'],
        faolla_booking_atomic_commit_v1: ['p_site_id', 'p_command_key', 'p_request_hash', 'p_mutation'],
      }[name]; assert.ok(fields, name); calls.push(name);
      try { return { data: (await one(db, `select public.${name}(${fields.map((_, i) => '$' + (i + 1)).join(',')}) result`, fields.map(k => k === 'p_resources' ? JSON.stringify(args[k]) : args[k]))).result, error: null }; }
      catch (error) { return { data: null, error: { message: error.message } }; }
    };
    const gates = { enabled: () => base, anyEnabled: () => base, cashEnabled: () => base && cash, anyCashEnabled: () => base && cash, actor: async () => actor, rpc: () => dispatch };
    const actualActors = requireRepo(path.join(root, 'src/lib/merchantBusinessActor.server.ts'));
    const http = await moduleFrom('src/app/api/bookings/route.ts', {
      '@/lib/merchantBookings.server': core,
      '@/lib/merchantBusinessActor.server': { ...actualActors, authorizeMerchantBusinessRequest: async () => actor, reauthorizeMerchantBusinessMutation: async () => { authorizations++; } },
      '@/lib/merchantCheckoutLegacyBoundary.server': { ...boundary, bridgeLegacyCheckoutMutation: input => boundary.bridgeLegacyCheckoutMutation(input, gates) },
    });
    await db.query('begin');
    try {
      await db.query('update faolla_checkout_design.bundle_pilots set enabled=$2 where site_id=$1', [siteId, base]);
      await db.query('update faolla_checkout_design.intent_pilots set enabled=false where site_id=$1', [siteId]);
      const protectedBefore = await state();
      const stored = (await one(db, 'select blocks from pages where slug=$1', [primary])).blocks.records;
      const target = stored.find(r => r.id === bookingId), commitCount = () => calls.filter(n => n === 'faolla_booking_atomic_commit_v1').length;
      for (const status of ['confirmed', 'completed', 'no_show', 'active']) {
        const request = new Request('https://booking.synthetic.invalid/api/bookings', { method: 'PATCH', headers: { origin: 'https://booking.synthetic.invalid', 'content-type': 'application/json' },
          body: JSON.stringify({ siteId, ...(batch ? { bookingIds: [bookingId] } : { bookingId }), status }) });
        const response = await runtime.withIsolatedBookingAtomicRpc(dispatch, () => http.PATCH(request)), body = await response.json();
        assert.equal(response.status, 200, JSON.stringify(body)); assert.equal((body.booking ?? body.bookings[0]).status, status);
        assert.ok(!/checkoutOperationKey|editToken|pointTransaction|couponClaims|PRIVATE/.test(JSON.stringify(body)), JSON.stringify(body));
        if (batch) assert.equal(body.bookings[0].email, '');
        await db.query('set constraints all immediate');
        const current = (await one(db, 'select public.faolla_checkout_resource_link_v2($1,$2,$3,null) result', [siteId, 'booking', bookingId])).result.original;
        assert.equal(current.method, method); assert.equal(current.result.resource.status, status);
        if (method === 'on_site') { assert.equal(current.result.terms.paymentState, 'unpaid'); assert.equal(current.result.collection, null); }
        else assert.equal(current.result.totalPoints, retained.original.result.totalPoints);
      }
      const after = await state(), saved = (await one(db, 'select blocks from pages where slug=$1', [primary])).blocks.records, next = saved.find(r => r.id === bookingId);
      assert.equal(commitCount(), 4); assert.ok(authorizations >= 4); assert.equal(next.status, 'active');
      for (const key of ['customerAccountId', 'customerUserId', 'checkoutOperationKey', 'store', 'item', 'appointmentAt', 'appointmentTimeZone', 'bookingBlockId', 'bookingViewport', 'note', 'editToken']) assert.deepEqual(next[key], target[key], key);
      assert.deepEqual(saved.filter(r => r.id !== bookingId), stored.filter(r => r.id !== bookingId));
      for (const [table, rows] of Object.entries(protectedBefore)) {
        if (['public.pages', 'public.faolla_booking_atomic_control', 'public.faolla_booking_atomic_commands'].includes(table)) continue;
        assert.deepEqual(after[table], rows, table);
      }
      const financePages = rows => rows.filter(({ r }) => !r.slug.startsWith('__merchant_booking_records'));
      assert.deepEqual(financePages(after['public.pages']), financePages(protectedBefore['public.pages']));
      assert.deepEqual(effects, []);
    } finally { await db.query('rollback'); }
    assert.deepEqual(await state(), before);
  });
}
