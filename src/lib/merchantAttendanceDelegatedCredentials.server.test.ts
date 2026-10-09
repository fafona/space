import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import test from "node:test";
import * as p from "./merchantAttendanceDelegatedCredentials";
import { createDelegatedCredentialsService, delegatedPinSiteEnabled, delegatedTerminalsSiteEnabled } from "./merchantAttendanceDelegatedCredentials.server";
import { independentAttendanceMaterialCommitment } from "./merchantAttendanceIndependentPinKdf.server";
import { MerchantAttendanceError } from "./merchantAttendanceTime";

//Service mocks, 0 real Auth/SQL/KDF. Every derived verifier below is a TEST double.
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const siteId = "99990207", actor = id(1), grantId = id(2), op = id(3), terminalId = id(4), locationId = id(5), workerId = id(6), employeeId = id(7), auth = id(8), subjectId = id(9);
const at = "2026-10-09T12:00:00.000001Z", before = "2026-10-09T11:58:00.000001Z", secret = "A".repeat(43), key = "synthetic-pepper-not-production";
const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex"), encode = (v: unknown): string => Array.isArray(v) ? "[" + v.map(encode).join(", ") + "]" : JSON.stringify(v);
const q = (): p.DelegatedCredentialsContextQuery => ({ siteId, grantId, mode: "context", operationId: null });
const r = (): Extract<p.DelegatedCredentialsQuery, { mode: "recover" }> => ({ siteId, grantId, mode: "recover", operationId: op });
const environment = () => ({ FAOLLA_ATTENDANCE_DELEGATED_TERMINALS_ENABLED: "1", FAOLLA_ATTENDANCE_DELEGATED_TERMINALS_SITE_IDS: siteId,
  FAOLLA_ATTENDANCE_DELEGATED_PIN_ENABLED: "1", FAOLLA_ATTENDANCE_DELEGATED_PIN_SITE_IDS: siteId });
function t(action?: "terminal_prepare"): Extract<p.DelegatedTerminalCommand, { action: "terminal_prepare" }>;
function t(action: "terminal_revoke"): Extract<p.DelegatedTerminalCommand, { action: "terminal_revoke" }>;
function t(action: p.DelegatedTerminalAction = "terminal_prepare"): p.DelegatedTerminalCommand {
  const b = { operationId: op, terminalId, locationId, reason: "明确受托操作" }; return action === "terminal_prepare" ? { ...b, action, label: "前台", pairHash: sha(secret) } : { ...b, action };
}
function m(action: p.DelegatedPinAction = "pin_issue"): p.DelegatedMemberPinCommand { return { kind: "member_pin", action, operationId: op, workerId, employeeId, employeeAuthUserId: auth, workerNo: "员工01", expectedRevision: 1, reason: "明确受托操作" }; }
function i(action: p.DelegatedPinAction = "pin_issue"): p.DelegatedIndependentPinCommand { return { kind: "independent_pin", action, operationId: op, workerId, subjectId,
  expectedSubjectRevision: 2, expectedGeneration: 1, expectedWorkerVersion: 3, expectedSettingsVersion: 4, expectedCredentialRevision: 1, reason: "明确受托操作" }; }
