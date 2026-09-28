// Synthetic, in-memory actual-route baseline. Never a production load test.
// Run: node --import tsx scripts/benchmark-merchant-customer-get.mjs [--quick]
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const expectedPhases = ['storedRead', 'ordersRead', 'bookingsRead', 'membershipsRead', 'customerReducer', 'jsonSerialization'];
export const CUSTOMER_GET_SCENARIOS = Object.freeze([
  { name: 'empty', storedCustomers: 0, orders: 0, bookings: 0, memberships: 0, foreignBookings: 0, distinctCustomers: 1 },
  { name: '100-shared-identities', storedCustomers: 100, orders: 100, bookings: 100, memberships: 100, foreignBookings: 0, distinctCustomers: 100 },
  { name: '1000-shared-identities', storedCustomers: 1000, orders: 1000, bookings: 1000, memberships: 1000, foreignBookings: 0, distinctCustomers: 1000 },
  { name: '10000-shared-identities', storedCustomers: 10000, orders: 10000, bookings: 10000, memberships: 10000, foreignBookings: 0, distinctCustomers: 10000 },
  { name: 'one-customer-20000-activities', storedCustomers: 1, orders: 10000, bookings: 10000, memberships: 1, foreignBookings: 0, distinctCustomers: 1 },
  { name: '100-identities-plus-10000-foreign-bookings', storedCustomers: 100, orders: 100, bookings: 100, memberships: 100, foreignBookings: 10000, distinctCustomers: 100 },
].map(Object.freeze));

export function parseBaselineArguments(args) {
  if (!Array.isArray(args) || args.length > 1 || (args.length === 1 && args[0] !== '--quick')) {
    throw new Error('customer_get_baseline_arguments_invalid');
  }
  return { quick: args.length === 1 };
}

export function describeSamples(values) {
  assert.ok(values.length > 0 && values.every(value => Number.isFinite(value) && value >= 0), 'invalid duration samples');
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const round = value => Number(value.toFixed(3));
  return {
    count: sorted.length,
    minMs: round(sorted[0]),
    medianMs: round(sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2),
    maxMs: round(sorted.at(-1)),
  };
}

function assertSuccessfulReport(report) {
  assert.equal(report.status, 200, 'synthetic GET failed');
  assert.deepEqual(report.warnings, [], 'fixture source degraded');
  assert.equal(report.io.forbiddenCalls, 0, 'forbidden IO was attempted');
  for (const key of ['responseSha256', 'effectsSha256']) assert.match(report[key], /^[a-f0-9]{64}$/);
  assert.ok(Number.isSafeInteger(report.customerCount) && report.customerCount >= 0);
  assert.ok(Number.isSafeInteger(report.responseBytes) && report.responseBytes > 0);
}

function assertIdenticalOutputs(left, right) {
  for (const key of ['status', 'customerCount', 'warnings', 'outcomes', 'responseBytes', 'responseSha256', 'effectsSha256', 'inputBytes', 'io']) {
    assert.deepEqual(left[key], right[key], `instrumentation changed ${key}`);
  }
}

function assertExpectedContents(report, input) {
  assert.equal(report.customerCount, input.name === 'empty' ? 0 : input.distinctCustomers, 'fixture identities were discarded or unexpectedly merged');
  assert.equal(report.outcomes.orderCount, input.orders, 'order activity was lost');
  assert.equal(report.outcomes.bookingCount, input.bookings, 'booking activity was lost or leaked from another tenant');
  for (const [source, count] of [['manual', input.storedCustomers], ['order', input.orders], ['booking', input.bookings], ['membership', input.memberships]]) {
    assert.equal(report.outcomes.customersBySource[source], Math.min(count, input.distinctCustomers), source + ' contribution mismatch');
  }
}

function assertMeasuredPhases(report) {
  assert.equal(report.measurementEnabled, true, 'measured request must enable timing');
  assert.deepEqual(Object.keys(report.phases).sort(), [...expectedPhases].sort());
  for (const phase of expectedPhases) {
    assert.equal(report.phases[phase].calls, 1, 'missing or duplicate measured phase: ' + phase);
    assert.ok(Number.isFinite(report.phases[phase].wallMs) && report.phases[phase].wallMs >= 0);
  }
  const order = report.phaseOrder;
  assert.ok(Array.isArray(order));
  assert.equal(order.length, expectedPhases.length * 2);
  for (const phase of expectedPhases) {
    const start = order.indexOf(phase + ':start'), end = order.indexOf(phase + ':end');
    assert.ok(start >= 0 && end > start && end === order.lastIndexOf(phase + ':end'));
    if (phase.endsWith('Read')) assert.ok(end < order.indexOf('customerReducer:start'), 'source timer included reducer work');
  }
  assert.ok(order.indexOf('customerReducer:end') < order.indexOf('jsonSerialization:start'));
}

