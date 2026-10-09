import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { bool, enumValue, exact, freeze, hash, integer, label, micros, optionalUuid, safeTree, same, site, stamp, uuid } from "./merchantAttendancePlanExceptionValidation";
import { OUTAGE_LINKS_ERRORS, parseOutageLinkEvidence } from "./merchantAttendanceOutageLinks";
import { OUTAGE_REVIEW_ACTIONS, OUTAGE_REVIEW_BLOCKERS, type OutageReviewCommand, type OutageReviewEntry, type OutageReviewEvidence, type OutageReviewProposal, type OutageReviewQuery, type OutageReviewReceipt, type OutageReviewResult, type OutageReviewStatus } from "./merchantAttendanceOutageReviewContract";
// Pure saved-value validators for immutable period snapshots; no RPC or auth.
export { entry as parseOutageReviewSavedEntry, proposal as parseOutageReviewSavedProposal, status as parseOutageReviewSavedStatus };
export const OUTAGE_REVIEW_ERRORS: Readonly<Record<string, number>> = Object.freeze({ ...OUTAGE_LINKS_ERRORS,
  attendance_outage_review_invalid: 503, attendance_outage_review_disabled: 403, attendance_outage_review_changed: 409,
  attendance_outage_review_blocked: 409, attendance_outage_review_not_found: 404, attendance_outage_review_limit: 422, attendance_outage_review_too_large: 422 });
