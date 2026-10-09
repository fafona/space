import assert from "node:assert/strict";
import test from "node:test";
import * as p from "./merchantAttendanceReminders";
import * as h from "./merchantAttendanceRemindersHttp";
const siteId = "99990201", actorId = "00000000-0000-4000-8000-000000000001", operationId = "00000000-0000-4000-8000-000000000003", batchId = "00000000-0000-4000-8000-000000000002";
const base = { siteId, batchId: null, operationId: null, cursor: null }, readAt = "2026-10-08T14:00:00.000000Z";
const query: p.AttendanceReminderQuery = { ...base, mode: "list" }, recover: p.AttendanceReminderQuery = { ...base, mode: "recover", operationId };
const command: p.AttendanceReminderCommand = { action: "mark_read", operationId, batchId };
const url = "https://www.faolla.com" + h.ATTENDANCE_REMINDERS_API;
test("201 HTTP GET unique request roundtrips only Auth queries; recover requires exact original command", () => {
  for (const input of [{ query, expectedCommand: null }, { query: recover, expectedCommand: command }, { query: { ...base, mode: "check" }, expectedCommand: null },
    { query: { ...base, mode: "detail", batchId }, expectedCommand: null }]) {
    const parsed = h.parseAttendanceReminderHttpRead(input); assert.deepEqual(h.parseAttendanceReminderHttpQuery(url + "?" + h.attendanceReminderHttpQueryString(parsed)), input); assert.ok(Object.isFrozen(parsed));
  }
  for (const input of [{ query: recover, expectedCommand: null }, { query, expectedCommand: command }, { query: recover, expectedCommand: { ...command, operationId: actorId } },
    { query, expectedCommand: null, actorId }, { query: { siteId, mode: "run", operationId, cursor: null }, expectedCommand: null }]) assert.throws(() => h.parseAttendanceReminderHttpRead(input));
});
test("201 HTTP GET rejects duplicate/foreign params, malformed escaped UTF8, fragments and request UTF8 overflow", () => {
  const encoded = h.attendanceReminderHttpQueryString({ query, expectedCommand: null });
  for (const value of [url, url + "?" + encoded + "&" + encoded, url + "?" + encoded + "&actorId=" + actorId, url + "?request=%ff", url + "?request=%", url + "?" + encoded + "#",
    url + "?request=" + encodeURIComponent('{"query":{},"\\u0071uery":{},"expectedCommand":null}'), url + "?request=" + encodeURIComponent(JSON.stringify("中".repeat(2800))), url + "?request=" + "a".repeat(32768)]) assert.throws(() => h.parseAttendanceReminderHttpQuery(value));
});
test("201 HTTP POST remains exact original DTO with no actor/system/recover-write variants", () => {
  const body = { query: { ...base, mode: "detail", batchId }, command }; assert.deepEqual(h.parseAttendanceReminderHttpBodyJson(JSON.stringify(body)), body);
  for (const input of [{ ...body, actorId }, { query: recover, command }, { query: { ...base, mode: "check" }, command: { action: "run_due", operationId, cursor: null, actorKind: "system" } }]) assert.throws(() => h.parseAttendanceReminderHttpBodyJson(JSON.stringify(input)));
  assert.throws(() => h.parseAttendanceReminderHttpBodyJson(JSON.stringify(body).replace('"command":', '"command":{},"command":')));
});
test("201 HTTP success envelope exact actor/result recheck has no module flag or private extra fields", async () => {
  const data: p.AttendanceReminderResult = { protocol: p.ATTENDANCE_REMINDERS_PROTOCOL, siteId, actor: { kind: "auth", authUserId: actorId }, readAt, data: { kind: "list", items: [], nextCursor: null }, receipt: null };
  const parsed = await h.parseAttendanceReminderHttpEnvelope({ ok: true, data }, query, actorId); assert.deepEqual(parsed, { ok: true, data }); assert.ok(Object.isFrozen(parsed)); assert.notEqual(parsed.data, data);
  for (const raw of [{ ok: true, data, moduleEnabled: true }, { ok: false, data }, { ok: true, data: { ...data, actor: { kind: "system" } } }, { ok: true, data: { ...data, source: {} } }, { ok: true, data: { ...data, siteId: "99990202" } }]) await assert.rejects(h.parseAttendanceReminderHttpEnvelope(raw, query, actorId), { code: "attendance_reminder_invalid" });
});
