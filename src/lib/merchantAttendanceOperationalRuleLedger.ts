// 240: independent configuration ledger wire. Publication is not runtime adoption.
import { MerchantAttendanceError, attendanceDayUtcRange, attendanceTimeZone, attendanceLocalDate } from "./merchantAttendanceTime";
import { captureBrowserExact, parseCaptureBrowserJson } from "./merchantAttendanceRuleCapturesBrowser";
import { OPERATIONAL_RULE_KEYS, OPERATIONAL_RULE_REVIEW_CATEGORIES, OPERATIONAL_RULE_REMINDER_KINDS, parseOperationalRules, type OperationalRules } from "./merchantAttendanceOperationalRules";
export type { OperationalRules } from "./merchantAttendanceOperationalRules";
export const OPERATIONAL_RULE_LEDGER_PROTOCOL = "attendance-operational-rule-ledger-v1" as const;
export const OPERATIONAL_RULE_LEDGER_API = "/api/merchant-enterprise/attendance/operational-rules";
export const OPERATIONAL_RULE_LEDGER_BODY_LIMIT = 40960;
export const OPERATIONAL_RULE_LEDGER_RESPONSE_LIMIT = 262144;
export const OPERATIONAL_RULE_LEDGER_MAX_REVISION = 9007199254740990;
export const OPERATIONAL_RULE_LEDGER_ERRORS = Object.freeze({ attendance_invalid_request: 400, attendance_access_denied: 403,
  attendance_settings_required: 409, attendance_operation_conflict: 409, attendance_operational_rule_changed: 409,
  attendance_operational_rule_future_required: 409, attendance_operational_rule_overlap: 409, attendance_operational_rule_disabled: 403,
  attendance_operational_rule_not_found: 404, attendance_operational_rule_too_large: 422, attendance_operational_rule_limit: 422,
  attendance_operational_rule_invalid: 503 } as const);
export type OperationalRuleLedgerErrorCode = keyof typeof OPERATIONAL_RULE_LEDGER_ERRORS;
export const OPERATIONAL_RULE_LEDGER_MESSAGES: Readonly<Record<OperationalRuleLedgerErrorCode, string>> = Object.freeze({
  attendance_invalid_request: "请求格式无效。", attendance_access_denied: "无权读取或修改此范围。", attendance_settings_required: "请先完成考勤设置。",
  attendance_operation_conflict: "原编号与保存的操作不一致。", attendance_operational_rule_changed: "配置或来源已改变，请明确重新读取。",
  attendance_operational_rule_future_required: "生效日期必须仍在未来。", attendance_operational_rule_overlap: "发布区间与已有配置冲突。",
  attendance_operational_rule_disabled: "当前未开放新的规则配置写入。", attendance_operational_rule_not_found: "未找到指定配置。",
  attendance_operational_rule_too_large: "资料超过单次安全读取上限。", attendance_operational_rule_limit: "序号已达到安全上限。",
  attendance_operational_rule_invalid: "暂时无法核实配置结果，请保留原编号。" });
export type OperationalRuleLedgerPersonalScope = Readonly<{ kind: "personal"; workerId: string; employeeId: string; employeeAuthUserId: string }>;
export type OperationalRuleLedgerScope = Readonly<{ kind: "enterprise" } | { kind: "group"; groupId: string }> | OperationalRuleLedgerPersonalScope;
export type OperationalRuleLedgerContext = Readonly<{ settingsVersion: number; timeZone: string;
  subject: null | { groupRevision: number } | { workerVersion: number; employeeVersion: number } }>;
export type OperationalRuleLedgerReferences = Readonly<{ subject: null | { groupActive: boolean } | { workerActive: boolean; employeeActive: boolean };
  locations: readonly { locationId: string; version: number; active: boolean }[];
  routes: readonly { category: typeof OPERATIONAL_RULE_REVIEW_CATEGORIES[number]; employeeId: string; employeeAuthUserId: string; employeeVersion: number; active: boolean }[] }>;
export type OperationalRuleLedgerHistoryCursor = Readonly<{ siteId: string; scope: OperationalRuleLedgerScope; atRevision: number; beforeRevision: number }>;
export type OperationalRuleLedgerQuery = Readonly<
  { siteId: string; mode: "detail"; scope: OperationalRuleLedgerScope }
  | { siteId: string; mode: "history"; scope: OperationalRuleLedgerScope; cursor: OperationalRuleLedgerHistoryCursor | null }
  | { siteId: string; mode: "preview"; scope: OperationalRuleLedgerScope; sourceDraftRevision: number; effectiveOn: string; endsOn: string | null }
  | { siteId: string; mode: "recover"; operationId: string }
  | { siteId: string; mode: "catalog"; catalog: "workers" | "routes"; afterId: string | null }
  | { siteId: string; mode: "catalog"; catalog: "saved_personal"; afterScope: OperationalRuleLedgerPersonalScope | null }>;
type CommandBase = { siteId: string; scope: OperationalRuleLedgerScope; operationId: string; expectedRevision: number; reason: string };
export type OperationalRuleLedgerCommand = Readonly<CommandBase & (
  { action: "save_draft"; expectedContext: OperationalRuleLedgerContext; rules: OperationalRules }
  | { action: "publish"; sourceDraftRevision: number; effectiveOn: string; endsOn: string | null; previewFingerprint: string }
  | { action: "withdraw"; publishedRevision: number })>;
type ItemBase = { scope: OperationalRuleLedgerScope; operationId: string; actorId: string; revision: number; reason: string; recordedAt: string; commandFingerprint: string };
export type OperationalRuleLedgerSaveDraftItem = Readonly<ItemBase & { action: "save_draft"; context: OperationalRuleLedgerContext; rules: OperationalRules;
  rulesFingerprint: string; references: OperationalRuleLedgerReferences; referenceFingerprint: string }>;
