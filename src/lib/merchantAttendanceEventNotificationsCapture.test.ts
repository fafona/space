import assert from "node:assert/strict";
import test from "node:test";
import type { AttendanceSelfRpc } from "./merchantAttendanceSelf.server";
import { executeAttendanceSchedule } from "./merchantAttendanceSchedule.server";
import { executeScheduleDelegation } from "./merchantAttendanceScheduleDelegation.server";
import { executeWorkArrangement } from "./merchantAttendanceWorkArrangement.server";
import { executeApplicationDelegation } from "./merchantAttendanceApplicationDelegation.server";
import { executePlanExceptions } from "./merchantAttendancePlanExceptions.server";
import type { ScheduleQuery } from "./merchantAttendanceSchedule";
import type { WorkArrangementCommand } from "./merchantAttendanceWorkArrangement";
import { scheduleDelegationId as id, scheduleDelegationQuery as sq, scheduleDelegationCommand as sc, scheduleDelegationGrantCommand as sg } from "../../scripts/fixtures/attendance-schedule-delegation-model";
import { applicationDelegationQuery as aq, applicationDelegationCommand as ac, applicationDelegationGrantCommand as ag } from "../../scripts/fixtures/attendance-application-delegation-model";
import { workArrangementQuery as wq, workArrangementCommand as wc } from "../../scripts/fixtures/attendance-work-arrangement-model";
import { exceptionUiQuery as pq, exceptionUiDecisionCommand as pc } from "../../scripts/fixtures/attendance-plan-exception-ui-model";

async function env(values: Record<string, string | undefined>, body: () => Promise<void>) { const saved = Object.fromEntries(Object.keys(values).map(k => [k, process.env[k]]));
  try { for (const [k, v] of Object.entries(values)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } await body(); }
  finally { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } } }
