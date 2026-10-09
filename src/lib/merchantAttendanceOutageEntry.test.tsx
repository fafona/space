import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup as render } from "react-dom/server";
import Launcher, { outageLauncherVisible } from "../components/enterprise/MerchantAttendanceOutageLauncher";
import Admin from "../components/enterprise/MerchantAttendanceAdminPanel";
import Self from "../components/enterprise/MerchantAttendanceSelfPanel";
import OperationalPunchHost from "../components/enterprise/MerchantAttendanceOperationalPunchHost";
const siteId = "99990001", owner = "00000000-0000-4000-8000-000000000001", employee = "00000000-0000-4000-8000-000000000002", auth = "00000000-0000-4000-8000-000000000003";
const source = (name: string) => readFileSync(new URL(name, import.meta.url), "utf8");
test("new launcher is default-off with no HTTP; each role and selected worker has an explicit entry", () => {
  let requests = 0; const props = { siteId, actorId: owner, access: "owner" as const, apiFetch: async () => { requests++; throw Error("no HTTP in entry render"); } };
  assert.equal(render(<Launcher {...props} enabled={false}/>), ""); assert.equal(render(<Launcher {...props} enabled active={false}/>), "");
  assert.match(render(<Launcher {...props} enabled/>), /故障登记与恢复核对/);
  assert.match(render(<Launcher {...props} enabled workerId={employee}/>), /登记该人员故障声明/);
  assert.match(render(<Launcher {...props} enabled actorId={auth} access="self"/>), /我的故障声明与核对/);
  assert.equal(requests, 0);
});
test("flag-off pending from any of the four protocols and open receipts remain reachable", () => {
  assert(outageLauncherVisible(false, true, false)); assert(outageLauncherVisible(false, false, true));
  assert(!outageLauncherVisible(false, false, false)); assert(outageLauncherVisible(true, false, false));
  const text = source("../components/enterprise/MerchantAttendanceOutageLauncher.tsx");
  assert(text.includes('["outages", "links", "reviews", "relations"]')); assert(text.includes("props.actorId"));
  assert(!text.includes("localStorage")); assert(!text.includes("sessionStorage.clear"));
});

test("relations entry has its independent gate without enabling original outage writes or automatic reads", () => {
  let calls = 0;
  const props = { siteId, actorId: owner, access: "owner" as const, enabled: false, printEnabled: false,
    apiFetch: async () => { calls++; throw Error("unexpected entry request"); } };
  assert.equal(render(<Launcher {...props} relationsEnabled={false}/>), "");
  assert.match(render(<Launcher {...props} relationsEnabled/>), /故障声明关系与资料核对/);
  assert(outageLauncherVisible(false, false, false, false, true));
  assert(!outageLauncherVisible(false, false, false, false, false));
  assert.equal(calls, 0);
});
test("actual owner parent renders the new default-off/on entry without changing existing configuration actions", () => {
  let calls = 0; const props = { siteId, ownerId: owner, apiFetch: async () => { calls++; throw Error("unexpected"); } };
  const off = render(<Admin {...props} outageEnabled={false}/>), on = render(<Admin {...props} outageEnabled/>);
  assert(!off.includes("故障登记与恢复核对")); assert(on.includes("故障登记与恢复核对"));
  for (const label of ["员工考勤配置", "考勤设置", "工作地点", "考勤人员"]) { assert(off.includes(label)); assert(on.includes(label)); }
  assert.equal(calls, 0);
});
test("self parent requires a verified Auth identifier and never substitutes the employee record identifier", () => {
  let calls = 0; const props = { siteId, employeeId: employee, employeeName: "合成员工", canClock: false, apiFetch: async () => { calls++; throw Error("unexpected"); } };
  for (const authUserId of [undefined, null, ""]) assert(!render(<Self {...props} outageEnabled authUserId={authUserId}/>).includes("我的故障声明与核对"));
  assert.throws(() => render(<Self {...props} outageEnabled authUserId="not-uuid"/>), /attendance_invalid_request/);
  // The real same-Auth pending gate intentionally hides legacy children during
  // SSR. Verify that boundary and its real child separately, without mocking
  // readiness, running effects or substituting the employee row for Auth.
  const capture = (outageEnabled: boolean) => {
    let element: ReturnType<typeof Self> | null = null;
    function CaptureParent() { element = Self({ ...props, outageEnabled, authUserId: auth }); return element; }
    const markup = render(<CaptureParent/>); assert(element);
    return { element: element as ReturnType<typeof Self>, markup };
  };
  const { element: outer, markup } = capture(true);
  assert.equal(outer.type, OperationalPunchHost);
  assert.equal(outer.props.scope.authUserId, auth); assert.notEqual(outer.props.scope.authUserId, employee);
  assert(markup.includes("正在检查本标签页待确认编号"));
  assert(!markup.includes("我的故障声明与核对"));
  assert(render(outer.props.children).includes("我的故障声明与核对"));
  const { element: off } = capture(false);
  assert.equal(off.type, OperationalPunchHost); assert.equal(off.props.scope.authUserId, auth);
  assert(!render(off.props.children).includes("我的故障声明与核对"));
  assert.equal(calls, 0);
});
test("entry wiring preserves live Auth scope, parent invalidation epoch and existing leave protection", () => {
  const manager = source("../components/admin/MerchantEnterpriseManager.tsx"), self = source("../components/enterprise/MerchantAttendanceSelfPanel.tsx"), admin = source("../components/enterprise/MerchantAttendanceAdminPanel.tsx");
  assert(manager.includes("authUserId={currentAuthUserId}")); assert(self.includes('actorId={authUserId} access="self"'));
  assert(self.includes("outages:${siteId}:${employeeId}:${authUserId}:${state.authorizationEpoch}"));
  assert(self.includes("registerLeaveGuard={registerOutageLeaveGuard}")); assert(self.includes("legacyLeaveGuard.current"));
  assert(admin.includes("outage-worker:${state.authorizationEpoch}")); assert(admin.includes('access="owner" workerId={item.id}'));
});
