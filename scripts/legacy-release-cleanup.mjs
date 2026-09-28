import * as fs from 'node:fs';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {captureLegacyReleaseTree, applyLegacyReleaseTreeCleanup} from './legacy-release-tree.mjs';
import {readLegacyReleaseRecovery} from './legacy-release-recovery.mjs';
import {observeReleaseResources} from './online-release-cache-cleanup.mjs';
import {assertOnlineToolOwnedPath, withOnlineToolPreparationLocks} from './prepare-online-release-tool.mjs';

const APP = '/www/wwwroot/merchant-space';
const RELEASES = `${APP}.releases`, AUDIT = '/var/lib/faolla-legacy-release-audit';
const MAINTENANCE = '/var/lib/faolla-maintenance/merchant-space';
const SHA = /^[a-f0-9]{40}$/, HASH = /^[a-f0-9]{64}$/;
const ID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SOURCE_FILES = ['legacy-release-cleanup.mjs', 'legacy-release-tree.mjs', 'legacy-release-recovery.mjs',
  'online-release-cache-cleanup.mjs', 'online-release-cache-policy.mjs', 'online-release-rolling.mjs',
  'online-release-rolling-policy.mjs', 'online-release-retirement.mjs', 'online-release-retirement-policy.mjs',
  'web-presentation-release-policy.mjs', 'contact-card-release-policy.mjs', 'prepare-online-release-tool.mjs'];
