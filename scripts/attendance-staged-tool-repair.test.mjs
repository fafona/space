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
  ATTENDANCE_STAGED_REPAIR_PRESERVED as pins, ATTENDANCE_STAGED_FOLLOW_ON as follow,
  ATTENDANCE_STAGED_SEQUENCE_FOLLOW_ON as sequence, ATTENDANCE_STAGED_ACL_FOLLOW_ON as acl,
  ATTENDANCE_STAGED_SCHEMA_FOLLOW_ON as schema,
  ATTENDANCE_STAGED_GUARD_FOLLOW_ON as guard,
  ATTENDANCE_STAGED_PHASE_FOLLOW_ON as phaseFollowOn,
  ATTENDANCE_STAGED_PHASE_FOLLOW_ON_FILES as phaseAllowed,
  assertAttendanceStagedRepairReceipt, assertAttendanceStagedFollowOnReceipt,
  assertAttendanceStagedSequenceFollowOnReceipt, assertAttendanceStagedAclFollowOnReceipt,
  assertAttendanceStagedSchemaFollowOnReceipt, assertAttendanceStagedGuardFollowOnReceipt,
  assertAttendanceStagedPhaseFollowOnReceipt} from './attendance-staged-tool-repair-policy.mjs';
import {stagedRepairImportClosure, prepareAttendanceStagedToolRepair, prepareAttendanceStagedToolRepairFollowOn,
  prepareAttendanceStagedToolRepairSequenceFollowOn, prepareAttendanceStagedToolRepairAclFollowOn,
  prepareAttendanceStagedToolRepairSchemaFollowOn, prepareAttendanceStagedToolRepairGuardFollowOn,
  prepareAttendanceStagedToolRepairPhaseFollowOn} from './attendance-staged-tool-repair.mjs';
import {stagedFollowOnReceiptFixture,stagedSequenceFollowOnReceiptFixture,stagedAclFollowOnReceiptFixture,
  stagedSchemaFollowOnReceiptFixture,stagedGuardFollowOnReceiptFixture,
  stagedPhaseFollowOnReceiptFixture} from './attendance-staged-tool-repair-policy.test.mjs';

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
  return runInNewContext(`${functionCode(name)}\n${name}`, {Buffer, JSON, createHash, path: path.posix, fail, need, same, ...globals}, {timeout: 1000});
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
  assert.equal(seen.size,11);
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

