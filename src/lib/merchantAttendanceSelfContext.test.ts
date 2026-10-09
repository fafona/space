import assert from "node:assert/strict";
import test from "node:test";
import { parseAttendanceSelfContext, parseAttendanceSelfContextQuery } from "./merchantAttendanceSelfContext";
import { executeAttendanceSelfContext } from "./merchantAttendanceSelfContext.server";
const id = "00000000-0000-4000-8000-000000000001", siteId = "99990001";
const context = { siteId, employeeId: id, workerId: id, locationId: null };
test("self context query accepts exactly one site and no client-chosen identity", () => {
  assert.deepEqual(parseAttendanceSelfContextQuery(`https://local.invalid/?siteId=${siteId}`), { siteId });
  for (const q of ["", "siteId=x", `siteId=${siteId}&siteId=${siteId}`, ...["employeeId", "workerId", "authUserId", "locationId", "operationId", "permissions"].map(k => `siteId=${siteId}&${k}=${id}`)])
    assert.throws(() => parseAttendanceSelfContextQuery(`https://local.invalid/?${q}`));
});
test("self context whitelists only four routing fields and validates identity/location", () => {
  assert.deepEqual(parseAttendanceSelfContext({ ...context, latitude: 37.3, email: "private" }, siteId), context);
  for (const patch of [{ siteId: "99990002" }, { employeeId: "x" }, { workerId: null }, { locationId: undefined }]) assert.throws(() => parseAttendanceSelfContext({ ...context, ...patch }, siteId));
});
test("service calls read-only context RPC using verified auth identity and strips private fields", async () => {
  const result = await executeAttendanceSelfContext({ siteId, authUserId: id }, { rpc: async (name, args) => {
    assert.equal(name, "faolla_attendance_self_context_v1"); assert.deepEqual(args, { p_site_id: siteId, p_auth_user_id: id });
    return { data: { ...context, rawEmployee: { email: "private" } }, error: null };
  } });
  assert.deepEqual(result, context);
});
test("context service hides internal RPC and invalid response failures", async () => {
  await assert.rejects(executeAttendanceSelfContext({ siteId, authUserId: id }, null), /attendance_unavailable/);
  for (const [message, expected] of [["attendance_access_denied", "attendance_access_denied"], ["private SQL", "attendance_unavailable"]])
    await assert.rejects(executeAttendanceSelfContext({ siteId, authUserId: id }, { rpc: async () => ({ data: null, error: { message } }) }), new RegExp(expected));
  await assert.rejects(executeAttendanceSelfContext({ siteId, authUserId: id }, { rpc: async () => ({ data: { ...context, workerId: "bad" }, error: null }) }), /attendance_unavailable/);
});
