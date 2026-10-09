import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import * as p from "./merchantAttendanceDelegatedCredentials";

//Synthetic DTO examples ONLY: no Auth, grant, KDF, device, RPC or SQL proof.
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const siteId = "99990207", actorId = id(1), grantId = id(2), operationId = id(3);
const terminalId = id(4), locationId = id(5), workerId = id(6), employeeId = id(7), employeeAuthUserId = id(8), subjectId = id(9);
const readAt = "2026-10-09T12:00:00.123456Z", before = "2026-10-09T11:58:00.000001Z";
const hash = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const tuple = (v: unknown): string => Array.isArray(v) ? "[" + v.map(tuple).join(", ") + "]" : JSON.stringify(v);
const q = (): p.DelegatedCredentialsContextQuery => ({ siteId, grantId, mode: "context", operationId: null });
const recover = (): Extract<p.DelegatedCredentialsQuery, { mode: "recover" }> => ({ siteId, grantId, mode: "recover", operationId });
test("207 browser error maps are finite frozen status-only allowlists, not private message propagation", () => {
  for (const map of [p.DELEGATED_TERMINALS_ERRORS, p.DELEGATED_PIN_ERRORS]) {
    assert(Object.isFrozen(map)); assert.equal(map.attendance_operation_conflict, 409);
    assert.equal(map.attendance_access_denied, 403); assert.equal(Object.hasOwn(map, "private SQL"), false);
    assert(Object.values(map).every(status => Number.isInteger(status) && status >= 400 && status <= 503));
  }
  assert.equal(p.DELEGATED_TERMINALS_ERRORS.attendance_delegated_terminals_invalid, 503);
  assert.equal(p.DELEGATED_PIN_ERRORS.attendance_delegated_pin_disabled, 403);
});
function terminal(action: p.DelegatedTerminalAction = "terminal_prepare"): p.DelegatedTerminalCommand {
  const common = { operationId, terminalId, locationId, reason: "明确受托操作" };
  return action === "terminal_prepare" ? { ...common, action, label: "前台", pairHash: "a".repeat(64) } : { ...common, action };
}
function member(action: p.DelegatedPinAction = "pin_issue"): p.DelegatedMemberPinCommand {
  return { kind: "member_pin", action, operationId, workerId, employeeId, employeeAuthUserId, workerNo: "员工01", expectedRevision: 1, reason: "明确受托操作" };
}
function independent(action: p.DelegatedPinAction = "pin_issue"): p.DelegatedIndependentPinCommand {
  return { kind: "independent_pin", action, operationId, workerId, subjectId, expectedSubjectRevision: 2, expectedGeneration: 1,
    expectedWorkerVersion: 3, expectedSettingsVersion: 4, expectedCredentialRevision: 1, reason: "明确受托操作" };
}
function terminalContext(action: p.DelegatedTerminalAction = "terminal_prepare") {
  return { protocol: p.DELEGATED_TERMINALS_PROTOCOL, siteId, actorId, readAt, kind: "context", grantId, action,
    scope: { kind: "terminal", terminalId, locationId, create: action === "terminal_prepare" },
    context: { terminal: action === "terminal_prepare" ? null : { id: terminalId, label: "前台", locationId, locationName: "门店", timeZone: "Europe/Madrid", state: "pending",
      createdAt: before, pairExpiresAt: "2026-10-09T12:03:00.000001Z", pairedAt: null, deviceExpiresAt: null, revokedAt: null },
    location: { locationId, name: "门店", timeZone: "Europe/Madrid", version: 2, active: true } } };
}
function memberContext(action: p.DelegatedPinAction = "pin_issue") {
  return { protocol: p.DELEGATED_PIN_PROTOCOL, siteId, actorId, readAt, kind: "context", grantId, action,
    scope: { kind: "member_pin", workerId, employeeId, employeeAuthUserId, locationIds: [locationId] },
    context: { employeeAuthUserId, status: { siteId, workerId, employeeId, workerNo: "员工01", workerName: "已有员工", ready: true,
      revision: 1, enabled: true, bindingCurrent: true, changedAt: before, receipt: null } } };
}
function independentContext(action: p.DelegatedPinAction = "pin_issue") {
  return { protocol: p.DELEGATED_PIN_PROTOCOL, siteId, actorId, readAt, kind: "context", grantId, action,
    scope: { kind: "independent_pin", workerId, subjectId, generation: 1, locationIds: [locationId] },
    context: { settingsVersion: 4, detail: { kind: "detail", subject: { subjectId, workerId, workerNo: "独立01", displayName: "独立人员", startsOn: "2026-10-09",
      locationId, enabled: true, generation: 1, revision: 2, workerVersion: 3, state: "independent", createdAt: before },
    credential: { credentialId: id(10), revision: 1, enabled: true, generation: 1, changedAt: before },
    head: { sequence: 0, status: "off", lastEventId: null, lastAction: null, lastAt: null }, binding: null } } };
}
async function terminalReceipt(c = terminal()) {
  return { protocol: p.DELEGATED_TERMINALS_PROTOCOL, siteId, actorId, readAt, kind: "receipt", receipt: {
    operationId, actorId, grantId, action: c.action, reference: { kind: "terminal", terminalId, locationId, auditAction: c.action === "terminal_prepare" ? "create" : "revoke" },
    commandFingerprint: await p.delegatedTerminalCommandFingerprint(q(), actorId, c), businessFingerprint: "b".repeat(64), recordedAt: before } };
}
async function pinReceipt(c: p.DelegatedPinCommand = member()) {
  const reference = c.kind === "member_pin" ? { kind: c.kind, workerId, employeeId, employeeAuthUserId, revision: c.expectedRevision + 1 }
    : { kind: c.kind, workerId, subjectId, subjectRevision: c.expectedSubjectRevision + 1, generation: c.expectedGeneration + (c.action === "pin_revoke" ? 1 : 0),
      workerVersion: c.expectedWorkerVersion + 1, credentialRevision: c.expectedCredentialRevision + 1 };
  return { protocol: p.DELEGATED_PIN_PROTOCOL, siteId, actorId, readAt, kind: "receipt", receipt: { operationId, actorId, grantId, action: c.action, reference,
    commandFingerprint: await p.delegatedPinCommandFingerprint(q(), actorId, c), businessFingerprint: "b".repeat(64), recordedAt: before } };
}

