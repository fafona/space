import {NextResponse} from "next/server";
import {MerchantEnterpriseAccessError,requireMerchantEnterpriseEntitlement,requireMerchantEnterprisePasswordAuthentication,resolveValidatedMerchantEnterpriseAuthContext} from "@/lib/merchantEnterpriseAuth.server";
import {isCanonicalPortalRequest} from "@/lib/canonicalPortalRequest";
import {isTrustedSameOriginMutationRequest} from "@/lib/requestMutationGuard";
import {attendanceModuleEnabled} from "@/lib/merchantAttendanceEntitlement";
import {attendanceSelfUuid} from "@/lib/merchantAttendanceSelf";
import {MerchantAttendanceError} from "@/lib/merchantAttendanceTime";
import {createAttendanceAuditExportLimiter} from "@/lib/merchantAttendanceAuditExport.server";
import {readCorrectionJson} from "@/lib/merchantAttendanceCorrection.server";
import {TIMESHEET_EXPORT_ERRORS,parseTimesheetExportCommand,type TimesheetExportQuery} from "@/lib/merchantAttendanceTimesheetExport";
import {executeTimesheetExport} from "@/lib/merchantAttendanceTimesheetExport.server";
export const timesheetExportDependencies={enabled:()=>process.env.FAOLLA_ATTENDANCE_TIMESHEET_EXPORT_ENABLED==="1"&&process.env.FAOLLA_ATTENDANCE_TIMESHEET_ENABLED==="1",
  accessEnabled:(access:TimesheetExportQuery["access"])=>access==="owner"?process.env.FAOLLA_ATTENDANCE_ADMIN_ENABLED==="1":
    process.env.FAOLLA_ATTENDANCE_SCOPED_TIMESHEET_ENABLED==="1"&&(access==="self"?process.env.FAOLLA_ATTENDANCE_SELF_ENABLED==="1":process.env.FAOLLA_ATTENDANCE_RECORDS_ENABLED==="1"),
  authenticate:resolveValidatedMerchantEnterpriseAuthContext,entitlement:requireMerchantEnterpriseEntitlement,allow:createAttendanceAuditExportLimiter(),execute:executeTimesheetExport};
export async function handleTimesheetExport(request:Request,overrides:Partial<typeof timesheetExportDependencies>={}){
  const deps={...timesheetExportDependencies,...overrides};
  const reply=(body:unknown,status:number)=>NextResponse.json(body,{status,headers:{"Cache-Control":"private, no-store",Vary:"Cookie, Authorization, x-merchant-access-token",
    "X-Content-Type-Options":"nosniff",...(status===429?{"Retry-After":"60"}:{})}});
  if(!deps.enabled())return reply({ok:false,error:"attendance_not_available"},404);
  if(request.method!=="POST")return reply({ok:false,error:"method_not_allowed"},405);
  if(!isCanonicalPortalRequest(request)||request.headers.get("sec-fetch-site")==="cross-site"||!isTrustedSameOriginMutationRequest(request))return reply({ok:false,error:"forbidden_origin"},403);
  try{
    if(new URL(request.url).search)throw new MerchantAttendanceError("attendance_invalid_request");
    const context=await deps.authenticate(request);
    if(!context.authenticationMethods.length||context.authenticationMethods.some(m=>["invite","magiclink","recovery"].includes(m)))throw new MerchantAttendanceError("attendance_access_denied");
    const authUserId=attendanceSelfUuid(context.user.id);if(!deps.allow(authUserId))throw new MerchantAttendanceError("attendance_rate_limited");
    const command=parseTimesheetExportCommand(await readCorrectionJson(request));
    if(!deps.accessEnabled(command.query.access))return reply({ok:false,error:"attendance_not_available"},404);
    if(command.query.access!=="owner")requireMerchantEnterprisePasswordAuthentication(context);
    const moduleEnabled=attendanceModuleEnabled(await deps.entitlement(command.siteId));
    return reply({ok:true,...await deps.execute({command,authUserId}),moduleEnabled},200);
  }catch(e){
    if(e instanceof MerchantEnterpriseAccessError)return reply({ok:false,error:e.code},e.status);
    const code=e instanceof MerchantAttendanceError?e.code:"attendance_unavailable",known=Object.hasOwn(TIMESHEET_EXPORT_ERRORS,code);
    return reply({ok:false,error:known?code:"attendance_unavailable"},known?TIMESHEET_EXPORT_ERRORS[code]:503);
  }
}
