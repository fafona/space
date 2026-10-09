import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup as render } from "react-dom/server";
import Panel, { OutageIncidentForm, OutageDeclarationForm, OutageRecordDetail, OutageRecordList, OutagePendingView, OutageReceiptView, OutageRecoveryEntries,
  outagePanelEmptyIncident, outagePanelEmptyDeclaration, outagePanelInterval, outagePanelDatesFromInterval, outagePanelTextValid, outagePanelIncidentReady,
  outagePanelDeclarationReady, outagePanelKnownRecoveries, outagePanelHasRisk, confirmOutagePanelAction, type OutageDateDraft } from "./MerchantAttendanceOutagePanel";
import { outageClientPendingKey } from "../../lib/merchantAttendanceOutageClient";
import { parseOutageHttpBody, parseOutageHttpResponse } from "../../lib/merchantAttendanceOutageHttp";
import { parseOutageSubjectResult, type OutageSubjectResult } from "../../lib/merchantAttendanceOutageSubject";
import type { OutageDeclaration, OutageIncident, OutageReceipt, OutageResult } from "../../lib/merchantAttendanceOutageContract";

// Legal synthetic wire models, never a claim of an actual employee or database write.
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const siteId = "99990001", owner = id(1), auth = id(2), worker = id(3), employee = id(4), incidentId = id(5), declarationId = id(6), fp = "a".repeat(64);
const at = "2026-10-01T12:00:00.000000Z", no = () => {};
const dates = (): OutageDateDraft => ({ start: "2026-10-01T09:00", end: "2026-10-01T11:00", timeZone: "Europe/Madrid", startOffset: "120", endOffset: "120" });
const interval = () => outagePanelInterval(dates(), Date.parse(at));
const incidentDraft = () => ({ ...outagePanelEmptyIncident(), dates: dates(), reason: "准确登记，不补造打卡", ack: true });
const declarationDraft = () => ({ ...outagePanelEmptyDeclaration(), dates: dates(), statement: "本人留证，不代表确认工时", ack: true });
function subject(access: "owner" | "self" = "owner", patch: Partial<OutageSubjectResult["subject"]> = {}) {
  return parseOutageSubjectResult({ protocol: "attendance-outage-subject-v1", siteId, access, actorId: access === "owner" ? owner : auth,
    readAt: at, canWrite: true, subject: { workerId: worker, employeeId: employee, employeeAuthUserId: auth, workerVersion: 4, employeeVersion: 7, generation: 2,
      displayName: "实际核验人员", active: true, paused: false, ...patch }, incident: { id: incidentId, type: "network", channel: "web", locationId: null, interval: interval() } },
  { siteId, access, workerId: access === "owner" ? worker : null, incidentId }, access === "owner" ? owner : auth);
}
function incident(): OutageIncident { return { kind: "incident", id: incidentId, operationId: id(7), type: "network", channel: "web", locationId: null, interval: interval(), reason: "故障保存说明", actorId: owner, recordedAt: at }; }
function declaration(): OutageDeclaration { return { kind: "declaration", id: declarationId, operationId: id(8), incidentId, workerId: worker, employeeId: employee, employeeAuthUserId: auth,
  workerVersion: 4, employeeVersion: 7, generation: 2, interval: interval(), statement: "负责人代录 <img src=x onerror=alert(1)>", originalOperationId: id(9), originalChannel: "location", paperReference: "纸面 A-1",
  recordedBy: "owner", actorId: owner, actorEmployeeId: null, recordedAt: at }; }
