import * as fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const APP = '/www/wwwroot/merchant-space';
const TOOL_ROOT = '/var/lib/faolla-online-code';
const MAINTENANCE = '/var/lib/faolla-maintenance/merchant-space';
const RELEASE_ROOT = '/var/lib/faolla-online-release';
const SELF = 'scripts/prepare-online-release-tool.mjs';
const SHA = /^[a-f0-9]{40}$/;
export const TOOL_SPARSE_PATTERNS = '/*\n!/public/downloads/\n';
export const TOOL_REQUIRED_FILES = Object.freeze([
  SELF, 'scripts/online-traffic-release.mjs', 'scripts/online-traffic-release-policy.mjs',
  'scripts/online-release-rolling.mjs', 'scripts/online-release-rolling-policy.mjs',
  'scripts/online-release-retirement.mjs', 'scripts/online-release-retirement-policy.mjs',
  'scripts/web-presentation-release-policy.mjs', 'scripts/contact-card-release-policy.mjs',
  'scripts/online-static-recovery.mjs', 'scripts/apply-production-database-migrations.mjs',
  'scripts/check-database-backup-readiness.mjs', 'scripts/check-supabase-migrations.mjs',
  'scripts/create-production-database-backup.mjs', 'scripts/verify-production-database-backup.mjs',
  'scripts/database-backup-contract.mjs', 'scripts/database-recovery-content-contract.mjs',
  'scripts/ordinary-account-identity-content-contract.mjs', 'scripts/production-release-attestation.mjs',
  'package.json', 'package-lock.json',
]);
const fail = code => { throw Error(`online_tool_${code}`); };
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const blobId = bytes => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
const excluded = name => name === 'public/downloads' || name.startsWith('public/downloads/');
const exists = name => { try { fs.lstatSync(name); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } };

function canonicalAbsolute(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || path.resolve(value) !== value || /[\r\n\0]/.test(value)) fail('path_invalid');
  return value;
}
export function createOnlineReleaseToolPlan(target, roots = {}) {
  if (typeof target !== 'string' || target.length !== 40 || !SHA.test(target) || Object.keys(roots).some(key => !['app', 'toolRoot'].includes(key))) fail('invocation_invalid');
  const app = canonicalAbsolute(roots.app ?? APP), toolRoot = canonicalAbsolute(roots.toolRoot ?? TOOL_ROOT);
  if (app === toolRoot || app.startsWith(toolRoot + path.sep) || toolRoot.startsWith(app + path.sep)) fail('roots_overlap');
  return Object.freeze({version: 1, target, app, toolRoot, directory: path.join(toolRoot, target), sparsePatterns: TOOL_SPARSE_PATTERNS});
}

// Used only for fixed production paths. Tests inject an explicit fixture-only
// path checker; the CLI has no path/owner/permission override switches.
export function assertOnlineToolOwnedPath(location, kind = 'directory', io = fs) {
  canonicalAbsolute(location);
  let current = location;
  while (true) {
    const value = io.lstatSync(current);
    const expectedDirectory = current !== location || kind === 'directory';
    if (value.isSymbolicLink() || !(expectedDirectory ? value.isDirectory() : value.isFile()) ||
        value.uid !== 0 || (value.mode & 0o022) || (!expectedDirectory && value.nlink !== 1) ||
        io.realpathSync(current) !== current) fail('unsafe_path');
    const parent = path.dirname(current); if (parent === current) break; current = parent;
  }
}

function gitEnvironment() {
  // Do not inherit GIT_DIR, GIT_WORK_TREE, config injection, credential helpers
  // or caller SSH commands. No command in this tool contacts a remote.
  return {PATH: '/usr/bin:/bin', HOME: '/root', LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8',
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0'};
}
export function runOnlineToolGit(cwd, args, input) {
  const result = spawnSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-c', 'core.autocrlf=false', '-c', 'core.eol=lf', ...args], {
    cwd, input, env: gitEnvironment(), timeout: 120000, maxBuffer: 32 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
  });
  if (result.status !== 0 || result.error || result.signal) fail('git_failed');
  return result.stdout;
}
const text = value => Buffer.isBuffer(value) ? value.toString('utf8') : String(value);

