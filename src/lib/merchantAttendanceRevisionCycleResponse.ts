import {attendanceSelfSite,attendanceSelfUuid} from "./merchantAttendanceSelf";
import {MerchantAttendanceError} from "./merchantAttendanceTime";
import {ATTENDANCE_REVISION_ERRORS,type AttendanceRevisionQuery} from "./merchantAttendanceRevision";
import {parseRevisionCycleCommand,parseRevisionCycleResult} from "./merchantAttendanceRevisionCycle";

export const REVISION_CYCLE_ERRORS:Readonly<Record<string,number>>={...ATTENDANCE_REVISION_ERRORS,attendance_report_version_required:409};
function fail():never{throw new MerchantAttendanceError("attendance_invalid_request");}
export function parseRevisionCycleInput(raw:unknown){
  if(!raw||typeof raw!=="object"||Array.isArray(raw))return fail();const v=raw as Record<string,unknown>;
  if(Object.keys(v).sort().join()!=="baseRequestId,command,expectedWorkerId,siteId")return fail();
  return {siteId:attendanceSelfSite(v.siteId),expectedWorkerId:attendanceSelfUuid(v.expectedWorkerId),baseRequestId:attendanceSelfUuid(v.baseRequestId),command:parseRevisionCycleCommand(v.command)};
}
export function parseRevisionCycleResponse(raw:unknown,q:AttendanceRevisionQuery){
  if(!raw||typeof raw!=="object"||Array.isArray(raw))return fail();const v=raw as Record<string,unknown>;
  if(v.ok!==true||typeof v.moduleEnabled!=="boolean"||!v.moduleEnabled&&v.canSubmit)return fail();
  const {ok,moduleEnabled,...body}=v;void ok;
  return {...parseRevisionCycleResult(body,q),moduleEnabled};
}