export type OperationalRuleLedgerPublishItem = Readonly<Omit<OperationalRuleLedgerSaveDraftItem, "action"> & { action: "publish"; sourceDraftRevision: number;
  effectiveOn: string; endsOn: string | null; effectiveAt: string; endsAt: string | null; previewFingerprint: string }>;
export type OperationalRuleLedgerItem = OperationalRuleLedgerSaveDraftItem | OperationalRuleLedgerPublishItem | Readonly<ItemBase & { action: "withdraw"; publishedRevision: number }>;
export type OperationalRuleLedgerReceipt = Readonly<Omit<ItemBase, "reason"> & { action: OperationalRuleLedgerCommand["action"] }>;
export type OperationalRuleLedgerData = Readonly<
  { kind: "detail"; scope: OperationalRuleLedgerScope; revision: number; context: OperationalRuleLedgerContext | null; draft: OperationalRuleLedgerSaveDraftItem | null;
    currentPublication: OperationalRuleLedgerPublishItem | null; nextPublication: OperationalRuleLedgerPublishItem | null; canWithdraw: boolean }
  | { kind: "preview"; scope: OperationalRuleLedgerScope; revision: number; sourceDraftRevision: number; context: OperationalRuleLedgerContext;
    rulesFingerprint: string; references: OperationalRuleLedgerReferences; referenceFingerprint: string; effectiveOn: string; endsOn: string | null;
    effectiveAt: string; endsAt: string | null; previewFingerprint: string; applied: false }
  | { kind: "history"; scope: OperationalRuleLedgerScope; atRevision: number; items: readonly { item: OperationalRuleLedgerItem; withdrawnByRevision: number | null }[]; nextCursor: OperationalRuleLedgerHistoryCursor | null }
  | { kind: "receipt" }
  | { kind: "catalog"; catalog: "workers"; items: readonly { workerId: string; workerName: string; employeeId: string; employeeAuthUserId: string }[]; nextId: string | null }
  | { kind: "catalog"; catalog: "routes"; items: readonly { employeeId: string; employeeName: string; employeeAuthUserId: string }[]; nextId: string | null }
  | { kind: "catalog"; catalog: "saved_personal"; items: readonly { scope: OperationalRuleLedgerPersonalScope; revision: number; updatedAt: string }[]; nextScope: OperationalRuleLedgerPersonalScope | null }>;
export type OperationalRuleLedgerResult = Readonly<{ protocol: typeof OPERATIONAL_RULE_LEDGER_PROTOCOL; siteId: string; actorId: string; readAt: string; canWrite: boolean; data: OperationalRuleLedgerData; receipt: OperationalRuleLedgerReceipt | null }>;
export type OperationalRuleLedgerResponse = Readonly<{ ok: true; data: OperationalRuleLedgerResult } | { ok: false; error: { code: OperationalRuleLedgerErrorCode; message: string } }>;
function fail(): never { throw new MerchantAttendanceError("attendance_invalid_request"); }
function exact(raw: unknown, keys: readonly string[]) { try { return captureBrowserExact(raw, keys); } catch { return fail(); } }
export function operationalRuleLedgerFreeze<T>(v: T): T { if (v && typeof v === "object" && !Object.isFrozen(v)) { Object.values(v).forEach(operationalRuleLedgerFreeze); Object.freeze(v); } return v; }
export function operationalRuleLedgerEqual(a: unknown, b: unknown): boolean { if (a === b) return true; if (!a || !b || typeof a !== "object" || typeof b !== "object" || Array.isArray(a) !== Array.isArray(b)) return false;
  const aa = Object.keys(a), bb = Object.keys(b); return aa.length === bb.length && aa.every(k => Object.hasOwn(b, k) && operationalRuleLedgerEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])); }
function unicode(s: string) { if (s.includes("\0")) fail(); for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); if (c >= 0xd800 && c <= 0xdbff) { const n = s.charCodeAt(++i); if (!(n >= 0xdc00 && n <= 0xdfff)) fail(); } else if (c >= 0xdc00 && c <= 0xdfff) fail(); } }
function tree(raw: unknown, cap: number) { let count = 0; const seen = new Set<object>(); const walk = (v: unknown, depth: number) => {
  if (++count > 30000 || depth > 24) fail(); if (v === null || typeof v === "boolean") return;
  if (typeof v === "string") { if (v.length > cap) fail(); unicode(v); return; } if (typeof v === "number") { if (!Number.isSafeInteger(v) || Object.is(v, -0)) fail(); return; }
  if (typeof v !== "object" || seen.has(v)) fail(); seen.add(v); const array = Array.isArray(v); if (array ? v.length > 25 || Object.getPrototypeOf(v) !== Array.prototype : Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null) fail();
  const keys = Reflect.ownKeys(v); if (array && keys.length !== v.length + 1) fail(); for (const k of keys) { if (typeof k !== "string" || k.length > cap) fail(); unicode(k); if (array && k === "length") continue;
    if (["__proto__", "constructor", "prototype"].includes(k) || array && !/^(0|[1-9][0-9]*)$/.test(k)) fail(); const d = Object.getOwnPropertyDescriptor(v, k)!; if (!d.enumerable || !("value" in d)) fail(); walk(d.value, depth + 1); }
  seen.delete(v); }; walk(raw, 0); if (new TextEncoder().encode(JSON.stringify(raw)).byteLength > cap) fail(); }
