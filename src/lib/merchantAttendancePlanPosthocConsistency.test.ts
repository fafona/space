import assert from "node:assert/strict";
import test from "node:test";
import { parsePlanPosthocResult } from "./merchantAttendancePlanPosthoc";
import type { PlanPosthocCandidate, PlanPosthocQuery, PlanPosthocResult } from "./merchantAttendancePlanPosthocContract";
import { exceptionUiEligibleSource, exceptionUiId as id } from "../../scripts/fixtures/attendance-plan-exception-ui-model";

// Pure, internally consistent DTOs. No SQL, authorization or hash provenance is
// claimed. Mutants mirror changed candidates into source so equality/hash shape
// alone cannot mask a contradiction with the independently retained basis.
function wire(kind: "session" | "missing" = "session"): PlanPosthocResult {
  const r = exceptionUiEligibleSource(), s = r.source.sessions[0], { source: _rule, ...approval } = r.source.approval!; void _rule;
  r.source.sessions = []; r.source.approval = null;
  r.source.context.unassociated.items = kind === "session" ? [{ startEventId: s.startEventId, operationId: s.operationId, lastEventId: s.lastEventId, lastSequence: s.lastSequence,
    original: s.original, selected: s.selected, effect: null, relationSlotId: null }] : [];
  r.source.context.missing.items = kind === "missing" ? [{ requestId: id(810), operationId: id(811), revision: 2, status: "approved", startAt: s.selected.startAt!, endAt: s.selected.endAt!,
    recordedAt: r.readAt, supersedesRequestId: null, rootRequestId: id(810), isCurrentApproved: true }] : [];
  const candidate: PlanPosthocCandidate = { reference: kind === "session" ? { kind, startEventId: s.startEventId, lastEventId: s.lastEventId, lastSequence: s.lastSequence, effectOperationId: null, effectRevision: null }
    : { kind, requestId: id(810), rootRequestId: id(810), approvalOperationId: id(811) }, original: kind === "session" ? s.original : null, selected: s.selected,
    locationId: r.slot.locationId, timeZone: r.slot.timeZone, available: true, blockers: [], claim: null };
  return { protocol: "plan-posthoc-adoption-v1", siteId: r.siteId, actorId: r.actorId, worker: r.worker, slot: r.slot, revision: 0, current: null, history: [], historyTruncated: false, receipt: null, readAt: r.readAt,
    preview: { fingerprint: "a".repeat(64), eligible: true, blockers: [], candidates: [candidate], approval,
      source: { protocol: "posthoc-adoption-preview-v1", basis: r.source, caseId: id(900), caseRevision: 1, revision: 0, currentOperationId: null, candidates: [structuredClone(candidate)], approval, blockers: [] } } };
}
const query = (r: PlanPosthocResult): PlanPosthocQuery => ({ siteId: r.siteId, workerId: r.worker.workerId, slotId: r.slot.id, mode: "detail", operationId: null });
const parse = (r: PlanPosthocResult) => parsePlanPosthocResult(r, query(r), r.actorId);
function mirrored(r: PlanPosthocResult) { r.preview!.source.candidates = structuredClone(r.preview!.candidates); r.preview!.source.blockers = [...r.preview!.blockers]; r.preview!.source.approval = r.preview!.approval; return r; }
const rejects = (r: PlanPosthocResult) => assert.throws(() => parse(mirrored(r)), { code: "attendance_plan_posthoc_adoption_invalid" });

