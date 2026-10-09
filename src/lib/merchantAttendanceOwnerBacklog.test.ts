import assert from "node:assert/strict";
import test from "node:test";
import { OWNER_BACKLOG_KINDS, parseOwnerBacklogQuery, parseOwnerBacklogHttpQuery, parseOwnerBacklogResult, parseOwnerBacklogResponse,
  ownerBacklogQueryString, type OwnerBacklogQuery, type OwnerBacklogResult } from "./merchantAttendanceOwnerBacklog";
import { executeOwnerBacklog } from "./merchantAttendanceOwnerBacklog.server";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const query = (): OwnerBacklogQuery => ({ siteId: "99990001", kind: "all", asOf: null, cursorAt: null, cursorKind: null, cursorId: null });
const result = (): OwnerBacklogResult => ({ protocol: "owner-backlog-v1", readOnly: true, siteId: "99990001", ownerId: id(99),
  asOf: "2026-10-03T10:00:00.000001Z", scanned: 3, nextCursor: null,
  items: OWNER_BACKLOG_KINDS.map(kind => ({ kind, requestId: id(501), workerId: id(201), workerName: "合成人员", workerNo: "A01",
    submittedAt: "2026-07-01T10:00:00.000001Z", proposedStartAt: "2026-06-29T08:00:00.000000Z", proposedEndAt: "2026-06-29T16:00:00.000000Z", status: "submitted" })) });
const url = (input = query()) => "https://www.faolla.com/api/merchant-enterprise/attendance/owner-backlog?" + ownerBacklogQueryString(input);

