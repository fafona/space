// Offline actual-GET comparison. No endpoints, credentials or external payloads.
// Run: node --import tsx scripts/benchmark-merchant-customer-membership-profile.mjs
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describeSamples } from './benchmark-merchant-customer-get.mjs';

const require = createRequire(import.meta.url);
export const MEMBERSHIP_PROFILE_SCENARIOS = Object.freeze([
  { name: '100-customers-empty-history', customers: 100, transactionsPerMembership: 0 },
  { name: '1000-customers-20-transactions', customers: 1000, transactionsPerMembership: 20 },
  { name: '10-customers-5000-transactions', customers: 10, transactionsPerMembership: 5000 },
].map(Object.freeze));
const expectedPhases = ['storedRead', 'ordersRead', 'bookingsRead', 'membershipsRead', 'customerReducer', 'jsonSerialization'];
const invariantKeys = ['status', 'customerCount', 'warnings', 'outcomes', 'responseBytes', 'responseSha256', 'effectsSha256', 'inputBytes', 'io', 'phaseOrder'];
const sha = value => createHash('sha256').update(value).digest('hex');

function assertReport(report, customers) {
  assert.equal(report.status, 200);
  assert.equal(report.customerCount, customers);
  assert.deepEqual(report.warnings, []);
  assert.deepEqual(report.outcomes, { orderCount: customers, bookingCount: customers,
    customersBySource: { manual: customers, membership: customers, order: customers, booking: customers } });
  assert.equal(report.io.forbiddenCalls + report.io.localWrites + report.io.pageUpdates + report.io.pageInserts, 0);
  for (const key of ['responseSha256', 'effectsSha256']) assert.match(report[key], /^[a-f0-9]{64}$/);
  assert.equal(report.measurementEnabled, true);
  assert.ok(Number.isFinite(report.getWallMs) && report.getWallMs >= 0);
  assert.deepEqual(Object.keys(report.phases).sort(), [...expectedPhases].sort());
  assert.equal(report.phaseOrder.length, 12);
  for (const phase of expectedPhases) {
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
  phases: Object.fromEntries(expectedPhases.map(phase => [phase, describeSamples(samples.map(sample => sample.phases[phase]))])) });

export async function runMembershipProfileBaseline(createHarness) {
  createHarness ??= require('./fixtures/merchantCustomerGetBaselineHarness.ts').createMerchantCustomerGetBaselineHarness;
  let sourceHashes;
  const results = [];
  for (const scenario of MEMBERSHIP_PROFILE_SCENARIOS) {
    const { customers, transactionsPerMembership } = scenario;
    const fixture = { storedCustomers: customers, orders: customers, bookings: customers,
      memberships: customers, distinctCustomers: customers, transactionsPerMembership };
    const orders = [];
    let invariant;
    for (const executionOrder of [['profile', 'legacy'], ['legacy', 'profile']]) {
      const harnesses = { profile: createHarness({ ...fixture, instrumentation: true }),
        legacy: createHarness({ ...fixture, instrumentation: true, legacyMembershipRead: true }) };
      assert.deepEqual(harnesses.profile.sourceHashes, harnesses.legacy.sourceHashes);
      if (sourceHashes) assert.deepEqual(harnesses.profile.sourceHashes, sourceHashes);
      else sourceHashes = harnesses.profile.sourceHashes;
      const samples = [];
      for (let request = 0; request < 4; request++) {
        const reports = {};
        for (const variant of executionOrder) reports[variant] = await harnesses[variant].get({ measure: true, view: 'manager-v1' });
        for (const report of Object.values(reports)) assertReport(report, customers);
        for (const key of invariantKeys) assert.deepEqual(reports.profile[key], reports.legacy[key], key + ' parity');
        const current = Object.fromEntries(invariantKeys.map(key => [key, reports.profile[key]]));
        if (invariant) assert.deepEqual(current, invariant, 'repeated GET or order changed outputs/effects');
        else invariant = current;
        samples.push({ profile: timing(reports.profile), legacy: timing(reports.legacy) });
      }
      assert.deepEqual(harnesses.profile.sourceHashes, sourceHashes, 'profile GET lazily loaded source');
      assert.deepEqual(harnesses.legacy.sourceHashes, sourceHashes, 'legacy GET lazily loaded source');
      orders.push({ executionOrder, first: samples[0], repeated: samples.slice(1),
        summary: { profile: summarize(samples.slice(1).map(sample => sample.profile)),
          legacy: summarize(samples.slice(1).map(sample => sample.legacy)) } });
    }
    results.push({ name: scenario.name, fixture, invariant, responseIoEffectsParity: true, orders });
  }
  return { schema: 'faolla-customer-membership-profile-read-v1', mode: 'synthetic-offline',
    node: process.version, platform: process.platform, sourceHashes,
    measurementSources: { scriptSha256: sha(readFileSync(new URL(import.meta.url))),
      harnessSha256: sha(readFileSync(new URL('./fixtures/merchantCustomerGetBaselineHarness.ts', import.meta.url))) },
    results, boundaries: { actualRouteAndStoreFunctions: true, realAuthentication: false, realNetwork: false,
      realDatabase: false, productionTraffic: false, realBrowser: false, view: 'manager-v1',
      reference: 'Explicit legacyMembershipRead binds the new loader export to the real full loader in the same store module; no reimplementation.',
      timing: 'First request plus three repeats per order; two in-process request orders. Not cold process, production latency, CPU-exclusive time, p95 or throughput. Fixture preparation/compilation/final hashes excluded; synthetic IO cloning, accounting and event hashing included. Overlapping source phases must not be summed.',
      bytes: 'Identical compact UTF-8 JSON read-byte accounting and response bytes per pair. Full transaction histories still cross the simulated DB boundary; no reduced database-read or network-transfer claim.',
      conditions: 'Fixed synthetic time and identities, cancelled bookings, V1 modes off; no private input or production requests.' } };
}

export async function main(args = process.argv.slice(2)) {
  assert.equal(args.length, 0, 'membership_profile_baseline_accepts_no_arguments');
  process.stdout.write(JSON.stringify(await runMembershipProfileBaseline()) + '\n');
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(() => { process.stderr.write('membership_profile_baseline_failed\n'); process.exitCode = 1; });
}
