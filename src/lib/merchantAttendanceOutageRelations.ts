import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { bool, enumValue, exact, freeze, hash, integer, label, micros, safeTree, same, site, stamp, uuid } from "./merchantAttendancePlanExceptionValidation";
import { OUTAGE_ERRORS } from "./merchantAttendanceOutage";
import { OUTAGE_RELATION_BLOCKERS, OUTAGE_RELATION_KINDS, type OutageRelationEvidence, type OutageRelationEntry, type OutageRelationPair,
  type OutageRelationPreview, type OutageRelationSummary, type OutageRelationsQuery, type OutageRelationsCommand, type OutageRelationsResult,
  type OutageRelationReceipt } from "./merchantAttendanceOutageRelationsContract";

export const OUTAGE_RELATIONS_ERRORS: Readonly<Record<string, number>> = Object.freeze({ ...OUTAGE_ERRORS,
  attendance_outage_relations_invalid: 503, attendance_outage_relations_disabled: 403, attendance_outage_relations_changed: 409,
  attendance_outage_relations_blocked: 409, attendance_outage_relations_not_found: 404, attendance_outage_relations_limit: 422,
  attendance_outage_relations_too_large: 422,
});
const fail = (code = "attendance_outage_relations_invalid"): never => { throw new MerchantAttendanceError(code); };
export function parseOutageRelationsQuery(raw: unknown): OutageRelationsQuery {
  try {
    safeTree(raw, 8192);
    const mode = enumValue((raw as { mode?: unknown } | null)?.mode, ["list", "detail", "history", "recover"] as const);
    const r = exact(raw, ["siteId", "access", "mode", "declarationId", ...(mode === "list" ? [] : ["relatedDeclarationId"]),
      ...(mode === "history" ? ["beforeRevision"] : mode === "recover" ? ["operationId"] : [])]);
    const scope = { siteId: site(r.siteId), access: enumValue(r.access, ["owner", "self"] as const), declarationId: uuid(r.declarationId) };
    if (mode === "list") return { ...scope, mode };
    const relatedDeclarationId = uuid(r.relatedDeclarationId);
    if (relatedDeclarationId === scope.declarationId) fail();
    if (mode === "recover") {
      if (scope.access !== "owner") fail();
      return { ...scope, relatedDeclarationId, mode, operationId: uuid(r.operationId) };
    }
    if (mode === "history") return { ...scope, relatedDeclarationId, mode, beforeRevision: r.beforeRevision === null ? null : integer(r.beforeRevision, 1, 101) };
    return { ...scope, relatedDeclarationId, mode };
  } catch { return fail("attendance_invalid_request"); }
}
export function parseOutageRelationsCommand(raw: unknown): OutageRelationsCommand {
  try {
    safeTree(raw, 8192);
    const action = enumValue((raw as { action?: unknown } | null)?.action, ["apply", "revoke"] as const);
    const r = exact(raw, ["action", "operationId", "expectedRevision", "expectedFingerprint", "reason", ...(action === "apply" ? ["kind"] : [])]);
    const base = { operationId: uuid(r.operationId), expectedRevision: integer(r.expectedRevision, action === "apply" ? 0 : 1, action === "apply" ? 98 : 99),
      expectedFingerprint: hash(r.expectedFingerprint), reason: label(r.reason, 1000) };
    return action === "apply" ? { ...base, action, kind: enumValue(r.kind, OUTAGE_RELATION_KINDS) } : { ...base, action };
  } catch { return fail("attendance_invalid_request"); }
}
export function assertOutageRelationsWriteQuery(q: OutageRelationsQuery): void {
  if (q.access !== "owner" || q.mode !== "detail") fail("attendance_invalid_request");
}
export function outageRelationsCommandFingerprintText(query: OutageRelationsQuery, command: OutageRelationsCommand): string {
  const q = parseOutageRelationsQuery(query), c = parseOutageRelationsCommand(command); assertOutageRelationsWriteQuery(q);
  if (q.mode !== "detail") return fail("attendance_invalid_request");
  return JSON.stringify([q.siteId, "owner", q.declarationId, q.relatedDeclarationId, c.action, c.operationId, c.expectedRevision,
    c.expectedFingerprint, c.action === "apply" ? c.kind : null, c.reason]);
}
function pair(raw: unknown, q: OutageRelationsQuery): OutageRelationPair {
  if (!Array.isArray(raw) || raw.length !== 2) return fail();
  const p: OutageRelationPair = [uuid(raw[0]), uuid(raw[1])];
  if (p[0] >= p[1] || !p.includes(q.declarationId) || q.mode !== "list" && !p.includes(q.relatedDeclarationId)) fail();
  return p;
}
function evidence(raw: unknown, q: OutageRelationsQuery, expectedPair: OutageRelationPair): OutageRelationEvidence {
  const e = exact(raw, ["protocol", "siteId", "workerId", "employeeId", "employeeAuthUserId", "workerVersion", "employeeVersion", "generation", "declarations"]);
  if (e.protocol !== "outage-relation-evidence-v1" || e.siteId !== q.siteId || !Array.isArray(e.declarations) || e.declarations.length !== 2) return fail();
  const declarations = e.declarations.map((rawItem, i) => {
    const d = exact(rawItem, ["declarationId", "operationId", "fingerprint"]);
    if (d.declarationId !== expectedPair[i]) fail();
    return { declarationId: uuid(d.declarationId), operationId: uuid(d.operationId), fingerprint: hash(d.fingerprint) };
  }) as OutageRelationEvidence["declarations"];
  if (declarations[0].operationId === declarations[1].operationId) fail();
  return { protocol: "outage-relation-evidence-v1", siteId: q.siteId, workerId: uuid(e.workerId), employeeId: uuid(e.employeeId), employeeAuthUserId: uuid(e.employeeAuthUserId),
    workerVersion: integer(e.workerVersion), employeeVersion: integer(e.employeeVersion), generation: integer(e.generation, 0), declarations };
}
const SUMMARY_KEYS = ["pair", "operationId", "revision", "action", "kind", "actorId", "reason", "fingerprint", "recordedAt"];
function summary(raw: unknown, q: OutageRelationsQuery, readAt: string): OutageRelationSummary {
  const v = exact(raw, SUMMARY_KEYS), action = enumValue(v.action, ["apply", "revoke"] as const), revision = integer(v.revision, 1, 100), recordedAt = stamp(v.recordedAt);
  if (micros(recordedAt) > micros(readAt) || action === "apply" && revision === 100 || action === "revoke" && revision === 1) fail();
  return { pair: pair(v.pair, q), operationId: uuid(v.operationId), revision, action, kind: enumValue(v.kind, OUTAGE_RELATION_KINDS),
    actorId: uuid(v.actorId), reason: label(v.reason, 1000), fingerprint: hash(v.fingerprint), recordedAt };
}
function entry(raw: unknown, q: OutageRelationsQuery, readAt: string): OutageRelationEntry {
  const v = exact(raw, [...SUMMARY_KEYS, "evidence"]), { evidence: saved, ...lean } = v;
  const s = summary(lean, q, readAt), e = saved === null ? null : evidence(saved, q, s.pair);
  if ((s.action === "apply") !== (e !== null)) fail();
  return { ...s, evidence: e };
}
function preview(raw: unknown, q: OutageRelationsQuery, current: OutageRelationEntry | null): OutageRelationPreview {
  if (q.mode !== "detail") return fail();
  const p = exact(raw, ["fingerprint", "evidence", "eligible", "blockers"]);
  const ids = [q.declarationId, q.relatedDeclarationId].sort() as OutageRelationPair;
  const e = p.evidence === null ? null : evidence(p.evidence, q, ids), fingerprint = p.fingerprint === null ? null : hash(p.fingerprint);
  if ((e === null) !== (fingerprint === null) || !Array.isArray(p.blockers)) return fail();
  const blockers = p.blockers.map(v => enumValue(v, OUTAGE_RELATION_BLOCKERS)), eligible = bool(p.eligible);
  if (new Set(blockers).size !== blockers.length || eligible !== (e !== null && blockers.length === 0)) fail();
  if (e === null && !blockers.includes("identity_changed")) fail();
  if (current?.evidence && e && !same([e.workerId, e.employeeId, e.employeeAuthUserId, e.declarations],
    [current.evidence.workerId, current.evidence.employeeId, current.evidence.employeeAuthUserId, current.evidence.declarations])) fail();
  return { evidence: e, fingerprint, eligible, blockers };
}
export function parseOutageRelationsResult(raw: unknown, query: OutageRelationsQuery, actorId: string, command: OutageRelationsCommand | null = null): OutageRelationsResult {
  try {
    safeTree(raw, 1048576);
    const q = parseOutageRelationsQuery(query), actor = uuid(actorId), c = command === null ? null : parseOutageRelationsCommand(command);
    if (c) assertOutageRelationsWriteQuery(q);
    const v = exact(JSON.parse(JSON.stringify(raw)), ["protocol", "siteId", "access", "mode", "actorId", "declarationId", "relatedDeclarationId", "readAt", "canWrite",
      "items", "revision", "current", "preview", "history", "historyTruncated", "receipt"]);
    if (v.protocol !== "attendance-outage-relations-v1" || v.siteId !== q.siteId || v.access !== q.access || v.mode !== q.mode || v.actorId !== actor
      || v.declarationId !== q.declarationId || v.relatedDeclarationId !== (q.mode === "list" ? null : q.relatedDeclarationId)) fail();
    const readAt = stamp(v.readAt), canWrite = bool(v.canWrite), revision = integer(v.revision, 0, 100), historyTruncated = bool(v.historyTruncated);
    if (!Array.isArray(v.items) || v.items.length > 25 || !Array.isArray(v.history) || v.history.length > 25) return fail();
    const items = v.items.map(i => summary(i, q, readAt)), history = v.history.map(h => summary(h, q, readAt));
    const current = v.current === null ? null : entry(v.current, q, readAt), parsedPreview = v.preview === null ? null : preview(v.preview, q, current);
    let receipt: OutageRelationReceipt | null = null;
    if (v.receipt !== null) {
      const r = exact(v.receipt, ["operationId", "commandFingerprint", "entry"]), item = entry(r.entry, q, readAt);
      if (q.access !== "owner" || r.operationId !== item.operationId || item.actorId !== actor) fail();
      receipt = { operationId: uuid(r.operationId), commandFingerprint: hash(r.commandFingerprint), entry: item };
    }
    if (c || q.mode === "recover") {
      if (!receipt || canWrite || current || parsedPreview || items.length || history.length || historyTruncated || revision !== receipt.entry.revision) return fail();
      if (q.mode === "recover" && receipt.operationId !== q.operationId) fail();
      if (c && (receipt.operationId !== c.operationId || receipt.entry.action !== c.action || receipt.entry.revision !== c.expectedRevision + 1
        || receipt.entry.reason !== c.reason || receipt.entry.fingerprint !== c.expectedFingerprint || c.action === "apply" && receipt.entry.kind !== c.kind)) fail();
    } else if (q.mode === "list") {
      if (receipt || current || parsedPreview || history.length || historyTruncated || canWrite || revision !== 0) fail();
      let previous = ""; const ids = new Set<string>();
      for (const item of items) {
        const other = item.pair.find(x => x !== q.declarationId)!;
        if (other <= previous || ids.has(item.operationId)) fail(); previous = other; ids.add(item.operationId);
      }
    } else if (q.mode === "history") {
      if (receipt || current || parsedPreview || items.length || canWrite) fail();
      const upper = Math.min(revision + 1, q.beforeRevision ?? revision + 1);
      if (history.length !== Math.min(25, upper - 1) || historyTruncated !== (upper - 1 > 25)) fail();
      const ids = new Set<string>();
      for (let i = 0; i < history.length; i++) {
        const item = history[i], prior = history[i + 1];
        if (item.revision !== upper - 1 - i || ids.has(item.operationId) || i > 0 && micros(item.recordedAt) > micros(history[i - 1].recordedAt)) fail();
        if (item.action === "revoke" && prior && (prior.action !== "apply" || item.kind !== prior.kind || item.fingerprint !== prior.fingerprint)) fail();
        ids.add(item.operationId);
      }
    } else {
      if (receipt || items.length || history.length || historyTruncated || !parsedPreview || (current === null ? revision !== 0 : revision !== current.revision)) fail();
      if (canWrite && !(parsedPreview!.eligible || current?.action === "apply" && revision < 100)) fail();
      if (revision >= 99 && !parsedPreview!.blockers.includes("revision_limit")) fail();
    }
    if (q.access === "self" && (canWrite || current?.evidence && current.evidence.employeeAuthUserId !== actor
      || parsedPreview?.evidence && parsedPreview.evidence.employeeAuthUserId !== actor)) fail();
    return freeze({ protocol: "attendance-outage-relations-v1", siteId: q.siteId, access: q.access, mode: q.mode, actorId: actor,
      declarationId: q.declarationId, relatedDeclarationId: q.mode === "list" ? null : q.relatedDeclarationId, readAt, canWrite, items, revision,
      current, preview: parsedPreview, history, historyTruncated, receipt });
  } catch { return fail(); }
}
