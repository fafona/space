import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import {unpublishedCandidateImportClosure, unpublishedCandidateDatabaseSql} from './online-unpublished-candidate.mjs';
import {UNPUBLISHED_CANDIDATE_INCIDENT as incident,
  UNPUBLISHED_CANDIDATE_ABSENT_PATHS as absentPaths,
  UNPUBLISHED_CANDIDATE_PRESERVED_FILES as preservedPaths} from './prepare-online-release-tool.mjs';

const root = new URL('../', import.meta.url);
const readSource = name => fs.readFileSync(new URL(name, root), 'utf8');
const source = readSource('scripts/online-unpublished-candidate.mjs');
const policy = readSource('scripts/prepare-online-release-tool.mjs');
const hash = value => createHash('sha256').update(value).digest('hex');
const plain = value => JSON.parse(JSON.stringify(value));
const fail = code => {throw Error(`online_unpublished_${code}`);};
const equal = (a, b, code) => {try {assert.deepEqual(plain(a), plain(b));} catch {fail(code);}};
function section(start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, `${start} source section`);
  return source.slice(a, b).replace(/^export /gm, '');
}
const processCode = section('function inspectProcessReferences()', 'export function unpublishedCandidateDatabaseSql');
const databaseCode = section('function databaseObservation(', '// A helper-only source bootstrap');
const observeCode = section('async function observe(', 'function durableReceipt(');
const receiptCode = section('function durableReceipt(', 'export async function closeUnpublishedCandidateMain(');
const mainCode = section('export async function closeUnpublishedCandidateMain(', 'if(process.argv[1]');
const commandCode = section('function command(', 'function readOwned(');

test('one fixed approved incident; no generic target, baseline or candidate authority', () => {
  assert.equal(incident.target, '5b974eb06c858757c8785d5f9106b006903a5ba0');
  assert.equal(incident.baseline, 'b1304d5d58841c2247b93229b90bb7adcfd64965');
  assert.equal(incident.stateSha256, '98af9fe83f97d8f02236ff964823cebb5804f663469334c3149c067e3f032709');
  assert.equal(incident.directory, '/www/wwwroot/merchant-space.web-releases/5b974eb06c85-online');
  assert.equal(incident.operation, `/var/lib/faolla-online-release/${incident.target}`);
  assert.ok(absentPaths.includes(`${incident.directory}/.next`));
  for (const name of ['attendance-build-proof.json', 'build-home', 'build-cache', 'build-tmp',
    'attendance-database-progress.json', 'attendance-database-ready.json', 'migration-report.json'])
    assert.ok(absentPaths.includes(`${incident.operation}/${name}`), name);
  assert.match(source, /approved-end-unpublished-candidate-5b974eb06c85/);
  assert.doesNotMatch(source, /--force|--skip|allowUnsafe|rootOwned\s*:\s*false/);
});

test('independent recursion confirms the complete actual reviewed static import closure', () => {
  const seen = new Set();
  function visit(name) {
    if (seen.has(name)) return;
    seen.add(name);
    const text = readSource(name);
    const imports = [...text.matchAll(/(?:^|\n)\s*(?:import\s+(?:(?:[\s\S]*?)\s+from\s+)?|export\s+(?:\*|\{[^}]*\})\s+from\s+)['"]([^'"]+)['"]/g)];
    for (const [, spec] of imports) if (!spec.startsWith('node:')) {
      assert.ok(spec.startsWith('./'), spec);
      visit(path.posix.normalize(path.posix.join(path.posix.dirname(name), spec)));
    }
  }
  visit('scripts/online-unpublished-candidate.mjs');
  visit('scripts/prepare-online-release-tool.mjs');
  const actual = unpublishedCandidateImportClosure(readSource);
  assert.deepEqual(actual, [...seen].sort());
  assert.equal(actual.length, 11);
  for (const name of actual) assert.match(name, /^scripts\/[a-z0-9-]+\.mjs$/);
});

