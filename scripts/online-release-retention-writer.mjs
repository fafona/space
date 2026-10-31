import * as fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
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
const ownedReconciliationScopes = new WeakMap();
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
  if (!held || held.activeScopeReleased || held.deployLock !== DEPLOY_LOCK || held.operation !== OPERATION_LOCK) fail('parent_locks_required');
  assertExistingOperationScopeHeld(token);
}
function assertExistingOperationScopeHeld(token) {
  const held = token && heldLocks.get(token);
  if (!held) fail('parent_locks_required');
  if (held.activeWindow) {
    const at = Date.now();
    if (at < Date.parse(held.activeWindow.startedAt) || at >= Date.parse(held.activeWindow.deadlineAt)) fail('active_incident_window_expired');
  }
  assertOnlineToolOwnedPath(held.deployLock, 'file');
  equal(dirIdentity(fs.fstatSync(token.deployFd)), held.deployIdentity, 'deploy_lock_changed');
  equal(dirIdentity(fs.lstatSync(held.deployLock)), held.deployIdentity, 'deploy_lock_changed');
  if(held.activeScopeReleased){
    if(exists(held.operation)||!held.activeArchive)fail('operation_lock_changed');
    equal(dirIdentity(privateDirectory(held.activeArchive.destination)),held.activeArchive.original,'active_archive_original_changed');return;
  }
  privateDirectory(held.operation);
  equal(dirIdentity(fs.lstatSync(held.operation)), held.operationIdentity, 'operation_lock_changed');
  if (fs.readdirSync(held.operation).length) fail('operation_lock_changed');
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

// New ACTIVE incident scope, not a relaxation of withOnlineRetentionLocks.
// It retains the ORIGINAL empty operation directory on success AND failure.
// No clear, rename, mkdir of a replacement, archive, or resume is exposed here.
async function withExistingOperationPreparation({deployLock,operation,observe},work) {
  assertOnlineToolOwnedPath(deployLock,'file'); privateDirectory(operation);
  const deployIdentity=dirIdentity(fs.lstatSync(deployLock)),operationIdentity=dirIdentity(fs.lstatSync(operation));
  if(fs.readdirSync(operation).length)fail('operation_lock_changed');
  const fd=fs.openSync(deployLock,fs.constants.O_RDWR|fs.constants.O_NOFOLLOW);let token;
  const started=Date.now(),window=Object.freeze({id:randomUUID(),startedAt:new Date(started).toISOString(),deadlineAt:new Date(started+600000).toISOString()});
  try {
    equal(dirIdentity(fs.fstatSync(fd)),deployIdentity,'deploy_lock_changed');
    equal(dirIdentity(fs.lstatSync(deployLock)),deployIdentity,'deploy_lock_changed');
    const result=spawnSync('flock',['--nonblock','3'],{stdio:['ignore','pipe','pipe',fd],env:runtimeEnvironment(),timeout:10000,windowsHide:true});
    if(result.status!==0||result.error||result.signal)fail('deploy_lock_busy');
    // The independent observer runs AFTER acquiring the kernel lock. Its
    // result is retained as evidence, never trusted as an ownership token.
    const incident=await observe(window);
    equal(dirIdentity(privateDirectory(operation)),operationIdentity,'operation_lock_changed');
    equal(dirIdentity(fs.lstatSync(deployLock)),deployIdentity,'deploy_lock_changed');
    token=Object.freeze({deployFd:fd,operationDirectory:operation});
    heldLocks.set(token,{deployLock,operation,deployIdentity,operationIdentity,activeWindow:window});
    assertExistingOperationScopeHeld(token);
    const resultValue=await work(token,{window,incident});
    assertExistingOperationScopeHeld(token);return resultValue;
  }finally{
    if(token)heldLocks.delete(token);
    // A closed FD releases OUR kernel ownership only. The old operation inode
    // and all evidence stay in place even if observe/work/verification fails.
    fs.closeSync(fd);
  }
}
export async function withActiveBookingIncidentPreparationLocks({toolRevision},work) {
  if(process.platform!=='linux'||process.getuid?.()!==0||typeof work!=='function')fail('active_incident_scope');
  const {reviewedBookingExecution}=await import('./release-toolchain-authority.mjs');
  const authority=reviewedBookingExecution(toolRevision);if(!authority)fail('active_incident_review_required');
  const {inspectActiveBookingIncident}=await import('./release-toolchain-active-generation-incident.mjs');
  return withExistingOperationPreparation({deployLock:DEPLOY_LOCK,operation:OPERATION_LOCK,
    observe:window=>{if(reviewedBookingExecution(toolRevision)!==authority)fail('active_incident_review_changed');return inspectActiveBookingIncident({window});}},
    async(token,context)=>{assertHeldLocks(token);const result=await work(token,context);if(reviewedBookingExecution(toolRevision)!==authority)fail('active_incident_review_changed');return result;});
}

// Distinct post-save profile. The original pre-metadata observer above still
// refuses this state; callers cannot select an observer, resource or old UUID.
export async function withPostSaveBookingPreparationLocks({toolRevision},work){
  if(process.platform!=='linux'||process.getuid?.()!==0||typeof work!=='function')fail('active_incident_scope');
  const {reviewedBookingExecution}=await import('./release-toolchain-authority.mjs'),authority=reviewedBookingExecution(toolRevision);
  if(!authority?.prepared.postSavePartial||authority.prepared.postSavePartial.metadataWriteAllowed!==false||authority.prepared.postSavePartial.processSaveAllowed!==false)fail('active_incident_review_required');
  const {observePostSaveIncident}=await import('./release-toolchain-post-save-evidence.mjs');
  return withExistingOperationPreparation({deployLock:DEPLOY_LOCK,operation:OPERATION_LOCK,observe:async window=>{if(reviewedBookingExecution(toolRevision)!==authority)fail('active_incident_review_changed');const result=await observePostSaveIncident({window});if(result.history.pinsSha256!==authority.prepared.postSavePartial.pinsSha256)fail('active_incident_review_changed');return result.current;}},async(token,context)=>{assertHeldLocks(token);const result=await work(token,context);if(reviewedBookingExecution(toolRevision)!==authority)fail('active_incident_review_changed');return result;});
}

// Separate fixed no-control abort scope. Neither the normal absent-operation
// path nor the original 3566178 active-incident path is relaxed.
export async function withPreControlAbortPreparationLocks({toolRevision},work){
 if(process.platform!=='linux'||process.getuid?.()!==0||typeof work!=='function')fail('active_incident_scope');
 const{reviewedBookingExecution}=await import('./release-toolchain-authority.mjs'),{PRE_CONTROL:H}=await import('./release-toolchain-pre-control-contract.mjs'),{observePreControlUnchanged,preControlPinsSha256}=await import('./release-toolchain-pre-control-evidence.mjs'),authority=reviewedBookingExecution(toolRevision);
 if(authority?.prepared.preControlAbort?.pinsSha256!==preControlPinsSha256()||authority.prepared.preControlAbort.oldToolRevision!==H.toolRevision)fail('active_incident_review_required');
 return withExistingOperationPreparation({deployLock:DEPLOY_LOCK,operation:OPERATION_LOCK,observe:async()=>{if(reviewedBookingExecution(toolRevision)!==authority)fail('active_incident_review_changed');return observePreControlUnchanged();}},async(token,context)=>{
  const held=heldLocks.get(token);held.preControlAbort=Object.freeze({toolRevision,pinsSha256:preControlPinsSha256(),root:H.root,originalInode:H.operationInode});assertPreControlAbortHeldWindow(token,context.window);const result=await work(token,context);if(reviewedBookingExecution(toolRevision)!==authority)fail('active_incident_review_changed');return result;
 });
}
export function assertPreControlAbortHeldWindow(token,window){assertHeldLocks(token);const held=heldLocks.get(token);if(!held.preControlAbort||!isDeepStrictEqual(held.activeWindow,window))fail('pre_control_scope_required');return Object.freeze({...held.preControlAbort});}
export function preControlAbortLockProfile(token){assertHeldLocks(token);const held=heldLocks.get(token);return held.preControlAbort?Object.freeze({...held.preControlAbort,window:structuredClone(held.activeWindow)}):null;}
export function preControlAbortArchiveWitness(token){
 assertExistingOperationScopeHeld(token);const held=heldLocks.get(token),marker=held.preControlAbort;if(!marker)fail('pre_control_scope_required');if(!held.activeArchive)return null;
 const a=held.activeArchive;if(a.vault!==marker.root+'/'+held.activeWindow.id||a.original.ino!==marker.originalInode)fail('active_archive_not_authorized');equal(dirIdentity(privateDirectory(a.destination)),a.original,'active_archive_original_changed');return Object.freeze(structuredClone({...a,window:held.activeWindow,released:held.activeScopeReleased===true}));
}

export async function withPreConnectAbortPreparationLocks({toolRevision},work){
 if(process.platform!=='linux'||process.getuid?.()!==0||typeof work!=='function')fail('active_incident_scope');
 const{reviewedBookingExecution}=await import('./release-toolchain-authority.mjs'),{PRE_CONNECT:H}=await import('./release-toolchain-preconnect-contract.mjs'),{observePreConnectUnchanged,preConnectPinsSha256}=await import('./release-toolchain-preconnect-evidence.mjs'),authority=reviewedBookingExecution(toolRevision);
 if(authority?.prepared.preConnectAbort?.pinsSha256!==preConnectPinsSha256()||authority.prepared.preConnectAbort.oldToolRevision!==H.toolRevision)fail('active_incident_review_required');
 return withExistingOperationPreparation({deployLock:DEPLOY_LOCK,operation:OPERATION_LOCK,observe:async()=>{if(reviewedBookingExecution(toolRevision)!==authority)fail('active_incident_review_changed');return observePreConnectUnchanged();}},async(token,context)=>{
  const held=heldLocks.get(token);held.preConnectAbort=Object.freeze({toolRevision,pinsSha256:preConnectPinsSha256(),root:H.root,originalInode:H.operationInode});assertPreConnectAbortHeldWindow(token,context.window);const result=await work(token,context);if(reviewedBookingExecution(toolRevision)!==authority)fail('active_incident_review_changed');return result;
 });
}
export function assertPreConnectAbortHeldWindow(token,window){assertHeldLocks(token);const held=heldLocks.get(token);if(!held.preConnectAbort||!isDeepStrictEqual(held.activeWindow,window))fail('pre_control_scope_required');return Object.freeze({...held.preConnectAbort});}
export function preConnectAbortLockProfile(token){assertHeldLocks(token);const held=heldLocks.get(token);return held.preConnectAbort?Object.freeze({...held.preConnectAbort,window:structuredClone(held.activeWindow)}):null;}
export function preConnectAbortArchiveWitness(token){
 assertExistingOperationScopeHeld(token);const held=heldLocks.get(token),marker=held.preConnectAbort;if(!marker)fail('pre_control_scope_required');if(!held.activeArchive)return null;
 const a=held.activeArchive;if(a.vault!==marker.root+'/'+held.activeWindow.id||a.original.ino!==marker.originalInode)fail('active_archive_not_authorized');equal(dirIdentity(privateDirectory(a.destination)),a.original,'active_archive_original_changed');return Object.freeze(structuredClone({...a,window:held.activeWindow,released:held.activeScopeReleased===true}));
}

// A separate, exact 8607 pre-intent profile. No older pending profile or the
// normal absent-operation path accepts this state, and no caller chooses IO.
export async function withPreIntentAbortPreparationLocks({toolRevision},work){
 if(process.platform!=='linux'||process.getuid?.()!==0||typeof work!=='function')fail('active_incident_scope');
 const{reviewedBookingExecution}=await import('./release-toolchain-authority.mjs'),{PRE_INTENT:H}=await import('./release-toolchain-pre-intent-pins.mjs'),{observePreIntentUnchanged,preIntentPinsSha256}=await import('./release-toolchain-pre-intent-evidence.mjs'),authority=reviewedBookingExecution(toolRevision);
 if(authority?.prepared.preIntentAbort?.pinsSha256!==preIntentPinsSha256()||authority.prepared.preIntentAbort.oldToolRevision!==H.toolRevision||authority.prepared.preIntentAbort.originalOperationInode!==H.operationInode)fail('active_incident_review_required');
 return withExistingOperationPreparation({deployLock:DEPLOY_LOCK,operation:OPERATION_LOCK,observe:async()=>{if(reviewedBookingExecution(toolRevision)!==authority)fail('active_incident_review_changed');return observePreIntentUnchanged();}},async(token,context)=>{
  const held=heldLocks.get(token);held.preIntentAbort=Object.freeze({toolRevision,pinsSha256:preIntentPinsSha256(),root:H.root,originalInode:H.operationInode});assertPreIntentAbortHeldWindow(token,context.window);const result=await work(token,context);if(reviewedBookingExecution(toolRevision)!==authority)fail('active_incident_review_changed');return result;
 });
}
export function assertPreIntentAbortHeldWindow(token,window){assertHeldLocks(token);const held=heldLocks.get(token);if(!held.preIntentAbort||!isDeepStrictEqual(held.activeWindow,window))fail('pre_intent_scope_required');return Object.freeze({...held.preIntentAbort});}
export function preIntentAbortLockProfile(token){assertHeldLocks(token);const held=heldLocks.get(token);return held.preIntentAbort?Object.freeze({...held.preIntentAbort,window:structuredClone(held.activeWindow)}):null;}
export function preIntentAbortArchiveWitness(token){
 assertExistingOperationScopeHeld(token);const held=heldLocks.get(token),marker=held.preIntentAbort;if(!marker)fail('pre_intent_scope_required');if(!held.activeArchive)return null;
 const archive=held.activeArchive;if(archive.vault!==marker.root+'/'+held.activeWindow.id||archive.original.ino!==marker.originalInode)fail('active_archive_not_authorized');equal(dirIdentity(privateDirectory(archive.destination)),archive.original,'active_archive_original_changed');return Object.freeze(structuredClone({...archive,window:held.activeWindow,released:held.activeScopeReleased===true}));
}

// Exact recovered gate/drain failure. Old preparation factories and their
// protected-resource rules remain unchanged; JSON cannot construct this token.
export async function withOriginRecoveryPreparationLocks({toolRevision},work){
 if(process.platform!=='linux'||process.getuid?.()!==0||typeof work!=='function')fail('active_incident_scope');
 const{reviewedBookingExecution}=await import('./release-toolchain-authority.mjs'),{ORIGIN_RECOVERY:H,originRecoveryProofSha256}=await import('./release-toolchain-origin-recovery-contract.mjs'),{observeRecoveredOriginBeforeClosure}=await import('./release-toolchain-origin-recovery-evidence.mjs'),authority=reviewedBookingExecution(toolRevision);
 if(authority?.prepared.originRecovered?.proofSha256!==originRecoveryProofSha256()||authority.prepared.originRecovered.priorToolRevision!==H.priorTool)fail('active_incident_review_required');
 return withExistingOperationPreparation({deployLock:DEPLOY_LOCK,operation:OPERATION_LOCK,observe:async()=>{if(reviewedBookingExecution(toolRevision)!==authority)fail('active_incident_review_changed');return observeRecoveredOriginBeforeClosure();}},async(token,context)=>{
  const held=heldLocks.get(token);held.originRecovery=Object.freeze({toolRevision,proofSha256:originRecoveryProofSha256(),root:H.root,originalInode:H.operationInode});assertOriginRecoveryHeldWindow(token,context.window);const result=await work(token,context);if(reviewedBookingExecution(toolRevision)!==authority)fail('active_incident_review_changed');return result;
 });
}
export function assertOriginRecoveryHeldWindow(token,window){assertHeldLocks(token);const held=heldLocks.get(token);if(!held.originRecovery||!isDeepStrictEqual(held.activeWindow,window))fail('origin_recovery_scope_required');return Object.freeze({...held.originRecovery});}
export function originRecoveryLockProfile(token){assertHeldLocks(token);const held=heldLocks.get(token);return held.originRecovery?Object.freeze({...held.originRecovery,window:structuredClone(held.activeWindow)}):null;}
export function originRecoveryArchiveWitness(token){
 assertExistingOperationScopeHeld(token);const held=heldLocks.get(token),marker=held.originRecovery;if(!marker)fail('origin_recovery_scope_required');if(!held.activeArchive)return null;
 const a=held.activeArchive;if(a.vault!==marker.root+'/'+held.activeWindow.id||a.original.ino!==marker.originalInode)fail('active_archive_not_authorized');equal(dirIdentity(privateDirectory(a.destination)),a.original,'active_archive_original_changed');return Object.freeze(structuredClone({...a,window:held.activeWindow,released:held.activeScopeReleased===true}));
}

// Independent recovery of ONE post-metadata interruption. It retains the old
// OP inode even on success. No archive/release/publication capability is issued.
export async function withInterruptedPublicationRecoveryLocks({toolRevision},work){
 if(process.platform!=='linux'||process.getuid?.()!==0||typeof work!=='function')fail('interrupted_recovery_scope');
 const {reviewedBookingExecution}=await import('./release-toolchain-authority.mjs'),{interruptedRecoveryBindingSha256}=await import('./release-toolchain-interrupted-recovery-contract.mjs'),{observeInterruptedPhysical}=await import('./release-toolchain-interrupted-recovery-evidence.mjs'),authority=reviewedBookingExecution(toolRevision);
 if(authority?.prepared.interruptedRecovery?.bindingSha256!==interruptedRecoveryBindingSha256())fail('active_incident_review_required');
 return withExistingOperationPreparation({deployLock:DEPLOY_LOCK,operation:OPERATION_LOCK,observe:()=>observeInterruptedPhysical()},async(token,context)=>{
  const held=heldLocks.get(token);held.interruptedRecovery=Object.freeze({toolRevision,bindingSha256:interruptedRecoveryBindingSha256()});assertInterruptedPublicationRecoveryHeld(token,context.window);const result=await work(token,context);if(reviewedBookingExecution(toolRevision)!==authority)fail('active_incident_review_changed');return result;
 });
}
export function assertInterruptedPublicationRecoveryHeld(token,window){assertHeldLocks(token);const held=heldLocks.get(token);if(!held.interruptedRecovery||!isDeepStrictEqual(held.activeWindow,window))fail('interrupted_recovery_scope_required');return held.interruptedRecovery;}

// Independent recovery has completed; this distinct capability can preserve
// its aborted journal/publication and archive the old OP. Recovery-only and
// normal absent-OP factories keep their original refusal rules unchanged.
export async function withRecoveredPublicationDispositionLocks({toolRevision},work){
 if(process.platform!=='linux'||process.getuid?.()!==0||typeof work!=='function')fail('recovered_disposition_scope');
 const{reviewedBookingExecution}=await import('./release-toolchain-authority.mjs'),{recoveredPublicationBindingSha256}=await import('./release-toolchain-recovered-publication-contract.mjs'),{observeRecoveredPublication}=await import('./release-toolchain-recovered-publication-evidence.mjs'),authority=reviewedBookingExecution(toolRevision);
 if(authority?.prepared.recoveredPublication?.bindingSha256!==recoveredPublicationBindingSha256())fail('active_incident_review_required');
 return withExistingOperationPreparation({deployLock:DEPLOY_LOCK,operation:OPERATION_LOCK,observe:async()=>{if(reviewedBookingExecution(toolRevision)!==authority)fail('active_incident_review_changed');return observeRecoveredPublication();}},async(token,context)=>{
  const held=heldLocks.get(token);held.recoveredDisposition=Object.freeze({toolRevision,bindingSha256:recoveredPublicationBindingSha256()});assertRecoveredPublicationDispositionHeld(token,context.window);const result=await work(token,context);if(reviewedBookingExecution(toolRevision)!==authority)fail('active_incident_review_changed');return result;
 });
}
export function assertRecoveredPublicationDispositionHeld(token,window){
 assertExistingOperationScopeHeld(token);const held=heldLocks.get(token);
 if(held.deployLock!==DEPLOY_LOCK||held.operation!==OPERATION_LOCK||!held.recoveredDisposition||window!==undefined&&!isDeepStrictEqual(held.activeWindow,window))fail('recovered_disposition_scope_required');
 return Object.freeze({...held.recoveredDisposition});
}
export function recoveredPublicationDispositionArchiveWitness(token){
 assertRecoveredPublicationDispositionHeld(token);const held=heldLocks.get(token);if(!held.activeArchive)return null;const archive=held.activeArchive;
 if(archive.vault!=='/var/lib/faolla-booking-recovered-publications/5871a892-48f7-4c14-a4e8-40e8f2111953/'+held.activeWindow.id||archive.original.ino!==2624961)fail('active_archive_not_authorized');equal(dirIdentity(privateDirectory(archive.destination)),archive.original,'active_archive_original_changed');return Object.freeze(structuredClone({...archive,released:held.activeScopeReleased===true}));
}
// A distinct, reviewed recovered-before-ingress scope. The normal absent-OP
// factory, old recovery/disposition grammars and unknown-state refusals stay.
export async function withSettledPreIngressLocks({toolRevision},work){
 if(process.platform!=='linux'||process.getuid?.()!==0||typeof work!=='function')fail('settled_pre_ingress_scope');
 const{reviewedBookingExecution}=await import('./release-toolchain-authority.mjs'),{settledPreIngressBindingSha256}=await import('./release-toolchain-settled-pre-ingress-contract.mjs'),{observeSettledPreIngress}=await import('./release-toolchain-settled-pre-ingress-evidence.mjs'),authority=reviewedBookingExecution(toolRevision);
 if(authority?.prepared.settledPreIngress?.bindingSha256!==settledPreIngressBindingSha256())fail('active_incident_review_required');
 return withExistingOperationPreparation({deployLock:DEPLOY_LOCK,operation:OPERATION_LOCK,observe:async()=>{if(reviewedBookingExecution(toolRevision)!==authority)fail('active_incident_review_changed');return observeSettledPreIngress();}},async(token,context)=>{const held=heldLocks.get(token);held.settledPreIngress=Object.freeze({toolRevision,bindingSha256:settledPreIngressBindingSha256()});assertSettledPreIngressHeld(token,context.window);const result=await work(token,context);if(reviewedBookingExecution(toolRevision)!==authority)fail('active_incident_review_changed');return result;});
}
export function assertSettledPreIngressHeld(token,window){assertExistingOperationScopeHeld(token);const held=heldLocks.get(token);if(held.deployLock!==DEPLOY_LOCK||held.operation!==OPERATION_LOCK||!held.settledPreIngress||window!==undefined&&!isDeepStrictEqual(held.activeWindow,window))fail('settled_pre_ingress_scope_required');return Object.freeze({...held.settledPreIngress});}
export function settledPreIngressArchiveWitness(token){assertSettledPreIngressHeld(token);const held=heldLocks.get(token);if(!held.activeArchive)return null;const a=held.activeArchive;if(a.vault!=='/var/lib/faolla-booking-settled-pre-ingress/6866d6a1-a8b7-4377-8ad4-af6e609a506b/'+held.activeWindow.id||a.original.ino!==2624964)fail('active_archive_not_authorized');equal(dirIdentity(privateDirectory(a.destination)),a.original,'active_archive_original_changed');return Object.freeze(structuredClone({...a,released:held.activeScopeReleased===true}));}

// Separate exact prepared-worker/pre-supervisor state. No old lock factory,
// resource grammar or unknown-state refusal is relaxed by this capability.
export async function withPreSupervisorLocks({toolRevision},work){
 if(process.platform!=='linux'||process.getuid?.()!==0||typeof work!=='function')fail('pre_supervisor_scope');
 const{reviewedBookingExecution}=await import('./release-toolchain-authority.mjs'),{preSupervisorBindingSha256}=await import('./release-toolchain-pre-supervisor-contract.mjs'),{observePreSupervisor}=await import('./release-toolchain-pre-supervisor-evidence.mjs'),authority=reviewedBookingExecution(toolRevision);
 if(authority?.prepared.preSupervisor?.bindingSha256!==preSupervisorBindingSha256())fail('active_incident_review_required');
 return withExistingOperationPreparation({deployLock:DEPLOY_LOCK,operation:OPERATION_LOCK,observe:async()=>{if(reviewedBookingExecution(toolRevision)!==authority)fail('active_incident_review_changed');return observePreSupervisor();}},async(token,context)=>{const held=heldLocks.get(token);held.preSupervisor=Object.freeze({toolRevision,bindingSha256:preSupervisorBindingSha256()});assertPreSupervisorHeld(token,context.window);const result=await work(token,context);if(reviewedBookingExecution(toolRevision)!==authority)fail('active_incident_review_changed');return result;});
}
export function assertPreSupervisorHeld(token,window){assertExistingOperationScopeHeld(token);const held=heldLocks.get(token);if(held.deployLock!==DEPLOY_LOCK||held.operation!==OPERATION_LOCK||!held.preSupervisor||window!==undefined&&!isDeepStrictEqual(held.activeWindow,window))fail('pre_supervisor_scope_required');return Object.freeze({...held.preSupervisor});}
export function preSupervisorArchiveWitness(token){assertPreSupervisorHeld(token);const held=heldLocks.get(token);if(!held.activeArchive)return null;const a=held.activeArchive;if(a.vault!=='/var/lib/faolla-booking-pre-supervisor/b1bd706f-ea38-4d48-a8cd-8c239bbb99c5/'+held.activeWindow.id||a.original.ino!==2624966)fail('active_archive_not_authorized');equal(dirIdentity(privateDirectory(a.destination)),a.original,'active_archive_original_changed');return Object.freeze(structuredClone({...a,released:held.activeScopeReleased===true}));}
// Owned native acceptance of the SAME flock/OP/CAS/sequencer primitives. This
// factory allocates every path itself; it accepts no host path, FD or command.
// On the formal host its enclosing qualifier independently compares runtime,
// data and metadata before/after. Fixtures and unknowns are never deleted.
export async function acceptInterruptedPublicationRecoveryKernel(){
 if(process.platform!=='linux'||process.getuid?.()!==0)fail('native_linux_root_required');
 const {executeInterruptedRecovery}=await import('./release-toolchain-interrupted-recovery-contract.mjs'),{bookingHostReplace,bookingHostWriteOnce,bookingHostRead}=await import('./booking-handoff-host-io.mjs');
 const root=fs.mkdtempSync('/var/lib/faolla-interrupted-recovery-native-');fs.chmodSync(root,0o700);const rootIdentity=dirIdentity(privateDirectory(root));
 const cases=[];
 for(const outcome of ['normal','wrong-metadata','unknown-after-route','unknown-after-metadata','operation-drift']){
  equal(dirIdentity(privateDirectory(root)),rootIdentity,'ci_fixture_redirected');const directory=root+'/'+outcome;fs.mkdirSync(directory,{mode:0o700});const deploy=directory+'/deploy.lock',op=directory+'/operation.lock';privateWrite(deploy,'native-owned-deploy\n');fs.mkdirSync(op,{mode:0o700});const original=dirIdentity(fs.lstatSync(op));
  for(const file of ['route-a.conf','route-b.conf','active.json'])privateWrite(directory+'/'+file,'native-primary\n');
  privateWrite(directory+'/partial-journal.json','native-pending-never-completed\n');const pending=identity(fs.lstatSync(directory+'/partial-journal.json'));let cause,done=false;
  try{await withExistingOperationPreparation({deployLock:deploy,operation:op,observe:()=>({nativeOnly:true})},async token=>{
   assertExistingOperationScopeHeld(token);
   const busy=spawnSync('flock',['--nonblock',deploy,'true'],{env:runtimeEnvironment(),encoding:'utf8',timeout:10000});if(busy.status!==1||busy.error||busy.signal)fail('ci_real_lock_not_held');
   let leaked=false;try{assertHeldLocks(token);leaked=true;}catch{}if(leaked)fail('ci_token_production_leak');
   const checked=()=>{assertExistingOperationScopeHeld(token);equal(dirIdentity(fs.lstatSync(op)),original,'ci_original_operation_changed');};
   await executeInterruptedRecovery({assertHeld:checked,
    inspect:()=>bookingHostWriteOnce(directory+'/intent.json','native-exclusive-intent\n'),
    preserve:()=>{if(outcome==='operation-drift'){fs.renameSync(op,directory+'/displaced-operation.lock');fs.mkdirSync(op,{mode:0o700});}},
    routeRollback:()=>{for(const file of ['route-a.conf','route-b.conf'])bookingHostReplace(directory+'/'+file,'native-primary\n','native-rollback\n','native-recovery');if(outcome==='unknown-after-route')throw Error('native_recovery_unknown_after_route');},
    publicProof:()=>{},metadata:()=>{bookingHostReplace(directory+'/active.json',outcome==='wrong-metadata'?'foreign\n':'native-primary\n','native-rollback\n','native-recovery');if(outcome==='unknown-after-metadata')throw Error('native_recovery_unknown_after_metadata');},
    verify:()=>{for(const file of ['route-a.conf','route-b.conf','active.json'])equal(bookingHostRead(directory+'/'+file),'native-rollback\n','ci_readback_invalid');},
    complete:()=>{bookingHostWriteOnce(directory+'/completed.json','native-recovery-only-completed\n');done=true;},
    failure:(error,stage)=>bookingHostWriteOnce(directory+'/unconfirmed.json',retentionCanonicalText({stage,errorSha256:digest(String(error.message)),automaticRetryAllowed:false,publicationAuthority:false}))
   });
  });}catch(error){cause=error;}
  if(outcome==='normal'){if(cause||!done||!exists(directory+'/completed.json'))fail('ci_recovery_unconfirmed');}
  else if(!cause||done||exists(directory+'/completed.json')||!exists(directory+'/unconfirmed.json'))fail('ci_unknown_not_retained');
  equal(identity(fs.lstatSync(directory+'/partial-journal.json')),pending,'ci_partial_history_changed');equal(bookingHostRead(directory+'/partial-journal.json'),'native-pending-never-completed\n','ci_partial_history_changed');
  equal(dirIdentity(fs.lstatSync(outcome==='operation-drift'?directory+'/displaced-operation.lock':op)),original,'ci_original_operation_lost');
  // An exclusive intent prevents a second execution from replaying writes.
  let replay=false;try{bookingHostWriteOnce(directory+'/intent.json','replay\n');}catch{replay=true;}if(!replay)fail('ci_replay_accepted');
  cases.push({outcome,completed:done,originalOperationPreserved:true,partialJournalPreserved:true,unknownEvidenceRetained:outcome!=='normal',productionAuthority:false});
 }
 const proof={kind:'interrupted-recovery-owned-kernel-cas-accepted',cases,actualFlock:true,actualCas:true,productionTokenRejected:true,formalHostTouched:false,allFixturesRetained:true,publicationAuthority:false};privateWrite(root+'/verified.json',retentionCanonicalText(proof));return{root,sha256:digest(readOwned(root+'/verified.json')),proof};
}

// Closed disposable CI entry: same actual FD/flock/inode implementation, but a
// separate owned resource identity. Its tokens MUST fail production admission.
export async function acceptActiveIncidentPreparationLocksInCi() {
  const anchors=['/root/.pm2/pm2.pid','/var/lib/faolla-online-release/active.json','/www/wwwroot/merchant-space.current'];
  if(process.platform!=='linux'||process.getuid?.()!==0||process.env.GITHUB_ACTIONS!=='true'||process.env.RUNNER_ENVIRONMENT!=='github-hosted'||process.env.FAOLLA_RELEASE_PRODUCTION_EQ!=='1'||anchors.some(f=>exists(f)))fail('ci_only');
  const root=fs.mkdtempSync('/var/lib/faolla-active-lock-ci-');fs.chmodSync(root,0o700);
  privateWrite(root+'/started.json',retentionCanonicalText({kind:'active-incident-preparation-lock-ci-started',syntheticInputsOnly:true,at:new Date().toISOString()}));
  let stage='owned-resource-preparation';try{
  const deployLock=root+'/deploy.lock',operation=root+'/operation.lock';privateWrite(deployLock,'owned-ci-lock\n');fs.mkdirSync(operation,{mode:0o700});syncDirectory(root);
  const original=dirIdentity(fs.lstatSync(operation)),cases=[];
  const resource={deployLock,operation,observe:async()=>({syntheticOnly:true,publicationAuthority:false})};
  const kernelAvailable=()=>{const r=spawnSync('flock',['--nonblock',deployLock,'true'],{env:runtimeEnvironment(),timeout:10000,windowsHide:true});if(r.error||r.signal||![0,1].includes(r.status))fail('ci_lock_probe');return r.status===0;};
  stage='actual-flock-and-production-token-refusal';let withdrawn;
  await withExistingOperationPreparation(resource,async token=>{
    withdrawn=token;
    assertExistingOperationScopeHeld(token);if(kernelAvailable())fail('ci_lock_not_held');
    let rejected=false;try{assertHeldLocks(token);}catch{rejected=true;}if(!rejected)fail('ci_token_production_leak');
    let nested=false;try{await withExistingOperationPreparation(resource,()=>{nested=true;});fail('ci_parallel_accepted');}catch(e){if(e.message!=='online_retention_writer_deploy_lock_busy')throw e;}
    if(nested)fail('ci_parallel_observed');
  });
  let revoked=false;try{assertExistingOperationScopeHeld(withdrawn);}catch{revoked=true;}if(!revoked)fail('ci_token_not_revoked');
  equal(dirIdentity(fs.lstatSync(operation)),original,'ci_operation_changed');if(!kernelAvailable())fail('ci_lock_not_released');cases.push('success-retains-original-inode-and-releases-own-flock');
  stage='unknown-work-result';const originalError=Error('owned-ci-unknown-result');let caught;
  try{await withExistingOperationPreparation(resource,async token=>{assertExistingOperationScopeHeld(token);await Promise.resolve();throw originalError;});}catch(e){caught=e;}
  if(caught!==originalError)fail('ci_original_error_lost');equal(dirIdentity(fs.lstatSync(operation)),original,'ci_operation_changed');if(!kernelAvailable())fail('ci_lock_not_released');cases.push('work-failure-retains-original-inode');
  stage='observer-refusal';let workCalled=false;caught=null;
  try{await withExistingOperationPreparation({...resource,observe:()=>{throw originalError;}},()=>{workCalled=true;});}catch(e){caught=e;}
  if(caught!==originalError||workCalled)fail('ci_observer_bypass');equal(dirIdentity(fs.lstatSync(operation)),original,'ci_operation_changed');if(!kernelAvailable())fail('ci_lock_not_released');cases.push('observer-refusal-never-enters-work');
  stage='observer-inode-replacement';caught=null;const replaced=root+'/original-operation-retained';
  try{await withExistingOperationPreparation({...resource,observe:()=>{fs.renameSync(operation,replaced);fs.mkdirSync(operation,{mode:0o700});return{};}},()=>{workCalled=true;});}catch(e){caught=e;}
  if(caught?.message!=='online_retention_writer_operation_lock_changed'||workCalled)fail('ci_replacement_accepted');equal(dirIdentity(fs.lstatSync(replaced)),original,'ci_original_inode_lost');if(!kernelAvailable())fail('ci_lock_not_released');cases.push('observer-directory-replacement-refused');
  for(const outcome of ['normal','unknown']){
    stage='original-inode-archive-'+outcome;const parent=root+'/archive-'+outcome;fs.mkdirSync(parent,{mode:0o700});syncDirectory(root);
    const deploy=parent+'/deploy.lock',op=parent+'/operation.lock',vault=parent+'/vault';privateWrite(deploy,'owned-ci-lock\n');fs.mkdirSync(op,{mode:0o700});fs.mkdirSync(vault,{mode:0o700});syncDirectory(parent);
    const old=dirIdentity(fs.lstatSync(op));let archived,cause;
    try{await withExistingOperationPreparation({deployLock:deploy,operation:op,observe:async()=>({syntheticOnly:true})},async token=>{
      archived=archiveOwnedExistingOperation(token,vault,'a'.repeat(64));assertExistingOperationScopeHeld(token);
      const probe=spawnSync('flock',['--nonblock',deploy,'true'],{env:runtimeEnvironment(),timeout:10000,windowsHide:true});if(probe.status!==1||probe.error||probe.signal)fail('ci_archive_kernel_lock_lost');
      let duplicate=false;try{archiveOwnedExistingOperation(token,vault,'a'.repeat(64));}catch{duplicate=true;}if(!duplicate)fail('ci_archive_replay_accepted');
      if(outcome==='unknown')throw originalError;
    });}catch(e){cause=e;}
    if(outcome==='unknown'?cause!==originalError:cause!==undefined)fail('ci_archive_cause_changed');
    equal(dirIdentity(fs.lstatSync(vault+'/operation.lock')),old,'ci_original_inode_lost');
    if(isDeepStrictEqual(dirIdentity(fs.lstatSync(op)),old)||!archived||fs.readdirSync(op).length)fail('ci_replacement_scope_invalid');
    cases.push('archive-'+outcome+'-preserves-old-inode-and-retains-owned-replacement');
  }
  stage='uncertain-after-original-rename';{
    const parent=root+'/archive-mid-rename';fs.mkdirSync(parent,{mode:0o700});syncDirectory(root);
    const deploy=parent+'/deploy.lock',op=parent+'/operation.lock',vault=parent+'/vault';privateWrite(deploy,'owned-ci-lock\n');fs.mkdirSync(op,{mode:0o700});fs.mkdirSync(vault,{mode:0o700});syncDirectory(parent);const old=dirIdentity(fs.lstatSync(op));let cause;
    try{await withExistingOperationPreparation({deployLock:deploy,operation:op,observe:async()=>({syntheticOnly:true})},token=>archiveOwnedExistingOperation(token,vault,'a'.repeat(64),()=>{throw originalError;}));}catch(e){cause=e;}
    if(cause!==originalError||exists(op)||exists(vault+'/operation-archived.json')||!exists(vault+'/operation-archive-attempt.json'))fail('ci_archive_unknown_false_receipt');equal(dirIdentity(fs.lstatSync(vault+'/operation.lock')),old,'ci_original_inode_lost');
    let entered=false;try{await withExistingOperationPreparation({deployLock:deploy,operation:op,observe:async()=>({})},()=>{entered=true;});}catch{}
    if(entered)fail('ci_archive_unknown_reentered');cases.push('mid-rename-unknown-retains-original-inode-and-refuses-reentry');
  }
  if(anchors.some(f=>exists(f)))fail('ci_formal_anchor_created');
  const result={kind:'active-incident-preparation-lock-native-acceptance',root,cases,realKernelFlock:true,productionTokensRejected:true,allOriginalEvidenceRetained:true,formalHostTouched:false,publicationAuthority:false,mailEnabled:false,completedAt:new Date().toISOString()};
  privateWrite(root+'/acceptance.json',retentionCanonicalText(result));return result;
  }catch(error){
    try{const {stageFailureDiagnostic}=await import('./release-toolchain-diagnostics.mjs');const toolRevision=path.basename(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
      privateWrite(root+'/failure.json',retentionCanonicalText({stage,diagnostic:stageFailureDiagnostic(error,{stage:'candidate',toolRevision,knownFiles:['online-release-retention-writer.mjs','release-toolchain-active-generation-lock-acceptance.mjs']}),syntheticInputsOnly:true,at:new Date().toISOString()}));
    }catch{/* A diagnostic failure cannot replace the original refusal. */}
    throw error;
  }
}

// Closed CI composition of the no-control abort's actual archive/release
// primitives. No resource arguments, formal marker, or production action token.
export async function acceptPreControlAbortClosureInCi(){
 const anchors=['/root/.pm2/pm2.pid','/var/lib/faolla-online-release/active.json','/www/wwwroot/merchant-space.current'];
 if(process.platform!=='linux'||process.getuid?.()!==0||process.env.GITHUB_ACTIONS!=='true'||process.env.RUNNER_ENVIRONMENT!=='github-hosted'||process.env.FAOLLA_RELEASE_PRODUCTION_EQ!=='1'||anchors.some(f=>exists(f)))fail('ci_only');
 const root=fs.mkdtempSync('/var/lib/faolla-pre-control-ci-');fs.chmodSync(root,0o700);const cases=[];let stage='prepare';
 privateWrite(root+'/started.json',retentionCanonicalText({kind:'pre-control-abort-composition-started',syntheticInputsOnly:true,formalHostTouched:false,publicationAuthority:false}));
 try{
  stage='source-file-mode-boundary';const{readOwnedSourceHelperSha256}=await import('./release-toolchain-pre-control-evidence.mjs'),{bookingHostRead}=await import('./booking-handoff-host-io.mjs'),helper=root+'/owned-source-helper.py';privateWrite(helper,'# owned synthetic source, no private values\n');fs.chmodSync(helper,0o644);let privateRefused=false;try{bookingHostRead(helper,{binary:true});}catch{privateRefused=true;}if(!privateRefused)fail('ci_private_reader_relaxed');equal(readOwnedSourceHelperSha256(helper),digest(fs.readFileSync(helper)),'ci_source_read_failed');fs.chmodSync(helper,0o666);let writableRefused=false;try{readOwnedSourceHelperSha256(helper);}catch{writableRefused=true;}fs.chmodSync(helper,0o644);if(!writableRefused)fail('ci_writable_source_accepted');cases.push('owned-source-mode-read-is-explicit-and-private-evidence-remains-strict');
  for(const outcome of ['normal','wrong-completion','unknown-after-archive']){
   stage=outcome;const parent=root+'/'+outcome;fs.mkdirSync(parent,{mode:0o700});const deployLock=parent+'/deploy.lock',operation=parent+'/operation.lock',publication=parent+'/publication',vault=parent+'/vault';privateWrite(deployLock,'owned-only\n');for(const directory of [operation,publication,vault])fs.mkdirSync(directory,{mode:0o700});syncDirectory(parent);
   const names=['controller-exit-unconfirmed.json','publication-attempt.json','publication-unconfirmed.json','rollback-readiness.json','worker-attempt.json','worker-unconfirmed.json'];for(const name of names)privateWrite(publication+'/'+name,retentionCanonicalText({kind:'synthetic-pre-control-'+name,containsPrivateEnvironment:false}));
   const original=dirIdentity(fs.lstatSync(operation)),publicationIdentity=dirIdentity(fs.lstatSync(publication)),files=Object.fromEntries(names.map(n=>[n,digest(readOwned(publication+'/'+n))])),closure={directory:vault,sha256:'a'.repeat(64)};let caught,replacement;
   try{await withExistingOperationPreparation({deployLock,operation,observe:async()=>({syntheticInputsOnly:true})},async token=>{
    let productionRejected=false;try{assertPreControlAbortHeldWindow(token,heldLocks.get(token).activeWindow);}catch{productionRejected=true;}if(!productionRejected)fail('ci_token_production_leak');
    const archived=archiveOwnedExistingOperation(token,vault,closure.sha256);replacement=archived.replacement;fs.renameSync(publication,vault+'/publication');syncDirectory(parent);syncDirectory(vault);equal(dirIdentity(fs.lstatSync(vault+'/publication')),publicationIdentity,'ci_publication_inode_lost');
    if(outcome==='unknown-after-archive')throw Error('owned-pre-control-unknown');
    privateWrite(vault+'/reconciliation-completed.json',retentionCanonicalText({kind:outcome==='normal'?'pre-control-worker-attempt-reconciled':'foreign-completion',closureSha256:closure.sha256,archiveSha256:digest(readOwned(vault+'/operation-archived.json')),publicationAuthority:false}));
    releaseArchivedReplacement(token,closure,'pre-control-worker-attempt-reconciled','pre-control-abort-replacement');assertExistingOperationScopeHeld(token);
    if(exists(operation))fail('ci_replacement_not_released');if(JSON.parse(readOwned(vault+'/replacement-released.json')).kind!=='pre-control-abort-replacement-released')fail('ci_release_receipt_changed');
   });}catch(error){caught=error;}
   equal(dirIdentity(fs.lstatSync(vault+'/operation.lock')),original,'ci_original_inode_lost');equal(dirIdentity(fs.lstatSync(vault+'/publication')),publicationIdentity,'ci_publication_inode_lost');equal(fs.readdirSync(vault+'/publication').sort(),[...names].sort(),'ci_original_files_lost');for(const name of names)equal(digest(readOwned(vault+'/publication/'+name)),files[name],'ci_original_bytes_changed');
   const probe=spawnSync('flock',['--nonblock',deployLock,'true'],{env:runtimeEnvironment(),timeout:10000,windowsHide:true});if(probe.status!==0||probe.error||probe.signal)fail('ci_deploy_lock_not_released');
   if(outcome==='normal'){if(caught||exists(operation))fail('ci_abort_normal_failed');cases.push('normal-retains-both-inodes-and-all-six-files-releases-only-owned-replacement');}
   else{if(!caught||exists(vault+'/replacement-released.json')||!replacement)fail('ci_unknown_false_success');equal(dirIdentity(fs.lstatSync(operation)),replacement,'ci_unknown_replacement_lost');if(outcome==='wrong-completion'&&caught.message!=='online_retention_writer_active_archive_not_authorized')throw caught;cases.push(outcome+'-retains-originals-and-blocks-release');}
  }
  if(anchors.some(f=>exists(f)))fail('ci_formal_anchor_created');const result={kind:'pre-control-abort-native-composition-accepted',root,cases,realKernelFlock:true,productionTokensRejected:true,bothOriginalInodesRetained:true,allSixOriginalFilesRetained:true,processControlPerformed:false,processSavePerformed:false,businessSqlWritten:false,formalHostTouched:false,publicationAuthority:false,completedAt:new Date().toISOString()};privateWrite(root+'/acceptance.json',retentionCanonicalText(result));return result;
 }catch(error){privateWrite(root+'/failure.json',retentionCanonicalText({kind:'pre-control-abort-native-composition-unconfirmed',stage,errorSha256:digest(String(error?.message??'unknown')),automaticRetryAllowed:false,publicationAuthority:false}));throw error;}
}

export async function acceptPreConnectAbortClosureInCi(){
 const anchors=['/root/.pm2/pm2.pid','/var/lib/faolla-online-release/active.json','/www/wwwroot/merchant-space.current'];
 if(process.platform!=='linux'||process.getuid?.()!==0||process.env.GITHUB_ACTIONS!=='true'||process.env.RUNNER_ENVIRONMENT!=='github-hosted'||process.env.FAOLLA_RELEASE_PRODUCTION_EQ!=='1'||anchors.some(f=>exists(f)))fail('ci_only');
 const root=fs.mkdtempSync('/var/lib/faolla-preconnect-ci-');fs.chmodSync(root,0o700);const cases=[];let stage='prepare';
 privateWrite(root+'/started.json',retentionCanonicalText({kind:'preconnect-abort-composition-started',syntheticInputsOnly:true,formalHostTouched:false,publicationAuthority:false}));
 try{
  stage='source-file-mode-boundary';const{readOwnedSourceHelperSha256}=await import('./release-toolchain-preconnect-evidence.mjs'),{bookingHostRead}=await import('./booking-handoff-host-io.mjs'),helper=root+'/owned-source-helper.py';privateWrite(helper,'# owned synthetic source, no private values\n');fs.chmodSync(helper,0o644);let privateRefused=false;try{bookingHostRead(helper,{binary:true});}catch{privateRefused=true;}if(!privateRefused)fail('ci_private_reader_relaxed');equal(readOwnedSourceHelperSha256(helper),digest(fs.readFileSync(helper)),'ci_source_read_failed');fs.chmodSync(helper,0o666);let writableRefused=false;try{readOwnedSourceHelperSha256(helper);}catch{writableRefused=true;}fs.chmodSync(helper,0o644);if(!writableRefused)fail('ci_writable_source_accepted');cases.push('owned-source-mode-read-is-explicit-and-private-evidence-remains-strict');
  for(const outcome of ['normal','wrong-completion','unknown-after-archive']){
   stage=outcome;const parent=root+'/'+outcome;fs.mkdirSync(parent,{mode:0o700});const deployLock=parent+'/deploy.lock',operation=parent+'/operation.lock',publication=parent+'/publication',vault=parent+'/vault';privateWrite(deployLock,'owned-only\n');for(const directory of [operation,publication,vault])fs.mkdirSync(directory,{mode:0o700});syncDirectory(parent);
   const names=['controller-exit-unconfirmed.json','publication-attempt.json','publication-unconfirmed.json','rollback-readiness.json','worker-attempt.json','worker-refused-before-connect.json','worker-unconfirmed.json'];for(const name of names)privateWrite(publication+'/'+name,retentionCanonicalText({kind:'synthetic-preconnect-'+name,containsPrivateEnvironment:false}));
   const original=dirIdentity(fs.lstatSync(operation)),publicationIdentity=dirIdentity(fs.lstatSync(publication)),files=Object.fromEntries(names.map(n=>[n,digest(readOwned(publication+'/'+n))])),closure={directory:vault,sha256:'a'.repeat(64)};let caught,replacement;
   try{await withExistingOperationPreparation({deployLock,operation,observe:async()=>({syntheticInputsOnly:true})},async token=>{
    let productionRejected=false;try{assertPreConnectAbortHeldWindow(token,heldLocks.get(token).activeWindow);}catch{productionRejected=true;}if(!productionRejected)fail('ci_token_production_leak');
    const archived=archiveOwnedExistingOperation(token,vault,closure.sha256);replacement=archived.replacement;fs.renameSync(publication,vault+'/publication');syncDirectory(parent);syncDirectory(vault);equal(dirIdentity(fs.lstatSync(vault+'/publication')),publicationIdentity,'ci_publication_inode_lost');
    if(outcome==='unknown-after-archive')throw Error('owned-preconnect-unknown');
    privateWrite(vault+'/reconciliation-completed.json',retentionCanonicalText({kind:outcome==='normal'?'preconnect-worker-attempt-reconciled':'foreign-completion',closureSha256:closure.sha256,archiveSha256:digest(readOwned(vault+'/operation-archived.json')),publicationAuthority:false}));
    releaseArchivedReplacement(token,closure,'preconnect-worker-attempt-reconciled','preconnect-abort-replacement');assertExistingOperationScopeHeld(token);
    if(exists(operation))fail('ci_replacement_not_released');if(JSON.parse(readOwned(vault+'/replacement-released.json')).kind!=='preconnect-abort-replacement-released')fail('ci_release_receipt_changed');
   });}catch(error){caught=error;}
   equal(dirIdentity(fs.lstatSync(vault+'/operation.lock')),original,'ci_original_inode_lost');equal(dirIdentity(fs.lstatSync(vault+'/publication')),publicationIdentity,'ci_publication_inode_lost');equal(fs.readdirSync(vault+'/publication').sort(),[...names].sort(),'ci_original_files_lost');for(const name of names)equal(digest(readOwned(vault+'/publication/'+name)),files[name],'ci_original_bytes_changed');
   const probe=spawnSync('flock',['--nonblock',deployLock,'true'],{env:runtimeEnvironment(),timeout:10000,windowsHide:true});if(probe.status!==0||probe.error||probe.signal)fail('ci_deploy_lock_not_released');
   if(outcome==='normal'){if(caught||exists(operation))fail('ci_abort_normal_failed');cases.push('normal-retains-both-inodes-and-all-seven-files-releases-only-owned-replacement');}
   else{if(!caught||exists(vault+'/replacement-released.json')||!replacement)fail('ci_unknown_false_success');equal(dirIdentity(fs.lstatSync(operation)),replacement,'ci_unknown_replacement_lost');if(outcome==='wrong-completion'&&caught.message!=='online_retention_writer_active_archive_not_authorized')throw caught;cases.push(outcome+'-retains-originals-and-blocks-release');}
  }
  if(anchors.some(f=>exists(f)))fail('ci_formal_anchor_created');const result={kind:'preconnect-abort-native-composition-accepted',root,cases,realKernelFlock:true,productionTokensRejected:true,bothOriginalInodesRetained:true,allSevenOriginalFilesRetained:true,processControlPerformed:false,processSavePerformed:false,businessSqlWritten:false,formalHostTouched:false,publicationAuthority:false,completedAt:new Date().toISOString()};privateWrite(root+'/acceptance.json',retentionCanonicalText(result));return result;
 }catch(error){privateWrite(root+'/failure.json',retentionCanonicalText({kind:'preconnect-abort-native-composition-unconfirmed',stage,errorSha256:digest(String(error?.message??'unknown')),automaticRetryAllowed:false,publicationAuthority:false}));throw error;}
}

export async function acceptPreIntentAbortClosureInCi(){
 const anchors=['/root/.pm2/pm2.pid','/var/lib/faolla-online-release/active.json','/www/wwwroot/merchant-space.current'];
 if(process.platform!=='linux'||process.getuid?.()!==0||process.env.GITHUB_ACTIONS!=='true'||process.env.RUNNER_ENVIRONMENT!=='github-hosted'||process.env.FAOLLA_RELEASE_PRODUCTION_EQ!=='1'||anchors.some(f=>exists(f)))fail('ci_only');
 const root=fs.mkdtempSync('/var/lib/faolla-pre-intent-ci-');fs.chmodSync(root,0o700);const cases=[];let stage='prepare';
 privateWrite(root+'/started.json',retentionCanonicalText({kind:'pre-intent-abort-composition-started',syntheticInputsOnly:true,formalHostTouched:false,publicationAuthority:false}));
 try{
  for(const outcome of ['normal','wrong-completion','unknown-after-archive']){
   stage=outcome;const parent=root+'/'+outcome;fs.mkdirSync(parent,{mode:0o700});const deployLock=parent+'/deploy.lock',operation=parent+'/operation.lock',publication=parent+'/publication',vault=parent+'/vault';privateWrite(deployLock,'owned-only\n');for(const directory of [operation,publication,vault])fs.mkdirSync(directory,{mode:0o700});syncDirectory(parent);
   const names=['controller-exit-unconfirmed.json','publication-attempt.json','publication-unconfirmed.json','rollback-readiness.json'];for(const name of names)privateWrite(publication+'/'+name,retentionCanonicalText({kind:'synthetic-pre-intent-'+name,containsPrivateEnvironment:false}));
   const original=dirIdentity(fs.lstatSync(operation)),publicationIdentity=dirIdentity(fs.lstatSync(publication)),files=Object.fromEntries(names.map(n=>[n,digest(readOwned(publication+'/'+n))])),closure={directory:vault,sha256:'a'.repeat(64)};let caught,replacement;
   try{await withExistingOperationPreparation({deployLock,operation,observe:async()=>({syntheticInputsOnly:true})},async token=>{
    let productionRejected=false;try{assertPreIntentAbortHeldWindow(token,heldLocks.get(token).activeWindow);}catch{productionRejected=true;}if(!productionRejected)fail('ci_token_production_leak');
    const archived=archiveOwnedExistingOperation(token,vault,closure.sha256);replacement=archived.replacement;fs.renameSync(publication,vault+'/publication');syncDirectory(parent);syncDirectory(vault);equal(dirIdentity(fs.lstatSync(vault+'/publication')),publicationIdentity,'ci_publication_inode_lost');
    if(outcome==='unknown-after-archive')throw Error('owned-pre-intent-unknown');
    privateWrite(vault+'/reconciliation-completed.json',retentionCanonicalText({kind:outcome==='normal'?'pre-intent-worker-attempt-reconciled':'foreign-completion',closureSha256:closure.sha256,archiveSha256:digest(readOwned(vault+'/operation-archived.json')),publicationAuthority:false}));
    releaseArchivedReplacement(token,closure,'pre-intent-worker-attempt-reconciled','pre-intent-abort-replacement');assertExistingOperationScopeHeld(token);
    if(exists(operation))fail('ci_replacement_not_released');if(JSON.parse(readOwned(vault+'/replacement-released.json')).kind!=='pre-intent-abort-replacement-released')fail('ci_release_receipt_changed');
   });}catch(error){caught=error;}
   equal(dirIdentity(fs.lstatSync(vault+'/operation.lock')),original,'ci_original_inode_lost');equal(dirIdentity(fs.lstatSync(vault+'/publication')),publicationIdentity,'ci_publication_inode_lost');equal(fs.readdirSync(vault+'/publication').sort(),[...names].sort(),'ci_original_files_lost');for(const name of names)equal(digest(readOwned(vault+'/publication/'+name)),files[name],'ci_original_bytes_changed');
   const probe=spawnSync('flock',['--nonblock',deployLock,'true'],{env:runtimeEnvironment(),timeout:10000,windowsHide:true});if(probe.status!==0||probe.error||probe.signal)fail('ci_deploy_lock_not_released');
   if(outcome==='normal'){if(caught||exists(operation))fail('ci_abort_normal_failed');cases.push('normal-retains-both-inodes-and-all-four-files-releases-only-owned-replacement');}
   else{if(!caught||exists(vault+'/replacement-released.json')||!replacement)fail('ci_unknown_false_success');equal(dirIdentity(fs.lstatSync(operation)),replacement,'ci_unknown_replacement_lost');if(outcome==='wrong-completion'&&caught.message!=='online_retention_writer_active_archive_not_authorized')throw caught;cases.push(outcome+'-retains-originals-and-blocks-release');}
  }
  const{executePreIntentPreservation}=await import('./release-toolchain-pre-intent-preservation.mjs');
  for(const outcome of ['owned-normal','owned-before-observation-refused','owned-after-archive-refused']){
   stage=outcome;const parent=root+'/'+outcome;fs.mkdirSync(parent,{mode:0o700});const deployLock=parent+'/deploy.lock',operation=parent+'/operation.lock',source=parent+'/publication',vault=parent+'/vault';privateWrite(deployLock,'owned-only\n');for(const directory of[operation,source])fs.mkdirSync(directory,{mode:0o700});
   const names=['controller-exit-unconfirmed.json','publication-attempt.json','publication-unconfirmed.json','rollback-readiness.json'];for(const name of names)privateWrite(source+'/'+name,retentionCanonicalText({kind:'synthetic-owned-readonly-'+name}));const original=dirIdentity(fs.lstatSync(operation)),publicationIdentity=dirIdentity(fs.lstatSync(source)),files=Object.fromEntries(names.map(name=>[name,digest(readOwned(source+'/'+name))]));let location=source,evidenceStarted=false,caught;
   try{await withExistingOperationPreparation({deployLock,operation,observe:async()=>({syntheticInputsOnly:true})},async token=>{
    const assertHeldAndNoIntent=()=>{assertExistingOperationScopeHeld(token);equal(dirIdentity(fs.lstatSync(operation)),original,'ci_operation_changed');equal(dirIdentity(fs.lstatSync(location)),publicationIdentity,'ci_publication_inode_lost');equal(fs.readdirSync(location).sort(),[...names].sort(),'ci_original_files_lost');for(const name of names)equal(digest(readOwned(location+'/'+name)),files[name],'ci_original_bytes_changed');};
    await executePreIntentPreservation({assertHeldAndNoIntent,
     observeBefore:()=>{if(outcome==='owned-before-observation-refused')throw Error('synthetic-read-refusal');},
     beginPreservation:()=>{evidenceStarted=true;fs.mkdirSync(vault,{mode:0o700});syncDirectory(parent);},
     sealIntent:()=>privateWrite(vault+'/intent.json',retentionCanonicalText({kind:'owned-synthetic-preservation-intent',files,publicationAuthority:false})),
     preservePublication:()=>{fs.renameSync(source,vault+'/publication');syncDirectory(parent);syncDirectory(vault);location=vault+'/publication';},
     observeAfter:()=>{if(outcome==='owned-after-archive-refused')throw Error('synthetic-post-archive-refusal');},
     complete:()=>privateWrite(vault+'/closed.json',retentionCanonicalText({kind:'owned-synthetic-readonly-preserved',files,publicationAuthority:false}))
    });
   });}catch(error){caught=error;}
   equal(dirIdentity(fs.lstatSync(operation)),original,'ci_operation_changed');equal(dirIdentity(fs.lstatSync(location)),publicationIdentity,'ci_publication_inode_lost');for(const name of names)equal(digest(readOwned(location+'/'+name)),files[name],'ci_original_bytes_changed');
   if(outcome==='owned-normal'){if(caught||!exists(vault+'/closed.json'))fail('ci_owned_preservation_failed');}
   else if(!caught||exists(vault+'/closed.json'))fail('ci_owned_preservation_false_success');
   if(outcome==='owned-before-observation-refused'&&(evidenceStarted||exists(vault)||location!==source))fail('ci_read_refusal_mutated_evidence');
   if(outcome==='owned-after-archive-refused'&&(!evidenceStarted||location===source))fail('ci_unknown_archive_evidence_lost');
   const probe=spawnSync('flock',['--nonblock',deployLock,'true'],{env:runtimeEnvironment(),timeout:10000,windowsHide:true});if(probe.status!==0||probe.error||probe.signal)fail('ci_deploy_lock_not_released');cases.push(outcome+'-preserves-inodes-and-all-four-files-without-operation-clear');
  }
  if(anchors.some(f=>exists(f)))fail('ci_formal_anchor_created');const result={kind:'pre-intent-abort-native-composition-accepted',root,cases,realKernelFlock:true,productionTokensRejected:true,bothOriginalInodesRetained:true,allFourOriginalFilesRetained:true,ownedReadOnlyPreservationTested:true,readRefusalDidNotCreateEvidence:true,processControlPerformed:false,processSavePerformed:false,businessSqlWritten:false,formalHostTouched:false,publicationAuthority:false,completedAt:new Date().toISOString()};privateWrite(root+'/acceptance.json',retentionCanonicalText(result));return result;
 }catch(error){privateWrite(root+'/failure.json',retentionCanonicalText({kind:'pre-intent-abort-native-composition-unconfirmed',stage,errorSha256:digest(String(error?.message??'unknown')),automaticRetryAllowed:false,publicationAuthority:false}));throw error;}
}

// Disposable composition of the SAME kernel-lock, CAS, inode-archive and
// replacement-release primitives used by the fixed recovered profile.
export async function acceptOriginRecoveryClosureInCi(){
 const anchors=['/root/.pm2/pm2.pid','/var/lib/faolla-online-release/active.json','/www/wwwroot/merchant-space.current'];if(process.platform!=='linux'||process.getuid?.()!==0||process.env.GITHUB_ACTIONS!=='true'||process.env.RUNNER_ENVIRONMENT!=='github-hosted'||process.env.FAOLLA_RELEASE_PRODUCTION_EQ!=='1'||anchors.some(f=>exists(f)))fail('ci_only');
 const root=fs.mkdtempSync('/var/lib/faolla-origin-recovery-ci-');fs.chmodSync(root,0o700);const cases=[];let stage='prepare';privateWrite(root+'/started.json',retentionCanonicalText({kind:'origin-recovery-native-composition-started',syntheticInputsOnly:true,formalHostTouched:false,publicationAuthority:false}));
 try{const{bookingHostReplace}=await import('./booking-handoff-host-io.mjs');
  for(const outcome of ['normal','wrong-metadata','unknown-after-metadata','unknown-after-archive','wrong-completion']){
   stage=outcome;const parent=root+'/'+outcome;fs.mkdirSync(parent,{mode:0o700});const deployLock=parent+'/deploy.lock',operation=parent+'/operation.lock',publication=parent+'/publication',vault=parent+'/vault',metadata=parent+'/state.json';privateWrite(deployLock,'owned-only\n');for(const d of [operation,publication,vault])fs.mkdirSync(d,{mode:0o700});privateWrite(metadata,'{"status":"owned-failed"}\n');const names=['controller-exit-unconfirmed.json','supervisor-finished.json','worker-completed.json','recovery-completed.json'];for(const name of names)privateWrite(publication+'/'+name,retentionCanonicalText({kind:'synthetic-origin-recovery-'+name}));
   const original=dirIdentity(fs.lstatSync(operation)),pubIdentity=dirIdentity(fs.lstatSync(publication)),files=Object.fromEntries(names.map(name=>[name,digest(readOwned(publication+'/'+name))])),closure={directory:vault,sha256:'a'.repeat(64)};let caught,replacement,moved=false,reset=false;
   try{await withExistingOperationPreparation({deployLock,operation,observe:async()=>({syntheticInputsOnly:true})},async token=>{
    let refused=false;try{assertOriginRecoveryHeldWindow(token,heldLocks.get(token).activeWindow);}catch{refused=true;}if(!refused)fail('ci_token_production_leak');privateWrite(vault+'/failed-state-before-reset.json',readOwned(metadata));
    bookingHostReplace(metadata,outcome==='wrong-metadata'?'foreign\n':'{"status":"owned-failed"}\n','{"status":"owned-ready"}\n','owned-origin-recovery');reset=true;if(outcome==='unknown-after-metadata')throw Error('owned-origin-after-metadata-unknown');
    const archive=archiveOwnedExistingOperation(token,vault,closure.sha256);replacement=archive.replacement;if(outcome==='unknown-after-archive')throw Error('owned-origin-after-archive-unknown');
    fs.renameSync(publication,vault+'/publication');syncDirectory(parent);syncDirectory(vault);moved=true;equal(dirIdentity(fs.lstatSync(vault+'/publication')),pubIdentity,'ci_publication_inode_lost');privateWrite(vault+'/reconciliation-completed.json',retentionCanonicalText({kind:outcome==='wrong-completion'?'foreign-completion':'origin-gate-recovery-reconciled',closureSha256:closure.sha256,archiveSha256:digest(readOwned(vault+'/operation-archived.json')),publicationAuthority:false}));releaseArchivedReplacement(token,closure,'origin-gate-recovery-reconciled','origin-gate-recovery-replacement');assertExistingOperationScopeHeld(token);
   });}catch(error){caught=error;}
   const opLocation=replacement?vault+'/operation.lock':operation,pubLocation=moved?vault+'/publication':publication;equal(dirIdentity(fs.lstatSync(opLocation)),original,'ci_original_inode_lost');equal(dirIdentity(fs.lstatSync(pubLocation)),pubIdentity,'ci_publication_inode_lost');for(const name of names)equal(digest(readOwned(pubLocation+'/'+name)),files[name],'ci_failure_evidence_changed');equal(readOwned(vault+'/failed-state-before-reset.json').toString(),'{"status":"owned-failed"}\n','ci_failed_metadata_lost');equal(readOwned(metadata).toString(),reset?'{"status":"owned-ready"}\n':'{"status":"owned-failed"}\n','ci_metadata_cas_changed');
   const probe=spawnSync('flock',['--nonblock',deployLock,'true'],{env:runtimeEnvironment(),timeout:10000,windowsHide:true});if(probe.status!==0||probe.error||probe.signal)fail('ci_deploy_lock_not_released');if(outcome==='normal'){if(caught||exists(operation)||!moved||!exists(vault+'/replacement-released.json'))fail('ci_origin_normal_failed');}else{if(!caught||exists(vault+'/replacement-released.json'))fail('ci_origin_unknown_false_success');if(replacement)equal(dirIdentity(fs.lstatSync(operation)),replacement,'ci_unknown_replacement_lost');}cases.push(outcome+'-preserves-failed-bytes-and-original-inodes');
  }
  if(anchors.some(f=>exists(f)))fail('ci_formal_anchor_created');const result={kind:'origin-recovery-native-composition-accepted',root,cases,realKernelFlock:true,actualCompareAndSwap:true,productionTokensRejected:true,originalFailedBytesRetained:true,originalInodesRetained:true,unknownOutcomesNotReleased:true,processControlPerformed:false,processSavePerformed:false,businessSqlWritten:false,formalHostTouched:false,publicationAuthority:false};privateWrite(root+'/acceptance.json',retentionCanonicalText(result));return result;
 }catch(error){privateWrite(root+'/failure.json',retentionCanonicalText({kind:'origin-recovery-native-composition-unconfirmed',stage,errorSha256:digest(String(error?.message)),automaticRetryAllowed:false,publicationAuthority:false}));throw error;}
}


// Genuine owned CI capability, same kernel/inode engine; formal tokens still
// require their exact paths AND reviewed execution authority independently.
export async function withOwnedActiveReconciliationLocks(capability,work){
  const {ownedActiveReconciliationScope}=await import('./release-toolchain-active-generation-owned-lab.mjs');
  const s=ownedActiveReconciliationScope(capability);
  return withExistingOperationPreparation({deployLock:s.directory+'/deploy.lock',operation:s.directory+'/operation.lock',observe:async()=>{ownedActiveReconciliationScope(capability);return{fixtureOnly:true};}},
    async(token,context)=>{ownedReconciliationScopes.set(token,{capability,assertScope:()=>ownedActiveReconciliationScope(capability)});try{return await work(token,context);}finally{ownedReconciliationScopes.delete(token);}});
}
export function ownedActiveReconciliationHeldChecker(capability,token){
  const bound=ownedReconciliationScopes.get(token);if(!bound||bound.capability!==capability)fail('parent_locks_required');
  const check=()=>{if(ownedReconciliationScopes.get(token)!==bound||heldLocks.get(token)?.activeScopeReleased)fail('parent_locks_required');bound.assertScope();assertExistingOperationScopeHeld(token);};check();return check;
}
export async function assertOwnedActiveReconciliationHeldLocks(capability,token){
  const {ownedActiveReconciliationScope}=await import('./release-toolchain-active-generation-owned-lab.mjs');const s=ownedActiveReconciliationScope(capability),held=heldLocks.get(token);
  if(!held||held.activeScopeReleased||held.deployLock!==s.directory+'/deploy.lock'||held.operation!==s.directory+'/operation.lock')fail('parent_locks_required');assertExistingOperationScopeHeld(token);
}
export async function archiveOwnedActiveReconciliationOperation(capability,token){
  await assertOwnedActiveReconciliationHeldLocks(capability,token);
  const {verifyOwnedActiveReconciliationClosure}=await import('./release-toolchain-active-generation-reconciliation.mjs');
  const closure=await verifyOwnedActiveReconciliationClosure(capability,token);
  return archiveOwnedExistingOperation(token,closure.directory,closure.sha256);
}
export async function releaseOwnedActiveReconciliationOperation(capability,token){
  await assertOwnedActiveReconciliationHeldLocks(capability,token);
  const {verifyOwnedActiveReconciliationClosure}=await import('./release-toolchain-active-generation-reconciliation.mjs');
  const closure=await verifyOwnedActiveReconciliationClosure(capability,token);
  return releaseArchivedReplacement(token,closure,'owned-active-reconciliation-completed','owned-active-replacement');
}
export async function archiveOwnedPostSaveOperation(capability,token){
  await assertOwnedActiveReconciliationHeldLocks(capability,token);const {verifyOwnedPostSaveClosure}=await import('./release-toolchain-post-save-native.mjs');const closure=await verifyOwnedPostSaveClosure(capability,token);return archiveOwnedExistingOperation(token,closure.directory,closure.sha256);
}
export async function releaseOwnedPostSaveOperation(capability,token){
  await assertOwnedActiveReconciliationHeldLocks(capability,token);const {verifyOwnedPostSaveClosure}=await import('./release-toolchain-post-save-native.mjs');const closure=await verifyOwnedPostSaveClosure(capability,token);return releaseArchivedReplacement(token,closure,'owned-post-save-reconciliation-completed','owned-post-save-replacement');
}
function releaseArchivedReplacement(token,closure,completionKind,releaseKind){
  assertExistingOperationScopeHeld(token);const held=heldLocks.get(token);
  const completed=JSON.parse(readOwned(closure.directory+'/reconciliation-completed.json'));
  if(completed.kind!==completionKind||completed.closureSha256!==closure.sha256||completed.archiveSha256!==digest(readOwned(closure.directory+'/operation-archived.json'))||completed.publicationAuthority!==false||!held.activeArchive||held.activeArchive.vault!==closure.directory||held.activeArchive.closureSha256!==closure.sha256)fail('active_archive_not_authorized');
  assertExistingOperationScopeHeld(token);equal(dirIdentity(privateDirectory(held.activeArchive.destination)),held.activeArchive.original,'active_archive_original_changed');
  privateWrite(closure.directory+'/replacement-release-attempt.json',retentionCanonicalText({kind:releaseKind+'-release-intent',closureSha256:closure.sha256,replacement:held.operationIdentity,originalInodeRetained:true,publicationAuthority:false}));
  assertExistingOperationScopeHeld(token);fs.rmdirSync(held.operation);syncDirectory(path.dirname(held.operation));held.activeScopeReleased=true;assertExistingOperationScopeHeld(token);
  const receipt={kind:releaseKind+'-released',closureSha256:closure.sha256,originalInodeRetained:true,publicationAuthority:false};privateWrite(closure.directory+'/replacement-released.json',retentionCanonicalText(receipt));return receipt;
}
// Read-only access to OUR real archive transition, not caller-provided JSON.
export function activeBookingArchiveWitness(token){
  assertHeldLocks(token);const held=heldLocks.get(token);if(!held.activeArchive)return null;
  const archive=held.activeArchive;if(archive.vault!=='/var/lib/faolla-booking-active-closures/b49808d6-1950-4cb4-b029-97086873d7a7/'+held.activeWindow.id)fail('active_archive_not_authorized');
  equal(dirIdentity(privateDirectory(archive.destination)),archive.original,'active_archive_original_changed');
  const value=structuredClone({...archive,window:held.activeWindow,canonicalOperation:held.operation}),freeze=v=>{if(v&&typeof v==='object'){for(const child of Object.values(v))freeze(child);Object.freeze(v);}return v;};return freeze(value);
}
export function assertActiveBookingIncidentHeldWindow(token,window){
  assertHeldLocks(token);const held=heldLocks.get(token);if(!held.activeWindow||!isDeepStrictEqual(held.activeWindow,window))fail('active_incident_window_mismatch');
}
export function assertReleasedActiveBookingScope(token,closureSha256){
  const held=heldLocks.get(token);if(!held?.activeScopeReleased||held.deployLock!==DEPLOY_LOCK||held.operation!==OPERATION_LOCK||held.activeArchive?.closureSha256!==closureSha256)fail('active_archive_not_authorized');assertExistingOperationScopeHeld(token);
}
export async function archiveActiveBookingClosureOperation({lock,toolRevision,window}){
  assertHeldLocks(lock);const {verifyActiveBookingClosure}=await import('./release-toolchain-active-generation-closure.mjs');
  const closure=await verifyActiveBookingClosure({lock,toolRevision,window});return archiveOwnedExistingOperation(lock,closure.directory,closure.sha256);
}
export async function releaseActiveBookingClosureOperation({lock,toolRevision,window}){
  assertHeldLocks(lock);const {verifyActiveBookingClosure}=await import('./release-toolchain-active-generation-closure.mjs');
  const closure=await verifyActiveBookingClosure({lock,toolRevision,window});return releaseArchivedReplacement(lock,closure,'active-incident-reconciliation-completed','active-incident-replacement');
}
export async function archivePostSaveBookingClosureOperation(options){
  assertHeldLocks(options.lock);const {verifyPostSaveClosure}=await import('./release-toolchain-post-save-closure.mjs'),closure=await verifyPostSaveClosure(options);return archiveOwnedExistingOperation(options.lock,closure.directory,closure.sha256);
}
export async function releasePostSaveBookingClosureOperation(options){
  assertHeldLocks(options.lock);const {verifyPostSaveClosure}=await import('./release-toolchain-post-save-closure.mjs'),closure=await verifyPostSaveClosure(options);return releaseArchivedReplacement(options.lock,closure,'active-incident-reconciliation-completed','active-incident-replacement');
}

export async function archivePreControlAbortOperation(options){assertPreControlAbortHeldWindow(options.lock,options.window);const{verifyPreControlAbortClosure}=await import('./release-toolchain-pre-control-closure.mjs'),closure=await verifyPreControlAbortClosure(options);return archiveOwnedExistingOperation(options.lock,closure.directory,closure.sha256);}
export async function releasePreControlAbortOperation(options){assertPreControlAbortHeldWindow(options.lock,options.window);const{verifyPreControlAbortClosure}=await import('./release-toolchain-pre-control-closure.mjs'),closure=await verifyPreControlAbortClosure(options);return releaseArchivedReplacement(options.lock,closure,'pre-control-worker-attempt-reconciled','pre-control-abort-replacement');}

export async function archivePreConnectAbortOperation(options){assertPreConnectAbortHeldWindow(options.lock,options.window);const{verifyPreConnectAbortClosure}=await import('./release-toolchain-preconnect-closure.mjs'),closure=await verifyPreConnectAbortClosure(options);return archiveOwnedExistingOperation(options.lock,closure.directory,closure.sha256);}
export async function releasePreConnectAbortOperation(options){assertPreConnectAbortHeldWindow(options.lock,options.window);const{verifyPreConnectAbortClosure}=await import('./release-toolchain-preconnect-closure.mjs'),closure=await verifyPreConnectAbortClosure(options);return releaseArchivedReplacement(options.lock,closure,'preconnect-worker-attempt-reconciled','preconnect-abort-replacement');}

export async function archivePreIntentAbortOperation(options){assertPreIntentAbortHeldWindow(options.lock,options.window);const{verifyPreIntentAbortClosure}=await import('./release-toolchain-pre-intent-closure.mjs'),closure=await verifyPreIntentAbortClosure(options);return archiveOwnedExistingOperation(options.lock,closure.directory,closure.sha256);}
export async function releasePreIntentAbortOperation(options){assertPreIntentAbortHeldWindow(options.lock,options.window);const{verifyPreIntentAbortClosure}=await import('./release-toolchain-pre-intent-closure.mjs'),closure=await verifyPreIntentAbortClosure(options);return releaseArchivedReplacement(options.lock,closure,'pre-intent-worker-attempt-reconciled','pre-intent-abort-replacement');}

export async function archiveOriginRecoveryOperation(options){assertOriginRecoveryHeldWindow(options.lock,options.window);const{verifyOriginRecoveryClosure}=await import('./release-toolchain-origin-recovery-closure.mjs'),closure=await verifyOriginRecoveryClosure(options);return archiveOwnedExistingOperation(options.lock,closure.directory,closure.sha256);}
export async function archivePreSupervisorOperation(options){assertPreSupervisorHeld(options.lock,options.window);const{verifyPreSupervisorDisposition}=await import('./release-toolchain-pre-supervisor-host.mjs'),closure=await verifyPreSupervisorDisposition(options);return archiveOwnedExistingOperation(options.lock,closure.directory,closure.sha256);}
export async function releasePreSupervisorOperation(options){assertPreSupervisorHeld(options.lock,options.window);const{verifyPreSupervisorDisposition}=await import('./release-toolchain-pre-supervisor-host.mjs'),closure=await verifyPreSupervisorDisposition(options);return releaseArchivedReplacement(options.lock,closure,'pre-supervisor-disposition-reconciled','pre-supervisor-replacement');}
export async function archiveSettledPreIngressOperation(options){assertSettledPreIngressHeld(options.lock,options.window);const{verifySettledPreIngressDisposition}=await import('./release-toolchain-settled-pre-ingress-host.mjs'),closure=await verifySettledPreIngressDisposition(options);return archiveOwnedExistingOperation(options.lock,closure.directory,closure.sha256);}
export async function releaseSettledPreIngressOperation(options){assertSettledPreIngressHeld(options.lock,options.window);const{verifySettledPreIngressDisposition}=await import('./release-toolchain-settled-pre-ingress-host.mjs'),closure=await verifySettledPreIngressDisposition(options);return releaseArchivedReplacement(options.lock,closure,'settled-pre-ingress-disposition-reconciled','settled-pre-ingress-replacement');}
export async function archiveRecoveredPublicationOperation(options){assertRecoveredPublicationDispositionHeld(options.lock,options.window);const{verifyRecoveredPublicationDisposition}=await import('./release-toolchain-recovered-publication-host.mjs'),closure=await verifyRecoveredPublicationDisposition(options);return archiveOwnedExistingOperation(options.lock,closure.directory,closure.sha256);}
export async function releaseRecoveredPublicationOperation(options){assertRecoveredPublicationDispositionHeld(options.lock,options.window);const{verifyRecoveredPublicationDisposition}=await import('./release-toolchain-recovered-publication-host.mjs'),closure=await verifyRecoveredPublicationDisposition(options);return releaseArchivedReplacement(options.lock,closure,'recovered-publication-disposition-reconciled','recovered-publication-disposition-replacement');}

export async function acceptRecoveredPublicationDispositionKernel(){
 if(process.platform!=='linux'||process.getuid?.()!==0)fail('native_linux_root_required');
 const{executeRecoveredPublicationDisposition}=await import('./release-toolchain-recovered-publication-contract.mjs'),{bookingHostReplace,bookingHostWriteOnce}=await import('./booking-handoff-host-io.mjs');
 const root=fs.mkdtempSync('/var/lib/faolla-recovered-disposition-native-');fs.chmodSync(root,0o700);const cases=[];
 for(const outcome of ['normal','wrong-state','unknown-after-partial','unknown-after-publication','unknown-after-archive','operation-drift','wrong-completion']){
  const directory=root+'/'+outcome;fs.mkdirSync(directory,{mode:0o700});const deploy=directory+'/deploy.lock',operation=directory+'/operation.lock',vault=directory+'/vault',partial=directory+'/partial',publication=directory+'/publication';privateWrite(deploy,'owned-disposition-lock\n');for(const file of[operation,vault,partial,publication])fs.mkdirSync(file,{mode:0o700});privateWrite(directory+'/state.json','recovered\n');privateWrite(partial+'/before.json','original-partial\n');privateWrite(publication+'/failure.json','original-failure\n');
  const original=dirIdentity(fs.lstatSync(operation)),partialId=dirIdentity(fs.lstatSync(partial)),publicationId=dirIdentity(fs.lstatSync(publication));let completed=false,cause,archived=false;
  try{await withExistingOperationPreparation({deployLock:deploy,operation,observe:()=>({ownedOnly:true})},async token=>{
   const checked=()=>assertExistingOperationScopeHeld(token),busy=spawnSync('flock',['--nonblock',deploy,'true'],{timeout:2000});if(busy.status!==1||busy.signal||busy.error)fail('ci_real_lock_not_held');let refused=false;try{assertRecoveredPublicationDispositionHeld(token);}catch{refused=true;}if(!refused)fail('ci_token_production_leak');
   await executeRecoveredPublicationDisposition({assertHeld:checked,inspect:()=>bookingHostWriteOnce(vault+'/intent.json','one-owned-intent\n'),preserve:()=>{if(outcome==='operation-drift'){fs.renameSync(operation,directory+'/displaced-operation');fs.mkdirSync(operation,{mode:0o700});}},
    resetMetadata:()=>bookingHostReplace(directory+'/state.json',outcome==='wrong-state'?'foreign\n':'recovered\n','staged\n','owned-disposition'),
    preservePartialJournal:()=>{fs.renameSync(partial,vault+'/partial');syncDirectory(directory);syncDirectory(vault);if(outcome==='unknown-after-partial')throw Error('ci_unknown_after_partial');},
    preservePublication:()=>{fs.renameSync(publication,vault+'/publication');syncDirectory(directory);syncDirectory(vault);if(outcome==='unknown-after-publication')throw Error('ci_unknown_after_publication');},
    sealClosure:()=>privateWrite(vault+'/closure-sealed.json','owned-sealed\n'),
    archiveOperation:()=>{archiveOwnedExistingOperation(token,vault,digest(readOwned(vault+'/closure-sealed.json')),()=>{if(outcome==='unknown-after-archive')throw Error('ci_unknown_after_archive');});archived=true;},
    complete:()=>{const closure={directory:vault,sha256:digest(readOwned(vault+'/closure-sealed.json'))};privateWrite(vault+'/reconciliation-completed.json',retentionCanonicalText({kind:outcome==='wrong-completion'?'foreign':'owned-disposition-completed',closureSha256:closure.sha256,archiveSha256:digest(readOwned(vault+'/operation-archived.json')),publicationAuthority:false}));releaseArchivedReplacement(token,closure,'owned-disposition-completed','owned-disposition-replacement');privateWrite(vault+'/closed.json','owned-completed\n');completed=true;},
    failure:(error,stage)=>privateWrite(vault+'/unconfirmed.json',retentionCanonicalText({stage,errorSha256:digest(String(error.message)),automaticRetryAllowed:false,publicationAuthority:false}))
   });
  });}catch(error){cause=error;}
  if(outcome==='normal'){if(cause||!completed||exists(operation))fail('ci_disposition_unconfirmed');}
  else if(!cause||completed||!exists(vault+'/unconfirmed.json')||exists(vault+'/closed.json'))fail('ci_unknown_not_retained');
  const retainedPartial=exists(vault+'/partial')?vault+'/partial':partial,retainedPublication=exists(vault+'/publication')?vault+'/publication':publication,retainedOperation=exists(vault+'/operation.lock')?vault+'/operation.lock':outcome==='operation-drift'?directory+'/displaced-operation':operation;
  equal(dirIdentity(fs.lstatSync(retainedPartial)),partialId,'ci_partial_inode_changed');equal(dirIdentity(fs.lstatSync(retainedPublication)),publicationId,'ci_publication_inode_changed');equal(dirIdentity(fs.lstatSync(retainedOperation)),original,'ci_operation_inode_changed');equal(readOwned(retainedPartial+'/before.json'),Buffer.from('original-partial\n'),'ci_partial_bytes_changed');equal(readOwned(retainedPublication+'/failure.json'),Buffer.from('original-failure\n'),'ci_failure_bytes_changed');
  cases.push({outcome,completed,archived,allOriginalInodesRetained:true,allOriginalBytesRetained:true,oldCertificateFabricated:false,productionAuthority:false});
 }
 const proof={kind:'recovered-publication-disposition-kernel-accepted',cases,actualFlock:true,actualCas:true,actualInodePreservingRenames:true,productionTokensRejected:true,formalHostTouched:false,publicationAuthority:false};privateWrite(root+'/verified.json',retentionCanonicalText(proof));return{root,sha256:digest(readOwned(root+'/verified.json')),proof};
}
export async function acceptSettledPreIngressKernel(){
 if(process.platform!=='linux'||process.getuid?.()!==0)fail('native_linux_root_required');
 const{executeSettledPreIngressDisposition}=await import('./release-toolchain-settled-pre-ingress-contract.mjs'),{bookingHostReplace,bookingHostWriteOnce}=await import('./booking-handoff-host-io.mjs');
 const root=fs.mkdtempSync('/var/lib/faolla-settled-pre-ingress-native-');fs.chmodSync(root,0o700);const cases=[];
 for(const outcome of ['normal','wrong-state','unknown-after-metadata','unknown-after-publication','unknown-after-archive','operation-drift','wrong-completion']){
  const directory=root+'/'+outcome;fs.mkdirSync(directory,{mode:0o700});const deploy=directory+'/deploy.lock',operation=directory+'/operation.lock',vault=directory+'/vault',publication=directory+'/publication';privateWrite(deploy,'owned-disposition-lock\n');for(const file of[operation,vault,publication])fs.mkdirSync(file,{mode:0o700});privateWrite(directory+'/state.json','recovered\n');privateWrite(publication+'/failure.json','original-failure\n');
  const original=dirIdentity(fs.lstatSync(operation)),publicationId=dirIdentity(fs.lstatSync(publication));let completed=false,cause,archived=false;
  try{await withExistingOperationPreparation({deployLock:deploy,operation,observe:()=>({ownedOnly:true})},async token=>{
   const checked=()=>assertExistingOperationScopeHeld(token),busy=spawnSync('flock',['--nonblock',deploy,'true'],{timeout:2000});if(busy.status!==1||busy.signal||busy.error)fail('ci_real_lock_not_held');let refused=false;try{assertSettledPreIngressHeld(token);}catch{refused=true;}if(!refused)fail('ci_token_production_leak');
   await executeSettledPreIngressDisposition({assertHeld:checked,inspect:()=>bookingHostWriteOnce(vault+'/intent.json','one-owned-intent\n'),preserve:()=>{if(outcome==='operation-drift'){fs.renameSync(operation,directory+'/displaced-operation');fs.mkdirSync(operation,{mode:0o700});}},
    resetMetadata:()=>{bookingHostReplace(directory+'/state.json',outcome==='wrong-state'?'foreign\n':'recovered\n','staged\n','owned-disposition');if(outcome==='unknown-after-metadata')throw Error('ci_unknown_after_metadata');},
    preservePublication:()=>{fs.renameSync(publication,vault+'/publication');syncDirectory(directory);syncDirectory(vault);if(outcome==='unknown-after-publication')throw Error('ci_unknown_after_publication');},
    sealClosure:()=>privateWrite(vault+'/closure-sealed.json','owned-sealed\n'),
    archiveOperation:()=>{archiveOwnedExistingOperation(token,vault,digest(readOwned(vault+'/closure-sealed.json')),()=>{if(outcome==='unknown-after-archive')throw Error('ci_unknown_after_archive');});archived=true;},
    complete:()=>{const closure={directory:vault,sha256:digest(readOwned(vault+'/closure-sealed.json'))};privateWrite(vault+'/reconciliation-completed.json',retentionCanonicalText({kind:outcome==='wrong-completion'?'foreign':'owned-disposition-completed',closureSha256:closure.sha256,archiveSha256:digest(readOwned(vault+'/operation-archived.json')),publicationAuthority:false}));releaseArchivedReplacement(token,closure,'owned-disposition-completed','owned-disposition-replacement');privateWrite(vault+'/closed.json','owned-completed\n');completed=true;},
    failure:(error,stage)=>privateWrite(vault+'/unconfirmed.json',retentionCanonicalText({stage,errorSha256:digest(String(error.message)),automaticRetryAllowed:false,publicationAuthority:false}))
   });
  });}catch(error){cause=error;}
  if(outcome==='normal'){if(cause||!completed||exists(operation))fail('ci_disposition_unconfirmed');}
  else if(!cause||completed||!exists(vault+'/unconfirmed.json')||exists(vault+'/closed.json'))fail('ci_unknown_not_retained');
  const retainedPublication=exists(vault+'/publication')?vault+'/publication':publication,retainedOperation=exists(vault+'/operation.lock')?vault+'/operation.lock':outcome==='operation-drift'?directory+'/displaced-operation':operation;
  equal(dirIdentity(fs.lstatSync(retainedPublication)),publicationId,'ci_publication_inode_changed');equal(dirIdentity(fs.lstatSync(retainedOperation)),original,'ci_operation_inode_changed');equal(readOwned(retainedPublication+'/failure.json'),Buffer.from('original-failure\n'),'ci_failure_bytes_changed');
  cases.push({outcome,completed,archived,allOriginalInodesRetained:true,allOriginalBytesRetained:true,oldCertificateFabricated:false,productionAuthority:false});
 }
 const proof={kind:'settled-pre-ingress-kernel-accepted',cases,actualFlock:true,actualCas:true,actualInodePreservingRenames:true,productionTokensRejected:true,formalHostTouched:false,publicationAuthority:false};privateWrite(root+'/verified.json',retentionCanonicalText(proof));return{root,sha256:digest(readOwned(root+'/verified.json')),proof};
}
export async function acceptPreSupervisorKernel(){
 if(process.platform!=='linux'||process.getuid?.()!==0)fail('native_linux_root_required');
 const{executePreSupervisorDisposition,PRE_SUPERVISOR_NATIVE_CASES}=await import('./release-toolchain-pre-supervisor-contract.mjs'),{assertActiveBookingSupervisorClosureProfile}=await import('./release-toolchain-active-generation-contract.mjs');
 const markers=[...fs.readFileSync(new URL('./release-toolchain-active-generation-profile.mjs',import.meta.url),'utf8').matchAll(/\.\.\.\(closed\.([A-Za-z]+Closed)\?/g)].map(value=>value[1]);if(markers.length<4||!markers.includes('preSupervisorClosed'))fail('ci_profile_catalog_incomplete');for(const marker of markers)assertActiveBookingSupervisorClosureProfile({[marker]:{}});
 const root=fs.mkdtempSync('/var/lib/faolla-pre-supervisor-native-');fs.chmodSync(root,0o700);const cases=[];
 for(const outcome of PRE_SUPERVISOR_NATIVE_CASES){
  const directory=root+'/'+outcome;fs.mkdirSync(directory,{mode:0o700});const deploy=directory+'/deploy.lock',operation=directory+'/operation.lock',vault=directory+'/vault',publication=directory+'/publication';privateWrite(deploy,'owned-pre-supervisor-lock\n');for(const file of[operation,vault,publication])fs.mkdirSync(file,{mode:0o700});privateWrite(directory+'/state.json','staged-unchanged\n');privateWrite(publication+'/failure.json','original-failure\n');
  const original=dirIdentity(fs.lstatSync(operation)),publicationId=dirIdentity(fs.lstatSync(publication)),stateBefore=identity(fs.lstatSync(directory+'/state.json'));let completed=false,cause,archived=false;
  try{await withExistingOperationPreparation({deployLock:deploy,operation,observe:()=>({ownedOnly:true})},async token=>{
   const checked=()=>assertExistingOperationScopeHeld(token),busy=spawnSync('flock',['--nonblock',deploy,'true'],{timeout:2000});if(busy.status!==1||busy.signal||busy.error)fail('ci_real_lock_not_held');let refused=false;try{assertPreSupervisorHeld(token);}catch{refused=true;}if(!refused)fail('ci_token_production_leak');
   await executePreSupervisorDisposition({assertHeld:checked,inspect:()=>privateWrite(vault+'/intent.json','one-owned-intent\n'),preserve:()=>{if(outcome==='operation-drift'){fs.renameSync(operation,directory+'/displaced-operation');fs.mkdirSync(operation,{mode:0o700});}},
    verifyUnchanged:()=>equal(readOwned(directory+'/state.json'),Buffer.from(outcome==='wrong-state'?'foreign\n':'staged-unchanged\n'),'ci_state_changed'),
    preservePublication:()=>{fs.renameSync(publication,vault+'/publication');syncDirectory(directory);syncDirectory(vault);if(outcome==='unknown-after-publication')throw Error('ci_unknown_after_publication');},
    sealClosure:()=>{privateWrite(vault+'/closure-sealed.json','owned-sealed\n');if(outcome==='unknown-after-seal')throw Error('ci_unknown_after_seal');},
    archiveOperation:()=>{archiveOwnedExistingOperation(token,vault,digest(readOwned(vault+'/closure-sealed.json')),()=>{if(outcome==='unknown-after-archive')throw Error('ci_unknown_after_archive');});archived=true;},
    complete:()=>{const closure={directory:vault,sha256:digest(readOwned(vault+'/closure-sealed.json'))};privateWrite(vault+'/reconciliation-completed.json',retentionCanonicalText({kind:outcome==='wrong-completion'?'foreign':'owned-pre-supervisor-completed',closureSha256:closure.sha256,archiveSha256:digest(readOwned(vault+'/operation-archived.json')),publicationAuthority:false}));releaseArchivedReplacement(token,closure,'owned-pre-supervisor-completed','owned-pre-supervisor-replacement');privateWrite(vault+'/closed.json','owned-completed\n');completed=true;},
    failure:(error,stage)=>privateWrite(vault+'/unconfirmed.json',retentionCanonicalText({stage,errorSha256:digest(String(error.message)),automaticRetryAllowed:false,publicationAuthority:false}))
   });
  });}catch(error){cause=error;}
  if(outcome==='normal'){if(cause||!completed||exists(operation))fail('ci_disposition_unconfirmed');}else if(!cause||completed||!exists(vault+'/unconfirmed.json')||exists(vault+'/closed.json'))fail('ci_unknown_not_retained');
  const retainedPublication=exists(vault+'/publication')?vault+'/publication':publication,retainedOperation=exists(vault+'/operation.lock')?vault+'/operation.lock':outcome==='operation-drift'?directory+'/displaced-operation':operation;
  equal(dirIdentity(fs.lstatSync(retainedPublication)),publicationId,'ci_publication_inode_changed');equal(dirIdentity(fs.lstatSync(retainedOperation)),original,'ci_operation_inode_changed');equal(readOwned(retainedPublication+'/failure.json'),Buffer.from('original-failure\n'),'ci_failure_bytes_changed');equal(identity(fs.lstatSync(directory+'/state.json')),stateBefore,'ci_metadata_written');equal(readOwned(directory+'/state.json'),Buffer.from('staged-unchanged\n'),'ci_metadata_written');
  cases.push({outcome,completed,archived,allOriginalInodesRetained:true,allOriginalBytesRetained:true,oldCertificateFabricated:false,productionAuthority:false});
 }
 const proof={kind:'pre-supervisor-kernel-accepted',cases,actualFlock:true,actualInodePreservingRenames:true,productionTokensRejected:true,metadataNeverWritten:true,allAdvertisedSupervisorProfilesRecognized:true,formalHostTouched:false,publicationAuthority:false};privateWrite(root+'/verified.json',retentionCanonicalText(proof));return{root,sha256:digest(readOwned(root+'/verified.json')),proof};
}
export async function releaseOriginRecoveryOperation(options){assertOriginRecoveryHeldWindow(options.lock,options.window);const{verifyOriginRecoveryClosure}=await import('./release-toolchain-origin-recovery-closure.mjs'),closure=await verifyOriginRecoveryClosure(options);return releaseArchivedReplacement(options.lock,closure,'origin-gate-recovery-reconciled','origin-gate-recovery-replacement');}

// Physical archive primitive shared with disposable native tests. Deliberately
// NOT exported as a production action: a future closure entry must first verify
// its complete sealed closure and source/CI/backup qualifications. Preparation
// alone never calls it. It cannot remove an inode or auto-release a new scope.
function archiveOwnedExistingOperation(token,vault,closureSha256,afterOriginalArchived){
  assertExistingOperationScopeHeld(token);const held=heldLocks.get(token);
  if(!held.activeWindow||held.activeArchive||!/^[a-f0-9]{64}$/.test(closureSha256))fail('active_archive_not_authorized');
  const destination=vault+'/operation.lock',vaultIdentity=dirIdentity(privateDirectory(vault));
  if(exists(destination))fail('active_archive_destination_exists');
  const original=held.operationIdentity;
  privateWrite(vault+'/operation-archive-attempt.json',retentionCanonicalText({kind:'active-incident-original-operation-archive-intent',window:held.activeWindow,closureSha256,source:held.operation,destination,original,at:new Date().toISOString(),publicationAuthority:false}));
  assertExistingOperationScopeHeld(token);equal(dirIdentity(privateDirectory(vault)),vaultIdentity,'active_archive_parent_changed');
  // Both paths are absolute, fixed by the enclosing closed resource profile.
  // A failed or uncertain rename is never retried or replaced with deletion.
  fs.renameSync(held.operation,destination);syncDirectory(path.dirname(held.operation));syncDirectory(vault);
  equal(dirIdentity(privateDirectory(destination)),original,'active_archive_original_changed');
  // Private fault-injection seam used by the closed CI factory above. It is
  // never a CLI argument, a production profile flag, or a resumed operation.
  if(afterOriginalArchived)afterOriginalArchived();
  fs.mkdirSync(held.operation,{mode:0o700});syncDirectory(path.dirname(held.operation));
  const replacement=dirIdentity(privateDirectory(held.operation));if(isDeepStrictEqual(replacement,original))fail('active_archive_replacement_invalid');
  held.operationIdentity=replacement;held.activeArchive={vault,vaultIdentity,destination,original,replacement,closureSha256};
  assertExistingOperationScopeHeld(token);
  const result={kind:'active-incident-original-operation-archived',window:held.activeWindow,closureSha256,source:held.operation,destination,original,replacement,originalInodeRetained:true,replacementScopeRetained:true,incidentClosed:false,publicationAuthority:false,at:new Date().toISOString()};
  privateWrite(vault+'/operation-archived.json',retentionCanonicalText(result));assertExistingOperationScopeHeld(token);return result;
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

// Separate exact recovered metadata failure; existing factories stay unchanged.
export async function withMetadataRecoveryLocks({toolRevision},work){
 if(process.platform!=='linux'||process.getuid?.()!==0||typeof work!=='function')fail('metadata_recovery_scope');
 const{reviewedBookingExecution}=await import('./release-toolchain-authority.mjs'),{metadataRecoveryBindingSha256}=await import('./release-toolchain-metadata-recovery-contract.mjs'),{observeMetadataRecovery}=await import('./release-toolchain-metadata-recovery-evidence.mjs'),authority=reviewedBookingExecution(toolRevision);
 if(authority?.prepared.metadataRecovery?.bindingSha256!==metadataRecoveryBindingSha256())fail('active_incident_review_required');
 return withExistingOperationPreparation({deployLock:DEPLOY_LOCK,operation:OPERATION_LOCK,observe:async()=>{if(reviewedBookingExecution(toolRevision)!==authority)fail('active_incident_review_changed');return observeMetadataRecovery();}},async(token,context)=>{const held=heldLocks.get(token);held.metadataRecovery=Object.freeze({toolRevision,bindingSha256:metadataRecoveryBindingSha256()});assertMetadataRecoveryHeld(token,context.window);const result=await work(token,context);if(reviewedBookingExecution(toolRevision)!==authority)fail('active_incident_review_changed');return result;});
}
export function assertMetadataRecoveryHeld(token,window){assertExistingOperationScopeHeld(token);const held=heldLocks.get(token);if(held.deployLock!==DEPLOY_LOCK||held.operation!==OPERATION_LOCK||!held.metadataRecovery||window!==undefined&&!isDeepStrictEqual(held.activeWindow,window))fail('metadata_recovery_scope_required');return Object.freeze({...held.metadataRecovery});}
export function metadataRecoveryArchiveWitness(token){assertMetadataRecoveryHeld(token);const held=heldLocks.get(token);if(!held.activeArchive)return null;const a=held.activeArchive;if(a.vault!=='/var/lib/faolla-booking-metadata-recovery/24db70cd-c4ed-4aeb-b55a-a05bdc6b6eb6/'+held.activeWindow.id||a.original.ino!==2624971)fail('active_archive_not_authorized');equal(dirIdentity(privateDirectory(a.destination)),a.original,'active_archive_original_changed');return Object.freeze(structuredClone({...a,released:held.activeScopeReleased===true}));}

export async function archiveMetadataRecoveryOperation(options){assertMetadataRecoveryHeld(options.lock,options.window);const{verifyMetadataRecoveryDisposition}=await import('./release-toolchain-metadata-recovery-host.mjs'),closure=await verifyMetadataRecoveryDisposition(options);return archiveOwnedExistingOperation(options.lock,closure.directory,closure.sha256);}
export async function releaseMetadataRecoveryOperation(options){assertMetadataRecoveryHeld(options.lock,options.window);const{verifyMetadataRecoveryDisposition}=await import('./release-toolchain-metadata-recovery-host.mjs'),closure=await verifyMetadataRecoveryDisposition(options);return releaseArchivedReplacement(options.lock,closure,'metadata-recovery-disposition-reconciled','metadata-recovery-replacement');}
export async function withBookingWorkerDatabaseLocks({toolRevision},work){
 if(process.platform!=='linux'||process.getuid?.()!==0||typeof work!=='function')fail('worker_database_scope');
 const{reviewedBookingExecution}=await import('./release-toolchain-authority.mjs'),{workerDatabaseIncidentSha256}=await import('./release-toolchain-worker-database-contract.mjs'),{observeWorkerDatabaseIncident}=await import('./release-toolchain-worker-database.mjs'),authority=reviewedBookingExecution(toolRevision);
 if(authority?.prepared.workerReleaseAdmission?.databaseContinuation?.incidentSha256!==workerDatabaseIncidentSha256())fail('worker_database_scope');
 return withExistingOperationPreparation({deployLock:DEPLOY_LOCK,operation:OPERATION_LOCK,observe:()=>observeWorkerDatabaseIncident()},async(token,context)=>{
  const held=heldLocks.get(token);held.workerDatabase=Object.freeze({toolRevision,incidentSha256:workerDatabaseIncidentSha256()});const result=await work(token,context);if(reviewedBookingExecution(toolRevision)!==authority)fail('active_incident_review_changed');return result;
 });
}
export function assertBookingWorkerDatabaseHeld(token,window){
 assertExistingOperationScopeHeld(token);const held=heldLocks.get(token);if(held.deployLock!==DEPLOY_LOCK||held.operation!==OPERATION_LOCK||!held.workerDatabase||window!==undefined&&!isDeepStrictEqual(held.activeWindow,window))fail('worker_database_scope');return Object.freeze({...held.workerDatabase});
}
export async function archiveBookingWorkerDatabaseOperation(options){if(assertBookingWorkerDatabaseHeld(options.lock,options.window).toolRevision!==options.toolRevision)fail('worker_database_scope');const{verifyWorkerDatabaseClosure}=await import('./release-toolchain-worker-database.mjs'),closure=await verifyWorkerDatabaseClosure(options);return archiveOwnedExistingOperation(options.lock,closure.directory,closure.sha256);}
export async function releaseBookingWorkerDatabaseOperation(options){if(assertBookingWorkerDatabaseHeld(options.lock,options.window).toolRevision!==options.toolRevision)fail('worker_database_scope');const{verifyWorkerDatabaseClosure}=await import('./release-toolchain-worker-database.mjs'),closure=await verifyWorkerDatabaseClosure(options);return releaseArchivedReplacement(options.lock,closure,'booking-worker-database-reconciled','booking-worker-database-replacement');}
export async function acceptBookingWorkerDatabaseKernel(root){
 const anchors=['/root/.pm2/pm2.pid','/var/lib/faolla-online-release/active.json','/www/wwwroot/merchant-space.current'];
 if(process.platform!=='linux'||process.getuid?.()!==0||process.env.GITHUB_ACTIONS!=='true'||process.env.RUNNER_ENVIRONMENT!=='github-hosted'||process.env.FAOLLA_RELEASE_PRODUCTION_EQ!=='1'||!/^\/var\/lib\/faolla-eq-[A-Za-z0-9]+$/.test(root)||anchors.some(file=>exists(file)))fail('ci_only');
 privateDirectory(root);const base=root+'/database-continuation';fs.mkdirSync(base,{mode:0o700});const cases=[];
 for(const outcome of ['normal','unknown-before-archive','unknown-after-archive','wrong-completion']){
  const directory=base+'/'+outcome;fs.mkdirSync(directory,{mode:0o700});const deploy=directory+'/deploy.lock',operation=directory+'/operation.lock',vault=directory+'/vault';privateWrite(deploy,'owned-deploy\n');fs.mkdirSync(operation,{mode:0o700});fs.mkdirSync(vault,{mode:0o700});privateWrite(directory+'/original-failure.json','original-failure\n');const original=dirIdentity(fs.lstatSync(operation));let cause,completed=false,archived=false;
  try{await withExistingOperationPreparation({deployLock:deploy,operation,observe:()=>({syntheticOnly:true})},async token=>{
   const busy=spawnSync('flock',['--nonblock',deploy,'true'],{env:runtimeEnvironment(),timeout:10000});if(busy.status!==1||busy.error||busy.signal)fail('ci_real_lock_not_held');let leaked=false;try{assertBookingWorkerDatabaseHeld(token);leaked=true;}catch{}if(leaked)fail('ci_token_production_leak');
   privateWrite(vault+'/database-closure.json','synthetic-completed-cycles\n');const closure={directory:vault,sha256:digest(readOwned(vault+'/database-closure.json'))};if(outcome==='unknown-before-archive')throw Error('owned_unknown');
   archiveOwnedExistingOperation(token,vault,closure.sha256,()=>{archived=true;if(outcome==='unknown-after-archive')throw Error('owned_unknown');});
   privateWrite(vault+'/reconciliation-completed.json',retentionCanonicalText({kind:outcome==='wrong-completion'?'foreign':'owned-database-completed',closureSha256:closure.sha256,archiveSha256:digest(readOwned(vault+'/operation-archived.json')),publicationAuthority:false}));releaseArchivedReplacement(token,closure,'owned-database-completed','owned-database-replacement');completed=true;
  });}catch(error){cause=error;privateWrite(vault+'/unconfirmed.json',retentionCanonicalText({automaticRetryAllowed:false,errorSha256:digest(String(error.message))}));}
  if(outcome==='normal'){if(cause||!completed||exists(operation))fail('ci_database_closure_unconfirmed');}else if(!cause||completed||!exists(vault+'/unconfirmed.json'))fail('ci_unknown_not_retained');
  equal(dirIdentity(privateDirectory(archived?vault+'/operation.lock':operation)),original,'ci_original_inode_changed');equal(readOwned(directory+'/original-failure.json'),Buffer.from('original-failure\n'),'ci_original_bytes_changed');cases.push({outcome,completed,archived});
 }
 if(anchors.some(file=>exists(file)))fail('ci_formal_anchor_created');return {kind:'worker-database-continuation-kernel-verified',cases,actualFlock:true,productionTokensRejected:true,originalOperationInodesRetained:true,originalFailureBytesRetained:true,unknownsNeverCompleted:true,formalHostTouched:false,publicationAuthority:false};
}

export async function acceptMetadataRecoveryKernel(){
 if(process.platform!=='linux'||process.getuid?.()!==0)fail('native_linux_root_required');
 const{executeMetadataRecoveryDisposition}=await import('./release-toolchain-metadata-recovery-contract.mjs'),{bookingHostReplace,bookingHostWriteOnce}=await import('./booking-handoff-host-io.mjs');
 const root=fs.mkdtempSync('/var/lib/faolla-metadata-recovery-native-');fs.chmodSync(root,0o700);const cases=[];
 for(const outcome of ['normal','wrong-state','unknown-after-metadata','unknown-after-publication','unknown-after-archive','operation-drift','wrong-completion']){
  const directory=root+'/'+outcome;fs.mkdirSync(directory,{mode:0o700});const deploy=directory+'/deploy.lock',operation=directory+'/operation.lock',vault=directory+'/vault',publication=directory+'/publication';privateWrite(deploy,'owned-disposition-lock\n');for(const file of[operation,vault,publication])fs.mkdirSync(file,{mode:0o700});privateWrite(directory+'/state.json','recovered\n');privateWrite(publication+'/failure.json','original-failure\n');
  const original=dirIdentity(fs.lstatSync(operation)),publicationId=dirIdentity(fs.lstatSync(publication));let completed=false,cause,archived=false;
  try{await withExistingOperationPreparation({deployLock:deploy,operation,observe:()=>({ownedOnly:true})},async token=>{
   const checked=()=>assertExistingOperationScopeHeld(token),busy=spawnSync('flock',['--nonblock',deploy,'true'],{timeout:2000});if(busy.status!==1||busy.signal||busy.error)fail('ci_real_lock_not_held');let refused=false;try{assertMetadataRecoveryHeld(token);}catch{refused=true;}if(!refused)fail('ci_token_production_leak');
   await executeMetadataRecoveryDisposition({assertHeld:checked,inspect:()=>bookingHostWriteOnce(vault+'/intent.json','one-owned-intent\n'),preserve:()=>{if(outcome==='operation-drift'){fs.renameSync(operation,directory+'/displaced-operation');fs.mkdirSync(operation,{mode:0o700});}},
    resetMetadata:()=>{bookingHostReplace(directory+'/state.json',outcome==='wrong-state'?'foreign\n':'recovered\n','staged\n','owned-disposition');if(outcome==='unknown-after-metadata')throw Error('ci_unknown_after_metadata');},
    preservePublication:()=>{fs.renameSync(publication,vault+'/publication');syncDirectory(directory);syncDirectory(vault);if(outcome==='unknown-after-publication')throw Error('ci_unknown_after_publication');},
    sealClosure:()=>privateWrite(vault+'/closure-sealed.json','owned-sealed\n'),
    archiveOperation:()=>{archiveOwnedExistingOperation(token,vault,digest(readOwned(vault+'/closure-sealed.json')),()=>{if(outcome==='unknown-after-archive')throw Error('ci_unknown_after_archive');});archived=true;},
    complete:()=>{const closure={directory:vault,sha256:digest(readOwned(vault+'/closure-sealed.json'))};privateWrite(vault+'/reconciliation-completed.json',retentionCanonicalText({kind:outcome==='wrong-completion'?'foreign':'owned-disposition-completed',closureSha256:closure.sha256,archiveSha256:digest(readOwned(vault+'/operation-archived.json')),publicationAuthority:false}));releaseArchivedReplacement(token,closure,'owned-disposition-completed','owned-disposition-replacement');privateWrite(vault+'/closed.json','owned-completed\n');completed=true;},
    failure:(error,stage)=>privateWrite(vault+'/unconfirmed.json',retentionCanonicalText({stage,errorSha256:digest(String(error.message)),automaticRetryAllowed:false,publicationAuthority:false}))
   });
  });}catch(error){cause=error;}
  if(outcome==='normal'){if(cause||!completed||exists(operation))fail('ci_disposition_unconfirmed');}
  else if(!cause||completed||!exists(vault+'/unconfirmed.json')||exists(vault+'/closed.json'))fail('ci_unknown_not_retained');
  const retainedPublication=exists(vault+'/publication')?vault+'/publication':publication,retainedOperation=exists(vault+'/operation.lock')?vault+'/operation.lock':outcome==='operation-drift'?directory+'/displaced-operation':operation;
  equal(dirIdentity(fs.lstatSync(retainedPublication)),publicationId,'ci_publication_inode_changed');equal(dirIdentity(fs.lstatSync(retainedOperation)),original,'ci_operation_inode_changed');equal(readOwned(retainedPublication+'/failure.json'),Buffer.from('original-failure\n'),'ci_failure_bytes_changed');
  cases.push({outcome,completed,archived,allOriginalInodesRetained:true,allOriginalBytesRetained:true,oldCertificateFabricated:false,productionAuthority:false});
 }
 const proof={kind:'metadata-recovery-kernel-accepted',cases,actualFlock:true,actualCas:true,actualInodePreservingRenames:true,productionTokensRejected:true,formalHostTouched:false,publicationAuthority:false};privateWrite(root+'/verified.json',retentionCanonicalText(proof));return{root,sha256:digest(readOwned(root+'/verified.json')),proof};
}
