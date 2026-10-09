// Server-side frozen point verification. No current timezone/rule lookup and no
// conversion of a verified source selection into a payroll/attendance decision.
import { createHash } from "node:crypto";
import { captureBrowserExact, captureBrowserUuid, parseCaptureBrowserJson } from "./merchantAttendanceRuleCapturesBrowser";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import type { GroupAssignmentDetail, GroupItem } from "./merchantAttendanceGroups";
import type { RulesItem } from "./merchantAttendanceRules";
import type { PersonalRulesItem } from "./merchantAttendancePersonalRules";

export type ShiftRuleBindingQuery = { siteId: string; workerId: string; startEventId: string };
export type ShiftRuleBindingWorker = { workerId: string; workerName: string; workerNo: string; employeeId: string; employeeAuthUserId: string; version: number; active: boolean; employeeActive: boolean };
export type ShiftRuleBindingEvent = { startEventId: string; operationId: string; sequence: number; locationId: string; occurredAt: string; timeZone: string; source: "web" | "kiosk"; employeeId: string };
export type ShiftRuleBindingSource = { sourceId: string; sourceText: string; sourceSha256: string; sourceBytes: number; canonicalFormat: "pg-jsonb-text-utf8-v1" };
export type ShiftRuleBinding = { channel: "self" | "location" | "pin" | "onsite"; requestAuthUserId: string | null; employeeId: string; employeeAuthUserId: string;
  workerVersion: number | null; settingsVersion: number | null; algorithmVersion: "personal-group-enterprise-point-v1"; bindingPolicy: "clock-in-whole-shift-v1"; recordedAt: string; source: ShiftRuleBindingSource | null };
export type ShiftRuleBindingResult = { protocol: "shift-rule-binding-v1"; readOnly: true; formalReady: false; siteId: string; actorId: string; worker: ShiftRuleBindingWorker;
  event: ShiftRuleBindingEvent; status: "missing" | "unverified" | "verified"; reason: string | null; binding: ShiftRuleBinding | null; readAt: string };
export type ShiftRuleBindingResponse = ShiftRuleBindingResult & { moduleEnabled: boolean };
export const SHIFT_RULE_KEYS = ["lateGraceMinutes", "earlyGraceMinutes", "openSpanWarningMinutes", "completedBreakMinimumMinutes"] as const;
type RuleKey = typeof SHIFT_RULE_KEYS[number];
type Layer = "personal" | "group" | "enterprise";
export type ShiftRuleProvenance = { layer: Layer; groupId: string | null; ledgerRevision: number; operationId: string; revision: number; actorId: string };
export type ShiftRuleField = { state: "unconfigured" | "disabled" | "value"; minutes: number | null; source: ShiftRuleProvenance | null;
  trace: { layer: Layer; groupId: string | null; ledgerRevision: number | null; mode: string; minutes: number | null; source: ShiftRuleProvenance | null }[] };
export type ShiftRulePoint = { protocol: "shift-rule-point-v1"; algorithmVersion: "personal-group-enterprise-point-v1"; bindingPolicy: "clock-in-whole-shift-v1";
  siteId: string; workerId: string; employeeId: string; employeeAuthUserId: string; workerVersion: number; settingsVersion: number; timeZone: string;
  assignment: null | { detail: GroupAssignmentDetail; workerVersion: number; settingsVersion: number; groupRevision: number; fromAt: string; toAt: string | null; originalFromAt: string; originalToAt: string | null };
  enterprise: { revision: number; publication: RulesItem | null }; group: null | { group: GroupItem; revision: number; publication: RulesItem | null };
  personal: { revision: number; approval: PersonalRulesItem | null }; fields: Record<RuleKey, ShiftRuleField> };
export const SHIFT_RULE_BINDING_REASONS = Object.freeze(["source_unavailable", "source_invalid", "source_conflict", "identity_unavailable", "identity_changed",
  "inactive_worker", "inactive_employee", "invalid_date", "assignment_overlap", "inactive_group", "personal_overlap", "source_cap", "source_quota", "source_too_large"]);
