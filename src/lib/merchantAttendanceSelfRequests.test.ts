import assert from "node:assert/strict";
import test from "node:test";
import { parseSelfRequestsQuery, parseSelfRequestsHttpQuery, parseSelfRequestsResult, parseSelfRequestsResponse, selfRequestsQueryString,
  type SelfRequestsQuery, type SelfRequestsResult } from "./merchantAttendanceSelfRequests";
import { executeSelfRequests } from "./merchantAttendanceSelfRequests.server";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const query = (): SelfRequestsQuery => ({ siteId: "99990001", expectedEmployeeId: id(101), expectedWorkerId: id(201), kind: "all", status: "all",
  asOf: null, cursorAt: null, cursorKind: null, cursorId: null });
const result = (): SelfRequestsResult => ({ protocol: "self-requests-v1", readOnly: true, siteId: "99990001", employeeId: id(101), workerId: id(201),
  asOf: "2026-10-03T10:00:00.000001Z", scanned: 3, nextCursor: null,
  items: (["missing", "revision", "correction"] as const).map(kind => ({ kind, requestId: id(601), rootRequestId: kind === "revision" ? id(501) : id(601),
    workerId: id(201), employeeId: id(101), workerName: "合成人员", workerNo: "A01", submittedAt: "2026-01-01T10:00:00.000001Z",
    proposedStartAt: "2025-12-31T08:00:00.000000Z", proposedEndAt: "2025-12-31T16:00:00.000000Z", status: "submitted", closedAt: null })) });
const url = (q = query()) => "https://www.faolla.com/api/merchant-enterprise/attendance/self-requests?" + selfRequestsQueryString(q);

