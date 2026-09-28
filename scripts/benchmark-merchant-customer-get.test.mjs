import assert from 'node:assert/strict';
import test from 'node:test';
import { CUSTOMER_GET_SCENARIOS, describeSamples, parseBaselineArguments, runCustomerGetBaseline } from './benchmark-merchant-customer-get.mjs';

function fakeHarness(options, override = {}) {
  const report = {
    status: 200, customerCount: options.orders ? options.distinctCustomers : 0, warnings: [],
    responseBytes: 10, responseSha256: 'a'.repeat(64), effectsSha256: 'b'.repeat(64),
    inputBytes: { local: 1, remote: 2, total: 3 }, io: { forbiddenCalls: 0, pageSelects: 4 },
    outcomes: { orderCount: options.orders, bookingCount: options.bookings, customersBySource: {
      manual: Math.min(options.storedCustomers, options.distinctCustomers),
      membership: Math.min(options.memberships, options.distinctCustomers),
      order: Math.min(options.orders, options.distinctCustomers),
      booking: Math.min(options.bookings, options.distinctCustomers),
    } },
    phases: Object.fromEntries(['storedRead', 'ordersRead', 'bookingsRead', 'membershipsRead', 'customerReducer', 'jsonSerialization']
      .map(name => [name, { calls: 1, wallMs: 2 }])), getWallMs: 5,
    phaseOrder: ['storedRead', 'ordersRead', 'bookingsRead', 'membershipsRead', 'customerReducer', 'jsonSerialization']
      .flatMap(name => [name + ':start', name + ':end']),
  };
  return { sourceHashes: { 'app/api/merchant-customers/route.ts': 'c'.repeat(64) },
    get: async ({ measure }) => ({ ...report, ...override, measurementEnabled: measure }) };
}

test('CLI only permits the bounded offline profiles, never endpoint, data or credentials', () => {
  assert.deepEqual(parseBaselineArguments([]), { quick: false });
  assert.deepEqual(parseBaselineArguments(['--quick']), { quick: true });
  for (const args of [['--quick', '--quick'], ['--url=https://faolla.com'], ['--siteId=10000000'], ['--input=data.json'], ['--samples=0'], ['--help'], [''], null]) {
    assert.throws(() => parseBaselineArguments(args), /customer_get_baseline_arguments_invalid/);
  }
});

test('scenario matrix distinguishes identity growth, activity depth and unrelated tenant growth', () => {
  assert.deepEqual(CUSTOMER_GET_SCENARIOS.slice(1, 4).map(s => s.distinctCustomers), [100, 1000, 10000]);
  assert.equal(CUSTOMER_GET_SCENARIOS[4].distinctCustomers, 1);
  assert.equal(CUSTOMER_GET_SCENARIOS[4].orders + CUSTOMER_GET_SCENARIOS[4].bookings, 20000);
  assert.equal(CUSTOMER_GET_SCENARIOS[5].foreignBookings, 10000);
  assert.ok(CUSTOMER_GET_SCENARIOS.every(Object.isFrozen));
});

test('summary is descriptive, rejects invalid samples and does not invent percentiles', () => {
  const input = [4, 2, 3, 1];
  assert.deepEqual(describeSamples(input), { count: 4, minMs: 1, medianMs: 2.5, maxMs: 4 });
  assert.deepEqual(input, [4, 2, 3, 1]);
  assert.equal(describeSamples([5, 1, 3]).medianMs, 3);
  for (const invalid of [[], [NaN], [Infinity], [-1]]) assert.throws(() => describeSamples(invalid));
});

test('runner compares instrumentation and preserves first versus repeated request measurements', async () => {
  const selections = [];
  const report = await runCustomerGetBaseline({ quick: true }, options => {
    selections.push(options.instrumentation);
    return fakeHarness(options);
  });
  assert.deepEqual(selections, [true, false, true, false]);
  assert.equal(report.results.length, 2);
  assert.equal(report.results[1].expectedCustomerCount, 100);
  assert.equal(report.results[1].repeated.samples.length, 2);
  assert.equal(report.results[1].repeated.get.medianMs, 5);
  assert.equal(report.boundaries.productionTraffic, false);
  assert.equal(report.boundaries.realAuthentication, false);
});

test('runner refuses plausible successful responses without source phase measurement', async () => {
  await assert.rejects(runCustomerGetBaseline({ quick: true }, options => {
    const harness = fakeHarness(options);
    const get = harness.get;
    harness.get = async args => {
      const report = await get(args);
      report.phases.bookingsRead.calls = 0;
      return report;
    };
    return harness;
  }), /missing or duplicate measured phase/);
});

test('runner rejects a late source observer that would count reducer work as a source read', async () => {
  await assert.rejects(runCustomerGetBaseline({ quick: true }, options => {
    const harness = fakeHarness(options);
    const get = harness.get;
    harness.get = async args => {
      const report = await get(args);
      report.phaseOrder = report.phaseOrder.filter(event => event !== 'bookingsRead:end');
      report.phaseOrder.push('bookingsRead:end');
      return report;
    };
    return harness;
  }), /source timer included reducer work/);
});

test('runner rejects partial sources, silent data loss and forbidden IO even with HTTP 200', async () => {
  for (const override of [{ warnings: ['orders_unavailable'] }, { status: 503 }, { customerCount: 42 }, { io: { forbiddenCalls: 1 } }]) {
    await assert.rejects(runCustomerGetBaseline({ quick: true }, options => fakeHarness(options, override)));
  }
});

test('runner rejects missing activity even when all customer identities survive in both paths', async () => {
  await assert.rejects(runCustomerGetBaseline({ quick: true }, options => {
    const harness = fakeHarness(options);
    const get = harness.get;
    harness.get = async args => {
      const report = await get(args);
      if (options.orders) report.outcomes.orderCount--;
      return report;
    };
    return harness;
  }), /order activity was lost/);
});

test('runner rejects instrumentation response or side-effect changes', async () => {
  for (const key of ['responseSha256', 'effectsSha256']) {
    await assert.rejects(runCustomerGetBaseline({ quick: true }, options => {
      const harness = fakeHarness(options);
      const get = harness.get;
      harness.get = async args => ({ ...await get(args), [key]: (args.measure ? 'a' : 'b').repeat(64) });
      return harness;
    }), /instrumentation changed/);
  }
});

test('runner compares every repeated request, including effects with unchanged response', async () => {
  for (const field of ['effectsSha256', 'io', 'inputBytes']) {
    await assert.rejects(runCustomerGetBaseline({ quick: true }, options => {
      const harness = fakeHarness(options);
      const get = harness.get;
      let calls = 0;
      harness.get = async args => {
        const report = await get(args);
        if (++calls > 1 && args.measure) {
          if (field === 'effectsSha256') report.effectsSha256 = 'd'.repeat(64);
          else if (field === 'io') report.io = { forbiddenCalls: 0, pageSelects: 5 };
          else report.inputBytes = { local: 2, remote: 2, total: 4 };
        }
        return report;
      };
      return harness;
    }), new RegExp('instrumentation changed ' + field));
  }
});
