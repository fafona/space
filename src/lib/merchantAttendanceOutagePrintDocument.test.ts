import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { buildOutageBlankPrintDocument, buildOutageHandoffPrintDocument } from "./merchantAttendanceOutagePrintDocument";
import type { OutageDeclaration, OutageResult } from "./merchantAttendanceOutageContract";
import type { OutageReviewEntry, OutageReviewProposal, OutageReviewResult } from "./merchantAttendanceOutageReviewContract";
import { projectOutageResult } from "./merchantAttendanceOutage.server";
import { projectOutageReviewResult } from "./merchantAttendanceOutageReview.server";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const siteId = "99990001", owner = id(1), auth = id(2), declarationId = id(3);
const interval = { startAt: "2026-10-07T08:00:00.000000Z", endAt: "2026-10-07T10:00:00.000000Z", timeZone: "Europe/Madrid", startOffsetMinutes: 120, endOffsetMinutes: 120 };
const at = "2026-10-07T12:00:00.000000Z";
const lean = (p: OutageReviewProposal): OutageReviewEntry => { const { evidence: _e, ...rest } = p; void _e; return rest; };
function declaration(): OutageResult & { detail: OutageDeclaration } {
  return { protocol: "attendance-outage-v1", siteId, access: "owner", mode: "declaration", actorId: owner,
    readAt: "2026-10-07T12:01:00.000000Z", canWrite: true, items: [], nextId: null, receipt: null,
    detail: { kind: "declaration", id: declarationId, operationId: id(4), incidentId: id(5), workerId: id(6), employeeId: id(7), employeeAuthUserId: auth,
      workerVersion: 2, employeeVersion: 3, generation: 0, interval: { ...interval }, statement: "断网后纸面登记，请核对实际时段", originalOperationId: null,
      originalChannel: null, paperReference: "纸表-A01", recordedBy: "owner", actorId: owner, actorEmployeeId: null, recordedAt: "2026-10-07T11:00:00.000000Z" } };
}
function review(d = declaration(), action: "propose" | "confirm" | "resolve" | "dispute" | "reopen" = "propose"): OutageReviewResult {
  const saved = d.detail;
  const linkEvidence: OutageReviewProposal["evidence"]["linkEvidence"] = { protocol: "outage-link-evidence-v1", siteId, declarationId, workerId: saved.workerId,
    employeeId: saved.employeeId, employeeAuthUserId: saved.employeeAuthUserId, workerVersion: 5, employeeVersion: 7, generation: 2,
    declaredInterval: { ...saved.interval }, items: [{ reference: { kind: "session", startEventId: id(8), lastEventId: id(9), lastSequence: 2, effectOperationId: null, effectRevision: null },
      locationId: id(10), timeZone: interval.timeZone, original: { startAt: interval.startAt, endAt: interval.endAt }, selected: { startAt: interval.startAt, endAt: interval.endAt }, evidenceFingerprint: "a".repeat(64), open: false, pending: false }] };
  const ev: OutageReviewProposal["evidence"] = { protocol: "outage-review-evidence-v1", siteId, declarationId, linkOperationId: id(11), linkRevision: 1,
    linkFingerprint: hash(linkEvidence), linkEvidence, original: { status: "not_required", operationId: null, channel: null, eventId: null } };
  const p: OutageReviewProposal = { operationId: id(12), revision: 1, action: "propose", actorId: owner, resultVersion: 1, resultFingerprint: hash(ev), reason: "负责人提出恢复结果", recordedAt: at, evidence: ev };
  const response: OutageReviewEntry | null = action === "propose" ? null : { ...lean(p), operationId: id(action === "dispute" ? 15 : 13), revision: action === "dispute" ? 4 : 2,
    action: action === "dispute" ? "dispute" : "confirm", actorId: auth, reason: action === "dispute" ? "本人不同意所列结果" : "本人确认此精确结果版本" };
  const current = action === "propose" ? lean(p) : action === "confirm" || action === "dispute" ? response! : { ...lean(p), operationId: id(action === "resolve" ? 14 : 16), revision: action === "resolve" ? 3 : 4, action };
  return { protocol: "attendance-outage-review-v1", siteId, access: "owner", mode: "detail", actorId: owner, declarationId,
    readAt: "2026-10-07T12:02:00.000000Z", canWrite: true, revision: current.revision, resultVersion: 1, current, proposal: p, response,
    status: { basisFingerprint: p.resultFingerprint, linkOperationId: ev.linkOperationId, linkRevision: ev.linkRevision, linkFingerprint: ev.linkFingerprint,
      blockers: action === "propose" ? ["unconfirmed"] : action === "dispute" ? ["disputed"] : action === "reopen" ? ["reopened"] : [], canPropose: action !== "resolve", canConfirm: false, canResolve: action === "confirm", resolved: action === "resolve" },
    history: [], historyTruncated: false, receipt: null };
}
function rehash(r: OutageReviewResult) {
  const p = r.proposal!; p.evidence.linkFingerprint = hash(p.evidence.linkEvidence); p.resultFingerprint = hash(p.evidence);
  for (const e of [r.current, r.response]) if (e) e.resultFingerprint = p.resultFingerprint;
  r.status!.basisFingerprint = p.resultFingerprint; r.status!.linkFingerprint = p.evidence.linkFingerprint;
}
function projected(d: OutageResult, r: OutageReviewResult): [OutageResult, OutageReviewResult] {
  const declarationResult = projectOutageResult(d, { siteId: d.siteId, access: "owner", mode: "declaration", declarationId }, d.actorId);
  const raw = { ...r, proposal: r.proposal && { ...r.proposal, sourceText: JSON.stringify(r.proposal.evidence) } };
  return [declarationResult, projectOutageReviewResult(raw, { siteId: r.siteId, access: "owner", mode: "detail", declarationId }, r.actorId)];
}
const print = (d = declaration(), r = review(d)) => buildOutageHandoffPrintDocument(...projected(d, r));
const bad = (d: OutageResult, r: OutageReviewResult) => assert.throws(() => buildOutageHandoffPrintDocument(d, r), /attendance_outage_print_invalid/);

