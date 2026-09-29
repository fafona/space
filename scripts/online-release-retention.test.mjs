import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {constants, readFileSync} from 'node:fs';
import {readOnlineRetentionHistory, ONLINE_RETENTION_FILES, buildOnlineRetentionPreparation,
  buildOnlineRetentionReceipt} from './online-release-retention.mjs';
import {ONLINE_RETENTION_POLICY, retentionHash, retentionCanonicalText,
  createOnlineRetentionHistory, onlineRetentionHeadRecord} from './online-release-retention-policy.mjs';
import {readOnlineRollingRetentions} from './online-release-rolling.mjs';
import {normalizeRetirementProcess} from './online-release-retirement.mjs';
import {ROLLING_BASE_NAMES, rollingCanonicalText} from './online-release-rolling-policy.mjs';
import {WEB_RELEASE_FILES} from './web-presentation-release-policy.mjs';

// The real v2 reader calls the unchanged real rolling and legacy readers. All
// host observations below are synthetic evidence; no process, provider, real
// filesystem mutation, network request, or operational controller is invoked.
const clone = value => structuredClone(value);
const hash = value => createHash('sha256').update(value).digest('hex');
const sha = value => value.repeat(40), digest = value => value.repeat(64);
const nameOf = target => `merchant-space-online-${target.slice(0, 12)}`;
const directoryOf = target => `/www/wwwroot/merchant-space.web-releases/${target.slice(0, 12)}-online`;
const location = (target, port) => ({target, name: nameOf(target), directory: directoryOf(target), port});
const legacyText = value => JSON.stringify(value, null, 2) + '\n';
const canonical = retentionCanonicalText;

function raw(target, port, id) {
  return {name: nameOf(target), pm_id: id, pid: 1000 + id, pm2_env: {
    status: 'online', pm_cwd: directoryOf(target), PORT: String(port),
    pm_exec_path: `${directoryOf(target)}/node_modules/next/dist/bin/next`, exec_interpreter: '/usr/bin/node',
    args: ['start', '-H', '127.0.0.1', '-p', String(port)], node_args: [], exec_mode: 'fork_mode',
    watch: false, cron_restart: null, FAOLLA_BACKGROUND_JOBS_PAUSED: '1',
    MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED: '0', MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED: '0',
    restart_time: 0, created_at: 123, shutdown_with_message: false, env: {PORT: String(port), PRIVATE: 'synthetic-only'},
  }};
}
function legacyFixture(extraRows = []) {
  const raws = [raw(sha('c'), 3103, 3), raw(sha('a'), 3110, 10), raw(sha('b'), 3109, 9), ...extraRows];
  ROLLING_BASE_NAMES.forEach((name, index) => {
    const item = raw(sha('9'), 3000 + index, 20 + index);
    item.name = name; item.pm2_env.pm_cwd = '/base/' + name;
    item.pm2_env.pm_exec_path = item.pm2_env.pm_cwd + '/node_modules/next/dist/bin/next'; raws.push(item);
  });
  const processes = raws.map(normalizeRetirementProcess), p = processes[0];
  const victim = {target: sha('c'), name: p.name, cwd: p.cwd, pmId: p.pmId, pid: p.pid, port: p.port};
  const before = {victim, active: location(sha('a'), 3110), rollback: location(sha('b'), 3109), toolRevision: sha('d'),
    sourceState: {...location(sha('c'), 3103), status: 'active', buildId: sha('c'), sourceHead: sha('c')},
    sourceClean: true, maintenanceEnded: true, priorCertificates: [], protectedNames: processes.slice(1).map(p => p.name),
    processes, listeners: processes.map(p => ({address: '127.0.0.1', port: p.port, pid: p.pid})),
    established: [], nginxConfig: 'server { proxy_pass http://127.0.0.1:3110; }'};
  const after = clone(before); after.processes[0] = {...p, pid: 0, status: 'stopped'};
  after.listeners = after.listeners.filter(item => item.pid !== p.pid);
  const recovery = {process: raws[0], runtime: {}, dumpBefore: 'synthetic-private-recovery'};
  const files = new Map([['before.json', legacyText(before)], ['after.json', legacyText(after)], ['recovery-pm2.json', legacyText(recovery)]]);
  files.set('prepared.json', legacyText({version: 1, status: 'prepared', toolRevision: sha('d'), victim,
    beforeSha256: hash(files.get('before.json')), recoverySha256: hash(files.get('recovery-pm2.json')),
    preparedAt: '2026-09-27T19:20:00.000Z'}));
  files.set('certificate.json', legacyText({version: 1, status: 'completed', victim, stoppedProcess: after.processes[0],
    activeTarget: sha('a'), rollbackTarget: sha('b'), nextTarget: sha('d'), allowedActiveTargets: [sha('a'), sha('b'), sha('d')],
    beforeSha256: hash(files.get('before.json')), afterSha256: hash(files.get('after.json')), completedAt: '2026-09-27T19:20:00.000Z'}));
  return {files, raws, processes: after.processes};
}

