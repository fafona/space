import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import {WEB_RELEASE_FILES} from './web-presentation-release-policy.mjs';
import {createOnlineReleaseToolPlan, executeOnlineReleaseToolPlan, verifyOnlineReleaseTool,
  verifyOnlineToolBootstrap, assertOnlineToolOwnedPath, assertOnlineToolNoPending,
  withOnlineToolPreparationLocks, prepareOnlineReleaseToolMain, TOOL_REQUIRED_FILES,
  TOOL_SPARSE_PATTERNS, UNPUBLISHED_CANDIDATE_INCIDENT, UNPUBLISHED_CANDIDATE_ABSENT_PATHS,
  UNPUBLISHED_CANDIDATE_PRESERVED_FILES, createUnpublishedCandidateTerminationReceipt,
  assertUnpublishedCandidateTerminationReceipt, UNPUBLISHED_BUILD_ENVIRONMENT_INCIDENT,
  UNPUBLISHED_BUILD_ENVIRONMENT_ABSENT_PATHS, UNPUBLISHED_BUILD_ENVIRONMENT_PRESERVED_FILES,
  UNPUBLISHED_BUILD_ENVIRONMENT_FILE_SHA256, UNPUBLISHED_BUILD_ENVIRONMENT_PRESERVED_DIRECTORIES,
  createUnpublishedBuildEnvironmentTerminationReceipt, assertUnpublishedBuildEnvironmentTerminationReceipt} from './prepare-online-release-tool.mjs';

const self = fileURLToPath(new URL('./prepare-online-release-tool.mjs', import.meta.url));
test('bootstrap remains builtin-only until CLI loads housekeeping from the verified target', () => {
  const source = fs.readFileSync(self, 'utf8');
  assert.deepEqual([...source.matchAll(/^import .+ from '([^']+)';$/gm)].map(match => match[1]),
    ['node:fs', 'node:path', 'node:crypto', 'node:child_process', 'node:url']);
  assert.doesNotMatch(source, /\brequire\s*\(/);
  assert.equal([...source.matchAll(/\bimport\s*\(/g)].length, 1);
  assert.ok(source.indexOf('const prepared = prepareOnlineReleaseToolMain();') < source.indexOf('import(`file://${prepared.directory}/scripts/online-release-tool-retention.mjs`)'));
  assert.match(source, /runOnlineReleaseToolRetention\(\{target: prepared\.target, bootstrapDirectory\}\)/);
  assert.match(source, /\.\.\.prepared, toolRetention/);
  assert.match(source, /toolRetention: \{status: 'pending', reason: 'online_tool_retention_module_unavailable'\}/);
});
function fixturePath(location, kind = 'directory') {
  const value = fs.lstatSync(location);
  assert.equal(value.isSymbolicLink(), false, location);
  assert.equal(kind === 'directory' ? value.isDirectory() : value.isFile(), true, location);
  assert.equal(fs.realpathSync(location), location, location);
}
function fixtureGit(cwd, args, input) {
  const result = spawnSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'core.autocrlf=false', '-c', 'core.eol=lf', ...args], {
    cwd, input, encoding: 'utf8', timeout: 30000, windowsHide: true,
    env: {PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, HOME: cwd, USERPROFILE: cwd,
      GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null', GIT_TERMINAL_PROMPT: '0'},
  });
  assert.equal(result.error, undefined); assert.equal(result.status, 0, `${args.join(' ')}: ${result.stderr}`);
  return result.stdout;
}
function fixture(t) {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'online-tool-fixture-')));
  t.after(() => {assert.ok(path.basename(directory).startsWith('online-tool-fixture-')); fs.rmSync(directory, {recursive: true});});
  const app = path.join(directory, 'repository'), toolRoot = path.join(directory, 'tools');
  fs.mkdirSync(app); fs.mkdirSync(toolRoot);
  fixtureGit(app, ['init']); fixtureGit(app, ['config', 'user.name', 'Fixture']); fixtureGit(app, ['config', 'user.email', 'fixture@example.invalid']);
  const files = new Map(TOOL_REQUIRED_FILES.map(name => [name, name === 'scripts/prepare-online-release-tool.mjs' ? fs.readFileSync(self) : `fixture ${name}\n`]));
  files.set('src/nested/source.ts', 'export const fixture = 1;\n');
  files.set('public/traffic-card-v1.js', 'retained\n');
  files.set('public/downloads/large.zip', 'synthetic archive\n');
  files.set('public/downloads/nested/test.txt', 'omitted\n');
  files.set('public/downloads-other/keep.txt', 'keep sibling\n');
  files.set('docs/public/downloads/keep.md', 'keep non-root path\n');
  files.set('.gitignore', '/node_modules\n/.next\n.env.local\n');
  for (const [name, value] of files) {const location = path.join(app, name); fs.mkdirSync(path.dirname(location), {recursive: true}); fs.writeFileSync(location, value);}
  fixtureGit(app, ['add', '.']); fixtureGit(app, ['commit', '-m', 'Synthetic source']);
  const target = fixtureGit(app, ['rev-parse', 'HEAD']).trim(); fixtureGit(app, ['update-ref', 'refs/remotes/origin/main', target]);
  const plan = createOnlineReleaseToolPlan(target, {app, toolRoot}), calls = [];
  const ports = {checkPath: fixturePath, git: (cwd, args, input) => {calls.push({cwd, args, input}); return fixtureGit(cwd, args, input);}};
  return {directory, app, toolRoot, target, plan, ports, calls, files};
}
function sparseFile(f) {return path.resolve(f.plan.directory, fixtureGit(f.plan.directory, ['rev-parse', '--git-path', 'info/sparse-checkout']).trim());}

test('fixed plan rejects traversal, arbitrary roots/options and mutated plans', () => {
  for (const target of ['', '../bad', 'a'.repeat(39), 'A'.repeat(40), 'a'.repeat(40) + '\n']) assert.throws(() => createOnlineReleaseToolPlan(target), /invocation_invalid/);
  assert.throws(() => createOnlineReleaseToolPlan('a'.repeat(40), {extra: true}));
  assert.throws(() => createOnlineReleaseToolPlan('a'.repeat(40), {app: 'relative'}));
  const root = path.parse(path.resolve('.')).root;
  assert.throws(() => createOnlineReleaseToolPlan('a'.repeat(40), {app: path.join(root, 'repo'), toolRoot: path.join(root, 'repo', 'nested')}));
  const plan = createOnlineReleaseToolPlan('a'.repeat(40), {app: path.join(root, 'repo'), toolRoot: path.join(root, 'tools')});
  assert.throws(() => executeOnlineReleaseToolPlan({...plan, sparsePatterns: '/*\n'}), /plan_changed/);
  assert.throws(() => prepareOnlineReleaseToolMain(['a'.repeat(40), '--force']), /invocation_invalid/);
});

