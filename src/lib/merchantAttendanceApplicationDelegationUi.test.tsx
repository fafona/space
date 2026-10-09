import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup as render } from "react-dom/server";
import Launcher, { applicationDelegationLauncherVisible } from "../components/enterprise/MerchantAttendanceApplicationDelegationLauncher";
import Panel, { ApplicationDelegationChoices, ApplicationDelegationCatalog, ApplicationDelegationGrantForm, ApplicationDelegationGrantView,
  ApplicationDelegationDetailView, ApplicationDelegationReceipt, applicationDelegationEmptyDraft, applicationDelegationUtc,
  applicationDelegationReasonValid, confirmApplicationDelegationAction, applicationDelegationDecisionReady } from "../components/enterprise/MerchantAttendanceApplicationDelegationPanel";
import { parseApplicationDelegationResponse, type ApplicationDelegationCategory, type ApplicationDelegationGrant, type ApplicationDelegationDetail } from "./merchantAttendanceApplicationDelegation";
import { applicationDelegationId as id, applicationDelegationOwner as owner, applicationDelegationEmployee as employee, applicationDelegationAuth as auth,
  applicationDelegationQuery as query, applicationDelegationHttp as http, applicationDelegationCatalogItem as catalogItem,
  applicationDelegationGrantCommand as grantCommand, applicationDelegationCommand as decisionCommand, applicationDelegationReceiptHttp as receiptHttp } from "../../scripts/fixtures/attendance-application-delegation-model";

const site = "99990001", no = () => {};
const file = (name: string) => readFileSync(new URL(`../components/enterprise/${name}.tsx`, import.meta.url), "utf8");
function choices() { return { delegate: catalogItem("delegates"), worker: catalogItem("workers") }; }
function detail(category: ApplicationDelegationCategory = "leave", patch: Partial<ApplicationDelegationDetail> = {}) {
  const q = query("delegate", "detail"), wire = http(q, category);
  if (wire.protocol !== "delegated-applications-v1" || !wire.detail) throw Error("fixture"); wire.detail = { ...wire.detail, ...patch };
  const r = parseApplicationDelegationResponse(wire, q, { employeeId: employee });
  if (r.protocol !== "delegated-applications-v1" || !r.detail) throw Error("fixture"); return r.detail;
}
function grant(category: ApplicationDelegationCategory = "leave", patch: Partial<ApplicationDelegationGrant> = {}) {
  const q = query("owner", "detail"), wire = http(q, category);
  if (wire.protocol !== "application-delegations-v1" || !wire.detail) throw Error("fixture"); wire.detail = { ...wire.detail, ...patch };
  const r = parseApplicationDelegationResponse(wire, q, { ownerId: owner });
  if (r.protocol !== "application-delegations-v1" || !r.detail) throw Error("fixture"); return r.detail;
}
const draft = () => ({ ...applicationDelegationEmptyDraft(), from: "2026-10-06T00:00", until: "2026-10-07T00:00", reason: "明确独立授权", ack: true });
const grantButton = (html: string) => html.match(/<button[^>]*>明确授予申请审批委托<\/button>/)?.[0] ?? assert.fail("missing grant button");
const form = (value = draft(), selected = choices()) => render(<ApplicationDelegationGrantForm draft={value} choices={selected} disabled={false} onDraft={no} onGrant={no}/>);

