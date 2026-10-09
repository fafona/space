//209 additive protocol. Parsing is not authority; SQL owns the grant, actual
//employee binding, published-at cutoff, evidence, period and atomic decision.
import { attendanceSelfSite, attendanceSelfUuid } from "./merchantAttendanceSelf";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { captureBrowserExact as exact, parseCaptureBrowserJson } from "./merchantAttendanceRuleCapturesBrowser";
import { assertDelegatedAuditTree, delegatedAuditStamp } from "./merchantAttendanceDelegatedAudit";
import { operationalRuleLedgerEncode, operationalRuleLedgerFreeze as freeze } from "./merchantAttendanceOperationalRuleLedger";
import { MANAGEMENT_DELEGATION_ERRORS, parseManagementDelegationScope, type ManagementDelegationScope } from "./merchantAttendanceManagementDelegation";
import { PLAN_EXCEPTION_ERRORS, parsePlanExceptionCommand, parsePlanExceptionResult, type PlanExceptionDecisionCommand, type PlanExceptionResult } from "./merchantAttendancePlanExceptions";
import { canClearPlanException } from "./merchantAttendancePlanClearance";
import { canMarkPlanExceptionNotApplicable } from "./merchantAttendancePlanPosthocReview";

export const DELEGATED_PLAN_EXCEPTIONS_PROTOCOL = "attendance-delegated-plan-exceptions-v1" as const;
export const DELEGATED_PLAN_EXCEPTIONS_API = "/api/merchant-enterprise/attendance/delegated-plan-exceptions";
export const DELEGATED_PLAN_EXCEPTIONS_RPC = "faolla_attendance_delegated_plan_exceptions_v1";
export const DELEGATED_PLAN_EXCEPTIONS_COMMAND_BYTES = 4096;
export const DELEGATED_PLAN_EXCEPTIONS_REQUEST_BYTES = 8192;
export const DELEGATED_PLAN_EXCEPTIONS_RESULT_BYTES = 524288;
export const DELEGATED_PLAN_EXCEPTIONS_ERRORS: Readonly<Record<string, number>> = Object.freeze({
  ...MANAGEMENT_DELEGATION_ERRORS, ...PLAN_EXCEPTION_ERRORS,
  attendance_delegated_plan_exceptions_disabled: 403, attendance_delegated_plan_exceptions_invalid: 503,
  attendance_identity_changed: 409,
});
export type DelegatedPlanExceptionsScope = Extract<ManagementDelegationScope, { kind: "revision" | "formal_exception" }> & Readonly<{ kind: "formal_exception" }>;
export type DelegatedPlanExceptionsQuery = Readonly<{ siteId: string; grantId: string } & (
  { mode: "context"; workerId: string; slotId: string } | { mode: "recover"; operationId: string })>;
export type DelegatedPlanExceptionsContextQuery = Extract<DelegatedPlanExceptionsQuery, { mode: "context" }>;
export type DelegatedPlanExceptionsCommand = Readonly<PlanExceptionDecisionCommand>;
export type DelegatedPlanExceptionsBody = Readonly<{ query: DelegatedPlanExceptionsContextQuery; command: DelegatedPlanExceptionsCommand }>;
export type DelegatedPlanExceptionsReference = Readonly<{ kind: "formal_exception"; workerId: string; slotId: string; employeeId: string;
  employeeAuthUserId: string; caseId: string; decisionRevision: number }>;
export type DelegatedPlanExceptionsReceipt = Readonly<{ operationId: string; actorId: string; grantId: string; action: "plan_exception_decide";
  reference: DelegatedPlanExceptionsReference; commandFingerprint: string; businessFingerprint: string; recordedAt: string }>;
