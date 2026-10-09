import assert from "node:assert/strict";
import test from "node:test";
import { parseAttendanceTimesheetResult } from "./merchantAttendanceTimesheet";
import { parseAttendanceTimesheetResponse } from "./merchantAttendanceTimesheetResponse";
import { sheetWire, sheetEvent, timesheetId as id, timesheetQuery as query } from "../../scripts/fixtures/attendance-timesheet-model";
import type { AdministrativeReportBoundary } from "./merchantAttendanceAdministrativeBoundary";
const version = "raw-and-approved-v3";
function proof(): AdministrativeReportBoundary { return { protocol: "attendance-administrative-report-boundary-v1", operationId: id(900), startEventId: id(101),
  startSequence: 1, startAt: "2026-09-05T08:00:00.000000Z", tailEventId: id(102), tailSequence: 2, tailAction: "break_start", tailOccurredAt: "2026-09-05T09:00:00.000000Z",
  verifiedEndAt: "2026-09-05T10:00:00.000000Z", recordedAt: "2026-09-05T11:00:00.000000Z", sourceFingerprint: "a".repeat(64) }; }
function wire() { const b = proof(); return { ...sheetWire(), sourceVersion: version, administrativeUnassessedCount: 1, totalsComplete: false,
  items: [{ startEventId: id(101), events: [sheetEvent(1, "clock_in", b.startAt), sheetEvent(2, "break_start", b.tailOccurredAt)], effect: null,
    administrativeBoundary: b, predecessorBoundary: null },
  { startEventId: id(103), events: [sheetEvent(3, "clock_in", "2026-09-06T08:00:00.000000Z"), sheetEvent(4, "clock_out", "2026-09-06T10:00:00.000000Z")], effect: null,
    administrativeBoundary: null, predecessorBoundary: b }] }; }
function parsed() { return parseAttendanceTimesheetResult(wire(), query, version); }
function http() { return { ok: true, moduleEnabled: true, ...parsed() }; }
test("v3 raw and computed roundtrip retain unknown administrative hours and known subsequent real hours separately", () => {
  const raw = wire(), before = structuredClone(raw), result = parsed(); assert.deepEqual(raw, before);
  assert.equal(result.rows[0].originalInPeriod, null); assert.equal(result.rows[0].selectedInPeriod, null);
  assert.equal(result.rows[0].original.endAt, null); assert.equal(result.rows[0].original.totals, null);
  assert.equal(result.rows[0].original.status, "break"); assert.equal(result.rows[1].selectedInPeriod!.workedUs, 7200000000);
  assert.equal(result.totals.selected.workedUs, 7200000000); assert.equal(result.administrativeUnassessedCount, 1); assert.equal(result.totalsComplete, false);
  assert.deepEqual(parseAttendanceTimesheetResponse(http(), query, version), { ...result, moduleEnabled: true });
});
test("later day containing only completed successor has complete known totals without old unknown leaking in", () => {
  const q = { ...query, fromDate: "2026-09-06", throughDate: "2026-09-06" }, w = wire(); w.items.shift();
  Object.assign(w, q, { fromAt: "2026-09-05T22:00:00.000000Z", toAt: "2026-09-06T22:00:00.000000Z", administrativeUnassessedCount: 0, totalsComplete: true });
  const r = parseAttendanceTimesheetResult(w, q, version); assert.equal(r.totalsComplete, true); assert.equal(r.openSessionCount, 0); assert.equal(r.administrativeUnassessedCount, 0);
  assert.equal(r.totals.selected.workedUs, 7200000000); assert.deepEqual(parseAttendanceTimesheetResponse({ ok: true, moduleEnabled: false, ...r }, q, version), { ...r, moduleEnabled: false });
  w.items.unshift(wire().items[0]); assert.throws(() => parseAttendanceTimesheetResult(w, q, version));
});
test("neither old parser version nor proof-free label can opt into administrative off semantics", () => {
  for (const v of ["raw-and-approved-v1", "raw-and-approved-v2"] as const) {
    assert.throws(() => parseAttendanceTimesheetResult(wire(), query, v)); assert.throws(() => parseAttendanceTimesheetResponse(http(), query, v));
  }
  const empty = { ...wire(), items: [], administrativeUnassessedCount: 0, totalsComplete: true }; assert.throws(() => parseAttendanceTimesheetResult(empty, query, version));
  const old = { ...sheetWire(), sourceVersion: "raw-and-approved-v2" }; const r = parseAttendanceTimesheetResult(old, query, "raw-and-approved-v2");
  assert(!Object.hasOwn(r, "administrativeUnassessedCount")); assert(!Object.hasOwn(r.rows[0], "administrativeBoundary"));
});
test("raw v3 requires both strict public proofs and exact first/tail, predecessor, chronology, totals and row scopes", () => {
  const patches: ((w: ReturnType<typeof wire>) => void)[] = [w => { w.items[1].predecessorBoundary = null; },
    w => { Object.assign(w.items[0].administrativeBoundary!, { tailEventId: id(999) }); }, w => { Object.assign(w.items[0].administrativeBoundary!, { tailSequence: 3 }); },
    w => { Object.assign(w.items[0].administrativeBoundary!, { recordedAt: "2026-10-01T00:00:00.000000Z" }); }, w => { w.administrativeUnassessedCount = 0; },
    w => { w.totalsComplete = true; }, w => { Object.assign(w.items[0].administrativeBoundary!, { employeeAuthUserId: id(9) }); },
    w => { w.items[1].events[0].sequence++; }, w => { w.items[0].events[1].action = "clock_out"; }, w => { w.items[0].events[1].breakPaid = null; },
    w => { Object.assign(w.items[0], { private: true }); }, w => { Object.assign(w.items[1].predecessorBoundary!, { sourceFingerprint: "b".repeat(64) }); }];
  for (const patch of patches) { const w = wire(); // Detach shared proof so an adversarial change cannot rewrite both sides together.
    w.items = structuredClone(w.items); w.items[1].predecessorBoundary = { ...proof() }; patch(w); assert.throws(() => parseAttendanceTimesheetResult(w, query, version)); }
});
test("computed v3 cannot substitute zero, complete totals, another identity or a clock-out for unknown hours", () => {
  const patches: ((r: ReturnType<typeof http>) => void)[] = [r => { r.rows[0].originalInPeriod = { elapsedUs: 0, breakUs: 0, paidBreakUs: 0, workedUs: 0 }; },
    r => { r.rows[0].selectedInPeriod = { elapsedUs: 0, breakUs: 0, paidBreakUs: 0, workedUs: 0 }; }, r => { r.totalsComplete = true; },
    r => { r.administrativeUnassessedCount = 0; }, r => { Object.assign(r.rows[0].administrativeBoundary!, { tailEventId: id(999) }); },
    r => { Object.assign(r.rows[0].administrativeBoundary!, { tailAction: "break_end" }); }, r => { r.totals.selected.workedUs++; },
    r => { Object.assign(r.rows[0].administrativeBoundary!, { employeeId: id(8) }); }, r => { r.rows[0].predecessorBoundary = r.rows[0].administrativeBoundary; },
    r => { r.rows[0].original.endAt = proof().verifiedEndAt; }];
  for (const patch of patches) { const r = structuredClone(http()); patch(r); assert.throws(() => parseAttendanceTimesheetResponse(r, query, version)); }
});