function sourceFixture({change = 'M\tscripts/attendance-production-052-compatibility.mjs', changedInputs = false,scopeFiles} = {}) {
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
  return {calls, verify: () => verify(revision, tool,scopeFiles?{scopeFiles}:undefined)};
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

test('phase source scope adds only the two approved native guard files while the historical scope stays frozen',()=>{
  assert.equal(allowed.length,15);assert.equal(phaseAllowed.length,17);assert.deepEqual(phaseAllowed.slice(0,15),allowed);
  const native=['scripts/attendance-production-multiphase-guards-native.mjs','scripts/attendance-production-multiphase-guards-native.test.mjs'];
  assert.deepEqual(phaseAllowed.slice(15),native);
  const change=['M\tscripts/attendance-production-052-compatibility.mjs',...native.map(name=>`A\t${name}`)].join('\n');
  assert.deepEqual([...sourceFixture({change,scopeFiles:phaseAllowed}).verify().changedToolFiles],
    ['scripts/attendance-production-052-compatibility.mjs',...native].sort());
  assert.throws(()=>sourceFixture({change:'M\tscripts/attendance-production-052-compatibility.mjs\nA\tsrc/app/page.tsx',scopeFiles:phaseAllowed}).verify(),/source_scope/);
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

test('synthetic original follow-on evidence requires exact old bytes pin, fixed historical scope and unchanged application inputs', () => {
  const {original: base} = stagedFollowOnReceiptFixture(), rows = `100644 blob ${'a'.repeat(40)}\tsrc/app/page.tsx`;
  function fixture({wrongPin = false, wrongScope = false, wrongInputs = false, wrongReceiptInput = false} = {}) {
    const original = {...base, sourceInputsSha256: wrongReceiptInput ? 'c'.repeat(64) : digest(rows)};
    const raw = Buffer.from(JSON.stringify(original)), calls = [];
    const read = functionVm('originalFollowOnReceipt', {p, follow, allowed, APP, receiptFile: `${p.operation}/attendance-staged-tool-repair.json`,
      ownedFile: (file, options) => {assert.equal(file, `${p.operation}/attendance-staged-tool-repair.json`); assert.equal(options.privateMode, true); return raw;},
      sha: bytes => Buffer.isBuffer(bytes) && bytes.equals(raw) ? wrongPin ? '0'.repeat(64) : follow.previousReceiptSha256 : digest(bytes),
      assertAttendanceStagedRepairReceipt, assertOnlineToolOwnedPath: location => assert.equal(location, APP),
      git: (directory, args) => {assert.equal(directory, APP); calls.push(args); if (args[0] === 'merge-base') return '';
        assert.equal(args[0], 'diff'); return wrongScope ? 'M\tsrc/app/page.tsx' : 'M\tscripts/attendance-production-052-compatibility.mjs';},
      runOnlineToolGit: (directory, args) => {assert.equal(directory, APP); assert.equal(args[0], 'ls-tree'); calls.push(args);
        return Buffer.from((wrongInputs && args.at(-1) === follow.previousToolRevision ? rows.replace('a'.repeat(40), 'b'.repeat(40)) : rows) + '\0');},
    });
    return {read, calls, raw};
  }
  const positive = fixture(); assert.equal(positive.read().receiptSha256, follow.previousReceiptSha256);
  assert.ok(positive.calls.every(args => ['diff', 'merge-base', 'ls-tree'].includes(args[0])));
  for (const options of [{wrongPin: true}, {wrongScope: true}, {wrongInputs: true}, {wrongReceiptInput: true}])
    assert.throws(fixture(options).read, /original_receipt_(?:changed|source)/);
});

test('synthetic archived failure requires exact private directory entries, every file pin and stable directory identity', () => {
  function fixture({extra = false, changedFile = false, mode = 0o700, moved = false} = {}) {
    let lists = 0;
    const bytes = new Map(Object.keys(follow.archive.files).map(name => [name, Buffer.from(name)]));
    const read = functionVm('archivedFollowOnFailure', {follow,
      assertOnlineToolOwnedPath: location => assert.equal(location, follow.archive.directory),
      fs: {lstatSync: location => {assert.equal(location, follow.archive.directory); return {dev: 1, ino: moved && lists > 1 ? 2 : 1, uid: 0, mode, mtimeMs: 1, ctimeMs: 1};},
        readdirSync: location => {assert.equal(location, follow.archive.directory); lists++; return [...bytes.keys(), ...(extra ? ['unexpected.json'] : [])];}},
      ownedFile: (location, options) => {assert.ok(location.startsWith(follow.archive.directory + '/')); assert.equal(options.privateMode, true);
        return bytes.get(path.posix.basename(location));},
      sha: value => changedFile ? '0'.repeat(64) : follow.archive.files[value.toString('utf8')],
    });
    return read;
  }
  assert.deepEqual(fixture()(), follow.archive);
  for (const options of [{extra: true}, {changedFile: true}, {mode: 0o755}, {moved: true}])
    assert.throws(fixture(options), /failure_archive_(?:invalid|changed)/);
});

function followOnPreparationFixture({existingAttempt = false, existingReceipt = false, changeCandidate = false,
  changeOriginal = false, changeArchive = false, wrongReadback = false, brokenAncestry = false} = {}) {
  const {original} = stagedFollowOnReceiptFixture(), calls = [], descriptors = new Map(), written = new Map();
  const oldFile = `${p.operation}/attendance-staged-tool-repair.json`, nextFile = `${p.operation}/${follow.receiptName}`;
  const oldBytes = Buffer.from(JSON.stringify(original)); written.set(oldFile, oldBytes);
  const before = {preservedFiles: {...pins}, builtOutputSha256: p.builtOutputSha256, dependencySha256: original.dependencySha256};
  const info = {toolRevision: revision, sourceInputsSha256: original.sourceInputsSha256,
    changedToolFiles: ['scripts/attendance-production-052-compatibility.mjs', 'scripts/attendance-staged-tool-repair.mjs', 'scripts/attendance-staged-tool-repair-policy.mjs']};
  let locked = false, observations = 0, originals = 0, archives = 0;
  const constants = {...fs.constants, O_NOFOLLOW: fs.constants.O_NOFOLLOW || 0x20000,
    O_DIRECTORY: fs.constants.O_DIRECTORY || 0x10000}; // Explicit synthetic Linux flags, including on Windows.
  const io = {constants,
    openSync(location, flags, mode) {assert.ok(locked); const fd = descriptors.size + 10; calls.push({kind: 'open', location, flags, mode});
      if (location === nextFile) {assert.equal(mode, 0o600); assert.ok(flags & constants.O_EXCL); assert.ok(flags & constants.O_NOFOLLOW);}
      else assert.equal(location, p.operation); descriptors.set(fd, location); return fd;},
    writeFileSync(fd, bytes) {assert.equal(descriptors.get(fd), nextFile); written.set(nextFile, Buffer.from(bytes)); calls.push({kind: 'write', location: nextFile});},
    fsyncSync(fd) {assert.ok(descriptors.has(fd)); calls.push({kind: 'fsync', location: descriptors.get(fd)});},
    closeSync(fd) {assert.ok(descriptors.has(fd)); descriptors.delete(fd);},
  };
  const run = functionVm('prepareAttendanceStagedToolRepairFollowOn', {p, follow, ROOT: '/synthetic-bootstrap', APP,
    maintenance: '/var/lib/faolla-maintenance/merchant-space', followOnReceiptFile: nextFile, fs: io, sha: digest,
    process: {umask: () => 0o022},
    evidenceExists: location => location === nextFile ? existingReceipt : existingAttempt && location.endsWith('/attendance-compatibility-attempt.json'),
    git: (directory, args) => {assert.equal(directory, APP); assert.deepEqual([...args], ['merge-base', '--is-ancestor', follow.previousToolRevision, revision]);
      calls.push({kind: 'ancestry'}); if (brokenAncestry) throw Error('ancestry_failed'); return '';},
    verifySource: (target, directory, options) => {assert.equal(target, revision); calls.push({kind: 'source', directory, options}); return info;},
    withOnlineToolPreparationLocks: (options, work) => {assert.equal(options.deployLock, `${APP}.deploy.lock`); calls.push({kind: 'lock'}); locked = true; try {return work();} finally {locked = false;}},
    originalFollowOnReceipt: () => {assert.ok(locked); originals++; calls.push({kind: 'original'});
      if (changeOriginal && originals > 1) throw Error('original_receipt_changed'); return {receipt: original, receiptSha256: follow.previousReceiptSha256};},
    archivedFollowOnFailure: () => {assert.ok(locked); archives++; calls.push({kind: 'archive'});
      if (changeArchive && archives > 1) throw Error('failure_archive_changed'); return follow.archive;},
    observe: () => {assert.ok(locked); observations++; calls.push({kind: 'observe'}); return changeCandidate && observations > 1 ? {...before, dependencySha256: 'c'.repeat(64)} : before;},
    assertAttendanceStagedFollowOnReceipt,
    assertOnlineToolNoPending: options => {assert.ok(locked); assertAttendanceStagedRepairReceipt(options.fixedStagedRepairReceipt);
      assert.equal(options.fixedStagedRepairReceipt.toolRevision, revision); calls.push({kind: 'pending'});},
    createOnlineReleaseToolPlan: target => ({target}), executeOnlineReleaseToolPlan: plan => {assert.ok(locked); assert.equal(plan.target, revision);
      calls.push({kind: 'prepare-source-only'}); return {directory: '/synthetic-tools', target: revision};},
    ownedFile: (location, options) => {assert.equal(location, nextFile); assert.equal(options.privateMode, true);
      return wrongReadback ? Buffer.from('{}') : written.get(nextFile);},
  });
  return {calls, written, descriptors, oldFile, nextFile, oldBytes, run: confirm => run(revision, confirm)};
}
test('synthetic follow-on preparation retains original bytes, archives and build, and writes only one new durable receipt under the normal locks', () => {
  const f = followOnPreparationFixture(), result = f.run('approved-staged-attendance-tool-repair-follow-on');
  assert.equal(result.applicationRebuilt, false); assert.equal(result.productionDatabaseChanged, false); assert.equal(result.trafficChanged, false);
  assert.equal(result.toolRevision, revision); assert.equal(result.originalReceiptSha256, follow.previousReceiptSha256);
  assert.ok(f.written.get(f.oldFile).equals(f.oldBytes)); assert.equal(f.written.size, 2); assert.equal(f.descriptors.size, 0);
  assert.equal(f.calls.filter(c => c.kind === 'observe').length, 2); assert.equal(f.calls.filter(c => c.kind === 'prepare-source-only').length, 1);
  assert.deepEqual(f.calls.filter(c => c.kind === 'fsync').map(c => c.location), [f.nextFile, p.operation]);
  assert.ok(f.calls.findLastIndex(c => c.kind === 'observe') < f.calls.findIndex(c => c.kind === 'write'));
  assert.equal(result.receiptSha256, digest(f.written.get(f.nextFile)));
});
test('synthetic follow-on rejects missing approval, another branch, live attempts, reused receipt or changed evidence without rewriting anything', () => {
  const approval = followOnPreparationFixture(); assert.throws(() => approval.run('approved-staged-attendance-tool-repair'), /approval_required/);
  assert.equal(approval.calls.length, 0);
  for (const options of [{existingAttempt: true}, {existingReceipt: true}, {changeCandidate: true}, {changeOriginal: true}, {changeArchive: true}, {brokenAncestry: true}]) {
    const f = followOnPreparationFixture(options); assert.throws(() => f.run('approved-staged-attendance-tool-repair-follow-on'),
      /database_attempt_exists|follow_on_receipt_exists|candidate_changed_during_preparation|original_receipt_changed|failure_archive_changed|ancestry_failed/);
    assert.equal(f.written.size, 1); assert.ok(f.written.get(f.oldFile).equals(f.oldBytes)); assert.equal(f.descriptors.size, 0);
  }
  const failedReadback = followOnPreparationFixture({wrongReadback: true});
  assert.throws(() => failedReadback.run('approved-staged-attendance-tool-repair-follow-on'), /receipt_write_changed/);
  assert.equal(failedReadback.written.size, 2, 'retain the failed new write as evidence, without clearing or retrying');
});

test('synthetic verification selects only a fully validated follow-on and never silently falls back on a broken chain', () => {
  const {original, chain} = stagedFollowOnReceiptFixture(), raw = Buffer.from(JSON.stringify(original)), followRaw = Buffer.from(JSON.stringify(chain));
  const oldFile = `${p.operation}/attendance-staged-tool-repair.json`, nextFile = `${p.operation}/${follow.receiptName}`;
  function fixture({present = true, invalid = false, changedOriginal = false, changedArchive = false, changedFollow = false} = {}) {
    let originalReads = 0, followReads = 0, archiveReads = 0; const requests = [];
    const verify = functionVm('verifyAttendanceStagedToolRepairReceipt', {p, follow, APP, ROOT: '/synthetic-tools', receiptFile: oldFile,
      followOnReceiptFile: nextFile, sequenceFollowOnReceiptFile: `${p.operation}/${sequence.receiptName}`,
      aclFollowOnReceiptFile: `${p.operation}/${acl.receiptName}`, schemaFollowOnReceiptFile: `${p.operation}/${schema.receiptName}`, sha: digest,
      guardFollowOnReceiptFile: `${p.operation}/${guard.receiptName}`,
      phaseFollowOnReceiptFile:`${p.operation}/${phaseFollowOn.receiptName}`,
      evidenceExists: file => {if([`${p.operation}/${phaseFollowOn.receiptName}`,`${p.operation}/${guard.receiptName}`,`${p.operation}/${schema.receiptName}`,`${p.operation}/${acl.receiptName}`,`${p.operation}/${sequence.receiptName}`].includes(file))return false;assert.equal(file, nextFile);return present;},
      ownedFile: (file, options) => {assert.equal(options.privateMode, true); if (file === oldFile) return raw; assert.equal(file, nextFile); followReads++;
        return invalid ? Buffer.from('{}') : changedFollow && followReads > 1 ? Buffer.from('{}') : followRaw;},
      originalFollowOnReceipt: () => {originalReads++; if (changedOriginal && originalReads > 1) throw Error('original_receipt_changed');
        return {receipt: original, receiptSha256: follow.previousReceiptSha256};},
      archivedFollowOnFailure: () => {archiveReads++; if (changedArchive && archiveReads > 1) throw Error('failure_archive_changed'); return follow.archive;},
      assertAttendanceStagedRepairReceipt, assertAttendanceStagedFollowOnReceipt,
      git: (directory, args) => {assert.equal(directory, APP); assert.deepEqual([...args], ['merge-base', '--is-ancestor', follow.previousToolRevision, chain.effectiveReceipt.toolRevision]); return '';},
      verifySource: (target, root) => {requests.push({target, root}); const receipt = present ? chain.effectiveReceipt : original;
        return {changedToolFiles: receipt.changedToolFiles, sourceInputsSha256: receipt.sourceInputsSha256};},
      observe: () => ({dependencySha256: original.dependencySha256}),
    });
    return {requests, run: () => verify({target: p.target, rootDir: '/synthetic-tools', phase: 'migration'})};
  }
  const f = fixture(), result = f.run(); assert.equal(result.toolRevision, chain.effectiveReceipt.toolRevision);
  assert.equal(result.receiptSha256, digest(followRaw)); assert.equal(result.originalReceiptSha256, follow.previousReceiptSha256);
  assert.equal(result.receiptKind, 'attendance-staged-tool-repair-follow-on'); assert.deepEqual(f.requests, [{target: chain.effectiveReceipt.toolRevision, root: '/synthetic-tools'}]);
  const legacy = fixture({present: false}).run(); assert.equal(legacy.toolRevision, original.toolRevision); assert.equal(legacy.receiptSha256, digest(raw));
  for (const options of [{invalid: true}, {changedOriginal: true}, {changedArchive: true}, {changedFollow: true}]) assert.throws(fixture(options).run);
});

test('real follow-on CLI rejects a non-Linux/non-root invocation before any production path access', {skip: process.platform === 'linux' && process.getuid?.() === 0}, () => {
  assert.throws(() => prepareAttendanceStagedToolRepairFollowOn(revision, 'approved-staged-attendance-tool-repair-follow-on'), /attendance_staged_repair_invocation/);
  const actual = spawnSync(process.execPath, [entry, 'prepare-follow-on', revision, 'approved-staged-attendance-tool-repair-follow-on'], {encoding: 'utf8', timeout: 10000, windowsHide: true});
  assert.equal(actual.status, 1); assert.equal(actual.stdout, ''); assert.match(actual.stderr, /^attendance_staged_repair_invocation\r?\n$/);
});

// VM ports exercise the state machine against the fixed, completed archive.
// A deliberately incomplete copy below is test-only and never reaches a real path.
const syntheticSequence = structuredClone(sequence);
const policyEntry=fileURLToPath(new URL('./attendance-staged-tool-repair-policy.mjs',import.meta.url));
const policySyntax=ts.createSourceFile(policyEntry,fs.readFileSync(policyEntry,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const sequenceValidatorNode=policySyntax.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='assertAttendanceStagedSequenceFollowOnReceipt');
assert.ok(sequenceValidatorNode);
const sequencePolicyVm=config=>runInNewContext(`${sequenceValidatorNode.getText(policySyntax).replace(/^export\s+/,'')}\nassertAttendanceStagedSequenceFollowOnReceipt`,
  {Object,Date,assert,ATTENDANCE_STAGED_SEQUENCE_FOLLOW_ON:config,ATTENDANCE_STAGED_REPAIR:p,ATTENDANCE_STAGED_FOLLOW_ON:follow,
    followOnKeys:['schemaVersion','kind','target','baseline','previousToolRevision','previousReceiptSha256','failedAttemptArchive','effectiveReceipt','preparedAt'],
    need:value=>{if(!value)throw Error('attendance_staged_repair_receipt_invalid');},hex:value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value),
    assertAttendanceStagedRepairReceipt,assertAttendanceStagedFollowOnReceipt},{timeout:1000});
const syntheticSequenceValidator=sequencePolicyVm(syntheticSequence);
const pendingSequence={...syntheticSequence,archive:{...syntheticSequence.archive,
  files:{...syntheticSequence.archive.files,'completed.json':'PENDING'}}};
function syntheticSequenceFixture(){
  const f=stagedSequenceFollowOnReceiptFixture();f.chain.failedAttemptArchive=structuredClone(syntheticSequence.archive);return f;
}

test('synthetic sequence validator exercises the complete chain and rejects an incomplete VM-only archival pin',()=>{
  const {original,previousReceipt,chain}=syntheticSequenceFixture(),ports={originalReceipt:original,
    originalReceiptSha256:follow.previousReceiptSha256,previousReceipt,previousReceiptSha256:sequence.previousReceiptSha256};
  assert.equal(syntheticSequenceValidator(chain,ports),chain);
  for(const change of [{previousReceiptSha256:'0'.repeat(64)},{originalReceiptSha256:'0'.repeat(64)},
    {previousReceipt:{...previousReceipt,kind:'invalid'}},{target:'d'.repeat(40)},{toolRevision:'d'.repeat(40)}])
    assert.throws(()=>syntheticSequenceValidator(chain,{...ports,...change}));
  for(const change of [{skip:true},{kind:'attendance-staged-tool-repair-follow-on'},{previousToolRevision:follow.previousToolRevision},
    {previousReceiptSha256:follow.previousReceiptSha256},{failedAttemptArchive:{...syntheticSequence.archive,directory:'/arbitrary'}},
    {failedAttemptArchive:{...syntheticSequence.archive,files:{...syntheticSequence.archive.files,'completed.json':'0'.repeat(64)}}}])
    assert.throws(()=>syntheticSequenceValidator({...chain,...change},ports));
  for(const change of [{toolRevision:follow.previousToolRevision},{toolRevision:sequence.previousToolRevision},{toolRevision:p.target},
    {sourceInputsSha256:'c'.repeat(64)},{dependencySha256:'c'.repeat(64)},{scopeSha256:'c'.repeat(64)},
    {builtOutputSha256:'c'.repeat(64)},{changedToolFiles:['scripts/attendance-production-052-compatibility.mjs']},
    {preparedAt:'2026-10-10T05:00:00.000Z'},{preparedAt:'2026-10-10T08:00:00.000Z'}])
    assert.throws(()=>syntheticSequenceValidator({...chain,effectiveReceipt:{...chain.effectiveReceipt,...change}},ports));
  assert.throws(()=>sequencePolicyVm(pendingSequence)(chain,ports),/receipt_invalid/);
  assert.equal(assertAttendanceStagedSequenceFollowOnReceipt(chain,ports),chain);
});

test('synthetic historical first follow-on requires its fixed bytes, complete original chain and exact historical Git application inputs',()=>{
  const rows=`100644 blob ${'a'.repeat(40)}\tsrc/app/page.tsx`;
  function fixture({wrongPin=false,wrongRevision=false,wrongScope=false,wrongInputs=false,wrongReceiptInput=false,
    changedRead=false,changedOriginal=false,brokenOriginal=false,brokenArchive=false,brokenAncestry=false}={}){
    const {original,previousReceipt}=syntheticSequenceFixture(),requests=[];
    original.sourceInputsSha256=digest(rows);previousReceipt.effectiveReceipt.sourceInputsSha256=wrongReceiptInput?'c'.repeat(64):digest(rows);
    previousReceipt.effectiveReceipt.changedToolFiles.sort();if(wrongRevision)previousReceipt.effectiveReceipt.toolRevision='d'.repeat(40);
    const raw=Buffer.from(JSON.stringify(previousReceipt));let reads=0,originals=0;
    const read=functionVm('previousSequenceFollowOnReceipt',{p,follow,sequence,allowed,APP,
      followOnReceiptFile:`${p.operation}/${follow.receiptName}`,
      originalFollowOnReceipt:()=>{originals++;if(brokenOriginal||changedOriginal&&originals>1)throw Error('original_receipt_changed');
        return {receipt:original,receiptSha256:follow.previousReceiptSha256};},
      ownedFile:(file,options)=>{assert.equal(file,`${p.operation}/${follow.receiptName}`);assert.equal(options.privateMode,true);reads++;
        return changedRead&&reads>1?Buffer.from('{}'):raw;},
      sha:bytes=>Buffer.isBuffer(bytes)&&bytes.equals(raw)?wrongPin?'0'.repeat(64):sequence.previousReceiptSha256:digest(bytes),
      assertAttendanceStagedFollowOnReceipt,
      git:(directory,args)=>{assert.equal(directory,APP);requests.push([...args]);if(args[0]==='merge-base'){
        assert.deepEqual([...args],['merge-base','--is-ancestor',follow.previousToolRevision,sequence.previousToolRevision]);
        if(brokenAncestry)throw Error('ancestry_failed');return '';}
        assert.deepEqual([...args],['diff','--no-renames','--name-status',p.target,sequence.previousToolRevision]);
        return wrongScope?'M\tsrc/app/page.tsx':previousReceipt.effectiveReceipt.changedToolFiles.map(name=>`M\t${name}`).join('\n');},
      runOnlineToolGit:(directory,args)=>{assert.equal(directory,APP);assert.equal(args[0],'ls-tree');requests.push([...args]);
        return Buffer.from((wrongInputs&&args.at(-1)===sequence.previousToolRevision?rows.replace('a'.repeat(40),'b'.repeat(40)):rows)+'\0');},
      archivedFollowOnFailure:()=>{if(brokenArchive)throw Error('failure_archive_changed');return follow.archive;},
    });return {requests,read};
  }
  const f=fixture(),result=f.read();assert.equal(result.receiptSha256,sequence.previousReceiptSha256);
  assert.equal(result.receipt.effectiveReceipt.toolRevision,sequence.previousToolRevision);
  assert.ok(f.requests.every(args=>['merge-base','diff','ls-tree'].includes(args[0])));
  for(const options of [{wrongPin:true},{wrongRevision:true},{wrongScope:true},{wrongInputs:true},{wrongReceiptInput:true},
    {changedRead:true},{changedOriginal:true},{brokenOriginal:true},{brokenArchive:true},{brokenAncestry:true}])assert.throws(fixture(options).read);
});

test('synthetic third-failure archive requires seven exact private pins and stable identity; VM-only pending pins block before reads',()=>{
  function fixture({extra=false,missing=false,changedFile=false,mode=0o700,moved=false}={}){
    let lists=0;const bytes=new Map(Object.keys(syntheticSequence.archive.files).filter(name=>!missing||name!=='completed.json').map(name=>[name,Buffer.from(name)]));
    const read=functionVm('archivedSequenceFollowOnFailure',{sequence:syntheticSequence,
      assertOnlineToolOwnedPath:file=>assert.equal(file,syntheticSequence.archive.directory),
      fs:{lstatSync:file=>{assert.equal(file,syntheticSequence.archive.directory);return {dev:1,ino:moved&&lists>1?2:1,uid:0,mode,mtimeMs:1,ctimeMs:1};},
        readdirSync:file=>{assert.equal(file,syntheticSequence.archive.directory);lists++;return [...bytes.keys(),...(extra?['unexpected.json']:[])];}},
      ownedFile:(file,options)=>{assert.ok(file.startsWith(syntheticSequence.archive.directory+'/'));assert.equal(options.privateMode,true);
        assert.equal(options.maxBytes,8*1024**2);return bytes.get(path.posix.basename(file));},
      sha:value=>changedFile?'0'.repeat(64):syntheticSequence.archive.files[value.toString('utf8')],
    });return read;
  }
  assert.deepEqual(fixture()(),syntheticSequence.archive);
  for(const options of [{extra:true},{missing:true},{changedFile:true},{mode:0o755},{moved:true}])assert.throws(fixture(options),/failure_archive_(?:invalid|changed)/);
  const pendingRead=functionVm('archivedSequenceFollowOnFailure',{sequence:pendingSequence,
    assertOnlineToolOwnedPath:()=>assert.fail('pending archive must not read production paths')});
  assert.throws(pendingRead,/failure_archive_pending/);
});

function sequencePreparationFixture({existingPath,changeCandidate=false,changePrevious=false,changeArchive=false,brokenAncestry=false,
  wrongReadback=false,brokenPrevious=false}={}){
  const {original,previousReceipt}=syntheticSequenceFixture(),calls=[],written=new Map(),descriptors=new Map();
  const oldFile=`${p.operation}/attendance-staged-tool-repair.json`,previousFile=`${p.operation}/${follow.receiptName}`,
    nextFile=`${p.operation}/${sequence.receiptName}`;
  const oldBytes=Buffer.from(JSON.stringify(original)),previousBytes=Buffer.from(JSON.stringify(previousReceipt));
  written.set(oldFile,oldBytes);written.set(previousFile,previousBytes);
  const previous={original:{receipt:original,receiptSha256:follow.previousReceiptSha256},receipt:previousReceipt,receiptSha256:sequence.previousReceiptSha256};
  const before={preservedFiles:{...pins},builtOutputSha256:p.builtOutputSha256,dependencySha256:original.dependencySha256};
  const info={toolRevision:revision,sourceInputsSha256:original.sourceInputsSha256,changedToolFiles:previousReceipt.effectiveReceipt.changedToolFiles};
  let locked=false,observations=0,previousReads=0,archives=0;
  const constants={...fs.constants,O_NOFOLLOW:fs.constants.O_NOFOLLOW||0x20000,O_DIRECTORY:fs.constants.O_DIRECTORY||0x10000};
  const io={constants,
    openSync(file,flags,mode){assert.ok(locked);const fd=descriptors.size+10;calls.push({kind:'open',file,flags,mode});
      if(file===nextFile){assert.equal(mode,0o600);assert.ok(flags&constants.O_EXCL);assert.ok(flags&constants.O_CREAT);assert.ok(flags&constants.O_NOFOLLOW);}
      else assert.equal(file,p.operation);descriptors.set(fd,file);return fd;},
    writeFileSync(fd,bytes){assert.equal(descriptors.get(fd),nextFile);written.set(nextFile,Buffer.from(bytes));calls.push({kind:'write',file:nextFile});},
    fsyncSync(fd){assert.ok(descriptors.has(fd));calls.push({kind:'fsync',file:descriptors.get(fd)});},
    closeSync(fd){assert.ok(descriptors.has(fd));descriptors.delete(fd);},
  };
  const prepare=functionVm('prepareAttendanceStagedToolRepairSequenceFollowOn',{p,follow,sequence:syntheticSequence,APP,ROOT:'/synthetic-bootstrap',
    maintenance:'/var/lib/faolla-maintenance/merchant-space',sequenceFollowOnReceiptFile:nextFile,fs:io,sha:digest,process:{umask:()=>0o022},
    evidenceExists:file=>file===existingPath,
    git:(directory,args)=>{assert.equal(directory,APP);assert.deepEqual([...args],['merge-base','--is-ancestor',sequence.previousToolRevision,revision]);
      calls.push({kind:'ancestry'});if(brokenAncestry)throw Error('ancestry_failed');return '';},
    verifySource:(target,directory,options)=>{assert.equal(target,revision);calls.push({kind:'source',directory,options});return info;},
    withOnlineToolPreparationLocks:(options,work)=>{assert.equal(options.deployLock,`${APP}.deploy.lock`);assert.equal(options.maintenance,'/var/lib/faolla-maintenance/merchant-space');
      calls.push({kind:'locks'});locked=true;try{return work();}finally{locked=false;}},
    previousSequenceFollowOnReceipt:()=>{assert.ok(locked);previousReads++;calls.push({kind:'previous'});
      if(brokenPrevious||changePrevious&&previousReads>1)throw Error('previous_receipt_changed');return previous;},
    archivedSequenceFollowOnFailure:()=>{assert.ok(locked);archives++;calls.push({kind:'archive'});
      if(changeArchive&&archives>1)throw Error('failure_archive_changed');return syntheticSequence.archive;},
    observe:()=>{assert.ok(locked);observations++;calls.push({kind:'observe'});return changeCandidate&&observations>1?{...before,dependencySha256:'c'.repeat(64)}:before;},
    assertAttendanceStagedSequenceFollowOnReceipt:syntheticSequenceValidator,
    assertOnlineToolNoPending:options=>{assert.ok(locked);assertAttendanceStagedRepairReceipt(options.fixedStagedRepairReceipt,{toolRevision:revision});calls.push({kind:'pending'});},
    createOnlineReleaseToolPlan:target=>({target}),executeOnlineReleaseToolPlan:plan=>{assert.ok(locked);assert.equal(plan.target,revision);
      calls.push({kind:'prepare-source-only'});return {directory:'/synthetic-tools',target:revision};},
    ownedFile:(file,options)=>{assert.equal(file,nextFile);assert.equal(options.privateMode,true);return wrongReadback?Buffer.from('{}'):written.get(nextFile);},
  });return {calls,written,descriptors,oldFile,previousFile,nextFile,oldBytes,previousBytes,run:confirm=>prepare(revision,confirm)};
}

test('synthetic sequence preparation preserves both old receipts/builds, holds two normal locks, observes twice and durably seals only its exclusive new file',()=>{
  const f=sequencePreparationFixture(),result=f.run('approved-staged-attendance-tool-repair-sequence-follow-on');
  assert.equal(result.toolRevision,revision);assert.equal(result.originalReceiptSha256,follow.previousReceiptSha256);
  assert.equal(result.previousReceiptSha256,sequence.previousReceiptSha256);
  assert.equal(result.applicationRebuilt,false);assert.equal(result.productionDatabaseChanged,false);assert.equal(result.trafficChanged,false);
  assert.ok(f.written.get(f.oldFile).equals(f.oldBytes));assert.ok(f.written.get(f.previousFile).equals(f.previousBytes));
  assert.equal(f.written.size,3);assert.equal(f.descriptors.size,0);assert.equal(result.receiptSha256,digest(f.written.get(f.nextFile)));
  assert.equal(f.calls.filter(c=>c.kind==='observe').length,2);assert.equal(f.calls.filter(c=>c.kind==='prepare-source-only').length,1);
  assert.deepEqual(f.calls.filter(c=>c.kind==='fsync').map(c=>c.file),[f.nextFile,p.operation]);
  assert.ok(f.calls.findLastIndex(c=>c.kind==='observe')<f.calls.findIndex(c=>c.kind==='write'));
});

test('synthetic sequence preparation blocks every live canonical attempt and never overwrites old receipts or clears a failed new write',()=>{
  const approval=sequencePreparationFixture();assert.throws(()=>approval.run('approved-staged-attendance-tool-repair-follow-on'),/approval_required/);
  assert.equal(approval.calls.length,0);
  const absentNames=['attendance-database-compatibility.json','attendance-compatibility-attempt.json','attendance-compatibility-metadata.sql',
    'attendance-compatibility-extension-metadata.json','attendance-compatibility-extension-supplement.sql','attendance-database-progress.json','attendance-database-ready.json'];
  for(const name of absentNames){const f=sequencePreparationFixture({existingPath:`${p.operation}/${name}`});
    assert.throws(()=>f.run('approved-staged-attendance-tool-repair-sequence-follow-on'),/database_attempt_exists/);assert.equal(f.written.size,2);}
  for(const options of [{existingPath:`${p.operation}/${sequence.receiptName}`},{changeCandidate:true},{changePrevious:true},
    {changeArchive:true},{brokenAncestry:true},{brokenPrevious:true}]){
    const f=sequencePreparationFixture(options);assert.throws(()=>f.run('approved-staged-attendance-tool-repair-sequence-follow-on'),
      /sequence_follow_on_receipt_exists|candidate_changed_during_preparation|previous_receipt_changed|failure_archive_changed|ancestry_failed/);
    assert.equal(f.written.size,2);assert.ok(f.written.get(f.oldFile).equals(f.oldBytes));assert.ok(f.written.get(f.previousFile).equals(f.previousBytes));assert.equal(f.descriptors.size,0);
  }
  const f=sequencePreparationFixture({wrongReadback:true});assert.throws(()=>f.run('approved-staged-attendance-tool-repair-sequence-follow-on'),/receipt_write_changed/);
  assert.equal(f.written.size,3);assert.ok(f.written.get(f.oldFile).equals(f.oldBytes));assert.ok(f.written.get(f.previousFile).equals(f.previousBytes));
});

test('synthetic effective sequence verification never falls back if either historical chain or the new chain/archive/current source is invalid',()=>{
  const {original,previousReceipt,chain}=syntheticSequenceFixture(),oldRaw=Buffer.from(JSON.stringify(original)),previousRaw=Buffer.from(JSON.stringify(previousReceipt)),
    nextRaw=Buffer.from(JSON.stringify(chain)),oldFile=`${p.operation}/attendance-staged-tool-repair.json`,previousFile=`${p.operation}/${follow.receiptName}`,
    nextFile=`${p.operation}/${sequence.receiptName}`;
  function fixture({badPrevious=false,badNew=false,changedPrevious=false,changedNew=false,changedArchive=false,changedOriginal=false,
    changedSource=false,changedDependency=false,brokenAncestry=false}={}){
    let previousReads=0,newReads=0,archiveReads=0,oldReads=0;const requests=[];
    const verify=functionVm('verifyAttendanceStagedToolRepairReceipt',{p,follow,sequence:syntheticSequence,APP,ROOT:'/synthetic-tools',receiptFile:oldFile,
      followOnReceiptFile:previousFile,sequenceFollowOnReceiptFile:nextFile,aclFollowOnReceiptFile:`${p.operation}/${acl.receiptName}`,
      schemaFollowOnReceiptFile:`${p.operation}/${schema.receiptName}`,
      guardFollowOnReceiptFile:`${p.operation}/${guard.receiptName}`,
      phaseFollowOnReceiptFile:`${p.operation}/${phaseFollowOn.receiptName}`,
      sha:digest,evidenceExists:file=>{if([`${p.operation}/${phaseFollowOn.receiptName}`,`${p.operation}/${guard.receiptName}`,`${p.operation}/${schema.receiptName}`,`${p.operation}/${acl.receiptName}`].includes(file))return false;assert.equal(file,nextFile);return true;},
      ownedFile:(file,options)=>{assert.equal(options.privateMode,true);if(file===oldFile){oldReads++;return changedOriginal&&oldReads>1?Buffer.from('{}'):oldRaw;}
        assert.equal(file,nextFile);newReads++;return badNew||changedNew&&newReads>1?Buffer.from('{}'):nextRaw;},
      previousSequenceFollowOnReceipt:()=>{previousReads++;if(badPrevious||changedPrevious&&previousReads>1)throw Error('previous_receipt_changed');
        return {original:{receipt:original,receiptSha256:follow.previousReceiptSha256},receipt:previousReceipt,receiptSha256:sequence.previousReceiptSha256};},
      assertAttendanceStagedRepairReceipt,assertAttendanceStagedSequenceFollowOnReceipt:syntheticSequenceValidator,
      git:(directory,args)=>{assert.equal(directory,APP);assert.deepEqual([...args],['merge-base','--is-ancestor',sequence.previousToolRevision,chain.effectiveReceipt.toolRevision]);
        if(brokenAncestry)throw Error('ancestry_failed');return '';},
      archivedSequenceFollowOnFailure:()=>{archiveReads++;if(changedArchive&&archiveReads>1)throw Error('failure_archive_changed');return syntheticSequence.archive;},
      verifySource:(target,root)=>{requests.push({target,root});return {changedToolFiles:changedSource?['src/app/page.tsx']:chain.effectiveReceipt.changedToolFiles,
        sourceInputsSha256:chain.effectiveReceipt.sourceInputsSha256};},
      observe:()=>({dependencySha256:changedDependency?'c'.repeat(64):chain.effectiveReceipt.dependencySha256}),
      originalFollowOnReceipt:()=>assert.fail('cannot silently fall back to older current-source check'),
    });return {requests,run:()=>verify({target:p.target,rootDir:'/synthetic-tools',phase:'migration'})};
  }
  const f=fixture(),result=f.run();assert.equal(result.receiptKind,'attendance-staged-tool-repair-sequence-follow-on');
  assert.equal(result.toolRevision,chain.effectiveReceipt.toolRevision);assert.equal(result.receiptSha256,digest(nextRaw));
  assert.equal(result.originalReceiptSha256,follow.previousReceiptSha256);assert.equal(result.previousReceiptSha256,sequence.previousReceiptSha256);
  assert.deepEqual(f.requests,[{target:chain.effectiveReceipt.toolRevision,root:'/synthetic-tools'}]);assert.notEqual(result.receiptSha256,digest(previousRaw));
  for(const options of [{badPrevious:true},{badNew:true},{changedPrevious:true},{changedNew:true},{changedArchive:true},{changedOriginal:true},
    {changedSource:true},{changedDependency:true},{brokenAncestry:true}])assert.throws(fixture(options).run);
});

test('real sequence CLI rejects a non-Linux/non-root invocation without any production path access', {skip:process.platform==='linux'&&process.getuid?.()===0},()=>{
  assert.throws(()=>prepareAttendanceStagedToolRepairSequenceFollowOn(revision,'approved-staged-attendance-tool-repair-sequence-follow-on'),/attendance_staged_repair_invocation/);
  const actual=spawnSync(process.execPath,[entry,'prepare-sequence-follow-on',revision,'approved-staged-attendance-tool-repair-sequence-follow-on'],
    {encoding:'utf8',timeout:10000,windowsHide:true});
  assert.equal(actual.status,1);assert.equal(actual.stdout,'');assert.match(actual.stderr,/^attendance_staged_repair_invocation\r?\n$/);
});

// These VM-only fixtures exercise actual function bodies, not a Linux/DB proof.
const syntheticAcl=structuredClone(acl);
const aclPolicySource=fs.readFileSync(new URL('./attendance-staged-tool-repair-policy.mjs',import.meta.url),'utf8');
const aclPolicySyntax=ts.createSourceFile('policy.mjs',aclPolicySource,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const aclPolicyNode=aclPolicySyntax.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='assertAttendanceStagedAclFollowOnReceipt');
assert.ok(aclPolicyNode);
const aclPolicyVm=config=>runInNewContext(`${aclPolicyNode.getText(aclPolicySyntax).replace(/^export\s+/,'')}\nassertAttendanceStagedAclFollowOnReceipt`,
  {Object,Date,assert,ATTENDANCE_STAGED_REPAIR:p,ATTENDANCE_STAGED_FOLLOW_ON:follow,
    ATTENDANCE_STAGED_SEQUENCE_FOLLOW_ON:sequence,ATTENDANCE_STAGED_ACL_FOLLOW_ON:config,
    followOnKeys:['schemaVersion','kind','target','baseline','previousToolRevision','previousReceiptSha256','failedAttemptArchive','effectiveReceipt','preparedAt'],
    need:value=>{if(!value)throw Error('attendance_staged_repair_receipt_invalid');},hex:value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value),
    assertAttendanceStagedRepairReceipt,assertAttendanceStagedSequenceFollowOnReceipt},{timeout:1000});
const syntheticAclValidator=aclPolicyVm(syntheticAcl);
const pendingAcl={...syntheticAcl,archive:{...syntheticAcl.archive,files:{...syntheticAcl.archive.files,'completed.json':'PENDING'}}};
const aclPorts=f=>({originalReceipt:f.original,originalReceiptSha256:follow.previousReceiptSha256,
  firstFollowOnReceipt:f.firstFollowOnReceipt,firstFollowOnReceiptSha256:sequence.previousReceiptSha256,
  previousReceipt:f.previousReceipt,previousReceiptSha256:acl.previousReceiptSha256});

test('synthetic ACL validator requires the complete three-receipt chain; an incomplete VM-only archival pin is never authority',()=>{
  const f=stagedAclFollowOnReceiptFixture(),ports=aclPorts(f);
  assert.equal(syntheticAclValidator(f.chain,ports),f.chain);
  assert.equal(assertAttendanceStagedAclFollowOnReceipt(f.chain,ports),f.chain);
  for(const key of ['originalReceiptSha256','firstFollowOnReceiptSha256','previousReceiptSha256'])
    assert.throws(()=>syntheticAclValidator(f.chain,{...ports,[key]:'0'.repeat(64)}),key);
  for(const key of ['originalReceipt','firstFollowOnReceipt','previousReceipt'])
    assert.throws(()=>syntheticAclValidator(f.chain,{...ports,[key]:{...ports[key],kind:'broken'}}),key);
  assert.throws(()=>aclPolicyVm(pendingAcl)(f.chain,ports),/receipt_invalid/);
});

test('synthetic historical sequence receipt pins all three original byte identities and exact historical scope/application inputs',()=>{
  const rows=`100644 blob ${'a'.repeat(40)}\tsrc/app/page.tsx`;
  function fixture({wrongPin=false,wrongRevision=false,wrongScope=false,wrongInputs=false,wrongReceiptInput=false,
    changedRead=false,changedPrevious=false,brokenPrevious=false,brokenArchive=false,brokenAncestry=false}={}){
    const f=stagedAclFollowOnReceiptFixture(),requests=[];
    f.original.sourceInputsSha256=digest(rows);f.firstFollowOnReceipt.effectiveReceipt.sourceInputsSha256=digest(rows);
    f.previousReceipt.effectiveReceipt.sourceInputsSha256=wrongReceiptInput?'c'.repeat(64):digest(rows);
    f.previousReceipt.effectiveReceipt.changedToolFiles.sort();if(wrongRevision)f.previousReceipt.effectiveReceipt.toolRevision='d'.repeat(40);
    const prior={original:{receipt:f.original,receiptSha256:follow.previousReceiptSha256},
      receipt:f.firstFollowOnReceipt,receiptSha256:sequence.previousReceiptSha256};
    const raw=Buffer.from(JSON.stringify(f.previousReceipt));let reads=0,previousReads=0;
    const read=functionVm('previousAclFollowOnReceipt',{p,follow,sequence,acl,allowed,APP,
      sequenceFollowOnReceiptFile:`${p.operation}/${sequence.receiptName}`,
      previousSequenceFollowOnReceipt:()=>{previousReads++;if(brokenPrevious||changedPrevious&&previousReads>1)throw Error('previous_receipt_changed');return prior;},
      ownedFile:(file,options)=>{assert.equal(file,`${p.operation}/${sequence.receiptName}`);assert.equal(options.privateMode,true);reads++;
        return changedRead&&reads>1?Buffer.from('{}'):raw;},
      sha:bytes=>Buffer.isBuffer(bytes)&&bytes.equals(raw)?wrongPin?'0'.repeat(64):acl.previousReceiptSha256:digest(bytes),
      assertAttendanceStagedSequenceFollowOnReceipt,
      git:(directory,args)=>{assert.equal(directory,APP);requests.push([...args]);if(args[0]==='merge-base'){
        assert.deepEqual([...args],['merge-base','--is-ancestor',sequence.previousToolRevision,acl.previousToolRevision]);
        if(brokenAncestry)throw Error('ancestry_failed');return '';}
        assert.deepEqual([...args],['diff','--no-renames','--name-status',p.target,acl.previousToolRevision]);
        return wrongScope?'M\tsrc/app/page.tsx':f.previousReceipt.effectiveReceipt.changedToolFiles.map(name=>`M\t${name}`).join('\n');},
      runOnlineToolGit:(directory,args)=>{assert.equal(directory,APP);assert.equal(args[0],'ls-tree');requests.push([...args]);
        return Buffer.from((wrongInputs&&args.at(-1)===acl.previousToolRevision?rows.replace('a'.repeat(40),'b'.repeat(40)):rows)+'\0');},
      archivedSequenceFollowOnFailure:()=>{if(brokenArchive)throw Error('failure_archive_changed');return sequence.archive;},
    });return {requests,read};
  }
  const f=fixture(),result=f.read();assert.equal(result.receiptSha256,acl.previousReceiptSha256);
  assert.equal(result.receipt.effectiveReceipt.toolRevision,acl.previousToolRevision);
  assert.ok(f.requests.every(args=>['merge-base','diff','ls-tree'].includes(args[0])));
  for(const options of [{wrongPin:true},{wrongRevision:true},{wrongScope:true},{wrongInputs:true},{wrongReceiptInput:true},
    {changedRead:true},{changedPrevious:true},{brokenPrevious:true},{brokenArchive:true},{brokenAncestry:true}])assert.throws(fixture(options).read);
});

test('synthetic fourth-failure archive requires seven exact private stable pins; VM-only pending pins stop before path reads',()=>{
  function fixture({extra=false,missing=false,changedFile=false,mode=0o700,moved=false}={}){
    let lists=0;const bytes=new Map(Object.keys(acl.archive.files).filter(name=>!missing||name!=='completed.json').map(name=>[name,Buffer.from(name)]));
    const read=functionVm('archivedAclFollowOnFailure',{acl,
      assertOnlineToolOwnedPath:file=>assert.equal(file,acl.archive.directory),
      fs:{lstatSync:file=>{assert.equal(file,acl.archive.directory);return {dev:1,ino:moved&&lists>1?2:1,uid:0,mode,mtimeMs:1,ctimeMs:1};},
        readdirSync:file=>{assert.equal(file,acl.archive.directory);lists++;return [...bytes.keys(),...(extra?['unexpected.json']:[])];}},
      ownedFile:(file,options)=>{assert.ok(file.startsWith(acl.archive.directory+'/'));assert.equal(options.privateMode,true);
        assert.equal(options.maxBytes,8*1024**2);return bytes.get(path.posix.basename(file));},
      sha:value=>changedFile?'0'.repeat(64):acl.archive.files[value.toString('utf8')],
    });return read;
  }
  assert.deepEqual(fixture()(),acl.archive);
  for(const options of [{extra:true},{missing:true},{changedFile:true},{mode:0o755},{moved:true}])assert.throws(fixture(options),/failure_archive_(?:invalid|changed)/);
  const pendingRead=functionVm('archivedAclFollowOnFailure',{acl:pendingAcl,
    assertOnlineToolOwnedPath:()=>assert.fail('pending archive must not read production paths')});
  assert.throws(pendingRead,/failure_archive_pending/);
});

function aclPreparationFixture({existingPath,changeCandidate=false,changePrevious=false,changeArchive=false,brokenAncestry=false,
  wrongReadback=false,brokenPrevious=false}={}){
  const f=stagedAclFollowOnReceiptFixture(),calls=[],written=new Map(),descriptors=new Map();
  const oldFiles=[`${p.operation}/attendance-staged-tool-repair.json`,`${p.operation}/${follow.receiptName}`,`${p.operation}/${sequence.receiptName}`],
    oldBytes=[f.original,f.firstFollowOnReceipt,f.previousReceipt].map(r=>Buffer.from(JSON.stringify(r))),nextFile=`${p.operation}/${acl.receiptName}`;
  oldFiles.forEach((file,i)=>written.set(file,oldBytes[i]));
  const previous={previous:{original:{receipt:f.original,receiptSha256:follow.previousReceiptSha256},
    receipt:f.firstFollowOnReceipt,receiptSha256:sequence.previousReceiptSha256},receipt:f.previousReceipt,receiptSha256:acl.previousReceiptSha256};
  const before={preservedFiles:{...pins},builtOutputSha256:p.builtOutputSha256,dependencySha256:f.original.dependencySha256};
  const info={toolRevision:revision,sourceInputsSha256:f.original.sourceInputsSha256,changedToolFiles:f.previousReceipt.effectiveReceipt.changedToolFiles};
  let locked=false,observations=0,previousReads=0,archives=0;
  const constants={...fs.constants,O_NOFOLLOW:fs.constants.O_NOFOLLOW||0x20000,O_DIRECTORY:fs.constants.O_DIRECTORY||0x10000};
  const io={constants,
    openSync(file,flags,mode){assert.ok(locked);const fd=descriptors.size+10;calls.push({kind:'open',file,flags,mode});
      if(file===nextFile){assert.equal(mode,0o600);assert.ok(flags&constants.O_EXCL);assert.ok(flags&constants.O_CREAT);assert.ok(flags&constants.O_NOFOLLOW);}
      else assert.equal(file,p.operation);descriptors.set(fd,file);return fd;},
    writeFileSync(fd,bytes){assert.equal(descriptors.get(fd),nextFile);written.set(nextFile,Buffer.from(bytes));calls.push({kind:'write',file:nextFile});},
    fsyncSync(fd){assert.ok(descriptors.has(fd));calls.push({kind:'fsync',file:descriptors.get(fd)});},
    closeSync(fd){assert.ok(descriptors.has(fd));descriptors.delete(fd);},
  };
  const prepare=functionVm('prepareAttendanceStagedToolRepairAclFollowOn',{p,follow,sequence,acl,APP,ROOT:'/synthetic-bootstrap',
    maintenance:'/var/lib/faolla-maintenance/merchant-space',aclFollowOnReceiptFile:nextFile,fs:io,sha:digest,process:{umask:()=>0o022},
    evidenceExists:file=>file===existingPath,
    git:(directory,args)=>{assert.equal(directory,APP);assert.deepEqual([...args],['merge-base','--is-ancestor',acl.previousToolRevision,revision]);
      calls.push({kind:'ancestry'});if(brokenAncestry)throw Error('ancestry_failed');return '';},
    verifySource:(target,directory,options)=>{assert.equal(target,revision);calls.push({kind:'source',directory,options});return info;},
    withOnlineToolPreparationLocks:(options,work)=>{assert.equal(options.deployLock,`${APP}.deploy.lock`);assert.equal(options.maintenance,'/var/lib/faolla-maintenance/merchant-space');
      calls.push({kind:'locks'});locked=true;try{return work();}finally{locked=false;}},
    previousAclFollowOnReceipt:()=>{assert.ok(locked);previousReads++;calls.push({kind:'previous'});
      if(brokenPrevious||changePrevious&&previousReads>1)throw Error('previous_receipt_changed');return previous;},
    archivedAclFollowOnFailure:()=>{assert.ok(locked);archives++;calls.push({kind:'archive'});
      if(changeArchive&&archives>1)throw Error('failure_archive_changed');return acl.archive;},
    observe:()=>{assert.ok(locked);observations++;calls.push({kind:'observe'});return changeCandidate&&observations>1?{...before,dependencySha256:'c'.repeat(64)}:before;},
    assertAttendanceStagedAclFollowOnReceipt,
    assertOnlineToolNoPending:options=>{assert.ok(locked);assertAttendanceStagedRepairReceipt(options.fixedStagedRepairReceipt,{toolRevision:revision});calls.push({kind:'pending'});},
    createOnlineReleaseToolPlan:target=>({target}),executeOnlineReleaseToolPlan:plan=>{assert.ok(locked);assert.equal(plan.target,revision);
      calls.push({kind:'prepare-source-only'});return {directory:'/synthetic-tools',target:revision};},
    ownedFile:(file,options)=>{assert.equal(file,nextFile);assert.equal(options.privateMode,true);return wrongReadback?Buffer.from('{}'):written.get(nextFile);},
  });return {calls,written,descriptors,oldFiles,nextFile,oldBytes,run:confirm=>prepare(revision,confirm)};
}

test('synthetic ACL preparation preserves all three old receipts/builds, holds normal locks, observes twice and seals one exclusive durable sidecar',()=>{
  const f=aclPreparationFixture(),result=f.run('approved-staged-attendance-tool-repair-acl-follow-on');
  assert.equal(result.toolRevision,revision);assert.equal(result.originalReceiptSha256,follow.previousReceiptSha256);
  assert.equal(result.previousReceiptSha256,acl.previousReceiptSha256);
  assert.equal(result.applicationRebuilt,false);assert.equal(result.productionDatabaseChanged,false);assert.equal(result.trafficChanged,false);
  f.oldFiles.forEach((file,i)=>assert.ok(f.written.get(file).equals(f.oldBytes[i])));
  assert.equal(f.written.size,4);assert.equal(f.descriptors.size,0);assert.equal(result.receiptSha256,digest(f.written.get(f.nextFile)));
  assert.equal(f.calls.filter(c=>c.kind==='observe').length,2);assert.equal(f.calls.filter(c=>c.kind==='prepare-source-only').length,1);
  assert.deepEqual(f.calls.filter(c=>c.kind==='fsync').map(c=>c.file),[f.nextFile,p.operation]);
  assert.ok(f.calls.findLastIndex(c=>c.kind==='observe')<f.calls.findIndex(c=>c.kind==='write'));
});

test('synthetic ACL preparation blocks every live canonical artifact and preserves old evidence even if the new write fails verification',()=>{
  const approval=aclPreparationFixture();assert.throws(()=>approval.run('approved-staged-attendance-tool-repair-sequence-follow-on'),/approval_required/);
  assert.equal(approval.calls.length,0);
  const absentNames=['attendance-database-compatibility.json','attendance-compatibility-attempt.json','attendance-compatibility-metadata.sql',
    'attendance-compatibility-extension-metadata.json','attendance-compatibility-extension-supplement.sql','attendance-database-progress.json','attendance-database-ready.json'];
  for(const name of absentNames){const f=aclPreparationFixture({existingPath:`${p.operation}/${name}`});
    assert.throws(()=>f.run('approved-staged-attendance-tool-repair-acl-follow-on'),/database_attempt_exists/);assert.equal(f.written.size,3);}
  for(const options of [{existingPath:`${p.operation}/${acl.receiptName}`},{changeCandidate:true},{changePrevious:true},
    {changeArchive:true},{brokenAncestry:true},{brokenPrevious:true}]){
    const f=aclPreparationFixture(options);assert.throws(()=>f.run('approved-staged-attendance-tool-repair-acl-follow-on'),
      /acl_follow_on_receipt_exists|candidate_changed_during_preparation|previous_receipt_changed|failure_archive_changed|ancestry_failed/);
    assert.equal(f.written.size,3);f.oldFiles.forEach((file,i)=>assert.ok(f.written.get(file).equals(f.oldBytes[i])));assert.equal(f.descriptors.size,0);
  }
  const f=aclPreparationFixture({wrongReadback:true});assert.throws(()=>f.run('approved-staged-attendance-tool-repair-acl-follow-on'),/receipt_write_changed/);
  assert.equal(f.written.size,4);f.oldFiles.forEach((file,i)=>assert.ok(f.written.get(file).equals(f.oldBytes[i])));
});

test('synthetic effective ACL verification takes priority and never falls back to any older receipt if full history/new evidence is invalid',()=>{
  const f=stagedAclFollowOnReceiptFixture(),oldRaw=Buffer.from(JSON.stringify(f.original)),nextRaw=Buffer.from(JSON.stringify(f.chain)),
    oldFile=`${p.operation}/attendance-staged-tool-repair.json`,nextFile=`${p.operation}/${acl.receiptName}`;
  const previous={previous:{original:{receipt:f.original,receiptSha256:follow.previousReceiptSha256},
    receipt:f.firstFollowOnReceipt,receiptSha256:sequence.previousReceiptSha256},receipt:f.previousReceipt,receiptSha256:acl.previousReceiptSha256};
  function fixture({badPrevious=false,badNew=false,changedPrevious=false,changedNew=false,changedArchive=false,changedOriginal=false,
    changedSource=false,changedInputs=false,changedDependency=false,brokenAncestry=false}={}){
    let previousReads=0,newReads=0,archiveReads=0,oldReads=0;const requests=[];
    const verify=functionVm('verifyAttendanceStagedToolRepairReceipt',{p,follow,sequence,acl,APP,ROOT:'/synthetic-tools',receiptFile:oldFile,
      followOnReceiptFile:`${p.operation}/${follow.receiptName}`,sequenceFollowOnReceiptFile:`${p.operation}/${sequence.receiptName}`,
      aclFollowOnReceiptFile:nextFile,schemaFollowOnReceiptFile:`${p.operation}/${schema.receiptName}`,
      guardFollowOnReceiptFile:`${p.operation}/${guard.receiptName}`,
      phaseFollowOnReceiptFile:`${p.operation}/${phaseFollowOn.receiptName}`,
      sha:digest,evidenceExists:file=>{if([`${p.operation}/${phaseFollowOn.receiptName}`,`${p.operation}/${guard.receiptName}`,`${p.operation}/${schema.receiptName}`].includes(file))return false;assert.equal(file,nextFile);return true;},
      ownedFile:(file,options)=>{assert.equal(options.privateMode,true);if(file===oldFile){oldReads++;return changedOriginal&&oldReads>1?Buffer.from('{}'):oldRaw;}
        assert.equal(file,nextFile);newReads++;return badNew||changedNew&&newReads>1?Buffer.from('{}'):nextRaw;},
      previousAclFollowOnReceipt:()=>{previousReads++;if(badPrevious||changedPrevious&&previousReads>1)throw Error('previous_receipt_changed');return previous;},
      assertAttendanceStagedRepairReceipt,assertAttendanceStagedAclFollowOnReceipt,
      git:(directory,args)=>{assert.equal(directory,APP);assert.deepEqual([...args],['merge-base','--is-ancestor',acl.previousToolRevision,f.chain.effectiveReceipt.toolRevision]);
        if(brokenAncestry)throw Error('ancestry_failed');return '';},
      archivedAclFollowOnFailure:()=>{archiveReads++;if(changedArchive&&archiveReads>1)throw Error('failure_archive_changed');return acl.archive;},
      verifySource:(target,root)=>{requests.push({target,root});return {changedToolFiles:changedSource?['src/app/page.tsx']:f.chain.effectiveReceipt.changedToolFiles,
        sourceInputsSha256:changedInputs?'c'.repeat(64):f.chain.effectiveReceipt.sourceInputsSha256};},
      observe:()=>({dependencySha256:changedDependency?'c'.repeat(64):f.chain.effectiveReceipt.dependencySha256}),
      previousSequenceFollowOnReceipt:()=>assert.fail('cannot fall back to the older sequence receipt'),
      originalFollowOnReceipt:()=>assert.fail('cannot fall back to the original receipt'),
    });return {requests,run:()=>verify({target:p.target,rootDir:'/synthetic-tools',phase:'migration'})};
  }
  const positive=fixture(),result=positive.run();assert.equal(result.receiptKind,'attendance-staged-tool-repair-acl-follow-on');
  assert.equal(result.toolRevision,f.chain.effectiveReceipt.toolRevision);assert.equal(result.receiptSha256,digest(nextRaw));
  assert.equal(result.originalReceiptSha256,follow.previousReceiptSha256);assert.equal(result.previousReceiptSha256,acl.previousReceiptSha256);
  assert.deepEqual(positive.requests,[{target:f.chain.effectiveReceipt.toolRevision,root:'/synthetic-tools'}]);
  for(const options of [{badPrevious:true},{badNew:true},{changedPrevious:true},{changedNew:true},{changedArchive:true},{changedOriginal:true},
    {changedSource:true},{changedInputs:true},{changedDependency:true},{brokenAncestry:true}])assert.throws(fixture(options).run);
});

test('real ACL CLI rejects non-Linux/non-root before any production path read or write', {skip:process.platform==='linux'&&process.getuid?.()===0},()=>{
  assert.throws(()=>prepareAttendanceStagedToolRepairAclFollowOn(revision,'approved-staged-attendance-tool-repair-acl-follow-on'),/attendance_staged_repair_invocation/);
  const actual=spawnSync(process.execPath,[entry,'prepare-acl-follow-on',revision,'approved-staged-attendance-tool-repair-acl-follow-on'],
    {encoding:'utf8',timeout:10000,windowsHide:true});
  assert.equal(actual.status,1);assert.equal(actual.stdout,'');assert.match(actual.stderr,/^attendance_staged_repair_invocation\r?\n$/);
});

// These VM ports exercise the fixed completed archive. Explicit incomplete
// copies below remain test-only and never authorize a real operation.
const syntheticSchema=structuredClone(schema);
const schemaPolicyNode=policySyntax.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='assertAttendanceStagedSchemaFollowOnReceipt');
assert.ok(schemaPolicyNode);
const schemaPolicyVm=config=>runInNewContext(`${schemaPolicyNode.getText(policySyntax).replace(/^export\s+/,'')}\nassertAttendanceStagedSchemaFollowOnReceipt`,
  {Object,Date,assert,ATTENDANCE_STAGED_REPAIR:p,ATTENDANCE_STAGED_FOLLOW_ON:follow,
    ATTENDANCE_STAGED_SEQUENCE_FOLLOW_ON:sequence,ATTENDANCE_STAGED_ACL_FOLLOW_ON:acl,ATTENDANCE_STAGED_SCHEMA_FOLLOW_ON:config,
    followOnKeys:['schemaVersion','kind','target','baseline','previousToolRevision','previousReceiptSha256','failedAttemptArchive','effectiveReceipt','preparedAt'],
    need:value=>{if(!value)throw Error('attendance_staged_repair_receipt_invalid');},hex:value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value),
    assertAttendanceStagedRepairReceipt,assertAttendanceStagedAclFollowOnReceipt},{timeout:1000});