export function parseOperationalRuleLedgerJson(text: string, purpose: "request" | "response" = "response"): unknown {
  const cap = purpose === "request" ? OPERATIONAL_RULE_LEDGER_BODY_LIMIT : OPERATIONAL_RULE_LEDGER_RESPONSE_LIMIT;
  if (typeof text !== "string" || text.length > cap || new TextEncoder().encode(text).byteLength > cap) fail(); unicode(text); const value = parseCaptureBrowserJson(text); tree(value, cap); return value; }
const uuid = (v: unknown): string => typeof v === "string" && v.length === 36 && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v) ? v : fail();
const site = (v: unknown): string => typeof v === "string" && v.length === 8 && /^[0-9]{8}$/.test(v) ? v : fail();
const hash = (v: unknown): string => typeof v === "string" && v.length === 64 && /^[0-9a-f]{64}$/.test(v) ? v : fail();
const int = (v: unknown, min = 0, max = OPERATIONAL_RULE_LEDGER_MAX_REVISION): number => typeof v === "number" && Number.isSafeInteger(v) && !Object.is(v, -0) && v >= min && v <= max ? v : fail();
const bool = (v: unknown): boolean => typeof v === "boolean" ? v : fail();
const arr = (v: unknown): unknown[] => Array.isArray(v) && v.length <= 25 ? v : fail();
function label(v: unknown, max: number, trim: boolean) { if (typeof v !== "string" || v.length > max * 2 || !v || [...v].length > max || /[\u0000-\u001f\u007f-\u009f]/.test(v) || trim && v !== v.trim()) fail(); unicode(v); return v; }
function day(v: unknown): string { if (typeof v !== "string" || v.length !== 10 || !/^\d{4}-\d{2}-\d{2}$/.test(v) || v < "2000-01-01" || v > "2100-12-31" || !Number.isFinite(Date.parse(v + "T00:00:00Z")) || new Date(v + "T00:00:00Z").toISOString().slice(0, 10) !== v) fail(); return v; }
function stamp(v: unknown): string { if (typeof v !== "string" || v.length !== 27 || !/^(?!0000)\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(v)) fail(); const ms = v.slice(0, 23) + "Z"; if (!Number.isFinite(Date.parse(ms)) || new Date(ms).toISOString() !== ms) fail(); return v; }
export function parseOperationalRuleLedgerScope(raw: unknown): OperationalRuleLedgerScope { tree(raw, OPERATIONAL_RULE_LEDGER_BODY_LIMIT); const k = exact(raw, raw && typeof raw === "object" && (raw as { kind?: unknown }).kind === "enterprise" ? ["kind"] : raw && typeof raw === "object" && (raw as { kind?: unknown }).kind === "group" ? ["kind", "groupId"] : ["kind", "workerId", "employeeId", "employeeAuthUserId"]);
  return operationalRuleLedgerFreeze(k.kind === "enterprise" ? { kind: "enterprise" } : k.kind === "group" ? { kind: "group", groupId: uuid(k.groupId) } : k.kind === "personal" ? { kind: "personal", workerId: uuid(k.workerId), employeeId: uuid(k.employeeId), employeeAuthUserId: uuid(k.employeeAuthUserId) } : fail()); }
function personal(v: unknown) { const s = parseOperationalRuleLedgerScope(v); return s.kind === "personal" ? s : fail(); }
function context(v: unknown, scope: OperationalRuleLedgerScope): OperationalRuleLedgerContext { const r = exact(v, ["settingsVersion", "timeZone", "subject"]); let subject: OperationalRuleLedgerContext["subject"] = null;
  if (scope.kind === "enterprise") { if (r.subject !== null) fail(); } else if (scope.kind === "group") { const s = exact(r.subject, ["groupRevision"]); subject = { groupRevision: int(s.groupRevision, 1) }; }
  else { const s = exact(r.subject, ["workerVersion", "employeeVersion"]); subject = { workerVersion: int(s.workerVersion, 1), employeeVersion: int(s.employeeVersion, 1) }; }
  return { settingsVersion: int(r.settingsVersion, 1), timeZone: attendanceTimeZone(r.timeZone as string), subject }; }
function cursor(v: unknown, siteId: string, scope: OperationalRuleLedgerScope) { const c = exact(v, ["siteId", "scope", "atRevision", "beforeRevision"]); const out = { siteId: site(c.siteId), scope: parseOperationalRuleLedgerScope(c.scope), atRevision: int(c.atRevision, 1), beforeRevision: int(c.beforeRevision, 2) };
  if (out.siteId !== siteId || !operationalRuleLedgerEqual(out.scope, scope) || out.beforeRevision > out.atRevision) fail(); return out; }
function dates(scope: OperationalRuleLedgerScope, effective: unknown, ends: unknown) { const effectiveOn = day(effective), endsOn = ends === null ? null : day(ends);
  if (scope.kind === "personal" ? endsOn === null || endsOn < effectiveOn : endsOn !== null) fail(); return { effectiveOn, endsOn }; }
