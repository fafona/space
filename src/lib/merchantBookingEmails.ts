import {
  buildMerchantBookingReminderOffsetLabel,
  getMerchantBookingCustomerEmailAdditionalMessageLabel,
  getMerchantBookingCustomerEmailContactMerchantLine,
  getMerchantBookingCustomerEmailCustomerFallback,
  getMerchantBookingCustomerEmailGreeting,
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

const RESEND_EMAILS_API_URL = "https://api.resend.com/emails";

export type MerchantBookingConfirmationEmailSendResult =
  | {
      attempted: false;
      reason: "disabled" | "missing_email";
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
      subject?: string;
      locale?: string;
      senderName?: string;
    };

type MerchantBookingConfirmationEmailConfig = {
  apiKey: string;
  from: string;
  replyTo?: string;
};

type ResendSendEmailResponse = {
  id?: string;
  message?: string;
  error?: string;
};

type MerchantBookingCustomerEmailOptions = {
  locale?: string | null;
  senderName?: string | null;
  merchantDisplayName?: string | null;
  extraMessage?: string | null;
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

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function parseResendErrorMessage(status: number, bodyText: string) {
  if (!bodyText.trim()) {
    return `resend_request_failed_${status}`;
  }
  try {
    const parsed = JSON.parse(bodyText) as ResendSendEmailResponse;
    const message = trimText(parsed.message ?? parsed.error ?? "");
    if (message) {
      return message;
    }
  } catch {
    // Ignore JSON parse failures and fall back to the raw body text.
  }
  return bodyText.trim();
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
  return formatMerchantBookingDateTime(booking.appointmentAt, locale);
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

async function sendPreparedMerchantBookingEmail(input: {
  booking: MerchantBookingRecord;
  locale?: string | null;
  senderName?: string | null;
  subject: string;
  text: string;
  html: string;
}): Promise<MerchantBookingConfirmationEmailSendResult> {
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

  const attemptedAt = new Date().toISOString();
  const resolvedLocale = resolveMerchantBookingCustomerEmailLocale(input.locale);
  const resolvedSenderName = trimText(input.senderName);
  const response = await fetch(RESEND_EMAILS_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: buildFromValue(config.from, resolvedSenderName),
      to: [recipient],
      subject: input.subject,
      text: input.text,
      html: input.html,
      ...(config.replyTo ? { reply_to: config.replyTo } : {}),
    }),
  });

  const responseText = await response.text();
  if (!response.ok) {
    return {
      attempted: true,
      attemptedAt,
      status: "failed",
      error: parseResendErrorMessage(response.status, responseText),
      subject: input.subject,
      locale: resolvedLocale,
      senderName: resolvedSenderName,
    };
  }

  let messageId = "";
  if (responseText.trim()) {
    try {
      const parsed = JSON.parse(responseText) as ResendSendEmailResponse;
      messageId = trimText(parsed.id ?? "");
    } catch {
      messageId = "";
    }
  }

  return {
    attempted: true,
    attemptedAt,
    status: "sent",
    ...(messageId ? { messageId } : {}),
    subject: input.subject,
    locale: resolvedLocale,
    senderName: resolvedSenderName,
  };
}

export async function sendMerchantBookingStatusEmail(
  booking: MerchantBookingRecord,
  status: MerchantBookingStatus,
  options: MerchantBookingCustomerEmailOptions = {},
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
    getMerchantBookingCustomerEmailContactMerchantLine(locale),
  ].join("\n");
  const html = [
    "<div style=\"font-family:Arial,sans-serif;line-height:1.6;color:#111827;\">",
    `<p>${escapeHtml(getMerchantBookingCustomerEmailGreeting(locale))} ${escapeHtml(customerDisplayName)},</p>`,
    `<p>${escapeHtml(getMerchantBookingCustomerEmailStatusLead(status, locale))}</p>`,
    buildStatusDetailsHtml(booking, status, locale, extraMessage),
    `<p>${escapeHtml(getMerchantBookingCustomerEmailContactMerchantLine(locale))}</p>`,
    "</div>",
  ].join("");
  return sendPreparedMerchantBookingEmail({
    booking,
    locale,
    senderName: options.senderName,
    subject,
    text,
    html,
  });
}

export async function sendMerchantBookingConfirmationEmail(
  booking: MerchantBookingRecord,
  options: MerchantBookingCustomerEmailOptions = {},
): Promise<MerchantBookingConfirmationEmailSendResult> {
  return sendMerchantBookingStatusEmail(booking, "confirmed", options);
}

export async function sendMerchantBookingReminderEmail(
  booking: MerchantBookingRecord,
  minutesBefore: number,
  options: MerchantBookingCustomerEmailOptions = {},
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
    getMerchantBookingCustomerEmailContactMerchantLine(locale),
  ].join("\n");
  const html = [
    "<div style=\"font-family:Arial,sans-serif;line-height:1.6;color:#111827;\">",
    `<p>${escapeHtml(getMerchantBookingCustomerEmailGreeting(locale))} ${escapeHtml(customerDisplayName)},</p>`,
    `<p>${escapeHtml(getMerchantBookingCustomerReminderLead(minutesBefore, locale))}</p>`,
    buildReminderDetailsHtml(booking, minutesBefore, locale),
    `<p>${escapeHtml(getMerchantBookingCustomerEmailContactMerchantLine(locale))}</p>`,
    "</div>",
  ].join("");
  return sendPreparedMerchantBookingEmail({
    booking,
    locale,
    senderName: options.senderName,
    subject,
    text,
    html,
  });
}
