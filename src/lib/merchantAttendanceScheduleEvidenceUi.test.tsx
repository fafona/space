import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ScheduleEvidence, { ScheduleEvidenceGraph } from "../components/enterprise/MerchantAttendanceScheduleEvidence";
import { resolveAttendanceScheduleEvidence } from "./merchantAttendanceScheduleEvidence";
import type { SourcesResult } from "./merchantAttendanceSources";
import { scheduleEvidenceWire, parseScheduleEvidenceWire, scheduleEvidenceRow, scheduleEvidenceSlot, scheduleEvidenceCorrection,
  scheduleEvidenceMissing, scheduleEvidenceLeave, scheduleEvidenceCalendar, scheduleEvidenceId } from "../../scripts/fixtures/attendance-schedule-evidence-model";
import { scheduleEvidenceBrowserModel } from "../../scripts/fixtures/attendance-schedule-evidence-browser";

const source = () => parseScheduleEvidenceWire(scheduleEvidenceWire());
const render = (input = source()) => renderToStaticMarkup(createElement(ScheduleEvidence, { source: input }));
const graph = (input: SourcesResult, kind: "original" | "selected") => {
  const result = resolveAttendanceScheduleEvidence(input), view = result.views.find(item => item.kind === kind)!;
  return renderToStaticMarkup(createElement(ScheduleEvidenceGraph, { source: input, result, view }));
};

test("time evidence starts on original records and clearly rejects formal match, totals and historical proof claims", () => {
  const html = render(); assert.match(html, /aria-label="排班与记录时间对照"/); assert.match(html, /data-schedule-evidence="true"/);
  assert.match(html, /role="tab"[^>]*aria-selected="true"[^>]*>原始记录/); assert.match(html, /data-schedule-evidence-view="original"/);
  assert.match(html, /一条时间相交候选，不代表已匹配/); assert.match(html, /不计算合计、不应用规则/);
  assert.match(html, /历史打卡身份、地点及班次规则绑定未由本协议证明/);
  assert.doesNotMatch(html, /<form|<input|<select|<textarea|data-evidence-kind="missing-approved"/);
});

test("literal UTC endpoints, saved timezone, schedule and event identifiers are retained without mutating source", () => {
  const input = source(), before = structuredClone(input), html = render(input);
  for (const text of ["2026-09-02T08:00:00.000000Z", "2026-09-02T16:00:00.000000Z", "保存时区 UTC", scheduleEvidenceId(10001), scheduleEvidenceId(1002), scheduleEvidenceId(1003)]) assert(html.includes(text), text);
  assert.match(html, /发布版本 1/); assert.deepEqual(input, before);
});

test("endpoint deltas preserve microseconds and signed direction but are never labelled late or early decisions", () => {
  const wire = scheduleEvidenceWire(); wire.attendance.base.items = [scheduleEvidenceRow(1, "2026-09-02T08:00:00.000001Z", "2026-09-02T16:00:00.000009Z")];
  const html = render(parseScheduleEvidenceWire(wire));
  assert.match(html, /0\.000001 秒（1 微秒）/); assert.match(html, /0\.000009 秒（9 微秒）/);
  assert.match(html, /仅显示端点相减，不解释为迟到或早退/);
});

test("the selected graph shows actual correction IDs/revision and the original graph keeps original endpoints", () => {
  const wire = scheduleEvidenceWire(), row = wire.attendance.base.items[0];
  row.effect = scheduleEvidenceCorrection(row, { startAt: "2026-09-02T09:00:00.000000Z", endAt: "2026-09-02T17:00:00.000000Z", breaks: [] });
  const input = parseScheduleEvidenceWire(wire), original = graph(input, "original"), selected = graph(input, "selected");
  assert.match(original, /data-evidence-kind="original"/); assert.doesNotMatch(original, /data-evidence-kind="approved"/);
  assert.match(selected, /data-evidence-kind="approved"/); assert.match(selected, /已批准补正的当前核定记录/);
  assert(selected.includes(row.effect.operationId)); assert(selected.includes(row.effect.requestId)); assert.match(selected, /核定版本 1/); assert.match(selected, /原批准链/);
  assert.match(selected, /2026-09-02T09:00:00\.000000Z/);
});