function memoryFs(legacy) {
  const files = new Map([...legacy].map(([name, value]) => [`/legacy/${name}`, Buffer.from(value)]));
  const directories = new Set(['/', '/legacy', '/rolling']);
  const overrides = new Map(), realpaths = new Map(), inodes = new Map(), fds = new Map(), calls = [];
  let nextInode = 1, nextFd = 10;
  const missing = () => Object.assign(Error('synthetic ENOENT'), {code: 'ENOENT'});
  const stat = location => {
    if (!files.has(location) && !directories.has(location)) throw missing();
    if (!inodes.has(location)) inodes.set(location, nextInode++);
    const isFile = files.has(location);
    return {isDirectory: () => !isFile, isFile: () => isFile, isSymbolicLink: () => false,
      dev: 1, ino: inodes.get(location), uid: 0, nlink: 1, size: isFile ? files.get(location).length : 0,
      mode: isFile ? 0o100600 : 0o40700, mtimeMs: 1000, ctimeMs: 1000, ...(overrides.get(location) ?? {})};
  };
  const io = {
    existsSync: location => files.has(location) || directories.has(location),
    lstatSync(location) {calls.push(['lstat', location]); return stat(location);},
    realpathSync(location) {calls.push(['realpath', location]); stat(location); return realpaths.get(location) ?? location;},
    readdirSync(location) {
      calls.push(['list', location]); if (!directories.has(location)) throw missing();
      const prefix = location === '/' ? '/' : location + '/';
      return [...new Set([...files.keys(), ...directories].filter(key => key !== location && key.startsWith(prefix))
        .map(key => key.slice(prefix.length).split('/')[0]))];
    },
    openSync(location, flags) {
      calls.push(['open', location, flags]);
      assert.equal(flags & (constants.O_WRONLY | constants.O_RDWR | constants.O_CREAT | constants.O_TRUNC), 0);
      const fd = nextFd++; fds.set(fd, {location, stat: stat(location), bytes: Buffer.from(files.get(location))}); return fd;
    },
    fstatSync(fd) {assert.ok(fds.has(fd)); calls.push(['fstat', fds.get(fd).location]); return {...fds.get(fd).stat};},
    readFileSync(location, encoding) {
      if (typeof location === 'number') {
        assert.ok(fds.has(location)); calls.push(['read-fd', fds.get(location).location]); return Buffer.from(fds.get(location).bytes);
      }
      calls.push(['read-path', location]); if (!files.has(location)) throw missing();
      return encoding === 'utf8' ? files.get(location).toString('utf8') : Buffer.from(files.get(location));
    },
    closeSync(fd) {assert.ok(fds.has(fd)); calls.push(['close', fds.get(fd).location]); fds.delete(fd);},
  };
  for (const method of ['writeFileSync', 'unlinkSync', 'rmdirSync', 'rmSync', 'mkdirSync', 'renameSync', 'chmodSync'])
    io[method] = () => assert.fail(`read-only reader must not call ${method}`);
  return {io, files, directories, overrides, realpaths, fds, calls,
    put: (location, value) => files.set(location, Buffer.isBuffer(value) ? value : Buffer.from(value))};
}

