import type { MerchantBookingRecord } from "./merchantBookings";

function trimText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function escapeIcsText(value: string) {
  return trimText(value)
    .replaceAll("\\", "\\\\")
    .replaceAll(";", "\\;")
    .replaceAll(",", "\\,")
    .replaceAll("\r\n", "\\n")
    .replaceAll("\n", "\\n");
}

function buildUtcStamp(date: Date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hour = String(date.getUTCHours()).padStart(2, "0");
  const minute = String(date.getUTCMinutes()).padStart(2, "0");
  const second = String(date.getUTCSeconds()).padStart(2, "0");
  return `${year}${month}${day}T${hour}${minute}${second}Z`;
}

function parseLocalBookingDateTime(value: string) {
  const normalized = trimText(value).replace(" ", "T");
  const matched = normalized.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!matched) return null;
  const year = Number.parseInt(matched[1] ?? "", 10);
  const month = Number.parseInt(matched[2] ?? "", 10);
  const day = Number.parseInt(matched[3] ?? "", 10);
  const hour = Number.parseInt(matched[4] ?? "", 10);
  const minute = Number.parseInt(matched[5] ?? "", 10);
  const parsed = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (
    !Number.isFinite(parsed.getTime()) ||
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day ||
    parsed.getHours() !== hour ||
    parsed.getMinutes() !== minute
  ) {
    return null;
  }
  return parsed;
}

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + Math.max(1, minutes) * 60 * 1000);
}

export function buildMerchantBookingsCalendarIcs(input: {
  siteName: string;
  siteId: string;
  bookings: MerchantBookingRecord[];
}) {
  const nowStamp = buildUtcStamp(new Date());
  const title = trimText(input.siteName) || trimText(input.siteId) || "Merchant bookings";
  const activeBookings = [...input.bookings]
    .filter((booking) => booking.status === "active" || booking.status === "confirmed")
    .sort((left, right) => left.appointmentAt.localeCompare(right.appointmentAt));

  const events = activeBookings
    .map((booking) => {
      const startDate = parseLocalBookingDateTime(booking.appointmentAt);
      if (!startDate) return "";
      const endDate = addMinutes(startDate, 60);
      const customerName = [trimText(booking.customerName), trimText(booking.title)].filter(Boolean).join(" ");
      const summary = escapeIcsText(
        [trimText(booking.item) || "预约", customerName || trimText(booking.store) || "客户预约"].join(" - "),
      );
      const descriptionLines = [
        `Booking ID: ${booking.id}`,
        `Store: ${trimText(booking.store) || "-"}`,
        `Item: ${trimText(booking.item) || "-"}`,
        `Customer: ${customerName || "-"}`,
        `Email: ${trimText(booking.email) || "-"}`,
        `Phone: ${trimText(booking.phone) || "-"}`,
      ];
      if (trimText(booking.note)) {
        descriptionLines.push(`Note: ${trimText(booking.note)}`);
      }
      const description = escapeIcsText(descriptionLines.join("\n"));
      return [
        "BEGIN:VEVENT",
        `UID:${escapeIcsText(`${booking.id}@${trimText(input.siteId) || "faolla"}`)}`,
        `DTSTAMP:${nowStamp}`,
        `DTSTART:${buildUtcStamp(startDate)}`,
        `DTEND:${buildUtcStamp(endDate)}`,
        `SUMMARY:${summary}`,
        `DESCRIPTION:${description}`,
        "END:VEVENT",
      ].join("\r\n");
    })
    .filter(Boolean);

  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//FAOLLA//Merchant Bookings//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeIcsText(title)}`,
    ...events,
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}
