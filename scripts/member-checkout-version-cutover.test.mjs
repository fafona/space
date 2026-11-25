import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createOwnedCutoverPolicy, ownedCompilerFailure, rollbackCommit, rollbackApplication } from './member-checkout-version-cutover-support.mjs';

test('compiler diagnostics contain only named error codes and module identifiers, never raw bodies or credentials', () => {
  assert.deepEqual(ownedCompilerFailure("Error: Cannot find module '@/lib/test' MODULE_NOT_FOUND secret-sentinel https://private.invalid?token=sentinel"), { codes: ['MODULE_NOT_FOUND'], modules: ['@/lib/test'] });
  assert.deepEqual(ownedCompilerFailure('TypeError: secret-sentinel'), { codes: ['TypeError'], modules: [] });
});

test('cutover needs an exact generation and successful probe; failed probes leave routing unchanged', async () => {
  const policy = createOwnedCutoverPolicy(); assert.equal(policy.target('GET', '/api/auth/merchant-session'), 'old');
  await assert.rejects(policy.promote('candidate', 1, async () => true), /stale_generation/);
  await assert.rejects(policy.promote('candidate', 0, async () => false), /readiness_refused/);
  await assert.rejects(policy.promote('candidate', 0, async () => { throw Error('owned_probe_failed'); }), /owned_probe_failed/);
  assert.deepEqual(policy.snapshot(), { mode: 'old', generation: 0 });
  await policy.promote('candidate', 0, async () => true); assert.equal(policy.target('GET', '/api/auth/merchant-session'), 'candidate');
  await assert.rejects(policy.promote('old', 1, async () => true), /transition_refused/);
});
test('overlapping cutovers are refused before probing and cannot overwrite a successful generation', async () => {
  const policy = createOwnedCutoverPolicy(); let release, started;
  const began = new Promise(resolve => { started = resolve; });
  const first = policy.promote('candidate', 0, () => { started(); return new Promise(resolve => { release = resolve; }); });
  await began; let calls = 0;
  await assert.rejects(policy.promote('candidate', 0, async () => { calls++; return true; }), /already_in_progress/);
  assert.equal(calls, 0); release(true); await first; assert.equal(policy.snapshot().generation, 1);
});
test('retained rollback routes only reviewed original APIs to candidate, ordinary routes to old, and never mixes checkout UI assets', async () => {
  const policy = createOwnedCutoverPolicy(); await policy.promote('candidate', 0, async () => true); await policy.promote('retained', 1, async () => true);
  for (const [method, route] of [['GET', '/api/member-checkout/resource'], ['POST', '/api/member-checkout/original-service/review'],
    ['POST', '/api/member-checkout/original-service/cancel'], ['POST', '/api/member-checkout/single/points/submit']]) assert.equal(policy.target(method, route), 'candidate');
  for (const [method, route] of [['GET', '/api/member-checkout/original-service/cancel'], ['POST', '/api/member-checkout/cart/submit'],
    ['POST', '/api/member-checkout/submit'], ['GET', '/member-checkout/10909992'], ['GET', '/api/member-checkout'],
    ['POST', '/api/member-checkout/%73ubmit'], ['GET', '//unsafe'], ['GET', '/api\\member-checkout/resource']]) assert.equal(policy.target(method, route), null);
  assert.equal(policy.target('GET', '/api/auth/merchant-session'), 'old');
  await policy.promote('candidate', 2, async () => true); assert.equal(policy.target('GET', '/api/auth/merchant-session'), 'candidate');
});
test('source and workflow pins have no production transport, mutation implementation or credentials', async () => {
  assert.match(rollbackCommit, /^[a-f0-9]{40}$/); assert.equal(rollbackApplication.files, 2704);
  const support = await readFile('scripts/member-checkout-version-cutover-support.mjs', 'utf8');
  assert.match(support, /assertIsolatedCi\(\)/); assert.match(support, /git\(\['status', '--porcelain'/);
  assert.doesNotMatch(support, /git (?:fetch|push|merge)|\.env\.local|ssh |scp |\.query\(|writeFile|SUPABASE_SERVICE_ROLE_KEY/);
  const cases = await readFile('scripts/member-checkout-version-cutover-cases.mjs', 'utf8');
  assert.match(cases, /assertOwnedLifecycleTarget\(db\)/); assert.match(cases, /ca: certificate/);
  assert.match(cases, /servername: 'portal\.checkout-auth\.test'/);
  assert.doesNotMatch(cases, /rejectUnauthorized:\s*false|DROP\s+(?:TABLE|SCHEMA|ROLE)|TRUNCATE|set[A-Za-z]+ForTest|addCookies|sessionFor/);
  const workflow = await readFile('.github/workflows/member-checkout-real-auth.yml', 'utf8');
  assert.match(workflow, new RegExp('ref: ' + rollbackCommit)); assert.match(workflow, /path: \.owned-checkout-base/);
  assert.match(workflow, /FAOLLA_CHECKOUT_VERSION_CUTOVER_ACCEPTANCE:/);
});
test('old production build keeps all normal stages, original source and network refusal; synthetic TLS has an exact SAN', async () => {
  const build = await readFile('scripts/member-checkout-rollback-build.mjs', 'utf8');
  for (const name of ['environment', 'deployment-config', 'pinned-wasm', 'production-build', 'admin-bundle-budget']) assert.ok(build.includes(name));
  assert.match(build, /assert\.equal\(backendRequests, 0/); assert.match(build, /rollbackApplication/);
  assert.doesNotMatch(build, /SUPABASE_SERVICE_ROLE_KEY|FAOLLA_CHECKOUT_RUNTIME_JWT|writeFile|replace\(/);
  const launcher = await readFile('scripts/fixtures/member-checkout-rollback-local-server.mjs', 'utf8');
  assert.match(launcher, /NODE_ENV, 'production'/); assert.match(launcher, /\.next\/BUILD_ID/); assert.match(launcher, /dev: false/);
  const fixture = await readFile('scripts/member-checkout-next-session-cases.mjs', 'utf8'); assert.match(fixture, /type: 2, value: 'portal\.checkout-auth\.test'/);
});