test('import parser closes multiline, indented, side-effect, re-export and cyclic fixtures', () => {
  const files = new Map([
    ['scripts/start.mjs', "  import {\n a\n} from './first.mjs';\nimport './effect.mjs';\nexport {x} from './reexport.mjs';\nexport * from './star.mjs';\nimport path from 'node:path';\n"],
    ['scripts/first.mjs', "import {y} from './start.mjs';\n"],
    ['scripts/effect.mjs', 'export const effect = true;\n'],
    ['scripts/reexport.mjs', 'export const x = 1;\n'],
    ['scripts/star.mjs', 'export const z = 1;\n'],
  ]);
  const reads = [];
  assert.deepEqual(unpublishedCandidateImportClosure(name => {
    reads.push(name); assert.ok(files.has(name), name); return files.get(name);
  }, ['scripts/start.mjs']), [...files.keys()].sort());
  assert.equal(reads.length, files.size);
  for (const text of ["import x from 'external';\n", "import '../foreign.mjs';\n", "export * from '../foreign.mjs';\n",
    "import x from './foreign.ts';\n", "import x from './nested/foreign.mjs';\n"])
    assert.throws(() => unpublishedCandidateImportClosure(() => text, ['scripts/start.mjs']), /bootstrap_import_invalid/);
  for (const name of ['../escape.mjs', 'scripts/nested/start.mjs', 'scripts/start.ts'])
    assert.throws(() => unpublishedCandidateImportClosure(() => '', [name]), /bootstrap_import_invalid/);
});

function processFixture(patch = {}) {
  const files = new Map([
    ['/proc/71/cmdline', Buffer.from(`/usr/bin/node\0/var/lib/faolla-online-bootstrap/${'a'.repeat(40)}/scripts/online-unpublished-candidate.mjs\0end\0approved-end-unpublished-candidate-5b974eb06c85\0`)],
    ['/proc/71/maps', Buffer.from('/usr/bin/node\n')],
  ]);
  const links = new Map([['/proc/71/cwd', '/var/lib/faolla-online-bootstrap/' + 'a'.repeat(40)], ['/proc/71/fd/3', incident.operation + '/state.json']]);
  const io = {
    readdirSync: name => name === '/proc' ? ['71', 'self', 'cpuinfo'] : name === '/proc/71/fd' ? ['3'] : assert.fail(name),
    readFileSync: name => {assert.ok(files.has(name), name); return files.get(name);},
    readlinkSync: name => {assert.ok(links.has(name), name); return links.get(name);},
    ...patch,
  };
  const inspect = () => runInNewContext(`${processCode}inspectProcessReferences()`, {fs: io, incident, fail});
  return {inspect, files, links};
}
test('proc observation does not match its approved CLI argument or its state-only open fd', () => {
  assert.equal(processFixture().inspect(), true);
});
test('proc observation rejects candidate self/cwd, cmdline, maps and open fd references', () => {
  for (const leaf of ['cwd', 'cmdline', 'maps', 'fd']) {
    const f = processFixture();
    if (leaf === 'cwd') f.links.set('/proc/71/cwd', incident.directory + '/nested');
    if (leaf === 'fd') f.links.set('/proc/71/fd/3', incident.directory + '/.env.local');
    if (leaf === 'cmdline') f.files.set('/proc/71/cmdline', Buffer.from(incident.name));
    if (leaf === 'maps') f.files.set('/proc/71/maps', Buffer.from(incident.directory + '/native.so'));
    assert.throws(f.inspect, /candidate_process_present/, leaf);
  }
  const gone = () => {throw Object.assign(Error('gone'), {code: 'ENOENT'});};
  assert.equal(processFixture({readFileSync: gone}).inspect(), true);
  assert.throws(processFixture({readFileSync: () => {throw Object.assign(Error('private-secret'), {code: 'EACCES'});}}).inspect, /private-secret/);
});

test('database probe is explicitly read-only, metadata-only and contains no business mutations', () => {
  const sql = unpublishedCandidateDatabaseSql();
  assert.match(sql, /^begin read only;/);
  assert.match(sql, /statement_timeout='8s'/);
  assert.match(sql, /pg_control_system\(\)/);
  assert.match(sql, /public\.faolla_schema_migrations/);
  assert.doesNotMatch(sql, /\b(?:insert|update|delete|truncate|alter|create|drop|grant|revoke|copy)\b/i);
  assert.doesNotMatch(sql, /auth\.users|storage\.objects|rolpassword|Config\.Env/);
});

