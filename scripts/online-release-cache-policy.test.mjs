import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {planReleaseCacheCleanup, captureWebpackCache, applyWebpackCacheCleanup,
  RELEASE_CACHE_ROOT} from './online-release-cache-policy.mjs';

const release = name => `${RELEASE_CACHE_ROOT}/merchant-space.web-releases/${name}`;
const a = release('aaaaaaaaaaaa-online'), b = release('bbbbbbbbbbbb-1234567890123');
const c = `${RELEASE_CACHE_ROOT}/merchant-space.route-releases/cccccccccccc-1234567890123`;
const d = `${RELEASE_CACHE_ROOT}/merchant-space.releases/dddddddddddd-12345678901234`;
const digest = value => createHash('sha256').update(value).digest('hex');
const copyStat = (stat, values) => Object.assign(Object.create(stat), values);

function fixture(t, family = 'merchant-space.web-releases', name = 'aaaaaaaaaaaa-online') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'faolla-cache-policy-'));
  const releaseDirectory = path.join(root, family, name), cachePath = path.join(releaseDirectory, '.next', 'cache', 'webpack');
  fs.mkdirSync(path.join(cachePath, 'client', 'empty'), {recursive: true, mode: 0o755});
  fs.mkdirSync(path.join(cachePath, 'server'), {mode: 0o755});
  fs.writeFileSync(path.join(cachePath, 'client', '0.pack'), 'client-synthetic-cache', {mode: 0o644});
  fs.writeFileSync(path.join(cachePath, 'server', 'index.pack'), 'server-synthetic-cache', {mode: 0o644});
  fs.writeFileSync(path.join(cachePath, 'root.pack'), '', {mode: 0o644});
  fs.mkdirSync(path.join(releaseDirectory, '.next', 'static'), {mode: 0o755});
  fs.writeFileSync(path.join(releaseDirectory, '.next', 'static', 'keep.js'), 'immutable-asset');
  fs.writeFileSync(path.join(releaseDirectory, '.next', 'BUILD_ID'), 'keep-build-id');
  fs.writeFileSync(path.join(releaseDirectory, '.env.local'), 'SYNTHETIC=keep');
  // Windows has no Unix uid/mode semantics. Project those fields only in this
  // injected test port; real pathname/inode/content/mutations remain native fs.
  const project = stat => process.platform === 'win32'
    ? copyStat(stat, {uid: 0n, mode: (stat.mode & ~0o777n) | (stat.isDirectory() ? 0o755n : 0o644n)}) : stat;
  const io = {...fs,
    lstatSync: (...args) => project(fs.lstatSync(...args)),
    fstatSync: (...args) => project(fs.fstatSync(...args)),
  };
  const owner = Number(fs.lstatSync(root, {bigint: true}).uid);
  // Linux's shared /tmp is intentionally world-writable; only inject its mode
  // in tests. Production captures reject writable ancestors without overrides.
  const ordinaryLstat = io.lstatSync;
  io.lstatSync = (filename, options) => {
    const stat = ordinaryLstat(filename, options);
    return !filename.startsWith(root) ? copyStat(stat, {uid: BigInt(owner), mode: stat.mode & ~0o022n}) : stat;
  };
  const options = {fs: io, root, owner};
  t.after(() => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.match(path.basename(root), /^faolla-cache-policy-/);
    fs.rmSync(root, {recursive: true, force: true}); // only this test's created tree
  });
  return {root, releaseDirectory, cachePath, io, options,
    capture: () => captureWebpackCache(cachePath, options)};
}

test('planner accepts only the four exact historical naming forms and freezes output', () => {
  const result = planReleaseCacheCleanup({releaseDirectories: [d, b, a, c], protectedDirectories: []});
  assert.deepEqual(result.eligible.map(item => item.releaseDirectory), [a, b, c, d].sort());
  assert.equal(result.excluded.length, 0);
  assert.ok(result.eligible.every(item => item.cachePath === `${item.releaseDirectory}/.next/cache/webpack`));
  assert.ok(Object.isFrozen(result) && Object.isFrozen(result.eligible) && Object.isFrozen(result.eligible[0]));
});

