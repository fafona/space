import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { isDeepStrictEqual } from "node:util";
import { createContext, Script } from "node:vm";
import { fileURLToPath } from "node:url";
import { NextResponse } from "next/server";
import ts from "typescript";

// Actual GET, customer aggregation, order/membership read entrypoints, booking
// automation/list/projection, rules/workbench stores and persistence loader all
// execute from source. Only IO/session/snapshot-service inputs are synthetic;
// unused mutation/provider dependencies fail if called. No list function is
// replaced with a merge helper. This is not real HTTP/auth/DB/provider/browser
// acceptance or a production latency measurement. Host timezone is retained.
const root = fileURLToPath(new URL("../../../", import.meta.url));
const persistencePath = "lib/merchantBookingPersistenceStore.ts";
const source = readFileSync(path.join(root, persistencePath), "utf8").replaceAll("\r\n", "\n");
const oldTimestamp = `function persistedRecordTimestamp(record: { updatedAt?: unknown; createdAt?: unknown }) {
  const timestamp = Date.parse(normalizeText(record.updatedAt) || normalizeText(record.createdAt));
  return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY;
}`;
function replaceOnce(text: string, before: string, after: string) {
  assert.equal(text.split(before).length, 2, "exact memoization inverse must match once");
  return text.replace(before, after);
}
function deployedPersistenceSource() {
  const ast = ts.createSourceFile("persistence.ts", source, ts.ScriptTarget.Latest, true);
  const timestamp = ast.statements.find((node): node is ts.FunctionDeclaration =>
    ts.isFunctionDeclaration(node) && node.name?.text === "persistedRecordTimestamp");
  assert.ok(timestamp);
  let result = replaceOnce(source, timestamp.getText(ast), oldTimestamp);
  result = replaceOnce(result, "const MAX_MERGE_TIMESTAMP_CACHE_ENTRIES = 16_384;\nconst MAX_CACHED_MERGE_TIMESTAMP_LENGTH = 128;\n\n", "");
  result = replaceOnce(result, `  // A store merge compares the same dates many times during deduplication and
  // sorting. Cache only parsed strings for this call, not records or winners:
  // every comparison still reads the current fields, and later merges cannot
  // reuse stale state. Keep parsing lazy (a singleton need not have a date).
  const timestamps = new Map<string, number>();
`, "");
  for (const operand of ["record", "current", "right", "left"]) {
    result = replaceOnce(result, `persistedRecordTimestamp(${operand}, timestamps)`, `persistedRecordTimestamp(${operand})`);
  }
  assert.equal(createHash("sha256").update(result).digest("hex"),
    "b53f78db3dcdd9dfa3491bb25f6e0065e7eebde350dcd519cfaf395f8722a3e4",
    "complete deployed 0004c202 module: all loaders, writes, fallback and row sorting stay unchanged");
  return result;
}
const oldSource = deployedPersistenceSource();
const compiled = new Map<string, string>();
type Row = Record<string, unknown>;
type Fixture = { local: Row[]; remote: Row[]; sessionSite?: string; failBookingRead?: boolean };
const site = "99990001";
const now = "2032-06-01T00:00:00.000Z";
const slug = "__merchant_booking_records__:v1";
const jsonClone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
function booking(id: string, timestamp: string, overrides: Row = {}): Row {
  return { id, siteId: site, siteName: "Synthetic merchant", store: "Store", item: "Item", title: "Title",
    bookingBlockId: "booking", bookingViewport: "desktop", appointmentAt: "2032-06-20T12:00",
    customerName: id, email: id + "@example.test", phone: "", note: "Synthetic note",
    status: "cancelled", createdAt: timestamp, updatedAt: timestamp, editToken: "private-synthetic-token-" + id,
    customerEmailLogs: [{ private: true }], timeline: [{ private: true }], ...overrides };
}

