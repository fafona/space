// Offline pure-reducer comparison. Run the same file in each worktree:
// node scripts/benchmark-merchant-customer-reducer.mjs [--quick]
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createContext, Script } from 'node:vm';

const require = createRequire(import.meta.url);
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const SOURCE_PATH = 'src/lib/merchantCustomers.ts';
const FIXED_NOW = '2032-06-01T12:00:00.000Z';
const SITE = '99990001';
const sha = value => createHash('sha256').update(value).digest('hex');
const digest = value => sha(JSON.stringify(value));
const scriptSha = () => sha(readFileSync(SCRIPT_PATH));
const roundMs = value => Number(value.toFixed(3));

export const CUSTOMER_REDUCER_SCENARIOS = Object.freeze([
  { name: '100-shared-identities', identities: 100, storedCustomers: 100, orders: 100, bookings: 100, memberships: 100, storedAliases: 0 },
  { name: '1000-shared-identities', identities: 1000, storedCustomers: 1000, orders: 1000, bookings: 1000, memberships: 1000, storedAliases: 0 },
  { name: '10000-shared-identities', identities: 10000, storedCustomers: 10000, orders: 10000, bookings: 10000, memberships: 10000, storedAliases: 0 },
  { name: 'one-customer-20000-activities', identities: 1, storedCustomers: 1, orders: 10000, bookings: 10000, memberships: 1, storedAliases: 0 },
  { name: '1000-identities-24-aliases', identities: 1000, storedCustomers: 1000, orders: 1000, bookings: 1000, memberships: 1000, storedAliases: 24 },
].map(Object.freeze));

function getScenario(name) {
  const scenario = CUSTOMER_REDUCER_SCENARIOS.find(item => item.name === name);
  assert.ok(scenario, 'customer_reducer_scenario_invalid');
  return scenario;
}

export function parseReducerArguments(args) {
  if (Array.isArray(args)) {
    if (args.length === 0) return { worker: false, quick: false };
    if (args.length === 1 && args[0] === '--quick') return { worker: false, quick: true };
    if (args[0] === '--worker' && (args.length === 2 || (args.length === 3 && args[2] === '--quick'))) {
      getScenario(args[1]);
      return { worker: true, quick: args.length === 3, scenario: args[1] };
    }
  }
  throw new Error('customer_reducer_arguments_invalid');
}

export function summarizeReducerSamples(values) {
  assert.ok(Array.isArray(values) && values.length && values.every(Number.isFinite), 'customer_reducer_samples_invalid');
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return {
    count: ordered.length, min: ordered[0],
    median: ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2,
    max: ordered.at(-1),
  };
}

export function createSyntheticReducerInput(name) {
  const s = getScenario(name);
  const identity = index => ({
    name: `Synthetic customer ${index % s.identities}`,
    email: `synthetic-${index % s.identities}@example.test`,
    accountId: `synthetic-account-${index % s.identities}`,
  });
  const timestamp = index => new Date(Date.UTC(2032, 0, 1) + (index * 73 % 250) * 60000).toISOString();
  return {
    siteId: SITE,
    storedCustomers: Array.from({ length: s.storedCustomers }, (_, index) => ({
      id: `profile-${index}`, siteId: SITE, displayName: identity(index).name,
      email: identity(index).email, accountId: identity(index).accountId, sources: ['manual'],
      createdAt: timestamp(index), updatedAt: timestamp(index),
      identityAliases: Array.from({ length: s.storedAliases }, (_, alias) => `legacy:${index}:${alias}`),
      tags: ['synthetic'], customFields: { reference: `profile-${index}` },
    })),
    orders: Array.from({ length: s.orders }, (_, index) => ({
      id: `order-${index}`, siteId: SITE, siteName: 'Synthetic merchant', status: 'completed',
      customerAccountId: identity(index).accountId,
      customer: { name: identity(index).name, email: identity(index).email, phone: '', note: 'Synthetic order' },
      totalAmount: 2, totalQuantity: 1, pricePrefix: 'EUR', items: [],
      createdAt: timestamp(index), updatedAt: timestamp(index),
    })),
    bookings: Array.from({ length: s.bookings }, (_, index) => ({
      id: `booking-${index}`, siteId: SITE, siteName: 'Synthetic merchant', status: 'cancelled',
      store: 'Store', item: 'Item', title: 'Title', appointmentAt: '2032-06-20T12:00:00Z',
      customerAccountId: identity(index).accountId, customerName: identity(index).name,
      email: identity(index).email, phone: '', note: 'Synthetic booking',
      createdAt: timestamp(index), updatedAt: timestamp(index),
    })),
    memberships: Array.from({ length: s.memberships }, (_, index) => ({
      id: `membership-${index}`, siteId: SITE, siteName: 'Synthetic merchant', status: 'active',
      accountId: identity(index).accountId, name: identity(index).name, email: identity(index).email,
      serial: index + 1, memberNo: `synthetic-member-${index}`, allergens: [], transactions: [],
      pointBalance: 0, balanceAmount: 0, growthValue: 0, joinedAt: timestamp(index), updatedAt: timestamp(index),
    })),
  };
}

