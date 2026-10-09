import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { captureBrowserExact, parseCaptureBrowserJson } from "./merchantAttendanceRuleCapturesBrowser";
import { validateAccountSuspensionTree } from "./merchantAttendanceAccountSuspension";
import { parseAdministrativeClosureBoundary, type AdministrativeClosureBoundary } from "./merchantAttendanceAdministrativeClosure";

export const EMPLOYMENT_LIFECYCLE_API = "/api/merchant-enterprise/attendance/employment-lifecycle";
export const EMPLOYMENT_LIFECYCLE_BYTE_LIMIT = 131072;
export const EMPLOYMENT_LIFECYCLE_BODY_BYTE_LIMIT = 8192;
export type EmploymentLifecycleQuery = { siteId: string; mode: "list" | "detail" | "history" | "recover"; workerId: string | null;
  afterId: string | null; afterRevision: number | null; operationId: string | null };
export type EmploymentLifecycleCommand = { action: "close" | "rejoin"; operationId: string; workerId: string; employeeId: string; employeeAuthUserId: string;
  expectedWorkerVersion: number; expectedEmployeeVersion: number; expectedSettingsVersion: number; expectedRevision: number; expectedPeriodId: string;
  suspensionId: string; expectedGeneration: number; expectedDate: string; reason: string };
export type EmploymentLifecycleWorker = { id: string; employeeId: string | null; employeeAuthUserId: string | null; workerNo: string; displayName: string;
  employeeName: string | null; active: boolean; version: number; employeeVersion: number | null };
export type EmploymentLifecyclePeriod = { id: string; startsOn: string; endsOn: string | null };
export type EmploymentLifecycleState = "untracked" | "closed" | "rejoined";
export type EmploymentLifecycleItem = { worker: EmploymentLifecycleWorker; revision: number; state: EmploymentLifecycleState; period: EmploymentLifecyclePeriod | null };
export type EmploymentLifecyclePending = { id: string; kind: "schedule" | "leave" | "trip" | "field" | "remote"; status: "published" | "submitted" | "approved";
  startAt: string; endAt: string; timeZone: string };
export type EmploymentLifecycleAction = "clock_in" | "break_start" | "break_end" | "clock_out" | null;
export const EMPLOYMENT_LIFECYCLE_BLOCKERS = ["binding_changed", "not_paused", "worker_active", "state_binding_changed", "open_session", "history_limit", "history_uncontrolled", "employment_closed", "employment_open", "date_not_after_end", "date_out_of_range", "pending_items", "pending_limit"] as const;
export type EmploymentLifecycleDetail = { worker: EmploymentLifecycleWorker; settingsVersion: number; timeZone: string; today: string; readAt: string;
  revision: number; state: EmploymentLifecycleState; periods: EmploymentLifecyclePeriod[];
  suspension: { id: string; generation: number; wasActive: boolean; paused: boolean } | null;
  originalAction: EmploymentLifecycleAction; currentAction: EmploymentLifecycleAction; canClose: boolean; canRejoin: boolean;
  administrativeBoundary?: AdministrativeClosureBoundary;
  closeBlockers: string[]; rejoinBlockers: string[]; pending: { items: EmploymentLifecyclePending[]; limited: boolean; historicalPending: "not_checked" } };
export type EmploymentLifecycleReceipt = { operationId: string; actorId: string; workerId: string; employeeId: string; employeeAuthUserId: string;
  action: "close" | "rejoin"; revision: number; periodId: string; startsOn: string; endsOn: string | null; recordedAt: string; commandFingerprint: string };
export type EmploymentLifecycleResult = { siteId: string; mode: EmploymentLifecycleQuery["mode"]; items: EmploymentLifecycleItem[]; nextAfterId: string | null;
  detail: EmploymentLifecycleDetail | null; history: EmploymentLifecycleReceipt[]; nextAfterRevision: number | null; receipt: EmploymentLifecycleReceipt | null };
