import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { captureBrowserExact, parseCaptureBrowserJson } from "./merchantAttendanceRuleCapturesBrowser";

export const ACCOUNT_SUSPENSION_API = "/api/merchant-enterprise/attendance/account-suspensions";
export const ACCOUNT_SUSPENSION_BYTE_LIMIT = 131072;
export const ACCOUNT_SUSPENSION_BODY_BYTE_LIMIT = 8192;
export type AccountSuspensionQuery = { siteId: string; mode: "list" | "detail" | "recover" | "recover-status"; afterId: string | null; suspensionId: string | null; operationId: string | null };
export type AccountSuspensionCommand = { action: "restore"; operationId: string; suspensionId: string; expectedGeneration: number;
  workerId: string | null; expectedWorkerVersion: number | null; expectedEmployeeVersion: number; employeeId: string; employeeAuthUserId: string; reason: string };
export type AccountStatusIntent = { employeeId: string; version: number; status: "active" | "disabled"; offboardingMode?: "unassign" | "reassign"; replacementEmployeeId?: string };
export type AccountStatusCommand = AccountStatusIntent & { operationId: string };
export type AccountSuspensionItem = { suspensionId: string; generation: number; employeeId: string; employeeAuthUserId: string | null;
  employeeName: string; workerId: string | null; workerName: string | null; wasActive: boolean | null; recordedAt: string };
export const ACCOUNT_SUSPENSION_BLOCKERS = ["already_restored", "binding_changed", "employee_inactive", "role_invalid", "location_invalid", "employment_invalid", "employment_closed", "settings_disabled", "worker_missing", "state_binding_changed"] as const;
export type AccountSuspensionBlocker = typeof ACCOUNT_SUSPENSION_BLOCKERS[number];
export type AccountSuspensionAction = "clock_in" | "break_start" | "break_end" | "clock_out" | null;
export type AccountSuspensionDetail = { suspension: AccountSuspensionItem; employeeStatus: "active" | "invited" | "disabled" | null;
  employeeVersion: number | null; workerVersion: number | null; workerActive: boolean | null; originalAction: AccountSuspensionAction; currentAction: AccountSuspensionAction;
  canRestore: boolean; blockers: AccountSuspensionBlocker[]; pinInvalidated: boolean; delegationsInvalidated: boolean;
  pendingReview: { leave: "not_checked"; workArrangement: "not_checked"; missing: "not_checked"; unknownOperations: "not_observable" } };
export type AccountSuspensionReceipt = { operationId: string; actorId: string; suspensionId: string; generation: number; employeeId: string;
  workerId: string | null; workerActive: boolean | null; recordedAt: string; commandFingerprint: string };
export type AccountStatusReceipt = { operationId: string; actorId: string; employeeId: string; expectedVersion: number; version: number;
  status: "active" | "disabled"; suspensionId: string | null; recordedAt: string; commandFingerprint: string };
export type AccountSuspensionResult = { siteId: string; mode: AccountSuspensionQuery["mode"]; items: AccountSuspensionItem[]; nextAfterId: string | null;
  detail: AccountSuspensionDetail | null; receipt: AccountSuspensionReceipt | null; statusReceipt: AccountStatusReceipt | null };
export type AccountSuspensionResponse = AccountSuspensionResult;
export const ACCOUNT_SUSPENSION_ERRORS: Readonly<Record<string, number>> = Object.freeze({ attendance_account_suspension_invalid: 503,
  attendance_account_suspension_changed: 409, attendance_account_suspension_not_found: 404, attendance_account_suspended: 409, attendance_invalid_request: 400, attendance_access_denied: 403,
  attendance_version_conflict: 409, attendance_operation_conflict: 409, attendance_settings_required: 409, attendance_worker_not_found: 404,
  attendance_platform_paused: 403, attendance_unavailable: 503, attendance_rate_limited: 429, attendance_invalid_content_type: 415, attendance_body_too_large: 413 });
