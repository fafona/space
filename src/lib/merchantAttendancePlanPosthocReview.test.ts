import assert from "node:assert/strict";
import test from "node:test";
import { posthocReviewSource, posthocReviewEvidence, posthocReviewWire } from "../../scripts/fixtures/attendance-plan-posthoc-review-model";
import { exceptionUiId as id, exceptionUiQuery, exceptionUiEvidence, exceptionUiOwner as owner, exceptionUiAuth as auth,
  exceptionUiEmployee as employee, exceptionUiSlot as slot } from "../../scripts/fixtures/attendance-plan-exception-ui-model";
import { parsePlanPosthocEvidence, parsePlanPosthocSavedHead, type PlanExceptionPosthocEvidence } from "./merchantAttendancePlanPosthocEvidence";
import { parsePlanExceptionCommand, parsePlanExceptionResult, parsePlanExceptionResponse } from "./merchantAttendancePlanExceptions";
import { executePlanExceptions } from "./merchantAttendancePlanExceptions.server";
import { hasNotApplicablePlanExceptionBasis, canMarkPlanExceptionNotApplicable } from "./merchantAttendancePlanPosthocReview";
import { planPosthocReviewSiteEnabled } from "./merchantAttendancePlanPosthocReview.server";
import { hasClearPlanExceptionBasis } from "./merchantAttendancePlanClearance";
import { parsePlanPosthocEvaluation } from "./merchantAttendancePlanPosthocEvaluation";
import { parsePlanPosthocFormalSource } from "./merchantAttendancePlanPosthocFormalSource";
import type { PlanPosthocFormalSourceV3Result } from "./merchantAttendancePlanPosthocFormalSourceContract";
import type { PlanExceptionAccess, PlanExceptionQuery, PlanExceptionDecisionCommand } from "./merchantAttendancePlanExceptionContract";
const operationId = id(207900), scope = { slotId: slot, employeeId: employee, employeeAuthUserId: auth };
const q = (mode: PlanExceptionQuery["mode"] = "detail", access: PlanExceptionAccess = "owner") => exceptionUiQuery(access, mode, operationId);
const parse = (value = posthocReviewWire(), mode: PlanExceptionQuery["mode"] = "detail", access: PlanExceptionAccess = "owner") => parsePlanExceptionResult(value, q(mode, access), { authUserId: access === "owner" ? owner : auth });
const bad = (run: () => unknown) => assert.throws(run, { code: "attendance_plan_exception_review_invalid" });
function recompute(source: PlanPosthocFormalSourceV3Result): PlanPosthocFormalSourceV3Result {
  const query = { siteId: source.siteId, workerId: source.worker.workerId, slotId: source.slot.id };
  const facts = parsePlanPosthocEvaluation({ protocol: "plan-posthoc-evaluation-v1",
    siteId: source.siteId, actorId: source.actorId, worker: source.worker, slot: source.slot, readAt: source.readAt,
    source: source.source.evaluation, fingerprint: source.fingerprint }, query, source.actorId);
  const parsed = parsePlanPosthocFormalSource({ ...source, state: facts.state === "not_active" ? "blocked" : facts.state,
    eligible: facts.eligible, blockers: facts.blockers, candidate: facts.candidate, leaveEdges: facts.leaveEdges }, query, source.actorId);
  if (parsed.protocol !== "plan-exception-source-v3") throw Error("v3 fixture expected"); return structuredClone(parsed);
}