export const SHIFT_RULE_BINDING_ERRORS: Readonly<Record<string, number>> = Object.freeze({
  attendance_invalid_request: 400, attendance_access_denied: 403, attendance_not_available: 404, attendance_worker_not_found: 404, attendance_settings_required: 409,
  attendance_unavailable: 503, attendance_rate_limited: 429, attendance_shift_rule_binding_invalid: 503, attendance_shift_rule_binding_identity_changed: 409,
  attendance_shift_rule_binding_not_found: 404,
});
type Obj = Record<string, unknown>;
const fail = (): never => { throw new MerchantAttendanceError("attendance_shift_rule_binding_invalid"); };
const exact = captureBrowserExact, uuid = captureBrowserUuid;
const site = (v: unknown): string => typeof v === "string" && /^\d{8}$/.test(v) ? v : fail();
const num = (v: unknown, minimum = 1, maximum = 9007199254740990): number => typeof v === "number" && Number.isSafeInteger(v) && !Object.is(v, -0) && v >= minimum && v <= maximum ? v : fail();
const bool = (v: unknown): boolean => typeof v === "boolean" ? v : fail();
function label(v: unknown, maximum: number, empty = false): string {
  if (typeof v !== "string" || !empty && !v || v !== v.trim() || [...v].length > maximum || /[\u0000-\u001f\u007f-\u009f]/.test(v) || !v.isWellFormed()) return fail(); return v;
}
function at(v: unknown, precision: 3 | 6): string {
  if (typeof v !== "string" || !(precision === 3 ? /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/ : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/).test(v) || v.startsWith("0000-")) return fail();
  const part = v.slice(0, 23) + "Z", ms = Date.parse(part); if (!Number.isFinite(ms) || new Date(ms).toISOString() !== part) fail(); return v;
}
const micro = (v: string) => v.length === 24 ? v.slice(0, -1) + "000Z" : v;
const milliFloor = (v: string) => v.slice(0, 23) + "000Z";
function date(v: unknown): string { if (typeof v !== "string" || v < "2000-01-01" || v > "2100-12-31") return fail(); at(v + "T00:00:00.000Z", 3); return v; }
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true; if (!a || !b || typeof a !== "object" || typeof b !== "object" || Array.isArray(a) !== Array.isArray(b)) return false;
  const aa = a as Obj, bb = b as Obj, keys = Object.keys(aa); return keys.length === Object.keys(bb).length && keys.every(k => Object.hasOwn(bb, k) && same(aa[k], bb[k]));
}
function tree(raw: unknown, cap: number) {
  let count = 0; const seen = new Set<object>();
  const visit = (v: unknown, depth: number) => {
    if (++count > 20000 || depth > 24) fail();
    if (v === null || typeof v === "boolean") return;
    if (typeof v === "string") { if (v.length > cap || !v.isWellFormed()) fail(); return; }
    if (typeof v === "number") { if (!Number.isFinite(v) || Object.is(v, -0)) fail(); return; }
    if (!v || typeof v !== "object" || seen.has(v)) return fail(); seen.add(v);
    const proto = Object.getPrototypeOf(v), desc = Object.getOwnPropertyDescriptors(v), keys = Reflect.ownKeys(v);
    if (Array.isArray(v)) {
      if (proto !== Array.prototype || v.length > 100 || keys.length !== v.length + 1) fail();
      for (let i = 0; i < v.length; i++) { const d = desc[String(i)]; if (!d || !("value" in d) || !d.enumerable) fail(); visit(d.value, depth + 1); }
    } else {
      if (proto !== Object.prototype && proto !== null) fail();
      for (const k of keys) { if (typeof k !== "string" || ["__proto__", "constructor", "prototype"].includes(k)) return fail(); const d = desc[k]; if (!("value" in d) || !d.enumerable) fail(); visit(d.value, depth + 1); }
    }
    seen.delete(v);
  };
  visit(raw, 0); if (new TextEncoder().encode(JSON.stringify(raw)).byteLength > cap) fail();
}
function frozen<T>(v: T): T { if (v && typeof v === "object") { Object.values(v).forEach(frozen); Object.freeze(v); } return v; }
const queryKeys = ["siteId", "workerId", "startEventId"];
export function parseShiftRuleBindingQuery(raw: unknown): ShiftRuleBindingQuery {
  try { const q = exact(raw, queryKeys); return { siteId: site(q.siteId), workerId: uuid(q.workerId), startEventId: uuid(q.startEventId) }; }
  catch { throw new MerchantAttendanceError("attendance_invalid_request"); }
}
export function parseShiftRuleBindingHttpQuery(url: string): ShiftRuleBindingQuery {
  try { const q = Object.create(null) as Obj, params = new URL(url).searchParams;
    for (const [k, v] of params) { if (!queryKeys.includes(k) || params.getAll(k).length !== 1) fail(); q[k] = v; } return parseShiftRuleBindingQuery(q);
  } catch { throw new MerchantAttendanceError("attendance_invalid_request"); }
}
export const shiftRuleBindingQueryString = (q: ShiftRuleBindingQuery) => new URLSearchParams(parseShiftRuleBindingQuery(q)).toString();
function rules(raw: unknown) {
  const r = exact(raw, SHIFT_RULE_KEYS); SHIFT_RULE_KEYS.forEach((k, index) => {
    const item = exact(r[k], (r[k] as Obj)?.mode === "value" ? ["mode", "minutes"] : ["mode"]);
    if (item.mode === "value") num(item.minutes, index < 2 ? 0 : 1, index === 2 ? 44640 : 1440);
    else if (item.mode !== "inherit" && item.mode !== "disabled") fail();
  }); return r;
}
const assignmentKeys = ["assignmentId", "groupId", "groupName", "workerId", "workerName", "workerNo", "employeeId", "timeZone", "startsOn", "endsOn", "createdAt", "updatedAt", "revision", "status"];
function assignmentItem(raw: unknown) {
  const d = exact(raw, assignmentKeys); for (const k of ["assignmentId", "groupId", "workerId"]) uuid(d[k]); if (d.employeeId !== null) uuid(d.employeeId);
  label(d.groupName, 80); label(d.workerName, 120); label(d.workerNo, 40); label(d.timeZone, 100); date(d.startsOn);
  if (d.endsOn !== null && date(d.endsOn) < (d.startsOn as string)) fail(); num(d.revision, 1, 3);
  if (at(d.createdAt, 6) > at(d.updatedAt, 6) || !["assigned", "ended", "cancelled"].includes(d.status as string)
    || d.status === "assigned" && (d.revision !== 1 || d.createdAt !== d.updatedAt)
    || d.status === "ended" && (d.revision !== 2 || d.endsOn === null) || d.status === "cancelled" && d.revision === 1) fail(); return d;
}
function assignment(raw: unknown, p: Obj, g: Obj, event: ShiftRuleBindingEvent) {
  const a = exact(raw, ["detail", "workerVersion", "settingsVersion", "groupRevision", "fromAt", "toAt", "originalFromAt", "originalToAt"]);
  const d = exact(a.detail, [...assignmentKeys, "history", "canEnd", "canCancel"]), current = assignmentItem(Object.fromEntries(assignmentKeys.map(k => [k, d[k]])));
  if (current.workerId !== p.workerId || current.employeeId !== p.employeeId || current.groupId !== g.groupId || current.status === "cancelled"
    || num(a.workerVersion) > (p.workerVersion as number) || num(a.settingsVersion) > (p.settingsVersion as number) || num(a.groupRevision) > (g.revision as number)
    || milliFloor(at(current.updatedAt, 6)) > event.occurredAt) fail();
  const start = at(a.fromAt, 6), end = a.toAt === null ? null : at(a.toAt, 6), originalStart = at(a.originalFromAt, 6), originalEnd = a.originalToAt === null ? null : at(a.originalToAt, 6);
  if (start !== originalStart || start > event.occurredAt || end !== null && (end <= event.occurredAt || end <= start)
    || (d.endsOn === null) !== (end === null) || originalEnd !== null && (originalEnd <= start || end === null || end > originalEnd)) fail();
  if (!Array.isArray(d.history) || d.history.length !== d.revision || d.history.length === 1 && end !== originalEnd) return fail();
  const ops = new Set<string>(); let previous: Obj | null = null;
  d.history.forEach((rawHistory, index) => {
    const h = exact(rawHistory, ["command", "item"]), c0 = h.command as Obj, c = exact(c0, c0?.action === "assign"
      ? ["operationId", "action", "reason", "groupId", "workerId", "expectedGroupRevision", "expectedWorkerVersion", "expectedSettingsVersion", "timeZone", "startsOn", "endsOn"]
      : c0?.action === "end" ? ["operationId", "action", "reason", "assignmentId", "expectedRevision", "endsOn"] : ["operationId", "action", "reason", "assignmentId", "expectedRevision"]);
    const item = assignmentItem(h.item), op = uuid(c.operationId); label(c.reason, 200); if (ops.has(op) || item.revision !== index + 1) fail(); ops.add(op);
    if (index === 0) {
      if (c.action !== "assign" || item.assignmentId !== op || item.status !== "assigned" || uuid(c.groupId) !== item.groupId || uuid(c.workerId) !== item.workerId
        || c.timeZone !== item.timeZone || c.startsOn !== item.startsOn || c.endsOn !== item.endsOn || num(c.expectedWorkerVersion) !== a.workerVersion
        || num(c.expectedSettingsVersion) !== a.settingsVersion || num(c.expectedGroupRevision) !== a.groupRevision || (item.endsOn === null) !== (originalEnd === null)) fail();
    } else if (uuid(c.assignmentId) !== item.assignmentId || num(c.expectedRevision, 1, 2) !== index || c.action !== "end" || item.status !== "ended"
      || previous!.status !== "assigned" || previous!.endsOn !== null || c.endsOn !== item.endsOn || (item.updatedAt as string) < (previous!.updatedAt as string)
      || assignmentKeys.filter(k => !["endsOn", "updatedAt", "revision", "status"].includes(k)).some(k => item[k] !== previous![k])) fail();
    previous = item;
  });
  if (assignmentKeys.some(k => previous![k] !== current[k]) || bool(d.canEnd) !== (d.status === "assigned" && d.endsOn === null) || bool(d.canCancel) !== true) fail();
  return a;
}
const pubKeys = ["revision", "operationId", "actorId", "action", "reason", "recordedAt", "settingsVersion", "groupRevision", "timeZone", "rules", "effectiveOn", "effectiveAt", "publishedRevision"];
const personalKeys = ["revision", "operationId", "actorId", "action", "reason", "recordedAt", "employeeId", "employeeAuthUserId", "workerVersion", "settingsVersion", "timeZone", "startsOn", "endsOn", "fromAt", "toAt", "rules", "approvedRevision"];
function publication(raw: unknown, head: number, point: Obj, group: Obj | null, event: ShiftRuleBindingEvent) {
  if (raw === null) return null; const p = exact(raw, pubKeys); num(p.revision, 2, head); uuid(p.operationId); uuid(p.actorId); label(p.reason, 200); label(p.timeZone, 100); date(p.effectiveOn); rules(p.rules);
  const effective = micro(at(p.effectiveAt, 3)), recorded = at(p.recordedAt, 6);
  if (p.action !== "publish" || p.publishedRevision !== null || num(p.settingsVersion) > (point.settingsVersion as number)
    || (group === null ? p.groupRevision !== null : num(p.groupRevision) > (group.revision as number)) || effective > event.occurredAt
    || recorded >= effective || milliFloor(recorded) > event.occurredAt) fail(); return p;
}
function fields(point: Obj) {
  const expected: Record<string, ShiftRuleField> = {};
  for (const k of SHIFT_RULE_KEYS) {
    const field: ShiftRuleField = { state: "unconfigured", minutes: null, source: null, trace: [] };
    for (const layer of ["personal", "group", "enterprise"] as const) {
      const part = point[layer] as Obj | null, item = (layer === "personal" ? part?.approval : part?.publication) as Obj | null;
      const gid = layer === "group" && part ? (part.group as Obj).groupId as string : null, head = part ? part.revision as number : null;
      const choice = item ? (item.rules as Obj)[k] as Obj : null;
      const mode = choice ? choice.mode as string : layer === "personal" ? "missing_approval" : layer === "group" && !part ? "no_assignment" : "missing_publication";
      const provenance: ShiftRuleProvenance | null = item ? { layer, groupId: gid, ledgerRevision: head!, operationId: item.operationId as string, revision: item.revision as number, actorId: item.actorId as string } : null;
      const minutes = mode === "value" ? choice!.minutes as number : null;
      field.trace.push({ layer, groupId: gid, ledgerRevision: head, mode, minutes, source: provenance });
      if (field.state === "unconfigured" && (mode === "disabled" || mode === "value")) { field.state = mode; field.minutes = minutes; field.source = provenance; }
    }
    expected[k] = field;
  }
  if (!same(point.fields, expected)) fail();
}
export function parseShiftRulePoint(source: ShiftRuleBindingSource, query: ShiftRuleBindingQuery, binding: ShiftRuleBinding, event: ShiftRuleBindingEvent): ShiftRulePoint {
  try {
    const s = exact(source, ["sourceId", "sourceText", "sourceSha256", "sourceBytes", "canonicalFormat"]); uuid(s.sourceId);
    if (typeof s.sourceText !== "string" || !s.sourceText.isWellFormed() || s.canonicalFormat !== "pg-jsonb-text-utf8-v1"
      || typeof s.sourceSha256 !== "string" || !/^[0-9a-f]{64}$/.test(s.sourceSha256)) fail();
    const bytes = new TextEncoder().encode(s.sourceText as string); if (bytes.byteLength !== num(s.sourceBytes, 1, 65536) || createHash("sha256").update(bytes).digest("hex") !== s.sourceSha256) fail();
    const p = exact(parseCaptureBrowserJson(s.sourceText as string), ["protocol", "algorithmVersion", "bindingPolicy", "siteId", "workerId", "employeeId", "employeeAuthUserId", "workerVersion", "settingsVersion", "timeZone", "assignment", "enterprise", "group", "personal", "fields"]);
    if (p.protocol !== "shift-rule-point-v1" || p.algorithmVersion !== "personal-group-enterprise-point-v1" || p.bindingPolicy !== "clock-in-whole-shift-v1"
      || p.siteId !== query.siteId || p.workerId !== query.workerId || uuid(p.employeeId) !== binding.employeeId || uuid(p.employeeAuthUserId) !== binding.employeeAuthUserId
      || num(p.workerVersion) !== binding.workerVersion || num(p.settingsVersion) !== binding.settingsVersion) fail(); label(p.timeZone, 100);
    if ((p.assignment === null) !== (p.group === null)) fail();
    let group: Obj | null = null;
    if (p.group !== null) {
      const g = exact(p.group, ["group", "revision", "publication"]); num(g.revision, 0);
      group = exact(g.group, ["groupId", "revision", "name", "description", "active", "createdAt", "updatedAt"]); uuid(group.groupId); num(group.revision); label(group.name, 80); label(group.description, 200, true);
      if (group.active !== true || at(group.createdAt, 6) > at(group.updatedAt, 6)) fail();
      assignment(p.assignment, p, group, event); publication(g.publication, g.revision as number, p, group, event);
    }
    const enterprise = exact(p.enterprise, ["revision", "publication"]); publication(enterprise.publication, num(enterprise.revision, 0), p, null, event);
    const personal = exact(p.personal, ["revision", "approval"]), head = num(personal.revision, 0);
    if (personal.approval !== null) {
      const a = exact(personal.approval, personalKeys); num(a.revision, 1, head); uuid(a.operationId); uuid(a.actorId); label(a.reason, 200); label(a.timeZone, 100);
      const start = micro(at(a.fromAt, 3)), end = micro(at(a.toAt, 3)), recorded = at(a.recordedAt, 6);
      const days = (Date.parse(date(a.endsOn)) - Date.parse(date(a.startsOn))) / 86400000 + 1, r = rules(a.rules);
      if (a.action !== "approve" || a.approvedRevision !== null || uuid(a.employeeId) !== p.employeeId || uuid(a.employeeAuthUserId) !== p.employeeAuthUserId
        || num(a.workerVersion) > (p.workerVersion as number) || num(a.settingsVersion) > (p.settingsVersion as number) || days < 1 || days > 31
        || start >= end || start > event.occurredAt || end <= event.occurredAt || recorded >= start || milliFloor(recorded) > event.occurredAt
        || Object.values(r).every(v => (v as Obj).mode === "inherit")) fail();
    }
    fields(p); return frozen(p as unknown as ShiftRulePoint);
  } catch { return fail(); }
}

