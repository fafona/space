// Independent owner rule-version ledger. It does not apply rules to attendance.
import { parseAttendanceRuleDraft, type AttendanceRuleDraft } from "./merchantAttendanceRuleDraft";
import { attendanceSelfSite, attendanceSelfUuid } from "./merchantAttendanceSelf";
import { attendanceRecordInstant } from "./merchantAttendanceManagement";
import { attendanceDayUtcRange, attendanceLocalDate, attendanceTimeZone, MerchantAttendanceError } from "./merchantAttendanceTime";

export type RulesQuery = { siteId: string; groupId: string | null; operationId: string | null; beforeRevision: number | null };
type WriteContext = { expectedSettingsVersion: number; expectedGroupRevision: number | null; timeZone: string };
export type RulesCommand = { operationId: string; expectedRevision: number; reason: string } & (
  { action: "save_draft"; rules: AttendanceRuleDraft } & WriteContext |
  { action: "publish"; effectiveOn: string } & WriteContext |
  { action: "withdraw"; publishedRevision: number }
);
export type RulesDraft = { revision: number; settingsVersion: number; groupRevision: number | null; timeZone: string; rules: AttendanceRuleDraft };
export type RulesItem = {
  revision: number; operationId: string; actorId: string; action: RulesCommand["action"]; reason: string; recordedAt: string;
  settingsVersion: number | null; groupRevision: number | null; timeZone: string | null; rules: AttendanceRuleDraft | null;
  effectiveOn: string | null; effectiveAt: string | null; publishedRevision: number | null;
};
export type RulesReceipt = { operationId: string; revision: number; command: RulesCommand; item: RulesItem };
export type RulesResult = {
  protocol: "rules-v1"; siteId: string; actorId: string;
  group: { groupId: string; revision: number; name: string; active: boolean } | null;
  settingsVersion: number; timeZone: string; revision: number; draft: RulesDraft | null;
  items: Array<RulesItem & { withdrawnByRevision: number | null }>; nextBeforeRevision: number | null;
  receipt: RulesReceipt | null;
};
export type RulesResponse = RulesResult & { ok: true; moduleEnabled: boolean };

