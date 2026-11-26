// Independent diagnosis only. It does not relax the original 31-second/401 gate.
import assert from 'node:assert/strict';
import path from 'node:path';

export const expiryDiagnosticBranch = 'diagnostic/member-checkout-expiry-boundary-20261126';
export const expiryDiagnosticDatabase = 'faolla_checkout_expiry_boundary_test';
export const expiryDiagnosticPort = 56464;
export const expiryDiagnosticArchiveSha256 = 'ab5cc7e974d4940447991804588cfb8b3f7b2c57b691f0905df04d51ede69470';

export function assertExpiryDiagnosticCi(env = process.env, platform = process.platform, arch = process.arch) {
  assert.equal(platform, 'linux'); assert.equal(arch, 'x64');
  assert.equal(env.GITHUB_ACTIONS, 'true'); assert.equal(env.RUNNER_ENVIRONMENT, 'github-hosted');
  assert.equal(env.GITHUB_REPOSITORY, 'fafona/space'); assert.equal(env.GITHUB_EVENT_NAME, 'push');
  assert.equal(env.GITHUB_REF, 'refs/heads/' + expiryDiagnosticBranch);
  assert.match(env.GITHUB_SHA ?? '', /^[a-f0-9]{40}$/);
  assert.equal(env.FAOLLA_CHECKOUT_EXPIRY_DIAGNOSTIC, '1');
  assert.ok(env.RUNNER_TEMP && path.posix.isAbsolute(env.RUNNER_TEMP));
  for (const name of Object.keys(env)) if (/SUPABASE|STRIPE|SMTP|DATABASE_URL|^PG(?:HOST|PORT|PASSWORD|DATABASE|USER)$|^FAOLLA_CHECKOUT_RUNTIME_JWT$/.test(name))
    assert.ok(!env[name], 'configured_backend_environment_refused:' + name);
  return Object.freeze({tools: path.posix.join(env.RUNNER_TEMP, 'faolla-expiry-diagnostic-tools'),
    evidence: path.posix.join(env.RUNNER_TEMP, 'faolla-expiry-boundary-evidence')});
}

// These two signed claims admit only one integer validation time in PostgREST
// 14.5: now-30 <= exp and now+30 >= nbf imply now === exp+30.
// An accepted real request therefore reveals the validation clock's whole
// second without patching the binary or reading an actual production clock.
export function expiryClockOracleClaims(exp) {
  assert.ok(Number.isSafeInteger(exp) && exp > 0 && exp <= Number.MAX_SAFE_INTEGER - 60);
  return Object.freeze({exp, nbf: exp + 60, iat: exp + 60});
}

export function postgrest145TimePredicate(claims, validationSecond) {
  assert.ok(Number.isSafeInteger(validationSecond));
  return validationSecond - 30 <= claims.exp && validationSecond + 30 >= claims.nbf && validationSecond + 30 >= claims.iat;
}
