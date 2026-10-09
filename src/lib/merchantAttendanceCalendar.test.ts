import assert from "node:assert/strict";
import test from "node:test";
import { calendarDateRange, calendarEntryRange, calendarQueryString, calendarReason, parseCalendarBody, parseCalendarCommand,
  parseCalendarDetail, parseCalendarHttpQuery, parseCalendarQuery, parseCalendarResponse, parseCalendarResult,
  parseCalendarSummary, sameCalendarCommand, type CalendarCommand, type CalendarDetail, type CalendarQuery,
  type CalendarResult, type CalendarSummary } from "./merchantAttendanceCalendar";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const query = (locationId: string | null = null): CalendarQuery => ({ siteId: "99990001", locationId, fromDate: null,
  throughDate: null, entryId: null, operationId: null, beforeAt: null, beforeId: null });
const command: CalendarCommand = { operationId: id(501), action: "create", reason: "Manual calendar notice", kind: "holiday",
  title: "Local holiday", fromDate: "2026-10-05", throughDate: "2026-10-06", expectedSettingsVersion: 1,
  locationId: null, expectedLocationVersion: null, timeZone: "Europe/Madrid" };
const summary = (n = 501, locationId: string | null = null): CalendarSummary => ({ entryId: id(n), locationId,
  locationName: locationId ? "Original location" : null, timeZone: command.timeZone, kind: command.kind, title: command.title,
  fromDate: command.fromDate, throughDate: command.throughDate, createdAt: "2026-10-03T09:00:00.123456Z", revision: 1, status: "created" });
const detail = (n = 501, locationId: string | null = null): CalendarDetail => ({ ...summary(n, locationId), reason: command.reason,
  cancelReason: null, cancelledAt: null, canCancel: true });
const result = (locationId: string | null = null): CalendarResult => ({ protocol: "calendar-v1", siteId: "99990001", actorId: id(99),
  settingsVersion: 1, locationId, locationName: locationId ? "Current location" : null, locationVersion: locationId ? 1 : null,
  timeZone: "Europe/Madrid", canCreate: true, items: [], nextCursor: null, detail: null, receipt: null });

test("calendar queries have an exact single enterprise/location scope and complete bounded list or lookup cursors", () => {
  for (const locationId of [null, id(201)]) {
    const q = query(locationId); assert.deepEqual(parseCalendarHttpQuery(`https://fixture.invalid/?${calendarQueryString(q)}`), q);
    const listed = { ...q, fromDate: "2026-10-01", throughDate: "2026-10-31", beforeAt: summary().createdAt, beforeId: id(501) };
    assert.deepEqual(parseCalendarQuery(listed), listed);
  }
  for (const patch of [{ siteId: "all" }, { locationId: "all" }, { locationIds: [id(201)] }, { actorId: id(99) },
    { fromDate: command.fromDate }, { throughDate: command.throughDate }, { beforeId: id(501) }, { beforeAt: summary().createdAt },
    { beforeAt: summary().createdAt, beforeId: id(501) },
    { fromDate: command.fromDate, throughDate: command.throughDate, entryId: id(501) },
    { fromDate: command.fromDate, throughDate: command.throughDate, operationId: id(501) }])
    assert.throws(() => parseCalendarQuery({ ...query(), ...patch }));
  for (const suffix of ["&siteId=99990001", "&locationId=" + id(201) + "&locationId=" + id(202), "&allowWrite=true", "&scope=all"])
    assert.throws(() => parseCalendarHttpQuery(`https://fixture.invalid/?${calendarQueryString(query())}${suffix}`));
});

test("calendar dates are inclusive, canonical, real and at most 366 days; entry zones reject nonexistent endpoint days", () => {
  assert.equal(calendarDateRange("2024-01-01", "2024-12-31").days, 366);
  assert.equal(calendarDateRange(command.fromDate, command.fromDate).days, 1);
  for (const [from, through] of [["2026-02-30", "2026-03-01"], ["2026-1-01", "2026-01-02"], ["2026-10-06", "2026-10-05"],
    ["2026-01-01", "2027-01-02"], ["1999-12-31", "2000-01-01"], ["2100-12-31", "2101-01-01"]])
    assert.throws(() => calendarDateRange(from, through), /attendance_invalid_request/);
  assert.equal(calendarEntryRange("2026-03-29", "2026-03-29", "Europe/Madrid").days, 1);
  assert.throws(() => calendarEntryRange(command.fromDate, command.throughDate, "Bad/Zone"), /attendance_invalid_request/);
  assert.throws(() => calendarEntryRange("2011-12-30", "2011-12-30", "Pacific/Apia"), /attendance_invalid_request/);
});

