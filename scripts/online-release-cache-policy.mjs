import * as nodeFs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';

// This library neither observes processes nor authorizes a release for cleanup.
// Its caller must exclude live/protected/pending paths, own the deployment locks,
// and bind this snapshot to a private, explicitly approved audit manifest.
export const RELEASE_CACHE_ROOT = '/www/wwwroot';
const families = Object.freeze([
  ['merchant-space.web-releases', /^(?:[a-f0-9]{12}-online|[a-f0-9]{12}-[0-9]{13})$/],
  ['merchant-space.route-releases', /^[a-f0-9]{12}-[0-9]{13}$/],
  ['merchant-space.releases', /^[a-f0-9]{12}-[0-9]{14}$/],
]);
const fail = code => { throw Error(`online_cache_${code}`); };
const freeze = value => {
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) freeze(item);
    Object.freeze(value);
  }
  return value;
};
const canonicalPosix = value => typeof value === 'string' && value.startsWith('/') &&
  !/[\\\x00-\x1f\x7f]/.test(value) && path.posix.normalize(value) === value &&
  (value === '/' || !value.endsWith('/'));
const overlaps = (left, right) => left === right || left.startsWith(right === '/' ? '/' : `${right}/`) ||
  right.startsWith(left === '/' ? '/' : `${left}/`);
function supported(parts) {
  return parts.length === 2 && families.some(([name, expression]) => parts[0] === name && expression.test(parts[1]));
}

/** Pure production-namespace selection; unknown paths never become candidates.
 * protectedDirectories must include resolved references: this function does not
 * follow .current or static-root aliases, query PM2, or infer pending operations.
 */
export function planReleaseCacheCleanup({releaseDirectories, protectedDirectories}) {
  if (!Array.isArray(releaseDirectories) || !Array.isArray(protectedDirectories) ||
      releaseDirectories.some(value => typeof value !== 'string') ||
      protectedDirectories.some(value => !canonicalPosix(value)) ||
      new Set(releaseDirectories).size !== releaseDirectories.length) fail('plan_invalid');
  const eligible = [], excluded = [];
  for (const releaseDirectory of [...releaseDirectories].sort()) {
    const prefix = `${RELEASE_CACHE_ROOT}/`;
    if (!canonicalPosix(releaseDirectory) || !releaseDirectory.startsWith(prefix) ||
        !supported(releaseDirectory.slice(prefix.length).split('/'))) {
      excluded.push({releaseDirectory, reason: 'unsupported_release_directory'});
    } else if (protectedDirectories.some(value => overlaps(releaseDirectory, value))) {
      excluded.push({releaseDirectory, reason: 'protected_directory'});
    } else {
      eligible.push({releaseDirectory, cachePath: `${releaseDirectory}/.next/cache/webpack`});
    }
  }
  return freeze({eligible, excluded});
}

