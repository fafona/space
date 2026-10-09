// Browser-safe compact evidence. The server verified stored bytes and hash;
// this parser validates the projection, NOT an independent browser hash proof.
// Historical zone labels are opaque: never recompute their saved UTC meaning.
import type { ShiftRuleBinding, ShiftRuleBindingQuery, ShiftRuleBindingWorker, ShiftRuleBindingEvent, ShiftRuleField, ShiftRuleProvenance } from "./merchantAttendanceShiftRuleBinding";
import { captureBrowserExact, captureBrowserUuid } from "./merchantAttendanceRuleCapturesBrowser";
import { MerchantAttendanceError } from "./merchantAttendanceTime";

export type ShiftRuleViewQuery = ShiftRuleBindingQuery;
export type ShiftRuleViewBinding = Omit<ShiftRuleBinding, "source">;
export type ShiftRuleViewField = ShiftRuleField;
export const SHIFT_RULE_VIEW_KEYS = Object.freeze(["lateGraceMinutes", "earlyGraceMinutes", "openSpanWarningMinutes", "completedBreakMinimumMinutes"] as const);
export type ShiftRuleViewEvidence = {
  sourceId: string; sourceSha256: string; sourceBytes: number; timeZone: string;
  group: null | { groupId: string; name: string; revision: number; assignmentId: string; assignmentRevision: number };
  enterpriseRevision: number; groupRevision: number | null; personalRevision: number;
  fields: Record<typeof SHIFT_RULE_VIEW_KEYS[number], ShiftRuleViewField>;
};
export type ShiftRuleViewResult = {
  protocol: "shift-rule-binding-view-v1"; readOnly: true; formalReady: false; siteId: string; actorId: string;
  worker: ShiftRuleBindingWorker; event: ShiftRuleBindingEvent; status: "missing" | "unverified" | "verified";
  reason: string | null; binding: ShiftRuleViewBinding | null; evidence: ShiftRuleViewEvidence | null; readAt: string;
};
export type ShiftRuleViewResponse = ShiftRuleViewResult & { moduleEnabled: boolean };
export const SHIFT_RULE_VIEW_ERRORS: Readonly<Record<string, number>> = Object.freeze({
  attendance_invalid_request: 400, attendance_access_denied: 403, attendance_not_available: 404, attendance_worker_not_found: 404,
  attendance_settings_required: 409, attendance_unavailable: 503, attendance_rate_limited: 429,
  attendance_shift_rule_binding_invalid: 503, attendance_shift_rule_binding_identity_changed: 409, attendance_shift_rule_binding_not_found: 404,
  attendance_shift_rule_view_invalid: 503,
});
const REASONS = ["source_unavailable", "source_invalid", "source_conflict", "identity_unavailable", "identity_changed", "inactive_worker", "inactive_employee",
  "invalid_date", "assignment_overlap", "inactive_group", "personal_overlap", "source_cap", "source_quota", "source_too_large"];
