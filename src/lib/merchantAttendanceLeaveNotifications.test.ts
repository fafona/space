import assert from "node:assert/strict";
import test from "node:test";
import { NOTIFICATION_ERRORS, notificationQueryString, parseNotificationBody, parseNotificationCommand,
  parseNotificationDetail, parseNotificationHttpQuery, parseNotificationItem, parseNotificationQuery,
  parseNotificationResponse, parseNotificationResult, type NotificationCommand, type NotificationDetail,
  type NotificationItem, type NotificationQuery, type NotificationsResult } from "./merchantAttendanceLeaveNotifications";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const siteId = "99990001", employeeId = id(101), workerId = id(201), actorId = id(99);
const query = (): NotificationQuery => ({ siteId, expectedEmployeeId: employeeId, expectedWorkerId: null,
  notificationId: null, beforeAt: null, beforeId: null });
const item = (n = 501): NotificationItem => ({ notificationId: id(n), requestId: id(401), revision: 2, type: "approved",
  decidedAt: "2026-10-04T09:00:00.123456Z", startAt: "2026-10-05T07:00:00.000Z", endAt: "2026-10-05T15:00:00.000Z",
  timeZone: "Europe/Madrid", readAt: null });
const detail = (n = 501): NotificationDetail => ({ ...item(n), currentStatus: "approved", currentRevision: 2 });
const result = (): NotificationsResult => ({ protocol: "leave-notifications-v1", siteId, actorId, employeeId, workerId,
  items: [], nextCursor: null, detail: null });
const selected = (): NotificationQuery => ({ ...query(), expectedWorkerId: workerId, notificationId: id(501) });
const command: NotificationCommand = { action: "mark_read", notificationId: id(501) };
const without = (value: object, key: string) => Object.fromEntries(Object.entries(value).filter(([name]) => name !== key));

test("notification queries are exact and bind employee, worker, detail and six-digit keyset independently", () => {
  assert.deepEqual(parseNotificationQuery(query()), query());
  assert.deepEqual(parseNotificationHttpQuery(`https://fixture.invalid/?${notificationQueryString(query())}`), query());
  const paged = { ...query(), expectedWorkerId: workerId, beforeAt: item().decidedAt, beforeId: id(501) };
  assert.deepEqual(parseNotificationQuery(paged), paged);
  assert.deepEqual(parseNotificationQuery(selected()), selected());
  for (const key of Object.keys(query())) assert.throws(() => parseNotificationQuery(without(query(), key)), key);
  for (const patch of [{ siteId: "all" }, { expectedEmployeeId: null }, { expectedWorkerId: "bad" }, { actorId },
    { employeeId }, { limit: 500 }, { beforeAt: item().decidedAt }, { beforeId: id(501) }, { notificationId: id(501) },
    { ...paged, expectedWorkerId: null }, { ...paged, notificationId: id(501) },
    { ...paged, beforeAt: "2026-10-04T09:00:00.123Z" }, { ...paged, beforeAt: "2026-02-30T09:00:00.123456Z" }])
    assert.throws(() => parseNotificationQuery({ ...query(), ...patch }), JSON.stringify(patch));
  for (const suffix of [`&siteId=${siteId}`, `&expectedEmployeeId=${employeeId}`, `&actorId=${actorId}`,
    `&workerId=${workerId}`, "&unread=true", "&limit=25"])
    assert.throws(() => parseNotificationHttpQuery(`https://fixture.invalid/?${notificationQueryString(query())}${suffix}`));
});

test("mark-read has one stable notification identity and no generated operation or additional authority", () => {
  assert.deepEqual(parseNotificationCommand(command), command);
  assert.deepEqual(parseNotificationBody({ query: selected(), command }), { query: selected(), command });
  for (const bad of [{ ...command, operationId: id(601) }, { ...command, actorId }, { ...command, action: "mark_all_read" },
    { ...command, notificationId: null }, without(command, "action"), without(command, "notificationId")])
    assert.throws(() => parseNotificationCommand(bad));
  for (const bad of [{ query: query(), command }, { query: { ...selected(), notificationId: id(502) }, command },
    { query: { ...selected(), expectedWorkerId: null }, command }, { query: selected(), command, allowWrite: true },
    { query: selected(), command, authUserId: actorId }, { query: { ...selected(), beforeAt: item().decidedAt, beforeId: id(502) }, command }])
    assert.throws(() => parseNotificationBody(bad));
});