const ti = (command: p.DelegatedTerminalCommand | null = t()) => ({ query: q(), command, pairSecret: command?.action === "terminal_prepare" ? secret : null, authUserId: actor, allowWrite: true });
const pi = (command: p.DelegatedPinCommand | null = m()) => ({ query: q(), command, pin: command?.action === "pin_issue" ? "12345678" : null, authUserId: actor, allowWrite: true });
function context(c: p.DelegatedPinCommand | p.DelegatedTerminalCommand, successful = false) {
  const base = { siteId, actorId: actor, readAt: at, kind: "context", grantId, action: c.action };
  if (c.action === "terminal_prepare" || c.action === "terminal_revoke") return { ...base, protocol: p.DELEGATED_TERMINALS_PROTOCOL,
    scope: { kind: "terminal", terminalId, locationId, create: c.action === "terminal_prepare" }, context: { location: { locationId, name: "门店", timeZone: "UTC", version: 2, active: true },
      terminal: c.action === "terminal_prepare" ? null : { id: terminalId, label: "前台", locationId, locationName: "门店", timeZone: "UTC", state: "pending", createdAt: before,
        pairExpiresAt: "2026-10-09T12:03:00.000001Z", pairedAt: null, deviceExpiresAt: null, revokedAt: null } } };
  if (c.kind === "member_pin") return { ...base, protocol: p.DELEGATED_PIN_PROTOCOL, scope: { kind: c.kind, workerId, employeeId, employeeAuthUserId: auth, locationIds: [locationId] },
    context: { employeeAuthUserId: auth, status: { siteId, workerId, employeeId, workerNo: c.workerNo, workerName: "员工", ready: true, revision: successful ? 2 : 1,
      enabled: true, bindingCurrent: true, changedAt: before, receipt: null } } };
  return { ...base, protocol: p.DELEGATED_PIN_PROTOCOL, scope: { kind: c.kind, workerId, subjectId, generation: 1, locationIds: [locationId] }, context: { settingsVersion: 4, detail: {
    kind: "detail", subject: { workerId, subjectId, workerNo: "独立01", displayName: "独立人员", startsOn: "2026-10-09", locationId, enabled: true, generation: 1,
      revision: successful ? 3 : 2, workerVersion: successful ? 4 : 3, state: "independent", createdAt: before },
    credential: { credentialId: id(10), enabled: true, revision: successful ? 2 : 1, generation: 1, changedAt: before },
    head: { sequence: 0, status: "off", lastEventId: null, lastAction: null, lastAt: null }, binding: null } } };
}
async function receipt(c: p.DelegatedPinCommand | p.DelegatedTerminalCommand) {
  const common = { operationId: op, actorId: actor, grantId, action: c.action, businessFingerprint: "b".repeat(64), recordedAt: before };
  if (c.action === "terminal_prepare" || c.action === "terminal_revoke") return { protocol: p.DELEGATED_TERMINALS_PROTOCOL, siteId, actorId: actor, readAt: at, kind: "receipt", receipt: {
    ...common, commandFingerprint: await p.delegatedTerminalCommandFingerprint(q(), actor, c), reference: { kind: "terminal", terminalId, locationId, auditAction: c.action === "terminal_prepare" ? "create" : "revoke" } } };
  return { protocol: p.DELEGATED_PIN_PROTOCOL, siteId, actorId: actor, readAt: at, kind: "receipt", receipt: { ...common, commandFingerprint: await p.delegatedPinCommandFingerprint(q(), actor, c),
    reference: c.kind === "member_pin" ? { kind: c.kind, workerId, employeeId, employeeAuthUserId: auth, revision: 2 } : { kind: c.kind, workerId, subjectId,
      subjectRevision: 3, generation: c.action === "pin_revoke" ? 2 : 1, workerVersion: 4, credentialRevision: 2 } } };
}
async function setup(c: p.DelegatedPinCommand | p.DelegatedTerminalCommand, original = false) {
  const saved = await receipt(c), calls: { name: string; args: Record<string, unknown> }[] = [];
  const service = { rpc: async (name: string, args: Record<string, unknown>) => {
    calls.push({ name, args }); const query = args.p_query as p.DelegatedCredentialsQuery;
    return { data: query.mode === "recover" ? original ? saved : { ...saved, receipt: null } : args.p_command === null ? context(c, original) : saved, error: null };
  } };
  return { calls, service, saved };
}
const doubles = { environment, pepper: () => key, memberVerifier: async (pin: string) => sha("test-verifier:" + pin),
  independentMaterial: async (pin: string, _key: string, binding: Parameters<typeof independentAttendanceMaterialCommitment>[0], operationId: string) => {
    const salt = "a".repeat(32), verifier = sha("test-verifier:" + pin); return { salt, verifier, commitment: independentAttendanceMaterialCommitment(binding, operationId, salt, verifier) };
  } };

test("207 flags are independent default-off strict <=64site allowlists without whitespace/duplicates", () => {
  for (const check of [delegatedTerminalsSiteEnabled, delegatedPinSiteEnabled]) { assert.equal(check(siteId, {}), false); assert.equal(check(siteId, environment()), true); }
  for (const raw of [siteId + "," + siteId, " " + siteId, Array.from({ length: 65 }, (_, n) => String(99990000 + n)).join(",")]) {
    assert.equal(delegatedPinSiteEnabled(siteId, { ...environment(), FAOLLA_ATTENDANCE_DELEGATED_PIN_SITE_IDS: raw }), false);
    assert.equal(delegatedTerminalsSiteEnabled(siteId, { ...environment(), FAOLLA_ATTENDANCE_DELEGATED_TERMINALS_SITE_IDS: raw }), false);
  }
});