// Compile only this reviewed pure module. Type-only imports disappear; no
// configured application module, source loader, .env, database or HTTP is loaded.
export function compileCustomerReducer(source) {
  assert.ok(typeof source === 'string' && source.length > 0 && source.length <= 131072, 'customer_reducer_source_invalid');
  const ts = require('typescript');
  const parsed = ts.createSourceFile(SOURCE_PATH, source, ts.ScriptTarget.ES2022, true);
  const allowedTypes = new Set(['@/lib/merchantBookings', '@/lib/merchantMemberships', '@/lib/merchantOrders']);
  function inspect(node) {
    if (ts.isImportDeclaration(node)) {
      assert.ok(node.importClause?.isTypeOnly && allowedTypes.has(node.moduleSpecifier.text), 'customer_reducer_runtime_import_forbidden');
    }
    assert.ok(!ts.isImportEqualsDeclaration(node), 'customer_reducer_runtime_import_forbidden');
    assert.ok(!(ts.isExportDeclaration(node) && node.moduleSpecifier), 'customer_reducer_reexport_forbidden');
    if (ts.isCallExpression(node)) {
      assert.ok(node.expression.kind !== ts.SyntaxKind.ImportKeyword, 'customer_reducer_dynamic_import_forbidden');
      assert.ok(!(ts.isIdentifier(node.expression) && node.expression.text === 'require'), 'customer_reducer_require_forbidden');
    }
    ts.forEachChild(node, inspect);
  }
  inspect(parsed);
  const compiled = ts.transpileModule(source, {
    fileName: SOURCE_PATH, reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  });
  assert.ok(!(compiled.diagnostics ?? []).some(item => item.category === ts.DiagnosticCategory.Error), 'customer_reducer_compile_failed');
  const fixedDate = new Proxy(Date, {
    construct: (target, args, newTarget) => Reflect.construct(target, args.length ? args : [FIXED_NOW], newTarget),
    apply: () => new Date(FIXED_NOW).toString(),
    get: (target, key, receiver) => key === 'now' ? () => Date.parse(FIXED_NOW) : Reflect.get(target, key, receiver),
  });
  const exports = {};
  const context = createContext({ exports, Date: fixedDate }, { codeGeneration: { strings: false, wasm: false } });
  new Script(compiled.outputText, { filename: SOURCE_PATH }).runInContext(context, { timeout: 1000 });
  assert.equal(typeof exports.buildMerchantCustomerDirectory, 'function', 'customer_reducer_export_missing');
  return {
    build: exports.buildMerchantCustomerDirectory,
    sourceSha256: sha(source), compilerVersion: ts.version,
    parseInput(input) {
      context.inputJson = JSON.stringify(input);
      try { return new Script('JSON.parse(inputJson)').runInContext(context, { timeout: 1000 }); }
      finally { delete context.inputJson; }
    },
  };
}

function processPeakRssBytes() {
  if (typeof process.resourceUsage !== 'function') return null;
  // Node resourceUsage().maxRSS is in KiB, unlike memoryUsage().rss (bytes).
  const value = process.resourceUsage().maxRSS;
  return Number.isSafeInteger(value) && value > 0 ? value * 1024 : null;
}

