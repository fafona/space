import assert from "node:assert/strict";
import test from "node:test";
import * as ui from "./merchantAttendanceDelegatedPlanExceptionsUi";
import { delegatedPlanExceptionsModel as model } from "../../scripts/fixtures/attendance-delegated-plan-exceptions-model";
const id = (n: number) => "00000000-0000-4000-8000-" + String(n).padStart(12, "0");
test("209 explicit owner form defaults to future publications, no self-grant and UTC window", () => {
  const f = model(), s = f.context.scope, form: ui.ManagementPlanExceptionsGrantForm = { delegateEmployeeId: id(100), delegateAuthUserId: f.actor,
    workerId: s.workerId, employeeId: s.employeeId, employeeAuthUserId: s.employeeAuthUserId, locationIds: s.locationIds.join(","), includePending: false,
    validFrom: "2026-10-09T12:00:00", validUntil: "2026-10-10T12:00:00", reason: "Synthetic scope", acknowledged: true };
  const grant = ui.buildManagementPlanExceptionsGrant(form, id(200)); assert.equal(grant.delegatedAction, "plan_exception_decide"); assert.equal(grant.scope.kind, "formal_exception");
  if (grant.scope.kind !== "formal_exception") assert.fail(); assert.equal(grant.scope.includePending, false);
  assert.equal((ui.buildManagementPlanExceptionsGrant({ ...form, includePending: true }, id(201)).scope as typeof grant.scope).includePending, true);
  for (const patch of [{ acknowledged: false }, { delegateEmployeeId: s.employeeId }, { delegateAuthUserId: s.employeeAuthUserId }, { locationIds: "" }, { includePending: "false" }, { ownerId: f.actor }]) assert.throws(() => ui.buildManagementPlanExceptionsGrant({ ...form, ...patch }, id(200)));
});
test("209 decision builder binds server-attested exact basis, clear/posthoc masks and explicit acknowledgement", async () => {
  for (const eligible of [true, false]) { const f = model(eligible), draft = { outcome: f.command.outcome, note: "  Synthetic delegated explicit decision  ", acknowledged: true };
    assert.deepEqual(await ui.buildManagementPlanExceptionsCommand(f.context, f.query, f.actor, draft, f.command.operationId), f.command);
    for (const patch of [{ acknowledged: false }, { outcome: "cleared" }, { outcome: "not_applicable" }, { outcome: "annul" }, { note: "" }, { canDecide: true }]) await assert.rejects(ui.buildManagementPlanExceptionsCommand(f.context, f.query, f.actor, { ...draft, ...patch }, f.command.operationId));
  }
});