const fail = (code = "attendance_account_suspension_invalid"): never => { throw new MerchantAttendanceError(code); };
const exact = (v: unknown, keys: string[]) => captureBrowserExact(v, keys);
const id = (v: unknown): string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v) && v.length === 36 ? v : fail();
const nullableId = (v: unknown) => v === null ? null : id(v);
const site = (v: unknown): string => typeof v === "string" && v.length === 8 && /^[0-9]{8}$/.test(v) ? v : fail();
const integer = (v: unknown): number => typeof v === "number" && Number.isSafeInteger(v) && v >= 1 ? v : fail();
const nullableInteger = (v: unknown) => v === null ? null : integer(v);
const bool = (v: unknown): boolean => typeof v === "boolean" ? v : fail();
const nullableBool = (v: unknown) => v === null ? null : bool(v);
const label = (v: unknown, max = 120): string => typeof v === "string" && v === v.trim() && [...v].length >= 1 && [...v].length <= max && !/[\u0000-\u001f\u007f-\u009f]/.test(v) ? v : fail();
const hash = (v: unknown): string => typeof v === "string" && v.length === 64 && /^[0-9a-f]+$/.test(v) ? v : fail();
const stamp = (v: unknown): string => { if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(v) || v.startsWith("0000")) return fail();
  const ms = v.slice(0, 23) + "Z", n = Date.parse(ms); return Number.isFinite(n) && new Date(n).toISOString() === ms ? v : fail(); };
function freeze<T>(v: T): T { if (v && typeof v === "object") { Object.values(v).forEach(freeze); Object.freeze(v); } return v; }
export function validateAccountSuspensionTree(raw: unknown, limit = ACCOUNT_SUSPENSION_BYTE_LIMIT) {
  let count = 0; const seen = new Set<object>();
  const walk = (v: unknown, depth: number) => { if (++count > 8000 || depth > 12) return fail();
    if (v === null || typeof v === "boolean") return;
    if (typeof v === "string") { for (let i = 0; i < v.length; i++) { const c = v.charCodeAt(i); if (c >= 0xd800 && c <= 0xdbff) { const next = v.charCodeAt(++i); if (!(next >= 0xdc00 && next <= 0xdfff)) fail(); } else if (c >= 0xdc00 && c <= 0xdfff) fail(); } return; }
    if (typeof v === "number") { if (!Number.isSafeInteger(v) || Object.is(v, -0)) fail(); return; }
    if (typeof v !== "object" || seen.has(v)) return fail(); seen.add(v);
    const proto = Object.getPrototypeOf(v), ds = Object.getOwnPropertyDescriptors(v), keys = Reflect.ownKeys(ds);
    if (Array.isArray(v)) { if (proto !== Array.prototype || v.length > 100 || keys.length !== v.length + 1) fail(); for (let i = 0; i < v.length; i++) { const d = ds[String(i)]; if (!d || !("value" in d) || !d.enumerable) fail(); walk(d.value, depth + 1); } }
    else { if (proto !== Object.prototype && proto !== null) fail(); for (const k of keys) { if (typeof k !== "string" || ["__proto__", "constructor", "prototype"].includes(k)) return fail(); const d = ds[k]; if (!("value" in d) || !d.enumerable) fail(); walk(d.value, depth + 1); } } seen.delete(v); };
  walk(raw, 0); if (new TextEncoder().encode(JSON.stringify(raw)).byteLength > limit) fail();
}
export function parseAccountSuspensionJson(raw: string, kind: "request" | "response" = "response") { try { const limit = kind === "request" ? ACCOUNT_SUSPENSION_BODY_BYTE_LIMIT : ACCOUNT_SUSPENSION_BYTE_LIMIT;
  if (typeof raw !== "string" || new TextEncoder().encode(raw).byteLength > limit) fail(); const value = parseCaptureBrowserJson(raw); validateAccountSuspensionTree(value, limit); return value;
} catch { return fail(kind === "request" ? "attendance_invalid_request" : undefined); } }
export function parseAccountSuspensionQuery(raw: unknown): AccountSuspensionQuery { try { validateAccountSuspensionTree(raw, ACCOUNT_SUSPENSION_BODY_BYTE_LIMIT);
  const q = exact(raw, ["siteId", "mode", "afterId", "suspensionId", "operationId"]), result = { siteId: site(q.siteId), mode: q.mode as AccountSuspensionQuery["mode"], afterId: nullableId(q.afterId), suspensionId: nullableId(q.suspensionId), operationId: nullableId(q.operationId) };
  if (!["list", "detail", "recover", "recover-status"].includes(result.mode) || result.afterId !== null && result.mode !== "list"
    || (result.mode === "detail") !== (result.suspensionId !== null) || ["recover", "recover-status"].includes(result.mode) !== (result.operationId !== null)) fail(); return freeze(result);
} catch { return fail("attendance_invalid_request"); } }
export function parseAccountSuspensionHttpQuery(url: string): AccountSuspensionQuery { try { const p = new URL(url).searchParams, q: Record<string, unknown> = { afterId: null, suspensionId: null, operationId: null };
  const seen = new Set<string>(); for (const [k, v] of p) { if (!["siteId", "mode", "afterId", "suspensionId", "operationId"].includes(k) || seen.has(k) || !v) fail(); seen.add(k); q[k] = v; } return parseAccountSuspensionQuery(q);
} catch { return fail("attendance_invalid_request"); } }
export function accountSuspensionQueryString(raw: AccountSuspensionQuery) { const q = parseAccountSuspensionQuery(raw), p = new URLSearchParams(); for (const [k, v] of Object.entries(q)) if (v !== null) p.set(k, v); return p.toString(); }
export function parseAccountSuspensionCommand(raw: unknown): AccountSuspensionCommand { try { validateAccountSuspensionTree(raw, ACCOUNT_SUSPENSION_BODY_BYTE_LIMIT);
  const c = exact(raw, ["action", "operationId", "suspensionId", "expectedGeneration", "workerId", "expectedWorkerVersion", "expectedEmployeeVersion", "employeeId", "employeeAuthUserId", "reason"]);
  if (c.action !== "restore") fail(); const r: AccountSuspensionCommand = { action: "restore", operationId: id(c.operationId), suspensionId: id(c.suspensionId), expectedGeneration: integer(c.expectedGeneration),
    workerId: nullableId(c.workerId), expectedWorkerVersion: nullableInteger(c.expectedWorkerVersion), expectedEmployeeVersion: integer(c.expectedEmployeeVersion), employeeId: id(c.employeeId), employeeAuthUserId: id(c.employeeAuthUserId), reason: label(c.reason, 500) };
  if ((r.workerId === null) !== (r.expectedWorkerVersion === null)) fail(); return freeze(r);
} catch { return fail("attendance_invalid_request"); } }
export function parseAccountSuspensionBody(raw: unknown) { try { validateAccountSuspensionTree(raw, ACCOUNT_SUSPENSION_BODY_BYTE_LIMIT); const b = exact(raw, ["query", "command"]), query = parseAccountSuspensionQuery(b.query), command = parseAccountSuspensionCommand(b.command);
  if (query.mode !== "detail" || query.suspensionId !== command.suspensionId) fail(); return freeze({ query, command }); } catch { return fail("attendance_invalid_request"); } }
