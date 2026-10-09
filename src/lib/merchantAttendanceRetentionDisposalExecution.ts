//197 Single-record disposal protocol. Parsing proves consistency, not authority:
//only the authenticated SQL collector may establish the saved dependencies.
import { captureBrowserExact as exact, parseCaptureBrowserJson } from "./merchantAttendanceRuleCapturesBrowser";
import { bool, hash, label, safeTree, same, site, stamp, uuid } from "./merchantAttendancePlanExceptionValidation";
import { operationalRuleLedgerEncode, operationalRuleLedgerFreeze as freeze } from "./merchantAttendanceOperationalRuleLedger";
import { evaluateRetentionDisposal, parseRetentionDisposalInput, RETENTION_DISPOSAL_FIELDS, RETENTION_DISPOSAL_PREVIEW_PROTOCOL,
  type RetentionDisposalInput, type RetentionDisposalBlocker } from "./merchantAttendanceRetentionDisposal";
import { MerchantAttendanceError } from "./merchantAttendanceTime";

export const DISPOSAL_EXECUTION_API = "/api/merchant-enterprise/attendance/retention-disposal";
export const DISPOSAL_LOCAL_SITE = "99990197";
export const DISPOSAL_EXECUTION_PROTOCOL = "attendance-retention-disposal-v1" as const;
export const DISPOSAL_TRUSTED_PREVIEW_PROTOCOL = "attendance-retention-disposal-trusted-preview-v1" as const;
export const DISPOSAL_EXECUTION_BODY_LIMIT = 8192, DISPOSAL_EXECUTION_RESPONSE_LIMIT = 131072;
export const DISPOSAL_EXECUTION_ERRORS = Object.freeze({ attendance_invalid_request: 400, attendance_access_denied: 403, attendance_operation_conflict: 409,
  attendance_retention_disposal_invalid: 503, attendance_retention_disposal_changed: 409, attendance_retention_disposal_blocked: 409,
  attendance_retention_disposal_disabled: 403, attendance_retention_disposal_not_found: 404, attendance_retention_disposal_too_large: 422 });
export type DisposalExecutionError = keyof typeof DISPOSAL_EXECUTION_ERRORS;
export type DisposalExecutionQuery = Readonly<{ siteId: string; mode: "preview" | "recover"; eventId: string | null; operationId: string | null }>;
export type DisposalApproveCommand = Readonly<{ action: "approve"; operationId: string; eventId: string; fields: typeof RETENTION_DISPOSAL_FIELDS;
  previewAt: string; expectedSourceFingerprint: string; expectedPolicyFingerprint: string; expectedDependencyFingerprint: string;
  expectedHoldFingerprint: string; expectedPreviewFingerprint: string; reason: string }>;
export type DisposalExecuteCommand = Readonly<{ action: "execute"; operationId: string; eventId: string; approvalOperationId: string }>;
export type DisposalExecutionCommand = DisposalApproveCommand | DisposalExecuteCommand;
export type DisposalExecutionReceipt = Readonly<{ operationId: string; action: "approve" | "execute"; eventId: string; approvalOperationId: string;
  actorId: string; recordedAt: string; commandFingerprint: string }>;
export type DisposalCoverage = Readonly<{ eventCovered: boolean; artifactsComplete: boolean; artifactLimitExceeded: boolean; alreadyDisposed: boolean }>;
export type DisposalExecutionBlocker = RetentionDisposalBlocker | "dependency_coverage_unknown" | "artifact_coverage_incomplete" | "artifact_dependency_limit" | "already_disposed";
export type DisposalTrustedPreview = Readonly<{ protocol: typeof DISPOSAL_TRUSTED_PREVIEW_PROTOCOL; siteId: string; asOf: string; eventId: string; workerId: string;
  fields: typeof RETENTION_DISPOSAL_FIELDS; dueAt: string | null; candidateState: "candidate" | "blocked"; blockers: readonly DisposalExecutionBlocker[];
  sourceFingerprint: string; policyFingerprint: string; dependencyFingerprint: string; holdFingerprint: string; previewFingerprint: string;
  basis: RetentionDisposalInput; coverage: DisposalCoverage }>;
export type DisposalExecutionResult = Readonly<{ protocol: typeof DISPOSAL_EXECUTION_PROTOCOL; siteId: string; actorId: string; readAt: string;
  data: { kind: "preview"; preview: DisposalTrustedPreview } | { kind: "receipt"; receipt: DisposalExecutionReceipt | null } }>;
