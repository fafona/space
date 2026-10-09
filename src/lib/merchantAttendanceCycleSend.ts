// 200 first-send boundary only. Parsing and hashes are consistency checks,
// not authority, evidence adoption, a sent period, or employee confirmation.
import { captureBrowserExact, parseCaptureBrowserJson } from "./merchantAttendanceRuleCapturesBrowser";
import { operationalRuleLedgerEncode, operationalRuleLedgerFreeze as freeze } from "./merchantAttendanceOperationalRuleLedger";
import { parseCycleIntentQuery, type CycleIntentScope } from "./merchantAttendanceCycleIntent";
import { parsePeriodClosureV2Query, parsePeriodClosureV2Command, type PeriodClosureV2Query } from "./merchantAttendancePeriodClosureV2";
import { parsePeriodDelegatedClosureQuery, parsePeriodDelegatedClosureCommand, type PeriodDelegatedClosureQuery } from "./merchantAttendancePeriodDelegatedClosure";
import { MerchantAttendanceError } from "./merchantAttendanceTime";

export const CYCLE_SEND_API = "/api/merchant-enterprise/attendance/operational-cycle/send";
export const CYCLE_SEND_BODY_LIMIT = 8192, CYCLE_SEND_QUERY_LIMIT = 2048;
export type CycleSendFrame = CycleIntentScope & Readonly<{ fromDate: string; throughDate: string; periodId: string;
  intentId: string; expectedIntentFingerprint: string }>;
export type CycleSendCommand = Readonly<{ action: "send"; operationId: string; periodId: string; expectedRevision: 0;
  expectedVersion: 0; expectedFingerprint: string; reason: string }>;
export type CycleSendQuery = CycleSendFrame & Readonly<
  { mode: "preview"; operationId: null; commandFingerprint: null }
  | { mode: "recover"; operationId: string; commandFingerprint: string }>;
export type CycleSendBody = Readonly<{ frame: CycleSendFrame; command: CycleSendCommand }>;
export type CycleSendPeriodQuery = PeriodClosureV2Query | PeriodDelegatedClosureQuery;

function fail(): never { throw new MerchantAttendanceError("attendance_invalid_request"); }
function exact(raw: unknown, keys: readonly string[]) { try { return captureBrowserExact(raw, keys); } catch { return fail(); } }
const uuid = (v: unknown): string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v) ? v : fail();
const hash = (v: unknown): string => typeof v === "string" && /^[0-9a-f]{64}$/.test(v) ? v : fail();
const frameKeys = ["siteId", "access", "workerId", "grantId", "fromDate", "throughDate", "periodId", "intentId", "expectedIntentFingerprint"] as const;

