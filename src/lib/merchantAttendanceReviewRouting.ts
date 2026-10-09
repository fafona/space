//198 responsibility is coordination, never approval authority. Exact public
//wire and saved fingerprints; database grant/source checks remain mandatory.
import { captureBrowserExact as exact, parseCaptureBrowserJson } from "./merchantAttendanceRuleCapturesBrowser";
import { bool, enumValue, hash, integer, label, safeTree, same, site, stamp, uuid } from "./merchantAttendancePlanExceptionValidation";
import { operationalRuleLedgerEncode, operationalRuleLedgerFreeze as freeze } from "./merchantAttendanceOperationalRuleLedger";
import { MerchantAttendanceError } from "./merchantAttendanceTime";

export const REVIEW_ROUTING_API = "/api/merchant-enterprise/attendance/review-routing";
export const REVIEW_ROUTING_PROTOCOL = "attendance-review-routing-v1" as const;
export const REVIEW_ROUTING_BODY_LIMIT = 8192, REVIEW_ROUTING_RESPONSE_LIMIT = 262144;
export const REVIEW_ROUTING_FAMILIES = ["correction", "correction_revision", "missing", "missing_revision", "leave", "work_arrangement"] as const;
export type ReviewRoutingFamily = typeof REVIEW_ROUTING_FAMILIES[number];
export type ReviewRoutingCategory = "correction" | "missing" | "leave" | "work_arrangement";
export type ReviewRoutingRequest = Readonly<{ family: ReviewRoutingFamily; category: ReviewRoutingCategory; requestId: string; workerId: string; employeeId: string; employeeAuthUserId: string; submittedRevision: number; submittedAt: string; kind: "trip" | "field" | "remote" | null }>;
export type ReviewRoutingDesired = Readonly<{ kind: "owner" } | { kind: "delegate"; employeeId: string; authUserId: string }>;
export type ReviewRoutingOrigin = Readonly<{ kind: "manual_registration" } | { kind: "rule_capture"; activationRevision: number; observedAt: string; sourceFingerprint: string; selection: "value" | "disabled" | "unconfigured" | "owner_only_revision"; selectedLayer: "enterprise" | "group" | "personal" | null; desired: ReviewRoutingDesired }>;
const REASONS = ["no_grant", "ambiguous_grant", "candidate_limit", "source_scope_unavailable"] as const;
export type ReviewRoutingAssignment = Readonly<{ kind: "owner"; authUserId: string } | { kind: "delegate"; employeeId: string; authUserId: string; grantId: string; grantType: "correction" | "missing" | "application"; delegateGeneration: number; employeeGeneration: number; epochProofKind: "embedded" | "sidecar" | "pre_epoch_zero"; validFrom: string; validUntil: string } | { kind: "needs_assignment"; reason: typeof REASONS[number]; desired: { employeeId: string; authUserId: string } }>;
export type ReviewRoutingEntry = Readonly<{ operationId: string; revision: number; action: "capture" | "register" | "take_over"; actorId: string; recordedAt: string; reason: string | null; previousOperationId: string | null; origin: ReviewRoutingOrigin; assignment: ReviewRoutingAssignment; commandFingerprint: string | null; entryFingerprint: string }>;
export type ReviewRoutingObservation = Readonly<{ requestRevision: number; requestHeadOperationId: string; status: "submitted" | "approved" | "rejected" | "withdrawn" | "cancelled"; bindingCurrent: boolean; routeState: "unregistered" | "assigned" | "needs_assignment" | "handover_needed" | "closed"; reason: typeof REASONS[number] | "owner_changed" | "grant_unavailable" | "binding_changed" | null; checkedAt: string; observationFingerprint: string }>;
export type ReviewRoutingGrant = Readonly<{ grantId: string; delegateEmployeeId: string; delegateAuthUserId: string; delegateName: string; validFrom: string; validUntil: string; usable: boolean; reason: "grant_unavailable" | "scope_unavailable" | null }>;
export type ReviewRoutingReceipt = Readonly<{ operationId: string; family: ReviewRoutingFamily; requestId: string; revision: number; action: "register" | "take_over"; actorId: string; recordedAt: string; commandFingerprint: string }>;
export type ReviewRoutingListCursor = Readonly<{ kind: "list"; siteId: string; beforeAt: string; beforeFamily: ReviewRoutingFamily; beforeRequestId: string }>;
export type ReviewRoutingGrantCursor = Readonly<{ kind: "grants"; siteId: string; family: ReviewRoutingFamily; requestId: string; afterDelegateEmployeeId: string; afterDelegateAuthUserId: string; afterGrantId: string }>;
export type ReviewRoutingQuery = Readonly<{ siteId: string; mode: "list"; cursor: ReviewRoutingListCursor | null } | { siteId: string; mode: "detail" | "self"; family: ReviewRoutingFamily; requestId: string } | { siteId: string; mode: "history"; family: ReviewRoutingFamily; requestId: string; beforeRevision: number | null } | { siteId: string; mode: "grants"; family: ReviewRoutingFamily; requestId: string; cursor: ReviewRoutingGrantCursor | null } | { siteId: string; mode: "recover"; family: ReviewRoutingFamily; operationId: string }>;
export type ReviewRoutingCommand = Readonly<{ action: "register" | "take_over"; operationId: string; expectedResponsibilityRevision: number; expectedResponsibilityOperationId: string | null; expectedRequestRevision: number; expectedObservationFingerprint: string; grantId: string | null; reason: string }>;
export type ReviewRoutingData = Readonly<
  { kind: "list"; items: readonly { request: ReviewRoutingRequest; current: ReviewRoutingEntry; observation: ReviewRoutingObservation }[]; nextCursor: ReviewRoutingListCursor | null }
  | { kind: "detail"; request: ReviewRoutingRequest; current: ReviewRoutingEntry | null; observation: ReviewRoutingObservation; canRegister: boolean; canTakeOver: boolean }
  | { kind: "self"; family: ReviewRoutingFamily; requestId: string; submittedAt: string; route: "owner" | "delegate" | "needs_assignment" | "unregistered"; handoverNeeded: boolean; capturedAt: string | null }
  | { kind: "history"; request: ReviewRoutingRequest; items: readonly ReviewRoutingEntry[]; nextBeforeRevision: number | null }
  | { kind: "grants"; request: ReviewRoutingRequest; items: readonly ReviewRoutingGrant[]; nextCursor: ReviewRoutingGrantCursor | null }
  | { kind: "receipt" }>;