export function readOnlineToolInventory(plan, git = runOnlineToolGit) {
  const rows = text(git(plan.app, ['ls-tree', '-rz', '--full-tree', plan.target])).split('\0').filter(Boolean);
  const seen = new Set();
  const inventory = rows.map(row => {
    const match = /^(100644|100755) blob ([a-f0-9]{40})\t([^\0]+)$/.exec(row);
    if (!match) fail('source_entry_invalid');
    const [, mode, oid, name] = match;
    if (name.startsWith('/') || name.includes('\\') || /[\r\n]/.test(name) ||
        name.split('/').some(part => !part || part === '.' || part === '..') || seen.has(name)) fail('source_path_invalid');
    seen.add(name); return Object.freeze({mode, oid, name, excluded: excluded(name)});
  });
  if (!inventory.length || TOOL_REQUIRED_FILES.some(name => !seen.has(name))) fail('source_incomplete');
  return Object.freeze(inventory);
}

function validateTarget(plan, git) {
  if (text(git(plan.app, ['rev-parse', 'origin/main'])).trim() !== plan.target ||
      text(git(plan.app, ['rev-parse', `${plan.target}^{commit}`])).trim() !== plan.target) fail('target_not_main');
}
export function verifyOnlineReleaseTool(plan, {git = runOnlineToolGit, checkPath = assertOnlineToolOwnedPath} = {}) {
  const expected = createOnlineReleaseToolPlan(plan.target, {app: plan.app, toolRoot: plan.toolRoot});
  if (JSON.stringify(plan) !== JSON.stringify(expected)) fail('plan_changed');
  checkPath(plan.app); checkPath(plan.toolRoot); checkPath(plan.directory);
  validateTarget(plan, git);
  if (text(git(plan.directory, ['rev-parse', 'HEAD'])).trim() !== plan.target) fail('source_head_changed');
  if (path.resolve(text(git(plan.directory, ['rev-parse', '--show-toplevel'])).trim()) !== plan.directory) fail('source_directory_changed');
  if (text(git(plan.directory, ['status', '--porcelain=v1', '--untracked-files=all'])).trim()) fail('source_dirty');
  // An unborn/symbolic HEAD is not a detached immutable tool checkout.
  const head = path.resolve(plan.directory, text(git(plan.directory, ['rev-parse', '--git-path', 'HEAD'])).trim());
  checkPath(head, 'file');
  if (fs.readFileSync(head, 'utf8').trim() !== plan.target) fail('head_not_detached');
  for (const [name, expectedValue] of [['core.sparseCheckout', 'true'], ['core.sparseCheckoutCone', 'false'], ['index.sparse', 'false']]) {
    if (text(git(plan.directory, ['config', '--worktree', '--get', name])).trim() !== expectedValue) fail('sparse_config_changed');
  }
  const patternFile = path.resolve(plan.directory, text(git(plan.directory, ['rev-parse', '--git-path', 'info/sparse-checkout'])).trim());
  checkPath(patternFile, 'file');
  if (fs.readFileSync(patternFile, 'utf8') !== TOOL_SPARSE_PATTERNS || exists(path.join(plan.directory, 'public/downloads'))) fail('sparse_patterns_changed');
  const inventory = readOnlineToolInventory(plan, git);
  const indexed = text(git(plan.directory, ['ls-files', '-t', '-z'])).split('\0').filter(Boolean);
  const expectedIndex = inventory.map(item => `${item.excluded ? 'S' : 'H'} ${item.name}`).sort();
  if (JSON.stringify(indexed.sort()) !== JSON.stringify(expectedIndex)) fail('index_changed');
  for (const item of inventory) {
    if (item.excluded) continue;
    const file = path.join(plan.directory, ...item.name.split('/')); checkPath(file, 'file');
    if (blobId(fs.readFileSync(file)) !== item.oid) fail('source_blob_changed');
  }
  // Ignored artifacts can hide from git status. A source-only tool may contain
  // exactly tracked files/directories and the worktree's .git pointer.
  const allowed = new Set(['.git']);
  for (const {name, excluded: skip} of inventory) if (!skip) {
    const parts = name.split('/'); while (parts.length) {allowed.add(parts.join('/')); parts.pop();}
  }
  function walk(directory, prefix = '') {
    for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
      const name = prefix + entry.name;
      if (!allowed.has(name) || entry.isSymbolicLink()) fail('unexpected_tool_entry');
      const file = path.join(directory, entry.name);
      checkPath(file, entry.isDirectory() ? 'directory' : 'file');
      if (entry.isDirectory()) walk(file, name + '/');
    }
  }
  walk(plan.directory);
  validateTarget(plan, git);
  return Object.freeze({version: 1, target: plan.target, directory: plan.directory, sourceFiles: inventory.filter(item => !item.excluded).length,
    excludedFiles: inventory.filter(item => item.excluded).length, inventorySha256: sha256(JSON.stringify(inventory)), verified: true});
}

