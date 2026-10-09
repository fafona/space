//Actual view SSR plus source-host contract; no mounted browser/real authority.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup as render } from "react-dom/server";
import { ReminderTargetView, reminderTargetLabel } from "../components/enterprise/MerchantAttendanceRemindersPanel";
import type { AttendanceReminderTarget } from "./merchantAttendanceReminders";
import CycleIntentPanel, { cycleIntentInitialId } from "../components/enterprise/MerchantAttendanceCycleIntentPanel";
const id = (n: number) => `20100000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const correction: AttendanceReminderTarget = { kind: "pending_review", family: "correction", requestId: id(1), responsibilityRevision: 1, responsibilityOperationId: id(1) };
const source = readFileSync(new URL("../components/enterprise/MerchantAttendanceRemindersPanel.tsx", import.meta.url), "utf8");
test("201 approved owner review/cycle targets expose actual fresh-original actions; unconnected self/recipient targets have no fake links", () => {
  const connected: AttendanceReminderTarget[] = [correction, { kind: "period_due", workerId: id(2), intentId: id(3) },
    ...(["correction_revision", "missing", "missing_revision", "leave", "work_arrangement"] as const).map(family => ({ ...correction, kind: "pending_review" as const, family }))];
  for (const target of connected) {
    const html = render(<ReminderTargetView target={target} canOpen disabled={false} onOpen={() => { throw Error(); }}/>); assert.match(html, /重新核验并打开(?:审批|周期意向)原入口/);
  }
  for (const target of [{ kind: "open_session" as const, workerId: id(2), startEventId: id(3) }]) {
    const view = render(<ReminderTargetView target={target} canOpen disabled={false} onOpen={() => { throw Error(); }}/>);
    assert.match(view, /原入口尚待接线/); assert.doesNotMatch(view, /<button|href=|自动批准/); assert.ok(reminderTargetLabel(target));
  }
  const noHost = render(<ReminderTargetView target={correction} canOpen={false} disabled={false} onOpen={() => { throw Error(); }}/>); assert.doesNotMatch(noHost, /<button/);
});
test("201 new navigation is explicit fresh GET with host-current snapshot fence and no silent mark_read", () => {
  const method = source.slice(source.indexOf("const openOriginal = async"), source.indexOf("const busy ="));
  assert.match(method, /navigation\.freshOriginal\(target\)/); assert.match(method, /navigation\.freshPeriod\(target\)/); assert.match(method, /client\.getSnapshot\(\) !== selected/);
  assert.match(method, /token !== epoch\.current/); assert.match(method, /raw\(\)/); assert.match(method, /onOpenOriginal\?\.\(ref\)/); assert.match(method, /onOpenPeriod\?\.\(ref\)/);
  assert.doesNotMatch(method, /submit\(|mark_read|location|window\.open/);
  assert.match(source, /ownerId === actorId && !recoveryOnly/);
});
test("201 actual Admin owner host uses real Auth/epoch, composes parent guards and all six existing original approval re-reads", () => {
  const admin = readFileSync(new URL("../components/enterprise/MerchantAttendanceAdminPanel.tsx", import.meta.url), "utf8");
  const method = admin.slice(admin.indexOf("function openReminderOriginal("), admin.indexOf("function closeApproval("));
  for (const text of ['request.family === "correction"', 'request.family === "correction_revision"', 'request.family === "missing_revision"', 'request.family === "leave"', 'request.family === "work_arrangement"', "!cycleAuthCurrent()", "parentDraft.current", "backlogOpen", "inlineWorkspaces.current.size",
    'key !== "reminders"', "ownerBacklogHostReady", "attendanceReminderPendingKey(siteId, ownerId)", "correctionDecisionKey(siteId, ownerId)", "reviewRoutingPendingKey(siteId, ownerId)",
    "getItem(key) !== null", "setRoutingTarget(request)", 'setBacklogTarget({ kind, requestId: request.requestId, submittedAt: request.submittedAt })', "setCorrectionReviewOpen(true)", "setRevisionApprovalOpen(true)", "setMissingOpen(true)"]) assert.ok(method.includes(text), text);
  assert.doesNotMatch(method, /removeItem|submit\(|fetch\(|openRoutingOriginal\(/);
  assert.match(admin, /authUserId === ownerId && isCurrentAuth && <RemindersLauncher/);
  assert.match(admin, /actorId=\{authUserId\} ownerId=\{ownerId\}/); assert.match(admin, /isCurrentAuth=\{cycleAuthCurrent\} enabled=\{remindersEnabled\} requesterKey=\{String\(state.authorizationEpoch\)\}/);
  assert.match(admin, /registerLeaveGuard=\{registerChild\("reminders"\)\} onOpenOriginal=\{openReminderOriginal\}/);
  assert.match(admin, /NEXT_PUBLIC_FAOLLA_ATTENDANCE_REMINDERS_ENABLED === "1"/);
  assert.match(admin, /initialRequestId=\{backlogTarget\?\.kind === "correction" \? backlogTarget.requestId : undefined\}/);
  assert.match(admin, /initialSelection=\{routingTarget\?\.family === "leave" \? routingTarget : null\}/);
  assert.match(admin, /initialSelection=\{routingTarget\?\.family === "work_arrangement" \? routingTarget : null\}/);
});

test("201 owner period navigation mounts the original explicit-read panel with only its ID, guarded slots and synchronous Auth context", () => {
  const admin = readFileSync(new URL("../components/enterprise/MerchantAttendanceAdminPanel.tsx", import.meta.url), "utf8");
  const original = admin.slice(admin.indexOf("function openReminderPeriod("), admin.indexOf("function closeApproval("));
  for (const s of ['value.data.kind !== "detail"', 'value.data.intent.access !== "owner"', 'value.data.intent.actorId !== ownerId', 'value.data.head.action !== "accept"',
    "!cycleAuthCurrent()", "parentDraft.current", 'key !== "reminders"', "ownerBacklogHostReady", "cycleIntentPendingKey(siteId, ownerId)", 'periodClosurePendingKey(siteId, "owner", ownerId)',
    "setReminderPeriod({ context: reminderContext", "intentId: value.data.intent.intentId"]) assert(original.includes(s), s);
  assert.doesNotMatch(original, /removeItem|submit\(|fetch\(|setData\(/);
  assert.match(admin, /reminderPeriod\.context !== reminderContext \|\| !cycleAuthCurrent\(\)/);
  assert.match(admin, /initialIntentId=\{reminderPeriod.intentId\}/); assert.match(admin, /registerChild\("reminder-cycle"\)/);
  const scope = { siteId: "99990201", access: "owner" as const, workerId: id(2), grantId: null };
  assert.equal(cycleIntentInitialId(scope), ""); assert.equal(cycleIntentInitialId(scope, id(3)), id(3)); assert.throws(() => cycleIntentInitialId(scope, "bad"));
  let calls = 0; const html = render(<CycleIntentPanel scope={scope} actorId={id(1)} initialIntentId={id(3)} apiFetch={async () => { calls++; throw Error(); }} isCurrentAuth={() => true} onClose={() => {}}/>);
  assert(html.includes(`value="${id(3)}"`)); assert.match(html, /读取意向详情/); assert.equal(calls, 0);
});

test("201 real overview recipient host uses actual Auth independently of self.view and occupies both old guard lanes without replacing foreign guards", () => {
  const host = readFileSync(new URL("../components/admin/MerchantEnterpriseManager.tsx", import.meta.url), "utf8");
  const mount = host.slice(host.indexOf('key={`attendance-reminders:'), host.indexOf('{tab === "overview" && periodDelegationAuthId ? <MerchantAttendanceOperationalConsumerActivationRecoveryLink'));
  for (const s of ["actorId={periodDelegationAuthId}", "isCurrentAuth={periodDelegationAuthCurrent}", "requesterKey={actorAuthorizationFingerprint}", "!attendanceLeaveGuardRef.current && !correctionLeaveGuardRef.current", "registerLeaveGuard={registerReminderLeaveGuard}"]) assert(mount.includes(s), s);
  assert.doesNotMatch(mount, /actorId=\{actor.id\}|onOpenOriginal|onOpenPeriod|ownerId=/);
  assert.match(mount, /selfEmployeeId=\{actor.type === "employee" && can\(actor, "attendance.self.view"\)/);
  const registration = host.slice(host.indexOf("const registerReminderLeaveGuard ="), host.indexOf("const registerCorrectionLeaveGuard ="));
  for (const s of ["value !== null && value !== prior", "attendanceLeaveGuardRef.current = registration", "correctionLeaveGuardRef.current = registration", "attendanceLeaveGuardRef.current === prior", "correctionLeaveGuardRef.current === prior"]) assert(registration.includes(s), s);
  const launcher = readFileSync(new URL("../components/enterprise/MerchantAttendanceRemindersLauncher.tsx", import.meta.url), "utf8");
  assert.match(launcher, /if \(!open\) return; mountedOpen.current = true; invalidate\(\); outerRegister\?\.\(leave\)/); assert.match(launcher, /const Panel = lazy/);
});