test('real Git creates detached sparse source-only checkout with all other source bytes intact', t => {
  const f = fixture(t), result = executeOnlineReleaseToolPlan(f.plan, f.ports);
  assert.equal(result.created, true); assert.equal(result.verified, true); assert.equal(result.excludedFiles, 2);
  assert.equal(verifyOnlineReleaseTool(f.plan, f.ports).inventorySha256, result.inventorySha256);
  assert.equal(fs.existsSync(path.join(f.plan.directory, 'public/downloads')), false);
  for (const [name, bytes] of f.files) if (!name.startsWith('public/downloads/')) assert.deepEqual(fs.readFileSync(path.join(f.plan.directory, name)), Buffer.from(bytes));
  assert.equal(fs.existsSync(path.join(f.plan.directory, 'node_modules')), false);
  assert.equal(fs.existsSync(path.join(f.plan.directory, '.next')), false);
  assert.deepEqual(f.calls.find(call => call.args[0] === 'worktree').args, ['worktree', 'add', '--detach', '--no-checkout', f.plan.directory, f.target]);
  assert.deepEqual(f.calls.find(call => call.args.includes('sparse-checkout')).args, ['-c', 'index.sparse=false', 'sparse-checkout', 'set', '--no-cone', '--stdin']);
  assert.equal(f.calls.find(call => call.args.includes('sparse-checkout')).input, TOOL_SPARSE_PATTERNS);
  const configWrites = f.calls.filter(call => call.args[0] === 'config' && !call.args.includes('--get'));
  assert.deepEqual(configWrites.map(call => call.args), [
    ['config', '--worktree', 'core.sparseCheckoutCone', 'false'],
    ['config', '--worktree', 'index.sparse', 'false'],
  ]);
  assert.equal(f.calls.some(call => call.args.includes('--no-sparse-index')), false);
  assert.deepEqual(f.calls.find(call => call.args[0] === 'read-tree').args, ['read-tree', '-mu', 'HEAD']);
  assert.ok(f.calls.findIndex(call => call.args[0] === 'read-tree') > f.calls.indexOf(configWrites[1]));
  assert.ok(f.calls.indexOf(configWrites[0]) > f.calls.findIndex(call => call.args.includes('sparse-checkout')));
  assert.equal(f.calls.some(call => call.args.some(arg => ['--force', 'fetch', 'reset', 'clean'].includes(arg))), false);
});

test('existing verified sparse tool is read-only and old full tool is refused without conversion', t => {
  const f = fixture(t); executeOnlineReleaseToolPlan(f.plan, f.ports); f.calls.length = 0;
  const bytes = fs.readFileSync(sparseFile(f));
  assert.equal(executeOnlineReleaseToolPlan(f.plan, f.ports).created, false);
  assert.deepEqual(fs.readFileSync(sparseFile(f)), bytes);
  assert.equal(f.calls.some(call => call.args[0] === 'worktree' || call.args.includes('sparse-checkout')), false);
  const otherRoot = path.join(f.directory, 'old-tools'); fs.mkdirSync(otherRoot);
  const plan = createOnlineReleaseToolPlan(f.target, {app: f.app, toolRoot: otherRoot});
  fixtureGit(f.app, ['worktree', 'add', '--detach', plan.directory, f.target]); f.calls.length = 0;
  assert.throws(() => executeOnlineReleaseToolPlan(plan, f.ports));
  assert.deepEqual(fs.readFileSync(path.join(plan.directory, 'public/downloads/large.zip')), Buffer.from('synthetic archive\n'));
  assert.equal(f.calls.some(call => call.args[0] === 'worktree' || call.args.includes('sparse-checkout')), false);
});

test('wrong origin/main fails before a target directory is created', t => {
  const f = fixture(t);
  const git = (cwd, args, input) => args[0] === 'rev-parse' && args[1] === 'origin/main' ? 'b'.repeat(40) : f.ports.git(cwd, args, input);
  assert.throws(() => executeOnlineReleaseToolPlan(f.plan, {...f.ports, git}), /target_not_main/);
  assert.equal(fs.existsSync(f.plan.directory), false);
});

for (const mutation of ['dirty', 'pattern', 'ignored', 'omitted-source', 'download-resurrection', 'missing-cone']) {
  test(`existing tool rejects ${mutation} and never repairs it`, t => {
    const f = fixture(t); executeOnlineReleaseToolPlan(f.plan, f.ports);
    if (mutation === 'dirty') fs.appendFileSync(path.join(f.plan.directory, 'src/nested/source.ts'), 'changed');
    if (mutation === 'pattern') fs.writeFileSync(sparseFile(f), '/*\n!/public/downloads/\n!/src/\n');
    if (mutation === 'ignored') fs.mkdirSync(path.join(f.plan.directory, 'node_modules'));
    if (mutation === 'omitted-source') {
      fixtureGit(f.plan.directory, ['update-index', '--skip-worktree', 'src/nested/source.ts']); fs.unlinkSync(path.join(f.plan.directory, 'src/nested/source.ts'));
    }
    if (mutation === 'download-resurrection') fs.mkdirSync(path.join(f.plan.directory, 'public/downloads'));
    if (mutation === 'missing-cone') fixtureGit(f.plan.directory, ['config', '--worktree', '--unset', 'core.sparseCheckoutCone']);
    f.calls.length = 0; assert.throws(() => executeOnlineReleaseToolPlan(f.plan, f.ports));
    assert.equal(f.calls.some(call => call.args[0] === 'worktree' || call.args.includes('sparse-checkout')), false);
    assert.equal(f.calls.some(call => call.args[0] === 'config' && !call.args.includes('--get')), false);
  });
}

test('checkout failure leaves its evidence directory and retry cannot overwrite it', t => {
  const f = fixture(t);
  const ports = {...f.ports, git: (cwd, args, input) => {
    if (args.includes('sparse-checkout')) throw Error('injected failure');
    return f.ports.git(cwd, args, input);
  }};
  assert.throws(() => executeOnlineReleaseToolPlan(f.plan, ports), /injected failure/);
  assert.equal(fs.existsSync(path.join(f.plan.directory, '.git')), true);
  f.calls.length = 0; assert.throws(() => executeOnlineReleaseToolPlan(f.plan, f.ports));
  assert.equal(f.calls.some(call => call.args[0] === 'worktree' || call.args.includes('sparse-checkout')), false);
});

test('source symlinks are rejected from Git inventory before any checkout', t => {
  const f = fixture(t);
  const git = (cwd, args, input) => args[0] === 'ls-tree' ? `120000 blob ${'a'.repeat(40)}\tlink\0` : f.ports.git(cwd, args, input);
  assert.throws(() => executeOnlineReleaseToolPlan(f.plan, {...f.ports, git}), /source_entry_invalid/);
  assert.equal(fs.existsSync(f.plan.directory), false);
});

