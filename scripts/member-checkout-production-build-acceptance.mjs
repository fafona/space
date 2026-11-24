// Opt-in compiler evidence, NOT a production release or real Auth acceptance.
import assert from 'node:assert/strict';
import { cp, copyFile, mkdtemp, symlink, mkdir, readdir, readFile, realpath, stat, statfs, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { applicationFingerprint, loadCompatibilityBaseline } from './member-checkout-compatibility-check.mjs';

assert.equal(process.env.FAOLLA_CHECKOUT_BUILD_ACCEPTANCE, '1');
const root = await realpath(fileURLToPath(new URL('../', import.meta.url)));
assert.equal(await realpath(process.cwd()), root);
const baseline = await loadCompatibilityBaseline(); assert.deepEqual(baseline.issues, []);
assert.deepEqual(await applicationFingerprint(root), baseline.manifest.application);
const disk = await statfs(root); assert.ok(Number(disk.bavail) * Number(disk.bsize) >= 10 * 1024 ** 3, 'owned_build_requires_10GiB_free');
// The system TEMP drive is small. Use a fresh sibling on the worktree's drive,
// outside the repository: nested copies alter Next's inferred tracing root and
// are also picked up by the source tree's recursive TypeScript include.
const evidence = await mkdtemp(path.join(path.dirname(root), 'faolla-checkout-build-')), app = path.join(evidence, 'app');
console.log(`CHECKOUT_BUILD_EVIDENCE=${evidence}`);
await mkdir(app);
for (const folder of ['src', 'public', 'scripts']) await cp(path.join(root, folder), path.join(app, folder), { recursive: true, errorOnExist: true, force: false });
for (const file of ['package.json', 'package-lock.json', 'tsconfig.json', 'next.config.ts', 'middleware.ts', 'postcss.config.mjs']) await copyFile(path.join(root, file), path.join(app, file));
assert.deepEqual(await applicationFingerprint(app), baseline.manifest.application);
const dependencies = path.join(app, 'node_modules'); await mkdir(dependencies);
for (const name of await readdir(path.join(root, 'node_modules'))) {
  // The existing WASM preparer rejects symlinked @next/next directories and
  // writes only inside next/wasm. Preserve that check, using private copies.
  if (['next', '@next'].includes(name)) await cp(path.join(root, 'node_modules', name), path.join(dependencies, name), { recursive: true, dereference: true });
  else if ((await stat(path.join(root, 'node_modules', name))).isDirectory()) await symlink(path.join(root, 'node_modules', name), path.join(dependencies, name), 'junction');
  else await copyFile(path.join(root, 'node_modules', name), path.join(dependencies, name));
}
const packageFile = JSON.parse(await readFile(path.join(app, 'package.json'), 'utf8'));
const lockFile = JSON.parse(await readFile(path.join(app, 'package-lock.json'), 'utf8'));
assert.equal(JSON.parse(await readFile(path.join(root, 'node_modules/tsx/package.json'), 'utf8')).version, lockFile.packages['node_modules/tsx'].version);
assert.equal(packageFile.scripts.build, 'npm run check:env:strict && npm run check:v1-deploy-config && node scripts/prepare-next-wasm.mjs && next build --webpack && npm run check:bundle:admin');
assert.equal(packageFile.scripts['check:env:strict'], 'node scripts/check-env.mjs --strict');
assert.equal(packageFile.scripts['check:v1-deploy-config'], 'tsx scripts/check-v1-deploy-config.ts');
assert.equal(packageFile.scripts['check:bundle:admin'], 'node scripts/check-admin-bundle-budget.mjs');
const requests = [], gateway = http.createServer((req, res) => {
  requests.push({ method: req.method, path: new URL(req.url, 'http://127.0.0.1').pathname });
  res.writeHead(503, { 'content-type': 'application/json' }); res.end('{"error":"isolated_build_has_no_backend"}');
});
await new Promise((resolve, reject) => { gateway.once('error', reject); gateway.listen(0, '127.0.0.1', resolve); });
const origin = `http://127.0.0.1:${gateway.address().port}`;
const environment = {
  SystemRoot: process.env.SystemRoot, PATH: process.env.PATH ?? '', TEMP: evidence, TMP: evidence,
  NODE_ENV: 'production', NODE_OPTIONS: '--max-old-space-size=3072 --import=' + pathToFileURL(path.join(app, 'scripts/fixtures/member-checkout-build-network.mjs')).href,
  NEXT_TELEMETRY_DISABLED: '1', FAOLLA_BUILD_SINGLE_WORKER: '1',
  FAOLLA_CHECKOUT_BUILD_LOCAL: '1', FAOLLA_CHECKOUT_BUILD_EVIDENCE_DIR: evidence, FAOLLA_CHECKOUT_BUILD_ORIGIN: origin,
  NEXT_PUBLIC_SUPABASE_URL: origin, SUPABASE_INTERNAL_URL: origin, NEXT_PUBLIC_SUPABASE_ANON_KEY: 'isolated-build-public-placeholder',
  FAOLLA_BACKGROUND_JOBS_PAUSED: '1', MERCHANT_BOOKING_AUTOMATION_WORKER_ENABLED: 'false',
};
const steps = [
  ['environment', ['scripts/check-env.mjs', '--strict']],
  ['deployment-config', ['--import', 'tsx', 'scripts/check-v1-deploy-config.ts']],
  ['pinned-wasm', ['scripts/prepare-next-wasm.mjs']],
  ['production-build', ['node_modules/next/dist/bin/next', 'build', '--webpack']],
  ['admin-bundle-budget', ['scripts/check-admin-bundle-budget.mjs']],
];
const results = []; let complete = false;
try {
  for (const [name, args] of steps) {
    console.log(`CHECKOUT_BUILD_STEP=${name}`);
    const started = Date.now(), log = createWriteStream(path.join(evidence, name + '.log'), { flags: 'wx' });
    const child = spawn(process.execPath, args, { cwd: app, windowsHide: true, env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
    const timer = setTimeout(() => child.kill(), name === 'production-build' ? 600000 : 30000); timer.unref();
    let code;
    try { [code] = await once(child, 'exit'); } finally { clearTimeout(timer); await new Promise(resolve => log.end(resolve)); }
    results.push({ name, code, milliseconds: Date.now() - started });
    assert.equal(code, 0, `isolated_${name}_failed; see owned log`);
  }
  const routes = JSON.parse(await readFile(path.join(app, '.next/server/app-paths-manifest.json'), 'utf8'));
  for (const route of ['/api/member-checkout/single/[method]/[action]/route', '/api/member-checkout/cart/submit/route', '/api/member-checkout/original-service/[action]/route']) {
    assert.equal(typeof routes[route], 'string'); await stat(path.join(app, '.next/server', routes[route]));
  }
  const clientFiles = [];
  async function inspectClient(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await inspectClient(file);
      else if (/\.(?:js|json)$/.test(entry.name)) { const bytes = await readFile(file); assert.ok(!bytes.includes(Buffer.from('FAOLLA_CHECKOUT_RUNTIME_JWT')), 'runtime_credential_name_in_client_bundle'); clientFiles.push(file); }
    }
  }
  await inspectClient(path.join(app, '.next/static')); assert.ok(clientFiles.length > 0);
  assert.deepEqual(await applicationFingerprint(root), baseline.manifest.application);
  assert.deepEqual(await applicationFingerprint(app), baseline.manifest.application);
  assert.deepEqual(requests, [], 'build_attempted_backend_io');
  let audit = [];
  try { audit = (await readFile(path.join(evidence, 'network.jsonl'), 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line)); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  assert.ok(audit.every(event => event.kind === 'framework-version-refused' || event.kind === 'owned-tsx-ipc-refused'), 'unexpected_build_connection');
  const buildId = (await readFile(path.join(app, '.next/BUILD_ID'), 'utf8')).trim(); assert.ok(buildId);
  const checksum = createHash('sha256').update(await readFile(path.join(app, '.next/server/app-paths-manifest.json'))).digest('hex');
  await writeFile(path.join(evidence, 'acceptance.json'), JSON.stringify({ scope: 'isolated-production-compiler-only', application: baseline.manifest.application, buildId, routeManifestSha256: checksum, clientFiles: clientFiles.length, steps: results, audit, realAuthVerified: false, deploymentAuthorized: false }, null, 2), { flag: 'wx' });
  complete = true; console.log('CHECKOUT_PRODUCTION_BUILD_ACCEPTANCE=passed');
} finally {
  gateway.closeAllConnections(); await new Promise(resolve => gateway.close(resolve));
  await writeFile(path.join(evidence, 'run-summary.json'), JSON.stringify({ complete, steps: results, backendRequests: requests }, null, 2), { flag: 'wx' });
  console.log(`CHECKOUT_BUILD_STOPPED=${evidence}`);
}
