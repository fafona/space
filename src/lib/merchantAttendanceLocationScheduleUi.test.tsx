import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Panel from "../components/enterprise/MerchantAttendanceLocationClockPanel";
import { LocationScheduleClockContent, LocationScheduleReceipt, locationScheduleConfirmationReady, locationScheduleWorkspaceActivity } from "../components/enterprise/MerchantAttendanceLocationScheduleClock";
import type { LocationScheduleClientState } from "./merchantAttendanceLocationScheduleClient";
import type { AttendanceLocationClockClient } from "./merchantAttendanceLocationClockClient";
import { locationScheduleHttp, locationScheduleId as id, locationScheduleEmployee, locationScheduleSite, locationScheduleCommand } from "../../scripts/fixtures/attendance-location-schedule-model";

type Legacy = ReturnType<AttendanceLocationClockClient["getSnapshot"]>;
const base = (): Legacy => ({ phase: "ready", result: { ...locationScheduleHttp().clock, moduleEnabled: true }, pending: null, confirmed: null, message: "旧路径就绪" });
const state = (): LocationScheduleClientState => ({ phase: "ready", result: locationScheduleHttp(), confirmed: null, pending: null, message: "核对完成" });
const no = () => {}, asyncNo = async () => {};
const client = { refresh: asyncNo, initialize: asyncNo, submit: asyncNo, retry: asyncNo, pause: no };
function html(patch: Partial<React.ComponentProps<typeof LocationScheduleClockContent>> = {}) {
  return renderToStaticMarkup(<LocationScheduleClockContent client={client} state={state()} legacyState={base()} enabled canClock visible selection="" setSelection={no}
    failure="not_provided" setFailure={no} acknowledged={false} setAcknowledged={no} {...patch}/>);
}
function pendingState(): LocationScheduleClientState {
  const { position: _p, positionFailure: _f, ...intent } = locationScheduleCommand(); void _p; void _f;
  return { ...state(), phase: "unconfirmed", pending: { version: 1, siteId: locationScheduleSite, employeeId: locationScheduleEmployee, intent, selection: { slotId: id(6), revision: 3 } } };
}
test("new default-off parent SSR performs no HTTP/GPS and exposes no selected action", () => {
  let reads = 0, gps = 0;
  const markup = renderToStaticMarkup(<Panel siteId={locationScheduleSite} employeeId={locationScheduleEmployee} workerId={id(3)} canClock locationScheduleEnabled={false}
    apiFetch={async () => { reads++; throw Error("unexpected"); }} environment={{ isSecureContext: () => true, isVisible: () => true, geolocation: () => { gps++; return null; } }}/>);
  assert.equal(reads, 0); assert.equal(gps, 0); assert.ok(!markup.includes("data-location-schedule-clock")); assert.ok(markup.includes("定位并登记"));
});
test("blank selection stays explicit placeholder and cannot submit", () => {
  const markup = html(); assert.match(markup, /<option value="" selected="">请明确选择/); assert.match(markup, /disabled=""[^>]*>定位上班 · 请先明确选择/);
  assert.match(markup, /核对定位选班与原号/); assert.match(markup, /不关联排班/);
});
test("none and listed slot get distinct submit labels; no automatic matching claim", () => {
  assert.match(html({ selection: "none" }), /定位上班 · 不关联排班/); assert.match(html({ selection: id(6) }), /定位上班 · 已选排班/);
  assert.match(html(), /不会自动选班/);
});
test("feature off pending shows original ID and read-only recovery but no retry authorization", () => {
  const markup = html({ enabled: false, state: pendingState() }); assert.match(markup, new RegExp(id(5))); assert.match(markup, /核对定位选班与原号/);
  assert.match(markup, /disabled=""[^>]*>原编号定位重试/); assert.match(markup, /不会降级为旧上班提交/); assert.ok(!markup.includes('aria-label="本次定位排班"'));
  assert.equal(html({ enabled: false, state: { ...state(), result: null } }), "");
});
test("old pending and new pending coexist only with GET controls", () => {
  const legacy = base(); legacy.pending = { version: 1, siteId: locationScheduleSite, employeeId: locationScheduleEmployee, intent: pendingState().pending!.intent }; legacy.phase = "unconfirmed";
  const markup = html({ state: pendingState(), legacyState: legacy }); assert.match(markup, /两个编号同时存在/); assert.match(markup, /disabled=""[^>]*>原编号定位重试/);
  assert.match(markup, /disabled=""[^>]*>原编号无定位重试/);
});
test("notice block, paused module and legacy busy each prohibit new write", () => {
  for (const condition of ["notice", "paused", "legacy"] as const) {
    const s = state(), legacy = base();
    if (condition === "notice") s.result!.clock.noticeGate.ready = false;
    if (condition === "paused") s.result!.moduleEnabled = false;
    if (condition === "legacy") legacy.phase = "loading";
    assert.match(html({ state: s, legacyState: legacy, selection: "none" }), /disabled=""[^>]*>定位上班 · 不关联排班/);
  }
});
test("limited candidates are not described as no schedule; empty window is not absence", () => {
  const limited = state(); limited.result!.choices.entries = []; limited.result!.choices.limited = true;
  assert.match(html({ state: limited }), /超过本次有界读取上限，不等于没有排班/);
  const empty = state(); empty.result!.choices.entries = []; assert.match(html({ state: empty }), /没有候选，不等于没有工作或缺勤/);
});
test("saved receipt separates association, adoption and exact original provenance", () => {
  const markup = renderToStaticMarkup(<LocationScheduleReceipt result={locationScheduleHttp(true)}/>);
  for (const text of ["data-location-schedule-association=\"linked\"", "data-location-schedule-adoption=\"adopted\"", id(5), id(7), id(8), "a".repeat(64), "告知版本", "不代表迟到、早退"]) assert.ok(markup.includes(text), text);
});
test("not-approved, unselected, unverified and legacy are not conflated", () => {
  for (const status of ["not_approved", "unselected", "unverified"] as const) {
    const r = locationScheduleHttp(true); r.adoption!.status = status; r.adoption!.approval = null;
    const markup = renderToStaticMarkup(<LocationScheduleReceipt result={r}/>); assert.ok(markup.includes(`data-location-schedule-adoption="${status}"`));
  }
  const r = locationScheduleHttp(true); r.association = null; r.adoption = null;
  assert.match(renderToStaticMarkup(<LocationScheduleReceipt result={r}/>), /未用当前计划补写历史/);
});
test("react escapes names; saved current cancellation preserves original selection", () => {
  const r = locationScheduleHttp(true); r.association!.slot!.locationName = '<img src=x onerror="boom">'; r.association!.currentCancelled = true;
  const markup = renderToStaticMarkup(<LocationScheduleReceipt result={r}/>); assert.ok(!markup.includes("<img")); assert.match(markup, /&lt;img/); assert.match(markup, /原选择与原打卡不会因此撤销/);
});
test("confirmation refresh waits for old client, visibility and settled pending; only once per op", () => {
  const s: LocationScheduleClientState = { ...state(), confirmed: locationScheduleHttp(true) };
  assert.equal(locationScheduleConfirmationReady(s, false, true, null), id(5)); assert.equal(locationScheduleConfirmationReady(s, true, true, null), null);
  assert.equal(locationScheduleConfirmationReady(s, false, false, null), null); assert.equal(locationScheduleConfirmationReady(s, false, true, id(5)), null);
  assert.equal(locationScheduleConfirmationReady({ ...s, pending: pendingState().pending }, false, true, null), null);
});
test("workspace has one combined busy/pending/confirmed source rather than competing reporters", () => {
  const legacy = base(), s = state(); assert.deepEqual(locationScheduleWorkspaceActivity(legacy, s), { phase: "paused", pendingId: null, receiptId: null });
  assert.equal(locationScheduleWorkspaceActivity(legacy, { ...s, phase: "locating" }).phase, "loading");
  assert.equal(locationScheduleWorkspaceActivity({ ...legacy, phase: "submitting" }, s).phase, "loading");
  assert.equal(locationScheduleWorkspaceActivity(legacy, pendingState()).pendingId, id(5));
  assert.equal(locationScheduleWorkspaceActivity(legacy, { ...s, phase: "storage_error" }).phase, "loading");
});
test("parent integration guards old POST/retry/finish while preserving original code paths", () => {
  const source = readFileSync(new URL("../components/enterprise/MerchantAttendanceLocationClockPanel.tsx", import.meta.url), "utf8");
  assert.equal((source.match(/useAttendanceLocationWorkspaceActivity\(onWorkspaceActivity/g) ?? []).length, 1);
  assert.equal((source.match(/if \(scheduleClient.blocksOtherActions\(\)\) return/g) ?? []).length, 3);
  assert.match(source, /NEXT_PUBLIC_FAOLLA_ATTENDANCE_LOCATION_SCHEDULE_ENABLED === "1"/); assert.match(source, /active=\{state.phase !== "blocked"\}/);
  for (const original of ["client.finish()", "client.retry(failure)", "client.submit(action, failure)", "client.refresh()"] ) assert.ok(source.includes(original));
  const child = readFileSync(new URL("../components/enterprise/MerchantAttendanceLocationScheduleClock.tsx", import.meta.url), "utf8");
  assert.match(child, /await client.initialize\(\)/); assert.match(child, /pagehide/); assert.match(child, /beforeunload/);
  assert.ok(!child.includes("localStorage")); assert.ok(!child.includes("setInterval")); assert.match(child, /w-full min-w-0/); assert.match(child, /flex flex-wrap/);
});