test('real target-directory junction/symlink is rejected without traversing or deleting it', t => {
  const f = fixture(t), outside = path.join(f.directory, 'outside'); fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'keep'), 'untouched');
  fs.symlinkSync(outside, f.plan.directory, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => executeOnlineReleaseToolPlan(f.plan, f.ports));
  assert.equal(fs.readFileSync(path.join(outside, 'keep'), 'utf8'), 'untouched');
  assert.equal(fs.lstatSync(f.plan.directory).isSymbolicLink(), true);
});

test('bootstrap accepts only the exact clean target source and its target Git blob', t => {
  const f = fixture(t), entry = path.join(f.app, 'scripts/prepare-online-release-tool.mjs');
  verifyOnlineToolBootstrap(f.plan, entry, f.ports);
  const bootstrap = path.join(f.directory, 'bootstrap');
  fixtureGit(f.app, ['worktree', 'add', '--detach', bootstrap, f.target]);
  verifyOnlineToolBootstrap(f.plan, path.join(bootstrap, 'scripts/prepare-online-release-tool.mjs'), f.ports);
  fs.appendFileSync(entry, '\n// changed');
  assert.throws(() => verifyOnlineToolBootstrap(f.plan, entry, f.ports), /bootstrap_source_changed/);
  const hideDirty = {...f.ports, git: (cwd, args, input) => args[0] === 'status' ? '' : f.ports.git(cwd, args, input)};
  assert.throws(() => verifyOnlineToolBootstrap(f.plan, entry, hideDirty), /bootstrap_source_changed/);
});

test('clean known-ancestor helper can prepare a later target only while helper bytes stay identical', t => {
  const f = fixture(t), bootstrap = path.join(f.directory, 'older-bootstrap');
  fixtureGit(f.app, ['worktree', 'add', '--detach', bootstrap, f.target]);
  const entry = path.join(bootstrap, 'scripts/prepare-online-release-tool.mjs');
  fs.writeFileSync(path.join(f.app, 'docs/next-release.md'), 'synthetic later release\n');
  fixtureGit(f.app, ['add', 'docs/next-release.md']); fixtureGit(f.app, ['commit', '-m', 'Later release, unchanged helper']);
  const nextTarget = fixtureGit(f.app, ['rev-parse', 'HEAD']).trim();
  fixtureGit(f.app, ['update-ref', 'refs/remotes/origin/main', nextTarget]);
  const nextPlan = createOnlineReleaseToolPlan(nextTarget, {app: f.app, toolRoot: f.toolRoot});
  verifyOnlineToolBootstrap(nextPlan, entry, f.ports);
  assert.notEqual(f.target, nextTarget);
  assert.ok(f.calls.some(call => JSON.stringify(call.args) === JSON.stringify(['merge-base', '--is-ancestor', f.target, nextTarget])));
  assert.equal(executeOnlineReleaseToolPlan(nextPlan, f.ports).created, true);
  fs.appendFileSync(path.join(f.app, 'scripts/prepare-online-release-tool.mjs'), '\n// reviewed helper update\n');
  fixtureGit(f.app, ['add', 'scripts/prepare-online-release-tool.mjs']); fixtureGit(f.app, ['commit', '-m', 'Changed helper']);
  const changedTarget = fixtureGit(f.app, ['rev-parse', 'HEAD']).trim();
  fixtureGit(f.app, ['update-ref', 'refs/remotes/origin/main', changedTarget]);
  const changedPlan = createOnlineReleaseToolPlan(changedTarget, {app: f.app, toolRoot: f.toolRoot});
  assert.equal(fixtureGit(bootstrap, ['status', '--porcelain=v1', '--untracked-files=all']).trim(), '');
  assert.throws(() => verifyOnlineToolBootstrap(changedPlan, entry, f.ports), /bootstrap_source_changed/);
  assert.equal(fs.existsSync(changedPlan.directory), false);
});

test('an unrelated clean checkout with identical helper bytes is not a known bootstrap ancestor', t => {
  const f = fixture(t), tree = fixtureGit(f.app, ['rev-parse', 'HEAD^{tree}']).trim();
  const unrelatedHead = fixtureGit(f.app, ['commit-tree', tree], 'Unrelated history\n').trim();
  const unrelated = path.join(f.directory, 'unrelated-bootstrap');
  fixtureGit(f.app, ['worktree', 'add', '--detach', unrelated, unrelatedHead]);
  assert.notEqual(unrelatedHead, f.target);
  assert.throws(() => verifyOnlineToolBootstrap(f.plan, path.join(unrelated, 'scripts/prepare-online-release-tool.mjs'), f.ports));
  assert.equal(fs.existsSync(f.plan.directory), false);
});

test('ownership guard checks every ancestor, file links, root ownership and writable modes', () => {
  const root = path.parse(path.resolve('.')).root, directory = path.join(root, 'private', 'tool');
  const normal = {uid: 0, mode: 0o700, nlink: 1, isDirectory: () => true, isFile: () => false, isSymbolicLink: () => false};
  for (const patch of [{uid: 1000}, {mode: 0o777}, {isSymbolicLink: () => true}]) {
    assert.throws(() => assertOnlineToolOwnedPath(directory, 'directory', {
      lstatSync: current => current === path.dirname(directory) ? {...normal, ...patch} : normal, realpathSync: value => value,
    }), /unsafe_path/);
  }
  assert.throws(() => assertOnlineToolOwnedPath(directory, 'file', {lstatSync: () => ({...normal, nlink: 2, isDirectory: () => false, isFile: () => true}), realpathSync: value => value}), /unsafe_path/);
});

test('pending and incomplete releases or active maintenance reject source preparation', t => {
  const f = fixture(t), maintenance = path.join(f.directory, 'maintenance'), releaseRoot = path.join(f.directory, 'releases');
  fs.mkdirSync(maintenance); fs.mkdirSync(releaseRoot); fs.writeFileSync(path.join(maintenance, 'state.json'), '{"phase":"ended"}');
  const release = path.join(releaseRoot, f.target); fs.mkdirSync(release);
  for (const status of ['preparing', 'staged', 'database-ready', 'ready-no-database', 'unknown', 'terminated']) {
    fs.writeFileSync(path.join(release, 'state.json'), JSON.stringify({target: f.target, status}));
    assert.throws(() => assertOnlineToolNoPending({maintenance, releaseRoot}, fixturePath), /release_pending/);
  }
  for (const status of ['active', 'rolled-back']) {
    fs.writeFileSync(path.join(release, 'state.json'), JSON.stringify({target: f.target, status}));
    assertOnlineToolNoPending({maintenance, releaseRoot}, fixturePath);
  }
  fs.writeFileSync(path.join(maintenance, 'state.json'), '{"phase":"prepared"}');
  assert.throws(() => assertOnlineToolNoPending({maintenance, releaseRoot}, fixturePath), /maintenance_not_ended/);
});

