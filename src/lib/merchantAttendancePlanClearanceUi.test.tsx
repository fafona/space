import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup as render } from "react-dom/server";
import Workspace, { PlanExceptionDetail, PlanExceptionOutcomeOptions, planExceptionOutcomeAllowed } from "../components/enterprise/MerchantAttendancePlanExceptionWorkspace";
import { EventNotificationCard, EventNotificationSummary, EventNotificationDetailView } from "../components/enterprise/MerchantAttendanceEventNotificationsPanel";
import { canClearPlanException } from "./merchantAttendancePlanClearance";
import { calculateExceptionCandidate } from "./merchantAttendancePlanExceptionSource";
import { parsePlanExceptionResponse } from "./merchantAttendancePlanExceptions";
import { parseEventNotificationsDetail, type EventNotificationsResult } from "./merchantAttendanceEventNotifications";
import { exceptionUiHttp, exceptionUiQuery, exceptionUiEligibleSource, exceptionUiEvidence, exceptionUiId as id,
  exceptionUiSite as site, exceptionUiOwner as owner, exceptionUiEmployee as employee } from "../../scripts/fixtures/attendance-plan-exception-ui-model";

const label = "核对后未触发本次迟到／早退规则";
// Detached protocol/render fixture: a three-minute early departure within the
// saved five-minute early grace. This is not an actual SQL correction exercise.
function cleared(access: "owner" | "self" = "owner", moduleEnabled = true) {
  const body = exceptionUiHttp({ access, saved: true, moduleEnabled }), d = body.data.detail!, source = exceptionUiEligibleSource(), session = source.source.sessions[0];
  const startAt = source.slot.startAt.replace(/\.(\d{3})Z$/, ".$1000Z");
  session.original = { startAt, endAt: "2026-10-08T15:57:00.000000Z" };
  session.selected = { ...session.original }; session.relation.recordedAt = startAt; session.adoption!.recordedAt = startAt;
  source.candidate = calculateExceptionCandidate(source.source, true);
  assert.equal(source.candidate.late.state, "not_triggered"); assert.equal(source.candidate.early.state, "not_triggered");
  d.revision = 2; d.current = access === "owner" ? source : null;
  d.latestDecision = { ...d.latestDecision!, operationId: id(901), revision: 2, outcome: "cleared", note: "按保存宽限核对，未触发本次规则", evidence: exceptionUiEvidence(source) };
  const { evidence, readAt, ...entry } = d.latestDecision; void evidence; void readAt; d.history.unshift(entry);
  return parsePlanExceptionResponse(body, exceptionUiQuery(access), access === "owner" ? { ownerId: owner } : { employeeId: employee });
}