test("207 context/original recovery queries are exact, scoped and contain no directory or authority claim", () => {
  for (const query of [q(), recover()]) {
    assert.deepEqual(p.parseDelegatedCredentialsQuery(query), query);
    const params = new URLSearchParams(p.delegatedCredentialsQueryString(query)); assert.equal(params.get("operationId"), query.operationId ?? "");
    for (const extra of [{ workerId }, { cursor: null }, { allowWrite: true }, { mode: "list" }, { p_material: null }])
      assert.throws(() => p.parseDelegatedCredentialsQuery({ ...query, ...extra }));
  }
  assert.throws(() => p.parseDelegatedCredentialsQuery({ ...q(), operationId }));
  assert.throws(() => p.parseDelegatedCredentialsQuery({ ...recover(), operationId: null }));
});

test("207 four capability actions preserve original resource identity/CAS and reject cross-family shapes", () => {
  for (const action of ["terminal_prepare", "terminal_revoke"] as const) {
    const c = terminal(action); assert.deepEqual(p.parseDelegatedTerminalBody({ query: q(), command: c }).command, c);
    assert.throws(() => p.parseDelegatedTerminalCommand({ ...c, expectedRevision: 1 }));
    assert.throws(() => p.parseDelegatedTerminalBody({ query: recover(), command: c }));
  }
  for (const kind of [member, independent]) for (const action of ["pin_issue", "pin_revoke"] as const) {
    const c = kind(action); assert.deepEqual(p.parseDelegatedPinBody({ query: q(), command: c }).command, c);
    assert.throws(() => p.parseDelegatedTerminalCommand(c)); assert.throws(() => p.parseDelegatedPinCommand({ ...c, action: "set" }));
  }
  for (const patch of [{ employeeId: null }, { workerNo: " x" }, { expectedRevision: -0 }, { expectedRevision: 999999998 }])
    assert.throws(() => p.parseDelegatedPinCommand({ ...member(), ...patch }));
  for (const patch of [{ employeeId }, { employeeAuthUserId }, { expectedGeneration: -1 }, { expectedWorkerVersion: 0 }, { expectedCredentialRevision: 0 }])
    assert.throws(() => p.parseDelegatedPinCommand({ ...independent("pin_revoke"), ...patch }));
});

