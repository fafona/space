import assert from "node:assert/strict";
import test from "node:test";
import { compareScheduleOverviewCursor, parseScheduleOverviewHttpQuery, parseScheduleOverviewQuery,
  parseScheduleOverviewResponse, parseScheduleOverviewResult, scheduleOverviewQueryString,
  type ScheduleOverviewCursor, type ScheduleOverviewItem, type ScheduleOverviewQuery, type ScheduleOverviewResult } from "./merchantAttendanceScheduleOverview";
import { executeScheduleOverview } from "./merchantAttendanceScheduleOverview.server";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const query = (): ScheduleOverviewQuery => ({ siteId: "99990001", workerIds: [id(201), id(202)],
  fromDate: "2026-10-01", throughDate: "2026-10-31", revision: null, cursorDate: null, cursorStart: null, cursorId: null });
const item = (n = 501): ScheduleOverviewItem => ({ id: id(n), workerId: id(201), workerName: "Synthetic worker", locationId: id(301),
  locationName: "Synthetic location", timeZone: "Europe/Madrid", workDate: "2026-10-03", startAt: "2026-10-03T07:00:00.000Z",
  endAt: "2026-10-03T15:00:00.000Z", revision: 2, cancelled: false, cancelRevision: null });
const result = (): ScheduleOverviewResult => ({ protocol: "schedule-overview-v1", readOnly: true, siteId: "99990001", ownerId: id(99),
  workerIds: query().workerIds, fromDate: query().fromDate, throughDate: query().throughDate, revision: 5,
  items: [item()], scanned: 1, nextCursor: null });
const cursor = (row = item()): ScheduleOverviewCursor => ({ workDate: row.workDate, startAt: row.startAt, slotId: row.id });
const url = (q = query()) => `https://www.faolla.com/api/merchant-enterprise/attendance/schedule-overview?${scheduleOverviewQueryString(q)}`;

test("overview exact query binds a sorted unique selection of 1–20 workers and at most 31 inclusive dates", () => {
  assert.deepEqual(parseScheduleOverviewQuery(query()), query());
  assert.deepEqual(parseScheduleOverviewHttpQuery(url()), query());
  assert.equal(parseScheduleOverviewQuery({ ...query(), workerIds: Array.from({ length: 20 }, (_, i) => id(i + 1)) }).workerIds.length, 20);
  for (const patch of [{ workerIds: [] }, { workerIds: Array.from({ length: 21 }, (_, i) => id(i + 1)) },
    { workerIds: [id(202), id(201)] }, { workerIds: [id(201), id(201)] }, { workerIds: ["bad"] },
    { workerIds: id(201) }, { fromDate: "2026-10-02", throughDate: "2026-10-01" }, { throughDate: "2026-11-01" },
    { fromDate: "2026-02-30" }, { siteId: "all" }, { ownerId: id(99) }, { limit: 1000 }, { timeZone: "UTC" }])
    assert.throws(() => parseScheduleOverviewQuery({ ...query(), ...patch }));
  assert.deepEqual(parseScheduleOverviewQuery({ ...query(), throughDate: query().fromDate }).workerIds, query().workerIds);
});

test("HTTP query rejects duplicate or injected fields and partial cursors cannot escape a fixed schedule revision", () => {
  const row = item(), paged: ScheduleOverviewQuery = { ...query(), revision: 5, cursorDate: row.workDate, cursorStart: row.startAt, cursorId: row.id };
  assert.deepEqual(parseScheduleOverviewHttpQuery(url(paged)), paged);
  for (const suffix of ["&siteId=99990001", "&workerIds=" + id(201), "&authUserId=" + id(1), "&access=self", "&limit=51", "&asOf=2026-10-03"])
    assert.throws(() => parseScheduleOverviewHttpQuery(url() + suffix));
  for (const patch of [{ revision: -1 }, { revision: 0.1 }, { revision: "5" }, { revision: Number.MAX_SAFE_INTEGER },
    { cursorId: row.id }, { cursorDate: row.workDate }, { cursorStart: row.startAt },
    { ...paged, revision: null }, { ...paged, cursorStart: "2026-10-03T07:00:01.000Z" },
    { ...paged, cursorStart: "2026-10-03T07:00:00.000000Z" }, { ...paged, cursorDate: "2026-11-01" }])
    assert.throws(() => parseScheduleOverviewQuery({ ...query(), ...patch }));
  assert.equal(parseScheduleOverviewQuery({ ...query(), revision: 0 }).revision, 0);
});

