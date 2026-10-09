import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { bool, enumValue, exact, freeze, hash, integer, label, micros, optionalUuid, safeTree, site, stamp, uuid } from "./merchantAttendancePlanExceptionValidation";
import { parseOutageInterval } from "./merchantAttendanceOutageTime";
import { OUTAGE_CHANNELS, OUTAGE_TYPES, type OutageCommand, type OutageQuery, type OutageRecord, type OutageReceipt, type OutageResult } from "./merchantAttendanceOutageContract";

export const OUTAGE_ERRORS: Readonly<Record<string, number>> = Object.freeze({
  attendance_invalid_request: 400, attendance_access_denied: 403, attendance_not_available: 404,
  attendance_worker_not_found: 404, attendance_settings_required: 409, attendance_unavailable: 503,
  attendance_version_conflict: 409, attendance_operation_conflict: 409, attendance_platform_paused: 403,
  attendance_worker_changed: 409, attendance_module_disabled: 403, attendance_outage_disabled: 403,
  attendance_outage_not_found: 404, attendance_outage_invalid: 503, attendance_outage_limit: 422,
  attendance_outage_changed: 409, attendance_outage_too_large: 422, attendance_account_suspended: 403,
});
const fail = (code = "attendance_outage_invalid"): never => { throw new MerchantAttendanceError(code); };
const optionalText = (v: unknown, max: number) => v === null ? null : label(v, max);
function original(raw: Record<string, unknown>) {
  const originalOperationId = optionalUuid(raw.originalOperationId);
  const originalChannel = raw.originalChannel === null ? null : enumValue(raw.originalChannel, OUTAGE_CHANNELS);
  if ((originalOperationId === null) !== (originalChannel === null)) fail();
  return { originalOperationId, originalChannel, paperReference: optionalText(raw.paperReference, 120) };
}

export function parseOutageQuery(raw: unknown): OutageQuery {
  try {
    safeTree(raw, 2048);
    const mode = enumValue((raw as { mode?: unknown } | null)?.mode, ["incidents", "declarations", "incident", "declaration", "recover"] as const);
    const fields = mode === "incidents" ? ["afterId"] : mode === "declarations" ? ["incidentId", "afterId"]
      : mode === "incident" ? ["incidentId"] : mode === "declaration" ? ["declarationId"] : ["operationId"];
    const q = exact(raw, ["siteId", "access", "mode", ...fields]);
    const scope = { siteId: site(q.siteId), access: enumValue(q.access, ["owner", "self"] as const) };
    if (mode === "incidents") { if (scope.access !== "owner") return fail(); return { ...scope, mode, afterId: optionalUuid(q.afterId) }; }
    if (mode === "declarations") return { ...scope, mode, incidentId: uuid(q.incidentId), afterId: optionalUuid(q.afterId) };
    if (mode === "incident") return { ...scope, mode, incidentId: uuid(q.incidentId) };
    if (mode === "declaration") return { ...scope, mode, declarationId: uuid(q.declarationId) };
    return { ...scope, mode, operationId: uuid(q.operationId) };
  } catch { return fail("attendance_invalid_request"); }
}

export function parseOutageCommand(raw: unknown): OutageCommand {
  try {
    safeTree(raw, 16384);
    const action = enumValue((raw as { action?: unknown } | null)?.action, ["create_incident", "declare"] as const);
    if (action === "create_incident") {
      const c = exact(raw, ["action", "operationId", "incidentId", "type", "channel", "locationId", "interval", "reason"]);
      return { action, operationId: uuid(c.operationId), incidentId: uuid(c.incidentId), type: enumValue(c.type, OUTAGE_TYPES), channel: enumValue(c.channel, OUTAGE_CHANNELS),
        locationId: optionalUuid(c.locationId), interval: parseOutageInterval(c.interval, false), reason: label(c.reason, 1000) };
    }
    const c = exact(raw, ["action", "operationId", "declarationId", "incidentId", "workerId", "employeeId", "employeeAuthUserId", "expectedWorkerVersion", "expectedEmployeeVersion", "expectedGeneration", "interval", "statement", "originalOperationId", "originalChannel", "paperReference"]);
    return { action, operationId: uuid(c.operationId), declarationId: uuid(c.declarationId), incidentId: uuid(c.incidentId), workerId: uuid(c.workerId), employeeId: uuid(c.employeeId), employeeAuthUserId: uuid(c.employeeAuthUserId),
      expectedWorkerVersion: integer(c.expectedWorkerVersion), expectedEmployeeVersion: integer(c.expectedEmployeeVersion), expectedGeneration: integer(c.expectedGeneration, 0),
      interval: parseOutageInterval(c.interval, false), statement: label(c.statement, 1000), ...original(c) };
  } catch { return fail("attendance_invalid_request"); }
}

