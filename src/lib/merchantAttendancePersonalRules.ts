// Independent, owner-approved candidate exceptions. This protocol does not
// apply rules to punches, hours, classifications, wages or historical reports.
import { parseAttendanceRuleDraft, RULE_KEYS, type AttendanceRuleDraft } from "./merchantAttendanceRuleDraft";
import { attendanceSelfSite, attendanceSelfUuid } from "./merchantAttendanceSelf";
import { attendanceRecordInstant } from "./merchantAttendanceManagement";
import { attendanceDayUtcRange, attendanceLocalDate, attendanceTimeZone, MerchantAttendanceError } from "./merchantAttendanceTime";

export type PersonalRulesQuery = { siteId: string; workerId: string; operationId: string | null; beforeRevision: number | null };
export type PersonalRulesCommand = { operationId: string; expectedRevision: number; reason: string } & (
  { action: "approve"; expectedWorkerVersion: number; expectedSettingsVersion: number; employeeId: string; employeeAuthUserId: string;
    timeZone: string; startsOn: string; endsOn: string; rules: AttendanceRuleDraft } |
  { action: "withdraw"; approvedRevision: number }
);
type PersonalRulesSnapshot = { employeeId: string; employeeAuthUserId: string; workerVersion: number; settingsVersion: number;
  timeZone: string; startsOn: string; endsOn: string; fromAt: string; toAt: string; rules: AttendanceRuleDraft };
export type PersonalRulesItem = PersonalRulesSnapshot & { revision: number; operationId: string; actorId: string; reason: string; recordedAt: string } & (
  { action: "approve"; approvedRevision: null } | { action: "withdraw"; approvedRevision: number }
);
export type PersonalRulesWorker = { workerId: string; workerName: string; workerNo: string; employeeId: string | null; employeeAuthUserId: string | null;
  version: number; active: boolean; employeeActive: boolean };
export type PersonalRulesReceipt = { operationId: string; revision: number; command: PersonalRulesCommand; item: PersonalRulesItem };
export type PersonalRulesResult = { protocol: "personal-rules-v1"; siteId: string; actorId: string; worker: PersonalRulesWorker;
  settingsVersion: number; timeZone: string; revision: number; items: Array<PersonalRulesItem & { withdrawnByRevision: number | null }>;
  nextBeforeRevision: number | null; receipt: PersonalRulesReceipt | null; readAt: string };
export type PersonalRulesResponse = PersonalRulesResult & { ok: true; moduleEnabled: boolean };
export const PERSONAL_RULES_ERRORS: Readonly<Record<string, number>> = Object.freeze({
  attendance_invalid_request: 400, attendance_access_denied: 403, attendance_not_available: 404,
  attendance_worker_not_found: 404, attendance_settings_required: 409, attendance_operation_conflict: 409,
  attendance_unavailable: 503, attendance_rate_limited: 429, attendance_version_conflict: 409,
  attendance_platform_paused: 403, attendance_body_too_large: 413, attendance_invalid_content_type: 415,
  attendance_personal_rule_invalid: 503, attendance_personal_rule_future_required: 409, attendance_personal_rule_overlap: 409,
  attendance_personal_rule_already_withdrawn: 409, attendance_personal_rule_worker_inactive: 409, attendance_personal_rule_identity_changed: 409,
});

