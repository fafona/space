import assert from "node:assert/strict";
import test from "node:test";
import { bookingWallTimeAt, normalizeBookingTimeZone, parseBookingAppointment, parseBookingWallTime } from "./merchantBookingTime";
import { getMerchantBookingAdvanceIssue, getMerchantBookingAutoStatusAtAppointmentTime, getMerchantBookingBufferIssue, getMerchantBookingDueReminderOffset, normalizeMerchantBookingWorkbenchSettings, shouldMarkMerchantBookingNoShow } from "./merchantBookingWorkbench";
import { buildMerchantBookingsCalendarIcs } from "./merchantBookingCalendar";
import type { MerchantBookingRecord } from "./merchantBookings";

test("IANA validation rejects invalid zones and invalid calendar dates", () => {
  assert.equal(Object.hasOwn(normalizeMerchantBookingWorkbenchSettings({}), "timeZone"), false, "loading legacy settings must not add a persisted field");
  assert.equal(normalizeBookingTimeZone("Europe/Madrid"), "Europe/Madrid");
  assert.equal(normalizeBookingTimeZone("+02:00"), "");
  assert.equal(normalizeBookingTimeZone("Not/AZone"), "");
  assert.equal(parseBookingWallTime("2026-02-30T10:00"), null);
  assert.equal(parseBookingWallTime("2026-01-01T24:00"), null);
});

test("explicit appointment conversion handles summer, winter, half-hour zones, gaps and repeated times", () => {
  assert.equal(parseBookingAppointment("2026-10-26T10:00", "Europe/Madrid")?.toISOString(), "2026-10-26T09:00:00.000Z");
  assert.equal(parseBookingAppointment("2026-07-01T10:00", "Europe/Madrid")?.toISOString(), "2026-07-01T08:00:00.000Z");
  assert.equal(parseBookingAppointment("2026-07-01T10:00", "Asia/Kolkata")?.toISOString(), "2026-07-01T04:30:00.000Z");
  assert.equal(parseBookingAppointment("2026-03-29T02:30", "Europe/Madrid"), null);
  assert.equal(parseBookingAppointment("2026-10-25T02:30", "Europe/Madrid"), null);
  assert.equal(bookingWallTimeAt(new Date("2026-10-26T09:00:00Z"), "Europe/Madrid"), "2026-10-26T10:00");
});

test("zoned advance, cutoff, reminders, auto-status and calendar do not depend on server TZ", () => {
  const original = process.env.TZ;
  try {
    for (const zone of ["Asia/Shanghai", "UTC", "America/New_York"]) {
      process.env.TZ = zone;
      const settings = normalizeMerchantBookingWorkbenchSettings({ timeZone: "Europe/Madrid", minAdvanceMinutes: 30, dailyCutoffTime: "09:30", appointmentAutoStatus: "completed" });
      const booking = { id: "synthetic", siteId: "99999999", siteName: "Synthetic", store: "Store", item: "Item", title: "Mx", customerName: "Test", email: "test@example.invalid", phone: "000", note: "", appointmentAt: "2026-10-26T10:00", appointmentTimeZone: "Europe/Madrid", status: "confirmed", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" } satisfies MerchantBookingRecord;
      const now = new Date("2026-10-26T08:00:00Z");
      assert.equal(getMerchantBookingAdvanceIssue(booking.appointmentAt, settings, now), "");
      assert.equal(getMerchantBookingAutoStatusAtAppointmentTime(booking, settings, now), null);
      assert.equal(getMerchantBookingDueReminderOffset(booking, [60], now), 60);
      assert.equal(shouldMarkMerchantBookingNoShow(booking, { noShowEnabled: true, noShowGraceMinutes: 30 }, now), false);
      assert.equal(shouldMarkMerchantBookingNoShow(booking, { noShowEnabled: true, noShowGraceMinutes: 30 }, new Date("2026-10-26T09:30:00Z")), true);
      assert.match(getMerchantBookingBufferIssue({ ...booking, appointmentAt: "2026-03-29T03:00" }, 60, [{ ...booking, id: "other", appointmentAt: "2026-03-29T01:30" }]), /间隔/);
      assert.match(getMerchantBookingAdvanceIssue("2026-10-26T12:00", settings, new Date("2026-10-26T09:00:00Z")), /截止/);
      assert.match(buildMerchantBookingsCalendarIcs({ siteName: "Synthetic", siteId: "99999999", bookings: [booking] }), /DTSTART:20261026T090000Z/);
    }
  } finally { if (original === undefined) delete process.env.TZ; else process.env.TZ = original; }
});