// Overrides exist only to exercise this library with owned temporary test trees.
// The production CLI must not expose or supply fs/root/owner overrides.
function settings(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options) ||
      Object.keys(options).some(key => !['fs', 'root', 'owner'].includes(key))) fail('options_invalid');
  const root = options.root ?? RELEASE_CACHE_ROOT, owner = options.owner ?? 0;
  if (typeof root !== 'string' || !path.isAbsolute(root) || path.normalize(root) !== root ||
      root === path.parse(root).root || !Number.isSafeInteger(owner) || owner < 0) fail('options_invalid');
  return {io: options.fs ?? nodeFs, root, owner};
}
function location(cachePath, root) {
  if (typeof cachePath !== 'string' || !path.isAbsolute(cachePath) || path.normalize(cachePath) !== cachePath ||
      /[\x00-\x1f\x7f]/.test(cachePath)) fail('path_not_allowed');
  const relative = path.relative(root, cachePath), parts = relative.split(path.sep);
  if (parts.length !== 5 || !supported(parts.slice(0, 2)) ||
      parts.slice(2).join('/') !== '.next/cache/webpack' || relative.startsWith(`..${path.sep}`)) fail('path_not_allowed');
  return {releaseDirectory: path.join(root, ...parts.slice(0, 2)), cachePath};
}
function observe(io, filename, owner, expectedDevice) {
  const stat = io.lstatSync(filename, {bigint: true});
  if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) fail('unsafe_entry');
  if (stat.uid !== BigInt(owner) || (stat.mode & 0o022n) !== 0n) fail('unsafe_ownership');
  if (stat.isFile() && stat.nlink !== 1n) fail('hardlink_rejected');
  if (expectedDevice !== undefined && stat.dev.toString() !== expectedDevice) fail('device_changed');
  if (stat.size < 0n || stat.size > BigInt(Number.MAX_SAFE_INTEGER)) fail('size_invalid');
  return {type: stat.isDirectory() ? 'directory' : 'file', dev: stat.dev.toString(), ino: stat.ino.toString(),
    mode: Number(stat.mode), uid: Number(stat.uid), nlink: Number(stat.nlink), size: Number(stat.size),
    mtimeNs: stat.mtimeNs.toString(), ctimeNs: stat.ctimeNs.toString()};
}
const identity = value => Object.fromEntries(['type', 'dev', 'ino', 'mode', 'uid'].map(key => [key, value[key]]));
function sameIdentity(actual, expected) {
  if (!isDeepStrictEqual(identity(actual), identity(expected))) fail('directory_identity_changed');
}
function parents(filename) {
  const result = [];
  for (let item = path.dirname(filename); ; item = path.dirname(item)) {
    result.unshift(item);
    if (item === path.dirname(item)) return result;
  }
}
function directory(io, filename, owner, device) {
  const value = observe(io, filename, owner, device);
  if (value.type !== 'directory') fail('directory_required');
  return value;
}
function digestFile(io, filename, expected, owner) {
  const fd = io.openSync(filename, nodeFs.constants.O_RDONLY | (nodeFs.constants.O_NOFOLLOW ?? 0));
  try {
    // Compare the opened object, not just the earlier pathname observation.
    const descriptorIo = {...io, lstatSync: () => io.fstatSync(fd, {bigint: true})};
    if (!isDeepStrictEqual(observe(descriptorIo, filename, owner, expected.dev), expected)) fail('file_changed');
    const hash = createHash('sha256'), buffer = Buffer.allocUnsafe(64 * 1024);
    let bytes = 0, count;
    while ((count = io.readSync(fd, buffer, 0, buffer.length, null)) !== 0) {
      bytes += count;
      if (bytes > expected.size) fail('file_changed');
      hash.update(buffer.subarray(0, count));
    }
    if (bytes !== expected.size || !isDeepStrictEqual(observe(descriptorIo, filename, owner, expected.dev), expected) ||
        !isDeepStrictEqual(observe(io, filename, owner, expected.dev), expected)) fail('file_changed');
    return hash.digest('hex');
  } finally { io.closeSync(fd); }
}
function readNames(io, filename) {
  const names = io.readdirSync(filename).sort();
  if (names.some(name => typeof name !== 'string' || !name || name === '.' || name === '..' ||
      /[/\\\x00-\x1f\x7f]/.test(name)) || new Set(names).size !== names.length) fail('entry_name_invalid');
  return names;
}
function safeOperation(fn) {
  try { return fn(); } catch (error) {
    if (typeof error?.message === 'string' && error.message.startsWith('online_cache_')) throw error;
    fail('filesystem_failure');
  }
}

/** Reads only the exact webpack subtree; ancestors are lstat'ed, never walked.
 * totalBytes (and apply's removedBytes) are logical file sizes, not a promise of
 * uniquely reclaimable disk blocks or of filesystem free-space growth.
 */
