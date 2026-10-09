import { createHash } from "node:crypto";
import { createServerSupabaseServiceClient } from "./superAdminServer";
import type { AttendanceSelfRpc } from "./merchantAttendanceSelf.server";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { exact, safeTree, same, uuid } from "./merchantAttendancePlanExceptionValidation";
import { parseCaptureBrowserJson } from "./merchantAttendanceRuleCapturesBrowser";
import { PLAN_POSTHOC_ERRORS, parsePlanPosthocQuery, parsePlanPosthocCommand, parsePlanPosthocResult } from "./merchantAttendancePlanPosthoc";
import type { PlanPosthocQuery, PlanPosthocCommand } from "./merchantAttendancePlanPosthocContract";

// Fresh writes only. History and exact operation replay must remain reachable
// when paused. There is deliberately no production route/parent UI activation.
export function planPosthocSiteEnabled(siteId: string, env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  if (env.FAOLLA_ATTENDANCE_PLAN_POSTHOC_ENABLED !== "1" || typeof siteId !== "string" || siteId.length !== 8 || !/^\d{8}$/.test(siteId)) return false;
  const raw = env.FAOLLA_ATTENDANCE_PLAN_POSTHOC_SITE_IDS;
  if (typeof raw !== "string" || raw.length > 4096) return false;
  const sites = raw.split(",").map(v => v.trim());
  return sites.length <= 100 && sites.every(v => v.length === 8 && /^\d{8}$/.test(v)) && sites.includes(siteId);
}
export function projectPlanPosthocResult(raw: unknown, q: PlanPosthocQuery, authUserId: string, command: PlanPosthocCommand | null = null) {
  try { safeTree(raw, 4194304);
    const v = exact(raw, ["protocol", "siteId", "actorId", "worker", "slot", "revision", "current", "preview", "history", "historyTruncated", "receipt", "readAt"]);
    let publicPreview = null;
    if (v.preview !== null) {
      const p = exact(v.preview, ["fingerprint", "eligible", "blockers", "candidates", "approval", "source", "sourceText"]);
      if (typeof p.sourceText !== "string" || Buffer.byteLength(p.sourceText, "utf8") > 1048576 || createHash("sha256").update(p.sourceText, "utf8").digest("hex") !== p.fingerprint || !same(parseCaptureBrowserJson(p.sourceText), p.source)) throw new Error("invalid");
      const { sourceText: _text, ...rest } = p; void _text; publicPreview = rest;
    }
    return parsePlanPosthocResult({ ...v, preview: publicPreview }, q, authUserId, command);
  } catch { throw new MerchantAttendanceError("attendance_plan_posthoc_adoption_invalid"); }
}
export async function executePlanPosthoc(input: { query: PlanPosthocQuery; authUserId: string; command?: PlanPosthocCommand | null; moduleEnabled?: boolean }, service: AttendanceSelfRpc | null = createServerSupabaseServiceClient()) {
  const query = parsePlanPosthocQuery(input.query), authUserId = uuid(input.authUserId), command = input.command == null ? null : parsePlanPosthocCommand(input.command);
  const moduleEnabled = input.moduleEnabled ?? false;
  if (typeof moduleEnabled !== "boolean" || command !== null && query.mode !== "detail") throw new MerchantAttendanceError("attendance_invalid_request");
  if (!service) throw new MerchantAttendanceError("attendance_unavailable");
  let response;
  try { response = await service.rpc("faolla_attendance_plan_posthoc_adoption_v1", { p_query: query, p_auth_user_id: authUserId, p_command: command, p_allow_write: moduleEnabled && planPosthocSiteEnabled(query.siteId) }); }
  catch { throw new MerchantAttendanceError("attendance_unavailable"); }
  if (response.error) { const code = response.error.message ?? ""; throw new MerchantAttendanceError(Object.hasOwn(PLAN_POSTHOC_ERRORS, code) ? code : "attendance_unavailable"); }
  return projectPlanPosthocResult(response.data, query, authUserId, command);
}
