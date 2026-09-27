import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertOnlineRetirementPlan,
  assertOnlineRetirementCompletion,
  assertOnlineRetirementCertificate,
  assertRetainedOnlineProcesses,
} from './online-release-retirement-policy.mjs';

const clone = value => structuredClone(value);
const target = digit => digit.repeat(40);
const location = sha => `/www/wwwroot/merchant-space.web-releases/${sha.slice(0, 12)}-online`;
const name = sha => `merchant-space-online-${sha.slice(0, 12)}`;
const anchor = (sha, port) => ({target: sha, name: name(sha), directory: location(sha), port});
const process = (sha, port, id) => ({name: name(sha), pmId: id, pid: id + 1000, cwd: location(sha), port,
  status: 'online', backgroundPaused: '1', automationEnabled: '0', invitationEnabled: '0'});

function fixture() {
  const active = anchor(target('a'), 3110), rollback = anchor(target('b'), 3109);
  const candidate = process(target('c'), 3103, 3);
  const base = {name: 'merchant-space', pmId: 0, pid: 1000, cwd: '/www/wwwroot/merchant-space-base',
    port: 3000, status: 'online', backgroundPaused: '0', automationEnabled: '1', invitationEnabled: '1'};
  const worker = {...base, name: 'merchant-space-worker', pmId: 1, pid: 1001, port: null};
  const victim = {target: target('c'), name: candidate.name, pmId: candidate.pmId,
    pid: candidate.pid, cwd: candidate.cwd, port: candidate.port};
  return {
    victim, active, rollback,
    sourceState: {target: victim.target, name: victim.name, directory: victim.cwd, port: victim.port,
      status: 'active', buildId: victim.target, sourceHead: victim.target},
    sourceClean: true, maintenanceEnded: true, priorCertificates: [],
    protectedNames: [active.name, rollback.name, base.name, worker.name],
    processes: [base, worker, candidate, process(active.target, active.port, 10), process(rollback.target, rollback.port, 9)],
    listeners: [{address: '127.0.0.1', port: 3103, pid: candidate.pid},
      {address: '127.0.0.1', port: 3110, pid: 1010}, {address: '127.0.0.1', port: 3000, pid: 1000}],
    established: [{localPort: 3110, peerPort: 43530}],
    nginxConfig: 'server { location / { proxy_pass http://127.0.0.1:3110; } }',
    maintenanceSha256: '1'.repeat(64), markerSha256: '2'.repeat(64),
  };
}

function stopped(before) {
  const after = clone(before);
  const victim = after.processes.find(item => item.name === before.victim.name);
  victim.pid = 0; victim.status = 'stopped';
  after.listeners = after.listeners.filter(item => item.port !== before.victim.port);
  return after;
}

function certificate(before = fixture()) {
  return {version: 1, status: 'completed', victim: clone(before.victim), activeTarget: before.active.target,
    stoppedProcess: stopped(before).processes.find(item => item.name === before.victim.name),
    rollbackTarget: before.rollback.target, nextTarget: target('d'),
    allowedActiveTargets: [before.active.target, before.rollback.target, target('d')],
    beforeSha256: '3'.repeat(64), afterSha256: '4'.repeat(64), completedAt: '2026-09-27T18:00:00.000Z'};
}

const saved = before => before.processes.map(({name, pid, cwd}) => ({name, pid, cwd}));
const retained = (before = fixture()) => ({saved: saved(before), current: stopped(before).processes,
  certificates: [certificate(before)], activeTarget: before.active.target, protectedNames: before.protectedNames});

test('accepts one exact registered paused historical web without mutating evidence', () => {
  const input = fixture(), original = clone(input), result = assertOnlineRetirementPlan(input);
  assert.deepEqual(result, input.victim);
  assert.ok(Object.isFrozen(result));
  assert.deepEqual(input, original);
  for (let port = 3103; port <= 3108; port++) {
    const evidence = fixture();
    evidence.victim.port = evidence.sourceState.port = evidence.processes[2].port = evidence.listeners[0].port = port;
    assert.doesNotThrow(() => assertOnlineRetirementPlan(evidence));
  }
});

