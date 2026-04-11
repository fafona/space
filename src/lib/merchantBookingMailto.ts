import type { MerchantBookingRecord } from "@/lib/merchantBookings";
import {
  formatMerchantBookingDateTime,
  formatMerchantBookingDisplayName,
  getMerchantBookingFieldText,
} from "@/lib/merchantBookingLocale";

function normalizeMailtoLine(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  return normalized || "-";
}

export function buildMerchantBookingMailtoHref(
  record: MerchantBookingRecord,
  locale: string,
  enablePrefill: boolean,
) {
  const email = String(record.email ?? "").trim();
  if (!email) return "";
  if (!enablePrefill) return `mailto:${email}`;

  const displayName = formatMerchantBookingDisplayName(record.customerName, record.title, locale);
  const subject = `${getMerchantBookingFieldText("detailTitle", locale)} - ${displayName}`;
  const body = [
    `${getMerchantBookingFieldText("bookingId", locale)}: ${normalizeMailtoLine(record.id)}`,
    `${getMerchantBookingFieldText("customerName", locale)}: ${normalizeMailtoLine(displayName)}`,
    `${getMerchantBookingFieldText("store", locale)}: ${normalizeMailtoLine(record.store)}`,
    `${getMerchantBookingFieldText("item", locale)}: ${normalizeMailtoLine(record.item)}`,
    `${getMerchantBookingFieldText("appointmentAt", locale)}: ${normalizeMailtoLine(record.appointmentAt.replace("T", " "))}`,
    `${getMerchantBookingFieldText("phone", locale)}: ${normalizeMailtoLine(record.phone)}`,
    `${getMerchantBookingFieldText("email", locale)}: ${normalizeMailtoLine(record.email)}`,
    `${getMerchantBookingFieldText("note", locale)}: ${normalizeMailtoLine(record.note)}`,
    `${getMerchantBookingFieldText("createdAt", locale)}: ${normalizeMailtoLine(
      formatMerchantBookingDateTime(record.createdAt, locale),
    )}`,
  ].join("\n");
  const query = new URLSearchParams({ subject, body }).toString();
  return `mailto:${email}?${query}`;
}
