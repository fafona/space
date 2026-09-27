import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import * as fs from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {assertOnlineRetirementPlan, assertOnlineRetirementCompletion,
  assertOnlineRetirementCertificate} from './online-release-retirement-policy.mjs';
import {WEB_RELEASE_FILES, WEB_RELEASE_PROXY, WEB_RELEASE_MARKER} from './web-presentation-release-policy.mjs';

export const ONLINE_RETIREMENT_ROOT = '/var/lib/faolla-online-retirement';
const APP = '/www/wwwroot/merchant-space';
const RELEASE_ROOT = '/var/lib/faolla-online-release';
const MAINTENANCE = '/var/lib/faolla-maintenance/merchant-space';
const NGINX = '/www/server/nginx/sbin/nginx';
const SHA = /^[a-f0-9]{40}$/;
const FILES = ['prepared.json', 'before.json', 'after.json', 'recovery-pm2.json', 'certificate.json'];
const fail = code => { throw Error(`online_retirement_${code}`); };
const hash = value => createHash('sha256').update(value).digest('hex');
const json = value => JSON.stringify(value, null, 2) + '\n';
const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
const equal = (left, right, code) => { if (!isDeepStrictEqual(left, right)) fail(code); };

function portOf(env) {
  const args = Array.isArray(env.args) ? env.args : [];
  const i = args.findIndex(value => value === '-p' || value === '--port');
  const value = env.PORT ?? env.env?.PORT ?? (i < 0 ? undefined : args[i + 1]);
  if (value === undefined) return null;
  if (!/^[1-9][0-9]{0,4}$/.test(String(value)) || Number(value) > 65535) fail('process_port_invalid');
  return Number(value);
}

/** Stable PM2 facts only; never include resource counters or private env values. */
export function normalizeRetirementProcess(raw) {
  const env = raw?.pm2_env;
  if (!env || typeof raw.name !== 'string' || !Number.isSafeInteger(raw.pm_id) || raw.pm_id < 0 ||
      !Number.isSafeInteger(raw.pid) || raw.pid < 0 || typeof env.pm_cwd !== 'string' ||
      typeof env.pm_exec_path !== 'string' || !Array.isArray(env.args ?? [])) fail('pm2_entry_invalid');
  if (env.pmx_module) fail('pm2_module_unsupported');
  const flag = key => env[key] ?? env.env?.[key];
  return {
    name: raw.name, pmId: raw.pm_id, pid: raw.pid, cwd: env.pm_cwd, status: env.status,
    port: portOf(env), executable: env.pm_exec_path, interpreter: env.exec_interpreter ?? null,
    args: env.args ?? [], nodeArgs: env.node_args ?? [], execMode: env.exec_mode ?? null,
    autorestart: env.autorestart ?? null, watch: env.watch === undefined ? false : env.watch,
    cronRestart: env.cron_restart === undefined ? null : env.cron_restart,
    ...(flag('NEXT_MANUAL_SIG_HANDLE') === undefined ? {} : {manualSignalHandle: flag('NEXT_MANUAL_SIG_HANDLE')}),
    backgroundPaused: flag('FAOLLA_BACKGROUND_JOBS_PAUSED') ?? null,
    automationEnabled: flag('MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED') ?? null,
    invitationEnabled: flag('MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED') ?? null,
    killTimeout: env.kill_timeout ?? null, shutdownWithMessage: env.shutdown_with_message ?? false,
    restartCount: env.restart_time ?? null, createdAt: env.created_at ?? null,
    environmentSha256: hash(JSON.stringify(stable(env.env ?? {}))),
  };
}

export function assertRetirementExecutable(process, fact, resolvedInterpreter) {
  if (process.executable !== `${process.cwd}/node_modules/next/dist/bin/next` ||
      !isDeepStrictEqual(process.args, ['start', '-H', '127.0.0.1', '-p', '3103']) ||
      process.execMode !== 'fork_mode' || !isDeepStrictEqual(process.nodeArgs, []) ||
      typeof process.interpreter !== 'string' || !process.interpreter.startsWith('/') ||
      fact.executable !== resolvedInterpreter || fact.cwd !== process.cwd) fail('victim_executable_changed');
}

