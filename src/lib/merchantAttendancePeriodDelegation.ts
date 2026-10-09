import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { captureBrowserExact, parseCaptureBrowserJson } from "./merchantAttendanceRuleCapturesBrowser";
import { validateApplicationDelegationTree } from "./merchantAttendanceApplicationDelegation";

export const PERIOD_DELEGATION_API = "/api/merchant-enterprise/attendance/period-delegation";
export const PERIOD_DELEGATION_BODY_BYTE_LIMIT = 8192;
export const PERIOD_DELEGATION_BYTE_LIMIT = 131072;
export const PERIOD_DELEGATION_ACTIONS = ["view", "send", "respond", "seal", "reopen"] as const;
export type PeriodDelegationAction = typeof PERIOD_DELEGATION_ACTIONS[number];
export type PeriodDelegationAccess = "owner" | "delegate";
export type PeriodDelegationCatalog = "delegates" | "workers";
export type PeriodDelegationQuery = { siteId: string; access: "owner" | "delegate"; mode: "list" | "catalog" | "detail" | "recover";
  catalog: "delegates" | "workers" | null; grantId: string | null; afterId: string | null; operationId: string | null };
export type PeriodDelegationGrantCommand = { action: "grant"; operationId: string; delegateEmployeeId: string; delegateAuthUserId: string;
  workerId: string; employeeId: string; employeeAuthUserId: string; fromDate: string; throughDate: string; actions: PeriodDelegationAction[];
  includeExisting: boolean; validFrom: string; validUntil: string; reason: string };
export type PeriodDelegationRevokeCommand = { action: "revoke"; operationId: string; grantId: string; expectedRevision: 1; reason: string };
export type PeriodDelegationCommand = PeriodDelegationGrantCommand | PeriodDelegationRevokeCommand;
export type PeriodDelegationGrant = { grantId: string; revision: 1 | 2; status: "granted" | "revoked";
  delegate: { employeeId: string; authUserId: string; name: string };
  worker: { workerId: string; employeeId: string; authUserId: string; name: string; workerNo: string };
  fromDate: string; throughDate: string; actions: PeriodDelegationAction[]; includeExisting: boolean; validFrom: string; validUntil: string;
  grantedBy: string; grantedAt: string; reason: string; usableActions: PeriodDelegationAction[];
  revocation: null | { operationId: string; actorId: string; reason: string; recordedAt: string } };
export type PeriodDelegationCatalogItem = { id: string; name: string; employeeId: string; employeeAuthUserId: string; workerNo: string | null; actions: PeriodDelegationAction[] };
export type PeriodDelegationReceipt = { operationId: string; action: "grant" | "revoke" | Exclude<PeriodDelegationAction, "view">;
  grantId: string; grantRevision: 1 | 2; periodId: string | null; periodRevision: number | null; actorId: string; recordedAt: string; commandFingerprint: string };
export type PeriodDelegationResult = { protocol: "period-delegation-v1"; siteId: string; access: PeriodDelegationQuery["access"]; actorId: string; employeeId: string | null;
  mode: PeriodDelegationQuery["mode"]; canWrite: boolean; grants: PeriodDelegationGrant[]; catalogItems: PeriodDelegationCatalogItem[];
  nextAfterId: string | null; detail: PeriodDelegationGrant | null; receipt: PeriodDelegationReceipt | null; readAt: string };