const BYTE_LIMIT = 32768;
const fail = (): never => { throw new MerchantAttendanceError("attendance_shift_rule_view_invalid"); };
const exact = captureBrowserExact, uuid = captureBrowserUuid;
const site = (v: unknown): string => typeof v === "string" && /^\d{8}$/.test(v) ? v : fail();
const integer = (v: unknown, minimum = 1, maximum = 9007199254740990): number => typeof v === "number" && Number.isSafeInteger(v) && !Object.is(v, -0) && v >= minimum && v <= maximum ? v : fail();
const bool = (v: unknown): boolean => typeof v === "boolean" ? v : fail();
function wellFormed(v: string) {
  for (let i = 0; i < v.length; i++) {
    const unit = v.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) { const next = v.charCodeAt(++i); if (!(next >= 0xdc00 && next <= 0xdfff)) fail(); }
    else if (unit >= 0xdc00 && unit <= 0xdfff) fail();
  }
}
function label(v: unknown, maximum: number): string {
  if (typeof v !== "string" || !v || v !== v.trim() || [...v].length > maximum || /[\u0000-\u001f\u007f-\u009f]/.test(v)) return fail();
  wellFormed(v); return v;
}
function stamp(v: unknown): string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(v) || v.startsWith("0000-")) return fail();
  const short = v.slice(0, 23) + "Z", ms = Date.parse(short); if (!Number.isFinite(ms) || new Date(ms).toISOString() !== short) fail(); return v;
}
function tree(raw: unknown) {
  let count = 0; const seen = new Set<object>();
  const visit = (v: unknown, depth: number) => {
    if (++count > 2000 || depth > 16) fail();
    if (v === null || typeof v === "boolean") return;
    if (typeof v === "string") { if (v.length > BYTE_LIMIT) fail(); wellFormed(v); return; }
    if (typeof v === "number") { if (!Number.isFinite(v) || Object.is(v, -0)) fail(); return; }
    if (!v || typeof v !== "object" || seen.has(v)) return fail(); seen.add(v);
    const proto = Object.getPrototypeOf(v), keys = Reflect.ownKeys(v), desc = Object.getOwnPropertyDescriptors(v);
    if (Array.isArray(v)) {
      if (proto !== Array.prototype || v.length > 3 || keys.length !== v.length + 1) fail();
      for (let i = 0; i < v.length; i++) { const d = desc[String(i)]; if (!d || !("value" in d) || !d.enumerable) fail(); visit(d.value, depth + 1); }
    } else {
      if (proto !== Object.prototype && proto !== null) fail();
      for (const key of keys) {
        if (typeof key !== "string" || ["__proto__", "constructor", "prototype"].includes(key)) return fail();
        const d = desc[key]; if (!("value" in d) || !d.enumerable) fail(); visit(d.value, depth + 1);
      }
    }
    seen.delete(v);
  };
  visit(raw, 0); if (new TextEncoder().encode(JSON.stringify(raw)).byteLength > BYTE_LIMIT) fail();
}
function freeze<T>(v: T): T { if (v && typeof v === "object") { Object.values(v).forEach(freeze); Object.freeze(v); } return v; }
const queryKeys = ["siteId", "workerId", "startEventId"];
export function parseShiftRuleViewQuery(raw: unknown): ShiftRuleViewQuery {
  try { const q = exact(raw, queryKeys); return { siteId: site(q.siteId), workerId: uuid(q.workerId), startEventId: uuid(q.startEventId) }; }
  catch { throw new MerchantAttendanceError("attendance_invalid_request"); }
}
export function parseShiftRuleViewHttpQuery(url: string): ShiftRuleViewQuery {
  try {
    const q = Object.create(null) as Record<string, unknown>, params = new URL(url).searchParams;
    for (const [key, value] of params) { if (!queryKeys.includes(key) || params.getAll(key).length !== 1) fail(); q[key] = value; }
    return parseShiftRuleViewQuery(q);
  } catch { throw new MerchantAttendanceError("attendance_invalid_request"); }
}
export const shiftRuleViewQueryString = (q: ShiftRuleViewQuery) => new URLSearchParams(parseShiftRuleViewQuery(q)).toString();
type Layer = "personal" | "group" | "enterprise";
const layers = ["personal", "group", "enterprise"] as const;
const sameSource = (a: ShiftRuleProvenance | null, b: ShiftRuleProvenance | null) => a === null || b === null ? a === b
  : a.layer === b.layer && a.groupId === b.groupId && a.ledgerRevision === b.ledgerRevision && a.operationId === b.operationId && a.revision === b.revision && a.actorId === b.actorId;
