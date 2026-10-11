// ONE approved checker-only repair. No application, build, database, process,
// traffic, maintenance, retention or cleanup writer is available in this runner.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {CONTACT_WECHAT_STAGED_REPAIR as p, CONTACT_WECHAT_STAGED_REPAIR_FILES as allowed,
  CONTACT_WECHAT_STAGED_REPAIR_PRESERVED as pins, CONTACT_WECHAT_STAGED_REPAIR_PATHS as paths,
  assertContactWechatStagedRepairReceipt} from './contact-wechat-staged-tool-repair-policy.mjs';
import {createOnlineReleaseToolPlan, verifyOnlineReleaseTool, verifyOnlineToolBootstrap, executeOnlineReleaseToolPlan,
  assertOnlineToolNoPending, withOnlineToolPreparationLocks, assertOnlineToolOwnedPath, runOnlineToolGit} from './prepare-online-release-tool.mjs';
import {attendanceRepairTreeFingerprint} from './attendance-staged-tool-repair.mjs';
import {readOnlineRetentionHistory} from './online-release-retention.mjs';
import {assertOnlineRetentionPublication} from './online-release-retention-policy.mjs';
import {normalizeRetirementProcess} from './online-release-retirement.mjs';
import {webReleaseRuntimeEnvironment, WEB_RELEASE_FILES, WEB_RELEASE_PROXY as proxy,
  WEB_RELEASE_MARKER as marker} from './web-presentation-release-policy.mjs';

const APP = '/www/wwwroot/merchant-space', ROOT = fileURLToPath(new URL('../', import.meta.url));
const maintenance = '/var/lib/faolla-maintenance/merchant-space';
const receiptFile = `${p.operation}/${p.receiptName}`;
const originalStateFile = `${p.operation}/${p.originalStateCopyName}`;
const sha = value => createHash('sha256').update(value).digest('hex');
const fail = code => {throw Error(`contact_wechat_staged_repair_${code}`);};
const need = (value, code) => {if (!value) fail(code);};
const same = (left, right, code) => need(isDeepStrictEqual(left, right), code);
const git = (directory, args) => runOnlineToolGit(directory, args).toString('utf8').trim();
const commandEnvironment = {PATH: '/usr/local/bin:/usr/bin:/bin:/usr/sbin', HOME: '/root',
  PM2_HOME: '/root/.pm2', LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8'};

function command(name, args) {
  const daemon = name === 'pm2' ? pm2DaemonIdentity() : null;
  const result = spawnSync(name, args, {encoding: 'utf8', env: commandEnvironment, timeout: 60000, maxBuffer: 4 * 1024 ** 2});
  need(result.status === 0 && !result.error && !result.signal, 'observation_failed');
  if (daemon) same(pm2DaemonIdentity(), daemon, 'daemon_identity_changed');
  return result.stdout;
}
function ownedFile(file, {privateMode = false, maxBytes = 8 * 1024 ** 2, allowEmpty = false} = {}) {
  assertOnlineToolOwnedPath(file, 'file');
  const before = fs.lstatSync(file);
  need(before.nlink === 1 && (before.size > 0 || allowEmpty && before.size === 0) && before.size <= maxBytes &&
    (!privateMode || (before.mode & 0o777) === 0o600), 'file_invalid');
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const opened = fs.fstatSync(fd), bytes = fs.readFileSync(fd), after = fs.fstatSync(fd), linked = fs.lstatSync(file);
    for (const key of ['dev', 'ino', 'uid', 'mode', 'nlink', 'size', 'mtimeMs', 'ctimeMs'])
      need([opened, after, linked].every(stat => stat[key] === before[key]), 'file_changed');
    need(bytes.length === before.size, 'file_changed');
    return bytes;
  } finally {fs.closeSync(fd);}
}
function evidenceExists(file) {
  try {fs.lstatSync(file); return true;} catch (error) {if (error.code === 'ENOENT') return false; throw error;}
}
function pm2DaemonIdentity() {
  const raw = ownedFile('/root/.pm2/pm2.pid'), pid = raw.toString('utf8').trim();
  need(/^[1-9]\d*$/.test(pid) && Number.isSafeInteger(Number(pid)) && fs.lstatSync(`/proc/${pid}`).uid === 0, 'daemon_identity_changed');
  const commandLine = fs.readFileSync(`/proc/${pid}/cmdline`);
  need(commandLine.length < 4096 && commandLine.toString('utf8').replace(/\0+$/, '') === 'PM2 v6.0.14: God Daemon (/root/.pm2)',
    'daemon_identity_changed');
  need(ownedFile('/root/.pm2/pm2.pid').equals(raw), 'daemon_identity_changed');
  return {pid, fileSha256: sha(raw), commandSha256: sha(commandLine)};
}
function pilotObservation() {
  const controller = '/opt/faolla-attendance-pilot/attendance-isolated-pilot-control.mjs';
  need(sha(ownedFile(controller)) === 'c6c9765717f3d8af709bdcbd4e0fcfd84178175d02e04fe710c8186ed23dfa24', 'pilot_controller_changed');
  const before = JSON.parse(ownedFile(paths['before.json'], {privateMode: true}));
  const restored = JSON.parse(ownedFile(paths['restored.json'], {privateMode: true}));
  const saved = value => value?.pilot?.map(service => ({name: service.name, id: service.id, running: service.running, health: service.health}));
  const original = saved(before), restore = saved(restored);
  need(Array.isArray(original) && original.length === 5 && new Set(original.map(service => service.name)).size === 5 &&
    new Set(original.map(service => service.id)).size === 5 && original.every(service => /^[a-f0-9]{64}$/.test(service.id)), 'pilot_evidence_invalid');
  same(restore, original, 'pilot_restore_changed');
  const status = JSON.parse(command('/usr/bin/node', [controller, 'status']));
  need(status.productionUnchanged === true && Array.isArray(status.services) && status.services.length === 5 &&
    new Set(status.services.map(service => service.name)).size === 5, 'pilot_changed');
  for (const service of original) {
    const live = status.services.find(row => row.name === service.name);
    need(live && live.running === service.running && live.health === service.health &&
      live.running === (live.name === 'db') && (live.name !== 'db' || live.health === 'healthy'), 'pilot_changed');
    const row = JSON.parse(command('docker', ['--host', 'unix:///var/run/docker.sock', 'inspect', '--format',
      '{"id":{{json .Id}},"name":{{json .Name}},"running":{{json .State.Running}},"ports":{{json .NetworkSettings.Ports}}}', service.id]));
    need(row.id === service.id && row.name === `/faolla-attendance-pilot-${service.name}` && row.running === service.running &&
      (row.ports === null || typeof row.ports === 'object' && !Array.isArray(row.ports) &&
        Object.values(row.ports).every(bindings => bindings === null || Array.isArray(bindings) && bindings.length === 0)), 'pilot_identity_changed');
  }
  return original;
}

