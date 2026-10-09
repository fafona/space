import assert from "node:assert/strict";
import test from "node:test";
import { planRuleApprovalsId as id, planRuleApprovalsWire } from "../../scripts/fixtures/attendance-plan-rule-approvals-model";
import { calculateExceptionCandidate, parseExceptionCandidate, parsePlanExceptionSource } from "./merchantAttendancePlanExceptionSource";
import { PLAN_EXCEPTION_BLOCKERS, type PlanExceptionBlocker, type PlanExceptionSourceResult } from "./merchantAttendancePlanExceptionSourceContract";
import { micros, parsePlanExceptionJson, safeTree, stamp } from "./merchantAttendancePlanExceptionValidation";
import type { PlanRuleApprovalsSource } from "./merchantAttendancePlanRuleApprovals";

const actor = id(1), query = { siteId: "99990009", workerId: id(4), slotId: id(30) };
function model(): PlanExceptionSourceResult {
  const old = planRuleApprovalsWire("read"), saved = old.approval!;
  const { actorId: _actor, command: _command, observedAt: _observed, sourceBytes: _bytes, ...approval } = saved;
  void _actor; void _command; void _observed; void _bytes;
  const recordedAt = "2026-10-08T08:00:00.001000Z", startEventId = id(101), operationId = id(102);
  const original = { startAt: "2026-10-08T08:00:00.000001Z", endAt: "2026-10-08T15:54:59.999999Z" };
  const source: PlanExceptionSourceResult["source"] = { protocol: "plan-exception-evidence-v1", policy: "owner-confirmed-plan-edges-v1", siteId: query.siteId,
    worker: old.worker, slot: old.slot, phase: "ended", approval,
    sessions: [{ startEventId, operationId, lastEventId: id(103), lastSequence: 2,
      original, selected: { ...original }, effect: null,
      relation: { startEventId, operationId, selection: { slotId: old.slot.id, revision: old.slot.revision }, status: "linked", reason: null,
        slot: { ...old.slot }, observedRevision: old.slot.revision, recordedAt, currentCancelled: false },
      adoption: { startEventId, operationId, channel: "self", employeeId: old.worker.employeeId!, employeeAuthUserId: old.worker.employeeAuthUserId!, status: "adopted", reason: null,
        approval: { operationId: approval.operationId, revision: approval.revision, sourceId: approval.sourceId, sourceSha256: approval.sourceSha256, recordedAt: approval.recordedAt }, recordedAt, policy: "explicit-plan-approval-at-clock-in-v1" } }],
    context: { unassociated: { limited: false, items: [] }, leave: { limited: false, items: [] }, calendar: { limited: false, items: [] }, missing: { limited: false, items: [] }, pendingCorrections: { limited: false, items: [] } } };
  return structuredClone({ protocol: "plan-exception-source-v1", siteId: query.siteId, actorId: actor, worker: old.worker, slot: old.slot, readAt: "2026-10-09T00:00:00.000000Z", source,
    fingerprint: "b".repeat(64), eligible: true, blockers: [], candidate: calculateExceptionCandidate(source, true) });
}
function finish(v: PlanExceptionSourceResult, blockers: PlanExceptionBlocker[] = []) {
  v.worker = structuredClone(v.source.worker); v.slot = structuredClone(v.source.slot);
  v.blockers = PLAN_EXCEPTION_BLOCKERS.filter(b => blockers.includes(b)); v.eligible = !v.blockers.length;
  v.candidate = calculateExceptionCandidate(v.source, v.eligible); return v;
}
const parse = (value: unknown) => parsePlanExceptionSource(value, query, actor);
function rebuildFields(source: PlanRuleApprovalsSource) {
  for (const key of ["lateGraceMinutes", "earlyGraceMinutes"] as const) {
    const field: PlanRuleApprovalsSource["fields"][typeof key] = { state: "unconfigured", minutes: null, source: null, trace: [] };
    for (const layer of ["personal", "group", "enterprise"] as const) {
      const part = source[layer], publication = layer === "personal" ? source.personal.approval : layer === "group" ? source.group?.publication : source.enterprise.publication;
      const choice = publication?.rules[key], groupId = layer === "group" ? source.group?.groupId ?? null : null, ledgerRevision = part?.revision ?? null;
      const provenance = publication ? { layer, groupId, ledgerRevision: ledgerRevision!, operationId: publication.operationId, revision: publication.revision, actorId: publication.actorId } : null;
      const mode = choice?.mode ?? (layer === "personal" ? "missing_approval" : layer === "group" && !part ? "no_assignment" : "missing_publication"), minutes = choice?.mode === "value" ? choice.minutes : null;
      field.trace.push({ layer, groupId, ledgerRevision, mode, minutes, source: provenance });
      if (field.state === "unconfigured" && (mode === "value" || mode === "disabled")) { field.state = mode; field.minutes = minutes; field.source = provenance; }
    }
    source.fields[key] = field;
  }
}

