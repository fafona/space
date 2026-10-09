import assert from "node:assert/strict";
import test from "node:test";
import { coverageQueryString, parseCoverageQuery, parseCoverageResult, type CoverageQuery, type CoverageResult } from "./merchantAttendanceNoticeCoverage";
import { executeAttendanceNoticeCoverage } from "./merchantAttendanceNoticeCoverage.server";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const query = (): CoverageQuery => ({ siteId: "99990001", locationId: id(301), expectedNoticeRevision: null, expectedSettingsVersion: null, expectedLocationVersion: null, cursorWorkerId: null });
const result = (): CoverageResult => ({ siteId: "99990001", location: { id: id(301), name: "合成地点", active: true, version: 1 }, settingsVersion: 1,
  notice: { revision: 1, action: "publish", recordedAt: "2026-10-01T10:00:00.000001Z" }, noticeCurrent: true, observedAt: "2026-10-03T10:00:00.000000Z",
  counts: { assigned: 2, eligible: 1, excluded: 1, confirmed: 1, pending: 0 }, nextCursor: null,
  items: [{ workerId: id(201), workerNo: "A", displayName: "合成员工", employeeId: id(101), eligible: true, exclusion: null, acknowledgedAt: "2026-10-01T10:00:00.000123Z" },
    { workerId: id(202), workerNo: "B", displayName: "未绑定档案", employeeId: null, eligible: false, exclusion: "employee_unavailable", acknowledgedAt: null }] });
const url = (q = query()) => `https://www.faolla.com/api/merchant-enterprise/attendance/location-notice-coverage?${coverageQueryString(q)}`;

test("coverage query is bounded, exact and requires a complete three-version fence before a cursor", () => {
  assert.deepEqual(parseCoverageQuery(url()), query());
  const page = { ...query(), expectedNoticeRevision: 0, expectedSettingsVersion: Number.MAX_SAFE_INTEGER, expectedLocationVersion: 1, cursorWorkerId: id(201) };
  assert.deepEqual(parseCoverageQuery(url(page)), page);
  assert.deepEqual(parseCoverageQuery(url({ ...page, cursorWorkerId: null })), { ...page, cursorWorkerId: null });
  for (const suffix of ["&access=owner", "&siteId=99990001", "&limit=10000", "&cursorWorkerId=" + id(201), "&expectedNoticeRevision=0",
    "&expectedNoticeRevision=1&expectedSettingsVersion=1&expectedLocationVersion=0", "&expectedNoticeRevision=9007199254740991&expectedSettingsVersion=1&expectedLocationVersion=1",
    "&expectedNoticeRevision=01&expectedSettingsVersion=1&expectedLocationVersion=1", "&expectedNoticeRevision=null", "&actorAuthUserId=" + id(1)])
    assert.throws(() => parseCoverageQuery(url() + suffix));
});
test("coverage projection preserves exact microseconds and does not equate receipt with delivery or participation", () => {
  const value = result(); assert.deepEqual(parseCoverageResult(value, query()), value);
  const stale = { ...value, noticeCurrent: false }; assert.deepEqual(parseCoverageResult(stale, query()), stale);
  const earlierRead = { ...value, observedAt: "2026-10-01T09:00:00.000000Z" }; assert.deepEqual(parseCoverageResult(earlierRead, query()), earlierRead);
  for (const notice of [null, { revision: 2, action: "withdraw" as const, recordedAt: "2026-10-02T10:00:00.000000Z" }]) {
    const absent = { ...result(), notice, noticeCurrent: false, counts: { assigned: 2, eligible: 1, excluded: 1, confirmed: null, pending: null }, items: result().items.map(row => ({ ...row, acknowledgedAt: null })) };
    assert.deepEqual(parseCoverageResult(absent, query()), absent);
  }
});
test("coverage rejects tenant, version, identity and contradictory summary or receipt data", () => {
  const changes: ((r: CoverageResult) => void)[] = [r => r.siteId = "99990002", r => r.location.id = id(302), r => r.location.active = false,
    r => r.counts.assigned++, r => r.counts.confirmed = 0, r => r.counts.pending = -1, r => r.counts.eligible = 0,
    r => r.items[0].employeeId = null, r => r.items[0].exclusion = "worker_inactive", r => r.items[1].eligible = true,
    r => r.items[1].acknowledgedAt = "2026-10-02T10:00:00.000000Z", r => r.items[0].acknowledgedAt = "2026-10-01T10:00:00.000000Z",
    r => r.items.reverse(), r => r.items[1].workerId = r.items[0].workerId, r => r.items[0].workerNo = "a".repeat(41),
    r => r.items[0].displayName = "bad\nname", r => r.nextCursor = id(202)];
  for (const change of changes) { const value = result(); change(value); assert.throws(() => parseCoverageResult(value, query())); }
  for (const extra of [{ actorAuthUserId: id(1) }, { latitude: 0 }, { token: "hidden" }]) assert.throws(() => parseCoverageResult({ ...result(), ...extra }, query()));
  assert.throws(() => parseCoverageResult(result(), { ...query(), expectedNoticeRevision: 2, expectedSettingsVersion: 1, expectedLocationVersion: 1 }));
});
test("coverage keyset page requires a full page, matching cursor and fresh monotonically ordered rows", () => {
  const value = result(); value.items = Array.from({ length: 50 }, (_, n) => ({ ...result().items[0], workerId: id(1000 + n) }));
  value.counts = { assigned: 51, eligible: 51, excluded: 0, confirmed: 51, pending: 0 }; value.nextCursor = id(1049);
  assert.equal(parseCoverageResult(value, query()).items.length, 50);
  assert.throws(() => parseCoverageResult({ ...value, nextCursor: id(1048) }, query()));
  assert.throws(() => parseCoverageResult({ ...value, items: [...value.items, { ...value.items[0], workerId: id(1050) }] }, query()));
  assert.throws(() => parseCoverageResult(value, { ...query(), cursorWorkerId: id(1000), expectedNoticeRevision: 1, expectedSettingsVersion: 1, expectedLocationVersion: 1 }));
});
test("coverage executor forwards only the read contract with authoritative caller and validates its response", async () => {
  const input = { query: query(), authUserId: id(99) }, calls: unknown[] = [];
  const read = await executeAttendanceNoticeCoverage(input, { rpc: async (name, args) => { calls.push({ name, args }); return { data: result(), error: null }; } });
  assert.deepEqual(read, result());
  const { siteId, ...p_query } = query();
  assert.deepEqual(calls, [{ name: "faolla_attendance_location_notice_coverage_v1", args: { p_site_id: siteId, p_auth_user_id: id(99), p_query } }]);
  await assert.rejects(executeAttendanceNoticeCoverage(input, null), /attendance_unavailable/);
  await assert.rejects(executeAttendanceNoticeCoverage(input, { rpc: async () => ({ data: { ...result(), secret: "do not return" }, error: null }) }), /attendance_unavailable/);
  await assert.rejects(executeAttendanceNoticeCoverage(input, { rpc: async () => ({ data: null, error: { message: "private SQL details" } }) }), { message: "attendance_unavailable" });
  await assert.rejects(executeAttendanceNoticeCoverage(input, { rpc: async () => ({ data: null, error: { message: "attendance_access_denied" } }) }), /attendance_access_denied/);
});
