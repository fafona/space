import assert from "node:assert/strict";
import test from "node:test";
import { parseSelfRevisionHistoryQuery, parseSelfRevisionHistoryHttpQuery, parseSelfRevisionHistoryResult, parseSelfRevisionHistoryResponse, selfRevisionHistoryQueryString,
  type SelfRevisionHistoryQuery, type SelfRevisionHistoryResult } from "./merchantAttendanceSelfRevisionHistory";
import { executeSelfRevisionHistory } from "./merchantAttendanceSelfRevisionHistory.server";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const query = (): SelfRevisionHistoryQuery => ({ siteId: "99990001", expectedWorkerId: id(201), status: "all", asOf: null, cursorAt: null, cursorId: null });
const result = (): SelfRevisionHistoryResult => ({ protocol: "self-revision-history-v1", readOnly: true, siteId: "99990001", employeeId: id(101), workerId: id(201),
  asOf: "2026-10-03T10:00:00.000001Z", scanned: 2, nextCursor: null,
  items: [0, 1].map(n => ({ requestId: id(601 + n), rootRequestId: id(501 + n), workerId: id(201), employeeId: id(101), workerName: "合成人员", workerNo: "A01",
    submittedRevision: 1, submittedAt: `2026-10-01T10:00:00.00000${2 - n}Z`, proposedStartAt: "2026-09-29T08:00:00.000000Z", proposedEndAt: "2026-09-29T16:00:00.000000Z",
    status: n === 0 ? "approved" : "submitted", closedAt: n === 0 ? "2026-10-02T10:00:00.000000Z" : null, decisionOperationId: n === 0 ? id(701) : null })) });
const url = (q = query()) => "https://www.faolla.com/api/merchant-enterprise/attendance/self-revision-history?" + selfRevisionHistoryQueryString(q);

