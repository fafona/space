import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup as render } from "react-dom/server";
import Panel, { OutageRelationsPairView, OutageRelationsPending, OutageRelationsResultView, outageRelationsDraft, outageRelationsEvidenceMatches,
  outageRelationsReasonValid, outageRelationsTargetValid, readOutageRelationsPair, type OutageRelationsPairRead } from "./MerchantAttendanceOutageRelationsPanel";
import { confirmOutageResolutionAction } from "./MerchantAttendanceOutageResolutionPanel";
import { AttendanceOutageClient, type OutageClientState } from "../../lib/merchantAttendanceOutageClient";
import { parseOutageHttpResponse } from "../../lib/merchantAttendanceOutageHttp";
import { parseOutageRelationsResult } from "../../lib/merchantAttendanceOutageRelations";
import type { OutageDeclaration, OutageQuery, OutageResult } from "../../lib/merchantAttendanceOutageContract";
import type { OutageRelationsQuery } from "../../lib/merchantAttendanceOutageRelationsContract";
import { OUTAGE_RELATIONS_MODEL as m, outageRelationsModelId as id, outageRelationsModelQuery as query, outageRelationsModelResult as result,
  outageRelationsModelEntry as entry, outageRelationsModelSummary as summary, outageRelationsModelCommand as command } from "../../../scripts/fixtures/attendance-outage-relations-model";
const no = () => {};
const initial = { pending: null, prepared: null, canEndRejectedAttempt: false, message: "" };
function relationState(raw = result(), q: OutageRelationsQuery = query()): OutageClientState<"relations"> {
  const checked = parseOutageRelationsResult(raw, q, q.access === "owner" ? m.owner : m.auth);
  return { ...initial, phase: "ready", query: q, result: checked, canWrite: checked.canWrite };
}
function declaration(n: 0 | 1): OutageDeclaration {
  return { kind: "declaration", id: n ? m.related : m.declaration, operationId: id(20 + n), incidentId: id(50 + n), workerId: m.worker, employeeId: m.employee, employeeAuthUserId: m.auth,
    workerVersion: 1, employeeVersion: 1, generation: 0, interval: { startAt: "2026-10-07T09:00:00.000000Z", endAt: "2026-10-07T10:00:00.000000Z", timeZone: "UTC", startOffsetMinutes: 0, endOffsetMinutes: 0 },
    statement: n ? "员工补充声明" : "负责人代录 <script>secret</script>", originalOperationId: null, originalChannel: null, paperReference: "纸面甲", recordedBy: "owner", actorId: m.owner, actorEmployeeId: null, recordedAt: m.at };
}
function recordState(record: OutageDeclaration, access: "owner" | "self" = "owner"): OutageClientState<"outages"> {
  const q: OutageQuery = { siteId: m.siteId, access, mode: "declaration", declarationId: record.id };
  const raw: OutageResult = { protocol: "attendance-outage-v1", siteId: m.siteId, access, actorId: access === "owner" ? m.owner : m.auth, mode: "declaration", readAt: m.at, canWrite: false, items: [], detail: record, receipt: null, nextId: null };
  const checked = parseOutageHttpResponse("outages", { ok: true, canWrite: false, data: raw }, q, raw.actorId).result;
  return { ...initial, phase: "ready", query: q, result: checked, canWrite: false };
}
function pair(): OutageRelationsPairRead { return { query: query(), declarations: [recordState(declaration(0)).result!.detail as OutageDeclaration, recordState(declaration(1)).result!.detail as OutageDeclaration], readAt: [m.at, m.at] }; }
function readers(options: { access?: "owner" | "self"; step?: (n: number) => void | Promise<void>; state?: (n: number) => OutageClientState<"outages">; relations?: OutageClientState<"relations"> } = {}) {
  const calls: string[] = []; let count = 0, state = recordState(declaration(0), options.access);
  return { calls, reader: { async load(q: OutageQuery) { calls.push(`176:${q.mode === "declaration" ? q.declarationId : "wrong"}`); count++; await options.step?.(count); state = options.state?.(count) ?? recordState(declaration(count === 1 ? 0 : 1), options.access); }, getSnapshot: () => state },
    relations: { async load(q: OutageRelationsQuery) { calls.push(`181:${q.mode}`); await options.step?.(3); }, getSnapshot: () => options.relations ?? relationState(result(query(options.access)), query(options.access)) } };
}

