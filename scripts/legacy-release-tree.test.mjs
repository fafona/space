import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {captureLegacyReleaseTree, applyLegacyReleaseTreeCleanup} from './legacy-release-tree.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
const changedStat = (stat, fields) => Object.assign(Object.create(stat), fields);

function fixture(t, name = 'aaaaaaaaaaaa-20260928123456') {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'faolla-legacy-tree-')));
  const directory = path.join(root, 'merchant-space.releases', name);
  const shared = path.join(root, 'merchant-space.shared', '.runtime');
  for (const location of [path.join(directory, '.next', 'static'), path.join(directory, 'src'),
    path.join(directory, 'node_modules', '.bin'), path.join(directory, 'node_modules', 'pkg'), shared])
    fs.mkdirSync(location, {recursive: true, mode: 0o755});
  const files = {'.next/BUILD_ID': 'synthetic-build', '.next/static/chunk.js': 'static-source',
    'src/app.ts': 'export const value = 1;', 'package-lock.json': '{"synthetic":true}',
    'node_modules/pkg/bin.js': 'synthetic-package', '.env.local': 'SYNTHETIC=private'};
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(directory, ...name.split('/')), text, {mode: 0o644});
  fs.writeFileSync(path.join(shared, 'keep.json'), '{"business":"never-read-or-delete"}', {mode: 0o600});
  const sibling = path.join(root, 'merchant-space.releases', 'bbbbbbbbbbbb-20260928123456');
  fs.mkdirSync(sibling, {mode: 0o755}); fs.writeFileSync(path.join(sibling, 'keep.txt'), 'sibling');
  const owner = Number(fs.lstatSync(root, {bigint: true}).uid), links = new Map();
  const project = stat => process.platform === 'win32'
    ? changedStat(stat, {mode: (stat.mode & ~0o777n) | (stat.isDirectory() ? 0o755n : 0o644n)}) : stat;
  // Windows has no Unix mode semantics. The injected port projects only mode;
  // ancestors outside this owned test tree also project uid/writable /tmp bits.
  // Native content, inode, directory enumeration and unlink/rmdir remain real.
  const io = {...fs,
    lstatSync(filename, options) {
      let stat = project(fs.lstatSync(filename, options));
      if (!filename.startsWith(root)) stat = changedStat(stat, {uid: BigInt(owner), mode: stat.mode & ~0o022n});
      if (links.has(filename)) stat = changedStat(stat, {isSymbolicLink: () => true,
        mode: (stat.mode & ~0o170777n) | 0o120777n});
      return stat;
    },
    fstatSync: (...args) => project(fs.fstatSync(...args)),
    readlinkSync: filename => links.has(filename) ? links.get(filename) : fs.readlinkSync(filename),
  };
  const options = {fs: io, root, owner};
  t.after(() => {
    assert.equal(path.dirname(root), fs.realpathSync(os.tmpdir()));
    assert.match(path.basename(root), /^faolla-legacy-tree-/);
    fs.rmSync(root, {recursive: true, force: true}); // only this fixture's created tree
  });
  return {root, directory, shared, sibling, files, links, io, options,
    capture: () => captureLegacyReleaseTree(directory, options)};
}
function syntheticLink(f, relativePath, target) {
  // Relative link semantics are injected to avoid requiring Windows developer
  // symlink privileges. Shared-runtime no-follow is additionally tested with a
  // native directory junction (Windows) or native symlink (Linux).
  const filename = path.join(f.directory, ...relativePath.split('/'));
  fs.mkdirSync(path.dirname(filename), {recursive: true, mode: 0o755});
  fs.writeFileSync(filename, 'synthetic-link-record', {mode: 0o644});
  f.links.set(filename, target);
  return filename;
}
const denyMutation = f => {f.io.unlinkSync = f.io.rmdirSync = () => assert.fail('preflight must delete nothing');};
const esbuildPaths = ['node_modules/@esbuild/linux-x64/bin/esbuild', 'node_modules/esbuild/bin/esbuild'];
function esbuildPair(f) {
  const names = esbuildPaths.map(name => path.join(f.directory, ...name.split('/')));
  for (const filename of names) fs.mkdirSync(path.dirname(filename), {recursive: true, mode: 0o755});
  fs.writeFileSync(names[0], 'synthetic-esbuild-binary', {mode: 0o755}); fs.linkSync(names[0], names[1]);
  return names;
}