test('database adapter pins formal identity, exact registry and existing pilot compatibility absence', () => {
  const db = {containerId: '0a7358f7310a33feeb9bfad9142530ff3f44882234ecbc35763135f9c1bfd416', containerName: 'supabase-db',
    databaseName: 'postgres', databaseOid: '5', systemIdentifier: '7612049595342295079', serverVersionNum: '150008', dataSource: '/opt/supabase/docker/volumes/db/data'};
  const pilot = '0d0a85a8ff50b585f690ba80a56d7d215adca2df1fa7c820840ff3389687d907';
  const manifestBytes = fs.readFileSync(new URL('scripts/attendance-production-database-migrations.manifest.json', root));
  const registry = JSON.parse(manifestBytes).baseline;
  const revision = 'a'.repeat(40);
  for (const bad of [null, 'identity', 'registry', 'attendance', 'pilot', 'compat']) {
    const calls = [], fact = {...db, primary: true, registry, attendanceRelations: 0, attendanceFunctions: 0};
    if (bad === 'identity') fact.databaseOid = '6';
    if (bad === 'registry') fact.registry = registry.slice(1);
    if (bad === 'attendance') fact.attendanceFunctions = 1;
    const command = (name, args, options) => {
      assert.equal(name, 'docker'); calls.push({args, options});
      if (args[0] === 'inspect') return JSON.stringify(args.at(-1) === db.containerId
        ? {id: db.containerId, name: '/supabase-db', running: true, mounts: [{Type: 'bind', Source: db.dataSource, RW: true}]}
        : {id: pilot, running: bad !== 'pilot'});
      assert.equal(args[0], 'exec'); assert.equal(args[1], '-i');
      assert.match(args.at(-1), /default_transaction_read_only=on/);
      assert.match(args.at(-1), /--no-password --no-psqlrc/);
      assert.match(options.input, /^begin read only;/);
      assert.doesNotMatch(options.input, /\b(?:create|alter|drop|insert|update|delete|grant|revoke)\b/i);
      if (args[2] === db.containerId) return JSON.stringify(fact);
      assert.equal(args[2], pilot);
      assert.match(options.input, /faolla_attendance_compat_5b974eb06c85/);
      return bad === 'compat' ? '1' : '0';
    };
    const invoke = () => runInNewContext(`${databaseCode}databaseObservation(revision)`, {
      DB: db, PILOT_DB: pilot, APP: '/www/wwwroot/merchant-space', incident, command, hash, equal, fail,
      unpublishedCandidateDatabaseSql, revision,
      runOnlineToolGit: (_cwd, args) => {assert.deepEqual(plain(args), ['show', `${revision}:scripts/attendance-production-database-migrations.manifest.json`]); return manifestBytes;},
    });
    if (bad) assert.throws(invoke); else {
      const result = invoke(); assert.equal(result.registryCount, 60); assert.equal(calls.length, 4);
      assert.equal(result.identitySha256, hash(JSON.stringify(db)));
    }
  }
});

