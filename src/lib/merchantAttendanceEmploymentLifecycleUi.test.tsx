import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup as render } from "react-dom/server";
import Launcher, { employmentLifecycleLauncherVisible } from "../components/enterprise/MerchantAttendanceEmploymentLifecycleLauncher";
import Panel, { EmploymentLifecycleDetailView, EmploymentLifecycleReceiptView, EmploymentLifecycleWorkerView,
  employmentLifecycleReady, employmentLifecycleReasonValid, confirmEmploymentLifecycle } from "../components/enterprise/MerchantAttendanceEmploymentLifecyclePanel";
import { parseEmploymentLifecycleResponse } from "./merchantAttendanceEmploymentLifecycle";
import { employmentLifecycleId as id, employmentLifecycleOwner as owner, employmentLifecycleSite as site, employmentLifecycleWorker as worker,
  employmentLifecycleDetail as detail, employmentLifecycleQuery as query, employmentLifecycleHttp as http,
  employmentLifecycleReceiptHttp as receiptHttp, employmentLifecycleCommand as command } from "../../scripts/fixtures/attendance-employment-lifecycle-model";
const file = (name: string) => readFileSync(new URL(name, import.meta.url), "utf8"), noop = () => {};

test("default-off launcher has no visible new action or automatic API, global entry owns recovery discovery", () => {
  let calls = 0; const props = { siteId: site, ownerId: owner, apiFetch: async () => { calls++; throw Error("unexpected"); } };
  assert.equal(render(<Launcher {...props} enabled={false}/>), ""); assert.equal(render(<Launcher {...props} enabled={false} workerId={worker}/>), "");
  assert.match(render(<Launcher {...props} enabled/>), /任职结束／再入职/); assert.match(render(<Launcher {...props} enabled workerId={worker}/>), /核验任职期/);
  assert.equal(render(<Launcher {...props} enabled active={false}/>), ""); assert.match(render(<Panel {...props} enabled onClose={noop}/>), /读取任职人员列表/);
  assert.match(render(<Panel {...props} workerId={worker} enabled={false} onClose={noop}/>), /读取该人员任职依据/); assert.equal(calls, 0);
});

test("flag-off exact pending or open receipt stays reachable only in appropriate launcher lifetime", () => {
  assert(employmentLifecycleLauncherVisible(false, true, false, null)); assert(!employmentLifecycleLauncherVisible(false, true, false, worker));
  assert(employmentLifecycleLauncherVisible(false, false, true, worker)); assert(employmentLifecycleLauncherVisible(false, false, true, null));
  assert(!employmentLifecycleLauncherVisible(false, false, false, null)); assert(employmentLifecycleLauncherVisible(true, false, false, worker));
});

test("parsed close preview shows server day, zone, versions and all saved periods without browser date rewriting", () => {
  const r = parseEmploymentLifecycleResponse(http(), query(), owner); assert(r.detail);
  const html = render(<EmploymentLifecycleDetailView detail={r.detail}/>);
  for (const text of ["2026-10-06", "Europe/Madrid", "人员版本 4", "员工版本 3", "设置版本 7", "代际 2", "2026-01-01", "结束日包含当天", "原始状态", "本页不改变事件或序列"] ) assert(html.includes(text));
  assert(!html.includes("<img>")); assert(html.includes("&lt;img&gt;")); assert(!html.includes('type="date"'));
});

test("explicit reason and confirmation are necessary for each eligible action", () => {
  for (const action of ["close", "rejoin"] as const) { const d = detail(action);
    assert(employmentLifecycleReady(d, action, "已核验", true)); assert(!employmentLifecycleReady(d, action, "已核验", false));
    assert(!employmentLifecycleReady(d, action, "", true)); assert(!employmentLifecycleReady(d, action, "已核验", true, true));
    assert(!employmentLifecycleReady(d, action === "close" ? "rejoin" : "close", "已核验", true));
    const html = render(<EmploymentLifecycleDetailView detail={d}/>); assert(html.includes(action === "close" ? "明确结束当日任职" : "明确新增当日任职期"));
  }
  for (const reason of ["", " a", "a ", "a\nb", "x".repeat(501)]) assert(!employmentLifecycleReasonValid(reason)); assert(employmentLifecycleReasonValid("x".repeat(500)));
});

test("every lifecycle blocker disables new action and never becomes automatic cancellation or clock-out", () => {
  const codes = ["binding_changed", "not_paused", "worker_active", "state_binding_changed", "open_session", "history_limit", "history_uncontrolled",
    "employment_closed", "employment_open", "date_not_after_end", "date_out_of_range", "pending_items", "pending_limit"];
  for (const code of codes) { const d = detail(); d.canClose = false; d.closeBlockers = [code];
    assert(!employmentLifecycleReady(d, "close", "已核验", true)); const html = render(<EmploymentLifecycleDetailView detail={d}/>);
    assert(!html.includes("明确结束当日任职")); assert(!html.includes("明确新增当日任职期"));
  }
  for (const patch of [{ suspension: null }, { worker: { ...detail().worker, active: true } }, { currentAction: "break_start" as const },
    { worker: { ...detail().worker, employeeAuthUserId: null } }]) assert(!employmentLifecycleReady({ ...detail(), ...patch }, "close", "已核验", true));
});

