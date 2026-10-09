import { createServerSupabaseServiceClient } from "./superAdminServer";
import type { AttendanceSelfRpc } from "./merchantAttendanceSelf.server";
import { executeShiftRuleBinding } from "./merchantAttendanceShiftRuleBinding.server";
import { parseShiftRuleBindingResult, parseShiftRulePoint } from "./merchantAttendanceShiftRuleBinding";
import { parseShiftRuleViewQuery, parseShiftRuleViewResult, parseShiftRuleViewResponse, type ShiftRuleViewEvidence, type ShiftRuleViewQuery, type ShiftRuleViewResult } from "./merchantAttendanceShiftRuleView";

// Server-only: old155 verifies original UTF8/hash/full graph. Never put this
// module or the stored sourceText into a browser bundle or response.
export function projectShiftRuleView(raw: unknown, query: ShiftRuleViewQuery, actorId: string): ShiftRuleViewResult {
  const checked = parseShiftRuleBindingResult(raw, parseShiftRuleViewQuery(query), actorId);
  let evidence: ShiftRuleViewEvidence | null = null;
  if (checked.status === "verified") {
    const saved = checked.binding!.source!, point = parseShiftRulePoint(saved, query, checked.binding!, checked.event);
    evidence = { sourceId: saved.sourceId, sourceSha256: saved.sourceSha256, sourceBytes: saved.sourceBytes, timeZone: point.timeZone,
      group: point.group === null ? null : { groupId: point.group.group.groupId, name: point.group.group.name, revision: point.group.group.revision,
        assignmentId: point.assignment!.detail.assignmentId, assignmentRevision: point.assignment!.detail.revision },
      enterpriseRevision: point.enterprise.revision, groupRevision: point.group?.revision ?? null, personalRevision: point.personal.revision, fields: point.fields };
  }
  const binding = checked.binding === null ? null : {
    channel: checked.binding.channel, requestAuthUserId: checked.binding.requestAuthUserId, employeeId: checked.binding.employeeId, employeeAuthUserId: checked.binding.employeeAuthUserId,
    workerVersion: checked.binding.workerVersion, settingsVersion: checked.binding.settingsVersion, algorithmVersion: checked.binding.algorithmVersion,
    bindingPolicy: checked.binding.bindingPolicy, recordedAt: checked.binding.recordedAt,
  };
  const result = parseShiftRuleViewResult({ protocol: "shift-rule-binding-view-v1", readOnly: true, formalReady: false, siteId: checked.siteId, actorId: checked.actorId,
    worker: checked.worker, event: checked.event, status: checked.status, reason: checked.reason, binding, evidence, readAt: checked.readAt }, query, actorId);
  // The 32KiB limit includes the HTTP wrapper, not just compact data.
  parseShiftRuleViewResponse({ ok: true, moduleEnabled: false, data: result }, query, actorId);
  return result;
}
export async function executeShiftRuleView(input: { query: ShiftRuleViewQuery; authUserId: string },
  service: AttendanceSelfRpc | null = createServerSupabaseServiceClient()): Promise<ShiftRuleViewResult> {
  const query = parseShiftRuleViewQuery(input.query);
  return projectShiftRuleView(await executeShiftRuleBinding({ query, authUserId: input.authUserId }, service), query, input.authUserId);
}