const MAX = 9007199254740990;
function fail(): never { throw new MerchantAttendanceError("attendance_invalid_request"); }
function exact(raw: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fail();
  const prototype = Object.getPrototypeOf(raw), descriptors = Object.getOwnPropertyDescriptors(raw);
  if (prototype !== null && prototype !== Object.prototype || Reflect.ownKeys(raw).length !== keys.length
    || keys.some(key => !Object.hasOwn(descriptors, key) || !("value" in descriptors[key]) || !descriptors[key].enumerable)) fail();
  return raw as Record<string, unknown>;
}
function array(raw: unknown, maximum: number): unknown[] {
  if (!Array.isArray(raw) || Object.getPrototypeOf(raw) !== Array.prototype || raw.length > maximum || Reflect.ownKeys(raw).length !== raw.length + 1) return fail();
  const descriptors = Object.getOwnPropertyDescriptors(raw);
  for (let n = 0; n < raw.length; n++) if (!descriptors[n] || !("value" in descriptors[n]) || !descriptors[n].enumerable) fail();
  return raw;
}
const integer = (value: unknown, minimum = 1, maximum = MAX): number => typeof value === "number" && Number.isSafeInteger(value) && !Object.is(value, -0) && value >= minimum && value <= maximum ? value : fail();
const optionalRevision = (value: unknown) => value === null ? null : integer(value);
const uuid = (value: unknown) => attendanceSelfUuid(value);
const optionalUuid = (value: unknown) => value === null ? null : uuid(value);
const bool = (value: unknown) => typeof value === "boolean" ? value : fail();
const zone = (value: unknown) => { try { return typeof value === "string" ? attendanceTimeZone(value) : fail(); } catch { return fail(); } };
function recordAt(value: unknown): string { try { const at = attendanceRecordInstant(value); return value === at ? at : fail(); } catch { return fail(); } }
function label(value: unknown, maximum: number): string {
  return typeof value === "string" && !!value && value === value.trim() && [...value].length <= maximum && !/[\u0000-\u001f\u007f-\u009f]/.test(value) ? value : fail();
}
function rules(raw: unknown): AttendanceRuleDraft {
  try {
    const draft = exact(raw, RULE_KEYS);
    for (const key of RULE_KEYS) {
      const value = draft[key];
      if (!value || typeof value !== "object") fail();
      const descriptor = Object.getOwnPropertyDescriptor(value, "mode"), mode: unknown = descriptor && "value" in descriptor ? descriptor.value : undefined;
      exact(value, mode === "value" ? ["mode", "minutes"] : ["mode"]);
    }
    const result = parseAttendanceRuleDraft(draft);
    if (RULE_KEYS.every(key => result[key].mode === "inherit")) fail();
    return result;
  } catch { return fail(); }
}
function interval(starts: unknown, ends: unknown, timeZone: string) {
  if (typeof starts !== "string" || typeof ends !== "string") return fail();
  try {
    const first = attendanceDayUtcRange(starts, timeZone), last = attendanceDayUtcRange(ends, timeZone);
    const dates = (Date.parse(ends) - Date.parse(starts)) / 86400000 + 1;
    if (!Number.isInteger(dates) || dates < 1 || dates > 31 || first.startAt >= last.endAt) fail();
    return { startsOn: starts, endsOn: ends, fromAt: first.startAt, toAt: last.endAt };
  } catch { return fail(); }
}
const queryKeys = ["siteId", "workerId", "operationId", "beforeRevision"];
export function parsePersonalRulesQuery(raw: unknown): PersonalRulesQuery {
  const q = exact(raw, queryKeys), operationId = optionalUuid(q.operationId), beforeRevision = optionalRevision(q.beforeRevision);
  if (operationId !== null && beforeRevision !== null) fail();
  return { siteId: attendanceSelfSite(q.siteId), workerId: uuid(q.workerId), operationId, beforeRevision };
}
export function parsePersonalRulesHttpQuery(url: string): PersonalRulesQuery {
  const params = new URL(url).searchParams, raw: Record<string, unknown> = Object.assign(Object.create(null), { operationId: null, beforeRevision: null });
  for (const [key, value] of params) {
    if (!queryKeys.includes(key) || params.getAll(key).length !== 1) fail();
    if (key === "beforeRevision") { if (!/^[1-9][0-9]{0,15}$/.test(value)) fail(); raw[key] = Number(value); }
    else raw[key] = value;
  }
  return parsePersonalRulesQuery(raw);
}
export function personalRulesQueryString(query: PersonalRulesQuery) {
  return new URLSearchParams(Object.entries(parsePersonalRulesQuery(query)).filter(([, value]) => value !== null).map(([key, value]) => [key, String(value)])).toString();
}
export function parsePersonalRulesCommand(raw: unknown): PersonalRulesCommand {
  if (!raw || typeof raw !== "object") return fail();
  const descriptor = Object.getOwnPropertyDescriptor(raw, "action"), action: unknown = descriptor && "value" in descriptor ? descriptor.value : undefined;
  const common = ["operationId", "action", "expectedRevision", "reason"];
  const c = exact(raw, action === "approve" ? [...common, "expectedWorkerVersion", "expectedSettingsVersion", "employeeId", "employeeAuthUserId", "timeZone", "startsOn", "endsOn", "rules"] : [...common, "approvedRevision"]);
  const base = { operationId: uuid(c.operationId), expectedRevision: integer(c.expectedRevision, 0, MAX - 1), reason: label(c.reason, 200) };
  if (action === "approve") {
    const timeZone = zone(c.timeZone), range = interval(c.startsOn, c.endsOn, timeZone);
    return { ...base, action, expectedWorkerVersion: integer(c.expectedWorkerVersion), expectedSettingsVersion: integer(c.expectedSettingsVersion),
      employeeId: uuid(c.employeeId), employeeAuthUserId: uuid(c.employeeAuthUserId), timeZone, startsOn: range.startsOn, endsOn: range.endsOn, rules: rules(c.rules) };
  }
  if (action !== "withdraw") return fail();
  const approvedRevision = integer(c.approvedRevision); if (approvedRevision > base.expectedRevision) fail();
  return { ...base, action, approvedRevision };
}
export function parsePersonalRulesBody(raw: unknown) {
  const v = exact(raw, ["query", "command"]), query = parsePersonalRulesQuery(v.query), command = parsePersonalRulesCommand(v.command);
  if (query.operationId !== null || query.beforeRevision !== null) fail();
  return { query, command };
}
export function samePersonalRulesCommand(a: PersonalRulesCommand, b: PersonalRulesCommand) {
  return JSON.stringify(parsePersonalRulesCommand(a)) === JSON.stringify(parsePersonalRulesCommand(b));
}

