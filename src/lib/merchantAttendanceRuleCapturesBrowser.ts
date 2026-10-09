// Browser-only capture receipt verification. Never import the node:crypto
// archival parser at runtime, retain its full source, or replay today's tzdata.
import type { RuleCapturesCommand, RuleCapturesQuery, RuleCapturesReceipt, RuleCapturesResult } from "./merchantAttendanceRuleCaptures";

export type RuleCaptureSummary = { workerName: string; workerNo: string; timeZone: string; fromDate: string; throughDate: string;
  fromAt: string; toAt: string; assignmentCount: number; ruleStreamCount: number; publicationCount: number;
  personalApprovalCount: number; personalWithdrawalCount: number };
export type CompactRuleCaptureReceipt = Omit<RuleCapturesReceipt, "sourceText"> & { summary: RuleCaptureSummary };
export type CompactRuleCaptureResponse = Omit<RuleCapturesResult, "receipt"> & { moduleEnabled: boolean; receipt: CompactRuleCaptureReceipt | null };
export const CAPTURE_BROWSER_ERRORS: Readonly<Record<string, number>> = Object.freeze({
  attendance_invalid_request: 400, attendance_access_denied: 403, attendance_not_available: 404, attendance_worker_not_found: 404,
  attendance_settings_required: 409, attendance_platform_paused: 403, attendance_version_conflict: 409, attendance_operation_conflict: 409,
  attendance_unavailable: 503, attendance_rate_limited: 429, attendance_body_too_large: 413, attendance_invalid_content_type: 415,
  attendance_rule_capture_invalid: 503, attendance_rule_capture_identity_changed: 409, attendance_rule_capture_incomplete: 409,
  attendance_rule_capture_limit: 409, attendance_rule_capture_worker_inactive: 409, attendance_rule_sources_invalid: 503,
  attendance_rule_sources_too_large: 422, attendance_group_invalid: 503, attendance_rule_invalid: 503,
  attendance_personal_rule_invalid: 503, attendance_personal_rule_identity_changed: 409,
});
type RecordValue = Record<string, unknown>;
const fail = (): never => { throw Error("invalid_capture_response"); };
export function captureBrowserExact(raw: unknown, keys: readonly string[]): RecordValue {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fail();
  const prototype = Object.getPrototypeOf(raw), descriptors = Object.getOwnPropertyDescriptors(raw);
  if (prototype !== Object.prototype && prototype !== null || Reflect.ownKeys(raw).length !== keys.length
    || keys.some(key => !Object.hasOwn(descriptors, key) || !("value" in descriptors[key]) || !descriptors[key].enumerable)) fail();
  return raw as RecordValue;
}
export const captureBrowserUuid = (v: unknown): string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v) ? v : fail();
const site = (v: unknown): string => typeof v === "string" && /^\d{8}$/.test(v) ? v : fail();
const integer = (v: unknown, min = 1, max = 9007199254740990): number => typeof v === "number" && Number.isSafeInteger(v) && !Object.is(v, -0) && v >= min && v <= max ? v : fail();
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
function instant(v: unknown, digits: 3 | 6): string {
  if (typeof v !== "string" || !(digits === 3 ? /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/ : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/).test(v)) return fail();
  const msText = v.slice(0, 23) + "Z", ms = Date.parse(msText);
  if (!Number.isFinite(ms) || new Date(ms).toISOString() !== msText) fail(); return v;
}
function date(v: unknown): string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v) || v < "2000-01-01" || v > "2100-12-31") return fail();
  instant(v + "T00:00:00.000Z", 3); return v;
}
export function parseCaptureBrowserQuery(raw: unknown): RuleCapturesQuery {
  const v = captureBrowserExact(raw, ["siteId", "workerId", "operationId"]);
  return { siteId: site(v.siteId), workerId: captureBrowserUuid(v.workerId), operationId: captureBrowserUuid(v.operationId) };
}
export function parseCaptureBrowserCommand(raw: unknown): RuleCapturesCommand {
  const v = captureBrowserExact(raw, ["operationId", "fromDate", "throughDate", "reason", "employeeId", "employeeAuthUserId"]);
  const fromDate = date(v.fromDate), throughDate = date(v.throughDate), days = (Date.parse(throughDate) - Date.parse(fromDate)) / 86400000 + 1;
  if (!Number.isInteger(days) || days < 1 || days > 7) fail();
  return { operationId: captureBrowserUuid(v.operationId), fromDate, throughDate, reason: label(v.reason, 200),
    employeeId: captureBrowserUuid(v.employeeId), employeeAuthUserId: captureBrowserUuid(v.employeeAuthUserId) };
}
export function sameCaptureBrowserCommand(a: RuleCapturesCommand, b: RuleCapturesCommand) {
  return JSON.stringify(parseCaptureBrowserCommand(a)) === JSON.stringify(parseCaptureBrowserCommand(b));
}
function tree(value: unknown) {
  let nodes = 0; const seen = new Set<object>();
  const visit = (v: unknown, depth: number) => {
    if (++nodes > 100000 || depth > 24) fail();
    if (v === null || typeof v === "boolean") return;
    if (typeof v === "string") { if (v.length > 1048576) fail(); wellFormed(v); return; }
    if (typeof v === "number") { if (!Number.isFinite(v) || Object.is(v, -0)) fail(); return; }
    if (!v || typeof v !== "object" || seen.has(v)) return fail();
    seen.add(v); const descriptors = Object.getOwnPropertyDescriptors(v), keys = Reflect.ownKeys(v), proto = Object.getPrototypeOf(v);
    if (Array.isArray(v)) {
      if (proto !== Array.prototype || v.length > 4000 || keys.length !== v.length + 1) fail();
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
}
export function parseCaptureBrowserJson(text: string): unknown {
  const parsed: unknown = JSON.parse(text), stack: Array<Set<string> | null> = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "{") stack.push(new Set()); else if (text[i] === "[") stack.push(null);
    else if (text[i] === "}" || text[i] === "]") stack.pop();
    else if (text[i] === '"') {
      const start = i++; while (i < text.length && text[i] !== '"') { if (text[i] === "\\") i++; i++; }
      let after = i + 1; while (after < text.length && /\s/.test(text[after])) after++;
      if (text[after] === ":") { const key: string = JSON.parse(text.slice(start, i + 1)), keys = stack.at(-1); if (!keys || keys.has(key)) return fail(); keys.add(key); }
    }
  }
  tree(parsed); return parsed;
}
function compactSummary(text: string, q: RuleCapturesQuery, command: RuleCapturesCommand, actorId: string, sourceReadAt: string): RuleCaptureSummary {
  const s = captureBrowserExact(parseCaptureBrowserJson(text), ["protocol", "siteId", "actorId", "fromDate", "throughDate", "worker", "settingsVersion", "timeZone", "fromAt", "toAt", "readAt", "assignments", "rules", "personal"]);
  const w = captureBrowserExact(s.worker, ["workerId", "workerName", "workerNo", "employeeId", "employeeAuthUserId", "version", "active", "employeeActive"]);
  if (s.protocol !== "rule-sources-v1" || s.siteId !== q.siteId || s.actorId !== actorId || w.workerId !== q.workerId
    || w.employeeId !== command.employeeId || w.employeeAuthUserId !== command.employeeAuthUserId || w.active !== true || w.employeeActive !== true
    || s.fromDate !== command.fromDate || s.throughDate !== command.throughDate || instant(s.readAt, 6) !== sourceReadAt) fail();
  integer(w.version); integer(s.settingsVersion);
  const part = (raw: unknown, personal = false) => {
    const v = captureBrowserExact(raw, personal ? ["revision", "limited", "items"] : ["limited", "items"]);
    if (personal) integer(v.revision, 0);
    if (v.limited !== false || !Array.isArray(v.items) || v.items.length > 100) return fail(); return v.items;
  };
  const assignments = part(s.assignments), streams = part(s.rules), personal = part(s.personal, true);
  if (!streams.length) fail(); let publications = 0, withdrawals = 0;
  for (const raw of assignments) captureBrowserExact(raw, ["detail", "currentGroup"]);
  for (const raw of streams) {
    const stream = captureBrowserExact(raw, ["groupId", "revision", "publications"]); integer(stream.revision, 0);
    if (stream.groupId !== null) captureBrowserUuid(stream.groupId);
    if (!Array.isArray(stream.publications) || (publications += stream.publications.length) > 100) fail();
  }
  for (const raw of personal) {
    const pair = captureBrowserExact(raw, ["approval", "withdrawal"]);
    if (!pair.approval || typeof pair.approval !== "object" || Array.isArray(pair.approval)) fail();
    if (pair.withdrawal !== null) { if (!pair.withdrawal || typeof pair.withdrawal !== "object" || Array.isArray(pair.withdrawal)) fail(); withdrawals++; }
  }
  const fromAt = instant(s.fromAt, 3), toAt = instant(s.toAt, 3); if (fromAt >= toAt) fail();
  return { workerName: label(w.workerName, 120), workerNo: label(w.workerNo, 40), timeZone: label(s.timeZone, 100),
    fromDate: command.fromDate, throughDate: command.throughDate, fromAt, toAt, assignmentCount: assignments.length,
    ruleStreamCount: streams.length, publicationCount: publications, personalApprovalCount: personal.length, personalWithdrawalCount: withdrawals };
}
export async function parseCompactRuleCaptureResponse(raw: unknown, input: RuleCapturesQuery, actor: string, expectedCommand: RuleCapturesCommand | null = null): Promise<CompactRuleCaptureResponse> {
  tree(raw); const q = parseCaptureBrowserQuery(input), actorId = captureBrowserUuid(actor), envelope = captureBrowserExact(raw, ["ok", "moduleEnabled", "data"]);
  if (envelope.ok !== true || typeof envelope.moduleEnabled !== "boolean") fail();
  const moduleEnabled = envelope.moduleEnabled as boolean;
  const v = captureBrowserExact(envelope.data, ["protocol", "siteId", "actorId", "workerId", "operationId", "receipt", "readAt"]), readAt = instant(v.readAt, 6);
  if (v.protocol !== "candidate-rule-captures-v1" || v.siteId !== q.siteId || v.actorId !== actorId || v.workerId !== q.workerId || v.operationId !== q.operationId) fail();
  const wanted = expectedCommand === null ? null : parseCaptureBrowserCommand(expectedCommand); if (wanted && wanted.operationId !== q.operationId) fail();
  let receipt: CompactRuleCaptureReceipt | null = null;
  if (v.receipt !== null) {
    const r = captureBrowserExact(v.receipt, ["operationId", "actorId", "command", "observedAt", "recordedAt", "sourceId", "sourceReadAt", "sourceText", "sourceSha256", "sourceBytes", "canonicalFormat", "applied", "historicalApplicationProven"]);
    const command = parseCaptureBrowserCommand(r.command), observedAt = instant(r.observedAt, 6), recordedAt = instant(r.recordedAt, 6), sourceReadAt = instant(r.sourceReadAt, 6), sourceId = captureBrowserUuid(r.sourceId);
    if (r.operationId !== q.operationId || r.actorId !== actorId || command.operationId !== q.operationId || wanted && !sameCaptureBrowserCommand(command, wanted)
      || sourceReadAt > observedAt || observedAt > recordedAt || recordedAt > readAt || r.canonicalFormat !== "pg-jsonb-text-utf8-v1"
      || r.applied !== false || r.historicalApplicationProven !== false || typeof r.sourceText !== "string"
      || typeof r.sourceSha256 !== "string" || !/^[0-9a-f]{64}$/.test(r.sourceSha256)) return fail();
    const sourceBytes = integer(r.sourceBytes, 1, 1048576), bytes = new TextEncoder().encode(r.sourceText);
    if (bytes.byteLength !== sourceBytes) fail();
    // Capture detached values before awaiting injected/native WebCrypto. No raw
    // record or full source survives in the returned compact display snapshot.
    const sourceSha256 = r.sourceSha256, summary = compactSummary(r.sourceText, q, command, actorId, sourceReadAt);
    const hash = await globalThis.crypto.subtle.digest("SHA-256", bytes);
    if ([...new Uint8Array(hash)].map(n => n.toString(16).padStart(2, "0")).join("") !== sourceSha256) fail();
    receipt = { operationId: q.operationId, actorId, command, observedAt, recordedAt, sourceId, sourceReadAt, sourceSha256, sourceBytes,
      canonicalFormat: "pg-jsonb-text-utf8-v1", applied: false, historicalApplicationProven: false, summary };
  } else if (wanted) fail();
  return { protocol: "candidate-rule-captures-v1", ...q, actorId, readAt, moduleEnabled, receipt };
}
