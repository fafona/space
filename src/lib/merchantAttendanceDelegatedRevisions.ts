//208 additive, nonsecret protocol. Parsing is not authority: SQL owns current
//grant/epoch/identity/includePending, original evidence and same-TX sidecars.
import { attendanceSelfSite, attendanceSelfUuid } from "./merchantAttendanceSelf";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { captureBrowserExact, parseCaptureBrowserJson } from "./merchantAttendanceRuleCapturesBrowser";
import { assertDelegatedAuditTree, delegatedAuditStamp } from "./merchantAttendanceDelegatedAudit";
import { operationalRuleLedgerEncode, operationalRuleLedgerFreeze } from "./merchantAttendanceOperationalRuleLedger";
import { MANAGEMENT_DELEGATION_ERRORS, parseManagementDelegationScope, type ManagementDelegationScope } from "./merchantAttendanceManagementDelegation";
import { parseRevisionDecisionCommand, type RevisionDecisionCommand } from "./merchantAttendanceRevisionDecision";
import { parseRevisionApprovalResult, REVISION_APPROVAL_ERRORS, type RevisionApprovalResult } from "./merchantAttendanceRevisionApproval";

export const DELEGATED_REVISIONS_PROTOCOL = "attendance-delegated-revisions-v1" as const;
export const DELEGATED_REVISIONS_API = "/api/merchant-enterprise/attendance/delegated-revisions";
export const DELEGATED_REVISIONS_RPC = "faolla_attendance_delegated_revisions_v1";
export const DELEGATED_REVISIONS_COMMAND_BYTES = 4096;
export const DELEGATED_REVISIONS_REQUEST_BYTES = 8192;
export const DELEGATED_REVISIONS_RESULT_BYTES = 524288;
export const DELEGATED_REVISIONS_ERRORS: Readonly<Record<string, number>> = Object.freeze({
  ...MANAGEMENT_DELEGATION_ERRORS, ...REVISION_APPROVAL_ERRORS,
  attendance_delegated_revisions_disabled: 403, attendance_delegated_revisions_invalid: 503,
  attendance_identity_changed: 409, attendance_version_conflict: 409,
});
export type DelegatedRevisionsAction = "revision_approve" | "revision_reject";
export type DelegatedRevisionsScope = Extract<ManagementDelegationScope, { kind: "revision" | "formal_exception" }> & Readonly<{ kind: "revision" }>;
export type DelegatedRevisionsQuery = Readonly<{ siteId: string; grantId: string } & (
  { mode: "context"; requestId: string } | { mode: "recover"; operationId: string })>;
export type DelegatedRevisionsContextQuery = Extract<DelegatedRevisionsQuery, { mode: "context" }>;
export type DelegatedRevisionsCommand = Readonly<RevisionDecisionCommand>;
export type DelegatedRevisionsBody = Readonly<{ query: DelegatedRevisionsContextQuery; command: DelegatedRevisionsCommand }>;
export type DelegatedRevisionsReference = Readonly<{ kind: "revision"; requestId: string; rootRequestId: string;
  workerId: string; employeeId: string; employeeAuthUserId: string; requestRevision: number; baseOperationId: string; effectRevision: number | null }>;
export type DelegatedRevisionsReceipt = Readonly<{ operationId: string; actorId: string; grantId: string; action: DelegatedRevisionsAction;
  reference: DelegatedRevisionsReference; commandFingerprint: string; businessFingerprint: string; recordedAt: string }>;
type Base = Readonly<{ protocol: typeof DELEGATED_REVISIONS_PROTOCOL; siteId: string; actorId: string; readAt: string }>;
export type DelegatedRevisionsContextResult = Base & Readonly<{ kind: "context"; grantId: string; action: DelegatedRevisionsAction;
  scope: DelegatedRevisionsScope; context: Readonly<{ review: RevisionApprovalResult; canApprove: boolean; canReject: boolean }> }>;
export type DelegatedRevisionsResult = DelegatedRevisionsContextResult | (Base & Readonly<{ kind: "receipt"; receipt: DelegatedRevisionsReceipt | null }>);

