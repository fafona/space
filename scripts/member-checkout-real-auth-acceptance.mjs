// Opt-in, independent, hosted Linux CI evidence. No production connectivity,
// deployment, migration registration, real customer or mocked Auth response.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createWriteStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';
import { assertIsolatedCi, verifyOwnedTools, safeError, sanitizeStartupDiagnostic, requestOwnedStop, ownedCleanupSucceeded, authReleases, database, databasePort } from './member-checkout-real-auth-support.mjs';
import { installRealAuthCheckoutFixture } from './fixtures/member-checkout-real-auth-database.mjs';
import { prepareOwnedNextFixture } from './member-checkout-next-session-cases.mjs';
import { applicationFingerprint } from './member-checkout-compatibility-check.mjs';
import runtime from '../src/lib/merchantCheckoutRuntime.server.ts';
import points from '../src/lib/merchantCheckoutSubmissionPlan.server.ts';
import { runtimeLifecycleCases } from './member-checkout-runtime-lifecycle-cases.mjs';
import { versionCutoverCases } from './member-checkout-version-cutover-cases.mjs';
import { verifyOwnedRollbackSource } from './member-checkout-version-cutover-support.mjs';
import { buildOwnedCandidate } from './member-checkout-rollback-build.mjs';
import { createInstallationSourceBundle } from './member-checkout-installation-bundle.mjs';
import { readInstallationPreflight,assertInstallationPreflight,installationPreflightSummary } from './member-checkout-installation-preflight.mjs';

