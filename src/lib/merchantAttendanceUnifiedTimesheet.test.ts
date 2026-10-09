import assert from "node:assert/strict";
import test from "node:test";
import { sheetWire, firstApprovalSourceV2, timesheetQuery, timesheetId as id } from "../../scripts/fixtures/attendance-timesheet-model";
import { parseUnifiedQuery, unifiedQueryString, parseUnifiedSource, parseUnifiedResponse, type UnifiedQuery, type MissingReportSource } from "./merchantAttendanceUnifiedTimesheet";
import { executeUnifiedTimesheet } from "./merchantAttendanceUnifiedTimesheet.server";
import { UnifiedTimesheetClient } from "./merchantAttendanceUnifiedTimesheetClient";
const q = { ...timesheetQuery, access: "owner" } satisfies UnifiedQuery;
const source = (): MissingReportSource => ({ source: "missing-approved", requestId: id(500), operationId: id(501), workerId: q.workerId, employeeId: null,
  workerName: "提交时员工", locationId: id(5), locationName: "合成地点", timeZone: "Europe/Madrid", policyRevision: 1,
  proposal: { startAt: "2026-09-06T21:00:00.000000Z", endAt: "2026-09-07T05:00:00.000000Z", breaks: [{ startAt: "2026-09-06T22:30:00.000000Z", endAt: "2026-09-06T23:30:00.000000Z", paid: true }] },
  submittedAt: "2026-09-07T06:00:00.000000Z", approvedAt: "2026-09-07T07:00:00.000000Z" });