test("create and cancel commands contain only manual calendar authority and bind scope, versions, title and reason", () => {
  assert.deepEqual(parseCalendarBody({ query: query(), command }), { query: query(), command });
  const located = { ...command, locationId: id(201), expectedLocationVersion: 2 };
  assert.deepEqual(parseCalendarBody({ query: query(id(201)), command: located }).command, located);
  for (const patch of [{ locationId: id(201) }, { expectedLocationVersion: 1 }, { expectedSettingsVersion: 0 },
    { expectedSettingsVersion: Number.MAX_SAFE_INTEGER }, { kind: "paid_leave" }, { workerId: id(201) }, { reason: "" },
    { title: " padded" }, { title: "x".repeat(81) }, { workMinutes: 480 }, { payroll: true }])
    assert.throws(() => parseCalendarCommand({ ...command, ...patch }));
  for (const reason of ["", " padded", "bad\nreason", "x".repeat(201), "\u0085bad"]) assert.throws(() => calendarReason(reason));
  assert.equal(calendarReason("🙂".repeat(200)).length, 400);
  const cancel: CalendarCommand = { operationId: id(502), action: "cancel", entryId: id(501), expectedRevision: 1, reason: "Correction" };
  assert.deepEqual(parseCalendarBody({ query: { ...query(), entryId: id(501) }, command: cancel }).command, cancel);
  for (const patch of [{ expectedRevision: 0 }, { expectedRevision: 2 }, { timeZone: "UTC" }, { action: "update" }])
    assert.throws(() => parseCalendarCommand({ ...cancel, ...patch }));
  for (const body of [{ query: query(id(202)), command: located }, { query: { ...query(), entryId: id(501) }, command },
    { query: { ...query(), operationId: id(501) }, command }, { query: query(), command: cancel }, { query: query(), command, allowWrite: true }])
    assert.throws(() => parseCalendarBody(body));
  assert.equal(sameCalendarCommand(command, structuredClone(command)), true);
  assert.equal(sameCalendarCommand(command, { ...command, reason: "Another intent" }), false);
});

test("summaries never contain reasons; cancellation detail is revision two with immutable creation time and required reason/time", () => {
  assert.deepEqual(parseCalendarSummary(summary()), summary()); assert.deepEqual(parseCalendarDetail(detail()), detail());
  for (const patch of [{ reason: "private" }, { revision: 2 }, { status: "active" }, { locationName: "Unexpected" },
    { locationId: id(201) }, { createdAt: "2026-10-03T09:00:00.123Z" }, { createdAt: "2026-02-30T09:00:00.123456Z" }, { title: "bad\nlabel" }])
    assert.throws(() => parseCalendarSummary({ ...summary(), ...patch }));
  assert.equal(parseCalendarSummary({ ...summary(501, id(201)), locationName: "x".repeat(120) }).locationName?.length, 120);
  assert.throws(() => parseCalendarSummary({ ...summary(501, id(201)), locationName: "x".repeat(121) }));
  const cancelled: CalendarDetail = { ...detail(), revision: 2, status: "cancelled", canCancel: false,
    cancelReason: "No longer applicable", cancelledAt: "2026-10-03T10:00:00.000001Z" };
  assert.deepEqual(parseCalendarDetail(cancelled), cancelled);
  for (const patch of [{ cancelReason: null }, { cancelledAt: null }, { canCancel: true }, { canCancel: "false" },
    { cancelledAt: "2026-10-03T09:00:00.123455Z" }]) assert.throws(() => parseCalendarDetail({ ...cancelled, ...patch }));
  assert.throws(() => parseCalendarDetail({ ...detail(), cancelReason: "Already cancelled" }));
});

test("result authority pins tenant, actor and exact scope, without overwriting historical location labels or time zones", () => {
  assert.deepEqual(parseCalendarResult(result(), query(), null, id(99)), result());
  for (const patch of [{ siteId: "99990002" }, { actorId: id(98) }, { locationId: id(201) }, { locationName: "Other" },
    { locationVersion: 1 }, { canCreate: false }, { canCreate: "true" }, { settingsVersion: 0 }, { protocol: "other" }, { extra: true }])
    assert.throws(() => parseCalendarResult({ ...result(), ...patch }, query(), null, id(99)));
  const q = { ...query(id(201)), entryId: id(501) }, historic = detail(501, id(201));
  const value = { ...result(id(201)), settingsVersion: 8, locationVersion: 9, timeZone: "America/New_York", canCreate: false, detail: historic };
  const parsed = parseCalendarResult(value, q); assert.equal(parsed.detail?.timeZone, "Europe/Madrid");
  assert.equal(parsed.detail?.locationName, "Original location"); assert.equal(parsed.timeZone, "America/New_York");
  for (const patch of [{ locationVersion: null }, { locationName: null }, { detail: { ...historic, locationId: id(202) } },
    { detail: { ...historic, entryId: id(502) } }, { detail: null }]) assert.throws(() => parseCalendarResult({ ...value, ...patch }, q));
  assert.throws(() => parseCalendarResult({ ...result(), detail: detail() }, query()));
  for (const patch of [{ ok: false }, { moduleEnabled: "false" }, { extra: true }])
    assert.throws(() => parseCalendarResponse({ ok: true, moduleEnabled: false, ...result(), ...patch }, query()));
  assert.equal(parseCalendarResponse({ ok: true, moduleEnabled: false, ...result() }, query()).moduleEnabled, false);
});

