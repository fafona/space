import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { captureBrowserExact, parseCaptureBrowserJson } from "./merchantAttendanceRuleCapturesBrowser";
import { MISSING_ERRORS } from "./merchantAttendanceMissing";
import type { CorrectionProposal } from "./merchantAttendanceCorrection";

export const MISSING_DELEGATION_API = "/api/merchant-enterprise/attendance/missing-delegation";
export const MISSING_DELEGATION_BYTE_LIMIT = 131072;
export const MISSING_DELEGATION_BODY_BYTE_LIMIT = 8192;
export type MissingDelegationAccess = "owner" | "delegate";
export type MissingDelegationCatalog = "delegates" | "workers" | "locations";
export type MissingDelegationOwnerQuery = { siteId: string; access: "owner"; mode: "list" | "catalog" | "detail" | "recover";
  catalog: MissingDelegationCatalog | null; afterId: string | null; grantId: string | null; operationId: string | null };
export type MissingDelegationDelegateQuery = { siteId: string; access: "delegate"; mode: "grants" | "list" | "detail" | "decide" | "recover";
  grantId: string | null; requestId: string | null; operationId: string | null; beforeAt: string | null; beforeId: string | null; afterId: string | null };
export type MissingDelegationQuery = MissingDelegationOwnerQuery | MissingDelegationDelegateQuery;
export type MissingDelegationGrantCommand = { action: "grant"; operationId: string; delegateEmployeeId: string; delegateAuthUserId: string;
  workerId: string; employeeId: string; employeeAuthUserId: string; locationId: string; validFrom: string; validUntil: string; reason: string };
export type MissingDelegationRevokeCommand = { action: "revoke"; operationId: string; grantId: string; expectedRevision: 1; reason: string };
export type MissingDelegationDecision = { action: "approve" | "reject"; operationId: string; requestId: string; expectedRevision: 1; evidenceToken: string; reason: string };
export type MissingDelegationDecideCommand = { grantId: string; expectedGrantRevision: 1; decision: MissingDelegationDecision };
export type MissingDelegationCommand = MissingDelegationGrantCommand | MissingDelegationRevokeCommand | MissingDelegationDecideCommand;
export type MissingDelegationCatalogItem = { id: string; name: string; employeeId: string | null; employeeAuthUserId: string | null; workerNo: string | null; timeZone: string | null };
export type MissingDelegationGrant = { grantId: string; revision: 1 | 2; status: "granted" | "revoked";
  delegate: { employeeId: string; authUserId: string; name: string }; worker: { workerId: string; employeeId: string; authUserId: string; name: string; workerNo: string };
  location: { locationId: string; name: string; timeZone: string }; validFrom: string; validUntil: string; grantedBy: string; grantedAt: string; reason: string;
  revocation: null | { operationId: string; actorId: string; reason: string; recordedAt: string }; usable: boolean };
export type MissingDelegationSummary = { requestId: string; workerId: string; employeeId: string; employeeAuthUserId: string; workerName: string;
  locationId: string; locationName: string; timeZone: string; submittedAt: string; status: "submitted" };
export type MissingDelegationDetail = MissingDelegationSummary & { proposal: CorrectionProposal; reason: string; evidenceToken: string; blocked: boolean; canApprove: boolean; canReject: boolean };
export type MissingDelegationOwnerReceipt = { operationId: string; action: "grant" | "revoke"; grantId: string; revision: 1 | 2; recordedAt: string; commandFingerprint: string };
export type MissingDelegationDecisionReceipt = { operationId: string; requestId: string; grantId: string; action: "approve" | "reject"; status: "approved" | "rejected";
  actorId: string; recordedAt: string; commandFingerprint: string };
export type MissingDelegationOwnerResponse = { protocol: "missing-delegations-v1"; siteId: string; actorId: string; mode: MissingDelegationOwnerQuery["mode"];
  timeZone: string; canWrite: boolean; items: MissingDelegationGrant[]; catalogItems: MissingDelegationCatalogItem[]; nextId: string | null;
  detail: MissingDelegationGrant | null; receipt: MissingDelegationOwnerReceipt | null; readAt: string };