// Reuse the actual owner's / delegate's existing query parsers. Never turn a
// delegate into an owner or let this route submit as the employee.
function periodQuery(frame: CycleSendFrame, mode: "preview" | "detail" | "recover", operationId: string | null): CycleSendPeriodQuery {
  const base = { siteId: frame.siteId, access: frame.access, workerId: frame.workerId, fromDate: frame.fromDate,
    throughDate: frame.throughDate, periodId: frame.periodId, mode, operationId, version: null, cursor: null };
  return frame.access === "owner" ? parsePeriodClosureV2Query(base) : parsePeriodDelegatedClosureQuery({ ...base, grantId: frame.grantId });
}
export function parseCycleSendFrame(raw: unknown): CycleSendFrame {
  try {
    const v = exact(raw, frameKeys), scope = parseCycleIntentQuery({ siteId: v.siteId, access: v.access, workerId: v.workerId,
      grantId: v.grantId, mode: "detail", intentId: v.intentId });
    if (scope.mode !== "detail") fail();
    const frame = { siteId: scope.siteId, access: scope.access, workerId: scope.workerId, grantId: scope.grantId,
      fromDate: v.fromDate as string, throughDate: v.throughDate as string, periodId: uuid(v.periodId),
      intentId: scope.intentId, expectedIntentFingerprint: hash(v.expectedIntentFingerprint) };
    const q = periodQuery(frame, "detail", null);
    return freeze({ ...frame, fromDate: q.fromDate, throughDate: q.throughDate });
  } catch { return fail(); }
}
export function cycleSendPeriodQuery(raw: CycleSendFrame, mode: "preview" | "detail" | "recover" = "detail", operationId: string | null = null): CycleSendPeriodQuery {
  if (!["preview", "detail", "recover"].includes(mode)) fail();
  return freeze(periodQuery(parseCycleSendFrame(raw), mode, operationId));
}
export function cycleSendIntent(raw: CycleSendFrame) {
  const frame = parseCycleSendFrame(raw); return freeze({ intentId: frame.intentId, expectedIntentFingerprint: frame.expectedIntentFingerprint });
}
export function parseCycleSendCommand(raw: unknown, rawFrame: CycleSendFrame): CycleSendCommand {
  try {
    const frame = parseCycleSendFrame(rawFrame), q = periodQuery(frame, "detail", null);
    const c = frame.access === "owner" ? parsePeriodClosureV2Command(q as PeriodClosureV2Query, raw)
      : parsePeriodDelegatedClosureCommand(q as PeriodDelegatedClosureQuery, raw);
    if (c.action !== "send" || c.expectedRevision !== 0 || c.expectedVersion !== 0 || c.expectedFingerprint === null || c.operationId === frame.intentId) fail();
    // The old command accepts an empty send reason; preserve that behavior,
    // while rejecting malformed Unicode and control characters at this boundary.
    if (/[\u0000-\u001f\u007f-\u009f]/.test(c.reason)) fail();
    for (let n = 0; n < c.reason.length; n++) {
      const code = c.reason.charCodeAt(n);
      if (code >= 0xd800 && code <= 0xdbff) { const next = c.reason.charCodeAt(++n); if (!(next >= 0xdc00 && next <= 0xdfff)) fail(); }
      else if (code >= 0xdc00 && code <= 0xdfff) fail();
    }
    return freeze({ ...c, action: "send", expectedRevision: 0, expectedVersion: 0, expectedFingerprint: hash(c.expectedFingerprint) });
  } catch { return fail(); }
}
export function parseCycleSendBody(raw: unknown): CycleSendBody {
  const v = exact(raw, ["frame", "command"]), frame = parseCycleSendFrame(v.frame);
  return freeze({ frame, command: parseCycleSendCommand(v.command, frame) });
}
export function parseCycleSendBodyJson(text: string): CycleSendBody {
  if (typeof text !== "string" || text.length > CYCLE_SEND_BODY_LIMIT || new TextEncoder().encode(text).byteLength > CYCLE_SEND_BODY_LIMIT) fail();
  try { return parseCycleSendBody(parseCaptureBrowserJson(text)); } catch { return fail(); }
}
export function parseCycleSendQuery(raw: unknown): CycleSendQuery {
  const v = exact(raw, [...frameKeys, "mode", "operationId", "commandFingerprint"]), frame = parseCycleSendFrame(Object.fromEntries(frameKeys.map(k => [k, v[k]])));
  if (v.mode === "preview" && v.operationId === null && v.commandFingerprint === null) return freeze({ ...frame, mode: "preview", operationId: null, commandFingerprint: null });
  if (v.mode !== "recover") fail();
  const operationId = uuid(v.operationId); if (operationId === frame.intentId) fail();
  return freeze({ ...frame, mode: "recover", operationId, commandFingerprint: hash(v.commandFingerprint) });
}
export function cycleSendQueryString(raw: CycleSendQuery): string {
  return new URLSearchParams(Object.entries(parseCycleSendQuery(raw)).map(([key, value]) => [key, value === null ? "null" : String(value)])).toString();
}
export function cycleSendQueryFrame(raw: CycleSendQuery): CycleSendFrame {
  const q = parseCycleSendQuery(raw); return parseCycleSendFrame(Object.fromEntries(frameKeys.map(key => [key, q[key]])));
}
export function parseCycleSendHttpQuery(url: string): CycleSendQuery {
  try {
    const input = new URL(url); if (input.hash || url.includes("#") || new TextEncoder().encode(input.search).byteLength > CYCLE_SEND_QUERY_LIMIT) fail();
    const pairs = [...input.searchParams.entries()]; if (new Set(pairs.map(([key]) => key)).size !== pairs.length) fail();
    return parseCycleSendQuery(Object.fromEntries(pairs.map(([key, value]) => [key, value === "null" ? null : value])));
  } catch { return fail(); }
}
export async function cycleSendCommandFingerprint(rawFrame: CycleSendFrame, rawCommand: CycleSendCommand, rawActor: string): Promise<string> {
  // All input is copied and frozen before the first asynchronous boundary.
  const frame = parseCycleSendFrame(rawFrame), c = parseCycleSendCommand(rawCommand, frame), actor = uuid(rawActor), q = periodQuery(frame, "detail", null);
  const tuple = ["attendance-cycle-send-v1", actor,
    [q.siteId, q.access, q.workerId, frame.grantId, q.fromDate, q.throughDate, "detail", q.periodId, null, null, null],
    [c.action, c.operationId, c.periodId, c.expectedRevision, c.expectedVersion, c.expectedFingerprint, c.reason],
    [frame.intentId, frame.expectedIntentFingerprint]];
  const bytes = new TextEncoder().encode(operationalRuleLedgerEncode(tuple));
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(b => b.toString(16).padStart(2, "0")).join("");
}
