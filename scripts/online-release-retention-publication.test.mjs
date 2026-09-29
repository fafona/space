import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {completePublicationRetention} from './online-release-retention-publication.mjs';

const anchor = target => ({target, name: `app-${target}`});
function fixture({rollback = false, extras = null} = {}) {
  const a = anchor('a'), b = anchor('b'), c = anchor('c');
  const before = {entries: [{active: b, rollback: a}]};
  const after = {entries: [{active: c, rollback: rollback ? a : b}]};
  const state = {status: 'active', target: 'c'}, calls = [];
  let published = false, stopped = false;
  const operations = {
    history: () => published ? after : before,
    window: () => ({phase: 'stable', active: c, stableRollback: rollback ? a : b, converged: stopped,
      extraOnlineWebProcesses: stopped ? [] : extras ?? [(rollback ? b : a).name]}),
    run: async value => {calls.push(value);if (value.kind === 'converge') published = true;else stopped = true;},
  };
  return {state, calls, operations};
}
test('normal publication converges first, then retires only the former stable rollback', async () => {
  const f = fixture();
  assert.deepEqual(await completePublicationRetention(f.state, f.operations), {status: 'completed', retired: 'a'});
  assert.deepEqual(f.calls, [{kind: 'converge', activeTarget: 'c', victimTarget: null}, {kind: 'retire', activeTarget: 'c', victimTarget: 'a'}]);
});
test('publication after rollback keeps the restored stable version, not the failed version', async () => {
  const f = fixture({rollback: true});
  assert.deepEqual(await completePublicationRetention(f.state, f.operations), {status: 'completed', retired: 'b'});
  assert.equal(f.calls[1].victimTarget, 'b');
});
for (const stage of ['history', 'converge', 'retire', 'window']) test(`${stage} error reports pending and cannot rollback or retry the application`, async () => {
  const f = fixture(), original = f.operations.run;
  if (stage === 'history' || stage === 'window') f.operations[stage] = () => {throw Error('private-token');};
  else f.operations.run = async value => {if (value.kind === stage) {f.calls.push(value);throw Error('online_retention_proof_changed');}return original(value);};
  const result = await completePublicationRetention(f.state, f.operations);
  assert.equal(result.status, 'pending');assert.doesNotMatch(JSON.stringify(result), /private-token/);
  assert.deepEqual(f.state, {status: 'active', target: 'c'});
  assert.ok(f.calls.filter(v => v.kind === 'retire').length <= 1);
});
test('historical excess and unknown candidates are not silently batch-stopped', async () => {
  for (const extras of [['app-a', 'app-z'], ['app-z'], ['app-b']]) {
    const f = fixture({extras});assert.equal((await completePublicationRetention(f.state, f.operations)).status, 'pending');
    assert.deepEqual(f.calls.map(v => v.kind), ['converge']);
  }
});
test('unpublished and absent policy do not perform operations', async () => {
  const f = fixture();
  assert.equal((await completePublicationRetention({...f.state, status: 'activating'}, f.operations)).status, 'pending');
  f.operations.history = () => ({entries: []});
  assert.deepEqual(await completePublicationRetention(f.state, f.operations), {status: 'not-enabled'});
  assert.deepEqual(f.calls, []);
});
test('a previously completed window does not repeat convergence or stop', async () => {
  const f = fixture();await completePublicationRetention(f.state, f.operations);
  const count = f.calls.length;
  assert.deepEqual(await completePublicationRetention(f.state, f.operations), {status: 'completed', retired: null});
  assert.equal(f.calls.length, count);
});
test('completion is never reported for changed active or unconfirmed retirement', async () => {
  const f = fixture(); f.operations.window = () => ({phase: 'rolled-back'});
  assert.equal((await completePublicationRetention(f.state, f.operations)).status, 'pending');
  const g = fixture(), run = g.operations.run;
  g.operations.run = value => value.kind === 'retire' ? g.calls.push(value) : run(value);
  assert.equal((await completePublicationRetention(g.state, g.operations)).status, 'pending');
  assert.equal(g.calls.filter(v => v.kind === 'retire').length, 1);
});
test('publisher housekeeping is outside the activation rollback boundary', () => {
  const code = readFileSync(new URL('./online-traffic-release.mjs', import.meta.url), 'utf8');
  const activation = code.slice(code.indexOf('async function activateCandidate('), code.indexOf('function bookingResumeOwnedPath('));
  assert.doesNotMatch(activation, /completePublicationRetention|settleOnlineRetention/);
  assert.match(code, /await activateCandidate\(s\);await settleOnlineRetention\(s,heldLock\);/);
  assert.match(code, /withOnlineRetentionLocks\(async heldLock=>/);
  assert.doesNotMatch(code, /FAOLLA_ONLINE_RELEASE_LOCKED/);
});
