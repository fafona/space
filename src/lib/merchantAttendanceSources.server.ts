import { createServerSupabaseServiceClient } from "./superAdminServer";
import type { AttendanceSelfRpc } from "./merchantAttendanceSelf.server";
import { attendanceSelfUuid } from "./merchantAttendanceSelf";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { parseSourcesQuery, parseSourcesResult, SOURCES_ERRORS, type SourcesQuery } from "./merchantAttendanceSources";

// A single read RPC holds the source locks. Never compose unrelated HTTP pages
// or equate settingsVersion with a frozen historical source snapshot.
export async function executeSources(input: { query: SourcesQuery; authUserId: string }, service: AttendanceSelfRpc | null = createServerSupabaseServiceClient()): Promise<unknown> {
  if (!service) throw new MerchantAttendanceError("attendance_unavailable");
  const query = parseSourcesQuery(input.query), actor = attendanceSelfUuid(input.authUserId);
  const response = await service.rpc("faolla_attendance_sources_v1", { p_query: query, p_auth_user_id: actor });
  if (response.error) {
    const code = response.error.message ?? "";
    throw new MerchantAttendanceError(Object.hasOwn(SOURCES_ERRORS, code) ? code : "attendance_unavailable");
  }
  try {
    parseSourcesResult(response.data, query, actor);
    // The strict parser validates the entire raw wire tree. Browser callers run
    // the same parser; normalized reports must not be reparsed as raw events.
    return response.data;
  } catch (error) {
    if (error instanceof MerchantAttendanceError && ["attendance_report_reconciliation_required", "attendance_report_overlap", "attendance_report_too_large", "attendance_session_invalid_records", "attendance_session_span_too_long"].includes(error.code)) throw error;
    throw new MerchantAttendanceError("attendance_sources_invalid");
  }
}
