import assert from "node:assert/strict";
import test from "node:test";
import { parseEventNotificationsQuery, parseEventNotificationsHttpQuery, eventNotificationsQueryString, parseEventNotificationsBody,
  parseEventNotificationsJson, parseEventNotificationsResult, parseEventNotificationsDetail } from "./merchantAttendanceEventNotifications";
import { eventNotificationsQuery as query, eventNotificationsWire as wire, eventNotificationsDetail as detail, eventNotificationsItem as item,
  eventNotificationsId as id, eventNotificationsTime as time } from "../../scripts/fixtures/attendance-event-notifications-model";

test("exact six-key query, duplicate-free JSON and strict details/cursor/body", () => {
  assert.deepEqual(parseEventNotificationsHttpQuery("https://local/?" + eventNotificationsQueryString(query())), query());
  assert.deepEqual(parseEventNotificationsBody({ query: query(true), command: { action: "mark_read", notificationId: id(10) } }).query, query(true));
  for (const q of [{ ...query(), actorId: id(3) }, { ...query(), beforeAt: time }, { ...query(), notificationId: id(10) }, { ...query(true), beforeAt: time, beforeId: id(11) }]) assert.throws(() => parseEventNotificationsQuery(q));
  assert.throws(() => parseEventNotificationsHttpQuery("https://local/?" + eventNotificationsQueryString(query()) + "&siteId=98400200"));
  assert.throws(() => parseEventNotificationsJson('{"ok":true,"ok":false}'));
  for (const b of [{ query: query(), command: { action: "mark_read", notificationId: id(10) } }, { query: query(true), command: { action: "mark_read", notificationId: id(11) } }, { query: query(true), command: { action: "ack", notificationId: id(10) } }]) assert.throws(() => parseEventNotificationsBody(b));
});
test("three source namespaces may share an operation UUID without deduping distinct message UUIDs", () => {
  const r = wire(); r.items = [item("schedule", 12), item("work_arrangement", 11), item("plan_exception", 10)];
  assert.equal(parseEventNotificationsResult(r, query(), id(3)).items.length, 3);
  r.items[1].notificationId = r.items[0].notificationId; assert.throws(() => parseEventNotificationsResult(r, query()));
});
test("strict category snapshots preserve microseconds and saved zone without current Intl", () => {
  for (const kind of ["schedule", "work_arrangement", "plan_exception"] as const) { const d = detail(kind); assert.deepEqual(parseEventNotificationsDetail(d), d); }
  const d = detail("schedule"); if (d.sourceCategory !== "schedule") throw Error("fixture");
  d.summary.segments[0].startAt = "2026-10-07T09:00:00.000001Z"; d.summary.segments[0].endAt = "2026-10-07T09:00:00.000002Z"; assert.doesNotThrow(() => parseEventNotificationsDetail(d));
  d.summary.segments[0].endAt = d.summary.segments[0].startAt; assert.throws(() => parseEventNotificationsDetail(d));
  for (const change of [{ sourceRevision: 2 }, { type: "approved" }, { sourceId: id(99) }, { occurredAt: "2026-02-30T00:00:00.000000Z" }, { readAt: "2026-10-06T12:00:00.123455Z" }]) assert.throws(() => parseEventNotificationsDetail({ ...detail(), ...change }));
  assert.throws(() => parseEventNotificationsDetail({ ...detail("work_arrangement"), sourceRevision: 3 }));
  const p = detail("plan_exception"); assert.throws(() => parseEventNotificationsDetail({ ...p, summary: { ...p.summary, outcome: "follow_up" } }));
});
test("schedule 1..32 ordered unique segments; cancellation is exactly the saved slot", () => {
  const d = detail(); if (d.sourceCategory !== "schedule") throw Error("fixture"); const segment = d.summary.segments[0];
  d.summary.segments = Array.from({ length: 32 }, (_, n) => ({ ...segment, slotId: id(n + 40) })); assert.doesNotThrow(() => parseEventNotificationsDetail(d));
  for (const segments of [[], [...d.summary.segments, { ...segment, slotId: id(100) }], [segment, segment], [...d.summary.segments].reverse()]) assert.throws(() => parseEventNotificationsDetail({ ...d, summary: { segments } }));
  const cancel = { ...d, type: "cancelled", sourceId: segment.slotId, summary: { segments: [segment] } }; assert.doesNotThrow(() => parseEventNotificationsDetail(cancel));
  assert.throws(() => parseEventNotificationsDetail({ ...cancel, sourceId: id(90) }));
});
test("enum fields reject string-coercible arrays and objects", () => {
  for (const category of ["work_arrangement", "plan_exception"] as const) { const d = detail(category); assert.throws(() => parseEventNotificationsDetail({ ...d, type: [d.type] })); }
  const d = detail("work_arrangement"); assert.throws(() => parseEventNotificationsDetail({ ...d, summary: { ...d.summary, kind: ["remote"] } }));
});
test("25-row cursor pins final item and strict descending tuple; 26 is never silently clipped", () => {
  const r = wire(); r.items = Array.from({ length: 25 }, (_, n) => item("schedule", 100 - n)); r.nextCursor = { at: time, id: id(76) }; assert.equal(parseEventNotificationsResult(r, query()).items.length, 25);
  assert.throws(() => parseEventNotificationsResult({ ...r, nextCursor: { at: time, id: id(77) } }, query()));
  assert.throws(() => parseEventNotificationsResult({ ...r, items: [...r.items, item("schedule", 75)] }, query()));
  assert.throws(() => parseEventNotificationsResult(r, { ...query(), expectedWorkerId: id(4), beforeAt: time, beforeId: id(100) }));
});
test("current identity, mutually exclusive response shapes and POST read proof are mandatory", () => {
  const q = query(true), r = wire(q); for (const change of [{ actorId: id(99) }, { workerId: id(99) }, { employeeId: id(99) }, { siteId: "98400201" }, { items: [item()] }, { command: {} }, { detail: null }]) assert.throws(() => parseEventNotificationsResult({ ...r, ...change }, q, id(3)));
  assert.throws(() => parseEventNotificationsResult(r, q, id(3), { action: "mark_read", notificationId: id(10) }));
  r.detail!.readAt = time; assert.doesNotThrow(() => parseEventNotificationsResult(r, q, id(3), { action: "mark_read", notificationId: id(10) }));
  const empty = { ...wire(), workerId: null, items: [], canMarkRead: false }; assert.doesNotThrow(() => parseEventNotificationsResult(empty, query())); assert.throws(() => parseEventNotificationsResult({ ...empty, canMarkRead: true }, query()));
});
test("prototype, getter, sparse, extra tree fields and size are rejected without invoking getters", () => {
  let read = 0; const r = wire(); Object.defineProperty(r, "private", { enumerable: true, get: () => { read++; return true; } }); assert.throws(() => parseEventNotificationsResult(r, query())); assert.equal(read, 0);
  for (const raw of [{ ...wire(), items: new Array(1) }, { ...wire(), items: Object.assign([], { extra: 1 }) }, Object.assign(Object.create({ inherited: true }), wire()), { ...wire(), text: "x".repeat(131073) }]) assert.throws(() => parseEventNotificationsResult(raw, query()));
});
