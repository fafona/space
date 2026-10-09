// Browser-safe, independent owner-approved plan-start policy. This is not a
// clock binding, attendance assessment, payroll result or browser hash proof.
// Saved zones/UTC boundaries are evidence, never remapped using today's tzdata.
import { captureBrowserExact as exact, captureBrowserUuid } from "./merchantAttendanceRuleCapturesBrowser";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import type { AttendanceRuleChoice } from "./merchantAttendanceRuleDraft";
import type { ShiftRuleBindingWorker, ShiftRuleField, ShiftRuleProvenance } from "./merchantAttendanceShiftRuleBinding";
import type { SelfScheduleSlot } from "./merchantAttendanceSelfSchedule";

export const PLAN_RULE_APPROVALS_BYTE_LIMIT = 65536;
export const PLAN_RULE_APPROVALS_SOURCE_BYTE_LIMIT = 32768;
export const PLAN_RULE_APPROVALS_KEYS = Object.freeze(["lateGraceMinutes", "earlyGraceMinutes"] as const);
export const PLAN_RULE_APPROVALS_BLOCKERS = Object.freeze(["module_paused", "worker_inactive", "publication_missing", "cancelled", "started", "associated",
  "source_incomplete", "assignment_overlap", "group_inactive", "source_switch", "source_too_large"] as const);
export type PlanRuleApprovalsBlocker = typeof PLAN_RULE_APPROVALS_BLOCKERS[number];
export type PlanRuleApprovalsQuery = { siteId: string; workerId: string; slotId: string; mode: "preview" | "read" | "recover" | "approve"; operationId: string | null };
export type PlanRuleApprovalsCommand = { operationId: string; expectedRevision: number; expectedFingerprint: string; employeeId: string; employeeAuthUserId: string; reason: string };
export type PlanRuleApprovalsRules = Record<typeof PLAN_RULE_APPROVALS_KEYS[number], AttendanceRuleChoice>;
export type PlanRuleApprovalsPublication = { operationId: string; revision: number; actorId: string; recordedAt: string; effectiveAt: string; rules: PlanRuleApprovalsRules };
export type PlanRuleApprovalsPersonal = Omit<PlanRuleApprovalsPublication, "effectiveAt"> & { fromAt: string; toAt: string };
export type PlanRuleApprovalsSource = { protocol: "plan-rule-point-v1"; policy: "owner-approved-plan-start-v1"; siteId: string; workerId: string;
  employeeId: string; employeeAuthUserId: string; workerVersion: number; settingsVersion: number; timeZone: string;
  slot: { id: string; revision: number; locationId: string; locationVersion: number; timeZone: string; startAt: string; endAt: string };
  assignment: null | { assignmentId: string; revision: number; groupId: string; groupName: string; groupRevision: number; employeeId: string; timeZone: string; fromAt: string; toAt: string | null };
  enterprise: { revision: number; publication: PlanRuleApprovalsPublication | null };
  group: null | { groupId: string; revision: number; publication: PlanRuleApprovalsPublication | null };
  personal: { revision: number; approval: PlanRuleApprovalsPersonal | null };
  fields: Record<typeof PLAN_RULE_APPROVALS_KEYS[number], ShiftRuleField> };
export type PlanRuleApprovalsPreview = { fingerprint: string | null; observedAt: string; eligible: boolean; blockers: PlanRuleApprovalsBlocker[]; source: PlanRuleApprovalsSource | null };
export type PlanRuleApprovalsApproval = { operationId: string; revision: number; actorId: string; command: PlanRuleApprovalsCommand; observedAt: string;
  recordedAt: string; sourceId: string; sourceSha256: string; sourceBytes: number; source: PlanRuleApprovalsSource };
export type PlanRuleApprovalsResult = { protocol: "plan-rule-approvals-v1"; siteId: string; actorId: string; worker: ShiftRuleBindingWorker; slot: SelfScheduleSlot;
  revision: number; preview: PlanRuleApprovalsPreview | null; approval: PlanRuleApprovalsApproval | null; readAt: string };