test("notification items exclude reasons and identities and retain exact event type/revision/time invariants", () => {
  assert.deepEqual(parseNotificationItem(item()), item());
  for (const [type, revision] of [["approved", 2], ["rejected", 2], ["approval_cancelled", 3]] as const)
    assert.equal(parseNotificationItem({ ...item(), type, revision }).type, type);
  for (const key of Object.keys(item())) assert.throws(() => parseNotificationItem(without(item(), key)), key);
  for (const patch of [{ reason: "private" }, { workerId }, { actorId }, { employeeId }, { workerName: "Private name" },
    { revision: 1 }, { revision: 3 }, { type: "approved", revision: 3 }, { type: "approval_cancelled", revision: 2 },
    { type: "cancelled" }, { decidedAt: "2026-10-04T09:00:00.123Z" }, { decidedAt: "2026-02-30T09:00:00.123456Z" },
    { readAt: "2026-10-04T09:00:00.123455Z" }, { readAt: "2026-10-04T09:00:00.123Z" },
    { endAt: item().startAt }, { startAt: "2026-10-05T07:00:01.000Z" }, { timeZone: "Bad/Zone" }])
    assert.throws(() => parseNotificationItem({ ...item(), ...patch }), JSON.stringify(patch));
  assert.equal(parseNotificationItem({ ...item(), readAt: item().decidedAt }).readAt, item().decidedAt);
});

test("detail separates the historical decision from the current request status without inventing current approval", () => {
  assert.deepEqual(parseNotificationDetail(detail()), detail());
  const cancelled = { ...detail(), currentStatus: "cancelled", currentRevision: 3 };
  assert.equal(parseNotificationDetail(cancelled).type, "approved");
  assert.equal(parseNotificationDetail({ ...cancelled, type: "approval_cancelled", revision: 3 }).currentStatus, "cancelled");
  assert.equal(parseNotificationDetail({ ...detail(), type: "rejected", currentStatus: "rejected" }).currentStatus, "rejected");
  for (const patch of [{ currentStatus: "submitted" }, { currentStatus: "rejected" }, { currentStatus: "cancelled" },
    { currentRevision: 3 }, { currentStatus: "approved", currentRevision: 3 }, { reason: "private" }, { canCancel: true },
    { type: "rejected", currentStatus: "cancelled", currentRevision: 3 },
    { type: "approval_cancelled", revision: 3, currentStatus: "approved", currentRevision: 2 }])
    assert.throws(() => parseNotificationDetail({ ...detail(), ...patch }), JSON.stringify(patch));
  for (const key of Object.keys(detail())) assert.throws(() => parseNotificationDetail(without(detail(), key)), key);
});

test("envelopes pin auth actor separately from the enterprise employee and enforce exact HTTP flags", () => {
  assert.deepEqual(parseNotificationResult(result(), query(), null, actorId), result());
  assert.notEqual(actorId, employeeId);
  assert.equal(parseNotificationResponse({ ok: true, moduleEnabled: false, ...result() }, query()).moduleEnabled, false);
  for (const key of Object.keys(result())) assert.throws(() => parseNotificationResult(without(result(), key), query()), key);
  for (const patch of [{ actorId: id(98) }, { siteId: "99990002" }, { employeeId: actorId }, { employeeId: id(102) },
    { protocol: "leave-v1" }, { employeeId: null }, { unreadCount: 1 }, { privateData: "x" }])
    assert.throws(() => parseNotificationResult({ ...result(), ...patch }, query(), null, actorId));
  for (const patch of [{ ok: false }, { ok: "true" }, { moduleEnabled: "false" }, { moduleEnabled: null }, { extra: true }])
    assert.throws(() => parseNotificationResponse({ ok: true, moduleEnabled: true, ...result(), ...patch }, query()));
  assert.throws(() => parseNotificationResponse({ ok: true, ...result() }, query()));
  assert.throws(() => parseNotificationResult({ ...result(), workerId: id(202) }, { ...query(), expectedWorkerId: workerId }));
  assert.deepEqual(parseNotificationResult({ ...result(), workerId: null }, query()), { ...result(), workerId: null });
  for (const patch of [{ items: [item()] }, { detail: detail() }, { nextCursor: { at: item().decidedAt, id: id(501) } }])
    assert.throws(() => parseNotificationResult({ ...result(), workerId: null, ...patch }, query()));
});

