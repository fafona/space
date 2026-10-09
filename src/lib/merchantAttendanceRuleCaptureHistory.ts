// Metadata-only discovery of current-owner/current-dual-identity captures.
// A timestamp cutoff is not a historical snapshot or proof of rule application.
import type { RuleCapturesCommand } from "./merchantAttendanceRuleCaptures";
import { captureBrowserExact, captureBrowserUuid, parseCaptureBrowserCommand } from "./merchantAttendanceRuleCapturesBrowser";
import { MerchantAttendanceError } from "./merchantAttendanceTime";

export type RuleCaptureHistoryCursor = { asOf: string; beforeAt: string; beforeId: string; expectedEmployeeId: string; expectedEmployeeAuthUserId: string };
export type RuleCaptureHistoryQuery = { siteId: string; workerId: string; asOf: string | null; beforeAt: string | null; beforeId: string | null;
  expectedEmployeeId: string | null; expectedEmployeeAuthUserId: string | null };
export type RuleCaptureHistoryItem = { operationId: string; sourceId: string; actorId: string; command: RuleCapturesCommand; observedAt: string;
  recordedAt: string; sourceReadAt: string; sourceSha256: string; sourceBytes: number; applied: false; historicalApplicationProven: false };
export type RuleCaptureHistoryResult = { protocol: "rule-capture-history-v1"; readOnly: true; siteId: string; actorId: string; workerId: string;
  employeeId: string; employeeAuthUserId: string; workerName: string; workerNo: string; workerActive: boolean; employeeActive: boolean;
  asOf: string; readAt: string; items: RuleCaptureHistoryItem[]; nextCursor: RuleCaptureHistoryCursor | null };
