import React from "react";
import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import ActivationPanel, { OperationalConsumerActivationControls, activationReasonValid, confirmActivationAction, operationalConsumerPublicEnabled } from "../components/enterprise/MerchantAttendanceOperationalConsumerActivationPanel";
import ActivationLauncher, { operationalConsumerActivationLauncherVisible } from "../components/enterprise/MerchantAttendanceOperationalConsumerActivationLauncher";
import { AttendanceRecoveryReceiptView, KnownAttendanceRecoveryEntry } from "../components/enterprise/MerchantAttendanceDelegationRecoveryPanel";
import type { OperationalConsumerActivationClientState } from "./merchantAttendanceOperationalConsumerActivationClient";
import * as f from "./merchantAttendanceOperationalConsumerActivationTestFixtures";
const state = (result = f.activationResult()): OperationalConsumerActivationClientState => ({ phase: "ready", query: f.activationQuery, result, pending: null, message: "合成状态" });

test("201 reminder activation UI is local/default-off with honest no-backfill wording and flagoff safe stop", async t => {
  const key = "NEXT_PUBLIC_FAOLLA_ATTENDANCE_REMINDERS_ENABLED", saved = process.env[key]; t.after(() => { if (saved === undefined) delete process.env[key]; else process.env[key] = saved; });
  delete process.env[key]; assert.equal(operationalConsumerPublicEnabled("reminders"), false); process.env[key] = "true"; assert.equal(operationalConsumerPublicEnabled("reminders"), false);
  let calls = 0; const props = { siteId: f.activationSite, actorId: f.activationActor, consumer: "reminders" as const, apiFetch: async () => { calls++; throw Error("must stay local"); }, readOnlyAvailable: true, isCurrentAuth: () => true, onClose: () => {} };
  const launcher = renderToStaticMarkup(<ActivationLauncher {...props}/>), panel = renderToStaticMarkup(<ActivationPanel {...props}/>);
  assert.match(launcher, /查看／停用站内提醒规则/); assert.match(panel, /站内提醒规则启用管理/); assert.match(panel, /不补发历史提醒/); assert.match(panel, /不启动定时任务/); assert.match(panel, /已停止计划不复活/); assert.equal(calls, 0);
  const command = { ...f.activationCommand(), consumer: "reminders" as const }, query = { ...f.activationQuery, consumer: "reminders" as const },
    result = { ...f.activationResult(await f.activationItem(command)), consumer: "reminders" as const },
    html = renderToStaticMarkup(<OperationalConsumerActivationControls consumer="reminders" state={{ ...state(result), query }} visible enabled={false} reason="明确停用"/>);
  assert.match(html, /disabled=""[^>]*>确认启用站内提醒规则/); assert.match(html, /<button class="[^"]*"[^>]*>确认停用站内提醒规则/);
  process.env[key] = "1"; assert.equal(operationalConsumerPublicEnabled("reminders"), true);
});

