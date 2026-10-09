import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup as render } from "react-dom/server";
import Launcher, { eventNotificationsLauncherVisible } from "../components/enterprise/MerchantAttendanceEventNotificationsLauncher";
import Panel, { EventNotificationCard, EventNotificationList, EventNotificationSummary, EventNotificationDetailView,
  confirmEventNotificationRead, eventNotificationReadReady } from "../components/enterprise/MerchantAttendanceEventNotificationsPanel";
import { parseEventNotificationsDetail, type EventNotificationsDetail, type EventNotificationsItem, type EventNotificationsResult } from "./merchantAttendanceEventNotifications";

// Detached, synthetic shape fixtures only. No historical authorization or business result is claimed.
const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const site = "99990001", employee = id(1), no = () => {};
const from = "2026-10-25T00:15:00.000001Z", to = "2026-10-25T01:15:00.000009Z", occurredAt = "2026-10-06T09:00:00.000001Z";
const file = (name: string) => readFileSync(new URL(`../components/enterprise/${name}.tsx`, import.meta.url), "utf8");
function detail(category: EventNotificationsItem["sourceCategory"] = "schedule", type?: EventNotificationsItem["type"]): EventNotificationsDetail {
  const common = { notificationId: id(10), sourceOperationId: id(11), sourceId: id(12), occurredAt, readAt: null };
  if (category === "schedule") return parseEventNotificationsDetail({ ...common, sourceCategory: category, sourceId: type === "cancelled" ? id(13) : id(11), sourceRevision: null, type: type ?? "published", summary: { segments: [{ slotId: id(13), startAt: from, endAt: to, timeZone: "Europe/Madrid" }] } });
  if (category === "work_arrangement") return parseEventNotificationsDetail({ ...common, sourceCategory: category, sourceRevision: type === "approval_cancelled" ? 3 : 2, type: type ?? "approved", summary: { kind: "remote", startAt: from, endAt: to, timeZone: "Europe/Madrid" } });
  return parseEventNotificationsDetail({ ...common, sourceCategory: category, sourceRevision: 7, type: type ?? "follow_up", summary: { slotId: id(13), startAt: from, endAt: to, timeZone: "Europe/Madrid", outcome: type ?? "follow_up" } });
}
function result(d: EventNotificationsDetail | null = detail(), patch: Partial<EventNotificationsResult> = {}): EventNotificationsResult {
  return { protocol: "event-notifications-v1", siteId: site, actorId: id(2), employeeId: employee, workerId: id(3), items: [], nextCursor: null, detail: d, canMarkRead: true, ...patch };
}
function item(d: EventNotificationsDetail): EventNotificationsItem { const { summary, ...value } = d; void summary; return value; }

