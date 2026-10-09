import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Launcher from "../components/enterprise/MerchantAttendancePersonalRulesLauncher";
import Panel, { PersonalRulesApprovalEditor, PersonalRulesHistoryEntry, personalRulesEarliestDate, personalRulesCanWithdraw, validatePersonalRulesApprovalInput } from "../components/enterprise/MerchantAttendancePersonalRulesPanel";
import { emptyAttendanceRuleDraft, RULE_KEYS, RULE_DEFINITIONS } from "./merchantAttendanceRuleDraft";
import type { PersonalRulesItem, PersonalRulesResponse } from "./merchantAttendancePersonalRules";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const noop = () => {};
const apiFetch = async (): Promise<Response> => { throw Error("SSR must never fetch"); };
const props = { siteId: "99990001", ownerId: id(1), workerId: id(2), apiFetch };
const rules = () => ({ ...emptyAttendanceRuleDraft(), lateGraceMinutes: { mode: "value" as const, minutes: 0 }, earlyGraceMinutes: { mode: "disabled" as const } });
function result(): PersonalRulesResponse {
  return { protocol: "personal-rules-v1", ok: true, moduleEnabled: true, siteId: props.siteId, actorId: props.ownerId,
    worker: { workerId: props.workerId, workerName: "Synthetic target", workerNo: "W-2", employeeId: id(3), employeeAuthUserId: id(4), version: 2, active: true, employeeActive: true },
    settingsVersion: 3, timeZone: "UTC", revision: 0, items: [], nextBeforeRevision: null, receipt: null, readAt: "2026-10-04T23:59:59.999999Z" };
}
function item(): PersonalRulesItem & { withdrawnByRevision: number | null } {
  return { revision: 1, operationId: id(10), actorId: props.ownerId, action: "approve", reason: "Synthetic owner reason", recordedAt: "2026-10-04T10:00:00.123456Z",
    employeeId: id(3), employeeAuthUserId: id(4), workerVersion: 2, settingsVersion: 3, timeZone: "UTC", startsOn: "2026-10-05", endsOn: "2026-10-05",
    fromAt: "2026-10-05T00:00:00.000Z", toAt: "2026-10-06T00:00:00.000Z", rules: rules(), approvedRevision: null, withdrawnByRevision: null };
}
const approval = () => ({ startsOn: "2026-10-05", endsOn: "2026-10-05", rules: rules(), reason: " Explicit owner reason " });

