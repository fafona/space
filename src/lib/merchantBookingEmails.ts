import { formatMerchantBookingDateTime, type MerchantBookingRecord } from "./merchantBookings";

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
    }
  | {
      attempted: true;
      attemptedAt: string;
      status: "failed";
      error: string;
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

function normalizeEnvValue(value: string | undefined) {
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

function normalizeDisplayValue(value: string) {
  return value.trim();
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function buildCustomerDisplayName(booking: MerchantBookingRecord) {
  return [normalizeDisplayValue(booking.customerName), normalizeDisplayValue(booking.title)].filter(Boolean).join(" ");
}

function buildMerchantDisplayName(booking: MerchantBookingRecord) {
  return normalizeDisplayValue(booking.siteName) || normalizeDisplayValue(booking.store) || "Faolla";
}

function buildConfirmationEmailSubject(booking: MerchantBookingRecord) {
  return `Booking confirmed - ${buildMerchantDisplayName(booking)}`;
}

function buildConfirmationEmailText(booking: MerchantBookingRecord) {
  const lines = [
    `Hello ${buildCustomerDisplayName(booking) || "Customer"},`,
    "",
    "Your booking has been confirmed.",
    "",
    `Booking ID: ${booking.id}`,
    `Store: ${booking.store}`,
    `Item: ${booking.item}`,
    `Appointment time: ${formatMerchantBookingDateTime(booking.appointmentAt)}`,
  ];
  if (booking.note.trim()) {
    lines.push(`Note: ${booking.note.trim()}`);
  }
  lines.push("", "If you need to change the booking, please contact the merchant.");
  return lines.join("\n");
}

function buildConfirmationEmailHtml(booking: MerchantBookingRecord) {
  const customerName = escapeHtml(buildCustomerDisplayName(booking) || "Customer");
  const bookingId = escapeHtml(booking.id);
  const store = escapeHtml(booking.store);
  const item = escapeHtml(booking.item);
  const appointmentAt = escapeHtml(formatMerchantBookingDateTime(booking.appointmentAt));
  const note = booking.note.trim() ? `<p><strong>Note:</strong> ${escapeHtml(booking.note.trim())}</p>` : "";
  return [
    "<div style=\"font-family:Arial,sans-serif;line-height:1.6;color:#111827;\">",
    `<p>Hello ${customerName},</p>`,
    "<p>Your booking has been confirmed.</p>",
    `<p><strong>Booking ID:</strong> ${bookingId}</p>`,
    `<p><strong>Store:</strong> ${store}</p>`,
    `<p><strong>Item:</strong> ${item}</p>`,
    `<p><strong>Appointment time:</strong> ${appointmentAt}</p>`,
    note,
    "<p>If you need to change the booking, please contact the merchant.</p>",
    "</div>",
  ].join("");
}

function parseResendErrorMessage(status: number, bodyText: string) {
  if (!bodyText.trim()) {
    return `resend_request_failed_${status}`;
  }
  try {
    const parsed = JSON.parse(bodyText) as ResendSendEmailResponse;
    const message = normalizeDisplayValue(parsed.message ?? parsed.error ?? "");
    if (message) {
      return message;
    }
  } catch {
    // Ignore JSON parse failures and fall back to the raw body text.
  }
  return bodyText.trim();
}

export async function sendMerchantBookingConfirmationEmail(
  booking: MerchantBookingRecord,
): Promise<MerchantBookingConfirmationEmailSendResult> {
  const recipient = normalizeDisplayValue(booking.email).toLowerCase();
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
  const response = await fetch(RESEND_EMAILS_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: config.from,
      to: [recipient],
      subject: buildConfirmationEmailSubject(booking),
      text: buildConfirmationEmailText(booking),
      html: buildConfirmationEmailHtml(booking),
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
    };
  }

  let messageId = "";
  if (responseText.trim()) {
    try {
      const parsed = JSON.parse(responseText) as ResendSendEmailResponse;
      messageId = normalizeDisplayValue(parsed.id ?? "");
    } catch {
      messageId = "";
    }
  }

  return {
    attempted: true,
    attemptedAt,
    status: "sent",
    ...(messageId ? { messageId } : {}),
  };
}
