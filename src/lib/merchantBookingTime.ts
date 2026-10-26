// Booking wall-clock values have no offset. An explicit IANA zone is required
// for new zoned records; absent zones retain legacy interpretation, without
// silently reinterpreting previously saved appointments.
const formatters = new Map<string, Intl.DateTimeFormat>();

export function normalizeBookingTimeZone(value: unknown): string {
  if (typeof value !== "string") return "";
  const zone = value.trim();
  if (zone.length > 100 || (zone !== "UTC" && !/^[A-Za-z_+-]+(?:\/[A-Za-z0-9_+-]+)+$/.test(zone))) return "";
  try {
    if (!formatters.has(zone)) {
      const formatter = new Intl.DateTimeFormat("en-GB", {
        timeZone: zone, calendar: "iso8601", numberingSystem: "latn",
        year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
      });
      if (formatters.size >= 64) formatters.delete(formatters.keys().next().value!);
      formatters.set(zone, formatter);
    }
    return zone;
  } catch { return ""; }
}

export function bookingWallTimeAt(instant: Date, timeZone: string) {
  const zone = normalizeBookingTimeZone(timeZone);
  if (!zone || !Number.isFinite(instant.getTime())) return "";
  const parts = formatters.get(zone)!.formatToParts(instant);
  const part = (type: string) => parts.find((value) => value.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}

export function parseBookingWallTime(value: string) {
  const normalized = typeof value === "string" ? value.trim().replace(" ", "T") : "";
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(normalized)) return null;
  const epoch = Date.parse(`${normalized}:00.000Z`);
  if (!Number.isFinite(epoch) || new Date(epoch).toISOString().slice(0, 16) !== normalized) return null;
  return { normalized, epoch };
}

export function parseBookingAppointment(value: string, timeZone?: string): Date | null {
  const wall = parseBookingWallTime(value);
  if (!wall) return null;
  if (!timeZone) {
    const legacy = new Date(wall.normalized);
    if (!Number.isFinite(legacy.getTime())) return null;
    const pad = (value: number) => String(value).padStart(2, "0");
    const roundTrip = `${legacy.getFullYear()}-${pad(legacy.getMonth() + 1)}-${pad(legacy.getDate())}T${pad(legacy.getHours())}:${pad(legacy.getMinutes())}`;
    return roundTrip === wall.normalized ? legacy : null;
  }
  const zone = normalizeBookingTimeZone(timeZone);
  if (!zone) return null;
  // Collect the offsets on both sides of a DST transition, then round-trip.
  // Gaps and repeated times are rejected rather than silently shifted/chosen.
  const candidates = new Set<number>();
  for (const hours of [-36, -24, -12, 0, 12, 24, 36]) {
    const probe = wall.epoch + hours * 3_600_000;
    const local = parseBookingWallTime(bookingWallTimeAt(new Date(probe), zone));
    if (!local) continue;
    const candidate = wall.epoch - (local.epoch - probe);
    if (bookingWallTimeAt(new Date(candidate), zone) === wall.normalized) candidates.add(candidate);
  }
  return candidates.size === 1 ? new Date([...candidates][0]) : null;
}

export function getCustomerBookingTimeIssue(appointmentAt: string, timeZone?: string, now = new Date()) {
  const appointment = parseBookingAppointment(appointmentAt, timeZone);
  if (!appointment) return "预约时间无效或处于夏令时切换的重复／缺失时段，请选择其他时间";
  return appointment.getTime() <= now.getTime() ? "预约时间已过，请选择之后的时间" : "";
}
