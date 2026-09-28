import * as nodeFs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';

// This filesystem layer is NOT a retention/ownership/absence-of-references
// certificate. The caller must prove eligibility, reject mount references,
// acquire deployment locks and preserve an approved private audit beforehand.
const DEFAULT_ROOT = '/www/wwwroot';
const fail = code => {throw Error(`legacy_release_tree_${code}`);};
const freeze = value => {
  if (value && typeof value === 'object') {Object.values(value).forEach(freeze); Object.freeze(value);}
  return value;
};
const identity = value => Object.fromEntries(['type', 'dev', 'ino', 'mode', 'uid'].map(key => [key, value[key]]));
const equal = (left, right, code) => {if (!isDeepStrictEqual(left, right)) fail(code);};
function safe(fn) {
  try {return fn();} catch (error) {
    if (typeof error?.message === 'string' && error.message.startsWith('legacy_release_tree_')) throw error;
    fail('filesystem_failure');
  }
}
function settings(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options) ||
      Object.keys(options).some(key => !['fs', 'root', 'owner'].includes(key))) fail('options_invalid');
  const root = options.root ?? DEFAULT_ROOT, owner = options.owner ?? 0;
  if (typeof root !== 'string' || !path.isAbsolute(root) || path.normalize(root) !== root ||
      root === path.parse(root).root || !Number.isSafeInteger(owner) || owner < 0) fail('options_invalid');
  // Only tests may inject these ports/paths. Production callers use defaults.
  return {io: options.fs ?? nodeFs, root, owner};
}
function validateLocation(directory, root) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory) || path.normalize(directory) !== directory ||
      /[\x00-\x1f\x7f]/.test(directory)) fail('path_not_allowed');
  const parts = path.relative(root, directory).split(path.sep);
  if (parts.length !== 2 || parts[0] !== 'merchant-space.releases' ||
      parts[1].length !== 27 || !/^[a-f0-9]{12}-[0-9]{14}$/.test(parts[1]) ||
      directory !== path.join(root, ...parts)) fail('path_not_allowed');
}
function statOf(io, filename, owner, device) {
  const stat = io.lstatSync(filename, {bigint: true});
  const type = stat.isSymbolicLink() ? 'symlink' : stat.isDirectory() ? 'directory' : stat.isFile() ? 'file' : null;
  if (!type) fail('special_file');
  // POSIX symlinks normally have mode 0777; their parent, owner and exact link
  // target are the authority boundaries. Never chmod or dereference a link.
  if (stat.uid !== BigInt(owner) || (type !== 'symlink' && (stat.mode & 0o022n) !== 0n)) fail('unsafe_ownership');
  if (type !== 'directory' && stat.nlink !== 1n) fail('hardlink_rejected');
  if (device !== undefined && stat.dev.toString() !== device) fail('device_changed');
  if (stat.size < 0n || stat.size > BigInt(Number.MAX_SAFE_INTEGER)) fail('size_invalid');
  return {type, dev: stat.dev.toString(), ino: stat.ino.toString(), mode: Number(stat.mode), uid: Number(stat.uid),
    nlink: Number(stat.nlink), size: Number(stat.size), mtimeNs: stat.mtimeNs.toString(), ctimeNs: stat.ctimeNs.toString()};
}
function directoryStat(io, filename, owner, device) {
  const value = statOf(io, filename, owner, device);
  if (value.type !== 'directory' || io.realpathSync(filename) !== filename) fail('directory_identity_changed');
  return value;
}
function ancestorsOf(directory) {
  const result = [];
  for (let filename = path.dirname(directory); ; filename = path.dirname(filename)) {
    result.unshift(filename);
    if (filename === path.dirname(filename)) return result;
  }
}
function namesOf(io, filename) {
  const names = io.readdirSync(filename).sort();
  if (names.some(name => typeof name !== 'string' || !name || ['.', '..', '.git'].includes(name) ||
      /[/\\\x00-\x1f\x7f]/.test(name)) || new Set(names).size !== names.length) fail('entry_name_rejected');
  return names;
}
function fileHash(io, filename, expected, owner) {
  const fd = io.openSync(filename, nodeFs.constants.O_RDONLY | (nodeFs.constants.O_NOFOLLOW ?? 0));
  try {
    const descriptorIo = {...io, lstatSync: () => io.fstatSync(fd, {bigint: true})};
    equal(statOf(descriptorIo, filename, owner, expected.dev), expected, 'file_changed');
    const hash = createHash('sha256'), buffer = Buffer.allocUnsafe(64 * 1024);
    let bytes = 0, count;
    while ((count = io.readSync(fd, buffer, 0, buffer.length, null)) !== 0) {
      bytes += count;
      if (bytes > expected.size) fail('file_changed');
      hash.update(buffer.subarray(0, count));
    }
    if (bytes !== expected.size) fail('file_changed');
    equal(statOf(descriptorIo, filename, owner, expected.dev), expected, 'file_changed');
    equal(statOf(io, filename, owner, expected.dev), expected, 'file_changed');
    return hash.digest('hex');
  } finally {io.closeSync(fd);}
}
function linkTarget(io, filename, relativePath, directory, root) {
  const target = io.readlinkSync(filename);
  if (typeof target !== 'string' || !target || /[\x00-\x1f\x7f]/.test(target)) fail('link_rejected');
  if (relativePath === '.runtime') {
    if (target !== path.join(root, 'merchant-space.shared', '.runtime')) fail('link_rejected');
  } else {
    if (!relativePath.startsWith('node_modules/') || path.isAbsolute(target) || path.win32.isAbsolute(target) ||
        target.includes('\\')) fail('link_rejected');
    const moduleRoot = path.join(directory, 'node_modules');
    const resolved = path.resolve(path.dirname(filename), target);
    if (resolved !== moduleRoot && !resolved.startsWith(moduleRoot + path.sep)) fail('link_rejected');
  }
  return target;
}