function anchor(target, processes) {
  const process = processes.find(p => p.name === nameOf(target));
  return {...location(target, process.port), process: clone(process)};
}
function state(a, previous) {
  return {...location(a.target, a.port), status: 'active', activatedAt: '2026-09-28T10:00:00.000Z',
    ...(previous ? {baseline: previous.target, oldName: previous.name, oldDirectory: previous.directory, oldPort: previous.port} : {})};
}
function observation(history, kind, processes, targets = null) {
  const active = anchor(targets?.[0] ?? (kind === 'initialize' ? sha('a') : sha('f')), processes);
  const rollback = anchor(targets?.[1] ?? (kind === 'initialize' ? sha('b') : sha('a')), processes);
  const victim = kind === 'retire' ? {target: sha('b'), process: clone(processes.find(p => p.name === nameOf(sha('b'))))} : null;
  const activeState = state(active, rollback);
  if (kind === 'converge') activeState.retentionHeadSha256 = history.headSha256;
  const proofAnchors = [active, rollback, ...(victim ? [anchor(victim.target, processes)] : [])];
  return {version: 2, policy: ONLINE_RETENTION_POLICY, kind, sequence: history.entries.length + 1,
    previousSha256: history.headSha256, legacySha256: history.rollingHistory.legacySha256,
    rollingHeadSha256: history.rollingHistory.headSha256, rollingHistorySha256: retentionHash(history.rollingHistory),
    toolRevision: sha('8'), active, rollback, victim, processes: clone(processes),
    sourceClean: true, maintenanceEnded: true, maintenanceSha256: digest('a'), markerSha256: digest('b'),
    baseDirectory: '/synthetic-base', proxyHashes: Object.fromEntries(WEB_RELEASE_FILES.map(name => [name, digest('c')])),
    nginxConfig: `server { proxy_pass http://127.0.0.1:${active.port}; }`,
    activeFile: location(active.target, active.port), activeState,
    releaseProofs: proofAnchors.map(a => {
      const value = a.target === active.target ? activeState : state(a), stateText = JSON.stringify(value);
      return {target: a.target, sourceHead: a.target, sourceClean: true, resolvedInterpreter: '/usr/bin/node', state: value, stateText,
        stateSha256: hash(stateText), buildSha256: digest('d'), runtimeSha256: digest('e'), environmentSha256: digest('f'),
        http: {status: 200, ok: true, buildId: a.target}};
    }),
    listeners: processes.filter(p => p.status === 'online').map(p => ({address: '127.0.0.1', port: p.port, pid: p.pid})),
    established: [], identityProofs: processes.filter(p => p.status === 'online').map(p => ({name: p.name,
      pid: p.pid, cwd: p.cwd, uid: 0, parentPid: 90, startTicks: '12345', executable: '/usr/bin/node',
      commandSha256: digest('c'), environmentSha256: digest('d')})),
    daemon: {fact: {pid: 90, startTicks: '111'}, killSignal: 'SIGINT', killTimeout: 1600},
    resolvedInterpreter: '/usr/bin/node', victimChildren: '',
    victimRuntimeFlags: {backgroundPaused: '1', automationEnabled: '0', invitationEnabled: '0', manualSignalHandle: ''},
    ancestry: [...(victim ? [{older: victim.target, newer: active.target, verified: true}] : []),
      {older: rollback.target, newer: active.target, verified: true}],
  };
}
function addReceipt(memory, history, before, rawVictim = null) {
  const after = clone(before);
  if (before.victim) {
    const victim = before.victim.process;
    after.processes = after.processes.map(p => p.name === victim.name ? {...p, status: 'stopped', pid: 0} : p);
    after.listeners = after.listeners.filter(p => p.pid !== victim.pid);
    after.identityProofs = after.identityProofs.filter(p => p.name !== victim.name);
  }
  const recovery = {version: 2, process: rawVictim};
  const common = Object.fromEntries(['kind', 'sequence', 'previousSha256', 'legacySha256', 'rollingHeadSha256',
    'rollingHistorySha256', 'toolRevision', 'active', 'rollback', 'victim'].map(key => [key, before[key]]));
  const prepared = {version: 2, policy: ONLINE_RETENTION_POLICY, status: 'prepared', ...common,
    beforeSha256: hash(canonical(before)), recoverySha256: hash(canonical(recovery)), preparedAt: '2026-09-28T11:00:00.000Z'};
  const certificate = {version: 2, policy: ONLINE_RETENTION_POLICY, status: 'completed', ...common,
    processes: after.processes, stoppedProcess: before.victim ? after.processes.find(p => p.name === before.victim.process.name) : null,
    beforeSha256: prepared.beforeSha256, afterSha256: hash(canonical(after)), recoverySha256: prepared.recoverySha256,
    preparedSha256: hash(canonical(prepared)), completedAt: '2026-09-28T11:01:00.000Z'};
  const directory = '/retention/' + String(before.sequence).padStart(6, '0');
  memory.directories.add('/retention'); memory.directories.add(directory);
  for (const [name, value] of Object.entries({'prepared.json': prepared, 'before.json': before, 'after.json': after,
    'recovery-pm2.json': recovery, 'certificate.json': certificate})) memory.put(`${directory}/${name}`, canonical(value));
  history.entries.push(clone(certificate)); history.headSha256 = retentionHash(certificate);
  memory.put('/retention.head.json', canonical(onlineRetentionHeadRecord(history)));
  return {certificate, before, after, directory};
}
function fixture(kinds = ['initialize', 'converge', 'retire']) {
  const old = legacyFixture(), memory = memoryFs(old.files);
  const rolling = readOnlineRollingRetentions('/rolling', memory.io, '/legacy');
  const history = createOnlineRetentionHistory(rolling), receipts = [];
  let processes = clone(old.processes);
  for (const kind of kinds) {
    if (kind === 'converge') processes.push(normalizeRetirementProcess(raw(sha('f'), 3105, 6)));
    const entry = addReceipt(memory, history, observation(history, kind, processes), kind === 'retire' ? old.raws[2] : null);
    receipts.push(entry); processes = clone(entry.after.processes);
  }
  memory.calls.length = 0;
  return {...memory, history, receipts, read: () => readOnlineRetentionHistory('/retention', memory.io, '/rolling', '/legacy')};
}
function rewriteBoundProof(f, sequence, filename, change) {
  const directory = '/retention/' + String(sequence).padStart(6, '0');
  const value = JSON.parse(f.files.get(`${directory}/${filename}`)); change(value);
  f.put(`${directory}/${filename}`, canonical(value));
  const certificate = JSON.parse(f.files.get(`${directory}/certificate.json`));
  if (filename === 'recovery-pm2.json') {
    const prepared = JSON.parse(f.files.get(`${directory}/prepared.json`));
    prepared.recoverySha256 = hash(f.files.get(`${directory}/recovery-pm2.json`));
    f.put(`${directory}/prepared.json`, canonical(prepared)); certificate.recoverySha256 = prepared.recoverySha256;
  }
  certificate.preparedSha256 = hash(f.files.get(`${directory}/prepared.json`));
  f.put(`${directory}/certificate.json`, canonical(certificate));
}

