import * as fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const CLOCK_ALLOWANCE_MS = 5000;
const MAX_WINDOW_MS = 60 * 60 * 1000;
const MAX_ENTRIES = 100000;
const MAX_FILE_BYTES = 256 * 1024 * 1024;
const PUBLIC_EXTENSION = /\.(?:js|css|json|map|txt|woff2?|ttf|otf|eot|svg|png|jpe?g|gif|webp|avif|ico|wasm)$/i;
const digest = (value) => createHash('sha256').update(value).digest('hex');
const stable = (value) => JSON.stringify(value);
function fail(code) { throw new Error(`static_permission_recovery:${code}`); }
function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
function canonicalRoot(value) {
  if (typeof value !== 'string' || value !== value.trim() || !value.startsWith('/') ||
      value === '/' || value.includes('\\') || /[\x00-\x1f\x7f]/.test(value) ||
      path.posix.normalize(value) !== value || !value.endsWith('/.next/static')) fail('invalid_root');
  return value;
}
function time(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)) fail('invalid_window');
  const parsed = Date.parse(value);
  if (!Number.isSafeInteger(parsed) || new Date(parsed).toISOString() !== value) fail('invalid_window');
  return parsed;
}
function integer(value, field) {
  if (typeof value === 'bigint' && value >= 0n) return value.toString();
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return String(value);
  fail(`invalid_stat_${field}`);
}
function identity(stat, absolutePath) {
  if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) fail('unsafe_entry_type');
  const type = stat.isDirectory() ? 'directory' : 'file';
  const uid = integer(stat.uid, 'uid');
  const gid = integer(stat.gid, 'gid');
  const nlink = integer(stat.nlink, 'nlink');
  if (uid !== '0') fail('non_root_owner');
  // A POSIX directory normally has two or more links; its exact count is pinned.
  if (type === 'file' && nlink !== '1') fail('hardlinked_file');
  const fullMode = Number(integer(stat.mode, 'mode'));
  if ((fullMode & 0o7000) !== 0) fail('special_mode');
  if (type === 'directory' && (fullMode & 0o022) !== 0) fail('writable_directory');
  return {
    path: absolutePath, type, dev: integer(stat.dev, 'dev'), ino: integer(stat.ino, 'ino'),
    nlink, mode: fullMode & 0o777, uid, gid, size: integer(stat.size, 'size'),
    ctimeNs: integer(stat.ctimeNs, 'ctime'), birthtimeNs: integer(stat.birthtimeNs, 'birthtime'),
    mtimeNs: integer(stat.mtimeNs, 'mtime'),
  };
}
function makeIO(adapter) {
  if (adapter === undefined && (process.platform !== 'linux' || process.getuid?.() !== 0)) fail('linux_root_required');
  const io = adapter ?? { ...fs, platform: process.platform, getuid: () => process.getuid() };
  if (io.platform !== 'linux' || io.getuid?.() !== 0) fail('linux_root_required');
  for (const name of ['lstatSync', 'readdirSync', 'openSync', 'closeSync', 'fstatSync', 'readSync', 'fchmodSync']) {
    if (typeof io[name] !== 'function') fail('invalid_adapter');
  }
  for (const name of ['O_RDONLY', 'O_NOFOLLOW', 'O_NONBLOCK', 'O_DIRECTORY']) {
    if (!Number.isInteger(io.constants?.[name])) fail('unsafe_open_flags');
  }
  return io;
}
function hashDescriptor(io, fd, size) {
  if (BigInt(size) > BigInt(MAX_FILE_BYTES)) fail('file_too_large');
  const hash = createHash('sha256');
  const buffer = Buffer.alloc(64 * 1024);
  let position = 0;
  while (true) {
    const count = io.readSync(fd, buffer, 0, buffer.length, position);
    if (!Number.isInteger(count) || count < 0 || count > buffer.length || position + count > MAX_FILE_BYTES) fail('invalid_read');
    if (!count) break;
    hash.update(buffer.subarray(0, count));
    position += count;
  }
  if (BigInt(position) !== BigInt(size)) fail('size_drift');
  return hash.digest('hex');
}
function openVerified(io, expected) {
  const flags = io.constants.O_RDONLY | io.constants.O_NOFOLLOW | io.constants.O_NONBLOCK |
    (expected.type === 'directory' ? io.constants.O_DIRECTORY : 0);
  const fd = io.openSync(expected.path, flags);
  try {
    if (stable(identity(io.fstatSync(fd, { bigint: true }), expected.path)) !== stable(expected)) fail('open_identity_drift');
    return fd;
  } catch (error) { io.closeSync(fd); throw error; }
}
function observe(io, absolutePath) {
  const before = identity(io.lstatSync(absolutePath, { bigint: true }), absolutePath);
  const fd = openVerified(io, before);
  try {
    const sha256 = before.type === 'file' ? hashDescriptor(io, fd, before.size) : undefined;
    if (stable(identity(io.fstatSync(fd, { bigint: true }), absolutePath)) !== stable(before) ||
        stable(identity(io.lstatSync(absolutePath, { bigint: true }), absolutePath)) !== stable(before)) fail('observation_drift');
    return { ...before, ...(sha256 ? { sha256 } : {}) };
  } finally { io.closeSync(fd); }
}
function collect(io, roots) {
  const ancestors = new Map();
  const trees = new Map();
  let entryCount = 0;
  for (const root of roots) {
    let ancestor = path.posix.dirname(root);
    while (true) {
      if (!ancestors.has(ancestor)) {
        const entry = observe(io, ancestor);
        if (entry.type !== 'directory') fail('ancestor_not_directory');
        ancestors.set(ancestor, entry);
      }
      if (ancestor === '/') break;
      ancestor = path.posix.dirname(ancestor);
    }
    const entries = new Map();
    function walk(absolutePath, relativePath) {
      if (++entryCount > MAX_ENTRIES) fail('too_many_entries');
      const observed = observe(io, absolutePath);
      if (observed.type === 'directory') {
        const names = io.readdirSync(absolutePath).sort();
        const children = [];
        for (const name of names) {
          if (typeof name !== 'string' || !name || name.startsWith('.') || /[\\/\x00-\x1f\x7f]/.test(name)) fail('unsafe_relative_path');
          const relative = relativePath ? `${relativePath}/${name}` : name;
          const child = walk(`${absolutePath}/${name}`, relative);
          children.push([name, child.type, child.sha256]);
        }
        if (stable(identity(io.lstatSync(absolutePath, { bigint: true }), absolutePath)) !== stable(observed)) fail('directory_drift');
        observed.sha256 = digest(stable(children));
      }
      const entry = { ...observed, relativePath };
      entries.set(relativePath, entry);
      return entry;
    }
    const rootEntry = walk(root, '');
    if (rootEntry.type !== 'directory') fail('root_not_directory');
    trees.set(root, entries);
  }
  return {
    ancestors: [...ancestors.values()].sort((a, b) => a.path.localeCompare(b.path)),
    trees: roots.map((root) => ({ root, entries: [...trees.get(root).values()].sort((a, b) => a.relativePath.localeCompare(b.relativePath)) })),
  };
}
function core(entry) {
  return omit(entry, ['sha256', 'relativePath', 'toMode']);
}
function omit(entry, fields) {
  const result = { ...entry };
  for (const field of fields) delete result[field];
  return result;
}
function withinWindow(entry, start, end) {
  const low = BigInt(start) * 1000000n;
  const high = BigInt(end + CLOCK_ALLOWANCE_MS) * 1000000n;
  return BigInt(entry.birthtimeNs) > 0n && BigInt(entry.birthtimeNs) >= low && BigInt(entry.birthtimeNs) <= high &&
    BigInt(entry.ctimeNs) >= low && BigInt(entry.ctimeNs) <= high;
}

