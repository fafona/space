// 194: shared consumer activation, separate from four-channel punch activation.
import { captureBrowserExact, captureBrowserUuid, parseCaptureBrowserJson } from "./merchantAttendanceRuleCapturesBrowser";
import { operationalRuleLedgerEncode, operationalRuleLedgerFreeze as freeze } from "./merchantAttendanceOperationalRuleLedger";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
export const OPERATIONAL_CONSUMER_ACTIVATION_API = "/api/merchant-enterprise/attendance/operational-consumer-activation";
export const OPERATIONAL_CONSUMER_ACTIVATION_PROTOCOL = "attendance-operational-consumer-activation-v1" as const;
export const OPERATIONAL_CONSUMER_ACTIVATION_BODY_LIMIT = 8192, OPERATIONAL_CONSUMER_ACTIVATION_RESPONSE_LIMIT = 16384;
export type OperationalConsumerActivationQuery = Readonly<{ siteId: string; consumer: OperationalConsumer; mode: "current" } | { siteId: string; consumer: OperationalConsumer; mode: "recover"; operationId: string }>;
export type OperationalConsumerActivationCommand = Readonly<{ siteId: string; consumer: OperationalConsumer; operationId: string; action: "activate" | "deactivate"; expectedRevision: number; reason: string }>;
export type OperationalConsumerActivationItem = Readonly<{ siteId: string; consumer: OperationalConsumer; operationId: string; revision: number; actorId: string; action: "activate" | "deactivate"; reason: string; recordedAt: string; commandFingerprint: string }>;
export type OperationalConsumerActivationResult = Readonly<{ protocol: typeof OPERATIONAL_CONSUMER_ACTIVATION_PROTOCOL; siteId: string; consumer: OperationalConsumer; actorId: string; readAt: string; canActivate: boolean; canDeactivate: boolean; current: OperationalConsumerActivationItem | null; receipt: OperationalConsumerActivationItem | null }>;
export const OPERATIONAL_CONSUMER_ACTIVATION_ERRORS = Object.freeze({ attendance_invalid_request: 400, attendance_access_denied: 403, attendance_settings_required: 409,
  attendance_platform_paused: 403, attendance_operation_conflict: 409, attendance_rate_limited: 429,
  attendance_operational_consumer_invalid: 503, attendance_operational_consumer_changed: 409,
  attendance_operational_consumer_disabled: 403, attendance_operational_consumer_too_large: 422, attendance_operational_consumer_unchanged: 409 });
export type OperationalConsumerActivationError = keyof typeof OPERATIONAL_CONSUMER_ACTIVATION_ERRORS;
export const OPERATIONAL_CONSUMER_ACTIVATION_MESSAGES: Readonly<Record<OperationalConsumerActivationError, string>> = Object.freeze(Object.fromEntries(Object.keys(OPERATIONAL_CONSUMER_ACTIVATION_ERRORS).map(code => [code,
  code === "attendance_operational_consumer_changed" ? "状态已变化，请保留原编号并重新核对。" : code === "attendance_operational_consumer_disabled" ? "新启用暂未开放；仍可核对原号或由当前负责人停用。" : "无法确认启用台账结果；请保留原编号并核对。"]))) as Readonly<Record<OperationalConsumerActivationError, string>>;
export const OPERATIONAL_CONSUMERS = ["application_window", "review_routing", "timesheet_cycle", "reminders"] as const;
export type OperationalConsumer = typeof OPERATIONAL_CONSUMERS[number];
const consumer = (v: unknown): OperationalConsumer => typeof v === "string" && OPERATIONAL_CONSUMERS.includes(v as OperationalConsumer) ? v as OperationalConsumer : fail();
const MAX = 9007199254740990;
function fail(): never { throw new MerchantAttendanceError("attendance_invalid_request"); }
function invalid(): never { throw new MerchantAttendanceError("attendance_operational_consumer_invalid"); }
function exact(v: unknown, keys: readonly string[]) { try { return captureBrowserExact(v, keys); } catch { return fail(); } }
function uuid(v: unknown) { if (typeof v !== "string" || v.length !== 36) fail(); try { return captureBrowserUuid(v); } catch { return fail(); } }
const site = (v: unknown): string => typeof v === "string" && v.length === 8 && /^[0-9]{8}$/.test(v) ? v : fail();
const integer = (v: unknown, min = 0, max = MAX): number => typeof v === "number" && Number.isSafeInteger(v) && !Object.is(v, -0) && v >= min && v <= max ? v : fail();
const action = (v: unknown) => v === "activate" || v === "deactivate" ? v : fail();
function reason(v: unknown): string { if (typeof v !== "string" || !v || v !== v.trim() || [...v].length > 200 || /[\u0000-\u001f\u007f-\u009f]/.test(v)) fail();
  for (let i = 0; i < v.length; i++) { const n = v.charCodeAt(i); if (n >= 0xd800 && n <= 0xdbff) { const next = v.charCodeAt(++i); if (!(next >= 0xdc00 && next <= 0xdfff)) fail(); } else if (n >= 0xdc00 && n <= 0xdfff) fail(); } return v; }
