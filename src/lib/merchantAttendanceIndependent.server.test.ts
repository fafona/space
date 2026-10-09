import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import type { AttendanceSelfRpc } from "./merchantAttendanceSelf.server";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { independentAttendanceIssueSalt, independentAttendanceMaterialCommitment, type IndependentPinKdfBinding } from "./merchantAttendanceIndependentPinKdf.server";
import { INDEPENDENT_ADMIN_PROTOCOL, INDEPENDENT_TERMINAL_PROTOCOL, independentAdminCommandText,
  type IndependentQuery, type IndependentCommand, type IndependentAdminReceipt, type IndependentAdminData,
  type IndependentAdminResult, type IndependentTerminalBody, type IndependentTerminalSubject } from "./merchantAttendanceIndependent";
import { createIndependentAttendanceService, independentAttendanceEnabled, INDEPENDENT_RPC_TIMEOUT_MS,
  type IndependentAdminServiceInput, type IndependentTerminalContext } from "./merchantAttendanceIndependent.server";

// Protocol/service mocks only. No real Auth, scrypt, SQL or physical device is
// claimed by these finite tests; the production KDF implementation is unmodified.
const id = (n: number) => `00000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
const siteId = "99990196", actorId = id(1), subjectId = id(2), workerId = id(3), terminalId = id(4), locationId = id(5), credentialId = id(6);
const at = "2026-10-08T12:00:00.123456Z", secret = "A".repeat(43), pin = "12345678", key = "synthetic-private-pepper";
const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const on = () => ({ FAOLLA_ATTENDANCE_INDEPENDENT_WORKERS_ENABLED: "1", FAOLLA_ATTENDANCE_INDEPENDENT_WORKERS_SITE_IDS: siteId });
const query = (): IndependentQuery => ({ siteId, mode: "detail", subjectId });
const issue = (): Extract<IndependentCommand, { action: "issue_pin" }> => ({ action: "issue_pin", operationId: id(10), subjectId, expectedSubjectRevision: 2, expectedGeneration: 0, expectedWorkerVersion: 2, expectedSettingsVersion: 2, expectedCredentialRevision: 0, reason: "明确签发" });
const input = (command: IndependentCommand | null = issue()): IndependentAdminServiceInput => ({ query: query(), command, pin: command?.action === "issue_pin" ? pin : null, authUserId: actorId, allowNew: true });
const listQuery = (): IndependentQuery => ({ siteId, mode: "list", cursor: null, state: "all", search: "" });
function envelope(data: IndependentAdminData, receipt: IndependentAdminReceipt | null = null): IndependentAdminResult { return { protocol: INDEPENDENT_ADMIN_PROTOCOL, siteId, actorId, readAt: at, settingsVersion: 2, data, receipt }; }
function detail(): IndependentAdminResult { return envelope({ kind: "detail", subject: { subjectId, workerId, workerNo: "W01", displayName: "合成人员", startsOn: "2026-10-08", locationId, enabled: true, generation: 0, revision: 2, workerVersion: 2, state: "independent", createdAt: at }, credential: { credentialId: null, revision: 0, enabled: false, generation: null, changedAt: null }, head: { sequence: 0, status: "off", lastEventId: null, lastAction: null, lastAt: null }, binding: null }); }
function receipt(c = issue()): IndependentAdminReceipt { return { operationId: c.operationId, subjectId, workerId, action: c.action, actorId, subjectRevision: c.expectedSubjectRevision + 1, generation: c.expectedGeneration, workerVersion: c.expectedWorkerVersion + 1, credentialRevision: c.expectedCredentialRevision + 1, recordedAt: at, commandFingerprint: sha(independentAdminCommandText(siteId, actorId, c)) }; }
async function fakeIssue(pin: string, binding: IndependentPinKdfBinding, operationId: string) {
  const salt = independentAttendanceIssueSalt(binding, operationId, key), verifier = sha(JSON.stringify([pin, salt, binding.siteId, binding.workerId, binding.subjectId, binding.generation, binding.credentialRevision]));
  return Object.freeze({ salt, verifier, commitment: independentAttendanceMaterialCommitment(binding, operationId, salt, verifier) });
}
type Call = { name: string; args: Record<string, unknown> };
function rpc(fn: (name: string, args: Record<string, unknown>) => unknown | Promise<unknown>, calls: Call[] = []): AttendanceSelfRpc {
  return { rpc: async (name, args) => { calls.push({ name, args: clone(args) }); const value = await fn(name, args);
    return value && typeof value === "object" && Object.hasOwn(value, "error") ? value as { data: unknown; error: { message?: string } | null } : { data: value, error: null }; } };
}
const code = (wanted: string) => (error: unknown) => error instanceof MerchantAttendanceError && error.code === wanted;
const terminalBody = (): IndependentTerminalBody => ({ siteId, terminalId, workerNo: "W01", pin, request: { kind: "state" } });
const context = (): IndependentTerminalContext => ({ siteId, terminalId, secret, allowNew: true });
const binding = (): IndependentPinKdfBinding => ({ siteId, workerId, subjectId, generation: 0, credentialRevision: 1 });
function begin(args: Record<string, unknown>) { return { allowed: true, leaseId: args.p_lease, binding: binding(), salt: "a".repeat(32), verifier: "b".repeat(64) }; }
function state() { const subject: IndependentTerminalSubject = { subjectId, workerId, workerNo: "W01", displayName: "合成人员", generation: 0, workerVersion: 2, credentialId, credentialRevision: 1, settingsVersion: 2, locationId, locationVersion: 3, timeZone: "Europe/Madrid" };
  return { protocol: INDEPENDENT_TERMINAL_PROTOCOL, siteId, terminalId, readAt: at, data: { kind: "state", subject, head: { sequence: 0, status: "off", lastEventId: null, lastAction: null, lastAt: null } } }; }

test("196 service pilot gate is default-off, exact eight digits, no wildcard/trim/duplicate and64 maximum", () => {
  assert.equal(independentAttendanceEnabled(siteId, {}), false); assert.equal(independentAttendanceEnabled(siteId, on()), true);
  for (const raw of ["*", siteId + ",", " " + siteId, siteId + "\n", `${siteId},${siteId}`, `${siteId}, 99990197`, "999901960", "", Array.from({ length: 65 }, (_, i) => String(99990000 + i)).join(",")]) assert.equal(independentAttendanceEnabled(siteId, { ...on(), FAOLLA_ATTENDANCE_INDEPENDENT_WORKERS_SITE_IDS: raw }), false);
  const sixtyFour = Array.from({ length: 64 }, (_, i) => String(99990133 + i)).join(",");
  assert.equal(sixtyFour.length, 575); assert.equal(independentAttendanceEnabled(siteId, { ...on(), FAOLLA_ATTENDANCE_INDEPENDENT_WORKERS_SITE_IDS: sixtyFour }), true);
  assert.equal(independentAttendanceEnabled(siteId, { ...on(), FAOLLA_ATTENDANCE_INDEPENDENT_WORKERS_ENABLED: "true" }), false);
});

test("196 owner candidates use one read-only admin RPC with flag off and no KDF/material", async () => {
  for (const mode of ["members", "locations"] as const) { const calls: Call[] = [];
    const s = createIndependentAttendanceService(rpc(() => envelope(mode === "members" ? { kind: mode, items: [{ employeeId: id(80), authUserId: id(81), displayName: "真实员工选择" }], nextCursor: null }
      : { kind: mode, items: [{ locationId, name: "真实地点选择", timeZone: "UTC" }], nextCursor: null }), calls), { environment: () => ({}), issuePin: async () => { assert.fail("read must not KDF"); } });
    const result = await s.executeAdmin({ query: { siteId, mode, cursor: null, search: "" }, command: null, pin: null, authUserId: actorId, allowNew: false });
    assert.equal(result.data.kind, mode); assert.equal(calls.length, 1); assert.equal(calls[0].name, "faolla_attendance_independent_admin_v1");
    assert.equal(calls[0].args.p_allow_new, false); assert.equal(calls[0].args.p_command, null); assert.equal(calls[0].args.p_material, null); }
});

test("196 owner authenticates recover+fresh detail/CAS before shared KDF, no PIN in RPC command/output", async () => {
  const calls: Call[] = [], order: string[] = [];
  const service = createIndependentAttendanceService(rpc((_name, args) => { const q = args.p_query as IndependentQuery; order.push(q.mode);
    if (q.mode === "recover") return envelope({ kind: "receipt" }); if (args.p_command === null) return detail();
    assert.deepEqual(Object.keys(args).sort(), ["p_site", "p_auth", "p_query", "p_command", "p_material", "p_allow_new"].sort());
    assert.equal(args.p_auth, actorId); assert.equal(args.p_allow_new, true); return envelope({ kind: "receipt" }, receipt());
  }, calls), { environment: on, issuePin: async (...args) => { order.push("kdf"); return fakeIssue(...args); } });
  const result = await service.executeAdmin(input()); assert.deepEqual(order, ["recover", "detail", "kdf", "detail"]);
  assert.equal(result.receipt!.operationId, id(10)); assert.equal(calls.length, 3);
  assert.equal(JSON.stringify(calls).includes(pin), false); assert.equal(JSON.stringify(result).includes("salt"), false); assert.equal(JSON.stringify(result).includes("verifier"), false);
  assert.equal(calls[0].args.p_material, null); assert.equal(calls[1].args.p_material, null);
  assert.deepEqual(Object.keys(calls[2].args.p_material as object).sort(), ["salt", "verifier", "commitment"].sort());
});

test("196 issue replay uses original binding after current generation advances, changed PIN conflicts", async () => {
  const calls: Call[] = [], original = receipt(), saved = await fakeIssue(pin, binding(), id(10)), derived: IndependentPinKdfBinding[] = [];
  const current = detail(); if (current.data.kind === "detail") Object.assign(current.data.subject, { generation: 3, revision: 5, workerVersion: 5, enabled: false });
  const s = createIndependentAttendanceService(rpc((_name, args) => {
    if ((args.p_query as IndependentQuery).mode === "recover") return envelope({ kind: "receipt" }, original);
    if (args.p_command === null) return current;
    if ((args.p_material as { commitment: string }).commitment !== saved.commitment) return { data: null, error: { message: "attendance_operation_conflict" } };
    return envelope({ kind: "receipt" }, original);
  }, calls), { environment: () => ({}), issuePin: async (p, b, op) => { derived.push(b); return fakeIssue(p, b, op); } });
  await s.executeAdmin(input()); assert.deepEqual(derived[0], binding());
  await assert.rejects(s.executeAdmin({ ...input(), pin: "87654321" }), code("attendance_operation_conflict"));
  assert.equal(calls.filter(c => c.args.p_command !== null).length, 2); assert.equal(calls.at(-1)!.args.p_allow_new, false);
});

test("196 lost owner, mismatched original command, stale CAS and off gate spend no KDF or issue POST", async () => {
  let kdfs = 0;
  const cases: Array<{ wanted: string; fn: (args: Record<string, unknown>) => unknown; env?: () => Record<string, string> }> = [
    { wanted: "attendance_access_denied", fn: () => ({ data: null, error: { message: "attendance_access_denied" } }) },
    { wanted: "attendance_access_denied", fn: args => (args.p_query as IndependentQuery).mode === "recover" ? envelope({ kind: "receipt" }, receipt()) : { data: null, error: { message: "attendance_access_denied" } } },
    { wanted: "attendance_operation_conflict", fn: () => envelope({ kind: "receipt" }, { ...receipt(), commandFingerprint: "a".repeat(64) }) },
    { wanted: "attendance_independent_changed", fn: args => { if ((args.p_query as IndependentQuery).mode === "recover") return envelope({ kind: "receipt" }); const d = detail(); if (d.data.kind === "detail") Object.assign(d.data.subject, { revision: 3 }); return d; } },
    { wanted: "attendance_platform_paused", env: () => ({}), fn: args => (args.p_query as IndependentQuery).mode === "recover" ? envelope({ kind: "receipt" }) : detail() },
  ];
  for (const c of cases) { const calls: Call[] = [], s = createIndependentAttendanceService(rpc((_name, args) => c.fn(args), calls), { environment: c.env ?? on, issuePin: async (...args) => { kdfs++; return fakeIssue(...args); } });
    await assert.rejects(s.executeAdmin(input()), code(c.wanted)); assert.equal(calls.some(call => call.args.p_command !== null), false); }
  assert.equal(kdfs, 0);
});

test("196 owner gate is re-read after KDF and malformed/private result never escapes", async () => {
  const env = on(), calls: Call[] = [];
  const s = createIndependentAttendanceService(rpc((_name, args) => {
    if ((args.p_query as IndependentQuery).mode === "recover") return envelope({ kind: "receipt" }); if (args.p_command === null) return detail();
    assert.equal(args.p_allow_new, false); return { data: null, error: { message: "attendance_platform_paused" } };
  }, calls), { environment: () => env, issuePin: async (...args) => { env.FAOLLA_ATTENDANCE_INDEPENDENT_WORKERS_ENABLED = "0"; return fakeIssue(...args); } });
  await assert.rejects(s.executeAdmin(input()), code("attendance_platform_paused")); assert.equal(calls.length, 3);
  const bad = createIndependentAttendanceService(rpc(() => ({ ...envelope({ kind: "list", items: [], nextCursor: null }), verifier: "private" })), { environment: on });
  await assert.rejects(bad.executeAdmin({ ...input(null), query: listQuery() }), code("attendance_independent_invalid"));
});

test("196 owner disable/revoke and minimum recovery remain reachable while gate is off", async () => {
  const calls: Call[] = [], q: IndependentQuery = { siteId, mode: "recover", subjectId, operationId: id(10) };
  const s = createIndependentAttendanceService(rpc(() => envelope({ kind: "receipt" }, receipt()), calls), { environment: () => ({}) });
  await s.executeAdmin({ ...input(null), query: q }); assert.equal(calls[0].args.p_allow_new, false); assert.equal(calls[0].args.p_command, null);
  const disable: IndependentCommand = { action: "disable", operationId: id(11), subjectId, expectedSubjectRevision: 2, expectedGeneration: 0, expectedWorkerVersion: 2, expectedSettingsVersion: 2, reason: "立即停用" };
  const revoke: IndependentCommand = { ...disable, action: "revoke_pin", expectedCredentialRevision: 1 };
  for (const command of [disable, revoke]) { const rec: IndependentAdminReceipt = { ...receipt(), operationId: command.operationId, action: command.action, generation: 1, credentialRevision: 2, commandFingerprint: sha(independentAdminCommandText(siteId, actorId, command)) };
    const s = createIndependentAttendanceService(rpc((_name, args) => { assert.equal(args.p_allow_new, false); return envelope({ kind: "receipt" }, rec); }), { environment: () => ({}) }); await s.executeAdmin({ ...input(command), pin: null }); }
});

test("196 trusted terminal uses one begin/check/finish with exact hashed cookie and no secret payload forwarding", async () => {
  const calls: Call[] = [], order: string[] = [];
  const s = createIndependentAttendanceService(rpc((name, args) => { order.push(name.endsWith("begin_v1") ? "begin" : "finish"); return name.endsWith("begin_v1") ? begin(args) : state(); }, calls), {
    environment: on, checkPin: async (p, salt, b, verifier) => { order.push("kdf"); assert.equal(p, pin); assert.equal(salt, "a".repeat(32)); assert.equal(verifier, "b".repeat(64)); assert.deepEqual(b, binding()); return true; },
  });
  const result = await s.executeTerminal(terminalBody(), context()); assert.deepEqual(order, ["begin", "kdf", "finish"]);
  assert.equal(calls[0].args.p_secret_hash, sha(secret)); assert.equal(calls[0].args.p_lease, calls[1].args.p_lease); assert.equal(calls[1].args.p_verified, true);
  assert.deepEqual(Object.keys(calls[0].args).sort(), ["p_site", "p_terminal", "p_secret_hash", "p_no", "p_lease", "p_allow_new"].sort());
  assert.deepEqual(Object.keys(calls[1].args).sort(), ["p_site", "p_terminal", "p_secret_hash", "p_no", "p_lease", "p_verified", "p_request", "p_allow_new"].sort());
  for (const text of [JSON.stringify(result), JSON.stringify(calls)]) { assert.equal(text.includes(pin), false); assert.equal(text.includes(secret), false); }
  for (const key of ["salt", "verifier", "leaseId", "secret"]) assert.equal(JSON.stringify(result).includes(`"${key}"`), false);
});

test("196 nonexistent/limited terminal subject still takes same shared-budget begin and dummy KDF only", async () => {
  const calls: Call[] = []; let checks = 0;
  const s = createIndependentAttendanceService(rpc(() => ({ allowed: false, leaseId: null, binding: null, salt: null, verifier: null }), calls), {
    environment: on, checkPin: async (p, salt, b, verifier) => { checks++; assert.equal(p, pin); assert.equal(salt.length, 32); assert.equal(b.siteId, siteId); assert.equal(verifier, "0".repeat(64)); return true; },
  });
  await assert.rejects(s.executeTerminal(terminalBody(), context()), code("attendance_pin_invalid"));
  assert.equal(checks, 1); assert.equal(calls.length, 1); assert.equal(calls[0].name, "faolla_attendance_independent_begin_v1");
});

test("196 wrong PIN/wrong request scope consume finish lease; client claims cannot become authorization", async () => {
  for (const wrongScope of [false, true]) { const calls: Call[] = [], b = terminalBody();
    if (wrongScope) Object.assign(b, { request: { kind: "recover", subjectId: id(99), workerId, operationId: id(10), commandFingerprint: "a".repeat(64) } });
    const s = createIndependentAttendanceService(rpc((name, args) => name.endsWith("begin_v1") ? begin(args) : state(), calls), { environment: on, checkPin: async () => wrongScope });
    await assert.rejects(s.executeTerminal(b, context()), code("attendance_pin_invalid")); assert.equal(calls.length, 2); assert.equal(calls[1].args.p_verified, false);
  }
  const calls: Call[] = [], s = createIndependentAttendanceService(rpc((name, args) => name.endsWith("begin_v1") ? begin(args) : { error: "attendance_pin_invalid" }, calls), { environment: on, checkPin: async () => true });
  await assert.rejects(s.executeTerminal(terminalBody(), context()), code("attendance_independent_invalid")); // malformed transport/error mock is not reflected
  const correct = createIndependentAttendanceService({ rpc: async (name, args) => ({ data: name.endsWith("begin_v1") ? begin(args) : { error: "attendance_pin_invalid" }, error: null }) }, { environment: on, checkPin: async () => true });
  await assert.rejects(correct.executeTerminal(terminalBody(), context()), code("attendance_pin_invalid"));
});

test("196 terminal gate refreshes after KDF; state reads survive off without safeFinish revocation bypass", async () => {
  const env = on(), calls: Call[] = [];
  const s = createIndependentAttendanceService(rpc((name, args) => name.endsWith("begin_v1") ? begin(args) : state(), calls), { environment: () => env, checkPin: async () => { env.FAOLLA_ATTENDANCE_INDEPENDENT_WORKERS_ENABLED = "0"; return true; } });
  await s.executeTerminal(terminalBody(), context()); assert.equal(calls[0].args.p_allow_new, true); assert.equal(calls[1].args.p_allow_new, false);
  const revoked = createIndependentAttendanceService({ rpc: async (name, args) => ({ data: name.endsWith("begin_v1") ? begin(args) : { error: "attendance_pin_invalid" }, error: null }) }, { environment: () => ({}), checkPin: async () => true });
  await assert.rejects(revoked.executeTerminal(terminalBody(), context()), code("attendance_pin_invalid"));
});

test("196 private begin/finish validation rejects extra fields, false lease, cross-site and mutable source", async () => {
  for (const change of [(v: ReturnType<typeof begin>) => ({ ...v, pin }), (v: ReturnType<typeof begin>) => ({ ...v, leaseId: id(99) }), (v: ReturnType<typeof begin>) => ({ ...v, binding: { ...v.binding, siteId: "99990197" } }), (v: ReturnType<typeof begin>) => ({ ...v, salt: v.salt + "\n" })]) {
    let checks = 0; const s = createIndependentAttendanceService(rpc((_name, args) => change(begin(args))), { environment: on, checkPin: async () => { checks++; return true; } });
    await assert.rejects(s.executeTerminal(terminalBody(), context()), code("attendance_independent_invalid")); assert.equal(checks, 0);
  }
  let delivered!: (value: unknown) => void; const held = new Promise(resolve => { delivered = resolve; }), calls: Call[] = [], b = terminalBody(), c = context();
  const s = createIndependentAttendanceService(rpc((name) => name.endsWith("begin_v1") ? held : state(), calls), { environment: on, checkPin: async (_p, _salt, binding) => { assert.equal(Object.isFrozen(binding), true); return true; } });
  const pending = s.executeTerminal(b, c); Object.assign(b, { workerNo: "other", pin: "87654321", request: { kind: "personal" } }); Object.assign(c, { terminalId: id(99), secret: "B".repeat(42) + "A" });
  delivered(begin(calls[0].args)); await pending; assert.equal(calls[1].args.p_no, "W01"); assert.equal(calls[1].args.p_secret_hash, sha(secret)); assert.deepEqual(calls[1].args.p_request, { kind: "state" });
});

test("196 transport failures are unknown without retries; errors and getter payloads disclose no secrets", async () => {
  let count = 0; const broken = createIndependentAttendanceService({ rpc: async () => { count++; throw Error(pin + secret); } });
  await assert.rejects(broken.executeAdmin({ ...input(null), query: listQuery() }), code("attendance_independent_invalid")); assert.equal(count, 1);
  let reads = 0; const malicious = createIndependentAttendanceService({ rpc: async () => ({ get data() { reads++; return null; }, error: null }) });
  await assert.rejects(malicious.executeAdmin({ ...input(null), query: listQuery() }), code("attendance_independent_invalid")); assert.equal(reads, 0);
  const badInput = { ...input(null), get authUserId() { reads++; return actorId; } };
  await assert.rejects(broken.executeAdmin(badInput), code("attendance_invalid_request")); assert.equal(reads, 0); assert.equal(count, 1);
  await assert.rejects(broken.executeTerminal(terminalBody(), { ...context(), siteId: "99990197" }), code("attendance_invalid_request")); assert.equal(count, 1);
  const timer = globalThis.setTimeout;
  globalThis.setTimeout = ((run: (...args: unknown[]) => void) => timer(run, 1)) as typeof setTimeout;
  try { assert.equal(INDEPENDENT_RPC_TIMEOUT_MS, 10000); const timed = createIndependentAttendanceService({ rpc: () => new Promise(() => { count++; }) });
    await assert.rejects(timed.executeAdmin({ ...input(null), query: listQuery() }), code("attendance_independent_invalid")); assert.equal(count, 2);
  } finally { globalThis.setTimeout = timer; }
});

test("196 abort/route deadline fences late pre-read and KDF completion before any later business dispatch", async () => {
  for (const duringKdf of [false, true]) {
    const controller = new AbortController(), calls: Call[] = []; let release!: () => void, kdfs = 0;
    const held = new Promise<void>(resolve => { release = resolve; });
    const s = createIndependentAttendanceService(rpc(async (_name, args) => {
      if ((args.p_query as IndependentQuery).mode === "recover") { if (!duringKdf) await held; return envelope({ kind: "receipt" }); }
      return detail();
    }, calls), { environment: on, signal: controller.signal, issuePin: async (...args) => { kdfs++; await held; return fakeIssue(...args); } });
    const pending = s.executeAdmin(input());
    if (duringKdf) { while (kdfs === 0) await new Promise<void>(resolve => setImmediate(resolve)); }
    controller.abort(); release(); await assert.rejects(pending, code("attendance_independent_invalid"));
    await new Promise<void>(resolve => setImmediate(resolve)); assert.equal(calls.some(c => c.args.p_command !== null), false);
    assert.equal(kdfs, duringKdf ? 1 : 0);
  }
});
