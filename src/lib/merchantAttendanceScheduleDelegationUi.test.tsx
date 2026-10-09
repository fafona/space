import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup as render } from "react-dom/server";
import Launcher, { scheduleDelegationLauncherVisible } from "../components/enterprise/MerchantAttendanceScheduleDelegationLauncher";
import Panel, { ScheduleDelegationChoices, ScheduleDelegationCatalog, ScheduleDelegationGrantForm, ScheduleDelegationGrantView, ScheduleDelegationScheduleView,
  ScheduleDelegationPublishForm, ScheduleDelegationReceipt, scheduleDelegationEmptyDraft, scheduleDelegationReasonValid, scheduleDelegationUtc,
  scheduleDelegationRangeValid, previewDelegatedSchedule, confirmScheduleDelegationAction } from "../components/enterprise/MerchantAttendanceScheduleDelegationPanel";
import type { ScheduleDelegationCatalogItem, ScheduleDelegationGrant, ScheduleDelegationSchedule, ScheduleDelegationResult } from "./merchantAttendanceScheduleDelegation";
import type { ScheduleWallSlot } from "./merchantAttendanceSchedule";

// Detached shape fixtures for pure rendering only; not historical authorization evidence.
const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const no = () => {}, site = "99990001", owner = id(1), employee = id(2), auth = id(3);
const file = (name: string) => readFileSync(new URL(`../components/enterprise/${name}.tsx`, import.meta.url), "utf8");
function choices() { return { delegate: { id: employee, employeeId: employee, employeeAuthUserId: auth, name: "合成主管", workerNo: null, timeZone: null },
  worker: { id: id(4), employeeId: id(5), employeeAuthUserId: id(6), name: "合成目标", workerNo: "W1", timeZone: null },
  location: { id: id(7), employeeId: null, employeeAuthUserId: null, name: "合成地点", workerNo: null, timeZone: "Europe/Madrid" } }; }
function grant(patch: Partial<ScheduleDelegationGrant> = {}): ScheduleDelegationGrant { return { grantId: id(8), revision: 1, status: "granted", delegate: { employeeId: employee, authUserId: auth, name: "合成主管" },
  worker: { workerId: id(4), employeeId: id(5), authUserId: id(6), name: "合成目标", workerNo: "W1" }, location: { id: id(7), name: "合成地点", timeZone: "Europe/Madrid" }, actions: ["publish", "cancel"], usableActions: ["publish", "cancel"], includeExistingFuture: false,
  validFrom: "2026-01-01T00:00:00.000000Z", validUntil: "2027-01-01T00:00:00.000000Z", grantedBy: owner, grantedAt: "2026-01-01T00:00:00.000000Z", reason: "合成授权理由", revocation: null, ...patch }; }
function schedule(patch: Partial<ScheduleDelegationSchedule> = {}): ScheduleDelegationSchedule { return { grant: grant(), revision: 7, settingsVersion: 3, timeZone: "Europe/Madrid", workerVersion: 4, locationVersion: 2, readAt: "2026-10-06T09:00:00.000000Z",
  entries: [{ slotId: id(9), revision: 6, workerId: id(4), locationId: id(7), timeZone: "Europe/Madrid", workDate: "2026-10-25", startAt: "2026-10-25T07:00:00.000Z", endAt: "2026-10-25T08:00:00.000Z", publishedAt: "2026-10-06T08:00:00.000000Z", publishedBy: auth, cancelled: false, cancelledAt: null, cancelledBy: null, canCancel: true }], rangeLimited: false, ...patch }; }
function receipt(action: "grant" | "revoke" | "publish" | "cancel" = "publish"): ScheduleDelegationResult { return { protocol: "schedule-delegation-v1", siteId: site, access: "delegate", actorId: auth, employeeId: employee, mode: "recover", canWrite: false,
  grants: [], catalogItems: [], nextAfterId: null, detail: null, schedule: null, receipt: { operationId: id(10), action, grantId: id(8), grantRevision: action === "revoke" ? 2 : 1, scheduleRevision: action === "publish" || action === "cancel" ? 7 : null, actorId: auth, recordedAt: "2026-10-06T09:00:00.000000Z", commandFingerprint: "a".repeat(64) }, readAt: "2026-10-06T10:00:00.000000Z" }; }
