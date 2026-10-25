import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as bookings from "./merchantBookings";
import * as workbench from "./merchantBookingWorkbench";
import * as rules from "./merchantBookingRules";
import * as time from "./merchantBookingTime";

// Execute the actual mutation bodies with in-memory IO, not copied business
// logic. No environment files, databases, production endpoints or mail delivery.
const source = readFileSync(new URL("./merchantBookings.server.ts", import.meta.url), "utf8");
const ast = ts.createSourceFile("booking.ts", source, ts.ScriptTarget.Latest, true);
const names = ["trimText", "normalizeAuthoritativeBookingSiteName", "loadSiteCustomerEmailRuntime",
  "applyStatusMetadata", "stampMerchantBookingTouch", "appendTimelineEntry", "normalizeTimelineFields", "createTimelineEntry",
  "collectEditableFieldChanges", "appendStatusTimelineEntry", "normalizeBookingRuleBinding", "matchesRuleBinding",
  "assertBookingReopeningCapacity", "bookingAppointmentSettings", "buildAutomationStateForEditableUpdate",
  "collectWorkbenchAvailabilityIssues", "applyAuthoritativeBookingRuleSelection", "attachTrustedBookingBusinessProjection",
  "matchesPersonalBookingCustomer", "createEditToken", "updateMerchantBooking", "updatePersonalMerchantBooking",
  "cancelPersonalMerchantBooking", "createMerchantBooking", "updateMerchantBookingBySite", "updateMerchantBookingsBatchBySite",
  "updateMerchantBookingStatusBySite", "resolveStoredBookingByEditToken", "getMerchantBookingSelfServiceDetails"];
const declarations = names.map((name) => {
  const node = ast.statements.find((item) => ts.isFunctionDeclaration(item) && item.name?.text === name);
  assert.ok(node, name);
  return node.getText(ast).replace(/^export\s+/, "");
}).join("\n");

function fixture(patch: Partial<bookings.MerchantBookingStoredRecord> = {}): bookings.MerchantBookingStoredRecord {
  return { id: "test-1", siteId: "99999999", siteName: "Synthetic", customerAccountId: "account-1",
    bookingBlockId: "booking-shared", bookingViewport: "desktop", store: "Store", item: "Consultation", title: "Mx",
    customerName: "Synthetic", email: "synthetic@example.invalid", phone: "000", note: "", appointmentAt: "2030-02-01T10:00",
    status: "active", editToken: "synthetic-token", merchantTouchedAt: "", createdAt: "2026-10-24T00:00:00.000Z",
    updatedAt: "2026-10-25T00:00:00.000Z", ...patch };
}

