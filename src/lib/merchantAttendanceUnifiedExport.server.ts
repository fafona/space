import { createServerSupabaseServiceClient } from "./superAdminServer";
import type { AttendanceSelfRpc } from "./merchantAttendanceSelf.server";
import { attendanceSelfUuid } from "./merchantAttendanceSelf";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { parseUnifiedExportCommand, parseUnifiedExportSource, buildUnifiedExportCsv, unifiedExportFilename, UNIFIED_EXPORT_ERRORS, type UnifiedExportCommand } from "./merchantAttendanceUnifiedExport";
export async function executeUnifiedExport(input: { command: UnifiedExportCommand; authUserId: string }, service: AttendanceSelfRpc | null = createServerSupabaseServiceClient()) {
  if (!service) throw new MerchantAttendanceError("attendance_unavailable");
  const command = parseUnifiedExportCommand(input.command);
  const response = await service.rpc("faolla_attendance_unified_export_v1", { p_site_id: command.siteId, p_auth_user_id: attendanceSelfUuid(input.authUserId), p_operation_id: command.operationId, p_query: command.query });
  if (response.error) { const code = response.error.message ?? ""; throw new MerchantAttendanceError(Object.hasOwn(UNIFIED_EXPORT_ERRORS, code) ? code : "attendance_unavailable"); }
  try {
    const result = parseUnifiedExportSource(response.data, command), base = result.report?.base;
    return { receipt: result.receipt, replayed: result.replayed, csv: result.report ? buildUnifiedExportCsv(result.report, result.receipt) : null,
      filename: result.report ? unifiedExportFilename(command) : null, viewerEmployeeId: base && "viewerEmployeeId" in base ? base.viewerEmployeeId : null,
      accessValidUntil: base && "accessValidUntil" in base ? base.accessValidUntil : null };
  } catch (e) {
    if (e instanceof MerchantAttendanceError && ["attendance_report_reconciliation_required", "attendance_report_overlap", "attendance_report_too_large", "attendance_session_invalid_records", "attendance_session_span_too_long"].includes(e.code)) throw e;
    throw new MerchantAttendanceError("attendance_unavailable");
  }
}