export function measureReducerSample(build, input, inputSha256, observations = {}) {
  const gc = observations.gc ?? globalThis.gc;
  const memory = observations.memory ?? (() => process.memoryUsage());
  const now = observations.now ?? (() => performance.now());
  const peakRss = observations.peakRss ?? processPeakRssBytes;
  assert.equal(typeof gc, 'function', 'customer_reducer_requires_expose_gc');
  gc(); gc();
  const before = memory();
  const started = now();
  const result = build(input);
  const reducerWallMs = now() - started;
  const afterCall = memory();
  assert.ok(Array.isArray(result), 'customer_reducer_result_invalid');
  gc(); gc();
  // result and input are still used below, so GC cannot discard either here.
  const retained = memory();
  const maxRss = peakRss();
  const serialized = JSON.stringify(result);
  assert.equal(digest(input), inputSha256, 'customer_reducer_mutated_input');
  const outcomes = {
    customers: result.length,
    orders: result.reduce((sum, item) => sum + item.activity.orderCount, 0),
    bookings: result.reduce((sum, item) => sum + item.activity.bookingCount, 0),
    customersBySource: Object.fromEntries(['manual', 'order', 'booking', 'membership']
      .map(source => [source, result.filter(item => item.sources.includes(source)).length])),
    aliasCount: result.reduce((sum, item) => sum + item.identityAliases.length, 0),
  };
  return {
    reducerWallMs: roundMs(reducerWallMs), inputSha256, inputUnchanged: true,
    resultSha256: sha(serialized), resultBytes: Buffer.byteLength(serialized), outcomes,
    memory: {
      beforeHeapUsedBytes: before.heapUsed, afterCallHeapUsedBytes: afterCall.heapUsed,
      afterCallHeapDeltaBytes: afterCall.heapUsed - before.heapUsed,
      postGcHeapUsedBytes: retained.heapUsed, postGcRetainedHeapDeltaBytes: retained.heapUsed - before.heapUsed,
      beforeRssBytes: before.rss, afterCallRssBytes: afterCall.rss, postGcRssBytes: retained.rss,
      processPeakRssBytesAtMeasurement: maxRss,
    },
  };
}

function assertSample(sample, scenario) {
  assert.ok(sample && Number.isFinite(sample.reducerWallMs) && sample.reducerWallMs >= 0);
  for (const key of ['inputSha256', 'resultSha256']) assert.match(sample[key], /^[a-f0-9]{64}$/);
  assert.equal(sample.inputUnchanged, true);
  assert.ok(Number.isSafeInteger(sample.resultBytes) && sample.resultBytes > 0);
  assert.equal(sample.outcomes.customers, scenario.identities, 'customer_reducer_identity_loss');
  assert.equal(sample.outcomes.orders, scenario.orders, 'customer_reducer_order_loss');
  assert.equal(sample.outcomes.bookings, scenario.bookings, 'customer_reducer_booking_loss');
  for (const [source, field] of [['manual', 'storedCustomers'], ['order', 'orders'], ['booking', 'bookings'], ['membership', 'memberships']]) {
    assert.equal(sample.outcomes.customersBySource[source], Math.min(scenario.identities, scenario[field]), 'customer_reducer_source_loss');
  }
  if (scenario.storedAliases === 24) assert.equal(sample.outcomes.aliasCount, scenario.identities * 24);
  for (const [key, value] of Object.entries(sample.memory)) {
    if (key === 'processPeakRssBytesAtMeasurement' && value === null) continue;
    assert.ok(Number.isSafeInteger(value), 'customer_reducer_memory_invalid');
    if (!key.includes('Delta')) assert.ok(value >= 0, 'customer_reducer_memory_invalid');
  }
}

export function runReducerWorker(name, { quick = false } = {}) {
  const scenario = getScenario(name);
  const reducer = compileCustomerReducer(readFileSync(path.join(ROOT, SOURCE_PATH), 'utf8'));
  const input = reducer.parseInput(createSyntheticReducerInput(name));
  const inputSha256 = digest(input);
  const sample = () => {
    const result = measureReducerSample(reducer.build, input, inputSha256);
    assertSample(result, scenario);
    return result;
  };
  const first = sample();
  const repeated = Array.from({ length: quick ? 2 : 5 }, sample);
  for (const result of repeated) {
    for (const key of ['inputSha256', 'resultSha256', 'resultBytes', 'outcomes']) {
      assert.deepEqual(result[key], first[key], 'customer_reducer_repeat_changed_' + key);
    }
  }
  return {
    schema: 'faolla-customer-reducer-worker-v1', scenario, quick, pid: process.pid,
    node: process.version, platform: process.platform, arch: process.arch, v8: process.versions.v8,
    sourceSha256: reducer.sourceSha256, benchmarkScriptSha256: scriptSha(), compilerVersion: reducer.compilerVersion,
    first, repeated,
    summary: {
      repeatedReducerWallMs: summarizeReducerSamples(repeated.map(item => item.reducerWallMs)),
      repeatedAfterCallHeapDeltaBytes: summarizeReducerSamples(repeated.map(item => item.memory.afterCallHeapDeltaBytes)),
      repeatedPostGcRetainedHeapDeltaBytes: summarizeReducerSamples(repeated.map(item => item.memory.postGcRetainedHeapDeltaBytes)),
    },
    processPeakRssBytesBeforeReportSerialization: processPeakRssBytes(),
  };
}