test("self revision query has no owner, root or user-supplied identity bypass and preserves microsecond keysets", () => {
  assert.deepEqual(parseSelfRevisionHistoryHttpQuery(url()), query());
  const paged = { ...query(), asOf: result().asOf, cursorAt: result().items[0].submittedAt, cursorId: id(601) };
  assert.deepEqual(parseSelfRevisionHistoryQuery(paged), paged);
  for (const suffix of ["&access=owner", "&rootRequestId=" + id(501), "&authUserId=" + id(1), "&siteId=99990001", "&limit=10000", "&status=all", "&asOf=2026-10-03T10:00:00.000Z"])
    assert.throws(() => parseSelfRevisionHistoryHttpQuery(url() + suffix));
  for (const patch of [{ status: "pending" }, { expectedWorkerId: null }, { cursorId: id(1) }, { cursorAt: result().asOf },
    { ...paged, asOf: null }, { ...paged, cursorAt: "2026-10-04T10:00:00.000000Z" }, { asOf: "2026-02-30T10:00:00.000000Z" }])
    assert.throws(() => parseSelfRevisionHistoryQuery({ ...query(), ...patch }));
});
test("self revision response accepts multiple owned roots and all four exact terminal states", () => {
  assert.deepEqual(parseSelfRevisionHistoryResult(result(), query()), result());
  for (const status of ["submitted", "approved", "rejected", "withdrawn"] as const) {
    const v = result(); v.items = [v.items[0]]; v.scanned = 1;
    Object.assign(v.items[0], { status, closedAt: status === "submitted" ? null : "2026-10-02T10:00:00.000000Z", decisionOperationId: ["approved", "rejected"].includes(status) ? id(701) : null });
    assert.equal(parseSelfRevisionHistoryResult(v, { ...query(), status }).items[0].status, status);
  }
  assert.equal(parseSelfRevisionHistoryResponse({ ok: true, moduleEnabled: false, ...result() }, query()).moduleEnabled, false);
});
test("self revision response rejects identity, ordering, status, time and unknown sensitive fields", () => {
  const changes: ((v: SelfRevisionHistoryResult) => void)[] = [v => v.siteId = "99990002", v => v.workerId = id(202), v => v.items[0].employeeId = id(102),
    v => v.items[0].workerId = id(202), v => v.items.reverse(), v => v.items[0].rootRequestId = v.items[0].requestId,
    v => v.items[0].submittedRevision = 0, v => v.scanned = 51, v => v.scanned = 1, v => v.items[0].closedAt = null,
    v => v.items[1].closedAt = v.items[0].closedAt, v => v.items[0].decisionOperationId = null,
    v => v.items[0].decisionOperationId = v.items[0].rootRequestId, v => v.items[0].closedAt = "2026-10-04T10:00:00.000000Z",
    v => v.items[0].closedAt = v.items[0].submittedAt, v => v.items[0].proposedEndAt = "2026-10-04T10:00:00.000000Z",
    v => v.items[0].workerName = "bad\nname", v => v.items[0].workerNo = "a".repeat(41), v => v.items[1] = { ...v.items[0] }];
  for (const change of changes) { const v = result(); change(v); assert.throws(() => parseSelfRevisionHistoryResult(v, query())); }
  for (const extra of [{ authUserId: id(1) }, { coordinates: [1, 2] }, { reason: "private" }]) {
    assert.throws(() => parseSelfRevisionHistoryResult({ ...result(), ...extra }, query()));
    const v = result(); Object.assign(v.items[0], extra); assert.throws(() => parseSelfRevisionHistoryResult(v, query()));
  }
  assert.throws(() => parseSelfRevisionHistoryResult(result(), { ...query(), status: "submitted" }));
  assert.throws(() => parseSelfRevisionHistoryResult(result(), { ...query(), asOf: "2026-10-03T10:00:00.000000Z" }));
  assert.throws(() => parseSelfRevisionHistoryResponse({ ok: true, moduleEnabled: "true", ...result() }, query()));
});
test("self revision cursor denotes scanned candidates, including an empty nonfinal status-filtered page", () => {
  const v = result(); v.items = []; v.scanned = 50; v.nextCursor = { recordedAt: "2026-10-01T10:00:00.000000Z", requestId: id(600) };
  assert.deepEqual(parseSelfRevisionHistoryResult(v, { ...query(), status: "rejected" }), v);
  for (const patch of [{ scanned: 49 }, { nextCursor: { ...v.nextCursor, recordedAt: "2026-10-04T10:00:00.000000Z" } }])
    assert.throws(() => parseSelfRevisionHistoryResult({ ...v, ...patch }, query()));
  const cursor = v.nextCursor;
  assert.throws(() => parseSelfRevisionHistoryResult(v, { ...query(), asOf: v.asOf, cursorAt: cursor.recordedAt, cursorId: cursor.requestId }));
  const rows = result(); rows.scanned = 50; rows.nextCursor = { recordedAt: rows.items[0].submittedAt, requestId: rows.items[0].requestId };
  assert.throws(() => parseSelfRevisionHistoryResult(rows, query()));
  rows.nextCursor = { recordedAt: rows.items[1].submittedAt, requestId: rows.items[1].requestId };
  assert.deepEqual(parseSelfRevisionHistoryResult(rows, query()), rows);
});
test("self revision executor calls only readonly RPC with authoritative actor and sanitizes invalid backend replies", async () => {
  const input = { query: query(), authUserId: id(1) }, calls: unknown[] = [];
  assert.deepEqual(await executeSelfRevisionHistory(input, { rpc: async (name, args) => { calls.push({ name, args }); return { data: result(), error: null }; } }), result());
  const { siteId, ...p_query } = query();
  assert.deepEqual(calls, [{ name: "faolla_attendance_self_revision_history_v1", args: { p_site_id: siteId, p_auth_user_id: id(1), p_query } }]);
  await assert.rejects(executeSelfRevisionHistory(input, null), /attendance_unavailable/);
  for (const response of [{ data: { ...result(), employeeId: null }, error: null }, { data: null, error: { message: "private database detail" } }])
    await assert.rejects(executeSelfRevisionHistory(input, { rpc: async () => response }), { message: "attendance_unavailable" });
  await assert.rejects(executeSelfRevisionHistory(input, { rpc: async () => { throw Error("private details"); } }), { message: "attendance_unavailable" });
  await assert.rejects(executeSelfRevisionHistory(input, { rpc: async () => ({ data: null, error: { message: "attendance_worker_changed" } }) }), /attendance_worker_changed/);
});
