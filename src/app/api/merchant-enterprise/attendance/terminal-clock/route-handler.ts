import {requireMerchantEnterpriseEntitlement,MerchantEnterpriseAccessError} from "@/lib/merchantEnterpriseAuth.server";
import {isTrustedSameOriginMutationRequest} from "@/lib/requestMutationGuard";
import {isCanonicalPortalRequest} from "@/lib/canonicalPortalRequest";
import {createAttendanceSelfLimiter,readAttendanceSelfJson} from "@/lib/merchantAttendanceSelf.server";
import {parseTerminalToken,TERMINAL_COOKIE} from "@/lib/merchantAttendanceTerminal";
import {MerchantAttendanceError} from "@/lib/merchantAttendanceTime";
import {parsePinClockBody,PIN_CLOCK_ERRORS} from "@/lib/merchantAttendancePinClock";
import {executePinClock} from "@/lib/merchantAttendancePinClock.server";
import {attendanceModuleEnabled} from "@/lib/merchantAttendanceEntitlement";
import {terminalReply} from "../terminals/route-handler";
import {pinEnabled} from "../pin-credentials/route-handler";
export const pinClockEnabled=()=>pinEnabled()&&process.env.FAOLLA_ATTENDANCE_PIN_CLOCK_ENABLED==="1";
export const pinClockDependencies={enabled:pinClockEnabled,entitlement:requireMerchantEnterpriseEntitlement,allow:createAttendanceSelfLimiter(),execute:executePinClock};
export async function handlePinClock(request:Request,overrides:Partial<typeof pinClockDependencies>={}){
  const d={...pinClockDependencies,...overrides};
  if(!d.enabled())return terminalReply({ok:false,error:"attendance_not_available"},404);
  if(request.method!=="POST")return terminalReply({ok:false,error:"method_not_allowed"},405);
  if(!isCanonicalPortalRequest(request)||!isTrustedSameOriginMutationRequest(request))return terminalReply({ok:false,error:"forbidden_origin"},403);
  try{
    if(new URL(request.url).search)throw new MerchantAttendanceError("attendance_invalid_request");
    const cookies=(request.headers.get("cookie")??"").split(";").map(v=>v.trim()).filter(v=>v.startsWith(TERMINAL_COOKIE+"="));
    if(cookies.length!==1)throw new MerchantAttendanceError("attendance_terminal_denied");
    let credential;try{credential=parseTerminalToken(cookies[0].slice(TERMINAL_COOKIE.length+1));}catch{throw new MerchantAttendanceError("attendance_terminal_denied");}
    if(!d.allow(credential.siteId+":"+credential.terminalId))throw new MerchantAttendanceError("attendance_rate_limited");
    const body=parsePinClockBody(await readAttendanceSelfJson(request));
    const allowNew=attendanceModuleEnabled(await d.entitlement(credential.siteId));
    return terminalReply({ok:true,...await d.execute({...credential,...body,allowNew}),moduleEnabled:allowNew});
  }catch(e){
    if(e instanceof MerchantEnterpriseAccessError)return terminalReply({ok:false,error:"attendance_terminal_denied"},403);
    const code=e instanceof MerchantAttendanceError&&Object.hasOwn(PIN_CLOCK_ERRORS,e.code)?e.code:"attendance_unavailable";
    return terminalReply({ok:false,error:code},PIN_CLOCK_ERRORS[code]??503);
  }
}