const syntheticSchemaValidator=schemaPolicyVm(syntheticSchema);
const schemaPorts=f=>({originalReceipt:f.original,originalReceiptSha256:follow.previousReceiptSha256,
  firstFollowOnReceipt:f.firstFollowOnReceipt,firstFollowOnReceiptSha256:sequence.previousReceiptSha256,
  sequenceFollowOnReceipt:f.sequenceFollowOnReceipt,sequenceFollowOnReceiptSha256:acl.previousReceiptSha256,
  previousReceipt:f.previousReceipt,previousReceiptSha256:schema.previousReceiptSha256});
function syntheticSchemaFixture(){const f=stagedSchemaFollowOnReceiptFixture();f.chain.failedAttemptArchive=structuredClone(syntheticSchema.archive);return f;}
function schemaPrevious(f){return {previous:{previous:{original:{receipt:f.original,receiptSha256:follow.previousReceiptSha256},
  receipt:f.firstFollowOnReceipt,receiptSha256:sequence.previousReceiptSha256},receipt:f.sequenceFollowOnReceipt,receiptSha256:acl.previousReceiptSha256},
  receipt:f.previousReceipt,receiptSha256:schema.previousReceiptSha256};}

test('synthetic schema validator requires every immutable predecessor and rejects relabels, scope changes and incomplete archive pins',()=>{
  const f=syntheticSchemaFixture(),ports=schemaPorts(f),before=JSON.stringify(ports);
  assert.equal(syntheticSchemaValidator(f.chain,ports),f.chain);assert.equal(JSON.stringify(ports),before);
  for(const key of Object.keys(f.chain)){const altered={...f.chain};delete altered[key];assert.throws(()=>syntheticSchemaValidator(altered,ports),key);}
  for(const key of ['originalReceiptSha256','firstFollowOnReceiptSha256','sequenceFollowOnReceiptSha256','previousReceiptSha256'])
    assert.throws(()=>syntheticSchemaValidator(f.chain,{...ports,[key]:'0'.repeat(64)}),key);
  for(const key of ['originalReceipt','firstFollowOnReceipt','sequenceFollowOnReceipt','previousReceipt'])
    assert.throws(()=>syntheticSchemaValidator(f.chain,{...ports,[key]:{...ports[key],kind:'broken'}}),key);
  for(const change of [{skip:true},{kind:'attendance-staged-tool-repair-acl-follow-on'},{target:'d'.repeat(40)},
    {baseline:'d'.repeat(40)},{previousToolRevision:acl.previousToolRevision},{previousReceiptSha256:acl.previousReceiptSha256},
    {failedAttemptArchive:{...syntheticSchema.archive,directory:'/arbitrary'}},
    {failedAttemptArchive:{...syntheticSchema.archive,database:{...syntheticSchema.archive.database,oid:'37190'}}},
    {failedAttemptArchive:{...syntheticSchema.archive,files:{...syntheticSchema.archive.files,extra:'a'.repeat(64)}}}])
    assert.throws(()=>syntheticSchemaValidator({...f.chain,...change},ports));
  for(const change of [p.target,schema.previousToolRevision,acl.previousToolRevision,sequence.previousToolRevision,follow.previousToolRevision].map(toolRevision=>({toolRevision}))
    .concat([{sourceInputsSha256:'c'.repeat(64)},{dependencySha256:'c'.repeat(64)},{scopeSha256:'c'.repeat(64)},
      {builtOutputSha256:'c'.repeat(64)},{approvedNoRebuild:false},{preservedFiles:{...pins,'runtime.json':'0'.repeat(64)}},
      {changedToolFiles:['scripts/attendance-production-052-compatibility.mjs']},{preparedAt:'2026-10-10T08:00:00.000Z'},
      {preparedAt:'2026-10-10T13:00:00.000Z'}]))
    assert.throws(()=>syntheticSchemaValidator({...f.chain,effectiveReceipt:{...f.chain.effectiveReceipt,...change}},ports));
  const pending={...syntheticSchema,archive:{...syntheticSchema.archive,files:{...syntheticSchema.archive.files,'completed.json':'PENDING'}}};
  assert.throws(()=>schemaPolicyVm(pending)(f.chain,ports),/receipt_invalid/);
  assert.equal(assertAttendanceStagedSchemaFollowOnReceipt(f.chain,ports),f.chain);
});