export type RuleCaptureHistoryResponse = RuleCaptureHistoryResult & { moduleEnabled: boolean };
export const RULE_CAPTURE_HISTORY_ERRORS: Readonly<Record<string, number>> = Object.freeze({
  attendance_invalid_request: 400, attendance_access_denied: 403, attendance_not_available: 404, attendance_worker_not_found: 404,
  attendance_settings_required: 409, attendance_unavailable: 503, attendance_rate_limited: 429,
  attendance_rule_capture_identity_changed: 409, attendance_rule_capture_history_invalid: 503, attendance_rule_capture_history_too_large: 422,
});
const cursorKeys = ["asOf", "beforeAt", "beforeId", "expectedEmployeeId", "expectedEmployeeAuthUserId"];
const queryKeys = ["siteId", "workerId", ...cursorKeys];
const resultKeys = ["protocol", "readOnly", "siteId", "actorId", "workerId", "employeeId", "employeeAuthUserId", "workerName", "workerNo", "workerActive", "employeeActive", "asOf", "readAt", "items", "nextCursor"];
const itemKeys = ["operationId", "sourceId", "actorId", "command", "observedAt", "recordedAt", "sourceReadAt", "sourceSha256", "sourceBytes", "applied", "historicalApplicationProven"];
const fail = (code = "attendance_rule_capture_history_invalid"): never => { throw new MerchantAttendanceError(code); };
const exact = captureBrowserExact, uuid = captureBrowserUuid;
const site = (v: unknown): string => typeof v === "string" && /^\d{8}$/.test(v) ? v : fail();
function stamp(v: unknown): string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(v) || v.startsWith("0000-")) return fail();
  const milliseconds = v.slice(0, 23) + "Z", parsed = Date.parse(milliseconds);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== milliseconds) fail(); return v;
}
function wellFormed(v: string) {
  for (let i = 0; i < v.length; i++) {
    const unit = v.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) { const next = v.charCodeAt(++i); if (!(next >= 0xdc00 && next <= 0xdfff)) fail(); }
    else if (unit >= 0xdc00 && unit <= 0xdfff) fail();
  }
}
function label(v: unknown, max: number): string {
  if (typeof v !== "string" || !v || v !== v.trim() || [...v].length > max || /[\u0000-\u001f\u007f-\u009f]/.test(v)) return fail();
  wellFormed(v); return v;
}
function plainTree(value: unknown, byteLimit: number) {
  let nodes = 0; const seen = new Set<object>();
  const visit = (v: unknown, depth: number) => {
    if (++nodes > 10000 || depth > 12) fail("attendance_rule_capture_history_too_large");
    if (v === null || typeof v === "boolean") return;
    if (typeof v === "string") { if (v.length > byteLimit) fail("attendance_rule_capture_history_too_large"); wellFormed(v); return; }
    if (typeof v === "number") { if (!Number.isFinite(v) || Object.is(v, -0)) fail(); return; }
    if (!v || typeof v !== "object" || seen.has(v)) return fail();
    seen.add(v); const proto = Object.getPrototypeOf(v), keys = Reflect.ownKeys(v), descriptors = Object.getOwnPropertyDescriptors(v);
    if (Array.isArray(v)) {
      if (proto !== Array.prototype || v.length > 25 || keys.length !== v.length + 1) fail();
      for (let i = 0; i < v.length; i++) { const d = descriptors[String(i)]; if (!d || !("value" in d) || !d.enumerable) fail(); visit(d.value, depth + 1); }
    } else {
      if (proto !== Object.prototype && proto !== null) fail();
      for (const key of keys) {
        if (typeof key !== "string" || ["__proto__", "constructor", "prototype"].includes(key)) return fail();
        const d = descriptors[key]; if (!("value" in d) || !d.enumerable) fail(); visit(d.value, depth + 1);
      }
    }
    seen.delete(v);
  };
  visit(value, 0);
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > byteLimit) fail("attendance_rule_capture_history_too_large");
}
function parseCursor(raw: unknown): RuleCaptureHistoryCursor {
  const c = exact(raw, cursorKeys), asOf = stamp(c.asOf), beforeAt = stamp(c.beforeAt);
  if (beforeAt > asOf) fail();
  return { asOf, beforeAt, beforeId: uuid(c.beforeId), expectedEmployeeId: uuid(c.expectedEmployeeId), expectedEmployeeAuthUserId: uuid(c.expectedEmployeeAuthUserId) };
}
export function parseRuleCaptureHistoryQuery(raw: unknown): RuleCaptureHistoryQuery {
  try {
    const q = exact(raw, queryKeys), siteId = site(q.siteId), workerId = uuid(q.workerId), empty = cursorKeys.every(key => q[key] === null);
    if (empty) return { siteId, workerId, asOf: null, beforeAt: null, beforeId: null, expectedEmployeeId: null, expectedEmployeeAuthUserId: null };
    if (cursorKeys.some(key => q[key] === null)) fail();
    return { siteId, workerId, ...parseCursor(Object.fromEntries(cursorKeys.map(key => [key, q[key]]))) };
  } catch { return fail("attendance_invalid_request"); }
}
export function parseRuleCaptureHistoryHttpQuery(url: string): RuleCaptureHistoryQuery {
  try {
    const params = new URL(url).searchParams, query: Record<string, unknown> = { asOf: null, beforeAt: null, beforeId: null, expectedEmployeeId: null, expectedEmployeeAuthUserId: null };
    for (const [key, value] of params) { if (!queryKeys.includes(key) || params.getAll(key).length !== 1) fail(); query[key] = value; }
    return parseRuleCaptureHistoryQuery(query);
  } catch { return fail("attendance_invalid_request"); }
}
export const ruleCaptureHistoryQueryString = (query: RuleCaptureHistoryQuery) => new URLSearchParams(Object.entries(parseRuleCaptureHistoryQuery(query)).filter((entry): entry is [string, string] => entry[1] !== null)).toString();
const before = (at: string, id: string, previousAt: string, previousId: string) => at < previousAt || at === previousAt && id < previousId;
export function parseRuleCaptureHistoryResult(raw: unknown, input: RuleCaptureHistoryQuery, expectedActorId: string): RuleCaptureHistoryResult {
  const query = parseRuleCaptureHistoryQuery(input);
  try {
    plainTree(raw, 65536); const v = exact(raw, resultKeys), actorId = uuid(v.actorId), employeeId = uuid(v.employeeId), employeeAuthUserId = uuid(v.employeeAuthUserId);
    const asOf = stamp(v.asOf), readAt = stamp(v.readAt);
    if (v.protocol !== "rule-capture-history-v1" || v.readOnly !== true || v.siteId !== query.siteId || v.workerId !== query.workerId || actorId !== uuid(expectedActorId)
      || typeof v.workerActive !== "boolean" || typeof v.employeeActive !== "boolean" || asOf > readAt
      || query.asOf !== null && (asOf !== query.asOf || employeeId !== query.expectedEmployeeId || employeeAuthUserId !== query.expectedEmployeeAuthUserId)
      || !Array.isArray(v.items) || v.items.length > 25) return fail();
    const workerName = label(v.workerName, 120), workerNo = label(v.workerNo, 40), ids = new Set<string>();
    const artifacts = new Map<string, string>(); let previousAt = query.beforeAt, previousId = query.beforeId;
    const items: RuleCaptureHistoryItem[] = v.items.map(rawItem => {
      const i = exact(rawItem, itemKeys), operationId = uuid(i.operationId), sourceId = uuid(i.sourceId), command = parseCaptureBrowserCommand(i.command);
      const sourceReadAt = stamp(i.sourceReadAt), observedAt = stamp(i.observedAt), recordedAt = stamp(i.recordedAt);
      if (i.actorId !== actorId || command.operationId !== operationId || command.employeeId !== employeeId || command.employeeAuthUserId !== employeeAuthUserId
        || i.applied !== false || i.historicalApplicationProven !== false || sourceReadAt > observedAt || observedAt > recordedAt || recordedAt > asOf
        || typeof i.sourceSha256 !== "string" || !/^[0-9a-f]{64}$/.test(i.sourceSha256)
        || typeof i.sourceBytes !== "number" || !Number.isSafeInteger(i.sourceBytes) || i.sourceBytes < 1 || i.sourceBytes > 1048576
        || ids.has(operationId) || previousAt !== null && previousId !== null && !before(recordedAt, operationId, previousAt, previousId)) return fail();
      const binding = JSON.stringify([sourceReadAt, i.sourceSha256, i.sourceBytes, command.fromDate, command.throughDate]);
      if (artifacts.has(sourceId) && artifacts.get(sourceId) !== binding) fail(); artifacts.set(sourceId, binding);
      ids.add(operationId); previousAt = recordedAt; previousId = operationId;
      return { operationId, sourceId, actorId, command, sourceReadAt, observedAt, recordedAt, sourceSha256: i.sourceSha256,
        sourceBytes: i.sourceBytes, applied: false, historicalApplicationProven: false };
    });
    const nextCursor = v.nextCursor === null ? null : parseCursor(v.nextCursor);
    if (nextCursor && (items.length !== 25 || nextCursor.asOf !== asOf || nextCursor.beforeAt !== items.at(-1)!.recordedAt
      || nextCursor.beforeId !== items.at(-1)!.operationId || nextCursor.expectedEmployeeId !== employeeId || nextCursor.expectedEmployeeAuthUserId !== employeeAuthUserId)) fail();
    return { protocol: "rule-capture-history-v1", readOnly: true, siteId: query.siteId, actorId, workerId: query.workerId, employeeId, employeeAuthUserId,
      workerName, workerNo, workerActive: v.workerActive, employeeActive: v.employeeActive, asOf, readAt, items, nextCursor };
  } catch (error) {
    if (error instanceof MerchantAttendanceError && error.code === "attendance_rule_capture_history_too_large") throw error;
    return fail();
  }
}
export function parseRuleCaptureHistoryResponse(raw: unknown, query: RuleCaptureHistoryQuery, expectedActorId: string): RuleCaptureHistoryResponse {
  try {
    plainTree(raw, 66560); const v = exact(raw, ["ok", "moduleEnabled", "data"]);
    if (v.ok !== true || typeof v.moduleEnabled !== "boolean") return fail();
    return { ...parseRuleCaptureHistoryResult(v.data, query, expectedActorId), moduleEnabled: v.moduleEnabled };
  } catch (error) {
    if (error instanceof MerchantAttendanceError && ["attendance_invalid_request", "attendance_rule_capture_history_too_large"].includes(error.code)) throw error;
    return fail();
  }
}
