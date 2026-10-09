import {NextResponse} from "next/server";
import {MerchantEnterpriseAccessError,requireMerchantEnterpriseEntitlement,resolveValidatedMerchantEnterpriseAuthContext} from "@/lib/merchantEnterpriseAuth.server";
import {isCanonicalPortalRequest} from "@/lib/canonicalPortalRequest";
import {isTrustedSameOriginMutationRequest} from "@/lib/requestMutationGuard";
import {resolveRequestOrigin,resolvePublicOriginFromHeaders} from "@/lib/requestOrigin";
import {attendanceModuleEnabled} from "@/lib/merchantAttendanceEntitlement";
import {attendanceSelfUuid} from "@/lib/merchantAttendanceSelf";
import {MerchantAttendanceError} from "@/lib/merchantAttendanceTime";
import {createAttendanceSelfLimiter,readAttendanceSelfJson} from "@/lib/merchantAttendanceSelf.server";
import {parseRevisionDecisionCommand} from "@/lib/merchantAttendanceRevisionDecision";
import {parseRevisionApprovalHttpQuery} from "@/lib/merchantAttendanceRevisionApprovalResponse";
import {REVISION_APPROVAL_ERRORS} from "@/lib/merchantAttendanceRevisionApproval";
import {executeRevisionDecision} from "@/lib/merchantAttendanceRevisionDecision.server";
export const revisionDecisionDependencies={enabled:()=>process.env.FAOLLA_ATTENDANCE_ADMIN_ENABLED==="1"&&process.env.FAOLLA_ATTENDANCE_CORRECTION_REVIEW_ENABLED==="1"&&process.env.FAOLLA_ATTENDANCE_REVISION_REVIEW_ENABLED==="1"&&process.env.FAOLLA_ATTENDANCE_REVISION_DECISIONS_ENABLED==="1",
  authenticate:resolveValidatedMerchantEnterpriseAuthContext,entitlement:requireMerchantEnterpriseEntitlement,allow:createAttendanceSelfLimiter(),execute:executeRevisionDecision};
export async function handleRevisionDecision(request:Request,overrides:Partial<typeof revisionDecisionDependencies>={}){
  const deps={...revisionDecisionDependencies,...overrides};
  const reply=(body:unknown,status:number)=>NextResponse.json(body,{status,headers:{"Cache-Control":"private, no-store",Vary:"Cookie, Authorization, x-merchant-access-token","X-Content-Type-Options":"nosniff",...(status===429?{"Retry-After":"60"}:{})}});
  if(!deps.enabled())return reply({ok:false,error:"attendance_not_available"},404);
  if(!["GET","POST"].includes(request.method))return reply({ok:false,error:"method_not_allowed"},405);
  const origin=request.headers.get("origin"),target=resolveRequestOrigin(request);
  if(!isCanonicalPortalRequest(request)||request.headers.get("sec-fetch-site")==="cross-site"||origin&&origin!==target&&origin!==resolvePublicOriginFromHeaders(request.headers,target)||!isTrustedSameOriginMutationRequest(request))return reply({ok:false,error:"forbidden_origin"},403);
  try{
    const context=await deps.authenticate(request);
    if(!context.authenticationMethods.length||context.authenticationMethods.some(m=>["invite","magiclink","recovery"].includes(m)))throw new MerchantAttendanceError("attendance_access_denied");
    const authUserId=attendanceSelfUuid(context.user.id);if(!deps.allow(authUserId))throw new MerchantAttendanceError("attendance_rate_limited");
    if(request.method==="POST"&&new URL(request.url).search)throw new MerchantAttendanceError("attendance_invalid_request");
    const parsed=request.method==="POST"?parseRevisionDecisionCommand(await readAttendanceSelfJson(request)):null;
    const query=parsed?{siteId:parsed.siteId,requestId:parsed.command.requestId,operationId:null}:parseRevisionApprovalHttpQuery(request.url);
    const moduleEnabled=attendanceModuleEnabled(await deps.entitlement(query.siteId));
    return reply({ok:true,...await deps.execute({query,command:parsed?.command??null,authUserId,allowWrite:moduleEnabled}),moduleEnabled},200);
  }catch(e){
    if(e instanceof MerchantEnterpriseAccessError)return reply({ok:false,error:e.code},e.status);
    const code=e instanceof MerchantAttendanceError?e.code:"attendance_unavailable",known=Object.hasOwn(REVISION_APPROVAL_ERRORS,code);
    return reply({ok:false,error:known?code:"attendance_unavailable"},known?REVISION_APPROVAL_ERRORS[code]:503);
  }
}