test("207 secrets are accepted only by separate ephemeral issue/prepare parsers, never durable commands or receipts", async () => {
  const t = { query: q(), command: terminal(), pairSecret: "A".repeat(43) }, m = { query: q(), command: member(), pin: "12345678" };
  assert.equal(p.parseDelegatedTerminalPrepareEphemeralBody(t).pairSecret, t.pairSecret);
  assert.equal(p.parseDelegatedPinIssueEphemeralBody(m).pin, m.pin);
  assert.equal(p.parseDelegatedPinIssueEphemeralBody({ ...m, command: independent() }).command.kind, "independent_pin");
  assert.throws(() => p.parseDelegatedTerminalBody(t)); assert.throws(() => p.parseDelegatedPinBody(m));
  for (const extra of [{ pin: "12345678" }, { pairSecret: t.pairSecret }, { salt: "a".repeat(32) }, { verifier: "a".repeat(64) }, { verified: true }, { p_material: null }]) {
    assert.throws(() => p.parseDelegatedTerminalCommand({ ...terminal(), ...extra }));
    assert.throws(() => p.parseDelegatedPinCommand({ ...member(), ...extra }));
    const r = await pinReceipt(); await assert.rejects(p.parseDelegatedPinResult({ ...r, receipt: { ...r.receipt, ...extra } }, recover(), actorId, member()));
  }
  assert.throws(() => p.parseDelegatedTerminalPrepareEphemeralBody({ ...t, command: terminal("terminal_revoke") }));
  assert.throws(() => p.parseDelegatedPinIssueEphemeralBody({ ...m, command: member("pin_revoke") }));
  assert.throws(() => p.parseDelegatedPinIssueEphemeralBody({ ...m, pin: "１２３４５６７８" }));
  assert.throws(() => p.parseDelegatedTerminalPrepareEphemeralBody({ ...t, pairSecret: "B".repeat(43) }));
  //Shape parsing does NOT claim pairHash/secret cryptographic binding. Node must prove it later.
  assert.equal(p.parseDelegatedTerminalPrepareEphemeralBody(t).command.pairHash, "a".repeat(64));
});

test("207 public SHA uses exact jsonb-compatible tuples and binds protocol/site/actor/grant/operation and all command fields", async () => {
  const cases = [terminal(), terminal("terminal_revoke"), member(), member("pin_revoke"), independent(), independent("pin_revoke")];
  for (const c of cases) {
    const isTerminal = c.action === "terminal_prepare" || c.action === "terminal_revoke";
    const values = c.action === "terminal_prepare" ? [c.action, operationId, terminalId, locationId, c.label, c.pairHash, c.reason]
      : c.action === "terminal_revoke" ? [c.action, operationId, terminalId, locationId, c.reason]
      : c.kind === "member_pin" ? [c.kind, c.action, operationId, workerId, employeeId, employeeAuthUserId, c.workerNo, 1, c.reason]
      : [c.kind, c.action, operationId, workerId, subjectId, 2, 1, 3, 4, 1, c.reason];
    const expected = tuple([(isTerminal ? p.DELEGATED_TERMINALS_PROTOCOL : p.DELEGATED_PIN_PROTOCOL) + "-command", siteId, actorId, grantId, values]);
    if (c.action === "terminal_prepare" || c.action === "terminal_revoke") {
      assert.equal(p.delegatedTerminalFingerprintText(q(), actorId, c), expected); assert.equal(await p.delegatedTerminalCommandFingerprint(q(), actorId, c), hash(expected));
      assert.notEqual(await p.delegatedTerminalCommandFingerprint(q(), id(40), c), hash(expected));
      assert.notEqual(await p.delegatedTerminalCommandFingerprint({ ...q(), grantId: id(40) }, actorId, c), hash(expected));
      assert.notEqual(await p.delegatedTerminalCommandFingerprint(q(), actorId, { ...c, operationId: id(40) }), hash(expected));
      assert.throws(() => p.delegatedTerminalFingerprintText({ ...recover(), operationId: id(40) }, actorId, c));
    } else {
      assert.equal(p.delegatedPinFingerprintText(q(), actorId, c), expected); assert.equal(await p.delegatedPinCommandFingerprint(q(), actorId, c), hash(expected));
      assert.notEqual(await p.delegatedPinCommandFingerprint({ ...q(), siteId: "99990208" }, actorId, c), hash(expected));
      assert.notEqual(await p.delegatedPinCommandFingerprint(q(), actorId, { ...c, workerId: id(40) }), hash(expected));
      assert.notEqual(await p.delegatedPinCommandFingerprint(q(), actorId, { ...c, reason: "其他明确操作" }), hash(expected));
    }
  }
});