test("207 terminal prepare checks transient secret hash then recover/context/write exact5arguments; no secret in SQL or response", async () => {
  const st = await setup(t()), service = createDelegatedCredentialsService(st.service, doubles), result = await service.executeTerminal(ti());
  assert.equal(result.kind, "receipt"); assert.equal(st.calls.length, 3);
  for (const call of st.calls) { assert.equal(call.name, p.DELEGATED_TERMINALS_RPC); assert.deepEqual(Object.keys(call.args), ["p_query", "p_auth_user_id", "p_command", "p_allow_write", "p_material"]);
    assert.equal(call.args.p_auth_user_id, actor); assert.equal(call.args.p_material, null); }
  assert.equal(st.calls[0].args.p_allow_write, false); assert.equal(st.calls[1].args.p_allow_write, false); assert.equal(st.calls[2].args.p_allow_write, true);
  assert(!JSON.stringify(st.calls).includes(secret)); assert(!JSON.stringify(result).includes(secret));
  const bad = await setup(t()); await assert.rejects(createDelegatedCredentialsService(bad.service, doubles).executeTerminal({ ...ti(), pairSecret: "E".repeat(43) }), /attendance_operation_conflict/); assert.equal(bad.calls.length, 0);
});

test("207 secretfree terminal/PIN originals bypass flags in1RPC; fresh revoke still requires flag and current scope", async () => {
  for (const c of [t("terminal_revoke"), m("pin_revoke"), i("pin_revoke")]) {
    const st = await setup(c, true), service = createDelegatedCredentialsService(st.service, { ...doubles, environment: () => assert.fail(), pepper: () => assert.fail() });
    if (c.action === "terminal_revoke") await service.executeTerminal({ ...ti(c), allowWrite: false }); else await service.executePin({ ...pi(c), allowWrite: false });
    assert.equal(st.calls.length, 1); assert.equal(st.calls[0].args.p_material, null);
    const fresh = await setup(c), disabled = createDelegatedCredentialsService(fresh.service, { ...doubles, environment: () => ({}) });
    if (c.action === "terminal_revoke") await assert.rejects(disabled.executeTerminal(ti(c)), /attendance_delegated_terminals_disabled/);
    else await assert.rejects(disabled.executePin(pi(c)), /attendance_delegated_pin_disabled/); assert.equal(fresh.calls.length, 1);
  }
});

test("207 member issue gates before test KDF and sends deterministic private salt/verifier/commitment only after scope", async () => {
  const st = await setup(m()); let derives = 0;
  const result = await createDelegatedCredentialsService(st.service, { ...doubles, memberVerifier: async (pin, salt, binding, suppliedKey) => {
    derives++; assert.equal(st.calls.length, 2); assert.equal(suppliedKey, key); assert.deepEqual(binding, { siteId, workerId, employeeId });
    assert.equal(salt, createHmac("sha256", key).update(encode(["faolla-attendance-delegated-member-pin-salt-v1", siteId, actor, grantId, op, workerId, employeeId, auth, 2])).digest("hex").slice(0, 32));
    return sha("test-verifier:" + pin);
  } }).executePin(pi());
  assert.equal(derives, 1); assert.equal(st.calls.length, 3); const material = st.calls[2].args.p_material as { salt: string; verifier: string; commitment: string };
  assert.equal(material.commitment, sha(encode(["attendance-delegated-member-pin-material-v1", siteId, actor, grantId, op, workerId, employeeId, auth, 2, material.salt, material.verifier])));
  assert.deepEqual(Object.keys(material), ["salt", "verifier", "commitment"]); assert.equal(st.calls[0].args.p_material, null); assert.equal(st.calls[1].args.p_material, null);
  assert(!JSON.stringify(st.calls).includes('"pin"')); assert(!JSON.stringify(result).includes(material.verifier));
  for (const allowWrite of [true, false]) { const blocked = await setup(m()); await assert.rejects(createDelegatedCredentialsService(blocked.service, { ...doubles, environment: () => ({}), memberVerifier: async () => assert.fail() }).executePin({ ...pi(), allowWrite }), /attendance_delegated_pin_disabled/); assert.equal(blocked.calls.length, 1); }
});

test("207 independent issue reuses exact196 binding/material once, never wraps a second shared gate", async () => {
  const st = await setup(i()); let derives = 0;
  await createDelegatedCredentialsService(st.service, { ...doubles, independentMaterial: async (pin, suppliedKey, binding, operationId) => {
    derives++; assert.equal(st.calls.length, 2); assert.equal(suppliedKey, key); assert.deepEqual(binding, { siteId, workerId, subjectId, generation: 1, credentialRevision: 2 });
    return doubles.independentMaterial(pin, suppliedKey, binding, operationId);
  } }).executePin(pi(i())); assert.equal(derives, 1); assert.equal(st.calls.length, 3);
  const bad = await setup(i()); await assert.rejects(createDelegatedCredentialsService(bad.service, { ...doubles, independentMaterial: async () => ({ salt: "a".repeat(32), verifier: "b".repeat(64), commitment: "c".repeat(64) }) }).executePin(pi(i())), /attendance_delegated_pin_invalid/); assert.equal(bad.calls.length, 2);
});

