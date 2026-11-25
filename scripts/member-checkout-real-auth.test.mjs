import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { assertIsolatedCi, artifacts, branch, compatibilityProfiles, safeError, sanitizeStartupDiagnostic } from './member-checkout-real-auth-support.mjs';
import { assertOwnedLifecycleTarget } from './member-checkout-runtime-lifecycle-cases.mjs';

const env = () => ({ GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted', GITHUB_REPOSITORY: 'fafona/space',
  GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/heads/' + branch, GITHUB_SHA: 'a'.repeat(40),
  FAOLLA_CHECKOUT_REAL_AUTH_ACCEPTANCE: '1', RUNNER_TEMP: '/tmp/owned-runner' });
test('real Auth harness refuses implicit, Windows, self-hosted, main and configured backend environments', () => {
  assert.ok(assertIsolatedCi(env(), 'linux', 'x64').tools.endsWith('faolla-real-auth-tools'));
  for (const patch of [{ FAOLLA_CHECKOUT_REAL_AUTH_ACCEPTANCE: '' }, { GITHUB_ACTIONS: '' }, { RUNNER_ENVIRONMENT: 'self-hosted' },
    { GITHUB_EVENT_NAME: 'workflow_dispatch' }, { GITHUB_REPOSITORY: 'another/repo' }, { GITHUB_REF: 'refs/heads/main' },
    { GITHUB_SHA: 'not-a-sha' }, { RUNNER_TEMP: '' }, { SUPABASE_SERVICE_ROLE_KEY: 'sentinel' }, { DATABASE_URL: 'postgres://sentinel' },
    { FAOLLA_CHECKOUT_AUTH_TEST_PROFILE: 'unreviewed' }, { FAOLLA_CHECKOUT_AUTH_TEST_PROFILE: '__proto__' },
    { PGHOST: '127.0.0.1' }, { STRIPE_SECRET_KEY: 'sentinel' }, { FAOLLA_CHECKOUT_RUNTIME_JWT: 'sentinel' }])
    assert.throws(() => assertIsolatedCi({ ...env(), ...patch }, 'linux', 'x64'));
  assert.throws(() => assertIsolatedCi(env(), 'win32', 'x64'));
  assert.throws(() => assertIsolatedCi(env(), 'linux', 'arm64'));
});
test('workflow is branch-only, read-only and has no production secrets or release steps', async () => {
  const workflow = await readFile('.github/workflows/member-checkout-real-auth.yml', 'utf8');
  assert.match(workflow, /branches:\s+- acceptance\/member-checkout-real-auth-20261125/);
  assert.match(workflow, /permissions:\s+contents: read/); assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /127\.0\.0\.1:56463:5432/); assert.match(workflow, /POSTGRES_DB: faolla_member_checkout_auth_test/);
  assert.match(workflow, /if: always\(\)/);
  assert.match(workflow, /path: \$\{\{ runner\.temp \}\}\/faolla-real-auth-evidence\/report\.json/);
  assert.doesNotMatch(workflow, /secrets\.|id-token:|contents: write|workflow_run:|workflow_dispatch:|pull_request:|environment:|ssh |scp |deploy-production|production-deploy|git push|git merge/);
  for (const hash of Object.values(artifacts)) assert.ok(workflow.includes(hash));
  for (const profile of Object.values(compatibilityProfiles)) { assert.ok(workflow.includes(profile.postgres)); assert.ok(workflow.includes(profile.postgrestSha256)); }
  assert.match(workflow, /fail-fast: false/); assert.match(workflow, /member-checkout-real-auth-\$\{\{ matrix\.profile \}\}/);
});
test('compatibility matrix pins two separate protocols without treating either as observed production state', () => {
  assert.equal(assertIsolatedCi({ ...env(), FAOLLA_CHECKOUT_AUTH_TEST_PROFILE: 'legacy' }, 'linux', 'x64').profile.serverVersion, '150008');
  assert.equal(assertIsolatedCi(env(), 'linux', 'x64').profile.serverVersion, '170006');
  assert.deepEqual(Object.keys(compatibilityProfiles), ['modern', 'legacy']);
});
test('capability lifecycle refuses non-owned endpoints and contains only fixed, reversible CI grant changes', async () => {
  const db = { connectionParameters: { host: '127.0.0.1', port: 56463, database: 'faolla_member_checkout_auth_test', user: 'checkout_ci_admin' } };
  assert.doesNotThrow(() => assertOwnedLifecycleTarget(db, env()));
  for (const patch of [{ host: 'production.invalid' }, { database: 'postgres' }, { port: 5432 }, { user: 'postgres' }])
    assert.throws(() => assertOwnedLifecycleTarget({ connectionParameters: { ...db.connectionParameters, ...patch } }, env()));
  assert.throws(() => assertOwnedLifecycleTarget(db, { ...env(), RUNNER_ENVIRONMENT: 'self-hosted' }));
  const source = await readFile('scripts/member-checkout-runtime-lifecycle-cases.mjs', 'utf8');
  assert.doesNotMatch(source, /\b(?:drop\s+(?:role|table|schema|function)|truncate|alter\s+role|disable\s+trigger)\b/i);
  assert.match(source, /finally \{ await db\.query\('grant execute/);
  assert.match(source, /finally \{ await db\.query\('grant faolla_checkout_runtime/);
  assert.match(source, /checkout_disabled/);
});
test('artifact report excludes exception content and credentials; test source has no auth/route override', async () => {
  assert.deepEqual(safeError({ name: 'Error', message: 'secret-sentinel', code: 'EPIPE', stack: 'secret-sentinel' }), { name: 'Error', code: 'EPIPE' });
  assert.deepEqual(safeError({ code: 'sensitive token' }), { name: 'Error', code: null });
  const runner = await readFile('scripts/member-checkout-real-auth-acceptance.mjs', 'utf8');
  assert.doesNotMatch(runner, /set[A-Za-z]*ForTest|sessionFor|userToken|users = new Map|context\.addCookies|SUPABASE_SERVICE_ROLE_KEY:\s*process\.env/);
  assert.match(runner, /\/api\/auth\/merchant-login/); assert.match(runner, /\/api\/auth\/merchant-session\?reauth=1/);
  assert.match(runner, /\/api\/auth\/merchant-logout/); assert.match(runner, /\/logout\?scope=global/);
  assert.match(runner, /await financial\.state\(\), replay/);
  assert.match(runner, /FAOLLA_CANONICAL_PORTAL_ORIGIN: 'https:\/\/portal\.checkout-auth\.test'/);
  assert.match(runner, /--host-resolver-rules=MAP portal\.checkout-auth\.test 127\.0\.0\.1/);
  assert.match(runner, /required prerequisite failed:/);
});
test('startup diagnostic redacts local secrets, JWTs, URLs and SQL instead of hiding startup failure behind cleanup', () => {
  const value = sanitizeStartupDiagnostic('config failed: secret-sentinel eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature postgres://actor:password@127.0.0.1/test\nSTATEMENT: select private_data;', ['secret-sentinel']);
  assert.match(value, /config failed:/);
  assert.doesNotMatch(value, /secret-sentinel|eyJ|password|select private_data/);
  const sql = sanitizeStartupDiagnostic('failed migration CREATE TABLE private_data (...); ERROR: schema \\"auth\\" does not exist (SQLSTATE 3F000)');
  assert.equal(sql, 'ERROR: schema "auth" does not exist (SQLSTATE 3F000)');
  assert.doesNotMatch(sql, /CREATE TABLE|private_data/);
});
