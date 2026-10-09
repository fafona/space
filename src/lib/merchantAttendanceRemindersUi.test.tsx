//Actual SSR and pure command binders only; no real browser/Auth/SQL evidence.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup as render } from "react-dom/server";
import Panel, { RemindersListView, RemindersReceiptView, reminderConfirm, reminderUiCommand } from "../components/enterprise/MerchantAttendanceRemindersPanel";
import Launcher, { reminderUiHandoff } from "../components/enterprise/MerchantAttendanceRemindersLauncher";
import { ATTENDANCE_REMINDERS_PROTOCOL, parseAttendanceReminderResult, type AttendanceReminderBatch,
  type AttendanceReminderSummary, type AttendanceReminderResult } from "./merchantAttendanceReminders";
const id = (n: number) => `20100000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const siteId = "99990201", actorId = id(1), stamp = "2026-10-08T14:05:00.000000Z";
const batch: AttendanceReminderBatch = { batchId: id(2), category: "pending_review", windowStart: "2026-10-08T14:00:00.000000Z", windowEnd: "2026-10-08T15:00:00.000000Z",
  recordedAt: stamp, itemCount: 1, readAt: null, items: [{ planId: id(3), ordinal: 1, observedAt: stamp, target: { kind: "pending_review", family: "correction", requestId: id(4), responsibilityRevision: 1, responsibilityOperationId: id(4) } }] };
const source = readFileSync(new URL("../components/enterprise/MerchantAttendanceRemindersPanel.tsx", import.meta.url), "utf8");
test("201 SSR Launcher and Panel perform zero HTTP and require actual Auth callback, defaultoff and narrow responsive controls", () => {
  let calls = 0; const props = { siteId, actorId, apiFetch: async () => { calls++; throw Error("unexpected"); }, onClose: () => {} };
  assert.equal(render(<Panel {...props}/>), ""); assert.equal(render(<Panel {...props} isCurrentAuth={() => false}/>), "");
  assert.equal(render(<Panel {...props} isCurrentAuth={() => { throw Error(); }}/>), "");
  const owner = render(<Panel {...props} ownerId={actorId} isCurrentAuth={() => true}/>);
  assert.match(owner, /新提醒操作尚未开放/); assert.match(owner, /现在手动检查本窗/); assert.match(owner, /以 GET 核验原操作/);
  assert.match(owner, /min-w-0 max-w-full/); assert.match(owner, /flex-wrap/); assert.doesNotMatch(owner, /data-reminder-batch|data-reminder-list/);
  const recipient = render(<Panel {...props} isCurrentAuth={() => true}/>); assert.doesNotMatch(recipient, /现在手动检查本窗/);
  const recovery = render(<Panel {...props} recoveryOnly ownerId={actorId} isCurrentAuth={() => true}/>); assert.doesNotMatch(recovery, />读取提醒列表<|>现在手动检查本窗</);
  const button = render(<Launcher {...props} isCurrentAuth={() => true}/>); assert.match(button, /考勤站内提醒/); assert.doesNotMatch(button, /<dialog|考勤站内提醒工作区/);
  assert.equal(render(<Launcher {...props}/>), ""); assert.equal(calls, 0);
});
test("201 exact mark-read/run commands neither navigate nor auto-run and confirmation fences Auth changes", () => {
  const mark = reminderUiCommand(siteId, id(5), "mark_read", batch); assert.equal(mark.query.mode, "detail");
  assert.deepEqual(mark.command, { action: "mark_read", operationId: id(5), batchId: batch.batchId });
  const first = reminderUiCommand(siteId, id(6), "run_due", null); assert.deepEqual(first.command, { action: "run_due", operationId: id(6), cursor: null });
  const cursor = { runOperationId: id(6), afterDueAt: stamp, afterPlanId: id(7), cutoffAt: stamp };
  assert.deepEqual(reminderUiCommand(siteId, id(8), "run_due", cursor).command, { action: "run_due", operationId: id(8), cursor });
  let dispatched = 0, current = true; assert.equal(reminderConfirm(() => false, () => true, () => dispatched++), false);
  assert.equal(reminderConfirm(() => { current = false; return true; }, () => current, () => dispatched++), false); assert.equal(dispatched, 0);
  assert.equal(reminderConfirm(() => true, () => true, () => dispatched++), true); assert.equal(dispatched, 1);
});
test("201 list25+1 DTO and SSR reflect explicit keyset pages without making network/approval claims", async () => {
  const summaries: AttendanceReminderSummary[] = Array.from({ length: 26 }, (_, n) => ({ batchId: id(100 - n), category: "pending_review", windowStart: batch.windowStart,
    windowEnd: batch.windowEnd, recordedAt: stamp, itemCount: 1, readAt: null }));
  const query = { siteId, mode: "list" as const, batchId: null, operationId: null, cursor: null }, last = summaries[24];
  const base = { protocol: ATTENDANCE_REMINDERS_PROTOCOL, siteId, actor: { kind: "auth" as const, authUserId: actorId }, readAt: stamp, receipt: null };
  const nextCursor = { beforeAt: last.recordedAt, beforeId: last.batchId };
  const first = await parseAttendanceReminderResult({ ...base, data: { kind: "list", items: summaries.slice(0, 25), nextCursor } }, query, actorId);
  const next = await parseAttendanceReminderResult({ ...base, data: { kind: "list", items: summaries.slice(25), nextCursor: null } }, { ...query, cursor: nextCursor }, actorId);
  if (first.data.kind !== "list" || next.data.kind !== "list") throw Error();
  assert.equal(first.data.items.length, 25); assert.equal(next.data.items.length, 1); assert.equal(next.data.nextCursor, null);
  const html = render(<RemindersListView items={first.data.items} disabled={false} onDetail={() => { throw Error(); }}/>);
  assert.equal((html.match(/明确读取此提醒详情/g) ?? []).length, 25); assert.match(html, /不会自动加载/);
  await assert.rejects(parseAttendanceReminderResult({ ...base, data: { kind: "list", items: summaries, nextCursor } }, query, actorId));
});
test("201 receipt view distinguishes POST from original GET and manual runner is not a scheduler", () => {
  const value: AttendanceReminderResult = { protocol: ATTENDANCE_REMINDERS_PROTOCOL, siteId, actor: { kind: "auth", authUserId: actorId }, readAt: stamp, data: { kind: "receipt" },
    receipt: { operationId: id(5), action: "mark_read", actorKind: "auth", actorId, commandFingerprint: "a".repeat(64), recordedAt: stamp, result: { kind: "mark_read", batchId: batch.batchId, readAt: stamp } } };
  assert.match(render(<RemindersReceiptView value={value} verified={false}/>), /仅收到提交响应，仍需原号 GET 核验/);
  assert.match(render(<RemindersReceiptView value={value} verified/>), /原号 GET 已核验/);
  assert.match(render(<RemindersReceiptView value={value} verified/>), /未打开、审批或处理原业务/);
  assert.match(source, /手动检查不是自动提醒调度/); assert.match(source, /snapshot\.query\?\.mode === "recover"/);
});
test("201 SOURCE has sync requester/Auth fences, hide/pagehide clear body, raw-slot leave guards and no automatic GET", () => {
  for (const text of ["props.requesterKey", "marker.fetch !== props.apiFetch", "marker.auth !== props.isCurrentAuth", "!remindersAuthCurrent(props.isCurrentAuth)",
    "flushSync", 'window.addEventListener("pagehide", pause)', 'document.addEventListener("visibilitychange", visibility)', "client.pause()", "navigation?.pause()", "registerLeaveGuard?.(mayLeave)", "setLocalReady(false)"]) assert.ok(source.includes(text), text);
  const effect = source.slice(source.indexOf("useLayoutEffect(() => {"), source.indexOf("const run = async"));
  assert.match(effect, /client\.load\(\)/); assert.doesNotMatch(effect, /client\.(read|submit|recover)\(/);
  assert.doesNotMatch(source, /setInterval|location\.href|window\.open|\.removeItem\(/);
});
test("201 effect replay pauses both memoized clients instead of permanently disposing them", () => {
  const cleanup = source.slice(source.indexOf("return () => { mounted.current = false"), source.indexOf("}, [client, navigation"));
  assert.match(cleanup, /invalidate\(\); client\.pause\(\); navigation\?\.pause\(\); selfNavigation\?\.pause\(\)/);
  assert.match(cleanup, /registerLeaveGuard\?\.\(null\)/);
  assert.doesNotMatch(cleanup, /\.dispose\(/);
});
test("201 original handoff closes reminder modal only when the actual host accepts in the same current generation", () => {
  let current = true, calls = 0, closed = 0;
  const open = () => { calls++; return true; }, close = () => { closed++; };
  assert.equal(reminderUiHandoff(() => false, open, close), false); assert.equal(calls, 0);
  assert.equal(reminderUiHandoff(() => true, () => false, close), false); assert.equal(closed, 0);
  assert.equal(reminderUiHandoff(() => current, () => { current = false; return true; }, close), false); assert.equal(closed, 0);
  assert.equal(reminderUiHandoff(() => true, open, close), true); assert.equal(calls, 1); assert.equal(closed, 1);
  const launcher = readFileSync(new URL("../components/enterprise/MerchantAttendanceRemindersLauncher.tsx", import.meta.url), "utf8");
  for (const part of ["token === generation.current", "mountedOpen.current", "!document.hidden", "remindersAuthCurrent(props.isCurrentAuth)",
    "request => handoff(() => props.onOpenOriginal!", "value => handoff(() => props.onOpenPeriod!"]) assert(launcher.includes(part), part);
  assert.doesNotMatch(launcher, /sessionStorage\.(removeItem|setItem)|localStorage/);
});