export function parseOperationalRuleLedgerQuery(raw: unknown): OperationalRuleLedgerQuery { tree(raw, OPERATIONAL_RULE_LEDGER_BODY_LIMIT); const m = (raw as { mode?: unknown })?.mode;
  const r = exact(raw, m === "detail" ? ["siteId", "mode", "scope"] : m === "history" ? ["siteId", "mode", "scope", "cursor"] : m === "preview" ? ["siteId", "mode", "scope", "sourceDraftRevision", "effectiveOn", "endsOn"] : m === "recover" ? ["siteId", "mode", "operationId"] : (raw as { catalog?: unknown })?.catalog === "saved_personal" ? ["siteId", "mode", "catalog", "afterScope"] : ["siteId", "mode", "catalog", "afterId"]);
  const siteId = site(r.siteId); if (m === "recover") return operationalRuleLedgerFreeze({ siteId, mode: m, operationId: uuid(r.operationId) });
  if (m === "catalog") { if (r.catalog === "saved_personal") return operationalRuleLedgerFreeze({ siteId, mode: m, catalog: r.catalog, afterScope: r.afterScope === null ? null : personal(r.afterScope) });
    if (r.catalog !== "workers" && r.catalog !== "routes") fail(); return operationalRuleLedgerFreeze({ siteId, mode: m, catalog: r.catalog, afterId: r.afterId === null ? null : uuid(r.afterId) }); }
  const scope = parseOperationalRuleLedgerScope(r.scope); if (m === "detail") return operationalRuleLedgerFreeze({ siteId, mode: m, scope });
  if (m === "history") return operationalRuleLedgerFreeze({ siteId, mode: m, scope, cursor: r.cursor === null ? null : cursor(r.cursor, siteId, scope) });
  if (m !== "preview") fail(); return operationalRuleLedgerFreeze({ siteId, mode: m, scope, sourceDraftRevision: int(r.sourceDraftRevision, 1), ...dates(scope, r.effectiveOn, r.endsOn) }); }
export function parseOperationalRuleLedgerCommand(raw: unknown): OperationalRuleLedgerCommand { tree(raw, OPERATIONAL_RULE_LEDGER_BODY_LIMIT); const a = (raw as { action?: unknown })?.action;
  const r = exact(raw, ["siteId", "scope", "operationId", "expectedRevision", "reason", "action", ...(a === "save_draft" ? ["expectedContext", "rules"] : a === "publish" ? ["sourceDraftRevision", "effectiveOn", "endsOn", "previewFingerprint"] : ["publishedRevision"])]);
  const scope = parseOperationalRuleLedgerScope(r.scope), base = { siteId: site(r.siteId), scope, operationId: uuid(r.operationId), expectedRevision: int(r.expectedRevision, 0, OPERATIONAL_RULE_LEDGER_MAX_REVISION - 1), reason: label(r.reason, 200, true) };
  if (a === "save_draft") return operationalRuleLedgerFreeze({ ...base, action: a, expectedContext: context(r.expectedContext, scope), rules: parseOperationalRules(r.rules) });
  if (a === "publish") { const sourceDraftRevision = int(r.sourceDraftRevision, 1); if (sourceDraftRevision > base.expectedRevision) fail(); return operationalRuleLedgerFreeze({ ...base, action: a, sourceDraftRevision, ...dates(scope, r.effectiveOn, r.endsOn), previewFingerprint: hash(r.previewFingerprint) }); }
  if (a !== "withdraw") fail(); const publishedRevision = int(r.publishedRevision, 1); if (publishedRevision > base.expectedRevision) fail(); return operationalRuleLedgerFreeze({ ...base, action: a, publishedRevision }); }
export function parseOperationalRuleLedgerBody(raw: unknown) { tree(raw, OPERATIONAL_RULE_LEDGER_BODY_LIMIT); const r = exact(raw, ["query", "command"]), query = parseOperationalRuleLedgerQuery(r.query), command = parseOperationalRuleLedgerCommand(r.command);
  if (query.mode !== "detail" || query.siteId !== command.siteId || !operationalRuleLedgerEqual(query.scope, command.scope)) fail(); return operationalRuleLedgerFreeze({ query, command }); }
export function operationalRuleLedgerQueryString(raw: OperationalRuleLedgerQuery) { const q = parseOperationalRuleLedgerQuery(raw), params = new URLSearchParams(); for (const [k, v] of Object.entries(q)) params.set(k, v === null || typeof v === "object" ? JSON.stringify(v) : String(v)); return params.toString(); }
export function parseOperationalRuleLedgerHttpQuery(url: string) { if (url.length > OPERATIONAL_RULE_LEDGER_BODY_LIMIT * 3) fail(); const search = new URL(url).search.slice(1); try { decodeURIComponent(search.replace(/\+/g, " ")); } catch { fail(); }
  const raw: Record<string, unknown> = {}; for (const [k, v] of new URLSearchParams(search)) { if (Object.hasOwn(raw, k) || ["__proto__", "constructor", "prototype"].includes(k)) fail(); raw[k] = ["scope", "cursor", "afterScope"].includes(k) ? parseOperationalRuleLedgerJson(v, "request") : ["endsOn", "afterId"].includes(k) && v === "null" ? null : k === "sourceDraftRevision" ? (/^[1-9][0-9]*$/.test(v) ? Number(v) : fail()) : v; } return parseOperationalRuleLedgerQuery(raw); }
