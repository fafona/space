import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {selectOnlineToolRetention, verifyHistoricalOnlineTool, executeOnlineToolRetention,
  runOnlineReleaseToolRetention, readOnlineToolReferenceConfig,
  assertArtifactAttemptNotReferencing} from './online-release-tool-retention.mjs';
import {createOnlineReleaseToolPlan, executeOnlineReleaseToolPlan, verifyOnlineReleaseTool,
  TOOL_REQUIRED_FILES, TOOL_SPARSE_PATTERNS} from './prepare-online-release-tool.mjs';

const a = 'a'.repeat(40), b = 'b'.repeat(40), c = 'c'.repeat(40), d = 'd'.repeat(40);
const tool = revision => `/var/lib/faolla-online-code/${revision}`;
const selection = {target: d, revisions: [a, c, d, b], ancestorOrder: [d, c, b, a]};

test('selection keeps current and its nearest available Git ancestor, removing only one oldest excess tool', () => {
  assert.deepEqual(selectOnlineToolRetention(selection), {keep: [d, c], victim: a, remainingExcess: 2, status: 'candidate'});
  assert.deepEqual(selectOnlineToolRetention({...selection, revisions: [d]}),
    {keep: [d], victim: null, remainingExcess: 0, status: 'within-window'});
  assert.deepEqual(selectOnlineToolRetention({...selection, revisions: [d, a]}),
    {keep: [d, a], victim: null, remainingExcess: 0, status: 'within-window'});
  assert.deepEqual(selectOnlineToolRetention({...selection, ancestorOrder: [d, b, c, a]}).keep, [d, b]);
});

test('executing bootstrap, cwd descendants and broad execution roots are protected independently of the window', () => {
  assert.equal(selectOnlineToolRetention({...selection, executingDirectories: [tool(a)]}).victim, b);
  assert.equal(selectOnlineToolRetention({...selection, executingDirectories: [`${tool(a)}/scripts`]}).victim, b);
  assert.equal(selectOnlineToolRetention({...selection, executingDirectories: [tool(c), tool(d)]}).victim, a);
  for (const executingDirectories of [[tool(a), tool(b)], ['/var/lib/faolla-online-code'], ['/']]) {
    assert.deepEqual(selectOnlineToolRetention({...selection, executingDirectories}),
      {keep: [d, c], victim: null, remainingExcess: 2, status: 'pending'});
  }
  assert.equal(selectOnlineToolRetention({...selection, executingDirectories: [tool(a) + '-unrelated']}).victim, a);
});

test('selection rejects unknown ancestry, malformed revisions, duplicate entries and ambiguous execution paths', () => {
  const mutations = [
    {target: a + '\n'}, {target: a.toUpperCase()}, {target: '../bad'},
    {revisions: [a, b, c]}, {revisions: [a, b, c, d, d]}, {revisions: [a, b, c, d + '\n']},
    {ancestorOrder: [d, c, b]}, {ancestorOrder: [a, b, c, d]}, {ancestorOrder: [d, c, b, a, a]},
    {ancestorOrder: [d, c, b, a, b + '\n']}, {revisions: null}, {ancestorOrder: null},
    {executingDirectories: ['relative']}, {executingDirectories: ['/var/lib/../tmp']},
    {executingDirectories: ['/var/lib\n']}, {executingDirectories: null},
  ];
  for (const mutation of mutations) assert.throws(() => selectOnlineToolRetention({...selection, ...mutation}), /selection_invalid/);
  const many = Array.from({length: 33}, (_, n) => n.toString(16).padStart(40, '0'));
  assert.throws(() => selectOnlineToolRetention({target: many[0], revisions: many, ancestorOrder: many}), /selection_invalid/);
});

function executionPorts(patch = {}) {
  const calls = [], before = {victim: {revision: a}, worktrees: ['before'], protected: {pid: 123}};
  const plan = {before, victim: before.victim, keep: [d, c], remainingExcess: 2};
  const after = {protected: before.protected};
  const ports = {
    observeBefore: () => {calls.push('observe-before'); return structuredClone(before);},
    begin: value => {assert.equal(value, plan); calls.push('begin');},
    remove: value => {assert.equal(value, plan.victim); calls.push('remove');},
    observeAfter: () => {calls.push('observe-after'); return after;},
    removed: (value, observed) => {assert.equal(value, plan); assert.equal(observed, after); calls.push('removed');},
    complete: (value, observed) => {assert.equal(value, plan); assert.equal(observed, after); calls.push('complete');},
    failed: error => {assert.ok(error instanceof Error); calls.push('failed');},
    ...patch,
  };
  return {plan, ports, calls};
}

