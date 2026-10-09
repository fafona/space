import assert from "node:assert/strict";
import test from "node:test";
import { parsePlanExceptionResult, type PlanExceptionResult, type PlanExceptionQuery } from "./merchantAttendancePlanExceptions";
import { exceptionUiWire as wire, exceptionUiQuery as query, exceptionUiDecisionCommand as decisionCommand,
  exceptionUiEvidence as evidence, exceptionUiBlockedSource as blockedSource, exceptionUiId as id,
  exceptionUiOwner as owner, exceptionUiEmployee as employee, exceptionUiAuth as memberAuth,
  exceptionUiTime as time } from "../../scripts/fixtures/attendance-plan-exception-ui-model";

// Deliberately inconsistent wire fixtures, not database or authorization proof.
const before = "2026-10-09T11:59:59.999999Z", after = "2026-10-09T12:00:00.000001Z";
const parse = (raw: PlanExceptionResult, q: PlanExceptionQuery = query()) =>
  parsePlanExceptionResult(structuredClone(raw), q, q.access === "owner" ? { ownerId: owner } : { employeeId: employee, authUserId: memberAuth });
const invalid = (raw: PlanExceptionResult, q: PlanExceptionQuery = query()) => assert.throws(() => parse(raw, q), /attendance_plan_exception_review_invalid/);
const recovered = () => wire({ mode: "recover", saved: true, command: decisionCommand() });
const recoverQuery = () => query("owner", "recover");

test("valid owner fresh/detail and original recovery remain distinct; self uses member Auth, not employee ID", () => {
  assert.equal(parse(wire()).detail?.currentValidation, "checked");
  assert.equal(parse(recovered(), recoverQuery()).receipt?.operationId, id(900));
  assert.equal(parse(wire({ access: "self" }), query("self")).detail?.currentValidation, "not_checked");
  const raw = recovered(), saved = parse(raw, recoverQuery());
  assert.equal(saved.detail?.current, null); assert.equal(saved.detail?.stale, null);
  assert.equal(Object.isFrozen(saved.receipt?.item), true);
});

test("owner ordinary detail cannot silently downgrade to unvalidated historical mode", () => {
  const raw = wire({ saved: true }); assert(raw.detail);
  raw.detail.current = null; raw.detail.currentValidation = "not_checked"; raw.detail.stale = null; raw.detail.canDecide = false;
  invalid(raw);
  assert.doesNotThrow(() => parse(recovered(), recoverQuery()));
});

test("recovered decision command binds both current detail identities even without expected command", () => {
  for (const key of ["employeeId", "employeeAuthUserId"] as const) {
    const raw = recovered(); assert(raw.receipt && "outcome" in raw.receipt.command);
    raw.receipt.command[key] = id(990); invalid(raw, recoverQuery());
    const switched = recovered(); assert(switched.detail); switched.detail.worker[key] = id(990); invalid(switched, recoverQuery());
  }
});

test("receipt cannot claim a future revision or a different visible history item", () => {
  const future = recovered(); assert(future.receipt && "expectedRevision" in future.receipt.command);
  future.receipt.command.expectedRevision = 1; future.receipt.item.revision = 2; invalid(future, recoverQuery());
  const changed = recovered(); assert(changed.receipt); changed.receipt.item.note = "different visible note";
  changed.receipt.command.note = "different visible note"; invalid(changed, recoverQuery());
  const missing = recovered(); missing.detail = null; invalid(missing, recoverQuery());
});

test("confirmed receipt must independently have eligible triggered evidence and match latest proof", () => {
  const blocked = recovered(); assert(blocked.receipt); blocked.receipt.item.evidence = evidence(blockedSource()); invalid(blocked, recoverQuery());
  const changed = recovered(); assert(changed.receipt?.item.evidence);
  changed.receipt.item.evidence = structuredClone(changed.receipt.item.evidence);
  changed.receipt.item.evidence.sessions[0].lastEventId = id(995); invalid(changed, recoverQuery());
});

test("ineligible saved evidence blocks both edges rather than retaining one triggered edge", () => {
  const raw = wire({ eligible: false, saved: true }); assert(raw.detail?.latestDecision);
  const validEarly = evidence().candidate.early;
  raw.detail.latestDecision.evidence.candidate.early = validEarly; invalid(raw);
});