test('synthetic historical ACL receipt preserves four raw identities, exact Git scope and application inputs without recursive effective verification',()=>{
  const rows=`100644 blob ${'a'.repeat(40)}\tsrc/app/page.tsx`;
  function fixture({wrongPin=false,wrongRevision=false,wrongScope=false,wrongInputs=false,wrongReceiptInput=false,
    changedRead=false,changedPrevious=false,brokenPrevious=false,brokenArchive=false,brokenAncestry=false}={}){
    const f=syntheticSchemaFixture(),requests=[];
    for(const r of [f.original,f.firstFollowOnReceipt.effectiveReceipt,f.sequenceFollowOnReceipt.effectiveReceipt,f.previousReceipt.effectiveReceipt])r.sourceInputsSha256=digest(rows);
    if(wrongReceiptInput)f.previousReceipt.effectiveReceipt.sourceInputsSha256='c'.repeat(64);
    f.previousReceipt.effectiveReceipt.changedToolFiles.sort();if(wrongRevision)f.previousReceipt.effectiveReceipt.toolRevision='d'.repeat(40);
    const prior=schemaPrevious(f).previous,raw=Buffer.from(JSON.stringify(f.previousReceipt));let reads=0,previousReads=0;
    const read=functionVm('previousSchemaFollowOnReceipt',{p,follow,sequence,acl,schema,allowed,APP,
      aclFollowOnReceiptFile:`${p.operation}/${acl.receiptName}`,
      previousAclFollowOnReceipt:()=>{previousReads++;if(brokenPrevious||changedPrevious&&previousReads>1)throw Error('previous_receipt_changed');return prior;},
      ownedFile:(file,options)=>{assert.equal(file,`${p.operation}/${acl.receiptName}`);assert.equal(options.privateMode,true);reads++;
        return changedRead&&reads>1?Buffer.from('{}'):raw;},
      sha:bytes=>Buffer.isBuffer(bytes)&&bytes.equals(raw)?wrongPin?'0'.repeat(64):schema.previousReceiptSha256:digest(bytes),
      assertAttendanceStagedAclFollowOnReceipt,
      git:(directory,args)=>{assert.equal(directory,APP);requests.push([...args]);if(args[0]==='merge-base'){
        assert.deepEqual([...args],['merge-base','--is-ancestor',acl.previousToolRevision,schema.previousToolRevision]);
        if(brokenAncestry)throw Error('ancestry_failed');return '';}
        assert.deepEqual([...args],['diff','--no-renames','--name-status',p.target,schema.previousToolRevision]);
        return wrongScope?'M\tsrc/app/page.tsx':f.previousReceipt.effectiveReceipt.changedToolFiles.map(name=>`M\t${name}`).join('\n');},
      runOnlineToolGit:(directory,args)=>{assert.equal(directory,APP);assert.equal(args[0],'ls-tree');requests.push([...args]);
        return Buffer.from((wrongInputs&&args.at(-1)===schema.previousToolRevision?rows.replace('a'.repeat(40),'b'.repeat(40)):rows)+'\0');},
      archivedAclFollowOnFailure:()=>{if(brokenArchive)throw Error('failure_archive_changed');return acl.archive;},
      verifyAttendanceStagedToolRepairReceipt:()=>assert.fail('predecessor validation must not recurse through the highest sidecar'),
    });return {requests,read};
  }
  const f=fixture(),result=f.read();assert.equal(result.receiptSha256,schema.previousReceiptSha256);
  assert.equal(result.receipt.effectiveReceipt.toolRevision,schema.previousToolRevision);
  assert.ok(f.requests.every(args=>['merge-base','diff','ls-tree'].includes(args[0])));
  for(const options of [{wrongPin:true},{wrongRevision:true},{wrongScope:true},{wrongInputs:true},{wrongReceiptInput:true},
    {changedRead:true},{changedPrevious:true},{brokenPrevious:true},{brokenArchive:true},{brokenAncestry:true}])assert.throws(fixture(options).read);
});