function instant(v: unknown): string { if (typeof v !== "string" || v.length !== 27 || !/^(?!0000)\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(v)) fail(); const ms = v.slice(0, 23) + "Z"; if (!Number.isFinite(Date.parse(ms)) || new Date(ms).toISOString() !== ms) fail(); return v; }
export function parseOperationalConsumerActivationQuery(raw: unknown): OperationalConsumerActivationQuery { const tag = raw && typeof raw === "object" ? Object.getOwnPropertyDescriptor(raw, "mode")?.value : null;
  const mode = exact(raw, tag === "recover" ? ["siteId", "consumer", "mode", "operationId"] : ["siteId", "consumer", "mode"]);
  if (mode.mode === "current") return freeze({ siteId: site(mode.siteId), consumer: consumer(mode.consumer), mode: "current" }); if (mode.mode === "recover") return freeze({ siteId: site(mode.siteId), consumer: consumer(mode.consumer), mode: "recover", operationId: uuid(mode.operationId) }); return fail(); }
export function parseOperationalConsumerActivationCommand(raw: unknown): OperationalConsumerActivationCommand { const c = exact(raw, ["siteId", "consumer", "operationId", "action", "expectedRevision", "reason"]); return freeze({ siteId: site(c.siteId), consumer: consumer(c.consumer), operationId: uuid(c.operationId), action: action(c.action), expectedRevision: integer(c.expectedRevision, 0, MAX - 1), reason: reason(c.reason) }); }
export function parseOperationalConsumerActivationBody(raw: unknown) { const b = exact(raw, ["query", "command"]), query = parseOperationalConsumerActivationQuery(b.query), command = parseOperationalConsumerActivationCommand(b.command);
  if (query.mode !== "current" || query.siteId !== command.siteId || query.consumer !== command.consumer) fail(); return freeze({ query, command }); }
export function parseOperationalConsumerActivationHttpQuery(url: string) { const u = new URL(url); if (u.hash || url.includes("#") || u.search.length > 512) fail(); const entries = [...u.searchParams.entries()]; if (new Set(entries.map(([k]) => k)).size !== entries.length) fail(); return parseOperationalConsumerActivationQuery(Object.fromEntries(entries)); }
export function operationalConsumerActivationQueryString(raw: OperationalConsumerActivationQuery) { return new URLSearchParams(parseOperationalConsumerActivationQuery(raw)).toString(); }
export function parseOperationalConsumerActivationJson(text: string, request = false): unknown { if (typeof text !== "string" || text.length > (request ? OPERATIONAL_CONSUMER_ACTIVATION_BODY_LIMIT : OPERATIONAL_CONSUMER_ACTIVATION_RESPONSE_LIMIT) || new TextEncoder().encode(text).byteLength > (request ? OPERATIONAL_CONSUMER_ACTIVATION_BODY_LIMIT : OPERATIONAL_CONSUMER_ACTIVATION_RESPONSE_LIMIT)) throw new MerchantAttendanceError("attendance_operational_consumer_too_large"); try { return parseCaptureBrowserJson(text); } catch { return request ? fail() : invalid(); } }
export async function operationalConsumerActivationCommandFingerprint(raw: OperationalConsumerActivationCommand, actorId: string) { const c = parseOperationalConsumerActivationCommand(raw), actor = uuid(actorId);
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(operationalRuleLedgerEncode(["attendance-operational-consumer-activation-command-v1", c.siteId, c.consumer, actor, [c.operationId, c.action, c.expectedRevision, c.reason]]))); return [...new Uint8Array(bytes)].map(x => x.toString(16).padStart(2, "0")).join(""); }
function item(raw: unknown): OperationalConsumerActivationItem { const x = exact(raw, ["siteId", "consumer", "operationId", "revision", "actorId", "action", "reason", "recordedAt", "commandFingerprint"]); if (typeof x.commandFingerprint !== "string" || x.commandFingerprint.length !== 64 || !/^[0-9a-f]{64}$/.test(x.commandFingerprint)) fail();
  return freeze({ siteId: site(x.siteId), consumer: consumer(x.consumer), operationId: uuid(x.operationId), revision: integer(x.revision, 1), actorId: uuid(x.actorId), action: action(x.action), reason: reason(x.reason), recordedAt: instant(x.recordedAt), commandFingerprint: x.commandFingerprint }); }
