import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { OnsiteScheduleClockContent, OnsiteScheduleReceipt, onsiteScheduleCodeOwner, onsiteScheduleConfirmationReady } from "../components/enterprise/MerchantAttendanceOnsiteScheduleClock";
import type { OnsiteScheduleClientState } from "./merchantAttendanceOnsiteScheduleClient";
import type { OnsiteClockClientState } from "./merchantAttendanceOnsiteClockClient";
import { onsiteScheduleHttp, onsiteScheduleCommand, onsiteScheduleActor, onsiteScheduleSite, onsiteScheduleClaims, onsiteScheduleId as id } from "../../scripts/fixtures/attendance-onsite-schedule-model";
const noop = () => {}, asyncNoop = async () => {};
const client = { read: asyncNoop, initialize: asyncNoop, submit: asyncNoop, retry: asyncNoop, pause: noop };
const legacy = (): OnsiteClockClientState => ({ phase: "ready", result: onsiteScheduleHttp().clock, pending: null, code: null, moduleEnabled: true, message: "旧状态已同步" });
const state = (): OnsiteScheduleClientState => ({ phase: "ready", result: onsiteScheduleHttp(), pending: null, code: null, message: "已核对" });
const pending = () => ({ version: 1 as const, siteId: onsiteScheduleSite, authUserId: onsiteScheduleActor, command: onsiteScheduleCommand(), selection: { slotId: id(6), revision: 3 } });
const oldPending = () => ({ version: 1 as const, siteId: onsiteScheduleSite, authUserId: onsiteScheduleActor, command: onsiteScheduleCommand() });
function code() { const { siteId, terminalId, locationId, issuedAtMs, expiresAtMs } = onsiteScheduleClaims(); return { siteId, terminalId, locationId, issuedAtMs, expiresAtMs }; }
function html(patch: Partial<React.ComponentProps<typeof OnsiteScheduleClockContent>> = {}) {
  return renderToStaticMarkup(<OnsiteScheduleClockContent client={client} state={state()} legacyState={legacy()} enabled visible selected="" setSelection={noop} {...patch}/>);
}
test("default off shows no new control unless original pending recovery is needed", () => {
  assert.equal(html({ enabled: false, state: { ...state(), result: null } }), "");
  const markup = html({ enabled: false, state: { ...state(), phase: "unconfirmed", result: null, pending: pending() } });
  assert.match(markup, /读取现场选班／原编号/); assert.match(markup, /disabled=""[^>]*>新码核对后原编号重试/); assert.match(markup, /不会改走旧上班提交/);
});
test("default location read is explicitly not QR verification; placeholder never auto selects", () => {
  const markup = html(); assert.match(markup, /当前默认地点的本人候选，不验证现场码/); assert.match(markup, /<option value="" selected="">请明确选择/);
  assert.match(markup, /disabled=""[^>]*>现场上班 · 请先明确选择/);
});
test("selection alone cannot submit; a separate short-term code is required", () => {
  assert.match(html({ selected: "none" }), /disabled=""[^>]*>现场上班 · 不关联排班/);
  const ready = { ...state(), code: code() }; assert.ok(!/<button[^>]*disabled=""[^>]*>现场上班 · 不关联排班/.test(html({ state: ready, selected: "none" })));
  assert.match(html({ state: ready, selected: id(6) }), /现场上班 · 已选排班/);
});
test("old pending, old busy and paused module forbid fresh new write", () => {
  for (const mode of ["pending", "busy", "paused"] as const) {
    const old = legacy(), s = { ...state(), code: code() };
    if (mode === "pending") old.pending = oldPending(); else if (mode === "busy") old.phase = "saving"; else s.result!.moduleEnabled = false;
    assert.match(html({ state: s, legacyState: old, selected: "none" }), /disabled=""[^>]*>现场上班 · 不关联排班/);
  }
});
test("token owner matrix is exclusive and original pending retains its old protocol", () => {
  const old = legacy(), current = state(); assert.equal(onsiteScheduleCodeOwner(old, current, false), "old"); assert.equal(onsiteScheduleCodeOwner(old, current, true), "schedule");
  assert.equal(onsiteScheduleCodeOwner({ ...old, pending: oldPending() }, current, true), "old");
  assert.equal(onsiteScheduleCodeOwner(old, { ...current, pending: pending() }, true), "schedule");
  assert.equal(onsiteScheduleCodeOwner(old, { ...current, pending: pending() }, false), "none");
  assert.equal(onsiteScheduleCodeOwner({ ...old, pending: oldPending() }, { ...current, pending: pending() }, true), "none");
});
test("old non-clock-in actions keep old token even throughout their loading preflight", () => {
  const old = legacy(); old.result = onsiteScheduleHttp(true).clock;
  assert.equal(onsiteScheduleCodeOwner(old, state(), true), "old");
  assert.equal(onsiteScheduleCodeOwner({ ...old, phase: "loading" }, state(), true), "old");
  assert.equal(onsiteScheduleCodeOwner({ ...old, phase: "saving" }, state(), true), "old");
});
test("unknown storage and absent current identity cannot receive a code", () => {
  assert.equal(onsiteScheduleCodeOwner(legacy(), { ...state(), phase: "storage_error" }, true), "none");
  assert.equal(onsiteScheduleCodeOwner({ ...legacy(), result: null }, state(), true), "none");
});
test("limited and empty candidate messages make no absence conclusion", () => {
  const limited = state(); limited.result!.choices.limited = true; limited.result!.choices.entries = []; assert.match(html({ state: limited }), /超过有界上限，不代表没有排班/);
  const empty = state(); empty.result!.choices.entries = []; assert.match(html({ state: empty }), /没有候选，不代表缺勤/);
});
test("association and approval are independent markers with exact provenance and escaped names", () => {
  const r = onsiteScheduleHttp(true); r.association!.slot!.locationName = '<img src=x onerror="boom">'; r.association!.currentCancelled = true;
  const markup = renderToStaticMarkup(<OnsiteScheduleReceipt result={r}/>);
  for (const text of ['data-onsite-schedule-association="linked"', 'data-onsite-schedule-adoption="adopted"', id(7), id(8), id(9), "a".repeat(64), "不代表迟到、早退", "当前已取消"]) assert.ok(markup.includes(text), text);
  assert.ok(!markup.includes("<img")); assert.match(markup, /&lt;img/);
});
test("new confirmation refreshes old state once only after pending settled and old idle", () => {
  const s = { ...state(), result: onsiteScheduleHttp(true) };
  assert.equal(onsiteScheduleConfirmationReady(s, false, true, null), id(5)); assert.equal(onsiteScheduleConfirmationReady(s, true, true, null), null);
  assert.equal(onsiteScheduleConfirmationReady(s, false, false, null), null); assert.equal(onsiteScheduleConfirmationReady(s, false, true, id(5)), null);
  assert.equal(onsiteScheduleConfirmationReady({ ...s, pending: pending() }, false, true, null), null);
});
test("Phone only changes EmployeeClock routing; scanner/url/auth remain original and all old actions are guarded", () => {
  const source = readFileSync(new URL("../components/enterprise/MerchantAttendanceOnsitePhone.tsx", import.meta.url), "utf8");
  assert.match(source, /NEXT_PUBLIC_FAOLLA_ATTENDANCE_ONSITE_SCHEDULE_ENABLED === "1"/);
  assert.match(source, /if \(!scheduleClient.blocksOtherActions\(\)\) void client.punch\(action\)/);
  for (const action of ['punch(null)', 'punch("clock_in")', 'punch("break_start")', 'punch("clock_out")', 'punch("break_end")']) assert.ok(source.includes(action));
  assert.match(source, /client.clearCode\(\); scheduleClient.clearCode\(\);.*codeRevision, codeOwner/);
  assert.match(source, /if \(codeOwner === "schedule"\) \{ client.clearCode\(\); scheduleClient.setCode\(code\); \}/);
  assert.match(source, /else if \(codeOwner === "old"\) \{ scheduleClient.clearCode\(\); client.setCode\(code\); \}/);
  assert.match(source, /key=\{siteId \+ ":" \+ auth.userId \+ ":" \+ auth.token\}/);
  assert.match(source, /window.history.replaceState/); assert.match(source, /MerchantAttendanceOnsiteScanner onScan=\{accept\}/);
  const child = readFileSync(new URL("../components/enterprise/MerchantAttendanceOnsiteScheduleClock.tsx", import.meta.url), "utf8");
  assert.match(child, /await client.initialize\(\)/); assert.match(child, /pagehide/); assert.match(child, /beforeunload/); assert.match(child, /w-full min-w-0/);
  assert.ok(!child.includes("localStorage")); assert.ok(!child.includes("setInterval"));
});
