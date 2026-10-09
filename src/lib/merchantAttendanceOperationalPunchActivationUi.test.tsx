import React from "react";
import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { OperationalPunchActivationControls, activationReasonValid, confirmActivationAction } from "../components/enterprise/MerchantAttendanceOperationalPunchActivationPanel";
import { operationalPunchActivationLauncherVisible } from "../components/enterprise/MerchantAttendanceOperationalPunchActivationLauncher";
import { AttendanceRecoveryReceiptView, KnownAttendanceRecoveryEntry } from "../components/enterprise/MerchantAttendanceDelegationRecoveryPanel";
import type { OperationalPunchActivationClientState } from "./merchantAttendanceOperationalPunchActivationClient";
import * as f from "./merchantAttendanceOperationalPunchActivationTestFixtures";
const state = (result = f.activationResult()): OperationalPunchActivationClientState => ({ phase: "ready", query: f.activationQuery, result, pending: null, message: "合成状态" });
test("242 activation controls require explicit valid reason and fresh current; flagoff safe stop remains", async () => {
  assert.equal(activationReasonValid("明确理由"), true); assert.equal(activationReasonValid(" "), false);
  const html = renderToStaticMarkup(<OperationalPunchActivationControls state={state(f.activationResult(await f.activationItem()))} visible enabled={false} reason="明确停用"/>);
  assert.match(html, /新启用已关闭/); assert.match(html, /disabled=""[^>]*>确认启用在线规则开班/); assert.match(html, /<button class="[^"]*"[^>]*>确认停用新规则开班/);
  assert.equal(operationalPunchActivationLauncherVisible(false, false, false, true), true); assert.equal(operationalPunchActivationLauncherVisible(false, false, false), false);
});
test("242 receipts/hidden state do not render actionable CAS or caller draft", async () => {
  const saved = await f.activationSaved(), html = renderToStaticMarkup(<OperationalPunchActivationControls state={state(saved)} visible enabled reason="不应出现"/>);
  assert.match(html, /原操作已确认/); assert.doesNotMatch(html, /textarea|确认启用在线规则开班/);
  const hidden = renderToStaticMarkup(<OperationalPunchActivationControls state={state(saved)} visible={false} enabled reason="秘密草稿"/>); assert.doesNotMatch(hidden, /秘密草稿|24200000|原操作已确认/);
});
test("242 confirmation rechecks identity/snapshot after dialog and cancellation sends nothing", () => {
  let current = true, calls = 0; assert.equal(confirmActivationAction(() => false, () => current, () => calls++), false);
  assert.equal(confirmActivationAction(() => { current = false; return true; }, () => current, () => calls++), false); assert.equal(calls, 0);
});
test("242 recovery entry and receipt are minimal, do not expose saved reason or grant ownership", async () => {
  const item = await f.activationItem(), html = renderToStaticMarkup(<><KnownAttendanceRecoveryEntry entry={{ kind: "operational-punch-activation", siteId: f.activationSite, authUserId: f.activationActor, storageKey: "synthetic", operationId: item.operationId, commandFingerprint: item.commandFingerprint }}/><AttendanceRecoveryReceiptView receipt={{ kind: "operational-punch-activation", ...item }}/></>);
  assert.match(html, /在线规则启用原操作/); assert.match(html, /不恢复负责人资格/); assert.doesNotMatch(html, new RegExp(item.reason));
});
test("242 actual owner/independent Auth hosts include isolated guarded entry and lifecycle fence", () => {
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
  assert.match(read("../components/enterprise/MerchantAttendanceAdminPanel.tsx"), /authUserId === ownerId && <OperationalPunchActivationLauncher/);
  assert.match(read("../components/admin/MerchantEnterpriseManager.tsx"), /tab === "overview" && periodDelegationAuthId \? <MerchantAttendanceOperationalPunchActivationRecoveryLink/);
  const panel = read("../components/enterprise/MerchantAttendanceOperationalPunchActivationPanel.tsx"); assert.match(panel, /live\.current\.apiFetch !== apiFetch/); assert.match(panel, /flushSync/); assert.match(panel, /registerLeaveGuard\?\.\(leave\)/); assert.match(panel, /visibilitychange/);
});
