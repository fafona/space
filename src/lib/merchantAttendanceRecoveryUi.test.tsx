import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup as render } from "react-dom/server";
import RecoveryPanel, { KnownAttendanceRecoveryEntry, AttendanceRecoveryReceiptView } from "../components/enterprise/MerchantAttendanceDelegationRecoveryPanel";
import { listKnownAttendanceRecoveries, recoverKnownAttendance, type KnownAttendanceRecovery, type AttendanceRecoveryReceipt, type AttendanceRecoveryStorage } from "./merchantAttendanceRecovery";
import { accountStatusPendingKey } from "./merchantAttendanceAccountSuspensionClient";
import { accountStatusCommandFingerprint, type AccountStatusCommand } from "./merchantAttendanceAccountSuspension";
import { accountSuspensionId as id, accountSuspensionSite as site, accountSuspensionOwner as actor, accountSuspensionEmployee as employee,
  accountStatusCommand as command, accountSuspensionHttp as http, accountStatusReceiptHttp as receiptHttp } from "../../scripts/fixtures/attendance-account-suspension-model";
const source = (name: string) => readFileSync(new URL(name, import.meta.url), "utf8");
const panelSource = () => source("../components/enterprise/MerchantAttendanceDelegationRecoveryPanel.tsx");
const entry = (kind: "account-status" | "missing" | "application" | "correction"): KnownAttendanceRecovery => kind === "account-status"
  ? { kind, storageKey: accountStatusPendingKey(site, actor), siteId: site, authUserId: actor, operationId: id(20), commandFingerprint: "a".repeat(64) }
  : { kind, storageKey: `faolla:attendance:${kind}-delegation:v1:${site}:delegate:${employee}`, siteId: site, access: "delegate", anchorId: employee, authUserId: actor, operationId: id(20), commandFingerprint: "a".repeat(64) };
const delegationReceipt = (kind: "missing" | "application", action: "grant" | "revoke" | "approve" | "reject" = "approve"): AttendanceRecoveryReceipt => ({ kind,
  operationId: id(20), actorId: actor, recordedAt: "2026-10-06T10:00:00.000000Z", action, grantId: id(30), requestId: id(40) });
function memory() { const values = new Map<string, string>(); const storage: AttendanceRecoveryStorage = {
  get length() { return values.size; }, key: n => [...values.keys()][n] ?? null, getItem: key => values.get(key) ?? null,
  setItem: (key, value) => { values.set(key, value); }, removeItem: key => { values.delete(key); } }; return { storage, values }; }
async function statusFixture(c: AccountStatusCommand = command()) { const mem = memory(), key = accountStatusPendingKey(site, actor);
  const raw = JSON.stringify({ version: 1, siteId: site, actorId: actor, command: c, commandFingerprint: await accountStatusCommandFingerprint(site, c) });
  mem.storage.setItem(key, raw); return { ...mem, key, raw, command: c }; }

