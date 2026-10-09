import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { assertOutageReviewWriteQuery, outageReviewCommandFingerprintText, parseOutageReviewCommand, parseOutageReviewQuery, parseOutageReviewResult } from "./merchantAttendanceOutageReview";
import { executeOutageReview, outageReviewCommandFingerprint, outageReviewSiteEnabled, projectOutageReviewResult } from "./merchantAttendanceOutageReview.server";
import type { OutageReviewAction, OutageReviewCommand, OutageReviewEntry, OutageReviewEvidence, OutageReviewProposal, OutageReviewQuery, OutageReviewResult } from "./merchantAttendanceOutageReviewContract";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const siteId = "99990001", owner = id(1), employee = id(2), declarationId = id(3), at = "2026-10-07T12:00:00.000000Z";
const hash = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const q = (access: "owner" | "self" = "owner"): OutageReviewQuery => ({ siteId, declarationId, access, mode: "detail" });
function evidence(): OutageReviewEvidence {
  const span = { startAt: "2026-10-07T08:00:00.000000Z", endAt: "2026-10-07T10:00:00.000000Z" };
  const linkEvidence: OutageReviewEvidence["linkEvidence"] = { protocol: "outage-link-evidence-v1", siteId, declarationId, workerId: id(4), employeeId: id(5), employeeAuthUserId: employee, workerVersion: 2, employeeVersion: 3, generation: 0,
    declaredInterval: { ...span, timeZone: "Europe/Madrid", startOffsetMinutes: 120, endOffsetMinutes: 120 }, items: [{ reference: { kind: "session", startEventId: id(6), lastEventId: id(7), lastSequence: 2, effectOperationId: null, effectRevision: null }, locationId: id(8), timeZone: "Europe/Madrid", original: { ...span }, selected: { ...span }, evidenceFingerprint: "a".repeat(64), open: false, pending: false }] };
  return { protocol: "outage-review-evidence-v1", siteId, declarationId, linkOperationId: id(9), linkRevision: 1, linkFingerprint: hash(JSON.stringify(linkEvidence)), linkEvidence,
    original: { status: "not_required", operationId: null, channel: null, eventId: null } };
}
function proposal(ev = evidence()): OutageReviewProposal { return { operationId: id(10), revision: 1, resultVersion: 1, action: "propose", actorId: owner, resultFingerprint: hash(JSON.stringify(ev)), reason: "明确恢复结果，仅供双方核对", recordedAt: at, evidence: ev }; }
const lean = (p: OutageReviewProposal): OutageReviewEntry => { const { evidence: _e, ...rest } = p; void _e; return rest; };
function base(query = q()): OutageReviewResult { return { protocol: "attendance-outage-review-v1", siteId, declarationId, access: query.access, mode: query.mode, actorId: query.access === "owner" ? owner : employee, readAt: at, canWrite: false, revision: 0, resultVersion: 0, current: null, proposal: null, response: null, status: null, history: [], historyTruncated: false, receipt: null }; }
function detail(action: "propose" | "confirm" | "resolve" | "dispute" | "reopen" = "propose", query = q(), ev = evidence()): OutageReviewResult {
  const p = proposal(ev), count = { propose: 1, confirm: 2, resolve: 3, dispute: 4, reopen: 4 }[action];
  const response: OutageReviewEntry | null = action === "propose" ? null : { ...lean(p), operationId: id(action === "dispute" ? 14 : 12), revision: action === "dispute" ? 4 : 2, action: action === "dispute" ? "dispute" : "confirm", actorId: employee, reason: "本人核对该精确版本" };
  const current: OutageReviewEntry = action === "propose" ? lean(p) : action === "confirm" || action === "dispute" ? response! : { ...lean(p), operationId: id(action === "resolve" ? 13 : 15), revision: count, action };
  return { ...base(query), revision: count, resultVersion: 1, canWrite: true, current, proposal: p, response, status: { basisFingerprint: p.resultFingerprint, linkOperationId: ev.linkOperationId, linkRevision: ev.linkRevision, linkFingerprint: ev.linkFingerprint,
    blockers: action === "propose" ? ["unconfirmed"] : action === "dispute" ? ["disputed"] : action === "reopen" ? ["reopened"] : [], canPropose: query.access === "owner" && action !== "resolve", canConfirm: query.access === "self" && ["propose", "dispute", "reopen"].includes(action), canResolve: query.access === "owner" && action === "confirm", resolved: action === "resolve" } };
}
function command(action: OutageReviewAction = "propose", ev = evidence()): OutageReviewCommand { return { action, operationId: id(10), expectedRevision: action === "propose" ? 0 : 1, expectedResultVersion: action === "propose" ? 0 : 1, expectedFingerprint: proposal(ev).resultFingerprint, reason: proposal(ev).reason }; }
function raw(v: OutageReviewResult): unknown { const pp = (p: OutageReviewProposal | null) => p && { ...p, sourceText: JSON.stringify(p.evidence) }; return structuredClone({ ...v, proposal: pp(v.proposal), receipt: v.receipt && { ...v.receipt, proposal: pp(v.receipt.proposal) } }); }
function saved(c = command(), query = q(), p = proposal()): OutageReviewResult { const e: OutageReviewEntry = { operationId: c.operationId, revision: c.expectedRevision + 1, resultVersion: c.expectedResultVersion + (c.action === "propose" ? 1 : 0), resultFingerprint: c.expectedFingerprint, action: c.action, actorId: query.access === "owner" ? owner : employee, reason: c.reason, recordedAt: at };
  return { ...base(query), revision: e.revision, resultVersion: e.resultVersion, receipt: { operationId: e.operationId, commandFingerprint: outageReviewCommandFingerprint(query, c), entry: e, proposal: p } }; }