type Base = Readonly<{ protocol: typeof DELEGATED_PLAN_EXCEPTIONS_PROTOCOL; siteId: string; actorId: string; readAt: string }>;
export type DelegatedPlanExceptionsContextResult = Base & Readonly<{ kind: "context"; grantId: string; action: "plan_exception_decide";
  scope: DelegatedPlanExceptionsScope; context: Readonly<{ review: PlanExceptionResult; canDecide: boolean; canConclude: boolean; canClear: boolean; canNotApplicable: boolean }> }>;
export type DelegatedPlanExceptionsResult = DelegatedPlanExceptionsContextResult | (Base & Readonly<{ kind: "receipt"; receipt: DelegatedPlanExceptionsReceipt | null }>);
function fail(code = "attendance_invalid_request"): never { throw new MerchantAttendanceError(code); }
function snapshot(raw: unknown, maximum: number): unknown { assertDelegatedAuditTree(raw, maximum); return parseCaptureBrowserJson(JSON.stringify(raw)); }
const hash = (v: unknown): string => typeof v === "string" && /^[0-9a-f]{64}$/.test(v) ? v : fail();
const bool = (v: unknown): boolean => typeof v === "boolean" ? v : fail();
const positive = (v: unknown): number => typeof v === "number" && Number.isSafeInteger(v) && v >= 1 && v <= 9007199254740989 ? v : fail();
export function parseDelegatedPlanExceptionsJson(raw: string, request = true): unknown {
  const maximum = request ? DELEGATED_PLAN_EXCEPTIONS_REQUEST_BYTES : DELEGATED_PLAN_EXCEPTIONS_RESULT_BYTES;
  if (typeof raw !== "string" || new TextEncoder().encode(raw).byteLength > maximum) return fail();
  const value = parseCaptureBrowserJson(raw); assertDelegatedAuditTree(value, maximum); return value;
}
export function parseDelegatedPlanExceptionsQuery(raw: unknown): DelegatedPlanExceptionsQuery {
  const input = snapshot(raw, 4096), mode = Object.getOwnPropertyDescriptor(input, "mode")?.value;
  const q = exact(input, ["siteId", "grantId", "mode", ...(mode === "context" ? ["workerId", "slotId"] : ["operationId"])]);
  const base = { siteId: attendanceSelfSite(q.siteId), grantId: attendanceSelfUuid(q.grantId) };
  if (mode === "context") return freeze({ ...base, mode, workerId: attendanceSelfUuid(q.workerId), slotId: attendanceSelfUuid(q.slotId) });
  if (mode === "recover") return freeze({ ...base, mode, operationId: attendanceSelfUuid(q.operationId) }); return fail();
}
export function delegatedPlanExceptionsQueryString(raw: DelegatedPlanExceptionsQuery): string { return new URLSearchParams(Object.entries(parseDelegatedPlanExceptionsQuery(raw))).toString(); }
export function delegatedPlanExceptionsOldQuery(q: DelegatedPlanExceptionsContextQuery, operationId: string | null = null) {
  return { siteId: q.siteId, access: "owner" as const, mode: operationId === null ? "detail" as const : "decide" as const,
    workerId: q.workerId, slotId: q.slotId, operationId, beforeAt: null, beforeId: null };
}
export function parseDelegatedPlanExceptionsCommand(raw: unknown): DelegatedPlanExceptionsCommand {
  const c = exact(snapshot(raw, DELEGATED_PLAN_EXCEPTIONS_COMMAND_BYTES), ["operationId", "expectedRevision", "expectedFingerprint", "employeeId", "employeeAuthUserId", "outcome", "note"]);
  const parsed = parsePlanExceptionCommand({ siteId: "99990209", access: "owner", mode: "decide", workerId: attendanceSelfUuid(c.employeeId),
    slotId: attendanceSelfUuid(c.employeeAuthUserId), operationId: attendanceSelfUuid(c.operationId), beforeAt: null, beforeId: null }, c);
  if (!("outcome" in parsed)) return fail(); return freeze(parsed);
}
export function parseDelegatedPlanExceptionsBody(raw: unknown): DelegatedPlanExceptionsBody {
  const b = exact(snapshot(raw, DELEGATED_PLAN_EXCEPTIONS_REQUEST_BYTES), ["query", "command"]), query = parseDelegatedPlanExceptionsQuery(b.query), command = parseDelegatedPlanExceptionsCommand(b.command);
  if (query.mode !== "context") return fail(); return freeze({ query, command });
}
export function delegatedPlanExceptionsFingerprintText(rawQuery: DelegatedPlanExceptionsContextQuery, actor: string, raw: DelegatedPlanExceptionsCommand): string {
  const q = parseDelegatedPlanExceptionsQuery(rawQuery), c = parseDelegatedPlanExceptionsCommand(raw); if (q.mode !== "context") return fail();
  return operationalRuleLedgerEncode([DELEGATED_PLAN_EXCEPTIONS_PROTOCOL + "-command", q.siteId, attendanceSelfUuid(actor), q.grantId,
    [q.workerId, q.slotId], [c.operationId, c.expectedRevision, c.expectedFingerprint, c.employeeId, c.employeeAuthUserId, c.outcome, c.note]]);
}
export async function delegatedPlanExceptionsCommandFingerprint(q: DelegatedPlanExceptionsContextQuery, actor: string, c: DelegatedPlanExceptionsCommand): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(delegatedPlanExceptionsFingerprintText(q, actor, c)));
  return [...new Uint8Array(digest)].map(n => n.toString(16).padStart(2, "0")).join("");
}
function reference(raw: unknown): DelegatedPlanExceptionsReference {
  const v = exact(raw, ["kind", "workerId", "slotId", "employeeId", "employeeAuthUserId", "caseId", "decisionRevision"]);
  if (v.kind !== "formal_exception") return fail(); return { kind: v.kind, workerId: attendanceSelfUuid(v.workerId), slotId: attendanceSelfUuid(v.slotId),
    employeeId: attendanceSelfUuid(v.employeeId), employeeAuthUserId: attendanceSelfUuid(v.employeeAuthUserId), caseId: attendanceSelfUuid(v.caseId), decisionRevision: positive(v.decisionRevision) };
}
export async function parseDelegatedPlanExceptionsResult(raw: unknown, rawQuery: DelegatedPlanExceptionsQuery, actualActor: string,
  expected: DelegatedPlanExceptionsCommand | null = null): Promise<DelegatedPlanExceptionsResult> {
  try {
    const input = snapshot(raw, DELEGATED_PLAN_EXCEPTIONS_RESULT_BYTES), q = parseDelegatedPlanExceptionsQuery(rawQuery), actorId = attendanceSelfUuid(actualActor),
      c = expected === null ? null : parseDelegatedPlanExceptionsCommand(expected), kind = Object.getOwnPropertyDescriptor(input, "kind")?.value;
    if (q.mode === "recover" && c && c.operationId !== q.operationId) return fail();
    const v = exact(input, ["protocol", "siteId", "actorId", "readAt", "kind", ...(kind === "receipt" ? ["receipt"] : ["grantId", "action", "scope", "context"])]);
    if (v.protocol !== DELEGATED_PLAN_EXCEPTIONS_PROTOCOL || v.siteId !== q.siteId || v.actorId !== actorId) return fail();
    const base: Base = { protocol: DELEGATED_PLAN_EXCEPTIONS_PROTOCOL, siteId: q.siteId, actorId, readAt: delegatedAuditStamp(v.readAt) };
    if (kind === "receipt") {
      let receipt: DelegatedPlanExceptionsReceipt | null = null;
      if (v.receipt !== null) {
        const r = exact(v.receipt, ["operationId", "actorId", "grantId", "action", "reference", "commandFingerprint", "businessFingerprint", "recordedAt"]), ref = reference(r.reference);
        if (r.action !== "plan_exception_decide") return fail();
        receipt = { operationId: attendanceSelfUuid(r.operationId), actorId: attendanceSelfUuid(r.actorId), grantId: attendanceSelfUuid(r.grantId), action: r.action,
          reference: ref, commandFingerprint: hash(r.commandFingerprint), businessFingerprint: hash(r.businessFingerprint), recordedAt: delegatedAuditStamp(r.recordedAt) };
        const target: DelegatedPlanExceptionsContextQuery = { siteId: q.siteId, grantId: q.grantId, mode: "context", workerId: ref.workerId, slotId: ref.slotId };
        if (receipt.actorId !== actorId || receipt.grantId !== q.grantId || receipt.operationId !== (c?.operationId ?? (q.mode === "recover" ? q.operationId : null))
          || receipt.recordedAt > base.readAt || ref.employeeAuthUserId === actorId || ref.decisionRevision === 1 && ref.caseId !== receipt.operationId
          || q.mode === "context" && (q.workerId !== ref.workerId || q.slotId !== ref.slotId)
          || c && (ref.employeeId !== c.employeeId || ref.employeeAuthUserId !== c.employeeAuthUserId || ref.decisionRevision !== c.expectedRevision + 1
            || receipt.commandFingerprint !== await delegatedPlanExceptionsCommandFingerprint(target, actorId, c))) return fail();
      }
      if (q.mode === "context" && (c === null || receipt === null)) return fail(); return freeze({ ...base, kind, receipt });
    }
    if (kind !== "context" || q.mode !== "context" || c !== null || v.grantId !== q.grantId || v.action !== "plan_exception_decide") return fail();
    const rawScope = parseManagementDelegationScope(v.scope, "plan_exception_decide");
    if (rawScope.kind !== "formal_exception" || rawScope.workerId !== q.workerId || rawScope.employeeAuthUserId === actorId) return fail();
    const scope: DelegatedPlanExceptionsScope = { ...rawScope, kind: "formal_exception" };
    const ctx = exact(v.context, ["review", "canDecide", "canConclude", "canClear", "canNotApplicable"]), review = parsePlanExceptionResult(ctx.review, delegatedPlanExceptionsOldQuery(q), { authUserId: actorId }), d = review.detail;
    const canDecide = bool(ctx.canDecide), canConclude = bool(ctx.canConclude), canClear = bool(ctx.canClear), canNotApplicable = bool(ctx.canNotApplicable);
    if (!d?.current || review.readAt > base.readAt || review.receipt !== null || review.readReceipt !== null || d.worker.employeeId !== scope.employeeId
      || d.worker.employeeAuthUserId !== scope.employeeAuthUserId || !scope.locationIds.includes(d.current.slot.locationId)
      || canDecide !== d.canDecide || canConclude !== (canDecide && d.current.eligible && [d.current.candidate.late.state, d.current.candidate.early.state].includes("triggered"))
      || canClear && !canClearPlanException(d) || canNotApplicable && !canMarkPlanExceptionNotApplicable(d)) return fail();
    return freeze({ ...base, kind, grantId: q.grantId, action: "plan_exception_decide", scope, context: { review, canDecide, canConclude, canClear, canNotApplicable } });
  } catch { return fail("attendance_delegated_plan_exceptions_invalid"); }
}
export function delegatedPlanExceptionsCommandForContext(result: DelegatedPlanExceptionsContextResult, raw: unknown): DelegatedPlanExceptionsCommand {
  const c = parseDelegatedPlanExceptionsCommand(raw), d = result.context.review.detail;
  if (!d?.current || !result.context.canDecide || c.expectedRevision !== d.revision || c.expectedFingerprint !== d.current.fingerprint
    || c.employeeId !== result.scope.employeeId || c.employeeAuthUserId !== result.scope.employeeAuthUserId
    || (c.outcome === "confirmed" || c.outcome === "excused") && !result.context.canConclude
    || c.outcome === "cleared" && !result.context.canClear || c.outcome === "not_applicable" && !result.context.canNotApplicable) return fail(); return c;
}
