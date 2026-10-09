// 200 exact intent request contract only. Parsing/digests grant no authority;
// SQL must verify current send rights, original receipt, source and both CASes.
import { captureBrowserExact, parseCaptureBrowserJson } from "./merchantAttendanceRuleCapturesBrowser";
import { operationalRuleLedgerEncode, operationalRuleLedgerFreeze as freeze } from "./merchantAttendanceOperationalRuleLedger";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
export const CYCLE_INTENT_PROTOCOL = "attendance-operational-cycle-v1" as const;
export const CYCLE_INTENT_API = "/api/merchant-enterprise/attendance/operational-cycle";
export const CYCLE_INTENT_BODY_LIMIT = 8192, CYCLE_INTENT_QUERY_LIMIT = 2048;
export type CycleIntentScope = Readonly<{ siteId: string; access: "owner" | "delegate"; workerId: string; grantId: string | null }>;
export type CycleIntentQuery = CycleIntentScope & Readonly<
  { mode: "prepare"; anchorDate: string } | { mode: "list"; cursor: string | null }
  | { mode: "detail"; intentId: string } | { mode: "recover"; intentId: string; operationId: string }>;
export type CycleIntentAccept = Readonly<{
  action: "accept"; operationId: string; intentId: string; anchorDate: string; fromDate: string; throughDate: string;
  employeeId: string; employeeAuthUserId: string; expectedWorkerVersion: number; expectedEmployeeVersion: number;
  expectedSettingsVersion: number; expectedActivationRevision: number; expectedPreparationFingerprint: string;
  expectedFrameRevision: number; expectedFrameHeadOperationId: string | null; reason: string;
}>;
export type CycleIntentCancel = Readonly<{ action: "cancel"; operationId: string; intentId: string; expectedRevision: 1;
  expectedHeadOperationId: string; expectedIntentFingerprint: string; reason: string }>;
export type CycleIntentCommand = CycleIntentAccept | CycleIntentCancel;
function fail(): never { throw new MerchantAttendanceError("attendance_invalid_request"); }
function exact(raw: unknown, keys: readonly string[]) { try { return captureBrowserExact(raw, keys); } catch { return fail(); } }
const uuid = (raw: unknown): string => typeof raw === "string" && raw.length === 36
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(raw) ? raw : fail();
const hash = (raw: unknown): string => typeof raw === "string" && raw.length === 64 && /^[0-9a-f]{64}$/.test(raw) ? raw : fail();
const integer = (raw: unknown, min: number): number => typeof raw === "number" && Number.isSafeInteger(raw)
  && !Object.is(raw, -0) && raw >= min && raw < 9007199254740990 ? raw : fail();
