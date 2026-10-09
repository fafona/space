import {NextResponse} from "next/server";
import {MerchantEnterpriseAccessError,requireMerchantEnterpriseEntitlement,resolveValidatedMerchantEnterpriseAuthContext} from "@/lib/merchantEnterpriseAuth.server";
import {isCanonicalPortalRequest} from "@/lib/canonicalPortalRequest";
import {resolveRequestOrigin,resolvePublicOriginFromHeaders} from "@/lib/requestOrigin";
import {attendanceModuleEnabled} from "@/lib/merchantAttendanceEntitlement";
import {attendanceSelfUuid} from "@/lib/merchantAttendanceSelf";
import {MerchantAttendanceError} from "@/lib/merchantAttendanceTime";
import {createAttendanceSelfLimiter} from "@/lib/merchantAttendanceSelf.server";
import {ATTENDANCE_TIMESHEET_ERRORS,parseAttendanceTimesheetQuery} from "@/lib/merchantAttendanceTimesheet";
import {executeAttendanceTimesheet} from "@/lib/merchantAttendanceTimesheet.server";
export const attendanceTimesheetDependencies={enabled:()=>process.env.FAOLLA_ATTENDANCE_ADMIN_ENABLED==="1"&&process.env.FAOLLA_ATTENDANCE_TIMESHEET_ENABLED==="1",
  authenticate:resolveValidatedMerchantEnterpriseAuthContext,entitlement:requireMerchantEnterpriseEntitlement,allow:createAttendanceSelfLimiter(),execute:executeAttendanceTimesheet};
export async function handleAttendanceTimesheet(request:Request,overrides:Partial<typeof attendanceTimesheetDependencies>={}){
  const deps={...attendanceTimesheetDependencies,...overrides};
  const reply=(body:unknown,status:number)=>NextResponse.json(body,{status,headers:{"Cache-Control":"private, no-store",Vary:"Cookie, Authorization, x-merchant-access-token",
    "X-Content-Type-Options":"nosniff",...(status===429?{"Retry-After":"60"}:{})}});
  if(!deps.enabled())return reply({ok:false,error:"attendance_not_available"},404);
  if(request.method!=="GET")return reply({ok:false,error:"method_not_allowed"},405);
  const origin=request.headers.get("origin"),target=resolveRequestOrigin(request);
  if(!isCanonicalPortalRequest(request)||request.headers.get("sec-fetch-site")==="cross-site"
    ||origin&&origin!==target&&origin!==resolvePublicOriginFromHeaders(request.headers,target))return reply({ok:false,error:"forbidden_origin"},403);
  try{
    const context=await deps.authenticate(request);
    if(!context.authenticationMethods.length||context.authenticationMethods.some(m=>["invite","magiclink","recovery"].includes(m)))throw new MerchantAttendanceError("attendance_access_denied");
    const authUserId=attendanceSelfUuid(context.user.id);if(!deps.allow(authUserId))throw new MerchantAttendanceError("attendance_rate_limited");
    const query=parseAttendanceTimesheetQuery(request.url),moduleEnabled=attendanceModuleEnabled(await deps.entitlement(query.siteId));
    // Pausing collection does not hide already recorded hours. Owner permission
    // is still rechecked by the database on EVERY read, including after transfer.
    const result=await deps.execute({query,authUserId});return reply({ok:true,...result,moduleEnabled},200);
  }catch(e){
    if(e instanceof MerchantEnterpriseAccessError)return reply({ok:false,error:e.code},e.status);
    const code=e instanceof MerchantAttendanceError?e.code:"attendance_unavailable",known=Object.hasOwn(ATTENDANCE_TIMESHEET_ERRORS,code);
    return reply({ok:false,error:known?code:"attendance_unavailable"},known?ATTENDANCE_TIMESHEET_ERRORS[code]:503);
  }
}