test("201 actual reminder activation host binds current owner/Auth/epoch and parent lanes; original recovery link includes reminders", () => {
  const admin = readFileSync(new URL("../components/enterprise/MerchantAttendanceAdminPanel.tsx", import.meta.url), "utf8"),
    entry = admin.slice(admin.indexOf("{authUserId === ownerId && isCurrentAuth && <OperationalConsumerActivationLauncher key={`reminders-activation:"), admin.indexOf("{authUserId === ownerId && <IndependentAdminLauncher"));
  assert(entry); for (const exact of ["state.authorizationEpoch", 'actorId={authUserId} consumer="reminders"', "isCurrentAuth={cycleAuthCurrent}", "enabled={remindersEnabled} readOnlyAvailable", "!cycleAuthCurrent()", "client.getSnapshot().pending", "parentDraft.current", "childGuards.current.size", "inlineWorkspaces.current.size", "window.sessionStorage.getItem(client.storageKey) === null", 'registerChild("reminders-activation")']) assert(entry.includes(exact), exact);
  const launcher = readFileSync(new URL("../components/enterprise/MerchantAttendanceOperationalConsumerActivationLauncher.tsx", import.meta.url), "utf8"), link = launcher.slice(launcher.indexOf("export function OperationalConsumerActivationRecoveryLink"), launcher.indexOf("/* eslint-disable react-hooks/refs"));
  assert.match(link, /"application_window", "review_routing", "timesheet_cycle", "reminders"/); assert.match(link, /attendance-recovery/); assert.doesNotMatch(link, /method: "POST"/);
  assert.match(launcher, /consumer === "reminders" \? process\.env\.NEXT_PUBLIC_FAOLLA_ATTENDANCE_REMINDERS_ENABLED === "1"/);
});
test("194 activation controls require explicit valid reason and fresh current; flagoff safe stop remains", async () => {
  assert.equal(activationReasonValid("明确理由"), true); assert.equal(activationReasonValid(" "), false);
  const html = renderToStaticMarkup(<OperationalConsumerActivationControls state={state(f.activationResult(await f.activationItem()))} visible enabled={false} reason="明确停用"/>);
  assert.match(html, /新启用已关闭/); assert.match(html, /disabled=""[^>]*>确认启用申请窗口规则/); assert.match(html, /<button class="[^"]*"[^>]*>确认停用申请窗口规则/);
  assert.equal(operationalConsumerActivationLauncherVisible(false, false, false, true), true); assert.equal(operationalConsumerActivationLauncherVisible(false, false, false), false);
});
test("194 receipts/hidden state do not render actionable CAS or caller draft", async () => {
  const saved = await f.activationSaved(), html = renderToStaticMarkup(<OperationalConsumerActivationControls state={state(saved)} visible enabled reason="不应出现"/>);
  assert.match(html, /原操作已确认/); assert.doesNotMatch(html, /textarea|确认启用申请窗口规则/);
  const hidden = renderToStaticMarkup(<OperationalConsumerActivationControls state={state(saved)} visible={false} enabled reason="秘密草稿"/>); assert.doesNotMatch(hidden, /秘密草稿|24200000|原操作已确认/);
});
test("194 confirmation rechecks identity/snapshot after dialog and cancellation sends nothing", () => {
  let current = true, calls = 0; assert.equal(confirmActivationAction(() => false, () => current, () => calls++), false);
  assert.equal(confirmActivationAction(() => { current = false; return true; }, () => current, () => calls++), false); assert.equal(calls, 0);
});
test("194 recovery entry and receipt are minimal, do not expose saved reason or grant ownership", async () => {
  const item = await f.activationItem(), html = renderToStaticMarkup(<><KnownAttendanceRecoveryEntry entry={{ kind: "operational-consumer-activation", siteId: f.activationSite, consumer: "application_window", authUserId: f.activationActor, storageKey: "synthetic", operationId: item.operationId, commandFingerprint: item.commandFingerprint }}/><AttendanceRecoveryReceiptView receipt={{ kind: "operational-consumer-activation", ...item }}/></>);
  assert.match(html, /业务规则消费启用原操作/); assert.match(html, /不恢复权限/); assert.doesNotMatch(html, new RegExp(item.reason));
});
test("194 actual owner/independent Auth hosts include isolated guarded entry and lifecycle fence", () => {
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
  assert.match(read("../components/enterprise/MerchantAttendanceAdminPanel.tsx"), /authUserId === ownerId && <OperationalConsumerActivationLauncher/);
  assert.match(read("../components/admin/MerchantEnterpriseManager.tsx"), /tab === "overview" && periodDelegationAuthId \? <MerchantAttendanceOperationalConsumerActivationRecoveryLink/);
  const panel = read("../components/enterprise/MerchantAttendanceOperationalConsumerActivationPanel.tsx"); assert.match(panel, /live\.current\.apiFetch !== apiFetch/); assert.match(panel, /flushSync/); assert.match(panel, /registerLeaveGuard\?\.\(leave\)/); assert.match(panel, /visibilitychange/);
});
test("198 optional consumer has its own zero-HTTP guarded entry and exact responsibility wording", () => {
  let calls = 0; const props = { siteId: f.activationSite, actorId: f.activationActor, consumer: "review_routing" as const, apiFetch: async () => { calls++; throw Error(); }, enabled: false, readOnlyAvailable: true, onClose: () => {} };
  const launcher = renderToStaticMarkup(<ActivationLauncher {...props}/>), panel = renderToStaticMarkup(<ActivationPanel {...props}/>);
  assert.match(launcher, /查看／停用办理责任规则/); assert.match(panel, /办理责任规则启用管理/); assert.match(panel, /不授予审批权/); assert.equal(calls, 0);
  const query = { ...f.activationQuery, consumer: "review_routing" as const }, result = { ...f.activationResult(), consumer: "review_routing" as const };
  const html = renderToStaticMarkup(<OperationalConsumerActivationControls consumer="review_routing" state={{ ...state(result), query }} visible enabled reason="明确启用"/>);
  assert.match(html, /确认启用办理责任规则/); assert.doesNotMatch(html, /确认启用申请窗口规则/);
  const admin = readFileSync(new URL("../components/enterprise/MerchantAttendanceAdminPanel.tsx", import.meta.url), "utf8");
  assert.match(admin, /consumer="review_routing"/); assert.match(admin, /registerChild\("review-routing-activation"\)/);
});