export function contactWechatStagedRepairImportClosure(readSource) {
  const seen = new Set();
  function visit(name) {
    if (seen.has(name)) return;
    need(/^scripts\/[a-z0-9-]+\.mjs$/.test(name), 'bootstrap_import_invalid');
    seen.add(name);
    for (const match of readSource(name).matchAll(/(?:^|(?<=[;\r\n]))\s*(?:import\s+(?:[^;]*?\s+from\s+)?|export\s+[^;]*?\s+from\s+)['"]([^'"]+)['"]\s*;?/gm)) {
      if (match[1].startsWith('node:')) continue;
      need(match[1].startsWith('./'), 'bootstrap_import_invalid');
      visit(path.posix.normalize(path.posix.join(path.posix.dirname(name), match[1])));
    }
  }
  visit('scripts/contact-wechat-staged-tool-repair.mjs');
  return [...seen].sort();
}

function immutableSourceInputs(revision) {
  return runOnlineToolGit(APP, ['ls-tree', '-r', '-z', revision]).toString('utf8').split('\0').filter(Boolean)
    .filter(row => !allowed.includes(row.slice(row.indexOf('\t') + 1))).join('\0');
}
function verifySource(revision, rootDir, {bootstrap = false} = {}) {
  need(process.platform === 'linux' && process.getuid?.() === 0 && /^[a-f0-9]{40}$/.test(revision ?? '') &&
    ![p.target, p.baseline].includes(revision), 'invocation');
  const directory = path.resolve(rootDir);
  assertOnlineToolOwnedPath(directory); assertOnlineToolOwnedPath(APP);
  need(git(APP, ['rev-parse', 'origin/main']) === revision && git(directory, ['rev-parse', 'HEAD']) === revision &&
    git(directory, ['rev-parse', '--abbrev-ref', 'HEAD']) === 'HEAD' &&
    !git(directory, ['status', '--porcelain=v1', '--untracked-files=all']), 'source_identity');
  git(APP, ['merge-base', '--is-ancestor', p.target, revision]);
  if (!bootstrap) {
    need(directory === `/var/lib/faolla-online-code/${revision}`, 'source_location');
    verifyOnlineReleaseTool(createOnlineReleaseToolPlan(revision));
  } else {
    need(directory === `/var/lib/faolla-online-bootstrap/${revision}`, 'bootstrap_location');
    const files = contactWechatStagedRepairImportClosure(name => runOnlineToolGit(APP, ['show', `${revision}:${name}`]).toString('utf8'));
    const patterns = files.map(name => `/${name}`).join('\n') + '\n';
    const sparse = path.resolve(directory, git(directory, ['rev-parse', '--git-path', 'info/sparse-checkout']));
    need(ownedFile(sparse).toString('utf8') === patterns &&
      git(directory, ['config', '--worktree', '--get', 'core.sparseCheckout']) === 'true' &&
      git(directory, ['config', '--worktree', '--get', 'core.sparseCheckoutCone']) === 'false' &&
      git(directory, ['config', '--worktree', '--get', 'index.sparse']) === 'false', 'bootstrap_sparse');
    const entries = new Set(['.git']);
    for (const name of files) {
      need(ownedFile(`${directory}/${name}`).equals(runOnlineToolGit(APP, ['show', `${revision}:${name}`])), 'bootstrap_blob');
      const pieces = name.split('/'); while (pieces.length) {entries.add(pieces.join('/')); pieces.pop();}
    }
    const walk = (full, prefix = '') => {
      for (const entry of fs.readdirSync(full, {withFileTypes: true})) {
        const name = prefix + entry.name;
        need(entries.has(name) && !entry.isSymbolicLink(), 'bootstrap_entry');
        assertOnlineToolOwnedPath(path.join(full, entry.name), entry.isDirectory() ? 'directory' : 'file');
        if (entry.isDirectory()) walk(path.join(full, entry.name), name + '/');
      }
    };
    walk(directory);
    verifyOnlineToolBootstrap(createOnlineReleaseToolPlan(revision), `${directory}/scripts/prepare-online-release-tool.mjs`);
  }
  const changes = git(APP, ['diff', '--no-renames', '--name-status', p.target, revision]).split('\n').filter(Boolean).map(row => {
    const [status, name, ...extra] = row.split('\t');
    need(['M', 'A'].includes(status) && extra.length === 0 && allowed.includes(name), 'source_scope');
    return name;
  }).sort();
  same(changes, [...allowed].sort(), 'source_scope');
  const original = immutableSourceInputs(p.target), current = immutableSourceInputs(revision);
  need(current === original && sha(current) === p.sourceInputsSha256, 'application_inputs_changed');
  return {toolRevision: revision, changedToolFiles: changes, sourceInputsSha256: sha(current)};
}