test("approved missing remains a separate selected source without inventing a raw event or correction revision", () => {
  const wire = scheduleEvidenceWire(); wire.attendance.missing = [scheduleEvidenceMissing()];
  wire.schedule.items.push(scheduleEvidenceSlot(2, "2026-09-03T08:00:00.000Z", "2026-09-03T16:00:00.000Z"));
  const input = parseScheduleEvidenceWire(wire), original = graph(input, "original"), selected = graph(input, "selected");
  assert.doesNotMatch(original, /data-evidence-kind="missing-approved"/); assert.match(selected, /独立整段漏卡申报，不是原始打卡/);
  assert(selected.includes(wire.attendance.missing[0].requestId)); assert(selected.includes(wire.attendance.missing[0].operationId));
  const missing = selected.match(/<article data-schedule-evidence-record[^>]*data-evidence-kind="missing-approved"[\s\S]*?<\/article>/)![0];
  assert.doesNotMatch(missing, /原始起点事件|核定版本/);
});

test("cancelled schedules remain visible as history and never enter candidate edges", () => {
  const wire = scheduleEvidenceWire(); wire.schedule.items[0].cancelled = true; wire.schedule.items[0].cancelReason = "Synthetic cancellation";
  const html = render(parseScheduleEvidenceWire(wire)); assert.match(html, /已取消排班，不纳入候选/); assert.match(html, /data-evidence-cancelled="true"/);
  assert.match(html, /未见时间相交候选，不代表缺勤/); assert.doesNotMatch(html, /data-evidence-candidate="true"/);
});

test("limited coverage is unknown rather than an empty source and suppresses endpoint differences", () => {
  const wire = scheduleEvidenceWire(); wire.schedule = { limited: true, items: [] }; wire.leave = { limited: true, items: [] }; wire.calendar = { limited: true, items: [] };
  const html = render(parseScheduleEvidenceWire(wire)); assert.match(html, /排班资料未完整取得/); assert.match(html, /请假资料未完整取得/); assert.match(html, /日历资料未完整取得/);
  assert.match(html, /排班来源不完整，候选未知/); assert.doesNotMatch(html, /data-evidence-time-difference|本次范围未返回排班/);
});

test("carry-in and open observation bounds are explicit and never manufacture clock-out or zero", () => {
  const wire = scheduleEvidenceWire({ empty: true, asOf: "2026-09-02T12:00:00.000001Z" });
  wire.attendance.base.items = [scheduleEvidenceRow(1, "2026-08-31T23:00:00.000000Z", null)];
  wire.schedule.items = [scheduleEvidenceSlot(1, "2026-08-31T23:00:00.000Z", "2026-09-01T07:00:00.000Z")];
  const html = render(parseScheduleEvidenceWire(wire)); assert.match(html, /未结束（未知，不计作 0）/); assert.match(html, /观察截至/);
  assert.match(html, /不补造结束时刻/); assert.match(html, /记录跨越查询边界/); assert.match(html, /排班跨越查询边界/);
  assert.doesNotMatch(html, /data-evidence-time-difference/);
});

test("approved partial leave and mismatched identity stay annotations instead of full excusal", () => {
  const wire = scheduleEvidenceWire(), leave = scheduleEvidenceLeave(1, "approved", { employeeId: scheduleEvidenceId(77) });
  leave.summary.startAt = "2026-09-02T09:00:00.000Z"; leave.summary.endAt = "2026-09-02T10:00:00.000Z"; wire.leave.items = [leave];
  const html = render(parseScheduleEvidenceWire(wire)); assert.match(html, /data-employee-matches="false"/); assert.match(html, /员工身份不一致，不能套用/);
  assert.match(html, /部分交集不等于整段免除/); assert.match(html, /2026-09-02T09:00:00\.000000Z/); assert(html.includes(leave.operationId));
  assert.match(html, /历史来源员工身份与当前档案不一致/); assert.doesNotMatch(html, /data-evidence-time-difference/);
});

test("nonapproved leave and cancelled calendar notes retain status without implying a current exemption", () => {
  const wire = scheduleEvidenceWire(); wire.leave.items = [scheduleEvidenceLeave(1, "cancelled")];
  wire.calendar.items = [scheduleEvidenceCalendar(1, { status: "cancelled", revision: 2, kind: "closure", title: "Synthetic closed hint" })];
  const html = render(parseScheduleEvidenceWire(wire)); assert.match(html, /此状态不是当前批准/); assert.match(html, /停业提示 · 已取消/);
  assert.match(html, /不是免班依据/); assert.match(html, /不替代批准请假或排班决定/);
});

