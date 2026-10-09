import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { executePeriodDelegation, periodDelegationEnabled, periodDelegationSafetyAccess } from "./merchantAttendancePeriodDelegation.server";
import { periodDelegationFingerprintText, type PeriodDelegationQuery, type PeriodDelegationCommand,
  type PeriodDelegationGrantCommand, type PeriodDelegationResult, type PeriodDelegationReceipt } from "./merchantAttendancePeriodDelegation";
import type { AttendanceSelfRpc } from "./merchantAttendanceSelf.server";

const id = (n: number) => `24000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const owner = id(1), delegate = id(3);
const query = (access: PeriodDelegationQuery["access"] = "owner", mode: PeriodDelegationQuery["mode"] = "list"): PeriodDelegationQuery => ({
  siteId: "99990232", access, mode, catalog: mode === "catalog" ? "delegates" : null,
  grantId: mode === "detail" ? id(10) : null, afterId: null, operationId: mode === "recover" ? id(10) : null,
});
const command = (): PeriodDelegationGrantCommand => ({ action: "grant", operationId: id(10), delegateEmployeeId: id(2), delegateAuthUserId: delegate,
  workerId: id(4), employeeId: id(5), employeeAuthUserId: id(6), fromDate: "2026-10-01", throughDate: "2026-10-31", actions: ["view", "send"], includeExisting: false,
  validFrom: "2026-10-08T09:00:00.000000Z", validUntil: "2026-10-09T09:00:00.000000Z", reason: "Synthetic  delegation" });
const result = (q: PeriodDelegationQuery): PeriodDelegationResult => ({ protocol: "period-delegation-v1", siteId: q.siteId, access: q.access,
  actorId: q.access === "owner" ? owner : delegate, employeeId: q.access === "owner" ? null : id(2), mode: q.mode, canWrite: false,
  grants: [], catalogItems: [], detail: null, receipt: null, nextAfterId: null, readAt: "2026-10-08T10:05:00.000000Z" });
const saved = (q: PeriodDelegationQuery, c: PeriodDelegationCommand): PeriodDelegationReceipt => ({ operationId: c.operationId, action: c.action,
  grantId: c.action === "grant" ? c.operationId : c.grantId, grantRevision: c.action === "grant" ? 1 : 2, periodId: null, periodRevision: null,
  actorId: owner, recordedAt: "2026-10-08T10:00:00.000000Z", commandFingerprint: createHash("sha256").update(periodDelegationFingerprintText(q, c), "utf8").digest("hex") });
function setup(data: unknown) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const service: AttendanceSelfRpc = { rpc: async (name, args) => { calls.push({ name, args }); return { data, error: null }; } };
  return { calls, service };
}
const input = (q = query(), c: PeriodDelegationCommand | null = null, allowWrite = false) => ({ query: q, command: c, authUserId: q.access === "owner" ? owner : delegate, allowWrite });

test("independent rollout accepts only explicit1 and at most64 unique exact sites", () => {
  const enabled = { FAOLLA_ATTENDANCE_PERIOD_DELEGATION_ENABLED: "1", FAOLLA_ATTENDANCE_PERIOD_DELEGATION_SITES: "99990231, 99990232" };
  assert.equal(periodDelegationEnabled("99990232", enabled), true);
  const sites = Array.from({ length: 64 }, (_, i) => String(99000000 + i));
  assert.equal(periodDelegationEnabled(sites[63], { ...enabled, FAOLLA_ATTENDANCE_PERIOD_DELEGATION_SITES: sites.join(",") }), true);
  for (const env of [{}, { ...enabled, FAOLLA_ATTENDANCE_PERIOD_DELEGATION_ENABLED: "true" },
    ...["", "*", "99990232,", "99990232,99990232", "999902320", "99990231", " ", [...sites, "99990232"].join(","), "x".repeat(4097)].map(value => ({ ...enabled, FAOLLA_ATTENDANCE_PERIOD_DELEGATION_SITES: value }))]) {
    assert.equal(periodDelegationEnabled("99990232", env), false);
  }
  assert.equal(periodDelegationEnabled("99990232\n", enabled), false);
});

test("management POST uses one exact RPC with real actor and immutable scalar tuple SHA", async () => {
  const q = query(), c = command(), r = { ...result(q), receipt: saved(q, c) }, f = setup(r);
  assert.deepEqual(await executePeriodDelegation(input(q, c, true), f.service), r);
  assert.deepEqual(f.calls, [{ name: "faolla_attendance_period_delegation_v1", args: { p_query: q, p_auth_user_id: owner, p_command: c, p_allow_write: true } }]);
  assert.equal(Object.keys(f.calls[0].args).length, 4);
  assert.equal(r.receipt.commandFingerprint, createHash("sha256").update(periodDelegationFingerprintText(q, c)).digest("hex"));
});

test("owner metadata, exact recovery and revoke remain SQL-authorized with rollout disabled", async () => {
  const cases = [query(), query("owner", "recover"), query("delegate", "recover")];
  for (const q of cases) { const f = setup(result(q)); assert.deepEqual(await executePeriodDelegation(input(q), f.service), result(q)); assert.equal(f.calls[0].args.p_allow_write, false); }
  const q = query("owner", "detail"), c: PeriodDelegationCommand = { action: "revoke", operationId: id(11), grantId: id(10), expectedRevision: 1, reason: "Revoke" };
  const f = setup({ ...result(q), receipt: saved(q, c) });
  assert.equal((await executePeriodDelegation(input(q, c), f.service)).receipt?.action, "revoke");
  assert.equal(periodDelegationSafetyAccess(q, null), true);
});

test("delegate ordinary reads, owner catalog and new grants cannot use safety bypass", async () => {
  for (const value of [input(query("delegate")), input(query("delegate", "detail")), input(query("owner", "catalog")), input(query(), command())]) {
    const f = setup(null); await assert.rejects(executePeriodDelegation(value, f.service), { code: "attendance_period_delegation_disabled" }); assert.equal(f.calls.length, 0);
  }
  const q = query("delegate"), f = setup(result(q)); assert.deepEqual(await executePeriodDelegation(input(q, null, true), f.service), result(q));
});

test("receipt fingerprint, operation, actor, scope and exact result shape must all match", async () => {
  const q = query(), c = command(), r = { ...result(q), receipt: saved(q, c) };
  for (const data of [{ ...r, actorId: delegate }, { ...r, siteId: "99990233" }, { ...r, source: {} }, { ...r, receipt: null },
    { ...r, receipt: { ...r.receipt, commandFingerprint: "0".repeat(64) } }, { ...r, receipt: { ...r.receipt, operationId: id(11) } },
    { ...r, receipt: { ...r.receipt, actorId: delegate } }, { ...r, receipt: saved(q, { ...c, reason: "Synthetic delegation" }) }]) {
    await assert.rejects(executePeriodDelegation(input(q, c, true), setup(data).service), { code: "attendance_period_delegation_invalid" });
  }
});

test("GET recovery only validates the original receipt identity and never invents a failed write", async () => {
  const q = query("owner", "recover"), receipt = saved(query(), command());
  assert.deepEqual((await executePeriodDelegation(input(q), setup({ ...result(q), receipt }).service)).receipt, receipt);
  assert.equal((await executePeriodDelegation(input(q), setup(result(q)).service)).receipt, null);
  await assert.rejects(executePeriodDelegation(input(q), setup({ ...result(q), receipt: { ...receipt, actorId: delegate } }).service), { code: "attendance_period_delegation_invalid" });
  const dq = { ...query("delegate", "recover"), operationId: id(20) }, dr: PeriodDelegationReceipt = {
    ...receipt, operationId: id(20), action: "send", actorId: delegate, periodId: id(21), periodRevision: 1,
  };
  assert.deepEqual((await executePeriodDelegation(input(dq), setup({ ...result(dq), receipt: dr }).service)).receipt, dr);
});

test("only known returned SQL codes are exposed; thrown transport text is never a definite refusal", async () => {
  const q = query();
  for (const message of ["attendance_operation_conflict", "attendance_access_denied", "attendance_period_delegation_changed"]) {
    await assert.rejects(executePeriodDelegation(input(q), { rpc: async () => ({ data: null, error: { message } }) }), { code: message });
  }
  for (const message of ["private SQL table secret", "toString", "constructor", ""]) {
    await assert.rejects(executePeriodDelegation(input(q), { rpc: async () => ({ data: null, error: { message } }) }), { code: "attendance_unavailable" });
  }
  await assert.rejects(executePeriodDelegation(input(q), { rpc: async () => { throw Error("attendance_operation_conflict"); } }), { code: "attendance_unavailable" });
});

test("invalid caller input and missing backend fail before any RPC", async () => {
  const f = setup(null);
  await assert.rejects(executePeriodDelegation(input(), null), { code: "attendance_unavailable" });
  await assert.rejects(executePeriodDelegation({ ...input(), allowWrite: "true" as unknown as boolean }, f.service), { code: "attendance_invalid_request" });
  await assert.rejects(executePeriodDelegation({ ...input(), authUserId: "not-an-auth-uuid" }, f.service));
  await assert.rejects(executePeriodDelegation(input(query("owner", "recover"), command(), true), f.service), { code: "attendance_invalid_request" });
  assert.equal(f.calls.length, 0);
});