test('busy deploy lock never creates operation lock; existing operation lock is preserved', t => {
  const f = fixture(t), maintenance = path.join(f.directory, 'maintenance'); fs.mkdirSync(maintenance);
  const paths = {deployLock: path.join(f.directory, 'deploy.lock'), maintenance}; let called = false;
  assert.throws(() => withOnlineToolPreparationLocks(paths, () => {called = true;}, {checkPath: fixturePath, spawn: () => ({status: 1})}), /deploy_lock_busy/);
  assert.equal(called, false); assert.equal(fs.existsSync(path.join(maintenance, 'operation.lock')), false);
  fs.mkdirSync(path.join(maintenance, 'operation.lock')); fs.writeFileSync(path.join(maintenance, 'operation.lock', 'evidence'), 'keep');
  assert.throws(() => withOnlineToolPreparationLocks(paths, () => {called = true;}, {checkPath: fixturePath, spawn: () => ({status: 0})}));
  assert.equal(called, false); assert.equal(fs.readFileSync(path.join(maintenance, 'operation.lock', 'evidence'), 'utf8'), 'keep');
});

test('only this call empty operation lock is removed, including work failure', t => {
  const f = fixture(t), maintenance = path.join(f.directory, 'maintenance'); fs.mkdirSync(maintenance);
  const paths = {deployLock: path.join(f.directory, 'deploy.lock'), maintenance};
  assert.throws(() => withOnlineToolPreparationLocks(paths, () => {throw Error('work failed');}, {checkPath: fixturePath, spawn: () => ({status: 0})}), /work failed/);
  assert.equal(fs.existsSync(path.join(maintenance, 'operation.lock')), false);
  assert.equal(fs.existsSync(paths.deployLock), true);
});

test('Linux real flock remains held by parent after lock child exits and releases on close', {skip: process.platform !== 'linux'}, t => {
  const f = fixture(t), maintenance = path.join(f.directory, 'maintenance'); fs.mkdirSync(maintenance);
  const paths = {deployLock: path.join(f.directory, 'deploy.lock'), maintenance};
  withOnlineToolPreparationLocks(paths, () => {
    const contender = spawnSync('flock', ['--nonblock', paths.deployLock, 'true']);
    assert.equal(contender.status, 1);
  }, {checkPath: fixturePath});
  assert.equal(spawnSync('flock', ['--nonblock', paths.deployLock, 'true']).status, 0);
});

