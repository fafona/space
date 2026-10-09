import assert from "node:assert/strict";
import test from "node:test";
import { calculatePlanLeaveEdges, type PlanLeaveEdgesInput, type PlanLeaveResolvedSource, type PlanLeaveWork } from "./merchantAttendancePlanLeaveEdges";
import { MerchantAttendanceError } from "./merchantAttendanceTime";

// Pure caller-resolved examples, not SQL/current-head/identity proofs.
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const at = (clock: string, day = "2026-10-06") => `${day}T${clock.length === 5 ? clock + ":00.000000" : clock}Z`;
const span = (start = "09:00", end = "17:00") => ({ startAt: at(start), endAt: at(end) });
function leave(n: number, start = "09:00", end = "10:00", status: PlanLeaveResolvedSource["status"] = "approved"): PlanLeaveResolvedSource {
  return { requestId: id(n), operationId: status === "submitted" ? id(n) : id(n + 1000), revision: status === "submitted" ? 1 : status === "cancelled" ? 3 : 2,
    status, ...span(start, end), recordedAt: at("08:00"), current: true };
}
function work(start: string | null = at("09:00"), end: string | null = at("17:00"), n = 1): PlanLeaveWork {
  return { kind: "session", sourceId: id(n + 2000), operationId: null, startAt: start, endAt: end };
}
function input(items: PlanLeaveResolvedSource[] = [], selected: PlanLeaveWork[] = [work()]): PlanLeaveEdgesInput {
  return { plan: span(), leave: { limited: false, resolved: true, items }, work: selected };
}
function rejects(raw: unknown, code = "attendance_plan_leave_edges_invalid") {
  assert.throws(() => calculatePlanLeaveEdges(raw), e => e instanceof MerchantAttendanceError && e.code === code);
}

test("no leave preserves plan edges and actual work without computing totals", () => {
  const value = input(), result = calculatePlanLeaveEdges(value);
  assert.deepEqual(result.approvedCoverage, []); assert.deepEqual(result.remainingRequired, [span()]);
  assert.equal(result.requiredStartAt, at("09:00")); assert.equal(result.requiredEndAt, at("17:00"));
  assert.equal(result.state, "required"); assert.equal(result.fullCoverage, false); assert.deepEqual(result.blockers, []);
  assert.deepEqual(result.work, value.work); assert(!Object.hasOwn(result, "workedUs")); assert(!Object.hasOwn(result, "candidate"));
});

test("only leading/trailing approved intersections move required edges; middle leave leaves both edges intact", () => {
  const partial = calculatePlanLeaveEdges(input([leave(1, "08:00", "10:00"), leave(2, "16:00", "18:00")], [work(at("10:00"), at("16:00"))]));
  assert.deepEqual(partial.remainingRequired, [span("10:00", "16:00")]); assert.equal(partial.state, "required");
  assert.deepEqual(partial.workLeaveOverlaps, []);
  const middle = calculatePlanLeaveEdges(input([leave(3, "12:00", "13:00")], [work(at("09:00"), at("12:00")), work(at("13:00"), at("17:00"), 2)]));
  assert.deepEqual(middle.remainingRequired, [span("09:00", "12:00"), span("13:00", "17:00")]);
  assert.equal(middle.requiredStartAt, at("09:00")); assert.equal(middle.requiredEndAt, at("17:00")); assert.equal(middle.state, "required");
});

test("overlapping and touching leave merges once, with stable complete contributing approval refs", () => {
  const a = leave(3, "08:00", "10:00"), b = leave(1, "09:30", "11:00"), c = leave(2, "11:00", "12:00");
  const result = calculatePlanLeaveEdges(input([a, b, c], [work(at("12:00"), at("17:00"))]));
  assert.equal(result.approvedCoverage!.length, 1); assert.deepEqual(result.approvedCoverage![0], { ...span("09:00", "12:00"),
    leaveRefs: [b, c, a].map(({ requestId, operationId, revision }) => ({ requestId, operationId, revision })) });
  assert.deepEqual(calculatePlanLeaveEdges(input([c, a, b], [work(at("12:00"), at("17:00"))])), result);
});