test('accepts only documented disabled victim PM2/Next defaults before and after stop', () => {
  for (const watch of [undefined, false]) for (const cronRestart of [undefined, null, false, '0'])
    for (const manualSignalHandle of [undefined, '']) {
      const input = fixture();
      Object.assign(input.processes[2], {watch, cronRestart, manualSignalHandle});
      assert.doesNotThrow(() => assertOnlineRetirementPlan(input));
      assert.equal(assertOnlineRetirementCompletion(input, stopped(input)), true);
      assert.equal(assertRetainedOnlineProcesses(retained(input)), true);
    }
});

for (const [field, values] of [
  ['watch', [true, null, 0, '0', '', 'false', [], ['src'], {}]],
  ['cronRestart', [true, 0, '', 'false', '* * * * *', '0 0 * * *', [], {}]],
  ['manualSignalHandle', [true, false, null, 0, '0', 'false', '1', [], {}]],
]) for (const value of values) test(`rejects ${field}=${JSON.stringify(value)} at plan and retained validation`, () => {
  const evidence = fixture(); evidence.processes[2][field] = value;
  assert.throws(() => assertOnlineRetirementPlan(evidence), /online_retirement_victim_/);
  const input = retained(); input.current[2][field] = value;
  assert.throws(() => assertRetainedOnlineProcesses(input), /online_retirement_(?:victim_|retired_registration_changed)/);
});

const planFailures = [
  ['wrong SHA', input => { input.victim.target = 'main'; }],
  ['noncanonical name', input => { input.victim.name += '-other'; }],
  ['wrong source path', input => { input.victim.cwd += '/..'; }],
  ['wrong PM2 id', input => { input.victim.pmId++; }],
  ['wrong PID', input => { input.victim.pid++; }],
  ['port expanded', input => { input.victim.port = 3111; }],
  ['base process port', input => { input.victim.port = 3000; }],
  ['card base port', input => { input.victim.port = 3101; }],
  ['web base port', input => { input.victim.port = 3102; }],
  ['rollback port', input => { input.victim.port = 3109; }],
  ['live port', input => { input.victim.port = 3110; }],
  ['wrong active', input => { input.active.port = 3108; }],
  ['wrong rollback', input => { input.rollback.port = 3108; }],
  ['live target reused', input => { input.victim.target = input.active.target; }],
  ['maintenance not ended', input => { input.maintenanceEnded = false; }],
  ['missing maintenance evidence', input => { delete input.maintenanceEnded; }],
  ['previous retirement', input => { input.priorCertificates.push(certificate()); }],
  ['incomplete previous-retirement inventory', input => { delete input.priorCertificates; }],
  ['victim protected', input => { input.protectedNames.push(input.victim.name); }],
  ['missing rollback protection', input => { input.protectedNames = [input.active.name]; }],
  ['missing protected registration', input => { input.processes.shift(); }],
  ['wrong live cwd', input => { input.processes[3].cwd += '-other'; }],
  ['wrong live port', input => { input.processes[3].port++; }],
  ['dirty source', input => { input.sourceClean = false; }],
  ['wrong source status', input => { input.sourceState.status = 'preparing'; }],
  ['wrong source target', input => { input.sourceState.target = target('d'); }],
  ['wrong build identity', input => { input.sourceState.buildId = target('d'); }],
  ['wrong git source', input => { input.sourceState.sourceHead = target('d'); }],
  ['unpaused jobs', input => { input.processes[2].backgroundPaused = '0'; }],
  ['automation jobs enabled', input => { input.processes[2].automationEnabled = '1'; }],
  ['invitation jobs enabled', input => { input.processes[2].invitationEnabled = '1'; }],
  ['boolean instead of exact paused env', input => { input.processes[2].backgroundPaused = true; }],
  ['missing env evidence', input => { delete input.processes[2].invitationEnabled; }],
  ['duplicate process name', input => { input.processes.push({...input.processes[2], pmId: 33}); }],
  ['duplicate PM2 id', input => { input.processes[1].pmId = input.processes[0].pmId; }],
  ['already stopped victim', input => { input.processes[2].status = 'stopped'; input.processes[2].pid = 0; }],
  ['missing socket inventory', input => { delete input.listeners; }],
  ['missing connection inventory', input => { delete input.established; }],
  ['wildcard listener', input => { input.listeners[0].address = '0.0.0.0'; }],
  ['wrong listener PID', input => { input.listeners[0].pid++; }],
  ['second victim listener', input => { input.listeners.push({...input.listeners[0], port: 45000}); }],
  ['missing victim listener', input => { input.listeners.shift(); }],
  ['second port owner', input => { input.listeners.push({...input.listeners[0], pid: 44000}); }],
  ['active client connection', input => { input.established.push({localPort: 3103, peerPort: 44000}); }],
  ['reverse-side client connection', input => { input.established.push({localPort: 44000, peerPort: 3103}); }],
  ['malformed listener', input => { input.listeners[1].port = '3110'; }],
  ['malformed connection', input => { input.established[0].peerPort = 0; }],
  ['missing effective nginx configuration', input => { input.nginxConfig = ''; }],
  ['direct nginx route', input => { input.nginxConfig += '\nproxy_pass http://127.0.0.1:3103;'; }],
  ['named upstream route', input => { input.nginxConfig += '\nupstream old { server localhost:3103; }'; }],
  ['IPv6 nginx reference', input => { input.nginxConfig += '\nserver [::1]:3103;'; }],
  ['ambiguous comment retained conservatively', input => { input.nginxConfig += '\n# prior port: 3103'; }],
  ['named process reference', input => { input.nginxConfig += `\nupstream ${input.victim.name} {}`; }],
  ['old source route reference', input => { input.nginxConfig += `\nroot ${input.victim.cwd}/public;`; }],
];

