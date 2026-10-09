import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  INDEPENDENT_ADMIN_PROTOCOL, INDEPENDENT_TERMINAL_PROTOCOL, INDEPENDENT_RAW_PROTOCOL,
  INDEPENDENT_BINDING_PROTOCOL, INDEPENDENT_MAX_REVISION,
  parseIndependentQuery, independentQueryString, parseIndependentHttpQuery, parseIndependentCommand,
  parseIndependentBody, parseIndependentIssuePinBody, parseIndependentOwnerBody, parseIndependentJson, parseIndependentClockCommand, parseIndependentTerminalRequest,
  parseIndependentTerminalBody, independentAdminCommandText, independentClockCommandText,
  independentAdminCommandFingerprint, independentClockCommandFingerprint, independentAdminReceiptMatches,
  parseIndependentHead, parseIndependentBinding, parseIndependentClockReceipt,
  parseIndependentAdminResult, parseIndependentTerminalResult,
  type IndependentQuery, type IndependentCommand, type IndependentSubject, type IndependentCredentialStatus,
  type IndependentHead, type IndependentAdminReceipt, type IndependentAdminData, type IndependentAdminResult,
  type IndependentClockCommand, type IndependentClockReceipt, type IndependentTerminalBody,
  type IndependentTerminalRequest, type IndependentTerminalSubject, type IndependentRawReport,
  type IndependentRawShift, type IndependentTerminalData, type IndependentTerminalResult,
} from "./merchantAttendanceIndependent";