function harness(fixture: Fixture, legacy = false) {
  const events: unknown[] = [];
  const forbiddenCalls: string[] = [];
  const parsed: string[] = [];
  const loaded: string[] = [];
  const local = new Map<string, unknown>([
    ["merchant-bookings.json", { version: 1, records: jsonClone(fixture.local) }],
    ["merchant-booking-rules.json", { version: 1, snapshots: {} }],
    ["merchant-booking-workbench.json", { version: 1, settingsBySiteId: {} }],
  ]);
  const rows: Row[] = [
    { id: "records", merchant_id: "__faolla_booking_persistence__", slug, blocks: { version: 1, records: jsonClone(fixture.remote) }, updated_at: now },
    { id: "rules", merchant_id: "__faolla_booking_persistence__", slug: "__merchant_booking_rules__:v1", blocks: { version: 1, snapshots: {} }, updated_at: now },
    { id: "workbench", merchant_id: "__faolla_booking_persistence__", slug: "__merchant_booking_workbench__:v1", blocks: { version: 1, settingsBySiteId: {} }, updated_at: now },
    { id: "customers", merchant_id: site, slug: "__merchant_customer_directory__:" + site, blocks: { customers: [] }, updated_at: now },
    { id: "memberships", merchant_id: site, slug: "__merchant_memberships__:" + site, blocks: { memberships: [] }, updated_at: now },
  ];
  const forbidden = (name: string) => () => {
    forbiddenCalls.push(name); throw new Error("forbidden_test_dependency:" + name);
  };
  const forbiddenModule = (name: string) => new Proxy({}, { get: (_target, key) =>
    key === "__esModule" ? true : forbidden(name + "." + String(key)) });
  class FixedDate extends Date {
    constructor(value: string | number = now) { super(value); }
    static now() { return Date.parse(now); }
  }
  class PersistenceDate extends FixedDate {
    static parse(value: string) { parsed.push(value); return Date.parse(value); }
  }
  type QueryResult = { data: Row[] | null; error: { message: string } | null };
  class Query implements PromiseLike<QueryResult> {
    filters: Array<[string, string, unknown]> = [];
    fields = "";
    bounds: [number, number] | null = null;
    action = "select";
    body: Row = {};
    select(fields: string) { this.fields = fields; return this; }
    eq(key: string, value: unknown) { this.filters.push(["eq", key, value]); return this; }
    like(key: string, value: string) { this.filters.push(["like", key, value]); return this; }
    order() { return this; }
    range(from: number, to: number) { this.bounds = [from, to]; return this; }
    update(body: Row) { this.action = "update"; this.body = jsonClone(body); return this; }
    insert(body: Row) { this.action = "insert"; this.body = jsonClone(body); return this; }
    then<TResult1 = QueryResult, TResult2 = never>(
      fulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
      rejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ): PromiseLike<TResult1 | TResult2> {
      events.push({ kind: "pages", action: this.action, fields: this.fields, filters: this.filters,
        bounds: this.bounds, ...(this.action !== "select" ? { body: this.body } : {}) });
      if (fixture.failBookingRead && this.filters.some(([, key, value]) => key === "slug" && value === slug)) {
        return Promise.resolve({ data: null, error: { message: "synthetic_booking_read_failure" } }).then(fulfilled, rejected);
      }
      let found = rows.filter((row) => this.filters.every(([kind, key, value]) =>
        kind === "eq" ? row[key] === value : String(row[key] ?? "").startsWith(String(value).replace(/%$/, ""))));
      if (this.bounds) found = found.slice(this.bounds[0], this.bounds[1] + 1);
      if (this.action === "update") for (const row of found) Object.assign(row, jsonClone(this.body));
      if (this.action === "insert") rows.push({ ...jsonClone(this.body), id: "insert-" + rows.length });
      return Promise.resolve({ data: jsonClone(found), error: null }).then(fulfilled, rejected);
    }
  }
  const client = { from: (table: string) => { assert.equal(table, "pages"); return new Query(); }, rpc: forbidden("rpc") };
  const injected: Record<string, unknown> = {
    "next/server": { NextResponse }, "node:path": path, "node:util": { isDeepStrictEqual },
    "node:crypto": { randomBytes: forbidden("entropy"), createHash },
    "lib/supabase.ts": { supabase: null },
    "lib/superAdminServer.ts": { createServerSupabaseServiceClient: () => client },
    "lib/serverMerchantSession.ts": { resolveMerchantSessionFromRequest: async () => {
      events.push({ kind: "verified-session-input" }); return { merchantId: fixture.sessionSite ?? site };
    } },
    "lib/publishedMerchantService.ts": { loadCurrentMerchantSnapshotSiteBySiteId: async (siteId: string) => {
      events.push({ kind: "snapshot-service", siteId });
      return { id: siteId, merchantName: "Synthetic merchant", permissionConfig: {}, location: { countryCode: "ES" } };
    } },
    "lib/resilientJsonFileStore.ts": {
      readJsonFileWithBackup: async (file: string, fallback: unknown, normalize: (value: unknown) => unknown) => {
        const name = path.basename(file); events.push({ kind: "local-read", name });
        assert.ok(local.has(name), name); return normalize(jsonClone(local.get(name) ?? fallback));
      },
      writeJsonFileWithBackup: async (file: string, value: unknown) => {
        const name = path.basename(file); events.push({ kind: "local-write", name, value: jsonClone(value) });
        assert.ok(local.has(name), name); local.set(name, jsonClone(value));
      },
    },
  };
  // These are unused mutation/delivery paths, not substitutes for read logic.
  for (const name of ["merchantBookingEmails", "webPush", "merchantBookingDualWrite.server", "merchantOrderDualWrite.server",
    "merchantMemberships.server", "merchantMembershipLedgerDualWrite.server", "merchantOrderMembershipTransaction.server", "merchantSnapshotHistoryStore"]) {
    injected["lib/" + name + ".ts"] = forbiddenModule(name);
  }
  const context = createContext({ Buffer, URL, Request, Response, structuredClone, Date: FixedDate,
    process: { env: {}, cwd: () => "/synthetic-booking-read" }, setTimeout, clearTimeout,
    fetch: forbidden("network"), console: { log: forbidden("log"), warn: forbidden("warn"), error: forbidden("error") } });
  const modules = new Map<string, { exports: Record<string, unknown> }>();
  function load(specifier: string, parent = "app/api/merchant-customers/route.ts"): unknown {
    let name = specifier.startsWith("@/") ? specifier.slice(2) : specifier.startsWith(".")
      ? path.posix.normalize(path.posix.join(path.posix.dirname(parent), specifier)) : specifier;
    if (name.startsWith("lib/") || name.startsWith("data/") || name.startsWith("app/")) {
      if (!name.endsWith(".ts") && !name.endsWith(".tsx")) name += ".ts";
    }
    if (Object.hasOwn(injected, name)) return injected[name];
    if (modules.has(name)) return modules.get(name)!.exports;
    assert.match(name, /^(lib|data|app)\/[A-Za-z0-9_./-]+\.tsx?$/, "unexpected dependency: " + name);
    const moduleRecord = { exports: {} }; modules.set(name, moduleRecord); loaded.push(name);
    const key = name + (name === persistencePath && legacy ? ":deployed" : "");
    if (!compiled.has(key)) compiled.set(key, ts.transpileModule(name === persistencePath
      ? legacy ? oldSource : source : readFileSync(path.join(root, name), "utf8"), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
    }).outputText);
    const execute = new Script("(function(require,module,exports,Date){" + compiled.get(key) + "\n})", { filename: name }).runInContext(context);
    execute((next: string) => load(next, name), moduleRecord, moduleRecord.exports, name === persistencePath ? PersistenceDate : FixedDate);
    return moduleRecord.exports;
  }
  const route = load("app/api/merchant-customers/route.ts") as { GET: (request: Request) => Promise<Response> };
  return { events, parsed, loaded, forbiddenCalls, local, rows,
    get: async (requestedSite = site) => {
      const response = await route.GET(new Request("https://synthetic.invalid/api/merchant-customers?siteId=" + requestedSite));
      return { status: response.status, body: await response.json() };
    } };
}

