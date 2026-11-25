// Independent CI-only HTTP cutover policy. NOT a production router, release
// permission or claim that an old application can service the new ledger.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { applicationFingerprint } from './member-checkout-compatibility-check.mjs';
import { assertIsolatedCi } from './member-checkout-real-auth-support.mjs';

export const rollbackCommit = '98ce90e63c84e0da7747d0a14d2f5fc9d7f5f980';
export const rollbackApplication = Object.freeze({ algorithm: 'sha256-lf-path-content-v1', files: 2704,
  sha256: '2d06a39614aca1c6bb424be5492ee42dbe3ed27b8e21756ec88031617bea8699' });

export function ownedCompilerFailure(text) {
  // No log excerpt, response body, request, URL, env or arbitrary exception
  // message may enter the public CI report. Module identifiers come only from
  // the pinned source/compiler and cannot contain a token or query string.
  const codes = [...new Set(String(text).match(/\b(?:ERR_[A-Z_]{1,60}|MODULE_NOT_FOUND|TypeError|ReferenceError|SyntaxError)\b/g) ?? [])];
  const modules = [...String(text).matchAll(/(?:Can't resolve|Cannot find module) ['"]((?:@|\.\.?\/)[a-zA-Z0-9_./@-]{1,150})['"]/g)].map(m => m[1]);
  return { codes, modules: [...new Set(modules)] };
}

export async function verifyOwnedRollbackSource() {
  const owned = assertIsolatedCi(); assert.equal(owned.profileName, 'current-auth');
  assert.equal(process.env.FAOLLA_CHECKOUT_VERSION_CUTOVER_ACCEPTANCE, '1');
  const root = await realpath(process.cwd()), source = path.join(root, '.owned-checkout-base');
  assert.equal(await realpath(source), source);
  const git = args => execFileSync('git', ['-C', source, ...args], { encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024 }).trim();
  assert.equal(git(['rev-parse', 'HEAD']), rollbackCommit);
  assert.equal(git(['status', '--porcelain', '--untracked-files=all']), '');
  assert.deepEqual(await applicationFingerprint(source), rollbackApplication);
  // All original package entries must be byte-semantically identical to the
  // installed lock. The only added dependency is the isolated pglite test tool.
  const oldLock = JSON.parse(await readFile(path.join(source, 'package-lock.json'), 'utf8'));
  const current = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'));
  for (const [name, entry] of Object.entries(oldLock.packages)) if (name) assert.deepEqual(current.packages[name], entry, 'rollback_dependency_changed:' + name);
  assert.deepEqual(Object.keys(current.packages).filter(name => !Object.hasOwn(oldLock.packages, name)), ['node_modules/@electric-sql/pglite']);
  return source;
}

// A normal rollback MUST retain the ledger-aware service. Routing it to the
// old application (which has no such routes) is deliberately not an option.
const retainedRoutes = new Map([
  ['/api/member-checkout/resource', 'GET'],
  ['/api/member-checkout/original-service/review', 'POST'],
  ['/api/member-checkout/original-service/cancel', 'POST'],
  ['/api/member-checkout/single/points/submit', 'POST'], // Exact original replay; DB creation gate must be closed first.
]);
export function createOwnedCutoverPolicy() {
  let mode = 'old', generation = 0, busy = false;
  const snapshot = () => ({ mode, generation });
  const target = (method, pathname) => {
    if (!pathname.startsWith('/') || /[%\\]|\/\//.test(pathname)) return null;
    if (mode === 'candidate') return 'candidate';
    if (mode === 'old') return 'old';
    if (pathname.startsWith('/api/member-checkout/')) return retainedRoutes.get(pathname) === method ? 'candidate' : null;
    // Dev assets cannot be mixed across versions. This harness proves HTTP
    // APIs only; it must not pretend to validate rollback of checkout page UI.
    if (pathname === '/api/member-checkout' || pathname.startsWith('/member-checkout/')) return null;
    return 'old';
  };
  const promote = async (next, expected, probe) => {
    assert.equal(busy, false, 'cutover_already_in_progress');
    assert.equal(expected, generation, 'cutover_stale_generation');
    assert.ok(mode === 'old' && next === 'candidate' || mode === 'candidate' && next === 'retained' || mode === 'retained' && next === 'candidate', 'cutover_transition_refused');
    busy = true;
    try {
      assert.equal(await probe(next), true, 'cutover_readiness_refused');
      assert.equal(expected, generation, 'cutover_stale_generation');
      mode = next; generation++; return snapshot();
    } finally { busy = false; }
  };
  return { snapshot, target, promote };
}