test("default-off parent launcher and SSR panel have no automatic API or private render", () => {
  let calls = 0; const apiFetch = async () => { calls++; throw Error("unexpected"); };
  for (const access of ["owner", "delegate"] as const) { const props = { siteId: site, access, actorId: access === "owner" ? owner : employee, apiFetch };
    assert.equal(render(<Launcher {...props} enabled={false}/>), ""); assert.equal(render(<Launcher {...props} enabled active={false}/>), "");
    assert.match(render(<Launcher {...props} enabled/>), access === "owner" ? /请假与工作安排审批委托/ : /受托请假与工作安排审批/);
    const html = render(<Panel {...props} enabled onClose={no}/>); assert.match(html, /读取申请委托列表|读取我的申请审批委托/); assert(!html.includes("data-application-delegation-detail")); }
  assert.equal(calls, 0);
});
test("scope-bound opened receipt survives a cleared pending key until explicit close", () => {
  assert(!applicationDelegationLauncherVisible(false, false, false)); assert(applicationDelegationLauncherVisible(false, true, false));
  assert(applicationDelegationLauncherVisible(false, false, true)); assert(applicationDelegationLauncherVisible(true, false, false));
  const text = file("MerchantAttendanceApplicationDelegationLauncher"); assert.match(text, /if \(props.active === false\) return null/);
  assert.match(text, /key=\{`\$\{props.siteId\}:\$\{props.access\}:\$\{props.actorId\}`\}/);
  assert.match(text, /applicationDelegationLauncherVisible\(props.enabled, recoverable, open\)/); assert(!text.includes("sessionStorage.length"));
});
test("permission category is separate and historical pending authorization is false by default", () => {
  const initial = applicationDelegationEmptyDraft(); assert.equal(initial.category, "leave"); assert.deepEqual(initial.kinds, []); assert.equal(initial.includePending, false); assert.equal(initial.historyAck, false);
  const html = form(); assert(!grantButton(html).includes(' disabled=""')); assert.match(html, /不按门店限制/); assert.match(html, /不是请假／安排发生日期/);
  assert(!html.includes('aria-label="包含此前仍待审申请" type="checkbox" checked=""'));
  assert(!grantButton(form({ ...draft(), includePending: true, historyAck: true })).includes(' disabled=""'));
  assert(grantButton(form({ ...draft(), includePending: true, historyAck: false })).includes(' disabled=""'));
  assert.match(form({ ...draft(), includePending: true }), /确认历史待审授权/);
});
test("work kinds require explicit selection and submit emits canonical order without combining categories", () => {
  const value = { ...draft(), category: "work_arrangement" as const, kinds: [] as ("trip" | "field" | "remote")[] };
  assert(grantButton(form(value)).includes(' disabled=""'));
  for (const name of ["出差", "外勤", "远程"]) assert(form(value).includes(`aria-label="授权${name}审批"`));
  const submitted: unknown[] = [], el = ApplicationDelegationGrantForm({ draft: { ...value, kinds: ["remote", "trip"] }, choices: choices(), disabled: false, onDraft: no, onGrant: v => submitted.push(v) });
  el.props.onSubmit({ preventDefault: no }); assert.equal(submitted.length, 1); assert.deepEqual(submitted[0], { category: "work_arrangement", kinds: ["trip", "remote"], includePending: false,
    validFrom: "2026-10-06T00:00:00.000000Z", validUntil: "2026-10-07T00:00:00.000000Z", reason: "明确独立授权" });
  assert(grantButton(form({ ...draft(), kinds: ["remote"] })).includes(' disabled=""'));
  assert(grantButton(form({ ...value, kinds: ["trip", "trip"] })).includes(' disabled=""'));
});
test("grant requires real two-person catalog choice and rejects self-target by either identity", () => {
  const c = choices();
  for (const key of ["delegate", "worker"] as const) { const html = render(<ApplicationDelegationGrantForm draft={draft()} choices={{ ...c, [key]: null }} disabled={false} onDraft={no} onGrant={no}/>); assert(grantButton(html).includes(' disabled=""')); }
  assert(grantButton(form(draft(), { ...c, worker: { ...c.worker, employeeId: c.delegate.employeeId } })).includes(' disabled=""'));
  assert(grantButton(form(draft(), { ...c, worker: { ...c.worker, employeeAuthUserId: c.delegate.employeeAuthUserId } })).includes(' disabled=""'));
  const html = render(<ApplicationDelegationChoices choices={{ delegate: null, worker: null }}/>); assert.equal((html.match(/未选择/g) ?? []).length, 2); assert.match(html, /不会自动选中/);
});
test("catalog uses actual server items and labels its local search and bounded next page", () => {
  const q = query("owner", "catalog"), wire = http(q); if (wire.protocol !== "application-delegations-v1") throw Error("fixture");
  wire.catalogItems = Array.from({ length: 25 }, (_, n) => ({ ...catalogItem("delegates"), id: id(100 + n), employeeId: id(100 + n), name: `受托 ${n}` }));
  const r = parseApplicationDelegationResponse(wire, q, { ownerId: owner }); if (r.protocol !== "application-delegations-v1") throw Error("fixture");
  const html = render(<ApplicationDelegationCatalog kind="delegates" items={r.catalogItems} disabled={false} onSelect={no} hasNext onNext={no}/>);
  assert.equal((html.match(/选用此受托审批员工/g) ?? []).length, 25); assert.match(html, /不是全企业搜索/); assert.match(html, /下一页申请委托目录/); assert(!html.includes("UUID"));
});
test("grant validity UTC conversion is strict and not a DST/device-local interpretation", () => {
  for (const value of ["2026-10-25T02:30", "2026-03-29T02:30"]) assert.equal(applicationDelegationUtc(value), value + ":00.000000Z");
  for (const value of ["", "2026-02-30T09:00", "2026-10-06T24:00", "0000-01-01T01:00", "2026-10-06T12:00Z"]) assert.throws(() => applicationDelegationUtc(value));
  assert(grantButton(form({ ...draft(), until: draft().from })).includes(' disabled=""'));
});
test("saved grant exposes accurate category, history choice and paired identities without location inference", () => {
  const g = grant("work_arrangement", { includePending: true }), html = render(<ApplicationDelegationGrantView grant={g} owner disabled={false}/>);
  for (const value of [g.delegate.employeeId, g.delegate.authUserId, g.worker.workerId, g.worker.employeeId, g.worker.authUserId, g.validFrom, g.validUntil]) assert(html.includes(value));
  assert.match(html, /出差／外勤／远程/); assert.match(html, /包含授予前/); assert.match(html, /不按门店限制/); assert.match(html, /明确撤销申请委托/);
  assert(!render(<ApplicationDelegationGrantView grant={g} owner={false}/>).includes("明确撤销申请委托"));
  const revoked = grant("leave", { status: "revoked", revision: 2, usable: false, revocation: { operationId: id(11), actorId: owner, reason: "安全撤权", recordedAt: "2026-10-06T11:00:00.000000Z" } });
  assert(!render(<ApplicationDelegationGrantView grant={revoked} owner disabled={false}/>).includes("明确撤销申请委托"));
});
test("authorized conflict summary remains minimal and work approval needs its own explicit confirmation", () => {
  const d = detail("work_arrangement", { conflicts: [{ source: "schedule", kind: null, startAt: "2026-10-03T08:00:00.000Z", endAt: "2026-10-03T09:00:00.000Z", timeZone: "UTC" }] });
  const html = render(<ApplicationDelegationDetailView detail={d} disabled={false}/>); assert.match(html, /确认已显示工作安排冲突/); assert.match(html, /目标员工排班时段/);
  assert(!html.includes(d.evidenceFingerprint)); assert(!html.includes(d.conflictsFingerprint)); assert(!html.includes("locationId"));
  assert(!applicationDelegationDecisionReady(d, "approve", "明确意见", true, false)); assert(applicationDelegationDecisionReady(d, "approve", "明确意见", true, true));
  assert(applicationDelegationDecisionReady(d, "reject", "明确意见", true, false));
});
test("hidden blockers and sealed periods cannot be waived but authorized rejection remains possible", () => {
  for (const patch of [{ blocked: true }, { sealed: true }]) { const d = detail("work_arrangement", { ...patch, canApprove: false });
    const html = render(<ApplicationDelegationDetailView detail={d} disabled={false}/>); assert(!html.includes("明确批准受托申请")); assert(!html.includes("确认已显示工作安排冲突")); assert.match(html, /明确驳回受托申请/);
    assert(!applicationDelegationDecisionReady({ ...d, canApprove: true }, "approve", "明确意见", true, true)); assert(applicationDelegationDecisionReady(d, "reject", "明确意见", true, false)); }
  assert(!applicationDelegationDecisionReady(detail(), "approve", "明确意见", false, false)); assert(!applicationDelegationDecisionReady(detail(), "approve", "", true, false));
  assert(!applicationDelegationDecisionReady(detail(), "approve", "明确意见", true, false, true));
});
test("minimum receipt never reconstructs revoked application contents or authority", async () => {
  const q = query("delegate", "recover"), c = decisionCommand("work_arrangement");
  const r = parseApplicationDelegationResponse(await receiptHttp(q, c), q, { employeeId: employee });
  const html = render(<ApplicationDelegationReceipt result={r}/>); assert.match(html, /工作安排/); assert(html.includes(auth)); assert.match(html, /未恢复审批权限/);
  assert(!html.includes("Synthetic application reason")); assert(!html.includes("Synthetic worker")); assert(!html.includes("明确批准受托申请")); assert(!html.includes(c.decision.reason));
  const oq = query("owner", "recover"), gc = grantCommand(); oq.operationId = gc.operationId;
  const o = parseApplicationDelegationResponse(await receiptHttp(oq, gc), oq, { ownerId: owner }); assert.match(render(<ApplicationDelegationReceipt result={o}/>), /保存委托版本 1/);
});
test("hostile saved values are escaped and saved time display never recomputes Intl boundaries", () => {
  const format = Intl.DateTimeFormat;
  try { Object.defineProperty(Intl, "DateTimeFormat", { configurable: true, writable: true, value: function () { throw Error("no timezone recomputation"); } });
    const html = render(<ApplicationDelegationDetailView detail={detail("leave", { workerName: "<img src=x onerror=bad>", reason: "<script>private</script>" })}/>);
    assert(!html.includes("<img")); assert(!html.includes("<script>")); assert.match(html, /&lt;img/); assert(html.includes("2026-10-03T08:00:00.000Z"));
  } finally { Object.defineProperty(Intl, "DateTimeFormat", { configurable: true, writable: true, value: format }); }
});
test("confirm callback and reason validation fail closed across synchronous lifetime changes", () => {
  for (const value of ["", " a", "a ", "a\nb", "x".repeat(201)]) assert(!applicationDelegationReasonValid(value));
  let current = true, writes = 0; assert(!confirmApplicationDelegationAction(() => { current = false; return true; }, () => current, () => writes++)); assert.equal(writes, 0);
  current = true; assert(confirmApplicationDelegationAction(() => true, () => current, () => writes++)); assert.equal(writes, 1);
});
test("parents key authorization lifetimes and combine the fourth guard without clock interlocks", () => {
  const self = file("MerchantAttendanceSelfPanel"), admin = file("MerchantAttendanceAdminPanel");
  for (const text of [self, admin]) { assert.match(text, /NEXT_PUBLIC_FAOLLA_ATTENDANCE_APPLICATION_DELEGATION_ENABLED === "1"/); assert.match(text, /application-delegation:.*state.authorizationEpoch/); assert(!text.includes("applicationDelegationPendingKey")); }
  assert.match(self, /registerLeaveGuard=\{registerApplicationLeaveGuard\}/); assert.match(self, /applicationLeaveGuard.current \? combinedLeaveGuard : null/);
  assert(!self.slice(self.indexOf("const scheduleBlocked"), self.indexOf("const onScheduleConfirmed")).includes("application"));
});
test("modal and dirty/hide fences preserve exact pending without displaying original reasons", () => {
  const launcher = file("MerchantAttendanceApplicationDelegationLauncher"), panel = file("MerchantAttendanceApplicationDelegationPanel");
  assert.match(launcher, /queueMicrotask/); assert.match(launcher, /event.preventDefault\(\); event.stopPropagation\(\); close\(\)/);
  assert.match(launcher, /onCancel=\{event => \{ event.preventDefault\(\); close\(\); \}\}/); assert.match(launcher, /sessionStorage.getItem\(applicationDelegationPendingKey/);
  for (const name of ["visibilitychange", "pagehide", "pageshow", "beforeunload"]) assert(panel.includes(name));
  assert(!panel.includes("pending.command.reason")); assert(!panel.includes("pending.command.decision.reason")); assert(!panel.includes("client.retry")); assert(!panel.includes("localStorage"));
  assert.match(panel, /safeRevoke \|\| enabled && !!result\?\.canWrite/);
});
test("legacy wording recognizes authorized reviewers but retains owner-only cancellation and policy", () => {
  const leave = file("MerchantAttendanceLeavePanel"), notices = file("MerchantAttendanceLeaveNotificationsPanel"), work = file("MerchantAttendanceWorkArrangementPanel");
  assert.match(leave, /approve: "负责人或获授权审批人批准"/); assert.match(leave, /reject: "负责人或获授权审批人驳回"/); assert.match(leave, /cancel: "负责人取消批准"/);
  assert.match(notices, /负责人或获授权审批人的实际决定时间/); assert.match(notices, /此通知不提供审核者姓名/);
  assert.match(work, /此原入口仍限当前负责人审批/); assert.match(work, /取消既有批准和政策配置仍仅当前负责人/);
});
