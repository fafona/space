import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import * as fs from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {normalizeRetirementProcess, parseRetirementSockets, readOnlineRetirementCertificates,
  assertExistingPm2Directory, ONLINE_RETIREMENT_ROOT} from './online-release-retirement.mjs';
import {assertOnlineRollingPlan, assertOnlineRollingCompletion, assertOnlineRollingCertificate,
  assertOnlineRollingHistory, assertRollingExecutable, rollingHash, rollingCanonicalText} from './online-release-rolling-policy.mjs';
import {WEB_RELEASE_FILES, WEB_RELEASE_PROXY, WEB_RELEASE_MARKER} from './web-presentation-release-policy.mjs';
export {assertRollingRetainedProcesses, assertRollingStateHistory} from './online-release-rolling-policy.mjs';

export const ONLINE_ROLLING_ROOT = '/var/lib/faolla-online-rolling';
const APP = '/www/wwwroot/merchant-space', RELEASE_ROOT = '/var/lib/faolla-online-release';
const MAINTENANCE = '/var/lib/faolla-maintenance/merchant-space', NGINX = '/www/server/nginx/sbin/nginx';
const SHA = /^[a-f0-9]{40}$/;
const FILES = ['prepared.json', 'before.json', 'after.json', 'recovery-pm2.json', 'certificate.json'];
const hash = value => createHash('sha256').update(value).digest('hex');
const json = value => JSON.stringify(value, null, 2) + '\n';
const fail = code => { throw Error(`online_rolling_${code}`); };
const equal = (left, right, code) => { if (!isDeepStrictEqual(left, right)) fail(code); };
const parse = value => { try { return JSON.parse(value); } catch { fail('invalid_json'); } };

function directory(path, io = fs, privateMode = true) {
  const value = io.lstatSync(path);
  if (!value.isDirectory() || value.isSymbolicLink() || value.uid !== 0 ||
      (privateMode ? (value.mode & 0o777) !== 0o700 : (value.mode & 0o022) !== 0)) fail('unsafe_directory');
}
function file(path, io = fs, privateMode = true) {
  const value = io.lstatSync(path);
  if (!value.isFile() || value.isSymbolicLink() || value.uid !== 0 || value.nlink !== 1 ||
      (privateMode ? (value.mode & 0o777) !== 0o600 : (value.mode & 0o022) !== 0)) fail('unsafe_file');
  return io.readFileSync(path, 'utf8');
}
function ancestors(path, io = fs) {
  for (let current = dirname(path); current !== dirname(current); current = dirname(current)) directory(current, io, false);
}
function legacyHistory(io, legacyRoot) {
  const legacyCertificates = readOnlineRetirementCertificates(legacyRoot, io);
  // Bind all original private bytes, not merely parsed certificate fields.
  const legacyFiles = legacyCertificates.length
    ? Object.fromEntries(FILES.map(name => [name, hash(file(`${legacyRoot}/${name}`, io))])) : {};
  const legacyProcesses = legacyCertificates.length ? parse(file(`${legacyRoot}/after.json`, io)).processes : [];
  return {version: 1, legacyCertificates, legacyProcesses, legacySha256: rollingHash(legacyFiles), entries: [], headSha256: null};
}
function readHistory(root, io, legacyRoot, pending = null) {
  const history = legacyHistory(io, legacyRoot);
  if (!io.existsSync(root)) return history;
  ancestors(root, io); directory(root, io);
  const records = [];
  for (const target of io.readdirSync(root).sort()) {
    if (!SHA.test(target)) fail('unknown_history_entry');
    const location = `${root}/${target}`; directory(location, io);
    const names = io.readdirSync(location).sort();
    if (pending && target === pending.target) {
      // Only this invocation may inspect its own durable preparation. Every
      // already-written byte must still match; public readers never skip it.
      equal(names, [...pending.contents.keys()].sort(), 'pending_evidence_changed');
      for (const name of names) equal(file(`${location}/${name}`, io), pending.contents.get(name), 'pending_evidence_changed');
      continue;
    }
    equal(names, [...FILES].sort(), 'history_files_incomplete');
    const texts = Object.fromEntries(FILES.map(name => [name, file(`${location}/${name}`, io)]));
    const certificate = parse(texts['certificate.json']);
    equal(texts['certificate.json'], rollingCanonicalText(certificate), 'certificate_bytes_changed');
    assertOnlineRollingCertificate(certificate);
    if (certificate.nextTarget !== target) fail('history_directory_changed');
    records.push({certificate, texts});
  }
  records.sort((a, b) => a.certificate.sequence - b.certificate.sequence);
  for (const {certificate, texts} of records) {
    const before = parse(texts['before.json']), after = parse(texts['after.json']);
    const prepared = parse(texts['prepared.json']), recovery = parse(texts['recovery-pm2.json']);
    equal(before.history, history, 'history_prefix_changed');
    for (const [name, key] of [['before.json', 'beforeSha256'], ['after.json', 'afterSha256'],
      ['prepared.json', 'preparedSha256'], ['recovery-pm2.json', 'recoverySha256']])
      if (hash(texts[name]) !== certificate[key]) fail('proof_hash_changed');
    assertOnlineRollingCompletion(before, after);
    equal(certificate.victim, before.victim, 'certificate_victim_changed');
    equal(certificate.protectedAnchors, before.protectedAnchors, 'certificate_anchors_changed');
    equal(certificate.stoppedProcess, after.processes.find(item => item.name === before.victim.name), 'stopped_process_changed');
    if (certificate.nextTarget !== before.toolRevision || certificate.previousSha256 !== history.headSha256 ||
        certificate.legacySha256 !== history.legacySha256 || certificate.sequence !== history.entries.length + 1)
      fail('certificate_context_changed');
    if (prepared.version !== 1 || prepared.status !== 'prepared' || prepared.nextTarget !== certificate.nextTarget ||
        prepared.previousSha256 !== certificate.previousSha256 || prepared.legacySha256 !== certificate.legacySha256 ||
        prepared.sequence !== certificate.sequence || prepared.beforeSha256 !== certificate.beforeSha256 ||
        prepared.recoverySha256 !== certificate.recoverySha256 || !Number.isFinite(Date.parse(prepared.preparedAt)))
      fail('preparation_changed');
    equal(prepared.victim, before.victim, 'preparation_victim_changed');
    equal(normalizeRetirementProcess(recovery.process), before.processes.find(item => item.name === before.victim.name), 'recovery_process_changed');
    history.entries.push(certificate); history.headSha256 = rollingHash(certificate);
    assertOnlineRollingHistory(history);
  }
  return history;
}

