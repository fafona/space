import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { captureBrowserExact, parseCaptureBrowserJson } from "./merchantAttendanceRuleCapturesBrowser";
import { validateApplicationDelegationTree } from "./merchantAttendanceApplicationDelegation";
import { SCHEDULE_ERRORS, type ScheduleCommand, type ScheduleSlot } from "./merchantAttendanceSchedule";

export const SCHEDULE_DELEGATION_API = "/api/merchant-enterprise/attendance/schedule-delegation";
export const SCHEDULE_DELEGATION_BYTE_LIMIT = 131072;
export const SCHEDULE_DELEGATION_BODY_BYTE_LIMIT = 8192;
export type ScheduleDelegationAccess = "owner" | "delegate";
export type ScheduleDelegationAction = "publish" | "cancel";
export type ScheduleDelegationCatalog = "delegates" | "workers" | "locations";
export type ScheduleDelegationQuery = { siteId: string; access: ScheduleDelegationAccess; mode: "list" | "catalog" | "detail" | "grants" | "schedule" | "recover";
  catalog: ScheduleDelegationCatalog | null; grantId: string | null; afterId: string | null; fromDate: string | null; throughDate: string | null; operationId: string | null };
export type ScheduleDelegationGrantCommand = { action: "grant"; operationId: string; delegateEmployeeId: string; delegateAuthUserId: string; workerId: string;
  employeeId: string; employeeAuthUserId: string; locationId: string; actions: ScheduleDelegationAction[]; includeExistingFuture: boolean; validFrom: string; validUntil: string; reason: string };
export type ScheduleDelegationRevokeCommand = { action: "revoke"; operationId: string; grantId: string; expectedRevision: 1; reason: string };
export type ScheduleDelegationDecisionCommand = { expectedGrantRevision: 1; decision: ScheduleCommand };
export type ScheduleDelegationCommand = ScheduleDelegationGrantCommand | ScheduleDelegationRevokeCommand | ScheduleDelegationDecisionCommand;
export type ScheduleDelegationCatalogItem = { id: string; name: string; employeeId: string | null; employeeAuthUserId: string | null; workerNo: string | null; timeZone: string | null };
export type ScheduleDelegationGrant = { grantId: string; revision: 1 | 2; status: "granted" | "revoked";
  delegate: { employeeId: string; authUserId: string; name: string }; worker: { workerId: string; employeeId: string; authUserId: string; name: string; workerNo: string };
  location: { id: string; name: string; timeZone: string }; actions: ScheduleDelegationAction[]; includeExistingFuture: boolean;
  validFrom: string; validUntil: string; grantedBy: string; grantedAt: string; reason: string;
  revocation: null | { operationId: string; actorId: string; reason: string; recordedAt: string }; usableActions: ScheduleDelegationAction[] };
export type ScheduleDelegationEntry = { slotId: string; revision: number; workerId: string; locationId: string; timeZone: string; workDate: string;
  startAt: string; endAt: string; publishedAt: string; publishedBy: string; cancelled: boolean; cancelledAt: string | null; cancelledBy: string | null; canCancel: boolean };
export type ScheduleDelegationSchedule = { grant: ScheduleDelegationGrant; revision: number; settingsVersion: number; timeZone: string; workerVersion: number;
  locationVersion: number; readAt: string; entries: ScheduleDelegationEntry[]; rangeLimited: boolean };
export type ScheduleDelegationReceipt = { operationId: string; action: "grant" | "revoke" | "publish" | "cancel"; grantId: string; grantRevision: 1 | 2;
  scheduleRevision: number | null; actorId: string; recordedAt: string; commandFingerprint: string };
export type ScheduleDelegationResult = { protocol: "schedule-delegation-v1"; siteId: string; access: ScheduleDelegationAccess; actorId: string; employeeId: string | null;
  mode: ScheduleDelegationQuery["mode"]; canWrite: boolean; grants: ScheduleDelegationGrant[]; catalogItems: ScheduleDelegationCatalogItem[];
  nextAfterId: string | null; detail: ScheduleDelegationGrant | null; schedule: ScheduleDelegationSchedule | null; receipt: ScheduleDelegationReceipt | null; readAt: string };
