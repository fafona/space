import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Workspace, { PlanExceptionDetail, PlanExceptionEntry, confirmPlanExceptionAction } from "../components/enterprise/MerchantAttendancePlanExceptionWorkspace";
import { parsePlanExceptionResponse } from "./merchantAttendancePlanExceptions";
import { exceptionUiHttp as http, exceptionUiQuery as query, exceptionUiId as id, exceptionUiSite as site, exceptionUiOwner as owner,
  exceptionUiEmployee as employee, exceptionUiWorker as worker, exceptionUiSlot as slot } from "../../scripts/fixtures/attendance-plan-exception-ui-model";
const file = (name: string) => readFileSync(new URL(`../components/enterprise/${name}.tsx`, import.meta.url), "utf8");
const response = (options: Parameters<typeof http>[0] = {}) => parsePlanExceptionResponse(http(options), query(options.access, options.mode), options.access === "self" ? { employeeId: employee } : { ownerId: owner });
test("default-off owner keeps known-target recovery, self stays hidden, and rendering never fetches or submits", () => {
  let calls = 0; const apiFetch = async () => { calls++; throw Error("unexpected"); };
  assert.match(renderToStaticMarkup(<PlanExceptionEntry siteId={site} access="owner" actorId={owner} enabled={false} onOpen={() => { calls++; }}/>), /按已知人员／排班核对采用原号/);
  assert.equal(renderToStaticMarkup(<PlanExceptionEntry siteId={site} access="self" actorId={employee} enabled={false} onOpen={() => { calls++; }}/>), "");
  const html = renderToStaticMarkup(<Workspace siteId={site} access="owner" actorId={owner} apiFetch={apiFetch} enabled initialTarget={{ workerId: worker, slotId: slot }} onClose={() => { calls++; }}/>);
  assert.match(html, /读取本排班当前依据/); assert.match(html, /读取异常处理记录/); assert(!html.includes('data-plan-exception-detail')); assert.equal(calls, 0);
});
test("self workspace has an honest existing correction navigation only when supplied", () => {
  const props = { siteId: site, access: "self" as const, actorId: employee, enabled: true, apiFetch: async () => { throw Error("unexpected"); }, onClose: () => {} };
  const without = renderToStaticMarkup(<Workspace {...props}/>), withLink = renderToStaticMarkup(<Workspace {...props} onOpenCorrections={() => {}}/>);
  assert(!without.includes("打开我的补正申请")); assert.match(withLink, /打开我的补正申请/); assert(!withLink.includes("已定位原班次"));
});
test("owner detail keeps zero-valued grace, exact deltas and explicit reason separate from payroll", () => {
  const html = renderToStaticMarkup(<PlanExceptionDetail result={response()}/>);
  assert.match(html, /data-plan-exception-field="late" data-rule-state="triggered"/); assert.match(html, /0 分钟/);
  assert.match(html, /600000000/); assert.match(html, /本次人工核对资料/); assert.match(html, /不自动减免/);
  assert.match(html, /本排班采用的固定核准引用/); assert.match(html, /尚无保存的处理决定/);
});
test("blocked evidence is not none, absence or a fabricated normal result", () => {
  const html = renderToStaticMarkup(<PlanExceptionDetail result={response({ eligible: false })}/>);
  assert.match(html, /依据不足，未作判断/); assert.match(html, /没有明确关联班次（不等于未出勤）/); assert(!html.includes("出勤正常"));
});
test("self historical display explicitly says current evidence was not rechecked and read is not assent", () => {
  const html = renderToStaticMarkup(<PlanExceptionDetail result={response({ access: "self" })}/>);
  assert.match(html, /当前依据未重新核查/); assert.match(html, /已读不等于认可/); assert.match(html, /沉默不作同意/);
  assert.match(html, /保存时的相关资料引用/); assert(!html.includes("本次人工核对资料"));
});
test("owner stale evidence is distinct from the preserved prior decision", () => {
  const body = http({ saved: true }); body.data.detail!.current!.fingerprint = "c".repeat(64); body.data.detail!.stale = true;
  const parsed = parsePlanExceptionResponse(body, query(), { ownerId: owner }), html = renderToStaticMarkup(<PlanExceptionDetail result={parsed}/>);
  assert.match(html, /历史决定与当前依据已不同/); assert.match(html, /data-plan-exception-decision/); assert.match(html, /Synthetic explicit owner reason/);
});
test("hostile names/reasons are escaped, identifiers selectable, and narrow layout can wrap", () => {
  const value = structuredClone(response({ access: "self" })); value.detail!.latestDecision!.note = '<img src=x onerror="bad">';
  const html = renderToStaticMarkup(<PlanExceptionDetail result={value}/>); assert(!html.includes("<img")); assert.match(html, /&lt;img/);
  for (const text of [slot, worker, employee, id(900)]) assert(html.includes(text)); assert.match(html, /min-w-0/); assert.match(html, /break-all/);
});
test("history is bounded to ten rendered operations and local pagination does not fetch", () => {
  const value = structuredClone(response({ access: "self" })), base = value.detail!.history[0];
  value.detail!.history = Array.from({ length: 25 }, (_, i) => ({ ...base, operationId: id(1000 + i), revision: 25 - i, note: `history-row-${i}` }));
  const html = renderToStaticMarkup(<PlanExceptionDetail result={value}/>); assert.equal((html.match(/history-row-/g) ?? []).length, 10);
  assert.match(html, /处理历史本地分页/); assert(!html.includes("history-row-10"));
});
test("confirmation checks the current context both before and after native confirmation", () => {
  let active = true, sent = 0;
  assert.equal(confirmPlanExceptionAction(() => { active = false; return true; }, () => active, () => { sent++; }), false);
  assert.equal(sent, 0); active = true; assert.equal(confirmPlanExceptionAction(() => false, () => active, () => { sent++; }), false);
  assert(confirmPlanExceptionAction(() => true, () => active, () => { sent++; })); assert.equal(sent, 1);
});
test("actual Sources parent dates, refresh, close and native Esc share the new leave guard", () => {
  const panel = file("MerchantAttendanceSourcesPanel"), launcher = file("MerchantAttendanceSourcesLauncher");
  assert.match(panel, /registerLeaveGuard\?\.\(mayLeave\)/); assert.match(panel, /visible && mayLeave\(\)/);
  assert.equal((panel.match(/if \(mayLeave\(\)\)/g) ?? []).length, 3); assert.match(panel, /exceptionScope.apiFetch === apiFetch/);
  assert.match(panel, /exceptionTarget && visible/); assert.match(panel, /registerLeaveGuard=\{registerWorkflowGuard\}/);
  assert.match(launcher, /onCancel=\{event => \{ event.preventDefault\(\); close\(\); \}\}/);
  assert.match(launcher, /event.key === "Escape" && !event.defaultPrevented/); assert.match(launcher, /event.preventDefault\(\); event.stopPropagation\(\); close\(\)/);
  assert.match(launcher, /onClose=\{event => \{ if \(event.currentTarget === dialog.current\) close\(\); \}\}/);
  assert.match(launcher, /queueMicrotask\(\(\) =>/); assert.match(launcher, /!element \|\| closeRequested.current/);
  assert.match(launcher, /else if \(!element.open\) element.showModal\(\)/);
  assert.equal((launcher.match(/if \(dialog.current !== element\) return;/g) ?? []).length, 2);
});
test("existing PlanCoverage sends only an explicit anchor to a real workflow; old algorithms/clients remain", () => {
  const text = file("MerchantAttendancePlanCoverage"); assert.match(text, /NEXT_PUBLIC_FAOLLA_ATTENDANCE_PLAN_EXCEPTIONS_ENABLED === "1"/);
  assert.match(text, /处理本排班异常/); assert.match(text, /onOpenException\(\{ workerId: result.worker.workerId, slotId: result.slot.id \}\)/);
  assert.match(text, /adoptionEnabled \? new AttendancePlanCoverageAdoptionsClient/); assert.match(text, /: new AttendancePlanCoverageClient/);
});
test("owner/self actual entries are identity-epoch fenced, honest correction navigation, no new clock-write lock", () => {
  const self = file("MerchantAttendanceSelfPanel"), admin = file("MerchantAttendanceAdminPanel");
  for (const text of [self, admin]) { assert.match(text, /NEXT_PUBLIC_FAOLLA_ATTENDANCE_PLAN_EXCEPTIONS_ENABLED === "1"/); assert.match(text, /plan-exceptions:.*state.authorizationEpoch/); assert.match(text, /PlanExceptionEntry/); }
  assert.match(self, /onOpenCorrections=\{correctionWorkspaceEnabled \? \(\) => \{ setPlanExceptionOpen\(false\); setCorrectionOpen\(true\); \}/);
  const lock = self.slice(self.indexOf("const scheduleBlocked"), self.indexOf("const onScheduleConfirmed")); assert(!lock.includes("planException"));
  assert(!self.includes("initialStartEventId")); assert.match(admin, /registerLeaveGuard=\{registerChild\("plan-exception"\)\}/);
  assert.match(admin, /registerLeaveGuard\?\.\(\(\) =>/);
  assert.match(admin, /childGuards\.current\.values\(\)\]\.every\(guard => guard\(\)\)/);
});
test("workspace has explicit original-ID recovery and clearing controls, bounded sections and no hidden auto read", () => {
  const text = file("MerchantAttendancePlanExceptionWorkspace"); assert.match(text, /void client.initialize\(\)/); assert(!text.includes("void client.list();\n"));
  for (const s of ["核对原异常编号", "原编号核对并重试", "结束本次尝试", "明确已读处理结果", "pagehide", "pageshow", "beforeunload"]) assert(text.includes(s));
  assert.match(text, /d.latestDecision.readAt !== null \|\| note.length > 0/);
  assert.match(text, /!d.canNote \|\| !d.latestDecision/);
  assert(!text.includes("localStorage")); assert(!text.includes("setInterval")); assert.match(text, /slice\(page \* 10, page \* 10 \+ 10\)/);
});