export type EmploymentLifecycleResponse = EmploymentLifecycleResult;
export const EMPLOYMENT_LIFECYCLE_ERRORS: Readonly<Record<string, number>> = Object.freeze({ attendance_employment_lifecycle_invalid: 503,
  attendance_employment_lifecycle_changed: 409, attendance_employment_lifecycle_not_found: 404, attendance_invalid_request: 400,
  attendance_employment_lifecycle_blocked: 409, attendance_employment_lifecycle_disabled: 403, attendance_employment_lifecycle_too_large: 422, attendance_version_exhausted: 409,
  attendance_access_denied: 403, attendance_version_conflict: 409, attendance_operation_conflict: 409, attendance_settings_required: 409,
  attendance_worker_not_found: 404, attendance_platform_paused: 403, attendance_unavailable: 503, attendance_rate_limited: 429,
  attendance_invalid_content_type: 415, attendance_body_too_large: 413 });
const fail = (code = "attendance_employment_lifecycle_invalid"): never => { throw new MerchantAttendanceError(code); };
const exact = (v: unknown, names: string[]) => captureBrowserExact(v, names);
const id = (v: unknown): string => typeof v === "string" && v.length === 36 && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v) ? v : fail();
const nullableId = (v: unknown) => v === null ? null : id(v);
const site = (v: unknown): string => typeof v === "string" && v.length === 8 && /^[0-9]{8}$/.test(v) ? v : fail();
const integer = (v: unknown, min = 1): number => typeof v === "number" && Number.isSafeInteger(v) && !Object.is(v, -0) && v >= min ? v : fail();
const bool = (v: unknown): boolean => typeof v === "boolean" ? v : fail();
const label = (v: unknown, max = 120): string => typeof v === "string" && v === v.trim() && [...v].length >= 1 && [...v].length <= max && !/[\u0000-\u001f\u007f-\u009f]/.test(v) ? v : fail();
const hash = (v: unknown): string => typeof v === "string" && v.length === 64 && /^[0-9a-f]+$/.test(v) ? v : fail();
function date(v: unknown): string { if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v) || v < "2000-01-01" || v > "2100-12-31") return fail();
  const n = Date.parse(v + "T00:00:00.000Z"); return Number.isFinite(n) && new Date(n).toISOString().slice(0, 10) === v ? v : fail(); }
function stamp(v: unknown, precision: 3 | 6 = 6): string { const re = precision === 6 ? /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/ : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
  if (typeof v !== "string" || !re.test(v) || v.startsWith("0000")) return fail(); const ms = v.slice(0, 23) + "Z", n = Date.parse(ms);
  return Number.isFinite(n) && new Date(n).toISOString() === ms ? v : fail(); }
