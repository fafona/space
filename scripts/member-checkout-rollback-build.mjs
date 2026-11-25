// Exact pinned old application's normal production build stages, in owned CI
// TEMP only. Never a candidate publisher or an old-source patching mechanism.
import assert from 'node:assert/strict';
import { cp, readFile, stat } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import http from 'node:http';
import { applicationFingerprint, loadCompatibilityBaseline } from './member-checkout-compatibility-check.mjs';
import { rollbackApplication } from './member-checkout-version-cutover-support.mjs';

export async function buildOwnedRollback(fixture, signal, evidence) {
  return buildOwnedApplication(fixture, signal, evidence, rollbackApplication);
}
export async function buildOwnedCandidate(fixture, signal, evidence) {
  const baseline = await loadCompatibilityBaseline(); assert.deepEqual(baseline.issues, []);
  return buildOwnedApplication(fixture, signal, evidence, baseline.application);
}
async function buildOwnedApplication(fixture, signal, evidence, expected) {
  assert.equal(process.env.FAOLLA_CHECKOUT_VERSION_CUTOVER_ACCEPTANCE, '1');
  assert.equal(process.env.GITHUB_ACTIONS, 'true'); assert.equal(process.env.RUNNER_ENVIRONMENT, 'github-hosted');
  assert.ok(path.basename(fixture.evidence).startsWith('faolla-checkout-build-'));
  assert.deepEqual(await applicationFingerprint(fixture.app), expected);
  for (const name of ['public', 'scripts']) await cp(path.join(fixture.root, name), path.join(fixture.app, name), { recursive: true, force: false, errorOnExist: true });
  const pkg = JSON.parse(await readFile(path.join(fixture.app, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts.build, 'npm run check:env:strict && npm run check:v1-deploy-config && node scripts/prepare-next-wasm.mjs && next build --webpack && npm run check:bundle:admin');
  let backendRequests = 0;
  const backend = http.createServer((_req, res) => { backendRequests++; res.writeHead(503, { 'content-type': 'application/json' }); res.end('{"error":"owned_build_has_no_backend"}'); });
  await new Promise((resolve, reject) => { backend.once('error', reject); backend.listen(0, '127.0.0.1', resolve); });
  const origin = `http://127.0.0.1:${backend.address().port}`;
  const environment = { PATH: process.env.PATH, HOME: fixture.evidence, TMPDIR: fixture.evidence, TEMP: fixture.evidence, TMP: fixture.evidence,
    NODE_ENV: 'production', NODE_OPTIONS: '--max-old-space-size=3072 --import=' + pathToFileURL(path.join(process.cwd(), 'scripts/fixtures/member-checkout-build-network.mjs')).href,
    NEXT_TELEMETRY_DISABLED: '1', FAOLLA_BUILD_SINGLE_WORKER: '1', FAOLLA_CHECKOUT_BUILD_LOCAL: '1', FAOLLA_CHECKOUT_BUILD_EVIDENCE_DIR: fixture.evidence,
    FAOLLA_CHECKOUT_BUILD_ORIGIN: origin, NEXT_PUBLIC_SUPABASE_URL: origin, SUPABASE_INTERNAL_URL: origin,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'isolated-build-public-placeholder', FAOLLA_BACKGROUND_JOBS_PAUSED: '1', MERCHANT_BOOKING_AUTOMATION_WORKER_ENABLED: 'false' };
  const steps = evidence.steps = [];
  try {
  for (const [name, args] of [['environment', ['scripts/check-env.mjs', '--strict']],
    ['deployment-config', ['--import', 'tsx', 'scripts/check-v1-deploy-config.ts']], ['pinned-wasm', ['scripts/prepare-next-wasm.mjs']],
    ['production-build', ['node_modules/next/dist/bin/next', 'build', '--webpack']], ['admin-bundle-budget', ['scripts/check-admin-bundle-budget.mjs']]]) {
    signal.throwIfAborted();
    const log = createWriteStream(path.join(fixture.evidence, name + '.private.log'), { flags: 'wx', mode: 0o600 });
    const child = spawn(process.execPath, args, { cwd: fixture.app, env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
    const stop = () => child.kill('SIGTERM'), timer = setTimeout(stop, name === 'production-build' ? 600000 : 30000); timer.unref();
    signal.addEventListener('abort', stop, { once: true });
    let code, exitSignal;
    try { [code, exitSignal] = await once(child, 'exit'); }
    finally { clearTimeout(timer); signal.removeEventListener('abort', stop); await new Promise(resolve => log.end(resolve)); }
    steps.push({ name, code, signal: exitSignal }); assert.equal(code, 0, 'owned_old_build_' + name); assert.equal(exitSignal, null);
  }
  let network = []; try { network = (await readFile(path.join(fixture.evidence, 'network.jsonl'), 'utf8')).trim().split('\n').filter(Boolean).map(s => JSON.parse(s)); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  assert.ok(network.every(v => ['framework-version-refused', 'owned-tsx-ipc-refused'].includes(v.kind)), 'old_build_attempted_network_io');
  assert.equal(backendRequests, 0, 'old_build_attempted_backend_io'); await stat(path.join(fixture.app, '.next/BUILD_ID'));
  assert.deepEqual(await applicationFingerprint(fixture.app), expected);
  Object.assign(evidence, { backendRequests, networkKinds: network.map(v => v.kind), buildIdSha256: createHash('sha256').update(await readFile(path.join(fixture.app, '.next/BUILD_ID'))).digest('hex') });
  return evidence;
  } finally { evidence.backendRequests = backendRequests; backend.closeAllConnections(); if (backend.listening) await new Promise(resolve => backend.close(resolve)); }
}
