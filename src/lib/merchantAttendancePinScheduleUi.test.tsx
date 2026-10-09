import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import PinClock from "../components/enterprise/MerchantAttendancePinClock";
import { PinScheduleClockContent, PinScheduleReceipt } from "../components/enterprise/MerchantAttendancePinScheduleClock";
import type { PinScheduleState } from "./merchantAttendancePinScheduleClient";
import { pinScheduleHttp, pinScheduleCommand, pinScheduleSelection, pinScheduleSite, pinScheduleTerminal, pinScheduleWorkerNo, pinScheduleId as id } from "../../scripts/fixtures/attendance-pin-schedule-model";
const noop = () => {}, client = { submit: async () => {}, punch: async () => {}, retry: async () => {} };
function state(): PinScheduleState { const result = pinScheduleHttp(); return { phase: "ready", canConfirm: true, device: { siteId: pinScheduleSite, terminalId: pinScheduleTerminal, label: "测试" }, clock: result.clock, result, pending: null, legacyPending: null, message: "已验证" }; }
const pending = () => ({ version: 1 as const, siteId: pinScheduleSite, terminalId: pinScheduleTerminal, workerNo: pinScheduleWorkerNo, command: pinScheduleCommand(), selection: { ...pinScheduleSelection } });
function html(patch: Partial<React.ComponentProps<typeof PinScheduleClockContent>> = {}) { return renderToStaticMarkup(<PinScheduleClockContent state={state()} client={client} enabled selected="" setSelection={noop} onClear={noop} {...patch}/>); }
test("actual parent remains default-off and exposes no employee/candidates before authentication", () => {
  const markup = renderToStaticMarkup(<PinClock pinScheduleEnabled={false}/>);
  assert.ok(!markup.includes("data-pin-schedule-clock")); assert.ok(!markup.includes("合成 PIN 员工")); assert.match(markup, /验证并读取／核对原操作/); assert.match(markup, /type="password"/);
});
test("PIN candidate placeholder is explicit, never autoselected or a proof of presence", () => {
  const markup = html(); assert.match(markup, /<option value="" selected="">请明确选择/); assert.match(markup, /disabled=""[^>]*>PIN 上班 · 请先明确选择/);
  assert.match(markup, /不替代 PIN 验证/); assert.match(markup, /不延长 30 秒/); assert.match(markup, /配对不证明真实到场/);
});
test("none and listed choice can each be confirmed only within current PIN window", () => {
  assert.ok(!/<button[^>]*disabled=""[^>]*>PIN 上班 · 不关联排班/.test(html({ selected: "none" })));
  assert.match(html({ selected: id(6) }), /PIN 上班 · 已选排班/);
  assert.match(html({ selected: id(6), state: { ...state(), canConfirm: false } }), /disabled=""[^>]*>PIN 上班 · 已选排班/);
});
test("feature rollback keeps fixed pending visible with disabled retry, no fallback", () => {
  const markup = html({ enabled: false, state: { ...state(), phase: "unconfirmed", pending: pending() } });
  assert.match(markup, /disabled=""[^>]*>PIN 核对后原编号重试/); assert.match(markup, /不会改走旧上班提交/); assert.match(markup, /固定原选择/); assert.ok(!markup.includes('<select'));
});
test("dual pending disables retry and does not expose an editable replacement choice", () => {
  const p = pending(), { selection: _selection, ...old } = p; void _selection;
  const markup = html({ state: { ...state(), phase: "unconfirmed", pending: p, legacyPending: old } });
  assert.match(markup, /每次只认证读取一个原号/); assert.match(markup, /disabled=""[^>]*>PIN 核对后原编号重试/); assert.ok(!markup.includes('<select'));
});
test("public terminal loading and rejected authentication reveal no pending identifiers or selection", () => {
  for (const phase of ["loading", "unconfirmed", "blocked", "storage_error"] as const) {
    const markup = html({ state: { ...state(), phase, canConfirm: false, clock: null, result: null, pending: pending() } });
    assert.match(markup, /本人重新输入工号和 PIN/); assert.ok(!markup.includes(id(5))); assert.ok(!markup.includes(id(6)));
    assert.ok(!markup.includes("固定原选择")); assert.ok(!markup.includes("合成 PIN 员工")); assert.ok(!markup.includes('<select'));
  }
});
test("empty/limited candidates are not absence conclusions and explicit none stays available", () => {
  for (const limited of [false, true]) { const s = state(); s.result!.choices.entries = []; s.result!.choices.limited = limited;
    const markup = html({ state: s, selected: "none" }); assert.match(markup, limited ? /超过有界上限，不代表没有排班/ : /没有候选，不代表缺勤/);
    assert.ok(!/<button[^>]*disabled=""[^>]*>PIN 上班 · 不关联排班/.test(markup)); }
});
test("paused new starts retain original finish controls for current verified PIN", () => {
  const result = pinScheduleHttp(true, false, false); result.clock.receipt = null; result.association = null; result.adoption = null;
  const markup = html({ state: { ...state(), result, clock: result.clock } }); assert.match(markup, /disabled=""[^>]*>确认开始休息/);
  assert.ok(!/<button[^>]*disabled=""[^>]*>确认下班/.test(markup)); assert.ok(!markup.includes('PIN 上班 ·'));
});
test("receipt distinguishes association/adoption, preserves exact IDs and escapes saved text", () => {
  const result = pinScheduleHttp(true); result.association!.slot!.locationName = '<img src=x onerror="boom">'; result.association!.currentCancelled = true;
  const markup = renderToStaticMarkup(<PinScheduleReceipt result={result}/>);
  for (const value of ['data-pin-schedule-association="linked"', 'data-pin-schedule-adoption="adopted"', id(5), id(7), id(8), id(9), "a".repeat(64), "不代表迟到、早退", "当前已取消"]) assert.ok(markup.includes(value), value);
  assert.ok(!markup.includes('<img')); assert.match(markup, /&lt;img/);
});
test("new parent routing clears alternate PIN owner and performs only exact pending discovery", () => {
  const source = readFileSync(new URL("../components/enterprise/MerchantAttendancePinClock.tsx", import.meta.url), "utf8");
  assert.match(source, /NEXT_PUBLIC_FAOLLA_ATTENDANCE_PIN_SCHEDULE_ENABLED==="1"/);
  assert.match(source, /client.clear\(\);setOwner\("schedule"\);void schedule.read\(workerNo,value,state.device\)/);
  assert.match(source, /schedule.clear\(\);setOwner\("old"\);void client.read\(workerNo,value\)/);
  assert.match(source, /pinScheduleOwnsInput\(false,state.device,r.workerNo/); assert.match(source, /window.addEventListener\("pagehide",clear\)/);
  for (const action of ['punch("clock_in")', 'punch("break_start")', 'punch("break_end")', 'punch("clock_out")', 'punch(null)']) assert.ok(source.includes(action));
  assert.ok(!source.includes('setInterval')); assert.ok(!source.includes('localStorage')); assert.ok(!source.includes('storage.key('));
  const component = readFileSync(new URL("../components/enterprise/MerchantAttendancePinScheduleClock.tsx", import.meta.url), "utf8");
  assert.match(component, /w-full min-w-0/); assert.match(component, /choice.result === state.result/); assert.ok(!component.includes('fetch(')); assert.ok(!component.includes('setInterval'));
});
