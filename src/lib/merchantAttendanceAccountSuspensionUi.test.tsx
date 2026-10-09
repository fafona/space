import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup as render } from "react-dom/server";
import Launcher from "../components/enterprise/MerchantAttendanceAccountSuspensionLauncher";
import Panel, { AccountSuspensionDetailView, AccountSuspensionIdentity, AccountSuspensionReceiptView, AccountStatusReceiptView,
  accountSuspensionReasonValid, accountSuspensionRestoreReady, confirmAccountSuspensionRestore } from "../components/enterprise/MerchantAttendanceAccountSuspensionPanel";
import { ACCOUNT_SUSPENSION_BLOCKERS, parseAccountSuspensionResponse } from "./merchantAttendanceAccountSuspension";
import { accountSuspensionOwner as owner, accountSuspensionSite as site, accountSuspensionItem as item, accountSuspensionDetail as detail,
  accountSuspensionQuery as query, accountSuspensionHttp as http, accountSuspensionReceiptHttp as receiptHttp, accountStatusReceiptHttp as statusHttp } from "../../scripts/fixtures/attendance-account-suspension-model";
const file = (name: string) => readFileSync(new URL(name, import.meta.url), "utf8");
const no = () => {};

test("safety entry is available with rollout off but never starts automatic reads", () => {
  let calls = 0; const props = { siteId: site, ownerId: owner, apiFetch: async () => { calls++; throw Error("unexpected"); } };
  assert.match(render(<Launcher {...props}/>), /考勤暂停待核验/);
  assert.equal(render(<Launcher {...props} active={false}/>), "");
  assert.match(render(<Panel {...props} onClose={no}/>), /读取当前暂停列表/);
  assert.equal(calls, 0);
});
test("detail is a real parsed contract and separates four results without fabricated counts", () => {
  const result = parseAccountSuspensionResponse(http("detail"), query("detail"), owner); assert(result.detail);
  const html = render(<AccountSuspensionDetailView detail={result.detail}/>);
  for (const label of ["企业账号", "暂停前考勤启用状态", "当前原始在班状态", "休息中", "旧 PIN", "须另行重新授予", "请假：未核查", "整段漏卡：未核查", "未知操作编号无法观测"]) assert(html.includes(label));
  assert(!html.includes("未知操作为0")); assert(!html.includes("全部处理完"));
  assert(!html.includes("<img>")); assert(html.includes("&lt;img&gt;"));
});
test("restore needs current eligibility reason and explicit identity confirmation", () => {
  const d = detail(); assert(accountSuspensionRestoreReady(d, "核验一致", true));
  assert(!accountSuspensionRestoreReady(d, "核验一致", false)); assert(!accountSuspensionRestoreReady(d, "", true));
  assert(!accountSuspensionRestoreReady(d, "核验一致", true, true));
  for (const blocker of ACCOUNT_SUSPENSION_BLOCKERS) {
    const value = { ...d, blockers: [blocker], canRestore: false };
    assert(!accountSuspensionRestoreReady(value, "核验一致", true)); assert(!render(<AccountSuspensionDetailView detail={value}/>).includes("明确解除考勤暂停"));
    assert(!accountSuspensionRestoreReady({ ...value, canRestore: true }, "核验一致", true));
  }
});
test("original inactive worker and pure delegate are never presented as enabled or newly created", () => {
  const d = detail(); d.suspension.wasActive = false;
  assert.match(render(<AccountSuspensionDetailView detail={d}/>), /原本未启用（解除后仍未启用）/);
  const x = item(); x.workerId = null; x.workerName = null; x.wasActive = null;
  assert.match(render(<AccountSuspensionIdentity item={x}/>), /无考勤人员档案/); assert.match(render(<AccountSuspensionIdentity item={x}/>), /不会自动创建/);
});
test("restore receipt is historical and does not claim current clock authority or credential restoration", async () => {
  const r = parseAccountSuspensionResponse(await receiptHttp(), query("recover"), owner); assert(r.receipt);
  const html = render(<AccountSuspensionReceiptView receipt={r.receipt}/>);
  assert.match(html, /不证明当前仍可打卡/); assert.match(html, /没有自动下班、设置 PIN 或重新授予委托/);
  assert(!html.includes("明确解除考勤暂停"));
  assert.match(render(<AccountSuspensionReceiptView receipt={{ ...r.receipt, workerActive: false }}/>), /保持原本未启用/);
  assert.match(render(<AccountSuspensionReceiptView receipt={{ ...r.receipt, workerId: null, workerActive: null }}/>), /无考勤档案，未创建人员/);
});
test("status receipt distinguishes account lifecycle from attendance result", async () => {
  const r = parseAccountSuspensionResponse(await statusHttp(), query("recover-status"), owner); assert(r.statusReceipt);
  const html = render(<AccountStatusReceiptView receipt={r.statusReceipt}/>); assert.match(html, /企业账号停用原操作已确认/); assert.match(html, /账号恢复不自动解除考勤暂停/);
  assert.match(render(<AccountStatusReceiptView receipt={{ ...r.statusReceipt, status: "active", suspensionId: null }}/>), /不能推断考勤已恢复/);
});
test("confirmation is cancelled by synchronous scope changes and reason is bounded", () => {
  let current = true, writes = 0;
  assert(!confirmAccountSuspensionRestore(() => { current = false; return true; }, () => current, () => writes++)); assert.equal(writes, 0);
  current = true; assert(confirmAccountSuspensionRestore(() => true, () => current, () => writes++)); assert.equal(writes, 1);
  for (const value of ["", " a", "a ", "a\nb", "x".repeat(501)]) assert(!accountSuspensionReasonValid(value)); assert(accountSuspensionReasonValid("x".repeat(500)));
});
test("hidden scope and modal fences preserve pending but never print pending command contents", () => {
  const panel = file("../components/enterprise/MerchantAttendanceAccountSuspensionPanel.tsx"), launcher = file("../components/enterprise/MerchantAttendanceAccountSuspensionLauncher.tsx");
  for (const name of ["visibilitychange", "pagehide", "pageshow", "beforeunload"]) assert(panel.includes(name));
  assert(!panel.includes("pending.command.reason")); assert(!panel.includes("client.retry")); assert(!panel.includes("localStorage"));
  assert.match(launcher, /queueMicrotask/); assert.match(launcher, /event.preventDefault\(\); event.stopPropagation\(\); close\(\)/);
  assert(!launcher.includes("NEXT_PUBLIC")); assert.match(launcher, /key=\{`\$\{props.siteId\}:\$\{props.ownerId\}`\}/);
});
test("real manager only dispatches status to new client and authenticates the caller not target", () => {
  const manager = file("../components/admin/MerchantEnterpriseManager.tsx");
  assert.match(manager, /currentAuthUserId\?: string \| null/);
  assert.match(manager, /setCurrentAuthUserId\(typeof payload.currentAuthUserId === "string" \? payload.currentAuthUserId : null\)/);
  assert(!manager.includes("snapshot.employees.find(employee => employee.id === actor.id)?.authUserId"));
  assert.match(manager, /actor\.type !== "owner" \|\| currentAuthUserId === actor.id/);
  assert.match(manager, /accountStatusScope.current.accountStatusAuthId = ""/);
  assert.match(manager, /NEXT_PUBLIC_FAOLLA_ATTENDANCE_ACCOUNT_SUSPENSION_ENABLED === "1"/);
  assert.match(manager, /if \(!accountSuspensionEnabled && !client\?\.hasLeaveRisk\(\)\) return false/);
  assert.match(manager, /!latest.pending && latest.result\?\.statusReceipt/);
  assert.match(manager, /员工账号已恢复。/); assert.match(manager, /offboardingMode: mode/);
  assert(!manager.includes("accountStatusClient.retry")); assert.match(manager, /accountStatusLifetime.current !== client/);
});
test("admin safety launcher keeps authorization epoch and does not alter ordinary active edits", () => {
  const admin = file("../components/enterprise/MerchantAttendanceAdminPanel.tsx");
  assert.match(admin, /account-suspensions:.*state.authorizationEpoch/); assert.match(admin, /AccountSuspensionLauncher/);
  assert.match(admin, /启用此考勤人员/); assert.match(admin, /未下班时不允许停用或换地点/);
  assert(!admin.includes("accountSuspensionPendingKey")); assert(!admin.includes("accountStatusPendingKey"));
});