test("saved compact contains ten exact keys, not full basis/rules, and verifies geometry without mutating caller", () => {
  const source = posthocReviewSource(), evidence = posthocReviewEvidence(source), result = parsePlanPosthocEvidence(evidence, scope);
  assert.equal(Object.keys(result).length, 10); assert.equal(Object.keys(result.evaluation).length, 5);
  assert.equal("basis" in result.evaluation, false); assert.equal("source" in result.approval!, false);
  assert.equal(result.fingerprint, source.fingerprint); assert.equal(result.evaluation.state, "required");
  assert.equal(result.candidate.late.excessUs, "600000000"); assert(Object.isFrozen(result.evaluation.leaveEdges)); assert(!Object.isFrozen(evidence));
});
test("not_applicable is owner existing-case only; old first-case commands and cleared semantics remain distinct", () => {
  const wire = posthocReviewWire({ source: posthocReviewSource({ fullLeave: true }), mode: "decide" }), command = wire.receipt!.command as PlanExceptionDecisionCommand;
  assert.deepEqual(parsePlanExceptionCommand(q("decide"), command), command);
  assert.throws(() => parsePlanExceptionCommand(q("decide"), { ...command, expectedRevision: 0 }));
  assert.throws(() => parsePlanExceptionCommand(q("decide", "self"), command));
  assert.throws(() => parsePlanExceptionCommand(q("decide"), { ...command, outcome: ["not_applicable"] }));
  assert.equal(hasClearPlanExceptionBasis(wire.detail!.latestDecision!.evidence), false);
  assert.equal(hasNotApplicablePlanExceptionBasis(exceptionUiEvidence()), false);
  assert(canMarkPlanExceptionNotApplicable(wire.detail));
  for (const patch of [{ caseId: null, revision: 0 }, { canDecide: false }, { current: null, currentValidation: "not_checked" as const }]) {
    assert.equal(canMarkPlanExceptionNotApplicable({ ...wire.detail!, ...patch }), false);
  }
});
test("owner and self read saved not_applicable through detail/list/recover without fresh source on self", () => {
  const source = posthocReviewSource({ fullLeave: true });
  for (const access of ["owner", "self"] as const) for (const mode of ["detail", "list"] as const) {
    const result = parse(posthocReviewWire({ source, access, mode }), mode, access);
    assert.equal(mode === "list" ? result.items[0].latestDecision.outcome : result.detail!.latestDecision!.outcome, "not_applicable");
    if (mode === "detail" && access === "self") { assert.equal(result.detail!.current, null); assert.equal(result.detail!.stale, null); }
  }
  const wire = posthocReviewWire({ source, mode: "recover", receipt: true });
  const result = parsePlanExceptionResult(wire, q("recover"), { authUserId: owner }, wire.receipt!.command);
  assert.equal(result.receipt!.item.outcome, "not_applicable"); assert.equal(result.detail!.currentValidation, "not_checked");
  const wrong = posthocReviewWire({ source, access: "self" }); wrong.detail!.current = source; bad(() => parse(wrong, "detail", "self"));
});
test("saved not_applicable cannot be revision1, v1 disguised, blocked, cleared or a normal attendance candidate", () => {
  const full = posthocReviewSource({ fullLeave: true });
  for (const outcome of ["confirmed", "excused", "cleared"] as const) bad(() => parse(posthocReviewWire({ source: full, outcome })));
  const old = posthocReviewWire({ source: full }); old.detail!.latestDecision!.evidence = exceptionUiEvidence(); bad(() => parse(old));
  const first = posthocReviewWire({ source: full }); first.detail!.latestDecision!.revision = 1; bad(() => parse(first));
  const list = posthocReviewWire({ source: full, mode: "list" }); (list.items[0].latestDecision as unknown as Record<string, unknown>).sourceId = id(999);
  bad(() => parse(list, "list"));
  const blocked = posthocReviewWire({ source: posthocReviewSource({ fullLeave: true, revoked: true }), outcome: "not_applicable" }); bad(() => parse(blocked));
});
test("saved employee notes and explicit ack retain their own exact actor/revision receipts", () => {
  const wire = posthocReviewWire({ source: posthocReviewSource({ fullLeave: true }), access: "self" }), target = wire.detail!.latestDecision!.operationId;
  const noteCommand = { operationId, expectedRevision: 2, decisionOperationId: target, note: "Synthetic employee note" };
  // Use an independent operation; it must not duplicate the saved decision.
  noteCommand.operationId = id(207901);
  const entry = { operationId: noteCommand.operationId, revision: 3, actorId: auth, kind: "note" as const, outcome: null, note: noteCommand.note, decisionOperationId: target, recordedAt: wire.readAt };
  wire.detail!.revision = 3; wire.detail!.history.unshift(entry); wire.receipt = { operationId: noteCommand.operationId, command: noteCommand, item: { ...entry, evidence: null } };
  const noteQuery = { ...q("note", "self"), operationId: noteCommand.operationId };
  assert.equal(parsePlanExceptionResult(wire, noteQuery, { authUserId: auth }, noteCommand).receipt!.item.kind, "note");
  const ack = posthocReviewWire({ source: posthocReviewSource({ fullLeave: true }), access: "self" }), ackCommand = { operationId: id(207902), decisionOperationId: target };
  ack.detail!.latestDecision!.readAt = ack.readAt; ack.readReceipt = { operationId: ackCommand.operationId, command: ackCommand, decisionOperationId: target,
    actorId: auth, employeeId: employee, employeeAuthUserId: auth, readAt: ack.readAt };
  assert.equal(parsePlanExceptionResult(ack, { ...q("ack", "self"), operationId: ackCommand.operationId }, { authUserId: auth }, ackCommand).readReceipt!.actorId, auth);
  ack.readReceipt.actorId = owner; bad(() => parsePlanExceptionResult(ack, { ...q("ack", "self"), operationId: ackCommand.operationId }, { authUserId: auth }, ackCommand));
});
test("v3 current is explicitly parsed; changed or revoked fingerprints make saved decisions stale without replacing history", () => {
  const wire = posthocReviewWire(), decision = structuredClone(wire.detail!.latestDecision!);
  wire.detail!.current = posthocReviewSource({ revoked: true }); wire.detail!.current.fingerprint = "f".repeat(64); wire.detail!.stale = true;
  const result = parse(wire); assert.equal(result.detail!.stale, true); assert.deepEqual(result.detail!.latestDecision, decision);
  wire.detail!.stale = false; bad(() => parse(wire));
});
test("compact field tampering cannot relabel coverage, selected endpoints, known current state or precision", () => {
  const sample = posthocReviewEvidence();
  for (const mutate of [
    (e: PlanExceptionPosthocEvidence) => { e.evaluation.state = "not_applicable"; },
    (e: PlanExceptionPosthocEvidence) => { e.evaluation.leaveEdges.requiredStartAt = "2026-10-08T08:00:00.000001Z"; },
    (e: PlanExceptionPosthocEvidence) => { e.evaluation.leaveEdges.work = []; },
    (e: PlanExceptionPosthocEvidence) => { e.candidate.selected.startAt = "2026-10-08T08:09:00.000000Z"; },
    (e: PlanExceptionPosthocEvidence) => { e.candidate.late.rawDeltaUs = "1"; e.candidate.late.excessUs = "1"; },
    (e: PlanExceptionPosthocEvidence) => { e.evaluation.posthoc.current!.employeeAuthUserId = id(999); },
    (e: PlanExceptionPosthocEvidence) => { e.evaluation.slot.slotId = id(999); },
    (e: PlanExceptionPosthocEvidence) => { e.contextRefs.leave.limited = true; },
  ]) { const changed = structuredClone(sample); mutate(changed); bad(() => parsePlanPosthocEvidence(changed, scope)); }
  const full = posthocReviewEvidence(posthocReviewSource({ fullLeave: true })); full.evaluation.leaveEdges.leave.items[0].current = false; bad(() => parsePlanPosthocEvidence(full));
});
test("compact preserves optional work-v2 refs and limits; unrelated approved work is never evidence of actual attendance", () => {
  const evidence = posthocReviewEvidence(); evidence.contextRefs.workArrangements = { limited: false, items: [{ requestId: id(207100), operationId: id(207101), revision: 2 }] };
  assert.deepEqual(parsePlanPosthocEvidence(evidence).contextRefs.workArrangements, evidence.contextRefs.workArrangements);
  for (const part of [{ limited: false, items: [] }, { limited: true, items: [] }]) { const changed = structuredClone(evidence); changed.contextRefs.workArrangements = part; bad(() => parsePlanPosthocEvidence(changed)); }
  const many = structuredClone(evidence); many.contextRefs.workArrangements!.items = Array.from({ length: 101 }, (_, i) => ({ requestId: id(207200 + i), operationId: id(207400 + i), revision: 2 })); bad(() => parsePlanPosthocEvidence(many));
});
test("standalone saved-head parser supports period usage, same immutable identities and revoked-head history", () => {
  const source = posthocReviewSource(), head = source.source.evaluation.posthoc;
  assert.deepEqual(parsePlanPosthocSavedHead(head, scope), head);
  const revoked = posthocReviewSource({ revoked: true }).source.evaluation.posthoc;
  assert.equal(parsePlanPosthocSavedHead(revoked, scope).current!.action, "revoke");
  bad(() => parsePlanPosthocSavedHead(head, { ...scope, employeeAuthUserId: id(999) }));
  bad(() => parsePlanPosthocSavedHead({ ...head, current: null, revision: 0 }, scope));
  bad(() => parsePlanPosthocSavedHead({ ...head, readAt: source.readAt }, scope));
});
test("nonempty snapshots preserve historical selection and strictly bind indexed current observations and work", () => {
  const source = posthocReviewSource({ adopted: true }), evidence = posthocReviewEvidence(source), parsed = parsePlanPosthocEvidence(evidence, scope);
  assert.equal(parsed.evaluation.posthoc.selected.length, 1); assert.equal(parsed.candidate.selected.startAt, "2026-10-08T08:00:00.000000Z");
  assert.deepEqual(parsed.evaluation.observations[0].reference, parsed.evaluation.posthoc.selected[0].reference);
  assert.equal(parsed.sessions.length, 1); assert.equal(parsed.evaluation.leaveEdges.work.length, 2);
  for (const mutate of [
    (e: PlanExceptionPosthocEvidence) => { e.evaluation.observations = []; },
    (e: PlanExceptionPosthocEvidence) => { e.evaluation.observations[0].reference = { kind: "missing", requestId: id(1), rootRequestId: id(1), approvalOperationId: id(2) }; },
    (e: PlanExceptionPosthocEvidence) => { e.evaluation.observations[0].current!.claim!.operationId = id(999); },
    (e: PlanExceptionPosthocEvidence) => { e.evaluation.observations[0].current!.selected.endAt = "2026-10-08T08:09:00.000000Z"; },
    (e: PlanExceptionPosthocEvidence) => { e.evaluation.posthoc.selected[0].available = false; },
    (e: PlanExceptionPosthocEvidence) => { e.evaluation.posthoc.selected[0].locationId = id(999); },
  ]) { const changed = structuredClone(evidence); mutate(changed); bad(() => parsePlanPosthocEvidence(changed, scope)); }
});
test("mixed session and missing compact preserves either explicit171 order, while cross-index observations and duplicate roots fail", () => {
  for (const mixed of ["session-first", "missing-first"] as const) {
    const source = posthocReviewSource({ mixed }), evidence = posthocReviewEvidence(source), parsed = parsePlanPosthocEvidence(evidence, scope);
    const expected = mixed === "session-first" ? ["session", "missing"] : ["missing", "session"];
    assert.deepEqual(parsed.evaluation.posthoc.current!.sources.map(ref => ref.kind), expected);
    assert.deepEqual(parsed.evaluation.posthoc.selected.map(item => item.reference.kind), expected);
    assert.deepEqual(parsed.evaluation.observations.map(item => item.reference.kind), expected);
    assert.equal(parsed.evaluation.state, "required"); assert.equal(parsed.evaluation.leaveEdges.work.length, 3);
    //Work geometry has its own deterministic ordering; it must not reorder the
    //immutable selection or current observations to impose an invented policy.
    assert.deepEqual(parsed.evaluation.leaveEdges.work.map(item => item.kind), ["missing", "session", "session"]);
    const misaligned = structuredClone(evidence); misaligned.evaluation.observations.reverse(); bad(() => parsePlanPosthocEvidence(misaligned, scope));
    const duplicate = structuredClone(evidence), missing = duplicate.evaluation.posthoc.selected.find(item => item.reference.kind === "missing")!;
    const otherHead = structuredClone(missing); if (otherHead.reference.kind !== "missing") throw Error("missing fixture expected");
    otherHead.reference.requestId = id(207032); otherHead.reference.approvalOperationId = id(207033);
    duplicate.evaluation.posthoc.selected = [missing, otherHead]; duplicate.evaluation.posthoc.current!.sources = [missing.reference, otherHead.reference];
    const observation = duplicate.evaluation.observations.find(item => item.reference.kind === "missing")!;
    duplicate.evaluation.observations = [observation, { ...structuredClone(observation), reference: otherHead.reference }];
    bad(() => parsePlanPosthocEvidence(duplicate, scope));
  }
});
test("saved adopted missing roots and newer approved heads remain separate; stale current work never silently replaces saved endpoints", () => {
  const source = posthocReviewSource({ adopted: true }), facts = source.source.evaluation;
  const selected = facts.posthoc.selected[0], root = id(207040), approved = id(207041);
  selected.reference = { kind: "missing", requestId: root, rootRequestId: root, approvalOperationId: approved }; selected.original = null;
  facts.posthoc.current!.sources = [selected.reference];
  facts.observations = [{ reference: selected.reference, current: { ...structuredClone(selected), claim: { slotId: slot, operationId: facts.posthoc.current!.operationId, revision: 1 } }, blockers: [] }];
  facts.basis.context.unassociated.items = [];
  facts.basis.context.missing.items = [{ requestId: root, operationId: approved, revision: 2, status: "approved", supersedesRequestId: null, rootRequestId: root,
    isCurrentApproved: true, startAt: selected.selected.startAt!, endAt: selected.selected.endAt!, recordedAt: "2026-10-09T10:00:00.000000Z" }];
  const original = posthocReviewEvidence(recompute(source)); assert.equal(original.evaluation.leaveEdges.work[0].kind, "missing");
  assert.equal(original.evaluation.leaveEdges.work[0].sourceId, root);
  const now = facts.observations[0].current!; now.reference = { ...selected.reference, requestId: id(207042), approvalOperationId: id(207043) };
  now.selected.startAt = "2026-10-08T08:01:00.000000Z"; facts.observations[0].blockers = ["source_changed"]; facts.resolutionBlockers = ["source_changed"];
  const parent = facts.basis.context.missing.items[0]; parent.isCurrentApproved = false;
  facts.basis.context.missing.items.push({ ...parent, requestId: id(207042), operationId: id(207043), supersedesRequestId: root, isCurrentApproved: true,
    startAt: now.selected.startAt, recordedAt: "2026-10-09T11:00:00.000000Z" });
  const changed = posthocReviewEvidence(recompute(source));
  assert.equal(changed.evaluation.state, "blocked"); assert.equal(changed.candidate.selected.startAt, selected.selected.startAt);
  assert.equal(changed.evaluation.observations[0].current!.selected.startAt, now.selected.startAt);
  assert.equal(changed.evaluation.leaveEdges.work[0].operationId, id(207043));
  const forged = structuredClone(changed); forged.evaluation.leaveEdges.work[0].sourceId = id(207042);
  bad(() => parsePlanPosthocEvidence(forged, scope));
});
test("unavailable current observations and full-leave pending remain blocked without fabricating endpoints or a not-applicable verdict", () => {
  const source = posthocReviewSource({ adopted: true }); source.source.evaluation.observations[0].current = null;
  source.source.evaluation.observations[0].blockers = ["source_changed", "source_unavailable"];
  source.source.evaluation.resolutionBlockers = ["source_changed", "source_unavailable"];
  source.source.evaluation.basis.context.unassociated.items = [];
  const unavailable = posthocReviewEvidence(recompute(source));
  assert.equal(unavailable.evaluation.state, "blocked"); assert.equal(unavailable.evaluation.observations[0].current, null);
  assert.equal(unavailable.candidate.selected.startAt, "2026-10-08T08:00:00.000000Z");
  const full = posthocReviewSource({ fullLeave: true }), leave = full.source.evaluation.basis.context.leave.items[0];
  const pending = { ...leave, requestId: id(207080), operationId: id(207080), revision: 1, status: "submitted" as const };
  full.source.evaluation.basis.context.leave.items.push(pending); full.source.evaluation.leave.items.push({ ...pending, current: true });
  const evidence = posthocReviewEvidence(recompute(full)); assert.equal(evidence.evaluation.leaveEdges.fullCoverage, true);
  assert.equal(evidence.evaluation.state, "blocked"); assert.equal(hasNotApplicablePlanExceptionBasis(evidence), false);
  assert(evidence.blockers.includes("leave_pending")); assert.equal(evidence.candidate.selected.startAt, null);
});
test("saved compact cap/tree rejects oversized, sparse/accessor/unknown data without invoking getters", () => {
  const e = posthocReviewEvidence(); let read = 0; Object.defineProperty(e.evaluation, "posthoc", { enumerable: true, get() { read++; throw Error("getter"); } });
  bad(() => parsePlanPosthocEvidence(e)); assert.equal(read, 0);
  bad(() => parsePlanPosthocEvidence({ ...posthocReviewEvidence(), sourceText: "x".repeat(131073) }));
  const sparse = posthocReviewEvidence(); delete sparse.sessions[0]; bad(() => parsePlanPosthocEvidence(sparse));
  const duplicate = posthocReviewEvidence(); duplicate.sessions.push(duplicate.sessions[0]); bad(() => parsePlanPosthocEvidence(duplicate));
});
test("fresh-write gate is default off, exact-site, independent of read/replay and rejects malformed allowlists", () => {
  assert.equal(planPosthocReviewSiteEnabled("99990009", {}), false);
  const env = { FAOLLA_ATTENDANCE_PLAN_POSTHOC_REVIEW_ENABLED: "1", FAOLLA_ATTENDANCE_PLAN_POSTHOC_REVIEW_SITE_IDS: "99990009,99990008" };
  assert.equal(planPosthocReviewSiteEnabled("99990009", env), true); assert.equal(planPosthocReviewSiteEnabled("99990007", env), false);
  for (const ids of ["*", "99990009,", "99990009,bad", "9999009", Array(101).fill("99990009").join(",")]) assert.equal(planPosthocReviewSiteEnabled("99990009", { ...env, FAOLLA_ATTENDANCE_PLAN_POSTHOC_REVIEW_SITE_IDS: ids }), false);
  assert.equal(planPosthocReviewSiteEnabled("99990009\n", env), false);
});
test("all review reads/replays and fresh actions use one real-actor RPC with separate fresh flags", async () => {
  const keys = ["FAOLLA_ATTENDANCE_PLAN_POSTHOC_REVIEW_ENABLED", "FAOLLA_ATTENDANCE_PLAN_POSTHOC_REVIEW_SITE_IDS", "FAOLLA_ATTENDANCE_PLAN_CLEARANCE_ENABLED", "FAOLLA_ATTENDANCE_EVENT_NOTIFICATIONS_CAPTURE_ENABLED"] as const;
  const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  try {
    for (const key of keys) delete process.env[key];
    for (const [access, mode] of [["owner", "detail"], ["owner", "recover"], ["owner", "decide"], ["self", "detail"]] as const) {
      const data = posthocReviewWire({ source: posthocReviewSource({ fullLeave: true }), access, mode, receipt: mode === "decide" || mode === "recover" });
      const command = mode === "decide" ? data.receipt!.command : null;
      const result = await executePlanExceptions({ query: q(mode, access), authUserId: access === "owner" ? owner : auth, moduleEnabled: false, command }, { rpc: async (name, args) => {
        assert.equal(name, "faolla_attendance_plan_exception_posthoc_review_v1"); assert.deepEqual(args, { p_query: q(mode, access), p_auth_user_id: access === "owner" ? owner : auth,
          p_command: command, p_allow_write: false, p_allow_posthoc: false, p_allow_clearance: false, p_capture_notifications: false });
        return { data, error: null };
      } }); assert.equal(result.detail!.latestDecision!.outcome, "not_applicable");
    }
    process.env.FAOLLA_ATTENDANCE_PLAN_POSTHOC_REVIEW_ENABLED = "1"; process.env.FAOLLA_ATTENDANCE_PLAN_POSTHOC_REVIEW_SITE_IDS = "99990009";
    await executePlanExceptions({ query: q(), authUserId: owner }, { rpc: async (_name, args) => { assert.equal(args.p_allow_posthoc, true); return { data: posthocReviewWire(), error: null }; } });
    await assert.rejects(() => executePlanExceptions({ query: q(), authUserId: owner }, { rpc: async () => ({ data: null, error: { message: "attendance_plan_exception_posthoc_disabled" } }) }), { code: "attendance_plan_exception_posthoc_disabled" });
  } finally { for (const key of keys) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; } }
});
test("module-off response keeps saved evidence and minimum recovery without advertising new writes", () => {
  const data = posthocReviewWire({ source: posthocReviewSource({ fullLeave: true }), mode: "recover", receipt: true });
  data.detail!.canDecide = false; data.detail!.canNote = false;
  assert.equal(parsePlanExceptionResponse({ ok: true, moduleEnabled: false, data }, q("recover"), { authUserId: owner }, data.receipt!.command).receipt!.item.outcome, "not_applicable");
  data.detail!.canDecide = true; bad(() => parsePlanExceptionResponse({ ok: true, moduleEnabled: false, data }, q("recover"), { authUserId: owner }));
});