test('only the exact legacy 12hex-14digit release root is accepted before any filesystem read', () => {
  const root = path.resolve(os.tmpdir(), 'legacy-root'), io = {lstatSync() {assert.fail('no filesystem read');}};
  for (const parts of [[], ['merchant-space.releases'], ['merchant-space.web-releases', 'aaaaaaaaaaaa-online'],
    ['merchant-space.route-releases', 'aaaaaaaaaaaa-2026092812345'], ['merchant-space.releases', 'a'.repeat(40) + '-20260928123456'],
    ['merchant-space.releases', 'AAAAAAAAAAAA-20260928123456'], ['merchant-space.releases', 'aaaaaaaaaaaa-2026092812345'],
    ['merchant-space.releases', 'aaaaaaaaaaaa-202609281234567'], ['merchant-space.releases', 'aaaaaaaaaaaa-20260928123456', '.next']])
    assert.throws(() => captureLegacyReleaseTree(path.join(root, ...parts), {fs: io, root}), /path_not_allowed/);
  assert.throws(() => captureLegacyReleaseTree(path.join(root, 'merchant-space.releases', 'aaaaaaaaaaaa-20260928123456') + path.sep,
    {fs: io, root}), /path_not_allowed/);
});

test('captures full regular-file metadata and streaming hashes, without sibling/shared traversal', t => {
  const f = fixture(t), opens = [], directories = [], chunks = [];
  const open = f.io.openSync, read = f.io.readSync, list = f.io.readdirSync;
  fs.writeFileSync(path.join(f.directory, 'large.pack'), Buffer.alloc(200_000, 7), {mode: 0o644});
  f.io.openSync = (filename, ...args) => {opens.push(filename); assert.ok(filename.startsWith(f.directory + path.sep)); return open(filename, ...args);};
  f.io.readdirSync = filename => {directories.push(filename); assert.ok(filename === f.directory || filename.startsWith(f.directory + path.sep)); return list(filename);};
  f.io.readSync = (fd, buffer, offset, length, position) => {chunks.push(length); return read(fd, buffer, offset, length, position);};
  const manifest = f.capture();
  assert.deepEqual(manifest, f.capture());
  assert.equal(manifest.fileCount, 7); assert.equal(manifest.symlinkCount, 0);
  assert.equal(manifest.totalBytes, Object.values(f.files).reduce((sum, value) => sum + Buffer.byteLength(value), 200_000));
  assert.equal(manifest.entries.find(item => item.relativePath === 'large.pack').sha256, digest(Buffer.alloc(200_000, 7)));
  assert.ok(manifest.entries.every(item => ['dev', 'ino', 'mtimeNs', 'ctimeNs'].every(key => /^\d+$/.test(item[key]))));
  assert.ok(manifest.ancestors.every(item => Object.keys(item).sort().join(',') === 'dev,ino,mode,path,type,uid'));
  assert.ok(Object.isFrozen(manifest) && Object.isFrozen(manifest.entries[0]));
  assert.ok(opens.length > 0 && directories.length > 0 && chunks.length > 3);
  assert.ok(chunks.every(length => length <= 64 * 1024));
});

test('removes a complete exact release bottom-up without recursive rm, leaving siblings/shared intact', t => {
  const f = fixture(t), manifest = f.capture(), calls = [];
  const unlink = f.io.unlinkSync, rmdir = f.io.rmdirSync;
  f.io.unlinkSync = filename => {calls.push(['unlink', filename]); return unlink(filename);};
  f.io.rmdirSync = filename => {calls.push(['rmdir', filename]); return rmdir(filename);};
  f.io.rmSync = () => assert.fail('recursive rm forbidden');
  assert.deepEqual(applyLegacyReleaseTreeCleanup(manifest, f.options), {removedFiles: 6, removedSymlinks: 0,
    removedDirectories: manifest.directoryCount, removedBytes: manifest.totalBytes, releaseRootRemoved: true});
  assert.deepEqual(calls.at(-1), ['rmdir', f.directory]);
  assert.ok(calls.every(([, filename]) => filename === f.directory || filename.startsWith(f.directory + path.sep)));
  assert.equal(fs.existsSync(f.directory), false);
  assert.equal(fs.readFileSync(path.join(f.sibling, 'keep.txt'), 'utf8'), 'sibling');
  assert.equal(fs.readFileSync(path.join(f.shared, 'keep.json'), 'utf8'), '{"business":"never-read-or-delete"}');
});