for (const [description, mutate] of planFailures) test(`plan rejects ${description}`, () => {
  const input = fixture(); mutate(input);
  assert.throws(() => assertOnlineRetirementPlan(input), /online_retirement_/);
});

test('completion preserves stopped registration and every unrelated process, source and listener', () => {
  const before = fixture(), after = stopped(before);
  after.processes.reverse(); after.listeners.reverse();
  // Activity on retained live processes may naturally change between samples.
  after.established = [{localPort: 3110, peerPort: 44444}];
  assert.equal(assertOnlineRetirementCompletion(before, after), true);
});

for (const [description, mutate] of [
  ['deleted registration', input => { input.processes = input.processes.filter(item => item.status !== 'stopped'); }],
  ['changed stopped PM2 id', input => { input.processes[2].pmId++; }],
  ['changed stopped source', input => { input.processes[2].cwd += '-other'; }],
  ['restarted victim', input => { input.processes[2].status = 'online'; input.processes[2].pid = 7777; }],
  ['other process restart', input => { input.processes[0].pid++; }],
  ['other process environment changed', input => { input.processes[0].automationEnabled = '0'; }],
  ['extra process', input => { input.processes.push(process(target('e'), 4000, 55)); }],
  ['changed proxy', input => { input.nginxConfig += '\n# changed'; }],
  ['changed source state', input => { input.sourceState.status = 'rolled-back'; }],
  ['changed maintenance hash', input => { input.maintenanceSha256 = 'a'.repeat(64); }],
  ['changed active marker', input => { input.active.target = target('e'); }],
  ['listener still present', input => { input.listeners.push(fixture().listeners[0]); }],
  ['new unrelated listener', input => { input.listeners.push({address: '127.0.0.1', port: 4100, pid: 2222}); }],
  ['victim connection still present', input => { input.established.push({localPort: 3103, peerPort: 41234}); }],
]) test(`completion rejects ${description}`, () => {
  const before = fixture(), after = stopped(before); mutate(after);
  assert.throws(() => assertOnlineRetirementCompletion(before, after), /online_retirement_/);
});

test('completed certificate binds original identity to current, rollback and reviewed next targets', () => {
  const item = certificate();
  assert.equal(assertOnlineRetirementCertificate(item), true);
  for (const activeTarget of item.allowedActiveTargets)
    assert.equal(assertRetainedOnlineProcesses({...retained(), activeTarget}), true);
});

