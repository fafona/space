import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Clock, { SelfScheduleAssociation, SelfScheduleClockContent, selfScheduleConfirmationReady } from "../components/enterprise/MerchantAttendanceSelfScheduleClock";
import SelfPanel from "../components/enterprise/MerchantAttendanceSelfPanel";
import { AttendanceSelfScheduleClient, type SelfScheduleClientState } from "./merchantAttendanceSelfScheduleClient";
import type { AttendanceClientState } from "./merchantAttendanceSelfClient";
import type { SelfScheduleHttpResult, SelfScheduleSlot } from "./merchantAttendanceSelfSchedule";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const siteId = "99990001", employeeId = id(1), workerId = id(2), locationId = id(3);
const slot: SelfScheduleSlot = { id: id(20), revision: 1, locationId, locationName: "本地测试店", timeZone: "Europe/Madrid", workDate: "2026-10-05",
  startAt: "2026-10-05T07:00:00.000Z", endAt: "2026-10-05T15:00:00.000Z", cancelled: false, hasPublicationEvidence: true };
function response(): SelfScheduleHttpResult { return { ok: true, moduleEnabled: true, selectionEnabled: true, protocol: "self-schedule-v1",
  clock: { workerId, locationId, state: { sequence: 0, status: "off", lastEvent: null }, receipt: null, replayed: false },
  choices: { timeZone: "Europe/Madrid", fromDate: "2026-10-04", throughDate: "2026-10-06", revision: 1, limited: false, entries: [{ ...slot }] }, association: null }; }