test('old retirement and rolling source files retain their original full LF-normalized hashes', () => {
  const expected = {
    'online-release-retirement.mjs': 'd2c051cde588464d16d57b96bbd83bf1f6c8d16da8ab653cd0f22ddb9922639e',
    'online-release-retirement-policy.mjs': 'fd33fd82fe15772f1e0bd6f9673073c6faaaede369da4039c77ac0bf469b1781',
    'online-release-rolling.mjs': 'dbb301ccf2159b03d6d262f7046842697691113148937bafc6166522f1a9af33',
    'online-release-rolling-policy.mjs': '3384c2b1c0dccf22457082c4662ad98bbca627be256c85f162a3a23fc00f2b73',
  };
  for (const [filename, digest] of Object.entries(expected)) assert.equal(hash(readFileSync(new URL(filename, import.meta.url), 'utf8').replace(/\r\n/g, '\n')), digest);
});

test('absent v2 root returns real validated old history; an optional empty rolling root changes no proof', () => {
  const f = fixture([]);
  assert.deepEqual(f.read(), f.history);
  f.directories.delete('/rolling'); assert.deepEqual(f.read(), f.history);
  assert.ok(f.calls.some(([op, filename]) => op === 'read-path' && filename === '/legacy/certificate.json'));
  assert.equal(f.fds.size, 0);
});

test('a complete real rolling-v1 prefix initializes v2 and cannot later change or append invisibly', () => {
  const victimRaw = raw(sha('e'), 3104, 4), old = legacyFixture([victimRaw]), f = memoryFs(old.files);
  const initial = readOnlineRollingRetentions('/rolling', f.io, '/legacy');
  const processes = [...clone(old.processes), normalizeRetirementProcess(raw(sha('d'), 3103, 11))];
  const vp = processes.find(p => p.name === nameOf(sha('e')));
  const victim = {target: sha('e'), name: vp.name, cwd: vp.cwd, pmId: vp.pmId, pid: vp.pid, port: vp.port};
  const base = observation(createOnlineRetentionHistory(initial), 'initialize', processes, [sha('d'), sha('a')]);
  const before = {...base, history: initial, toolRevision: sha('8'), victim,
    protectedAnchors: [sha('d'), sha('a'), sha('b')].map(target => anchor(target, processes)),
    sourceState: {...location(sha('e'), 3104), status: 'active', buildId: sha('e'), sourceHead: sha('e')},
    targetNotStaged: true,
    ancestry: [[sha('e'), sha('b')], [sha('b'), sha('a')], [sha('a'), sha('d')], [sha('d'), sha('8')]]
      .map(([older, newer]) => ({older, newer, verified: true}))};
  const after = clone(before);
  after.processes = after.processes.map(p => p.name === vp.name ? {...p, status: 'stopped', pid: 0} : p);
  after.listeners = after.listeners.filter(p => p.pid !== vp.pid);
  const recovery = {version: 1, process: victimRaw};
  const prepared = {version: 1, status: 'prepared', nextTarget: sha('8'), previousSha256: null,
    legacySha256: initial.legacySha256, sequence: 1, victim,
    beforeSha256: hash(legacyText(before)), recoverySha256: hash(legacyText(recovery)),
    preparedAt: '2026-09-27T20:00:00.000Z'};
  const certificate = {version: 1, policy: 'rolling-v1', status: 'completed', sequence: 1,
    previousSha256: null, legacySha256: initial.legacySha256, victim,
    stoppedProcess: after.processes.find(p => p.name === vp.name), nextTarget: sha('8'),
    protectedAnchors: before.protectedAnchors, allowedActiveTargets: [sha('8'), sha('d'), sha('a'), sha('b')],
    beforeSha256: prepared.beforeSha256, afterSha256: hash(legacyText(after)),
    preparedSha256: hash(legacyText(prepared)), recoverySha256: prepared.recoverySha256,
    completedAt: '2026-09-27T20:01:00.000Z'};
  const directory = '/rolling/' + sha('8'); f.directories.add(directory);
  for (const [name, value] of Object.entries({'before.json': before, 'after.json': after,
    'recovery-pm2.json': recovery, 'prepared.json': prepared, 'certificate.json': certificate}))
    f.put(directory + '/' + name, name === 'certificate.json' ? rollingCanonicalText(value) : legacyText(value));
  const rolling = readOnlineRollingRetentions('/rolling', f.io, '/legacy');
  assert.equal(rolling.entries.length, 1); assert.match(rolling.headSha256, /^[a-f0-9]{64}$/);
  const history = createOnlineRetentionHistory(rolling);
  addReceipt(f, history, observation(history, 'initialize', after.processes, [sha('d'), sha('a')]));
  const read = () => readOnlineRetentionHistory('/retention', f.io, '/rolling', '/legacy');
  assert.deepEqual(read(), history);
  assert.equal(read().entries[0].rollingHeadSha256, rolling.headSha256);
  f.directories.add('/rolling/' + sha('7'));
  assert.throws(read, /history_files_incomplete/); f.directories.delete('/rolling/' + sha('7'));
  const changed = {...certificate, completedAt: '2026-09-27T20:02:00.000Z'};
  f.put(directory + '/certificate.json', rollingCanonicalText(changed));
  assert.notEqual(readOnlineRollingRetentions('/rolling', f.io, '/legacy').headSha256, rolling.headSha256);
  assert.throws(read, /online_retention_/);
  assert.equal(f.fds.size, 0);
});