export const PERIOD_DELEGATION_ERRORS: Readonly<Record<string, number>> = Object.freeze({
  attendance_period_delegation_invalid: 503, attendance_period_delegation_disabled: 403, attendance_period_delegation_not_found: 404,
  attendance_period_delegation_changed: 409, attendance_period_delegation_too_large: 422, attendance_access_denied: 403,
  attendance_invalid_request: 400, attendance_operation_conflict: 409, attendance_version_conflict: 409, attendance_version_exhausted: 409,
  attendance_account_suspended: 409, attendance_worker_not_found: 404, attendance_settings_required: 409, attendance_platform_paused: 403,
  attendance_not_available: 404, attendance_unavailable: 503, attendance_rate_limited: 429,
  attendance_invalid_content_type: 415, attendance_body_too_large: 413,
});
const fail = (code = "attendance_period_delegation_invalid"): never => { throw new MerchantAttendanceError(code); };
const exact = captureBrowserExact;
const uuid = (v: unknown): string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v) ? v : fail();
const nullableId = (v: unknown) => v === null ? null : uuid(v);
const label = (v: unknown, max = 200): string => typeof v === "string" && v === v.trim() && [...v].length > 0 && [...v].length <= max && !/[\u0000-\u001f\u007f-\u009f]/.test(v) ? v : fail();
const bool = (v: unknown): boolean => typeof v === "boolean" ? v : fail();
const site = (v: unknown): string => typeof v === "string" && /^[0-9]{8}$/.test(v) ? v : fail();
const hash = (v: unknown): string => typeof v === "string" && /^[0-9a-f]{64}$/.test(v) ? v : fail();
const integer = (v: unknown): number => typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 2147483647 ? v : fail();
function date(v: unknown): string { if (typeof v !== "string" || !/^(?:20\d{2}|2100)-\d\d-\d\d$/.test(v)) return fail();
  const n = Date.parse(v + "T00:00:00.000Z"); return Number.isFinite(n) && new Date(n).toISOString().slice(0, 10) === v ? v : fail(); }
function stamp(v: unknown): string { if (typeof v !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/.test(v) || v.startsWith("0000")) return fail();
  const ms = v.slice(0, 23) + "Z", n = Date.parse(ms); return Number.isFinite(n) && new Date(n).toISOString() === ms ? v : fail(); }
function interval(from: string, through: string) { const d = Date.parse(through) - Date.parse(from); if (d < 0 || d > 365 * 86400000) fail(); }
function validity(from: string, until: string) {
  const difference = Date.parse(until) - Date.parse(from), maximum = 366 * 86400000;
  if (from >= until || difference > maximum || difference === maximum && until.slice(23, 26) > from.slice(23, 26)) fail();
}
function actions(raw: unknown, empty = false): PeriodDelegationAction[] { if (!Array.isArray(raw) || raw.length > 5 || !empty && !raw.length) return fail();
  let last = -1; const result = raw.map(v => { const at = PERIOD_DELEGATION_ACTIONS.indexOf(v); if (at < 0 || at <= last) fail(); last = at; return v as PeriodDelegationAction; });
  if (result.length && result[0] !== "view") fail(); return result; }