export function operationalConsumerActivationReceiptMatches(r: OperationalConsumerActivationItem, c: OperationalConsumerActivationCommand, actorId: string, fingerprint: string) { return r.siteId === c.siteId && r.consumer === c.consumer && r.actorId === actorId && r.operationId === c.operationId && r.action === c.action && r.reason === c.reason && r.revision === c.expectedRevision + 1 && r.commandFingerprint === fingerprint; }
export async function parseOperationalConsumerActivationResult(raw: unknown, rawQuery: OperationalConsumerActivationQuery, actorId: string, rawCommand: OperationalConsumerActivationCommand | null = null): Promise<OperationalConsumerActivationResult> {
  try { const q = parseOperationalConsumerActivationQuery(rawQuery), actor = uuid(actorId), c = rawCommand === null ? null : parseOperationalConsumerActivationBody({ query: q, command: rawCommand }).command;
    const r = exact(raw, ["protocol", "siteId", "consumer", "actorId", "readAt", "canActivate", "canDeactivate", "current", "receipt"]);
    if (r.protocol !== OPERATIONAL_CONSUMER_ACTIVATION_PROTOCOL || r.siteId !== q.siteId || r.consumer !== q.consumer || r.actorId !== actor || typeof r.canActivate !== "boolean" || typeof r.canDeactivate !== "boolean") invalid();
    // Copy every field synchronously before hashing; never retain caller-owned data.
    const value: OperationalConsumerActivationResult = freeze({ protocol: OPERATIONAL_CONSUMER_ACTIVATION_PROTOCOL, siteId: q.siteId, consumer: q.consumer, actorId: actor, readAt: instant(r.readAt), canActivate: r.canActivate, canDeactivate: r.canDeactivate, current: r.current === null ? null : item(r.current), receipt: r.receipt === null ? null : item(r.receipt) });
    for (const entry of [value.current, value.receipt]) if (entry) { if (entry.siteId !== q.siteId || entry.consumer !== q.consumer || entry.recordedAt > value.readAt || entry.commandFingerprint !== await operationalConsumerActivationCommandFingerprint({ siteId: entry.siteId, consumer: entry.consumer, operationId: entry.operationId, action: entry.action, expectedRevision: entry.revision - 1, reason: entry.reason }, entry.actorId)) invalid(); }
    if (q.mode === "recover") { if (value.current !== null || value.canActivate || value.canDeactivate || value.receipt && (value.receipt.operationId !== q.operationId || value.receipt.actorId !== actor)) invalid(); }
    else if (c) { if (value.canActivate || value.canDeactivate || !value.receipt || !operationalConsumerActivationReceiptMatches(value.receipt, c, actor, await operationalConsumerActivationCommandFingerprint(c, actor)) || !value.current || value.current.revision < value.receipt.revision || value.current.recordedAt < value.receipt.recordedAt || value.current.revision === value.receipt.revision && JSON.stringify(value.current) !== JSON.stringify(value.receipt)) invalid(); }
    else if (value.receipt !== null || value.canActivate && (q.consumer !== "application_window" && q.consumer !== "review_routing" && q.consumer !== "timesheet_cycle" && q.consumer !== "reminders" || value.current?.action === "activate" || value.current?.revision === MAX) || value.canDeactivate && (value.current?.action !== "activate" || value.current.revision === MAX)) invalid();
    return value;
  } catch { return invalid(); }
}
export async function parseOperationalConsumerActivationResponse(raw: unknown, q: OperationalConsumerActivationQuery, actor: string, c: OperationalConsumerActivationCommand | null = null) {
  try { const ok = Object.getOwnPropertyDescriptor(raw, "ok")?.value;
    if (ok === true) { const r = exact(raw, ["ok", "data"]); return freeze({ ok: true as const, data: await parseOperationalConsumerActivationResult(r.data, q, actor, c) }); }
    const r = exact(raw, ["ok", "error"]), e = exact(r.error, ["code", "message"]); if (r.ok !== false || typeof e.code !== "string" || !Object.hasOwn(OPERATIONAL_CONSUMER_ACTIVATION_ERRORS, e.code) || e.message !== OPERATIONAL_CONSUMER_ACTIVATION_MESSAGES[e.code as OperationalConsumerActivationError]) invalid();
    return freeze({ ok: false as const, error: { code: e.code as OperationalConsumerActivationError, message: e.message as string } });
  } catch { return invalid(); }
}

