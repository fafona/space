//201 bounded reminder wire only. Neither an Auth body nor a navigation target
//confers recipient/owner/system authority; SQL proves those under real locks.
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { captureBrowserExact as exact, parseCaptureBrowserJson } from "./merchantAttendanceRuleCapturesBrowser";
import { operationalRuleLedgerEncode as encode, operationalRuleLedgerFreeze as freeze } from "./merchantAttendanceOperationalRuleLedger";

export const ATTENDANCE_REMINDERS_PROTOCOL = "attendance-reminders-v1" as const;
export const ATTENDANCE_REMINDER_REQUEST_BYTES = 8192;
export const ATTENDANCE_REMINDER_RESULT_BYTES = 131072;
export const ATTENDANCE_REMINDER_PAGE_SIZE = 25;
export type AttendanceReminderListCursor = Readonly<{ beforeAt: string; beforeId: string }>;
export type AttendanceReminderRunCursor = Readonly<{ runOperationId: string; afterDueAt: string; afterPlanId: string; cutoffAt: string }>;
type QueryBase = Readonly<{ siteId: string }>;
export type AttendanceReminderQuery = QueryBase & Readonly<
  { mode: "list"; batchId: null; operationId: null; cursor: AttendanceReminderListCursor | null }
  | { mode: "detail"; batchId: string; operationId: null; cursor: null }
  | { mode: "recover"; batchId: null; operationId: string; cursor: null }
  | { mode: "check"; batchId: null; operationId: null; cursor: null }
>;
export type AttendanceReminderCommand = Readonly<
  { action: "mark_read"; operationId: string; batchId: string }
  | { action: "run_due"; operationId: string; cursor: AttendanceReminderRunCursor | null }
>;
export type AttendanceReminderBody = Readonly<{ query: Extract<AttendanceReminderQuery, { mode: "detail" | "check" }>; command: AttendanceReminderCommand }>;
export type AttendanceReminderSystemQuery = QueryBase & Readonly<
  { mode: "run"; operationId: string; cursor: AttendanceReminderRunCursor | null }
  | { mode: "recover"; operationId: string; cursor: null }
>;
export type AttendanceReminderSystemRunQuery = Extract<AttendanceReminderSystemQuery, { mode: "run" }>;
export type AttendanceReminderCategory = "open_session" | "pending_review" | "period_due";
export type AttendanceReminderReviewFamily = "correction" | "correction_revision" | "missing" | "missing_revision" | "leave" | "work_arrangement";
export type AttendanceReminderTarget = Readonly<
  { kind: "open_session"; workerId: string; startEventId: string }
  | { kind: "pending_review"; family: AttendanceReminderReviewFamily; requestId: string; responsibilityRevision: number; responsibilityOperationId: string }
  | { kind: "period_due"; workerId: string; intentId: string }
>;
export type AttendanceReminderSummary = Readonly<{ batchId: string; category: AttendanceReminderCategory; windowStart: string; windowEnd: string; recordedAt: string; itemCount: number; readAt: string | null }>;
export type AttendanceReminderItem = Readonly<{ planId: string; ordinal: number; target: AttendanceReminderTarget; observedAt: string }>;
export type AttendanceReminderBatch = AttendanceReminderSummary & Readonly<{ items: readonly AttendanceReminderItem[] }>;
export type AttendanceReminderRunResult = Readonly<{ kind: "run"; status: "completed" | "disabled"; checkedCount: number; deliveredCount: number; deferredCount: number; stoppedCount: number; batchIds: readonly string[]; nextCursor: AttendanceReminderRunCursor | null }>;
export type AttendanceReminderMarkResult = Readonly<{ kind: "mark_read"; batchId: string; readAt: string }>;
export type AttendanceReminderReceipt = Readonly<{ operationId: string; action: "run_due" | "mark_read"; actorKind: "auth" | "system"; actorId: string | null; commandFingerprint: string; recordedAt: string; result: AttendanceReminderRunResult | AttendanceReminderMarkResult }>;
export type AttendanceReminderActor = Readonly<{ kind: "auth"; authUserId: string } | { kind: "system" }>;
export type AttendanceReminderData = Readonly<
  { kind: "list"; items: readonly AttendanceReminderSummary[]; nextCursor: AttendanceReminderListCursor | null }
  | { kind: "batch"; batch: AttendanceReminderBatch }
  | { kind: "receipt" }
