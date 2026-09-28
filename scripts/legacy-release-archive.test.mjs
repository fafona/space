import test from 'node:test';
import assert from 'node:assert/strict';
import fsDefault, * as fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {syncBuiltinESMExports} from 'node:module';
import {captureLegacyReleaseTree} from './legacy-release-tree.mjs';
import {preserveLegacySource, verifyPreservedLegacyArchive, executeLegacyReleaseCleanup} from './legacy-release-cleanup.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => JSON.stringify(value) + '\n';
function withFsync(t, replacement, run) {
  const original = fsDefault.fsyncSync;
  const mocked = t.mock.method(fsDefault, 'fsyncSync', fd => replacement(fd, original));
  syncBuiltinESMExports();
  try {return run();} finally {mocked.mock.restore(); syncBuiltinESMExports();}
}
function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'faolla-legacy-archive-')));
  const location = path.join(root, 'audit'), preserved = path.join(location, 'preserved');
  for (const directory of [location, preserved, path.join(location, 'manifests')]) fs.mkdirSync(directory, {mode: 0o700});
  const owner = Number(fs.lstatSync(root, {bigint: true}).uid);
  const checkPath = (filename, kind = 'directory') => {
    const resolved = path.resolve(filename), relative = path.relative(root, resolved);
    assert(relative && !relative.startsWith('..') && !path.isAbsolute(relative), 'fixture-only path boundary');
    for (let current = resolved; current !== root; current = path.dirname(current)) {
      const stat = fs.lstatSync(current);
      assert(!stat.isSymbolicLink(), 'fixture symlink denied'); assert.equal(stat.uid, owner);
      assert(current === resolved && kind === 'file' ? stat.isFile() && stat.nlink === 1 : stat.isDirectory());
      assert.equal(fs.realpathSync(current), current);
    }
  };
  // Only ownership/mode of test ancestors is projected; all content, reads,
  // descriptors, hashes, inode/timestamps and archive writes remain native.
  const projected = stat => process.platform === 'win32'
    ? Object.assign(Object.create(stat), {mode: (stat.mode & ~0o777n) | (stat.isDirectory() ? 0o755n : 0o644n)}) : stat;
  const io = {...fs,
    lstatSync(filename, options) {
      const stat = projected(fs.lstatSync(filename, options));
      return filename.startsWith(root) ? stat : Object.assign(Object.create(stat), {uid: BigInt(owner), mode: stat.mode & ~0o022n});
    },
    fstatSync: (...args) => projected(fs.fstatSync(...args)),
  };
  const trees = [], blobs = new Map();
  function tree(prefix) {
    const directory = path.join(root, 'merchant-space.releases', `${prefix}-20260928123456`);
    const contents = {'.env.local': 'SYNTHETIC_PRIVATE=never-publish', 'src/app.ts': 'export const shared = 1;',
      'public/photo.bin': Buffer.from([0, 1, 255, 12]), 'logs/build.log': 'synthetic log', '.next/static/chunk.js': 'immutable static',
      '.next/server/app.js': 'generated server', '.next/BUILD_ID': 'generated build', 'node_modules/pkg/index.js': 'generated dependency'};
    for (const [relative, bytes] of Object.entries(contents)) {
      const filename = path.join(directory, ...relative.split('/'));
      fs.mkdirSync(path.dirname(filename), {recursive: true, mode: 0o755}); fs.writeFileSync(filename, bytes, {mode: 0o600});
    }
    const result = captureLegacyReleaseTree(directory, {root, owner, fs: io}); trees.push(result); return result;
  }
  const preserve = value => preserveLegacySource(value, preserved, blobs, {checkPath});
  function plan() {
    const records = trees.map(value => {
      // Manifest context uses the fixed production namespace, without reading
      // it. The proof entries and archived bytes came from our real temp tree.
      const name = path.basename(value.directory), directory = `/www/wwwroot/merchant-space.releases/${name}`;
      const manifest = `${name}.json`, bytes = json({...value, directory});
      fs.writeFileSync(path.join(location, 'manifests', manifest), bytes, {mode: 0o600});
      return {directory, manifest, sha256: hash(bytes), bytes: value.totalBytes, files: value.fileCount};
    });
    return {trees: records, preserved: [...blobs].sort(([a], [b]) => a.localeCompare(b)).map(([sha256, bytes]) => ({sha256, bytes}))};
  }
  t.after(() => {
    assert.equal(path.dirname(root), fs.realpathSync(os.tmpdir())); assert.match(path.basename(root), /^faolla-legacy-archive-/);
    fs.rmSync(root, {recursive: true, force: true}); // only this test's exact fresh root
  });
  return {root, location, preserved, trees, blobs, tree, preserve, plan, checkPath};
}

