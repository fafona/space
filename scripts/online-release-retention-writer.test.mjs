import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {normalizeRetirementProcess} from './online-release-retirement.mjs';
import {readOnlineRollingRetentions} from './online-release-rolling.mjs';
import {ROLLING_BASE_NAMES} from './online-release-rolling-policy.mjs';
import {WEB_RELEASE_FILES} from './web-presentation-release-policy.mjs';
import {readOnlineRetentionHistory, buildOnlineRetentionReceipt} from './online-release-retention.mjs';
import {createOnlineRetentionHistory, ONLINE_RETENTION_POLICY as policy, retentionCanonicalText as canonical,
  retentionHash, onlineRetentionHeadRecord} from './online-release-retention-policy.mjs';
import {executeOnlineRetention, createOnlineRetentionJournal, inspectOnlineRetentionReconciliation,
  assertOnlineRetentionImmediateStop, assertOnlineRetentionPersistedProcesses,
  runOnlineRetentionUnderHeldLocks, withOnlineRetentionLocks, onlineRetentionMain} from './online-release-retention-writer.mjs';

const sha = c => c.repeat(40), hash = c => c.repeat(64), clone = value => structuredClone(value);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const stamp = '2026-09-29T01:00:00.000Z';
const nameOf = target => `merchant-space-online-${target.slice(0, 12)}`;
const cwdOf = target => `/www/wwwroot/merchant-space.web-releases/${target.slice(0, 12)}-online`;
const location = (target, port) => ({target, name: nameOf(target), directory: cwdOf(target), port});
function raw(target, port, id) {
  return {name: nameOf(target), pm_id: id, pid: 1000 + id, pm2_env: {
    status: 'online', pm_cwd: cwdOf(target), PORT: String(port), env: {PORT: String(port), PRIVATE: 'synthetic-only'},
    pm_exec_path: `${cwdOf(target)}/node_modules/next/dist/bin/next`, exec_interpreter: '/usr/bin/node',
    args: ['start', '-H', '127.0.0.1', '-p', String(port)], node_args: [], exec_mode: 'fork_mode',
    watch: false, cron_restart: null, restart_time: 0, created_at: 123, shutdown_with_message: false,
    FAOLLA_BACKGROUND_JOBS_PAUSED: '1', MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED: '0',
    MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED: '0'}};
}
function oldFixture() {
  const raws = [raw(sha('c'), 3103, 3), raw(sha('a'), 3110, 10), raw(sha('b'), 3109, 9)];
  for (const [i, name] of ROLLING_BASE_NAMES.entries()) {
    const p = raw(sha('9'), 3000 + i, 20 + i); p.name = name; p.pm2_env.pm_cwd = '/base/' + name;
    p.pm2_env.pm_exec_path = p.pm2_env.pm_cwd + '/node_modules/next/dist/bin/next'; raws.push(p);
  }
  const processes = raws.map(normalizeRetirementProcess), p = processes[0];
  const victim = {target: sha('c'), name: p.name, cwd: p.cwd, pmId: p.pmId, pid: p.pid, port: p.port};
  const before = {victim, active: location(sha('a'), 3110), rollback: location(sha('b'), 3109), toolRevision: sha('d'),
    sourceState: {...location(sha('c'), 3103), status: 'active', buildId: sha('c'), sourceHead: sha('c')}, sourceClean: true,
    maintenanceEnded: true, priorCertificates: [], protectedNames: processes.slice(1).map(p => p.name), processes,
    listeners: processes.map(p => ({address: '127.0.0.1', port: p.port, pid: p.pid})), established: [], nginxConfig: 'proxy_pass http://127.0.0.1:3110;'};
  const after = clone(before); after.processes[0] = {...p, status: 'stopped', pid: 0}; after.listeners = after.listeners.filter(row => row.pid !== p.pid);
  const json = value => JSON.stringify(value, null, 2) + '\n';
  const recovery = {process: raws[0], runtime: {}, dumpBefore: 'synthetic-private-recovery'};
  const files = new Map([['before.json', json(before)], ['after.json', json(after)], ['recovery-pm2.json', json(recovery)]]);
  files.set('prepared.json', json({version: 1, status: 'prepared', toolRevision: sha('d'), victim,
    beforeSha256: digest(files.get('before.json')), recoverySha256: digest(files.get('recovery-pm2.json')), preparedAt: stamp}));
  files.set('certificate.json', json({version: 1, status: 'completed', victim, stoppedProcess: after.processes[0],
    activeTarget: sha('a'), rollbackTarget: sha('b'), nextTarget: sha('d'), allowedActiveTargets: ['a', 'b', 'd'].map(sha),
    beforeSha256: digest(files.get('before.json')), afterSha256: digest(files.get('after.json')), completedAt: stamp}));
  return {files, raws, processes: after.processes};
}
function memoryFs(legacy) {
  const files = new Map([...legacy].map(([name, text]) => ['/legacy/' + name, Buffer.from(text)]));
  const directories = new Set(['/', '/legacy', '/rolling']), inodes = new Map(), versions = new Map(), overrides = new Map(), fds = new Map(), calls = [];
  let nextInode = 1, nextFd = 10;
  const missing = () => Object.assign(Error('synthetic_missing'), {code: 'ENOENT'});
  const version = name => versions.set(name, (versions.get(name) ?? 1) + 1);
  const stat = name => {
    if (!files.has(name) && !directories.has(name)) throw missing();
    if (!inodes.has(name)) inodes.set(name, nextInode++);
    const file = files.has(name);
    return {dev: 1, ino: inodes.get(name), uid: 0, nlink: 1, mode: file ? 0o100600 : 0o40700,
      size: file ? files.get(name).length : 0, mtimeMs: versions.get(name) ?? 1, ctimeMs: versions.get(name) ?? 1,
      isFile: () => file, isDirectory: () => !file, isSymbolicLink: () => false, ...(overrides.get(name) ?? {})};
  };
  const io = {
    existsSync: name => files.has(name) || directories.has(name),
    lstatSync: stat, realpathSync: name => {stat(name); return name;},
    readdirSync(name) {
      if (!directories.has(name)) throw missing();
      const prefix = name === '/' ? '/' : name + '/';
      return [...new Set([...files.keys(), ...directories].filter(p => p !== name && p.startsWith(prefix)).map(p => p.slice(prefix.length).split('/')[0]))];
    },
    mkdirSync(name, options) {calls.push(['mkdir', name, options.mode]); if (io.existsSync(name)) throw Object.assign(Error('exists'), {code: 'EEXIST'}); directories.add(name); version(path.posix.dirname(name));},
    openSync(name, flags, mode) {
      calls.push(['open', name, flags, mode]);
      if ((flags & fs.constants.O_EXCL) && io.existsSync(name)) throw Object.assign(Error('exists'), {code: 'EEXIST'});
      if (!io.existsSync(name)) {if (!(flags & fs.constants.O_CREAT)) throw missing(); files.set(name, Buffer.alloc(0)); version(path.posix.dirname(name));}
      const fd = nextFd++; fds.set(fd, name); return fd;
    },
    fstatSync(fd) {assert.ok(fds.has(fd)); return stat(fds.get(fd));},
    readFileSync(file, encoding) {const name = typeof file === 'number' ? fds.get(file) : file; if (!files.has(name)) throw missing(); return encoding === 'utf8' ? files.get(name).toString() : Buffer.from(files.get(name));},
    writeFileSync(fd, bytes) {assert.ok(fds.has(fd)); const name = fds.get(fd); calls.push(['write', name]); files.set(name, Buffer.from(bytes)); version(name);},
    fsyncSync(fd) {assert.ok(fds.has(fd)); calls.push(['fsync', fds.get(fd)]);},
    closeSync(fd) {assert.ok(fds.has(fd)); calls.push(['close', fds.get(fd)]); fds.delete(fd);},
    renameSync(from, to) {calls.push(['rename', from, to]); const st = stat(from); files.set(to, files.get(from)); files.delete(from); inodes.set(to, st.ino); version(path.posix.dirname(to));},
    rmdirSync(name) {calls.push(['rmdir', name]); assert.equal(io.readdirSync(name).length, 0); directories.delete(name); version(path.posix.dirname(name));},
  };
  return {io, files, directories, overrides, inodes, calls, fds, put: (name, value) => {files.set(name, Buffer.from(value)); version(name);}};
}
function fixture() {
  const old = oldFixture(), memory = memoryFs(old.files);
  const rolling = readOnlineRollingRetentions('/rolling', memory.io, '/legacy');
  const history = createOnlineRetentionHistory(rolling);
  const readHistory = (root = '/retention', io = memory.io) => readOnlineRetentionHistory(root, io, '/rolling', '/legacy');
  return {...memory, old, history, readHistory};
}
function observation(history, kind, processes) {
  const anchor = target => {const p = processes.find(p => p.name === nameOf(target)); return {...location(target, p.port), process: clone(p)};};
  const active = anchor(kind === 'initialize' ? sha('a') : sha('f')), rollback = anchor(kind === 'initialize' ? sha('b') : sha('a'));
  const victim = kind === 'retire' ? {target: sha('b'), process: clone(processes.find(p => p.name === nameOf(sha('b'))))} : null;
  const state = a => ({...location(a.target, a.port), status: 'active', activatedAt: stamp});
  const activeState = {...state(active), baseline: rollback.target, oldName: rollback.name, oldDirectory: rollback.directory, oldPort: rollback.port,
    ...(kind === 'converge' ? {retentionHeadSha256: history.headSha256} : {})};
  return {version: 2, policy, kind, sequence: history.entries.length + 1, previousSha256: history.headSha256,
    legacySha256: history.rollingHistory.legacySha256, rollingHeadSha256: history.rollingHistory.headSha256,
    rollingHistorySha256: retentionHash(history.rollingHistory), toolRevision: sha('8'), active, rollback, victim, processes: clone(processes),
    activeFile: location(active.target, active.port), activeState, sourceClean: true, maintenanceEnded: true,
    maintenanceSha256: hash('1'), markerSha256: hash('2'), baseDirectory: '/base/owned',
    proxyHashes: Object.fromEntries(WEB_RELEASE_FILES.map(name => [name, hash('3')])), nginxConfig: `proxy_pass http://127.0.0.1:${active.port};`,
    releaseProofs: [active, rollback, ...(victim ? [anchor(victim.target)] : [])].map(a => {
      const value = a.target === active.target ? activeState : state(a), text = JSON.stringify(value);
      return {target: a.target, sourceHead: a.target, sourceClean: true, state: value, stateText: text, stateSha256: digest(text),
        resolvedInterpreter: '/usr/bin/node', buildSha256: hash('4'), runtimeSha256: hash('5'), environmentSha256: hash('6'), http: {status: 200, ok: true, buildId: a.target}};
    }),
    identityProofs: processes.filter(p => p.status === 'online').map(p => ({name: p.name, pid: p.pid, cwd: p.cwd, uid: 0, parentPid: 99,
      startTicks: '123', executable: '/usr/bin/node', commandSha256: hash('7'), environmentSha256: hash('8')})),
    listeners: processes.filter(p => p.status === 'online').map(p => ({address: '127.0.0.1', port: p.port, pid: p.pid})), established: [],
    ancestry: [...(victim ? [{older: victim.target, newer: active.target, verified: true}] : []), {older: rollback.target, newer: active.target, verified: true}],
    daemon: {fact: {pid: 99, startTicks: '10'}, killSignal: 'SIGINT', killTimeout: 1600}, resolvedInterpreter: '/usr/bin/node', victimChildren: '',
    victimRuntimeFlags: {backgroundPaused: '1', automationEnabled: '0', invitationEnabled: '0', manualSignalHandle: ''}};
}
function complete(before) {
  const after = clone(before); if (!before.victim) return after;
  const p = before.victim.process;
  after.processes = after.processes.map(row => row.name === p.name ? {...row, status: 'stopped', pid: 0} : row);
  after.listeners = after.listeners.filter(row => row.pid !== p.pid); after.identityProofs = after.identityProofs.filter(row => row.pid !== p.pid); return after;
}
function receipt(before, history, rawVictim = null) {
  return buildOnlineRetentionReceipt(before, complete(before), {version: 2, process: rawVictim}, history, {preparedAt: stamp, completedAt: stamp});
}
function install(f, before) {
  const result = receipt(before, f.history, before.victim ? f.old.raws.find(p => p.name === before.victim.process.name) : null);
  const journal = createOnlineRetentionJournal(f.history, {root: '/retention', io: f.io, readHistory: f.readHistory});
  journal.begin(); for (const name of ['prepared.json', 'before.json', 'recovery-pm2.json', 'after.json', 'certificate.json']) journal.write(name, result.files.get(name));
  f.history = journal.complete(result.certificate); return result;
}
function convergedFixture() {
  const f = fixture(); install(f, observation(f.history, 'initialize', f.old.processes));
  const processes = [...f.old.processes, normalizeRetirementProcess(raw(sha('f'), 3105, 6))];
  install(f, observation(f.history, 'converge', processes));
  return {...f, processes, first: observation(f.history, 'retire', processes)};
}
function fakeOperations(first, history, rawVictim = null) {
  const events = [], files = new Map(); let stopped = false;
  const operations = {wait: async ms => events.push(['wait', ms]), now: () => stamp,
    observe: async () => {events.push(['observe']); return stopped ? complete(first) : clone(first);},
    recovery: async () => ({version: 2, process: rawVictim}), begin: async () => events.push(['begin']),
    write: async (name, text) => {events.push(['write', name]); files.set(name, text);},
    finalCheck: async () => {events.push(['finalCheck']); return clone(first);},
    stop: async pmId => {events.push(['stop', pmId]); stopped = true;}, save: async () => events.push(['save']),
    verifyPersisted: async () => events.push(['verifyPersisted']), complete: async () => events.push(['complete']),
  };
  return {operations, events, files, run: () => executeOnlineRetention(operations, first, history)};
}