test('synthetic fifth-failure archive verifies seven private stable files while VM-only PENDING evidence is denied before path reads',()=>{
  function fixture({extra=false,missing=false,changedFile=false,mode=0o700,moved=false}={}){
    let lists=0;const bytes=new Map(Object.keys(syntheticSchema.archive.files).filter(name=>!missing||name!=='completed.json').map(name=>[name,Buffer.from(name)]));
    const read=functionVm('archivedSchemaFollowOnFailure',{schema:syntheticSchema,
      assertOnlineToolOwnedPath:file=>assert.equal(file,syntheticSchema.archive.directory),
      fs:{lstatSync:file=>{assert.equal(file,syntheticSchema.archive.directory);return {dev:1,ino:moved&&lists>1?2:1,uid:0,mode,mtimeMs:1,ctimeMs:1};},
        readdirSync:file=>{assert.equal(file,syntheticSchema.archive.directory);lists++;return [...bytes.keys(),...(extra?['unexpected.json']:[])];}},
      ownedFile:(file,options)=>{assert.ok(file.startsWith(syntheticSchema.archive.directory+'/'));assert.equal(options.privateMode,true);
        assert.equal(options.maxBytes,8*1024**2);return bytes.get(path.posix.basename(file));},
      sha:value=>changedFile?'0'.repeat(64):syntheticSchema.archive.files[value.toString('utf8')],
    });return read;
  }
  assert.deepEqual(fixture()(),syntheticSchema.archive);
  for(const options of [{extra:true},{missing:true},{changedFile:true},{mode:0o755},{moved:true}])assert.throws(fixture(options),/failure_archive_(?:invalid|changed)/);
  const pending={...syntheticSchema,archive:{...syntheticSchema.archive,files:{...syntheticSchema.archive.files,'completed.json':'PENDING'}}};
  const pendingRead=functionVm('archivedSchemaFollowOnFailure',{schema:pending,
    assertOnlineToolOwnedPath:()=>assert.fail('pending archive must not read any production path')});
  assert.throws(pendingRead,/failure_archive_pending/);
});

function schemaPreparationFixture({existingPath,changeCandidate=false,changePrevious=false,changeArchive=false,brokenAncestry=false,
  wrongReadback=false,brokenPrevious=false}={}){
  const f=syntheticSchemaFixture(),calls=[],written=new Map(),descriptors=new Map();
  const oldFiles=[`${p.operation}/attendance-staged-tool-repair.json`,`${p.operation}/${follow.receiptName}`,
    `${p.operation}/${sequence.receiptName}`,`${p.operation}/${acl.receiptName}`],
    oldBytes=[f.original,f.firstFollowOnReceipt,f.sequenceFollowOnReceipt,f.previousReceipt].map(r=>Buffer.from(JSON.stringify(r))),
    nextFile=`${p.operation}/${schema.receiptName}`;
  oldFiles.forEach((file,i)=>written.set(file,oldBytes[i]));const previous=schemaPrevious(f);
  const before={preservedFiles:{...pins},builtOutputSha256:p.builtOutputSha256,dependencySha256:f.original.dependencySha256};
  const info={toolRevision:revision,sourceInputsSha256:f.original.sourceInputsSha256,changedToolFiles:f.previousReceipt.effectiveReceipt.changedToolFiles};
  let locked=false,observations=0,previousReads=0,archives=0;
  const constants={...fs.constants,O_NOFOLLOW:fs.constants.O_NOFOLLOW||0x20000,O_DIRECTORY:fs.constants.O_DIRECTORY||0x10000};
  const io={constants,
    openSync(file,flags,mode){assert.ok(locked);const fd=descriptors.size+10;calls.push({kind:'open',file,flags,mode});
      if(file===nextFile){assert.equal(mode,0o600);assert.ok(flags&constants.O_EXCL);assert.ok(flags&constants.O_CREAT);assert.ok(flags&constants.O_NOFOLLOW);}
      else assert.equal(file,p.operation);descriptors.set(fd,file);return fd;},
    writeFileSync(fd,bytes){assert.equal(descriptors.get(fd),nextFile);written.set(nextFile,Buffer.from(bytes));calls.push({kind:'write',file:nextFile});},
    fsyncSync(fd){assert.ok(descriptors.has(fd));calls.push({kind:'fsync',file:descriptors.get(fd)});},
    closeSync(fd){assert.ok(descriptors.has(fd));descriptors.delete(fd);},
  };
  const prepare=functionVm('prepareAttendanceStagedToolRepairSchemaFollowOn',{p,follow,sequence,acl,schema:syntheticSchema,APP,ROOT:'/synthetic-bootstrap',
    maintenance:'/var/lib/faolla-maintenance/merchant-space',schemaFollowOnReceiptFile:nextFile,fs:io,sha:digest,process:{umask:()=>0o022},
    evidenceExists:file=>file===existingPath,
    git:(directory,args)=>{assert.equal(directory,APP);assert.deepEqual([...args],['merge-base','--is-ancestor',schema.previousToolRevision,revision]);
      calls.push({kind:'ancestry'});if(brokenAncestry)throw Error('ancestry_failed');return '';},
    verifySource:(target,directory,options)=>{assert.equal(target,revision);calls.push({kind:'source',directory,options});return info;},
    withOnlineToolPreparationLocks:(options,work)=>{assert.equal(options.deployLock,`${APP}.deploy.lock`);assert.equal(options.maintenance,'/var/lib/faolla-maintenance/merchant-space');
      calls.push({kind:'locks'});locked=true;try{return work();}finally{locked=false;}},
    previousSchemaFollowOnReceipt:()=>{assert.ok(locked);previousReads++;calls.push({kind:'previous'});
      if(brokenPrevious||changePrevious&&previousReads>1)throw Error('previous_receipt_changed');return previous;},
    archivedSchemaFollowOnFailure:()=>{assert.ok(locked);archives++;calls.push({kind:'archive'});
      if(changeArchive&&archives>1)throw Error('failure_archive_changed');return syntheticSchema.archive;},
    observe:()=>{assert.ok(locked);observations++;calls.push({kind:'observe'});return changeCandidate&&observations>1?{...before,dependencySha256:'c'.repeat(64)}:before;},
    assertAttendanceStagedSchemaFollowOnReceipt:syntheticSchemaValidator,
    assertOnlineToolNoPending:options=>{assert.ok(locked);assertAttendanceStagedRepairReceipt(options.fixedStagedRepairReceipt,{toolRevision:revision});calls.push({kind:'pending'});},
    createOnlineReleaseToolPlan:target=>({target}),executeOnlineReleaseToolPlan:plan=>{assert.ok(locked);assert.equal(plan.target,revision);
      calls.push({kind:'prepare-source-only'});return {directory:'/synthetic-tools',target:revision};},
    ownedFile:(file,options)=>{assert.equal(file,nextFile);assert.equal(options.privateMode,true);return wrongReadback?Buffer.from('{}'):written.get(nextFile);},
  });return {calls,written,descriptors,oldFiles,nextFile,oldBytes,run:confirm=>prepare(revision,confirm)};
}

test('synthetic schema preparation holds two locks, preserves all four old receipts/build facts and seals only one exclusive durable sidecar',()=>{
  const f=schemaPreparationFixture(),result=f.run('approved-staged-attendance-tool-repair-schema-follow-on');
  assert.equal(result.toolRevision,revision);assert.equal(result.originalReceiptSha256,follow.previousReceiptSha256);
  assert.equal(result.previousReceiptSha256,schema.previousReceiptSha256);
  assert.equal(result.applicationRebuilt,false);assert.equal(result.productionDatabaseChanged,false);assert.equal(result.trafficChanged,false);
  f.oldFiles.forEach((file,i)=>assert.ok(f.written.get(file).equals(f.oldBytes[i])));
  assert.equal(f.written.size,5);assert.equal(f.descriptors.size,0);assert.equal(result.receiptSha256,digest(f.written.get(f.nextFile)));
  assert.equal(f.calls.filter(c=>c.kind==='observe').length,2);assert.equal(f.calls.filter(c=>c.kind==='prepare-source-only').length,1);
  assert.deepEqual(f.calls.filter(c=>c.kind==='fsync').map(c=>c.file),[f.nextFile,p.operation]);
  assert.ok(f.calls.findLastIndex(c=>c.kind==='observe')<f.calls.findIndex(c=>c.kind==='write'));
  assert.ok(f.calls.findIndex(c=>c.kind==='source')<f.calls.findIndex(c=>c.kind==='prepare-source-only'));
});

test('synthetic schema preparation rejects live attempts, reused sidecars, changed facts and failed readback without clearing evidence',()=>{
  const approval=schemaPreparationFixture();assert.throws(()=>approval.run('approved-staged-attendance-tool-repair-acl-follow-on'),/approval_required/);
  assert.equal(approval.calls.length,0);
  const absentNames=['attendance-database-compatibility.json','attendance-compatibility-attempt.json','attendance-compatibility-metadata.sql',
    'attendance-compatibility-extension-metadata.json','attendance-compatibility-extension-supplement.sql','attendance-database-progress.json','attendance-database-ready.json'];
  for(const name of absentNames){const f=schemaPreparationFixture({existingPath:`${p.operation}/${name}`});
    assert.throws(()=>f.run('approved-staged-attendance-tool-repair-schema-follow-on'),/database_attempt_exists/);assert.equal(f.written.size,4);}
  for(const options of [{existingPath:`${p.operation}/${schema.receiptName}`},{changeCandidate:true},{changePrevious:true},
    {changeArchive:true},{brokenAncestry:true},{brokenPrevious:true}]){
    const f=schemaPreparationFixture(options);assert.throws(()=>f.run('approved-staged-attendance-tool-repair-schema-follow-on'),
      /schema_follow_on_receipt_exists|candidate_changed_during_preparation|previous_receipt_changed|failure_archive_changed|ancestry_failed/);
    assert.equal(f.written.size,4);f.oldFiles.forEach((file,i)=>assert.ok(f.written.get(file).equals(f.oldBytes[i])));assert.equal(f.descriptors.size,0);
  }
  const f=schemaPreparationFixture({wrongReadback:true});assert.throws(()=>f.run('approved-staged-attendance-tool-repair-schema-follow-on'),/receipt_write_changed/);
  assert.equal(f.written.size,5);f.oldFiles.forEach((file,i)=>assert.ok(f.written.get(file).equals(f.oldBytes[i])));
});

test('synthetic schema sidecar takes highest priority and a present broken chain cannot fall back to any of the four older receipts',()=>{
  const f=syntheticSchemaFixture(),oldRaw=Buffer.from(JSON.stringify(f.original)),nextRaw=Buffer.from(JSON.stringify(f.chain)),
    oldFile=`${p.operation}/attendance-staged-tool-repair.json`,nextFile=`${p.operation}/${schema.receiptName}`,previous=schemaPrevious(f);
  function fixture({badPrevious=false,badNew=false,changedPrevious=false,changedNew=false,changedArchive=false,changedOriginal=false,
    changedSource=false,changedInputs=false,changedDependency=false,brokenAncestry=false}={}){
    let previousReads=0,newReads=0,archiveReads=0,oldReads=0;const requests=[];
    const verify=functionVm('verifyAttendanceStagedToolRepairReceipt',{p,follow,sequence,acl,schema:syntheticSchema,APP,ROOT:'/synthetic-tools',receiptFile:oldFile,
      followOnReceiptFile:`${p.operation}/${follow.receiptName}`,sequenceFollowOnReceiptFile:`${p.operation}/${sequence.receiptName}`,
      aclFollowOnReceiptFile:`${p.operation}/${acl.receiptName}`,schemaFollowOnReceiptFile:nextFile,
      guardFollowOnReceiptFile:`${p.operation}/${guard.receiptName}`,
      phaseFollowOnReceiptFile:`${p.operation}/${phaseFollowOn.receiptName}`,
      sha:digest,evidenceExists:file=>{if([`${p.operation}/${phaseFollowOn.receiptName}`,`${p.operation}/${guard.receiptName}`].includes(file))return false;assert.equal(file,nextFile);return true;},
      ownedFile:(file,options)=>{assert.equal(options.privateMode,true);if(file===oldFile){oldReads++;return changedOriginal&&oldReads>1?Buffer.from('{}'):oldRaw;}
        assert.equal(file,nextFile);newReads++;return badNew||changedNew&&newReads>1?Buffer.from('{}'):nextRaw;},
      previousSchemaFollowOnReceipt:()=>{previousReads++;if(badPrevious||changedPrevious&&previousReads>1)throw Error('previous_receipt_changed');return previous;},
      assertAttendanceStagedRepairReceipt,assertAttendanceStagedSchemaFollowOnReceipt:syntheticSchemaValidator,
      git:(directory,args)=>{assert.equal(directory,APP);assert.deepEqual([...args],['merge-base','--is-ancestor',schema.previousToolRevision,f.chain.effectiveReceipt.toolRevision]);
        if(brokenAncestry)throw Error('ancestry_failed');return '';},
      archivedSchemaFollowOnFailure:()=>{archiveReads++;if(changedArchive&&archiveReads>1)throw Error('failure_archive_changed');return syntheticSchema.archive;},
      verifySource:(target,root)=>{requests.push({target,root});return {changedToolFiles:changedSource?['src/app/page.tsx']:f.chain.effectiveReceipt.changedToolFiles,
        sourceInputsSha256:changedInputs?'c'.repeat(64):f.chain.effectiveReceipt.sourceInputsSha256};},
      observe:()=>({dependencySha256:changedDependency?'c'.repeat(64):f.chain.effectiveReceipt.dependencySha256}),
      previousAclFollowOnReceipt:()=>assert.fail('cannot fall back to ACL predecessor'),
      previousSequenceFollowOnReceipt:()=>assert.fail('cannot fall back to sequence predecessor'),
      originalFollowOnReceipt:()=>assert.fail('cannot fall back to first predecessor'),
    });return {requests,run:()=>verify({target:p.target,rootDir:'/synthetic-tools',phase:'migration'})};
  }
  const positive=fixture(),result=positive.run();assert.equal(result.receiptKind,'attendance-staged-tool-repair-schema-follow-on');
  assert.equal(result.toolRevision,f.chain.effectiveReceipt.toolRevision);assert.equal(result.receiptSha256,digest(nextRaw));
  assert.equal(result.originalReceiptSha256,follow.previousReceiptSha256);assert.equal(result.previousReceiptSha256,schema.previousReceiptSha256);
  assert.deepEqual(positive.requests,[{target:f.chain.effectiveReceipt.toolRevision,root:'/synthetic-tools'}]);
  for(const options of [{badPrevious:true},{badNew:true},{changedPrevious:true},{changedNew:true},{changedArchive:true},{changedOriginal:true},
    {changedSource:true},{changedInputs:true},{changedDependency:true},{brokenAncestry:true}])assert.throws(fixture(options).run);
});

test('real schema CLI rejects non-Linux/non-root before any production path read or write', {skip:process.platform==='linux'&&process.getuid?.()===0},()=>{
  assert.throws(()=>prepareAttendanceStagedToolRepairSchemaFollowOn(revision,'approved-staged-attendance-tool-repair-schema-follow-on'),/attendance_staged_repair_invocation/);
  const actual=spawnSync(process.execPath,[entry,'prepare-schema-follow-on',revision,'approved-staged-attendance-tool-repair-schema-follow-on'],
    {encoding:'utf8',timeout:10000,windowsHide:true});
  assert.equal(actual.status,1);assert.equal(actual.stdout,'');assert.match(actual.stderr,/^attendance_staged_repair_invocation\r?\n$/);
});