test('native archive copies source/config/public/log/static exactly and deduplicates across release trees', t => {
  const f = fixture(t), first = f.tree('aaaaaaaaaaaa'), second = f.tree('bbbbbbbbbbbb');
  f.preserve(first); f.preserve(second);
  assert.equal(f.blobs.size, 5); assert.equal(fs.readdirSync(f.preserved).length, 5);
  for (const relativePath of ['.env.local', 'src/app.ts', 'public/photo.bin', 'logs/build.log', '.next/static/chunk.js']) {
    const source = fs.readFileSync(path.join(first.directory, ...relativePath.split('/'))), destination = path.join(f.preserved, hash(source));
    assert.deepEqual(fs.readFileSync(destination), source);
    if (process.platform !== 'win32') assert.equal(fs.lstatSync(destination).mode & 0o777, 0o600);
  }
  for (const relativePath of ['.next/server/app.js', '.next/BUILD_ID', 'node_modules/pkg/index.js']) {
    const source = fs.readFileSync(path.join(first.directory, ...relativePath.split('/')));
    assert(!fs.existsSync(path.join(f.preserved, hash(source))));
  }
  assert(fs.existsSync(first.directory)); assert(fs.existsSync(second.directory));
});
test('native archive rejects source mutation after capture before copying', t => {
  const f = fixture(t), tree = f.tree('aaaaaaaaaaaa');
  fs.appendFileSync(path.join(tree.directory, '.env.local'), '\nSYNTHETIC_CHANGED=1');
  assert.throws(() => f.preserve(tree), /source_changed/);
  assert(fs.existsSync(path.join(tree.directory, '.env.local')));
});
test('deduplication rejects inconsistent declared size and exclusive blob writes do not overwrite', t => {
  const f = fixture(t), tree = f.tree('aaaaaaaaaaaa'), entry = tree.entries.find(value => value.relativePath === '.env.local');
  f.blobs.set(entry.sha256, entry.size + 1);
  assert.throws(() => f.preserve(tree), /archive_digest_collision/);
  f.blobs.clear(); fs.writeFileSync(path.join(f.preserved, entry.sha256), 'do-not-overwrite', {mode: 0o600});
  assert.throws(() => f.preserve(tree), /EEXIST/);
  assert.equal(fs.readFileSync(path.join(f.preserved, entry.sha256), 'utf8'), 'do-not-overwrite');
});
test('native blob fsync failure is propagated before the blob is accepted into the archive', t => {
  const f = fixture(t), tree = f.tree('aaaaaaaaaaaa'), sentinel = Error('synthetic_file_fsync_failure');
  let calls = 0;
  withFsync(t, () => {calls++; throw sentinel;}, () => {
    assert.throws(() => f.preserve(tree), error => error === sentinel);
  });
  assert.equal(calls, 1); assert.equal(f.blobs.size, 0);
  assert(fs.existsSync(path.join(tree.directory, '.env.local')));
});
test('native source symlink replacement is rejected without following it', {skip: process.platform === 'win32'}, t => {
  const f = fixture(t), tree = f.tree('aaaaaaaaaaaa'), source = path.join(tree.directory, '.env.local');
  const outside = path.join(f.root, 'unrelated-secret'); fs.writeFileSync(outside, 'never-archive', {mode: 0o600});
  fs.unlinkSync(source); fs.symlinkSync(outside, source);
  assert.throws(() => f.preserve(tree)); assert.equal(f.blobs.size, 0);
  assert.equal(fs.readFileSync(outside, 'utf8'), 'never-archive');
});

