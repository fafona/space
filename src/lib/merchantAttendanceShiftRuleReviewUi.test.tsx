import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Review, { AttendanceShiftRuleAnchor, AttendanceShiftRuleReviewDetail, SHIFT_RULE_REVIEW_REASON_LABELS } from "../components/enterprise/MerchantAttendanceShiftRuleReview";
import { AttendanceShiftRuleViewClient } from "./merchantAttendanceShiftRuleViewClient";
import { parseShiftRuleViewResponse } from "./merchantAttendanceShiftRuleView";
import type { SourcesResponse } from "./merchantAttendanceSources";
import { shiftRuleViewActor as ownerId, shiftRuleViewId as id, shiftRuleViewQuery as q, shiftRuleViewHttp } from "../../scripts/fixtures/attendance-shift-rule-view-model";
import { scheduleEvidenceWire, parseScheduleEvidenceWire, scheduleEvidenceCorrection, scheduleEvidenceMissing } from "../../scripts/fixtures/attendance-schedule-evidence-model";

let requests = 0;
const apiFetch = async (): Promise<Response> => { requests++; throw Error("SSR must not request"); };
function source(corrected = false): SourcesResponse {
  const wire = scheduleEvidenceWire(), row = wire.attendance.base.items[0]; row.startEventId = q.startEventId; row.events[0].id = q.startEventId;
  if (corrected) row.effect = scheduleEvidenceCorrection(row, { startAt: "2026-09-02T09:00:00.000000Z", endAt: "2026-09-02T17:00:00.000000Z", breaks: [] });
  wire.attendance.missing.push(scheduleEvidenceMissing()); return { ...parseScheduleEvidenceWire(wire), moduleEnabled: true };
}
const render = (s = source(), enabled = true, owner = ownerId) => renderToStaticMarkup(createElement(Review, { source: s, ownerId: owner, apiFetch, enabled }));
const response = (status: "verified" | "missing" | "unverified" = "verified", layers = false) => parseShiftRuleViewResponse(shiftRuleViewHttp(status, layers), q, ownerId);
const detail = (result = response()) => renderToStaticMarkup(createElement(AttendanceShiftRuleReviewDetail, { result }));
const count = (html: string, needle: string) => html.split(needle).length - 1;