export function captureWebpackCache(cachePath, options = {}) {
  return safeOperation(() => {
    const {io, root, owner} = settings(options), loc = location(cachePath, root);
    let releaseDevice;
    const ancestors = parents(cachePath).map(filename => {
      const value = directory(io, filename, owner, releaseDevice);
      if (filename === loc.releaseDirectory) releaseDevice = value.dev;
      // Unrelated sibling activity may change ancestor mtime/ctime/size/nlink.
      // Bind only directory identity here; the cache itself remains fully pinned.
      return {path: filename, ...identity(value)};
    });
    const entries = [];
    let fileCount = 0, totalBytes = 0;
    function walk(filename, relativePath) {
      const before = observe(io, filename, owner, releaseDevice);
      if (!relativePath && before.type !== 'directory') fail('directory_required');
      if (before.type === 'file') {
        const sha256 = digestFile(io, filename, before, owner);
        entries.push({relativePath, ...before, sha256});
        fileCount++; totalBytes += before.size;
        if (!Number.isSafeInteger(totalBytes)) fail('size_invalid');
      } else {
        const names = readNames(io, filename);
        entries.push({relativePath, ...before});
        for (const name of names) walk(path.join(filename, name), relativePath ? `${relativePath}/${name}` : name);
        if (!isDeepStrictEqual(readNames(io, filename), names) ||
            !isDeepStrictEqual(observe(io, filename, owner, releaseDevice), before)) fail('tree_changed');
      }
    }
    walk(cachePath, '');
    for (const item of ancestors) sameIdentity(directory(io, item.path, owner), item);
    return freeze({version: 1, kind: 'webpack-cache', ...loc, ancestors, entries, fileCount, totalBytes});
  });
}

/** Synchronous, one-shot cleanup under caller-owned locks; never rm(recursive).
 * A late filesystem failure may leave a partially emptied cache. Do not retry
 * automatically: retain the failed audit and produce a newly approved plan.
 * This is not atomic against an uncooperative privileged filesystem writer.
 */
export function applyWebpackCacheCleanup(manifest, options = {}) {
  return safeOperation(() => {
    const {io, owner} = settings(options);
    if (!manifest || manifest.kind !== 'webpack-cache') fail('manifest_invalid');
    const fresh = captureWebpackCache(manifest.cachePath, options);
    if (!isDeepStrictEqual(fresh, manifest)) fail('manifest_changed');
    const directories = manifest.entries.filter(item => item.type === 'directory');
    const children = new Map(directories.map(item => [item.relativePath, []]));
    for (const item of manifest.entries) if (item.relativePath) {
      const parent = path.posix.dirname(item.relativePath);
      children.get(parent === '.' ? '' : parent).push(item.relativePath);
    }
    const removed = new Set();
    function checkDirectories() {
      for (const item of manifest.ancestors) sameIdentity(directory(io, item.path, owner), item);
      for (const item of directories) if (!removed.has(item.relativePath)) {
        sameIdentity(directory(io, path.join(manifest.cachePath, ...item.relativePath.split('/')), owner, item.dev), item);
      }
    }
    function checkNames() {
      checkDirectories();
      for (const item of directories) if (!removed.has(item.relativePath)) {
        const expected = children.get(item.relativePath).filter(name => !removed.has(name)).map(name => path.posix.basename(name)).sort();
        if (!isDeepStrictEqual(readNames(io, path.join(manifest.cachePath, ...item.relativePath.split('/'))), expected)) fail('tree_changed');
      }
    }
    let removedFiles = 0, removedDirectories = 0, removedBytes = 0;
    for (const item of manifest.entries.filter(entry => entry.type === 'file')) {
      checkNames();
      const filename = path.join(manifest.cachePath, ...item.relativePath.split('/'));
      const {relativePath, sha256, ...expected} = item;
      if (!isDeepStrictEqual(observe(io, filename, owner, item.dev), expected) ||
          digestFile(io, filename, expected, owner) !== sha256) fail('file_changed');
      checkDirectories();
      io.unlinkSync(filename); removed.add(relativePath);
      removedFiles++; removedBytes += item.size;
    }
    for (const item of [...directories].reverse()) if (item.relativePath) {
      checkNames();
      const filename = path.join(manifest.cachePath, ...item.relativePath.split('/'));
      if (readNames(io, filename).length) fail('directory_not_empty');
      io.rmdirSync(filename); removed.add(item.relativePath); removedDirectories++;
    }
    checkNames();
    if (readNames(io, manifest.cachePath).length) fail('directory_not_empty');
    return freeze({removedFiles, removedDirectories, removedBytes, cacheRootRetained: true});
  });
}
