// Node-only synthetic test fixture; never import into a browser bundle. Every
// compact success is projected by the real source-byte verification service.
import { shiftCheckSource, shiftCheckQuery, shiftCheckActor, shiftCheckId } from "./attendance-shift-check-model";
import { projectPlanCoverage } from "../../src/lib/merchantAttendancePlanCoverage.server";
import type { SelfScheduleSlot } from "../../src/lib/merchantAttendanceSelfSchedule";

export const planCoverageId = shiftCheckId, planCoverageActor = shiftCheckActor;
export const planCoverageQuery = { siteId: shiftCheckQuery.siteId, workerId: shiftCheckQuery.workerId, slotId: planCoverageId(500) };
export function planCoverageSource(count: 0 | 1 | 2 = 1) {
  const seed = shiftCheckSource("verified", true);
  const slot: SelfScheduleSlot = { id: planCoverageQuery.slotId, revision: 1, locationId: planCoverageId(5), locationName: "Saved coverage place", timeZone: "UTC",
    workDate: "2026-09-02", startAt: "2026-09-02T08:00:00.000Z", endAt: "2026-09-02T16:00:00.000Z", cancelled: false, hasPublicationEvidence: true };
  const sessions = Array.from({ length: count }, (_, index) => {
    const child = structuredClone(seed);
    if (index) {
      child.binding.event = { ...child.binding.event, startEventId: planCoverageId(50), operationId: planCoverageId(51), sequence: 5, occurredAt: "2026-09-02T12:00:00.000000Z" };
      child.binding.binding!.recordedAt = "2026-09-02T12:00:00.000900Z";
      const times = ["12:00:00.000000", "13:00:00.000000", "13:00:59.999999", "14:00:00.000000"];
      child.events = child.events.map((event, i) => ({ ...event, id: planCoverageId(i ? 51 + i : 50), sequence: 5 + i, occurredAt: `2026-09-02T${times[i]}Z` }));
    }
    const event = child.binding.event;
    child.relation = { startEventId: event.startEventId, operationId: event.operationId, selection: { slotId: slot.id, revision: slot.revision }, status: "linked", reason: null,
      slot: structuredClone(slot), observedRevision: 1, recordedAt: child.binding.binding!.recordedAt, currentCancelled: false };
    return child;
  });
  return { protocol: "plan-coverage-source-v1", siteId: planCoverageQuery.siteId, actorId: planCoverageActor, worker: structuredClone(seed.binding.worker), slot,
    readStartedAt: "2026-09-02T15:59:59.999999Z", readCompletedAt: "2026-09-02T16:00:00.000001Z", sessions };
}
export const planCoverageWire = (count: 0 | 1 | 2 = 1) => structuredClone(projectPlanCoverage(planCoverageSource(count), planCoverageQuery, planCoverageActor));
export const planCoverageHttp = (count: 0 | 1 | 2 = 1, moduleEnabled = true) => ({ ok: true, moduleEnabled, data: planCoverageWire(count) });