test("notification lists are bounded to 25, strictly descend by decision time and ID and expose only a matching final cursor", () => {
  const items = Array.from({ length: 25 }, (_, i) => item(550 - i));
  const value = { ...result(), items, nextCursor: { at: items[24].decidedAt, id: items[24].notificationId } };
  assert.deepEqual(parseNotificationResult(value, query()), value);
  for (const patch of [{ items: [...items, item(525)] }, { items: [...items].reverse() }, { items: [item(), item()], nextCursor: null },
    { items: items.slice(1) }, { nextCursor: { ...value.nextCursor, id: id(527) } }, { nextCursor: { ...value.nextCursor, extra: true } },
    { detail: detail() }]) assert.throws(() => parseNotificationResult({ ...value, ...patch }, query()));
  const microsecond = [{ ...item(500), decidedAt: "2026-10-04T09:00:00.123457Z" }, item(501)];
  assert.equal(parseNotificationResult({ ...result(), items: microsecond }, query()).items[0].notificationId, id(500));
  const paged = { ...query(), expectedWorkerId: workerId, beforeAt: item().decidedAt, beforeId: id(501) };
  assert.throws(() => parseNotificationResult({ ...result(), items: [item()] }, paged));
  assert.equal(parseNotificationResult({ ...result(), items: [item(500)] }, paged).items[0].notificationId, id(500));
  assert.throws(() => parseNotificationResult({ ...result(), items: [{ ...item(501), decidedAt: "2026-10-04T09:00:00.123457Z" }] }, paged));
});

test("detail and POST envelopes are exact, query-bound and POST proves a non-null canonical first read time", () => {
  const value = { ...result(), detail: detail() };
  assert.deepEqual(parseNotificationResult(value, selected()), value);
  for (const patch of [{ detail: null }, { detail: detail(502) }, { items: [item()] },
    { nextCursor: { at: item().decidedAt, id: id(501) } }])
    assert.throws(() => parseNotificationResult({ ...value, ...patch }, selected()));
  assert.throws(() => parseNotificationResult(value, query()));
  assert.throws(() => parseNotificationResult(value, selected(), command));
  const read = { ...value, detail: { ...detail(), readAt: "2026-10-04T10:00:00.000001Z" } };
  assert.deepEqual(parseNotificationResult(read, selected(), command, actorId), read);
  assert.throws(() => parseNotificationResult(read, selected(), { ...command, notificationId: id(502) }));
});

test("notification error allowlist has the contract statuses and no old leave decision errors", () => {
  const expected = { attendance_notification_not_found: 404, attendance_notification_invalid: 503, attendance_worker_changed: 409,
    attendance_access_denied: 403, attendance_settings_required: 409, attendance_platform_paused: 403,
    attendance_invalid_request: 400, attendance_unavailable: 503, attendance_rate_limited: 429, attendance_not_available: 404,
    attendance_body_too_large: 413, attendance_invalid_content_type: 415 };
  for (const [code, status] of Object.entries(expected)) assert.equal(NOTIFICATION_ERRORS[code], status);
  assert.equal(Object.hasOwn(NOTIFICATION_ERRORS, "attendance_leave_invalid"), false);
});