/** Capture exactly one legacy tree. Only regular files are read/hashed; symlink
 * targets are never opened, stat'ed or traversed. Byte totals are logical file
 * lengths, not filesystem block reclamation estimates.
 */
export function captureLegacyReleaseTree(directory, testOptions = {}) {
  return safe(() => {
    const {io, root, owner} = settings(testOptions); validateLocation(directory, root);
    const ancestors = ancestorsOf(directory).map(filename => ({path: filename, ...identity(directoryStat(io, filename, owner))}));
    const first = directoryStat(io, directory, owner), entries = [];
    let fileCount = 0, directoryCount = 0, symlinkCount = 0, totalBytes = 0;
    function walk(filename, relativePath) {
      const before = statOf(io, filename, owner, first.dev);
      if (path.posix.basename(relativePath) === '.runtime' && (relativePath !== '.runtime' || before.type !== 'symlink'))
        fail('runtime_directory_rejected');
      if (before.type === 'file') {
        entries.push({relativePath, ...before, sha256: fileHash(io, filename, before, owner)});
        fileCount++; totalBytes += before.size;
        if (!Number.isSafeInteger(totalBytes)) fail('size_invalid');
      } else if (before.type === 'symlink') {
        const target = linkTarget(io, filename, relativePath, directory, root);
        equal(statOf(io, filename, owner, first.dev), before, 'link_changed');
        entries.push({relativePath, ...before, target, sha256: createHash('sha256').update(target).digest('hex')});
        symlinkCount++;
      } else {
        equal(directoryStat(io, filename, owner, first.dev), before, 'directory_identity_changed');
        const names = namesOf(io, filename);
        entries.push({relativePath, ...before}); directoryCount++;
        for (const name of names) walk(path.join(filename, name), relativePath ? `${relativePath}/${name}` : name);
        equal(namesOf(io, filename), names, 'tree_changed');
        equal(statOf(io, filename, owner, first.dev), before, 'tree_changed');
      }
    }
    walk(directory, '');
    for (const item of ancestors) equal(identity(directoryStat(io, item.path, owner)), identity(item), 'ancestor_changed');
    return freeze({version: 1, kind: 'legacy-release-tree', directory, ancestors, entries,
      fileCount, directoryCount, symlinkCount, totalBytes});
  });
}

