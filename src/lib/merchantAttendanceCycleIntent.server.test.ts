import test from "node:test";
import assert from "node:assert/strict";
import { cycleIntentEnabled, executeCycleIntent } from "./merchantAttendanceCycleIntent.server";
import { cycleModel, cycleOwner, cycleSite } from "../../scripts/fixtures/attendance-cycle-intent-model";
test("200 acceptance flag is explicit and site allowlist is exact/default off", () => {
  const env = { FAOLLA_ATTENDANCE_OPERATIONAL_CYCLE_ENABLED: "1", FAOLLA_ATTENDANCE_OPERATIONAL_CYCLE_SITE_IDS: cycleSite };
  assert.equal(cycleIntentEnabled(cycleSite, env), true); assert.equal(cycleIntentEnabled(cycleSite, {}), false);
  for (const ids of ["", cycleSite + ",", " " + cycleSite, cycleSite + "\n", `${cycleSite},${cycleSite}`]) assert.equal(cycleIntentEnabled(cycleSite, { ...env, FAOLLA_ATTENDANCE_OPERATIONAL_CYCLE_SITE_IDS: ids }), false);
});
test("200 service binds exact actual Auth/command and SQL acceptance flag without hidden retries", async () => {
  const f = await cycleModel(), calls: unknown[] = [];
  await executeCycleIntent({ query: f.query, command: f.command, authUserId: cycleOwner, allowAccept: true }, { rpc: async (name, args) => { calls.push({ name, args }); return { data: f.result({ kind: "receipt" }, f.receipt), error: null }; } });
  assert.deepEqual(calls, [{ name: "faolla_attendance_operational_cycle_v1", args: { p_query: f.query, p_auth_user_id: cycleOwner, p_command: f.command, p_allow_accept: true } }]);
  await assert.rejects(executeCycleIntent({ query: f.query, command: f.command, authUserId: cycleOwner, allowAccept: true }, { rpc: async () => ({ data: f.result({ kind: "receipt" }), error: null }) }));
});
test("200 service projects SQL preparation and suppresses arbitrary SQL/network diagnostics", async () => {
  const f = await cycleModel(), input = { query: { ...f.scope, mode: "prepare" as const, anchorDate: f.command.anchorDate }, command: null, authUserId: cycleOwner, allowAccept: false };
  const value = await executeCycleIntent(input, { rpc: async () => ({ data: f.result({ kind: "preparation", source: f.source, anchorDate: f.command.anchorDate, activation: { revision: 1, active: true }, frameHead: { revision: 0, lastOperationId: null } }), error: null }) });
  assert.equal(value.data.kind, "preparation");
  for (const message of ["attendance_access_denied", "attendance_operational_cycle_changed"]) await assert.rejects(executeCycleIntent(input, { rpc: async () => ({ data: null, error: { message } }) }), { code: message });
  await assert.rejects(executeCycleIntent(input, { rpc: async () => ({ data: null, error: { message: "private_schema_details" } }) }), { code: "attendance_operational_cycle_invalid" });
  await assert.rejects(executeCycleIntent(input, { rpc: async () => { throw Error("network"); } }), { code: "attendance_operational_cycle_invalid" });
});
