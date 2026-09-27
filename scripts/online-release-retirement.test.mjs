import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {normalizeRetirementProcess, parseRetirementSockets, readOnlineRetirementCertificates,
  executeOnlineRetirement, assertRetirementExecutable, assertExistingPm2Directory} from './online-release-retirement.mjs';

const clone = value => structuredClone(value);
const sha = value => value.repeat(40);
const digest = value => createHash('sha256').update(value).digest('hex');
const name = target => `merchant-space-online-${target.slice(0, 12)}`;
const cwd = target => `/www/wwwroot/merchant-space.web-releases/${target.slice(0, 12)}-online`;
const location = (target, port) => ({target, name: name(target), directory: cwd(target), port});
function raw(target = sha('c'), port = 3103, id = 3) {
  return {name: name(target), pm_id: id, pid: id + 1000, pm2_env: {
    name: name(target), pm_id: id, status: 'online', pm_cwd: cwd(target), pm_exec_path: `${cwd(target)}/node_modules/next/dist/bin/next`,
    args: ['start', '-H', '127.0.0.1', '-p', String(port)], exec_interpreter: '/usr/bin/node', exec_mode: 'fork_mode',
    PORT: String(port), watch: false, cron_restart: false, FAOLLA_BACKGROUND_JOBS_PAUSED: '1',
    MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED: '0', MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED: '0',
    env: {PRIVATE_TOKEN: 'synthetic-never-print', PORT: String(port)}, created_at: 123, restart_time: 0,
  }};
}
function fixture() {
  const victimRaw = raw(), victim = normalizeRetirementProcess(victimRaw);
  const active = location(sha('a'), 3110), rollback = location(sha('b'), 3109);
  return {victim: {target: sha('c'), name: victim.name, pmId: victim.pmId, pid: victim.pid, cwd: victim.cwd, port: victim.port},
    active, rollback, toolRevision: sha('d'),
    sourceState: {status: 'active', target: sha('c'), name: victim.name, directory: victim.cwd, port: 3103,
      sourceHead: sha('c'), buildId: sha('c')},
    sourceClean: true, maintenanceEnded: true, priorCertificates: [], protectedNames: [active.name, rollback.name],
    processes: [victim, normalizeRetirementProcess(raw(sha('b'), 3109, 9)), normalizeRetirementProcess(raw(sha('a'), 3110, 10))],
    listeners: [{address: '127.0.0.1', port: 3103, pid: 1003}, {address: '127.0.0.1', port: 3110, pid: 1010}],
    established: [], nginxConfig: 'server { proxy_pass http://127.0.0.1:3110; }',
  };
}
function stopped(before) {
  const after = clone(before); after.processes[0].pid = 0; after.processes[0].status = 'stopped';
  after.listeners = after.listeners.filter(item => item.pid !== before.victim.pid);
  return after;
}
function harness() {
  const first = fixture(), after = stopped(first), calls = [], writes = new Map(); let signal = false;
  const operations = {
    observe: async frozen => { calls.push(frozen ? 'observe-stopped' : 'observe-running'); return clone(frozen ? after : first); },
    wait: async ms => { assert.equal(ms, 2000); calls.push('wait'); },
    now: () => '2026-09-27T19:20:00.000Z',
    recovery: async () => { calls.push('recovery'); return {process: raw(), runtime: {PRIVATE_TOKEN: 'synthetic'}}; },
    begin: () => { calls.push('begin'); },
    write: (name, text) => { if (writes.has(name)) throw Error('duplicate_write'); writes.set(name, text); calls.push(`write:${name}`); },
    stop: async id => { assert.equal(id, 3); assert.equal(signal, false); signal = true; calls.push('stop:3'); },
    save: async () => { calls.push('save'); },
    verifyPersisted: async () => { calls.push('verify-dump'); },
  };
  return {first, after, calls, writes, operations};
}
function fakeIo(files, changes = {}) {
  return {
    existsSync: path => path === '/private' || files.has(path.slice('/private/'.length)),
    readdirSync: () => [...files.keys()],
    readFileSync: path => files.get(path.slice('/private/'.length)),
    lstatSync: path => {
      const isFile = path.startsWith('/private/');
      return {isFile: () => isFile, isDirectory: () => !isFile, isSymbolicLink: () => false, uid: 0,
        nlink: 1, mode: isFile ? 0o100600 : 0o40700, ...(changes[path] ?? {})};
    },
  };
}