test('planner excludes live, ancestor and nested static/current/protected references', () => {
  const result = planReleaseCacheCleanup({releaseDirectories: [a, b, c, d], protectedDirectories: [a, `${b}/.next/static`, path.posix.dirname(c)]});
  assert.deepEqual(result.eligible.map(item => item.releaseDirectory), [d]);
  assert.equal(result.excluded.length, 3);
  assert.ok(result.excluded.every(item => item.reason === 'protected_directory'));
  assert.equal(planReleaseCacheCleanup({releaseDirectories: [a], protectedDirectories: ['/']}).eligible.length, 0);
});

test('unknown roots, tools, source roots, suffixes, traversal and noncanonical forms are excluded', () => {
  const invalid = [RELEASE_CACHE_ROOT, '/var/lib/faolla-online-code/' + 'a'.repeat(40), '/www/wwwroot/merchant-space',
    `${a}/.next`, `${a}/../aaaaaaaaaaaa-online`, a + '/', a.replace('/www/', '//www/'), a.replace('aaaaaaaaaaaa', 'AAAAAAAAAAAA'),
    release('a'.repeat(40) + '-online'), `${RELEASE_CACHE_ROOT}/merchant-space.route-releases/aaaaaaaaaaaa-online`,
    `${RELEASE_CACHE_ROOT}/merchant-space.releases/aaaaaaaaaaaa-1234567890123`, a + '\\escape'];
  const result = planReleaseCacheCleanup({releaseDirectories: invalid, protectedDirectories: []});
  assert.equal(result.eligible.length, 0);
  assert.equal(result.excluded.length, invalid.length);
  assert.ok(result.excluded.every(item => item.reason === 'unsupported_release_directory'));
});

test('malformed protected paths and duplicated releases fail closed', () => {
  for (const protectedDirectories of [['relative'], ['/www/../root'], [null], ['']])
    assert.throws(() => planReleaseCacheCleanup({releaseDirectories: [a], protectedDirectories}), /online_cache_plan_invalid/);
  assert.throws(() => planReleaseCacheCleanup({releaseDirectories: [a, a], protectedDirectories: []}), /plan_invalid/);
});

test('capture is deterministic, bounded to webpack, includes exact metadata/content and is immutable', t => {
  const f = fixture(t), visited = [];
  const readDirectory = f.io.readdirSync;
  f.io.readdirSync = filename => { visited.push(filename); return readDirectory(filename); };
  const snapshot = f.capture();
  assert.deepEqual(snapshot, f.capture());
  assert.equal(snapshot.version, 1);
  assert.equal(snapshot.kind, 'webpack-cache');
  assert.equal(snapshot.releaseDirectory, f.releaseDirectory);
  assert.equal(snapshot.fileCount, 3);
  assert.equal(snapshot.totalBytes, Buffer.byteLength('client-synthetic-cacheserver-synthetic-cache'));
  assert.ok(visited.every(filename => filename === f.cachePath || filename.startsWith(f.cachePath + path.sep)));
  assert.deepEqual(snapshot.entries.map(item => item.relativePath), ['', 'client', 'client/0.pack', 'client/empty', 'root.pack', 'server', 'server/index.pack']);
  assert.equal(snapshot.entries.find(item => item.relativePath === 'client/0.pack').sha256, digest('client-synthetic-cache'));
  assert.ok(snapshot.entries.every(item => ['dev', 'ino', 'mtimeNs', 'ctimeNs'].every(key => /^\d+$/.test(item[key]))));
  assert.ok(snapshot.ancestors.every(item => Object.keys(item).sort().join(',') === 'dev,ino,mode,path,type,uid'));
  assert.ok(Object.isFrozen(snapshot) && Object.isFrozen(snapshot.entries[0]) && Object.isFrozen(snapshot.ancestors));
});

