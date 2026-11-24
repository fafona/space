// Limited production-mode HTTP smoke; no credentials, Auth or financial writes.
import assert from 'node:assert/strict';
import { readFile, realpath, readdir, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import http from 'node:http';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { applicationFingerprint, loadCompatibilityBaseline } from './member-checkout-compatibility-check.mjs';

assert.equal(process.env.FAOLLA_CHECKOUT_BUILD_ACCEPTANCE, '1');
const root = await realpath(fileURLToPath(new URL('../', import.meta.url)));
assert.equal(await realpath(process.cwd()), root);
const evidence = await realpath(process.env.FAOLLA_CHECKOUT_BUILT_TEST_DIR ?? '.missing-owned-build'), app = path.join(evidence, 'app');
assert.equal(path.dirname(evidence), path.dirname(root)); assert.ok(path.basename(evidence).startsWith('faolla-checkout-build-'));
assert.equal(await realpath(app), app); assert.ok(!(await readdir(app)).some(name => name.startsWith('.env')));
const accepted = JSON.parse(await readFile(path.join(evidence, 'acceptance.json'), 'utf8'));
assert.equal(accepted.scope, 'isolated-production-compiler-only'); assert.equal(accepted.deploymentAuthorized, false); assert.equal(accepted.realAuthVerified, false);
assert.deepEqual(accepted.steps.map(step => [step.name, step.code]), [['environment', 0], ['deployment-config', 0], ['pinned-wasm', 0], ['production-build', 0], ['admin-bundle-budget', 0]]);
const baseline = await loadCompatibilityBaseline(); assert.deepEqual(baseline.issues, []);
assert.deepEqual(accepted.application, baseline.manifest.application);
assert.deepEqual(await applicationFingerprint(root), accepted.application); assert.deepEqual(await applicationFingerprint(app), accepted.application);
assert.equal((await readFile(path.join(app, '.next/BUILD_ID'), 'utf8')).trim(), accepted.buildId);
assert.equal(createHash('sha256').update(await readFile(path.join(app, '.next/server/app-paths-manifest.json'))).digest('hex'), accepted.routeManifestSha256);
const backendRequests = [], gateway = http.createServer((req, res) => {
  backendRequests.push({ method: req.method, path: new URL(req.url, 'http://127.0.0.1').pathname });
  res.writeHead(503, { 'content-type': 'application/json' }); res.end('{"error":"owned_smoke_has_no_backend"}');
});
await new Promise((resolve, reject) => { gateway.once('error', reject); gateway.listen(0, '127.0.0.1', resolve); });
const backend = `http://127.0.0.1:${gateway.address().port}`, log = createWriteStream(path.join(evidence, 'production-smoke.log'), { flags: 'wx' });
const child = spawn(process.execPath, [path.join(root, 'scripts/fixtures/member-checkout-production-local-server.mjs'), app], { cwd: app, windowsHide: true, env: {
  SystemRoot: process.env.SystemRoot, PATH: process.env.PATH ?? '', TEMP: evidence, TMP: evidence, NODE_ENV: 'production',
  NODE_OPTIONS: '--max-old-space-size=3072 --import=' + pathToFileURL(path.join(app, 'scripts/fixtures/member-checkout-build-network.mjs')).href,
  NEXT_TELEMETRY_DISABLED: '1', FAOLLA_BUILD_SINGLE_WORKER: '1', FAOLLA_CHECKOUT_BUILD_LOCAL: '1', FAOLLA_CHECKOUT_BUILD_EVIDENCE_DIR: evidence,
  FAOLLA_CHECKOUT_BUILD_ORIGIN: backend, SUPABASE_INTERNAL_URL: backend, NEXT_PUBLIC_SUPABASE_URL: backend, NEXT_PUBLIC_SUPABASE_ANON_KEY: 'isolated-build-public-placeholder',
  FAOLLA_BACKGROUND_JOBS_PAUSED: '1', MERCHANT_BOOKING_AUTOMATION_WORKER_ENABLED: 'false',
}, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
const events = [], exit = once(child, 'exit').then(([code]) => code); child.on('message', event => events.push(event));
async function waitFor(kind, milliseconds) {
  const deadline = Date.now() + milliseconds;
  while (Date.now() < deadline) {
    const event = events.find(value => value.type === kind); if (event) return event;
    assert.equal(child.exitCode, null, 'owned_smoke_exited_before_' + kind); assert.ok(!events.some(value => value.type === 'startup-failed'));
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  throw Error('owned_smoke_' + kind + '_timeout');
}
const results = []; let complete = false, shutdown = false;
try {
  const ready = await waitFor('listening', 30000), origin = `http://127.0.0.1:${ready.port}`, route = '/api/member-checkout/single/points/submit';
  for (const [name, init, expected] of [
    ['compiled-get', {}, 405],
    ['foreign-origin', { method: 'POST', headers: { origin: 'https://foreign.synthetic.invalid', 'content-type': 'application/json' }, body: '{}' }, 403],
    ['missing-account-scope', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: '{}' }, 401],
  ]) {
    const response = await fetch(origin + route, { ...init, redirect: 'manual', signal: AbortSignal.timeout(5000) });
    await response.arrayBuffer(); results.push({ name, status: response.status }); assert.equal(response.status, expected, name);
  }
  assert.deepEqual(backendRequests, []); assert.deepEqual(await applicationFingerprint(app), accepted.application);
  complete = true;
} finally {
  if (child.connected) { child.send('close'); try { await waitFor('stopped', 10000); shutdown = true; } catch { child.kill(); } }
  const code = await Promise.race([exit, new Promise(resolve => { const timer = setTimeout(() => resolve(-1), 10000); timer.unref(); })]);
  gateway.closeAllConnections(); await new Promise(resolve => gateway.close(resolve)); await new Promise(resolve => log.end(resolve));
  const audit = (await readFile(path.join(evidence, 'network.jsonl'), 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  await writeFile(path.join(evidence, 'production-smoke.json'), JSON.stringify({ scope: 'owned-compiled-route-rejections-only', complete, shutdown, exitCode: code, pid: child.pid, results, backendRequests, audit, realAuthVerified: false, financialWritesTested: false, deploymentAuthorized: false }, null, 2), { flag: 'wx' });
  assert.equal(code, 0); assert.equal(shutdown, true);
  assert.ok(audit.every(event => event.kind === 'framework-version-refused' || event.kind === 'owned-tsx-ipc-refused'), 'unexpected_smoke_connection');
  console.log(`CHECKOUT_PRODUCTION_SMOKE_STOPPED=${evidence}`);
}
assert.equal(complete, true); console.log('CHECKOUT_PRODUCTION_SMOKE_ACCEPTANCE=passed');
