// A single service-only SQL engine owns recovery, authorization, full source
// collection, head/source CAS and atomic append. Node passes no candidate or
// source artifact and never retries a possibly committed command.
import { createHash } from "node:crypto";
import { createServerSupabaseServiceClient } from "./superAdminServer";
import type { AttendanceSelfRpc } from "./merchantAttendanceSelf.server";
import { uuid } from "./merchantAttendancePlanExceptionValidation";
import { parseDayReviewCommand, parseDayReviewQuery, dayReviewCommandFingerprintText,
  type DayReviewQuery, type DayReviewCommand } from "./merchantAttendanceDayReviewContract";
import { parseDayReviewSavedResult } from "./merchantAttendanceDayReviewResult";
import { projectDayReviewSource } from "./merchantAttendanceDayReviewSource.server";
import { MerchantAttendanceError } from "./merchantAttendanceTime";

export const DAY_REVIEW_RPC = "faolla_attendance_day_review_v1";
const SQL_ERRORS = new Set(["attendance_invalid_request", "attendance_access_denied", "attendance_unavailable", "attendance_module_disabled",
  "attendance_operation_not_found", "attendance_operation_conflict", "attendance_worker_changed", "attendance_paused",
  "attendance_day_review_invalid", "attendance_day_review_not_found", "attendance_day_review_identity_changed",
  "attendance_day_review_source_changed", "attendance_day_review_head_changed", "attendance_day_review_ineligible",
  "attendance_day_review_too_large"]);
export function dayReviewsSiteEnabled(siteId: string, env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  const value = env.FAOLLA_ATTENDANCE_DAY_REVIEWS_SITE_IDS;
  if (env.FAOLLA_ATTENDANCE_DAY_REVIEWS_ENABLED !== "1" || !/^[0-9]{8}$/.test(siteId) || typeof value !== "string" || value.length > 575) return false;
  const sites = value.split(","); return sites.length <= 64 && new Set(sites).size === sites.length
    && sites.every(s => /^[0-9]{8}$/.test(s)) && sites.includes(siteId);
}
export async function executeDayReviews(input: Readonly<{ query: DayReviewQuery; command?: DayReviewCommand | null; authUserId: string;
  moduleEnabled?: boolean; signal?: AbortSignal }>, service: AttendanceSelfRpc | null = createServerSupabaseServiceClient()) {
  const q = parseDayReviewQuery(input.query), actor = uuid(input.authUserId);
  const c = input.command == null ? null : parseDayReviewCommand(q, input.command);
  const allow = input.moduleEnabled ?? false;
  if (typeof allow !== "boolean" || c?.action === "decide" && c.employeeAuthUserId === actor) throw new MerchantAttendanceError("attendance_invalid_request");
  const guard = () => { if (input.signal?.aborted) throw new MerchantAttendanceError("attendance_unavailable"); }; guard();
  if (!service) throw new MerchantAttendanceError("attendance_unavailable");
  let result;
  try { result = await service.rpc(DAY_REVIEW_RPC, { p_query: q, p_auth_user_id: actor, p_command: c, p_allow_write: allow }); }
  catch { throw new MerchantAttendanceError("attendance_unavailable"); }
  guard();
  if (result.error) { const code = result.error.message ?? "";
    throw new MerchantAttendanceError(SQL_ERRORS.has(code) ? code : "attendance_unavailable"); }
  if (c === null && (q.mode === "candidates" || q.mode === "preview")) return projectDayReviewSource(result.data, q, actor);
  const expected = c === null ? null : { command: c, fingerprint: createHash("sha256").update(dayReviewCommandFingerprintText(q, actor, c), "utf8").digest("hex") };
  return parseDayReviewSavedResult(result.data, q, actor, expected);
}
