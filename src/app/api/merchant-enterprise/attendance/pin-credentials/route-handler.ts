import {requireMerchantEnterpriseEntitlement,resolveValidatedMerchantEnterpriseAuthContext,MerchantEnterpriseAccessError} from "@/lib/merchantEnterpriseAuth.server";
import {isTrustedSameOriginMutationRequest} from "@/lib/requestMutationGuard";
import {isCanonicalPortalRequest} from "@/lib/canonicalPortalRequest";
import {MerchantAttendanceError} from "@/lib/merchantAttendanceTime";
import {attendanceSelfUuid} from "@/lib/merchantAttendanceSelf";
import {createAttendanceSelfLimiter,readAttendanceSelfJson} from "@/lib/merchantAttendanceSelf.server";
import {executePinAdmin} from "@/lib/merchantAttendancePin.server";
import {PIN_ERRORS,parsePinBody,parsePinQuery} from "@/lib/merchantAttendancePin";
import {attendanceModuleEnabled} from "@/lib/merchantAttendanceEntitlement";
import {terminalReply} from "../terminals/route-handler";
export const pinEnabled=()=>process.env.FAOLLA_ATTENDANCE_TERMINALS_ENABLED==="1"&&process.env.FAOLLA_ATTENDANCE_PIN_ENABLED==="1";
export function pinError(e:unknown){
  if(e instanceof MerchantEnterpriseAccessError)return terminalReply({ok:false,error:e.code},e.status);
  const code=e instanceof MerchantAttendanceError&&Object.hasOwn(PIN_ERRORS,e.code)?e.code:"attendance_unavailable";
  return terminalReply({ok:false,error:code},PIN_ERRORS[code]?.status??503);
}
export const pinAdminDependencies={enabled:pinEnabled,authenticate:resolveValidatedMerchantEnterpriseAuthContext,entitlement:requireMerchantEnterpriseEntitlement,execute:executePinAdmin,allow:createAttendanceSelfLimiter()};
export async function handlePinAdmin(request:Request,overrides:Partial<typeof pinAdminDependencies>={}){
  const d={...pinAdminDependencies,...overrides};
  if(!d.enabled())return terminalReply({ok:false,error:"attendance_not_available"},404);
  if(!["GET","POST"].includes(request.method))return terminalReply({ok:false,error:"method_not_allowed"},405);
  if(!isCanonicalPortalRequest(request)||!isTrustedSameOriginMutationRequest(request))return terminalReply({ok:false,error:"forbidden_origin"},403);
  try{
    const a=await d.authenticate(request);if(!a.authenticationMethods.length||a.authenticationMethods.some(m=>["invite","magiclink","recovery"].includes(m)))throw new MerchantAttendanceError("attendance_access_denied");
    const authUserId=attendanceSelfUuid(a.user.id);if(!d.allow(authUserId))throw new MerchantAttendanceError("attendance_rate_limited");
    if(request.method==="POST"&&new URL(request.url).search)throw new MerchantAttendanceError("attendance_invalid_request");
    const input=request.method==="POST"?parsePinBody(await readAttendanceSelfJson(request)):{...parsePinQuery(request.url),command:null};
    const moduleEnabled=attendanceModuleEnabled(await d.entitlement(input.siteId));
    return terminalReply({ok:true,...await d.execute({...input,authUserId,allowSet:moduleEnabled}),moduleEnabled});
  }catch(e){return pinError(e);}
}