test("backlog query uses exact type-aware microsecond cursor without a date-window or actor override", () => {
  assert.deepEqual(parseOwnerBacklogHttpQuery(url()), query());
  const paged: OwnerBacklogQuery = { ...query(), asOf: result().asOf, cursorAt: result().items[0].submittedAt, cursorKind: "correction", cursorId: id(501) };
  assert.deepEqual(parseOwnerBacklogHttpQuery(url(paged)), paged);
  for (const suffix of ["&ownerId=" + id(1), "&authUserId=" + id(1), "&access=self", "&status=all", "&limit=500", "&fromAt=2026-01-01", "&kind=all", "&siteId=99990001"])
    assert.throws(() => parseOwnerBacklogHttpQuery(url() + suffix));
  for (const patch of [{ kind: "pending" }, { cursorAt: paged.cursorAt }, { cursorId: id(501) }, { cursorKind: "missing" },
    { ...paged, asOf: null }, { ...paged, cursorKind: "all" }, { ...paged, kind: "missing" },
    { ...paged, cursorAt: "2026-10-04T10:00:00.000000Z" }, { asOf: "2026-02-30T10:00:00.000000Z" }, { asOf: "2026-10-03T10:00:00.000Z" }])
    assert.throws(() => parseOwnerBacklogQuery({ ...query(), ...patch }));
});
test("backlog accepts older than31 days and same UUID+microsecond across three ranked sources", () => {
  assert.deepEqual(parseOwnerBacklogResult(result(), query()), result());
  const single = result(); single.items = [single.items[1]]; single.scanned = 1;
  assert.deepEqual(parseOwnerBacklogResult(single, { ...query(), kind: "revision" }), single);
  assert.equal(parseOwnerBacklogResponse({ ok: true, moduleEnabled: false, ...single }, query()).moduleEnabled, false);
});
test("backlog rejects wrong tenant, terminal items, extra sensitive fields and invalid display evidence", () => {
  const changes: ((value: OwnerBacklogResult) => void)[] = [value => value.siteId = "99990002", value => value.ownerId = "bad",
    value => value.items.reverse(), value => value.items[1] = { ...value.items[0] }, value => value.scanned = 2,
    value => value.scanned = 51, value => value.scanned = -1, value => value.items[0].workerName = "bad\nname",
    value => value.items[0].workerNo = "x".repeat(41), value => value.items[0].proposedEndAt = value.items[0].proposedStartAt,
    value => value.items[0].proposedEndAt = value.asOf, value => value.items[2].submittedAt = "2026-10-04T10:00:00.000000Z"];
  for (const change of changes) { const value = result(); change(value); assert.throws(() => parseOwnerBacklogResult(value, query())); }
  for (const status of ["approved", "rejected", "withdrawn", "pending"]) {
    const value = result(); Object.assign(value.items[0], { status }); assert.throws(() => parseOwnerBacklogResult(value, query()));
  }
  for (const extra of [{ actorAuthUserId: id(1) }, { reason: "private" }, { coordinates: [1, 2] }, { total: 3 }]) {
    assert.throws(() => parseOwnerBacklogResult({ ...result(), ...extra }, query()));
    const value = result(); Object.assign(value.items[0], extra); assert.throws(() => parseOwnerBacklogResult(value, query()));
  }
  assert.throws(() => parseOwnerBacklogResult(result(), { ...query(), kind: "missing" }));
  assert.throws(() => parseOwnerBacklogResult(result(), { ...query(), asOf: "2026-10-03T10:00:00.000000Z" }));
  assert.throws(() => parseOwnerBacklogResponse({ ok: true, moduleEnabled: "false", ...result() }, query()));
});
test("backlog empty intermediate pages advance from the last scanned candidate, not the last match", () => {
  const value = result(); value.scanned = 50; value.items = [];
  value.nextCursor = { recordedAt: "2026-07-01T10:00:00.000001Z", kind: "revision", requestId: id(501) };
  assert.deepEqual(parseOwnerBacklogResult(value, query()), value);
  assert.throws(() => parseOwnerBacklogResult({ ...value, scanned: 49 }, query()));
  const paged: OwnerBacklogQuery = { ...query(), asOf: value.asOf, cursorAt: value.nextCursor.recordedAt, cursorKind: "correction", cursorId: id(501) };
  assert.deepEqual(parseOwnerBacklogResult(value, paged), value);
  assert.throws(() => parseOwnerBacklogResult(value, { ...paged, cursorKind: "revision" }));
  assert.throws(() => parseOwnerBacklogResult(value, { ...paged, cursorKind: "missing" }));
  const rows = result(); rows.scanned = 50; rows.nextCursor = { recordedAt: rows.items[0].submittedAt, kind: "revision", requestId: id(501) };
  assert.throws(() => parseOwnerBacklogResult(rows, query()));
  rows.nextCursor.kind = "missing"; assert.deepEqual(parseOwnerBacklogResult(rows, query()), rows);
  rows.nextCursor.recordedAt = "2026-10-04T10:00:00.000000Z"; assert.throws(() => parseOwnerBacklogResult(rows, query()));
});
test("backlog pagination rejects repeated or preceding items while preserving type tie-breaks", () => {
  const value = result(), row = value.items[0];
  const paged: OwnerBacklogQuery = { ...query(), asOf: value.asOf, cursorAt: row.submittedAt, cursorKind: row.kind, cursorId: row.requestId };
  assert.throws(() => parseOwnerBacklogResult(value, paged));
  value.items.shift(); value.scanned = 2; assert.deepEqual(parseOwnerBacklogResult(value, paged), value);
  value.items[0].submittedAt = "2026-07-01T10:00:00.000000Z"; assert.throws(() => parseOwnerBacklogResult(value, paged));
});
test("backlog executor uses only service RPC with authoritative owner and sanitizes mismatched replies", async () => {
  const input = { query: query(), authUserId: id(99) }, calls: unknown[] = [];
  assert.deepEqual(await executeOwnerBacklog(input, { rpc: async (name, args) => { calls.push({ name, args }); return { data: result(), error: null }; } }), result());
  const { siteId, ...p_query } = query();
  assert.deepEqual(calls, [{ name: "faolla_attendance_owner_backlog_v1", args: { p_site_id: siteId, p_auth_user_id: id(99), p_query } }]);
  await assert.rejects(executeOwnerBacklog(input, null), /attendance_unavailable/);
  for (const response of [{ data: { ...result(), ownerId: id(98) }, error: null }, { data: null, error: { message: "private SQL" } }])
    await assert.rejects(executeOwnerBacklog(input, { rpc: async () => response }), { message: "attendance_unavailable" });
  await assert.rejects(executeOwnerBacklog(input, { rpc: async () => { throw Error("private SQL"); } }), { message: "attendance_unavailable" });
  for (const message of ["attendance_access_denied", "attendance_owner_backlog_invalid", "attendance_settings_required"])
    await assert.rejects(executeOwnerBacklog(input, { rpc: async () => ({ data: null, error: { message } }) }), { message });
});
