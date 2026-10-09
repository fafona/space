import assert from "node:assert/strict";
import test from "node:test";
import { validatePeriodWorkArrangements } from "./merchantAttendanceWorkArrangementContext";
import { parsePeriodClosureArtifact } from "./merchantAttendancePeriodClosure";
import { parsePlanExceptionSource, calculateExceptionCandidate } from "./merchantAttendancePlanExceptionSource";
import { parsePlanExceptionResult } from "./merchantAttendancePlanExceptions";
import { buildPeriodClosureOutput, periodClosureSavedContext } from "../components/enterprise/MerchantAttendancePeriodClosureWorkspace";
import { workArrangementDetail, workArrangementId as id } from "../../scripts/fixtures/attendance-work-arrangement-model";
import { periodClosureUiArtifact } from "../../scripts/fixtures/attendance-period-closure-ui-model";
import { exceptionUiEligibleSource, exceptionUiWire, exceptionUiQuery } from "../../scripts/fixtures/attendance-plan-exception-ui-model";
import type { WorkArrangementContextItem, WorkArrangementCommand } from "./merchantAttendanceWorkArrangement";

function context(worker: { workerId: string; employeeId: string; employeeAuthUserId: string }, startAt: string, endAt: string): WorkArrangementContextItem {
  const d = workArrangementDetail(), { conflicts, conflictsFingerprint, issues, sealed, canWithdraw, canApprove, canReject, canCancel, ...c } = d;
  void conflicts; void conflictsFingerprint; void issues; void sealed; void canWithdraw; void canApprove; void canReject; void canCancel;
  Object.assign(c, { workerId: worker.workerId, employeeId: worker.employeeId, employeeAuthUserId: worker.employeeAuthUserId, startAt, endAt, submittedAt: "2026-08-01T00:00:00.000001Z" });
  c.history[0].actorId = worker.employeeAuthUserId; c.history[0].recordedAt = c.submittedAt;
  c.history[0].command = { ...c.history[0].command, expectedWorkerId: worker.workerId, startAt, endAt } as WorkArrangementCommand;
  return c;
}
function archive() {
  const a = periodClosureUiArtifact(), c = context(a.worker, "2026-09-02T08:00:00.000Z", "2026-09-02T16:00:00.000Z");
  a.source.sourceVersion = "attendance-period-source-v2";
  (a.source.context as Record<string, unknown>).workArrangements = [c];
  return { a, c };
}
function evidence(approved = false) {
  const r = exceptionUiEligibleSource(), c = context({ workerId: r.worker.workerId, employeeId: r.worker.employeeId!, employeeAuthUserId: r.worker.employeeAuthUserId! }, r.slot.startAt, r.slot.endAt);
  if (approved) {
    c.status = "approved"; c.revision = 2;
    const command: WorkArrangementCommand = { action: "approve", operationId: id(99), requestId: c.requestId, expectedRevision: 1, reason: "Synthetic explicit approval", expectedConflictsFingerprint: "a".repeat(64), confirmConflicts: true };
    c.history.push({ operationId: command.operationId, revision: 2, action: "approve", actorId: id(1), reason: command.reason, recordedAt: "2026-10-07T12:00:00.000000Z", command });
  }
  r.protocol = "plan-exception-source-v2"; r.source.protocol = "plan-exception-evidence-v2"; r.source.policy = "owner-confirmed-plan-edges-work-v2";
  r.source.context.workArrangements = { limited: false, items: [c] };
  r.eligible = approved; r.blockers = approved ? [] : ["work_arrangement_pending"]; r.candidate = calculateExceptionCandidate(r.source, approved);
  return r;
}

