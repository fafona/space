import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {normalizeRetirementProcess} from './online-release-retirement.mjs';
import {ROLLING_BASE_NAMES} from './online-release-rolling-policy.mjs';
import {WEB_RELEASE_FILES} from './web-presentation-release-policy.mjs';
import {ONLINE_RETENTION_POLICY as policy, createOnlineRetentionHistory, retentionHash, retentionCanonicalText,
  assertOnlineRetentionHistory, assertOnlineRetentionCertificate, assertOnlineRetentionPlan,
  assertOnlineRetentionCompletion, inspectOnlineRetentionWindow, assertOnlineRetentionRollback} from './online-release-retention-policy.mjs';
import {assertOnlineRetentionHead, onlineRetentionHeadRecord, assertOnlineRetentionHeadRecord,
  assertOnlineRetentionRollbackProof, snapshotOnlineRetentionPublication, assertOnlineRetentionPublication} from './online-release-retention-policy.mjs';

const clone = value => structuredClone(value), sha = value => value.repeat(40), hash = value => value.repeat(64);
const digest = value => createHash('sha256').update(value).digest('hex');
const name = target => `merchant-space-online-${target.slice(0, 12)}`;
const cwd = target => `/www/wwwroot/merchant-space.web-releases/${target.slice(0, 12)}-online`;
const now = '2026-09-29T01:00:00.000Z';
function raw(target, port, id) {
  return {name: name(target), pm_id: id, pid: 1000 + id, pm2_env: {status: 'online', pm_cwd: cwd(target),
    pm_exec_path: `${cwd(target)}/node_modules/next/dist/bin/next`, args: ['start', '-H', '127.0.0.1', '-p', String(port)],
    exec_interpreter: '/usr/bin/node', exec_mode: 'fork_mode', env: {PORT: String(port)}, PORT: String(port),
    FAOLLA_BACKGROUND_JOBS_PAUSED: '1', MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED: '0',
    MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED: '0', watch: false, cron_restart: null,
    shutdown_with_message: false, kill_timeout: 1600, created_at: 123, restart_time: 0}};
}
function makeAnchor(p, target) {return {target, name: p.name, directory: p.cwd, port: p.port, process: clone(p)};}
function activeFile(a) {return {target: a.target, name: a.name, directory: a.directory, port: a.port};}
function releaseState(a, rollback) {
  return {...activeFile(a), status: 'active', activatedAt: now, ...(rollback ? {baseline: rollback.target,
    oldName: rollback.name, oldDirectory: rollback.directory, oldPort: rollback.port} : {})};
}
function observation(history, kind, current, active, rollback, target = null) {
  const victimProcess = target ? current.find(p => p.name === name(target)) : null;
  const victim = target ? {target, process: clone(victimProcess)} : null;
  const releaseAnchors = [active, rollback, ...(target ? [makeAnchor(victimProcess, target)] : [])];
  const currentState = {...releaseState(active, rollback), ...(kind === 'converge' ? {retentionHeadSha256: history.headSha256} : {})};
  return {version: 2, policy, kind, toolRevision: sha('f'), sequence: history.entries.length + 1, previousSha256: history.headSha256,
    legacySha256: history.rollingHistory.legacySha256, rollingHeadSha256: history.rollingHistory.headSha256,
    rollingHistorySha256: retentionHash(history.rollingHistory), active: clone(active), rollback: clone(rollback), victim,
    activeFile: activeFile(active), activeState: currentState, processes: clone(current),
    sourceClean: true, maintenanceEnded: true, maintenanceSha256: hash('1'), markerSha256: hash('2'), baseDirectory: '/base/owned',
    proxyHashes: Object.fromEntries(WEB_RELEASE_FILES.map(file => [file, hash('3')])),
    nginxConfig: `server { proxy_pass http://127.0.0.1:${active.port}; }`,
    releaseProofs: releaseAnchors.map(a => {
      const state = a.target === active.target ? currentState : releaseState(a), stateText = JSON.stringify(state);
      return {target: a.target, sourceHead: a.target, sourceClean: true, resolvedInterpreter: '/usr/bin/node', http: {status: 200, ok: true, buildId: a.target},
        state, stateText, stateSha256: digest(stateText), buildSha256: hash('4'), runtimeSha256: hash('5'), environmentSha256: hash('6')};
    }),
    identityProofs: current.filter(p => p.status === 'online').map(p => ({name: p.name, pid: p.pid, uid: 0, parentPid: 99,
      cwd: p.cwd, executable: '/usr/bin/node', startTicks: '100', commandSha256: hash('7'), environmentSha256: hash('8')})),
    listeners: current.filter(p => p.status === 'online').map(p => ({address: '127.0.0.1', port: p.port, pid: p.pid})), established: [],
    ancestry: [...(target ? [{older: target, newer: active.target, verified: true}] : []),
      {older: rollback.target, newer: active.target, verified: true}],
    daemon: {fact: {pid: 99, startTicks: '10'}, killSignal: 'SIGINT', killTimeout: 1600},
    victimChildren: '', resolvedInterpreter: '/usr/bin/node',
    victimRuntimeFlags: {backgroundPaused: '1', automationEnabled: '0', invitationEnabled: '0', manualSignalHandle: ''}};
}
function after(before) {
  const result = clone(before);
  if (before.victim) {
    const p = before.victim.process;
    result.processes = result.processes.map(row => row.name === p.name ? {...row, status: 'stopped', pid: 0} : row);
    result.listeners = result.listeners.filter(s => s.pid !== p.pid);
    result.identityProofs = result.identityProofs.filter(f => f.name !== p.name);
  }
  return result;
}
function certificate(before) {
  const result = after(before);
  return {version: 2, policy, status: 'completed', ...Object.fromEntries(['kind', 'toolRevision', 'sequence', 'previousSha256',
    'legacySha256', 'rollingHeadSha256', 'rollingHistorySha256', 'active', 'rollback', 'victim'].map(k => [k, clone(before[k])])),
    ...(before.rollbackProof !== undefined ? {rollbackProof: clone(before.rollbackProof)} : {}),
    stoppedProcess: before.victim ? result.processes.find(p => p.name === before.victim.process.name) : null,
    processes: result.processes, beforeSha256: digest(retentionCanonicalText(before)), afterSha256: digest(retentionCanonicalText(result)),
    preparedSha256: hash('b'), recoverySha256: hash('c'), completedAt: now};
}
function extend(history, before) {
  assertOnlineRetentionCompletion(before, after(before), history);
  const next = clone(history), cert = certificate(before); next.entries.push(cert); next.headSha256 = retentionHash(cert);
  assertOnlineRetentionHistory(next); return next;
}
function fixture() {
  const records = [raw(sha('a'), 3110, 1), raw(sha('b'), 3109, 2), raw(sha('c'), 3103, 3), raw(sha('e'), 3104, 4)];
  for (const [index, label] of ROLLING_BASE_NAMES.entries()) {
    const row = raw(sha('9'), 3000 + index, 20 + index); row.name = label; row.pm2_env.pm_cwd = '/base/' + label; records.push(row);
  }
  const current = records.map(normalizeRetirementProcess), original = clone(current[2]); current[2] = {...original, pid: 0, status: 'stopped'};
  const legacy = {version: 1, status: 'completed', victim: {target: sha('c'), name: original.name, cwd: original.cwd,
    pmId: original.pmId, pid: original.pid, port: original.port}, stoppedProcess: clone(current[2]),
    activeTarget: sha('a'), rollbackTarget: sha('b'), nextTarget: sha('d'), allowedActiveTargets: ['a', 'b', 'd'].map(sha),
    beforeSha256: hash('a'), afterSha256: hash('b'), completedAt: now};
  const history = createOnlineRetentionHistory({version: 1, legacyCertificates: [legacy], legacyProcesses: clone(current),
    legacySha256: hash('9'), entries: [], headSha256: null});
  const active = makeAnchor(current[0], sha('a')), rollback = makeAnchor(current[1], sha('b'));
  const first = observation(history, 'initialize', current, active, rollback);
  return {history, first, current, active, rollback};
}
function initialized() {const f = fixture(); return {...f, history: extend(f.history, f.first)};}