async function parity(fixture: Fixture, requestedSite = site) {
  const old = harness(fixture, true); const next = harness(fixture);
  const expected = await old.get(requestedSite); const actual = await next.get(requestedSite);
  assert.deepEqual(actual, expected);
  assert.deepEqual(next.events, old.events, "all synthetic IO calls and read-repair payloads retain their old order and content");
  assert.deepEqual([...next.local], [...old.local]); assert.deepEqual(next.rows, old.rows);
  assert.deepEqual(old.forbiddenCalls, []); assert.deepEqual(next.forbiddenCalls, []);
  for (const file of ["lib/merchantCustomers.ts", "lib/merchantCustomerDirectoryStore.ts", "lib/merchantBookings.server.ts",
    persistencePath, "lib/merchantOrders.server.ts", "lib/merchantOrdersStore.ts", "lib/merchantMembershipsStore.ts"]) {
    assert.ok(next.loaded.includes(file), "execute actual " + file);
  }
  return { old, next, actual };
}

test("actual customer GET preserves full response and IO while memoizing booking merge dates", async (context) => {
  const records = Array.from({ length: 500 }, (_, index) => booking("booking-" + index,
    new Date(Date.UTC(2032, 0, 1) + (index * 73 % 25) * 60000).toISOString()));
  const { old, next, actual } = await parity({ local: records, remote: records });
  assert.equal(actual.status, 200); assert.equal(actual.body.total, 500); assert.deepEqual(actual.body.warnings, []);
  assert.ok(actual.body.customers.every((customer: Row) => customer.siteId === site));
  assert.ok(!JSON.stringify(actual.body).includes("private-synthetic-token"));
  assert.equal(next.parsed.length, 25); assert.ok(old.parsed.length > next.parsed.length * 10);
  context.diagnostic(`synthetic actual GET, 500 local + 500 remote bookings: persistence-module Date.parse ${old.parsed.length} -> ${next.parsed.length}; not total GET CPU/latency`);
});