// Native directory fsync and POSIX permission checks are Linux CI obligations;
// the cross-platform tests above still execute the real stream-copy path.
test('native complete archive verifies all manifest/blob coverage and durability checks', {skip: process.platform !== 'linux'}, t => {
  const f = fixture(t); f.preserve(f.tree('aaaaaaaaaaaa')); f.preserve(f.tree('bbbbbbbbbbbb'));
  const plan = f.plan(), synced = [];
  withFsync(t, (fd, original) => {
    const stat = fs.fstatSync(fd);
    synced.push({type: stat.isDirectory() ? 'directory' : 'file', ino: stat.ino}); return original(fd);
  }, () => assert.doesNotThrow(() => verifyPreservedLegacyArchive(plan, f.location, {checkPath: f.checkPath})));
  assert.deepEqual(synced.map(item => item.type), [...plan.preserved.map(() => 'file'), 'directory']);
  assert.deepEqual(synced.slice(0, -1).map(item => item.ino).sort(), plan.preserved.map(item => fs.lstatSync(path.join(f.preserved, item.sha256)).ino).sort());
  assert.equal(synced.at(-1).ino, fs.lstatSync(f.preserved).ino);
});
for (const stage of ['file', 'directory']) {
  test(`native ${stage} durability failure prevents cleanup preparation and deletion`, {skip: process.platform !== 'linux'}, t => {
    const f = fixture(t); f.preserve(f.tree('aaaaaaaaaaaa')); const archive = f.plan();
    const observation = {base: {releaseDirectories: archive.trees.map(item => item.directory), protectedDirectories: [], pm2: []},
      recovery: {protectedDirectories: []}, extraProtected: []};
    const plan = {...archive, version: 1, toolRevision: 'a'.repeat(40), observation};
    const sentinel = Error(`synthetic_${stage}_fsync_failure`); let calls = 0, begun = false, deleted = false;
    withFsync(t, (fd, original) => {
      const actualStage = fs.fstatSync(fd).isDirectory() ? 'directory' : 'file'; calls++;
      if (actualStage === stage) throw sentinel;
      return original(fd);
    }, () => assert.throws(() => executeLegacyReleaseCleanup(plan, {
      observe: () => structuredClone(observation),
      verifyArchive: () => verifyPreservedLegacyArchive(archive, f.location, {checkPath: f.checkPath}),
      readManifest: () => assert.fail('archive durability must precede tree preflight'),
      capture: () => assert.fail('archive durability must precede tree preflight'),
      begin: () => {begun = true;}, apply: () => {deleted = true;},
    }), error => error === sentinel));
    assert.equal(calls, stage === 'file' ? 1 : archive.preserved.length + 1);
    assert.equal(begun, false); assert.equal(deleted, false);
    assert(fs.existsSync(f.trees[0].directory)); assert(!fs.existsSync(path.join(f.location, 'prepared.json')));
  });
}
for (const scenario of ['missing-blob', 'changed-blob', 'extra-blob', 'missing-coverage', 'changed-manifest']) {
  test(`native archive refuses ${scenario} before destructive operations`, {skip: process.platform !== 'linux'}, t => {
    const f = fixture(t); f.preserve(f.tree('aaaaaaaaaaaa')); const plan = f.plan(), first = plan.preserved[0];
    if (scenario === 'missing-blob') fs.unlinkSync(path.join(f.preserved, first.sha256));
    if (scenario === 'changed-blob') fs.writeFileSync(path.join(f.preserved, first.sha256), 'changed', {mode: 0o600});
    if (scenario === 'extra-blob') fs.writeFileSync(path.join(f.preserved, '0'.repeat(64)), 'unexpected', {mode: 0o600});
    if (scenario === 'missing-coverage') {plan.preserved.shift(); fs.unlinkSync(path.join(f.preserved, first.sha256));}
    if (scenario === 'changed-manifest') fs.appendFileSync(path.join(f.location, 'manifests', plan.trees[0].manifest), '\n');
    assert.throws(() => verifyPreservedLegacyArchive(plan, f.location, {checkPath: f.checkPath}), /legacy_release_cleanup_/);
    assert(fs.existsSync(f.trees[0].directory)); assert(!fs.existsSync(path.join(f.location, 'prepared.json')));
  });
}