test("146 compact projection preserves0 and exact1us trigger/excess without rounding", () => {
  const result = parse(model());
  assert.deepEqual(result.candidate.late, { state: "triggered", minutes: 0, rawDeltaUs: "1", excessUs: "1" });
  assert.deepEqual(result.candidate.early, { state: "triggered", minutes: 5, rawDeltaUs: "300000001", excessUs: "1" });
});
test("equal grace does not trigger; early arrival/late departure retain signed raw deltas", () => {
  const v = model(), session = v.source.sessions[0]; session.original.startAt = "2026-10-08T08:00:00.000000Z"; session.original.endAt = "2026-10-08T15:55:00.000000Z"; session.selected = { ...session.original };
  let result = parse(finish(v)); assert.equal(result.candidate.late.state, "not_triggered"); assert.equal(result.candidate.early.state, "not_triggered");
  session.original.startAt = "2026-10-08T07:59:59.999999Z"; session.original.endAt = "2026-10-08T16:00:00.000001Z"; session.selected = { ...session.original };
  result = parse(finish(v)); assert.equal(result.candidate.late.rawDeltaUs, "-1"); assert.equal(result.candidate.early.rawDeltaUs, "-1"); assert.equal(result.candidate.early.excessUs, "0");
});
test("disabled versus missing configuration stay distinct; neither acquires invented minutes", () => {
  const v = model(), source = v.source.approval!.source; source.personal.approval!.rules.lateGraceMinutes = { mode: "disabled" };
  source.personal.approval!.rules.earlyGraceMinutes = { mode: "inherit" }; source.group!.publication!.rules.earlyGraceMinutes = { mode: "inherit" }; source.enterprise.publication!.rules.earlyGraceMinutes = { mode: "inherit" }; rebuildFields(source);
  const result = parse(finish(v)); assert.equal(result.eligible, true); assert.equal(result.candidate.late.state, "disabled"); assert.equal(result.candidate.early.state, "unconfigured"); assert.equal(result.candidate.late.minutes, null);
});
test("malformed candidate signs, negative zero, precision/units and forged excess fail", () => {
  for (const delta of ["01", "-0", "+1", "1.0", "1e3"]) { const v = model(); v.candidate.late.rawDeltaUs = delta; assert.throws(() => parse(v)); }
  const v = model(); v.candidate.early.rawDeltaUs = "300001"; assert.throws(() => parse(v));
  v.candidate = calculateExceptionCandidate(v.source, true); v.candidate.late.excessUs = "2"; assert.throws(() => parseExceptionCandidate(v.candidate));
});
test("mixed closed/open aggregate end is null for BOTH views; never borrow sibling clock_out", () => {
  const v = model(), first = v.source.sessions[0]; first.original.endAt = "2026-10-08T12:00:00.000000Z"; first.selected = { ...first.original };
  const second = structuredClone(first); second.startEventId = id(201); second.operationId = id(202); second.lastEventId = id(201); second.lastSequence = 3;
  second.original = { startAt: "2026-10-08T14:00:00.000000Z", endAt: null }; second.selected = { ...second.original };
  for (const object of [second.relation, second.adoption!]) { object.startEventId = second.startEventId; object.operationId = second.operationId; }
  v.source.sessions.push(second); const result = parse(finish(v, ["session_open"]));
  assert.equal(result.candidate.original.endAt, null); assert.equal(result.candidate.selected.endAt, null); assert.equal(result.candidate.early.state, "blocked");
  v.candidate.original.endAt = first.original.endAt; assert.throws(() => parse(v));
});
test("empty explicitly linked set is blocked, never absence or fabricated endpoints", () => {
  const v = model(); v.source.sessions = []; v.source.approval = null;
  const result = parse(finish(v, ["no_associated_sessions"])); assert.deepEqual(result.candidate.original, { startAt: null, endAt: null });
  const broken = structuredClone(v); broken.blockers = []; broken.eligible = true; assert.throws(() => parse(broken));
});
test("session endpoints cannot be null-start, synthetic closed identity or changed-without-effect", () => {
  for (const mutate of [
    (v: PlanExceptionSourceResult) => { v.source.sessions[0].original.startAt = null; },
    (v: PlanExceptionSourceResult) => { v.source.sessions[0].lastEventId = v.source.sessions[0].startEventId; },
    (v: PlanExceptionSourceResult) => { v.source.sessions[0].selected.startAt = "2026-10-08T09:00:00.000000Z"; },
  ]) { const v = model(); mutate(v); assert.throws(() => parse(v)); }
});
test("latest approved endpoints can move original entirely into plan; effect lineage remains explicit", () => {
  const v = model(), s = v.source.sessions[0]; s.original = { startAt: "2026-10-07T08:00:00.000000Z", endAt: "2026-10-07T16:00:00.000000Z" };
  s.effect = { requestId: id(301), operationId: id(302), revision: 2, recordedAt: "2026-10-08T18:00:00.000000Z", rootRequestId: id(300), previousOperationId: id(299) };
  const result = parse(finish(v)); assert.notDeepEqual(result.candidate.original, result.candidate.selected); assert.equal(result.candidate.late.rawDeltaUs, "1");
  s.effect.previousOperationId = null; assert.throws(() => parse(finish(v)));
});
test("zero-duration and touching the plan endpoint are blocked by distinct exact146 reasons", () => {
  const v = model(), s = v.source.sessions[0]; s.original.endAt = s.original.startAt; s.selected = { ...s.original }; assert.equal(parse(finish(v, ["session_zero_duration"])).eligible, false);
  s.original = { startAt: "2026-10-08T07:00:00.000000Z", endAt: "2026-10-08T08:00:00.000000Z" }; s.selected = { ...s.original };
  assert.equal(parse(finish(v, ["session_outside_plan"])).candidate.late.state, "blocked");
});
test("omitted unknown/leave/calendar/missing/pending blockers cannot pass a forged eligible candidate", () => {
  for (const key of ["unassociated", "leave", "calendar", "missing", "pendingCorrections"] as const) {
    const v = model(); v.source.context[key].limited = true; assert.throws(() => parse(finish(v)));
    assert.equal(parse(finish(v, ["context_unknown"])).eligible, false);
  }
});
test("saved140 source validates publication choices, head, exact keys and BOTH field traces", () => {
  for (const mutate of [
    (v: PlanExceptionSourceResult) => { v.source.approval!.source.group!.publication!.rules.lateGraceMinutes = { mode: "value", minutes: 2 }; },
    (v: PlanExceptionSourceResult) => { v.source.approval!.source.enterprise.revision = 1; },
    (v: PlanExceptionSourceResult) => { v.source.approval!.source.fields.earlyGraceMinutes.trace[2].source!.operationId = id(888); },
    (v: PlanExceptionSourceResult) => { Object.assign(v.source.approval!.source.assignment!, { sourceText: "hidden" }); },
    (v: PlanExceptionSourceResult) => { v.source.approval!.source.personal.approval!.fromAt = "2026-10-09T00:00:00.000Z"; },
  ]) { const v = model(); mutate(v); assert.throws(() => parse(v)); }
});
test("zero heads, absent group and absent personal publication are valid unconfigured traces", () => {
  const v = model(), p = v.source.approval!.source; p.assignment = null; p.group = null; p.personal = { revision: 0, approval: null }; p.enterprise = { revision: 0, publication: null }; rebuildFields(p);
  assert.equal(parse(finish(v)).candidate.late.state, "unconfigured");
});
test("source actor and zone are historical; no current tzdata or current-version equality imposed", () => {
  const v = model(); v.source.slot.timeZone = "Saved/Retired_Zone"; v.source.sessions[0].relation.slot!.timeZone = "Saved/Retired_Zone";
  v.source.approval!.source.slot.timeZone = "Saved/Retired_Zone"; v.source.approval!.source.timeZone = "Other/Historical_Zone";
  v.source.worker.version = 30; assert.equal(parse(finish(v)).source.approval!.source.workerVersion, 2);
});
test("relation slot/revision/cancellation and adoption identities/status/ref are strongly paired", () => {
  for (const mutate of [
    (v: PlanExceptionSourceResult) => { v.source.sessions[0].relation.selection!.revision++; },
    (v: PlanExceptionSourceResult) => { v.source.sessions[0].relation.currentCancelled = true; },
    (v: PlanExceptionSourceResult) => { v.source.sessions[0].adoption!.employeeAuthUserId = id(999); },
    (v: PlanExceptionSourceResult) => { v.source.sessions[0].adoption!.reason = "approval_missing"; },
    (v: PlanExceptionSourceResult) => { v.source.sessions[0].adoption!.approval!.sourceId = id(777); },
  ]) { const v = model(); mutate(v); assert.throws(() => parse(v)); }
});
test("old relation without adoption remains missing and cannot be promoted to not_approved", () => {
  const v = model(); v.source.sessions[0].adoption = null; v.source.approval = null;
  assert.equal(parse(finish(v, ["adoption_missing"])).source.sessions[0].adoption, null);
  assert.throws(() => parse(finish(v, ["adoption_unverified"])));
});
test("later cancellation preserves saved linked snapshot; inactive read is accepted but blocked", () => {
  const v = model(); v.source.slot.cancelled = true; v.source.sessions[0].relation.currentCancelled = true; v.source.worker.active = false;
  const result = parse(finish(v, ["slot_cancelled", "worker_inactive"])); assert.equal(result.source.sessions[0].relation.slot!.cancelled, false);
});
test("leave terminal states and original calendar scope are strict but never automatic excuses", () => {
  const v = model(); v.source.context.leave.items = [{ requestId: id(401), operationId: id(402), revision: 2, status: "approved", startAt: "2026-10-08T08:00:00.000Z", endAt: "2026-10-08T09:00:00.000Z", recordedAt: "2026-10-07T00:00:00.000000Z" }];
  assert.equal(parse(finish(v, ["leave_approved"])).eligible, false);
  v.source.context.leave.items[0].status = "cancelled"; assert.throws(() => parse(finish(v)));
  v.source.context.leave.items = []; v.source.context.calendar.items = [{ entryId: id(410), operationId: id(410), revision: 1, status: "created", locationId: null, kind: "closure", timeZone: "Saved/Zone", fromDate: "2026-10-08", throughDate: "2026-10-08", fromAt: "2026-10-07T22:00:00.000000Z", toAt: "2026-10-08T22:00:00.000000Z", recordedAt: "2026-10-07T00:00:00.000000Z" }];
  assert.equal(parse(finish(v, ["calendar_entry"])).eligible, false);
  v.source.context.calendar.items[0].locationId = id(999); assert.throws(() => parse(finish(v, ["calendar_entry"])));
});
test("unassociated moved-in effect remains distinct and must intersect in original OR selected view", () => {
  const v = model(), s = structuredClone(v.source.sessions[0]); s.startEventId = id(500); s.operationId = id(501); s.lastEventId = id(502);
  const { relation: _r, adoption: _a, ...plain } = s; void _r; void _a;
  v.source.context.unassociated.items = [{ ...plain, relationSlotId: null }]; assert.equal(parse(finish(v, ["unassociated_session"])).eligible, false);
  v.source.context.unassociated.items[0].relationSlotId = query.slotId; assert.throws(() => parse(finish(v, ["unassociated_session"])));
});
test("pending corrections attached to this plan may propose moving OUT; unassociated out-of-window proposals reject", () => {
  const v = model(); v.source.context.pendingCorrections.items = [{ kind: "revision", requestId: id(601), operationId: id(601), revision: 1, startEventId: id(101), startAt: "2026-10-07T08:00:00.000000Z", endAt: "2026-10-07T09:00:00.000000Z", recordedAt: "2026-10-08T17:00:00.000000Z" }];
  assert.equal(parse(finish(v, ["pending_correction"])).eligible, false);
  v.source.context.pendingCorrections.items[0].startEventId = id(666); assert.throws(() => parse(finish(v, ["pending_correction"])));
});
test("100 section cap, limited empty, ordered unique IDs and exact context keys fail closed", () => {
  const v = model(); const item = { requestId: id(1), operationId: id(2), revision: 2, status: "rejected" as const, startAt: "2026-10-08T08:00:00.000Z", endAt: "2026-10-08T09:00:00.000Z", recordedAt: "2026-10-07T00:00:00.000000Z" };
  v.source.context.leave.items = Array.from({ length: 100 }, (_, i) => ({ ...item, requestId: id(1000 + i), operationId: id(2000 + i) })); assert.equal(parse(v).source.context.leave.items.length, 100);
  v.source.context.leave.items.push({ ...item, requestId: id(1100) }); assert.throws(() => parse(v));
  v.source.context.leave.items.pop(); v.source.context.leave.limited = true; assert.throws(() => parse(finish(v, ["context_unknown"])));
});
test("full input is detached before freezing; source relation and nested rules never alias or freeze caller", () => {
  const v = model(), before = structuredClone(v), result = parse(v);
  assert.deepEqual(v, before); assert.equal(Object.isFrozen(v.source.sessions[0].relation), false); assert.notEqual(result.source.sessions[0].relation, v.source.sessions[0].relation);
  assert.equal(Object.isFrozen(result.source.approval!.source.fields.lateGraceMinutes.trace[0]), true);
  v.source.sessions[0].relation.reason = "cancelled"; assert.equal(result.source.sessions[0].relation.reason, null);
});
test("strict UTF8/JSON-tree and duplicate key checks reject getters, cycles, sparse arrays and body sourceText", () => {
  assert.throws(() => parsePlanExceptionJson('{"x":1,"x":2}')); assert.throws(() => safeTree({ bad: "\ud800" }));
  const v = model(); Object.defineProperty(v, "source", { enumerable: true, get() { throw Error("must not execute"); } }); assert.throws(() => parse(v));
  const loop: Record<string, unknown> = {}; loop.loop = loop; assert.throws(() => safeTree(loop)); assert.throws(() => safeTree(Array(1)));
  assert.throws(() => parse({ ...model(), sourceText: "private" })); assert.throws(() => parsePlanExceptionSource(model(), { ...query, extra: 1 } as typeof query, actor));
});
test("canonical Gregorian microseconds, pre-epoch remainder, Unicode codepoints and boundaries stay exact", () => {
  assert.equal(micros("1969-12-31T23:59:59.999999Z"), BigInt(-1)); assert.equal(micros("2000-01-01T00:00:00.001Z") - micros("2000-01-01T00:00:00.000999Z"), BigInt(1));
  assert.throws(() => stamp("2026-02-30T00:00:00.000000Z")); assert.throws(() => stamp("0000-01-01T00:00:00.000000Z"));
  const v = model(); v.source.worker.workerName = "😀".repeat(100); assert.equal(parse(finish(v)).worker.workerName.length, 200);
});
