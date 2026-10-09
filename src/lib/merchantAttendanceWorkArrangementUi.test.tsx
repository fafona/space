import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Launcher from "../components/enterprise/MerchantAttendanceWorkArrangementLauncher";
import Panel, { WorkArrangementConflicts, WorkArrangementDetailView, WorkArrangementForm, WorkArrangementPolicyForm,
  WorkArrangementReceipt, confirmWorkArrangementAction, sameWorkArrangementPreview, workArrangementReasonValid } from "../components/enterprise/MerchantAttendanceWorkArrangementPanel";
import { parseWorkArrangementResponse, resolveWorkArrangementInterval, type WorkArrangementCommand, type WorkArrangementConflict,
  type WorkArrangementDetail, type WorkArrangementKind } from "./merchantAttendanceWorkArrangement";
import { workArrangementHttp as http, workArrangementPreviewHttp as previewHttp, workArrangementReceiptHttp as receiptHttp,
  workArrangementDetail as detail, workArrangementQuery as query, workArrangementSpan as span, workArrangementId as id,
  workArrangementOwner as owner, workArrangementEmployee as employee } from "../../scripts/fixtures/attendance-work-arrangement-model";
const file = (name: string) => readFileSync(new URL(`../components/enterprise/${name}.tsx`, import.meta.url), "utf8");
const ownDetail = (patch: Partial<WorkArrangementDetail> = {}) => { const r = http("owner"); r.detail = { ...detail("owner"), ...patch };
  return parseWorkArrangementResponse(r, { ...query("owner"), requestId: r.detail.requestId }, null, { ownerId: owner }).detail!; };
const preview = () => parseWorkArrangementResponse(previewHttp(), { ...query(), preview: span() }, null, { employeeId: employee });
const baseDraft = () => ({ kind: "trip" as WorkArrangementKind, start: { local: "2026-10-05T09:00", offset: "+02:00" }, end: { local: "2026-10-05T17:00", offset: "+02:00" }, reason: "Synthetic trip", ack: true });
const no = () => {};
const conflict = (n: number): WorkArrangementConflict => ({ source: "leave", id: id(n), status: "approved", revision: 2, kind: null,
  startAt: span().startAt, endAt: span().endAt, timeZone: span().timeZone });
const submitButton = (html: string) => html.match(/<button[^>]*>明确提交工作安排<\/button>/)?.[0] ?? assert.fail("submit button missing");