test("half-open touching is allowed; overlaps retain only each actually intersecting approval", () => {
  const result = calculatePlanLeaveEdges(input([leave(1, "09:00", "10:00"), leave(2, "10:00", "11:00")], [work(at("09:30"), at("10:00"))]));
  assert.deepEqual(result.blockers, ["work_leave_overlap"]); assert.equal(result.workLeaveOverlaps!.length, 1);
  assert.equal(result.workLeaveOverlaps![0].leave.requestId, id(1)); assert.deepEqual({ startAt: result.workLeaveOverlaps![0].startAt, endAt: result.workLeaveOverlaps![0].endAt }, span("09:30", "10:00"));
  const outsideLeave = calculatePlanLeaveEdges(input([leave(3, "08:00", "09:00"), leave(4, "17:00", "18:00")]));
  assert.deepEqual(outsideLeave.approvedCoverage, []); assert.deepEqual(outsideLeave.workLeaveOverlaps, []); assert.equal(outsideLeave.state, "required");
});

test("full coverage with no work is independent not_applicable, never fabricated cleared or endpoints", () => {
  const result = calculatePlanLeaveEdges(input([leave(1, "08:00", "12:00"), leave(2, "12:00", "18:00")], []));
  assert.equal(result.fullCoverage, true); assert.equal(result.state, "not_applicable"); assert.deepEqual(result.remainingRequired, []);
  assert.equal(result.requiredStartAt, null); assert.equal(result.requiredEndAt, null); assert.deepEqual(result.work, []);
  assert.deepEqual(result.workLeaveOverlaps, []); assert(!Object.hasOwn(result, "outcome"));
  const conflicted = calculatePlanLeaveEdges(input([leave(1, "09:00", "17:00")]));
  assert.equal(conflicted.fullCoverage, true); assert.equal(conflicted.state, "blocked"); assert.deepEqual(conflicted.blockers, ["work_leave_overlap"]);
});

test("inactive historical approved and terminal non-approved sources never remove required time", () => {
  const items = [{ ...leave(1, "09:00", "17:00"), current: false }, ...(["withdrawn", "rejected", "cancelled"] as const).map((s, n) => leave(n + 2, "09:00", "17:00", s))];
  const result = calculatePlanLeaveEdges(input(items)); assert.equal(result.state, "required"); assert.deepEqual(result.approvedCoverage, []);
  assert.deepEqual(result.remainingRequired, [span()]); assert.equal(result.leave.items.length, 4);
  const changed = calculatePlanLeaveEdges(input([{ ...items[0], current: true }])); assert.notEqual(JSON.stringify(result), JSON.stringify(changed));
});

test("current pending leave is separately referenced and blocks even a known fully covered plan", () => {
  const pending = leave(2, "10:00", "11:00", "submitted"), result = calculatePlanLeaveEdges(input([leave(1, "09:00", "17:00"), pending], []));
  assert.equal(result.fullCoverage, true); assert.equal(result.state, "blocked"); assert.deepEqual(result.blockers, ["leave_pending"]);
  assert.deepEqual(result.pending, [{ requestId: pending.requestId, operationId: pending.operationId, revision: 1 }]);
  assert.deepEqual(calculatePlanLeaveEdges(input([{ ...pending, current: false }])).pending, []);
  assert.deepEqual(calculatePlanLeaveEdges(input([leave(3, "17:00", "18:00", "submitted")])).pending, []);
});

test("limited or unresolved context cannot claim coverage, absence or applicability", () => {
  for (const flags of [{ limited: true, resolved: true }, { limited: false, resolved: false }, { limited: true, resolved: false }]) {
    const value = input([leave(1, "09:00", "17:00")], []); Object.assign(value.leave, flags);
    const result = calculatePlanLeaveEdges(value); assert.equal(result.unknown, true); assert.equal(result.state, "blocked");
    for (const key of ["approvedCoverage", "remainingRequired", "fullCoverage", "requiredStartAt", "requiredEndAt", "workLeaveOverlaps"] as const) assert.equal(result[key], null);
    assert.deepEqual(result.blockers, ["leave_context_unknown"]);
  }
});

