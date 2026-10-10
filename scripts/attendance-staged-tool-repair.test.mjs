import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {ATTENDANCE_STAGED_REPAIR as p, ATTENDANCE_STAGED_REPAIR_FILES as allowed,
  ATTENDANCE_STAGED_REPAIR_PRESERVED as pins, assertAttendanceStagedRepairReceipt} from './attendance-staged-tool-repair-policy.mjs';
import {stagedRepairImportClosure, prepareAttendanceStagedToolRepair} from './attendance-staged-tool-repair.mjs';

const entry = fileURLToPath(new URL('./attendance-staged-tool-repair.mjs', import.meta.url));
const repository = fileURLToPath(new URL('../', import.meta.url));
const source = fs.readFileSync(entry, 'utf8');
const syntax = ts.createSourceFile(entry, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const revision = 'e'.repeat(40), APP = '/www/wwwroot/merchant-space';
const digest = value => createHash('sha256').update(value).digest('hex');
const fail = code => {throw Error(`attendance_staged_repair_${code}`);};
const need = (value, code) => {if (!value) fail(code);};
const same = (a, b, code) => need(JSON.stringify(a) === JSON.stringify(b), code);
function functionCode(name) {
  const node = syntax.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name);
  assert.ok(node, name); return node.getText(syntax).replace(/^export\s+/, '');
}
function functionVm(name, globals) {
  return runInNewContext(`${functionCode(name)}\n${name}`, {Buffer, createHash, path: path.posix, fail, need, same, ...globals}, {timeout: 1000});
}