// Saved timezone labels are evidence, not new client-side date calculations.
// Do not reject a database-known historical zone absent from browser ICU data.
const zone = (v: unknown) => label(v, 100);
function freeze<T>(v: T): T { if (v && typeof v === "object") { Object.values(v).forEach(freeze); Object.freeze(v); } return v; }
function tree(raw: unknown, limit = EMPLOYMENT_LIFECYCLE_BYTE_LIMIT) { try { validateAccountSuspensionTree(raw, limit); } catch { fail(); } }
export function parseEmploymentLifecycleJson(raw: string, kind: "request" | "response" = "response") { try {
  const limit = kind === "request" ? EMPLOYMENT_LIFECYCLE_BODY_BYTE_LIMIT : EMPLOYMENT_LIFECYCLE_BYTE_LIMIT;
  if (typeof raw !== "string" || new TextEncoder().encode(raw).byteLength > limit) fail(); const value = parseCaptureBrowserJson(raw); tree(value, limit); return value;
} catch { return fail(kind === "request" ? "attendance_invalid_request" : undefined); } }
export function parseEmploymentLifecycleQuery(raw: unknown): EmploymentLifecycleQuery { try { tree(raw, EMPLOYMENT_LIFECYCLE_BODY_BYTE_LIMIT);
  const q = exact(raw, ["siteId", "mode", "workerId", "afterId", "afterRevision", "operationId"]);
  const r: EmploymentLifecycleQuery = { siteId: site(q.siteId), mode: q.mode as EmploymentLifecycleQuery["mode"], workerId: nullableId(q.workerId), afterId: nullableId(q.afterId),
    afterRevision: q.afterRevision === null ? null : integer(q.afterRevision, 0), operationId: nullableId(q.operationId) };
  if (!["list", "detail", "history", "recover"].includes(r.mode) || (r.mode === "detail" || r.mode === "history") !== (r.workerId !== null)
    || r.mode !== "list" && r.afterId !== null || r.mode !== "history" && r.afterRevision !== null || (r.mode === "recover") !== (r.operationId !== null)) fail(); return freeze(r);
} catch { return fail("attendance_invalid_request"); } }
export function parseEmploymentLifecycleHttpQuery(url: string): EmploymentLifecycleQuery { try { const p = new URL(url).searchParams;
  const q: Record<string, unknown> = { workerId: null, afterId: null, afterRevision: null, operationId: null }, seen = new Set<string>();
  for (const [k, v] of p) { if (!["siteId", "mode", "workerId", "afterId", "afterRevision", "operationId"].includes(k) || seen.has(k) || !v) fail();
    if (k === "afterRevision" && !/^(0|[1-9][0-9]{0,15})$/.test(v)) fail(); seen.add(k); q[k] = k === "afterRevision" ? Number(v) : v; } return parseEmploymentLifecycleQuery(q);
} catch { return fail("attendance_invalid_request"); } }
export function employmentLifecycleQueryString(raw: EmploymentLifecycleQuery) { const q = parseEmploymentLifecycleQuery(raw), p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== null) p.set(k, String(v)); return p.toString(); }
export function parseEmploymentLifecycleCommand(raw: unknown): EmploymentLifecycleCommand { try { tree(raw, EMPLOYMENT_LIFECYCLE_BODY_BYTE_LIMIT);
  const c = exact(raw, ["action", "operationId", "workerId", "employeeId", "employeeAuthUserId", "expectedWorkerVersion", "expectedEmployeeVersion", "expectedSettingsVersion", "expectedRevision", "expectedPeriodId", "suspensionId", "expectedGeneration", "expectedDate", "reason"]);
  if (c.action !== "close" && c.action !== "rejoin") fail();
  return freeze({ action: c.action as EmploymentLifecycleCommand["action"], operationId: id(c.operationId), workerId: id(c.workerId), employeeId: id(c.employeeId), employeeAuthUserId: id(c.employeeAuthUserId),
    expectedWorkerVersion: integer(c.expectedWorkerVersion), expectedEmployeeVersion: integer(c.expectedEmployeeVersion), expectedSettingsVersion: integer(c.expectedSettingsVersion),
    expectedRevision: integer(c.expectedRevision, 0), expectedPeriodId: id(c.expectedPeriodId), suspensionId: id(c.suspensionId), expectedGeneration: integer(c.expectedGeneration), expectedDate: date(c.expectedDate), reason: label(c.reason, 500) });
} catch { return fail("attendance_invalid_request"); } }
export function parseEmploymentLifecycleBody(raw: unknown) { try { tree(raw, EMPLOYMENT_LIFECYCLE_BODY_BYTE_LIMIT); const b = exact(raw, ["query", "command"]), query = parseEmploymentLifecycleQuery(b.query), command = parseEmploymentLifecycleCommand(b.command);
  if (query.mode !== "detail" || query.workerId !== command.workerId) fail(); return freeze({ query, command });
} catch { return fail("attendance_invalid_request"); } }
function worker(raw: unknown): EmploymentLifecycleWorker { const w = exact(raw, ["id", "employeeId", "employeeAuthUserId", "workerNo", "displayName", "employeeName", "active", "version", "employeeVersion"]);
  return { id: id(w.id), employeeId: nullableId(w.employeeId), employeeAuthUserId: nullableId(w.employeeAuthUserId), workerNo: label(w.workerNo, 40), displayName: label(w.displayName),
    employeeName: w.employeeName === null ? null : label(w.employeeName), active: bool(w.active), version: integer(w.version), employeeVersion: w.employeeVersion === null ? null : integer(w.employeeVersion) }; }
