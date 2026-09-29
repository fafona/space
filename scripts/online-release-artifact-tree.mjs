// Filesystem half of certified retired-release reclamation. The host caller must
// hold the deployment lock, certify no live/recovery references, and durably
// record its intent before apply. This module never changes process/release state.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';

const APP = '/www/wwwroot/merchant-space';
const KEEP = ['.gitignore', 'package.json', 'package-lock.json', 'PROJECT_RULES.md'];
const EXTRA = new Set(['.git', '.env.local', '.runtime', '.next', 'next-env.d.ts', 'node_modules']);
const check = (condition, message) => { if (!condition) throw Error(message); };
const same = (a, b, message) => check(isDeepStrictEqual(a, b), message);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => JSON.stringify(value);
const canonical = value => path.resolve(value).replaceAll('\\', '/');
const inside = (candidate, root) => candidate === root || candidate.startsWith(root === '/' ? '/' : root + '/');
const exists = filename => { try { fs.lstatSync(filename); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } };
const relativePath = (root, filename) => path.relative(root, filename).replaceAll('\\', '/');

function context(ports) {
  // An explicit fixture namespace permits real isolated Git integration tests on
  // Windows/unprivileged CI. Production has no CLI, environment or config bypass.
  const fixture = ports.fixture;
  if (fixture) {
    check(typeof fixture.root === 'string' && typeof fixture.app === 'string' &&
      canonical(fixture.root) === canonical(fs.realpathSync(fixture.root)) &&
      inside(canonical(fixture.app), canonical(fixture.root)) &&
      canonical(fixture.app) !== canonical(fixture.root), 'invalid_fixture_scope');
  } else check(process.platform === 'linux' && process.getuid() === 0, 'linux_root_required');
  const app = fixture ? canonical(fixture.app) : APP;
  const env = fixture ? Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))) :
    {PATH: '/usr/bin:/bin', HOME: '/root', LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8'};
  Object.assign(env, {GIT_OPTIONAL_LOCKS: '0', GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null', GIT_TERMINAL_PROMPT: '0'});
  return {app, releases: app + '.web-releases', runtime: app + '.shared/.runtime',
    boundary: fixture ? canonical(fixture.root) : '/', uid: fixture ? fs.lstatSync(fixture.root).uid : 0,
    gid: fixture ? fs.lstatSync(fixture.root).gid : 0,
    strictModes: !(fixture && process.platform === 'win32'),
    git(directory, args, input) {
      return execFileSync('git', ['-c', 'core.hooksPath=' + (process.platform === 'win32' ? 'NUL' : '/dev/null'),
        '-c', 'core.fsmonitor=false', '-c', 'core.autocrlf=false', '-c', 'core.eol=lf', '-C', directory, ...args],
      {encoding: 'utf8', env, input, windowsHide: true, maxBuffer: 32 * 1024 * 1024,
        timeout: 60000, stdio: ['pipe', 'pipe', 'pipe']});
    },
    beforeOperation: fixture ? ports.beforeOperation : undefined};
}

function safeStat(filename, ctx, device, {symlink = false, single = false} = {}) {
  const s = fs.lstatSync(filename);
  check(s.uid === ctx.uid && s.gid === ctx.gid && (device === undefined || s.dev === device), 'unsafe_owner_or_device:' + filename);
  check(s.isFile() || s.isDirectory() || (symlink && s.isSymbolicLink()), 'unsafe_type:' + filename);
  check(s.isSymbolicLink() || !ctx.strictModes || !(s.mode & 0o7022), 'unsafe_mode:' + filename);
  check(!single || !s.isFile() || s.nlink === 1, 'external_hardlink:' + filename);
  return s;
}

function safeAncestors(directory, ctx) {
  check(canonical(directory) === directory && inside(directory, ctx.boundary), 'noncanonical_directory');
  for (let p = directory; ; p = canonical(path.dirname(p))) {
    const s = safeStat(p, ctx);
    check(s.isDirectory() && canonical(fs.realpathSync(p)) === p, 'unsafe_directory:' + p);
    if (p === ctx.boundary) break;
    check(canonical(path.dirname(p)) !== p, 'outside_fixture_scope');
  }
}
function identity(s) { return {dev: s.dev, ino: s.ino, mode: s.mode, uid: s.uid, gid: s.gid}; }
function fact(s) { return {...identity(s), size: s.size, nlink: s.nlink, mtimeMs: s.mtimeMs, ctimeMs: s.ctimeMs}; }
function fileBytes(filename, ctx, device) {
  const before = safeStat(filename, ctx, device, {single: true});
  check(before.isFile(), 'regular_file_required:' + filename);
  const bytes = fs.readFileSync(filename);
  same(fact(fs.lstatSync(filename)), fact(before), 'file_changed_while_reading:' + filename);
  return {bytes, fact: fact(before)};
}

function worktreeIdentity(directory, target, ctx) {
  check(typeof target === 'string' && /^[a-f0-9]{40}$/.test(target), 'invalid_target');
  check(directory === ctx.releases + '/' + target.slice(0, 12) + '-online', 'outside_exact_retired_leaf');
  safeAncestors(directory, ctx); safeAncestors(ctx.app, ctx);
  const root = fs.lstatSync(directory);
  const dotGit = fileBytes(directory + '/.git', ctx, root.dev);
  const common = canonical(path.resolve(directory, ctx.git(directory, ['rev-parse', '--git-common-dir']).trim()));
  const absoluteGit = canonical(ctx.git(directory, ['rev-parse', '--absolute-git-dir']).trim());
  check(common === ctx.app + '/.git' && inside(absoluteGit, common + '/worktrees') &&
    absoluteGit !== common + '/worktrees', 'unexpected_git_common_directory');
  safeAncestors(absoluteGit, ctx);
  for (const filename of [common + '/config', absoluteGit + '/HEAD', absoluteGit + '/gitdir',
    absoluteGit + '/commondir', absoluteGit + '/index', absoluteGit + '/config.worktree']) {
    if (exists(filename)) fileBytes(filename, ctx);
  }
  check(dotGit.bytes.toString().trim() === 'gitdir: ' + absoluteGit ||
    (process.platform === 'win32' && dotGit.bytes.toString().trim().replaceAll('\\', '/') === 'gitdir: ' + absoluteGit), 'git_pointer_changed');
  check(canonical(ctx.git(directory, ['rev-parse', '--show-toplevel']).trim()) === directory, 'worktree_root_changed');
  check(ctx.git(directory, ['rev-parse', 'HEAD']).trim() === target, 'worktree_head_changed');
  const registrations = ctx.git(ctx.app, ['worktree', 'list', '--porcelain']).replaceAll('\r\n', '\n').split('\n\n').filter(Boolean).map(block => block.split('\n'));
  const records = registrations.filter(fields => fields[0]?.startsWith('worktree ') && canonical(fields[0].slice(9)) === directory);
  check(records.length === 1 && records[0].includes('HEAD ' + target) && records[0].includes('detached'), 'worktree_registration_changed');
  check(ctx.git(directory, ['status', '--porcelain=v1', '--untracked-files=normal']).trim() === '', 'worktree_dirty');
  ctx.git(ctx.app, ['merge-base', '--is-ancestor', target, 'origin/main']);
  return {root: identity(root), dotGitSha256: hash(dotGit.bytes), absoluteGit};
}

function sourceManifest(directory, target, ctx, rootDevice) {
  const entries = [], directories = new Set();
  for (const row of ctx.git(ctx.app, ['ls-tree', '-r', '-z', target]).split('\0').filter(Boolean)) {
    const match = row.match(/^(100644|100755) blob ([a-f0-9]{40})\t([^\x00-\x1f]+)$/);
    check(match, 'nonregular_git_source');
    const [, mode, oid, relative] = match;
    check(!relative.includes('\\') && canonical(directory + '/' + relative) === directory + '/' + relative &&
      inside(directory + '/' + relative, directory) && !EXTRA.has(relative.split('/')[0]), 'unsafe_source_path:' + relative);
    const value = fileBytes(directory + '/' + relative, ctx, rootDevice);
    check(createHash('sha1').update('blob ' + value.bytes.length + '\0').update(value.bytes).digest('hex') === oid, 'source_blob_changed:' + relative);
    check(!ctx.strictModes || Boolean(value.fact.mode & 0o111) === (mode === '100755'), 'source_mode_changed:' + relative);
    entries.push({relative, mode, oid, fact: value.fact});
    for (let parent = path.posix.dirname(relative); parent !== '.'; parent = path.posix.dirname(parent)) directories.add(parent);
  }
  for (const name of KEEP) check(entries.some(entry => entry.relative === name), 'missing_retained_source:' + name);
  const known = new Set(entries.map(entry => entry.relative));
  function scan(parent) {
    for (const name of fs.readdirSync(parent).sort()) {
      const filename = parent + '/' + name, relative = relativePath(directory, filename);
      if (EXTRA.has(relative)) continue;
      const s = safeStat(filename, ctx, rootDevice, {single: true});
      if (s.isDirectory()) { check(directories.has(relative), 'unknown_extra_directory:' + relative); scan(filename); }
      else check(s.isFile() && known.has(relative), 'unknown_extra_file:' + relative);
    }
  }
  scan(directory);
  return {tree: ctx.git(ctx.app, ['rev-parse', target + '^{tree}']).trim(), reachableFrom: 'origin/main',
    entries, manifestSha256: hash(json(entries.map(({relative, mode, oid}) => ({relative, mode, oid}))))};
}

function generatedTree(directory, ctx, rootDevice) {
  if (!exists(directory)) return {proof: null, entries: []};
  safeAncestors(directory, ctx);
  const device = fs.lstatSync(directory).dev, entries = [], inodes = new Map(); let allocatedBytes = 0;
  check(rootDevice === undefined || device === rootDevice, 'generated_root_device_changed');
  function walk(filename) {
    const s = safeStat(filename, ctx, device, {symlink: true});
    const relative = relativePath(directory, filename), link = s.isSymbolicLink() ? fs.readlinkSync(filename) : null;
    if (link !== null) {
      const destination = canonical(path.resolve(path.dirname(filename), link));
      check(inside(destination, directory), 'external_generated_symlink:' + relative);
      // lstat traversal never follows the link; a chain may not escape either.
      check(inside(canonical(fs.realpathSync(filename)), directory), 'external_generated_symlink_chain:' + relative);
    }
    const key = s.dev + ':' + s.ino;
    if (!s.isDirectory()) { const n = inodes.get(key) ?? {count: 0, nlink: s.nlink}; n.count++; inodes.set(key, n); }
    if (s.isDirectory() || inodes.get(key).count === 1) allocatedBytes += process.platform !== 'win32' && Number.isFinite(s.blocks) ? s.blocks * 512 : s.size;
    entries.push({relative, type: s.isDirectory() ? 'directory' : s.isSymbolicLink() ? 'symlink' : 'file', fact: fact(s), link});
    if (s.isDirectory()) for (const name of fs.readdirSync(filename).sort()) walk(filename + '/' + name);
  }
  walk(directory);
  for (const inode of inodes.values()) check(inode.count === inode.nlink, 'external_hardlink:' + directory);
  return {proof: {sha256: hash(json(entries)), entries: entries.length, allocatedBytes, root: identity(fs.lstatSync(directory))}, entries};
}

function preservedTree(directory, ctx) {
  const digest = createHash('sha256'); let entries = 0;
  const device = fs.lstatSync(directory).dev;
  function visit(filename) {
    const relative = relativePath(directory, filename);
    if (relative === '.next/cache/webpack') return;
    const s = safeStat(filename, ctx, device, {symlink: true, single: true});
    digest.update(json([relative, identity(s)])); entries++;
    if (s.isSymbolicLink()) {
      const link = fs.readlinkSync(filename), destination = canonical(path.resolve(path.dirname(filename), link));
      if (relative === '.runtime') check(destination === ctx.runtime, 'unexpected_runtime_link');
      else check(inside(destination, directory + '/.next') && !inside(destination, directory + '/.next/cache/webpack') &&
        inside(canonical(fs.realpathSync(filename)), directory + '/.next'), 'unsafe_preserved_link:' + relative);
      digest.update(link);
    } else if (s.isDirectory()) {
      check(relative.startsWith('.next'), 'unexpected_preserved_directory:' + relative);
      for (const name of fs.readdirSync(filename).sort()) visit(filename + '/' + name);
    } else digest.update(fileBytes(filename, ctx, device).bytes);
  }
  for (const name of ['.env.local', '.next', '.runtime', 'next-env.d.ts']) if (exists(directory + '/' + name)) {
    const s = fs.lstatSync(directory + '/' + name);
    check(name !== '.runtime' || s.isSymbolicLink(), 'runtime_must_be_link');
    check(name !== '.next' || (s.isDirectory() && !s.isSymbolicLink()), 'next_must_be_directory');
    check(!['.env.local', 'next-env.d.ts'].includes(name) || s.isFile(), 'preserved_regular_file_required');
    visit(directory + '/' + name);
  }
  return {sha256: digest.digest('hex'), entries};
}

export function captureRetiredArtifactTree(directory, target, ports = {}) {
  const ctx = context(ports), registration = worktreeIdentity(directory, target, ctx);
  // Recovery/static material is mandatory, not an optional ignored extra. Check
  // its directory chain before any read so a replaced .next cannot redirect it.
  safeAncestors(directory + '/.next', ctx);
  for (const relative of ['.env.local', '.next/BUILD_ID']) {
    check(exists(directory + '/' + relative), 'missing_required_recovery_file:' + relative);
    fileBytes(directory + '/' + relative, ctx, registration.root.dev);
  }
  const source = sourceManifest(directory, target, ctx, registration.root.dev);
  const dependencies = generatedTree(directory + '/node_modules', ctx, registration.root.dev).proof;
  check(dependencies, 'missing_dependencies_or_already_reclaimed');
  const webpack = generatedTree(directory + '/.next/cache/webpack', ctx, registration.root.dev).proof;
  const preserved = preservedTree(directory, ctx);
  same(identity(fs.lstatSync(directory)), registration.root, 'root_changed_during_capture');
  return {version: 1, directory, target, rootIdentity: registration.root, dotGitSha256: registration.dotGitSha256,
    source, generated: {dependencies, webpack}, preserved};
}

function removeGeneratedTree(directory, expected, ctx) {
  const current = generatedTree(directory, ctx, expected?.root.dev);
  same(current.proof, expected, 'generated_tree_drift:' + directory);
  if (!expected) return;
  const removedLinks = new Map();
  // Root has depth 0 (not 1), and is always removed after its children.
  const ordered = [...current.entries].sort((a, b) =>
    (b.relative ? b.relative.split('/').length : 0) - (a.relative ? a.relative.split('/').length : 0) || b.relative.localeCompare(a.relative));
  for (const entry of ordered) {
    const filename = entry.relative ? directory + '/' + entry.relative : directory;
    ctx.beforeOperation?.({operation: entry.type === 'directory' ? 'rmdir' : 'unlink', path: filename});
    safeAncestors(canonical(path.dirname(filename)), ctx);
    const s = safeStat(filename, ctx, expected.root.dev, {symlink: true});
    same(identity(s), identity(entry.fact), 'generated_entry_identity_drift:' + filename);
    if (entry.type === 'directory') {
      check(s.isDirectory() && fs.readdirSync(filename).length === 0, 'generated_directory_not_empty:' + filename);
      fs.rmdirSync(filename);
    } else {
      const key = s.dev + ':' + s.ino, removed = removedLinks.get(key) ?? 0;
      check(s.size === entry.fact.size && s.mtimeMs === entry.fact.mtimeMs && s.nlink === entry.fact.nlink - removed &&
        (removed > 0 || s.ctimeMs === entry.fact.ctimeMs), 'generated_entry_drift:' + filename);
      if (entry.type === 'symlink') check(s.isSymbolicLink() && fs.readlinkSync(filename) === entry.link, 'generated_link_drift');
      else check(s.isFile(), 'generated_file_type_drift');
      fs.unlinkSync(filename); removedLinks.set(key, removed + 1);
    }
  }
}

export function applyRetiredArtifactTree(plan, ports = {}) {
  check(plan?.version === 1, 'invalid_artifact_plan');
  const ctx = context(ports);
  same(captureRetiredArtifactTree(plan.directory, plan.target, ports), plan, 'retired_artifact_plan_drift');
  for (const [suffix, proof] of [['node_modules', plan.generated.dependencies], ['.next/cache/webpack', plan.generated.webpack]]) {
    removeGeneratedTree(plan.directory + '/' + suffix, proof, ctx);
  }
  // Recheck every tracked source byte immediately before asking Git to remove it.
  same(sourceManifest(plan.directory, plan.target, ctx, plan.rootIdentity.dev), plan.source, 'source_changed_before_sparse');
  same(preservedTree(plan.directory, ctx), plan.preserved, 'preserved_changed_before_sparse');
  ctx.beforeOperation?.({operation: 'sparse-checkout', path: plan.directory});
  ctx.git(plan.directory, ['-c', 'index.sparse=false', 'sparse-checkout', 'set', '--no-cone', '--stdin'], KEEP.map(name => '/' + name).join('\n') + '\n');
  ctx.git(plan.directory, ['config', '--worktree', 'core.sparseCheckoutCone', 'false']);
  ctx.git(plan.directory, ['config', '--worktree', 'index.sparse', 'false']);
  worktreeIdentity(plan.directory, plan.target, ctx);
  same(identity(fs.lstatSync(plan.directory)), plan.rootIdentity, 'retained_root_changed');
  check(hash(fileBytes(plan.directory + '/.git', ctx, plan.rootIdentity.dev).bytes) === plan.dotGitSha256, 'git_pointer_changed');
  same(preservedTree(plan.directory, ctx), plan.preserved, 'preserved_bytes_changed');
  for (const entry of plan.source.entries) {
    const filename = plan.directory + '/' + entry.relative;
    if (KEEP.includes(entry.relative)) {
      const value = fileBytes(filename, ctx, plan.rootIdentity.dev);
      check(createHash('sha1').update('blob ' + value.bytes.length + '\0').update(value.bytes).digest('hex') === entry.oid, 'retained_source_changed');
    } else check(!exists(filename), 'source_not_reclaimed:' + entry.relative);
  }
  for (const suffix of ['node_modules', '.next/cache/webpack']) check(!exists(plan.directory + '/' + suffix), 'generated_tree_not_removed');
  return {directory: plan.directory, target: plan.target, preservedSha256: plan.preserved.sha256,
    sourceManifestSha256: plan.source.manifestSha256,
    removedAllocatedBytes: plan.generated.dependencies.allocatedBytes + (plan.generated.webpack?.allocatedBytes ?? 0),
    instantRollback: false};
}