export function parseAccountStatusCommand(raw: unknown): AccountStatusCommand { try { validateAccountSuspensionTree(raw, ACCOUNT_SUSPENSION_BODY_BYTE_LIMIT); const keys = Object.keys(raw as object), optional = keys.filter(k => ["offboardingMode", "replacementEmployeeId"].includes(k));
  const c = exact(raw, ["operationId", "employeeId", "version", "status", ...optional]); if (c.status !== "active" && c.status !== "disabled") fail();
  const r: AccountStatusCommand = { operationId: id(c.operationId), employeeId: id(c.employeeId), version: integer(c.version), status: c.status as AccountStatusCommand["status"] };
  if ("offboardingMode" in c) { if (c.offboardingMode !== "unassign" && c.offboardingMode !== "reassign" || r.status !== "disabled") fail(); r.offboardingMode = c.offboardingMode as "unassign" | "reassign"; }
  if ("replacementEmployeeId" in c) r.replacementEmployeeId = id(c.replacementEmployeeId);
  if ((r.offboardingMode === "reassign") !== (r.replacementEmployeeId !== undefined) || r.replacementEmployeeId === r.employeeId) fail(); return freeze(r);
} catch { return fail("attendance_invalid_request"); } }
function item(raw: unknown): AccountSuspensionItem { const v = exact(raw, ["suspensionId", "generation", "employeeId", "employeeAuthUserId", "employeeName", "workerId", "workerName", "wasActive", "recordedAt"]);
  const r = { suspensionId: id(v.suspensionId), generation: integer(v.generation), employeeId: id(v.employeeId), employeeAuthUserId: nullableId(v.employeeAuthUserId), employeeName: label(v.employeeName), workerId: nullableId(v.workerId), workerName: v.workerName === null ? null : label(v.workerName), wasActive: nullableBool(v.wasActive), recordedAt: stamp(v.recordedAt) };
  if (r.workerId === null ? r.workerName !== null || r.wasActive !== null : r.workerName === null || r.wasActive === null) fail(); return r; }