function candidateState(phase, {sealedOriginalRequired = false} = {}) {
  need(['preparing', 'ready-no-database'].includes(phase), 'phase_invalid');
  const current = ownedFile(paths['state.json'], {privateMode: true}), state = JSON.parse(current);
  let original = current;
  if (sealedOriginalRequired || phase === 'ready-no-database') {
    original = ownedFile(originalStateFile, {privateMode: true});
    need(sha(original) === p.stateSha256, 'original_state_changed');
  }
  if (phase === 'preparing') need(sha(current) === p.stateSha256, 'candidate_changed');
  else {
    const expected = JSON.parse(original);
    need(expected.status === 'preparing', 'original_state_changed');
    expected.status = 'ready-no-database';
    same(state, expected, 'candidate_transition_changed');
  }
  need(state.status === phase && state.target === p.target && state.baseline === p.baseline &&
    state.directory === p.directory && state.name === p.name && state.port === p.port &&
    state.lane === 'contact-wechat-code-only' && state.contactWechatBuildProofSha256 === p.buildProofSha256, 'candidate_changed');
  return {state, current, original};
}
function candidateSource() {
  need(git(p.directory, ['rev-parse', 'HEAD']) === p.target &&
    !git(p.directory, ['status', '--porcelain=v1', '--untracked-files=all']), 'candidate_source_changed');
  const rows = runOnlineToolGit(APP, ['ls-tree', '-r', '-z', p.target]).toString('utf8').split('\0').filter(Boolean);
  for (const row of rows) {
    const match = /^(100644|100755) blob ([a-f0-9]{40})\t([^\0]+)$/.exec(row);
    need(match && !match[3].startsWith('/') && !match[3].includes('\\') &&
      !/[\r\n]/.test(match[3]) && match[3].split('/').every(piece => piece && !['.', '..'].includes(piece)), 'candidate_source_invalid');
    const bytes = ownedFile(`${p.directory}/${match[3]}`, {maxBytes: 256 * 1024 ** 2, allowEmpty: true});
    need(createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex') === match[2], 'candidate_source_changed');
  }
  need(rows.length > 0 && sha(immutableSourceInputs(p.target)) === p.sourceInputsSha256, 'candidate_source_changed');
}
function protectedEnvironment(environment, keys) {
  const ignored = new Set(['FAOLLA_WEB_BUILD_ID', 'NEXT_PUBLIC_FAOLLA_WEB_BUILD_ID', 'FAOLLA_WEB_RELEASED_AT',
    'FAOLLA_BACKGROUND_JOBS_PAUSED', 'MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED', 'MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED',
    'PORT', 'PM2_HOME', 'NODE_OPTIONS', 'NEXT_TELEMETRY_DISABLED', 'NODE_APP_INSTANCE', 'NODE_CHANNEL_FD',
    'NODE_CHANNEL_SERIALIZATION_MODE', 'NODE_UNIQUE_ID', 'PM2_USAGE']);
  const actualKeys = Object.keys(environment).sort().filter(key => /^[A-Z][A-Z0-9_]*$/.test(key) && !ignored.has(key));
  same(actualKeys, keys, 'inherited_environment_changed');
  need(keys.every(key => typeof environment[key] === 'string'), 'inherited_environment_changed');
  return Object.fromEntries(keys.map(key => [key, environment[key]]));
}
function fixedCandidateEnvironment(state, environment, runtime) {
  need(state.target === p.target && state.baseline === p.baseline && state.directory === p.directory &&
    state.port === p.port && typeof runtime.PWD === 'string' && runtime.PWD.length > 0 &&
    environment.PWD === p.directory, 'inherited_environment_changed');
  // PM2 legitimately sets the new process PWD to its fixed launch directory.
  // Preserve raw bytes and PWD as a protected key; normalize only this digest
  // input copy to the already sealed, verified baseline/runtime value.
  return {...environment, PWD: runtime.PWD};
}
function processObservation(state, all) {
  const own = all.find(process => process.name === p.name), baseline = all.find(process => process.name === state.oldName);
  need(own && own.pid === p.candidatePid && sha(JSON.stringify(normalizeRetirementProcess(own))) === p.candidateProcessSha256,
    'candidate_process_changed');
  need(baseline?.pid === state.contactWechatBaselinePid && baseline.pm2_env.status === 'online' &&
    baseline.pm2_env.pm_cwd === state.oldDirectory, 'baseline_process_changed');
  // /proc files have size zero; bounded reads and a second PM2/proc snapshot,
  // rather than ordinary-file metadata, bind them to the unchanged live PID.
  const actual = process => {
    need(fs.lstatSync(`/proc/${process.pid}`).uid === 0, 'process_owner_changed');
    const contents = fs.readFileSync(`/proc/${process.pid}/environ`);
    need(contents.length > 0 && contents.length <= 1024 ** 2, 'process_environment_invalid');
    need(fs.realpathSync(`/proc/${process.pid}/cwd`) === process.pm2_env.pm_cwd, 'process_directory_changed');
    return {bytes: contents, environment: webReleaseRuntimeEnvironment(contents.toString('utf8'))};
  };
  const candidate = actual(own), original = actual(baseline);
  need(sha(candidate.bytes) === p.candidateProcessEnvironmentSha256 &&
    sha(fs.readFileSync(`/proc/${own.pid}/cmdline`)) === p.candidateProcessCommandSha256 &&
    fs.realpathSync(`/proc/${own.pid}/exe`) === p.candidateProcessExecutable, 'candidate_process_changed');
  const runtimeBytes = ownedFile(paths['runtime.json'], {privateMode: true});
  need(sha(runtimeBytes) === pins['runtime.json'] && state.contactWechatRuntimeSha256 === pins['runtime.json'],
    'inherited_environment_changed');
  const runtime = JSON.parse(runtimeBytes);
  const inheritedKeys = state.contactWechatInheritedEnvironmentKeys;
  need(Array.isArray(inheritedKeys) && inheritedKeys.includes('PWD') && typeof runtime.PWD === 'string' && runtime.PWD.length > 0,
    'inherited_environment_changed');
  // Verify all original inputs first. In particular baseline PWD is bound to
  // its sealed value/digest, not inferred from the baseline process cwd.
  for (const environment of [runtime, original.environment, baseline.pm2_env])
    need(sha(JSON.stringify(protectedEnvironment(environment, inheritedKeys))) === state.contactWechatInheritedEnvironmentSha256,
      'inherited_environment_changed');
  need(own.pm2_env.pm_cwd === p.directory, 'process_directory_changed');
  // protectedEnvironment ignores only the existing PM2 bookkeeping keys and
  // lowercase metadata; every uppercase business key remains exact.
  for (const environment of [candidate.environment, own.pm2_env]) {
    const digestInput = fixedCandidateEnvironment(state, environment, runtime);
    need(sha(JSON.stringify(protectedEnvironment(digestInput, inheritedKeys))) === state.contactWechatInheritedEnvironmentSha256,
      'inherited_environment_changed');
  }
  for (const environment of [candidate.environment, runtime, own.pm2_env])
    need(environment.FAOLLA_BACKGROUND_JOBS_PAUSED === '1' && environment.MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED === '0' &&
      environment.MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED === '0' && environment.FAOLLA_WEB_BUILD_ID === p.target &&
      environment.NEXT_PUBLIC_FAOLLA_WEB_BUILD_ID === p.target && environment.FAOLLA_SUPER_ADMIN_ORIGIN === 'https://console.faolla.com' &&
      environment.PORT === String(p.port) && environment.NODE_OPTIONS === '--max-old-space-size=4096' &&
      environment.NEXT_TELEMETRY_DISABLED === '1' && environment.PM2_HOME === '/root/.pm2', 'candidate_environment_changed');
  need(sha(ownedFile(`${state.oldDirectory}/.env.local`, {privateMode: true})) === state.contactWechatBaselineEnvironmentFileSha256,
    'baseline_environment_changed');
  return {processes: all.map(normalizeRetirementProcess), candidateEnvironmentSha256: sha(candidate.bytes),
    baselineEnvironmentSha256: sha(original.bytes)};
}

function observe(phase = 'preparing', {sealedOriginalRequired = false} = {}) {
  assertOnlineToolOwnedPath(p.operation);
  need((fs.lstatSync(p.operation).mode & 0o777) === 0o700, 'operation_invalid');
  assertOnlineToolOwnedPath(p.directory);
  const {state, current, original} = candidateState(phase, {sealedOriginalRequired});
  candidateSource();
  const preserved = {};
  same(Object.keys(paths).sort(), Object.keys(pins).sort(), 'preserved_paths_invalid');
  for (const name of Object.keys(pins)) {
    const bytes = name === 'state.json' ? original : ownedFile(paths[name], {privateMode: !['BUILD_ID', 'package-lock.json'].includes(name)});
    preserved[name] = sha(bytes);
  }
  same(preserved, pins, 'preserved_evidence_changed');
  const proof = JSON.parse(ownedFile(paths['attendance-build-proof.json'], {privateMode: true}));
  need(proof.target === p.target && proof.buildId === ownedFile(paths.BUILD_ID).toString('utf8').trim() &&
    proof.guardedCommand === 'npm run build' && proof.memoryBytes === 4294967296 && proof.heapMiB === 3072 &&
    proof.cpuQuotaPercent === 100 && proof.tasks === 128 && proof.seconds === 1200 &&
    proof.privateNetworkVerified === true && proof.swapBytes === 0, 'build_proof_changed');
  for (const name of ['attendance-database-compatibility.json', 'attendance-compatibility-attempt.json',
    'attendance-compatibility-metadata.sql', 'attendance-database-progress.json', 'attendance-database-ready.json'])
    need(!evidenceExists(`${p.operation}/${name}`), 'database_attempt_exists');
  const activeBytes = ownedFile('/var/lib/faolla-online-release/active.json', {privateMode: true}), active = JSON.parse(activeBytes);
  need(sha(activeBytes) === p.activeSha256 && active.target === p.baseline, 'baseline_changed');
  const maintenanceBytes = ownedFile(`${maintenance}/state.json`, {privateMode: true});
  need(sha(maintenanceBytes) === p.maintenanceSha256 && JSON.parse(maintenanceBytes).phase === 'ended', 'maintenance_changed');
  need(sha(ownedFile(marker)) === p.markerSha256, 'marker_changed');
  same(Object.keys(state.configs).sort(), [...WEB_RELEASE_FILES].sort(), 'proxy_changed');
  for (const name of WEB_RELEASE_FILES) need(sha(ownedFile(`${proxy}/${name}`)) === state.configs[name].oldHash, 'proxy_changed');
  const history = readOnlineRetentionHistory();
  need(history.headSha256 === p.retentionHeadSha256, 'retention_changed');
  const all = JSON.parse(command('pm2', ['jlist'])), processes = processObservation(state, all);
  assertOnlineRetentionPublication({history, state, actualActive: active, current: processes.processes, action: 'status'});
  const pilot = pilotObservation();
  const built = attendanceRepairTreeFingerprint(`${p.directory}/.next`, {exclude: ['cache', 'trace']});
  need(built.sha256 === p.builtOutputSha256, 'build_output_changed');
  const dependency = attendanceRepairTreeFingerprint(`${p.directory}/node_modules`, {allowInternalLinks: true});
  need(dependency.sha256 === p.dependencySha256, 'dependencies_changed');
  same(dependency, attendanceRepairTreeFingerprint(`${state.oldDirectory}/node_modules`, {allowInternalLinks: true}), 'dependencies_changed');
  need(ownedFile(`${state.oldDirectory}/package-lock.json`).equals(ownedFile(paths['package-lock.json'])), 'dependencies_changed');
  const finalProcesses = processObservation(state, JSON.parse(command('pm2', ['jlist'])));
  same(finalProcesses, processes, 'process_changed_during_observation');
  for (const name of Object.keys(pins)) {
    const file = name === 'state.json' && (sealedOriginalRequired || phase === 'ready-no-database') ? originalStateFile : paths[name];
    need(sha(ownedFile(file, {privateMode: !['BUILD_ID', 'package-lock.json'].includes(name)})) === pins[name],
      'preserved_evidence_changed');
  }
  need(ownedFile('/var/lib/faolla-online-release/active.json', {privateMode: true}).equals(activeBytes), 'baseline_changed');
  need(ownedFile(`${maintenance}/state.json`, {privateMode: true}).equals(maintenanceBytes), 'maintenance_changed');
  need(sha(ownedFile(marker)) === p.markerSha256, 'marker_changed');
  for (const name of WEB_RELEASE_FILES) need(sha(ownedFile(`${proxy}/${name}`)) === state.configs[name].oldHash, 'proxy_changed');
  need(readOnlineRetentionHistory().headSha256 === p.retentionHeadSha256, 'retention_changed');
  same(pilotObservation(), pilot, 'pilot_changed_during_observation');
  need(git(p.directory, ['rev-parse', 'HEAD']) === p.target &&
    !git(p.directory, ['status', '--porcelain=v1', '--untracked-files=all']), 'candidate_source_changed');
  need(ownedFile(paths['state.json'], {privateMode: true}).equals(current), 'candidate_changed_during_observation');
  return {preservedFiles: preserved, builtOutputSha256: built.sha256, dependencySha256: dependency.sha256,
    stateSha256: sha(current), stateText: current.toString('utf8'), pilot, ...processes};
}

function sealFile(file, bytes) {
  const fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
  try {fs.writeFileSync(fd, bytes); fs.fsyncSync(fd);} finally {fs.closeSync(fd);}
  const directory = fs.openSync(p.operation, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
  try {fs.fsyncSync(directory);} finally {fs.closeSync(directory);}
  need(ownedFile(file, {privateMode: true}).equals(Buffer.from(bytes)), 'sealed_evidence_changed');
}

export function assertContactWechatStagedRepairCandidate({target, rootDir = ROOT, phase = 'preparing'} = {}) {
  need(target === p.target && ['preparing', 'ready-no-database'].includes(phase), 'receipt_target');
  need(process.platform === 'linux' && process.getuid?.() === 0, 'invocation');
  const raw = ownedFile(receiptFile, {privateMode: true}), receipt = JSON.parse(raw);
  assertContactWechatStagedRepairReceipt(receipt, {target});
  const source = verifySource(receipt.toolRevision, rootDir);
  same(source.changedToolFiles, receipt.changedToolFiles, 'receipt_source_changed');
  need(source.sourceInputsSha256 === receipt.sourceInputsSha256, 'receipt_source_changed');
  const observed = observe(phase, {sealedOriginalRequired: true});
  need(observed.dependencySha256 === receipt.dependencySha256 && observed.builtOutputSha256 === receipt.builtOutputSha256,
    'receipt_candidate_changed');
  same(observed.preservedFiles, receipt.preservedFiles, 'receipt_evidence_changed');
  need(ownedFile(receiptFile, {privateMode: true}).equals(raw), 'receipt_changed');
  return {receipt, receiptSha256: sha(raw), toolRevision: receipt.toolRevision};
}

export function prepareContactWechatStagedToolRepair(revision, confirm) {
  need(confirm === 'approved-contact-wechat-staged-tool-repair', 'approval_required');
  const source = verifySource(revision, ROOT, {bootstrap: true});
  need(!evidenceExists(receiptFile) && !evidenceExists(originalStateFile), 'receipt_exists');
  const initial = observe();
  return withOnlineToolPreparationLocks({deployLock: `${APP}.deploy.lock`, maintenance}, () => {
    same(verifySource(revision, ROOT, {bootstrap: true}), source, 'source_changed_during_preparation');
    need(!evidenceExists(receiptFile) && !evidenceExists(originalStateFile), 'receipt_exists');
    const before = observe(); same(before, initial, 'candidate_changed_before_preparation');
    const receipt = {schemaVersion: 1, kind: 'contact-wechat-staged-tool-repair', target: p.target, baseline: p.baseline,
      toolRevision: revision, originalStateSha256: p.stateSha256, originalBuildProofSha256: p.buildProofSha256,
      sourceInputsSha256: source.sourceInputsSha256, builtOutputSha256: before.builtOutputSha256,
      preservedFiles: before.preservedFiles, activeSha256: p.activeSha256, maintenanceSha256: p.maintenanceSha256,
      markerSha256: p.markerSha256, retentionHeadSha256: p.retentionHeadSha256, dependencySha256: before.dependencySha256,
      changedToolFiles: source.changedToolFiles, approvedNoRebuild: true, preparedAt: new Date().toISOString()};
    assertContactWechatStagedRepairReceipt(receipt, {target: p.target, toolRevision: revision});
    assertOnlineToolNoPending({fixedContactWechatStagedRepairReceipt: receipt});
    const plan = createOnlineReleaseToolPlan(revision), prior = process.umask(0o077);
    let prepared;
    try {prepared = executeOnlineReleaseToolPlan(plan);} finally {process.umask(prior);}
    same(verifySource(revision, prepared.directory), source, 'source_changed_during_preparation');
    same(observe(), before, 'candidate_changed_during_preparation');
    // Sealed original bytes allow ONLY the normal preparing -> ready-no-database
    // transition later; this runner never changes the original state file.
    sealFile(originalStateFile, Buffer.from(before.stateText));
    need(sha(ownedFile(originalStateFile, {privateMode: true})) === p.stateSha256, 'original_state_changed');
    sealFile(receiptFile, JSON.stringify(receipt, null, 2) + '\n');
    same(observe('preparing', {sealedOriginalRequired: true}), before, 'candidate_changed_after_preparation');
    return {status: 'contact-wechat-staged-tool-repair-prepared', target: p.target, toolRevision: revision,
      receiptSha256: sha(ownedFile(receiptFile, {privateMode: true})), applicationRebuilt: false,
      productionDatabaseChanged: false, trafficChanged: false, source: prepared};
  });
}

export function contactWechatStagedRepairMain(args = process.argv.slice(2)) {
  need(args.length === 3 && args[0] === 'prepare', 'invocation');
  return prepareContactWechatStagedToolRepair(args[1], args[2]);
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {console.log(JSON.stringify(contactWechatStagedRepairMain()));}
  catch (error) {
    console.error(/^contact_wechat_staged_repair_[a-z_]+$/.test(error?.message ?? '') ? error.message : 'contact_wechat_staged_repair_unverified');
    process.exitCode = 1;
  }
}
