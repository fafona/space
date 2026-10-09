import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { parsePlanExceptionApproval, parsePlanExceptionEvidenceSource } from "./merchantAttendancePlanExceptionSource";
import { parsePlanPosthocEvaluation, parsePlanPosthocEvaluationQuery } from "./merchantAttendancePlanPosthocEvaluation";
import { executePlanPosthocEvaluation, projectPlanPosthocEvaluation } from "./merchantAttendancePlanPosthocEvaluation.server";
import type { PlanPosthocEvaluationFacts, PlanPosthocEvaluationQuery, PlanPosthocEvaluationSource } from "./merchantAttendancePlanPosthocEvaluationContract";
import type { PlanPosthocCandidate } from "./merchantAttendancePlanPosthocContract";
import type { PlanExceptionLeave } from "./merchantAttendancePlanExceptionSourceContract";
import { exceptionUiEligibleSource, exceptionUiId as id } from "../../scripts/fixtures/attendance-plan-exception-ui-model";
import { workArrangementDetail } from "../../scripts/fixtures/attendance-work-arrangement-model";
import type { WorkArrangementCommand } from "./merchantAttendanceWorkArrangement";

// Pure protocol fixtures. None of these fixtures attests actual SQL identity,
// current leave authority, a PostgreSQL canonical hash or a formal verdict.
function facts(): PlanPosthocEvaluationFacts {
  const old = exceptionUiEligibleSource(), basis = old.source, a = basis.approval!;
  const compact = { operationId: a.operationId, revision: a.revision, sourceId: a.sourceId, sourceSha256: a.sourceSha256, recordedAt: a.recordedAt };
  return { protocol: "plan-posthoc-evaluation-v1", siteId: old.siteId, actorId: old.actorId, worker: structuredClone(old.worker), slot: structuredClone(old.slot), readAt: old.readAt, fingerprint: "a".repeat(64),
    source: { protocol: "posthoc-evaluation-evidence-v1", basis, posthoc: { revision: 1,
      current: { operationId: id(205001), revision: 1, action: "apply", actorId: old.actorId, employeeId: old.worker.employeeId, employeeAuthUserId: old.worker.employeeAuthUserId,
        reason: "Synthetic explicit activation", sources: [], sourceFingerprint: "b".repeat(64), recordedAt: old.readAt }, selected: [], approval: compact },
      observations: [], approval: structuredClone(a), leave: { limited: false, resolved: true, items: [] }, resolutionBlockers: [] } };
}
const query = (v = facts()): PlanPosthocEvaluationQuery => ({ siteId: v.siteId, workerId: v.worker.workerId, slotId: v.slot.id });
const parse = (v = facts()) => parsePlanPosthocEvaluation(v, query(v), v.actorId);
function withLeave(v: PlanPosthocEvaluationFacts, startAt: string, endAt: string, status: PlanExceptionLeave["status"] = "approved", current = true) {
  const requestId = id(205100 + v.source.leave.items.length * 2), item: PlanExceptionLeave = { requestId, operationId: status === "submitted" ? requestId : id(205101 + v.source.leave.items.length * 2),
    revision: status === "submitted" ? 1 : status === "cancelled" ? 3 : 2, status, startAt, endAt, recordedAt: "2026-10-09T10:00:00.000000Z" };
  v.source.basis.context.leave.items.push(item); v.source.leave.items.push({ ...structuredClone(item), current }); return v;
}
function noWork(v = facts()) { v.source.basis.sessions = []; v.source.basis.approval = null; return v; }
function adopted(v = facts()) {
  const reference = { kind: "session" as const, startEventId: id(205200), lastEventId: id(205201), lastSequence: 4, effectOperationId: null, effectRevision: null };
  const endpoints = { startAt: "2026-10-08T08:00:00.000000Z", endAt: "2026-10-08T08:10:00.000000Z" };
  v.source.basis.context.unassociated.items.push({ startEventId: reference.startEventId, lastEventId: reference.lastEventId, lastSequence: 4, operationId: id(205202), relationSlotId: null, original: endpoints, selected: endpoints, effect: null });
  const saved: PlanPosthocCandidate = { reference, original: endpoints, selected: endpoints, locationId: v.slot.locationId, timeZone: v.slot.timeZone, available: true, blockers: [], claim: null };
  v.source.posthoc.current!.sources = [reference]; v.source.posthoc.selected = [saved];
  v.source.observations = [{ reference, current: { ...structuredClone(saved), claim: { slotId: v.slot.id, operationId: v.source.posthoc.current!.operationId, revision: 1 } }, blockers: [] }]; return v;
}
function raw(v = facts()) { const sourceText = JSON.stringify(v.source); return { ...v, sourceText, fingerprint: createHash("sha256").update(sourceText).digest("hex") }; }
const error = (fn: () => unknown) => assert.throws(fn, { code: "attendance_plan_posthoc_evaluation_invalid" });

