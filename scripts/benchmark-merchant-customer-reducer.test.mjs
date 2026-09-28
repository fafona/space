import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  CUSTOMER_REDUCER_SCENARIOS,
  compileCustomerReducer,
  createSyntheticReducerInput,
  measureReducerSample,
  parseReducerArguments,
  runCustomerReducerBenchmark,
  summarizeReducerSamples,
} from './benchmark-merchant-customer-reducer.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const digest = value => sha(JSON.stringify(value));
const script = readFileSync(new URL('./benchmark-merchant-customer-reducer.mjs', import.meta.url), 'utf8');
const source = readFileSync(new URL('../src/lib/merchantCustomers.ts', import.meta.url), 'utf8');

function smallResult() {
  return [{
    id: 'synthetic', identityAliases: ['email:synthetic@example.test'],
    sources: ['manual', 'order', 'booking', 'membership'],
    activity: { orderCount: 1, bookingCount: 1 },
  }];
}

function observationPorts(events = []) {
  let reads = 0, times = 0;
  return {
    gc: () => events.push('gc'),
    memory: () => {
      events.push('memory');
      return { heapUsed: [1000, 1400, 1100][reads++], rss: 5000 };
    },
    now: () => { events.push('clock'); return [10, 12.5][times++]; },
    peakRss: () => { events.push('peak'); return 9000; },
  };
}

function fakeWorker(name, quick) {
  const scenario = CUSTOMER_REDUCER_SCENARIOS.find(item => item.name === name);
  const sample = {
    reducerWallMs: 1, inputSha256: 'a'.repeat(64), resultSha256: 'b'.repeat(64), inputUnchanged: true, resultBytes: 10,
    outcomes: {
      customers: scenario.identities, orders: scenario.orders, bookings: scenario.bookings,
      customersBySource: { manual: scenario.identities, order: scenario.identities, booking: scenario.identities, membership: scenario.identities },
      aliasCount: scenario.identities * (scenario.storedAliases || 5),
    },
    memory: {
      beforeHeapUsedBytes: 1000, afterCallHeapUsedBytes: 1400, afterCallHeapDeltaBytes: 400,
      postGcHeapUsedBytes: 1100, postGcRetainedHeapDeltaBytes: 100,
      beforeRssBytes: 5000, afterCallRssBytes: 5000, postGcRssBytes: 5000, processPeakRssBytesAtMeasurement: 9000,
    },
  };
  return {
    schema: 'faolla-customer-reducer-worker-v1', scenario, quick, pid: 100,
    sourceSha256: sha(source), benchmarkScriptSha256: sha(script),
    node: process.version, platform: process.platform, arch: process.arch, v8: process.versions.v8, compilerVersion: 'test',
    first: sample, repeated: Array.from({ length: quick ? 2 : 5 }, () => structuredClone(sample)),
    summary: {
      repeatedReducerWallMs: summarizeReducerSamples(Array(quick ? 2 : 5).fill(1)),
      repeatedAfterCallHeapDeltaBytes: summarizeReducerSamples(Array(quick ? 2 : 5).fill(400)),
      repeatedPostGcRetainedHeapDeltaBytes: summarizeReducerSamples(Array(quick ? 2 : 5).fill(100)),
    },
    processPeakRssBytesBeforeReportSerialization: 9000,
  };
}

test('arguments allow only fixed offline workloads, with no paths, credentials or unbounded counts', () => {
  assert.deepEqual(parseReducerArguments([]), { worker: false, quick: false });
  assert.deepEqual(parseReducerArguments(['--quick']), { worker: false, quick: true });
  assert.deepEqual(parseReducerArguments(['--worker', '100-shared-identities']), { worker: true, quick: false, scenario: '100-shared-identities' });
  assert.deepEqual(parseReducerArguments(['--worker', '100-shared-identities', '--quick']), { worker: true, quick: true, scenario: '100-shared-identities' });
  for (const args of [null, ['--url=https://faolla.com'], ['--source=other.ts'], ['--input=data.json'], ['--samples=10'],
    ['--token=secret'], ['--quick', '--quick'], ['--worker'], ['--worker', '../file'], ['--worker', '100-shared-identities', '--count=9']]) {
    assert.throws(() => parseReducerArguments(args));
  }
});