test("actual customer GET keeps remote ties, local-only records, tenant filtering and read-repair writes", async () => {
  const local = [booking("shared", now, { customerName: "Local loser" }), booking("local-only", "invalid"),
    booking("cross-tenant", now, { customerName: "Old tenant" })];
  const remote = [booking("shared", now, { customerName: "Remote winner" }), booking("remote-only", "2032-05-01T00:00:00Z"),
    booking("cross-tenant", now, { siteId: "99990002", customerName: "Other tenant winner" })];
  const { next, actual } = await parity({ local, remote });
  assert.equal(actual.status, 200); assert.equal(actual.body.total, 3);
  const names = actual.body.customers.map((customer: Row) => customer.displayName);
  assert.ok(names.includes("Remote winner")); assert.ok(!names.includes("Local loser"));
  assert.ok(!names.includes("Other tenant winner"));
  assert.ok(next.events.some((event) => (event as Row).kind === "local-write"));
  assert.ok(next.events.some((event) => (event as Row).action === "update"));
});

test("actual customer GET keeps booking source failure as the same warning, not empty successful booking evidence", async () => {
  const { actual } = await parity({ local: [], remote: [], failBookingRead: true });
  assert.equal(actual.status, 200); assert.equal(actual.body.total, 0);
  assert.deepEqual(actual.body.warnings, ["bookings_unavailable"]);
});

test("actual customer GET rejects invalid site and wrong verified merchant before any data IO", async () => {
  for (const [requestedSite, sessionSite, status] of [["invalid", site, 400], [site, "99990002", 401]] as const) {
    const { next, actual } = await parity({ local: [], remote: [], sessionSite }, requestedSite);
    assert.equal(actual.status, status); assert.equal(next.parsed.length, 0);
    assert.ok(next.events.every((event) => (event as Row).kind === "verified-session-input"));
  }
});