test('executor journals before one removal and completes only after the postcondition and receipt', () => {
  const f = executionPorts();
  assert.deepEqual(executeOnlineToolRetention(f.plan, f.ports),
    {status: 'completed', kept: [d, c], removed: a, remainingExcess: 1});
  assert.deepEqual(f.calls, ['observe-before', 'begin', 'observe-before', 'remove', 'observe-after', 'removed', 'complete']);
});

test('observation drift before journaling performs no mutation', () => {
  const f = executionPorts({observeBefore: () => ({changed: true})});
  assert.throws(() => executeOnlineToolRetention(f.plan, f.ports), /observation_changed/);
  assert.deepEqual(f.calls, []);
});

test('observation drift after journaling marks the attempt failed without deleting', () => {
  const f = executionPorts(); let observed = 0;
  f.ports.observeBefore = () => ++observed === 1 ? f.plan.before : {changed: true};
  assert.throws(() => executeOnlineToolRetention(f.plan, f.ports), /observation_changed/);
  assert.deepEqual(f.calls, ['begin', 'failed']);
});

for (const stage of ['remove', 'observeAfter', 'removed', 'complete']) {
  test(`failure at ${stage} leaves a failed journal and never retries removal`, () => {
    const f = executionPorts();
    f.ports[stage] = () => {f.calls.push(`fault-${stage}`); throw Error('injected fault');};
    assert.throws(() => executeOnlineToolRetention(f.plan, f.ports), /injected fault/);
    assert.equal(f.calls.at(-1), 'failed');
    assert.ok(f.calls.filter(value => value === 'remove' || value === 'fault-remove').length <= 1);
    assert.ok(f.calls.filter(value => value === 'complete').length === 0);
  });
}

test('begin failure never attempts deletion or invents a success receipt', () => {
  const f = executionPorts({begin: () => {throw Error('cannot fsync plan');}});
  assert.throws(() => executeOnlineToolRetention(f.plan, f.ports), /cannot fsync plan/);
  assert.deepEqual(f.calls, ['observe-before']);
});

test('unfinished/failed application cleanup protects its exact tool; completion must bind the original context', () => {
  const prepared = {version: 1, toolRevision: a, context: {activeTarget: d, victim: {target: b}}};
  const completed = {version: 1, context: structuredClone(prepared.context)};
  assert.throws(() => assertArtifactAttemptNotReferencing({prepared}, a), /artifact_tool_referenced/);
  assertArtifactAttemptNotReferencing({prepared}, c);
  assertArtifactAttemptNotReferencing({prepared, completed}, a);
  assert.throws(() => assertArtifactAttemptNotReferencing({prepared, completed, failed: true}, a), /artifact_tool_referenced/);
  assert.throws(() => assertArtifactAttemptNotReferencing({prepared, completed: {...completed, context: {activeTarget: c}}}, a), /artifact_completion_invalid/);
  assert.throws(() => assertArtifactAttemptNotReferencing({prepared: {...prepared, toolRevision: null}}, a), /artifact_plan_invalid/);
});

test('read-only scheduler policy accepts root:root 0664 but rejects untrusted owner/group and concurrent changes', t => {
  const temporaryRoot = fs.realpathSync(os.tmpdir());
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(temporaryRoot, 'tool-config-fixture-')));
  t.after(() => {
    assert.equal(path.dirname(directory), temporaryRoot);
    assert.match(path.basename(directory), /^tool-config-fixture-[a-zA-Z0-9]+$/);
    assert.equal(fs.realpathSync(directory), directory);
    assert.equal(fs.lstatSync(directory).isSymbolicLink(), false);
    fs.rmSync(directory, {recursive: true});
  });
  const filename = path.join(directory, 'fixture.service'); fs.writeFileSync(filename, '[Service]\nExecStart=/usr/bin/true\n');
  const mutate = (s, patch = {}) => Object.assign(Object.create(Object.getPrototypeOf(s)), s,
    {uid: 0, gid: 0, mode: s.isDirectory() ? 0o40755 : 0o100664}, patch);
  let closed = 0;
  const ports = (patch = {}, race = false) => {
    let reads = 0;
    return {...fs,
      lstatSync: p => mutate(fs.lstatSync(p), p === filename ? patch : {}),
      fstatSync: fd => mutate(fs.fstatSync(fd), {...patch, ...(race && ++reads > 1 ? {mtimeMs: 0} : {})}),
      closeSync: fd => {closed++; fs.closeSync(fd);},
    };
  };
  assert.equal(readOnlineToolReferenceConfig(filename, {io: ports()}).toString(), '[Service]\nExecStart=/usr/bin/true\n');
  assert.equal(closed, 1);
  for (const patch of [{uid: 1000}, {gid: 1000}, {mode: 0o100666}, {isSymbolicLink: () => true}])
    assert.throws(() => readOnlineToolReferenceConfig(filename, {io: ports(patch)}), /configuration_path_unsafe/);
  assert.throws(() => readOnlineToolReferenceConfig(filename, {io: ports({}, true)}), /configuration_changed/);
  assert.equal(closed, 2);
  assert.throws(() => readOnlineToolReferenceConfig(filename, {io: ports(), maxBytes: 1}), /configuration_too_large/);
});