const draft = () => ({ ...scheduleDelegationEmptyDraft(), actions: ["publish", "cancel"] as ("publish" | "cancel")[], from: "2026-10-06T00:00", until: "2026-11-06T00:00", reason: "明确授权", ack: true });
const form = (value = draft(), selected = choices(), disabled = false) => render(<ScheduleDelegationGrantForm draft={value} choices={selected} disabled={disabled} onDraft={no} onGrant={no}/>);
const grantButton = (html: string) => html.match(/<button[^>]*>明确授予排班委托<\/button>/)?.[0] ?? assert.fail("grant button missing");
const row = (start: string, end: string, startOffset = "", endOffset = ""): ScheduleWallSlot => ({ start, end, startOffset, endOffset });

test("default-off owner keeps lazy verification entry; delegate has none; SSR performs zero requests", () => {
  let calls = 0; const apiFetch = async () => { calls++; throw Error("unexpected"); };
  for (const access of ["owner", "delegate"] as const) { const props = { siteId: site, access, actorId: access === "owner" ? owner : employee, apiFetch };
    assert.equal(render(<Launcher {...props} enabled active={false}/>), "");
    const off = render(<Launcher {...props} enabled={false}/>); if (access === "owner") assert.match(off, /排班授权核验／撤销/); else assert.equal(off, "");
    assert.match(render(<Launcher {...props} enabled/>), access === "owner" ? /主管排班授权/ : /受托排班/);
    const html = render(<Panel {...props} enabled onClose={no}/>); assert.match(html, /读取排班授权列表|读取我的排班授权/); assert(!html.includes("合成目标")); }
  assert.equal(calls, 0);
});
test("cleared pending cannot dismiss opened flag-off receipt; owner verification remains reachable", () => {
  assert(scheduleDelegationLauncherVisible("owner", false, false, false)); assert(!scheduleDelegationLauncherVisible("delegate", false, false, false));
  assert(scheduleDelegationLauncherVisible("delegate", false, true, false)); assert(scheduleDelegationLauncherVisible("delegate", false, false, true));
  const text = file("MerchantAttendanceScheduleDelegationLauncher"); assert.match(text, /if \(props.active === false\) return null/); assert.match(text, /key=\{`\$\{props.siteId\}:\$\{props.access\}:\$\{props.actorId\}`\}/);
  assert(!text.includes("sessionStorage.length")); assert.match(text, /scheduleDelegationPendingKey\(props.siteId, props.access, props.actorId\)/);
});
test("grant has no implicit actions, dates, or historical inclusion and requires separate historical acknowledgement", () => {
  assert.deepEqual(scheduleDelegationEmptyDraft(), { actions: [], includeExistingFuture: false, historyAck: false, from: "", until: "", reason: "", ack: false });
  assert(!grantButton(form()).includes(' disabled=""')); assert(grantButton(form({ ...draft(), actions: [] })).includes(' disabled=""'));
  assert(grantButton(form({ ...draft(), actions: ["publish", "publish"] })).includes(' disabled=""')); assert(grantButton(form({ ...draft(), ack: false })).includes(' disabled=""'));
  assert(grantButton(form({ ...draft(), includeExistingFuture: true })).includes(' disabled=""')); assert(!grantButton(form({ ...draft(), includeExistingFuture: true, historyAck: true })).includes(' disabled=""'));
  assert.match(form(), /当前默认地点/); assert.match(form({ ...draft(), includeExistingFuture: true }), /缺旧依据仍由负责人处理/);
});
test("grant needs three authentic catalog choices and prohibits either self-identity equality", () => {
  const c = choices(); for (const key of ["delegate", "worker", "location"] as const) { const html = render(<ScheduleDelegationGrantForm draft={draft()} choices={{ ...c, [key]: null }} disabled={false} onDraft={no} onGrant={no}/>); assert(grantButton(html).includes(' disabled=""')); }
  assert(grantButton(form(draft(), { ...c, worker: { ...c.worker, employeeId: employee } })).includes(' disabled=""'));
  assert(grantButton(form(draft(), { ...c, worker: { ...c.worker, employeeAuthUserId: auth } })).includes(' disabled=""'));
  assert(grantButton(form(draft(), { ...c, delegate: { ...c.delegate, employeeAuthUserId: "" } })).includes(' disabled=""'));
  assert.equal((render(<ScheduleDelegationChoices choices={{ delegate: null, worker: null, location: null }}/>).match(/未选择/g) ?? []).length, 3);
});
test("grant emits canonical explicit actions and UTC bounds without interpreting device DST", () => {
  const sent: unknown[] = []; const el = ScheduleDelegationGrantForm({ draft: { ...draft(), actions: ["cancel", "publish"] }, choices: choices(), disabled: false, onDraft: no, onGrant: v => sent.push(v) });
  el.props.onSubmit({ preventDefault: no }); assert.deepEqual(sent, [{ actions: ["publish", "cancel"], includeExistingFuture: false, validFrom: "2026-10-06T00:00:00.000000Z", validUntil: "2026-11-06T00:00:00.000000Z", reason: "明确授权" }]);
  assert.equal(scheduleDelegationUtc("2026-03-29T02:30"), "2026-03-29T02:30:00.000000Z");
  for (const v of ["", "2026-02-30T09:00", "2026-10-06T24:00", "0000-01-01T00:00", "2026-10-06T12:00Z"]) assert.throws(() => scheduleDelegationUtc(v));
});
test("catalog renders bounded server choices rather than free UUID or owner directory input", () => {
  const items: ScheduleDelegationCatalogItem[] = Array.from({ length: 25 }, (_, n) => ({ ...choices().delegate, id: id(100 + n), employeeId: id(100 + n), name: `主管${n}` }));
  const html = render(<ScheduleDelegationCatalog kind="delegates" items={items} disabled={false} onSelect={no} hasNext onNext={no}/>);
  assert.equal((html.match(/选用此排班主管/g) ?? []).length, 25); assert.match(html, /不是全企业搜索/); assert.match(html, /至少一种排班权限/); assert.match(html, /下一页排班授权目录/); assert(!html.includes("UUID"));
});
test("schedule range is strict inclusive civil dates capped at 31", () => {
  assert(scheduleDelegationRangeValid("2026-10-01", "2026-10-31")); assert(scheduleDelegationRangeValid("2026-10-25", "2026-10-25"));
  for (const [a, b] of [["2026-10-01", "2026-11-01"], ["2026-02-30", "2026-03-01"], ["2026-10-02", "2026-10-01"], ["1999-12-31", "2000-01-01"]]) assert(!scheduleDelegationRangeValid(a, b));
});
test("publish preview uses original DST resolver: repeated times require offsets and nonexistent times fail", () => {
  const s = schedule(); assert.throws(() => previewDelegatedSchedule([row("2026-10-25T02:10", "2026-10-25T02:50")], s, "2026-10-25", "2026-10-25"), /重复/);
  assert.deepEqual(previewDelegatedSchedule([row("2026-10-25T02:10", "2026-10-25T02:50", "+02:00", "+01:00")], s, "2026-10-25", "2026-10-25"), [["2026-10-25T00:10:00.000Z", "2026-10-25T01:50:00.000Z"]]);
  assert.throws(() => previewDelegatedSchedule([row("2026-03-29T02:10", "2026-03-29T03:50")], s, "2026-03-29", "2026-03-29"), /不存在/);
});
test("preview sorts spans but rejects overlap, zero, >24h, >32, outside range/window and unusable/limited scope", () => {
  const s = schedule({ timeZone: "UTC", grant: grant({ location: { ...grant().location, timeZone: "UTC" } }) }), p = (rows: ScheduleWallSlot[], value = s) => previewDelegatedSchedule(rows, value, "2026-10-25", "2026-10-26");
  assert.deepEqual(p([row("2026-10-25T23:00", "2026-10-26T01:00"), row("2026-10-25T08:00", "2026-10-25T09:00")]), [["2026-10-25T08:00:00.000Z", "2026-10-25T09:00:00.000Z"], ["2026-10-25T23:00:00.000Z", "2026-10-26T01:00:00.000Z"]]);
  for (const rows of [[], [row("2026-10-25T08:00", "2026-10-25T08:00")], [row("2026-10-25T08:00", "2026-10-26T08:01")], [row("2026-10-24T08:00", "2026-10-24T09:00")], [row("2026-10-25T08:00", "2026-10-25T10:00"), row("2026-10-25T09:00", "2026-10-25T11:00")], Array.from({ length: 33 }, () => row("2026-10-25T08:00", "2026-10-25T09:00"))]) assert.throws(() => p(rows));
  const rows = [row("2026-10-25T08:00", "2026-10-25T09:00")];
  assert.throws(() => p(rows, { ...s, rangeLimited: true })); assert.throws(() => p(rows, { ...s, grant: grant({ usableActions: ["cancel"] }) }));
  assert.throws(() => p(rows, { ...s, grant: grant({ validUntil: "2026-10-25T08:59:59.000000Z" }) }));
});
test("scope and source metadata are visible; cancel requires explicit server canCancel and no truncation", () => {
  const s = schedule(), html = render(<ScheduleDelegationScheduleView schedule={s} fromDate="2026-10-25" throughDate="2026-10-25" disabled={false}/>);
  for (const text of ["合成目标", "合成地点", "Europe/Madrid", "排班版本 7", "设置版本 3", "人员版本 4", "地点版本 2", "明确取消受托班次", "新增班次"]) assert(html.includes(text));
  const limited = render(<ScheduleDelegationScheduleView schedule={{ ...s, rangeLimited: true, entries: [] }} fromDate="2026-10-25" throughDate="2026-10-25" disabled={false}/>);
  assert.match(limited, /超过100条/); assert(!limited.includes("明确取消受托班次")); assert(!limited.includes("明确发布受托班次"));
  const denied = render(<ScheduleDelegationScheduleView schedule={{ ...s, grant: grant({ usableActions: [] }), entries: s.entries.map(x => ({ ...x, canCancel: false })) }} fromDate="2026-10-25" throughDate="2026-10-25" disabled={false}/>);
  assert(!denied.includes("明确取消受托班次")); assert(!denied.includes("明确发布受托班次"));
});
test("fresh publish form has no preselected times or acknowledgement and explains non-approval", () => {
  const html = render(<ScheduleDelegationPublishForm schedule={schedule()} fromDate="2026-10-25" throughDate="2026-10-25" disabled={false} onDirty={no} onPublish={no}/>);
  assert.match(html, /预览受托班次/); assert(!html.includes(' checked=""')); assert(!html.includes("data-schedule-delegation-preview")); assert.match(html, /disabled=""[^>]*>明确发布受托班次/);
  assert.match(html, /跨夜须明确填写次日/);
});
test("flag-off safe revoke displays only on active owner grant and never modifies existing shifts", () => {
  const html = render(<ScheduleDelegationGrantView grant={grant()} owner disabled={false}/>); assert.match(html, /明确撤销排班委托/); assert.match(html, /不包含授予前/);
  assert(!render(<ScheduleDelegationGrantView grant={grant()} owner={false} disabled={false}/>).includes("明确撤销排班委托"));
  assert(!render(<ScheduleDelegationGrantView grant={grant({ revision: 2, status: "revoked", usableActions: [], revocation: { operationId: id(12), actorId: owner, reason: "撤回", recordedAt: "2026-10-06T10:00:00.000000Z" } })} owner disabled={false}/>).includes("明确撤销排班委托"));
});
test("all four minimal receipts omit cached names, reasons, command hash, and restored authority claims", () => {
  for (const action of ["grant", "revoke", "publish", "cancel"] as const) { const r = receipt(action), html = render(<ScheduleDelegationReceipt result={r}/>);
    assert(html.includes(id(10))); assert(html.includes(auth)); assert.match(html, /未恢复排班权限/); assert.match(html, /不代表已核准规则或出勤/);
    for (const secret of ["合成主管", "合成目标", "合成授权理由", r.receipt!.commandFingerprint]) assert(!html.includes(secret));
    assert(!html.includes("<button")); }
});
test("saved grant render escapes labels and uses saved times without Intl recomputation", () => {
  const format = Intl.DateTimeFormat; try { Object.defineProperty(Intl, "DateTimeFormat", { configurable: true, writable: true, value: function () { throw Error("no recalculation"); } });
    const html = render(<ScheduleDelegationGrantView grant={grant({ reason: "<script>bad</script>", worker: { ...grant().worker, name: "<img src=x>" } })}/>);
    assert(!html.includes("<script>")); assert(!html.includes("<img")); assert.match(html, /&lt;script/); assert(html.includes(grant().validFrom));
  } finally { Object.defineProperty(Intl, "DateTimeFormat", { configurable: true, writable: true, value: format }); }
});
test("confirmation and validation fail closed after synchronous context change", () => {
  for (const reason of ["", " a", "a ", "a\nb", "x".repeat(201)]) assert(!scheduleDelegationReasonValid(reason));
  let current = true, writes = 0; assert(!confirmScheduleDelegationAction(() => { current = false; return true; }, () => current, () => writes++)); assert.equal(writes, 0);
  current = true; assert(confirmScheduleDelegationAction(() => true, () => current, () => writes++)); assert.equal(writes, 1);
});
test("parent wiring preserves owner boundary and clock independence while adding fifth leave guard", () => {
  const self = file("MerchantAttendanceSelfPanel"), admin = file("MerchantAttendanceAdminPanel");
  for (const text of [self, admin]) { assert.match(text, /NEXT_PUBLIC_FAOLLA_ATTENDANCE_SCHEDULE_DELEGATION_ENABLED === "1"/); assert.match(text, /schedule-delegation:.*state.authorizationEpoch/); assert(!text.includes("scheduleDelegationPendingKey")); }
  assert.match(self, /registerLeaveGuard=\{registerScheduleDelegationLeaveGuard\}/); assert.match(self, /!scheduleDelegationLeaveGuard.current \|\| scheduleDelegationLeaveGuard.current\(\)/);
  const guards = self.slice(self.indexOf("const scheduleBlocked"), self.indexOf("const onScheduleConfirmed")); assert(!guards.includes("Delegation"));
});
test("new UI reads no owner directory/templates, guards date edits, and retains pending without retry", () => {
  const panel = file("MerchantAttendanceScheduleDelegationPanel"), launcher = file("MerchantAttendanceScheduleDelegationLauncher");
  for (const value of ["/attendance/admin", "ShiftTemplates", "client.retry", "localStorage", "pending.command.reason", "pending.command.decision.reason"]) assert(!panel.includes(value));
  for (const name of ["visibilitychange", "pagehide", "pageshow", "beforeunload"]) assert(panel.includes(name));
  assert.match(panel, /!result.canWrite \|\| rangeDirty/); assert.match(panel, /client.getSnapshot\(\) === snapshot/); assert.match(panel, /safeRevoke \|\| enabled && !!result\?\.canWrite/);
  assert.match(launcher, /queueMicrotask/); assert.match(launcher, /event.preventDefault\(\); event.stopPropagation\(\); close\(\)/);
});
