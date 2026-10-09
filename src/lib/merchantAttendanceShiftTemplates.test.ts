import assert from "node:assert/strict";
import test from "node:test";
import { executeShiftTemplates } from "./merchantAttendanceShiftTemplates.server";
import { parseShiftTemplate, parseShiftTemplateCommand, parseShiftTemplateItem, parseShiftTemplatesBody,
  parseShiftTemplatesHttpQuery, parseShiftTemplatesQuery, parseShiftTemplatesResponse, parseShiftTemplatesResult,
  shiftTemplatesQueryString, templateDaySlots, templateNominalMinutes,
  type ShiftTemplate, type ShiftTemplateCommand, type ShiftTemplateItem, type ShiftTemplatesQuery, type ShiftTemplatesResult } from "./merchantAttendanceShiftTemplates";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const template: ShiftTemplate = { name: "Split shift", segments: [
  { start: "09:00", end: "13:00", nextDay: false }, { start: "14:00", end: "18:00", nextDay: false },
] };
const query: ShiftTemplatesQuery = { siteId: "99990001", view: "active", cursorId: null, operationId: null };
const command: ShiftTemplateCommand = { operationId: id(1), templateId: id(1), expectedRevision: 0, action: "save", template };
const item = (n = 1): ShiftTemplateItem => ({ templateId: id(n), revision: 1, template, archived: false, updatedAt: "2026-10-03T09:00:00.123456Z" });
const result = (): ShiftTemplatesResult => ({ siteId: query.siteId, view: "active", items: [], nextCursor: null, receipt: null });

test("template exact schemas contain only a bounded name and 1–4 wall-clock segments, never location/calendar authority", () => {
  assert.deepEqual(parseShiftTemplate(template), template);
  assert.deepEqual(templateDaySlots(template), template.segments);
  for (const invalid of [null, [], {}, { ...template, timeZone: "Europe/Madrid" }, { ...template, weekdays: [1] },
    { ...template, workerId: id(2) }, { ...template, name: " " }, { ...template, name: " leading" },
    { ...template, name: "bad\nname" }, { ...template, name: "🙂".repeat(81) },
    { ...template, segments: [] }, { ...template, segments: Array(5).fill(template.segments[0]) },
    { ...template, segments: [{ ...template.segments[0], timeZone: "UTC" }] },
    { ...template, segments: [{ start: "09:00", end: "13:00" }] }]) assert.throws(() => parseShiftTemplate(invalid));
  assert.equal(parseShiftTemplate({ ...template, name: "🙂".repeat(80) }).name.length, 160);
});

test("wall clocks require chronological nonoverlap, accept touching and overnight spans, and cap each span at 24 hours", () => {
  assert.equal(templateNominalMinutes(template), 480);
  for (const [segments, minutes] of [
    [[{ start: "22:00", end: "06:00", nextDay: true }], 480],
    [[{ start: "09:00", end: "09:00", nextDay: true }], 1440],
    [[{ start: "09:00", end: "13:00", nextDay: false }, { start: "13:00", end: "17:00", nextDay: false }], 480],
  ] as [ShiftTemplate["segments"], number][]) assert.equal(templateNominalMinutes({ name: "Valid", segments }), minutes);
  for (const segments of [
    [{ start: "9:00", end: "13:00", nextDay: false }], [{ start: "09:00:00", end: "13:00", nextDay: false }],
    [{ start: "09:00", end: "24:00", nextDay: false }], [{ start: "09:00", end: "09:60", nextDay: false }],
    [{ start: "09:00", end: "09:00", nextDay: false }], [{ start: "22:00", end: "06:00", nextDay: false }],
    [{ start: "09:00", end: "10:00", nextDay: true }], [{ start: "09:00", end: "13:00", nextDay: "false" }],
    [template.segments[1], template.segments[0]], [template.segments[0], { start: "12:00", end: "14:00", nextDay: false }],
    [{ start: "22:00", end: "06:00", nextDay: true }, { start: "07:00", end: "08:00", nextDay: false }],
  ]) assert.throws(() => parseShiftTemplate({ name: "Invalid", segments }));
});

test("query/body contracts reject duplicated or unknown fields and cannot combine pagination with receipt recovery", () => {
  const url = `https://fixture.invalid/?${shiftTemplatesQueryString(query)}`;
  assert.deepEqual(parseShiftTemplatesHttpQuery(url), query);
  assert.deepEqual(parseShiftTemplatesBody({ query, command }), { query, command });
  for (const suffix of ["&siteId=99990002", "&allowWrite=true", "&view=archived", "&timeZone=UTC"])
    assert.throws(() => parseShiftTemplatesHttpQuery(url + suffix));
  for (const patch of [{ siteId: "x" }, { view: "all" }, { cursorId: id(2), operationId: id(3) }, { operationId: "not-uuid" }])
    assert.throws(() => parseShiftTemplatesQuery({ ...query, ...patch }));
  for (const invalid of [{ query, command, allowWrite: true }, { query: { ...query, cursorId: id(2) }, command },
    { query: { ...query, operationId: id(2) }, command }]) assert.throws(() => parseShiftTemplatesBody(invalid));
});