type Tuple = null | boolean | number | string | readonly Tuple[];
export function operationalRuleLedgerEncode(v: Tuple): string { if (Array.isArray(v)) return "[" + v.map(operationalRuleLedgerEncode).join(", ") + "]"; if (v === null || typeof v === "boolean") return JSON.stringify(v); if (typeof v === "string") { unicode(v); return JSON.stringify(v); } if (typeof v === "number" && Number.isSafeInteger(v) && !Object.is(v, -0)) return JSON.stringify(v); return fail(); }
const scopeTuple = (s: OperationalRuleLedgerScope): Tuple => s.kind === "enterprise" ? [s.kind] : s.kind === "group" ? [s.kind, s.groupId] : [s.kind, s.workerId, s.employeeId, s.employeeAuthUserId];
export const operationalRuleLedgerScopeKey = (s: OperationalRuleLedgerScope) => operationalRuleLedgerEncode(scopeTuple(parseOperationalRuleLedgerScope(s)));
const contextTuple = (c: OperationalRuleLedgerContext): Tuple => [c.settingsVersion, c.timeZone, c.subject === null ? null : "groupRevision" in c.subject ? ["group", c.subject.groupRevision] : ["personal", c.subject.workerVersion, c.subject.employeeVersion]];
function rulesTuple(r: OperationalRules): Tuple { return OPERATIONAL_RULE_KEYS.map(k => { const c = r[k]; if (c.mode !== "value") return [c.mode]; let v: Tuple;
  switch (k) {
    case "allowedChannels": v = r.allowedChannels.mode === "value" ? r.allowedChannels.value : fail(); break;
    case "locationScope": v = r.locationScope.mode === "value" ? r.locationScope.value : fail(); break;
    case "shiftSource": v = r.shiftSource.mode === "value" ? r.shiftSource.value : fail(); break;
    case "breakTypes": { const b = r.breakTypes.mode === "value" ? r.breakTypes.value : fail(); v = [b.allowed, b.selection]; break; }
    case "correctionWindow": v = r.correctionWindow.mode === "value" ? r.correctionWindow.value.days : fail(); break;
    case "reviewRouting": { const b = r.reviewRouting.mode === "value" ? r.reviewRouting.value : fail(); v = OPERATIONAL_RULE_REVIEW_CATEGORIES.map(k => b[k] === "owner" ? ["owner"] : ["delegate", b[k].delegateEmployeeId, b[k].delegateAuthUserId]); break; }
    case "timesheetCycle": { const b = r.timesheetCycle.mode === "value" ? r.timesheetCycle.value : fail(); v = b.kind === "weekly" ? [b.kind, b.weekStartsOn] : b.kind === "fortnightly" ? [b.kind, b.anchorDate] : [b.kind]; break; }
    case "reminders": { const b = r.reminders.mode === "value" ? r.reminders.value : fail(); v = OPERATIONAL_RULE_REMINDER_KINDS.map(k => { const m = b[k]; return m.mode === "disabled" ? [m.mode] : [m.mode, m.afterMinutes, m.repeatMinutes, m.maxOccurrences]; }); break; }
  } return [c.mode, v]; }); }
const refsTuple = (r: OperationalRuleLedgerReferences): Tuple => [r.subject === null ? null : "groupActive" in r.subject ? ["group", r.subject.groupActive] : ["personal", r.subject.workerActive, r.subject.employeeActive], r.locations.map(l => [l.locationId, l.version, l.active]), r.routes.map(x => [x.category, x.employeeId, x.employeeAuthUserId, x.employeeVersion, x.active])];
async function digest(t: Tuple) { const bytes = new TextEncoder().encode(operationalRuleLedgerEncode(t)); const result = await crypto.subtle.digest("SHA-256", bytes); return [...new Uint8Array(result)].map(x => x.toString(16).padStart(2, "0")).join(""); }
export function operationalRuleLedgerCommandFingerprintText(raw: OperationalRuleLedgerCommand, actorId: string) { const c = parseOperationalRuleLedgerCommand(raw), tuple: Tuple[] = [c.siteId, scopeTuple(c.scope), c.action, c.operationId, c.expectedRevision, c.reason];
  if (c.action === "save_draft") tuple.push(contextTuple(c.expectedContext), rulesTuple(c.rules)); else if (c.action === "publish") tuple.push(c.sourceDraftRevision, c.effectiveOn, c.endsOn, c.previewFingerprint); else tuple.push(c.publishedRevision);
  return operationalRuleLedgerEncode(["attendance-operational-rule-command-v1", uuid(actorId), tuple]); }
export async function operationalRuleLedgerCommandFingerprint(c: OperationalRuleLedgerCommand, actorId: string) { const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(operationalRuleLedgerCommandFingerprintText(c, actorId))); return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join(""); }
export const operationalRuleLedgerRulesFingerprint = (rules: OperationalRules) => digest(["attendance-operational-rule-values-v1", rulesTuple(parseOperationalRules(rules))]);
export const operationalRuleLedgerReferenceFingerprint = (siteId: string, scope: OperationalRuleLedgerScope, c: OperationalRuleLedgerContext, refs: OperationalRuleLedgerReferences) => digest(["attendance-operational-rule-references-v1", site(siteId), scopeTuple(scope), contextTuple(c), refsTuple(refs)]);
export const operationalRuleLedgerPreviewFingerprint = (siteId: string, p: Omit<Extract<OperationalRuleLedgerData, { kind: "preview" }>, "kind" | "applied" | "previewFingerprint">) => digest(["attendance-operational-rule-publish-preview-v1", site(siteId), scopeTuple(p.scope), p.revision, p.sourceDraftRevision, p.rulesFingerprint, p.referenceFingerprint, p.effectiveOn, p.endsOn, p.effectiveAt, p.endsAt]);
function references(v: unknown, scope: OperationalRuleLedgerScope, rules?: OperationalRules): OperationalRuleLedgerReferences { const r = exact(v, ["subject", "locations", "routes"]); let subject: OperationalRuleLedgerReferences["subject"] = null;
  if (scope.kind === "enterprise") { if (r.subject !== null) fail(); } else if (scope.kind === "group") { const s = exact(r.subject, ["groupActive"]); subject = { groupActive: bool(s.groupActive) }; } else { const s = exact(r.subject, ["workerActive", "employeeActive"]); subject = { workerActive: bool(s.workerActive), employeeActive: bool(s.employeeActive) }; }
  const locations = arr(r.locations).map(x => { const l = exact(x, ["locationId", "version", "active"]); return { locationId: uuid(l.locationId), version: int(l.version, 1), active: bool(l.active) }; });
  const routes = arr(r.routes).map(x => { const t = exact(x, ["category", "employeeId", "employeeAuthUserId", "employeeVersion", "active"]); if (!OPERATIONAL_RULE_REVIEW_CATEGORIES.includes(t.category as never)) fail(); return { category: t.category as typeof OPERATIONAL_RULE_REVIEW_CATEGORIES[number], employeeId: uuid(t.employeeId), employeeAuthUserId: uuid(t.employeeAuthUserId), employeeVersion: int(t.employeeVersion, 1), active: bool(t.active) }; });
  if (locations.some((x, i) => i > 0 && locations[i - 1].locationId >= x.locationId) || routes.some((x, i) => i > 0 && OPERATIONAL_RULE_REVIEW_CATEGORIES.indexOf(routes[i - 1].category) >= OPERATIONAL_RULE_REVIEW_CATEGORIES.indexOf(x.category))) fail();
  if (rules) { const ids = rules.locationScope.mode === "value" ? rules.locationScope.value : []; if (!operationalRuleLedgerEqual(ids, locations.map(l => l.locationId))) fail();
    const expected = rules.reviewRouting.mode === "value" ? OPERATIONAL_RULE_REVIEW_CATEGORIES.flatMap(category => { const t = rules.reviewRouting.mode === "value" ? rules.reviewRouting.value[category] : "owner"; return t === "owner" ? [] : [{ category, employeeId: t.delegateEmployeeId, employeeAuthUserId: t.delegateAuthUserId }]; }) : [];
    if (!operationalRuleLedgerEqual(expected, routes.map(({ category, employeeId, employeeAuthUserId }) => ({ category, employeeId, employeeAuthUserId })))) fail(); }
  return { subject, locations, routes }; }
