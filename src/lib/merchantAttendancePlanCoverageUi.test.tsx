import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Review, { AttendancePlanCoverageDetail } from "../components/enterprise/MerchantAttendancePlanCoverage";
import { parsePlanCoverageResponse } from "./merchantAttendancePlanCoverage";
import type { SourcesResponse } from "./merchantAttendanceSources";
import { planCoverageHttp, planCoverageActor as ownerId, planCoverageQuery as q, planCoverageId as id } from "../../scripts/fixtures/attendance-plan-coverage-model";
import { scheduleEvidenceWire, parseScheduleEvidenceWire } from "../../scripts/fixtures/attendance-schedule-evidence-model";
import { shiftCheckApprovedEffect } from "../../scripts/fixtures/attendance-shift-check-model";

let requests = 0;
const apiFetch = async (): Promise<Response> => { requests++; throw Error("SSR must not request"); };
function source(): SourcesResponse {
  const s = { ...parseScheduleEvidenceWire(scheduleEvidenceWire()), moduleEnabled: true }, slot = planCoverageHttp(0).data.slot;
  const { hasPublicationEvidence: _evidence, ...anchor } = slot; void _evidence;
  const { reason, cancelReason } = s.schedule.items[0];
  s.schedule.items = [{ ...anchor, workerId: q.workerId, workerName: s.worker.workerName, reason, cancelReason }]; return s;
}
const render = (s = source(), enabled = true, owner = ownerId) => renderToStaticMarkup(createElement(Review, { source: s, ownerId: owner, apiFetch, enabled }));
function body(count: 0 | 1 | 2 = 2) { const v = planCoverageHttp(count); v.data.readStartedAt = "2026-09-02T16:00:00.000000Z"; return v; }
const detail = (v = body()) => renderToStaticMarkup(createElement(AttendancePlanCoverageDetail, { result: parsePlanCoverageResponse(v, q, ownerId) }));
const count = (text: string, part: string) => text.split(part).length - 1;