export function assertOutageWriteQuery(query: OutageQuery, command: OutageCommand, actorId: string): void {
  if (command.action === "create_incident") {
    if (query.access !== "owner" || query.mode !== "incident" || query.incidentId !== command.incidentId) fail("attendance_invalid_request");
  } else if (query.mode !== "declaration" || query.declarationId !== command.declarationId
    || query.access === "self" && command.employeeAuthUserId !== actorId) fail("attendance_invalid_request");
}

// Scalar tuple is shared with SQL. JSON object key order is deliberately absent.
export function outageCommandFingerprintText(query: OutageQuery, command: OutageCommand): string {
  const q = parseOutageQuery(query), c = parseOutageCommand(command);
  const i = c.interval, span = [i.startAt, i.endAt, i.timeZone, i.startOffsetMinutes, i.endOffsetMinutes];
  return JSON.stringify(c.action === "create_incident"
    ? [q.siteId, q.access, c.action, c.operationId, c.incidentId, c.type, c.channel, c.locationId, ...span, c.reason]
    : [q.siteId, q.access, c.action, c.operationId, c.declarationId, c.incidentId, c.workerId, c.employeeId, c.employeeAuthUserId,
      c.expectedWorkerVersion, c.expectedEmployeeVersion, c.expectedGeneration, ...span, c.statement, c.originalOperationId, c.originalChannel, c.paperReference]);
}

function record(raw: unknown, readAt: string): OutageRecord {
  const kind = (raw as { kind?: unknown } | null)?.kind;
  if (kind === "incident") {
    const r = exact(raw, ["kind", "id", "operationId", "type", "channel", "locationId", "interval", "reason", "actorId", "recordedAt"]);
    const result: OutageRecord = { kind, id: uuid(r.id), operationId: uuid(r.operationId), type: enumValue(r.type, OUTAGE_TYPES), channel: enumValue(r.channel, OUTAGE_CHANNELS),
      locationId: optionalUuid(r.locationId), interval: parseOutageInterval(r.interval, false), reason: label(r.reason, 1000), actorId: uuid(r.actorId), recordedAt: stamp(r.recordedAt) };
    if (micros(result.interval.endAt) > micros(result.recordedAt) || micros(result.recordedAt) > micros(readAt)) fail();
    return result;
  }
  const r = exact(raw, ["kind", "id", "operationId", "incidentId", "workerId", "employeeId", "employeeAuthUserId", "workerVersion", "employeeVersion", "generation", "interval", "statement", "originalOperationId", "originalChannel", "paperReference", "recordedBy", "actorId", "actorEmployeeId", "recordedAt"]);
  if (kind !== "declaration") return fail();
  const result: OutageRecord = { kind, id: uuid(r.id), operationId: uuid(r.operationId), incidentId: uuid(r.incidentId), workerId: uuid(r.workerId), employeeId: uuid(r.employeeId), employeeAuthUserId: uuid(r.employeeAuthUserId),
    workerVersion: integer(r.workerVersion), employeeVersion: integer(r.employeeVersion), generation: integer(r.generation, 0), interval: parseOutageInterval(r.interval, false), statement: label(r.statement, 1000), ...original(r),
    recordedBy: enumValue(r.recordedBy, ["owner", "self"] as const), actorId: uuid(r.actorId), actorEmployeeId: optionalUuid(r.actorEmployeeId), recordedAt: stamp(r.recordedAt) };
  if (result.recordedBy === "self" ? result.actorId !== result.employeeAuthUserId || result.actorEmployeeId !== result.employeeId
    : result.actorEmployeeId !== null) fail();
  if (micros(result.interval.endAt) > micros(result.recordedAt) || micros(result.recordedAt) > micros(readAt)) fail();
  return result;
}

