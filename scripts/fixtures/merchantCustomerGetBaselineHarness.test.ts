import assert from "node:assert/strict";
import test from "node:test";
import { isDeepStrictEqual } from "node:util";
import { runInNewContext } from "node:vm";
import {
  createMerchantCustomerGetBaselineHarness,
  type MerchantCustomerGetBaselineOptions,
  type MerchantCustomerGetBaselineReport,
} from "./merchantCustomerGetBaselineHarness";

const mixed = { storedCustomers: 5, orders: 9, bookings: 8, memberships: 5, distinctCustomers: 5 };
function withoutTiming(report: MerchantCustomerGetBaselineReport, raw = false) {
  return { ...report, measurementEnabled: false, getWallMs: 0,
    phaseOrder: raw ? [] : report.phaseOrder,
    phases: Object.fromEntries(Object.entries(report.phases).map(([key, value]) => [key, { calls: raw ? 0 : value.calls, wallMs: 0 }])) };
}
function assertZeroDataIo(report: MerchantCustomerGetBaselineReport) {
  for (const key of ["snapshotReads", "localReads", "localWrites", "pageSelects", "pageUpdates", "pageInserts", "readBytes", "writeBytes", "forbiddenCalls"] as const) {
    assert.equal(report.io[key], 0, key);
  }
  for (const [key, phase] of Object.entries(report.phases)) if (key !== "jsonSerialization") assert.equal(phase.calls, 0, key);
}