export type ReviewRoutingResult = Readonly<{ protocol: typeof REVIEW_ROUTING_PROTOCOL; siteId: string; actorId: string; readAt: string; data: ReviewRoutingData; receipt: ReviewRoutingReceipt | null }>;
export const REVIEW_ROUTING_ERRORS = Object.freeze({ attendance_invalid_request: 400, attendance_access_denied: 403, attendance_settings_required: 409, attendance_operation_conflict: 409,
  attendance_review_routing_invalid: 503, attendance_review_routing_disabled: 403, attendance_review_routing_changed: 409, attendance_review_routing_not_found: 404,
  attendance_review_routing_closed: 409, attendance_review_routing_unavailable: 409, attendance_review_routing_unchanged: 409, attendance_review_routing_too_large: 422 });
export type ReviewRoutingError = keyof typeof REVIEW_ROUTING_ERRORS;
export type ReviewRoutingResponse = Readonly<{ ok: true; data: ReviewRoutingResult } | { ok: false; error: { code: ReviewRoutingError; message: string } }>;
function fail(code = "attendance_invalid_request"): never { throw new MerchantAttendanceError(code); }
function owned(raw: unknown, cap: number): unknown { safeTree(raw, cap); return parseCaptureBrowserJson(JSON.stringify(raw)); }
const tag = (v: unknown, k: string): unknown => v && typeof v === "object" ? Object.getOwnPropertyDescriptor(v, k)?.value : undefined;
const arr = (v: unknown): unknown[] => Array.isArray(v) && v.length <= 25 ? v : fail();
const family = (v: unknown) => enumValue(v, REVIEW_ROUTING_FAMILIES);
const optionalUuid = (v: unknown) => v === null ? null : uuid(v);
const category = (f: ReviewRoutingFamily): ReviewRoutingCategory => f === "correction_revision" ? "correction" : f === "missing_revision" ? "missing" : f;
async function digest(v: Parameters<typeof operationalRuleLedgerEncode>[0]): Promise<string> { const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(operationalRuleLedgerEncode(v))); return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, "0")).join(""); }
export function parseReviewRoutingJson(text: string, purpose: "request" | "response" = "response") {
  try { const cap = purpose === "request" ? REVIEW_ROUTING_BODY_LIMIT : REVIEW_ROUTING_RESPONSE_LIMIT;
    if (typeof text !== "string" || text.length > cap || new TextEncoder().encode(text).length > cap) fail();
    const v = parseCaptureBrowserJson(text); safeTree(v, cap); return v;
  } catch { return fail(purpose === "request" ? "attendance_invalid_request" : "attendance_review_routing_invalid"); }
}
function listCursor(raw: unknown, siteId: string): ReviewRoutingListCursor {
  const v = exact(raw, ["kind", "siteId", "beforeAt", "beforeFamily", "beforeRequestId"]); if (v.kind !== "list" || v.siteId !== siteId) fail();
  return { kind: "list", siteId, beforeAt: stamp(v.beforeAt), beforeFamily: family(v.beforeFamily), beforeRequestId: uuid(v.beforeRequestId) };
}
function grantCursor(raw: unknown, q: { siteId: string; family: ReviewRoutingFamily; requestId: string }): ReviewRoutingGrantCursor {
  const v = exact(raw, ["kind", "siteId", "family", "requestId", "afterDelegateEmployeeId", "afterDelegateAuthUserId", "afterGrantId"]);
  if (v.kind !== "grants" || v.siteId !== q.siteId || v.family !== q.family || v.requestId !== q.requestId) fail();
  return { kind: "grants", ...q, afterDelegateEmployeeId: uuid(v.afterDelegateEmployeeId), afterDelegateAuthUserId: uuid(v.afterDelegateAuthUserId), afterGrantId: uuid(v.afterGrantId) };
}
export function parseReviewRoutingQuery(raw: unknown): ReviewRoutingQuery {
  try {
    safeTree(raw, REVIEW_ROUTING_BODY_LIMIT); const mode = tag(raw, "mode");
    const keys = mode === "list" ? ["siteId", "mode", "cursor"] : mode === "recover" ? ["siteId", "mode", "family", "operationId"]
      : ["siteId", "mode", "family", "requestId", ...(mode === "history" ? ["beforeRevision"] : mode === "grants" ? ["cursor"] : [])];
    const v = exact(raw, keys), siteId = site(v.siteId);
    if (mode === "list") return freeze({ siteId, mode, cursor: v.cursor === null ? null : listCursor(v.cursor, siteId) });
    const f = family(v.family); if (mode === "recover") return freeze({ siteId, mode, family: f, operationId: uuid(v.operationId) });
    const base = { siteId, family: f, requestId: uuid(v.requestId) };
    if (mode === "detail" || mode === "self") return freeze({ ...base, mode });
    if (mode === "history") return freeze({ ...base, mode, beforeRevision: v.beforeRevision === null ? null : integer(v.beforeRevision, 2) });
    if (mode === "grants") return freeze({ ...base, mode, cursor: v.cursor === null ? null : grantCursor(v.cursor, base) });
    return fail();
  } catch { return fail(); }
}
export function reviewRoutingQueryString(raw: ReviewRoutingQuery): string {
  const q = parseReviewRoutingQuery(raw), p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== null) p.set(k, typeof v === "object" ? JSON.stringify(v) : String(v)); return p.toString();
}
export function parseReviewRoutingHttpQuery(url: string): ReviewRoutingQuery {
  try { const u = new URL(url), p = u.searchParams, raw: Record<string, unknown> = {}; if (u.hash) fail();
    for (const [k, v] of p) { if (p.getAll(k).length !== 1 || !["siteId", "mode", "family", "requestId", "operationId", "beforeRevision", "cursor"].includes(k)) fail(); raw[k] = v; }
    if (["list", "grants"].includes(String(raw.mode))) raw.cursor = raw.cursor === undefined ? null : parseReviewRoutingJson(String(raw.cursor), "request");
    if (raw.mode === "history") { if (raw.beforeRevision !== undefined && (typeof raw.beforeRevision !== "string" || !/^[1-9][0-9]{0,15}$/.test(raw.beforeRevision))) fail(); raw.beforeRevision = raw.beforeRevision === undefined ? null : Number(raw.beforeRevision); }
    return parseReviewRoutingQuery(raw);
  } catch { return fail(); }
}
export function parseReviewRoutingCommand(raw: unknown): ReviewRoutingCommand {
  try { safeTree(raw, REVIEW_ROUTING_BODY_LIMIT); const v = exact(raw, ["action", "operationId", "expectedResponsibilityRevision", "expectedResponsibilityOperationId", "expectedRequestRevision", "expectedObservationFingerprint", "grantId", "reason"]);
    const c = { action: enumValue(v.action, ["register", "take_over"] as const), operationId: uuid(v.operationId), expectedResponsibilityRevision: integer(v.expectedResponsibilityRevision, 0, 9007199254740989),
      expectedResponsibilityOperationId: optionalUuid(v.expectedResponsibilityOperationId), expectedRequestRevision: integer(v.expectedRequestRevision), expectedObservationFingerprint: hash(v.expectedObservationFingerprint), grantId: optionalUuid(v.grantId), reason: label(v.reason, 200) };
    if ((c.expectedResponsibilityRevision === 0) !== (c.expectedResponsibilityOperationId === null) || (c.action === "take_over") !== (c.grantId === null)
      || c.action === "take_over" && c.expectedResponsibilityRevision === 0 || c.operationId === c.expectedResponsibilityOperationId) fail(); return freeze(c);
  } catch { return fail(); }
}
export function parseReviewRoutingBody(raw: unknown) {
  try { safeTree(raw, REVIEW_ROUTING_BODY_LIMIT); const v = exact(raw, ["query", "command"]), query = parseReviewRoutingQuery(v.query), command = parseReviewRoutingCommand(v.command);
    if (query.mode !== "detail" || query.family === "correction_revision" && command.action === "register") return fail(); return freeze({ query, command });
  } catch { return fail(); }
}
const requestTuple = (r: ReviewRoutingRequest) => [r.family, r.category, r.requestId, r.workerId, r.employeeId, r.employeeAuthUserId, r.submittedRevision, r.submittedAt, r.kind];
const desiredTuple = (d: ReviewRoutingDesired) => d.kind === "owner" ? ["owner"] : ["delegate", d.employeeId, d.authUserId];
const originTuple = (o: ReviewRoutingOrigin) => o.kind === "manual_registration" ? [o.kind] : [o.kind, o.activationRevision, o.observedAt, o.sourceFingerprint, o.selection, o.selectedLayer, desiredTuple(o.desired)];
const assignmentTuple = (a: ReviewRoutingAssignment) => a.kind === "owner" ? [a.kind, a.authUserId] : a.kind === "delegate" ? [a.kind, a.employeeId, a.authUserId, a.grantId, a.grantType, a.delegateGeneration, a.employeeGeneration, a.epochProofKind, a.validFrom, a.validUntil] : [a.kind, a.reason, [a.desired.employeeId, a.desired.authUserId]];
const commandTuple = (c: ReviewRoutingCommand) => [c.action, c.operationId, c.expectedResponsibilityRevision, c.expectedResponsibilityOperationId, c.expectedRequestRevision, c.expectedObservationFingerprint, c.grantId, c.reason];
export function reviewRoutingCommandFingerprintText(rawQuery: ReviewRoutingQuery, actorId: string, rawCommand: ReviewRoutingCommand): string {
  const { query: q, command: c } = parseReviewRoutingBody({ query: rawQuery, command: rawCommand });
  return operationalRuleLedgerEncode(["attendance-review-routing-command-v1", q.siteId, uuid(actorId), q.family, q.requestId, commandTuple(c)]);
}
export async function reviewRoutingCommandFingerprint(q: ReviewRoutingQuery, actorId: string, c: ReviewRoutingCommand): Promise<string> {
  const bytes = new TextEncoder().encode(reviewRoutingCommandFingerprintText(q, actorId, c)), d = await crypto.subtle.digest("SHA-256", bytes); return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, "0")).join("");
}
export function reviewRoutingEntryFingerprint(siteId: string, r: ReviewRoutingRequest, e: Omit<ReviewRoutingEntry, "entryFingerprint">) {
  return digest(["attendance-review-routing-entry-v1", site(siteId), requestTuple(r), e.operationId, e.revision, e.action, e.actorId, e.recordedAt, e.reason, e.previousOperationId, originTuple(e.origin), assignmentTuple(e.assignment), e.commandFingerprint]);
}
export function reviewRoutingObservationFingerprint(siteId: string, r: ReviewRoutingRequest, current: ReviewRoutingEntry | null, ownerAuthId: string, o: Omit<ReviewRoutingObservation, "observationFingerprint">) {
  return digest(["attendance-review-routing-observation-v1", site(siteId), requestTuple(r), current?.entryFingerprint ?? null, uuid(ownerAuthId), o.requestRevision, o.requestHeadOperationId, o.status, o.bindingCurrent, o.routeState, o.reason]);
}
function request(raw: unknown, q: ReviewRoutingQuery, readAt: string): ReviewRoutingRequest {
  const v = exact(raw, ["family", "category", "requestId", "workerId", "employeeId", "employeeAuthUserId", "submittedRevision", "submittedAt", "kind"]), f = family(v.family);
  if (v.category !== category(f) || f !== "work_arrangement" && v.kind !== null) fail();
  const r = { family: f, category: category(f), requestId: uuid(v.requestId), workerId: uuid(v.workerId), employeeId: uuid(v.employeeId), employeeAuthUserId: uuid(v.employeeAuthUserId), submittedRevision: integer(v.submittedRevision), submittedAt: stamp(v.submittedAt), kind: v.kind === null ? null : enumValue(v.kind, ["trip", "field", "remote"] as const) };
  if (f === "work_arrangement" && r.kind === null || r.submittedAt > readAt || q.mode !== "list" && (q.family !== f || "requestId" in q && q.requestId !== r.requestId)) fail(); return r;
}
function desired(raw: unknown): ReviewRoutingDesired {
  if (tag(raw, "kind") === "owner") { exact(raw, ["kind"]); return { kind: "owner" }; }
  const v = exact(raw, ["kind", "employeeId", "authUserId"]); if (v.kind !== "delegate") fail(); return { kind: "delegate", employeeId: uuid(v.employeeId), authUserId: uuid(v.authUserId) };
}
function origin(raw: unknown, ref: ReviewRoutingRequest): ReviewRoutingOrigin {
  if (tag(raw, "kind") === "manual_registration") { exact(raw, ["kind"]); return { kind: "manual_registration" }; }
  const v = exact(raw, ["kind", "activationRevision", "observedAt", "sourceFingerprint", "selection", "selectedLayer", "desired"]); if (v.kind !== "rule_capture") fail();
  const o: ReviewRoutingOrigin = { kind: "rule_capture", activationRevision: integer(v.activationRevision), observedAt: stamp(v.observedAt), sourceFingerprint: hash(v.sourceFingerprint), selection: enumValue(v.selection, ["value", "disabled", "unconfigured", "owner_only_revision"] as const), selectedLayer: v.selectedLayer === null ? null : enumValue(v.selectedLayer, ["enterprise", "group", "personal"] as const), desired: desired(v.desired) };
  if (["unconfigured", "owner_only_revision"].includes(o.selection) !== (o.selectedLayer === null) || (ref.family === "correction_revision") !== (o.selection === "owner_only_revision")
    || o.selection !== "value" && o.desired.kind !== "owner" || o.observedAt < ref.submittedAt) fail(); return o;
}
function assignment(raw: unknown, ref: ReviewRoutingRequest): ReviewRoutingAssignment {
  if (tag(raw, "kind") === "owner") { const v = exact(raw, ["kind", "authUserId"]); return { kind: "owner", authUserId: uuid(v.authUserId) }; }
  if (ref.family === "correction_revision") fail();
  if (tag(raw, "kind") === "needs_assignment") { const v = exact(raw, ["kind", "reason", "desired"]), d = exact(v.desired, ["employeeId", "authUserId"]);
    return { kind: "needs_assignment", reason: enumValue(v.reason, REASONS), desired: { employeeId: uuid(d.employeeId), authUserId: uuid(d.authUserId) } }; }
  const v = exact(raw, ["kind", "employeeId", "authUserId", "grantId", "grantType", "delegateGeneration", "employeeGeneration", "epochProofKind", "validFrom", "validUntil"]); if (v.kind !== "delegate") fail();
  const a: Extract<ReviewRoutingAssignment, { kind: "delegate" }> = { kind: "delegate", employeeId: uuid(v.employeeId), authUserId: uuid(v.authUserId), grantId: uuid(v.grantId), grantType: enumValue(v.grantType, ["correction", "missing", "application"] as const), delegateGeneration: integer(v.delegateGeneration, 0), employeeGeneration: integer(v.employeeGeneration, 0), epochProofKind: enumValue(v.epochProofKind, ["embedded", "sidecar", "pre_epoch_zero"] as const), validFrom: stamp(v.validFrom), validUntil: stamp(v.validUntil) };
  if (a.validFrom >= a.validUntil || a.employeeId === ref.employeeId || a.authUserId === ref.employeeAuthUserId || a.grantType !== (ref.category === "correction" ? "correction" : ref.category === "missing" ? "missing" : "application")
    || (a.grantType === "correction") !== (a.epochProofKind === "embedded") || a.epochProofKind === "pre_epoch_zero" && (a.delegateGeneration !== 0 || a.employeeGeneration !== 0)) fail(); return a;
}
async function entry(raw: unknown, siteId: string, ref: ReviewRoutingRequest, readAt: string): Promise<ReviewRoutingEntry> {
  const v = exact(raw, ["operationId", "revision", "action", "actorId", "recordedAt", "reason", "previousOperationId", "origin", "assignment", "commandFingerprint", "entryFingerprint"]);
  const e: ReviewRoutingEntry = { operationId: uuid(v.operationId), revision: integer(v.revision), action: enumValue(v.action, ["capture", "register", "take_over"] as const), actorId: uuid(v.actorId), recordedAt: stamp(v.recordedAt), reason: v.reason === null ? null : label(v.reason, 200), previousOperationId: optionalUuid(v.previousOperationId), origin: origin(v.origin, ref), assignment: assignment(v.assignment, ref), commandFingerprint: v.commandFingerprint === null ? null : hash(v.commandFingerprint), entryFingerprint: hash(v.entryFingerprint) };
  if (e.recordedAt > readAt || e.recordedAt < ref.submittedAt || (e.revision === 1) !== (e.previousOperationId === null) || e.previousOperationId === e.operationId
    || e.action === "capture" && (e.revision !== 1 || e.operationId !== ref.requestId || e.actorId !== ref.employeeAuthUserId || e.origin.kind !== "rule_capture" || e.origin.observedAt !== e.recordedAt || e.reason !== null || e.commandFingerprint !== null)
    || e.action !== "capture" && (e.reason === null || e.commandFingerprint === null)
    || e.action !== "capture" && e.revision === 1 && e.origin.kind !== "manual_registration"
    || e.action === "register" && e.assignment.kind !== "delegate" || e.action === "take_over" && (e.revision === 1 || e.assignment.kind !== "owner" || e.assignment.authUserId !== e.actorId)
    || e.assignment.kind === "delegate" && (e.recordedAt < e.assignment.validFrom || e.recordedAt >= e.assignment.validUntil)
    || e.origin.kind === "rule_capture" && e.origin.observedAt > e.recordedAt) fail();
  if (e.action === "capture" && e.origin.kind === "rule_capture") {
    const d = e.origin.desired, a = e.assignment;
    if (d.kind === "owner" ? a.kind !== "owner" : a.kind === "owner" || !same(d.kind === "delegate" ? { employeeId: d.employeeId, authUserId: d.authUserId } : null, a.kind === "delegate" ? { employeeId: a.employeeId, authUserId: a.authUserId } : a.desired)) fail();
  }
  if (e.entryFingerprint !== await reviewRoutingEntryFingerprint(siteId, ref, e)) fail(); return e;
}
async function observation(raw: unknown, q: ReviewRoutingQuery, ref: ReviewRoutingRequest, current: ReviewRoutingEntry | null, actorId: string, readAt: string): Promise<ReviewRoutingObservation> {
  const v = exact(raw, ["requestRevision", "requestHeadOperationId", "status", "bindingCurrent", "routeState", "reason", "checkedAt", "observationFingerprint"]);
  const o: ReviewRoutingObservation = { requestRevision: integer(v.requestRevision), requestHeadOperationId: uuid(v.requestHeadOperationId), status: enumValue(v.status, ["submitted", "approved", "rejected", "withdrawn", "cancelled"] as const), bindingCurrent: bool(v.bindingCurrent), routeState: enumValue(v.routeState, ["unregistered", "assigned", "needs_assignment", "handover_needed", "closed"] as const), reason: v.reason === null ? null : enumValue(v.reason, [...REASONS, "owner_changed", "grant_unavailable", "binding_changed"] as const), checkedAt: stamp(v.checkedAt), observationFingerprint: hash(v.observationFingerprint) };
  if (o.requestRevision < ref.submittedRevision || o.checkedAt > readAt || o.checkedAt < (current?.recordedAt ?? ref.submittedAt)) fail();
  if (o.status !== "submitted") { if (o.routeState !== "closed" || o.reason !== null) fail(); }
  else if (!current) { if (o.routeState !== "unregistered" || o.reason !== null) fail(); }
  else if (current.assignment.kind === "needs_assignment") { if (o.routeState !== "needs_assignment" || o.reason !== current.assignment.reason) fail(); }
  else if (current.assignment.kind === "owner") { const changed = current.assignment.authUserId !== actorId; if (o.routeState !== (changed ? "handover_needed" : "assigned") || o.reason !== (changed ? "owner_changed" : null)) fail(); }
  else if (!o.bindingCurrent) { if (o.routeState !== "handover_needed" || o.reason !== "binding_changed") fail(); }
  else if (o.routeState === "assigned" ? o.reason !== null : o.routeState !== "handover_needed" || o.reason !== "grant_unavailable") fail();
  if (o.observationFingerprint !== await reviewRoutingObservationFingerprint(q.siteId, ref, current, actorId, o)) fail(); return o;
}
export function parseReviewRoutingReceipt(raw: unknown): ReviewRoutingReceipt {
  try { safeTree(raw, REVIEW_ROUTING_RESPONSE_LIMIT);
    const v = exact(raw, ["operationId", "family", "requestId", "revision", "action", "actorId", "recordedAt", "commandFingerprint"]);
    const r={ operationId: uuid(v.operationId), family: family(v.family), requestId: uuid(v.requestId), revision: integer(v.revision), action: enumValue(v.action, ["register", "take_over"] as const), actorId: uuid(v.actorId), recordedAt: stamp(v.recordedAt), commandFingerprint: hash(v.commandFingerprint) };
    if(r.action==="take_over"&&r.revision===1||r.action==="register"&&r.family==="correction_revision")fail();return freeze(r);
  } catch { return fail("attendance_review_routing_invalid"); }
}
export function reviewRoutingReceiptMatches(r: ReviewRoutingReceipt, q: Extract<ReviewRoutingQuery, { mode: "detail" | "self" }>, c: ReviewRoutingCommand, actorId: string, fingerprint: string): boolean {
  return r.actorId === actorId && r.family === q.family && r.requestId === q.requestId && r.operationId === c.operationId && r.action === c.action && r.revision === c.expectedResponsibilityRevision + 1 && r.commandFingerprint === fingerprint;
}
const afterList = (a: ReviewRoutingListCursor, b: ReviewRoutingListCursor) => a.beforeAt < b.beforeAt || a.beforeAt === b.beforeAt && (a.beforeFamily > b.beforeFamily || a.beforeFamily === b.beforeFamily && a.beforeRequestId < b.beforeRequestId);
const grantKey = (g: ReviewRoutingGrant) => g.delegateEmployeeId + g.delegateAuthUserId + g.grantId;
export async function parseReviewRoutingResult(raw: unknown, rawQuery: ReviewRoutingQuery, actualActorId: string, rawCommand: ReviewRoutingCommand | null = null): Promise<ReviewRoutingResult> {
  try {
    // Own the entire untrusted tree before the first digest await.
    const q = parseReviewRoutingQuery(rawQuery), actorId = uuid(actualActorId), c = rawCommand === null ? null : parseReviewRoutingCommand(rawCommand);
    if(c)parseReviewRoutingBody({query:q,command:c});
    const v = exact(owned(raw, REVIEW_ROUTING_RESPONSE_LIMIT), ["protocol", "siteId", "actorId", "readAt", "data", "receipt"]);
    if (v.protocol !== REVIEW_ROUTING_PROTOCOL || v.siteId !== q.siteId || v.actorId !== actorId) fail();
    const readAt = stamp(v.readAt); let data: ReviewRoutingData, receipt: ReviewRoutingReceipt | null = null;
    if (q.mode === "recover" || c !== null) {
      exact(v.data, ["kind"]); if (tag(v.data, "kind") !== "receipt") fail();
      receipt = v.receipt === null ? null : parseReviewRoutingReceipt(v.receipt);
      if (receipt && (receipt.actorId !== actorId || q.mode === "list" || receipt.family !== q.family || receipt.recordedAt > readAt
        || q.mode === "recover" && receipt.operationId !== q.operationId || "requestId" in q && receipt.requestId !== q.requestId)) fail();
      if (c) { if (!receipt || q.mode !== "detail") fail();
        if (!reviewRoutingReceiptMatches(receipt, q, c, actorId, await reviewRoutingCommandFingerprint(q, actorId, c))) fail(); }
      data = { kind: "receipt" };
    } else {
      if (v.receipt !== null) fail();
      if (q.mode === "self") {
        const d = exact(v.data, ["kind", "family", "requestId", "submittedAt", "route", "handoverNeeded", "capturedAt"]);
        if (d.kind !== "self" || d.family !== q.family || d.requestId !== q.requestId) fail();
        const submittedAt = stamp(d.submittedAt), capturedAt = d.capturedAt === null ? null : stamp(d.capturedAt), route = enumValue(d.route, ["owner", "delegate", "needs_assignment", "unregistered"] as const), handoverNeeded = bool(d.handoverNeeded);
        if (submittedAt > readAt || capturedAt !== null && (capturedAt < submittedAt || capturedAt > readAt) || route === "unregistered" && (capturedAt !== null || handoverNeeded)) fail();
        data = { kind: "self", family: q.family, requestId: q.requestId, submittedAt, route, handoverNeeded, capturedAt };
      } else if (q.mode === "list") {
        const d = exact(v.data, ["kind", "items", "nextCursor"]); if (d.kind !== "list") fail();
        const items: Extract<ReviewRoutingData, { kind: "list" }>["items"][number][] = []; let prior = q.cursor; const seen = new Set<string>();
        for (const rawItem of arr(d.items)) { const x = exact(rawItem, ["request", "current", "observation"]), ref = request(x.request, q, readAt), current = await entry(x.current, q.siteId, ref, readAt);
          const cursor: ReviewRoutingListCursor = { kind: "list", siteId: q.siteId, beforeAt: current.recordedAt, beforeFamily: ref.family, beforeRequestId: ref.requestId }, key = ref.family + ref.requestId;
          if (seen.has(key) || prior && !afterList(cursor, prior)) fail(); seen.add(key); prior = cursor;
          items.push({ request: ref, current, observation: await observation(x.observation, q, ref, current, actorId, readAt) }); }
        const nextCursor = d.nextCursor === null ? null : listCursor(d.nextCursor, q.siteId);
        if (nextCursor && (items.length !== 25 || !same(nextCursor, prior))) fail(); data = { kind: "list", items, nextCursor };
      } else {
        const keys = q.mode === "detail" ? ["kind", "request", "current", "observation", "canRegister", "canTakeOver"] : q.mode === "history" ? ["kind", "request", "items", "nextBeforeRevision"] : ["kind", "request", "items", "nextCursor"];
        const d = exact(v.data, keys); if (d.kind !== q.mode) fail(); const ref = request(d.request, q, readAt);
        if (q.mode === "detail") {
          const current = d.current === null ? null : await entry(d.current, q.siteId, ref, readAt), o = await observation(d.observation, q, ref, current, actorId, readAt), canRegister = bool(d.canRegister), canTakeOver = bool(d.canTakeOver);
          if (canRegister && (ref.family === "correction_revision" || o.status !== "submitted" || !["unregistered", "needs_assignment", "handover_needed"].includes(o.routeState))
            || canTakeOver && (!current || o.status !== "submitted" || !["needs_assignment", "handover_needed"].includes(o.routeState))) fail();
          data = { kind: "detail", request: ref, current, observation: o, canRegister, canTakeOver };
        } else if (q.mode === "history") {
          const items: ReviewRoutingEntry[] = []; const seen = new Set<string>(); let previous: ReviewRoutingEntry | null = null;
          for (const rawItem of arr(d.items)) { const e = await entry(rawItem, q.siteId, ref, readAt);
            if (seen.has(e.operationId) || q.beforeRevision !== null && e.revision >= q.beforeRevision || previous && (previous.revision !== e.revision + 1 || previous.previousOperationId !== e.operationId || previous.recordedAt < e.recordedAt || !same(previous.origin, e.origin))) fail();
            seen.add(e.operationId); previous = e; items.push(e); }
          const next = d.nextBeforeRevision === null ? null : integer(d.nextBeforeRevision);
          if (next !== null ? items.length !== 25 || next !== items.at(-1)?.revision || next <= 1 : items.length > 0 && items.at(-1)?.revision !== 1) fail();
          data = { kind: "history", request: ref, items, nextBeforeRevision: next };
        } else if(q.mode === "grants") {
          const items: ReviewRoutingGrant[] = []; let previous = q.cursor ? q.cursor.afterDelegateEmployeeId + q.cursor.afterDelegateAuthUserId + q.cursor.afterGrantId : "";
          for (const rawItem of arr(d.items)) { const x = exact(rawItem, ["grantId", "delegateEmployeeId", "delegateAuthUserId", "delegateName", "validFrom", "validUntil", "usable", "reason"]);
            const g: ReviewRoutingGrant = { grantId: uuid(x.grantId), delegateEmployeeId: uuid(x.delegateEmployeeId), delegateAuthUserId: uuid(x.delegateAuthUserId), delegateName: label(x.delegateName, 120), validFrom: stamp(x.validFrom), validUntil: stamp(x.validUntil), usable: bool(x.usable), reason: x.reason === null ? null : enumValue(x.reason, ["grant_unavailable", "scope_unavailable"] as const) };
            const key = grantKey(g); if (key <= previous || g.validFrom >= g.validUntil || g.usable !== (g.reason === null) || g.usable && g.validFrom > readAt
              || g.delegateEmployeeId === ref.employeeId || g.delegateAuthUserId === ref.employeeAuthUserId) fail(); previous = key; items.push(g); }
          const nextCursor = d.nextCursor === null ? null : grantCursor(d.nextCursor, q);
          if (q.family === "correction_revision" && items.length || nextCursor && (items.length !== 25 || nextCursor.afterDelegateEmployeeId + nextCursor.afterDelegateAuthUserId + nextCursor.afterGrantId !== previous)) fail();
          data = { kind: "grants", request: ref, items, nextCursor };
        } else return fail();
      }
    }
    return freeze({ protocol: REVIEW_ROUTING_PROTOCOL, siteId: q.siteId, actorId, readAt, data, receipt });
  } catch { return fail("attendance_review_routing_invalid"); }
}
export async function parseReviewRoutingResponse(raw: unknown, query: ReviewRoutingQuery, actorId: string, command: ReviewRoutingCommand | null = null): Promise<ReviewRoutingResponse> {
  try { const v = owned(raw, REVIEW_ROUTING_RESPONSE_LIMIT); if (tag(v, "ok") === true) { const r = exact(v, ["ok", "data"]); return freeze({ ok: true, data: await parseReviewRoutingResult(r.data, query, actorId, command) }); }
    const r = exact(v, ["ok", "error"]), e = exact(r.error, ["code", "message"]);
    if (r.ok !== false || typeof e.code !== "string" || !Object.hasOwn(REVIEW_ROUTING_ERRORS, e.code)) fail(); return freeze({ ok: false, error: { code: e.code as ReviewRoutingError, message: label(e.message, 240) } });
  } catch { return fail("attendance_review_routing_invalid"); }
}