test("strict queries allow own exact recovery without authority overrides or mixed modes", () => {
  for (const query of [q(), q("self"), { ...q("self"), mode: "recover", operationId: id(12) }, { ...q(), mode: "history", beforeRevision: null }]) assert.deepEqual(parseOutageReviewQuery(query), query);
  for (const query of [{ ...q(), mode: "preview" }, { ...q(), operationId: id(1) }, { ...q(), mode: "history", beforeRevision: 0 }, { ...q(), mode: "history", beforeRevision: 1002 }, { ...q(), approved: true }]) assert.throws(() => parseOutageReviewQuery(query));
});
test("exact six-key commands reserve final revisions for non-closing safety actions", () => {
  assert.deepEqual(parseOutageReviewCommand(command()), command());
  assert.doesNotThrow(() => parseOutageReviewCommand({ ...command("dispute"), expectedRevision: 999, expectedResultVersion: 998 }));
  assert.doesNotThrow(() => parseOutageReviewCommand({ ...command("reopen"), expectedRevision: 999, expectedResultVersion: 998 }));
  for (const patch of [{ reason: " " }, { expectedResultVersion: 1 }, { expectedRevision: 1 }, { expectedRevision: -0 }, { workerId: id(4) }, { reason: "x".repeat(1001) }]) assert.throws(() => parseOutageReviewCommand({ ...command(), ...patch }));
  for (const action of ["propose", "confirm", "resolve"]) assert.throws(() => parseOutageReviewCommand({ ...command(), action, expectedRevision: 998, expectedResultVersion: 1 }));
});
test("owner can never use its access mode for self confirmation or dispute", () => {
  for (const action of ["confirm", "dispute"] as const) { assert.doesNotThrow(() => assertOutageReviewWriteQuery(q("self"), command(action))); assert.throws(() => assertOutageReviewWriteQuery(q(), command(action))); }
  for (const action of ["propose", "resolve", "reopen"] as const) { assert.doesNotThrow(() => assertOutageReviewWriteQuery(q(), command(action))); assert.throws(() => assertOutageReviewWriteQuery(q("self"), command(action))); }
  assert.throws(() => assertOutageReviewWriteQuery({ ...q(), mode: "recover", operationId: id(10) }, command()));
});
test("fingerprint uses fixed nine scalar fields and preserves exact reason and access", () => {
  const c = command(); assert.equal(outageReviewCommandFingerprintText(q(), c), JSON.stringify([siteId, "owner", declarationId, c.action, c.operationId, 0, 0, c.expectedFingerprint, c.reason]));
  assert.equal(outageReviewCommandFingerprint(q(), c), outageReviewCommandFingerprint(q(), Object.fromEntries(Object.entries(c).reverse()) as OutageReviewCommand));
  assert.notEqual(outageReviewCommandFingerprint(q(), c), outageReviewCommandFingerprint(q(), { ...c, reason: "另一份结果" }));
});
test("pending proposal, true self confirm, resolve, dispute and reopen are distinct exact states", () => {
  for (const access of ["owner", "self"] as const) for (const action of ["propose", "confirm", "resolve", "dispute", "reopen"] as const) {
    const value = detail(action, q(access)), result = projectOutageReviewResult(raw(value), q(access), access === "owner" ? owner : employee);
    assert.deepEqual(result, value); assert(Object.isFrozen(result.proposal!.evidence.linkEvidence.items)); assert(!("sourceText" in result.proposal!));
  }
});
test("proposal canonical SHA and semantic source are validated before acknowledgement", () => {
  for (const mutate of [(p: Record<string, unknown>) => p.sourceText = "{}", (p: Record<string, unknown>) => p.resultFingerprint = "b".repeat(64), (p: Record<string, unknown>) => p.sourceText = "x".repeat(131073)]) {
    const r = raw(detail()) as { proposal: Record<string, unknown> }; mutate(r.proposal); assert.throws(() => projectOutageReviewResult(r, q(), owner));
  }
});
test("known original is precise while unknown never becomes a claimed failed operation", () => {
  const ev = evidence(); ev.original = { status: "verified", operationId: id(20), channel: "web", eventId: id(6) };
  assert.doesNotThrow(() => projectOutageReviewResult(raw(detail("propose", q(), ev)), q(), owner));
  ev.original = { ...ev.original, status: "unresolved", eventId: null };
  const v = detail("propose", q("self"), ev); v.status!.blockers.push("original_unknown"); v.status!.canConfirm = false;
  assert.doesNotThrow(() => projectOutageReviewResult(raw(v), q("self"), employee));
  v.status!.canConfirm = true; assert.throws(() => projectOutageReviewResult(raw(v), q("self"), employee));
  ev.original.status = "verified"; assert.throws(() => projectOutageReviewResult(raw(detail("propose", q(), ev)), q(), owner));
});
test("open or pending evidence may be proposed but cannot be confirmed or resolved", () => {
  const ev = evidence(); ev.linkEvidence.items[0].pending = true;
  const v = detail("propose", q("self"), ev); v.status!.blockers.push("pending_source"); v.status!.canConfirm = false;
  assert.doesNotThrow(() => projectOutageReviewResult(raw(v), q("self"), employee));
  v.status!.canConfirm = true; assert.throws(() => projectOutageReviewResult(raw(v), q("self"), employee));
  const resolved = detail("resolve", q(), ev); resolved.status!.blockers.push("pending_source"); assert.throws(() => projectOutageReviewResult(raw(resolved), q(), owner));
  assert.throws(() => projectOutageReviewResult(raw(detail("propose", q("self"), ev)), q("self"), employee));
});
test("changed source invalidates current resolution without rewriting saved proposal or confirmation", () => {
  const v = detail("resolve"), original = structuredClone(v.proposal), response = structuredClone(v.response);
  v.status!.basisFingerprint = "b".repeat(64); v.status!.blockers = ["source_changed", "result_changed"]; v.status!.resolved = false;
  const result = projectOutageReviewResult(raw(v), q(), owner); assert.deepEqual(result.proposal, original); assert.deepEqual(result.response, response);
  v.status!.resolved = true; assert.throws(() => projectOutageReviewResult(raw(v), q(), owner));
});
test("reopened result retains old response but cannot be closed without another self response", () => {
  const v = detail("reopen"); assert.equal(v.response!.action, "confirm");
  v.status!.canResolve = true; assert.throws(() => projectOutageReviewResult(raw(v), q(), owner));
  const self = detail("resolve", q("self")); self.status!.canConfirm = true; assert.throws(() => projectOutageReviewResult(raw(self), q("self"), employee));
});
test("stale response version, actor or fingerprint cannot confirm a different result", () => {
  for (const patch of [{ resultVersion: 2 }, { actorId: owner }, { resultFingerprint: "b".repeat(64) }, { revision: 1 }]) {
    const v = detail("confirm"); v.response = { ...v.response!, ...patch }; assert.throws(() => projectOutageReviewResult(raw(v), q(), owner));
  }
  assert.throws(() => projectOutageReviewResult(raw(detail("propose", q("self"))), q("self"), owner));
  const v = detail(); v.current!.reason = "被替换的正文"; assert.throws(() => projectOutageReviewResult(raw(v), q(), owner));
  const reopened = detail("reopen"); reopened.response = null; assert.throws(() => projectOutageReviewResult(raw(reopened), q(), owner));
});
test("POST and recovery return only immutable original entry plus original result", () => {
  const v = saved(); assert.deepEqual(projectOutageReviewResult(raw(v), q(), owner, command()), v);
  const query: OutageReviewQuery = { ...q(), mode: "recover", operationId: id(10) }; assert.doesNotThrow(() => projectOutageReviewResult(raw({ ...v, mode: "recover" }), query, owner));
  for (const patch of [{ canWrite: true }, { current: lean(proposal()) }, { status: detail().status }, { resultVersion: 2 }]) assert.throws(() => projectOutageReviewResult(raw({ ...v, ...patch }), q(), owner, command()));
  assert.throws(() => projectOutageReviewResult(raw(v), q(), owner, { ...command(), reason: "变更原命令" }));
});
test("self exact confirmation recovery requires same actor and the saved employee identity", () => {
  const c = { ...command("confirm"), operationId: id(12) }, v = saved(c, q("self"));
  assert.doesNotThrow(() => projectOutageReviewResult(raw(v), q("self"), employee, c));
  const query: OutageReviewQuery = { ...q("self"), mode: "recover", operationId: id(12) };
  assert.doesNotThrow(() => projectOutageReviewResult(raw({ ...v, mode: "recover" }), query, employee));
  assert.throws(() => projectOutageReviewResult(raw({ ...v, mode: "recover" }), query, owner));
});