test("default-off is exact and SSR never starts a request; initial plan selection remains explicit", () => {
  const key = "NEXT_PUBLIC_FAOLLA_ATTENDANCE_PLAN_COVERAGE_ENABLED", previous = process.env[key];
  try {
    for (const value of [undefined, "0", "true", " 1"]) { if (value === undefined) delete process.env[key]; else process.env[key] = value;
      assert.equal(renderToStaticMarkup(createElement(Review, { source: source(), ownerId, apiFetch })), ""); }
    process.env[key] = "1"; assert.match(renderToStaticMarkup(createElement(Review, { source: source(), ownerId, apiFetch })), /计划关联核对/);
    assert.equal(render(undefined, false), ""); const html = render(); assert.match(html, /aria-label="核对排班选择"/); assert.match(html, /value="" selected=""/);
    assert.equal(count(html, "<option"), 2); assert(html.includes(`value="${q.slotId}"`)); assert.match(html, /disabled="">读取计划关联核对/);
    assert.doesNotMatch(html, /data-plan-coverage-detail|<form|type="text"/); assert.equal(requests, 0);
  } finally { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; }
});
test("limited/empty/null-identity and malformed parent data fail closed without misleading absence or crashing the parent", () => {
  const limited = source(); limited.schedule = { limited: true, items: [] }; assert.match(render(limited), /排班列表不完整/); assert.equal(count(render(limited), "<option"), 1);
  const empty = source(); empty.schedule.items = []; assert.match(render(empty), /不代表没有出勤/);
  const unbound = source(); assert("employeeId" in unbound.attendance.base); unbound.worker.employeeId = null; unbound.attendance.base.employeeId = null;
  assert.match(render(unbound), /当前员工身份尚未就绪/); assert.equal(count(render(unbound), "<option"), 1);
  const duplicate = source(); duplicate.schedule.items.push({ ...duplicate.schedule.items[0] });
  for (const html of [render(duplicate), render({} as SourcesResponse), render(source(), true, id(99))]) { assert.match(html, /role="alert"/); assert.doesNotMatch(html, /<select|data-plan-coverage-detail/); }
  assert.equal(requests, 0);
});
test("unmodified selected data is not rendered/count twice; provenance and bounded read interval remain visible", () => {
  const html = detail(); assert.equal(count(html, 'data-plan-coverage-view="original"'), 1); assert.doesNotMatch(html, /data-plan-coverage-view="selected"/);
  assert.match(html, /data-plan-coverage-no-correction/); assert.match(html, /不重复计算同一集合/); assert.match(html, /包含休息/);
  assert.match(html, /explicit-closed-spans-v1/); assert.match(html, /各子资料保留自己的截止时间/); assert.match(html, /该子资料截止 UTC/);
  assert.match(html, /非全渠道完整出勤集合/); assert.match(html, /不刷新父工时合计/); assert.equal(count(html, "data-plan-coverage-session="), 2);
});
test("approved changes render both views with overlap evidence and keep original start/event/effect IDs", () => {
  const v = body(), effect = shiftCheckApprovedEffect(); effect.proposal.endAt = "2026-09-02T13:00:00.000000Z";
  effect.recordedAt = "2026-09-02T15:00:00.000000Z"; effect.lineage.rootRecordedAt = effect.recordedAt;
  effect.elapsedUs = 21600000000; effect.workedUs = 21540000000; v.data.sessions[0].effect = effect;
  const html = detail(v); assert.match(html, /data-plan-coverage-view="original"/); assert.match(html, /data-plan-coverage-view="selected"/);
  assert.match(html, /存在重复相交/); assert.match(html, /核对重叠来源编号/); assert.match(html, /批准申请/); assert(html.includes(effect.operationId));
  assert(html.includes(v.data.sessions[0].rule.event.startEventId)); assert.match(html, /不是|不等于/); assert.doesNotMatch(html, /data-plan-coverage-no-correction/);
});
test("zero relations, unfinished and unverified associations show unknown gaps rather than zero or absence", () => {
  const empty = detail(body(0)); assert.match(empty, /未保存明确关联：不代表没有出勤/); assert.match(empty, /data-plan-coverage-gaps="unknown"/);
  const open = body(1); open.data.sessions[0].events = [open.data.sessions[0].events[0]];
  const ongoing = detail(open); assert.match(ongoing, /不能假设下班时间/); assert.match(ongoing, /未知终点，不以读取时间替代/);
  const uncertain = body(); uncertain.data.sessions[1].relation!.status = "unverified"; uncertain.data.sessions[1].relation!.reason = "outside_window";
  const pending = detail(uncertain); assert.match(pending, /待核验关联/); assert.match(pending, /未并入可信覆盖/);
  for (const html of [empty, ongoing, pending]) { assert.match(html, /未知不记为 0 或缺勤/); assert.doesNotMatch(html, /data-plan-coverage-gaps="available"|>缺勤<|>正常</); }
});
test("later cancellation and missing rule sources do not erase original links or trustworthy temporal facts", () => {
  const v = body(); v.data.slot.cancelled = true; v.data.sessions.forEach(s => { s.relation!.currentCancelled = true; s.rule.status = "missing"; s.rule.reason = "binding_missing"; s.rule.binding = null; s.rule.evidence = null; });
  const html = detail(v); assert.match(html, /选择后排班被取消/); assert.match(html, /原开班规则：缺失/); assert.match(html, /合并覆盖 4 小时/);
  assert.match(html, /未用它判计划迟到／早退/); assert.match(html, /data-plan-coverage-gaps="unknown"/);
});
test("worker/place labels are escaped, paused reads are explanatory and no private raw sources are rendered", () => {
  const v = body(); v.moduleEnabled = false; v.data.worker.workerName = "<img src=x onerror=alert(1)>"; v.data.slot.locationName = "<script>evil()</script>";
  v.data.sessions.forEach(s => { s.rule.worker.workerName = v.data.worker.workerName; s.relation!.slot!.locationName = v.data.slot.locationName; });
  const html = detail(v); assert.match(html, /&lt;img/); assert.match(html, /&lt;script/); assert.doesNotMatch(html, /<img|<script|sourceText|canonicalFormat/);
  assert.match(html, /新考勤已暂停/); assert.equal(requests, 0);
});
test("lifecycle code resets before changed source/owner/api commit and clears hidden/pagehide/unmount without automatic reads", () => {
  const ui = readFileSync(new URL("../components/enterprise/MerchantAttendancePlanCoverage.tsx", import.meta.url), "utf8"), client = readFileSync(new URL("./merchantAttendancePlanCoverageClient.ts", import.meta.url), "utf8");
  for (const text of ["identity.source !== props.source", "identity.ownerId !== props.ownerId", "identity.apiFetch !== props.apiFetch", "<Prepared key={identity.key}",
    "flushSync(hide)", 'window.addEventListener("pagehide", onHide)', 'window.removeEventListener("pagehide", onHide)', "client.pause()", "if (lease !== generation.current) return"]) assert(ui.includes(text));
  assert.doesNotMatch(ui + client, /localStorage|sessionStorage|setInterval|node:crypto|\.server["']/); assert.equal(requests, 0);
});
