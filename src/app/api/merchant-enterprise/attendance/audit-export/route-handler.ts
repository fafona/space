import {NextResponse} from "next/server";
import {MerchantEnterpriseAccessError,requireMerchantEnterpriseEntitlement,resolveValidatedMerchantEnterpriseAuthContext} from "@/lib/merchantEnterpriseAuth.server";
import {isCanonicalPortalRequest} from "@/lib/canonicalPortalRequest";
import {attendanceSelfUuid} from "@/lib/merchantAttendanceSelf";
import {attendanceModuleEnabled} from "@/lib/merchantAttendanceEntitlement";
import {MerchantAttendanceError} from "@/lib/merchantAttendanceTime";
import {ATTENDANCE_AUDIT_EXPORT_ERRORS,parseAttendanceAuditExportQuery} from "@/lib/merchantAttendanceAuditExport";
import {createAttendanceAuditExportLimiter,executeAttendanceAuditExport} from "@/lib/merchantAttendanceAuditExport.server";
export const attendanceAuditExportDependencies={enabled:()=>process.env.FAOLLA_ATTENDANCE_ADMIN_ENABLED==="1",
  authenticate:resolveValidatedMerchantEnterpriseAuthContext,entitlement:requireMerchantEnterpriseEntitlement,
  execute:executeAttendanceAuditExport,allow:createAttendanceAuditExportLimiter()};
export async function handleAttendanceAuditExport(request:Request,overrides:Partial<typeof attendanceAuditExportDependencies>={}){
  const deps={...attendanceAuditExportDependencies,...overrides};
  const reply=(body:unknown,status:number)=>NextResponse.json(body,{status,headers:{"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff",
    Vary:"Cookie, Authorization, x-merchant-access-token",...(status===429?{"Retry-After":"60"}:{})}});
  if(!deps.enabled())return reply({ok:false,error:"attendance_not_available"},404);
  if(request.method!=="GET")return reply({ok:false,error:"method_not_allowed"},405);
  if(!isCanonicalPortalRequest(request))return reply({ok:false,error:"forbidden_origin"},403);
  try{
    const context=await deps.authenticate(request);
    if(!context.authenticationMethods.length||context.authenticationMethods.some(m=>["invite","magiclink","recovery"].includes(m)))throw new MerchantAttendanceError("attendance_access_denied");
    const authUserId=attendanceSelfUuid(context.user.id);
    if(!deps.allow(authUserId))throw new MerchantAttendanceError("attendance_rate_limited");
    const input=parseAttendanceAuditExportQuery(request.url),moduleEnabled=attendanceModuleEnabled(await deps.entitlement(input.siteId));
    return reply({ok:true,...await deps.execute({...input,authUserId}),moduleEnabled},200);
  }catch(error){
    if(error instanceof MerchantEnterpriseAccessError)return reply({ok:false,error:error.code},error.status);
    const code=error instanceof MerchantAttendanceError?error.code:"attendance_unavailable",known=Object.hasOwn(ATTENDANCE_AUDIT_EXPORT_ERRORS,code);
    return reply({ok:false,error:known?code:"attendance_unavailable"},known?ATTENDANCE_AUDIT_EXPORT_ERRORS[code]:503);
  }
}
