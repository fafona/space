import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {fileURLToPath} from 'node:url';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {CONTACT_WECHAT_STAGED_REPAIR as p, CONTACT_WECHAT_STAGED_REPAIR_FILES as allowed,
  CONTACT_WECHAT_STAGED_REPAIR_PRESERVED as pins, CONTACT_WECHAT_STAGED_REPAIR_PATHS as paths,
  assertContactWechatStagedRepairReceipt} from './contact-wechat-staged-tool-repair-policy.mjs';
import {contactWechatStagedRepairImportClosure, contactWechatStagedRepairMain,
  prepareContactWechatStagedToolRepair} from './contact-wechat-staged-tool-repair.mjs';
import {webReleaseRuntimeEnvironment, WEB_RELEASE_FILES, WEB_RELEASE_PROXY as proxy,
  WEB_RELEASE_MARKER as marker} from './web-presentation-release-policy.mjs';

const entry = fileURLToPath(new URL('./contact-wechat-staged-tool-repair.mjs', import.meta.url));
const repository = fileURLToPath(new URL('../', import.meta.url)), source = fs.readFileSync(entry, 'utf8');
const syntax = ts.createSourceFile(entry, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const revision = 'e'.repeat(40), APP = '/www/wwwroot/merchant-space';
const digest = value => createHash('sha256').update(value).digest('hex');
const fail = code => {throw Error(`contact_wechat_staged_repair_${code}`);};
const need = (value, code) => {if (!value) fail(code);};
// Functions run in a separate VM realm; compare their plain evidence values,
// not the deliberately different fixture/VM Object and Array prototypes.
const same = (left, right, code) => need(isDeepStrictEqual(
  JSON.parse(JSON.stringify(left)), JSON.parse(JSON.stringify(right))), code);
const receiptFile = `${p.operation}/${p.receiptName}`, originalStateFile = `${p.operation}/${p.originalStateCopyName}`;
function functionCode(name) {
  const node = syntax.statements.find(item => ts.isFunctionDeclaration(item) && item.name?.text === name);
  assert.ok(node, name); return node.getText(syntax).replace(/^export\s+/, '');
}
function functionVm(name, globals) {
  return runInNewContext(`${functionCode(name)}\n${name}`, {Buffer, JSON, createHash, path: path.posix,
    fail, need, same, p, paths, pins, allowed, APP, sha: digest, ...globals}, {timeout: 1000});
}
const validateReceipt = value => assertContactWechatStagedRepairReceipt(JSON.parse(JSON.stringify(value)));

test('actual bootstrap closure matches every parser-discovered transitive static dependency', () => {
  const read = name => fs.readFileSync(path.join(repository, name), 'utf8'), seen = new Set();
  const visit = name => {
    if (seen.has(name)) return; seen.add(name);
    const parsed = ts.createSourceFile(name, read(name), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    for (const node of parsed.statements) {
      if ((!ts.isImportDeclaration(node) && !ts.isExportDeclaration(node)) || !node.moduleSpecifier) continue;
      assert.ok(ts.isStringLiteral(node.moduleSpecifier)); const specifier = node.moduleSpecifier.text;
      if (specifier.startsWith('node:')) continue;
      assert.ok(specifier.startsWith('./'));
      visit(path.posix.normalize(path.posix.join(path.posix.dirname(name), specifier)));
    }
  };
  visit('scripts/contact-wechat-staged-tool-repair.mjs');
  assert.deepEqual(contactWechatStagedRepairImportClosure(read), [...seen].sort());
  for (const name of ['prepare-online-release-tool', 'contact-wechat-staged-tool-repair-policy',
    'attendance-staged-tool-repair', 'online-release-retention', 'online-release-retirement'])
    assert.ok(seen.has(`scripts/${name}.mjs`));
});
test('static closure rejects packages, outside paths, test imports and malformed filenames', () => {
  const sources = new Map([
    ['scripts/contact-wechat-staged-tool-repair.mjs', "import fs from 'node:fs'; import './a.mjs';\nexport {b} from './b.mjs';"],
    ['scripts/a.mjs', "import {\n b\n} from './b.mjs';"], ['scripts/b.mjs', "import './a.mjs';"],
  ]);
  assert.deepEqual(contactWechatStagedRepairImportClosure(name => sources.get(name)),
    ['scripts/a.mjs', 'scripts/b.mjs', 'scripts/contact-wechat-staged-tool-repair.mjs']);
  for (const name of ['../outside.mjs', '/tmp/x.mjs', './a.test.mjs', 'package', './a_b.mjs'])
    assert.throws(() => contactWechatStagedRepairImportClosure(() => `import '${name}';`), /bootstrap_import_invalid/);
});

function sourceFixture({change = allowed.map(name => `M\t${name}`).join('\n'), changedInputs = false,
  wrongMain = false, dirty = false, wrongPin = false} = {}) {
  const calls = [], rows = `100644 blob ${'a'.repeat(40)}\tsrc/app/page.tsx`;
  const fakePolicy = {...p, sourceInputsSha256: wrongPin ? '0'.repeat(64) : digest(rows)};
  const runGit = (directory, args) => {
    calls.push({directory, args});
    if (args[0] === 'merge-base') return '';
    if (args[0] === 'diff') return change;
    if (args[0] === 'status') return dirty ? ' M src/app/page.tsx' : '';
    if (args.join(' ') === 'rev-parse --abbrev-ref HEAD') return 'HEAD';
    if (wrongMain && directory === APP && args.includes('origin/main')) return 'f'.repeat(40);
    return revision;
  };
  const verify = functionVm('verifySource', {p: fakePolicy, process: {platform: 'linux', getuid: () => 0},
    git: runGit, assertOnlineToolOwnedPath: () => {}, createOnlineReleaseToolPlan: target => ({target}),
    verifyOnlineReleaseTool: plan => {assert.equal(plan.target, revision);},
    immutableSourceInputs: target => changedInputs && target === revision ? rows.replace('a'.repeat(40), 'b'.repeat(40)) : rows});
  return {calls, run: () => verify(revision, `/var/lib/faolla-online-code/${revision}`)};
}
test('source proof admits only the mandatory checker/test closure while pinning every other Git input', () => {
  const fixture = sourceFixture(), result = fixture.run();
  assert.equal(result.toolRevision, revision); assert.deepEqual([...result.changedToolFiles], [...allowed].sort());
  assert.ok(fixture.calls.some(call => call.args[0] === 'merge-base'));
  for (const change of [allowed.slice(0, 7).map(name => `M\t${name}`).join('\n'),
    `${allowed.map(name => `M\t${name}`).join('\n')}\nM\tpackage-lock.json`,
    `D\t${allowed[0]}`, `R100\told\t${allowed[0]}`, `M\tsrc/app/card/[card]/route.ts`,
    `A\tscripts/supabase-migrations/new.sql`, ''])
    assert.throws(() => sourceFixture({change}).run(), /source_scope/);
  for (const option of [{changedInputs: true}, {wrongPin: true}, {wrongMain: true}, {dirty: true}])
    assert.throws(() => sourceFixture(option).run(), /application_inputs_changed|source_identity/);
});
test('normal tool source is restricted to Linux root and exact source-only directory', () => {
  const verify = functionVm('verifySource', {process: {platform: 'win32', getuid: () => 0},
    assertOnlineToolOwnedPath: () => assert.fail('no path access before identity rejection')});
  assert.throws(() => verify(revision, '/tmp/tool'), /invocation/);
  for (const value of [p.target, p.baseline, revision + '\n', 'HEAD'])
    assert.throws(() => verify(value, '/tmp/tool'), /invocation/);
});

function stateFixture({phase = 'preparing', patch, originalPatch, corruptOriginal = false, missingCopy = false} = {}) {
  const originalObject = {status: 'preparing', target: p.target, baseline: p.baseline, directory: p.directory,
    name: p.name, port: p.port, lane: 'contact-wechat-code-only', contactWechatBuildProofSha256: p.buildProofSha256,
    processes: [{name: 'merchant-space', pid: 123}], arbitrarySavedField: {unchanged: true}};
  if (originalPatch) Object.assign(originalObject, originalPatch);
  const original = Buffer.from(JSON.stringify(originalObject));
  const current = Buffer.from(JSON.stringify({...originalObject, status: phase, ...patch}));
  const fakePolicy = {...p, stateSha256: digest(original)};
  const read = (file, options) => {
    assert.equal(options.privateMode, true);
    if (file === paths['state.json']) return current;
    assert.equal(file, originalStateFile);
    if (missingCopy) throw Error('missing_copy');
    return corruptOriginal ? Buffer.from('{}') : original;
  };
  return {original, current, fakePolicy, run: required => functionVm('candidateState',
    {p: fakePolicy, ownedFile: read, originalStateFile})(phase, {sealedOriginalRequired: required})};
}
test('ready phase permits precisely the original preparing state with only status changed', () => {
  const preparing = stateFixture(), ready = stateFixture({phase: 'ready-no-database'});
  assert.equal(preparing.run(false).state.status, 'preparing');
  assert.equal(preparing.run(true).state.status, 'preparing');
  assert.equal(ready.run(true).state.status, 'ready-no-database');
  for (const patch of [{target: 'f'.repeat(40)}, {baseline: 'f'.repeat(40)}, {lane: 'runtime-performance'},
    {port: 3105}, {extra: true}, {arbitrarySavedField: {unchanged: false}}, {processes: []},
    {contactWechatBuildProofSha256: '0'.repeat(64)}, {status: 'active'}])
    assert.throws(() => stateFixture({phase: 'ready-no-database', patch}).run(true), /candidate_transition_changed/);
  assert.throws(() => stateFixture({phase: 'ready-no-database', corruptOriginal: true}).run(true), /original_state_changed/);
  assert.throws(() => stateFixture({phase: 'ready-no-database', missingCopy: true}).run(true), /missing_copy/);
  assert.throws(() => stateFixture({phase: 'ready-no-database', originalPatch: {status: 'ready-no-database'}}).run(true), /original_state_changed/);
});
test('preparing phase still requires the original raw bytes, not merely an equivalent JSON object', () => {
  assert.throws(() => stateFixture({patch: {extra: true}}).run(false), /candidate_changed/);
  assert.throws(() => stateFixture({corruptOriginal: true}).run(true), /original_state_changed/);
  for (const phase of ['active', 'staged', 'migration', 'preparing\n'])
    assert.throws(() => stateFixture({phase}).run(true), /phase_invalid/);
});

function fileFixture({privateMode = false, size = 7, mode = 0o600, nlink = 1, mutation = ''} = {}) {
  let stats = 0, opened = false, closed = false;
  const value = () => ({dev: 1, ino: 1, uid: 0, mode, nlink, size, mtimeMs: 1, ctimeMs: 1});
  const io = {constants: fs.constants, lstatSync: () => {stats++; const stat = value(); if (mutation === 'linked' && stats > 1) stat.ino++; return stat;},
    openSync: (file, flags) => {assert.equal(file, '/file'); assert.equal(flags & fs.constants.O_WRONLY, 0); opened = true; return 9;},
    fstatSync: () => {const stat = value(); if (mutation === 'opened') stat.ino++; return stat;},
    readFileSync: fd => {assert.equal(fd, 9); return Buffer.alloc(mutation === 'bytes' ? size + 1 : size);},
    closeSync: fd => {assert.equal(fd, 9); closed = true;}};
  const read = functionVm('ownedFile', {fs: io, assertOnlineToolOwnedPath: (file, kind) => {
    assert.equal(file, '/file'); assert.equal(kind, 'file');}});
  return {run: options => read('/file', {privateMode, ...options}), status: () => ({opened, closed})};
}
test('owned evidence uses readonly stable descriptors, private permissions and bounded bytes', () => {
  const valid = fileFixture(); assert.equal(valid.run().length, 7); assert.deepEqual(valid.status(), {opened: true, closed: true});
  for (const options of [{nlink: 2}, {privateMode: true, mode: 0o644}, {size: 0}]) {
    const fixture = fileFixture(options); assert.throws(fixture.run, /file_invalid/); assert.equal(fixture.status().opened, false);
  }
  for (const mutation of ['linked', 'opened', 'bytes']) {
    const fixture = fileFixture({mutation}); assert.throws(fixture.run, /file_changed/); assert.equal(fixture.status().closed, true);
  }
  assert.equal(fileFixture({size: 0}).run({allowEmpty: true}).length, 0, 'empty tracked blobs are valid but empty evidence is not');
  assert.throws(() => fileFixture().run({maxBytes: 6}), /file_invalid/);
});
test('candidate source independently validates every tracked blob including empty files and rejects links/escapes', () => {
  const bytes = Buffer.from('hello'), blob = createHash('sha1').update('blob 5\0').update(bytes).digest('hex');
  const empty = createHash('sha1').update('blob 0\0').digest('hex');
  const rows = [`100644 blob ${blob}\tsrc/a.js`, `100644 blob ${empty}\tdev.log`, ''].join('\0');
  let corrupt = false, invalidRows = false;
  const check = functionVm('candidateSource', {p: {...p, sourceInputsSha256: digest('stable')},
    git: (directory, args) => args[0] === 'status' ? '' : p.target,
    runOnlineToolGit: () => Buffer.from(invalidRows ? '120000 blob x\t../outside\0' : rows),
    immutableSourceInputs: () => 'stable', ownedFile: (file, options) => {
      assert.equal(options.allowEmpty, true); assert.equal(options.maxBytes, 256 * 1024 ** 2);
      return file.endsWith('/dev.log') ? Buffer.alloc(0) : corrupt ? Buffer.from('other') : bytes;
    }});
  assert.doesNotThrow(check); corrupt = true; assert.throws(check, /candidate_source_changed/);
  corrupt = false; invalidRows = true; assert.throws(check, /candidate_source_invalid/);
});

test('PM2 observation cannot start a missing daemon, and rejects daemon replacement around a successful read', () => {
  let spawned = 0, observations = 0, replaced = false;
  const read = functionVm('command', {commandEnvironment: {}, pm2DaemonIdentity: () => {
    observations++; return {pid: replaced && observations > 1 ? '456' : '123'};},
  spawnSync: (name, args, options) => {spawned++; assert.equal(name, 'pm2'); assert.deepEqual([...args], ['jlist']);
    assert.equal(options.timeout, 60000); return {status: 0, stdout: '[]'};}});
  assert.equal(read('pm2', ['jlist']), '[]'); assert.equal(observations, 2); assert.equal(spawned, 1);
  observations = 0; replaced = true; assert.throws(() => read('pm2', ['jlist']), /daemon_identity_changed/);
  const missing = functionVm('command', {pm2DaemonIdentity: () => {throw Error('missing_daemon');},
    spawnSync: () => assert.fail('must not invoke PM2 without an existing owned daemon')});
  assert.throws(() => missing('pm2', ['jlist']), /missing_daemon/);
});
test('daemon guard binds owned PID bytes to a root process with the exact existing PM2 command', () => {
  let badOwner = false, badCommand = false, changedFile = false, reads = 0;
  const daemon = functionVm('pm2DaemonIdentity', {ownedFile: file => {assert.equal(file, '/root/.pm2/pm2.pid'); reads++;
    return Buffer.from(changedFile && reads > 1 ? '456\n' : '123\n');}, fs: {
    lstatSync: file => {assert.equal(file, '/proc/123'); return {uid: badOwner ? 1000 : 0};},
    readFileSync: file => {assert.equal(file, '/proc/123/cmdline');
      return Buffer.from(badCommand ? 'node\0other.js' : 'PM2 v6.0.14: God Daemon (/root/.pm2)\0');}}});
  assert.equal(daemon().pid, '123');
  badOwner = true; assert.throws(daemon, /daemon_identity_changed/); badOwner = false;
  badCommand = true; assert.throws(daemon, /daemon_identity_changed/); badCommand = false;
  reads = 0; changedFile = true; assert.throws(daemon, /daemon_identity_changed/);
});

function processFixture({change = ''} = {}) {
  const inherited = {FAOLLA_TRAFFIC_ENABLED: '1', FAOLLA_TRAFFIC_SIGNING_SECRET: 'synthetic-signing-secret',
    FAOLLA_ORDER_ATTENTION_PILOT_SITE_ID: '10000000', FAOLLA_SUPER_ADMIN_ORIGIN: 'https://console.faolla.com', NODE_ENV: 'production'};
  const common = {FAOLLA_BACKGROUND_JOBS_PAUSED: '1', MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED: '0',
    MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED: '0', NODE_OPTIONS: '--max-old-space-size=4096', NEXT_TELEMETRY_DISABLED: '1', PM2_HOME: '/root/.pm2'};
  const candidate = {...inherited, ...common, FAOLLA_WEB_BUILD_ID: p.target, NEXT_PUBLIC_FAOLLA_WEB_BUILD_ID: p.target, PORT: '3104'};
  const baseline = {...inherited, ...common, FAOLLA_WEB_BUILD_ID: p.baseline, NEXT_PUBLIC_FAOLLA_WEB_BUILD_ID: p.baseline, PORT: '3103'};
  const runtime = {...candidate}, candidateRaw = {...candidate}, baselineRaw = {...baseline};
  const own = {name: p.name, pid: p.candidatePid, identity: {name: p.name, pid: p.candidatePid}, pm2_env: {...candidate, pm_cwd: p.directory, status: 'online'}};
  const previous = {name: 'merchant-space-online-a535a308e21f', pid: 456, identity: {name: 'baseline', pid: 456},
    pm2_env: {...baseline, pm_cwd: '/www/wwwroot/merchant-space.web-releases/a535a308e21f-online', status: 'online'}};
  const raw = environment => Buffer.from(Object.entries(environment).map(([key, value]) => `${key}=${value}`).join('\0') + '\0');
  const candidateBytes = raw(candidate), commandBytes = Buffer.from('next-server (v16.1.6)\0'), baselineFile = Buffer.from('original-file');
  const fakePolicy = {...p, candidateProcessSha256: digest(JSON.stringify(own.identity)),
    candidateProcessEnvironmentSha256: digest(candidateBytes), candidateProcessCommandSha256: digest(commandBytes)};
  const state = {oldName: previous.name, oldDirectory: previous.pm2_env.pm_cwd, contactWechatBaselinePid: previous.pid,
    contactWechatInheritedEnvironmentKeys: Object.keys(inherited).sort(),
    contactWechatInheritedEnvironmentSha256: digest(JSON.stringify(Object.fromEntries(Object.keys(inherited).sort().map(key => [key, inherited[key]])))),
    contactWechatBaselineEnvironmentFileSha256: digest(baselineFile)};
  if (change === 'pid') own.pid++;
  if (change === 'process-config') own.identity.extra = true;
  if (change === 'candidate-env') candidateRaw.FAOLLA_TRAFFIC_SIGNING_SECRET = 'other';
  if (change === 'baseline-env') baselineRaw.FAOLLA_TRAFFIC_SIGNING_SECRET = 'other';
  if (change === 'baseline-unknown') baselineRaw.STRIPE_SECRET_KEY = 'unreviewed';
  if (change === 'runtime-env') runtime.FAOLLA_TRAFFIC_SIGNING_SECRET = 'other';
  if (change === 'runtime-unknown') runtime.STRIPE_SECRET_KEY = 'unreviewed';
  if (change === 'pm2-env') own.pm2_env.FAOLLA_TRAFFIC_SIGNING_SECRET = 'other';
  if (change === 'paused') runtime.FAOLLA_BACKGROUND_JOBS_PAUSED = '0';
  if (change === 'heap') runtime.NODE_OPTIONS = '--max-old-space-size=8192';
  if (change === 'port') runtime.PORT = '3105';
  if (change === 'baseline-pid') previous.pid++;
  const processObservation = functionVm('processObservation', {p: fakePolicy,
    normalizeRetirementProcess: value => value.identity, webReleaseRuntimeEnvironment,
    protectedEnvironment: functionVm('protectedEnvironment', {}),
    ownedFile: file => file === paths['runtime.json'] ? Buffer.from(JSON.stringify(runtime))
      : change === 'baseline-file' ? Buffer.from('changed-file') : baselineFile,
    fs: {lstatSync: () => ({uid: change === 'owner' ? 1000 : 0}),
      readFileSync: file => file.endsWith('/cmdline') ? change === 'command' ? Buffer.from('other') : commandBytes
        : file.startsWith(`/proc/${own.pid}/`) ? raw(candidateRaw) : raw(baselineRaw),
      realpathSync: file => file.endsWith('/exe') ? change === 'exe' ? '/tmp/node' : p.candidateProcessExecutable
        : change === 'cwd' ? '/tmp/app' : file.startsWith(`/proc/${own.pid}/`) ? own.pm2_env.pm_cwd : previous.pm2_env.pm_cwd}});
  return {run: () => processObservation(state, [own, previous])};
}
test('actual process gate binds PID, command, executable, root owner, PM2 config and exact inherited environment', () => {
  assert.equal(processFixture().run().processes.length, 2);
  for (const change of ['pid', 'process-config', 'candidate-env', 'baseline-env', 'baseline-unknown', 'runtime-env',
    'runtime-unknown', 'pm2-env', 'paused', 'heap', 'port', 'baseline-pid', 'baseline-file', 'owner', 'command', 'exe', 'cwd'])
    assert.throws(processFixture({change}).run, /(?:process|environment|baseline)_changed|process_owner_changed|candidate_environment_changed|process_directory_changed/,
      change);
});

function pilotFixture({change = ''} = {}) {
  const controller = '/opt/faolla-attendance-pilot/attendance-isolated-pilot-control.mjs', controllerBytes = Buffer.from('approved-controller');
  const services = ['db', 'auth', 'rest', 'realtime', 'storage'].map((name, index) => ({name, id: String(index + 1).repeat(64),
    running: name === 'db', health: name === 'db' ? 'healthy' : 'none'}));
  const restored = structuredClone(services);
  if (change === 'restored-id') restored[0].id = 'f'.repeat(64);
  const status = {productionUnchanged: change !== 'production', services: structuredClone(services)};
  if (change === 'running') status.services[1].running = true;
  if (change === 'health') status.services[0].health = 'unhealthy';
  if (change === 'duplicate-name') status.services[1].name = 'db';
  const calls = [];
  const observe = functionVm('pilotObservation', {
    sha: bytes => bytes.equals(controllerBytes) && change !== 'controller' ? 'c6c9765717f3d8af709bdcbd4e0fcfd84178175d02e04fe710c8186ed23dfa24' : digest(bytes),
    ownedFile: file => file === controller ? controllerBytes : Buffer.from(JSON.stringify({pilot: file === paths['before.json'] ? services : restored})),
    command: (name, args) => {calls.push({name, args}); if (name === '/usr/bin/node') {assert.deepEqual([...args], [controller, 'status']); return JSON.stringify(status);}
      assert.equal(name, 'docker'); assert.deepEqual([...args].slice(0, 4), ['--host', 'unix:///var/run/docker.sock', 'inspect', '--format']);
      const service = services.find(item => item.id === args.at(-1)); assert.ok(service);
      return JSON.stringify({id: change === 'id' ? 'f'.repeat(64) : service.id,
        name: change === 'name' ? '/other' : `/faolla-attendance-pilot-${service.name}`,
        running: change === 'docker-running' ? !service.running : service.running,
        ports: change === 'ports' ? {'5432/tcp': [{HostIp: '0.0.0.0', HostPort: '5432'}]} : {'5432/tcp': null}});
    }});
  return {calls, run: () => observe()};
}
test('pilot gate observes five restored original IDs with only healthy DB running and no published ports', () => {
  const fixture = pilotFixture(); assert.equal(fixture.run().length, 5);
  assert.equal(fixture.calls.filter(call => call.name === 'docker').length, 5);
  for (const change of ['restored-id', 'production', 'running', 'health', 'duplicate-name', 'controller', 'id', 'name', 'docker-running', 'ports'])
    assert.throws(pilotFixture({change}).run, /pilot_(?:restore_changed|changed|controller_changed|identity_changed)/, change);
});

function observationFixture({change = ''} = {}) {
  const state = {oldDirectory: '/baseline', configs: Object.fromEntries(WEB_RELEASE_FILES.map(name => [name, {oldHash: digest(`proxy:${name}`)}]))};
  const current = Buffer.from('original-state'), proof = Buffer.from(JSON.stringify({target: p.target, buildId: 'random-next-build-id',
    guardedCommand: 'npm run build', memoryBytes: 4294967296, heapMiB: 3072, cpuQuotaPercent: 100,
    tasks: 128, seconds: 1200, privateNetworkVerified: true, swapBytes: 0}));
  const active = Buffer.from(JSON.stringify({target: p.baseline})), maintenanceBytes = Buffer.from('{"phase":"ended"}');
  const fakeFiles = new Map(Object.entries(paths).map(([name, file]) => [file, Buffer.from(name)]));
  fakeFiles.set(paths['state.json'], current); fakeFiles.set(paths['attendance-build-proof.json'], proof);
  fakeFiles.set(paths.BUILD_ID, Buffer.from('random-next-build-id'));
  const fakePins = Object.fromEntries(Object.entries(paths).map(([name, file]) => [name, digest(fakeFiles.get(file))]));
  const fakePolicy = {...p, stateSha256: digest(current), buildProofSha256: digest(proof), activeSha256: digest(active),
    maintenanceSha256: digest(maintenanceBytes), markerSha256: digest('marker')};
  let processReads = 0, historyReads = 0, pilotReads = 0;
  const calls = [];
  const observe = functionVm('observe', {p: fakePolicy, pins: fakePins, maintenance: '/maintenance', marker, proxy, WEB_RELEASE_FILES,
    originalStateFile, assertOnlineToolOwnedPath: () => {}, fs: {lstatSync: () => ({mode: 0o700})},
    candidateState: () => ({state, current, original: current}), candidateSource: () => calls.push('source'),
    evidenceExists: () => change === 'database',
    ownedFile: file => {
      if (file === '/var/lib/faolla-online-release/active.json') return change === 'active' ? Buffer.from('{}') : active;
      if (file === '/maintenance/state.json') return change === 'maintenance' ? Buffer.from('{}') : maintenanceBytes;
      if (file === marker) return Buffer.from(change === 'marker' ? 'other-marker' : 'marker');
      if (file.startsWith(`${proxy}/`)) return Buffer.from(change === 'proxy' ? 'other-proxy' : `proxy:${file.slice(proxy.length + 1)}`);
      if (file === '/baseline/package-lock.json') return fakeFiles.get(paths['package-lock.json']);
      assert.ok(fakeFiles.has(file), file);
      return change === 'evidence' && file === paths['stage.log'] ? Buffer.from('other-evidence') : fakeFiles.get(file);
    },
    readOnlineRetentionHistory: () => {historyReads++; return {headSha256: change === 'history' && historyReads > 1 ? '0'.repeat(64) : p.retentionHeadSha256};},
    command: () => '[]', processObservation: () => {processReads++; return {processes: [{pid: change === 'process' && processReads > 1 ? 999 : 123}]};},
    assertOnlineRetentionPublication: input => {assert.equal(input.action, 'status'); calls.push('retention');},
    pilotObservation: () => {pilotReads++; return [{id: change === 'pilot' && pilotReads > 1 ? 'other' : 'original'}];},
    attendanceRepairTreeFingerprint: (root, options) => {calls.push({root, options});
      return {sha256: root.endsWith('/.next') ? change === 'build' ? '0'.repeat(64) : p.builtOutputSha256
        : change === 'dependencies' ? '0'.repeat(64) : p.dependencySha256, files: 2, bytes: 30};},
    git: (directory, args) => args[0] === 'status' ? '' : p.target});
  return {calls, run: () => observe()};
}
test('full observation independently binds saved failures, built output, dependencies and formal deployment evidence', () => {
  const fixture = observationFixture(), result = fixture.run();
  assert.equal(result.builtOutputSha256, p.builtOutputSha256);
  assert.equal(fixture.calls.filter(call => typeof call === 'object').length, 3);
  const trees = fixture.calls.filter(call => typeof call === 'object');
  assert.deepEqual([...trees[0].options.exclude], ['cache', 'trace']);
  assert.equal(trees[1].options.allowInternalLinks, true); assert.equal(trees[2].root, '/baseline/node_modules');
  for (const change of ['database', 'active', 'maintenance', 'marker', 'proxy', 'evidence', 'history', 'process', 'pilot', 'build', 'dependencies'])
    assert.throws(observationFixture({change}).run,
      /database_attempt_exists|baseline_changed|maintenance_changed|marker_changed|proxy_changed|preserved_evidence_changed|retention_changed|process_changed_during_observation|pilot_changed_during_observation|build_output_changed|dependencies_changed/,
      change);
});

function preparationFixture({changed = '', existing = false} = {}) {
  const calls = [], written = new Map(), original = Buffer.from('synthetic-original-state');
  const sourceInfo = {toolRevision: revision, changedToolFiles: [...allowed].sort(), sourceInputsSha256: p.sourceInputsSha256};
  const before = {preservedFiles: {...pins}, builtOutputSha256: p.builtOutputSha256,
    dependencySha256: p.dependencySha256, stateText: original.toString('utf8'), processes: [{pid: p.candidatePid}]};
  let locked = false, observations = 0;
  const globals = {ROOT: '/synthetic-bootstrap', receiptFile, originalStateFile, maintenance: '/var/lib/faolla-maintenance/merchant-space',
    verifySource: (target, directory, options) => {assert.equal(target, revision); calls.push({kind: 'source', directory, options}); return sourceInfo;},
    evidenceExists: file => existing || written.has(file),
    observe: () => {observations++; calls.push({kind: 'observe', locked});
      return changed === 'before' && observations >= 2 || changed === 'during' && observations >= 3 || changed === 'after' && observations >= 4
        ? {...before, dependencySha256: '0'.repeat(64)} : before;},
    withOnlineToolPreparationLocks: (options, work) => {assert.equal(options.deployLock, `${APP}.deploy.lock`);
      locked = true; calls.push({kind: 'lock'}); try {return work();} finally {locked = false;}},
    assertContactWechatStagedRepairReceipt: validateReceipt,
    assertOnlineToolNoPending: options => {assert.ok(locked); validateReceipt(options.fixedContactWechatStagedRepairReceipt); calls.push({kind: 'pending'});},
    createOnlineReleaseToolPlan: target => ({target}),
    executeOnlineReleaseToolPlan: plan => {assert.ok(locked); assert.equal(plan.target, revision); calls.push({kind: 'prepare-source-only'});
      return {directory: '/synthetic-prepared-tools'};},
    process: {umask: value => {calls.push({kind: 'umask', value}); return 0o022;}},
    sealFile: (file, bytes) => {assert.ok(locked); assert.ok(!written.has(file)); written.set(file, Buffer.from(bytes)); calls.push({kind: 'seal', file});},
    ownedFile: file => {assert.ok(written.has(file)); return written.get(file);},
    sha: bytes => bytes.equals(original) ? p.stateSha256 : digest(bytes)};
  const prepare = functionVm('prepareContactWechatStagedToolRepair', globals);
  return {calls, written, run: (confirm = 'approved-contact-wechat-staged-tool-repair') => prepare(revision, confirm)};
}
test('source-only preparation observes before/inside/after dual locks and writes only two immutable evidence files', () => {
  const fixture = preparationFixture(), result = fixture.run();
  assert.equal(result.target, p.target); assert.equal(result.applicationRebuilt, false);
  assert.equal(result.productionDatabaseChanged, false); assert.equal(result.trafficChanged, false);
  assert.deepEqual([...fixture.written.keys()], [originalStateFile, receiptFile]);
  const observations = fixture.calls.filter(call => call.kind === 'observe');
  assert.deepEqual(observations.map(call => call.locked), [false, true, true, true]);
  assert.equal(fixture.calls.filter(call => call.kind === 'prepare-source-only').length, 1);
  assert.ok(fixture.calls.findIndex(call => call.kind === 'pending') < fixture.calls.findIndex(call => call.kind === 'prepare-source-only'));
  assert.ok(fixture.calls.findIndex(call => call.kind === 'prepare-source-only') < fixture.calls.findIndex(call => call.kind === 'seal'));
  validateReceipt(JSON.parse(fixture.written.get(receiptFile)));
  assert.equal(result.receiptSha256, digest(fixture.written.get(receiptFile)));
});
test('approval, existing evidence and changed candidate fail closed without state overwrite or success receipt', () => {
  const denied = preparationFixture(); assert.throws(() => denied.run('anything'), /approval_required/); assert.equal(denied.calls.length, 0);
  const existing = preparationFixture({existing: true}); assert.throws(existing.run, /receipt_exists/); assert.equal(existing.written.size, 0);
  for (const changed of ['before', 'during']) {
    const fixture = preparationFixture({changed}); assert.throws(fixture.run, /candidate_changed_(?:before|during)_preparation/);
    assert.equal(fixture.written.size, 0);
  }
  const changed = preparationFixture({changed: 'after'});
  assert.throws(changed.run, /candidate_changed_after_preparation/);
  assert.equal(changed.written.size, 2, 'retain failed sealed evidence, never delete or overwrite it');
});
test('sealing is exclusively create-only, private, fsynced and read back without touching candidate state', () => {
  const calls = [], descriptors = new Map(), written = new Map(), file = receiptFile;
  const seal = functionVm('sealFile', {fs: {constants: fs.constants,
    openSync: (location, flags, mode) => {calls.push({kind: 'open', location, flags, mode}); const fd = descriptors.size + 10;
      if (location === file) {assert.equal(mode, 0o600); assert.ok(flags & fs.constants.O_EXCL); assert.ok(flags & fs.constants.O_CREAT);}
      else {assert.equal(location, p.operation); assert.equal(flags & fs.constants.O_WRONLY, 0);}
      descriptors.set(fd, location); return fd;},
    writeFileSync: (fd, bytes) => {assert.equal(descriptors.get(fd), file); written.set(file, Buffer.from(bytes));},
    fsyncSync: fd => {calls.push({kind: 'fsync', location: descriptors.get(fd)});},
    closeSync: fd => {assert.ok(descriptors.has(fd)); descriptors.delete(fd);}},
  ownedFile: (location, options) => {assert.equal(location, file); assert.equal(options.privateMode, true); return written.get(file);}});
  seal(file, 'receipt\n'); assert.equal(descriptors.size, 0);
  assert.deepEqual(calls.filter(call => call.kind === 'fsync').map(call => call.location), [file, p.operation]);
  assert.ok(calls.every(call => call.location !== paths['state.json']));
});

test('receipt verification proves scope and both candidate phases without production mutation', () => {
  const receipt = {schemaVersion: 1, kind: 'contact-wechat-staged-tool-repair', target: p.target, baseline: p.baseline,
    toolRevision: revision, originalStateSha256: p.stateSha256, originalBuildProofSha256: p.buildProofSha256,
    sourceInputsSha256: p.sourceInputsSha256, builtOutputSha256: p.builtOutputSha256, preservedFiles: {...pins},
    activeSha256: p.activeSha256, maintenanceSha256: p.maintenanceSha256, markerSha256: p.markerSha256,
    retentionHeadSha256: p.retentionHeadSha256, dependencySha256: p.dependencySha256, changedToolFiles: [...allowed].sort(),
    approvedNoRebuild: true, preparedAt: '2026-10-11T12:00:00.000Z'};
  const raw = Buffer.from(JSON.stringify(receipt)), calls = [];
  let corrupted = false, changedReceipt = false;
  const verify = functionVm('assertContactWechatStagedRepairCandidate', {receiptFile, ROOT: '/tool',
    process: {platform: 'linux', getuid: () => 0},
    ownedFile: () => changedReceipt && calls.length ? Buffer.from('{}') : raw,
    assertContactWechatStagedRepairReceipt: validateReceipt,
    verifySource: () => ({toolRevision: revision, changedToolFiles: [...allowed].sort(), sourceInputsSha256: p.sourceInputsSha256}),
    observe: (phase, options) => {calls.push({phase, options}); return {preservedFiles: pins,
      builtOutputSha256: p.builtOutputSha256, dependencySha256: corrupted ? '0'.repeat(64) : p.dependencySha256};}});
  for (const phase of ['preparing', 'ready-no-database']) {
    assert.equal(verify({target: p.target, phase}).toolRevision, revision);
    assert.equal(calls.at(-1).options.sealedOriginalRequired, true);
  }
  assert.throws(() => verify({target: p.baseline}), /receipt_target/);
  assert.throws(() => verify({target: p.target, phase: 'active'}), /receipt_target/);
  corrupted = true; assert.throws(() => verify({target: p.target}), /receipt_candidate_changed/);
  corrupted = false; calls.length = 0; changedReceipt = true;
  assert.throws(() => verify({target: p.target}), /receipt_changed/);
});
test('runtime command sites are read-only observations; source-only preparation is the sole delegated write', () => {
  const commands = [], writers = [];
  const visit = node => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'command') commands.push(node.getText(syntax));
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
      node.expression.expression.getText(syntax) === 'fs' && ['writeFileSync', 'openSync', 'fsyncSync'].includes(node.expression.name.text)) writers.push(node.getText(syntax));
    ts.forEachChild(node, visit);
  }; visit(syntax);
  assert.equal(commands.filter(call => call === "command('pm2', ['jlist'])").length, 2);
  assert.equal(commands.filter(call => call.startsWith("command('/usr/bin/node', [controller, 'status'])")).length, 1);
  assert.equal(commands.filter(call => call.startsWith("command('docker', ['--host', 'unix:///var/run/docker.sock', 'inspect'")).length, 1);
  assert.equal(commands.length, 4);
  assert.ok(writers.every(call => !/state\.json/.test(call)));
  assert.doesNotMatch(source, /\b(?:execSync|execFileSync|buildAttendanceOnlineCandidate|applyProductionDatabaseMigrations|activateCandidate|restoreConfigs|runOnlineRetentionUnderHeldLocks)\s*\(/);
  assert.doesNotMatch(source, /\bfs\.(?:rmSync|unlinkSync|renameSync|truncateSync|symlinkSync|mkdirSync)\s*\(/);
  assert.match(source, /assertOnlineToolNoPending\(\{fixedContactWechatStagedRepairReceipt: receipt\}\)/);
  assert.match(source, /attendanceRepairTreeFingerprint\(`\$\{p\.directory\}\/\.next`, \{exclude: \['cache', 'trace'\]\}\)/);
});
test('CLI admits only exact three positional arguments and rejects unrelated commands before production access', () => {
  for (const args of [[], ['status'], ['prepare', revision], ['prepare', revision, 'approved-contact-wechat-staged-tool-repair', '--force'],
    ['activate', revision, 'approved-contact-wechat-staged-tool-repair']])
    assert.throws(() => contactWechatStagedRepairMain(args), /invocation/);
  if (process.platform !== 'linux' || process.getuid?.() !== 0)
    assert.throws(() => prepareContactWechatStagedToolRepair(revision, 'approved-contact-wechat-staged-tool-repair'), /invocation/);
});
