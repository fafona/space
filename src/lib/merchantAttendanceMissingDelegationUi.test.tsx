import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup as render } from "react-dom/server";
import Launcher, { missingDelegationLauncherVisible } from "../components/enterprise/MerchantAttendanceMissingDelegationLauncher";
import Panel, { MissingDelegationChoices, MissingDelegationCatalog, MissingDelegationGrantForm, MissingDelegationGrantView,
  MissingDelegationDetailView, MissingDelegationReceipt, missingDelegationUtc, missingDelegationReasonValid,
  confirmMissingDelegationAction } from "../components/enterprise/MerchantAttendanceMissingDelegationPanel";
import { parseMissingDelegationResponse, type MissingDelegationOwnerQuery, type MissingDelegationDelegateQuery,
  type MissingDelegationGrant, type MissingDelegationCatalogItem, type MissingDelegationDetail } from "./merchantAttendanceMissingDelegation";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const site = "99990001", owner = id(1), employee = id(2), auth = id(3), targetEmployee = id(4), targetAuth = id(5), worker = id(6), location = id(7);
const at = "2026-10-06T12:00:00.000000Z", no = () => {};
const file = (name: string) => readFileSync(new URL(`../components/enterprise/${name}.tsx`, import.meta.url), "utf8");
const oq = (patch: Partial<MissingDelegationOwnerQuery> = {}): MissingDelegationOwnerQuery => ({ siteId: site, access: "owner", mode: "list", catalog: null, afterId: null, grantId: null, operationId: null, ...patch });
const dq = (patch: Partial<MissingDelegationDelegateQuery> = {}): MissingDelegationDelegateQuery => ({ siteId: site, access: "delegate", mode: "grants", grantId: null, requestId: null, operationId: null, beforeAt: null, beforeId: null, afterId: null, ...patch });
const grant = (): MissingDelegationGrant => ({ grantId: id(10), revision: 1, status: "granted", delegate: { employeeId: employee, authUserId: auth, name: "受托员工" },
  worker: { workerId: worker, employeeId: targetEmployee, authUserId: targetAuth, name: "目标员工", workerNo: "W20" }, location: { locationId: location, name: "保存地点", timeZone: "Europe/Madrid" },
  validFrom: "2026-10-06T00:00:00.000000Z", validUntil: "2026-10-07T00:00:00.000000Z", grantedBy: owner, grantedAt: "2026-10-06T10:00:00.000000Z", reason: "明确独立授权", revocation: null, usable: true });
const detail = (): MissingDelegationDetail => ({ requestId: id(20), workerId: worker, employeeId: targetEmployee, employeeAuthUserId: targetAuth, workerName: "目标员工", locationId: location, locationName: "保存地点", timeZone: "Europe/Madrid",
  submittedAt: "2026-10-05T12:00:00.000000Z", status: "submitted", proposal: { startAt: "2026-10-04T08:00:00.000000Z", endAt: "2026-10-04T10:00:00.000000Z", breaks: [{ startAt: "2026-10-04T09:00:00.000000Z", endAt: "2026-10-04T09:10:00.000000Z", paid: false }] }, reason: "原始漏卡理由", evidenceToken: "a".repeat(32), blocked: false, canApprove: true, canReject: true });
const ownerWire = (mode: MissingDelegationOwnerQuery["mode"] = "list") => ({ ok: true, protocol: "missing-delegations-v1", siteId: site, actorId: owner, mode, timeZone: "UTC", canWrite: true,
  items: [] as MissingDelegationGrant[], catalogItems: [] as MissingDelegationCatalogItem[], nextId: null, detail: null as MissingDelegationGrant | null, receipt: null, readAt: at });
const delegateWire = (mode: MissingDelegationDelegateQuery["mode"] = "detail") => ({ ok: true, protocol: "delegated-missing-v1", siteId: site, actorId: auth, employeeId: employee, mode, canWrite: true, grants: [], items: [], nextId: null, nextCursor: null,
  detail: mode === "detail" ? detail() : null, receipt: null, readAt: at });
function parsedGrant(g = grant()) { const raw = ownerWire("detail"); raw.detail = g; const r = parseMissingDelegationResponse(raw, oq({ mode: "detail", grantId: g.grantId }), { ownerId: owner });
  if (r.protocol !== "missing-delegations-v1" || !r.detail) throw Error("bad grant fixture"); return r.detail; }
