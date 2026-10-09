import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Review, { AttendanceShiftCheckDetail } from "../components/enterprise/MerchantAttendanceShiftCheck";
import { parseShiftCheckResponse } from "./merchantAttendanceShiftCheck";
import type { SourcesResponse } from "./merchantAttendanceSources";
import type { SelfScheduleAssociation } from "./merchantAttendanceSelfSchedule";
import { shiftRuleViewActor as ownerId, shiftRuleViewId as id, shiftRuleViewQuery as q, shiftRuleViewWire } from "../../scripts/fixtures/attendance-shift-rule-view-model";
import { shiftRuleBindingWire, shiftRulePoint, refreshShiftRulePointFields, rehashShiftRuleBinding } from "../../scripts/fixtures/attendance-shift-rule-binding-model";
import { projectShiftRuleView } from "./merchantAttendanceShiftRuleView.server";
import { scheduleEvidenceWire, parseScheduleEvidenceWire, scheduleEvidenceCorrection, scheduleEvidenceMissing, scheduleEvidenceRow } from "../../scripts/fixtures/attendance-schedule-evidence-model";

let requests = 0;
const apiFetch = async (): Promise<Response> => { requests++; throw Error("SSR must not request"); };
function source(): SourcesResponse {
  const w = scheduleEvidenceWire(), row = w.attendance.base.items[0]; row.startEventId = q.startEventId; row.events[0].id = q.startEventId;
  w.attendance.missing.push(scheduleEvidenceMissing()); return { ...parseScheduleEvidenceWire(w), moduleEnabled: true };
}
function wire(options: { status?: "verified" | "missing" | "unverified"; open?: boolean; corrected?: boolean; mode?: "disabled" | "inherit"; relation?: SelfScheduleAssociation | null } = {}) {
  let rule = shiftRuleViewWire(options.status ?? "verified", true);
  if (options.mode) {
    const raw = shiftRuleBindingWire("verified"), point = shiftRulePoint();
    point.enterprise.publication!.rules!.openSpanWarningMinutes = { mode: options.mode };
    point.enterprise.publication!.rules!.completedBreakMinimumMinutes = { mode: options.mode };
    rule = structuredClone(projectShiftRuleView(rehashShiftRuleBinding(raw, refreshShiftRulePointFields(point)), q, ownerId));
  }
  rule.readAt = "2026-09-10T12:00:00.000001Z";
  const row = scheduleEvidenceRow(); row.startEventId = q.startEventId; row.events[0].id = q.startEventId;
  const first = row.events[0];
  row.events = [first, { ...first, id: id(301), sequence: 2, action: "break_start", occurredAt: "2026-09-02T12:00:00.000000Z", breakPaid: true },
    ...options.open ? [] : [{ ...first, id: id(302), sequence: 3, action: "break_end" as const, occurredAt: "2026-09-02T12:00:59.999999Z" },
      { ...first, id: id(303), sequence: 4, action: "clock_out" as const, occurredAt: "2026-09-02T16:00:00.000000Z" }]];
  const effect = options.corrected ? scheduleEvidenceCorrection(row, { startAt: "2026-09-02T09:00:00.000000Z", endAt: "2026-09-02T17:00:00.000000Z",
    breaks: [{ startAt: "2026-09-02T12:00:00.000000Z", endAt: "2026-09-02T12:01:00.000000Z", paid: false }] }) : null;
  return { ok: true, moduleEnabled: true, data: { protocol: "shift-check-v1", algorithmVersion: "single-shift-thresholds-v1", readOnly: true, formalReady: false,
    asOf: rule.readAt, rule, events: row.events, effect, relation: options.relation ?? null } };
}
const render = (s = source(), enabled = true, owner = ownerId) => renderToStaticMarkup(createElement(Review, { source: s, ownerId: owner, apiFetch, enabled }));
const detail = (body = wire()) => renderToStaticMarkup(createElement(AttendanceShiftCheckDetail, { result: parseShiftCheckResponse(body, q, ownerId) }));
const count = (html: string, needle: string) => html.split(needle).length - 1;

