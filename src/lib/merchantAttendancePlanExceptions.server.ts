import { createHash } from "node:crypto";
import { createServerSupabaseServiceClient } from "./superAdminServer";
import type { AttendanceSelfRpc } from "./merchantAttendanceSelf.server";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { parsePlanExceptionQuery, parsePlanExceptionCommand, parsePlanExceptionResult, PLAN_EXCEPTION_ERRORS, type PlanExceptionQuery, type PlanExceptionCommand } from "./merchantAttendancePlanExceptions";
import { parsePlanExceptionSource } from "./merchantAttendancePlanExceptionSource";
import type { PlanExceptionSourceQuery } from "./merchantAttendancePlanExceptionSourceContract";
import { exact, safeTree, same, uuid, fail } from "./merchantAttendancePlanExceptionValidation";
import { parseCaptureBrowserJson } from "./merchantAttendanceRuleCapturesBrowser";
import { eventNotificationsEnabled } from "./merchantAttendanceEventNotifications.server";
import { planClearanceSiteEnabled } from "./merchantAttendancePlanClearance.server";
import { planPosthocReviewSiteEnabled } from "./merchantAttendancePlanPosthocReview.server";
import { ownerNotificationsEnabled } from "./merchantAttendanceOwnerNotifications.server";

export function planExceptionsSiteEnabled(siteId: string, env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  if (env.FAOLLA_ATTENDANCE_PLAN_EXCEPTIONS_ENABLED !== "1" || typeof siteId !== "string" || siteId.length !== 8 || !/^\d{8}$/.test(siteId)) return false;
  const raw = env.FAOLLA_ATTENDANCE_PLAN_EXCEPTIONS_SITE_IDS; if (typeof raw !== "string" || raw.length > 4096) return false;
  const sites = raw.split(",").map(s => s.trim()); return sites.length <= 100 && sites.every(s => s.length === 8 && /^\d{8}$/.test(s)) && sites.includes(siteId);
}
export function projectPlanExceptionSource(raw: unknown, query: PlanExceptionSourceQuery, actorId: string) {
  try { safeTree(raw, 3145728); const v = exact(raw, ["protocol", "siteId", "actorId", "worker", "slot", "readAt", "source", "sourceText", "fingerprint", "eligible", "blockers", "candidate"]);
    if (typeof v.sourceText !== "string" || Buffer.byteLength(v.sourceText, "utf8") > 1048576 || createHash("sha256").update(v.sourceText, "utf8").digest("hex") !== v.fingerprint || !same(parseCaptureBrowserJson(v.sourceText), v.source)) fail();
    const { sourceText: _sourceText, ...publicValue } = v; void _sourceText;
    return parsePlanExceptionSource(publicValue, query, actorId);
  } catch { return fail(); }
}
async function rpc(service: AttendanceSelfRpc | null, name: string, args: Record<string, unknown>): Promise<unknown> {
  if (!service) throw new MerchantAttendanceError("attendance_unavailable"); let response;
  try { response = await service.rpc(name, args); } catch { throw new MerchantAttendanceError("attendance_unavailable"); }
  if (response.error) { const code = response.error.message ?? ""; throw new MerchantAttendanceError(Object.hasOwn(PLAN_EXCEPTION_ERRORS, code) ? code : "attendance_unavailable"); } return response.data;
}
export async function executePlanExceptionSource(input: { query: PlanExceptionSourceQuery; authUserId: string }, service: AttendanceSelfRpc | null = createServerSupabaseServiceClient()) {
  const q = parsePlanExceptionQuery({ ...input.query, access: "owner", mode: "detail", operationId: null, beforeAt: null, beforeId: null }), authUserId = uuid(input.authUserId);
  const query = { siteId: q.siteId, workerId: q.workerId!, slotId: q.slotId! };
  return projectPlanExceptionSource(await rpc(service, "faolla_attendance_plan_exception_source_v1", { p_query: query, p_auth_user_id: authUserId }), query, authUserId);
}
export async function executePlanExceptions(input: { query: PlanExceptionQuery; command?: PlanExceptionCommand | null; authUserId: string; moduleEnabled?: boolean }, service: AttendanceSelfRpc | null = createServerSupabaseServiceClient()) {
  const query = parsePlanExceptionQuery(input.query), authUserId = uuid(input.authUserId), moduleEnabled = input.moduleEnabled ?? false;
  const command = input.command == null ? null : parsePlanExceptionCommand(query, input.command);
  if (typeof moduleEnabled !== "boolean" || ["decide", "note", "ack"].includes(query.mode) !== (command !== null)) throw new MerchantAttendanceError("attendance_invalid_request");
  const capture = query.access === "owner" && query.mode === "decide" && command !== null && eventNotificationsEnabled(query.siteId, "capture");
  // Every mode uses the same engine: only SQL knows whether a saved171 head
  //selects v3. Independent gates apply to fresh writes AFTER exact recovery.
  const ownerCapture = query.access === "self" && query.mode === "note" && command !== null && ownerNotificationsEnabled(query.siteId, "capture");
  const raw = await rpc(service, ownerCapture ? "faolla_attendance_plan_exception_owner_event_v1" : "faolla_attendance_plan_exception_posthoc_review_v1", {
    p_query: query, p_auth_user_id: authUserId, p_command: command, p_allow_write: moduleEnabled,
    p_allow_posthoc: planPosthocReviewSiteEnabled(query.siteId), p_allow_clearance: planClearanceSiteEnabled(query.siteId), p_capture_notifications: capture,
    ...(ownerCapture ? { p_capture_owner_notifications: true } : {}),
  });
  return parsePlanExceptionResult(raw, query, { authUserId }, command);
}
