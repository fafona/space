import assert from "node:assert/strict";
import test from "node:test";
import { processBookingNotification, type BookingNotificationJob, type BookingNotificationDependencies } from "./merchantBookingNotificationWorker.server";
import { normalizeMerchantBookingWorkbenchSettings } from "./merchantBookingWorkbench";
import type { MerchantBookingStoredRecord } from "./merchantBookings";

function harness() {
  const now = Date.parse("2030-01-01T10:00:00Z");
  const eventId = "evt-1234567890abcdef";
  const record = { id: "one", siteId: "12345678", status: "active", editToken: "private-token",
    appointmentAt: "2030-01-02T12:00", appointmentTimeZone: "Europe/Madrid", email: "synthetic@example.invalid",
    timeline: [{ id: eventId, kind: "customer_email", delivery: "queued" }], } as MerchantBookingStoredRecord;
  const { editToken, timeline, ...snapshot } = record; void editToken; void timeline;
  const job = { id: "job", site_id: record.siteId, booking_id: record.id, kind: "status", lease_id: "lease",
    lease_until: new Date(now + 60000).toISOString(), created_at: new Date(now).toISOString(), attempts: 1,
    message: { recipient: record.email }, delivery_context: { eventId, booking: snapshot, senderName: "Synthetic", merchantDisplayName: "Synthetic", extraMessage: "" } } as BookingNotificationJob;
  const current = { record, settings: normalizeMerchantBookingWorkbenchSettings({ customerAutoEmailEnabled: true, customerAutoEmailStatuses: ["active"] }),
    runtime: { allowBooking: true, allowAutoEmail: true, merchantDisplayName: "Synthetic", recordSiteName: "Synthetic", senderName: "Synthetic", locale: "en-GB", publicSiteUrl: "https://example.invalid" } };
  let sends = 0;
  const settlements: Array<Record<string, unknown>> = [];
  const dependencies: BookingNotificationDependencies = { now: () => now, paused: () => false, load: async () => current,
    send: async () => { sends++; return { attempted: true, attemptedAt: new Date(now).toISOString(), status: "sent", messageId: "synthetic-receipt" }; },
    rpc: async (_name, args) => { settlements.push(args); return { data: true, error: null }; } };
  return { job, current, dependencies, settlements, sends: () => sends };
}
test("owned queued notification settles only after a valid receipt", async () => {
  const h = harness(); assert.equal(await processBookingNotification(h.job, h.dependencies), "sent");
  assert.equal(h.sends(), 1); assert.equal(h.settlements[0].p_receipt, "synthetic-receipt");
  assert.equal(h.settlements[0].p_lease_id, "lease");
});
test("changed/cancelled/expired booking and revoked automation cannot send stale notifications", async () => {
  for (const mutate of [
    (h: ReturnType<typeof harness>) => { h.current.record.status = "cancelled"; },
    (h: ReturnType<typeof harness>) => { h.current.record.appointmentAt = "2030-01-03T12:00"; },
    (h: ReturnType<typeof harness>) => { h.current.record.email = "changed@example.invalid"; },
    (h: ReturnType<typeof harness>) => { h.current.runtime.allowAutoEmail = false; },
    (h: ReturnType<typeof harness>) => { h.job.created_at = "2029-12-01T00:00:00Z"; },
    (h: ReturnType<typeof harness>) => { h.current.record.timeline = []; },
  ]) { const h = harness(); mutate(h); assert.equal(await processBookingNotification(h.job, h.dependencies), "skipped"); assert.equal(h.sends(), 0); }
});
test("pause and insufficient/expired lease prevent sending", async () => {
  const paused = harness(); paused.dependencies.paused = () => true;
  assert.equal(await processBookingNotification(paused.job, paused.dependencies), "paused"); assert.equal(paused.sends(), 0);
  const expired = harness(); expired.job.lease_until = "2029-12-01T00:00:00Z";
  assert.equal(await processBookingNotification(expired.job, expired.dependencies), "unconfirmed"); assert.equal(expired.sends(), 0);
});
test("timeout is bounded, cannot be sent, and is not requeued", async () => {
  const h = harness(); h.dependencies.timeoutMs = 5; h.dependencies.send = () => new Promise(() => {});
  assert.equal(await processBookingNotification(h.job, h.dependencies), "unconfirmed");
  assert.equal(h.settlements[0].p_state, "unconfirmed"); assert.equal(h.settlements[0].p_retry_seconds, null);
});
test("only definite rate limits retry, with a three-attempt ceiling", async () => {
  const h = harness(); h.dependencies.send = async () => ({ attempted: true, attemptedAt: "2030-01-01T10:00:00Z", status: "failed", error: "provider_rate_limited", retryAfterSeconds: 60 });
  assert.equal(await processBookingNotification(h.job, h.dependencies), "pending"); assert.equal(h.settlements[0].p_retry_seconds, 60);
  h.job.attempts = 3;
  assert.equal(await processBookingNotification(h.job, h.dependencies), "failed");
  const uncertain = harness(); uncertain.dependencies.send = async () => ({ attempted: true, attemptedAt: "2030-01-01T10:00:00Z", status: "failed", error: "timeout", deliveryUnconfirmed: true });
  assert.equal(await processBookingNotification(uncertain.job, uncertain.dependencies), "unconfirmed");
  uncertain.dependencies.send = async () => ({ attempted: true, attemptedAt: "2030-01-01T10:00:00Z", status: "failed", error: "uncertain", deliveryUnconfirmed: true, retryAfterSeconds: 60 });
  assert.equal(await processBookingNotification(uncertain.job, uncertain.dependencies), "unconfirmed");
});
test("lost settlement result or stale lease cannot report success or cause another send", async () => {
  const h = harness(); h.dependencies.rpc = async () => ({ data: false, error: null });
  assert.equal(await processBookingNotification(h.job, h.dependencies), "unconfirmed"); assert.equal(h.sends(), 1);
});