export const RULES_ERRORS: Readonly<Record<string, number>> = Object.freeze({
  attendance_invalid_request: 400, attendance_access_denied: 403, attendance_not_available: 404,
  attendance_group_not_found: 404, attendance_settings_required: 409, attendance_operation_conflict: 409,
  attendance_unavailable: 503, attendance_rule_invalid: 503, attendance_rate_limited: 429,
  attendance_version_conflict: 409, attendance_rule_draft_required: 409, attendance_rule_future_required: 409,
  attendance_rule_order_conflict: 409, attendance_rule_already_withdrawn: 409, attendance_rule_group_inactive: 409,
  attendance_platform_paused: 403, attendance_body_too_large: 413, attendance_invalid_content_type: 415,
});
const fail = (): never => { throw new MerchantAttendanceError("attendance_invalid_request"); };
const MAX = 9007199254740990;
function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail();
  const proto = Object.getPrototypeOf(value), descriptors = Object.getOwnPropertyDescriptors(value);
  if (proto !== null && proto !== Object.prototype || Reflect.ownKeys(value).length !== keys.length
    || keys.some(key => !Object.hasOwn(descriptors, key) || !("value" in descriptors[key]))) return fail();
  return value as Record<string, unknown>;
}
const integer = (v: unknown, min = 1, max = MAX): number => typeof v === "number" && Number.isSafeInteger(v) && !Object.is(v, -0) && v >= min && v <= max ? v : fail();
const uuid = (v: unknown) => attendanceSelfUuid(v);
const optionalUuid = (v: unknown) => v === null ? null : uuid(v);
const optionalRevision = (v: unknown) => v === null ? null : integer(v);
const bool = (v: unknown) => typeof v === "boolean" ? v : fail();
const zone = (v: unknown) => { try { return typeof v === "string" ? attendanceTimeZone(v) : fail(); } catch { return fail(); } };
const rules = (v: unknown) => { try { return parseAttendanceRuleDraft(v); } catch { return fail(); } };
const at = (v: unknown) => { try { const parsed = attendanceRecordInstant(v); return parsed === v ? parsed : fail(); } catch { return fail(); } };
function label(v: unknown, max: number) {
  return typeof v === "string" && v.length > 0 && v === v.trim() && [...v].length <= max && !/[\u0000-\u001f\u007f-\u009f]/.test(v) ? v : fail();
}
function date(v: unknown, timeZone = "UTC") {
  try { if (typeof v !== "string") return fail(); attendanceDayUtcRange(v, timeZone); return v; } catch { return fail(); }
}
function context(v: Record<string, unknown>): WriteContext {
  return { expectedSettingsVersion: integer(v.expectedSettingsVersion), expectedGroupRevision: optionalRevision(v.expectedGroupRevision), timeZone: zone(v.timeZone) };
}
export function parseRulesQuery(raw: unknown): RulesQuery {
  const q = exact(raw, ["siteId", "groupId", "operationId", "beforeRevision"]);
  const query = { siteId: attendanceSelfSite(q.siteId), groupId: optionalUuid(q.groupId), operationId: optionalUuid(q.operationId), beforeRevision: optionalRevision(q.beforeRevision) };
  if (query.operationId !== null && query.beforeRevision !== null) fail();
  return query;
}
export function parseRulesHttpQuery(url: string) {
  const params = new URL(url).searchParams, raw: Record<string, unknown> = { groupId: null, operationId: null, beforeRevision: null };
  for (const [key, value] of params) {
    if (!["siteId", "groupId", "operationId", "beforeRevision"].includes(key) || params.getAll(key).length !== 1) fail();
    if (key === "beforeRevision") { if (!/^[1-9][0-9]{0,15}$/.test(value)) fail(); raw[key] = Number(value); }
    else raw[key] = value;
  }
  return parseRulesQuery(raw);
}
export function rulesQueryString(q: RulesQuery) {
  return new URLSearchParams(Object.entries(parseRulesQuery(q)).filter(([, v]) => v !== null).map(([k, v]) => [k, String(v)])).toString();
}
export function parseRulesCommand(raw: unknown): RulesCommand {
  if (!raw || typeof raw !== "object") return fail();
  const descriptor = Object.getOwnPropertyDescriptor(raw, "action"), action: unknown = descriptor && "value" in descriptor ? descriptor.value : undefined;
  const common = ["operationId", "action", "expectedRevision", "reason"];
  const c = exact(raw, action === "save_draft" ? [...common, "expectedSettingsVersion", "expectedGroupRevision", "timeZone", "rules"]
    : action === "publish" ? [...common, "expectedSettingsVersion", "expectedGroupRevision", "timeZone", "effectiveOn"] : [...common, "publishedRevision"]);
  const base = { operationId: uuid(c.operationId), expectedRevision: integer(c.expectedRevision, 0, MAX - 1), reason: label(c.reason, 200) };
  if (action === "save_draft") return { ...base, action, ...context(c), rules: rules(c.rules) };
  if (action === "publish") {
    const ctx = context(c);
    return { ...base, action, ...ctx, effectiveOn: date(c.effectiveOn, ctx.timeZone) };
  }
  if (action !== "withdraw") return fail();
  const publishedRevision = integer(c.publishedRevision);
  if (publishedRevision > base.expectedRevision) fail();
  return { ...base, action, publishedRevision };
}
export function parseRulesBody(raw: unknown) {
  const v = exact(raw, ["query", "command"]), query = parseRulesQuery(v.query), command = parseRulesCommand(v.command);
  if (query.operationId !== null || query.beforeRevision !== null || command.action !== "withdraw" && (query.groupId === null) !== (command.expectedGroupRevision === null)) fail();
  return { query, command };
}
export function sameRulesCommand(a: RulesCommand, b: RulesCommand) { return JSON.stringify(parseRulesCommand(a)) === JSON.stringify(parseRulesCommand(b)); }