for (const [description, mutate] of [
  ['unfinished certificate', item => { item.status = 'ready-to-retire'; }],
  ['unknown certificate version', item => { item.version = 2; }],
  ['missing stopped process', item => { delete item.stoppedProcess; }],
  ['stopped process not stopped', item => { item.stoppedProcess.status = 'online'; item.stoppedProcess.pid = item.victim.pid; }],
  ['stopped process changed PM2 id', item => { item.stoppedProcess.pmId++; }],
  ['stopped process changed cwd', item => { item.stoppedProcess.cwd += '-other'; }],
  ['stopped process changed name', item => { item.stoppedProcess.name += '-other'; }],
  ['stopped process changed port', item => { item.stoppedProcess.port++; }],
  ['stopped process background enabled', item => { item.stoppedProcess.backgroundPaused = '0'; }],
  ['stopped process cron enabled', item => { item.stoppedProcess.cronRestart = '* * * * *'; }],
  ['missing snapshot hash', item => { delete item.beforeSha256; }],
  ['same before/after hash', item => { item.afterSha256 = item.beforeSha256; }],
  ['missing completion time', item => { delete item.completedAt; }],
  ['invalid completion time', item => { item.completedAt = 'not-a-date'; }],
  ['arbitrary extra anchor', item => { item.allowedActiveTargets.push(target('f')); }],
  ['unbound next target', item => { item.allowedActiveTargets[2] = target('f'); }],
  ['duplicated allowlist target', item => { item.allowedActiveTargets[2] = item.activeTarget; }],
  ['retiring rollback as next target', item => { item.nextTarget = item.victim.target; item.allowedActiveTargets[2] = item.nextTarget; }],
]) test(`certificate rejects ${description}`, () => {
  const item = certificate(); mutate(item);
  assert.throws(() => assertOnlineRetirementCertificate(item), /online_retirement_/);
});

test('historical snapshot remains intact; new snapshots may omit only the certified stopped entry', () => {
  const input = retained(), initial = clone(input);
  assert.equal(assertRetainedOnlineProcesses(input), true);
  assert.deepEqual(input, initial);
  input.saved = input.saved.filter(item => item.name !== fixture().victim.name);
  assert.equal(assertRetainedOnlineProcesses(input), true);
});

test('no-retirement path preserves normal strict historical baseline validation', () => {
  const before = fixture();
  assert.equal(assertRetainedOnlineProcesses({saved: saved(before), current: before.processes,
    certificates: [], activeTarget: before.active.target}), true);
});

for (const [description, mutate] of [
  ['missing certificate', input => { input.certificates = []; }],
  ['two retirements', input => { input.certificates.push(clone(input.certificates[0])); }],
  ['unapproved active target', input => { input.activeTarget = target('e'); }],
  ['protected saved baseline', input => { input.protectedNames.push(input.certificates[0].victim.name); }],
  ['tampered original PID', input => { input.certificates[0].victim.pid++; }],
  ['tampered saved PID', input => { input.saved[2].pid++; }],
  ['tampered saved cwd', input => { input.saved[2].cwd += '-other'; }],
  ['missing stopped registration', input => { input.current.splice(2, 1); }],
  ['changed stopped PM2 id', input => { input.current[2].pmId++; }],
  ['changed stopped port', input => { input.current[2].port++; }],
  ['changed stopped executable', input => { input.current[2].executable = '/different/next'; }],
  ['changed stopped args', input => { input.current[2].args = ['other-command']; }],
  ['changed stopped interpreter', input => { input.current[2].interpreter = '/different/node'; }],
  ['changed stopped environment hash', input => { input.current[2].environmentSha256 = 'a'.repeat(64); }],
  ['restarted retired process', input => { input.current[2].status = 'online'; input.current[2].pid = 1003; }],
  ['paused flags cleared', input => { input.current[2].backgroundPaused = '0'; }],
  ['unrelated saved restart', input => { input.current[0].pid++; }],
  ['unrelated stopped process', input => { input.current[0].status = 'stopped'; input.current[0].pid = 0; }],
  ['duplicate saved process', input => { input.saved.push(clone(input.saved[0])); }],
  ['new snapshot saved pid0', input => { input.saved[2].pid = 0; }],
]) test(`retained validation rejects ${description}`, () => {
  const input = retained(); mutate(input);
  assert.throws(() => assertRetainedOnlineProcesses(input), /online_retirement_/);
});

test('certificate retains and compares every stable normalized stopped process field', () => {
  const before = fixture();
  Object.assign(before.processes[2], {executable: `${before.victim.cwd}/node_modules/next/dist/bin/next`,
    interpreter: '/usr/bin/node', args: ['start', '-H', '127.0.0.1', '-p', '3103'], nodeArgs: [],
    execMode: 'fork_mode', watch: false, cronRestart: null, environmentSha256: 'a'.repeat(64)});
  const input = retained(before);
  assert.equal(assertRetainedOnlineProcesses(input), true);
  input.current[2].args = ['start', '-H', '0.0.0.0', '-p', '3103'];
  assert.throws(() => assertRetainedOnlineProcesses(input), /retired_registration_changed/);
});
