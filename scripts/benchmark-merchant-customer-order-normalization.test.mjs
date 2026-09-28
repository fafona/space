import assert from 'node:assert/strict';
import test from 'node:test';
import { main, ORDER_NORMALIZATION_SCENARIOS, runOrderNormalizationBaseline } from './benchmark-merchant-customer-order-normalization.mjs';

const phases = ['storedRead', 'ordersRead', 'bookingsRead', 'membershipsRead', 'customerReducer', 'jsonSerialization'];
const storePath = 'src/lib/merchantOrdersStore.ts';
function fakeFactory(mutate = () => {}, mutateHarness = () => {}) {
  const calls = [], constructions = [];
  const create = options => {
    constructions.push(options);
    let request = 0;
    const sourceHashes = { [storePath]: 'c'.repeat(64), 'src/app/api/merchant-customers/route.ts': 'e'.repeat(64) };
    const harness = { sourceHashes, executedSourceHashes: { ...sourceHashes, [storePath]: (options.legacyOrderMerge ? 'd' : 'c').repeat(64) },
      async get(input) {
        request++; calls.push({ options, input, request });
        const count = options.orders;
        const report = { status: 200, customerCount: count, warnings: [],
          outcomes: { orderCount: count, bookingCount: count, customersBySource: { manual: count, membership: count, order: count, booking: count } },
          responseBytes: count * 100, responseSha256: 'a'.repeat(64), effectsSha256: 'b'.repeat(64),
          inputBytes: { local: 10, remote: 20, total: 30 },
          io: { sessionResolutions: 1, snapshotReads: 2, localReads: 3, localWrites: 0, pageSelects: 7,
            pageUpdates: 0, pageInserts: 0, readBytes: 30, writeBytes: 0, forbiddenCalls: 0 },
          phases: Object.fromEntries(phases.map(name => [name, { calls: 1, wallMs: options.legacyOrderMerge ? 2 : 1 }])),
          phaseOrder: phases.flatMap(name => [name + ':start', name + ':end']),
          getWallMs: options.legacyOrderMerge ? 5 : 3, measurementEnabled: true };
        mutate(report, options, request); return report;
      } };
    mutateHarness(harness, options); return harness;
  };
  return { create, calls, constructions };
}

test('order benchmark fixes bounded fixtures and rejects endpoint, credentials and repeat arguments', async () => {
  assert.deepEqual(ORDER_NORMALIZATION_SCENARIOS.map(({ customers, orderItemsPerOrder }) => [customers, orderItemsPerOrder]), [[100, 1], [1000, 20], [10000, 1]]);
  for (const args of [['--url=https://example.test'], ['--token=private'], ['--repeats=100']]) await assert.rejects(main(args), /accepts_no_arguments/);
});

test('order benchmark records distinct executed sources and both construction/request orders with first plus three repeats', async () => {
  const fake = fakeFactory(), report = await runOrderNormalizationBaseline(fake.create);
  assert.equal(fake.calls.length, 48); assert.equal(report.results.length, 3);
  assert.deepEqual(fake.constructions.map(options => options.legacyOrderMerge), Array.from({ length: 3 }, () => [false, true, true, false]).flat());
  assert.deepEqual(report.executedOrderStoreSha256, { reuse: 'c'.repeat(64), legacy: 'd'.repeat(64) });
  for (const result of report.results) {
    assert.deepEqual(result.orders.map(order => order.executionOrder), [['reuse', 'legacy'], ['legacy', 'reuse']]);
    assert.equal(result.responseIoEffectsParity, true);
    for (const order of result.orders) {
      assert.equal(order.repeated.length, 3); assert.equal(order.summary.reuse.get.count, 3);
      assert.equal(order.summary.reuse.phases.ordersRead.medianMs, 1); assert.equal(order.summary.legacy.phases.ordersRead.medianMs, 2);
    }
  }
  for (const call of fake.calls) { assert.equal(call.options.instrumentation, true); assert.deepEqual(call.input, { measure: true, view: 'manager-v1' }); }
  assert.equal(report.boundaries.realDatabase, false);
  for (const hash of Object.values(report.measurementSources)) assert.match(hash, /^[a-f0-9]{64}$/);
});

test('order benchmark refuses fake legacy execution and unrelated source changes', async () => {
  for (const mutate of [harness => { harness.executedSourceHashes = { ...harness.sourceHashes }; },
    (harness, options) => { if (options.legacyOrderMerge) harness.executedSourceHashes['src/unrelated.ts'] = 'f'.repeat(64); }]) {
    await assert.rejects(runOrderNormalizationBaseline(fakeFactory(undefined, mutate).create));
  }
});

test('order benchmark rejects warning, lost outcomes, missing measurement and writes', async () => {
  for (const mutate of [report => { report.warnings = ['orders_unavailable']; }, report => { report.outcomes.orderCount--; },
    report => { report.phases.ordersRead.calls = 0; }, report => { report.measurementEnabled = false; }, report => { report.io.pageUpdates = 1; }]) {
    await assert.rejects(runOrderNormalizationBaseline(fakeFactory(mutate).create));
  }
});

test('order benchmark verifies all paired response, effects and byte fingerprints through the last repeat', async () => {
  for (const key of ['responseSha256', 'effectsSha256', 'responseBytes', 'inputBytes', 'io']) {
    const fake = fakeFactory((report, options, request) => {
      if (!options.legacyOrderMerge && request === 4) {
        if (key === 'io') report.io.readBytes++;
        else if (key === 'inputBytes') report.inputBytes.remote++;
        else if (key === 'responseBytes') report.responseBytes++;
        else report[key] = 'd'.repeat(64);
      }
    });
    await assert.rejects(runOrderNormalizationBaseline(fake.create), /parity/);
  }
});

test('order benchmark rejects delayed source observers and repeated output changes shared by both paths', async () => {
  for (const mutate of [report => { report.phaseOrder = report.phaseOrder.filter(value => value !== 'ordersRead:end'); report.phaseOrder.push('ordersRead:end'); },
    (report, _options, request) => { if (request === 4) report.responseSha256 = 'f'.repeat(64); }]) {
    await assert.rejects(runOrderNormalizationBaseline(fakeFactory(mutate).create));
  }
});