test('native shared .runtime link is captured and unlinked without reading its business target', t => {
  const f = fixture(t), link = path.join(f.directory, '.runtime');
  fs.symlinkSync(f.shared, link, process.platform === 'win32' ? 'junction' : 'dir');
  const before = fs.readFileSync(path.join(f.shared, 'keep.json')), open = f.io.openSync, list = f.io.readdirSync;
  f.io.openSync = (filename, ...args) => {assert.ok(!filename.startsWith(link) && !filename.startsWith(f.shared)); return open(filename, ...args);};
  f.io.readdirSync = filename => {assert.ok(!filename.startsWith(link) && !filename.startsWith(f.shared)); return list(filename);};
  const manifest = f.capture(), item = manifest.entries.find(item => item.relativePath === '.runtime');
  assert.equal(item.type, 'symlink'); assert.equal(item.target, f.shared); assert.equal(item.sha256, digest(f.shared));
  assert.equal(applyLegacyReleaseTreeCleanup(manifest, f.options).removedSymlinks, 1);
  assert.deepEqual(fs.readFileSync(path.join(f.shared, 'keep.json')), before);
  assert.ok(fs.statSync(f.shared).isDirectory());
});

test('relative node_modules links are lexical-only, including scoped and dangling in-tree targets', t => {
  const f = fixture(t);
  syntheticLink(f, 'node_modules/.bin/tool', '../pkg/bin.js');
  syntheticLink(f, 'node_modules/@scope/pkg', '../pkg');
  syntheticLink(f, 'node_modules/optional', './not-installed');
  const manifest = f.capture();
  assert.equal(manifest.symlinkCount, 3);
  assert.equal(manifest.entries.filter(item => item.type === 'symlink').length, 3);
  assert.equal(applyLegacyReleaseTreeCleanup(manifest, f.options).removedSymlinks, 3);
  assert.equal(fs.existsSync(f.directory), false);
});

for (const [relativePath, target] of [
  ['src/alias', '../node_modules/pkg'], ['node_modules/.bin/escape', '../../../shared'],
  ['node_modules/escape', '../../merchant-space.shared/.runtime'], ['node_modules/absolute', '/tmp/anything'],
  ['node_modules/windows', 'C:\\external'], ['node_modules/backslash', '..\\..\\outside'],
  ['node_modules/control', '../pkg\n'], ['.runtime', '../merchant-space.shared/.runtime'],
  ['nested/.runtime', '../anything'],
]) {
  test(`rejects unapproved symlink ${relativePath} -> ${JSON.stringify(target)}`, t => {
    const f = fixture(t); syntheticLink(f, relativePath, target);
    assert.throws(f.capture, /legacy_release_tree_(link_rejected|runtime_directory_rejected)/);
  });
}

test('real .runtime directory and .git entries anywhere are rejected before deletion', t => {
  for (const name of ['.runtime', '.git', 'node_modules/pkg/.git']) {
    const f = fixture(t);
    fs.mkdirSync(path.join(f.directory, ...name.split('/')), {mode: 0o755});
    assert.throws(f.capture, /legacy_release_tree_(runtime_directory_rejected|entry_name_rejected)/);
  }
  const f = fixture(t); fs.writeFileSync(path.join(f.directory, '.git'), 'gitdir: /other');
  assert.throws(f.capture, /entry_name_rejected/);
});

for (const mutation of ['additional-file', 'missing-file', 'appended-file', 'same-length-content', 'changed-inode']) {
  test(`full-tree ${mutation} fails preflight with zero deletions`, t => {
    const f = fixture(t), manifest = f.capture(), filename = path.join(f.directory, 'src', 'app.ts');
    if (mutation === 'additional-file') fs.writeFileSync(path.join(f.directory, 'new.txt'), 'new');
    if (mutation === 'missing-file') fs.unlinkSync(filename);
    if (mutation === 'appended-file') fs.appendFileSync(filename, 'appended');
    if (mutation === 'same-length-content') fs.writeFileSync(filename, 'EXPORT const value = 1;');
    if (mutation === 'changed-inode') {
      const original = f.io.lstatSync;
      f.io.lstatSync = (name, options) => {const stat = original(name, options); return name === filename ? changedStat(stat, {ino: stat.ino + 1n}) : stat;};
    }
    denyMutation(f);
    assert.throws(() => applyLegacyReleaseTreeCleanup(manifest, f.options), /legacy_release_tree_/);
  });
}

