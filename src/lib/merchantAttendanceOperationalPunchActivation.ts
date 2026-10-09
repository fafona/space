// 242: owner activation ledger, not proof that all clock channels were accepted.
import { captureBrowserExact, captureBrowserUuid, parseCaptureBrowserJson } from "./merchantAttendanceRuleCapturesBrowser";
import { operationalRuleLedgerEncode, operationalRuleLedgerFreeze as freeze } from "./merchantAttendanceOperationalRuleLedger";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
export const OPERATIONAL_PUNCH_ACTIVATION_API = "/api/merchant-enterprise/attendance/operational-punch-activation";
export const OPERATIONAL_PUNCH_ACTIVATION_PROTOCOL = "attendance-operational-punch-activation-v1" as const;
export const OPERATIONAL_PUNCH_ACTIVATION_BODY_LIMIT = 8192, OPERATIONAL_PUNCH_ACTIVATION_RESPONSE_LIMIT = 16384;
export type OperationalPunchActivationQuery = Readonly<{ siteId: string; mode: "current" } | { siteId: string; mode: "recover"; operationId: string }>;
export type OperationalPunchActivationCommand = Readonly<{ siteId: string; operationId: string; action: "activate" | "deactivate"; expectedRevision: number; reason: string }>;
export type OperationalPunchActivationItem = Readonly<{ siteId: string; operationId: string; revision: number; actorId: string; action: "activate" | "deactivate"; reason: string; recordedAt: string; commandFingerprint: string }>;
export type OperationalPunchActivationResult = Readonly<{ protocol: typeof OPERATIONAL_PUNCH_ACTIVATION_PROTOCOL; siteId: string; actorId: string; readAt: string; canActivate: boolean; canDeactivate: boolean; current: OperationalPunchActivationItem | null; receipt: OperationalPunchActivationItem | null }>;
export const OPERATIONAL_PUNCH_ACTIVATION_ERRORS = Object.freeze({ attendance_invalid_request: 400, attendance_access_denied: 403, attendance_settings_required: 409,
  attendance_platform_paused: 403, attendance_operation_conflict: 409, attendance_rate_limited: 429,
  attendance_operational_punch_invalid: 503, attendance_operational_punch_changed: 409, attendance_operational_punch_protocol_required: 409,
  attendance_operational_punch_disabled: 403, attendance_operational_punch_channel_denied: 403, attendance_operational_punch_location_denied: 403,
  attendance_operational_punch_break_type_denied: 409, attendance_operational_punch_too_large: 422, attendance_operational_punch_not_found: 404, attendance_operational_punch_unchanged: 409 });
export type OperationalPunchActivationError = keyof typeof OPERATIONAL_PUNCH_ACTIVATION_ERRORS;
export const OPERATIONAL_PUNCH_ACTIVATION_MESSAGES: Readonly<Record<OperationalPunchActivationError, string>> = Object.freeze(Object.fromEntries(Object.keys(OPERATIONAL_PUNCH_ACTIVATION_ERRORS).map(code => [code,
  code === "attendance_operational_punch_changed" ? "状态已变化，请保留原编号并重新核对。" : code === "attendance_operational_punch_disabled" ? "新启用暂未开放；仍可核对原号或由当前负责人停用。" : "无法确认启用台账结果；请保留原编号并核对。"]))) as Readonly<Record<OperationalPunchActivationError, string>>;
const MAX = 9007199254740990;
function fail(): never { throw new MerchantAttendanceError("attendance_invalid_request"); }
function invalid(): never { throw new MerchantAttendanceError("attendance_operational_punch_invalid"); }
function exact(v: unknown, keys: readonly string[]) { try { return captureBrowserExact(v, keys); } catch { return fail(); } }
function uuid(v: unknown) { if (typeof v !== "string" || v.length !== 36) fail(); try { return captureBrowserUuid(v); } catch { return fail(); } }
const site = (v: unknown): string => typeof v === "string" && v.length === 8 && /^[0-9]{8}$/.test(v) ? v : fail();
const integer = (v: unknown, min = 0, max = MAX): number => typeof v === "number" && Number.isSafeInteger(v) && !Object.is(v, -0) && v >= min && v <= max ? v : fail();
const action = (v: unknown) => v === "activate" || v === "deactivate" ? v : fail();
function reason(v: unknown): string { if (typeof v !== "string" || !v || v !== v.trim() || [...v].length > 200 || /[\u0000-\u001f\u007f-\u009f]/.test(v)) fail();
  for (let i = 0; i < v.length; i++) { const n = v.charCodeAt(i); if (n >= 0xd800 && n <= 0xdbff) { const next = v.charCodeAt(++i); if (!(next >= 0xdc00 && next <= 0xdfff)) fail(); } else if (n >= 0xdc00 && n <= 0xdfff) fail(); } return v; }
