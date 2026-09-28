import test from 'node:test';
import assert from 'node:assert/strict';
import {executeCacheCleanup, releaseMountReferences, selectPm2CacheProtection} from './online-release-cache-cleanup.mjs';
import {planReleaseCacheCleanup} from './online-release-cache-policy.mjs';
import {normalizeRetirementProcess} from './online-release-retirement.mjs';

// Execute the real orchestration and its real production-path eligibility
// policy. All observations, cache I/O and audit writes below are in-memory ports;
// this suite does not invoke the production CLI, filesystem cleanup or servers.
const clone = value => structuredClone(value);
const freeze = value => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};
const directories = [
  '/www/wwwroot/merchant-space.web-releases/aaaaaaaaaaaa-online',
  '/www/wwwroot/merchant-space.releases/bbbbbbbbbbbb-20260928123456',
];
const live = '/www/wwwroot/merchant-space.web-releases/cccccccccccc-online';

function fixture() {
  const observation = {version: 1, toolRevision: 'a'.repeat(40),
    releaseDirectories: [...directories, live], protectedDirectories: [live],
    activeSha256: 'b'.repeat(64), historyHead: 'c'.repeat(64),
    pm2: [{name: 'synthetic-live', pid: 123, cwd: live}],
    stateHashes: {'/var/lib/faolla-online-release/synthetic/state.json': 'd'.repeat(64)},
  };
  const caches = directories.map((releaseDirectory, index) => ({version: 1, kind: 'webpack-cache',
    releaseDirectory, cachePath: `${releaseDirectory}/.next/cache/webpack`,
    fileCount: index + 1, totalBytes: (index + 1) * 10,
    entries: [{relativePath: 'synthetic.pack', sha256: String(index).repeat(64)}],
  }));
  const plan = freeze({version: 1, toolRevision: observation.toolRevision, observation, caches});
  const events = [], records = [], failures = [], failureContexts = [], completions = [], captures = new Set();
  let observations = 0;
  const cacheIndex = filename => caches.findIndex(item => item.cachePath === filename);
  const operations = {
    observe() { events.push(`observe:${++observations}`); return clone(observation); },
    capture(filename) {
      const index = cacheIndex(filename);
      assert.notEqual(index, -1, 'only an exact planned cache may be captured');
      events.push(`capture:${index}`); captures.add(index); return clone(caches[index]);
    },
    begin() { events.push('begin'); },
    apply(cache) {
      const index = cacheIndex(cache.cachePath);
      assert.equal(captures.size, caches.length, 'every planned cache must pass preflight before any deletion');
      assert.strictEqual(cache, caches[index], 'apply receives the approved snapshot itself');
      events.push(`apply:${index}`);
      return {removedFiles: cache.fileCount, removedDirectories: 1, removedBytes: cache.totalBytes, cacheRootRetained: true};
    },
    record(index, value) { events.push(`record:${index}`); records.push({index, value: clone(value)}); },
    finish(values) { events.push('finish'); completions.push(clone(values)); },
    failed(values, error, context) {
      events.push('failed'); failures.push({values: clone(values), error}); failureContexts.push(clone(context));
    },
  };
  return {plan, operations, events, records, failures, failureContexts, completions, caches, observation};
}
const noMutation = f => {
  assert.equal(f.events.some(value => /^(?:begin|apply:|record:|finish|failed)/.test(value)), false);
  assert.deepEqual(f.records, []); assert.deepEqual(f.failures, []); assert.deepEqual(f.completions, []);
};

test('successful execution verifies all caches first, audits each result, then verifies final observation', () => {
  const f = fixture(), before = JSON.stringify(f.plan);
  const result = executeCacheCleanup(f.plan, f.operations);
  assert.deepEqual(f.events, ['observe:1', 'capture:0', 'capture:1', 'begin',
    'observe:2', 'apply:0', 'record:1', 'observe:3', 'apply:1', 'record:2', 'observe:4', 'finish']);
  assert.deepEqual(result, f.caches.map(cache => ({cachePath: cache.cachePath, removedFiles: cache.fileCount,
    removedDirectories: 1, removedBytes: cache.totalBytes, cacheRootRetained: true})));
  assert.deepEqual(f.records, result.map((value, index) => ({index: index + 1, value})));
  assert.deepEqual(f.completions, [result]); assert.deepEqual(f.failures, []);
  assert.equal(JSON.stringify(f.plan), before);
});