function validRecord<T extends OutageIncident | OutageDeclaration>(record: T): T {
  const query = record.kind === "incident" ? { siteId, access: "owner" as const, mode: "incident" as const, incidentId: record.id } : { siteId, access: "owner" as const, mode: "declaration" as const, declarationId: record.id };
  const result: OutageResult = { protocol: "attendance-outage-v1", siteId, actorId: owner, access: "owner", mode: query.mode, readAt: at, canWrite: false, items: [], detail: record, receipt: null, nextId: null };
  return parseOutageHttpResponse("outages", { ok: true, canWrite: false, data: result }, query, owner).result.detail as T;
}
const receipt = (): OutageReceipt => ({ operationId: id(8), action: "declare", recordId: declarationId, incidentId, actorId: owner, commandFingerprint: fp, recordedAt: at });
const submitButton = (html: string, label: string) => html.match(new RegExp(`<button[^>]*>${label}</button>`))?.[0] ?? assert.fail("missing button");
const incidentForm = (value = incidentDraft(), disabled = false) => render(<OutageIncidentForm draft={value} disabled={disabled} onDraft={no} onSubmit={no}/>);
const declarationForm = (value = declarationDraft(), prepared = subject(), disabled = false) => render(<OutageDeclarationForm prepared={prepared} draft={value} disabled={disabled} onDraft={no} onSubmit={no}/>);
function knownPending(kind: "links" | "reviews" | "relations", did = declarationId, actorId = owner) {
  const query = { siteId, access: "owner" as const, mode: "detail" as const, declarationId: did, ...(kind === "relations" ? { relatedDeclarationId: id(100) } : {}) };
  const command = kind === "links" ? { action: "revoke", operationId: id(20), expectedRevision: 1, expectedFingerprint: fp, reason: "私密理由不可回显" }
    : kind === "reviews" ? { action: "propose", operationId: id(21), expectedRevision: 0, expectedResultVersion: 0, expectedFingerprint: fp, reason: "另一私密理由不可回显" }
      : { action: "apply", kind: "possible_duplicate", operationId: id(22), expectedRevision: 0, expectedFingerprint: fp, reason: "关系私密理由不可回显" };
  const body = parseOutageHttpBody(kind, { query, command }, actorId);
  return JSON.stringify({ version: 1, kind, actorId, ...body });
}

