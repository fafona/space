import {
  buildMerchantBookingReminderOffsetLabel,
  getMerchantBookingCustomerEmailAdditionalMessageLabel,
  getMerchantBookingCustomerEmailActionLead,
  getMerchantBookingCustomerEmailCalendarActionLabel,
  getMerchantBookingCustomerEmailContactMerchantLine,
  getMerchantBookingCustomerEmailCustomerFallback,
  getMerchantBookingCustomerEmailGreeting,
  getMerchantBookingCustomerEmailManageActionLabel,
  getMerchantBookingCustomerEmailReminderLabel,
  getMerchantBookingCustomerEmailDefaultStatusMessage,
  getMerchantBookingCustomerReminderLead,
  getMerchantBookingCustomerEmailStatusLabel,
  getMerchantBookingCustomerEmailStatusLead,
  getMerchantBookingCustomerEmailStatusSubject,
  getMerchantBookingCustomerReminderEmailSubject,
  resolveMerchantBookingCustomerEmailLocale,
} from "@/lib/merchantBookingCustomerEmail";
import {
  formatMerchantBookingDateTime,
  formatMerchantBookingDisplayName,
  getMerchantBookingFieldText,
  getMerchantBookingStatusText,
} from "@/lib/merchantBookingLocale";
import type { MerchantBookingRecord, MerchantBookingStatus } from "./merchantBookings";
import { normalizeMerchantBookingReplyTo } from "./merchantBookingEmailAddress";
import { deliverMerchantBookingEmail, type MerchantBookingEmailTransportDependencies } from "./merchantBookingEmailTransport";

export type MerchantBookingConfirmationEmailSendResult =
  | {
      attempted: false;
      reason: "disabled" | "missing_email" | "invalid_reply_to";
    }
  | {
      attempted: true;
      attemptedAt: string;
      status: "sent";
      messageId?: string;
      subject?: string;
      locale?: string;
      senderName?: string;
    }
  | {
      attempted: true;
      attemptedAt: string;
      status: "failed";
      error: string;
      deliveryUnconfirmed?: boolean;
      retryAfterSeconds?: number;
      subject?: string;
      locale?: string;
      senderName?: string;
    };

type MerchantBookingConfirmationEmailConfig = {
  apiKey: string;
  from: string;
  replyTo?: string;
};

type MerchantBookingCustomerEmailOptions = {
  locale?: string | null;
  senderName?: string | null;
  replyTo?: string | null;
  merchantDisplayName?: string | null;
  extraMessage?: string | null;
  actionLinks?: {
    manageUrl?: string | null;
    calendarUrl?: string | null;
  } | null;
};

function normalizeEnvValue(value: string | undefined) {
  return typeof value === "string" ? value.trim() : "";
}

function trimText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function getMerchantBookingConfirmationEmailConfig(): MerchantBookingConfirmationEmailConfig | null {
  const apiKey = normalizeEnvValue(process.env.RESEND_API_KEY);
  const from = normalizeEnvValue(process.env.BOOKING_CONFIRMATION_EMAIL_FROM);
  const replyTo = normalizeEnvValue(process.env.BOOKING_CONFIRMATION_EMAIL_REPLY_TO);
  if (!apiKey || !from) {
    return null;
  }
  return {
    apiKey,
    from,
    ...(replyTo ? { replyTo } : {}),
  };
}

/** Configuration presence only, NOT proof of sender-domain verification or
 * successful delivery. Do not expose the key, mailbox address or credential. */