export type ScheduleDelegationIdentity = { ownerId?: string; employeeId?: string; authUserId?: string };
export const SCHEDULE_DELEGATION_ERRORS: Readonly<Record<string, number>> = Object.freeze({ ...SCHEDULE_ERRORS,
  attendance_schedule_delegation_invalid: 503, attendance_schedule_delegation_disabled: 403, attendance_schedule_delegation_not_found: 404,
  attendance_schedule_delegation_too_large: 422, attendance_schedule_delegation_changed: 409, attendance_account_suspended: 409,
  attendance_version_exhausted: 409, attendance_unavailable: 503, attendance_not_available: 404 });
const fail = (code = "attendance_schedule_delegation_invalid"): never => { throw new MerchantAttendanceError(code); };
const exact = captureBrowserExact;
const text = (v: unknown, max = 200): string => typeof v === "string" && v === v.trim() && [...v].length >= 1 && [...v].length <= max && !/[\u0000-\u001f\u007f-\u009f]/.test(v) ? v : fail();
const uuid = (v: unknown): string => typeof v === "string" && v.length === 36 && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v) ? v : fail();
const nullableId = (v: unknown) => v === null ? null : uuid(v);
const site = (v: unknown): string => typeof v === "string" && /^[0-9]{8}$/.test(v) && v.length === 8 ? v : fail();
const bool = (v: unknown): boolean => typeof v === "boolean" ? v : fail();
const version = (v: unknown, min = 0): number => typeof v === "number" && Number.isSafeInteger(v) && !Object.is(v, -0) && v >= min && v < Number.MAX_SAFE_INTEGER - 1 ? v : fail();
const digest = (v: unknown): string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v) && v.length === 64 ? v : fail();
function stamp(v: unknown, digits = 6): string { if (typeof v !== "string" || !(digits === 6 ? /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/ : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/).test(v) || v.startsWith("0000")) return fail();
  const ms = v.slice(0, 23) + "Z", n = Date.parse(ms); if (!Number.isFinite(n) || new Date(n).toISOString() !== ms) fail(); return v; }
function date(v: unknown): string { if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v) || v < "2000-01-01" || v > "2100-12-31") return fail(); stamp(`${v}T00:00:00.000Z`, 3); return v; }
function actions(v: unknown, empty = false): ScheduleDelegationAction[] { if (!Array.isArray(v) || v.length > 2 || !empty && v.length < 1) return fail(); let previous = -1;
  return v.map(x => { const index = ["publish", "cancel"].indexOf(x); if (index <= previous) return fail(); previous = index; return x as ScheduleDelegationAction; }); }