function parsedDetail(patch: Partial<MissingDelegationDetail> = {}) { const raw = delegateWire(); raw.detail = { ...detail(), ...patch };
  const r = parseMissingDelegationResponse(raw, dq({ mode: "detail", grantId: id(10), requestId: id(20) }), { employeeId: employee });
  if (r.protocol !== "delegated-missing-v1" || !r.detail) throw Error("bad detail fixture"); return r.detail; }
function catalogs() {
  const all = { delegates: { id: employee, name: "受托员工", employeeId: employee, employeeAuthUserId: auth, workerNo: null, timeZone: null },
    workers: { id: worker, name: "目标员工", employeeId: targetEmployee, employeeAuthUserId: targetAuth, workerNo: "W20", timeZone: null },
    locations: { id: location, name: "保存地点", employeeId: null, employeeAuthUserId: null, workerNo: null, timeZone: "Europe/Madrid" } };
  for (const kind of ["delegates", "workers", "locations"] as const) { const raw = ownerWire("catalog"); raw.catalogItems = [all[kind]]; parseMissingDelegationResponse(raw, oq({ mode: "catalog", catalog: kind }), { ownerId: owner }); }
  return { delegate: all.delegates, worker: all.workers, location: all.locations };
}
const draft = () => ({ from: "2026-10-06T00:00", until: "2026-10-07T00:00", reason: "独立授权理由", ack: true });
const grantButton = (html: string) => html.match(/<button[^>]*>明确授予漏卡审批委托<\/button>/)?.[0] ?? assert.fail("missing grant button");

