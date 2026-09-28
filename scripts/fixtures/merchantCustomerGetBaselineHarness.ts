import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { isDeepStrictEqual } from "node:util";
import { createContext, Script } from "node:vm";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { NextResponse } from "next/server";
import ts from "typescript";

// Offline synthetic-path measurement, not production latency/auth/DB acceptance.
// Actual route, list/store entrypoints and reducer execute unchanged. Verified
// session, snapshot-service and external I/O inputs are synthetic. Cancelled
// bookings deliberately exclude reminder/status delivery. V1 modes are off.
// Timings include fixture I/O copying/accounting overhead; async source phases
// overlap and nest, so they must never be added together as exclusive CPU time.
export const MERCHANT_CUSTOMER_BASELINE_SITE = "99990001";
export const MERCHANT_CUSTOMER_BASELINE_NOW = "2032-06-01T00:00:00.000Z";
export type MerchantCustomerBaselineSource = "customers" | "orders" | "bookings" | "memberships";
export type MerchantCustomerGetBaselineOptions = {
  storedCustomers?: number;
  orders?: number;
  bookings?: number;
  memberships?: number;
  foreignBookings?: number;
  distinctCustomers?: number;
  failSource?: MerchantCustomerBaselineSource;
  sessionSiteId?: string | null;
  bookingReadRepair?: boolean;
  instrumentation?: boolean;
  noteLength?: number;
};
export type MerchantCustomerBaselinePhase = { calls: number; wallMs: number };
export type MerchantCustomerBaselineIo = {
  sessionResolutions: number; snapshotReads: number; localReads: number; localWrites: number;
  pageSelects: number; pageUpdates: number; pageInserts: number;
  readBytes: number; writeBytes: number; forbiddenCalls: number;
};
export type MerchantCustomerGetBaselineReport = {
  status: number; customerCount: number; warnings: string[];
  outcomes: { orderCount: number; bookingCount: number; customersBySource: { manual: number; membership: number; order: number; booking: number } };
  responseBytes: number; responseSha256: string; effectsSha256: string;
  inputBytes: { local: number; remote: number; total: number };
  io: MerchantCustomerBaselineIo;
  phases: Record<string, MerchantCustomerBaselinePhase>;
  phaseOrder: string[];
  getWallMs: number; measurementEnabled: boolean;
  payloadAudit?: { responseGzipBytes: number; responseCanonicalSha256: string; projectedResponseCanonicalSha256: string };
};
type Row = Record<string, unknown>;
const root = fileURLToPath(new URL("../../src/", import.meta.url));
const compiled = new Map<string, string>();
const site = MERCHANT_CUSTOMER_BASELINE_SITE, now = MERCHANT_CUSTOMER_BASELINE_NOW;
const bookingSlug = "__merchant_booking_records__:v1";
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), "utf8");
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const canonicalJson = (value: unknown) => JSON.stringify(value, (_key, entry: unknown) =>
  entry !== null && typeof entry === "object" && !Array.isArray(entry)
    ? Object.fromEntries(Object.entries(entry).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)) : entry);
const countFields = ["storedCustomers", "orders", "bookings", "memberships", "foreignBookings"] as const;
const phaseNames = ["storedRead", "ordersRead", "bookingsRead", "membershipsRead", "customerReducer", "jsonSerialization"] as const;

