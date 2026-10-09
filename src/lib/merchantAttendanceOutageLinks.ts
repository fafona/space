import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { bool, enumValue, exact, freeze, hash, integer, label, micros, optionalUuid, safeTree, same, site, stamp, uuid } from "./merchantAttendancePlanExceptionValidation";
import { parseOutageInterval } from "./merchantAttendanceOutageTime";
import { OUTAGE_LINK_BLOCKERS, type OutageLinkEntry, type OutageLinkEvidence, type OutageLinkPreview, type OutageLinkReference, type OutageLinkSnapshot, type OutageLinksCommand, type OutageLinksQuery, type OutageLinksReceipt, type OutageLinksResult, type OutageLinkSpan, type OutageLinkSummary } from "./merchantAttendanceOutageLinksContract";
import { OUTAGE_ERRORS } from "./merchantAttendanceOutage";

export const OUTAGE_LINKS_ERRORS: Readonly<Record<string, number>> = Object.freeze({ ...OUTAGE_ERRORS,
  attendance_outage_links_disabled: 403, attendance_outage_links_invalid: 503, attendance_outage_links_changed: 409,
  attendance_outage_links_not_found: 404, attendance_outage_links_blocked: 409, attendance_outage_links_limit: 422,
  attendance_outage_links_too_large: 422,
});
const fail = (code = "attendance_outage_links_invalid"): never => { throw new MerchantAttendanceError(code); };
export const outageLinkReferenceKey = (r: OutageLinkReference) => r.kind + ":" + (r.kind === "session" ? r.startEventId : r.rootRequestId);
export function parseOutageLinkReference(raw: unknown): OutageLinkReference {
  if ((raw as { kind?: unknown } | null)?.kind === "session") {
    const r = exact(raw, ["kind", "startEventId", "lastEventId", "lastSequence", "effectOperationId", "effectRevision"]);
    const effectOperationId = optionalUuid(r.effectOperationId), effectRevision = r.effectRevision === null ? null : integer(r.effectRevision);
    if ((effectOperationId === null) !== (effectRevision === null)) fail();
    return { kind: "session", startEventId: uuid(r.startEventId), lastEventId: uuid(r.lastEventId), lastSequence: integer(r.lastSequence), effectOperationId, effectRevision };
  }
  const r = exact(raw, ["kind", "requestId", "rootRequestId", "approvalOperationId"]);
  if (r.kind !== "missing" || r.requestId === r.approvalOperationId) return fail();
  return { kind: "missing", requestId: uuid(r.requestId), rootRequestId: uuid(r.rootRequestId), approvalOperationId: uuid(r.approvalOperationId) };
}
function references(raw: unknown, allowEmpty = false): OutageLinkReference[] {
  if (!Array.isArray(raw) || raw.length > 10 || !allowEmpty && raw.length === 0) return fail();
  const result = raw.map(parseOutageLinkReference), keys = result.map(outageLinkReferenceKey);
  if (new Set(keys).size !== keys.length) fail();
  return result;
}
export function parseOutageLinksQuery(raw: unknown): OutageLinksQuery {
  try {
    safeTree(raw, 16384);
    const mode = enumValue((raw as { mode?: unknown } | null)?.mode, ["detail", "preview", "history", "recover"] as const);
    const r = exact(raw, ["siteId", "access", "mode", "declarationId", ...(mode === "preview" ? ["sources"] : mode === "history" ? ["beforeRevision"] : mode === "recover" ? ["operationId"] : [])]);
    const scope = { siteId: site(r.siteId), access: enumValue(r.access, ["owner", "self"] as const), declarationId: uuid(r.declarationId) };
    if ((mode === "preview" || mode === "recover") && scope.access !== "owner") fail();
    if (mode === "preview") return { ...scope, mode, sources: references(r.sources) };
    if (mode === "history") return { ...scope, mode, beforeRevision: r.beforeRevision === null ? null : integer(r.beforeRevision, 1, 101) };
    if (mode === "recover") return { ...scope, mode, operationId: uuid(r.operationId) };
    return { ...scope, mode };
  } catch { return fail("attendance_invalid_request"); }
}
export function parseOutageLinksCommand(raw: unknown): OutageLinksCommand {
  try {
    safeTree(raw, 16384);
    const action = enumValue((raw as { action?: unknown } | null)?.action, ["apply", "revoke"] as const);
    const r = exact(raw, ["action", "operationId", "expectedRevision", "expectedFingerprint", "reason", ...(action === "apply" ? ["sources"] : [])]);
    const expectedRevision = integer(r.expectedRevision, action === "revoke" ? 1 : 0, action === "revoke" ? 99 : 98);
    const base = { operationId: uuid(r.operationId), expectedRevision, expectedFingerprint: hash(r.expectedFingerprint), reason: label(r.reason, 1000) };
    return action === "apply" ? { ...base, action, sources: references(r.sources) } : { ...base, action };
  } catch { return fail("attendance_invalid_request"); }
}
export function assertOutageLinksWriteQuery(q: OutageLinksQuery): void {
  if (q.access !== "owner" || q.mode !== "detail") fail("attendance_invalid_request");
}
export function outageLinksCommandFingerprintText(query: OutageLinksQuery, command: OutageLinksCommand): string {
  const q = parseOutageLinksQuery(query), c = parseOutageLinksCommand(command);
  const refs = c.action === "revoke" ? [] : c.sources.map(r => r.kind === "session"
    ? [r.kind, r.startEventId, r.lastEventId, r.lastSequence, r.effectOperationId, r.effectRevision]
    : [r.kind, r.requestId, r.rootRequestId, r.approvalOperationId]);
  return JSON.stringify([q.siteId, "owner", q.declarationId, c.action, c.operationId, c.expectedRevision, c.expectedFingerprint, refs, c.reason]);
}

