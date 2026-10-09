import {createServerSupabaseServiceClient} from "./superAdminServer";
import type {AttendanceSelfRpc} from "./merchantAttendanceSelf.server";
import {attendanceSelfUuid} from "./merchantAttendanceSelf";
import {MerchantAttendanceError} from "./merchantAttendanceTime";
import {ATTENDANCE_REPORT_SOURCE_VERSION} from "./merchantAttendanceTimesheet";
import {currentAttendanceReportVersion} from "./merchantAttendanceCurrentReportVersion";
import {parseTimesheetExportCommand,parseTimesheetExportSource,buildTimesheetExportCsv,timesheetExportFilename,TIMESHEET_EXPORT_ERRORS,type TimesheetExportCommand} from "./merchantAttendanceTimesheetExport";
export async function executeTimesheetExport(input:{command:TimesheetExportCommand;authUserId:string},service:AttendanceSelfRpc|null=createServerSupabaseServiceClient()){
  if(!service)throw new MerchantAttendanceError("attendance_unavailable");
  const command=parseTimesheetExportCommand(input.command);
  const response=await service.rpc("faolla_attendance_period_export_v2",{p_site_id:command.siteId,p_auth_user_id:attendanceSelfUuid(input.authUserId),p_operation_id:command.operationId,p_query:command.query});
  if(response.error){const code=response.error.message??"";throw new MerchantAttendanceError(Object.hasOwn(TIMESHEET_EXPORT_ERRORS,code)?code:"attendance_unavailable");}
  try{
    const raw=response.data as {replayed?:unknown;report?:unknown}|null;
    // A receipt-only replay has no source body to dispatch. Its exact envelope
    // is still checked below; it cannot return a new CSV or grant export access.
    const version=raw?.replayed===true?ATTENDANCE_REPORT_SOURCE_VERSION:currentAttendanceReportVersion(raw?.report);
    const result=parseTimesheetExportSource(response.data,command,version);
    return {receipt:result.receipt,replayed:result.replayed,csv:result.report?buildTimesheetExportCsv(result.report,result.receipt):null,
      filename:result.report?timesheetExportFilename(command):null,
      viewerEmployeeId:result.report&&"viewerEmployeeId" in result.report?result.report.viewerEmployeeId:null,
      accessValidUntil:result.report&&"accessValidUntil" in result.report?result.report.accessValidUntil:null};
  }catch(e){
    if(e instanceof MerchantAttendanceError&&["attendance_session_invalid_records","attendance_session_span_too_long","attendance_report_overlap","attendance_report_too_large"].includes(e.code))throw e;
    throw new MerchantAttendanceError("attendance_unavailable");
  }
}