function date(raw: unknown): string {
  if (typeof raw !== "string" || raw.length !== 10 || !/^\d{4}-\d{2}-\d{2}$/.test(raw) || raw < "2000-01-01" || raw > "2100-12-31") fail();
  const value = Date.parse(raw + "T00:00:00.000Z"); if (!Number.isFinite(value) || new Date(value).toISOString().slice(0, 10) !== raw) fail(); return raw;
}
function reason(raw: unknown): string {
  if (typeof raw !== "string" || !raw || raw !== raw.trim() || [...raw].length > 500 || /[\u0000-\u001f\u007f-\u009f]/.test(raw)) fail();
  for (let n = 0; n < raw.length; n++) { const code = raw.charCodeAt(n); if (code >= 0xd800 && code <= 0xdbff) {
    const next = raw.charCodeAt(++n); if (!(next >= 0xdc00 && next <= 0xdfff)) fail();
  } else if (code >= 0xdc00 && code <= 0xdfff) fail(); } return raw;
}
export function parseCycleIntentQuery(raw: unknown): CycleIntentQuery {
  const mode = raw && typeof raw === "object" ? Object.getOwnPropertyDescriptor(raw, "mode")?.value : null;
  const fields = mode === "prepare" ? ["anchorDate"] : mode === "list" ? ["cursor"] : mode === "detail" ? ["intentId"] : mode === "recover" ? ["intentId", "operationId"] : fail();
  const value = exact(raw, ["siteId", "access", "workerId", "grantId", "mode", ...fields]);
  if (typeof value.siteId !== "string" || value.siteId.length !== 8 || !/^[0-9]{8}$/.test(value.siteId)
    || value.access !== "owner" && value.access !== "delegate") fail();
  const grantId = value.grantId === null ? null : uuid(value.grantId);
  if ((value.access === "owner") !== (grantId === null)) fail();
  const scope: CycleIntentScope = { siteId: value.siteId, access: value.access, workerId: uuid(value.workerId), grantId };
  if (mode === "prepare") return freeze({ ...scope, mode, anchorDate: date(value.anchorDate) });
  if (mode === "list") return freeze({ ...scope, mode, cursor: value.cursor === null ? null : uuid(value.cursor) });
  if (mode === "detail") return freeze({ ...scope, mode, intentId: uuid(value.intentId) });
  return freeze({ ...scope, mode: "recover", intentId: uuid(value.intentId), operationId: uuid(value.operationId) });
}
export function parseCycleIntentCommand(raw: unknown, query: CycleIntentQuery): CycleIntentCommand {
  const q = parseCycleIntentQuery(query); if (q.mode !== "detail") fail();
  const action = raw && typeof raw === "object" ? Object.getOwnPropertyDescriptor(raw, "action")?.value : null;
  if (action === "accept") {
    const value = exact(raw, ["action", "operationId", "intentId", "anchorDate", "fromDate", "throughDate", "employeeId", "employeeAuthUserId",
      "expectedWorkerVersion", "expectedEmployeeVersion", "expectedSettingsVersion", "expectedActivationRevision", "expectedPreparationFingerprint",
      "expectedFrameRevision", "expectedFrameHeadOperationId", "reason"]);
    const operationId = uuid(value.operationId), intentId = uuid(value.intentId), anchorDate = date(value.anchorDate), fromDate = date(value.fromDate), throughDate = date(value.throughDate);
    const civilDays = (Date.parse(throughDate) - Date.parse(fromDate)) / 86400000 + 1;
    const expectedFrameRevision = integer(value.expectedFrameRevision, 0), expectedFrameHeadOperationId = value.expectedFrameHeadOperationId === null ? null : uuid(value.expectedFrameHeadOperationId);
    if (operationId !== intentId || intentId !== q.intentId || anchorDate < fromDate || anchorDate > throughDate || civilDays < 1 || civilDays > 31
      || (expectedFrameRevision === 0) !== (expectedFrameHeadOperationId === null)) fail();
    return freeze({ action, operationId, intentId, anchorDate, fromDate, throughDate, employeeId: uuid(value.employeeId), employeeAuthUserId: uuid(value.employeeAuthUserId),
      expectedWorkerVersion: integer(value.expectedWorkerVersion, 1), expectedEmployeeVersion: integer(value.expectedEmployeeVersion, 1),
      expectedSettingsVersion: integer(value.expectedSettingsVersion, 1), expectedActivationRevision: integer(value.expectedActivationRevision, 1),
      expectedPreparationFingerprint: hash(value.expectedPreparationFingerprint), expectedFrameRevision, expectedFrameHeadOperationId, reason: reason(value.reason) });
  }
  if (action !== "cancel") fail();
  const value = exact(raw, ["action", "operationId", "intentId", "expectedRevision", "expectedHeadOperationId", "expectedIntentFingerprint", "reason"]);
  const intentId = uuid(value.intentId), operationId = uuid(value.operationId), expectedHeadOperationId = uuid(value.expectedHeadOperationId);
  if (value.expectedRevision !== 1 || intentId !== q.intentId || expectedHeadOperationId !== intentId || operationId === intentId) fail();
  return freeze({ action, operationId, intentId, expectedRevision: 1, expectedHeadOperationId, expectedIntentFingerprint: hash(value.expectedIntentFingerprint), reason: reason(value.reason) });
}
export function parseCycleIntentBody(raw: unknown): Readonly<{ query: CycleIntentQuery; command: CycleIntentCommand }> {
  const body = exact(raw, ["query", "command"]), query = parseCycleIntentQuery(body.query); return freeze({ query, command: parseCycleIntentCommand(body.command, query) });
}
export function parseCycleIntentBodyJson(text: string) {
  if (typeof text !== "string" || text.length > CYCLE_INTENT_BODY_LIMIT || new TextEncoder().encode(text).byteLength > CYCLE_INTENT_BODY_LIMIT) fail();
  try { return parseCycleIntentBody(parseCaptureBrowserJson(text)); } catch { return fail(); }
}
export function cycleIntentQueryString(raw: CycleIntentQuery): string {
  const q = parseCycleIntentQuery(raw); return new URLSearchParams(Object.entries(q).map(([key, value]) => [key, value === null ? "null" : String(value)])).toString();
}
export function parseCycleIntentHttpQuery(url: string): CycleIntentQuery {
  try {
    const input = new URL(url); if (input.hash || url.includes("#") || new TextEncoder().encode(input.search).byteLength > CYCLE_INTENT_QUERY_LIMIT) fail();
    const pairs = [...input.searchParams.entries()]; if (new Set(pairs.map(([key]) => key)).size !== pairs.length) fail();
    return parseCycleIntentQuery(Object.fromEntries(pairs.map(([key, value]) => [key, value === "null" ? null : value])));
  } catch { return fail(); }
}
export async function cycleIntentCommandFingerprint(rawQuery: CycleIntentQuery, rawCommand: CycleIntentCommand, rawActor: string): Promise<string> {
  const q = parseCycleIntentQuery(rawQuery), c = parseCycleIntentCommand(rawCommand, q), actor = uuid(rawActor); if (q.mode !== "detail") fail();
  const tuple = c.action === "accept" ? [c.action, c.operationId, c.intentId, c.anchorDate, c.fromDate, c.throughDate, c.employeeId, c.employeeAuthUserId,
    c.expectedWorkerVersion, c.expectedEmployeeVersion, c.expectedSettingsVersion, c.expectedActivationRevision, c.expectedPreparationFingerprint,
    c.expectedFrameRevision, c.expectedFrameHeadOperationId, c.reason]
    : [c.action, c.operationId, c.intentId, c.expectedRevision, c.expectedHeadOperationId, c.expectedIntentFingerprint, c.reason];
  const encoded = operationalRuleLedgerEncode(["attendance-cycle-command-v1", [q.siteId, q.access, q.workerId, q.grantId, q.mode, q.intentId], actor, tuple]);
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(encoded)))].map(byte => byte.toString(16).padStart(2, "0")).join("");
}
