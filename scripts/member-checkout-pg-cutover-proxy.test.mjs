import assert from 'node:assert/strict';
import test from 'node:test';
import { createPgCutoverPolicy, startOwnedPgCutoverProxy } from './member-checkout-pg-cutover-proxy.mjs';

const site = '10000000', operationKey = '1a'.repeat(32);
const service = `/member-checkout/${site}/service/${operationKey}`;
const resume = `/member-checkout/${site}/resume`;
const ordinary = '/api/auth/merchant-session';
const retained = [
  ['GET', '/api/member-checkout/resource'],
  ['POST', '/api/member-checkout/history/pending'],
  ['POST', '/api/member-checkout/history/recover'],
  ['POST', '/api/member-checkout/history/retained'],
  ['POST', '/api/member-checkout/original-service/review'],
  ['POST', '/api/member-checkout/original-service/cancel'],
  ['POST', '/api/member-checkout/single/points/submit'],
  ['GET', service],
  ['GET', resume],
];
const notRetained = [
  ['GET', '/api/member-checkout'],
  ['GET', '/API/MEMBER-CHECKOUT/resource'],
  ['POST', '/api/member-checkout/submit'],
  ['POST', '/api/member-checkout/single/points/preview'],
  ['POST', '/api/member-checkout/single/coupon/submit'],
  ['POST', '/api/member-checkout/cart/submit'],
  ['POST', '/api/member-checkout/legacy/review'],
  ['POST', '/api/member-checkout/intent/pending'],
  ['GET', '/api/merchant-checkout/configuration'],
  ['POST', '/api/merchant-checkout/cart/collect'],
  ['GET', '/member-checkout'],
  ['GET', `/member-checkout/${site}/start`],
  ['GET', `/member-checkout/${site}/${operationKey}`],
  ['GET', service.replace(operationKey, '2'.repeat(64))],
  ['GET', resume.replace(site, '20000000')],
];

test('strict route ownership across old, active candidate, retained and resumed candidate', async () => {
  const policy = createPgCutoverPolicy({ site, operationKey });
  const allCheckout = [...retained, ...notRetained];
  assert.deepEqual(policy.snapshot(), { mode: 'old', generation: 0 });
  for (const [method, route] of allCheckout) assert.equal(policy.target(method, route), null, `${method} ${route}`);
  assert.equal(policy.target('GET', ordinary), 'old');
  await policy.promote('candidate', 0, async () => true);
  assert.equal(policy.target('GET', ordinary), 'candidate');
  for (const [method, route] of allCheckout) assert.equal(policy.target(method, route), 'candidate', `${method} ${route}`);
  await policy.promote('retained', 1, async () => true);
  assert.equal(policy.target('GET', ordinary), 'old');
  for (const [method, route] of retained) {
    assert.equal(policy.target(method, route), 'candidate', `${method} ${route}`);
    for (const other of ['GET', 'POST', 'HEAD', 'PUT', 'DELETE', 'OPTIONS']) {
      if (other !== method) assert.equal(policy.target(other, route), null, `${other} ${route}`);
    }
    assert.equal(policy.target(method, route + '/'), null);
    assert.equal(policy.target(method, route + '/other'), null);
  }
  for (const [method, route] of notRetained) assert.equal(policy.target(method, route), null, `${method} ${route}`);
  assert.deepEqual(await policy.promote('candidate', 2, async () => true), { mode: 'candidate', generation: 3 });
  assert.equal(policy.target('GET', ordinary), 'candidate');
});

test('malformed targets and immutable static namespace never reach an app', async () => {
  const policy = createPgCutoverPolicy({ site, operationKey });
  const bad = [undefined, null, {}, '', 'member-checkout', '//portal.checkout-auth.test/member-checkout',
    'https://portal.checkout-auth.test/member-checkout', '/member-checkout//10000000/resume',
    '/ordinary/../member-checkout', '/ordinary/./page', '/ordinary%2F..%2Fmember-checkout',
    '/member-checkout\\10000000\\resume', '/member-checkout;extra/10000000/resume', '/a#b', '/a\nb',
    '/api/member-checkout/resource?siteId=10000000', '/_next/static', '/_NeXt/StAtIc/asset.js', '/_next/static/chunks/%5BsiteId%5D.js'];
  const expectNoTargets = () => {
    for (const route of bad) assert.equal(policy.target('GET', route), null);
    for (const method of [undefined, 'get', 'GET\r\n', '', 0]) assert.equal(policy.target(method, resume), null);
  };
  expectNoTargets();
  await policy.promote('candidate', 0, () => true);
  expectNoTargets();
  await policy.promote('retained', 1, () => true);
  expectNoTargets();
  assert.equal(policy.target('GET', '/member-checkout-guide'), 'old');
});

test('refuses malformed retained page identities before constructing the policy', () => {
  for (const input of [{ site: 10000000, operationKey }, { site: '100000000', operationKey },
    { site, operationKey: 'ab' }, { site, operationKey: operationKey.toUpperCase() }, { site, operationKey: null }]) {
    assert.throws(() => createPgCutoverPolicy(input), /pg_cutover_invalid_(site|operation)/);
  }
});

test('a pending readiness probe is exclusive; false, throw and stale requests preserve generation', async () => {
  const policy = createPgCutoverPolicy({ site, operationKey });
  await assert.rejects(policy.promote('retained', 0, () => true), /transition_refused/);
  await assert.rejects(policy.promote('candidate', 0, undefined), /readiness_required/);
  await assert.rejects(policy.promote('candidate', 0, () => 'true'), /readiness_refused/);
  const failure = new Error('isolated_fixture_not_ready');
  await assert.rejects(policy.promote('candidate', 0, () => { throw failure; }), failure);
  assert.deepEqual(policy.snapshot(), { mode: 'old', generation: 0 });
  assert.equal(policy.target('GET', ordinary), 'old');
  let release;
  const ready = new Promise(resolve => { release = resolve; });
  const pending = policy.promote('candidate', 0, mode => { assert.equal(mode, 'candidate'); return ready; });
  await assert.rejects(policy.promote('candidate', 0, () => assert.fail('second probe ran')), /in_progress/);
  assert.deepEqual(policy.snapshot(), { mode: 'old', generation: 0 });
  assert.equal(policy.target('GET', ordinary), 'old');
  release(true);
  assert.deepEqual(await pending, { mode: 'candidate', generation: 1 });
  await assert.rejects(policy.promote('retained', 0, () => assert.fail('stale probe ran')), /stale_generation/);
  await assert.rejects(policy.promote('old', 1, () => true), /transition_refused/);
  assert.deepEqual(policy.snapshot(), { mode: 'candidate', generation: 1 });
});

test('network listener entry refuses non-owned environments or missing fixtures', async () => {
  const owned = process.platform === 'linux' && process.arch === 'x64' && process.getuid() > 0
    && process.env.GITHUB_ACTIONS === 'true' && process.env.RUNNER_ENVIRONMENT === 'github-hosted'
    && process.env.GITHUB_REPOSITORY === 'fafona/space'
    && process.env.GITHUB_REF === 'refs/heads/acceptance/member-checkout-pg-app-20261128';
  await assert.rejects(startOwnedPgCutoverProxy({}), owned ? /policy_required/ : /owned_ci_only/);
});
