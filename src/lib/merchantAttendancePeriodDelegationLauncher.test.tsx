import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Launcher, { periodDelegationLauncherIdentityValid, periodDelegationLauncherVisible } from "../components/enterprise/MerchantAttendancePeriodDelegationLauncher";
import { periodDelegationPeriodSelection, confirmPeriodDelegationAction } from "../components/enterprise/MerchantAttendancePeriodDelegationPanel";
import { parsePeriodDelegationQuery, parsePeriodDelegationResult } from "./merchantAttendancePeriodDelegation";
import type { PeriodDelegationClientState } from "./merchantAttendancePeriodDelegationClient";

// Pure synthetic UI/protocol fixtures, not real Auth, browser or SQL acceptance.
const id = (n: number) => `64000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const siteId = "99990001", actorId = id(2), authUserId = id(3), owner = id(1);
const identity = { siteId, actorId, authUserId, access: "delegate" as const };
const file = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
function state(): PeriodDelegationClientState {
  const query = parsePeriodDelegationQuery({ siteId, access: "delegate", mode: "detail", grantId: id(8), catalog: null, afterId: null, operationId: null });
  const result = parsePeriodDelegationResult({ protocol: "period-delegation-v1", siteId, access: "delegate", actorId: authUserId, employeeId: actorId,
    mode: "detail", canWrite: false, grants: [], catalogItems: [], nextAfterId: null, receipt: null, readAt: "2026-10-08T10:00:00.000000Z",
    detail: { grantId: id(8), revision: 1, status: "granted", delegate: { employeeId: actorId, authUserId, name: "Synthetic supervisor" },
      worker: { workerId: id(4), employeeId: id(5), authUserId: id(6), name: "Synthetic target", workerNo: "T-1" },
      fromDate: "2026-10-01", throughDate: "2026-11-30", actions: ["view", "send"], usableActions: ["view", "send"], includeExisting: false,
      validFrom: "2026-10-08T09:00:00.000000Z", validUntil: "2026-11-08T09:00:00.000000Z", grantedBy: owner,
      grantedAt: "2026-10-08T09:00:00.000000Z", reason: "Synthetic scope", revocation: null } }, query, { authUserId });
  return { phase: "ready", query, result, pending: null, choices: { delegate: null, worker: null }, message: "" };
}

test("default-off owner retains lazy revocation entry; delegate gets only independent recovery link", () => {
  let calls = 0;
  const apiFetch = async () => { calls++; throw Error("no SSR request"); };
  const manager = renderToStaticMarkup(<Launcher siteId={siteId} access="owner" actorId={owner} authUserId={owner} apiFetch={apiFetch} enabled={false}/>);
  assert.match(manager, /周期授权核验／撤销/); assert.doesNotMatch(manager, /<dialog|确认授予|<fieldset/);
  const employee = renderToStaticMarkup(<Launcher {...identity} apiFetch={apiFetch} enabled={false}/>);
  assert.match(employee, /独立恢复/); assert.doesNotMatch(employee, /<button|我的受托周期|<dialog/);
  assert.match(renderToStaticMarkup(<Launcher {...identity} apiFetch={apiFetch} enabled/>), /我的受托周期/);
  assert.equal(renderToStaticMarkup(<Launcher {...identity} apiFetch={apiFetch} enabled active={false}/>), "");
  assert.equal(calls, 0);
});

test("owner entry requires separately provided actual Auth equality and valid UUIDs", () => {
  assert.equal(periodDelegationLauncherIdentityValid("owner", owner, owner), true);
  assert.equal(periodDelegationLauncherIdentityValid("owner", owner, authUserId), false);
  assert.equal(periodDelegationLauncherIdentityValid("delegate", actorId, authUserId), true);
  for (const value of ["", "employee-id", "owner", owner.toUpperCase()]) if (value !== owner) assert.equal(periodDelegationLauncherIdentityValid("owner", owner, value), false);
  const apiFetch = async () => { throw Error("no fetch"); };
  assert.equal(renderToStaticMarkup(<Launcher siteId={siteId} access="owner" actorId={owner} authUserId={authUserId} apiFetch={apiFetch} enabled/>), "");
});

test("a pending management intent remains reachable when disabled, without restoring fresh delegate access", () => {
  assert.equal(periodDelegationLauncherVisible("delegate", false, true, false), true);
  assert.equal(periodDelegationLauncherVisible("delegate", false, false, false), false);
  assert.equal(periodDelegationLauncherVisible("owner", false, false, false), true);
  const code = file("../components/enterprise/MerchantAttendancePeriodDelegationLauncher.tsx");
  assert.match(code, /props\.access === "delegate" && props\.periodsEnabled/);
  assert.match(code, /NEXT_PUBLIC_FAOLLA_ATTENDANCE_PERIOD_CLOSURES_ENABLED === "1"/);
  assert.match(code, /NEXT_PUBLIC_FAOLLA_ATTENDANCE_PERIOD_CONTINUATION_ENABLED === "1"/);
  assert.doesNotMatch(code, /client\.(?:load|recover|send)\(/);
});

test("only freshly read exact grant detail creates a frozen complete scope, not owner metadata or a list row", () => {
  const s = state(), chosen = periodDelegationPeriodSelection(s, identity, "2026-10-01", "2026-10-31");
  assert.deepEqual(chosen, { siteId, actorEmployeeId: actorId, expectedAuthUserId: authUserId, grantId: id(8), workerId: id(4),
    targetEmployeeId: id(5), targetAuthUserId: id(6), authorizedFromDate: "2026-10-01", authorizedThroughDate: "2026-11-30",
    fromDate: "2026-10-01", throughDate: "2026-10-31" });
  assert(Object.isFrozen(chosen)); assert.equal(Object.keys(chosen).length, 11);
  for (const patch of [{ phase: "loading" as const }, { query: null }, { result: null }, { query: { ...s.query!, mode: "list" as const, grantId: null } },
    { query: { ...s.query!, grantId: id(88) } }, { result: { ...s.result!, detail: null } }]) {
    assert.throws(() => periodDelegationPeriodSelection({ ...s, ...patch }, identity, "2026-10-01", "2026-10-31"));
  }
  assert.throws(() => periodDelegationPeriodSelection(s, { ...identity, access: "owner" }, "2026-10-01", "2026-10-31"));
});

test("selection independently binds caller, target saved dual identities, grant status and read-time usability", () => {
  const s = state(), result = s.result!, detail = result.detail!;
  for (const patch of [{ actorId: id(99) }, { employeeId: id(99) }, { siteId: "99990002" }, { readAt: detail.validUntil }]) {
    assert.throws(() => periodDelegationPeriodSelection({ ...s, result: { ...result, ...patch } }, identity, "2026-10-01", "2026-10-31"));
  }
  for (const patch of [{ revision: 2 as const }, { status: "revoked" as const }, { usableActions: [] },
    { delegate: { ...detail.delegate, authUserId: id(99) } }, { delegate: { ...detail.delegate, employeeId: id(99) } },
    { worker: { ...detail.worker, employeeId: actorId } }, { worker: { ...detail.worker, authUserId } }]) {
    assert.throws(() => periodDelegationPeriodSelection({ ...s, result: { ...result, detail: { ...detail, ...patch } } }, identity, "2026-10-01", "2026-10-31"));
  }
});

test("date selection is explicit, at most31 days, and entirely inside saved authorization", () => {
  const s = state();
  for (const [from, through] of [["", ""], ["2026-10-01", "2026-11-01"], ["2026-09-30", "2026-10-01"],
    ["2026-11-30", "2026-12-01"], ["2026-10-10", "2026-10-09"], ["2026-02-30", "2026-03-01"]]) {
    assert.throws(() => periodDelegationPeriodSelection(s, identity, from, through));
  }
  assert.equal(periodDelegationPeriodSelection(s, identity, "2026-11-30", "2026-11-30").throughDate, "2026-11-30");
});

test("a changed grant read during confirmation cannot open a workspace", () => {
  let current = state(), opens = 0; const snapshot = current;
  assert.equal(confirmPeriodDelegationAction(() => { current = state(); return true; }, () => current === snapshot, () => { opens++; }), false);
  assert.equal(opens, 0);
  const code = file("../components/enterprise/MerchantAttendancePeriodDelegationPanel.tsx");
  assert.match(code, /periodDelegationPeriodSelection\(snapshot/);
  assert.match(code, /current\(generation, snapshot\), \(\) => \{ invalidate\(\); onOpenPeriod\(value\); \}/);
});

test("launcher owns exactly one lazy child and preserves accepted child guards without double confirmation", () => {
  const code = file("../components/enterprise/MerchantAttendancePeriodDelegationLauncher.tsx");
  assert.match(code, /selection \? <Workspace/); assert.match(code, /: <Panel/);
  assert.match(code, /guard\.current\?\.key === childKey/);
  assert.match(code, /if \(!open\) return; props\.registerLeaveGuard\?\.\(leave\)/);
  assert.match(code, /onClose=\{\(\) => \{ if \(props\.isCurrentAuth\(\)\) setSelection\(null\); \}\}/);
  assert.match(code, /live\.current\.token \+ 1/);
  assert.match(code, /props\.isCurrentAuth\(\).*document\.hidden/);
  assert.doesNotMatch(code, /MerchantAttendancePeriodClosure(?:V2)?Workspace/);
});

test("enterprise overview exposes the new permission independently of employee self attendance and uses verified Auth", () => {
  const manager = file("../components/admin/MerchantEnterpriseManager.tsx"), admin = file("../components/enterprise/MerchantAttendanceAdminPanel.tsx");
  assert.match(manager, /tab === "overview" && actor\.type === "employee" && can\(actor, "attendance\.period\.view"\) && periodDelegationAuthId/);
  assert.match(manager, /actorId=\{actor\.id\} authUserId=\{periodDelegationAuthId\}/);
  assert.match(manager, /periodDelegationScope\.current\.token\+\+/);
  assert.match(manager, /\[siteId, tab, actorAuthorizationFingerprint, currentAuthUserId\]/);
  assert.match(admin, /authUserId === ownerId && <PeriodDelegationLauncher/);
  assert.match(admin, /registerLeaveGuard=\{registerChild\("period-delegation"\)\}/);
  assert.match(admin, /client\.getSnapshot\(\)\.pending \|\| targetOccupied \|\| backlogOpen \|\| childGuards\.current\.size/);
  assert.doesNotMatch(file("../components/enterprise/MerchantAttendanceSelfPanel.tsx"), /PeriodDelegationLauncher/);
});

test("200 new cycle path passes the original actual Auth callback and full real grant selection, without changing legacy compatibility", () => {
  const code = file("../components/enterprise/MerchantAttendancePeriodDelegationLauncher.tsx");
  assert.match(code, /props\.isCurrentAuth\?\.\(\) !== false/);
  assert.match(code, /cycleIntentAuthCurrent\(props\.isCurrentAuth\)/);
  assert.match(code, /live\.current\.token === token && props\.active !== false && cycleIntentAuthCurrent/);
  assert.match(code, /cycleIsCurrentAuth=\{props\.cycleIsCurrentAuth\} cycleEnabled=\{props\.cycleEnabled\}/);
  assert.match(code, /<Workspace \{\.\.\.selection\}/); assert.doesNotMatch(code, /delegateScope=\{.*intent/);
});
