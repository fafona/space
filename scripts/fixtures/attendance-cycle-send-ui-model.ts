// Shared strict synthetic UI/wire model. Never DB/Auth/source authority.
import { createHash } from "node:crypto";
import { cycleModel, cycleId, cycleOwner, cycleHash, cycleRecordedAt, cycleReadAt } from "./attendance-cycle-intent-model";
import { scheduleEvidenceWire, scheduleEvidenceMicros } from "./attendance-schedule-evidence-model";
import { attendanceDayUtcRange } from "../../src/lib/merchantAttendanceTime";
import { parseCycleIntentResult } from "../../src/lib/merchantAttendanceCycleIntentResult";
import { cycleIntentCommandFingerprint } from "../../src/lib/merchantAttendanceCycleIntent";
import { projectPeriodClosureSource, projectPeriodDelegatedSource } from "../../src/lib/merchantAttendancePeriodClosure.server";
import { parsePeriodClosureQuery } from "../../src/lib/merchantAttendancePeriodClosure";
import { cycleSendPanelContext, cycleSendPanelPreviewRequest, parseCycleSendPanelSource } from "../../src/components/enterprise/MerchantAttendanceCycleSendPanel";

export async function createCycleSendUiModel(access: "owner" | "delegate" = "owner", actor = cycleOwner) {
  const m = await cycleModel(), query = { ...m.query, access, grantId: access === "delegate" ? cycleId(70) : null };
  const commandHash = await cycleIntentCommandFingerprint(query, m.command, actor);
  const intent = { ...m.intent, actorId: actor, access, grantId: query.grantId };
  intent.intentFingerprint = cycleHash(["attendance-cycle-intent-v1", query.siteId, intent.intentId, actor, access, query.grantId, intent.workerId,
    intent.employeeId, intent.employeeAuthUserId, intent.anchorDate, intent.fromDate, intent.throughDate, intent.timeZone, intent.fromAt, intent.toAt,
    intent.dueAt, m.preparation.preparationFingerprint, m.source.sourceFingerprint, commandHash, cycleRecordedAt]);
  const head = { ...m.receipt, actorId: actor, commandFingerprint: commandHash };
  const detail = await parseCycleIntentResult(m.result({ kind: "detail", intent, head }, null, actor), query, actor);
  const delegateScope = { siteId: query.siteId, actorEmployeeId: cycleId(71), expectedAuthUserId: actor, grantId: cycleId(70), workerId: intent.workerId,
    targetEmployeeId: intent.employeeId, targetAuthUserId: intent.employeeAuthUserId, authorizedFromDate: "2026-10-01", authorizedThroughDate: "2026-10-31" };
  const c = cycleSendPanelContext(detail, actor, access === "delegate" ? delegateScope : undefined), request = cycleSendPanelPreviewRequest(c);
  // Each legacy report is projected independently, not relabeled as owner.
  const wire = scheduleEvidenceWire({ query: { siteId: c.siteId, workerId: c.workerId, fromDate: c.fromDate, throughDate: c.throughDate },
    timeZone: c.timeZone, asOf: cycleReadAt, empty: true });
  wire.attendance.base.employeeId = c.employeeId;
  const report = { ...wire.attendance, access }, base = { ...report.base }; Reflect.deleteProperty(base, "asOf");
  const dayBoundaries = Array.from({ length: 7 }, (_, n) => {
    const date = new Date(Date.parse(c.fromDate + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10), range = attendanceDayUtcRange(date, c.timeZone);
    return { date, fromAt: scheduleEvidenceMicros(range.startAt), toAt: scheduleEvidenceMicros(range.endAt), skipped: false };
  });
  const canonical = { sourceVersion: "attendance-period-source-v1", siteId: c.siteId, workerId: c.workerId, employeeId: c.employeeId,
    employeeAuthUserId: c.employeeAuthUserId, timeZone: c.timeZone, fromDate: c.fromDate, throughDate: c.throughDate, fromAt: c.fromAt, toAt: c.toAt,
    dayBoundaries, context: { pendingCorrections: [], missing: [], leave: [], calendar: [], plans: { items: [], sessions: [] }, reviews: [] },
    report: { version: report.version, base, missing: [], complete: true, payrollReady: false } };
  const text = JSON.stringify(canonical), envelope = { ...canonical, sourceCanonical: canonical, sourceText: text,
    sourceFingerprint: createHash("sha256").update(text).digest("hex"), report, readAt: cycleReadAt, complete: true, blockers: [], validation: access === "owner" ? "owner_checked" : "delegate_checked" };
  // Match the real V2 server's sourceScope projection; the legacy projector
  // accepts only its exact nine-field preview query, not V2 cursor/history.
  const preview = request.access === "owner" ? projectPeriodClosureSource(envelope, parsePeriodClosureQuery({ siteId: request.query.siteId,
    access: request.query.access, workerId: request.query.workerId, fromDate: request.query.fromDate, throughDate: request.query.throughDate,
    mode: "preview", periodId: request.query.periodId, operationId: null, version: null })) : projectPeriodDelegatedSource(envelope, request.query);
  const common = { siteId: c.siteId, workerId: c.workerId, actorId: actor, readAt: cycleReadAt };
  const raw = { ok: true, moduleEnabled: true, data: { ...common, ...(access === "owner" ? { protocol: "period-closure-v2", access }
    : { protocol: "period-delegated-closure-v1", access, grantId: c.grantId, employeeId: delegateScope.actorEmployeeId, usableActions: ["view", "send"] }),
    kind: "preview", preview: { ...preview, period: null } } };
  return { detail, delegateScope, c, request, raw, source: parseCycleSendPanelSource(raw, c) };
}