test("zero-duration and empty source views keep their distinct neutral explanations", () => {
  const zero = scheduleEvidenceWire(); zero.attendance.base.items = [scheduleEvidenceRow(1, "2026-09-02T08:00:00.000000Z", "2026-09-02T08:00:00.000000Z")];
  assert.match(render(parseScheduleEvidenceWire(zero)), /零时长记录：保留时间点/);
  const empty = render(parseScheduleEvidenceWire(scheduleEvidenceWire({ empty: true })));
  assert.match(empty, /本视图未返回记录；不代表缺勤/); assert.match(empty, /没有候选不等于缺勤/);
});

test("top-level record and schedule lists are bounded to ten and expose only local pagination controls", () => {
  const wire = scheduleEvidenceWire({ empty: true });
  for (let n = 0; n < 11; n++) {
    const hour = String(n).padStart(2, "0"); wire.attendance.base.items.push(scheduleEvidenceRow(n + 1, `2026-09-02T${hour}:00:00.000000Z`, `2026-09-02T${hour}:30:00.000000Z`));
    wire.schedule.items.push(scheduleEvidenceSlot(n + 1, `2026-09-02T${hour}:00:00.000Z`, `2026-09-02T${hour}:30:00.000Z`));
  }
  const html = render(parseScheduleEvidenceWire(wire)); assert.equal((html.match(/data-schedule-evidence-record="true"/g) ?? []).length, 10);
  assert.equal((html.match(/data-schedule-evidence-slot="true"/g) ?? []).length, 10);
  assert.match(html, /下一页时间记录/); assert.match(html, /下一页时间排班/); assert.doesNotMatch(html, /加载更多|读取下一页/);
});

test("one long record with split schedules remains ambiguous and nested candidates render ten per page", () => {
  const wire = scheduleEvidenceWire(); wire.attendance.base.items = [scheduleEvidenceRow(1, "2026-09-02T00:00:00.000000Z", "2026-09-02T12:00:00.000000Z")];
  wire.schedule.items = Array.from({ length: 12 }, (_, n) => scheduleEvidenceSlot(n + 1, `2026-09-02T${String(n).padStart(2, "0")}:00:00.000Z`, `2026-09-02T${String(n + 1).padStart(2, "0")}:00:00.000Z`));
  const html = render(parseScheduleEvidenceWire(wire)); assert.match(html, /存在多条时间关系，不能自动配对/); assert.match(html, /下一页候选排班/);
  assert.equal((html.match(/data-evidence-candidate="true"/g) ?? []).length, 10); assert.doesNotMatch(html, /data-evidence-time-difference/);
});

test("escaped source labels remain text and invalid input fails inside only this child", () => {
  const wire = scheduleEvidenceWire(); wire.schedule.items[0].locationName = '<img src=x onerror="alert(1)">';
  wire.calendar.items = [scheduleEvidenceCalendar(1, { title: "<script>alert(2)</script>" })];
  const html = render(parseScheduleEvidenceWire(wire)); assert.match(html, /&lt;img/); assert.match(html, /&lt;script/); assert.doesNotMatch(html, /<img|<script/);
  const bad = source(); bad.schedule.items[0].endAt = "invalid"; const failed = render(bad);
  assert.match(failed, /role="alert"/); assert.match(failed, /已有原始来源仍可核查/); assert.doesNotMatch(failed, /data-schedule-evidence-record/);
});

test("integration is exactly one child after rule resolution and the new component has no effects/network/storage", () => {
  const panel = readFileSync(new URL("../components/enterprise/MerchantAttendanceSourcesPanel.tsx", import.meta.url), "utf8");
  assert.equal((panel.match(/import ScheduleEvidence from/g) ?? []).length, 1); assert.match(panel, /<RuleResolution source=\{r\}\/>\s*<ScheduleEvidence source=\{r\}\/>/);
  const component = readFileSync(new URL("../components/enterprise/MerchantAttendanceScheduleEvidence.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(component, /\b(?:fetch|apiFetch|useEffect|useLayoutEffect|setInterval|setTimeout)\s*\(|localStorage|sessionStorage|dangerouslySetInnerHTML/);
  assert.match(component, /items\.slice\(current \* 10, current \* 10 \+ 10\)/);
});

test("all positive component-browser fixtures use the real source parser and resolve without starting a DOM", () => {
  for (const mode of ["rich", "pages", "many", "limited"]) {
    const input = scheduleEvidenceBrowserModel(mode), html = render(input); assert.doesNotMatch(html, /role="alert"/, mode);
  }
  assert.match(render(scheduleEvidenceBrowserModel("invalid")), /role="alert"/);
});