test("missing/open/zero/outside work never invents an endpoint, including under full leave", () => {
  for (const w of [work(null, at("17:00")), work(at("09:00"), null), work(null, null)]) {
    const result = calculatePlanLeaveEdges(input([leave(1, "09:00", "17:00")], [w]));
    assert.equal(result.state, "blocked"); assert(result.blockers.includes("work_endpoint_missing")); assert.deepEqual(result.work, [w]);
  }
  assert.deepEqual(calculatePlanLeaveEdges(input([], [])).blockers, ["work_endpoint_missing"]);
  assert.deepEqual(calculatePlanLeaveEdges(input([], [work(at("09:00"), at("09:00"))])).blockers, ["work_zero_duration"]);
  const outside = calculatePlanLeaveEdges(input([leave(1, "09:00", "17:00")], [work(at("17:00"), at("18:00"))]));
  assert.deepEqual(outside.blockers, ["source_outside_plan"]); assert.deepEqual(outside.workLeaveOverlaps, []); assert.equal(outside.state, "blocked");
});

test("cross-midnight exact microseconds preserve a one-microsecond requirement and conflict", () => {
  const value = input([], []); value.plan = { startAt: at("23:59:59.999998"), endAt: at("00:00:00.000002", "2026-10-07") };
  value.leave.items = [{ ...leave(1), startAt: value.plan.startAt, endAt: at("00:00:00.000001", "2026-10-07") }];
  value.work = [work(at("00:00:00.000001", "2026-10-07"), value.plan.endAt)];
  const result = calculatePlanLeaveEdges(value); assert.deepEqual(result.remainingRequired, [{ startAt: value.work[0].startAt, endAt: value.plan.endAt }]); assert.equal(result.state, "required");
  value.work[0].startAt = at("00:00:00.000000", "2026-10-07");
  const overlap = calculatePlanLeaveEdges(value).workLeaveOverlaps![0]; assert.equal(overlap.startAt, value.work[0].startAt); assert.equal(overlap.endAt, at("00:00:00.000001", "2026-10-07"));
});

test("exhaustive small-microsecond union partitions plan exactly, independent of item order", () => {
  const tick = (n: number) => at(`09:00:00.${String(n).padStart(6, "0")}`), segments = [[0, 1], [1, 3], [2, 5], [5, 6]];
  const units = (parts: { startAt: string; endAt: string }[]) => parts.flatMap(p => {
    const start = Number(p.startAt.slice(20, 26)), end = Number(p.endAt.slice(20, 26));
    return Array.from({ length: end - start }, (_, i) => start + i);
  });
  for (let mask = 0; mask < 16; mask++) {
    const items = segments.filter((_, n) => mask & (1 << n)).map(([a, b], n) => ({ ...leave(n + 1), startAt: tick(a), endAt: tick(b) }));
    const expected = [...new Set(units(items))].sort((a, b) => a - b), absent = [0, 1, 2, 3, 4, 5].filter(n => !expected.includes(n));
    const value = input(items, []); value.plan = { startAt: tick(0), endAt: tick(6) };
    const initial = calculatePlanLeaveEdges(value);
    value.work = initial.remainingRequired!.map((p, n) => work(p.startAt, p.endAt, n + 1));
    const result = calculatePlanLeaveEdges(value);
    assert.deepEqual(units(result.approvedCoverage!), expected); assert.deepEqual(units(result.remainingRequired!), absent);
    assert.equal(result.fullCoverage, absent.length === 0); assert.equal(result.state, absent.length ? "required" : "not_applicable");
    assert.deepEqual(result.workLeaveOverlaps, []); value.leave.items.reverse(); value.work.reverse();
    assert.deepEqual(calculatePlanLeaveEdges(value), result);
  }
});

test("known approval never hides incomplete work under full or partial coverage", () => {
  for (const end of ["10:00", "17:00"]) {
    const result = calculatePlanLeaveEdges(input([leave(1, "09:00", end)], [work(at("09:30"), null)]));
    assert.equal(result.state, "blocked"); assert.deepEqual(result.blockers, ["work_endpoint_missing"]);
    assert.equal(result.work[0].endAt, null); assert.deepEqual(result.workLeaveOverlaps, []);
    assert.equal(result.fullCoverage, end === "17:00");
  }
});

