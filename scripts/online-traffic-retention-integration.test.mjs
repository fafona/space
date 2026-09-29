import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {runInThisContext} from 'node:vm';
import * as policy from './online-release-retention-policy.mjs';
import {completePublicationRetention} from './online-release-retention-publication.mjs';
import {normalizeRetirementProcess} from './online-release-retirement.mjs';
import {ROLLING_BASE_NAMES} from './online-release-rolling-policy.mjs';
import {WEB_RELEASE_FILES} from './web-presentation-release-policy.mjs';

// Execute actual publisher helpers and actual pure policy in the host realm.
// Host observations/writes, HTTP/static checks and writer operations are memory
// ports. This is NOT an actual PM2 stop, disk-reader, Linux-lock or deployment
// acceptance test. The separate writer/reader suites cover those boundaries.
const clone = value => structuredClone(value);
const digest = text => createHash('sha256').update(text).digest('hex');
const code = readFileSync(new URL('./online-traffic-release.mjs', import.meta.url), 'utf8');
const fixtureCode = readFileSync(new URL('./online-release-retention-policy.test.mjs', import.meta.url), 'utf8');
const prefix = fixtureCode.slice(0, fixtureCode.indexOf('\ntest(')).replace(/^import[\s\S]*?;\r?\n/gm, '');
const installStart = fixtureCode.indexOf('function installState(');
const installEnd = fixtureCode.indexOf('\ntest(', installStart);
assert.ok(prefix.includes('function initialized()') && installStart > 0 && installEnd > installStart);
const fixtureDefinitions = prefix + fixtureCode.slice(installStart, installEnd);
assert.doesNotMatch(fixtureDefinitions, /\btest\(/, 'fixture extraction must never register the old test file');
function compile(source, ports, expressions) {
  return runInThisContext(`(function(${Object.keys(ports).join(',')}){${source}\nreturn {${expressions}};})`,
    {filename: 'synthetic-retention-publisher-vm.mjs'})(...Object.values(ports));
}
const fixtures = compile(fixtureDefinitions, {...policy, policy: policy.ONLINE_RETENTION_POLICY,
  normalizeRetirementProcess, createHash, ROLLING_BASE_NAMES, WEB_RELEASE_FILES},
'fixture,observation,extend,after,makeAnchor,activeFile,releaseState,raw,sha,now,installState');
const sourceBetween = (start, end) => {
  const first = code.indexOf(start), last = code.indexOf(end, first + start.length);
  assert.ok(first >= 0 && last > first, `${start} must select its complete actual function boundary`);
  return code.slice(first, last);
};
const publisherSource = sourceBetween('function verifyRetainedProcesses(', 'async function request(') +
  sourceBetween('function configUnchanged(', 'function verifyCandidate(') +
  sourceBetween('function restoreConfigs(', 'function candidateEnvironment(') +
  sourceBetween('async function activateCandidate(', 'function bookingResumeOwnedPath(');

function harness() {
  const f = fixtures.fixture();
  // Start with one current + one rollback, not an unrelated historic excess.
  // Keep this synthetic old root internally consistent before initialization.
  const extra = `merchant-space-online-${'e'.repeat(12)}`;
  f.current = f.current.filter(p => p.name !== extra);
  f.history.rollingHistory.legacyProcesses = clone(f.current);
  f.first = fixtures.observation(f.history, 'initialize', f.current, f.active, f.rollback);
  const root = '/var/lib/faolla-online-release', activeFile = `${root}/active.json`, proxy = '/owned-proxy';
  const files = new Map([[activeFile, JSON.stringify(fixtures.activeFile(f.active))]]);
  const host = {history: fixtures.extend(f.history, f.first), current: clone(f.current), files, events: [],
    failure: null, root, activeFile, proxy, lock: Object.freeze({syntheticCapability: true}), original: f};
  const statePath = target => `${root}/${target}/state.json`;
  files.set(statePath(f.active.target), JSON.stringify(fixtures.releaseState(f.active, f.rollback)));
  files.set(statePath(f.rollback.target), JSON.stringify(fixtures.releaseState(f.rollback)));
  for (const file of WEB_RELEASE_FILES) files.set(`${proxy}/${file}`, `proxy for ${f.active.target}: ${file}`);
  const read = filename => {assert.ok(files.has(filename), `missing synthetic file ${filename}`); return files.get(filename);};
  const actualActive = () => JSON.parse(read(activeFile));
  const rawRows = () => host.current.map(p => {
    const row = fixtures.raw(fixtures.sha('9'), p.port, p.pmId);
    row.name = p.name; row.pid = p.pid; row.pm2_env.status = p.status;
    row.pm2_env.pm_cwd = p.cwd; row.pm2_env.pm_exec_path = p.executable;
    assert.deepEqual(normalizeRetirementProcess(row), p, 'synthetic PM2 raw rows must preserve the actual normalizer');
    return row;
  });
  function api(target, action = 'activate') {
    const operation = `${root}/${target}`;
    let result;
    const ports = {...policy, completePublicationRetention, normalizeRetirementProcess, WEB_RELEASE_FILES,
      root, operation, activeFile, proxy, target, action, protectedBaseProcesses: ROLLING_BASE_NAMES,
      app: '/www/wwwroot/merchant-space', nginx: '/owned-nginx', controllerModuleUrl: import.meta.url, fileURLToPath,
      readOnlineRetentionHistory: () => clone(host.history), pm: rawRows,
      readOnlineRollingRetentions: () => assert.fail('v2 must not fall back to the old rolling runtime'),
      readOnlineRetirementCertificates: () => assert.fail('v2 must not fall back to legacy runtime'),
      safeFile: read, hash: digest, existsSync: filename => files.has(filename),
      atomic: (filename, text) => {host.events.push(['write', filename]); files.set(filename, text);},
      save: state => {host.events.push(['state', state.status]); files.set(statePath(state.target), JSON.stringify(state));},
      fail: reason => {throw Error(reason);},
      realpathSync: filename => filename,
      publishStatic: () => {host.events.push(['static']); return 3;}, verifyOrderAttention: () => {},
      verifyCandidate: () => {}, smoke: async () => {host.events.push(['smoke']); return 3;},
      request: async () => ({status: 200}),
      verifyBase: async state => result.verifyRetainedProcesses(state, rawRows()),
      restoreOrderAttentionConfigs: () => assert.fail('fixture has no order-attention configuration'),
      run: (command, args) => {host.events.push([command, ...args]); return command === 'git' ? fixtures.sha('8') + '\n' : '';},
      runOnlineRetentionUnderHeldLocks: async options => {
        assert.strictEqual(options.lock, host.lock, 'actual housekeeping must forward the held lock capability');
        host.events.push(['retention', options.kind, options.victimTarget]);
        const state = JSON.parse(read(statePath(options.activeTarget)));
        const currentAnchor = fixtures.makeAnchor(host.current.find(p => p.name === state.name), state.target);
        const baseState = JSON.parse(read(statePath(state.baseline)));
        const rollback = fixtures.makeAnchor(host.current.find(p => p.name === baseState.name), baseState.target);
        const before = fixtures.observation(host.history, options.kind, host.current, currentAnchor, rollback, options.victimTarget);
        before.activeState = clone(state); fixtures.installState(before);
        if (options.kind === 'converge' && state.retentionRollbackProof) before.rollbackProof = clone(state.retentionRollbackProof);
        if (options.victimTarget) {
          const proof = before.releaseProofs.find(p => p.target === options.victimTarget);
          proof.stateText = read(statePath(options.victimTarget)); proof.state = JSON.parse(proof.stateText);
          proof.stateSha256 = digest(proof.stateText);
        }
        policy.assertOnlineRetentionPlan(before, host.history);
        if (host.failure === options.kind) throw Error('online_retention_synthetic_failure');
        host.history = fixtures.extend(host.history, before); host.current = fixtures.after(before).processes;
        return clone(host.history.entries.at(-1));
      },
      console: {error: message => host.events.push(['notice', message])},
      Date: class extends Date {constructor(...args) {super(...(args.length ? args : [fixtures.now]));}},
    };
    result = compile(publisherSource, ports,
      'verifyRetainedProcesses,snapshotOnlineRetention,readRetentionRollbackProof,restoreConfigs,activateCandidate,settleOnlineRetention');
    return result;
  }
  function stage(letter, port, id) {
    const target = fixtures.sha(letter), before = actualActive(), adapter = api(target, 'stage');
    const snapshot = adapter.snapshotOnlineRetention(rawRows(), target, before.name);
    const process = normalizeRetirementProcess(fixtures.raw(target, port, id));
    const anchor = fixtures.makeAnchor(process, target), baseline = host.history.entries.at(-1);
    const prior = [baseline.active, baseline.rollback].find(a => a.target === before.target);
    const state = {...fixtures.releaseState(anchor, prior), ...snapshot, previousActive: before,
      status: 'ready-no-database', lane: 'customer-code-performance', configs: {}};
    for (const file of WEB_RELEASE_FILES) {
      const oldText = read(`${proxy}/${file}`), newText = `proxy for ${target}: ${file}`;
      files.set(`${root}/${target}/before-${file}`, oldText); files.set(`${root}/${target}/after-${file}`, newText);
      state.configs[file] = {oldHash: digest(oldText), newHash: digest(newText)};
    }
    files.set(statePath(target), JSON.stringify(state)); host.current.push(process);
    assert.equal(adapter.verifyRetainedProcesses(state, rawRows()).phase, 'staged');
    return {state, adapter: api(target), anchor};
  }
  return {...host, host, api, stage, read, rawRows, actualActive, statePath};
}

test('actual publisher activation, convergence and retirement advance history without invalidating the pinned birth snapshot', async () => {
  const h = harness(), initial = h.host.history.headSha256, p = h.stage('f', 3105, 5);
  assert.equal(p.state.retentionHeadSha256, initial);
  await p.adapter.activateCandidate(p.state);
  assert.equal(h.actualActive().target, p.state.target);
  assert.equal(p.adapter.verifyRetainedProcesses(p.state, h.rawRows()).phase, 'published-unconverged');
  assert.deepEqual(await p.adapter.settleOnlineRetention(p.state, h.lock), {status: 'completed', retired: fixtures.sha('b')});
  assert.deepEqual(h.host.history.entries.map(c => c.kind), ['initialize', 'converge', 'retire']);
  assert.notEqual(h.host.history.headSha256, initial); assert.equal(p.state.retentionHeadSha256, initial);
  assert.equal(p.adapter.verifyRetainedProcesses(p.state, h.rawRows()).converged, true);
  assert.equal(h.host.current.find(p => p.name === h.original.rollback.name).status, 'stopped');
});

test('actual rollback pin, saved proxy proof, new snapshot and republish keep the restored version and retire the failed version', async () => {
  const h = harness(), first = h.stage('f', 3105, 5);
  await first.adapter.activateCandidate(first.state); await first.adapter.settleOnlineRetention(first.state, h.lock);
  const priorHead = h.host.history.headSha256;
  h.api(first.state.target, 'rollback').verifyRetainedProcesses(first.state, h.rawRows());
  first.adapter.restoreConfigs(first.state);
  assert.equal(first.state.retentionRollbackHeadSha256, priorHead);
  assert.equal(h.actualActive().target, h.original.active.target);
  const evidence = first.adapter.readRetentionRollbackProof(h.host.history, h.actualActive());
  assert.equal(evidence.failedStateText, h.read(h.statePath(first.state.target)));
  assert.equal(evidence.failedStateSha256, digest(evidence.failedStateText));
  policy.assertOnlineRetentionRollbackProof({history: h.host.history, proof: evidence, actualActive: h.actualActive()});
  const second = h.stage('8', 3106, 8);
  assert.deepEqual(second.state.retentionRollbackProof, evidence);
  assert.equal(second.state.baseline, h.original.active.target);
  await second.adapter.activateCandidate(second.state);
  assert.deepEqual(await second.adapter.settleOnlineRetention(second.state, h.lock), {status: 'completed', retired: first.state.target});
  const latest = h.host.history.entries.at(-1);
  assert.equal(latest.rollback.target, h.original.active.target); assert.equal(latest.active.target, second.state.target);
  assert.equal(h.host.current.find(p => p.name === first.state.name).status, 'stopped');
  assert.equal(h.host.current.find(p => p.name === h.original.active.name).status, 'online');
  assert.equal(second.adapter.verifyRetainedProcesses(second.state, h.rawRows()).converged, true);
});

for (const failure of ['converge', 'retire']) test(`actual post-activation ${failure} failure leaves successful application and proxy state untouched`, async () => {
  const h = harness(), p = h.stage('f', 3105, 5); await p.adapter.activateCandidate(p.state);
  const activeText = h.read(h.activeFile), stateText = h.read(h.statePath(p.state.target));
  const proxies = WEB_RELEASE_FILES.map(file => h.read(`${h.proxy}/${file}`));
  const eventStart = h.host.events.length; h.host.failure = failure;
  const result = await p.adapter.settleOnlineRetention(p.state, h.lock);
  assert.equal(result.status, 'pending'); assert.equal(result.reason, 'online_retention_synthetic_failure');
  assert.equal(h.read(h.activeFile), activeText); assert.equal(h.read(h.statePath(p.state.target)), stateText);
  assert.deepEqual(WEB_RELEASE_FILES.map(file => h.read(`${h.proxy}/${file}`)), proxies);
  assert.equal(h.host.events.slice(eventStart).some(e => e[0] === 'write' || e[0] === 'state' || e[0] === '/owned-nginx'), false);
  assert.equal(h.host.events.filter(e => e[0] === 'retention' && e[1] === 'retire').length, failure === 'retire' ? 1 : 0);
  assert.equal(p.state.status, 'active');
});

for (const corruption of ['before-proxy', 'after-proxy', 'current-proxy', 'rollback-head', 'rollback-time', 'failed-state-status'])
  test(`actual rollback-to-stage bridge rejects ${corruption} before new candidate registration or publication`, async () => {
    const h = harness(), p = h.stage('f', 3105, 5);
    await p.adapter.activateCandidate(p.state); await p.adapter.settleOnlineRetention(p.state, h.lock);
    p.adapter.restoreConfigs(p.state);
    const stateFile = h.statePath(p.state.target), file = WEB_RELEASE_FILES[0];
    if (corruption === 'before-proxy') h.files.set(`${h.root}/${p.state.target}/before-${file}`, 'tampered');
    if (corruption === 'after-proxy') h.files.set(`${h.root}/${p.state.target}/after-${file}`, 'tampered');
    if (corruption === 'current-proxy') h.files.set(`${h.proxy}/${file}`, 'tampered');
    if (['rollback-head', 'rollback-time', 'failed-state-status'].includes(corruption)) {
      const state = JSON.parse(h.read(stateFile));
      if (corruption === 'rollback-head') state.retentionRollbackHeadSha256 = '0'.repeat(64);
      if (corruption === 'rollback-time') delete state.rolledBackAt;
      if (corruption === 'failed-state-status') state.status = 'active';
      h.files.set(stateFile, JSON.stringify(state));
    }
    const processes = clone(h.host.current), evidenceFiles = [...h.files];
    assert.throws(() => h.stage('8', 3106, 8), /online_retention_/);
    assert.deepEqual(h.host.current, processes); assert.deepEqual([...h.files], evidenceFiles);
  });

test('actual publisher refuses absent or changed v2 history instead of falling back to legacy identity rules', () => {
  const h = harness(), p = h.stage('f', 3105, 5);
  for (const change of [history => ({...history, entries: [], headSha256: null}),
    history => ({...history, headSha256: '0'.repeat(64)})]) {
    const saved = h.host.history; h.host.history = change(saved);
    assert.throws(() => p.adapter.verifyRetainedProcesses(p.state, h.rawRows()), /online_retention_/);
    h.host.history = saved;
  }
});
