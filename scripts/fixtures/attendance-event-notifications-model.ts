import type { EventNotificationsQuery, EventNotificationsItem, EventNotificationsDetail, EventNotificationsResult } from "../../src/lib/merchantAttendanceEventNotifications";

/** Pure DTO fixtures only: not real authentication, SQL or message delivery. */
export const eventNotificationsId = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const id = eventNotificationsId;
export const eventNotificationsTime = "2026-10-06T12:00:00.123456Z";
export function eventNotificationsQuery(detail = false): EventNotificationsQuery { return { siteId: "98400200", expectedEmployeeId: id(2), expectedWorkerId: detail ? id(4) : null,
  notificationId: detail ? id(10) : null, beforeAt: null, beforeId: null }; }
export function eventNotificationsItem(category: EventNotificationsItem["sourceCategory"] = "schedule", n = 10): EventNotificationsItem {
  const common = { notificationId: id(n), sourceOperationId: id(20), sourceId: category === "schedule" ? id(20) : id(30), occurredAt: eventNotificationsTime, readAt: null };
  return category === "schedule" ? { ...common, sourceCategory: category, sourceRevision: null, type: "published" }
    : category === "work_arrangement" ? { ...common, sourceCategory: category, sourceRevision: 2, type: "approved" }
      : { ...common, sourceCategory: category, sourceRevision: 1, type: "confirmed" };
}
export function eventNotificationsDetail(category: EventNotificationsItem["sourceCategory"] = "schedule", n = 10): EventNotificationsDetail {
  const item = eventNotificationsItem(category, n), span = { startAt: "2026-10-07T09:00:00.000000Z", endAt: "2026-10-07T17:00:00.000000Z", timeZone: "Historical/Zone" };
  return item.sourceCategory === "schedule" ? { ...item, summary: { segments: [{ slotId: id(40), ...span }] } }
    : item.sourceCategory === "work_arrangement" ? { ...item, summary: { kind: "remote", ...span } }
      : { ...item, summary: { slotId: id(40), ...span, outcome: item.type } };
}
export function eventNotificationsWire(q = eventNotificationsQuery(), category: EventNotificationsItem["sourceCategory"] = "schedule"): EventNotificationsResult {
  return { protocol: "event-notifications-v1", siteId: q.siteId, actorId: id(3), employeeId: q.expectedEmployeeId, workerId: id(4),
    items: q.notificationId === null ? [eventNotificationsItem(category)] : [], nextCursor: null,
    detail: q.notificationId === null ? null : { ...eventNotificationsDetail(category), notificationId: q.notificationId }, canMarkRead: true };
}
export function eventNotificationsHttp(q = eventNotificationsQuery(), category: EventNotificationsItem["sourceCategory"] = "schedule") { return { ok: true as const, ...eventNotificationsWire(q, category) }; }