test("case first revision is its immutable ID and openedAt, and latest decision matches visible history", () => {
  const wrongCase = wire({ saved: true }); assert(wrongCase.detail); wrongCase.detail.caseId = id(950); invalid(wrongCase);
  const wrongOpened = wire({ saved: true }); assert(wrongOpened.detail); wrongOpened.detail.openedAt = before; invalid(wrongOpened);
  const mixed = wire({ saved: true }); assert(mixed.detail?.latestDecision); mixed.detail.latestDecision.note = "unrelated latest decision"; invalid(mixed);
});

test("saved decision observed time and read acknowledgment cannot precede their own immutable evidence", () => {
  const laterProof = wire({ saved: true }); assert(laterProof.detail?.latestDecision); laterProof.detail.latestDecision.evidence.observedAt = after; invalid(laterProof);
  const earlyAck = wire({ saved: true }); assert(earlyAck.detail?.latestDecision); earlyAck.detail.latestDecision.readAt = before; invalid(earlyAck);
  const futureAck = wire({ saved: true }); assert(futureAck.detail?.latestDecision); futureAck.detail.latestDecision.readAt = after; invalid(futureAck);
  const lateReceipt = recovered(); assert(lateReceipt.receipt); lateReceipt.receipt.item.recordedAt = after; invalid(lateReceipt, recoverQuery());
});

test("history must be chronological and employee explanations retain original recipient Auth", () => {
  const command = { operationId: id(901), expectedRevision: 1, decisionOperationId: id(900), note: "Employee explanation" };
  const q = query("self", "note", command.operationId), valid = wire({ access: "self", mode: "note", command });
  assert.equal(parse(valid, q).detail?.revision, 2);
  const wrongActor = structuredClone(valid); assert(wrongActor.detail); wrongActor.detail.history[0].actorId = owner; invalid(wrongActor, q);
  const inverted = structuredClone(valid); assert(inverted.detail); inverted.detail.history[0].recordedAt = before; invalid(inverted, q);
  const late = structuredClone(valid); assert(late.detail); late.detail.history[0].recordedAt = after; invalid(late, q);
});

test("explicit read receipt binds the displayed decision and its timestamp without implying agreement", () => {
  const command = { operationId: id(902), decisionOperationId: id(900) }, q = query("self", "ack", command.operationId);
  const valid = wire({ access: "self", mode: "ack", command }); assert.equal(parse(valid, q).readReceipt?.readAt, time);
  const early = structuredClone(valid); assert(early.readReceipt); early.readReceipt.readAt = before; invalid(early, q);
  const future = structuredClone(valid); assert(future.readReceipt); future.readReceipt.readAt = after; invalid(future, q);
  const otherIdentity = structuredClone(valid); assert(otherIdentity.readReceipt); otherIdentity.readReceipt.employeeAuthUserId = owner; invalid(otherIdentity, q);
  const inconsistent = structuredClone(valid); assert(inconsistent.detail?.latestDecision); inconsistent.detail.latestDecision.readAt = null; invalid(inconsistent, q);
});

test("immutable case list binds first-decision ID and all own decision/read times", () => {
  const q = query("owner", "list"), valid = wire({ mode: "list", saved: true }); assert.equal(parse(valid, q).items.length, 1);
  const wrongId = structuredClone(valid); wrongId.items[0].caseId = id(999); invalid(wrongId, q);
  const early = structuredClone(valid); early.items[0].latestDecision.recordedAt = before; invalid(early, q);
  const future = structuredClone(valid); future.items[0].latestDecision.readAt = after; invalid(future, q);
  const wrongEmployee = wire({ access: "self", mode: "list", saved: true }); wrongEmployee.items[0].employeeId = id(998); invalid(wrongEmployee, query("self", "list"));
});

test("nested unsafe descriptors are rejected before access, and result/request sizes stay bounded", () => {
  const raw = recovered(); assert(raw.receipt); let accessed = false;
  Object.defineProperty(raw.receipt.item, "evidence", { enumerable: true, get() { accessed = true; return evidence(); } });
  assert.throws(() => parsePlanExceptionResult(raw, recoverQuery(), { ownerId: owner })); assert.equal(accessed, false);
  const large = wire({ saved: true }); assert(large.detail?.latestDecision); large.detail.latestDecision.note = "x".repeat(1048577); invalid(large);
  const extra: unknown = { ...recovered(), privatelySavedSource: {} };
  assert.throws(() => parsePlanExceptionResult(extra, recoverQuery(), { ownerId: owner }));
});
