// Offline actual-GET comparison; no endpoints, credentials or private inputs.
// Run: node --import tsx scripts/benchmark-merchant-customer-order-normalization.mjs
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describeSamples } from './benchmark-merchant-customer-get.mjs';

const require = createRequire(import.meta.url);
export const ORDER_NORMALIZATION_SCENARIOS = Object.freeze([
  { name: '100-customers-1-item', customers: 100, orderItemsPerOrder: 1 },
  { name: '1000-customers-20-items', customers: 1000, orderItemsPerOrder: 20 },
  { name: '10000-customers-1-item', customers: 10000, orderItemsPerOrder: 1 },
].map(Object.freeze));
const storePath = 'src/lib/merchantOrdersStore.ts';
const phases = ['storedRead', 'ordersRead', 'bookingsRead', 'membershipsRead', 'customerReducer', 'jsonSerialization'];
const invariantKeys = ['status', 'customerCount', 'warnings', 'outcomes', 'responseBytes', 'responseSha256', 'effectsSha256', 'inputBytes', 'io', 'phaseOrder'];
const sha = value => createHash('sha256').update(value).digest('hex');

function assertReport(report, customers) {
  assert.equal(report.status, 200); assert.equal(report.customerCount, customers); assert.deepEqual(report.warnings, []);
  assert.deepEqual(report.outcomes, { orderCount: customers, bookingCount: customers,
    customersBySource: { manual: customers, membership: customers, order: customers, booking: customers } });
  assert.equal(report.io.forbiddenCalls + report.io.localWrites + report.io.pageUpdates + report.io.pageInserts, 0);
  assert.ok(Number.isSafeInteger(report.responseBytes) && report.responseBytes > 0);
  for (const key of ['responseSha256', 'effectsSha256']) assert.match(report[key], /^[a-f0-9]{64}$/);
  assert.equal(report.measurementEnabled, true);
  assert.ok(Number.isFinite(report.getWallMs) && report.getWallMs >= 0);
  assert.deepEqual(Object.keys(report.phases).sort(), [...phases].sort()); assert.equal(report.phaseOrder.length, 12);
  for (const phase of phases) {
    assert.equal(report.phases[phase].calls, 1);
    assert.ok(Number.isFinite(report.phases[phase].wallMs) && report.phases[phase].wallMs >= 0);
    const start = report.phaseOrder.indexOf(phase + ':start'), end = report.phaseOrder.indexOf(phase + ':end');
    assert.ok(start >= 0 && end > start);
    if (phase.endsWith('Read')) assert.ok(end < report.phaseOrder.indexOf('customerReducer:start'));
  }
}

const timing = report => ({ getWallMs: report.getWallMs,
  phases: Object.fromEntries(Object.entries(report.phases).map(([name, phase]) => [name, phase.wallMs])) });
const summarize = samples => ({ get: describeSamples(samples.map(sample => sample.getWallMs)),
  phases: Object.fromEntries(phases.map(phase => [phase, describeSamples(samples.map(sample => sample.phases[phase]))])) });