test("new saves bind IDs, updates and archives require bounded revisions, and item timestamps retain six microsecond digits", () => {
  assert.deepEqual(parseShiftTemplateCommand(command), command);
  const archive = { ...command, action: "archive", template: null, expectedRevision: 1 };
  assert.deepEqual(parseShiftTemplateCommand(archive), archive);
  for (const patch of [{ templateId: id(2) }, { expectedRevision: -1 }, { expectedRevision: 0.1 },
    { expectedRevision: Number.MAX_SAFE_INTEGER }, { operationId: "bad" }, { actorId: id(2) },
    { action: "archive", template: null }, { action: "archive", expectedRevision: 1 }])
    assert.throws(() => parseShiftTemplateCommand({ ...command, ...patch }));
  assert.deepEqual(parseShiftTemplateItem(item()), item());
  for (const patch of [{ revision: 0 }, { archived: 0 }, { updatedAt: "2026-10-03T09:00:00.123Z" },
    { updatedAt: "2026-02-30T09:00:00.123456Z" }, { updatedAt: "2026-10-03T09:00:00.123456+00:00" }, { privateData: "x" }])
    assert.throws(() => parseShiftTemplateItem({ ...item(), ...patch }));
});

test("receipt is the original immutable operation snapshot, not the independently newer current list item", () => {
  const snapshot = item(), current = { ...snapshot, revision: 3, template: { ...template, name: "Newer" } };
  const value = { ...result(), items: [current], receipt: { command, item: snapshot } };
  const parsed = parseShiftTemplatesResult(value, { ...query, operationId: command.operationId });
  assert.equal(parsed.receipt?.item.revision, 1); assert.equal(parsed.items[0].revision, 3);
  assert.deepEqual(parseShiftTemplatesResult(value, query, command), value);
  for (const receipt of [null, { command: { ...command, operationId: id(2) }, item: snapshot },
    { command, item: current }, { command, item: { ...snapshot, archived: true } },
    { command, item: { ...snapshot, template: { ...template, name: "Not the saved content" } } },
    { command, item: snapshot, replayed: true }]) assert.throws(() => parseShiftTemplatesResult({ ...value, receipt }, query, command));
});

test("20-item descending keyset pages enforce cursor, scope, archived view and the exact HTTP envelope", () => {
  const items = Array.from({ length: 20 }, (_, i) => item(30 - i));
  const page = { ...result(), items, nextCursor: id(11) };
  assert.deepEqual(parseShiftTemplatesResult(page, query), page);
  assert.deepEqual(parseShiftTemplatesResult({ ...result(), items: [item(10)] }, { ...query, cursorId: id(11) }).items, [item(10)]);
  assert.equal(parseShiftTemplatesResponse({ ok: true, moduleEnabled: false, ...page }, query).moduleEnabled, false);
  for (const patch of [{ items: [...items, item(10)] }, { items: [...items].reverse() }, { items: [item(2), item(2)], nextCursor: null },
    { nextCursor: id(12) }, { items: items.slice(1) }, { siteId: "99990002" }, { view: "archived" }])
    assert.throws(() => parseShiftTemplatesResult({ ...page, ...patch }, query));
  assert.throws(() => parseShiftTemplatesResult({ ...result(), items: [item(11)] }, { ...query, cursorId: id(11) }));
  for (const patch of [{ moduleEnabled: 1 }, { ok: false }, { extra: true }])
    assert.throws(() => parseShiftTemplatesResponse({ ok: true, moduleEnabled: true, ...result(), ...patch }, query));
});

test("server passes authenticated identity and paused write authority only to the fixed RPC and validates every reply", async () => {
  const input = { query, command: null, authUserId: id(90), allowWrite: false };
  assert.deepEqual(await executeShiftTemplates(input, { rpc: async (name, args) => {
    assert.equal(name, "faolla_attendance_shift_templates_v1");
    assert.deepEqual(args, { p_query: query, p_auth_user_id: id(90), p_command: null, p_allow_write: false });
    return { data: result(), error: null };
  } }), result());
  for (const data of [{ ...result(), secret: "not allowed" }, { ...result(), siteId: "99990002" }])
    await assert.rejects(executeShiftTemplates(input, { rpc: async () => ({ data, error: null }) }), /attendance_unavailable/);
  await assert.rejects(executeShiftTemplates({ ...input, command }, { rpc: async () => ({ data: result(), error: null }) }), /attendance_unavailable/);
  await assert.rejects(executeShiftTemplates(input, null), /attendance_unavailable/);
  for (const code of ["attendance_version_conflict", "attendance_platform_paused", "private SQL detail"]) {
    await assert.rejects(executeShiftTemplates(input, { rpc: async () => ({ data: null, error: { message: code } }) }),
      new RegExp(code.startsWith("attendance_") ? code : "attendance_unavailable"));
  }
  await assert.rejects(executeShiftTemplates(input, { rpc: async () => { throw Error("private connection string"); } }), /attendance_unavailable/);
});