/** 241 private-source parsing bridge: exact values and canonical scalar tuples
 * only. This does not fabricate a ledger item or prove publication/authority. */
export function parseOperationalRuleLedgerSourceFields(raw: unknown) {
  tree(raw, OPERATIONAL_RULE_LEDGER_RESPONSE_LIMIT);
  const v = exact(raw, ["scope", "context", "rules", "references"]), scope = parseOperationalRuleLedgerScope(v.scope), c = context(v.context, scope);
  const rules = parseOperationalRules(v.rules), refs = references(v.references, scope, rules);
  return operationalRuleLedgerFreeze({ scope, context: c, rules, references: refs, tuples: [scopeTuple(scope), contextTuple(c), rulesTuple(rules), refsTuple(refs)] as const });
}
function future(effectiveOn: string, effectiveAt: string, at: string, c: OperationalRuleLedgerContext, refs: OperationalRuleLedgerReferences) {
  if (effectiveAt <= at || effectiveOn <= attendanceLocalDate(at.slice(0, 23) + "Z", c.timeZone) || refs.locations.some(x => !x.active) || refs.routes.some(x => !x.active)
    || refs.subject !== null && ("groupActive" in refs.subject ? !refs.subject.groupActive : !refs.subject.workerActive || !refs.subject.employeeActive)) fail(); }
function boundaries(scope: OperationalRuleLedgerScope, c: OperationalRuleLedgerContext, r: Record<string, unknown>) { const d = dates(scope, r.effectiveOn, r.endsOn), effectiveAt = stamp(r.effectiveAt), endsAt = r.endsAt === null ? null : stamp(r.endsAt);
  const micro = (s: string) => s.replace(/\.([0-9]{3})Z$/, ".$1000Z"); if (effectiveAt !== micro(attendanceDayUtcRange(d.effectiveOn, c.timeZone).startAt) || (d.endsOn === null ? endsAt !== null : endsAt !== micro(attendanceDayUtcRange(d.endsOn, c.timeZone).endAt)) || endsAt !== null && endsAt <= effectiveAt) fail(); return { ...d, effectiveAt, endsAt }; }
async function item(raw: unknown, siteId: string, scope: OperationalRuleLedgerScope, readAt: string): Promise<OperationalRuleLedgerItem> { const a = (raw as { action?: unknown })?.action;
  const r = exact(raw, ["scope", "operationId", "actorId", "revision", "reason", "recordedAt", "commandFingerprint", "action", ...(a === "withdraw" ? ["publishedRevision"] : ["context", "rules", "rulesFingerprint", "references", "referenceFingerprint", ...(a === "publish" ? ["sourceDraftRevision", "effectiveOn", "endsOn", "effectiveAt", "endsAt", "previewFingerprint"] : [])])]);
  if (!operationalRuleLedgerEqual(parseOperationalRuleLedgerScope(r.scope), scope)) fail(); const base = { scope, operationId: uuid(r.operationId), actorId: uuid(r.actorId), revision: int(r.revision, 1), reason: label(r.reason, 200, true), recordedAt: stamp(r.recordedAt), commandFingerprint: hash(r.commandFingerprint) };
  if (base.recordedAt > readAt) fail(); const cb = { siteId, scope, operationId: base.operationId, expectedRevision: base.revision - 1, reason: base.reason }; let value: OperationalRuleLedgerItem, command: OperationalRuleLedgerCommand;
  if (a === "withdraw") { const publishedRevision = int(r.publishedRevision, 1); if (publishedRevision >= base.revision) fail(); value = { ...base, action: a, publishedRevision }; command = { ...cb, action: a, publishedRevision }; }
  else { if (a !== "save_draft" && a !== "publish") fail(); const c = context(r.context, scope), rules = parseOperationalRules(r.rules), refs = references(r.references, scope, rules), rulesFingerprint = hash(r.rulesFingerprint), referenceFingerprint = hash(r.referenceFingerprint);
    if (rulesFingerprint !== await operationalRuleLedgerRulesFingerprint(rules) || referenceFingerprint !== await operationalRuleLedgerReferenceFingerprint(siteId, scope, c, refs)) fail(); const values = { ...base, context: c, rules, rulesFingerprint, references: refs, referenceFingerprint };
    if (a === "save_draft") { value = { ...values, action: a }; command = { ...cb, action: a, expectedContext: c, rules }; }
    else { const sourceDraftRevision = int(r.sourceDraftRevision, 1), ds = boundaries(scope, c, r), previewFingerprint = hash(r.previewFingerprint); if (sourceDraftRevision >= base.revision) fail(); future(ds.effectiveOn, ds.effectiveAt, base.recordedAt, c, refs);
      if (previewFingerprint !== await operationalRuleLedgerPreviewFingerprint(siteId, { ...values, revision: base.revision - 1, sourceDraftRevision, ...ds })) fail(); value = { ...values, action: a, sourceDraftRevision, ...ds, previewFingerprint }; command = { ...cb, action: a, sourceDraftRevision, effectiveOn: ds.effectiveOn, endsOn: ds.endsOn, previewFingerprint }; } }
  if (base.commandFingerprint !== await operationalRuleLedgerCommandFingerprint(command, base.actorId)) fail(); return value; }
