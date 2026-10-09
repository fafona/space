import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  ADMINISTRATIVE_CLOSURE_BOUNDARY_PROTOCOL, ADMINISTRATIVE_CLOSURE_PROTOCOL, ADMINISTRATIVE_CLOSURE_MAX_REVISION,
  parseAdministrativeClosureQuery, parseAdministrativeClosureHttpQuery, administrativeClosureQueryString,
  parseAdministrativeClosureCommand, parseAdministrativeClosureBody, parseAdministrativeClosureJson,
  parseAdministrativeClosureCaseScope, parseAdministrativeClosureFrame, parseAdministrativeClosureContext,
  parseAdministrativeClosureBoundary, parseAdministrativeClosureEntry, parseAdministrativeClosureResult,
  parseAdministrativeClosureResponse, administrativeClosureSameCase, administrativeClosureCommandFingerprint,
  administrativeClosureCommandText, administrativeClosureReceiptMatches,
  type AdministrativeClosureCommand, type AdministrativeClosureFrame, type AdministrativeClosureContext,
  type AdministrativeClosureEntry, type AdministrativeClosureSummary, type AdministrativeClosureBoundary,
  type AdministrativeClosureQuery, type AdministrativeClosureResult, type AdministrativeClosureData,
  type AdministrativeClosureReceipt, type AdministrativeClosureDetail,
} from "./merchantAttendanceAdministrativeClosure";