function endpoint(text, wildcard = false) {
  const match = /^(.*):([0-9]+|\*)$/.exec(text);
  if (!match || (!wildcard && match[2] === '*')) fail('socket_endpoint_invalid');
  const port = match[2] === '*' ? null : Number(match[2]);
  if (port !== null && (!Number.isSafeInteger(port) || port < 1 || port > 65535)) fail('socket_endpoint_invalid');
  return {address: match[1].replace(/^\[|\]$/g, ''), port};
}

/** Parse complete ss output; unknown listener ownership fails closed. */
export function parseRetirementSockets(listeningText, connectionText) {
  const parse = text => text.split('\n').filter(line => line.trim()).map(line => {
    const match = /^(\S+)\s+\d+\s+\d+\s+(\S+)\s+(\S+)(?:\s+(.*))?$/.exec(line.trim());
    if (!match) fail('socket_line_invalid');
    return {state: match[1], local: endpoint(match[2]), peer: endpoint(match[3], true),
      pids: [...new Set([...((match[4] ?? '').matchAll(/\bpid=([1-9][0-9]*)\b/g))].map(item => Number(item[1])))].sort((a, b) => a - b)};
  });
  const listeners = parse(listeningText).flatMap(row => {
    if (row.state !== 'LISTEN' || !row.pids.length) fail('listener_owner_missing');
    return row.pids.map(pid => ({address: row.local.address, port: row.local.port, pid}));
  });
  const established = parse(connectionText).map(row => {
    if (row.state === 'LISTEN' || row.peer.port === null) fail('connection_evidence_invalid');
    return {state: row.state, localAddress: row.local.address, localPort: row.local.port,
      peerAddress: row.peer.address, peerPort: row.peer.port, pids: row.pids};
  });
  const order = rows => [...new Map(rows.map(row => [JSON.stringify(row), row])).values()]
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return {listeners: order(listeners), established: order(established)};
}

function directory(path, io = fs, privateMode = true) {
  const info = io.lstatSync(path);
  if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== 0 ||
      (privateMode ? (info.mode & 0o077) !== 0 : (info.mode & 0o022) !== 0)) fail('unsafe_directory');
}
function file(path, io = fs, privateMode = true) {
  const info = io.lstatSync(path);
  if (!info.isFile() || info.isSymbolicLink() || info.uid !== 0 || info.nlink !== 1 ||
      (privateMode ? (info.mode & 0o777) !== 0o600 : (info.mode & 0o022) !== 0)) fail('unsafe_file');
  return io.readFileSync(path, 'utf8');
}
function ancestors(path, io = fs) {
  for (let current = dirname(path); current !== dirname(current); current = dirname(current)) directory(current, io, false);
}
/** Existing PM2 may be 0755 beneath protected /root; never chmod its state. */
export function assertExistingPm2Directory(path = '/root/.pm2', io = fs) {
  ancestors(path, io);
  directory(path, io, false);
}
function parseJson(text) { try { return JSON.parse(text); } catch { fail('invalid_json'); } }