function receipt(raw: unknown, actorId: string, readAt: string): OperationalRuleLedgerReceipt { const r = exact(raw, ["operationId", "actorId", "scope", "action", "revision", "recordedAt", "commandFingerprint"]);
  if (r.actorId !== actorId || !["save_draft", "publish", "withdraw"].includes(r.action as string)) fail(); const recordedAt = stamp(r.recordedAt); if (recordedAt > readAt) fail(); return { operationId: uuid(r.operationId), actorId, scope: parseOperationalRuleLedgerScope(r.scope), action: r.action as OperationalRuleLedgerCommand["action"], revision: int(r.revision, 1), recordedAt, commandFingerprint: hash(r.commandFingerprint) }; }
export function operationalRuleLedgerReceiptMatches(r: OperationalRuleLedgerReceipt, c: OperationalRuleLedgerCommand, actorId: string, fingerprint: string) { return r.actorId === actorId && r.operationId === c.operationId && r.action === c.action && r.revision === c.expectedRevision + 1 && operationalRuleLedgerEqual(r.scope, c.scope) && r.commandFingerprint === fingerprint; }
export async function parseOperationalRuleLedgerResult(raw: unknown, rawQuery: OperationalRuleLedgerQuery, actorId: string, command: OperationalRuleLedgerCommand | null = null): Promise<OperationalRuleLedgerResult> {
  try { tree(raw, OPERATIONAL_RULE_LEDGER_RESPONSE_LIMIT); const q = parseOperationalRuleLedgerQuery(rawQuery); uuid(actorId); if (command) command = parseOperationalRuleLedgerBody({ query: q, command }).command;
    const r = exact(raw, ["protocol", "siteId", "actorId", "readAt", "canWrite", "data", "receipt"]); if (r.protocol !== OPERATIONAL_RULE_LEDGER_PROTOCOL || r.siteId !== q.siteId || r.actorId !== actorId) fail(); const readAt = stamp(r.readAt), canWrite = bool(r.canWrite), rec = r.receipt === null ? null : receipt(r.receipt, actorId, readAt); let data: OperationalRuleLedgerData;
    if (command || q.mode === "recover") { const d = exact(r.data, ["kind"]); if (d.kind !== "receipt" || canWrite || command && !rec || q.mode === "recover" && rec && rec.operationId !== q.operationId) fail();
      if (command && rec && !operationalRuleLedgerReceiptMatches(rec, command, actorId, await operationalRuleLedgerCommandFingerprint(command, actorId))) fail(); data = { kind: "receipt" }; }
    else { if (rec !== null) fail(); if (q.mode === "catalog") { if (canWrite) fail(); const d = exact(r.data, ["kind", "catalog", "items", q.catalog === "saved_personal" ? "nextScope" : "nextId"]); if (d.kind !== "catalog" || d.catalog !== q.catalog) fail();
      if (q.catalog === "saved_personal") { const items = arr(d.items).map(x => { const i = exact(x, ["scope", "revision", "updatedAt"]); const updatedAt = stamp(i.updatedAt); if (updatedAt > readAt) fail(); return { scope: personal(i.scope), revision: int(i.revision, 1), updatedAt }; });
        let prev = q.afterScope ? operationalRuleLedgerScopeKey(q.afterScope) : ""; for (const i of items) { const key = operationalRuleLedgerScopeKey(i.scope); if (key <= prev) fail(); prev = key; } const nextScope = d.nextScope === null ? null : personal(d.nextScope); if (nextScope && (items.length !== 25 || !operationalRuleLedgerEqual(nextScope, items.at(-1)!.scope))) fail(); data = { kind: "catalog", catalog: q.catalog, items, nextScope }; }
      else { const items = arr(d.items).map(x => { if (q.catalog === "workers") { const i = exact(x, ["workerId", "workerName", "employeeId", "employeeAuthUserId"]); return { workerId: uuid(i.workerId), workerName: label(i.workerName, 120, false), employeeId: uuid(i.employeeId), employeeAuthUserId: uuid(i.employeeAuthUserId) }; }
        const i = exact(x, ["employeeId", "employeeName", "employeeAuthUserId"]); return { employeeId: uuid(i.employeeId), employeeName: label(i.employeeName, 120, false), employeeAuthUserId: uuid(i.employeeAuthUserId) }; }); let prev = q.afterId ?? ""; for (const i of items) { const id = "workerId" in i ? i.workerId! : i.employeeId; if (id <= prev) fail(); prev = id; }
        const nextId = d.nextId === null ? null : uuid(d.nextId); if (nextId && (items.length !== 25 || nextId !== prev)) fail(); data = { kind: "catalog", catalog: q.catalog, items, nextId } as OperationalRuleLedgerData; } }
    else { const scope = q.scope; if (q.mode === "detail") { const d = exact(r.data, ["kind", "scope", "revision", "context", "draft", "currentPublication", "nextPublication", "canWithdraw"]); if (d.kind !== q.mode || !operationalRuleLedgerEqual(parseOperationalRuleLedgerScope(d.scope), scope)) fail(); const revision = int(d.revision), c = d.context === null ? null : context(d.context, scope);
      const draft = d.draft === null ? null : await item(d.draft, q.siteId, scope, readAt), current = d.currentPublication === null ? null : await item(d.currentPublication, q.siteId, scope, readAt), next = d.nextPublication === null ? null : await item(d.nextPublication, q.siteId, scope, readAt), canWithdraw = bool(d.canWithdraw);
      if (draft && (draft.action !== "save_draft" || draft.revision > revision) || current && (current.action !== "publish" || current.revision > revision || current.effectiveAt > readAt || current.endsAt !== null && current.endsAt <= readAt) || next && (next.action !== "publish" || next.revision > revision || next.effectiveAt <= readAt) || canWithdraw && !next || canWrite && !c || current && next && current.revision === next.revision) fail();
      data = { kind: "detail", scope, revision, context: c, draft: draft as OperationalRuleLedgerSaveDraftItem | null, currentPublication: current as OperationalRuleLedgerPublishItem | null, nextPublication: next as OperationalRuleLedgerPublishItem | null, canWithdraw }; }
    else if (q.mode === "preview") { const d = exact(r.data, ["kind", "scope", "revision", "sourceDraftRevision", "context", "rulesFingerprint", "references", "referenceFingerprint", "effectiveOn", "endsOn", "effectiveAt", "endsAt", "previewFingerprint", "applied"]); if (d.kind !== q.mode || d.applied !== false || !operationalRuleLedgerEqual(parseOperationalRuleLedgerScope(d.scope), scope)) fail(); const c = context(d.context, scope), ds = boundaries(scope, c, d), revision = int(d.revision, 1), sourceDraftRevision = int(d.sourceDraftRevision, 1), refs = references(d.references, scope), rulesFingerprint = hash(d.rulesFingerprint), referenceFingerprint = hash(d.referenceFingerprint), previewFingerprint = hash(d.previewFingerprint);
      if (sourceDraftRevision > revision || sourceDraftRevision !== q.sourceDraftRevision || ds.effectiveOn !== q.effectiveOn || ds.endsOn !== q.endsOn || referenceFingerprint !== await operationalRuleLedgerReferenceFingerprint(q.siteId, scope, c, refs)) fail(); future(ds.effectiveOn, ds.effectiveAt, readAt, c, refs); const p = { scope, revision, sourceDraftRevision, context: c, rulesFingerprint, references: refs, referenceFingerprint, ...ds }; if (previewFingerprint !== await operationalRuleLedgerPreviewFingerprint(q.siteId, p)) fail(); data = { kind: "preview", ...p, previewFingerprint, applied: false }; }
    else { const d = exact(r.data, ["kind", "scope", "atRevision", "items", "nextCursor"]); if (d.kind !== "history" || canWrite || !operationalRuleLedgerEqual(parseOperationalRuleLedgerScope(d.scope), scope)) fail(); const atRevision = int(d.atRevision); if (q.cursor && atRevision !== q.cursor.atRevision) fail();
      let wanted = Math.min(atRevision, q.cursor ? q.cursor.beforeRevision - 1 : atRevision); const items: { item: OperationalRuleLedgerItem; withdrawnByRevision: number | null }[] = [];
      for (const row of arr(d.items)) { const x = exact(row, ["item", "withdrawnByRevision"]), i = await item(x.item, q.siteId, scope, readAt), w = x.withdrawnByRevision === null ? null : int(x.withdrawnByRevision, 1); if (i.revision !== wanted-- || w !== null && (i.action !== "publish" || w <= i.revision || w > atRevision)) fail(); items.push({ item: i, withdrawnByRevision: w }); }
      const nextCursor = d.nextCursor === null ? null : cursor(d.nextCursor, q.siteId, scope); if (items.length === 0 ? atRevision !== 0 || q.cursor !== null || nextCursor !== null : wanted > 0 ? items.length !== 25 || !nextCursor || nextCursor.atRevision !== atRevision || nextCursor.beforeRevision !== items.at(-1)!.item.revision : nextCursor !== null) fail(); data = { kind: "history", scope, atRevision, items, nextCursor }; } } }
    return operationalRuleLedgerFreeze({ protocol: OPERATIONAL_RULE_LEDGER_PROTOCOL, siteId: q.siteId, actorId, readAt, canWrite, data, receipt: rec });
  } catch { throw new MerchantAttendanceError("attendance_operational_rule_invalid"); } }
export async function parseOperationalRuleLedgerResponse(raw: unknown, q: OperationalRuleLedgerQuery, actorId: string, command: OperationalRuleLedgerCommand | null = null): Promise<OperationalRuleLedgerResponse> {
  tree(raw, OPERATIONAL_RULE_LEDGER_RESPONSE_LIMIT); if ((raw as { ok?: unknown })?.ok === true) { const r = exact(raw, ["ok", "data"]); return operationalRuleLedgerFreeze({ ok: true, data: await parseOperationalRuleLedgerResult(r.data, q, actorId, command) }); }
  const r = exact(raw, ["ok", "error"]), e = exact(r.error, ["code", "message"]); if (r.ok !== false || typeof e.code !== "string" || !Object.hasOwn(OPERATIONAL_RULE_LEDGER_ERRORS, e.code) || e.message !== OPERATIONAL_RULE_LEDGER_MESSAGES[e.code as OperationalRuleLedgerErrorCode]) fail(); return operationalRuleLedgerFreeze({ ok: false, error: { code: e.code as OperationalRuleLedgerErrorCode, message: e.message as string } }); }