function fail(code = "attendance_invalid_request"): never { throw new MerchantAttendanceError(code); }
const exact = captureBrowserExact, freeze = operationalRuleLedgerFreeze;
function snapshot(raw: unknown, maximum: number): unknown {
  assertDelegatedAuditTree(raw, maximum); return parseCaptureBrowserJson(JSON.stringify(raw));
}
const action = (v: unknown): DelegatedRevisionsAction => v === "revision_approve" || v === "revision_reject" ? v : fail();
const hash = (v: unknown): string => typeof v === "string" && /^[0-9a-f]{64}$/.test(v) ? v : fail();
const bool = (v: unknown): boolean => typeof v === "boolean" ? v : fail();
const positive = (v: unknown): number => typeof v === "number" && Number.isSafeInteger(v) && v >= 1 && v <= 9007199254740989 ? v : fail();
export function parseDelegatedRevisionsJson(raw: string, request = true): unknown {
  const max = request ? DELEGATED_REVISIONS_REQUEST_BYTES : DELEGATED_REVISIONS_RESULT_BYTES;
  if (typeof raw !== "string" || new TextEncoder().encode(raw).byteLength > max) return fail();
  const value = parseCaptureBrowserJson(raw); assertDelegatedAuditTree(value, max); return value;
}
export function parseDelegatedRevisionsQuery(raw: unknown): DelegatedRevisionsQuery {
  const v = snapshot(raw, 4096), mode = Object.getOwnPropertyDescriptor(v, "mode")?.value;
  const q = exact(v, ["siteId", "grantId", "mode", ...(mode === "context" ? ["requestId"] : ["operationId"])]);
  const base = { siteId: attendanceSelfSite(q.siteId), grantId: attendanceSelfUuid(q.grantId) };
  if (mode === "context") return freeze({ ...base, mode, requestId: attendanceSelfUuid(q.requestId) });
  if (mode === "recover") return freeze({ ...base, mode, operationId: attendanceSelfUuid(q.operationId) }); return fail();
}
export function delegatedRevisionsQueryString(raw: DelegatedRevisionsQuery): string {
  const q = parseDelegatedRevisionsQuery(raw); return new URLSearchParams(Object.entries(q)).toString();
}
export function parseDelegatedRevisionsCommand(raw: unknown): DelegatedRevisionsCommand {
  const c = exact(snapshot(raw, DELEGATED_REVISIONS_COMMAND_BYTES), ["action", "operationId", "requestId", "expectedRevision", "expectedEvidence", "expectedBaseOperationId", "reason"]);
  //Only old7keys; no site override, annul, caller permission or new CAS model.
  return freeze(parseRevisionDecisionCommand({ siteId: "99990208", ...c }).command);
}
export function parseDelegatedRevisionsBody(raw: unknown): DelegatedRevisionsBody {
  const b = exact(snapshot(raw, DELEGATED_REVISIONS_REQUEST_BYTES), ["query", "command"]), q = parseDelegatedRevisionsQuery(b.query), c = parseDelegatedRevisionsCommand(b.command);
  if (q.mode !== "context" || q.requestId !== c.requestId) return fail(); return freeze({ query: q, command: c });
}
export function delegatedRevisionsFingerprintText(rawQuery: DelegatedRevisionsQuery, actualActor: string, raw: DelegatedRevisionsCommand): string {
  const q = parseDelegatedRevisionsQuery(rawQuery), c = parseDelegatedRevisionsCommand(raw);
  if (q.mode === "context" ? q.requestId !== c.requestId : q.operationId !== c.operationId) return fail();
  return operationalRuleLedgerEncode([DELEGATED_REVISIONS_PROTOCOL + "-command", q.siteId, attendanceSelfUuid(actualActor), q.grantId,
    [c.action, c.operationId, c.requestId, c.expectedRevision, c.expectedEvidence, c.expectedBaseOperationId, c.reason]]);
}
export async function delegatedRevisionsCommandFingerprint(q: DelegatedRevisionsQuery, actor: string, c: DelegatedRevisionsCommand): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(delegatedRevisionsFingerprintText(q, actor, c)));
  return [...new Uint8Array(bytes)].map(n => n.toString(16).padStart(2, "0")).join("");
}
function reference(raw: unknown, a: DelegatedRevisionsAction): DelegatedRevisionsReference {
  const r = exact(raw, ["kind", "requestId", "rootRequestId", "workerId", "employeeId", "employeeAuthUserId", "requestRevision", "baseOperationId", "effectRevision"]);
  if (r.kind !== "revision" || (a === "revision_reject") !== (r.effectRevision === null)) return fail();
  const ref = { kind: "revision" as const, requestId: attendanceSelfUuid(r.requestId), rootRequestId: attendanceSelfUuid(r.rootRequestId), workerId: attendanceSelfUuid(r.workerId),
    employeeId: attendanceSelfUuid(r.employeeId), employeeAuthUserId: attendanceSelfUuid(r.employeeAuthUserId), requestRevision: positive(r.requestRevision),
    baseOperationId: attendanceSelfUuid(r.baseOperationId), effectRevision: r.effectRevision === null ? null : positive(r.effectRevision) };
  if (ref.requestId === ref.rootRequestId || [ref.requestId, ref.rootRequestId].includes(ref.baseOperationId) || ref.effectRevision !== null && ref.effectRevision < 2) return fail(); return ref;
}
export async function parseDelegatedRevisionsResult(raw: unknown, rawQuery: DelegatedRevisionsQuery, actualActor: string,
  expected: DelegatedRevisionsCommand | null = null): Promise<DelegatedRevisionsResult> {
  try {
    const input = snapshot(raw, DELEGATED_REVISIONS_RESULT_BYTES), q = parseDelegatedRevisionsQuery(rawQuery), actorId = attendanceSelfUuid(actualActor), c = expected === null ? null : parseDelegatedRevisionsCommand(expected);
    if (c && (q.mode === "context" ? q.requestId !== c.requestId : q.operationId !== c.operationId)) return fail();
    const kind = Object.getOwnPropertyDescriptor(input, "kind")?.value;
    const v = exact(input, ["protocol", "siteId", "actorId", "readAt", "kind", ...(kind === "receipt" ? ["receipt"] : ["grantId", "action", "scope", "context"])]);
    if (v.protocol !== DELEGATED_REVISIONS_PROTOCOL || v.siteId !== q.siteId || v.actorId !== actorId) return fail();
    const base: Base = { protocol: DELEGATED_REVISIONS_PROTOCOL, siteId: q.siteId, actorId, readAt: delegatedAuditStamp(v.readAt) };
    if (kind === "receipt") {
      let receipt: DelegatedRevisionsReceipt | null = null;
      if (v.receipt !== null) {
        const r = exact(v.receipt, ["operationId", "actorId", "grantId", "action", "reference", "commandFingerprint", "businessFingerprint", "recordedAt"]), a = action(r.action), ref = reference(r.reference, a);
        receipt = { operationId: attendanceSelfUuid(r.operationId), actorId: attendanceSelfUuid(r.actorId), grantId: attendanceSelfUuid(r.grantId), action: a, reference: ref,
          commandFingerprint: hash(r.commandFingerprint), businessFingerprint: hash(r.businessFingerprint), recordedAt: delegatedAuditStamp(r.recordedAt) };
        if (receipt.actorId !== actorId || receipt.grantId !== q.grantId || receipt.operationId !== (c?.operationId ?? (q.mode === "recover" ? q.operationId : null))
          || receipt.recordedAt > base.readAt || [ref.requestId, ref.rootRequestId, ref.baseOperationId].includes(receipt.operationId)
          || c && (receipt.action !== (c.action === "approve" ? "revision_approve" : "revision_reject") || ref.requestId !== c.requestId
            || ref.requestRevision !== c.expectedRevision || ref.baseOperationId !== c.expectedBaseOperationId
            || receipt.commandFingerprint !== await delegatedRevisionsCommandFingerprint(q, actorId, c))) return fail();
      }
      if (q.mode === "context" && (c === null || receipt === null)) return fail(); return freeze({ ...base, kind, receipt });
    }
    if (kind !== "context" || q.mode !== "context" || c !== null || v.grantId !== q.grantId) return fail();
    const a = action(v.action), rawScope = parseManagementDelegationScope(v.scope, a); if (rawScope.kind !== "revision" || rawScope.employeeAuthUserId === actorId) return fail();
    const scope: DelegatedRevisionsScope = { ...rawScope, kind: "revision" };
    const ctx = exact(v.context, ["review", "canApprove", "canReject"]), canApprove = bool(ctx.canApprove), canReject = bool(ctx.canReject), review = parseRevisionApprovalResult(ctx.review, { siteId: q.siteId, requestId: q.requestId, operationId: null });
    const r = review.review.review, app = r.application, evidence = r.evidence;
    if (review.asOf > base.readAt || review.review.requestState !== "submitted" || review.decision !== null || review.receipt !== null || review.replayed || review.effectiveChanged
      || !review.writeEnabled || app.workerId !== scope.workerId || app.employeeId !== scope.employeeId || app.basis.workerId !== scope.workerId
      || app.basis.employeeId !== scope.employeeId || !evidence.bindingCurrent || evidence.ownApplication
      || canApprove !== (a === "revision_approve" && review.canApprove) || canReject !== (a === "revision_reject" && review.canReject)) return fail();
    const events = [...app.basis.events, ...(evidence.currentBasis?.events ?? []), ...(evidence.previous ? [evidence.previous] : []), ...(evidence.next ? [evidence.next] : [])];
    if (events.some(event => !scope.locationIds.includes(event.locationId))) return fail();
    return freeze({ ...base, kind, grantId: q.grantId, action: a, scope, context: { review, canApprove, canReject } });
  } catch { return fail("attendance_delegated_revisions_invalid"); }
}
export function delegatedRevisionsCommandForContext(result: DelegatedRevisionsContextResult, raw: unknown): DelegatedRevisionsCommand {
  const c = parseDelegatedRevisionsCommand(raw), r = result.context.review;
  if (c.action !== (result.action === "revision_approve" ? "approve" : "reject") || c.requestId !== r.requestId || c.expectedRevision !== r.review.submittedRevision
    || c.expectedBaseOperationId !== r.review.base.operationId || c.expectedEvidence !== r.evidenceToken
    || !(c.action === "approve" ? result.context.canApprove : result.context.canReject)) return fail(); return c;
}
