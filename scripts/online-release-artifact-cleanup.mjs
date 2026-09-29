// Only the single release retired by this successful publication is eligible.
// No command here starts/stops processes, builds, changes traffic or deletes data.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {observeReleaseResources} from './online-release-cache-cleanup.mjs';
import {readOnlineRetentionHistory} from './online-release-retention.mjs';
import {assertOnlineRetentionHeldLocks, assertOnlineRetentionPersistedProcesses} from './online-release-retention-writer.mjs';
import {assertOnlineToolOwnedPath, assertOnlineToolNoPending, createOnlineReleaseToolPlan, verifyOnlineReleaseTool} from './prepare-online-release-tool.mjs';
import {createRetiredArtifactContext, buildRetiredBackupReplacement} from './online-release-artifact-policy.mjs';
import {captureRetiredArtifactTree, applyRetiredArtifactTree} from './online-release-artifact-tree.mjs';

const APP = '/www/wwwroot/merchant-space';
const AUDIT = '/var/lib/faolla-online-artifact-reclaim';
const MAIN = '/root/.pm2/dump.pm2', BACKUP = MAIN + '.bak';
const SHA = /^[a-f0-9]{40}$/;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => JSON.stringify(value, null, 2) + '\n';
const fail = reason => {throw Error('online_artifact_' + reason);};
const same = (a, b, reason) => {if (!isDeepStrictEqual(a, b)) fail(reason);};
const under = (name, root) => name === root || name.startsWith(root + '/');
const exists = name => {try {fs.lstatSync(name); return true;} catch (e) {if (e.code === 'ENOENT') return false; throw e;}};
function run(command, args) {
  const r = spawnSync(command, args, {encoding: 'utf8', timeout: 60000, maxBuffer: 32 * 1024 * 1024,
    env: {...process.env, PM2_HOME: '/root/.pm2'}, windowsHide: true});
  if (r.status !== 0 || r.error || r.signal) fail('observation_command_failed');
  return r.stdout;
}
function privateRead(name) {
  assertOnlineToolOwnedPath(name, 'file');
  const s = fs.lstatSync(name);
  if (s.size > 32 * 1024 * 1024 || (s.mode & 0o077)) fail('private_file_invalid');
  return fs.readFileSync(name);
}
function readSavedDump(name) {
  if (![MAIN, BACKUP].includes(name)) fail('dump_path_invalid');
  // PM2 may persist 0644 under its owned /root tree; never chmod it to fit our own
  // evidence-file policy. Its established no-write/no-link contract still holds.
  assertOnlineToolOwnedPath('/root');
  assertOnlineToolOwnedPath(name, 'file');
  if (fs.lstatSync(name).size > 32 * 1024 * 1024) fail('dump_too_large');
  return fs.readFileSync(name);
}
function syncDirectory(name) {
  const fd = fs.openSync(name, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
  try {fs.fsyncSync(fd);} finally {fs.closeSync(fd);}
}
function privateWrite(name, bytes) {
  assertOnlineToolOwnedPath(path.dirname(name));
  const fd = fs.openSync(name, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
  try {fs.writeFileSync(fd, bytes); fs.fsyncSync(fd);} finally {fs.closeSync(fd);}
  syncDirectory(path.dirname(name));
  same(privateRead(name), Buffer.from(bytes), 'evidence_readback_changed');
}
function filesystemUsage() {
  const s = fs.statfsSync(APP);
  return {used: (s.blocks - s.bfree) * s.bsize, available: s.bavail * s.bsize};
}

// The normal resource observer covers live roots, nginx/static, mounts,
// schedulers and pending online/route states. Add environment/maps/container
// references and both saved process lists without walking application data or
// dependency trees. All matches are blockers; there are no historical exceptions.
export function assertNoRetiredArtifactReferences(directory, {main, backup, consumers = []}, ports = {}) {
  const io = ports.io ?? fs, command = ports.run ?? run;
  const seen = new Set();
  const check = text => {if (String(text).includes(directory)) fail('external_reference');};
  const read = filename => {try {return io.readFileSync(filename, 'utf8');} catch (e) {if (['ENOENT', 'ESRCH'].includes(e.code)) return ''; throw e;}};
  for (const name of io.readdirSync('/proc').filter(n => /^[1-9][0-9]*$/.test(n))) {
    try {
      for (const leaf of ['cmdline', 'environ', 'maps']) check(read(`/proc/${name}/${leaf}`));
      for (const leaf of ['cwd', 'exe']) try {check(io.readlinkSync(`/proc/${name}/${leaf}`));}
        catch (e) {if (!['ENOENT', 'ESRCH'].includes(e.code)) throw e;}
      for (const fd of io.readdirSync(`/proc/${name}/fd`)) try {check(io.readlinkSync(`/proc/${name}/fd/${fd}`));}
        catch (e) {if (!['ENOENT', 'ESRCH', 'EINVAL'].includes(e.code)) throw e;}
    } catch (e) {if (!['ENOENT', 'ESRCH'].includes(e.code)) throw e;}
  }
  check(read('/proc/self/mountinfo'));
  const live = JSON.parse(command('pm2', ['jlist']));
  for (const p of live) {
    const row = p.pm2_env;
    if (row?.pm_cwd === directory && p.pid === 0 && row.status === 'stopped' && row.watch === false && !row.cron_restart) continue;
    check(JSON.stringify(row));
  }
  for (const rows of [main, backup]) for (const row of rows) {
    if (row.pm_cwd === directory && row.status === 'stopped' && row.instances === undefined && row.watch === false && !row.cron_restart) continue;
    check(JSON.stringify(row));
  }
  function config(location) {
    if (!io.existsSync(location)) return;
    const real = io.realpathSync(location); if (seen.has(real)) return; seen.add(real);
    const s = io.statSync(real);
    if (s.isDirectory()) for (const name of io.readdirSync(real)) config(real + '/' + name);
    else if (s.isFile()) {if (s.size > 16 * 1024 * 1024) fail('configuration_too_large'); check(read(real));}
    else if (real !== '/dev/null') fail('configuration_type_invalid');
  }
  for (const name of ['/etc/systemd/system', '/run/systemd/system', '/usr/lib/systemd/system', '/etc/crontab',
    '/etc/cron.d', '/etc/cron.hourly', '/etc/cron.daily', '/etc/cron.weekly', '/etc/cron.monthly',
    '/var/spool/cron', '/etc/rc.local', '/www/server/panel/vhost/nginx']) config(name);
  const ids = command('docker', ['ps', '-aq']).trim().split(/\s+/).filter(Boolean);
  if (ids.length) check(command('docker', ['inspect', '--format',
    '{{json .Mounts}} {{json .Config.Env}} {{json .Config.Cmd}} {{json .Config.Entrypoint}} {{json .Config.Labels}}', ...ids]));
  // Cross-release runtime links live at the root or .next level. Source-only
  // trees cannot contain other symlinks; unknown generated layouts fail capture.
  function link(location) {
    if (!io.existsSync(location)) return;
    const s = io.lstatSync(location);
    if (s.isSymbolicLink()) {
      const target = io.realpathSync(location);
      if (!under(location, directory) && under(target, directory)) fail('external_link_reference');
    }
  }
  const locations = [APP, APP + '.shared'];
  for (const root of [APP + '.releases', APP + '.route-releases', APP + '.web-releases']) {
    for (const entry of io.readdirSync(root, {withFileTypes: true})) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) fail('release_root_layout_changed');
      locations.push(root + '/' + entry.name);
    }
  }
  for (const root of locations) {
    for (const entry of io.readdirSync(root, {withFileTypes: true})) if (entry.isSymbolicLink()) link(root + '/' + entry.name);
    link(root + '/.next'); link(root + '/.next/static'); link(root + '/.next/server');
  }
  // A lazy-loaded chunk or package may not yet appear in /proc. Inspect links
  // throughout the actual live consumers, not every historical tree or data
  // directory. Dirents skip regular file contents; do not follow runtime/data
  // symlinks. Bounds fail closed rather than silently truncating the proof.
  let inspected = 0;
  const visitedConsumers = new Set();
  function consumerLinks(root) {
    if (visitedConsumers.has(root)) return;
    visitedConsumers.add(root);
    for (const entry of io.readdirSync(root, {withFileTypes: true})) {
      if (++inspected > 1000000) fail('consumer_inventory_limit');
      const item = root + '/' + entry.name;
      if (entry.isSymbolicLink()) {
        link(item);
        const resolved = io.realpathSync(item);
        if (io.statSync(resolved).isDirectory()) {
          // The declared shared runtime is business data, never a code root.
          if (entry.name === '.runtime' && locations.includes(root) && resolved === APP + '.shared/.runtime') continue;
          if (!locations.some(location => location !== APP + '.shared' && under(resolved, location)))
            fail('external_consumer_tree_requires_inspection');
          consumerLinks(resolved);
        }
      }
      else if (entry.isDirectory() && entry.name !== '.git') consumerLinks(item);
    }
  }
  for (const root of [...new Set(consumers)]) {
    if (typeof root !== 'string' || !locations.includes(root) || root === directory || root === APP + '.shared')
      fail('consumer_root_invalid');
    consumerLinks(root);
  }
}

