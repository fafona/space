import assert from "node:assert/strict";
import test from "node:test";
import { administrativeReportBoundaryProjection, administrativeReportBoundaryMatches, parseAdministrativeReportBoundary, administrativeSegmentBoundaries } from "./merchantAttendanceAdministrativeBoundary";
import { parseAttendanceSelfResult } from "./merchantAttendanceSelf";
import { parseAttendanceSessionResult, summarizeAttendanceSessionRecords, type AttendanceSessionEvent } from "./merchantAttendanceSession";
import { parseOnsiteClockResult } from "./merchantAttendanceOnsiteQr";
import { parsePinClockResult } from "./merchantAttendancePinClock";
import type { AdministrativeClosureBoundary } from "./merchantAttendanceAdministrativeClosure";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`, siteId = "99990001";
const startAt = "2026-10-07T08:00:00.000000Z", tailAt = "2026-10-07T09:00:00.000000Z", at = "2026-10-07T11:00:00.000000Z";
function full(): AdministrativeClosureBoundary { return { protocol: "attendance-administrative-boundary-v1", siteId, operationId: id(90), revision: 1,
  workerId: id(1), employeeId: id(2), employeeAuthUserId: id(3), employmentPeriodId: id(4), suspensionId: id(5), generation: 1,
  startEventId: id(10), startSequence: 1, startAt, tailEventId: id(11), tailSequence: 2, tailAction: "break_start", tailOccurredAt: tailAt,
  timeZone: "UTC", verifiedEndAt: "2026-10-07T10:00:00.000000Z", recordedAt: at, sourceFingerprint: "a".repeat(64) }; }
function events(): AttendanceSessionEvent[] { return [{ id: id(10), locationId: id(6), sequence: 1, action: "clock_in", occurredAt: startAt, timeZone: "UTC", breakPaid: null, source: "web" },
  { id: id(11), locationId: id(6), sequence: 2, action: "break_start", occurredAt: tailAt, timeZone: "UTC", breakPaid: false, source: "web" }]; }
function clock() { const { source, ...e } = events()[1]; void source; return { workerId: id(1), locationId: id(6), state: { sequence: 2, status: "off", administrativeBoundary: full(),
  lastEvent: { ...e, siteId, workerId: id(1), operationId: id(21), occurredAt: e.occurredAt.slice(0, 23) + "Z" } }, receipt: null, replayed: false }; }
const expected = { siteId, command: null, operationId: null };
function session(es = events()) { return { siteId, employeeId: id(2), workerId: id(1), asOf: at, events: es }; }

test("public boundary is exactly12 immutable fields without employee/Auth/reason leakage", () => {
  const projected = administrativeReportBoundaryProjection(full()); assert.equal(Object.keys(projected).length, 12); assert(Object.isFrozen(projected));
  assert(administrativeReportBoundaryMatches(projected, full()));
  for (const field of ["employeeId", "employeeAuthUserId", "workerId", "employmentPeriodId", "suspensionId", "generation", "reason"]) assert(!Object.hasOwn(projected, field));
  assert(!administrativeReportBoundaryMatches({ ...projected, sourceFingerprint: "b".repeat(64) }, full()));
  assert.throws(() => parseAdministrativeReportBoundary(full()));
});
test("public proof rejects unknown fields, getters, malformed chronology and false first/tail relation", () => {
  const b = administrativeReportBoundaryProjection(full()); let reads = 0;
  assert.throws(() => parseAdministrativeReportBoundary({ ...b, get sourceFingerprint() { reads++; return b.sourceFingerprint; } })); assert.equal(reads, 0);
  for (const patch of [{ actorId: id(9) }, { protocol: "attendance-administrative-boundary-v1" }, { sourceFingerprint: "a".repeat(64) + "\n" },
    { startSequence: -0 }, { tailSequence: 0 }, { tailSequence: 2003 }, { tailAction: "clock_out" }, { tailEventId: b.startEventId },
    { verifiedEndAt: startAt }, { recordedAt: startAt }, { recordedAt: "2026-02-30T11:00:00.000000Z" }, { tailAction: "clock_in" }])
    assert.throws(() => parseAdministrativeReportBoundary({ ...b, ...patch }));
  const one = { ...b, tailSequence: b.startSequence, tailEventId: b.startEventId, tailAction: "clock_in", tailOccurredAt: b.startAt };
  assert.doesNotThrow(() => parseAdministrativeReportBoundary(one));
});
test("clock off requires exact full boundary over preserved raw tail, never a fake clock-out", () => {
  const result = parseAttendanceSelfResult(clock(), expected); assert.equal(result.state.status, "off"); assert.equal(result.state.lastEvent!.action, "break_start");
  assert.equal(result.state.sequence, 2); assert.deepEqual(result.state.administrativeBoundary, full());
  for (const patch of [{ workerId: id(7) }, { siteId: "99990002" }, { tailEventId: id(40) }, { tailSequence: 3 }, { timeZone: "Europe/Madrid" },
    { tailOccurredAt: "2026-10-07T09:00:00.000001Z" }]) assert.throws(() => parseAttendanceSelfResult({ ...clock(), state: { ...clock().state, administrativeBoundary: { ...full(), ...patch } } }, expected));
  for (const b of [null, undefined, administrativeReportBoundaryProjection(full())]) assert.throws(() => parseAttendanceSelfResult({ ...clock(), state: { ...clock().state, administrativeBoundary: b } }, expected));
  assert.throws(() => parseAttendanceSelfResult({ ...clock(), state: { ...clock().state, status: "break" } }, expected));
  let reads = 0; assert.throws(() => parseAttendanceSelfResult({ ...clock(), state: { ...clock().state, get administrativeBoundary() { reads++; return full(); } } }, expected)); assert.equal(reads, 0);
});
test("old clock state has identical shape and cannot silently use new off semantics", () => {
  const old = { ...clock(), state: { sequence: 2, status: "break", lastEvent: clock().state.lastEvent } };
  assert.equal(Object.hasOwn(parseAttendanceSelfResult(old, expected).state, "administrativeBoundary"), false);
  assert.throws(() => parseAttendanceSelfResult({ ...old, state: { ...old.state, status: "off" } }, expected));
});
test("onsite and PIN retain exact employee binding for an administrative boundary", () => {
  const onsite = { ...clock(), employeeId: id(2) }; assert.doesNotThrow(() => parseOnsiteClockResult(onsite, expected));
  assert.throws(() => parseOnsiteClockResult({ ...onsite, employeeId: id(99) }, expected));
  const pin = { ...onsite, siteId, terminalId: id(7), workerNo: "SYN-1", workerName: "合成人员", canStart: true, canFinish: true, blockReason: null };
  const input = { ...expected, terminalId: id(7), workerNo: "SYN-1" }; assert.doesNotThrow(() => parsePinClockResult(pin, input));
  assert.throws(() => parsePinClockResult({ ...pin, employeeId: id(99) }, input));
});
test("administrative old session preserves open raw work/break and null totals, not zero or verified-end hours", () => {
  const value = { ...session(), administrativeBoundary: administrativeReportBoundaryProjection(full()), predecessorBoundary: null };
  const parsed = parseAttendanceSessionResult(value, { siteId, startEventId: id(10) }), report = summarizeAttendanceSessionRecords(parsed);
  assert.equal(report.status, "break"); assert.equal(report.endAt, null); assert.equal(report.totals, null); assert.deepEqual(report.days, []);
  assert.equal(parsed.events.length, 2); assert.equal(parsed.events.at(-1)!.action, "break_start");
  for (const patch of [{ administrativeBoundary: { ...value.administrativeBoundary, tailEventId: id(90) } }, { asOf: tailAt }, { predecessorBoundary: value.administrativeBoundary }])
    assert.throws(() => parseAttendanceSessionResult({ ...value, ...patch }, { siteId, startEventId: id(10) }));
});
test("next real session uses exact sequence predecessor proof and its own complete hours", () => {
  const es: AttendanceSessionEvent[] = [{ ...events()[0], id: id(12), sequence: 3, occurredAt: "2026-10-08T08:00:00.000000Z" },
    { ...events()[0], id: id(13), sequence: 4, action: "clock_out", occurredAt: "2026-10-08T09:00:00.000000Z" }];
  const value = { ...session(es), asOf: "2026-10-08T10:00:00.000000Z", administrativeBoundary: null, predecessorBoundary: administrativeReportBoundaryProjection(full()) };
  const parsed = parseAttendanceSessionResult(value, { siteId, startEventId: id(12) });
  assert.equal(summarizeAttendanceSessionRecords(parsed).totals!.workedUs, 3600000000);
  for (const patch of [{ tailSequence: 3 }, { verifiedEndAt: "2026-10-08T08:00:00.000001Z", recordedAt: value.asOf }, { tailEventId: es[0].id }])
    assert.throws(() => parseAttendanceSessionResult({ ...value, predecessorBoundary: { ...value.predecessorBoundary, ...patch } }, { siteId, startEventId: id(12) }));
});
test("legacy session has no compatibility keys; partial/null-only proof cannot create a new branch", () => {
  const query = { siteId, startEventId: id(10) }, old = parseAttendanceSessionResult(session(), query);
  assert(!Object.hasOwn(old, "administrativeBoundary")); assert(!Object.hasOwn(old, "predecessorBoundary"));
  for (const patch of [{ administrativeBoundary: null }, { predecessorBoundary: null }, { administrativeBoundary: null, predecessorBoundary: null }])
    assert.throws(() => parseAttendanceSessionResult({ ...session(), ...patch }, query));
  let reads = 0; assert.throws(() => administrativeSegmentBoundaries({ get administrativeBoundary() { reads++; return null; }, predecessorBoundary: null }, events(), at)); assert.equal(reads, 0);
});
