import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeRetirementProcess} from './online-release-retirement.mjs';
import {ONLINE_RETENTION_POLICY, assertOnlineRetentionCertificate,
  retentionHash} from './online-release-retention-policy.mjs';
import {createRetiredArtifactContext, buildRetiredBackupReplacement} from './online-release-artifact-policy.mjs';

const sha = c => c.repeat(40), hash = c => c.repeat(64), clone = value => structuredClone(value);
const directoryOf = target => `/www/wwwroot/merchant-space.web-releases/${target.slice(0, 12)}-online`;
function raw(target, id, port) {
  const name = `merchant-space-online-${target.slice(0, 12)}`, cwd = directoryOf(target);
  return {name, pm_id: id, pid: 2000 + id, pm2_env: {name, status: 'online', pm_cwd: cwd,
    pm_exec_path: `${cwd}/node_modules/next/dist/bin/next`, exec_interpreter: '/usr/bin/node',
    args: ['start', '-H', '127.0.0.1', '-p', String(port)], PORT: String(port), node_args: [],
    exec_mode: 'fork_mode', autorestart: true, watch: false, cron_restart: null,
    restart_time: 0, created_at: 1000 + id, kill_timeout: 1600, shutdown_with_message: false,
    FAOLLA_BACKGROUND_JOBS_PAUSED: '1', MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED: '0',
    MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED: '0', env: {PORT: String(port), SYNTHETIC_ONLY: 'private-value'}}};
}
function fixture({afterRollback = false} = {}) {
  const activeRaw = raw(sha('c'), 3, 3103), stableRaw = raw(sha(afterRollback ? 'a' : 'b'), 2, 3104);
  const victimRaw = raw(sha(afterRollback ? 'b' : 'a'), 1, 3105);
  const active = normalizeRetirementProcess(activeRaw), stable = normalizeRetirementProcess(stableRaw);
  const victim = normalizeRetirementProcess(victimRaw), stopped = {...clone(victim), pid: 0, status: 'stopped'};
  const anchor = p => ({target: p === active ? sha('c') : sha(afterRollback ? 'a' : 'b'),
    name: p.name, directory: p.cwd, port: p.port, process: clone(p)});
  const certificate = {version: 2, policy: ONLINE_RETENTION_POLICY, kind: 'retire', status: 'completed', sequence: 3,
    previousSha256: hash('1'), legacySha256: hash('2'), rollingHeadSha256: hash('3'), rollingHistorySha256: hash('4'),
    beforeSha256: hash('5'), afterSha256: hash('6'), preparedSha256: hash('7'), recoverySha256: hash('8'),
    toolRevision: sha('d'), completedAt: '2026-09-29T12:00:00.000Z', active: anchor(active), rollback: anchor(stable),
    victim: {target: sha(afterRollback ? 'b' : 'a'), process: clone(victim)}, stoppedProcess: stopped,
    processes: [clone(stopped), clone(stable), clone(active)]};
  assertOnlineRetentionCertificate(certificate);
  const history = {version: 2, policy: ONLINE_RETENTION_POLICY, entries: [certificate], headSha256: retentionHash(certificate)};
  const state = {status: 'active', target: certificate.active.target, name: active.name, directory: active.cwd, port: active.port};
  const retentionResult = {status: 'completed', retired: certificate.victim.target};
  const observation = {retentionHead: history.headSha256, certifiedStoppedDirectories: [victim.cwd],
    protectedDirectories: [active.cwd, stable.cwd, '/base/worker'], pm2: clone(certificate.processes)};
  const main = [clone(activeRaw.pm2_env), {...clone(victimRaw.pm2_env), status: 'stopped'}, clone(stableRaw.pm2_env)];
  const backup = [clone(stableRaw.pm2_env), clone(victimRaw.pm2_env), clone(activeRaw.pm2_env)];
  return {state, retentionResult, history, observation, certificate, main, backup};
}
function rehash(f) {f.history.headSha256 = retentionHash(f.certificate); f.observation.retentionHead = f.history.headSha256;}
function freeze(value) {if (value && typeof value === 'object') {Object.values(value).forEach(freeze);Object.freeze(value);}return value;}

