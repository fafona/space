import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { exceptionUiEligibleSource, exceptionUiId as id } from "../../scripts/fixtures/attendance-plan-exception-ui-model";
import { workArrangementDetail } from "../../scripts/fixtures/attendance-work-arrangement-model";
import type { WorkArrangementCommand } from "./merchantAttendanceWorkArrangement";
import type { PlanExceptionLeave, PlanExceptionSourceResult } from "./merchantAttendancePlanExceptionSourceContract";
import type { PlanPosthocCandidate } from "./merchantAttendancePlanPosthocContract";
import type { PlanPosthocEvaluationFacts } from "./merchantAttendancePlanPosthocEvaluationContract";
import type { PlanPosthocFormalSourceV3Result } from "./merchantAttendancePlanPosthocFormalSourceContract";
import { calculateExceptionCandidate, parsePlanExceptionSource } from "./merchantAttendancePlanExceptionSource";
import { projectPlanExceptionSource } from "./merchantAttendancePlanExceptions.server";
import { parsePlanPosthocEvaluation } from "./merchantAttendancePlanPosthocEvaluation";
import { parsePlanPosthocFormalSource, parsePlanPosthocFormalSourceQuery } from "./merchantAttendancePlanPosthocFormalSource";
import { executePlanPosthocFormalSource, projectPlanPosthocFormalSource } from "./merchantAttendancePlanPosthocFormalSource.server";

// Pure synthetic facts only. SQL identity/locking, PostgreSQL canonical output
//and SQL geometry equivalence require the separately owned native acceptance.
function facts(): PlanPosthocEvaluationFacts {
  const old = exceptionUiEligibleSource(), a = old.source.approval!;
  return { protocol: "plan-posthoc-evaluation-v1", siteId: old.siteId, actorId: old.actorId,
    worker: structuredClone(old.worker), slot: structuredClone(old.slot), readAt: old.readAt, fingerprint: "a".repeat(64),
    source: { protocol: "posthoc-evaluation-evidence-v1", basis: old.source,
      posthoc: { revision: 1, current: { operationId: id(206001), revision: 1, action: "apply", actorId: old.actorId,
        employeeId: old.worker.employeeId, employeeAuthUserId: old.worker.employeeAuthUserId, reason: "Synthetic explicit adoption",
        sources: [], sourceFingerprint: "b".repeat(64), recordedAt: old.readAt }, selected: [],
        approval: { operationId: a.operationId, revision: a.revision, sourceId: a.sourceId, sourceSha256: a.sourceSha256, recordedAt: a.recordedAt } },
      observations: [], approval: structuredClone(a), leave: { limited: false, resolved: true, items: [] }, resolutionBlockers: [] } };
}
const query = (v = facts()) => ({ siteId: v.siteId, workerId: v.worker.workerId, slotId: v.slot.id });
function publicValue(v = facts()): PlanPosthocFormalSourceV3Result {
  const result = parsePlanPosthocEvaluation(v, query(v), v.actorId);
  return { protocol: "plan-exception-source-v3", siteId: result.siteId, actorId: result.actorId, worker: result.worker, slot: result.slot,
    readAt: result.readAt, source: { protocol: "plan-exception-evidence-v3", policy: "owner-confirmed-plan-edges-posthoc-v3", evaluation: result.source },
    fingerprint: result.fingerprint, state: result.state === "not_active" ? "blocked" : result.state,
    eligible: result.eligible, blockers: result.blockers, candidate: result.candidate, leaveEdges: result.leaveEdges };
}
function wire<T extends { source: unknown; fingerprint: string }>(value: T) {
  const sourceText = JSON.stringify(value.source); return { ...value, sourceText, fingerprint: createHash("sha256").update(sourceText).digest("hex") };
}
const parse = (v = publicValue()) => parsePlanPosthocFormalSource(v, query(), v.actorId);
const error = (fn: () => unknown) => assert.throws(fn, { code: "attendance_plan_posthoc_formal_invalid" });
function withLeave(v: PlanPosthocEvaluationFacts, startAt: string, endAt: string, status: PlanExceptionLeave["status"] = "approved") {
  const requestId = id(206100 + v.source.leave.items.length * 2), item: PlanExceptionLeave = { requestId,
    operationId: status === "submitted" ? requestId : id(206101 + v.source.leave.items.length * 2), revision: status === "submitted" ? 1 : status === "cancelled" ? 3 : 2,
    status, startAt, endAt, recordedAt: "2026-10-09T10:00:00.000000Z" };
  v.source.basis.context.leave.items.push(item); v.source.leave.items.push({ ...structuredClone(item), current: true }); return v;
}
function noWork(v = facts()) { v.source.basis.sessions = []; v.source.basis.approval = null; return v; }
function withWorkArrangement<T extends PlanExceptionSourceResult>(v: T): T {
  const { conflicts, conflictsFingerprint, issues, sealed, canWithdraw, canApprove, canReject, canCancel, ...item } = workArrangementDetail();
  void conflicts; void conflictsFingerprint; void issues; void sealed; void canWithdraw; void canApprove; void canReject; void canCancel;
  Object.assign(item, { workerId: v.worker.workerId, employeeId: v.worker.employeeId, employeeAuthUserId: v.worker.employeeAuthUserId,
    startAt: v.slot.startAt, endAt: v.slot.endAt, submittedAt: "2026-08-01T00:00:00.000001Z" });
  item.history[0].actorId = v.worker.employeeAuthUserId; item.history[0].recordedAt = item.submittedAt;
  item.history[0].command = { ...item.history[0].command, expectedWorkerId: v.worker.workerId, startAt: item.startAt, endAt: item.endAt } as WorkArrangementCommand;
  v.protocol = "plan-exception-source-v2"; v.source.protocol = "plan-exception-evidence-v2"; v.source.policy = "owner-confirmed-plan-edges-work-v2";
  v.source.context.workArrangements = { limited: false, items: [item] }; v.eligible = false; v.blockers = ["work_arrangement_pending"];
  v.candidate = calculateExceptionCandidate(v.source, false); return v;
}
function adopted(v = facts()) {
  const reference = { kind: "session" as const, startEventId: id(206200), lastEventId: id(206201), lastSequence: 4, effectOperationId: null, effectRevision: null };
  const span = { startAt: "2026-10-08T08:00:00.000000Z", endAt: "2026-10-08T08:10:00.000000Z" };
  v.source.basis.context.unassociated.items.push({ startEventId: reference.startEventId, lastEventId: reference.lastEventId, lastSequence: 4,
    operationId: id(206202), relationSlotId: null, original: span, selected: span, effect: null });
  const saved: PlanPosthocCandidate = { reference, original: span, selected: span, locationId: v.slot.locationId,
    timeZone: v.slot.timeZone, available: true, blockers: [], claim: null };
  v.source.posthoc.current!.sources = [reference]; v.source.posthoc.selected = [saved];
  v.source.observations = [{ reference, current: { ...structuredClone(saved), claim: { slotId: v.slot.id, operationId: v.source.posthoc.current!.operationId, revision: 1 } }, blockers: [] }]; return v;
}