function freeze<T>(v: T): T { if (v && typeof v === "object" && !Object.isFrozen(v)) { Object.values(v).forEach(freeze); Object.freeze(v); } return v; }
export function validateScheduleDelegationTree(v: unknown, limit = SCHEDULE_DELEGATION_BYTE_LIMIT) { try { validateApplicationDelegationTree(v, limit); } catch { fail(); } }
export function parseScheduleDelegationJson(raw: string, kind: "request" | "response" = "response") { try {
  const limit = kind === "request" ? SCHEDULE_DELEGATION_BODY_BYTE_LIMIT : SCHEDULE_DELEGATION_BYTE_LIMIT;
  if (typeof raw !== "string" || new TextEncoder().encode(raw).byteLength > limit) fail(); const v = parseCaptureBrowserJson(raw); validateScheduleDelegationTree(v, limit); return v;
} catch { return fail(kind === "request" ? "attendance_invalid_request" : undefined); } }
const QUERY_KEYS = ["siteId", "access", "mode", "catalog", "grantId", "afterId", "fromDate", "throughDate", "operationId"];
export function parseScheduleDelegationQuery(raw: unknown): ScheduleDelegationQuery { try {
  validateScheduleDelegationTree(raw, SCHEDULE_DELEGATION_BODY_BYTE_LIMIT); const v = exact(raw, QUERY_KEYS);
  if (v.access !== "owner" && v.access !== "delegate") return fail();
  const q: ScheduleDelegationQuery = { siteId: site(v.siteId), access: v.access, mode: v.mode as ScheduleDelegationQuery["mode"], catalog: v.catalog as ScheduleDelegationCatalog | null,
    grantId: nullableId(v.grantId), afterId: nullableId(v.afterId), fromDate: v.fromDate === null ? null : date(v.fromDate), throughDate: v.throughDate === null ? null : date(v.throughDate), operationId: nullableId(v.operationId) };
  if (!(q.access === "owner" ? ["list", "catalog", "detail", "recover"] : ["grants", "schedule", "recover"]).includes(q.mode)
    || (q.mode === "catalog" ? !["delegates", "workers", "locations"].includes(String(q.catalog)) : q.catalog !== null)
    || ["detail", "schedule"].includes(q.mode) !== (q.grantId !== null) || (q.mode === "recover") !== (q.operationId !== null)
    || q.afterId !== null && !["list", "catalog", "grants"].includes(q.mode)
    || (q.mode === "schedule") !== (q.fromDate !== null) || (q.mode === "schedule") !== (q.throughDate !== null)) fail();
  if (q.fromDate && q.throughDate && (q.fromDate > q.throughDate || Date.parse(q.throughDate) - Date.parse(q.fromDate) > 30 * 86400000)) fail(); return freeze(q);
} catch { return fail("attendance_invalid_request"); } }
export function parseScheduleDelegationHttpQuery(url: string) { try { const p = new URL(url).searchParams, q: Record<string, unknown> = { catalog: null, grantId: null, afterId: null, fromDate: null, throughDate: null, operationId: null };
  for (const [k, v] of p) { if (p.getAll(k).length !== 1) fail(); q[k] = v; } return parseScheduleDelegationQuery(q);
} catch { return fail("attendance_invalid_request"); } }
export function scheduleDelegationQueryString(raw: ScheduleDelegationQuery) { const q = parseScheduleDelegationQuery(raw), p = new URLSearchParams(); for (const [k, v] of Object.entries(q)) if (v !== null) p.set(k, v); return p.toString(); }
function decision(raw: unknown): ScheduleCommand { const action = Object.getOwnPropertyDescriptor(raw, "action")?.value;
  const d = exact(raw, ["operationId", "expectedRevision", "expectedSettingsVersion", "reason", "action", ...(action === "publish" ? ["locationId", "timeZone", "slots"] : ["slotId"])]);
  const base = { operationId: uuid(d.operationId), expectedRevision: version(d.expectedRevision), expectedSettingsVersion: version(d.expectedSettingsVersion, 1), reason: text(d.reason) };
  if (action === "cancel") return { ...base, action, slotId: uuid(d.slotId) };
  if (action !== "publish" || !Array.isArray(d.slots) || !d.slots.length || d.slots.length > 32) return fail(); let end = "";
  const slots: ScheduleSlot[] = d.slots.map(rawSlot => { if (!Array.isArray(rawSlot) || rawSlot.length !== 2) return fail(); const a = stamp(rawSlot[0], 3), b = stamp(rawSlot[1], 3);
    if (a < end || b <= a || Date.parse(a) % 60000 || Date.parse(b) % 60000 || Date.parse(b) - Date.parse(a) > 86400000) fail(); end = b; return [a, b]; });
  // Saved zone names are data, not a request to reinterpret historical intent
  // using the current browser's timezone database. SQL validates fresh writes.
  return { ...base, action, locationId: uuid(d.locationId), timeZone: text(d.timeZone, 100), slots };
}
export function parseScheduleDelegationCommand(raw: unknown): ScheduleDelegationCommand { try {
  validateScheduleDelegationTree(raw, SCHEDULE_DELEGATION_BODY_BYTE_LIMIT); const action = Object.getOwnPropertyDescriptor(raw, "action")?.value;
  if (action === "grant") { const c = exact(raw, ["action", "operationId", "delegateEmployeeId", "delegateAuthUserId", "workerId", "employeeId", "employeeAuthUserId", "locationId", "actions", "includeExistingFuture", "validFrom", "validUntil", "reason"]);
    const v: ScheduleDelegationGrantCommand = { action, operationId: uuid(c.operationId), delegateEmployeeId: uuid(c.delegateEmployeeId), delegateAuthUserId: uuid(c.delegateAuthUserId), workerId: uuid(c.workerId),
      employeeId: uuid(c.employeeId), employeeAuthUserId: uuid(c.employeeAuthUserId), locationId: uuid(c.locationId), actions: actions(c.actions), includeExistingFuture: bool(c.includeExistingFuture), validFrom: stamp(c.validFrom), validUntil: stamp(c.validUntil), reason: text(c.reason) };
    if (v.validFrom >= v.validUntil || v.delegateEmployeeId === v.employeeId || v.delegateAuthUserId === v.employeeAuthUserId) fail(); return freeze(v); }
  if (action === "revoke") { const c = exact(raw, ["action", "operationId", "grantId", "expectedRevision", "reason"]); if (c.expectedRevision !== 1) fail();
    return freeze({ action, operationId: uuid(c.operationId), grantId: uuid(c.grantId), expectedRevision: 1 as const, reason: text(c.reason) }); }
  const c = exact(raw, ["expectedGrantRevision", "decision"]); if (c.expectedGrantRevision !== 1) fail(); return freeze({ expectedGrantRevision: 1, decision: decision(c.decision) });
} catch { return fail("attendance_invalid_request"); } }
export function parseScheduleDelegationBody(raw: unknown) { try { validateScheduleDelegationTree(raw, SCHEDULE_DELEGATION_BODY_BYTE_LIMIT); const b = exact(raw, ["query", "command"]), query = parseScheduleDelegationQuery(b.query), command = parseScheduleDelegationCommand(b.command);
  if (query.operationId !== null || query.afterId !== null || (query.access === "owner" ? !("action" in command) || query.mode !== (command.action === "grant" ? "list" : "detail")
    || command.action === "revoke" && command.grantId !== query.grantId : !("decision" in command) || query.mode !== "schedule")) fail(); return freeze({ query, command });
} catch { return fail("attendance_invalid_request"); } }
export function scheduleDelegationOperation(c: ScheduleDelegationCommand) { return "decision" in c ? c.decision.operationId : c.operationId; }
export function scheduleDelegationFingerprintText(q: ScheduleDelegationQuery, raw: ScheduleDelegationCommand) { const { query, command: c } = parseScheduleDelegationBody({ query: q, command: raw });
  const tail = "decision" in c ? [c.decision.action, c.decision.operationId, query.grantId, c.expectedGrantRevision, query.fromDate, query.throughDate, c.decision.expectedRevision, c.decision.expectedSettingsVersion, c.decision.reason,
    c.decision.action === "publish" ? c.decision.locationId : null, c.decision.action === "publish" ? c.decision.timeZone : null, c.decision.action === "publish" ? JSON.stringify(c.decision.slots) : null, c.decision.action === "cancel" ? c.decision.slotId : null]
    : c.action === "grant" ? [c.action, c.operationId, c.delegateEmployeeId, c.delegateAuthUserId, c.workerId, c.employeeId, c.employeeAuthUserId, c.locationId, c.actions.join(","), c.includeExistingFuture, c.validFrom, c.validUntil, c.reason]
      : [c.action, c.operationId, c.grantId, c.expectedRevision, c.reason];
  return `[${["attendance-schedule-delegation-v1", query.siteId, query.access, ...tail].map(x => JSON.stringify(x)).join(", ")}]`;
}
export async function scheduleDelegationFingerprint(q: ScheduleDelegationQuery, c: ScheduleDelegationCommand) { const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(scheduleDelegationFingerprintText(q, c)));
  return Array.from(new Uint8Array(digest), x => x.toString(16).padStart(2, "0")).join(""); }
