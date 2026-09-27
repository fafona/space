import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {normalizeRetirementProcess} from './online-release-retirement.mjs';
import {ROLLING_BASE_NAMES, rollingHash, rollingCanonicalText} from './online-release-rolling-policy.mjs';
import {readOnlineRollingRetentions, executeOnlineRolling} from './online-release-rolling.mjs';

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

function memoryFs(initial) {
  const files = new Map([...initial].map(([name, value]) => ['/legacy/' + name, value]));
  const directories = new Set(['/legacy', '/rolling']), overrides = new Map();
  const io = {
    existsSync: path => files.has(path) || directories.has(path),
    readdirSync: path => [...new Set([...files.keys(), ...directories].filter(key => key.startsWith(path + '/'))
      .map(key => key.slice(path.length + 1).split('/')[0]))],
    readFileSync: path => { assert.ok(files.has(path), path); return files.get(path); },
    lstatSync: path => {
      assert.ok(files.has(path) || directories.has(path) || path === '/', path);
      const isFile = files.has(path);
      return {isDirectory: () => !isFile, isFile: () => isFile, isSymbolicLink: () => false,
        uid: 0, nlink: 1, mode: isFile ? 0o100600 : 0o40700, ...(overrides.get(path) ?? {})};
    },
  };
  return {io, files, directories, overrides};
}
function harness() {
  const fixtureValue = fixture(), {first, rawVictim} = fixtureValue, after = stopped(first);
  const memory = memoryFs(fixtureValue.legacyFiles), calls = [], writes = new Map(); let signals = 0;
  const dir = '/rolling/' + first.toolRevision;
  const operations = {
    observe: async frozen => { calls.push(frozen ? 'observe-stopped' : 'observe-running');
      return clone(frozen && signals ? after : first); },
    finalCheck: async () => { calls.push('final-check'); return clone(first); },
    wait: async ms => { assert.equal(ms, 2000); calls.push('wait'); },
    now: () => '2026-09-27T19:22:00.000Z',
    recovery: async () => { calls.push('recovery'); return {version: 1, process: rawVictim, runtime: {},
      processEnvironment: {PRIVATE: 'recovery-only'}, dumpBefore: 'original-private-dump'}; },
    begin: () => {
      calls.push('begin'); readOnlineRollingRetentions('/rolling', memory.io, '/legacy');
      if (memory.directories.has(dir)) throw Error('attempt_exists');
      memory.directories.add(dir);
    },
    write: (name, value) => {
      calls.push('write:' + name); if (writes.has(name)) throw Error('duplicate_write');
      writes.set(name, value); memory.files.set(dir + '/' + name, value);
    },
    stop: async id => { assert.equal(id, first.victim.pmId); assert.equal(signals, 0);
      signals++; calls.push('stop:' + id); },
    save: async () => { calls.push('save'); },
    verifyPersisted: async () => { calls.push('verify-dump'); },
  };
  return {first, after, memory, calls, operations, writes, dir, signals: () => signals};
}
test('empty new history preserves the immutable legacy certificates and all five raw byte digests', () => {
  const h = harness(), history = readOnlineRollingRetentions('/rolling', h.memory.io, '/legacy');
  assert.deepEqual(history, h.first.history); assert.equal(history.entries.length, 0);
  h.memory.directories.delete('/rolling');
  assert.deepEqual(readOnlineRollingRetentions('/rolling', h.memory.io, '/legacy'), history);
});
test('one bounded stop creates independently verified preparation, recovery, before, after and certificate', async () => {
  const h = harness(), cert = await executeOnlineRolling(h.operations, h.first);
  assert.deepEqual(h.calls, ['wait', 'observe-running', 'recovery', 'begin', 'write:prepared.json', 'write:before.json',
    'write:recovery-pm2.json', 'observe-running', 'final-check', 'stop:4', 'observe-stopped', 'save', 'verify-dump',
    'observe-stopped', 'write:after.json', 'write:certificate.json']);
  assert.equal(h.signals(), 1); assert.equal(h.writes.size, 5);
  assert.deepEqual(readOnlineRollingRetentions('/rolling', h.memory.io, '/legacy').entries, [cert]);
  assert.equal(h.writes.get('certificate.json'), rollingCanonicalText(cert));
  assert.equal(h.writes.get('certificate.json').includes('recovery-only'), false);
  assert.equal(h.writes.get('certificate.json').includes('original-private-dump'), false);
  await assert.rejects(executeOnlineRolling(h.operations, h.first)); assert.equal(h.signals(), 1);
});
test('different unrelated traffic between observations does not invent traffic for the victim', async () => {
  const h = harness(), observe = h.operations.observe;
  h.operations.observe = async frozen => {
    const result = await observe(frozen); result.established = [{state: 'ESTAB', localPort: 3110, peerPort: 45678, pids: [1010]}]; return result;
  };
  await executeOnlineRolling(h.operations, h.first); assert.equal(h.signals(), 1);
});
for (const [label, change] of [
  ['victim pid replacement', value => { value.processes.find(item => item.name === value.victim.name).pid++; }],
  ['PM2 id replacement', value => { value.processes.find(item => item.name === value.victim.name).pmId++; }],
  ['daemon restart', value => { value.daemon.fact.startTicks = '888'; }],
  ['PID recycled', value => { value.identityProofs.find(item => item.name === value.victim.name).startTicks = '888'; }],
  ['new outgoing work', value => value.established.push({localPort: 50000, peerPort: 5432, pids: [1004]})],
  ['new incoming work', value => value.established.push({localPort: 3104, peerPort: 50000, pids: []})],
  ['new child', value => { value.victimChildren = '987'; }],
  ['last nginx reference', value => { value.nginxConfig += '# 3104'; }],
]) test('immediate final check rejects ' + label + ' without sending a stop', async () => {
  const h = harness(); h.operations.finalCheck = async () => { const last = clone(h.first); change(last); return last; };
  await assert.rejects(executeOnlineRolling(h.operations, h.first), /online_rolling_/);
  assert.equal(h.signals(), 0); assert.equal(h.writes.has('certificate.json'), false);
  assert.throws(() => readOnlineRollingRetentions('/rolling', h.memory.io, '/legacy'), /history_files_incomplete/);
  await assert.rejects(executeOnlineRolling(h.operations, h.first)); assert.equal(h.signals(), 0);
});
for (const step of ['stop', 'save', 'verifyPersisted']) test('failure at ' + step + ' keeps recovery and never certifies or retries the stop', async () => {
  const h = harness(), original = h.operations[step];
  h.operations[step] = async (...args) => { if (step === 'stop') await original(...args); throw Error('injected_failure'); };
  await assert.rejects(executeOnlineRolling(h.operations, h.first), /injected_failure/);
  assert.equal(h.signals(), 1); assert.equal(h.writes.has('certificate.json'), false);
  assert.ok(h.writes.has('recovery-pm2.json'));
  assert.throws(() => readOnlineRollingRetentions('/rolling', h.memory.io, '/legacy'), /history_files_incomplete/);
  await assert.rejects(executeOnlineRolling(h.operations, h.first)); assert.equal(h.signals(), 1);
});
test('a skipped stop never reaches save or completion evidence', async () => {
  const h = harness(); h.operations.stop = async () => { h.calls.push('skipped-stop'); };
  await assert.rejects(executeOnlineRolling(h.operations, h.first), /process_identity_changed/);
  assert.ok(!h.calls.includes('save')); assert.equal(h.writes.has('certificate.json'), false);
});
test('post-save unrelated drift cannot become a completed certificate', async () => {
  const h = harness(), observe = h.operations.observe; let stoppedReads = 0;
  h.operations.observe = async frozen => {
    const result = await observe(frozen);
    if (frozen && ++stoppedReads === 2) result.processes.find(item => item.name === ROLLING_BASE_NAMES[0]).environmentSha256 = 'f'.repeat(64);
    return result;
  };
  await assert.rejects(executeOnlineRolling(h.operations, h.first), /process_identity_changed/);
  assert.equal(h.signals(), 1); assert.equal(h.writes.has('certificate.json'), false);
});
test('changed second observation or wrong recovery stops before writing or signaling', async () => {
  for (const kind of ['observation', 'recovery']) {
    const h = harness();
    if (kind === 'observation') h.operations.observe = async () => ({...clone(h.first), daemon: {fact: {pid: 99}, killSignal: 'SIGINT'}});
    else h.operations.recovery = async () => ({process: raw(sha('f'), 3105, 5)});
    await assert.rejects(executeOnlineRolling(h.operations, h.first), /online_rolling_/);
    assert.equal(h.signals(), 0); assert.equal(h.writes.size, 0);
  }
});
test('every missing, unexpected, symlinked, writable or wrong-owner private file blocks history', async () => {
  const h = harness(); await executeOnlineRolling(h.operations, h.first);
  for (const name of ['prepared.json', 'before.json', 'after.json', 'recovery-pm2.json', 'certificate.json']) {
    const path = h.dir + '/' + name, original = h.memory.files.get(path);
    h.memory.files.delete(path); assert.throws(() => readOnlineRollingRetentions('/rolling', h.memory.io, '/legacy'), /history_files_incomplete/);
    h.memory.files.set(path, original);
    for (const override of [{uid: 1}, {nlink: 2}, {mode: 0o100644}, {isSymbolicLink: () => true}]) {
      h.memory.overrides.set(path, override);
      assert.throws(() => readOnlineRollingRetentions('/rolling', h.memory.io, '/legacy'), /unsafe_file/);
    }
    h.memory.overrides.delete(path);
  }
  for (const dir of ['/rolling', h.dir]) {
    h.memory.overrides.set(dir, {mode: 0o40755});
    assert.throws(() => readOnlineRollingRetentions('/rolling', h.memory.io, '/legacy'), /unsafe_directory/);
    h.memory.overrides.delete(dir);
  }
  h.memory.files.set(h.dir + '/unexpected.json', '{}');
  assert.throws(() => readOnlineRollingRetentions('/rolling', h.memory.io, '/legacy'), /history_files_incomplete/);
});
test('all proof bytes and predecessor history remain immutable, including semantically equivalent legacy edits', async () => {
  const h = harness(); await executeOnlineRolling(h.operations, h.first);
  for (const name of ['prepared.json', 'before.json', 'after.json', 'recovery-pm2.json', 'certificate.json']) {
    const path = h.dir + '/' + name, original = h.memory.files.get(path);
    h.memory.files.set(path, original + ' ');
    assert.throws(() => readOnlineRollingRetentions('/rolling', h.memory.io, '/legacy'), /online_rolling_/);
    h.memory.files.set(path, original);
  }
  const path = '/legacy/certificate.json', original = h.memory.files.get(path);
  h.memory.files.set(path, original + ' ');
  assert.throws(() => readOnlineRollingRetentions('/rolling', h.memory.io, '/legacy'), /history_prefix_changed/);
  h.memory.files.set(path, original);
  // Even a coherently rehashed old recovery/prepared pair cannot replace history.
  const oldRecovery = h.memory.files.get('/legacy/recovery-pm2.json'), oldPrepared = h.memory.files.get('/legacy/prepared.json');
  const changed = JSON.parse(oldRecovery); changed.dumpBefore = 'tampered-private-dump';
  h.memory.files.set('/legacy/recovery-pm2.json', text(changed));
  const prepared = JSON.parse(oldPrepared); prepared.recoverySha256 = digest(text(changed));
  h.memory.files.set('/legacy/prepared.json', text(prepared));
  assert.throws(() => readOnlineRollingRetentions('/rolling', h.memory.io, '/legacy'), /history_prefix_changed/);
});
test('unknown directories, partial other targets, replayed certificate and forked directories block publication', async () => {
  const h = harness(); await executeOnlineRolling(h.operations, h.first);
  for (const dir of ['/rolling/unknown', '/rolling/' + sha('2')]) {
    h.memory.directories.add(dir);
    assert.throws(() => readOnlineRollingRetentions('/rolling', h.memory.io, '/legacy'), /online_rolling_/);
    h.memory.directories.delete(dir);
  }
  const second = '/rolling/' + sha('2'); h.memory.directories.add(second);
  for (const [name, value] of h.writes) h.memory.files.set(second + '/' + name, value);
  assert.throws(() => readOnlineRollingRetentions('/rolling', h.memory.io, '/legacy'), /history_directory_changed/);
});
test('two completed generations verify every prior proof, and a changed predecessor cannot authorize a new context', async () => {
  const h = harness(); await executeOnlineRolling(h.operations, h.first);
  const prior = readOnlineRollingRetentions('/rolling', h.memory.io, '/legacy');
  const before = plan(prior, [...h.after.processes, normalizeRetirementProcess(raw(sha('1'), 3104, 12))],
    sha('f'), sha('2'), [sha('1'), sha('d'), sha('a')]);
  const after = stopped(before), dir = '/rolling/' + before.toolRevision; let signals = 0;
  const operations = {
    observe: async frozen => clone(frozen && signals ? after : before), finalCheck: async () => clone(before),
    wait: async () => {}, now: () => '2026-09-27T19:24:00.000Z',
    recovery: async () => ({process: raw(sha('f'), 3105, 5), runtime: {}}),
    begin: () => { readOnlineRollingRetentions('/rolling', h.memory.io, '/legacy');
      assert.equal(h.memory.directories.has(dir), false); h.memory.directories.add(dir); },
    write: (name, value) => { assert.equal(h.memory.files.has(dir + '/' + name), false); h.memory.files.set(dir + '/' + name, value); },
    stop: async id => { assert.equal(id, 5); assert.equal(signals++, 0); }, save: async () => {}, verifyPersisted: async () => {},
  };
  await executeOnlineRolling(operations, before);
  const history = readOnlineRollingRetentions('/rolling', h.memory.io, '/legacy');
  assert.equal(history.entries.length, 2); assert.equal(history.entries[1].previousSha256, prior.headSha256);
  assert.equal(signals, 1);
  const path = h.dir + '/certificate.json', original = h.memory.files.get(path), altered = JSON.parse(original);
  altered.completedAt = '2026-09-27T19:21:59.000Z'; h.memory.files.set(path, rollingCanonicalText(altered));
  assert.throws(() => readOnlineRollingRetentions('/rolling', h.memory.io, '/legacy'), /history_prefix_changed/);
});
test('controller contract only stops an exact PM2 id and keeps legacy proof/source files untouched', () => {
  const source = readFileSync(new URL('./online-release-rolling.mjs', import.meta.url), 'utf8');
  assert.match(source, /run\('pm2', \['stop', String\(pmId\)\]\)/);
  assert.match(source, /openSync\(location, 'wx', 0o600\)/);
  assert.match(source, /fs\.fsyncSync/);
  assert.match(source, /FAOLLA_ONLINE_ROLLING_LOCKED/);
  assert.match(source, /operation\.lock/);
  assert.doesNotMatch(source, /run\('pm2', \['(?:delete|restart|reload|kill)'/);
  assert.doesNotMatch(source, /unlinkSync|rmSync|chmodSync|chownSync|truncateSync/);
  assert.doesNotMatch(source, /buildText\.trim\(\) !== item\.target/);
});