test('invalid plan envelope is rejected before observation or audit writes', () => {
  for (const transform of [() => null, plan => ({...plan, version: 2}), plan => ({...plan, toolRevision: 'not-a-sha'}),
    plan => ({...plan, caches: null}), plan => ({...plan, observation: null})]) {
    const f = fixture();
    assert.throws(() => executeCacheCleanup(transform(f.plan), f.operations), /release_cache_invalid_plan/);
    assert.deepEqual(f.events, []); noMutation(f);
  }
});

for (const field of ['activeSha256', 'historyHead', 'pm2', 'stateHashes', 'protectedDirectories', 'certifiedStoppedDirectories']) {
  test(`initial ${field} observation drift rejects before capture or deletion`, () => {
    const f = fixture(), observe = f.operations.observe;
    f.operations.observe = () => {
      const value = observe();
      value[field] = field === 'protectedDirectories' ? [...value[field], directories[0]] : {changed: true};
      return value;
    };
    assert.throws(() => executeCacheCleanup(f.plan, f.operations), /release_cache_observation_changed/);
    assert.deepEqual(f.events, ['observe:1']); noMutation(f);
  });
}

test('real policy rejects a protected candidate even when the captured snapshot is otherwise plausible', () => {
  const f = fixture(), plan = clone(f.plan);
  plan.caches[0].releaseDirectory = live;
  plan.caches[0].cachePath = `${live}/.next/cache/webpack`;
  assert.throws(() => executeCacheCleanup(plan, f.operations), /release_cache_candidate_not_eligible/);
  assert.deepEqual(f.events, ['observe:1']); noMutation(f);
});

test('real policy rejects unlisted, outside-root, static and sibling-cache candidates', () => {
  for (const cachePath of ['/www/wwwroot/merchant-space.web-releases/dddddddddddd-online/.next/cache/webpack',
    '/var/lib/faolla-online-code/' + 'e'.repeat(40) + '/.next/cache/webpack',
    `${directories[0]}/.next/static`, `${directories[0]}/.next/cache/images`, `${directories[0]}/.next/cache/webpack/child`]) {
    const f = fixture(), plan = clone(f.plan); plan.caches[0].cachePath = cachePath;
    assert.throws(() => executeCacheCleanup(plan, f.operations), /release_cache_candidate_not_eligible/);
    assert.deepEqual(f.events, ['observe:1']); noMutation(f);
  }
});

test('duplicate cache paths reject before any captures, even with different manifest fields', () => {
  const f = fixture(), plan = clone(f.plan);
  plan.caches[1] = {...plan.caches[0], totalBytes: 999};
  assert.throws(() => executeCacheCleanup(plan, f.operations), /release_cache_candidate_not_eligible/);
  assert.deepEqual(f.events, ['observe:1']); noMutation(f);
});

test('first cache drift rejects with zero cleanup mutations', () => {
  const f = fixture(), capture = f.operations.capture;
  f.operations.capture = filename => ({...capture(filename), totalBytes: 999});
  assert.throws(() => executeCacheCleanup(f.plan, f.operations), /release_cache_cache_changed/);
  assert.deepEqual(f.events, ['observe:1', 'capture:0']); noMutation(f);
});

test('second cache drift cannot cause deletion of the already-validated first cache', () => {
  const f = fixture(), capture = f.operations.capture;
  f.operations.capture = filename => {
    const value = capture(filename);
    if (filename === f.caches[1].cachePath) value.entries[0].sha256 = 'f'.repeat(64);
    return value;
  };
  assert.throws(() => executeCacheCleanup(f.plan, f.operations), /release_cache_cache_changed/);
  assert.deepEqual(f.events, ['observe:1', 'capture:0', 'capture:1']); noMutation(f);
});

test('second capture filesystem failure propagates before beginning the attempt', () => {
  const f = fixture(), capture = f.operations.capture, error = Error('online_cache_filesystem_failure');
  f.operations.capture = filename => {
    const value = capture(filename);
    if (filename === f.caches[1].cachePath) throw error;
    return value;
  };
  assert.throws(() => executeCacheCleanup(f.plan, f.operations), value => value === error);
  assert.deepEqual(f.events, ['observe:1', 'capture:0', 'capture:1']); noMutation(f);
});