const snapshotKeys = ["employeeId", "employeeAuthUserId", "workerVersion", "settingsVersion", "timeZone", "startsOn", "endsOn", "fromAt", "toAt", "rules"] as const;
const itemKeys = ["revision", "operationId", "actorId", "action", "reason", "recordedAt", ...snapshotKeys, "approvedRevision"];
export function parsePersonalRulesItem(raw: unknown): PersonalRulesItem {
  const v = exact(raw, itemKeys), timeZone = zone(v.timeZone), range = interval(v.startsOn, v.endsOn, timeZone), recordedAt = recordAt(v.recordedAt);
  const revision = integer(v.revision);
  if (v.fromAt !== range.fromAt || v.toAt !== range.toAt || recordedAt >= attendanceRecordInstant(range.fromAt)) fail();
  const base = { revision, operationId: uuid(v.operationId), actorId: uuid(v.actorId), reason: label(v.reason, 200), recordedAt,
    employeeId: uuid(v.employeeId), employeeAuthUserId: uuid(v.employeeAuthUserId), workerVersion: integer(v.workerVersion), settingsVersion: integer(v.settingsVersion),
    timeZone, ...range, rules: rules(v.rules) };
  if (v.action === "approve") {
    if (v.approvedRevision !== null || range.startsOn <= attendanceLocalDate(recordedAt.slice(0, 23) + "Z", timeZone)) fail();
    return { ...base, action: "approve", approvedRevision: null };
  }
  if (v.action !== "withdraw") return fail();
  const approvedRevision = integer(v.approvedRevision); if (approvedRevision >= revision) fail();
  return { ...base, action: "withdraw", approvedRevision };
}
function worker(raw: unknown): PersonalRulesWorker {
  const v = exact(raw, ["workerId", "workerName", "workerNo", "employeeId", "employeeAuthUserId", "version", "active", "employeeActive"]);
  const employeeId = optionalUuid(v.employeeId), employeeAuthUserId = optionalUuid(v.employeeAuthUserId), employeeActive = bool(v.employeeActive);
  if (employeeId === null && (employeeAuthUserId !== null || employeeActive)) fail();
  return { workerId: uuid(v.workerId), workerName: label(v.workerName, 120), workerNo: label(v.workerNo, 40), employeeId, employeeAuthUserId,
    version: integer(v.version), active: bool(v.active), employeeActive };
}
const sameItem = (a: PersonalRulesItem, b: PersonalRulesItem) => JSON.stringify(a) === JSON.stringify(b);
const sameSnapshot = (a: PersonalRulesItem, b: PersonalRulesItem) => snapshotKeys.every(key => JSON.stringify(a[key]) === JSON.stringify(b[key]));
function receipt(raw: unknown): PersonalRulesReceipt | null {
  if (raw === null) return null;
  const r = exact(raw, ["operationId", "revision", "command", "item"]), operationId = uuid(r.operationId), revision = integer(r.revision);
  const command = parsePersonalRulesCommand(r.command), item = parsePersonalRulesItem(r.item);
  if (command.operationId !== operationId || item.operationId !== operationId || item.revision !== revision || command.expectedRevision + 1 !== revision
    || command.action !== item.action || command.reason !== item.reason) fail();
  if (command.action === "approve") {
    if (command.expectedWorkerVersion !== item.workerVersion || command.expectedSettingsVersion !== item.settingsVersion
      || command.employeeId !== item.employeeId || command.employeeAuthUserId !== item.employeeAuthUserId || command.timeZone !== item.timeZone
      || command.startsOn !== item.startsOn || command.endsOn !== item.endsOn || JSON.stringify(command.rules) !== JSON.stringify(item.rules)) fail();
  } else if (command.approvedRevision !== item.approvedRevision) fail();
  return { operationId, revision, command, item };
}