function startWorker(name, quick) {
  const args = ['--expose-gc', SCRIPT_PATH, '--worker', name, ...(quick ? ['--quick'] : [])];
  const child = spawnSync(process.execPath, args, {
    cwd: ROOT, env: {}, encoding: 'utf8', timeout: 120000, maxBuffer: 2 * 1024 * 1024,
    windowsHide: true,
  });
  assert.ok(!child.error && child.status === 0 && child.signal === null && child.stderr === '', 'customer_reducer_worker_failed');
  return JSON.parse(child.stdout);
}

export function runCustomerReducerBenchmark({ quick = false } = {}, launchWorker = startWorker) {
  const scenarios = quick ? CUSTOMER_REDUCER_SCENARIOS.slice(0, 1) : CUSTOMER_REDUCER_SCENARIOS;
  const sourceSha256 = sha(readFileSync(path.join(ROOT, SOURCE_PATH), 'utf8'));
  const benchmarkScriptSha256 = scriptSha();
  const results = scenarios.map(scenario => {
    // Sequential fresh process per scenario; never run workloads concurrently.
    const result = launchWorker(scenario.name, quick);
    assert.equal(result.schema, 'faolla-customer-reducer-worker-v1');
    assert.deepEqual(result.scenario, scenario);
    assert.equal(result.quick, quick);
    assert.equal(result.sourceSha256, sourceSha256, 'customer_reducer_source_changed');
    assert.equal(result.benchmarkScriptSha256, benchmarkScriptSha256, 'customer_reducer_script_changed');
    assert.equal(result.repeated.length, quick ? 2 : 5);
    assertSample(result.first, scenario);
    for (const item of result.repeated) {
      assertSample(item, scenario);
      for (const key of ['inputSha256', 'resultSha256', 'resultBytes', 'outcomes']) {
        assert.deepEqual(item[key], result.first[key], 'customer_reducer_repeat_changed_' + key);
      }
    }
    return result;
  });
  return {
    schema: 'faolla-customer-reducer-benchmark-v1', mode: 'synthetic-offline-pure-reducer', quick,
    source: SOURCE_PATH, sourceSha256, benchmarkScriptSha256, fixedNow: FIXED_NOW, results,
    boundaries: {
      productionTraffic: false, network: false, database: false, realAuthentication: false,
      sourceLoaders: false, route: false, browser: false, readsEnvironment: false,
      isolatedCases: 'Each fixed scenario runs sequentially in its own fresh Node process with --expose-gc and an empty child environment. No input file, URL, merchant, credential, sample-count or source-path argument is accepted.',
      timing: 'Synchronous reducer wall time only. Compilation, fixture generation, explicit GC, JSON serialization, hashing and validation are excluded. Implicit GC can occur within the reducer. First call and five repeated calls (two in quick mode) are separate, not production latency or throughput.',
      heap: 'Baseline heap is post-GC with compiled code and input alive. After-call delta includes transient allocations and may already reflect automatic GC; it is not peak JS heap. Post-GC delta retains input and result but also reflects VM/JIT/runtime changes; it is not exact customer-object memory. Signed deltas are not clamped.',
      rss: 'Node resourceUsage maxRSS (KiB converted to bytes), when available, is a process-lifetime high-water mark: it includes compiler, fixtures, hashing, earlier samples and runtime, not solely reducer allocations. Final high-water reading precedes report serialization. RSS is not peak JS heap.',
      comparison: 'Run the byte-identical script in baseline and candidate worktrees. Verify script, runtime/compiler versions, scenario and complete input/result fingerprints before comparing descriptive timing/memory values. This report does not automatically run or certify another revision.',
      safety: 'Only the reviewed same-worktree pure reducer is compiled. Its three type-import destinations are allowlisted, runtime imports/requires are rejected, and the VM receives no configured IO globals. This is not a security sandbox for hostile repository source.',
    },
  };
}

export function main(args = process.argv.slice(2)) {
  const options = parseReducerArguments(args);
  const report = options.worker ? runReducerWorker(options.scenario, options) : runCustomerReducerBenchmark(options);
  process.stdout.write(JSON.stringify(report) + '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { main(); }
  catch {
    process.stderr.write('customer_reducer_benchmark_failed\n');
    process.exitCode = 1;
  }
}