test('unrelated outer ancestor timestamp, size and link-count activity does not invalidate capture or apply', t => {
  const f = fixture(t), snapshot = f.capture(), original = f.io.lstatSync;
  let observations = 0;
  f.io.lstatSync = (filename, options) => {
    const stat = original(filename, options);
    if (filename !== f.root) return stat;
    const delta = BigInt(++observations);
    return copyStat(stat, {mtimeNs: stat.mtimeNs + delta, ctimeNs: stat.ctimeNs + delta,
      size: stat.size + delta, nlink: stat.nlink + delta});
  };
  assert.deepEqual(f.capture(), snapshot);
  assert.deepEqual(applyWebpackCacheCleanup(snapshot, f.options),
    {removedFiles: 3, removedDirectories: 3, removedBytes: snapshot.totalBytes, cacheRootRetained: true});
  assert.ok(observations > 4, 'the outer ancestor changed repeatedly throughout capture, preflight and removal');
  assert.deepEqual(fs.readdirSync(f.cachePath), []);
});

test('cache-root metadata-only changes still invalidate the full-tree snapshot', t => {
  const f = fixture(t), snapshot = f.capture(), original = f.io.lstatSync;
  f.io.lstatSync = (filename, options) => {
    const stat = original(filename, options);
    return filename === f.cachePath ? copyStat(stat, {mtimeNs: stat.mtimeNs + 1n}) : stat;
  };
  f.io.unlinkSync = f.io.rmdirSync = () => assert.fail('cache metadata drift must not delete');
  assert.throws(() => applyWebpackCacheCleanup(snapshot, f.options), /manifest_changed/);
});

test('capture accepts each exact root family through test-only root injection', t => {
  for (const [family, name] of [['merchant-space.web-releases', 'bbbbbbbbbbbb-1234567890123'],
    ['merchant-space.route-releases', 'cccccccccccc-1234567890123'], ['merchant-space.releases', 'dddddddddddd-12345678901234']]) {
    const f = fixture(t, family, name);
    assert.equal(f.capture().fileCount, 3);
  }
});

test('capture rejects all paths outside the exact webpack subtree before reading fs', () => {
  const io = {lstatSync() { assert.fail('must not touch filesystem'); }};
  const root = path.resolve(os.tmpdir(), 'synthetic-cache-policy');
  const base = path.join(root, 'merchant-space.web-releases', 'aaaaaaaaaaaa-online');
  for (const filename of [root, base, path.join(base, '.next'), path.join(base, '.next', 'cache'),
    path.join(base, '.next', 'cache', 'images'), path.join(base, '.next', 'cache', 'webpack', 'pack'),
    path.join(root, 'merchant-space.web-releases-extra', 'aaaaaaaaaaaa-online', '.next', 'cache', 'webpack')])
    assert.throws(() => captureWebpackCache(filename, {fs: io, root}), /path_not_allowed/);
});

test('cleanup preserves root/build/assets/env, deletes only captured cache files and empty subdirectories', t => {
  const f = fixture(t), snapshot = f.capture(), mutations = [];
  for (const method of ['unlinkSync', 'rmdirSync']) {
    const original = f.io[method];
    f.io[method] = filename => { mutations.push([method, filename]); return original(filename); };
  }
  f.io.rmSync = () => assert.fail('recursive removal forbidden');
  const result = applyWebpackCacheCleanup(snapshot, f.options);
  assert.deepEqual(result, {removedFiles: 3, removedDirectories: 3, removedBytes: snapshot.totalBytes, cacheRootRetained: true});
  assert.equal(fs.lstatSync(f.cachePath, {bigint: true}).ino.toString(), snapshot.entries[0].ino);
  assert.deepEqual(fs.readdirSync(f.cachePath), []);
  assert.equal(fs.readFileSync(path.join(f.releaseDirectory, '.next', 'BUILD_ID'), 'utf8'), 'keep-build-id');
  assert.equal(fs.readFileSync(path.join(f.releaseDirectory, '.next', 'static', 'keep.js'), 'utf8'), 'immutable-asset');
  assert.equal(fs.readFileSync(path.join(f.releaseDirectory, '.env.local'), 'utf8'), 'SYNTHETIC=keep');
  assert.ok(mutations.every(([, filename]) => filename.startsWith(f.cachePath + path.sep)));
  assert.equal(f.capture().fileCount, 0);
});

