import {NextResponse} from "next/server";
import {MerchantEnterpriseAccessError,requireMerchantEnterpriseEntitlement,requireMerchantEnterprisePasswordAuthentication,resolveValidatedMerchantEnterpriseAuthContext} from "@/lib/merchantEnterpriseAuth.server";
import {isCanonicalPortalRequest} from "@/lib/canonicalPortalRequest";
import {isTrustedSameOriginMutationRequest} from "@/lib/requestMutationGuard";
import {attendanceSelfUuid} from "@/lib/merchantAttendanceSelf";
import {createAttendanceSelfLimiter} from "@/lib/merchantAttendanceSelf.server";
import {attendanceModuleEnabled} from "@/lib/merchantAttendanceEntitlement";
import {MerchantAttendanceError} from "@/lib/merchantAttendanceTime";
import {CORRECTION_ERRORS,parseCorrectionCommand,parseCorrectionQuery} from "@/lib/merchantAttendanceCorrection";
import {executeAttendanceCorrection,readCorrectionJson,type CorrectionInput} from "@/lib/merchantAttendanceCorrection.server";
export const correctionDependencies={enabled:()=>process.env.FAOLLA_ATTENDANCE_CORRECTIONS_ENABLED==="1"&&process.env.FAOLLA_ATTENDANCE_SELF_ENABLED==="1",
  authenticate:resolveValidatedMerchantEnterpriseAuthContext,entitlement:requireMerchantEnterpriseEntitlement,execute:executeAttendanceCorrection,allow:createAttendanceSelfLimiter()};
export async function handleAttendanceCorrection(request:Request,overrides:Partial<typeof correctionDependencies>={}){
  const deps={...correctionDependencies,...overrides};
  const reply=(body:unknown,status:number)=>NextResponse.json(body,{status,headers:{"Cache-Control":"private, no-store",
    Vary:"Cookie, Authorization, x-merchant-access-token",...(status===429?{"Retry-After":"60"}:{})}});
  if(!deps.enabled())return reply({ok:false,error:"attendance_not_available"},404);
  if(!["GET","POST"].includes(request.method))return reply({ok:false,error:"method_not_allowed"},405);
  if(!isCanonicalPortalRequest(request)||!isTrustedSameOriginMutationRequest(request))return reply({ok:false,error:"forbidden_origin"},403);
  try{
    const context=await deps.authenticate(request);requireMerchantEnterprisePasswordAuthentication(context);const authUserId=attendanceSelfUuid(context.user.id);
    if(!deps.allow(authUserId))throw new MerchantAttendanceError("attendance_rate_limited");
    let input:Omit<CorrectionInput,"moduleEnabled">;
    if(request.method==="POST"){
      if(new URL(request.url).search)throw new MerchantAttendanceError("attendance_invalid_request");
      const p=parseCorrectionCommand(await readCorrectionJson(request));
      input={authUserId,command:p.command,query:{siteId:p.siteId,expectedWorkerId:p.expectedWorkerId,mode:"detail",
        requestId:p.command.action==="submit"?p.command.operationId:p.command.requestId,operationId:null}};
    }else input={authUserId,command:null,query:parseCorrectionQuery(request.url)};
    const moduleEnabled=attendanceModuleEnabled(await deps.entitlement(input.query.siteId));
    // SQL gates new submissions, but permits exact receipts/withdrawal when paused.
    return reply({ok:true,...await deps.execute({...input,moduleEnabled}),moduleEnabled},200);
  }catch(error){
    if(error instanceof MerchantEnterpriseAccessError)return reply({ok:false,error:error.code},error.status);
    const code=error instanceof MerchantAttendanceError?error.code:"attendance_unavailable",known=Object.hasOwn(CORRECTION_ERRORS,code);
    return reply({ok:false,error:known?code:"attendance_unavailable"},known?CORRECTION_ERRORS[code]:503);
  }
}