/** Pure sequencing seam: exceptions escape to the caller's pending report.
 * Prepared/failed evidence is never cleared; partial work is never retried.
 * No application rollback is available through this port contract. */
export function executeRetiredArtifactCleanup(plan, operations) {
  operations.verify('before-evidence');
  operations.begin(plan);
  let stage = 'preserve-recovery';
  try {
    operations.preserve();
    stage = 'repair-backup'; operations.repairBackup();
    stage = 'pre-delete'; operations.verify('before-delete');
    stage = 'reclaim'; const result = operations.apply(plan.tree);
    stage = 'verify'; operations.verify('after-delete');
    operations.finish(result);
    return result;
  } catch (error) {
    operations.failed({stage, reason: safeReason(error), partialCleanupPossible: ['reclaim', 'verify'].includes(stage)});
    throw error;
  }
}
function safeReason(error) {
  return /^(?:online_artifact_|online_tool_|release_cache_|online_retention_)[a-z0-9_]+$/.test(error?.message ?? '')
    ? error.message : 'online_artifact_check_failed';
}

export function reclaimPublicationArtifacts({state, retentionResult, toolRevision, lock}) {
  if (retentionResult?.status !== 'completed' || !retentionResult.retired) return {status: 'not-needed'};
  let location;
  try {
    assertOnlineRetentionHeldLocks(lock);
    if (!SHA.test(toolRevision ?? '')) fail('tool_revision_invalid');
    const expectedTool = `/var/lib/faolla-online-code/${toolRevision}`;
    if (path.dirname(path.dirname(fileURLToPath(import.meta.url))) !== expectedTool) fail('tool_path_changed');
    verifyOnlineReleaseTool(createOnlineReleaseToolPlan(toolRevision));
    assertOnlineToolNoPending();
    const observation = observeReleaseResources(toolRevision), history = readOnlineRetentionHistory();
    const context = createRetiredArtifactContext({state, retentionResult, history, observation});
    const certificate = history.entries.at(-1);
    const mainBytes = readSavedDump(MAIN), backupBytes = readSavedDump(BACKUP);
    const main = JSON.parse(mainBytes), backup = JSON.parse(backupBytes);
    assertOnlineRetentionPersistedProcesses(JSON.parse(run('pm2', ['jlist'])), main, {processes: observation.pm2});
    const replacement = buildRetiredBackupReplacement({main, backup, certificate});
    const expectedBackup = replacement.changed ? Buffer.from(json(replacement.replacement)) : backupBytes;
    const consumers = observation.pm2.filter(p => p.status === 'online').map(p => p.cwd);
    const savedReferences = {main, backup: replacement.replacement, consumers};
    assertNoRetiredArtifactReferences(context.directory, savedReferences);
    const tree = captureRetiredArtifactTree(context.directory, retentionResult.retired);
    const before = filesystemUsage();
    const plan = {version: 1, context, toolRevision, tree, observation,
      mainSha256: hash(mainBytes), backupSha256: hash(backupBytes), replacementSha256: hash(expectedBackup),
      before, at: new Date().toISOString()};
    if (!exists(AUDIT)) {assertOnlineToolOwnedPath('/var/lib'); fs.mkdirSync(AUDIT, {mode: 0o700}); syncDirectory('/var/lib');}
    assertOnlineToolOwnedPath(AUDIT);
    if ((fs.lstatSync(AUDIT).mode & 0o777) !== 0o700) fail('audit_directory_not_private');
    location = `${AUDIT}/${state.target}-${retentionResult.retired}`;
    if (exists(location)) fail('attempt_exists_requires_inspection');
    let repaired = false;
    const verify = stage => {
      assertOnlineRetentionHeldLocks(lock); assertOnlineToolNoPending();
      same(readSavedDump(MAIN), mainBytes, 'main_dump_changed');
      same(readSavedDump(BACKUP), repaired ? expectedBackup : backupBytes, 'backup_dump_changed');
      if (stage === 'before-delete' || stage === 'after-delete') {
        same(observeReleaseResources(toolRevision), observation, 'operational_state_changed');
        assertNoRetiredArtifactReferences(context.directory, savedReferences);
      }
    };
    executeRetiredArtifactCleanup(plan, {
      verify,
      begin: value => {
        fs.mkdirSync(location, {mode: 0o700}); syncDirectory(AUDIT);
        privateWrite(location + '/prepared.json', json(value));
      },
      preserve: () => {
        privateWrite(location + '/original-dump.pm2', mainBytes);
        privateWrite(location + '/original-dump.pm2.bak', backupBytes);
      },
      repairBackup: () => {
        if (replacement.changed) {
          verify();
          const temp = `${BACKUP}.artifact-${state.target}`;
          privateWrite(temp, expectedBackup);
          same(readSavedDump(MAIN), mainBytes, 'main_dump_changed');
          same(readSavedDump(BACKUP), backupBytes, 'backup_dump_changed');
          fs.renameSync(temp, BACKUP); syncDirectory(path.dirname(BACKUP));
          same(readSavedDump(BACKUP), expectedBackup, 'backup_repair_failed');
        }
        repaired = true;
        privateWrite(location + '/backup-verified.json', json({changed: replacement.changed, sha256: hash(expectedBackup)}));
      },
      apply: applyRetiredArtifactTree,
      finish: result => privateWrite(location + '/completed.json', json({version: 1, context, result, before,
        after: filesystemUsage(), at: new Date().toISOString()})),
      failed: failure => privateWrite(location + '/failed.json', json({...failure, at: new Date().toISOString()})),
    });
    const after = filesystemUsage();
    return {status: 'completed', retired: retentionResult.retired, audit: location,
      netAvailableIncrease: after.available - before.available};
  } catch (error) {
    return {status: 'pending', reason: safeReason(error), ...(location ? {audit: location} : {})};
  }
}

// Installation acceptance is read-only. It never selects old candidates or
// replays a historical retirement to manufacture an automatic cleanup event.
export function inspectPublicationArtifactSupport(toolRevision) {
  if (process.platform !== 'linux' || process.getuid?.() !== 0 || !SHA.test(toolRevision ?? '')) fail('invocation_invalid');
  const directory = `/var/lib/faolla-online-code/${toolRevision}`;
  if (path.dirname(path.dirname(fileURLToPath(import.meta.url))) !== directory) fail('tool_path_changed');
  verifyOnlineReleaseTool(createOnlineReleaseToolPlan(toolRevision)); assertOnlineToolNoPending();
  const o = observeReleaseResources(toolRevision);
  return {status: 'ready-for-future-publication', toolRevision, retentionHead: o.retentionHead,
    activeVersion: JSON.parse(privateRead('/var/lib/faolla-online-release/active.json')).target,
    deletedNothing: true, scope: 'one newly retired web runtime; current and stable rollback preserved'};
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 4 || process.argv[2] !== 'inspect') fail('invocation_invalid');
    console.log(json(inspectPublicationArtifactSupport(process.argv[3])));
  } catch (error) {console.error(safeReason(error)); process.exitCode = 1;}
}