test("default-off launcher has no entry, network or storage side effects during render", () => {
  let calls = 0; const apiFetch = async () => { calls++; throw Error("unexpected"); };
  for (const access of ["self", "owner"] as const) {
    const props = { siteId: query().siteId, access, actorId: access === "owner" ? owner : employee, apiFetch };
    assert.equal(renderToStaticMarkup(<Launcher {...props} enabled={false}/>), "");
    assert.equal(renderToStaticMarkup(<Launcher {...props} enabled active={false}/>), "");
    assert.match(renderToStaticMarkup(<Launcher {...props} enabled/>), access === "self" ? /我的出差／外勤／远程申请/ : /工作安排审批与政策/);
    const html = renderToStaticMarkup(<Panel {...props} enabled onClose={no}/>);
    assert.match(html, /读取工作安排首页/); assert(!html.includes("data-work-arrangement-detail"));
  }
  assert.equal(calls, 0);
});
test("disabled feature panel promises only explicit recovery, never guaranteed availability", () => {
  const html = renderToStaticMarkup(<Panel siteId={query().siteId} access="self" actorId={employee} enabled={false} apiFetch={async () => { throw Error("unexpected"); }} onClose={no}/>);
  assert.match(html, /仅明确核对原编号/); assert.match(html, /不能保证立即恢复/); assert.match(html, /不绕过定位、现场码或 PIN/);
  assert(!html.includes("明确提交工作安排"));
});
test("only exact server preview plus explicit acknowledgment enables a new application", () => {
  const r = preview();
  const render = (draft = baseDraft(), disabled = false) => renderToStaticMarkup(<WorkArrangementForm result={r} draft={draft} disabled={disabled} onDraft={no} onPreview={no} onSubmit={no}/>);
  assert(!submitButton(render()).includes(' disabled=""'));
  assert(submitButton(render({ ...baseDraft(), ack: false })).includes(' disabled=""'));
  assert(submitButton(render(baseDraft(), true)).includes(' disabled=""'));
  const changed = render({ ...baseDraft(), kind: "remote" });
  assert(submitButton(changed).includes(' disabled=""')); assert.match(changed, /原预览不再用于提交/);
  assert.match(render(), /区间经过 480 分钟，不是已工作时长/);
});
test("category selection begins empty, all three kinds remain distinct", () => {
  const r = parseWorkArrangementResponse(http(), query());
  const html = renderToStaticMarkup(<WorkArrangementForm result={r} draft={{ ...baseDraft(), kind: "", ack: false }} disabled={false} onDraft={no} onPreview={no} onSubmit={no}/>);
  assert.match(html, /<option value="" selected="">请选择类别/);
  for (const [key, label] of [["trip", "出差"], ["field", "外勤"], ["remote", "远程"]]) assert(html.includes(`<option value="${key}">${label}</option>`));
  assert(submitButton(html).includes(' disabled=""'));
});
test("DST fold asks for explicit offset and gaps never create a submit-ready interval", () => {
  const r = preview(), fold = { ...baseDraft(), start: { local: "2026-10-25T02:30", offset: "" } };
  const html = renderToStaticMarkup(<WorkArrangementForm result={r} draft={fold} disabled={false} onDraft={no} onPreview={no} onSubmit={no}/>);
  assert.match(html, /重复时刻：明确选择/); assert.match(html, /\+01:00/); assert.match(html, /\+02:00/); assert(submitButton(html).includes(' disabled=""'));
  assert.throws(() => resolveWorkArrangementInterval({ local: "2026-03-29T02:30", offset: "+01:00" }, { local: "2026-03-29T04:00", offset: "+02:00" }, "Europe/Madrid"));
  const left = resolveWorkArrangementInterval({ local: "2026-10-25T02:30", offset: "+02:00" }, { local: "2026-10-25T03:30", offset: "+01:00" }, "Europe/Madrid");
  assert.equal(left.startAt, "2026-10-25T00:30:00.000Z"); assert.equal(left.endAt, "2026-10-25T02:30:00.000Z");
});
test("preview equality binds category, zone and both UTC ends, not object order", () => {
  const a = span(); assert(sameWorkArrangementPreview(a, { endAt: a.endAt, kind: a.kind, startAt: a.startAt, timeZone: a.timeZone }));
  for (const patch of [{ kind: "remote" as const }, { timeZone: "UTC" }, { startAt: "2026-10-05T08:00:00.000Z" }, { endAt: "2026-10-05T16:00:00.000Z" }]) assert(!sameWorkArrangementPreview(a, { ...a, ...patch }));
  assert(!sameWorkArrangementPreview(a, null));
});
test("owner conflict approval has a separate explicit checkbox; conflicts are not automatic exemptions", () => {
  const d = ownDetail({ conflicts: [conflict(101)], issues: ["conflicts"] });
  const html = renderToStaticMarkup(<WorkArrangementDetailView detail={d} access="owner" disabled={false}/>);
  assert.match(html, /明确确认重叠资料/); assert.match(html, /不自动合并或重复计时/);
  assert.match(html, /明确批准申请/); assert.match(html, /明确驳回申请/); assert(!html.includes("明确撤回申请"));
  assert.match(html, /原编号 00000000-0000-4000-8000-000000000101/);
});
test("sealed or identity-blocked detail does not offer approval or bypass navigation", () => {
  const d = ownDetail({ sealed: true, issues: ["sealed"], canApprove: false });
  const html = renderToStaticMarkup(<WorkArrangementDetailView detail={d} access="owner" disabled={false}/>);
  assert(!html.includes("明确批准申请")); assert.match(html, /必须先通过现有周期入口明确重开/); assert.match(html, /明确驳回申请/);
  const blocked = ownDetail({ issues: ["binding_changed"], canApprove: false, canReject: false });
  assert(!renderToStaticMarkup(<WorkArrangementDetailView detail={blocked} access="owner"/>).includes("工作安排处理理由"));
});
test("self has withdrawal only and the complete available immutable history remains visible", () => {
  const r = http(); r.detail = detail(); const parsed = parseWorkArrangementResponse(r, { ...query(), requestId: r.detail.requestId }, null, { employeeId: employee });
  const html = renderToStaticMarkup(<WorkArrangementDetailView detail={parsed.detail!} access="self" disabled={false}/>);
  assert.match(html, /明确撤回申请/); assert(!html.includes("明确批准申请")); assert(!html.includes("明确取消批准"));
  assert.match(html, /申请与处理历史/); assert.match(html, /2026-10-04T09:00:00.000001Z/); assert(html.includes(id(10)));
});
test("approved detail offers append-only cancellation, while recovery receipt is explicitly historical", () => {
  const command: WorkArrangementCommand = { action: "approve", operationId: id(20), requestId: id(10), expectedRevision: 1, expectedConflictsFingerprint: "a".repeat(64), confirmConflicts: false, reason: "Approved synthetic trip" };
  const q = { ...query("owner"), requestId: id(10) }, r = parseWorkArrangementResponse(receiptHttp(command), q, command, { ownerId: owner });
  assert.match(renderToStaticMarkup(<WorkArrangementDetailView detail={r.detail!} access="owner"/>), /明确取消批准/);
  const recovered = parseWorkArrangementResponse(receiptHttp(command, false), { ...q, operationId: command.operationId }, null, { ownerId: owner });
  const html = renderToStaticMarkup(<WorkArrangementReceipt result={recovered}/>);
  assert.match(html, /当前条件未重新核查/); assert.match(html, /批准安排仍不是实际工时/); assert(html.includes(id(20))); assert(!html.includes("data-work-arrangement-detail"));
});
test("conflict pages are bounded to ten and all three sources remain separately labelled", () => {
  const d = ownDetail({ conflicts: Array.from({ length: 21 }, (_, n) => conflict(100 + n)), issues: ["conflicts"] });
  const html = renderToStaticMarkup(<WorkArrangementConflicts conflicts={d.conflicts}/>);
  assert.equal((html.match(/原编号/g) ?? []).length, 10); assert.match(html, /下一页冲突/); assert(!html.includes(id(110)));
  const mixed = ownDetail({ conflicts: [conflict(100), { ...conflict(101), source: "schedule", status: "scheduled", revision: 1 }, { ...conflict(102), source: "work_arrangement", kind: "remote" }], issues: ["conflicts"] });
  const text = renderToStaticMarkup(<WorkArrangementConflicts conflicts={mixed.conflicts}/>); for (const label of ["请假", "排班", "工作安排 · 远程"]) assert(text.includes(label));
});
test("policy renders an independent explicit 30-day default and does not borrow correction policy", () => {
  const r = parseWorkArrangementResponse(http("owner"), query("owner"), null, { ownerId: owner });
  const html = renderToStaticMarkup(<WorkArrangementPolicyForm result={r} disabled={false} onDirty={no} onSave={no}/>);
  assert.match(html, /默认最近 30 天/); assert.match(html, /允许 0–365 天/); assert.match(html, /不是法律期限/); assert.match(html, /不借用或修改请假／补正政策/);
  assert.match(html, /保存工作安排补申请政策/); assert.match(html, /min="0" max="365"/);
});
test("hostile names and reasons are escaped, saved UTC survives unavailable historical timezone rules", () => {
  const name = '<img src=x onerror="bad">', d = ownDetail({ workerName: name });
  const format = Intl.DateTimeFormat;
  try {
    Object.defineProperty(Intl, "DateTimeFormat", { configurable: true, writable: true, value: function () { throw Error("no current timezone lookup"); } });
    const html = renderToStaticMarkup(<WorkArrangementDetailView detail={d} access="owner"/>);
    assert(!html.includes("<img")); assert.match(html, /&lt;img/); assert(html.includes(d.startAt)); assert.match(html, /保存 UTC 为准/); assert.match(html, /break-all/);
  } finally { Object.defineProperty(Intl, "DateTimeFormat", { configurable: true, writable: true, value: format }); }
});
test("reason and confirmation guards reject mutation, reentry and accidental acceptance", () => {
  for (const reason of ["", " reason", "reason ", "a\nb", "x".repeat(201)]) assert(!workArrangementReasonValid(reason));
  assert(workArrangementReasonValid("理由")); let current = true, writes = 0;
  assert(!confirmWorkArrangementAction(() => { current = false; return true; }, () => current, () => writes++)); assert.equal(writes, 0);
  current = true; assert(!confirmWorkArrangementAction(() => false, () => current, () => writes++));
  assert(confirmWorkArrangementAction(() => true, () => current, () => writes++)); assert.equal(writes, 1);
});
test("parent integration is identity-epoch scoped, preserves period guard and never locks clocks", () => {
  const self = file("MerchantAttendanceSelfPanel"), admin = file("MerchantAttendanceAdminPanel");
  for (const value of [self, admin]) { assert.match(value, /NEXT_PUBLIC_FAOLLA_ATTENDANCE_WORK_ARRANGEMENTS_ENABLED === "1"/); assert.match(value, /work-arrangements:.*state.authorizationEpoch/); assert.match(value, /<WorkArrangementLauncher/); }
  assert.match(self, /registerLeaveGuard=\{registerWorkLeaveGuard\}/); assert.match(self, /beforeOpen=\{mayLeavePeriod\}/);
  assert.match(self, /guard \|\| eventNotificationsLeaveGuard.current \|\| scheduleDelegationLeaveGuard.current \|\| periodLeaveGuard.current \|\| delegationLeaveGuard.current \|\| applicationLeaveGuard.current \? combinedLeaveGuard : null/);
  assert.match(self, /\(!workLeaveGuard.current \|\| workLeaveGuard.current\(\)\) && \(!periodLeaveGuard.current \|\| periodLeaveGuard.current\(\)\)/);
  const clocks = self.slice(self.indexOf("const scheduleBlocked"), self.indexOf("const onScheduleConfirmed")); assert(!clocks.includes("workArrangement"));
  assert(!self.includes("workArrangementPendingKey")); assert(!admin.includes("workArrangementPendingKey"));
});
test("native Escape and parent navigation share the dirty guard; unknown recovery is GET only", () => {
  const launcher = file("MerchantAttendanceWorkArrangementLauncher"), panel = file("MerchantAttendanceWorkArrangementPanel");
  assert.match(launcher, /queueMicrotask/); assert.match(launcher, /onCancel=\{event => \{ event.preventDefault\(\); close\(\); \}\}/);
  assert.match(launcher, /event.preventDefault\(\); event.stopPropagation\(\); close\(\)/); assert.match(launcher, /else if \(!element.open\) element.showModal\(\)/);
  assert.match(launcher, /sessionStorage.getItem\(workArrangementPendingKey/); assert(!launcher.includes("sessionStorage.length"));
  assert.match(panel, /client.initialize\(\)/); assert.match(panel, /client.recover\(\)/); assert(!panel.includes("client.retry"));
  for (const event of ["pagehide", "pageshow", "visibilitychange", "beforeunload"]) assert(panel.includes(event));
  assert(!panel.includes("localStorage")); assert(!panel.includes("setInterval"));
  assert.match(panel, /const \[draft, setDraft\]/); assert.match(panel, /onPreview=\{value => read\(\(\) => \{ void client.preview\(value\); \}, false\)\}/);
});