test('creates a single exact newly retired context without retaining caller-owned objects', () => {
  const f = fixture(), before = clone(f); freeze(f);
  const result = createRetiredArtifactContext(f);
  assert.deepEqual(result, {directory: f.certificate.victim.process.cwd, victim: f.certificate.victim,
    certificateSha256: retentionHash(f.certificate), activeTarget: f.state.target, retentionHead: f.history.headSha256});
  result.victim.process.args.push('not-input');assert.deepEqual(f, before);
});
test('after a rollback, the failed former active may retire while the restored stable version remains protected', () => {
  const f = fixture({afterRollback: true});
  assert.equal(createRetiredArtifactContext(f).victim.target, sha('b'));
  assert.equal(f.certificate.rollback.target, sha('a'));
  assert.equal(buildRetiredBackupReplacement(f).changed, true);
});
for (const status of ['staged', 'activating', 'rolled-back', null]) test(`rejects application status ${status}`, () => {
  const f = fixture();f.state.status = status;assert.throws(() => createRetiredArtifactContext(f), /publication_not_active/);
});
for (const retired of [null, undefined, '', sha('a') + '\n', sha('a').toUpperCase(), '../other']) test(`rejects non-new or invalid victim ${String(retired)}`, () => {
  const f = fixture();f.retentionResult.retired = retired;assert.throws(() => createRetiredArtifactContext(f), /no_new_retirement/);
});
test('does not clean pending or disabled retention', () => {
  for (const status of ['pending', 'not-enabled']) {const f = fixture();f.retentionResult.status = status;assert.throws(() => createRetiredArtifactContext(f), /no_new_retirement/);}
});
test('requires a validated-reader-shaped v2 history and its exact latest certificate hash', () => {
  for (const patch of [{version: 1}, {policy: 'different'}, {entries: []}, {headSha256: hash('0')}]) {
    const f = fixture();Object.assign(f.history, patch);assert.throws(() => createRetiredArtifactContext(f), /history_invalid|certificate_head_changed/);
  }
  const f = fixture();f.observation.retentionHead = hash('0');assert.throws(() => createRetiredArtifactContext(f), /observation_head_changed/);
});
test('the latest certificate must be completed and retire this victim under this active', () => {
  for (const change of [f => {f.certificate.status = 'prepared';}, f => {f.certificate.kind = 'converge';},
    f => {f.retentionResult.retired = sha('e');}, f => {f.state.target = sha('e');}]) {
    const f = fixture();change(f);rehash(f);assert.throws(() => createRetiredArtifactContext(f), /certificate_|retired_target_changed|active_target_changed/);
  }
});
test('rejects changed publication identity without changing unrelated state', () => {
  for (const key of ['name', 'directory', 'port']) {const f = fixture();f.state[key] = 'other';assert.throws(() => createRetiredArtifactContext(f), /publication_identity_changed/);}
});
test('rejects a forged victim executable even when certificate structural checks accept it', () => {
  const f = fixture();f.certificate.victim.process.executable = '/outside/node';
  f.certificate.stoppedProcess.executable = '/outside/node';f.certificate.processes[0].executable = '/outside/node';rehash(f);
  assert.throws(() => createRetiredArtifactContext(f), /victim_path_changed/);
  assert.throws(() => buildRetiredBackupReplacement(f), /victim_path_changed/);
});
test('rejects a noncanonical victim directory or mismatched stopped proof', () => {
  for (const change of [f => {f.certificate.victim.process.cwd += '/child';},
    f => {f.certificate.stoppedProcess.pid = 1;}, f => {f.certificate.stoppedProcess.status = 'online';}]) {
    const f = fixture();change(f);rehash(f);assert.throws(() => createRetiredArtifactContext(f), /certificate_invalid/);
  }
});
test('requires one certified directory and one exact victim PM2 record', () => {
  for (const change of [f => {f.observation.certifiedStoppedDirectories = [];},
    f => {f.observation.certifiedStoppedDirectories.push(f.observation.certifiedStoppedDirectories[0]);},
    f => {f.observation.pm2.shift();}, f => {f.observation.pm2.push(clone(f.observation.pm2[0]));},
    f => {f.observation.pm2.push({...clone(f.observation.pm2[0]), name: 'alias', pmId: 77});}]) {
    const f = fixture();change(f);assert.throws(() => createRetiredArtifactContext(f), /victim_not_certified|victim_process_not_unique/);
  }
});
for (const [key, value] of [['pid', 9], ['status', 'online'], ['watch', true], ['cronRestart', '* * * * *'],
  ['cwd', '/other'], ['environmentSha256', hash('e')]]) test(`rejects changed live victim ${key}`, () => {
  const f = fixture();f.observation.pm2[0][key] = value;assert.throws(() => createRetiredArtifactContext(f), /victim_process_changed/);
});
test('cannot clean protected roots, ancestors or descendants; similarly-prefixed siblings are unrelated', () => {
  for (const suffix of ['', '/node_modules']) {const f = fixture();f.observation.protectedDirectories.push(f.certificate.victim.process.cwd + suffix);assert.throws(() => createRetiredArtifactContext(f), /protected_target/);}
  for (const p of ['/', '/www/wwwroot/merchant-space.web-releases']) {const f = fixture();f.observation.protectedDirectories.push(p);assert.throws(() => createRetiredArtifactContext(f), /protected_target/);}
  const f = fixture();f.observation.protectedDirectories.push(f.certificate.victim.process.cwd + '-sibling');assert.ok(createRetiredArtifactContext(f));
});
test('rejects malformed protection paths rather than comparing ambiguous strings', () => {
  for (const p of [null, '../other', '/base/../worker', '/base/worker/', '/base/worker\n']) {
    const f = fixture();f.observation.protectedDirectories.push(p);assert.throws(() => createRetiredArtifactContext(f), /protection_invalid/);
  }
});
test('keeps current and rollback processes exact and rejects new processes since retirement', () => {
  for (const change of [f => {f.observation.pm2[1].pid++;}, f => {f.observation.pm2[2].status = 'stopped';},
    f => {f.observation.pm2.push(normalizeRetirementProcess(raw(sha('f'), 8, 3108)));}]) {
    const f = fixture();change(f);assert.throws(() => createRetiredArtifactContext(f), /process_set_changed/);
  }
  const f = fixture();f.observation.pm2.reverse();assert.ok(createRetiredArtifactContext(f));
});
test('rejects scheduled certificates even for legacy disabled cron representations', () => {
  for (const value of [false, '0', '* * * * *']) {
    const f = fixture();for (const p of [f.certificate.victim.process, f.certificate.stoppedProcess, f.certificate.processes[0]]) p.cronRestart = value;
    rehash(f);assert.throws(() => createRetiredArtifactContext(f), /certificate_invalid|victim_restart_enabled/);
  }
});
test('backup replacement changes only one exact row, retaining backup order and unrelated data', () => {
  const f = fixture();f.backup[0].extraPrivate = {data: ['keep-exactly']};const before = clone(f);freeze(f);
  const {replacement, changed} = buildRetiredBackupReplacement(f);
  assert.equal(changed, true);assert.deepEqual(replacement, [f.backup[0], f.main[1], f.backup[2]]);
  replacement[0].extraPrivate.data.push('new');replacement[1].env.SYNTHETIC_ONLY = 'new';assert.deepEqual(f, before);
});
test('an already identical stopped backup is a detached no-op', () => {
  const f = fixture();f.backup[1] = clone(f.main[1]);const {replacement, changed} = buildRetiredBackupReplacement(f);
  assert.equal(changed, false);assert.deepEqual(replacement, f.backup);assert.notEqual(replacement[1], f.backup[1]);
});
for (const source of ['main', 'backup']) {
  test(`${source} must contain one exact target, not missing, duplicates or identity aliases`, () => {
    for (const change of [f => {f[source].splice(1, 1);}, f => {f[source].push(clone(f[source][1]));},
      f => {f[source].push({...clone(f[source][1]), name: 'alias'});}]) {
      const f = fixture();change(f);assert.throws(() => buildRetiredBackupReplacement(f), /target_not_unique/);
    }
  });
  for (const key of ['name', 'pm_cwd', 'pm_exec_path']) test(`${source} ${key} cannot change`, () => {
    const f = fixture();f[source][1][key] = 'different';assert.throws(() => buildRetiredBackupReplacement(f), /identity_changed/);
  });
  for (const [key, value] of [['instances', 1], ['instances', 0], ['instances', null], ['pm_id', 1],
    ['watch', true], ['watch', undefined], ['cron_restart', '0'], ['cron_restart', false], ['cron_restart', '* * * * *']]) {
    test(`${source} rejects unsafe restore ${key}=${String(value)}`, () => {
      const f = fixture();f[source][1][key] = value;assert.throws(() => buildRetiredBackupReplacement(f), /recovery_unsafe/);
    });
  }
  for (const change of [row => {row.env.SYNTHETIC_ONLY = 'changed';}, row => {row.PORT = '3107';},
    row => {row.args.push('--changed');}, row => {row.exec_interpreter = '/other/node';},
    row => {row.restart_time++;}, row => {row.FAOLLA_BACKGROUND_JOBS_PAUSED = '0';}]) {
    test(`${source} rejects normalized identity/environment changes ${change.toString()}`, () => {
      const f = fixture();change(f[source][1]);assert.throws(() => buildRetiredBackupReplacement(f), /process_changed/);
    });
  }
  test(`${source} invalid arrays fail closed`, () => {
    for (const value of [null, {}, [null], ['bad']]) {const f = fixture();f[source] = value;assert.throws(() => buildRetiredBackupReplacement(f), /dump_invalid/);}
  });
}
test('main must already be stopped, and backup permits only certified online or stopped status', () => {
  const f = fixture();f.main[1].status = 'online';assert.throws(() => buildRetiredBackupReplacement(f), /main_not_stopped/);
  for (const status of ['stopping', 'errored', 'launching', undefined]) {const g = fixture();g.backup[1].status = status;assert.throws(() => buildRetiredBackupReplacement(g), /backup_status_invalid/);}
});
test('allows omitted cron only when its normalized null matches the certificate', () => {
  const f = fixture();delete f.main[1].cron_restart;delete f.backup[1].cron_restart;assert.equal(buildRetiredBackupReplacement(f).changed, true);
});
test('invalid input and failed checks do not mutate caller-owned evidence', () => {
  assert.throws(() => createRetiredArtifactContext(), /publication_not_active/);
  assert.throws(() => buildRetiredBackupReplacement(), /certificate_invalid/);
  const f = fixture();f.backup[1].env.SYNTHETIC_ONLY = 'wrong';const before = clone(f);freeze(f);
  assert.throws(() => buildRetiredBackupReplacement(f), /backup_process_changed/);assert.deepEqual(f, before);
});