export type DisposalExecutionResponse = Readonly<{ ok: true; data: DisposalExecutionResult } | { ok: false; error: { code: DisposalExecutionError; message: string } }>;
function fail(code = "attendance_invalid_request"): never { throw new MerchantAttendanceError(code); }
function snapshot(raw: unknown, cap: number) { safeTree(raw, cap); return parseCaptureBrowserJson(JSON.stringify(raw)); }
const tag = (v: unknown, key: string): unknown => v && typeof v === "object" ? Object.getOwnPropertyDescriptor(v, key)?.value : undefined;
async function digest(tuple: Parameters<typeof operationalRuleLedgerEncode>[0]) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(operationalRuleLedgerEncode(tuple)));
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, "0")).join("");
}
export function parseDisposalExecutionQuery(raw: unknown): DisposalExecutionQuery {
  try {
    const v = exact(snapshot(raw, DISPOSAL_EXECUTION_BODY_LIMIT), ["siteId", "mode", "eventId", "operationId"]);
    const siteId = site(v.siteId), eventId = v.eventId === null ? null : uuid(v.eventId), operationId = v.operationId === null ? null : uuid(v.operationId);
    if (v.mode !== "preview" && v.mode !== "recover" || v.mode === "preview" && (eventId === null || operationId !== null)
      || v.mode === "recover" && (eventId !== null || operationId === null)) fail();
    return freeze({ siteId, mode: v.mode, eventId, operationId });
  } catch { return fail(); }
}
export function disposalExecutionQueryString(raw: DisposalExecutionQuery): string {
  const q = parseDisposalExecutionQuery(raw), params = new URLSearchParams();
  for (const [key, value] of Object.entries(q)) if (value !== null) params.set(key, value);
  return params.toString();
}
export function parseDisposalExecutionHttpQuery(text: string): DisposalExecutionQuery {
  try {
    if (typeof text !== "string" || text.length > 4096 || /[\u0000-\u0020\u007f#]/.test(text) || /%(?![0-9a-fA-F]{2})/.test(text)) fail();
    const p = new URL(text).searchParams;
    for (const key of p.keys()) if (!["siteId", "mode", "eventId", "operationId"].includes(key) || p.getAll(key).length !== 1) fail();
    return parseDisposalExecutionQuery({ siteId: p.get("siteId"), mode: p.get("mode"), eventId: p.get("eventId"), operationId: p.get("operationId") });
  } catch { return fail(); }
}
export function parseDisposalExecutionCommand(query: DisposalExecutionQuery, raw: unknown): DisposalExecutionCommand {
  try {
    const q = parseDisposalExecutionQuery(query), source = snapshot(raw, DISPOSAL_EXECUTION_BODY_LIMIT), action = tag(source, "action");
    const keys = action === "approve" ? ["action", "operationId", "eventId", "fields", "previewAt", "expectedSourceFingerprint", "expectedPolicyFingerprint", "expectedDependencyFingerprint", "expectedHoldFingerprint", "expectedPreviewFingerprint", "reason"]
      : ["action", "operationId", "eventId", "approvalOperationId"];
    const c = exact(source, keys), operationId = uuid(c.operationId), eventId = uuid(c.eventId);
    if (q.mode !== "preview" || q.eventId !== eventId) fail();
    if (action === "execute") return freeze({ action, operationId, eventId, approvalOperationId: uuid(c.approvalOperationId) });
    if (action !== "approve" || !same(c.fields, RETENTION_DISPOSAL_FIELDS)) fail();
    return freeze({ action, operationId, eventId, fields: RETENTION_DISPOSAL_FIELDS, previewAt: stamp(c.previewAt),
      expectedSourceFingerprint: hash(c.expectedSourceFingerprint), expectedPolicyFingerprint: hash(c.expectedPolicyFingerprint),
      expectedDependencyFingerprint: hash(c.expectedDependencyFingerprint), expectedHoldFingerprint: hash(c.expectedHoldFingerprint),
      expectedPreviewFingerprint: hash(c.expectedPreviewFingerprint), reason: label(c.reason, 500) });
  } catch { return fail(); }
}
export function parseDisposalExecutionBody(raw: unknown) {
  try { const v = exact(snapshot(raw, DISPOSAL_EXECUTION_BODY_LIMIT), ["query", "command"]), query = parseDisposalExecutionQuery(v.query);
    return freeze({ query, command: parseDisposalExecutionCommand(query, v.command) }); } catch { return fail(); }
}
export function disposalExecutionCommandFingerprintText(siteId: string, actorId: string, raw: DisposalExecutionCommand): string {
  const source = snapshot(raw, DISPOSAL_EXECUTION_BODY_LIMIT);
  const q = parseDisposalExecutionQuery({ siteId, mode: "preview", eventId: tag(source, "eventId"), operationId: null }), c = parseDisposalExecutionCommand(q, source);
  const tuple = c.action === "execute" ? [c.action, c.operationId, c.eventId, c.approvalOperationId] : [c.action, c.operationId, c.eventId, c.fields,
    c.previewAt, c.expectedSourceFingerprint, c.expectedPolicyFingerprint, c.expectedDependencyFingerprint, c.expectedHoldFingerprint, c.expectedPreviewFingerprint, c.reason];
  return operationalRuleLedgerEncode(["attendance-retention-disposal-command-v1", q.siteId, uuid(actorId), tuple]);
}
export async function disposalExecutionCommandFingerprint(siteId: string, actorId: string, command: DisposalExecutionCommand) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(disposalExecutionCommandFingerprintText(siteId, actorId, command)));
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, "0")).join("");
}
export function parseDisposalExecutionJson(text: string, purpose: "request" | "response" = "response") {
  try { const cap = purpose === "request" ? DISPOSAL_EXECUTION_BODY_LIMIT : DISPOSAL_EXECUTION_RESPONSE_LIMIT;
    if (typeof text !== "string" || text.length > cap || new TextEncoder().encode(text).byteLength > cap) fail();
    const value = parseCaptureBrowserJson(text); safeTree(value, cap); return value;
  } catch { return fail(purpose === "request" ? "attendance_invalid_request" : "attendance_retention_disposal_invalid"); }
}
export function parseDisposalExecutionReceipt(raw: unknown): DisposalExecutionReceipt {
  try {
    const v = exact(snapshot(raw, 4096), ["operationId", "action", "eventId", "approvalOperationId", "actorId", "recordedAt", "commandFingerprint"]);
    const operationId = uuid(v.operationId), approvalOperationId = uuid(v.approvalOperationId);
    if (v.action !== "approve" && v.action !== "execute" || v.action === "approve" && operationId !== approvalOperationId) fail();
    return freeze({ operationId, action: v.action, eventId: uuid(v.eventId), approvalOperationId, actorId: uuid(v.actorId), recordedAt: stamp(v.recordedAt), commandFingerprint: hash(v.commandFingerprint) });
  } catch { return fail("attendance_retention_disposal_invalid"); }
}
export function disposalExecutionReceiptMatches(receipt: DisposalExecutionReceipt | null, siteId: string, actorId: string, command: DisposalExecutionCommand, fingerprint: string): boolean {
  try {
    const r = parseDisposalExecutionReceipt(receipt), source = snapshot(command, DISPOSAL_EXECUTION_BODY_LIMIT);
    const c = parseDisposalExecutionCommand({ siteId, mode: "preview", eventId: tag(source, "eventId") as string, operationId: null }, source);
    return r.actorId === uuid(actorId) && r.operationId === c.operationId && r.action === c.action && r.eventId === c.eventId
      && r.approvalOperationId === (c.action === "approve" ? c.operationId : c.approvalOperationId) && r.commandFingerprint === hash(fingerprint);
  } catch { return false; }
}
export async function parseDisposalTrustedPreview(raw: unknown): Promise<DisposalTrustedPreview> {
  try {
    const v = exact(snapshot(raw, DISPOSAL_EXECUTION_RESPONSE_LIMIT), ["protocol", "siteId", "asOf", "eventId", "workerId", "fields", "dueAt", "candidateState", "blockers", "sourceFingerprint", "policyFingerprint", "dependencyFingerprint", "holdFingerprint", "previewFingerprint", "basis", "coverage"]);
    const basis = parseRetentionDisposalInput(v.basis), c = exact(v.coverage, ["eventCovered", "artifactsComplete", "artifactLimitExceeded", "alreadyDisposed"]);
    const coverage: DisposalCoverage = { eventCovered: bool(c.eventCovered), artifactsComplete: bool(c.artifactsComplete), artifactLimitExceeded: bool(c.artifactLimitExceeded), alreadyDisposed: bool(c.alreadyDisposed) };
    if (v.protocol !== DISPOSAL_TRUSTED_PREVIEW_PROTOCOL || v.siteId !== basis.siteId || v.asOf !== basis.asOf || v.eventId !== basis.location.evidenceId
      || v.workerId !== basis.location.workerId || !same(v.fields, RETENTION_DISPOSAL_FIELDS)
      || coverage.artifactLimitExceeded !== (basis.dependencies.artifacts.coverage === "over_limit")
      || !coverage.artifactsComplete && !coverage.artifactLimitExceeded && basis.dependencies.artifacts.coverage !== "unknown"
      || coverage.alreadyDisposed && Object.values(basis.location.precisionPresent).some(Boolean)) fail();
    const pure = await evaluateRetentionDisposal(basis), extras: DisposalExecutionBlocker[] = [];
    if (!coverage.eventCovered) extras.push("dependency_coverage_unknown");
    if (!coverage.artifactsComplete) extras.push("artifact_coverage_incomplete");
    if (coverage.artifactLimitExceeded) extras.push("artifact_dependency_limit");
    if (coverage.alreadyDisposed) extras.push("already_disposed");
    const blockers: DisposalExecutionBlocker[] = [...pure.blockers, ...extras];
    if (v.dueAt !== pure.dueAt || v.candidateState !== (blockers.length ? "blocked" : "candidate") || !same(v.blockers, blockers)
      || ["sourceFingerprint", "policyFingerprint", "dependencyFingerprint", "holdFingerprint"].some(k => v[k] !== pure[k as keyof typeof pure])) fail();
    const l = basis.location;
    const previewFingerprint = await digest([RETENTION_DISPOSAL_PREVIEW_PROTOCOL, basis.siteId, basis.asOf,
      [l.evidenceId, l.workerId, l.sourceFingerprint, l.anchorAt, l.reason, l.needsReview, [l.precisionPresent.capturedAt, l.precisionPresent.accuracyMeters, l.precisionPresent.distanceMeters]],
      RETENTION_DISPOSAL_FIELDS, pure.policyFingerprint, pure.dependencyFingerprint, pure.holdFingerprint, pure.dueAt, blockers]);
    if (v.previewFingerprint !== previewFingerprint) fail();
    return freeze({ protocol: DISPOSAL_TRUSTED_PREVIEW_PROTOCOL, siteId: basis.siteId, asOf: basis.asOf, eventId: l.evidenceId, workerId: l.workerId,
      fields: RETENTION_DISPOSAL_FIELDS, dueAt: pure.dueAt, candidateState: blockers.length ? "blocked" : "candidate", blockers,
      sourceFingerprint: pure.sourceFingerprint, policyFingerprint: pure.policyFingerprint, dependencyFingerprint: pure.dependencyFingerprint,
      holdFingerprint: pure.holdFingerprint, previewFingerprint, basis, coverage });
  } catch { return fail("attendance_retention_disposal_invalid"); }
}
export async function parseDisposalExecutionResult(raw: unknown, query: DisposalExecutionQuery, actor: string, rawCommand: DisposalExecutionCommand | null = null): Promise<DisposalExecutionResult> {
  try {
    const q = parseDisposalExecutionQuery(query), command = rawCommand === null ? null : parseDisposalExecutionCommand(q, rawCommand), actorId = uuid(actor);
    const v = exact(snapshot(raw, DISPOSAL_EXECUTION_RESPONSE_LIMIT), ["protocol", "siteId", "actorId", "readAt", "data"]), readAt = stamp(v.readAt);
    if (v.protocol !== DISPOSAL_EXECUTION_PROTOCOL || v.siteId !== q.siteId || v.actorId !== actorId) fail();
    const kind = tag(v.data, "kind"); let data: DisposalExecutionResult["data"];
    if (kind === "preview" && q.mode === "preview" && command === null) {
      const d = exact(v.data, ["kind", "preview"]), preview = await parseDisposalTrustedPreview(d.preview);
      if (preview.siteId !== q.siteId || preview.eventId !== q.eventId || preview.asOf > readAt) fail(); data = { kind, preview };
    } else if (kind === "receipt" && (q.mode === "recover" || command !== null)) {
      const d = exact(v.data, ["kind", "receipt"]), receipt = d.receipt === null ? null : parseDisposalExecutionReceipt(d.receipt);
      if (command && receipt === null || receipt && (receipt.actorId !== actorId || receipt.operationId !== (command?.operationId ?? q.operationId) || receipt.recordedAt > readAt)) fail();
      if (command && !disposalExecutionReceiptMatches(receipt, q.siteId, actorId, command, await disposalExecutionCommandFingerprint(q.siteId, actorId, command))) fail();
      data = { kind, receipt };
    } else return fail();
    return freeze({ protocol: DISPOSAL_EXECUTION_PROTOCOL, siteId: q.siteId, actorId, readAt, data });
  } catch { return fail("attendance_retention_disposal_invalid"); }
}
export async function parseDisposalExecutionResponse(raw: unknown, query: DisposalExecutionQuery, actorId: string, command: DisposalExecutionCommand | null = null): Promise<DisposalExecutionResponse> {
  try {
    const s = snapshot(raw, DISPOSAL_EXECUTION_RESPONSE_LIMIT), ok = tag(s, "ok");
    if (ok === true) { const v = exact(s, ["ok", "data"]); return freeze({ ok: true, data: await parseDisposalExecutionResult(v.data, query, actorId, command) }); }
    const v = exact(s, ["ok", "error"]), e = exact(v.error, ["code", "message"]);
    if (ok !== false || typeof e.code !== "string" || !Object.hasOwn(DISPOSAL_EXECUTION_ERRORS, e.code)) fail();
    return freeze({ ok: false, error: { code: e.code as DisposalExecutionError, message: label(e.message, 500) } });
  } catch { return fail("attendance_retention_disposal_invalid"); }
}