export function getMerchantBookingEmailReadiness() {
  return { configured: Boolean(getMerchantBookingConfirmationEmailConfig()) };
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function buildMerchantDisplayName(
  booking: MerchantBookingRecord,
  _locale: string,
  overrideMerchantDisplayName?: string | null,
) {
  return trimText(overrideMerchantDisplayName) || trimText(booking.siteName) || trimText(booking.store) || "FAOLLA";
}

function buildCustomerDisplayName(booking: MerchantBookingRecord, locale: string) {
  return (
    trimText(formatMerchantBookingDisplayName(booking.customerName, booking.title, locale)) ||
    getMerchantBookingCustomerEmailCustomerFallback(locale)
  );
}

function formatBookingTimestamp(booking: MerchantBookingRecord, locale: string) {
  const formatted = formatMerchantBookingDateTime(booking.appointmentAt, locale);
  return booking.appointmentTimeZone ? `${formatted} (${booking.appointmentTimeZone})` : formatted;
}

function buildFromValue(configuredFrom: string, senderName?: string | null) {
  const sanitizedSenderName = trimText(senderName).replace(/[<>\r\n"]/g, "").trim();
  if (!sanitizedSenderName) return configuredFrom;
  const angleMatch = configuredFrom.match(/^(.*)<([^>]+)>$/);
  if (angleMatch) {
    const address = trimText(angleMatch[2]);
    return address ? `${sanitizedSenderName} <${address}>` : configuredFrom;
  }
  const simpleAddress = trimText(configuredFrom);
  if (simpleAddress.includes("@")) {
    return `${sanitizedSenderName} <${simpleAddress}>`;
  }
  return configuredFrom;
}

function buildStatusDetailsLines(
  booking: MerchantBookingRecord,
  status: MerchantBookingStatus,
  locale: string,
  extraMessage?: string | null,
) {
  const lines = [
    `${getMerchantBookingFieldText("bookingId", locale)}: ${trimText(booking.id) || "-"}`,
    `${getMerchantBookingFieldText("store", locale)}: ${trimText(booking.store) || "-"}`,
    `${getMerchantBookingFieldText("item", locale)}: ${trimText(booking.item) || "-"}`,
    `${getMerchantBookingFieldText("appointmentAt", locale)}: ${formatBookingTimestamp(booking, locale) || "-"}`,
    `${getMerchantBookingFieldText("phone", locale)}: ${trimText(booking.phone) || "-"}`,
    `${getMerchantBookingFieldText("email", locale)}: ${trimText(booking.email) || "-"}`,
    `${getMerchantBookingCustomerEmailStatusLabel(locale)}: ${getMerchantBookingStatusText(status, locale)}`,
  ];
  if (trimText(booking.note)) {
    lines.push(`${getMerchantBookingFieldText("note", locale)}: ${trimText(booking.note)}`);
  }
  if (trimText(extraMessage)) {
    lines.push(`${getMerchantBookingCustomerEmailAdditionalMessageLabel(locale)}: ${trimText(extraMessage)}`);
  }
  return lines;
}

function buildStatusDetailsHtml(
  booking: MerchantBookingRecord,
  status: MerchantBookingStatus,
  locale: string,
  extraMessage?: string | null,
) {
  const rows = [
    [getMerchantBookingFieldText("bookingId", locale), trimText(booking.id) || "-"],
    [getMerchantBookingFieldText("store", locale), trimText(booking.store) || "-"],
    [getMerchantBookingFieldText("item", locale), trimText(booking.item) || "-"],
    [getMerchantBookingFieldText("appointmentAt", locale), formatBookingTimestamp(booking, locale) || "-"],
    [getMerchantBookingFieldText("phone", locale), trimText(booking.phone) || "-"],
    [getMerchantBookingFieldText("email", locale), trimText(booking.email) || "-"],
    [getMerchantBookingCustomerEmailStatusLabel(locale), getMerchantBookingStatusText(status, locale)],
  ];
  if (trimText(booking.note)) {
    rows.push([getMerchantBookingFieldText("note", locale), trimText(booking.note)]);
  }
  if (trimText(extraMessage)) {
    rows.push([getMerchantBookingCustomerEmailAdditionalMessageLabel(locale), trimText(extraMessage)]);
  }
  return rows
    .map(
      ([label, value]) =>
        `<p><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</p>`,
    )
    .join("");
}

function buildReminderDetailsLines(booking: MerchantBookingRecord, minutesBefore: number, locale: string) {
  const lines = [
    `${getMerchantBookingFieldText("bookingId", locale)}: ${trimText(booking.id) || "-"}`,
    `${getMerchantBookingFieldText("store", locale)}: ${trimText(booking.store) || "-"}`,
    `${getMerchantBookingFieldText("item", locale)}: ${trimText(booking.item) || "-"}`,
    `${getMerchantBookingFieldText("appointmentAt", locale)}: ${formatBookingTimestamp(booking, locale) || "-"}`,
    `${getMerchantBookingFieldText("phone", locale)}: ${trimText(booking.phone) || "-"}`,
    `${getMerchantBookingFieldText("email", locale)}: ${trimText(booking.email) || "-"}`,
    `${getMerchantBookingCustomerEmailReminderLabel(locale)}: ${buildMerchantBookingReminderOffsetLabel(minutesBefore, locale)}`,
  ];
  if (trimText(booking.note)) {
    lines.push(`${getMerchantBookingFieldText("note", locale)}: ${trimText(booking.note)}`);
  }
  return lines;
}

function buildReminderDetailsHtml(booking: MerchantBookingRecord, minutesBefore: number, locale: string) {
  const rows = [
    [getMerchantBookingFieldText("bookingId", locale), trimText(booking.id) || "-"],
    [getMerchantBookingFieldText("store", locale), trimText(booking.store) || "-"],
    [getMerchantBookingFieldText("item", locale), trimText(booking.item) || "-"],
    [getMerchantBookingFieldText("appointmentAt", locale), formatBookingTimestamp(booking, locale) || "-"],
    [getMerchantBookingFieldText("phone", locale), trimText(booking.phone) || "-"],
    [getMerchantBookingFieldText("email", locale), trimText(booking.email) || "-"],
    [getMerchantBookingCustomerEmailReminderLabel(locale), buildMerchantBookingReminderOffsetLabel(minutesBefore, locale)],
  ];
  if (trimText(booking.note)) {
    rows.push([getMerchantBookingFieldText("note", locale), trimText(booking.note)]);
  }
  return rows
    .map(
      ([label, value]) =>
        `<p><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</p>`,
    )
    .join("");
}

function buildActionLinkLines(
  locale: string,
  actionLinks?: MerchantBookingCustomerEmailOptions["actionLinks"],
) {
  const manageUrl = trimText(actionLinks?.manageUrl);
  const calendarUrl = trimText(actionLinks?.calendarUrl);
  if (!manageUrl && !calendarUrl) return [];
  const lines = [getMerchantBookingCustomerEmailActionLead(locale), ""];
  if (manageUrl) {
    lines.push(`${getMerchantBookingCustomerEmailManageActionLabel(locale)}: ${manageUrl}`);
  }
  if (calendarUrl) {
    lines.push(`${getMerchantBookingCustomerEmailCalendarActionLabel(locale)}: ${calendarUrl}`);
  }
  return lines;
}

function buildActionLinkHtml(
  locale: string,
  actionLinks?: MerchantBookingCustomerEmailOptions["actionLinks"],
) {
  const manageUrl = trimText(actionLinks?.manageUrl);
  const calendarUrl = trimText(actionLinks?.calendarUrl);
  if (!manageUrl && !calendarUrl) return "";
  const links: string[] = [];
  if (manageUrl) {
    links.push(
      `<a href="${escapeHtml(manageUrl)}" style="display:inline-block;margin:0 10px 10px 0;padding:10px 16px;border-radius:999px;background:#0f172a;color:#ffffff;text-decoration:none;font-weight:600;">${escapeHtml(getMerchantBookingCustomerEmailManageActionLabel(locale))}</a>`,
    );
  }
  if (calendarUrl) {
    links.push(
      `<a href="${escapeHtml(calendarUrl)}" style="display:inline-block;margin:0 10px 10px 0;padding:10px 16px;border-radius:999px;background:#e2e8f0;color:#0f172a;text-decoration:none;font-weight:600;">${escapeHtml(getMerchantBookingCustomerEmailCalendarActionLabel(locale))}</a>`,
    );
  }
  return [
    `<p>${escapeHtml(getMerchantBookingCustomerEmailActionLead(locale))}</p>`,
    `<div>${links.join("")}</div>`,
  ].join("");
}

async function sendPreparedMerchantBookingEmail(input: {
  booking: MerchantBookingRecord;
  locale?: string | null;
  senderName?: string | null;
  replyTo?: string | null;
  subject: string;
  text: string;
  html: string;
}, dependencies?: MerchantBookingEmailTransportDependencies): Promise<MerchantBookingConfirmationEmailSendResult> {
  const recipient = trimText(input.booking.email).toLowerCase();
  if (!recipient) {
    return {
      attempted: false,
      reason: "missing_email",
    };
  }

  const config = getMerchantBookingConfirmationEmailConfig();
  if (!config) {
    return {
      attempted: false,
      reason: "disabled",
    };
  }
  const requestedReplyTo = trimText(input.replyTo) || config.replyTo || "";
  const replyTo = normalizeMerchantBookingReplyTo(requestedReplyTo);
  if (requestedReplyTo && !replyTo) return { attempted: false, reason: "invalid_reply_to" };

  const attemptedAt = new Date().toISOString();
  const resolvedLocale = resolveMerchantBookingCustomerEmailLocale(input.locale);
  const resolvedSenderName = trimText(input.senderName);
  const result = await deliverMerchantBookingEmail({
    apiKey: config.apiKey,
    body: {
      from: buildFromValue(config.from, resolvedSenderName),
      to: [recipient],
      subject: input.subject,
      text: input.text,
      html: input.html,
      ...(replyTo ? { reply_to: replyTo } : {}),
    },
  }, dependencies);
  if (result.delivery !== "sent") {
    return {
      attempted: true,
      attemptedAt,
      status: "failed",
      error: result.error,
      ...(result.delivery === "unconfirmed" ? { deliveryUnconfirmed: true } : {}),
      ...(result.retryAfterSeconds ? { retryAfterSeconds: result.retryAfterSeconds } : {}),
      subject: input.subject,
      locale: resolvedLocale,
      senderName: resolvedSenderName,
    };
  }

  return {
    attempted: true,
    attemptedAt,
    status: "sent",
    messageId: result.messageId,
    subject: input.subject,
    locale: resolvedLocale,
    senderName: resolvedSenderName,
  };
}

export async function sendMerchantBookingStatusEmail(
  booking: MerchantBookingRecord,
  status: MerchantBookingStatus,
  options: MerchantBookingCustomerEmailOptions = {},
  dependencies?: MerchantBookingEmailTransportDependencies,
): Promise<MerchantBookingConfirmationEmailSendResult> {
  const locale = resolveMerchantBookingCustomerEmailLocale(options.locale);
  const merchantDisplayName = buildMerchantDisplayName(booking, locale, options.merchantDisplayName);
  const customerDisplayName = buildCustomerDisplayName(booking, locale);
  const extraMessage =
    trimText(options.extraMessage) || getMerchantBookingCustomerEmailDefaultStatusMessage(status, locale);
  const subject = getMerchantBookingCustomerEmailStatusSubject(status, merchantDisplayName, locale);
  const text = [
    `${getMerchantBookingCustomerEmailGreeting(locale)} ${customerDisplayName},`,
    "",
    getMerchantBookingCustomerEmailStatusLead(status, locale),
    "",
    ...buildStatusDetailsLines(booking, status, locale, extraMessage),
    "",
    ...buildActionLinkLines(locale, options.actionLinks),
    "",
    getMerchantBookingCustomerEmailContactMerchantLine(locale),
  ].join("\n");
  const html = [
    "<div style=\"font-family:Arial,sans-serif;line-height:1.6;color:#111827;\">",
    `<p>${escapeHtml(getMerchantBookingCustomerEmailGreeting(locale))} ${escapeHtml(customerDisplayName)},</p>`,
    `<p>${escapeHtml(getMerchantBookingCustomerEmailStatusLead(status, locale))}</p>`,
    buildStatusDetailsHtml(booking, status, locale, extraMessage),
    buildActionLinkHtml(locale, options.actionLinks),
    `<p>${escapeHtml(getMerchantBookingCustomerEmailContactMerchantLine(locale))}</p>`,
    "</div>",
  ].join("");
  return sendPreparedMerchantBookingEmail({
    booking,
    locale,
    senderName: options.senderName,
    replyTo: options.replyTo,
    subject,
    text,
    html,
  }, dependencies);
}

export async function sendMerchantBookingConfirmationEmail(
  booking: MerchantBookingRecord,
  options: MerchantBookingCustomerEmailOptions = {},
  dependencies?: MerchantBookingEmailTransportDependencies,
): Promise<MerchantBookingConfirmationEmailSendResult> {
  return sendMerchantBookingStatusEmail(booking, "confirmed", options, dependencies);
}

export async function sendMerchantBookingReminderEmail(
  booking: MerchantBookingRecord,
  minutesBefore: number,
  options: MerchantBookingCustomerEmailOptions = {},
  dependencies?: MerchantBookingEmailTransportDependencies,
): Promise<MerchantBookingConfirmationEmailSendResult> {
  const locale = resolveMerchantBookingCustomerEmailLocale(options.locale);
  const merchantDisplayName = buildMerchantDisplayName(booking, locale, options.merchantDisplayName);
  const customerDisplayName = buildCustomerDisplayName(booking, locale);
  const subject = getMerchantBookingCustomerReminderEmailSubject(merchantDisplayName, minutesBefore, locale);
  const text = [
    `${getMerchantBookingCustomerEmailGreeting(locale)} ${customerDisplayName},`,
    "",
    getMerchantBookingCustomerReminderLead(minutesBefore, locale),
    "",
    ...buildReminderDetailsLines(booking, minutesBefore, locale),
    "",
    ...buildActionLinkLines(locale, options.actionLinks),
    "",
    getMerchantBookingCustomerEmailContactMerchantLine(locale),
  ].join("\n");
  const html = [
    "<div style=\"font-family:Arial,sans-serif;line-height:1.6;color:#111827;\">",
    `<p>${escapeHtml(getMerchantBookingCustomerEmailGreeting(locale))} ${escapeHtml(customerDisplayName)},</p>`,
    `<p>${escapeHtml(getMerchantBookingCustomerReminderLead(minutesBefore, locale))}</p>`,
    buildReminderDetailsHtml(booking, minutesBefore, locale),
    buildActionLinkHtml(locale, options.actionLinks),
    `<p>${escapeHtml(getMerchantBookingCustomerEmailContactMerchantLine(locale))}</p>`,
    "</div>",
  ].join("");
  return sendPreparedMerchantBookingEmail({
    booking,
    locale,
    senderName: options.senderName,
    replyTo: options.replyTo,
    subject,
    text,
    html,
  }, dependencies);
}
