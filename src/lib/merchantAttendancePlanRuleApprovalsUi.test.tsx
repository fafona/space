import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Review, { AttendancePlanRuleApprovalsDetail, confirmPlanRuleApproval } from "../components/enterprise/MerchantAttendancePlanRuleApprovals";
import { parsePlanRuleApprovalsResponse, PLAN_RULE_APPROVALS_BLOCKERS, PLAN_RULE_APPROVALS_KEYS } from "./merchantAttendancePlanRuleApprovals";
import type { SourcesResponse } from "./merchantAttendanceSources";
import { planRuleApprovalsHttp as http, planRuleApprovalsQuery as query, planRuleApprovalsActor as actor, planRuleApprovalsId as id } from "../../scripts/fixtures/attendance-plan-rule-approvals-model";
import { scheduleEvidenceWire, scheduleEvidenceSlot, parseScheduleEvidenceWire } from "../../scripts/fixtures/attendance-schedule-evidence-model";

let requests = 0;
const apiFetch = async (): Promise<Response> => { requests++; throw Error("SSR must not request"); };
function source(): SourcesResponse {
  const slot = http().data.slot, wire = scheduleEvidenceWire({ empty: true, query: { siteId: query().siteId, workerId: query().workerId, fromDate: slot.workDate, throughDate: slot.workDate }, asOf: http().data.readAt });
  wire.schedule.items = [scheduleEvidenceSlot(2, slot.startAt, slot.endAt, { id: slot.id, locationName: slot.locationName })];
  return { ...parseScheduleEvidenceWire(wire), moduleEnabled: true };
}
const render = (s = source(), enabled = true, ownerId = actor) => renderToStaticMarkup(createElement(Review, { source: s, ownerId, apiFetch, enabled }));
const detail = (v = http(), mode: "preview" | "read" | "recover" | "approve" = "preview") => renderToStaticMarkup(createElement(AttendancePlanRuleApprovalsDetail, { result: parsePlanRuleApprovalsResponse(v, query(mode), actor) }));
const count = (html: string, marker: string) => html.split(marker).length - 1;

