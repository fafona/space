import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {normalizeRetirementProcess} from './online-release-retirement.mjs';
import {ROLLING_BASE_NAMES, rollingHash, assertOnlineRollingPlan, assertOnlineRollingCompletion,
  assertOnlineRollingHistory, assertOnlineRollingCertificate, assertRollingRetainedProcesses,
  assertRollingStateHistory, assertRollingExecutable} from './online-release-rolling-policy.mjs';

const clone = value => structuredClone(value);
const sha = value => value.repeat(40), digest = value => createHash('sha256').update(value).digest('hex');
const name = target => `merchant-space-online-${target.slice(0, 12)}`;
const cwd = target => `/www/wwwroot/merchant-space.web-releases/${target.slice(0, 12)}-online`;
const text = value => JSON.stringify(value, null, 2) + '\n';
const location = (target, port) => ({target, name: name(target), directory: cwd(target), port});
function raw(target, port, id) {
  return {name: name(target), pm_id: id, pid: id + 1000, pm2_env: {
    name: name(target), pm_id: id, status: 'online', pm_cwd: cwd(target),
    pm_exec_path: `${cwd(target)}/node_modules/next/dist/bin/next`, args: ['start', '-H', '127.0.0.1', '-p', String(port)],
    exec_interpreter: '/usr/bin/node', exec_mode: 'fork_mode', PORT: String(port), watch: false, cron_restart: false,
    FAOLLA_BACKGROUND_JOBS_PAUSED: '1', MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED: '0',
    MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED: '0', env: {PORT: String(port), SECRET: 'private-synthetic'},
    restart_time: 0, created_at: 123, shutdown_with_message: false,
  }};
}
function stopped(before) {
  const after = clone(before), process = after.processes.find(item => item.name === before.victim.name);
  process.pid = 0; process.status = 'stopped'; after.listeners = after.listeners.filter(item => item.pid !== before.victim.pid);
  return after;
}
function plan(history, processes, victimTarget, nextTarget, targets) {
  const victimProcess = processes.find(item => item.name === name(victimTarget));
  const victim = {target: victimTarget, name: victimProcess.name, cwd: victimProcess.cwd,
    pmId: victimProcess.pmId, pid: victimProcess.pid, port: victimProcess.port};
  const protectedAnchors = targets.map(target => {
    const process = processes.find(item => item.name === name(target));
    return {...location(target, process.port), process: clone(process)};
  });
  return {toolRevision: nextTarget, victim, protectedAnchors, history: clone(history), processes: clone(processes),
    sourceState: {...location(victimTarget, victim.port), status: 'active', sourceHead: victimTarget, buildId: victimTarget},
    sourceClean: true, targetNotStaged: true, maintenanceEnded: true,
    ancestry: [[victimTarget, targets[2]], [targets[2], targets[1]], [targets[1], targets[0]], [targets[0], nextTarget]]
      .map(([older, newer]) => ({older, newer, verified: true})),
    nginxConfig: `server { proxy_pass http://127.0.0.1:${protectedAnchors[0].port}; }`,
    listeners: processes.filter(item => item.status === 'online').map(item => ({address: '127.0.0.1', port: item.port, pid: item.pid})),
    established: [], identityProofs: processes.filter(item => item.status === 'online').map(item => ({
      name: item.name, pid: item.pid, uid: 0, parentPid: 90, startTicks: '12345', executable: '/usr/bin/node',
      cwd: item.cwd, commandSha256: 'a'.repeat(64), environmentSha256: 'b'.repeat(64),
    })).sort((a, b) => a.name.localeCompare(b.name)),
    daemon: {fact: {pid: 90, startTicks: '222'}, killSignal: 'SIGINT', killTimeout: 1600},
    resolvedInterpreter: '/usr/bin/node', victimChildren: '',
    victimRuntimeFlags: {backgroundPaused: '1', automationEnabled: '0', invitationEnabled: '0', manualSignalHandle: ''},
  };
}
function fixture() {
  const raws = [raw(sha('c'), 3103, 3), raw(sha('a'), 3110, 10), raw(sha('b'), 3109, 9),
    raw(sha('e'), 3104, 4), raw(sha('f'), 3105, 5)];
  for (const [index, label] of ROLLING_BASE_NAMES.entries()) {
    const value = raw(sha('9'), 3000 + index, 20 + index); value.name = label;
    value.pm2_env.name = label; value.pm2_env.pm_cwd = '/base/' + label; raws.push(value);
  }
  const processes = raws.map(normalizeRetirementProcess), victimProcess = processes[0];
  const victim = {target: sha('c'), name: victimProcess.name, cwd: victimProcess.cwd,
    pmId: victimProcess.pmId, pid: victimProcess.pid, port: victimProcess.port};
  const before = {victim, active: location(sha('a'), 3110), rollback: location(sha('b'), 3109), toolRevision: sha('d'),
    sourceState: {...location(sha('c'), 3103), status: 'active', buildId: sha('c'), sourceHead: sha('c')},
    sourceClean: true, maintenanceEnded: true, priorCertificates: [], protectedNames: processes.slice(1).map(item => item.name),
    processes, listeners: processes.map(item => ({address: '127.0.0.1', port: item.port, pid: item.pid})),
    established: [], nginxConfig: 'server { proxy_pass http://127.0.0.1:3110; }'};
  const after = stopped(before), recovery = {process: raws[0], runtime: {}, dumpBefore: 'private-original'};
  const files = new Map([['before.json', text(before)], ['after.json', text(after)], ['recovery-pm2.json', text(recovery)]]);
  const prepared = {version: 1, status: 'prepared', toolRevision: sha('d'), victim,
    beforeSha256: digest(files.get('before.json')), recoverySha256: digest(files.get('recovery-pm2.json')),
    preparedAt: '2026-09-27T19:20:00.000Z'};
  files.set('prepared.json', text(prepared));
  const certificate = {version: 1, status: 'completed', victim, stoppedProcess: after.processes[0],
    activeTarget: sha('a'), rollbackTarget: sha('b'), nextTarget: sha('d'), allowedActiveTargets: [sha('a'), sha('b'), sha('d')],
    beforeSha256: digest(files.get('before.json')), afterSha256: digest(files.get('after.json')), completedAt: '2026-09-27T19:20:00.000Z'};
  files.set('certificate.json', text(certificate));
  const history = {version: 1, legacyCertificates: [certificate], legacyProcesses: clone(after.processes),
    legacySha256: rollingHash(Object.fromEntries([...files].map(([key, value]) => [key, digest(value)]))), entries: [], headSha256: null};
  const first = plan(history, [...after.processes, normalizeRetirementProcess(raw(sha('d'), 3103, 11))],
    sha('e'), sha('1'), [sha('d'), sha('a'), sha('b')]);
  return {first, legacyFiles: files, rawVictim: raws[3]};
}
function completed(before) {
  const after = stopped(before);
  return {version: 1, policy: 'rolling-v1', status: 'completed', sequence: before.history.entries.length + 1,
    previousSha256: before.history.headSha256, legacySha256: before.history.legacySha256,
    victim: before.victim, stoppedProcess: after.processes.find(item => item.name === before.victim.name),
    nextTarget: before.toolRevision, protectedAnchors: before.protectedAnchors,
    allowedActiveTargets: [before.toolRevision, ...before.protectedAnchors.map(item => item.target)],
    beforeSha256: digest(text(before)), afterSha256: digest(text(after)), preparedSha256: 'c'.repeat(64),
    recoverySha256: 'd'.repeat(64), completedAt: '2026-09-27T19:22:00.000Z'};
}
function extended(before) {
  const cert = completed(before), history = clone(before.history);
  history.entries.push(cert); history.headSha256 = rollingHash(cert); return history;
}