test('real static closure includes every transitive local import according to the JS parser', () => {
  const read = name => fs.readFileSync(path.join(repository, name), 'utf8'), seen = new Set();
  const visit = name => {
    if (seen.has(name)) return; seen.add(name);
    const tree = ts.createSourceFile(name, read(name), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    for (const node of tree.statements) {
      if (!ts.isImportDeclaration(node) && !ts.isExportDeclaration(node)) continue;
      if (!node.moduleSpecifier) continue;
      assert.ok(ts.isStringLiteral(node.moduleSpecifier)); const specifier = node.moduleSpecifier.text;
      if (specifier.startsWith('node:')) continue;
      assert.ok(specifier.startsWith('./'), `${name}: ${specifier}`);
      visit(path.posix.normalize(path.posix.join(path.posix.dirname(name), specifier)));
    }
  };
  visit('scripts/attendance-staged-tool-repair.mjs');
  assert.deepEqual(stagedRepairImportClosure(read), [...seen].sort());
  assert.ok(seen.has('scripts/prepare-online-release-tool.mjs'));
  assert.ok(seen.has('scripts/attendance-staged-tool-repair-policy.mjs'));
});

test('closure follows inline/multiline static imports, reexports and cycles but refuses escapes', () => {
  const sources = new Map([
    ['scripts/attendance-staged-tool-repair.mjs', "import fs from 'node:fs'; import {a} from './a.mjs';\nexport {b} from './b.mjs';"],
    ['scripts/a.mjs', "import {\n b\n} from './b.mjs';"], ['scripts/b.mjs', "import './a.mjs';"],
  ]);
  assert.deepEqual(stagedRepairImportClosure(name => {assert.ok(sources.has(name)); return sources.get(name);}),
    ['scripts/a.mjs', 'scripts/attendance-staged-tool-repair.mjs', 'scripts/b.mjs']);
  for (const specifier of ['../outside.mjs', '/tmp/outside.mjs', 'external-package', './bad.test.mjs'])
    assert.throws(() => stagedRepairImportClosure(() => `import '${specifier}';`), /bootstrap_import_invalid/);
});

function sourceFixture({change = 'M\tscripts/attendance-production-052-compatibility.mjs', changedInputs = false} = {}) {
  const calls = [], rows = `100644 blob ${'a'.repeat(40)}\tsrc/app/page.tsx\0`;
  const tool = `/var/lib/faolla-online-code/${revision}`;
  const git = (directory, args) => {
    calls.push({directory, args});
    if (args[0] === 'merge-base') return '';
    if (args[0] === 'diff') return change;
    if (args[0] === 'status') return '';
    if (args.join(' ') === 'rev-parse --abbrev-ref HEAD') return 'HEAD';
    return revision;
  };
  const verify = functionVm('verifySource', {p, allowed, APP, process: {platform: 'linux', getuid: () => 0},
    git, sha: digest, assertOnlineToolOwnedPath: () => {}, createOnlineReleaseToolPlan: target => ({target}),
    verifyOnlineReleaseTool: plan => {assert.equal(plan.target, revision);},
    runOnlineToolGit: (directory, args) => {
      calls.push({directory, args}); assert.equal(args[0], 'ls-tree');
      return Buffer.from(changedInputs && args.at(-1) === revision ? rows.replace('a'.repeat(40), 'b'.repeat(40)) : rows);
    }});
  return {calls, verify: () => verify(revision, tool)};
}
test('source repair accepts only reviewed tool paths and independently preserves every other Git tree input', () => {
  const f = sourceFixture(), result = f.verify();
  assert.equal(result.toolRevision, revision); assert.deepEqual([...result.changedToolFiles], ['scripts/attendance-production-052-compatibility.mjs']);
  assert.match(result.sourceInputsSha256, /^[a-f0-9]{64}$/);
  for (const change of ['M\tsrc/app/page.tsx', 'M\tpackage-lock.json', 'M\tpackage.json', 'M\tnext.config.ts',
    'M\tpublic/logo.png', 'M\tscripts/supabase-migrations/202610090210_any.sql',
    'D\tscripts/attendance-production-052-compatibility.mjs', 'R100\told\tscripts/attendance-production-052-compatibility.mjs', ''])
    assert.throws(() => sourceFixture({change}).verify(), /source_scope/, change);
  assert.throws(() => sourceFixture({changedInputs: true}).verify(), /application_inputs_changed/);
  assert.ok(f.calls.every(c => ['rev-parse', 'status', 'diff', 'merge-base', 'ls-tree'].includes(c.args[0])));
});

function treeFixture({size = 700000, mode = 0o644, uid = 0, type = 'file', link = '/synthetic-tree/a.bin', change = ''} = {}) {
  const root = '/synthetic-tree', file = `${root}/a.bin`, content = Buffer.alloc(size, 7), calls = [], descriptors = new Map();
  let directoryLists = 0, fileStats = 0, linkReads = 0;
  const stat = isRoot => ({dev: 1, ino: isRoot ? 1 : 2, uid: isRoot ? 0 : uid, mode: isRoot ? 0o755 : mode,
    nlink: 1, size: isRoot ? 0 : size, mtimeMs: 1, ctimeMs: 1, isSymbolicLink: () => !isRoot && type === 'link',
    isDirectory: () => isRoot, isFile: () => !isRoot && type === 'file'});
  const io = {
    constants: fs.constants,
    lstatSync(location) {
      assert.ok([root, file].includes(location), location); const isRoot = location === root, value = stat(isRoot);
      if (!isRoot) {fileStats++; if (change === 'linked-file' && fileStats > 1) value.ino++;}
      if (isRoot && change === 'directory-stat' && directoryLists > 1) value.ctimeMs++;
      if (!isRoot && type === 'link' && change === 'link-stat' && linkReads > 0) value.ino++;
      return value;
    },
    readdirSync(location) {assert.equal(location, root); directoryLists++; return change === 'directory-list' && directoryLists > 1 ? ['a.bin', 'new.bin'] : ['a.bin'];},
    readlinkSync(location) {assert.equal(location, file); linkReads++; return change === 'link-target' && linkReads > 1 ? './other.bin' : './inside.bin';},
    realpathSync(location) {assert.equal(location, file); return link;},
    openSync(location, flags) {assert.equal(location, file); assert.equal(flags & fs.constants.O_WRONLY, 0); calls.push({kind: 'open', flags}); descriptors.set(9, 0); return 9;},
    fstatSync(fd) {assert.ok(descriptors.has(fd)); const value = stat(false); if (change === 'opened-file') value.ino++; return value;},
    readSync(fd, buffer, offset, length) {
      assert.equal(buffer.length, 256 * 1024); assert.equal(offset, 0); assert.equal(length, buffer.length);
      const position = descriptors.get(fd), n = Math.min(length, content.length - position);
      content.copy(buffer, 0, position, position + n); descriptors.set(fd, position + n); calls.push({kind: 'read', n}); return n;
    },
    closeSync(fd) {assert.ok(descriptors.has(fd)); descriptors.delete(fd); calls.push({kind: 'close'});},
  };
  const fingerprint = functionVm('attendanceRepairTreeFingerprint', {fs: io, sha: digest,
    assertOnlineToolOwnedPath: location => assert.equal(location, root)});
  return {root, calls, descriptors, io, run: options => fingerprint(root, options), expected: digest(JSON.stringify([['a.bin', size, digest(content)]]))};
}
test('synthetic tree fingerprint reads bounded chunks, hashes full bytes and always closes its descriptor', () => {
  const f = treeFixture(), result = f.run();
  assert.equal(result.sha256, f.expected); assert.equal(result.bytes, 700000); assert.equal(result.files, 1);
  assert.ok(f.calls.filter(c => c.kind === 'read').length >= 4); assert.equal(f.descriptors.size, 0);
  assert.deepEqual(f.calls.at(-1), {kind: 'close'});
});
test('synthetic tree fingerprint rejects ownership, modes, escapes, nonfiles and file/directory/link mutation', () => {
  for (const options of [{uid: 1000}, {mode: 0o666}, {type: 'socket'}, {type: 'link', link: '/outside/a.bin'},
    {change: 'opened-file'}, {change: 'linked-file'}, {change: 'directory-list'}, {change: 'directory-stat'},
    {type: 'link', change: 'link-stat'}, {type: 'link', change: 'link-target'}]) {
    const f = treeFixture(options);
    assert.throws(() => f.run({allowInternalLinks: options.type === 'link'}), /tree_(?:owner|mode|link|type|changed)/, JSON.stringify(options));
    assert.equal(f.descriptors.size, 0);
  }
  const stable = treeFixture({type: 'link'});
  assert.throws(stable.run, /tree_link/, 'build output does not permit links by default');
  const result = stable.run({allowInternalLinks: true});
  assert.equal(result.sha256, digest(JSON.stringify([['a.bin', 'link', './inside.bin']])));
  assert.equal(result.bytes, 0); assert.equal(result.files, 1);
});
test('synthetic fingerprint refuses oversized metadata and growth beyond the initial read budget', () => {
  const oversized = treeFixture({size: 1});
  const previous = oversized.io.lstatSync;
  oversized.io.lstatSync = location => {const s = previous(location); if (location !== oversized.root) s.size = 256 * 1024 ** 2 + 1; return s;};
  assert.throws(oversized.run, /tree_type/); assert.equal(oversized.calls.length, 0);
  const growing = treeFixture({size: 1}); let reads = 0;
  growing.io.readSync = (fd, buffer) => {assert.ok(growing.descriptors.has(fd)); reads++; if (reads > 3) throw Error('unbounded_fixture_read'); buffer.fill(9); return buffer.length;};
  assert.throws(growing.run, /attendance_staged_repair_tree_(?:changed|size|read)/);
  assert.equal(reads, 1, 'reject before a second read can exceed the immutable initial size');
  assert.equal(growing.descriptors.size, 0);
  const truncated = treeFixture({size: 1}); truncated.io.readSync = () => 0;
  assert.throws(truncated.run, /tree_changed/); assert.equal(truncated.descriptors.size, 0);
});

function preparationFixture({changeAfter = false, existingAttempt = false} = {}) {
  const calls = [], written = new Map(), descriptors = new Map(); let locked = false, observations = 0;
  const receiptFile = `${p.operation}/attendance-staged-tool-repair.json`, constants = fs.constants;
  const before = {preservedFiles: {...pins}, builtOutputSha256: p.builtOutputSha256, dependencySha256: 'b'.repeat(64)};
  const sourceInfo = {toolRevision: revision, changedToolFiles: ['scripts/attendance-production-052-compatibility.mjs'], sourceInputsSha256: 'a'.repeat(64)};
  const io = {
    constants,
    existsSync: location => written.has(location) || existingAttempt && location.endsWith('/attendance-compatibility-attempt.json'),
    openSync(location, flags, mode) {
      assert.ok(locked); calls.push({kind: 'open', location, flags, mode}); const fd = descriptors.size + 10;
      if (location === receiptFile) {assert.equal(mode, 0o600); assert.ok(flags & constants.O_EXCL); assert.ok(flags & constants.O_CREAT);}
      else {assert.equal(location, p.operation); assert.equal(flags & constants.O_WRONLY, 0);}
      descriptors.set(fd, location); return fd;
    },
    writeFileSync(fd, bytes) {assert.equal(descriptors.get(fd), receiptFile); written.set(receiptFile, Buffer.from(bytes)); calls.push({kind: 'write'});},
    fsyncSync(fd) {assert.ok(descriptors.has(fd)); calls.push({kind: 'fsync', location: descriptors.get(fd)});},
    closeSync(fd) {assert.ok(descriptors.has(fd)); descriptors.delete(fd); calls.push({kind: 'close'});},
  };
  const prepare = functionVm('prepareAttendanceStagedToolRepair', {p, pins, ROOT: '/synthetic-bootstrap', APP,
    maintenance: '/var/lib/faolla-maintenance/merchant-space', receiptFile, fs: io, sha: digest,
    process: {umask: value => {calls.push({kind: 'umask', value}); return 0o022;}},
    verifySource: (target, directory, options) => {assert.equal(target, revision); calls.push({kind: 'source', directory, options}); return sourceInfo;},
    withOnlineToolPreparationLocks: (options, work) => {assert.equal(options.deployLock, `${APP}.deploy.lock`); calls.push({kind: 'lock'}); locked = true; try {return work();} finally {locked = false;}},
    observe: () => {assert.ok(locked); observations++; calls.push({kind: 'observe'}); return changeAfter && observations > 1 ? {...before, dependencySha256: 'c'.repeat(64)} : before;},
    assertAttendanceStagedRepairReceipt,
    assertOnlineToolNoPending: options => {assert.ok(locked); assertAttendanceStagedRepairReceipt(options.fixedStagedRepairReceipt); calls.push({kind: 'pending'});},
    createOnlineReleaseToolPlan: target => ({target}),
    executeOnlineReleaseToolPlan: plan => {assert.ok(locked); assert.equal(plan.target, revision); calls.push({kind: 'prepare-source-only'}); return {directory: '/synthetic-prepared-tools', target: revision};},
    ownedFile: (location, options) => {assert.equal(location, receiptFile); assert.equal(options.privateMode, true); assert.ok(written.has(location)); return written.get(location);},
  });
  return {calls, written, descriptors, receiptFile, run: confirm => prepare(revision, confirm)};
}
test('synthetic source-only preparation holds the original locks, observes twice and seals a write-once private receipt', () => {
  const f = preparationFixture(), result = f.run('approved-staged-attendance-tool-repair');
  assert.equal(result.applicationRebuilt, false); assert.equal(result.productionDatabaseChanged, false); assert.equal(result.trafficChanged, false);
  assert.equal(result.target, p.target); assert.equal(result.toolRevision, revision); assert.equal(f.written.size, 1); assert.equal(f.descriptors.size, 0);
  assert.equal(f.calls.filter(c => c.kind === 'observe').length, 2);
  assert.equal(f.calls.filter(c => c.kind === 'prepare-source-only').length, 1);
  assert.deepEqual(f.calls.filter(c => c.kind === 'fsync').map(c => c.location), [f.receiptFile, p.operation]);
  assert.ok(f.calls.findIndex(c => c.kind === 'prepare-source-only') < f.calls.findLastIndex(c => c.kind === 'observe'));
  assert.ok(f.calls.findLastIndex(c => c.kind === 'observe') < f.calls.findIndex(c => c.kind === 'write'));
  assert.equal(result.receiptSha256, digest(f.written.get(f.receiptFile)));
});
test('synthetic preparation refuses missing approval, existing DB-attempt evidence or changed candidate without a receipt write', () => {
  for (const options of [{existingAttempt: true}, {changeAfter: true}]) {
    const f = preparationFixture(options);
    assert.throws(() => f.run('approved-staged-attendance-tool-repair'), /database_attempt_exists|candidate_changed_during_preparation/);
    assert.equal(f.written.size, 0); assert.equal(f.descriptors.size, 0);
  }
  const f = preparationFixture(); assert.throws(() => f.run('approved-end-unpublished-candidate-e754793a5895'), /approval_required/);
  assert.equal(f.calls.length, 0);
});
test('runtime command sites are observations only: no build, PM2 writer, database execution or traffic writer', () => {
  const commandCalls = []; const visit = node => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'command') commandCalls.push(node.getText(syntax));
    ts.forEachChild(node, visit);
  }; visit(syntax);
  assert.deepEqual(commandCalls, ["command('pm2',['jlist'])"]);
  assert.doesNotMatch(source, /\b(?:execSync|execFileSync|buildAttendanceOnlineCandidate|applyProductionDatabaseMigrations|runAttendanceProductionMigrations|activateCandidate|restoreConfigs)\s*\(/);
  assert.doesNotMatch(source, /\bfs\.(?:rmSync|unlinkSync|renameSync|truncateSync|symlinkSync)\s*\(/);
  assert.match(source, /assertOnlineToolNoPending\(\{fixedStagedRepairReceipt:receipt\}\)/);
});
test('real CLI rejects a non-Linux/non-root invocation before any production path access', {skip: process.platform === 'linux' && process.getuid?.() === 0}, () => {
  assert.throws(() => prepareAttendanceStagedToolRepair(revision, 'approved-staged-attendance-tool-repair'), /attendance_staged_repair_invocation/);
  const actual = spawnSync(process.execPath, [entry, 'prepare', revision, 'approved-staged-attendance-tool-repair'], {encoding: 'utf8', timeout: 10000, windowsHide: true});
  assert.equal(actual.status, 1); assert.equal(actual.stdout, ''); assert.match(actual.stderr, /^attendance_staged_repair_invocation\r?\n$/);
});