test('stable PM2 normalization excludes secrets and telemetry but pins restart identity', () => {
  const process = raw(), before = normalizeRetirementProcess(process);
  assert.equal(JSON.stringify(before).includes('synthetic-never-print'), false);
  process.monit = {memory: 100000, cpu: 50}; process.pm2_env.axm_monitor = {unstable: 42};
  assert.deepEqual(normalizeRetirementProcess(process), before);
  process.pm2_env.env.PRIVATE_TOKEN = 'changed';
  assert.notEqual(normalizeRetirementProcess(process).environmentSha256, before.environmentSha256);
  const withoutPort = raw(); delete withoutPort.pm2_env.PORT; delete withoutPort.pm2_env.env.PORT;
  assert.equal(normalizeRetirementProcess(withoutPort).port, 3103);
  withoutPort.pm2_env.args = []; assert.equal(normalizeRetirementProcess(withoutPort).port, null);
  assert.deepEqual(JSON.parse(JSON.stringify(before)), before);
});

test('normalization rejects malformed PM2 and port identities', () => {
  for (const change of [value => { value.pm_id = '3'; }, value => { value.pid = -1; },
    value => { value.pm2_env.pmx_module = true; }, value => { value.pm2_env.PORT = '3103;stop'; },
    value => { value.pm2_env.PORT = '65536'; }, value => { value.pm2_env.args = 'start'; }]) {
    const value = raw(); change(value); assert.throws(() => normalizeRetirementProcess(value), /online_retirement_/);
  }
});

test('only the exact original Next loopback command and OS interpreter can retire', () => {
  const process = normalizeRetirementProcess(raw()), fact = {cwd: process.cwd, executable: '/usr/bin/node'};
  assert.doesNotThrow(() => assertRetirementExecutable(process, fact, '/usr/bin/node'));
  for (const change of [value => { value.executable = '/tmp/unrelated.js'; }, value => { value.args = ['start']; },
    value => { value.args[2] = '0.0.0.0'; }, value => { value.args[4] = '3110'; },
    value => { value.nodeArgs = ['--require', '/tmp/hook']; }, value => { value.execMode = 'cluster_mode'; },
    value => { value.interpreter = 'node'; }]) {
    const value = clone(process); change(value);
    assert.throws(() => assertRetirementExecutable(value, fact, '/usr/bin/node'), /victim_executable_changed/);
  }
  assert.throws(() => assertRetirementExecutable(process, {...fact, executable: '/other/node'}, '/usr/bin/node'), /victim_executable_changed/);
  assert.throws(() => assertRetirementExecutable(process, {...fact, cwd: '/other'}, '/usr/bin/node'), /victim_executable_changed/);
});

test('full ss parser handles multiple owners and IPv6; preserves outgoing PID evidence', () => {
  const sockets = parseRetirementSockets(
    'LISTEN 0 511 127.0.0.1:3103 0.0.0.0:* users:(("next",pid=1003,fd=1))\n' +
    'LISTEN 0 511 [::]:443 [::]:* users:(("nginx",pid=55,fd=1),("nginx",pid=54,fd=1))\n',
    'ESTAB 0 0 127.0.0.1:45678 127.0.0.1:5432 users:(("next",pid=1003,fd=19))\n');
  assert.equal(sockets.listeners.length, 3);
  assert.ok(sockets.listeners.some(item => item.address === '::' && item.pid === 54));
  assert.deepEqual(sockets.established[0].pids, [1003]);
  assert.equal(sockets.established[0].localPort, 45678);
});

test('ss parser rejects unknown listener owner, bad endpoints and malformed rows', () => {
  for (const line of ['LISTEN 0 511 127.0.0.1:3103 0.0.0.0:*', 'LISTEN 0 1 bad endpoint',
    'LISTEN 0 1 127.0.0.1:0 0.0.0.0:* users:(("x",pid=4,fd=1))']) {
    assert.throws(() => parseRetirementSockets(line, ''), /online_retirement_/);
  }
  assert.throws(() => parseRetirementSockets('', 'ESTAB 0 0 127.0.0.1:1234 *:*'), /connection_evidence_invalid/);
});

