import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createContext, Script } from "node:vm";
import { NextResponse } from "next/server";
import ts from "typescript";

// Actual route, reducer, numeric-ID/origin guards and list projection execute
// from source. Verified session inputs and the four source entrypoints are
// synthetic. This is not real auth/DB/provider acceptance or a source-IO saving.
// Loading this fixture never initializes the application's configured clients.
const root = fileURLToPath(new URL("../../../", import.meta.url));
const routePath = "app/api/merchant-customers/route.ts";
const routeSource = readFileSync(path.join(root, routePath), "utf8").replaceAll("\r\n", "\n");
const siteId = "99990001";
const now = "2032-06-01T12:00:00.000Z";
const compiled = new Map<string, string>();
const jsonClone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function replaceOnce(source: string, before: string, after: string) {
  assert.equal(source.split(before).length, 2, "list view inverse must match exactly once");
  return source.replace(before, after);
}

function legacyRouteSource() {
  let source = replaceOnce(routeSource,
    'import { loadStoredMerchantMembershipProfiles } from "@/lib/merchantMembershipsStore";',
    'import { loadStoredMerchantMemberships } from "@/lib/merchantMembershipsStore";');
  source = replaceOnce(source, "      loadStoredMerchantMembershipProfiles(store, siteId),",
    "      loadStoredMerchantMemberships(store, siteId),");
  source = replaceOnce(source,
    'import { toMerchantCustomerListItem } from "@/lib/merchantCustomerListView";\n', "");
  source = replaceOnce(source, `      customers: url.searchParams.get("view") === "manager-v1"
        ? result.customers.map(toMerchantCustomerListItem)
        : result.customers,`, "      customers: result.customers,");
  assert.equal(createHash("sha256").update(source).digest("hex"),
    "243445b04f15cfa609ecfbfca2f5ba341f6129fd742ce54416ba540c0fa4c79d",
    "full b0818967 route: auth, source loading, warnings and POST/PATCH must remain unchanged");
  return source;
}

type SourceName = "stored" | "orders" | "bookings" | "memberships";
type Options = {
  sessionSiteId?: string | null;
  sessionError?: boolean;
  storeUnavailable?: boolean;
  failures?: SourceName[];
  empty?: boolean;
  storedMissing?: boolean;
  version?: string | null;
};

