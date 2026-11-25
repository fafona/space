import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import https from 'node:https';
import forge from 'node-forge';
import { createOwnedCutoverPolicy, ownedCompilerFailure, rollbackCommit, rollbackApplication } from './member-checkout-version-cutover-support.mjs';

test('compiler diagnostics contain only named error codes and module identifiers, never raw bodies or credentials', () => {
  assert.deepEqual(ownedCompilerFailure("Error: Cannot find module '@/lib/test' MODULE_NOT_FOUND secret-sentinel https://private.invalid?token=sentinel"), { codes: ['MODULE_NOT_FOUND'], modules: ['@/lib/test'] });
  assert.deepEqual(ownedCompilerFailure('TypeError: secret-sentinel'), { codes: ['TypeError'], modules: [] });
});

test('new real original page has an explicit owned pilot prerequisite, default refusal and exact-row cleanup', async () => {
  const source = await readFile(new URL('./member-checkout-version-cutover-cases.mjs', import.meta.url), 'utf8');
  const prerequisite = source.indexOf("await caseOf('original service is separately refused by default");
  assert.ok(prerequisite > 0 && prerequisite < source.indexOf('await pages.candidateEntered('));
  assert.match(source, /assert\.equal\(denied\.status, 409\); assert\.equal\(denied\.value\.error, 'checkout_service_disabled'\)/);
  assert.match(source, /select count\(\*\)::int n from faolla_checkout_design\.original_service_pilots/);
  assert.match(source, /insert into faolla_checkout_design\.original_service_pilots\(site_id,enabled\) values\(\$1,true\)'/);
  assert.doesNotMatch(source, /original_service_pilots[^\n]+on conflict/);
  assert.match(source, /expected\['faolla_checkout_design\.original_service_pilots'\] = \[\{ r: \{ site_id: financial\.site, enabled: true \} \}\]/);
  assert.match(source, /delete from faolla_checkout_design\.original_service_pilots where site_id=\$1 and enabled=true/);
  assert.match(source, /assert\.equal\(removed\.rowCount, 1, 'owned_original_service_pilot_drift'\)/);
});
test('native loopback TLS verifies exact canonical SNI and rejects a different name without weakening certificate checks', { timeout: 10000 }, async () => {
  const keys = forge.pki.rsa.generateKeyPair(2048), cert = forge.pki.createCertificate(); cert.publicKey = keys.publicKey; cert.serialNumber = '01';
  cert.validity.notBefore = new Date(Date.now() - 60000); cert.validity.notAfter = new Date(Date.now() + 60000);
  const subject = [{ name: 'commonName', value: '127.0.0.1' }]; cert.setSubject(subject); cert.setIssuer(subject);
  cert.setExtensions([{ name: 'basicConstraints', cA: true }, { name: 'subjectAltName', altNames: [{ type: 2, value: 'portal.checkout-auth.test' }] }]);
  cert.sign(keys.privateKey, forge.md.sha256.create()); const ca = forge.pki.certificateToPem(cert); let requests = 0;
  const server = https.createServer({ key: forge.pki.privateKeyToPem(keys.privateKey), cert: ca }, (_req, res) => { requests++; res.writeHead(204); res.end(); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const call = servername => new Promise((resolve, reject) => {
    const req = https.request({ hostname: '127.0.0.1', servername, ca, port: server.address().port, agent: false }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); }); req.on('error', reject); req.end();
  });
  try { assert.equal(await call('portal.checkout-auth.test'), 204); await assert.rejects(call('other.checkout-auth.test'), { code: 'ERR_TLS_CERT_ALTNAME_INVALID' }); assert.equal(requests, 1); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
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
test('retained production-page scope is explicit, exact and read-only, never a wildcard checkout fallback', async () => {
  const page = '/member-checkout/10909992/service/' + 'a'.repeat(64), policy = createOwnedCutoverPolicy({ retainedPage: page });
  await policy.promote('candidate', 0, async () => true); await policy.promote('retained', 1, async () => true);
  assert.equal(policy.target('GET', page), 'candidate'); assert.equal(policy.target('POST', page), null);
  assert.equal(policy.target('GET', page + '/extra'), null); assert.equal(policy.target('GET', '/member-checkout/10909992/start'), null);
  for (const invalid of ['/admin', '/member-checkout/*', '/member-checkout/10909992/service/not-a-key']) assert.throws(() => createOwnedCutoverPolicy({ retainedPage: invalid }));
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