function period(raw: unknown): EmploymentLifecyclePeriod { const p = exact(raw, ["id", "startsOn", "endsOn"]), r = { id: id(p.id), startsOn: date(p.startsOn), endsOn: p.endsOn === null ? null : date(p.endsOn) };
  if (r.endsOn !== null && r.endsOn < r.startsOn) fail(); return r; }
function state(raw: unknown): EmploymentLifecycleState { return raw === "untracked" || raw === "closed" || raw === "rejoined" ? raw : fail(); }
function stateRevision(s: EmploymentLifecycleState, n: number) { if ((s === "untracked") !== (n === 0) || s === "closed" && n % 2 !== 1 || s === "rejoined" && n % 2 !== 0) fail(); }
function item(raw: unknown): EmploymentLifecycleItem { const v = exact(raw, ["worker", "revision", "state", "period"]), r = { worker: worker(v.worker), revision: integer(v.revision, 0), state: state(v.state), period: v.period === null ? null : period(v.period) };
  stateRevision(r.state, r.revision); return r; }
function pending(raw: unknown): EmploymentLifecyclePending { const v = exact(raw, ["id", "kind", "status", "startAt", "endAt", "timeZone"]);
  if (!["schedule", "leave", "trip", "field", "remote"].includes(v.kind as string) || !["published", "submitted", "approved"].includes(v.status as string)
    || (v.kind === "schedule") !== (v.status === "published")) fail();
  const r: EmploymentLifecyclePending = { id: id(v.id), kind: v.kind as EmploymentLifecyclePending["kind"], status: v.status as EmploymentLifecyclePending["status"], startAt: stamp(v.startAt, 3), endAt: stamp(v.endAt, 3), timeZone: zone(v.timeZone) };
  if (r.endAt <= r.startAt) fail(); return r; }