export function parseShiftRuleBindingResult(raw: unknown, input: ShiftRuleBindingQuery, expectedActorId: string): ShiftRuleBindingResult {
  const q = parseShiftRuleBindingQuery(input);
  try {
    tree(raw, 262144); const v = exact(raw, ["protocol", "readOnly", "formalReady", "siteId", "actorId", "worker", "event", "status", "reason", "binding", "readAt"]);
    const readAt = at(v.readAt, 6), actorId = uuid(v.actorId), w = exact(v.worker, ["workerId", "workerName", "workerNo", "employeeId", "employeeAuthUserId", "version", "active", "employeeActive"]);
    const worker: ShiftRuleBindingWorker = { workerId: uuid(w.workerId), workerName: label(w.workerName, 120), workerNo: label(w.workerNo, 40), employeeId: uuid(w.employeeId), employeeAuthUserId: uuid(w.employeeAuthUserId), version: num(w.version), active: bool(w.active), employeeActive: bool(w.employeeActive) };
    const e = exact(v.event, ["startEventId", "operationId", "sequence", "locationId", "occurredAt", "timeZone", "source", "employeeId"]);
    if (e.source !== "web" && e.source !== "kiosk") fail();
    const event: ShiftRuleBindingEvent = { startEventId: uuid(e.startEventId), operationId: uuid(e.operationId), sequence: num(e.sequence), locationId: uuid(e.locationId), occurredAt: at(e.occurredAt, 6), timeZone: label(e.timeZone, 100), source: e.source as "web" | "kiosk", employeeId: uuid(e.employeeId) };
    if (v.protocol !== "shift-rule-binding-v1" || v.readOnly !== true || v.formalReady !== false || v.siteId !== q.siteId || actorId !== uuid(expectedActorId)
      || worker.workerId !== q.workerId || event.startEventId !== q.startEventId || event.employeeId !== worker.employeeId || event.occurredAt > readAt
      || !["missing", "unverified", "verified"].includes(v.status as string)) fail();
    let binding: ShiftRuleBinding | null = null;
    if (v.status === "missing") { if (v.reason !== "binding_missing" || v.binding !== null) fail(); }
    else {
      const b = exact(v.binding, ["channel", "requestAuthUserId", "employeeId", "employeeAuthUserId", "workerVersion", "settingsVersion", "algorithmVersion", "bindingPolicy", "recordedAt", "source"]);
      if (!["self", "location", "pin", "onsite"].includes(b.channel as string) || b.algorithmVersion !== "personal-group-enterprise-point-v1" || b.bindingPolicy !== "clock-in-whole-shift-v1"
        || uuid(b.employeeId) !== worker.employeeId || uuid(b.employeeAuthUserId) !== worker.employeeAuthUserId
        || (b.channel === "pin" ? b.requestAuthUserId !== null || event.source !== "kiosk" : uuid(b.requestAuthUserId) !== worker.employeeAuthUserId || event.source !== "web")) fail();
      const recordedAt = at(b.recordedAt, 6), workerVersion = b.workerVersion === null ? null : num(b.workerVersion), settingsVersion = b.settingsVersion === null ? null : num(b.settingsVersion);
      if (recordedAt > readAt || workerVersion !== null && workerVersion > worker.version || v.status === "verified" && recordedAt < event.occurredAt) fail();
      binding = { channel: b.channel as ShiftRuleBinding["channel"], requestAuthUserId: b.requestAuthUserId as string | null, employeeId: worker.employeeId, employeeAuthUserId: worker.employeeAuthUserId,
        workerVersion, settingsVersion, algorithmVersion: "personal-group-enterprise-point-v1", bindingPolicy: "clock-in-whole-shift-v1", recordedAt, source: null };
      if (v.status === "verified") {
        if (v.reason !== null || workerVersion === null || settingsVersion === null) fail();
        parseShiftRulePoint(b.source as ShiftRuleBindingSource, q, binding, event);
        const s = b.source as ShiftRuleBindingSource; binding.source = { sourceId: s.sourceId, sourceText: s.sourceText, sourceSha256: s.sourceSha256, sourceBytes: s.sourceBytes, canonicalFormat: s.canonicalFormat };
      } else if (b.source !== null || typeof v.reason !== "string" || !SHIFT_RULE_BINDING_REASONS.includes(v.reason)) fail();
    }
    return frozen({ protocol: "shift-rule-binding-v1", readOnly: true, formalReady: false, siteId: q.siteId, actorId, worker, event,
      status: v.status as ShiftRuleBindingResult["status"], reason: v.reason as string | null, binding, readAt });
  } catch { return fail(); }
}
export function parseShiftRuleBindingResponse(raw: unknown, query: ShiftRuleBindingQuery, actorId: string): ShiftRuleBindingResponse {
  try { tree(raw, 262144); const v = exact(raw, ["ok", "moduleEnabled", "data"]); if (v.ok !== true) fail();
    return frozen({ ...parseShiftRuleBindingResult(v.data, query, actorId), moduleEnabled: bool(v.moduleEnabled) });
  } catch { return fail(); }
}
