import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup as render } from "react-dom/server";
import Panel, { OperationalRuleScopeView, OperationalRuleReceiptView, OperationalRulePublications, confirmOperationalRuleAction, operationalRulesPorts, operationalRuleDatesValid } from "../components/enterprise/MerchantAttendanceOperationalRulesPanel";
import Launcher, { OperationalRulesRecoveryLink, operationalRulesLauncherVisible } from "../components/enterprise/MerchantAttendanceOperationalRulesLauncher";
import { OperationalRulesFields, emptyOperationalRules, operationalRuleDefault, operationalRuleFormValid, operationalRuleReasonValid } from "../components/enterprise/MerchantAttendanceOperationalRulesFields";
import { KnownAttendanceRecoveryEntry, AttendanceRecoveryReceiptView } from "../components/enterprise/MerchantAttendanceDelegationRecoveryPanel";
import { OPERATIONAL_RULE_KEYS, parseOperationalRules, type OperationalRules } from "./merchantAttendanceOperationalRules";
import { operationalRuleLedgerActor as actor, operationalRuleLedgerSite as site, operationalRuleLedgerId as id, operationalRuleLedgerScope as scope,
  operationalRuleLedgerDetail as detail, operationalRuleLedgerSaveCommand as command, operationalRuleLedgerReceiptResult as receipt } from "./merchantAttendanceOperationalRuleLedgerTestFixtures";
const no = () => {}, read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
test("initial Panel and default-off Launcher do not read or write; only explicit ledger actions exist", () => {
  let requests = 0; const fetch = async () => { requests++; throw Error("unexpected"); };
  const html = render(<Panel siteId={site} actorId={actor} enabled apiFetch={fetch} onClose={no}/>);
  for (const label of ["八字段运营规则台账", "读取当前台账", "读取台账历史", "读取当前人员目录", "读取保存的个人范围", "读取考勤组目录", "尚未接入实际打卡"]) assert(html.includes(label));
  assert.equal(requests, 0); assert.equal(render(<Launcher siteId={site} actorId={actor} enabled={false} apiFetch={fetch}/>), "");
  assert.equal(render(<OperationalRulesRecoveryLink siteId={site} actorId={actor} isCurrentAuth={() => true} beforeLeave={() => true}/>), "");
  assert.equal(operationalRulesLauncherVisible(false, true, false), true); assert.equal(operationalRulesLauncherVisible(false, false, false), false);
  assert.equal(operationalRulesLauncherVisible(false, false, false, true), true);
  assert.match(render(<Launcher siteId={site} actorId={actor} enabled={false} readOnlyAvailable apiFetch={fetch}/>), /查看／撤销已保存规则/); assert.equal(requests, 0);
});
test("eight fields each provide inherit / disabled / concrete mode without JSON editing", () => {
  const rules = emptyOperationalRules(), html = render(<OperationalRulesFields rules={rules} disabled={false} onChange={no}/>);
  assert.equal((html.match(/<fieldset/g) ?? []).length, 8); assert.equal((html.match(/本层不覆盖/g) ?? []).length, 8);
  assert.equal((html.match(/明确停用/g) ?? []).length, 8); assert.equal((html.match(/配置具体值/g) ?? []).length, 8);
  assert.doesNotMatch(html, /<textarea|UUID|JSON/); assert(OPERATIONAL_RULE_KEYS.every(k => rules[k].mode === "inherit"));
});
function configured(): OperationalRules { return { ...emptyOperationalRules(), allowedChannels: { mode: "value", value: ["self", "pin"] }, locationScope: { mode: "value", value: [id(6)] },
  shiftSource: { mode: "value", value: "published_selection" }, breakTypes: { mode: "value", value: { allowed: ["paid", "unpaid"], selection: "explicit" } },
  correctionWindow: { mode: "value", value: { days: 30 } }, reviewRouting: { mode: "value", value: { correction: "owner", missing: "owner", leave: "owner", work_arrangement: "owner" } },
  timesheetCycle: { mode: "value", value: { kind: "weekly", weekStartsOn: 1 } }, reminders: { mode: "value", value: { open_session: { mode: "enabled", afterMinutes: 60, repeatMinutes: 60, maxOccurrences: 2 }, pending_review: { mode: "disabled" }, period_due: { mode: "disabled" } } } }; }
