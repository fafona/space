import { createHash } from "node:crypto";
import { createServerSupabaseServiceClient } from "./superAdminServer";
import type { AttendanceSelfRpc } from "./merchantAttendanceSelf.server";
import { attendanceSelfUuid } from "./merchantAttendanceSelf";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { parseCaptureBrowserJson } from "./merchantAttendanceRuleCapturesBrowser";
import { periodClosureFail, periodClosureObject as obj, periodClosureSame } from "./merchantAttendancePeriodClosure";
import { projectPeriodDelegatedSource } from "./merchantAttendancePeriodClosure.server";
import { periodClosuresV2SiteEnabled } from "./merchantAttendancePeriodClosureV2.server";
import { periodDelegationEnabled } from "./merchantAttendancePeriodDelegation.server";
import { PERIOD_DELEGATED_CLOSURE_ERRORS, parsePeriodDelegatedClosureQuery, parsePeriodDelegatedClosureCommand,
  parsePeriodDelegatedClosureResult, periodDelegatedClosureFingerprintText,
  type PeriodDelegatedClosureQuery, type PeriodDelegatedClosureCommand } from "./merchantAttendancePeriodDelegatedClosure";

export function periodDelegatedClosuresEnabled(site: string, env: Readonly<Record<string, string | undefined>> = process.env) {
  return periodDelegationEnabled(site, env) && periodClosuresV2SiteEnabled(site, env);
}
const RPC = "faolla_attendance_period_delegated_closure_v1";
async function rpc(service: AttendanceSelfRpc | null, args: Record<string, unknown>) {
  if (!service) throw new MerchantAttendanceError("attendance_unavailable");
  let response;
  try { response = await service.rpc(RPC, args); } catch { throw new MerchantAttendanceError("attendance_unavailable"); }
  if (response.error) { const code = response.error.message ?? "";
    throw new MerchantAttendanceError(Object.hasOwn(PERIOD_DELEGATED_CLOSURE_ERRORS, code) ? code : "attendance_unavailable"); }
  return response.data;
}
export function projectPeriodDelegatedClosureResult(raw: unknown, q: PeriodDelegatedClosureQuery, actor: string, c: PeriodDelegatedClosureCommand | null) {
  const r = { ...obj(raw) };
  if (r.kind === "preview") {
    const value = projectPeriodDelegatedSource(r.source, q), period = r.period;
    delete r.source; delete r.period;
    return parsePeriodDelegatedClosureResult({ ...r, preview: { ...value, period } }, q, { authUserId: actor }, c);
  }
  if (r.kind === "detail") {
    if (r.artifact !== null) {
      if (typeof r.artifactText !== "string" || Buffer.byteLength(r.artifactText, "utf8") > 2097152
        || Buffer.byteLength(r.artifactText, "utf8") !== r.artifactBytes
        || createHash("sha256").update(r.artifactText, "utf8").digest("hex") !== r.artifactSha256
        || !periodClosureSame(parseCaptureBrowserJson(r.artifactText), r.artifact)) periodClosureFail();
    } else if (r.artifactText !== null || r.artifactBytes !== null || r.artifactSha256 !== null) periodClosureFail();
    delete r.artifactText; delete r.artifactBytes; delete r.artifactSha256;
  }
  const result = parsePeriodDelegatedClosureResult(r, q, { authUserId: actor }, c);
  if (c && (result.kind !== "receipt" || !result.receipt || result.receipt.commandFingerprint !==
    createHash("sha256").update(periodDelegatedClosureFingerprintText(q, c), "utf8").digest("hex"))) periodClosureFail();
  return result;
}
export async function executePeriodDelegatedClosures(input: { query: PeriodDelegatedClosureQuery; command?: PeriodDelegatedClosureCommand | null;
  authUserId: string; moduleEnabled: boolean }, service: AttendanceSelfRpc | null = createServerSupabaseServiceClient()) {
  const q = parsePeriodDelegatedClosureQuery(input.query), actor = attendanceSelfUuid(input.authUserId),
    c = input.command == null ? null : parsePeriodDelegatedClosureCommand(q, input.command);
  if (typeof input.moduleEnabled !== "boolean") periodClosureFail("attendance_invalid_request");
  // Only an explicit original-id GET survives a disabled feature. It returns
  // no source, period details, or restored authority. Never automatically POST.
  if (!input.moduleEnabled && (c || q.mode !== "recover")) periodClosureFail("attendance_period_delegation_disabled");
  const call = (query: PeriodDelegatedClosureQuery, command: PeriodDelegatedClosureCommand | null, artifact: unknown, allowed: boolean) =>
    rpc(service, { p_query: query, p_auth_user_id: actor, p_command: command, p_artifact: artifact, p_allow_write: allowed });
  let artifact: unknown = null;
  if (c?.action === "send") {
    const recovery = parsePeriodDelegatedClosureQuery({ ...q, mode: "recover", operationId: c.operationId });
    const recovered = projectPeriodDelegatedClosureResult(await call(recovery, null, null, false), recovery, actor, null);
    if (recovered.kind !== "receipt") return periodClosureFail();
    if (recovered.receipt) return projectPeriodDelegatedClosureResult(recovered, q, actor, c);
    const previewQuery = parsePeriodDelegatedClosureQuery({ ...q, mode: "preview", periodId: c.expectedRevision === 0 ? null : q.periodId });
    const preview = projectPeriodDelegatedClosureResult(await call(previewQuery, null, null, true), previewQuery, actor, null);
    if (preview.kind !== "preview") return periodClosureFail();
    if (preview.preview.artifact.sourceFingerprint !== c.expectedFingerprint) periodClosureFail("attendance_period_source_changed");
    artifact = preview.preview.artifact;
  }
  return projectPeriodDelegatedClosureResult(await call(q, c, artifact, input.moduleEnabled), q, actor, c);
}