test('observation drift immediately after beginning is audited with no applied results', () => {
  const f = fixture(), observe = f.operations.observe;
  let count = 0;
  f.operations.observe = () => {const value = observe(); if (++count === 2) value.historyHead = 'f'.repeat(64); return value;};
  assert.throws(() => executeCacheCleanup(f.plan, f.operations), /release_cache_observation_changed/);
  assert.deepEqual(f.events, ['observe:1', 'capture:0', 'capture:1', 'begin', 'observe:2', 'failed']);
  assert.deepEqual(f.failures, [{values: [], error: 'release_cache_observation_changed'}]);
  assert.deepEqual(f.failureContexts, [{attemptedCachePath: null, partialCleanupPossible: false}]);
  assert.deepEqual(f.records, []); assert.deepEqual(f.completions, []);
});

test('first apply failure records failure without claiming partial deletion was successful or retrying', () => {
  const f = fixture(), error = Error('online_cache_tree_changed');
  f.operations.apply = () => {f.events.push('apply:0'); throw error;};
  assert.throws(() => executeCacheCleanup(f.plan, f.operations), value => value === error);
  assert.deepEqual(f.events, ['observe:1', 'capture:0', 'capture:1', 'begin', 'observe:2', 'apply:0', 'failed']);
  assert.deepEqual(f.failures, [{values: [], error: error.message}]);
  assert.deepEqual(f.failureContexts, [{attemptedCachePath: f.caches[0].cachePath, partialCleanupPossible: true}]);
  assert.deepEqual(f.records, []); assert.deepEqual(f.completions, []);
});

test('second apply failure keeps the first durable result and does not finish or retry either cache', () => {
  const f = fixture(), apply = f.operations.apply, error = Error('online_cache_file_changed');
  f.operations.apply = cache => {
    if (cache === f.caches[1]) {f.events.push('apply:1'); throw error;}
    return apply(cache);
  };
  assert.throws(() => executeCacheCleanup(f.plan, f.operations), value => value === error);
  assert.deepEqual(f.events, ['observe:1', 'capture:0', 'capture:1', 'begin',
    'observe:2', 'apply:0', 'record:1', 'observe:3', 'apply:1', 'failed']);
  assert.equal(f.records.length, 1);
  assert.deepEqual(f.failures, [{values: [f.records[0].value], error: error.message}]);
  assert.deepEqual(f.failureContexts, [{attemptedCachePath: f.caches[1].cachePath, partialCleanupPossible: true}]);
  assert.deepEqual(f.completions, []);
});

test('between-cache observation drift preserves the first result and prevents touching the second cache', () => {
  const f = fixture(), observe = f.operations.observe;
  let count = 0;
  f.operations.observe = () => {const value = observe(); if (++count === 3) value.pm2[0].pid++; return value;};
  assert.throws(() => executeCacheCleanup(f.plan, f.operations), /release_cache_observation_changed/);
  assert.deepEqual(f.events, ['observe:1', 'capture:0', 'capture:1', 'begin',
    'observe:2', 'apply:0', 'record:1', 'observe:3', 'failed']);
  assert.deepEqual(f.failures, [{values: [f.records[0].value], error: 'release_cache_observation_changed'}]);
  assert.deepEqual(f.failureContexts, [{attemptedCachePath: null, partialCleanupPossible: false}]);
  assert.deepEqual(f.completions, []);
});

test('per-cache receipt failure is audited with the completed deletion, and no later cache is touched', () => {
  const f = fixture(), error = Error('synthetic_receipt_failed');
  f.operations.record = () => {f.events.push('record:1'); throw error;};
  assert.throws(() => executeCacheCleanup(f.plan, f.operations), value => value === error);
  assert.deepEqual(f.events, ['observe:1', 'capture:0', 'capture:1', 'begin', 'observe:2', 'apply:0', 'record:1', 'failed']);
  assert.equal(f.failures.length, 1);
  assert.equal(f.failures[0].values.length, 1);
  assert.equal(f.failures[0].values[0].cachePath, f.caches[0].cachePath);
  assert.equal(f.failures[0].error, error.message);
  assert.deepEqual(f.failureContexts, [{attemptedCachePath: f.caches[0].cachePath, partialCleanupPossible: true}]);
  assert.deepEqual(f.completions, []);
});