/** No writes on import/read. Incomplete attempts deliberately block publication. */
export function readOnlineRetirementCertificates(root = ONLINE_RETIREMENT_ROOT, io = fs) {
  if (!io.existsSync(root)) return [];
  ancestors(root, io); directory(root, io);
  const names = io.readdirSync(root).sort();
  if (!names.length) return [];
  if (!isDeepStrictEqual(names, [...FILES].sort())) fail('certificate_files_incomplete');
  const contents = Object.fromEntries(FILES.map(name => [name, file(`${root}/${name}`, io)]));
  const certificate = parseJson(contents['certificate.json']);
  assertOnlineRetirementCertificate(certificate);
  if (hash(contents['before.json']) !== certificate.beforeSha256 ||
      hash(contents['after.json']) !== certificate.afterSha256) fail('certificate_proof_changed');
  const before = parseJson(contents['before.json']), after = parseJson(contents['after.json']);
  const prepared = parseJson(contents['prepared.json']), recovery = parseJson(contents['recovery-pm2.json']);
  assertOnlineRetirementCompletion(before, after);
  equal(certificate.victim, before.victim, 'certificate_victim_changed');
  equal(certificate.stoppedProcess, after.processes.find(item => item.name === before.victim.name),
    'certificate_stopped_process_changed');
  equal([certificate.activeTarget, certificate.rollbackTarget, certificate.nextTarget],
    [before.active.target, before.rollback.target, before.toolRevision], 'certificate_anchors_changed');
  if (prepared.version !== 1 || prepared.status !== 'prepared' || prepared.beforeSha256 !== certificate.beforeSha256 ||
      prepared.recoverySha256 !== hash(contents['recovery-pm2.json']) || prepared.toolRevision !== certificate.nextTarget)
    fail('certificate_preparation_changed');
  equal(prepared.victim, before.victim, 'certificate_preparation_changed');
  equal(normalizeRetirementProcess(recovery.process), before.processes.find(item => item.name === before.victim.name),
    'certificate_recovery_changed');
  return [certificate];
}

function stableObservation(value) {
  const {established, ...rest} = value;
  return rest;
}