function freeze<T>(v: T): T { if (v && typeof v === "object") { Object.values(v).forEach(freeze); Object.freeze(v); } return v; }
function tree(v: unknown, limit = PERIOD_DELEGATION_BYTE_LIMIT) { try { validateApplicationDelegationTree(v, limit); } catch { fail(); } }
export function parsePeriodDelegationJson(raw: string, kind: "request" | "response" = "response") { try {
  const limit = kind === "request" ? PERIOD_DELEGATION_BODY_BYTE_LIMIT : PERIOD_DELEGATION_BYTE_LIMIT;
  if (typeof raw !== "string" || new TextEncoder().encode(raw).length > limit) fail(); const v = parseCaptureBrowserJson(raw); tree(v, limit); return v;
} catch { return fail(kind === "request" ? "attendance_invalid_request" : undefined); } }
const QUERY_KEYS = ["siteId", "access", "mode", "catalog", "grantId", "afterId", "operationId"];
export function parsePeriodDelegationQuery(raw: unknown): PeriodDelegationQuery { try { tree(raw, PERIOD_DELEGATION_BODY_BYTE_LIMIT); const v = exact(raw, QUERY_KEYS);
  if (v.access !== "owner" && v.access !== "delegate" || !["list", "catalog", "detail", "recover"].includes(String(v.mode))) fail();
  const q: PeriodDelegationQuery = { siteId: site(v.siteId), access: v.access as PeriodDelegationQuery["access"], mode: v.mode as PeriodDelegationQuery["mode"],
    catalog: v.catalog as PeriodDelegationQuery["catalog"], grantId: nullableId(v.grantId), afterId: nullableId(v.afterId), operationId: nullableId(v.operationId) };
  if (q.mode === "catalog" ? q.access !== "owner" || !["delegates", "workers"].includes(String(q.catalog)) : q.catalog !== null) fail();
  if ((q.mode === "detail") !== (q.grantId !== null) || (q.mode === "recover") !== (q.operationId !== null)
    || q.afterId !== null && !["list", "catalog"].includes(q.mode)) fail(); return freeze(q);
} catch { return fail("attendance_invalid_request"); } }
export function periodDelegationQueryString(raw: PeriodDelegationQuery) { const q = parsePeriodDelegationQuery(raw), p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== null) p.set(k, v); return p.toString(); }
export function parsePeriodDelegationHttpQuery(url: string): PeriodDelegationQuery { try {
  if (typeof url !== "string" || url.length > 4096 || /[\u0000-\u0020\u007f]/.test(url) || /%(?![0-9a-f]{2})/i.test(url)) fail();
  const u = new URL(url); if (url.includes("#") || u.username || u.password || !["http:", "https:"].includes(u.protocol)) fail(); const p = u.searchParams;
  for (const [k, v] of p) if (!QUERY_KEYS.includes(k) || p.getAll(k).length !== 1 || !v) fail();
  return parsePeriodDelegationQuery(Object.fromEntries(QUERY_KEYS.map(k => [k, p.get(k)])));
} catch { return fail("attendance_invalid_request"); } }
export function parsePeriodDelegationCommand(raw: unknown): PeriodDelegationCommand { try { tree(raw, PERIOD_DELEGATION_BODY_BYTE_LIMIT);
  const base = exact(raw, typeof raw === "object" && raw !== null && Object.getOwnPropertyDescriptor(raw, "action")?.value === "grant"
    ? ["action", "operationId", "delegateEmployeeId", "delegateAuthUserId", "workerId", "employeeId", "employeeAuthUserId", "fromDate", "throughDate", "actions", "includeExisting", "validFrom", "validUntil", "reason"]
    : ["action", "operationId", "grantId", "expectedRevision", "reason"]);
  if (base.action === "revoke") { if (base.expectedRevision !== 1) fail(); return freeze({ action: "revoke", operationId: uuid(base.operationId), grantId: uuid(base.grantId), expectedRevision: 1, reason: label(base.reason) }); }
  if (base.action !== "grant") fail(); const c: PeriodDelegationGrantCommand = { action: "grant", operationId: uuid(base.operationId),
    delegateEmployeeId: uuid(base.delegateEmployeeId), delegateAuthUserId: uuid(base.delegateAuthUserId), workerId: uuid(base.workerId), employeeId: uuid(base.employeeId), employeeAuthUserId: uuid(base.employeeAuthUserId),
    fromDate: date(base.fromDate), throughDate: date(base.throughDate), actions: actions(base.actions), includeExisting: bool(base.includeExisting), validFrom: stamp(base.validFrom), validUntil: stamp(base.validUntil), reason: label(base.reason) };
  if (c.delegateEmployeeId === c.employeeId || c.delegateAuthUserId === c.employeeAuthUserId) fail(); interval(c.fromDate, c.throughDate); validity(c.validFrom, c.validUntil); return freeze(c);
} catch { return fail("attendance_invalid_request"); } }
export function parsePeriodDelegationBody(raw: unknown) { try { tree(raw, PERIOD_DELEGATION_BODY_BYTE_LIMIT); const b = exact(raw, ["query", "command"]), query = parsePeriodDelegationQuery(b.query), command = parsePeriodDelegationCommand(b.command);
  if (query.access !== "owner" || query.afterId !== null || query.mode !== (command.action === "grant" ? "list" : "detail")
    || command.action === "revoke" && command.grantId !== query.grantId) fail(); return freeze({ query, command });
} catch { return fail("attendance_invalid_request"); } }
export function periodDelegationFingerprintText(q: PeriodDelegationQuery, raw: PeriodDelegationCommand) { const { query, command: c } = parsePeriodDelegationBody({ query: q, command: raw });
  const tail = c.action === "grant" ? [c.action, c.operationId, c.delegateEmployeeId, c.delegateAuthUserId, c.workerId, c.employeeId, c.employeeAuthUserId, c.fromDate, c.throughDate, c.actions.join(","), c.includeExisting, c.validFrom, c.validUntil, c.reason]
    : [c.action, c.operationId, c.grantId, c.expectedRevision, c.reason];
  return `[${["attendance-period-delegation-v1", query.siteId, query.access, ...tail].map(v => JSON.stringify(v)).join(", ")}]`; }
export async function periodDelegationCommandFingerprint(q: PeriodDelegationQuery, c: PeriodDelegationCommand) { const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(periodDelegationFingerprintText(q, c)));
  return [...new Uint8Array(h)].map(v => v.toString(16).padStart(2, "0")).join(""); }
