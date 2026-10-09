import type { OwnerNotificationsQuery, OwnerNotificationsCommand, OwnerNotificationsItem, OwnerNotificationsResult } from "../../src/lib/merchantAttendanceOwnerNotifications";
export const ownerNoticeId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const ownerNoticeActor = ownerNoticeId(1);
export const ownerNoticeTime = "2026-10-08T10:00:00.000001Z";
export const ownerNoticeQuery = (mode: OwnerNotificationsQuery["mode"] = "list", patch: Partial<OwnerNotificationsQuery> = {}): OwnerNotificationsQuery => ({
  siteId: "99990001", mode, notificationId: mode === "list" ? null : ownerNoticeId(10), operationId: mode === "recover" ? ownerNoticeId(20) : null, beforeAt: null, beforeId: null, ...patch,
});
export const ownerNoticeCommand = (): OwnerNotificationsCommand => ({ action: "mark_read", operationId: ownerNoticeId(20), notificationId: ownerNoticeId(10) });
export const ownerNoticeItem = (category: "plan_exception" | "period" = "plan_exception"): OwnerNotificationsItem => ({
  notificationId: ownerNoticeId(10), sourceOperationId: ownerNoticeId(11), sourceId: ownerNoticeId(12), sourceRevision: 1,
  workerId: ownerNoticeId(4), employeeId: ownerNoticeId(5), employeeAuthUserId: ownerNoticeId(6), occurredAt: ownerNoticeTime, readAt: null,
  ...(category === "plan_exception" ? { sourceCategory: category, target: { slotId: ownerNoticeId(13) } }
    : { sourceCategory: category, target: { periodId: ownerNoticeId(12), fromDate: "2026-10-01", throughDate: "2026-10-07" } }),
});
export function ownerNoticeWire(query = ownerNoticeQuery(), command: OwnerNotificationsCommand | null = null): OwnerNotificationsResult {
  const base = { protocol: "owner-attendance-notifications-v1" as const, siteId: query.siteId, actorId: ownerNoticeActor };
  if (command || query.mode === "recover") return { ...base, kind: "receipt", receipt: { operationId: command?.operationId ?? query.operationId!, notificationId: query.notificationId!, actorId: ownerNoticeActor, readAt: ownerNoticeTime } };
  if (query.mode === "detail") return { ...base, kind: "detail", item: { ...ownerNoticeItem(), notificationId: query.notificationId! }, canMarkRead: true };
  return { ...base, kind: "list", items: [ownerNoticeItem()], nextCursor: null };
}