const legacy = (): AttendanceClientState => ({ phase: "ready", result: { ...response().clock, moduleEnabled: true }, pending: null, confirmed: null, message: "已核对", authorizationEpoch: 0 });
type Mutable<T> = { -readonly [K in keyof T]: T[K] };
const state = (): Mutable<SelfScheduleClientState> => ({ phase: "ready", result: response(), pending: null, message: "已核对" });
let requests = 0, writes = 0;
const inert = { refresh: async () => { requests++; }, initialize: async () => {}, retry: async () => { writes++; }, submit: async () => { writes++; } };
function content(patch: Partial<Parameters<typeof SelfScheduleClockContent>[0]> = {}) {
  return renderToStaticMarkup(createElement(SelfScheduleClockContent, { client: inert, enabled: true, canClock: true, visible: true,
    legacyState: legacy(), state: state(), selection: "", setSelection() {}, ...patch }));
}
function association(status: "linked" | "unselected" | "unverified" = "linked") {
  const r = response(), receipt = { id: id(100), siteId, workerId, locationId, operationId: id(10), action: "clock_in" as const, sequence: 1,
    occurredAt: "2026-10-05T06:50:00.000Z", timeZone: "Europe/Madrid", breakPaid: null };
  r.clock = { ...r.clock, state: { sequence: 1, status: "working", lastEvent: receipt }, receipt };
  r.association = { startEventId: receipt.id, operationId: receipt.operationId, selection: status === "unselected" ? null : { slotId: slot.id, revision: 1 },
    status, reason: status === "unverified" ? "publication_missing" : null, slot: status === "unselected" ? null : { ...slot }, observedRevision: 1,
    recordedAt: "2026-10-05T06:50:00.001000Z", currentCancelled: status === "unselected" ? null : false };
  return r;
}
test("SSR does not request or inspect storage; feature-off parent still has the independent recovery controller", () => {
  const apiFetch = async () => { requests++; throw Error("no SSR request"); }, client = new AttendanceSelfScheduleClient({ siteId, employeeId, enabled: false,
    canClock: true, apiFetch, storage: () => { throw Error("must not read during render"); } });
  assert.equal(renderToStaticMarkup(createElement(Clock, { client, enabled: false, canClock: true, legacyState: legacy(), onConfirmed() {} })), "");
  const html = renderToStaticMarkup(createElement(SelfPanel, { siteId, employeeId, employeeName: "测试员工", canClock: true, apiFetch,
    selfScheduleEnabled: false, locationWorkspaceEnabled: false, exceptionWorkspaceEnabled: false, correctionWorkspaceEnabled: false }));
  assert.match(html, /我的考勤/); assert.doesNotMatch(html, /data-self-schedule-clock/); assert.equal(requests, 0); assert.equal(writes, 0);
});
test("one candidate still starts with an explicit placeholder; none is a real selectable choice", () => {
  const html = content(); assert.match(html, /aria-label="本次排班"/); assert.match(html, /value="" selected=""/);
  assert.match(html, /value="none">不关联排班/); assert.equal((html.match(/<option/g) ?? []).length, 3);
  assert.match(html, /disabled="">上班打卡 · 请先明确选择/); assert.match(html, /不会根据唯一时间候选自动选班/);
});
test("the actual submit label names the explicit selection and plans use saved local zone rather than browser zone", () => {
  const selected = content({ selection: slot.id }); assert.match(selected, /上班打卡 · 已选排班/); assert.match(selected, /09:00/); assert.match(selected, /17:00/);
  assert.match(selected, /Europe\/Madrid/); assert.doesNotMatch(selected, /2026-10-05T07:00:00/);
  assert.match(content({ selection: "none" }), /上班打卡 · 不关联排班/); assert.equal(writes, 0);
});
test("empty and limited candidates do not mean absence; limited still permits explicit unselected intent", () => {
  const s = state(); s.result!.choices.entries = []; assert.match(content({ state: s }), /不代表缺勤或没有工作/);
  s.result!.choices.limited = true; const html = content({ state: s, selection: "none" });
  assert.match(html, /不表示没有排班/); assert.match(html, /上班打卡 · 不关联排班/); assert.equal((html.match(/<option/g) ?? []).length, 2);
});
test("pending displays the original immutable choice and rollback removes editing/POST capability", () => {
  const s = state(); s.phase = "unconfirmed"; s.pending = { version: 1, siteId, employeeId,
    command: { action: "clock_in", operationId: id(10), expectedWorkerId: workerId, locationId, expectedSequence: 0 }, selection: { slotId: slot.id, revision: 1 } };
  const html = content({ state: s, enabled: false }); assert(html.includes(id(10))); assert(html.includes(slot.id)); assert.doesNotMatch(html, /<select/);
  assert.match(html, /disabled="">用原编号重试选班上班/); assert.match(html, /不会转用旧上班接口/);
});
test("legacy pending/storage error and read-only role disable new writes without masking original pending", () => {
  const old = legacy(); old.pending = { version: 1, siteId, employeeId, workerId, command: { action: "clock_in", operationId: id(9), expectedWorkerId: workerId, locationId, expectedSequence: 0 } };
  const both = content({ legacyState: old, selection: "none" }); assert.match(both, /只读核对，不重复提交/); assert.match(both, /disabled="">上班打卡 · 不关联排班/);
  assert.match(content({ canClock: false, selection: "none" }), /disabled="">上班打卡 · 不关联排班/);
  const broken = state(); broken.phase = "storage_error"; broken.result = null; broken.message = "存储不可用";
  assert.match(content({ state: broken, enabled: false }), /存储不可用/); assert.doesNotMatch(content({ state: broken, enabled: false }), /<select/);
});
test("linked result is a saved employee selection, not normal attendance or a physical-location claim", () => {
  const r = association(), html = renderToStaticMarkup(createElement(SelfScheduleAssociation, { result: r }));
  assert.match(html, /data-self-schedule-association="linked"/); assert.match(html, /上班时明确选择已保存/);
  assert.match(html, /不是自动时间匹配或现场证明/); assert.match(html, /不代表整班完成、迟到、早退、缺勤或工资结论/);
  assert.match(html, /计划 UTC：2026-10-05T07:00:00.000Z/);
  r.association!.currentCancelled = true; assert.match(renderToStaticMarkup(createElement(SelfScheduleAssociation, { result: r })), /不改写上班时的原选择/);
});
test("all four unverified reasons and explicit unselected/legacy results remain distinct", () => {
  for (const reason of ["publication_missing", "cancelled", "location_changed", "outside_window"] as const) {
    const r = association("unverified"); r.association!.reason = reason;
    assert.match(renderToStaticMarkup(createElement(SelfScheduleAssociation, { result: r })), /打卡已保存，排班关联待核验/);
  }
  assert.match(renderToStaticMarkup(createElement(SelfScheduleAssociation, { result: association("unselected") })), /本次明确不关联排班/);
  const old = association(); old.association = null; assert.match(renderToStaticMarkup(createElement(SelfScheduleAssociation, { result: old })), /没有用当前排班补写历史/);
});
test("untrusted labels are escaped and hidden view has no old slot or identity content", () => {
  const s = state(); s.result!.choices.entries[0].locationName = "<img src=x onerror=alert(1)>";
  const html = content({ state: s, selection: slot.id }); assert.match(html, /&lt;img/); assert.doesNotMatch(html, /<img/);
  assert.equal(content({ state: s, visible: false }), ""); assert.equal(requests, 0); assert.equal(writes, 0);
});
test("recent-choice read is offered only for an already authorized original clock-in, never a free UUID input", () => {
  const old = legacy(); old.result = { ...association().clock, moduleEnabled: true };
  const html = content({ legacyState: old }); assert.match(html, /读取最近上班选择/); assert.doesNotMatch(html, /type="text"|textarea/);
  old.result.state.lastEvent!.action = "clock_out"; old.result.state.status = "off";
  assert.doesNotMatch(content({ legacyState: old }), /读取最近上班选择/);
  old.result = null; old.phase = "blocked"; assert.doesNotMatch(content({ legacyState: old }), /读取最近上班选择/);
});
test("a confirmed new receipt waits for the old GET to finish before requesting one parent refresh", () => {
  const s = state(); s.result = association(); let seen: string | null = null, refreshes = 0;
  const apply = (busy: boolean, visible = true) => { const value = selfScheduleConfirmationReady(s, busy, visible, seen); if (value) { seen = value; refreshes++; } };
  apply(true); assert.equal(seen, null); assert.equal(refreshes, 0);
  apply(false, false); assert.equal(seen, null); apply(false); assert.equal(seen, id(10)); assert.equal(refreshes, 1);
  apply(false); assert.equal(refreshes, 1);
  s.pending = { version: 1, siteId, employeeId, command: { action: "clock_in", operationId: id(10), expectedWorkerId: workerId, locationId, expectedSequence: 0 }, selection: null };
  assert.equal(selfScheduleConfirmationReady(s, false, true, null), null);
});
test("isolated parent wiring gates all competing actions while old commands/client remain untouched", () => {
  const parent = readFileSync(new URL("../components/enterprise/MerchantAttendanceSelfPanel.tsx", import.meta.url), "utf8");
  const ui = readFileSync(new URL("../components/enterprise/MerchantAttendanceSelfScheduleClock.tsx", import.meta.url), "utf8");
  for (const text of ["scheduleClient.blocksOtherActions()", "window.sessionStorage.getItem(attendancePendingKey(siteId, employeeId)) === null",
    "!hasEmployeeLocationPending(window.sessionStorage, { siteId, employeeId })", "scheduleState.result?.selectionEnabled === false",
    'key={`self-schedule:${siteId}:${employeeId}:${state.authorizationEpoch}`}',
    "if (checkSchedulePending()) return", "!checkSchedulePending() && !checkLocationPending()", "scheduleBlocked || waiting", "active={!correctionOpen && !exceptionOpen && !locationOpen && !planExceptionOpen}"])
    assert(parent.includes(text));
  for (const text of ["flushSync(hide)", 'window.addEventListener("pagehide", onHidden)', "lease !== generation.current", "client.pause()", "if (legacyState.pending) return",
    "if (enabled || state.pending) void client.refresh()", "selectionState.result === state.result"]) assert(ui.includes(text));
  assert.doesNotMatch(ui, /localStorage|setInterval|node:crypto/);
});
