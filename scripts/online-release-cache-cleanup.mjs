import {spawnSync} from 'node:child_process';
import {createHash, randomUUID} from 'node:crypto';
import * as fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {planReleaseCacheCleanup, captureWebpackCache, applyWebpackCacheCleanup} from './online-release-cache-policy.mjs';
import {readOnlineRollingRetentions} from './online-release-rolling.mjs';
import {assertExistingPm2Directory, normalizeRetirementProcess} from './online-release-retirement.mjs';
import {WEB_RELEASE_FILES, WEB_RELEASE_PROXY, WEB_RELEASE_MARKER} from './web-presentation-release-policy.mjs';
import {withOnlineToolPreparationLocks} from './prepare-online-release-tool.mjs';

const APP = '/www/wwwroot/merchant-space';
const ONLINE = '/var/lib/faolla-online-release';
const MAINTENANCE = '/var/lib/faolla-maintenance/merchant-space';
const AUDIT = '/var/lib/faolla-release-resource-audit';
const ROOTS = [`${APP}.releases`, `${APP}.route-releases`, `${APP}.web-releases`];
const SHA = /^[a-f0-9]{40}$/;
const ID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const TOOL_FILES = ['online-release-cache-cleanup.mjs', 'online-release-cache-policy.mjs',
  'online-release-rolling.mjs', 'online-release-rolling-policy.mjs', 'online-release-retirement.mjs',
  'online-release-retirement-policy.mjs', 'web-presentation-release-policy.mjs',
  'contact-card-release-policy.mjs', 'prepare-online-release-tool.mjs'];
const digest = value => createHash('sha256').update(value).digest('hex');
const fail = code => {throw Error(`release_cache_${code}`);};
const json = value => JSON.stringify(value, null, 2) + '\n';
const under = (value, parent) => value === parent || value.startsWith(`${parent}/`);
const same = (left, right, code) => {if (!isDeepStrictEqual(left, right)) fail(code);};

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {encoding: 'utf8', timeout: 60000, maxBuffer: 16 * 1024 * 1024,
    env: {...process.env, PM2_HOME: '/root/.pm2'}, ...options});
  if (result.status !== 0) fail(`command_failed_${path.basename(command)}`);
  return result.stdout;
}
function ownedDirectory(location, privateMode = false) {
  const st = fs.lstatSync(location);
  if (!st.isDirectory() || st.isSymbolicLink() || st.uid !== 0 || (st.mode & 0o022) ||
      (privateMode && (st.mode & 0o777) !== 0o700) || fs.realpathSync(location) !== location) fail('unsafe_directory');
  return st;
}
function ancestors(location) {
  for (let next = location; next !== '/'; next = path.dirname(next)) ownedDirectory(next);
}
function readOwned(location, privateMode = false) {
  ancestors(path.dirname(location));
  const st = fs.lstatSync(location);
  if (!st.isFile() || st.isSymbolicLink() || st.uid !== 0 || st.nlink !== 1 || (st.mode & 0o022) ||
      (privateMode && (st.mode & 0o777) !== 0o600) || st.size > 32 * 1024 * 1024) fail('unsafe_file');
  return fs.readFileSync(location, 'utf8');
}
function writePrivate(location, value) {
  ownedDirectory(path.dirname(location), true);
  const fd = fs.openSync(location, 'wx', 0o600);
  try {fs.writeFileSync(fd, value); fs.fsyncSync(fd);} finally {fs.closeSync(fd);}
  const directoryFd = fs.openSync(path.dirname(location), 'r');
  try {fs.fsyncSync(directoryFd);} finally {fs.closeSync(directoryFd);}
}
function validateTool(revision) {
  if (!SHA.test(revision ?? '')) fail('invalid_revision');
  const directory = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  if (directory !== `/var/lib/faolla-online-code/${revision}`) fail('tool_path_changed');
  ancestors(directory);
  if (run('git', ['rev-parse', 'origin/main'], {cwd: APP}).trim() !== revision ||
      run('git', ['rev-parse', 'HEAD'], {cwd: directory}).trim() !== revision ||
      run('git', ['status', '--porcelain=v1', '--untracked-files=all'], {cwd: directory}).trim()) fail('tool_source_changed');
  for (const name of TOOL_FILES) {
    if (digest(readOwned(`${directory}/scripts/${name}`)) !== digest(run('git', ['show', `${revision}:scripts/${name}`], {cwd: APP})))
      fail('tool_bytes_changed');
  }
}