const wire = () => ({ version: "attendance-unified-v1", access: "owner", base: firstApprovalSourceV2(sheetWire()), missing: [source()], complete: true, payrollReady: false });
const response = () => ({ ok: true, ...parseUnifiedSource(wire(), q), moduleEnabled: true });
test("unified queries strictly separate owner, self and granted manager targets", () => {
  assert.deepEqual(parseUnifiedQuery(`https://local.invalid/?${unifiedQueryString(q)}`), q);
  for (const suffix of ["&access=self", "&employeeId=" + id(2), "&expectedWorkerId=" + id(4), "&locationId=" + id(5), "&fromDate=2026-09-02"]) assert.throws(() => parseUnifiedQuery(`https://local.invalid/?${unifiedQueryString(q)}${suffix}`));
  for (const changed of [{ access: "self" }, { throughDate: "2026-10-02" }, { fromDate: "2026-02-30" }]) assert.throws(() => parseUnifiedQuery(`https://local.invalid/?${unifiedQueryString({ ...q, ...changed } as UnifiedQuery)}`));
});
test("unified totals keep raw and corrected amounts separate and add missing approval only once", () => {
  const before = wire(), r = parseUnifiedSource(before, q);
  assert.equal(r.totals.original.workedUs, 8 * 3600000000); assert.equal(r.totals.recordedSelected.workedUs, 8 * 3600000000);
  assert.equal(r.totals.missingSelected.workedUs, 7 * 3600000000); assert.equal(r.totals.selected.workedUs, 15 * 3600000000);
  assert.equal(r.totals.missingSelected.paidBreakUs, 3600000000); assert.equal(r.totals.selected.workedUs + r.totals.selected.breakUs, r.totals.selected.elapsedUs);
  assert.equal(Object.hasOwn(r.missing[0], "startEventId"), false); assert.deepEqual(before, wire());
  assert.equal(r.days.find(d => d.date === "2026-09-06")!.missingSelected.workedUs, 3600000000);
  assert.equal(r.days.find(d => d.date === "2026-09-07")!.missingSelected.workedUs, 6 * 3600000000);
});
test("computed HTTP payload is recomputed and rejects altered totals, daily amounts or source amounts", () => {
  const r = response(); assert.deepEqual(parseUnifiedResponse(r, q, id(1)), { ...parseUnifiedSource(wire(), q), moduleEnabled: true });
  const badTotal = structuredClone(r); badTotal.totals.selected.workedUs++; assert.throws(() => parseUnifiedResponse(badTotal, q, id(1)));
  const badDay = structuredClone(r); badDay.days[0].missingSelected.elapsedUs++; assert.throws(() => parseUnifiedResponse(badDay, q, id(1)));
  const badPart = structuredClone(r); badPart.missing[0].inPeriod.paidBreakUs++; assert.throws(() => parseUnifiedResponse(badPart, q, id(1)));
});
test("unified source identity, scope, order and immutable approval timestamps are bound", () => {
  for (const patch of [{ source: "pending" }, { employeeId: id(2) }, { workerId: id(999) }, { requestId: id(501) }, { policyRevision: 0 },
    { approvedAt: "2026-09-01T00:00:00.000000Z" }, { submittedAt: "2026-09-07T03:00:00.000000Z" }, { approvedAt: "2026-10-01T00:00:00.000000Z" }]) assert.throws(() => parseUnifiedSource({ ...wire(), missing: [{ ...source(), ...patch }] }, q));
  assert.throws(() => parseUnifiedSource({ ...wire(), missing: [source(), source()] }, q));
  assert.throws(() => parseUnifiedSource({ ...wire(), version: "auto" }, q));
  assert.throws(() => parseUnifiedSource({ ...wire(), complete: false }, q));
  assert.throws(() => parseUnifiedSource({ ...wire(), missing: Array(100).fill(source()) }, q), /attendance_report_too_large/);
});
test("overlapping approved sources fail closed; no silent subtraction or zero-hour result", () => {
  const overlap = { ...source(), proposal: { startAt: "2026-09-05T09:00:00.000000Z", endAt: "2026-09-05T10:00:00.000000Z", breaks: [] } };
  assert.throws(() => parseUnifiedSource({ ...wire(), missing: [overlap] }, q), /attendance_report_reconciliation_required/);
  const second = { ...source(), requestId: id(502), operationId: id(503), proposal: { ...source().proposal, startAt: "2026-09-06T21:30:00.000000Z" } };
  assert.throws(() => parseUnifiedSource({ ...wire(), missing: [source(), second] }, q), /attendance_report_reconciliation_required/);
});
test("adjacent sources are allowed and microsecond duration is preserved", () => {
  const tiny = { ...source(), proposal: { startAt: "2026-09-05T16:00:00.000000Z", endAt: "2026-09-05T16:00:00.000001Z", breaks: [] } };
  const r = parseUnifiedSource({ ...wire(), missing: [tiny] }, q); assert.equal(r.missing[0].inPeriod.workedUs, 1); assert.equal(r.totals.selected.workedUs, 8 * 3600000000 + 1);
});
test("autumn DST cross-midnight time is split by real local day boundaries", () => {
  const query = { ...q, fromDate: "2026-10-24", throughDate: "2026-10-25" }, base = { ...wire().base, fromDate: query.fromDate, throughDate: query.throughDate,
    fromAt: "2026-10-23T22:00:00.000000Z", toAt: "2026-10-25T23:00:00.000000Z", asOf: "2026-10-26T00:00:00.000000Z", items: [] };
  const m = { ...source(), proposal: { startAt: "2026-10-24T20:00:00.000000Z", endAt: "2026-10-25T05:00:00.000000Z", breaks: [{ startAt: "2026-10-25T00:30:00.000000Z", endAt: "2026-10-25T01:30:00.000000Z", paid: false }] }, submittedAt: "2026-10-25T06:00:00.000000Z", approvedAt: "2026-10-25T07:00:00.000000Z" };
  const r = parseUnifiedSource({ ...wire(), base, missing: [m] }, query); assert.equal(r.totals.selected.workedUs, 8 * 3600000000);
  assert.deepEqual(r.days.map(d => d.selected.workedUs), [2 * 3600000000, 6 * 3600000000]);
});
function scoped(access: "self" | "manager") {
  const query: UnifiedQuery = access === "self" ? { siteId: q.siteId, access, expectedWorkerId: q.workerId, fromDate: q.fromDate, throughDate: q.throughDate } : { ...q, access, locationId: id(5) };
  const base = { ...wire().base, access, viewerEmployeeId: id(access === "self" ? 2 : 3), scopeRevision: access === "self" ? null : 1,
    locationId: access === "self" ? null : id(5), coverage: "authorized-complete-sessions-v1", accessValidUntil: null };
  base.items.forEach(row => row.events.forEach(e => Object.assign(e, { actorEmployeeId: id(2) })));
  return { query, raw: { ...wire(), access, base, missing: [{ ...source(), employeeId: access === "self" ? id(2) : null }] } };
}
test("self and manager use same calculation but distinct scope protocol and no target employee leak", () => {
  for (const access of ["self", "manager"] as const) { const s = scoped(access), report = parseUnifiedSource(s.raw, s.query);
    assert.equal(report.totals.selected.workedUs, 15 * 3600000000); assert.equal(Object.hasOwn(report.base, "employeeId"), false);
    assert.equal(parseUnifiedResponse({ ok: true, ...report, moduleEnabled: true }, s.query, id(access === "self" ? 2 : 3)).missing.length, 1);
    assert.throws(() => parseUnifiedResponse({ ok: true, ...report, moduleEnabled: true }, s.query, id(999)));
  }
  const self = scoped("self"); assert.throws(() => parseUnifiedSource({ ...self.raw, missing: [{ ...self.raw.missing[0], employeeId: id(3) }] }, self.query));
  const manager = scoped("manager"); assert.throws(() => parseUnifiedSource({ ...manager.raw, missing: [{ ...manager.raw.missing[0], locationId: id(6) }] }, manager.query));
});
test("unified executor calls one allowlisted RPC with server identity; unknown errors and old protocol never fall back", async () => {
  const calls: string[] = [], input = { query: q, authUserId: id(1) };
  const r = await executeUnifiedTimesheet(input, { rpc: async (name, args) => { calls.push(name); assert.equal(args.p_auth_user_id, id(1)); assert.equal(args.p_site_id, q.siteId); return { data: wire(), error: null }; } });
  assert.equal(r.missing.length, 1); assert.deepEqual(calls, ["faolla_attendance_unified_report_v1"]);
  for (const code of ["secret_sql", "function_missing"]) await assert.rejects(executeUnifiedTimesheet(input, { rpc: async () => ({ data: null, error: { message: code } }) }), /attendance_unavailable/);
  await assert.rejects(executeUnifiedTimesheet(input, { rpc: async () => ({ data: sheetWire(), error: null }) }), /attendance_unavailable/);
});
test("unified client is GET-only and never persists reports or auto-polls", async () => {
  const calls: string[] = [], client = new UnifiedTimesheetClient({ query: q, actorId: id(1), apiFetch: async (_url, init) => { calls.push(init?.method ?? "GET"); return Response.json(response()); } });
  try { assert.equal(calls.length, 0); await client.load(q); assert.equal(client.getSnapshot().phase, "ready"); assert.deepEqual(calls, ["GET"]);
    await client.load({ ...q, workerId: id(999) }); assert.equal(client.getSnapshot().result, null); assert.equal(calls.length, 1);
  } finally { client.invalidate(); }
});
test("client clears old protected totals on failure; paused platform remains readable", async () => {
  let fail = false; const client = new UnifiedTimesheetClient({ query: q, actorId: id(1), apiFetch: async () => fail ? Response.json({ ok: false, error: "attendance_report_reconciliation_required" }, { status: 422 }) : Response.json({ ...response(), moduleEnabled: false }) });
  try { await client.load(q); assert.equal(client.getSnapshot().result?.moduleEnabled, false); fail = true; await client.load(q); assert.equal(client.getSnapshot().result, null); assert.match(client.getSnapshot().message, /暂不展示合计/); }
  finally { client.invalidate(); }
});
test("late response after hiding cannot restore protected report", async () => {
  let release!: (r: Response) => void; const pending = new Promise<Response>(resolve => { release = resolve; });
  const client = new UnifiedTimesheetClient({ query: q, actorId: id(1), apiFetch: () => pending }); const read = client.load(q); client.invalidate(); release(Response.json(response())); await read;
  assert.equal(client.getSnapshot().result, null); assert.equal(client.getSnapshot().phase, "idle");
});