// Structural/identity validator. The service projection also verifies the
// command hash before acknowledging any POST; history is not freshly re-timed.
export function parseOutageResult(raw: unknown, query: OutageQuery, actorId: string, command: OutageCommand | null = null): OutageResult {
  try {
    safeTree(raw, 262144);
    const q = parseOutageQuery(query), actor = uuid(actorId), c = command === null ? null : parseOutageCommand(command);
    if (c) assertOutageWriteQuery(q, c, actor);
    const v = exact(JSON.parse(JSON.stringify(raw)), ["protocol", "siteId", "access", "mode", "actorId", "readAt", "canWrite", "items", "detail", "receipt", "nextId"]);
    if (v.protocol !== "attendance-outage-v1" || v.siteId !== q.siteId || v.access !== q.access || v.mode !== q.mode || v.actorId !== actor) fail();
    const readAt = stamp(v.readAt), canWrite = bool(v.canWrite), nextId = optionalUuid(v.nextId);
    if (!Array.isArray(v.items) || v.items.length > 25) return fail();
    const items = v.items.map(i => record(i, readAt)), detail = v.detail === null ? null : record(v.detail, readAt);
    let receipt: OutageReceipt | null = null;
    if (v.receipt !== null) {
      const r = exact(v.receipt, ["operationId", "action", "recordId", "incidentId", "actorId", "commandFingerprint", "recordedAt"]);
      receipt = { operationId: uuid(r.operationId), action: enumValue(r.action, ["create_incident", "declare"] as const), recordId: uuid(r.recordId), incidentId: uuid(r.incidentId), actorId: uuid(r.actorId), commandFingerprint: hash(r.commandFingerprint), recordedAt: stamp(r.recordedAt) };
      if (receipt.actorId !== actor || micros(receipt.recordedAt) > micros(readAt) || receipt.action === "create_incident" && (q.access !== "owner" || receipt.recordId !== receipt.incidentId)) fail();
    }
    if (c || q.mode === "recover") {
      if (!receipt || items.length || detail || nextId || canWrite) return fail();
      if (q.mode === "recover" && receipt.operationId !== q.operationId) fail();
      if (c && (receipt.operationId !== c.operationId || receipt.action !== c.action || receipt.incidentId !== c.incidentId
        || receipt.recordId !== (c.action === "declare" ? c.declarationId : c.incidentId))) fail();
    } else {
      if (receipt) fail();
      if (q.mode === "incidents" || q.mode === "declarations") {
        if (detail || nextId !== null && (items.length !== 25 || nextId !== items.at(-1)?.id)) fail();
        let lastId = q.afterId;
        const operations = new Set<string>();
        for (const item of items) {
          if (q.mode === "incidents" ? item.kind !== "incident" : item.kind !== "declaration" || item.incidentId !== q.incidentId) fail();
          if (lastId !== null && item.id <= lastId || operations.has(item.operationId)) fail();
          lastId = item.id; operations.add(item.operationId);
        }
      } else {
        if (items.length || nextId || !detail) return fail();
        if (q.mode === "incident" ? detail.kind !== "incident" || detail.id !== q.incidentId : detail.kind !== "declaration" || detail.id !== q.declarationId) fail();
      }
      if (q.access === "self") for (const item of [...items, ...(detail ? [detail] : [])]) {
        if (item.kind === "declaration" && item.employeeAuthUserId !== actor) fail();
      }
    }
    return freeze({ protocol: "attendance-outage-v1", siteId: q.siteId, access: q.access, mode: q.mode, actorId: actor, readAt, canWrite, items, detail, receipt, nextId });
  } catch { return fail(); }
}