test("personal launcher stays gated and inactive targets produce no controls or reads", () => {
  assert.equal(renderToStaticMarkup(createElement(Launcher, { ...props, enabled: false })), "");
  assert.equal(renderToStaticMarkup(createElement(Launcher, { ...props, enabled: true, active: false })), "");
  const html = renderToStaticMarkup(createElement(Launcher, { ...props, enabled: true }));
  assert.match(html, /个人例外候选（未应用）/); assert.doesNotMatch(html, /<dialog|<form|个人例外候选记录/);
});
test("panel SSR exposes limits but no unverified target, historical identity, editable form or request", () => {
  const html = renderToStaticMarkup(createElement(Panel, { ...props, onClose: noop }));
  assert.match(html, /不是员工申请或双人审核/); assert.match(html, /不作正式考勤判定/);
  assert.match(html, /没有持久草稿/); assert.match(html, /role="status"/);
  assert.doesNotMatch(html, /Synthetic target|<form|00000000-0000-4000-8000/);
});
test("editor has four explicit modes, no implicit minutes, local date labels and a disabled initial submit", () => {
  const html = renderToStaticMarkup(createElement(PersonalRulesApprovalEditor, { result: result(), disabled: false, onDirty: noop, onApprove: noop }));
  assert.equal((html.match(/<select/g) ?? []).length, 4);
  assert.equal((html.match(/value="inherit" selected=""/g) ?? []).length, 4);
  for (const key of RULE_KEYS) assert(html.includes(RULE_DEFINITIONS[key].label));
  assert.match(html, /min="2026-10-05"/); assert.match(html, /开始日期（企业当地）/); assert.match(html, /结束日期（含尾日）/);
  assert.match(html, /disabled="">核对并核准个人例外候选/); assert.equal((html.match(/placeholder="不预填数值"/g) ?? []).length, 4);
});
test("pending, paused or unauthorized editor can be rendered wholly non-editable", () => {
  const html = renderToStaticMarkup(createElement(PersonalRulesApprovalEditor, { result: result(), disabled: true, onDirty: noop, onApprove: noop }));
  assert.match(html, /<fieldset disabled=""/); assert.match(html, /disabled="">核对并核准个人例外候选/);
});
test("earliest date follows server workplace day, skipped day and supported end horizon", () => {
  assert.equal(personalRulesEarliestDate(result()), "2026-10-05");
  assert.equal(personalRulesEarliestDate({ readAt: "2026-10-04T22:30:00.000001Z", timeZone: "Europe/Madrid" }), "2026-10-06");
  assert.equal(personalRulesEarliestDate({ readAt: "2011-12-29T22:00:00.000001Z", timeZone: "Pacific/Apia" }), "2011-12-31");
  assert.equal(personalRulesEarliestDate({ readAt: "2100-12-31T00:00:00.000001Z", timeZone: "UTC" }), null);
});
test("approval validation preserves zero, disabled and detached complete rules and rejects all-inherit", () => {
  const value = approval(), parsed = validatePersonalRulesApprovalInput(value, result());
  assert.equal(parsed.reason, "Explicit owner reason"); assert.deepEqual(parsed.rules.lateGraceMinutes, { mode: "value", minutes: 0 });
  assert.deepEqual(parsed.rules.earlyGraceMinutes, { mode: "disabled" }); assert.notEqual(parsed.rules, value.rules);
  assert.throws(() => validatePersonalRulesApprovalInput({ ...value, rules: emptyAttendanceRuleDraft() }, result()), /全部继承/);
  for (const reason of [" ", "x\u0001", "x".repeat(201)]) assert.throws(() => validatePersonalRulesApprovalInput({ ...value, reason }, result()));
});
test("date validation counts civil days across DST, rejects today/reverse/32 days and skipped endpoints", () => {
  const value = approval();
  assert.equal(validatePersonalRulesApprovalInput({ ...value, startsOn: "2026-10-05", endsOn: "2026-11-04" }, { readAt: "2026-10-04T10:00:00.123456Z", timeZone: "Europe/Madrid" }).endsOn, "2026-11-04");
  for (const dates of [{ startsOn: "2026-10-04", endsOn: "2026-10-05" }, { startsOn: "2026-10-06", endsOn: "2026-10-05" }, { startsOn: "2026-10-05", endsOn: "2026-11-05" }]) assert.throws(() => validatePersonalRulesApprovalInput({ ...value, ...dates }, result()));
  assert.throws(() => validatePersonalRulesApprovalInput({ ...value, startsOn: "2011-12-29", endsOn: "2011-12-30" }, { readAt: "2011-12-28T12:00:00.000001Z", timeZone: "Pacific/Apia" }), /确实存在/);
});
test("withdraw eligibility preserves the one-microsecond boundary and never offers already-withdrawn/history deletion", () => {
  const row = item(); assert.equal(personalRulesCanWithdraw(row, "2026-10-04T23:59:59.999999Z"), true);
  assert.equal(personalRulesCanWithdraw(row, "2026-10-05T00:00:00.000000Z"), false);
  assert.equal(personalRulesCanWithdraw({ ...row, withdrawnByRevision: 2 }, result().readAt), false);
  const html = renderToStaticMarkup(createElement(PersonalRulesHistoryEntry, { item: row, readAt: "2026-10-05T00:00:00.000001Z", disabled: false, onDirty: noop, onWithdraw: noop }));
  assert.match(html, /不能撤回这条历史候选/); assert.doesNotMatch(html, /<form|<input|请求撤回/);
});
test("history renders full immutable identities, literal zero and withdrawn markers as escaped text", () => {
  const row = { ...item(), reason: '<img src=x onerror="alert(1)">', withdrawnByRevision: 2 }, before = structuredClone(row);
  const html = renderToStaticMarkup(createElement(PersonalRulesHistoryEntry, { item: row, readAt: result().readAt, disabled: false, onDirty: noop, onWithdraw: noop }));
  assert.match(html, /已由版本 2 撤回/); assert.match(html, /0 分钟/); assert.match(html, /明确停用/);
  assert(html.includes(row.employeeId)); assert(html.includes(row.employeeAuthUserId)); assert(html.includes(row.fromAt));
  assert.match(html, /&lt;img/); assert.doesNotMatch(html, /<img|<script|<form/); assert.deepEqual(row, before);
});