test("default-off real launcher performs no render-time storage, API or automatic discovery request", () => {
  let calls = 0; const apiFetch = async () => { calls++; throw Error("unexpected"); };
  for (const access of ["owner", "delegate"] as const) { const props = { siteId: site, access, actorId: access === "owner" ? owner : employee, apiFetch };
    assert.equal(render(<Launcher {...props} enabled={false}/>), ""); assert.equal(render(<Launcher {...props} enabled active={false}/>), "");
    assert.match(render(<Launcher {...props} enabled/>), access === "owner" ? /漏卡审批委托管理/ : /受托漏卡审批/);
    const html = render(<Panel {...props} enabled onClose={no}/>); assert.match(html, /读取漏卡委托列表|读取我的有效委托/); assert(!html.includes("data-missing-delegation-detail")); }
  assert.equal(calls, 0);
});
test("disabled feature explains explicit recovery and safe revocation without promising authorization", () => {
  const html = render(<Panel siteId={site} actorId={employee} access="delegate" apiFetch={async () => { throw Error("unexpected"); }} enabled={false} onClose={no}/>);
  assert.match(html, /不能保证立即恢复/); assert.match(html, /原编号/); assert.match(html, /安全撤权/); assert(!html.includes("明确批准受托漏卡"));
});
test("flag-off recovery keeps only the already-open lifecycle until explicit close", () => {
  assert.equal(missingDelegationLauncherVisible(false, false, false), false);
  assert.equal(missingDelegationLauncherVisible(false, true, false), true);
  assert.equal(missingDelegationLauncherVisible(false, true, true), true);
  assert.equal(missingDelegationLauncherVisible(false, false, true), true);
  assert.equal(missingDelegationLauncherVisible(false, false, false), false);
  assert.equal(missingDelegationLauncherVisible(true, false, false), true);
  const launcher = file("MerchantAttendanceMissingDelegationLauncher");
  assert.match(launcher, /if \(props.active === false\) return null;/);
  assert.match(launcher, /key=\{`\$\{props.siteId\}:\$\{props.access\}:\$\{props.actorId\}`\}/);
  assert(launcher.indexOf("function Launcher(") < launcher.indexOf("useSyncExternalStore(subscribe, pending"));
  assert.match(launcher, /missingDelegationLauncherVisible\(props.enabled, recoverable, open\)/);
  assert(!launcher.includes("client.load")); assert(!launcher.includes("client.recover"));
});
test("actual catalog selection is required; no empty choice or self-target can enable grant", () => {
  const choices = catalogs(), show = (selected: Parameters<typeof MissingDelegationGrantForm>[0]["choices"] = choices) => render(<MissingDelegationGrantForm draft={draft()} choices={selected} disabled={false} onDraft={no} onGrant={no}/>);
  assert(!grantButton(show()).includes(' disabled=""'));
  for (const key of ["delegate", "worker", "location"] as const) assert(grantButton(show({ ...choices, [key]: null })).includes(' disabled=""'));
  assert(grantButton(show({ ...choices, worker: { ...choices.worker, employeeId: employee } })).includes(' disabled=""'));
  assert(grantButton(show({ ...choices, worker: { ...choices.worker, employeeAuthUserId: auth } })).includes(' disabled=""'));
  const empty = render(<MissingDelegationChoices choices={{ delegate: null, worker: null, location: null }}/>);
  assert.equal((empty.match(/未选择/g) ?? []).length, 3); assert.match(empty, /不会自动选中/); assert.match(empty, /查看权限不等于/);
});
test("catalog renders actual current-page matches, explicit selection and bounded next navigation", () => {
  const items = Array.from({ length: 25 }, (_, n) => ({ ...catalogs().delegate, id: id(100 + n), employeeId: id(100 + n), name: `受托 ${n}` }));
  const raw = ownerWire("catalog"); raw.catalogItems = items;
  const r = parseMissingDelegationResponse(raw, oq({ mode: "catalog", catalog: "delegates" }), { ownerId: owner });
  if (r.protocol !== "missing-delegations-v1") throw Error("fixture");
  const html = render(<MissingDelegationCatalog kind="delegates" items={r.catalogItems} disabled={false} onSelect={no} hasNext onNext={no}/>);
  assert.equal((html.match(/选用此受托审批员工/g) ?? []).length, 25); assert.match(html, /筛选当前页（不是全企业搜索）/); assert.match(html, /下一页目录/);
  assert(!html.includes('placeholder="UUID"')); assert(!html.includes('type="hidden"'));
});
test("UTC validity conversion is explicit, strict and independent of DST or device locale", () => {
  assert.equal(missingDelegationUtc("2026-10-25T02:30"), "2026-10-25T02:30:00.000000Z");
  assert.equal(missingDelegationUtc("2026-03-29T02:30"), "2026-03-29T02:30:00.000000Z");
  for (const value of ["", "2026-02-30T09:00", "2026-10-06T24:00", "0000-01-01T01:00", "2026-10-06T12:00Z"]) assert.throws(() => missingDelegationUtc(value));
  const html = render(<MissingDelegationGrantForm draft={{ ...draft(), until: draft().from }} choices={catalogs()} disabled={false} onDraft={no} onGrant={no}/>);
  assert(grantButton(html).includes(' disabled=""')); assert.match(html, /开始含、结束不含/); assert.match(html, /不是手机当地时间/);
});
test("saved grant shows exact paired identities and saved location, not a current default", () => {
  const g = parsedGrant(), html = render(<MissingDelegationGrantView grant={g} owner disabled={false}/>);
  for (const value of [g.grantId, g.delegate.employeeId, g.delegate.authUserId, g.worker.workerId, g.worker.employeeId, g.worker.authUserId, g.location.locationId, g.validFrom, g.validUntil]) assert(html.includes(value));
  assert.match(html, /明确撤销漏卡委托/); assert.match(html, /暂停新功能时，当前负责人仍可明确撤权/);
  assert(!render(<MissingDelegationGrantView grant={g} owner={false}/>).includes("明确撤销漏卡委托"));
});
test("revoked grant is historical and cannot offer another revoke control", () => {
  const g = parsedGrant({ ...grant(), status: "revoked", revision: 2, usable: false, revocation: { operationId: id(11), actorId: owner, reason: "撤回授权", recordedAt: at } });
  const html = render(<MissingDelegationGrantView grant={g} owner disabled={false}/>); assert.match(html, /已撤销/); assert(!html.includes("明确撤销漏卡委托"));
});
test("delegate receives full allowed proposal and generic blockers, never out-of-scope conflict details", () => {
  const good = render(<MissingDelegationDetailView detail={parsedDetail()} disabled={false}/>);
  assert.match(good, /明确批准受托漏卡/); assert.match(good, /明确驳回受托漏卡/); assert.match(good, /申报为无薪/); assert.match(good, /进入核定工时/);
  const blocked = render(<MissingDelegationDetailView detail={parsedDetail({ blocked: true, canApprove: false })} disabled={false}/>);
  assert(!blocked.includes("明确批准受托漏卡")); assert.match(blocked, /明确驳回受托漏卡/); assert.match(blocked, /范围外或混合冲突不在此披露/);
  assert(!blocked.includes("lineage")); assert(!blocked.includes("evidenceToken"));
});
test("recovery receipt contains only returned minimal fields, including actual reviewer", () => {
  const r = parseMissingDelegationResponse({ ...delegateWire("recover"), canWrite: false, receipt: { operationId: id(30), requestId: id(20), grantId: id(10), action: "approve", status: "approved", actorId: auth, recordedAt: at, commandFingerprint: "b".repeat(64) } }, dq({ mode: "recover", operationId: id(30) }), { employeeId: employee });
  const html = render(<MissingDelegationReceipt result={r}/>);
  assert.match(html, /已批准/); assert.match(html, /未恢复审批权限/); assert.match(html, /未重新核查当前申请/); assert(html.includes(auth));
  assert(!html.includes("原始漏卡理由")); assert(!html.includes("目标员工")); assert(!html.includes(detail().proposal.startAt)); assert(!html.includes("明确批准受托漏卡"));
  const o = parseMissingDelegationResponse({ ...ownerWire("recover"), canWrite: false, receipt: { operationId: id(10), grantId: id(10), action: "grant", revision: 1, recordedAt: at, commandFingerprint: "c".repeat(64) } }, oq({ mode: "recover", operationId: id(10) }), { ownerId: owner });
  assert.match(render(<MissingDelegationReceipt result={o}/>), /保存委托版本 1/);
});
test("hostile values are escaped; rendering saved UTC requires no Intl calculation", () => {
  const format = Intl.DateTimeFormat;
  try { Object.defineProperty(Intl, "DateTimeFormat", { configurable: true, writable: true, value: function () { throw Error("no current timezone rules"); } });
    const html = render(<MissingDelegationDetailView detail={parsedDetail({ workerName: "<img src=x onerror=bad>", reason: "<script>secret</script>" })}/>);
    assert(!html.includes("<img")); assert(!html.includes("<script>")); assert.match(html, /&lt;img/); assert(html.includes(detail().proposal.startAt)); assert.match(html, /break-all/);
  } finally { Object.defineProperty(Intl, "DateTimeFormat", { configurable: true, writable: true, value: format }); }
});
test("explicit confirmations reject generation changes and invalid reasons", () => {
  for (const value of ["", " a", "a ", "a\nb", "x".repeat(201)]) assert(!missingDelegationReasonValid(value)); assert(missingDelegationReasonValid("明确理由"));
  let current = true, writes = 0; assert(!confirmMissingDelegationAction(() => { current = false; return true; }, () => current, () => writes++)); assert.equal(writes, 0);
  current = true; assert(!confirmMissingDelegationAction(() => false, () => current, () => writes++)); assert(confirmMissingDelegationAction(() => true, () => current, () => writes++)); assert.equal(writes, 1);
});
test("actual parents isolate authorization epochs, combine dirty guards and do not interlock clocks", () => {
  const self = file("MerchantAttendanceSelfPanel"), admin = file("MerchantAttendanceAdminPanel"), old = file("MerchantAttendanceMissingPanel");
  for (const text of [self, admin]) { assert.match(text, /NEXT_PUBLIC_FAOLLA_ATTENDANCE_MISSING_DELEGATION_ENABLED === "1"/); assert.match(text, /missing-delegation:.*state.authorizationEpoch/); assert(!text.includes("missingDelegationPendingKey")); }
  assert.match(self, /actorId=\{employeeId\} access="delegate"/); assert.match(self, /registerLeaveGuard=\{registerDelegationLeaveGuard\}/); assert.match(self, /delegationLeaveGuard.current \? combinedLeaveGuard : null/);
  const clocks = self.slice(self.indexOf("const scheduleBlocked"), self.indexOf("const onScheduleConfirmed")); assert(!clocks.includes("delegation"));
  assert.equal((old.match(/负责人或获授权审批人/g) ?? []).length, 2);
});
test("new modal guards Escape; pending display never reconstructs a revoked request", () => {
  const launcher = file("MerchantAttendanceMissingDelegationLauncher"), panel = file("MerchantAttendanceMissingDelegationPanel");
  assert.match(launcher, /queueMicrotask/); assert.match(launcher, /event.preventDefault\(\); event.stopPropagation\(\); close\(\)/);
  assert.match(launcher, /onCancel=\{event => \{ event.preventDefault\(\); close\(\); \}\}/); assert.match(launcher, /sessionStorage.getItem\(missingDelegationPendingKey/);
  assert(!launcher.includes("sessionStorage.length")); assert(!panel.includes("localStorage")); assert(!panel.includes("client.retry"));
  assert.match(panel, /client.recover\(\)/); assert(!panel.includes("pending.command.reason")); assert(!panel.includes("pending.command.decision.reason"));
  for (const name of ["visibilitychange", "pagehide", "pageshow", "beforeunload"]) assert(panel.includes(name));
  assert.match(panel, /safeRevoke \|\| enabled && !!result\?\.canWrite/);
});
