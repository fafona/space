import assert from "node:assert/strict";
import test from "node:test";
import { normalizeMerchantBookingReplyTo } from "./merchantBookingEmailAddress";
import { deliverMerchantBookingEmail } from "./merchantBookingEmailTransport";
import { sendMerchantBookingReminderEmail, sendMerchantBookingStatusEmail } from "./merchantBookingEmails";
import { getMerchantBookingWorkbenchPublicSettings, normalizeMerchantBookingWorkbenchSettings } from "./merchantBookingWorkbench";
import type { MerchantBookingRecord } from "./merchantBookings";

const booking: MerchantBookingRecord = { id: "synthetic-booking", siteId: "99999999", siteName: "Synthetic Merchant", store: "Store", item: "Consultation", title: "Mx",
  customerName: "Synthetic", email: "customer@example.invalid", phone: "000", note: "", appointmentAt: "2030-02-01T10:00", appointmentTimeZone: "Europe/Madrid",
  status: "confirmed", createdAt: "2026-10-25T00:00:00Z", updatedAt: "2026-10-25T00:00:00Z" };

async function withSyntheticEmailConfig(task: () => Promise<void>) {
  const names = ["RESEND_API_KEY", "BOOKING_CONFIRMATION_EMAIL_FROM", "BOOKING_CONFIRMATION_EMAIL_REPLY_TO"] as const;
  const original = names.map((name) => process.env[name]);
  process.env.RESEND_API_KEY = "synthetic-key-not-a-credential";
  process.env.BOOKING_CONFIRMATION_EMAIL_FROM = "FAOLLA <notify@platform.example.invalid>";
  process.env.BOOKING_CONFIRMATION_EMAIL_REPLY_TO = "platform-reply@example.invalid";
  try { await task(); } finally {
    names.forEach((name, index) => { if (original[index] === undefined) delete process.env[name]; else process.env[name] = original[index]; });
  }
}

test("Reply-To accepts one mailbox and rejects header injection, names and address lists", () => {
  assert.equal(normalizeMerchantBookingReplyTo(" Owner+bookings@EXAMPLE.invalid "), "Owner+bookings@example.invalid");
  for (const value of ["Owner <owner@example.invalid>", "one@example.invalid,two@example.invalid", "one@example.invalid;two@example.invalid", "owner@example.invalid\r\nBcc:other@example.invalid", ".owner@example.invalid", "owner..name@example.invalid", "owner@-example.invalid", "owner@localhost", 123]) {
    assert.equal(normalizeMerchantBookingReplyTo(value), "", String(value));
  }
});

test("loading legacy workbench settings does not add a Reply-To field; public projection never exposes it", () => {
  assert.equal(Object.hasOwn(normalizeMerchantBookingWorkbenchSettings({}), "customerEmailReplyTo"), false);
  assert.equal(Object.hasOwn(getMerchantBookingWorkbenchPublicSettings({ customerEmailReplyTo: "private@example.invalid" }), "customerEmailReplyTo"), false);
});

test("status and reminder emails use merchant Reply-To without changing the platform From mailbox", async () => withSyntheticEmailConfig(async () => {
  const requests: Record<string, unknown>[] = [];
  const fetcher: typeof fetch = async (_url, init) => {
    requests.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ id: "synthetic-receipt" }), { status: 200 });
  };
  const options = { replyTo: "merchant@example.invalid", senderName: 'Merchant "Name"', locale: "en-GB" };
  const status = await sendMerchantBookingStatusEmail(booking, "confirmed", options, { fetcher });
  const reminder = await sendMerchantBookingReminderEmail(booking, 60, options, { fetcher });
  assert.ok(status.attempted && status.status === "sent"); assert.ok(reminder.attempted && reminder.status === "sent");
  assert.equal(requests.length, 2);
  for (const body of requests) {
    assert.equal(body.reply_to, "merchant@example.invalid");
    assert.equal(body.from, "Merchant Name <notify@platform.example.invalid>");
    assert.deepEqual(body.to, [booking.email]);
    assert.match(String(body.text), /Europe\/Madrid/);
    assert.match(String(body.html), /Europe\/Madrid/);
  }
}));