function grant(raw: unknown): PeriodDelegationGrant { const g = exact(raw, ["grantId", "revision", "status", "delegate", "worker", "fromDate", "throughDate", "actions", "includeExisting", "validFrom", "validUntil", "grantedBy", "grantedAt", "reason", "revocation", "usableActions"]);
  const d = exact(g.delegate, ["employeeId", "authUserId", "name"]), w = exact(g.worker, ["workerId", "employeeId", "authUserId", "name", "workerNo"]);
  const v: PeriodDelegationGrant = { grantId: uuid(g.grantId), revision: g.revision as 1 | 2, status: g.status as PeriodDelegationGrant["status"],
    delegate: { employeeId: uuid(d.employeeId), authUserId: uuid(d.authUserId), name: label(d.name, 120) },
    worker: { workerId: uuid(w.workerId), employeeId: uuid(w.employeeId), authUserId: uuid(w.authUserId), name: label(w.name, 120), workerNo: label(w.workerNo, 40) },
    fromDate: date(g.fromDate), throughDate: date(g.throughDate), actions: actions(g.actions), includeExisting: bool(g.includeExisting), validFrom: stamp(g.validFrom), validUntil: stamp(g.validUntil),
    grantedBy: uuid(g.grantedBy), grantedAt: stamp(g.grantedAt), reason: label(g.reason), revocation: null, usableActions: actions(g.usableActions, true) };
  if (g.revocation !== null) { const r = exact(g.revocation, ["operationId", "actorId", "reason", "recordedAt"]); v.revocation = { operationId: uuid(r.operationId), actorId: uuid(r.actorId), reason: label(r.reason), recordedAt: stamp(r.recordedAt) };
    if (v.revocation.operationId === v.grantId || v.revocation.recordedAt < v.grantedAt) fail(); }
  interval(v.fromDate, v.throughDate); validity(v.validFrom, v.validUntil);
  if (v.delegate.employeeId === v.worker.employeeId || v.delegate.authUserId === v.worker.authUserId || v.revision !== (v.revocation ? 2 : 1)
    || v.status !== (v.revocation ? "revoked" : "granted") || v.usableActions.some(x => !v.actions.includes(x)) || v.revocation && v.usableActions.length) fail(); return v;
}
function catalogItem(raw: unknown, kind: PeriodDelegationQuery["catalog"]): PeriodDelegationCatalogItem { const c = exact(raw, ["id", "name", "employeeId", "employeeAuthUserId", "workerNo", "actions"]);
  const v = { id: uuid(c.id), name: label(c.name, 120), employeeId: uuid(c.employeeId), employeeAuthUserId: uuid(c.employeeAuthUserId), workerNo: c.workerNo === null ? null : label(c.workerNo, 40), actions: actions(c.actions, true) };
  if (kind === "delegates" ? v.id !== v.employeeId || v.workerNo !== null || !v.actions.length : kind !== "workers" || v.workerNo === null || v.actions.length !== 0) fail(); return v; }
function receipt(raw: unknown): PeriodDelegationReceipt { const r = exact(raw, ["operationId", "action", "grantId", "grantRevision", "periodId", "periodRevision", "actorId", "recordedAt", "commandFingerprint"]);
  if (!["grant", "revoke", "send", "respond", "seal", "reopen"].includes(String(r.action))) fail();
  const v: PeriodDelegationReceipt = { operationId: uuid(r.operationId), action: r.action as PeriodDelegationReceipt["action"], grantId: uuid(r.grantId), grantRevision: r.grantRevision as 1 | 2,
    periodId: nullableId(r.periodId), periodRevision: r.periodRevision === null ? null : integer(r.periodRevision), actorId: uuid(r.actorId), recordedAt: stamp(r.recordedAt), commandFingerprint: hash(r.commandFingerprint) };
  const management = v.action === "grant" || v.action === "revoke";
  if (v.grantRevision !== (v.action === "revoke" ? 2 : 1) || management !== (v.periodId === null) || management !== (v.periodRevision === null)
    || v.action === "grant" && v.operationId !== v.grantId || v.action === "revoke" && v.operationId === v.grantId) fail(); return v; }