test('ordinary ancestor timestamp/size/link-count changes do not invalidate the immutable history', () => {
  const f = fixture(['initialize']), lstat = f.io.lstatSync;
  let changes = 0;
  f.io.lstatSync = location => {
    const value = lstat(location);
    return location === '/' ? {...value, mtimeMs: ++changes, ctimeMs: changes, size: changes, nlink: changes} : value;
  };
  assert.deepEqual(f.read(), f.history);
  assert.ok(changes >= 2);
});

test('absent root appearing during read cannot be treated as absent old-only history', () => {
  const f = fixture([]), lstat = f.io.lstatSync;
  let first = true;
  f.io.lstatSync = location => {
    if (location !== '/retention' || !first) return lstat(location);
    first = false;
    try {return lstat(location);} catch (error) {f.directories.add('/retention'); throw error;}
  };
  assert.throws(f.read, /online_retention_/);
  assert.equal(f.fds.size, 0);
});

test('absent root still requires safe owned ancestors and rejects an ancestor path alias', () => {
  for (const override of [{uid: 1}, {mode: 0o40777}, {isSymbolicLink: () => true}, null]) {
    const f = fixture([]); f.directories.add('/new-parent');
    if (override) f.overrides.set('/new-parent', override); else f.realpaths.set('/new-parent', '/elsewhere');
    assert.throws(() => readOnlineRetentionHistory('/new-parent/retention', f.io, '/rolling', '/legacy'),
      /online_retention_(unsafe_path|path_redirected)/);
  }
});

test('initialize, converge and retire receipts compose through all real readers without any write operation', () => {
  const f = fixture(), before = [...f.files].map(([name, value]) => [name, hash(value)]);
  assert.deepEqual(f.read(), f.history);
  assert.deepEqual(f.read().entries.map(c => c.kind), ['initialize', 'converge', 'retire']);
  assert.deepEqual([...f.files].map(([name, value]) => [name, hash(value)]), before);
  assert.equal(f.fds.size, 0);
  assert.equal(f.calls.filter(([op]) => op === 'open').length, 32);
  assert.equal(f.calls.filter(([op]) => op === 'close').length, 32);
  assert.ok(f.calls.filter(([op, filename]) => op === 'read-path' && filename === '/legacy/before.json').length >= 4);
});

test('empty, partial, unknown, gapped and replayed sequence directories never fall back to old history', () => {
  for (const name of ['', '000002', 'unknown', '000001-extra']) {
    const f = fixture([]); f.directories.add('/retention'); if (name) f.directories.add('/retention/' + name);
    assert.throws(f.read, /online_retention_(history_empty|history_entry_invalid|history_files_incomplete)/);
  }
  const f = fixture(['initialize']); f.directories.add('/retention/000002');
  for (const name of ONLINE_RETENTION_FILES) f.put('/retention/000002/' + name, f.files.get('/retention/000001/' + name));
  assert.throws(f.read, /directory_sequence_changed/);
});