test("25-row keyset pages are scope-specific, overlap the selected dates and preserve complete microsecond ordering", () => {
  const q = { ...query(), fromDate: "2026-10-06", throughDate: "2026-10-31" };
  const items = Array.from({ length: 25 }, (_, i) => summary(550 - i));
  const page = { ...result(), items, nextCursor: { at: items[24].createdAt, id: items[24].entryId } };
  assert.deepEqual(parseCalendarResult(page, q), page);
  for (const patch of [{ items: [...items, summary(525)] }, { items: [...items].reverse() }, { items: items.slice(1) },
    { items: [summary(), summary()], nextCursor: null }, { nextCursor: { ...page.nextCursor, id: id(527) } },
    { nextCursor: { ...page.nextCursor, extra: true } }, { items: [summary(501, id(201))], nextCursor: null },
    { items: [{ ...summary(), throughDate: "2026-10-05" }], nextCursor: null }])
    assert.throws(() => parseCalendarResult({ ...page, ...patch }, q));
  const next = { ...q, beforeAt: summary().createdAt, beforeId: id(501) };
  assert.throws(() => parseCalendarResult({ ...result(), items: [summary()] }, next));
  assert.equal(parseCalendarResult({ ...result(), items: [summary(500)] }, next).items[0].entryId, id(500));
  assert.throws(() => parseCalendarResult(page, query()));
  assert.throws(() => parseCalendarResult(page, { ...query(), operationId: id(501) }));
  assert.throws(() => parseCalendarResult({ ...page, detail: detail() }, { ...query(), entryId: id(501) }));
});

test("create receipts keep original snapshots after cancellation even when current scope timezone/version changes", () => {
  const receipt = { command, item: summary() };
  const current: CalendarDetail = { ...detail(), revision: 2, status: "cancelled", canCancel: false,
    cancelReason: "Changed plans", cancelledAt: "2026-10-03T10:00:00.000001Z" };
  const value = { ...result(), timeZone: "UTC", settingsVersion: 4, detail: current, receipt };
  const parsed = parseCalendarResult(value, { ...query(), operationId: command.operationId });
  assert.equal(parsed.receipt?.item.revision, 1); assert.equal(parsed.detail?.revision, 2);
  assert.equal(parsed.receipt?.item.timeZone, "Europe/Madrid"); assert.deepEqual(parseCalendarResult(value, query(), command), value);
  for (const replacement of [null, { ...receipt, extra: true }, { ...receipt, command: { ...command, operationId: id(502) } },
    { ...receipt, item: { ...summary(), revision: 2, status: "cancelled" } }, { ...receipt, item: { ...summary(), title: "Different" } },
    { ...receipt, command: { ...command, expectedSettingsVersion: 4 } }])
    assert.throws(() => parseCalendarResult({ ...value, receipt: replacement }, query(), command));
  for (const replacement of [null, { ...current, entryId: id(502) }, { ...current, reason: "Other creation" },
    { ...current, title: "Different historical title" }, { ...current, timeZone: "UTC" }])
    assert.throws(() => parseCalendarResult({ ...value, detail: replacement }, query(), command));
});

test("cancel receipts require original entry, revision and exact cancellation reason; no list or foreign-scope data is accepted", () => {
  const cancel: CalendarCommand = { operationId: id(502), action: "cancel", reason: "Correction", entryId: id(501), expectedRevision: 1 };
  const item: CalendarSummary = { ...summary(), revision: 2, status: "cancelled" };
  const current: CalendarDetail = { ...detail(), ...item, cancelReason: cancel.reason, cancelledAt: "2026-10-03T10:00:00.000001Z", canCancel: false };
  const q = { ...query(), entryId: id(501) }, value = { ...result(), receipt: { command: cancel, item }, detail: current };
  assert.deepEqual(parseCalendarResult(value, q, cancel), value);
  for (const patch of [{ items: [summary()] }, { detail: detail() }, { detail: { ...current, cancelReason: "Different" } },
    { receipt: { command: cancel, item: summary() } }, { receipt: { command: { ...cancel, entryId: id(503) }, item } }])
    assert.throws(() => parseCalendarResult({ ...value, ...patch }, q, cancel));
});
