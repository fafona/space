import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as bookings from "./merchantBookings";
import * as workbench from "./merchantBookingWorkbench";
import * as links from "./merchantBookingSelfService";

const source = readFileSync(new URL("./merchantBookings.server.ts", import.meta.url), "utf8");
const ast = ts.createSourceFile("bookings.ts", source, ts.ScriptTarget.Latest, true);
const names = ["trimText", "normalizeProcessedMinutes", "applyStatusMetadata", "appendStatusTimelineEntry", "stampMerchantBookingTouch",
  "appendTimelineEntry", "normalizeTimelineFields", "createTimelineEntry", "hasTimelineEntry", "appendCustomerEmailLog", "createCustomerEmailLogEntry",
  "buildAutomationStateForEditableUpdate", "bookingEmailFailureDelivery", "buildCustomerActionLinks", "maybeSendCustomerStatusEmail",
  "resolveCustomerEmailSendFailureMessage", "sendMerchantBookingManualEmailBySite", "runMerchantBookingAutomationForSite"];
const declarations = names.map((name) => {
  const fn = ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(fn, name); return fn.getText(ast).replace(/^export\s+/, "");
}).join("\n");

function harness(unconfirmed = true) {
  let now = Date.parse("2026-10-26T08:00:00Z"), attempts = 0;
  class FixedDate extends Date { constructor(value?: string | number) { super(value ?? now); } static now() { return now; } }
  let records: bookings.MerchantBookingStoredRecord[] = [{ id: "synthetic", siteId: "99999999", siteName: "Synthetic", store: "Store", item: "Item", title: "Mx", customerName: "Synthetic",
    email: "customer@example.invalid", phone: "000", note: "", status: "confirmed", appointmentAt: "2026-10-26T10:00", appointmentTimeZone: "Europe/Madrid",
    createdAt: "2026-10-25T00:00:00Z", updatedAt: "2026-10-25T00:00:00Z", editToken: "synthetic-token" }];
  const settings = workbench.normalizeMerchantBookingWorkbenchSettings({ customerEmailReplyTo: "merchant@example.invalid", customerReminderOffsetsMinutes: [60], customerAutoEmailStatuses: ["confirmed"] });
  const runtime = { allowBooking: true, allowAutoEmail: true, senderName: "Synthetic", merchantDisplayName: "Synthetic", recordSiteName: "Synthetic", locale: "en-GB", publicSiteUrl: "https://synthetic.example.invalid" };
  const requests: Array<{ replyTo?: string | null }> = [];
  const sendEmail = async (_record: unknown, _statusOrOffset: unknown, options: { replyTo?: string | null }) => {
    attempts++; requests.push(options);
    return { attempted: true, attemptedAt: new FixedDate().toISOString(), status: "failed", error: "Synthetic uncertain delivery", ...(unconfirmed ? { deliveryUnconfirmed: true } : {}) };
  };
  const context = vm.createContext({ ...bookings, ...workbench, ...links, randomBytes, Date: FixedDate, Buffer, JSON, Math, Promise,
    queueBookingNotification: () => null,
    isAtomicBookingStorageEnabled: () => false,
    withBookingStoreLock: async (task: () => Promise<unknown>) => task(),
    readMerchantBookingStore: async () => ({ version: 1, records: structuredClone(records) }),
    writeMerchantBookingStore: async (store: { records: bookings.MerchantBookingStoredRecord[] }) => { records = structuredClone(store.records); },
    loadMerchantBookingWorkbenchSettings: async () => settings, loadSiteCustomerEmailRuntime: async () => runtime,
    createServerSupabaseServiceClient: () => null, sendMerchantBookingStatusEmail: sendEmail, sendMerchantBookingReminderEmail: sendEmail,
    attachTrustedBookingBusinessProjections: async (value: unknown) => value,
  });
  vm.runInContext(ts.transpileModule(declarations, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText, context);
  return { api: context, settings, runtime, requests, state: () => ({ records, attempts }),
    reschedule() {
      const current = records[0], appointmentAt = "2026-10-26T10:05";
      records[0] = { ...current, appointmentAt, ...context.buildAutomationStateForEditableUpdate(current, { ...current, appointmentAt }) };
      now = Date.parse("2026-10-26T08:05:00Z");
    } };
}

test("unconfirmed reminder is not recorded as sent and is not blindly resent on the next automation tick", async () => {
  const h = harness();
  await h.api.runMerchantBookingAutomationForSite("99999999");
  await h.api.runMerchantBookingAutomationForSite("99999999");
  const { records, attempts } = h.state();
  assert.equal(attempts, 1);
  assert.deepEqual(records[0].customerReminderUnconfirmedMinutes, [60]);
  assert.equal((records[0].customerReminderProcessedMinutes ?? []).length, 0);
  assert.equal(records[0].customerEmailLogs?.length ?? 0, 0);
  assert.equal(records[0].timeline?.[0].delivery, "unconfirmed");
  assert.equal(records[0].timeline?.[0].appointmentAt, records[0].appointmentAt);
  assert.equal(h.requests[0].replyTo, "merchant@example.invalid");
  assert.equal(workbench.buildMerchantBookingReminderSummary(records, h.settings, new Date("2026-10-26T08:00:00Z")).dueCustomerReminderCount, 0);
  assert.equal(Object.hasOwn(bookings.withoutMerchantBookingToken(records[0]), "customerReminderUnconfirmedMinutes"), false);
});

test("rescheduling clears the unconfirmed offset without a historical timeline suppressing the new reminder", async () => {
  const h = harness();
  await h.api.runMerchantBookingAutomationForSite("99999999");
  h.reschedule();
  await h.api.runMerchantBookingAutomationForSite("99999999");
  assert.equal(h.state().attempts, 2);
  const entries = h.state().records[0].timeline ?? [];
  assert.equal(entries.length, 2);
  assert.notEqual(entries[0].appointmentAt, entries[1].appointmentAt);
});

test("a definitive rejection keeps the existing retry behavior and is never marked unconfirmed", async () => {
  const h = harness(false);
  await h.api.runMerchantBookingAutomationForSite("99999999");
  await h.api.runMerchantBookingAutomationForSite("99999999");
  assert.equal(h.state().attempts, 2);
  assert.equal(h.state().records[0].customerReminderUnconfirmedMinutes, undefined);
  assert.equal(h.state().records[0].timeline?.[0].delivery, "failed");
});

test("status and manual email flows pass merchant Reply-To and persist unconfirmed rather than sent logs", async () => {
  const h = harness();
  const next = await h.api.maybeSendCustomerStatusEmail({ record: h.state().records[0], previousStatus: "active", settings: h.settings, runtime: h.runtime });
  assert.equal(next.timeline[0].delivery, "unconfirmed");
  assert.equal(next.customerEmailLogs?.length ?? 0, 0);
  await assert.rejects(() => h.api.sendMerchantBookingManualEmailBySite({ siteId: "99999999", bookingId: "synthetic", assertAuthorizationCurrent: async () => {} }), /Synthetic uncertain delivery/);
  assert.equal(h.state().records[0].timeline?.[0].delivery, "unconfirmed");
  assert.ok(h.requests.every((options) => options.replyTo === "merchant@example.invalid"));
});