test("future schedule, leave and all three work kinds retain exact saved endpoints with honest navigation guidance", () => {
  const d = detail(); d.canClose = false; d.closeBlockers = ["pending_items"];
  d.pending.items = (["schedule", "leave", "trip", "field", "remote"] as const).map((kind, n) => ({ id: id(100 + n), kind, status: kind === "schedule" ? "published" : n % 2 ? "submitted" : "approved",
    startAt: "2026-10-07T06:00:00.000Z", endAt: "2026-10-07T08:00:00.000Z", timeZone: n ? "Europe/Madrid" : "UTC" }));
  const r = http(); r.detail = d; const parsed = parseEmploymentLifecycleResponse(r, query(), owner); assert(parsed.detail);
  const html = render(<EmploymentLifecycleDetailView detail={parsed.detail}/>);
  for (const item of d.pending.items) assert(html.includes(item.id));
  for (const text of ["排班", "请假", "出差", "外勤", "远程", "待审", "已批准", "2026-10-07T06:00:00.000Z", "事项时区 UTC", "关闭本工作区", "不会自动取消、拒绝、补下班"]) assert(html.includes(text));
  assert(!html.includes("<button")); assert(!html.includes("href="));
});

test("limited future results and uncounted historical pending are never displayed as zero", () => {
  const d = detail(); d.canClose = false; d.closeBlockers = ["pending_limit"]; d.pending.limited = true;
  const html = render(<EmploymentLifecycleDetailView detail={d}/>); assert.match(html, /清单未展示；不能视为没有阻断/);
  assert.match(html, /历史待审未统计/); assert.match(html, /其他浏览器的未知编号不可观察/); assert(!html.includes("本次未读到尚未结束"));
});

test("same-day closed personnel cannot rejoin, and inactive originals never imply automatic enablement", () => {
  const d = detail("rejoin"); d.periods[0].endsOn = d.today; d.canRejoin = false; d.rejoinBlockers = ["date_not_after_end"]; d.suspension!.wasActive = false;
  const r = http("detail", "rejoin"); r.detail = d; assert(parseEmploymentLifecycleResponse(r, query(), owner).detail);
  const html = render(<EmploymentLifecycleDetailView detail={d}/>); assert.match(html, /不能同日再入职/); assert.match(html, /后续恢复也保持未启用/);
  assert(!html.includes("明确新增当日任职期")); assert(!html.includes("启用此考勤人员"));
  assert.match(render(<EmploymentLifecycleWorkerView worker={d.worker}/>), /考勤未启用/);
});

test("confirmed close and rejoin receipts are historical, not current rights or payroll results", async () => {
  for (const action of ["close", "rejoin"] as const) { const r = parseEmploymentLifecycleResponse(await receiptHttp(command(action)), query("recover"), owner); assert(r.receipt);
    const html = render(<EmploymentLifecycleReceiptView receipt={r.receipt}/>); assert(html.includes(action === "close" ? "原任职结束操作已确认" : "原再入职操作已确认"));
    assert.match(html, /不证明当前任职状态或打卡资格/); assert.match(html, /没有自动恢复其中任何一项/); assert(!html.includes("<button"));
  }
});

test("confirmation modal cannot submit after a synchronous identity/context transition", () => {
  let current = true, writes = 0; assert(!confirmEmploymentLifecycle(() => { current = false; return true; }, () => current, () => writes++)); assert.equal(writes, 0);
  current = true; assert(!confirmEmploymentLifecycle(() => false, () => current, () => writes++)); assert.equal(writes, 0);
  assert(confirmEmploymentLifecycle(() => true, () => current, () => writes++)); assert.equal(writes, 1);
});

test("panel clears hidden/unmounted context, protects drafts and shows only original pending ID", () => {
  const panel = file("../components/enterprise/MerchantAttendanceEmploymentLifecyclePanel.tsx"), launcher = file("../components/enterprise/MerchantAttendanceEmploymentLifecycleLauncher.tsx");
  for (const name of ["visibilitychange", "pagehide", "pageshow", "beforeunload"]) assert(panel.includes(name));
  assert.match(panel, /scope.current.apiFetch === apiFetch/); assert.match(panel, /client.getSnapshot\(\) === snapshot/); assert.match(panel, /generation !== epoch.current/);
  assert(!panel.includes("pending.command.reason")); assert(!panel.includes("pending.command.employeeAuthUserId")); assert(!panel.includes("client.retry")); assert(!panel.includes("localStorage"));
  assert.match(launcher, /sessionStorage.getItem\(employmentLifecyclePendingKey/); assert(!launcher.includes("sessionStorage.key("));
  assert.match(launcher, /queueMicrotask/); assert.match(launcher, /event.preventDefault\(\); event.stopPropagation\(\); close\(\)/);
  assert.match(launcher, /maxWidth: "calc\(100vw - 1rem\)"/);
});

test("only approved owner Admin entry points are wired with authorization epochs and no clock pending interlock", () => {
  const admin = file("../components/enterprise/MerchantAttendanceAdminPanel.tsx");
  assert.equal((admin.match(/<EmploymentLifecycleLauncher /g) ?? []).length, 2);
  assert.match(admin, /employment-lifecycle:.*state.authorizationEpoch/); assert.match(admin, /employment-lifecycle-worker:.*state.authorizationEpoch/);
  assert.match(admin, /NEXT_PUBLIC_FAOLLA_ATTENDANCE_EMPLOYMENT_LIFECYCLE_ENABLED === "1"/);
  assert.match(admin, /workerId=\{item.id\}/); assert(!admin.includes("employmentLifecyclePendingKey"));
  assert(!file("../components/enterprise/MerchantAttendanceSelfPanel.tsx").includes("employmentLifecyclePendingKey"));
  assert.match(admin, /启用此考勤人员/); assert.match(admin, /未下班时不允许停用或换地点/);
});