test("formal read query has only site/worker/slot; actor and date/frame cannot be caller substitutes", () => {
  assert.deepEqual(parsePlanPosthocFormalSourceQuery(query()), query());
  for (const patch of [{ access: "self" }, { command: null }, { mode: "decide" }, { actorId: id(1) }, { timeZone: "UTC" }, { workerId: null }]) {
    assert.throws(() => parsePlanPosthocFormalSourceQuery({ ...query(), ...patch }), { code: "attendance_invalid_request" });
  }
});
test("no-ledger v1 and work-v2 delegate the old parsers and preserve the entire canonical branch", () => {
  for (const old of [exceptionUiEligibleSource(), withWorkArrangement(exceptionUiEligibleSource())]) {
    const raw = wire(old), q = { siteId: old.siteId, workerId: old.worker.workerId, slotId: old.slot.id };
    assert.deepEqual(parsePlanPosthocFormalSource(old, q, old.actorId), parsePlanExceptionSource(old, q, old.actorId));
    const actual = projectPlanPosthocFormalSource(raw, q, old.actorId), expected = projectPlanExceptionSource(raw, q, old.actorId);
    assert.equal(JSON.stringify(actual), JSON.stringify(expected)); assert.equal(actual.fingerprint, raw.fingerprint);
    assert.equal("state" in actual, false); assert.equal("leaveEdges" in actual, false); assert.equal("sourceText" in actual, false);
  }
});
test("required v3 verifies both independent candidate comparisons and never adds old sessions or counted hours", () => {
  const value = publicValue(adopted()), result = parse(value); assert.equal(result.protocol, "plan-exception-source-v3");
  if (result.protocol !== "plan-exception-source-v3") assert.fail();
  assert.equal(result.state, "required"); assert(result.eligible); assert.equal(result.candidate.late.rawDeltaUs, "0");
  assert.equal(result.source.evaluation.basis.sessions.length, 1); assert.equal(result.source.evaluation.posthoc.selected.length, 1);
  assert.equal(result.leaveEdges.work.length, 2); assert.equal("workingMinutes" in result, false); assert.equal("outcome" in result, false);
  assert(Object.isFrozen(result.source.evaluation.posthoc)); assert(!Object.isFrozen(value));
});
test("every SQL-derived field is checked exactly, including enum arrays, microseconds, coverage references and ordering", () => {
  const value = structuredClone(publicValue());
  for (const mutation of [
    (v: PlanPosthocFormalSourceV3Result) => { v.state = "not_applicable"; },
    (v: PlanPosthocFormalSourceV3Result) => { v.eligible = false; },
    (v: PlanPosthocFormalSourceV3Result) => { v.blockers = ["source_unavailable"]; },
    (v: PlanPosthocFormalSourceV3Result) => { v.candidate.late.excessUs = "599999999"; },
    (v: PlanPosthocFormalSourceV3Result) => { v.candidate.early.minutes = 0; },
    (v: PlanPosthocFormalSourceV3Result) => { v.candidate.selected.endAt = null; },
    (v: PlanPosthocFormalSourceV3Result) => { v.leaveEdges.fullCoverage = true; },
    (v: PlanPosthocFormalSourceV3Result) => { v.leaveEdges.requiredStartAt = "2026-10-08T08:00:00.000001Z"; },
    (v: PlanPosthocFormalSourceV3Result) => { v.leaveEdges.work[0].sourceId = id(999); },
  ]) { const v = structuredClone(value); mutation(v); error(() => parse(v)); }
  error(() => parse({ ...value, state: ["required"] } as unknown as PlanPosthocFormalSourceV3Result));
});
test("full approved leave with no work is not_applicable, never cleared, fabricated endpoints or normal candidate", () => {
  const f = withLeave(noWork(), "2026-10-08T08:00:00.000Z", "2026-10-08T16:00:00.000Z");
  f.source.approval = null; f.source.posthoc.approval = null;
  const v = publicValue(f), result = parse(v); assert.equal(result.protocol, "plan-exception-source-v3");
  if (result.protocol !== "plan-exception-source-v3") assert.fail();
  assert.equal(result.state, "not_applicable"); assert(result.eligible); assert.deepEqual(result.blockers, []);
  assert.equal(result.leaveEdges.requiredStartAt, null); assert.equal(result.leaveEdges.requiredEndAt, null);
  assert.deepEqual(result.candidate.selected, { startAt: null, endAt: null }); assert.equal(result.candidate.late.state, "blocked");
  error(() => parse({ ...v, candidate: { ...v.candidate, late: { state: "not_triggered", minutes: 0, rawDeltaUs: "0", excessUs: "0" } } }));
});
test("pending/unknown/full work overlap stay blocked; old SQL-only source-unavailable is never inferred away", () => {
  const unknown = facts(); unknown.source.leave.resolved = false; unknown.source.resolutionBlockers = ["context_unknown"];
  const hidden = facts(); hidden.source.resolutionBlockers = ["source_unavailable"];
  const pending = withLeave(noWork(), "2026-10-08T08:00:00.000Z", "2026-10-08T16:00:00.000Z", "submitted");
  const overlap = withLeave(facts(), "2026-10-08T08:00:00.000Z", "2026-10-08T16:00:00.000Z");
  for (const f of [unknown, hidden, pending, overlap]) {
    const result = parse(publicValue(f)); if (result.protocol !== "plan-exception-source-v3") assert.fail();
    assert.equal(result.state, "blocked"); assert(!result.eligible); assert.equal(result.candidate.late.state, "blocked");
  }
  const missing = publicValue(hidden); error(() => parse({ ...missing, blockers: [] }));
});
test("revoked head stays v3 with changed canonical, while absent head cannot be smuggled into v3", () => {
  const active = wire(publicValue()), revoked = facts(); revoked.source.posthoc.current!.action = "revoke";
  revoked.source.posthoc.current!.revision = revoked.source.posthoc.revision = 2; revoked.source.posthoc.approval = null;
  revoked.source.resolutionBlockers = ["posthoc_inactive"];
  const raw = wire(publicValue(revoked)), result = projectPlanPosthocFormalSource(raw, query(), raw.actorId);
  if (result.protocol !== "plan-exception-source-v3") assert.fail();
  assert.equal(result.state, "blocked"); assert(result.blockers.includes("posthoc_inactive")); assert.equal(result.source.evaluation.posthoc.revision, 2);
  assert.notEqual(raw.fingerprint, active.fingerprint);
  const absent = facts(); absent.source.posthoc = { revision: 0, current: null, selected: [], approval: null }; absent.source.resolutionBlockers = ["posthoc_inactive"];
  error(() => parse(publicValue(absent)));
});
test("changed and unavailable observations do not silently adopt corrected endpoints or discard saved references", () => {
  const f = adopted(), saved = structuredClone(f.source.posthoc.selected[0]);
  f.source.observations[0].current = null; f.source.observations[0].blockers = ["source_changed", "source_unavailable"];
  f.source.resolutionBlockers = ["source_changed", "source_unavailable"];
  const result = parse(publicValue(f)); if (result.protocol !== "plan-exception-source-v3") assert.fail();
  assert.equal(result.state, "blocked"); assert.deepEqual(result.source.evaluation.posthoc.selected[0], saved);
  assert.deepEqual(result.blockers.slice(0, 2), ["source_changed", "source_unavailable"]);
  error(() => parse({ ...publicValue(f), blockers: ["source_unavailable", "source_changed"] }));
});
test("formal canonical forbids unnormalized sealed observations without weakening other unavailable causes", () => {
  const f = adopted(); f.source.observations[0].current!.blockers = ["sealed"]; f.source.observations[0].current!.available = false;
  f.source.observations[0].blockers = ["source_unavailable"]; f.source.resolutionBlockers = ["source_unavailable"];
  error(() => parse(publicValue(f)));
  f.source.observations[0].current!.blockers = []; f.source.observations[0].current!.available = true; f.source.observations[0].blockers = [];
  // A hidden SQL-only mid-session location/pending guard may still account for
  //the global unavailable flag even after sealed was removed from this item.
  const result = parse(publicValue(f)); if (result.protocol !== "plan-exception-source-v3") assert.fail();
  assert.equal(result.state, "blocked"); assert.deepEqual(result.blockers, ["source_unavailable"]);
});
test("full work-v2 basis/history is retained in v3, not conditionally dropped because outer policy is v3", () => {
  const f = facts(); f.source.basis = withWorkArrangement(exceptionUiEligibleSource()).source;
  const result = parse(publicValue(f)); if (result.protocol !== "plan-exception-source-v3") assert.fail();
  assert.equal(result.source.evaluation.basis.protocol, "plan-exception-evidence-v2");
  assert.deepEqual(result.source.evaluation.basis.context.workArrangements, f.source.basis.context.workArrangements);
  assert(result.blockers.includes("work_arrangement_pending"));
});
test("partial leave, microseconds and saved unknown time-zone labels compare only saved UTC instants", () => {
  const f = withLeave(facts(), "2026-10-08T08:00:00.000Z", "2026-10-08T08:10:00.000Z");
  const s = f.source.basis.sessions[0]; s.original.startAt = s.selected.startAt = "2026-10-08T08:10:00.000001Z";
  const result = parse(publicValue(f)); if (result.protocol !== "plan-exception-source-v3") assert.fail();
  assert.equal(result.candidate.late.rawDeltaUs, "1"); assert.equal(result.candidate.late.excessUs, "1");
  const cross = facts(), session = cross.source.basis.sessions[0], startAt = "2026-10-08T23:00:00.000Z", endAt = "2026-10-09T07:00:00.000Z", zone = "Saved/No-Current-Tzdata";
  for (const slot of [cross.slot, cross.source.basis.slot, session.relation.slot!]) Object.assign(slot, { startAt, endAt, timeZone: zone });
  for (const a of [cross.source.approval!, cross.source.basis.approval!]) { Object.assign(a.source.slot, { startAt, endAt, timeZone: zone }); a.source.personal.approval!.toAt = "2026-10-10T00:00:00.000Z"; }
  session.original = session.selected = { startAt: "2026-10-08T23:10:00.000001Z", endAt: "2026-10-09T06:50:00.000000Z" };
  session.relation.recordedAt = session.adoption!.recordedAt = session.original.startAt!;
  const output = parse(publicValue(cross)); assert.equal(output.slot.timeZone, zone); assert.equal(output.candidate.late.rawDeltaUs, "600000001");
});
test("exact tree, identity, current claim and immutable approval validation reject caller-made shortcuts", () => {
  const v = structuredClone(publicValue(adopted()));
  for (const patch of [{ sourceText: "{}" }, { outcome: "not_applicable" }, { caseRevision: 3 }, { actorId: id(999) }]) {
    error(() => parsePlanPosthocFormalSource({ ...v, ...patch }, query(), v.actorId));
  }
  for (const mutate of [
    (x: PlanPosthocFormalSourceV3Result) => { x.source.evaluation.posthoc.current!.employeeAuthUserId = id(999); },
    (x: PlanPosthocFormalSourceV3Result) => { x.source.evaluation.observations[0].current!.claim!.operationId = id(999); },
    (x: PlanPosthocFormalSourceV3Result) => { x.source.evaluation.approval!.sourceSha256 = "f".repeat(64); },
    (x: PlanPosthocFormalSourceV3Result) => { x.source.evaluation.observations.push(x.source.evaluation.observations[0]); },
    (x: PlanPosthocFormalSourceV3Result) => { delete x.source.evaluation.observations[0]; },
  ]) { const x = structuredClone(v); mutate(x); error(() => parse(x)); }
  let getterCalls = 0; Object.defineProperty(v.source, "evaluation", { enumerable: true, get() { getterCalls++; throw Error("getter"); } });
  error(() => parse(v)); assert.equal(getterCalls, 0);
});
test("server verifies canonical UTF8 bytes/hash/tree before derivation and strips raw text without stripping evidence", () => {
  const raw = wire(publicValue()), result = projectPlanPosthocFormalSource(raw, query(), raw.actorId);
  assert.equal("sourceText" in result, false); assert.deepEqual(result.source, raw.source);
  const later = { ...raw, readAt: "2026-10-09T12:00:00.000001Z" };
  assert.equal(projectPlanPosthocFormalSource(later, query(), raw.actorId).fingerprint, result.fingerprint);
  for (const bad of [{ ...raw, fingerprint: "f".repeat(64) }, { ...raw, sourceText: "{}" }, { ...raw, eligible: false },
    { ...raw, source: { ...raw.source, caseRevision: 2 } }, { ...raw, sourceText: " ".repeat(1048577) }]) {
    error(() => projectPlanPosthocFormalSource(bad, query(), raw.actorId));
  }
  const duplicate = '{"protocol":"bad",' + raw.sourceText.slice(1);
  error(() => projectPlanPosthocFormalSource({ ...raw, sourceText: duplicate, fingerprint: createHash("sha256").update(duplicate).digest("hex") }, query(), raw.actorId));
});
test("service is new owner-authorized read only, forwards actual Auth and whitelists sanitized errors", async () => {
  const raw = wire(publicValue()), input = { query: query(), authUserId: raw.actorId }; let calls = 0;
  const result = await executePlanPosthocFormalSource(input, { rpc: async (name, args) => {
    calls++; assert.equal(name, "faolla_attendance_plan_posthoc_formal_source_v1"); assert.deepEqual(args, { p_query: query(), p_auth_user_id: raw.actorId });
    return { data: raw, error: null };
  } }); assert.equal(calls, 1); assert.equal(result.protocol, "plan-exception-source-v3");
  for (const message of ["attendance_access_denied", "attendance_worker_changed", "attendance_plan_posthoc_formal_too_large", "23514 sensitive details"]) {
    await assert.rejects(() => executePlanPosthocFormalSource(input, { rpc: async () => ({ data: null, error: { message } }) }),
      { code: message.startsWith("attendance_") ? message : "attendance_unavailable" });
  }
  await assert.rejects(() => executePlanPosthocFormalSource(input, null), { code: "attendance_unavailable" });
  await assert.rejects(() => executePlanPosthocFormalSource(input, { rpc: async () => { throw Error("secret network details"); } }), { code: "attendance_unavailable" });
});