function scenario(options: MerchantCustomerGetBaselineOptions) {
  const counts = Object.fromEntries(countFields.map((key) => {
    const value = options[key] ?? 0;
    assert.ok(Number.isSafeInteger(value) && value >= 0 && value <= 100_000, "invalid_baseline_count:" + key);
    return [key, value];
  })) as Record<(typeof countFields)[number], number>;
  const distinct = options.distinctCustomers ?? Math.max(1, ...countFields.filter((key) => key !== "foreignBookings").map((key) => counts[key]));
  assert.ok(Number.isSafeInteger(distinct) && distinct > 0 && distinct <= 100_000, "invalid_baseline_distinct_customers");
  assert.ok(options.failSource === undefined || ["customers", "orders", "bookings", "memberships"].includes(options.failSource), "invalid_baseline_failure_source");
  assert.ok(options.sessionSiteId === undefined || options.sessionSiteId === null || /^\d{8}$/.test(options.sessionSiteId), "invalid_baseline_session_site");
  assert.ok(options.bookingReadRepair === undefined || typeof options.bookingReadRepair === "boolean", "invalid_baseline_repair_flag");
  assert.ok(options.instrumentation === undefined || typeof options.instrumentation === "boolean", "invalid_baseline_instrumentation_flag");
  assert.ok(options.noteLength === undefined || (Number.isSafeInteger(options.noteLength) && options.noteLength >= 0 && options.noteLength <= 1000), "invalid_baseline_note_length");
  const note = (kind: "order" | "booking", index: number) => {
    if (options.noteLength === undefined) return "Synthetic " + kind;
    const sentence = "Synthetic " + kind + " note " + index + ". ";
    return sentence.repeat(Math.ceil(options.noteLength / sentence.length)).slice(0, options.noteLength);
  };
  const identity = (index: number) => ({
    name: "Synthetic customer " + index % distinct,
    email: `synthetic-${index % distinct}@example.test`, accountId: "synthetic-account-" + index % distinct,
  });
  const timestamp = (index: number) => new Date(Date.UTC(2032, 0, 1) + (index * 73 % 250) * 60_000).toISOString();
  const storedCustomers = Array.from({ length: counts.storedCustomers }, (_, index) => ({
    id: "profile-" + index, siteId: site, displayName: identity(index).name, email: identity(index).email,
    accountId: identity(index).accountId, sources: ["manual"], createdAt: timestamp(index), updatedAt: timestamp(index),
  }));
  const orders = Array.from({ length: counts.orders }, (_, index) => ({
    id: "order-" + index, siteId: site, siteName: "Synthetic merchant", status: "completed", pricePrefix: "EUR",
    customerAccountId: identity(index).accountId, customer: { name: identity(index).name, email: identity(index).email, phone: "", note: note("order", index) },
    items: [{ productId: "synthetic-product", name: "Synthetic item", quantity: 1, unitPrice: 2 }],
    createdAt: timestamp(index), updatedAt: timestamp(index),
  }));
  const bookings = Array.from({ length: counts.bookings + counts.foreignBookings }, (_, index) => {
    const foreign = index >= counts.bookings;
    return { id: (foreign ? "foreign-booking-" : "booking-") + index, siteId: foreign ? "99990002" : site,
      siteName: "Synthetic merchant", store: "Store", item: "Item", title: "Title", bookingBlockId: "booking", bookingViewport: "desktop",
      appointmentAt: "2032-06-20T12:00", customerName: identity(index).name, email: identity(index).email,
      customerAccountId: identity(index).accountId, phone: "", note: note("booking", index), status: "cancelled",
      createdAt: timestamp(index), updatedAt: timestamp(index), editToken: "private-synthetic-edit-token-" + index,
      customerEmailLogs: [{ private: true }], timeline: [{ private: true }] };
  });
  // Default sources already agree with the actual merge's stable date order;
  // only the explicit repair fixture starts with a missing remote record.
  bookings.sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
  const memberships = Array.from({ length: counts.memberships }, (_, index) => ({
    id: "membership-" + index, siteId: site, siteName: "Synthetic merchant", accountId: identity(index).accountId,
    name: identity(index).name, email: identity(index).email, serial: index + 1, memberNo: "synthetic-member-" + index,
    joinedAt: timestamp(index), updatedAt: timestamp(index), status: "active", transactions: [],
  }));
  const local = new Map<string, unknown>([
    ["merchant-bookings.json", { version: 1, records: clone(bookings) }],
    ["merchant-booking-rules.json", { version: 1, snapshots: {} }],
    ["merchant-booking-workbench.json", { version: 1, settingsBySiteId: {} }],
  ]);
  const rows: Row[] = [
    { id: "records", merchant_id: "__faolla_booking_persistence__", slug: bookingSlug, blocks: { version: 1,
      records: clone(options.bookingReadRepair ? bookings.filter((record) => record.id !== "booking-0") : bookings) }, updated_at: now },
    { id: "rules", merchant_id: "__faolla_booking_persistence__", slug: "__merchant_booking_rules__:v1", blocks: { version: 1, snapshots: {} }, updated_at: now },
    { id: "workbench", merchant_id: "__faolla_booking_persistence__", slug: "__merchant_booking_workbench__:v1", blocks: { version: 1, settingsBySiteId: {} }, updated_at: now },
    { id: "customers", merchant_id: site, slug: "__merchant_customer_directory__:" + site, blocks: { customers: storedCustomers }, updated_at: now },
    { id: "memberships", merchant_id: site, slug: "__merchant_memberships__:" + site, blocks: memberships, updated_at: now },
  ];
  for (let index = 0; index < orders.length; index += 100) {
    rows.push({ id: "orders-" + index / 100, merchant_id: site, slug: `__merchant_orders__:${site}:chunk:${index / 100}`,
      blocks: orders.slice(index, index + 100), updated_at: now });
  }
  return { local, rows };
}