test("overview exact DTO enforces tenant, selected workers, range, snapshot revision and no sensitive extras", () => {
  assert.deepEqual(parseScheduleOverviewResult(result(), query()), result());
  assert.equal(parseScheduleOverviewResponse({ ok: true, moduleEnabled: false, ...result() }, query()).moduleEnabled, false);
  for (const patch of [{ protocol: "schedule-v1" }, { readOnly: false }, { siteId: "99990002" }, { ownerId: "bad" },
    { workerIds: [id(202)] }, { workerIds: [...query().workerIds].reverse() }, { fromDate: "2026-10-02" },
    { revision: 1 }, { scanned: 0 }, { scanned: 51 }, { scanned: -1 }, { scanned: 1.5 }, { reason: "private" }])
    assert.throws(() => parseScheduleOverviewResult({ ...result(), ...patch }, query()));
  assert.throws(() => parseScheduleOverviewResult(result(), { ...query(), revision: 4 }));
  for (const patch of [{ workerId: id(203) }, { workDate: "2026-11-01" }, { revision: 6 }, { revision: 0 },
    { workerName: "bad\nname" }, { workerName: " padded " }, { locationName: "padded " }, { locationName: "" },
    { reason: "private" }, { employeeAuthId: id(1) }, { coordinates: [1, 2] }])
    assert.throws(() => parseScheduleOverviewResult({ ...result(), items: [{ ...item(), ...patch }] }, query()));
  for (const patch of [{ ok: false }, { moduleEnabled: "false" }, { privateData: "hidden" }])
    assert.throws(() => parseScheduleOverviewResponse({ ok: true, moduleEnabled: true, ...result(), ...patch }, query()));
});

test("published and cancelled revisions reconstruct a fixed view without treating plans as attendance facts", () => {
  const cancelled = { ...item(), cancelled: true, cancelRevision: 4 };
  assert.deepEqual(parseScheduleOverviewResult({ ...result(), items: [cancelled] }, query()).items, [cancelled]);
  for (const patch of [{ cancelled: true, cancelRevision: null }, { cancelled: false, cancelRevision: 4 },
    { cancelled: true, cancelRevision: 2 }, { cancelled: true, cancelRevision: 6 }, { cancelled: "false" },
    { cancelled: true, cancelRevision: 3.5 }])
    assert.throws(() => parseScheduleOverviewResult({ ...result(), items: [{ ...item(), ...patch }] }, query()));
  const beforeCancellation = { ...result(), revision: 3 };
  assert.deepEqual(parseScheduleOverviewResult(beforeCancellation, { ...query(), revision: 3 }).items, [item()]);
  assert.throws(() => parseScheduleOverviewResult({ ...beforeCancellation, items: [cancelled] }, { ...query(), revision: 3 }));
  const empty = { ...result(), revision: 0, items: [], scanned: 0 };
  assert.deepEqual(parseScheduleOverviewResult(empty, { ...query(), revision: 0 }), empty);
});

test("each slot uses its own timezone and exact minute-aligned UTC instants with at most 24 hours elapsed", () => {
  const east = { ...item(), timeZone: "Asia/Tokyo", startAt: "2026-10-02T15:00:00.000Z", endAt: "2026-10-03T15:00:00.000Z" };
  assert.equal(parseScheduleOverviewResult({ ...result(), items: [east] }, query()).items[0].workDate, "2026-10-03");
  for (const patch of [{ timeZone: "Not/AZone" }, { workDate: "2026-10-02" }, { startAt: "2026-10-03T07:00:01.000Z" },
    { startAt: "2026-10-03T07:00:00.000001Z" }, { startAt: "2026-10-03T09:00:00.000+02:00" },
    { endAt: item().startAt }, { endAt: "2026-10-04T07:01:00.000Z" }])
    assert.throws(() => parseScheduleOverviewResult({ ...result(), items: [{ ...item(), ...patch }] }, query()));
});

