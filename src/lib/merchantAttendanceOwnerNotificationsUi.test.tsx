import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import Panel, { ownerNotificationsPorts, ownerNotificationsCanOpenTarget, confirmOwnerNotificationsAction } from "../components/enterprise/MerchantAttendanceOwnerNotificationsPanel";
import Launcher, { ownerNotificationsLauncherIdentity } from "../components/enterprise/MerchantAttendanceOwnerNotificationsLauncher";
import PlanWorkspace, { planExceptionNotificationMatches } from "../components/enterprise/MerchantAttendancePlanExceptionWorkspace";
import PeriodWorkspace, { periodClosureNotificationMatches, periodClosureV2Controls } from "../components/enterprise/MerchantAttendancePeriodClosureV2Workspace";
import { parseOwnerNotificationsQuery, parseOwnerNotificationsResult, type OwnerNotificationsItem } from "./merchantAttendanceOwnerNotifications";
import type { OwnerNotificationsClientState } from "./merchantAttendanceOwnerNotificationsClient";
import type { PlanExceptionResponse } from "./merchantAttendancePlanExceptionContract";
import type { PeriodClosureV2View, PeriodClosureV2ClientState } from "./merchantAttendancePeriodClosureV2Client";
import { periodClosureUiSummary, periodClosureUiArtifact, periodClosureUiQuery, periodClosureUiOwner } from "../../scripts/fixtures/attendance-period-closure-ui-model";