test('fixed immutable matrix distinguishes identity count, activity depth and alias density', () => {
  assert.ok(Object.isFrozen(CUSTOMER_REDUCER_SCENARIOS));
  assert.ok(CUSTOMER_REDUCER_SCENARIOS.every(Object.isFrozen));
  assert.deepEqual(CUSTOMER_REDUCER_SCENARIOS.slice(0, 3).map(item => item.identities), [100, 1000, 10000]);
  assert.equal(CUSTOMER_REDUCER_SCENARIOS[3].identities, 1);
  assert.equal(CUSTOMER_REDUCER_SCENARIOS[3].orders + CUSTOMER_REDUCER_SCENARIOS[3].bookings, 20000);
  assert.equal(CUSTOMER_REDUCER_SCENARIOS[4].storedAliases, 24);
  const input = createSyntheticReducerInput('100-shared-identities');
  assert.equal(digest(input), digest(createSyntheticReducerInput('100-shared-identities')));
  for (const field of ['storedCustomers', 'orders', 'bookings', 'memberships']) assert.equal(input[field].length, 100);
  assert.equal(new Set(input.orders.map(item => item.customerAccountId)).size, 100);
  assert.throws(() => createSyntheticReducerInput('arbitrary'));
});

test('descriptive summaries retain signed memory deltas and never invent percentiles', () => {
  const values = [-50, 10, -20, 80];
  assert.deepEqual(summarizeReducerSamples(values), { count: 4, min: -50, median: -5, max: 80 });
  assert.deepEqual(values, [-50, 10, -20, 80]);
  assert.deepEqual(summarizeReducerSamples([3, 2, 1]), { count: 3, min: 1, median: 2, max: 3 });
  for (const invalid of [null, [], [NaN], [Infinity]]) assert.throws(() => summarizeReducerSamples(invalid));
});

test('measurement isolates build timing and records after-call versus retained-GC endpoints', () => {
  const input = { value: 1 }, events = [];
  const result = smallResult();
  Object.defineProperty(input, 'toJSON', { value: () => { events.push('serialize-input'); return { value: 1 }; } });
  Object.defineProperty(result, 'toJSON', { value: () => { events.push('serialize-result'); return result.slice(); } });
  const expectedInputHash = digest(input);
  events.length = 0;
  const measured = measureReducerSample(value => {
    events.push('build');
    assert.equal(value, input);
    return result;
  }, input, expectedInputHash, observationPorts(events));
  assert.deepEqual(events, ['gc', 'gc', 'memory', 'clock', 'build', 'clock', 'memory', 'gc', 'gc', 'memory', 'peak', 'serialize-result', 'serialize-input']);
  assert.equal(measured.reducerWallMs, 2.5);
  assert.equal(measured.memory.afterCallHeapDeltaBytes, 400);
  assert.equal(measured.memory.postGcRetainedHeapDeltaBytes, 100);
  assert.equal(measured.memory.processPeakRssBytesAtMeasurement, 9000);
  assert.equal(measured.resultSha256, digest(result));
  assert.equal(measured.resultBytes, Buffer.byteLength(JSON.stringify(result)));
  assert.equal(measured.inputUnchanged, true);
});

test('measurement refuses a missing GC function instead of claiming post-GC memory', () => {
  let built = false;
  assert.throws(() => measureReducerSample(() => { built = true; return smallResult(); }, {}, digest({}), {
    ...observationPorts(), gc: false,
  }), /customer_reducer_requires_expose_gc/);
  assert.equal(built, false);
});

test('input changes fail instead of receiving a successful immutability fingerprint', () => {
  const input = { value: 1 }, expected = digest(input);
  assert.throws(() => measureReducerSample(value => {
    value.value++;
    return smallResult();
  }, input, expected, observationPorts()), /customer_reducer_mutated_input/);
});