test("207 terminal context reuses actual104 snapshot and binds create absence/revoke presence without inventing terminal CAS", async () => {
  for (const action of ["terminal_prepare", "terminal_revoke"] as const) {
    const raw = terminalContext(action), r = await p.parseDelegatedTerminalResult(raw, q(), actorId); if (r.kind !== "context") assert.fail();
    assert.deepEqual(p.delegatedTerminalCommandForContext(r, terminal(action)), terminal(action));
    assert.throws(() => p.delegatedTerminalCommandForContext(r, { ...terminal(action), terminalId: id(40) }));
    for (const patch of [{ grantId: id(40) }, { action: action === "terminal_prepare" ? "terminal_revoke" : "terminal_prepare" }, { actorId: id(40) }])
      await assert.rejects(p.parseDelegatedTerminalResult({ ...raw, ...patch }, q(), actorId));
  }
  const raw = terminalContext("terminal_revoke"), t = raw.context.terminal; assert(t);
  await assert.rejects(p.parseDelegatedTerminalResult({ ...raw, context: { ...raw.context, terminal: { ...t, pairExpiresAt: readAt } } }, q(), actorId));
  await assert.rejects(p.parseDelegatedTerminalResult({ ...raw, context: { ...raw.context, terminal: { ...t, pairHash: "a".repeat(64) } } }, q(), actorId));
});

test("207 PIN contexts bind exact member triple/version or real196 independent state/generation/location without fake Auth", async () => {
  for (const action of ["pin_issue", "pin_revoke"] as const) {
    const m = await p.parseDelegatedPinResult(memberContext(action), q(), actorId); if (m.kind !== "context") assert.fail();
    assert.deepEqual(p.delegatedPinCommandForContext(m, member(action)), member(action));
    assert.throws(() => p.delegatedPinCommandForContext(m, { ...member(action), employeeAuthUserId: id(40) }));
    assert.throws(() => p.delegatedPinCommandForContext(m, { ...member(action), expectedRevision: 2 }));
    const i = await p.parseDelegatedPinResult(independentContext(action), q(), actorId); if (i.kind !== "context") assert.fail();
    assert.deepEqual(p.delegatedPinCommandForContext(i, independent(action)), independent(action));
    assert.throws(() => p.delegatedPinCommandForContext(i, { ...independent(action), expectedGeneration: 2 }));
    assert.throws(() => p.delegatedPinCommandForContext(i, { ...independent(action), expectedSettingsVersion: 5 }));
  }
  const m = memberContext(); await assert.rejects(p.parseDelegatedPinResult({ ...m, context: { ...m.context, employeeAuthUserId: id(40) } }, q(), actorId));
  const i = independentContext(), d = i.context.detail;
  for (const patch of [{ employeeId }, { state: "bound" }, { locationId: id(40) }, { generation: 2 }])
    await assert.rejects(p.parseDelegatedPinResult({ ...i, context: { ...i.context, detail: { ...d, subject: { ...d.subject, ...patch } } } }, q(), actorId));
  //A revoked credential legitimately retains its prior issue generation/ID; no synthetic generation rewrite.
  const revoked = { ...i, scope: { ...i.scope, generation: 2 }, context: { ...i.context, detail: { ...d,
    subject: { ...d.subject, generation: 2, revision: 3, workerVersion: 4 }, credential: { ...d.credential, enabled: false, revision: 2 } } } };
  assert.equal((await p.parseDelegatedPinResult(revoked, q(), actorId)).kind, "context");
});