export const scheduleDelegationCommandFingerprint = scheduleDelegationFingerprint;
function grant(raw: unknown): ScheduleDelegationGrant { const g = exact(raw, ["grantId", "revision", "status", "delegate", "worker", "location", "actions", "includeExistingFuture", "validFrom", "validUntil", "grantedBy", "grantedAt", "reason", "revocation", "usableActions"]);
  const d = exact(g.delegate, ["employeeId", "authUserId", "name"]), w = exact(g.worker, ["workerId", "employeeId", "authUserId", "name", "workerNo"]), l = exact(g.location, ["id", "name", "timeZone"]);
  const v: ScheduleDelegationGrant = { grantId: uuid(g.grantId), revision: g.revision as 1 | 2, status: g.status as ScheduleDelegationGrant["status"],
    delegate: { employeeId: uuid(d.employeeId), authUserId: uuid(d.authUserId), name: text(d.name, 120) }, worker: { workerId: uuid(w.workerId), employeeId: uuid(w.employeeId), authUserId: uuid(w.authUserId), name: text(w.name, 120), workerNo: text(w.workerNo, 40) },
    location: { id: uuid(l.id), name: text(l.name, 120), timeZone: text(l.timeZone, 100) }, actions: actions(g.actions), includeExistingFuture: bool(g.includeExistingFuture), validFrom: stamp(g.validFrom), validUntil: stamp(g.validUntil),
    grantedBy: uuid(g.grantedBy), grantedAt: stamp(g.grantedAt), reason: text(g.reason), revocation: null, usableActions: actions(g.usableActions, true) };
  if (g.revocation !== null) { const r = exact(g.revocation, ["operationId", "actorId", "reason", "recordedAt"]); v.revocation = { operationId: uuid(r.operationId), actorId: uuid(r.actorId), reason: text(r.reason), recordedAt: stamp(r.recordedAt) }; if (v.revocation.operationId === v.grantId) fail(); }
  if (v.validFrom >= v.validUntil || v.delegate.employeeId === v.worker.employeeId || v.delegate.authUserId === v.worker.authUserId || v.revision !== (v.revocation ? 2 : 1)
    || v.status !== (v.revocation ? "revoked" : "granted") || v.usableActions.some(a => !v.actions.includes(a)) || v.revocation && v.usableActions.length) fail(); return v;
}
function catalogItem(raw: unknown, kind: ScheduleDelegationCatalog | null): ScheduleDelegationCatalogItem { const c = exact(raw, ["id", "name", "employeeId", "employeeAuthUserId", "workerNo", "timeZone"]);
  const v = { id: uuid(c.id), name: text(c.name, 120), employeeId: nullableId(c.employeeId), employeeAuthUserId: nullableId(c.employeeAuthUserId), workerNo: c.workerNo === null ? null : text(c.workerNo, 40), timeZone: c.timeZone === null ? null : text(c.timeZone, 100) };
  if (kind === "locations" ? v.employeeId !== null || v.employeeAuthUserId !== null || v.workerNo !== null || v.timeZone === null
    : kind === "delegates" ? v.id !== v.employeeId || v.employeeAuthUserId === null || v.workerNo !== null || v.timeZone !== null
      : kind !== "workers" || v.employeeId === null || v.employeeAuthUserId === null || v.workerNo === null || v.timeZone !== null) fail(); return v;
}
function page<T>(raw: unknown, parse: (v: unknown) => T, key: (v: T) => string, after: string | null): T[] { if (!Array.isArray(raw) || raw.length > 25) return fail(); let prior = after;
  return raw.map(value => { const item = parse(value), id = key(item); if (prior !== null && id <= prior) fail(); prior = id; return item; }); }
