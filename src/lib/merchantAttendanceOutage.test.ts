import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { parseOutageCommand, parseOutageQuery, parseOutageResult, assertOutageWriteQuery, outageCommandFingerprintText } from "./merchantAttendanceOutage";
import { executeOutage, outageSiteEnabled, projectOutageResult, outageCommandFingerprint } from "./merchantAttendanceOutage.server";
import type { OutageCommand, OutageDeclaration, OutageIncident, OutageQuery, OutageResult } from "./merchantAttendanceOutageContract";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const siteId = "99999001", owner = id(1), employee = id(2), worker = id(3), employeeId = id(4);
const at = "2026-10-07T12:00:00.000000Z";
const interval = () => ({ startAt: "2026-10-07T08:00:00.000001Z", endAt: "2026-10-07T10:00:00.000002Z", timeZone: "Europe/Madrid", startOffsetMinutes: 120, endOffsetMinutes: 120 });
const iq = (): OutageQuery => ({ siteId, access: "owner", mode: "incident", incidentId: id(10) });
const dq = (access: "self" | "owner" = "self"): OutageQuery => ({ siteId, access, mode: "declaration", declarationId: id(20) });
const recover = (q = dq(), operationId = id(21)): OutageQuery => ({ siteId, access: q.access, mode: "recover", operationId });
const incident = (): Extract<OutageCommand, { action: "create_incident" }> => ({ action: "create_incident", operationId: id(11), incidentId: id(10), type: "network", channel: "web", locationId: null, interval: interval(), reason: "网络故障，申报而非可信打卡" });
const declaration = (): Extract<OutageCommand, { action: "declare" }> => ({ action: "declare", operationId: id(21), declarationId: id(20), incidentId: id(10), workerId: worker, employeeId, employeeAuthUserId: employee,
  expectedWorkerVersion: 3, expectedEmployeeVersion: 2, expectedGeneration: 0, interval: interval(), statement: "原编号状态待核对", originalOperationId: id(30), originalChannel: "web", paperReference: "纸表甲-1" });
const incidentRecord = (): OutageIncident => { const c = incident(); return { kind: "incident", id: c.incidentId, operationId: c.operationId, type: c.type, channel: c.channel, locationId: c.locationId, interval: c.interval, reason: c.reason, actorId: owner, recordedAt: at }; };
const declarationRecord = (recordedBy: "self" | "owner" = "self"): OutageDeclaration => { const c = declaration(); return {
  kind: "declaration", id: c.declarationId, operationId: c.operationId, incidentId: c.incidentId, workerId: worker, employeeId, employeeAuthUserId: employee,
  workerVersion: c.expectedWorkerVersion, employeeVersion: c.expectedEmployeeVersion, generation: 0, interval: c.interval, statement: c.statement,
  originalOperationId: c.originalOperationId, originalChannel: c.originalChannel, paperReference: c.paperReference,
  recordedBy, actorId: recordedBy === "self" ? employee : owner, actorEmployeeId: recordedBy === "self" ? employeeId : null, recordedAt: at,
}; };
const base = (q: OutageQuery, actorId = q.access === "self" ? employee : owner): OutageResult => ({ protocol: "attendance-outage-v1", siteId, access: q.access, mode: q.mode, actorId, readAt: at, canWrite: false, items: [], detail: null, receipt: null, nextId: null });
function saved(q = dq(), c: OutageCommand = declaration()): OutageResult {
  return { ...base(q), receipt: { operationId: c.operationId, action: c.action, recordId: c.action === "declare" ? c.declarationId : c.incidentId,
    incidentId: c.incidentId, actorId: base(q).actorId, commandFingerprint: outageCommandFingerprint(q, c), recordedAt: at } };
}
function detail(q = dq(), record = declarationRecord()): OutageResult { return { ...base(q), detail: record }; }