export type MissingDelegationDelegateResponse = { protocol: "delegated-missing-v1"; siteId: string; actorId: string; employeeId: string; mode: MissingDelegationDelegateQuery["mode"];
  canWrite: boolean; grants: MissingDelegationGrant[]; items: MissingDelegationSummary[]; nextCursor: { at: string; id: string } | null; nextId: string | null;
  detail: MissingDelegationDetail | null; receipt: MissingDelegationDecisionReceipt | null; readAt: string };
export type MissingDelegationResponse = MissingDelegationOwnerResponse | MissingDelegationDelegateResponse;
export type MissingDelegationIdentity = { ownerId?: string; employeeId?: string; authUserId?: string };
export const MISSING_DELEGATION_ERRORS: Readonly<Record<string, number>> = Object.freeze({ ...MISSING_ERRORS,
  attendance_missing_delegation_invalid: 503, attendance_missing_delegation_too_large: 422, attendance_missing_delegation_not_found: 404,
  attendance_missing_delegation_disabled: 403, attendance_period_sealed: 409,
  attendance_invalid_content_type: 415, attendance_body_too_large: 413, attendance_not_available: 404, attendance_rate_limited: 429,
  attendance_unavailable: 503, attendance_access_denied: 403, attendance_platform_paused: 403, attendance_invalid_request: 400 });
