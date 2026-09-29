import * as fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {fileURLToPath} from 'node:url';
import {readOnlineRetentionHistory, ONLINE_RETENTION_ROOT, ONLINE_RETENTION_FILES,
  buildOnlineRetentionPreparation, buildOnlineRetentionReceipt} from './online-release-retention.mjs';
import {ONLINE_RETENTION_POLICY, assertOnlineRetentionPlan, assertOnlineRetentionCompletion,
  assertOnlineRetentionHistory, retentionHash, retentionCanonicalText, onlineRetentionHeadRecord} from './online-release-retention-policy.mjs';
import {normalizeRetirementProcess, parseRetirementSockets, assertExistingPm2Directory} from './online-release-retirement.mjs';
import {WEB_RELEASE_FILES, WEB_RELEASE_PROXY, WEB_RELEASE_MARKER} from './web-presentation-release-policy.mjs';
import {assertOnlineToolOwnedPath, createOnlineReleaseToolPlan, verifyOnlineReleaseTool,
  runOnlineToolGit, assertOnlineToolNoPending} from './prepare-online-release-tool.mjs';

const APP = '/www/wwwroot/merchant-space', RELEASE = '/var/lib/faolla-online-release';
const MAINTENANCE = '/var/lib/faolla-maintenance/merchant-space';
const DEPLOY_LOCK = `${APP}.deploy.lock`, OPERATION_LOCK = `${MAINTENANCE}/operation.lock`;
const NGINX = '/www/server/nginx/sbin/nginx';
const SHA = /^[a-f0-9]{40}(?![\s\S])/, MAX_BYTES = 32 * 1024 * 1024;
const fail = reason => {throw Error(`online_retention_writer_${reason}`);};
const equal = (a, b, reason) => {if (!isDeepStrictEqual(a, b)) fail(reason);};
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const parse = bytes => {try {return JSON.parse(bytes.toString());} catch {fail('invalid_json');}};
const exists = (name, io = fs) => {try {io.lstatSync(name); return true;} catch (e) {if (e.code === 'ENOENT') return false; throw e;}};
const identity = st => Object.fromEntries(['dev', 'ino', 'mode', 'uid', 'nlink', 'size', 'mtimeMs', 'ctimeMs'].map(k => [k, st[k]]));
const dirIdentity = st => Object.fromEntries(['dev', 'ino', 'mode', 'uid'].map(k => [k, st[k]]));
const stableObservation = value => {const result = {...value}; delete result.established; return result;};
const heldLocks = new WeakMap();
function ownedPath(name, kind = 'directory', io = fs) {
  if (typeof name !== 'string' || !path.posix.isAbsolute(name) || path.posix.normalize(name) !== name || /[\\\0\r\n]/.test(name)) fail('path_invalid');
  for (let current = name; ; current = path.posix.dirname(current)) {
    const st = io.lstatSync(current), directory = current !== name || kind === 'directory';
    if (st.uid !== 0 || st.isSymbolicLink() || !(directory ? st.isDirectory() : st.isFile()) ||
        (st.mode & 0o022) || (!directory && st.nlink !== 1) || io.realpathSync(current) !== current) fail('unsafe_path');
    if (current === '/') return;
  }
}
const privateDirectory = (name, io = fs) => {
  ownedPath(name, 'directory', io);
  const st = io.lstatSync(name); if ((st.mode & 0o777) !== 0o700) fail('private_directory_required'); return st;
};
function readOwned(name, {io = fs, privateMode = true} = {}) {
  ownedPath(name, 'file', io);
  const st = io.lstatSync(name);
  if ((privateMode && (st.mode & 0o777) !== 0o600) || st.size < 1 || st.size > MAX_BYTES) fail('unsafe_file');
  const fd = io.openSync(name, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    equal(identity(io.fstatSync(fd)), identity(st), 'file_replaced');
    const bytes = io.readFileSync(fd);
    if (!Buffer.isBuffer(bytes) || bytes.length !== st.size) fail('file_changed');
    equal(identity(io.fstatSync(fd)), identity(st), 'file_changed');
    equal(identity(io.lstatSync(name)), identity(st), 'file_replaced');
    return bytes;
  } finally {io.closeSync(fd);}
}
function syncDirectory(name, io = fs) {
  ownedPath(name, 'directory', io);
  const fd = io.openSync(name, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
  try {io.fsyncSync(fd);} finally {io.closeSync(fd);}
}
function privateWrite(name, text, io = fs) {
  privateDirectory(path.dirname(name), io);
  const fd = io.openSync(name, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
  try {io.writeFileSync(fd, text); io.fsyncSync(fd);} finally {io.closeSync(fd);}
  syncDirectory(path.dirname(name), io);
  equal(readOwned(name, {io}), Buffer.from(text), 'write_readback_changed');
}

/** The only hidden tail is the one created by this exact in-memory journal.
 * Public readers remain strict. Test ports cannot be supplied by the CLI. */
export function createOnlineRetentionJournal(history, {root = ONLINE_RETENTION_ROOT, io = fs,
  readHistory = (location, filesystem) => readOnlineRetentionHistory(location, filesystem)} = {}) {
  assertOnlineRetentionHistory(history);
  const sequence = history.entries.length + 1, name = String(sequence).padStart(6, '0');
  if (sequence > 999999 || !path.posix.isAbsolute(root) || path.posix.normalize(root) !== root) fail('journal_root_invalid');
  const location = `${root}/${name}`, contents = new Map(), snapshots = new Map();
  const writeOrder = ['prepared.json', 'before.json', 'recovery-pm2.json', 'after.json', 'certificate.json'];
  let begun = false, rootIdentity, entryIdentity;
  const verify = () => {
    if (!begun) fail('attempt_not_started');
    equal(dirIdentity(privateDirectory(root, io)), rootIdentity, 'pending_root_changed');
    equal(dirIdentity(privateDirectory(location, io)), entryIdentity, 'pending_directory_changed');
    equal(io.readdirSync(root).sort(), Array.from({length: sequence}, (_, i) => String(i + 1).padStart(6, '0')), 'pending_listing_changed');
    equal(io.readdirSync(location).sort(), [...contents.keys()].sort(), 'pending_evidence_changed');
    for (const [file, text] of contents) {
      equal(readOwned(`${location}/${file}`, {io}), Buffer.from(text), 'pending_evidence_changed');
      equal(identity(io.lstatSync(`${location}/${file}`)), snapshots.get(file), 'pending_identity_changed');
    }
  };
  return {
    location,
    begin() {
      if (begun) fail('attempt_already_started');
      equal(readHistory(root, io), history, 'history_changed');
      if (!exists(root, io)) {
        ownedPath(path.posix.dirname(root), 'directory', io);
        io.mkdirSync(root, {mode: 0o700}); syncDirectory(path.dirname(root), io);
      }
      rootIdentity = dirIdentity(privateDirectory(root, io));
      io.mkdirSync(location, {mode: 0o700}); syncDirectory(root, io);
      entryIdentity = dirIdentity(privateDirectory(location, io)); begun = true; verify();
    },
    write(file, text) {
      verify();
      if (file !== writeOrder[contents.size] || typeof text !== 'string' || text !== retentionCanonicalText(parse(text))) fail('evidence_write_invalid');
      privateWrite(`${location}/${file}`, text, io);
      contents.set(file, text); snapshots.set(file, identity(io.lstatSync(`${location}/${file}`))); verify();
    },
    prefix() {
      if (!begun) {const current = readHistory(root, io); equal(current, history, 'history_changed'); return current;}
      verify();
      const view = Object.create(io);
      view.readdirSync = (target, ...args) => target === root ? io.readdirSync(target, ...args).filter(entry => entry !== name) : io.readdirSync(target, ...args);
      if (sequence === 1) view.lstatSync = (target, ...args) => {
        if (target === root) throw Object.assign(Error('owned_initial_pending'), {code: 'ENOENT'});
        return io.lstatSync(target, ...args);
      };
      const current = readHistory(root, view); verify(); equal(current, history, 'history_changed'); return current;
    },
    complete(certificate) {
      verify();
      if (contents.size !== ONLINE_RETENTION_FILES.length || contents.get('certificate.json') !== retentionCanonicalText(certificate)) fail('certificate_not_durable');
      const next = {...history, entries: [...history.entries, certificate], headSha256: retentionHash(certificate)};
      assertOnlineRetentionHistory(next);
      writeHead(root, history, next, io);
      const committed = readHistory(root, io); equal(committed, next, 'committed_history_changed'); return committed;
    },
  };
}
function writeHead(root, previous, next, io = fs, resumePending = false) {
  const filename = `${root}.head.json`, temporary = `${filename}.pending`;
  if (previous.entries.length) equal(readOwned(filename, {io}), Buffer.from(retentionCanonicalText(onlineRetentionHeadRecord(previous))), 'head_changed');
  else if (exists(filename, io)) fail('unexpected_head');
  const pending = exists(temporary, io);
  if (pending && !resumePending) fail('head_update_pending');
  // Head lives under /var/lib (not a private directory), so use explicit root
  // ownership checks without changing any existing parent permissions.
  ownedPath(path.posix.dirname(filename), 'directory', io);
  const text = retentionCanonicalText(onlineRetentionHeadRecord(next));
  if (pending) equal(readOwned(temporary, {io}), Buffer.from(text), 'head_update_pending');
  const fd = io.openSync(temporary, pending ? fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW
    : fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
  try {if (!pending) io.writeFileSync(fd, text); io.fsyncSync(fd);} finally {io.closeSync(fd);}
  equal(readOwned(temporary, {io}), Buffer.from(text), 'head_write_changed');
  io.renameSync(temporary, filename); syncDirectory(path.dirname(filename), io);
  equal(readOwned(filename, {io}), Buffer.from(text), 'head_write_changed');
}

/** No implicit resume: begin/write/stop/save failures leave immutable partial
 * evidence. A later public read fails closed before any further stop. */
export async function executeOnlineRetention(operations, first, history) {
  assertOnlineRetentionPlan(first, history);
  await operations.wait(2000);
  const before = await operations.observe(); assertOnlineRetentionPlan(before, history);
  equal(stableObservation(before), stableObservation(first), 'observations_changed');
  const recovery = await operations.recovery(before), preparedAt = operations.now();
  const preparation = buildOnlineRetentionPreparation(before, recovery, history, preparedAt);
  const files = new Map([['prepared.json', preparation.preparedText], ['before.json', preparation.beforeText], ['recovery-pm2.json', preparation.recoveryText]]);
  await operations.begin(before, history);
  for (const [name, text] of files) await operations.write(name, text);
  const check = await operations.observe(); assertOnlineRetentionPlan(check, history);
  equal(stableObservation(check), stableObservation(before), 'observations_changed');
  const finalCheck = await operations.finalCheck(before); assertOnlineRetentionPlan(finalCheck, history);
  equal(stableObservation(finalCheck), stableObservation(before), 'pre_operation_changed');
  if (before.kind === 'retire') await operations.stop(before.victim.process.pmId);
  const stopped = await operations.observe(before); assertOnlineRetentionCompletion(before, stopped, history);
  if (before.kind === 'retire') {await operations.save(); await operations.verifyPersisted(stopped);}
  const after = await operations.observe(before); assertOnlineRetentionCompletion(before, after, history);
  const receipt = buildOnlineRetentionReceipt(before, after, recovery, history, {preparedAt, completedAt: operations.now()});
  for (const [name, text] of files) equal(receipt.files.get(name), text, 'preparation_changed');
  await operations.write('after.json', receipt.files.get('after.json'));
  await operations.write('certificate.json', receipt.files.get('certificate.json'));
  await operations.complete(receipt.certificate);
  return receipt.certificate;
}

export function assertOnlineRetentionImmediateStop(before, current, history) {
  if (before.kind !== 'retire' || !before.victim) fail('stop_not_authorized');
  assertOnlineRetentionPlan(current, history);
  equal(stableObservation(current), stableObservation(before), 'immediate_stop_changed');
}

export function assertOnlineRetentionPersistedProcesses(live, dump, evidence) {
  const processes = live.map(normalizeRetirementProcess).sort((a, b) => a.pmId - b.pmId);
  equal(processes, evidence.processes, 'persisted_processes_changed');
  if (!Array.isArray(dump) || dump.length !== live.length || new Set(dump.map(p => p.name)).size !== dump.length) fail('dump_process_set_changed');
  for (const raw of live) {
    const savedProcess = structuredClone(dump.find(p => p.name === raw.name)), expected = structuredClone(raw.pm2_env);
    delete expected.instances; delete expected.pm_id; delete expected.prev_restart_delay;
    for (const key of ['axm_actions', 'axm_monitor', 'axm_options', 'axm_dynamic']) {delete savedProcess[key]; delete expected[key];}
    equal(savedProcess, expected, 'dump_process_changed');
  }
}

function runtimeEnvironment() {
  return {PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin', HOME: '/root',
    LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', PM2_HOME: '/root/.pm2'};
}
function run(command, args, options = {}) {
  const result = spawnSync(command, args, {encoding: 'utf8', env: runtimeEnvironment(), timeout: 60000,
    maxBuffer: MAX_BYTES, windowsHide: true, ...options});
  if (result.status !== 0 || result.signal || result.error) fail('command_failed');
  return result.stdout;
}
function processFact(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) fail('process_pid_invalid');
  const base = `/proc/${pid}`, info = fs.lstatSync(base), text = fs.readFileSync(`${base}/stat`, 'utf8');
  const end = text.lastIndexOf(')'), fields = text.slice(end + 2).trim().split(/\s+/);
  if (end < 1 || fields.length < 20 || !/^[0-9]+$/.test(fields[19])) fail('process_stat_invalid');
  return {pid, uid: info.uid, parentPid: Number(fields[1]), startTicks: fields[19], executable: fs.realpathSync(`${base}/exe`),
    cwd: fs.realpathSync(`${base}/cwd`), commandSha256: digest(fs.readFileSync(`${base}/cmdline`)), environmentSha256: digest(fs.readFileSync(`${base}/environ`))};
}
function environ(pid) {
  const values = fs.readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0').filter(Boolean), result = {};
  for (const value of values) {const at = value.indexOf('='); if (at < 1 || Object.hasOwn(result, value.slice(0, at))) fail('runtime_environment_invalid'); result[value.slice(0, at)] = value.slice(at + 1);}
  return result;
}
function daemonFact() {
  assertExistingPm2Directory();
  const text = readOwned('/root/.pm2/pm2.pid', {privateMode: false}).toString().trim();
  if (!/^[1-9][0-9]*$/.test(text)) fail('daemon_pid_invalid');
  const fact = processFact(Number(text));
  if (fact.uid !== 0 || fs.readFileSync(`/proc/${fact.pid}/cmdline`, 'utf8').replace(/\0+$/, '') !== 'PM2 v6.0.14: God Daemon (/root/.pm2)') fail('daemon_identity_invalid');
  const env = environ(fact.pid), killSignal = env.PM2_KILL_SIGNAL || 'SIGINT', killTimeout = Number(env.PM2_KILL_TIMEOUT || 1600);
  if (env.PM2_KILL_USE_MESSAGE || !['SIGINT', 'SIGTERM'].includes(killSignal) || !Number.isSafeInteger(killTimeout) || killTimeout < 1000 || killTimeout > 60000) fail('daemon_signal_unsupported');
  return {fact, killSignal, killTimeout};
}
function validateTool(toolRevision) {
  if (!SHA.test(toolRevision ?? '') || path.dirname(path.dirname(fileURLToPath(import.meta.url))) !== `/var/lib/faolla-online-code/${toolRevision}`) fail('tool_path_invalid');
  return verifyOnlineReleaseTool(createOnlineReleaseToolPlan(toolRevision));
}
async function buildProof(port) {
  const response = await fetch(`http://127.0.0.1:${port}/api/app-web-version`, {headers: {Host: 'www.faolla.com', Connection: 'close'},
    redirect: 'manual', signal: AbortSignal.timeout(15000)});
  const text = await response.text(); if (text.length > 65536 || response.status !== 200) fail('build_probe_failed');
  const value = parse(text); if (value.ok !== true || !SHA.test(value.buildId ?? '')) fail('build_probe_invalid');
  return {status: response.status, ok: value.ok, buildId: value.buildId};
}
function anchorState(value, target, processes) {
  if (!SHA.test(target ?? '') || value.target !== target || value.name !== `merchant-space-online-${target.slice(0, 12)}` ||
      value.directory !== `${APP}.web-releases/${target.slice(0, 12)}-online` || !Number.isSafeInteger(value.port) || value.port < 3103 || value.port > 3110) fail('release_state_invalid');
  const process = processes.find(p => p.name === value.name); if (!process) fail('release_process_missing');
  return {target, name: value.name, directory: value.directory, port: value.port, process};
}

/** Fixed production paths only. Importing this module has no host side effects. */
function productionOperations({toolRevision, kind, activeTarget, victimTarget = null, lock}, historyRead = readOnlineRetentionHistory) {
  if (process.platform !== 'linux' || process.getuid?.() !== 0 || !['initialize', 'converge', 'retire'].includes(kind) ||
      !SHA.test(toolRevision ?? '') || !SHA.test(activeTarget ?? '') || (kind === 'retire' ? !SHA.test(victimTarget ?? '') : victimTarget !== null)) fail('invocation_invalid');
  let journal = null, daemon = null, pmBinary = null, stopAttempted = false, saved = false, armed = null;
  const history = () => journal ? journal.prefix() : historyRead();
  const verifyDaemon = () => {
    const current = daemonFact(); if (daemon) equal(current, daemon, 'daemon_changed'); else daemon = current;
    return current;
  };
  const pm = args => {
    verifyDaemon();
    if (!pmBinary) {
      pmBinary = fs.realpathSync(run('which', ['pm2']).trim()); assertOnlineToolOwnedPath(pmBinary, 'file');
      if (parse(readOwned(`${path.dirname(path.dirname(pmBinary))}/package.json`, {privateMode: false})).version !== '6.0.14') fail('pm2_version_invalid');
    }
    const result = run(pmBinary, args); verifyDaemon(); return result;
  };
  const take = raw => raw.map(normalizeRetirementProcess).sort((a, b) => a.pmId - b.pmId);
  const stateText = target => {if (!SHA.test(target ?? '')) fail('target_invalid'); return readOwned(`${RELEASE}/${target}/state.json`).toString();};
  const identities = processes => processes.filter(p => p.status === 'online').map(p => ({name: p.name, ...processFact(p.pid)})).sort((a, b) => a.name.localeCompare(b.name));
  const sockets = () => parseRetirementSockets(run('ss', ['-ltnpH']), run('ss', ['-tnpH']));
  const runtimeFlags = p => {
    const env = environ(p.pid); return {backgroundPaused: env.FAOLLA_BACKGROUND_JOBS_PAUSED,
      automationEnabled: env.MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED,
      invitationEnabled: env.MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED, manualSignalHandle: env.NEXT_MANUAL_SIG_HANDLE ?? ''};
  };
  const observe = async frozen => {
    const tool = validateTool(toolRevision); assertOnlineToolNoPending();
    const prior = history(), currentDaemon = verifyDaemon(), raw = parse(pm(['jlist'])), processes = take(raw);
    const activeText = readOwned(`${RELEASE}/active.json`).toString(), activeFile = parse(activeText);
    const current = parse(stateText(activeTarget)), active = anchorState(current, activeTarget, processes);
    const previousState = parse(stateText(current.baseline)), rollback = anchorState(previousState, current.baseline, processes);
    const victimState = kind === 'retire' ? parse(stateText(victimTarget)) : null;
    const victimAnchor = victimState ? anchorState(victimState, victimTarget, processes) : null;
    const victim = frozen?.victim ?? (victimAnchor ? {target: victimTarget, process: victimAnchor.process} : null);
    if (frozen?.victim && exists(`/proc/${frozen.victim.process.pid}`)) fail('victim_process_still_present');
    const releaseProofs = [];
    for (const a of [active, rollback, ...(victimAnchor ? [victimAnchor] : [])]) {
      assertOnlineToolOwnedPath(a.directory);
      if (runOnlineToolGit(a.directory, ['rev-parse', 'HEAD']).toString().trim() !== a.target ||
          runOnlineToolGit(a.directory, ['status', '--porcelain=v1', '--untracked-files=all']).toString().trim()) fail('release_source_changed');
      const build = readOwned(`${a.directory}/.next/BUILD_ID`, {privateMode: false});
      if (!/^[A-Za-z0-9_-]{1,200}\n?$/.test(build.toString())) fail('disk_build_invalid');
      const text = stateText(a.target), http = frozen?.victim?.target === a.target
        ? frozen.releaseProofs.find(p => p.target === a.target).http : await buildProof(a.port);
      releaseProofs.push({target: a.target, sourceHead: a.target, sourceClean: true, resolvedInterpreter: fs.realpathSync(a.process.interpreter),
        state: parse(text), stateText: text, stateSha256: digest(text), buildSha256: digest(build),
        runtimeSha256: digest(readOwned(`${RELEASE}/${a.target}/runtime.json`)), environmentSha256: digest(readOwned(`${a.directory}/.env.local`)), http});
    }
    const ancestry = [...(victim ? [[victim.target, active.target]] : []), [rollback.target, active.target]].map(([older, newer]) => {
      runOnlineToolGit(APP, ['merge-base', '--is-ancestor', older, newer]); return {older, newer, verified: true};
    });
    const maintenanceText = readOwned(`${MAINTENANCE}/state.json`), proxyHashes = Object.fromEntries(WEB_RELEASE_FILES.map(name =>
      [name, digest(readOwned(`${WEB_RELEASE_PROXY}/${name}`, {privateMode: false}))]));
    const result = {version: 2, policy: ONLINE_RETENTION_POLICY, kind, toolRevision, sequence: prior.entries.length + 1,
      previousSha256: prior.headSha256, legacySha256: prior.rollingHistory.legacySha256,
      rollingHeadSha256: prior.rollingHistory.headSha256, rollingHistorySha256: retentionHash(prior.rollingHistory),
      active, rollback, victim, activeFile, activeState: current, activeSha256: digest(activeText), processes,
      sourceClean: true, sourceInventorySha256: tool.inventorySha256, maintenanceEnded: parse(maintenanceText).phase === 'ended',
      maintenanceSha256: digest(maintenanceText), markerSha256: digest(readOwned(WEB_RELEASE_MARKER, {privateMode: false})),
      baseDirectory: fs.realpathSync(`${APP}.current`), proxyHashes, nginxConfig: run(NGINX, ['-T']), releaseProofs,
      identityProofs: identities(processes), daemon: currentDaemon, ancestry, ...sockets(),
      resolvedInterpreter: victim ? releaseProofs.find(p => p.target === victim.target).resolvedInterpreter : null,
      victimChildren: victim ? frozen?.victimChildren ?? fs.readFileSync(`/proc/${victim.process.pid}/task/${victim.process.pid}/children`, 'utf8').trim() : null,
      victimRuntimeFlags: victim ? frozen?.victimRuntimeFlags ?? runtimeFlags(victim.process) : null};
    if (kind === 'converge' && current.retentionRollbackProof !== undefined) {
      result.rollbackProof = current.retentionRollbackProof;
      const proof = result.rollbackProof;
      equal(stateText(proof.from.target), proof.failedStateText, 'rollback_source_changed');
      for (const name of WEB_RELEASE_FILES) {
        equal(readOwned(`${RELEASE}/${proof.from.target}/before-${name}`).toString(), proof.proxyFiles[name].beforeText, 'rollback_source_changed');
        equal(readOwned(`${RELEASE}/${proof.from.target}/after-${name}`).toString(), proof.proxyFiles[name].afterText, 'rollback_source_changed');
      }
    }
    verifyDaemon(); equal(take(parse(pm(['jlist']))), processes, 'pm2_changed_during_observation');
    equal(identities(processes), result.identityProofs, 'process_changed_during_observation');
    equal(history(), prior, 'history_changed'); return result;
  };
  const immediate = before => {
    const current = {...before, processes: take(parse(pm(['jlist'])))};
    current.identityProofs = identities(current.processes); current.daemon = verifyDaemon();
    current.nginxConfig = run(NGINX, ['-T']); Object.assign(current, sockets());
    current.proxyHashes = Object.fromEntries(WEB_RELEASE_FILES.map(name => [name, digest(readOwned(`${WEB_RELEASE_PROXY}/${name}`, {privateMode: false}))]));
    const activeText = readOwned(`${RELEASE}/active.json`).toString();
    current.activeFile = parse(activeText); current.activeSha256 = digest(activeText);
    current.activeState = parse(stateText(activeTarget));
    if (before.victim) {
      current.victimChildren = fs.readFileSync(`/proc/${before.victim.process.pid}/task/${before.victim.process.pid}/children`, 'utf8').trim();
      current.victimRuntimeFlags = runtimeFlags(before.victim.process);
      // Guard PID reuse again after the potentially slower nginx/ss commands.
      equal({name: before.victim.process.name, ...processFact(before.victim.process.pid)},
        current.identityProofs.find(p => p.name === before.victim.process.name), 'immediate_identity_changed');
    }
    return current;
  };
  const verifyPersistence = async evidence => assertOnlineRetentionPersistedProcesses(parse(pm(['jlist'])),
    parse(readOwned('/root/.pm2/dump.pm2', {privateMode: false})), evidence);
  return {observe, history, now: () => new Date().toISOString(), wait: ms => new Promise(resolve => setTimeout(resolve, ms)),
    recovery: before => ({version: 2, process: before.victim ? parse(pm(['jlist'])).find(p => p.name === before.victim.process.name) : null}),
    begin: (before, prior) => {assertHeldLocks(lock); if (journal) fail('attempt_already_started'); equal(history(), prior, 'history_changed'); journal = createOnlineRetentionJournal(prior); journal.begin();},
    write: (name, text) => {assertHeldLocks(lock); if (!journal) fail('attempt_not_started'); journal.write(name, text);},
    complete: certificate => {assertHeldLocks(lock); return journal.complete(certificate);},
    finalCheck: async before => {
      const observed = await observe();
      // HTTP probes are finished. Recollect identities, runtime flags, daemon,
      // proxy and sockets immediately before the single permitted stop.
      const current = immediate(observed);
      assertOnlineRetentionPlan(current, history()); equal(stableObservation(current), stableObservation(before), 'pre_stop_changed');
      armed = before.victim ? structuredClone(before) : null; return current;
    },
    stop: async pmId => {
      assertHeldLocks(lock);
      if (!journal || kind !== 'retire' || stopAttempted || !armed || pmId !== armed.victim.process.pmId) fail('stop_not_authorized');
      const prior = history();
      assertOnlineRetentionImmediateStop(armed, immediate(armed), prior);
      stopAttempted = true; pm(['stop', String(pmId)]);
    },
    save: async () => {assertHeldLocks(lock); if (!stopAttempted || saved) fail('save_not_authorized'); saved = true; pm(['save']);},
    verifyPersistence,
    verifyPersisted: async evidence => {
      if (!saved) fail('save_not_authorized');
      await verifyPersistence(evidence);
    },
  };
}

export function createOnlineRetentionProductionOperations(options) {return productionOperations(options);}
function assertHeldLocks(token) {
  const held = token && heldLocks.get(token);
  if (!held || held.deployLock !== DEPLOY_LOCK || held.operation !== OPERATION_LOCK) fail('parent_locks_required');
  assertOnlineToolOwnedPath(DEPLOY_LOCK, 'file'); privateDirectory(OPERATION_LOCK);
  equal(dirIdentity(fs.fstatSync(token.deployFd)), held.deployIdentity, 'deploy_lock_changed');
  equal(dirIdentity(fs.lstatSync(DEPLOY_LOCK)), held.deployIdentity, 'deploy_lock_changed');
  equal(dirIdentity(fs.lstatSync(OPERATION_LOCK)), held.operationIdentity, 'operation_lock_changed');
  if (fs.readdirSync(OPERATION_LOCK).length) fail('operation_lock_changed');
}

// Read-only capability check for post-publication artifact housekeeping. This
// does not mint a token, reacquire a lock, or accept an environment bypass.
export {assertHeldLocks as assertOnlineRetentionHeldLocks};

/** Async lock scope: never release the parent FD or operation lock while an
 * awaited observation, stop, save or fsync is still outstanding. */
export async function withOnlineRetentionLocks(work, {io = fs, spawn = spawnSync,
  checkPath = assertOnlineToolOwnedPath, deployLock = DEPLOY_LOCK, operation = OPERATION_LOCK} = {}) {
  checkPath(path.dirname(deployLock)); checkPath(path.dirname(operation));
  if (exists(deployLock, io)) checkPath(deployLock, 'file');
  const fd = io.openSync(deployLock, fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_NOFOLLOW, 0o600);
  let held = false, captured, token;
  try {
    checkPath(deployLock, 'file'); equal(dirIdentity(io.fstatSync(fd)), dirIdentity(io.lstatSync(deployLock)), 'deploy_lock_changed');
    const result = spawn('flock', ['--nonblock', '3'], {stdio: ['ignore', 'pipe', 'pipe', fd], env: runtimeEnvironment(), timeout: 10000, windowsHide: true});
    if (result.status !== 0 || result.error || result.signal) fail('deploy_lock_busy');
    io.mkdirSync(operation, {mode: 0o700}); held = true; checkPath(operation); captured = dirIdentity(io.lstatSync(operation));
    token = Object.freeze({deployFd: fd, operationDirectory: operation});
    heldLocks.set(token, {deployLock, operation, deployIdentity: dirIdentity(io.fstatSync(fd)), operationIdentity: captured});
    return await work(token);
  } finally {
    if (token) heldLocks.delete(token);
    try {if (held) {checkPath(operation); equal(dirIdentity(io.lstatSync(operation)), captured, 'operation_lock_changed'); io.rmdirSync(operation);}}
    finally {io.closeSync(fd);}
  }
}

export async function runOnlineRetentionUnderHeldLocks(options) {
  assertHeldLocks(options.lock);
  const operations = createOnlineRetentionProductionOperations(options), history = operations.history();
  const first = await operations.observe();
  const result = await executeOnlineRetention(operations, first, history);
  assertHeldLocks(options.lock); return result;
}
export async function runOnlineRetention(options) {
  if (Object.hasOwn(options, 'lock')) fail('unexpected_lock');
  return withOnlineRetentionLocks(lock => runOnlineRetentionUnderHeldLocks({...options, lock}));
}

/** Reconciliation never skips an incomplete receipt. It can only validate one
 * complete five-file tail against the precise previous durable external pin.
 * A synthetic pin is confined to this read-only validation view; the public
 * reader still validates every original byte and rejects real lagging pins. */
export function inspectOnlineRetentionReconciliation({root = ONLINE_RETENTION_ROOT, io = fs,
  readHistory = (location, filesystem) => readOnlineRetentionHistory(location, filesystem)} = {}) {
  let committed;
  try {committed = readHistory(root, io);} catch { /* Inspect one complete tail below; never alter evidence. */ }
  if (committed) {
    if (exists(`${root}.head.json.pending`, io)) fail('unexpected_pending_head');
    return {status: 'already-committed', history: committed};
  }
  const rootStat = privateDirectory(root, io), names = io.readdirSync(root).sort();
  if (!names.length || names.some((name, i) => name !== String(i + 1).padStart(6, '0')) || names.length > 999999) fail('reconcile_history_invalid');
  const sequence = names.length, tail = `${root}/${names.at(-1)}`, tailStat = privateDirectory(tail, io);
  equal(io.readdirSync(tail).sort(), [...ONLINE_RETENTION_FILES].sort(), 'partial_attempt_requires_manual_recovery');
  const texts = new Map(ONLINE_RETENTION_FILES.map(name => [name, readOwned(`${tail}/${name}`, {io})]));
  for (const bytes of texts.values()) equal(bytes, Buffer.from(retentionCanonicalText(parse(bytes))), 'noncanonical_evidence');
  const certificate = parse(texts.get('certificate.json'));
  if (certificate.sequence !== sequence) fail('reconcile_sequence_changed');
  const pinPath = `${root}.head.json`, pendingPath = `${pinPath}.pending`;
  const actualPin = exists(pinPath, io) ? readOwned(pinPath, {io}) : null;
  const previousRecord = {version: 2, policy: ONLINE_RETENTION_POLICY, sequence: sequence - 1, headSha256: certificate.previousSha256};
  if (sequence === 1 ? actualPin !== null || certificate.previousSha256 !== null
    : !actualPin?.equals(Buffer.from(retentionCanonicalText(previousRecord)))) fail('reconcile_pin_not_previous');
  const targetRecord = {version: 2, policy: ONLINE_RETENTION_POLICY, sequence, headSha256: retentionHash(certificate)};
  const targetText = Buffer.from(retentionCanonicalText(targetRecord));
  const pendingText = exists(pendingPath, io) ? readOwned(pendingPath, {io}) : null;
  if (pendingText && !pendingText.equals(targetText)) fail('reconcile_pending_pin_changed');
  const captured = new Map([...ONLINE_RETENTION_FILES.map(name => `${tail}/${name}`),
    ...(actualPin ? [pinPath] : []), ...(pendingText ? [pendingPath] : [])].map(name => [name, identity(io.lstatSync(name))]));
  const view = Object.create(io), virtualFd = -777, borrowed = io.lstatSync(`${tail}/certificate.json`);
  const virtualStat = () => Object.assign(Object.create(borrowed), {size: targetText.length});
  let opened = false;
  view.lstatSync = (name, ...args) => name === pinPath ? virtualStat() : io.lstatSync(name, ...args);
  view.openSync = (name, flags, ...args) => {
    if (name !== pinPath) return io.openSync(name, flags, ...args);
    if (opened || flags & (fs.constants.O_WRONLY | fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_TRUNC)) fail('reconcile_view_invalid');
    opened = true; return virtualFd;
  };
  view.fstatSync = (fd, ...args) => fd === virtualFd ? virtualStat() : io.fstatSync(fd, ...args);
  view.readFileSync = (fd, ...args) => fd === virtualFd ? Buffer.from(targetText) : io.readFileSync(fd, ...args);
  view.closeSync = fd => {if (fd === virtualFd) opened = false; else io.closeSync(fd);};
  const full = readHistory(root, view);
  if (opened) fail('reconcile_view_invalid');
  const previous = {...full, entries: full.entries.slice(0, -1), headSha256: certificate.previousSha256};
  assertOnlineRetentionHistory(previous); equal(full.entries.at(-1), certificate, 'reconcile_tail_changed');
  equal(dirIdentity(privateDirectory(root, io)), dirIdentity(rootStat), 'reconcile_root_changed');
  equal(dirIdentity(privateDirectory(tail, io)), dirIdentity(tailStat), 'reconcile_tail_changed');
  equal(io.readdirSync(root).sort(), names, 'reconcile_listing_changed');
  for (const [name, st] of captured) equal(identity(io.lstatSync(name)), st, 'reconcile_evidence_changed');
  if (exists(pinPath, io) !== (actualPin !== null) || exists(pendingPath, io) !== (pendingText !== null)) fail('reconcile_pin_changed');
  return {status: 'complete-uncommitted-tail', previous, history: full, before: parse(texts.get('before.json')),
    after: parse(texts.get('after.json')), files: Object.fromEntries([...texts].map(([name, bytes]) => [name, digest(bytes)])),
    identities: Object.fromEntries(captured), rootIdentity: dirIdentity(rootStat), tailIdentity: dirIdentity(tailStat),
    pendingHead: pendingText !== null};
}

export async function reconcileOnlineRetentionUnderHeldLocks({toolRevision, lock}) {
  assertHeldLocks(lock); validateTool(toolRevision);
  const first = inspectOnlineRetentionReconciliation();
  if (first.status === 'already-committed') return {status: first.status, sequence: first.history.entries.length, headSha256: first.history.headSha256};
  if (first.before.toolRevision !== toolRevision) fail('reconcile_tool_changed');
  const prefix = () => {equal(inspectOnlineRetentionReconciliation(), first, 'reconcile_evidence_changed'); return first.previous;};
  const operations = productionOperations({toolRevision, lock, kind: first.before.kind,
    activeTarget: first.before.active.target, victimTarget: first.before.victim?.target ?? null}, prefix);
  await operations.wait(2000);
  const current = await operations.observe(first.before);
  assertOnlineRetentionCompletion(first.before, current, first.previous);
  equal(stableObservation(current), stableObservation(first.after), 'reconcile_host_changed');
  if (first.before.kind === 'retire') await operations.verifyPersistence(current);
  // Read the exact complete tail once more after host probes, then only advance
  // the external pin. No stop, save, recovery start, file removal or overwrite.
  prefix(); assertHeldLocks(lock);
  writeHead(ONLINE_RETENTION_ROOT, first.previous, first.history, fs, first.pendingHead);
  equal(readOnlineRetentionHistory(), first.history, 'reconcile_commit_changed');
  return {status: 'reconciled-head-only', sequence: first.history.entries.length, headSha256: first.history.headSha256};
}

export async function onlineRetentionMain(args = process.argv.slice(2)) {
  const [action, ...rest] = args;
  if (process.platform !== 'linux' || process.getuid?.() !== 0) fail('host_required');
  if (action === 'reconcile') {
    if (rest.length !== 1 || !SHA.test(rest[0] ?? '')) fail('invocation_invalid');
    return withOnlineRetentionLocks(lock => reconcileOnlineRetentionUnderHeldLocks({toolRevision: rest[0], lock}));
  }
  const [kind, toolRevision, activeTarget, victimTarget = null, ...extra] = action === 'inspect' ? rest : [action, ...rest];
  if (!['initialize', 'converge', 'retire'].includes(kind) || extra.length || !SHA.test(toolRevision ?? '') ||
      !SHA.test(activeTarget ?? '') || (kind === 'retire' ? !SHA.test(victimTarget ?? '') : victimTarget !== null)) fail('invocation_invalid');
  const options = {kind, toolRevision, activeTarget, victimTarget};
  if (action === 'inspect') {
    const operations = createOnlineRetentionProductionOperations(options), history = operations.history();
    const first = await operations.observe(); assertOnlineRetentionPlan(first, history);
    await operations.wait(2000); const second = await operations.observe(); assertOnlineRetentionPlan(second, history);
    equal(stableObservation(first), stableObservation(second), 'observations_changed');
    return {status: 'eligible-not-executed', kind, sequence: first.sequence, activeTarget,
      rollbackTarget: first.rollback.target, victimTarget, observationSha256: retentionHash(stableObservation(first))};
  }
  const certificate = await runOnlineRetention(options);
  return {status: certificate.status, kind, sequence: certificate.sequence, headSha256: retentionHash(certificate),
    activeTarget, rollbackTarget: certificate.rollback.target, victimTarget, retainedFiles: true, retainedRegistration: true};
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  onlineRetentionMain().then(value => console.log(JSON.stringify(value))).catch(error => {
    console.error(/^online_(retention|tool)_[a-z0-9_]+$/.test(error.message) ? error.message : 'online_retention_writer_failed'); process.exitCode = 1;
  });
}