function schedule(raw: unknown, q: ScheduleDelegationQuery, employeeId: string, actorId: string, canWrite: boolean): ScheduleDelegationSchedule { const s = exact(raw, ["grant", "revision", "settingsVersion", "timeZone", "workerVersion", "locationVersion", "readAt", "entries", "rangeLimited"]);
  const g = grant(s.grant), revision = version(s.revision), timeZone = text(s.timeZone, 100), rangeLimited = bool(s.rangeLimited);
  if (g.grantId !== q.grantId || g.delegate.employeeId !== employeeId || g.delegate.authUserId !== actorId || !Array.isArray(s.entries) || s.entries.length > 100 || rangeLimited && s.entries.length) return fail();
  const ids = new Set<string>(); const entries = s.entries.map(rawEntry => { const e = exact(rawEntry, ["slotId", "revision", "workerId", "locationId", "timeZone", "workDate", "startAt", "endAt", "publishedAt", "publishedBy", "cancelled", "cancelledAt", "cancelledBy", "canCancel"]);
    const v: ScheduleDelegationEntry = { slotId: uuid(e.slotId), revision: version(e.revision, 1), workerId: uuid(e.workerId), locationId: uuid(e.locationId), timeZone: text(e.timeZone, 100), workDate: date(e.workDate), startAt: stamp(e.startAt, 3), endAt: stamp(e.endAt, 3), publishedAt: stamp(e.publishedAt), publishedBy: uuid(e.publishedBy), cancelled: bool(e.cancelled), cancelledAt: e.cancelledAt === null ? null : stamp(e.cancelledAt), cancelledBy: nullableId(e.cancelledBy), canCancel: bool(e.canCancel) };
    if (ids.has(v.slotId) || v.revision > revision || v.workerId !== g.worker.workerId || v.locationId !== g.location.id || v.workDate < q.fromDate! || v.workDate > q.throughDate!
      || v.startAt >= v.endAt || Date.parse(v.startAt) % 60000 || Date.parse(v.endAt) % 60000 || Date.parse(v.endAt) - Date.parse(v.startAt) > 86400000
      || v.cancelled !== (v.cancelledAt !== null) || v.cancelled !== (v.cancelledBy !== null) || v.canCancel && (v.cancelled || !canWrite || !g.usableActions.includes("cancel") || rangeLimited)) fail(); ids.add(v.slotId); return v; });
  return { grant: g, revision, settingsVersion: version(s.settingsVersion, 1), timeZone, workerVersion: version(s.workerVersion, 1), locationVersion: version(s.locationVersion, 1), readAt: stamp(s.readAt), entries, rangeLimited };
}
export function scheduleDelegationReceiptMatches(r: ScheduleDelegationReceipt, q: ScheduleDelegationQuery, c: ScheduleDelegationCommand, fingerprint: string) {
  if (r.operationId !== scheduleDelegationOperation(c) || r.commandFingerprint !== fingerprint) return false;
  return "decision" in c ? r.action === c.decision.action && r.grantId === q.grantId && r.grantRevision === 1 && r.scheduleRevision === c.decision.expectedRevision + 1
    : r.action === c.action && r.grantId === (c.action === "grant" ? c.operationId : c.grantId) && r.grantRevision === (c.action === "grant" ? 1 : 2) && r.scheduleRevision === null;
}
const RESULT_KEYS = ["protocol", "siteId", "access", "actorId", "employeeId", "mode", "canWrite", "grants", "catalogItems", "nextAfterId", "detail", "schedule", "receipt", "readAt"];
export function parseScheduleDelegationResult(raw: unknown, input: ScheduleDelegationQuery, expected: ScheduleDelegationIdentity = {}, command: ScheduleDelegationCommand | null = null): ScheduleDelegationResult { try {
  validateScheduleDelegationTree(raw); const q = parseScheduleDelegationQuery(input), v = exact(raw, RESULT_KEYS), actorId = uuid(v.actorId), employeeId = nullableId(v.employeeId), canWrite = bool(v.canWrite);
  if (v.protocol !== "schedule-delegation-v1" || v.siteId !== q.siteId || v.access !== q.access || v.mode !== q.mode || (q.access === "owner") !== (employeeId === null)
    || expected.authUserId !== undefined && actorId !== expected.authUserId || expected.ownerId !== undefined && (q.access !== "owner" || actorId !== expected.ownerId)
    || expected.employeeId !== undefined && (q.access !== "delegate" || employeeId !== expected.employeeId)) fail(); if (command) parseScheduleDelegationBody({ query: q, command });
  const grants = page(v.grants, grant, g => g.grantId, q.afterId), catalogItems = page(v.catalogItems, c => catalogItem(c, q.catalog), c => c.id, q.afterId), nextAfterId = nullableId(v.nextAfterId);
  if (q.access === "delegate" && grants.some(g => g.delegate.employeeId !== employeeId || g.delegate.authUserId !== actorId || !g.usableActions.length)) fail();
  const detail = v.detail === null ? null : grant(v.detail), selected = v.schedule === null ? null : schedule(v.schedule, q, employeeId!, actorId, canWrite);
  let receipt: ScheduleDelegationReceipt | null = null;
  if (v.receipt !== null) { const r = exact(v.receipt, ["operationId", "action", "grantId", "grantRevision", "scheduleRevision", "actorId", "recordedAt", "commandFingerprint"]);
    const action = r.action as ScheduleDelegationReceipt["action"];
    if (!(q.access === "owner" ? ["grant", "revoke"] : ["publish", "cancel"]).includes(action) || r.grantRevision !== (action === "revoke" ? 2 : 1)) fail();
    receipt = { operationId: uuid(r.operationId), action, grantId: uuid(r.grantId), grantRevision: r.grantRevision as 1 | 2, scheduleRevision: r.scheduleRevision === null ? null : version(r.scheduleRevision, 1), actorId: uuid(r.actorId), recordedAt: stamp(r.recordedAt), commandFingerprint: digest(r.commandFingerprint) };
    if (receipt.actorId !== actorId || receipt.operationId !== (command ? scheduleDelegationOperation(command) : q.operationId)
      || (q.access === "owner") !== (receipt.scheduleRevision === null) || action === "grant" && receipt.grantId !== receipt.operationId
      || command && !scheduleDelegationReceiptMatches(receipt, q, command, receipt.commandFingerprint)) fail(); }
  if (command || q.mode === "recover") { if (canWrite || grants.length || catalogItems.length || nextAfterId || detail || selected || command && !receipt) fail(); }
  else if (receipt || ["list", "grants"].includes(q.mode) && (catalogItems.length || detail || selected)
    || q.mode === "catalog" && (grants.length || detail || selected) || q.mode === "detail" && (grants.length || catalogItems.length || nextAfterId || selected || !detail || detail.grantId !== q.grantId)
    || q.mode === "schedule" && (grants.length || catalogItems.length || nextAfterId || detail || !selected)) fail();
  if (nextAfterId) { const rows = q.mode === "catalog" ? catalogItems : grants; if (!["list", "grants", "catalog"].includes(q.mode) || rows.length !== 25 || nextAfterId !== (q.mode === "catalog" ? catalogItems.at(-1)!.id : grants.at(-1)!.grantId)) fail(); }
  return freeze({ protocol: "schedule-delegation-v1", siteId: q.siteId, access: q.access, actorId, employeeId, mode: q.mode, canWrite, grants, catalogItems, nextAfterId, detail, schedule: selected, receipt, readAt: stamp(v.readAt) });
} catch { return fail(); } }
export function parseScheduleDelegationResponse(raw: unknown, q: ScheduleDelegationQuery, expected: ScheduleDelegationIdentity = {}, command: ScheduleDelegationCommand | null = null) { try {
  validateScheduleDelegationTree(raw); const v = exact(raw, ["ok", ...RESULT_KEYS]); if (v.ok !== true) fail(); const { ok, ...rest } = v; void ok; return parseScheduleDelegationResult(rest, q, expected, command);
} catch { return fail(); } }