test("Review is default-off and disabled renders nothing without constructing a request", () => {
  const name = "NEXT_PUBLIC_FAOLLA_ATTENDANCE_SHIFT_RULE_BINDING_READ_ENABLED", previous = process.env[name];
  try {
    delete process.env[name]; assert.equal(renderToStaticMarkup(createElement(Review, { source: source(), ownerId, apiFetch })), "");
    process.env[name] = "0"; assert.equal(renderToStaticMarkup(createElement(Review, { source: source(), ownerId, apiFetch })), "");
    process.env[name] = "1"; assert.match(renderToStaticMarkup(createElement(Review, { source: source(), ownerId, apiFetch })), /原班次固定规则依据/);
    assert.equal(render(undefined, false), ""); assert.equal(requests, 0);
  } finally { if (previous === undefined) delete process.env[name]; else process.env[name] = previous; }
});
test("initial selection is empty and bounded to actual original rows; whole-missing request IDs never become selectable", () => {
  const html = render(), s = source(); assert.match(html, /aria-label="原班次固定规则依据"/); assert.match(html, /aria-label="选择原始班次"/);
  assert.equal(count(html, "<option"), 2); assert.match(html, /value="" selected=""/); assert(html.includes(`value="${q.startEventId}"`));
  assert(!html.includes(s.attendance.missing[0].requestId)); assert.match(html, /disabled="">读取原班次依据/);
  assert.doesNotMatch(html, /data-shift-rule-detail|data-shift-rule-anchor|<form|type="text"/); assert.equal(requests, 0);
});
test("empty or only-missing sources stay explanatory and disabled, and null current identity never crashes", () => {
  const empty = source(); empty.attendance.base.rows = []; const html = render(empty);
  assert.equal(count(html, "<option"), 1); assert.match(html, /本次资料没有可选择的原始班次/); assert.match(html, /不代表缺勤或零工时/); assert.match(html, /disabled="">读取原班次依据/);
  const unbound = source(); assert("employeeId" in unbound.attendance.base); unbound.worker.employeeId = null; unbound.attendance.base.employeeId = null; const blocked = render(unbound);
  assert.match(blocked, /当前员工身份尚未就绪/); assert.equal(count(blocked, "<option"), 1); assert.match(blocked, /disabled="">读取原班次依据/);
});
test("scope mismatch, malformed source and duplicate anchors fail closed inside the optional child", () => {
  const duplicated = source(); duplicated.attendance.base.rows.push(structuredClone(duplicated.attendance.base.rows[0]));
  for (const html of [render(source(), true, id(99)), render(duplicated), render({} as SourcesResponse)]) {
    assert.match(html, /role="alert"/); assert.match(html, /请重新读取资料/); assert.doesNotMatch(html, /<select|data-shift-rule-detail|Synthetic evidence worker/);
  }
  assert.equal(requests, 0);
});
test("correction displays original and selected spans separately and explicitly keeps the binding at the original start", () => {
  const c = new AttendanceShiftRuleViewClient({ source: source(true), ownerId, apiFetch });
  const html = renderToStaticMarkup(createElement(AttendanceShiftRuleAnchor, { anchor: c.anchors[0] }));
  assert.match(html, /原始班次 UTC：2026-09-02T08:00:00.000000Z/); assert.match(html, /当前核定 UTC：2026-09-02T09:00:00.000000Z/);
  assert.match(html, /不会重新绑定补正后的起点/); assert(html.includes(q.startEventId)); assert.equal(requests, 0);
});
test("missing and unverified never show a fabricated rule card or browser hash-verification claim", () => {
  const missing = detail(response("missing")); assert.match(missing, /data-shift-rule-status="missing"/); assert.match(missing, /没有已保存的规则或历史登录身份依据/);
  assert.match(missing, /不回填当前规则/); assert.doesNotMatch(missing, /data-shift-rule-field|保存来源已由服务端核验/);
  const unverified = detail(response("unverified")); assert.match(unverified, /data-shift-rule-status="unverified"/); assert.match(unverified, /容量已达上限/);
  assert.doesNotMatch(unverified, /data-shift-rule-field|浏览器.*已验证/);
});
test("every immutable unverified reason has a specific visible label", () => {
  assert.equal(Object.keys(SHIFT_RULE_REVIEW_REASON_LABELS).length, 14);
  for (const [reason, label] of Object.entries(SHIFT_RULE_REVIEW_REASON_LABELS)) {
    const raw = shiftRuleViewHttp("unverified"); raw.data.reason = reason;
    assert(detail(parseShiftRuleViewResponse(raw, q, ownerId)).includes(label));
  }
});
test("verified distinguishes zero, disabled and unconfigured, and preserves full layer provenance", () => {
  const html = detail(); assert.equal(count(html, "data-shift-rule-field="), 4); assert.match(html, /0 分钟（明确数值）/);
  assert.match(html, /明确停用（不是 0）/); assert.match(html, /未配置（不是 0 或正常）/); assert.match(html, /没有适用个人核准/); assert.match(html, /当时没有适用归组/);
  assert.match(html, /没有重新核验完整来源字节/); assert.match(html, /已核验不等于规则均已配置或出勤正常/);
  assert.match(html, /企业层：本层未设值（没有更低层，不补默认值）/);
  assert.match(html, /<details><summary[^>]*>核对身份、事件与保存版本<\/summary>/);
  const layers = detail(response("verified", true)); for (const op of [id(40), id(32), id(21)]) assert(layers.includes(op));
  assert.match(layers, /个人层/); assert.match(layers, /考勤组层/); assert.match(layers, /企业层/);
  assert.equal(count(layers, "核对完整三层来源"), 4); assert.match(layers, /企业账本 4/); assert.match(layers, /个人账本 3/);
});
test("location and corporate saved zones, original channel and historical versions remain distinct; HTML is escaped", () => {
  const raw = shiftRuleViewHttp(); raw.data.worker.workerName = "<img src=x onerror=alert(1)>"; raw.moduleEnabled = false;
  raw.data.worker.active = false; raw.data.worker.employeeActive = false;
  const html = detail(parseShiftRuleViewResponse(raw, q, ownerId)); assert.match(html, /&lt;img/); assert.doesNotMatch(html, /<img/);
  assert.match(html, /保存的企业时区：Europe\/Madrid/); assert.match(html, /不必等于原始地点时区/); assert.match(html, /UTC/);
  assert.match(html, /员工自助/); assert.match(html, /员工 2 · 设置 3/); assert.match(html, /新考勤已暂停/); assert.match(html, /成员停用/);
  assert.match(html, /不是本次事件编号/);
});
test("owned source contract keeps reference-key reset, synchronous hidden cleanup and explicit-only reads without node runtime imports", () => {
  const ui = readFileSync(new URL("../components/enterprise/MerchantAttendanceShiftRuleReview.tsx", import.meta.url), "utf8");
  const transport = readFileSync(new URL("./merchantAttendanceShiftRuleViewClient.ts", import.meta.url), "utf8");
  for (const text of ["identity.source !== props.source", "identity.apiFetch !== props.apiFetch", "identity.ownerId !== props.ownerId", "<Prepared key={identity.key}",
    "useLayoutEffect", "flushSync(hide)", 'window.addEventListener("pagehide", onHide)', 'window.removeEventListener("pagehide", onHide)', "client.pause()", "if (lease !== generation.current) return"]) assert(ui.includes(text));
  assert.doesNotMatch(ui + transport, /localStorage|sessionStorage|setInterval|node:crypto|\.server["']/);
  assert(transport.includes("result.event.occurredAt !== anchor.original.startAt")); assert(transport.includes("result.event.timeZone !== anchor.original.timeZone"));
  assert.equal(requests, 0);
});