test("207 original terminal receipts use104 create/revoke audit key and fullSHA, not invented revision/ordinal", async () => {
  for (const action of ["terminal_prepare", "terminal_revoke"] as const) {
    const c = terminal(action), raw = await terminalReceipt(c);
    assert.equal((await p.parseDelegatedTerminalResult(raw, recover(), actorId, c)).kind, "receipt");
    assert.equal((await p.parseDelegatedTerminalResult(raw, q(), actorId, c)).kind, "receipt");
    for (const patch of [{ auditAction: "pair" }, { auditOrdinal: 1 }, { revision: 1 }, { terminalId: id(40) }, { locationId: id(40) }])
      await assert.rejects(p.parseDelegatedTerminalResult({ ...raw, receipt: { ...raw.receipt, reference: { ...raw.receipt.reference, ...patch } } }, recover(), actorId, c));
    await assert.rejects(p.parseDelegatedTerminalResult({ ...raw, receipt: { ...raw.receipt, commandFingerprint: "c".repeat(64) } }, recover(), actorId, c));
    await assert.rejects(p.parseDelegatedTerminalResult({ ...raw, protocol: p.DELEGATED_PIN_PROTOCOL }, recover(), actorId, c));
  }
  const missing = { ...(await terminalReceipt()), receipt: null }; assert.equal((await p.parseDelegatedTerminalResult(missing, recover(), actorId, terminal())).kind, "receipt");
  await assert.rejects(p.parseDelegatedTerminalResult(missing, q(), actorId, terminal()));
});

test("207 PIN receipts match original actor/op/fullSHA and real106/196 outcomes with no fresh authority requirement", async () => {
  for (const c of [member(), member("pin_revoke"), independent(), independent("pin_revoke")]) {
    const raw = await pinReceipt(c); assert.equal((await p.parseDelegatedPinResult(raw, recover(), actorId, c)).kind, "receipt");
    for (const patch of [{ actorId: id(40) }, { operationId: id(40) }, { grantId: id(40) }, { commandFingerprint: "c".repeat(64) }, { recordedAt: "2026-10-10T00:00:00.000000Z" }])
      await assert.rejects(p.parseDelegatedPinResult({ ...raw, receipt: { ...raw.receipt, ...patch } }, recover(), actorId, c));
    const changed = c.kind === "member_pin" ? { revision: 1 } : { generation: 3 };
    await assert.rejects(p.parseDelegatedPinResult({ ...raw, receipt: { ...raw.receipt, reference: { ...raw.receipt.reference, ...changed } } }, recover(), actorId, c));
    await assert.rejects(p.parseDelegatedPinResult({ ...raw, scope: memberContext().scope }, recover(), actorId, c));
  }
  const missing = { ...(await pinReceipt()), receipt: null }; assert.equal((await p.parseDelegatedPinResult(missing, recover(), actorId, member())).kind, "receipt");
  await assert.rejects(p.parseDelegatedPinResult(missing, q(), actorId, member()));
});

test("207 bounds/strict Unicode/duplicate JSON/descriptors and detached deep-freeze refuse secret-bearing malformed trees", async () => {
  for (const reason of ["", " x", "x ", "\ud800", "a\n", "😀".repeat(501)]) assert.throws(() => p.parseDelegatedPinCommand({ ...member(), reason }));
  assert.equal(p.parseDelegatedPinCommand({ ...member(), reason: "😀".repeat(500) }).reason.length, 1000);
  assert.throws(() => p.parseDelegatedCredentialsJson('{"siteId":"99990207","siteId":"99990208"}'));
  assert.throws(() => p.parseDelegatedCredentialsJson(JSON.stringify("中".repeat(3000))));
  assert.throws(() => p.parseDelegatedCredentialsJson(JSON.stringify("a".repeat(p.DELEGATED_CREDENTIALS_RESULT_BYTES)), false));
  let reads = 0; assert.throws(() => p.parseDelegatedPinCommand({ ...member(), get reason() { reads++; return "x"; } }));
  const poisoned = { ...terminalContext(), toJSON() { reads++; return null; } }; await assert.rejects(p.parseDelegatedTerminalResult(poisoned, q(), actorId));
  assert.throws(() => p.parseDelegatedPinCommand(Object.assign(Object.create({ inherited: true }), member())));
  assert.throws(() => p.parseDelegatedPinCommand({ ...member(), [Symbol("pin")]: "12345678" })); assert.equal(reads, 0);
  const raw = independentContext(), parsed = await p.parseDelegatedPinResult(raw, q(), actorId); assert(Object.isFrozen(parsed));
  if (parsed.kind !== "context" || !("detail" in parsed.context)) assert.fail();
  assert(Object.isFrozen(parsed.context.detail.subject)); raw.context.detail.subject.displayName = "changed";
  assert.equal(parsed.context.detail.subject.displayName, "独立人员"); assert.equal(Reflect.set(parsed.context.detail.subject, "displayName", "changed"), false);
});