function observationFixture(bad = null, startedAt = '2026-10-09T18:00:00.000Z') {
  // This synthetic in-memory collector fixture never satisfies the production
  // incident hash. It exercises actual collector code, not a server proof.
  const files = new Map(), names = Object.keys(preservedPaths).filter(k => k !== '.env.local').concat('state.json').sort();
  const state = {target: incident.target, baseline: incident.baseline, directory: incident.directory, name: incident.name,
    port: 3103, oldPort: 3105, startedAt, baseDirectory: '/synthetic-baseline',
    processes: [{name: 'synthetic-live', cwd: '/synthetic-live', port: 3105, pid: 71, status: 'online'}],
    previousActive: {target: incident.baseline, name: 'synthetic-live', directory: '/synthetic-live', port: 3105}, configs: {}};
  for (const [key, name] of Object.entries(preservedPaths)) files.set(name, Buffer.from(key === 'attendance-stage-focused-diagnostic.tap'
    ? '# tests 479\n# pass 473\n# fail 6\n' : `synthetic-${key}\n`));
  for (const name of incident.proxyFiles) {
    const old = files.get(preservedPaths[`before-${name}`]), next = files.get(preservedPaths[`after-${name}`]);
    state.configs[name] = {oldHash: hash(old), newHash: hash(next)};
    files.set(`/www/server/panel/vhost/nginx/proxy/www.faolla.com/${name}`, old);
  }
  const maintenancePath = '/var/lib/faolla-maintenance/merchant-space/state.json';
  files.set(maintenancePath, Buffer.from('{"phase":"ended"}'));
  files.set('/www/server/panel/vhost/nginx/proxy/www.faolla.com/faolla_web_release.conf', Buffer.from('synthetic marker'));
  state.maintenanceHash = hash(files.get(maintenancePath));
  state.markerHash = hash(files.get('/www/server/panel/vhost/nginx/proxy/www.faolla.com/faolla_web_release.conf'));
  files.set('/var/lib/faolla-online-release/active.json', Buffer.from(JSON.stringify(state.previousActive)));
  files.set(`${incident.operation}/state.json`, Buffer.from(JSON.stringify(state)));
  const syntheticIncident = {...incident, stateSha256: hash(files.get(`${incident.operation}/state.json`))};
  files.set('/root/.pm2/dump.pm2', Buffer.from('[]')); files.set('/root/.pm2/dump.pm2.bak', Buffer.from('[]'));
  if (bad === 'state') files.set(`${incident.operation}/state.json`, Buffer.from(JSON.stringify({...state, port: 3106})));
  if (bad === 'diagnostic') files.set(preservedPaths['attendance-stage-focused-diagnostic.tap'], Buffer.from('# tests 479\n# pass 473\n# fail 6\nonline_build_started\n'));
  if (bad === 'dump') files.set('/root/.pm2/dump.pm2.bak', Buffer.from(JSON.stringify([{cwd: incident.directory}])));
  if (bad === 'active') files.set('/var/lib/faolla-online-release/active.json', Buffer.from('{"target":"foreign"}'));
  if (bad === 'maintenance') files.set(maintenancePath, Buffer.from('{"phase":"started"}'));
  if (bad === 'marker') files.set('/www/server/panel/vhost/nginx/proxy/www.faolla.com/faolla_web_release.conf', Buffer.from('foreign'));
  if (bad === 'proxy') files.set(`/www/server/panel/vhost/nginx/proxy/www.faolla.com/${incident.proxyFiles[0]}`, Buffer.from('foreign'));
  const commands = [];
  const observe = runInNewContext(`${observeCode}observe`, {
    incident: syntheticIncident, absentPaths, preservedPaths, RECEIPT: 'unpublished-termination.json', path, hash, equal, fail,
    APP: '/www/wwwroot/merchant-space', MAINTENANCE: '/var/lib/faolla-maintenance/merchant-space',
    WEB_RELEASE_PROXY: '/www/server/panel/vhost/nginx/proxy/www.faolla.com',
    WEB_RELEASE_MARKER: '/www/server/panel/vhost/nginx/proxy/www.faolla.com/faolla_web_release.conf',
    assertOnlineToolOwnedPath: () => {}, assertExistingPm2Directory: () => {},
    readOwned: name => {assert.ok(files.has(name), name); return files.get(name);},
    git: (_cwd, args) => args[0] === 'rev-parse' ? (bad === 'source' ? 'foreign' : incident.target) : '',
    exists: name => bad === 'artifact' && name === absentPaths[0],
    fs: {readdirSync: name => name === incident.operation ? (bad === 'files' ? [...names, 'unexpected.json'] : names)
      : (bad === 'logs' ? [incident.name + '-out.log'] : []), realpathSync: () => bad === 'link' ? '/foreign' : state.baseDirectory},
    referenceAbsent: value => {if (JSON.stringify(value).includes(incident.directory) || JSON.stringify(value).includes(incident.name)) fail('candidate_reference_present');},
    normalizeRetirementProcess: value => value,
    inspectProcessReferences: () => {if (bad === 'proc') fail('candidate_process_present'); return true;},
    command: (name, args) => {
      commands.push({name, args: plain(args)});
      if (name === 'pm2') return JSON.stringify(bad === 'pm2' ? [{name: incident.name}] : state.processes);
      if (name === '/usr/sbin/ss') {assert.deepEqual(plain(args), ['-ltnH']); return bad === 'port' ? `LISTEN 0 128 127.0.0.1:${state.port} 0.0.0.0:*\n` : '';}
      if (name === 'systemctl') return bad === 'unit' ? 'loaded' : 'not-found';
      if (name === 'journalctl') {
        assert.ok(args.includes(`--since=${startedAt.slice(0, 19).replace('T', ' ')} UTC`));
        return bad === 'journal' ? '{"MESSAGE":"Started"}' : '';
      }
      assert.fail(name);
    },
    readOnlineRetentionHistory: () => ({headSha256: 'a'.repeat(64)}),
    assertOnlineRetentionPublication: options => {assert.equal(options.action, 'status'); if (bad === 'history') fail('history_changed');},
    fetch: async (url, options) => {
      assert.equal(url, 'http://127.0.0.1:3105/api/app-web-version');
      assert.equal(options.redirect, 'manual'); assert.equal(options.headers.Connection, 'close');
      return {status: bad === 'http' ? 500 : 200, json: async () => ({buildId: incident.baseline})};
    },
    AbortSignal,
    databaseObservation: () => {if (bad === 'database') fail('database_changed'); return {registryCount: 60};},
  });
  return {run: () => observe('a'.repeat(40)), commands};
}
test('actual collector combines all live metadata observations without mutating its synthetic fixture', async () => {
  const f = observationFixture(), result = await f.run();
  assert.equal(result.evidence.diagnosticKind, 'focused-test-replay');
  assert.equal(result.evidence.candidateCompatibilityDatabaseAbsent, true);
  assert.equal(result.evidence.processReferencesAbsent, true);
  assert.deepEqual(f.commands.map(x => x.name), ['pm2', '/usr/sbin/ss', 'systemctl', 'journalctl']);
});
test('restricted observation environment resolves only the actual installed ss, never a PATH fallback', () => {
  const sockets = 'LISTEN 0 128 127.0.0.1:3105 0.0.0.0:*\n';
  for (const bad of [null, 'missing', 'exit', 'signal', 'timeout', 'overflow']) {
    const invoke = runInNewContext(`${commandCode}command`, {MAX_BYTES: 32 * 1024 * 1024, fail,
      spawnSync: (name, args, options) => {
        assert.deepEqual(plain(args), ['-ltnH']);
        assert.equal(options.env.PATH, '/usr/local/bin:/usr/bin:/bin');
        assert.equal(options.timeout, 20000); assert.equal(options.maxBuffer, 32 * 1024 * 1024);
        if (name === 'ss' || bad === 'missing') return {status: null, error: {code: 'ENOENT'}};
        assert.equal(name, '/usr/sbin/ss');
        if (bad === 'exit') return {status: 1, stdout: sockets};
        if (bad === 'signal') return {status: 0, signal: 'SIGTERM', stdout: sockets};
        if (bad === 'timeout') return {status: null, error: {code: 'ETIMEDOUT'}};
        if (bad === 'overflow') return {status: null, error: {code: 'ENOBUFS'}};
        return {status: 0, stdout: sockets};
      }});
    assert.throws(() => invoke('ss', ['-ltnH']), /observation_command_failed/);
    if (bad) assert.throws(() => invoke('/usr/sbin/ss', ['-ltnH']), /observation_command_failed/);
    else assert.equal(invoke('/usr/sbin/ss', ['-ltnH']), sockets);
  }
});
test('actual collector fails closed for source, artifact, log, process, unit, ingress and database drift', async () => {
  for (const bad of ['state', 'source', 'artifact', 'files', 'diagnostic', 'pm2', 'dump', 'logs', 'proc', 'port', 'unit',
    'journal', 'active', 'maintenance', 'marker', 'link', 'proxy', 'history', 'http', 'database'])
    await assert.rejects(observationFixture(bad).run(), undefined, bad);
});
test('systemd239 journal boundary uses UTC seconds rounded down, never a later ISO millisecond', async () => {
  for (const startedAt of ['2026-10-09T18:00:00.000Z', '2026-10-09T18:00:00.001Z', '2026-10-09T18:00:00.999Z']) {
    const f = observationFixture(null, startedAt); await f.run();
    const args = f.commands.find(x => x.name === 'journalctl').args;
    assert.ok(args.includes('--since=2026-10-09 18:00:00 UTC'));
    assert.equal(args.filter(x => x.startsWith('--since=')).length, 1);
  }
  assert.match(source, /const journalSince=s\.startedAt\.slice\(0,19\)\.replace\('T',' '\)\+' UTC'/);
});

