import assert from "node:assert/strict";
import test from "node:test";
import type { AttendanceSelfRpc } from "./merchantAttendanceSelf.server";
import { executePlanExceptions } from "./merchantAttendancePlanExceptions.server";
import { executePeriodClosures } from "./merchantAttendancePeriodClosure.server";
import { executePeriodClosuresV2 } from "./merchantAttendancePeriodClosureV2.server";
import { exceptionUiQuery as eq, exceptionUiDecisionCommand as ec } from "../../scripts/fixtures/attendance-plan-exception-ui-model";
import { periodClosureUiId as id, periodClosureUiQuery as pq, periodClosureUiCommand as pc } from "../../scripts/fixtures/attendance-period-closure-ui-model";
import { periodClosureV2FixtureQuery as p2q } from "../../scripts/fixtures/attendance-period-closure-v2-model";
async function capture(run: () => Promise<void>) {
  const values = { FAOLLA_ATTENDANCE_OWNER_NOTIFICATIONS_CAPTURE_ENABLED: "1", FAOLLA_ATTENDANCE_OWNER_NOTIFICATIONS_CAPTURE_SITES: "99990001,99990009",
    FAOLLA_ATTENDANCE_EVENT_NOTIFICATIONS_CAPTURE_ENABLED: "1", FAOLLA_ATTENDANCE_EVENT_NOTIFICATIONS_CAPTURE_SITES: "99990001,99990009" };
  const saved = Object.fromEntries(Object.keys(values).map(k => [k, process.env[k]]));
  try { Object.assign(process.env, values); await run(); } finally { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
}
async function probe(run: (s: AttendanceSelfRpc) => Promise<unknown>, name: string) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  // This deliberately stops at the dispatch boundary; SQL acceptance is separate.
  await assert.rejects(run({ rpc: async (n, args) => { calls.push({ name: n, args }); return { data: null, error: { message: "23514 synthetic owner notice failure" } }; } }), { code: "attendance_unavailable" });
  assert.equal(calls.length, 1); assert.equal(calls[0].name, name); return calls[0].args;
}
test("only flagged self note selects new complete174 wrapper and preserves original seven arguments", async () => capture(async () => {
  const query = eq("self", "note"), command = { operationId: query.operationId!, decisionOperationId: id(20), expectedRevision: 1, note: "explicit synthetic note" };
  let args = await probe(s => executePlanExceptions({ query, command, authUserId: id(3), moduleEnabled: true }, s), "faolla_attendance_plan_exception_owner_event_v1");
  assert.equal(args.p_capture_owner_notifications, true); assert.equal(args.p_capture_notifications, false); assert.deepEqual(args.p_query, query); assert.deepEqual(args.p_command, command);
  assert.deepEqual(Object.keys(args).sort(), ["p_query", "p_auth_user_id", "p_command", "p_allow_write", "p_allow_posthoc", "p_allow_clearance", "p_capture_notifications", "p_capture_owner_notifications"].sort());
  process.env.FAOLLA_ATTENDANCE_OWNER_NOTIFICATIONS_CAPTURE_ENABLED = "0";
  args = await probe(s => executePlanExceptions({ query, command, authUserId: id(3), moduleEnabled: true }, s), "faolla_attendance_plan_exception_posthoc_review_v1");
  assert(!Object.hasOwn(args, "p_capture_owner_notifications")); assert.equal(args.p_capture_notifications, false);
}));
test("employee ack/reads/recovery and owner decide retain old RPC and independent old employee notice flag", async () => capture(async () => {
  const args = await probe(s => executePlanExceptions({ query: eq("owner", "decide"), command: ec(), authUserId: id(1), moduleEnabled: true }, s), "faolla_attendance_plan_exception_posthoc_review_v1");
  assert.equal(args.p_capture_notifications, true); assert(!Object.hasOwn(args, "p_capture_owner_notifications"));
  for (const mode of ["detail", "recover"] as const) await probe(s => executePlanExceptions({ query: eq("self", mode), authUserId: id(3) }, s), "faolla_attendance_plan_exception_posthoc_review_v1");
  const q = eq("self", "ack"); await probe(s => executePlanExceptions({ query: q, command: { operationId: q.operationId!, decisionOperationId: id(20) }, authUserId: id(3), moduleEnabled: true }, s), "faolla_attendance_plan_exception_posthoc_review_v1");
}));
test("both existing period writers capture only self dispute, not self confirm/owner response/read/recover", async () => capture(async () => {
  for (const v2 of [false, true]) {
    const query = pq("detail", "self");
    const version = v2 ? "v2" : "v1", c = { ...pc(), action: "dispute" as const, expectedRevision: 1, expectedVersion: 1, expectedFingerprint: null };
    const execute = (q: typeof query, command: typeof c | null, s: AttendanceSelfRpc) => v2
      ? executePeriodClosuresV2({ query: { ...q, cursor: null }, command, authUserId: id(3), moduleEnabled: true }, s)
      : executePeriodClosures({ query: q, command, authUserId: id(3), moduleEnabled: true }, s);
    const args = await probe(s => execute(query, c, s), `faolla_attendance_period_closure_owner_event_${version}`);
    assert.equal(args.p_capture_owner_notifications, true); assert.equal(args.p_artifact, null); assert.deepEqual(args.p_command, c);
    await probe(s => execute(query, null, s), `faolla_attendance_period_closure_${version}`);
    const recovery = { ...query, mode: "recover" as const, operationId: c.operationId }; await probe(s => execute(recovery, null, s), `faolla_attendance_period_closure_${version}`);
    const ownerQuery = { ...query, access: "owner" as const }, response = { ...c, action: "respond" as const };
    await probe(s => v2 ? executePeriodClosuresV2({ query: { ...ownerQuery, cursor: null }, command: response, authUserId: id(1), moduleEnabled: true }, s)
      : executePeriodClosures({ query: ownerQuery, command: response, authUserId: id(1), moduleEnabled: true }, s), `faolla_attendance_period_closure_${version}`);
    const confirm = { ...c, action: "confirm" as const, expectedFingerprint: "a".repeat(64) };
    await probe(s => v2 ? executePeriodClosuresV2({ query: { ...query, cursor: null }, command: confirm, authUserId: id(3), moduleEnabled: true }, s)
      : executePeriodClosures({ query, command: confirm, authUserId: id(3), moduleEnabled: true }, s), `faolla_attendance_period_closure_${version}`);
  }
}));
test("capture off/wrong site never changes old v1/v2 dispute RPC or adds a new flag argument", async () => capture(async () => {
  for (const wrong of [false, true]) {
    process.env.FAOLLA_ATTENDANCE_OWNER_NOTIFICATIONS_CAPTURE_ENABLED = wrong ? "1" : "0";
    process.env.FAOLLA_ATTENDANCE_OWNER_NOTIFICATIONS_CAPTURE_SITES = wrong ? "99990088" : "99990001,99990009";
    const command = { ...pc(), action: "dispute" as const, expectedRevision: 1, expectedVersion: 1, expectedFingerprint: null };
    const a = await probe(s => executePeriodClosures({ query: pq("detail", "self"), command, authUserId: id(3), moduleEnabled: true }, s), "faolla_attendance_period_closure_v1");
    const b = await probe(s => executePeriodClosuresV2({ query: p2q("detail", "self"), command, authUserId: id(3), moduleEnabled: true }, s), "faolla_attendance_period_closure_v2");
    assert(!Object.hasOwn(a, "p_capture_owner_notifications")); assert(!Object.hasOwn(b, "p_capture_owner_notifications"));
  }
}));
