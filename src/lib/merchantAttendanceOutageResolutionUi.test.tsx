import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup as render } from "react-dom/server";
import Panel, { OutageResolutionEvidenceView, OutageResolutionLinksView, OutageResolutionReviewView, confirmOutageResolutionAction,
  emptyOutageResolutionSource, outageResolutionSources, outageResolutionReasonValid, outageResolutionLinkDraft, outageResolutionReviewDraft, outageResolutionPorts,
  type OutageResolutionSourceDraft } from "../components/enterprise/MerchantAttendanceOutageResolutionPanel";
import { parseOutageLinksResult } from "./merchantAttendanceOutageLinks";
import { parseOutageReviewResult } from "./merchantAttendanceOutageReview";
import type { OutageClientState } from "./merchantAttendanceOutageClient";
import type { OutageLinkEvidence, OutageLinkReference, OutageLinksQuery, OutageLinksResult } from "./merchantAttendanceOutageLinksContract";
import type { OutageReviewAction, OutageReviewEntry, OutageReviewProposal, OutageReviewQuery, OutageReviewResult } from "./merchantAttendanceOutageReviewContract";
import type { AttendanceApiFetch } from "./merchantAttendanceSelfClient";

// Synthetic UI models, passed through actual protocol parsers before use.
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const siteId = "99990001", actorId = id(1), employee = id(2), declarationId = id(3), fp = "a".repeat(64), at = "2026-10-07T12:00:00.000000Z";
const interval = { startAt: "2026-10-07T08:00:00.000000Z", endAt: "2026-10-07T10:00:00.000000Z", timeZone: "Europe/Madrid", startOffsetMinutes: 120, endOffsetMinutes: 120 };
const ref: OutageLinkReference = { kind: "session", startEventId: id(4), lastEventId: id(5), lastSequence: 2, effectOperationId: null, effectRevision: null };
const missing: OutageLinkReference = { kind: "missing", requestId: id(6), rootRequestId: id(6), approvalOperationId: id(7) };
const row = (): OutageResolutionSourceDraft => ({ ...emptyOutageResolutionSource(), startEventId: ref.kind === "session" ? ref.startEventId : "", lastEventId: id(5), lastSequence: "2" });
const missingRow = (): OutageResolutionSourceDraft => ({ ...emptyOutageResolutionSource(), kind: "missing", requestId: id(6), rootRequestId: id(6), approvalOperationId: id(7) });
function evidence(): OutageLinkEvidence { return { protocol: "outage-link-evidence-v1", siteId, declarationId, workerId: id(8), employeeId: id(9), employeeAuthUserId: employee, workerVersion: 2, employeeVersion: 3, generation: 1, declaredInterval: interval,
  items: [{ reference: ref, locationId: id(10), timeZone: "Europe/Madrid", original: { startAt: interval.startAt, endAt: interval.endAt }, selected: { startAt: interval.startAt, endAt: interval.endAt }, evidenceFingerprint: fp, pending: false, open: false }] }; }
function links(preview = true): { query: OutageLinksQuery; result: OutageLinksResult } {
  const query: OutageLinksQuery = preview ? { siteId, access: "owner", declarationId, mode: "preview", sources: [ref] } : { siteId, access: "owner", declarationId, mode: "detail" };
  const ev = evidence(), current = { operationId: id(11), revision: 1, action: "apply" as const, actorId, reason: "保存的准备关联", sources: [ref], evidence: ev, fingerprint: fp, recordedAt: at };
  const result = parseOutageLinksResult({ protocol: "attendance-outage-links-v1", siteId, declarationId, access: "owner", mode: query.mode, actorId, readAt: at, canWrite: true, revision: 1, current,
    preview: { eligible: true, evidence: ev, fingerprint: fp, blockers: [], observations: [{ reference: ref, current: ev.items[0], available: true, changed: false, open: false, pending: false }] }, history: [], historyTruncated: false, receipt: null }, query, actorId);
  return { query, result };
}
const linkState = (preview = true): OutageClientState<"links"> => ({ ...links(preview), prepared: null, phase: "ready", pending: null, canWrite: true, canEndRejectedAttempt: false, message: "已核验" });
function proposal(): OutageReviewProposal { return { operationId: id(12), action: "propose", actorId, revision: 1, resultVersion: 1, resultFingerprint: fp, reason: "原核对结果理由", recordedAt: at,
  evidence: { protocol: "outage-review-evidence-v1", siteId, declarationId, linkOperationId: id(11), linkRevision: 1, linkFingerprint: fp, linkEvidence: evidence(), original: { status: "not_required", operationId: null, channel: null, eventId: null } } }; }