function coordinatorFixture({prior = false, drift = false, finalDrift = false, args = ['dry-run']} = {}) {
  const calls = [], receiptPath = `${incident.operation}/unpublished-termination.json`;
  let observations = 0, written = prior, receipt;
  const base = {stateText: 'synthetic state fixture; not server proof', evidence: {stable: true, preservedFiles: {synthetic: 'a'.repeat(64)}, absentPaths: ['synthetic']}};
  const task = runInNewContext(`${mainCode}closeUnpublishedCandidateMain(argv)`, {
    argv: args, process: {platform: 'linux', getuid: () => 0}, incident, RECEIPT: 'unpublished-termination.json', hash, equal, fail,
    verifySource: () => {calls.push('verifySource'); return 'a'.repeat(40);},
    withOnlineRetentionLocks: async fn => {calls.push('lock'); return fn();},
    observe: async () => {calls.push('observe'); const n = observations++; return {...base, evidence: {...base.evidence,
      observedAt: `2026-10-09T18:00:0${n}.000Z`, stable: !(drift && n === 1 || finalDrift && n === 2)}};},
    exists: name => {assert.equal(name, receiptPath); return written;},
    readOwned: name => {assert.equal(name, receiptPath); return Buffer.from(JSON.stringify(receipt ?? {fixture: true}));},
    createUnpublishedCandidateTerminationReceipt: input => {calls.push('createReceipt'); assert.equal(input.stateText, base.stateText); receipt = {fixture: true}; return receipt;},
    assertUnpublishedCandidateTerminationReceipt: input => {calls.push('assertReceipt'); assert.equal(input.stateText, base.stateText);},
    durableReceipt: value => {calls.push('writeReceipt'); assert.deepEqual(plain(value), {fixture: true}); written = true;},
  });
  return {task, calls};
}
test('dry-run has no receipt/state write and observes twice under the existing lock', async () => {
  const f = coordinatorFixture(), result = await f.task;
  assert.equal(result.persistentEvidenceWrites, 0); assert.equal(result.status, 'eligible-unpublished');
  assert.deepEqual(f.calls, ['verifySource', 'lock', 'verifySource', 'observe', 'createReceipt', 'observe']);
});
test('end writes only after two stable observations, then verifies again without state mutation', async () => {
  const f = coordinatorFixture({args: ['end', 'approved-end-unpublished-candidate-5b974eb06c85']}), result = await f.task;
  assert.equal(result.status, 'ended-unpublished'); assert.equal(result.originalStateUnchanged, true);
  assert.deepEqual(f.calls, ['verifySource', 'lock', 'verifySource', 'observe', 'createReceipt', 'observe', 'writeReceipt', 'observe', 'assertReceipt']);
  for (const args of [['end'], ['end', '--force'], ['dry-run', 'extra'], ['end', 'approved-other']]) {
    const invalid = coordinatorFixture({args}); await assert.rejects(invalid.task, /invocation_invalid/);
    assert.deepEqual(invalid.calls, []);
  }
});
test('unstable pre-write observation refuses all writes; post-write drift never reports success', async () => {
  const before = coordinatorFixture({drift: true, args: ['end', 'approved-end-unpublished-candidate-5b974eb06c85']});
  await assert.rejects(before.task, /observation_changed/); assert.ok(!before.calls.includes('writeReceipt'));
  const after = coordinatorFixture({finalDrift: true, args: ['end', 'approved-end-unpublished-candidate-5b974eb06c85']});
  await assert.rejects(after.task, /post_close_observation_changed/); assert.equal(after.calls.filter(x => x === 'writeReceipt').length, 1);
  assert.ok(!after.calls.includes('assertReceipt'));
  const prior = coordinatorFixture({prior: true}), reused = await prior.task;
  assert.equal(reused.reused, true); assert.ok(!prior.calls.includes('writeReceipt'));
});