test("self requests query pins employee and worker with a complete typed cursor and no actor/date override", () => {
  assert.deepEqual(parseSelfRequestsHttpQuery(url()), query());
  const paged = { ...query(), asOf: result().asOf, cursorAt: result().items[0].submittedAt, cursorKind: "missing" as const, cursorId: id(601) };
  assert.deepEqual(parseSelfRequestsQuery(paged), paged);
  for (const suffix of ["&access=owner", "&authUserId=" + id(99), "&fromDate=2026-01-01", "&limit=10000", "&siteId=99990001", "&status=all"])
    assert.throws(() => parseSelfRequestsHttpQuery(url() + suffix));
  for (const patch of [{ expectedEmployeeId: null }, { expectedWorkerId: null }, { status: "pending" }, { kind: "all-payroll" }, { cursorId: id(1) },
    { ...paged, asOf: null }, { ...paged, kind: "correction" }, { ...paged, cursorKind: null }, { ...paged, cursorAt: "2026-10-04T00:00:00.000000Z" },
    { asOf: "2026-02-30T00:00:00.000000Z" }, { asOf: "2026-10-03T10:00:00.000Z" }]) assert.throws(() => parseSelfRequestsQuery({ ...query(), ...patch }));
});
test("self requests combine all kinds across dates without conflating same microsecond and UUID", () => {
  assert.deepEqual(parseSelfRequestsResult(result(), query()), result());
  const v = result(); v.items = [v.items[0]]; v.scanned = 1;
  for (const status of ["submitted", "approved", "rejected", "withdrawn"] as const) {
    Object.assign(v.items[0], { status, closedAt: status === "submitted" ? null : v.items[0].submittedAt });
    assert.equal(parseSelfRequestsResult(v, { ...query(), kind: "missing", status }).items[0].status, status);
  }
  assert.equal(parseSelfRequestsResponse({ ok: true, moduleEnabled: false, ...result() }, query()).moduleEnabled, false);
});
test("self requests enforce exact envelope, both identities, source roots, status/time and no sensitive extras", () => {
  const changes: ((v: SelfRequestsResult) => void)[] = [v => v.siteId = "99990002", v => v.employeeId = id(102), v => v.workerId = id(202),
    v => v.items[0].employeeId = id(102), v => v.items[0].workerId = id(202), v => v.items.reverse(), v => v.items[1].rootRequestId = id(601),
    v => v.items[2].rootRequestId = id(501), v => v.items[0].closedAt = v.asOf, v => v.items[0].status = "approved", v => v.scanned = 2,
    v => v.scanned = 51, v => v.items[0].submittedAt = "2026-10-04T00:00:00.000000Z", v => v.items[0].proposedEndAt = v.asOf,
    v => v.items[0].workerName = "bad\nname", v => v.items[0].workerNo = "a".repeat(41), v => v.items[1] = { ...v.items[0] }];
  for (const change of changes) { const v = result(); change(v); assert.throws(() => parseSelfRequestsResult(v, query())); }
  const terminal = result(); terminal.items[0].status = "approved"; terminal.items[0].closedAt = "2025-12-31T10:00:00.000000Z";
  assert.throws(() => parseSelfRequestsResult(terminal, query())); terminal.items[0].closedAt = "2026-10-04T10:00:00.000000Z";
  assert.throws(() => parseSelfRequestsResult(terminal, query()));
  for (const extra of [{ authUserId: id(1) }, { coordinates: [1, 2] }, { reason: "private" }, { decisionOperationId: id(1) }]) {
    assert.throws(() => parseSelfRequestsResult({ ...result(), ...extra }, query())); const v = result(); Object.assign(v.items[0], extra);
    assert.throws(() => parseSelfRequestsResult(v, query()));
  }
  assert.throws(() => parseSelfRequestsResult(result(), { ...query(), status: "approved" }));
  assert.throws(() => parseSelfRequestsResult(result(), { ...query(), kind: "revision" }));
  assert.throws(() => parseSelfRequestsResponse({ ok: true, moduleEnabled: "true", ...result() }, query()));
});
test("self requests empty filtered pages advance from scanned candidates and preserve full DESC tie boundaries", () => {
  const v = result(); v.items = []; v.scanned = 50; v.nextCursor = { recordedAt: "2026-01-01T10:00:00.000001Z", kind: "revision", requestId: id(601) };
  const q = { ...query(), asOf: v.asOf, cursorAt: v.nextCursor.recordedAt, cursorKind: "missing" as const, cursorId: id(601) };
  assert.deepEqual(parseSelfRequestsResult(v, q).nextCursor, v.nextCursor);
  for (const change of [() => { v.scanned = 49; }, () => { v.nextCursor!.kind = "missing"; }, () => { v.nextCursor!.recordedAt = "2026-10-04T00:00:00.000000Z"; }]) {
    const original = structuredClone(v); change(); assert.throws(() => parseSelfRequestsResult(v, q)); Object.assign(v, original);
  }
  const after = result(); after.items = [after.items[2]]; after.scanned = 1;
  assert.equal(parseSelfRequestsResult(after, { ...q, cursorKind: "revision" }).items[0].kind, "correction");
  assert.throws(() => parseSelfRequestsResult(after, { ...q, cursorKind: "correction" }));
});
test("self requests reject repeated and unpinned pages without treating an empty final page as missing attendance", () => {
  const v = result(), q = { ...query(), asOf: v.asOf, cursorAt: v.items[0].submittedAt, cursorKind: "missing" as const, cursorId: id(601) };
  assert.throws(() => parseSelfRequestsResult(v, q));
  assert.throws(() => parseSelfRequestsResult(v, { ...query(), asOf: "2026-10-03T10:00:00.000000Z" }));
  assert.equal(parseSelfRequestsResult({ ...v, items: [], scanned: 0 }, q).nextCursor, null);
});
test("self requests executor uses service RPC with authoritative auth and sanitized strict identity replies", async () => {
  const q = query(), { siteId, ...rest } = q, input = { query: q, authUserId: id(1) };
  assert.deepEqual(await executeSelfRequests(input, { rpc: async (name, args) => {
    assert.equal(name, "faolla_attendance_self_requests_v1"); assert.deepEqual(args, { p_site_id: siteId, p_auth_user_id: id(1), p_query: rest });
    return { data: result(), error: null };
  } }), result());
  await assert.rejects(() => executeSelfRequests(input, null), /attendance_unavailable/);
  await assert.rejects(() => executeSelfRequests(input, { rpc: async () => ({ data: { ...result(), employeeId: id(102) }, error: null }) }), /attendance_unavailable/);
  for (const [message, expected] of [["attendance_access_denied", "attendance_access_denied"], ["private SQL values", "attendance_unavailable"]])
    await assert.rejects(() => executeSelfRequests(input, { rpc: async () => ({ data: null, error: { message } }) }), new RegExp(expected));
  await assert.rejects(() => executeSelfRequests(input, { rpc: async () => { throw Error("private network"); } }), /attendance_unavailable/);
});
