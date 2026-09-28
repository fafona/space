import assert from 'node:assert/strict';
import test from 'node:test';
import { main, MEMBERSHIP_PROFILE_SCENARIOS, runMembershipProfileBaseline } from './benchmark-merchant-customer-membership-profile.mjs';

const phases = ['storedRead', 'ordersRead', 'bookingsRead', 'membershipsRead', 'customerReducer', 'jsonSerialization'];
function fakeFactory(mutate = () => {}) {
  const calls = [];
  const create = options => {
    let request = 0;
    return { sourceHashes: { 'src/lib/merchantMembershipsStore.ts': 'c'.repeat(64) },
      async get(input) {
        request++;
        calls.push({ options, input, request });
        const count = options.memberships;
        const report = { status: 200, customerCount: count, warnings: [],
          outcomes: { orderCount: count, bookingCount: count, customersBySource: { manual: count, membership: count, order: count, booking: count } },
          responseBytes: count * 100, responseSha256: 'a'.repeat(64), effectsSha256: 'b'.repeat(64),
          inputBytes: { local: 10, remote: 20, total: 30 },
          io: { sessionResolutions: 1, snapshotReads: 2, localReads: 3, localWrites: 0, pageSelects: 7,
            pageUpdates: 0, pageInserts: 0, readBytes: 30, writeBytes: 0, forbiddenCalls: 0 },
          phases: Object.fromEntries(phases.map(name => [name, { calls: 1, wallMs: options.legacyMembershipRead ? 2 : 1 }])),
          phaseOrder: phases.flatMap(name => [name + ':start', name + ':end']),
          getWallMs: options.legacyMembershipRead ? 5 : 3, measurementEnabled: true };
        mutate(report, options, request);
        return report;
      } };
  };
  return { create, calls };
}

test('benchmark fixes bounded fixture sizes and rejects endpoint, credential and repeat arguments', async () => {
  assert.deepEqual(MEMBERSHIP_PROFILE_SCENARIOS.map(({ customers, transactionsPerMembership }) => [customers, transactionsPerMembership]),
    [[100, 0], [1000, 20], [10, 5000]]);
  for (const args of [['--url=https://example.test'], ['--token=private'], ['--repeats=100']]) {
    await assert.rejects(main(args), /accepts_no_arguments/);
  }
});

test('benchmark runs both orders with separate first requests and three paired repeats', async () => {
  const fake = fakeFactory();
  const report = await runMembershipProfileBaseline(fake.create);
  assert.equal(fake.calls.length, 48);
  assert.equal(report.results.length, 3);
  for (const result of report.results) {
    assert.deepEqual(result.orders.map(order => order.executionOrder), [['profile', 'legacy'], ['legacy', 'profile']]);
    assert.equal(result.responseIoEffectsParity, true);
    for (const order of result.orders) {
      assert.equal(order.repeated.length, 3);
      assert.equal(order.summary.profile.get.count, 3);
      assert.equal(order.summary.profile.phases.membershipsRead.medianMs, 1);
      assert.equal(order.summary.legacy.phases.membershipsRead.medianMs, 2);
    }
  }
  for (const call of fake.calls) {
    assert.equal(call.options.instrumentation, true);
    assert.deepEqual(call.input, { measure: true, view: 'manager-v1' });
  }
  assert.equal(report.boundaries.realDatabase, false);
  assert.match(report.measurementSources.harnessSha256, /^[a-f0-9]{64}$/);
  assert.match(report.measurementSources.scriptSha256, /^[a-f0-9]{64}$/);
});

test('benchmark rejects warnings, missing outcomes, missing timing and forbidden writes', async () => {
  for (const mutate of [report => { report.warnings = ['memberships_unavailable']; },
    report => { report.outcomes.customersBySource.membership--; },
    report => { report.phases.membershipsRead.calls = 0; },
    report => { report.measurementEnabled = false; },
    report => { report.io.pageUpdates = 1; }]) {
    await assert.rejects(runMembershipProfileBaseline(fakeFactory(mutate).create));
  }
});

test('benchmark checks every paired response, effect and byte fingerprint including last repeat', async () => {
  for (const key of ['responseSha256', 'effectsSha256', 'responseBytes', 'inputBytes', 'io']) {
    const fake = fakeFactory((report, options, request) => {
      if (!options.legacyMembershipRead && request === 4) {
        if (key === 'io') report.io.readBytes++;
        else if (key === 'inputBytes') report.inputBytes.remote++;
        else if (key === 'responseBytes') report.responseBytes++;
        else report[key] = 'd'.repeat(64);
      }
    });
    await assert.rejects(runMembershipProfileBaseline(fake.create), /parity/);
  }
});

test('benchmark rejects delayed source-completion timing that would include reducer work', async () => {
  const fake = fakeFactory(report => {
    report.phaseOrder = report.phaseOrder.filter(value => value !== 'membershipsRead:end');
    report.phaseOrder.push('membershipsRead:end');
  });
  await assert.rejects(runMembershipProfileBaseline(fake.create));
});
