// Opt-in owned TEMP acceptance. Real PostgREST verifies fresh LOCAL JWTs;
// end-user authentication is synthetic/injected. No .env, production or Kong.
import assert from 'node:assert/strict';
import { readFile, realpath } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { tmpdir } from 'node:os';
import runtime from '../src/lib/merchantCheckoutRuntime.server.ts';
import configuration from '../src/lib/merchantCheckoutConfigurationStore.server.ts';
import single from '../src/app/api/member-checkout/single/route-handler.ts';
import points from '../src/lib/merchantCheckoutSubmissionPlan.server.ts';
import onSite from '../src/lib/merchantCheckoutOnSiteHttp.server.ts';
import booking from '../src/lib/merchantBookingAtomicRuntime.server.ts';

export async function checkoutRuntimePostgrestCases(t, { db, connection, binaries, evidence, seed, state, page, site, requestFor, sessionFor, decode }) {
  assert.equal(process.env.FAOLLA_CHECKOUT_HTTP_ACCEPTANCE, '1');
  const directory = await realpath(process.env.FAOLLA_CHECKOUT_POSTGREST_TEST_DIR ?? '.missing-postgrest');
  const relative = path.relative(tmpdir(), directory);
  assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative) && path.basename(directory).startsWith('faolla-checkout-postgrest-'));
  const binary = path.join(directory, 'bin', 'postgrest.exe');
  assert.equal(await realpath(binary), binary);
  assert.equal(createHash('sha256').update(await readFile(binary)).digest('hex'), 'd5ed992d11573fcd3154e2f6114dec65fe436cfcd9623d8b4e23364788aac43b');
  assert.equal(createHash('sha256').update(await readFile(path.join(directory, 'postgrest-v16.6-windows-x86-64.zip'))).digest('hex'), '77c9e51d7c177a8e1a1e7399f1c43ebecd4c0a895c231b58a3e524a87df115ea');
  assert.equal(connection.host, '127.0.0.1'); assert.equal(connection.database, 'postgres');
  assert.ok(path.resolve((await db.query('show data_directory')).rows[0].data_directory).toLowerCase().startsWith(path.resolve(evidence).toLowerCase() + path.sep));
  // Only this fresh cluster receives a noninheriting authenticator membership.
  await db.query(`create role checkout_local_gateway login noinherit nosuperuser nocreatedb nocreaterole nobypassrls;
    grant faolla_checkout_runtime,anon,authenticated,service_role to checkout_local_gateway`);
  const secret = randomBytes(48).toString('base64url'), audience = 'checkout-owned-local-only';
  const token = (patch = {}, signingKey = secret) => {
    const parts = [{ alg: 'HS256', typ: 'JWT' }, { role: 'faolla_checkout_runtime', aud: audience, exp: Math.floor(Date.now() / 1000) + 300, ...patch }]
      .map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.');
    return parts + '.' + createHmac('sha256', signingKey).update(parts).digest('base64url');
  };
  const reserved = net.createServer(); await new Promise((resolve, reject) => { reserved.once('error', reject); reserved.listen(0, '127.0.0.1', resolve); });
  const port = reserved.address().port; await new Promise(resolve => reserved.close(resolve));
  const log = createWriteStream(path.join(evidence, 'postgrest-local.log'), { flags: 'wx' });
  const child = spawn(binary, [], { windowsHide: true, env: {
    SystemRoot: process.env.SystemRoot, TEMP: tmpdir(), TMP: tmpdir(), PATH: path.dirname(binaries.pg_ctl) + path.delimiter + (process.env.PATH ?? ''),
    PGRST_DB_URI: `postgresql://checkout_local_gateway@127.0.0.1:${connection.port}/postgres`, PGRST_DB_SCHEMAS: 'public', PGRST_DB_ANON_ROLE: 'anon',
    PGRST_DB_POOL: '2', PGRST_DB_CHANNEL_ENABLED: 'false', PGRST_JWT_SECRET: secret, PGRST_JWT_AUD: audience,
    PGRST_SERVER_HOST: '127.0.0.1', PGRST_SERVER_PORT: String(port), PGRST_LOG_LEVEL: 'error',
  }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
  let spawnError; child.on('error', error => { spawnError = error; });
  const exit = once(child, 'exit').then(() => true);
  const requests = [], proxy = http.createServer((req, res) => {
    // Path-only local reverse proxy: NO JWT verification, role selection or SQL.
    // Real PostgREST behind it performs those checks. Never reaches another host.
    requests.push({ path: req.url, authorization: req.headers.authorization, cookie: req.headers.cookie });
    if (req.url !== '/rest/v1/rpc/faolla_checkout_runtime_v1' || req.method !== 'POST') { res.writeHead(404); res.end(); return; }
    const upstream = http.request({ host: '127.0.0.1', port, path: '/rpc/faolla_checkout_runtime_v1', method: 'POST', headers: req.headers }, reply => {
      res.writeHead(reply.statusCode, reply.headers); reply.pipe(res);
    });
    upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); }); req.pipe(upstream);
    res.on('close', () => upstream.destroy());
  });
  const keys = ['SUPABASE_INTERNAL_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'FAOLLA_CHECKOUT_RUNTIME_JWT', 'SUPABASE_SERVICE_ROLE_KEY'];
  const before = keys.map(key => process.env[key]);
  try {
    const startedAt = Date.now(); let ready = false;
    while (Date.now() - startedAt < 10000) {
      assert.equal(spawnError, undefined); assert.equal(child.exitCode, null);
      try { const response = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(500) }); await response.arrayBuffer(); ready = response.status === 200; if (ready) break; } catch { /* bounded readiness only, no financial calls */ }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.equal(ready, true, 'owned PostgREST did not become ready');
    await new Promise((resolve, reject) => { proxy.once('error', reject); proxy.listen(0, '127.0.0.1', resolve); });
    process.env.SUPABASE_INTERNAL_URL = `http://127.0.0.1:${proxy.address().port}`;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = token({ role: 'anon' });
    process.env.FAOLLA_CHECKOUT_RUNTIME_JWT = token(); process.env.SUPABASE_SERVICE_ROLE_KEY = 'synthetic-broad-key-must-not-be-used';
    const raw = async (jwt, name = 'faolla_checkout_runtime_v1', args = { p_function: 'faolla_member_checkout_catalog_snapshot_v1', p_arguments: { p_site_id: site } }) => {
      const response = await fetch(`http://127.0.0.1:${port}/rpc/${name}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(jwt ? { authorization: `Bearer ${jwt}` } : {}) }, body: JSON.stringify(args), signal: AbortSignal.timeout(2000) });
      return { status: response.status, body: await response.json() };
    };
    await t.test('real PostgREST signature, expiry, audience and SQL role checks reject invalid callers', async () => {
      const unchanged = await state();
      for (const jwt of [null, token({ role: 'anon' }), token({ role: 'authenticated' }), token({ role: 'service_role' }), token({}, randomBytes(48).toString('hex')), token({ exp: 1 }), token({ aud: 'other' })]) {
        const response = await raw(jwt); assert.ok([401, 403].includes(response.status), JSON.stringify(response));
      }
      assert.deepEqual(await state(), unchanged);
    });
    await t.test('actual default server factory reaches fixed dispatcher, not the private RPC or business tables', async () => {
      const unchanged = await state(), start = requests.length;
      const read = await configuration.loadCheckoutConfiguration(site); assert.equal(read.version, null); assert.deepEqual(read.offers, []);
      assert.equal(requests.length, start + 1); assert.equal(requests.at(-1).authorization, `Bearer ${process.env.FAOLLA_CHECKOUT_RUNTIME_JWT}`); assert.equal(requests.at(-1).cookie, undefined);
      assert.ok([401, 403].includes((await raw(token(), 'faolla_member_checkout_catalog_snapshot_v1', { p_site_id: site })).status));
      const denied = await raw(token(), 'faolla_checkout_runtime_v1', { p_function: 'faolla_commit_redemption_v1', p_arguments: {} });
      assert.equal(denied.status, 400); assert.equal(denied.body.message, 'checkout_runtime_forbidden');
      assert.deepEqual(await state(), unchanged);
    });
    await t.test('revoking the SQL capability blocks existing valid JWTs without broad-client fallback', async () => {
      await db.query('revoke execute on function public.faolla_checkout_runtime_v1(text,jsonb) from faolla_checkout_runtime');
      try { await assert.rejects(configuration.loadCheckoutConfiguration(site), /checkout_configuration_unavailable/); }
      finally { await db.query('grant execute on function public.faolla_checkout_runtime_v1(text,jsonb) to faolla_checkout_runtime'); }
      assert.deepEqual(await configuration.loadCheckoutConfiguration(site), { version: null, offers: [] });
    });
    await t.test('default legacy booking wrapper uses runtime transport, never its ordinary Supabase RPC client', async () => {
      const start = requests.length, unchanged = await state();
      const response = await booking.bookingAtomicRpc()('faolla_checkout_legacy_booking_commit_v1', { p_site_id: null, p_command_key: null, p_request_hash: null, p_mutation: null, p_not_after: null });
      assert.equal(response.error?.message, 'booking_atomic_invalid_command'); assert.equal(requests.length, start + 1);
      assert.deepEqual(await state(), unchanged);
    });
    await t.test('actual single submit default transport commits one booking and one coupon/point debit; replay never charges again', async () => {
      const f = await seed('points', true), nonce = randomUUID(), identity = points.checkoutSubmissionIdentity({ ...f.selection, method: 'points', nonce, confirmationHash: '0'.repeat(64), customer: f.customer }, f.principal);
      const client = runtime.createServerMerchantCheckoutRuntimeClient(); assert.ok(client);
      const preview = await client.rpc('faolla_member_checkout_submission_snapshot_v2', { p_site_id: site, p_operation_key: identity.operationKey, p_principal_key: identity.principalKey, p_request_hash: identity.requestHash, p_offer_id: f.offer.id });
      assert.equal(preview.error, null);
      const quote = await points.quoteCheckoutSubmissionSnapshot(points.parseCheckoutSubmissionSnapshot(preview.data.snapshot, identity), identity, f.principal);
      const body = { ...f.selection, method: 'points', nonce, confirmationHash: quote.confirmationHash, customer: f.customer };
      // Only end-user session and rollout are injected. No RPC/submit override.
      const overrides = { enabled: () => true, cashEnabled: () => true, session: sessionFor(f) };
      const submit = () => single.handleSingleIntentCheckout('points', 'submit', requestFor(f, '/api/member-checkout/single/points/submit', body), overrides);
      const start = requests.length, result = await decode(await submit()); assert.equal(result.replayed, false); assert.equal(result.result.totalPoints, 80);
      assert.equal(requests.length - start, 2); const committed = await state();
      const replay = await decode(await submit()); assert.equal(replay.replayed, true); assert.equal(replay.result.resourceId, result.result.resourceId); assert.deepEqual(await state(), committed);
      assert.equal((await page(`__merchant_memberships__:${site}`)).blocks.find(member => member.id === f.member.id).pointBalance, 920);
      assert.equal((await page(`__merchant_coupons__:${site}`)).blocks.find(coupon => coupon.id === f.coupon.id).redeemEvents.length, 1);
      for (const mode of ['unverified', 'switched', 'closed', 'credential-missing']) {
        const count = requests.length, unchanged = await state(), saved = process.env.FAOLLA_CHECKOUT_RUNTIME_JWT;
        let checks = 0;
        const rejected = { ...overrides, ...(mode === 'unverified' ? { session: async () => ({ ...await sessionFor(f)(), user: {} }) }
          : mode === 'switched' ? { session: async () => ++checks > 2 ? { ...await sessionFor(f)(), userId: 'different-synthetic-user' } : sessionFor(f)() }
            : mode === 'closed' ? { enabled: () => false } : {}) };
        if (mode === 'credential-missing') delete process.env.FAOLLA_CHECKOUT_RUNTIME_JWT;
        try { assert.ok((await single.handleSingleIntentCheckout('points', 'submit', requestFor(f, '/api/member-checkout/single/points/submit', body), rejected)).status >= 400); }
        finally { process.env.FAOLLA_CHECKOUT_RUNTIME_JWT = saved; }
        assert.equal(requests.length - count, mode === 'switched' ? 1 : 0); assert.deepEqual(await state(), unchanged);
      }
    });
    await t.test('default on-site preview, submit, replay and cancellation use real HTTP without inventing cash payment', async () => {
      const f = await seed('on_site', false), body = { ...f.selection, method: 'on_site', nonce: randomUUID(), confirmationHash: '0'.repeat(64), customer: f.customer };
      const overrides = { enabled: () => true, cashEnabled: () => true, session: sessionFor(f) };
      const preview = await decode(await single.handleSingleIntentCheckout('on-site', 'preview', requestFor(f, '/api/member-checkout/single/on-site/preview', body), overrides));
      body.confirmationHash = preview.quote.confirmationHash;
      const submit = () => single.handleSingleIntentCheckout('on-site', 'submit', requestFor(f, '/api/member-checkout/single/on-site/submit', body), overrides);
      const result = await decode(await submit()); assert.equal(result.replayed, false); assert.equal(result.result.terms.dueMinor, 800);
      assert.equal(result.result.terms.capturedMinor, 0); assert.equal(result.result.terms.paymentState, 'unpaid');
      const committed = await state(), replay = await decode(await submit()); assert.equal(replay.replayed, true); assert.deepEqual(await state(), committed);
      const cancellation = await decode(await onSite.handleOnSiteCheckout('cancel', requestFor(f, '/api/member-checkout/on-site/cancel', {
        siteId: site, operationKey: result.result.operationKey, expectedUpdatedAt: result.result.resource.updatedAt,
      }), { enabled: () => true, session: sessionFor(f) }));
      assert.equal(cancellation.cancellation.cashReturnedMinor, 0); assert.equal(cancellation.cancellation.couponsReturned, 0);
      assert.equal(cancellation.cancellation.stockReleased, 1);
      assert.equal((await page(`__merchant_memberships__:${site}`)).blocks.find(member => member.id === f.member.id).pointBalance, 1000);
      assert.equal((await page(`__merchant_coupons__:${site}`)).blocks.find(coupon => coupon.id === f.coupon.id).redeemEvents.length, 1);
    });
  } finally {
    keys.forEach((key, i) => { if (before[i] === undefined) delete process.env[key]; else process.env[key] = before[i]; });
    proxy.closeAllConnections(); if (proxy.listening) await new Promise(resolve => proxy.close(resolve));
    if (child.exitCode === null && !spawnError) child.kill();
    assert.equal(await Promise.race([exit, new Promise(resolve => { const timer = setTimeout(() => resolve(false), 5000); timer.unref(); })]), true, 'owned PostgREST cleanup incomplete');
    await new Promise(resolve => log.end(resolve));
    console.log(`CHECKOUT_POSTGREST_STOPPED=${evidence}`);
  }
}