test("default-off and inactive launcher hide without requests; enabled panel initializes only on client", () => {
  let calls = 0; const apiFetch = async () => { calls++; throw Error("unexpected"); }, props = { siteId: site, employeeId: employee, apiFetch };
  assert.equal(render(<Launcher {...props} enabled={false}/>), ""); assert.equal(render(<Launcher {...props} enabled active={false}/>), "");
  assert.match(render(<Launcher {...props} enabled/>), /考勤消息/);
  const html = render(<Panel {...props} enabled onClose={no}/>); assert.match(html, /读取考勤消息/); assert.match(html, /查看不会自动标读/);
  assert(!html.includes(id(10))); assert.equal(calls, 0);
});
test("exact pending discovery remains flag-off reachable and open recovery does not disappear on CAS clear", () => {
  assert(!eventNotificationsLauncherVisible(false, false, false)); assert(eventNotificationsLauncherVisible(false, true, false));
  assert(eventNotificationsLauncherVisible(false, false, true)); assert(eventNotificationsLauncherVisible(true, false, false));
  const text = file("MerchantAttendanceEventNotificationsLauncher"); assert.match(text, /eventNotificationsPendingKey\(props.siteId, props.employeeId\)/);
  assert(!text.includes("sessionStorage.length")); assert(!text.includes("localStorage")); assert.match(text, /key=\{`\$\{props.siteId\}:\$\{props.employeeId\}`\}/);
});
test("all eight event types say historical result and expose distinct message and source identifiers", () => {
  const cases = [["schedule", "published", "排班已发布"], ["schedule", "cancelled", "班次已取消"], ["work_arrangement", "approved", "工作安排已批准"], ["work_arrangement", "rejected", "工作安排已驳回"], ["work_arrangement", "approval_cancelled", "工作安排批准已取消"], ["plan_exception", "confirmed", "异常已确认"], ["plan_exception", "excused", "异常已豁免"], ["plan_exception", "follow_up", "异常继续核查"]] as const;
  for (const [category, type, label] of cases) { const d = detail(category, type), html = render(<EventNotificationCard item={item(d)}/>);
    assert(html.includes(label)); assert.match(html, /当时结果/); assert(html.includes(d.notificationId)); assert(html.includes(d.sourceId)); assert(html.includes(d.sourceOperationId)); assert(!html.includes("<form")); }
});
test("list renders only saved item metadata, no names or business summary and no automatic mark control", () => {
  const items = Array.from({ length: 25 }, (_, n) => ({ ...item(detail()), notificationId: id(100 + n) }));
  const html = render(<EventNotificationList result={result(null, { items, nextCursor: { at: occurredAt, id: id(124) } })} disabled={false} onDetail={no} onNext={no}/>);
  assert.equal((html.match(/data-event-notification-id=/g) ?? []).length, 25); assert.equal((html.match(/查看考勤消息详情/g) ?? []).length, 25);
  assert.match(html, /下一页考勤消息/); assert(!html.includes(from)); assert(!html.includes("<form")); assert(!html.includes('type="checkbox"'));
  assert.match(html, /没有未读总数、全部已读或常驻刷新/);
});
test("empty and missing worker states never claim there was no underlying attendance history", () => {
  assert.match(render(<EventNotificationList result={result(null)} disabled={false} onDetail={no} onNext={no}/>), /不代表没有排班、安排或处理历史/);
  const empty = render(<EventNotificationList result={result(null, { workerId: null, canMarkRead: false })} disabled={false} onDetail={no} onNext={no}/>);
  assert.match(empty, /不能认领旧档案的消息/); assert.match(empty, /disabled=""[^>]*>下一页考勤消息/);
});
test("all 32 saved schedule segments render without trimming or current timezone recomputation", () => {
  const d = detail(); assert.equal(d.sourceCategory, "schedule"); if (d.sourceCategory !== "schedule") return;
  const value = { ...d, summary: { segments: Array.from({ length: 32 }, (_, n) => ({ slotId: id(200 + n), startAt: from, endAt: to, timeZone: "Saved/Alias" })) } };
  const original = Intl.DateTimeFormat;
  try { Object.defineProperty(Intl, "DateTimeFormat", { configurable: true, value: function () { throw Error("do not recalculate"); } });
    const html = render(<EventNotificationSummary detail={value}/>); assert.equal((html.match(/班次编号/g) ?? []).length, 32);
    assert(html.includes(id(231))); assert(html.includes(from)); assert(html.includes(to)); assert.match(html, /Saved\/Alias/);
  } finally { Object.defineProperty(Intl, "DateTimeFormat", { configurable: true, value: original }); }
});
test("work arrangement and exception descriptions preserve non-hours and non-ack boundaries", () => {
  const w = render(<EventNotificationSummary detail={detail("work_arrangement")}/>), e = render(<EventNotificationSummary detail={detail("plan_exception")}/>);
  assert.match(w, /远程/); assert.match(w, /不自动计工时或豁免异常/); assert.match(e, /不提交异常业务已读确认/);
  for (const html of [w, e]) { assert(html.includes(from)); assert(html.includes(to)); assert(!html.includes("<a")); }
});
test("details do not assert latest business status or auto-check acknowledgement", () => {
  for (const category of ["schedule", "work_arrangement", "plan_exception"] as const) {
    const html = render(<EventNotificationDetailView result={result(detail(category))} disabled={false}/>);
    assert.match(html, /当前事项状态未重新核查/); assert.match(html, /不证明目前仍获批准/); assert(!html.includes(' checked=""'));
    assert.match(html, /disabled=""[^>]*>明确标记这条消息已读/); assert.match(html, /不代表同意，不提交异常或周期确认/);
  }
});
test("mark readiness requires explicit checkbox, current detail, worker, server authority and frontend flag", () => {
  const r = result(); assert(eventNotificationReadReady(r, true, true, false));
  for (const [ack, enabled, disabled] of [[false, true, false], [true, false, false], [true, true, true]]) assert(!eventNotificationReadReady(r, ack, enabled, disabled));
  for (const patch of [{ detail: null }, { workerId: null }, { canMarkRead: false }, { detail: { ...detail(), readAt: "2026-10-06T10:00:00.000001Z" } }]) assert(!eventNotificationReadReady({ ...r, ...patch }, true, true, false));
});
test("verified read timestamp removes mark button; explicit pending retry remains separately labelled", () => {
  const html = render(<EventNotificationDetailView result={result({ ...detail(), readAt: "2026-10-06T10:00:00.000001Z" })} disabled={false}/>);
  assert.match(html, /data-event-notification-read-at/); assert(!html.includes("<form")); assert(!html.includes("<button")); assert.match(html, /不是同意或业务确认/);
  const retry = render(<EventNotificationDetailView result={result()} disabled={false} retry/>); assert.match(retry, /明确再次标记这条消息已读/);
  assert.match(render(<EventNotificationDetailView result={result()} enabled={false} disabled={false} retry/>), /disabled=""[^>]*>明确再次标记这条消息已读/);
});
test("confirmation rechecks synchronous identity or lifetime changes before writing", () => {
  let current = true, writes = 0;
  assert(!confirmEventNotificationRead(() => { current = false; return true; }, () => current, () => writes++)); assert.equal(writes, 0);
  current = true; assert(!confirmEventNotificationRead(() => false, () => current, () => writes++)); assert.equal(writes, 0);
  assert(confirmEventNotificationRead(() => true, () => current, () => writes++)); assert.equal(writes, 1);
});
test("saved text is escaped, read summary does not expose source reasons, names or unrelated evidence", () => {
  const d = detail("work_arrangement"); assert.equal(d.sourceCategory, "work_arrangement"); if (d.sourceCategory !== "work_arrangement") return;
  const html = render(<EventNotificationSummary detail={{ ...d, summary: { ...d.summary, timeZone: "<script>bad</script>" } }}/>);
  assert(!html.includes("<script>")); assert.match(html, /&lt;script/);
  const source = file("MerchantAttendanceEventNotificationsPanel"); for (const value of ["pending.command", "summary.reason", "summary.workerName", "geolocation", "localStorage", "setInterval(", "client.retry("]) assert(!source.includes(value));
});
test("sixth parent leave guard preserves prior guards and old notification entry without a clock interlock", () => {
  const self = file("MerchantAttendanceSelfPanel"); assert.match(self, /NEXT_PUBLIC_FAOLLA_ATTENDANCE_EVENT_NOTIFICATIONS_ENABLED === "1"/);
  assert.match(self, /event-notifications:.*state.authorizationEpoch/); assert.match(self, /registerLeaveGuard=\{registerEventNotificationsLeaveGuard\}/);
  assert.match(self, /!eventNotificationsLeaveGuard.current \|\| eventNotificationsLeaveGuard.current\(\)/);
  const callbacks = self.slice(self.indexOf("const registerPeriodLeaveGuard"), self.indexOf("const mayLeavePeriod"));
  assert.equal((callbacks.match(/eventNotificationsLeaveGuard.current/g) ?? []).length, 6);
  assert.match(self, /<LeaveNotificationsLauncher key=\{`notifications:/);
  assert(!self.includes("eventNotificationsPendingKey")); assert(!self.slice(self.indexOf("const scheduleBlocked"), self.indexOf("const onScheduleConfirmed")).includes("eventNotifications"));
});
test("hidden and context changes clear authorized body; Escape cancellation does not bypass dirty guard", () => {
  const panel = file("MerchantAttendanceEventNotificationsPanel"), launcher = file("MerchantAttendanceEventNotificationsLauncher");
  for (const name of ["visibilitychange", "pagehide", "pageshow", "beforeunload"]) assert(panel.includes(name));
  assert.match(panel, /const result = shown \? state.result : null, pending = shown \? state.pending : null/);
  assert.match(panel, /client.getSnapshot\(\) === snapshot/); assert.match(panel, /client.recover\(\)/);
  assert.match(launcher, /queueMicrotask/); assert.match(launcher, /event.preventDefault\(\); event.stopPropagation\(\); close\(\)/);
  assert(!panel.includes("setTimeout(")); assert(!panel.includes("<a "));
});