test("owner/self SSR opens with no HTTP, no private record and no automatic write", () => {
  let calls = 0; const apiFetch = async () => { calls++; throw Error("unexpected HTTP"); };
  for (const access of ["owner", "self"] as const) {
    const html = render(<Panel siteId={siteId} actorId={access === "owner" ? owner : auth} access={access} workerId={worker} apiFetch={apiFetch} enabled onClose={no}/>);
    assert.match(html, /不是备用打卡机/); assert.match(html, /不补造原始打卡/); assert.match(html, /已知故障编号/); assert(!html.includes("data-outage-detail=")); assert(!html.includes("data-outage-prepared"));
    if (access === "self") { assert.match(html, /核验故障与本人声明资格/); assert(!html.includes("读取故障登记列表")); }
  }
  assert.equal(calls, 0);
});
test("flag-off still renders explicit reads and owner without selected worker cannot guess target", () => {
  const html = render(<Panel siteId={siteId} actorId={owner} access="owner" apiFetch={async () => { throw Error("no HTTP"); }} enabled={false} onClose={no}/>);
  assert.match(html, /新写入入口已关闭/); assert.match(html, /读取故障登记列表/); assert.match(html, /逐人代录请从考勤人员行进入/); assert(!html.includes('aria-label="员工编号"'));
  assert(submitButton(html, "核验当前人员与故障").includes(' disabled=""'));
});
test("local civil dates require explicit IANA and endpoint offsets instead of device timezone", () => {
  assert.deepEqual(interval(), { startAt: "2026-10-01T07:00:00.000000Z", endAt: "2026-10-01T09:00:00.000000Z", timeZone: "Europe/Madrid", startOffsetMinutes: 120, endOffsetMinutes: 120 });
  for (const patch of [{ timeZone: "" }, { startOffset: "" }, { endOffset: "+120" }, { startOffset: "120.5" }, { startOffset: "-0" }, { timeZone: "Bad/Zone" }, { start: "2026-02-30T09:00" }, { end: "2026-10-01T09:00" }]) assert.throws(() => outagePanelInterval({ ...dates(), ...patch }));
  assert.throws(() => outagePanelInterval(dates(), Date.parse("2026-10-01T08:59:59Z")));
});
test("autumn repeated civil hour is explicit and spring nonexistent local hour is rejected", () => {
  const repeated = { start: "2025-10-26T02:30", end: "2025-10-26T02:30", timeZone: "Europe/Madrid", startOffset: "120", endOffset: "60" };
  const value = outagePanelInterval(repeated); assert.equal(value.startAt, "2025-10-26T00:30:00.000000Z"); assert.equal(value.endAt, "2025-10-26T01:30:00.000000Z");
  assert.throws(() => outagePanelInterval({ ...repeated, endOffset: "120" }));
  for (const offset of ["60", "120"]) assert.throws(() => outagePanelInterval({ start: "2025-03-30T02:30", end: "2025-03-30T04:00", timeZone: "Europe/Madrid", startOffset: offset, endOffset: "120" }));
});
test("period input stays bounded and saved convenience never truncates microseconds or invokes Intl", () => {
  assert.throws(() => outagePanelInterval({ start: "2026-08-01T00:00", end: "2026-09-02T00:00", timeZone: "UTC", startOffset: "0", endOffset: "0" }));
  const saved = interval(); assert.deepEqual(outagePanelDatesFromInterval(saved), dates());
  assert.equal(outagePanelDatesFromInterval({ ...saved, startAt: "2026-10-01T07:00:00.000001Z" }), null);
  assert.equal(outagePanelDatesFromInterval({ ...saved, timeZone: "Historic/Unavailable" })?.timeZone, "Historic/Unavailable");
});
test("incident form is practical, explicit and submits only an acknowledged valid draft", () => {
  const initial = outagePanelEmptyIncident(); assert.equal(initial.ack, false); assert.equal(initial.dates.timeZone, ""); assert.equal(initial.dates.startOffset, "");
  const html = incidentForm(); assert.match(html, /IANA/); assert.match(html, /起止/); assert.match(html, /UTC\+02:00/); assert(!submitButton(html, "明确登记故障").includes(' disabled=""'));
  assert(outagePanelIncidentReady(incidentDraft()));
  for (const value of [initial, { ...incidentDraft(), ack: false }, { ...incidentDraft(), reason: " " }, { ...incidentDraft(), locationId: "not-uuid" }]) assert(submitButton(incidentForm(value), "明确登记故障").includes(' disabled=""'));
  assert(submitButton(incidentForm(incidentDraft(), true), "明确登记故障").includes(' disabled=""'));
  let calls = 0; OutageIncidentForm({ draft: incidentDraft(), disabled: false, onDraft: no, onSubmit: () => calls++ }).props.onSubmit({ preventDefault: no }); assert.equal(calls, 1);
  OutageIncidentForm({ draft: initial, disabled: false, onDraft: no, onSubmit: () => calls++ }).props.onSubmit({ preventDefault: no }); assert.equal(calls, 1);
});
test("reason/statement validity counts Unicode scalars and rejects invisible control or excess", () => {
  assert(outagePanelTextValid("😀".repeat(1000))); assert(!outagePanelTextValid("😀".repeat(1001)));
  for (const text of ["", " leading", "trailing ", "line\nbreak", "hidden\u0085x"]) assert.equal(outagePanelTextValid(text), false);
  assert(!outagePanelTextValid("x".repeat(121), 120));
});
test("declaration uses verified subject and clearly labels owner proxy including paused workers", () => {
  const s = subject("owner", { active: false, paused: true }), html = declarationForm(declarationDraft(), s);
  assert.match(html, /负责人逐人代录/); assert.match(html, /不恢复账号/); assert.match(html, /不是签名/); assert.match(html, /员工版 7/); assert.match(html, /暂停代次 2/);
  assert(html.includes(auth)); assert(!submitButton(html, "明确保存故障声明").includes(' disabled=""'));
  const self = declarationForm(declarationDraft(), subject("self")); assert.match(self, /本人声明/); assert(!self.includes("负责人逐人代录"));
});
test("declaration requires acknowledgment, matching half-open incident and paired original identity", () => {
  const s = subject(), d = declarationDraft(); assert(outagePanelDeclarationReady(d, s));
  for (const value of [{ ...d, ack: false }, { ...d, originalOperationId: id(30) }, { ...d, originalChannel: "web" as const }, { ...d, paperReference: "x".repeat(121) },
    { ...d, dates: { ...dates(), start: "2026-10-01T11:00", end: "2026-10-01T12:00" } }]) assert.equal(outagePanelDeclarationReady(value, s), false);
  assert(outagePanelDeclarationReady({ ...d, originalOperationId: id(30), originalChannel: "location" }, s));
  assert(!outagePanelDeclarationReady(d, { ...s, canWrite: false })); assert(!outagePanelDeclarationReady(d, s, true));
});
test("declaration form direct submission and edit acknowledgment cannot bypass readiness", () => {
  let calls = 0; const props = { prepared: subject(), draft: declarationDraft(), disabled: false, onDraft: no, onSubmit: () => calls++ };
  OutageDeclarationForm(props).props.onSubmit({ preventDefault: no }); assert.equal(calls, 1);
  OutageDeclarationForm({ ...props, draft: { ...props.draft, ack: false } }).props.onSubmit({ preventDefault: no }); assert.equal(calls, 1);
  assert(submitButton(declarationForm({ ...declarationDraft(), originalOperationId: id(30) }), "明确保存故障声明").includes(' disabled=""'));
});
test("confirmation checks scope/generation before and after the dialog", () => {
  let current = true, writes = 0, dialogs = 0;
  assert.equal(confirmOutagePanelAction(() => { dialogs++; current = false; return true; }, () => current, () => writes++), false); assert.equal(writes, 0);
  assert.equal(confirmOutagePanelAction(() => { dialogs++; return true; }, () => false, () => writes++), false); assert.equal(dialogs, 1);
  current = true; assert.equal(confirmOutagePanelAction(() => false, () => current, () => writes++), false);
  assert.equal(confirmOutagePanelAction(() => true, () => current, () => writes++), true); assert.equal(writes, 1);
});
test("parent risk composes child risk without invoking a child confirmation", () => {
  let reads = 0; const child = () => { reads++; return true; };
  assert(outagePanelHasRisk(false, false, child)); assert.equal(reads, 1);
  assert(outagePanelHasRisk(true, false, child)); assert.equal(reads, 1);
  assert(outagePanelHasRisk(false, true, null)); assert(!outagePanelHasRisk(false, false, () => false)); assert(outagePanelHasRisk(false, false, () => { throw Error("unknown"); }));
});
test("pending view reveals only original number and explicit end exists only for rejection", () => {
  const props = { operationId: id(20), canEnd: false, disabled: false, onRecover: no, onEnd: no }, html = render(<OutagePendingView {...props}/>);
  assert.match(html, /查无、超时或权限失败仍保留编号/); assert(!html.includes("明确结束被拒绝尝试")); assert(html.includes(id(20)));
  assert.match(render(<OutagePendingView {...props} canEnd/>), /明确结束被拒绝尝试/); assert(!html.includes("自动重试"));
});
test("exact local recovery keys expose three independent declarations without fetching or mutation", () => {
  const values = new Map([[outageClientPendingKey("links", siteId, "owner", owner), knownPending("links")], [outageClientPendingKey("reviews", siteId, "owner", owner), knownPending("reviews", id(99))],
    [outageClientPendingKey("relations", siteId, "owner", owner), knownPending("relations", id(98))]]), reads: string[] = [];
  const result = outagePanelKnownRecoveries({ getItem: key => { reads.push(key); return values.get(key) ?? null; } }, siteId, "owner", owner);
  assert.equal(reads.length, 3); assert.deepEqual(reads, [...values.keys()]); assert.equal(result.blocked, false); assert.deepEqual(result.entries.map(x => x.declarationId), [declarationId, id(99), id(98)]);
  assert.equal(Object.keys(result.entries[0]).length, 3); const html = render(<OutageRecoveryEntries {...result} disabled={false} onOpen={no}/>);
  assert.match(html, /核对待确认来源关联/); assert.match(html, /核对待确认恢复结果/); assert.match(html, /核对待确认声明关系/); assert(!html.includes("私密理由")); assert.equal(values.size, 3);
});

