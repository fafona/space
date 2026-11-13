import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {STORAGE_GIB as G, STORAGE_BASELINE, STORAGE_UNITS, storageEvent, planStorageCaches,
  storagePressure, storageUnitFiles, executeStorageEvent} from './release-toolchain-storage-policy.mjs';
import {storageFailure} from './release-toolchain-storage-host.mjs';
import {toolOnlySourcePath} from './release-toolchain-source.mjs';

const target = 'a'.repeat(40), baseline = 'b'.repeat(40), retired = '/www/wwwroot/merchant-space.web-releases/cccccccccccc-online';
const active = {target, directory: '/www/wwwroot/merchant-space.web-releases/aaaaaaaaaaaa-online', name: 'merchant-space-online-aaaaaaaaaaaa'};
const now = Date.parse('2026-11-13T23:00:00Z');
function completed() {
  return {kind: 'ordinary-application-publication-completed', target, baseline, mailEnabled: false, at: new Date(now - 60000).toISOString(),
    proof: {kind: 'ordinary-application-release-readonly-verified', target, baseline, certificateSha256: 'd'.repeat(64), manifestSha256: 'e'.repeat(64),
      rollbackRetained: true, savedProcessConfigurationVerified: true, otherProcessesUnchanged: true, businessDataWrittenByAudit: false, mailEnabled: false,
      at: new Date(now - 60000).toISOString(), naturalCycle: {status: 'completed', observedScheduledCycle: true},
      publicProof: ['https://faolla.com', 'https://launch.faolla.com'].map(origin => ({origin, status: 200, buildId: target}))}};
}
function eventInput() {return {active: structuredClone(active), completed: completed(), retentionHead: 'f'.repeat(64), now};}
test('complete current publication and head determine an idempotent event, not a build/preparing state', () => {
  const a = storageEvent(eventInput()); assert.equal(a.key.length, 64); assert.deepEqual(storageEvent(eventInput()), a);
  const changed = eventInput(); changed.retentionHead = '1'.repeat(64); assert.notEqual(storageEvent(changed).key, a.key);
  for (const change of [v => {v.completed.kind = 'preparing';}, v => {v.completed.target = baseline;},
    v => {v.completed.proof.rollbackRetained = false;}, v => {v.completed.proof.savedProcessConfigurationVerified = false;},
    v => {v.completed.proof.otherProcessesUnchanged = false;}, v => {v.completed.proof.businessDataWrittenByAudit = true;},
    v => {v.completed.proof.mailEnabled = true;}, v => {v.completed.proof.naturalCycle.status = 'pending';},
    v => {v.completed.proof.publicProof[1].buildId = baseline;}, v => {v.completed.proof.publicProof[1].origin = 'https://faolla.com';},
    v => {v.completed.proof.publicProof[0].status = 503;}, v => {v.completed.at = new Date(now + 1).toISOString();},
    v => {v.active.directory += '/..';}, v => {v.retentionHead = null;}]) {
    const v = eventInput(); change(v); assert.throws(() => storageEvent(v), /storage_lifecycle_/);
  }
});
function observation() {
  return {releaseDirectories: [retired, active.directory], certifiedStoppedDirectories: [retired], protectedDirectories: [active.directory],
    pm2: [{cwd: retired, name: 'merchant-space-online-cccccccccccc', executable: retired + '/node_modules/next/dist/bin/next',
      pid: 0, status: 'stopped', watch: false, cronRestart: null}]};
}
test('only unique, certified stopped web cache with all additive reference protections is selected', () => {
  assert.deepEqual(planStorageCaches(observation()), [{releaseDirectory: retired, cachePath: retired + '/.next/cache/webpack'}]);
  for (const mutate of [v => {v.certifiedStoppedDirectories = [];}, v => {v.certifiedStoppedDirectories.push(retired);},
    v => {v.pm2[0].pid = 2;}, v => {v.pm2[0].status = 'online';}, v => {v.pm2[0].watch = true;},
    v => {v.pm2[0].cronRestart = '* * * * *';}, v => {v.pm2.push({...v.pm2[0]});},
    v => {v.pm2[0].executable = retired + '/different';}, v => {v.pm2[0].name = 'unknown';},
    v => {v.protectedDirectories.push(retired + '/public');}, v => {v.protectedDirectories.push('/www/wwwroot');}]) {
    const v = observation(); mutate(v); assert.deepEqual(planStorageCaches(v), []);
  }
  assert.throws(() => planStorageCaches({}), /observation/);
});
test('30 GiB warning and existing 20 GiB critical floor; daily growth is not guessed from short intervals', () => {
  assert.deepEqual(storagePressure(32 * G).alerts, []);
  assert.equal(storagePressure(29 * G).alerts[0].severity, 'warning');
  assert.equal(storagePressure(19 * G).alerts[0].severity, 'critical');
  assert.equal(storagePressure(20 * G).alerts[0].code, 'low_free_space');
  const previous = {at: new Date(now - 86400000).toISOString(), availableBytes: 35 * G};
  const p = storagePressure(32 * G, previous, now); assert.equal(p.growthBytesPerDay, 3 * G);
  assert.equal(p.daysToBuildFloor, 4); assert.equal(p.alerts[0].code, 'growth_reaches_floor_within_week');
  assert.equal(storagePressure(36 * G, previous, now).alerts.length, 0);
  assert.equal(storagePressure(32 * G, {...previous, at: new Date(now - 1000).toISOString()}, now).growthBytesPerDay, null);
  for (const v of [-1, NaN, Infinity, 1.5]) assert.throws(() => storagePressure(v), /available_bytes/);
  assert.throws(() => storagePressure(G, {at: new Date(now + 1).toISOString(), availableBytes: G}, now), /previous_report/);
});
test('separate timers are bounded, low priority, persistent daily, no app control/restart or entrypoint parameters', () => {
  const units = storageUnitFiles(target); assert.deepEqual(Object.keys(units).sort(), [...STORAGE_UNITS].sort());
  assert.match(units['faolla-storage-daily.timer'], /OnCalendar=.*UTC\n[\s\S]*Persistent=true/);
  assert.match(units['faolla-storage-post-release.timer'], /OnUnitInactiveSec=5min/);
  assert.match(units['faolla-storage-post-release.timer'], /OnActiveSec=5min/);
  assert.doesNotMatch(units['faolla-storage-post-release.timer'], /OnBootSec=/);
  for (const name of ['faolla-storage-daily.service', 'faolla-storage-post-release.service']) {
    assert.match(units[name], /Nice=19/); assert.match(units[name], /CPUQuota=20%/); assert.match(units[name], /TimeoutStartSec=600/);
    assert.match(units[name], /MemoryMax=512M/); assert.doesNotMatch(units[name], /Restart=|ExecStart=[^\n]*pm2|publish|rm -/);
  }
  assert.throws(() => storageUnitFiles('../bad'), /revision/);
});
function execution(failure, status = 'absent') {
  const calls = [], event = storageEvent(eventInput());
  const ops = Object.fromEntries(['plan', 'preflight', 'prepare', 'apply', 'verify', 'complete', 'fail'].map(name => [name, () => {
    calls.push(name); if (name === failure) throw Error('private-secret'); return {synthetic: true};
  }]));
  ops.status = () => status; return {calls, run: () => executeStorageEvent(event, ops)};
}
test('qualification precedes durable intent; one attempt; completed is idempotent', () => {
  const f = execution(); assert.equal(f.run().status, 'completed');
  assert.deepEqual(f.calls, ['plan', 'preflight', 'prepare', 'apply', 'verify', 'complete']);
  const done = execution(null, 'completed'); assert.equal(done.run().status, 'already-completed'); assert.deepEqual(done.calls, []);
  for (const state of ['attempted', 'failed', 'prepared', 'unknown']) {
    const f = execution(null, state); assert.throws(f.run, /previous_attempt_requires_review/); assert.deepEqual(f.calls, []);
  }
});
test('failures and partial work never retry, continue deleting or clear evidence', () => {
  const order = ['plan', 'preflight', 'prepare', 'apply', 'verify', 'complete'];
  for (const point of order) {
    const f = execution(point); assert.throws(f.run, /private-secret/);
    assert.deepEqual(f.calls, [...order.slice(0, order.indexOf(point) + 1), ...(['apply', 'verify', 'complete'].includes(point) ? ['fail'] : [])]);
  }
  assert.equal(JSON.stringify(storageFailure(Error('secret token=value'))).includes('secret'), false);
});
test('daily report cannot call cleanup; runtime cannot stop processes or delete backups/dependencies/source', () => {
  const source = fs.readFileSync(new URL('./release-toolchain-storage-host.mjs', import.meta.url), 'utf8');
  const daily = source.slice(source.indexOf('export function dailyStorage'), source.indexOf('export function storageFailure'));
  assert.doesNotMatch(daily, /applyWebpack|unlinkSync|rmdirSync|executeStorageEvent|pollStorage/);
  assert.doesNotMatch(source, /process\.kill|rmSync|unlinkSync|rmdirSync|pm2[^\n]*(?:stop|delete|save|restart)|docker[^\n]*prune/);
  assert.match(source, /referenceGuard\(c.releaseDirectory/); assert.match(source, /assertEventCertificate/);
  assert.match(source, /withOnlineToolPreparationLocks/); assert.match(source, /inspectPinnedExecutionSource/);
  const installer = fs.readFileSync(new URL('./release-toolchain-storage-install.mjs', import.meta.url), 'utf8');
  for (const token of ['collectRemoteReleaseReview', 'assertReviewFresh', 'assertUnchangedApplicationSource', 'systemd-analyze',
    'initial_publication_changed', 'protectedPins()', 'already_attempted', 'existing_unit']) assert.ok(installer.includes(token), token);
  assert.doesNotMatch(installer, /rmSync|unlinkSync|rmdirSync|process\.kill/);
  assert.match(STORAGE_BASELINE, /^[a-f0-9]{40}$/);
  for (const name of ['policy', 'host', 'install']) assert.equal(toolOnlySourcePath('scripts/release-toolchain-storage-' + name + '.mjs'), true);
});

function actualPoll({entries = [], existing = false, completed = false, failed = false, busy = false, lockFailure = null, executeFailure = null} = {}) {
  const source = fs.readFileSync(new URL('./release-toolchain-storage-host.mjs', import.meta.url), 'utf8');
  const body = source.match(/export function pollStorage\(revision\) \{[\s\S]*?\n\}/)[0].replace('export ', '');
  const event = storageEvent(eventInput()), current = {event}, root = '/var/lib/faolla-storage-lifecycle';
  const events = [], location = root + '/events/' + event.key;
  const context = {STORAGE_ROOT: root, APP: '/www/wwwroot/merchant-space', MAINTENANCE: '/var/lib/faolla-maintenance/merchant-space',
    currentStorageEvent: () => current, need: (v, r) => {if (!v) throw Error('storage_lifecycle_' + r);},
    same: assert.deepEqual, ownedReleasePath: () => {}, JSON,
    fs: {readdirSync: () => entries.map(name => ({name, isDirectory: () => true, isSymbolicLink: () => false})),
      existsSync: file => file.endsWith('/operation.lock') ? busy : file.endsWith('/failed.json') ? failed : file.endsWith('/completed.json') ? completed : existing},
    storageRead: () => JSON.stringify({kind: 'storage-lifecycle-event-completed', event}),
    withOnlineToolPreparationLocks: (options, fn) => {events.push('lock'); if (lockFailure) throw lockFailure; return fn();},
    executeStorageEvent: (e, operations) => {events.push('execute'); if (executeFailure) throw executeFailure; return operations.status(e.key);},
  };
  const poll = vm.runInNewContext(body + '\npollStorage;', context);
  return {run: () => poll(target), events, event, location};
}
test('real poll entrypoint takes unchanged locks before a fresh event; no-op does not inventory processes', () => {
  const fresh = actualPoll(); assert.equal(fresh.run(), 'absent'); assert.deepEqual(fresh.events, ['lock', 'execute']);
  const event = storageEvent(eventInput());
  const done = actualPoll({entries: [event.key], completed: true});
  assert.equal(done.run().status, 'already-completed'); assert.deepEqual(done.events, []);
});
test('real poll blocks ALL prior incomplete events even when publication key changes; failure cannot masquerade as complete', () => {
  for (const fixture of [{entries: ['1'.repeat(64)]}, {entries: ['1'.repeat(64)], completed: true, failed: true}]) {
    const f = actualPoll(fixture); assert.throws(f.run, /previous_attempt_requires_review/); assert.deepEqual(f.events, []);
  }
  const f = actualPoll({entries: ['invalid']}); assert.throws(f.run, /event_layout/);
});
test('routine publication lock and exact acquisition races defer before destructive intent; unknown errors still fail', () => {
  const busy = actualPoll({busy: true}); assert.equal(busy.run().status, 'deferred-publication-busy'); assert.deepEqual(busy.events, []);
  for (const lockFailure of [Error('online_tool_deploy_lock_busy'), Object.assign(Error('private path'), {
    code: 'EEXIST', syscall: 'mkdir', path: '/var/lib/faolla-maintenance/merchant-space/operation.lock'})]) {
    const f = actualPoll({lockFailure}); assert.equal(f.run().status, 'deferred-publication-busy'); assert.deepEqual(f.events, ['lock']);
  }
  for (const lockFailure of [Error('storage_lifecycle_previous_attempt_requires_review'), Object.assign(Error('other'),
    {code: 'EEXIST', syscall: 'mkdir', path: '/unrelated'})]) assert.throws(actualPoll({lockFailure}).run);
  assert.throws(actualPoll({executeFailure: Error('online_tool_deploy_lock_busy')}).run, /deploy_lock_busy/,
    'an error after acquiring the fence cannot masquerade as harmless pre-intent deferral');
});
if (process.platform === 'linux') test('real Linux systemd parser accepts exact generated services and timers', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'faolla-storage-units-'));
  try {
    const files = storageUnitFiles(target);
    for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(root, name), text, {mode: 0o600});
    const result = spawnSync('/usr/bin/systemd-analyze', ['verify', ...Object.keys(files).map(name => path.join(root, name))],
      {encoding: 'utf8', timeout: 20000, env: {...process.env, SYSTEMD_LOG_LEVEL: 'warning'}});
    assert.equal(result.status, 0, result.stderr);
  } finally {fs.rmSync(root, {recursive: true, force: true});}
});
test('both mandatory CI invocations prepare the selected interpreter on disposable hosted runners only', () => {
  for (const name of ['ci.yml', 'release-toolchain.yml']) {
    const text = fs.readFileSync(new URL('../.github/workflows/' + name, import.meta.url), 'utf8');
    const step = text.match(/- name: Prepare Native Storage Interpreter Path\n([\s\S]*?)(?=\n      - name:)/)?.[1];
    assert.ok(step, name);
    assert.match(step, /test "\$GITHUB_ACTIONS" = true/);
    assert.match(step, /test "\$RUNNER_ENVIRONMENT" = github-hosted/);
    assert.match(step, /sudo -n install -m 755 "\$\(command -v node\)" \/usr\/bin\/node/);
    assert.doesNotMatch(step, /ssh|curl|wget|npm install|apt|dnf|\|\| true/);
  }
});