export function createMerchantCustomerGetBaselineHarness(options: MerchantCustomerGetBaselineOptions = {}) {
  const { local, rows } = scenario(options);
  // Local documents and the remote pages array are independently serialized;
  // bookings present in both deliberately count twice. Not wire/storage sizes.
  const localBytes = [...local.values()].reduce<number>((sum, value) => sum + bytes(value), 0);
  const remoteBytes = bytes(rows);
  const inputBytes = Object.freeze({ local: localBytes, remote: remoteBytes, total: localBytes + remoteBytes });
  const sourceHashes: Record<string, string> = {};
  let runtimeClone = clone;
  let active: { measure: boolean; io: MerchantCustomerBaselineIo; phases: Record<string, MerchantCustomerBaselinePhase>; phaseOrder: string[]; effects: ReturnType<typeof createHash> } | null = null;
  const event = (value: unknown) => {
    assert.ok(active, "fixture_io_outside_get");
    const text = JSON.stringify(value); active.effects.update(text + "\n");
  };
  const forbidden = (name: string) => () => {
    if (active) { active.io.forbiddenCalls++; event({ kind: "forbidden", name }); }
    throw Error("forbidden_baseline_dependency:" + name);
  };
  const forbiddenModule = (name: string) => new Proxy({}, { get: (_target, key) =>
    key === "__esModule" ? true : forbidden(name + "." + String(key)) });
  function timed<T>(phase: string, task: () => T): T {
    assert.ok(active, "fixture_measurement_outside_get");
    const metrics = active, entry = metrics.phases[phase]; entry.calls++;
    metrics.phaseOrder.push(phase + ":start");
    const start = metrics.measure ? performance.now() : 0;
    const finish = () => {
      if (metrics.measure) entry.wallMs += performance.now() - start;
      metrics.phaseOrder.push(phase + ":end");
    };
    try {
      const result = task();
      // Observe completion without replacing the real Promise or return value.
      // This same observer exists when timing is disabled, preserving ordering.
      if (result && typeof (result as { then?: unknown }).then === "function") {
        // Subscribe directly to the VM Promise before route allSettled does.
        // Host Promise.resolve would first enqueue foreign-Promise assimilation,
        // allowing the reducer to execute before the source-end observer.
        void (result as unknown as PromiseLike<unknown>).then(finish, finish);
      } else finish();
      return result;
    } catch (error) { finish(); throw error; }
  }
  type QueryResult = { data: Row[] | null; error: { message: string } | null };
  class Query implements PromiseLike<QueryResult> {
    filters: Array<["eq" | "like", string, unknown]> = [];
    ordering: Array<[string, boolean]> = [];
    fields = ""; bounds: [number, number] | null = null;
    action: "select" | "update" | "insert" = "select"; body: Row = {};
    select(fields: string) { this.fields = fields; return this; }
    eq(key: string, value: unknown) { this.filters.push(["eq", key, value]); return this; }
    like(key: string, value: string) { this.filters.push(["like", key, value]); return this; }
    order(key: string, input: { ascending: boolean }) { this.ordering.push([key, input.ascending]); return this; }
    range(from: number, to: number) { this.bounds = [from, to]; return this; }
    update(body: Row) { this.action = "update"; this.body = clone(body); return this; }
    insert(body: Row) { this.action = "insert"; this.body = clone(body); return this; }
    then<TResult1 = QueryResult, TResult2 = never>(
      fulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
      rejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ): PromiseLike<TResult1 | TResult2> {
      assert.ok(active);
      active.io[this.action === "select" ? "pageSelects" : this.action === "update" ? "pageUpdates" : "pageInserts"]++;
      const failureSlug = { customers: "__merchant_customer_directory__:", orders: "__merchant_orders__:", bookings: bookingSlug, memberships: "__merchant_memberships__:" };
      const failed = options.failSource && this.filters.some(([, key, value]) => key === "slug" && String(value).startsWith(failureSlug[options.failSource!]));
      let result: QueryResult;
      if (failed) result = { data: null, error: { message: "synthetic_source_unavailable" } };
      else {
        let found = rows.filter((row) => this.filters.every(([kind, key, value]) => kind === "eq"
          ? row[key] === value : String(row[key] ?? "").startsWith(String(value).replace(/%$/, ""))));
        if (this.ordering.length) found.sort((left, right) => {
          for (const [key, ascending] of this.ordering) {
            const a = String(left[key] ?? ""), b = String(right[key] ?? "");
            if (a !== b) return (a < b ? -1 : 1) * (ascending ? 1 : -1);
          }
          return 0;
        });
        if (this.bounds) found = found.slice(this.bounds[0], this.bounds[1] + 1);
        if (this.action === "update") for (const row of found) Object.assign(row, clone(this.body));
        if (this.action === "insert") { const row = { ...clone(this.body), id: "insert-" + rows.length }; rows.push(row); found = [row]; }
        result = { data: this.fields ? runtimeClone(found.map((row) => Object.fromEntries(this.fields.split(",").map((key) => [key, row[key]])))) : null, error: null };
      }
      if (this.action === "select") active.io.readBytes += bytes(result.data);
      else active.io.writeBytes += bytes(this.body);
      event({ kind: "pages", action: this.action, fields: this.fields, filters: this.filters, ordering: this.ordering, bounds: this.bounds,
        ...(this.action !== "select" ? { body: this.body } : {}), result });
      return Promise.resolve(result).then(fulfilled, rejected);
    }
  }
  const client = { from: (table: string) => { assert.equal(table, "pages"); return new Query(); }, rpc: forbidden("rpc") };
  const injected: Record<string, unknown> = {
    "next/server": { NextResponse: options.instrumentation === true
      ? { json: (...args: Parameters<typeof NextResponse.json>) => timed("jsonSerialization", () => NextResponse.json(...args)) } : NextResponse },
    "node:path": path, "node:util": { isDeepStrictEqual }, "node:crypto": { randomBytes: forbidden("entropy"), createHash },
    "lib/supabase.ts": { supabase: null }, "lib/superAdminServer.ts": { createServerSupabaseServiceClient: () => client },
    "lib/serverMerchantSession.ts": { resolveMerchantSessionFromRequest: async () => {
      assert.ok(active); active.io.sessionResolutions++; event({ kind: "verified-session-input" });
      return options.sessionSiteId === null ? null : { merchantId: options.sessionSiteId ?? site };
    } },
    "lib/publishedMerchantService.ts": { loadCurrentMerchantSnapshotSiteBySiteId: async (siteId: string) => {
      assert.ok(active); active.io.snapshotReads++;
      const value = { id: siteId, merchantName: "Synthetic merchant", permissionConfig: {}, location: { countryCode: "ES" } };
      active.io.readBytes += bytes(value); event({ kind: "snapshot-service", siteId, value }); return value;
    } },
    "lib/resilientJsonFileStore.ts": {
      readJsonFileWithBackup: async (file: string, _fallback: unknown, normalize: (value: unknown) => unknown) => {
        assert.ok(active); const name = path.basename(file); assert.ok(local.has(name), name);
        const value = runtimeClone(local.get(name)); active.io.localReads++; active.io.readBytes += bytes(value);
        event({ kind: "local-read", name, value }); return normalize(value);
      },
      writeJsonFileWithBackup: async (file: string, value: unknown) => {
        assert.ok(active); const name = path.basename(file); assert.ok(local.has(name), name);
        active.io.localWrites++; active.io.writeBytes += bytes(value); event({ kind: "local-write", name, value }); local.set(name, clone(value));
      },
    },
  };
  for (const name of ["merchantBookingEmails", "webPush", "merchantBookingDualWrite.server", "merchantOrderDualWrite.server",
    "merchantMemberships.server", "merchantMembershipLedgerDualWrite.server", "merchantOrderMembershipTransaction.server", "merchantSnapshotHistoryStore"]) {
    injected["lib/" + name + ".ts"] = forbiddenModule(name);
  }
  const fixedDate = new Proxy(Date, {
    construct: (target, args, newTarget) => Reflect.construct(target, args.length ? args : [now], newTarget),
    apply: () => new Date(now).toString(),
    get: (target, key, receiver) => key === "now" ? () => Date.parse(now) : Reflect.get(target, key, receiver),
  });
  const context = createContext({ Buffer, URL, Request, Response, structuredClone, Date: fixedDate,
    process: { env: {}, cwd: () => "/synthetic-customer-baseline" }, setTimeout, clearTimeout,
    fetch: forbidden("network"), console: { log: forbidden("log"), warn: forbidden("warn"), error: forbidden("error") } });
  // Real JSON I/O parses into the executing module's realm. Returning host
  // arrays would make node:util deep equality invent repeated repair writes
  // solely because host and VM Array prototypes differ.
  const parseRuntimeJson = new Script("(text) => JSON.parse(text)").runInContext(context) as (text: string) => unknown;
  runtimeClone = <T,>(value: T): T => parseRuntimeJson(JSON.stringify(value)) as T;
  const modules = new Map<string, { exports: Record<string, unknown> }>();
  const instrument: Record<string, [string, string]> = {
    "lib/merchantCustomerDirectoryStore.ts": ["loadStoredMerchantCustomerDirectory", "storedRead"],
    "lib/merchantOrders.server.ts": ["listMerchantOrders", "ordersRead"],
    "lib/merchantBookings.server.ts": ["listMerchantBookings", "bookingsRead"],
    "lib/merchantMembershipsStore.ts": ["loadStoredMerchantMemberships", "membershipsRead"],
    "lib/merchantCustomers.ts": ["buildMerchantCustomerDirectory", "customerReducer"],
  };
  function load(specifier: string, parent = "app/api/merchant-customers/route.ts"): unknown {
    let name = specifier.startsWith("@/") ? specifier.slice(2) : specifier.startsWith(".")
      ? path.posix.normalize(path.posix.join(path.posix.dirname(parent), specifier)) : specifier;
    if (/^(lib|data|app)\//.test(name) && !/\.tsx?$/.test(name)) name += ".ts";
    if (Object.hasOwn(injected, name)) return injected[name];
    if (modules.has(name)) return modules.get(name)!.exports;
    assert.match(name, /^(lib|data|app)\/[A-Za-z0-9_./-]+\.tsx?$/, "unexpected_dependency:" + name);
    assert.equal(path.posix.normalize(name), name, "noncanonical_source_dependency");
    const moduleRecord = { exports: {} as Record<string, unknown> }; modules.set(name, moduleRecord);
    const source = readFileSync(path.join(root, name), "utf8"), digest = sha(source), key = name + ":" + digest;
    sourceHashes["src/" + name] = digest;
    if (!compiled.has(key)) compiled.set(key, ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
    }).outputText);
    const execute = new Script("(function(require,module,exports){" + compiled.get(key) + "\n})", { filename: name }).runInContext(context);
    execute((next: string) => load(next, name), moduleRecord, moduleRecord.exports);
    if (options.instrumentation === true && instrument[name]) {
      const [exportName, phase] = instrument[name], original = moduleRecord.exports[exportName];
      assert.equal(typeof original, "function");
      moduleRecord.exports[exportName] = function (this: unknown, ...args: unknown[]) {
        return timed(phase, () => Reflect.apply(original as (...args: unknown[]) => unknown, this, args));
      };
    }
    return moduleRecord.exports;
  }
  // Compile and eagerly execute source modules before the first GET timer.
  const route = load("app/api/merchant-customers/route.ts") as { GET: (request: Request) => Promise<Response> };
  return {
    get sourceHashes() { return Object.freeze({ ...sourceHashes }); },
    async get(input: { measure?: boolean; requestedSiteId?: string; view?: "manager-v1"; payloadAudit?: boolean } = {}): Promise<MerchantCustomerGetBaselineReport> {
      assert.equal(active, null, "concurrent_baseline_get_not_supported");
      const measurementEnabled = input.measure !== false;
      const phases = Object.fromEntries(phaseNames.map((name) => [name, { calls: 0, wallMs: 0 }]));
      const io: MerchantCustomerBaselineIo = { sessionResolutions: 0, snapshotReads: 0, localReads: 0, localWrites: 0,
        pageSelects: 0, pageUpdates: 0, pageInserts: 0, readBytes: 0, writeBytes: 0, forbiddenCalls: 0 };
      const phaseOrder: string[] = [];
      active = { measure: measurementEnabled, io, phases, phaseOrder, effects: createHash("sha256") };
      const request = new Request("https://synthetic.invalid/api/merchant-customers?siteId=" + encodeURIComponent(input.requestedSiteId ?? site)
        + (input.view === undefined ? "" : "&view=" + encodeURIComponent(input.view)));
      const start = measurementEnabled ? performance.now() : 0;
      try {
        const response = await route.GET(request);
        const getWallMs = measurementEnabled ? performance.now() - start : 0;
        const text = await response.text(), body = JSON.parse(text) as { total?: number; warnings?: string[];
          customers?: Array<{ sources: string[]; activity: { [key: string]: unknown; orderCount: number; bookingCount: number } }> };
        assert.equal(io.forbiddenCalls, 0, "baseline_called_forbidden_dependency");
        // Independent aggregate completeness checks from the actual response,
        // after GET timing; never expose customer identity or activity details.
        const outcomes = { orderCount: 0, bookingCount: 0, customersBySource: { manual: 0, membership: 0, order: 0, booking: 0 } };
        for (const customer of body.customers ?? []) {
          outcomes.orderCount += customer.activity.orderCount;
          outcomes.bookingCount += customer.activity.bookingCount;
          for (const source of Object.keys(outcomes.customersBySource) as Array<keyof typeof outcomes.customersBySource>) {
            if (customer.sources.includes(source)) outcomes.customersBySource[source]++;
          }
        }
        // Full effects and final memory state are hashed privately, never returned.
        event({ kind: "final-memory", local: [...local], rows });
        const effectsSha256 = active.effects.digest("hex");
        // Optional analysis runs after GET timing and exposes no raw customer
        // data. The independent oracle deletes only the five unused activity
        // fields, retaining every profile field and the whole response envelope.
        let payloadAudit: MerchantCustomerGetBaselineReport["payloadAudit"];
        if (input.payloadAudit) {
          const projected = clone(body);
          for (const customer of projected.customers ?? []) {
            for (const field of ["firstActivityAt", "lastOrderAt", "lastBookingAt", "lastOrderNote", "lastBookingNote"]) delete customer.activity[field];
          }
          payloadAudit = { responseGzipBytes: gzipSync(text).byteLength,
            responseCanonicalSha256: sha(canonicalJson(body)), projectedResponseCanonicalSha256: sha(canonicalJson(projected)) };
        }
        return { status: response.status, customerCount: body.total ?? 0, warnings: body.warnings ?? [], outcomes, responseBytes: Buffer.byteLength(text, "utf8"),
          responseSha256: sha(text), effectsSha256, inputBytes: { ...inputBytes }, io, phases, phaseOrder, getWallMs, measurementEnabled,
          ...(payloadAudit ? { payloadAudit } : {}) };
      } finally { active = null; }
    },
  };
}