test('initialization adopts the exact adjacent old window without stopping anything', () => {
  const f = fixture(), before = clone(f); assertOnlineRetentionPlan(f.first, f.history);
  const h = extend(f.history, f.first); assert.equal(h.entries.length, 1); assert.deepEqual(f, before);
  const window = inspectOnlineRetentionWindow({history: h, actualActive: activeFile(f.active), current: f.current});
  assert.equal(window.phase, 'stable'); assert.equal(window.converged, false);
  assert.deepEqual(window.extraOnlineWebProcesses, [name(sha('e'))]); assert.equal(window.mayRetire, true);
});
test('forward publication precedes convergence, then one exact old process may retire', () => {
  const f = initialized(), next = normalizeRetirementProcess(raw(sha('f'), 3105, 5));
  const current = [...f.current, next], active = makeAnchor(next, sha('f'));
  const move = observation(f.history, 'converge', current, active, f.active), h = extend(f.history, move);
  const retire = observation(h, 'retire', current, active, f.active, sha('b')), complete = extend(h, retire);
  assert.equal(complete.entries.length, 3);
  assert.deepEqual(after(retire).processes.find(p => p.name === name(sha('b'))), {...f.rollback.process, pid: 0, status: 'stopped'});
  const another = observation(complete, 'retire', after(retire).processes, active, f.active, sha('e'));
  const compact = extend(complete, another);
  assert.equal(inspectOnlineRetentionWindow({history: compact, actualActive: activeFile(active), current: after(another).processes}).converged, true);
});
test('actual rollback keeps a non-converged window and cannot reverse to the failed release', () => {
  const f = initialized();
  assertOnlineRetentionRollback({history: f.history, actualActive: activeFile(f.active), destinationTarget: f.rollback.target, current: f.current});
  const input = {history: f.history, actualActive: activeFile(f.rollback), current: f.current};
  assert.deepEqual({...inspectOnlineRetentionWindow(input), active: undefined, extraOnlineWebProcesses: undefined},
    {phase: 'rolled-back', converged: false, mayStage: false, mayRetire: false, mayRollback: false, stableRollback: null,
      active: undefined, extraOnlineWebProcesses: undefined});
  assert.throws(() => assertOnlineRetentionRollback({...input, destinationTarget: f.active.target}), /rollback_edge_invalid/);
  const next = normalizeRetirementProcess(raw(sha('f'), 3105, 5));
  assert.throws(() => assertOnlineRetentionPlan(observation(f.history, 'converge', [...f.current, next], makeAnchor(next, sha('f')), f.rollback), f.history), /publication_transition_invalid/);
  const retire = observation(f.history, 'retire', f.current, f.active, f.rollback, sha('e'));
  retire.activeFile = activeFile(f.rollback);
  assert.throws(() => assertOnlineRetentionPlan(retire, f.history), /active_file_changed/);
});
test('a newly published process must still run the exact owned Next executable and arguments', () => {
  const f = initialized();
  for (const change of [p => {p.executable = '/other/script';}, p => {p.args.push('--other');},
    p => {p.nodeArgs = ['--inspect'];}, p => {p.execMode = 'cluster_mode';}, p => {p.interpreter = 'node';}]) {
    const next = normalizeRetirementProcess(raw(sha('f'), 3105, 5)); change(next);
    const before = observation(f.history, 'converge', [...f.current, next], makeAnchor(next, sha('f')), f.active);
    assert.throws(() => assertOnlineRetentionPlan(before, f.history), /victim_executable_changed/);
  }
});
test('convergence requires the head actually recorded by the newly published release', () => {
  const f = initialized(), next = normalizeRetirementProcess(raw(sha('f'), 3105, 5));
  for (const pin of [undefined, hash('0'), f.history.headSha256 + '\n']) {
    const before = observation(f.history, 'converge', [...f.current, next], makeAnchor(next, sha('f')), f.active);
    if (pin === undefined) delete before.activeState.retentionHeadSha256; else before.activeState.retentionHeadSha256 = pin;
    const proof = before.releaseProofs.find(item => item.target === sha('f'));
    proof.state = clone(before.activeState); proof.stateText = JSON.stringify(proof.state); proof.stateSha256 = digest(proof.stateText);
    assert.throws(() => assertOnlineRetentionPlan(before, f.history), /publication_birth_head_changed/);
  }
});