for (const name of ONLINE_RETENTION_FILES) {
  test(`missing or extra v2 ${name} fails closed`, () => {
    const f = fixture(['initialize']); f.files.delete('/retention/000001/' + name);
    assert.throws(f.read, /history_files_incomplete/);
    const g = fixture(['initialize']); g.put('/retention/000001/extra.json', '{}\n');
    assert.throws(g.read, /history_files_incomplete/);
  });
  test(`changed ${name} proof binding cannot silently replace a v2 proof`, () => {
    const f = fixture(['initialize']), filename = '/retention/000001/' + name;
    const value = JSON.parse(f.files.get(filename));
    if (name === 'certificate.json') value.version = 3; else value.changed = true;
    f.put(filename, canonical(value));
    assert.throws(f.read, /online_retention_/);
  });
}

test('all four certificate proof hashes are checked, and previous/source-root bindings are immutable', () => {
  for (const field of ['preparedSha256', 'beforeSha256', 'afterSha256', 'recoverySha256', 'legacySha256', 'rollingHistorySha256']) {
    const f = fixture(['initialize']), filename = '/retention/000001/certificate.json';
    const value = JSON.parse(f.files.get(filename)); value[field] = digest('0'); f.put(filename, canonical(value));
    assert.throws(f.read, /online_retention_/);
  }
  const f = fixture(), filename = '/retention/000002/certificate.json';
  const value = JSON.parse(f.files.get(filename)); value.previousSha256 = digest('0'); f.put(filename, canonical(value));
  assert.throws(f.read, /online_retention_/);
});

test('hash-consistent altered preparation still must match the exact context and valid completion time', () => {
  for (const change of [value => {value.extra = true;}, value => {value.toolRevision = sha('7');},
    value => {value.preparedAt = '2026-09-28T12:00:00.000Z';}]) {
    const f = fixture(['initialize']); rewriteBoundProof(f, 1, 'prepared.json', change);
    assert.throws(f.read, /online_retention_(preparation_changed|preparation_time_invalid)/);
  }
});

test('hash-consistent recovery must be null for initialization and exact normalized victim for retirement', () => {
  const f = fixture(['initialize']); rewriteBoundProof(f, 1, 'recovery-pm2.json', value => {value.process = raw(sha('b'), 3109, 9);});
  assert.throws(f.read, /unexpected_recovery_process/);
  const g = fixture(); rewriteBoundProof(g, 3, 'recovery-pm2.json', value => {value.process.pm2_env.env.PRIVATE = 'changed';});
  assert.throws(g.read, /recovery_process_changed/);
  const h = fixture(['initialize']); rewriteBoundProof(h, 1, 'recovery-pm2.json', value => {value.extra = true;});
  assert.throws(h.read, /recovery_invalid/);
});

test('legacy proof changes are rejected by the actual old reader or frozen old root binding', () => {
  for (const name of ONLINE_RETENTION_FILES) {
    const f = fixture(['initialize']), filename = '/legacy/' + name;
    f.put(filename, Buffer.concat([f.files.get(filename), Buffer.from(' ')]));
    assert.throws(f.read, /online_(retention|retirement)_/);
  }
  const f = fixture(['initialize']); f.directories.add('/rolling/' + sha('e'));
  assert.throws(f.read, /online_rolling_history_files_incomplete/);
});

for (const [label, override] of [
  ['owner', {uid: 1}], ['group write', {mode: 0o100620}], ['public mode', {mode: 0o100644}],
  ['symlink', {isSymbolicLink: () => true}], ['hardlink', {nlink: 2}], ['empty', {size: 0}],
  ['oversize', {size: 32 * 1024 * 1024 + 1}], ['special', {isFile: () => false}],
]) test(`private proof rejects ${label}`, () => {
  const f = fixture(['initialize']); f.overrides.set('/retention/000001/before.json', override);
  assert.throws(f.read, /unsafe_path/); assert.equal(f.fds.size, 0);
});

test('root, entry and ancestor owner/mode/link/realpath violations are refused', () => {
  for (const filename of ['/retention', '/retention/000001', '/']) {
    for (const override of [{uid: 1}, {mode: 0o40777}, {isSymbolicLink: () => true}]) {
      const f = fixture(['initialize']); f.overrides.set(filename, override); assert.throws(f.read, /unsafe_path/);
    }
    const f = fixture(['initialize']); f.realpaths.set(filename, '/different'); assert.throws(f.read, /path_redirected/);
  }
});

test('noncanonical whitespace, invalid UTF-8 and duplicate JSON keys are rejected before interpretation', () => {
  for (const change of [bytes => Buffer.concat([bytes, Buffer.from(' ')]), () => Buffer.from([0xff, 0xfe]),
    bytes => Buffer.from(bytes.toString('utf8').replace('"version":2', '"version":2,"version":2'))]) {
    const f = fixture(['initialize']), filename = '/retention/000001/prepared.json'; f.put(filename, change(f.files.get(filename)));
    assert.throws(f.read, /online_retention_(noncanonical_proof|invalid_utf8)/); assert.equal(f.fds.size, 0);
  }
});