function harness(initial: bookings.MerchantBookingStoredRecord[] = [], options: { enabled?: boolean; capacity?: number; timeZone?: string; allDay?: boolean } = {}) {
  let records = structuredClone(initial), writes = 0, emails = 0, automationCalls = 0;
  const settings = workbench.normalizeMerchantBookingWorkbenchSettings({ timeZone: options.timeZone });
  const bindings: unknown[] = [];
  const context = vm.createContext({ ...bookings, ...workbench, ...rules, ...time, randomBytes, Date, Buffer, JSON, Math, Promise,
    isAtomicBookingStorageEnabled: () => false,
    queueBookingNotification: () => null,
    MERCHANT_BOOKING_SITE_NAME_MAX_BYTES: 320, MERCHANT_BOOKING_SITE_NAME_CONTROL_PATTERN: /[\u0000-\u001f]/u,
    withBookingStoreLock: async (task: () => Promise<unknown>) => task(),
    readMerchantBookingStore: async () => ({ version: 1, records: structuredClone(records) }),
    writeMerchantBookingStore: async (store: { records: bookings.MerchantBookingStoredRecord[] }) => { writes++; records = structuredClone(store.records); },
    loadMerchantBookingWorkbenchSettings: async () => settings,
    loadCurrentMerchantSnapshotSiteBySiteId: async () => ({ merchantName: "Synthetic", permissionConfig: { allowBookingBlock: options.enabled !== false, allowBookingAutoEmail: false }, location: { countryCode: "ES" } }),
    resolveMerchantBookingCustomerEmailLocale: () => "en-GB",
    buildMerchantBookingPublicSiteUrl: () => "https://synthetic.example.invalid",
    maybeSendCustomerStatusEmail: async ({ record }: { record: bookings.MerchantBookingStoredRecord }) => { emails++; return record; },
    resolveBookingRuleContext: async (_siteId: string, binding: unknown) => {
      bindings.push(binding);
      return { binding: { bookingBlockId: "booking-shared", bookingViewport: "desktop" },
        rule: { storeOptions: ["Store"], itemOptions: ["Consultation"], titleOptions: ["Mx"] },
        availableTimeRanges: [options.allDay ? "00:00-23:59" : "09:00-18:00"], timeSlotRules: [{ timeRange: "09:00-18:00", maxBookings: options.capacity ?? null }], blockedDates: [], holidayDates: [] };
    },
    attachTrustedBookingBusinessProjections: async (value: unknown) => value,
    runMerchantBookingAutomationForSite: async () => { automationCalls++; return { version: 1, records: structuredClone(records) }; },
  });
  vm.runInContext(ts.transpileModule(declarations, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText, context);
  return { api: context, state: () => ({ records, writes, emails, automationCalls, bindings }) };
}

test("token and personal lifecycle locks agree for all statuses and merchant touches", async () => {
  for (const status of bookings.MERCHANT_BOOKING_STATUSES) {
    for (const touched of [false, true]) {
      for (const action of ["cancel", "update"] as const) {
        const record = fixture({ status, merchantTouchedAt: touched ? "2026-10-25T00:00:00.000Z" : "" });
        const token = harness([record]), personal = harness([record]);
        const expectedAction = action === "update" && status === "cancelled" ? "restore" : action;
        const tokenCall = () => token.api.updateMerchantBooking({ bookingId: record.id, editToken: record.editToken, action, updates: { note: "edited" } });
        const personalCall = () => personal.api.updatePersonalMerchantBooking({ bookingId: record.id, accountId: "account-1", action: expectedAction, updates: { note: "edited" } });
        if (bookings.canCustomerChangeMerchantBooking(record, expectedAction)) {
          await tokenCall(); await personalCall();
        } else {
          await assert.rejects(tokenCall, /booking_customer_action_locked/);
          await assert.rejects(personalCall, /booking_customer_action_locked/);
          assert.equal(token.state().writes + personal.state().writes, 0);
          assert.equal(token.state().emails + personal.state().emails, 0);
        }
      }
    }
  }
});

test("invalid edit token cannot trigger automation", async () => {
  const h = harness([fixture()]);
  assert.equal(await h.api.resolveStoredBookingByEditToken({ bookingId: "test-1", editToken: "wrong" }), null);
  assert.equal(h.state().automationCalls, 0);
  assert.ok(await h.api.resolveStoredBookingByEditToken({ bookingId: "test-1", editToken: "synthetic-token" }));
  assert.equal(h.state().automationCalls, 1);
});

test("management details resolve the stored rule binding and never include the edit token", async () => {
  const h = harness([fixture()], { timeZone: "Europe/Madrid" });
  await assert.rejects(() => h.api.getMerchantBookingSelfServiceDetails({ bookingId: "test-1", editToken: "wrong" }), /预约凭证无效/);
  assert.equal(h.state().automationCalls, 0);
  const details = await h.api.getMerchantBookingSelfServiceDetails({ bookingId: "test-1", editToken: "synthetic-token" });
  assert.equal(details.settings.timeZone, "Europe/Madrid");
  assert.equal(details.booking.editToken, undefined);
  assert.equal(JSON.stringify(h.state().bindings[0]), JSON.stringify({ ...fixture() }));
});

test("disabled current entitlement overrides retained published rules; cancellation remains available", async () => {
  const h = harness([fixture()], { enabled: false });
  await assert.rejects(() => h.api.createMerchantBooking(fixture()), /当前未开放预约/);
  await assert.rejects(() => h.api.updateMerchantBooking({ bookingId: "test-1", editToken: "synthetic-token", action: "update", updates: { note: "edited" } }), /当前未开放预约/);
  await assert.rejects(() => h.api.updatePersonalMerchantBooking({ bookingId: "test-1", accountId: "account-1", action: "update", updates: { note: "edited" } }), /当前未开放预约/);
  assert.equal(h.state().writes, 0);
  await h.api.updateMerchantBooking({ bookingId: "test-1", editToken: "synthetic-token", action: "cancel" });
  assert.equal(h.state().records[0].status, "cancelled");
});

test("token edit cannot select a different block or viewport capacity pool", async () => {
  const h = harness([fixture()]);
  await h.api.updateMerchantBooking({ bookingId: "test-1", editToken: "synthetic-token", action: "update", bookingBlockId: "other", bookingViewport: "mobile", updates: { note: "edited" } });
  assert.equal(JSON.stringify(h.state().bindings[0]), JSON.stringify({ bookingBlockId: "booking-shared", bookingViewport: "desktop" }));
});

test("all merchant status-only restore entrypoints reject a full slot without writes or emails", async () => {
  for (const method of ["updateMerchantBookingBySite", "updateMerchantBookingStatusBySite", "updateMerchantBookingsBatchBySite"]) {
    const h = harness([fixture({ status: "cancelled" }), fixture({ id: "test-2" })], { capacity: 1 });
    await assert.rejects(() => h.api[method]({ siteId: "99999999", bookingId: "test-1", bookingIds: ["test-1"], status: "active", assertAuthorizationCurrent: async () => {} }), /已满/);
    assert.equal(h.state().writes, 0); assert.equal(h.state().emails, 0);
  }
});

test("batch restore preflights joint occupancy before any side effects", async () => {
  const h = harness([fixture({ status: "cancelled" }), fixture({ id: "test-2", status: "cancelled" })], { capacity: 1 });
  await assert.rejects(() => h.api.updateMerchantBookingsBatchBySite({ siteId: "99999999", bookingIds: ["test-1", "test-2"], status: "confirmed" }), /已满/);
  assert.equal(h.state().writes, 0); assert.equal(h.state().emails, 0);
  assert.ok(h.state().records.every((record) => record.status === "cancelled"));
});

test("restoring into available capacity still succeeds and stamps merchant touch", async () => {
  const h = harness([fixture({ status: "cancelled" })], { capacity: 1 });
  await h.api.updateMerchantBookingBySite({ siteId: "99999999", bookingId: "test-1", status: "active" });
  assert.equal(h.state().records[0].status, "active");
  assert.ok(h.state().records[0].merchantTouchedAt);
});

test("public creation and customer rescheduling reject past appointments even without minimum advance", async () => {
  const h = harness([fixture()]);
  await assert.rejects(() => h.api.createMerchantBooking(fixture({ appointmentAt: "2000-01-01T10:00" })), /预约时间已过/);
  await assert.rejects(() => h.api.updateMerchantBooking({ bookingId: "test-1", editToken: "synthetic-token", action: "update", updates: { appointmentAt: "2000-01-01T10:00" } }), /预约时间已过/);
  assert.equal(h.state().writes, 0);
});

test("new zoned bookings retain their zone; changing settings does not reinterpret legacy bookings", async () => {
  const h = harness([fixture()], { timeZone: "Europe/Madrid" });
  await h.api.createMerchantBooking(fixture({ id: "ignored" }));
  assert.equal(h.state().records[0].appointmentTimeZone, "Europe/Madrid");
  await h.api.updateMerchantBooking({ bookingId: "test-1", editToken: "synthetic-token", action: "update", updates: { note: "edited" } });
  assert.equal(h.state().records.find((record) => record.id === "test-1")?.appointmentTimeZone, undefined);
});

test("merchant rescheduling rejects invalid DST times without forbidding historical edits", async () => {
  const h = harness([fixture()], { timeZone: "Europe/Madrid", allDay: true });
  await assert.rejects(() => h.api.updateMerchantBookingBySite({ siteId: "99999999", bookingId: "test-1", updates: { appointmentAt: "2026-03-29T02:30" } }), /夏令时/);
  assert.equal(h.state().writes, 0);
  await h.api.updateMerchantBookingBySite({ siteId: "99999999", bookingId: "test-1", updates: { appointmentAt: "2000-01-01T10:00" } });
  assert.equal(h.state().records[0].appointmentAt, "2000-01-01T10:00");
  assert.equal(h.state().records[0].appointmentTimeZone, "Europe/Madrid");
});
