// Node-only synthetic fixture. Old source-byte projection is real; no database
// is queried and no browser bundle should import this fixture module.
import { planCoverageSource, planCoverageWire, planCoverageActor, planCoverageQuery, planCoverageId } from "./attendance-plan-coverage-model";
import { projectShiftCheck } from "../../src/lib/merchantAttendanceShiftCheck.server";
import type { ShiftCheckData } from "../../src/lib/merchantAttendanceShiftCheck";
import type { PlanAdoption, ShiftCheckAdoptionData, PlanCoverageAdoptionsData } from "../../src/lib/merchantAttendancePlanAdoptionView";

export const planAdoptionViewId = planCoverageId, planAdoptionViewActor = planCoverageActor;
export const planCoverageAdoptionsQuery = { ...planCoverageQuery };
export const shiftCheckAdoptionQuery = { siteId: planCoverageQuery.siteId, workerId: planCoverageQuery.workerId,
  startEventId: planCoverageWire().sessions[0].rule.event.startEventId };
export function planAdoptionViewAdoption(check: ShiftCheckData, channel: PlanAdoption["channel"] = "self"): PlanAdoption {
  if (!check.relation) throw new Error("synthetic_relation_required");
  return { startEventId: check.rule.event.startEventId, operationId: check.rule.event.operationId, channel,
    employeeId: check.rule.worker.employeeId, employeeAuthUserId: check.rule.worker.employeeAuthUserId,
    status: "adopted", reason: null, approval: { operationId: planAdoptionViewId(801), revision: 3, sourceId: planAdoptionViewId(802),
      sourceSha256: "a".repeat(64), recordedAt: "2026-09-01T10:00:00.123456Z" },
    recordedAt: check.relation.recordedAt, policy: "explicit-plan-approval-at-clock-in-v1" };
}
export function shiftCheckAdoptionSource() {
  const check = planCoverageSource().sessions[0];
  const projected = projectShiftCheck(check, shiftCheckAdoptionQuery, planAdoptionViewActor);
  return { protocol: "shift-check-adoption-source-v1" as const, check, adoption: planAdoptionViewAdoption(projected) as PlanAdoption | null };
}
export function shiftCheckAdoptionWire(): ShiftCheckAdoptionData {
  const check = planCoverageWire().sessions[0];
  return { protocol: "shift-check-adoption-v1", check, adoption: planAdoptionViewAdoption(check) };
}
export const shiftCheckAdoptionHttp = (moduleEnabled = true) => ({ ok: true, moduleEnabled, data: shiftCheckAdoptionWire() });
export function planCoverageAdoptionsSource(count: 0 | 1 | 2 = 2) {
  const coverage = planCoverageSource(count), publicCoverage = planCoverageWire(count);
  return { protocol: "plan-coverage-adoptions-source-v1" as const, coverage,
    adoptions: publicCoverage.sessions.map(check => ({ startEventId: check.rule.event.startEventId, adoption: planAdoptionViewAdoption(check) as PlanAdoption | null })) };
}
export function planCoverageAdoptionsWire(count: 0 | 1 | 2 = 2): PlanCoverageAdoptionsData {
  const coverage = planCoverageWire(count);
  return { protocol: "plan-coverage-adoptions-v1", coverage,
    adoptions: coverage.sessions.map(check => ({ startEventId: check.rule.event.startEventId, adoption: planAdoptionViewAdoption(check) })) };
}
export const planCoverageAdoptionsHttp = (count: 0 | 1 | 2 = 2, moduleEnabled = true) => ({ ok: true, moduleEnabled, data: planCoverageAdoptionsWire(count) });