test("UTC3 is padded not rounded; long saved UTC days do not assume a 24-hour or current DST boundary", () => {
  const value = input(); value.plan = { startAt: "2026-10-24T22:00:00.000Z", endAt: "2026-10-25T23:00:00.000Z" };
  value.work = [work("2026-10-24T22:00:00.000Z", "2026-10-25T23:00:00.000Z")];
  const result = calculatePlanLeaveEdges(value); assert.equal(result.requiredStartAt, "2026-10-24T22:00:00.000000Z"); assert.equal(result.requiredEndAt, "2026-10-25T23:00:00.000000Z");
  assert.equal(result.state, "required"); assert.equal(Date.parse(result.requiredEndAt!) - Date.parse(result.requiredStartAt!), 25 * 3600000);
});

test("zero/negative plan and leave intervals, negative work, noncanonical dates and overflow reject", () => {
  for (const endpoints of [span("09:00", "09:00"), span("17:00", "09:00")]) {
    rejects({ ...input(), plan: endpoints }); rejects(input([{ ...leave(1), ...endpoints }]));
  }
  rejects(input([], [work(at("17:00"), at("09:00"))]));
  for (const startAt of ["2026-02-30T09:00:00.000000Z", "2026-10-06T09:00:00Z", "2026-10-06T09:00:00.000000+00:00", "2026-10-06T09:00:00.0000001Z", "1999-12-31T23:59:59.999999Z", "2101-01-01T00:00:00.000000Z", "+275760-09-13T00:00:00.000000Z", 9007199254740992, BigInt(1)]) {
    rejects({ ...input(), plan: { startAt, endAt: at("17:00") } });
  }
});

test("duplicate or malformed evidence and undeclared current status cannot be laundered", () => {
  rejects(input([leave(1), leave(1)])); rejects(input([leave(1), { ...leave(2), operationId: leave(1).operationId }]));
  rejects(input([], [work(), work()])); rejects(input([], [{ ...work(), kind: "missing", operationId: null }]));
  for (const change of [{ current: undefined }, { current: "true" }, { status: ["approved"] }, { revision: 1 }, { revision: Number.MAX_SAFE_INTEGER }, { operationId: id(1) }, { extra: true }]) rejects(input([{ ...leave(1), ...change } as PlanLeaveResolvedSource]));
  rejects({ ...input(), leave: { items: [], limited: false } }); rejects({ ...input(), leave: { ...input().leave, resolved: "true" } });
});

test("strict inert tree rejects getters, sparse arrays and unknown keys without invoking accessors", () => {
  const value = input(); let accessed = false;
  Object.defineProperty(value.plan, "startAt", { enumerable: true, get: () => { accessed = true; return at("09:00"); } }); rejects(value); assert.equal(accessed, false);
  const sparse = input(); sparse.work = Array(1); rejects(sparse); rejects({ ...input(), timeZone: "Europe/Madrid" });
  const symbols = input(); Object.defineProperty(symbols, Symbol("hidden"), { value: true }); rejects(symbols);
});

test("source and intersection budgets reject rather than silently truncate", () => {
  rejects(input(Array.from({ length: 101 }, (_, n) => leave(n + 1))), "attendance_plan_leave_edges_too_large");
  rejects(input([], Array.from({ length: 101 }, (_, n) => work(at("09:00"), at("17:00"), n + 1))), "attendance_plan_leave_edges_too_large");
  rejects(input(Array.from({ length: 100 }, (_, n) => leave(n + 1, "09:00", "17:00")), Array.from({ length: 11 }, (_, n) => work(at("09:00"), at("17:00"), n + 1))), "attendance_plan_leave_edges_too_large");
});

test("outputs are detached, immutable, JSON serializable and retain source revision changes", () => {
  const value = input([leave(1)], [work(at("10:00"), at("17:00"))]), before = JSON.stringify(value), result = calculatePlanLeaveEdges(value);
  assert.equal(JSON.stringify(value), before); assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
  assert(Object.isFrozen(result)); assert(Object.isFrozen(result.leave.items[0])); assert(Object.isFrozen(result.approvedCoverage![0].leaveRefs));
  value.leave.items[0].operationId = id(999); value.work[0].startAt = at("11:00");
  assert.equal(result.leave.items[0].operationId, id(1001)); assert.equal(result.work[0].startAt, at("10:00"));
  const changed = calculatePlanLeaveEdges(input([{ ...leave(1), operationId: id(998), recordedAt: at("08:01") }], [work(at("10:00"), at("17:00"))]));
  assert.deepEqual(changed.remainingRequired, result.remainingRequired); assert.notEqual(JSON.stringify(changed), JSON.stringify(result));
});