test('final observation drift records all completed cache results but refuses successful completion', () => {
  const f = fixture(), observe = f.operations.observe;
  let count = 0;
  f.operations.observe = () => {const value = observe(); if (++count === 4) value.activeSha256 = 'f'.repeat(64); return value;};
  assert.throws(() => executeCacheCleanup(f.plan, f.operations), /release_cache_protected_state_changed/);
  assert.deepEqual(f.events, ['observe:1', 'capture:0', 'capture:1', 'begin',
    'observe:2', 'apply:0', 'record:1', 'observe:3', 'apply:1', 'record:2', 'observe:4', 'failed']);
  assert.deepEqual(f.failures, [{values: f.records.map(item => item.value), error: 'release_cache_protected_state_changed'}]);
  assert.deepEqual(f.failureContexts, [{attemptedCachePath: null, partialCleanupPossible: false}]);
  assert.deepEqual(f.completions, []);
});

test('completion receipt failure cannot return a successful cleanup result', () => {
  const f = fixture(), error = Error('synthetic_completion_receipt_failed');
  f.operations.finish = () => {f.events.push('finish'); throw error;};
  assert.throws(() => executeCacheCleanup(f.plan, f.operations), value => value === error);
  assert.deepEqual(f.events.slice(-3), ['observe:4', 'finish', 'failed']);
  assert.deepEqual(f.failures, [{values: f.records.map(item => item.value), error: error.message}]);
  assert.deepEqual(f.failureContexts, [{attemptedCachePath: null, partialCleanupPossible: false}]);
  assert.deepEqual(f.completions, []);
});

test('prepared receipt failure prevents any deletion without claiming the attempt began successfully', () => {
  const f = fixture(), error = Error('synthetic_prepared_receipt_failed');
  f.operations.begin = () => {f.events.push('begin'); throw error;};
  assert.throws(() => executeCacheCleanup(f.plan, f.operations), value => value === error);
  assert.deepEqual(f.events, ['observe:1', 'capture:0', 'capture:1', 'begin']);
  assert.deepEqual(f.failures, []); assert.deepEqual(f.records, []); assert.deepEqual(f.completions, []);
});

const mountLine = (id, location, device = '8:1', sourceRoot = '/') =>
  `${id} 25 ${device} ${sourceRoot} ${location} rw,relatime shared:1 - ext4 /dev/synthetic rw\n`;

test('mount references protect same-device bind mounts as well as different-device mounts', () => {
  const first = `${directories[0]}/.next/cache/webpack/client`;
  const second = `${directories[1]}/.next/cache/webpack/server`;
  const input = mountLine(1, '/') + mountLine(2, first, '8:1', '/protected-static') +
    mountLine(3, second, '9:9') + mountLine(4, first, '8:1', '/duplicate');
  assert.deepEqual(releaseMountReferences(input), [first, second].sort());
  const planned = planReleaseCacheCleanup({releaseDirectories: directories, protectedDirectories: releaseMountReferences(input)});
  assert.equal(planned.eligible.length, 0);
  assert.equal(planned.excluded.length, 2);
  assert.ok(planned.excluded.every(item => item.reason === 'protected_directory'));
});

test('mounting a release container or any nested path protects only overlapping release families', () => {
  const roots = ['/www/wwwroot/merchant-space.releases', '/www/wwwroot/merchant-space.route-releases',
    '/www/wwwroot/merchant-space.web-releases'];
  assert.deepEqual(releaseMountReferences(roots.map((root, index) => mountLine(index + 1, root)).join('')), roots.sort());
  const input = mountLine(1, '/') + mountLine(2, '/www') + mountLine(3, '/www/wwwroot') +
    mountLine(4, '/www/wwwroot/merchant-space.web-releases-extra/old');
  assert.deepEqual(releaseMountReferences(input), []);
  assert.equal(planReleaseCacheCleanup({releaseDirectories: directories, protectedDirectories: releaseMountReferences(input)}).eligible.length, 2);
});

test('mountinfo escaped spaces and backslashes decode without depending on mount device IDs', () => {
  const prefix = `${directories[0]}/.next/cache/webpack`;
  assert.deepEqual(releaseMountReferences(mountLine(1, `${prefix}/space\\040directory`) +
    mountLine(2, `${prefix}/back\\134slash`, '0:42')), [`${prefix}/back\\slash`, `${prefix}/space directory`]);
});

test('malformed, relative and control-containing mount lines fail closed', () => {
  for (const text of ['', 'incomplete mount line', '1 2 8:1 / /mount rw ext4 /dev/a rw extra',
    mountLine(1, 'relative/path'), mountLine(1, `${directories[0]}/bad\\011tab`),
    mountLine(1, `${directories[0]}/bad\\012newline`), mountLine(1, `${directories[0]}/bad\\000nul`)])
    assert.throws(() => releaseMountReferences(text), /release_cache_mountinfo_invalid/);
});