function references(text) {
  return [...new Set(text.match(/\/www\/wwwroot\/merchant-space(?:\.[a-z-]+)?[^\s;{}"'\u0000$]*/g) ?? [])]
    .map(value => value.replace(/\/+$/, '')).sort();
}
function stateReferences(value, found = new Set()) {
  if (typeof value === 'string') references(value).forEach(item => found.add(item));
  else if (Array.isArray(value)) value.forEach(item => stateReferences(item, found));
  else if (value && typeof value === 'object') Object.values(value).forEach(item => stateReferences(item, found));
  return [...found].sort();
}
function gatherStates() {
  const states = [], hashes = {};
  const roots = fs.readdirSync('/var/lib').filter(name =>
    /^faolla-(?:online-release|web-presentation-release(?:-failed-[a-f0-9]+)?|contact-card-release)$/.test(name));
  function visit(directory, depth) {
    if (depth > 3) fail('state_depth_unexpected');
    ownedDirectory(directory);
    for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
      const location = `${directory}/${entry.name}`;
      if (entry.isSymbolicLink()) fail('state_link_unexpected');
      if (entry.isDirectory()) {
        if (SHA.test(entry.name)) visit(location, depth + 1);
      } else if (/^(?:state|active)\.json$|^(?:failed|rejected)[a-z0-9-]*\.json$/.test(entry.name)) {
        const text = readOwned(location, true), value = JSON.parse(text);
        hashes[location] = digest(text);
        states.push({location, status: value.status ?? null, target: value.target ?? null,
          directory: value.directory ?? null, baseline: value.baseline ?? null, value});
      }
    }
  }
  roots.sort().forEach(name => visit(`/var/lib/${name}`, 0));
  return {states, hashes};
}
function processReferences() {
  const result = [];
  for (const item of fs.readdirSync('/proc').filter(name => /^[1-9][0-9]*$/.test(name))) {
    try {
      const stat = fs.readFileSync(`/proc/${item}/stat`, 'utf8');
      const startTicks = stat.slice(stat.lastIndexOf(') ') + 2).split(' ')[19];
      const refs = new Set();
      for (const name of ['cwd', 'exe']) {
        try {references(fs.readlinkSync(`/proc/${item}/${name}`)).forEach(value => refs.add(value));}
        catch (error) {if (!['ENOENT', 'ESRCH'].includes(error.code)) throw error;}
      }
      references(fs.readFileSync(`/proc/${item}/cmdline`, 'utf8')).forEach(value => refs.add(value));
      for (const fd of fs.readdirSync(`/proc/${item}/fd`)) {
        try {references(fs.readlinkSync(`/proc/${item}/fd/${fd}`)).forEach(value => refs.add(value));}
        catch (error) {if (!['ENOENT', 'ESRCH', 'EINVAL'].includes(error.code)) throw error;}
      }
      // Protect at release granularity. A request opening a different JS chunk
      // must not turn an unchanged live process into spurious cleanup drift.
      const releaseRefs = [...new Set([...refs].flatMap(value => {
        const root = ROOTS.find(root => under(value, root));
        if (!root) return [];
        const relative = value.slice(root.length + 1).split('/')[0];
        return relative ? [`${root}/${relative}`] : [root];
      }))].sort();
      if (releaseRefs.length) result.push({pid: Number(item), startTicks, references: releaseRefs});
    } catch (error) {if (!['ENOENT', 'ESRCH'].includes(error.code)) throw error;}
  }
  return result.sort((a, b) => a.pid - b.pid);
}
function schedulerReferences() {
  const result = [];
  const add = location => {
    const text = readOwned(location), refs = references(text);
    if (refs.length) result.push({location, sha256: digest(text), references: refs});
  };
  for (const root of ['/etc/systemd/system', '/run/systemd/system', '/usr/lib/systemd/system',
    '/etc/cron.d', '/etc/cron.hourly', '/etc/cron.daily', '/etc/cron.weekly', '/etc/cron.monthly',
    '/var/spool/cron', '/var/spool/cron/crontabs']) {
    if (!fs.existsSync(root)) continue;
    const resolved = fs.realpathSync(root); ownedDirectory(resolved);
    for (const entry of fs.readdirSync(resolved, {withFileTypes: true})) {
      const location = `${resolved}/${entry.name}`;
      if (entry.isFile() && (root.includes('cron') || /\.(?:service|timer)$/.test(entry.name))) add(location);
      if (entry.isSymbolicLink() && (root.includes('cron') || /\.(?:service|timer)$/.test(entry.name))) {
        const target = fs.realpathSync(location);
        if (target !== '/dev/null') add(target);
      }
      if (entry.isSymbolicLink() && /\.(?:service|timer)\.d$/.test(entry.name)) fail('scheduler_dropin_link');
      if (entry.isDirectory() && /\.(?:service|timer)\.d$/.test(entry.name)) {
        ownedDirectory(location);
        for (const nested of fs.readdirSync(location, {withFileTypes: true})) {
          if (nested.isSymbolicLink() && nested.name.endsWith('.conf')) fail('scheduler_dropin_link');
          if (nested.isFile() && nested.name.endsWith('.conf')) add(`${location}/${nested.name}`);
        }
      }
    }
  }
  if (fs.existsSync('/etc/crontab')) add('/etc/crontab');
  return result.sort((a, b) => a.location.localeCompare(b.location));
}

/** Same-device bind mounts are not detected by st_dev or realpath. Exclude
 * whole releases overlapping any mount below the three release roots. */
export function releaseMountReferences(text) {
  const result = [];
  for (const line of text.trim().split('\n')) {
    const fields = line.split(' ');
    if (fields.length < 10 || !fields.includes('-')) fail('mountinfo_invalid');
    const location = fields[4].replace(/\\([0-7]{3})/g, (_, value) => String.fromCharCode(parseInt(value, 8)));
    if (!location.startsWith('/') || /[\x00-\x1f\x7f]/.test(location)) fail('mountinfo_invalid');
    if (ROOTS.some(root => under(location, root))) result.push(location);
  }
  return [...new Set(result)].sort();
}

function daemonIdentity() {
  assertExistingPm2Directory();
  const text = readOwned('/root/.pm2/pm2.pid').trim();
  if (!/^[1-9][0-9]*$/.test(text)) fail('daemon_missing');
  const directory = `/proc/${text}`;
  const stat = fs.readFileSync(`${directory}/stat`, 'utf8');
  const command = fs.readFileSync(`${directory}/cmdline`, 'utf8').replace(/\0+$/, '');
  if (fs.statSync(directory).uid !== 0 || command !== 'PM2 v6.0.14: God Daemon (/root/.pm2)') fail('daemon_changed');
  return {pid: Number(text), startTicks: stat.slice(stat.lastIndexOf(') ') + 2).split(' ')[19]};
}

/** history must already have passed readOnlineRollingRetentions' complete proof
 * validation. This is cache eligibility only, never permission to delete a PM2
 * registration, source tree, runtime build or recovery certificate. All other
 * protection sources must still be added, including overlapping live cwd paths.
 */
export function selectPm2CacheProtection({pm2, history}) {
  if (!Array.isArray(pm2) || !Array.isArray(history?.legacyCertificates) || !Array.isArray(history?.entries))
    fail('pm2_protection_invalid');
  const certificates = [...history.legacyCertificates, ...history.entries];
  const protectedDirectories = new Set(), certifiedStoppedDirectories = new Set();
  for (const row of pm2) {
    if (!row || !['online', 'stopped'].includes(row.status)) fail('process_transition_pending');
    if (typeof row.cwd !== 'string' || !row.cwd.startsWith('/') || path.posix.normalize(row.cwd) !== row.cwd ||
        /[\\\x00-\x1f\x7f]/.test(row.cwd)) fail('pm2_protection_invalid');
    const matches = row.status === 'stopped' && row.pid === 0 && row.watch === false && row.cronRestart === null
      ? certificates.filter(cert => {
        const victim = cert?.victim;
        return cert?.status === 'completed' && typeof victim?.target === 'string' && victim.target.length === 40 && SHA.test(victim.target) &&
          victim.cwd === `${APP}.web-releases/${victim.target.slice(0, 12)}-online` &&
          victim.name === `merchant-space-online-${victim.target.slice(0, 12)}` &&
          victim.cwd === row.cwd && victim.name === row.name && victim.pmId === row.pmId && victim.port === row.port &&
          isDeepStrictEqual(row, cert.stoppedProcess);
      }) : [];
    if (matches.length === 1) certifiedStoppedDirectories.add(row.cwd);
    else protectedDirectories.add(row.cwd);
  }
  return Object.freeze({protectedDirectories: Object.freeze([...protectedDirectories].sort()),
    certifiedStoppedDirectories: Object.freeze([...certifiedStoppedDirectories].sort())});
}

export function observeReleaseResources(revision) {
  validateTool(revision);
  const daemon = daemonIdentity(); // Refuse absent daemon before pm2 can auto-start it.
  const pm2 = JSON.parse(run('pm2', ['jlist'])).map(normalizeRetirementProcess).sort((a, b) => a.pmId - b.pmId);
  same(daemonIdentity(), daemon, 'daemon_changed');
  const history = readOnlineRollingRetentions();
  const maintenanceText = readOwned(`${MAINTENANCE}/state.json`, true);
  if (JSON.parse(maintenanceText).phase !== 'ended') fail('maintenance_not_ended');
  const activeText = readOwned(`${ONLINE}/active.json`, true), active = JSON.parse(activeText);
  if (!SHA.test(active.target ?? '') || typeof active.directory !== 'string') fail('invalid_active');
  const live = pm2.find(item => item.name === active.name);
  if (!live || live.status !== 'online' || live.cwd !== active.directory || live.pid <= 0) fail('active_process_changed');
  const {states, hashes} = gatherStates();
  const protectedDirectories = new Set([active.directory]);
  const mountinfo = fs.readFileSync('/proc/self/mountinfo', 'utf8');
  releaseMountReferences(mountinfo).forEach(value => protectedDirectories.add(value));
  const pm2Protection = selectPm2CacheProtection({pm2, history});
  pm2Protection.protectedDirectories.forEach(value => protectedDirectories.add(value));
  const processes = processReferences();
  processes.forEach(item => item.references.forEach(value => protectedDirectories.add(value)));
  const scheduled = schedulerReferences();
  scheduled.forEach(item => item.references.forEach(value => protectedDirectories.add(value)));
  const links = {};
  for (const location of [`${APP}.current`, `${APP}/.next/static`, `${APP}/node_modules`]) {
    links[location] = fs.realpathSync(location); protectedDirectories.add(links[location]);
  }
  const nginxText = run('/www/server/nginx/sbin/nginx', ['-T']);
  for (const ref of references(nginxText)) {
    protectedDirectories.add(ref);
    if (fs.existsSync(ref)) protectedDirectories.add(fs.realpathSync(ref));
  }
  let anchor = active.target;
  for (let count = 0; count < 3; count++) {
    const state = states.find(item => item.location === `${ONLINE}/${anchor}/state.json`);
    if (!state || state.status !== 'active' || typeof state.directory !== 'string') fail('rollback_state_missing');
    protectedDirectories.add(state.directory); anchor = state.baseline;
  }
  const latest = history.entries.at(-1);
  for (const item of latest?.protectedAnchors ?? []) protectedDirectories.add(item.directory);
  if (latest && latest.nextTarget !== active.target && !states.some(item => item.target === latest.nextTarget && item.status === 'active'))
    fail('rolling_release_unresolved');
  for (const state of states) {
    if (state.location.endsWith('/active.json')) continue;
    if (!['active', 'rolled-back'].includes(state.status)) stateReferences(state.value).forEach(value => protectedDirectories.add(value));
  }
  const releaseDirectories = ROOTS.flatMap(root => {
    ownedDirectory(root);
    return fs.readdirSync(root, {withFileTypes: true}).map(entry => {
      if (!entry.isDirectory() || entry.isSymbolicLink()) fail('unexpected_release_entry');
      return `${root}/${entry.name}`;
    });
  }).sort();
  const proxyHashes = Object.fromEntries(WEB_RELEASE_FILES.map(name => [name, digest(readOwned(`${WEB_RELEASE_PROXY}/${name}`))]));
  return {version: 1, toolRevision: revision, bootId: fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim(),
    hostSha256: digest(fs.readFileSync('/etc/machine-id')), releaseDirectories,
    protectedDirectories: [...protectedDirectories].sort(), certifiedStoppedDirectories: pm2Protection.certifiedStoppedDirectories,
    pm2, daemon, processes, scheduled, links,
    mountinfoSha256: digest(mountinfo),
    historyHead: history.headSha256, legacySha256: history.legacySha256,
    historyCertificates: history.entries.map(item => digest(json(item))), stateHashes: hashes,
    activeSha256: digest(activeText), maintenanceSha256: digest(maintenanceText), proxyHashes,
    markerSha256: digest(readOwned(WEB_RELEASE_MARKER)), nginxSha256: digest(nginxText),
    worktreesSha256: digest(run('git', ['worktree', 'list', '--porcelain'], {cwd: APP}))};
}

/** All candidates are revalidated before the first destructive operation. */
export function executeCacheCleanup(plan, operations) {
  if (plan?.version !== 1 || !SHA.test(plan.toolRevision ?? '') || !Array.isArray(plan.caches) || !plan.observation) fail('invalid_plan');
  const observation = operations.observe();
  same(observation, plan.observation, 'observation_changed');
  const allowed = new Set(planReleaseCacheCleanup(observation).eligible.map(item => item.cachePath));
  if (new Set(plan.caches.map(item => item.cachePath)).size !== plan.caches.length ||
      plan.caches.some(item => !allowed.has(item.cachePath))) fail('candidate_not_eligible');
  for (const cache of plan.caches) same(operations.capture(cache.cachePath), cache, 'cache_changed');
  operations.begin();
  const results = [];
  let attemptedCachePath = null;
  try {
    for (const cache of plan.caches) {
      same(operations.observe(), observation, 'observation_changed');
      attemptedCachePath = cache.cachePath;
      const result = operations.apply(cache);
      results.push({cachePath: cache.cachePath, ...result});
      operations.record(results.length, results.at(-1));
      attemptedCachePath = null;
    }
    same(operations.observe(), observation, 'protected_state_changed');
    operations.finish(results);
    return results;
  } catch (error) {
    operations.failed(results, error.message, {attemptedCachePath, partialCleanupPossible: attemptedCachePath !== null});
    throw error;
  }
}

function availableBytes() {const st = fs.statfsSync('/www'); return st.bavail * st.bsize;}

export function cacheCleanupMain(args = process.argv.slice(2)) {
  const [action, revision, id, approvedHash, ...extra] = args;
  if (process.platform !== 'linux' || process.getuid?.() !== 0 || !['inspect', 'apply'].includes(action) ||
      !SHA.test(revision ?? '') || extra.length || (action === 'inspect' ? id !== undefined :
        !ID.test(id ?? '') || !/^[a-f0-9]{64}$/.test(approvedHash ?? ''))) fail('invalid_invocation');
  validateTool(revision);
  const work = () => {
    if (!fs.existsSync(AUDIT)) {ancestors(path.dirname(AUDIT)); fs.mkdirSync(AUDIT, {mode: 0o700});}
    ownedDirectory(AUDIT, true);
    if (action === 'inspect') {
      const observation = observeReleaseResources(revision);
      const planned = planReleaseCacheCleanup(observation), caches = [], excluded = [...planned.excluded];
      for (const item of planned.eligible) {
        if (!fs.existsSync(item.cachePath)) {excluded.push({...item, reason: 'no-webpack-cache'}); continue;}
        const captured = captureWebpackCache(item.cachePath);
        if (captured.totalBytes > 0) caches.push(captured);
        else excluded.push({...item, reason: 'empty-webpack-cache'});
      }
      same(observeReleaseResources(revision), observation, 'inspection_changed');
      const planId = randomUUID(), location = `${AUDIT}/${planId}`;
      fs.mkdirSync(location, {mode: 0o700});
      const plan = {version: 1, toolRevision: revision, createdAt: new Date().toISOString(), observation, caches, excluded};
      const text = json(plan); writePrivate(`${location}/plan.json`, text);
      console.log(json({planId, sha256: digest(text), candidates: caches.map(item => ({path: item.cachePath, bytes: item.totalBytes})),
        totalBytes: caches.reduce((sum, item) => sum + item.totalBytes, 0), excludedCount: excluded.length, deletedNothing: true}));
      return;
    }
    const location = `${AUDIT}/${id}`; ownedDirectory(location, true);
    const text = readOwned(`${location}/plan.json`, true);
    if (digest(text) !== approvedHash) fail('plan_hash_changed');
    const plan = JSON.parse(text);
    const age = Date.now() - Date.parse(plan.createdAt);
    if (plan.toolRevision !== revision || !Number.isFinite(age) || age < 0 || age > 86400000) fail('plan_context_expired');
    if (fs.readdirSync(location).some(name => name !== 'plan.json')) fail('plan_already_attempted');
    const beforeAvailable = availableBytes();
    const results = executeCacheCleanup(plan, {
      observe: () => observeReleaseResources(revision), capture: captureWebpackCache, apply: applyWebpackCacheCleanup,
      begin: () => writePrivate(`${location}/prepared.json`, json({version: 1, planSha256: approvedHash, beforeAvailable, at: new Date().toISOString()})),
      record: (index, value) => writePrivate(`${location}/removed-${index}.json`, json(value)),
      finish: values => writePrivate(`${location}/completed.json`, json({version: 1, planSha256: approvedHash, values, beforeAvailable,
        afterAvailable: availableBytes(), at: new Date().toISOString()})),
      failed: (values, error, partial) => writePrivate(`${location}/failed.json`, json({version: 1, planSha256: approvedHash, values, error, ...partial, at: new Date().toISOString()})),
    });
    const afterAvailable = availableBytes();
    console.log(json({status: 'completed', planId: id, results, beforeAvailable, afterAvailable,
      netAvailableChange: afterAvailable - beforeAvailable, note: 'Net filesystem change includes concurrent normal activity; compile caches can be rebuilt.'}));
  };
  // One shared, native-tested lock implementation. No recursive self-relaunch,
  // environment bypass or removal of another operation's lock directory.
  return action === 'apply'
    ? withOnlineToolPreparationLocks({deployLock: `${APP}.deploy.lock`, maintenance: MAINTENANCE}, work)
    : work();
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {cacheCleanupMain();} catch (error) {
    console.error(/^(?:release_cache_|online_cache_|online_tool_|online_retirement_|online_rolling_)[a-z0-9_]+$/.test(error.message)
      ? error.message : 'release_cache_unexpected_failure');
    process.exitCode = 1;
  }
}