// Synthetic protocol examples only: none claims a real suspension/DB proof.
const id = (n: number) => `00000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
const siteId = "99990001", actor = id(1), employeeAuth = id(2), at = "2026-10-08T12:00:00.123456Z", startAt = "2026-10-08T08:00:00.000001Z", endAt = "2026-10-08T11:00:00.000001Z";
const fingerprint = "a".repeat(64);
function frame(): AdministrativeClosureFrame { return { workerId: id(3), employeeId: id(4), employeeAuthUserId: employeeAuth, employmentPeriodId: id(5), startEventId: id(6), startSequence: 1, startAt, suspensionId: id(7), generation: 1, tailEventId: id(6), tailSequence: 1, tailAction: "clock_in", tailOccurredAt: startAt, timeZone: "Europe/Madrid" }; }
function context(): AdministrativeClosureContext { return { workerVersion: 2, employeeVersion: 1, settingsVersion: 3, employmentRevision: 1, sourceFingerprint: fingerprint }; }
function query(): AdministrativeClosureQuery { return { siteId, access: "owner", mode: "candidate", workerId: id(3) }; }
function command(action: "record_unknown" | "close" = "close", revision = 1): Extract<AdministrativeClosureCommand, { action: "record_unknown" | "close" }> { const b = { operationId: id(100 + revision), startEventId: id(6), expectedRevision: revision - 1, reason: "核查说明", workerId: id(3), expectedSourceFingerprint: fingerprint }; return action === "close" ? { ...b, action, verifiedEndAt: endAt } : { ...b, action, verifiedEndAt: null }; }
async function entry(action: "record_unknown" | "close" = "close", revision = 1, f = frame(), c = context()): Promise<AdministrativeClosureEntry> {
  const cmd = { ...command(action, revision), expectedSourceFingerprint: c.sourceFingerprint };
  return { operationId: cmd.operationId, startEventId: cmd.startEventId, revision, action, actorId: actor, actorAccess: "owner", reason: cmd.reason, verifiedEndAt: cmd.verifiedEndAt, disputeOperationId: null, frame: f, context: c, recordedAt: at, commandFingerprint: await administrativeClosureCommandFingerprint(siteId, actor, "owner", cmd) };
}
function summary(e: AdministrativeClosureEntry): AdministrativeClosureSummary { return { startEventId: e.startEventId, identity: { workerId: id(3), employeeId: id(4), employeeAuthUserId: employeeAuth }, employmentPeriodId: id(5), state: e.action === "close" ? "closed" : "pending", revision: e.revision, verifiedEndAt: e.verifiedEndAt, closedOperationId: e.action === "close" ? e.operationId : null, hasDispute: false, updatedAt: e.recordedAt }; }
function boundary(e: AdministrativeClosureEntry): AdministrativeClosureBoundary { assert.ok(e.frame && e.context && e.verifiedEndAt); return { ...e.frame, protocol: ADMINISTRATIVE_CLOSURE_BOUNDARY_PROTOCOL, siteId, operationId: e.operationId, revision: e.revision, verifiedEndAt: e.verifiedEndAt, recordedAt: e.recordedAt, sourceFingerprint: e.context.sourceFingerprint }; }
function receipt(e: AdministrativeClosureEntry): AdministrativeClosureReceipt { return { operationId: e.operationId, startEventId: e.startEventId, revision: e.revision, action: e.action, actorId: e.actorId, recordedAt: e.recordedAt, commandFingerprint: e.commandFingerprint }; }
function result(data: AdministrativeClosureData, q = query(), auth = actor): AdministrativeClosureResult { return { protocol: ADMINISTRATIVE_CLOSURE_PROTOCOL, siteId, access: q.access, actorId: auth, readAt: at, data }; }
const noCaps = () => ({ canRecordUnknown: false, canClose: false, canDispute: false, canRespond: false });
function candidate(): AdministrativeClosureDetail { return { summary: null, frame: frame(), context: context(), evidenceOperationId: null, currentEntry: null, closure: null, capabilities: { ...noCaps(), canRecordUnknown: true, canClose: true }, blockers: [] }; }
function detail(e: AdministrativeClosureEntry): AdministrativeClosureDetail { return { summary: summary(e), frame: e.frame, context: e.context, evidenceOperationId: e.operationId, currentEntry: e, closure: e.action === "close" ? boundary(e) : null, capabilities: noCaps(), blockers: [] }; }
const detailQuery = (access: "owner" | "self" = "owner"): AdministrativeClosureQuery => ({ siteId, access, mode: "detail", startEventId: id(6) });

test("administrative closure exact queries/commands and URL round trips reject extras, getters and duplicates", () => {
  const queries: AdministrativeClosureQuery[] = [query(), { siteId, access: "owner", mode: "workers", afterId: null }, { siteId, access: "self", mode: "list", afterId: id(6) }, detailQuery(), { siteId, access: "self", mode: "history", startEventId: id(6), beforeRevision: 26 }, { siteId, access: "owner", mode: "recover", operationId: id(101) }];
  for (const q of queries) { assert.deepEqual(parseAdministrativeClosureQuery(q), q); assert.deepEqual(parseAdministrativeClosureHttpQuery("https://example.invalid/?" + administrativeClosureQueryString(q)), q); assert.throws(() => parseAdministrativeClosureQuery({ ...q, extra: null })); }
  let reads = 0; assert.throws(() => parseAdministrativeClosureQuery({ siteId, get mode() { reads++; return "candidate"; }, access: "owner", workerId: id(3) })); assert.equal(reads, 0);
  for (const tail of ["&mode=candidate", "#", "&evil=1"]) assert.throws(() => parseAdministrativeClosureHttpQuery("https://example.invalid/?" + administrativeClosureQueryString(query()) + tail));
  assert.throws(() => parseAdministrativeClosureQuery({ ...query(), access: "self" }));
  assert.deepEqual(parseAdministrativeClosureBody({ query: query(), command: command() }).command, command());
  assert.throws(() => parseAdministrativeClosureBody({ query: { siteId, access: "owner", mode: "recover", operationId: id(101) }, command: command() }));
  assert.throws(() => parseAdministrativeClosureBody({ query: { ...query(), workerId: id(9) }, command: command() }));
  assert.throws(() => parseAdministrativeClosureCommand({ ...command(), rawEvent: "clock_out" }));
});

test("reasons, UTC6, versions and UTF-8 limits have no silent normalization", () => {
  for (const reason of ["", " x", "x ", "\u0085", "a\n", "\ud800", "😀".repeat(501)]) assert.throws(() => parseAdministrativeClosureCommand({ ...command(), reason }));
  assert.equal(parseAdministrativeClosureCommand({ ...command(), reason: "😀".repeat(500) }).reason.length, 1000);
  for (const verifiedEndAt of ["2026-02-30T10:00:00.000001Z", "2026-10-08T11:00:00.000Z", endAt + "\n", "1999-12-31T23:59:59.999999Z", "2101-01-01T00:00:00.000000Z"]) assert.throws(() => parseAdministrativeClosureCommand({ ...command(), verifiedEndAt }));
  for (const expectedRevision of [-0, -1, 1.5, ADMINISTRATIVE_CLOSURE_MAX_REVISION, Infinity]) assert.throws(() => parseAdministrativeClosureCommand({ ...command(), expectedRevision }));
  assert.throws(() => parseAdministrativeClosureCommand({ ...command("record_unknown"), verifiedEndAt: endAt }));
  assert.throws(() => parseAdministrativeClosureJson('{"a":1,"a":2}', true));
  assert.throws(() => parseAdministrativeClosureJson("中".repeat(3000), true));
});

test("case scope omits mutable pause/tail, while strict frames retain raw start/tail continuity", () => {
  const f = frame(), scope = { workerId: f.workerId, employeeId: f.employeeId, employeeAuthUserId: f.employeeAuthUserId, employmentPeriodId: f.employmentPeriodId, startEventId: f.startEventId, startSequence: f.startSequence, startAt: f.startAt };
  assert.deepEqual(parseAdministrativeClosureCaseScope(scope), scope); assert.throws(() => parseAdministrativeClosureCaseScope(f));
  const later = { ...f, suspensionId: id(30), generation: 3, tailEventId: id(31), tailSequence: 2, tailAction: "break_start" as const, tailOccurredAt: "2026-10-08T09:00:00.000001Z" };
  assert.equal(administrativeClosureSameCase(parseAdministrativeClosureFrame(f), parseAdministrativeClosureFrame(later)), true);
  assert.equal(administrativeClosureSameCase(f, { ...later, employmentPeriodId: id(99) }), false);
  for (const change of [{ tailAction: "clock_out" }, { tailSequence: 2003, tailEventId: id(30), tailAction: "break_end" }, { tailSequence: 2 }, { tailEventId: id(90) }, { tailOccurredAt: "2026-10-08T07:59:59.999999Z" }]) assert.throws(() => parseAdministrativeClosureFrame({ ...f, ...change }));
  assert.throws(() => parseAdministrativeClosureContext({ ...context(), settingsVersion: 0 }));
  assert.equal(parseAdministrativeClosureContext({ ...context(), employmentRevision: 0 }).employmentRevision, 0);
  assert.throws(() => parseAdministrativeClosureFrame({ ...frame(), generation: 0 }));
});

test("versioned command tuple covers site, real actor, access and every action-specific field", async () => {
  const c = command(), expected = `["attendance-administrative-closure-command-v1", "${siteId}", "${actor}", "owner", ["${c.operationId}", "${c.startEventId}", "close", 0, "核查说明", "${id(3)}", "${fingerprint}", "${endAt}"]]`;
  assert.equal(administrativeClosureCommandText(siteId, actor, "owner", c), expected);
  assert.equal(await administrativeClosureCommandFingerprint(siteId, actor, "owner", c), createHash("sha256").update(expected, "utf8").digest("hex"));
  assert.notEqual(await administrativeClosureCommandFingerprint(siteId, id(55), "owner", c), await administrativeClosureCommandFingerprint(siteId, actor, "owner", c));
  assert.notEqual(await administrativeClosureCommandFingerprint("99990002", actor, "owner", c), await administrativeClosureCommandFingerprint(siteId, actor, "owner", c));
  const dispute: AdministrativeClosureCommand = { operationId: id(110), startEventId: id(6), expectedRevision: 1, action: "self_dispute", reason: "本人有异议", expectedClosedOperationId: null };
  assert.notEqual(await administrativeClosureCommandFingerprint(siteId, employeeAuth, "self", dispute), await administrativeClosureCommandFingerprint(siteId, employeeAuth, "self", { ...dispute, expectedClosedOperationId: id(101) }));
  await assert.rejects(administrativeClosureCommandFingerprint(siteId, actor, "owner", dispute));
});

test("fresh candidate grants no boundary; blocked absence is explicit rather than invented source", async () => {
  const c = candidate(), r = await parseAdministrativeClosureResult(result({ kind: "candidate", detail: c }), query(), actor); assert.equal(r.data.kind, "candidate"); assert.equal(c.closure, null);
  const blocked = { ...c, frame: null, context: null, capabilities: noCaps(), blockers: ["session_not_open" as const] }; await parseAdministrativeClosureResult(result({ kind: "candidate", detail: blocked }), query(), actor);
  for (const changed of [{ ...c, evidenceOperationId: id(9) }, { ...c, context: null }, { ...c, blockers: ["identity_changed" as const] }, { ...blocked, blockers: [] }, { ...c, frame: { ...frame(), workerId: id(999) } }]) await assert.rejects(parseAdministrativeClosureResult(result({ kind: "candidate", detail: changed }), query(), actor));
});

test("same case unknown→resume/tail advance/re-pause may have fresh evidence without altering saved unknown", async () => {
  const old = await entry("record_unknown"), frozenBefore = JSON.stringify(old), later = { ...frame(), suspensionId: id(30), generation: 3, tailEventId: id(31), tailSequence: 2, tailAction: "break_start" as const, tailOccurredAt: "2026-10-08T09:00:00.000001Z", timeZone: "UTC" };
  const candidateDetail = { ...candidate(), summary: summary(old), currentEntry: old, frame: later, context: { ...context(), workerVersion: 4, sourceFingerprint: "b".repeat(64) } };
  await parseAdministrativeClosureResult(result({ kind: "candidate", detail: candidateDetail }), query(), actor);
  const closed = await entry("close", 2, later, candidateDetail.context), saved = detail(closed); await parseAdministrativeClosureResult(result({ kind: "detail", detail: saved }, detailQuery()), detailQuery(), actor);
  await parseAdministrativeClosureResult(result({ kind: "detail", detail: detail(old) }, detailQuery()), detailQuery(), actor);
  assert.equal(JSON.stringify(old), frozenBefore); assert.equal(old.frame!.generation, 1); assert.equal(closed.frame!.generation, 3);
  await assert.rejects(parseAdministrativeClosureResult(result({ kind: "candidate", detail: { ...candidateDetail, frame: { ...later, employeeAuthUserId: id(999) } } }), query(), actor));
  await assert.rejects(parseAdministrativeClosureResult(result({ kind: "detail", detail: { ...detail(old), capabilities: { ...noCaps(), canClose: true } } }, detailQuery()), detailQuery(), actor));
});

test("saved close is exact immutable evidence, not raw clock_out or fresh permission", async () => {
  const e = await entry(), b = boundary(e); assert.deepEqual(parseAdministrativeClosureBoundary(b), b);
  for (const change of [{ verifiedEndAt: "2026-10-08T07:00:00.000000Z" }, { verifiedEndAt: "2026-10-08T13:00:00.000000Z" }, { tailAction: "clock_out" }, { extra: null }]) assert.throws(() => parseAdministrativeClosureBoundary({ ...b, ...change }));
  const d = detail(e); await parseAdministrativeClosureResult(result({ kind: "detail", detail: d }, detailQuery()), detailQuery(), actor);
  for (const changed of [{ ...d, evidenceOperationId: id(9) }, { ...d, closure: null }, { ...d, closure: { ...b, siteId: "99990002" } }, { ...d, closure: { ...b, sourceFingerprint: "b".repeat(64) } }, { ...d, closure: { ...b, verifiedEndAt: "2026-10-08T11:00:00.000002Z" }, summary: { ...d.summary!, verifiedEndAt: "2026-10-08T11:00:00.000002Z" } }]) await assert.rejects(parseAdministrativeClosureResult(result({ kind: "detail", detail: changed }, detailQuery()), detailQuery(), actor));
});

test("only original self sees detail/list or self-dispute; owner response cannot erase dispute", async () => {
  const e = await entry(), q = detailQuery("self"), d = { ...detail(e), capabilities: { ...noCaps(), canDispute: true } };
  await parseAdministrativeClosureResult(result({ kind: "detail", detail: d }, q, employeeAuth), q, employeeAuth);
  await assert.rejects(parseAdministrativeClosureResult(result({ kind: "detail", detail: d }, q, id(99)), q, id(99)));
  await assert.rejects(parseAdministrativeClosureResult(result({ kind: "detail", detail: d }, detailQuery()), detailQuery(), actor));
  const cmd: AdministrativeClosureCommand = { operationId: id(102), startEventId: id(6), expectedRevision: 1, action: "self_dispute", reason: "核查时刻有异议", expectedClosedOperationId: e.operationId };
  const disputed: AdministrativeClosureEntry = { operationId: cmd.operationId, startEventId: cmd.startEventId, revision: 2, action: "self_dispute", actorId: employeeAuth, actorAccess: "self", reason: cmd.reason, verifiedEndAt: null, disputeOperationId: null, frame: null, context: null, recordedAt: at, commandFingerprint: await administrativeClosureCommandFingerprint(siteId, employeeAuth, "self", cmd) };
  const withDispute = { ...d, summary: { ...d.summary!, revision: 2, hasDispute: true }, currentEntry: disputed };
  await parseAdministrativeClosureResult(result({ kind: "detail", detail: withDispute }, q, employeeAuth), q, employeeAuth);
  for (const changed of [{ ...withDispute, summary: { ...withDispute.summary, hasDispute: false } }, { ...withDispute, currentEntry: { ...disputed, actorId: id(98) } }, { ...withDispute, evidenceOperationId: disputed.operationId }]) await assert.rejects(parseAdministrativeClosureResult(result({ kind: "detail", detail: changed }, q, employeeAuth), q, employeeAuth));
  const responseCommand: AdministrativeClosureCommand = { operationId: id(103), startEventId: id(6), expectedRevision: 2, action: "owner_respond", reason: "保留异议说明", disputeOperationId: disputed.operationId };
  const responseEntry: AdministrativeClosureEntry = { ...disputed, operationId: responseCommand.operationId, revision: 3, action: "owner_respond", actorId: actor, actorAccess: "owner", reason: responseCommand.reason, disputeOperationId: disputed.operationId, commandFingerprint: await administrativeClosureCommandFingerprint(siteId, actor, "owner", responseCommand) };
  const responded = { ...withDispute, summary: { ...withDispute.summary, revision: 3 }, currentEntry: responseEntry, capabilities: { ...noCaps(), canRespond: true } };
  await parseAdministrativeClosureResult(result({ kind: "detail", detail: responded }, detailQuery()), detailQuery(), actor);
  assert.throws(() => parseAdministrativeClosureEntry({ ...disputed, frame: frame(), context: context() }));
});

test("POST and GET recovery accept only minimal original-actor receipts bound to full command", async () => {
  const e = await entry(), c = command(), r = receipt(e), q: AdministrativeClosureQuery = { siteId, access: "owner", mode: "recover", operationId: e.operationId };
  await parseAdministrativeClosureResult(result({ kind: "receipt", receipt: r }), query(), actor, c);
  await parseAdministrativeClosureResult(result({ kind: "receipt", receipt: r }, q), q, actor, c);
  const missing = await parseAdministrativeClosureResult(result({ kind: "receipt", receipt: null }, q), q, actor, c); assert.deepEqual(missing.data, { kind: "receipt", receipt: null });
  assert.equal(administrativeClosureReceiptMatches(r, c, actor, await administrativeClosureCommandFingerprint(siteId, actor, "owner", c)), true);
  assert.equal(administrativeClosureReceiptMatches(r, c, id(999), r.commandFingerprint), false);
  for (const changed of [{ ...r, revision: 2 }, { ...r, actorId: employeeAuth }, { ...r, startEventId: id(77) }, { ...r, commandFingerprint: "b".repeat(64) }, { ...r, recordedAt: "2026-10-08T12:00:00.123457Z" }, { ...r, reason: "不应披露" }]) await assert.rejects(parseAdministrativeClosureResult(result({ kind: "receipt", receipt: changed }, q), q, actor, c));
  await assert.rejects(parseAdministrativeClosureResult(result({ kind: "receipt", receipt: null }), query(), actor, c));
  await assert.rejects(parseAdministrativeClosureResult(result({ kind: "receipt", receipt: r }, q), q, actor, { ...c, reason: "不同原命令" }));
});

test("25+1 history preserves contiguous revisions and per-entry saved pause versions", async () => {
  const items = await Promise.all(Array.from({ length: 26 }, (_, i) => entry("record_unknown", 26 - i))), q: AdministrativeClosureQuery = { siteId, access: "owner", mode: "history", startEventId: id(6), beforeRevision: null };
  const first: AdministrativeClosureData = { kind: "history", startEventId: id(6), items: items.slice(0, 25), nextBeforeRevision: 2 };
  await parseAdministrativeClosureResult(result(first, q), q, actor);
  const next: AdministrativeClosureQuery = { ...q, beforeRevision: 2 }; await parseAdministrativeClosureResult(result({ kind: "history", startEventId: id(6), items: [items[25]], nextBeforeRevision: null }, next), next, actor);
  for (const changed of [{ ...first, items }, { ...first, nextBeforeRevision: null }, { ...first, items: [...first.items.slice(0, 24), first.items[23]] }, { ...first, items: first.items.slice(1) }]) await assert.rejects(parseAdministrativeClosureResult(result(changed, q), q, actor));
  await assert.rejects(parseAdministrativeClosureResult(result({ kind: "history", startEventId: id(6), items: [], nextBeforeRevision: null }, next), next, actor));
  const badHash = { ...items[25], commandFingerprint: "b".repeat(64) }; await assert.rejects(parseAdministrativeClosureResult(result({ kind: "history", startEventId: id(6), items: [badHash], nextBeforeRevision: null }, next), next, actor));
});

test("workers and case discovery stay bounded, sorted, cursor-bound and self-scoped", async () => {
  const q: AdministrativeClosureQuery = { siteId, access: "owner", mode: "workers", afterId: null };
  const items = Array.from({ length: 25 }, (_, i) => ({ workerId: id(300 + i), employeeId: null, employeeAuthUserId: null, workerNo: `W${i}`, displayName: "合成人员", paused: true }));
  await parseAdministrativeClosureResult(result({ kind: "workers", items, nextAfterId: items[24].workerId }, q), q, actor);
  await assert.rejects(parseAdministrativeClosureResult(result({ kind: "workers", items: items.slice(0, 1), nextAfterId: items[0].workerId }, q), q, actor));
  await assert.rejects(parseAdministrativeClosureResult(result({ kind: "workers", items: items.toReversed(), nextAfterId: null }, q), q, actor));
  const e = await entry(), lq: AdministrativeClosureQuery = { siteId, access: "self", mode: "list", afterId: null };
  await parseAdministrativeClosureResult(result({ kind: "list", items: [summary(e)], nextAfterId: null }, lq, employeeAuth), lq, employeeAuth);
  await assert.rejects(parseAdministrativeClosureResult(result({ kind: "list", items: [summary(e)], nextAfterId: null }, lq, id(999)), lq, id(999)));
});

test("response envelopes are exact and parser owns the full tree before the first async digest", async t => {
  const e = await entry("record_unknown"), q = detailQuery(), raw = structuredClone(result({ kind: "detail", detail: detail(e) }, q)), before = structuredClone(raw), rawQuery = { ...q }, originalDigest = crypto.subtle.digest.bind(crypto.subtle); let calls = 0;
  t.mock.method(crypto.subtle, "digest", async (...args: Parameters<typeof crypto.subtle.digest>) => { if (calls++ === 0) { await Promise.resolve(); if (raw.data.kind === "detail") { Object.assign(raw.data.detail.frame!, { suspensionId: id(999) }); Object.assign(raw.data.detail.capabilities, { canClose: true }); } Object.assign(raw, { actorId: id(999) }); Object.assign(rawQuery, { startEventId: id(999) }); } return originalDigest(...args); });
  assert.deepEqual(await parseAdministrativeClosureResult(raw, rawQuery, actor), before); assert.equal(Object.isFrozen(raw), false); assert.equal(Object.isFrozen(raw.data), false);
  assert.equal((await parseAdministrativeClosureResponse({ ok: true, data: before }, q, actor)).ok, true);
  assert.equal((await parseAdministrativeClosureResponse({ ok: false, error: { code: "attendance_administrative_closure_changed", message: "请重新核对" } }, q, actor)).ok, false);
  await assert.rejects(parseAdministrativeClosureResponse({ ok: false, error: { code: "arbitrary_commit_failed", message: "失败" } }, q, actor));
  let read = false; await assert.rejects(parseAdministrativeClosureResult({ ...before, get data() { read = true; return before.data; } }, q, actor)); assert.equal(read, false);
  const arrayWithHole = { ...before, data: { kind: "history", startEventId: id(6), items: new Array(1), nextBeforeRevision: null } }; await assert.rejects(parseAdministrativeClosureResult(arrayWithHole, { siteId, access: "owner", mode: "history", startEventId: id(6), beforeRevision: null }, actor));
});