test("baseline executes the actual full GET, four source entrypoints and reducer with private aggregate-only reports", async () => {
  const harness = createMerchantCustomerGetBaselineHarness({ ...mixed, instrumentation: true });
  const sourceHashes = harness.sourceHashes;
  for (const file of ["src/app/api/merchant-customers/route.ts", "src/lib/merchantCustomers.ts", "src/lib/merchantBookings.server.ts",
    "src/lib/merchantBookingPersistenceStore.ts", "src/lib/merchantOrders.server.ts", "src/lib/merchantOrdersStore.ts",
    "src/lib/merchantCustomerDirectoryStore.ts", "src/lib/merchantMembershipsStore.ts", "src/lib/merchantBookingRulesStore.ts", "src/lib/merchantBookingWorkbenchStore.ts"]) {
    assert.match(sourceHashes[file], /^[a-f0-9]{64}$/, file);
  }
  const report = await harness.get();
  assert.equal(report.status, 200); assert.equal(report.customerCount, 5); assert.deepEqual(report.warnings, []);
  assert.deepEqual(report.outcomes, { orderCount: 9, bookingCount: 8, customersBySource: { manual: 5, membership: 5, order: 5, booking: 5 } });
  assert.equal(report.io.forbiddenCalls, 0); assert.equal(report.io.pageUpdates + report.io.pageInserts + report.io.localWrites, 0);
  assert.ok(report.io.pageSelects >= 6); assert.equal(report.io.sessionResolutions, 1);
  for (const phase of Object.values(report.phases)) { assert.equal(phase.calls, 1); assert.ok(Number.isFinite(phase.wallMs) && phase.wallMs >= 0); }
  assert.ok(Number.isFinite(report.getWallMs) && report.getWallMs >= 0);
  assert.equal(report.inputBytes.total, report.inputBytes.local + report.inputBytes.remote);
  assert.ok(report.responseBytes > 0); assert.ok(report.io.readBytes > 0);
  assert.match(report.responseSha256, /^[a-f0-9]{64}$/); assert.match(report.effectsSha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(harness.sourceHashes, sourceHashes, "GET must not lazily load/compile additional source");
  assert.doesNotMatch(JSON.stringify(report), /example\.test|Synthetic customer|private-synthetic|customerAccountId|"customers"\s*:/);
});

test("each synthetic source independently reaches the actual customer reducer", async () => {
  for (const field of ["storedCustomers", "orders", "bookings", "memberships"] as const) {
    const report = await createMerchantCustomerGetBaselineHarness({ [field]: 4, distinctCustomers: 4 }).get();
    assert.equal(report.status, 200, field); assert.equal(report.customerCount, 4, field);
    assert.deepEqual(report.warnings, [], field); assert.equal(report.io.forbiddenCalls, 0);
    assert.deepEqual(report.outcomes, { orderCount: field === "orders" ? 4 : 0, bookingCount: field === "bookings" ? 4 : 0,
      customersBySource: { manual: field === "storedCustomers" ? 4 : 0, membership: field === "memberships" ? 4 : 0,
        order: field === "orders" ? 4 : 0, booking: field === "bookings" ? 4 : 0 } });
  }
  const repeated = await createMerchantCustomerGetBaselineHarness({ ...mixed, distinctCustomers: 1 }).get();
  assert.equal(repeated.customerCount, 1, "returning customer activity across every source must remain one identity");
  assert.deepEqual(repeated.outcomes, { orderCount: 9, bookingCount: 8, customersBySource: { manual: 1, membership: 1, order: 1, booking: 1 } });
});

test("measurement on/off preserves complete response, IO effects and final memory for repeated actual GETs", async () => {
  for (const bookingReadRepair of [false, true]) {
    const measured = createMerchantCustomerGetBaselineHarness({ ...mixed, bookingReadRepair, instrumentation: true });
    const reference = createMerchantCustomerGetBaselineHarness({ ...mixed, bookingReadRepair, instrumentation: false });
    const countsOnly = createMerchantCustomerGetBaselineHarness({ ...mixed, bookingReadRepair, instrumentation: true });
    for (let index = 0; index < 3; index++) {
      const next = await measured.get(), old = await reference.get({ measure: false });
      assert.deepEqual(withoutTiming(next, true), old, "raw unwrapped route must preserve complete response and effects");
      assert.deepEqual(withoutTiming(next), await countsOnly.get({ measure: false }), "timing-off instrumented counts remain stable");
      assert.equal(next.customerCount, 5);
      if (bookingReadRepair && index === 0) assert.ok(next.io.pageUpdates + next.io.pageInserts > 0, "actual read-repair must reach memory writes");
      else assert.equal(next.io.pageUpdates + next.io.pageInserts + next.io.localWrites, 0, "settled sources do not invent repairs");
    }
  }
});

test("foreign-merchant bookings increase actual global-store work without changing the target response", async () => {
  const ordinary = await createMerchantCustomerGetBaselineHarness(mixed).get();
  const noisy = await createMerchantCustomerGetBaselineHarness({ ...mixed, foreignBookings: 30 }).get();
  assert.equal(noisy.responseSha256, ordinary.responseSha256); assert.equal(noisy.customerCount, ordinary.customerCount);
  assert.deepEqual(noisy.outcomes, ordinary.outcomes, "foreign records cannot inflate target activity counts");
  assert.ok(noisy.inputBytes.local > ordinary.inputBytes.local); assert.ok(noisy.inputBytes.remote > ordinary.inputBytes.remote);
  assert.ok(noisy.io.readBytes > ordinary.io.readBytes); assert.equal(noisy.io.forbiddenCalls, 0);
});

test("actual source failures retain mandatory stored-directory failure and optional-source warnings", async () => {
  for (const failSource of ["customers", "orders", "bookings", "memberships"] as const) {
    const options = { ...mixed, failSource };
    const next = await createMerchantCustomerGetBaselineHarness({ ...options, instrumentation: true }).get();
    const reference = await createMerchantCustomerGetBaselineHarness(options).get({ measure: false });
    assert.deepEqual(withoutTiming(next, true), reference);
    assert.equal(next.status, failSource === "customers" ? 503 : 200);
    assert.deepEqual(next.warnings, failSource === "customers" ? [] : [failSource + "_unavailable"]);
    assert.equal(next.phases.customerReducer.calls, failSource === "customers" ? 0 : 1);
    assert.equal(next.io.forbiddenCalls, 0);
    assert.equal(next.outcomes.orderCount, ["customers", "orders"].includes(failSource) ? 0 : mixed.orders);
    assert.equal(next.outcomes.bookingCount, ["customers", "bookings"].includes(failSource) ? 0 : mixed.bookings);
  }
});

test("invalid site, missing identity and wrong verified merchant stop before all data IO", async () => {
  for (const [options, request, status, sessions] of [
    [mixed, { requestedSiteId: "invalid" }, 400, 0],
    [{ ...mixed, sessionSiteId: null }, {}, 401, 1],
    [{ ...mixed, sessionSiteId: "99990002" }, {}, 401, 1],
  ] as const) {
    const report = await createMerchantCustomerGetBaselineHarness({ ...options, instrumentation: true }).get(request);
    const reference = await createMerchantCustomerGetBaselineHarness(options).get({ ...request, measure: false });
    assert.deepEqual(withoutTiming(report, true), reference);
    assert.equal(report.status, status); assert.equal(report.io.sessionResolutions, sessions); assertZeroDataIo(report);
    assert.equal(report.phases.jsonSerialization.calls, 1);
  }
});

test("empty sources and explicit counts are deterministic, bounded, and do not accept caller-provided payloads", async () => {
  const one = createMerchantCustomerGetBaselineHarness(), two = createMerchantCustomerGetBaselineHarness();
  assert.deepEqual(await one.get({ measure: false }), await two.get({ measure: false }));
  for (const options of [{ bookings: -1 }, { orders: 0.1 }, { memberships: 100_001 }, { storedCustomers: Number.NaN },
    { foreignBookings: Infinity }, { distinctCustomers: 0 }, { bookings: [] }, { failSource: "unrecognized" }, { sessionSiteId: "customer@example.test" },
    { noteLength: -1 }, { noteLength: 1001 }, { noteLength: 0.1 }, { noteLength: Number.NaN }, { noteLength: "1000" }]) {
    assert.throws(() => createMerchantCustomerGetBaselineHarness(options as MerchantCustomerGetBaselineOptions), /invalid_baseline_/);
  }
});

test("payload audit is opt-in and the default full GET retains its pre-projection response fingerprints", async () => {
  for (const [options, responseBytes, responseSha256] of [
    [{}, 87, "a8d1a565217733a4ced41c81a8b0a5db8ebf0c1b79f1e6510ad80e0a4196d4a9"],
    [mixed, 6641, "197e96495bbf2422fbb851f72860fd66dcd76aae9b5f52610d09fdce50b302ba"],
  ] as const) {
    const plain = await createMerchantCustomerGetBaselineHarness(options).get({ measure: false });
    assert.equal(plain.responseBytes, responseBytes); assert.equal(plain.responseSha256, responseSha256);
    assert.equal(Object.hasOwn(plain, "payloadAudit"), false, "legacy reports keep their existing shape");
    const audited = await createMerchantCustomerGetBaselineHarness(options).get({ measure: false, payloadAudit: true });
    const { payloadAudit, ...unchanged } = audited;
    assert.deepEqual(unchanged, plain, "post-GET gzip and oracle hashing cannot change response or IO");
    assert.ok(payloadAudit && payloadAudit.responseGzipBytes > 0);
    assert.match(payloadAudit.responseCanonicalSha256, /^[a-f0-9]{64}$/);
    assert.match(payloadAudit.projectedResponseCanonicalSha256, /^[a-f0-9]{64}$/);
    assert.doesNotMatch(JSON.stringify(audited), /example\.test|Synthetic customer|private-synthetic|customerAccountId|"customers"\s*:/);
  }
});

test("actual manager GET equals an independent five-field deletion oracle with identical inputs and effects", async () => {
  const scenarios: MerchantCustomerGetBaselineOptions[] = [{}, mixed,
    { storedCustomers: 4 }, { orders: 4 }, { bookings: 4 }, { memberships: 4 },
    { ...mixed, distinctCustomers: 1 }, { ...mixed, foreignBookings: 30 },
    { ...mixed, noteLength: 0 }, { ...mixed, noteLength: 1000 }, { ...mixed, bookingReadRepair: true },
    ...(["customers", "orders", "bookings", "memberships"] as const).map((failSource) => ({ ...mixed, failSource })),
  ];
  for (const options of scenarios) {
    const fullHarness = createMerchantCustomerGetBaselineHarness({ ...options, instrumentation: true });
    const managerHarness = createMerchantCustomerGetBaselineHarness({ ...options, instrumentation: true });
    const sourceHashes = managerHarness.sourceHashes;
    assert.match(sourceHashes["src/lib/merchantCustomerListView.ts"], /^[a-f0-9]{64}$/);
    for (let request = 0; request < (options.bookingReadRepair ? 3 : 1); request++) {
      const full = await fullHarness.get({ measure: false, payloadAudit: true });
      const manager = await managerHarness.get({ measure: false, view: "manager-v1", payloadAudit: true });
      for (const key of ["status", "customerCount", "warnings", "outcomes", "effectsSha256", "inputBytes", "io", "phases", "phaseOrder"] as const) {
        assert.deepEqual(manager[key], full[key], key + " changed under manager view");
      }
      assert.ok(full.payloadAudit && manager.payloadAudit);
      assert.equal(manager.payloadAudit.responseCanonicalSha256, full.payloadAudit.projectedResponseCanonicalSha256,
        "all profile fields, summaries, incomplete flags, order and envelope/version must equal the independent full-response projection");
      assert.equal(manager.payloadAudit.projectedResponseCanonicalSha256, manager.payloadAudit.responseCanonicalSha256);
      if (full.status === 200 && full.customerCount > 0) {
        assert.ok(manager.responseBytes < full.responseBytes, "the actual serialized response must be smaller");
        assert.notEqual(manager.responseSha256, full.responseSha256);
      } else assert.equal(manager.responseSha256, full.responseSha256);
    }
    assert.deepEqual(fullHarness.sourceHashes, sourceHashes);
    assert.deepEqual(managerHarness.sourceHashes, sourceHashes, "GET cannot lazily load additional source modules");
  }
});

test("manager view leaves denied requests unchanged and unrecognized views retain the legacy full response", async () => {
  for (const [options, requestedSiteId] of [
    [mixed, "invalid"], [{ ...mixed, sessionSiteId: null }, undefined], [{ ...mixed, sessionSiteId: "99990002" }, undefined],
  ] as const) {
    const full = await createMerchantCustomerGetBaselineHarness(options).get({ measure: false, requestedSiteId });
    const manager = await createMerchantCustomerGetBaselineHarness(options).get({ measure: false, requestedSiteId, view: "manager-v1" });
    assert.deepEqual(manager, full); assertZeroDataIo(manager);
  }
  const full = await createMerchantCustomerGetBaselineHarness(mixed).get({ measure: false });
  for (const view of ["", "manager-v2", "full", "MANAGER-V1"]) {
    const unknown = await createMerchantCustomerGetBaselineHarness(mixed).get({ measure: false, view: view as "manager-v1" });
    assert.deepEqual(unknown, full, "only the exact manager-v1 opt-in can change the response");
  }
});

test("same-realm JSON inputs avoid the host-array counterexample that would fabricate GET repairs", async () => {
  const host = { records: [{ id: "synthetic" }] };
  const foreign = runInNewContext("JSON.parse(text)", { text: JSON.stringify(host) });
  assert.equal(JSON.stringify(host), JSON.stringify(foreign));
  assert.equal(isDeepStrictEqual(host, foreign), false, "equal JSON from different realms is not node:util deep equality");
  for (const options of [{}, mixed]) {
    const harness = createMerchantCustomerGetBaselineHarness({ ...options, instrumentation: true });
    for (let index = 0; index < 3; index++) {
      const report = await harness.get();
      assert.equal(report.status, 200);
      assert.equal(report.io.pageUpdates + report.io.pageInserts + report.io.localWrites, 0,
        "aligned local/remote inputs must remain read-only, even after repeated actual GETs");
    }
  }
});

test("one harness rejects overlapping measurements rather than mixing request attribution", async () => {
  const harness = createMerchantCustomerGetBaselineHarness(mixed);
  const first = harness.get();
  await assert.rejects(harness.get(), /concurrent_baseline_get_not_supported/);
  assert.equal((await first).status, 200);
  assert.equal((await harness.get()).status, 200);
});

test("source completion observers run before customer reduction without foreign-Promise assimilation delay", async () => {
  for (const options of [{}, mixed, { ...mixed, bookingReadRepair: true }, { ...mixed, failSource: "orders" as const }]) {
    const harness = createMerchantCustomerGetBaselineHarness({ ...options, instrumentation: true });
    for (const measure of [true, false]) {
      const report = await harness.get({ measure });
      assert.equal(report.status, 200);
      const order = report.phaseOrder;
      const reducerStart = order.indexOf("customerReducer:start"), reducerEnd = order.indexOf("customerReducer:end");
      assert.ok(reducerStart >= 0 && reducerEnd > reducerStart);
      for (const phase of ["storedRead", "ordersRead", "bookingsRead", "membershipsRead"]) {
        const start = order.indexOf(phase + ":start"), end = order.indexOf(phase + ":end");
        assert.ok(start >= 0 && end > start && end < reducerStart, phase + " must settle before reduction starts");
        assert.equal(order.filter((event) => event === phase + ":end").length, 1);
      }
      assert.ok(reducerEnd < order.indexOf("jsonSerialization:start"));
      assert.ok(order.indexOf("jsonSerialization:start") < order.indexOf("jsonSerialization:end"));
      assert.equal(order.length, 12, "six real phases each have one start/end pair");
    }
  }
});
