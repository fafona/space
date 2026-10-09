// Pure compact-wire fixture. Its hash is a synthetic server-attested value,
// not a claim that JavaScript re-created PostgreSQL's JSONB text bytes.
import type { PlanRuleApprovalsQuery, PlanRuleApprovalsCommand, PlanRuleApprovalsSource, PlanRuleApprovalsResult } from "../../src/lib/merchantAttendancePlanRuleApprovals";
import type { ShiftRuleField, ShiftRuleProvenance } from "../../src/lib/merchantAttendanceShiftRuleBinding";

export const planRuleApprovalsId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const planRuleApprovalsActor = planRuleApprovalsId(1);
export const planRuleApprovalsFingerprint = "a".repeat(64);
export function planRuleApprovalsQuery(mode: PlanRuleApprovalsQuery["mode"] = "preview", operationId = planRuleApprovalsId(900)): PlanRuleApprovalsQuery {
  return { siteId: "99990009", workerId: planRuleApprovalsId(4), slotId: planRuleApprovalsId(30), mode, operationId: mode === "recover" || mode === "approve" ? operationId : null };
}
export function planRuleApprovalsSource(): PlanRuleApprovalsSource {
  const id = planRuleApprovalsId, source: PlanRuleApprovalsSource = {
    protocol: "plan-rule-point-v1", policy: "owner-approved-plan-start-v1", siteId: "99990009", workerId: id(4), employeeId: id(2), employeeAuthUserId: id(3),
    workerVersion: 2, settingsVersion: 3, timeZone: "Europe/Madrid",
    slot: { id: id(30), revision: 2, locationId: id(5), locationVersion: 2, timeZone: "UTC", startAt: "2026-10-08T08:00:00.000Z", endAt: "2026-10-08T16:00:00.000Z" },
    assignment: { assignmentId: id(40), revision: 1, groupId: id(41), groupName: "Synthetic group", groupRevision: 2, employeeId: id(2), timeZone: "Europe/Madrid",
      fromAt: "2026-10-01T00:00:00.000000Z", toAt: "2026-10-09T00:00:00.000000Z" },
    enterprise: { revision: 5, publication: { operationId: id(50), revision: 2, actorId: id(8), recordedAt: "2026-10-04T00:00:00.000000Z", effectiveAt: "2026-10-07T00:00:00.000Z",
      rules: { lateGraceMinutes: { mode: "value", minutes: 8 }, earlyGraceMinutes: { mode: "value", minutes: 5 } } } },
    group: { groupId: id(41), revision: 6, publication: { operationId: id(51), revision: 4, actorId: id(9), recordedAt: "2026-10-04T00:00:00.000001Z", effectiveAt: "2026-10-07T00:00:00.000Z",
      rules: { lateGraceMinutes: { mode: "value", minutes: 0 }, earlyGraceMinutes: { mode: "inherit" } } } },
    personal: { revision: 3, approval: { operationId: id(52), revision: 1, actorId: id(9), recordedAt: "2026-10-04T00:00:00.000002Z", fromAt: "2026-10-07T00:00:00.000Z", toAt: "2026-10-09T00:00:00.000Z",
      rules: { lateGraceMinutes: { mode: "inherit" }, earlyGraceMinutes: { mode: "inherit" } } } },
    fields: {} as PlanRuleApprovalsSource["fields"],
  };
  for (const key of ["lateGraceMinutes", "earlyGraceMinutes"] as const) {
    const field: ShiftRuleField = { state: "unconfigured", minutes: null, source: null, trace: [] };
    for (const layer of ["personal", "group", "enterprise"] as const) {
      const part = source[layer], item = layer === "personal" ? source.personal.approval : layer === "group" ? source.group!.publication : source.enterprise.publication;
      const choice = item!.rules[key], groupId = layer === "group" ? source.group!.groupId : null;
      const provenance: ShiftRuleProvenance = { layer, groupId, ledgerRevision: part!.revision, operationId: item!.operationId, revision: item!.revision, actorId: item!.actorId };
      const minutes = choice.mode === "value" ? choice.minutes : null;
      field.trace.push({ layer, groupId, ledgerRevision: part!.revision, mode: choice.mode, minutes, source: provenance });
      if (field.state === "unconfigured" && choice.mode !== "inherit") { field.state = choice.mode; field.minutes = minutes; field.source = provenance; }
    }
    source.fields[key] = field;
  }
  return source;
}
export function planRuleApprovalsCommand(): PlanRuleApprovalsCommand {
  return { operationId: planRuleApprovalsId(900), expectedRevision: 0, expectedFingerprint: planRuleApprovalsFingerprint,
    employeeId: planRuleApprovalsId(2), employeeAuthUserId: planRuleApprovalsId(3), reason: "Synthetic owner-approved plan policy" };
}
export function planRuleApprovalsWire(mode: PlanRuleApprovalsQuery["mode"] = "preview"): PlanRuleApprovalsResult {
  const q = planRuleApprovalsQuery(mode), source = planRuleApprovalsSource(), { locationVersion: _version, ...slot } = source.slot; void _version;
  const result: PlanRuleApprovalsResult = { protocol: "plan-rule-approvals-v1", siteId: q.siteId, actorId: planRuleApprovalsActor,
    worker: { workerId: q.workerId, workerName: "Synthetic worker", workerNo: "QA-4", employeeId: source.employeeId, employeeAuthUserId: source.employeeAuthUserId, version: 4, active: true, employeeActive: true },
    slot: { ...slot, workDate: "2026-10-08", locationName: "Synthetic location", cancelled: false, hasPublicationEvidence: true },
    revision: mode === "preview" ? 0 : 1, preview: null, approval: null, readAt: "2026-10-05T12:00:00.003000Z" };
  if (mode === "preview") result.preview = { fingerprint: planRuleApprovalsFingerprint, observedAt: "2026-10-05T12:00:00.001000Z", eligible: true, blockers: [], source };
  else result.approval = { operationId: planRuleApprovalsId(900), revision: 1, actorId: planRuleApprovalsActor, command: planRuleApprovalsCommand(),
    observedAt: "2026-10-05T12:00:00.001000Z", recordedAt: "2026-10-05T12:00:00.002000Z", sourceId: planRuleApprovalsId(500), sourceSha256: planRuleApprovalsFingerprint, sourceBytes: 8192, source };
  return result;
}
export function planRuleApprovalsHttp(mode: PlanRuleApprovalsQuery["mode"] = "preview", moduleEnabled = true) {
  return { ok: true as const, moduleEnabled, data: planRuleApprovalsWire(mode) };
}
