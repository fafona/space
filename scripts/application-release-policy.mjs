// Reviewed data selects a release; release code must not acquire a new SHA or
// feature-specific exception for each ordinary application change.
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {toolOnlySourcePath} from './release-toolchain-source.mjs';

export const APPLICATION_RELEASE_LANE = 'reviewed-application-code-only-v1';
export const APPLICATION_RELEASE_MANIFEST = 'release/application-release.json';
const sha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const need = (value, reason) => {if (!value) throw Error('application_release_' + reason);};
const same = (actual, expected, reason) => need(isDeepStrictEqual(actual, expected), reason);
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
export const applicationReleaseHash = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const testPath = file => /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file);
const forbiddenPath = file => /(^|\/)(?:\.env(?:\.[^/]*)?|node_modules)(?:\/|$)/.test(file) ||
  /(^|\/)(?:supabase-migrations|migrations)(?:\/|$)/.test(file) || /\.(?:sql|lock)$/.test(file) || file === 'package-lock.json';

export function applicationReleaseRole(file) {
  need(typeof file === 'string' && file.length < 400 && !/[\x00-\x20\\]/.test(file) &&
    !file.startsWith('/') && !file.split('/').some(part => !part || part === '.' || part === '..'), 'path');
  need(!forbiddenPath(file), 'code_only_scope');
  if (testPath(file) || /^scripts\/[a-z0-9-]+-browser-acceptance\.mjs$/.test(file) || file.startsWith('docs/') || file.startsWith('.github/')) return 'verification';
  if (toolOnlySourcePath(file) || /^scripts\/application-release[\w-]*\.mjs$/.test(file)) return 'release-tool';
  if (file === 'package.json') return 'test-scripts-only';
  if (file.startsWith('src/') || file.startsWith('public/') ||
    ['middleware.ts', 'next.config.ts', 'next.config.mjs', 'next.config.js', 'tsconfig.json', 'postcss.config.mjs'].includes(file)) return 'application';
  throw Error('application_release_unclassified_path');
}

// No renamed-path shortcut: bind every changed blob, including deletions, modes,
// tests and operational inputs. The manifest alone is excluded to avoid a
// self-referential Git hash. It is still pinned by the reviewed target commit.
export function applicationReleaseChanges(baselineRows, targetRows) {
  const index = rows => {
    need(Array.isArray(rows) && rows.length > 0, 'inventory');
    const map = new Map();
    for (const row of rows) {
      need(row && sha(row.oid) && ['100644', '100755'].includes(row.mode) && !map.has(row.file), 'inventory');
      map.set(row.file, row);
    }
    return map;
  };
  const before = index(baselineRows), after = index(targetRows);
  return [...new Set([...before.keys(), ...after.keys()])].sort().flatMap(file => {
    if (file === APPLICATION_RELEASE_MANIFEST) return [];
    const a = before.get(file), b = after.get(file);
    if (a?.oid === b?.oid && a?.mode === b?.mode) return [];
    return [{file, role: applicationReleaseRole(file), before: a ? [a.mode, a.oid] : null, after: b ? [b.mode, b.oid] : null}];
  });
}

export function assertApplicationReleasePackage(before, after) {
  need(before && after && typeof before.scripts === 'object' && typeof after.scripts === 'object', 'package');
  same({...after, scripts: before.scripts}, before, 'dependency_or_package_change');
  const names = new Set([...Object.keys(before.scripts), ...Object.keys(after.scripts)]);
  for (const name of names) if (before.scripts[name] !== after.scripts[name]) {
    need(/^test(?::[a-z0-9-]+)?$/.test(name) && typeof after.scripts[name] === 'string' &&
      after.scripts[name].length > 0 && after.scripts[name].length < 4000, 'build_or_lifecycle_change');
  }
  return true;
}

export function createApplicationReleaseManifest({baseline, baselineRows, targetRows, focusedTests, purpose}) {
  const changes = applicationReleaseChanges(baselineRows, targetRows);
  const value = {schemaVersion: 1, kind: APPLICATION_RELEASE_LANE, baseline, purpose,
    database: 'unchanged', dependencies: 'unchanged', environment: 'inherit-protected',
    mail: 'unchanged-off', backgroundTasks: 'retain-certified-worker', changes, focusedTests};
  assertApplicationReleaseManifest(value, {baseline, baselineRows, targetRows});
  return value;
}

