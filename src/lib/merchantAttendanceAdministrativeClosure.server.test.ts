import test from "node:test";
import assert from "node:assert/strict";
import { executeAdministrativeClosure, administrativeClosureEnabled } from "./merchantAttendanceAdministrativeClosure.server";
import { closureQuery, closureCommand, closureOwner, closureSelf, closureSite, closureId, closureCandidate, closureResult, closureReceiptResult } from "./merchantAttendanceAdministrativeClosureTestFixtures";
import type { AttendanceSelfRpc } from "./merchantAttendanceSelf.server";

test("195 exact enable flag and site allowlist have no defaults or normalization", () => {
  const env = { FAOLLA_ATTENDANCE_ADMINISTRATIVE_CLOSURES_ENABLED: "1", FAOLLA_ATTENDANCE_ADMINISTRATIVE_CLOSURES_SITE_IDS: closureSite };
  assert.equal(administrativeClosureEnabled(closureSite, env), true); assert.equal(administrativeClosureEnabled(closureSite, {}), false);
  for (const raw of ["", closureSite + ",", " " + closureSite, closureSite + "\n", `${closureSite},${closureSite}`, Array(101).fill(closureSite).join(",")]) assert.equal(administrativeClosureEnabled(closureSite, { ...env, FAOLLA_ATTENDANCE_ADMINISTRATIVE_CLOSURES_SITE_IDS: raw }), false);
  assert.equal(administrativeClosureEnabled(closureSite + "\n", env), false);
});
test("195 service binds exact command and actual actor in one four-argument RPC", async () => {
  const calls: unknown[] = [], receipt = await closureReceiptResult(), service: AttendanceSelfRpc = { rpc: async (name, args) => { calls.push({ name, args }); return { data: receipt, error: null }; } };
  await executeAdministrativeClosure({ query: closureQuery(), command: closureCommand(), authUserId: closureOwner, allowClose: true }, service);
  assert.deepEqual(calls, [{ name: "faolla_attendance_administrative_closures_v1", args: { p_query: closureQuery(), p_command: closureCommand(), p_auth_user_id: closureOwner, p_allow_close: true } }]);
  await assert.rejects(executeAdministrativeClosure({ query: closureQuery(), command: closureCommand(), authUserId: closureSelf, allowClose: true }, service));
  const before = calls.length; await assert.rejects(executeAdministrativeClosure({ query: { ...closureQuery(), workerId: closureId(99) }, command: closureCommand(), authUserId: closureOwner, allowClose: true }, service)); assert.equal(calls.length, before);
});
test("195 service preserves known SQL errors but never leaks arbitrary RPC errors", async () => {
  const input = { query: closureQuery(), command: null, authUserId: closureOwner, allowClose: false };
  for (const message of ["attendance_access_denied", "attendance_administrative_closure_changed", "attendance_period_sealed"]) await assert.rejects(executeAdministrativeClosure(input, { rpc: async () => ({ data: null, error: { message } }) }), { code: message });
  await assert.rejects(executeAdministrativeClosure(input, { rpc: async () => ({ data: null, error: { message: "private_schema_detail" } }) }), { code: "attendance_administrative_closure_invalid" });
  await assert.rejects(executeAdministrativeClosure(input, { rpc: async () => { throw Error("network"); } }), { code: "attendance_administrative_closure_invalid" });
  const safe = await executeAdministrativeClosure(input, { rpc: async () => ({ data: closureResult({ kind: "candidate", detail: { ...closureCandidate(), capabilities: { canClose: false, canRecordUnknown: false, canDispute: false, canRespond: false }, blockers: ["feature_disabled"] } }), error: null }) }); assert.equal(safe.data.kind, "candidate");
});
