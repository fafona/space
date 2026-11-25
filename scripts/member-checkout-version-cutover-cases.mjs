// Two REAL, fingerprint-pinned Next applications behind owned loopback TLS.
// Old production build + candidate dev router. HTTP API evidence, NOT candidate
// production-build cutover, UI asset switching,
// Supabase/Kong topology, installation, a release tool or production recovery.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createWriteStream } from 'node:fs';
import { readFile, realpath } from 'node:fs/promises';
import https from 'node:https';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { prepareOwnedNextFixture } from './member-checkout-next-session-cases.mjs';
import { assertOwnedLifecycleTarget } from './member-checkout-runtime-lifecycle-cases.mjs';
import { requestOwnedStop, safeError } from './member-checkout-real-auth-support.mjs';
import { applicationFingerprint } from './member-checkout-compatibility-check.mjs';
import { buildOwnedRollback } from './member-checkout-rollback-build.mjs';
import { createOwnedCutoverPolicy, ownedCompilerFailure, rollbackCommit, rollbackApplication } from './member-checkout-version-cutover-support.mjs';

export async function versionCutoverCases(caseOf, { db, financial, f, body, scope, source, candidate, appEnv, context, callCandidate, methods, report, signal }) {
  assertOwnedLifecycleTarget(db);
  assert.equal(process.env.FAOLLA_CHECKOUT_VERSION_CUTOVER_ACCEPTANCE, '1'); assert.equal(process.env.FAOLLA_CHECKOUT_AUTH_TEST_PROFILE, 'current-auth');
  assert.equal(source, path.join(process.cwd(), '.owned-checkout-base')); assert.equal(await realpath(source), source);
  assert.deepEqual(await applicationFingerprint(source), rollbackApplication);
  const fixture = await prepareOwnedNextFixture({ sourceRoot: source, dependencyRoot: process.cwd(), productionBuild: true });
  const evidence = report.cutover = { scope: 'owned-two-version-http-api-only', rollbackCommit, rollbackApplication,
    candidateCommit: process.env.GITHUB_SHA, candidateApplication: await applicationFingerprint(), transitions: [], requests: [], cleanupPassed: false };
  assert.notDeepEqual(evidence.candidateApplication, rollbackApplication);
  await caseOf('pinned old source builds in production mode with all five normal stages and no backend credentials or network requests', async () => {
    evidence.oldBuild = {}; await buildOwnedRollback(fixture, signal, evidence.oldBuild);
  });
  const policy = createOwnedCutoverPolicy(), events = [], pilots = [], views = [], routes = [];
  const log = createWriteStream(path.join(fixture.evidence, 'old-next.private.log'), { flags: 'wx', mode: 0o600 });
  // Old ordinary paths do NOT inherit new purchase scopes or a runtime token.
  const oldEnv = { ...appEnv, NODE_ENV: 'production', FAOLLA_CHECKOUT_RUNTIME_JWT: '' };
  for (const key of Object.keys(oldEnv)) if (key.startsWith('MERCHANT_MEMBER_CHECKOUT_')) oldEnv[key] = '';
  const child = spawn(process.execPath, [path.join(process.cwd(), 'scripts/fixtures/member-checkout-rollback-local-server.mjs'), fixture.app], {
    cwd: fixture.app, env: { PATH: process.env.PATH, HOME: fixture.evidence, TMPDIR: tmpdir(), ...oldEnv }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  const exited = once(child, 'exit').then(([code, signal]) => ({ code, signal }), () => ({ code: -1, signal: null }));
  child.on('error', () => { evidence.spawnFailed = true; }); child.on('message', message => events.push(message));
  let compilerOutput = '';
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { compilerOutput = (compilerOutput + chunk.toString()).slice(-32768); });
  child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
  let proxy, forced = false, completed = false; const upstreams = new Set();
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const allow = async origin => { const match = origin + '/**', handler = route => route.continue(); await context.route(match, handler); routes.push([match, handler]); };
  const browserCall = (view, route, value, headers = scope) => view.evaluate(async ({ route, value, headers }) => {
    const response = await fetch(route, { method: value === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json', ...headers },
      ...(value === undefined ? {} : { body: JSON.stringify(value) }), signal: AbortSignal.timeout(60000) });
    return { status: response.status, version: response.headers.get('x-owned-source-version'), value: await response.json() };
  }, { route, value, headers });
  try {
    const deadline = Date.now() + 45000;
    while (!events.some(v => v.type === 'listening') && Date.now() < deadline) { assert.equal(child.exitCode, null); assert.equal(child.signalCode, null); await wait(50); }
    const listening = events.find(v => v.type === 'listening'); assert.ok(listening, 'owned_old_next_readiness');
    const oldOrigin = `https://portal.checkout-auth.test:${listening.port}`; await allow(oldOrigin);
    const oldView = await context.newPage(); views.push(oldView);
    await caseOf('pinned old application independently serves the same real authenticated session without a new runtime credential', async () => {
      const response = await oldView.goto(oldOrigin + '/api/auth/merchant-session?reauth=1', { timeout: 90000 });
      if (response.status() !== 200) evidence.compilerFailure = ownedCompilerFailure(compilerOutput + await response.text());
      assert.equal(response.status(), 200);
      assert.equal((await browserCall(oldView, '/api/auth/merchant-session?reauth=1', undefined, {})).status, 200);
      assert.deepEqual(await applicationFingerprint(fixture.app), rollbackApplication);
    });
    const destinations = { old: { port: listening.port, certificate: await readFile(path.join(fixture.evidence, 'tls-cert.pem')), version: rollbackCommit },
      candidate: { port: candidate.port, certificate: await readFile(path.join(candidate.evidence, 'tls-cert.pem')), version: process.env.GITHUB_SHA } };
    let failRetained = false, loseCancellationReply = false;
    proxy = https.createServer({ key: await readFile(path.join(candidate.evidence, 'tls-key.pem')), cert: destinations.candidate.certificate }, (req, res) => {
      const pathname = new URL(req.url, 'https://portal.checkout-auth.test').pathname, name = policy.target(req.method, pathname);
      evidence.requests.push({ method: req.method, path: pathname, target: name });
      const fail = status => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end('{"error":"owned_cutover_unavailable"}'); };
      if (!name || failRetained && name === 'candidate') { fail(503); return; }
      const { port, certificate, version } = destinations[name];
      const upstream = https.request({ hostname: '127.0.0.1', servername: 'portal.checkout-auth.test', port, ca: certificate, method: req.method, path: req.url,
        headers: { ...req.headers, connection: 'close' }, agent: false, timeout: 60000 }, reply => {
        if (loseCancellationReply && pathname === '/api/member-checkout/original-service/cancel') {
          loseCancellationReply = false; reply.resume(); reply.on('end', () => fail(503));
        } else { res.writeHead(reply.statusCode, { ...reply.headers, 'x-owned-source-version': version }); reply.pipe(res); }
      });
      upstreams.add(upstream); upstream.on('close', () => { upstreams.delete(upstream); }); upstream.on('timeout', () => upstream.destroy());
      upstream.on('error', () => { if (!res.headersSent) fail(502); else res.destroy(); });
      req.on('aborted', () => upstream.destroy()); req.pipe(upstream);
    });
    await new Promise((resolve, reject) => { proxy.once('error', reject); proxy.listen(0, '127.0.0.1', resolve); });
    const proxyOrigin = `https://portal.checkout-auth.test:${proxy.address().port}`; await allow(proxyOrigin);
    const view = await context.newPage(); views.push(view);
    assert.equal((await view.goto(proxyOrigin + '/api/auth/merchant-session?reauth=1', { timeout: 90000 })).status(), 200);
    const call = (route, value, headers) => browserCall(view, route, value, headers), submit = '/api/member-checkout/single/points/submit';
    const original = (await callCandidate(submit, body, scope)).value.result;
    const resource = '/api/member-checkout/resource?' + new URLSearchParams({ siteId: financial.site, kind: original.resourceKind, id: original.resourceId });
    const transition = async (mode, probe) => evidence.transitions.push(await policy.promote(mode, policy.snapshot().generation, probe));
    await caseOf('failed preflight leaves old routing and ledger unchanged; successful cutover reaches the actual candidate process', async () => {
      const before = await financial.state();
      await assert.rejects(policy.promote('candidate', 0, async () => false), /readiness_refused/);
      assert.equal((await call('/api/auth/merchant-session?reauth=1')).version, rollbackCommit);
      assert.deepEqual(await financial.state(), before);
      await transition('candidate', async () => (await callCandidate('/api/auth/merchant-session?reauth=1')).status === 200);
      assert.equal((await call('/api/auth/merchant-session?reauth=1')).version, process.env.GITHUB_SHA);
      const replay = await call(submit, body); assert.equal(replay.status, 200); assert.equal(replay.value.replayed, true);
      assert.equal(replay.version, process.env.GITHUB_SHA); assert.deepEqual(await financial.state(), before);
    });
    await caseOf('creation pilots close before ordinary traffic rollback; exact original APIs stay on candidate and new nonces are refused', async () => {
      // Only rows already created by this disposable fixture may be changed.
      const tables = (await db.query("select tablename from pg_tables where schemaname='faolla_checkout_design' and tablename like '%pilots' and tablename<>'original_service_pilots' order by tablename")).rows;
      for (const { tablename } of tables) {
        assert.match(tablename, /^[a-z0-9_]+$/);
        const row = (await db.query(`select enabled from faolla_checkout_design.${tablename} where site_id=$1`, [financial.site])).rows[0];
        if (row) { pilots.push([tablename, row.enabled]); await db.query(`update faolla_checkout_design.${tablename} set enabled=false where site_id=$1`, [financial.site]); }
      }
      await db.query('insert into faolla_checkout_design.original_service_pilots(site_id,enabled) values($1,true) on conflict(site_id) do update set enabled=true', [financial.site]);
      const before = await financial.state();
      await transition('retained', async () => (await browserCall(oldView, '/api/auth/merchant-session?reauth=1')).status === 200 && (await callCandidate(resource, undefined, scope)).status === 200);
      assert.equal((await call('/api/auth/merchant-session?reauth=1')).version, rollbackCommit);
      const history = await call(resource); assert.equal(history.status, 200); assert.equal(history.version, process.env.GITHUB_SHA);
      assert.equal(history.value.result.resourceId, original.resourceId); assert.equal(history.value.readOnly, true);
      const replay = await call(submit, body); assert.equal(replay.status, 200); assert.equal(replay.value.replayed, true);
      const fresh = await call(submit, { ...body, nonce: randomUUID() }); assert.equal(fresh.status, 503); assert.equal(fresh.value.error, 'checkout_disabled');
      const start = methods.length; assert.equal((await call('/api/member-checkout/cart/submit', {})).status, 503); assert.equal(methods.length, start);
      assert.deepEqual(await financial.state(), before);
    });
    await caseOf('retained service outage fails closed without falling back to old application or breaking ordinary login', async () => {
      const before = await financial.state(), start = methods.length; failRetained = true;
      try { assert.equal((await call(resource)).status, 503); assert.equal((await call('/api/auth/merchant-session?reauth=1')).version, rollbackCommit); }
      finally { failRetained = false; }
      assert.equal(methods.length, start); assert.deepEqual(await financial.state(), before);
      assert.equal((await call(resource)).status, 200);
    });
    await caseOf('rollback retains real original cancellation: lost response, original re-read and retry return points and coupon only once', async () => {
      const request = { siteId: financial.site, operationKey: original.operationKey }, reviewPath = '/api/member-checkout/original-service/review';
      const couponBefore = (await financial.page('__merchant_coupons__:' + financial.site)).blocks.find(c => c.id === f.selection.couponClaims[0].couponId);
      const reviewed = await call(reviewPath, request); assert.equal(reviewed.status, 200); const review = reviewed.value.review;
      const cancelBody = { ...request, reviewHash: review.reviewHash, expectedUpdatedAt: review.original.original.result.resource.updatedAt };
      loseCancellationReply = true;
      const lost = await call('/api/member-checkout/original-service/cancel', cancelBody); assert.equal(lost.status, 503);
      const after = await financial.state(), reread = await call(reviewPath, request); assert.equal(reread.status, 200);
      const closed = reread.value.review.original.original.result; assert.equal(closed.closed, true);
      assert.equal(closed.cancellation.pointsReturned, 80); assert.equal(closed.cancellation.couponsReturned, 1); assert.equal(closed.cancellation.stockReleased, 1);
      // The old review is deliberately stale AFTER the real cancellation. The
      // service protocol requires a fresh review, not blind reuse of that CAS.
      const stale = await call('/api/member-checkout/original-service/cancel', cancelBody); assert.equal(stale.status, 409); assert.equal(stale.value.error, 'checkout_service_changed');
      assert.deepEqual(await financial.state(), after);
      const refreshed = reread.value.review;
      const repeated = await call('/api/member-checkout/original-service/cancel', { ...request, reviewHash: refreshed.reviewHash, expectedUpdatedAt: closed.resource.updatedAt });
      assert.equal(repeated.status, 200); assert.equal(repeated.value.cancellation.replayed, true);
      assert.deepEqual(await financial.state(), after);
      const member = (await financial.page('__merchant_memberships__:' + financial.site)).blocks.find(m => m.id === f.member.id);
      assert.equal(member.pointBalance, 1000);
      const coupon = (await financial.page('__merchant_coupons__:' + financial.site)).blocks.find(c => c.id === f.selection.couponClaims[0].couponId);
      assert.equal(coupon.redeemEvents.length, 0); assert.deepEqual(coupon.claimEvents, couponBefore.claimEvents);
    });
    await caseOf('candidate resumes at a new generation with the same closed original, no repeat refund or application source drift', async () => {
      const before = await financial.state();
      await transition('candidate', async () => (await callCandidate('/api/auth/merchant-session?reauth=1')).status === 200 && (await callCandidate(resource, undefined, scope)).status === 200);
      assert.equal((await call('/api/auth/merchant-session?reauth=1')).version, process.env.GITHUB_SHA);
      assert.equal((await call(resource)).value.result.closed, true); assert.deepEqual(await financial.state(), before);
      assert.deepEqual(await applicationFingerprint(fixture.app), rollbackApplication);
      assert.deepEqual(await applicationFingerprint(), evidence.candidateApplication);
      assert.deepEqual(evidence.transitions, [{ mode: 'candidate', generation: 1 }, { mode: 'retained', generation: 2 }, { mode: 'candidate', generation: 3 }]);
    });
    completed = true;
  } finally {
    const failures = [], cleanup = async run => { try { await run(); } catch (error) { failures.push(safeError(error)); } };
    for (const view of views) await cleanup(() => view.close());
    for (const [match, handler] of routes) await cleanup(() => context.unroute(match, handler));
    for (const upstream of upstreams) upstream.destroy();
    if (proxy) await cleanup(async () => { proxy.closeAllConnections(); if (proxy.listening) await new Promise(resolve => proxy.close(resolve)); });
    for (const [table, enabled] of pilots) await cleanup(() => db.query(`update faolla_checkout_design.${table} set enabled=$2 where site_id=$1`, [financial.site, enabled]));
    const requested = requestOwnedStop(child, 'next', 'current-auth');
    const stopped = await Promise.race([exited, wait(10000).then(() => null)]);
    if (!stopped) { forced = true; child.kill('SIGKILL'); await exited; }
    await cleanup(() => new Promise(resolve => log.end(resolve)));
    const ack = events.find(v => v.type === 'stopped'); evidence.stopped = { requested, forced, ...await exited };
    evidence.nextShutdown = { acknowledged: !!ack, forbiddenFetches: ack?.forbiddenFetches };
    evidence.cleanupFailures = failures;
    evidence.activeRequestsAtClose = upstreams.size;
    evidence.cleanupPassed = failures.length === 0 && upstreams.size === 0 && requested === 'IPC-close' && !forced && evidence.stopped.code === 0 && evidence.stopped.signal === null && !!ack && ack.forbiddenFetches === 0;
    evidence.passed = completed && evidence.cleanupPassed;
    assert.equal(evidence.cleanupPassed, true, 'owned_old_next_cleanup');
  }
}