test('initialize and converge write canonical evidence without stop or save; tool SHA is not an app target', async () => {
  const f = fixture(), first = observation(f.history, 'initialize', f.old.processes), ops = fakeOperations(first, f.history);
  const cert = await ops.run(); assert.equal(cert.toolRevision, sha('8')); assert.notEqual(cert.active.target, cert.toolRevision);
  assert.equal(ops.events.some(([name]) => ['stop', 'save'].includes(name)), false);
  assert.deepEqual([...ops.files.keys()], ['prepared.json', 'before.json', 'recovery-pm2.json', 'after.json', 'certificate.json']);
  install(f, first); const next = observation(f.history, 'converge', [...f.old.processes, normalizeRetirementProcess(raw(sha('f'), 3105, 6))]);
  const converging = fakeOperations(next, f.history); await converging.run();
  assert.equal(converging.events.some(([name]) => ['stop', 'save'].includes(name)), false);
});
test('retire writes three durable preparations, final-checks, stops once, saves once, then certifies', async () => {
  const f = convergedFixture(), ops = fakeOperations(f.first, f.history, f.old.raws[2]);
  const cert = await ops.run(); assert.equal(cert.stoppedProcess.pid, 0); assert.equal(cert.victim.process.pmId, 9);
  assert.deepEqual(ops.events.filter(([name]) => name !== 'observe'), [['wait', 2000], ['begin'], ['write', 'prepared.json'],
    ['write', 'before.json'], ['write', 'recovery-pm2.json'], ['finalCheck'], ['stop', 9], ['save'], ['verifyPersisted'],
    ['write', 'after.json'], ['write', 'certificate.json'], ['complete']]);
  for (const name of ROLLING_BASE_NAMES) assert.deepEqual(cert.processes.find(p => p.name === name), f.first.processes.find(p => p.name === name));
});
for (const stage of ['begin', 'write', 'finalCheck', 'stop', 'save', 'verifyPersisted', 'complete']) test(`failure at ${stage} never retries stop or creates a later certificate`, async () => {
  const f = convergedFixture(), ops = fakeOperations(f.first, f.history, f.old.raws[2]);
  let count = 0; ops.operations[stage] = async () => {count++; throw Error('synthetic_failure');};
  await assert.rejects(ops.run, /synthetic_failure/); assert.equal(count, 1);
  assert.ok(ops.events.filter(([name]) => name === 'stop').length <= 1);
  if (!['complete'].includes(stage)) assert.equal(ops.files.has('certificate.json'), false);
});
for (const field of ['pid', 'cwd', 'restartCount', 'environmentSha256']) test(`pre-stop ${field} drift prevents any stop`, async () => {
  const f = convergedFixture(), ops = fakeOperations(f.first, f.history, f.old.raws[2]);
  ops.operations.finalCheck = async () => {const changed = clone(f.first); const p = changed.processes.find(p => p.name === f.first.victim.process.name); p[field] = field === 'pid' || field === 'restartCount' ? 777 : 'changed'; return changed;};
  await assert.rejects(ops.run); assert.equal(ops.events.some(([name]) => name === 'stop'), false);
});
test('a new victim connection in the last observation blocks stop', async () => {
  const f = convergedFixture(), ops = fakeOperations(f.first, f.history, f.old.raws[2]);
  ops.operations.finalCheck = async () => ({...clone(f.first), established: [{localPort: 3109, peerPort: 50000, pids: [1009]}]});
  await assert.rejects(ops.run, /connections_present/); assert.equal(ops.events.some(([name]) => name === 'stop'), false);
});
for (const field of ['startTicks', 'daemon', 'runtimeFlags', 'children', 'listener', 'connection', 'proxy']) test(`immediate stop gate rejects ${field} changes after the full observation`, () => {
  const f = convergedFixture(), changed = clone(f.first);
  if (field === 'startTicks') changed.identityProofs.find(p => p.name === f.first.victim.process.name).startTicks = '9999';
  if (field === 'daemon') changed.daemon.fact.startTicks = '9999';
  if (field === 'runtimeFlags') changed.victimRuntimeFlags.automationEnabled = '1';
  if (field === 'children') changed.victimChildren = '9999';
  if (field === 'listener') changed.listeners.find(p => p.pid === f.first.victim.process.pid).port++;
  if (field === 'connection') changed.established = [{localPort: 3109, peerPort: 50000, pids: [1009]}];
  if (field === 'proxy') changed.nginxConfig += ' # ' + f.first.victim.process.port;
  assert.throws(() => assertOnlineRetentionImmediateStop(f.first, changed, f.history));
});
test('immediate gate permits only retire, never initialize or converge', () => {
  const f = fixture(), first = observation(f.history, 'initialize', f.old.processes);
  assert.throws(() => assertOnlineRetentionImmediateStop(first, first, f.history), /stop_not_authorized/);
  install(f, first); const next = observation(f.history, 'converge', [...f.old.processes, normalizeRetirementProcess(raw(sha('f'), 3105, 6))]);
  assert.throws(() => assertOnlineRetentionImmediateStop(next, next, f.history), /stop_not_authorized/);
});
test('unrelated established sockets may change while all stable evidence remains equal', async () => {
  const f = convergedFixture(), ops = fakeOperations(f.first, f.history, f.old.raws[2]), observe = ops.operations.observe;
  ops.operations.observe = async () => ({...await observe(), established: [{localPort: 443, peerPort: 50000, pids: [88]}]});
  await ops.run(); assert.equal(ops.events.filter(([name]) => name === 'stop').length, 1);
});
test('post-stop collateral base-worker change leaves incomplete evidence and never saves', async () => {
  const f = convergedFixture(), ops = fakeOperations(f.first, f.history, f.old.raws[2]), observe = ops.operations.observe;
  ops.operations.observe = async () => {const result = await observe(); if (result.processes.find(p => p.name === f.first.victim.process.name).pid === 0) result.processes.find(p => p.name === ROLLING_BASE_NAMES[0]).pid++; return result;};
  await assert.rejects(ops.run, /completion_changed/); assert.equal(ops.events.some(([name]) => name === 'save'), false); assert.equal(ops.files.has('certificate.json'), false);
});
for (const change of ['none', 'status', 'environment', 'cwd', 'missing', 'extra']) test(`read-only persisted-process proof checks ${change} without save`, () => {
  const live = [raw(sha('b'), 3109, 9), raw(sha('a'), 3110, 10)];
  for (const p of live) p.pm2_env.name = p.name;
  live[0].pid = 0; live[0].pm2_env.status = 'stopped';
  const dump = live.map(p => clone(p.pm2_env)), evidence = {processes: live.map(normalizeRetirementProcess)};
  if (change === 'status') dump[0].status = 'online';
  if (change === 'environment') dump[1].env.PRIVATE = 'changed';
  if (change === 'cwd') dump[1].pm_cwd = '/other';
  if (change === 'missing') dump.pop();
  if (change === 'extra') dump.push({...clone(dump[1]), name: 'other'});
  if (change === 'none') assert.doesNotThrow(() => assertOnlineRetentionPersistedProcesses(live, dump, evidence));
  else assert.throws(() => assertOnlineRetentionPersistedProcesses(live, dump, evidence), /dump_process/);
});
test('journal canonical five-file output is accepted by the unchanged public strict reader with external pin', () => {
  const f = convergedFixture(); install(f, f.first); assert.deepEqual(f.readHistory(), f.history);
  assert.deepEqual(JSON.parse(f.files.get('/retention.head.json')), onlineRetentionHeadRecord(f.history));
  const calls = f.calls; const headRename = calls.findLastIndex(c => c[0] === 'rename');
  assert.ok(calls.slice(0, headRename).some(c => c[0] === 'fsync' && c[1] === '/retention/000003/certificate.json'));
  assert.ok(calls.slice(0, headRename).some(c => c[0] === 'fsync' && c[1] === '/retention/000003'));
  assert.ok(calls.slice(headRename + 1).some(c => c[0] === 'fsync' && c[1] === '/'));
  assert.equal(f.fds.size, 0);
});
test('only this journal can view its exact owned partial tail; public readers never skip it', () => {
  const f = fixture(), first = observation(f.history, 'initialize', f.old.processes), r = receipt(first, f.history);
  const journal = createOnlineRetentionJournal(f.history, {root: '/retention', io: f.io, readHistory: f.readHistory});
  journal.begin(); journal.write('prepared.json', r.files.get('prepared.json'));
  assert.deepEqual(journal.prefix(), f.history); assert.throws(() => f.readHistory(), /history_files_incomplete/);
  assert.throws(() => createOnlineRetentionJournal(f.history, {root: '/retention', io: f.io, readHistory: f.readHistory}).begin(), /history_files_incomplete/);
  assert.throws(() => inspectOnlineRetentionReconciliation({root: '/retention', io: f.io, readHistory: f.readHistory}), /partial_attempt_requires_manual_recovery/);
});
for (const mutation of ['bytes', 'inode', 'extraFile', 'extraTail', 'mode', 'hardlink', 'symlink']) test(`owned pending ${mutation} drift fails closed`, () => {
  const f = fixture(), first = observation(f.history, 'initialize', f.old.processes), r = receipt(first, f.history);
  const journal = createOnlineRetentionJournal(f.history, {root: '/retention', io: f.io, readHistory: f.readHistory}); journal.begin(); journal.write('prepared.json', r.files.get('prepared.json'));
  const filename = '/retention/000001/prepared.json';
  if (mutation === 'bytes') f.put(filename, r.files.get('prepared.json') + ' ');
  if (mutation === 'inode') f.inodes.set(filename, 999999);
  if (mutation === 'extraFile') f.put('/retention/000001/unexpected', 'x');
  if (mutation === 'extraTail') f.directories.add('/retention/000002');
  if (mutation === 'mode') f.overrides.set(filename, {mode: 0o100644});
  if (mutation === 'hardlink') f.overrides.set(filename, {nlink: 2});
  if (mutation === 'symlink') f.overrides.set(filename, {isSymbolicLink: () => true});
  assert.throws(() => journal.prefix()); assert.equal(f.files.has('/retention.head.json'), false);
});
test('fsync failure leaves partial evidence and cannot reach head update', () => {
  const f = fixture(), journal = createOnlineRetentionJournal(f.history, {root: '/retention', io: f.io, readHistory: f.readHistory});
  journal.begin(); f.io.fsyncSync = () => {throw Error('synthetic_fsync_failure');};
  assert.throws(() => journal.write('prepared.json', canonical({test: true})), /synthetic_fsync_failure/);
  assert.equal(f.files.has('/retention.head.json'), false); assert.equal(f.fds.size, 0); assert.throws(() => journal.prefix());
});
test('one complete unpinned tail validates all original proofs without writing or retrying stop', () => {
  const f = fixture(), first = observation(f.history, 'initialize', f.old.processes), r = receipt(first, f.history);
  const journal = createOnlineRetentionJournal(f.history, {root: '/retention', io: f.io, readHistory: f.readHistory}); journal.begin();
  for (const name of ['prepared.json', 'before.json', 'recovery-pm2.json', 'after.json', 'certificate.json']) journal.write(name, r.files.get(name));
  const before = f.calls.length, p = inspectOnlineRetentionReconciliation({root: '/retention', io: f.io, readHistory: f.readHistory});
  assert.equal(p.status, 'complete-uncommitted-tail'); assert.deepEqual(p.previous, f.history);
  assert.deepEqual(p.history.entries, [r.certificate]); assert.deepEqual(p.before, first);
  assert.equal(f.calls.slice(before).some(c => ['write', 'mkdir', 'rename', 'rmdir', 'fsync'].includes(c[0])), false);
  assert.throws(() => f.readHistory()); assert.equal(f.fds.size, 0);
});
test('reconcile refuses nonadjacent pin, incomplete tail and tampered complete receipt', () => {
  for (const change of ['pin', 'missing', 'bytes']) {
    const f = convergedFixture(), r = receipt(f.first, f.history, f.old.raws[2]);
    const journal = createOnlineRetentionJournal(f.history, {root: '/retention', io: f.io, readHistory: f.readHistory}); journal.begin();
    for (const name of ['prepared.json', 'before.json', 'recovery-pm2.json', 'after.json', 'certificate.json']) journal.write(name, r.files.get(name));
    if (change === 'pin') f.put('/retention.head.json', canonical({...onlineRetentionHeadRecord(f.history), sequence: 1}));
    if (change === 'missing') f.files.delete('/retention/000003/recovery-pm2.json');
    if (change === 'bytes') f.put('/retention/000003/after.json', canonical({bad: true}));
    assert.throws(() => inspectOnlineRetentionReconciliation({root: '/retention', io: f.io, readHistory: f.readHistory}));
  }
});
test('reconcile accepts only exact new-head temporary bytes beside a complete unpinned tail', () => {
  const f = convergedFixture(), r = receipt(f.first, f.history, f.old.raws[2]);
  const journal = createOnlineRetentionJournal(f.history, {root: '/retention', io: f.io, readHistory: f.readHistory}); journal.begin();
  for (const name of ['prepared.json', 'before.json', 'recovery-pm2.json', 'after.json', 'certificate.json']) journal.write(name, r.files.get(name));
  const next = {...f.history, entries: [...f.history.entries, r.certificate], headSha256: retentionHash(r.certificate)};
  f.put('/retention.head.json.pending', canonical(onlineRetentionHeadRecord(next)));
  assert.equal(inspectOnlineRetentionReconciliation({root: '/retention', io: f.io, readHistory: f.readHistory}).pendingHead, true);
  f.put('/retention.head.json.pending', canonical(onlineRetentionHeadRecord(f.history)));
  assert.throws(() => inspectOnlineRetentionReconciliation({root: '/retention', io: f.io, readHistory: f.readHistory}), /pending_pin_changed/);
});
test('already committed history never silently consumes an unrelated temporary head', () => {
  const f = convergedFixture();
  assert.equal(inspectOnlineRetentionReconciliation({root: '/retention', io: f.io, readHistory: f.readHistory}).status, 'already-committed');
  f.put('/retention.head.json.pending', canonical(onlineRetentionHeadRecord(f.history)));
  assert.throws(() => inspectOnlineRetentionReconciliation({root: '/retention', io: f.io, readHistory: f.readHistory}), /unexpected_pending_head/);
});
test('head rename failure leaves old external pin and a reconcilable complete tail without overwriting evidence', () => {
  const f = convergedFixture(), r = receipt(f.first, f.history, f.old.raws[2]), oldPin = Buffer.from(f.files.get('/retention.head.json'));
  const journal = createOnlineRetentionJournal(f.history, {root: '/retention', io: f.io, readHistory: f.readHistory}); journal.begin();
  for (const name of ['prepared.json', 'before.json', 'recovery-pm2.json', 'after.json', 'certificate.json']) journal.write(name, r.files.get(name));
  f.io.renameSync = () => {throw Error('synthetic_rename_failure');};
  assert.throws(() => journal.complete(r.certificate), /synthetic_rename_failure/);
  assert.deepEqual(f.files.get('/retention.head.json'), oldPin);
  const proof = inspectOnlineRetentionReconciliation({root: '/retention', io: f.io, readHistory: f.readHistory});
  assert.equal(proof.status, 'complete-uncommitted-tail'); assert.equal(proof.pendingHead, true); assert.equal(f.fds.size, 0);
});
test('caller cannot forge parent lock capability with a boolean, environment flag or numeric FD', async () => {
  const saved = process.env.FAOLLA_ONLINE_ROLLING_LOCKED;
  process.env.FAOLLA_ONLINE_ROLLING_LOCKED = '1';
  try {for (const lock of [undefined, true, {deployFd: 3, operationDirectory: '/var/lib/faolla-maintenance/merchant-space/operation.lock'}])
    await assert.rejects(runOnlineRetentionUnderHeldLocks({lock}), /parent_locks_required/);
  } finally {if (saved === undefined) delete process.env.FAOLLA_ONLINE_ROLLING_LOCKED; else process.env.FAOLLA_ONLINE_ROLLING_LOCKED = saved;}
});
test('async lock scope retains operation lock and fd until awaited work settles', async () => {
  const f = fixture(); f.directories.add('/locks'); f.directories.add('/maintenance');
  let settle; const gate = new Promise(resolve => {settle = resolve;}); let token;
  const work = withOnlineRetentionLocks(async context => {token = context; await gate; assert.ok(f.directories.has('/maintenance/operation.lock'));},
    {io: f.io, spawn: () => ({status: 0}), checkPath: name => {assert.ok(f.io.existsSync(name));}, deployLock: '/locks/deploy.lock', operation: '/maintenance/operation.lock'});
  await Promise.resolve(); assert.ok(f.directories.has('/maintenance/operation.lock')); assert.ok(f.fds.has(token.deployFd));
  settle(); await work; assert.equal(f.directories.has('/maintenance/operation.lock'), false); assert.equal(f.fds.size, 0);
});
test('busy flock cannot create an operation lock or invoke work', async () => {
  const f = fixture(); f.directories.add('/locks'); f.directories.add('/maintenance'); let ran = false;
  await assert.rejects(withOnlineRetentionLocks(() => {ran = true;}, {io: f.io, spawn: () => ({status: 1}), checkPath: () => {},
    deployLock: '/locks/deploy.lock', operation: '/maintenance/operation.lock'}), /deploy_lock_busy/);
  assert.equal(ran, false); assert.equal(f.directories.has('/maintenance/operation.lock'), false); assert.equal(f.fds.size, 0);
});
test('an existing operation lock is never removed when mkdir refuses ownership', async () => {
  const f = fixture(); for (const name of ['/locks', '/maintenance', '/maintenance/operation.lock']) f.directories.add(name);
  let ran = false;
  await assert.rejects(withOnlineRetentionLocks(() => {ran = true;}, {io: f.io, spawn: () => ({status: 0}), checkPath: () => {},
    deployLock: '/locks/deploy.lock', operation: '/maintenance/operation.lock'}), /exists/);
  assert.equal(ran, false); assert.ok(f.directories.has('/maintenance/operation.lock')); assert.equal(f.fds.size, 0);
});
test('deferred rejection still holds the lock until settlement and closes its fd', async () => {
  const f = fixture(); f.directories.add('/locks'); f.directories.add('/maintenance');
  let reject; const gate = new Promise((resolve, rejectPromise) => {reject = rejectPromise;});
  const promise = withOnlineRetentionLocks(() => gate, {io: f.io, spawn: () => ({status: 0}), checkPath: () => {},
    deployLock: '/locks/deploy.lock', operation: '/maintenance/operation.lock'});
  assert.ok(f.directories.has('/maintenance/operation.lock')); assert.equal(f.fds.size, 1);
  const rejected = assert.rejects(promise, /synthetic_rejection/); reject(Error('synthetic_rejection')); await rejected;
  assert.equal(f.directories.has('/maintenance/operation.lock'), false); assert.equal(f.fds.size, 0);
});
test('replacement operation lock is retained rather than removed on unwind', async () => {
  const f = fixture(); f.directories.add('/locks'); f.directories.add('/maintenance');
  await assert.rejects(withOnlineRetentionLocks(() => {f.inodes.set('/maintenance/operation.lock', 9999);}, {io: f.io,
    spawn: () => ({status: 0}), checkPath: () => {}, deployLock: '/locks/deploy.lock', operation: '/maintenance/operation.lock'}), /operation_lock_changed/);
  assert.ok(f.directories.has('/maintenance/operation.lock')); assert.equal(f.fds.size, 0);
});
test('native Linux inherited-FD flock remains held across await', {skip: process.platform !== 'linux'}, async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'retention-lock-'));
  try {
    const deployLock = path.join(directory, 'deploy.lock'), operation = path.join(directory, 'operation.lock');
    await withOnlineRetentionLocks(async () => {
      await new Promise(resolve => setTimeout(resolve, 5));
      const other = spawnSync('flock', ['--nonblock', deployLock, 'true']); assert.equal(other.status, 1); assert.ok(fs.existsSync(operation));
    }, {deployLock, operation, checkPath: name => {assert.equal(fs.lstatSync(name).isSymbolicLink(), false);}});
    assert.equal(spawnSync('flock', ['--nonblock', deployLock, 'true']).status, 0); assert.equal(fs.existsSync(operation), false);
  } finally {
    assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep + 'retention-lock-'));
    fs.rmSync(directory, {recursive: true, force: true});
  }
});
test('invalid CLI cannot become a production action on a non-Linux host', {skip: process.platform === 'linux'}, async () => {
  await assert.rejects(onlineRetentionMain(['retire', sha('8'), sha('a'), sha('b')]), /host_required/);
});