function harness(options: Options = {}, legacy = false) {
  const events: unknown[] = [];
  const forbiddenCalls: string[] = [];
  const forbidden = (name: string) => () => {
    forbiddenCalls.push(name);
    throw new Error("forbidden_test_dependency:" + name);
  };
  const profile = {
    id: "stored-1", siteId, accountId: "synthetic-account", authUserId: "synthetic-user", guestHash: "synthetic-guest",
    displayName: "Synthetic stored customer", email: "synthetic@example.test", phone: "123456",
    birthday: "2000-01-02", gender: "other", referenceCode: "REF-1", memberNo: "MEM-1",
    notes: "Profile search and edit note", tags: ["tag"], allergens: ["allergen"],
    identityAliases: ["email:former@example.test"], customFields: { extra: "must remain" },
    address: { country: "ES", city: "Madrid", postalCode: "28001", line1: "Synthetic address" },
    tax: { name: "Synthetic tax name", number: "TAX-1", address: "Synthetic tax address" },
    sources: ["manual"], createdAt: now, updatedAt: now,
  };
  const data: Record<SourceName, unknown> = {
    stored: options.storedMissing ? null : { customers: options.empty ? [] : [profile], updatedAt: options.version === undefined ? now : options.version },
    orders: options.empty ? [] : [{ id: "order-1", siteId, customerAccountId: "synthetic-account",
      customerUserId: "synthetic-user", customerGuestHash: "synthetic-guest", customerLoginEmail: "login@example.test",
      customer: { name: "Synthetic order customer", email: "synthetic@example.test", phone: "123456", note: "Order activity note" },
      createdAt: now, updatedAt: now, pricePrefix: "EUR", totalAmount: 12.34 }],
    bookings: options.empty ? [] : [{ id: "booking-1", siteId, customerAccountId: "synthetic-account",
      customerUserId: "synthetic-user", customerGuestHash: "synthetic-guest", customerLoginEmail: "login@example.test",
      customerName: "Synthetic booking customer", email: "synthetic@example.test", phone: "123456", note: "Booking activity note",
      store: "Synthetic store", item: "Synthetic item", title: "Synthetic title", createdAt: now, updatedAt: now }],
    memberships: { memberships: options.empty ? [] : [{ id: "member-1", siteId, accountId: "synthetic-account",
      userId: "synthetic-user", memberNo: "MEM-1", name: "Synthetic member", nickname: "", phone: "123456",
      email: "synthetic@example.test", birthday: "2000-01-02", gender: "other", country: "ES", province: "", city: "Madrid",
      address: "Synthetic address", taxName: "", taxNumber: "", taxCountry: "", taxProvince: "", taxCity: "", taxAddress: "",
      allergens: [], status: "active", pointBalance: 10, balanceAmount: 12.34, growthValue: 20, joinedAt: now, updatedAt: now }] },
  };
  const client = { from: forbidden("store.from"), rpc: forbidden("store.rpc") };
  const read = async (source: SourceName, requestedSite: string, options?: unknown) => {
    events.push({ source, siteId: requestedSite, ...(options ? { options } : {}) });
    assert.equal(requestedSite, siteId);
    if ((failures ?? []).includes(source)) throw new Error("synthetic_" + source + "_failure");
    return jsonClone(data[source]);
  };
  const failures = options.failures;
  const readMemberships = (received: unknown, requestedSite: string) => {
    assert.equal(received, client);
    return read("memberships", requestedSite);
  };
  const injected: Record<string, unknown> = {
    "next/server": { NextResponse },
    "lib/supabase.ts": { supabase: null },
    "lib/serverMerchantSession.ts": { resolveMerchantSessionFromRequest: async (_request: Request, hints: unknown) => {
      events.push({ source: "session", hints });
      if (options.sessionError) throw new Error("synthetic_session_failure");
      return options.sessionSiteId === null ? null : { merchantId: options.sessionSiteId ?? siteId };
    } },
    "lib/superAdminServer.ts": { createServerSupabaseServiceClient: () => {
      events.push({ source: "store-client" });
      return options.storeUnavailable ? null : client;
    } },
    "lib/merchantCustomerDirectoryStore.ts": {
      MAX_STORED_MERCHANT_CUSTOMERS: 10_000,
      loadStoredMerchantCustomerDirectory: (received: unknown, requestedSite: string) => {
        assert.equal(received, client);
        return read("stored", requestedSite);
      },
      saveStoredMerchantCustomerDirectory: forbidden("save-customers"),
    },
    "lib/merchantOrders.server.ts": { listMerchantOrders: (requestedSite: string) => read("orders", requestedSite) },
    "lib/merchantBookings.server.ts": { listMerchantBookings: (requestedSite: string, options: unknown) => read("bookings", requestedSite, options) },
    "lib/merchantMembershipsStore.ts": {
      loadStoredMerchantMemberships: readMemberships,
      loadStoredMerchantMembershipProfiles: readMemberships,
    },
  };
  const allowed = new Set([routePath, "lib/merchantCustomers.ts", "lib/merchantCustomerListView.ts",
    "lib/merchantIdentity.ts", "lib/merchantIdRules.ts", "lib/requestMutationGuard.ts", "lib/requestOrigin.ts"]);
  class FixedDate extends Date {
    constructor(value: string | number = now) { super(value); }
    static now() { return Date.parse(now); }
  }
  const context = createContext({ URL, Request, Response, Date: FixedDate,
    process: { env: {} }, fetch: forbidden("network"), console: { error: forbidden("log"), warn: forbidden("log") } });
  const modules = new Map<string, { exports: Record<string, unknown> }>();
  function load(specifier: string): unknown {
    const name = specifier.startsWith("@/") ? specifier.slice(2) + ".ts" : specifier;
    if (Object.hasOwn(injected, name)) return injected[name];
    if (modules.has(name)) return modules.get(name)!.exports;
    assert.ok(allowed.has(name), "unexpected_dependency:" + name);
    const source = name === routePath ? (legacy ? legacyRouteSource() : routeSource) : readFileSync(path.join(root, name), "utf8");
    const key = name + ":" + source;
    if (!compiled.has(key)) compiled.set(key, ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
    }).outputText);
    const moduleRecord = { exports: {} as Record<string, unknown> };
    modules.set(name, moduleRecord);
    const execute = new Script("(function(require,module,exports){" + compiled.get(key) + "\n})", { filename: name }).runInContext(context);
    execute(load, moduleRecord, moduleRecord.exports);
    return moduleRecord.exports;
  }
  const route = load(routePath) as Record<"GET" | "POST" | "PATCH", (request: Request) => Promise<Response>>;
  return {
    events, route, forbiddenCalls,
    async get(view?: string, requestedSite = siteId) {
      const url = new URL("https://faolla.com/api/merchant-customers");
      url.searchParams.set("siteId", requestedSite);
      if (view !== undefined) url.searchParams.set("view", view);
      const response = await route.GET(new Request(url));
      const text = await response.text();
      assert.deepEqual(forbiddenCalls, []);
      return { status: response.status, body: JSON.parse(text), text, events: jsonClone(events) };
    },
  };
}

function expectedListBody<T extends { customers: Array<{ activity: Record<string, unknown> }> }>(body: T): T {
  const expected = jsonClone(body);
  for (const customer of expected.customers) {
    for (const key of ["firstActivityAt", "lastOrderAt", "lastBookingAt", "lastOrderNote", "lastBookingNote"]) {
      delete customer.activity[key];
    }
  }
  return expected;
}

test("complete pre-list-view route is preserved by exact list-view and membership-loader inverses", () => {
  legacyRouteSource();
});