function provenance(raw: unknown, layer: Layer, groupId: string | null, head: number | null): ShiftRuleProvenance {
  const p = exact(raw, ["layer", "groupId", "ledgerRevision", "operationId", "revision", "actorId"]);
  if (head === null || p.layer !== layer || p.groupId !== groupId || p.ledgerRevision !== head) fail();
  return { layer, groupId, ledgerRevision: head!, operationId: uuid(p.operationId), revision: integer(p.revision, layer === "personal" ? 1 : 2, head!), actorId: uuid(p.actorId) };
}
function evidence(raw: unknown): ShiftRuleViewEvidence {
  const e = exact(raw, ["sourceId", "sourceSha256", "sourceBytes", "timeZone", "group", "enterpriseRevision", "groupRevision", "personalRevision", "fields"]);
  if (typeof e.sourceSha256 !== "string" || !/^[0-9a-f]{64}$/.test(e.sourceSha256)) fail();
  let group: ShiftRuleViewEvidence["group"] = null;
  if (e.group !== null) {
    const g = exact(e.group, ["groupId", "name", "revision", "assignmentId", "assignmentRevision"]);
    group = { groupId: uuid(g.groupId), name: label(g.name, 80), revision: integer(g.revision), assignmentId: uuid(g.assignmentId), assignmentRevision: integer(g.assignmentRevision, 1, 2) };
  }
  if ((group === null) !== (e.groupRevision === null)) fail();
  const enterpriseRevision = integer(e.enterpriseRevision, 0), personalRevision = integer(e.personalRevision, 0), groupRevision = e.groupRevision === null ? null : integer(e.groupRevision, 0);
  const f = exact(e.fields, SHIFT_RULE_VIEW_KEYS), fields = {} as ShiftRuleViewEvidence["fields"], knownLayers = new Map<Layer, { source: ShiftRuleProvenance | null; missingMode: string | null }>();
  SHIFT_RULE_VIEW_KEYS.forEach((key, keyIndex) => {
    const field = exact(f[key], ["state", "minutes", "source", "trace"]);
    if (!Array.isArray(field.trace) || field.trace.length !== 3) fail();
    const trace: ShiftRuleViewField["trace"] = (field.trace as unknown[]).map((rawTrace, index) => {
      const t = exact(rawTrace, ["layer", "groupId", "ledgerRevision", "mode", "minutes", "source"]), layer = layers[index];
      const gid = layer === "group" ? group?.groupId ?? null : null, head = layer === "personal" ? personalRevision : layer === "group" ? groupRevision : enterpriseRevision;
      if (t.layer !== layer || t.groupId !== gid || t.ledgerRevision !== head) fail();
      const missingMode = layer === "personal" ? "missing_approval" : layer === "group" && !group ? "no_assignment" : "missing_publication";
      let source: ShiftRuleProvenance | null = null, minutes: number | null = null;
      if (t.mode === missingMode) { if (t.source !== null || t.minutes !== null) fail(); }
      else {
        if (t.mode !== "inherit" && t.mode !== "disabled" && t.mode !== "value") fail();
        source = provenance(t.source, layer, gid, head);
        if (t.mode === "value") minutes = integer(t.minutes, keyIndex < 2 ? 0 : 1, keyIndex === 2 ? 44640 : 1440);
        else if (t.minutes !== null) fail();
      }
      const previous = knownLayers.get(layer), absent = source === null ? missingMode : null;
      if (previous && (!sameSource(previous.source, source) || previous.missingMode !== absent)) fail();
      knownLayers.set(layer, { source, missingMode: absent });
      return { layer, groupId: gid, ledgerRevision: head, mode: t.mode as string, minutes, source };
    });
    const selected = trace.find(t => t.mode === "disabled" || t.mode === "value");
    const state = selected ? selected.mode as "disabled" | "value" : "unconfigured", minutes = selected?.minutes ?? null, source = selected?.source ?? null;
    if (field.state !== state || field.minutes !== minutes) fail();
    if (source === null ? field.source !== null : !sameSource(provenance(field.source, source.layer, source.groupId, source.ledgerRevision), source)) fail();
    fields[key] = { state, minutes, source, trace };
  });
  // 129 forbids an all-inherit approved personal record. The compact traces
  // preserve this producer invariant without retrieving the original body.
  if (knownLayers.get("personal")!.source !== null && SHIFT_RULE_VIEW_KEYS.every(k => fields[k].trace[0].mode === "inherit")) fail();
  return { sourceId: uuid(e.sourceId), sourceSha256: e.sourceSha256 as string, sourceBytes: integer(e.sourceBytes, 1, 65536), timeZone: label(e.timeZone, 100),
    group, enterpriseRevision, groupRevision, personalRevision, fields };
}

