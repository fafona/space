// Browser-safe validation: SQL owns authorization/completeness, this consumer
// rejects malformed evidence and independently recomputes the exact edge math.
import { PLAN_EXCEPTION_BLOCKERS, type PlanExceptionSourceResult, type PlanExceptionSourceQuery, type PlanExceptionSource, type PlanExceptionCandidate, type PlanExceptionCandidateField, type PlanExceptionEndpoints, type PlanExceptionSection, type PlanExceptionApproval } from "./merchantAttendancePlanExceptionSourceContract";
import type { SelfScheduleSlot } from "./merchantAttendanceSelfSchedule";
import type { ShiftRuleBindingWorker } from "./merchantAttendanceShiftRuleBinding";
import type { PlanRuleApprovalsRules, PlanRuleApprovalsSource, PlanRuleApprovalsPublication } from "./merchantAttendancePlanRuleApprovals";
import { parseWorkArrangementContextItem } from "./merchantAttendanceWorkArrangement";
import { exact, fail, uuid, site, hash, bool, integer, optionalUuid, label, stamp, day, micros, enumValue, safeTree, same, freeze } from "./merchantAttendancePlanExceptionValidation";
export type { PlanExceptionSourceResult } from "./merchantAttendancePlanExceptionSourceContract";

export function parseExceptionWorker(raw: unknown): ShiftRuleBindingWorker {
  const w = exact(raw, ["workerId", "workerName", "workerNo", "employeeId", "employeeAuthUserId", "version", "active", "employeeActive"]);
  return { workerId: uuid(w.workerId), workerName: label(w.workerName), workerNo: label(w.workerNo, 40), employeeId: uuid(w.employeeId), employeeAuthUserId: uuid(w.employeeAuthUserId), version: integer(w.version), active: bool(w.active), employeeActive: bool(w.employeeActive) };
}
export function parseExceptionSlot(raw: unknown): SelfScheduleSlot {
  const s = exact(raw, ["id", "revision", "locationId", "locationName", "timeZone", "workDate", "startAt", "endAt", "cancelled", "hasPublicationEvidence"]), startAt = stamp(s.startAt, 3), endAt = stamp(s.endAt, 3);
  if (micros(endAt) <= micros(startAt) || micros(endAt) - micros(startAt) > BigInt(86400000000) || Date.parse(startAt) % 60000 || Date.parse(endAt) % 60000) fail();
  return { id: uuid(s.id), revision: integer(s.revision), locationId: uuid(s.locationId), locationName: label(s.locationName), timeZone: label(s.timeZone, 100), workDate: day(s.workDate), startAt, endAt, cancelled: bool(s.cancelled), hasPublicationEvidence: bool(s.hasPublicationEvidence) };
}
export function parseExceptionEndpoints(raw: unknown): PlanExceptionEndpoints {
  const e = exact(raw, ["startAt", "endAt"]); const startAt = e.startAt === null ? null : stamp(e.startAt), endAt = e.endAt === null ? null : stamp(e.endAt);
  if (endAt && (!startAt || micros(endAt) < micros(startAt))) fail(); return { startAt, endAt };
}
function effect(raw: unknown) {
  if (raw === null) return null; const e = exact(raw, ["requestId", "operationId", "revision", "recordedAt", "rootRequestId", "previousOperationId"]);
  const result = { requestId: uuid(e.requestId), operationId: uuid(e.operationId), revision: integer(e.revision), recordedAt: stamp(e.recordedAt), rootRequestId: uuid(e.rootRequestId), previousOperationId: optionalUuid(e.previousOperationId) };
  if (result.revision === 1 ? result.previousOperationId !== null || result.requestId !== result.rootRequestId : result.previousOperationId === null || result.requestId === result.rootRequestId) fail();
  return result;
}
export function parseExceptionBlockers(raw: unknown) {
  if (!Array.isArray(raw) || raw.length > PLAN_EXCEPTION_BLOCKERS.length || new Set(raw).size !== raw.length) return fail();
  let last = -1; return raw.map(b => { const value = enumValue(b, PLAN_EXCEPTION_BLOCKERS), i = PLAN_EXCEPTION_BLOCKERS.indexOf(value); if (i <= last) fail(); last = i; return value; });
}
export function parseExceptionCandidate(raw: unknown): PlanExceptionCandidate {
  const c = exact(raw, ["late", "early", "original", "selected"]);
  const field = (raw: unknown): PlanExceptionCandidateField => { const f = exact(raw, ["state", "minutes", "rawDeltaUs", "excessUs"]), state = enumValue(f.state, ["blocked", "unconfigured", "disabled", "triggered", "not_triggered"] as const);
    const minutes = f.minutes === null ? null : integer(f.minutes, 0, 1440);
    const us = (v: unknown, signed: boolean) => { if (v === null) return null; if (typeof v !== "string" || v.length > 20 || !(signed ? /^(?:0|-?[1-9]\d*)$/ : /^(?:0|[1-9]\d*)$/).test(v)) return fail(); return v; };
    const rawDeltaUs = us(f.rawDeltaUs, true), excessUs = us(f.excessUs, false), calculated = state === "triggered" || state === "not_triggered";
    if (calculated ? minutes === null || rawDeltaUs === null || excessUs === null : minutes !== null || rawDeltaUs !== null || excessUs !== null) fail();
    if (calculated) { const delta = BigInt(rawDeltaUs!) - BigInt(minutes!) * BigInt(60000000); if (state !== (delta > BigInt(0) ? "triggered" : "not_triggered") || excessUs !== (delta > BigInt(0) ? delta : BigInt(0)).toString()) fail(); }
    return { state, minutes, rawDeltaUs, excessUs }; };
  return { late: field(c.late), early: field(c.early), original: parseExceptionEndpoints(c.original), selected: parseExceptionEndpoints(c.selected) };
}
export function parseExceptionSection<T>(raw: unknown, parse: (v: unknown) => T, key: (v: T) => string): PlanExceptionSection<T> {
  const s = exact(raw, ["limited", "items"]), limited = bool(s.limited);
  if (!Array.isArray(s.items) || s.items.length > 100 || limited && s.items.length) return fail();
  let previous = ""; const items = s.items.map(v => { const item = parse(v), current = key(item); if (current <= previous) fail(); previous = current; return item; }); return { limited, items };
}
function sessionEdges(value: Pick<PlanExceptionSource["sessions"][number], "startEventId" | "lastEventId" | "original" | "selected" | "effect">) {
  const { original, selected, effect } = value;
  if (original.startAt === null || selected.startAt === null) return fail();
  if (original.endAt !== null && (value.lastEventId === value.startEventId || micros(original.endAt) - micros(original.startAt) > BigInt(2678400000000))) fail();
  if (effect === null) { if (!same(original, selected)) fail(); }
  else if (original.endAt === null || selected.endAt === null || micros(selected.endAt) <= micros(selected.startAt)
    || micros(selected.endAt) - micros(selected.startAt) > BigInt(2678400000000)
    || micros(effect.recordedAt) < micros(original.endAt) || micros(effect.recordedAt) < micros(selected.endAt)) fail();
}
function ruleChoices(raw: unknown): PlanRuleApprovalsRules {
  const v = exact(raw, ["lateGraceMinutes", "earlyGraceMinutes"]), result = {} as PlanRuleApprovalsRules;
  for (const key of ["lateGraceMinutes", "earlyGraceMinutes"] as const) {
    const candidate = v[key] as { mode?: unknown } | null;
    const choice = exact(candidate, candidate?.mode === "value" ? ["mode", "minutes"] : ["mode"]);
    const mode = enumValue(choice.mode, ["inherit", "disabled", "value"] as const);
    result[key] = mode === "value" ? { mode, minutes: integer(choice.minutes, 0, 1440) } : { mode };
  }
  return result;
}
function savedPublication(raw: unknown, head: number, recordedAt: string, planStart: string): PlanRuleApprovalsPublication | null {
  if (raw === null) return null;
  const p = exact(raw, ["operationId", "revision", "actorId", "recordedAt", "effectiveAt", "rules"]);
  const result = { operationId: uuid(p.operationId), revision: integer(p.revision, 2, head), actorId: uuid(p.actorId), recordedAt: stamp(p.recordedAt), effectiveAt: stamp(p.effectiveAt, 3), rules: ruleChoices(p.rules) };
  if (micros(result.recordedAt) > micros(recordedAt) || micros(result.recordedAt) >= micros(result.effectiveAt) || micros(result.effectiveAt) > micros(planStart)) fail();
  return result;
}
function approval(raw: unknown, source: Pick<PlanExceptionSource, "siteId" | "worker" | "slot">): PlanExceptionApproval | null {
  if (raw === null) return null; const a = exact(raw, ["operationId", "revision", "sourceId", "sourceSha256", "recordedAt", "source"]);
  const recordedAt = stamp(a.recordedAt);
  if (!source.slot.hasPublicationEvidence || micros(recordedAt) >= micros(source.slot.startAt)) fail();
  safeTree(a.source, 32768);
  const p = exact(a.source, ["protocol", "policy", "siteId", "workerId", "employeeId", "employeeAuthUserId", "workerVersion", "settingsVersion", "timeZone", "slot", "assignment", "enterprise", "group", "personal", "fields"]);
  if (p.protocol !== "plan-rule-point-v1" || p.policy !== "owner-approved-plan-start-v1" || p.siteId !== source.siteId || p.workerId !== source.worker.workerId || p.employeeId !== source.worker.employeeId || p.employeeAuthUserId !== source.worker.employeeAuthUserId) fail();
  integer(p.workerVersion, 1, source.worker.version); integer(p.settingsVersion); label(p.timeZone, 100);
  const slot = exact(p.slot, ["id", "revision", "locationId", "locationVersion", "timeZone", "startAt", "endAt"]); integer(slot.locationVersion);
  for (const key of ["id", "revision", "locationId", "timeZone", "startAt", "endAt"] as const) if (slot[key] !== source.slot[key]) fail();
  const enterpriseRaw = exact(p.enterprise, ["revision", "publication"]), enterpriseRevision = integer(enterpriseRaw.revision, 0);
  const enterprise = { revision: enterpriseRevision, publication: savedPublication(enterpriseRaw.publication, enterpriseRevision, recordedAt, source.slot.startAt) };
  let assignment: PlanRuleApprovalsSource["assignment"] = null, group: PlanRuleApprovalsSource["group"] = null;
  if ((p.assignment === null) !== (p.group === null)) fail();
  if (p.assignment !== null) {
    const ar = exact(p.assignment, ["assignmentId", "revision", "groupId", "groupName", "groupRevision", "employeeId", "timeZone", "fromAt", "toAt"]);
    const gr = exact(p.group, ["groupId", "revision", "publication"]), groupId = uuid(ar.groupId), revision = integer(gr.revision, 0);
    const fromAt = stamp(ar.fromAt), toAt = ar.toAt === null ? null : stamp(ar.toAt);
    if (gr.groupId !== groupId || ar.employeeId !== source.worker.employeeId || micros(fromAt) > micros(source.slot.startAt) || toAt !== null && micros(toAt) <= micros(source.slot.startAt)) fail();
    assignment = { assignmentId: uuid(ar.assignmentId), revision: integer(ar.revision, 1, 2), groupId, groupName: label(ar.groupName, 80), groupRevision: integer(ar.groupRevision), employeeId: uuid(ar.employeeId), timeZone: label(ar.timeZone, 100), fromAt, toAt };
    group = { groupId, revision, publication: savedPublication(gr.publication, revision, recordedAt, source.slot.startAt) };
  }
  const personalRaw = exact(p.personal, ["revision", "approval"]), personalRevision = integer(personalRaw.revision, 0);
  let personalApproval: PlanRuleApprovalsSource["personal"]["approval"] = null;
  if (personalRaw.approval !== null) {
    const ap = exact(personalRaw.approval, ["operationId", "revision", "actorId", "recordedAt", "fromAt", "toAt", "rules"]);
    const fromAt = stamp(ap.fromAt, 3), toAt = stamp(ap.toAt, 3), savedAt = stamp(ap.recordedAt);
    if (micros(savedAt) > micros(recordedAt) || micros(savedAt) >= micros(fromAt) || micros(fromAt) > micros(source.slot.startAt) || micros(toAt) <= micros(source.slot.startAt)) fail();
    personalApproval = { operationId: uuid(ap.operationId), revision: integer(ap.revision, 1, personalRevision), actorId: uuid(ap.actorId), recordedAt: savedAt, fromAt, toAt, rules: ruleChoices(ap.rules) };
  }
  const personal = { revision: personalRevision, approval: personalApproval };
  const fields = exact(p.fields, ["lateGraceMinutes", "earlyGraceMinutes"]), normalizedFields = {} as PlanRuleApprovalsSource["fields"];
  for (const key of ["lateGraceMinutes", "earlyGraceMinutes"] as const) {
    const expected: PlanRuleApprovalsSource["fields"][typeof key] = { state: "unconfigured", minutes: null, source: null, trace: [] };
    for (const layer of ["personal", "group", "enterprise"] as const) {
      const part = { personal, group, enterprise }[layer], item = layer === "personal" ? personal.approval : layer === "group" ? group?.publication : enterprise.publication;
      const groupId = layer === "group" ? group?.groupId ?? null : null, ledgerRevision = part?.revision ?? null, choice = item?.rules[key];
      const provenance = item ? { layer, groupId, ledgerRevision: ledgerRevision!, operationId: item.operationId, revision: item.revision, actorId: item.actorId } : null;
      const mode = choice?.mode ?? (layer === "personal" ? "missing_approval" : layer === "group" && group === null ? "no_assignment" : "missing_publication"), minutes = choice?.mode === "value" ? choice.minutes : null;
      expected.trace.push({ layer, groupId, ledgerRevision, mode, minutes, source: provenance });
      if (expected.state === "unconfigured" && (mode === "value" || mode === "disabled")) { expected.state = mode; expected.minutes = minutes; expected.source = provenance; }
    }
    // Exact equality recursively rejects extra trace/provenance keys and requires
    // both fields to refer to the same actual saved publications and ledger heads.
    if (!same(fields[key], expected)) fail(); normalizedFields[key] = expected;
  }
  const saved: PlanRuleApprovalsSource = { protocol: "plan-rule-point-v1", policy: "owner-approved-plan-start-v1", siteId: source.siteId,
    workerId: source.worker.workerId, employeeId: source.worker.employeeId!, employeeAuthUserId: source.worker.employeeAuthUserId!, workerVersion: integer(p.workerVersion, 1, source.worker.version), settingsVersion: integer(p.settingsVersion), timeZone: label(p.timeZone, 100),
    slot: { id: source.slot.id, revision: source.slot.revision, locationId: source.slot.locationId, locationVersion: integer(slot.locationVersion), timeZone: source.slot.timeZone, startAt: source.slot.startAt, endAt: source.slot.endAt }, assignment, enterprise, group, personal, fields: normalizedFields };
  return { operationId: uuid(a.operationId), revision: integer(a.revision), sourceId: uuid(a.sourceId), sourceSha256: hash(a.sourceSha256), recordedAt, source: saved };
}
function readSource(raw: unknown, q: PlanExceptionSourceQuery): PlanExceptionSource {
  const s = exact(raw, ["protocol", "policy", "siteId", "worker", "slot", "phase", "approval", "sessions", "context"]), worker = parseExceptionWorker(s.worker), slot = parseExceptionSlot(s.slot);
  const hasWork = s.protocol === "plan-exception-evidence-v2";
  if ((!hasWork && s.protocol !== "plan-exception-evidence-v1") || s.policy !== (hasWork ? "owner-confirmed-plan-edges-work-v2" : "owner-confirmed-plan-edges-v1") || s.siteId !== q.siteId || worker.workerId !== q.workerId || slot.id !== q.slotId) fail();
  const phase = enumValue(s.phase, ["future", "ongoing", "ended"] as const);
  if (!Array.isArray(s.sessions) || s.sessions.length > 10) return fail();
  let previous = "";
  const sessions = s.sessions.map(raw => { const p = exact(raw, ["startEventId", "operationId", "lastEventId", "lastSequence", "relation", "adoption", "original", "selected", "effect"]);
    const startEventId = uuid(p.startEventId), operationId = uuid(p.operationId); if (startEventId <= previous) fail(); previous = startEventId;
    const r = exact(p.relation, ["startEventId", "operationId", "selection", "status", "reason", "slot", "observedRevision", "recordedAt", "currentCancelled"]);
    if (r.startEventId !== startEventId || r.operationId !== operationId) fail(); enumValue(r.status, ["linked", "unverified"]); integer(r.observedRevision, slot.revision); stamp(r.recordedAt);
    const selection = exact(r.selection, ["slotId", "revision"]);
    if (selection.slotId !== q.slotId || selection.revision !== slot.revision) fail();
    const saved = parseExceptionSlot(r.slot);
    if (!same({ ...saved, cancelled: slot.cancelled }, slot) || saved.cancelled && !slot.cancelled || r.currentCancelled !== slot.cancelled) fail();
    if (r.reason !== null) enumValue(r.reason, ["publication_missing", "cancelled", "location_changed", "outside_window"]);
    if (r.status === "linked" ? r.reason !== null || saved.cancelled || !saved.hasPublicationEvidence
      : r.reason === null || (r.reason === "cancelled") !== saved.cancelled || r.reason === "publication_missing" && saved.hasPublicationEvidence) fail();
    if (p.adoption !== null) { const a = exact(p.adoption, ["startEventId", "operationId", "channel", "employeeId", "employeeAuthUserId", "status", "reason", "approval", "recordedAt", "policy"]);
      if (a.startEventId !== startEventId || a.operationId !== operationId || a.employeeId !== worker.employeeId || a.employeeAuthUserId !== worker.employeeAuthUserId || a.policy !== "explicit-plan-approval-at-clock-in-v1") fail();
      enumValue(a.channel, ["self", "location", "onsite", "pin"]); enumValue(a.status, ["adopted", "not_approved", "unverified"]); stamp(a.recordedAt);
      if (a.recordedAt !== r.recordedAt || (a.status === "adopted" ? r.status !== "linked" || a.reason !== null || a.approval === null
        : a.status === "not_approved" ? r.status !== "linked" || a.reason !== "approval_missing" || a.approval !== null
          : r.status !== "unverified" || a.reason !== r.reason || a.approval !== null)) fail();
      if (a.approval !== null) { const ar = exact(a.approval, ["operationId", "revision", "sourceId", "sourceSha256", "recordedAt"]); uuid(ar.operationId); integer(ar.revision); uuid(ar.sourceId); hash(ar.sourceSha256); stamp(ar.recordedAt); }
    }
    const result = { startEventId, operationId, lastEventId: uuid(p.lastEventId), lastSequence: integer(p.lastSequence), relation: p.relation as PlanExceptionSource["sessions"][number]["relation"], adoption: p.adoption as PlanExceptionSource["sessions"][number]["adoption"], original: parseExceptionEndpoints(p.original), selected: parseExceptionEndpoints(p.selected), effect: effect(p.effect) };
    sessionEdges(result); return result;
  });
  const c = exact(s.context, ["unassociated", "leave", "calendar", "missing", "pendingCorrections", ...(hasWork ? ["workArrangements"] : [])]);
  const workArrangements = hasWork ? parseExceptionSection(c.workArrangements, parseWorkArrangementContextItem, p => p.requestId) : undefined;
  if (workArrangements && (workArrangements.limited || !workArrangements.items.length)) fail();
  for (const item of workArrangements?.items ?? []) if (item.workerId !== worker.workerId || item.employeeId !== worker.employeeId || item.employeeAuthUserId !== worker.employeeAuthUserId
    || micros(item.startAt) >= micros(slot.endAt) || micros(item.endAt) <= micros(slot.startAt)) fail();
  const requestBase = (v: Record<string, unknown>, precision: 3 | 6, maxRevision: number) => { const startAt = stamp(v.startAt, precision), endAt = stamp(v.endAt, precision); if (micros(endAt) <= micros(startAt)) fail(); return { requestId: uuid(v.requestId), operationId: uuid(v.operationId), revision: integer(v.revision, 1, maxRevision), startAt, endAt, recordedAt: stamp(v.recordedAt) }; };
  const unassociated = parseExceptionSection(c.unassociated, raw => { const p = exact(raw, ["startEventId", "operationId", "lastEventId", "lastSequence", "relationSlotId", "original", "selected", "effect"]); const result = { startEventId: uuid(p.startEventId), operationId: uuid(p.operationId), lastEventId: uuid(p.lastEventId), lastSequence: integer(p.lastSequence), relationSlotId: optionalUuid(p.relationSlotId), original: parseExceptionEndpoints(p.original), selected: parseExceptionEndpoints(p.selected), effect: effect(p.effect) }; sessionEdges(result); return result; }, p => p.startEventId);
  const leave = parseExceptionSection(c.leave, raw => { const p = exact(raw, ["requestId", "operationId", "revision", "status", "startAt", "endAt", "recordedAt"]), result = { ...requestBase(p, 3, 3), status: enumValue(p.status, ["submitted", "approved", "rejected", "withdrawn", "cancelled"] as const) };
    if (result.revision === 1 ? result.status !== "submitted" || result.operationId !== result.requestId : result.operationId === result.requestId || (result.revision === 3 ? result.status !== "cancelled" : !["approved", "rejected", "withdrawn"].includes(result.status))) fail();
    if (micros(result.endAt) - micros(result.startAt) > BigInt(31622400000000) || Date.parse(result.startAt) % 60000 || Date.parse(result.endAt) % 60000) fail(); return result; }, p => p.requestId);
  const calendar = parseExceptionSection(c.calendar, raw => { const p = exact(raw, ["entryId", "operationId", "revision", "status", "locationId", "kind", "timeZone", "fromDate", "throughDate", "fromAt", "toAt", "recordedAt"]); const fromAt = stamp(p.fromAt), toAt = stamp(p.toAt); if (micros(toAt) <= micros(fromAt)) fail(); return { entryId: uuid(p.entryId), operationId: uuid(p.operationId), revision: integer(p.revision, 1, 2), status: enumValue(p.status, ["created", "cancelled"] as const), locationId: optionalUuid(p.locationId), kind: enumValue(p.kind, ["holiday", "closure"] as const), timeZone: label(p.timeZone, 100), fromDate: day(p.fromDate), throughDate: day(p.throughDate), fromAt, toAt, recordedAt: stamp(p.recordedAt) }; }, p => p.entryId);
  const missing = parseExceptionSection(c.missing, raw => { const p = exact(raw, ["requestId", "operationId", "revision", "status", "startAt", "endAt", "recordedAt", "supersedesRequestId", "rootRequestId", "isCurrentApproved"]); return { ...requestBase(p, 6, 2), status: enumValue(p.status, ["submitted", "approved", "rejected", "withdrawn"] as const), supersedesRequestId: optionalUuid(p.supersedesRequestId), rootRequestId: uuid(p.rootRequestId), isCurrentApproved: bool(p.isCurrentApproved) }; }, p => p.requestId);
  const pendingCorrections = parseExceptionSection(c.pendingCorrections, raw => { const p = exact(raw, ["kind", "requestId", "operationId", "revision", "startEventId", "startAt", "endAt", "recordedAt"]); return { ...requestBase(p, 6, 9007199254740990), kind: enumValue(p.kind, ["correction", "revision"] as const), startEventId: uuid(p.startEventId) }; }, p => p.kind + p.requestId);
  const overlap = (start: string, end: string | null) => micros(start) < micros(slot.endAt) && (end === null || micros(end) > micros(slot.startAt));
  for (const item of unassociated.items) {
    if (item.relationSlotId === slot.id || sessions.some(s => s.startEventId === item.startEventId)
      || !overlap(item.original.startAt!, item.original.endAt) && !overlap(item.selected.startAt!, item.selected.endAt)) fail();
  }
  for (const item of leave.items) if (!overlap(item.startAt, item.endAt)) fail();
  for (const item of calendar.items) {
    if (item.locationId !== null && item.locationId !== slot.locationId || !overlap(item.fromAt, item.toAt)
      || item.throughDate < item.fromDate || (Date.parse(item.throughDate) - Date.parse(item.fromDate)) / 86400000 > 365
      || (item.revision === 1 ? item.status !== "created" || item.operationId !== item.entryId : item.status !== "cancelled" || item.operationId === item.entryId)) fail();
  }
  for (const item of missing.items) {
    if (!overlap(item.startAt, item.endAt) || micros(item.endAt) - micros(item.startAt) > BigInt(86400000000) || micros(item.endAt) > micros(item.recordedAt)
      || (item.revision === 1 ? item.status !== "submitted" || item.operationId !== item.requestId : item.status === "submitted" || item.operationId === item.requestId)
      || item.isCurrentApproved && item.status !== "approved"
      || (item.supersedesRequestId === null ? item.rootRequestId !== item.requestId : item.supersedesRequestId === item.requestId || item.rootRequestId === item.requestId)) fail();
  }
  for (const item of pendingCorrections.items) {
    if (item.operationId !== item.requestId || micros(item.endAt) > micros(item.recordedAt) || micros(item.endAt) - micros(item.startAt) > BigInt(2678400000000)
      || !sessions.some(s => s.startEventId === item.startEventId) && !overlap(item.startAt, item.endAt)) fail();
  }
  const savedApproval = approval(s.approval, { siteId: q.siteId, worker, slot }), firstAdopted = sessions.find(s => s.adoption?.status === "adopted")?.adoption?.approval ?? null;
  if (savedApproval === null ? firstAdopted !== null : firstAdopted === null || !same(firstAdopted, { operationId: savedApproval.operationId, revision: savedApproval.revision, sourceId: savedApproval.sourceId, sourceSha256: savedApproval.sourceSha256, recordedAt: savedApproval.recordedAt })) fail();
  return { protocol: hasWork ? "plan-exception-evidence-v2" : "plan-exception-evidence-v1", policy: hasWork ? "owner-confirmed-plan-edges-work-v2" : "owner-confirmed-plan-edges-v1", siteId: q.siteId, worker, slot, phase, approval: savedApproval, sessions, context: { unassociated, leave, calendar, missing, pendingCorrections, ...(workArrangements ? { workArrangements } : {}) } };
}
export function calculateExceptionCandidate(source: PlanExceptionSource, eligible: boolean): PlanExceptionCandidate {
  const endpoints = (key: "original" | "selected"): PlanExceptionEndpoints => {
    const starts = source.sessions.map(s => s[key].startAt).filter((s): s is string => s !== null).sort(), ends = source.sessions.map(s => s[key].endAt).filter((s): s is string => s !== null).sort();
    //146 intentionally nulls BOTH aggregate ends if any original shift remains
    // open. A completed sibling is not a clock_out for the still-open session.
    return { startAt: starts[0] ?? null, endAt: source.sessions.some(s => s.selected.endAt === null) ? null : ends.at(-1) ?? null }; };
  const selected = endpoints("selected"), original = endpoints("original");
  const field = (kind: "late" | "early"): PlanExceptionCandidateField => {
    const rule = source.approval?.source.fields[kind === "late" ? "lateGraceMinutes" : "earlyGraceMinutes"];
    const state = !eligible ? "blocked" : !rule ? "unconfigured" : rule.state;
    if (state !== "value") return { state, minutes: null, rawDeltaUs: null, excessUs: null };
    if (rule!.minutes === null || !selected.startAt || !selected.endAt) return fail();
    const raw = kind === "late" ? micros(selected.startAt) - micros(source.slot.startAt) : micros(source.slot.endAt) - micros(selected.endAt), delta = raw - BigInt(rule!.minutes) * BigInt(60000000);
    return { state: delta > BigInt(0) ? "triggered" : "not_triggered", minutes: rule!.minutes, rawDeltaUs: raw.toString(), excessUs: (delta > BigInt(0) ? delta : BigInt(0)).toString() }; };
  return { late: field("late"), early: field("early"), original, selected };
}
function sourceBlockers(source: PlanExceptionSource) {
  const result = new Set<typeof PLAN_EXCEPTION_BLOCKERS[number]>(), { slot, worker, sessions, context } = source;
  if (source.phase !== "ended") result.add("plan_not_ended");
  if (slot.cancelled) result.add("slot_cancelled");
  if (!slot.hasPublicationEvidence) result.add("publication_missing");
  if (!worker.active || !worker.employeeActive) result.add("worker_inactive");
  if (!sessions.length) result.add("no_associated_sessions");
  let fixed: unknown = null;
  for (const s of sessions) {
    if (s.relation.status !== "linked") result.add("association_unverified");
    if (s.adoption === null) result.add("adoption_missing");
    else if (s.adoption.status !== "adopted") result.add("adoption_unverified");
    else if (fixed === null) fixed = s.adoption.approval;
    else if (!same(fixed, s.adoption.approval)) result.add("approval_mismatch");
    const start = micros(s.selected.startAt!);
    if (s.selected.endAt === null) result.add("session_open");
    else { const end = micros(s.selected.endAt); if (start === end) result.add("session_zero_duration");
      else if (start >= micros(slot.endAt) || end <= micros(slot.startAt)) result.add("session_outside_plan"); }
  }
  let priorEnd: bigint | null = null;
  for (const s of [...sessions].sort((a, b) => a.selected.startAt!.localeCompare(b.selected.startAt!) || a.startEventId.localeCompare(b.startEventId))) {
    if (priorEnd !== null && micros(s.selected.startAt!) < priorEnd) result.add("session_overlap");
    if (s.selected.endAt !== null) { const end = micros(s.selected.endAt); if (priorEnd === null || end > priorEnd) priorEnd = end; }
  }
  if (Object.values(context).some(s => s?.limited)) result.add("context_unknown");
  if (context.unassociated.items.length) result.add("unassociated_session");
  if (context.leave.items.some(r => r.status === "submitted")) result.add("leave_pending");
  if (context.leave.items.some(r => r.status === "approved")) result.add("leave_approved");
  if (context.calendar.items.some(r => r.status === "created")) result.add("calendar_entry");
  if (context.missing.items.some(r => r.status === "submitted" || r.isCurrentApproved)) result.add("missing_request");
  if (context.pendingCorrections.items.length) result.add("pending_correction");
  if (context.workArrangements?.items.some(r => r.status === "submitted")) result.add("work_arrangement_pending");
  return PLAN_EXCEPTION_BLOCKERS.filter(b => result.has(b));
}
// A separate ledger can retain this exact old evidence as context without
// fabricating an old source-result candidate or changing the existing reader.
// This validates evidence shape/provenance references, not SQL authorization.
export function parsePlanExceptionEvidenceSource(raw: unknown, q: PlanExceptionSourceQuery): PlanExceptionSource {
  try { safeTree(raw); exact(q, ["siteId", "workerId", "slotId"]); site(q.siteId); uuid(q.workerId); uuid(q.slotId);
    return freeze(readSource(JSON.parse(JSON.stringify(raw)), q));
  } catch { return fail(); }
}
export function parsePlanExceptionSource(raw: unknown, q: PlanExceptionSourceQuery, expectedActorId?: string): PlanExceptionSourceResult {
  try { safeTree(raw);
    // The archived relation/adoption trees below are reused only from a detached
    // JSON tree, never from the caller's objects. Freezing cannot freeze inputs.
    const detached: unknown = JSON.parse(JSON.stringify(raw));
    const v = exact(detached, ["protocol", "siteId", "actorId", "worker", "slot", "readAt", "source", "fingerprint", "eligible", "blockers", "candidate"]);
    exact(q, ["siteId", "workerId", "slotId"]); site(q.siteId); uuid(q.workerId); uuid(q.slotId); const actorId = uuid(v.actorId), readAt = stamp(v.readAt);
    if (!["plan-exception-source-v1", "plan-exception-source-v2"].includes(String(v.protocol)) || v.siteId !== q.siteId || expectedActorId !== undefined && actorId !== uuid(expectedActorId)) fail();
    const source = readSource(v.source, q), worker = parseExceptionWorker(v.worker), slot = parseExceptionSlot(v.slot), eligible = bool(v.eligible), blockers = parseExceptionBlockers(v.blockers), candidate = parseExceptionCandidate(v.candidate);
    if (v.protocol !== (source.protocol === "plan-exception-evidence-v2" ? "plan-exception-source-v2" : "plan-exception-source-v1")) fail();
    for (const item of source.context.workArrangements?.items ?? []) if (item.history.some(h => micros(h.recordedAt) > micros(readAt))) fail();
    if (!same(worker, source.worker) || !same(slot, source.slot) || eligible !== (blockers.length === 0) || !same(candidate, calculateExceptionCandidate(source, eligible))) fail();
    const phase = micros(readAt) < micros(slot.startAt) ? "future" : micros(readAt) < micros(slot.endAt) ? "ongoing" : "ended"; if (source.phase !== phase) fail();
    if (!same(blockers.filter(b => b !== "session_location_mismatch"), sourceBlockers(source))) fail();
    for (const s of [...source.sessions, ...source.context.unassociated.items]) {
      if (micros(s.original.startAt!) > micros(readAt) || s.original.endAt !== null && micros(s.original.endAt) > micros(readAt)
        || s.effect !== null && micros(s.effect.recordedAt) > micros(readAt)) fail();
    }
    if (eligible && (phase !== "ended" || slot.cancelled || !slot.hasPublicationEvidence || !worker.active || !worker.employeeActive || !source.sessions.length || !source.approval)) fail();
    return freeze({ protocol: source.protocol === "plan-exception-evidence-v2" ? "plan-exception-source-v2" : "plan-exception-source-v1", siteId: q.siteId, actorId, worker, slot, readAt, source, fingerprint: hash(v.fingerprint), eligible, blockers, candidate });
  } catch { return fail(); }
}

// Independent read-only post-hoc evaluation may use a legal saved140 approval
// without pretending it was attached to an original clock-in. Reuse the exact
// existing validator; no old source/result path or provenance rule changes.
export function parsePlanExceptionApproval(raw: unknown, source: Pick<PlanExceptionSource, "siteId" | "worker" | "slot">): PlanExceptionApproval | null {
  try {
    safeTree(raw, 65536); safeTree(source, 32768);
    const detached = JSON.parse(JSON.stringify(source)) as Pick<PlanExceptionSource, "siteId" | "worker" | "slot">;
    exact(detached, ["siteId", "worker", "slot"]); site(detached.siteId);
    const context = { siteId: detached.siteId, worker: parseExceptionWorker(detached.worker), slot: parseExceptionSlot(detached.slot) };
    return freeze(approval(JSON.parse(JSON.stringify(raw)), context));
  } catch { return fail(); }
}