test('unchanged sibling activity is allowed, but release-root and ancestor replacement are rejected', t => {
  const f = fixture(t), manifest = f.capture(), original = f.io.lstatSync;
  let count = 0;
  f.io.lstatSync = (filename, options) => {
    const stat = original(filename, options), delta = BigInt(++count);
    return filename === path.dirname(f.directory) ? changedStat(stat, {mtimeNs: stat.mtimeNs + delta,
      ctimeNs: stat.ctimeNs + delta, nlink: stat.nlink + delta, size: stat.size + delta}) : stat;
  };
  assert.deepEqual(f.capture(), manifest);
  assert.equal(applyLegacyReleaseTreeCleanup(manifest, f.options).releaseRootRemoved, true);
  for (const location of ['root', 'parent']) {
    const g = fixture(t), saved = g.capture(), statOf = g.io.lstatSync;
    g.io.lstatSync = (filename, options) => {
      const stat = statOf(filename, options);
      return filename === (location === 'root' ? g.directory : path.dirname(g.directory)) ? changedStat(stat, {ino: stat.ino + 1n}) : stat;
    };
    denyMutation(g); assert.throws(() => applyLegacyReleaseTreeCleanup(saved, g.options), /manifest_changed/);
  }
});

test('root or ancestor symlink/realpath substitution cannot be captured', t => {
  for (const location of ['root', 'parent']) {
    const f = fixture(t), original = f.io.realpathSync;
    f.io.realpathSync = filename => filename === (location === 'root' ? f.directory : path.dirname(f.directory)) ?
      f.shared : original(filename);
    assert.throws(f.capture, /directory_identity_changed/);
  }
});

test('native root or parent junction/symlink replacement rejects without traversing the replacement target', t => {
  for (const location of ['root', 'parent']) {
    const f = fixture(t), manifest = f.capture();
    const replaced = location === 'root' ? f.directory : path.dirname(f.directory);
    fs.renameSync(replaced, replaced + '-original');
    fs.symlinkSync(f.shared, replaced, process.platform === 'win32' ? 'junction' : 'dir');
    denyMutation(f);
    assert.throws(() => applyLegacyReleaseTreeCleanup(manifest, f.options), /directory_identity_changed/);
    assert.equal(fs.readFileSync(path.join(f.shared, 'keep.json'), 'utf8'), '{"business":"never-read-or-delete"}');
  }
});

test('symlink target replacement and symlink-to-file replacement invalidate the approved snapshot', t => {
  for (const kind of ['target', 'type']) {
    const f = fixture(t), filename = syntheticLink(f, 'node_modules/.bin/tool', '../pkg/bin.js'), manifest = f.capture();
    if (kind === 'target') f.links.set(filename, '../pkg/other.js'); else f.links.delete(filename);
    denyMutation(f); assert.throws(() => applyLegacyReleaseTreeCleanup(manifest, f.options), /manifest_changed/);
  }
});

test('hardlinks, special files, cross-device descendants and writable/foreign-owned entries reject', t => {
  for (const mutation of ['special', 'device', 'writable', 'owner']) {
    const f = fixture(t), filename = path.join(f.directory, 'src', 'app.ts'), original = f.io.lstatSync;
    f.io.lstatSync = (name, options) => {
      const stat = original(name, options);
      if (name !== filename) return stat;
      if (mutation === 'special') return changedStat(stat, {isFile: () => false, isDirectory: () => false, isSymbolicLink: () => false});
      return changedStat(stat, mutation === 'device' ? {dev: stat.dev + 1n} : mutation === 'writable' ?
        {mode: stat.mode | 0o020n} : {uid: stat.uid + 1n});
    };
    assert.throws(f.capture, /legacy_release_tree_(special_file|device_changed|unsafe_ownership)/);
  }
  const f = fixture(t);
  fs.linkSync(path.join(f.shared, 'keep.json'), path.join(f.directory, 'hardlinked.json'));
  assert.throws(f.capture, /hardlink_rejected/);
});

