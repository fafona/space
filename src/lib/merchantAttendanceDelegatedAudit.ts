//203 RESOURCE audit only. Target Auth/generation describes current delegated
//authorization, never a reconstruction of old064/066 receipt authorship.
import { MerchantAttendanceError, attendanceTimeZone } from "./merchantAttendanceTime";
import { captureBrowserExact, parseCaptureBrowserJson } from "./merchantAttendanceRuleCapturesBrowser";
import { MANAGEMENT_DELEGATION_ACTION_CAPABILITY } from "./merchantAttendanceManagementDelegation";
import { attendanceAuditCsvCell } from "./merchantAttendanceAuditExport";
import { OPERATIONAL_RULE_KEYS } from "./merchantAttendanceOperationalRules";
import { RULE_KEYS } from "./merchantAttendanceRuleDraft";

export const DELEGATED_AUDIT_PROTOCOL = "attendance-delegated-audit-v1" as const;
export const DELEGATED_AUDIT_API = "/api/merchant-enterprise/attendance/delegated-audit";
export const DELEGATED_AUDIT_REQUEST_BYTES = 16384;
export const DELEGATED_AUDIT_PAYLOAD_BYTES = 1572864;
export const DELEGATED_AUDIT_RESULT_BYTES = 2097152;
export const DELEGATED_AUDIT_CSV_BYTES = 2097152;
export type DelegatedAuditSource = "config" | "scope" | "management";
export type DelegatedAuditQuery = Readonly<
  { siteId: string; mode: "recover"; operationId: string }
  | { siteId: string; grantId: string; mode: "detail"; source: DelegatedAuditSource; sourceOperationId: string }
  | { siteId: string; grantId: string; mode: "export"; source: DelegatedAuditSource; fromAt: string; toAt: string }
  | { siteId: string; grantId: string; mode: "list"; source: DelegatedAuditSource; fromAt: string; toAt: string; asOf: string | null; cursorAt: string | null; cursorId: string | null }
>;
export type DelegatedAuditExportQuery = Extract<DelegatedAuditQuery, { mode: "export" }>;
export type DelegatedAuditCommand = Readonly<{ action: "export"; operationId: string }>;
export type DelegatedAuditKind = "settings" | "location" | "worker" | "grant_put" | "grant_remove" | "management_grant" | "management_revoke" | "management_audit_export";
export type DelegatedAuditItem = Readonly<{ operationId: string; recordedAt: string; kind: DelegatedAuditKind; version: number; targetId: string | null; actorRef: string; byCurrentOwner: boolean; holderRef: string | null }>;
export type DelegatedAuditValue = Readonly<Record<string, string | boolean | number | readonly string[] | null>>;
export type DelegatedAuditRow = Readonly<{ item: DelegatedAuditItem; before: DelegatedAuditValue | null; after: DelegatedAuditValue | null }>;
export type DelegatedAuditReceipt = Readonly<{ operationId: string; actorId: string; grantId: string; action: "export"; commandFingerprint: string; asOf: string; count: number; resultFingerprint: string; recordedAt: string }>;
export type DelegatedAuditPayload = Readonly<{ schemaVersion: 1; fromAt: string; toAt: string; asOf: string; count: number; rows: readonly DelegatedAuditRow[] }>;
type Base = Readonly<{ protocol: typeof DELEGATED_AUDIT_PROTOCOL; siteId: string; actorId: string; readAt: string }>;
type CurrentAuthority = Readonly<{ grantId: string; source: DelegatedAuditSource; scopeKind: "audit_worker" | "audit_company";
  target: Readonly<{ workerId: string; employeeId: string; employeeAuthUserId: string; generation: number }> | null }>;
export type DelegatedAuditResult = Base & Readonly<
  { kind: "receipt"; receipt: DelegatedAuditReceipt | null }
  | (CurrentAuthority & { kind: "list"; asOf: string; items: readonly DelegatedAuditItem[]; nextCursor: Readonly<{ recordedAt: string; operationId: string }> | null })
  | (CurrentAuthority & { kind: "detail"; row: DelegatedAuditRow })
  | (CurrentAuthority & { kind: "export"; payload: DelegatedAuditPayload; receipt: DelegatedAuditReceipt })
