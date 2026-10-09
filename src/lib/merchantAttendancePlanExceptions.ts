import { PLAN_ADOPTION_VIEW_ERRORS } from "./merchantAttendancePlanAdoptionView";
import { hasClearPlanExceptionBasis } from "./merchantAttendancePlanClearance";
import { hasNotApplicablePlanExceptionBasis } from "./merchantAttendancePlanPosthocReview";
import { parsePlanPosthocEvidence } from "./merchantAttendancePlanPosthocEvidence";
import { parsePlanPosthocFormalSource, PLAN_POSTHOC_FORMAL_SOURCE_ERRORS } from "./merchantAttendancePlanPosthocFormalSource";
import type { PlanExceptionQuery, PlanExceptionCommand, PlanExceptionResult, PlanExceptionResponse, PlanExceptionExpectedIdentity, PlanExceptionEvidence, PlanExceptionHistoryEntry, PlanExceptionDecision, PlanExceptionReceipt, PlanExceptionReadReceipt, PlanExceptionCaseItem } from "./merchantAttendancePlanExceptionContract";
import { parseExceptionWorker, parseExceptionCandidate, parseExceptionBlockers, parseExceptionSection } from "./merchantAttendancePlanExceptionSource";
import { exact, fail, uuid, site, hash, bool, integer, optionalUuid, label, stamp, enumValue, safeTree, same, freeze } from "./merchantAttendancePlanExceptionValidation";
export { parsePlanExceptionJson } from "./merchantAttendancePlanExceptionValidation";
export type * from "./merchantAttendancePlanExceptionContract";
export const PLAN_EXCEPTION_API = "/api/merchant-enterprise/attendance/plan-exceptions";
export const PLAN_EXCEPTION_ERRORS: Readonly<Record<string, number>> = Object.freeze({ ...PLAN_ADOPTION_VIEW_ERRORS, ...PLAN_POSTHOC_FORMAL_SOURCE_ERRORS,
  attendance_work_arrangement_too_large: 422, attendance_work_arrangement_invalid: 503, attendance_work_arrangement_binding_changed: 409,
  attendance_body_too_large: 413, attendance_invalid_content_type: 415, attendance_platform_paused: 403,
  attendance_version_conflict: 409, attendance_operation_conflict: 409, attendance_period_sealed: 409,
  attendance_plan_exception_invalid: 503, attendance_plan_exception_too_large: 422,
  attendance_plan_exception_review_invalid: 503, attendance_plan_exception_review_not_found: 404,
  attendance_plan_exception_review_identity_changed: 409, attendance_plan_exception_review_source_changed: 409,
  attendance_plan_exception_review_blocked: 409, attendance_plan_exception_review_limit: 409,
  attendance_plan_exception_clearance_disabled: 403,
  attendance_plan_exception_posthoc_disabled: 403,
});
const queryKeys = ["siteId", "access", "mode", "workerId", "slotId", "operationId", "beforeAt", "beforeId"];
export function parsePlanExceptionQuery(raw: unknown): PlanExceptionQuery {
  try { const q = exact(raw, queryKeys), access = enumValue(q.access, ["owner", "self"] as const), mode = enumValue(q.mode, ["list", "detail", "recover", "decide", "note", "ack"] as const);
    const workerId = optionalUuid(q.workerId), slotId = optionalUuid(q.slotId), operationId = optionalUuid(q.operationId), beforeAt = q.beforeAt === null ? null : stamp(q.beforeAt), beforeId = optionalUuid(q.beforeId);
    if ((beforeAt === null) !== (beforeId === null) || mode !== "list" && (beforeAt !== null || workerId === null || slotId === null) || mode === "list" && (slotId !== null || operationId !== null) || ["recover", "decide", "note", "ack"].includes(mode) !== (operationId !== null) || access === "self" && mode === "decide" || access === "owner" && ["note", "ack"].includes(mode)) fail();
    return { siteId: site(q.siteId), access, mode, workerId, slotId, operationId, beforeAt, beforeId };
  } catch { return fail("attendance_invalid_request"); }
}
export function planExceptionQueryString(input: PlanExceptionQuery): string { return new URLSearchParams(Object.entries(parsePlanExceptionQuery(input)).filter((pair): pair is [string, string] => pair[1] !== null)).toString(); }
export function parsePlanExceptionHttpQuery(url: string): PlanExceptionQuery {
  try { if (typeof url !== "string" || /\s|[\u0000-\u001f\u007f-\u009f]/.test(url)) fail(); const p = new URL(url).searchParams, q: Record<string, unknown> = { workerId: null, slotId: null, operationId: null, beforeAt: null, beforeId: null };
    for (const [k, v] of p) { if (!queryKeys.includes(k) || p.getAll(k).length !== 1) fail(); q[k] = v; } return parsePlanExceptionQuery(q);
  } catch { return fail("attendance_invalid_request"); }
}
export function parsePlanExceptionCommand(input: PlanExceptionQuery, raw: unknown): PlanExceptionCommand {
  try { const q = parsePlanExceptionQuery(input); safeTree(raw, 8192);
    const mode = q.mode === "recover" ? q.access === "owner" ? "decide" : raw && typeof raw === "object" && Object.hasOwn(raw, "note") ? "note" : "ack" : q.mode;
    if (mode === "decide") { const c = exact(raw, ["operationId", "expectedRevision", "expectedFingerprint", "employeeId", "employeeAuthUserId", "outcome", "note"]);
      const command = { operationId: uuid(c.operationId), expectedRevision: integer(c.expectedRevision, 0), expectedFingerprint: hash(c.expectedFingerprint), employeeId: uuid(c.employeeId), employeeAuthUserId: uuid(c.employeeAuthUserId), outcome: enumValue(c.outcome, ["confirmed", "excused", "follow_up", "cleared", "not_applicable"] as const), note: label(c.note, 500) }; if (command.operationId !== q.operationId || ["cleared", "not_applicable"].includes(command.outcome) && command.expectedRevision < 1) fail(); return command; }
    if (mode === "note") { const c = exact(raw, ["operationId", "expectedRevision", "decisionOperationId", "note"]), command = { operationId: uuid(c.operationId), expectedRevision: integer(c.expectedRevision, 1), decisionOperationId: uuid(c.decisionOperationId), note: label(c.note, 500) }; if (command.operationId !== q.operationId) fail(); return command; }
    if (mode === "ack") { const c = exact(raw, ["operationId", "decisionOperationId"]), command = { operationId: uuid(c.operationId), decisionOperationId: uuid(c.decisionOperationId) }; if (command.operationId !== q.operationId) fail(); return command; }
    return fail();
  } catch { return fail("attendance_invalid_request"); }
}
export function parsePlanExceptionBody(raw: unknown) { try { safeTree(raw, 8192); const b = exact(raw, ["query", "command"]), query = parsePlanExceptionQuery(b.query); if (!["decide", "note", "ack"].includes(query.mode)) fail(); return { query, command: parsePlanExceptionCommand(query, b.command) }; } catch { return fail("attendance_invalid_request"); } }
const nullableStamp = (v: unknown) => v === null ? null : stamp(v);
const summaryKeys = ["operationId", "revision", "actorId", "kind", "outcome", "note", "decisionOperationId", "recordedAt"];
function history(raw: unknown): PlanExceptionHistoryEntry {
  const h = exact(raw, summaryKeys), kind = enumValue(h.kind, ["decision", "note"] as const), outcome = h.outcome === null ? null : enumValue(h.outcome, ["confirmed", "excused", "follow_up", "cleared", "not_applicable"] as const), decisionOperationId = optionalUuid(h.decisionOperationId);
  if (kind === "decision" ? outcome === null || decisionOperationId !== null : outcome !== null || decisionOperationId === null) fail();
  if ((outcome === "cleared" || outcome === "not_applicable") && integer(h.revision) <= 1) fail();
  return { operationId: uuid(h.operationId), revision: integer(h.revision), actorId: uuid(h.actorId), kind, outcome, note: label(h.note, 500), decisionOperationId, recordedAt: stamp(h.recordedAt) };
}
function select(raw: Record<string, unknown>, keys: readonly string[]) { return Object.fromEntries(keys.map(k => [k, raw[k]])); }
function evidence(raw: unknown): PlanExceptionEvidence {
  if ((raw as { policy?: unknown } | null)?.policy === "owner-confirmed-plan-edges-posthoc-v3") return parsePlanPosthocEvidence(raw);
  const e = exact(raw, ["policy", "fingerprint", "observedAt", "eligible", "blockers", "candidate", "approval", "sessions", "contextRefs"]);
  const hasWork = e.policy === "owner-confirmed-plan-edges-work-v2";
  if (!hasWork && e.policy !== "owner-confirmed-plan-edges-v1") fail(); const eligible = bool(e.eligible), blockers = parseExceptionBlockers(e.blockers), candidate = parseExceptionCandidate(e.candidate);
  if (eligible !== (blockers.length === 0) || (candidate.late.state === "blocked") !== !eligible || (candidate.early.state === "blocked") !== !eligible) fail();
  let approval: PlanExceptionEvidence["approval"] = null;
  if (e.approval !== null) { const p = exact(e.approval, ["operationId", "revision", "sourceId", "sourceSha256", "recordedAt"]); approval = { operationId: uuid(p.operationId), revision: integer(p.revision), sourceId: uuid(p.sourceId), sourceSha256: hash(p.sourceSha256), recordedAt: stamp(p.recordedAt) }; }
  const sessionRef = (v: unknown) => { const p = exact(v, ["startEventId", "lastEventId", "lastSequence", "effectOperationId"]); return { startEventId: uuid(p.startEventId), lastEventId: uuid(p.lastEventId), lastSequence: integer(p.lastSequence), effectOperationId: optionalUuid(p.effectOperationId) }; };
  const ref = (v: unknown) => { const p = exact(v, ["requestId", "operationId", "revision"]); return { requestId: uuid(p.requestId), operationId: uuid(p.operationId), revision: integer(p.revision) }; };
  if (!Array.isArray(e.sessions) || e.sessions.length > 10) return fail(); const sessions = e.sessions.map(sessionRef); if (new Set(sessions.map(s => s.startEventId)).size !== sessions.length) fail();
  const c = exact(e.contextRefs, ["unassociated", "leave", "calendar", "missing", "pendingCorrections", ...(hasWork ? ["workArrangements"] : [])]);
  const contextRefs = { unassociated: parseExceptionSection(c.unassociated, sessionRef, p => p.startEventId), leave: parseExceptionSection(c.leave, ref, p => p.requestId), missing: parseExceptionSection(c.missing, ref, p => p.requestId),
    calendar: parseExceptionSection(c.calendar, v => { const p = exact(v, ["entryId", "operationId", "revision"]); return { entryId: uuid(p.entryId), operationId: uuid(p.operationId), revision: integer(p.revision) }; }, p => p.entryId),
    pendingCorrections: parseExceptionSection(c.pendingCorrections, v => { const p = exact(v, ["requestId", "operationId", "revision", "kind", "startEventId"]); return { ...ref(select(p, ["requestId", "operationId", "revision"])), kind: enumValue(p.kind, ["correction", "revision"] as const), startEventId: uuid(p.startEventId) }; }, p => p.kind + p.requestId) };
  const workArrangements = hasWork ? parseExceptionSection(c.workArrangements, ref, p => p.requestId) : undefined;
  if (workArrangements && (workArrangements.limited || !workArrangements.items.length)) fail();
  return { policy: hasWork ? "owner-confirmed-plan-edges-work-v2" : "owner-confirmed-plan-edges-v1", fingerprint: hash(e.fingerprint), observedAt: stamp(e.observedAt), eligible, blockers, candidate, approval, sessions, contextRefs: { ...contextRefs, ...(workArrangements ? { workArrangements } : {}) } };
}
function decision(raw: unknown): PlanExceptionDecision | null {
  if (raw === null) return null; const d = exact(raw, [...summaryKeys, "evidence", "readAt"]), h = history(select(d, summaryKeys)); if (h.kind !== "decision" || h.outcome === null || h.decisionOperationId !== null) return fail();
  const basis = evidence(d.evidence); if (h.outcome === "not_applicable" ? !hasNotApplicablePlanExceptionBasis(basis) : h.outcome === "cleared" ? !hasClearPlanExceptionBasis(basis) : h.outcome !== "follow_up" && (!basis.eligible || ![basis.candidate.late.state, basis.candidate.early.state].includes("triggered"))) fail();
  return { ...h, kind: "decision", outcome: h.outcome, decisionOperationId: null, evidence: basis, readAt: nullableStamp(d.readAt) };
}
function caseItem(raw: unknown): PlanExceptionCaseItem {
  const i = exact(raw, ["caseId", "workerId", "slotId", "employeeId", "employeeAuthUserId", "workerName", "workerNo", "slotStartAt", "slotEndAt", "timeZone", "openedAt", "revision", "latestDecision"]), d = exact(i.latestDecision, ["operationId", "revision", "outcome", "recordedAt", "readAt"]);
  if (stamp(i.slotEndAt, 3) <= stamp(i.slotStartAt, 3) || Date.parse(i.slotEndAt as string) - Date.parse(i.slotStartAt as string) > 86400000) fail();
  if ((d.outcome === "cleared" || d.outcome === "not_applicable") && (integer(d.revision) <= 1 || d.operationId === i.caseId)) fail();
  return { caseId: uuid(i.caseId), workerId: uuid(i.workerId), slotId: uuid(i.slotId), employeeId: uuid(i.employeeId), employeeAuthUserId: uuid(i.employeeAuthUserId), workerName: label(i.workerName), workerNo: label(i.workerNo, 40), slotStartAt: stamp(i.slotStartAt, 3), slotEndAt: stamp(i.slotEndAt, 3), timeZone: label(i.timeZone, 100), openedAt: stamp(i.openedAt), revision: integer(i.revision), latestDecision: { operationId: uuid(d.operationId), revision: integer(d.revision, 1, integer(i.revision)), outcome: enumValue(d.outcome, ["confirmed", "excused", "follow_up", "cleared", "not_applicable"] as const), recordedAt: stamp(d.recordedAt), readAt: nullableStamp(d.readAt) } };
}
export function parsePlanExceptionResult(raw: unknown, input: PlanExceptionQuery, expected: PlanExceptionExpectedIdentity, command: PlanExceptionCommand | null = null): PlanExceptionResult {
  try { const q = parsePlanExceptionQuery(input); safeTree(raw); const v = exact(raw, ["protocol", "siteId", "access", "actorId", "employeeId", "readAt", "items", "nextCursor", "detail", "receipt", "readReceipt"]);
    const actorId = uuid(v.actorId), employeeId = optionalUuid(v.employeeId), readAt = stamp(v.readAt);
    if (v.protocol !== "plan-exception-review-v1" || v.siteId !== q.siteId || v.access !== q.access || (q.access === "owner") !== (employeeId === null) || expected.authUserId !== undefined && actorId !== uuid(expected.authUserId) || expected.ownerId !== undefined && (q.access !== "owner" || actorId !== uuid(expected.ownerId)) || expected.employeeId !== undefined && (q.access !== "self" || employeeId !== uuid(expected.employeeId))) fail();
    if (!Array.isArray(v.items) || v.items.length > 25) return fail(); const items = v.items.map(caseItem); let previous: { at: string; id: string } | null = q.beforeAt ? { at: q.beforeAt, id: q.beforeId! } : null;
    for (const item of items) { if (previous && (item.openedAt > previous.at || item.openedAt === previous.at && item.caseId >= previous.id) || q.workerId !== null && item.workerId !== q.workerId || q.access === "self" && (item.employeeId !== employeeId || item.employeeAuthUserId !== actorId) || item.openedAt > readAt || item.latestDecision.recordedAt < item.openedAt || item.latestDecision.recordedAt > readAt || item.latestDecision.readAt !== null && (item.latestDecision.readAt < item.latestDecision.recordedAt || item.latestDecision.readAt > readAt) || item.latestDecision.revision === 1 && item.latestDecision.operationId !== item.caseId) fail(); previous = { at: item.openedAt, id: item.caseId }; }
    let nextCursor: PlanExceptionResult["nextCursor"] = null;
    if (v.nextCursor !== null) { const c = exact(v.nextCursor, ["at", "id"]); nextCursor = { at: stamp(c.at), id: uuid(c.id) }; if (items.length !== 25 || !same(nextCursor, previous)) fail(); }
    let detail: PlanExceptionResult["detail"] = null;
    if (v.detail !== null) { const d = exact(v.detail, ["caseId", "openedAt", "worker", "slotId", "revision", "current", "currentValidation", "stale", "latestDecision", "history", "historyTruncated", "canDecide", "canNote"]), worker = parseExceptionWorker(d.worker), slotId = uuid(d.slotId), revision = integer(d.revision, 0), caseId = optionalUuid(d.caseId), openedAt = nullableStamp(d.openedAt);
      if (worker.workerId !== q.workerId || slotId !== q.slotId || q.access === "self" && (worker.employeeId !== employeeId || worker.employeeAuthUserId !== actorId) || (caseId === null) !== (revision === 0) || (caseId === null) !== (openedAt === null)) fail();
      const currentValidation = enumValue(d.currentValidation, ["checked", "not_checked"] as const), current = d.current === null ? null : parsePlanPosthocFormalSource(d.current, { siteId: q.siteId, workerId: worker.workerId, slotId }, actorId), latestDecision = decision(d.latestDecision), stale = d.stale === null ? null : bool(d.stale);
      if ((current !== null) !== (currentValidation === "checked") || q.access === "self" && (current !== null || stale !== null) || current === null && stale !== null || current && stale !== (latestDecision === null ? null : latestDecision.evidence.fingerprint !== current.fingerprint) || q.access === "owner" && q.mode === "detail" && current === null || openedAt !== null && openedAt > readAt || current && current.readAt > readAt) fail();
      if (current && !same(current.worker, worker) || latestDecision && latestDecision.revision > revision || revision > 0 && !latestDecision) fail();
      if (!Array.isArray(d.history) || d.history.length > 25) return fail(); const entries = d.history.map(history), historyTruncated = bool(d.historyTruncated); let rev = revision + 1;
      if (new Set(entries.map(h => h.operationId)).size !== entries.length) fail();
      let later = readAt;
      for (const entry of entries) { if (entry.revision !== rev - 1 || entry.recordedAt > later || openedAt !== null && entry.recordedAt < openedAt || entry.kind === "note" && entry.actorId !== worker.employeeAuthUserId || entry.kind === "decision" && entry.actorId === worker.employeeAuthUserId || entry.revision === 1 && (entry.kind !== "decision" || entry.operationId !== caseId || entry.recordedAt !== openedAt)) fail(); rev = entry.revision; later = entry.recordedAt; } if (historyTruncated !== (rev > 1) || entries.length !== Math.min(25, revision)) fail();
      if (latestDecision) {
        if (latestDecision.evidence.policy === "owner-confirmed-plan-edges-posthoc-v3") parsePlanPosthocEvidence(latestDecision.evidence, { slotId, employeeId: worker.employeeId, employeeAuthUserId: worker.employeeAuthUserId });
        if (latestDecision.recordedAt > readAt || openedAt !== null && latestDecision.recordedAt < openedAt || latestDecision.actorId === worker.employeeAuthUserId || latestDecision.evidence.observedAt > latestDecision.recordedAt || latestDecision.readAt !== null && (latestDecision.readAt < latestDecision.recordedAt || latestDecision.readAt > readAt)) fail();
        const visible = entries.find(h => h.revision === latestDecision.revision), newestVisible = entries.find(h => h.kind === "decision");
        if (visible && !same(visible, select(latestDecision, summaryKeys)) || newestVisible && newestVisible.operationId !== latestDecision.operationId || latestDecision.revision >= rev && !visible || latestDecision.revision === 1 && latestDecision.operationId !== caseId) fail();
      }
      const canDecide = bool(d.canDecide), canNote = bool(d.canNote); if (canDecide && (q.access !== "owner" || current === null) || canNote && (q.access !== "self" || !latestDecision)) fail();
      detail = { caseId, openedAt, worker, slotId, revision, current, currentValidation, stale, latestDecision, history: entries, historyTruncated, canDecide, canNote };
    }
    if (q.mode === "list" ? detail !== null : items.length !== 0 || nextCursor !== null) fail();
    if (["detail", "decide", "note", "ack"].includes(q.mode) && !detail) fail();
    let receipt: PlanExceptionReceipt | null = null;
    if (v.receipt !== null) { const r = exact(v.receipt, ["operationId", "command", "item"]), operationId = uuid(r.operationId), c = parsePlanExceptionCommand({ ...q, mode: "recover", operationId }, r.command), i = exact(r.item, [...summaryKeys, "evidence"]), item = history(select(i, summaryKeys)), basis = i.evidence === null ? null : evidence(i.evidence);
      if (!("note" in c) || operationId !== q.operationId || item.operationId !== operationId || item.actorId !== actorId || item.note !== c.note || item.revision !== c.expectedRevision + 1 || (item.kind === "decision") !== (basis !== null) || command !== null && !same(c, parsePlanExceptionCommand(q, command))) fail();
      if (!detail || item.revision > detail.revision || item.recordedAt > readAt || detail.openedAt !== null && item.recordedAt < detail.openedAt) fail();
      if ("outcome" in c ? item.outcome !== c.outcome || basis?.fingerprint !== c.expectedFingerprint || c.employeeId !== detail!.worker.employeeId || c.employeeAuthUserId !== detail!.worker.employeeAuthUserId : item.decisionOperationId !== c.decisionOperationId) fail();
      if (basis?.policy === "owner-confirmed-plan-edges-posthoc-v3") {
        if (detail === null) return fail();
        parsePlanPosthocEvidence(basis, { slotId: detail.slotId, employeeId: detail.worker.employeeId, employeeAuthUserId: detail.worker.employeeAuthUserId });
      }
      if ("outcome" in c && (c.outcome === "not_applicable" ? !basis || !hasNotApplicablePlanExceptionBasis(basis) : c.outcome === "cleared" ? !basis || !hasClearPlanExceptionBasis(basis) : c.outcome !== "follow_up" && (!basis?.eligible || ![basis.candidate.late.state, basis.candidate.early.state].includes("triggered")))) fail();
      if (detail!.latestDecision?.operationId === operationId && !same(detail!.latestDecision.evidence, basis)) fail();
      const visible = detail!.history.find(h => h.revision === item.revision); if (visible && !same(visible, item) || item.revision >= (detail!.history.at(-1)?.revision ?? 0) && !visible || item.revision === 1 && item.operationId !== detail!.caseId || basis && basis.observedAt > item.recordedAt) fail();
      if (!("note" in c)) return fail();
      receipt = { operationId, command: c, item: { ...item, evidence: basis } };
    }
    let readReceipt: PlanExceptionReadReceipt | null = null;
    if (v.readReceipt !== null) { const r = exact(v.readReceipt, ["operationId", "command", "decisionOperationId", "actorId", "employeeId", "employeeAuthUserId", "readAt"]), c = parsePlanExceptionCommand({ ...q, mode: "recover" }, r.command);
      if ("note" in c || q.access !== "self" || r.operationId !== q.operationId || r.actorId !== actorId || r.employeeId !== employeeId || r.employeeAuthUserId !== actorId || r.decisionOperationId !== c.decisionOperationId || command && !same(c, parsePlanExceptionCommand(q, command))) fail();
      if ("note" in c) return fail();
      readReceipt = { operationId: uuid(r.operationId), command: c, decisionOperationId: uuid(r.decisionOperationId), actorId, employeeId: uuid(r.employeeId), employeeAuthUserId: actorId, readAt: stamp(r.readAt) };
    }
    if (receipt && readReceipt || ["list", "detail"].includes(q.mode) && (receipt || readReceipt) || ["decide", "note"].includes(q.mode) && !receipt || q.mode === "ack" && !readReceipt || q.access === "owner" && q.mode === "decide" && detail?.current === null && !receipt) fail();
    if (readReceipt) {
      if (!detail || readReceipt.readAt > readAt || detail.latestDecision?.operationId === readReceipt.decisionOperationId && detail.latestDecision.readAt !== readReceipt.readAt) fail();
      const target = detail!.history.find(h => h.operationId === readReceipt!.decisionOperationId);
      if (target && (target.kind !== "decision" || readReceipt.readAt < target.recordedAt)) fail();
    }
    return freeze({ protocol: "plan-exception-review-v1", siteId: q.siteId, access: q.access, actorId, employeeId, readAt, items, nextCursor, detail, receipt, readReceipt });
  } catch { return fail("attendance_plan_exception_review_invalid"); }
}
export function parsePlanExceptionResponse(raw: unknown, query: PlanExceptionQuery, expected: PlanExceptionExpectedIdentity, command: PlanExceptionCommand | null = null): PlanExceptionResponse {
  try { safeTree(raw); const v = exact(raw, ["ok", "moduleEnabled", "data"]); if (v.ok !== true) fail(); const result = parsePlanExceptionResult(v.data, query, expected, command), moduleEnabled = bool(v.moduleEnabled); if (!moduleEnabled && (result.detail?.canDecide || result.detail?.canNote)) fail(); return freeze({ ...result, moduleEnabled }); } catch { return fail("attendance_plan_exception_review_invalid"); }
}