const resultKeys = ["protocol", "siteId", "actorId", "worker", "settingsVersion", "timeZone", "revision", "items", "nextBeforeRevision", "receipt", "readAt"];
export function parsePersonalRulesResult(raw: unknown, input: PersonalRulesQuery, command: PersonalRulesCommand | null = null, expectedActorId?: string): PersonalRulesResult {
  const q = parsePersonalRulesQuery(input), v = exact(raw, resultKeys);
  if (command !== null) parsePersonalRulesBody({ query: q, command });
  const siteId = attendanceSelfSite(v.siteId), actorId = uuid(v.actorId), currentWorker = worker(v.worker), settingsVersion = integer(v.settingsVersion);
  const revision = integer(v.revision, 0), timeZone = zone(v.timeZone), readAt = recordAt(v.readAt);
  if (v.protocol !== "personal-rules-v1" || siteId !== q.siteId || currentWorker.workerId !== q.workerId
    || expectedActorId !== undefined && actorId !== uuid(expectedActorId)
    || revision > 0 && (currentWorker.employeeId === null || currentWorker.employeeAuthUserId === null)) fail();
  const available = Math.min(revision, q.beforeRevision === null ? revision : q.beforeRevision - 1), rawItems = array(v.items, 25);
  if (rawItems.length !== Math.min(available, 25)) fail();
  const operations = new Set<string>();
  const bind = (item: PersonalRulesItem) => {
    if (item.employeeId !== currentWorker.employeeId || item.employeeAuthUserId !== currentWorker.employeeAuthUserId
      || item.workerVersion > currentWorker.version || item.settingsVersion > settingsVersion || item.recordedAt > readAt) fail();
  };
  const items = rawItems.map((rawItem, index) => {
    const row = exact(rawItem, [...itemKeys, "withdrawnByRevision"]), { withdrawnByRevision: rawWithdrawal, ...core } = row;
    const item = parsePersonalRulesItem(core), withdrawnByRevision = optionalRevision(rawWithdrawal); bind(item);
    if (item.revision !== available - index || operations.has(item.operationId)
      || withdrawnByRevision !== null && (item.action !== "approve" || withdrawnByRevision <= item.revision || withdrawnByRevision > revision)) fail();
    operations.add(item.operationId); return { ...item, withdrawnByRevision };
  });
  for (let n = 1; n < items.length; n++) if (items[n].recordedAt > items[n - 1].recordedAt) fail();
  const nextBeforeRevision = optionalRevision(v.nextBeforeRevision);
  if (nextBeforeRevision !== (available > 25 ? items.at(-1)!.revision : null)) fail();
  const parsedReceipt = receipt(v.receipt), requestedOperation = command?.operationId ?? q.operationId;
  if (parsedReceipt) {
    bind(parsedReceipt.item);
    if (parsedReceipt.operationId !== requestedOperation || parsedReceipt.revision > revision || parsedReceipt.item.actorId !== actorId
      || command !== null && !samePersonalRulesCommand(command, parsedReceipt.command)) fail();
    const matching = items.find(item => item.revision === parsedReceipt.revision);
    if (matching) {
      const { withdrawnByRevision: ignored, ...core } = matching; void ignored;
      if (!sameItem(core, parsedReceipt.item)) fail();
    }
    if (items.some(item => item.operationId === parsedReceipt.operationId && item.revision !== parsedReceipt.revision)) fail();
  } else if (command !== null || requestedOperation !== null && items.some(item => item.operationId === requestedOperation)) fail();

  const known = new Map<number, PersonalRulesItem>(items.map(({ withdrawnByRevision: ignored, ...item }) => { void ignored; return [item.revision, item]; }));
  if (parsedReceipt) known.set(parsedReceipt.revision, parsedReceipt.item);
  const withdrawals = new Map<number, PersonalRulesItem>();
  for (const item of known.values()) if (item.action === "withdraw") {
    const prior = withdrawals.get(item.approvedRevision); if (prior && prior.revision !== item.revision) fail();
    withdrawals.set(item.approvedRevision, item);
    const approved = known.get(item.approvedRevision);
    if (approved && (approved.action !== "approve" || !sameSnapshot(approved, item) || approved.recordedAt > item.recordedAt)) fail();
    const visible = items.find(row => row.revision === item.approvedRevision);
    if (visible && visible.withdrawnByRevision !== item.revision) fail();
  }
  for (const item of items) if (item.withdrawnByRevision !== null) {
    const withdrawal = known.get(item.withdrawnByRevision);
    if (withdrawal && (withdrawal.action !== "withdraw" || withdrawal.approvedRevision !== item.revision || !sameSnapshot(item, withdrawal))) fail();
  }
  const currentApprovals = items.filter(item => item.action === "approve" && item.withdrawnByRevision === null).sort((a, b) => a.fromAt < b.fromAt ? -1 : a.fromAt > b.fromAt ? 1 : 0);
  for (let n = 1; n < currentApprovals.length; n++) if (currentApprovals[n].fromAt < currentApprovals[n - 1].toAt) fail();
  return { protocol: "personal-rules-v1", siteId, actorId, worker: currentWorker, settingsVersion, timeZone, revision, items, nextBeforeRevision, receipt: parsedReceipt, readAt };
}
export function parsePersonalRulesResponse(raw: unknown, query: PersonalRulesQuery, command: PersonalRulesCommand | null = null, expectedActorId?: string): PersonalRulesResponse {
  const v = exact(raw, [...resultKeys, "ok", "moduleEnabled"]), { ok, moduleEnabled, ...body } = v;
  if (ok !== true) fail();
  return { ...parsePersonalRulesResult(body, query, command, expectedActorId), ok: true, moduleEnabled: bool(moduleEnabled) };
}