test('durable output is exclusive 0600 sidecar with file+directory fsync and exact readback', () => {
  const name = `${incident.operation}/unpublished-termination.json`, calls = [], receipt = {fixture: true};
  let bytes;
  const io = {constants: fs.constants,
    openSync: (location, flags, mode) => {calls.push(['open', location, flags, mode]); return location === name ? 7 : 8;},
    writeFileSync: (fd, value) => {assert.equal(fd, 7); bytes = Buffer.from(value); calls.push(['write', fd]);},
    fsyncSync: fd => calls.push(['sync', fd]), closeSync: fd => calls.push(['close', fd]),
  };
  runInNewContext(`${receiptCode}durableReceipt(receipt)`, {incident, RECEIPT: 'unpublished-termination.json', fs: io, receipt, Buffer, equal,
    readOwned: location => {assert.equal(location, name); return bytes;}});
  assert.deepEqual(calls[0], ['open', name, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600]);
  assert.deepEqual(calls.map(x => x[0]), ['open', 'write', 'sync', 'close', 'open', 'sync', 'close']);
  assert.equal(calls[4][1], incident.operation);
  assert.equal(bytes.toString(), JSON.stringify(receipt, null, 2) + '\n');
  assert.doesNotMatch(receiptCode, /rename|unlink|rmdir|rmSync|state\.json|runtime\.json|\.env\.local/);
});

