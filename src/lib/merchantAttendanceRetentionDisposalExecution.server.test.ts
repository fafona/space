import test from "node:test";
import assert from "node:assert/strict";
import { disposalExecutionEnabled, executeRetentionDisposal } from "./merchantAttendanceRetentionDisposalExecution.server";
import { disposalActor, disposalSite, disposalQuery, disposalApprove, disposalReceipt, disposalResult } from "../../scripts/fixtures/attendance-retention-disposal-execution-model";
import type { AttendanceSelfRpc } from "./merchantAttendanceSelf.server";

test("disposal is default off and cannot extend beyond the single synthetic site", () => {
  const env = { FAOLLA_ATTENDANCE_RETENTION_DISPOSAL_ENABLED: "1", FAOLLA_ATTENDANCE_RETENTION_DISPOSAL_SITE_IDS: disposalSite };
  assert.equal(disposalExecutionEnabled(disposalSite, env), true); assert.equal(disposalExecutionEnabled(disposalSite, {}), false);
  for (const ids of ["", disposalSite + ",", " " + disposalSite, disposalSite + "\n", disposalSite + ",12345678", "12345678"])
    assert.equal(disposalExecutionEnabled(disposalSite, { ...env, FAOLLA_ATTENDANCE_RETENTION_DISPOSAL_SITE_IDS: ids }), false);
  assert.equal(disposalExecutionEnabled("12345678", { ...env, FAOLLA_ATTENDANCE_RETENTION_DISPOSAL_SITE_IDS: "12345678" }), false);
});
test("one exact SQL call binds actual actor; ordinary sites cannot preview/write but original receipt recovery survives", async () => {
  const calls: unknown[] = [], command = await disposalApprove(), receipt = await disposalReceipt(command);
  const service: AttendanceSelfRpc = { rpc: async (name, args) => { calls.push({ name, args }); return { data: disposalResult({ kind: "receipt", receipt }), error: null }; } };
  await executeRetentionDisposal({ query: disposalQuery(), command, authUserId: disposalActor, allowWrite: true }, service);
  assert.deepEqual(calls, [{ name: "faolla_attendance_retention_disposal_v1", args: { p_query: disposalQuery(), p_command: command, p_auth_user_id: disposalActor, p_allow_write: true } }]);
  await assert.rejects(executeRetentionDisposal({ query: { ...disposalQuery(), siteId: "12345678" }, command, authUserId: disposalActor, allowWrite: true }, service), { code: "attendance_retention_disposal_disabled" });
  assert.equal(calls.length, 1);
  const q = { siteId: "12345678", mode: "recover" as const, eventId: null, operationId: command.operationId };
  const recovered = await executeRetentionDisposal({ query: q, command: null, authUserId: disposalActor, allowWrite: false }, { rpc: async () => ({ data: { ...disposalResult({ kind: "receipt", receipt: null }), siteId: q.siteId }, error: null }) });
  assert.deepEqual(recovered.data, { kind: "receipt", receipt: null });
});
test("known SQL errors are preserved; arbitrary private details and transport failures are not exposed", async () => {
  const input = { query: disposalQuery(), command: null, authUserId: disposalActor, allowWrite: false };
  for (const code of ["attendance_access_denied", "attendance_retention_disposal_changed", "attendance_retention_disposal_blocked"])
    await assert.rejects(executeRetentionDisposal(input, { rpc: async () => ({ data: null, error: { message: code } }) }), { code });
  await assert.rejects(executeRetentionDisposal(input, { rpc: async () => ({ data: null, error: { message: "private detail" } }) }), { code: "attendance_retention_disposal_invalid" });
  await assert.rejects(executeRetentionDisposal(input, { rpc: async () => { throw Error("offline"); } }), { code: "attendance_retention_disposal_invalid" });
});
