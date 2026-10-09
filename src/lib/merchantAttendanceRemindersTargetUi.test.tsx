//One finite SOURCE/SSR contract, not a mounted browser or real authorization.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup as render } from "react-dom/server";
import { ReminderTargetView } from "../components/enterprise/MerchantAttendanceRemindersPanel";
import Workspace, { reminderCorrectionTarget } from "../components/enterprise/MerchantAttendanceReminderCorrectionWorkspace";
import type { ReminderReviewTarget } from "./merchantAttendanceRemindersNavigation";
const id = (n: number) => `20100000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const target: ReminderReviewTarget = { kind: "pending_review", family: "correction", requestId: id(1), responsibilityRevision: 1, responsibilityOperationId: id(2) };
test("201 self session and one correction delegate selector have real capability-specific, guarded, explicit-read hosts", () => {
  let calls = 0;
  const self = { kind: "open_session" as const, workerId: id(3), startEventId: id(4) };
  assert.match(render(<ReminderTargetView target={self} destination="self" canOpen disabled={false} onOpen={() => { calls++; }}/>), /重新核验并打开本人当前班次/);
  assert.doesNotMatch(render(<ReminderTargetView target={self} destination="self" canOpen={false} disabled={false} onOpen={() => { calls++; }}/>), /<button/);
  assert.match(render(<ReminderTargetView target={target} destination="delegate" canOpen disabled={false} onOpen={() => { calls++; }}/>), /需重新选择授权/);
  for (const family of ["leave", "work_arrangement", "correction_revision", "missing", "missing_revision"] as const)
    assert.doesNotMatch(render(<ReminderTargetView target={{ ...target, family }} destination="delegate" canOpen disabled={false} onOpen={() => { calls++; }}/>), /<button/);
  assert.deepEqual(reminderCorrectionTarget(target), target);
  assert.throws(() => reminderCorrectionTarget({ ...target, family: "leave" }));
  const extra = { ...target }; Reflect.set(extra, "grantId", id(8)); assert.throws(() => reminderCorrectionTarget(extra));
  const html = render(<Workspace siteId="99990201" employeeId={id(5)} authUserId={id(6)} target={target} apiFetch={async () => { calls++; throw Error(); }}
    enabled isCurrentAuth={() => true} registerLeaveGuard={() => {}} onClose={() => { calls++; }}/>);
  assert.match(html, /目标申请/); assert.match(html, /不自动选择、翻页、审批或标记已读/); assert.equal(calls, 0);
  assert.equal(render(<Workspace siteId="99990201" employeeId={id(5)} authUserId={id(6)} target={target} apiFetch={async () => { calls++; throw Error(); }}
    enabled={false} isCurrentAuth={() => true} registerLeaveGuard={() => {}} onClose={() => {}}/>), "");
  const wrapper = readFileSync(new URL("../components/enterprise/MerchantAttendanceReminderCorrectionWorkspace.tsx", import.meta.url), "utf8");
  assert.match(wrapper, /const Panel = lazy/); assert.match(wrapper, /access="delegate" actorId=\{props.employeeId\} authUserId=\{props.authUserId\}/);
  assert.doesNotMatch(wrapper, /\.requests\(|\.detailRequest\(|\.load\(|\.submit\(|\.decide\(|fetch\(|sessionStorage|ownerId=|initialRequestId|grantId=/);
  const panel = readFileSync(new URL("../components/enterprise/MerchantAttendanceRemindersPanel.tsx", import.meta.url), "utf8");
  const recipient = panel.slice(panel.indexOf("const openRecipient ="), panel.indexOf("const busy ="));
  for (const value of ["selfNavigation.freshSession(target)", 'target.family === "correction"', "reminderOriginalTarget(target)", "token !== epoch.current", "raw()", "client.getSnapshot() !== selected"])
    assert(recipient.includes(value), value);
  assert.doesNotMatch(recipient, /submit\(|mark_read|freshOriginal|freshPeriod/);
  const host = readFileSync(new URL("../components/admin/MerchantEnterpriseManager.tsx", import.meta.url), "utf8");
  const methods = host.slice(host.indexOf("const reminderRecipientReady ="), host.indexOf("const settleWorkflowFocusRequest ="));
  for (const value of ['tab === "overview"', "canAutoRefreshOnFocus", 'actor?.type === "employee"', "periodDelegationAuthCurrent()", "value === own",
    'can(actor, "attendance.self.view")', "selection.employeeId !== actor.id", "selection.authUserId !== periodDelegationAuthId", "reminderSelfNavigationPendingKeys",
    'requestViewChange("attendance")', "token: periodDelegationToken + 1", 'target.family !== "correction"', 'correctionDelegationPendingKey(siteId, "delegate", actor.id)',
    "window.sessionStorage.getItem(key) !== null", "reminderCorrectionLeaveGuardRef.current = reservation", "attendanceLeaveGuardRef.current = reservation", "correctionLeaveGuardRef.current = reservation"])
    assert(methods.includes(value), value);
  assert.doesNotMatch(methods, /removeItem|\.submit\(|\.decide\(|fetch\(|ownerId=/);
  assert.match(host, /openOperationalOnMount=\{reminderSelfHint\?\.token === periodDelegationToken/);
  const launcher = readFileSync(new URL("../components/enterprise/MerchantAttendanceRemindersLauncher.tsx", import.meta.url), "utf8");
  assert.match(launcher, /value => handoff\(\(\) => props.onOpenSelfSession!/); assert.match(launcher, /target => handoff\(\(\) => props.onOpenDelegateTarget!/);
});
test("201 same-capability callback redraw does not reconstruct or pause the self reader", () => {
  const panel = readFileSync(new URL("../components/enterprise/MerchantAttendanceRemindersPanel.tsx", import.meta.url), "utf8");
  const reader = panel.slice(panel.indexOf("const selfNavigationEnabled ="), panel.indexOf("const snapshot ="));
  assert.match(reader, /const selfNavigationEnabled = !!selfEmployeeId && !!onOpenSelfSession && !recoveryOnly/);
  assert.match(reader, /\[siteId, actorId, selfEmployeeId, selfNavigationEnabled, apiFetch, current\]/);
  assert.doesNotMatch(reader, /\[[^\]]*onOpenSelfSession/);
  const callbackA = () => true, callbackB = () => false;
  assert.notEqual(callbackA, callbackB);
  const capability = (callback: (() => boolean) | undefined) => !!callback;
  assert.equal(capability(callbackA), capability(callbackB));
  assert.notEqual(capability(callbackA), capability(undefined));
  const recipient = panel.slice(panel.indexOf("const openRecipient ="), panel.indexOf("const busy ="));
  assert.match(recipient, /onOpenSelfSession\?\.\(self\)/);
  for (const guard of ["current()", "token !== epoch.current", "raw()", "client.getSnapshot() !== selected"]) assert(recipient.includes(guard), guard);
});
