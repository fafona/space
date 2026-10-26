import { areBackgroundJobsPaused } from "./backgroundJobsPause";
import { bookingAtomicRpc, isAtomicBookingStorageEnabled } from "./merchantBookingAtomicRuntime.server";
import { parseBookingAppointment } from "./merchantBookingTime";
import { buildMerchantBookingSelfServiceUrl, buildMerchantBookingCustomerCalendarUrl } from "./merchantBookingSelfService";
import { sendMerchantBookingStatusEmail, sendMerchantBookingReminderEmail, type MerchantBookingConfirmationEmailSendResult } from "./merchantBookingEmails";
import { buildMerchantBookingReminderPushNotification, buildMerchantBookingPushNotification } from "./merchantPushEvents";
import { notifyMerchantPushSubscribers } from "./webPush";
import { createServerSupabaseServiceClient } from "./superAdminServer";
import type { MerchantPushSubscriptionStoreClient } from "./merchantPushSubscriptionStore";
import type { MerchantBookingRecord } from "./merchantBookings";
import type { BookingMailIntent, BookingAtomicRpc } from "./merchantBookingAtomicPreparation.server";
import type { MerchantBookingEmailTransportDependencies } from "./merchantBookingEmailTransport";

export type BookingNotificationJob = { id: string; site_id: string; booking_id: string; kind: BookingMailIntent["kind"];
  lease_id: string; lease_until: string; created_at: string; attempts: number;
  message: BookingMailIntent["message"]; delivery_context: BookingMailIntent["context"] };
type DeliveryContext = Awaited<ReturnType<typeof import("./merchantBookings.server").getMerchantBookingNotificationContext>>;
type Settlement = { state: "sent" | "failed" | "unconfirmed" | "skipped" | "pending";
  receipt?: string; error?: string; subject?: string; retrySeconds?: number };
export type BookingNotificationDependencies = {
  rpc: BookingAtomicRpc;
  load: (id: string) => Promise<DeliveryContext>;
  send: (job: BookingNotificationJob, current: NonNullable<DeliveryContext>) => Promise<MerchantBookingConfirmationEmailSendResult>;
  paused: () => boolean;
  now: () => number;
  timeoutMs?: number;
};

function staleReason(job: BookingNotificationJob, current: DeliveryContext, now: number) {
  const frozen = job.delivery_context?.booking;
  if (!frozen || !current || current.record.siteId !== job.site_id || current.record.id !== job.booking_id) return "booking_missing";
  if (!current.record.timeline?.some((entry) => entry.id === job.delivery_context?.eventId && entry.delivery === "queued")) return "intent_superseded";
  for (const key of ["appointmentAt", "appointmentTimeZone", "status", "email", "store", "item", "customerName", "phone", "note"] as const) {
    if ((frozen[key] || "") !== (current.record[key] || "")) return "booking_changed";
  }
  if ((job.kind === "status" || job.kind === "reminder") && (!current.runtime.allowAutoEmail || !current.settings.customerAutoEmailEnabled)) return "automation_disabled";
  if (job.kind === "status" && !current.settings.customerAutoEmailStatuses.includes(current.record.status)) return "status_notification_disabled";
  if (job.kind === "reminder" && !current.settings.customerReminderOffsetsMinutes.includes(job.message.reminderOffsetMinutes || 1)) return "reminder_disabled";
  if (job.kind === "push" && !current.settings.merchantReminderOffsetsMinutes.includes(job.message.reminderOffsetMinutes || 1)) return "reminder_disabled";
  const appointment = parseBookingAppointment(current.record.appointmentAt, current.record.appointmentTimeZone);
  if ((job.kind === "reminder" || job.kind === "push") && (!appointment || appointment.getTime() <= now)) return "reminder_expired";
  if (now - Date.parse(job.created_at) > 24 * 60 * 60 * 1000) return "notification_expired";
  return "";
}

/** One owned lease, one send. Rejected rate limits alone may be rescheduled.
 * A lost result/expired lease is never retried or reported as confirmed delivery.
 */