// These VM ports use the fixed completed archive; incomplete copies stay VM-only.
const syntheticGuard=structuredClone(guard);
const guardPolicyNode=policySyntax.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='assertAttendanceStagedGuardFollowOnReceipt');
assert.ok(guardPolicyNode);
const guardPolicyVm=config=>runInNewContext(`${guardPolicyNode.getText(policySyntax).replace(/^export\s+/,'')}\nassertAttendanceStagedGuardFollowOnReceipt`,
  {Object,Date,assert,ATTENDANCE_STAGED_REPAIR:p,ATTENDANCE_STAGED_FOLLOW_ON:follow,
    ATTENDANCE_STAGED_SEQUENCE_FOLLOW_ON:sequence,ATTENDANCE_STAGED_ACL_FOLLOW_ON:acl,
    ATTENDANCE_STAGED_SCHEMA_FOLLOW_ON:schema,ATTENDANCE_STAGED_GUARD_FOLLOW_ON:config,
    followOnKeys:['schemaVersion','kind','target','baseline','previousToolRevision','previousReceiptSha256','failedAttemptArchive','effectiveReceipt','preparedAt'],
    need:value=>{if(!value)throw Error('attendance_staged_repair_receipt_invalid');},hex:value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value),
    assertAttendanceStagedRepairReceipt,assertAttendanceStagedSchemaFollowOnReceipt},{timeout:1000});
const syntheticGuardValidator=guardPolicyVm(syntheticGuard);
const guardPorts=f=>({originalReceipt:f.original,originalReceiptSha256:follow.previousReceiptSha256,
  firstFollowOnReceipt:f.firstFollowOnReceipt,firstFollowOnReceiptSha256:sequence.previousReceiptSha256,
  sequenceFollowOnReceipt:f.sequenceFollowOnReceipt,sequenceFollowOnReceiptSha256:acl.previousReceiptSha256,
  aclFollowOnReceipt:f.aclFollowOnReceipt,aclFollowOnReceiptSha256:schema.previousReceiptSha256,
  previousReceipt:f.previousReceipt,previousReceiptSha256:guard.previousReceiptSha256});
function syntheticGuardFixture(){const f=stagedGuardFollowOnReceiptFixture();f.chain.failedAttemptArchive=structuredClone(syntheticGuard.archive);return f;}
function guardPrevious(f){return {previous:{previous:{previous:{original:{receipt:f.original,receiptSha256:follow.previousReceiptSha256},
  receipt:f.firstFollowOnReceipt,receiptSha256:sequence.previousReceiptSha256},receipt:f.sequenceFollowOnReceipt,receiptSha256:acl.previousReceiptSha256},
  receipt:f.aclFollowOnReceipt,receiptSha256:schema.previousReceiptSha256},receipt:f.previousReceipt,receiptSha256:guard.previousReceiptSha256};}

test('synthetic guard validator validates all five immutable predecessors and denies older revisions, changed authority and pending pins',()=>{
  const f=syntheticGuardFixture(),ports=guardPorts(f),before=JSON.stringify(ports);
  assert.equal(syntheticGuardValidator(f.chain,ports),f.chain);assert.equal(JSON.stringify(ports),before);
  for(const key of Object.keys(f.chain)){const altered={...f.chain};delete altered[key];assert.throws(()=>syntheticGuardValidator(altered,ports),key);}
  for(const key of ['originalReceiptSha256','firstFollowOnReceiptSha256','sequenceFollowOnReceiptSha256','aclFollowOnReceiptSha256','previousReceiptSha256'])
    assert.throws(()=>syntheticGuardValidator(f.chain,{...ports,[key]:'0'.repeat(64)}),key);
  for(const key of ['originalReceipt','firstFollowOnReceipt','sequenceFollowOnReceipt','aclFollowOnReceipt','previousReceipt'])
    assert.throws(()=>syntheticGuardValidator(f.chain,{...ports,[key]:{...ports[key],kind:'broken'}}),key);
  for(const change of [{skip:true},{kind:'attendance-staged-tool-repair-schema-follow-on'},{target:'d'.repeat(40)},
    {baseline:'d'.repeat(40)},{previousToolRevision:schema.previousToolRevision},{previousReceiptSha256:schema.previousReceiptSha256},
    {failedAttemptArchive:{...syntheticGuard.archive,directory:'/arbitrary'}},
    {failedAttemptArchive:{...syntheticGuard.archive,database:{...syntheticGuard.archive.database,oid:'55550'}}},
    {failedAttemptArchive:{...syntheticGuard.archive,files:{...syntheticGuard.archive.files,extra:'a'.repeat(64)}}}])
    assert.throws(()=>syntheticGuardValidator({...f.chain,...change},ports));
  for(const change of [p.target,guard.previousToolRevision,schema.previousToolRevision,acl.previousToolRevision,sequence.previousToolRevision,follow.previousToolRevision].map(toolRevision=>({toolRevision}))
    .concat([{sourceInputsSha256:'c'.repeat(64)},{dependencySha256:'c'.repeat(64)},{scopeSha256:'c'.repeat(64)},
      {builtOutputSha256:'c'.repeat(64)},{approvedNoRebuild:false},{preservedFiles:{...pins,'runtime.json':'0'.repeat(64)}},
      {changedToolFiles:['scripts/attendance-production-052-compatibility.mjs']},{preparedAt:'2026-10-10T11:00:00.000Z'},
      {preparedAt:'2026-10-10T15:00:00.000Z'}]))
    assert.throws(()=>syntheticGuardValidator({...f.chain,effectiveReceipt:{...f.chain.effectiveReceipt,...change}},ports));
  const pending={...syntheticGuard,archive:{...syntheticGuard.archive,files:{...syntheticGuard.archive.files,'completed.json':'PENDING'}}};
  assert.throws(()=>guardPolicyVm(pending)(f.chain,ports),/receipt_invalid/);
  assert.equal(assertAttendanceStagedGuardFollowOnReceipt(f.chain,ports),f.chain);
});

test('synthetic historical schema receipt binds all five raw identities, exact historical scope and unchanged application inputs without recursive verification',()=>{
  const rows=`100644 blob ${'a'.repeat(40)}\tsrc/app/page.tsx`;
  function fixture({wrongPin=false,wrongRevision=false,wrongScope=false,wrongInputs=false,wrongReceiptInput=false,
    changedRead=false,changedPrevious=false,brokenPrevious=false,brokenArchive=false,brokenAncestry=false}={}){
    const f=syntheticGuardFixture(),requests=[];
    for(const r of [f.original,f.firstFollowOnReceipt.effectiveReceipt,f.sequenceFollowOnReceipt.effectiveReceipt,
      f.aclFollowOnReceipt.effectiveReceipt,f.previousReceipt.effectiveReceipt])r.sourceInputsSha256=digest(rows);
    if(wrongReceiptInput)f.previousReceipt.effectiveReceipt.sourceInputsSha256='c'.repeat(64);
    f.previousReceipt.effectiveReceipt.changedToolFiles.sort();if(wrongRevision)f.previousReceipt.effectiveReceipt.toolRevision='d'.repeat(40);
    const prior=guardPrevious(f).previous,raw=Buffer.from(JSON.stringify(f.previousReceipt));let reads=0,previousReads=0;
    const read=functionVm('previousGuardFollowOnReceipt',{p,follow,sequence,acl,schema,guard,allowed,APP,
      schemaFollowOnReceiptFile:`${p.operation}/${schema.receiptName}`,
      previousSchemaFollowOnReceipt:()=>{previousReads++;if(brokenPrevious||changedPrevious&&previousReads>1)throw Error('previous_receipt_changed');return prior;},
      ownedFile:(file,options)=>{assert.equal(file,`${p.operation}/${schema.receiptName}`);assert.equal(options.privateMode,true);reads++;
        return changedRead&&reads>1?Buffer.from('{}'):raw;},
      sha:bytes=>Buffer.isBuffer(bytes)&&bytes.equals(raw)?wrongPin?'0'.repeat(64):guard.previousReceiptSha256:digest(bytes),
      assertAttendanceStagedSchemaFollowOnReceipt,
      git:(directory,args)=>{assert.equal(directory,APP);requests.push([...args]);if(args[0]==='merge-base'){
        assert.deepEqual([...args],['merge-base','--is-ancestor',schema.previousToolRevision,guard.previousToolRevision]);
        if(brokenAncestry)throw Error('ancestry_failed');return '';}
        assert.deepEqual([...args],['diff','--no-renames','--name-status',p.target,guard.previousToolRevision]);
        return wrongScope?'M\tsrc/app/page.tsx':f.previousReceipt.effectiveReceipt.changedToolFiles.map(name=>`M\t${name}`).join('\n');},
      runOnlineToolGit:(directory,args)=>{assert.equal(directory,APP);assert.equal(args[0],'ls-tree');requests.push([...args]);
        return Buffer.from((wrongInputs&&args.at(-1)===guard.previousToolRevision?rows.replace('a'.repeat(40),'b'.repeat(40)):rows)+'\0');},
      archivedSchemaFollowOnFailure:()=>{if(brokenArchive)throw Error('failure_archive_changed');return schema.archive;},
      verifyAttendanceStagedToolRepairReceipt:()=>assert.fail('predecessor validation must not recurse through the highest sidecar'),
    });return {requests,read};
  }
  const f=fixture(),result=f.read();assert.equal(result.receiptSha256,guard.previousReceiptSha256);
  assert.equal(result.receipt.effectiveReceipt.toolRevision,guard.previousToolRevision);
  assert.ok(f.requests.every(args=>['merge-base','diff','ls-tree'].includes(args[0])));
  for(const options of [{wrongPin:true},{wrongRevision:true},{wrongScope:true},{wrongInputs:true},{wrongReceiptInput:true},
    {changedRead:true},{changedPrevious:true},{brokenPrevious:true},{brokenArchive:true},{brokenAncestry:true}])assert.throws(fixture(options).read);
});

test('synthetic sixth-failure archive checks every private stable file and PENDING pins stop before path access',()=>{
  function fixture({extra=false,missing=false,changedFile=false,mode=0o700,moved=false}={}){
    let lists=0;const bytes=new Map(Object.keys(syntheticGuard.archive.files).filter(name=>!missing||name!=='completed.json').map(name=>[name,Buffer.from(name)]));
    const read=functionVm('archivedGuardFollowOnFailure',{guard:syntheticGuard,
      assertOnlineToolOwnedPath:file=>assert.equal(file,syntheticGuard.archive.directory),
      fs:{lstatSync:file=>{assert.equal(file,syntheticGuard.archive.directory);return {dev:1,ino:moved&&lists>1?2:1,uid:0,mode,mtimeMs:1,ctimeMs:1};},
        readdirSync:file=>{assert.equal(file,syntheticGuard.archive.directory);lists++;return [...bytes.keys(),...(extra?['unexpected.json']:[])];}},
      ownedFile:(file,options)=>{assert.ok(file.startsWith(syntheticGuard.archive.directory+'/'));assert.equal(options.privateMode,true);
        assert.equal(options.maxBytes,8*1024**2);return bytes.get(path.posix.basename(file));},
      sha:value=>changedFile?'0'.repeat(64):syntheticGuard.archive.files[value.toString('utf8')],
    });return read;
  }
  assert.deepEqual(fixture()(),syntheticGuard.archive);
  for(const options of [{extra:true},{missing:true},{changedFile:true},{mode:0o755},{moved:true}])assert.throws(fixture(options),/failure_archive_(?:invalid|changed)/);
  const pending={...syntheticGuard,archive:{...syntheticGuard.archive,files:{...syntheticGuard.archive.files,'completed.json':'PENDING'}}};
  const pendingRead=functionVm('archivedGuardFollowOnFailure',{guard:pending,
    assertOnlineToolOwnedPath:()=>assert.fail('pending archive must not read any production path')});
  assert.throws(pendingRead,/failure_archive_pending/);
});

function guardPreparationFixture({existingPath,changeCandidate=false,changePrevious=false,changeArchive=false,brokenAncestry=false,
  wrongReadback=false,brokenPrevious=false}={}){
  const f=syntheticGuardFixture(),calls=[],written=new Map(),descriptors=new Map();
  const oldFiles=[`${p.operation}/attendance-staged-tool-repair.json`,`${p.operation}/${follow.receiptName}`,
    `${p.operation}/${sequence.receiptName}`,`${p.operation}/${acl.receiptName}`,`${p.operation}/${schema.receiptName}`],
    oldBytes=[f.original,f.firstFollowOnReceipt,f.sequenceFollowOnReceipt,f.aclFollowOnReceipt,f.previousReceipt].map(r=>Buffer.from(JSON.stringify(r))),
    nextFile=`${p.operation}/${guard.receiptName}`;
  oldFiles.forEach((file,i)=>written.set(file,oldBytes[i]));const previous=guardPrevious(f);
  const before={preservedFiles:{...pins},builtOutputSha256:p.builtOutputSha256,dependencySha256:f.original.dependencySha256};
  const info={toolRevision:revision,sourceInputsSha256:f.original.sourceInputsSha256,changedToolFiles:f.previousReceipt.effectiveReceipt.changedToolFiles};
  let locked=false,observations=0,previousReads=0,archives=0;
  const constants={...fs.constants,O_NOFOLLOW:fs.constants.O_NOFOLLOW||0x20000,O_DIRECTORY:fs.constants.O_DIRECTORY||0x10000};
  const io={constants,
    openSync(file,flags,mode){assert.ok(locked);const fd=descriptors.size+10;calls.push({kind:'open',file,flags,mode});
      if(file===nextFile){assert.equal(mode,0o600);assert.ok(flags&constants.O_EXCL);assert.ok(flags&constants.O_CREAT);assert.ok(flags&constants.O_NOFOLLOW);}
      else assert.equal(file,p.operation);descriptors.set(fd,file);return fd;},
    writeFileSync(fd,bytes){assert.equal(descriptors.get(fd),nextFile);written.set(nextFile,Buffer.from(bytes));calls.push({kind:'write',file:nextFile});},
    fsyncSync(fd){assert.ok(descriptors.has(fd));calls.push({kind:'fsync',file:descriptors.get(fd)});},
    closeSync(fd){assert.ok(descriptors.has(fd));descriptors.delete(fd);},
  };
  const prepare=functionVm('prepareAttendanceStagedToolRepairGuardFollowOn',{p,follow,sequence,acl,schema,guard:syntheticGuard,APP,ROOT:'/synthetic-bootstrap',
    maintenance:'/var/lib/faolla-maintenance/merchant-space',guardFollowOnReceiptFile:nextFile,fs:io,sha:digest,process:{umask:()=>0o022},
    evidenceExists:file=>file===existingPath,
    git:(directory,args)=>{assert.equal(directory,APP);assert.deepEqual([...args],['merge-base','--is-ancestor',guard.previousToolRevision,revision]);
      calls.push({kind:'ancestry'});if(brokenAncestry)throw Error('ancestry_failed');return '';},
    verifySource:(target,directory,options)=>{assert.equal(target,revision);calls.push({kind:'source',directory,options});return info;},
    withOnlineToolPreparationLocks:(options,work)=>{assert.equal(options.deployLock,`${APP}.deploy.lock`);assert.equal(options.maintenance,'/var/lib/faolla-maintenance/merchant-space');
      calls.push({kind:'locks'});locked=true;try{return work();}finally{locked=false;}},
    previousGuardFollowOnReceipt:()=>{assert.ok(locked);previousReads++;calls.push({kind:'previous'});
      if(brokenPrevious||changePrevious&&previousReads>1)throw Error('previous_receipt_changed');return previous;},
    archivedGuardFollowOnFailure:()=>{assert.ok(locked);archives++;calls.push({kind:'archive'});
      if(changeArchive&&archives>1)throw Error('failure_archive_changed');return syntheticGuard.archive;},
    observe:()=>{assert.ok(locked);observations++;calls.push({kind:'observe'});return changeCandidate&&observations>1?{...before,dependencySha256:'c'.repeat(64)}:before;},
    assertAttendanceStagedGuardFollowOnReceipt:syntheticGuardValidator,
    assertOnlineToolNoPending:options=>{assert.ok(locked);assertAttendanceStagedRepairReceipt(options.fixedStagedRepairReceipt,{toolRevision:revision});calls.push({kind:'pending'});},
    createOnlineReleaseToolPlan:target=>({target}),executeOnlineReleaseToolPlan:plan=>{assert.ok(locked);assert.equal(plan.target,revision);
      calls.push({kind:'prepare-source-only'});return {directory:'/synthetic-tools',target:revision};},
    ownedFile:(file,options)=>{assert.equal(file,nextFile);assert.equal(options.privateMode,true);return wrongReadback?Buffer.from('{}'):written.get(nextFile);},
  });return {calls,written,descriptors,oldFiles,nextFile,oldBytes,run:confirm=>prepare(revision,confirm)};
}

test('synthetic guard preparation holds both normal locks, preserves all five old receipts/build facts and seals one exclusive durable sidecar',()=>{
  const f=guardPreparationFixture(),result=f.run('approved-staged-attendance-tool-repair-guard-follow-on');
  assert.equal(result.toolRevision,revision);assert.equal(result.originalReceiptSha256,follow.previousReceiptSha256);
  assert.equal(result.previousReceiptSha256,guard.previousReceiptSha256);
  assert.equal(result.applicationRebuilt,false);assert.equal(result.productionDatabaseChanged,false);assert.equal(result.trafficChanged,false);
  f.oldFiles.forEach((file,i)=>assert.ok(f.written.get(file).equals(f.oldBytes[i])));
  assert.equal(f.written.size,6);assert.equal(f.descriptors.size,0);assert.equal(result.receiptSha256,digest(f.written.get(f.nextFile)));
  assert.equal(f.calls.filter(c=>c.kind==='observe').length,2);assert.equal(f.calls.filter(c=>c.kind==='prepare-source-only').length,1);
  assert.deepEqual(f.calls.filter(c=>c.kind==='fsync').map(c=>c.file),[f.nextFile,p.operation]);
  assert.ok(f.calls.findLastIndex(c=>c.kind==='observe')<f.calls.findIndex(c=>c.kind==='write'));
  assert.ok(f.calls.findIndex(c=>c.kind==='source')<f.calls.findIndex(c=>c.kind==='prepare-source-only'));
});