function action(v: unknown): AccountSuspensionAction { return v === null || v === "clock_in" || v === "clock_out" || v === "break_start" || v === "break_end" ? v : fail(); }
function detail(raw: unknown): AccountSuspensionDetail { const v = exact(raw, ["suspension", "employeeStatus", "employeeVersion", "workerVersion", "workerActive", "originalAction", "currentAction", "canRestore", "blockers", "pinInvalidated", "delegationsInvalidated", "pendingReview"]);
  if (![null, "active", "disabled", "invited"].includes(v.employeeStatus as string | null) || !Array.isArray(v.blockers) || v.blockers.length > ACCOUNT_SUSPENSION_BLOCKERS.length || new Set(v.blockers).size !== v.blockers.length || v.blockers.some(x => !ACCOUNT_SUSPENSION_BLOCKERS.includes(x))) return fail();
  const pending = exact(v.pendingReview, ["leave", "workArrangement", "missing", "unknownOperations"]); if (pending.leave !== "not_checked" || pending.workArrangement !== "not_checked" || pending.missing !== "not_checked" || pending.unknownOperations !== "not_observable") fail();
  const r: AccountSuspensionDetail = { suspension: item(v.suspension), employeeStatus: v.employeeStatus as AccountSuspensionDetail["employeeStatus"], employeeVersion: nullableInteger(v.employeeVersion), workerVersion: nullableInteger(v.workerVersion), workerActive: nullableBool(v.workerActive), originalAction: action(v.originalAction), currentAction: action(v.currentAction), canRestore: bool(v.canRestore), blockers: v.blockers as AccountSuspensionBlocker[], pinInvalidated: bool(v.pinInvalidated), delegationsInvalidated: bool(v.delegationsInvalidated), pendingReview: { leave: "not_checked", workArrangement: "not_checked", missing: "not_checked", unknownOperations: "not_observable" } };
  if (r.canRestore && (r.blockers.length !== 0 || r.employeeStatus !== "active" || r.employeeVersion === null || r.suspension.employeeAuthUserId === null || r.suspension.workerId !== null && r.workerVersion === null)
    || r.blockers.length === 0 && !r.canRestore || r.suspension.workerId === null && (r.originalAction !== null || r.currentAction !== null
      || (r.workerVersion !== null || r.workerActive !== null) && !r.blockers.includes("binding_changed"))) fail(); return r; }
function restoreReceipt(raw: unknown): AccountSuspensionReceipt { const v = exact(raw, ["operationId", "actorId", "suspensionId", "generation", "employeeId", "workerId", "workerActive", "recordedAt", "commandFingerprint"]);
  const r = { operationId: id(v.operationId), actorId: id(v.actorId), suspensionId: id(v.suspensionId), generation: integer(v.generation), employeeId: id(v.employeeId), workerId: nullableId(v.workerId), workerActive: nullableBool(v.workerActive), recordedAt: stamp(v.recordedAt), commandFingerprint: hash(v.commandFingerprint) };
  if ((r.workerId === null) !== (r.workerActive === null)) fail(); return r; }
function statusReceipt(raw: unknown): AccountStatusReceipt { const v = exact(raw, ["operationId", "actorId", "employeeId", "expectedVersion", "version", "status", "suspensionId", "recordedAt", "commandFingerprint"]);
  if (v.status !== "active" && v.status !== "disabled") return fail(); const r: AccountStatusReceipt = { operationId: id(v.operationId), actorId: id(v.actorId), employeeId: id(v.employeeId), expectedVersion: integer(v.expectedVersion), version: integer(v.version), status: v.status, suspensionId: nullableId(v.suspensionId), recordedAt: stamp(v.recordedAt), commandFingerprint: hash(v.commandFingerprint) };
  if (r.version !== r.expectedVersion + 1) fail(); return r; }