/** One-shot, synchronous deletion under caller-owned locks. Late failures may
 * leave a partially removed tree: preserve the audit and never auto-retry.
 * No recursive rm; no transaction or guarantee against a hostile root writer.
 */
export function applyLegacyReleaseTreeCleanup(manifest, testOptions = {}) {
  return safe(() => {
    const {io, root, owner} = settings(testOptions);
    if (!manifest || manifest.kind !== 'legacy-release-tree') fail('manifest_invalid');
    const fresh = captureLegacyReleaseTree(manifest.directory, testOptions);
    equal(fresh, manifest, 'manifest_changed'); // Entire tree before first deletion.
    const entries = new Map(manifest.entries.map(item => [item.relativePath, item]));
    const children = new Map(manifest.entries.filter(item => item.type === 'directory').map(item => [item.relativePath, []]));
    for (const item of manifest.entries) if (item.relativePath) {
      const parent = path.posix.dirname(item.relativePath);
      children.get(parent === '.' ? '' : parent).push(item.relativePath);
    }
    const removed = new Set(), absolute = relativePath => path.join(manifest.directory, ...relativePath.split('/'));
    function checkAncestors() {
      for (const item of manifest.ancestors) equal(identity(directoryStat(io, item.path, owner)), identity(item), 'ancestor_changed');
    }
    function checkDirectory(relativePath) {
      checkAncestors();
      const chain = [''];
      if (relativePath) {
        const parts = relativePath.split('/');
        for (let index = 1; index <= parts.length; index++) chain.push(parts.slice(0, index).join('/'));
      }
      for (const current of chain) {
        const expected = entries.get(current);
        equal(identity(directoryStat(io, absolute(current), owner, expected.dev)), identity(expected), 'directory_identity_changed');
      }
      const expectedNames = children.get(relativePath).filter(item => !removed.has(item)).map(item => path.posix.basename(item)).sort();
      equal(namesOf(io, absolute(relativePath)), expectedNames, 'tree_changed');
    }
    let removedFiles = 0, removedSymlinks = 0, removedDirectories = 0, removedBytes = 0;
    function removeDirectory(relativePath) {
      checkDirectory(relativePath);
      for (const child of children.get(relativePath)) {
        checkDirectory(relativePath);
        const item = entries.get(child), filename = absolute(child);
        if (item.type === 'directory') removeDirectory(child);
        else {
          const {relativePath: ignored, sha256, target, ...expected} = item;
          void ignored;
          equal(statOf(io, filename, owner, item.dev), expected, 'entry_changed');
          if (item.type === 'file') equal(fileHash(io, filename, expected, owner), sha256, 'file_changed');
          else {
            equal(linkTarget(io, filename, child, manifest.directory, root), target, 'link_changed');
            equal(statOf(io, filename, owner, item.dev), expected, 'link_changed');
          }
          checkDirectory(relativePath);
          io.unlinkSync(filename); removed.add(child);
          if (item.type === 'file') {removedFiles++; removedBytes += item.size;} else removedSymlinks++;
        }
      }
      checkDirectory(relativePath);
      if (namesOf(io, absolute(relativePath)).length) fail('directory_not_empty');
      io.rmdirSync(absolute(relativePath)); removed.add(relativePath); removedDirectories++;
    }
    removeDirectory('');
    checkAncestors();
    try {io.lstatSync(manifest.directory); fail('root_not_removed');}
    catch (error) {if (error?.code !== 'ENOENT') throw error;}
    return freeze({removedFiles, removedSymlinks, removedDirectories, removedBytes, releaseRootRemoved: true});
  });
}
