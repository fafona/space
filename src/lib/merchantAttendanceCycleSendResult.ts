// Minimal 200 adoption receipt. Does not collect today's source, restore
// permissions, expose an archived report, or claim employee confirmation.
import { captureBrowserExact, parseCaptureBrowserJson } from "./merchantAttendanceRuleCapturesBrowser";
import { operationalRuleLedgerEqual as equal, operationalRuleLedgerFreeze as freeze } from "./merchantAttendanceOperationalRuleLedger";
import { CYCLE_INTENT_PROTOCOL } from "./merchantAttendanceCycleIntent";
import { CYCLE_INTENT_ERRORS, type CycleIntentReceipt } from "./merchantAttendanceCycleIntentResult";
import { PERIOD_DELEGATED_CLOSURE_ERRORS } from "./merchantAttendancePeriodDelegatedClosure";
import { parseCycleSendFrame, parseCycleSendCommand, cycleSendCommandFingerprint,
  type CycleSendFrame, type CycleSendCommand } from "./merchantAttendanceCycleSend";
import { MerchantAttendanceError } from "./merchantAttendanceTime";

export const CYCLE_SEND_RESULT_LIMIT = 16384;
export const CYCLE_SEND_ERRORS: Readonly<Record<string, number>> = Object.freeze({ ...PERIOD_DELEGATED_CLOSURE_ERRORS, ...CYCLE_INTENT_ERRORS });
export type CycleSendPeriodEntry = Readonly<{ operationId: string; revision: 1; action: "send"; version: 1;
  actorId: string; reason: string; recordedAt: string; command: CycleSendCommand }>;
type Common = Readonly<{ protocol: typeof CYCLE_INTENT_PROTOCOL; siteId: string; actorId: string; readAt: string }>;
export type CycleSendResult = Common & (
  Readonly<{ data: Readonly<{ kind: "receipt" }>; receipt: null }>
  | Readonly<{ data: Readonly<{ kind: "linked"; periodOperation: CycleSendPeriodEntry }>; receipt: CycleIntentReceipt }>);