function span(raw: unknown): OutageLinkSpan {
  const v = exact(raw, ["startAt", "endAt"]), startAt = stamp(v.startAt), endAt = v.endAt === null ? null : stamp(v.endAt);
  if (endAt !== null && micros(endAt) < micros(startAt)) fail();
  return { startAt, endAt };
}
function snapshot(raw: unknown): OutageLinkSnapshot {
  const s = exact(raw, ["reference", "locationId", "timeZone", "original", "selected", "evidenceFingerprint", "pending", "open"]);
  const reference = parseOutageLinkReference(s.reference), original = s.original === null ? null : span(s.original), selected = span(s.selected), open = bool(s.open);
  if ((reference.kind === "missing") !== (original === null) || open !== (selected.endAt === null)) fail();
  if (reference.kind === "missing" && (open || selected.endAt === selected.startAt)) fail();
  if (reference.kind === "session" && reference.effectOperationId === null && !same(original, selected)) fail();
  if (reference.kind === "session" && reference.effectOperationId !== null && (open || original?.endAt === null)) fail();
  return { reference, original, selected, locationId: uuid(s.locationId), timeZone: label(s.timeZone, 100), evidenceFingerprint: hash(s.evidenceFingerprint), pending: bool(s.pending), open };
}
function evidence(raw: unknown, q: OutageLinksQuery): OutageLinkEvidence {
  const e = exact(raw, ["protocol", "siteId", "declarationId", "workerId", "employeeId", "employeeAuthUserId", "workerVersion", "employeeVersion", "generation", "declaredInterval", "items"]);
  if (e.protocol !== "outage-link-evidence-v1" || e.siteId !== q.siteId || e.declarationId !== q.declarationId || !Array.isArray(e.items) || e.items.length < 1 || e.items.length > 10) return fail();
  const items = e.items.map(snapshot);
  references(items.map(i => i.reference));
  return { protocol: "outage-link-evidence-v1", siteId: q.siteId, declarationId: q.declarationId,
    workerId: uuid(e.workerId), employeeId: uuid(e.employeeId), employeeAuthUserId: uuid(e.employeeAuthUserId), workerVersion: integer(e.workerVersion), employeeVersion: integer(e.employeeVersion), generation: integer(e.generation, 0),
    declaredInterval: parseOutageInterval(e.declaredInterval, false), items };
}
// Shared strict saved-evidence validation for the additive outage review ledger.
export { evidence as parseOutageLinkEvidence };
function entry(raw: unknown, q: OutageLinksQuery, readAt: string): OutageLinkEntry {
  const v = exact(raw, ["operationId", "revision", "action", "actorId", "reason", "sources", "evidence", "fingerprint", "recordedAt"]);
  const action = enumValue(v.action, ["apply", "revoke"] as const), revision = integer(v.revision, 1, 100), sources = references(v.sources, action === "revoke"), e = v.evidence === null ? null : evidence(v.evidence, q), recordedAt = stamp(v.recordedAt);
  if (micros(recordedAt) > micros(readAt)) fail();
  if (action === "apply" ? e === null || revision === 100 || !same(sources, e.items.map(i => i.reference)) : e !== null || sources.length > 0 || revision === 1) fail();
  if (e) {
    for (const s of e.items) {
      for (const range of [s.original, s.selected]) if (range && (micros(range.startAt) > micros(recordedAt) || range.endAt !== null && micros(range.endAt) > micros(recordedAt))) fail();
    }
    if (micros(e.declaredInterval.endAt) > micros(recordedAt)) fail();
  }
  return { operationId: uuid(v.operationId), revision, action, actorId: uuid(v.actorId), reason: label(v.reason, 1000), sources, evidence: e, fingerprint: hash(v.fingerprint), recordedAt };
}
function summary(raw: unknown, readAt: string): OutageLinkSummary {
  const v = exact(raw, ["operationId", "revision", "action", "actorId", "reason", "fingerprint", "sourceCount", "recordedAt"]);
  const action = enumValue(v.action, ["apply", "revoke"] as const), revision = integer(v.revision, 1, 100), sourceCount = integer(v.sourceCount, action === "revoke" ? 0 : 1, action === "revoke" ? 0 : 10), recordedAt = stamp(v.recordedAt);
  if (micros(recordedAt) > micros(readAt) || action === "revoke" && revision === 1 || action === "apply" && revision === 100) fail();
  return { operationId: uuid(v.operationId), revision, action, actorId: uuid(v.actorId), reason: label(v.reason, 1000), fingerprint: hash(v.fingerprint), sourceCount, recordedAt };
}
function preview(raw: unknown, q: OutageLinksQuery, basis: OutageLinkEntry | null, readAt: string): OutageLinkPreview {
  const p = exact(raw, ["fingerprint", "evidence", "eligible", "observations", "blockers"]);
  const fingerprint = p.fingerprint === null ? null : hash(p.fingerprint), e = p.evidence === null ? null : evidence(p.evidence, q), eligible = bool(p.eligible);
  if ((e === null) !== (fingerprint === null) || !Array.isArray(p.observations) || !Array.isArray(p.blockers) || new Set(p.blockers).size !== p.blockers.length) fail();
  const blockers = (p.blockers as unknown[]).map(b => enumValue(b, OUTAGE_LINK_BLOCKERS));
  const selected = q.mode === "preview" ? q.sources : basis?.action === "apply" ? basis.sources : [];
  if (!selected.length || (p.observations as unknown[]).length !== selected.length) fail();
  const observations = (p.observations as unknown[]).map((rawItem, i) => {
    const o = exact(rawItem, ["reference", "current", "available", "changed", "open", "pending"]);
    const reference = parseOutageLinkReference(o.reference), current = o.current === null ? null : snapshot(o.current), available = bool(o.available), changed = bool(o.changed), open = bool(o.open), pending = bool(o.pending);
    if (!same(reference, selected[i]) || available !== (current !== null) || (current ? open !== current.open || pending !== current.pending : open || pending)) fail();
    if (!current && changed) fail();
    if (current) for (const range of [current.original, current.selected]) {
      if (range && (micros(range.startAt) > micros(readAt) || range.endAt !== null && micros(range.endAt) > micros(readAt))) fail();
    }
    if (current && !same(current.reference, reference) && !changed) fail();
    if (q.mode === "detail" && current && basis?.evidence?.items[i] && !same(current, basis.evidence.items[i]) && !changed) fail();
    if (!available && !blockers.includes("source_unavailable") && !blockers.includes("identity_changed")) fail();
    if (changed && !blockers.includes("source_changed") || open && !blockers.includes("source_open") || pending && !blockers.includes("pending_source")) fail();
    return { reference, current, available, changed, open, pending };
  });
  const fatal = blockers.some(b => b !== "source_open" && b !== "pending_source");
  if (eligible !== (!fatal && observations.every(o => o.available && !o.changed)) || eligible && e === null) fail();
  if (e && !same(e.items, observations.map(o => o.current))) fail();
  if (e && micros(e.declaredInterval.endAt) > micros(readAt)) fail();
  if (e && basis?.evidence) {
    const old = basis.evidence;
    if (e.workerId !== old.workerId || e.employeeId !== old.employeeId || e.employeeAuthUserId !== old.employeeAuthUserId || !same(e.declaredInterval, old.declaredInterval)) fail();
    if (q.mode === "detail" && !same(e, old) && !blockers.includes("source_changed")) fail();
  }
  return { fingerprint, evidence: e, eligible, observations, blockers };
}
export function parseOutageLinksResult(raw: unknown, query: OutageLinksQuery, actorId: string, command: OutageLinksCommand | null = null): OutageLinksResult {
  try {
    safeTree(raw, 1048576);
    const q = parseOutageLinksQuery(query), actor = uuid(actorId), c = command === null ? null : parseOutageLinksCommand(command);
    if (c) assertOutageLinksWriteQuery(q);
    const v = exact(JSON.parse(JSON.stringify(raw)), ["protocol", "siteId", "access", "mode", "actorId", "declarationId", "readAt", "canWrite", "revision", "current", "preview", "history", "historyTruncated", "receipt"]);
    if (v.protocol !== "attendance-outage-links-v1" || v.siteId !== q.siteId || v.access !== q.access || v.mode !== q.mode || v.actorId !== actor || v.declarationId !== q.declarationId) fail();
    const readAt = stamp(v.readAt), canWrite = bool(v.canWrite), revision = integer(v.revision, 0, 100), historyTruncated = bool(v.historyTruncated);
    const current = v.current === null ? null : entry(v.current, q, readAt);
    if (!Array.isArray(v.history) || v.history.length > 25) return fail();
    const history = v.history.map(h => summary(h, readAt));
    const parsedPreview = v.preview === null ? null : preview(v.preview, q, current, readAt);
    let receipt: OutageLinksReceipt | null = null;
    if (v.receipt !== null) {
      const r = exact(v.receipt, ["operationId", "commandFingerprint", "entry"]), item = entry(r.entry, q, readAt);
      if (r.operationId !== item.operationId || item.actorId !== actor || q.access !== "owner") fail();
      receipt = { operationId: uuid(r.operationId), commandFingerprint: hash(r.commandFingerprint), entry: item };
    }
    if (c || q.mode === "recover") {
      if (!receipt || current || parsedPreview || history.length || historyTruncated || canWrite || revision !== receipt.entry.revision) return fail();
      if (q.mode === "recover" && receipt.operationId !== q.operationId) fail();
      if (c && (receipt.operationId !== c.operationId || receipt.entry.action !== c.action || receipt.entry.revision !== c.expectedRevision + 1
        || receipt.entry.reason !== c.reason || !same(receipt.entry.sources, c.action === "apply" ? c.sources : []) || receipt.entry.fingerprint !== c.expectedFingerprint)) fail();
    } else if (q.mode === "history") {
      if (receipt || current || parsedPreview || canWrite) fail();
      const upper = Math.min(revision + 1, q.beforeRevision ?? revision + 1);
      if (history.length !== Math.min(25, upper - 1) || historyTruncated !== (upper - 1 > 25)) fail();
      const ids = new Set<string>();
      for (let i = 0; i < history.length; i++) {
        if (history[i].revision !== upper - 1 - i || ids.has(history[i].operationId) || i > 0 && micros(history[i].recordedAt) > micros(history[i - 1].recordedAt)) fail();
        ids.add(history[i].operationId);
      }
    } else {
      if (receipt || history.length || historyTruncated || (current === null ? revision !== 0 : revision !== current.revision)) fail();
      if (q.mode === "preview" && parsedPreview === null || q.mode === "detail" && (parsedPreview !== null) !== (current?.action === "apply")) fail();
    }
    if (q.access === "self" && (canWrite || current?.evidence && current.evidence.employeeAuthUserId !== actor || parsedPreview?.evidence && parsedPreview.evidence.employeeAuthUserId !== actor)) fail();
    return freeze({ protocol: "attendance-outage-links-v1", siteId: q.siteId, access: q.access, mode: q.mode, actorId: actor, declarationId: q.declarationId, readAt, canWrite, revision, current, preview: parsedPreview, history, historyTruncated, receipt });
  } catch { return fail(); }
}
