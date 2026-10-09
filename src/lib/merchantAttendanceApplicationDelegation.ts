import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { captureBrowserExact, parseCaptureBrowserJson } from "./merchantAttendanceRuleCapturesBrowser";
import { LEAVE_ERRORS } from "./merchantAttendanceLeave";
import { WORK_ARRANGEMENT_ERRORS } from "./merchantAttendanceWorkArrangement";

export const APPLICATION_DELEGATION_API = "/api/merchant-enterprise/attendance/application-delegation";
export const APPLICATION_DELEGATION_BYTE_LIMIT = 131072;
export const APPLICATION_DELEGATION_BODY_BYTE_LIMIT = 8192;
export type ApplicationDelegationAccess = "owner" | "delegate";
export type ApplicationDelegationCatalog = "delegates" | "workers";
export type ApplicationDelegationOwnerQuery = { siteId: string; access: "owner"; mode: "list" | "catalog" | "detail" | "recover";
  catalog: ApplicationDelegationCatalog | null; afterId: string | null; grantId: string | null; operationId: string | null };
export type ApplicationDelegationDelegateQuery = { siteId: string; access: "delegate"; mode: "grants" | "list" | "detail" | "decide" | "recover";
  grantId: string | null; requestId: string | null; operationId: string | null; beforeAt: string | null; beforeId: string | null; afterId: string | null };
export type ApplicationDelegationQuery = ApplicationDelegationOwnerQuery | ApplicationDelegationDelegateQuery;
export type ApplicationDelegationCategory = "leave" | "work_arrangement";
export type ApplicationDelegationKind = "trip" | "field" | "remote";
export type ApplicationDelegationGrantCommand = { action: "grant"; operationId: string; delegateEmployeeId: string; delegateAuthUserId: string;
  workerId: string; employeeId: string; employeeAuthUserId: string; category: ApplicationDelegationCategory; kinds: ApplicationDelegationKind[]; includePending: boolean; validFrom: string; validUntil: string; reason: string };
export type ApplicationDelegationRevokeCommand = { action: "revoke"; operationId: string; grantId: string; expectedRevision: 1; reason: string };
export type ApplicationDelegationDecision = { operationId: string; requestId: string; expectedRevision: 1; reason: string } &
  ({ action: "approve" | "reject" } | { action: "approve"; expectedConflictsFingerprint: string; confirmConflicts: boolean });
export type ApplicationDelegationDecideCommand = { grantId: string; expectedGrantRevision: 1; expectedEvidenceFingerprint: string; decision: ApplicationDelegationDecision };
export type ApplicationDelegationCommand = ApplicationDelegationGrantCommand | ApplicationDelegationRevokeCommand | ApplicationDelegationDecideCommand;
export type ApplicationDelegationCatalogItem = { id: string; name: string; employeeId: string | null; employeeAuthUserId: string | null; workerNo: string | null; timeZone: string | null };
export type ApplicationDelegationGrant = { grantId: string; revision: 1 | 2; status: "granted" | "revoked";
  delegate: { employeeId: string; authUserId: string; name: string }; worker: { workerId: string; employeeId: string; authUserId: string; name: string; workerNo: string };
  category: ApplicationDelegationCategory; kinds: ApplicationDelegationKind[]; includePending: boolean; validFrom: string; validUntil: string; grantedBy: string; grantedAt: string; reason: string;
  revocation: null | { operationId: string; actorId: string; reason: string; recordedAt: string }; usable: boolean };
export type ApplicationDelegationSummary = { requestId: string; workerId: string; employeeId: string; employeeAuthUserId: string; workerName: string;
  category: ApplicationDelegationCategory; kind: ApplicationDelegationKind | null; startAt: string; endAt: string; timeZone: string; submittedAt: string; status: "submitted" };
export type ApplicationDelegationConflict = { source: "schedule" | "application"; kind: ApplicationDelegationKind | "leave" | null; startAt: string; endAt: string; timeZone: string };
export type ApplicationDelegationDetail = ApplicationDelegationSummary & { reason: string; evidenceFingerprint: string; conflictsFingerprint: string;
  conflicts: ApplicationDelegationConflict[]; blocked: boolean; sealed: boolean; canApprove: boolean; canReject: boolean };
