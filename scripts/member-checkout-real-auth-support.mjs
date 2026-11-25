// Independent Linux CI only. Never load .env, production credentials or a URL
// supplied by a caller. Only the fresh workflow service database is accepted.
import assert from 'node:assert/strict';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';

export const branch = 'acceptance/member-checkout-real-auth-20261125';
export const database = 'faolla_member_checkout_auth_test';
export const databasePort = 56463;
export const artifacts = Object.freeze({
  'auth.tar.xz': '4abe9134d7615faa9149cab514acada8e7133cd69d2ccd96fdcef0d795c05171',
  'source.zip': '99cdf807b817cf59da7ff10329898fbd32380e2e73231c3458660595e6ca679f',
  'postgrest.tar.xz': '335ea29f00145705fb569b1268b9c8e53d062f8f6f9188192e92ea3781d2dca1',
});

export function assertIsolatedCi(env = process.env, platform = process.platform, arch = process.arch) {
  assert.equal(platform, 'linux'); assert.equal(arch, 'x64');
  assert.equal(env.GITHUB_ACTIONS, 'true'); assert.equal(env.RUNNER_ENVIRONMENT, 'github-hosted');
  assert.equal(env.GITHUB_REPOSITORY, 'fafona/space'); assert.equal(env.GITHUB_EVENT_NAME, 'push');
  assert.equal(env.GITHUB_REF, 'refs/heads/' + branch);
  assert.match(env.GITHUB_SHA ?? '', /^[a-f0-9]{40}$/);
  assert.equal(env.FAOLLA_CHECKOUT_REAL_AUTH_ACCEPTANCE, '1');
  assert.ok(env.RUNNER_TEMP && path.isAbsolute(env.RUNNER_TEMP));
  // Reject inherited application/backend secrets instead of accidentally using
  // a configured real service. New loopback credentials are generated in memory.
  for (const key of Object.keys(env)) if (/SUPABASE|STRIPE|SMTP|DATABASE_URL|^PGHOST$|^PGPORT$|^PGPASSWORD$|^PGDATABASE$|^FAOLLA_CHECKOUT_RUNTIME_JWT$/.test(key))
    assert.ok(!env[key], 'configured_backend_environment_refused:' + key);
  return { tools: path.join(env.RUNNER_TEMP, 'faolla-real-auth-tools'), evidence: path.join(env.RUNNER_TEMP, 'faolla-real-auth-evidence') };
}

export async function verifyOwnedTools(directory) {
  assert.equal(await realpath(directory), directory);
  for (const [file, hash] of Object.entries(artifacts))
    assert.equal(createHash('sha256').update(await readFile(path.join(directory, file))).digest('hex'), hash);
  const pg = JSON.parse(await readFile(path.join(directory, 'pg-client/node_modules/pg/package.json'), 'utf8'));
  assert.equal(pg.version, '8.23.1');
}

export function safeError(error) {
  // Do NOT upload exception messages, request/response bodies, tokens, env,
  // passwords, SQL dumps or process logs. Named assertion tests give context.
  return { name: error?.name ?? 'Error', code: /^[A-Z0-9_]{1,40}$/.test(error?.code ?? '') ? error.code : null };
}

export function sanitizeStartupDiagnostic(text, credentials = []) {
  // A migration error may include the complete DDL in one JSON message. Keep
  // only its trailing PostgreSQL ERROR + SQLSTATE, never that SQL payload.
  const raw = String(text).slice(-16384), sqlError = raw.match(/ERROR: ([^\n]{1,400}?)\(SQLSTATE ([0-9A-Z]{5})\)/);
  if (sqlError) return ('ERROR: ' + sqlError[1] + '(SQLSTATE ' + sqlError[2] + ')').replace(/\\/g, '').slice(0, 512);
  let value = raw.slice(-4096);
  for (const credential of credentials) if (credential) value = value.split(credential).join('[credential]');
  return value.replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[jwt]')
    .replace(/\b(?:postgres(?:ql)?|https?):\/\/[^\s"']+/g, '[endpoint]')
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, '[opaque]')
    .replace(/(?:STATEMENT|QUERY):[^\n]*/gi, '[sql omitted]').slice(-2048);
}