test("v1 archives retain absent context rather than receiving today's arrangements", () => {
  const a = periodClosureUiArtifact(), before = JSON.stringify(a);
  assert.deepEqual(validatePeriodWorkArrangements(a.source, a.worker, a.period), []);
  assert.deepEqual(parsePeriodClosureArtifact(a), a); assert.equal(JSON.stringify(a), before);
  (a.source.context as Record<string, unknown>).workArrangements = [];
  assert.throws(() => parsePeriodClosureArtifact(a));
});
test("v2 fixed source validates identity, bounded sorted intervals and immutable history", () => {
  const { a } = archive(); assert.deepEqual(parsePeriodClosureArtifact(a), a);
  const bad = (mutate: (x: ReturnType<typeof archive>) => void) => { const x = archive(); mutate(x); assert.throws(() => parsePeriodClosureArtifact(x.a)); };
  bad(({ c }) => { c.employeeId = id(777); });
  bad(({ c }) => { c.employeeAuthUserId = id(777); });
  bad(({ c }) => { c.workerId = id(777); });
  bad(({ c }) => { c.history[0].reason = "Changed saved reason"; });
  bad(({ a, c }) => { (a.source.context as Record<string, unknown>).workArrangements = [c, c]; });
  bad(({ a }) => { (a.source.context as Record<string, unknown>).workArrangements = []; });
  bad(({ a, c }) => { (a.source.context as Record<string, unknown>).workArrangements = Array.from({ length: 101 }, () => c); });
});
test("v2 archive never reinterprets saved timezone or current local-date rules", () => {
  const { a, c } = archive(); c.timeZone = "Historical/Zone"; (c.history[0].command as { timeZone: string }).timeZone = c.timeZone;
  const descriptor = Object.getOwnPropertyDescriptor(Intl, "DateTimeFormat")!;
  Object.defineProperty(Intl, "DateTimeFormat", { configurable: true, value: () => { throw Error("must not interpret timezone"); } });
  try { assert.deepEqual(parsePeriodClosureArtifact(a), a); } finally { Object.defineProperty(Intl, "DateTimeFormat", descriptor); }
});
test("fixed CSV and print preserve all saved work-arrangement fields without adding hours", () => {
  const { a, c } = archive(), totals = structuredClone(a.report.totals), output = buildPeriodClosureOutput(a, id(500), 2);
  assert(periodClosureSavedContext(a).some(x => x.key === "workArrangements" && x.title.includes("非实际工时")));
  assert(output.csv.includes(c.requestId)); assert(output.html.includes(c.history[0].operationId));
  assert(output.csv.includes("retrospectiveDays")); assert.deepEqual(a.report.totals, totals);
});
test("pending arrangements require manual resolution; approval alone never excuses actual edge differences", () => {
  for (const approved of [false, true]) {
    const r = evidence(approved), q = { siteId: r.siteId, workerId: r.worker.workerId, slotId: r.slot.id };
    const parsed = parsePlanExceptionSource(r, q, r.actorId); assert.equal(parsed.eligible, approved);
    assert.equal(parsed.candidate.late.state, approved ? "triggered" : "blocked");
    assert.equal(parsed.source.context.workArrangements!.items[0].status, approved ? "approved" : "submitted");
    const wrong = structuredClone(r); wrong.source.context.workArrangements!.items[0].employeeId = id(888);
    assert.throws(() => parsePlanExceptionSource(wrong, q, r.actorId));
  }
});
test("source protocol/context upgrades are explicit and cannot be disguised as legacy v1", () => {
  const r = evidence(), q = { siteId: r.siteId, workerId: r.worker.workerId, slotId: r.slot.id };
  r.protocol = "plan-exception-source-v1"; assert.throws(() => parsePlanExceptionSource(r, q));
  r.protocol = "plan-exception-source-v2"; r.source.policy = "owner-confirmed-plan-edges-v1"; assert.throws(() => parsePlanExceptionSource(r, q));
});
test("saved manual decision accepts versioned work references while legacy evidence remains unchanged", () => {
  const old = exceptionUiWire({ saved: true }); assert.deepEqual(parsePlanExceptionResult(old, exceptionUiQuery(), { ownerId: old.actorId }), old);
  const r = evidence(true), wire = exceptionUiWire({ saved: true }); wire.detail!.current = r;
  const e = wire.detail!.latestDecision!.evidence; e.policy = "owner-confirmed-plan-edges-work-v2";
  e.contextRefs.workArrangements = { limited: false, items: r.source.context.workArrangements!.items.map(x => ({ requestId: x.requestId, operationId: x.history.at(-1)!.operationId, revision: x.revision })) };
  const parsed = parsePlanExceptionResult(wire, exceptionUiQuery(), { ownerId: wire.actorId }); assert.equal(parsed.detail!.latestDecision!.evidence.contextRefs.workArrangements!.items.length, 1);
});