test("full ascending (local date, UTC start, slot ID) ordering rejects duplicates and replayed pages", () => {
  const first = item(), second = item(502);
  assert(compareScheduleOverviewCursor(cursor(first), cursor(second)) < 0);
  assert.equal(compareScheduleOverviewCursor(cursor(first), cursor(first)), 0);
  const page = { ...result(), items: [first, second], scanned: 2 };
  assert.deepEqual(parseScheduleOverviewResult(page, query()).items, [first, second]);
  for (const items of [[second, first], [first, first]]) assert.throws(() => parseScheduleOverviewResult({ ...page, items }, query()));
  const paged: ScheduleOverviewQuery = { ...query(), revision: 5, cursorDate: first.workDate, cursorStart: first.startAt, cursorId: first.id };
  assert.throws(() => parseScheduleOverviewResult(page, paged));
  assert.deepEqual(parseScheduleOverviewResult({ ...result(), items: [second] }, paged).items, [second]);
  const laterDay = { ...cursor(first), workDate: "2026-10-04", startAt: "2026-10-03T00:00:00.000Z" };
  assert(compareScheduleOverviewCursor(cursor(first), laterDay) < 0, "local work date is the first sort key");
});

test("50-scanned bounded pages can be empty yet advancing; continuation must follow every returned item", () => {
  const last = item(550), full = { ...result(), items: Array.from({ length: 50 }, (_, i) => item(501 + i)), scanned: 50, nextCursor: cursor(last) };
  assert.deepEqual(parseScheduleOverviewResult(full, query()), full);
  assert.deepEqual(parseScheduleOverviewResult({ ...full, items: [] }, query()).nextCursor, cursor(last));
  for (const patch of [{ scanned: 49 }, { nextCursor: cursor(item(549)) }, { items: [...full.items, item(551)] },
    { nextCursor: { ...cursor(last), extra: true } }, { nextCursor: { ...cursor(last), workDate: "2026-11-01" } }])
    assert.throws(() => parseScheduleOverviewResult({ ...full, ...patch }, query()));
  const paged: ScheduleOverviewQuery = { ...query(), revision: 5, cursorDate: last.workDate, cursorStart: last.startAt, cursorId: last.id };
  assert.throws(() => parseScheduleOverviewResult({ ...full, items: [] }, paged));
  assert.equal(parseScheduleOverviewResult({ ...result(), items: [], scanned: 0 }, paged).nextCursor, null);
});

test("server only invokes the read-only overview RPC, binds current owner and hides invalid replies or SQL failures", async () => {
  const q = query(), input = { query: q, authUserId: id(99) };
  assert.deepEqual(await executeScheduleOverview(input, { rpc: async (name, args) => {
    assert.equal(name, "faolla_attendance_schedule_overview_v1");
    assert.deepEqual(args, { p_auth_user_id: id(99), p_query: q });
    return { data: result(), error: null };
  } }), result());
  await assert.rejects(executeScheduleOverview(input, null), /attendance_unavailable/);
  for (const data of [{ ...result(), ownerId: id(98) }, { ...result(), siteId: "99990002" }, { ...result(), privateData: "x" }])
    await assert.rejects(executeScheduleOverview(input, { rpc: async () => ({ data, error: null }) }), /attendance_unavailable/);
  for (const message of ["attendance_access_denied", "attendance_settings_required", "private SQL detail"])
    await assert.rejects(executeScheduleOverview(input, { rpc: async () => ({ data: null, error: { message } }) }),
      new RegExp(message.startsWith("attendance_") ? message : "attendance_unavailable"));
  await assert.rejects(executeScheduleOverview(input, { rpc: async () => { throw Error("private connection"); } }), /attendance_unavailable/);
});