// Synthetic wire examples only. No actual Auth, device, worker or SQL proof.
const id = (n: number) => `00000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
const siteId = "99990196", actorId = id(1), subjectId = id(2), workerId = id(3), terminalId = id(4), locationId = id(5);
const at = "2026-10-08T12:00:00.123456Z", before = "2026-10-08T08:00:00.000001Z";
const sha = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const tuple = (v: unknown): string => Array.isArray(v) ? "[" + v.map(tuple).join(", ") + "]" : JSON.stringify(v);
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const detail = (): IndependentQuery => ({ siteId, mode: "detail", subjectId });
const list = (): Extract<IndependentQuery, { mode: "list" }> => ({ siteId, mode: "list", cursor: null, search: "", state: "all" });
const history = (cursor: string | null = null): Extract<IndependentQuery, { mode: "history" }> => ({ siteId, mode: "history", subjectId, fromDate: "2026-10-08", throughDate: "2026-10-08", cursor });
function command(action: IndependentCommand["action"] = "create"): IndependentCommand {
  if (action === "create") return { action, operationId: id(10), subjectId, workerId, expectedSettingsVersion: 2, workerNo: "员工01", displayName: "合成人员", locationId, startsOn: "2026-10-08", reason: "明确无员工账号" };
  const b = { operationId: id(10), subjectId, expectedSubjectRevision: 2, expectedGeneration: 1, expectedWorkerVersion: 3, expectedSettingsVersion: 2, reason: "明确操作" };
  if (action === "enable" || action === "disable") return { ...b, action };
  if (action === "issue_pin" || action === "revoke_pin") return { ...b, action, expectedCredentialRevision: 1 };
  return { ...b, action, expectedCredentialRevision: 1, targetEmployeeId: id(11), targetAuthUserId: id(12), expectedLastEventId: id(13), expectedSequence: 4 };
}
function subject(): IndependentSubject { return { subjectId, workerId, workerNo: "员工01", displayName: "合成人员", startsOn: "2026-10-08", locationId, enabled: false, generation: 0, revision: 1, workerVersion: 1, state: "independent", createdAt: before }; }
const credential = (): IndependentCredentialStatus => ({ credentialId: null, revision: 0, enabled: false, generation: null, changedAt: null });
const off = (): IndependentHead => ({ sequence: 0, status: "off", lastEventId: null, lastAction: null, lastAt: null });
function adminReceipt(c = command()): IndependentAdminReceipt {
  return { operationId: c.operationId, subjectId, workerId, action: c.action, actorId,
    subjectRevision: c.action === "create" ? 1 : c.expectedSubjectRevision + 1,
    generation: c.action === "create" ? 0 : c.expectedGeneration + (["disable", "revoke_pin", "bind_member"].includes(c.action) ? 1 : 0),
    workerVersion: c.action === "create" ? 1 : c.expectedWorkerVersion + 1,
    credentialRevision: c.action === "issue_pin" ? c.expectedCredentialRevision + 1 : c.action === "revoke_pin" || c.action === "bind_member" ? c.expectedCredentialRevision === 0 ? 0 : c.expectedCredentialRevision + 1 : c.action === "disable" ? 2 : null,
    recordedAt: before, commandFingerprint: sha(independentAdminCommandText(siteId, actorId, c)) };
}
function admin(data: IndependentAdminData, receipt: IndependentAdminReceipt | null = null): IndependentAdminResult { return { protocol: INDEPENDENT_ADMIN_PROTOCOL, siteId, actorId, readAt: at, settingsVersion: 2, data, receipt }; }
function clockCommand(sequence = 1, action: IndependentClockCommand["action"] = "clock_in"): IndependentClockCommand {
  return { operationId: id(100 + sequence), subjectId, workerId, generation: 0, credentialId: id(20), credentialRevision: 1,
    expectedWorkerVersion: 2, expectedSettingsVersion: 2, locationId, expectedLocationVersion: 3,
    expectedSequence: sequence - 1, action, breakPaid: action === "break_start" ? false : null };
}
function clockReceipt(sequence = 1, action: IndependentClockCommand["action"] = "clock_in", override: Partial<IndependentClockCommand> = {}): IndependentClockReceipt {
  const c = { ...clockCommand(sequence, action), ...override }, commandFingerprint = sha(independentClockCommandText(siteId, terminalId, c));
  const time = `2026-10-08T08:${Math.floor(sequence / 60).toString().padStart(2, "0")}:${(sequence % 60).toString().padStart(2, "0")}.000001Z`;
  return { operationId: c.operationId, command: c, commandFingerprint,
    event: { id: id(10000 + sequence), operationId: c.operationId, sequence, action, locationId, occurredAt: time, receivedAt: time, timeZone: "Europe/Madrid", breakPaid: c.breakPaid, source: "kiosk", actorEmployeeId: null },
    source: { subjectId, generation: c.generation, credentialId: c.credentialId, credentialRevision: c.credentialRevision, credentialIssueOperationId: id(21), terminalId,
      workerVersion: c.expectedWorkerVersion, settingsVersion: c.expectedSettingsVersion, locationVersion: c.expectedLocationVersion, commandFingerprint } };
}
function terminalSubject(): IndependentTerminalSubject { return { subjectId, workerId, workerNo: "员工01", displayName: "合成人员", generation: 0, workerVersion: 2, credentialId: id(20), credentialRevision: 1, settingsVersion: 2, locationId, locationVersion: 3, timeZone: "Europe/Madrid" }; }
function body(request: IndependentTerminalRequest = { kind: "state" }): IndependentTerminalBody { return { siteId, terminalId, workerNo: "员工01", pin: "12345678", request }; }
function terminal(data: IndependentTerminalData): IndependentTerminalResult { return { protocol: INDEPENDENT_TERMINAL_PROTOCOL, siteId, terminalId, readAt: at, data }; }
function head(r: IndependentClockReceipt): IndependentHead { return { sequence: r.event.sequence, status: r.event.action === "clock_out" ? "off" : r.event.action === "break_start" ? "break" : "working", lastEventId: r.event.id, lastAction: r.event.action, lastAt: r.event.occurredAt }; }
function shift(n = 0): IndependentRawShift { const start = clockReceipt(n * 2 + 1), end = clockReceipt(n * 2 + 2, "clock_out"); return { startEventId: start.event.id, endEventId: end.event.id, complete: true, events: [start, end] }; }
function report(items: readonly IndependentRawShift[] = [shift()], nextCursor: string | null = null, cursor: string | null = null): IndependentRawReport { return { protocol: INDEPENDENT_RAW_PROTOCOL, siteId, subjectId, workerId, workerNo: "员工01", displayName: "合成人员", timeZone: "Europe/Madrid", fromDate: "2026-10-08", throughDate: "2026-10-08", fromAt: "2026-10-07T22:00:00.000000Z", toAt: "2026-10-08T22:00:00.000000Z", readAt: at, items, nextCursor, pageComplete: true, rangeComplete: cursor === null && nextCursor === null, rulesAssessment: "unassessed", fixedPeriodEligible: false }; }

test("196 owner candidate queries are exact read-only literal modes and round trip without target/PIN", () => {
  for (const mode of ["members", "locations"] as const) { const q = { siteId, mode, cursor: null, search: "真实选项" };
    assert.deepEqual(parseIndependentQuery(q), q); assert.deepEqual(parseIndependentHttpQuery("https://example.invalid/?" + independentQueryString(q)), q);
    for (const extra of [{ state: "all" }, { subjectId }, { pin: "12345678" }]) assert.throws(() => parseIndependentQuery({ ...q, ...extra }));
    assert.throws(() => parseIndependentBody({ query: q, command: command() })); }
});
test("196 member choices bind real employee/Auth pairs, preserve order and reject missing/duplicate identities", async () => {
  const q: IndependentQuery = { siteId, mode: "members", cursor: null, search: "" }, items = [{ employeeId: id(40), authUserId: id(41), displayName: "已有员工" }];
  const valid = admin({ kind: "members", items, nextCursor: null }); assert.deepEqual((await parseIndependentAdminResult(valid, q, actorId)).data, valid.data);
  for (const bad of [[{ ...items[0], authUserId: "" }], [items[0], { ...items[0], employeeId: id(42) }], [items[0], items[0]], [{ ...items[0], email: "hidden@example.test" }]])
    await assert.rejects(parseIndependentAdminResult({ ...valid, data: { ...valid.data, items: bad } }, q, actorId));
  await assert.rejects(parseIndependentAdminResult({ ...valid, receipt: adminReceipt() }, q, actorId));
  await assert.rejects(parseIndependentAdminResult(valid, { ...q, cursor: id(40) }, actorId));
});
test("196 location choices expose only active-choice wire fields and validate timezone, order and scope", async () => {
  const q: IndependentQuery = { siteId, mode: "locations", cursor: null, search: "" }, items = [{ locationId, name: "真实地点", timeZone: "Europe/Madrid" }];
  const valid = admin({ kind: "locations", items, nextCursor: null }); assert.deepEqual((await parseIndependentAdminResult(valid, q, actorId)).data, valid.data);
  for (const bad of [[{ ...items[0], timeZone: "" }], [items[0], items[0]], [{ ...items[0], latitude: 37 }]])
    await assert.rejects(parseIndependentAdminResult({ ...valid, data: { ...valid.data, items: bad } }, q, actorId));
  await assert.rejects(parseIndependentAdminResult(valid, { ...q, siteId: "99990001" }, actorId));
  await assert.rejects(parseIndependentAdminResult(valid, { ...q, mode: "members" }, actorId));
});
test("196 candidate pages require exactly25 before a matching sentinel cursor and never accept26", async () => {
  for (const mode of ["members", "locations"] as const) { const q: IndependentQuery = { siteId, mode, cursor: null, search: "" };
    const items = Array.from({ length: 25 }, (_, n) => mode === "members" ? { employeeId: id(200 + n), authUserId: id(300 + n), displayName: "员工" } : { locationId: id(200 + n), name: "地点", timeZone: "UTC" });
    const value = { ...admin({ kind: "receipt" }), data: { kind: mode, items, nextCursor: id(224) } };
    assert.equal((await parseIndependentAdminResult(value, q, actorId)).data.kind, mode);
    for (const data of [{ ...value.data, nextCursor: id(223) }, { ...value.data, items: items.slice(0, 24) }, { ...value.data, items: [...items, items[0]] }])
      await assert.rejects(parseIndependentAdminResult({ ...value, data }, q, actorId)); }
});

test("196 exact owner queries/commands, null cursor and no-PIN command body round trips", () => {
  const queries: IndependentQuery[] = [list(), detail(), { siteId, mode: "recover", subjectId, operationId: id(10) }, history(id(10001))];
  for (const q of queries) { assert.deepEqual(parseIndependentQuery(q), q); assert.deepEqual(parseIndependentHttpQuery("https://example.invalid/?" + independentQueryString(q)), q); assert.throws(() => parseIndependentQuery({ ...q, employeeId: null })); }
  for (const a of ["create", "enable", "disable", "issue_pin", "revoke_pin", "bind_member"] as const) { const c = command(a); assert.deepEqual(parseIndependentCommand(c), c); assert.deepEqual(parseIndependentBody({ query: detail(), command: c }), { query: detail(), command: c }); assert.throws(() => parseIndependentCommand({ ...c, pin: "12345678" })); }
  for (const suffix of ["&mode=list", "&extra=1", "#", "&cursor="]) assert.throws(() => parseIndependentHttpQuery("https://example.invalid/?" + independentQueryString(list()) + suffix));
  assert.throws(() => parseIndependentBody({ query: list(), command: command() })); assert.throws(() => parseIndependentBody({ query: { ...detail(), subjectId: id(99) }, command: command() }));
  assert.throws(() => parseIndependentCommand({ ...command("bind_member"), expectedLastEventId: null }));
});

test("196 Unicode/date/CAS/byte bounds do not silently normalize", () => {
  for (const reason of ["", " x", "x ", "a\n", "\u0085", "\ud800", "😀".repeat(501)]) assert.throws(() => parseIndependentCommand({ ...command(), reason }));
  assert.equal(parseIndependentCommand({ ...command(), reason: "😀".repeat(500) }).reason.length, 1000);
  for (const startsOn of ["2026-02-30", "1999-12-31", "2101-01-01", "2026-1-01"]) assert.throws(() => parseIndependentCommand({ ...command(), startsOn }));
  for (const v of [-0, -1, Infinity, 1.5, INDEPENDENT_MAX_REVISION]) assert.throws(() => parseIndependentCommand({ ...command("disable"), expectedSubjectRevision: v }));
  assert.throws(() => parseIndependentCommand({ ...command("revoke_pin"), expectedCredentialRevision: INDEPENDENT_MAX_REVISION }));
  assert.throws(() => parseIndependentQuery({ ...history(), throughDate: "2026-11-08" }));
  assert.throws(() => parseIndependentQuery({ ...detail(), subjectId: subjectId + "\n" }));
  assert.throws(() => parseIndependentQuery({ ...detail(), siteId: siteId + "\n" }));
  assert.throws(() => parseIndependentTerminalRequest({ kind: "recover", subjectId, workerId, operationId: id(101), commandFingerprint: "a".repeat(64) + "\n" }));
  assert.throws(() => parseIndependentJson('{"siteId":"99990196","siteId":"99990197"}', true));
  assert.throws(() => parseIndependentJson(JSON.stringify("中".repeat(3000)), true));
  assert.throws(() => parseIndependentJson(JSON.stringify("a".repeat(1048577))));
});

test("196 descriptor capture refuses getters, symbols, exotic and sparse trees without executing code", async () => {
  let reads = 0; const getter = { ...list(), get mode() { reads++; return "list"; } }; assert.throws(() => parseIndependentQuery(getter));
  assert.throws(() => parseIndependentCommand({ ...command(), get reason() { reads++; return "恶意"; } }));
  const poisoned = { ...admin({ kind: "list", items: [], nextCursor: null }), toJSON() { reads++; return null; } };
  await assert.rejects(parseIndependentAdminResult(poisoned, list(), actorId));
  const sparse: IndependentSubject[] = new Array(1); await assert.rejects(parseIndependentAdminResult(admin({ kind: "list", items: sparse, nextCursor: null }), list(), actorId));
  await assert.rejects(parseIndependentAdminResult(Object.assign(Object.create({ inherited: true }), admin({ kind: "list", items: [], nextCursor: null })), list(), actorId));
  const symbolic = { ...body(), [Symbol("secret")]: "not allowed" }; assert.throws(() => parseIndependentTerminalBody(symbolic));
  assert.equal(reads, 0);
});

test("196 public SHA matches independent Node canonical tuple bytes and every scoped field", async () => {
  for (const a of ["create", "enable", "disable", "issue_pin", "revoke_pin", "bind_member"] as const) {
    const c = command(a), values = a === "create" ? [workerId, 2, "员工01", "合成人员", locationId, "2026-10-08", "明确无员工账号"] : [2, 1, 3, 2, "明确操作", ...(a === "issue_pin" || a === "revoke_pin" || a === "bind_member" ? [1] : []), ...(a === "bind_member" ? [id(11), id(12), id(13), 4] : [])];
    const expected = tuple(["attendance-independent-admin-command-v1", siteId, actorId, a, id(10), subjectId, values]);
    assert.equal(independentAdminCommandText(siteId, actorId, c), expected); assert.equal(await independentAdminCommandFingerprint(siteId, actorId, c), sha(expected));
    assert.notEqual(await independentAdminCommandFingerprint(siteId, id(99), c), sha(expected)); assert.notEqual(await independentAdminCommandFingerprint("99990197", actorId, c), sha(expected));
  }
  const c = clockCommand(), expected = tuple(["attendance-independent-clock-command-v1", siteId, terminalId, [c.operationId, subjectId, workerId, 0, id(20), 1, 2, 2, locationId, 3, 0, "clock_in", null]]);
  assert.equal(independentClockCommandText(siteId, terminalId, c), expected); assert.equal(await independentClockCommandFingerprint(siteId, terminalId, c), sha(expected));
  for (const changed of [{ subjectId: id(99) }, { workerId: id(99) }, { generation: 1 }, { credentialId: id(99) }, { credentialRevision: 2 }, { expectedWorkerVersion: 3 }, { expectedSettingsVersion: 3 }, { locationId: id(99) }, { expectedLocationVersion: 4 }, { expectedSequence: 1 }, { action: "clock_out" as const }, { operationId: id(99) }]) assert.notEqual(await independentClockCommandFingerprint(siteId, terminalId, { ...c, ...changed }), sha(expected));
  assert.notEqual(await independentClockCommandFingerprint(siteId, id(99), c), sha(expected));
  const quoted = { ...command(), reason: '说明, "中文" 😀 \\ A' };
  const quotedText = tuple(["attendance-independent-admin-command-v1", siteId, actorId, "create", id(10), subjectId, [workerId, 2, "员工01", "合成人员", locationId, "2026-10-08", quoted.reason]]);
  assert.equal(independentAdminCommandText(siteId, actorId, quoted), quotedText);
  assert.equal(await independentAdminCommandFingerprint(siteId, actorId, quoted), sha(quotedText));
});

test("196 owner original receipts advance exact versions without reviving or exposing PIN", async () => {
  for (const a of ["create", "enable", "disable", "issue_pin", "revoke_pin", "bind_member"] as const) {
    const c = command(a), receipt = adminReceipt(c), raw = admin({ kind: "receipt" }, receipt);
    const parsed = await parseIndependentAdminResult(raw, detail(), actorId, c); assert.deepEqual(parsed.receipt, receipt); assert.equal(Object.isFrozen(parsed.receipt), true);
    const q: IndependentQuery = { siteId, mode: "recover", subjectId, operationId: c.operationId }; await parseIndependentAdminResult(raw, q, actorId, c);
    const missing = await parseIndependentAdminResult(admin({ kind: "receipt" }), q, actorId, c); assert.equal(missing.receipt, null);
    assert.equal(independentAdminReceiptMatches(receipt, c, actorId, receipt.commandFingerprint), true);
    for (const change of [{ actorId: id(99) }, { subjectId: id(99) }, { subjectRevision: receipt.subjectRevision + 1 }, { workerVersion: receipt.workerVersion + 1 }, { generation: receipt.generation + 1 }, { commandFingerprint: "b".repeat(64) }, { recordedAt: "2026-10-08T12:00:00.123457Z" }, { salt: "not public" }]) await assert.rejects(parseIndependentAdminResult(admin({ kind: "receipt" }, { ...receipt, ...change }), q, actorId, c));
    await assert.rejects(parseIndependentAdminResult(admin({ kind: "receipt" }), detail(), actorId, c));
  }
});

test("196 owner handoff can display original actor receipt but pending recovery cannot claim another actor", async () => {
  const c = command(), original = adminReceipt(c), nextOwner = id(999), q: IndependentQuery = { siteId, mode: "recover", subjectId, operationId: c.operationId };
  const handedOff = { ...admin({ kind: "receipt" }, original), actorId: nextOwner };
  const result = await parseIndependentAdminResult(handedOff, q, nextOwner); assert.equal(result.receipt!.actorId, actorId);
  assert.equal(independentAdminReceiptMatches(original, c, nextOwner, original.commandFingerprint), false);
  await assert.rejects(parseIndependentAdminResult(handedOff, q, nextOwner, c));
  await assert.rejects(parseIndependentAdminResult(handedOff, detail(), nextOwner, c));
  // The original actor's minimum-receipt response contains no current detail.
  await parseIndependentAdminResult(admin({ kind: "receipt" }, original), q, actorId, c);
  await assert.rejects(parseIndependentAdminResult(admin({ kind: "detail", subject: subject(), credential: credential(), head: off(), binding: null }), q, actorId, c));
  for (const a of ["revoke_pin", "bind_member"] as const) {
    const noPin = { ...command(a), expectedCredentialRevision: 0 }, receipt = adminReceipt(noPin);
    assert.equal(receipt.credentialRevision, 0); await parseIndependentAdminResult(admin({ kind: "receipt" }, receipt), detail(), actorId, noPin);
    await assert.rejects(parseIndependentAdminResult(admin({ kind: "receipt" }, { ...receipt, credentialRevision: 1 }), detail(), actorId, noPin));
  }
  const disable = command("disable"), receipt = { ...adminReceipt(disable), credentialRevision: 0 };
  await parseIndependentAdminResult(admin({ kind: "receipt" }, receipt), detail(), actorId, disable);
  await assert.rejects(parseIndependentAdminResult(admin({ kind: "receipt" }, { ...receipt, credentialRevision: null }), detail(), actorId, disable));
});

test("196 owner detail is true independent or proven bound; credential status has no secret", async () => {
  const d: IndependentAdminData = { kind: "detail", subject: subject(), credential: credential(), head: off(), binding: null };
  await parseIndependentAdminResult(admin(d), detail(), actorId);
  for (const changed of [{ ...d, subject: { ...subject(), employeeId: null } }, { ...d, credential: { ...credential(), salt: "x" } }, { ...d, credential: { ...credential(), enabled: true } }, { ...d, subject: { ...subject(), state: "bound" } }, { ...d, head: { ...off(), sequence: 1 } }]) await assert.rejects(parseIndependentAdminResult(admin(changed as IndependentAdminData), detail(), actorId));
  const binding = { protocol: INDEPENDENT_BINDING_PROTOCOL, siteId, workerId, subjectId, bindingOperationId: id(30), employeeId: id(31), employeeAuthUserId: id(32), workerVersion: 3, generation: 1, lastIndependentEventId: null, lastSequence: 0, boundAt: before };
  const bound: IndependentAdminData = { ...d, subject: { ...subject(), state: "bound", workerVersion: 3, revision: 3, generation: 1 }, binding };
  assert.deepEqual(parseIndependentBinding(binding), binding); await parseIndependentAdminResult(admin(bound), detail(), actorId);
  await assert.rejects(parseIndependentAdminResult(admin({ ...bound, subject: { ...bound.subject, enabled: true } }), detail(), actorId));
  assert.throws(() => parseIndependentBinding({ ...binding, lastSequence: 1 }));
  assert.throws(() => parseIndependentHead({ ...off(), lastAction: "clock_in" }, at));
  assert.throws(() => parseIndependentHead(off(), "not utc"));
});

test("196 discovery preserves25+1 pagination, state filters and sorted unique subject IDs", async () => {
  const items = Array.from({ length: 25 }, (_, i) => ({ ...subject(), subjectId: id(300 + i), workerId: id(400 + i), workerNo: `W${i}` }));
  const first = admin({ kind: "list", items, nextCursor: items[24].subjectId }); await parseIndependentAdminResult(first, list(), actorId);
  await parseIndependentAdminResult(admin({ kind: "list", items: [{ ...subject(), subjectId: id(325) }], nextCursor: null }), { ...list(), cursor: id(324) }, actorId);
  for (const data of [{ kind: "list", items: [...items, subject()], nextCursor: null }, { kind: "list", items: items.slice(1), nextCursor: items[24].subjectId }, { kind: "list", items: [...items].reverse(), nextCursor: items[24].subjectId }, { kind: "list", items: [items[0], { ...items[1], workerId: items[0].workerId }], nextCursor: null }, { kind: "list", items: [items[0], { ...items[1], workerNo: items[0].workerNo }], nextCursor: null }]) await assert.rejects(parseIndependentAdminResult(admin(data as IndependentAdminData), list(), actorId));
  await assert.rejects(parseIndependentAdminResult(first, { ...list(), state: "bound" }, actorId));
});

test("196 terminal authentication body is separate from saved requests and action paid snapshot", () => {
  const requests: IndependentTerminalRequest[] = [{ kind: "state" }, { kind: "clock", command: clockCommand() }, { kind: "recover", subjectId, workerId, operationId: id(101), commandFingerprint: "a".repeat(64) }, { kind: "personal", subjectId, workerId, fromDate: "2026-10-08", throughDate: "2026-10-08", cursor: null }];
  for (const request of requests) { assert.deepEqual(parseIndependentTerminalRequest(request), request); assert.deepEqual(parseIndependentTerminalBody(body(request)), body(request)); assert.throws(() => parseIndependentTerminalRequest({ ...request, pin: "12345678" })); }
  for (const pin of ["1234", "1234567x", "1234567890123", " 12345678"]) assert.throws(() => parseIndependentTerminalBody({ ...body(), pin }));
  assert.throws(() => parseIndependentTerminalBody({ ...body(), verified: true })); assert.throws(() => parseIndependentClockCommand({ ...clockCommand(), employeeId: null }));
  assert.throws(() => parseIndependentClockCommand({ ...clockCommand(), breakPaid: false }));
  assert.throws(() => parseIndependentClockCommand({ ...clockCommand(2, "break_start"), breakPaid: null }));
  assert.equal(parseIndependentClockCommand(clockCommand(2, "break_start")).breakPaid, false);
});

test("196 owner issue PIN exists only in exact short POST, never in saved command or public fingerprint", async () => {
  const issue = command("issue_pin"), raw = { query: detail(), command: issue, pin: "12345678" };
  assert.deepEqual(parseIndependentIssuePinBody(raw), raw); assert.deepEqual(parseIndependentOwnerBody(raw), raw);
  assert.deepEqual(parseIndependentOwnerBody({ query: detail(), command: command("disable") }), { query: detail(), command: command("disable") });
  for (const pin of ["1234", "1234567", "1234567890123", "1234567x"]) assert.throws(() => parseIndependentIssuePinBody({ ...raw, pin }));
  assert.throws(() => parseIndependentOwnerBody({ query: detail(), command: issue }));
  assert.throws(() => parseIndependentIssuePinBody({ ...raw, command: command("disable") }));
  assert.throws(() => parseIndependentOwnerBody({ ...raw, command: command("disable") }));
  assert.throws(() => parseIndependentIssuePinBody({ ...raw, verifier: "not public" }));
  assert.throws(() => parseIndependentBody(raw)); assert.throws(() => parseIndependentCommand({ ...issue, pin: raw.pin }));
  const first = parseIndependentIssuePinBody(raw), second = parseIndependentIssuePinBody({ ...raw, pin: "87654321" });
  assert.equal(await independentAdminCommandFingerprint(siteId, actorId, first.command), await independentAdminCommandFingerprint(siteId, actorId, second.command));
  assert.equal(independentAdminCommandText(siteId, actorId, first.command).includes(raw.pin), false);
  let reads = 0; assert.throws(() => parseIndependentIssuePinBody({ ...raw, get pin() { reads++; return "12345678"; } })); assert.equal(reads, 0);
});

test("196 receipt source graph verifies exact identities/version/hash/time without fake member actor", async () => {
  const receipt = clockReceipt(); assert.deepEqual(await parseIndependentClockReceipt(receipt, siteId, terminalId, at), receipt);
  const edits = [(r: IndependentClockReceipt) => ({ ...r, source: { ...r.source, subjectId: id(99) } }), (r: IndependentClockReceipt) => ({ ...r, source: { ...r.source, credentialRevision: 2 } }), (r: IndependentClockReceipt) => ({ ...r, source: { ...r.source, workerVersion: 3 } }), (r: IndependentClockReceipt) => ({ ...r, event: { ...r.event, actorEmployeeId: id(99) } }), (r: IndependentClockReceipt) => ({ ...r, event: { ...r.event, sequence: 2 } }), (r: IndependentClockReceipt) => ({ ...r, event: { ...r.event, receivedAt: "2026-10-08T07:59:59.000000Z" } }), (r: IndependentClockReceipt) => ({ ...r, commandFingerprint: "a".repeat(64) }), (r: IndependentClockReceipt) => ({ ...r, event: { ...r.event, source: "web" } })];
  for (const edit of edits) await assert.rejects(parseIndependentClockReceipt(edit(receipt), siteId, terminalId, at));
  await assert.rejects(parseIndependentClockReceipt(receipt, "99990197", terminalId, at)); await assert.rejects(parseIndependentClockReceipt(receipt, siteId, id(99), at));
  const value = await parseIndependentTerminalResult(terminal({ kind: "clock", subject: terminalSubject(), head: head(receipt), receipt }), body({ kind: "clock", command: receipt.command }));
  assert.equal(JSON.stringify(value).includes("12345678"), false); assert.equal(Object.isFrozen(value.data), true);
  // Replayed operation can legitimately be older than the currently read head.
  await parseIndependentTerminalResult(terminal({ kind: "clock", subject: terminalSubject(), head: head(clockReceipt(2, "clock_out")), receipt }), body({ kind: "clock", command: receipt.command }));
  await assert.rejects(parseIndependentTerminalResult(terminal({ kind: "clock", subject: terminalSubject(), head: off(), receipt }), body({ kind: "clock", command: receipt.command })));
});

test("196 reauthenticated recovery is read-only minimum original scope and never another body", async () => {
  const receipt = clockReceipt(), request: IndependentTerminalRequest = { kind: "recover", subjectId, workerId, operationId: receipt.operationId, commandFingerprint: receipt.commandFingerprint };
  await parseIndependentTerminalResult(terminal({ kind: "receipt", receipt }), body(request));
  const absent = await parseIndependentTerminalResult(terminal({ kind: "receipt", receipt: null }), body(request)); assert.deepEqual(absent.data, { kind: "receipt", receipt: null });
  for (const changed of [{ ...request, subjectId: id(99) }, { ...request, workerId: id(99) }, { ...request, operationId: id(99) }, { ...request, commandFingerprint: "b".repeat(64) }]) await assert.rejects(parseIndependentTerminalResult(terminal({ kind: "receipt", receipt }), body(changed)));
  await assert.rejects(parseIndependentTerminalResult(terminal({ kind: "state", subject: terminalSubject(), head: off() }), body(request)));
});

test("196 personal/owner raw pages preserve full four-action FSM and independent generations", async () => {
  const events = [clockReceipt(1), clockReceipt(2, "break_start"), clockReceipt(3, "break_end", { generation: 1, credentialRevision: 2, credentialId: id(29) }), clockReceipt(4, "clock_out", { generation: 1, credentialRevision: 2, credentialId: id(29) })];
  const s: IndependentRawShift = { startEventId: events[0].event.id, endEventId: events[3].event.id, complete: true, events }, raw = report([s]);
  await parseIndependentAdminResult(admin({ kind: "history", report: raw }), history(), actorId);
  const q: IndependentTerminalRequest = { kind: "personal", subjectId, workerId, fromDate: "2026-10-08", throughDate: "2026-10-08", cursor: null };
  await parseIndependentTerminalResult(terminal({ kind: "personal", report: raw }), body(q));
  const open: IndependentRawShift = { ...s, endEventId: null, complete: false, events: events.slice(0, 2) }; await parseIndependentAdminResult(admin({ kind: "history", report: report([open]) }), history(), actorId);
  const invalid: IndependentRawReport[] = [report([{ ...s, events: [events[0], events[1], events[3]] }]), report([{ ...s, complete: false }]), report([{ ...s, events: [events[1], events[2], events[3]] }]), { ...raw, rulesAssessment: "verified" as "unassessed" }, { ...raw, fixedPeriodEligible: true as false }, { ...raw, pageComplete: false as true }, { ...raw, subjectId: id(99) }, { ...raw, rangeComplete: false }];
  for (const r of invalid) await assert.rejects(parseIndependentAdminResult(admin({ kind: "history", report: r }), history(), actorId));
  const moved = clone(raw); Object.assign(moved.items[0].events[2].command, { workerId: id(99) }); await assert.rejects(parseIndependentAdminResult(admin({ kind: "history", report: moved }), history(), actorId));
});

test("19625-shift pagination and overlapping overnight/empty local day never truncate a shift", async () => {
  const items = Array.from({ length: 25 }, (_, i) => shift(i)), next = items[24].startEventId;
  await parseIndependentAdminResult(admin({ kind: "history", report: report(items, next) }), history(), actorId);
  await parseIndependentAdminResult(admin({ kind: "history", report: report([shift(25)], null, next) }), history(next), actorId);
  for (const r of [report([...items, shift(25)]), report(items.slice(1), next), { ...report(items, next), rangeComplete: true }]) await assert.rejects(parseIndependentAdminResult(admin({ kind: "history", report: r }), history(), actorId));
  const overnight = clone(report()); Object.assign(overnight.items[0].events[0].event, { occurredAt: "2026-10-07T21:00:00.000001Z", receivedAt: "2026-10-07T21:00:00.000001Z" });
  await parseIndependentAdminResult(admin({ kind: "history", report: overnight }), history(), actorId);
  const emptyDay = { ...report([]), fromAt: "2026-10-08T00:00:00.000000Z", toAt: "2026-10-08T00:00:00.000000Z", timeZone: "Pacific/Apia" };
  await parseIndependentAdminResult(admin({ kind: "history", report: emptyDay }), history(), actorId);
  await assert.rejects(parseIndependentAdminResult(admin({ kind: "history", report: { ...emptyDay, items: [shift()] } }), history(), actorId));
  await assert.rejects(parseIndependentAdminResult(admin({ kind: "history", report: { ...report(), toAt: "2026-10-07T21:00:00.000000Z" } }), history(), actorId));
});

test("196 async SHA verification detaches raw result, query and expected command before await", async () => {
  const receipt = clockReceipt(), raw = terminal({ kind: "clock", subject: terminalSubject(), head: head(receipt), receipt }), input = body({ kind: "clock", command: receipt.command });
  const subtle = crypto.subtle, original = subtle.digest, own = Object.getOwnPropertyDescriptor(subtle, "digest"); let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  Object.defineProperty(subtle, "digest", { configurable: true, value: async function (...args: Parameters<SubtleCrypto["digest"]>) { await held; return original.apply(subtle, args); } });
  try { const pending = parseIndependentTerminalResult(raw, input);
    Object.assign(raw, { receipt: undefined }); // unrelated caller-owned extra field
    Object.assign((raw.data as Extract<IndependentTerminalData, { kind: "clock" }>).receipt.command, { subjectId: id(99) });
    Object.assign(input, { request: { kind: "state" } }); release(); const parsed = await pending;
    assert.equal(parsed.data.kind, "clock"); if (parsed.data.kind === "clock") assert.equal(parsed.data.receipt.command.subjectId, subjectId);
    assert.equal(Object.isFrozen(parsed.data), true);
  } finally { release(); if (own) Object.defineProperty(subtle, "digest", own); else Reflect.deleteProperty(subtle, "digest"); }
});