test("blank is deterministic, exactly two labelled A4 pages and contains no personal fixture values", () => {
  const html = buildOutageBlankPrintDocument(); assert.equal(html, buildOutageBlankPrintDocument());
  assert.match(html, /data-attendance-outage-print-document="blank"/); assert.match(html, /size:A4 portrait/);
  assert.equal((html.match(/<section class="page"/g) ?? []).length, 2);
  for (const label of ["第 1／2 页", "第 2／2 页", "单人单表", "商户名称", "地点名称", "纸表编号", "IANA时区", "开始UTC偏移", "结束UTC偏移", "声明人签名", "代录人姓名", "资料交接", "未缓存网页", "PIN、密码、验证码、定位轨迹", "申请期限豁免"]) assert(html.includes(label), label);
  for (const privateValue of [siteId, owner, auth, declarationId, "纸表-A01", "2026-10-07"]) assert(!html.includes(privateValue));
});

test("all documents have inert CSP and no scripts, links, forms, resources or external URL", () => {
  for (const html of [buildOutageBlankPrintDocument(), print()]) {
    assert.match(html, /Content-Security-Policy/); assert.match(html, /default-src 'none'/);
    assert.match(html, /base-uri 'none'; form-action 'none'; object-src 'none'/);
    assert.doesNotMatch(html, /<(?:script|link|iframe|img|form|input|button|object|embed|a)\b/i);
    assert.doesNotMatch(html, /\s(?:src|href|onload|onclick)\s*=/i); assert.doesNotMatch(html, /https?:\/\//i);
  }
});

test("handoff uses actual projector public DTOs, preserves each readAt and omits Auth/hash/JSON", () => {
  const d = declaration(), r = review(d), before = JSON.stringify([d, r]), html = print(d, r);
  assert.match(html, /data-attendance-outage-print-document="handoff"/);
  for (const text of [d.readAt, r.readAt, d.detail.workerId, d.detail.employeeId, d.detail.paperReference!, "负责人代录（不是本人提交或本人确认）", "+02:00／+02:00", "并非跨请求原子快照", "当前尚未核完", "保存的负责人提案", "保存的本人回应", "最新保存动作", "尚未确认本结果版本"]) assert(html.includes(text), text);
  for (const text of [owner, auth, r.proposal!.resultFingerprint, r.proposal!.evidence.linkFingerprint, "a".repeat(64), "employeeAuthUserId", "sourceText", "\"protocol\""]) assert(!html.includes(text), text);
  assert.equal(JSON.stringify([d, r]), before);
});

test("escaped text cannot create markup including statement, reasons, paper reference and source labels", () => {
  const attack = `</dd><script>alert("x")</script><img src=x onerror='evil()'>&`;
  const d = declaration(); d.detail.statement = attack; d.detail.paperReference = attack;
  const r = review(d, "resolve"); r.proposal!.reason = attack; r.current!.reason = attack; r.response!.reason = attack;
  r.proposal!.evidence.linkEvidence.items[0].timeZone = attack; rehash(r);
  const html = print(d, r); assert(!html.includes(attack)); assert(html.includes("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;"));
  assert(html.includes("&#39;evil()&#39;")); assert.doesNotMatch(html, /<script|<img|<a\s/i);
});

test("owner same-scope current detail only: reject access, site, actor, id and other result modes", () => {
  for (const patch of [{ access: "self" }, { siteId: "99990002" }, { actorId: id(90) }, { declarationId: id(91) }, { mode: "history" }, { mode: "recover" }]) {
    const d = declaration(); bad(d, { ...review(d), ...patch } as OutageReviewResult);
  }
  for (const patch of [{ access: "self" }, { mode: "incident" }, { mode: "declarations" }, { mode: "recover" }, { detail: null }, { receipt: {} }, { extra: true }]) {
    const d = declaration(); bad({ ...d, ...patch } as OutageResult, review(d));
  }
  const d = declaration(), r = review(d); bad(d, { ...r, status: null }); bad(d, { ...r, receipt: {} } as OutageReviewResult);
});

test("cross-bind worker, employee/Auth, interval and original metadata independently of each parser", () => {
  for (const key of ["workerId", "employeeId", "employeeAuthUserId"] as const) {
    const d = declaration(), r = review(d); r.proposal!.evidence.linkEvidence[key] = id(92); rehash(r);
    const [checkedD, checkedR] = projected(d, r); bad(checkedD, checkedR);
  }
  const d = declaration(), r = review(d); r.proposal!.evidence.linkEvidence.declaredInterval.endOffsetMinutes = 60; rehash(r);
  bad(...projected(d, r));
  const other = review(d); other.proposal!.evidence.original = { status: "unresolved", operationId: id(80), channel: "web", eventId: null };
  other.status!.blockers.push("original_unknown"); rehash(other); bad(...projected(d, other));
});

test("legally newer worker/employee versions and generation in link snapshot are not rejected", () => {
  const d = declaration(), r = review(d); assert(r.proposal!.evidence.linkEvidence.workerVersion > d.detail.workerVersion);
  assert(r.proposal!.evidence.linkEvidence.employeeVersion > d.detail.employeeVersion); assert(r.proposal!.evidence.linkEvidence.generation > d.detail.generation);
  assert.doesNotThrow(() => print(d, r));
});

test("unknown original remains unknown, not failure, and no proposal is an incomplete printable handoff", () => {
  const d = declaration(); d.detail.originalOperationId = id(80); d.detail.originalChannel = "web";
  const r = review(d); r.proposal!.evidence.original = { status: "unresolved", operationId: id(80), channel: "web", eventId: null };
  r.status!.blockers.push("original_unknown"); rehash(r);
  assert.match(print(d, r), /原操作结果尚未查明，不代表失败/);
  const empty: OutageReviewResult = { ...review(), revision: 0, resultVersion: 0, current: null, proposal: null, response: null,
    status: { basisFingerprint: null, linkOperationId: null, linkRevision: 0, linkFingerprint: null, blockers: ["link_missing", "result_missing"], canPropose: false, canConfirm: false, canResolve: false, resolved: false } };
  const html = print(declaration(), empty); assert.match(html, /尚未提出结果/); assert.match(html, /不代表没有考勤记录/); assert.match(html, /当前尚未核完/);
});

test("current resolved, later source changed, dispute and reopen remain distinct from old saved resolution", () => {
  const d = declaration(), r = review(d, "resolve"); assert.match(print(d, r), /当前已核完（仅截至本次核对读取时刻）/);
  r.status!.basisFingerprint = "b".repeat(64); r.status!.blockers = ["source_changed", "result_changed"]; r.status!.resolved = false;
  const html = print(d, r); assert.match(html, /当前尚未核完/); assert.match(html, /来源依据已变化/); assert.match(html, /负责人结案/); assert.match(html, /保存值，不冒充重新核验的当前端点/);
  assert.doesNotMatch(html, /当前已核完（/);
  r.status!.resolved = true; bad(d, r);
  assert.match(print(d, review(d, "dispute")), /本人已提出异议/); assert.match(print(d, review(d, "reopen")), /结果已重开/);
});

test("all ten valid sources are printed, eleven are rejected without truncation", () => {
  const d = declaration(), r = review(d), first = r.proposal!.evidence.linkEvidence.items[0];
  r.proposal!.evidence.linkEvidence.items = Array.from({ length: 10 }, (_, i) => ({ ...structuredClone(first), reference: { kind: "missing", requestId: id(100 + i), rootRequestId: id(200 + i), approvalOperationId: id(300 + i) }, original: null }));
  rehash(r); const html = print(d, r); assert.match(html, /共 10 条/); assert.equal((html.match(/已批整段漏卡引用/g) ?? []).length, 10); assert(html.includes(id(109)));
  r.proposal!.evidence.linkEvidence.items.push({ ...structuredClone(first), reference: { kind: "missing", requestId: id(110), rootRequestId: id(210), approvalOperationId: id(310) }, original: null });
  rehash(r); assert.throws(() => buildOutageHandoffPrintDocument(d, r), /attendance_outage_print_too_large/);
});

test("saved self declaration label does not impersonate confirmation and saved original vs effective endpoints remain distinct", () => {
  const d = declaration(); d.detail.recordedBy = "self"; d.detail.actorId = auth; d.detail.actorEmployeeId = d.detail.employeeId;
  const r = review(d), item = r.proposal!.evidence.linkEvidence.items[0];
  item.reference = { kind: "session", startEventId: id(8), lastEventId: id(9), lastSequence: 2, effectOperationId: id(50), effectRevision: 2 };
  item.selected.startAt = "2026-10-07T08:15:00.000000Z"; rehash(r);
  const html = print(d, r); assert.match(html, /本人声明（不是核对结果确认）/); assert.match(html, /原始端点（UTC）/); assert.match(html, /采用端点（UTC）/);
  assert(html.includes(interval.startAt)); assert(html.includes(item.selected.startAt)); assert(!html.includes(auth));
});

test("reject unsafe objects, invalid payload type, forged historical shape and future timestamps", () => {
  const d = declaration(), r = review(d); let read = false;
  const getter = { ...d, get actorId() { read = true; return owner; } }; bad(getter, r); assert.equal(read, false);
  bad(null as unknown as OutageResult, r); bad(d, [] as unknown as OutageReviewResult);
  bad(d, { ...r, history: [lean(r.proposal!)] });
  const future = structuredClone(r); future.proposal!.recordedAt = "2027-01-01T00:00:00.000000Z"; bad(d, future);
});

test("module is pure presentation: no persistence, networking, DOM, server imports or full evidence serialization", () => {
  const code = readFileSync(new URL("./merchantAttendanceOutagePrintDocument.ts", import.meta.url), "utf8");
  assert.doesNotMatch(code, /(?:fetch\(|localStorage|sessionStorage|window\.|document\.|\.server["']|node:|JSON\.stringify|\.slice\(0,\s*(?:8|10)\))/);
  assert.match(code, /parseOutageResult/); assert.match(code, /parseOutageReviewResult/);
});