export type ApplicationDelegationOwnerReceipt = { operationId: string; action: "grant" | "revoke"; grantId: string; revision: 1 | 2; recordedAt: string; commandFingerprint: string };
export type ApplicationDelegationDecisionReceipt = { operationId: string; requestId: string; grantId: string; category: ApplicationDelegationCategory; action: "approve" | "reject"; status: "approved" | "rejected";
  actorId: string; recordedAt: string; commandFingerprint: string };
export type ApplicationDelegationOwnerResponse = { protocol: "application-delegations-v1"; siteId: string; actorId: string; mode: ApplicationDelegationOwnerQuery["mode"];
  timeZone: string; canWrite: boolean; items: ApplicationDelegationGrant[]; catalogItems: ApplicationDelegationCatalogItem[]; nextId: string | null;
  detail: ApplicationDelegationGrant | null; receipt: ApplicationDelegationOwnerReceipt | null; readAt: string };
export type ApplicationDelegationDelegateResponse = { protocol: "delegated-applications-v1"; siteId: string; actorId: string; employeeId: string; mode: ApplicationDelegationDelegateQuery["mode"];
  canWrite: boolean; grants: ApplicationDelegationGrant[]; items: ApplicationDelegationSummary[]; nextCursor: { at: string; id: string } | null; nextId: string | null;
  detail: ApplicationDelegationDetail | null; receipt: ApplicationDelegationDecisionReceipt | null; readAt: string };
export type ApplicationDelegationResponse = ApplicationDelegationOwnerResponse | ApplicationDelegationDelegateResponse;
export type ApplicationDelegationIdentity = { ownerId?: string; employeeId?: string; authUserId?: string };
export const APPLICATION_DELEGATION_ERRORS: Readonly<Record<string, number>> = Object.freeze({ ...LEAVE_ERRORS, ...WORK_ARRANGEMENT_ERRORS,
  attendance_application_delegation_invalid: 503, attendance_application_delegation_too_large: 422, attendance_application_delegation_not_found: 404,
  attendance_application_delegation_disabled: 403, attendance_application_delegation_evidence_changed: 409, attendance_period_sealed: 409,
  attendance_invalid_content_type: 415, attendance_body_too_large: 413, attendance_not_available: 404, attendance_rate_limited: 429,
  attendance_unavailable: 503, attendance_access_denied: 403, attendance_platform_paused: 403, attendance_invalid_request: 400 });
const fail = (code = "attendance_application_delegation_invalid"): never => { throw new MerchantAttendanceError(code); };
const exact = (v: unknown, keys: string[]) => captureBrowserExact(v, keys);
const text = (v: unknown, max = 200) => typeof v === "string" && v === v.trim() && [...v].length > 0 && [...v].length <= max
  && !/[\u0000-\u001f\u007f-\u009f]/.test(v) ? v : fail();