test('retirement executes one stop only after durable evidence; completion follows independent save readback', async () => {
  const h = harness(), certificate = await executeOnlineRetirement(h.operations, h.first);
  assert.deepEqual(h.calls, ['wait', 'observe-running', 'recovery', 'begin', 'write:prepared.json', 'write:before.json',
    'write:recovery-pm2.json', 'observe-running', 'stop:3', 'observe-stopped', 'save', 'verify-dump',
    'observe-stopped', 'write:after.json', 'write:certificate.json']);
  assert.equal(certificate.beforeSha256, digest(h.writes.get('before.json')));
  assert.equal(certificate.afterSha256, digest(h.writes.get('after.json')));
  assert.deepEqual(readOnlineRetirementCertificates('/private', fakeIo(h.writes)), [certificate]);
});

test('new unrelated requests between observations do not create false idle evidence for victim', async () => {
  const h = harness(), original = h.operations.observe;
  h.operations.observe = async frozen => { const result = await original(frozen); result.established = [{localPort: 3110, peerPort: 22222}]; return result; };
  await executeOnlineRetirement(h.operations, h.first);
  assert.equal(h.calls.filter(item => item === 'stop:3').length, 1);
});

test('observation drift or non-idle victim cannot reach signal or write a certificate', async () => {
  for (const change of [value => { value.processes[1].pid++; }, value => { value.nginxConfig += '\n# drift'; },
    value => { value.established.push({localPort: 3103, peerPort: 54321}); }]) {
    const h = harness(); h.operations.observe = async () => { const result = clone(h.first); change(result); return result; };
    await assert.rejects(executeOnlineRetirement(h.operations, h.first), /online_retirement_/);
    assert.equal(h.calls.includes('stop:3'), false); assert.equal(h.writes.size, 0);
  }
});

test('the final pre-signal observation rejects late change with prepared evidence preserved', async () => {
  const h = harness(), original = h.operations.observe; let count = 0;
  h.operations.observe = async frozen => { const value = await original(frozen); if (++count === 2) value.processes[1].pid++; return value; };
  await assert.rejects(executeOnlineRetirement(h.operations, h.first), /observations_changed/);
  assert.equal(h.calls.includes('stop:3'), false); assert.equal(h.writes.has('prepared.json'), true);
  assert.equal(h.writes.has('certificate.json'), false);
});

test('write failures stop before signal; mutation failure never retries or creates completion', async () => {
  for (const failure of ['write:prepared.json', 'write:before.json', 'write:recovery-pm2.json', 'stop', 'save', 'verifyPersisted']) {
    const h = harness();
    if (failure.startsWith('write:')) {
      const original = h.operations.write; h.operations.write = (name, text) => {
        if (`write:${name}` === failure) throw Error('injected_failure'); original(name, text);
      };
    } else h.operations[failure] = async () => { h.calls.push(`failed:${failure}`); throw Error('injected_failure'); };
    await assert.rejects(executeOnlineRetirement(h.operations, h.first), /injected_failure/);
    assert.equal(h.writes.has('certificate.json'), false);
    assert.ok(h.calls.filter(item => item === 'stop:3' || item === 'failed:stop').length <= 1);
    if (failure.startsWith('write:')) assert.equal(h.calls.includes('stop:3'), false);
  }
});

test('post-stop protected identity changes cannot be certified or silently restored', async () => {
  const h = harness(), original = h.operations.observe;
  h.operations.observe = async frozen => { const value = await original(frozen); if (frozen) value.processes[1].pid++; return value; };
  await assert.rejects(executeOnlineRetirement(h.operations, h.first), /unrelated_process_changed/);
  assert.equal(h.calls.includes('save'), false); assert.equal(h.writes.has('certificate.json'), false);
});