test("recovery cannot change the access mode of an immutable self response", () => {
  const c = { ...command("confirm"), operationId: id(12) }, v = saved(c, q("self"));
  const query: OutageReviewQuery = { ...q(), mode: "recover", operationId: id(12) };
  // Even if the same Auth identity later owns the merchant, self and owner
  // recovery remain distinct operations and authorization scopes.
  const claimed = { ...v, access: "owner", mode: "recover" };
  assert.throws(() => projectOutageReviewResult(raw(claimed as OutageReviewResult), query, employee));
});
test("history is bounded contiguous descending summary-only with exact cursor", () => {
  const query: OutageReviewQuery = { ...q(), mode: "history", beforeRevision: null }, v: OutageReviewResult = { ...base(query), revision: 3, resultVersion: 1, history: [detail("resolve").current!, detail("confirm").current!, lean(proposal())] };
  assert.doesNotThrow(() => projectOutageReviewResult(raw(v), query, owner));
  for (const patch of [{ history: v.history.slice(0, 2) }, { proposal: proposal() }, { historyTruncated: true }, { history: [...v.history].reverse() }]) assert.throws(() => projectOutageReviewResult(raw({ ...v, ...patch }), query, owner));
  assert.doesNotThrow(() => projectOutageReviewResult(raw({ ...v, history: [lean(proposal())] }), { ...query, beforeRevision: 2 }, owner));
});
test("unsafe trees, extra status authority and future source timestamps fail closed", () => {
  let called = false; assert.throws(() => parseOutageReviewQuery({ ...q(), get mode() { called = true; return "detail"; } })); assert.equal(called, false);
  assert.throws(() => parseOutageReviewResult({ ...detail(), employeeConfirmed: true }, q(), owner));
  const ev = evidence(); ev.linkEvidence.items[0].selected.endAt = "2026-10-07T12:00:00.000001Z"; assert.throws(() => projectOutageReviewResult(raw(detail("propose", q(), ev)), q(), owner));
});
test("service defaults off, sends exact verified auth and preserves only safe errors", async () => {
  assert(!outageReviewSiteEnabled(siteId, {})); assert(outageReviewSiteEnabled(siteId, { FAOLLA_ATTENDANCE_OUTAGE_REVIEW_ENABLED: "1", FAOLLA_ATTENDANCE_OUTAGE_REVIEW_SITE_IDS: siteId }));
  assert(!outageReviewSiteEnabled(siteId, { FAOLLA_ATTENDANCE_OUTAGE_REVIEW_ENABLED: "1", FAOLLA_ATTENDANCE_OUTAGE_REVIEW_SITE_IDS: siteId + "," }));
  const calls: unknown[] = [], query: OutageReviewQuery = { ...q(), mode: "recover", operationId: id(10) };
  const service = { rpc: async (name: string, args: Record<string, unknown>) => { calls.push({ name, args }); return { data: raw({ ...saved(), mode: "recover" }), error: null }; } };
  await executeOutageReview({ query, authUserId: owner, moduleEnabled: false }, service);
  assert.deepEqual(calls, [{ name: "faolla_attendance_outage_review_v1", args: { p_query: query, p_auth_user_id: owner, p_command: null, p_allow_write: false } }]);
  await assert.rejects(executeOutageReview({ query: q(), authUserId: owner, command: command("confirm") }, service), /attendance_invalid_request/); assert.equal(calls.length, 1);
  await assert.rejects(executeOutageReview({ query: q(), authUserId: owner }, { rpc: async () => ({ data: null, error: { message: "private SQL details" } }) }), /attendance_unavailable/);
  await assert.rejects(executeOutageReview({ query: q(), authUserId: owner }, { rpc: async () => ({ data: null, error: { message: "attendance_outage_review_changed" } }) }), /attendance_outage_review_changed/);
});