test("consistent unassociated-session and current-approved-missing candidates remain parseable", () => {
  for (const kind of ["session", "missing"] as const) { const value = parse(wire(kind)); assert.equal(value.preview!.candidates[0].reference.kind, kind); }
});
test("candidate original start/ref/last event/sequence/effect must match its basis source", () => {
  for (const change of ["ref", "lastEvent", "sequence", "effect", "endpoints"] as const) {
    const r = wire(), c = r.preview!.candidates[0]; assert.equal(c.reference.kind, "session"); if (c.reference.kind !== "session") throw Error("fixture");
    if (change === "ref") c.reference.startEventId = id(998);
    if (change === "lastEvent") c.reference.lastEventId = id(997);
    if (change === "sequence") c.reference.lastSequence++;
    if (change === "effect") { c.reference.effectOperationId = id(996); c.reference.effectRevision = 1; }
    if (change === "endpoints") { c.original = { ...c.original!, startAt: "2026-10-08T08:30:00.000000Z" }; c.selected = { ...c.selected, startAt: c.original.startAt }; }
    rejects(r);
  }
});
test("missing candidate must match the actual current approved request/root/approval and selected span", () => {
  for (const change of ["request", "root", "approval", "endpoints", "notCurrent", "notApproved"] as const) {
    const r = wire("missing"), c = r.preview!.candidates[0], b = r.preview!.source.basis.context.missing.items[0]; if (c.reference.kind !== "missing") throw Error("fixture");
    if (change === "request") c.reference.requestId = id(998);
    if (change === "root") c.reference.rootRequestId = id(997);
    if (change === "approval") c.reference.approvalOperationId = id(996);
    if (change === "endpoints") c.selected.startAt = "2026-10-08T08:30:00.000000Z";
    if (change === "notCurrent") b.isCurrentApproved = false;
    if (change === "notApproved") { b.status = "rejected"; b.isCurrentApproved = false; }
    rejects(r);
  }
});
test("basis pending leave cannot disappear from adoption global blockers", () => {
  const r = wire(); r.preview!.source.basis.context.leave.items.push({ requestId: id(950), operationId: id(950), revision: 1, status: "submitted",
    startAt: "2026-10-08T09:00:00.000Z", endAt: "2026-10-08T10:00:00.000Z", recordedAt: r.readAt }); rejects(r);
});
test("basis pending correction and missing application cannot disappear from global blockers", () => {
  for (const kind of ["correction", "missing"] as const) {
    const r = wire(), b = r.preview!.source.basis;
    if (kind === "correction") b.context.pendingCorrections.items.push({ kind, requestId: id(950), operationId: id(950), revision: 1, startEventId: b.context.unassociated.items[0].startEventId,
      startAt: "2026-10-08T09:00:00.000000Z", endAt: "2026-10-08T10:00:00.000000Z", recordedAt: r.readAt });
    else b.context.missing.items.push({ requestId: id(950), operationId: id(950), revision: 1, status: "submitted", startAt: "2026-10-08T09:00:00.000000Z", endAt: "2026-10-08T10:00:00.000000Z",
      recordedAt: r.readAt, rootRequestId: id(950), supersedesRequestId: null, isCurrentApproved: false });
    rejects(r);
  }
});
test("point-checked pending witnesses outside the legacy basis still block the whole adoption preview", () => {
  for (const blocker of ["pending_correction", "pending_missing"] as const) {
    const r = wire(), c = r.preview!.candidates[0]; c.available = false; c.blockers = [blocker];
    // SQL may prove a pending proposal moved outside the legacy basis range.
    // Keep that independent witness; do not fabricate an old contextual row.
    r.preview!.eligible = false; r.preview!.blockers = [blocker];
    assert.equal(parse(mirrored(r)).preview!.eligible, false);
    r.preview!.eligible = true; r.preview!.blockers = []; rejects(r);
  }
});
test("basis limited context and live calendar annotation cannot be claimed complete by an empty blocker set", () => {
  const limited = wire(); limited.preview!.source.basis.context.calendar.limited = true; rejects(limited);
  const calendar = wire(); calendar.preview!.source.basis.context.calendar.items.push({ entryId: id(950), operationId: id(950), revision: 1, status: "created", locationId: calendar.slot.locationId, kind: "holiday", timeZone: "UTC",
    fromDate: "2026-10-08", throughDate: "2026-10-08", fromAt: "2026-10-08T00:00:00.000000Z", toAt: "2026-10-09T00:00:00.000000Z", recordedAt: calendar.readAt }); rejects(calendar);
});
test("closed candidate cannot conceal an open original basis or another original plan relationship", () => {
  const open = wire(); open.preview!.source.basis.context.unassociated.items[0].original.endAt = null; open.preview!.source.basis.context.unassociated.items[0].selected.endAt = null; rejects(open);
  const elsewhere = wire(); elsewhere.preview!.source.basis.context.unassociated.items[0].relationSlotId = id(950); rejects(elsewhere);
});
test("even unavailable open/zero candidates retain the corresponding factual blocker", () => {
  for (const zero of [false, true]) {
    const r = wire(), c = r.preview!.candidates[0], b = r.preview!.source.basis.context.unassociated.items[0];
    b.original.endAt = zero ? b.original.startAt : null; b.selected.endAt = b.original.endAt;
    c.original = structuredClone(b.original); c.selected = structuredClone(b.selected); c.available = false; c.blockers = ["identity_unproven"];
    rejects(r);
  }
});
test("future original/effect evidence cannot hide behind a corrected selected interval before readAt", () => {
  const r = wire(), c = r.preview!.candidates[0], b = r.preview!.source.basis.context.unassociated.items[0];
  b.original = { startAt: "2026-10-10T08:00:00.000000Z", endAt: "2026-10-10T16:00:00.000000Z" };
  b.effect = { requestId: id(970), operationId: id(971), revision: 1, rootRequestId: id(970), previousOperationId: null, recordedAt: "2026-10-10T17:00:00.000000Z" };
  c.original = structuredClone(b.original); if (c.reference.kind !== "session") throw Error("fixture"); c.reference.effectOperationId = b.effect.operationId; c.reference.effectRevision = b.effect.revision;
  rejects(r);
});