const uuid = (v: unknown) => typeof v === "string" && v.length === 36 && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v) ? v : fail();
const site = (v: unknown) => typeof v === "string" && v.length === 8 && /^[0-9]{8}$/.test(v) ? v : fail();
const nullableId = (v: unknown) => v === null ? null : uuid(v);
const bool = (v: unknown) => typeof v === "boolean" ? v : fail();
const digest = (v: unknown, length = 64) => typeof v === "string" && v.length === length && /^[a-f0-9]+$/.test(v) ? v : fail();
const stamp = (v: unknown) => {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(v) || v.startsWith("0000")) return fail();
  const ms = v.slice(0, 23) + "Z", parsed = Date.parse(ms); if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== ms) return fail(); return v;
};
const stamp3 = (v: unknown) => {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v) || v.startsWith("0000")) return fail();
  const parsed = Date.parse(v); if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== v) return fail(); return v;
};
const category = (v: unknown): ApplicationDelegationCategory => v === "leave" || v === "work_arrangement" ? v : fail();
const KIND_ORDER: ApplicationDelegationKind[] = ["trip", "field", "remote"];
function kinds(v: unknown, c: ApplicationDelegationCategory): ApplicationDelegationKind[] {
  if (!Array.isArray(v) || (c === "leave" ? v.length !== 0 : v.length < 1 || v.length > 3)) return fail();
  let prior = -1; return v.map(k => { const index = KIND_ORDER.indexOf(k); if (index <= prior) return fail(); prior = index; return KIND_ORDER[index]; });
}
function interval(a: unknown, z: unknown, zone: unknown) { const startAt = stamp3(a), endAt = stamp3(z);
  if (endAt <= startAt || Date.parse(startAt) % 60000 || Date.parse(endAt) % 60000 || Date.parse(endAt) - Date.parse(startAt) > 366 * 86400000) return fail();
  return { startAt, endAt, timeZone: text(zone, 100) };
}
function frozen<T>(v: T): T { if (v && typeof v === "object") { Object.values(v).forEach(frozen); Object.freeze(v); } return v; }
export function validateApplicationDelegationTree(raw: unknown, limit = APPLICATION_DELEGATION_BYTE_LIMIT) {
  let count = 0; const seen = new Set<object>();
  const walk = (v: unknown, depth: number) => {
    if (++count > 16000 || depth > 14) return fail();
    if (v === null || typeof v === "boolean") return;
    if (typeof v === "string") { for (let i = 0; i < v.length; i++) { const n = v.charCodeAt(i); if (n >= 0xd800 && n <= 0xdbff) { const next = v.charCodeAt(++i); if (!(next >= 0xdc00 && next <= 0xdfff)) fail(); } else if (n >= 0xdc00 && n <= 0xdfff) fail(); } return; }
    if (typeof v === "number") { if (!Number.isSafeInteger(v) || Object.is(v, -0)) fail(); return; }
    if (typeof v !== "object" || seen.has(v)) return fail(); seen.add(v);
    const proto = Object.getPrototypeOf(v), d = Object.getOwnPropertyDescriptors(v), keys = Reflect.ownKeys(d);
    if (Array.isArray(v)) { if (proto !== Array.prototype || v.length > 100 || keys.length !== v.length + 1) fail();
      for (let i = 0; i < v.length; i++) { const x = d[String(i)]; if (!x || !("value" in x) || !x.enumerable) fail(); walk(x.value, depth + 1); }
    } else { if (proto !== Object.prototype && proto !== null) fail(); for (const k of keys) { if (typeof k !== "string" || ["__proto__", "constructor", "prototype"].includes(k)) return fail();
      const x = d[k]; if (!("value" in x) || !x.enumerable) fail(); walk(x.value, depth + 1); } } seen.delete(v);
  };
  walk(raw, 0); if (new TextEncoder().encode(JSON.stringify(raw)).byteLength > limit) fail();
}
export function parseApplicationDelegationJson(raw: string, kind: "request" | "response" = "response") {
  try { const limit = kind === "request" ? APPLICATION_DELEGATION_BODY_BYTE_LIMIT : APPLICATION_DELEGATION_BYTE_LIMIT;
    if (typeof raw !== "string" || new TextEncoder().encode(raw).byteLength > limit) fail(); const value = parseCaptureBrowserJson(raw); validateApplicationDelegationTree(value, limit); return value;
  } catch { return fail(kind === "request" ? "attendance_invalid_request" : undefined); }
}
export function parseApplicationDelegationQuery(raw: unknown): ApplicationDelegationQuery {
  try { validateApplicationDelegationTree(raw, APPLICATION_DELEGATION_BODY_BYTE_LIMIT); const access = Object.getOwnPropertyDescriptor(raw, "access")?.value;
    if (access === "owner") { const q = exact(raw, ["siteId", "access", "mode", "catalog", "afterId", "grantId", "operationId"]);
      const result: ApplicationDelegationOwnerQuery = { siteId: site(q.siteId), access, mode: q.mode as ApplicationDelegationOwnerQuery["mode"], catalog: q.catalog as ApplicationDelegationCatalog | null,
        afterId: nullableId(q.afterId), grantId: nullableId(q.grantId), operationId: nullableId(q.operationId) };
      if (!["list", "catalog", "detail", "recover"].includes(result.mode) || (result.mode === "catalog" ? !["delegates", "workers"].includes(String(result.catalog)) : result.catalog !== null)
        || (result.mode === "detail") !== (result.grantId !== null) || (result.mode === "recover") !== (result.operationId !== null)
        || result.afterId !== null && !["list", "catalog"].includes(result.mode)) fail(); return frozen(result);
    }
    if (access !== "delegate") return fail(); const q = exact(raw, ["siteId", "access", "mode", "grantId", "requestId", "operationId", "beforeAt", "beforeId", "afterId"]);
    const result: ApplicationDelegationDelegateQuery = { siteId: site(q.siteId), access, mode: q.mode as ApplicationDelegationDelegateQuery["mode"], grantId: nullableId(q.grantId), requestId: nullableId(q.requestId),
      operationId: nullableId(q.operationId), beforeAt: q.beforeAt === null ? null : stamp(q.beforeAt), beforeId: nullableId(q.beforeId), afterId: nullableId(q.afterId) };
    if (!["grants", "list", "detail", "decide", "recover"].includes(result.mode) || ["list", "detail", "decide"].includes(result.mode) !== (result.grantId !== null)
      || ["detail", "decide"].includes(result.mode) !== (result.requestId !== null) || (result.mode === "recover") !== (result.operationId !== null)
      || (result.beforeAt === null) !== (result.beforeId === null) || result.beforeAt !== null && result.mode !== "list" || result.afterId !== null && result.mode !== "grants") fail(); return frozen(result);
  } catch { return fail("attendance_invalid_request"); }
}
export function parseApplicationDelegationHttpQuery(url: string): ApplicationDelegationQuery {
  try { const p = new URL(url).searchParams, v: Record<string, unknown> = p.get("access") === "owner"
    ? { catalog: null, afterId: null, grantId: null, operationId: null } : { grantId: null, requestId: null, operationId: null, beforeAt: null, beforeId: null, afterId: null };
    for (const [k, value] of p) { if (p.getAll(k).length !== 1) fail(); v[k] = value; } const q = parseApplicationDelegationQuery(v); if (q.mode === "decide") fail(); return q;
  } catch { return fail("attendance_invalid_request"); }
}
export function applicationDelegationQueryString(raw: ApplicationDelegationQuery) { const q = parseApplicationDelegationQuery(raw), p = new URLSearchParams(); for (const [k, v] of Object.entries(q)) if (v !== null) p.set(k, v); return p.toString(); }
export function parseApplicationDelegationCommand(raw: unknown): ApplicationDelegationCommand {
  try { validateApplicationDelegationTree(raw, APPLICATION_DELEGATION_BODY_BYTE_LIMIT); const action = Object.getOwnPropertyDescriptor(raw, "action")?.value;
    if (action === "grant") { const c = exact(raw, ["action", "operationId", "delegateEmployeeId", "delegateAuthUserId", "workerId", "employeeId", "employeeAuthUserId", "category", "kinds", "includePending", "validFrom", "validUntil", "reason"]);
      const result: ApplicationDelegationGrantCommand = { action, operationId: uuid(c.operationId), delegateEmployeeId: uuid(c.delegateEmployeeId), delegateAuthUserId: uuid(c.delegateAuthUserId),
        workerId: uuid(c.workerId), employeeId: uuid(c.employeeId), employeeAuthUserId: uuid(c.employeeAuthUserId), category: category(c.category), kinds: kinds(c.kinds, category(c.category)), includePending: bool(c.includePending), validFrom: stamp(c.validFrom), validUntil: stamp(c.validUntil), reason: text(c.reason) };
      if (result.validFrom >= result.validUntil || result.delegateEmployeeId === result.employeeId || result.delegateAuthUserId === result.employeeAuthUserId) fail(); return frozen(result);
    }
    if (action === "revoke") { const c = exact(raw, ["action", "operationId", "grantId", "expectedRevision", "reason"]); if (c.expectedRevision !== 1) fail(); return frozen({ action, operationId: uuid(c.operationId), grantId: uuid(c.grantId), expectedRevision: 1 as const, reason: text(c.reason) }); }
    const c = exact(raw, ["grantId", "expectedGrantRevision", "expectedEvidenceFingerprint", "decision"]);
    const full = Object.hasOwn(c.decision as object, "expectedConflictsFingerprint");
    const d = exact(c.decision, ["action", "operationId", "requestId", "expectedRevision", "reason", ...(full ? ["expectedConflictsFingerprint", "confirmConflicts"] : [])]);
    if (c.expectedGrantRevision !== 1 || d.expectedRevision !== 1 || d.action !== "approve" && d.action !== "reject") return fail();
    if (full && d.action !== "approve") return fail();
    const decision: ApplicationDelegationDecision = { action: d.action, operationId: uuid(d.operationId), requestId: uuid(d.requestId), expectedRevision: 1, reason: text(d.reason),
      ...(full ? { expectedConflictsFingerprint: digest(d.expectedConflictsFingerprint), confirmConflicts: bool(d.confirmConflicts) } : {}) };
    return frozen({ grantId: uuid(c.grantId), expectedGrantRevision: 1, expectedEvidenceFingerprint: digest(c.expectedEvidenceFingerprint), decision });
  } catch { return fail("attendance_invalid_request"); }
}
export function parseApplicationDelegationBody(raw: unknown) {
  try { validateApplicationDelegationTree(raw, APPLICATION_DELEGATION_BODY_BYTE_LIMIT); const b = exact(raw, ["query", "command"]), query = parseApplicationDelegationQuery(b.query), command = parseApplicationDelegationCommand(b.command);
    if (query.operationId !== null || query.afterId !== null) fail();
    if (query.access === "owner") { if (!("action" in command) || query.mode !== (command.action === "grant" ? "list" : "detail")
      || command.action === "revoke" && query.grantId !== command.grantId) fail(); }
    else if (!("decision" in command) || query.mode !== "decide" || query.grantId !== command.grantId || query.requestId !== command.decision.requestId || query.beforeAt !== null) fail();
    return frozen({ query, command });
  } catch { return fail("attendance_invalid_request"); }
}
export function applicationDelegationOperation(c: ApplicationDelegationCommand) { return "decision" in c ? c.decision.operationId : c.operationId; }
export function applicationDelegationFingerprintText(siteId: string, access: ApplicationDelegationAccess, raw: ApplicationDelegationCommand) {
  const c = parseApplicationDelegationCommand(raw), head: (string | number)[] = ["attendance-application-delegation-v1", site(siteId), access];
  if (access !== ("decision" in c ? "delegate" : "owner")) return fail("attendance_invalid_request");
  const tail = "decision" in c ? [c.decision.action, c.decision.operationId, c.grantId, c.expectedGrantRevision, c.expectedEvidenceFingerprint, c.decision.requestId, c.decision.expectedRevision, c.decision.reason,
      "expectedConflictsFingerprint" in c.decision ? c.decision.expectedConflictsFingerprint : null, "confirmConflicts" in c.decision ? c.decision.confirmConflicts : null]
    : c.action === "grant" ? [c.action, c.operationId, c.delegateEmployeeId, c.delegateAuthUserId, c.workerId, c.employeeId, c.employeeAuthUserId, c.category, c.kinds.join(","), c.includePending, c.validFrom, c.validUntil, c.reason]
      : [c.action, c.operationId, c.grantId, c.expectedRevision, c.reason];
  return `[${[...head, ...tail].map(x => JSON.stringify(x)).join(", ")}]`;
}
export async function applicationDelegationCommandFingerprint(siteId: string, access: ApplicationDelegationAccess, c: ApplicationDelegationCommand) {
  const bytes = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(applicationDelegationFingerprintText(siteId, access, c)));
  return Array.from(new Uint8Array(bytes), x => x.toString(16).padStart(2, "0")).join("");
}
export function applicationDelegationSameCommand(a: ApplicationDelegationCommand, b: ApplicationDelegationCommand) { return JSON.stringify(parseApplicationDelegationCommand(a)) === JSON.stringify(parseApplicationDelegationCommand(b)); }
function grant(raw: unknown): ApplicationDelegationGrant {
  const g = exact(raw, ["grantId", "revision", "status", "delegate", "worker", "category", "kinds", "includePending", "validFrom", "validUntil", "grantedBy", "grantedAt", "reason", "revocation", "usable"]);
  const d = exact(g.delegate, ["employeeId", "authUserId", "name"]), w = exact(g.worker, ["workerId", "employeeId", "authUserId", "name", "workerNo"]);
  const result: ApplicationDelegationGrant = { grantId: uuid(g.grantId), revision: g.revision as 1 | 2, status: g.status as ApplicationDelegationGrant["status"],
    delegate: { employeeId: uuid(d.employeeId), authUserId: uuid(d.authUserId), name: text(d.name, 120) }, worker: { workerId: uuid(w.workerId), employeeId: uuid(w.employeeId), authUserId: uuid(w.authUserId), name: text(w.name, 120), workerNo: text(w.workerNo, 40) },
    category: category(g.category), kinds: kinds(g.kinds, category(g.category)), includePending: bool(g.includePending), validFrom: stamp(g.validFrom), validUntil: stamp(g.validUntil), grantedBy: uuid(g.grantedBy), grantedAt: stamp(g.grantedAt), reason: text(g.reason), revocation: null, usable: bool(g.usable) };
  if (g.revocation !== null) { const r = exact(g.revocation, ["operationId", "actorId", "reason", "recordedAt"]);
    result.revocation = { operationId: uuid(r.operationId), actorId: uuid(r.actorId), reason: text(r.reason), recordedAt: stamp(r.recordedAt) };
    if (result.revocation.operationId === result.grantId) fail(); }
  // Usability is the server's lock-protected observation, not an authority
  // promise at final readAt/receipt/commit time. The decision RPC rechecks it.
  if (result.validFrom >= result.validUntil || result.delegate.employeeId === result.worker.employeeId || result.delegate.authUserId === result.worker.authUserId || result.revision !== (result.revocation ? 2 : 1)
    || result.status !== (result.revocation ? "revoked" : "granted") || result.usable && result.revocation !== null) fail();
  return result;
}
function catalogItem(raw: unknown, kind: ApplicationDelegationCatalog): ApplicationDelegationCatalogItem {
  const c = exact(raw, ["id", "name", "employeeId", "employeeAuthUserId", "workerNo", "timeZone"]);
  const item = { id: uuid(c.id), name: text(c.name, 120), employeeId: nullableId(c.employeeId), employeeAuthUserId: nullableId(c.employeeAuthUserId),
    workerNo: c.workerNo === null ? null : text(c.workerNo, 40), timeZone: c.timeZone === null ? null : text(c.timeZone, 100) };
  if (kind === "delegates" ? item.id !== item.employeeId || item.employeeAuthUserId === null || item.workerNo !== null || item.timeZone !== null
    : kind !== "workers" || item.employeeId === null || item.employeeAuthUserId === null || item.workerNo === null || item.timeZone !== null) fail(); return item;
}
const SUMMARY_KEYS = ["requestId", "workerId", "employeeId", "employeeAuthUserId", "workerName", "category", "kind", "startAt", "endAt", "timeZone", "submittedAt", "status"];
function summary(raw: unknown): ApplicationDelegationSummary {
  const s = exact(raw, SUMMARY_KEYS); if (s.status !== "submitted") return fail();
  const submittedAt = stamp(s.submittedAt), c = category(s.category);
  if (c === "leave" ? s.kind !== null : !KIND_ORDER.includes(s.kind as ApplicationDelegationKind)) return fail();
  return { requestId: uuid(s.requestId), workerId: uuid(s.workerId), employeeId: uuid(s.employeeId), employeeAuthUserId: uuid(s.employeeAuthUserId), workerName: text(s.workerName, 120),
    category: c, kind: s.kind as ApplicationDelegationKind | null, ...interval(s.startAt, s.endAt, s.timeZone), submittedAt, status: "submitted" };
}
function detail(raw: unknown): ApplicationDelegationDetail {
  const d = exact(raw, [...SUMMARY_KEYS, "reason", "evidenceFingerprint", "conflictsFingerprint", "conflicts", "blocked", "sealed", "canApprove", "canReject"]), s = summary(Object.fromEntries(SUMMARY_KEYS.map(k => [k, d[k]])));
  if (!Array.isArray(d.conflicts) || d.conflicts.length > 100) return fail();
  const conflicts: ApplicationDelegationConflict[] = d.conflicts.map(value => { const c = exact(value, ["source", "kind", "startAt", "endAt", "timeZone"]);
    if (c.source !== "schedule" && c.source !== "application" || (c.source === "schedule" ? c.kind !== null : c.kind !== "leave" && !KIND_ORDER.includes(c.kind as ApplicationDelegationKind))) return fail();
    const startAt = stamp3(c.startAt), endAt = stamp3(c.endAt);
    if (endAt <= startAt || startAt >= s.endAt || endAt <= s.startAt) return fail();
    return { source: c.source, kind: c.kind as ApplicationDelegationConflict["kind"], startAt, endAt, timeZone: text(c.timeZone, 100) }; });
  const blocked = bool(d.blocked), sealed = bool(d.sealed), canApprove = bool(d.canApprove), canReject = bool(d.canReject); if (canApprove && (blocked || sealed || !canReject)) fail();
  return { ...s, reason: text(d.reason), evidenceFingerprint: digest(d.evidenceFingerprint), conflictsFingerprint: digest(d.conflictsFingerprint), conflicts, blocked, sealed, canApprove, canReject };
}
function page<T>(raw: unknown, parse: (v: unknown) => T, key: (v: T) => string, after: string | null = null): T[] {
  if (!Array.isArray(raw) || raw.length > 25) return fail(); let previous = after;
  return raw.map(value => { const item = parse(value), id = key(item); if (previous !== null && id <= previous) fail(); previous = id; return item; });
}
const OWNER_KEYS = ["protocol", "siteId", "actorId", "mode", "timeZone", "canWrite", "items", "catalogItems", "nextId", "detail", "receipt", "readAt"];
const DELEGATE_KEYS = ["protocol", "siteId", "actorId", "employeeId", "mode", "canWrite", "grants", "items", "nextCursor", "nextId", "detail", "receipt", "readAt"];
export function applicationDelegationReceiptMatches(receipt: ApplicationDelegationOwnerReceipt | ApplicationDelegationDecisionReceipt,
  c: ApplicationDelegationCommand, fingerprint: string): boolean {
  if (receipt.commandFingerprint !== fingerprint || receipt.operationId !== applicationDelegationOperation(c)) return false;
  // A reject command intentionally carries no category. Its fixed grant/hash
  // is category-bound by SQL; local recovery must not invent a category.
  if ("decision" in c) return "requestId" in receipt && receipt.grantId === c.grantId && receipt.requestId === c.decision.requestId && receipt.action === c.decision.action
    && (c.decision.action !== "approve" || receipt.category === ("expectedConflictsFingerprint" in c.decision ? "work_arrangement" : "leave"));
  return !("requestId" in receipt) && receipt.action === c.action && receipt.grantId === (c.action === "grant" ? c.operationId : c.grantId) && receipt.revision === (c.action === "grant" ? 1 : 2);
}
export function parseApplicationDelegationResult(raw: unknown, input: ApplicationDelegationQuery, expected: ApplicationDelegationIdentity = {}, command: ApplicationDelegationCommand | null = null): ApplicationDelegationResponse {
  try { validateApplicationDelegationTree(raw); const q = parseApplicationDelegationQuery(input), v = exact(raw, q.access === "owner" ? OWNER_KEYS : DELEGATE_KEYS);
    const actorId = uuid(v.actorId), readAt = stamp(v.readAt), canWrite = bool(v.canWrite);
    if (v.siteId !== q.siteId || v.mode !== q.mode || expected.authUserId !== undefined && expected.authUserId !== actorId
      || expected.ownerId !== undefined && (q.access !== "owner" || actorId !== expected.ownerId) || expected.employeeId !== undefined && q.access !== "delegate") fail();
    if (command) parseApplicationDelegationBody({ query: q, command });
    const operationId = command ? applicationDelegationOperation(command) : q.operationId;
    if (q.access === "owner") {
      if (v.protocol !== "application-delegations-v1") return fail();
      const items = page(v.items, x => grant(x), x => x.grantId, q.afterId);
      const catalogItems = page(v.catalogItems, x => catalogItem(x, q.catalog!), x => x.id, q.afterId), nextId = nullableId(v.nextId);
      const selected = v.detail === null ? null : grant(v.detail); let receipt: ApplicationDelegationOwnerReceipt | null = null;
      if (v.receipt !== null) { const r = exact(v.receipt, ["operationId", "action", "grantId", "revision", "recordedAt", "commandFingerprint"]);
        if (r.action !== "grant" && r.action !== "revoke" || r.revision !== (r.action === "grant" ? 1 : 2)) fail();
        receipt = { operationId: uuid(r.operationId), action: r.action as "grant" | "revoke", grantId: uuid(r.grantId), revision: r.revision as 1 | 2, recordedAt: stamp(r.recordedAt), commandFingerprint: digest(r.commandFingerprint) };
        if (receipt.operationId !== operationId || receipt.action === "grant" && receipt.grantId !== receipt.operationId
          || command && !applicationDelegationReceiptMatches(receipt, command, receipt.commandFingerprint)) fail(); }
      if (command || q.mode === "recover") { if (items.length || catalogItems.length || selected || nextId || command && !receipt) fail(); }
      else if (receipt || q.mode === "list" && (catalogItems.length || selected) || q.mode === "catalog" && (items.length || selected)
        || q.mode === "detail" && (items.length || catalogItems.length || nextId || !selected || selected.grantId !== q.grantId)) fail();
      const entries = q.mode === "catalog" ? catalogItems : items;
      if (nextId && (entries.length !== 25 || nextId !== (q.mode === "catalog" ? catalogItems.at(-1)!.id : items.at(-1)!.grantId))) fail();
      return frozen({ protocol: "application-delegations-v1", siteId: q.siteId, actorId, mode: q.mode, timeZone: text(v.timeZone, 100), canWrite, items, catalogItems, nextId, detail: selected, receipt, readAt });
    }
    if (v.protocol !== "delegated-applications-v1") return fail(); const employeeId = uuid(v.employeeId);
    if (expected.employeeId !== undefined && employeeId !== expected.employeeId) fail();
    const grants = page(v.grants, x => grant(x), x => x.grantId, q.afterId), nextId = nullableId(v.nextId);
    if (grants.some(g => g.delegate.employeeId !== employeeId || g.delegate.authUserId !== actorId || !g.usable)) fail();
    if (!Array.isArray(v.items) || v.items.length > 25) return fail(); let priorAt = q.beforeAt, priorId = q.beforeId; const ids = new Set<string>();
    const ownSafe = (s: ApplicationDelegationSummary) => { if (s.employeeId === employeeId || s.employeeAuthUserId === actorId) fail(); };
    const items = v.items.map(x => { const s = summary(x); ownSafe(s);
      if (ids.has(s.requestId) || priorAt && (s.submittedAt > priorAt || s.submittedAt === priorAt && s.requestId >= priorId!)) fail();
      priorAt = s.submittedAt; priorId = s.requestId; ids.add(s.requestId); return s; });
    let nextCursor: ApplicationDelegationDelegateResponse["nextCursor"] = null;
    if (v.nextCursor !== null) { const c = exact(v.nextCursor, ["at", "id"]); nextCursor = { at: stamp(c.at), id: uuid(c.id) };
      if (items.length !== 25 || nextCursor.at !== priorAt || nextCursor.id !== priorId) fail(); }
    const selected = v.detail === null ? null : detail(v.detail); if (selected) { ownSafe(selected); if (selected.requestId !== q.requestId || !canWrite && (selected.canApprove || selected.canReject)) fail(); }
    let receipt: ApplicationDelegationDecisionReceipt | null = null;
    if (v.receipt !== null) { const r = exact(v.receipt, ["operationId", "requestId", "grantId", "category", "action", "status", "actorId", "recordedAt", "commandFingerprint"]);
      if (r.action !== "approve" && r.action !== "reject" || r.status !== (r.action === "approve" ? "approved" : "rejected")) fail();
      receipt = { operationId: uuid(r.operationId), requestId: uuid(r.requestId), grantId: uuid(r.grantId), category: category(r.category), action: r.action as "approve" | "reject", status: r.status as "approved" | "rejected",
        actorId: uuid(r.actorId), recordedAt: stamp(r.recordedAt), commandFingerprint: digest(r.commandFingerprint) };
      if (receipt.actorId !== actorId || receipt.operationId !== operationId
        || command && !applicationDelegationReceiptMatches(receipt, command, receipt.commandFingerprint)) fail(); }
    if (q.mode === "recover" || q.mode === "decide") { if (grants.length || items.length || nextId || nextCursor || selected || q.mode === "decide" && !receipt) fail(); }
    else if (receipt || q.mode === "grants" && (items.length || selected || nextCursor) || q.mode === "list" && (grants.length || selected || nextId)
      || q.mode === "detail" && (grants.length || items.length || nextId || nextCursor || !selected)) fail();
    if (nextId && (q.mode !== "grants" || grants.length !== 25 || grants.at(-1)!.grantId !== nextId)) fail();
    return frozen({ protocol: "delegated-applications-v1", siteId: q.siteId, actorId, employeeId, mode: q.mode, canWrite, grants, items, nextCursor, nextId, detail: selected, receipt, readAt });
  } catch { return fail(); }
}
export function parseApplicationDelegationResponse(raw: unknown, q: ApplicationDelegationQuery, expected: ApplicationDelegationIdentity = {}, command: ApplicationDelegationCommand | null = null): ApplicationDelegationResponse {
  try { validateApplicationDelegationTree(raw); const v = exact(raw, ["ok", ...(q.access === "owner" ? OWNER_KEYS : DELEGATE_KEYS)]); if (v.ok !== true) fail();
    const { ok, ...rest } = v; void ok; return parseApplicationDelegationResult(rest, q, expected, command);
  } catch { return fail(); }
}
