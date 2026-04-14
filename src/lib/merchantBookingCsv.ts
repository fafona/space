import type { MerchantBookingRecord } from "@/lib/merchantBookings";
import {
  formatMerchantBookingDateTime,
  getMerchantBookingFieldText,
  getMerchantBookingStatusText,
} from "@/lib/merchantBookingLocale";

function escapeCsvValue(value: string) {
  const normalized = String(value ?? "");
  if (!/[",\n]/.test(normalized)) return normalized;
  return `"${normalized.replaceAll('"', '""')}"`;
}

export function buildMerchantBookingsCsv(records: MerchantBookingRecord[], locale: string) {
  const statusHeader = locale.startsWith("es") ? "Estado" : "状态";
  const headers = [
    getMerchantBookingFieldText("bookingId", locale),
    getMerchantBookingFieldText("store", locale),
    getMerchantBookingFieldText("item", locale),
    getMerchantBookingFieldText("appointmentAt", locale),
    getMerchantBookingFieldText("customerName", locale),
    getMerchantBookingFieldText("email", locale),
    getMerchantBookingFieldText("phone", locale),
    getMerchantBookingFieldText("note", locale),
    getMerchantBookingFieldText("createdAt", locale),
    statusHeader,
  ];
  const rows = records.map((record) => [
    record.id,
    record.store,
    record.item,
    formatMerchantBookingDateTime(record.appointmentAt, locale),
    record.customerName,
    record.email,
    record.phone,
    record.note,
    formatMerchantBookingDateTime(record.createdAt, locale),
    getMerchantBookingStatusText(record.status, locale),
  ]);
  return [headers, ...rows]
    .map((row) => row.map((cell) => escapeCsvValue(String(cell ?? ""))).join(","))
    .join("\n");
}