export async function runOrderNormalizationBaseline(createHarness) {
  createHarness ??= require('./fixtures/merchantCustomerGetBaselineHarness.ts').createMerchantCustomerGetBaselineHarness;
  let sourceHashes, executedOrderStoreSha256;
  const results = [];
  for (const scenario of ORDER_NORMALIZATION_SCENARIOS) {
    const { customers, orderItemsPerOrder } = scenario;
    const fixture = { storedCustomers: customers, orders: customers, bookings: customers,
      memberships: customers, distinctCustomers: customers, orderItemsPerOrder };
    const orders = [];
    let invariant;
    for (const executionOrder of [['reuse', 'legacy'], ['legacy', 'reuse']]) {
      const harnesses = Object.fromEntries(executionOrder.map(variant => [variant,
        createHarness({ ...fixture, instrumentation: true, legacyOrderMerge: variant === 'legacy' })]));
      assert.deepEqual(harnesses.reuse.sourceHashes, harnesses.legacy.sourceHashes, 'paired disk sources differ');
      if (sourceHashes) assert.deepEqual(harnesses.reuse.sourceHashes, sourceHashes);
      else sourceHashes = harnesses.reuse.sourceHashes;
      assert.deepEqual(harnesses.reuse.executedSourceHashes, sourceHashes, 'candidate must execute disk sources');
      const executed = Object.fromEntries(executionOrder.map(variant => [variant, harnesses[variant].executedSourceHashes[storePath]]));
      for (const hash of Object.values(executed)) assert.match(hash, /^[a-f0-9]{64}$/);
      assert.notEqual(executed.reuse, executed.legacy, 'legacy must execute the pinned restored store, not candidate code');
      assert.deepEqual(harnesses.legacy.executedSourceHashes, { ...sourceHashes, [storePath]: executed.legacy }, 'only the order store may differ');
      if (executedOrderStoreSha256) assert.deepEqual(executed, executedOrderStoreSha256);
      else executedOrderStoreSha256 = executed;
      const samples = [];
      for (let request = 0; request < 4; request++) {
        const reports = {};
        for (const variant of executionOrder) reports[variant] = await harnesses[variant].get({ measure: true, view: 'manager-v1' });
        for (const report of Object.values(reports)) assertReport(report, customers);
        for (const key of invariantKeys) assert.deepEqual(reports.reuse[key], reports.legacy[key], key + ' parity');
        const current = Object.fromEntries(invariantKeys.map(key => [key, reports.reuse[key]]));
        if (invariant) assert.deepEqual(current, invariant, 'repeated GET or order changed outputs/effects');
        else invariant = current;
        samples.push({ reuse: timing(reports.reuse), legacy: timing(reports.legacy) });
      }
      for (const variant of executionOrder) {
        assert.deepEqual(harnesses[variant].sourceHashes, sourceHashes, 'GET lazily loaded disk source');
        assert.deepEqual(harnesses[variant].executedSourceHashes, { ...sourceHashes, [storePath]: executed[variant] }, 'GET changed executed sources');
      }
      orders.push({ executionOrder, first: samples[0], repeated: samples.slice(1),
        summary: { reuse: summarize(samples.slice(1).map(sample => sample.reuse)), legacy: summarize(samples.slice(1).map(sample => sample.legacy)) } });
    }
    results.push({ name: scenario.name, fixture, invariant, responseIoEffectsParity: true, orders });
  }
  return { schema: 'faolla-customer-order-normalization-v1', mode: 'synthetic-offline', node: process.version, platform: process.platform,
    sourceHashes, executedOrderStoreSha256,
    measurementSources: { scriptSha256: sha(readFileSync(new URL(import.meta.url))),
      harnessSha256: sha(readFileSync(new URL('./fixtures/merchantCustomerGetBaselineHarness.ts', import.meta.url))),
      referenceFixtureSha256: sha(readFileSync(new URL('./fixtures/merchantOrdersMergeReference.ts', import.meta.url))) },
    results, boundaries: { actualRouteAndStoreFunctions: true, realAuthentication: false, realNetwork: false,
      realDatabase: false, productionTraffic: false, realBrowser: false, view: 'manager-v1',
      reference: 'legacyOrderMerge restores only the real order store to its pinned complete prior source; all other application modules execute identically. Compilation is keyed by executed source hash.',
      hashes: 'sourceHashes identifies on-disk candidate files. executedOrderStoreSha256 explicitly distinguishes candidate and legacy executed stores; every other executed source matches disk.',
      timing: 'First plus three repeated GETs in both in-process request/construction orders. Not cold process, production latency, CPU-exclusive time, p95 or throughput. Compilation/fixture preparation/final hashes excluded; synthetic IO cloning/accounting/event hashing included. Overlapping source phases must not be summed.',
      bytes: 'Paired response and simulated read bytes must be identical. No database-read or HTTP-transfer reduction claim.',
      conditions: 'Fixed synthetic time, shared identities, cancelled bookings, V1 modes off; no private or production inputs.' } };
}

export async function main(args = process.argv.slice(2)) {
  assert.equal(args.length, 0, 'order_normalization_baseline_accepts_no_arguments');
  process.stdout.write(JSON.stringify(await runOrderNormalizationBaseline()) + '\n');
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(() => { process.stderr.write('order_normalization_baseline_failed\n'); process.exitCode = 1; });
}