const lean = (p: OutageReviewProposal): OutageReviewEntry => { const { evidence: _e, ...entry } = p; void _e; return entry; };
function reviews(action: OutageReviewAction = "propose", access: "owner" | "self" = "owner"): { query: OutageReviewQuery; result: OutageReviewResult } {
  const query: OutageReviewQuery = { siteId, access, declarationId, mode: "detail" }, p = proposal();
  const response: OutageReviewEntry | null = action === "propose" ? null : { ...lean(p), action: action === "dispute" ? "dispute" : "confirm", actorId: employee, operationId: id(13), revision: 2, reason: "本人精确核对该结果" };
  const current = action === "propose" ? lean(p) : action === "confirm" || action === "dispute" ? response! : { ...lean(p), action, revision: 3, operationId: id(14) };
  const result = parseOutageReviewResult({ protocol: "attendance-outage-review-v1", siteId, declarationId, access, mode: "detail", actorId: access === "owner" ? actorId : employee, readAt: at, canWrite: true,
    revision: current.revision, resultVersion: 1, current, proposal: p, response, status: { basisFingerprint: fp, linkOperationId: id(11), linkRevision: 1, linkFingerprint: fp,
      blockers: action === "propose" ? ["unconfirmed"] : action === "dispute" ? ["disputed"] : action === "reopen" ? ["reopened"] : [],
      canPropose: access === "owner" && action !== "resolve", canConfirm: access === "self" && ["propose", "dispute", "reopen"].includes(action), canResolve: access === "owner" && action === "confirm", resolved: action === "resolve" }, history: [], historyTruncated: false, receipt: null }, query, access === "owner" ? actorId : employee);
  return { query, result };
}
const reviewState = (action: OutageReviewAction = "propose", access: "owner" | "self" = "owner"): OutageClientState<"reviews"> => ({ ...reviews(action, access), prepared: null, phase: "ready", pending: null, canWrite: true, canEndRejectedAttempt: false, message: "已核验" });
const buttons = (html: string) => [...html.matchAll(/<button\b[^>]*>(.*?)<\/button>/g)].map(m => m[1]);