test('isolated real Auth -> actual Next cookies -> restricted PostgREST -> points/coupon booking', { timeout: process.env.FAOLLA_CHECKOUT_VERSION_CUTOVER_ACCEPTANCE === '1' ? 900000 : 360000 }, async t => {
  const owned = assertIsolatedCi(); await verifyOwnedTools(owned.tools, owned.profileName);
  // Check the old source while the inherited environment is still required to
  // contain no backend credential, before this harness creates its local JWTs.
  const rollbackSource = process.env.FAOLLA_CHECKOUT_VERSION_CUTOVER_ACCEPTANCE === '1' ? await verifyOwnedRollbackSource() : undefined;
  await mkdir(owned.evidence); // Existing evidence must never be overwritten.
  const report = { version: 1, commit: process.env.GITHUB_SHA, scope: 'isolated-real-auth-not-production', profile: owned.profileName, testedVersions: owned.profile, productionVersionsObserved: false, phase: 'database', checks: [], stopped: [], paths: [], methods: [], failure: null, passed: false };
  const children = [], servers = [], logs = [], methods = report.methods;
  let db, browser, fixture, nextChild, nextEvents, success = false;
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const nativeFetch = globalThis.fetch;
  const secret = randomBytes(48).toString('base64url'), audience = 'checkout-owned-local-only';
  const token = (role, expires = Math.floor(Date.now() / 1000) + 900) => {
    const data = [{ alg: 'HS256', typ: 'JWT' }, { role, aud: audience, exp: expires, jti: randomUUID() }].map(v => Buffer.from(JSON.stringify(v)).toString('base64url')).join('.');
    return data + '.' + createHmac('sha256', secret).update(data).digest('base64url');
  };
  const serviceJwt = token('service_role'), anonJwt = token('anon'), runtimeJwt = token('faolla_checkout_runtime');
  const startupDiagnostics = {};
  const listen = server => new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => { servers.push(server); resolve(server.address().port); }); });
  const reservePort = async () => { const socket = net.createServer(); const port = await listen(socket); await new Promise(resolve => socket.close(resolve)); servers.splice(servers.indexOf(socket), 1); return port; };
  const spawnOwned = (name, executable, args, env, cwd) => {
    const log = createWriteStream(path.join(owned.evidence, name + '.private.log'), { flags: 'wx', mode: 0o600 }); logs.push(log);
    const child = spawn(executable, args, { cwd, env: { PATH: process.env.PATH, HOME: owned.evidence, TMPDIR: tmpdir(), ...env }, stdio: ['ignore', 'pipe', 'pipe', ...(name === 'next' ? ['ipc'] : [])] });
    child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
    // Startup only, never request traffic, credentials or bodies. Full private
    // logs are not uploaded; bounded redaction is used only on startup failure.
    if (name !== 'next') child.stderr.on('data', chunk => { startupDiagnostics[name] = ((startupDiagnostics[name] ?? '') + chunk.toString()).slice(-4096); });
    const entry = { name, child, exited: once(child, 'exit').then(([code, signal]) => ({ code, signal }), () => ({ code: -1, signal: null })) };
    child.on('error', () => { entry.spawnFailed = true; }); children.push(entry); return child;
  };
  const ready = async (child, url) => {
    const deadline = Date.now() + 25000;
    while (Date.now() < deadline) {
      assert.equal(t.signal.aborted, false); assert.equal(child.exitCode, null, 'owned service exited during startup');
      try { const response = await nativeFetch(url, { signal: AbortSignal.timeout(800) }); await response.arrayBuffer(); if (response.status === 200) return; } catch { /* readiness only */ }
      await sleep(75);
    }
    assert.fail('owned service readiness timed out');
  };
  const caseOf = async (name, run) => {
    let passed = false;
    await t.test(name, async () => {
      try { await run(); passed = true; report.checks.push({ name, passed: true }); } catch (e) { report.checks.push({ name, passed: false }); throw e; }
    });
    // Dependent checks must not accidentally pass merely because login failed
    // and left the browser signed out. Abort this owned pipeline on first failure.
    assert.equal(passed, true, 'required prerequisite failed: ' + name);
  };
  const stop = async () => {
    await browser?.close().catch(() => {});
    for (const entry of [...children].reverse()) {
      entry.requested = null; entry.forced = false;
      if (entry.child.exitCode === null && entry.child.signalCode === null && !entry.spawnFailed) {
        entry.requested = requestOwnedStop(entry.child, entry.name, owned.profileName);
        const result = await Promise.race([entry.exited, sleep(10000).then(() => null)]);
        if (!result) { entry.forced = true; entry.child.kill('SIGKILL'); await entry.exited; }
      }
      report.stopped.push({ name: entry.name, requested: entry.requested, forced: entry.forced, ...await entry.exited });
    }
    for (const server of servers.reverse()) { server.closeAllConnections(); if (server.listening) await new Promise(resolve => server.close(resolve)); }
    await db?.end().catch(() => {});
    for (const log of logs) await new Promise(resolve => log.end(resolve));
  };
  const abort = () => { for (const { child } of children) if (child.exitCode === null) child.kill('SIGTERM'); };
  t.signal.addEventListener('abort', abort, { once: true });
  try {
    const requirePg = createRequire(path.join(owned.tools, 'pg-client/package.json')), { Client } = requirePg('pg');
    db = new Client({ host: '127.0.0.1', port: databasePort, database, user: 'checkout_ci_admin', password: 'disposable-checkout-ci-only', ssl: false,
      connectionTimeoutMillis: 5000, statement_timeout: 15000, query_timeout: 20000, application_name: 'faolla-real-auth-owned-ci' });
    await db.connect();
    assert.equal((await db.query('show server_version_num')).rows[0].server_version_num, owned.profile.serverVersion);
    const financial = await installRealAuthCheckoutFixture({ test: (name, run) => caseOf(name, run) }, db);
    report.phase = 'auth-startup';
    const authPort = await reservePort(), restPort = await reservePort(); assert.notEqual(authPort, restPort);
    const authOrigin = `http://127.0.0.1:${authPort}`, restOrigin = `http://127.0.0.1:${restPort}`;
    const authChild = spawnOwned('auth', path.join(owned.tools, 'auth-bin/auth'), [], {
      GOTRUE_API_HOST: '127.0.0.1', PORT: String(authPort), API_EXTERNAL_URL: authOrigin, GOTRUE_SITE_URL: 'https://127.0.0.1',
      GOTRUE_DB_DRIVER: 'postgres', GOTRUE_DB_DATABASE_URL: `postgresql://checkout_ci_auth:disposable-auth-ci-only@127.0.0.1:${databasePort}/${database}?sslmode=disable`,
      GOTRUE_DB_NAMESPACE: 'auth', GOTRUE_DB_MIGRATIONS_PATH: path.join(owned.tools, 'auth-' + authReleases[owned.profile.authVersion].sourceCommit + '/migrations'),
      GOTRUE_JWT_SECRET: secret, GOTRUE_JWT_AUD: audience, GOTRUE_JWT_EXP: '3600', GOTRUE_JWT_DEFAULT_GROUP_NAME: 'authenticated',
      GOTRUE_JWT_ADMIN_ROLES: 'service_role', GOTRUE_EXTERNAL_EMAIL_ENABLED: 'true', GOTRUE_EXTERNAL_PHONE_ENABLED: 'false',
      GOTRUE_MAILER_AUTOCONFIRM: 'false', GOTRUE_DISABLE_SIGNUP: 'true', GOTRUE_SMTP_HOST: '127.0.0.1', GOTRUE_SMTP_PORT: '1',
      GOTRUE_SMTP_ADMIN_EMAIL: 'noreply@example.invalid', GOTRUE_LOG_LEVEL: 'error', GOTRUE_TRACING_ENABLED: 'false',
    }, owned.evidence);
    await ready(authChild, authOrigin + '/health');
    await caseOf('real Auth reports the exact pinned version before login acceptance', async () => {
      const response = await nativeFetch(authOrigin + '/health', { signal: AbortSignal.timeout(5000) });
      assert.equal(response.status, 200); const health = await response.json();
      assert.equal(health.name, 'GoTrue'); assert.equal(health.version, 'v' + owned.profile.authVersion);
      report.authRuntimeVersion = health.version;
    });
    report.phase = 'postgrest-startup';
    const restChild = spawnOwned('postgrest', path.join(owned.tools, 'postgrest-bin/postgrest'), [], {
      PGRST_DB_URI: `postgresql://checkout_local_gateway:disposable-gateway-ci-only@127.0.0.1:${databasePort}/${database}`,
      PGRST_DB_SCHEMAS: 'public', PGRST_DB_ANON_ROLE: 'anon', PGRST_DB_POOL: '2', PGRST_DB_CHANNEL_ENABLED: 'false',
      PGRST_JWT_SECRET: secret, PGRST_JWT_AUD: audience, PGRST_SERVER_HOST: '127.0.0.1', PGRST_SERVER_PORT: String(restPort), PGRST_LOG_LEVEL: 'error',
    }, owned.evidence);
    await ready(restChild, restOrigin + '/');
    // Real Auth and PostgREST perform all authentication and SQL. This path-only
    // proxy never synthesizes a response, user, session, token or RPC result.
    const gateway = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      const auth = url.pathname.startsWith('/auth/v1/'), rest = url.pathname.startsWith('/rest/v1/');
      assert.equal(req.headers.cookie, undefined);
      if (!auth && !rest) { res.writeHead(404); res.end(); return; }
      report.paths.push(req.method + ' ' + url.pathname); const chunks = [];
      req.on('data', chunk => chunks.push(chunk));
      req.on('end', () => {
        const body = Buffer.concat(chunks);
        if (url.pathname === '/rest/v1/rpc/faolla_checkout_runtime_v1') methods.push(JSON.parse(body).p_function);
        const upstream = http.request({ host: '127.0.0.1', port: auth ? authPort : restPort, method: req.method,
          path: url.pathname.slice(8) + url.search, headers: req.headers }, reply => { res.writeHead(reply.statusCode, reply.headers); reply.pipe(res); });
        upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); }); upstream.end(body);
      });
    });
    const gatewayPort = await listen(gateway), gatewayOrigin = `http://127.0.0.1:${gatewayPort}`;
    const authCall = async (url, body, credential = serviceJwt, method = 'POST') => {
      const response = await nativeFetch(authOrigin + url, { method, headers: { authorization: 'Bearer ' + credential, 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(5000) });
      return { status: response.status, value: response.status === 204 ? null : await response.json() };
    };
    const email = `owned-${randomUUID()}@example.invalid`, password = 'Owned!' + randomBytes(20).toString('hex');
    const created = await authCall('/admin/users', { email, password, email_confirm: false }); assert.equal(created.status, 200);
    const userId = created.value.id; assert.match(userId, /^[a-f0-9-]{36}$/);
    const f = await financial.seed(userId), metadata = { account_type: 'personal', account_id: f.principal.accountId };
    assert.equal((await authCall('/admin/users/' + userId, { app_metadata: metadata, user_metadata: metadata }, serviceJwt, 'PUT')).status, 200);
    await caseOf('real Auth rejects unconfirmed email and wrong password before verification', async () => {
      assert.equal((await authCall('/token?grant_type=password', { email, password }, anonJwt)).status, 400);
      assert.equal((await authCall('/token?grant_type=password', { email, password: 'WrongPassword!' }, anonJwt)).status, 400);
    });
    assert.equal((await authCall('/admin/users/' + userId, { email_confirm: true }, serviceJwt, 'PUT')).status, 200);
    await caseOf('fixed metadata-only installation observation works against the selected real PG protocol without changing financial state',async()=>{
      const before=await financial.state(),sourceBundle=await createInstallationSourceBundle();
      await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      try{
        await db.query("SET LOCAL statement_timeout='5s';SET LOCAL lock_timeout='1s';SET LOCAL search_path=pg_catalog,public");
        const first=await readInstallationPreflight(sql=>db.query(sql),sourceBundle),second=await readInstallationPreflight(sql=>db.query(sql),sourceBundle);
        assert.equal(first.data.context.readOnly,true);assertInstallationPreflight(first,second);
        report.installationObservation=installationPreflightSummary(first);
      }finally{await db.query('ROLLBACK');}
      assert.deepEqual(await financial.state(),before);
    });
    const productionCandidate = process.env.FAOLLA_CHECKOUT_VERSION_CUTOVER_ACCEPTANCE === '1';
    fixture = await prepareOwnedNextFixture({ productionBuild: productionCandidate }); report.application = await applicationFingerprint(fixture.root);
    if (productionCandidate) {
      report.phase = 'candidate-production-build'; report.candidateBuild = {};
      await caseOf('frozen candidate completes all five production build stages without credentials, backend IO or source changes', () => buildOwnedCandidate(fixture, t.signal, report.candidateBuild));
    }
    const appEnv = { NODE_ENV: productionCandidate ? 'production' : 'development', NODE_OPTIONS: '--max-old-space-size=3072', NEXT_TELEMETRY_DISABLED: '1', FAOLLA_CHECKOUT_NEXT_LOCAL: '1',
      FAOLLA_CANONICAL_PORTAL_ORIGIN: 'https://portal.checkout-auth.test', FAOLLA_SUPER_ADMIN_ORIGIN: 'https://console.checkout-auth.test',
      SUPABASE_INTERNAL_URL: gatewayOrigin, NEXT_PUBLIC_SUPABASE_URL: gatewayOrigin, NEXT_PUBLIC_SUPABASE_ANON_KEY: anonJwt, SUPABASE_SERVICE_ROLE_KEY: serviceJwt,
      FAOLLA_CHECKOUT_RUNTIME_JWT: runtimeJwt, FAOLLA_BACKGROUND_JOBS_PAUSED: '1', MERCHANT_BOOKING_AUTOMATION_WORKER_ENABLED: 'false', MERCHANT_BOOKING_STORAGE_MODE: 'atomic-v2',
      MERCHANT_MEMBER_CHECKOUT_PILOT_SITES: financial.site, MERCHANT_MEMBER_CHECKOUT_CART_PILOT_SITES: financial.site, MERCHANT_MEMBER_CHECKOUT_CART_UI_PILOT_SITES: financial.site,
      MERCHANT_MEMBER_CHECKOUT_INTENT_PILOT_SITES: financial.site, MERCHANT_MEMBER_CHECKOUT_ON_SITE_PILOT_SITES: financial.site,
      ...(process.env.FAOLLA_CHECKOUT_VERSION_CUTOVER_ACCEPTANCE === '1' ? {
        MERCHANT_MEMBER_CHECKOUT_HISTORY_READ_SITES: financial.site, MERCHANT_MEMBER_CHECKOUT_ORIGINAL_SERVICE_SITES: financial.site } : {}) };
    nextChild = spawnOwned('next', process.execPath, [path.join(fixture.root, productionCandidate ? 'scripts/fixtures/member-checkout-rollback-local-server.mjs' : 'scripts/fixtures/member-checkout-next-local-server.mjs'), fixture.app], appEnv, fixture.app);
    nextEvents = []; nextChild.on('message', message => nextEvents.push(message));
    report.phase = 'next-startup'; const deadline = Date.now() + 45000;
    while (!nextEvents.some(v => v.type === 'listening') && Date.now() < deadline) { assert.equal(nextChild.exitCode, null); await sleep(50); }
    const listening = nextEvents.find(v => v.type === 'listening'); assert.ok(listening, 'Next readiness');
    // Bare loopback is intentionally also treated as the dev super-admin host
    // by the unchanged middleware. Use DISTINCT synthetic canonical hosts,
    // DNS-mapped in this browser to loopback, not a middleware/auth bypass.
    const origin = `https://portal.checkout-auth.test:${listening.port}`, route = '/api/member-checkout/single/points/submit';
    browser = await chromium.launch({ headless: true, args: ['--host-resolver-rules=MAP portal.checkout-auth.test 127.0.0.1', '--no-proxy-server'] });
    const context = await browser.newContext({ ignoreHTTPSErrors: true, ...(productionCandidate ? { serviceWorkers: 'block', locale: 'zh-CN' } : {}) });
    await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    const view = await context.newPage();
    const response = await view.goto(origin + route, { timeout: 90000 }); assert.equal(response.status(), 405);
    const call = (route, body, headers = {}) => view.evaluate(async ({ route, body, headers }) => {
      const response = await fetch(route, { method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json', ...headers },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      return { status: response.status, value: await response.json() };
    }, { route, body, headers });
    const login = () => call('/api/auth/merchant-login', { account: email, password, preferredAccountType: 'personal' });
    report.phase = 'actual-login-and-cookies';
    await caseOf('actual application login verifies real password and sets unreadable Secure HttpOnly cookies', async () => {
      const result = await login(); assert.equal(result.status, 200, 'actual login status');
      const cookies = await context.cookies(origin);
      for (const name of ['__Host-faolla-merchant-auth-v2', '__Host-faolla-merchant-refresh-v2']) {
        const cookie = cookies.find(c => c.name === name); assert.ok(cookie, name); assert.equal(cookie.secure, true); assert.equal(cookie.httpOnly, true); assert.equal(cookie.path, '/');
      }
      assert.equal(await view.evaluate(() => document.cookie), '');
      assert.ok(report.paths.includes('POST /auth/v1/token'));
    });
    await caseOf('missing access cookie is renewed by actual session route using real refresh token', async () => {
      await context.clearCookies({ name: '__Host-faolla-merchant-auth-v2' }); const before = report.paths.length;
      const result = await call('/api/auth/merchant-session?reauth=1'); assert.equal(result.status, 200);
      assert.ok(report.paths.slice(before).includes('POST /auth/v1/token'));
      assert.ok((await context.cookies(origin)).some(c => c.name === '__Host-faolla-merchant-auth-v2' && c.secure && c.httpOnly));
    });
    process.env.SUPABASE_INTERNAL_URL = gatewayOrigin; process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = anonJwt; process.env.FAOLLA_CHECKOUT_RUNTIME_JWT = runtimeJwt;
    const nonce = randomUUID(), identity = points.checkoutSubmissionIdentity({ ...f.selection, method: 'points', nonce, confirmationHash: '0'.repeat(64), customer: f.customer }, f.principal);
    const snapshot = await runtime.createServerMerchantCheckoutRuntimeClient().rpc('faolla_member_checkout_submission_snapshot_v2', {
      p_site_id: financial.site, p_operation_key: identity.operationKey, p_principal_key: identity.principalKey, p_request_hash: identity.requestHash, p_offer_id: f.offer.id });
    assert.equal(snapshot.error, null);
    const quote = await points.quoteCheckoutSubmissionSnapshot(points.parseCheckoutSubmissionSnapshot(snapshot.data.snapshot, identity), identity, f.principal);
    const body = { ...f.selection, method: 'points', nonce, confirmationHash: quote.confirmationHash, customer: f.customer }, scope = { 'x-checkout-account-scope': f.principal.accountId };
    report.phase = 'actual-checkout';
    await caseOf('real login authorizes one points/coupon booking; identical retry never repeats debit', async () => {
      const start = methods.length, result = await call(route, body, scope); assert.equal(result.status, 200); assert.equal(result.value.replayed, false); assert.equal(result.value.result.totalPoints, 80);
      assert.deepEqual(methods.slice(start), ['faolla_member_checkout_submission_snapshot_v2', 'faolla_member_checkout_submission_commit_v2']);
      assert.equal((await financial.page(`__merchant_memberships__:${financial.site}`)).blocks.find(m => m.id === f.member.id).pointBalance, 920);
      const committed = await financial.state(), replay = await call(route, body, scope); assert.equal(replay.status, 200); assert.equal(replay.value.replayed, true); assert.deepEqual(await financial.state(), committed);
      assert.ok(report.paths.includes('GET /auth/v1/admin/users')); // Actual paginated fallback, NOT a claim about getUserById.
    });
    report.phase = 'runtime-lifecycle';
    await runtimeLifecycleCases(caseOf, {
      db, site: financial.site, state: financial.state, currentRuntime: runtimeJwt, mintRuntime: expires => token('faolla_checkout_runtime', expires),
      rawCatalog: async jwt => {
        const response = await nativeFetch(gatewayOrigin + '/rest/v1/rpc/faolla_checkout_runtime_v1', { method: 'POST',
          headers: { authorization: 'Bearer ' + (jwt === 'ordinary-service' ? serviceJwt : jwt), 'content-type': 'application/json' },
          body: JSON.stringify({ p_function: 'faolla_member_checkout_catalog_snapshot_v1', p_arguments: { p_site_id: financial.site } }), signal: AbortSignal.timeout(5000) });
        await response.arrayBuffer(); return { status: response.status };
      },
      ordinaryRead: async () => { const response = await nativeFetch(gatewayOrigin + '/rest/v1/merchants?select=id', { headers: { authorization: 'Bearer ' + serviceJwt }, signal: AbortSignal.timeout(5000) }); await response.arrayBuffer(); return response.status; },
      activeSession: async () => (await call('/api/auth/merchant-session?reauth=1')).status,
      replay: () => call(route, body, scope), newSubmission: nonce => call(route, { ...body, nonce }, scope),
    });
    if (process.env.FAOLLA_CHECKOUT_VERSION_CUTOVER_ACCEPTANCE === '1') {
      report.phase = 'two-version-api-cutover';
      await versionCutoverCases(caseOf, { db, financial, f, body, scope, source: rollbackSource, candidate: { port: listening.port, evidence: fixture.evidence, app: fixture.app }, appEnv, context, callCandidate: call, methods, report, signal: t.signal });
    }
    report.phase = 'actual-auth-rejections';
    await caseOf('fresh Auth pause or forged account scope rejects before financial RPC and leaves ledger unchanged', async () => {
      for (const paused of [true, false]) {
        const update = await authCall('/admin/users/' + userId, { app_metadata: { ...metadata, personal_service_paused: paused } }, serviceJwt, 'PUT'); assert.equal(update.status, 200);
        const before = await financial.state(), start = methods.length;
        const result = await call(route, body, paused ? scope : { 'x-checkout-account-scope': '59009999' });
        assert.equal(result.status, 401); assert.equal(methods.length, start); assert.deepEqual(await financial.state(), before);
      }
    });
    await caseOf('application logout clears cookies and blocks checkout; real provider logout separately revokes refresh', async () => {
      const cookies = await context.cookies(origin), access = cookies.find(c => c.name === '__Host-faolla-merchant-auth-v2').value, refresh = cookies.find(c => c.name === '__Host-faolla-merchant-refresh-v2').value;
      assert.equal((await call('/api/auth/merchant-logout', {})).status, 200);
      assert.equal((await context.cookies(origin)).filter(c => /__Host-faolla-merchant-(auth|refresh)-v2/.test(c.name)).length, 0);
      const before = await financial.state(), start = methods.length; assert.equal((await call(route, body, scope)).status, 401);
      assert.equal(methods.length, start); assert.deepEqual(await financial.state(), before);
      assert.equal((await authCall('/logout?scope=global', {}, access)).status, 204);
      assert.equal((await authCall('/token?grant_type=refresh_token', { refresh_token: refresh }, anonJwt)).status, 400);
      // Access JWTs need not be instantly invalidated: do not assert otherwise.
    });
    assert.deepEqual(await applicationFingerprint(fixture.root), await applicationFingerprint(fixture.app));
    success = report.checks.every(c => c.passed); report.phase = 'cleanup';
  } catch (error) {
    report.failure = safeError(error);
    if (['auth-startup', 'postgrest-startup'].includes(report.phase)) report.startup = Object.fromEntries(Object.entries(startupDiagnostics).map(([name, value]) =>
      [name, sanitizeStartupDiagnostic(value, [secret, serviceJwt, anonJwt, runtimeJwt, 'disposable-checkout-ci-only', 'disposable-gateway-ci-only', 'disposable-auth-ci-only'])]));
    throw error;
  }
  finally {
    await stop();
    t.signal.removeEventListener('abort', abort);
    const stopped = nextEvents?.find(v => v.type === 'stopped');
    report.nextShutdown = stopped ? { acknowledged: true, forbiddenFetches: stopped.forbiddenFetches } : { acknowledged: false };
    report.cleanupPassed = ownedCleanupSucceeded(owned.profileName, report.stopped, report.nextShutdown) && (report.cutover === undefined || report.cutover.cleanupPassed === true);
    if (!report.cleanupPassed) report.failure ??= { name: 'Error', code: 'OWNED_PROCESS_STOP_FAILED' };
    report.passed = success && report.checks.every(c => c.passed) && report.failure === null && report.cleanupPassed;
    // The ONLY uploaded artifact is this path/method/status-only report.
    await writeFile(path.join(owned.evidence, 'report.json'), JSON.stringify(report, null, 2), { flag: 'wx', mode: 0o600 });
    if (nextChild) { assert.ok(stopped, 'owned Next shutdown acknowledgement'); assert.equal(stopped.forbiddenFetches, 0); }
    if (success) assert.equal(report.cleanupPassed, true, 'all owned processes stopped cleanly');
  }
});