>;
export type DelegatedAuditExport = Extract<DelegatedAuditResult, { kind: "export" }>;
export const DELEGATED_AUDIT_ERRORS: Readonly<Record<string, number>> = Object.freeze({
  attendance_invalid_request: 400, attendance_access_denied: 403, attendance_settings_required: 409,
  attendance_delegated_audit_disabled: 403, attendance_delegated_audit_invalid: 503,
  attendance_delegated_audit_too_large: 422, attendance_export_too_large: 413,
  attendance_audit_not_found: 404, attendance_operation_conflict: 409, attendance_unavailable: 503,
});
const fail = (code = "attendance_invalid_request"): never => { throw new MerchantAttendanceError(code); };
const exact = captureBrowserExact;
export const delegatedAuditUuid = (v: unknown): string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v) ? v : fail();
const site = (v: unknown): string => typeof v === "string" && /^[0-9]{8}$/.test(v) ? v : fail();
const bool = (v: unknown): boolean => typeof v === "boolean" ? v : fail();
const integer = (v: unknown, minimum = 0, maximum = 9007199254740990): number => typeof v === "number" && Number.isSafeInteger(v) && !Object.is(v, -0) && v >= minimum && v <= maximum ? v : fail();
const fingerprint = (v: unknown, size = 64): string => typeof v === "string" && new RegExp(`^[0-9a-f]{${size}}$`).test(v) ? v : fail();
const source = (v: unknown): DelegatedAuditSource => v === "config" || v === "scope" || v === "management" ? v : fail();
export const delegatedAuditStamp = (v: unknown): string => {
  if (typeof v !== "string" || !/^20\d\d-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/.test(v)) return fail();
  const ms = v.slice(0, 23) + "Z", n = Date.parse(ms); return Number.isFinite(n) && new Date(n).toISOString() === ms ? v : fail();
};
const label = (v: unknown, maximum: number): string => typeof v === "string" && v === v.trim() && [...v].length >= 1 && [...v].length <= maximum && !/[\u0000-\u001f\u007f-\u009f]/.test(v) ? v : fail();
const nullableUuid = (v: unknown) => v === null ? null : delegatedAuditUuid(v);
const freeze = <T>(value: T): T => { if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
export function assertDelegatedAuditTree(raw: unknown, maximum = DELEGATED_AUDIT_RESULT_BYTES): void {
  let nodes = 0; const seen = new Set<object>();
  const visit = (v: unknown, depth: number): void => {
    if (++nodes > 100000 || depth > 16) fail();
    if (v === null || typeof v === "boolean") return;
    if (typeof v === "number") { integer(v, -9007199254740990); return; }
    if (typeof v === "string") { if (v.length > maximum) fail(); for (let i = 0; i < v.length; i++) {
      const unit = v.charCodeAt(i); if (unit >= 0xd800 && unit <= 0xdbff) { const next = v.charCodeAt(++i); if (!(next >= 0xdc00 && next <= 0xdfff)) fail(); }
      else if (unit >= 0xdc00 && unit <= 0xdfff) fail(); } return; }
    if (!v || typeof v !== "object" || seen.has(v)) return fail(); seen.add(v);
    const descriptors = Object.getOwnPropertyDescriptors(v), keys = Reflect.ownKeys(v), prototype = Object.getPrototypeOf(v);
    if (Array.isArray(v)) { if (prototype !== Array.prototype || v.length > 250 || keys.length !== v.length + 1) fail();
      for (let i = 0; i < v.length; i++) { const d = descriptors[String(i)]; if (!d || !d.enumerable || !Object.hasOwn(d, "value")) fail(); visit(d.value, depth + 1); } }
    else { if (prototype !== Object.prototype && prototype !== null) fail(); for (const key of keys) {
      if (typeof key !== "string" || ["__proto__", "constructor", "prototype"].includes(key)) return fail();
      const d = descriptors[key]; if (!d.enumerable || !Object.hasOwn(d, "value")) fail(); visit(d.value, depth + 1); } }
    seen.delete(v);
  }; visit(raw, 0); if (new TextEncoder().encode(JSON.stringify(raw)).byteLength > maximum) fail();
}
export function parseDelegatedAuditJson(text: string, maximum = DELEGATED_AUDIT_REQUEST_BYTES): unknown {
  try { if (typeof text !== "string" || new TextEncoder().encode(text).byteLength > maximum) fail();
    const raw = parseCaptureBrowserJson(text); assertDelegatedAuditTree(raw, maximum); return raw;
  } catch { return fail(); }
}
function window(from: unknown, to: unknown) {
  const fromAt = delegatedAuditStamp(from), toAt = delegatedAuditStamp(to);
  const micros = (s: string) => BigInt(Date.parse(s.slice(0, 23) + "Z")) * BigInt(1000) + BigInt(s.slice(23, 26));
  if (fromAt >= toAt || micros(toAt) - micros(fromAt) > BigInt("2678400000000")) fail(); return { fromAt, toAt };
}
export function parseDelegatedAuditQuery(raw: unknown): DelegatedAuditQuery {
  try { assertDelegatedAuditTree(raw, 4096); const mode = Object.getOwnPropertyDescriptor(raw, "mode")?.value;
    if (mode === "recover") { const q = exact(raw, ["siteId", "mode", "operationId"]); return freeze({ siteId: site(q.siteId), mode, operationId: delegatedAuditUuid(q.operationId) }); }
    if (mode === "detail") { const q = exact(raw, ["siteId", "grantId", "mode", "source", "sourceOperationId"]);
      return freeze({ siteId: site(q.siteId), grantId: delegatedAuditUuid(q.grantId), mode, source: source(q.source), sourceOperationId: delegatedAuditUuid(q.sourceOperationId) }); }
    if (mode !== "list" && mode !== "export") return fail();
    const q = exact(raw, ["siteId", "grantId", "mode", "source", "fromAt", "toAt", ...(mode === "list" ? ["asOf", "cursorAt", "cursorId"] : [])]);
    const base = { siteId: site(q.siteId), grantId: delegatedAuditUuid(q.grantId), source: source(q.source), ...window(q.fromAt, q.toAt) };
    if (mode === "export") return freeze({ ...base, mode });
    const asOf = q.asOf === null ? null : delegatedAuditStamp(q.asOf), cursorAt = q.cursorAt === null ? null : delegatedAuditStamp(q.cursorAt), cursorId = nullableUuid(q.cursorId);
    if ((cursorAt === null) !== (cursorId === null) || cursorId && (asOf === null || cursorAt! < base.fromAt || cursorAt! >= base.toAt || cursorAt! >= asOf)) fail();
    return freeze({ ...base, mode, asOf, cursorAt, cursorId });
  } catch { return fail(); }
}
export function delegatedAuditQueryString(raw: DelegatedAuditQuery): string {
  const q = parseDelegatedAuditQuery(raw), params = new URLSearchParams(); for (const [k, v] of Object.entries(q)) params.set(k, v === null ? "" : String(v)); return params.toString();
}
export function parseDelegatedAuditHttpQuery(input: string | URL): DelegatedAuditQuery {
  try { const url = new URL(input), entries = [...url.searchParams];
    if (url.hash || String(input).includes("#") || entries.some(([k], i) => entries.findIndex(([other]) => k === other) !== i)) fail();
    const raw: Record<string, unknown> = Object.fromEntries(entries); for (const k of ["asOf", "cursorAt", "cursorId"]) if (Object.hasOwn(raw, k) && raw[k] === "") raw[k] = null;
    const q = parseDelegatedAuditQuery(raw); if (q.mode === "export") fail(); return q;
  } catch { return fail(); }
}
export function parseDelegatedAuditCommand(raw: unknown): DelegatedAuditCommand {
  try { assertDelegatedAuditTree(raw, 256); const c = exact(raw, ["action", "operationId"]); if (c.action !== "export") return fail(); return freeze({ action: "export" as const, operationId: delegatedAuditUuid(c.operationId) }); } catch { return fail(); }
}
export function parseDelegatedAuditBody(raw: unknown): Readonly<{ query: DelegatedAuditExportQuery; command: DelegatedAuditCommand }> {
  try { assertDelegatedAuditTree(raw, DELEGATED_AUDIT_REQUEST_BYTES); const b = exact(raw, ["query", "command"]), query = parseDelegatedAuditQuery(b.query);
    if (query.mode !== "export") return fail(); return freeze({ query, command: parseDelegatedAuditCommand(b.command) }); } catch { return fail(); }
}
export function delegatedAuditFingerprintText(query: DelegatedAuditExportQuery, actorId: string, command: DelegatedAuditCommand): string {
  const { query: q, command: c } = parseDelegatedAuditBody({ query, command });
  return `[${["attendance-delegated-audit-command-v1", q.siteId, delegatedAuditUuid(actorId), q.grantId, q.source, q.fromAt, q.toAt, c.action, c.operationId].map(v => JSON.stringify(v)).join(", ")}]`;
}
export async function delegatedAuditCommandFingerprint(q: DelegatedAuditExportQuery, a: string, c: DelegatedAuditCommand): Promise<string> {
  const bytes = new TextEncoder().encode(delegatedAuditFingerprintText(q, a, c)), digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), v => v.toString(16).padStart(2, "0")).join("");
}
function ids(raw: unknown, maximum: number, minimum = 1): readonly string[] {
  if (!Array.isArray(raw) || raw.length < minimum || raw.length > maximum) return fail(); let last: string | null = null;
  return raw.map(v => { const id = delegatedAuditUuid(v); if (last !== null && id <= last) fail(); last = id; return id; });
}
function parseItem(raw: unknown, selected: DelegatedAuditSource, readAt: string): DelegatedAuditItem {
  const v = exact(raw, ["operationId", "recordedAt", "kind", "version", "targetId", "actorRef", "byCurrentOwner", "holderRef"]);
  const kinds = selected === "config" ? ["settings", "location", "worker"] : selected === "scope" ? ["grant_put", "grant_remove"] : ["management_grant", "management_revoke", "management_audit_export"];
  if (typeof v.kind !== "string" || !kinds.includes(v.kind)) return fail(); const kind = v.kind as DelegatedAuditKind;
  const targetId = nullableUuid(v.targetId), recordedAt = delegatedAuditStamp(v.recordedAt), version = integer(v.version, 1);
  if ((kind === "settings") !== (targetId === null) || recordedAt > readAt || (selected === "scope") !== (v.holderRef !== null)
    || selected === "management" && version !== (kind === "management_revoke" ? 2 : 1)) fail();
  return { operationId: delegatedAuditUuid(v.operationId), recordedAt, kind, version, targetId, actorRef: fingerprint(v.actorRef, 32), byCurrentOwner: bool(v.byCurrentOwner), holderRef: v.holderRef === null ? null : fingerprint(v.holderRef, 32) };
}
function snapshot(raw: unknown, item: DelegatedAuditItem, before: boolean): DelegatedAuditValue | null {
  if (raw === null) return null; const kind = item.kind;
  if (kind === "management_audit_export") {
    if (before) return fail(); const v = exact(raw, ["grantId", "source", "fromAt", "toAt", "asOf", "count", "resultFingerprint"]), range = window(v.fromAt, v.toAt), asOf = delegatedAuditStamp(v.asOf);
    if (v.grantId !== item.targetId || asOf > item.recordedAt) fail(); return { grantId: delegatedAuditUuid(v.grantId), source: source(v.source), ...range, asOf, count: integer(v.count, 0, 250), resultFingerprint: fingerprint(v.resultFingerprint) };
  }
  if (kind === "management_grant" || kind === "management_revoke") {
    const keys = ["grantId", "delegateRef", "delegatedAction", "scopeKind", "workerId", "employeeId", "locationIds", "allowedRuleKeys", "validFrom", "validUntil", "reason", "status"];
    const v = exact(raw, [...keys, ...(kind === "management_revoke" && !before ? ["revocationReason"] : [])]);
    const validFrom = delegatedAuditStamp(v.validFrom), validUntil = delegatedAuditStamp(v.validUntil);
    const allowedKinds = ["worker", "group", "group_worker", "location", "rules", "terminal", "member_pin", "independent_pin", "revision", "formal_exception", "audit_worker", "audit_company"];
    if (v.grantId !== item.targetId || typeof v.delegatedAction !== "string" || !Object.hasOwn(MANAGEMENT_DELEGATION_ACTION_CAPABILITY, v.delegatedAction)
      || typeof v.scopeKind !== "string" || !allowedKinds.includes(v.scopeKind) || validFrom >= validUntil || v.status !== (kind === "management_revoke" && !before ? "revoked" : "granted")) fail();
    if (!Array.isArray(v.allowedRuleKeys) || v.allowedRuleKeys.length > 8) return fail(); const allowedRuleKeys: string[] = [];
    const knownKeys: readonly string[] = [...OPERATIONAL_RULE_KEYS, ...RULE_KEYS];
    for (const key of v.allowedRuleKeys) { if (typeof key !== "string" || !knownKeys.includes(key) || allowedRuleKeys.length && key <= allowedRuleKeys.at(-1)!) fail(); allowedRuleKeys.push(key); }
    if ((v.scopeKind === "rules") !== (allowedRuleKeys.length > 0)) fail();
    return { grantId: delegatedAuditUuid(v.grantId), delegateRef: fingerprint(v.delegateRef, 32), delegatedAction: v.delegatedAction as string, scopeKind: v.scopeKind as string,
      workerId: nullableUuid(v.workerId), employeeId: nullableUuid(v.employeeId), locationIds: ids(v.locationIds, 25, 0), allowedRuleKeys,
      validFrom, validUntil, reason: label(v.reason, 200), status: v.status as string, ...(kind === "management_revoke" && !before ? { revocationReason: label(v.revocationReason, 200) } : {}) };
  }
  const keys = kind === "settings" ? ["timeZone", "enabled", "webClockEnabled", "webBreakPaid"] : kind === "location" ? ["id", "name", "active", "timeZone"]
    : kind === "worker" ? ["id", "employeeId", "workerNo", "displayName", "locationId", "active", "startsOn"] : ["id", "workerIds", "locationIds", "validFrom", "validUntil"];
  const v = exact(raw, keys), out: Record<string, string | boolean | readonly string[] | null> = {};
  for (const key of keys) { const value = v[key];
    if (["enabled", "webClockEnabled", "webBreakPaid", "active"].includes(key)) out[key] = bool(value);
    else if (["id", "employeeId", "locationId"].includes(key)) out[key] = before && key !== "id" && value === null ? null : delegatedAuditUuid(value);
    else if (key === "workerIds" || key === "locationIds") out[key] = ids(value, key === "workerIds" ? 200 : 50);
    else if (key === "validFrom" || key === "validUntil") out[key] = key === "validUntil" && value === null ? null : delegatedAuditStamp(value);
    else if (key === "timeZone") out[key] = attendanceTimeZone(label(value, 120));
    else if (key === "startsOn") { if (before && value === null) out[key] = null;
      else { if (typeof value !== "string" || !/^20\d\d-\d\d-\d\d$/.test(value) || value < "2000-01-01" || value > "2100-12-31"
        || new Date(value + "T00:00:00Z").toISOString().slice(0, 10) !== value) return fail(); out[key] = value; } }
    else out[key] = label(value, key === "workerNo" ? 40 : 120);
  }
  if (kind !== "settings" && out.id !== item.targetId || typeof out.validFrom === "string" && typeof out.validUntil === "string" && out.validFrom >= out.validUntil) fail();
  return out;
}
function row(raw: unknown, selected: DelegatedAuditSource, readAt: string, target: CurrentAuthority["target"]): DelegatedAuditRow {
  const v = exact(raw, ["item", "before", "after"]), item = parseItem(v.item, selected, readAt), before = snapshot(v.before, item, true), after = snapshot(v.after, item, false);
  if (item.kind === "grant_remove" ? before === null || after !== null : after === null
    || ["management_grant", "management_audit_export"].includes(item.kind) && before !== null || item.kind === "management_revoke" && before === null) fail();
  if (target) { for (const value of [before, after]) { if (value === null) continue;
    if (selected === "config" && (item.kind !== "worker" || item.targetId !== target.workerId || value.employeeId !== target.employeeId)
      || selected === "scope" && (!Array.isArray(value.workerIds) || value.workerIds.length !== 1 || value.workerIds[0] !== target.workerId)
      || selected === "management" && item.kind !== "management_audit_export" && (value.workerId !== target.workerId || value.employeeId !== target.employeeId)) fail(); } }
  return { item, before, after };
}
function authority(v: Record<string, unknown>, q: Exclude<DelegatedAuditQuery, { mode: "recover" }>): CurrentAuthority {
  if (v.grantId !== q.grantId || v.source !== q.source || v.scopeKind !== "audit_worker" && v.scopeKind !== "audit_company") fail();
  let target: CurrentAuthority["target"] = null;
  if (v.target !== null) { const t = exact(v.target, ["workerId", "employeeId", "employeeAuthUserId", "generation"]);
    target = { workerId: delegatedAuditUuid(t.workerId), employeeId: delegatedAuditUuid(t.employeeId), employeeAuthUserId: delegatedAuditUuid(t.employeeAuthUserId), generation: integer(t.generation) }; }
  if ((v.scopeKind === "audit_worker") !== (target !== null) || v.scopeKind === "audit_company" && q.source === "scope") fail();
  return { grantId: q.grantId, source: q.source, scopeKind: v.scopeKind as CurrentAuthority["scopeKind"], target };
}
function parseReceipt(raw: unknown, actor: string, readAt: string, operationId: string): DelegatedAuditReceipt {
  const v = exact(raw, ["operationId", "actorId", "grantId", "action", "commandFingerprint", "asOf", "count", "resultFingerprint", "recordedAt"]);
  const recordedAt = delegatedAuditStamp(v.recordedAt), asOf = delegatedAuditStamp(v.asOf);
  if (v.operationId !== operationId || v.actorId !== actor || v.action !== "export" || asOf > recordedAt || recordedAt > readAt) fail();
  return { operationId: delegatedAuditUuid(v.operationId), actorId: actor, grantId: delegatedAuditUuid(v.grantId), action: "export", commandFingerprint: fingerprint(v.commandFingerprint), asOf, count: integer(v.count, 0, 250), resultFingerprint: fingerprint(v.resultFingerprint), recordedAt };
}
export async function parseDelegatedAuditResult(raw: unknown, query: DelegatedAuditQuery, actorId: string, command: DelegatedAuditCommand | null = null): Promise<DelegatedAuditResult> {
  try { assertDelegatedAuditTree(raw); const q = parseDelegatedAuditQuery(query), actor = delegatedAuditUuid(actorId);
    if ((q.mode === "export") !== (command !== null)) fail(); const c = command === null ? null : parseDelegatedAuditBody({ query: q, command }).command;
    const kind = Object.getOwnPropertyDescriptor(raw, "kind")?.value, baseKeys = ["protocol", "siteId", "actorId", "readAt", "kind"];
    const v = exact(raw, [...baseKeys, ...(kind === "receipt" ? ["receipt"] : ["grantId", "source", "scopeKind", "target", ...(kind === "list" ? ["asOf", "items", "nextCursor"] : kind === "detail" ? ["row"] : ["payload", "receipt"])])]);
    if (v.protocol !== DELEGATED_AUDIT_PROTOCOL || v.siteId !== q.siteId || v.actorId !== actor) return fail();
    const base: Base = { protocol: DELEGATED_AUDIT_PROTOCOL, siteId: q.siteId, actorId: actor, readAt: delegatedAuditStamp(v.readAt) };
    if (kind === "receipt") { if (q.mode !== "recover" && q.mode !== "export") return fail();
      const receipt = v.receipt === null ? null : parseReceipt(v.receipt, actor, base.readAt, q.mode === "recover" ? q.operationId : c!.operationId);
      if (q.mode === "export" && (!receipt || receipt.grantId !== q.grantId || receipt.commandFingerprint !== await delegatedAuditCommandFingerprint(q, actor, c!))) fail();
      return freeze({ ...base, kind, receipt }); }
    if (q.mode === "recover" || kind !== q.mode) return fail(); const current = authority(v, q);
    if (q.mode === "detail") { const parsed = row(v.row, q.source, base.readAt, current.target); if (parsed.item.operationId !== q.sourceOperationId) fail(); return freeze({ ...base, ...current, kind: "detail", row: parsed }); }
    const parseRows = (entries: unknown, asOf: string, details: boolean) => {
      if (!Array.isArray(entries) || entries.length > (details ? 250 : 25)) return fail();
      let previous = q.mode === "list" && q.cursorId ? { recordedAt: q.cursorAt!, operationId: q.cursorId } : null; const seen = new Set<string>();
      return entries.map(value => { const parsed = details ? row(value, q.source, base.readAt, current.target) : null, item = parsed?.item ?? parseItem(value, q.source, base.readAt);
        if (item.recordedAt < q.fromAt || item.recordedAt >= q.toAt || item.recordedAt >= asOf || seen.has(item.operationId)
          || previous && (item.recordedAt > previous.recordedAt || item.recordedAt === previous.recordedAt && item.operationId >= previous.operationId)
          || current.target && q.source === "config" && (item.kind !== "worker" || item.targetId !== current.target.workerId)) fail();
        seen.add(item.operationId); previous = item; return parsed ?? item; });
    };
    if (q.mode === "list") { const asOf = delegatedAuditStamp(v.asOf); if (asOf > base.readAt || q.asOf !== null && q.asOf !== asOf) fail();
      const items = parseRows(v.items, asOf, false) as DelegatedAuditItem[]; let nextCursor: Readonly<{ recordedAt: string; operationId: string }> | null = null;
      if (v.nextCursor !== null) { const cursor = exact(v.nextCursor, ["recordedAt", "operationId"]); nextCursor = { recordedAt: delegatedAuditStamp(cursor.recordedAt), operationId: delegatedAuditUuid(cursor.operationId) };
        if (items.length !== 25 || nextCursor.recordedAt !== items.at(-1)?.recordedAt || nextCursor.operationId !== items.at(-1)?.operationId) fail(); }
      return freeze({ ...base, ...current, kind: "list", asOf, items, nextCursor }); }
    const p = exact(v.payload, ["schemaVersion", "fromAt", "toAt", "asOf", "count", "rows"]), asOf = delegatedAuditStamp(p.asOf);
    if (p.schemaVersion !== 1 || p.fromAt !== q.fromAt || p.toAt !== q.toAt || asOf > base.readAt || new TextEncoder().encode(JSON.stringify(p)).byteLength > DELEGATED_AUDIT_PAYLOAD_BYTES) fail();
    const rows = parseRows(p.rows, asOf, true) as DelegatedAuditRow[], count = integer(p.count, 0, 250); if (count !== rows.length) fail();
    const receipt = parseReceipt(v.receipt, actor, base.readAt, c!.operationId);
    if (receipt.grantId !== q.grantId || receipt.asOf !== asOf || receipt.count !== count || receipt.commandFingerprint !== await delegatedAuditCommandFingerprint(q, actor, c!)) fail();
    return freeze({ ...base, ...current, kind: "export", payload: { schemaVersion: 1, fromAt: q.fromAt, toAt: q.toAt, asOf, count, rows }, receipt });
  } catch { return fail("attendance_delegated_audit_invalid"); }
}
export async function buildDelegatedAuditCsv(raw: DelegatedAuditExport, query: DelegatedAuditExportQuery, actorId: string, command: DelegatedAuditCommand) {
  const safe = await parseDelegatedAuditResult(raw, query, actorId, command); if (safe.kind !== "export") return fail("attendance_delegated_audit_invalid");
  const header = ["schema", "merchant", "source", "grant", "export_operation", "from_utc_inclusive", "to_utc_exclusive", "as_of_utc", "count", "result_sha256",
    "source_operation", "recorded_at_utc", "resource_kind", "version", "resource_id", "actor_ref", "by_current_owner", "holder_ref", "before_json", "after_json"];
  const p = safe.payload, metadata = ["1", safe.siteId, safe.source, safe.grantId, safe.receipt.operationId, p.fromAt, p.toAt, p.asOf, String(p.count), safe.receipt.resultFingerprint];
  const records = p.rows.map(({ item, before, after }) => [...metadata, item.operationId, item.recordedAt, item.kind, String(item.version), item.targetId ?? "", item.actorRef, String(item.byCurrentOwner), item.holderRef ?? "", JSON.stringify(before), JSON.stringify(after)]);
  if (!records.length) records.push([...metadata, ...Array<string>(10).fill("")]);
  const csv = "\ufeff" + [header, ...records].map(values => values.map(attendanceAuditCsvCell).join(",")).join("\r\n") + "\r\n";
  if (new TextEncoder().encode(csv).byteLength > DELEGATED_AUDIT_CSV_BYTES) return fail("attendance_export_too_large");
  return freeze({ filename: `attendance-resource-audit-${safe.siteId}-${safe.source}-${safe.receipt.operationId}.csv`, csv, receipt: safe.receipt });
}
