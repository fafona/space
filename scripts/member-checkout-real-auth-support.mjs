// Independent Linux CI only. Never load .env, production credentials or a URL
// supplied by a caller. Only the fresh workflow service database is accepted.
import assert from 'node:assert/strict';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';

export const branch = 'acceptance/member-checkout-real-auth-20261125';
export const database = 'faolla_member_checkout_auth_test';
export const databasePort = 56463;
export const authReleases = Object.freeze({
  '2.198.0': Object.freeze({ archive: 'auth.tar.xz', sourceCommit: '387e91f37e00b64b9060352988066bbb685f6e45',
    archiveSha256: '4abe9134d7615faa9149cab514acada8e7133cd69d2ccd96fdcef0d795c05171', sourceSha256: '99cdf807b817cf59da7ff10329898fbd32380e2e73231c3458660595e6ca679f' }),
  '2.186.0': Object.freeze({ archive: 'auth.tar.gz', sourceCommit: 'effd66245bd981ba5a07aa6b7441ad37578f9b73',
    archiveSha256: '2683b9549e922d0644621129fdabd7edb8b78c35274e133e61a3280ad9675161', sourceSha256: 'ad95e1f30263cfeaec800d7ba2ecc039d2e209c14c5d6e45b5b824de9bbcbe26' }),
});
export const compatibilityProfiles = Object.freeze({
  modern: { postgres: '17.6', serverVersion: '170006', postgrest: '16.6', postgrestSha256: '335ea29f00145705fb569b1268b9c8e53d062f8f6f9188192e92ea3781d2dca1', authVersion: '2.198.0' },
  // PostgreSQL protocol baseline only, NOT the full Supabase image/extensions
  // or an assertion about the currently running production versions.
  legacy: { postgres: '15.8', serverVersion: '150008', postgrest: '14.5', postgrestSha256: 'ab5cc7e974d4940447991804588cfb8b3f7b2c57b691f0905df04d51ede69470', authVersion: '2.198.0' },
  // Matches observed production Auth and PG/PostgREST protocol versions only.
  // Still a fresh plain PostgreSQL service, NOT a Supabase/Kong clone or cutover.
  'current-auth': { postgres: '15.8', serverVersion: '150008', postgrest: '14.5', postgrestSha256: 'ab5cc7e974d4940447991804588cfb8b3f7b2c57b691f0905df04d51ede69470', authVersion: '2.186.0' },
});
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
  const profileName = env.FAOLLA_CHECKOUT_AUTH_TEST_PROFILE ?? 'modern';
  assert.ok(Object.hasOwn(compatibilityProfiles, profileName), 'unreviewed_test_profile_refused');
  // Reject inherited application/backend secrets instead of accidentally using
  // a configured real service. New loopback credentials are generated in memory.
  for (const key of Object.keys(env)) if (/SUPABASE|STRIPE|SMTP|DATABASE_URL|^PGHOST$|^PGPORT$|^PGPASSWORD$|^PGDATABASE$|^FAOLLA_CHECKOUT_RUNTIME_JWT$/.test(key))
    assert.ok(!env[key], 'configured_backend_environment_refused:' + key);
  return { tools: path.join(env.RUNNER_TEMP, 'faolla-real-auth-tools'), evidence: path.join(env.RUNNER_TEMP, 'faolla-real-auth-evidence'), profileName, profile: compatibilityProfiles[profileName] };
}

export async function verifyOwnedTools(directory, profileName = 'modern') {
  assert.equal(await realpath(directory), directory);
  assert.ok(Object.hasOwn(compatibilityProfiles, profileName));
  const profile = compatibilityProfiles[profileName], auth = authReleases[profile.authVersion];
  const hashes = { [auth.archive]: auth.archiveSha256, 'source.zip': auth.sourceSha256, 'postgrest.tar.xz': profile.postgrestSha256 };
  for (const [file, hash] of Object.entries(hashes))
    assert.equal(createHash('sha256').update(await readFile(path.join(directory, file))).digest('hex'), hash);
  const pg = JSON.parse(await readFile(path.join(directory, 'pg-client/node_modules/pg/package.json'), 'utf8'));
  assert.equal(pg.version, '8.23.1');
}

export function ownedStopRequest(name, profileName) {
  assert.ok(Object.hasOwn(compatibilityProfiles, profileName));
  assert.ok(['auth', 'postgrest', 'next'].includes(name));
  if (name === 'next') return 'IPC-close';
  // v14.5 Unix.installSignalHandlers maps SIGINT and SIGTERM to
  // UserInterrupt. Request SIGINT explicitly and require that exact owned
  // request/observed termination pairing, never accept unsolicited interrupts.
  return name === 'postgrest' && compatibilityProfiles[profileName].postgrest === '14.5' ? 'SIGINT' : 'SIGTERM';
}

export function requestOwnedStop(child, name, profileName) {
  // A child terminated by a signal has exitCode === null even AFTER exit.
  // It must never be relabelled as a shutdown we requested ourselves.
  if (child.exitCode !== null || child.signalCode !== null) return null;
  const request = ownedStopRequest(name, profileName);
  if (request === 'IPC-close') {
    if (!child.connected) return null;
    child.send('close'); return request;
  }
  return child.kill(request) ? request : null;
}

export function ownedCleanupSucceeded(profileName, processes, next) {
  if (!Object.hasOwn(compatibilityProfiles, profileName) || !Array.isArray(processes) || processes.length !== 3
    || JSON.stringify(processes.map(p => p.name).sort()) !== JSON.stringify(['auth', 'next', 'postgrest'])
    || next?.acknowledged !== true || next.forbiddenFetches !== 0) return false;
  return processes.every(p => {
    const expected = ownedStopRequest(p.name, profileName);
    if (p.forced || p.requested !== expected) return false;
    return p.code === 0 && p.signal === null || expected !== 'IPC-close' && p.code === null && p.signal === expected;
  });
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
  let value = sqlError ? ('ERROR: ' + sqlError[1] + '(SQLSTATE ' + sqlError[2] + ')').replace(/\\/g, '').slice(0, 512) : raw.slice(-4096);
  for (const credential of credentials) if (credential) value = value.split(credential).join('[credential]');
  return value.replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[jwt]')
    .replace(/\b(?:postgres(?:ql)?|https?):\/\/[^\s"']+/g, '[endpoint]')
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, '[opaque]')
    .replace(/(?:STATEMENT|QUERY):[^\n]*/gi, '[sql omitted]').slice(-2048);
}