function stoppedFixture() {
  const target = 'a'.repeat(40), cwd = directories[0], name = 'merchant-space-online-aaaaaaaaaaaa';
  const row = normalizeRetirementProcess({name, pm_id: 7, pid: 0, pm2_env: {
    pm_cwd: cwd, status: 'stopped', PORT: '3104', pm_exec_path: `${cwd}/node_modules/next/dist/bin/next`,
    exec_interpreter: '/usr/bin/node', args: ['start', '-H', '127.0.0.1', '-p', '3104'], node_args: [],
    exec_mode: 'fork_mode', autorestart: true, watch: false, cron_restart: null,
    FAOLLA_BACKGROUND_JOBS_PAUSED: '1', MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED: '0',
    MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED: '0', restart_time: 0, created_at: 1234,
    env: {PORT: '3104', SYNTHETIC_PRIVATE: 'not-returned'},
  }});
  // Only fields consumed by the selector are populated. These are synthetic
  // already-validated-history ports, not a substitute for the real disk reader's
  // five-file hash, ownership and full certificate-chain verification.
  const certificate = {status: 'completed', victim: {target, cwd, name, pmId: 7, port: 3104, pid: 777},
    stoppedProcess: clone(row)};
  const history = {legacyCertificates: [certificate], entries: []};
  return {row, certificate, history};
}

test('only exact certified stopped rows become cache candidates across legacy and rolling history', () => {
  const f = stoppedFixture();
  for (const history of [f.history, {legacyCertificates: [], entries: [f.certificate]}]) {
    const input = freeze({pm2: [clone(f.row), {...clone(f.row), status: 'online', pid: 456, cwd: live}], history: clone(history)});
    const before = JSON.stringify(input), result = selectPm2CacheProtection(input);
    assert.deepEqual(result, {protectedDirectories: [live], certifiedStoppedDirectories: [directories[0]]});
    assert.ok(Object.isFrozen(result) && Object.isFrozen(result.protectedDirectories) && Object.isFrozen(result.certifiedStoppedDirectories));
    assert.equal(JSON.stringify(input), before);
    assert.equal(JSON.stringify(result).includes('SYNTHETIC_PRIVATE'), false);
    assert.deepEqual(planReleaseCacheCleanup({releaseDirectories: [directories[0], live],
      protectedDirectories: result.protectedDirectories}).eligible.map(item => item.releaseDirectory), [directories[0]]);
  }
});

for (const [name, change] of [
  ['no certificate', f => {f.history.legacyCertificates = [];}],
  ['incomplete certificate', f => {f.certificate.status = 'prepared';}],
  ['duplicate matching certificates', f => {f.history.entries.push(clone(f.certificate));}],
  ['nonzero pid', f => {f.row.pid = 777; f.certificate.stoppedProcess.pid = 777;}],
  ['watch true', f => {f.row.watch = true; f.certificate.stoppedProcess.watch = true;}],
  ['watch missing', f => {delete f.row.watch; delete f.certificate.stoppedProcess.watch;}],
  ['watch numeric false', f => {f.row.watch = 0; f.certificate.stoppedProcess.watch = 0;}],
  ['cron false not null', f => {f.row.cronRestart = false; f.certificate.stoppedProcess.cronRestart = false;}],
  ['cron schedule', f => {f.row.cronRestart = '0 * * * *'; f.certificate.stoppedProcess.cronRestart = '0 * * * *';}],
  ['cron missing', f => {delete f.row.cronRestart; delete f.certificate.stoppedProcess.cronRestart;}],
  ['different process environment hash', f => {f.row.environmentSha256 = 'f'.repeat(64);}],
  ['different executable', f => {f.row.executable += '-changed';}],
  ['different arguments', f => {f.row.args.push('--changed');}],
  ['different restart count', f => {f.row.restartCount++;}],
  ['extra normalized field', f => {f.row.extra = true;}],
  ['missing normalized field', f => {delete f.row.autorestart;}],
  ['victim cwd mismatch', f => {f.certificate.victim.cwd = live;}],
  ['victim directory is not cwd', f => {f.certificate.victim.directory = f.certificate.victim.cwd; delete f.certificate.victim.cwd;}],
  ['victim name mismatch', f => {f.certificate.victim.name += '-other';}],
  ['victim pmId mismatch', f => {f.certificate.victim.pmId++;}],
  ['victim port mismatch', f => {f.certificate.victim.port++;}],
  ['victim short SHA', f => {f.certificate.victim.target = 'a'.repeat(12);}],
  ['victim uppercase SHA', f => {f.certificate.victim.target = 'A'.repeat(40);}],
  ['victim newline SHA', f => {f.certificate.victim.target += '\n';}],
  ['victim canonical target mismatch', f => {f.certificate.victim.target = 'b'.repeat(40);}],
  ['missing stopped snapshot', f => {delete f.certificate.stoppedProcess;}],
]) {
  test(`PM2 protection remains for ${name}`, () => {
    const f = stoppedFixture(); change(f);
    assert.deepEqual(selectPm2CacheProtection({pm2: [f.row], history: f.history}),
      {protectedDirectories: [directories[0]], certifiedStoppedDirectories: []});
  });
}