for (const [label, mutate] of [
  ['unknown kind', p => {p.kind = 'drop';}], ['maintenance active', p => {p.maintenanceEnded = false;}],
  ['dirty source', p => {p.sourceClean = false;}], ['missing proxy hash', p => {delete p.proxyHashes[WEB_RELEASE_FILES[0]];}],
  ['publication unfinished', p => {p.activeState.status = 'activating';}], ['publication time absent', p => {delete p.activeState.activatedAt;}],
  ['false baseline', p => {p.activeState.baseline = sha('8');}], ['HTTP wrong build', p => {p.releaseProofs[0].http.buildId = sha('8');}],
  ['HTTP rejected', p => {p.releaseProofs[0].http.status = 500;}], ['source wrong build', p => {p.releaseProofs[0].sourceHead = sha('8');}],
  ['missing release proof', p => {p.releaseProofs.pop();}], ['state bytes differ', p => {p.releaseProofs[0].stateText += ' ';}],
  ['duplicate OS proof', p => {p.identityProofs[0] = clone(p.identityProofs[1]);}], ['PID identity wrong', p => {p.identityProofs[0].pid++;}],
  ['unowned OS process', p => {p.identityProofs[0].uid = 123;}], ['wrong release listener', p => {p.listeners[0].address = '0.0.0.0';}],
  ['ancestry unverified', p => {p.ancestry[0].verified = false;}], ['changed old root', p => {p.legacySha256 = hash('1');}],
  ['changed rolling root', p => {p.rollingHeadSha256 = hash('2');}], ['missing complete process fields', p => {delete p.processes[0].environmentSha256;}],
  ['trailing target newline', p => {p.toolRevision += '\n';}],
]) test('plan rejects ' + label, () => {
  const f = fixture(); mutate(f.first); assert.throws(() => assertOnlineRetentionPlan(f.first, f.history));
});
for (const [label, mutate] of [
  ['outgoing traffic', p => {p.established.push({localPort: 50000, peerPort: 5432, pids: [p.victim.process.pid]});}],
  ['incoming traffic', p => {p.established.push({localPort: p.victim.process.port, peerPort: 50000, pids: []});}],
  ['proxy comment reference', p => {p.nginxConfig += '# ' + p.victim.process.port;}],
  ['child process', p => {p.victimChildren = '123';}], ['wrong daemon', p => {p.daemon.fact.pid++;}],
  ['manual signal suppression', p => {p.victimRuntimeFlags.manualSignalHandle = '0';}],
  ['wrong interpreter', p => {p.resolvedInterpreter = '/other/node';}],
  ['non-loopback victim', p => {p.listeners.find(s => s.pid === p.victim.process.pid).address = '::';}],
  ['signal changed', p => {p.daemon.killSignal = 'SIGKILL';}],
  ['active victim', p => {p.victim = {target: p.active.target, process: clone(p.active.process)};}],
  ['stable rollback victim', p => {p.victim = {target: p.rollback.target, process: clone(p.rollback.process)};}],
]) test('retirement rejects ' + label, () => {
  const f = initialized(), before = observation(f.history, 'retire', f.current, f.active, f.rollback, sha('e'));
  mutate(before); assert.throws(() => assertOnlineRetentionPlan(before, f.history));
});
test('only pid/status and victim OS/listener removal may change in completion', () => {
  const f = initialized(), before = observation(f.history, 'retire', f.current, f.active, f.rollback, sha('e'));
  assertOnlineRetentionCompletion(before, after(before), f.history);
  for (const mutate of [a => {a.processes.pop();}, a => {a.processes[0].pid++;}, a => {a.nginxConfig += '# changed';},
    a => {a.processes.find(p => p.name === name(sha('e'))).restartCount++;},
    a => {a.identityProofs.pop();}, a => {a.listeners.push({address: '127.0.0.1', port: 3104, pid: 1004});}]) {
    const changed = after(before); mutate(changed); assert.throws(() => assertOnlineRetentionCompletion(before, changed, f.history), /completion_changed/);
  }
});
test('full history rejects replay, missing head, duplicate initialization and drift', () => {
  const f = initialized();
  for (const mutate of [h => {h.headSha256 = null;}, h => {h.entries[0].sequence++;}, h => {h.entries[0].previousSha256 = hash('1');},
    h => {h.rollingHistory.legacySha256 = hash('2');}, h => {h.entries[0].policy = 'rolling-v1';},
    h => {h.entries[0].version = 1;}, h => {h.entries[0].active.process.pid++;}, h => {h.entries[0].beforeSha256 += '\n';},
    h => {h.entries[0].completedAt = '2026-02-30T00:00:00.000Z';}]) {
    const changed = clone(f.history); mutate(changed); assert.throws(() => assertOnlineRetentionHistory(changed));
  }
  assert.throws(() => assertOnlineRetentionPlan(observation(f.history, 'initialize', f.current, f.active, f.rollback), f.history), /duplicate_initialization/);
  const stop = observation(f.history, 'retire', f.current, f.active, f.rollback, sha('e')), h = extend(f.history, stop);
  const replay = certificate(stop); replay.sequence++; replay.previousSha256 = h.headSha256;
  h.entries.push(replay); h.headSha256 = retentionHash(replay);
  assert.throws(() => assertOnlineRetentionHistory(h), /duplicate_retirement/);
});
test('an independently recorded head rejects a complete-tail rollback and absent pins', () => {
  const f = initialized(), before = observation(f.history, 'retire', f.current, f.active, f.rollback, sha('e'));
  const h = extend(f.history, before);
  assertOnlineRetentionHead(h, h.headSha256);
  assert.throws(() => assertOnlineRetentionHead(f.history, h.headSha256), /recorded_head_changed/);
  for (const pin of [undefined, null, '', h.headSha256 + '\n']) assert.throws(() => assertOnlineRetentionHead(h, pin), /recorded_head_changed/);
});
test('new process additions, deletions, restart and uncertified stops are never silently adopted', () => {
  const f = initialized();
  for (const mutate of [p => {p.processes.push(normalizeRetirementProcess(raw(sha('8'), 3107, 8)));},
    p => {p.processes.pop();}, p => {p.processes[0].pid++;}, p => {p.processes[3].pid = 0; p.processes[3].status = 'stopped';}]) {
    const before = observation(f.history, 'retire', f.current, f.active, f.rollback, sha('e')); mutate(before);
    assert.throws(() => assertOnlineRetentionPlan(before, f.history));
  }
  const c = certificate(f.first); assertOnlineRetentionCertificate(c);
  c.processes.push(clone(c.processes[0])); assert.throws(() => assertOnlineRetentionCertificate(c), /processes_invalid/);
});
test('stopped registrations remain mandatory in actual runtime inspection', () => {
  const f = initialized(), before = observation(f.history, 'retire', f.current, f.active, f.rollback, sha('e'));
  const history = extend(f.history, before), current = after(before).processes;
  for (const mutate of [rows => {rows.splice(3, 1);}, rows => {rows[3].status = 'online'; rows[3].pid = 1004;},
    rows => {rows[3].cwd = '/other';}, rows => {rows[3].pmId++;}, rows => {rows[0].environmentSha256 = hash('1');}]) {
    const changed = clone(current); mutate(changed);
    assert.throws(() => inspectOnlineRetentionWindow({history, actualActive: activeFile(f.active), current: changed}));
  }
  for (const target of [sha('8'), f.active.target]) assert.throws(() => assertOnlineRetentionRollback({history,
    actualActive: activeFile(f.active), current, destinationTarget: target}), /rollback_edge_invalid/);
});
test('a certificate cannot erase a changed victim birth PID by recording stopped pid zero', () => {
  const f = initialized(), before = observation(f.history, 'retire', f.current, f.active, f.rollback, sha('e'));
  const c = certificate(before); c.victim.process.pid++;
  const h = clone(f.history); h.entries.push(c); h.headSha256 = retentionHash(c);
  assert.throws(() => assertOnlineRetentionHistory(h), /victim_birth_identity_changed/);
});
test('v2 remains a pure inactive contract with no operational writes or remote clients', () => {
  const source = readFileSync(new URL('./online-release-retention-policy.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /from ['"]node:(?:fs|child_process)|\b(?:fetch|spawnSync|writeFileSync|mkdirSync|unlinkSync)\s*\(/);
  const f = fixture(), frozen = clone(f.history); createOnlineRetentionHistory(f.history.rollingHistory);
  assert.deepEqual(f.history, frozen);
});

function recoveredProof(history, original) {
  const latest = history.entries.at(-1);
  const proxyFiles = Object.fromEntries(WEB_RELEASE_FILES.map(file => [file,
    {beforeText: `owned before ${file} ${latest.rollback.port}`, afterText: `owned after ${file} ${latest.active.port}`} ]));
  const failedState = {...clone(original ?? releaseState(latest.active, latest.rollback)), status: 'rolled-back',
    rolledBackAt: now, retentionRollbackHeadSha256: history.headSha256,
    configs: Object.fromEntries(WEB_RELEASE_FILES.map(file => [file,
      {oldHash: digest(proxyFiles[file].beforeText), newHash: digest(proxyFiles[file].afterText)}]))};
  const failedStateText = JSON.stringify(failedState);
  return {version: 1, historyHeadSha256: history.headSha256, from: activeFile(latest.active), to: activeFile(latest.rollback),
    activeFile: activeFile(latest.rollback), failedStateText, failedStateSha256: digest(failedStateText), proxyFiles,
    proxyHashes: Object.fromEntries(WEB_RELEASE_FILES.map(file => [file, failedState.configs[file].oldHash]))};
}
function publicationFixture() {
  const f = initialized(), p = normalizeRetirementProcess(raw(sha('f'), 3105, 5));
  const snapshot = snapshotOnlineRetentionPublication({history: f.history, actualActive: activeFile(f.active),
    current: f.current, releaseTarget: sha('f')});
  const active = makeAnchor(p, sha('f')), publication = {...releaseState(active, f.active), ...snapshot};
  const current = [...f.current, p], before = observation(f.history, 'converge', current, active, f.active);
  return {...f, p, newActive: active, publication, publishedCurrent: current, before, publishedHistory: extend(f.history, before)};
}
function installState(before) {
  const proof = before.releaseProofs.find(p => p.target === before.active.target);
  proof.state = clone(before.activeState); proof.stateText = JSON.stringify(proof.state); proof.stateSha256 = digest(proof.stateText);
}
test('snapshot, private candidate, public success and housekeeping failure retain exact ownership without rolling back service', () => {
  const f = publicationFixture();
  const input = {history: f.history, state: {...f.publication, status: 'preparing'}, actualActive: activeFile(f.active), current: f.current};
  assert.equal(assertOnlineRetentionPublication(input).phase, 'staged');
  assert.equal(assertOnlineRetentionPublication({...input, current: f.publishedCurrent}).candidatePresent, true);
  assert.equal(assertOnlineRetentionPublication({...input, state: f.publication, actualActive: activeFile(f.newActive),
    current: f.publishedCurrent}).phase, 'published-unconverged');
  assert.equal(assertOnlineRetentionPublication({...input, history: f.publishedHistory, state: f.publication,
    actualActive: activeFile(f.newActive), current: f.publishedCurrent}).phase, 'published');
  const retire = observation(f.publishedHistory, 'retire', f.publishedCurrent, f.newActive, f.active, sha('b'));
  const completed = extend(f.publishedHistory, retire);
  assert.equal(assertOnlineRetentionPublication({...input, history: completed, state: f.publication,
    actualActive: activeFile(f.newActive), current: after(retire).processes, action: 'rollback'}).phase, 'published');
});
test('failed activation may verify only its exact private candidate; a new stage cannot silently adopt it', () => {
  const f = publicationFixture(), failed = {...f.publication, status: 'rolled-back', rolledBackAt: now};
  assert.equal(assertOnlineRetentionPublication({history: f.history, state: failed, actualActive: activeFile(f.active),
    current: f.publishedCurrent}).phase, 'rolled-back');
  assert.throws(() => snapshotOnlineRetentionPublication({history: f.history, actualActive: activeFile(f.active),
    current: f.publishedCurrent, releaseTarget: sha('8')}), /unexpected_process_added/);
});
test('verified rollback then publication preserves the restored version, and the failed version can retire', () => {
  const f = publicationFixture(), proof = recoveredProof(f.publishedHistory, f.publication);
  assertOnlineRetentionRollbackProof({history: f.publishedHistory, proof, actualActive: activeFile(f.active)});
  const snapshot = snapshotOnlineRetentionPublication({history: f.publishedHistory, actualActive: activeFile(f.active),
    current: f.publishedCurrent, releaseTarget: sha('8'), rollbackProof: proof});
  const p = normalizeRetirementProcess(raw(sha('8'), 3106, 8)), active = makeAnchor(p, sha('8')), current = [...f.publishedCurrent, p];
  const next = observation(f.publishedHistory, 'converge', current, active, f.active);
  next.rollbackProof = proof; next.activeState = {...next.activeState, ...snapshot}; installState(next);
  const history = extend(f.publishedHistory, next);
  assert.equal(history.entries.at(-1).rollback.target, f.active.target);
  assert.notEqual(history.entries.at(-1).rollback.target, f.newActive.target);
  assert.equal(assertOnlineRetentionPublication({history, state: next.activeState, actualActive: activeFile(active), current}).phase, 'published');
  const retire = observation(history, 'retire', current, active, f.active, f.newActive.target);
  const retiredProof = retire.releaseProofs.find(p => p.target === f.newActive.target);
  retiredProof.stateText = proof.failedStateText; retiredProof.state = JSON.parse(proof.failedStateText);
  retiredProof.stateSha256 = proof.failedStateSha256;
  assertOnlineRetentionPlan(retire, history); extend(history, retire);
  retiredProof.state.rolledBackAt = '2026-09-30T01:00:00.000Z'; retiredProof.stateText = JSON.stringify(retiredProof.state);
  retiredProof.stateSha256 = digest(retiredProof.stateText);
  assert.throws(() => assertOnlineRetentionPlan(retire, history), /retired_rollback_state_changed/);
});
test('the adopted old active can roll back without inventing a v2 birth pin, but another legacy target cannot', () => {
  const f = initialized(), publication = releaseState(f.active, f.rollback);
  assert.equal(assertOnlineRetentionPublication({history: f.history, state: publication, actualActive: activeFile(f.active),
    current: f.current, action: 'rollback'}).phase, 'adopted');
  const proof = recoveredProof(f.history);
  assertOnlineRetentionRollbackProof({history: f.history, proof});
  assert.equal(snapshotOnlineRetentionPublication({history: f.history, actualActive: activeFile(f.rollback),
    current: f.current, releaseTarget: sha('f'), rollbackProof: proof}).retentionRollbackProof.failedStateSha256, proof.failedStateSha256);
  assert.throws(() => assertOnlineRetentionPublication({history: f.history, state: releaseState(f.rollback, f.active),
    actualActive: activeFile(f.rollback), current: f.current}), /publication_birth_head_changed/);
});
for (const [label, change, stateChange] of [
  ['missing proof', () => undefined], ['wrong head', p => {p.historyHeadSha256 = hash('0'); return p;}],
  ['wrong active file', p => {p.activeFile = p.from; return p;}],
  ['changed before proxy', p => {p.proxyFiles[WEB_RELEASE_FILES[0]].beforeText += 'x'; return p;}],
  ['changed after proxy', p => {p.proxyFiles[WEB_RELEASE_FILES[0]].afterText += 'x'; return p;}],
  ['wrong actual proxy hash', p => {p.proxyHashes[WEB_RELEASE_FILES[0]] = hash('0'); return p;}],
  ['missing proxy', p => {delete p.proxyFiles[WEB_RELEASE_FILES[0]]; return p;}],
  ['raw state tamper', p => {p.failedStateText += ' '; return p;}],
  ['not rolled back', null, s => {s.status = 'active';}],
  ['missing rollback time', null, s => {delete s.rolledBackAt;}],
  ['rollback predates activation', null, s => {s.rolledBackAt = '2000-01-01T00:00:00.000Z';}],
  ['wrong state rollback head', null, s => {s.retentionRollbackHeadSha256 = hash('0');}],
  ['wrong birth head', null, s => {s.retentionHeadSha256 = hash('0');}],
  ['wrong baseline', null, s => {s.baseline = sha('9');}],
  ['changed config hash', null, s => {s.configs[WEB_RELEASE_FILES[0]].oldHash = hash('0');}],
]) test('rollback proof rejects ' + label, () => {
  const f = publicationFixture(); let proof = recoveredProof(f.publishedHistory, f.publication);
  if (change) proof = change(proof);
  if (stateChange) {const s = JSON.parse(proof.failedStateText); stateChange(s); proof.failedStateText = JSON.stringify(s); proof.failedStateSha256 = digest(proof.failedStateText);}
  assert.throws(() => assertOnlineRetentionRollbackProof({history: f.publishedHistory, proof}));
});
test('publication helpers reject unrelated candidates, lost proof, arbitrary historical heads, changed base and source identity', () => {
  const f = publicationFixture(), base = {history: f.history, state: {...f.publication, status: 'preparing'}, actualActive: activeFile(f.active), current: f.publishedCurrent};
  for (const mutate of [i => {i.state.retentionHeadSha256 = hash('0');}, i => {i.state.baseline = sha('8');},
    i => {i.state.processes.pop();}, i => {i.current.push(normalizeRetirementProcess(raw(sha('8'), 3106, 8)));},
    i => {i.current.find(p => p.name === ROLLING_BASE_NAMES[0]).pid++;},
    i => {i.current.find(p => p.name === f.newActive.name).cwd = '/other';},
    i => {i.actualActive = activeFile(f.rollback);}]) {
    const changed = clone(base); mutate(changed); assert.throws(() => assertOnlineRetentionPublication(changed));
  }
  const record = onlineRetentionHeadRecord(f.publishedHistory); assertOnlineRetentionHeadRecord(f.publishedHistory, record);
  assert.throws(() => assertOnlineRetentionHeadRecord(f.history, record), /recorded_head_changed/);
});
test('completion tolerates unrelated traffic but never a victim connection or unrelated listener change', () => {
  const f = initialized(), before = observation(f.history, 'retire', f.current, f.active, f.rollback, sha('e'));
  const completed = after(before); completed.established.push({localPort: 40000, peerPort: 443, pids: [f.active.process.pid]});
  assertOnlineRetentionCompletion(before, completed, f.history);
  for (const value of [{localPort: before.victim.process.port, peerPort: 443, pids: []},
    {localPort: 40000, peerPort: 443, pids: [before.victim.process.pid]}]) {
    assert.throws(() => assertOnlineRetentionCompletion(before, {...completed, established: [value]}, f.history), /victim_connections_present/);
  }
});