const digest = value => createHash('sha256').update(value).digest('hex');
const clone = value => JSON.parse(JSON.stringify(value));
function terminationFixture(environmentCase = false) {
  const p = environmentCase ? UNPUBLISHED_BUILD_ENVIRONMENT_INCIDENT : UNPUBLISHED_CANDIDATE_INCIDENT,
    retainedPaths = environmentCase ? UNPUBLISHED_BUILD_ENVIRONMENT_PRESERVED_FILES : UNPUBLISHED_CANDIDATE_PRESERVED_FILES,
    missingPaths = environmentCase ? UNPUBLISHED_BUILD_ENVIRONMENT_ABSENT_PATHS : UNPUBLISHED_CANDIDATE_ABSENT_PATHS,
    maintenance = '/var/lib/faolla-maintenance/merchant-space';
  const maintenanceText = '{"phase":"ended"}', texts = Object.fromEntries(
    Object.keys(retainedPaths).map(key => [key, `synthetic ${key}\n`]));
  const previousActive = {target: p.baseline, status: 'active', name: `merchant-space-online-${p.baseline.slice(0, 12)}`,
    directory: `/www/wwwroot/merchant-space.web-releases/${p.baseline.slice(0, 12)}-online`, port: 3104};
  const processes = [{name: previousActive.name, cwd: previousActive.directory, pid: 501, pmId: 2, port: 3104, status: 'online'},
    {name: 'old-stopped-release', cwd: '/www/wwwroot/old-stopped-release', pid: 0, pmId: 3, port: 3103, status: 'stopped'}];
  const state = {target: p.target, baseline: p.baseline, status: 'preparing', lane: 'attendance', attendanceEnabled: false,
    directory: p.directory, name: p.name, port: 3103, previousActive, oldName: previousActive.name,
    oldDirectory: previousActive.directory, oldPort: previousActive.port, processes,
    baseDirectory: '/www/wwwroot/merchant-space.releases/synthetic-base', markerHash: 'a'.repeat(64),
    maintenanceHash: digest(maintenanceText), retentionHeadSha256: 'b'.repeat(64), startedAt: '2026-10-09T10:00:00.000Z',
    configs: Object.fromEntries(p.proxyFiles.map(file => [file, {oldHash: digest(texts[`before-${file}`]), newHash: digest(texts[`after-${file}`])}]))};
  const stateText = JSON.stringify(state, null, 2), stateSha256 = digest(stateText);
  const evidence = {schemaVersion: 1, target: p.target, baseline: p.baseline, operation: p.operation,
    observedAt: '2026-10-09T10:01:00.000Z', stateSha256, sourceHead: p.target, sourceClean: true,
    absentPaths: [...missingPaths],
    buildUnit: {name: `faolla-attendance-build-${p.target}.service`, loadState: 'not-found', journalEmpty: true},
    activeText: JSON.stringify(previousActive), processes: clone(processes), baseDirectory: state.baseDirectory,
    maintenanceText, markerSha256: state.markerHash, retentionHeadSha256: state.retentionHeadSha256,
    proxyHashes: Object.fromEntries(p.proxyFiles.map(file => [file, state.configs[file].oldHash])),
    database: {identitySha256: 'c'.repeat(64), registrySha256: 'd'.repeat(64), registryCount: 60,
      registryMaximum: '202609240052', attendanceRelations: 0, attendanceFunctions: 0},
    preservedFiles: Object.fromEntries(Object.entries(texts).map(([key, value]) => [key, digest(value)])),
    processReferencesAbsent: true, pm2DumpReferencesAbsent: true, portVacant: true,
    candidateCompatibilityDatabaseAbsent: true, diagnosticKind: 'focused-test-replay', diagnosticFailures: 6};
  const journalEntries = [
    {UNIT: `faolla-attendance-build-${p.target}.service`, MESSAGE: 'Started synthetic fixture'},
    {UNIT: `faolla-attendance-build-${p.target}.service`, EXIT_STATUS: '1', MESSAGE: 'Main process exited'},
    {UNIT: `faolla-attendance-build-${p.target}.service`, UNIT_RESULT: 'exit-code'},
    {UNIT: `faolla-attendance-build-${p.target}.service`, MESSAGE: 'Consumed synthetic CPU time'},
  ];
  const stable = value => Array.isArray(value) ? value.map(stable) : value !== null && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
  const buildSourceText = 'synthetic original before-npm environment checker; not server source\n';
  if (environmentCase) Object.assign(evidence, {
    buildUnit: {name: `faolla-attendance-build-${p.target}.service`, loadState: 'not-found', journalEmpty: false,
      journalSha256: digest(JSON.stringify(stable(journalEntries))), journalEntries},
    diagnosticKind: 'failed-build-environment', diagnosticTests: 543, diagnosticPasses: 543,
    diagnosticFailures: 0, diagnosticSkipped: 0, diagnosticCancelled: 0,
    buildAttemptOccurred: true, npmStarted: false, buildSourceSha256: digest(buildSourceText),
    preservedDirectories: clone(UNPUBLISHED_BUILD_ENVIRONMENT_PRESERVED_DIRECTORIES),
  });
  const files = new Map([[`${maintenance}/state.json`, maintenanceText], [`${p.operation}/state.json`, stateText],
    ...Object.entries(retainedPaths).map(([key, full]) => [full, texts[key]])]);
  const directories = new Set(['/', maintenance, '/var/lib/faolla-online-release', p.operation, p.directory]);
  if (environmentCase) {
    files.set(p.buildSource, buildSourceText);
    for (const value of Object.values(UNPUBLISHED_BUILD_ENVIRONMENT_PRESERVED_DIRECTORIES)) directories.add(value.path);
  }
  for (const full of [...directories, ...files.keys()]) {
    let current = path.posix.dirname(full);
    while (!directories.has(current)) {directories.add(current); current = path.posix.dirname(current);}
  }
  const patches = new Map(), directoryEntries = new Map(), io = {
    lstatSync(full) {
      const isFile = files.has(full), isDirectory = directories.has(full);
      if (!isFile && !isDirectory) throw Object.assign(Error('synthetic missing'), {code: 'ENOENT'});
      const expected = environmentCase ? Object.values(UNPUBLISHED_BUILD_ENVIRONMENT_PRESERVED_DIRECTORIES).find(value => value.path === full) : undefined;
      return {uid: 0, mode: isFile ? 0o600 : 0o700, nlink: 1, ...expected, isFile: () => isFile,
        isDirectory: () => isDirectory, isSymbolicLink: () => false, ...patches.get(full)};
    },
    realpathSync: full => full,
    readFileSync(full, encoding) {if (!files.has(full)) throw Error('synthetic unreadable'); return encoding ? files.get(full) : Buffer.from(files.get(full));},
    readdirSync(full) {
      if (full === '/var/lib/faolla-online-release') return [p.target];
      assert.ok(environmentCase && Object.values(UNPUBLISHED_BUILD_ENVIRONMENT_PRESERVED_DIRECTORIES).some(value => value.path === full), full);
      return directoryEntries.get(full) ?? [];
    },
  };
  // The real original state is SHA-pinned. This VM replaces only that hash for
  // an explicitly synthetic fixture, never provides a production override and
  // cannot prove that actual live observations satisfy the collector contract.
  const source = fs.readFileSync(self, 'utf8');
  assert.equal(source.split(`stateSha256: '${p.stateSha256}'`).length - 1, 1);
  let code = [source.slice(source.indexOf('const APP ='), source.indexOf('function canonicalAbsolute')),
    source.slice(source.indexOf('function canonicalAbsolute'), source.indexOf('export function createOnlineReleaseToolPlan')),
    source.slice(source.indexOf('export function assertOnlineToolOwnedPath'), source.indexOf('function gitEnvironment')),
    source.slice(source.indexOf('export function assertOnlineToolNoPending'), source.indexOf('export function withOnlineToolPreparationLocks')),
    '({createUnpublishedCandidateTerminationReceipt, assertUnpublishedCandidateTerminationReceipt, createUnpublishedBuildEnvironmentTerminationReceipt, assertUnpublishedBuildEnvironmentTerminationReceipt, assertOnlineToolNoPending, assertOnlineToolOwnedPath})',
  ].join('\n').replace(`stateSha256: '${p.stateSha256}'`, `stateSha256: '${stateSha256}'`).replaceAll('export ', '');
  if (environmentCase) {
    // Only this synthetic VM replaces the fixed real incident's literal hashes.
    // Neither the executable CLI nor exported production policy has overrides.
    const replacements = new Map(Object.entries(UNPUBLISHED_BUILD_ENVIRONMENT_FILE_SHA256).map(([key, value]) => [value, evidence.preservedFiles[key]]));
    replacements.set(p.buildSourceSha256, evidence.buildSourceSha256);
    replacements.set(p.journalSha256, evidence.buildUnit.journalSha256);
    for (const [before, after] of replacements) {
      assert.equal(code.split(`'${before}'`).length - 1, 1, before);
      code = code.replace(`'${before}'`, `'${after}'`);
    }
  }
  const api = runInNewContext(code, {fs: io, path: path.posix, createHash, Buffer}, {timeout: 1000});
  const input = {stateText, evidence, toolRevision: 'e'.repeat(40), terminatedAt: '2026-10-09T10:01:05.000Z'};
  const receipt = environmentCase ? api.createUnpublishedBuildEnvironmentTerminationReceipt(input) : api.createUnpublishedCandidateTerminationReceipt(input);
  files.set(`${p.operation}/unpublished-termination.json`, JSON.stringify(receipt));
  return {p, state, stateText, evidence, files, directories, patches, directoryEntries, api, input, receipt};
}
function assertSyntheticReceipt(f, changes = {}) {
  return f.api.assertUnpublishedCandidateTerminationReceipt({stateText: f.stateText, receipt: f.receipt,
    preservedFiles: clone(f.evidence.preservedFiles), absentPaths: [...UNPUBLISHED_CANDIDATE_ABSENT_PATHS], ...changes});
}

test('unpublished termination fixes only the reviewed incident and builtin proxy contract', () => {
  const p = UNPUBLISHED_CANDIDATE_INCIDENT;
  assert.equal(p.target, '5b974eb06c858757c8785d5f9106b006903a5ba0');
  assert.equal(p.baseline, 'b1304d5d58841c2247b93229b90bb7adcfd64965');
  assert.equal(p.stateSha256, '98af9fe83f97d8f02236ff964823cebb5804f663469334c3149c067e3f032709');
  assert.deepEqual(p.proxyFiles, WEB_RELEASE_FILES);
  assert.equal(UNPUBLISHED_CANDIDATE_ABSENT_PATHS.length, 10);
  assert.equal(Object.keys(UNPUBLISHED_CANDIDATE_PRESERVED_FILES).length, 9);
  assert.ok(Object.values(UNPUBLISHED_CANDIDATE_PRESERVED_FILES).every(full => full.startsWith(p.operation + '/') || full === p.directory + '/.env.local'));
  for (const stateText of ['{}', '{"status":"terminated"}', '\n']) {
    assert.throws(() => createUnpublishedCandidateTerminationReceipt({stateText}), /unpublished_termination_invalid/);
    assert.throws(() => assertUnpublishedCandidateTerminationReceipt({stateText, receipt: {status: 'terminated'}}), /unpublished_termination_invalid/);
  }
});