test('POSIX scheduler fixture mode 0664 is readable without chmod, rewriting or relaxing candidate ownership',
  {skip: process.platform !== 'linux' || process.getuid?.() !== 0 || process.getgid?.() !== 0}, t => {
    const temporaryRoot = fs.realpathSync(os.tmpdir());
    const directory = fs.realpathSync(fs.mkdtempSync(path.join(temporaryRoot, 'tool-posix-fixture-')));
    t.after(() => {
      assert.equal(path.dirname(directory), temporaryRoot);
      assert.match(path.basename(directory), /^tool-posix-fixture-[a-zA-Z0-9]+$/);
      assert.equal(fs.realpathSync(directory), directory);
      assert.equal(fs.lstatSync(directory).isSymbolicLink(), false);
      fs.rmSync(directory, {recursive: true});
    });
    const filename = path.join(directory, 'fixture.service'); fs.writeFileSync(filename, '[Service]\n', {mode: 0o664});
    fs.chmodSync(filename, 0o664);
    // /tmp itself is intentionally writable; model only that shared fixture
    // ancestor as root-owned 0755. The actual file is opened and fstat-checked.
    const io = {...fs, lstatSync: p => {
      const stat = fs.lstatSync(p); if (p === temporaryRoot) stat.mode = (stat.mode & ~0o777) | 0o755; return stat;
    }};
    const before = fs.statSync(filename);
    assert.equal(readOnlineToolReferenceConfig(filename, {io}).toString(), '[Service]\n');
    assert.equal(fs.statSync(filename).mode, before.mode);
    assert.equal(fs.statSync(filename).mtimeMs, before.mtimeMs);
  });

function fixtureGit(cwd, args, input) {
  const result = spawnSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false',
    '-c', 'core.autocrlf=false', '-c', 'core.eol=lf', ...args], {
    cwd, input, encoding: 'utf8', timeout: 30000, windowsHide: true,
    env: {PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, HOME: cwd, USERPROFILE: cwd,
      GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null', GIT_TERMINAL_PROMPT: '0'},
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, `${args.join(' ')}: ${result.stderr}`);
  return result.stdout;
}
function fixturePath(location, kind = 'directory') {
  const value = fs.lstatSync(location);
  assert.equal(value.isSymbolicLink(), false);
  assert.equal(kind === 'directory' ? value.isDirectory() : value.isFile(), true);
  assert.equal(fs.realpathSync(location), location);
}
function fixture(t) {
  const temporaryRoot = fs.realpathSync(os.tmpdir());
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(temporaryRoot, 'tool-retention-fixture-')));
  t.after(() => {
    assert.equal(path.dirname(directory), temporaryRoot);
    assert.match(path.basename(directory), /^tool-retention-fixture-[a-zA-Z0-9]+$/);
    assert.equal(fs.lstatSync(directory).isSymbolicLink(), false);
    assert.equal(fs.realpathSync(directory), directory);
    fs.rmSync(directory, {recursive: true});
  });
  const app = path.join(directory, 'repository'), toolRoot = path.join(directory, 'tools');
  fs.mkdirSync(app); fs.mkdirSync(toolRoot);
  fixtureGit(app, ['init']); fixtureGit(app, ['config', 'user.name', 'Fixture']);
  fixtureGit(app, ['config', 'user.email', 'fixture@example.invalid']);
  const files = new Map(TOOL_REQUIRED_FILES.map(name => [name, `fixture ${name}\n`]));
  files.set('src/source.ts', 'export const fixture = 1;\n');
  files.set('public/downloads/synthetic.zip', 'tiny fixture, not a real archive\n');
  files.set('.gitignore', '/node_modules\n/.next\n.env.local\n');
  for (const [name, bytes] of files) {
    const location = path.join(app, name); fs.mkdirSync(path.dirname(location), {recursive: true}); fs.writeFileSync(location, bytes);
  }
  fixtureGit(app, ['add', '.']); fixtureGit(app, ['commit', '-m', 'Old source']);
  const target = fixtureGit(app, ['rev-parse', 'HEAD']).trim();
  fixtureGit(app, ['update-ref', 'refs/remotes/origin/main', target]);
  const plan = createOnlineReleaseToolPlan(target, {app, toolRoot});
  const ports = {git: fixtureGit, checkPath: fixturePath};
  executeOnlineReleaseToolPlan(plan, ports);
  fs.appendFileSync(path.join(app, 'src/source.ts'), 'export const release = 2;\n');
  fixtureGit(app, ['add', '.']); fixtureGit(app, ['commit', '-m', 'Next source']);
  const currentRevision = fixtureGit(app, ['rev-parse', 'HEAD']).trim();
  fixtureGit(app, ['update-ref', 'refs/remotes/origin/main', currentRevision]);
  const currentPlan = createOnlineReleaseToolPlan(currentRevision, {app, toolRoot});
  executeOnlineReleaseToolPlan(currentPlan, ports);
  return {directory, app, toolRoot, plan, ports, currentPlan, currentRevision, files};
}