test('a UTF-8 BOM on any of the five proof files is rejected rather than silently decoded away', () => {
  for (const name of ONLINE_RETENTION_FILES) {
    const f = fixture(['initialize']), filename = '/retention/000001/' + name;
    f.put(filename, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), f.files.get(filename)]));
    assert.throws(f.read, /online_retention_noncanonical_utf8/);
    assert.equal(f.fds.size, 0);
  }
});

test('opened descriptor identity drift, truncated reads and post-read path replacement close all fds', () => {
  for (const kind of ['descriptor', 'truncated', 'path']) {
    const f = fixture(['initialize']), fstat = f.io.fstatSync, read = f.io.readFileSync;
    if (kind === 'descriptor') f.io.fstatSync = fd => ({...fstat(fd), ino: 999});
    else f.io.readFileSync = (...args) => {
      const value = read(...args);
      if (typeof args[0] !== 'number') return value;
      if (kind === 'path') f.overrides.set(f.fds.get(args[0]).location, {ino: 999});
      return kind === 'truncated' ? value.subarray(1) : value;
    };
    assert.throws(f.read, /online_retention_(file_replaced|file_read_changed)/); assert.equal(f.fds.size, 0);
  }
});

test('post-read fstat drift and read errors close the opened descriptor before failure', () => {
  for (const kind of ['fstat', 'read-error']) {
    const f = fixture(['initialize']), fstat = f.io.fstatSync, read = f.io.readFileSync;
    let observations = 0;
    if (kind === 'fstat') f.io.fstatSync = fd => {
      const value = fstat(fd); return ++observations % 2 === 0 ? {...value, mtimeMs: 2000} : value;
    };
    else f.io.readFileSync = (...args) => {if (typeof args[0] === 'number') throw Error('synthetic_read_error'); return read(...args);};
    assert.throws(f.read, kind === 'fstat' ? /file_changed/ : /synthetic_read_error/);
    assert.equal(f.fds.size, 0);
  }
});

test('new history entries or changed file identity after reading cannot pass the final snapshot check', () => {
  for (const kind of ['listing', 'identity']) {
    const f = fixture(['initialize']), read = f.io.readFileSync;
    f.io.readFileSync = (...args) => {
      const result = read(...args);
      if (typeof args[0] === 'number' && f.fds.get(args[0]).location.endsWith('/certificate.json')) {
        if (kind === 'listing') f.directories.add('/retention/000002');
        else f.overrides.set('/retention/000001/prepared.json', {ino: 999});
      }
      return result;
    };
    assert.throws(f.read, /online_retention_history_(listing|path)_changed/); assert.equal(f.fds.size, 0);
  }
});

test('old source bytes are revalidated after the new proof read rather than trusted from first observation', () => {
  const f = fixture(['initialize']), read = f.io.readFileSync;
  f.io.readFileSync = (...args) => {
    const result = read(...args);
    if (typeof args[0] === 'number' && f.fds.get(args[0]).location.endsWith('/certificate.json'))
      f.put('/legacy/certificate.json', Buffer.concat([f.files.get('/legacy/certificate.json'), Buffer.from(' ')]));
    return result;
  };
  assert.throws(f.read, /legacy_root_changed/); assert.equal(f.fds.size, 0);
});

test('unsafe root aliases and nesting fail before any filesystem observation', () => {
  for (const roots of [['relative', '/rolling', '/legacy'], ['/retention/', '/rolling', '/legacy'],
    ['/retention', '/retention', '/legacy'], ['/retention', '/retention/rolling', '/legacy'],
    ['/legacy/retention', '/rolling', '/legacy'], ['/', '/rolling', '/legacy']]) {
    const f = fixture([]); f.calls.length = 0;
    assert.throws(() => readOnlineRetentionHistory(...[roots[0], f.io, roots[1], roots[2]]), /online_retention_(root_invalid|roots_overlap)/);
    assert.deepEqual(f.calls, []);
  }
});

test('external head refuses missing, altered, extra-field and complete-tail deletion proofs', () => {
  for (const change of [f => {f.files.delete('/retention.head.json');},
    f => {const head = JSON.parse(f.files.get('/retention.head.json')); head.sequence--; f.put('/retention.head.json', canonical(head));},
    f => {const head = JSON.parse(f.files.get('/retention.head.json')); head.headSha256 = digest('0'); f.put('/retention.head.json', canonical(head));},
    f => {const head = JSON.parse(f.files.get('/retention.head.json')); head.extra = true; f.put('/retention.head.json', canonical(head));},
    f => {for (const name of ONLINE_RETENTION_FILES) f.files.delete('/retention/000003/' + name); f.directories.delete('/retention/000003');},
    f => {f.overrides.set('/retention.head.json', {nlink: 2});},
    f => {f.put('/retention.head.json', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), f.files.get('/retention.head.json')]));}]) {
    const f = fixture(); change(f); assert.throws(() => f.read());
  }
  const absent = fixture([]); absent.put('/retention.head.json', canonical({version: 2}));
  assert.throws(() => absent.read(), /orphaned_head/);
});

