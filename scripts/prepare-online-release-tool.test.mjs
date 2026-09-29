import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createOnlineReleaseToolPlan, executeOnlineReleaseToolPlan, verifyOnlineReleaseTool,
  verifyOnlineToolBootstrap, assertOnlineToolOwnedPath, assertOnlineToolNoPending,
  withOnlineToolPreparationLocks, prepareOnlineReleaseToolMain, TOOL_REQUIRED_FILES,
  TOOL_SPARSE_PATTERNS} from './prepare-online-release-tool.mjs';

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
  for (const status of ['preparing', 'staged', 'database-ready', 'ready-no-database', 'unknown']) {
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
