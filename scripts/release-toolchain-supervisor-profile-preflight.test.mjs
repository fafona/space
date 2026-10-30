import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {assertActiveBookingSupervisorClosureProfile} from './release-toolchain-active-generation-contract.mjs';
import {armActiveBookingPublicationSupervisor} from './release-toolchain-active-generation-supervisor.mjs';
import {prepareActiveBookingPublicationWorker} from './release-toolchain-active-generation-publication-scope.mjs';

const source = name => readFileSync(new URL('./' + name, import.meta.url), 'utf8');

test('every closure advertised by the real publication profile is recognized by the same supervisor preflight', () => {
  const text = source('release-toolchain-active-generation-profile.mjs');
  const markers = [...text.matchAll(/\.\.\.\(closed\.([A-Za-z]+Closed)\?/g)].map(match => match[1]);
  assert.ok(markers.length >= 3);
  assert.ok(markers.includes('settledPreIngressClosed'));
  for (const marker of markers) assert.equal(assertActiveBookingSupervisorClosureProfile({[marker]: {verifiedElsewhere: true}}), true, marker);
});

test('old origin and recovered closure recognition stays available', () => {
  for (const marker of ['originRecoveryClosed', 'recoveredPublicationClosed']) {
    assert.equal(assertActiveBookingSupervisorClosureProfile({[marker]: {}}), true);
  }
});

test('unknown or absent profile markers fail closed without authorizing any process operation', () => {
  for (const closed of [null, undefined, {}, {unknownClosed: {}}, {settledPreIngressClosed: false}, {settledPreIngress: {}}]) {
    assert.throws(() => assertActiveBookingSupervisorClosureProfile(closed), error => error.code === 'evidence_invalid');
  }
});

test('the actual private worker path runs the shared profile check before any worker intent; the outer scope preserves a read-only refusal', () => {
  const text = source('release-toolchain-active-generation-worker.mjs');
  const start = text.indexOf('export async function prepareActiveBookingGatedWorker(');
  const end = text.indexOf('// Explicit read-only post-transition profile', start);
  const body = text.slice(start, end);
  const check = body.indexOf('assertActiveBookingSupervisorClosureProfile(closed)');
  assert.ok(check > body.indexOf('readAdmittedActiveBookingWorkerContext(scope,'));
  assert.ok(check > body.indexOf('same(closed.closedSha256,authority.prepared.activeIncidentClosed.closedSha256)'));
  assert.ok(check < body.indexOf('beforeIntent()'));
  assert.ok(check < body.indexOf("stage='durable-intent'"));
  const scope = source('release-toolchain-active-generation-publication-scope.mjs');
  assert.ok(scope.includes("value.workerIntentStarted?'unknown':'worker-preflight-refused'"));
  assert.match(scope, /try\{[\s\S]*?await prepareActiveBookingGatedWorker\([\s\S]*?catch\(error\)\{value.phase=value.workerIntentStarted\?'unknown':'worker-preflight-refused'/);
});

test('the real supervisor retains its private lock and prepared-worker guards before repeating the same profile check', () => {
  const text = source('release-toolchain-active-generation-supervisor.mjs');
  const start = text.indexOf('export async function armActiveBookingPublicationSupervisor(');
  const end = text.indexOf('function digestMain()', start);
  const body = text.slice(start, end);
  const check = body.indexOf('assertActiveBookingSupervisorClosureProfile(evidence.closed)');
  assert.ok(check > body.indexOf('assertActiveBookingPublicationLockBinding(scope,options)'));
  assert.ok(check > body.indexOf("admission.phase==='worker-prepared'"));
  assert.ok(check < body.indexOf("publishOnceVisible(directory+'/'+name,value)"));
  assert.ok(check < body.indexOf("child=spawn('/usr/bin/node'"));
});

test('recognizing a known marker never turns JSON into a private worker or supervisor capability', async () => {
  assert.equal(assertActiveBookingSupervisorClosureProfile({settledPreIngressClosed: {verified: true}}), true);
  await assert.rejects(prepareActiveBookingPublicationWorker({settledPreIngressClosed: {verified: true}}, {beforeWorkerIntent: () => assert.fail()}));
  await assert.rejects(armActiveBookingPublicationSupervisor({scope: {settledPreIngressClosed: {verified: true}}, lock: {deployFd: 3}, toolRevision: 'a'.repeat(40), window: {}}));
});