test("SSR entry performs neither storage discovery nor requests before explicit current-Auth action", () => {
  let requests = 0, storage = 0;
  const html = render(<RecoveryPanel authUserId={actor} isCurrentAuth={() => true} apiFetch={async () => { requests++; throw Error("unexpected request"); }} storage={() => { storage++; throw Error("unexpected storage"); }}/>);
  assert.match(html, /查找本标签页待确认编号/); assert.match(html, /企业账号停用／恢复/); assert.match(html, /任职结束／再入职的待确认编号/); assert.match(html, /排班委托操作/); assert(!html.includes(id(20))); assert(!html.includes("已核实最小回执"));
  assert.equal(requests, 0); assert.equal(storage, 0);
});
test("three local entry kinds expose only kind enterprise and operation, with one read button", () => {
  for (const [kind, label] of [["missing", "漏卡审批委托"], ["application", "请假／工作安排审批委托"], ["account-status", "企业账号状态原操作"], ["correction", "首次补正审批委托原操作"]] as const) {
    const e = entry(kind), html = render(<KnownAttendanceRecoveryEntry entry={e}/>); assert(html.includes(label)); assert(html.includes(site)); assert(html.includes(e.operationId));
    assert.equal((html.match(/<button/g) ?? []).length, 1); assert.match(html, />读取这个原编号<\/button>/); assert(!html.includes('type="submit"'));
    for (const secret of [employee, actor, e.commandFingerprint, e.storageKey, "expectedVersion", "offboardingMode"]) assert(!html.includes(secret));
    assert(!html.includes("企业账号已停用")); assert(!html.includes("企业账号已恢复"));
  }
});
test("busy entry keeps original read name disabled and has no hidden write action", () => {
  const html = render(<KnownAttendanceRecoveryEntry entry={entry("account-status")} busy/>); assert.match(html, /disabled=""/);
  const src = panelSource(); assert(!src.includes(".submit(")); assert(!src.includes(".restore(")); assert(!src.includes(".retry(")); assert(!src.includes("method:"));
});
test("old receipt labels and minimum disclosure are preserved for both delegation kinds", () => {
  const labels = { grant: "已授予委托", revoke: "已撤销委托", approve: "已批准", reject: "已驳回" };
  for (const kind of ["missing", "application"] as const) for (const action of Object.keys(labels) as (keyof typeof labels)[]) {
    const receipt = delegationReceipt(kind, action), html = render(<AttendanceRecoveryReceiptView receipt={receipt}/>);
    assert(html.includes(labels[action])); assert(html.includes(receipt.operationId)); assert(html.includes(receipt.actorId)); assert.match(html, /此处不显示申请正文、理由或其他员工资料/);
    assert(!html.includes(id(30))); assert(!html.includes(id(40))); assert(!html.includes("<button")); assert(!html.includes("企业账号"));
  }
});
test("account-status receipt distinguishes all four outcomes and never displays target membership or source intent", () => {
  for (const status of ["active", "disabled"] as const) for (const suspensionId of [id(10), null]) {
    const receipt: AttendanceRecoveryReceipt = { kind: "account-status", operationId: id(20), actorId: actor, employeeId: employee,
      status, expectedVersion: 1, version: 2, suspensionId, recordedAt: "2026-10-06T10:00:00.000000Z" };
    const html = render(<AttendanceRecoveryReceiptView receipt={receipt}/>);
    assert.match(html, status === "active" ? /原操作确认：企业账号已恢复/ : /原操作确认：企业账号已停用/);
    assert.match(html, /不证明当前账号仍处于该状态/); assert.match(html, /四个独立结果/); assert.match(html, /这里不会执行任何一项/);
    assert.match(html, suspensionId ? /不代表该暂停已解除/ : /不能推断考勤已恢复/);
    assert(!html.includes(employee)); assert(!html.includes(id(10))); assert(!html.includes("<button"));
  }
});
test("unknown actual GET result retains exact status intent and UI has no settle branch for null", async () => {
  const f = await statusFixture(), found = await listKnownAttendanceRecoveries(f.storage, actor, () => true); assert.equal(found.entries.length, 1);
  assert.equal(found.entries[0].kind, "account-status"); let calls = 0;
  const result = await recoverKnownAttendance(found.entries[0], { authenticatedUserId: actor, storage: f.storage, isCurrentAuth: () => true, signal: new AbortController().signal,
    apiFetch: async (path, init) => { calls++; assert.equal(init?.method, "GET"); assert.equal(init?.body, undefined);
      assert(path.startsWith("/api/merchant-enterprise/attendance/account-suspensions?")); assert(path.includes("mode=recover-status")); assert(path.includes("operationId="+f.command.operationId));
      return Response.json(http("recover-status")); } });
  assert.equal(result, null); assert.equal(calls, 1); assert.equal(f.storage.getItem(f.key), f.raw);
  const src = panelSource(); assert.match(src, /if \(result\) \{ setReceipt\(result\); setEntries/); assert.match(src, /else setMessage\("原结果尚未核实；查无回执不等于失败，编号继续保留/);
});
test("known original status resolves through strict production aggregate and renders only its receipt", async () => {
  const f = await statusFixture(), found = await listKnownAttendanceRecoveries(f.storage, actor, () => true);
  const result = await recoverKnownAttendance(found.entries[0], { authenticatedUserId: actor, storage: f.storage, isCurrentAuth: () => true, signal: new AbortController().signal,
    apiFetch: async (_path, init) => { assert.equal(init?.method, "GET"); assert.equal(init?.body, undefined); return Response.json(await receiptHttp(f.command)); } });
  assert(result); assert.equal(result.kind, "account-status"); assert.equal(f.storage.getItem(f.key), null);
  const html = render(<AttendanceRecoveryReceiptView receipt={result}/>); assert.match(html, /原操作确认：企业账号已停用/); assert(!html.includes("unassign")); assert(!html.includes(employee));
});
test("foreign Auth and synchronous invalidation reveal no identifiers and leave the same bytes", async () => {
  const f = await statusFixture(); assert.deepEqual((await listKnownAttendanceRecoveries(f.storage, id(99), () => true)).entries, []);
  await assert.rejects(listKnownAttendanceRecoveries(f.storage, actor, () => false), /recovery_scope_changed/); assert.equal(f.storage.getItem(f.key), f.raw);
  const src = panelSource(); assert.match(src, /isCurrentAuth\(\) \? entries : \[\]/); assert.match(src, /isCurrentAuth\(\) && receipt/);
  for (const event of ["visibilitychange", "pagehide", "storage"]) assert(src.includes(event));
});
test("existing selector route and Page authorization remain the actual reachable read-only path", () => {
  const page = source("../components/enterprise/MerchantAttendanceDelegationRecoveryPage.tsx"), route = source("../app/enterprise/attendance-recovery/page.tsx"), selector = source("../app/enterprise/EnterpriseSelectorClient.tsx");
  assert.match(selector, /href="\/enterprise\/attendance-recovery"/); assert(route.includes("MerchantAttendanceDelegationRecoveryPage"));
  for (const guard of ["supabase.auth.getUser", "isEnterpriseLogoutBlocked", "generation.current === auth.generation", "isCurrentAuth={isCurrentAuth}"]) assert(page.includes(guard));
  assert.match(page, /不能在这里授予权限、审批、停用／恢复账号、办理任职、解除考勤暂停或代他人查询/);
  assert(!page.includes("attendance.self.view")); assert(!page.includes("memberships"));
});