test("merchant customer API rejects an invalid site id before reading data", async () => {
  for (const view of [undefined, "manager-v1", "unknown"]) {
    const result = await harness().get(view, "invalid");
    assert.equal(result.status, 400);
    assert.deepEqual(result.body, { ok: false, error: "invalid_site_id" });
    assert.deepEqual(result.events, []);
  }
});

test("merchant customer mutation rejects cross-origin requests", async () => {
  for (const method of ["POST", "PATCH"] as const) {
    const fixture = harness();
    const response = await fixture.route[method](new Request("https://faolla.com/api/merchant-customers?view=manager-v1", {
      method, headers: { "content-type": "application/json", origin: "https://evil.example" },
      body: JSON.stringify({ siteId, version: "", customers: [] }),
    }));
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error, "forbidden_origin");
    assert.deepEqual(fixture.events, []);
    assert.deepEqual(fixture.forbiddenCalls, []);
  }
});

test("default and every unknown view retain the complete legacy response and source calls", async () => {
  const expected = await harness({}, true).get();
  assert.equal(expected.status, 200);
  assert.equal(expected.body.customers.length, 1);
  assert.equal(expected.body.customers[0].activity.lastOrderNote, "Order activity note");
  assert.equal(expected.body.customers[0].activity.lastBookingNote, "Booking activity note");
  for (const view of [undefined, "", "unknown", "MANAGER-V1", " manager-v1 ", "manager-v2"]) {
    const actual = await harness().get(view);
    assert.equal(actual.text, expected.text, String(view));
    assert.deepEqual(actual.events, expected.events, String(view));
  }
});

test("manager-v1 preserves all profile fields, totals, metadata and source options while omitting unused activity", async () => {
  const full = await harness({}, true).get();
  const list = await harness().get("manager-v1");
  assert.equal(list.status, full.status);
  assert.deepEqual(list.body, expectedListBody(full.body));
  assert.deepEqual(list.events, full.events);
  assert.deepEqual(list.events, [
    { source: "session", hints: { hintedMerchantId: siteId } }, { source: "store-client" },
    { source: "stored", siteId }, { source: "orders", siteId },
    { source: "bookings", siteId, options: { includeAutomationState: false, includeCustomerEmailLogs: false, includeTimeline: false } },
    { source: "memberships", siteId },
  ]);
  assert.equal(list.body.total, 1);
  assert.equal(list.body.version, now);
  assert.deepEqual(list.body.warnings, []);
  assert.equal(list.body.customers[0].activity.orderCount, 1);
  assert.equal(list.body.customers[0].activity.bookingCount, 1);
  assert.deepEqual(list.body.customers[0].activity.orderTotals, [{ label: "EUR", amount: 12.34 }]);
  assert.equal(list.body.customers[0].notes, "Profile search and edit note");
});

test("opt-in view preserves each optional source warning and partial-source aggregation", async () => {
  for (const failures of [["orders"], ["bookings"], ["memberships"], ["orders", "bookings", "memberships"]] as SourceName[][]) {
    const full = await harness({ failures }, true).get();
    const list = await harness({ failures }).get("manager-v1");
    assert.equal(list.status, 200);
    assert.deepEqual(list.body, expectedListBody(full.body));
    assert.deepEqual(list.body.warnings, failures.map((source) => source + "_unavailable"));
    assert.deepEqual(list.events, full.events);
  }
});

test("empty lists and missing/null stored versions retain legacy envelope metadata", async () => {
  for (const options of [{ empty: true }, { empty: true, storedMissing: true }, { version: null }, { storedMissing: true }]) {
    const full = await harness(options, true).get();
    const list = await harness(options).get("manager-v1");
    assert.equal(list.status, 200);
    assert.deepEqual(list.body, expectedListBody(full.body));
    assert.deepEqual(list.events, full.events);
    if (options.empty) assert.deepEqual(list.body.customers, []);
    if (options.version === null || options.storedMissing) assert.equal(list.body.version, "");
  }
});

test("absent/wrong merchant sessions refuse before store or source IO for every view", async () => {
  for (const sessionSiteId of [null, "99990002"]) {
    for (const view of [undefined, "manager-v1", "unknown"]) {
      const result = await harness({ sessionSiteId }).get(view);
      assert.equal(result.status, 401);
      assert.deepEqual(result.body, { ok: false, error: "unauthorized" });
      assert.deepEqual(result.events, [{ source: "session", hints: { hintedMerchantId: siteId } }]);
    }
  }
});

test("session, store availability and required stored-source failures keep the complete legacy 503", async () => {
  for (const options of [{ sessionError: true }, { storeUnavailable: true }, { failures: ["stored"] as SourceName[] }]) {
    const expected = await harness(options, true).get();
    assert.equal(expected.status, 503);
    for (const view of [undefined, "manager-v1", "unknown"]) {
      const result = await harness(options).get(view);
      assert.equal(result.status, expected.status);
      assert.equal(result.text, expected.text);
      assert.deepEqual(result.events, expected.events);
      assert.equal(result.body.error, "merchant_customer_directory_load_failed");
      assert.equal(Object.hasOwn(result.body, "customers"), false);
    }
  }
});
