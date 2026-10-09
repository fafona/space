//Mocked RPC only: zero PostgreSQL/Auth/business-write proof.
import assert from "node:assert/strict";
import test from "node:test";
import type { AttendanceSelfRpc } from "./merchantAttendanceSelf.server";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import * as p from "./merchantAttendanceDelegatedPlanExceptions";
import { createDelegatedPlanExceptionsService, delegatedPlanExceptionsSiteEnabled } from "./merchantAttendanceDelegatedPlanExceptions.server";
import { delegatedPlanExceptionsModel as model } from "../../scripts/fixtures/attendance-delegated-plan-exceptions-model";
const service = (fn: (name: string, args: Record<string, unknown>) => Promise<unknown>): AttendanceSelfRpc => ({ rpc: async (name, args) => ({ data: await fn(name, args), error: null }) });
const code = (wanted: string) => (error: unknown) => error instanceof MerchantAttendanceError && error.code === wanted;
const env = (site: string) => ({ FAOLLA_ATTENDANCE_DELEGATED_PLAN_EXCEPTIONS_ENABLED: "1", FAOLLA_ATTENDANCE_DELEGATED_PLAN_EXCEPTIONS_SITE_IDS: site });
test("209 fresh write exactly original recovery/current scoped context/actual delegate write, all independent gates remain off", async () => {
  const f = model(), calls: Record<string, unknown>[] = [], s = createDelegatedPlanExceptionsService(service(async (name, args) => {
    assert.equal(name, p.DELEGATED_PLAN_EXCEPTIONS_RPC); calls.push(args); return calls.length === 1 ? { ...f.receipt, receipt: null } : calls.length === 2 ? f.context : f.receipt;
  }), { environment: () => env(f.query.siteId) });
  assert.deepEqual(await s.execute({ query: f.query, command: f.command, authUserId: f.actor, allowWrite: true }), f.receipt);
  assert.deepEqual(calls.map(v => [v.p_query, v.p_command, v.p_allow_write, v.p_auth_user_id]), [[f.recover, null, false, f.actor], [f.query, null, true, f.actor], [f.query, f.command, true, f.actor]]);
  for (const call of calls) { assert.equal(Object.keys(call).length, 7); assert.equal(call.p_allow_posthoc, false); assert.equal(call.p_allow_clearance, false); assert.equal(call.p_capture_notifications, false); }
});
test("209 posthoc/clearance/notifications use independent exact allowlists; read cannot capture a message", async () => {
  const f = model(), calls: Record<string, unknown>[] = [], gates = { ...env(f.query.siteId), FAOLLA_ATTENDANCE_PLAN_POSTHOC_REVIEW_ENABLED: "1", FAOLLA_ATTENDANCE_PLAN_POSTHOC_REVIEW_SITE_IDS: f.query.siteId,
    FAOLLA_ATTENDANCE_PLAN_CLEARANCE_ENABLED: "1", FAOLLA_ATTENDANCE_PLAN_CLEARANCE_SITE_IDS: f.query.siteId,
    FAOLLA_ATTENDANCE_EVENT_NOTIFICATIONS_CAPTURE_ENABLED: "1", FAOLLA_ATTENDANCE_EVENT_NOTIFICATIONS_CAPTURE_SITES: f.query.siteId };
  const s = createDelegatedPlanExceptionsService(service(async (_name, args) => { calls.push(args); return calls.length === 1 ? { ...f.receipt, receipt: null } : calls.length === 2 ? f.context : f.receipt; }), { environment: () => gates });
  await s.execute({ query: f.query, command: f.command, authUserId: f.actor, allowWrite: true });
  assert.equal(calls[0].p_allow_posthoc, false); assert.equal(calls[0].p_allow_clearance, false); assert.equal(calls[0].p_capture_notifications, false);
  assert.equal(calls[1].p_allow_posthoc, true); assert.equal(calls[1].p_allow_clearance, true); assert.equal(calls[1].p_capture_notifications, false);
  assert.equal(calls[2].p_allow_posthoc, true); assert.equal(calls[2].p_allow_clearance, true); assert.equal(calls[2].p_capture_notifications, true);
});
test("209 original minimum GET and exact replay ignore current rollout; target changes cannot reuse old receipt", async () => {
  const f = model(); let calls = 0; const s = createDelegatedPlanExceptionsService(service(async () => { calls++; return f.receipt; }), { environment: () => assert.fail("recover never reads rollout") });
  assert.deepEqual(await s.readReceipt({ query: f.recover, authUserId: f.actor }), f.receipt);
  assert.deepEqual(await s.recover({ query: f.recover, authUserId: f.actor, expectedCommand: f.command }), f.receipt);
  assert.deepEqual(await s.execute({ query: f.query, command: f.command, authUserId: f.actor, allowWrite: false }), f.receipt); assert.equal(calls, 3);
  await assert.rejects(s.execute({ query: { ...f.query, slotId: "00000000-0000-4000-8000-000000999999" }, command: f.command, authUserId: f.actor, allowWrite: false }), code("attendance_operation_conflict"));
  await assert.rejects(s.recover({ query: f.recover, authUserId: f.actor, expectedCommand: { ...f.command, note: "Changed intent" } }), code("attendance_delegated_plan_exceptions_invalid"));
});
test("209 gate default off and bounded exact sites; stale CAS/source/outcome stops before writer", async () => {
  const f = model(), environment = env(f.query.siteId); assert.equal(delegatedPlanExceptionsSiteEnabled(f.query.siteId, {}), false); assert(delegatedPlanExceptionsSiteEnabled(f.query.siteId, environment));
  for (const ids of ["*", " " + f.query.siteId, f.query.siteId + ",", f.query.siteId + "," + f.query.siteId, Array.from({ length: 65 }, (_, n) => String(99990000 + n)).join(",")]) assert(!delegatedPlanExceptionsSiteEnabled(f.query.siteId, { ...environment, FAOLLA_ATTENDANCE_DELEGATED_PLAN_EXCEPTIONS_SITE_IDS: ids }));
  for (const patch of [{ expectedRevision: 1 }, { expectedFingerprint: "c".repeat(64) }, { outcome: "excused" as const, employeeId: f.actor }]) { let calls = 0;
    const s = createDelegatedPlanExceptionsService(service(async () => ++calls === 1 ? { ...f.receipt, receipt: null } : f.context), { environment: () => environment });
    await assert.rejects(s.execute({ query: f.query, command: { ...f.command, ...patch }, authUserId: f.actor, allowWrite: true })); assert.equal(calls, 2);
  }
  const invalidCommand = createDelegatedPlanExceptionsService(service(async () => assert.fail("invalid cleared revision cannot reach RPC")), { environment: () => environment });
  await assert.rejects(invalidCommand.execute({ query: f.query, command: { ...f.command, outcome: "cleared" }, authUserId: f.actor, allowWrite: true }));
  let calls = 0; const off = createDelegatedPlanExceptionsService(service(async () => { calls++; return { ...f.receipt, receipt: null }; }), { environment: () => ({}) });
  await assert.rejects(off.execute({ query: f.query, command: null, authUserId: f.actor, allowWrite: true }), code("attendance_delegated_plan_exceptions_disabled")); assert.equal(calls, 0);
  await assert.rejects(off.execute({ query: f.query, command: f.command, authUserId: f.actor, allowWrite: false }), code("attendance_delegated_plan_exceptions_disabled")); assert.equal(calls, 1);
});
test("209 snapshot before await, late/abort bounded responses and database errors never disclose or succeed", async () => {
  const f = model(), raw = { query: { ...f.query }, command: { ...f.command }, authUserId: f.actor, allowWrite: true }; let release!: () => void, count = 0;
  const wait = new Promise<void>(done => { release = done; }); const s = createDelegatedPlanExceptionsService(service(async (_name, args) => {
    if (++count === 1) { await wait; return { ...f.receipt, receipt: null }; } if (count === 2) return f.context; assert.deepEqual(args.p_command, f.command); assert.equal(args.p_auth_user_id, f.actor); return f.receipt;
  }), { environment: () => env(f.query.siteId) });
  const pending = s.execute(raw); raw.authUserId = "00000000-0000-4000-8000-000000999999"; raw.allowWrite = false; raw.command.note = "Changed"; raw.query.slotId = raw.authUserId; release(); assert.deepEqual(await pending, f.receipt);
  const slow = createDelegatedPlanExceptionsService(service(async () => { await new Promise(done => setTimeout(done, 12)); return f.receipt; }), { timeoutMs: 2 });
  await assert.rejects(slow.readReceipt({ query: f.recover, authUserId: f.actor }), code("attendance_delegated_plan_exceptions_invalid"));
  const abort = new AbortController(); abort.abort(); await assert.rejects(s.readReceipt({ query: f.recover, authUserId: f.actor }, abort.signal), code("attendance_delegated_plan_exceptions_invalid"));
  for (const message of ["attendance_period_sealed", "private database context:secret"]) {
    const error = createDelegatedPlanExceptionsService({ rpc: async () => ({ data: null, error: { message } }) });
    await assert.rejects(error.readReceipt({ query: f.recover, authUserId: f.actor }), code(message === "attendance_period_sealed" ? message : "attendance_delegated_plan_exceptions_invalid"));
  }
});