test("concrete form exposes four routes, three reminders and paid/unpaid values", () => {
  const rules = parseOperationalRules(configured()), html = render(<OperationalRulesFields rules={rules} disabled={false} onChange={no} locations={[{ id: id(6), name: "合成地点", active: true }]} routes={[{ employeeId: id(8), employeeAuthUserId: id(9), employeeName: "合成成员" }]}/>);
  for (const label of ["首次补正路由", "整段漏卡路由", "请假路由", "工作安排路由", "未闭合班次提醒", "待审核提醒", "周期待办提醒", "允许带薪休息", "允许无薪休息", "合成地点", "合成成员", "不是审批授权", "不是已经启动自动提醒"]) assert(html.includes(label));
  assert.match(html, /min="60" max="44640"/); assert.match(html, /min="1" max="10"/); assert.doesNotMatch(html, /<textarea/);
});
test("location input caps exact selected set at25 and never permits typed UUID selection", () => {
  const selected = Array.from({ length: 25 }, (_, n) => id(100 + n)), rules: OperationalRules = { ...emptyOperationalRules(), locationScope: { mode: "value", value: selected } };
  const html = render(<OperationalRulesFields rules={rules} disabled={false} onChange={no} locations={[{ id: id(999), name: "下一地点", active: true }]}/>);
  assert.match(html, /aria-label="选择地点 下一地点"[^>]*disabled=""/); assert.match(html, /已选 25 \/ 25/); assert.doesNotMatch(html, /type="text"/);
  assert.equal(operationalRuleFormValid({ ...rules, locationScope: { mode: "value", value: [...selected, id(999)] } }, "理由"), false);
});
test("saved route identity remains visible without inventing a present catalog name", () => {
  const rules: OperationalRules = { ...emptyOperationalRules(), reviewRouting: { mode: "value", value: { correction: { delegateEmployeeId: id(8), delegateAuthUserId: id(9) }, missing: "owner", leave: "owner", work_arrangement: "owner" } } };
  const html = render(<OperationalRulesFields rules={rules} disabled onChange={no}/>); assert(html.includes(id(8))); assert(html.includes(id(9))); assert.match(html, /保存的成员身份（非本页目录）/);
});
test("strict values and reason validation do not silently correct user input", () => {
  assert(operationalRuleFormValid(configured(), "明确配置")); for (const v of ["", " leading", "trailing ", "line\nfeed", "界".repeat(201)]) assert.equal(operationalRuleReasonValid(v), false);
  assert.equal(operationalRuleFormValid({ ...configured(), correctionWindow: { mode: "value", value: { days: NaN } } }, "理由"), false);
  assert.equal(operationalRuleFormValid({ ...configured(), breakTypes: { mode: "value", value: { allowed: ["paid", "unpaid"], selection: "fixed" } } }, "理由"), false);
  assert.deepEqual(operationalRuleDefault("locationScope"), []); assert.equal(operationalRuleFormValid({ ...emptyOperationalRules(), locationScope: { mode: "value", value: [] } }, "理由"), false);
});
test("full civil-year anchor contract is preserved and saved scopes show all identities", () => {
  const rules: OperationalRules = { ...emptyOperationalRules(), timesheetCycle: { mode: "value", value: { kind: "fortnightly", anchorDate: "0001-01-01" } } };
  assert(operationalRuleFormValid(rules, "理由")); const fields = render(<OperationalRulesFields rules={rules} disabled={false} onChange={no}/>); assert.match(fields, /min="0001-01-01" max="9999-12-31"/);
  const s = scope("personal"), html = render(<OperationalRuleScopeView scope={s}/>); if (s.kind !== "personal") throw Error("fixture");
  for (const identity of [s.workerId, s.employeeId, s.employeeAuthUserId]) assert(html.includes(identity)); assert.match(html, /不由当前姓名倒填/);
});
test("ledger preview dates reject impossible or unsupported dates before client parsing; personal requires whole finite span", () => {
  for (const invalid of ["", "2026-02-30", "1999-12-31", "2101-01-01"]) assert.equal(operationalRuleDatesValid(scope(), invalid, ""), false);
  assert.equal(operationalRuleDatesValid(scope(), "2026-10-10", ""), true);
  assert.equal(operationalRuleDatesValid(scope("personal"), "2026-10-10", ""), false);
  assert.equal(operationalRuleDatesValid(scope("personal"), "2026-10-10", "2026-10-09"), false);
  assert.equal(operationalRuleDatesValid(scope("personal"), "2026-10-10", "2026-10-10"), true);
});
test("current publications remain readonly and minimum receipt never recreates command", async () => {
  const html = render(<OperationalRulePublications result={await detail(scope(), false, true)}/>); assert.match(html, /下一未来发布/); assert.match(html, /修订 2/);
  assert.doesNotMatch(html, /明确保存|明确发布|撤销未来发布/);
  const result = await receipt(command()), r = result.receipt!; const view = render(<OperationalRuleReceiptView receipt={r}/>); assert(view.includes(r.operationId)); assert.doesNotMatch(view, /合成配置|rulesFingerprint|commandFingerprint/); assert.match(view, /不恢复编辑资格/);
  const recovered = render(<AttendanceRecoveryReceiptView receipt={{ kind: "operational-rules", ...r }}/>); assert.match(recovered, /规则草稿已保存/); assert.doesNotMatch(recovered, /合成配置/);
});
test("independent recovery entry shows only site and original operation", () => {
  const html = render(<KnownAttendanceRecoveryEntry entry={{ kind: "operational-rules", storageKey: "not displayed", siteId: site, authUserId: actor, operationId: id(20), commandFingerprint: "a".repeat(64) }}/>);
  assert.match(html, /运营规则台账原操作/); assert(html.includes(id(20))); assert(!html.includes(actor)); assert.doesNotMatch(html, /not displayed|aaaaaa/);
});
test("confirmation checks the same lease before and after the blocking dialog", () => {
  let live = true, writes = 0; assert.equal(confirmOperationalRuleAction(() => { live = false; return true; }, () => live, () => writes++), false); assert.equal(writes, 0);
  live = true; assert.equal(confirmOperationalRuleAction(() => false, () => live, () => writes++), false); assert.equal(writes, 0);
  assert.equal(confirmOperationalRuleAction(() => true, () => live, () => writes++), true); assert.equal(writes, 1);
});
test("ports fence requester and storage reentry synchronously", async () => {
  let live = true, called = 0; const ports = operationalRulesPorts(async () => { called++; live = false; return Response.json({ ok: true }); }, () => ({ getItem: () => { live = false; return null; }, setItem: no, removeItem: no }), () => live);
  await assert.rejects(ports.apiFetch("/", { method: "GET" }), /identity_changed/); assert.equal(called, 1); live = true; assert.throws(() => ports.storage().getItem("key"), /identity_changed/);
});
test("narrow parent integration has actual Auth and independent non-owner recovery", () => {
  const admin = read("../components/enterprise/MerchantAttendanceAdminPanel.tsx"), manager = read("../components/admin/MerchantEnterpriseManager.tsx"), panel = read("../components/enterprise/MerchantAttendanceOperationalRulesPanel.tsx");
  assert.match(admin, /authUserId === ownerId && <OperationalRulesLauncher/); assert.match(admin, /registerChild\("operational-rules"\)/);
  assert.match(manager, /tab === "overview" && periodDelegationAuthId \? <MerchantAttendanceOperationalRulesRecoveryLink/);
  assert.match(panel, /client\.initialize\(\)/); assert.match(panel, /flushSync\(\(\) => \{ invalidate\(\); setShown\(false\)/); assert.match(panel, /scope\.kind === "personal" \? endsOn : null/);
  assert.match(panel, /client\.nextHistory\(\)/); assert.match(panel, /canWithdraw/); assert.doesNotMatch(panel, /setInterval|JSON\.parse\(.*UUID/);
  assert.match(panel, /state\.canEndRejectedAttempt &&/); assert.match(panel, /snapshot\.canEndRejectedAttempt/); assert.match(panel, /if \(client\.endRejectedAttempt\(\)\)/);
  assert.match(panel, /其他未知、恢复查无和重载状态不得据此清除原号/);
});
