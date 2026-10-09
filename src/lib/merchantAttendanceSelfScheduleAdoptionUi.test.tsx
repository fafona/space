import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Panel from "../components/enterprise/MerchantAttendanceSelfPanel";
import { SelfScheduleAdoptionContent, SelfScheduleAdoptionReceipt, SelfScheduleAdoptionStorageErrors, selfAdoptionOwner, selfAdoptionConfirmation } from "../components/enterprise/MerchantAttendanceSelfScheduleAdoptionClock";
import type { SelfScheduleAdoptionClientState } from "./merchantAttendanceSelfScheduleAdoptionClient";
import type { SelfScheduleClientState } from "./merchantAttendanceSelfScheduleClient";
import type { AttendanceClientState } from "./merchantAttendanceSelfClient";
import { selfScheduleAdoptionHttp, selfScheduleAdoptionCommand, selfScheduleAdoptionEmployee, selfScheduleAdoptionSite, selfScheduleAdoptionId as id } from "../../scripts/fixtures/attendance-self-schedule-adoption-model";
const noop = () => {}, client = { submit: async () => {}, retry: async () => {}, initialize: async () => {} };
const state = (): SelfScheduleAdoptionClientState => ({ phase: "ready", result: selfScheduleAdoptionHttp(), pending: null, message: "已核对" });
const old = (): SelfScheduleClientState => ({ phase: "idle", result: null, pending: null, message: "旧协议" });
const legacy = (): AttendanceClientState => ({ phase: "ready", result: { ...selfScheduleAdoptionHttp().clock, moduleEnabled: true }, pending: null, confirmed: null, message: "已同步", authorizationEpoch: 0 });
const pending = () => ({ version: 1, siteId: selfScheduleAdoptionSite, employeeId: selfScheduleAdoptionEmployee, command: selfScheduleAdoptionCommand(), selection: { slotId: id(6), revision: 3 } } as const);
function html(patch: Partial<React.ComponentProps<typeof SelfScheduleAdoptionContent>> = {}) {
  return renderToStaticMarkup(<SelfScheduleAdoptionContent client={client} state={state()} oldState={old()} enabled canClock legacyState={legacy()} selected="" setSelection={noop} refresh={noop} {...patch}/>);
}
test("actual parent is default-off and SSR issues no candidate request", () => {
  let requests = 0; const markup = renderToStaticMarkup(<Panel siteId={selfScheduleAdoptionSite} employeeId={selfScheduleAdoptionEmployee} employeeName="合成员工" canClock apiFetch={async () => { requests++; throw Error("unexpected"); }}
    selfScheduleEnabled={false} selfScheduleAdoptionEnabled={false} locationWorkspaceEnabled={false} exceptionWorkspaceEnabled={false} correctionWorkspaceEnabled={false}/>);
  assert.equal(requests, 0); assert.ok(!markup.includes('data-self-schedule-adoption-clock')); assert.match(markup, /我的考勤/);
});
test("owner selection preserves137pending, both remain old first, next explicit refresh can choose new", () => {
  assert.equal(selfAdoptionOwner(true, true, false), "old"); assert.equal(selfAdoptionOwner(true, true, true), "old");
  assert.equal(selfAdoptionOwner(false, false, true), "new"); assert.equal(selfAdoptionOwner(true, false, false), "new"); assert.equal(selfAdoptionOwner(false, false, false), "old");
});