test("initial owner UI exposes explicit split-field sources, never auto fetches or creates JSON editor", () => {
  let calls = 0; const apiFetch: AttendanceApiFetch = async () => { calls++; throw Error("no automatic request"); };
  const html = render(<Panel siteId={siteId} actorId={actorId} access="owner" declarationId={declarationId} enabled apiFetch={apiFetch}/>);
  for (const text of ["读取当前来源关联", "读取当前核对结果", "预览这些明确来源", "保存本次整组来源关联", "撤销当前来源关联", "第1项开始事件编号", "第1项末尾事件编号", "第1项末尾序号", "核定操作编号", "核定版本"]) assert(html.includes(text));
  assert(!html.includes("JSON")); assert(!html.includes("本人确认当前结果")); assert(!html.includes("提出新核对结果")); assert.equal(calls, 0);
});
test("self has only explicit reads initially and never sees owner source controls", () => {
  const apiFetch: AttendanceApiFetch = async () => { throw Error("no request"); };
  const html = render(<Panel siteId={siteId} actorId={employee} access="self" declarationId={declarationId} enabled apiFetch={apiFetch}/>);
  assert.deepEqual(buttons(html), ["读取当前来源关联", "读取关联历史", "读取当前核对结果", "读取核对历史"]);
  for (const text of ["明确来源关联表单", "增加来源", "预览这些明确来源", "保存本次整组来源关联", "负责人核对理由"]) assert(!html.includes(text));
});
test("flag-off keeps explicit reads and recovery explanation but disables source editing", () => {
  const html = render(<Panel siteId={siteId} actorId={actorId} access="owner" declarationId={declarationId} enabled={false} apiFetch={async () => { throw Error("no request"); }}/>);
  assert(html.includes("新关联和核对操作已关闭")); assert(html.includes("仍可明确读取保存资料、核对原编号"));
  assert(/<fieldset disabled=""/.test(html)); assert(buttons(html).includes("读取当前核对结果"));
});
test("split-field sources preserve session/missing order and exact null effect pairing", () => {
  assert.deepEqual(outageResolutionSources([row(), missingRow()]), [ref, missing]);
  assert.deepEqual(outageResolutionSources([missingRow(), row()]), [missing, ref]);
  assert.deepEqual(outageResolutionSources([{ ...row(), effectOperationId: id(20), effectRevision: "3" }]), [{ ...ref, effectOperationId: id(20), effectRevision: 3 }]);
  for (const patch of [{ effectOperationId: id(20) }, { effectRevision: "3" }, { startEventId: " " + id(4) }, { lastSequence: "02" }, { lastSequence: "2.0" }, { lastSequence: "-0" }, { lastSequence: "9007199254740991" }]) assert.equal(outageResolutionSources([{ ...row(), ...patch }]), null);
});
test("source form rejects duplicate roots, empty/over-cap and unsafe trees", () => {
  assert.equal(outageResolutionSources([]), null); assert.equal(outageResolutionSources([row(), row()]), null);
  assert.equal(outageResolutionSources([missingRow(), { ...missingRow(), requestId: id(22), approvalOperationId: id(23) }]), null);
  assert.equal(outageResolutionSources(Array.from({ length: 11 }, () => row())), null);
  let invoked = false; assert.equal(outageResolutionSources([{ ...row(), get lastSequence() { invoked = true; return "2"; } }]), null); assert.equal(invoked, false);
  const ten = Array.from({ length: 10 }, (_, index) => ({ ...row(), startEventId: id(30 + index), lastEventId: id(50 + index) }));
  assert.equal(outageResolutionSources(ten)?.length, 10);
});
test("reasons use the same strict nonblank Unicode/control contract", () => {
  assert(outageResolutionReasonValid("本人核验 café 😀")); assert(outageResolutionReasonValid("😀".repeat(1000)));
  for (const value of ["", " ", " 后空", "前空 ", "a\nb", "a\tb", "x\u0085", "\ud800", "😀".repeat(1001)]) assert.equal(outageResolutionReasonValid(value), false);
});
test("apply pins exact displayed preview refs, revision and fingerprint, revoke uses saved fingerprint", () => {
  const state = linkState(), draft = outageResolutionLinkDraft(state, "apply", "明确准备", [ref]);
  assert.deepEqual(draft, { action: "apply", expectedRevision: 1, expectedFingerprint: fp, sources: [ref], reason: "明确准备" });
  assert.equal(outageResolutionLinkDraft(state, "apply", "明确准备", [missing]), null);
  assert.equal(outageResolutionLinkDraft(linkState(false), "apply", "明确准备", [ref]), null);
  const changed = structuredClone(state); changed.result!.preview!.fingerprint = "b".repeat(64);
  assert.equal(outageResolutionLinkDraft(changed, "revoke", "撤销旧关联", null)?.expectedFingerprint, fp);
});
test("link open/pending may be preparation but unavailable or stale read never grants a write", () => {
  const state = structuredClone(linkState()); state.result!.preview!.blockers = ["source_open", "pending_source"];
  assert(outageResolutionLinkDraft(state, "apply", "保存待办准备", [ref]));
  for (const patch of [{ phase: "loading" as const }, { phase: "unconfirmed" as const }, { canWrite: false }]) assert.equal(outageResolutionLinkDraft({ ...state, ...patch }, "apply", "保存准备", [ref]), null);
  state.result!.preview!.eligible = false; assert.equal(outageResolutionLinkDraft(state, "apply", "保存准备", [ref]), null);
  const capped = structuredClone(linkState()); capped.result!.revision = 99;
  assert.equal(outageResolutionLinkDraft(capped, "apply", "保存准备", [ref]), null); assert(outageResolutionLinkDraft(capped, "revoke", "撤销准备", null));
  capped.result!.revision = 100; assert.equal(outageResolutionLinkDraft(capped, "revoke", "撤销准备", null), null);
});
test("review commands bind the exact result and ledger versions, including direct self dispute", () => {
  assert.deepEqual(outageResolutionReviewDraft(reviewState(), "propose", "提出新结果"), { action: "propose", expectedRevision: 1, expectedResultVersion: 1, expectedFingerprint: fp, reason: "提出新结果" });
  assert(outageResolutionReviewDraft(reviewState("confirm"), "resolve", "本人已确认，核对结案"));
  assert(outageResolutionReviewDraft(reviewState("resolve"), "reopen", "明确重开"));
  assert(outageResolutionReviewDraft(reviewState("resolve", "self"), "dispute", "本人有异议"));
  for (const current of ["propose", "dispute", "reopen"] as const) assert(outageResolutionReviewDraft(reviewState(current, "self"), "confirm", "本人确认此版本"));
});
test("review role separation, reopened response, unknown and write-flag gates are never inferred away", () => {
  assert.equal(outageResolutionReviewDraft(reviewState(), "confirm", "不能代确认"), null);
  assert.equal(outageResolutionReviewDraft(reviewState("propose", "self"), "propose", "不能代提出"), null);
  assert.equal(outageResolutionReviewDraft(reviewState("reopen"), "resolve", "旧确认不够"), null);
  assert.equal(outageResolutionReviewDraft(reviewState("resolve"), "propose", "须先重开"), null);
  const unknown = structuredClone(reviewState("propose", "self")); unknown.result!.status!.canConfirm = false; unknown.result!.status!.blockers.push("original_unknown");
  assert.equal(outageResolutionReviewDraft(unknown, "confirm", "不能猜原号失败"), null); assert(outageResolutionReviewDraft(unknown, "dispute", "本人异议"));
  assert.equal(outageResolutionReviewDraft({ ...unknown, canWrite: false }, "dispute", "关闭写门不可绕过"), null);
  assert.equal(outageResolutionReviewDraft({ ...reviewState(), phase: "saving" }, "propose", "不能重复提交"), null);
});
test("reserved ledger tail remains usable only for non-closing safety actions", () => {
  const state = structuredClone(reviewState("resolve")); state.result!.revision = 999; state.result!.resultVersion = 998;
  assert(outageResolutionReviewDraft(state, "reopen", "尾部安全重开"));
  state.result!.revision = 1000; assert.equal(outageResolutionReviewDraft(state, "reopen", "已到上限"), null);
  const proposed = structuredClone(reviewState()); proposed.result!.revision = 998; assert.equal(outageResolutionReviewDraft(proposed, "propose", "不能占安全尾部"), null);
  proposed.result!.revision = 997; proposed.result!.resultVersion = 998; assert.equal(outageResolutionReviewDraft(proposed, "propose", "不能溢出结果版本"), null);
});
test("confirmation tests current state before and after dialog and never submits after lifecycle invalidation", () => {
  let submitted = 0, live = true;
  assert(confirmOutageResolutionAction(() => true, () => live, () => submitted++)); assert.equal(submitted, 1);
  assert.equal(confirmOutageResolutionAction(() => { live = false; return true; }, () => live, () => submitted++), false); assert.equal(submitted, 1);
  let prompted = false; assert.equal(confirmOutageResolutionAction(() => { prompted = true; return true; }, () => false, () => submitted++), false); assert.equal(prompted, false);
  assert.equal(confirmOutageResolutionAction(() => false, () => true, () => submitted++), false); assert.equal(submitted, 1);
});
test("source view separates immutable saved snapshot from changed or unavailable current evidence", () => {
  const model = structuredClone(links(false)); model.result.preview!.eligible = false; model.result.preview!.blockers = ["source_changed"];
  model.result.preview!.observations[0].changed = true;
  model.result.preview!.observations[0].current!.selected.endAt = "2026-10-07T09:00:00.000000Z";
  model.result.preview!.observations[0].current!.reference = { ...ref, effectOperationId: id(20), effectRevision: 1 };
  model.result.preview!.evidence!.items = model.result.preview!.observations.map(o => o.current!);
  model.result.preview!.fingerprint = "b".repeat(64);
  const result = parseOutageLinksResult(model.result, model.query, actorId), html = render(<OutageResolutionLinksView result={result}/>);
  for (const text of ["当时保存的来源快照", "本次服务端重新核验", "当前来源已不同", interval.endAt, "2026-10-07T09:00:00.000000Z"]) assert(html.includes(text));
  const unavailable = structuredClone(links(false)); unavailable.result.preview = { evidence: null, fingerprint: null, eligible: false, blockers: ["source_unavailable"], observations: [{ reference: ref, current: null, available: false, changed: false, open: false, pending: false }] };
  assert(render(<OutageResolutionLinksView result={parseOutageLinksResult(unavailable.result, unavailable.query, actorId)}/>).includes("当前不可完整核验，不推断来源不存在"));
});
test("unknown original is visible as unresolved without fabricated failure or owner confirmation", () => {
  const model = structuredClone(reviews()); model.result.proposal!.evidence.original = { status: "unresolved", operationId: id(55), eventId: null, channel: "web" };
  model.result.status!.blockers.push("original_unknown");
  const html = render(<OutageResolutionReviewView result={parseOutageReviewResult(model.result, model.query, actorId)}/>);
  assert(html.includes("原操作编号仍未核实，不代表失败或可重复补录")); assert(html.includes(id(55))); assert(html.includes("等待本人确认这个结果版本"));
  assert(!html.includes("原操作已失败")); assert(!html.includes("负责人已代本人确认"));
});
test("old resolve and true employee response remain visible when current source invalidates closure", () => {
  const model = structuredClone(reviews("resolve")); model.result.status!.basisFingerprint = "b".repeat(64); model.result.status!.blockers = ["result_changed", "source_changed"]; model.result.status!.resolved = false;
  const result = parseOutageReviewResult(model.result, model.query, actorId), html = render(<OutageResolutionReviewView result={result}/>);
  for (const text of ["原结案仍保留，但当前依据已不满足结案", "本人精确核对该结果", "原核对结果理由", "保存的核对结果", employee]) assert(html.includes(text));
  assert(!html.includes("本次核验：该声明当前已结案"));
  assert(render(<OutageResolutionReviewView result={reviews("resolve").result}/>).includes("本次核验：该声明当前已结案"));
});
test("saved evidence reports exact source spans and generation without deriving additional hours", () => {
  const e = evidence(), html = render(<OutageResolutionEvidenceView evidence={e}/>);
  for (const text of ["原始 UTC", "当前选定 UTC", "声明影响 UTC", "首尾偏移分钟 120 / 120", "人员版本 2", "员工版本 3", "暂停代际 1", e.employeeAuthUserId]) assert(html.includes(text));
  assert(!/工作时长|工资合计|自动补/.test(html));
});
test("receipt displays original proof only and instructs a fresh explicit current read", () => {
  const model = links(false), entry = model.result.current!, query: OutageLinksQuery = { ...model.query, mode: "recover", operationId: entry.operationId };
  const result = parseOutageLinksResult({ ...model.result, mode: "recover", canWrite: false, current: null, preview: null, receipt: { operationId: entry.operationId, commandFingerprint: fp, entry } }, query, actorId);
  const html = render(<OutageResolutionLinksView result={result}/>);
  assert(html.includes("来源关联原号回执")); assert(html.includes("不证明关联仍为当前版本")); assert(!html.includes("本次服务端重新核验"));
});
test("lifecycle code owns two isolated clients, local initialization, exact pending recovery and parent risk aggregation", () => {
  const source = readFileSync(new URL("../components/enterprise/MerchantAttendanceOutageResolutionPanel.tsx", import.meta.url), "utf8");
  for (const text of ['kind: "links"', 'kind: "reviews"', "outageResolutionPorts(props.apiFetch, () => sessionStorage, props.isCurrent)", "void links.initialize(); void reviews.initialize();", "links.pause(); reviews.pause();", 'window.addEventListener("pagehide", hide)', 'document.addEventListener("visibilitychange", visibility)', "registerLeaveGuard?.(risk)", "dirty.current || links.hasLeaveRisk() || reviews.hasLeaveRisk()", "if (!registerLeaveGuard && risk())", "links.getSnapshot() === left && reviews.getSnapshot() === right", "只核对{name}原编号", "state.canEndRejectedAttempt", "state.pending.query.declarationId !== declarationId"]) assert(source.includes(text), text);
  const lifecycle = source.slice(source.indexOf("const pause ="), source.indexOf("const visible ="));
  assert(!/\.load\(|\.submit\(|\.recover\(/.test(lifecycle));
  assert(!/sessionStorage\.(?:key|clear)|Object\.keys\(sessionStorage|\.retry\(/.test(source));
  assert(!source.includes("state.pending.command.reason")); assert(!source.includes("state.pending.command.sources"));
  assert(source.includes("scope.declarationId !== props.declarationId")); assert(source.includes("scope.apiFetch !== props.apiFetch"));
});

test("live scope gate blocks retained storage handles and late transport before effect cleanup", async () => {
  let live = true, calls = 0, reads = 0, writes = 0, removes = 0, finish!: (response: Response) => void;
  const raw = new Map([["old-pending", "ORIGINAL_BYTES"]]);
  const storage = { getItem: (key: string) => { reads++; return raw.get(key) ?? null; }, setItem: (key: string, value: string) => { writes++; raw.set(key, value); }, removeItem: (key: string) => { removes++; raw.delete(key); } };
  const ports = outageResolutionPorts(async () => { calls++; return new Promise<Response>(resolve => { finish = resolve; }); }, () => storage, () => live);
  const handle = ports.storage(); assert.equal(handle.getItem("old-pending"), "ORIGINAL_BYTES");
  const request = ports.apiFetch("/synthetic", { method: "GET" }); live = false;
  finish(Response.json({ ok: true })); await assert.rejects(request, /identity_changed/);
  assert.throws(() => handle.getItem("old-pending"), /identity_changed/); assert.throws(() => handle.setItem("old-pending", "NEW"), /identity_changed/);
  assert.throws(() => handle.removeItem("old-pending"), /identity_changed/); assert.throws(() => ports.storage(), /identity_changed/);
  await assert.rejects(ports.apiFetch("/synthetic", { method: "POST" }), /identity_changed/);
  assert.equal(calls, 1); assert.equal(reads, 1); assert.equal(writes, 0); assert.equal(removes, 0); assert.equal(raw.get("old-pending"), "ORIGINAL_BYTES");
});