/** Complete immutable history only; any partial/unknown directory blocks. */
export function readOnlineRollingRetentions(root = ONLINE_ROLLING_ROOT, io = fs, legacyRoot = ONLINE_RETIREMENT_ROOT) {
  return readHistory(root, io, legacyRoot);
}
function stableObservation(value) { const {established, ...rest} = value; return rest; }

/** One attempted stop per target; no implicit retry, cleanup or recovery. */
export async function executeOnlineRolling(operations, first) {
  assertOnlineRollingPlan(first);
  await operations.wait(2000);
  const before = await operations.observe(); assertOnlineRollingPlan(before);
  equal(stableObservation(before), stableObservation(first), 'observations_changed');
  const recovery = await operations.recovery(before), beforeText = json(before), recoveryText = json(recovery);
  equal(normalizeRetirementProcess(recovery.process), before.processes.find(item => item.name === before.victim.name), 'recovery_process_changed');
  const prepared = {version: 1, status: 'prepared', nextTarget: before.toolRevision,
    previousSha256: before.history.headSha256, legacySha256: before.history.legacySha256,
    sequence: before.history.entries.length + 1, victim: before.victim,
    beforeSha256: hash(beforeText), recoverySha256: hash(recoveryText), preparedAt: operations.now()};
  const preparedText = json(prepared);
  operations.begin();
  operations.write('prepared.json', preparedText);
  operations.write('before.json', beforeText);
  operations.write('recovery-pm2.json', recoveryText);
  const rechecked = await operations.observe(); assertOnlineRollingPlan(rechecked);
  equal(stableObservation(rechecked), stableObservation(before), 'observations_changed');
  // Fresh identity/socket/daemon evidence, without intervening HTTP probes.
  const finalCheck = await operations.finalCheck(before); assertOnlineRollingPlan(finalCheck);
  equal(stableObservation(finalCheck), stableObservation(before), 'pre_stop_changed');
  await operations.stop(before.victim.pmId);
  const stopped = await operations.observe(before); assertOnlineRollingCompletion(before, stopped);
  await operations.save(); await operations.verifyPersisted(stopped);
  const after = await operations.observe(before); assertOnlineRollingCompletion(before, after);
  equal(stableObservation(stopped), stableObservation(after), 'post_save_changed');
  const afterText = json(after); operations.write('after.json', afterText);
  const certificate = {version: 1, policy: 'rolling-v1', status: 'completed', sequence: prepared.sequence,
    previousSha256: prepared.previousSha256, legacySha256: prepared.legacySha256,
    victim: before.victim, stoppedProcess: after.processes.find(item => item.name === before.victim.name),
    nextTarget: before.toolRevision, protectedAnchors: before.protectedAnchors,
    allowedActiveTargets: [before.toolRevision, ...before.protectedAnchors.map(item => item.target)],
    beforeSha256: hash(beforeText), afterSha256: hash(afterText), preparedSha256: hash(preparedText),
    recoverySha256: hash(recoveryText), completedAt: operations.now()};
  assertOnlineRollingCertificate(certificate);
  operations.write('certificate.json', rollingCanonicalText(certificate));
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
  const base = `/proc/${pid}`, info = fs.lstatSync(base), text = fs.readFileSync(`${base}/stat`, 'utf8');
  const end = text.lastIndexOf(')'), fields = text.slice(end + 2).trim().split(/\s+/);
  if (end < 1 || fields.length < 20 || !/^[0-9]+$/.test(fields[19])) fail('process_stat_invalid');
  return {pid, uid: info.uid, parentPid: Number(fields[1]), startTicks: fields[19],
    executable: fs.realpathSync(`${base}/exe`), cwd: fs.realpathSync(`${base}/cwd`),
    commandSha256: hash(fs.readFileSync(`${base}/cmdline`)), environmentSha256: hash(fs.readFileSync(`${base}/environ`))};
}
function environ(pid) {
  return Object.fromEntries(fs.readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0').filter(Boolean).map(value => {
    const split = value.indexOf('='); if (split < 1) fail('runtime_environment_invalid');
    return [value.slice(0, split), value.slice(split + 1)];
  }));
}
function verifyDaemon() {
  assertExistingPm2Directory();
  const text = file('/root/.pm2/pm2.pid', fs, false).trim();
  if (!/^[1-9][0-9]*$/.test(text)) fail('daemon_pid_invalid');
  const pid = Number(text), fact = processFact(pid);
  const command = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0+$/, '');
  if (fact.uid !== 0 || command !== 'PM2 v6.0.14: God Daemon (/root/.pm2)') fail('daemon_identity_invalid');
  const path = fs.realpathSync(run('which', ['pm2']).trim());
  if (parse(file(`${dirname(dirname(path))}/package.json`, fs, false)).version !== '6.0.14') fail('pm2_version_invalid');
  const env = environ(pid), killSignal = env.PM2_KILL_SIGNAL || 'SIGINT', killTimeout = Number(env.PM2_KILL_TIMEOUT || 1600);
  if (env.PM2_KILL_USE_MESSAGE || !['SIGINT', 'SIGTERM'].includes(killSignal) ||
      !Number.isSafeInteger(killTimeout) || killTimeout < 1000 || killTimeout > 60000) fail('daemon_signal_unsupported');
  return {fact, killSignal, killTimeout};
}
function sourceDirectory(path) {
  if (fs.realpathSync(path) !== path) fail('source_directory_changed');
  ancestors(path); directory(path, fs, false);
}
function validateTool(toolSha) {
  const location = dirname(dirname(fileURLToPath(import.meta.url)));
  if (location !== `/var/lib/faolla-online-code/${toolSha}`) fail('tool_source_invalid');
  sourceDirectory(location);
  if (run('git', ['rev-parse', 'HEAD'], {cwd: location}).trim() !== toolSha ||
      run('git', ['rev-parse', 'origin/main'], {cwd: APP}).trim() !== toolSha ||
      run('git', ['status', '--porcelain=v1', '--untracked-files=all'], {cwd: location}).trim()) fail('tool_source_invalid');
}
async function buildId(port) {
  const response = await fetch(`http://127.0.0.1:${port}/api/app-web-version`, {headers: {Host: 'www.faolla.com', Connection: 'close'},
    redirect: 'manual', signal: AbortSignal.timeout(15000)});
  if (response.status !== 200) { await response.arrayBuffer(); fail('build_probe_failed'); }
  const value = await response.json(); if (value.ok !== true || !SHA.test(value.buildId ?? '')) fail('build_probe_invalid');
  return value.buildId;
}
function anchorState(value, target) {
  if (!SHA.test(target ?? '') || value.target !== target || value.status !== 'active' ||
      value.name !== `merchant-space-online-${target.slice(0, 12)}` ||
      value.directory !== `${APP}.web-releases/${target.slice(0, 12)}-online` ||
      !Number.isSafeInteger(value.port) || value.port < 3103 || value.port > 3110) fail('release_state_invalid');
  return {target, name: value.name, directory: value.directory, port: value.port};
}
function syncDirectory(path) {
  const fd = fs.openSync(path, 'r'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
function privateWrite(location, value) {
  const fd = fs.openSync(location, 'wx', 0o600);
  try { fs.writeFileSync(fd, value); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  syncDirectory(dirname(location));
}
function productionOperations(toolRevision, liveSha, victimSha) {
  const state = target => parse(file(`${RELEASE_ROOT}/${target}/state.json`));
  const pm = () => parse(run('pm2', ['jlist']));
  const take = raw => raw.map(normalizeRetirementProcess).sort((a, b) => a.pmId - b.pmId);
  const pending = {target: toolRevision, contents: new Map()}; let begun = false;
  const history = () => readHistory(ONLINE_ROLLING_ROOT, fs, ONLINE_RETIREMENT_ROOT, begun ? pending : null);
  const observe = async frozen => {
    validateTool(toolRevision);
    if (fs.existsSync(`${RELEASE_ROOT}/${toolRevision}`)) fail('target_already_staged');
    const prior = history(); if (prior.entries.some(cert => cert.nextTarget === toolRevision)) fail('target_already_retired');
    const daemon = verifyDaemon(), raw = pm(), processes = take(raw);
    const activeText = file(`${RELEASE_ROOT}/active.json`), activeFile = parse(activeText);
    const current = state(liveSha), first = state(current.baseline), second = state(first.baseline);
    const anchors = [anchorState(current, liveSha), anchorState(first, current.baseline), anchorState(second, first.baseline)];
    for (const key of ['target', 'name', 'directory', 'port']) equal(activeFile[key], anchors[0][key], 'active_state_changed');
    for (const [next, old] of [[current, anchors[1]], [first, anchors[2]]])
      equal([next.baseline, next.oldName, next.oldDirectory, next.oldPort], [old.target, old.name, old.directory, old.port], 'rollback_link_changed');
    const victimState = state(victimSha), victimAnchor = anchorState(victimState, victimSha);
    const rawVictim = raw.find(item => item.name === victimAnchor.name), normalized = processes.find(item => item.name === victimAnchor.name);
    if (!rawVictim || !normalized) fail('victim_missing');
    const victim = frozen?.victim ?? {target: victimSha, name: victimAnchor.name, cwd: victimAnchor.directory,
      pmId: normalized.pmId, pid: normalized.pid, port: victimAnchor.port};
    const hashes = {};
    for (const item of [...anchors, victimAnchor]) {
      sourceDirectory(item.directory);
      if (run('git', ['rev-parse', 'HEAD'], {cwd: item.directory}).trim() !== item.target ||
          run('git', ['status', '--porcelain=v1', '--untracked-files=all'], {cwd: item.directory}).trim()) fail('release_source_changed');
      const buildText = file(`${item.directory}/.next/BUILD_ID`, fs, false);
      // Next BUILD_ID is not the Git/runtime app build ID. Pin its exact bytes
      // across observations while independently verifying HEAD and HTTP SHA.
      if (!/^[A-Za-z0-9_-]{1,200}\n?$/.test(buildText)) fail('disk_build_invalid');
      hashes[`build:${item.target}`] = hash(buildText);
      hashes[`state:${item.target}`] = hash(file(`${RELEASE_ROOT}/${item.target}/state.json`));
      hashes[`runtime:${item.target}`] = hash(file(`${RELEASE_ROOT}/${item.target}/runtime.json`));
      hashes[`env:${item.target}`] = hash(file(`${item.directory}/.env.local`));
      if (item.target !== victimSha || !frozen) if (await buildId(item.port) !== item.target) fail('runtime_build_changed');
    }
    const ancestry = [[victimSha, anchors[2].target], [anchors[2].target, anchors[1].target],
      [anchors[1].target, liveSha], [liveSha, toolRevision]].map(([older, newer]) => {
      run('git', ['merge-base', '--is-ancestor', older, newer], {cwd: APP}); return {older, newer, verified: true};
    });
    let victimRuntimeFlags, victimChildren;
    if (!frozen) {
      const env = environ(victim.pid);
      victimRuntimeFlags = {backgroundPaused: env.FAOLLA_BACKGROUND_JOBS_PAUSED,
        automationEnabled: env.MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED,
        invitationEnabled: env.MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED, manualSignalHandle: env.NEXT_MANUAL_SIG_HANDLE ?? ''};
      victimChildren = fs.readFileSync(`/proc/${victim.pid}/task/${victim.pid}/children`, 'utf8').trim();
      const timeout = normalized.killTimeout ?? daemon.killTimeout;
      if (!Number.isSafeInteger(timeout) || timeout < 1000 || timeout > 60000) fail('victim_stop_timeout_invalid');
    } else {
      if (fs.existsSync(`/proc/${victim.pid}`)) fail('victim_process_still_present');
      victimRuntimeFlags = frozen.victimRuntimeFlags; victimChildren = frozen.victimChildren;
    }
    const identityProofs = processes.filter(item => item.status === 'online' || item.name === victim.name).map(item =>
      item.name === victim.name && frozen ? frozen.identityProofs.find(proof => proof.name === item.name)
        : {name: item.name, ...processFact(item.pid)}).sort((a, b) => a.name.localeCompare(b.name));
    const proof = identityProofs.find(item => item.name === victim.name), resolvedInterpreter = fs.realpathSync(normalized.interpreter);
    assertRollingExecutable(normalized, proof, resolvedInterpreter);
    const maintenanceText = file(`${MAINTENANCE}/state.json`);
    for (const name of WEB_RELEASE_FILES) hashes[`proxy:${name}`] = hash(file(`${WEB_RELEASE_PROXY}/${name}`, fs, false));
    const nginxConfig = run(NGINX, ['-T']);
    const sockets = parseRetirementSockets(run('ss', ['-ltnpH']), run('ss', ['-tnpH']));
    return {toolRevision, victim, protectedAnchors: anchors.map(item => ({...item, process: processes.find(process => process.name === item.name)})),
      sourceState: {...victimState, sourceHead: victimSha, buildId: victimSha}, sourceClean: true,
      history: prior, targetNotStaged: true, maintenanceEnded: parse(maintenanceText).phase === 'ended',
      maintenanceSha256: hash(maintenanceText), markerSha256: hash(file(WEB_RELEASE_MARKER, fs, false)),
      activeSha256: hash(activeText), baseDirectory: fs.realpathSync(`${APP}.current`), hashes, ancestry,
      processes, identityProofs, daemon, resolvedInterpreter, victimRuntimeFlags, victimChildren, nginxConfig, ...sockets};
  };
  return {observe, wait: ms => new Promise(resolve => setTimeout(resolve, ms)), now: () => new Date().toISOString(),
    recovery: async before => {
      const process = pm().find(item => item.name === before.victim.name);
      return {version: 1, process, runtime: parse(file(`${RELEASE_ROOT}/${victimSha}/runtime.json`)),
        processEnvironment: environ(before.victim.pid),
        dumpBefore: fs.existsSync('/root/.pm2/dump.pm2') ? file('/root/.pm2/dump.pm2', fs, false) : null};
    },
    begin: () => {
      if (begun) fail('attempt_already_started');
      if (!fs.existsSync(ONLINE_ROLLING_ROOT)) {
        ancestors(ONLINE_ROLLING_ROOT); fs.mkdirSync(ONLINE_ROLLING_ROOT, {mode: 0o700}); syncDirectory(dirname(ONLINE_ROLLING_ROOT));
      }
      directory(ONLINE_ROLLING_ROOT);
      fs.mkdirSync(`${ONLINE_ROLLING_ROOT}/${toolRevision}`, {mode: 0o700}); syncDirectory(ONLINE_ROLLING_ROOT); begun = true;
    },
    write: (name, text) => {
      if (!begun || !FILES.includes(name) || pending.contents.has(name)) fail('evidence_write_invalid');
      privateWrite(`${ONLINE_ROLLING_ROOT}/${toolRevision}/${name}`, text); pending.contents.set(name, text);
    },
    finalCheck: async before => {
      const nginxConfig = run(NGINX, ['-T']), prior = history(), daemon = verifyDaemon();
      const processes = take(pm());
      const identityProofs = processes.filter(item => item.status === 'online').map(item =>
        ({name: item.name, ...processFact(item.pid)})).sort((a, b) => a.name.localeCompare(b.name));
      const victimChildren = fs.readFileSync(`/proc/${before.victim.pid}/task/${before.victim.pid}/children`, 'utf8').trim();
      const sockets = parseRetirementSockets(run('ss', ['-ltnpH']), run('ss', ['-tnpH']));
      return {...before, history: prior, processes, identityProofs, victimChildren, daemon, nginxConfig, ...sockets};
    },
    stop: async pmId => { run('pm2', ['stop', String(pmId)]); },
    save: async () => { run('pm2', ['save']); },
    verifyPersisted: async evidence => {
      const live = pm(), dump = parse(file('/root/.pm2/dump.pm2', fs, false));
      equal(take(live), evidence.processes, 'persisted_processes_changed');
      if (!Array.isArray(dump) || dump.length !== live.length || new Set(dump.map(item => item.name)).size !== dump.length)
        fail('dump_process_set_changed');
      for (const raw of live) {
        const saved = structuredClone(dump.find(item => item.name === raw.name)), expected = structuredClone(raw.pm2_env);
        delete expected.instances; delete expected.pm_id; delete expected.prev_restart_delay;
        for (const key of ['axm_actions', 'axm_monitor', 'axm_options', 'axm_dynamic']) { delete saved[key]; delete expected[key]; }
        equal(saved, expected, 'dump_process_changed');
      }
      const victim = dump.find(item => item.name === evidence.victim.name);
      if (victim.status !== 'stopped' || victim.pm_cwd !== evidence.victim.cwd) fail('dump_victim_not_stopped');
    },
  };
}

export async function onlineRollingMain(args = process.argv.slice(2)) {
  const [action, toolRevision, liveSha, victimSha, ...extra] = args;
  if (process.platform !== 'linux' || process.getuid?.() !== 0 || !['inspect', 'retire'].includes(action) || extra.length ||
      [toolRevision, liveSha, victimSha].some(value => !SHA.test(value ?? '')) || new Set([toolRevision, liveSha, victimSha]).size !== 3)
    fail('invocation_invalid');
  validateTool(toolRevision);
  if (action === 'retire' && !process.env.FAOLLA_ONLINE_ROLLING_LOCKED) {
    const lock = `${APP}.deploy.lock`;
    if (fs.existsSync(lock) && fs.lstatSync(lock).isSymbolicLink()) fail('unsafe_deploy_lock');
    const result = spawnSync('flock', ['--nonblock', lock, process.execPath, fileURLToPath(import.meta.url), ...args],
      {stdio: 'inherit', env: {...process.env, FAOLLA_ONLINE_ROLLING_LOCKED: '1', PM2_HOME: '/root/.pm2'}});
    if (result.status !== 0) fail('lock_or_child_failed'); return;
  }
  let held = false;
  try {
    if (action === 'retire') { directory(MAINTENANCE); fs.mkdirSync(`${MAINTENANCE}/operation.lock`, {mode: 0o700}); held = true; }
    const history = readOnlineRollingRetentions();
    if (history.entries.some(cert => cert.nextTarget === toolRevision) || fs.existsSync(`${ONLINE_ROLLING_ROOT}/${toolRevision}`))
      fail('target_already_attempted');
    const operations = productionOperations(toolRevision, liveSha, victimSha), first = await operations.observe();
    assertOnlineRollingPlan(first);
    if (action === 'inspect') {
      await operations.wait(2000); const second = await operations.observe(); assertOnlineRollingPlan(second);
      equal(stableObservation(first), stableObservation(second), 'observations_changed');
      console.log(JSON.stringify({status: 'eligible-not-stopped', victim: first.victim,
        protectedTargets: first.protectedAnchors.map(item => item.target), nextTarget: toolRevision, retainedFiles: true}));
    } else {
      const cert = await executeOnlineRolling(operations, first); readOnlineRollingRetentions();
      console.log(JSON.stringify({status: cert.status, victim: cert.victim, nextTarget: cert.nextTarget,
        protectedTargets: cert.protectedAnchors.map(item => item.target), retainedFiles: true, retainedRegistration: true}));
    }
  } finally { if (held) fs.rmdirSync(`${MAINTENANCE}/operation.lock`); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  onlineRollingMain().catch(error => { console.error(error.message); process.exitCode = 1; });
}