>;
export type AttendanceReminderResult = Readonly<{ protocol: typeof ATTENDANCE_REMINDERS_PROTOCOL; siteId: string; actor: AttendanceReminderActor; readAt: string; data: AttendanceReminderData; receipt: AttendanceReminderReceipt | null }>;

function fail(code = "attendance_invalid_request"): never { throw new MerchantAttendanceError(code); }
const uuid = (v: unknown): string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v) ? v : fail();
const site = (v: unknown): string => typeof v === "string" && /^[0-9]{8}$/.test(v) ? v : fail();
const integer = (v: unknown, minimum: number, maximum: number): number => typeof v === "number" && Number.isSafeInteger(v) && !Object.is(v, -0) && v >= minimum && v <= maximum ? v : fail();
function unicode(v: string): void {
  if (/[\u0000-\u001f\u007f-\u009f]/.test(v)) fail();
  for (let i = 0; i < v.length; i++) {
    const u = v.charCodeAt(i); if (u >= 0xd800 && u <= 0xdbff) { const n = v.charCodeAt(++i); if (!(n >= 0xdc00 && n <= 0xdfff)) fail(); }
    else if (u >= 0xdc00 && u <= 0xdfff) fail();
  }
}
/** Validate descriptors before accessing any application field or serializing. */
export function assertAttendanceReminderTree(raw: unknown, purpose: "request" | "response" = "response"): void {
  const cap = purpose === "request" ? ATTENDANCE_REMINDER_REQUEST_BYTES : ATTENDANCE_REMINDER_RESULT_BYTES;
  let nodes = 0; const seen = new Set<object>();
  const visit = (v: unknown, depth: number): void => {
    if (++nodes > 4096 || depth > 12) fail();
    if (v === null || typeof v === "boolean") return;
    if (typeof v === "string") { if (v.length > cap) fail(); unicode(v); return; }
    if (typeof v === "number") { integer(v, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER); return; }
    if (!v || typeof v !== "object" || seen.has(v)) return fail(); seen.add(v);
    const descriptors = Object.getOwnPropertyDescriptors(v), keys = Reflect.ownKeys(v), prototype = Object.getPrototypeOf(v);
    if (Array.isArray(v)) {
      if (prototype !== Array.prototype || v.length > ATTENDANCE_REMINDER_PAGE_SIZE || keys.length !== v.length + 1) fail();
      for (let i = 0; i < v.length; i++) { const d = descriptors[String(i)]; if (!d || !d.enumerable || !("value" in d)) fail(); visit(d.value, depth + 1); }
    } else {
      if (prototype !== Object.prototype && prototype !== null) fail();
      for (const key of keys) { if (typeof key !== "string" || ["__proto__", "constructor", "prototype"].includes(key)) return fail();
        unicode(key); const d = descriptors[key]; if (!d.enumerable || !("value" in d)) fail(); visit(d.value, depth + 1); }
    }
    seen.delete(v);
  };
  visit(raw, 0); if (new TextEncoder().encode(JSON.stringify(raw)).byteLength > cap) fail();
}
export function parseAttendanceReminderJson(text: string, purpose: "request" | "response" = "request"): unknown {
  try {
    const cap = purpose === "request" ? ATTENDANCE_REMINDER_REQUEST_BYTES : ATTENDANCE_REMINDER_RESULT_BYTES;
    if (typeof text !== "string" || text.length > cap || new TextEncoder().encode(text).byteLength > cap) fail();
    const raw = parseCaptureBrowserJson(text); assertAttendanceReminderTree(raw, purpose); return raw;
  } catch { return fail(purpose === "request" ? "attendance_invalid_request" : "attendance_reminder_invalid"); }
}
export function attendanceReminderStamp(raw: unknown): string {
  if (typeof raw !== "string" || !/^(?!0000)\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(raw)) return fail();
  const ms = raw.slice(0, 23) + "Z", number = Date.parse(ms);
  return Number.isFinite(number) && new Date(number).toISOString() === ms ? raw : fail();
}
function listCursor(raw: unknown): AttendanceReminderListCursor | null {
  if (raw === null) return null; const v = exact(raw, ["beforeAt", "beforeId"]);
  return { beforeAt: attendanceReminderStamp(v.beforeAt), beforeId: uuid(v.beforeId) };
}
function runCursor(raw: unknown): AttendanceReminderRunCursor | null {
  if (raw === null) return null; const v = exact(raw, ["runOperationId", "afterDueAt", "afterPlanId", "cutoffAt"]);
  const afterDueAt = attendanceReminderStamp(v.afterDueAt), cutoffAt = attendanceReminderStamp(v.cutoffAt);
  if (afterDueAt > cutoffAt) fail(); return { runOperationId: uuid(v.runOperationId), afterDueAt, afterPlanId: uuid(v.afterPlanId), cutoffAt };
}
export function parseAttendanceReminderQuery(raw: unknown): AttendanceReminderQuery {
  try {
    assertAttendanceReminderTree(raw, "request"); const v = exact(raw, ["siteId", "mode", "batchId", "operationId", "cursor"]), siteId = site(v.siteId);
    if (v.mode === "list" && v.batchId === null && v.operationId === null) return freeze({ siteId, mode: "list", batchId: null, operationId: null, cursor: listCursor(v.cursor) });
    if (v.mode === "detail" && v.operationId === null && v.cursor === null) return freeze({ siteId, mode: "detail", batchId: uuid(v.batchId), operationId: null, cursor: null });
    if (v.mode === "recover" && v.batchId === null && v.cursor === null) return freeze({ siteId, mode: "recover", batchId: null, operationId: uuid(v.operationId), cursor: null });
    if (v.mode === "check" && v.batchId === null && v.operationId === null && v.cursor === null) return freeze({ siteId, mode: "check", batchId: null, operationId: null, cursor: null });
    return fail();
  } catch { return fail(); }
}
export function parseAttendanceReminderCommand(raw: unknown): AttendanceReminderCommand {
  try {
    assertAttendanceReminderTree(raw, "request"); const action = Object.getOwnPropertyDescriptor(raw, "action")?.value;
    if (action === "mark_read") { const v = exact(raw, ["action", "operationId", "batchId"]); return freeze({ action, operationId: uuid(v.operationId), batchId: uuid(v.batchId) }); }
    if (action === "run_due") { const v = exact(raw, ["action", "operationId", "cursor"]); return freeze({ action, operationId: uuid(v.operationId), cursor: runCursor(v.cursor) }); }
    return fail();
  } catch { return fail(); }
}
function bindCommand(q: AttendanceReminderQuery, c: AttendanceReminderCommand): void {
  if (q.mode === "recover" ? q.operationId !== c.operationId : q.mode === "detail" ? c.action !== "mark_read" || q.batchId !== c.batchId : q.mode !== "check" || c.action !== "run_due") fail();
}
export function parseAttendanceReminderBody(raw: unknown): AttendanceReminderBody {
  try {
    assertAttendanceReminderTree(raw, "request"); const v = exact(raw, ["query", "command"]), query = parseAttendanceReminderQuery(v.query), command = parseAttendanceReminderCommand(v.command);
    if (query.mode !== "detail" && query.mode !== "check") fail(); bindCommand(query, command); return freeze({ query, command });
  } catch { return fail(); }
}
/** A server/scheduler entry point, never an alternative Auth body variant. */
export function parseAttendanceReminderSystemQuery(raw: unknown): AttendanceReminderSystemQuery {
  try {
    assertAttendanceReminderTree(raw, "request"); const v = exact(raw, ["siteId", "mode", "operationId", "cursor"]), siteId = site(v.siteId), operationId = uuid(v.operationId);
    if (v.mode === "run") return freeze({ siteId, mode: "run", operationId, cursor: runCursor(v.cursor) });
    if (v.mode === "recover" && v.cursor === null) return freeze({ siteId, mode: "recover", operationId, cursor: null }); return fail();
  } catch { return fail(); }
}
function commandTuple(command: AttendanceReminderCommand) {
  return command.action === "mark_read" ? [command.action, command.operationId, command.batchId] : [command.action, command.operationId,
    command.cursor === null ? null : [command.cursor.runOperationId, command.cursor.afterDueAt, command.cursor.afterPlanId, command.cursor.cutoffAt]];
}
export function attendanceReminderCommandFingerprintText(query: AttendanceReminderQuery, actorId: string, command: AttendanceReminderCommand): string {
  const q = parseAttendanceReminderQuery(query), c = parseAttendanceReminderCommand(command); bindCommand(q, c);
  return encode(["attendance-reminder-command-v1", q.siteId, "auth", uuid(actorId), commandTuple(c)]);
}
async function sha(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(v => v.toString(16).padStart(2, "0")).join("");
}
export function attendanceReminderCommandFingerprint(query: AttendanceReminderQuery, actorId: string, command: AttendanceReminderCommand): Promise<string> {
  return sha(attendanceReminderCommandFingerprintText(query, actorId, command));
}
export function attendanceReminderSystemCommandFingerprintText(query: AttendanceReminderSystemRunQuery): string {
  const q = parseAttendanceReminderSystemQuery(query); if (q.mode !== "run") return fail();
  return encode(["attendance-reminder-command-v1", q.siteId, "system", null, commandTuple({ action: "run_due", operationId: q.operationId, cursor: q.cursor })]);
}
export function attendanceReminderSystemCommandFingerprint(query: AttendanceReminderSystemRunQuery): Promise<string> { return sha(attendanceReminderSystemCommandFingerprintText(query)); }
function category(raw: unknown): AttendanceReminderCategory { return raw === "open_session" || raw === "pending_review" || raw === "period_due" ? raw : fail(); }
function target(raw: unknown, selected: AttendanceReminderCategory): AttendanceReminderTarget {
  if (selected === "open_session") { const v = exact(raw, ["kind", "workerId", "startEventId"]); if (v.kind !== selected) fail(); return { kind: selected, workerId: uuid(v.workerId), startEventId: uuid(v.startEventId) }; }
  if (selected === "period_due") { const v = exact(raw, ["kind", "workerId", "intentId"]); if (v.kind !== selected) fail(); return { kind: selected, workerId: uuid(v.workerId), intentId: uuid(v.intentId) }; }
  const v = exact(raw, ["kind", "family", "requestId", "responsibilityRevision", "responsibilityOperationId"]);
  if (v.kind !== selected || v.family !== "correction" && v.family !== "correction_revision" && v.family !== "missing" && v.family !== "missing_revision" && v.family !== "leave" && v.family !== "work_arrangement") fail();
  return { kind: selected, family: v.family, requestId: uuid(v.requestId), responsibilityRevision: integer(v.responsibilityRevision, 1, 9007199254740990), responsibilityOperationId: uuid(v.responsibilityOperationId) };
}
const summaryKeys = ["batchId", "category", "windowStart", "windowEnd", "recordedAt", "itemCount", "readAt"];
function summary(v: Record<string, unknown>, readAt: string): AttendanceReminderSummary {
  const windowStart = attendanceReminderStamp(v.windowStart), windowEnd = attendanceReminderStamp(v.windowEnd), recordedAt = attendanceReminderStamp(v.recordedAt);
  const read = v.readAt === null ? null : attendanceReminderStamp(v.readAt);
  if (!/:00:00\.000000Z$/.test(windowStart) || Date.parse(windowEnd.slice(0, 23) + "Z") - Date.parse(windowStart.slice(0, 23) + "Z") !== 3600000
    || !/:00:00\.000000Z$/.test(windowEnd) || recordedAt < windowStart || recordedAt >= windowEnd || recordedAt > readAt || read !== null && (read < recordedAt || read > readAt)) fail();
  return { batchId: uuid(v.batchId), category: category(v.category), windowStart, windowEnd, recordedAt, itemCount: integer(v.itemCount, 1, 25), readAt: read };
}
function batch(raw: unknown, readAt: string): AttendanceReminderBatch {
  const v = exact(raw, [...summaryKeys, "items"]), base = summary(v, readAt); if (!Array.isArray(v.items) || v.items.length !== base.itemCount) fail();
  const rawItems: unknown[] = v.items;
  let previous = ""; const items = rawItems.map((rawItem): AttendanceReminderItem => {
    const value = exact(rawItem, ["planId", "ordinal", "target", "observedAt"]), planId = uuid(value.planId), observedAt = attendanceReminderStamp(value.observedAt);
    if (planId <= previous || observedAt !== base.recordedAt) fail(); previous = planId;
    return { planId, ordinal: integer(value.ordinal, 1, 10), target: target(value.target, base.category), observedAt };
  });
  return { ...base, items };
}
function runResult(raw: unknown, recordedAt: string, operationId: string): AttendanceReminderRunResult {
  const v = exact(raw, ["kind", "status", "checkedCount", "deliveredCount", "deferredCount", "stoppedCount", "batchIds", "nextCursor"]);
  if (v.kind !== "run" || v.status !== "completed" && v.status !== "disabled" || !Array.isArray(v.batchIds)) return fail();
  const checkedCount = integer(v.checkedCount, 0, 25), deliveredCount = integer(v.deliveredCount, 0, 25), deferredCount = integer(v.deferredCount, 0, 25), stoppedCount = integer(v.stoppedCount, 0, 25);
  const batchIds = v.batchIds.map(uuid), nextCursor = runCursor(v.nextCursor);
  if (new Set(batchIds).size !== batchIds.length || batchIds.length > deliveredCount || deliveredCount + deferredCount + stoppedCount > checkedCount
    || nextCursor !== null && (checkedCount !== 25 || nextCursor.runOperationId !== operationId || nextCursor.cutoffAt > recordedAt)
    || v.status === "disabled" && (checkedCount !== 0 || batchIds.length !== 0 || nextCursor !== null)) fail();
  return { kind: "run", status: v.status, checkedCount, deliveredCount, deferredCount, stoppedCount, batchIds, nextCursor };
}
function receipt(raw: unknown, actor: AttendanceReminderActor, readAt: string, operationId: string | null): AttendanceReminderReceipt {
  const v = exact(raw, ["operationId", "action", "actorKind", "actorId", "commandFingerprint", "recordedAt", "result"]), recordedAt = attendanceReminderStamp(v.recordedAt), id = uuid(v.operationId);
  if (operationId !== null && id !== operationId || recordedAt > readAt || v.actorKind !== actor.kind || v.actorId !== (actor.kind === "auth" ? actor.authUserId : null)
    || typeof v.commandFingerprint !== "string" || !/^[0-9a-f]{64}$/.test(v.commandFingerprint)) fail();
  if (v.action === "run_due") return { operationId: id, action: v.action, actorKind: actor.kind, actorId: actor.kind === "auth" ? actor.authUserId : null, commandFingerprint: v.commandFingerprint, recordedAt, result: runResult(v.result, recordedAt, id) };
  if (v.action !== "mark_read" || actor.kind !== "auth") return fail(); const m = exact(v.result, ["kind", "batchId", "readAt"]), markedAt = attendanceReminderStamp(m.readAt);
  if (m.kind !== "mark_read" || markedAt > recordedAt) fail();
  return { operationId: id, action: v.action, actorKind: "auth", actorId: actor.authUserId, commandFingerprint: v.commandFingerprint, recordedAt, result: { kind: "mark_read", batchId: uuid(m.batchId), readAt: markedAt } };
}
function runProgress(r: AttendanceReminderReceipt, command: Extract<AttendanceReminderCommand, { action: "run_due" }>): void {
  if (r.result.kind !== "run") fail(); const prior = command.cursor, next = r.result.nextCursor;
  if (prior && (prior.cutoffAt > r.recordedAt || next && (next.cutoffAt !== prior.cutoffAt || next.afterDueAt < prior.afterDueAt
    || next.afterDueAt === prior.afterDueAt && next.afterPlanId <= prior.afterPlanId))) fail();
}
function envelope(raw: unknown, siteId: string, actor: AttendanceReminderActor) {
  assertAttendanceReminderTree(raw); const v = exact(raw, ["protocol", "siteId", "actor", "readAt", "data", "receipt"]);
  if (v.protocol !== ATTENDANCE_REMINDERS_PROTOCOL || v.siteId !== siteId) fail();
  const a = exact(v.actor, actor.kind === "auth" ? ["kind", "authUserId"] : ["kind"]);
  if (a.kind !== actor.kind || actor.kind === "auth" && a.authUserId !== actor.authUserId) fail();
  return { v, base: { protocol: ATTENDANCE_REMINDERS_PROTOCOL, siteId, actor, readAt: attendanceReminderStamp(v.readAt) } };
}
/** With expectedCommand, a recovered receipt may clear that exact pending intent.
 * Without it, recovery is only a typed original-actor receipt, not SHA approval. */
