import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup as render } from "react-dom/server";
import Workspace, { PlanPosthocWorkspaceEditor, PlanPosthocEvaluationView, confirmPlanPosthocAction, planPosthocReasonValid, planPosthocSelection,
  type PlanPosthocWorkspaceClient, type PlanPosthocWorkspaceProps, type PlanPosthocWorkspaceState } from "../components/enterprise/MerchantAttendancePlanPosthocWorkspace";
import type { PlanPosthocResult } from "./merchantAttendancePlanPosthocContract";
import type { PlanPosthocEvaluationFacts, PlanPosthocEvaluationResult } from "./merchantAttendancePlanPosthocEvaluationContract";
import { parsePlanPosthocEvaluation } from "./merchantAttendancePlanPosthocEvaluation";
import { exceptionUiEligibleSource, exceptionUiId as id } from "../../scripts/fixtures/attendance-plan-exception-ui-model";

// Detached presentation values only. Actual production snapshots are supplied
// by the identity-bound controller after strict authorized response parsing.
function result(): PlanPosthocResult {
  const source = exceptionUiEligibleSource(), session = source.source.sessions[0];
  const reference = { kind: "session" as const, startEventId: session.startEventId, lastEventId: session.lastEventId, lastSequence: session.lastSequence, effectOperationId: null, effectRevision: null };
  const candidate = { reference, original: session.original, selected: session.selected, locationId: source.slot.locationId, timeZone: source.slot.timeZone, available: true, blockers: [], claim: null };
  const current = { operationId: id(990), revision: 1, action: "apply" as const, actorId: source.actorId, employeeId: source.worker.employeeId!, employeeAuthUserId: source.worker.employeeAuthUserId!,
    reason: "已核验保存的合成理由", sources: [reference], sourceFingerprint: "a".repeat(64), recordedAt: source.readAt };
  return { protocol: "plan-posthoc-adoption-v1", siteId: source.siteId, actorId: source.actorId, worker: source.worker, slot: source.slot, revision: 1,
    current, history: [current], historyTruncated: false, receipt: null, readAt: source.readAt,
    preview: { fingerprint: "b".repeat(64), eligible: true, blockers: [], candidates: [candidate], approval: null,
      source: { protocol: "posthoc-adoption-preview-v1", basis: source.source, caseId: id(900), caseRevision: 1, revision: 1,
        currentOperationId: current.operationId, candidates: [candidate], approval: null, blockers: [] } } };
}
function setup(data: PlanPosthocResult | null = result(), patch: Partial<PlanPosthocWorkspaceState> = {}) {
  const fallback = data ?? result(), calls: string[] = [];
  const state: PlanPosthocWorkspaceState = { phase: "ready", result: data, evaluation: null, pending: null, canWrite: true, message: "已核对合成资料", ...patch };
  const client: PlanPosthocWorkspaceClient = { initialize: async () => { calls.push("initialize"); }, load: async () => { calls.push("load"); }, evaluate: async () => { calls.push("evaluate"); },
    apply: async () => { calls.push("apply"); }, revoke: async () => { calls.push("revoke"); }, recover: async () => { calls.push("recover"); },
    retry: async () => { calls.push("retry"); }, endAttempt: async () => { calls.push("endAttempt"); }, pause: () => { calls.push("pause"); },
    hasLeaveRisk: () => !!state.pending, getSnapshot: () => state, subscribe: () => () => {} };
  const props: PlanPosthocWorkspaceProps = { siteId: fallback.siteId, workerId: fallback.worker.workerId, slotId: fallback.slot.id, actorId: fallback.actorId,
    client, enabled: true, scopeEpoch: 2, onClose: () => { calls.push("close"); } };
  return { props, calls, state };
}
function evaluation(state: PlanPosthocEvaluationResult["state"] = "required") {
  const old = exceptionUiEligibleSource(), a = old.source.approval!;
  const facts: PlanPosthocEvaluationFacts = { protocol: "plan-posthoc-evaluation-v1", siteId: old.siteId, actorId: old.actorId, worker: old.worker, slot: old.slot, readAt: old.readAt, fingerprint: "e".repeat(64),
    source: { protocol: "posthoc-evaluation-evidence-v1", basis: old.source, posthoc: { revision: 1, selected: [],
      current: { operationId: id(980), revision: 1, action: "apply", actorId: old.actorId, employeeId: old.worker.employeeId, employeeAuthUserId: old.worker.employeeAuthUserId,
        reason: "synthetic explicit activation", sources: [], sourceFingerprint: "f".repeat(64), recordedAt: old.readAt },
      approval: { operationId: a.operationId, revision: a.revision, sourceId: a.sourceId, sourceSha256: a.sourceSha256, recordedAt: a.recordedAt } },
      observations: [], approval: a, leave: { limited: false, resolved: true, items: [] }, resolutionBlockers: [] } };
  if (state === "not_active") { facts.source.posthoc = { revision: 0, current: null, selected: [], approval: null }; facts.source.resolutionBlockers = ["posthoc_inactive"]; }
  if (state === "blocked") { facts.source.leave.resolved = false; facts.source.resolutionBlockers = ["context_unknown"]; }
  if (state === "not_applicable") {
    facts.source.basis.sessions = []; facts.source.basis.approval = null; facts.source.approval = null; facts.source.posthoc.approval = null;
    const leave = { requestId: id(981), operationId: id(982), revision: 2, status: "approved" as const, startAt: old.slot.startAt, endAt: old.slot.endAt, recordedAt: old.readAt };
    facts.source.basis.context.leave.items = [leave]; facts.source.leave.items = [{ ...leave, current: true }];
  }
  return parsePlanPosthocEvaluation(facts, { siteId: old.siteId, workerId: old.worker.workerId, slotId: old.slot.id }, old.actorId);
}
function disabledButton(html: string, label: string) {
  const button = html.match(new RegExp(`<button\\b[^>]*>${label}</button>`)); assert(button, label); return /disabled=""/.test(button[0]);
}
test("initial rendering performs no initialization, network, storage or action and does not invent a result", () => {
  const { props, calls } = setup(null, { phase: "idle", message: "请明确读取" }), html = render(<Workspace {...props}/>);
  assert.deepEqual(calls, []); assert.match(html, /读取本排班采用与当前候选/); assert(!html.includes("data-plan-posthoc-summary"));
  assert(!html.includes("明确采用或撤销")); assert.match(html, /保存成功不等于结案/);
});
test("flag-off keeps verified saved history and explicit reads, but both mutation controls are disabled", () => {
  const data = result(), { props } = setup(data), html = render(<Workspace {...props} enabled={false}/>);
  assert(html.includes(data.current!.reason)); assert.match(html, /仍可明确读取历史及核对原编号/);
  assert.equal(disabledButton(html, "读取本排班采用与当前候选"), false);
  assert.equal(disabledButton(html, "保存空组并启用请假评价核查"), true); assert.equal(disabledButton(html, "撤销当前整组事后采用"), true);
  assert(html.includes(data.current!.sourceFingerprint)); assert.match(html, /不使用当前候选预览指纹/);
});
test("inactive and mismatched identity/target snapshots never expose old verified content", () => {
  const data = result(), { props } = setup(data);
  for (const patch of [{ active: false }, { actorId: id(800) }, { siteId: "99999999" }, { workerId: id(801) }, { slotId: id(802) }]) {
    const html = render(<Workspace {...props} {...patch}/>);
    assert(!html.includes(data.current!.reason)); assert(!html.includes(data.worker.workerName)); assert(!html.includes("data-plan-posthoc-summary"));
    assert(!html.includes("明确采用或撤销"));
  }
});
test("uncertain operation renders only original ID and action, never local reason/references or a saved result", () => {
  const data = result(), pending = { query: { siteId: data.siteId, workerId: data.worker.workerId, slotId: data.slot.id, mode: "detail" as const, operationId: null },
    command: { action: "apply" as const, operationId: id(888), expectedRevision: 1, expectedFingerprint: "c".repeat(64),
      employeeId: data.worker.employeeId!, employeeAuthUserId: data.worker.employeeAuthUserId!, reason: "SECRET_PENDING_REASON", sources: [{ kind: "missing" as const, requestId: id(889), rootRequestId: id(890), approvalOperationId: id(891) }] } };
  const { props } = setup(data, { pending, phase: "unconfirmed", canWrite: false }), html = render(<Workspace {...props} enabled={false}/>);
  assert(html.includes(pending.command.operationId)); assert.match(html, /操作结果尚未核验/); assert(!html.includes("SECRET_PENDING_REASON"));
  assert(!html.includes(id(889))); assert(!html.includes(data.current!.reason)); assert(!html.includes("已保存事后采用"));
  assert.equal(disabledButton(html, "只核对原编号"), false); assert.equal(disabledButton(html, "原编号核对后重试"), true);
  assert.equal(disabledButton(html, "停止本地跟踪"), false); assert.equal(disabledButton(html, "读取本排班采用与当前候选"), true);
  assert.match(html, /不会取消已发送请求，旧请求仍可能稍后成功；重新读取服务器历史后再处理/);
  assert(!html.includes("未成功尝试")); assert(!html.includes("已取消")); assert(!html.includes("操作失败"));
  const other = { ...pending, query: { ...pending.query, slotId: id(777) } }, out = render(<Workspace {...setup(data, { pending: other }).props}/>);
  assert(!out.includes(pending.command.operationId)); assert.match(out, /当前身份或目标与核对内容不一致/);
});
test("explicit retry can begin read-only verification without cached write permission; apply still cannot", () => {
  const data = result(), pending = { query: { siteId: data.siteId, workerId: data.worker.workerId, slotId: data.slot.id, mode: "detail" as const, operationId: null },
    command: { action: "revoke" as const, operationId: id(888), expectedRevision: 1, expectedFingerprint: data.current!.sourceFingerprint,
      employeeId: data.worker.employeeId!, employeeAuthUserId: data.worker.employeeAuthUserId!, reason: "LOCAL_REVOKE" } };
  const html = render(<Workspace {...setup(data, { pending, phase: "unconfirmed", canWrite: false }).props}/>);
  assert.equal(disabledButton(html, "原编号核对后重试"), false); assert(!html.includes("LOCAL_REVOKE")); assert(!html.includes("明确采用或撤销"));
  const noWrite = render(<Workspace {...setup(data, { canWrite: false }).props}/>);
  assert.match(noWrite, /本次没有取得新写许可/); assert.equal(disabledButton(noWrite, "保存空组并启用请假评价核查"), true);
});
test("selection is whole-source, explicit, at most ten, and rejects unavailable/stale/duplicate anchors", () => {
  const data = result(), base = data.preview!.candidates[0];
  data.preview!.candidates = Array.from({ length: 11 }, (_, n) => ({ ...base, reference: { kind: "session", startEventId: id(1000 + n), lastEventId: id(1100 + n), lastSequence: 2, effectOperationId: null, effectRevision: null } }));
  const keys = data.preview!.candidates.map(c => `session:${c.reference.kind === "session" ? c.reference.startEventId : ""}`);
  assert.equal(planPosthocSelection(data, keys.slice(0, 10))!.length, 10); assert.equal(planPosthocSelection(data, keys), null);
  assert.equal(planPosthocSelection(data, [keys[0], keys[0]]), null); assert.equal(planPosthocSelection(data, ["session:stale"]), null);
  data.preview!.candidates[0].available = false; assert.equal(planPosthocSelection(data, [keys[0]]), null);
  assert.deepEqual(planPosthocSelection(data, []), []); data.preview!.eligible = false; assert.equal(planPosthocSelection(data, []), null);
  data.preview = null; assert.equal(planPosthocSelection(data, []), null);
});
test("editor never preselects a saved group; bounded local pages preserve whole-source identity and labels", () => {
  const data = result(), base = data.preview!.candidates[0];
  data.preview!.candidates = Array.from({ length: 11 }, (_, n) => ({ ...base, reference: { kind: "missing", requestId: id(1000 + n), rootRequestId: id(1100 + n), approvalOperationId: id(1200 + n) }, original: null }));
  const html = render(<PlanPosthocWorkspaceEditor result={data} enabled onDirty={() => {}} onApply={() => {}} onRevoke={() => {}}/>);
  assert.match(html, /每次保存替换整组/); assert.match(html, /已选 0 \/ 10/); assert(!html.includes('checked=""'));
  assert.match(html, /漏卡申报没有原始打卡端点/); assert.equal((html.match(/aria-label="采用批准漏卡/g) ?? []).length, 10);
  assert(!html.includes(id(1010))); assert.match(html, /跨页选择保留/); assert.match(html, /不代表已批准请假、无需评价或出勤正常/);
  assert.equal(disabledButton(html, "保存空组并启用请假评价核查"), true);
});
test("reason and confirmation guard reject blank/control/overlimit and every synchronous stale boundary", () => {
  for (const reason of ["", " ", " padded", "padded ", "a\nb", "a\u007fb", "x".repeat(1001)]) assert.equal(planPosthocReasonValid(reason), false);
  assert.equal(planPosthocReasonValid("已核对"), true); assert.equal(planPosthocReasonValid("字".repeat(1000)), true);
  let writes = 0, current = true, prompts = 0;
  assert.equal(confirmPlanPosthocAction(() => { prompts++; return true; }, () => false, () => { writes++; }), false); assert.equal(prompts, 0);
  assert.equal(confirmPlanPosthocAction(() => false, () => true, () => { writes++; }), false);
  assert.equal(confirmPlanPosthocAction(() => { current = false; return true; }, () => current, () => { writes++; }), false); assert.equal(writes, 0);
  assert.equal(confirmPlanPosthocAction(() => true, () => true, () => { writes++; }), true); assert.equal(writes, 1);
});
test("saved reasons escape; lifecycle wiring is local initialization, scoped cleanup and original-number-only recovery", () => {
  const data = result(); data.current!.reason = '<img src=x onerror="secret">';
  const html = render(<Workspace {...setup(data).props}/>); assert(!html.includes("<img")); assert.match(html, /&lt;img/); assert.match(html, /min-w-0/); assert.match(html, /break-all/);
  const source = readFileSync(new URL("../components/enterprise/MerchantAttendancePlanPosthocWorkspace.tsx", import.meta.url), "utf8");
  for (const forbidden of ["fetch(", "sessionStorage", "localStorage", "randomUUID", "setInterval", "useEffect(", "new Date("]) assert(!source.includes(forbidden), forbidden);
  assert(source.includes("才停止本地跟踪。这不会取消已发送请求，旧请求仍可能稍后成功；重新读取服务器历史后再处理。继续？"));
  assert(!source.includes("结束本地未成功尝试"));
  for (const expected of ["scope.epoch !== epoch", "scope.client !== props.client", "scope.actorId !== props.actorId", "scope.workerId !== props.workerId", "scope.slotId !== props.slotId",
    'document.addEventListener("visibilitychange"', 'window.addEventListener("pagehide"', 'window.addEventListener("beforeunload"', "client.pause()", "void client.initialize()", "registerLeaveGuard?.(leave)",
    "registerLeaveGuard?.(null)", "client.getSnapshot() === snapshot", "snapshot.result === expected", "client.recover()", "client.retry()", "client.endAttempt()", "client.evaluate()"])
    assert(source.includes(expected), expected);
  assert(!/useLayoutEffect\([\s\S]*?client\.load\(/.test(source.slice(source.indexOf("useLayoutEffect(() =>"), source.indexOf("const visible"))));
});
test("explicit read-only evaluation remains available with writes off and never treats its result as adoption permission", () => {
  const checked = evaluation(), { props, calls } = setup(null, { evaluation: checked, canWrite: false });
  const html = render(<Workspace {...props} enabled={false}/>); assert.deepEqual(calls, []);
  assert.equal(disabledButton(html, "核对保存来源与请假（预览）"), false); assert.match(html, /存在剩余要求，预览首末边缘/);
  assert.match(html, /未保存正式异常结论，未替代员工结果或周期确认/); assert(!html.includes("明确采用或撤销"));
  assert(html.includes(checked.fingerprint)); assert.match(html, /计划开始边缘/); assert.match(html, /固定宽限：0 分钟/);
  const busy = render(<Workspace {...setup(null, { evaluation: checked, phase: "loading" }).props}/>);
  assert.equal(disabledButton(busy, "核对保存来源与请假（预览）"), true);
});
test("evaluation identity and lifecycle guards hide all current evidence for inactive or mismatched scopes and pending", () => {
  const checked = evaluation(), data = result(), pending = { query: { siteId: data.siteId, workerId: data.worker.workerId, slotId: data.slot.id, mode: "detail" as const, operationId: null },
    command: { action: "revoke" as const, operationId: id(888), expectedRevision: 1, expectedFingerprint: data.current!.sourceFingerprint, employeeId: data.worker.employeeId!, employeeAuthUserId: data.worker.employeeAuthUserId!, reason: "pending" } };
  for (const patch of [{ active: false }, { actorId: id(800) }, { siteId: "99999999" }, { workerId: id(801) }, { slotId: id(802) }]) {
    const html = render(<Workspace {...setup(null, { evaluation: checked }).props} {...patch}/>);
    assert(!html.includes("data-plan-posthoc-evaluation=")); assert(!html.includes(checked.fingerprint));
  }
  const html = render(<Workspace {...setup(data, { evaluation: checked, pending }).props}/>);
  assert(!html.includes("data-plan-posthoc-evaluation=")); assert.equal(disabledButton(html, "核对保存来源与请假（预览）"), true);
});
test("four Chinese evaluation states retain unknown/null versus zero coverage and never turn full leave into a verdict", () => {
  const labels = { not_active: "尚未启用或已撤销事后评价", blocked: "当前依据有阻断，不能作判断", required: "存在剩余要求，预览首末边缘", not_applicable: "已批请假覆盖，无需本次边缘评价（仅预览）" };
  for (const state of ["not_active", "blocked", "required", "not_applicable"] as const) {
    const data = evaluation(state), html = render(<PlanPosthocEvaluationView result={data}/>); assert.equal(data.state, state); assert(html.includes(labels[state]));
    assert.match(html, /无需评价不等于实际准点、全勤或已结案/); assert(!html.includes('type="submit"')); assert(!html.includes("已确认正常"));
    if (state === "blocked") { assert.match(html, /未知：本次未得到可核验的完整结果/); assert.match(html, /context_unknown/); assert(!html.includes("剩余要求为0段")); }
    if (state === "not_applicable") { assert.match(html, /剩余要求为0段/); assert.match(html, /未知／不适用/); assert.match(html, /全部计划区间被覆盖/); }
  }
});
test("saved versus current source observations retain separate endpoints/references and missing-current warnings", () => {
  const data = structuredClone(evaluation()), candidate = result().preview!.candidates[0];
  candidate.selected = { startAt: "2026-10-08T08:00:00.000001Z", endAt: "2026-10-08T16:00:00.000002Z" };
  data.source.posthoc.selected = [candidate, { ...structuredClone(candidate), reference: { kind: "missing", requestId: id(700), rootRequestId: id(701), approvalOperationId: id(702) }, original: null }];
  const now = structuredClone(candidate); now.selected = { startAt: "2026-10-08T08:30:00.000003Z", endAt: "2026-10-08T16:30:00.000004Z" };
  data.source.observations = [{ reference: candidate.reference, current: now, blockers: ["source_changed"] }, { reference: data.source.posthoc.selected[1].reference, current: null, blockers: ["source_unavailable"] }];
  data.state = "blocked"; data.blockers = ["source_changed", "source_unavailable"];
  const html = render(<PlanPosthocEvaluationView result={data}/>);
  for (const text of ["保存核定端点", "当前核定端点", candidate.selected.startAt!, now.selected.startAt!, "保存来源已变化", "当前来源未取得，不能自动沿用保存端点", "批准漏卡申请", "不能静默换用新版本"]) assert(html.includes(text), text);
});
test("coverage, remaining intervals, work-leave intersections and their references use bounded local pages", () => {
  const data = structuredClone(evaluation("not_applicable")), coverage = data.leaveEdges.approvedCoverage![0];
  data.leaveEdges.approvedCoverage = Array.from({ length: 11 }, (_, n) => ({ ...coverage, leaveRefs: [{ requestId: id(2000 + n), operationId: id(2100 + n), revision: 2 }] }));
  data.leaveEdges.remainingRequired = Array.from({ length: 11 }, () => ({ startAt: data.slot.startAt, endAt: data.slot.endAt }));
  data.leaveEdges.workLeaveOverlaps = Array.from({ length: 11 }, (_, n) => ({ startAt: data.slot.startAt, endAt: data.slot.endAt,
    work: { kind: "session", sourceId: id(2200 + n), operationId: null }, leave: { requestId: id(2300 + n), operationId: id(2400 + n), revision: 2 } }));
  const original = Intl.DateTimeFormat;
  try {
    Object.defineProperty(Intl, "DateTimeFormat", { configurable: true, value: () => { throw Error("no timezone recalculation"); } });
    const html = render(<PlanPosthocEvaluationView result={data}/>);
    for (const title of ["已批请假覆盖", "剩余要求区间", "工作与请假重叠"]) assert(html.includes(`${title}分页`));
    assert(html.includes(id(2009))); assert(!html.includes(id(2010))); assert(html.includes(id(2209))); assert(!html.includes(id(2210)));
    assert.match(html, /不自动抹去工作或取消请假/); assert.equal(data.leaveEdges.workLeaveOverlaps.length, 11);
  } finally { Object.defineProperty(Intl, "DateTimeFormat", { configurable: true, value: original }); }
});