test('synthetic receipt preserves original bytes, hashes sealed evidence and permits stopped old port reuse', () => {
  const f = terminationFixture();
  assert.equal(assertSyntheticReceipt(f), true);
  assert.equal(f.receipt.originalStateText, f.stateText);
  assert.equal(f.receipt.originalStateSha256, digest(f.stateText));
  assert.equal(f.receipt.candidate.port, f.state.port);
  assert.notEqual(f.receipt.evidence, f.evidence);
  f.evidence.database.registryCount = 61;
  assert.equal(f.receipt.evidence.database.registryCount, 60);
  assert.equal(f.files.get(`${f.p.operation}/state.json`), f.stateText);
});

test('synthetic receipt creation refuses any missing or changed collector fact', () => {
  const f = terminationFixture();
  for (const [key, value] of [['schemaVersion', 2], ['target', 'f'.repeat(40)], ['baseline', 'f'.repeat(40)],
    ['operation', f.p.operation + '/child'], ['stateSha256', 'f'.repeat(64)], ['sourceHead', 'f'.repeat(40)], ['sourceClean', false],
    ['observedAt', '2026-10-09T09:59:00.000Z'], ['absentPaths', f.evidence.absentPaths.slice(1)],
    ['baseDirectory', '/other'], ['markerSha256', 'f'.repeat(64)], ['retentionHeadSha256', 'f'.repeat(64)],
    ['processReferencesAbsent', false], ['pm2DumpReferencesAbsent', false], ['portVacant', false],
    ['candidateCompatibilityDatabaseAbsent', false], ['diagnosticKind', 'original-stage-log'], ['diagnosticFailures', 0],
    ['activeText', '{}'], ['maintenanceText', '{"phase":"ended"}\n']]) {
    const evidence = {...clone(f.evidence), [key]: value};
    assert.throws(() => f.api.createUnpublishedCandidateTerminationReceipt({...f.input, evidence}), /unpublished_termination_invalid/, key);
    delete evidence[key];
    assert.throws(() => f.api.createUnpublishedCandidateTerminationReceipt({...f.input, evidence}), /unpublished_termination_invalid/, `missing ${key}`);
  }
  assert.throws(() => f.api.createUnpublishedCandidateTerminationReceipt({...f.input, evidence: {...clone(f.evidence), approved: true}}), /unpublished_termination_invalid/);
  for (const [object, key, value] of [['buildUnit', 'name', 'another.service'], ['buildUnit', 'loadState', 'loaded'],
    ['buildUnit', 'journalEmpty', false], ['database', 'identitySha256', 'bad'], ['database', 'registryCount', 61],
    ['database', 'registryMaximum', '202610090061'], ['database', 'attendanceRelations', 1], ['database', 'attendanceFunctions', 1],
    ['proxyHashes', f.p.proxyFiles[0], 'f'.repeat(64)], ['preservedFiles', 'runtime.json', 'bad']]) {
    const evidence = clone(f.evidence); evidence[object][key] = value;
    assert.throws(() => f.api.createUnpublishedCandidateTerminationReceipt({...f.input, evidence}), /unpublished_termination_invalid/, `${object}.${key}`);
  }
});

test('synthetic receipt cannot manufacture changed original state, process baseline, revision or time', () => {
  const f = terminationFixture();
  for (const key of ['status', 'target', 'baseline', 'directory', 'attendanceEnabled']) {
    const state = {...f.state, [key]: key === 'attendanceEnabled' ? true : 'changed'};
    assert.throws(() => f.api.createUnpublishedCandidateTerminationReceipt({...f.input, stateText: JSON.stringify(state)}), /unpublished_termination_invalid/);
  }
  assert.throws(() => f.api.createUnpublishedCandidateTerminationReceipt({...f.input, stateText: f.stateText + '\n'}), /unpublished_termination_invalid/);
  for (const process of [{...f.state.processes[0], pid: 502}, {...f.state.processes[1], status: 'online', pid: 503},
    {...f.state.processes[1], name: f.p.name}, {...f.state.processes[1], cwd: f.p.directory},
    {...f.state.processes[1], executable: `${f.p.directory}/server.js`}]) {
    assert.throws(() => f.api.createUnpublishedCandidateTerminationReceipt({...f.input,
      evidence: {...clone(f.evidence), processes: [f.state.processes[0], process]}}), /unpublished_termination_invalid/);
  }
  for (const toolRevision of ['', 'e'.repeat(40) + '\n', 'E'.repeat(40)])
    assert.throws(() => f.api.createUnpublishedCandidateTerminationReceipt({...f.input, toolRevision}), /unpublished_termination_invalid/);
  for (const terminatedAt of ['2026-10-09T10:00:59.000Z', '2026-10-09T10:06:00.001Z', '2026-10-09T10:01:05Z'])
    assert.throws(() => f.api.createUnpublishedCandidateTerminationReceipt({...f.input, terminatedAt}), /unpublished_termination_invalid/);
});

test('synthetic receipt verification binds all fields and actual retained bytes or missing artifacts', () => {
  const f = terminationFixture();
  for (const [key, value] of [['kind', 'approved'], ['target', 'f'.repeat(40)], ['baseline', 'f'.repeat(40)],
    ['operation', '/other'], ['candidate', {...clone(f.receipt.candidate), port: 3108}], ['originalStateSha256', 'f'.repeat(64)],
    ['originalStateText', f.stateText + '\n'], ['evidenceSha256', 'f'.repeat(64)]])
    assert.throws(() => assertSyntheticReceipt(f, {receipt: {...clone(f.receipt), [key]: value}}), /unpublished_termination_invalid/, key);
  assert.throws(() => assertSyntheticReceipt(f, {receipt: {...clone(f.receipt), approved: true}}), /unpublished_termination_invalid/);
  const evidenceChanged = clone(f.receipt); evidenceChanged.evidence.database.registryCount = 61;
  assert.throws(() => assertSyntheticReceipt(f, {receipt: evidenceChanged}), /unpublished_termination_invalid/);
  assert.throws(() => assertSyntheticReceipt(f, {stateText: f.stateText + '\n'}), /unpublished_termination_invalid/);
  for (const key of Object.keys(f.evidence.preservedFiles)) {
    const preservedFiles = {...f.evidence.preservedFiles, [key]: 'f'.repeat(64)};
    assert.throws(() => assertSyntheticReceipt(f, {preservedFiles}), /unpublished_termination_invalid/, key);
    delete preservedFiles[key];
    assert.throws(() => assertSyntheticReceipt(f, {preservedFiles}), /unpublished_termination_invalid/, `missing ${key}`);
  }
  assert.throws(() => assertSyntheticReceipt(f, {absentPaths: UNPUBLISHED_CANDIDATE_ABSENT_PATHS.slice(1)}), /unpublished_termination_invalid/);
});