const fail = code => {throw Error(`legacy_release_cleanup_${code}`);};
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => JSON.stringify(value) + '\n';
const same = (a, b, code) => {if (!isDeepStrictEqual(a, b)) fail(code);};
const under = (a, b) => a === b || a.startsWith(b + '/');
const overlap = (a, b) => under(a, b) || under(b, a);
const owned = assertOnlineToolOwnedPath;
function run(command, args, options = {}) {
  const result = spawnSync(command, args, {encoding: 'utf8', timeout: 120000, maxBuffer: 32 * 1024 * 1024,
    env: {...process.env, PM2_HOME: '/root/.pm2'}, ...options});
  if (result.status !== 0 || result.error || result.signal) fail('command_failed');
  return result.stdout;
}
function privateDirectory(directory, checkPath = owned) {
  checkPath(directory);
  if ((fs.lstatSync(directory).mode & 0o777) !== 0o700) fail('audit_permissions');
}
function readOwned(filename, max = 128 * 1024 * 1024, checkPath = owned) {
  checkPath(filename, 'file');
  if (fs.lstatSync(filename).size > max) fail('file_too_large');
  return fs.readFileSync(filename);
}
function syncDirectory(directory) {
  const fd = fs.openSync(directory, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
  try {fs.fsyncSync(fd);} finally {fs.closeSync(fd);}
}
function privateWrite(filename, bytes) {
  privateDirectory(path.dirname(filename));
  const fd = fs.openSync(filename, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
  try {fs.writeFileSync(fd, bytes); fs.fsyncSync(fd);} finally {fs.closeSync(fd);}
  syncDirectory(path.dirname(filename));
}
function validateTool(revision) {
  if (!SHA.test(revision ?? '')) fail('revision_invalid');
  const directory = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  if (directory !== `/var/lib/faolla-online-code/${revision}`) fail('tool_path_changed');
  owned(directory);
  for (const [cwd, args, expected] of [[APP, ['rev-parse', 'origin/main'], revision],
    [directory, ['rev-parse', 'HEAD'], revision], [directory, ['status', '--porcelain=v1', '--untracked-files=all'], '']])
    if (run('git', args, {cwd}).trim() !== expected) fail('tool_source_changed');
  for (const name of SOURCE_FILES)
    if (digest(readOwned(`${directory}/scripts/${name}`)) !== digest(run('git', ['show', `${revision}:scripts/${name}`], {cwd: APP})))
      fail('tool_bytes_changed');
}

export function legacyReferences(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return [...new Set(text.match(/\/www\/wwwroot\/merchant-space\.releases(?:\/[a-f0-9]{12}-[0-9]{14})?/g) ?? [])].sort();
}
export function savedPm2References(bytes) {
  let parsed;
  try {parsed = JSON.parse(bytes.toString());} catch {fail('saved_pm2_invalid');}
  if (!Array.isArray(parsed)) fail('saved_pm2_invalid');
  return legacyReferences(parsed);
}
export function isLegacyReleaseDirectory(value) {
  return typeof value === 'string' && new RegExp(`^${RELEASES.replaceAll('.', '\\.')}/[a-f0-9]{12}-[0-9]{14}$`).test(value);
}
export function planLegacyReleaseCleanup(observation) {
  if (!observation?.base || !Array.isArray(observation.base.releaseDirectories) ||
      !Array.isArray(observation.base.protectedDirectories) || !Array.isArray(observation.extraProtected) ||
      !Array.isArray(observation.recovery?.protectedDirectories)) fail('observation_invalid');
  const protectedPaths = [...observation.base.protectedDirectories, ...observation.extraProtected,
    ...observation.recovery.protectedDirectories, ...observation.base.pm2.map(item => item.cwd)];
  const eligible = [], excluded = [];
  for (const directory of observation.base.releaseDirectories) {
    if (!isLegacyReleaseDirectory(directory)) continue;
    if (protectedPaths.some(ref => overlap(ref, directory))) excluded.push({directory, reason: 'referenced'});
    else eligible.push(directory);
  }
  if (new Set(eligible).size !== eligible.length) fail('duplicate_directory');
  return {eligible: eligible.sort(), excluded};
}

// This read-only supplement covers persistence after reboot and references not
// visible from host cwd/file descriptors. Only path references and digests leave
// memory; PM2/environment/configuration secrets are never printed or copied here.
function extraReferences(base) {
  const extraProtected = new Set(), hashes = {}, docker = [];
  for (const filename of ['/root/.pm2/dump.pm2', '/root/.pm2/dump.pm2.bak']) if (fs.existsSync(filename)) {
    const bytes = readOwned(filename); hashes[filename] = digest(bytes);
    savedPm2References(bytes).forEach(ref => extraProtected.add(ref));
  }
  const pm2 = JSON.parse(run('pm2', ['jlist']));
  const configuredReferences = legacyReferences(pm2.map(item => item.pm2_env));
  configuredReferences.forEach(ref => extraProtected.add(ref));
  const runtimeReferences = [];
  for (const item of base.pm2.filter(item => item.status === 'online')) {
    const refs = legacyReferences(fs.readFileSync(`/proc/${item.pid}/environ`, 'utf8'));
    runtimeReferences.push({pid: item.pid, references: refs}); refs.forEach(ref => extraProtected.add(ref));
  }
  const ids = run('docker', ['ps', '-aq']).trim().split(/\s+/).filter(Boolean).sort();
  if (ids.some(id => !/^[a-f0-9]{12,64}$/.test(id))) fail('container_identity_invalid');
  if (ids.length) {
    const template = '{{json .Id}} {{json .Mounts}} {{json (index .Config.Labels "com.docker.compose.project.working_dir")}} {{json (index .Config.Labels "com.docker.compose.project.config_files")}}';
    const lines = run('docker', ['inspect', '--format', template, ...ids]).trim().split('\n');
    if (lines.length !== ids.length) fail('container_set_changed');
    for (const line of lines) {docker.push({sha256: digest(line), references: legacyReferences(line)}); legacyReferences(line).forEach(ref => extraProtected.add(ref));}
  }
  const worktrees = run('git', ['worktree', 'list', '--porcelain'], {cwd: APP});
  legacyReferences(worktrees).forEach(ref => extraProtected.add(ref));
  const shared = `${APP}.shared/.runtime`; owned(shared);
  const sharedStat = fs.lstatSync(shared);
  const linkReferences = [];
  const scanRoots = [...new Set([APP, ...base.pm2.map(item => item.cwd)])].sort();
  function scan(directory) {
    for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
      if (entry.name === '.git') continue;
      const filename = `${directory}/${entry.name}`;
      if (entry.isSymbolicLink()) {
        let resolved = path.resolve(directory, fs.readlinkSync(filename));
        try {resolved = fs.realpathSync(filename);} catch (error) {if (error.code !== 'ENOENT') throw error;}
        const refs = legacyReferences(resolved);
        if (refs.length) {linkReferences.push({path: filename, resolved}); refs.forEach(ref => extraProtected.add(ref));}
      } else if (entry.isDirectory()) scan(filename);
    }
  }
  for (const directory of scanRoots) {owned(directory); scan(directory);}
  return {extraProtected: [...extraProtected].sort(), hashes, docker, configuredReferences, runtimeReferences,
    linkReferences: linkReferences.sort((a, b) => a.path.localeCompare(b.path)),
    shared: {path: shared, dev: sharedStat.dev, ino: sharedStat.ino, uid: sharedStat.uid, mode: sharedStat.mode}};
}
export function observeLegacyReleaseCleanup(revision) {
  validateTool(revision);
  const base = observeReleaseResources(revision);
  return {version: 1, base, recovery: readLegacyReleaseRecovery(), ...extraReferences(base)};
}

export function isPreservedLegacyFile(entry) {
  return entry.type === 'file' && !under(entry.relativePath, 'node_modules') &&
    (!under(entry.relativePath, '.next') || under(entry.relativePath, '.next/static'));
}
export function inspectLegacyCandidate(directory, capture = captureLegacyReleaseTree) {
  try {return {tree: capture(directory)};} catch (error) {
    // Unsupported filesystem layouts are not made eligible by changing their
    // permissions or links. Exclude that entire tree; drifting/IO proofs still
    // abort inspection rather than producing an incomplete snapshot.
    if (/^legacy_release_tree_(?:unsafe_ownership|hardlink_rejected|link_rejected|runtime_directory_rejected|special_file|device_changed|entry_name_rejected)$/.test(error.message))
      return {excluded: {directory, reason: error.message}};
    throw error;
  }
}
function hashFile(filename, checkPath = owned) {
  checkPath(filename, 'file');
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW), hash = createHash('sha256');
  try {
    const before = fs.fstatSync(fd, {bigint: true}), buffer = Buffer.allocUnsafe(65536);
    let count;
    while ((count = fs.readSync(fd, buffer, 0, buffer.length, null)) !== 0) hash.update(buffer.subarray(0, count));
    const after = fs.fstatSync(fd, {bigint: true}), named = fs.lstatSync(filename, {bigint: true});
    for (const actual of [after, named]) for (const key of ['dev', 'ino', 'mode', 'uid', 'nlink', 'size', 'mtimeNs', 'ctimeNs'])
      if (before[key] !== actual[key]) fail('archive_file_changed');
    fs.fsyncSync(fd);
    return {sha256: hash.digest('hex'), bytes: Number(before.size)};
  } finally {fs.closeSync(fd);}
}
export function preserveLegacySource(tree, directory, blobs, {checkPath = owned} = {}) {
  checkPath(directory);
  for (const entry of tree.entries.filter(isPreservedLegacyFile)) {
    if (blobs.has(entry.sha256)) {
      if (blobs.get(entry.sha256) !== entry.size) fail('archive_digest_collision');
      continue;
    }
    const source = `${tree.directory}/${entry.relativePath}`, destination = `${directory}/${entry.sha256}`;
    checkPath(source, 'file');
    const input = fs.openSync(source, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    let output;
    try {
      output = fs.openSync(destination, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
      const st = fs.fstatSync(input, {bigint: true});
      if (st.ino.toString() !== entry.ino || st.dev.toString() !== entry.dev || Number(st.size) !== entry.size ||
          st.mtimeNs.toString() !== entry.mtimeNs || st.ctimeNs.toString() !== entry.ctimeNs) fail('source_changed');
      const buffer = Buffer.allocUnsafe(65536), hash = createHash('sha256'); let count, bytes = 0;
      while ((count = fs.readSync(input, buffer, 0, buffer.length, null)) !== 0) {
        hash.update(buffer.subarray(0, count)); bytes += count;
        let offset = 0; while (offset < count) offset += fs.writeSync(output, buffer, offset, count - offset);
      }
      if (hash.digest('hex') !== entry.sha256 || bytes !== entry.size) fail('source_changed');
      fs.fsyncSync(output);
    } finally {fs.closeSync(input); if (output !== undefined) fs.closeSync(output);}
    blobs.set(entry.sha256, entry.size);
  }
}
function readManifest(location, record, checkPath = owned) {
  if (!/^[a-f0-9]{12}-[0-9]{14}\.json$/.test(record.manifest) || !HASH.test(record.sha256)) fail('manifest_name_invalid');
  const bytes = readOwned(`${location}/manifests/${record.manifest}`, 128 * 1024 * 1024, checkPath);
  if (digest(bytes) !== record.sha256) fail('manifest_hash_changed');
  const tree = JSON.parse(bytes);
  if (tree.directory !== record.directory || tree.totalBytes !== record.bytes || !isLegacyReleaseDirectory(tree.directory)) fail('manifest_context_changed');
  return tree;
}
export function verifyPreservedLegacyArchive(plan, location, {checkPath = owned} = {}) {
  privateDirectory(`${location}/manifests`, checkPath); privateDirectory(`${location}/preserved`, checkPath);
  same(fs.readdirSync(`${location}/manifests`).sort(), plan.trees.map(item => item.manifest).sort(), 'manifest_inventory_changed');
  same(fs.readdirSync(`${location}/preserved`).sort(), plan.preserved.map(item => item.sha256).sort(), 'archive_inventory_changed');
  for (const item of plan.preserved) {
    if (!HASH.test(item.sha256)) fail('archive_entry_invalid');
    same(hashFile(`${location}/preserved/${item.sha256}`, checkPath), item, 'archive_hash_changed');
  }
  const expected = new Map();
  for (const record of plan.trees) for (const entry of readManifest(location, record, checkPath).entries.filter(isPreservedLegacyFile)) expected.set(entry.sha256, entry.size);
  same([...expected].sort(), plan.preserved.map(item => [item.sha256, item.bytes]).sort(), 'archive_coverage_changed');
  // Persist blob names as well as bytes before allowing any source deletion.
  syncDirectory(`${location}/preserved`);
}
export function assertLegacyObservationUnchanged(before, actual, removed = []) {
  if (removed.some(item => !isLegacyReleaseDirectory(item)) || new Set(removed).size !== removed.length) fail('removed_set_invalid');
  const expected = {...before, base: {...before.base, releaseDirectories: before.base.releaseDirectories.filter(item => !removed.includes(item))}};
  same(actual, expected, 'references_changed');
}
export function executeLegacyReleaseCleanup(plan, operations) {
  if (plan?.version !== 1 || !SHA.test(plan.toolRevision ?? '') || !Array.isArray(plan.trees) || !plan.observation) fail('plan_invalid');
  const before = operations.observe(); assertLegacyObservationUnchanged(plan.observation, before);
  const eligible = new Set(planLegacyReleaseCleanup(before).eligible);
  if (new Set(plan.trees.map(item => item.directory)).size !== plan.trees.length ||
      plan.trees.some(item => !eligible.has(item.directory))) fail('candidate_not_eligible');
  operations.verifyArchive();
  for (const record of plan.trees) {const tree = operations.readManifest(record); same(operations.capture(tree.directory), tree, 'tree_changed');}
  operations.begin();
  const removed = [], results = []; let attemptedDirectory = null;
  try {
    for (const record of plan.trees) {
      assertLegacyObservationUnchanged(before, operations.observe(), removed);
      attemptedDirectory = record.directory;
      const result = operations.apply(operations.readManifest(record));
      removed.push(record.directory); results.push({directory: record.directory, ...result});
      operations.record(results.length, results.at(-1)); attemptedDirectory = null;
    }
    assertLegacyObservationUnchanged(before, operations.observe(), removed);
    operations.finish(results); return results;
  } catch (error) {
    operations.failed(results, {attemptedDirectory, partialCleanupPossible: attemptedDirectory !== null,
      error: /^legacy_release_[a-z0-9_]+$/.test(error.message) ? error.message : 'unexpected_failure'});
    throw error;
  }
}
const available = () => {const disk = fs.statfsSync('/www'); return disk.bavail * disk.bsize;};
export function legacyReleaseCleanupMain(args = process.argv.slice(2)) {
  const [action, revision, id, approvedHash, ...extra] = args;
  if (process.platform !== 'linux' || process.getuid?.() !== 0 || !['inspect', 'apply'].includes(action) ||
      !SHA.test(revision ?? '') || extra.length || (action === 'inspect' ? id !== undefined : !ID.test(id ?? '') || !HASH.test(approvedHash ?? '')))
    fail('invocation_invalid');
  validateTool(revision);
  const work = () => {
    if (!fs.existsSync(AUDIT)) {owned(path.dirname(AUDIT)); fs.mkdirSync(AUDIT, {mode: 0o700}); syncDirectory(path.dirname(AUDIT));}
    privateDirectory(AUDIT);
    if (action === 'inspect') {
      const beforeAvailable = available(), observation = observeLegacyReleaseCleanup(revision);
      const {eligible, excluded} = planLegacyReleaseCleanup(observation), planId = randomUUID(), location = `${AUDIT}/${planId}`;
      fs.mkdirSync(location, {mode: 0o700});
      syncDirectory(AUDIT);
      for (const name of ['manifests', 'preserved']) fs.mkdirSync(`${location}/${name}`, {mode: 0o700});
      syncDirectory(location);
      const trees = [], blobs = new Map();
      for (const directory of eligible) {
        const candidate = inspectLegacyCandidate(directory);
        if (candidate.excluded) {excluded.push(candidate.excluded); continue;}
        const tree = candidate.tree, bytes = json(tree), manifest = path.basename(directory) + '.json';
        preserveLegacySource(tree, `${location}/preserved`, blobs);
        privateWrite(`${location}/manifests/${manifest}`, bytes);
        trees.push({directory, manifest, sha256: digest(bytes), bytes: tree.totalBytes, files: tree.fileCount});
      }
      assertLegacyObservationUnchanged(observation, observeLegacyReleaseCleanup(revision));
      syncDirectory(`${location}/preserved`);
      const preserved = [...blobs].sort(([a], [b]) => a.localeCompare(b)).map(([sha256, bytes]) => ({sha256, bytes}));
      const plan = {version: 1, toolRevision: revision, createdAt: new Date().toISOString(), beforeAvailable,
        observation, trees, excluded, preserved};
      const bytes = json(plan); privateWrite(`${location}/plan.json`, bytes);
      console.log(json({planId, sha256: digest(bytes), candidates: trees.map(({directory, bytes}) => ({directory, bytes})),
        totalBytes: trees.reduce((sum, item) => sum + item.bytes, 0), preservedUniqueBytes: preserved.reduce((sum, item) => sum + item.bytes, 0),
        excluded, deletedNothing: true})); return;
    }
    const location = `${AUDIT}/${id}`; privateDirectory(location);
    const bytes = readOwned(`${location}/plan.json`, 8 * 1024 * 1024);
    if (digest(bytes) !== approvedHash) fail('plan_hash_changed');
    const plan = JSON.parse(bytes), age = Date.now() - Date.parse(plan.createdAt);
    if (plan.toolRevision !== revision || !Number.isFinite(age) || age < 0 || age > 86400000) fail('plan_context_expired');
    same(fs.readdirSync(location).sort(), ['manifests', 'plan.json', 'preserved'], 'plan_already_attempted');
    const beforeAvailable = available();
    const results = executeLegacyReleaseCleanup(plan, {
      observe: () => observeLegacyReleaseCleanup(revision), readManifest: record => readManifest(location, record),
      capture: captureLegacyReleaseTree, apply: applyLegacyReleaseTreeCleanup,
      verifyArchive: () => verifyPreservedLegacyArchive(plan, location),
      begin: () => privateWrite(`${location}/prepared.json`, json({planSha256: approvedHash, beforeAvailable, at: new Date().toISOString()})),
      record: (index, value) => privateWrite(`${location}/removed-${index}.json`, json(value)),
      finish: values => privateWrite(`${location}/completed.json`, json({planSha256: approvedHash, values, beforeAvailable, afterAvailable: available(), at: new Date().toISOString()})),
      failed: (values, details) => privateWrite(`${location}/failed.json`, json({values, ...details, at: new Date().toISOString()})),
    });
    console.log(json({status: 'completed', planId: id, removedDirectories: results.length,
      removedBytes: results.reduce((sum, item) => sum + item.removedBytes, 0), beforeAvailable, afterAvailable: available(),
      netAvailableSinceBeforeInspection: available() - plan.beforeAvailable, preservedSourceAndStatic: true}));
  };
  return action === 'apply' ? withOnlineToolPreparationLocks({deployLock: `${APP}.deploy.lock`, maintenance: MAINTENANCE}, work) : work();
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {legacyReleaseCleanupMain();} catch (error) {
    console.error(/^(?:legacy_release_|legacy_recovery_|release_cache_|online_tool_|online_retirement_|online_rolling_)[a-z0-9_]+$/.test(error.message)
      ? error.message : 'legacy_release_cleanup_unexpected_failure'); process.exitCode = 1;
  }
}