export function executeOnlineReleaseToolPlan(plan, ports = {}) {
  const {git = runOnlineToolGit, checkPath = assertOnlineToolOwnedPath} = ports;
  const expected = createOnlineReleaseToolPlan(plan.target, {app: plan.app, toolRoot: plan.toolRoot});
  if (JSON.stringify(plan) !== JSON.stringify(expected)) fail('plan_changed');
  checkPath(plan.app); checkPath(plan.toolRoot); validateTarget(plan, git);
  readOnlineToolInventory(plan, git); // Reject links/submodules before checkout.
  if (exists(plan.directory)) return {...verifyOnlineReleaseTool(plan, ports), created: false};
  // No force/reset/repair and no deletion on failure. An incomplete checkout is
  // evidence and subsequent calls must verify it, never overwrite it.
  git(plan.app, ['worktree', 'add', '--detach', '--no-checkout', plan.directory, plan.target]);
  checkPath(plan.directory);
  // Git 2.27 has sparse-checkout but predates the --no-sparse-index option.
  git(plan.directory, ['-c', 'index.sparse=false', 'sparse-checkout', 'set', '--no-cone', '--stdin'], TOOL_SPARSE_PATTERNS);
  // That version also leaves --no-cone implicit; persist it for strict verify.
  git(plan.directory, ['config', '--worktree', 'core.sparseCheckoutCone', 'false']);
  git(plan.directory, ['config', '--worktree', 'index.sparse', 'false']);
  // --no-checkout starts with an empty index. Materialize HEAD only after the
  // exclusion is installed; never populate downloads even transiently.
  git(plan.directory, ['read-tree', '-mu', 'HEAD']);
  return {...verifyOnlineReleaseTool(plan, ports), created: true};
}

export function assertOnlineToolNoPending({maintenance = MAINTENANCE, releaseRoot = RELEASE_ROOT} = {}, checkPath = assertOnlineToolOwnedPath) {
  checkPath(maintenance);
  const statePath = path.join(maintenance, 'state.json'); checkPath(statePath, 'file');
  if (JSON.parse(fs.readFileSync(statePath, 'utf8')).phase !== 'ended') fail('maintenance_not_ended');
  checkPath(releaseRoot);
  for (const name of fs.readdirSync(releaseRoot)) {
    if (name === 'active.json') {checkPath(path.join(releaseRoot, name), 'file'); continue;}
    if (!SHA.test(name)) fail('release_entry_invalid');
    const directory = path.join(releaseRoot, name); checkPath(directory);
    const state = path.join(directory, 'state.json'); checkPath(state, 'file');
    const value = JSON.parse(fs.readFileSync(state, 'utf8'));
    if (value.target !== name || !['active', 'rolled-back'].includes(value.status)) fail('release_pending');
  }
}