test('only the closed generated esbuild pair is captured and both names are safely unlinked', t => {
  const f = fixture(t), names = esbuildPair(f), manifest = f.capture();
  const linked = manifest.entries.filter(item => item.nlink === 2 && item.type === 'file');
  assert.deepEqual(linked.map(item => item.relativePath), esbuildPaths);
  assert.equal(linked[0].ino, linked[1].ino); assert.equal(linked[0].dev, linked[1].dev);
  assert.equal(linked[0].sha256, digest('synthetic-esbuild-binary'));
  const unlink = f.io.unlinkSync, events = [];
  f.io.unlinkSync = filename => {
    if (names.includes(filename)) events.push([filename, fs.lstatSync(filename).nlink]);
    unlink(filename);
  };
  const result = applyLegacyReleaseTreeCleanup(manifest, f.options);
  assert.deepEqual(events, [[names[0], 2], [names[1], 1]]);
  assert.equal(result.removedFiles, 8); assert.equal(result.releaseRootRemoved, true);
  assert.equal(result.removedBytes, manifest.totalBytes); // logical lengths, not reclaimed blocks
  assert.equal(fs.readFileSync(path.join(f.shared, 'keep.json'), 'utf8'), '{"business":"never-read-or-delete"}');
});

test('esbuild independent single-link files preserve the original ordinary-file behavior', t => {
  const f = fixture(t), names = esbuildPair(f);
  fs.unlinkSync(names[1]); fs.writeFileSync(names[1], 'independent-copy', {mode: 0o755});
  const manifest = f.capture();
  assert.ok(manifest.entries.filter(item => item.type === 'file').every(item => item.nlink === 1));
  assert.equal(applyLegacyReleaseTreeCleanup(manifest, f.options).releaseRootRemoved, true);
});

for (const variant of ['external-third', 'in-tree-third', 'only-one-name', 'different-inodes']) {
  test(`esbuild ${variant} cannot qualify as the closed two-name set`, t => {
    const f = fixture(t), names = esbuildPair(f);
    if (variant === 'external-third') fs.linkSync(names[0], path.join(f.shared, 'external-esbuild'));
    if (variant === 'in-tree-third') fs.linkSync(names[0], path.join(f.directory, 'extra-esbuild'));
    if (variant === 'only-one-name') fs.renameSync(names[1], path.join(f.shared, 'external-esbuild'));
    if (variant === 'different-inodes') {
      fs.unlinkSync(names[1]); fs.writeFileSync(names[1], 'synthetic-esbuild-binary', {mode: 0o755});
      names.forEach((filename, index) => fs.linkSync(filename, path.join(f.shared, `external-${index}`)));
    }
    denyMutation(f);
    assert.throws(f.capture, /hardlink_(rejected|set_not_closed)/);
  });
}

test('changed esbuild alias set after capture causes zero deletion in apply preflight', t => {
  const f = fixture(t), names = esbuildPair(f), manifest = f.capture();
  fs.linkSync(names[0], path.join(f.shared, 'external-esbuild'));
  denyMutation(f); assert.throws(() => applyLegacyReleaseTreeCleanup(manifest, f.options), /hardlink_rejected/);
  assert.ok(names.every(filename => fs.existsSync(filename)));
});

test('a late extra alias before either esbuild unlink is refused with both binary names intact', t => {
  const f = fixture(t), names = esbuildPair(f), manifest = f.capture(), unlink = f.io.unlinkSync;
  let changed = false, binaryDeletes = 0;
  f.io.unlinkSync = filename => {
    if (names.includes(filename)) binaryDeletes++;
    unlink(filename);
    if (!changed) {changed = true; fs.linkSync(names[0], path.join(f.shared, 'external-esbuild'));}
  };
  assert.throws(() => applyLegacyReleaseTreeCleanup(manifest, f.options), /hardlink_rejected/);
  assert.equal(binaryDeletes, 0); assert.ok(names.every(filename => fs.existsSync(filename)));
});

for (const variant of ['extra-alias', 'content-change', 'replaced-survivor', 'skipped-unlink']) {
  test(`first esbuild unlink ${variant} does not silently update remaining expected metadata`, t => {
    const f = fixture(t), names = esbuildPair(f), manifest = f.capture(), unlink = f.io.unlinkSync;
    let binaryDeletes = 0;
    f.io.unlinkSync = filename => {
      if (names.includes(filename)) binaryDeletes++;
      if (filename !== names[0]) return unlink(filename);
      if (variant === 'skipped-unlink') return;
      unlink(filename);
      if (variant === 'extra-alias') fs.linkSync(names[1], path.join(f.shared, 'late-esbuild'));
      if (variant === 'content-change') fs.writeFileSync(names[1], 'changed-esbuild');
      if (variant === 'replaced-survivor') {
        fs.unlinkSync(names[1]); fs.writeFileSync(names[1], 'synthetic-esbuild-binary', {mode: 0o755});
      }
    };
    assert.throws(() => applyLegacyReleaseTreeCleanup(manifest, f.options), /legacy_release_tree_/);
    assert.equal(binaryDeletes, 1); assert.ok(fs.existsSync(names[1]));
  });
}