test("relations recovery rejects foreign direction scope and self writes without erasing bytes", () => {
  const good = knownPending("relations"), key = outageClientPendingKey("relations", siteId, "owner", owner);
  for (const value of [good.replace(owner, auth), good.replace(siteId, "99990002"), good.replace(id(100), declarationId), good.replace('"access":"owner"', '"access":"self"')]) {
    const values = new Map([[key, value]]), result = outagePanelKnownRecoveries({ getItem: k => values.get(k) ?? null }, siteId, "owner", owner);
    assert.equal(result.blocked, true); assert.deepEqual(result.entries, []); assert.equal(values.get(key), value);
  }
});
test("local recovery rejects foreign scope/actor, duplicates, oversized and wrong-mode pending unchanged", () => {
  const good = knownPending("links"), key = outageClientPendingKey("links", siteId, "owner", owner);
  for (const value of [good.replace(owner, auth), good.replace(siteId, "99990002"), good.replace('"version":1', '"version":1,"version":1'), good.replace('"mode":"detail"', '"mode":"history"'), "x".repeat(34000)]) {
    const values = new Map([[key, value]]), result = outagePanelKnownRecoveries({ getItem: k => values.get(k) ?? null }, siteId, "owner", owner);
    assert.deepEqual(result.entries, []); assert.equal(result.blocked, true); assert.equal(values.get(key), value);
  }
  const empty = outagePanelKnownRecoveries({ getItem: () => null }, siteId, "owner", auth); assert.deepEqual(empty, { entries: [], blocked: false });
  assert.equal(outagePanelKnownRecoveries({ getItem: () => { throw Error("denied storage"); } }, siteId, "owner", owner).blocked, true);
});
test("saved record views retain proxy/original references, escape text and never claim resolved", () => {
  const d = validRecord(declaration()), html = render(<OutageRecordDetail record={d}/>);
  assert.match(html, /负责人已保存代录声明/); assert.match(html, /保存时身份与代次（不是当前操作资格）/); assert.match(html, /不是本人结果确认/); assert(!html.includes("<img")); assert(html.includes("&lt;img"));
  assert.match(render(<OutageRecordDetail record={validRecord(incident())}/>), /故障保存说明/);
  const list = render(<OutageRecordList items={[d]} mode="declarations" disabled={false} onIncident={no} onDeclaration={no}/>); assert.match(list, /每页最多 25 条/); assert.match(list, /负责人代录（非本人确认）/);
});
test("receipt UI is historical and offers a new explicit read without saved-command body", () => {
  const r = receipt(), q = { siteId, access: "owner" as const, mode: "recover" as const, operationId: r.operationId };
  const data: OutageResult = { protocol: "attendance-outage-v1", siteId, actorId: owner, access: "owner", mode: "recover", readAt: at, canWrite: false, items: [], detail: null, receipt: r, nextId: null };
  const checked = parseOutageHttpResponse("outages", { ok: true, canWrite: false, data }, q, owner).result.receipt!;
  const html = render(<OutageReceiptView receipt={checked} onRead={no}/>); assert.match(html, /不证明当前依据仍有效/); assert.match(html, /读取该已保存记录/); assert(html.includes(declarationId)); assert(!html.includes("故障保存说明"));
});
test("actual wiring uses prepared CAS, child risk and synchronized hide rather than legacy guessing", () => {
  const text = readFileSync(new URL("./MerchantAttendanceOutagePanel.tsx", import.meta.url), "utf8");
  assert.match(text, /workerId: s\.workerId, employeeId: s\.employeeId, employeeAuthUserId: s\.employeeAuthUserId, expectedWorkerVersion: s\.workerVersion, expectedEmployeeVersion: s\.employeeVersion, expectedGeneration: s\.generation/);
  assert.match(text, /client\.prepare\(\{ siteId, access, workerId: access === "owner" \? workerId \?\? null : null, incidentId: id \}\)/);
  assert.match(text, /setShown\(false\); clearDrafts\(\); setIncidentId\(""\); setDeclarationId\(""\)/);
  assert.match(text, /registerLeaveGuard=\{registerChild\}/); assert.match(text, /window\.addEventListener\("beforeunload", unload\)/);
  assert(!text.includes("sessionStorage.length")); assert(!text.includes("navigator.geolocation")); assert(!text.includes("JSON.parse"));
});