test('memory observations preserve negative GC deltas and unavailable process high-water data', () => {
  let index = 0;
  const input = {};
  const measured = measureReducerSample(smallResult, input, digest(input), {
    ...observationPorts(), memory: () => ({ heapUsed: [300, 200, 100][index++], rss: 500 }), peakRss: () => null,
  });
  assert.equal(measured.memory.afterCallHeapDeltaBytes, -100);
  assert.equal(measured.memory.postGcRetainedHeapDeltaBytes, -200);
  assert.equal(measured.memory.processPeakRssBytesAtMeasurement, null);
});

test('pure-module compiler rejects configured runtime dependencies and fixes Date without process or fetch', () => {
  for (const unsafe of [
    "import fs from 'node:fs'; export function buildMerchantCustomerDirectory() { return []; }",
    "import '@/lib/supabase'; export function buildMerchantCustomerDirectory() { return []; }",
    "import type { X } from '@/lib/supabase'; export function buildMerchantCustomerDirectory() { return []; }",
    "export { buildMerchantCustomerDirectory } from './other';",
    "export function buildMerchantCustomerDirectory() { return require('node:fs'); }",
    "export function buildMerchantCustomerDirectory() { return import('node:fs'); }",
  ]) assert.throws(() => compileCustomerReducer(unsafe), /forbidden/);
  const compiledFixture = compileCustomerReducer('export function buildMerchantCustomerDirectory(input: unknown) { return [new Date().toISOString(), Date.now(), typeof process, typeof fetch, Array.isArray(input)]; }');
  assert.deepEqual(JSON.parse(JSON.stringify(compiledFixture.build(compiledFixture.parseInput([])))), [
    '2032-06-01T12:00:00.000Z', Date.parse('2032-06-01T12:00:00.000Z'), 'undefined', 'undefined', true,
  ]);
});

test('parent validates all fixed scenarios and complete repeat fingerprints', () => {
  const launches = [];
  const report = runCustomerReducerBenchmark({}, (name, quick) => {
    launches.push(name);
    return fakeWorker(name, quick);
  });
  assert.deepEqual(launches, CUSTOMER_REDUCER_SCENARIOS.map(item => item.name));
  assert.equal(report.results.length, 5);
  assert.equal(report.boundaries.productionTraffic, false);
  assert.equal(report.boundaries.readsEnvironment, false);
  assert.match(report.boundaries.heap, /not peak JS heap/);
  assert.match(report.boundaries.rss, /process-lifetime/);
});

test('parent refuses revision drift, silent source/activity loss and late output changes', () => {
  for (const mutate of [
    worker => { worker.sourceSha256 = '0'.repeat(64); },
    worker => { worker.benchmarkScriptSha256 = '0'.repeat(64); },
    worker => { worker.first.outcomes.customers--; },
    worker => { worker.first.outcomes.orders--; },
    worker => { worker.first.outcomes.bookings--; },
    worker => { worker.first.outcomes.customersBySource.manual--; },
    worker => { worker.repeated[1].resultSha256 = '0'.repeat(64); },
    worker => { worker.repeated[1].inputSha256 = '0'.repeat(64); },
    worker => { worker.repeated[1].inputUnchanged = false; },
    worker => { worker.repeated[1].memory.afterCallHeapUsedBytes = Infinity; },
  ]) assert.throws(() => runCustomerReducerBenchmark({ quick: true }, (name, quick) => {
    const worker = fakeWorker(name, quick);
    mutate(worker);
    return worker;
  }));
});

test('real quick run uses a fresh --expose-gc child and stable complete results', () => {
  const report = runCustomerReducerBenchmark({ quick: true });
  assert.equal(report.results.length, 1);
  const worker = report.results[0];
  assert.notEqual(worker.pid, process.pid);
  assert.equal(worker.first.outcomes.customers, 100);
  assert.equal(worker.first.outcomes.orders, 100);
  assert.equal(worker.first.outcomes.bookings, 100);
  assert.equal(worker.repeated.length, 2);
  assert.ok(worker.first.memory.beforeHeapUsedBytes > 0);
  assert.ok(worker.first.memory.postGcHeapUsedBytes > 0);
  assert.ok(worker.repeated.every(item => item.inputUnchanged && item.resultSha256 === worker.first.resultSha256));
  assert.match(script, /env: \{\}/);
  assert.doesNotMatch(script, /process\.env/);
});