test("blank merchant Reply-To retains the configured global fallback; malformed override fails before fetch", async () => withSyntheticEmailConfig(async () => {
  let calls = 0;
  const fetcher: typeof fetch = async (_url, init) => {
    calls++; assert.equal(JSON.parse(String(init?.body)).reply_to, "platform-reply@example.invalid");
    return new Response('{"id":"synthetic-receipt"}');
  };
  await sendMerchantBookingStatusEmail(booking, "confirmed", { replyTo: "" }, { fetcher });
  assert.equal(calls, 1);
  const invalid = await sendMerchantBookingStatusEmail(booking, "confirmed", { replyTo: "one@example.invalid,two@example.invalid" }, { fetcher });
  assert.deepEqual(invalid, { attempted: false, reason: "invalid_reply_to" });
  assert.equal(calls, 1);
  process.env.BOOKING_CONFIRMATION_EMAIL_REPLY_TO = "bad global value";
  assert.deepEqual(await sendMerchantBookingStatusEmail(booking, "confirmed", {}, { fetcher }), { attempted: false, reason: "invalid_reply_to" });
  assert.equal(calls, 1);
}));

test("missing configuration or recipient never makes a delivery request", async () => withSyntheticEmailConfig(async () => {
  const fetcher: typeof fetch = async () => { throw new Error("Unexpected delivery request"); };
  assert.deepEqual(await sendMerchantBookingStatusEmail({ ...booking, email: "" }, "confirmed", {}, { fetcher }), { attempted: false, reason: "missing_email" });
  delete process.env.RESEND_API_KEY;
  assert.deepEqual(await sendMerchantBookingStatusEmail(booking, "confirmed", {}, { fetcher }), { attempted: false, reason: "disabled" });
}));

test("transport bounds a stalled fetch even when it ignores abort, and makes only one attempt", { timeout: 2000 }, async () => {
  let calls = 0, signal: AbortSignal | null = null;
  const fetcher: typeof fetch = async (_url, init) => { calls++; signal = init?.signal ?? null; return new Promise<Response>(() => {}); };
  const result = await deliverMerchantBookingEmail({ apiKey: "synthetic-key", body: {} }, { fetcher, timeoutMs: 20 });
  assert.equal(result.delivery, "unconfirmed"); assert.equal(calls, 1);
  assert.ok((signal as AbortSignal | null)?.aborted);
});

test("transport also bounds a stalled response body and marks it unconfirmed", { timeout: 2000 }, async () => {
  const fetcher: typeof fetch = async () => new Response(new ReadableStream({ start() {} }), { status: 200 });
  const result = await deliverMerchantBookingEmail({ apiKey: "synthetic-key", body: {} }, { fetcher, timeoutMs: 20 });
  assert.equal(result.delivery, "unconfirmed");
});

test("transport never treats missing or malformed success receipts as sent", async () => {
  for (const body of ["", "not-json", "{}", '{"id":""}', '{"id":123}']) {
    const result = await deliverMerchantBookingEmail({ apiKey: "synthetic-key", body: {} }, { fetcher: async () => new Response(body) });
    assert.equal(result.delivery, "unconfirmed");
  }
});

test("provider rejection, uncertain server responses and connection loss remain distinct without leaking body text", async () => {
  for (const status of [400, 401, 403, 422, 429, 500, 502, 503, 408]) {
    const result = await deliverMerchantBookingEmail({ apiKey: "sensitive-test-placeholder", body: {} }, { fetcher: async () => new Response("sensitive-test-placeholder customer@example.invalid", { status }) });
    assert.equal(result.delivery, status >= 500 || status === 408 ? "unconfirmed" : "failed");
    assert.ok(!JSON.stringify(result).includes("sensitive-test-placeholder"));
    assert.ok(!JSON.stringify(result).includes("customer@example.invalid"));
  }
  assert.equal((await deliverMerchantBookingEmail({ apiKey: "synthetic-key", body: {} }, { fetcher: async () => { throw new Error("sensitive-test-placeholder"); } })).delivery, "unconfirmed");
});

test("public email result preserves the unconfirmed distinction for callers", async () => withSyntheticEmailConfig(async () => {
  const result = await sendMerchantBookingStatusEmail(booking, "confirmed", {}, { fetcher: async () => new Response("", { status: 503 }) });
  assert.ok(result.attempted && result.status === "failed" && result.deliveryUnconfirmed === true);
}));