test('synthetic guard preparation blocks every canonical attempt, reused sidecar, changed facts and failed readback without clearing old evidence',()=>{
  const approval=guardPreparationFixture();assert.throws(()=>approval.run('approved-staged-attendance-tool-repair-schema-follow-on'),/approval_required/);
  assert.equal(approval.calls.length,0);
  const absentNames=['attendance-database-compatibility.json','attendance-compatibility-attempt.json','attendance-compatibility-metadata.sql',
    'attendance-compatibility-extension-metadata.json','attendance-compatibility-extension-supplement.sql','attendance-database-progress.json','attendance-database-ready.json'];
  for(const name of absentNames){const f=guardPreparationFixture({existingPath:`${p.operation}/${name}`});
    assert.throws(()=>f.run('approved-staged-attendance-tool-repair-guard-follow-on'),/database_attempt_exists/);assert.equal(f.written.size,5);}
  for(const options of [{existingPath:`${p.operation}/${guard.receiptName}`},{changeCandidate:true},{changePrevious:true},
    {changeArchive:true},{brokenAncestry:true},{brokenPrevious:true}]){
    const f=guardPreparationFixture(options);assert.throws(()=>f.run('approved-staged-attendance-tool-repair-guard-follow-on'),
      /guard_follow_on_receipt_exists|candidate_changed_during_preparation|previous_receipt_changed|failure_archive_changed|ancestry_failed/);
    assert.equal(f.written.size,5);f.oldFiles.forEach((file,i)=>assert.ok(f.written.get(file).equals(f.oldBytes[i])));assert.equal(f.descriptors.size,0);
  }
  const f=guardPreparationFixture({wrongReadback:true});assert.throws(()=>f.run('approved-staged-attendance-tool-repair-guard-follow-on'),/receipt_write_changed/);
  assert.equal(f.written.size,6);f.oldFiles.forEach((file,i)=>assert.ok(f.written.get(file).equals(f.oldBytes[i])));
});

test('synthetic guard sidecar takes highest priority and any present broken chain cannot fall back to any of its five predecessors',()=>{
  const f=syntheticGuardFixture(),oldRaw=Buffer.from(JSON.stringify(f.original)),nextRaw=Buffer.from(JSON.stringify(f.chain)),
    oldFile=`${p.operation}/attendance-staged-tool-repair.json`,nextFile=`${p.operation}/${guard.receiptName}`,previous=guardPrevious(f);
  function fixture({badPrevious=false,badNew=false,changedPrevious=false,changedNew=false,changedArchive=false,changedOriginal=false,
    changedSource=false,changedInputs=false,changedDependency=false,brokenAncestry=false}={}){
    let previousReads=0,newReads=0,archiveReads=0,oldReads=0;const requests=[];
    const verify=functionVm('verifyAttendanceStagedToolRepairReceipt',{p,follow,sequence,acl,schema,guard:syntheticGuard,APP,ROOT:'/synthetic-tools',receiptFile:oldFile,
      followOnReceiptFile:`${p.operation}/${follow.receiptName}`,sequenceFollowOnReceiptFile:`${p.operation}/${sequence.receiptName}`,
      aclFollowOnReceiptFile:`${p.operation}/${acl.receiptName}`,schemaFollowOnReceiptFile:`${p.operation}/${schema.receiptName}`,guardFollowOnReceiptFile:nextFile,
      phaseFollowOnReceiptFile:`${p.operation}/${phaseFollowOn.receiptName}`,
      sha:digest,evidenceExists:file=>{if(file===`${p.operation}/${phaseFollowOn.receiptName}`)return false;assert.equal(file,nextFile);return true;},
      ownedFile:(file,options)=>{assert.equal(options.privateMode,true);if(file===oldFile){oldReads++;return changedOriginal&&oldReads>1?Buffer.from('{}'):oldRaw;}
        assert.equal(file,nextFile);newReads++;return badNew||changedNew&&newReads>1?Buffer.from('{}'):nextRaw;},
      previousGuardFollowOnReceipt:()=>{previousReads++;if(badPrevious||changedPrevious&&previousReads>1)throw Error('previous_receipt_changed');return previous;},
      assertAttendanceStagedRepairReceipt,assertAttendanceStagedGuardFollowOnReceipt:syntheticGuardValidator,
      git:(directory,args)=>{assert.equal(directory,APP);assert.deepEqual([...args],['merge-base','--is-ancestor',guard.previousToolRevision,f.chain.effectiveReceipt.toolRevision]);
        if(brokenAncestry)throw Error('ancestry_failed');return '';},
      archivedGuardFollowOnFailure:()=>{archiveReads++;if(changedArchive&&archiveReads>1)throw Error('failure_archive_changed');return syntheticGuard.archive;},
      verifySource:(target,root)=>{requests.push({target,root});return {changedToolFiles:changedSource?['src/app/page.tsx']:f.chain.effectiveReceipt.changedToolFiles,
        sourceInputsSha256:changedInputs?'c'.repeat(64):f.chain.effectiveReceipt.sourceInputsSha256};},
      observe:()=>({dependencySha256:changedDependency?'c'.repeat(64):f.chain.effectiveReceipt.dependencySha256}),
      previousSchemaFollowOnReceipt:()=>assert.fail('cannot fall back to schema predecessor'),
      previousAclFollowOnReceipt:()=>assert.fail('cannot fall back to ACL predecessor'),
      previousSequenceFollowOnReceipt:()=>assert.fail('cannot fall back to sequence predecessor'),
      originalFollowOnReceipt:()=>assert.fail('cannot fall back to first predecessor'),
    });return {requests,run:()=>verify({target:p.target,rootDir:'/synthetic-tools',phase:'migration'})};
  }
  const positive=fixture(),result=positive.run();assert.equal(result.receiptKind,'attendance-staged-tool-repair-guard-follow-on');
  assert.equal(result.toolRevision,f.chain.effectiveReceipt.toolRevision);assert.equal(result.receiptSha256,digest(nextRaw));
  assert.equal(result.originalReceiptSha256,follow.previousReceiptSha256);assert.equal(result.previousReceiptSha256,guard.previousReceiptSha256);
  assert.deepEqual(positive.requests,[{target:f.chain.effectiveReceipt.toolRevision,root:'/synthetic-tools'}]);
  for(const options of [{badPrevious:true},{badNew:true},{changedPrevious:true},{changedNew:true},{changedArchive:true},{changedOriginal:true},
    {changedSource:true},{changedInputs:true},{changedDependency:true},{brokenAncestry:true}])assert.throws(fixture(options).run);
});

test('real guard CLI rejects non-Linux/non-root before any production path read or write', {skip:process.platform==='linux'&&process.getuid?.()===0},()=>{
  assert.throws(()=>prepareAttendanceStagedToolRepairGuardFollowOn(revision,'approved-staged-attendance-tool-repair-guard-follow-on'),/attendance_staged_repair_invocation/);
  const actual=spawnSync(process.execPath,[entry,'prepare-guard-follow-on',revision,'approved-staged-attendance-tool-repair-guard-follow-on'],
    {encoding:'utf8',timeout:10000,windowsHide:true});
  assert.equal(actual.status,1);assert.equal(actual.stdout,'');assert.match(actual.stderr,/^attendance_staged_repair_invocation\r?\n$/);
});

// VM-only paths isolate the actual sealed pins from synthetic filesystem I/O.
const syntheticPhase=structuredClone(phaseFollowOn);
syntheticPhase.archive.directory=`${p.operation}/synthetic-phase-failure`;
syntheticPhase.archive.database.retainedName='faolla_attendance_failed_a535a308e21f_synthetic';
const phaseRequiredFiles=[
  'scripts/attendance-production-052-compatibility.mjs','scripts/attendance-production-052-compatibility.test.mjs',
  'scripts/attendance-production-database-migrations.mjs','scripts/attendance-production-database-migrations.test.mjs',
  'scripts/attendance-staged-tool-repair-policy.mjs','scripts/attendance-staged-tool-repair-policy.test.mjs',
  'scripts/attendance-staged-tool-repair.mjs','scripts/attendance-staged-tool-repair.test.mjs',
  'scripts/attendance-production-multiphase-guards-native.mjs','scripts/attendance-production-multiphase-guards-native.test.mjs',
];
const phaseRepairPolicyNode=policySyntax.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='assertAttendanceStagedPhaseRepairReceipt');
const phasePolicyNode=policySyntax.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='assertAttendanceStagedPhaseFollowOnReceipt');
assert.ok(phaseRepairPolicyNode);assert.ok(phasePolicyNode);
const phasePolicyVm=config=>runInNewContext(`${phaseRepairPolicyNode.getText(policySyntax)}\n${phasePolicyNode.getText(policySyntax).replace(/^export\s+/,'')}\nassertAttendanceStagedPhaseFollowOnReceipt`,
  {Object,Date,assert,ATTENDANCE_STAGED_REPAIR:p,ATTENDANCE_STAGED_REPAIR_FILES:allowed,
    ATTENDANCE_STAGED_FOLLOW_ON:follow,ATTENDANCE_STAGED_SEQUENCE_FOLLOW_ON:sequence,
    ATTENDANCE_STAGED_ACL_FOLLOW_ON:acl,ATTENDANCE_STAGED_SCHEMA_FOLLOW_ON:schema,
    ATTENDANCE_STAGED_GUARD_FOLLOW_ON:guard,ATTENDANCE_STAGED_PHASE_FOLLOW_ON:config,
    ATTENDANCE_STAGED_PHASE_FOLLOW_ON_FILES:phaseAllowed,phaseRequiredFiles,
    followOnKeys:['schemaVersion','kind','target','baseline','previousToolRevision','previousReceiptSha256','failedAttemptArchive','effectiveReceipt','preparedAt'],
    need:value=>{if(!value)throw Error('attendance_staged_repair_receipt_invalid');},hex:value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value),
    assertAttendanceStagedRepairReceipt,assertAttendanceStagedGuardFollowOnReceipt},{timeout:1000});
const syntheticPhaseValidator=phasePolicyVm(syntheticPhase);
function syntheticPhaseFixture(){const f=stagedPhaseFollowOnReceiptFixture();f.chain.failedAttemptArchive=structuredClone(syntheticPhase.archive);return f;}
const phasePorts=f=>({originalReceipt:f.original,originalReceiptSha256:follow.previousReceiptSha256,
  firstFollowOnReceipt:f.firstFollowOnReceipt,firstFollowOnReceiptSha256:sequence.previousReceiptSha256,
  sequenceFollowOnReceipt:f.sequenceFollowOnReceipt,sequenceFollowOnReceiptSha256:acl.previousReceiptSha256,
  aclFollowOnReceipt:f.aclFollowOnReceipt,aclFollowOnReceiptSha256:schema.previousReceiptSha256,
  schemaFollowOnReceipt:f.schemaFollowOnReceipt,schemaFollowOnReceiptSha256:guard.previousReceiptSha256,
  previousReceipt:f.previousReceipt,previousReceiptSha256:syntheticPhase.previousReceiptSha256});
function phasePrevious(f){return {previous:guardPrevious({...f,previousReceipt:f.schemaFollowOnReceipt}),
  receipt:f.previousReceipt,receiptSha256:syntheticPhase.previousReceiptSha256};}

test('synthetic phase validator binds all six predecessors, exact DB facts and a phase-only ten-file closure',()=>{
  const f=syntheticPhaseFixture(),ports=phasePorts(f),before=JSON.stringify(ports);
  assert.equal(syntheticPhaseValidator(f.chain,ports),f.chain);assert.equal(JSON.stringify(ports),before);
  assert.deepEqual(f.chain.effectiveReceipt.changedToolFiles.sort(),[...phaseRequiredFiles].sort());
  for(const key of Object.keys(f.chain)){const altered={...f.chain};delete altered[key];assert.throws(()=>syntheticPhaseValidator(altered,ports),key);}
  for(const key of ['originalReceiptSha256','firstFollowOnReceiptSha256','sequenceFollowOnReceiptSha256','aclFollowOnReceiptSha256',
    'schemaFollowOnReceiptSha256','previousReceiptSha256'])assert.throws(()=>syntheticPhaseValidator(f.chain,{...ports,[key]:'0'.repeat(64)}),key);
  for(const key of ['originalReceipt','firstFollowOnReceipt','sequenceFollowOnReceipt','aclFollowOnReceipt','schemaFollowOnReceipt','previousReceipt'])
    assert.throws(()=>syntheticPhaseValidator(f.chain,{...ports,[key]:{...ports[key],kind:'broken'}}),key);
  for(const change of [{kind:'attendance-staged-tool-repair-guard-follow-on'},{previousToolRevision:guard.previousToolRevision},
    {previousReceiptSha256:guard.previousReceiptSha256},{failedAttemptArchive:{...syntheticPhase.archive,directory:'/arbitrary'}},
    {failedAttemptArchive:{...syntheticPhase.archive,database:{...syntheticPhase.archive.database,oid:'58619'}}},
    {failedAttemptArchive:{...syntheticPhase.archive,files:{...syntheticPhase.archive.files,extra:'a'.repeat(64)}}}])
    assert.throws(()=>syntheticPhaseValidator({...f.chain,...change},ports));
  const oldRevisions=[p.target,syntheticPhase.previousToolRevision,guard.previousToolRevision,schema.previousToolRevision,
    acl.previousToolRevision,sequence.previousToolRevision,follow.previousToolRevision];
  for(const change of oldRevisions.map(toolRevision=>({toolRevision})).concat([
    {changedToolFiles:f.chain.effectiveReceipt.changedToolFiles.slice(1)},
    {changedToolFiles:[...f.chain.effectiveReceipt.changedToolFiles,'src/app/page.tsx']},
    {changedToolFiles:[...f.chain.effectiveReceipt.changedToolFiles,'scripts/supabase-migrations/202610040136_x.sql']},
    {sourceInputsSha256:'c'.repeat(64)},{dependencySha256:'c'.repeat(64)},{scopeSha256:'c'.repeat(64)},
    {builtOutputSha256:'c'.repeat(64)},{approvedNoRebuild:false},{preparedAt:'2026-10-10T13:00:00.000Z'}]))
    assert.throws(()=>syntheticPhaseValidator({...f.chain,effectiveReceipt:{...f.chain.effectiveReceipt,...change}},ports));
  const actual=stagedPhaseFollowOnReceiptFixture();
  assert.equal(assertAttendanceStagedPhaseFollowOnReceipt(actual.chain,phasePorts(actual)),actual.chain);
  const pending={...syntheticPhase,archive:{...syntheticPhase.archive,
    files:{...syntheticPhase.archive.files,'completed.json':'PENDING'}}};
  assert.throws(()=>phasePolicyVm(pending)(f.chain,ports),/receipt_invalid/);
});

test('synthetic historical guard receipt pins all six raw identities, old scope and application inputs without recursive verification',()=>{
  const rows=`100644 blob ${'a'.repeat(40)}\tsrc/app/page.tsx`;
  function fixture({wrongPin=false,wrongRevision=false,wrongScope=false,wrongInputs=false,wrongReceiptInput=false,
    changedRead=false,changedPrevious=false,brokenPrevious=false,brokenArchive=false,brokenAncestry=false}={}){
    const f=syntheticPhaseFixture(),requests=[];
    for(const r of [f.original,f.firstFollowOnReceipt.effectiveReceipt,f.sequenceFollowOnReceipt.effectiveReceipt,
      f.aclFollowOnReceipt.effectiveReceipt,f.schemaFollowOnReceipt.effectiveReceipt,f.previousReceipt.effectiveReceipt])
      r.sourceInputsSha256=digest(rows);
    if(wrongReceiptInput)f.previousReceipt.effectiveReceipt.sourceInputsSha256='c'.repeat(64);
    f.previousReceipt.effectiveReceipt.changedToolFiles.sort();if(wrongRevision)f.previousReceipt.effectiveReceipt.toolRevision='d'.repeat(40);
    const prior=phasePrevious(f).previous,raw=Buffer.from(JSON.stringify(f.previousReceipt));let reads=0,previousReads=0;
    const read=functionVm('previousPhaseFollowOnReceipt',{p,follow,sequence,acl,schema,guard,phaseFollowOn:syntheticPhase,allowed,APP,
      guardFollowOnReceiptFile:`${p.operation}/${guard.receiptName}`,
      previousGuardFollowOnReceipt:()=>{previousReads++;if(brokenPrevious||changedPrevious&&previousReads>1)throw Error('previous_receipt_changed');return prior;},
      ownedFile:(file,options)=>{assert.equal(file,`${p.operation}/${guard.receiptName}`);assert.equal(options.privateMode,true);reads++;
        return changedRead&&reads>1?Buffer.from('{}'):raw;},
      sha:bytes=>Buffer.isBuffer(bytes)&&bytes.equals(raw)?wrongPin?'0'.repeat(64):syntheticPhase.previousReceiptSha256:digest(bytes),
      assertAttendanceStagedGuardFollowOnReceipt,
      git:(directory,args)=>{assert.equal(directory,APP);requests.push([...args]);if(args[0]==='merge-base'){
        assert.deepEqual([...args],['merge-base','--is-ancestor',guard.previousToolRevision,syntheticPhase.previousToolRevision]);
        if(brokenAncestry)throw Error('ancestry_failed');return '';}
        assert.deepEqual([...args],['diff','--no-renames','--name-status',p.target,syntheticPhase.previousToolRevision]);
        return wrongScope?'M\tsrc/app/page.tsx':f.previousReceipt.effectiveReceipt.changedToolFiles.map(name=>`M\t${name}`).join('\n');},
      runOnlineToolGit:(directory,args)=>{assert.equal(directory,APP);assert.equal(args[0],'ls-tree');requests.push([...args]);
        return Buffer.from((wrongInputs&&args.at(-1)===syntheticPhase.previousToolRevision?rows.replace('a'.repeat(40),'b'.repeat(40)):rows)+'\0');},
      archivedGuardFollowOnFailure:()=>{if(brokenArchive)throw Error('failure_archive_changed');return guard.archive;},
      verifyAttendanceStagedToolRepairReceipt:()=>assert.fail('historical validation must not recurse through the highest receipt'),
    });return {requests,read};
  }
  const f=fixture(),result=f.read();assert.equal(result.receiptSha256,syntheticPhase.previousReceiptSha256);
  assert.equal(result.receipt.effectiveReceipt.toolRevision,syntheticPhase.previousToolRevision);
  assert.ok(f.requests.every(args=>['merge-base','diff','ls-tree'].includes(args[0])));
  for(const options of [{wrongPin:true},{wrongRevision:true},{wrongScope:true},{wrongInputs:true},{wrongReceiptInput:true},
    {changedRead:true},{changedPrevious:true},{brokenPrevious:true},{brokenArchive:true},{brokenAncestry:true}])assert.throws(fixture(options).read);
});