function action(raw: unknown): EmploymentLifecycleAction { return raw === null || raw === "clock_in" || raw === "break_start" || raw === "break_end" || raw === "clock_out" ? raw : fail(); }
function blockers(raw: unknown): string[] { if (!Array.isArray(raw) || raw.length > EMPLOYMENT_LIFECYCLE_BLOCKERS.length || new Set(raw).size !== raw.length || raw.some(v => !EMPLOYMENT_LIFECYCLE_BLOCKERS.includes(v))) return fail(); return raw; }
// The raw action remains unchanged. Shape checks are not write authorization.
export function employmentLifecycleOperatingOff(d: EmploymentLifecycleDetail): boolean {
  if (!Object.hasOwn(d, "administrativeBoundary")) return d.currentAction === null || d.currentAction === "clock_out";
  try { const b = parseAdministrativeClosureBoundary(d.administrativeBoundary);
    return b.workerId === d.worker.id && b.employeeId === d.worker.employeeId && b.employeeAuthUserId === d.worker.employeeAuthUserId
      && b.tailAction === d.currentAction && b.recordedAt <= d.readAt && d.periods.some(p => p.id === b.employmentPeriodId);
  } catch { return false; }
}
function detail(raw: unknown, siteId: string): EmploymentLifecycleDetail { const hasBoundary = !!raw && typeof raw === "object" && Object.hasOwn(raw, "administrativeBoundary");
  const v = exact(raw, ["worker", "settingsVersion", "timeZone", "today", "readAt", "revision", "state", "periods", "suspension", "originalAction", "currentAction", "canClose", "canRejoin", "closeBlockers", "rejoinBlockers", "pending", ...(hasBoundary ? ["administrativeBoundary"] : [])]);
  if (!Array.isArray(v.periods) || v.periods.length > 100) return fail(); const p = exact(v.pending, ["items", "limited", "historicalPending"]);
  if (!Array.isArray(p.items) || p.items.length > 100 || p.historicalPending !== "not_checked" || p.limited === true && p.items.length) return fail();
  let suspension: EmploymentLifecycleDetail["suspension"] = null;
  if (v.suspension !== null) { const s = exact(v.suspension, ["id", "generation", "wasActive", "paused"]); suspension = { id: id(s.id), generation: integer(s.generation), wasActive: bool(s.wasActive), paused: bool(s.paused) }; }
  const r: EmploymentLifecycleDetail = { worker: worker(v.worker), settingsVersion: integer(v.settingsVersion), timeZone: zone(v.timeZone), today: date(v.today), readAt: stamp(v.readAt),
    revision: integer(v.revision, 0), state: state(v.state), periods: v.periods.map(period), suspension, originalAction: action(v.originalAction), currentAction: action(v.currentAction),
    canClose: bool(v.canClose), canRejoin: bool(v.canRejoin), closeBlockers: blockers(v.closeBlockers), rejoinBlockers: blockers(v.rejoinBlockers),
    pending: { items: p.items.map(pending), limited: bool(p.limited), historicalPending: "not_checked" },
    ...(hasBoundary ? { administrativeBoundary: parseAdministrativeClosureBoundary(v.administrativeBoundary) } : {}) };
  if (hasBoundary && (r.administrativeBoundary!.siteId !== siteId || !employmentLifecycleOperatingOff(r))) fail();
  stateRevision(r.state, r.revision);
  if (new Set(r.periods.map(p => p.id)).size !== r.periods.length || new Set(r.pending.items.map(p => `${p.kind}:${p.id}`)).size !== r.pending.items.length
    || r.canClose !== (r.closeBlockers.length === 0) || r.canRejoin !== (r.rejoinBlockers.length === 0) || r.canClose && r.canRejoin) fail();
  if (r.canClose || r.canRejoin) { if (!r.suspension?.paused || r.worker.active || r.worker.employeeId === null || r.worker.employeeAuthUserId === null || r.worker.employeeVersion === null
    || !r.periods.length || r.pending.limited || r.pending.items.length || !employmentLifecycleOperatingOff(r)) fail();
    let end = ""; for (const p of r.periods) { if (end >= p.startsOn) fail(); end = p.endsOn ?? "9999-12-31"; }
    const last = r.periods.at(-1)!;
    if (r.canClose && (last.endsOn !== null || last.startsOn > r.today || r.state === "closed")
      || r.canRejoin && (r.state !== "closed" || last.endsOn === null || last.endsOn >= r.today)) fail(); }
  return r;
}
function receipt(raw: unknown): EmploymentLifecycleReceipt { const v = exact(raw, ["operationId", "actorId", "workerId", "employeeId", "employeeAuthUserId", "action", "revision", "periodId", "startsOn", "endsOn", "recordedAt", "commandFingerprint"]);
  if (v.action !== "close" && v.action !== "rejoin") fail(); const r: EmploymentLifecycleReceipt = { operationId: id(v.operationId), actorId: id(v.actorId), workerId: id(v.workerId), employeeId: id(v.employeeId), employeeAuthUserId: id(v.employeeAuthUserId),
    action: v.action as EmploymentLifecycleReceipt["action"], revision: integer(v.revision), periodId: id(v.periodId), startsOn: date(v.startsOn), endsOn: v.endsOn === null ? null : date(v.endsOn), recordedAt: stamp(v.recordedAt), commandFingerprint: hash(v.commandFingerprint) };
  if ((r.action === "rejoin") !== (r.endsOn === null) || r.endsOn !== null && r.endsOn < r.startsOn || r.revision % 2 !== (r.action === "close" ? 1 : 0)) fail(); return r; }