test("clearance option is independently off; all three old options keep their original gates", () => {
  for (const canConclude of [false, true]) {
    const html = render(<PlanExceptionOutcomeOptions canConclude={canConclude} canClear clearanceEnabled={false}/>);
    assert(!html.includes('value="cleared"')); for (const text of ["确认异常", "说明后豁免", "继续核查"]) assert(html.includes(text));
    for (const outcome of ["confirmed", "excused"] as const) assert.equal(planExceptionOutcomeAllowed(outcome, canConclude, true, false), canConclude);
    assert(planExceptionOutcomeAllowed("follow_up", canConclude, false, false));
  }
  assert(!planExceptionOutcomeAllowed("", true, true, true));
  assert(!planExceptionOutcomeAllowed("cleared", true, true, false));
  assert(!planExceptionOutcomeAllowed("cleared", true, false, true));
  assert(planExceptionOutcomeAllowed("cleared", false, true, true));
});
test("enabled new option remains disabled without the exact current eligible existing-case basis", () => {
  const d = cleared().detail!; assert(canClearPlanException(d));
  const html = render(<PlanExceptionOutcomeOptions canConclude={false} canClear={false} clearanceEnabled/>);
  assert.match(html, /value="cleared" disabled=""/); assert(html.includes(label));
  const patches = [{ caseId: null }, { revision: 0 }, { canDecide: false }, { currentValidation: "not_checked" as const }, { current: null }];
  for (const patch of patches) assert(!canClearPlanException({ ...d, ...patch }));
  for (const state of ["disabled", "unconfigured", "blocked", "triggered"] as const) {
    for (const side of ["late", "early"] as const) { const value = structuredClone(d); value.current!.candidate[side].state = state; assert(!canClearPlanException(value)); }
  }
  const blocked = structuredClone(d); blocked.current!.eligible = false; assert(!canClearPlanException(blocked));
});
test("SSR with either new flag value performs no network or writes and does not preselect a conclusion", () => {
  let requests = 0; const apiFetch = async () => { requests++; throw Error("unexpected"); };
  for (const clearanceEnabled of [false, true]) {
    const html = render(<Workspace siteId={site} access="owner" actorId={owner} apiFetch={apiFetch} enabled clearanceEnabled={clearanceEnabled} onClose={() => {}}/>);
    assert.match(html, /读取异常处理记录/); assert(!html.includes('data-plan-exception-detail')); assert(!html.includes('value="cleared"'));
  }
  assert.equal(requests, 0);
});
test("within-grace clearance preserves endpoints, positive raw delta, grace and non-normal limitations", () => {
  const value = cleared(), html = render(<PlanExceptionDetail result={value}/>);
  assert(html.includes(label)); assert.match(html, /5 分钟/); assert.match(html, /180000000/); assert.match(html, /超出宽限（微秒）：0/);
  for (const endpoint of [value.detail!.current!.candidate.original.startAt!, value.detail!.current!.candidate.selected.endAt!]) assert(html.includes(endpoint));
  for (const text of ["不声称实际没有晚到或提前离开", "不代表整班全部出勤正常", "后续说明或来源变化仍须重新核查", "本次人工核对资料"]) assert(html.includes(text));
  assert.match(html, /data-plan-exception-field="early" data-rule-state="not_triggered"/);
});
test("paused self historical clearance remains readable without current-valid claims or a write flag", () => {
  const html = render(<PlanExceptionDetail result={cleared("self", false)}/>);
  assert(html.includes(label)); assert.match(html, /当前依据未重新核查/); assert.match(html, /已读不等于认可/);
  assert.match(html, /保存时的相关资料引用/); assert(!html.includes("本次人工核对资料")); assert(!html.includes("<button"));
});
test("the three prior history outcomes retain their labels beside new clearance", () => {
  const value = structuredClone(cleared("self")), base = value.detail!.history[1];
  value.detail!.history = [...value.detail!.history, { ...base, operationId: id(903), outcome: "excused" }, { ...base, operationId: id(904), outcome: "follow_up" }];
  const html = render(<PlanExceptionDetail result={value}/>);
  for (const text of [label, "确认异常", "说明后豁免", "继续核查"]) assert(html.includes(text));
});
test("new message type displays only the saved narrow outcome; mark-read stays distinct from business ack", () => {
  const d = parseEventNotificationsDetail({ notificationId: id(910), sourceCategory: "plan_exception", type: "cleared", sourceId: id(900), sourceOperationId: id(901), sourceRevision: 2,
    occurredAt: "2026-10-09T12:00:00.000000Z", readAt: null, summary: { slotId: id(30), startAt: "2026-10-08T08:00:00.000000Z", endAt: "2026-10-08T16:00:00.000000Z", timeZone: "UTC", outcome: "cleared" } });
  const { summary, ...item } = d; void summary;
  const value: EventNotificationsResult = { protocol: "event-notifications-v1", siteId: site, actorId: id(3), employeeId: employee, workerId: id(4), items: [], nextCursor: null, detail: d, canMarkRead: false };
  const html = render(<><EventNotificationCard item={item}/><EventNotificationSummary detail={d}/><EventNotificationDetailView result={value} enabled={false} disabled/></>);
  for (const text of [label, "当时结果", "当前事项状态未重新核查", "不提交异常业务已读确认", "不代表整班全部出勤正常"]) assert(html.includes(text), text);
  assert(!html.includes(' checked=""')); assert.match(html, /disabled=""[^>]*>明确标记这条消息已读/); assert(!html.includes("明确已读处理结果"));
});
test("new gate applies only to new outcome selection and pending cleared POST, never to detail or GET recovery", () => {
  const text = readFileSync(new URL("../components/enterprise/MerchantAttendancePlanExceptionWorkspace.tsx", import.meta.url), "utf8");
  assert.match(text, /NEXT_PUBLIC_FAOLLA_ATTENDANCE_PLAN_CLEARANCE_ENABLED === "1"/);
  assert.match(text, /apiFetch, enabled, clearanceEnabled, posthocReviewEnabled, storage:/); assert.match(text, /pending.command.outcome === "cleared" && !clearanceEnabled/);
  assert.match(text, /disabled=\{busy\} onClick=\{\(\) => read\(\(\) => \{ void client.recover\(\);/);
  assert(!text.slice(text.indexOf("export function PlanExceptionDetail")).includes("clearanceEnabled"));
  assert.match(text, /generation.current === epoch && client.getSnapshot\(\) === snapshot/);
  assert(!text.includes("localStorage")); assert(!text.includes("setInterval"));
});
