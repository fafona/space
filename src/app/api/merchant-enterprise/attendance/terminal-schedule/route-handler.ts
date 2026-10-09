import {NextResponse} from "next/server";
import {requireMerchantEnterpriseEntitlement,MerchantEnterpriseAccessError} from "@/lib/merchantEnterpriseAuth.server";
import {isTrustedSameOriginMutationRequest} from "@/lib/requestMutationGuard";
import {isCanonicalPortalRequest,resolveCanonicalPortalOrigin} from "@/lib/canonicalPortalRequest";
import {createAttendanceSelfLimiter} from "@/lib/merchantAttendanceSelf.server";
import {parseTerminalToken,TERMINAL_COOKIE} from "@/lib/merchantAttendanceTerminal";
import {MerchantAttendanceError} from "@/lib/merchantAttendanceTime";
import {parsePinScheduleBody,parsePinScheduleJson,parsePinScheduleHttpResult,PIN_SCHEDULE_ERRORS} from "@/lib/merchantAttendancePinSchedule";
import {executeAttendancePinSchedule,attendancePinScheduleEnabled,attendancePinScheduleBindRules} from "@/lib/merchantAttendancePinSchedule.server";
import {attendanceModuleEnabled} from "@/lib/merchantAttendanceEntitlement";
import {pinClockEnabled} from "../terminal-clock/route-handler";

export const attendancePinScheduleDependencies={baseEnabled:pinClockEnabled,featureEnabled:attendancePinScheduleEnabled,bindRules:attendancePinScheduleBindRules,
  entitlement:requireMerchantEnterpriseEntitlement,allow:createAttendanceSelfLimiter(),execute:executeAttendancePinSchedule,bodyTimeoutMs:5000};
async function readBody(request:Request,timeoutMs:number):Promise<unknown>{
  if(!/^application\/json\s*(?:;\s*charset\s*=\s*(?:utf-8|"utf-8"))?$/i.test(request.headers.get("content-type")?.trim()??""))throw new MerchantAttendanceError("attendance_invalid_content_type");
  const length=request.headers.get("content-length");
  if(length!==null&&(!length||/[^0-9]/.test(length)||Number(length)>8192))throw new MerchantAttendanceError("attendance_body_too_large");
  if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>5000)throw new MerchantAttendanceError("attendance_unavailable");
  const reader=request.body?.getReader();if(!reader)throw new MerchantAttendanceError("attendance_invalid_request");
  const decoder=new TextDecoder("utf-8",{fatal:true}),until=performance.now()+timeoutMs;
  let bytes=0,text="",stopped=false,rejectStopped!:(error:MerchantAttendanceError)=>void;
  const interruption=new Promise<never>((_,reject)=>{rejectStopped=reject;});
  const stop=()=>{if(stopped)return;stopped=true;rejectStopped(new MerchantAttendanceError("attendance_invalid_request"));void reader.cancel().catch(()=>{});};
  const timer=setTimeout(stop,timeoutMs);request.signal.addEventListener("abort",stop,{once:true});
  const consume=async()=>{
    while(true){
      if(stopped||request.signal.aborted||performance.now()>=until)throw new MerchantAttendanceError("attendance_invalid_request");
      const chunk=await reader.read();
      if(stopped||request.signal.aborted||performance.now()>=until)throw new MerchantAttendanceError("attendance_invalid_request");
      if(chunk.done)break;bytes+=chunk.value.byteLength;if(bytes>8192)throw new MerchantAttendanceError("attendance_body_too_large");
      text+=decoder.decode(chunk.value,{stream:true});
    }
    return parsePinScheduleJson(text+decoder.decode(),"request");
  };
  try{if(request.signal.aborted)stop();return await Promise.race([consume(),interruption]);}
  catch(error){void reader.cancel().catch(()=>{});if(error instanceof MerchantAttendanceError)throw error;throw new MerchantAttendanceError("attendance_invalid_request");}
  finally{clearTimeout(timer);request.signal.removeEventListener("abort",stop);reader.releaseLock();}
}
export async function handleAttendancePinSchedule(request:Request,overrides:Partial<typeof attendancePinScheduleDependencies>={}){
  const d={...attendancePinScheduleDependencies,...overrides};
  const reply=(body:unknown,status:number)=>NextResponse.json(body,{status,headers:{"Cache-Control":"private, no-store","Referrer-Policy":"no-referrer",
    "X-Content-Type-Options":"nosniff",Vary:"Cookie",...(status===429?{"Retry-After":"60"}:{}),...(status===405?{Allow:"POST"}:{})}});
  if(!d.baseEnabled())return reply({ok:false,error:"attendance_not_available"},404);
  if(request.method!=="POST")return reply({ok:false,error:"method_not_allowed"},405);
  const origin=request.headers.get("origin");
  if(!isCanonicalPortalRequest(request)||origin!==null&&origin!==resolveCanonicalPortalOrigin()
    ||["cross-site","same-site"].includes(request.headers.get("sec-fetch-site")??"")||!isTrustedSameOriginMutationRequest(request))return reply({ok:false,error:"forbidden_origin"},403);
  try{
    if(new URL(request.url).search)throw new MerchantAttendanceError("attendance_invalid_request");
    const cookies=(request.headers.get("cookie")??"").split(";").map(v=>v.trim()).filter(v=>v.startsWith(TERMINAL_COOKIE+"="));
    if(cookies.length!==1)throw new MerchantAttendanceError("attendance_terminal_denied");
    let credential;try{credential=parseTerminalToken(cookies[0].slice(TERMINAL_COOKIE.length+1));}catch{throw new MerchantAttendanceError("attendance_terminal_denied");}
    if(!d.allow(credential.siteId+":"+credential.terminalId))throw new MerchantAttendanceError("attendance_rate_limited");
    const body=parsePinScheduleBody(await readBody(request,d.bodyTimeoutMs));
    const moduleEnabled=attendanceModuleEnabled(await d.entitlement(credential.siteId)),featureEnabled=d.featureEnabled(credential.siteId),selectionEnabled=moduleEnabled&&featureEnabled;
    // Admission flags are not authentication. Even recovery re-verifies PIN;
    // SQL owns whether a business refusal commits this verification's lease.
    const result=await d.execute({...credential,...body,moduleEnabled,allowWrite:featureEnabled,bindRules:d.bindRules(credential.siteId)});
    const response={ok:true,...result,moduleEnabled,selectionEnabled};
    parsePinScheduleHttpResult(response,{siteId:credential.siteId,terminalId:credential.terminalId,workerNo:body.workerNo,
      command:body.command,operationId:body.operationId,selection:body.selection});
    return reply(response,200);
  }catch(error){
    if(error instanceof MerchantEnterpriseAccessError)return reply({ok:false,error:"attendance_terminal_denied"},403);
    const code=error instanceof MerchantAttendanceError?error.code:"attendance_unavailable",known=Object.hasOwn(PIN_SCHEDULE_ERRORS,code);
    return reply({ok:false,error:known?code:"attendance_unavailable"},known?PIN_SCHEDULE_ERRORS[code]:503);
  }
}