export async function parseAttendanceReminderResult(raw: unknown, query: AttendanceReminderQuery, actorId: string, expectedCommand: AttendanceReminderCommand | null = null): Promise<AttendanceReminderResult> {
  try {
    const q = parseAttendanceReminderQuery(query), actor: AttendanceReminderActor = { kind: "auth", authUserId: uuid(actorId) }, command = expectedCommand === null ? null : parseAttendanceReminderCommand(expectedCommand);
    if (command) bindCommand(q, command); const { v, base } = envelope(raw, q.siteId, actor);
    if (q.mode === "recover" || q.mode === "check" || command !== null) {
      const d = exact(v.data, ["kind"]); if (d.kind !== "receipt") fail();
      const r = v.receipt === null ? null : receipt(v.receipt, actor, base.readAt, q.mode === "recover" ? q.operationId : command?.operationId ?? null);
      if (q.mode === "check" && command === null && r !== null || command !== null && r === null && q.mode !== "recover") fail();
      if (command !== null && r !== null && (r.action !== command.action
        || r.commandFingerprint !== await attendanceReminderCommandFingerprint(q, actor.authUserId, command)
        || command.action === "mark_read" && (r.result.kind !== "mark_read" || r.result.batchId !== command.batchId))) fail();
      if (command?.action === "run_due" && r !== null) runProgress(r, command);
      return freeze({ ...base, data: { kind: "receipt" }, receipt: r });
    }
    if (v.receipt !== null) fail();
    if (q.mode === "detail") {
      const d = exact(v.data, ["kind", "batch"]); if (d.kind !== "batch") fail(); const b = batch(d.batch, base.readAt); if (b.batchId !== q.batchId) fail();
      return freeze({ ...base, data: { kind: "batch", batch: b }, receipt: null });
    }
    const d = exact(v.data, ["kind", "items", "nextCursor"]); if (d.kind !== "list" || !Array.isArray(d.items)) fail();
    const rawItems: unknown[] = d.items;
    let previous = q.cursor; const seen = new Set<string>(); const items = rawItems.map((entry): AttendanceReminderSummary => {
      const item = summary(exact(entry, summaryKeys), base.readAt);
      if (seen.has(item.batchId) || previous && (item.recordedAt > previous.beforeAt || item.recordedAt === previous.beforeAt && item.batchId >= previous.beforeId)) fail();
      seen.add(item.batchId); previous = { beforeAt: item.recordedAt, beforeId: item.batchId }; return item;
    });
    const nextCursor = listCursor(d.nextCursor), last = items.at(-1);
    if (q.cursor && q.cursor.beforeAt > base.readAt || nextCursor && (items.length !== 25 || nextCursor.beforeAt !== last?.recordedAt || nextCursor.beforeId !== last?.batchId)) fail();
    return freeze({ ...base, data: { kind: "list", items, nextCursor }, receipt: null });
  } catch { return fail("attendance_reminder_invalid"); }
}
/** Trusted adapter only: the system domain is literal, never an input actor. */
export async function parseAttendanceReminderSystemResult(raw: unknown, query: AttendanceReminderSystemQuery, originalRun: AttendanceReminderSystemRunQuery | null = null): Promise<AttendanceReminderResult> {
  try {
    const q = parseAttendanceReminderSystemQuery(query), original = originalRun === null ? null : parseAttendanceReminderSystemQuery(originalRun);
    if (original !== null && (original.mode !== "run" || original.siteId !== q.siteId || original.operationId !== q.operationId) || q.mode === "run" && original !== null) fail();
    const { v, base } = envelope(raw, q.siteId, { kind: "system" }), d = exact(v.data, ["kind"]); if (d.kind !== "receipt") fail();
    const r = v.receipt === null ? null : receipt(v.receipt, base.actor, base.readAt, q.operationId), expected = q.mode === "run" ? q : original;
    if (r && r.action !== "run_due" || expected !== null && r === null && q.mode !== "recover") fail();
    if (r && expected !== null && (expected.mode !== "run" || r.commandFingerprint !== await attendanceReminderSystemCommandFingerprint(expected))) fail();
    if (r && expected?.mode === "run") runProgress(r, { action: "run_due", operationId: expected.operationId, cursor: expected.cursor });
    return freeze({ ...base, data: { kind: "receipt" }, receipt: r });
  } catch { return fail("attendance_reminder_invalid"); }
}
