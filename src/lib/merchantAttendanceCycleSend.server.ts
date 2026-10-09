import { createServerSupabaseServiceClient } from "./superAdminServer";
import type { AttendanceSelfRpc } from "./merchantAttendanceSelf.server";
import { attendanceSelfUuid } from "./merchantAttendanceSelf";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { executeCycleIntent, cycleIntentEnabled } from "./merchantAttendanceCycleIntent.server";
import { projectPeriodClosureSource } from "./merchantAttendancePeriodClosure.server";
import { periodClosuresV2SiteEnabled } from "./merchantAttendancePeriodClosureV2.server";
import { executePeriodDelegatedClosures, periodDelegatedClosuresEnabled } from "./merchantAttendancePeriodDelegatedClosure.server";
import { parsePeriodClosureQuery, type PeriodClosureArtifact, type PeriodDelegatedArtifactDraft } from "./merchantAttendancePeriodClosure";
import { parsePeriodDelegatedClosureQuery } from "./merchantAttendancePeriodDelegatedClosure";
import { parseCycleSendBody, parseCycleSendQuery, cycleSendQueryFrame, cycleSendPeriodQuery, cycleSendIntent, cycleSendCommandFingerprint,
  type CycleSendBody, type CycleSendFrame, type CycleSendQuery } from "./merchantAttendanceCycleSend";
import { CYCLE_SEND_ERRORS, parseCycleSendResult } from "./merchantAttendanceCycleSendResult";