export function withOnlineToolPreparationLocks({deployLock, maintenance}, work, {
  checkPath = assertOnlineToolOwnedPath, spawn = spawnSync,
} = {}) {
  checkPath(path.dirname(deployLock)); checkPath(maintenance);
  if (exists(deployLock)) checkPath(deployLock, 'file');
  const fd = fs.openSync(deployLock, fs.constants.O_RDWR | fs.constants.O_CREAT | (fs.constants.O_NOFOLLOW ?? 0), 0o600);
  const operation = path.join(maintenance, 'operation.lock'); let held = false, identity;
  try {
    checkPath(deployLock, 'file');
    const opened = fs.fstatSync(fd), onDisk = fs.lstatSync(deployLock);
    if (opened.dev !== onDisk.dev || opened.ino !== onDisk.ino) fail('deploy_lock_changed');
    // flock(2) locks the shared open-file description. FD 3 is inherited from
    // this still-open parent FD, so the lock remains held after flock exits.
    const locked = spawn('flock', ['--nonblock', '3'], {stdio: ['ignore', 'pipe', 'pipe', fd], env: gitEnvironment(), timeout: 10000});
    if (locked.status !== 0 || locked.signal || locked.error) fail('deploy_lock_busy');
    fs.mkdirSync(operation, {mode: 0o700}); held = true; checkPath(operation);
    identity = fs.lstatSync(operation);
    return work();
  } finally {
    try {
      if (held) {
        checkPath(operation); const actual = fs.lstatSync(operation);
        if (!identity || actual.dev !== identity.dev || actual.ino !== identity.ino) fail('operation_lock_changed');
        fs.rmdirSync(operation); // Only the empty directory this call created.
      }
    } finally {fs.closeSync(fd);}
  }
}

export function verifyOnlineToolBootstrap(plan, self = fileURLToPath(import.meta.url), ports = {}) {
  const {git = runOnlineToolGit, checkPath = assertOnlineToolOwnedPath} = ports;
  checkPath(plan.app); checkPath(self, 'file'); validateTarget(plan, git);
  const repository = path.resolve(text(git(path.dirname(self), ['rev-parse', '--show-toplevel'])).trim());
  checkPath(repository);
  const sourceHead = text(git(repository, ['rev-parse', 'HEAD'])).trim();
  if (path.join(repository, SELF) !== self || sourceHead.length !== 40 || !SHA.test(sourceHead) ||
      text(git(repository, ['status', '--porcelain=v1', '--untracked-files=all'])).trim() ||
      !fs.readFileSync(self).equals(Buffer.from(git(plan.app, ['show', `${plan.target}:${SELF}`])))) fail('bootstrap_source_changed');
  // The helper imports only Node builtins. An unchanged, target-verified copy
  // from a clean known ancestor can prepare the next tool without first
  // needing that tool to exist. Changed helper bytes still require bootstrap.
  git(plan.app, ['merge-base', '--is-ancestor', sourceHead, plan.target]);
}

export function prepareOnlineReleaseToolMain(args = process.argv.slice(2)) {
  if (process.platform !== 'linux' || process.getuid?.() !== 0 || args.length !== 1) fail('invocation_invalid');
  const plan = createOnlineReleaseToolPlan(args[0]);
  verifyOnlineToolBootstrap(plan);
  return withOnlineToolPreparationLocks({deployLock: `${APP}.deploy.lock`, maintenance: MAINTENANCE}, () => {
    verifyOnlineToolBootstrap(plan); assertOnlineToolNoPending();
    if (!exists(TOOL_ROOT)) {assertOnlineToolOwnedPath(path.dirname(TOOL_ROOT)); fs.mkdirSync(TOOL_ROOT, {mode: 0o700});}
    const previousUmask = process.umask(0o077);
    try {return executeOnlineReleaseToolPlan(plan);} finally {process.umask(previousUmask);}
  });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {console.log(JSON.stringify(prepareOnlineReleaseToolMain()));}
  catch (error) {console.error(error.message); process.exitCode = 1;}
}
