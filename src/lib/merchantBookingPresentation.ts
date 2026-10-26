import type { MerchantBookingRecord } from "./merchantBookings";
import { isMerchantBookingTimeAllowed } from "./merchantBookings";
import type { MerchantBookingRulesSnapshot } from "./merchantBookingRules";

/** Preserve unsaved drafts; remote refreshes must never silently replace edits. */
export function mergeBookingDrafts<R extends { id: string }, T>(current: Record<string, T>, previous: R[], records: R[], create: (record: R) => T) {
  const before = new Map(previous.map((record) => [record.id, record]));
  return Object.fromEntries(records.map((record) => {
    const draft = current[record.id];
    const original = before.get(record.id);
    const dirty = draft !== undefined && (!original || JSON.stringify(draft) !== JSON.stringify(create(original)));
    return [record.id, dirty ? draft : create(record)];
  }));
}

export function bookingScheduleDays(anchor: string, view: "day" | "week") {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(anchor)) return [];
  const date = new Date(`${anchor}T12:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== anchor) return [];
  if (view === "week") date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
  return Array.from({ length: view === "day" ? 1 : 7 }, (_, offset) => {
    const day = new Date(date);
    day.setUTCDate(day.getUTCDate() + offset);
    return day.toISOString().slice(0, 10);
  });
}

export function mergeBookingRefreshRecords<R extends { id: string }, T>(previous: R[], incoming: R[], drafts: Record<string, T>, create: (record: R) => T) {
  const ids = new Set(incoming.map((record) => record.id));
  return [...incoming, ...previous.filter((record) => !ids.has(record.id) && drafts[record.id] !== undefined
    && JSON.stringify(drafts[record.id]) !== JSON.stringify(create(record)))];
}

export function bookingScheduleRecords(records: MerchantBookingRecord[], days: string[]) {
  return days.map((day) => ({ day, records: records.filter((record) => record.appointmentAt.slice(0, 10) === day)
    .sort((a, b) => a.appointmentAt.localeCompare(b.appointmentAt) || a.id.localeCompare(b.id)) }));
}

export function bookingDeliveryLabel(delivery: string | undefined, locale: string) {
  const es = locale.startsWith("es");
  switch (delivery) {
    case "queued": return es ? "en cola" : "排队中";
    case "skipped": return es ? "omitido (cita modificada o caducada)" : "已跳过（预约已变更或已过期）";
    case "failed": return es ? "falló" : "失败";
    case "unconfirmed": return es ? "sin confirmar" : "结果待确认";
    case "sent": return es ? "enviado" : "已发送";
    default: return es ? "estado desconocido" : "状态未知";
  }
}

export function bookingCapacitySummary(records: MerchantBookingRecord[], day: string, snapshot?: MerchantBookingRulesSnapshot | null) {
  return (snapshot?.entries ?? []).flatMap((entry) => entry.timeSlotRules.flatMap((slot) => {
    if (!slot.maxBookings) return [];
    return [{ key: `${entry.viewport}:${entry.blockId}:${slot.timeRange}`, timeRange: slot.timeRange, capacity: slot.maxBookings,
      occupied: records.filter((record) => record.bookingBlockId === entry.blockId && record.bookingViewport === entry.viewport
        && (record.status === "active" || record.status === "confirmed") && record.appointmentAt.slice(0, 10) === day
        && isMerchantBookingTimeAllowed(record.appointmentAt.slice(11, 16), [slot.timeRange])).length }];
  }));
}
