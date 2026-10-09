import {NextResponse} from "next/server";
import {MerchantEnterpriseAccessError,requireMerchantEnterpriseEntitlement,requireMerchantEnterprisePasswordAuthentication,resolveValidatedMerchantEnterpriseAuthContext} from "@/lib/merchantEnterpriseAuth.server";
import {isCanonicalPortalRequest} from "@/lib/canonicalPortalRequest";
import {attendanceSelfUuid} from "@/lib/merchantAttendanceSelf";
import {createAttendanceSelfLimiter} from "@/lib/merchantAttendanceSelf.server";
import {attendanceModuleEnabled} from "@/lib/merchantAttendanceEntitlement";
import {MerchantAttendanceError} from "@/lib/merchantAttendanceTime";
import {ATTENDANCE_SESSION_ERRORS,parseAttendanceSessionQuery} from "@/lib/merchantAttendanceSession";
import {executeAttendanceSession} from "@/lib/merchantAttendanceSession.server";
export const attendanceSessionDependencies={enabled:()=>process.env.FAOLLA_ATTENDANCE_SELF_ENABLED==="1",
  authenticate:resolveValidatedMerchantEnterpriseAuthContext,entitlement:requireMerchantEnterpriseEntitlement,
  execute:executeAttendanceSession,allow:createAttendanceSelfLimiter()};
export async function handleAttendanceSession(request:Request,overrides:Partial<typeof attendanceSessionDependencies>={}){
  const deps={...attendanceSessionDependencies,...overrides};
  const reply=(body:unknown,status:number)=>NextResponse.json(body,{status,headers:{"Cache-Control":"private, no-store",
    Vary:"Cookie, Authorization, x-merchant-access-token",...(status===429?{"Retry-After":"60"}:{})}});
  if(!deps.enabled())return reply({ok:false,error:"attendance_not_available"},404);
  if(request.method!=="GET")return reply({ok:false,error:"method_not_allowed"},405);
  if(!isCanonicalPortalRequest(request))return reply({ok:false,error:"forbidden_origin"},403);
  try{
    const context=await deps.authenticate(request);requireMerchantEnterprisePasswordAuthentication(context);
    const authUserId=attendanceSelfUuid(context.user.id);
    if(!deps.allow(authUserId))throw new MerchantAttendanceError("attendance_rate_limited");
    const query=parseAttendanceSessionQuery(request.url),moduleEnabled=attendanceModuleEnabled(await deps.entitlement(query.siteId));
    return reply({ok:true,...await deps.execute({...query,authUserId}),moduleEnabled},200);
  }catch(error){
    if(error instanceof MerchantEnterpriseAccessError)return reply({ok:false,error:error.code},error.status);
    const code=error instanceof MerchantAttendanceError?error.code:"attendance_unavailable",known=Object.hasOwn(ATTENDANCE_SESSION_ERRORS,code);
    return reply({ok:false,error:known?code:"attendance_unavailable"},known?ATTENDANCE_SESSION_ERRORS[code]:503);
  }
}