function instant(v: unknown): string { if (typeof v !== "string" || v.length !== 27 || !/^(?!0000)\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(v)) fail(); const ms = v.slice(0, 23) + "Z"; if (!Number.isFinite(Date.parse(ms)) || new Date(ms).toISOString() !== ms) fail(); return v; }
export function parseOperationalPunchActivationQuery(raw: unknown): OperationalPunchActivationQuery { const tag = raw && typeof raw === "object" ? Object.getOwnPropertyDescriptor(raw, "mode")?.value : null;
  const mode = exact(raw, tag === "recover" ? ["siteId", "mode", "operationId"] : ["siteId", "mode"]);
  if (mode.mode === "current") return freeze({ siteId: site(mode.siteId), mode: "current" }); if (mode.mode === "recover") return freeze({ siteId: site(mode.siteId), mode: "recover", operationId: uuid(mode.operationId) }); return fail(); }
export function parseOperationalPunchActivationCommand(raw: unknown): OperationalPunchActivationCommand { const c = exact(raw, ["siteId", "operationId", "action", "expectedRevision", "reason"]); return freeze({ siteId: site(c.siteId), operationId: uuid(c.operationId), action: action(c.action), expectedRevision: integer(c.expectedRevision, 0, MAX - 1), reason: reason(c.reason) }); }
export function parseOperationalPunchActivationBody(raw: unknown) { const b = exact(raw, ["query", "command"]), query = parseOperationalPunchActivationQuery(b.query), command = parseOperationalPunchActivationCommand(b.command);
  if (query.mode !== "current" || query.siteId !== command.siteId) fail(); return freeze({ query, command }); }
export function parseOperationalPunchActivationHttpQuery(url: string) { const u = new URL(url); if (u.hash || url.includes("#") || u.search.length > 512) fail(); const entries = [...u.searchParams.entries()]; if (new Set(entries.map(([k]) => k)).size !== entries.length) fail(); return parseOperationalPunchActivationQuery(Object.fromEntries(entries)); }
export function operationalPunchActivationQueryString(raw: OperationalPunchActivationQuery) { return new URLSearchParams(parseOperationalPunchActivationQuery(raw)).toString(); }
export function parseOperationalPunchActivationJson(text: string, request = false): unknown { if (typeof text !== "string" || text.length > (request ? OPERATIONAL_PUNCH_ACTIVATION_BODY_LIMIT : OPERATIONAL_PUNCH_ACTIVATION_RESPONSE_LIMIT) || new TextEncoder().encode(text).byteLength > (request ? OPERATIONAL_PUNCH_ACTIVATION_BODY_LIMIT : OPERATIONAL_PUNCH_ACTIVATION_RESPONSE_LIMIT)) throw new MerchantAttendanceError("attendance_operational_punch_too_large"); try { return parseCaptureBrowserJson(text); } catch { return request ? fail() : invalid(); } }
export async function operationalPunchActivationCommandFingerprint(raw: OperationalPunchActivationCommand, actorId: string) { const c = parseOperationalPunchActivationCommand(raw), actor = uuid(actorId);
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(operationalRuleLedgerEncode(["attendance-operational-punch-activation-command-v1", c.siteId, actor, [c.operationId, c.action, c.expectedRevision, c.reason]]))); return [...new Uint8Array(bytes)].map(x => x.toString(16).padStart(2, "0")).join(""); }
function item(raw: unknown): OperationalPunchActivationItem { const x = exact(raw, ["siteId", "operationId", "revision", "actorId", "action", "reason", "recordedAt", "commandFingerprint"]); if (typeof x.commandFingerprint !== "string" || x.commandFingerprint.length !== 64 || !/^[0-9a-f]{64}$/.test(x.commandFingerprint)) fail();
  return freeze({ siteId: site(x.siteId), operationId: uuid(x.operationId), revision: integer(x.revision, 1), actorId: uuid(x.actorId), action: action(x.action), reason: reason(x.reason), recordedAt: instant(x.recordedAt), commandFingerprint: x.commandFingerprint }); }