test("207 original PIN issue never shortcircuits admission or different-secret SQL comparison; original GET stays minimal", async () => {
  for (const c of [m(), i()]) {
    const st = await setup(c, true); await createDelegatedCredentialsService(st.service, doubles).executePin(pi(c)); assert.equal(st.calls.length, 3);
    const blocked = await setup(c, true); await assert.rejects(createDelegatedCredentialsService(blocked.service, { ...doubles, memberVerifier: async () => assert.fail(), independentMaterial: async () => assert.fail() }).executePin({ ...pi(c), allowWrite: false }), /attendance_delegated_pin_disabled/); assert.equal(blocked.calls.length, 1);
    const conflict = await setup(c, true); const service = { rpc: async (name: string, args: Record<string, unknown>) => {
      if (args.p_command !== null) { conflict.calls.push({ name, args }); return { data: null, error: { message: "attendance_operation_conflict" } }; }
      return conflict.service.rpc(name, args);
    } };
    await assert.rejects(createDelegatedCredentialsService(service, doubles).executePin({ ...pi(c), pin: "87654321" }), /attendance_operation_conflict/); assert.equal(conflict.calls.length, 3);
    const get = await setup(c, true); await createDelegatedCredentialsService(get.service, { environment: () => assert.fail(), pepper: () => assert.fail() }).recoverPin({ query: r(), authUserId: actor, expectedCommand: c });
    assert.equal(get.calls.length, 1); assert.equal(get.calls[0].args.p_material, null); assert.equal(get.calls[0].args.p_allow_write, false);
  }
});

test("207 all intent snapshots precede await; wrong identity/current context refuses test KDF and unknown private failures sanitize", async () => {
  const st = await setup(m()); let release!: () => void; const wait = new Promise<void>(r => { release = r; });
  const originalRpc = st.service.rpc, service = { rpc: async (name: string, args: Record<string, unknown>) => { if ((args.p_query as p.DelegatedCredentialsQuery).mode === "recover") await wait; return originalRpc(name, args); } };
  const command = { ...m() }, raw = { ...pi(command) }; const pending = createDelegatedCredentialsService(service, doubles).executePin(raw);
  command.reason = "changed"; raw.authUserId = id(40); raw.pin = "87654321"; release(); await pending;
  assert.deepEqual(st.calls[2].args.p_command, m()); assert.equal(st.calls[2].args.p_auth_user_id, actor);
  const bad = await setup(m()), wrong = { rpc: async (name: string, args: Record<string, unknown>) => {
    if ((args.p_query as p.DelegatedCredentialsQuery).mode === "context") return { data: { ...context(m()), actorId: id(40) }, error: null };
    return bad.service.rpc(name, args);
  } }; await assert.rejects(createDelegatedCredentialsService(wrong, { ...doubles, memberVerifier: async () => assert.fail() }).executePin(pi()), /attendance_delegated_pin_invalid/); assert.equal(bad.calls.length, 1);
  await assert.rejects(createDelegatedCredentialsService({ rpc: async () => { throw Error("private SQL material"); } }, doubles).executePin(pi()), /attendance_delegated_pin_invalid/);
  const malicious = { ...pi(), command: { ...m(), verifier: "private" } };
  await assert.rejects(createDelegatedCredentialsService(st.service, doubles).executePin(malicious), /attendance_invalid_request/);
});

test("207 total deadline/abort includes pending test KDF, rejects late writes and reevaluates rollout after derive", async () => {
  const st = await setup(m()); let release!: () => void; const wait = new Promise<void>(r => { release = r; });
  const service = createDelegatedCredentialsService(st.service, { ...doubles, timeoutMs: 15, memberVerifier: async () => { await wait; return "b".repeat(64); } });
  await assert.rejects(service.executePin(pi()), /attendance_delegated_pin_invalid/); assert.equal(st.calls.length, 2); release(); await new Promise<void>(r => setImmediate(r)); assert.equal(st.calls.length, 2);
  const ab = await setup(i()), controller = new AbortController();
  await assert.rejects(createDelegatedCredentialsService(ab.service, { ...doubles, independentMaterial: async (...args) => { controller.abort(); return doubles.independentMaterial(...args); } }).executePin(pi(i()), controller.signal), /attendance_delegated_pin_invalid/); assert.equal(ab.calls.length, 2);
  const off = await setup(m()); let enabled = true;
  await assert.rejects(createDelegatedCredentialsService(off.service, { ...doubles, environment: () => enabled ? environment() : {}, memberVerifier: async () => { enabled = false; return "b".repeat(64); } }).executePin(pi()), /attendance_delegated_pin_disabled/); assert.equal(off.calls.length, 2);
  assert.throws(() => createDelegatedCredentialsService(st.service, { timeoutMs: 10001 }), MerchantAttendanceError);
});