test("new review is strictly default-off and never requests during render", () => {
  const key = "NEXT_PUBLIC_FAOLLA_ATTENDANCE_SHIFT_CHECK_ENABLED", previous = process.env[key];
  try {
    for (const value of [undefined, "0", "true", " 1"]) { if (value === undefined) delete process.env[key]; else process.env[key] = value;
      assert.equal(renderToStaticMarkup(createElement(Review, { source: source(), ownerId, apiFetch })), ""); }
    process.env[key] = "1"; assert.match(renderToStaticMarkup(createElement(Review, { source: source(), ownerId, apiFetch })), /单班次独立核查/);
    assert.equal(render(undefined, false), ""); assert.equal(requests, 0);
  } finally { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; }
});
test("only original starts are selectable; initial choice is empty and whole-missing requests are excluded", () => {
  const html = render(); assert.match(html, /aria-label="选择核查原始班次"/); assert.match(html, /value="" selected=""/);
  assert.equal(count(html, "<option"), 2); assert(html.includes(`value="${q.startEventId}"`));
  assert(!html.includes(source().attendance.missing[0].requestId)); assert.match(html, /disabled="">读取班次核查/);
  assert.doesNotMatch(html, /data-shift-check-detail|<form|type="text"/); assert.equal(requests, 0);
});
test("null identity, empty/only-missing and malformed source cannot crash the existing page or fetch", () => {
  const empty = source(); empty.attendance.base.rows = []; assert.match(render(empty), /没有可选择的原始班次/); assert.equal(count(render(empty), "<option"), 1);
  const unbound = source(); assert("employeeId" in unbound.attendance.base); unbound.worker.employeeId = null; unbound.attendance.base.employeeId = null;
  assert.match(render(unbound), /当前员工身份尚未就绪/); assert.equal(count(render(unbound), "<option"), 1);
  const duplicate = source(); duplicate.attendance.base.rows.push(structuredClone(duplicate.attendance.base.rows[0]));
  for (const html of [render(duplicate), render(source(), true, id(999)), render({} as SourcesResponse)]) {
    assert.match(html, /role="alert"/); assert.doesNotMatch(html, /<select|data-shift-check-detail/);
  }
  assert.equal(requests, 0);
});
test("complete raw and approved breaks remain separate, including exact equality, paid flag and revision evidence", () => {
  const html = detail(wire({ corrected: true })); assert.match(html, /data-shift-check-view="original"/); assert.match(html, /data-shift-check-view="approved"/);
  assert.match(html, /data-check-state="triggered"/); assert.match(html, /data-check-state="not_triggered"/);
  assert.match(html, /59999999 微秒/); assert.match(html, /60000000 微秒/); assert.match(html, /带薪休息/); assert.match(html, /非带薪休息/);
  assert.match(html, /核定修订 1/); assert.match(html, /没有按补正起点重选规则/); assert.match(html, /根操作/);
  assert.match(html, /不刷新父工时合计/); assert.match(html, /single-shift-thresholds-v1/);
});
test("open span uses server elapsed time only and does not invent the current open break end", () => {
  const html = detail(wire({ open: true })); assert.match(html, /data-shift-check-open="triggered"/);
  assert.match(html, /达到或超过才触发/); assert.match(html, /不是工作时长，不扣休息/);
  assert.match(html, /data-shift-check-open-break/); assert.match(html, /不假设结束，不参与已结束单段下限比较/);
  assert.match(html, /没有可比较的已结束休息段/); assert.match(html, /没有下班事实/);
  assert.match(html, /data-shift-check-no-correction/); assert.match(html, /不重复统计同一提醒/);
});
test("missing/unverified, disabled and unconfigured remain explicit per-field outcomes, not zero or overall normal", () => {
  for (const status of ["missing", "unverified"] as const) { const html = detail(wire({ status, open: true }));
    assert.match(html, /data-shift-check-open="unavailable"/); assert.match(html, /无法判断：没有可靠固定依据/); }
  const disabled = detail(wire({ mode: "disabled", open: true })); assert.match(disabled, /data-shift-check-open="disabled"/); assert.match(disabled, /此项已明确停用（不是 0）/);
  const inherited = detail(wire({ mode: "inherit", open: true })); assert.match(inherited, /data-shift-check-open="unconfigured"/); assert.match(inherited, /此项未配置（不是 0）/);
  assert.doesNotMatch(disabled + inherited, />正常<|出勤合格|核查通过/);
});
test("no saved association never becomes no schedule or absence; complete shift open reminder is not applicable", () => {
  const html = detail(); assert.match(html, /data-shift-check-open="not_applicable"/); assert.match(html, /没有已保存的原选择关系/);
  assert.match(html, /不表示没有排班或缺勤/); assert.doesNotMatch(html, /data-shift-check-difference/);
});
function relation(): SelfScheduleAssociation {
  return { startEventId: q.startEventId, operationId: id(11), selection: { slotId: id(500), revision: 1 }, status: "linked", reason: null,
    slot: { id: id(500), revision: 1, locationId: id(5), locationName: "Saved place", timeZone: "UTC", workDate: "2026-09-02",
      startAt: "2026-09-02T08:00:00.000Z", endAt: "2026-09-02T16:00:00.000Z", cancelled: false, hasPublicationEvidence: true },
    observedRevision: 1, recordedAt: "2026-09-02T08:00:00.000900Z", currentCancelled: false };
}
test("original selection and signed differences stay distinct from unselected/unverified and cancellation chronology", () => {
  const linked = relation(); linked.currentCancelled = true;
  const html = detail(wire({ relation: linked, corrected: true })); assert.match(html, /该计划后来已取消/);
  assert.match(html, /data-shift-check-difference="original"/); assert.match(html, /data-shift-check-difference="approved"/);
  assert.match(html, /正值表示晚于，负值表示早于/); assert.match(html, /一个计划可以对应多个实际时段/);
  const none: SelfScheduleAssociation = { ...relation(), selection: null, slot: null, status: "unselected", currentCancelled: null };
  const unselected = detail(wire({ relation: none })); assert.match(unselected, /本次明确不关联排班/); assert.doesNotMatch(unselected, /data-shift-check-difference/);
  for (const reason of ["publication_missing", "cancelled", "location_changed", "outside_window"] as const) {
    const value = relation(); value.status = "unverified"; value.reason = reason;
    if (reason === "publication_missing") value.slot!.hasPublicationEvidence = false;
    if (reason === "cancelled") { value.slot!.cancelled = true; value.currentCancelled = true; }
    if (reason === "location_changed") value.slot!.locationId = id(6);
    const uncertain = detail(wire({ relation: value })); assert.match(uncertain, /原选择待核验/); assert.doesNotMatch(uncertain, /data-shift-check-difference/);
    if (reason === "cancelled") { assert.match(uncertain, /上班时计划已取消/); assert.doesNotMatch(uncertain, /该计划后来已取消/); }
  }
});
test("many complete breaks are shown in bounded ten-item pages without extra requests", () => {
  const body = wire(), first = body.data.events[0]; body.data.events = [first];
  for (let index = 0; index < 11; index++) {
    const minute = String(index).padStart(2, "0");
    body.data.events.push({ ...first, id: id(600 + index * 2), sequence: 2 + index * 2, action: "break_start", breakPaid: index % 2 === 0, occurredAt: `2026-09-02T09:${minute}:00.000000Z` },
      { ...first, id: id(601 + index * 2), sequence: 3 + index * 2, action: "break_end", occurredAt: `2026-09-02T09:${minute}:01.000000Z` });
  }
  body.data.events.push({ ...first, id: id(700), sequence: 24, action: "clock_out", occurredAt: "2026-09-02T16:00:00.000000Z" });
  const html = detail(body); assert.equal(count(html, "data-shift-check-break="), 10); assert.match(html, /第 1 \/ 2 页 · 共 11 段/);
  assert.match(html, /下一页原始休息/); assert.equal(requests, 0);
});
test("fixed source audit preserves source hash, provenance, original anchor, channels and server-only verification", () => {
  const body = wire(), html = detail(body), evidence = body.data.rule.evidence!;
  assert(html.includes(evidence.sourceSha256)); assert(html.includes(q.startEventId)); assert(html.includes(id(32)));
  assert.match(html, /核对原开班固定依据、来源摘要与版本/); assert.match(html, /没有重新核验完整来源字节/);
  assert.match(html, /完整读取，不按父日期窗口裁剪/); assert.match(html, /员工自助/); assert.match(html, /个人账本 3/);
});
test("inactive and paused historical reads remain visible and labels are escaped", () => {
  const body = wire(); body.moduleEnabled = false; body.data.rule.worker.active = false; body.data.rule.worker.employeeActive = false;
  body.data.rule.worker.workerName = "<img src=x onerror=alert(1)>";
  const html = detail(body); assert.match(html, /档案停用/); assert.match(html, /新考勤已暂停/); assert.match(html, /&lt;img/); assert.doesNotMatch(html, /<img/);
});
test("component has precommit identity reset, synchronous lifecycle cleanup and no storage/node runtime imports", () => {
  const ui = readFileSync(new URL("../components/enterprise/MerchantAttendanceShiftCheck.tsx", import.meta.url), "utf8");
  const client = readFileSync(new URL("./merchantAttendanceShiftCheckClient.ts", import.meta.url), "utf8");
  for (const text of ["identity.source !== props.source", "identity.apiFetch !== props.apiFetch", "identity.ownerId !== props.ownerId", "<Prepared key={identity.key}", "flushSync(hide)",
    'window.addEventListener("pagehide", onHide)', 'window.removeEventListener("pagehide", onHide)', "client.pause()", "if (lease !== generation.current) return"]) assert(ui.includes(text));
  assert.doesNotMatch(ui + client, /localStorage|sessionStorage|setInterval|node:crypto|\.server["']/);
  assert(client.includes("result.rule.event.occurredAt !== anchor.original.startAt")); assert(client.includes("result.rule.event.timeZone !== anchor.original.timeZone"));
  assert.equal(requests, 0);
});