test('empty root cleanup remains empty and makes no mutation', t => {
  const f = fixture(t);
  applyWebpackCacheCleanup(f.capture(), f.options);
  f.io.unlinkSync = f.io.rmdirSync = () => assert.fail('empty cache must not mutate');
  assert.deepEqual(applyWebpackCacheCleanup(f.capture(), f.options),
    {removedFiles: 0, removedDirectories: 0, removedBytes: 0, cacheRootRetained: true});
});

for (const scenario of ['new-file', 'missing-file', 'same-size-content', 'changed-mode', 'changed-owner', 'changed-inode']) {
  test(`preflight ${scenario} rejects with zero cleanup mutations`, t => {
    const f = fixture(t), snapshot = f.capture(), filename = path.join(f.cachePath, 'client', '0.pack');
    const original = f.io.lstatSync;
    if (scenario === 'new-file') fs.writeFileSync(path.join(f.cachePath, 'new.pack'), 'new');
    if (scenario === 'missing-file') fs.unlinkSync(filename);
    if (scenario === 'same-size-content') fs.writeFileSync(filename, 'CLIENT-synthetic-cache');
    if (scenario.startsWith('changed-')) f.io.lstatSync = (name, options) => {
      const stat = original(name, options);
      if (name !== filename) return stat;
      return copyStat(stat, scenario === 'changed-mode' ? {mode: stat.mode ^ 0o100n} :
        scenario === 'changed-owner' ? {uid: stat.uid + 1n} : {ino: stat.ino + 1n});
    };
    f.io.unlinkSync = f.io.rmdirSync = () => assert.fail('no mutation before full preflight');
    assert.throws(() => applyWebpackCacheCleanup(snapshot, f.options), /online_cache_/);
  });
}

test('replacement cache root or ancestor is rejected even with identical entry content', t => {
  for (const kind of ['root', 'ancestor']) {
    const f = fixture(t), snapshot = f.capture();
    const changed = kind === 'root' ? f.cachePath : f.releaseDirectory, original = f.io.lstatSync;
    f.io.lstatSync = (filename, options) => {
      const stat = original(filename, options);
      return filename === changed ? copyStat(stat, {ino: stat.ino + 10n}) : stat;
    };
    f.io.unlinkSync = f.io.rmdirSync = () => assert.fail('must not remove a replaced tree');
    assert.throws(() => applyWebpackCacheCleanup(snapshot, f.options), /manifest_changed/);
  }
});

for (const kind of ['symlink-leaf', 'symlink-parent', 'special-file', 'hardlink', 'different-device', 'writable-parent']) {
  test(`capture rejects ${kind}`, t => {
    const f = fixture(t), original = f.io.lstatSync;
    const badPath = kind.endsWith('parent') ? f.releaseDirectory : path.join(f.cachePath, 'client', '0.pack');
    f.io.lstatSync = (filename, options) => {
      const stat = original(filename, options);
      if (filename !== badPath) return stat;
      if (kind.startsWith('symlink')) return copyStat(stat, {isSymbolicLink: () => true});
      if (kind === 'special-file') return copyStat(stat, {isFile: () => false, isDirectory: () => false});
      return copyStat(stat, kind === 'hardlink' ? {nlink: 2n} :
        kind === 'different-device' ? {dev: stat.dev + 1n} : {mode: stat.mode | 0o002n});
    };
    assert.throws(f.capture, /online_cache_(unsafe_entry|hardlink_rejected|device_changed|unsafe_ownership)/);
  });
}