test('real Git verifies a historical sparse checkout separately without relaxing current-main verification', t => {
  const f = fixture(t);
  const result = verifyHistoricalOnlineTool(f.plan, f.currentRevision, f.ports);
  assert.equal(result.revision, f.plan.target);
  assert.equal(result.directory, f.plan.directory);
  assert.equal(result.sourceFiles, f.files.size - 1);
  assert.match(result.sourceTree, /^[a-f0-9]{40}$/);
  assert.match(result.inventorySha256, /^[a-f0-9]{64}$/);
  assert.ok(result.dev !== undefined && result.ino !== undefined);
  assert.throws(() => verifyOnlineReleaseTool(f.plan, f.ports), /target_not_main/);
  assert.equal(verifyOnlineReleaseTool(f.currentPlan, f.ports).verified, true);
  assert.equal(fs.existsSync(path.join(f.plan.directory, 'public/downloads')), false);
  assert.equal(fixtureGit(f.plan.directory, ['status', '--porcelain=v1', '--untracked-files=all']), '');
  // Normal non-force worktree removal succeeds for this exact source-only layout.
  fixtureGit(f.app, ['worktree', 'remove', f.plan.directory]);
  assert.equal(fs.existsSync(f.plan.directory), false);
  assert.equal(verifyOnlineReleaseTool(f.currentPlan, f.ports).verified, true);
  assert.equal(fs.readFileSync(path.join(f.app, 'public/downloads/synthetic.zip'), 'utf8'), 'tiny fixture, not a real archive\n');
});

for (const mutation of ['dirty', 'hidden-blob', 'private-extra', 'runtime-extra', 'pattern', 'index', 'download', 'symbolic-head']) {
  test(`historical verification rejects ${mutation} without repairing/removing any worktree`, t => {
    const f = fixture(t), source = path.join(f.plan.directory, 'src/source.ts');
    if (mutation === 'dirty' || mutation === 'hidden-blob') fs.appendFileSync(source, 'changed\n');
    if (mutation === 'private-extra') fs.writeFileSync(path.join(f.plan.directory, '.env.local'), 'synthetic fixture\n');
    if (mutation === 'runtime-extra') fs.mkdirSync(path.join(f.plan.directory, 'node_modules'));
    if (mutation === 'pattern') {
      const name = path.resolve(f.plan.directory, fixtureGit(f.plan.directory, ['rev-parse', '--git-path', 'info/sparse-checkout']).trim());
      fs.writeFileSync(name, TOOL_SPARSE_PATTERNS + '!/src/\n');
    }
    if (mutation === 'index') {
      fixtureGit(f.plan.directory, ['update-index', '--skip-worktree', 'src/source.ts']);
      fs.unlinkSync(source);
    }
    if (mutation === 'download') fs.mkdirSync(path.join(f.plan.directory, 'public/downloads'), {recursive: true});
    if (mutation === 'symbolic-head') {
      fixtureGit(f.app, ['branch', 'fixture-history', f.plan.target]);
      fixtureGit(f.plan.directory, ['symbolic-ref', 'HEAD', 'refs/heads/fixture-history']);
    }
    const git = (cwd, args, input) => mutation === 'hidden-blob' && args[0] === 'status' ? '' : fixtureGit(cwd, args, input);
    assert.throws(() => verifyHistoricalOnlineTool(f.plan, f.currentRevision, {...f.ports, git}),
      mutation === 'hidden-blob' ? /historical_blob_changed/ : undefined);
    assert.equal(fs.existsSync(f.plan.directory), true);
    assert.equal(verifyOnlineReleaseTool(f.currentPlan, f.ports).verified, true);
  });
}