test('matching noncanonical names or timestamp release roots cannot qualify through a forged matching row', () => {
  for (const transform of [
    f => {f.row.name = f.certificate.victim.name = 'arbitrary-name';},
    f => {f.row.cwd = f.certificate.victim.cwd = directories[1];},
    f => {f.row.cwd = f.certificate.victim.cwd = directories[0].replace('-online', '-1234567890123');},
  ]) {
    const f = stoppedFixture(); transform(f); f.certificate.stoppedProcess = clone(f.row);
    assert.deepEqual(selectPm2CacheProtection({pm2: [f.row], history: f.history}),
      {protectedDirectories: [f.row.cwd], certifiedStoppedDirectories: []});
  }
});

test('online rows always stay protected and unknown process statuses fail closed', () => {
  const f = stoppedFixture();
  const online = {...f.row, status: 'online', pid: 0};
  f.certificate.stoppedProcess = clone(online);
  assert.deepEqual(selectPm2CacheProtection({pm2: [online], history: f.history}),
    {protectedDirectories: [directories[0]], certifiedStoppedDirectories: []});
  for (const status of ['launching', 'stopping', 'errored', 'waiting restart', '', undefined])
    assert.throws(() => selectPm2CacheProtection({pm2: [{...f.row, status}], history: f.history}), /process_transition_pending/);
});

test('all registered directories stay protected without completed history', () => {
  const f = stoppedFixture(), base = {...f.row, status: 'online', pid: 42, cwd: '/www/wwwroot/merchant-space'};
  assert.deepEqual(selectPm2CacheProtection({pm2: [f.row, base], history: {legacyCertificates: [], entries: []}}),
    {protectedDirectories: ['/www/wwwroot/merchant-space', directories[0]].sort(), certifiedStoppedDirectories: []});
});

test('rollback, pending, process and mount protection overrides a certified stopped cache', () => {
  const f = stoppedFixture(), selection = selectPm2CacheProtection({pm2: [f.row], history: f.history});
  for (const additional of [directories[0], `${directories[0]}/.next/static`, `${directories[0]}/.next/cache/webpack/bind`,
    `${directories[0]}/node_modules/next/dist/bin/next`]) {
    const plan = planReleaseCacheCleanup({releaseDirectories: [directories[0]],
      protectedDirectories: [...selection.protectedDirectories, additional]});
    assert.deepEqual(plan.eligible, []);
    assert.deepEqual(plan.excluded, [{releaseDirectory: directories[0], reason: 'protected_directory'}]);
  }
  const conflicting = selectPm2CacheProtection({pm2: [f.row, {...f.row, name: 'second-registration', status: 'online', pid: 123}], history: f.history});
  assert.deepEqual(conflicting.certifiedStoppedDirectories, [directories[0]]);
  assert.deepEqual(planReleaseCacheCleanup({releaseDirectories: [directories[0]],
    protectedDirectories: conflicting.protectedDirectories}).eligible, []);
});

test('malformed protection inputs fail closed instead of weakening registered-directory protection', () => {
  const f = stoppedFixture();
  for (const input of [{pm2: null, history: f.history}, {pm2: [], history: {}},
    {pm2: [{...f.row, cwd: 'relative'}], history: f.history},
    {pm2: [{...f.row, cwd: '/www/../other'}], history: f.history}])
    assert.throws(() => selectPm2CacheProtection(input), /pm2_protection_invalid/);
});