test('native directory symlink/junction inside cache is rejected without touching its target', t => {
  const f = fixture(t), target = path.join(f.releaseDirectory, '.next', 'static');
  fs.symlinkSync(target, path.join(f.cachePath, 'alias'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(f.capture, /unsafe_entry/);
  assert.equal(fs.readFileSync(path.join(target, 'keep.js'), 'utf8'), 'immutable-asset');
});

test('native hardlinked cache file is rejected, including a link to a sibling non-cache file', t => {
  const f = fixture(t), source = path.join(f.releaseDirectory, '.next', 'static', 'keep.js');
  fs.linkSync(source, path.join(f.cachePath, 'linked.pack'));
  assert.throws(f.capture, /hardlink_rejected/);
  assert.equal(fs.readFileSync(source, 'utf8'), 'immutable-asset');
});

test('missing cache root fails closed instead of becoming an empty successful capture', t => {
  const f = fixture(t);
  fs.renameSync(f.cachePath, f.cachePath + '-missing');
  assert.throws(f.capture, error => error.message === 'online_cache_filesystem_failure');
});

test('file swap between lstat and open, or a changing file while hashing, cannot produce a snapshot', t => {
  for (const phase of ['open', 'read']) {
    const f = fixture(t), original = f.io.fstatSync;
    let count = 0;
    f.io.fstatSync = (...args) => {
      const stat = original(...args); count++;
      return phase === 'open' || count % 2 === 0 ? copyStat(stat, {ino: stat.ino + 1n}) : stat;
    };
    assert.throws(f.capture, /file_changed/);
  }
});

test('extra file appearing during capture invalidates the tree', t => {
  const f = fixture(t), original = f.io.readSync;
  let inserted = false;
  f.io.readSync = (...args) => {
    if (!inserted) { inserted = true; fs.writeFileSync(path.join(f.cachePath, 'late.pack'), 'late'); }
    return original(...args);
  };
  assert.throws(f.capture, /tree_changed/);
});

test('late ancestor replacement after preflight stops before the first unlink', t => {
  const f = fixture(t), snapshot = f.capture(), original = f.io.lstatSync;
  let observations = 0;
  f.io.lstatSync = (filename, options) => {
    const stat = original(filename, options);
    if (filename === f.releaseDirectory && ++observations > 2) return copyStat(stat, {ino: stat.ino + 1n});
    return stat;
  };
  f.io.unlinkSync = f.io.rmdirSync = () => assert.fail('cannot unlink after ancestor replacement');
  assert.throws(() => applyWebpackCacheCleanup(snapshot, f.options), /directory_identity_changed/);
});

test('late extra files stop further mutation; partial cache removal is not reported as success', t => {
  const f = fixture(t), snapshot = f.capture(), original = f.io.unlinkSync;
  let removed = 0;
  f.io.unlinkSync = filename => {
    original(filename); removed++;
    fs.writeFileSync(path.join(f.cachePath, 'unexpected.pack'), 'do-not-delete');
  };
  assert.throws(() => applyWebpackCacheCleanup(snapshot, f.options), /tree_changed/);
  assert.equal(removed, 1);
  assert.equal(fs.readFileSync(path.join(f.cachePath, 'unexpected.pack'), 'utf8'), 'do-not-delete');
  assert.ok(fs.existsSync(path.join(f.cachePath, 'server', 'index.pack')));
});

test('forged manifest totals/entries/extra fields cannot authorize removal', t => {
  const f = fixture(t), snapshot = f.capture();
  f.io.unlinkSync = f.io.rmdirSync = () => assert.fail('forged manifest must not mutate');
  for (const modified of [{...snapshot, totalBytes: 0}, {...snapshot, entries: []}, {...snapshot, extra: true},
    {...snapshot, cachePath: path.join(f.releaseDirectory, '.next', 'static')}])
    assert.throws(() => applyWebpackCacheCleanup(modified, f.options), /online_cache_(manifest_changed|path_not_allowed)/);
});

test('missing cache and filesystem failures return fixed errors without private path text', t => {
  const f = fixture(t);
  f.io.lstatSync = () => { throw Error('secret-path-or-content'); };
  assert.throws(f.capture, error => error.message === 'online_cache_filesystem_failure');
});