/** Executable sequence with injected I/O for tests; no implicit retry/restore. */
export async function executeOnlineRetirement(operations, first) {
  assertOnlineRetirementPlan(first);
  await operations.wait(2000);
  const before = await operations.observe();
  assertOnlineRetirementPlan(before);
  equal(stableObservation(before), stableObservation(first), 'observations_changed');
  const recovery = await operations.recovery(before), beforeText = json(before), recoveryText = json(recovery);
  const prepared = {version: 1, status: 'prepared', toolRevision: before.toolRevision, victim: before.victim,
    beforeSha256: hash(beforeText), recoverySha256: hash(recoveryText), preparedAt: operations.now()};
  operations.begin();
  operations.write('prepared.json', json(prepared));
  operations.write('before.json', beforeText);
  operations.write('recovery-pm2.json', recoveryText);
  // One final complete observation immediately before the one allowed signal.
  const rechecked = await operations.observe();
  assertOnlineRetirementPlan(rechecked);
  equal(stableObservation(rechecked), stableObservation(before), 'observations_changed');
  await operations.stop(before.victim.pmId);
  const stopped = await operations.observe(before);
  assertOnlineRetirementCompletion(before, stopped);
  await operations.save();
  await operations.verifyPersisted(stopped);
  const after = await operations.observe(before);
  assertOnlineRetirementCompletion(before, after);
  equal(stableObservation(stopped), stableObservation(after), 'post_save_changed');
  const afterText = json(after);
  operations.write('after.json', afterText);
  const certificate = {version: 1, status: 'completed', victim: before.victim,
    stoppedProcess: after.processes.find(item => item.name === before.victim.name),
    activeTarget: before.active.target, rollbackTarget: before.rollback.target, nextTarget: before.toolRevision,
    allowedActiveTargets: [before.active.target, before.rollback.target, before.toolRevision],
    beforeSha256: hash(beforeText), afterSha256: hash(afterText), completedAt: operations.now()};
  assertOnlineRetirementCertificate(certificate);
  operations.write('certificate.json', json(certificate));
  return certificate;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {encoding: 'utf8', env: {...process.env, PM2_HOME: '/root/.pm2'},
    timeout: 60000, maxBuffer: 16 * 1024 * 1024, ...options});
  if (result.status !== 0) fail(`command_failed:${command}:${result.status ?? result.error?.code ?? 'signal'}`);
  return result.stdout;
}
function processFact(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) fail('process_pid_invalid');
  const base = `/proc/${pid}`, info = fs.lstatSync(base);
  const raw = fs.readFileSync(`${base}/stat`, 'utf8'), end = raw.lastIndexOf(')');
  const fields = raw.slice(end + 2).trim().split(/\s+/);
  if (end < 1 || fields.length < 20 || !/^[0-9]+$/.test(fields[19])) fail('process_stat_invalid');
  return {pid, uid: info.uid, parentPid: Number(fields[1]), startTicks: fields[19],
    executable: fs.realpathSync(`${base}/exe`), cwd: fs.realpathSync(`${base}/cwd`),
    commandSha256: hash(fs.readFileSync(`${base}/cmdline`)), environmentSha256: hash(fs.readFileSync(`${base}/environ`))};
}
function environ(pid) {
  return Object.fromEntries(fs.readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0').filter(Boolean).map(entry => {
    const split = entry.indexOf('='); return [entry.slice(0, split), entry.slice(split + 1)];
  }));
}
function verifyDaemon() {
  assertExistingPm2Directory();
  const pidText = file('/root/.pm2/pm2.pid', fs, false).trim();
  if (!/^[1-9][0-9]*$/.test(pidText)) fail('daemon_pid_invalid');
  const pid = Number(pidText), fact = processFact(pid);
  const command = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0+$/, '');
  if (fact.uid !== 0 || command !== 'PM2 v6.0.14: God Daemon (/root/.pm2)') fail('daemon_identity_invalid');
  const path = fs.realpathSync(run('which', ['pm2']).trim());
  if (parseJson(file(`${dirname(dirname(path))}/package.json`, fs, false)).version !== '6.0.14') fail('pm2_version_invalid');
  const env = environ(pid);
  if (env.PM2_KILL_USE_MESSAGE || !['SIGINT', 'SIGTERM'].includes(env.PM2_KILL_SIGNAL || 'SIGINT')) fail('daemon_signal_unsupported');
  return {fact, killSignal: env.PM2_KILL_SIGNAL || 'SIGINT', killTimeout: Number(env.PM2_KILL_TIMEOUT || 1600)};
}
function sourceDirectory(path) {
  if (fs.realpathSync(path) !== path) fail('release_directory_changed');
  directory(path, fs, false);
}
async function buildId(port, host = 'www.faolla.com') {
  const response = await fetch(`http://127.0.0.1:${port}/api/app-web-version`, {
    headers: {Host: host, Connection: 'close'}, redirect: 'manual', signal: AbortSignal.timeout(15000)});
  if (response.status !== 200) { await response.arrayBuffer(); fail('build_probe_failed'); }
  const value = await response.json();
  if (value.ok !== true || !SHA.test(value.buildId ?? '')) fail('build_probe_invalid');
  return value.buildId;
}
function digestFile(path, privateMode = true) { return hash(file(path, fs, privateMode)); }
function validateTool(toolSha) {
  const directory = dirname(dirname(fileURLToPath(import.meta.url)));
  if (directory !== `/var/lib/faolla-online-code/${toolSha}` || fs.realpathSync(directory) !== directory ||
      run('git', ['rev-parse', 'HEAD'], {cwd: directory}).trim() !== toolSha ||
      run('git', ['rev-parse', 'origin/main'], {cwd: APP}).trim() !== toolSha ||
      run('git', ['status', '--porcelain=v1', '--untracked-files=all'], {cwd: directory}).trim()) fail('tool_source_invalid');
}