test('synthetic seventh-failure archive checks exactly seven stable private pins and real PENDING stops before path access',()=>{
  function fixture({extra=false,missing=false,changedFile=false,mode=0o700,moved=false}={}){
    let lists=0;const bytes=new Map(Object.keys(syntheticPhase.archive.files).filter(name=>!missing||name!=='completed.json').map(name=>[name,Buffer.from(name)]));
    return functionVm('archivedPhaseFollowOnFailure',{phaseFollowOn:syntheticPhase,
      assertOnlineToolOwnedPath:file=>assert.equal(file,syntheticPhase.archive.directory),
      fs:{lstatSync:file=>{assert.equal(file,syntheticPhase.archive.directory);return {dev:1,ino:moved&&lists>1?2:1,uid:0,mode,mtimeMs:1,ctimeMs:1};},
        readdirSync:file=>{assert.equal(file,syntheticPhase.archive.directory);lists++;return [...bytes.keys(),...(extra?['unexpected.json']:[])];}},
      ownedFile:(file,options)=>{assert.ok(file.startsWith(syntheticPhase.archive.directory+'/'));assert.equal(options.privateMode,true);
        assert.equal(options.maxBytes,8*1024**2);return bytes.get(path.posix.basename(file));},
      sha:value=>changedFile?'0'.repeat(64):syntheticPhase.archive.files[value.toString('utf8')],
    });
  }
  assert.deepEqual(fixture()(),syntheticPhase.archive);
  for(const options of [{extra:true},{missing:true},{changedFile:true},{mode:0o755},{moved:true}])assert.throws(fixture(options),/failure_archive_(?:invalid|changed)/);
  const pending={...phaseFollowOn,archive:{...phaseFollowOn.archive,
    files:{...phaseFollowOn.archive.files,'completed.json':'PENDING'}}};
  const pendingRead=functionVm('archivedPhaseFollowOnFailure',{phaseFollowOn:pending,
    assertOnlineToolOwnedPath:()=>assert.fail('pending archive must not read any production path')});
  assert.throws(pendingRead,/failure_archive_pending/);
});

function phasePreparationFixture({existingPath,changeCandidate=false,changePrevious=false,changeArchive=false,
  brokenAncestry=false,wrongReadback=false,brokenPrevious=false}={}){
  const f=syntheticPhaseFixture(),calls=[],written=new Map(),descriptors=new Map();
  const oldFiles=[`${p.operation}/attendance-staged-tool-repair.json`,`${p.operation}/${follow.receiptName}`,
    `${p.operation}/${sequence.receiptName}`,`${p.operation}/${acl.receiptName}`,`${p.operation}/${schema.receiptName}`,
    `${p.operation}/${guard.receiptName}`],
    oldBytes=[f.original,f.firstFollowOnReceipt,f.sequenceFollowOnReceipt,f.aclFollowOnReceipt,
      f.schemaFollowOnReceipt,f.previousReceipt].map(receipt=>Buffer.from(JSON.stringify(receipt))),
    nextFile=`${p.operation}/${syntheticPhase.receiptName}`;
  oldFiles.forEach((file,i)=>written.set(file,oldBytes[i]));const previous=phasePrevious(f);
  const before={preservedFiles:{...pins},builtOutputSha256:p.builtOutputSha256,dependencySha256:f.original.dependencySha256};
  const info={toolRevision:revision,sourceInputsSha256:f.original.sourceInputsSha256,
    changedToolFiles:[...f.chain.effectiveReceipt.changedToolFiles]};
  let locked=false,observations=0,previousReads=0,archives=0;
  const constants={...fs.constants,O_NOFOLLOW:fs.constants.O_NOFOLLOW||0x20000,O_DIRECTORY:fs.constants.O_DIRECTORY||0x10000};
  const io={constants,
    openSync(file,flags,mode){assert.ok(locked);const fd=descriptors.size+10;calls.push({kind:'open',file,flags,mode});
      if(file===nextFile){assert.equal(mode,0o600);assert.ok(flags&constants.O_EXCL);assert.ok(flags&constants.O_CREAT);assert.ok(flags&constants.O_NOFOLLOW);}
      else assert.equal(file,p.operation);descriptors.set(fd,file);return fd;},
    writeFileSync(fd,bytes){assert.equal(descriptors.get(fd),nextFile);written.set(nextFile,Buffer.from(bytes));calls.push({kind:'write',file:nextFile});},
    fsyncSync(fd){assert.ok(descriptors.has(fd));calls.push({kind:'fsync',file:descriptors.get(fd)});},
    closeSync(fd){assert.ok(descriptors.has(fd));descriptors.delete(fd);},
  };
  const prepare=functionVm('prepareAttendanceStagedToolRepairPhaseFollowOn',{p,follow,sequence,acl,schema,guard,
    phaseFollowOn:syntheticPhase,phaseAllowed,allowed,APP,ROOT:'/synthetic-bootstrap',
    maintenance:'/var/lib/faolla-maintenance/merchant-space',phaseFollowOnReceiptFile:nextFile,fs:io,sha:digest,process:{umask:()=>0o022},
    evidenceExists:file=>file===existingPath,
    git:(directory,args)=>{assert.equal(directory,APP);assert.deepEqual([...args],['merge-base','--is-ancestor',syntheticPhase.previousToolRevision,revision]);
      calls.push({kind:'ancestry'});if(brokenAncestry)throw Error('ancestry_failed');return '';},
    verifySource:(target,directory,options)=>{assert.equal(target,revision);assert.deepEqual([...options.scopeFiles],phaseAllowed);
      if(directory==='/synthetic-bootstrap')assert.equal(options.bootstrap,true);else{assert.equal(directory,'/synthetic-tools');assert.equal(options.bootstrap,undefined);}
      calls.push({kind:'source',directory});return info;},
    withOnlineToolPreparationLocks:(options,work)=>{assert.equal(options.deployLock,`${APP}.deploy.lock`);
      assert.equal(options.maintenance,'/var/lib/faolla-maintenance/merchant-space');calls.push({kind:'locks'});locked=true;
      try{return work();}finally{locked=false;}},
    previousPhaseFollowOnReceipt:()=>{assert.ok(locked);previousReads++;calls.push({kind:'previous'});
      if(brokenPrevious||changePrevious&&previousReads>1)throw Error('previous_receipt_changed');return previous;},
    archivedPhaseFollowOnFailure:()=>{assert.ok(locked);archives++;calls.push({kind:'archive'});
      if(changeArchive&&archives>1)throw Error('failure_archive_changed');return syntheticPhase.archive;},
    observe:()=>{assert.ok(locked);observations++;calls.push({kind:'observe'});
      return changeCandidate&&observations>1?{...before,dependencySha256:'c'.repeat(64)}:before;},
    assertAttendanceStagedPhaseFollowOnReceipt:syntheticPhaseValidator,
    assertOnlineToolNoPending:options=>{assert.ok(locked);
      assert.equal(options.fixedStagedRepairReceipt,previous.receipt.effectiveReceipt);
      assertAttendanceStagedRepairReceipt(options.fixedStagedRepairReceipt,{toolRevision:syntheticPhase.previousToolRevision});calls.push({kind:'pending'});},
    createOnlineReleaseToolPlan:target=>({target}),executeOnlineReleaseToolPlan:plan=>{assert.ok(locked);assert.equal(plan.target,revision);
      calls.push({kind:'prepare-source-only'});return {directory:'/synthetic-tools',target:revision};},
    ownedFile:(file,options)=>{assert.equal(file,nextFile);assert.equal(options.privateMode,true);
      return wrongReadback?Buffer.from('{}'):written.get(nextFile);},
  });
  return {calls,written,descriptors,oldFiles,nextFile,oldBytes,run:(confirm,target=revision)=>prepare(target,confirm)};
}

test('synthetic phase preparation preserves six old receipts and seals only one new durable sidecar under both locks',()=>{
  const f=phasePreparationFixture(),result=f.run('approved-staged-attendance-tool-repair-phase-follow-on');
  assert.equal(result.status,'staged-tool-repair-phase-follow-on-prepared');assert.equal(result.toolRevision,revision);
  assert.equal(result.originalReceiptSha256,follow.previousReceiptSha256);
  assert.equal(result.previousReceiptSha256,syntheticPhase.previousReceiptSha256);
  assert.equal(result.applicationRebuilt,false);assert.equal(result.productionDatabaseChanged,false);assert.equal(result.trafficChanged,false);
  f.oldFiles.forEach((file,i)=>assert.ok(f.written.get(file).equals(f.oldBytes[i])));
  assert.equal(f.written.size,7);assert.equal(f.descriptors.size,0);assert.equal(result.receiptSha256,digest(f.written.get(f.nextFile)));
  assert.equal(f.calls.filter(call=>call.kind==='observe').length,2);
  assert.equal(f.calls.filter(call=>call.kind==='prepare-source-only').length,1);
  assert.deepEqual(f.calls.filter(call=>call.kind==='fsync').map(call=>call.file),[f.nextFile,p.operation]);
  assert.ok(f.calls.findLastIndex(call=>call.kind==='observe')<f.calls.findIndex(call=>call.kind==='write'));
});

test('synthetic phase preparation blocks old revisions, live attempts, reuse and changed evidence without touching six old receipts',()=>{
  const approval=phasePreparationFixture();assert.throws(()=>approval.run('approved-staged-attendance-tool-repair-guard-follow-on'),/approval_required/);
  assert.equal(approval.calls.length,0);
  const reused=phasePreparationFixture();assert.throws(()=>reused.run('approved-staged-attendance-tool-repair-phase-follow-on',syntheticPhase.previousToolRevision),/phase_follow_on_revision/);
  assert.equal(reused.calls.length,0);
  const absentNames=['attendance-database-compatibility.json','attendance-compatibility-attempt.json','attendance-compatibility-metadata.sql',
    'attendance-compatibility-extension-metadata.json','attendance-compatibility-extension-supplement.sql','attendance-database-progress.json','attendance-database-ready.json'];
  for(const name of absentNames){const f=phasePreparationFixture({existingPath:`${p.operation}/${name}`});
    assert.throws(()=>f.run('approved-staged-attendance-tool-repair-phase-follow-on'),/database_attempt_exists/);assert.equal(f.written.size,6);}
  for(const options of [{existingPath:`${p.operation}/${syntheticPhase.receiptName}`},{changeCandidate:true},{changePrevious:true},
    {changeArchive:true},{brokenAncestry:true},{brokenPrevious:true}]){
    const f=phasePreparationFixture(options);assert.throws(()=>f.run('approved-staged-attendance-tool-repair-phase-follow-on'),
      /phase_follow_on_receipt_exists|candidate_changed_during_preparation|previous_receipt_changed|failure_archive_changed|ancestry_failed/);
    assert.equal(f.written.size,6);f.oldFiles.forEach((file,i)=>assert.ok(f.written.get(file).equals(f.oldBytes[i])));assert.equal(f.descriptors.size,0);
  }
  const f=phasePreparationFixture({wrongReadback:true});
  assert.throws(()=>f.run('approved-staged-attendance-tool-repair-phase-follow-on'),/receipt_write_changed/);
  assert.equal(f.written.size,7);f.oldFiles.forEach((file,i)=>assert.ok(f.written.get(file).equals(f.oldBytes[i])));
});

test('synthetic phase sidecar has highest priority and any present broken chain cannot fall back to six predecessors',()=>{
  const f=syntheticPhaseFixture(),oldRaw=Buffer.from(JSON.stringify(f.original)),nextRaw=Buffer.from(JSON.stringify(f.chain)),
    oldFile=`${p.operation}/attendance-staged-tool-repair.json`,nextFile=`${p.operation}/${syntheticPhase.receiptName}`,
    previous=phasePrevious(f);
  function fixture({badPrevious=false,badNew=false,changedPrevious=false,changedNew=false,changedArchive=false,
    changedOriginal=false,changedSource=false,changedInputs=false,changedDependency=false,brokenAncestry=false}={}){
    let previousReads=0,newReads=0,archiveReads=0,oldReads=0;const requests=[];
    const verify=functionVm('verifyAttendanceStagedToolRepairReceipt',{p,follow,sequence,acl,schema,guard,
      phaseFollowOn:syntheticPhase,phaseAllowed,APP,ROOT:'/synthetic-tools',receiptFile:oldFile,
      followOnReceiptFile:`${p.operation}/${follow.receiptName}`,sequenceFollowOnReceiptFile:`${p.operation}/${sequence.receiptName}`,
      aclFollowOnReceiptFile:`${p.operation}/${acl.receiptName}`,schemaFollowOnReceiptFile:`${p.operation}/${schema.receiptName}`,
      guardFollowOnReceiptFile:`${p.operation}/${guard.receiptName}`,phaseFollowOnReceiptFile:nextFile,
      sha:digest,evidenceExists:file=>{assert.equal(file,nextFile);return true;},
      ownedFile:(file,options)=>{assert.equal(options.privateMode,true);if(file===oldFile){oldReads++;return changedOriginal&&oldReads>1?Buffer.from('{}'):oldRaw;}
        assert.equal(file,nextFile);newReads++;return badNew||changedNew&&newReads>1?Buffer.from('{}'):nextRaw;},
      previousPhaseFollowOnReceipt:()=>{previousReads++;if(badPrevious||changedPrevious&&previousReads>1)throw Error('previous_receipt_changed');return previous;},
      assertAttendanceStagedRepairReceipt,assertAttendanceStagedPhaseFollowOnReceipt:syntheticPhaseValidator,
      git:(directory,args)=>{assert.equal(directory,APP);
        assert.deepEqual([...args],['merge-base','--is-ancestor',syntheticPhase.previousToolRevision,f.chain.effectiveReceipt.toolRevision]);
        if(brokenAncestry)throw Error('ancestry_failed');return '';},
      archivedPhaseFollowOnFailure:()=>{archiveReads++;if(changedArchive&&archiveReads>1)throw Error('failure_archive_changed');return syntheticPhase.archive;},
      verifySource:(target,root,options)=>{requests.push({target,root,scopeFiles:[...options.scopeFiles]});
        return {changedToolFiles:changedSource?['src/app/page.tsx']:f.chain.effectiveReceipt.changedToolFiles,
          sourceInputsSha256:changedInputs?'c'.repeat(64):f.chain.effectiveReceipt.sourceInputsSha256};},
      observe:()=>({dependencySha256:changedDependency?'c'.repeat(64):f.chain.effectiveReceipt.dependencySha256}),
      previousGuardFollowOnReceipt:()=>assert.fail('cannot fall back to guard predecessor'),
      previousSchemaFollowOnReceipt:()=>assert.fail('cannot fall back to schema predecessor'),
      previousAclFollowOnReceipt:()=>assert.fail('cannot fall back to ACL predecessor'),
      previousSequenceFollowOnReceipt:()=>assert.fail('cannot fall back to sequence predecessor'),
      originalFollowOnReceipt:()=>assert.fail('cannot fall back to first predecessor'),
    });return {requests,run:()=>verify({target:p.target,rootDir:'/synthetic-tools',phase:'migration'})};
  }
  const positive=fixture(),result=positive.run();assert.equal(result.receiptKind,'attendance-staged-tool-repair-phase-follow-on');
  assert.equal(result.toolRevision,f.chain.effectiveReceipt.toolRevision);assert.equal(result.receiptSha256,digest(nextRaw));
  assert.equal(result.originalReceiptSha256,follow.previousReceiptSha256);
  assert.equal(result.previousReceiptSha256,syntheticPhase.previousReceiptSha256);
  assert.deepEqual(positive.requests,[{target:f.chain.effectiveReceipt.toolRevision,root:'/synthetic-tools',scopeFiles:[...phaseAllowed]}]);
  for(const options of [{badPrevious:true},{badNew:true},{changedPrevious:true},{changedNew:true},{changedArchive:true},
    {changedOriginal:true},{changedSource:true},{changedInputs:true},{changedDependency:true},{brokenAncestry:true}])
    assert.throws(fixture(options).run);
});

test('real phase CLI rejects non-Linux/non-root before any production path read or write',
  {skip:process.platform==='linux'&&process.getuid?.()===0},()=>{
    assert.throws(()=>prepareAttendanceStagedToolRepairPhaseFollowOn(revision,
      'approved-staged-attendance-tool-repair-phase-follow-on'),/attendance_staged_repair_invocation/);
    const actual=spawnSync(process.execPath,[entry,'prepare-phase-follow-on',revision,
      'approved-staged-attendance-tool-repair-phase-follow-on'],{encoding:'utf8',timeout:10000,windowsHide:true});
    assert.equal(actual.status,1);assert.equal(actual.stdout,'');assert.match(actual.stderr,/^attendance_staged_repair_invocation\r?\n$/);
  });