test('first and second rolling retirements keep current plus two exact rollback builds', () => {
  const {first} = fixture(); assertOnlineRollingPlan(first);
  assertOnlineRollingCompletion(first, stopped(first));
  const history = extended(first); assertOnlineRollingHistory(history);
  const second = plan(history, [...stopped(first).processes, normalizeRetirementProcess(raw(sha('1'), 3104, 12))],
    sha('f'), sha('2'), [sha('1'), sha('d'), sha('a')]);
  assertOnlineRollingPlan(second); assertOnlineRollingCompletion(second, stopped(second));
  assertOnlineRollingHistory(extended(second));
});
for (const [label, change] of [
  ['active retired', value => { value.victim = {...value.victim, target: sha('d'), name: name(sha('d')), cwd: cwd(sha('d')), port: 3103, pmId: 11, pid: 1011}; }],
  ['second rollback retired', value => { value.victim = {...value.victim, target: sha('b'), name: name(sha('b')), cwd: cwd(sha('b')), port: 3109, pmId: 9, pid: 1009}; }],
  ['missing rollback', value => value.protectedAnchors.pop()],
  ['maintenance', value => { value.maintenanceEnded = false; }],
  ['already staged', value => { value.targetNotStaged = false; }],
  ['ancestry', value => { value.ancestry[0].verified = false; }],
  ['source dirty', value => { value.sourceClean = false; }],
  ['wrong source SHA', value => { value.sourceState.sourceHead = sha('f'); }],
  ['proxy comment', value => { value.nginxConfig += '\n# old port 3104'; }],
  ['proxy name', value => { value.nginxConfig += value.victim.name; }],
  ['proxy cwd', value => { value.nginxConfig += value.victim.cwd; }],
  ['connection incoming', value => value.established.push({localPort: 3104, peerPort: 40000, pids: []})],
  ['connection outgoing', value => value.established.push({localPort: 40000, peerPort: 5432, pids: [1004]})],
  ['connection peer', value => value.established.push({localPort: 40000, peerPort: 3104, pids: []})],
  ['listener drift', value => { value.listeners.find(item => item.port === 3104).pid = 9900; }],
  ['extra victim socket', value => value.listeners.push({address: '127.0.0.1', port: 4444, pid: 1004})],
  ['OS children', value => { value.victimChildren = '9876'; }],
  ['missing unrelated OS proof', value => { value.identityProofs.pop(); }],
  ['OS flags', value => { value.victimRuntimeFlags.automationEnabled = '1'; }],
  ['OS parent', value => { value.identityProofs.find(item => item.name === value.victim.name).parentPid = 99; }],
  ['daemon signal', value => { value.daemon.killSignal = 'SIGKILL'; }],
  ['legacy process identity', value => { value.processes.find(item => item.name === ROLLING_BASE_NAMES[0]).pid++; }],
  ['unknown stopped process', value => { const item = value.processes.find(item => item.name === name(sha('f'))); item.pid = 0; item.status = 'stopped'; }],
]) test('plan rejects ' + label, () => {
  const {first} = fixture(); change(first); assert.throws(() => assertOnlineRollingPlan(first), /online_rolling_/);
});
for (const [key, values] of Object.entries({
  backgroundPaused: ['0', null], automationEnabled: ['1', null], invitationEnabled: ['1', null],
  watch: [true, [], 'false'], cronRestart: ['* * * * *', true, 0], manualSignalHandle: ['false', '0', true],
  shutdownWithMessage: [true], args: [['start']], nodeArgs: [['--require', '/tmp/a']], execMode: ['cluster_mode'],
})) for (const value of values) test('unsafe victim ' + key + ':' + JSON.stringify(value), () => {
  const {first} = fixture(); first.processes.find(item => item.name === first.victim.name)[key] = value;
  assert.throws(() => assertOnlineRollingPlan(first), /online_rolling_/);
});
test('each protected anchor full identity survives current state re-observation', () => {
  for (const index of [0, 1, 2]) for (const key of ['pid', 'pmId', 'environmentSha256', 'args', 'cwd', 'status']) {
    const {first} = fixture(); const item = first.processes.find(item => item.name === first.protectedAnchors[index].name);
    item[key] = typeof item[key] === 'number' ? item[key] + 100 : 'changed';
    assert.throws(() => assertOnlineRollingPlan(first), /online_rolling_/);
  }
});
test('next attempt cannot reaccredit drifted prior rollback identities', () => {
  const {first} = fixture(), history = extended(first);
  const second = plan(history, [...stopped(first).processes, normalizeRetirementProcess(raw(sha('1'), 3104, 12))],
    sha('f'), sha('2'), [sha('1'), sha('d'), sha('a')]);
  second.processes.find(item => item.name === name(sha('d'))).environmentSha256 = 'e'.repeat(64);
  second.protectedAnchors[1].process.environmentSha256 = 'e'.repeat(64);
  assert.throws(() => assertOnlineRollingPlan(second), /rollback_identity_drift/);
});
test('completion rejects skipped stop, deletion, restart, daemon/source/OS or unrelated listener changes', () => {
  const {first} = fixture(); assert.throws(() => assertOnlineRollingCompletion(first, first), /process_identity_changed/);
  for (const change of [
    value => value.processes.pop(),
    value => { value.processes.find(item => item.name === first.victim.name).pid = 999; },
    value => { value.processes.find(item => item.name === ROLLING_BASE_NAMES[0]).args = ['other']; },
    value => { value.daemon.fact.startTicks = '999'; },
    value => { value.identityProofs[0].startTicks = '999'; },
    value => { value.sourceState.status = 'changed'; },
    value => value.listeners.pop(),
  ]) { const after = stopped(first); change(after); assert.throws(() => assertOnlineRollingCompletion(first, after), /online_rolling_/); }
});
test('history rejects duplicates, replays, forks, changed legacy and skipped publication', () => {
  const {first} = fixture();
  for (const change of [
    value => { value.entries[0].previousSha256 = 'f'.repeat(64); },
    value => { value.entries[0].sequence = 2; },
    value => { value.legacySha256 = 'f'.repeat(64); },
    value => { value.headSha256 = 'f'.repeat(64); },
    value => { value.entries.push(clone(value.entries[0])); },
    value => { value.entries[0].allowedActiveTargets.push(sha('f')); },
  ]) { const history = extended(first); change(history); assert.throws(() => assertOnlineRollingHistory(history), /online_rolling_/); }
  const second = plan(extended(first), stopped(first).processes, sha('f'), sha('2'), [sha('d'), sha('a'), sha('b')]);
  assert.throws(() => assertOnlineRollingPlan(second), /previous_release_not_published/);
});
test('retention validates all stopped registrations and full new or minimal historical saved snapshots', () => {
  const {first} = fixture(), history = extended(first), current = stopped(first).processes;
  for (const saved of [first.processes.filter(item => item.status === 'online'),
    first.processes.filter(item => item.status === 'online').map(({name, pid, cwd}) => ({name, pid, cwd}))]) {
    assertRollingRetainedProcesses({saved, current, history, activeTarget: first.toolRevision});
  }
  for (const change of [
    value => { value.find(item => item.name === first.victim.name).environmentSha256 = 'f'.repeat(64); },
    value => { value.find(item => item.name === name(sha('c'))).args = []; },
    value => { value.find(item => item.name === first.protectedAnchors[2].name).pid++; },
    value => { value.find(item => item.name === ROLLING_BASE_NAMES[0]).pid++; },
    value => { value.pop(); },
  ]) { const changed = clone(current); change(changed);
    assert.throws(() => assertRollingRetainedProcesses({saved: first.processes.filter(item => item.status === 'online'), current: changed,
      history, activeTarget: first.toolRevision}), /online_rolling_/); }
  assert.throws(() => assertRollingRetainedProcesses({saved: first.processes, current, history, activeTarget: sha('f')}), /retained_context_invalid/);
});
test('historical rollback uses birth proof and only adjacent protected target links', () => {
  const {first} = fixture(), history = extended(first), recordedHead = history.headSha256;
  for (const [activeTarget, destinationTarget, pin] of [
    [sha('1'), sha('d'), recordedHead], [sha('d'), sha('a'), undefined], [sha('a'), sha('b'), undefined],
  ]) assertRollingStateHistory({history, activeTarget, destinationTarget, recordedHead: pin});
  for (const [activeTarget, destinationTarget, pin] of [
    [sha('b'), sha('f'), undefined], [sha('1'), sha('a'), recordedHead], [sha('a'), sha('d'), undefined],
    [sha('1'), sha('d'), undefined], [sha('d'), sha('a'), recordedHead],
  ]) assert.throws(() => assertRollingStateHistory({history, activeTarget, destinationTarget, recordedHead: pin}), /online_rolling_/);
});
test('new history never reuses older certificate allowlist as a generalized bypass', () => {
  const {first} = fixture(), second = plan(extended(first),
    [...stopped(first).processes, normalizeRetirementProcess(raw(sha('1'), 3104, 12))],
    sha('f'), sha('2'), [sha('1'), sha('d'), sha('a')]);
  const history = extended(second), current = stopped(second).processes;
  assert.throws(() => assertRollingRetainedProcesses({saved: current.filter(item => item.status === 'online'),
    current, history, activeTarget: sha('b')}), /retained_context_invalid/);
  assertRollingStateHistory({history, activeTarget: sha('1'), destinationTarget: sha('d'), recordedHead: rollingHash(history.entries[0])});
});
test('certificate stopped identity and all three anchor references remain strict', () => {
  const {first} = fixture(); assertOnlineRollingCertificate(completed(first));
  for (const change of [value => { value.stoppedProcess.pid = 123; },
    value => { value.protectedAnchors[2].process.status = 'stopped'; },
    value => { value.allowedActiveTargets.reverse(); }]) {
    const cert = clone(completed(first)); change(cert); assert.throws(() => assertOnlineRollingCertificate(cert), /online_rolling_/);
  }
});
test('standard Next command permits any existing rolling port, never external bind or other interpreter', () => {
  const {first} = fixture(), process = first.processes.find(item => item.name === first.victim.name);
  const fact = first.identityProofs.find(item => item.name === first.victim.name);
  assertRollingExecutable(process, fact, '/usr/bin/node');
  assert.throws(() => assertRollingExecutable(process, fact, '/other/node'), /victim_executable_changed/);
  assert.throws(() => assertRollingExecutable({...process, args: ['start', '-H', '0.0.0.0', '-p', '3104']}, fact, '/usr/bin/node'), /victim_executable_changed/);
});