test("flag-off corrupt new storage remains visibly blocked independent of the displayed pending owner", () => {
  assert.equal(selfAdoptionOwner(false, false, false, true), "new");
  assert.equal(selfAdoptionOwner(false, true, false, true), "old");
  const blocked = { ...state(), phase: "storage_error" as const, result: null, message: "恢复字节损坏，原编号保留" };
  for (const original of [old(), { ...old(), pending: pending() }]) {
    const markup = renderToStaticMarkup(<SelfScheduleAdoptionStorageErrors state={blocked} old={original}/>);
    assert.match(markup, /role="alert"/); assert.match(markup, /新核准选班恢复存储：恢复字节损坏/);
  }
  const markup = html({ enabled: false, state: blocked, selected: "none" });
  assert.match(markup, /disabled=""[^>]*>上班并保存核准引用 · 不关联排班/);
});
test("placeholder is not a default selection; explicit none and listed slot are separate choices", () => {
  assert.match(html(), /<option value="" selected="">请明确选择/); assert.match(html(), /disabled=""[^>]*>上班并保存核准引用 · 请先明确选择/);
  assert.ok(!/<button[^>]*disabled=""[^>]*>上班并保存核准引用 · 不关联排班/.test(html({ selected: "none" })));
  assert.match(html({ selected: id(6) }), /上班并保存核准引用 · 已选排班/);
});
test("server-off cannot expose an old clock-in fallback", () => {
  const s = state(); s.result!.selectionEnabled = false; s.result!.choices.entries = [];
  const markup = html({ state: s, selected: "none" }); assert.match(markup, /disabled=""[^>]*>上班并保存核准引用 · 不关联排班/); assert.match(markup, /不自动改走旧上班/);
});
test("new feature-off retains fixed original selection and disables retry", () => {
  const markup = html({ enabled: false, state: { ...state(), phase: "unconfirmed", pending: pending() } });
  assert.match(markup, /固定原选择/); assert.match(markup, /disabled=""[^>]*>用原编号重试核准选班上班/); assert.ok(!markup.includes('<select'));
});
test("old137 pending and basic pending each block new writes", () => {
  const original = { ...old(), pending: pending() };
  assert.match(html({ oldState: original, selected: "none" }), /disabled=""[^>]*>上班并保存核准引用 · 不关联排班/);
  const basic = { ...legacy(), pending: { version: 1 as const, siteId: selfScheduleAdoptionSite, employeeId: selfScheduleAdoptionEmployee, workerId: id(3), command: selfScheduleAdoptionCommand() } };
  assert.match(html({ legacyState: basic, selected: "none" }), /disabled=""[^>]*>上班并保存核准引用 · 不关联排班/);
});
test("legacy137 relation without adoption is displayed honestly, no source fabricated", () => {
  const r = selfScheduleAdoptionHttp(true); r.adoption = null; const markup = renderToStaticMarkup(<SelfScheduleAdoptionReceipt result={r}/>);
  assert.match(markup, /data-self-schedule-adoption-association="linked"/); assert.match(markup, /data-self-schedule-adoption-status="legacy"/); assert.match(markup, /没有用当前核准补写历史/); assert.ok(!markup.includes('SHA-256'));
});
test("real adoption and saved original identifiers remain separate and text-escaped", () => {
  const r = selfScheduleAdoptionHttp(true); r.association!.slot!.locationName = '<img src=x onerror="boom">'; r.association!.currentCancelled = true;
  const markup = renderToStaticMarkup(<SelfScheduleAdoptionReceipt result={r}/>);
  for (const value of ['data-self-schedule-adoption-status="adopted"', id(5), id(7), id(8), id(9), "a".repeat(64), "不代表迟到、早退", "当前已取消"]) assert.ok(markup.includes(value), value);
  assert.ok(!markup.includes('<img')); assert.match(markup, /&lt;img/);
});
test("limited/empty candidates do not imply absence or prevent explicit none", () => {
  for (const limited of [false, true]) { const s = state(); s.result!.choices.entries = []; s.result!.choices.limited = limited;
    assert.match(html({ state: s, selected: "none" }), limited ? /超过有界上限，不代表没有排班/ : /没有候选，不代表缺勤/); }
});
test("confirmation refreshes original status once, only after old read settles", () => {
  const s = { ...state(), result: selfScheduleAdoptionHttp(true) };
  assert.equal(selfAdoptionConfirmation(s, true, true, null), null); assert.equal(selfAdoptionConfirmation(s, false, false, null), null);
  assert.equal(selfAdoptionConfirmation(s, false, true, null), id(5)); assert.equal(selfAdoptionConfirmation(s, false, true, id(5)), null);
  assert.equal(selfAdoptionConfirmation({ ...s, pending: pending() }, false, true, null), null);
});
test("coordinator initializes locally, reuses effect-free old view, and pauses the other request source", () => {
  const source = readFileSync(new URL("../components/enterprise/MerchantAttendanceSelfScheduleAdoptionClock.tsx", import.meta.url), "utf8");
  assert.match(source, /await client.initialize\(\)/); assert.match(source, /await oldClient.initialize\(\)/);
  assert.match(source, /if \(!coordinating\) return <OldClock/); assert.match(source, /<SelfScheduleClockContent/);
  assert.match(source, /oldClient.pause\(\); void client.refresh\(operationId\)/); assert.match(source, /client.pause\(\); void oldClient.refresh\(operationId\)/);
  assert.ok(!source.includes('autoRead')); assert.match(source, /pagehide/); assert.match(source, /beforeunload/); assert.match(source, /w-full min-w-0/);
  assert.ok(!source.includes('localStorage')); assert.ok(!source.includes('setInterval')); assert.ok(!source.includes('protocol: "self-schedule-v1"'));
});
test("parent aggregates both pending leases and suppresses fallback only for new flow", () => {
  const source = readFileSync(new URL("../components/enterprise/MerchantAttendanceSelfPanel.tsx", import.meta.url), "utf8");
  assert.match(source, /NEXT_PUBLIC_FAOLLA_ATTENDANCE_SELF_SCHEDULE_ADOPTION_ENABLED === "1"/);
  assert.match(source, /scheduleClient.blocksOtherActions\(\) \|\| adoptionClient.blocksOtherActions\(\)/);
  assert.match(source, /getItem\(selfScheduleAdoptionPendingKey\(siteId, employeeId\)\) === null/);
  assert.match(source, /!selfScheduleAdoptionEnabled && !adoptionState.pending && \(!selfScheduleEnabled \|\| scheduleState.result\?\.selectionEnabled === false\)/);
  assert.match(source, /key=\{`self-schedule:\$\{siteId\}:\$\{employeeId\}:\$\{state.authorizationEpoch\}`\}/);
});