function assertAnchor(value, target, port) {
  if (!SHA.test(target ?? '') || value.target !== target || value.port !== port ||
      value.name !== `merchant-space-online-${target.slice(0, 12)}` ||
      value.directory !== `${APP}.web-releases/${target.slice(0, 12)}-online`) fail('release_anchor_invalid');
}
function persistPrivate(name, value) {
  if (!FILES.includes(name)) fail('state_file_invalid');
  const descriptor = fs.openSync(`${ONLINE_RETIREMENT_ROOT}/${name}`, 'wx', 0o600);
  try { fs.writeFileSync(descriptor, value); fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
  const parent = fs.openSync(ONLINE_RETIREMENT_ROOT, 'r');
  try { fs.fsyncSync(parent); } finally { fs.closeSync(parent); }
}

function productionOperations(toolRevision, liveSha, victimSha) {
  const state = target => parseJson(file(`${RELEASE_ROOT}/${target}/state.json`));
  const take = raw => raw.map(normalizeRetirementProcess).sort((a, b) => a.pmId - b.pmId);
  const pm = () => parseJson(run('pm2', ['jlist']));
  const observe = async frozen => {
    validateTool(toolRevision);
    const daemon = verifyDaemon();
    const rawProcesses = pm(), processes = take(rawProcesses);
    const activeText = file(`${RELEASE_ROOT}/active.json`), active = parseJson(activeText);
    assertAnchor(active, liveSha, 3110);
    const current = state(liveSha), victimState = state(victimSha);
    const rollback = {target: current.baseline, port: current.oldPort, name: current.oldName, directory: current.oldDirectory};
    assertAnchor(rollback, current.baseline, 3109);
    assertAnchor(victimState, victimSha, 3103);
    if (current.status !== 'active' || current.target !== liveSha || current.name !== active.name ||
        current.directory !== active.directory || current.port !== active.port || rollback.port !== 3109)
      fail('current_release_invalid');
    const previous = state(rollback.target);
    if (previous.status !== 'active' || previous.name !== rollback.name || previous.directory !== rollback.directory ||
        previous.port !== rollback.port) fail('rollback_release_invalid');
    const rawVictim = rawProcesses.find(item => item.name === victimState.name);
    const normalized = processes.find(item => item.name === victimState.name);
    if (!rawVictim || victimState.port !== 3103 || !normalized) fail('first_slot_invalid');
    const victim = frozen?.victim ?? {target: victimSha, name: victimState.name, pmId: rawVictim.pm_id,
      pid: rawVictim.pid, cwd: victimState.directory, port: victimState.port};
    for (const target of [active, rollback, {target: victimSha, directory: victim.cwd}]) {
      sourceDirectory(target.directory);
      if (run('git', ['rev-parse', 'HEAD'], {cwd: target.directory}).trim() !== target.target ||
          run('git', ['status', '--porcelain=v1', '--untracked-files=all'], {cwd: target.directory}).trim()) fail('release_source_changed');
    }
    run('git', ['merge-base', '--is-ancestor', victimSha, rollback.target], {cwd: APP});
    run('git', ['merge-base', '--is-ancestor', liveSha, toolRevision], {cwd: APP});
    const maintenanceText = file(`${MAINTENANCE}/state.json`);
    const sourceHead = run('git', ['rev-parse', 'HEAD'], {cwd: victim.cwd}).trim();
    let sourceBuild;
    if (!frozen) {
      sourceBuild = await buildId(victim.port);
      const runtime = environ(victim.pid);
      for (const [key, expected] of [['FAOLLA_BACKGROUND_JOBS_PAUSED', '1'],
        ['MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED', '0'], ['MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED', '0']]) {
        if (runtime[key] !== expected) fail('victim_runtime_flags_changed');
      }
      if (runtime.NEXT_MANUAL_SIG_HANDLE || rawVictim.pm2_env.shutdown_with_message) fail('victim_signal_unsupported');
      const timeout = rawVictim.pm2_env.kill_timeout ?? daemon.killTimeout;
      if (!Number.isSafeInteger(timeout) || timeout < 1000 || timeout > 60000) fail('victim_stop_timeout_unsupported');
      if (fs.readFileSync(`/proc/${victim.pid}/task/${victim.pid}/children`, 'utf8').trim()) fail('victim_children_present');
    } else {
      if (fs.existsSync(`/proc/${victim.pid}`)) fail('victim_process_still_present');
      sourceBuild = frozen.sourceState.buildId;
    }
    if (await buildId(active.port) !== active.target || await buildId(rollback.port) !== rollback.target) fail('protected_build_changed');
    const identityProofs = processes.map(item => item.name === victim.name && frozen
      ? frozen.identityProofs.find(proof => proof.name === victim.name)
      : {name: item.name, ...processFact(item.pid)}).sort((a, b) => a.name.localeCompare(b.name));
    const victimProof = identityProofs.find(item => item.name === victim.name);
    if (victimProof.uid !== 0 || victimProof.cwd !== victim.cwd || victimProof.parentPid !== daemon.fact.pid)
      fail('victim_os_identity_changed');
    assertRetirementExecutable(normalized, victimProof, fs.realpathSync(normalized.interpreter));
    const nginxConfig = run(NGINX, ['-T']);
    const sockets = parseRetirementSockets(run('ss', ['-ltnpH']), run('ss', ['-tnpH']));
    if (sockets.established.some(item => item.pids.includes(victim.pid))) fail('victim_outgoing_connections_present');
    const hashes = {};
    for (const target of [liveSha, rollback.target, victimSha]) hashes[`state:${target}`] = digestFile(`${RELEASE_ROOT}/${target}/state.json`);
    for (const target of [active, rollback, {target: victimSha, directory: victim.cwd}]) {
      hashes[`build:${target.target}`] = digestFile(`${target.directory}/.next/BUILD_ID`, false);
      hashes[`env:${target.target}`] = digestFile(`${target.directory}/.env.local`);
      hashes[`runtime:${target.target}`] = digestFile(`${RELEASE_ROOT}/${target.target}/runtime.json`);
    }
    for (const name of WEB_RELEASE_FILES) hashes[`proxy:${name}`] = digestFile(`${WEB_RELEASE_PROXY}/${name}`, false);
    return {victim, active, rollback, toolRevision,
      sourceState: {...victimState, buildId: sourceBuild, sourceHead}, sourceClean: true,
      maintenanceEnded: parseJson(maintenanceText).phase === 'ended', priorCertificates: [],
      protectedNames: processes.filter(item => item.name !== victim.name).map(item => item.name).sort(),
      processes, ...sockets, nginxConfig, identityProofs, daemon,
      maintenanceSha256: hash(maintenanceText), markerSha256: digestFile(WEB_RELEASE_MARKER, false),
      activeSha256: hash(activeText), baseDirectory: fs.realpathSync(`${APP}.current`), hashes};
  };
  return {
    observe, wait: ms => new Promise(resolve => setTimeout(resolve, ms)), now: () => new Date().toISOString(),
    recovery: async before => {
      const process = pm().find(item => item.name === before.victim.name);
      equal(normalizeRetirementProcess(process), before.processes.find(item => item.name === before.victim.name), 'recovery_process_changed');
      return {version: 1, process, runtime: parseJson(file(`${RELEASE_ROOT}/${victimSha}/runtime.json`)),
        processEnvironment: environ(before.victim.pid),
        dumpBefore: fs.existsSync('/root/.pm2/dump.pm2') ? file('/root/.pm2/dump.pm2', fs, false) : null};
    },
    begin: () => {
      if (fs.existsSync(ONLINE_RETIREMENT_ROOT)) fail('retirement_already_started');
      ancestors(ONLINE_RETIREMENT_ROOT); fs.mkdirSync(ONLINE_RETIREMENT_ROOT, {mode: 0o700}); directory(ONLINE_RETIREMENT_ROOT);
      const parent = fs.openSync(dirname(ONLINE_RETIREMENT_ROOT), 'r');
      try { fs.fsyncSync(parent); } finally { fs.closeSync(parent); }
    },
    write: persistPrivate,
    stop: async pmId => { run('pm2', ['stop', String(pmId)]); },
    save: async () => { run('pm2', ['save']); },
    verifyPersisted: async evidence => {
      const live = pm(), dump = parseJson(file('/root/.pm2/dump.pm2', fs, false));
      equal(take(live), evidence.processes, 'persisted_processes_changed');
      if (!Array.isArray(dump) || dump.length !== live.length || new Set(dump.map(item => item.name)).size !== dump.length)
        fail('dump_process_set_changed');
      for (const raw of live) {
        const saved = structuredClone(dump.find(item => item.name === raw.name)), expected = structuredClone(raw.pm2_env);
        delete expected.instances; delete expected.pm_id; delete expected.prev_restart_delay;
        // Instrumentation counters may advance between save and readback. They
        // are not restart configuration; nested environment fields stay exact.
        for (const key of ['axm_actions', 'axm_monitor', 'axm_options', 'axm_dynamic']) {
          delete saved[key]; delete expected[key];
        }
        equal(saved, expected, 'dump_process_changed');
      }
      const victim = dump.find(item => item.name === evidence.victim.name);
      if (victim.status !== 'stopped' || victim.pm_cwd !== evidence.victim.cwd) fail('dump_victim_not_stopped');
    },
  };
}

export async function onlineRetirementMain(args = process.argv.slice(2)) {
  const [action, toolRevision, liveSha, victimSha, ...extra] = args;
  if (process.platform !== 'linux' || process.getuid?.() !== 0 || !['inspect', 'retire'].includes(action) ||
      extra.length || [toolRevision, liveSha, victimSha].some(value => !SHA.test(value ?? '')) ||
      new Set([toolRevision, liveSha, victimSha]).size !== 3) fail('invocation_invalid');
  validateTool(toolRevision);
  if (action === 'retire' && !process.env.FAOLLA_ONLINE_RETIREMENT_LOCKED) {
    const lock = `${APP}.deploy.lock`;
    if (fs.existsSync(lock) && fs.lstatSync(lock).isSymbolicLink()) fail('unsafe_deploy_lock');
    const result = spawnSync('flock', ['--nonblock', lock, process.execPath, fileURLToPath(import.meta.url), ...args], {
      stdio: 'inherit', env: {...process.env, FAOLLA_ONLINE_RETIREMENT_LOCKED: '1', PM2_HOME: '/root/.pm2'}});
    if (result.status !== 0) fail('lock_or_child_failed');
    return;
  }
  let held = false;
  try {
    if (action === 'retire') {
      directory(MAINTENANCE); fs.mkdirSync(`${MAINTENANCE}/operation.lock`, {mode: 0o700}); held = true;
    }
    if (readOnlineRetirementCertificates().length || fs.existsSync(ONLINE_RETIREMENT_ROOT)) fail('retirement_already_started');
    const operations = productionOperations(toolRevision, liveSha, victimSha), first = await operations.observe();
    assertOnlineRetirementPlan(first);
    if (action === 'inspect') {
      await operations.wait(2000);
      const second = await operations.observe(); assertOnlineRetirementPlan(second);
      equal(stableObservation(first), stableObservation(second), 'observations_changed');
      console.log(JSON.stringify({status: 'eligible-not-stopped', victim: first.victim,
        current: first.active, rollback: first.rollback, processCount: first.processes.length,
        retainedFiles: true, nextTarget: toolRevision}));
    } else {
      const certificate = await executeOnlineRetirement(operations, first);
      readOnlineRetirementCertificates();
      console.log(JSON.stringify({status: certificate.status, victim: certificate.victim,
        activeTarget: certificate.activeTarget, rollbackTarget: certificate.rollbackTarget,
        nextTarget: certificate.nextTarget, retainedFiles: true, retainedRegistration: true}));
    }
  } finally { if (held) fs.rmdirSync(`${MAINTENANCE}/operation.lock`); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  onlineRetirementMain().catch(error => { console.error(error.message); process.exitCode = 1; });
}