export function parseEmploymentLifecycleResult(raw: unknown, input: EmploymentLifecycleQuery, actorId: string, command: EmploymentLifecycleCommand | null = null): EmploymentLifecycleResult { try { tree(raw);
  const q = parseEmploymentLifecycleQuery(input), actor = id(actorId), v = exact(raw, ["siteId", "mode", "items", "nextAfterId", "detail", "history", "nextAfterRevision", "receipt"]);
  if (v.siteId !== q.siteId || v.mode !== q.mode || !Array.isArray(v.items) || v.items.length > 25 || !Array.isArray(v.history) || v.history.length > 25) return fail();
  const r: EmploymentLifecycleResult = { siteId: q.siteId, mode: q.mode, items: v.items.map(item), nextAfterId: nullableId(v.nextAfterId), detail: v.detail === null ? null : detail(v.detail, q.siteId),
    history: v.history.map(receipt), nextAfterRevision: v.nextAfterRevision === null ? null : integer(v.nextAfterRevision), receipt: v.receipt === null ? null : receipt(v.receipt) };
  let prior = q.afterId ?? ""; for (const x of r.items) { if (x.worker.id <= prior) fail(); prior = x.worker.id; }
  let revision = q.afterRevision ?? 0; for (const x of r.history) { if (x.workerId !== q.workerId || x.revision <= revision) fail(); revision = x.revision; }
  if (q.mode !== "list" && (r.items.length || r.nextAfterId !== null) || r.nextAfterId !== null && (r.items.length !== 25 || r.nextAfterId !== prior)
    || q.mode !== "history" && (r.history.length || r.nextAfterRevision !== null) || r.nextAfterRevision !== null && (r.history.length !== 25 || r.nextAfterRevision !== revision)
    || r.detail !== null && (q.mode !== "detail" || command !== null || r.detail.worker.id !== q.workerId)
    || r.receipt && (r.receipt.actorId !== actor || !(q.mode === "recover" || q.mode === "detail" && command))
    || q.mode === "recover" && r.receipt && r.receipt.operationId !== q.operationId
    || q.mode === "detail" && command === null && r.detail === null) fail();
  if (command) { const c = parseEmploymentLifecycleBody({ query: q, command }).command, p = r.receipt;
    if (!p || p.operationId !== c.operationId || p.action !== c.action || p.workerId !== c.workerId || p.employeeId !== c.employeeId || p.employeeAuthUserId !== c.employeeAuthUserId
      || p.revision !== c.expectedRevision + 1 || c.action === "close" && (p.periodId !== c.expectedPeriodId || p.endsOn !== c.expectedDate)
      || c.action === "rejoin" && (p.startsOn !== c.expectedDate || p.periodId === c.expectedPeriodId)) fail(); }
  return freeze(r);
} catch { return fail(); } }
export function parseEmploymentLifecycleResponse(raw: unknown, query: EmploymentLifecycleQuery, actorId: string, command: EmploymentLifecycleCommand | null = null): EmploymentLifecycleResponse { try { tree(raw);
  const v = exact(raw, ["ok", "siteId", "mode", "items", "nextAfterId", "detail", "history", "nextAfterRevision", "receipt"]); if (v.ok !== true) fail(); const { ok: _ok, ...data } = v; void _ok;
  return parseEmploymentLifecycleResult(data, query, actorId, command);
} catch { return fail(); } }
export async function employmentLifecycleCommandFingerprint(siteId: string, raw: EmploymentLifecycleCommand) { const c = parseEmploymentLifecycleCommand(raw);
  const tuple = ["attendance-employment-lifecycle-v1", site(siteId), c.action, c.operationId, c.workerId, c.employeeId, c.employeeAuthUserId, c.expectedWorkerVersion,
    c.expectedEmployeeVersion, c.expectedSettingsVersion, c.expectedRevision, c.expectedPeriodId, c.suspensionId, c.expectedGeneration, c.expectedDate, c.reason];
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(tuple))); return [...new Uint8Array(h)].map(x => x.toString(16).padStart(2, "0")).join(""); }
export function employmentLifecycleReceiptMatches(r: EmploymentLifecycleReceipt, c: EmploymentLifecycleCommand, fingerprint: string) { return r.operationId === c.operationId && r.action === c.action
  && r.workerId === c.workerId && r.employeeId === c.employeeId && r.employeeAuthUserId === c.employeeAuthUserId && r.revision === c.expectedRevision + 1 && r.commandFingerprint === fingerprint
  && (c.action === "close" ? r.periodId === c.expectedPeriodId && r.endsOn === c.expectedDate : r.periodId !== c.expectedPeriodId && r.startsOn === c.expectedDate && r.endsOn === null); }