const fail = (code = "attendance_outage_review_invalid"): never => { throw new MerchantAttendanceError(code); };
const safety = (action: string) => action === "dispute" || action === "reopen";
const entryKeys = ["operationId", "revision", "action", "actorId", "resultVersion", "resultFingerprint", "reason", "recordedAt"];
export function parseOutageReviewQuery(raw: unknown): OutageReviewQuery {
  try {
    safeTree(raw, 8192);
    const mode = enumValue((raw as { mode?: unknown } | null)?.mode, ["detail", "history", "recover"] as const);
    const r = exact(raw, ["siteId", "access", "mode", "declarationId", ...(mode === "history" ? ["beforeRevision"] : mode === "recover" ? ["operationId"] : [])]);
    const base = { siteId: site(r.siteId), access: enumValue(r.access, ["owner", "self"] as const), declarationId: uuid(r.declarationId) };
    if (mode === "history") return { ...base, mode, beforeRevision: r.beforeRevision === null ? null : integer(r.beforeRevision, 1, 1001) };
    if (mode === "recover") return { ...base, mode, operationId: uuid(r.operationId) };
    return { ...base, mode };
  } catch { return fail("attendance_invalid_request"); }
}
export function parseOutageReviewCommand(raw: unknown): OutageReviewCommand {
  try {
    safeTree(raw, 8192);
    const c = exact(raw, ["action", "operationId", "expectedRevision", "expectedResultVersion", "expectedFingerprint", "reason"]), action = enumValue(c.action, OUTAGE_REVIEW_ACTIONS);
    const expectedRevision = integer(c.expectedRevision, action === "propose" ? 0 : 1, safety(action) ? 999 : 997), expectedResultVersion = integer(c.expectedResultVersion, action === "propose" ? 0 : 1, 998);
    if (expectedResultVersion > expectedRevision || (expectedRevision === 0) !== (expectedResultVersion === 0)) fail();
    return { action, operationId: uuid(c.operationId), expectedRevision, expectedResultVersion, expectedFingerprint: hash(c.expectedFingerprint), reason: label(c.reason, 1000) };
  } catch { return fail("attendance_invalid_request"); }
}
export function assertOutageReviewWriteQuery(q: OutageReviewQuery, c: OutageReviewCommand) {
  if (q.mode !== "detail" || (q.access === "self") !== (c.action === "confirm" || c.action === "dispute")) fail("attendance_invalid_request");
}
export function outageReviewCommandFingerprintText(query: OutageReviewQuery, command: OutageReviewCommand) {
  const q = parseOutageReviewQuery(query), c = parseOutageReviewCommand(command); assertOutageReviewWriteQuery(q, c);
  return JSON.stringify([q.siteId, q.access, q.declarationId, c.action, c.operationId, c.expectedRevision, c.expectedResultVersion, c.expectedFingerprint, c.reason]);
}
function entry(raw: unknown, readAt: string): OutageReviewEntry {
  const r = exact(raw, entryKeys), action = enumValue(r.action, OUTAGE_REVIEW_ACTIONS), revision = integer(r.revision, 1, safety(action) ? 1000 : 998), resultVersion = integer(r.resultVersion, 1, 998), recordedAt = stamp(r.recordedAt);
  if (resultVersion > revision || (revision === 1 && action !== "propose") || micros(recordedAt) > micros(readAt)) fail();
  return { operationId: uuid(r.operationId), revision, action, actorId: uuid(r.actorId), resultVersion, resultFingerprint: hash(r.resultFingerprint), reason: label(r.reason, 1000), recordedAt };
}
function evidence(raw: unknown, q: OutageReviewQuery, recordedAt: string): OutageReviewEvidence {
  const r = exact(raw, ["protocol", "siteId", "declarationId", "linkOperationId", "linkRevision", "linkFingerprint", "linkEvidence", "original"]);
  if (r.protocol !== "outage-review-evidence-v1" || r.siteId !== q.siteId || r.declarationId !== q.declarationId) fail();
  const linkEvidence = parseOutageLinkEvidence(r.linkEvidence, { siteId: q.siteId, access: q.access, declarationId: q.declarationId, mode: "detail" });
  for (const item of linkEvidence.items) for (const range of [item.original, item.selected]) {
    if (range && (micros(range.startAt) > micros(recordedAt) || range.endAt !== null && micros(range.endAt) > micros(recordedAt))) fail();
  }
  if (micros(linkEvidence.declaredInterval.endAt) > micros(recordedAt)) fail();
  const o = exact(r.original, ["status", "operationId", "channel", "eventId"]), status = enumValue(o.status, ["not_required", "verified", "unresolved"] as const), operationId = optionalUuid(o.operationId), eventId = optionalUuid(o.eventId), channel = o.channel === null ? null : enumValue(o.channel, ["web", "location", "onsite", "pin", "other"] as const);
  if (status === "not_required" ? operationId !== null || eventId !== null || channel !== null : operationId === null || channel === null || (status === "verified") !== (eventId !== null)) fail();
  if (status === "verified" && channel === "other") fail();
  return { protocol: "outage-review-evidence-v1", siteId: q.siteId, declarationId: q.declarationId, linkOperationId: uuid(r.linkOperationId), linkRevision: integer(r.linkRevision, 1, 99), linkFingerprint: hash(r.linkFingerprint), linkEvidence, original: { status, operationId, channel, eventId } };
}
function proposal(raw: unknown, q: OutageReviewQuery, readAt: string): OutageReviewProposal {
  const r = exact(raw, [...entryKeys, "evidence"]), { evidence: ev, ...rest } = r, e = entry(rest, readAt);
  if (e.action !== "propose") fail();
  return { ...e, evidence: evidence(ev, q, e.recordedAt) };
}
function status(raw: unknown, q: OutageReviewQuery, current: OutageReviewEntry | null, p: OutageReviewProposal | null, response: OutageReviewEntry | null, canWrite: boolean): OutageReviewStatus {
  const s = exact(raw, ["basisFingerprint", "linkOperationId", "linkRevision", "linkFingerprint", "blockers", "canPropose", "canConfirm", "canResolve", "resolved"]);
  if (!Array.isArray(s.blockers) || new Set(s.blockers).size !== s.blockers.length) return fail();
  const blockers = s.blockers.map(b => enumValue(b, OUTAGE_REVIEW_BLOCKERS));
  const value: OutageReviewStatus = { basisFingerprint: s.basisFingerprint === null ? null : hash(s.basisFingerprint), linkOperationId: optionalUuid(s.linkOperationId), linkRevision: integer(s.linkRevision, 0, 100), linkFingerprint: s.linkFingerprint === null ? null : hash(s.linkFingerprint), blockers,
    canPropose: bool(s.canPropose), canConfirm: bool(s.canConfirm), canResolve: bool(s.canResolve), resolved: bool(s.resolved) };
  if (value.linkRevision === 0 ? value.linkOperationId !== null || value.linkFingerprint !== null : value.linkOperationId === null || value.linkFingerprint === null) fail();
  if ((value.canPropose || value.canConfirm || value.canResolve) && !canWrite || q.access === "self" && (value.canPropose || value.canResolve) || q.access === "owner" && value.canConfirm) fail();
  if (value.canPropose && (value.basisFingerprint === null || current?.action === "resolve" || blockers.some(b => ["identity_changed", "source_changed", "source_unavailable", "source_outside_declaration", "duplicate_source", "link_missing", "link_revoked"].includes(b)))) fail();
  const sameBasis = p !== null && value.basisFingerprint === p.resultFingerprint && value.linkOperationId === p.evidence.linkOperationId && value.linkRevision === p.evidence.linkRevision && value.linkFingerprint === p.evidence.linkFingerprint;
  const sourceBlockers = blockers.filter(b => !["unconfirmed", "disputed", "reopened"].includes(b));
  if (sameBasis && p && (p.evidence.linkEvidence.items.some(i => i.open) && !blockers.includes("source_open") || p.evidence.linkEvidence.items.some(i => i.pending) && !blockers.includes("pending_source"))) fail();
  if (value.canConfirm && (!sameBasis || sourceBlockers.length > 0 || !current || !["propose", "dispute", "reopen"].includes(current.action)) || value.canResolve && (!sameBasis || blockers.length > 0 || response?.action !== "confirm" || current?.action !== "confirm")) fail();
  if (value.resolved !== (current?.action === "resolve" && sameBasis && blockers.length === 0 && response?.action === "confirm")) fail();
  if (!p && !blockers.includes("result_missing") || p?.evidence.original.status === "unresolved" && sameBasis && !blockers.includes("original_unknown")) fail();
  return value;
}
export function parseOutageReviewResult(raw: unknown, query: OutageReviewQuery, actorId: string, command: OutageReviewCommand | null = null): OutageReviewResult {
  try {
    safeTree(raw, 1048576); const q = parseOutageReviewQuery(query), actor = uuid(actorId), c = command === null ? null : parseOutageReviewCommand(command);
    if (c) assertOutageReviewWriteQuery(q, c);
    const v = exact(JSON.parse(JSON.stringify(raw)), ["protocol", "siteId", "access", "mode", "actorId", "declarationId", "readAt", "canWrite", "revision", "resultVersion", "current", "proposal", "response", "status", "history", "historyTruncated", "receipt"]);
    if (v.protocol !== "attendance-outage-review-v1" || v.siteId !== q.siteId || v.access !== q.access || v.mode !== q.mode || v.actorId !== actor || v.declarationId !== q.declarationId) fail();
    const readAt = stamp(v.readAt), canWrite = bool(v.canWrite), revision = integer(v.revision, 0, 1000), resultVersion = integer(v.resultVersion, 0, 998), historyTruncated = bool(v.historyTruncated);
    if (resultVersion > revision || (revision === 0) !== (resultVersion === 0)) fail();
    const current = v.current === null ? null : entry(v.current, readAt), p = v.proposal === null ? null : proposal(v.proposal, q, readAt), response = v.response === null ? null : entry(v.response, readAt);
    if (!Array.isArray(v.history) || v.history.length > 25) return fail();
    const history = v.history.map(h => entry(h, readAt));
    let receipt: OutageReviewReceipt | null = null;
    if (v.receipt !== null) {
      const r = exact(v.receipt, ["operationId", "commandFingerprint", "entry", "proposal"]), e = entry(r.entry, readAt), pp = proposal(r.proposal, q, readAt);
      if (r.operationId !== e.operationId || e.actorId !== actor || e.resultVersion !== pp.resultVersion || e.resultFingerprint !== pp.resultFingerprint || e.revision < pp.revision || micros(e.recordedAt) < micros(pp.recordedAt)) fail();
      if ((q.access === "self") !== ["confirm", "dispute"].includes(e.action)) fail();
      if (e.action === "propose" && !same(e, Object.fromEntries(Object.entries(pp).filter(([k]) => k !== "evidence")))) fail();
      receipt = { operationId: uuid(r.operationId), commandFingerprint: hash(r.commandFingerprint), entry: e, proposal: pp };
    }
    let s: OutageReviewStatus | null = null;
    if (c || q.mode === "recover") {
      if (!receipt || current || p || response || v.status !== null || history.length || historyTruncated || canWrite || revision !== receipt.entry.revision || resultVersion !== receipt.entry.resultVersion) return fail();
      if (q.mode === "recover" && receipt.operationId !== q.operationId) fail();
      if (c && (receipt.operationId !== c.operationId || receipt.entry.action !== c.action || receipt.entry.revision !== c.expectedRevision + 1 || receipt.entry.resultVersion !== c.expectedResultVersion + (c.action === "propose" ? 1 : 0) || receipt.entry.reason !== c.reason || receipt.entry.resultFingerprint !== c.expectedFingerprint)) fail();
    } else if (q.mode === "history") {
      if (current || p || response || v.status !== null || receipt || canWrite) fail();
      const upper = Math.min(revision + 1, q.beforeRevision ?? revision + 1);
      if (history.length !== Math.min(25, upper - 1) || historyTruncated !== (upper - 1 > 25)) fail();
      const ids = new Set<string>();
      for (let i = 0; i < history.length; i++) { if (history[i].revision !== upper - 1 - i || history[i].resultVersion > resultVersion || ids.has(history[i].operationId) || i > 0 && (history[i].resultVersion > history[i - 1].resultVersion || micros(history[i].recordedAt) > micros(history[i - 1].recordedAt))) fail(); ids.add(history[i].operationId); }
    } else {
      if (receipt || history.length || historyTruncated || (current === null) !== (revision === 0) || (p === null) !== (resultVersion === 0) || v.status === null) fail();
      if (current && p && (current.revision !== revision || current.resultVersion !== resultVersion || p.resultVersion !== resultVersion || current.resultFingerprint !== p.resultFingerprint || p.revision > current.revision || micros(p.recordedAt) > micros(current.recordedAt))) fail();
      if (response && (!p || !current || !["confirm", "dispute"].includes(response.action) || response.resultVersion !== p.resultVersion || response.resultFingerprint !== p.resultFingerprint || response.actorId !== p.evidence.linkEvidence.employeeAuthUserId || response.revision <= p.revision || response.revision > current.revision || micros(response.recordedAt) < micros(p.recordedAt) || micros(response.recordedAt) > micros(current.recordedAt))) fail();
      if (current && ["confirm", "dispute"].includes(current.action) && !same(current, response) || current?.action === "propose" && response !== null) fail();
      if (current?.action === "propose" && p && !same(current, Object.fromEntries(Object.entries(p).filter(([k]) => k !== "evidence")))) fail();
      if (current && ["resolve", "reopen"].includes(current.action) && response?.action !== "confirm") fail();
      s = status(v.status, q, current, p, response, canWrite);
    }
    if (q.access === "self" && (p && p.evidence.linkEvidence.employeeAuthUserId !== actor || receipt && (receipt.proposal.evidence.linkEvidence.employeeAuthUserId !== actor || !["confirm", "dispute"].includes(receipt.entry.action)))) fail();
    return freeze({ protocol: "attendance-outage-review-v1", siteId: q.siteId, access: q.access, mode: q.mode, actorId: actor, declarationId: q.declarationId, readAt, canWrite, revision, resultVersion, current, proposal: p, response, status: s, history, historyTruncated, receipt });
  } catch { return fail(); }
}
