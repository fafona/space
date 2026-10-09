import {requireMerchantEnterpriseEntitlement} from "@/lib/merchantEnterpriseAuth.server";
import {isTrustedSameOriginMutationRequest} from "@/lib/requestMutationGuard";
import {isCanonicalPortalRequest} from "@/lib/canonicalPortalRequest";
import {readAttendanceSelfJson,createAttendanceSelfLimiter} from "@/lib/merchantAttendanceSelf.server";
import {MerchantAttendanceError} from "@/lib/merchantAttendanceTime";
import {terminalObject,TERMINAL_COOKIE,parseTerminalToken} from "@/lib/merchantAttendanceTerminal";
import {attendancePin,pinWorkerNo} from "@/lib/merchantAttendancePin";
import {executePinVerification} from "@/lib/merchantAttendancePin.server";
import {attendanceModuleEnabled} from "@/lib/merchantAttendanceEntitlement";
import {pinEnabled,pinError} from "../pin-credentials/route-handler";
import {terminalReply} from "../terminals/route-handler";
export const pinVerifyDependencies={enabled:pinEnabled,entitlement:requireMerchantEnterpriseEntitlement,execute:executePinVerification,allow:createAttendanceSelfLimiter()};
export async function handlePinVerify(request:Request,overrides:Partial<typeof pinVerifyDependencies>={}){
  const d={...pinVerifyDependencies,...overrides};
  if(!d.enabled())return terminalReply({ok:false,error:"attendance_not_available"},404);
  if(request.method!=="POST")return terminalReply({ok:false,error:"method_not_allowed"},405);
  if(!isCanonicalPortalRequest(request)||!isTrustedSameOriginMutationRequest(request))return terminalReply({ok:false,error:"forbidden_origin"},403);
  try{
    if(new URL(request.url).search)throw new MerchantAttendanceError("attendance_invalid_request");
    const cookies=(request.headers.get("cookie")??"").split(";").map(v=>v.trim()).filter(v=>v.startsWith(TERMINAL_COOKIE+"="));
    if(cookies.length!==1)throw new MerchantAttendanceError("attendance_terminal_denied");
    let credential;try{credential=parseTerminalToken(cookies[0].slice(TERMINAL_COOKIE.length+1));}catch{throw new MerchantAttendanceError("attendance_terminal_denied");}
    if(!d.allow(credential.siteId+":"+credential.terminalId))throw new MerchantAttendanceError("attendance_rate_limited");
    const body=terminalObject(await readAttendanceSelfJson(request),["workerNo","pin"]);
    const workerNo=pinWorkerNo(body.workerNo),pin=attendancePin(body.pin);
    const allowVerify=attendanceModuleEnabled(await d.entitlement(credential.siteId));
    return terminalReply({ok:true,...await d.execute({...credential,workerNo,pin,allowVerify}),moduleEnabled:allowVerify});
  }catch(e){return pinError(e);}
}