export async function processBookingNotification(job: BookingNotificationJob, dependencies: BookingNotificationDependencies) {
  const settle = async (value: Settlement) => {
    const response = await dependencies.rpc("faolla_booking_mail_settle_v2", { p_site_id: job.site_id, p_id: job.id, p_lease_id: job.lease_id,
      p_state: value.state, p_receipt: value.receipt ?? null, p_error: value.error ?? null,
      p_subject: value.subject?.slice(0, 500).replace(/[\u0000-\u001f\u007f]/gu, " ") ?? null, p_retry_seconds: value.retrySeconds ?? null });
    return !response.error && response.data === true;
  };
  if (dependencies.paused()) return "paused";
  let value: Settlement;
  try {
    const current = await dependencies.load(job.booking_id);
    const stale = staleReason(job, current, dependencies.now());
    if (stale) value = { state: "skipped", error: stale };
    else if (Date.parse(job.lease_until) - dependencies.now() < 20_000) value = { state: "unconfirmed", error: "dispatch_lease_insufficient" };
    else if (dependencies.paused()) return "paused";
    else {
      let timer: ReturnType<typeof setTimeout> | undefined;
      let result: MerchantBookingConfirmationEmailSendResult;
      try {
        result = await Promise.race([dependencies.send(job, current!), new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error("notification_timeout")), dependencies.timeoutMs ?? 20_000);
        })]);
      } finally { if (timer) clearTimeout(timer); }
      if (!result.attempted) value = { state: "failed", error: result.reason };
      else if (result.status === "sent" && result.messageId) value = { state: "sent", receipt: result.messageId, subject: result.subject };
      else if (result.status === "failed" && !result.deliveryUnconfirmed && result.retryAfterSeconds && job.attempts < 3) {
        value = { state: "pending", error: "provider_rate_limited", retrySeconds: result.retryAfterSeconds, subject: result.subject };
      } else if (result.status === "failed" && !result.deliveryUnconfirmed) value = { state: "failed", error: "provider_rejected", subject: result.subject };
      else value = { state: "unconfirmed", error: "delivery_unconfirmed", subject: result.subject };
    }
  } catch { value = { state: "unconfirmed", error: "dispatch_interrupted" }; }
  try { return await settle(value) ? value.state : "unconfirmed"; }
  catch { return "unconfirmed"; }
}

export async function deliverBookingNotification(job: BookingNotificationJob, current: NonNullable<DeliveryContext>, transport?: MerchantBookingEmailTransportDependencies): Promise<MerchantBookingConfirmationEmailSendResult> {
  if (job.kind === "push" || job.kind === "created_push") {
    const client = createServerSupabaseServiceClient();
    if (!client) return { attempted: false, reason: "disabled" };
    const notification = job.kind === "created_push" ? buildMerchantBookingPushNotification({ siteId: job.site_id, booking: current.record })
      : buildMerchantBookingReminderPushNotification({ siteId: job.site_id, booking: current.record, minutesBefore: job.message.reminderOffsetMinutes || 1 });
    const result = await notifyMerchantPushSubscribers(client as unknown as MerchantPushSubscriptionStoreClient, { merchantId: job.site_id, ...notification });
    return result.delivered > 0 ? { attempted: true, attemptedAt: new Date().toISOString(), status: "sent", messageId: `push:${result.delivered}` }
      : { attempted: true, attemptedAt: new Date().toISOString(), status: "failed", error: "push_not_delivered" };
  }
  const record = { ...current.record, ...job.delivery_context!.booking };
  const options = { locale: job.message.locale, senderName: job.delivery_context!.senderName,
    merchantDisplayName: job.delivery_context!.merchantDisplayName, extraMessage: job.delivery_context!.extraMessage,
    replyTo: current.settings.customerEmailReplyTo,
    actionLinks: { manageUrl: buildMerchantBookingSelfServiceUrl(current.runtime.publicSiteUrl, record, current.record.editToken),
      calendarUrl: buildMerchantBookingCustomerCalendarUrl(current.runtime.publicSiteUrl, record.id, current.record.editToken) } };
  return job.kind === "reminder" ? sendMerchantBookingReminderEmail(record, job.message.reminderOffsetMinutes || 1, options, transport)
    : sendMerchantBookingStatusEmail(record, record.status, options, transport);
}