const itemKeys = ["revision", "operationId", "actorId", "action", "reason", "recordedAt", "settingsVersion", "groupRevision", "timeZone", "rules", "effectiveOn", "effectiveAt", "publishedRevision"];
export { item as parseRulesItem };
function item(raw: unknown, groupId: string | null): RulesItem {
  const v = exact(raw, itemKeys), base = { revision: integer(v.revision), operationId: uuid(v.operationId), actorId: uuid(v.actorId), reason: label(v.reason, 200), recordedAt: at(v.recordedAt) };
  if (v.action === "withdraw") {
    if ([v.settingsVersion, v.groupRevision, v.timeZone, v.rules, v.effectiveOn, v.effectiveAt].some(value => value !== null)) fail();
    const publishedRevision = integer(v.publishedRevision); if (publishedRevision >= base.revision) fail();
    return { ...base, action: "withdraw", settingsVersion: null, groupRevision: null, timeZone: null, rules: null, effectiveOn: null, effectiveAt: null, publishedRevision };
  }
  const settingsVersion = integer(v.settingsVersion), groupRevision = optionalRevision(v.groupRevision), timeZone = zone(v.timeZone), values = rules(v.rules);
  if ((groupId === null) !== (groupRevision === null) || v.publishedRevision !== null) fail();
  if (v.action === "save_draft") {
    if (v.effectiveOn !== null || v.effectiveAt !== null) fail();
    return { ...base, action: "save_draft", settingsVersion, groupRevision, timeZone, rules: values, effectiveOn: null, effectiveAt: null, publishedRevision: null };
  }
  if (v.action !== "publish") return fail();
  const effectiveOn = date(v.effectiveOn, timeZone), effectiveAt = attendanceDayUtcRange(effectiveOn, timeZone).startAt;
  if (v.effectiveAt !== effectiveAt || effectiveOn <= attendanceLocalDate(base.recordedAt.slice(0, 23) + "Z", timeZone)) fail();
  return { ...base, action: "publish", settingsVersion, groupRevision, timeZone, rules: values, effectiveOn, effectiveAt, publishedRevision: null };
}
function draft(raw: unknown, groupId: string | null): RulesDraft | null {
  if (raw === null) return null;
  const d = exact(raw, ["revision", "settingsVersion", "groupRevision", "timeZone", "rules"]);
  const parsed = { revision: integer(d.revision), settingsVersion: integer(d.settingsVersion), groupRevision: optionalRevision(d.groupRevision), timeZone: zone(d.timeZone), rules: rules(d.rules) };
  if ((groupId === null) !== (parsed.groupRevision === null)) fail();
  return parsed;
}
function receipt(raw: unknown, q: RulesQuery): RulesReceipt | null {
  if (raw === null) return null;
  const r = exact(raw, ["operationId", "revision", "command", "item"]);
  const command = parseRulesCommand(r.command), parsedItem = item(r.item, q.groupId);
  const operationId = uuid(r.operationId), revision = integer(r.revision);
  if (command.operationId !== operationId || parsedItem.operationId !== operationId || parsedItem.revision !== revision
    || command.expectedRevision + 1 !== revision || command.reason !== parsedItem.reason || command.action !== parsedItem.action) fail();
  if (command.action === "withdraw") { if (command.publishedRevision !== parsedItem.publishedRevision) fail(); }
  else {
    if (command.timeZone !== parsedItem.timeZone || command.expectedGroupRevision !== parsedItem.groupRevision || command.expectedSettingsVersion !== parsedItem.settingsVersion) fail();
    if (command.action === "save_draft" && JSON.stringify(command.rules) !== JSON.stringify(parsedItem.rules)
      || command.action === "publish" && command.effectiveOn !== parsedItem.effectiveOn) fail();
  }
  return { operationId, revision, command, item: parsedItem };
}
const resultKeys = ["protocol", "siteId", "actorId", "group", "settingsVersion", "timeZone", "revision", "draft", "items", "nextBeforeRevision", "receipt"];
export function parseRulesResult(raw: unknown, input: RulesQuery, command: RulesCommand | null = null, expectedActorId?: string): RulesResult {
  const q = parseRulesQuery(input), v = exact(raw, resultKeys);
  if (command) parseRulesBody({ query: q, command });
  const siteId = attendanceSelfSite(v.siteId), actorId = uuid(v.actorId), revision = integer(v.revision, 0);
  if (v.protocol !== "rules-v1" || siteId !== q.siteId || expectedActorId !== undefined && actorId !== uuid(expectedActorId)) fail();
  let group: RulesResult["group"] = null;
  if (v.group !== null) {
    const g = exact(v.group, ["groupId", "revision", "name", "active"]);
    group = { groupId: uuid(g.groupId), revision: integer(g.revision), name: label(g.name, 80), active: bool(g.active) };
  }
  if ((group?.groupId ?? null) !== q.groupId) fail();
  const settingsVersion = integer(v.settingsVersion), timeZone = zone(v.timeZone), savedDraft = draft(v.draft, q.groupId);
  if (savedDraft && savedDraft.revision > revision || !Array.isArray(v.items) || v.items.length > 25) fail();
  const available = Math.min(revision, q.beforeRevision === null ? revision : q.beforeRevision - 1);
  if ((v.items as unknown[]).length !== Math.min(available, 25)) fail();
  const items = (v.items as unknown[]).map((rawItem, index) => {
    const row = exact(rawItem, [...itemKeys, "withdrawnByRevision"]), { withdrawnByRevision: rawWithdrawal, ...core } = row;
    const parsed = item(core, q.groupId), withdrawnByRevision = optionalRevision(rawWithdrawal);
    if (parsed.revision !== available - index || withdrawnByRevision !== null && (parsed.action !== "publish" || withdrawnByRevision <= parsed.revision || withdrawnByRevision > revision)) fail();
    return { ...parsed, withdrawnByRevision };
  });
  const nextBeforeRevision = optionalRevision(v.nextBeforeRevision);
  if (nextBeforeRevision !== (available > 25 ? items.at(-1)!.revision : null)) fail();
  const parsedReceipt = receipt(v.receipt, q), requestedOperation = command?.operationId ?? q.operationId;
  if (parsedReceipt && (parsedReceipt.operationId !== requestedOperation || parsedReceipt.revision > revision || parsedReceipt.item.actorId !== actorId)
    || command && (!parsedReceipt || !sameRulesCommand(command, parsedReceipt.command))) fail();
  if (!parsedReceipt && requestedOperation !== null && items.some(row => row.operationId === requestedOperation)) fail();
  const visibleDraft = savedDraft && items.find(row => row.revision === savedDraft.revision);
  if (visibleDraft && (visibleDraft.action !== "save_draft" || JSON.stringify(visibleDraft.rules) !== JSON.stringify(savedDraft!.rules)
    || visibleDraft.timeZone !== savedDraft!.timeZone || visibleDraft.settingsVersion !== savedDraft!.settingsVersion || visibleDraft.groupRevision !== savedDraft!.groupRevision)) fail();
  if (available === revision) {
    const latestDraftChange = items.find(row => row.action !== "withdraw");
    if (latestDraftChange?.action === "publish" && savedDraft !== null
      || latestDraftChange?.action === "save_draft" && savedDraft?.revision !== latestDraftChange.revision) fail();
  }
  if (parsedReceipt) {
    const matching = items.find(row => row.revision === parsedReceipt.revision);
    if (matching) {
      const { withdrawnByRevision: ignored, ...core } = matching; void ignored;
      if (JSON.stringify(core) !== JSON.stringify(parsedReceipt.item)) fail();
    }
  }
  return { protocol: "rules-v1", siteId, actorId, group, settingsVersion, timeZone, revision, draft: savedDraft, items, nextBeforeRevision, receipt: parsedReceipt };
}
export function parseRulesResponse(raw: unknown, q: RulesQuery, command: RulesCommand | null = null, expectedActorId?: string): RulesResponse {
  const v = exact(raw, [...resultKeys, "ok", "moduleEnabled"]), { ok, moduleEnabled, ...body } = v;
  if (ok !== true) fail();
  return { ...parseRulesResult(body, q, command, expectedActorId), ok: true, moduleEnabled: bool(moduleEnabled) };
}