test('certificate reader rejects incomplete, insecure, changed or unrelated evidence', async () => {
  const h = harness(); await executeOnlineRetirement(h.operations, h.first);
  for (const missing of h.writes.keys()) {
    const files = new Map(h.writes); files.delete(missing);
    assert.throws(() => readOnlineRetirementCertificates('/private', fakeIo(files)), /certificate_files_incomplete/);
  }
  for (const mode of [0o100644, 0o100660, 0o100400]) {
    assert.throws(() => readOnlineRetirementCertificates('/private', fakeIo(h.writes,
      {'/private/before.json': {mode}})), /unsafe_file/);
  }
  for (const changes of [{uid: 1}, {nlink: 2}, {isSymbolicLink: () => true}, {isFile: () => false}]) {
    assert.throws(() => readOnlineRetirementCertificates('/private', fakeIo(h.writes,
      {'/private/certificate.json': changes})), /unsafe_file/);
  }
  const bad = new Map(h.writes); bad.set('before.json', bad.get('before.json') + ' ');
  assert.throws(() => readOnlineRetirementCertificates('/private', fakeIo(bad)), /certificate_proof_changed/);
  const recovery = new Map(h.writes); recovery.set('recovery-pm2.json', '{}');
  assert.throws(() => readOnlineRetirementCertificates('/private', fakeIo(recovery)), /certificate_preparation_changed/);
  const extra = new Map(h.writes); extra.set('unknown.json', '{}');
  assert.throws(() => readOnlineRetirementCertificates('/private', fakeIo(extra)), /certificate_files_incomplete/);
  const changedStopped = new Map(h.writes), changedCert = JSON.parse(changedStopped.get('certificate.json'));
  changedCert.stoppedProcess.executable = '/other/script'; changedStopped.set('certificate.json', JSON.stringify(changedCert));
  assert.throws(() => readOnlineRetirementCertificates('/private', fakeIo(changedStopped)), /certificate_stopped_process_changed/);
});

test('rehashed malformed completion or different target is not certificate authority', async () => {
  const h = harness(); await executeOnlineRetirement(h.operations, h.first);
  const files = new Map(h.writes), certificate = JSON.parse(files.get('certificate.json'));
  certificate.nextTarget = sha('e'); certificate.allowedActiveTargets[2] = sha('e');
  files.set('certificate.json', JSON.stringify(certificate));
  assert.throws(() => readOnlineRetirementCertificates('/private', fakeIo(files)), /certificate_anchors_changed/);
  const altered = new Map(h.writes), after = JSON.parse(altered.get('after.json'));
  after.processes[0].status = 'online'; after.processes[0].pid = 2000;
  altered.set('after.json', JSON.stringify(after));
  const cert = JSON.parse(altered.get('certificate.json')); cert.afterSha256 = digest(altered.get('after.json'));
  altered.set('certificate.json', JSON.stringify(cert));
  assert.throws(() => readOnlineRetirementCertificates('/private', fakeIo(altered)), /victim_not_stopped/);
});

test('missing retirement root returns no exception authority and does not mutate filesystem', () => {
  const io = {existsSync: () => false}; assert.deepEqual(readOnlineRetirementCertificates('/absent', io), []);
});

test('existing PM2 0755 under root-owned 0550 ancestor is accepted without weakening private proof modes', () => {
  const observed = [], io = {lstatSync: path => {
    observed.push(path);
    return {uid: 0, mode: path === '/root' ? 0o40550 : 0o40755,
      isDirectory: () => true, isSymbolicLink: () => false};
  }};
  assert.doesNotThrow(() => assertExistingPm2Directory('/root/.pm2', io));
  assert.deepEqual(observed, ['/root', '/root/.pm2']);
  for (const target of ['/root', '/root/.pm2']) for (const change of [
    {uid: 1}, {mode: 0o40775}, {mode: 0o40757}, {isSymbolicLink: () => true}, {isDirectory: () => false},
  ]) {
    const unsafe = {lstatSync: path => ({...io.lstatSync(path), ...(path === target ? change : {})})};
    assert.throws(() => assertExistingPm2Directory('/root/.pm2', unsafe), /unsafe_directory/);
  }
  assert.throws(() => readOnlineRetirementCertificates('/private', fakeIo(new Map(),
    {'/private': {mode: 0o40755}})), /unsafe_directory/);
});

test('adapter keeps signal authority bounded and import side-effect free', () => {
  const source = readFileSync(new URL('./online-release-retirement.mjs', import.meta.url), 'utf8');
  assert.match(source, /run\('pm2', \['stop', String\(pmId\)\]\)/);
  assert.doesNotMatch(source, /run\('pm2', \['(?:delete|restart|reload|start|resurrect|kill)'/);
  assert.doesNotMatch(source, /unlinkSync|rmSync|chmodSync|chownSync|SIGKILL|--kill-timeout/);
  assert.match(source, /FAOLLA_ONLINE_RETIREMENT_LOCKED/);
  assert.match(source, /operation\.lock/);
  assert.match(source, /if \(process\.argv\[1\].*fileURLToPath\(import\.meta\.url\)/);
  assert.match(source, /victim_outgoing_connections_present/);
  assert.match(source, /fs\.existsSync\(`\/proc\/\$\{victim\.pid\}`\)/);
  assert.match(source, /status: 'eligible-not-stopped'/);
});
