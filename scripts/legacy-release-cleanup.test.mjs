import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {legacyReferences, savedPm2References, isLegacyReleaseDirectory, planLegacyReleaseCleanup, isPreservedLegacyFile, inspectLegacyCandidate,
  assertLegacyObservationUnchanged, executeLegacyReleaseCleanup} from './legacy-release-cleanup.mjs';

const root = '/www/wwwroot/merchant-space.releases';
const first = `${root}/aaaaaaaaaaaa-20260901010101`, second = `${root}/bbbbbbbbbbbb-20260902020202`;
const current = `${root}/cccccccccccc-20260903030303`;
function observation() {
  return {version: 1, base: {releaseDirectories: [first, second, current], protectedDirectories: [current],
    pm2: [{cwd: current, name: 'merchant-space'}], activeSha256: 'active', worktreesSha256: 'worktrees'},
  recovery: {protectedDirectories: [], hashes: ['closed-proof']}, extraProtected: [], docker: [], shared: {ino: 1}};
}
function fixture() {
  const frozen = observation(), trees = [first, second].map(directory => ({directory, bytes: 1}));
  const plan = {version: 1, toolRevision: 'a'.repeat(40), observation: frozen, trees};
  const trace = [], removed = [];
  const operations = {
    observe: () => ({...structuredClone(frozen), base: {...structuredClone(frozen.base), releaseDirectories: frozen.base.releaseDirectories.filter(p => !removed.includes(p))}}),
    readManifest: item => ({...item, kind: 'fixture'}), capture: directory => ({directory, bytes: 1, kind: 'fixture'}),
    verifyArchive: () => trace.push('archive'), begin: () => trace.push('begin'),
    apply: tree => {removed.push(tree.directory); trace.push(`remove:${tree.directory}`); return {removedBytes: 1};},
    record: index => trace.push(`record:${index}`), finish: () => trace.push('finish'), failed: (results, details) => trace.push({results, details}),
  };
  return {frozen, plan, trace, removed, operations};
}
test('only canonical legacy roots are eligible', () => {
  assert.equal(isLegacyReleaseDirectory(first), true);
  for (const value of [root, root + '/', first + '/..', first + '/child', first + '\n', first.replace('aaaaaaaaaaaa', 'AAAAAAAAAAAA'),
    '/www/wwwroot/merchant-space', first.replace('.releases/', '.web-releases/'), '/tmp' + first, 'C:' + first])
    assert.equal(isLegacyReleaseDirectory(value), false, value);
});
test('references extract legacy path or broad parent conservatively', () => {
  assert.deepEqual(legacyReferences({secret: `node ${first}/node_modules/ffmpeg -x`, other: second}), [first, second]);
  assert.deepEqual(legacyReferences(root + '/*'), [root]);
  assert.deepEqual(legacyReferences('/www/wwwroot/merchant-space.web-releases/aaaaaaaaaaaa-online'), []);
});
test('saved PM2 references decode JSON escapes and reject corrupt non-array dumps', () => {
  assert.deepEqual(savedPm2References(JSON.stringify([{cwd: first}]).replaceAll('/', '\\u002f')), [first]);
  assert.deepEqual(savedPm2References(JSON.stringify([{cwd: first}]).replaceAll('/', '\\/')), [first]);
  for (const value of ['{broken', '{}', 'null']) assert.throws(() => savedPm2References(value), /saved_pm2_invalid/);
});
test('ordinary observation leaves two legacy candidates', () => {
  assert.deepEqual(planLegacyReleaseCleanup(observation()), {eligible: [first, second], excluded: [{directory: current, reason: 'referenced'}]});
});
for (const kind of ['base', 'extra', 'recovery', 'pm2']) test(`each ${kind} protection independently excludes candidate`, () => {
  const value = observation();
  if (kind === 'base') value.base.protectedDirectories.push(first + '/.next/static');
  if (kind === 'extra') value.extraProtected.push(first);
  if (kind === 'recovery') value.recovery.protectedDirectories.push(first);
  if (kind === 'pm2') value.base.pm2.push({cwd: first, status: 'stopped'});
  assert.deepEqual(planLegacyReleaseCleanup(value).eligible, [second]);
});
test('broad parent reference protects all releases; no date heuristic', () => {
  const value = observation(); value.extraProtected = [root];
  assert.deepEqual(planLegacyReleaseCleanup(value).eligible, []);
});
test('nonlegacy releases are never candidates', () => {
  const value = observation(); value.base.releaseDirectories.push('/www/wwwroot/merchant-space.web-releases/aaaaaaaaaaaa-online');
  assert.deepEqual(planLegacyReleaseCleanup(value).eligible, [first, second]);
});
test('duplicate candidate inventory is rejected', () => {
  const value = observation(); value.base.releaseDirectories.push(first);
  assert.throws(() => planLegacyReleaseCleanup(value), /duplicate_directory/);
});
test('preserve all source/config/static files, not generated runtime/dependencies', () => {
  for (const relativePath of ['.env.local', 'src/app.ts', 'public/photo.png', 'logs/diagnostic.log', '.next/static/chunks/x.js', '.faolla-current-static-files'])
    assert.equal(isPreservedLegacyFile({relativePath, type: 'file'}), true);
  for (const relativePath of ['node_modules/a/index.js', '.next/server/app.js', '.next/cache/webpack/x', '.next/BUILD_ID'])
    assert.equal(isPreservedLegacyFile({relativePath, type: 'file'}), false);
  assert.equal(isPreservedLegacyFile({relativePath: '.runtime', type: 'symlink'}), false);
  assert.equal(isPreservedLegacyFile({relativePath: 'public', type: 'directory'}), false);
});
test('unsupported tree is explicitly excluded without weakening filesystem proofs', () => {
  const reason = 'legacy_release_tree_unsafe_ownership';
  assert.deepEqual(inspectLegacyCandidate(first, () => {throw Error(reason);}), {excluded: {directory: first, reason}});
  for (const code of ['legacy_release_tree_file_changed', 'legacy_release_tree_filesystem_failure', 'unexpected'])
    assert.throws(() => inspectLegacyCandidate(first, () => {throw Error(code);}), new RegExp(code));
});
test('removal accounts only for exact declared directory inventory changes', () => {
  const before = observation(), after = observation(); after.base.releaseDirectories = [second, current];
  assertLegacyObservationUnchanged(before, after, [first]);
  after.base.activeSha256 = 'changed';
  assert.throws(() => assertLegacyObservationUnchanged(before, after, [first]), /references_changed/);
  assert.throws(() => assertLegacyObservationUnchanged(before, before, [root]), /removed_set_invalid/);
});
test('full preflight then exact removal succeeds and records each result', () => {
  const f = fixture(); assert.equal(executeLegacyReleaseCleanup(f.plan, f.operations).length, 2);
  assert.deepEqual(f.trace, ['archive', 'begin', `remove:${first}`, 'record:1', `remove:${second}`, 'record:2', 'finish']);
});
for (const stage of ['references', 'archive', 'second-tree', 'ineligible', 'duplicate']) test(`preflight ${stage} failure deletes nothing`, () => {
  const f = fixture();
  if (stage === 'references') f.operations.observe = () => ({...observation(), shared: {ino: 2}});
  if (stage === 'archive') f.operations.verifyArchive = () => {throw Error('archive_changed');};
  if (stage === 'second-tree') {const capture = f.operations.capture; f.operations.capture = dir => ({...capture(dir), ...(dir === second ? {bytes: 2} : {})});}
  if (stage === 'ineligible') f.plan.trees[1].directory = current;
  if (stage === 'duplicate') f.plan.trees[1].directory = first;
  assert.throws(() => executeLegacyReleaseCleanup(f.plan, f.operations));
  assert.deepEqual(f.removed, []); assert.ok(!f.trace.includes('begin'));
});
test('late observer drift stops before next release, records partial completion', () => {
  const f = fixture(), observe = f.operations.observe;
  f.operations.observe = () => ({...observe(), ...(f.removed.length ? {shared: {ino: 2}} : {})});
  assert.throws(() => executeLegacyReleaseCleanup(f.plan, f.operations), /references_changed/);
  assert.deepEqual(f.removed, [first]);
  assert.equal(f.trace.at(-1).results.length, 1); assert.equal(f.trace.at(-1).details.partialCleanupPossible, false);
  assert.ok(!f.trace.includes('finish'));
});
test('within-tree failure identifies partial cleanup and does not retry', () => {
  const f = fixture(); let attempts = 0;
  f.operations.apply = () => {attempts++; throw Error('legacy_release_tree_filesystem_failure');};
  assert.throws(() => executeLegacyReleaseCleanup(f.plan, f.operations), /filesystem_failure/);
  assert.equal(attempts, 1); assert.equal(f.trace.at(-1).details.attemptedDirectory, first);
  assert.equal(f.trace.at(-1).details.partialCleanupPossible, true);
});
test('secret-looking unexpected errors do not enter failure audit', () => {
  const f = fixture(); f.operations.apply = () => {throw Error('password=private');};
  assert.throws(() => executeLegacyReleaseCleanup(f.plan, f.operations));
  assert.equal(f.trace.at(-1).details.error, 'unexpected_failure');
});
test('production CLI uses shared locks, exact reviewed source and one-shot private receipts', () => {
  const source = readFileSync(new URL('./legacy-release-cleanup.mjs', import.meta.url), 'utf8');
  for (const needle of ['withOnlineToolPreparationLocks', 'observeReleaseResources(revision)', 'readLegacyReleaseRecovery()',
    'plan_already_attempted', 'plan_hash_changed', 'plan_context_expired', 'O_EXCL', 'O_NOFOLLOW', 'fs.fsyncSync',
    'source_changed', 'archive_coverage_changed', 'archive_hash_changed', 'verifyArchive', 'dump.pm2.bak',
    'docker', '/environ', 'worktree', 'legacy-release-tree.mjs', 'legacy-release-recovery.mjs']) assert.ok(source.includes(needle), needle);
  assert.doesNotMatch(source, /\brmSync\b|rm -rf|pm2', \['(?:delete|stop)|nginx', \['-s'|process\.env\.[A-Z_]*(?:BYPASS|LOCKED)/);
});
test('malformed CLI invocation fails without attempting production observation', () => {
  const result = spawnSync(process.execPath, [new URL('./legacy-release-cleanup.mjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), 'apply', 'bad'], {encoding: 'utf8'});
  assert.notEqual(result.status, 0); assert.match(result.stderr, /legacy_release_cleanup_invocation_invalid/);
});