export type PlanRuleApprovalsResponse = PlanRuleApprovalsResult & { moduleEnabled: boolean };
export const PLAN_RULE_APPROVALS_ERRORS: Readonly<Record<string, number>> = Object.freeze({
  attendance_invalid_request: 400, attendance_access_denied: 403, attendance_not_available: 404, attendance_worker_not_found: 404,
  attendance_settings_required: 409, attendance_platform_paused: 403, attendance_version_conflict: 409, attendance_operation_conflict: 409,
  attendance_unavailable: 503, attendance_rate_limited: 429, attendance_body_too_large: 413, attendance_invalid_content_type: 415,
  attendance_plan_rule_invalid: 503, attendance_plan_rule_not_found: 404, attendance_plan_rule_identity_changed: 409,
  attendance_plan_rule_blocked: 409, attendance_plan_rule_source_conflict: 409, attendance_plan_rule_limit: 409,
  attendance_rule_sources_invalid: 503, attendance_rule_sources_too_large: 422, attendance_rule_invalid: 503,
  attendance_group_invalid: 503, attendance_personal_rule_invalid: 503, attendance_personal_rule_identity_changed: 409,
  attendance_schedule_invalid: 503, attendance_self_schedule_invalid: 503,
});
const fail = (code = "attendance_plan_rule_invalid"): never => { throw new MerchantAttendanceError(code); };
const MAX = 9007199254740990;
const integer = (v: unknown, min = 1, max = MAX): number => typeof v === "number" && Number.isSafeInteger(v) && !Object.is(v, -0) && v >= min && v <= max ? v : fail();
const bool = (v: unknown): boolean => typeof v === "boolean" ? v : fail();
const uuid = (v: unknown): string => typeof v === "string" && v.length === 36 ? captureBrowserUuid(v) : fail();
const site = (v: unknown): string => typeof v === "string" && v.length === 8 && /^\d{8}$/.test(v) ? v : fail();
const hash = (v: unknown): string => typeof v === "string" && v.length === 64 && /^[a-f0-9]{64}$/.test(v) ? v : fail();
function wellFormed(v: string) {
  for (let i = 0; i < v.length; i++) { const n = v.charCodeAt(i);
    if (n >= 0xd800 && n <= 0xdbff) { const next = v.charCodeAt(++i); if (!(next >= 0xdc00 && next <= 0xdfff)) fail(); }
    else if (n >= 0xdc00 && n <= 0xdfff) fail(); }
}
function label(v: unknown, max: number): string {
  if (typeof v !== "string" || !v || v !== v.trim() || [...v].length > max || /[\u0000-\u001f\u007f-\u009f]/.test(v)) return fail();
  wellFormed(v); return v;
}
function stamp(v: unknown, precision: 3 | 6 = 6): string {
  if (typeof v !== "string" || v.length !== (precision === 3 ? 24 : 27) || !(precision === 3 ? /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/ : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/).test(v)
    || v.startsWith("0000-")) return fail();
  const short = v.slice(0, 23) + "Z", ms = Date.parse(short); if (!Number.isFinite(ms) || new Date(ms).toISOString() !== short) fail(); return v;
}
const micro = (s: string) => s.length === 24 ? s.slice(0, 23) + "000Z" : s;
function freeze<T>(v: T): T { if (v && typeof v === "object") { Object.values(v).forEach(freeze); Object.freeze(v); } return v; }
function tree(raw: unknown, limit = PLAN_RULE_APPROVALS_BYTE_LIMIT) {
  let nodes = 0; const ancestors = new Set<object>();
  const visit = (v: unknown, depth: number): void => {
    if (++nodes > 6000 || depth > 20) fail();
    if (v === null || typeof v === "boolean") return;
    if (typeof v === "string") { if (v.length > limit) fail(); wellFormed(v); return; }
    if (typeof v === "number") { if (!Number.isFinite(v) || Object.is(v, -0)) fail(); return; }
    if (!v || typeof v !== "object" || ancestors.has(v)) return fail(); ancestors.add(v);
    const proto = Object.getPrototypeOf(v), keys = Reflect.ownKeys(v), descriptors = Object.getOwnPropertyDescriptors(v);
    if (Array.isArray(v)) {
      if (proto !== Array.prototype || v.length > PLAN_RULE_APPROVALS_BLOCKERS.length || keys.length !== v.length + 1) fail();
      for (let i = 0; i < v.length; i++) { const d = descriptors[String(i)]; if (!d || !("value" in d) || !d.enumerable) fail(); visit(d.value, depth + 1); }
    } else {
      if (proto !== Object.prototype && proto !== null) fail();
      for (const key of keys) { if (typeof key !== "string" || ["__proto__", "constructor", "prototype"].includes(key)) return fail();
        const d = descriptors[key]; if (!("value" in d) || !d.enumerable) fail(); visit(d.value, depth + 1); }
    }
    ancestors.delete(v);
  };
  visit(raw, 0); if (new TextEncoder().encode(JSON.stringify(raw)).byteLength > limit) fail();
}
const queryKeys = ["siteId", "workerId", "slotId", "mode", "operationId"];
export function parsePlanRuleApprovalsQuery(raw: unknown): PlanRuleApprovalsQuery {
  try { const q = exact(raw, queryKeys); if (!["preview", "read", "recover", "approve"].includes(q.mode as string)) fail();
    const mode = q.mode as PlanRuleApprovalsQuery["mode"], operationId = q.operationId === null ? null : uuid(q.operationId);
    if ((mode === "recover" || mode === "approve") !== (operationId !== null)) fail();
    return { siteId: site(q.siteId), workerId: uuid(q.workerId), slotId: uuid(q.slotId), mode, operationId };
  } catch { return fail("attendance_invalid_request"); }
}
export function parsePlanRuleApprovalsHttpQuery(url: string): PlanRuleApprovalsQuery {
  try { const q: Record<string, unknown> = Object.assign(Object.create(null), { operationId: null }), params = new URL(url).searchParams;
    for (const [key, value] of params) { if (!queryKeys.includes(key) || params.getAll(key).length !== 1) fail(); q[key] = value; }
    return parsePlanRuleApprovalsQuery(q);
  } catch { return fail("attendance_invalid_request"); }
}
export const planRuleApprovalsQueryString = (input: PlanRuleApprovalsQuery) => new URLSearchParams(Object.entries(parsePlanRuleApprovalsQuery(input)).filter((p): p is [string, string] => p[1] !== null)).toString();
export function parsePlanRuleApprovalsCommand(raw: unknown): PlanRuleApprovalsCommand {
  try { const c = exact(raw, ["operationId", "expectedRevision", "expectedFingerprint", "employeeId", "employeeAuthUserId", "reason"]);
    return { operationId: uuid(c.operationId), expectedRevision: integer(c.expectedRevision, 0, MAX - 1), expectedFingerprint: hash(c.expectedFingerprint),
      employeeId: uuid(c.employeeId), employeeAuthUserId: uuid(c.employeeAuthUserId), reason: label(c.reason, 200) };
  } catch { return fail("attendance_invalid_request"); }
}
export const samePlanRuleApprovalsCommand = (a: PlanRuleApprovalsCommand, b: PlanRuleApprovalsCommand) => JSON.stringify(parsePlanRuleApprovalsCommand(a)) === JSON.stringify(parsePlanRuleApprovalsCommand(b));
export function parsePlanRuleApprovalsBody(raw: unknown): { query: PlanRuleApprovalsQuery; command: PlanRuleApprovalsCommand } {
  try { tree(raw, 8192); const b = exact(raw, ["query", "command"]), query = parsePlanRuleApprovalsQuery(b.query), command = parsePlanRuleApprovalsCommand(b.command);
    if (query.mode !== "approve" || query.operationId !== command.operationId) fail(); return { query, command };
  } catch { return fail("attendance_invalid_request"); }
}
function slotData(raw: unknown): SelfScheduleSlot {
  const s = exact(raw, ["id", "revision", "locationId", "locationName", "timeZone", "workDate", "startAt", "endAt", "cancelled", "hasPublicationEvidence"]);
  const startAt = stamp(s.startAt, 3), endAt = stamp(s.endAt, 3), start = Date.parse(startAt), end = Date.parse(endAt), workDate = label(s.workDate, 10);
  if (end <= start || end - start > 86400000 || start % 60000 || end % 60000 || workDate.length !== 10 || !/^\d{4}-\d{2}-\d{2}$/.test(workDate)
    || workDate < "2000-01-01" || workDate > "2100-12-31") fail(); stamp(workDate + "T00:00:00.000Z", 3);
  return { id: uuid(s.id), revision: integer(s.revision), locationId: uuid(s.locationId), locationName: label(s.locationName, 120), timeZone: label(s.timeZone, 100),
    workDate, startAt, endAt, cancelled: bool(s.cancelled), hasPublicationEvidence: bool(s.hasPublicationEvidence) };
}
function rulesData(raw: unknown): PlanRuleApprovalsRules {
  const r = exact(raw, PLAN_RULE_APPROVALS_KEYS), result = {} as PlanRuleApprovalsRules;
  for (const key of PLAN_RULE_APPROVALS_KEYS) {
    const value = r[key], descriptor = value && typeof value === "object" ? Object.getOwnPropertyDescriptor(value, "mode") : undefined;
    const mode: unknown = descriptor && "value" in descriptor ? descriptor.value : undefined, c = exact(value, mode === "value" ? ["mode", "minutes"] : ["mode"]);
    if (c.mode === "value") result[key] = { mode: "value", minutes: integer(c.minutes, 0, 1440) };
    else if (c.mode === "inherit" || c.mode === "disabled") result[key] = { mode: c.mode }; else fail();
  }
  return result;
}
function publication(raw: unknown, head: number, observedAt: string, startAt: string): PlanRuleApprovalsPublication | null {
  if (raw === null) return null; const p = exact(raw, ["operationId", "revision", "actorId", "recordedAt", "effectiveAt", "rules"]);
  const recordedAt = stamp(p.recordedAt), effectiveAt = stamp(p.effectiveAt, 3);
  if (recordedAt > observedAt || recordedAt >= micro(effectiveAt) || micro(effectiveAt) > micro(startAt)) fail();
  return { operationId: uuid(p.operationId), revision: integer(p.revision, 2, head), actorId: uuid(p.actorId), recordedAt, effectiveAt, rules: rulesData(p.rules) };
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
function fieldsData(raw: unknown, source: Omit<PlanRuleApprovalsSource, "fields">): PlanRuleApprovalsSource["fields"] {
  const f = exact(raw, PLAN_RULE_APPROVALS_KEYS), fields = {} as PlanRuleApprovalsSource["fields"];
  for (const key of PLAN_RULE_APPROVALS_KEYS) {
    const field = exact(f[key], ["state", "minutes", "source", "trace"]); if (!Array.isArray(field.trace) || field.trace.length !== 3) return fail();
    const traces = field.trace;
    const wanted: ShiftRuleField = { state: "unconfigured", minutes: null, source: null, trace: [] };
    (["personal", "group", "enterprise"] as const).forEach((layer, i) => {
      const part = source[layer], item = layer === "personal" ? source.personal.approval : layer === "group" ? source.group?.publication ?? null : source.enterprise.publication;
      const groupId = layer === "group" ? source.group?.groupId ?? null : null, ledgerRevision = part?.revision ?? null, c = item?.rules[key];
      const provenance: ShiftRuleProvenance | null = item ? { layer, groupId, ledgerRevision: ledgerRevision!, operationId: item.operationId, revision: item.revision, actorId: item.actorId } : null;
      const mode = c?.mode ?? (layer === "personal" ? "missing_approval" : layer === "group" && !part ? "no_assignment" : "missing_publication");
      const minutes = c?.mode === "value" ? c.minutes : null, t = exact(traces[i], ["layer", "groupId", "ledgerRevision", "mode", "minutes", "source"]);
      const expected = { layer, groupId, ledgerRevision, mode, minutes, source: provenance };
      if (t.layer !== layer || t.groupId !== groupId || t.ledgerRevision !== ledgerRevision || t.mode !== mode || t.minutes !== minutes) fail();
      if (provenance === null ? t.source !== null : !same(provenanceData(t.source), provenance)) fail(); wanted.trace.push(expected);
      if (wanted.state === "unconfigured" && (mode === "value" || mode === "disabled")) { wanted.state = mode; wanted.minutes = minutes; wanted.source = provenance; }
    });
    if (field.state !== wanted.state || field.minutes !== wanted.minutes || (wanted.source === null ? field.source !== null : !same(provenanceData(field.source), wanted.source))) fail();
    fields[key] = wanted;
  }
  return fields;
}
function provenanceData(raw: unknown): ShiftRuleProvenance {
  const p = exact(raw, ["layer", "groupId", "ledgerRevision", "operationId", "revision", "actorId"]);
  if (!["personal", "group", "enterprise"].includes(p.layer as string)) fail();
  return { layer: p.layer as ShiftRuleProvenance["layer"], groupId: p.groupId === null ? null : uuid(p.groupId), ledgerRevision: integer(p.ledgerRevision, 0),
    operationId: uuid(p.operationId), revision: integer(p.revision), actorId: uuid(p.actorId) };
}
function sourceData(raw: unknown, query: PlanRuleApprovalsQuery, worker: ShiftRuleBindingWorker, slot: SelfScheduleSlot, observedAt: string): PlanRuleApprovalsSource {
  tree(raw, PLAN_RULE_APPROVALS_SOURCE_BYTE_LIMIT);
  const p = exact(raw, ["protocol", "policy", "siteId", "workerId", "employeeId", "employeeAuthUserId", "workerVersion", "settingsVersion", "timeZone", "slot", "assignment", "enterprise", "group", "personal", "fields"]);
  if (!slot.hasPublicationEvidence || p.protocol !== "plan-rule-point-v1" || p.policy !== "owner-approved-plan-start-v1" || p.siteId !== query.siteId || p.workerId !== query.workerId
    || uuid(p.employeeId) !== worker.employeeId || uuid(p.employeeAuthUserId) !== worker.employeeAuthUserId) fail();
  const s = exact(p.slot, ["id", "revision", "locationId", "locationVersion", "timeZone", "startAt", "endAt"]);
  if (["id", "revision", "locationId", "timeZone", "startAt", "endAt"].some(key => s[key] !== slot[key as keyof SelfScheduleSlot])) fail();
  const savedSlot = { id: slot.id, revision: slot.revision, locationId: slot.locationId, locationVersion: integer(s.locationVersion), timeZone: slot.timeZone, startAt: slot.startAt, endAt: slot.endAt };
  const e = exact(p.enterprise, ["revision", "publication"]), enterpriseHead = integer(e.revision, 0), enterprise = { revision: enterpriseHead, publication: publication(e.publication, enterpriseHead, observedAt, slot.startAt) };
  let assignment: PlanRuleApprovalsSource["assignment"] = null, group: PlanRuleApprovalsSource["group"] = null;
  if ((p.assignment === null) !== (p.group === null)) fail();
  if (p.assignment !== null) {
    const a = exact(p.assignment, ["assignmentId", "revision", "groupId", "groupName", "groupRevision", "employeeId", "timeZone", "fromAt", "toAt"]), g = exact(p.group, ["groupId", "revision", "publication"]);
    const groupId = uuid(a.groupId), fromAt = stamp(a.fromAt), toAt = a.toAt === null ? null : stamp(a.toAt), groupHead = integer(g.revision, 0);
    if (g.groupId !== groupId || a.employeeId !== worker.employeeId || fromAt > micro(slot.startAt) || toAt !== null && toAt <= micro(slot.startAt)) fail();
    assignment = { assignmentId: uuid(a.assignmentId), revision: integer(a.revision, 1, 2), groupId, groupName: label(a.groupName, 80), groupRevision: integer(a.groupRevision),
      employeeId: uuid(a.employeeId), timeZone: label(a.timeZone, 100), fromAt, toAt };
    group = { groupId, revision: groupHead, publication: publication(g.publication, groupHead, observedAt, slot.startAt) };
  }
  const pr = exact(p.personal, ["revision", "approval"]), personalHead = integer(pr.revision, 0); let approval: PlanRuleApprovalsPersonal | null = null;
  if (pr.approval !== null) {
    const a = exact(pr.approval, ["operationId", "revision", "actorId", "recordedAt", "fromAt", "toAt", "rules"]), recordedAt = stamp(a.recordedAt), fromAt = stamp(a.fromAt, 3), toAt = stamp(a.toAt, 3);
    if (recordedAt > observedAt || recordedAt >= micro(fromAt) || micro(fromAt) > micro(slot.startAt) || micro(toAt) <= micro(slot.startAt)) fail();
    approval = { operationId: uuid(a.operationId), revision: integer(a.revision, 1, personalHead), actorId: uuid(a.actorId), recordedAt, fromAt, toAt, rules: rulesData(a.rules) };
  }
  const result = { protocol: "plan-rule-point-v1" as const, policy: "owner-approved-plan-start-v1" as const, siteId: query.siteId, workerId: query.workerId,
    employeeId: worker.employeeId, employeeAuthUserId: worker.employeeAuthUserId, workerVersion: integer(p.workerVersion, 1, worker.version), settingsVersion: integer(p.settingsVersion),
    timeZone: label(p.timeZone, 100), slot: savedSlot, assignment, enterprise, group, personal: { revision: personalHead, approval } };
  return { ...result, fields: fieldsData(p.fields, result) };
}
export function parsePlanRuleApprovalsResult(raw: unknown, input: PlanRuleApprovalsQuery, expectedActorId: string, expectedCommand: PlanRuleApprovalsCommand | null = null): PlanRuleApprovalsResult {
  const query = parsePlanRuleApprovalsQuery(input);
  try {
    tree(raw); const v = exact(raw, ["protocol", "siteId", "actorId", "worker", "slot", "revision", "preview", "approval", "readAt"]);
    const actorId = uuid(v.actorId), readAt = stamp(v.readAt), revision = integer(v.revision, 0), w = exact(v.worker, ["workerId", "workerName", "workerNo", "employeeId", "employeeAuthUserId", "version", "active", "employeeActive"]);
    const worker: ShiftRuleBindingWorker = { workerId: uuid(w.workerId), workerName: label(w.workerName, 120), workerNo: label(w.workerNo, 40), employeeId: uuid(w.employeeId),
      employeeAuthUserId: uuid(w.employeeAuthUserId), version: integer(w.version), active: bool(w.active), employeeActive: bool(w.employeeActive) }, slot = slotData(v.slot);
    if (v.protocol !== "plan-rule-approvals-v1" || v.siteId !== query.siteId || actorId !== uuid(expectedActorId) || worker.workerId !== query.workerId || slot.id !== query.slotId) fail();
    const command = expectedCommand === null ? null : parsePlanRuleApprovalsCommand(expectedCommand);
    if (command && (query.operationId !== command.operationId || !["approve", "recover"].includes(query.mode))) fail();
    let preview: PlanRuleApprovalsPreview | null = null, approval: PlanRuleApprovalsApproval | null = null;
    if (query.mode === "preview") {
      if (v.approval !== null) fail(); const p = exact(v.preview, ["fingerprint", "observedAt", "eligible", "blockers", "source"]), observedAt = stamp(p.observedAt), eligible = bool(p.eligible);
      if (observedAt > readAt || !Array.isArray(p.blockers) || p.blockers.some(b => !PLAN_RULE_APPROVALS_BLOCKERS.includes(b as PlanRuleApprovalsBlocker)) || new Set(p.blockers).size !== p.blockers.length) return fail();
      const blockers = [...p.blockers] as PlanRuleApprovalsBlocker[], fingerprint = p.fingerprint === null ? null : hash(p.fingerprint), source = p.source === null ? null : sourceData(p.source, query, worker, slot, observedAt);
      if ((source === null) !== (fingerprint === null) || eligible !== (blockers.length === 0) || source && blockers.some(b => b !== "source_switch")
        || eligible && (!source || !worker.active || !worker.employeeActive || slot.cancelled || !slot.hasPublicationEvidence || observedAt >= micro(slot.startAt))) fail();
      preview = { fingerprint, observedAt, eligible, blockers, source };
    } else {
      if (v.preview !== null) fail();
      if (v.approval !== null) {
        const a = exact(v.approval, ["operationId", "revision", "actorId", "command", "observedAt", "recordedAt", "sourceId", "sourceSha256", "sourceBytes", "source"]), c = parsePlanRuleApprovalsCommand(a.command);
        const operationId = uuid(a.operationId), savedActor = uuid(a.actorId), savedRevision = integer(a.revision, 1, revision), observedAt = stamp(a.observedAt), recordedAt = stamp(a.recordedAt);
        if (operationId !== c.operationId || savedRevision !== c.expectedRevision + 1 || c.employeeId !== worker.employeeId || c.employeeAuthUserId !== worker.employeeAuthUserId
          || observedAt > recordedAt || recordedAt > readAt || recordedAt >= micro(slot.startAt)
          || query.mode === "read" && savedRevision !== revision || query.mode !== "read" && (operationId !== query.operationId || savedActor !== actorId)
          || command && !samePlanRuleApprovalsCommand(c, command)) fail();
        const sourceSha256 = hash(a.sourceSha256); if (sourceSha256 !== c.expectedFingerprint) fail();
        approval = { operationId, revision: savedRevision, actorId: savedActor, command: c, observedAt, recordedAt, sourceId: uuid(a.sourceId), sourceSha256,
          sourceBytes: integer(a.sourceBytes, 1, PLAN_RULE_APPROVALS_SOURCE_BYTE_LIMIT), source: sourceData(a.source, query, worker, slot, observedAt) };
      } else if (query.mode === "approve" || query.mode === "read" && revision !== 0) fail();
    }
    return freeze({ protocol: "plan-rule-approvals-v1", siteId: query.siteId, actorId, worker, slot, revision, preview, approval, readAt });
  } catch { return fail(); }
}
export function parsePlanRuleApprovalsResponse(raw: unknown, query: PlanRuleApprovalsQuery, actorId: string, command: PlanRuleApprovalsCommand | null = null): PlanRuleApprovalsResponse {
  try { tree(raw); const v = exact(raw, ["ok", "moduleEnabled", "data"]); if (v.ok !== true) fail();
    const result = parsePlanRuleApprovalsResult(v.data, query, actorId, command), moduleEnabled = bool(v.moduleEnabled);
    if (result.preview?.eligible && !moduleEnabled) fail(); return freeze({ ...result, moduleEnabled });
  } catch { return fail(); }
}