export async function runCustomerGetBaseline({ quick = false } = {}, createHarness) {
  if (!createHarness) {
    createHarness = require('./fixtures/merchantCustomerGetBaselineHarness.ts').createMerchantCustomerGetBaselineHarness;
  }
  const scenarios = quick ? CUSTOMER_GET_SCENARIOS.slice(0, 2) : CUSTOMER_GET_SCENARIOS;
  const results = [];
  let sourceHashes;
  for (const scenario of scenarios) {
    const { name, ...input } = scenario;
    // Compilation/module loading and fixture creation finish before GET timing.
    const measured = createHarness({ ...input, instrumentation: true });
    const reference = createHarness({ ...input, instrumentation: false });
    const first = await measured.get({ measure: true });
    const oracle = await reference.get({ measure: false });
    assertSuccessfulReport(first);
    assertMeasuredPhases(first);
    assertSuccessfulReport(oracle);
    assertIdenticalOutputs(first, oracle);
    const expectedCount = scenario.name === 'empty' ? 0 : scenario.distinctCustomers;
    assertExpectedContents(first, scenario);
    const samples = [];
    for (let index = 0; index < (quick ? 2 : 5); index++) {
      const sample = await measured.get({ measure: true });
      const referenceSample = await reference.get({ measure: false });
      assertSuccessfulReport(sample);
      assertMeasuredPhases(sample);
      assertSuccessfulReport(referenceSample);
      assertIdenticalOutputs(sample, referenceSample);
      assert.equal(sample.responseSha256, first.responseSha256, 'repeated GET changed the synthetic response');
      assertExpectedContents(sample, scenario);
      samples.push(sample);
    }
    assert.deepEqual(measured.sourceHashes, reference.sourceHashes, 'reference loaded different application code');
    if (sourceHashes) assert.deepEqual(measured.sourceHashes, sourceHashes, 'scenario loaded different application code');
    else sourceHashes = measured.sourceHashes;
    const phaseNames = Object.keys(first.phases);
    const phases = Object.fromEntries(phaseNames.map(phase => [phase, {
      ...describeSamples(samples.map(sample => sample.phases[phase].wallMs)),
      calls: samples.map(sample => sample.phases[phase].calls),
    }]));
    results.push({
      name, input, expectedCustomerCount: expectedCount, instrumentationParity: true,
      firstRequest: first,
      repeated: {
        get: describeSamples(samples.map(sample => sample.getWallMs)), phases,
        // Retain individual counts, not averages that could hide occasional repairs.
        samples,
      },
    });
  }
  if (!quick) assert.equal(results[1].firstRequest.responseSha256, results.at(-1).firstRequest.responseSha256, 'unrelated merchant growth changed target-merchant response');
  return {
    schema: 'faolla-customer-get-baseline-v1', mode: 'synthetic-offline',
    comparisonReference: '57dbac3ab07899fcca03a17d149c3c717b805d63',
    // sourceHashes, not this historical label, identify the executed files.
    referenceGitEquivalenceAutomaticallyChecked: false,
    node: process.version, platform: process.platform, quick, sourceHashes, results,
    boundaries: {
      realRouteAndSourceLoaders: true, productionTraffic: false, realAuthentication: false,
      realDatabase: false, realNetwork: false, realBrowser: false, providerDelivery: false,
      fixture: 'Fixed time; shared synthetic identities; cancelled bookings; V1 read modes off; local and remote booking copies.',
      timings: 'Instrumented wall time in one process. Source phases overlap and include nested work; do not sum them. Compilation, fixture preparation and final result/state fingerprints excluded; IO cloning, byte accounting and trace hashing included. Auth/snapshot inputs and all IO are synthetic.',
      bytes: 'Compact UTF-8 JSON at in-memory boundaries; local/remote copies and repeated reads count separately. Not HTTP transfer, SQL row size, RSS or heap peak.',
      percentiles: 'Small descriptive sample only. No production p95, SLO, maximum capacity or throughput claim.',
      parity: 'Phase-wrapped versus unwrapped module exports/serialization: response and IO-state fingerprints match for first and repeated GETs. Both use synthetic IO. This is not a replacement implementation comparison.',
    },
  };
}

export async function main(args = process.argv.slice(2)) {
  const options = parseBaselineArguments(args);
  const report = await runCustomerGetBaseline(options);
  // One compact JSON record retains every sample without bloating CI/log output.
  process.stdout.write(JSON.stringify(report) + '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(() => {
    // Do not dump fixture data or inherited environment on failure.
    process.stderr.write('customer_get_baseline_failed\n');
    process.exitCode = 1;
  });
}
