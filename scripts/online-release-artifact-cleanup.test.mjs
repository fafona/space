import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {executeRetiredArtifactCleanup, reclaimPublicationArtifacts,
  assertNoRetiredArtifactReferences} from './online-release-artifact-cleanup.mjs';

function fixture(failure) {
  const events = [], tree = {synthetic: true}, result = {removedAllocatedBytes: 123};
  let verifies = 0;
  const action = name => (...args) => {
    events.push(name);
    if (failure === name) throw Error('private-token-must-not-escape');
    if (name === 'apply') {assert.strictEqual(args[0], tree); return result;}
    if (name === 'finish') assert.strictEqual(args[0], result);
  };
  const operations = Object.fromEntries(['begin', 'preserve', 'repairBackup', 'apply', 'finish'].map(n => [n, action(n)]));
  operations.verify = () => {
    verifies++; events.push('verify' + verifies);
    if (failure === 'verify' + verifies) throw Error('online_artifact_operational_state_changed');
  };
  operations.failed = value => events.push(['failed', value]);
  return {operations, events, plan: {tree}, result};
}
test('durable preparation and recovery precede backup repair and single tree deletion', () => {
  const f = fixture();
  assert.strictEqual(executeRetiredArtifactCleanup(f.plan, f.operations), f.result);
  assert.deepEqual(f.events, ['verify1', 'begin', 'preserve', 'repairBackup', 'verify2', 'apply', 'verify3', 'finish']);
});
for (const point of ['verify1', 'begin', 'preserve', 'repairBackup', 'verify2', 'apply', 'verify3', 'finish']) {
  test(`failure at ${point} never retries, rolls back or continues destructive work`, () => {
    const f = fixture(point); assert.throws(() => executeRetiredArtifactCleanup(f.plan, f.operations));
    assert.ok(f.events.filter(v => v === 'apply').length <= 1);
    const failure = f.events.find(v => Array.isArray(v));
    if (['verify1', 'begin'].includes(point)) assert.equal(failure, undefined);
    else {
      assert.equal(failure[0], 'failed');
      assert.doesNotMatch(JSON.stringify(failure), /private-token/);
      assert.equal(failure[1].partialCleanupPossible, ['apply', 'verify3', 'finish'].includes(point));
    }
    assert.deepEqual(f.plan, {tree: {synthetic: true}});
  });
}
for (const retentionResult of [undefined, {status: 'not-enabled'}, {status: 'pending', retired: 'a'.repeat(40)},
  {status: 'completed', retired: null}]) {
  test(`no new completed retirement means no filesystem access: ${JSON.stringify(retentionResult)}`, () => {
    assert.deepEqual(reclaimPublicationArtifacts({retentionResult}), {status: 'not-needed'});
  });
}
test('cannot mint or fake the publisher lock capability', () => {
  const result = reclaimPublicationArtifacts({state: {status: 'active'}, retentionResult: {status: 'completed', retired: 'a'.repeat(40)},
    toolRevision: 'b'.repeat(40), lock: {deployFd: 10}});
  assert.equal(result.status, 'pending'); assert.match(result.reason, /parent_locks_required/);
});