const id = (n: number) => `23600000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const siteId = "99990236", actorId = id(1), stamp = "2026-10-08T08:00:00.000000Z";
const item: OwnerNotificationsItem = { notificationId: id(2), sourceCategory: "period", sourceOperationId: id(3), sourceId: id(4), sourceRevision: 2,
  workerId: id(5), employeeId: id(6), employeeAuthUserId: id(7), occurredAt: stamp, readAt: null, target: { periodId: id(4), fromDate: "2026-09-01", throughDate: "2026-09-02" } };
const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
function state(): OwnerNotificationsClientState {
  const query = parseOwnerNotificationsQuery({ siteId, mode: "detail", notificationId: item.notificationId, operationId: null, beforeAt: null, beforeId: null });
  const result = parseOwnerNotificationsResult({ protocol: "owner-attendance-notifications-v1", siteId, actorId, kind: "detail", item, canMarkRead: true }, query, actorId);
  return { phase: "ready", query, result, pending: null, message: "" };
}
test("actual Panel and Launcher SSR do not read or post; disabled entry retains independent recovery link", () => {
  let calls = 0; const apiFetch = async () => { calls++; throw Error("not called"); };
  const html = renderToStaticMarkup(<Launcher siteId={siteId} actorId={actorId} authUserId={actorId} apiFetch={apiFetch} enabled={false}/>);
  assert.match(html, /attendance-owner-notifications-recovery/); assert.doesNotMatch(html, /<dialog|<button/);
  assert.match(renderToStaticMarkup(<Launcher siteId={siteId} actorId={actorId} authUserId={actorId} apiFetch={apiFetch} enabled/>), /负责人考勤收件/);
  const recovery = renderToStaticMarkup(<Panel siteId={siteId} actorId={actorId} apiFetch={apiFetch} recoveryOnly enabled={false}/>);
  assert.match(recovery, /负责人标读原号恢复/); assert.match(recovery, /不恢复原事项权限/); assert.doesNotMatch(recovery, />读取负责人收件<|>明确标为已读<|>打开原事项（重新核验）</);
  assert.equal(calls, 0);
});
test("owner launcher is bound to separately supplied actual Auth and active scope", () => {
  assert.equal(ownerNotificationsLauncherIdentity(siteId, actorId, actorId), true);
  assert.equal(ownerNotificationsLauncherIdentity(siteId, actorId, id(8)), false);
  assert.equal(ownerNotificationsLauncherIdentity("1", actorId, actorId), false);
  const apiFetch = async () => { throw Error("no request"); };
  assert.equal(renderToStaticMarkup(<Launcher siteId={siteId} actorId={actorId} authUserId={id(8)} apiFetch={apiFetch} enabled/>), "");
  assert.equal(renderToStaticMarkup(<Launcher siteId={siteId} actorId={actorId} authUserId={actorId} apiFetch={apiFetch} enabled active={false}/>), "");
});
test("only fresh current detail allows navigation; a receipt, other actor or pending never does", () => {
  const s = state(); assert.equal(ownerNotificationsCanOpenTarget(s, siteId, actorId), true);
  assert.equal(ownerNotificationsCanOpenTarget({ ...s, phase: "loading" }, siteId, actorId), false);
  assert.equal(ownerNotificationsCanOpenTarget(s, siteId, id(8)), false);
  assert.equal(ownerNotificationsCanOpenTarget(s, "99990000", actorId), false);
  assert.equal(ownerNotificationsCanOpenTarget({ ...s, query: { ...s.query!, mode: "recover", operationId: id(9) } }, siteId, actorId), false);
  assert.equal(ownerNotificationsCanOpenTarget({ ...s, pending: { version: 1, actorId, query: s.query!, command: { action: "mark_read", operationId: id(9), notificationId: item.notificationId } } }, siteId, actorId), false);
});
test("confirmation checks both sides of blocking dialog and does not act on stale snapshot", () => {
  let current = true, acts = 0;
  assert.equal(confirmOwnerNotificationsAction(() => { current = false; return true; }, () => current, () => acts++), false);
  assert.equal(acts, 0); current = true;
  assert.equal(confirmOwnerNotificationsAction(() => false, () => current, () => acts++), false);
  assert.equal(confirmOwnerNotificationsAction(() => true, () => current, () => acts++), true); assert.equal(acts, 1);
});
test("captured storage handles and fetch results cannot survive a synchronous scope revocation", async () => {
  let current = true, mutations = 0; const ports = ownerNotificationsPorts(async () => { current = false; return new Response("{}"); },
    () => ({ getItem: () => null, setItem: () => { mutations++; }, removeItem: () => { mutations++; } }), () => current);
  const handle = ports.storage(); current = false; assert.throws(() => handle.getItem("k")); assert.throws(() => handle.setItem("k", "v")); assert.throws(() => handle.removeItem("k"));
  assert.equal(mutations, 0); current = true; await assert.rejects(ports.apiFetch("/local", {}));
});
test("plan target requires fresh case, worker and both saved identity IDs, not original revision equality", () => {
  const target = { caseId: id(10), workerId: id(5), employeeId: id(6), employeeAuthUserId: id(7), slotId: id(11) };
  // Narrow selector fixture only: full response validation remains in the real original client.
  const result = { detail: { caseId: target.caseId, slotId: target.slotId, revision: 55, worker: { workerId: target.workerId, employeeId: target.employeeId, employeeAuthUserId: target.employeeAuthUserId } } } as PlanExceptionResponse;
  assert.equal(planExceptionNotificationMatches(result, target), true);
  for (const key of ["caseId", "workerId", "employeeId", "employeeAuthUserId", "slotId"] as const) assert.equal(planExceptionNotificationMatches(result, { ...target, [key]: id(99) }), false);
  assert.equal(planExceptionNotificationMatches(null, target), false);
});
test("period target binds full saved frame and double identity while allowing later business revisions", () => {
  const period = periodClosureUiSummary(), artifact = periodClosureUiArtifact(), query = periodClosureUiQuery("detail");
  const target = { periodId: period.periodId, workerId: period.workerId, employeeId: period.employeeId, employeeAuthUserId: period.employeeAuthUserId,
    fromDate: period.fromDate, throughDate: period.throughDate };
  const result: PeriodClosureV2View = { protocol: "period-closure-v2", siteId: query.siteId, actorId: periodClosureUiOwner, access: "owner", workerId: period.workerId,
    readAt: stamp, moduleEnabled: true, kind: "detail", period: { ...period, revision: 101 }, artifact, artifactVersion: period.currentVersion, sourceChanged: false, operation: null, replayed: false };
  assert.equal(periodClosureNotificationMatches(result, target), true);
  for (const key of ["periodId", "workerId", "employeeId", "employeeAuthUserId"] as const) assert.equal(periodClosureNotificationMatches(result, { ...target, [key]: id(99) }), false);
  assert.equal(periodClosureNotificationMatches(result, { ...target, fromDate: "2010-01-01" }), false);
  assert.equal(periodClosureNotificationMatches(result, { ...target, throughDate: "2010-01-01" }), false);
  const s: PeriodClosureV2ClientState = { phase: "ready", query: { ...query, cursor: null }, result: null, pending: null, message: "", definitiveRejection: null,
    navigation: { workerId: query.workerId, fromDate: query.fromDate, throughDate: query.throughDate, periodId: query.periodId } };
  const controls = periodClosureV2Controls(s, query, true, true, "explicit reason"); assert.ok(Object.values(controls.allowed).every(v => !v)); assert.equal(controls.canOutput, false);
});
test("both actual workspaces expose explicit target GET, never automatic HTTP at mount", () => {
  let calls = 0; const apiFetch = async () => { calls++; throw Error("not called"); };
  const planTarget = { caseId: id(10), workerId: id(5), employeeId: id(6), employeeAuthUserId: id(7), slotId: id(11) };
  const plan = renderToStaticMarkup(<PlanWorkspace siteId={siteId} access="owner" actorId={actorId} apiFetch={apiFetch} onClose={() => {}} initialTarget={planTarget} expectedNotificationTarget={planTarget} enabled/>);
  assert.match(plan, /读取消息原异常当前详情/); assert.match(plan, /原待确认号优先/);
  const period = periodClosureUiSummary(), target = { periodId: period.periodId, workerId: period.workerId, employeeId: period.employeeId, employeeAuthUserId: period.employeeAuthUserId, fromDate: period.fromDate, throughDate: period.throughDate };
  const html = renderToStaticMarkup(<PeriodWorkspace siteId={siteId} access="owner" actorId={actorId} {...target} apiFetch={apiFetch} expectedNotificationTarget={target} onClose={() => {}} enabled/>);
  assert.match(html, /读取消息原周期当前详情/); assert.doesNotMatch(html, />读取周期列表</); assert.equal(calls, 0);
});
test("Admin uses current Auth, runtime parent storage guards and one registered child; employee messages unchanged", () => {
  const admin = source("../components/enterprise/MerchantAttendanceAdminPanel.tsx"), launcher = source("../components/enterprise/MerchantAttendanceOwnerNotificationsLauncher.tsx");
  assert.match(admin, /authUserId === ownerId && <OwnerNotificationsLauncher/); assert.match(admin, /registerChild\("owner-notifications"\)/);
  assert.match(admin, /beforeTarget=[\s\S]*?sessionStorage\.getItem\(client\.storageKey\) === null/);
  assert.match(launcher, /selection \? <Target/); assert.match(launcher, /onOpenTarget=[\s\S]*?beforeTarget/);
  assert.match(launcher, /onCancel=.*preventDefault\(\); close\(\)/); assert.match(launcher, /onKeyDown=[\s\S]*?Escape/);
  assert.doesNotMatch(launcher, /MerchantEnterpriseNotificationCenter|localStorage|setInterval/);
});
