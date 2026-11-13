// Separate maintenance process. No builds, SQL, traffic writes, PM2 control,
// saved-dump rewriting, backup deletion, or publication-state transitions.
import * as fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {inspectPinnedExecutionSource, ownedReleasePath} from './release-toolchain-source.mjs';
import {observeReleaseResourcesReadOnly, executeCacheCleanup} from './online-release-cache-cleanup.mjs';
import {captureWebpackCache, applyWebpackCacheCleanup} from './online-release-cache-policy.mjs';
import {assertNoRetiredArtifactReferences} from './online-release-artifact-cleanup.mjs';
import {readOnlineRetentionHistory} from './online-release-retention.mjs';
import {retentionHash} from './online-release-retention-policy.mjs';
import {withOnlineToolPreparationLocks} from './prepare-online-release-tool.mjs';
import {STORAGE_ROOT, storageDigest, storageEvent, storagePressure, planStorageCaches, executeStorageEvent} from './release-toolchain-storage-policy.mjs';

const APP = '/www/wwwroot/merchant-space', ONLINE = '/var/lib/faolla-online-release';
const MAINTENANCE = '/var/lib/faolla-maintenance/merchant-space';
const need = (v, code) => {if (!v) throw Error('storage_lifecycle_' + code);};
const same = (a, b, code) => need(isDeepStrictEqual(a, b), code);
const json = v => JSON.stringify(v, null, 2) + '\n';
export function storageCommand(command, args, options = {}) {
  const r = spawnSync(command, args, {encoding: 'utf8', timeout: 120000, maxBuffer: 32 * 1024 ** 2,
    env: {PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin', HOME: '/root',
      PM2_HOME: '/root/.pm2', LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', GIT_OPTIONAL_LOCKS: '0'}, ...options});
  need(r.status === 0 && !r.error && !r.signal, 'command_failed');
  return r.stdout;
}
export function storageRead(filename) {
  const s = ownedReleasePath(filename);
  need(s.size > 0 && s.size < 32 * 1024 ** 2, 'file_size');
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const bytes = fs.readFileSync(fd), t = fs.fstatSync(fd), after = fs.lstatSync(filename);
    need(['dev', 'ino', 'mode', 'uid', 'nlink', 'size', 'mtimeMs', 'ctimeMs'].every(k => s[k] === t[k] && s[k] === after[k]), 'file_changed');
    return bytes;
  } finally {fs.closeSync(fd);}
}
export function storageDirectory(filename) {
  ownedReleasePath(path.dirname(filename), {directory: true});
  if (!fs.existsSync(filename)) fs.mkdirSync(filename, {mode: 0o700});
  return ownedReleasePath(filename, {directory: true, privateMode: true});
}
export function storageWrite(filename, value) {
  ownedReleasePath(path.dirname(filename), {directory: true, privateMode: true});
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(json(value));
  const fd = fs.openSync(filename, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
  try {fs.writeFileSync(fd, bytes); fs.fsyncSync(fd);} finally {fs.closeSync(fd);}
  const dir = fs.openSync(path.dirname(filename), fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
  try {fs.fsyncSync(dir);} finally {fs.closeSync(dir);}
  same(storageRead(filename), bytes, 'write_readback');
}
function replaceReport(filename, value) {
  const previous = fs.existsSync(filename) ? storageRead(filename) : null;
  const temporary = filename + '.' + randomUUID();
  storageWrite(temporary, value);
  if (previous) same(storageRead(filename), previous, 'report_replaced');
  else need(!fs.existsSync(filename), 'report_appeared');
  fs.renameSync(temporary, filename);
  const fd = fs.openSync(path.dirname(filename), fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
  try {fs.fsyncSync(fd);} finally {fs.closeSync(fd);}
}

export function inspectStorageSource({installed = true} = {}) {
  const directory = path.dirname(path.dirname(fileURLToPath(import.meta.url))), revision = path.basename(directory);
  need(process.platform === 'linux' && process.getuid?.() === 0 && process.execPath === '/usr/bin/node'
    && process.cwd() === directory && directory === '/var/lib/faolla-online-code/' + revision, 'invocation');
  const source = inspectPinnedExecutionSource({revision, directory});
  if (installed) {
    const receipt = JSON.parse(storageRead(STORAGE_ROOT + '/installed.json'));
    need(receipt.kind === 'storage-lifecycle-installed' && receipt.revision === revision
      && receipt.inventorySha256 === source.inventorySha256 && receipt.review?.revision === revision
      && receipt.review.productionEligible === true && receipt.applicationUnchanged === true, 'installation_binding');
  }
  return source;
}

export function currentStorageEvent() {
  const activeBytes = storageRead(ONLINE + '/active.json'), active = JSON.parse(activeBytes);
  need(/^[a-f0-9]{40}$/.test(active.target ?? ''), 'active');
  const completedBytes = storageRead('/var/lib/faolla-application-publications/' + active.target + '/completed.json');
  const completed = JSON.parse(completedBytes);
  const headBytes = storageRead('/var/lib/faolla-online-retention.head.json'), head = JSON.parse(headBytes);
  const event = storageEvent({active, completed, retentionHead: head.headSha256});
  return {event, active, pins: {activeSha256: storageDigest(activeBytes), completedSha256: storageDigest(completedBytes),
    headSha256: storageDigest(headBytes)}};
}
function assertEventCertificate(current) {
  const history = readOnlineRetentionHistory();
  need(history.headSha256 === current.event.retentionHead
    && history.entries.filter(e => retentionHash(e) === current.event.certificateSha256).length === 1, 'publication_certificate');
  return history;
}
function snapshot(revision, current) {
  same(currentStorageEvent(), current, 'publication_changed');
  assertEventCertificate(current);
  const observation = observeReleaseResourcesReadOnly(revision);
  need(observation.activeSha256 === current.pins.activeSha256 && observation.retentionHead === current.event.retentionHead, 'observation_binding');
  same(currentStorageEvent(), current, 'publication_changed');
  return observation;
}
const savedDumps = () => ['dump.pm2', 'dump.pm2.bak'].map(name => JSON.parse(storageRead('/root/.pm2/' + name)));
function referenceGuard(directory, observation) {
  const [main, backup] = savedDumps();
  need(Array.isArray(main) && Array.isArray(backup), 'saved_configuration');
  assertNoRetiredArtifactReferences(directory, {main, backup, consumers: [...new Set(observation.pm2
    .filter(p => p.status === 'online').map(p => p.cwd))]});
}
function plan(revision, current) {
  const observation = snapshot(revision, current), caches = [], excluded = [];
  for (const row of planStorageCaches(observation)) {
    if (!fs.existsSync(row.cachePath)) {excluded.push({directory: row.releaseDirectory, reason: 'no-webpack-cache'}); continue;}
    referenceGuard(row.releaseDirectory, observation);
    const cache = captureWebpackCache(row.cachePath);
    if (cache.totalBytes) caches.push(cache);
    else excluded.push({directory: row.releaseDirectory, reason: 'empty-webpack-cache'});
  }
  same(snapshot(revision, current), observation, 'observation_changed');
  return {version: 1, toolRevision: revision, event: current.event, observation, caches, excluded};
}
export function inspectStorageCandidates(revision) {
  const current = currentStorageEvent(), result = plan(revision, current);
  return {kind: 'storage-lifecycle-candidates-readonly', event: current.event,
    candidates: result.caches.map(c => ({path: c.cachePath, bytes: c.totalBytes})),
    protectedDirectoryCount: result.observation.protectedDirectories.length, excluded: result.excluded,
    deletionsPerformed: false, processControlPerformed: false};
}

export function pollStorage(revision) {
  // A publisher owning the normal fence is routine, not a failed release or a
  // cleanup attempt. Never read a half-updated active/completed pair in it.
  if (fs.existsSync(MAINTENANCE + '/operation.lock')) {
    ownedReleasePath(MAINTENANCE + '/operation.lock', {directory: true, privateMode: true});
    return {status: 'deferred-publication-busy', deletionsPerformed: false};
  }
  const current = currentStorageEvent(), location = STORAGE_ROOT + '/events/' + current.event.key;
  const assertNoIncomplete = () => {
    const entries = fs.readdirSync(STORAGE_ROOT + '/events', {withFileTypes: true});
    need(entries.length <= 4096, 'event_inventory_limit');
    for (const entry of entries) {
      need(entry.isDirectory() && !entry.isSymbolicLink() && /^[a-f0-9]{64}$/.test(entry.name), 'event_layout');
      const directory = STORAGE_ROOT + '/events/' + entry.name;
      ownedReleasePath(directory, {directory: true, privateMode: true});
      need(fs.existsSync(directory + '/completed.json') && !fs.existsSync(directory + '/failed.json'), 'previous_attempt_requires_review');
      const receipt = JSON.parse(storageRead(directory + '/completed.json'));
      need(receipt.kind === 'storage-lifecycle-event-completed' && receipt.event?.key === entry.name, 'completion_binding');
    }
  };
  // A different release/head is never an excuse to replay an earlier partial
  // cleanup. Preserve and globally block on every incomplete event directory.
  assertNoIncomplete();
  // Cheap no-op without a process/filesystem inventory when this certificate was
  // already handled. A changed retention head creates a distinct event as well.
  if (fs.existsSync(location + '/completed.json')) {
    const receipt = JSON.parse(storageRead(location + '/completed.json'));
    same(receipt.event, current.event, 'completion_binding');
    return {status: 'already-completed', key: current.event.key};
  }
  try {return withOnlineToolPreparationLocks({deployLock: APP + '.deploy.lock', maintenance: MAINTENANCE}, () => {
    assertNoIncomplete();
    same(currentStorageEvent(), current, 'publication_changed');
    return executeStorageEvent(current.event, {
      status: () => fs.existsSync(location) ? 'attempted' : 'absent',
      plan: () => plan(revision, current),
      preflight: p => {
        same(snapshot(revision, current), p.observation, 'observation_changed');
        for (const c of p.caches) referenceGuard(c.releaseDirectory, p.observation);
      },
      prepare: p => {
        need(!fs.existsSync(location), 'event_already_exists');
        storageDirectory(location);
        storageWrite(location + '/plan.json', p);
        storageWrite(location + '/attempt.json', {event: current.event, at: new Date().toISOString(),
          beforeAvailableBytes: availableBytes(), automaticRetryAllowed: false});
      },
      apply: p => executeCacheCleanup(p, {
        observe: () => snapshot(revision, current), capture: captureWebpackCache,
        apply: c => {referenceGuard(c.releaseDirectory, p.observation); return applyWebpackCacheCleanup(c);},
        begin: () => storageWrite(location + '/cleanup-started.json', {at: new Date().toISOString()}),
        record: (n, r) => storageWrite(location + '/removed-' + n + '.json', r),
        finish: () => {}, failed: () => {},
      }),
      verify: p => same(snapshot(revision, current), p.observation, 'protected_state_changed'),
      complete: result => storageWrite(location + '/completed.json', {kind: 'storage-lifecycle-event-completed',
        event: current.event, at: new Date().toISOString(), result, afterAvailableBytes: availableBytes(),
        removedLogicalBytes: result.reduce((s, r) => s + r.removedBytes, 0), processControlPerformed: false,
        businessDataWritten: false, savedConfigurationWritten: false}),
      fail: () => storageWrite(location + '/failed.json', {kind: 'storage-lifecycle-review-required',
        event: current.event, automaticRetryAllowed: false, at: new Date().toISOString()}),
    });
  });} catch (error) {
    // Lock acquisition may lose a race after the read-only check above. Only
    // these exact pre-intent acquisition failures may defer automatically.
    if (error?.message === 'online_tool_deploy_lock_busy' || (error?.code === 'EEXIST'
      && error.path === MAINTENANCE + '/operation.lock' && error.syscall === 'mkdir'))
      return {status: 'deferred-publication-busy', deletionsPerformed: false};
    throw error;
  }
}

function availableBytes() {const s = fs.statfsSync('/www'); return s.bavail * s.bsize;}
const INVENTORY = [
  ['web-releases', APP + '.web-releases'], ['tool-sources', '/var/lib/faolla-online-code'],
  ['route-releases', APP + '.route-releases'], ['legacy-releases', APP + '.releases'],
  ['release-evidence', ONLINE], ['booking-handoff-evidence', '/var/lib/faolla-booking-handoff'],
  ['closed-test-archives', '/var/lib/faolla-closed-test-archives'], ['docker-engine', '/var/lib/docker'],
  ['supabase', '/opt/supabase'], ['system-logs', '/var/log'], ['pm2-logs', '/root/.pm2/logs'],
  ['nginx-logs', '/www/wwwlogs'],
];
function allocatedBytes(directory) {
  if (!fs.existsSync(directory)) return null;
  // Inventory is read-only and includes service-owned log/data directories.
  // Do not demand root ownership of business storage or chmod it to fit code
  // trust rules. Reject redirected paths; trust only the resulting byte count.
  const before = fs.lstatSync(directory);
  need(before.isDirectory() && !before.isSymbolicLink() && fs.realpathSync(directory) === directory, 'inventory_path');
  const text = storageCommand('/usr/bin/du', ['-sx', '-B1', '--', directory]);
  const after = fs.lstatSync(directory);
  need(after.isDirectory() && !after.isSymbolicLink() && before.dev === after.dev && before.ino === after.ino
    && fs.realpathSync(directory) === directory, 'inventory_path_changed');
  const match = /^(\d+)\s/.exec(text); need(match && Number.isSafeInteger(Number(match[1])), 'inventory_size');
  return Number(match[1]);
}
export function dailyStorage(revision, {write = true} = {}) {
  const current = currentStorageEvent(), observation = snapshot(revision, current), at = new Date().toISOString();
  const previous = fs.existsSync(STORAGE_ROOT + '/daily-latest.json') ? JSON.parse(storageRead(STORAGE_ROOT + '/daily-latest.json')) : null;
  const categories = INVENTORY.map(([category, directory]) => ({category, directory, allocatedBytes: allocatedBytes(directory)}));
  const webReleases = fs.readdirSync(APP + '.web-releases', {withFileTypes: true}).map(entry => {
    need(entry.isDirectory() && !entry.isSymbolicLink() && /^[a-f0-9]{12}-(?:online|[0-9]{13})$/.test(entry.name), 'release_layout');
    const directory = APP + '.web-releases/' + entry.name;
    const rows = observation.pm2.filter(p => p.cwd === directory), protectedPath = observation.protectedDirectories.some(p =>
      directory === p || directory.startsWith(p + '/') || p.startsWith(directory + '/'));
    return {directory, allocatedBytes: allocatedBytes(directory), webpackBytes: allocatedBytes(directory + '/.next/cache/webpack'),
      dependencyBytes: allocatedBytes(directory + '/node_modules'), onlineProcesses: rows.filter(p => p.status === 'online').length,
      certifiedStopped: observation.certifiedStoppedDirectories.includes(directory), protected: protectedPath};
  }).sort((a, b) => b.allocatedBytes - a.allocatedBytes);
  // Reads never mutate application state; report generation itself may span
  // ordinary serving activity, but a publication transition invalidates it.
  same(currentStorageEvent(), current, 'publication_changed');
  const s = fs.statfsSync('/www'), available = s.bavail * s.bsize;
  const report = {kind: 'storage-lifecycle-daily-readonly', revision, at, activeTarget: current.event.target,
    rollbackTarget: current.event.baseline, totalBytes: s.blocks * s.bsize, availableBytes: available,
    usedBytes: (s.blocks - s.bfree) * s.bsize, pressure: storagePressure(available, previous, Date.parse(at)),
    categories, webReleases, toolSourceCount: fs.readdirSync('/var/lib/faolla-online-code').filter(n => /^[a-f0-9]{40}$/.test(n)).length,
    eligibleCacheCount: planStorageCaches(observation).length, processControlPerformed: false, deletionsPerformed: false,
    note: 'Categories are parent totals; cache/dependency components are not additive. Alerts are local journal/JSON, not email/SMS.'};
  if (write) {
    storageWrite(STORAGE_ROOT + '/reports/' + at.replaceAll(/[:.]/g, '-') + '-' + randomUUID() + '.json', report);
    replaceReport(STORAGE_ROOT + '/daily-latest.json', report);
  }
  for (const alert of report.pressure.alerts) console.error('<' + (alert.severity === 'critical' ? '3' : '4') + '>'
    + json({kind: 'faolla-storage-alert', ...alert, availableBytes: available, at}));
  return report;
}
export function storageFailure(error) {
  const code = /^[a-z][a-z0-9_]{0,150}$/.test(error?.message ?? '') ? error.message : 'storage_lifecycle_unconfirmed';
  return {kind: 'storage-lifecycle-refused', code, automaticRetryOfDestructiveIntent: false};
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    const [action, ...extra] = process.argv.slice(2);
    need(!extra.length && ['inspect', 'poll', 'daily'].includes(action), 'action');
    const source = inspectStorageSource({installed: action !== 'inspect'});
    const result = action === 'poll' ? pollStorage(source.revision) : action === 'daily' ? dailyStorage(source.revision) : inspectStorageCandidates(source.revision);
    console.log(json(action === 'daily' ? {kind: result.kind, availableBytes: result.availableBytes, alerts: result.pressure.alerts,
      report: STORAGE_ROOT + '/daily-latest.json'} : result));
    if (action === 'daily' && result.pressure.alerts.some(a => a.severity === 'critical')) process.exitCode = 1;
  } catch (error) {console.error('<3>' + json(storageFailure(error))); process.exitCode = 1;}
}