test('receipt serializers create exactly the five durable files accepted by the real reader', () => {
  const f = fixture([]), before = observation(f.history, 'initialize', f.history.rollingHistory.legacyProcesses);
  const recovery = {version: 2, process: null}, preparedAt = '2026-09-28T11:00:00.000Z', completedAt = '2026-09-28T11:01:00.000Z';
  const frozen = clone(before), preparation = buildOnlineRetentionPreparation(before, recovery, f.history, preparedAt);
  const receipt = buildOnlineRetentionReceipt(before, clone(before), recovery, f.history, {preparedAt, completedAt});
  assert.deepEqual([...receipt.files.keys()].sort(), [...ONLINE_RETENTION_FILES].sort());
  assert.equal(receipt.files.get('prepared.json'), preparation.preparedText);
  assert.equal(receipt.files.get('before.json'), preparation.beforeText);
  assert.equal(receipt.files.get('recovery-pm2.json'), preparation.recoveryText);
  f.directories.add('/retention'); f.directories.add('/retention/000001');
  for (const [file, text] of receipt.files) f.put('/retention/000001/' + file, text);
  const history = {...f.history, entries: [receipt.certificate], headSha256: retentionHash(receipt.certificate)};
  f.put('/retention.head.json', canonical(onlineRetentionHeadRecord(history)));
  assert.deepEqual(f.read(), history); assert.deepEqual(before, frozen);
  assert.throws(() => buildOnlineRetentionPreparation(before, {...recovery, extra: true}, f.history, preparedAt), /recovery_invalid/);
  assert.throws(() => buildOnlineRetentionReceipt(before, clone(before), recovery, f.history,
    {preparedAt, completedAt: '2000-01-01T00:00:00.000Z'}), /preparation_time_invalid/);
});

test('a rollback and new publication proof survives the full immutable reader and binds certificate context', () => {
  const f = fixture(['initialize', 'converge']), latest = f.history.entries.at(-1);
  const proxyFiles = Object.fromEntries(WEB_RELEASE_FILES.map(file => [file, {beforeText: `before ${file}`, afterText: `after ${file}`} ]));
  const failed = {...clone(f.receipts[1].before.activeState), status: 'rolled-back', rolledBackAt: '2026-09-28T11:02:00.000Z',
    retentionRollbackHeadSha256: f.history.headSha256, configs: Object.fromEntries(WEB_RELEASE_FILES.map(file =>
      [file, {oldHash: hash(proxyFiles[file].beforeText), newHash: hash(proxyFiles[file].afterText)}]))};
  const failedStateText = JSON.stringify(failed), rollbackProof = {version: 1, historyHeadSha256: f.history.headSha256,
    from: location(latest.active.target, latest.active.port), to: location(latest.rollback.target, latest.rollback.port),
    activeFile: location(latest.rollback.target, latest.rollback.port), failedStateText, failedStateSha256: hash(failedStateText),
    proxyFiles, proxyHashes: Object.fromEntries(WEB_RELEASE_FILES.map(file => [file, failed.configs[file].oldHash]))};
  const current = [...latest.processes, normalizeRetirementProcess(raw(sha('8'), 3106, 8))];
  const before = observation(f.history, 'converge', current, [sha('8'), latest.rollback.target]);
  before.rollbackProof = rollbackProof; before.activeState.retentionRollbackProof = rollbackProof;
  before.activeState.activatedAt = '2026-09-28T11:03:00.000Z';
  before.releaseProofs[0].state = clone(before.activeState);
  before.releaseProofs[0].stateText = JSON.stringify(before.activeState);
  before.releaseProofs[0].stateSha256 = hash(before.releaseProofs[0].stateText);
  const receipt = buildOnlineRetentionReceipt(before, clone(before), {version: 2, process: null}, f.history,
    {preparedAt: '2026-09-28T11:04:00.000Z', completedAt: '2026-09-28T11:05:00.000Z'});
  f.directories.add('/retention/000003');
  for (const [file, text] of receipt.files) f.put('/retention/000003/' + file, text);
  const history = {...f.history, entries: [...f.history.entries, receipt.certificate], headSha256: retentionHash(receipt.certificate)};
  f.put('/retention.head.json', canonical(onlineRetentionHeadRecord(history)));
  assert.deepEqual(f.read(), history);
  const certificate = clone(receipt.certificate); delete certificate.rollbackProof;
  f.put('/retention/000003/certificate.json', canonical(certificate));
  assert.throws(() => f.read(), /certificate_context_changed/);
});
