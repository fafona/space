import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { parseLocationDisposal } from "./merchantAttendanceLocationDisposal";
import { bool, day, enumValue, exact, freeze, hash, integer, label, micros, optionalUuid, safeTree, same, site, stamp, uuid } from "./merchantAttendancePlanExceptionValidation";
import { parseCaptureBrowserJson } from "./merchantAttendanceRuleCapturesBrowser";
import { RETENTION_API, RETENTION_BODY_LIMIT, RETENTION_CATEGORIES, RETENTION_MAX_DAYS, RETENTION_MAX_REVISION, RETENTION_RESULT_LIMIT,
  type RetentionArtifactSource, type RetentionCommand, type RetentionData, type RetentionEventSource, type RetentionLocationSource, type RetentionPolicy,
  type RetentionPreservation, type RetentionQuery, type RetentionReceipt, type RetentionRecord, type RetentionResponse, type RetentionResult, type RetentionSource } from "./merchantAttendanceRetentionContract";
export * from "./merchantAttendanceRetentionContract";
export const RETENTION_ERRORS: Readonly<Record<string, number>> = Object.freeze({
  attendance_invalid_request: 400, attendance_access_denied: 403, attendance_settings_required: 409, attendance_operation_conflict: 409,
  attendance_unavailable: 503, attendance_retention_invalid: 503, attendance_retention_not_found: 404, attendance_retention_changed: 409,
  attendance_retention_disabled: 403, attendance_retention_too_large: 422, attendance_retention_unchanged: 409,
  attendance_body_too_large: 413, attendance_invalid_content_type: 415, attendance_rate_limited: 429,
  unauthorized: 401, authentication_required: 401, enterprise_auth_unavailable: 503, enterprise_entitlement_unavailable: 503,
  enterprise_management_disabled: 403, employee_password_authentication_required: 403, forbidden_origin: 403, method_not_allowed: 405,
});
function fail(code = "attendance_retention_invalid"): never { throw new MerchantAttendanceError(code); }
const category = (v: unknown) => enumValue(v, RETENTION_CATEGORIES);
const days = (v: unknown) => v === null ? null : integer(v, 1, RETENTION_MAX_DAYS);
const revision = (v: unknown) => integer(v, 0, RETENTION_MAX_REVISION);
const zone = (v: unknown) => { const s = label(v, 100); if (!/^[A-Za-z0-9_+./-]+$/.test(s)) fail(); return s; };
const optionalStamp = (v: unknown) => v === null ? null : stamp(v);
const dayUs = BigInt(86400000000);
export function parseRetentionQuery(raw: unknown): RetentionQuery {
  try {
    safeTree(raw, 4096); const base = raw as Record<string, unknown>; const mode = base?.mode;
    if (mode === "policies") { const q = exact(raw, ["siteId", "mode"]); return freeze({ siteId: site(q.siteId), mode }); }
    if (mode === "recover") { const q = exact(raw, ["siteId", "mode", "operationId"]); return freeze({ siteId: site(q.siteId), mode, operationId: uuid(q.operationId) }); }
    if (mode === "record") { const q = exact(raw, ["siteId", "mode", "category", "recordId"]); return freeze({ siteId: site(q.siteId), mode, category: category(q.category), recordId: uuid(q.recordId) }); }
    if (mode === "history") { const q = exact(raw, ["siteId", "mode", "category", "recordId", "beforeRevision"]); return freeze({ siteId: site(q.siteId), mode,
      category: category(q.category), recordId: optionalUuid(q.recordId), beforeRevision: q.beforeRevision === null ? null : integer(q.beforeRevision, 1, Number.MAX_SAFE_INTEGER) }); }
    if (mode === "preview" && base.category === "period_artifact") { const q = exact(raw, ["siteId", "mode", "category", "workerId", "periodId"]); return freeze({ siteId: site(q.siteId), mode, category: "period_artifact", workerId: uuid(q.workerId), periodId: uuid(q.periodId) }); }
    if (mode === "preview") {
      const q = exact(raw, ["siteId", "mode", "category", "workerId", "fromAt", "toAt"]), fromAt = stamp(q.fromAt), toAt = stamp(q.toAt);
      if (micros(toAt) <= micros(fromAt) || micros(toAt) - micros(fromAt) > dayUs * BigInt(31)) fail();
      return freeze({ siteId: site(q.siteId), mode, category: enumValue(q.category, ["events", "location_results"] as const), workerId: uuid(q.workerId), fromAt, toAt });
    }
    return fail();
  } catch { return fail("attendance_invalid_request"); }
}
export function parseRetentionCommand(raw: unknown): RetentionCommand {
  try {
    safeTree(raw, RETENTION_BODY_LIMIT); const action = (raw as Record<string, unknown>)?.action;
    const c = exact(raw, action === "set_policy" ? ["siteId", "action", "operationId", "category", "expectedRevision", "retentionDays", "reason"]
      : ["siteId", "action", "operationId", "category", "recordId", "expectedRevision", "expectedSourceFingerprint", "reason"]);
    const common = { siteId: site(c.siteId), operationId: uuid(c.operationId), category: category(c.category), expectedRevision: integer(c.expectedRevision, 0, RETENTION_MAX_REVISION - 1), reason: label(c.reason, 500) };
    if (action === "set_policy") return freeze({ ...common, action, retentionDays: days(c.retentionDays) });
    const parsed = enumValue(action, ["hold", "release"] as const);
    if (parsed === "release" && common.expectedRevision === 0) fail();
    return freeze({ ...common, action: parsed, recordId: uuid(c.recordId), expectedSourceFingerprint: hash(c.expectedSourceFingerprint) });
  } catch { return fail("attendance_invalid_request"); }
}
export function retentionWriteQuery(raw: RetentionCommand): RetentionQuery {
  const c = parseRetentionCommand(raw); return c.action === "set_policy" ? { siteId: c.siteId, mode: "policies" }
    : { siteId: c.siteId, mode: "record", category: c.category, recordId: c.recordId };
}
export function retentionCommandFingerprintText(raw: RetentionCommand): string {
  const c = parseRetentionCommand(raw); return JSON.stringify(["attendance-retention-command-v1", c.siteId, c.action, c.category,
    c.action === "set_policy" ? null : c.recordId, c.operationId, c.expectedRevision, c.action === "set_policy" ? c.retentionDays : null,
    c.action === "set_policy" ? null : c.expectedSourceFingerprint, c.reason]);
}
export function parseRetentionBody(raw: unknown): { query: RetentionQuery; command: RetentionCommand } {
  try { safeTree(raw, RETENTION_BODY_LIMIT); const b = exact(raw, ["query", "command"]), query = parseRetentionQuery(b.query), command = parseRetentionCommand(b.command);
    if (!same(query, retentionWriteQuery(command))) fail(); return freeze({ query, command });
  } catch { return fail("attendance_invalid_request"); }
}
export function retentionQueryString(raw: RetentionQuery): string {
  return new URLSearchParams(Object.entries(parseRetentionQuery(raw)).filter(([, v]) => v !== null).map(([k, v]) => [k, String(v)])).toString();
}
export function parseRetentionHttpQuery(url: string): RetentionQuery {
  try {
    if (typeof url !== "string" || new TextEncoder().encode(url).byteLength > 4096 || !/^https?:\/\//.test(url)
      || /\s|[\u0000-\u001f\u007f-\u009f]|[#\\]/.test(url) || /[\u0000-\u001f\u007f-\u009f]/.test(decodeURIComponent(url))) fail();
    const u = new URL(url); if (u.username || u.password || u.hash || u.pathname !== RETENTION_API) fail();
    const q: Record<string, unknown> = {}, seen = new Set<string>();
    for (const [k, v] of u.searchParams) { if (seen.has(k) || !v || !["siteId", "mode", "category", "recordId", "beforeRevision", "operationId", "workerId", "periodId", "fromAt", "toAt"].includes(k)) fail(); seen.add(k); q[k] = v; }
    if (q.mode === "history") { if (!seen.has("recordId")) q.recordId = null; if (!seen.has("beforeRevision")) q.beforeRevision = null;
      else { if (!/^[1-9][0-9]{0,15}$/.test(String(q.beforeRevision))) fail(); q.beforeRevision = Number(q.beforeRevision); } }
    return parseRetentionQuery(q);
  } catch { return fail("attendance_invalid_request"); }
}
function eventSource(raw: unknown): RetentionEventSource {
  const v = exact(raw, ["kind", "eventId", "workerId", "locationId", "operationId", "sequence", "action", "rawSource", "breakPaid", "occurredAt", "receivedAt", "timeZone", "actorEmployeeId"]);
  if (v.kind !== "event") fail(); const action = enumValue(v.action, ["clock_in", "break_start", "break_end", "clock_out"] as const);
  const breakPaid = v.breakPaid === null ? null : bool(v.breakPaid); if ((action === "break_start") !== (breakPaid !== null)) fail();
  return { kind: "event", eventId: uuid(v.eventId), workerId: uuid(v.workerId), locationId: uuid(v.locationId), operationId: uuid(v.operationId),
    sequence: integer(v.sequence, 1, Number.MAX_SAFE_INTEGER), action, rawSource: enumValue(v.rawSource, ["web", "kiosk"] as const), breakPaid,
    occurredAt: stamp(v.occurredAt), receivedAt: stamp(v.receivedAt), timeZone: zone(v.timeZone), actorEmployeeId: optionalUuid(v.actorEmployeeId) };
}
function source(raw: unknown, cat: RetentionRecord["category"], id: string): RetentionSource {
  if (cat === "events") { const e = eventSource(raw); if (e.eventId !== id) fail(); return e; }
  if (cat === "location_results") {
    const v = exact(raw, ["kind", "event", "settingsVersion", "workerVersion", "locationVersion", "algorithmVersion", "reason", "needsReview", "capturedAt", "accuracyMeters", "distanceMeters",
      ...(raw !== null && typeof raw === "object" && Object.hasOwn(raw, "disposal") ? ["disposal"] : [])]);
    const reason = enumValue(v.reason, ["inside", "outside", "uncertain", "stale", "future", "denied", "timeout", "unavailable", "unsupported", "not_provided"] as const);
    if (v.kind !== "location_summary" || v.algorithmVersion !== 1) fail(); const e = eventSource(v.event), needsReview = bool(v.needsReview), capturedAt = optionalStamp(v.capturedAt);
    if (e.eventId !== id || needsReview !== (reason !== "inside")) fail();
    if (Object.hasOwn(v, "disposal")) {
      const disposed = parseLocationDisposal(v.disposal, { reason, needsReview, capturedAt, accuracyMeters: v.accuracyMeters, distanceMeters: v.distanceMeters }, e.occurredAt);
      return { kind: "location_summary", event: e, settingsVersion: integer(v.settingsVersion, 1, Number.MAX_SAFE_INTEGER), workerVersion: integer(v.workerVersion, 1, Number.MAX_SAFE_INTEGER),
        locationVersion: integer(v.locationVersion, 1, Number.MAX_SAFE_INTEGER), algorithmVersion: 1, ...disposed } satisfies RetentionLocationSource;
    }
    const located = ["inside", "outside", "uncertain", "stale", "future"].includes(reason);
    if (located ? capturedAt === null || typeof v.accuracyMeters !== "number" || !Number.isFinite(v.accuracyMeters) || v.accuracyMeters < 0 || v.accuracyMeters > 40100000
      : capturedAt !== null || v.accuracyMeters !== null || v.distanceMeters !== null) fail();
    return { kind: "location_summary", event: e, settingsVersion: integer(v.settingsVersion, 1, Number.MAX_SAFE_INTEGER), workerVersion: integer(v.workerVersion, 1, Number.MAX_SAFE_INTEGER),
      locationVersion: integer(v.locationVersion, 1, Number.MAX_SAFE_INTEGER), algorithmVersion: 1, reason, needsReview, capturedAt,
      accuracyMeters: located ? v.accuracyMeters as number : null, distanceMeters: located ? integer(v.distanceMeters, 0, 20100000) : null } satisfies RetentionLocationSource;
  }
  const v = exact(raw, ["kind", "artifactId", "periodId", "workerId", "employeeId", "fromDate", "throughDate", "timeZone", "startAt", "endAt", "recordedAt", "artifactSha256", "artifactBytes", "sourceFingerprint"]);
  if (v.kind !== "period_artifact" || uuid(v.artifactId) !== id) fail(); const startAt = stamp(v.startAt), endAt = stamp(v.endAt), fromDate = day(v.fromDate), throughDate = day(v.throughDate);
  if (micros(endAt) <= micros(startAt) || throughDate < fromDate || Date.parse(throughDate) - Date.parse(fromDate) > 30 * 86400000) fail();
  return { kind: "period_artifact", artifactId: id, periodId: uuid(v.periodId), workerId: uuid(v.workerId), employeeId: uuid(v.employeeId), fromDate, throughDate,
    timeZone: zone(v.timeZone), startAt, endAt, recordedAt: stamp(v.recordedAt), artifactSha256: hash(v.artifactSha256), artifactBytes: integer(v.artifactBytes, 1, 2097152), sourceFingerprint: hash(v.sourceFingerprint) } satisfies RetentionArtifactSource;
}
function policy(raw: unknown): RetentionPolicy {
  const p = exact(raw, ["category", "revision", "retentionDays", "operationId", "recordedAt"]);
  const result = { category: category(p.category), revision: revision(p.revision), retentionDays: days(p.retentionDays), operationId: optionalUuid(p.operationId), recordedAt: optionalStamp(p.recordedAt) };
  if (result.revision === 0 ? result.retentionDays !== null || result.operationId !== null || result.recordedAt !== null : result.operationId === null || result.recordedAt === null) fail();
  return result;
}
function preservation(raw: unknown): RetentionPreservation {
  const p = exact(raw, ["revision", "held", "operationId", "actorId", "reason", "recordedAt"]);
  const result = { revision: revision(p.revision), held: bool(p.held), operationId: optionalUuid(p.operationId), actorId: optionalUuid(p.actorId), reason: p.reason === null ? null : label(p.reason, 500), recordedAt: optionalStamp(p.recordedAt) };
  if (result.revision === 0 ? result.held || result.operationId !== null || result.actorId !== null || result.reason !== null || result.recordedAt !== null
    : result.operationId === null || result.actorId === null || result.reason === null || result.recordedAt === null || result.revision === 1 && !result.held) fail();
  return result;
}
function record(raw: unknown, readAt: string): RetentionRecord {
  const v = exact(raw, ["category", "recordId", "source", "sourceFingerprint", "policy", "anchorAt", "asOf", "dueAt", "ageState", "preservation"]);
  const cat = category(v.category), id = uuid(v.recordId), s = source(v.source, cat, id), p = policy(v.policy), preserved = preservation(v.preservation);
  const anchorAt = stamp(v.anchorAt), asOf = stamp(v.asOf), dueAt = optionalStamp(v.dueAt), ageState = enumValue(v.ageState, ["unconfigured", "not_due", "due"] as const);
  if (s.kind === "location_summary" && s.disposal && s.disposal.disposedAt > asOf) fail();
  const anchor = s.kind === "period_artifact" ? s.recordedAt : s.kind === "event" ? s.receivedAt : s.event.receivedAt;
  if (p.category !== cat || anchorAt !== anchor || micros(asOf) > micros(readAt) || p.recordedAt !== null && micros(p.recordedAt) > micros(readAt)
    || preserved.recordedAt !== null && micros(preserved.recordedAt) > micros(readAt)) fail();
  if (p.retentionDays === null ? dueAt !== null || ageState !== "unconfigured" : dueAt === null || micros(dueAt) !== micros(anchorAt) + BigInt(p.retentionDays) * dayUs
    || ageState !== (micros(asOf) >= micros(dueAt) ? "due" : "not_due")) fail();
  return { category: cat, recordId: id, source: s, sourceFingerprint: hash(v.sourceFingerprint), policy: p, anchorAt, asOf, dueAt, ageState, preservation: preserved };
}
function receipt(raw: unknown, siteId: string, readAt: string): RetentionReceipt {
  const r = exact(raw, ["operationId", "actorId", "revision", "command", "commandFingerprint", "recordedAt"]), c = parseRetentionCommand(r.command);
  const result = { operationId: uuid(r.operationId), actorId: uuid(r.actorId), revision: integer(r.revision, 1, RETENTION_MAX_REVISION), command: c, commandFingerprint: hash(r.commandFingerprint), recordedAt: stamp(r.recordedAt) };
  if (c.siteId !== siteId || c.operationId !== result.operationId || result.revision !== c.expectedRevision + 1 || micros(result.recordedAt) > micros(readAt)) fail(); return result;
}
export function retentionReceiptMatches(r: RetentionReceipt | null, c: RetentionCommand, fingerprint: string): boolean {
  return !!r && r.operationId === c.operationId && r.revision === c.expectedRevision + 1 && r.commandFingerprint === fingerprint && same(r.command, c);
}
export function parseRetentionResult(raw: unknown, input: RetentionQuery, actorId: string, command: RetentionCommand | null = null): RetentionResult {
  try {
    safeTree(raw, RETENTION_RESULT_LIMIT); const q = parseRetentionQuery(input), actor = uuid(actorId), c = command === null ? null : parseRetentionCommand(command);
    if (c && !same(q, retentionWriteQuery(c))) fail();
    const r = exact(raw, ["protocol", "siteId", "actorId", "readAt", "canWrite", "data", "receipt", "disposition"]);
    if (r.protocol !== "attendance-retention-v1" || r.siteId !== q.siteId || r.actorId !== actor || r.disposition !== "preview_only") fail();
    const readAt = stamp(r.readAt), canWrite = bool(r.canWrite), saved = r.receipt === null ? null : receipt(r.receipt, q.siteId, readAt); let data: RetentionData;
    if (c || q.mode === "recover") {
      const d = exact(r.data, ["kind"]); if (d.kind !== "receipt" || canWrite || c && (!saved || !same(saved.command, c))
        || saved && (saved.actorId !== actor || saved.operationId !== (c?.operationId ?? (q.mode === "recover" ? q.operationId : null)))) fail(); data = { kind: "receipt" };
    } else {
      if (saved !== null) fail();
      if (q.mode === "policies") {
        const d = exact(r.data, ["kind", "items"]); if (d.kind !== "policies" || !Array.isArray(d.items) || d.items.length !== 3) fail();
        const items = d.items.map(policy); if (items.some((p, i) => p.category !== RETENTION_CATEGORIES[i] || p.recordedAt !== null && micros(p.recordedAt) > micros(readAt))) fail(); data = { kind: "policies", items };
      } else if (q.mode === "record") {
        const d = exact(r.data, ["kind", "item"]); if (d.kind !== "record") fail(); const item = record(d.item, readAt);
        if (item.category !== q.category || item.recordId !== q.recordId || item.asOf !== readAt) fail(); data = { kind: "record", item };
      } else if (q.mode === "preview") {
        const d = exact(r.data, ["kind", "asOf", "items"]); if (d.kind !== "preview" || canWrite || stamp(d.asOf) !== readAt || !Array.isArray(d.items) || d.items.length > 100) fail();
        const items = d.items.map(v => record(v, readAt)), ids = new Set<string>(); let previous: { at: string; id: string } | null = null;
        for (const item of items) {
          const s = item.source, e = s.kind === "location_summary" ? s.event : s; const at = s.kind === "period_artifact" ? s.recordedAt : (e as RetentionEventSource).occurredAt;
          if (item.category !== q.category || item.asOf !== readAt || e.workerId !== q.workerId || ids.has(item.recordId)) fail(); ids.add(item.recordId);
          if (q.category === "period_artifact" ? s.kind !== "period_artifact" || s.periodId !== q.periodId
            : micros(at) < micros(q.fromAt) || micros(at) >= micros(q.toAt)) fail();
          if (previous && (at > previous.at || at === previous.at && item.recordId >= previous.id)) fail(); previous = { at, id: item.recordId };
        } data = { kind: "preview", asOf: readAt, items };
      } else {
        const d = exact(r.data, ["kind", "items", "nextBeforeRevision"]); if (d.kind !== "history" || canWrite || !Array.isArray(d.items) || d.items.length > 25) fail();
        const items = d.items.map(v => receipt(v, q.siteId, readAt)), ids = new Set<string>();
        for (let i = 0; i < items.length; i++) { const entry = items[i], cmd = entry.command;
          if (cmd.category !== q.category || (cmd.action === "set_policy" ? q.recordId !== null : cmd.recordId !== q.recordId) || ids.has(entry.operationId)
            || q.beforeRevision !== null && entry.revision >= q.beforeRevision || i > 0 && items[i - 1].revision !== entry.revision + 1) fail(); ids.add(entry.operationId); }
        const nextBeforeRevision = d.nextBeforeRevision === null ? null : integer(d.nextBeforeRevision, 2, RETENTION_MAX_REVISION);
        if (nextBeforeRevision !== null && (items.length !== 25 || nextBeforeRevision !== items.at(-1)?.revision)) fail(); data = { kind: "history", items, nextBeforeRevision };
      }
    }
    return freeze({ protocol: "attendance-retention-v1", siteId: q.siteId, actorId: actor, readAt, canWrite, data, receipt: saved, disposition: "preview_only" });
  } catch { return fail(); }
}
export function parseRetentionResponse(raw: unknown, q: RetentionQuery, actorId: string, command: RetentionCommand | null = null): RetentionResponse {
  try {
    if (typeof raw === "string") { if (new TextEncoder().encode(raw).byteLength > RETENTION_RESULT_LIMIT) fail(); raw = parseCaptureBrowserJson(raw); }
    safeTree(raw, RETENTION_RESULT_LIMIT); const r = exact(raw, ["ok", "canWrite", "data"]); if (r.ok !== true) fail();
    const canWrite = bool(r.canWrite), result = parseRetentionResult(r.data, q, actorId, command); if (canWrite !== result.canWrite) fail(); return freeze({ canWrite, result });
  } catch { return fail(); }
}