test('collector command allowlist and error output contain no actuator or private value disclosure', () => {
  assert.deepEqual([...source.matchAll(/command\('([^']+)'/g)].map(m => m[1]).sort(), ['docker', 'docker', 'docker', 'docker', 'journalctl', 'pm2', '/usr/sbin/ss', 'systemctl'].sort());
  assert.match(source, /command\('pm2',\['jlist'\]\)/);
  assert.match(source, /command\('\/usr\/sbin\/ss',\['-ltnH'\]\)/);
  assert.match(source, /command\('systemctl',\['show',unit,'--property=LoadState','--value'\]\)/);
  assert.match(source, /command\('journalctl',\['--quiet','--no-pager','--output=json',`--since=\$\{journalSince\}`,'--unit',unit\]\)/);
  assert.doesNotMatch(source, /command\('(?:npm|nice|systemd-run|nginx|kill|rm|cp)'|\['(?:start|stop|delete|restart|reload)'\]|Config\.Env|\.environ|readFileSync\([^\n]*environ/);
  assert.equal([...source.matchAll(/fs\.writeFileSync\(/g)].length, 1);
  assert.doesNotMatch(source, /fs\.(?:renameSync|unlinkSync|rmSync|rmdirSync|mkdirSync|chmodSync)\(/);
  assert.match(source, /console\.error\(\/\^online_\(\?:unpublished\|tool\|retention\)_\[a-z_\]\+\$\//);
  assert.match(source, /error\.message:'online_unpublished_unverified'/);
  assert.doesNotMatch(source, /console\.(?:log|error)\([^\n]*(?:stdout|stderr|runtime|PGPASSWORD|POSTGRES_PASSWORD|envText)/);
});

test('bootstrap is exact new-main sparse detached reviewed source, not an executable acceptance bypass', () => {
  for (const evidence of ['origin/main', 'merge-base', '--is-ancestor', 'core.sparseCheckout', 'core.sparseCheckoutCone', 'index.sparse',
    'bootstrap_blob_changed', 'bootstrap_index_changed', 'bootstrap_not_detached', 'bootstrap_unexpected_entry']) assert.ok(source.includes(evidence), evidence);
  assert.match(source, /verifyOnlineReleaseTool\(createOnlineReleaseToolPlan\(revision\)\)/);
  assert.match(source, /readOwned\(patternFile,false\)\.toString\('utf8'\)!==patterns/);
  assert.match(source, /readOwned\(`\$\{directory\}\/\$\{name\}`,false\)\.equals\(runOnlineToolGit/);
  assert.doesNotMatch(source, /git\([^\n]*\['(?:checkout|reset|clean|worktree|read-tree|sparse-checkout)'/);
});
test('historical pending exception remains one exact receipt, not a renamed state or recovery authorization', () => {
  assert.match(policy, /sha256\(stateText\) === p\.stateSha256/);
  assert.match(policy, /if \(\['active', 'rolled-back'\]\.includes\(value\.status\)\) continue/);
  assert.match(policy, /name !== incident\.target \|\| directory !== incident\.operation \|\| value\.status !== 'preparing' \|\| !exists\(receiptPath\)/);
  assert.match(policy, /assertUnpublishedCandidateTerminationReceipt\(\{stateText, receipt: JSON\.parse/);
  assert.match(policy, /process\.status === 'online' && process\.port === state\.port/);
  assert.doesNotMatch(policy, /value\.status\s*=\s*['"](?:active|rolled-back|ended)/);
});