export function parseShiftRuleViewResult(raw: unknown, input: ShiftRuleViewQuery, expectedActorId: string): ShiftRuleViewResult {
  const q = parseShiftRuleViewQuery(input);
  try {
    tree(raw); const v = exact(raw, ["protocol", "readOnly", "formalReady", "siteId", "actorId", "worker", "event", "status", "reason", "binding", "evidence", "readAt"]);
    const actorId = uuid(v.actorId), readAt = stamp(v.readAt), w = exact(v.worker, ["workerId", "workerName", "workerNo", "employeeId", "employeeAuthUserId", "version", "active", "employeeActive"]);
    const worker: ShiftRuleBindingWorker = { workerId: uuid(w.workerId), workerName: label(w.workerName, 120), workerNo: label(w.workerNo, 40), employeeId: uuid(w.employeeId), employeeAuthUserId: uuid(w.employeeAuthUserId), version: integer(w.version), active: bool(w.active), employeeActive: bool(w.employeeActive) };
    const e = exact(v.event, ["startEventId", "operationId", "sequence", "locationId", "occurredAt", "timeZone", "source", "employeeId"]);
    if (e.source !== "web" && e.source !== "kiosk") fail();
    const event: ShiftRuleBindingEvent = { startEventId: uuid(e.startEventId), operationId: uuid(e.operationId), sequence: integer(e.sequence), locationId: uuid(e.locationId), occurredAt: stamp(e.occurredAt), timeZone: label(e.timeZone, 100), source: e.source as "web" | "kiosk", employeeId: uuid(e.employeeId) };
    if (v.protocol !== "shift-rule-binding-view-v1" || v.readOnly !== true || v.formalReady !== false || v.siteId !== q.siteId || actorId !== uuid(expectedActorId)
      || worker.workerId !== q.workerId || event.startEventId !== q.startEventId || event.employeeId !== worker.employeeId || event.occurredAt > readAt
      || !["missing", "unverified", "verified"].includes(v.status as string)) fail();
    let binding: ShiftRuleViewBinding | null = null, savedEvidence: ShiftRuleViewEvidence | null = null;
    if (v.status === "missing") { if (v.reason !== "binding_missing" || v.binding !== null || v.evidence !== null) fail(); }
    else {
      const b = exact(v.binding, ["channel", "requestAuthUserId", "employeeId", "employeeAuthUserId", "workerVersion", "settingsVersion", "algorithmVersion", "bindingPolicy", "recordedAt"]);
      if (!["self", "location", "pin", "onsite"].includes(b.channel as string) || b.algorithmVersion !== "personal-group-enterprise-point-v1" || b.bindingPolicy !== "clock-in-whole-shift-v1"
        || uuid(b.employeeId) !== worker.employeeId || uuid(b.employeeAuthUserId) !== worker.employeeAuthUserId
        || (b.channel === "pin" ? b.requestAuthUserId !== null || event.source !== "kiosk" : uuid(b.requestAuthUserId) !== worker.employeeAuthUserId || event.source !== "web")) fail();
      const workerVersion = b.workerVersion === null ? null : integer(b.workerVersion), settingsVersion = b.settingsVersion === null ? null : integer(b.settingsVersion), recordedAt = stamp(b.recordedAt);
      if (recordedAt > readAt || workerVersion !== null && workerVersion > worker.version) fail();
      binding = { channel: b.channel as ShiftRuleViewBinding["channel"], requestAuthUserId: b.requestAuthUserId as string | null, employeeId: worker.employeeId, employeeAuthUserId: worker.employeeAuthUserId,
        workerVersion, settingsVersion, algorithmVersion: "personal-group-enterprise-point-v1", bindingPolicy: "clock-in-whole-shift-v1", recordedAt };
      if (v.status === "verified") {
        if (v.reason !== null || workerVersion === null || settingsVersion === null || recordedAt < event.occurredAt) fail(); savedEvidence = evidence(v.evidence);
      } else if (typeof v.reason !== "string" || !REASONS.includes(v.reason) || v.evidence !== null) fail();
    }
    return freeze({ protocol: "shift-rule-binding-view-v1", readOnly: true, formalReady: false, siteId: q.siteId, actorId, worker, event,
      status: v.status as ShiftRuleViewResult["status"], reason: v.reason as string | null, binding, evidence: savedEvidence, readAt });
  } catch { return fail(); }
}
export function parseShiftRuleViewResponse(raw: unknown, query: ShiftRuleViewQuery, actorId: string): ShiftRuleViewResponse {
  try { tree(raw); const v = exact(raw, ["ok", "moduleEnabled", "data"]); if (v.ok !== true) fail();
    return freeze({ ...parseShiftRuleViewResult(v.data, query, actorId), moduleEnabled: bool(v.moduleEnabled) });
  } catch { return fail(); }
}