const capture = (enabled = true) => ({ FAOLLA_ATTENDANCE_EVENT_NOTIFICATIONS_CAPTURE_ENABLED: enabled ? "1" : "0", FAOLLA_ATTENDANCE_EVENT_NOTIFICATIONS_CAPTURE_SITES: "98400198,99990001,99990009" });
async function probe(run: (service: AttendanceSelfRpc) => Promise<unknown>, expected: string) { const calls: { name: string; args: Record<string, unknown> }[] = [];
  // Stop at the RPC boundary: this test proves dispatch, not a SQL success.
  await assert.rejects(run({ rpc: async (name, args) => { calls.push({ name, args }); return { data: null, error: { message: "23514 synthetic capture fault" } }; } }), { code: "attendance_unavailable" });
  assert.equal(calls.length, 1); assert.equal(calls[0].name, expected); return calls[0].args;
}
test("owner schedule capture preserves original independent evidence gate; cancel/GET never enable evidence", async () => {
  const query: ScheduleQuery = { siteId: "98400198", access: "owner", workerId: id(4), fromDate: "2026-10-07", throughDate: "2026-10-08", operationId: null };
  await env({ ...capture(), FAOLLA_ATTENDANCE_SCHEDULE_PUBLICATION_EVIDENCE_ENABLED: "0", FAOLLA_ATTENDANCE_SCHEDULE_PUBLICATION_EVIDENCE_SITE_IDS: "98400198" }, async () => {
    let args = await probe(s => executeAttendanceSchedule({ query, command: sc().decision, authUserId: id(1), allowWrite: true }, s), "faolla_attendance_schedule_event_v1"); assert.equal(args.p_capture_publication_evidence, false);
    process.env.FAOLLA_ATTENDANCE_SCHEDULE_PUBLICATION_EVIDENCE_ENABLED = "1";
    args = await probe(s => executeAttendanceSchedule({ query, command: sc().decision, authUserId: id(1), allowWrite: true }, s), "faolla_attendance_schedule_event_v1"); assert.equal(args.p_capture_publication_evidence, true);
    args = await probe(s => executeAttendanceSchedule({ query, command: sc("cancel").decision, authUserId: id(1), allowWrite: true }, s), "faolla_attendance_schedule_event_v1"); assert.equal(args.p_capture_publication_evidence, false);
    await probe(s => executeAttendanceSchedule({ query, command: null, authUserId: id(1), allowWrite: false }, s), "faolla_attendance_schedule_v1");
    process.env.FAOLLA_ATTENDANCE_EVENT_NOTIFICATIONS_CAPTURE_ENABLED = "0";
    args = await probe(s => executeAttendanceSchedule({ query, command: sc().decision, authUserId: id(1), allowWrite: true }, s), "faolla_attendance_schedule_evidenced_v1"); assert.equal(Object.hasOwn(args, "p_capture_publication_evidence"), false);
  });
});
test("supervisor event wrapper only for explicit decisions, never grant/revoke/read/recovery", async () => {
  await env(capture(), async () => {
    for (const action of ["publish", "cancel"] as const) await probe(s => executeScheduleDelegation({ query: sq("delegate", "schedule"), command: sc(action), authUserId: id(3), allowWrite: true }, s), "faolla_attendance_schedule_delegation_event_v1");
    await probe(s => executeScheduleDelegation({ query: sq("owner"), command: sg(), authUserId: id(1), allowWrite: true }, s), "faolla_attendance_schedule_delegation_v1");
    for (const mode of ["grants", "recover"] as const) await probe(s => executeScheduleDelegation({ query: sq("delegate", mode), command: null, authUserId: id(3), allowWrite: false }, s), "faolla_attendance_schedule_delegation_v1");
  });
});
test("owner work result actions capture; self submit/withdraw, policy and all reads stay original", async () => {
  await env(capture(), async () => {
    for (const action of ["approve", "reject", "cancel"] as const) { const command: WorkArrangementCommand = { action, operationId: id(30), requestId: id(10), expectedRevision: action === "cancel" ? 2 : 1, reason: "explicit",
      ...(action === "approve" ? { expectedConflictsFingerprint: "a".repeat(64), confirmConflicts: false } : {}) } as WorkArrangementCommand;
      await probe(s => executeWorkArrangement({ query: { ...wq("owner"), requestId: id(10) }, command, authUserId: id(1), allowWrite: true }, s), "faolla_attendance_work_arrangement_event_v1"); }
    await probe(s => executeWorkArrangement({ query: wq(), command: wc(), authUserId: id(3), allowWrite: true }, s), "faolla_attendance_work_arrangement_v1");
    await probe(s => executeWorkArrangement({ query: { ...wq(), requestId: id(10) }, command: { action: "withdraw", operationId: id(30), requestId: id(10), expectedRevision: 1, reason: "explicit" }, authUserId: id(3), allowWrite: true }, s), "faolla_attendance_work_arrangement_v1");
    await probe(s => executeWorkArrangement({ query: wq("owner"), command: { action: "set_policy", operationId: id(30), expectedRevision: 0, retrospectiveDays: 30, reason: "explicit" }, authUserId: id(1), allowWrite: true }, s), "faolla_attendance_work_arrangement_v1");
    await probe(s => executeWorkArrangement({ query: wq("owner"), command: null, authUserId: id(1), allowWrite: false }, s), "faolla_attendance_work_arrangement_v1");
  });
});
test("delegated wrapper leaves category resolution to saved grant and preserves old125 capture flag exactly", async () => {
  await env({ ...capture(), FAOLLA_ATTENDANCE_LEAVE_NOTIFICATIONS_ENABLED: "1" }, async () => {
    for (const category of ["leave", "work_arrangement"] as const) { const args = await probe(s => executeApplicationDelegation({ query: aq("delegate", "decide"), command: ac(category), authUserId: id(3), allowWrite: true }, s), "faolla_attendance_delegated_applications_event_v1"); assert.equal(args.p_capture_notifications, true); }
    const command = { ...ac(), decision: { action: "reject" as const, operationId: id(30), requestId: ac().decision.requestId, expectedRevision: 1 as const, reason: "explicit" } };
    const args = await probe(s => executeApplicationDelegation({ query: aq("delegate", "decide"), command, authUserId: id(3), allowWrite: true }, s), "faolla_attendance_delegated_applications_event_v1"); assert.equal(args.p_capture_notifications, true);
    await probe(s => executeApplicationDelegation({ query: aq("owner"), command: ag(), authUserId: id(1), allowWrite: true }, s), "faolla_attendance_application_delegations_v1");
    await probe(s => executeApplicationDelegation({ query: aq("delegate", "recover"), command: null, authUserId: id(3), allowWrite: false }, s), "faolla_attendance_delegated_applications_v1");
    process.env.FAOLLA_ATTENDANCE_EVENT_NOTIFICATIONS_CAPTURE_ENABLED = "0";
    const original = await probe(s => executeApplicationDelegation({ query: aq("delegate", "decide"), command: ac(), authUserId: id(3), allowWrite: true }, s), "faolla_attendance_delegated_applications_v1"); assert.equal(original.p_capture_notifications, true);
  });
});
test("exception captures only owner's explicit decision, not source, self note/ack or recovery", async () => {
  await env(capture(), async () => {
    const fresh = await probe(s => executePlanExceptions({ query: pq("owner", "decide"), command: pc(), authUserId: id(1), moduleEnabled: true }, s), "faolla_attendance_plan_exception_posthoc_review_v1"); assert.equal(fresh.p_capture_notifications, true);
    for (const mode of ["detail", "recover"] as const) { const read = await probe(s => executePlanExceptions({ query: pq("owner", mode), command: null, authUserId: id(1), moduleEnabled: false }, s), "faolla_attendance_plan_exception_posthoc_review_v1"); assert.equal(read.p_capture_notifications, false); }
    for (const mode of ["note", "ack"] as const) { const query = pq("self", mode), command = { operationId: query.operationId!, decisionOperationId: id(20), ...(mode === "note" ? { expectedRevision: 1, note: "explicit note" } : {}) };
      const self = await probe(s => executePlanExceptions({ query, command, authUserId: id(3), moduleEnabled: true }, s), "faolla_attendance_plan_exception_posthoc_review_v1"); assert.equal(self.p_capture_notifications, false); }
  });
});
test("read rollout cannot enable capture and wrong site remains on original business RPC", async () => {
  await env({ ...capture(false), FAOLLA_ATTENDANCE_EVENT_NOTIFICATIONS_READ_ENABLED: "1", FAOLLA_ATTENDANCE_EVENT_NOTIFICATIONS_READ_SITES: "98400198" }, async () => {
    await probe(s => executeScheduleDelegation({ query: sq("delegate", "schedule"), command: sc(), authUserId: id(3), allowWrite: true }, s), "faolla_attendance_schedule_delegation_v1");
    process.env.FAOLLA_ATTENDANCE_EVENT_NOTIFICATIONS_CAPTURE_ENABLED = "1"; process.env.FAOLLA_ATTENDANCE_EVENT_NOTIFICATIONS_CAPTURE_SITES = "98400200";
    await probe(s => executeScheduleDelegation({ query: sq("delegate", "schedule"), command: sc(), authUserId: id(3), allowWrite: true }, s), "faolla_attendance_schedule_delegation_v1");
  });
});
