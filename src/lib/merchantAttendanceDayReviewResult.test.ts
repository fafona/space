// Pure public-wire acceptance only; no database/Auth/source completeness claim.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { parseDayReviewSavedResult, type DayReviewSelfEntry } from "./merchantAttendanceDayReviewResult";
import { DAY_REVIEW_PROTOCOL, dayReviewCommandFingerprintText, type DayReviewQuery, type DayReviewDecideCommand } from "./merchantAttendanceDayReviewContract";
const id = (n: number) => `19900000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const actor = id(1), member = id(6), siteId = "99990199";
const at = (n: number) => `2026-10-08T12:00:${String(n).padStart(2, "0")}.123456Z`;
const target = () => ({ kind: "day" as const, workerId: id(2), employeeId: id(5), employeeAuthUserId: member,
  workDate: "2026-10-07", timeZone: "UTC", fromAt: "2026-10-07T00:00:00.000000Z", toAt: "2026-10-08T00:00:00.000000Z", slotId: null });
function decision(revision = 1) { return { action: "decide", reason: "继续核查，未发现记录不是缺勤结论", outcome: "follow_up",
  sourceFingerprint: "a".repeat(64), observations: ["no_record"], calendarReference: null, selfStatementOperationId: null,
  receipt: { operationId: id(100 + revision), caseId: id(4), revision, action: "decide", actorId: actor, recordedAt: at(revision), commandFingerprint: "b".repeat(64) } }; }
function head(revision = 1) { return { caseId: id(4), target: target(), openedAt: at(1), revision,
  latestDecision: decision(revision), latestSelf: null, needsResponse: false }; }
const common = (who = actor) => ({ protocol: DAY_REVIEW_PROTOCOL, siteId, actorId: who, readAt: at(59) });
const query = (): Extract<DayReviewQuery, { mode: "detail" }> => ({ siteId, access: "owner", mode: "detail", caseId: id(4) });
const detail = (who = actor) => ({ ...common(who), access: who === actor ? "owner" : "self", kind: "detail", head: head(), operation: null, replayed: false });

test("C15-A saved frames preserve UTC geometry and historical zone labels, return detached frozen projections", () => {
  const raw = detail(); raw.head.target.timeZone = "Saved/Unavailable_Name";
  const result = parseDayReviewSavedResult(raw, query(), actor); assert.equal(result.kind, "detail");
  if (result.kind !== "detail") throw Error("fixture");
  assert.equal(result.head.target.timeZone, "Saved/Unavailable_Name"); assert.equal(result.head.target.fromAt, target().fromAt);
  raw.head.target.fromAt = "changed"; assert.equal(result.head.target.fromAt, target().fromAt);
  assert(Object.isFrozen(result.head.latestDecision.receipt));
  assert.doesNotMatch(JSON.stringify(result), /sourceCanonical|sourceText|latitude|longitude|actorAuthSet|workedUs/);
  for (const patch of [{ siteId: "99990198" }, { actorId: id(99) }, { readAt: at(0) }, { sourceChanged: false }, { sourceText: "private" }])
    assert.throws(() => parseDayReviewSavedResult({ ...detail(), ...patch }, query(), actor));
});

test("C15-A self can only receive the saved dual-identity target; owner cannot decide for that same Auth", () => {
  const q = { ...query(), access: "self" as const }; assert.equal(parseDayReviewSavedResult(detail(member), q, member).kind, "detail");
  const wrong = detail(member); wrong.head.target.employeeAuthUserId = id(7);
  assert.throws(() => parseDayReviewSavedResult(wrong, q, member));
  for (const field of ["employeeAuthUserIds", "source", "gps"])
    assert.throws(() => parseDayReviewSavedResult({ ...detail(), [field]: [] }, query(), actor));
  const ownDecision = detail(); ownDecision.head.latestDecision.receipt.actorId = member;
  assert.throws(() => parseDayReviewSavedResult(ownDecision, query(), actor));
});

test("C15-A latest self claim/dispute advances the saved head, and never silently agrees with a decision", () => {
  const self: DayReviewSelfEntry = { action: "explain", reason: "本人报告可能漏记", decisionOperationId: id(101), claim: "worked_missing_records",
    receipt: { operationId: id(201), caseId: id(4), revision: 2, action: "explain", actorId: member, recordedAt: at(2), commandFingerprint: "c".repeat(64) } };
  const raw = { ...detail(), head: { ...head(), revision: 2, latestSelf: self, needsResponse: true } };
  assert.equal(parseDayReviewSavedResult(raw, query(), actor).kind, "detail");
  const variants = [
    { ...raw.head, needsResponse: false }, { ...raw.head, revision: 3 },
    { ...raw.head, latestSelf: { ...self, decisionOperationId: id(99) } },
    { ...raw.head, latestSelf: { ...self, receipt: { ...self.receipt, actorId: actor } } },
    { ...raw.head, latestSelf: { ...self, action: "dispute", claim: "not_worked", receipt: { ...self.receipt, action: "dispute" } } },
  ];
  for (const h of variants) assert.throws(() => parseDayReviewSavedResult({ ...raw, head: h }, query(), actor));
});

test("C15-A saved entries preserve narrow outcome/reference semantics, not fabricated hours or absence", () => {
  for (const patch of [{ outcome: "absent" }, { observations: [] }, { observations: ["recorded_work", "no_record"] }, { observations: ["no_record", "recorded_work"] },
    { observations: ["no_record", "no_record"] }, { outcome: "calendar_exempt", calendarReference: { entryId: id(9), operationId: id(9), revision: 1 } },
    { outcome: "not_worked_reported", selfStatementOperationId: null }, { outcome: "recorded_work_reviewed", observations: ["no_record"] },
    { outcome: "recorded_work_reviewed", observations: ["pending_source", "recorded_work"] }, { workedUs: 0 }]) {
    const raw = detail(); Object.assign(raw.head.latestDecision, patch);
    assert.throws(() => parseDayReviewSavedResult(raw, query(), actor));
  }
  const raw = detail(); Object.assign(raw.head.latestDecision, { outcome: "not_worked_reported", selfStatementOperationId: id(77) });
  assert.equal(parseDayReviewSavedResult(raw, query(), actor).kind, "detail");
});

test("C15-A keyset case pages have exact descending keys, explicit continuation, no duplicate or foreign worker", () => {
  const q: DayReviewQuery = { siteId, access: "owner", mode: "list", workerId: id(2), cursor: null };
  const items = Array.from({ length: 25 }, (_, n) => { const h = head(); h.caseId = id(400 - n);
    h.latestDecision = { ...h.latestDecision, receipt: { ...h.latestDecision.receipt, caseId: h.caseId } }; return h; });
  const nextCursor = { openedAt: at(1), caseId: items.at(-1)!.caseId }, raw = { ...common(), access: "owner", kind: "list", items, nextCursor };
  assert.equal(parseDayReviewSavedResult(raw, q, actor).kind, "list");
  for (const patch of [{ items: [...items].reverse() }, { items: [...items, items[0]] }, { items: [items[0], items[0]], nextCursor: null },
    { items: items.slice(0, 24) }, { nextCursor: { ...nextCursor, caseId: id(999) } }]) assert.throws(() => parseDayReviewSavedResult({ ...raw, ...patch }, q, actor));
  assert.throws(() => parseDayReviewSavedResult(raw, { ...q, workerId: id(99) }, actor));
  assert.throws(() => parseDayReviewSavedResult(raw, { ...q, cursor: nextCursor }, actor));
  assert.equal(parseDayReviewSavedResult({ ...raw, items: [], nextCursor: null }, { ...q, cursor: nextCursor }, actor).kind, "list");
});

test("C15-A history is bounded 25+continuation and contiguous, never a selectively omitted revision", () => {
  const q: DayReviewQuery = { siteId, access: "owner", mode: "history", caseId: id(4), beforeRevision: null };
  const items = Array.from({ length: 25 }, (_, n) => decision(27 - n)), raw = { ...common(), access: "owner", kind: "history", head: head(27), items, nextRevision: 3 };
  assert.equal(parseDayReviewSavedResult(raw, q, actor).kind, "history");
  for (const patch of [{ items: items.slice(1), nextRevision: null }, { nextRevision: null }, { nextRevision: 4 }, { items: [...items].reverse() }, { items: [] }])
    assert.throws(() => parseDayReviewSavedResult({ ...raw, ...patch }, q, actor));
  const older = { ...raw, items: [decision(2), decision(1)], nextRevision: null };
  assert.equal(parseDayReviewSavedResult(older, { ...q, beforeRevision: 3 }, actor).kind, "history");
  assert.throws(() => parseDayReviewSavedResult({ ...older, items: [decision(2)] }, { ...q, beforeRevision: 3 }, actor));
  assert.equal(parseDayReviewSavedResult({ ...older, items: [] }, { ...q, beforeRevision: 1 }, actor).kind, "history");
});

test("C15-A minimal original recovery has no dynamic head and exact command receipt is required for a POST result", () => {
  const q: Extract<DayReviewQuery, { mode: "preview" }> = { siteId, access: "owner", mode: "preview", workerId: id(2), workDate: target().workDate, slotId: null, caseId: null };
  const c: DayReviewDecideCommand = { action: "decide", operationId: id(101), caseId: id(4), expectedRevision: 0, workerId: id(2), employeeId: id(5), employeeAuthUserId: member,
    expectedFingerprint: "a".repeat(64), outcome: "follow_up", calendarReference: null, selfStatementOperationId: null, reason: decision().reason };
  const fingerprint = createHash("sha256").update(dayReviewCommandFingerprintText(q, actor, c)).digest("hex");
  const raw = detail(), operation = decision(); operation.receipt = { ...operation.receipt, commandFingerprint: fingerprint }; raw.head.latestDecision = operation;
  assert.equal(parseDayReviewSavedResult({ ...raw, operation }, q, actor, { command: c, fingerprint }).kind, "detail");
  assert.throws(() => parseDayReviewSavedResult({ ...raw, operation: { ...operation, reason: "异体" } }, q, actor, { command: c, fingerprint }));
  assert.throws(() => parseDayReviewSavedResult({ ...raw, operation: null }, q, actor, { command: c, fingerprint }));
  const minimal = { ...common(), kind: "receipt", receipt: operation.receipt, replayed: true };
  assert.equal(parseDayReviewSavedResult(minimal, { siteId, mode: "recover", operationId: c.operationId }, actor).kind, "receipt");
  assert.equal(parseDayReviewSavedResult(minimal, q, actor, { command: c, fingerprint }).kind, "receipt");
  for (const patch of [{ head: raw.head }, { replayed: false }, { receipt: { ...operation.receipt, actorId: member } }])
    assert.throws(() => parseDayReviewSavedResult({ ...minimal, ...patch }, { siteId, mode: "recover", operationId: c.operationId }, actor));
  assert.throws(() => parseDayReviewSavedResult(raw, { siteId, mode: "recover", operationId: c.operationId }, actor));
});

test("C15-A ledger history and POST entries agree with the exact saved head, including first revision time", () => {
  const q: DayReviewQuery = { siteId, access: "owner", mode: "history", caseId: id(4), beforeRevision: null };
  const raw = { ...common(), access: "owner", kind: "history", head: head(), items: [decision()], nextRevision: null };
  assert.equal(parseDayReviewSavedResult(raw, q, actor).kind, "history");
  for (const patch of [{ reason: "异体" }, { receipt: { ...decision().receipt, operationId: id(999) } },
    { receipt: { ...decision().receipt, recordedAt: at(2) } }]) {
    assert.throws(() => parseDayReviewSavedResult({ ...raw, items: [{ ...decision(), ...patch }] }, q, actor));
  }
  const older = { ...raw, head: head(3), items: [decision(2), decision(1)] };
  assert.equal(parseDayReviewSavedResult(older, { ...q, beforeRevision: 3 }, actor).kind, "history");
  assert.throws(() => parseDayReviewSavedResult({ ...older, items: [decision(2), { ...decision(1), receipt: { ...decision(1).receipt, recordedAt: at(2) } }] },
    { ...q, beforeRevision: 3 }, actor));
  assert.throws(() => parseDayReviewSavedResult({ ...older, items: [{ ...decision(2), receipt: { ...decision(2).receipt, operationId: decision(3).receipt.operationId } }, decision(1)] },
    { ...q, beforeRevision: 3 }, actor));
  const self: DayReviewSelfEntry = { action: "explain", reason: "本人说明", decisionOperationId: id(101), claim: "uncertain",
    receipt: { operationId: id(201), caseId: id(4), revision: 2, action: "explain", actorId: member, recordedAt: at(2), commandFingerprint: "c".repeat(64) } };
  const withSelf = { ...raw, head: { ...head(), revision: 2, latestSelf: self, needsResponse: true }, items: [self, decision()] };
  assert.equal(parseDayReviewSavedResult(withSelf, q, actor).kind, "history");
  assert.throws(() => parseDayReviewSavedResult({ ...withSelf, items: [{ ...self, reason: "异体" }, decision()] }, q, actor));
});

test("C15-A response parsers reject getters without evaluating them, sparse lists, cycles and oversized Unicode", () => {
  let reads = 0; const getter = { ...detail() }; Object.defineProperty(getter.head, "revision", { enumerable: true, get() { reads++; return 1; } });
  assert.throws(() => parseDayReviewSavedResult(getter, query(), actor)); assert.equal(reads, 0);
  const cycle: Record<string, unknown> = { ...detail() }; cycle.cycle = cycle; assert.throws(() => parseDayReviewSavedResult(cycle, query(), actor));
  const raw = detail(); raw.head.latestDecision.reason = "界".repeat(400000); assert.throws(() => parseDayReviewSavedResult(raw, query(), actor));
});