function fail(): never { throw new MerchantAttendanceError("attendance_operational_cycle_invalid"); }
function exact(raw: unknown, keys: readonly string[]) { try { return captureBrowserExact(raw, keys); } catch { return fail(); } }
const uuid = (v: unknown): string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v) ? v : fail();
const hash = (v: unknown): string => typeof v === "string" && /^[0-9a-f]{64}$/.test(v) ? v : fail();
function instant(v: unknown): string {
  if (typeof v !== "string" || !/^(?:20\d{2}|2100|2101)-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/.test(v)) fail();
  const ms = v.slice(0, 23) + "Z"; if (!Number.isFinite(Date.parse(ms)) || new Date(ms).toISOString() !== ms) fail(); return v;
}
function snapshot(raw: unknown): unknown {
  let nodes = 0; const path = new Set<object>();
  function copy(v: unknown, depth: number): unknown {
    if (++nodes > 128 || depth > 6) fail();
    if (v === null || typeof v === "boolean") return v;
    if (typeof v === "string") { if (v.length > CYCLE_SEND_RESULT_LIMIT) fail(); return v; }
    if (typeof v === "number") { if (!Number.isSafeInteger(v) || Object.is(v, -0)) fail(); return v; }
    if (!v || typeof v !== "object" || Array.isArray(v) || path.has(v)) fail();
    const prototype = Object.getPrototypeOf(v); if (prototype !== Object.prototype && prototype !== null) fail();
    path.add(v); const out: Record<string, unknown> = {};
    for (const k of Reflect.ownKeys(v)) {
      if (typeof k !== "string" || ["__proto__", "prototype", "constructor"].includes(k)) fail();
      const d = Object.getOwnPropertyDescriptor(v, k)!; if (!("value" in d) || !d.enumerable) fail(); out[k] = copy(d.value, depth + 1);
    }
    path.delete(v); return out;
  }
  const owned = copy(raw, 0); if (new TextEncoder().encode(JSON.stringify(owned)).byteLength > CYCLE_SEND_RESULT_LIMIT) fail(); return owned;
}
export function parseCycleSendResultJson(text: string): unknown {
  if (typeof text !== "string" || text.length > CYCLE_SEND_RESULT_LIMIT || new TextEncoder().encode(text).byteLength > CYCLE_SEND_RESULT_LIMIT) fail();
  try { return parseCaptureBrowserJson(text); } catch { return fail(); }
}
export async function parseCycleSendResult(raw: unknown, rawFrame: CycleSendFrame, rawActor: string,
  rawOperationId: string, rawFingerprint: string, rawCommand: CycleSendCommand | null = null): Promise<CycleSendResult> {
  try {
    const frame = parseCycleSendFrame(rawFrame), actorId = uuid(rawActor), operationId = uuid(rawOperationId), expectedFingerprint = hash(rawFingerprint);
    if (operationId === frame.intentId) fail();
    const original = rawCommand === null ? null : parseCycleSendCommand(rawCommand, frame);
    if (original && original.operationId !== operationId) fail();
    const r = exact(snapshot(raw), ["protocol", "siteId", "actorId", "readAt", "data", "receipt"]), readAt = instant(r.readAt);
    if (r.protocol !== CYCLE_INTENT_PROTOCOL || r.siteId !== frame.siteId || r.actorId !== actorId) fail();
    const common: Common = { protocol: CYCLE_INTENT_PROTOCOL, siteId: frame.siteId, actorId, readAt };
    if (r.receipt === null) {
      const d = exact(r.data, ["kind"]); if (d.kind !== "receipt" || original !== null) fail();
      return freeze({ ...common, data: { kind: "receipt" }, receipt: null });
    }
    const d = exact(r.data, ["kind", "periodOperation"]), e = exact(d.periodOperation, ["operationId", "revision", "action", "version", "actorId", "reason", "recordedAt", "command"]);
    const command = parseCycleSendCommand(e.command, frame), recordedAt = instant(e.recordedAt);
    if (d.kind !== "linked" || e.operationId !== operationId || command.operationId !== operationId || e.actorId !== actorId
      || e.action !== "send" || e.revision !== 1 || e.version !== 1 || e.reason !== command.reason || recordedAt > readAt
      || original !== null && !equal(command, original)) fail();
    const receipt = exact(r.receipt, ["operationId", "intentId", "action", "actorId", "revision", "recordedAt", "commandFingerprint", "periodId", "sendOperationId"]);
    if (receipt.operationId !== operationId || receipt.intentId !== frame.intentId || receipt.action !== "link" || receipt.actorId !== actorId || receipt.revision !== 2
      || receipt.periodId !== frame.periodId || receipt.sendOperationId !== operationId || receipt.recordedAt !== recordedAt
      || receipt.commandFingerprint !== expectedFingerprint || await cycleSendCommandFingerprint(frame, command, actorId) !== expectedFingerprint) fail();
    const periodOperation: CycleSendPeriodEntry = { operationId, revision: 1, action: "send", version: 1, actorId, reason: command.reason, recordedAt, command };
    return freeze({ ...common, data: { kind: "linked", periodOperation }, receipt: { operationId, intentId: frame.intentId, action: "link", actorId,
      revision: 2, recordedAt, commandFingerprint: expectedFingerprint, periodId: frame.periodId, sendOperationId: operationId } });
  } catch { return fail(); }
}
export async function parseCycleSendResponse(raw: unknown, frame: CycleSendFrame, actor: string, operationId: string,
  fingerprint: string, command: CycleSendCommand | null = null) {
  const r = exact(snapshot(raw), ["ok", "moduleEnabled", "data"]); if (r.ok !== true || typeof r.moduleEnabled !== "boolean") fail();
  const result = await parseCycleSendResult(r.data, frame, actor, operationId, fingerprint, command);
  return freeze({ ok: true as const, moduleEnabled: r.moduleEnabled, data: result });
}