test('synthetic pending checker exempts only complete sidecar with original bytes and no live-state reread', () => {
  const f = terminationFixture();
  f.api.assertOnlineToolNoPending();
  assert.equal(f.files.get(`${f.p.operation}/state.json`), f.stateText);
  // No live DB/proxy/active/PM2 readers exist in this filesystem port. Later
  // publication facts must not invalidate this sealed historical termination.
  const sidecar = `${f.p.operation}/unpublished-termination.json`, saved = f.files.get(sidecar);
  f.files.delete(sidecar); assert.throws(() => f.api.assertOnlineToolNoPending(), /release_pending/);
  f.files.set(sidecar, saved);
  f.files.set(`${f.p.operation}/state.json`, JSON.stringify({...f.state, status: 'terminated'}));
  assert.throws(() => f.api.assertOnlineToolNoPending(), /release_pending/);
  f.files.set(`${f.p.operation}/state.json`, f.stateText + '\n');
  assert.throws(() => f.api.assertOnlineToolNoPending(), /unpublished_termination_invalid/);
});

test('synthetic pending checker rejects build/database residue or unsafe retained paths without mutation', () => {
  const f = terminationFixture();
  for (const full of UNPUBLISHED_CANDIDATE_ABSENT_PATHS) {
    f.files.set(full, 'synthetic residue');
    assert.throws(() => f.api.assertOnlineToolNoPending(), /release_pending/, full);
    assert.equal(f.files.get(full), 'synthetic residue'); f.files.delete(full);
  }
  for (const full of Object.values(UNPUBLISHED_CANDIDATE_PRESERVED_FILES)) {
    const saved = f.files.get(full); f.files.set(full, saved + 'changed');
    assert.throws(() => f.api.assertOnlineToolNoPending(), /unpublished_termination_invalid/, full); f.files.set(full, saved);
    for (const patch of [{isSymbolicLink: () => true}, {uid: 1000}, {mode: 0o666}, {mode: 0o644}, {nlink: 2}]) {
      f.patches.set(full, patch); assert.throws(() => f.api.assertOnlineToolNoPending(), /unsafe_path/, full); f.patches.delete(full);
    }
  }
  for (const full of [f.p.operation, `${f.p.operation}/state.json`, `${f.p.operation}/unpublished-termination.json`]) {
    f.patches.set(full, {mode: full === f.p.operation ? 0o755 : 0o644});
    assert.throws(() => f.api.assertOnlineToolNoPending(), /unsafe_path/); f.patches.delete(full);
  }
  f.patches.set(f.p.directory, {isSymbolicLink: () => true});
  assert.throws(() => f.api.assertOnlineToolNoPending(), /unsafe_path/);
  assert.equal(f.files.get(`${f.p.operation}/state.json`), f.stateText);
});