/** No writes occur while planning. This helper has no CLI and never discovers private files. */
export function planStaticPermissionRecovery({ sourceRoot, destinationRoot, previousRoots, startedAt, rolledBackAt, fsAdapter } = {}) {
  const io = makeIO(fsAdapter);
  sourceRoot = canonicalRoot(sourceRoot);
  destinationRoot = canonicalRoot(destinationRoot);
  if (!Array.isArray(previousRoots) || previousRoots.length < 1 || previousRoots.length > 64) fail('invalid_previous_roots');
  previousRoots = previousRoots.map(canonicalRoot);
  const roots = [sourceRoot, destinationRoot, ...previousRoots];
  if (new Set(roots).size !== roots.length || roots.some((a) => roots.some((b) => a !== b && a.startsWith(`${b}/`)))) fail('overlapping_roots');
  const start = time(startedAt); const end = time(rolledBackAt);
  if (end < start || end - start > MAX_WINDOW_MS) fail('invalid_window');
  const snapshot = collect(io, roots);
  const source = new Map(snapshot.trees[0].entries.map((entry) => [entry.relativePath, entry]));
  const destination = new Map(snapshot.trees[1].entries.map((entry) => [entry.relativePath, entry]));
  const previous = snapshot.trees.slice(2).map((tree) => new Map(tree.entries.map((entry) => [entry.relativePath, entry])));
  const isNew = (entry) => withinWindow(entry, start, end) && previous.every((tree) => !tree.has(entry.relativePath));
  if (destination.get('').mode !== 0o755) fail('destination_root_not_public');
  // This recovery is only for a completed copy. It never creates missing assets
  // and verifies public 0644 candidate assets as rigorously as the private ones.
  for (const candidate of source.values()) {
    if (candidate.type !== 'file') continue;
    const copied = destination.get(candidate.relativePath);
    if (!copied || copied.type !== 'file') fail('candidate_copy_incomplete');
    if (copied.sha256 !== candidate.sha256) fail('candidate_content_mismatch');
  }
  const files = [];
  const neededDirectories = new Set();
  for (const entry of destination.values()) {
    if (entry.type !== 'file') continue;
    if (entry.mode === 0o644) continue;
    if (entry.mode !== 0o600 || !PUBLIC_EXTENSION.test(entry.relativePath) || !isNew(entry)) fail('unowned_private_file');
    const candidate = source.get(entry.relativePath);
    if (!candidate || candidate.type !== 'file' || candidate.sha256 !== entry.sha256) fail('candidate_content_mismatch');
    files.push({ ...entry, toMode: 0o644 });
    let relative = path.posix.dirname(entry.relativePath);
    while (relative !== '.') { neededDirectories.add(relative); relative = path.posix.dirname(relative); }
  }
  const directories = [];
  for (const entry of destination.values()) {
    if (entry.type !== 'directory' || !entry.relativePath || entry.mode === 0o755) continue;
    const candidate = source.get(entry.relativePath);
    if (entry.mode !== 0o700 || !neededDirectories.has(entry.relativePath) || !candidate || candidate.type !== 'directory' || !isNew(entry)) fail('unowned_private_directory');
    directories.push({ ...entry, toMode: 0o755 });
  }
  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  directories.sort((a, b) => b.relativePath.split('/').length - a.relativePath.split('/').length || a.relativePath.localeCompare(b.relativePath));
  const manifest = freeze({ version: 1, sourceRoot, destinationRoot, previousRoots: [...previousRoots], startedAt, rolledBackAt,
    clockAllowanceMs: CLOCK_ALLOWANCE_MS, inventorySha256: digest(stable(snapshot)), files, directories });
  const manifestSha256 = digest(stable(manifest));
  let applied = false;
  function apply() {
    if (applied) fail('plan_already_used');
    applied = true;
    const opened = [];
    const changed = [];
    try {
      if (stable(collect(io, roots)) !== stable(snapshot)) fail('manifest_drift');
      for (const entry of [...files, ...directories]) {
        const fd = openVerified(io, core(entry));
        opened.push({ entry, fd });
        if (entry.type === 'file' && hashDescriptor(io, fd, entry.size) !== entry.sha256) fail('descriptor_content_drift');
      }
      // Revalidate all roots, ancestors and entries after pinning every target descriptor.
      if (stable(collect(io, roots)) !== stable(snapshot)) fail('manifest_drift');
      for (const { entry, fd } of opened) {
        if (stable(identity(io.fstatSync(fd, { bigint: true }), entry.path)) !== stable(core(entry)) ||
            stable(identity(io.lstatSync(entry.path, { bigint: true }), entry.path)) !== stable(core(entry))) fail('apply_identity_drift');
        if (entry.type === 'file' && hashDescriptor(io, fd, entry.size) !== entry.sha256) fail('descriptor_content_drift');
        io.fchmodSync(fd, entry.toMode);
        changed.push(entry.path);
        const after = identity(io.fstatSync(fd, { bigint: true }), entry.path);
        const beforeStable = omit(core(entry), ['ctimeNs', 'mode']);
        const afterStable = omit(after, ['ctimeNs', 'mode']);
        if (after.mode !== entry.toMode || stable(afterStable) !== stable(beforeStable) ||
            stable(identity(io.lstatSync(entry.path, { bigint: true }), entry.path)) !== stable(after)) fail('chmod_identity_drift');
        if (entry.type === 'file' && hashDescriptor(io, fd, entry.size) !== entry.sha256) fail('chmod_content_drift');
      }
      const afterSnapshot = collect(io, roots);
      const changedModes = new Map([...files, ...directories].map((entry) => [entry.path, entry.toMode]));
      for (let index = 0; index < snapshot.trees.length; index++) {
        const expected = snapshot.trees[index].entries;
        const actual = afterSnapshot.trees[index].entries;
        if (expected.length !== actual.length) fail('post_apply_inventory_drift');
        for (let row = 0; row < expected.length; row++) {
          const before = expected[row]; const after = actual[row];
          if (changedModes.has(before.path)) {
            const beforeStable = omit(before, ['ctimeNs', 'mode']);
            const afterStable = omit(after, ['ctimeNs', 'mode']);
            if (after.mode !== changedModes.get(before.path) || stable(beforeStable) !== stable(afterStable)) fail('post_apply_inventory_drift');
          } else if (stable(before) !== stable(after)) fail('post_apply_inventory_drift');
        }
      }
      if (stable(snapshot.ancestors) !== stable(afterSnapshot.ancestors)) fail('post_apply_ancestor_drift');
      return freeze({ ok: true, manifestSha256, changedFiles: files.length, changedDirectories: directories.length,
        changed: [...files, ...directories].map((entry) => ({ path: entry.path, fromMode: entry.mode, toMode: entry.toMode, sha256: entry.sha256, dev: entry.dev, ino: entry.ino, uid: entry.uid, gid: entry.gid })),
        afterInventorySha256: digest(stable(afterSnapshot)) });
    } catch (error) {
      const failure = new Error(error instanceof Error ? error.message : 'static_permission_recovery:apply_failed', { cause: error });
      failure.changedPaths = Object.freeze([...changed]);
      throw failure;
    } finally { for (const { fd } of opened) io.closeSync(fd); }
  }
  return Object.freeze({ manifest, manifestSha256, apply });
}
