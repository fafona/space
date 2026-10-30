// Only the two fixed, already-built booking applications. The cache is neither
// serialized nor caller-populated; full original byte verification is required
// before work starts. Every use checks nanosecond inode/content-change facts.
import {AsyncLocalStorage} from 'node:async_hooks';
import {isDeepStrictEqual} from 'node:util';
import {BOOKING_HANDOFF_CANDIDATE as C} from './booking-handoff-policy.mjs';
import {BOOKING_BUILT_SMOKE_PINS as P} from './booking-built-smoke-repair-policy.mjs';
import {BOOKING_DEPENDENCY_STATES as STATES} from './booking-dependency-continuation-policy.mjs';
import {runOnlineToolGit} from './prepare-online-release-tool.mjs';
import {captureFileContinuity} from './release-toolchain-file-continuity.mjs';
const current = new AsyncLocalStorage(), issued = new WeakSet(), APP = '/www/wwwroot/merchant-space';
function specification() {
  const files = [], trees = [], heads = [], candidateOperation = '/var/lib/faolla-online-release/' + C;
  for (const pin of P.pair) {
    const operation = '/var/lib/faolla-online-release/' + pin.target;
    const directory = APP + '.web-releases/' + pin.target.slice(0, 12) + '-online';
    heads.push([directory, pin.target]);
    for (const row of runOnlineToolGit(APP, ['ls-tree', '-r', '-z', pin.target]).toString().split('\0').filter(Boolean)) {
      const match = /^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/.exec(row);
      if (!match || match[3].split('/').some(value => ['', '.', '..'].includes(value))) throw Error('release_static_attestation_changed');
      files.push(directory + '/' + match[3]);
    }
    files.push(directory + '/.env.local');
    for (const name of Object.keys(pin.files)) files.push(name === 'state.json'
      ? (pin.target === C ? candidateOperation + '/built-smoke-original-state.json' : candidateOperation + '/' + STATES.rollback.file)
      : operation + '/' + name);
    files.push(pin.target === C ? operation + '/' + STATES.primary.file : operation + '/rollback-built.json');
    trees.push({root: directory + '/node_modules', allowInternalLinks: true},
      {root: directory + '/.next', exclude: ['cache', 'trace']});
  }
  return {files, trees, heads};
}
function verify(context) {
  if (!issued.has(context) || context.closed) throw Error('release_static_attestation_invalid');
  context.continuity.assertUnchanged();
  for (const [directory, expected] of context.heads) {
    if (runOnlineToolGit(directory, ['rev-parse', 'HEAD']).toString().trim() !== expected ||
        runOnlineToolGit(directory, ['status', '--porcelain=v1', '--untracked-files=all']).toString().trim()) throw Error('release_static_attestation_changed');
  }
}
export function currentRetainedApplicationAttestation() {
  const context = current.getStore();
  if (!context) return null;
  verify(context);
  return structuredClone(context.application);
}
export async function withRetainedApplicationAttestation(work) {
  if (process.platform !== 'linux' || process.getuid?.() !== 0 || current.getStore() || typeof work !== 'function') throw Error('release_static_attestation_invalid');
  const {heads, ...spec} = specification(), continuity = captureFileContinuity(spec);
  // Dynamic import avoids a cycle and always executes the ORIGINAL full path:
  // the ALS context has not been installed yet.
  const {observeBookingReadyApplication} = await import('./booking-ready-backup.mjs');
  const application = observeBookingReadyApplication();
  continuity.assertUnchanged();
  const context = {heads, continuity, application: structuredClone(application), closed: false};
  issued.add(context);
  verify(context);
  try {
    return await current.run(context, async () => {
      const result = await work();
      verify(context);
      if (!isDeepStrictEqual(application, context.application)) throw Error('release_static_attestation_changed');
      return result;
    });
  } finally { context.closed = true; }
}