function assertSyntheticEnvironmentReceipt(f, changes = {}) {
  return f.api.assertUnpublishedBuildEnvironmentTerminationReceipt({stateText: f.stateText, receipt: f.receipt,
    preservedFiles: clone(f.evidence.preservedFiles), absentPaths: [...UNPUBLISHED_BUILD_ENVIRONMENT_ABSENT_PATHS],
    preservedDirectories: clone(f.evidence.preservedDirectories), buildSourceSha256: f.evidence.buildSourceSha256, ...changes});
}
test('second fixed incident pins actual state/log/source/journal and preserves original empty directory identities', () => {
  const p = UNPUBLISHED_BUILD_ENVIRONMENT_INCIDENT;
  assert.equal(p.target, 'e754793a589593011da249d00ae05326f54302bf');
  assert.equal(p.baseline, UNPUBLISHED_CANDIDATE_INCIDENT.baseline);
  assert.equal(p.stateSha256, 'f98fbad3170b634c88e3400952bba0db6cef84d7137b467bdb7ec8a0ee835f3d');
  assert.equal(p.stageLogSha256, 'd7d045e832780ddfded2b7425cb053bcd7564f381591164357fe16f63eba164a');
  assert.equal(p.buildSourceSha256, '02d43cce249532ee287b25bf9a2c9231ee4351416757a0faf99d47648ee6e636');
  assert.equal(p.journalSha256, '96095c31158115cb1e9e3399d28ff9fd243c472aa58c32d6045a874513871530');
  assert.equal(p.stageLog, `/var/log/faolla-attendance-publication/${p.target}-stage.log`);
  assert.deepEqual(p.proxyFiles, WEB_RELEASE_FILES);
  assert.equal(Object.keys(UNPUBLISHED_BUILD_ENVIRONMENT_PRESERVED_FILES).length, 9);
  assert.deepEqual(Object.keys(UNPUBLISHED_BUILD_ENVIRONMENT_FILE_SHA256), Object.keys(UNPUBLISHED_BUILD_ENVIRONMENT_PRESERVED_FILES));
  assert.equal(UNPUBLISHED_BUILD_ENVIRONMENT_ABSENT_PATHS.length, 10);
  for (const [name, ino] of [['build-home', 2624499], ['build-cache', 2624500], ['build-tmp', 2624501]]) {
    assert.deepEqual(UNPUBLISHED_BUILD_ENVIRONMENT_PRESERVED_DIRECTORIES[name],
      {path: `${p.operation}/${name}`, uid: 0, mode: 0o700, dev: 64769, ino, nlink: 2, entries: []});
    assert.ok(!UNPUBLISHED_BUILD_ENVIRONMENT_ABSENT_PATHS.includes(`${p.operation}/${name}`));
  }
  for (const stateText of ['{}', '{"status":"terminated"}', '\n']) {
    assert.throws(() => createUnpublishedBuildEnvironmentTerminationReceipt({stateText}), /unpublished_termination_invalid/);
    assert.throws(() => assertUnpublishedBuildEnvironmentTerminationReceipt({stateText, receipt: {status: 'terminated'}}), /unpublished_termination_invalid/);
  }
});
test('synthetic second receipt seals a real-attempt-shaped failed journal, not never-started evidence', () => {
  const f = terminationFixture(true);
  assert.equal(assertSyntheticEnvironmentReceipt(f), true);
  assert.equal(f.receipt.kind, 'online-unpublished-build-environment-termination');
  assert.equal(f.receipt.evidence.buildAttemptOccurred, true); assert.equal(f.receipt.evidence.npmStarted, false);
  assert.equal(f.receipt.evidence.buildUnit.journalEmpty, false);
  assert.equal(f.receipt.evidence.buildUnit.journalEntries.length, 4);
  assert.equal(f.receipt.evidence.diagnosticTests, 543); assert.equal(f.receipt.evidence.diagnosticFailures, 0);
  const saved = clone(f.receipt.evidence.buildUnit.journalEntries);
  f.evidence.buildUnit.journalEntries[1].EXIT_STATUS = '0';
  assert.deepEqual(clone(f.receipt.evidence.buildUnit.journalEntries), saved);
  assert.equal(f.files.get(`${f.p.operation}/state.json`), f.stateText);
});
test('synthetic second policy rejects missing facts, fictional absence, changed source/log and any changed journal', () => {
  const f = terminationFixture(true), create = evidence => f.api.createUnpublishedBuildEnvironmentTerminationReceipt({...f.input, evidence});
  for (const key of Object.keys(f.evidence)) {
    const evidence = clone(f.evidence); delete evidence[key];
    assert.throws(() => create(evidence), /unpublished_termination_invalid/, `missing ${key}`);
  }
  for (const [key, value] of [['target', UNPUBLISHED_CANDIDATE_INCIDENT.target], ['sourceClean', false],
    ['buildAttemptOccurred', false], ['npmStarted', true], ['buildSourceSha256', 'f'.repeat(64)],
    ['diagnosticKind', 'focused-test-replay'], ['diagnosticTests', 479], ['diagnosticPasses', 542],
    ['diagnosticFailures', 6], ['diagnosticSkipped', 1], ['diagnosticCancelled', 1], ['candidateCompatibilityDatabaseAbsent', false]])
    assert.throws(() => create({...clone(f.evidence), [key]: value}), /unpublished_termination_invalid/, key);
  for (const key of Object.keys(f.evidence.preservedFiles)) {
    const evidence = clone(f.evidence); evidence.preservedFiles[key] = 'f'.repeat(64);
    assert.throws(() => create(evidence), /unpublished_termination_invalid/, key);
  }
  for (const change of [unit => {unit.journalEmpty = true;}, unit => {unit.journalEntries = [];},
    unit => {unit.journalEntries.pop();}, unit => {unit.journalEntries.push({MESSAGE: 'second attempt'});},
    unit => {unit.journalEntries[1].EXIT_STATUS = '0';}, unit => {unit.journalEntries.reverse();},
    unit => {unit.journalSha256 = 'f'.repeat(64);}, unit => {unit.loadState = 'loaded';}]) {
    const evidence = clone(f.evidence); change(evidence.buildUnit);
    assert.throws(() => create(evidence), /unpublished_termination_invalid/);
  }
  assert.throws(() => create({...clone(f.evidence), approved: true}), /unpublished_termination_invalid/);
});
test('synthetic second verifier cannot reuse first receipt or manufacture changed original bytes and retained directory facts', () => {
  const f = terminationFixture(true), old = terminationFixture();
  assert.throws(() => assertSyntheticEnvironmentReceipt(f, {receipt: old.receipt}), /unpublished_termination_invalid/);
  assert.throws(() => assertSyntheticReceipt(old, {receipt: f.receipt}), /unpublished_termination_invalid/);
  assert.throws(() => assertSyntheticEnvironmentReceipt(f, {stateText: f.stateText + '\n'}), /unpublished_termination_invalid/);
  assert.throws(() => assertSyntheticEnvironmentReceipt(f, {buildSourceSha256: 'f'.repeat(64)}), /unpublished_termination_invalid/);
  assert.throws(() => assertSyntheticEnvironmentReceipt(f, {absentPaths: UNPUBLISHED_BUILD_ENVIRONMENT_ABSENT_PATHS.slice(1)}), /unpublished_termination_invalid/);
  for (const [key, value] of [['dev', 1], ['ino', 1], ['mode', 0o755], ['uid', 1000], ['nlink', 3], ['entries', ['npm-output']]]) {
    const preservedDirectories = clone(f.evidence.preservedDirectories); preservedDirectories['build-home'][key] = value;
    assert.throws(() => assertSyntheticEnvironmentReceipt(f, {preservedDirectories}), /unpublished_termination_invalid/, key);
  }
});
test('synthetic second pending exception requires original private bytes and retained empty directory identities, without rereading live facts', () => {
  const f = terminationFixture(true);
  f.api.assertOnlineToolNoPending();
  const receiptPath = `${f.p.operation}/unpublished-termination.json`, saved = f.files.get(receiptPath);
  f.files.set(receiptPath, JSON.stringify(terminationFixture().receipt));
  assert.throws(() => f.api.assertOnlineToolNoPending(), /unpublished_termination_invalid/);
  f.files.set(receiptPath, saved);
  for (const [key, expected] of Object.entries(UNPUBLISHED_BUILD_ENVIRONMENT_PRESERVED_DIRECTORIES)) {
    f.directoryEntries.set(expected.path, ['npm-artifact']);
    assert.throws(() => f.api.assertOnlineToolNoPending(), /unpublished_termination_invalid/, key);
    f.directoryEntries.delete(expected.path);
    for (const patch of [{ino: expected.ino + 1}, {dev: expected.dev + 1}, {nlink: 3}, {mode: 0o755}, {uid: 1000}, {isSymbolicLink: () => true}]) {
      f.patches.set(expected.path, patch); assert.throws(() => f.api.assertOnlineToolNoPending(), undefined, `${key} ${JSON.stringify(patch)}`);
      f.patches.delete(expected.path);
    }
    f.directories.delete(expected.path); assert.throws(() => f.api.assertOnlineToolNoPending()); f.directories.add(expected.path);
  }
  for (const full of [...Object.values(UNPUBLISHED_BUILD_ENVIRONMENT_PRESERVED_FILES), f.p.buildSource]) {
    const content = f.files.get(full); f.files.set(full, content + 'changed');
    assert.throws(() => f.api.assertOnlineToolNoPending(), /unpublished_termination_invalid/, full); f.files.set(full, content);
  }
  for (const full of UNPUBLISHED_BUILD_ENVIRONMENT_ABSENT_PATHS) {
    f.files.set(full, 'retained rejected evidence');
    assert.throws(() => f.api.assertOnlineToolNoPending(), /release_pending/, full); f.files.delete(full);
  }
  for (const full of [f.p.operation, `${f.p.operation}/state.json`, receiptPath, ...Object.values(UNPUBLISHED_BUILD_ENVIRONMENT_PRESERVED_FILES)]) {
    f.patches.set(full, {mode: full === f.p.operation ? 0o755 : 0o644});
    assert.throws(() => f.api.assertOnlineToolNoPending(), /unsafe_path/, full); f.patches.delete(full);
  }
  assert.equal(f.files.get(`${f.p.operation}/state.json`), f.stateText);
  f.api.assertOnlineToolNoPending();
});