test("an authoritative denial or worker rebind also invalidates the parent report; data conflicts do not revoke unrelated access", async () => {
  for (const [code, status, expected] of [["attendance_access_denied", 403, 1], ["attendance_worker_changed", 409, 1], ["enterprise_management_disabled", 403, 1], ["unauthorized", 401, 1], ["employee_password_authentication_required", 403, 1], ["attendance_report_reconciliation_required", 422, 0], ["attendance_access_denied", 500, 0]] as const) {
    let denied = 0;
    const client = new UnifiedTimesheetClient({ query: q, actorId: id(1), onDenied: () => { denied++; }, apiFetch: async () => Response.json({ ok: false, error: code }, { status }) });
    try { await client.load(q); assert.equal(denied, expected, code); assert.equal(client.getSnapshot().result, null); }
    finally { client.invalidate(); }
  }
});
test("network latency cannot extend a manager grant; expired reply is hidden", async () => {
  const s = scoped("manager"); const base = { ...s.raw.base, accessValidUntil: "2026-09-30T12:00:01.000000Z" }, report = parseUnifiedSource({ ...s.raw, base }, s.query);
  let now = 0; const client = new UnifiedTimesheetClient({ query: s.query, actorId: id(3), monotonicNow: () => now, apiFetch: async () => { now = 1100; return Response.json({ ok: true, ...report, moduleEnabled: true }); } });
  await client.load(s.query); assert.equal(client.getSnapshot().result, null); assert.equal(client.getSnapshot().phase, "blocked"); client.invalidate();
});
test("display deadline clears report without polling or renewing access", async () => {
  let calls = 0; const client = new UnifiedTimesheetClient({ query: q, actorId: id(1), displayMs: 200, apiFetch: async () => { calls++; return Response.json(response()); } });
  try { await client.load(q); assert.equal(client.getSnapshot().phase, "ready"); await new Promise(resolve => setTimeout(resolve, 230)); assert.equal(client.getSnapshot().result, null); assert.equal(calls, 1); }
  finally { client.invalidate(); }
});