export function operationalPunchActivationReceiptMatches(r: OperationalPunchActivationItem, c: OperationalPunchActivationCommand, actorId: string, fingerprint: string) { return r.siteId === c.siteId && r.actorId === actorId && r.operationId === c.operationId && r.action === c.action && r.reason === c.reason && r.revision === c.expectedRevision + 1 && r.commandFingerprint === fingerprint; }
export async function parseOperationalPunchActivationResult(raw: unknown, rawQuery: OperationalPunchActivationQuery, actorId: string, rawCommand: OperationalPunchActivationCommand | null = null): Promise<OperationalPunchActivationResult> {
  try { const q = parseOperationalPunchActivationQuery(rawQuery), actor = uuid(actorId), c = rawCommand === null ? null : parseOperationalPunchActivationBody({ query: q, command: rawCommand }).command;
    const r = exact(raw, ["protocol", "siteId", "actorId", "readAt", "canActivate", "canDeactivate", "current", "receipt"]);
    if (r.protocol !== OPERATIONAL_PUNCH_ACTIVATION_PROTOCOL || r.siteId !== q.siteId || r.actorId !== actor || typeof r.canActivate !== "boolean" || typeof r.canDeactivate !== "boolean") invalid();
    // Copy every field synchronously before hashing; never retain caller-owned data.
    const value: OperationalPunchActivationResult = freeze({ protocol: OPERATIONAL_PUNCH_ACTIVATION_PROTOCOL, siteId: q.siteId, actorId: actor, readAt: instant(r.readAt), canActivate: r.canActivate, canDeactivate: r.canDeactivate, current: r.current === null ? null : item(r.current), receipt: r.receipt === null ? null : item(r.receipt) });
    for (const entry of [value.current, value.receipt]) if (entry) { if (entry.siteId !== q.siteId || entry.recordedAt > value.readAt || entry.commandFingerprint !== await operationalPunchActivationCommandFingerprint({ siteId: entry.siteId, operationId: entry.operationId, action: entry.action, expectedRevision: entry.revision - 1, reason: entry.reason }, entry.actorId)) invalid(); }
    if (q.mode === "recover") { if (value.current !== null || value.canActivate || value.canDeactivate || value.receipt && (value.receipt.operationId !== q.operationId || value.receipt.actorId !== actor)) invalid(); }
    else if (c) { if (value.canActivate || value.canDeactivate || !value.receipt || !operationalPunchActivationReceiptMatches(value.receipt, c, actor, await operationalPunchActivationCommandFingerprint(c, actor)) || !value.current || value.current.revision < value.receipt.revision || value.current.recordedAt < value.receipt.recordedAt || value.current.revision === value.receipt.revision && JSON.stringify(value.current) !== JSON.stringify(value.receipt)) invalid(); }
    else if (value.receipt !== null || value.canActivate && (value.current?.action === "activate" || value.current?.revision === MAX) || value.canDeactivate && (value.current?.action !== "activate" || value.current.revision === MAX)) invalid();
    return value;
  } catch { return invalid(); }
}
export async function parseOperationalPunchActivationResponse(raw: unknown, q: OperationalPunchActivationQuery, actor: string, c: OperationalPunchActivationCommand | null = null) {
  try { const ok = Object.getOwnPropertyDescriptor(raw, "ok")?.value;
    if (ok === true) { const r = exact(raw, ["ok", "data"]); return freeze({ ok: true as const, data: await parseOperationalPunchActivationResult(r.data, q, actor, c) }); }
    const r = exact(raw, ["ok", "error"]), e = exact(r.error, ["code", "message"]); if (r.ok !== false || typeof e.code !== "string" || !Object.hasOwn(OPERATIONAL_PUNCH_ACTIVATION_ERRORS, e.code) || e.message !== OPERATIONAL_PUNCH_ACTIVATION_MESSAGES[e.code as OperationalPunchActivationError]) invalid();
    return freeze({ ok: false as const, error: { code: e.code as OperationalPunchActivationError, message: e.message as string } });
  } catch { return invalid(); }
}
