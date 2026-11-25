import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { assertIsolatedCi, artifacts, branch, safeError, sanitizeStartupDiagnostic } from './member-checkout-real-auth-support.mjs';

const env = () => ({ GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted', GITHUB_REPOSITORY: 'fafona/space',
  GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/heads/' + branch, GITHUB_SHA: 'a'.repeat(40),
  FAOLLA_CHECKOUT_REAL_AUTH_ACCEPTANCE: '1', RUNNER_TEMP: '/tmp/owned-runner' });
test('real Auth harness refuses implicit, Windows, self-hosted, main and configured backend environments', () => {
  assert.ok(assertIsolatedCi(env(), 'linux', 'x64').tools.endsWith('faolla-real-auth-tools'));
  for (const patch of [{ FAOLLA_CHECKOUT_REAL_AUTH_ACCEPTANCE: '' }, { GITHUB_ACTIONS: '' }, { RUNNER_ENVIRONMENT: 'self-hosted' },
    { GITHUB_EVENT_NAME: 'workflow_dispatch' }, { GITHUB_REPOSITORY: 'another/repo' }, { GITHUB_REF: 'refs/heads/main' },
    { GITHUB_SHA: 'not-a-sha' }, { RUNNER_TEMP: '' }, { SUPABASE_SERVICE_ROLE_KEY: 'sentinel' }, { DATABASE_URL: 'postgres://sentinel' },
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
});
test('artifact report excludes exception content and credentials; test source has no auth/route override', async () => {
  assert.deepEqual(safeError({ name: 'Error', message: 'secret-sentinel', code: 'EPIPE', stack: 'secret-sentinel' }), { name: 'Error', code: 'EPIPE' });
  assert.deepEqual(safeError({ code: 'sensitive token' }), { name: 'Error', code: null });
  const runner = await readFile('scripts/member-checkout-real-auth-acceptance.mjs', 'utf8');
  assert.doesNotMatch(runner, /set[A-Za-z]*ForTest|sessionFor|userToken|users = new Map|context\.addCookies|SUPABASE_SERVICE_ROLE_KEY:\s*process\.env/);
  assert.match(runner, /\/api\/auth\/merchant-login/); assert.match(runner, /\/api\/auth\/merchant-session\?reauth=1/);
  assert.match(runner, /\/api\/auth\/merchant-logout/); assert.match(runner, /\/logout\?scope=global/);
  assert.match(runner, /await financial\.state\(\), replay/);
});
test('startup diagnostic redacts local secrets, JWTs, URLs and SQL instead of hiding startup failure behind cleanup', () => {
  const value = sanitizeStartupDiagnostic('config failed: secret-sentinel eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature postgres://actor:password@127.0.0.1/test\nSTATEMENT: select private_data;', ['secret-sentinel']);
  assert.match(value, /config failed:/);
  assert.doesNotMatch(value, /secret-sentinel|eyJ|password|select private_data/);
});