test('surviving esbuild ctime drift after the accounted first unlink is still rejected', t => {
  const f = fixture(t), names = esbuildPair(f), manifest = f.capture(), rmdir = f.io.rmdirSync, stat = f.io.lstatSync;
  let changed = false;
  f.io.rmdirSync = filename => {rmdir(filename); if (filename === path.dirname(names[0])) changed = true;};
  f.io.lstatSync = (filename, options) => {
    const value = stat(filename, options);
    return changed && filename === names[1] ? changedStat(value, {ctimeNs: value.ctimeNs + 1n}) : value;
  };
  assert.throws(() => applyLegacyReleaseTreeCleanup(manifest, f.options), /entry_changed/);
  assert.equal(fs.existsSync(names[0]), false); assert.equal(fs.existsSync(names[1]), true);
});

test('opened descriptor replacement and files growing during streaming hash reject capture', t => {
  for (const mutation of ['descriptor', 'grow']) {
    const f = fixture(t);
    if (mutation === 'descriptor') {
      const original = f.io.fstatSync;
      f.io.fstatSync = (...args) => {const stat = original(...args); return changedStat(stat, {ino: stat.ino + 1n});};
    } else {
      const original = f.io.openSync;
      f.io.openSync = (filename, ...args) => {fs.appendFileSync(filename, 'growing'); return original(filename, ...args);};
    }
    assert.throws(f.capture, /file_changed/);
  }
});

test('late parent replacement after preflight stops before first unlink', t => {
  const f = fixture(t), manifest = f.capture(), original = f.io.lstatSync;
  let count = 0;
  f.io.lstatSync = (filename, options) => {
    const stat = original(filename, options);
    return filename === path.dirname(f.directory) && ++count > 2 ? changedStat(stat, {ino: stat.ino + 1n}) : stat;
  };
  denyMutation(f);
  assert.throws(() => applyLegacyReleaseTreeCleanup(manifest, f.options), /ancestor_changed/);
});

test('late extra entry yields explicit partial failure and never deletes the unexpected entry', t => {
  const f = fixture(t), manifest = f.capture(), unlink = f.io.unlinkSync;
  let removed = 0;
  f.io.unlinkSync = filename => {unlink(filename); removed++; fs.writeFileSync(path.join(path.dirname(filename), 'late.txt'), 'keep');};
  assert.throws(() => applyLegacyReleaseTreeCleanup(manifest, f.options), /tree_changed/);
  assert.equal(removed, 1);
  assert.equal(fs.existsSync(f.directory), true);
  assert.equal(fs.readFileSync(path.join(f.shared, 'keep.json'), 'utf8'), '{"business":"never-read-or-delete"}');
});

test('multi-directory late failure does not report success or remove a second release', t => {
  const f = fixture(t), manifest = f.capture(), unlink = f.io.unlinkSync;
  const failurePath = path.join(f.directory, 'node_modules', 'pkg', 'bin.js');
  let removed = 0;
  f.io.unlinkSync = filename => {
    if (filename === failurePath) throw Error('synthetic-permission-failure');
    unlink(filename); removed++;
  };
  assert.throws(() => applyLegacyReleaseTreeCleanup(manifest, f.options), /filesystem_failure/);
  assert.ok(removed > 0);
  assert.equal(fs.existsSync(failurePath), true);
  assert.equal(fs.readFileSync(path.join(f.sibling, 'keep.txt'), 'utf8'), 'sibling');
  assert.equal(fs.readFileSync(path.join(f.directory, 'src', 'app.ts'), 'utf8'), f.files['src/app.ts']);
});

test('forged manifests, missing trees and unsupported overrides fail closed', t => {
  const f = fixture(t), manifest = f.capture(); denyMutation(f);
  for (const modified of [{...manifest, totalBytes: 0}, {...manifest, entries: []}, {...manifest, extra: true},
    {...manifest, directory: f.shared}]) assert.throws(() => applyLegacyReleaseTreeCleanup(modified, f.options), /legacy_release_tree_/);
  assert.throws(() => captureLegacyReleaseTree(f.directory, {...f.options, followLinks: true}), /options_invalid/);
  fs.renameSync(f.directory, f.directory + '-missing');
  assert.throws(f.capture, error => error.message === 'legacy_release_tree_filesystem_failure');
});