test("outage query is strict discriminated detail, bounded list or original-ID recovery", () => {
  const queries: OutageQuery[] = [iq(), dq(), recover(), { siteId, access: "owner", mode: "incidents", afterId: null }, { siteId, access: "self", mode: "declarations", incidentId: id(10), afterId: id(5) }];
  for (const q of queries) assert.deepEqual(parseOutageQuery(q), q);
  for (const q of [{ ...iq(), extra: true }, { ...iq(), siteId: siteId + "\n" }, { ...dq(), mode: "delete" }, { siteId, access: "self", mode: "incidents", afterId: null },
    { siteId, access: "owner", mode: "incidents" }, { ...recover(), operationId: null }, { ...iq(), incidentId: id(10).toUpperCase().replace("0000", "bad") }]) assert.throws(() => parseOutageQuery(q));
});
test("new declarations retain original operation uncertainty and cannot include approval or hours", () => {
  assert.deepEqual(parseOutageCommand(incident()), incident()); assert.deepEqual(parseOutageCommand(declaration()), declaration());
  for (const patch of [{ approved: true }, { hours: 8 }, { actorId: owner }, { statement: " " }, { statement: "\ud800" }, { paperReference: "x".repeat(121) },
    { originalOperationId: null }, { originalChannel: null }, { originalChannel: "trusted_offline" }, { expectedGeneration: -0 }, { expectedWorkerVersion: 0 }, { expectedEmployeeVersion: 1.5 }, { pin: "1234" }]) assert.throws(() => parseOutageCommand({ ...declaration(), ...patch }));
  assert.doesNotThrow(() => parseOutageCommand({ ...declaration(), originalOperationId: null, originalChannel: null, paperReference: null }));
});
test("write query binds record, access and authentic subject identity before any RPC", () => {
  assert.doesNotThrow(() => assertOutageWriteQuery(iq(), incident(), owner));
  assert.doesNotThrow(() => assertOutageWriteQuery(dq(), declaration(), employee));
  assert.doesNotThrow(() => assertOutageWriteQuery(dq("owner"), declaration(), owner));
  assert.doesNotThrow(() => assertOutageWriteQuery(dq("owner"), declaration(), employee)); // SQL proves owner; this is recording, not approval.
  for (const [q, c, actor] of [[iq(), declaration(), owner], [recover(), declaration(), employee], [dq(), declaration(), owner], [{ ...iq(), access: "self" }, incident(), employee]] as [OutageQuery, OutageCommand, string][]) assert.throws(() => assertOutageWriteQuery(q, c, actor));
});
test("canonical fingerprint is fixed scalar tuple with exact Unicode and integer/null values", () => {
  const c = incident(), expected = [siteId, "owner", "create_incident", c.operationId, c.incidentId, c.type, c.channel, null,
    c.interval.startAt, c.interval.endAt, c.interval.timeZone, 120, 120, c.reason];
  assert.equal(outageCommandFingerprintText(iq(), c), JSON.stringify(expected));
  assert.equal(outageCommandFingerprint(iq(), c), createHash("sha256").update(JSON.stringify(expected)).digest("hex"));
  const reordered = Object.fromEntries(Object.entries(c).reverse()) as OutageCommand;
  assert.equal(outageCommandFingerprint(iq(), reordered), outageCommandFingerprint(iq(), c));
  assert.notEqual(outageCommandFingerprint(dq(), declaration()), outageCommandFingerprint(dq("owner"), declaration()));
  assert.notEqual(outageCommandFingerprint(dq(), declaration()), outageCommandFingerprint(dq(), { ...declaration(), statement: "另一声明" }));
});
test("POST and exact recovery return only own minimal receipt, never imply reconciliation or hours", () => {
  for (const [q, c] of [[iq(), incident()], [dq(), declaration()], [dq("owner"), declaration()]] as [OutageQuery, OutageCommand][]) {
    const value = saved(q, c), actor = value.actorId;
    assert.deepEqual(projectOutageResult(value, q, actor, c), value);
    const r = recover(q, c.operationId), recovered = { ...value, mode: "recover" as const };
    assert.deepEqual(projectOutageResult(recovered, r, actor), recovered);
    for (const patch of [{ detail: declarationRecord() }, { items: [declarationRecord()] }, { canWrite: true }, { nextId: id(8) }, { receipt: null }, { access: q.access === "self" ? "owner" : "self" }, { actorId: id(99) }]) assert.throws(() => projectOutageResult({ ...value, ...patch }, q, actor, c));
    assert.throws(() => projectOutageResult(value, q, actor, { ...c, operationId: id(99) }));
    assert.throws(() => projectOutageResult(value, q, actor, c.action === "declare" ? { ...c, statement: "改过正文" } : { ...c, reason: "改过正文" }));
  }
});
test("receipt hash, action, actor, incident and canonical time cannot drift", () => {
  for (const patch of [{ commandFingerprint: "b".repeat(64) }, { operationId: id(99) }, { actorId: owner }, { incidentId: id(99) }, { recordId: id(99) }, { action: "create_incident" }, { recordedAt: "2026-10-08T12:00:00.000000Z" }]) {
    const v = saved(); assert.throws(() => projectOutageResult({ ...v, receipt: { ...v.receipt!, ...patch } }, dq(), employee, declaration()));
  }
  const v = saved(); assert.throws(() => projectOutageResult({ ...v, receipt: { ...v.receipt!, command: declaration() } }, dq(), employee, declaration()));
});
test("declaration details distinguish actual self vs owner recorder without pretending owner confirmation", () => {
  for (const recorder of ["self", "owner"] as const) {
    const value = detail(dq(), declarationRecord(recorder));
    assert.deepEqual(projectOutageResult(value, dq(), employee), value);
    assert.equal("confirmed" in value.detail!, false);
  }
  for (const patch of [{ actorId: owner }, { actorEmployeeId: null }, { employeeAuthUserId: owner }, { workerVersion: 0 }, { generation: -1 }, { recordedBy: "delegate" }, { recordedAt: interval().startAt }]) {
    assert.throws(() => projectOutageResult(detail(dq(), { ...declarationRecord(), ...patch } as OutageDeclaration), dq(), employee));
  }
  assert.throws(() => projectOutageResult(detail(dq(), { ...declarationRecord("owner"), actorEmployeeId: employeeId }), dq(), employee));
});
test("history validation does not re-time immutable declarations with today's timezone database", () => {
  const r = declarationRecord(); r.interval = { ...r.interval, timeZone: "Historical/Zone", startOffsetMinutes: 15, endOffsetMinutes: 15 };
  assert.doesNotThrow(() => projectOutageResult(detail(dq(), r), dq(), employee));
  const c = { ...declaration(), interval: r.interval };
  assert.doesNotThrow(() => parseOutageCommand(c)); // Only SQL receipt-miss path validates current zone/offset.
});
test("list enforces 25-row bound, cursor identity, ascending IDs and same incident/self identity", () => {
  const q: OutageQuery = { siteId, access: "self", mode: "declarations", incidentId: id(10), afterId: null };
  const items = Array.from({ length: 25 }, (_, n) => ({ ...declarationRecord(), id: id(100 + n), operationId: id(200 + n) }));
  const v = { ...base(q), items, nextId: id(124) };
  assert.deepEqual(projectOutageResult(v, q, employee), v);
  assert.doesNotThrow(() => projectOutageResult({ ...v, nextId: null }, q, employee));
  for (const patch of [{ items: [...items, { ...items[0], id: id(125), operationId: id(225) }] }, { nextId: id(123) }, { items: items.slice(0, 24) }, { items: [...items].reverse() }, { detail: items[0] },
    { items: [{ ...items[0], incidentId: id(99) }, ...items.slice(1)] }, { items: [{ ...items[0], employeeAuthUserId: owner }, ...items.slice(1)] },
    { items: [{ ...items[0], operationId: items[1].operationId }, ...items.slice(1)] }]) assert.throws(() => projectOutageResult({ ...v, ...patch }, q, employee));
  assert.throws(() => projectOutageResult(v, { ...q, afterId: items[0].id }, employee));
  const iqList: OutageQuery = { siteId, access: "owner", mode: "incidents", afterId: null };
  assert.doesNotThrow(() => projectOutageResult({ ...base(iqList), items: [incidentRecord()] }, iqList, owner));
});
test("parsing detaches frozen results, rejects executable getters, extra fields and oversized data", () => {
  const input = detail(), parsed = projectOutageResult(input, dq(), employee);
  assert(Object.isFrozen(parsed.detail)); assert(!Object.isFrozen(input.detail));
  (input.detail as OutageDeclaration).statement = "original remains mutable";
  assert.notEqual((parsed.detail as OutageDeclaration).statement, (input.detail as OutageDeclaration).statement);
  let called = false;
  assert.throws(() => parseOutageResult({ ...detail(), get items() { called = true; return []; } }, dq(), employee)); assert.equal(called, false);
  assert.throws(() => parseOutageResult({ ...detail(), debug: "private" }, dq(), employee));
  assert.throws(() => parseOutageResult({ ...detail(), detail: { ...declarationRecord(), statement: "x".repeat(262145) } }, dq(), employee));
});
test("25 fully populated legal Unicode declarations fit the shared 256 KiB result bound", () => {
  const q: OutageQuery = { siteId, access: "self", mode: "declarations", incidentId: id(10), afterId: null };
  const items = Array.from({ length: 25 }, (_, n) => ({ ...declarationRecord(), id: id(100 + n), operationId: id(200 + n), statement: "😀".repeat(1000), paperReference: "😀".repeat(120) }));
  const result = { ...base(q), items, nextId: id(124) }, bytes = Buffer.byteLength(JSON.stringify(result), "utf8");
  assert(bytes > 131072); assert(bytes < 262144);
  assert.equal(projectOutageResult(result, q, employee).items.length, 25);
});
test("site gate is opt-in and fail-closed for malformed or excessive allowlists", () => {
  const enabled = { FAOLLA_ATTENDANCE_OUTAGE_ENABLED: "1", FAOLLA_ATTENDANCE_OUTAGE_SITE_IDS: siteId };
  assert(outageSiteEnabled(siteId, enabled)); assert(!outageSiteEnabled(siteId, {}));
  for (const v of ["", siteId + ",", "bad," + siteId, Array(101).fill(siteId).join(","), "x".repeat(4097)]) assert(!outageSiteEnabled(siteId, { ...enabled, FAOLLA_ATTENDANCE_OUTAGE_SITE_IDS: v }));
  assert(!outageSiteEnabled(siteId + "\n", enabled)); assert(!outageSiteEnabled("99999002", enabled));
});
test("service never sends unchecked requests and defaults to disabled writes while permitting receipt reads", async () => {
  const calls: unknown[] = [];
  const r = recover();
  const service = { rpc: async (name: string, args: Record<string, unknown>) => { calls.push({ name, args }); return { data: { ...saved(), mode: "recover" }, error: null }; } };
  const value = await executeOutage({ query: r, authUserId: employee, moduleEnabled: false }, service);
  assert.equal(value.receipt!.operationId, declaration().operationId);
  assert.deepEqual(calls, [{ name: "faolla_attendance_outage_v1", args: { p_query: r, p_auth_user_id: employee, p_command: null, p_allow_write: false } }]);
  await assert.rejects(executeOutage({ query: iq(), command: declaration(), authUserId: employee }, service), /attendance_invalid_request/);
  assert.equal(calls.length, 1);
});
test("service validates authoritative response and maps only known safe errors", async () => {
  await assert.rejects(executeOutage({ query: dq(), authUserId: employee }, null), /attendance_unavailable/);
  for (const [error, expected] of [["attendance_outage_changed", "attendance_outage_changed"], ["attendance_access_denied", "attendance_access_denied"], ["SQL secret details", "attendance_unavailable"]]) {
    await assert.rejects(executeOutage({ query: dq(), authUserId: employee }, { rpc: async () => ({ data: null, error: { message: error } }) }), new RegExp(expected));
  }
  await assert.rejects(executeOutage({ query: dq(), authUserId: employee }, { rpc: async () => { throw Error("private network info"); } }), /attendance_unavailable/);
  await assert.rejects(executeOutage({ query: dq(), authUserId: employee, command: declaration() }, { rpc: async () => ({ data: { ...saved(), receipt: { ...saved().receipt!, commandFingerprint: "b".repeat(64) } }, error: null }) }), /attendance_outage_invalid/);
});