test("evaluation is exact owner-scoped read-only query; no browser command, access, time zone or arbitrary frame", () => {
  assert.deepEqual(parsePlanPosthocEvaluationQuery(query()), query());
  for (const patch of [{ access: "self" }, { command: null }, { mode: "detail" }, { timeZone: "UTC" }, { siteId: "99990009\n" }, { workerId: null }]) assert.throws(() => parsePlanPosthocEvaluationQuery({ ...query(), ...patch }));
});
test("active empty adoption retains original associated work and exact0/5 minute policy semantics", () => {
  const v = facts(), result = parse(v); assert.equal(result.state, "required"); assert.equal(result.eligible, true); assert.deepEqual(result.blockers, []);
  assert.deepEqual(result.candidate.late, { state: "triggered", minutes: 0, rawDeltaUs: "600000000", excessUs: "600000000" });
  assert.deepEqual(result.candidate.early, { state: "triggered", minutes: 5, rawDeltaUs: "600000000", excessUs: "300000000" });
  assert(!Object.isFrozen(v)); assert(Object.isFrozen(result.source.posthoc.current));
  assert.equal("outcome" in result, false); assert.equal("workingMinutes" in result, false);
});
test("legitimate saved whole-source adoption does not double count current source or invent original relationship", () => {
  const result = parse(adopted()); assert.equal(result.state, "required"); assert.equal(result.leaveEdges.work.length, 2);
  assert.equal(result.candidate.late.state, "not_triggered"); assert.equal(result.candidate.selected.startAt, "2026-10-08T08:00:00.000000Z");
  assert.equal(result.source.basis.context.unassociated.items.length, 1); assert.equal(result.source.basis.sessions.length, 1);
});
test("partial approved edge leave adjusts requirements; touching work does not overlap", () => {
  const v = withLeave(facts(), "2026-10-08T08:00:00.000Z", "2026-10-08T08:10:00.000Z");
  withLeave(v, "2026-10-08T15:50:00.000Z", "2026-10-08T16:00:00.000Z");
  const result = parse(v); assert.equal(result.state, "required"); assert.equal(result.leaveEdges.requiredStartAt, "2026-10-08T08:10:00.000000Z");
  assert.equal(result.candidate.late.rawDeltaUs, "0"); assert.equal(result.candidate.early.rawDeltaUs, "0"); assert.deepEqual(result.leaveEdges.workLeaveOverlaps, []);
});
test("full approved coverage with no work is independent not_applicable preview, never cleared or fake endpoints", () => {
  const v = withLeave(noWork(), "2026-10-08T08:00:00.000Z", "2026-10-08T16:00:00.000Z");
  v.source.approval = null; v.source.posthoc.approval = null;
  const result = parse(v); assert.equal(result.state, "not_applicable"); assert(result.eligible); assert.equal(result.leaveEdges.fullCoverage, true);
  assert.deepEqual(result.candidate.original, { startAt: null, endAt: null }); assert.deepEqual(result.candidate.selected, { startAt: null, endAt: null });
  assert.deepEqual(result.candidate.late, { state: "blocked", minutes: null, rawDeltaUs: null, excessUs: null });
});
test("pending, inactive/currentfalse or cancelled leave never masquerades as approved exemption", () => {
  for (const [status, current] of [["submitted", true], ["approved", false], ["cancelled", true], ["withdrawn", true], ["rejected", true]] as const) {
    const result = parse(withLeave(noWork(), "2026-10-08T08:00:00.000Z", "2026-10-08T16:00:00.000Z", status, current));
    assert.equal(result.state, "blocked"); assert.equal(result.leaveEdges.fullCoverage, false); assert(result.blockers.includes("work_endpoint_missing"));
    if (status === "submitted") assert(result.blockers.includes("leave_pending"));
  }
});
test("full coverage cannot hide actual unselected work, midpoint work overlap or unresolved leave", () => {
  for (const v of [withLeave(facts(), "2026-10-08T08:00:00.000Z", "2026-10-08T16:00:00.000Z"), withLeave(facts(), "2026-10-08T12:00:00.000Z", "2026-10-08T13:00:00.000Z")]) {
    const result = parse(v); assert.equal(result.state, "blocked"); assert(result.blockers.includes("work_leave_overlap"));
  }
  const v = withLeave(noWork(), "2026-10-08T08:00:00.000Z", "2026-10-08T16:00:00.000Z"); v.source.leave.resolved = false; v.source.resolutionBlockers = ["context_unknown"];
  const result = parse(v); assert.equal(result.state, "blocked"); assert.equal(result.leaveEdges.fullCoverage, null); assert.equal(result.leaveEdges.approvedCoverage, null);
});
test("no ledger and revoked ledger remain not_active; revoke revision is retained", () => {
  const v = facts(); v.source.posthoc = { revision: 0, current: null, selected: [], approval: null }; v.source.resolutionBlockers = ["posthoc_inactive"];
  assert.equal(parse(v).state, "not_active");
  const r = facts(); r.source.posthoc.current!.action = "revoke"; r.source.posthoc.current!.revision = 2; r.source.posthoc.revision = 2; r.source.posthoc.approval = null; r.source.resolutionBlockers = ["posthoc_inactive"];
  assert.equal(parse(r).state, "not_active"); assert.equal(parse(r).source.posthoc.revision, 2);
  r.source.resolutionBlockers = []; error(() => parse(r));
});
test("current source changed or disappeared is explicit stale evidence, never automatic reuse of new endpoints", () => {
  const v = adopted(), now = v.source.observations[0].current!;
  now.reference = { ...now.reference, effectOperationId: id(205250), effectRevision: 1 } as typeof now.reference;
  now.selected = { ...now.selected, endAt: "2026-10-08T08:09:59.999999Z" };
  error(() => parse(v)); v.source.observations[0].blockers = ["source_changed"]; v.source.resolutionBlockers = ["source_changed"];
  const changed = v.source.basis.context.unassociated.items[0]; changed.selected = structuredClone(now.selected);
  changed.effect = { requestId: id(205251), operationId: id(205250), revision: 1, rootRequestId: id(205251), previousOperationId: null, recordedAt: "2026-10-09T11:00:00.000000Z" };
  const result = parse(v); assert.equal(result.state, "blocked"); assert.equal(result.source.posthoc.selected[0].selected.endAt, "2026-10-08T08:10:00.000000Z");
  v.source.observations[0].current = null; error(() => parse(v));
  v.source.observations[0].blockers = ["source_changed", "source_unavailable"]; v.source.resolutionBlockers = ["source_changed", "source_unavailable"];
  assert.equal(parse(v).state, "blocked");
});
test("current observation cannot contradict the same locked basis even when marked changed", () => {
  const v = adopted(); v.source.observations[0].current!.selected = { startAt: "2026-10-08T08:00:00.000000Z", endAt: "2026-10-08T08:09:00.000000Z" };
  v.source.observations[0].current!.original = structuredClone(v.source.observations[0].current!.selected);
  v.source.observations[0].blockers = ["source_changed"]; v.source.resolutionBlockers = ["source_changed"]; error(() => parse(v));
});
test("selected reference order, claim owner/head, fixed approval and current double identity are strict", () => {
  for (const mutate of [
    (v: PlanPosthocEvaluationFacts) => { v.source.observations = []; },
    (v: PlanPosthocEvaluationFacts) => { v.source.observations[0].reference = { ...v.source.observations[0].reference, startEventId: id(999) } as PlanPosthocCandidate["reference"]; },
    (v: PlanPosthocEvaluationFacts) => { v.source.observations[0].current!.claim = null; },
    (v: PlanPosthocEvaluationFacts) => { v.source.observations[0].current!.claim!.operationId = id(999); },
    (v: PlanPosthocEvaluationFacts) => { v.source.posthoc.current!.employeeAuthUserId = id(999); },
    (v: PlanPosthocEvaluationFacts) => { v.source.posthoc.current!.actorId = v.worker.employeeAuthUserId; },
    (v: PlanPosthocEvaluationFacts) => { v.source.approval!.sourceSha256 = "f".repeat(64); },
    (v: PlanPosthocEvaluationFacts) => { v.source.approval!.recordedAt = v.readAt; },
  ]) { const v = adopted(); mutate(v); error(() => parse(v)); }
});
test("context drop, extra keys, duplicate/sparse arrays and accessors are refused before getters run", () => {
  const v = withLeave(facts(), "2026-10-08T08:00:00.000Z", "2026-10-08T08:10:00.000Z");
  v.source.leave.items = []; error(() => parse(v));
  const limited = facts(); limited.source.basis.context.leave.limited = true; limited.source.leave.limited = true; limited.source.leave.resolved = false; error(() => parse(limited));
  for (const patch of [{ caseRevision: 3 }, { readAt: facts().readAt }, { previewFingerprint: "a".repeat(64) }]) error(() => parse({ ...facts(), source: { ...facts().source, ...patch } }));
  const duplicate = adopted(); duplicate.source.observations.push(duplicate.source.observations[0]); error(() => parse(duplicate));
  const sparse = adopted(); delete sparse.source.observations[0]; error(() => parse(sparse));
  let calls = 0; const getter = facts(); Object.defineProperty(getter.source, "approval", { enumerable: true, get: () => { calls++; throw Error("getter"); } }); error(() => parse(getter)); assert.equal(calls, 0);
  error(() => parsePlanPosthocEvaluation(facts(), query(), id(999)));
});
test("open work and exact microsecond edge comparison do not round or borrow a sibling clock-out", () => {
  const v = facts(), s = v.source.basis.sessions[0]; s.original.endAt = null; s.selected.endAt = null; s.lastEventId = s.startEventId; s.lastSequence = 1;
  const result = parse(v); assert.equal(result.state, "blocked"); assert.equal(result.candidate.selected.endAt, null); assert(result.blockers.includes("work_endpoint_missing"));
  const fine = facts(); fine.source.basis.sessions[0].original.startAt = fine.source.basis.sessions[0].selected.startAt = "2026-10-08T08:00:00.000001Z";
  assert.equal(parse(fine).candidate.late.excessUs, "1"); assert.equal(parse(fine).candidate.late.state, "triggered");
});
test("approval export delegates unchanged private validation without fabricating a relation", () => {
  const v = facts(), scope = { siteId: v.siteId, worker: v.worker, slot: v.slot };
  assert.deepEqual(parsePlanExceptionApproval(v.source.approval, scope), parsePlanExceptionEvidenceSource(v.source.basis, query(v)).approval);
  const orphan = noWork(); assert.deepEqual(parsePlanExceptionApproval(orphan.source.approval, scope), v.source.approval);
  const bad = structuredClone(v.source.approval)!; bad.source.fields.lateGraceMinutes.minutes = 1; assert.throws(() => parsePlanExceptionApproval(bad, scope));
  const file = readFileSync(new URL("./merchantAttendancePlanExceptionSource.ts", import.meta.url), "utf8");
  const wrapper = file.slice(file.indexOf("export function parsePlanExceptionApproval")); assert(wrapper.includes("freeze(approval(JSON.parse(JSON.stringify(raw)), context))"));
});
test("server validates exact UTF8 canonical hash/tree then strips sourceText; observation time is outside source", () => {
  const wire = raw(), result = projectPlanPosthocEvaluation(wire, query(), wire.actorId); assert.equal("sourceText" in result, false);
  const later = { ...wire, readAt: "2026-10-09T12:00:00.000001Z" }; assert.equal(projectPlanPosthocEvaluation(later, query(), wire.actorId).fingerprint, result.fingerprint);
  for (const bad of [{ ...wire, fingerprint: "f".repeat(64) }, { ...wire, sourceText: "{}" }, { ...wire, source: { ...wire.source, resolutionBlockers: ["source_changed"] } }, { ...wire, eligible: true }]) error(() => projectPlanPosthocEvaluation(bad, query(), wire.actorId));
});
test("service sends only exact read query and real actor; no command/allow-write or caller-controlled result", async () => {
  let calls = 0; const v = raw();
  const result = await executePlanPosthocEvaluation({ query: query(), authUserId: v.actorId }, { rpc: async (name, args) => {
    calls++; assert.equal(name, "faolla_attendance_plan_posthoc_evaluation_v1"); assert.deepEqual(args, { p_query: query(), p_auth_user_id: v.actorId }); return { data: v, error: null };
  } }); assert.equal(calls, 1); assert.equal(result.state, "required");
  for (const message of ["attendance_access_denied", "attendance_worker_changed", "23514 sensitive body"]) {
    await assert.rejects(() => executePlanPosthocEvaluation({ query: query(), authUserId: v.actorId }, { rpc: async () => ({ data: null, error: { message } }) }), { code: message.startsWith("attendance_") ? message : "attendance_unavailable" });
  }
  await assert.rejects(() => executePlanPosthocEvaluation({ query: query(), authUserId: v.actorId }, null), { code: "attendance_unavailable" });
});
test("approval mismatch, missing work and unknown sources remain blockers instead of weakening old evidence", () => {
  const v = facts(); v.source.posthoc.approval = null; v.source.approval = null;
  const result = parse(v); assert(result.blockers.includes("approval_mismatch")); assert(result.blockers.includes("approval_missing"));
  const unknown = facts(); unknown.source.basis.context.unassociated = { limited: true, items: [] }; unknown.source.resolutionBlockers = ["context_unknown"];
  assert.equal(parse(unknown).state, "blocked");
  assert.equal(parse(noWork()).state, "blocked");
  const hiddenLocation = facts(); hiddenLocation.source.resolutionBlockers = ["source_unavailable"];
  assert.equal(parse(hiddenLocation).state, "blocked"); assert(parse(hiddenLocation).blockers.includes("source_unavailable"));
});
test("disabled and unconfigured thresholds stay separate from explicit zero", () => {
  for (const state of ["disabled", "unconfigured"] as const) {
    const v = facts();
    for (const a of [v.source.approval!, v.source.basis.approval!]) {
      const p = a.source, field = p.fields.lateGraceMinutes;
      if (state === "disabled") {
        p.personal.approval!.rules.lateGraceMinutes = { mode: "disabled" };
        field.trace[0].mode = "disabled"; field.trace[0].minutes = null; field.state = "disabled"; field.minutes = null; field.source = structuredClone(field.trace[0].source);
      } else {
        p.personal.approval!.rules.lateGraceMinutes = { mode: "inherit" }; p.group!.publication!.rules.lateGraceMinutes = { mode: "inherit" }; p.enterprise.publication!.rules.lateGraceMinutes = { mode: "inherit" };
        for (const t of field.trace) { t.mode = "inherit"; t.minutes = null; } field.state = "unconfigured"; field.minutes = null; field.source = null;
      }
    }
    const result = parse(v); assert.equal(result.state, "required"); assert.deepEqual(result.candidate.late, { state, minutes: null, rawDeltaUs: null, excessUs: null });
  }
  assert.equal(parse().candidate.late.minutes, 0);
});
test("saved cross-midnight UTC intervals do not depend on today's time-zone database", () => {
  const v = facts(), s = v.source.basis.sessions[0];
  const startAt = "2026-10-08T23:00:00.000Z", endAt = "2026-10-09T07:00:00.000Z", zone = "Saved/Not-In-Current-Tzdata";
  for (const slot of [v.slot, v.source.basis.slot, s.relation.slot!]) Object.assign(slot, { startAt, endAt, timeZone: zone });
  for (const a of [v.source.approval!, v.source.basis.approval!]) {
    Object.assign(a.source.slot, { startAt, endAt, timeZone: zone }); a.source.personal.approval!.toAt = "2026-10-10T00:00:00.000Z";
  }
  s.original = s.selected = { startAt: "2026-10-08T23:10:00.000001Z", endAt: "2026-10-09T06:50:00.000000Z" };
  s.relation.recordedAt = s.adoption!.recordedAt = s.original.startAt!;
  const result = parse(v); assert.equal(result.state, "required"); assert.equal(result.candidate.late.rawDeltaUs, "600000001");
  assert.equal(result.candidate.early.rawDeltaUs, "600000000"); assert.equal(result.slot.timeZone, zone);
});
test("work-v2 current context is retained; approved remote work is not invented attendance or leave", () => {
  const v = facts(), { conflicts, conflictsFingerprint, issues, sealed, canWithdraw, canApprove, canReject, canCancel, ...item } = workArrangementDetail();
  void conflicts; void conflictsFingerprint; void issues; void sealed; void canWithdraw; void canApprove; void canReject; void canCancel;
  Object.assign(item, { workerId: v.worker.workerId, employeeId: v.worker.employeeId, employeeAuthUserId: v.worker.employeeAuthUserId, startAt: v.slot.startAt, endAt: v.slot.endAt, submittedAt: "2026-08-01T00:00:00.000001Z" });
  item.history[0].actorId = v.worker.employeeAuthUserId; item.history[0].recordedAt = item.submittedAt;
  item.history[0].command = { ...item.history[0].command, expectedWorkerId: v.worker.workerId, startAt: item.startAt, endAt: item.endAt } as WorkArrangementCommand;
  v.source.basis.protocol = "plan-exception-evidence-v2"; v.source.basis.policy = "owner-confirmed-plan-edges-work-v2"; v.source.basis.context.workArrangements = { limited: false, items: [item] };
  const pending = parse(v); assert.equal(pending.state, "blocked"); assert(pending.blockers.includes("work_arrangement_pending"));
  item.status = "approved"; item.revision = 2;
  const command: WorkArrangementCommand = { action: "approve", operationId: id(205999), requestId: item.requestId, expectedRevision: 1, reason: "Synthetic approval", expectedConflictsFingerprint: "a".repeat(64), confirmConflicts: true };
  item.history.push({ operationId: command.operationId, revision: 2, action: "approve", actorId: v.actorId, reason: command.reason, recordedAt: "2026-10-07T12:00:00.000000Z", command });
  const approved = parse(v); assert.equal(approved.state, "required"); assert.deepEqual(approved.source.basis.context.workArrangements!.items, [item]);
  noWork(v); assert(parse(v).blockers.includes("work_endpoint_missing"));
});

// Compile-time contract witness: the source has no caseRevision/readAt/preview
//hash field whose future decision would make its own saved evidence stale.
const evidenceWitness: PlanPosthocEvaluationSource = facts().source;
void evidenceWitness;