test('historical identity rejects invalid plans, rewritten origin/main, nonancestor and ambiguous registration', t => {
  const f = fixture(t);
  assert.throws(() => verifyHistoricalOnlineTool({...f.plan, sparsePatterns: '/*\n'}, f.currentRevision, f.ports), /historical_plan_changed/);
  for (const revision of [f.plan.target, f.currentRevision + '\n', a.toUpperCase()])
    assert.throws(() => verifyHistoricalOnlineTool(f.plan, revision, f.ports), /historical_revision_invalid/);
  assert.throws(() => verifyHistoricalOnlineTool(f.plan, a, f.ports), /main_changed/);
  for (const duplicate of [false, true]) {
    const git = (cwd, args, input) => {
      const result = fixtureGit(cwd, args, input);
      if (args[0] === 'worktree' && args[1] === 'list') return duplicate ? result + result : result.replaceAll('detached', 'detached\nlocked');
      return result;
    };
    assert.throws(() => verifyHistoricalOnlineTool(f.plan, f.currentRevision, {...f.ports, git}), /historical_registration_changed/);
  }
  const tree = fixtureGit(f.app, ['rev-parse', 'HEAD^{tree}']).trim();
  const unrelated = fixtureGit(f.app, ['commit-tree', tree], 'Unrelated fixture history\n').trim();
  fixtureGit(f.app, ['update-ref', 'refs/remotes/origin/main', unrelated]);
  assert.throws(() => verifyHistoricalOnlineTool(f.plan, unrelated, f.ports));
  assert.equal(fs.existsSync(f.plan.directory), true);
});

test('historical target junction is refused and unrelated fixture contents remain intact', t => {
  const f = fixture(t), original = `${f.plan.directory}-preserved`;
  fs.renameSync(f.plan.directory, original);
  fs.symlinkSync(original, f.plan.directory, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => verifyHistoricalOnlineTool(f.plan, f.currentRevision, f.ports));
  assert.equal(fs.readFileSync(path.join(original, 'src/source.ts'), 'utf8'), f.files.get('src/source.ts'));
});

test('production wrapper rejects a non-target module without inspecting a real server', () => {
  assert.deepEqual(runOnlineReleaseToolRetention({target: 'invalid', bootstrapDirectory: '/tmp/fixture'}),
    {status: 'pending', reason: 'online_tool_retention_invocation_invalid'});
});

test('production deletion is singular non-force Git removal and accounting is explicitly net filesystem availability', () => {
  const source = fs.readFileSync(fileURLToPath(new URL('./online-release-tool-retention.mjs', import.meta.url)), 'utf8');
  assert.doesNotMatch(source, /manual-[\w-]+\.mjs|\brmSync\s*\(|\brmdirSync\s*\(|--force|worktree[^\n]*prune/);
  assert.match(source, /runOnlineToolGit\(APP, \['worktree', 'remove', victim\.directory\]\)/);
  assert.match(source, /netAvailableIncrease: after\.disk\.available - beforeDisk\.available/);
  assert.match(source, /remainingExcess: plan\.remainingExcess - 1/);
  assert.match(source, /assertAuditComplete\(\)/);
  assert.match(source, /withOnlineToolPreparationLocks/);
  assert.match(source, /assertUnreferenced\(victim\.directory, victim\.revision\)/);
  assert.match(source, /dump\.pm2\.bak/);
  assert.match(source, /\/proc\/self\/mountinfo/);
  assert.match(source, /\['environ', 'maps'\]/);
  assert.match(source, /run\('docker', \['inspect'/);
  assert.match(source, /online_tool_retention_\[a-z0-9_\]/);
});