function fail(code = "attendance_operational_cycle_invalid"): never { throw new MerchantAttendanceError(code); }
function guardSignal(signal?: AbortSignal) { if (signal?.aborted) fail(); }
// Aborting cannot undo a dispatched SQL writer. It does prevent a late read
// from starting the next RPC (especially the first write) after HTTP timeout.
function guardedService(service: AttendanceSelfRpc | null, signal?: AbortSignal): AttendanceSelfRpc | null {
  if (!service) return null;
  return { rpc: async (name, args) => { guardSignal(signal); const result = await service.rpc(name, args); guardSignal(signal); return result; } };
}
async function rpc(service: AttendanceSelfRpc | null, name: string, args: Record<string, unknown>) {
  if (!service) fail(); let result;
  try { result = await service.rpc(name, args); } catch { return fail(); }
  if (result.error) { const code = result.error.message ?? ""; return fail(Object.hasOwn(CYCLE_SEND_ERRORS, code) ? code : undefined); }
  return result.data;
}
export function cycleSendEnabled(site: string, access: "owner" | "delegate", env: Readonly<Record<string, string | undefined>> = process.env) {
  return cycleIntentEnabled(site, env) && (access === "owner" ? periodClosuresV2SiteEnabled(site, env)
    : access === "delegate" && periodDelegatedClosuresEnabled(site, env));
}
async function recover(frame: CycleSendFrame, actor: string, operationId: string, fingerprint: string, service: AttendanceSelfRpc | null) {
  const raw = await rpc(service, "faolla_attendance_operational_cycle_send_recover_v1", {
    p_query: cycleSendPeriodQuery(frame, "recover", operationId), p_auth_user_id: actor,
    p_intent: cycleSendIntent(frame), p_expected_fingerprint: fingerprint,
  });
  return parseCycleSendResult(raw, frame, actor, operationId, fingerprint);
}
export async function executeCycleSendRecovery(input: { query: CycleSendQuery; authUserId: string },
  service: AttendanceSelfRpc | null = createServerSupabaseServiceClient(), signal?: AbortSignal) {
  guardSignal(signal); service = guardedService(service, signal);
  const query = parseCycleSendQuery(input.query), actor = attendanceSelfUuid(input.authUserId);
  if (query.mode !== "recover") fail("attendance_invalid_request");
  // Original-id read never checks today's flags, grant directory, source,
  // capacity, or period body. SQL independently proves the saved actor/request.
  const result = await recover(cycleSendQueryFrame(query), actor, query.operationId, query.commandFingerprint, service);
  guardSignal(signal); return result;
}
export async function executeCycleSend(input: { body: CycleSendBody; authUserId: string; allowWrite: boolean },
  service: AttendanceSelfRpc | null = createServerSupabaseServiceClient(), signal?: AbortSignal) {
  guardSignal(signal); service = guardedService(service, signal);
  const { frame, command } = parseCycleSendBody(input.body), actor = attendanceSelfUuid(input.authUserId);
  if (typeof input.allowWrite !== "boolean") fail("attendance_invalid_request");
  const fingerprint = await cycleSendCommandFingerprint(frame, command, actor); guardSignal(signal);
  const original = await recover(frame, actor, command.operationId, fingerprint, service); guardSignal(signal);
  if (original.receipt !== null) return parseCycleSendResult(original, frame, actor, command.operationId, fingerprint, command);
  if (!input.allowWrite) fail("attendance_operational_cycle_disabled");
  // A valid pending digest cannot manufacture or adopt an intent. Read the
  // actual saved intent under the real current owner/delegate's SQL authority.
  const intentResult = await executeCycleIntent({ query: { siteId: frame.siteId, access: frame.access, workerId: frame.workerId,
    grantId: frame.grantId, mode: "detail", intentId: frame.intentId }, command: null, authUserId: actor, allowAccept: false }, service);
  guardSignal(signal);
  if (intentResult.data.kind !== "detail") fail();
  const { intent, head } = intentResult.data;
  if (intent.actorId !== actor || intent.access !== frame.access || intent.grantId !== frame.grantId
    || intent.intentFingerprint !== frame.expectedIntentFingerprint || intent.workerId !== frame.workerId
    || intent.fromDate !== frame.fromDate || intent.throughDate !== frame.throughDate || head.action !== "accept"
    || head.revision !== 1 || head.operationId !== frame.intentId) fail("attendance_operational_cycle_changed");
  let artifact: PeriodClosureArtifact | PeriodDelegatedArtifactDraft, blockers: readonly string[];
  if (frame.access === "owner") {
    const source = await rpc(service, "faolla_attendance_period_closure_source_v1", { p_query: { siteId: frame.siteId, access: "owner", workerId: frame.workerId,
      fromDate: frame.fromDate, throughDate: frame.throughDate, periodId: frame.periodId }, p_auth_user_id: actor });
    guardSignal(signal);
    const projected = projectPeriodClosureSource(source, parsePeriodClosureQuery({ siteId: frame.siteId, access: "owner", workerId: frame.workerId,
      fromDate: frame.fromDate, throughDate: frame.throughDate, mode: "preview", periodId: frame.periodId, operationId: null, version: null }));
    artifact = projected.artifact; blockers = projected.blockers;
  } else {
    // Use the existing genuine delegate preview/projector, not a forged owner
    // source or direct access to the private delegated-source helper.
    const preview = await executePeriodDelegatedClosures({ query: parsePeriodDelegatedClosureQuery({ ...cycleSendPeriodQuery(frame),
      mode: "preview", periodId: null }), authUserId: actor, moduleEnabled: true }, service);
    guardSignal(signal);
    if (preview.kind !== "preview") fail(); artifact = preview.preview.artifact; blockers = preview.preview.blockers;
  }
  if (artifact.sourceFingerprint !== command.expectedFingerprint) fail("attendance_period_source_changed");
  if (artifact.worker.workerId !== intent.workerId || artifact.worker.employeeId !== intent.employeeId || artifact.worker.employeeAuthUserId !== intent.employeeAuthUserId
    || artifact.period.fromDate !== intent.fromDate || artifact.period.throughDate !== intent.throughDate || artifact.period.timeZone !== intent.timeZone
    || artifact.period.startAt !== intent.fromAt || artifact.period.endAt !== intent.toAt) fail("attendance_period_identity_changed");
  if (blockers.length !== 0) fail("attendance_period_blocked");
  // The original writer still rechecks source, current authority, first-version
  // CAS, immutable intent/frame, capacity and the atomic adoption sidecar.
  guardSignal(signal);
  const result = await parseCycleSendResult(await rpc(service, "faolla_attendance_operational_cycle_send_v1", { p_query: cycleSendPeriodQuery(frame),
    p_auth_user_id: actor, p_command: command, p_artifact: artifact, p_intent: cycleSendIntent(frame), p_allow_write: true }),
  frame, actor, command.operationId, fingerprint, command);
  guardSignal(signal); return result;
}