export async function dispatchQueuedBookingNotifications(siteIds: string[]) {
  if (!isAtomicBookingStorageEnabled() || process.env.MERCHANT_BOOKING_NOTIFICATION_WORKER_ENABLED !== "1" || areBackgroundJobsPaused()) return { processed: 0, enabled: false };
  const rpc = bookingAtomicRpc();
  const { getMerchantBookingNotificationContext: load } = await import("./merchantBookings.server");
  let processed = 0;
  for (const siteId of siteIds) {
    for (let index = 0; index < 20 && !areBackgroundJobsPaused(); index++) {
      const claimed = await rpc("faolla_booking_mail_claim_v1", { p_site_id: siteId });
      if (claimed.error) throw new Error("booking_notification_claim_failed");
      if (!claimed.data) break;
      await processBookingNotification(claimed.data as BookingNotificationJob, { rpc, load, send: deliverBookingNotification, paused: areBackgroundJobsPaused, now: Date.now });
      processed++;
    }
  }
  return { processed, enabled: true };
}

/** Delivery state lives in the queue; reading never writes receipts to the
 * canonical reservation and cannot overwrite a concurrent customer/merchant edit.
 */
export async function projectBookingDeliveryStates<T extends MerchantBookingRecord>(records: T[]): Promise<T[]> {
  if (!isAtomicBookingStorageEnabled() || !records.some((record) => record.timeline?.some((entry) => entry.delivery === "queued"))) return records;
  const rpc = bookingAtomicRpc();
  const result: T[] = [];
  for (const siteId of [...new Set(records.map((record) => record.siteId))]) {
    const scoped = records.filter((record) => record.siteId === siteId);
    for (let offset = 0; offset < scoped.length; offset += 1000) {
      const window = scoped.slice(offset, offset + 1000);
      const response = await rpc("faolla_booking_mail_states_v2", { p_site_id: siteId, p_booking_ids: window.map((record) => record.id) });
      const states = !response.error && Array.isArray(response.data) ? response.data as Array<{ bookingId: string; eventId: string; state: string; at: string; subject?: string; error?: string }> : null;
      for (const record of window) {
        const timeline = record.timeline?.map((entry) => {
          if (entry.delivery !== "queued") return entry;
          const delivery = states?.find((state) => state.bookingId === record.id && state.eventId === entry.id);
          if (!states) return { ...entry, delivery: "unconfirmed" as const, note: "delivery_status_unavailable" };
          if (!delivery) return entry;
          const state = delivery.state;
          return { ...entry, delivery: state === "pending" || state === "dispatching" ? "queued" as const
            : state === "sent" || state === "failed" || state === "skipped" ? state : "unconfirmed" as const,
            ...(state === "sent" ? { at: delivery.at } : {}), ...(delivery.subject ? { subject: delivery.subject } : {}), ...(delivery.error ? { note: delivery.error } : {}) };
        });
        const logs = record.customerEmailLogs === undefined ? undefined : [...record.customerEmailLogs];
        for (const entry of timeline ?? []) {
          if (logs && entry.kind === "customer_email" && entry.delivery === "sent" && entry.emailKind && !logs.some((log) => log.id === `queue:${entry.id}`)) {
            const original = record.timeline?.find((item) => item.id === entry.id);
            if (original?.delivery === "queued") logs.push({ id: `queue:${entry.id}`, kind: entry.emailKind, sentAt: entry.at,
              locale: entry.locale || "", senderName: entry.senderName || "", subject: entry.subject || "", status: entry.toStatus, minutesBefore: entry.minutesBefore });
          }
        }
        result.push({ ...record, ...(timeline ? { timeline } : {}), ...(logs ? { customerEmailLogs: logs.slice(-40) } : {}) });
      }
    }
  }
  const byId = new Map(result.map((record) => [record.id, record]));
  return records.map((record) => byId.get(record.id) ?? record);
}
