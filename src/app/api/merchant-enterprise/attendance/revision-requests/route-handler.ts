import {NextResponse} from "next/server";
import {MerchantEnterpriseAccessError,requireMerchantEnterpriseEntitlement,requireMerchantEnterprisePasswordAuthentication,resolveValidatedMerchantEnterpriseAuthContext} from "@/lib/merchantEnterpriseAuth.server";
import {isCanonicalPortalRequest} from "@/lib/canonicalPortalRequest";
import {isTrustedSameOriginMutationRequest} from "@/lib/requestMutationGuard";
import {resolveRequestOrigin,resolvePublicOriginFromHeaders} from "@/lib/requestOrigin";
import {attendanceModuleEnabled} from "@/lib/merchantAttendanceEntitlement";
import {attendanceSelfUuid} from "@/lib/merchantAttendanceSelf";
import {createAttendanceSelfLimiter} from "@/lib/merchantAttendanceSelf.server";
import {readCorrectionJson} from "@/lib/merchantAttendanceCorrection.server";
import {MerchantAttendanceError} from "@/lib/merchantAttendanceTime";
import {parseAttendanceRevisionQuery,type AttendanceRevisionQuery} from "@/lib/merchantAttendanceRevision";
import {parseRevisionCycleInput,REVISION_CYCLE_ERRORS} from "@/lib/merchantAttendanceRevisionCycleResponse";
import {executeRevisionCycle} from "@/lib/merchantAttendanceRevisionCycle.server";
export const attendanceRevisionDependencies={enabled:()=>process.env.FAOLLA_ATTENDANCE_REVISION_REQUESTS_ENABLED==="1"&&process.env.FAOLLA_ATTENDANCE_CORRECTIONS_ENABLED==="1"&&process.env.FAOLLA_ATTENDANCE_SELF_ENABLED==="1"&&process.env.FAOLLA_ATTENDANCE_REVISION_CYCLES_ENABLED==="1",
  authenticate:resolveValidatedMerchantEnterpriseAuthContext,entitlement:requireMerchantEnterpriseEntitlement,allow:createAttendanceSelfLimiter(),execute:executeRevisionCycle};
export async function handleAttendanceRevision(request:Request,overrides:Partial<typeof attendanceRevisionDependencies>={}){
  const deps={...attendanceRevisionDependencies,...overrides};
  const reply=(body:unknown,status:number)=>NextResponse.json(body,{status,headers:{"Cache-Control":"private, no-store",Vary:"Cookie, Authorization, x-merchant-access-token","X-Content-Type-Options":"nosniff",...(status===429?{"Retry-After":"60"}:{})}});
  if(!deps.enabled())return reply({ok:false,error:"attendance_not_available"},404);
  if(!["GET","POST"].includes(request.method))return reply({ok:false,error:"method_not_allowed"},405);
  const origin=request.headers.get("origin"),target=resolveRequestOrigin(request);
  if(!isCanonicalPortalRequest(request)||request.headers.get("sec-fetch-site")==="cross-site"||!isTrustedSameOriginMutationRequest(request)
    ||origin&&origin!==target&&origin!==resolvePublicOriginFromHeaders(request.headers,target))return reply({ok:false,error:"forbidden_origin"},403);
  try{
    const context=await deps.authenticate(request);requireMerchantEnterprisePasswordAuthentication(context);
    const authUserId=attendanceSelfUuid(context.user.id);if(!deps.allow(authUserId))throw new MerchantAttendanceError("attendance_rate_limited");
    if(request.method==="POST"&&new URL(request.url).search)throw new MerchantAttendanceError("attendance_invalid_request");
    const body=request.method==="POST"?parseRevisionCycleInput(await readCorrectionJson(request)):null;
    const query:AttendanceRevisionQuery=body?{siteId:body.siteId,expectedWorkerId:body.expectedWorkerId,baseRequestId:body.baseRequestId,mode:"detail",requestId:body.command.action==="submit"?body.command.operationId:body.command.requestId,operationId:null}:parseAttendanceRevisionQuery(request.url);
    const moduleEnabled=attendanceModuleEnabled(await deps.entitlement(query.siteId));
    return reply({ok:true,...await deps.execute({query,command:body?.command??null,authUserId,moduleEnabled}),moduleEnabled},200);
  }catch(e){
    if(e instanceof MerchantEnterpriseAccessError)return reply({ok:false,error:e.code},e.status);
    const code=e instanceof MerchantAttendanceError?e.code:"attendance_unavailable",known=Object.hasOwn(REVISION_CYCLE_ERRORS,code);
    return reply({ok:false,error:known?code:"attendance_unavailable"},known?REVISION_CYCLE_ERRORS[code]:503);
  }
}