test("owner and self open local-only, self has no new relation form", () => {
  let http = 0; const apiFetch = async () => { http++; throw Error("unexpected HTTP"); };
  for (const access of ["owner", "self"] as const) {
    const html = render(<Panel siteId={m.siteId} actorId={access === "owner" ? m.owner : m.auth} access={access} declarationId={m.declaration} apiFetch={apiFetch} enabled/>);
    assert.match(html, /不自动合并/); assert.match(html, /不豁免周期逐项核对/); assert.match(html, /读取本声明关系/); assert(!html.includes(declaration(0).statement));
    assert.equal(html.includes("明确登记声明关系"), access === "owner"); assert.equal(html.includes("关系另一声明编号"), access === "owner");
  }
  assert.equal(http, 0);
});
test("independent flag off keeps explicit reads but all owner mutations disabled", () => {
  const html = render(<Panel siteId={m.siteId} actorId={m.owner} access="owner" declarationId={m.declaration} apiFetch={async () => { throw Error("no HTTP"); }} enabled={false}/>);
  assert.match(html, /新关系写入已关闭/); assert.match(html, /读取本声明关系/);
  for (const name of ["明确登记声明关系", "明确撤销声明关系"]) assert.match(html, new RegExp(`disabled=""[^>]*>${name}`));
});
test("target/reason validation refuses same declaration and counts bounded scalars", () => {
  assert(outageRelationsTargetValid(m.related, m.declaration)); assert(!outageRelationsTargetValid(m.declaration, m.declaration)); assert(!outageRelationsTargetValid("bad", m.declaration));
  assert(outageRelationsReasonValid("😀".repeat(1000)));
  for (const text of ["", " leading", "trailing ", "hidden\ntext", "😀".repeat(1001)]) assert(!outageRelationsReasonValid(text));
});
test("three explicit reads publish one complete pair, not intermediate bodies", async () => {
  const ports = readers(); const value = await readOutageRelationsPair(ports.reader, ports.relations, query(), () => true);
  assert.deepEqual(ports.calls, [`176:${m.declaration}`, `176:${m.related}`, "181:detail"]); assert.deepEqual(value, pair());
});
test("self three-read direction stays self and never invokes owner or writes", async () => {
  const ports = readers({ access: "self" }), q = query("self"); const value = await readOutageRelationsPair(ports.reader, ports.relations, q, () => true);
  assert.equal(value.query.access, "self"); assert.equal(ports.calls.length, 3);
});
test("any declaration read failure stops the sequence without returning partial text", async () => {
  for (const failed of [1, 2]) {
    const ports = readers({ state: n => n === failed ? { ...recordState(declaration(0)), phase: "blocked", result: null } : recordState(declaration(0)) });
    await assert.rejects(readOutageRelationsPair(ports.reader, ports.relations, query(), () => true)); assert.equal(ports.calls.length, failed);
  }
});
test("scope invalidation before or after each awaited read never publishes", async () => {
  for (const at of [0, 1, 2, 3]) {
    let current = at !== 0; const ports = readers({ step: n => { if (n === at) current = false; } });
    await assert.rejects(readOutageRelationsPair(ports.reader, ports.relations, query(), () => current)); assert.equal(ports.calls.length, at);
  }
});
test("pending, wrong record and relation failure reject even if other read is valid", async () => {
  const foreign = readers({ state: () => recordState(declaration(1)) }); await assert.rejects(readOutageRelationsPair(foreign.reader, foreign.relations, query(), () => true));
  const badRelation = readers({ relations: { ...relationState(), phase: "blocked", result: null } }); await assert.rejects(readOutageRelationsPair(badRelation.reader, badRelation.relations, query(), () => true));
  const changed = readers({ state: n => recordState({ ...declaration(n === 1 ? 0 : 1), employeeAuthUserId: n === 2 ? id(77) : m.auth }) });
  await assert.rejects(readOutageRelationsPair(changed.reader, changed.relations, query(), () => true));
});
test("immutable op and identity triple bind both declarations; current versions are not historical CAS", () => {
  const p = pair(), evidence = result().preview!.evidence!; assert(outageRelationsEvidenceMatches(p, evidence));
  assert(outageRelationsEvidenceMatches(p, { ...evidence, workerVersion: 100, employeeVersion: 200, generation: 9 }));
  for (const key of ["workerId", "employeeId", "employeeAuthUserId"] as const) assert(!outageRelationsEvidenceMatches(p, { ...evidence, [key]: id(77) }));
  assert(!outageRelationsEvidenceMatches(p, { ...evidence, declarations: [{ ...evidence.declarations[0], operationId: id(78) }, evidence.declarations[1]] }));
  assert(!outageRelationsEvidenceMatches(p, null));
});
test("apply pins direction, exact preview fingerprint/revision and explicit kind", () => {
  const s = relationState(), p = pair();
  assert.deepEqual(outageRelationsDraft(s, p, "apply", "明确理由", "complementary"), { action: "apply", kind: "complementary", reason: "明确理由", expectedRevision: 0, expectedFingerprint: m.fingerprint });
  assert.equal(outageRelationsDraft(s, p, "apply", "明确理由", ""), null);
  assert.equal(outageRelationsDraft(s, { ...p, query: { ...query(), declarationId: m.related, relatedDeclarationId: m.declaration } }, "apply", "明确理由", "complementary"), null);
  assert.equal(outageRelationsDraft(s, null, "apply", "明确理由", "possible_duplicate"), null);
});
test("safe revoke remains possible on identity/paused blocked preview using saved head fingerprint", () => {
  const raw = result(query(), entry()); raw.preview = { fingerprint: null, evidence: null, eligible: false, blockers: ["identity_changed"] };
  const s = relationState(raw);
  assert.deepEqual(outageRelationsDraft(s, pair(), "revoke", "保留声明，撤销提示", ""), { action: "revoke", expectedRevision: 1, expectedFingerprint: entry().fingerprint, reason: "保留声明，撤销提示" });
  assert.equal(outageRelationsDraft(s, pair(), "apply", "登记", "possible_duplicate"), null);
});
test("self, flag-off, in-flight, receipt and no-apply heads cannot authorize mutations", () => {
  const s = relationState(result(query(), entry()));
  for (const patch of [{ canWrite: false }, { phase: "loading" as const }, { phase: "unconfirmed" as const }, { query: query("self") }]) assert.equal(outageRelationsDraft({ ...s, ...patch }, pair(), "revoke", "理由", ""), null);
  assert.equal(outageRelationsDraft(relationState(), pair(), "revoke", "理由", ""), null);
  const revoked = result(query(), entry({ action: "revoke", operationId: id(31), expectedRevision: 1, expectedFingerprint: m.fingerprint, reason: "撤销" }));
  assert.equal(outageRelationsDraft(relationState(revoked), pair(), "revoke", "理由", ""), null);
});
test("confirmation refuses dialog-time identity, visibility or snapshot change", () => {
  let current = true, writes = 0;
  assert.equal(confirmOutageResolutionAction(() => { current = false; return true; }, () => current, () => writes++), false); assert.equal(writes, 0);
  assert.equal(confirmOutageResolutionAction(() => true, () => false, () => writes++), false);
  current = true; assert(confirmOutageResolutionAction(() => true, () => current, () => writes++)); assert.equal(writes, 1);
});
test("pair display escapes saved statements, labels proxy and omits Auth/hash/raw JSON", () => {
  const html = render(<OutageRelationsPairView pair={pair()}/>);
  assert.match(html, /负责人代录（非本人确认）/); assert.match(html, /员工补充声明/); assert(!html.includes("<script>")); assert.match(html, /&lt;script&gt;/);
  assert(!html.includes(m.auth)); assert(!html.includes(m.fingerprint)); assert.match(html, /未提供；不代表打卡失败/);
});
test("list and historical views keep revoked pairs and explicit current/history navigation", () => {
  const q: OutageRelationsQuery = { siteId: m.siteId, access: "owner", mode: "list", declarationId: m.declaration };
  const raw = { ...result(q), items: [summary(entry({ action: "revoke", operationId: id(31), expectedRevision: 1, expectedFingerprint: m.fingerprint, reason: "撤销提示" }))] };
  const checked = parseOutageRelationsResult(raw, q, m.owner), html = render(<OutageRelationsResultView result={checked} disabled={false} onPair={no} onHistory={no}/>);
  assert.match(html, /最多 25 对曾关联声明（含已撤销）/); assert.match(html, /撤销提示/); assert.match(html, /读取双方声明与当前关系/); assert.match(html, /读取这对关系历史/);
});
test("pending from another declaration only shows original IDs; explicit end requires definitive rejection", () => {
  const pending = { version: 1 as const, kind: "relations" as const, actorId: m.owner, query: query(), command: command({ reason: "私密命令正文" }) };
  const state: OutageClientState<"relations"> = { ...initial, phase: "unconfirmed", query: null, result: null, canWrite: false, pending };
  const props = { state, busy: false, declarationId: id(90), onRecover: no, onEnd: no }, html = render(<OutageRelationsPending {...props}/>);
  assert.match(html, /另一份原声明/); assert.match(html, /核对声明关系原编号/); assert(!html.includes("私密命令正文")); assert(!html.includes("明确结束被拒绝关系尝试"));
  assert.match(render(<OutageRelationsPending {...props} state={{ ...state, canEndRejectedAttempt: true }}/>), /明确结束被拒绝关系尝试/);
});
test("actual read clients use only GET and no pending-storage writes during three-read review", async () => {
  const requests: string[] = []; let mutations = 0;
  const apiFetch = async (path: string, init?: RequestInit) => {
    assert.equal(init?.method, "GET"); assert.equal(init?.body, undefined); const url = new URL(path, "https://local.invalid"); requests.push(url.pathname);
    const raw = url.pathname.endsWith("outage-relations") ? result() : recordState(declaration(url.searchParams.get("declarationId") === m.declaration ? 0 : 1)).result!;
    return Response.json({ ok: true, canWrite: raw.canWrite, data: raw });
  };
  const storage = () => ({ getItem: () => null, setItem: () => { mutations++; }, removeItem: () => { mutations++; } });
  const options = { siteId: m.siteId, actorId: m.owner, access: "owner" as const, apiFetch, storage, enabled: true };
  const reader = new AttendanceOutageClient({ ...options, kind: "outages", enabled: false }), relations = new AttendanceOutageClient({ ...options, kind: "relations" });
  await reader.initialize(); await relations.initialize(); assert.equal(requests.length, 0);
  const value = await readOutageRelationsPair(reader, relations, query(), () => true); assert.equal(value.declarations.length, 2); assert.equal(requests.length, 3); assert.equal(mutations, 0);
  reader.pause(); relations.pause();
});
test("live lifecycle gates and two independent child guards are wired without storage enumeration", () => {
  const text = readFileSync(new URL("./MerchantAttendanceOutageRelationsPanel.tsx", import.meta.url), "utf8"), parent = readFileSync(new URL("./MerchantAttendanceOutagePanel.tsx", import.meta.url), "utf8");
  for (const token of ["outageResolutionPorts(props.apiFetch", "live.current.identity === identity", "scope.apiFetch !== props.apiFetch", "flushSync", "relations.pause(); reader.pause()", "setPair(null)", '"pagehide"', '"visibilitychange"', "relations.recover()", "relations.endRejectedAttempt()"] ) assert(text.includes(token), token);
  for (const token of ["registerLeaveGuard={registerChild}", "registerLeaveGuard={registerRelations}", "childRisk.current) || outagePanelHasRisk(false, false, relationsRisk.current)", "NEXT_PUBLIC_FAOLLA_ATTENDANCE_OUTAGE_RELATIONS_ENABLED"]) assert(parent.includes(token), token);
  assert(!text.includes("sessionStorage.length")); assert(!text.includes("localStorage")); assert(!text.includes("JSON.parse"));
});