function referencesFixture() {
  const files = new Map(), links = new Map(), directories = new Map([['/proc', ['12']], ['/proc/12/fd', []]]);
  const target = '/www/wwwroot/merchant-space.web-releases/' + 'a'.repeat(12) + '-online';
  const row = {name: 'victim', pm_cwd: target, status: 'stopped', watch: false};
  let processes = [{pid: 0, pm2_env: row}], docker = '';
  const enoent = () => {throw Object.assign(Error('missing fixture path'), {code: 'ENOENT'});};
  const io = {
    readdirSync: (name, options) => options?.withFileTypes ? (directories.get(name) ?? []).map(leaf => ({name: leaf,
      isDirectory: () => directories.has(name + '/' + leaf), isSymbolicLink: () => links.has(name + '/' + leaf)})) : directories.get(name) ?? [],
    readFileSync: name => files.get(name) ?? '',
    readlinkSync: name => links.has(name) ? links.get(name) : enoent(),
    existsSync: name => files.has(name) || links.has(name) || directories.has(name),
    realpathSync: name => links.get(name) ?? name,
    statSync: name => ({isDirectory: () => directories.has(name), isFile: () => files.has(name), size: (files.get(name) ?? '').length}),
    lstatSync: name => ({isSymbolicLink: () => links.has(name), isDirectory: () => directories.has(name)}),
  };
  const run = (command, args) => command === 'pm2' ? JSON.stringify(processes) : args[0] === 'ps' ? 'container' : docker;
  return {target, files, links, directories, row, io, run, setProcesses: p => {processes = p;}, setDocker: d => {docker = d;},
    call: saved => assertNoRetiredArtifactReferences(target, saved ?? {main: [row], backup: [row]}, {io, run})};
}
test('reference check allows only its stopped own registration and saved rows', () => {referencesFixture().call();});
for (const leaf of ['cmdline', 'environ', 'maps']) test(`running ${leaf} reference blocks cleanup`, () => {
  const f = referencesFixture(); f.files.set('/proc/12/' + leaf, 'prefix:' + f.target); assert.throws(f.call, /external_reference/);
});
for (const leaf of ['cwd', 'exe', 'fd/5']) test(`running ${leaf} link reference blocks cleanup`, () => {
  const f = referencesFixture(); f.links.set('/proc/12/' + leaf, f.target + '/node_modules/x');
  if (leaf.startsWith('fd')) f.directories.set('/proc/12/fd', ['5']); assert.throws(f.call, /external_reference/);
});
test('same-device mount, container bind, scheduled reference and other PM2 environment each block', () => {
  for (const change of [
    f => f.files.set('/proc/self/mountinfo', f.target),
    f => f.setDocker('bind:' + f.target),
    f => f.files.set('/etc/crontab', 'node ' + f.target + '/run'),
    f => f.setProcesses([{pid: 9, pm2_env: {status: 'online', PWD: f.target}}]),
  ]) {const f = referencesFixture(); change(f); assert.throws(f.call, /external_reference/);}
});
test('saved online victim or another saved process reference is never ignored', () => {
  const f = referencesFixture();
  assert.throws(() => f.call({main: [f.row], backup: [{...f.row, status: 'online'}]}), /external_reference/);
  assert.throws(() => f.call({main: [f.row, {pm_cwd: '/other', PWD: f.target}], backup: [f.row]}), /external_reference/);
});
test('a not-yet-loaded deep live chunk or dependency link cannot be missed', () => {
  for (const suffix of ['.next/server/app/product', 'node_modules/library/internal']) {
    const f = referencesFixture(), root = '/www/wwwroot/merchant-space.web-releases/' + 'b'.repeat(12) + '-online';
    f.directories.set('/www/wwwroot/merchant-space.web-releases', [root.split('/').at(-1)]);
    let current = root;
    for (const part of suffix.split('/')) {f.directories.set(current, [part]); current += '/' + part;}
    f.directories.set(current, ['lazy.js']); f.links.set(current + '/lazy.js', f.target + '/node_modules/shared/chunk.js');
    assert.throws(() => f.call({main: [f.row], backup: [f.row], consumers: [root]}), /external_link_reference/);
  }
});
test('APP itself is an allowed live root, while an unknown live filesystem tree defers cleanup', () => {
  const f = referencesFixture(); f.directories.set('/www/wwwroot/merchant-space', []);
  f.call({main: [f.row], backup: [f.row], consumers: ['/www/wwwroot/merchant-space']});
  assert.throws(() => f.call({main: [f.row], backup: [f.row], consumers: ['/opt/unknown-service']}), /consumer_root_invalid/);
});
test('directory links into another managed code root are followed and deduplicated', () => {
  const f = referencesFixture(), base = '/www/wwwroot/merchant-space.web-releases';
  const a = base + '/' + 'b'.repeat(12) + '-online', b = base + '/' + 'c'.repeat(12) + '-online';
  f.directories.set(base, [a.split('/').at(-1), b.split('/').at(-1)]);
  f.directories.set(a, ['node_modules']); f.links.set(a + '/node_modules', b + '/deps');
  f.directories.set(b, ['deps']); f.directories.set(b + '/deps', ['cycle', 'lazy']);
  f.links.set(b + '/deps/cycle', a); f.links.set(b + '/deps/lazy', f.target + '/node_modules');
  assert.throws(() => f.call({main: [f.row], backup: [f.row], consumers: [a]}), /external_link_reference/);
});
test('unknown external code-directory link blocks instead of hiding a second-hop reference', () => {
  const f = referencesFixture(), a = '/www/wwwroot/merchant-space';
  f.directories.set(a, ['node_modules']); f.links.set(a + '/node_modules', '/opt/shared-code');
  f.directories.set('/opt/shared-code', []);
  assert.throws(() => f.call({main: [f.row], backup: [f.row], consumers: [a]}), /external_consumer_tree_requires_inspection/);
});
test('scope contains no recursive full-release prune, PM2 save/delete or npm build', () => {
  const code = fs.readFileSync(new URL('./online-release-artifact-cleanup.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(code, /rmSync|worktree.*remove|pm2.*\['(?:save|delete|restart)'|npm|readdirSync\([^\n]*node_modules/);
  assert.match(code, /exists\(location\).*attempt_exists_requires_inspection/);
  assert.match(code, /original-dump\.pm2/);
  assert.match(code, /assertOnlineRetentionHeldLocks\(lock\)/);
});