export function parseAccountSuspensionResult(raw: unknown, input: AccountSuspensionQuery, actorId: string, command: AccountSuspensionCommand | null = null): AccountSuspensionResult { try {
  validateAccountSuspensionTree(raw); const q = parseAccountSuspensionQuery(input), actor = id(actorId), v = exact(raw, ["siteId", "mode", "items", "nextAfterId", "detail", "receipt", "statusReceipt"]);
  if (v.siteId !== q.siteId || v.mode !== q.mode || !Array.isArray(v.items) || v.items.length > 25) return fail();
  const r: AccountSuspensionResult = { siteId: q.siteId, mode: q.mode, items: v.items.map(item), nextAfterId: nullableId(v.nextAfterId), detail: v.detail === null ? null : detail(v.detail), receipt: v.receipt === null ? null : restoreReceipt(v.receipt), statusReceipt: v.statusReceipt === null ? null : statusReceipt(v.statusReceipt) };
  let prior = q.afterId ?? ""; for (const x of r.items) { if (x.suspensionId <= prior) fail(); prior = x.suspensionId; }
  if (q.mode !== "list" && (r.items.length || r.nextAfterId !== null) || r.nextAfterId !== null && (r.items.length !== 25 || r.nextAfterId !== prior)
    || q.mode !== "detail" && r.detail !== null || r.detail && r.detail.suspension.suspensionId !== q.suspensionId
    || r.receipt && !(q.mode === "recover" || q.mode === "detail" && command) || r.statusReceipt && q.mode !== "recover-status"
    || r.receipt && (r.receipt.actorId !== actor || q.mode === "recover" && r.receipt.operationId !== q.operationId)
    || r.statusReceipt && (r.statusReceipt.actorId !== actor || r.statusReceipt.operationId !== q.operationId)) fail();
  if (command) { const c = parseAccountSuspensionCommand(command); if (q.mode !== "detail" || c.suspensionId !== q.suspensionId || !r.receipt || r.receipt.operationId !== c.operationId || r.receipt.suspensionId !== c.suspensionId || r.receipt.generation !== c.expectedGeneration || r.receipt.employeeId !== c.employeeId || r.receipt.workerId !== c.workerId) fail(); }
  return freeze(r);
} catch { return fail(); } }
export function parseAccountSuspensionResponse(raw: unknown, query: AccountSuspensionQuery, actorId: string, command: AccountSuspensionCommand | null = null): AccountSuspensionResponse { try { validateAccountSuspensionTree(raw);
  const v = exact(raw, ["ok", "siteId", "mode", "items", "nextAfterId", "detail", "receipt", "statusReceipt"]); if (v.ok !== true) fail(); const { ok: _ok, ...data } = v; void _ok; return parseAccountSuspensionResult(data, query, actorId, command);
} catch { return fail(); } }
async function fingerprint(tuple: unknown[]) { const bytes = new TextEncoder().encode(JSON.stringify(tuple)), h = await crypto.subtle.digest("SHA-256", bytes); return [...new Uint8Array(h)].map(x => x.toString(16).padStart(2, "0")).join(""); }
export async function accountSuspensionCommandFingerprint(siteId: string, raw: AccountSuspensionCommand) { const c = parseAccountSuspensionCommand(raw); return fingerprint(["attendance-account-restore-v1", site(siteId), c.action, c.operationId, c.suspensionId, c.expectedGeneration, c.workerId, c.expectedWorkerVersion, c.expectedEmployeeVersion, c.employeeId, c.employeeAuthUserId, c.reason]); }
export async function accountStatusCommandFingerprint(siteId: string, raw: AccountStatusCommand) { const c = parseAccountStatusCommand(raw); return fingerprint(["attendance-account-status-v1", site(siteId), c.operationId, c.employeeId, c.version, c.status, c.offboardingMode ?? null, c.replacementEmployeeId ?? null]); }
export function accountSuspensionReceiptMatches(r: AccountSuspensionReceipt, c: AccountSuspensionCommand, fingerprint: string) { return r.operationId === c.operationId && r.suspensionId === c.suspensionId && r.generation === c.expectedGeneration && r.employeeId === c.employeeId && r.workerId === c.workerId && r.commandFingerprint === fingerprint; }
export function accountStatusReceiptMatches(r: AccountStatusReceipt, c: AccountStatusCommand, fingerprint: string) { return r.operationId === c.operationId && r.employeeId === c.employeeId && r.expectedVersion === c.version && r.version === c.version + 1 && r.status === c.status && r.commandFingerprint === fingerprint; }