const fail = (code = "attendance_missing_delegation_invalid"): never => { throw new MerchantAttendanceError(code); };
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
const us = (s: string) => BigInt(Date.parse(s.slice(0, 23) + "Z")) * BigInt(1000) + BigInt(s.slice(23, 26));
function frozen<T>(v: T): T { if (v && typeof v === "object") { Object.values(v).forEach(frozen); Object.freeze(v); } return v; }
export function validateMissingDelegationTree(raw: unknown, limit = MISSING_DELEGATION_BYTE_LIMIT) {
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
export function parseMissingDelegationJson(raw: string, kind: "request" | "response" = "response") {
  try { const limit = kind === "request" ? MISSING_DELEGATION_BODY_BYTE_LIMIT : MISSING_DELEGATION_BYTE_LIMIT;
    if (typeof raw !== "string" || new TextEncoder().encode(raw).byteLength > limit) fail(); const value = parseCaptureBrowserJson(raw); validateMissingDelegationTree(value, limit); return value;
  } catch { return fail(kind === "request" ? "attendance_invalid_request" : undefined); }
}
export function parseMissingDelegationQuery(raw: unknown): MissingDelegationQuery {
  try { validateMissingDelegationTree(raw, MISSING_DELEGATION_BODY_BYTE_LIMIT); const access = Object.getOwnPropertyDescriptor(raw, "access")?.value;
    if (access === "owner") { const q = exact(raw, ["siteId", "access", "mode", "catalog", "afterId", "grantId", "operationId"]);
      const result: MissingDelegationOwnerQuery = { siteId: site(q.siteId), access, mode: q.mode as MissingDelegationOwnerQuery["mode"], catalog: q.catalog as MissingDelegationCatalog | null,
        afterId: nullableId(q.afterId), grantId: nullableId(q.grantId), operationId: nullableId(q.operationId) };
      if (!["list", "catalog", "detail", "recover"].includes(result.mode) || (result.mode === "catalog" ? !["delegates", "workers", "locations"].includes(String(result.catalog)) : result.catalog !== null)
        || (result.mode === "detail") !== (result.grantId !== null) || (result.mode === "recover") !== (result.operationId !== null)
        || result.afterId !== null && !["list", "catalog"].includes(result.mode)) fail(); return frozen(result);
    }
    if (access !== "delegate") return fail(); const q = exact(raw, ["siteId", "access", "mode", "grantId", "requestId", "operationId", "beforeAt", "beforeId", "afterId"]);
    const result: MissingDelegationDelegateQuery = { siteId: site(q.siteId), access, mode: q.mode as MissingDelegationDelegateQuery["mode"], grantId: nullableId(q.grantId), requestId: nullableId(q.requestId),
      operationId: nullableId(q.operationId), beforeAt: q.beforeAt === null ? null : stamp(q.beforeAt), beforeId: nullableId(q.beforeId), afterId: nullableId(q.afterId) };
    if (!["grants", "list", "detail", "decide", "recover"].includes(result.mode) || ["list", "detail", "decide"].includes(result.mode) !== (result.grantId !== null)
      || ["detail", "decide"].includes(result.mode) !== (result.requestId !== null) || (result.mode === "recover") !== (result.operationId !== null)
      || (result.beforeAt === null) !== (result.beforeId === null) || result.beforeAt !== null && result.mode !== "list" || result.afterId !== null && result.mode !== "grants") fail(); return frozen(result);
  } catch { return fail("attendance_invalid_request"); }
}
export function parseMissingDelegationHttpQuery(url: string): MissingDelegationQuery {
  try { const p = new URL(url).searchParams, v: Record<string, unknown> = p.get("access") === "owner"
    ? { catalog: null, afterId: null, grantId: null, operationId: null } : { grantId: null, requestId: null, operationId: null, beforeAt: null, beforeId: null, afterId: null };
    for (const [k, value] of p) { if (p.getAll(k).length !== 1) fail(); v[k] = value; } const q = parseMissingDelegationQuery(v); if (q.mode === "decide") fail(); return q;
  } catch { return fail("attendance_invalid_request"); }
}
export function missingDelegationQueryString(raw: MissingDelegationQuery) { const q = parseMissingDelegationQuery(raw), p = new URLSearchParams(); for (const [k, v] of Object.entries(q)) if (v !== null) p.set(k, v); return p.toString(); }
export function parseMissingDelegationCommand(raw: unknown): MissingDelegationCommand {
  try { validateMissingDelegationTree(raw, MISSING_DELEGATION_BODY_BYTE_LIMIT); const action = Object.getOwnPropertyDescriptor(raw, "action")?.value;
    if (action === "grant") { const c = exact(raw, ["action", "operationId", "delegateEmployeeId", "delegateAuthUserId", "workerId", "employeeId", "employeeAuthUserId", "locationId", "validFrom", "validUntil", "reason"]);
      const result: MissingDelegationGrantCommand = { action, operationId: uuid(c.operationId), delegateEmployeeId: uuid(c.delegateEmployeeId), delegateAuthUserId: uuid(c.delegateAuthUserId),
        workerId: uuid(c.workerId), employeeId: uuid(c.employeeId), employeeAuthUserId: uuid(c.employeeAuthUserId), locationId: uuid(c.locationId), validFrom: stamp(c.validFrom), validUntil: stamp(c.validUntil), reason: text(c.reason) };
      if (result.validFrom >= result.validUntil || result.delegateEmployeeId === result.employeeId || result.delegateAuthUserId === result.employeeAuthUserId) fail(); return frozen(result);
    }
    if (action === "revoke") { const c = exact(raw, ["action", "operationId", "grantId", "expectedRevision", "reason"]); if (c.expectedRevision !== 1) fail(); return frozen({ action, operationId: uuid(c.operationId), grantId: uuid(c.grantId), expectedRevision: 1 as const, reason: text(c.reason) }); }
    const c = exact(raw, ["grantId", "expectedGrantRevision", "decision"]), d = exact(c.decision, ["action", "operationId", "requestId", "expectedRevision", "evidenceToken", "reason"]);
    if (c.expectedGrantRevision !== 1 || d.expectedRevision !== 1 || d.action !== "approve" && d.action !== "reject") return fail();
    return frozen({ grantId: uuid(c.grantId), expectedGrantRevision: 1, decision: { action: d.action, operationId: uuid(d.operationId), requestId: uuid(d.requestId), expectedRevision: 1, evidenceToken: digest(d.evidenceToken, 32), reason: text(d.reason) } });
  } catch { return fail("attendance_invalid_request"); }
}
export function parseMissingDelegationBody(raw: unknown) {
  try { validateMissingDelegationTree(raw, MISSING_DELEGATION_BODY_BYTE_LIMIT); const b = exact(raw, ["query", "command"]), query = parseMissingDelegationQuery(b.query), command = parseMissingDelegationCommand(b.command);
    if (query.operationId !== null || query.afterId !== null) fail();
    if (query.access === "owner") { if (!("action" in command) || query.mode !== (command.action === "grant" ? "list" : "detail")
      || command.action === "revoke" && query.grantId !== command.grantId) fail(); }
    else if (!("decision" in command) || query.mode !== "decide" || query.grantId !== command.grantId || query.requestId !== command.decision.requestId || query.beforeAt !== null) fail();
    return frozen({ query, command });
  } catch { return fail("attendance_invalid_request"); }
}
export function missingDelegationOperation(c: MissingDelegationCommand) { return "decision" in c ? c.decision.operationId : c.operationId; }
export function missingDelegationFingerprintText(siteId: string, access: MissingDelegationAccess, raw: MissingDelegationCommand) {
  const c = parseMissingDelegationCommand(raw), head: (string | number)[] = ["attendance-missing-delegation-v1", site(siteId), access];
  if (access !== ("decision" in c ? "delegate" : "owner")) return fail("attendance_invalid_request");
  const tail = "decision" in c ? [c.decision.action, c.decision.operationId, c.grantId, c.expectedGrantRevision, c.decision.requestId, c.decision.expectedRevision, c.decision.evidenceToken, c.decision.reason]
    : c.action === "grant" ? [c.action, c.operationId, c.delegateEmployeeId, c.delegateAuthUserId, c.workerId, c.employeeId, c.employeeAuthUserId, c.locationId, c.validFrom, c.validUntil, c.reason]
      : [c.action, c.operationId, c.grantId, c.expectedRevision, c.reason];
  return `[${[...head, ...tail].map(x => JSON.stringify(x)).join(", ")}]`;
}
export async function missingDelegationCommandFingerprint(siteId: string, access: MissingDelegationAccess, c: MissingDelegationCommand) {
  const bytes = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(missingDelegationFingerprintText(siteId, access, c)));
  return Array.from(new Uint8Array(bytes), x => x.toString(16).padStart(2, "0")).join("");
}
export function missingDelegationSameCommand(a: MissingDelegationCommand, b: MissingDelegationCommand) { return JSON.stringify(parseMissingDelegationCommand(a)) === JSON.stringify(parseMissingDelegationCommand(b)); }
function grant(raw: unknown, readAt: string): MissingDelegationGrant {
  const g = exact(raw, ["grantId", "revision", "status", "delegate", "worker", "location", "validFrom", "validUntil", "grantedBy", "grantedAt", "reason", "revocation", "usable"]);
  const d = exact(g.delegate, ["employeeId", "authUserId", "name"]), w = exact(g.worker, ["workerId", "employeeId", "authUserId", "name", "workerNo"]), l = exact(g.location, ["locationId", "name", "timeZone"]);
  const result: MissingDelegationGrant = { grantId: uuid(g.grantId), revision: g.revision as 1 | 2, status: g.status as MissingDelegationGrant["status"],
    delegate: { employeeId: uuid(d.employeeId), authUserId: uuid(d.authUserId), name: text(d.name, 120) }, worker: { workerId: uuid(w.workerId), employeeId: uuid(w.employeeId), authUserId: uuid(w.authUserId), name: text(w.name, 120), workerNo: text(w.workerNo, 40) },
    location: { locationId: uuid(l.locationId), name: text(l.name, 120), timeZone: text(l.timeZone, 100) }, validFrom: stamp(g.validFrom), validUntil: stamp(g.validUntil), grantedBy: uuid(g.grantedBy), grantedAt: stamp(g.grantedAt), reason: text(g.reason), revocation: null, usable: bool(g.usable) };
  if (g.revocation !== null) { const r = exact(g.revocation, ["operationId", "actorId", "reason", "recordedAt"]);
    result.revocation = { operationId: uuid(r.operationId), actorId: uuid(r.actorId), reason: text(r.reason), recordedAt: stamp(r.recordedAt) };
    if (result.revocation.recordedAt > readAt || result.revocation.operationId === result.grantId) fail(); }
  // Usability is the server's lock-protected observation, not an authority
  // promise at final readAt/receipt/commit time. The decision RPC rechecks it.
  if (result.validFrom >= result.validUntil || result.grantedAt > readAt || result.revision !== (result.revocation ? 2 : 1)
    || result.status !== (result.revocation ? "revoked" : "granted") || result.usable && result.revocation !== null) fail();
  return result;
}
function catalogItem(raw: unknown, kind: MissingDelegationCatalog): MissingDelegationCatalogItem {
  const c = exact(raw, ["id", "name", "employeeId", "employeeAuthUserId", "workerNo", "timeZone"]);
  const item = { id: uuid(c.id), name: text(c.name, 120), employeeId: nullableId(c.employeeId), employeeAuthUserId: nullableId(c.employeeAuthUserId),
    workerNo: c.workerNo === null ? null : text(c.workerNo, 40), timeZone: c.timeZone === null ? null : text(c.timeZone, 100) };
  if (kind === "delegates" ? item.id !== item.employeeId || item.employeeAuthUserId === null || item.workerNo !== null || item.timeZone !== null
    : kind === "workers" ? item.employeeId === null || item.employeeAuthUserId === null || item.workerNo === null || item.timeZone !== null
      : item.employeeId !== null || item.employeeAuthUserId !== null || item.workerNo !== null || item.timeZone === null) fail(); return item;
}
const SUMMARY_KEYS = ["requestId", "workerId", "employeeId", "employeeAuthUserId", "workerName", "locationId", "locationName", "timeZone", "submittedAt", "status"];
function summary(raw: unknown, readAt: string): MissingDelegationSummary {
  const s = exact(raw, SUMMARY_KEYS); if (s.status !== "submitted") return fail();
  const submittedAt = stamp(s.submittedAt); if (submittedAt > readAt) fail();
  return { requestId: uuid(s.requestId), workerId: uuid(s.workerId), employeeId: uuid(s.employeeId), employeeAuthUserId: uuid(s.employeeAuthUserId), workerName: text(s.workerName, 120),
    locationId: uuid(s.locationId), locationName: text(s.locationName, 120), timeZone: text(s.timeZone, 100), submittedAt, status: "submitted" };
}
function detail(raw: unknown, readAt: string): MissingDelegationDetail {
  const d = exact(raw, [...SUMMARY_KEYS, "proposal", "reason", "evidenceToken", "blocked", "canApprove", "canReject"]), s = summary(Object.fromEntries(SUMMARY_KEYS.map(k => [k, d[k]])), readAt);
  const p = exact(d.proposal, ["startAt", "endAt", "breaks"]), startAt = stamp(p.startAt), endAt = stamp(p.endAt);
  if (endAt <= startAt || endAt > s.submittedAt || us(endAt) - us(startAt) > BigInt(86400000000) || !Array.isArray(p.breaks) || p.breaks.length > 8) return fail();
  let previous = startAt; const breaks = p.breaks.map(value => { const b = exact(value, ["startAt", "endAt", "paid"]), a = stamp(b.startAt), z = stamp(b.endAt);
    if (a < previous || z <= a || z > endAt) fail(); previous = z; return { startAt: a, endAt: z, paid: bool(b.paid) }; });
  const blocked = bool(d.blocked), canApprove = bool(d.canApprove), canReject = bool(d.canReject); if (canApprove && (blocked || !canReject)) fail();
  return { ...s, proposal: { startAt, endAt, breaks }, reason: text(d.reason), evidenceToken: digest(d.evidenceToken, 32), blocked, canApprove, canReject };
}
function page<T>(raw: unknown, parse: (v: unknown) => T, key: (v: T) => string, after: string | null = null): T[] {
  if (!Array.isArray(raw) || raw.length > 25) return fail(); let previous = after;
  return raw.map(value => { const item = parse(value), id = key(item); if (previous !== null && id <= previous) fail(); previous = id; return item; });
}
const OWNER_KEYS = ["protocol", "siteId", "actorId", "mode", "timeZone", "canWrite", "items", "catalogItems", "nextId", "detail", "receipt", "readAt"];
const DELEGATE_KEYS = ["protocol", "siteId", "actorId", "employeeId", "mode", "canWrite", "grants", "items", "nextCursor", "nextId", "detail", "receipt", "readAt"];
export function missingDelegationReceiptMatches(receipt: MissingDelegationOwnerReceipt | MissingDelegationDecisionReceipt,
  c: MissingDelegationCommand, fingerprint: string): boolean {
  if (receipt.commandFingerprint !== fingerprint || receipt.operationId !== missingDelegationOperation(c)) return false;
  if ("decision" in c) return "requestId" in receipt && receipt.grantId === c.grantId && receipt.requestId === c.decision.requestId && receipt.action === c.decision.action;
  return !("requestId" in receipt) && receipt.action === c.action && receipt.grantId === (c.action === "grant" ? c.operationId : c.grantId) && receipt.revision === (c.action === "grant" ? 1 : 2);
}
export function parseMissingDelegationResult(raw: unknown, input: MissingDelegationQuery, expected: MissingDelegationIdentity = {}, command: MissingDelegationCommand | null = null): MissingDelegationResponse {
  try { validateMissingDelegationTree(raw); const q = parseMissingDelegationQuery(input), v = exact(raw, q.access === "owner" ? OWNER_KEYS : DELEGATE_KEYS);
    const actorId = uuid(v.actorId), readAt = stamp(v.readAt), canWrite = bool(v.canWrite);
    if (v.siteId !== q.siteId || v.mode !== q.mode || expected.authUserId !== undefined && expected.authUserId !== actorId
      || expected.ownerId !== undefined && (q.access !== "owner" || actorId !== expected.ownerId) || expected.employeeId !== undefined && q.access !== "delegate") fail();
    if (command) parseMissingDelegationBody({ query: q, command });
    const operationId = command ? missingDelegationOperation(command) : q.operationId;
    if (q.access === "owner") {
      if (v.protocol !== "missing-delegations-v1") return fail();
      const items = page(v.items, x => grant(x, readAt), x => x.grantId, q.afterId);
      const catalogItems = page(v.catalogItems, x => catalogItem(x, q.catalog!), x => x.id, q.afterId), nextId = nullableId(v.nextId);
      const selected = v.detail === null ? null : grant(v.detail, readAt); let receipt: MissingDelegationOwnerReceipt | null = null;
      if (v.receipt !== null) { const r = exact(v.receipt, ["operationId", "action", "grantId", "revision", "recordedAt", "commandFingerprint"]);
        if (r.action !== "grant" && r.action !== "revoke" || r.revision !== (r.action === "grant" ? 1 : 2)) fail();
        receipt = { operationId: uuid(r.operationId), action: r.action as "grant" | "revoke", grantId: uuid(r.grantId), revision: r.revision as 1 | 2, recordedAt: stamp(r.recordedAt), commandFingerprint: digest(r.commandFingerprint) };
        if (receipt.operationId !== operationId || receipt.recordedAt > readAt || receipt.action === "grant" && receipt.grantId !== receipt.operationId
          || command && !missingDelegationReceiptMatches(receipt, command, receipt.commandFingerprint)) fail(); }
      if (command || q.mode === "recover") { if (items.length || catalogItems.length || selected || nextId || command && !receipt) fail(); }
      else if (receipt || q.mode === "list" && (catalogItems.length || selected) || q.mode === "catalog" && (items.length || selected)
        || q.mode === "detail" && (items.length || catalogItems.length || nextId || !selected || selected.grantId !== q.grantId)) fail();
      const entries = q.mode === "catalog" ? catalogItems : items;
      if (nextId && (entries.length !== 25 || nextId !== (q.mode === "catalog" ? catalogItems.at(-1)!.id : items.at(-1)!.grantId))) fail();
      return frozen({ protocol: "missing-delegations-v1", siteId: q.siteId, actorId, mode: q.mode, timeZone: text(v.timeZone, 100), canWrite, items, catalogItems, nextId, detail: selected, receipt, readAt });
    }
    if (v.protocol !== "delegated-missing-v1") return fail(); const employeeId = uuid(v.employeeId);
    if (expected.employeeId !== undefined && employeeId !== expected.employeeId) fail();
    const grants = page(v.grants, x => grant(x, readAt), x => x.grantId, q.afterId), nextId = nullableId(v.nextId);
    if (grants.some(g => g.delegate.employeeId !== employeeId || g.delegate.authUserId !== actorId || !g.usable)) fail();
    if (!Array.isArray(v.items) || v.items.length > 25) return fail(); let priorAt = q.beforeAt, priorId = q.beforeId; const ids = new Set<string>();
    const ownSafe = (s: MissingDelegationSummary) => { if (s.employeeId === employeeId || s.employeeAuthUserId === actorId) fail(); };
    const items = v.items.map(x => { const s = summary(x, readAt); ownSafe(s);
      if (ids.has(s.requestId) || priorAt && (s.submittedAt > priorAt || s.submittedAt === priorAt && s.requestId >= priorId!)) fail();
      priorAt = s.submittedAt; priorId = s.requestId; ids.add(s.requestId); return s; });
    let nextCursor: MissingDelegationDelegateResponse["nextCursor"] = null;
    if (v.nextCursor !== null) { const c = exact(v.nextCursor, ["at", "id"]); nextCursor = { at: stamp(c.at), id: uuid(c.id) };
      if (items.length !== 25 || nextCursor.at !== priorAt || nextCursor.id !== priorId) fail(); }
    const selected = v.detail === null ? null : detail(v.detail, readAt); if (selected) { ownSafe(selected); if (selected.requestId !== q.requestId || !canWrite && (selected.canApprove || selected.canReject)) fail(); }
    let receipt: MissingDelegationDecisionReceipt | null = null;
    if (v.receipt !== null) { const r = exact(v.receipt, ["operationId", "requestId", "grantId", "action", "status", "actorId", "recordedAt", "commandFingerprint"]);
      if (r.action !== "approve" && r.action !== "reject" || r.status !== (r.action === "approve" ? "approved" : "rejected")) fail();
      receipt = { operationId: uuid(r.operationId), requestId: uuid(r.requestId), grantId: uuid(r.grantId), action: r.action as "approve" | "reject", status: r.status as "approved" | "rejected",
        actorId: uuid(r.actorId), recordedAt: stamp(r.recordedAt), commandFingerprint: digest(r.commandFingerprint) };
      if (receipt.actorId !== actorId || receipt.operationId !== operationId || receipt.recordedAt > readAt
        || command && !missingDelegationReceiptMatches(receipt, command, receipt.commandFingerprint)) fail(); }
    if (q.mode === "recover" || q.mode === "decide") { if (grants.length || items.length || nextId || nextCursor || selected || q.mode === "decide" && !receipt) fail(); }
    else if (receipt || q.mode === "grants" && (items.length || selected || nextCursor) || q.mode === "list" && (grants.length || selected || nextId)
      || q.mode === "detail" && (grants.length || items.length || nextId || nextCursor || !selected)) fail();
    if (nextId && (q.mode !== "grants" || grants.length !== 25 || grants.at(-1)!.grantId !== nextId)) fail();
    return frozen({ protocol: "delegated-missing-v1", siteId: q.siteId, actorId, employeeId, mode: q.mode, canWrite, grants, items, nextCursor, nextId, detail: selected, receipt, readAt });
  } catch { return fail(); }
}
export function parseMissingDelegationResponse(raw: unknown, q: MissingDelegationQuery, expected: MissingDelegationIdentity = {}, command: MissingDelegationCommand | null = null): MissingDelegationResponse {
  try { validateMissingDelegationTree(raw); const v = exact(raw, ["ok", ...(q.access === "owner" ? OWNER_KEYS : DELEGATE_KEYS)]); if (v.ok !== true) fail();
    const { ok, ...rest } = v; void ok; return parseMissingDelegationResult(rest, q, expected, command);
  } catch { return fail(); }
}