export function periodDelegationReceiptMatches(r: PeriodDelegationReceipt, c: PeriodDelegationCommand, fingerprint: string) { return r.operationId === c.operationId && r.action === c.action
  && r.grantId === (c.action === "grant" ? c.operationId : c.grantId) && r.grantRevision === (c.action === "grant" ? 1 : 2) && r.commandFingerprint === fingerprint && r.periodId === null && r.periodRevision === null; }
export function parsePeriodDelegationResult(raw: unknown, input: PeriodDelegationQuery, identity: { authUserId: string }, command: PeriodDelegationCommand | null = null): PeriodDelegationResult { try {
  tree(raw); const q = parsePeriodDelegationQuery(input), actor = uuid(identity.authUserId), v = exact(raw, ["protocol", "siteId", "access", "actorId", "employeeId", "mode", "canWrite", "grants", "catalogItems", "nextAfterId", "detail", "receipt", "readAt"]);
  if (v.protocol !== "period-delegation-v1" || v.siteId !== q.siteId || v.access !== q.access || v.mode !== q.mode || v.actorId !== actor
    || !Array.isArray(v.grants) || v.grants.length > 25 || !Array.isArray(v.catalogItems) || v.catalogItems.length > 25) fail();
  const r: PeriodDelegationResult = { protocol: "period-delegation-v1", siteId: q.siteId, access: q.access, actorId: actor, employeeId: nullableId(v.employeeId), mode: q.mode, canWrite: bool(v.canWrite),
    grants: (v.grants as unknown[]).map(grant), catalogItems: (v.catalogItems as unknown[]).map(x => catalogItem(x, q.catalog)), nextAfterId: nullableId(v.nextAfterId), detail: v.detail === null ? null : grant(v.detail), receipt: v.receipt === null ? null : receipt(v.receipt), readAt: stamp(v.readAt) };
  if ((q.access === "owner") !== (r.employeeId === null) || q.mode !== "list" && r.grants.length || q.mode !== "catalog" && r.catalogItems.length
    || q.mode !== "detail" && r.detail !== null || r.detail !== null && r.detail.grantId !== q.grantId || q.mode === "detail" && command === null && r.detail === null
    || !["list", "catalog"].includes(q.mode) && r.nextAfterId !== null || q.mode === "recover" && (r.canWrite || r.detail !== null)
    || r.receipt !== null && (r.receipt.actorId !== actor || r.receipt.recordedAt > r.readAt || q.mode !== "recover" && command === null
      || q.mode === "recover" && r.receipt.operationId !== q.operationId || (q.access === "owner") !== ["grant", "revoke"].includes(r.receipt.action))) fail();
  const page = q.mode === "catalog" ? r.catalogItems.map(x => x.id) : r.grants.map(x => x.grantId); let prior = q.afterId ?? "";
  for (const id of page) { if (id <= prior) fail(); prior = id; }
  if (r.nextAfterId !== null && (page.length !== 25 || r.nextAfterId !== prior)) fail();
  for (const g of [...r.grants, ...(r.detail ? [r.detail] : [])]) {
    if (g.grantedAt > r.readAt || g.revocation && g.revocation.recordedAt > r.readAt || q.access === "delegate" && (g.delegate.employeeId !== r.employeeId || g.delegate.authUserId !== actor)
      || g.usableActions.length && (r.readAt < g.validFrom || r.readAt >= g.validUntil)) fail(); }
  if (command) { const c = parsePeriodDelegationBody({ query: q, command }).command;
    if (!r.receipt || r.receipt.action !== c.action || r.receipt.operationId !== c.operationId || r.receipt.grantId !== (c.action === "grant" ? c.operationId : c.grantId)) fail(); }
  return freeze(r);
} catch { return fail(); } }
export function parsePeriodDelegationResponse(raw: unknown, q: PeriodDelegationQuery, identity: { authUserId: string }, c: PeriodDelegationCommand | null = null) { try {
  tree(raw); const v = exact(raw, ["ok", "protocol", "siteId", "access", "actorId", "employeeId", "mode", "canWrite", "grants", "catalogItems", "nextAfterId", "detail", "receipt", "readAt"]);
  if (v.ok !== true) fail(); const { ok: _ok, ...data } = v; void _ok; return parsePeriodDelegationResult(data, q, identity, c);
} catch { return fail(); } }