test("exact default-off and SSR remain inert; enabled form starts blank without automatically selecting/approving", () => {
  const key = "NEXT_PUBLIC_FAOLLA_ATTENDANCE_PLAN_RULE_APPROVALS_ENABLED", previous = process.env[key];
  try {
    for (const value of [undefined, "0", "true", " 1"]) { if (value === undefined) delete process.env[key]; else process.env[key] = value;
      assert.equal(renderToStaticMarkup(createElement(Review, { source: source(), ownerId: actor, apiFetch })), ""); }
    process.env[key] = "1"; assert.match(renderToStaticMarkup(createElement(Review, { source: source(), ownerId: actor, apiFetch })), /排班规则核准/);
    assert.equal(render(undefined, false), ""); const html = render(); assert.match(html, /aria-label="选择核准排班"/); assert.match(html, /value="" selected=""/);
    assert.equal(count(html, "<option"), 2); assert.match(html, /disabled="">确认核准本排班规则/); assert.match(html, /核对原编号|原号命令/);
    assert.match(html, /预览排班规则/); assert.match(html, /读取已核准规则/); assert.doesNotMatch(html, /data-plan-rule-detail|<form/); assert.equal(requests, 0);
  } finally { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; }
});
test("invalid identity/anchors are isolated from the old parent, limited and empty do not imply absence", () => {
  for (const html of [render({} as SourcesResponse), render(source(), true, id(88))]) { assert.match(html, /role="alert"/); assert.doesNotMatch(html, /<select|data-plan-rule-detail/); }
  const s = source(); s.schedule = { limited: true, items: [] }; assert.match(render(s), /排班列表不完整/); assert.equal(count(render(s), "<option"), 1);
  s.schedule.limited = false; assert.match(render(s), /不代表没有出勤/); assert.equal(requests, 0);
});
test("preview exposes only two fields with zero and complete three-layer provenance, never calls it an approval", () => {
  const html = detail(); assert.match(html, /data-plan-rule-detail="preview"/); assert.match(html, /预览（尚未核准）/);
  assert.equal(count(html, "data-plan-rule-field="), 2); assert.match(html, /0 分钟（明确数值）/); assert.match(html, /5 分钟（明确数值）/);
  assert.equal(count(html, "核对完整三层来源"), 2); for (const text of ["个人核准层", "考勤组层", "企业层", "继承下一层", "原负责人", "组版本", "成员身份", "地点版本", "Europe/Madrid", "UTC", "owner-approved-plan-start-v1"]) assert(html.includes(text), text);
  assert.doesNotMatch(html, /已保存的排班规则核准|sourceText|<pre|openSpanWarningMinutes|completedBreakMinimumMinutes/);
});
test("disabled, inherited and unconfigured are distinct and enterprise inherit never implies a lower layer", () => {
  const disabled = http(), s = disabled.data.preview!.source!; s.group!.publication!.rules.lateGraceMinutes = { mode: "disabled" };
  const f = s.fields.lateGraceMinutes; f.state = "disabled"; f.minutes = null; f.trace[1].mode = "disabled"; f.trace[1].minutes = null;
  const html = detail(disabled); assert.match(html, /data-rule-state="disabled"/); assert.match(html, /明确停用（不继承下一层）/);
  const empty = http(), e = empty.data.preview!.source!;
  for (const key of PLAN_RULE_APPROVALS_KEYS) {
    for (const item of [e.personal.approval!, e.group!.publication!, e.enterprise.publication!]) item.rules[key] = { mode: "inherit" };
    e.fields[key].state = "unconfigured"; e.fields[key].minutes = null; e.fields[key].source = null;
    for (const trace of e.fields[key].trace) { trace.mode = "inherit"; trace.minutes = null; }
  }
  const missing = detail(empty); assert.match(missing, /未配置（未知，不补默认值或 0）/); assert.match(missing, /本层未设值（没有更低层，不补默认值）/);
  assert.equal(count(missing, "data-rule-state=\"unconfigured\""), 2);
});
test("missing personal approval, no assignment and missing publication are explicitly different", () => {
  const v = http(), s = v.data.preview!.source!; s.assignment = null; s.group = null; s.personal.approval = null; s.enterprise.publication = null;
  for (const key of PLAN_RULE_APPROVALS_KEYS) {
    const f = s.fields[key]; f.state = "unconfigured"; f.source = null; f.minutes = null;
    for (const t of f.trace) { t.mode = t.layer === "personal" ? "missing_approval" : t.layer === "group" ? "no_assignment" : "missing_publication";
      t.source = null; t.minutes = null; if (t.layer === "group") { t.groupId = null; t.ledgerRevision = null; } }
  }
  const html = detail(v); for (const text of ["此时没有适用个人核准", "此时没有适用归组", "此时没有适用候选发布", "未知，不补默认值或 0"]) assert(html.includes(text), text);
});
test("all blockers are understandable; source-switch preview remains explicitly ineligible despite available initial fields", () => {
  for (const blocker of PLAN_RULE_APPROVALS_BLOCKERS) {
    const v = http(); if (blocker === "module_paused") v.moduleEnabled = false;
    const p = v.data.preview!; p.eligible = false; p.blockers = [blocker]; if (blocker !== "source_switch") { p.source = null; p.fingerprint = null; }
    const html = detail(v); assert.match(html, /当前不能核准/); assert.match(html, /aria-label="核准限制"/); assert.doesNotMatch(html, /<li><\/li>/);
    if (blocker === "source_switch") { assert.match(html, /同值不同来源版本/); assert.match(html, /data-plan-rule-field/); }
  }
});
test("saved approval uses historical actor, escaped reason/name, immutable versions and hash with no signature claim", () => {
  const v = http("read", false); v.data.approval!.actorId = id(88); v.data.approval!.command.reason = "<img src=x onerror=alert(1)>";
  v.data.approval!.source.assignment!.groupName = "<script>group</script>"; v.data.worker.workerName = "<svg onload=evil()>"; v.data.slot.cancelled = true;
  const html = detail(v, "read"); assert.match(html, /data-plan-rule-detail="approval"/); assert.match(html, /已保存的排班规则核准/); assert.match(html, /原核准负责人/); assert(html.includes(id(88)));
  assert.match(html, /&lt;img/); assert.match(html, /&lt;script/); assert.match(html, /&lt;svg/); assert.doesNotMatch(html, /<img|<svg|<script|sourceText|<pre/);
  assert.match(html, /模块已暂停/); assert.match(html, /当前排班已取消，保留原核准依据/); assert.match(html, /不是签名/); assert.match(html, /不是整期考勤结果/);
});
test("confirmation cancellation or changed epoch/result before or during dialog cannot submit", () => {
  let approved = 0, current = true, dialogs = 0;
  const submit = () => { approved++; };
  assert.equal(confirmPlanRuleApproval(() => { dialogs++; return true; }, () => false, submit), false); assert.equal(dialogs, 0);
  assert.equal(confirmPlanRuleApproval(() => false, () => current, submit), false); assert.equal(approved, 0);
  assert.equal(confirmPlanRuleApproval(() => { current = false; return true; }, () => current, submit), false); assert.equal(approved, 0);
  current = true; assert.equal(confirmPlanRuleApproval(() => true, () => current, submit), true); assert.equal(approved, 1);
});
test("lifetime and bounded UI contracts clear source/owner/api/flag changes and hidden inputs without auto HTTP", () => {
  const ui = readFileSync(new URL("../components/enterprise/MerchantAttendancePlanRuleApprovals.tsx", import.meta.url), "utf8"), client = readFileSync(new URL("./merchantAttendancePlanRuleApprovalsClient.ts", import.meta.url), "utf8");
  for (const text of ["identity.source !== props.source", "identity.ownerId !== props.ownerId", "identity.apiFetch !== props.apiFetch", "identity.enabled !== props.enabled", "<Prepared key={identity.key}",
    "flushSync(clear)", 'window.addEventListener("pagehide", hide)', 'window.removeEventListener("pagehide", hide)', 'setSelected("")', 'setReason("")', 'setOperationId("")', "client.getSnapshot() === snapshot", "generation.current === token"]) assert(ui.includes(text), text);
  assert.match(ui, /min-w-0/); assert.match(ui, /max-w-full/); assert.match(ui, /break-all/); assert.match(ui, /\[1-8\]/); assert.doesNotMatch(ui + client, /localStorage|setInterval|node:crypto|\.server["']/);
  const initialize = client.slice(client.indexOf("initialize = async"), client.indexOf("private query(")); assert.doesNotMatch(initialize, /await request|apiFetch\(/);
  assert.doesNotMatch(client, /retry\s*=/); assert.equal(requests, 0);
});
test("SourcesPanel only adds the independent default-off child and corrects its explicit-write/storage boundary", () => {
  const panel = readFileSync(new URL("../components/enterprise/MerchantAttendanceSourcesPanel.tsx", import.meta.url), "utf8");
  assert.match(panel, /import PlanRuleApprovals from "\.\/MerchantAttendancePlanRuleApprovals"/);
  assert.match(panel, /<PlanRuleApprovals source=\{r\} ownerId=\{ownerId\} apiFetch=\{apiFetch\}\/>/); assert.doesNotMatch(panel, /<PlanRuleApprovals[^>]*enabled/);
  assert.match(panel, /独立开放的排班规则核准/); assert.match(panel, /本标签页.*待核验命令/);
  assert.doesNotMatch(panel, /也不保存或发布规则|本页不轮询、不导出、不使用浏览器存储/);
});