export function assertApplicationReleaseManifest(value, {baseline, baselineRows, targetRows}) {
  need(value && sha(baseline) && value.baseline === baseline && value.schemaVersion === 1 && value.kind === APPLICATION_RELEASE_LANE, 'manifest_identity');
  same(Object.keys(value).sort(), ['schemaVersion','kind','baseline','purpose','database','dependencies','environment','mail','backgroundTasks','changes','focusedTests'].sort(), 'manifest_shape');
  need(typeof value.purpose === 'string' && value.purpose.trim().length >= 8 && value.purpose.length <= 1000 &&
    !/[\x00-\x1f]/.test(value.purpose), 'manifest_purpose');
  need(value.database === 'unchanged' && value.dependencies === 'unchanged' && value.environment === 'inherit-protected' &&
    value.mail === 'unchanged-off' && value.backgroundTasks === 'retain-certified-worker', 'manifest_capabilities');
  const changes = applicationReleaseChanges(baselineRows, targetRows);
  same(value.changes, changes, 'manifest_scope_changed');
  // The independently certified booking worker still executes its immutable
  // application. A booking-runtime or protocol change needs a worker-aware
  // release, not this website-only compatibility claim.
  need(!changes.some(row=>row.role==='application'&&/^src\/lib\/merchantBooking[^/]*\.server\.ts$/.test(row.file)), 'worker_runtime_change');
  need(changes.some(row => row.role === 'application') && changes.some(row => row.role === 'verification'), 'empty_application_or_verification');
  need(Array.isArray(value.focusedTests) && value.focusedTests.length > 0 && value.focusedTests.length <= 100 &&
    new Set(value.focusedTests).size === value.focusedTests.length, 'focused_tests');
  for (const file of value.focusedTests) need(testPath(file) && applicationReleaseRole(file) === 'verification' &&
    targetRows.some(row => row.file === file), 'focused_test_missing');
  return {lane: APPLICATION_RELEASE_LANE, manifestSha256: applicationReleaseHash(value), changedPaths: changes.length,
    applicationPaths: changes.filter(row => row.role === 'application').map(row => row.file)};
}

// Only a consecutive, hash-validated retained web successor is compatible with
// the original immutable booking application. A live JSON target on its own is
// never proof. Candidate transitions are deliberately denied until certified.
export function assertApplicationWorkerSuccessor({history, publication, actualActive}) {
  const index = history.entries.indexOf(publication);
  need(index >= 0 && publication.kind === 'booking-handoff', 'worker_publication');
  let previous = publication;
  for (const entry of history.entries.slice(index + 1)) {
    if (entry.kind === 'converge') {
      const restored=entry.rollbackProof;
      if(restored)need(restored.from?.target===previous.active.target&&restored.to?.target===previous.rollback.target,'worker_rollback_proof');
      const baseline=restored?previous.rollback.target:previous.active.target;
      need(entry.rollback.target === baseline && entry.victim === null &&
        entry.applicationRelease?.kind === APPLICATION_RELEASE_LANE &&
        entry.applicationRelease.baseline === baseline && /^[a-f0-9]{64}$/.test(entry.applicationRelease.manifestSha256 ?? ''), 'worker_successor');
    } else need(['retire', 'booking-worker'].includes(entry.kind) &&
      entry.active.target === previous.active.target && entry.rollback.target === previous.rollback.target, 'worker_successor');
    previous = entry;
  }
  need([previous.active.target, previous.rollback.target].includes(actualActive?.target), 'worker_active');
  return true;
}

export function assertApplicationReleaseCertificate(value, {kind, baseline, target}) {
  if (value === undefined) return false;
  need(kind === 'converge' && value && value.kind === APPLICATION_RELEASE_LANE &&
    sha(baseline) && sha(target) && value.baseline === baseline && value.target === target && baseline !== target &&
    /^[a-f0-9]{64}$/.test(value.manifestSha256 ?? ''), 'certificate_binding');
  same(Object.keys(value).sort(), ['kind','baseline','target','manifestSha256'].sort(), 'certificate_shape');
  return true;
}
