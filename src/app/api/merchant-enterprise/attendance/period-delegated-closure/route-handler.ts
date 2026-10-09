import { NextResponse } from "next/server";
import { MerchantEnterpriseAccessError, requireMerchantEnterpriseEntitlement, requireMerchantEnterprisePasswordAuthentication, resolveValidatedMerchantEnterpriseAuthContext } from "@/lib/merchantEnterpriseAuth.server";
import { isCanonicalPortalRequest, resolveCanonicalPortalOrigin } from "@/lib/canonicalPortalRequest";
import { isTrustedSameOriginMutationRequest } from "@/lib/requestMutationGuard";
import { attendanceModuleEnabled } from "@/lib/merchantAttendanceEntitlement";
import { attendanceSelfUuid } from "@/lib/merchantAttendanceSelf";
import { MerchantAttendanceError } from "@/lib/merchantAttendanceTime";
import { createAttendanceSelfLimiter } from "@/lib/merchantAttendanceSelf.server";
import { parseCaptureBrowserJson } from "@/lib/merchantAttendanceRuleCapturesBrowser";
import { parsePeriodDelegatedClosureHttpQuery, parsePeriodDelegatedClosureBody, parsePeriodDelegatedClosureResponse, PERIOD_DELEGATED_CLOSURE_ERRORS } from "@/lib/merchantAttendancePeriodDelegatedClosure";
import { executePeriodDelegatedClosures, periodDelegatedClosuresEnabled } from "@/lib/merchantAttendancePeriodDelegatedClosure.server";

export const periodDelegatedClosuresDependencies={siteEnabled:periodDelegatedClosuresEnabled,authenticate:resolveValidatedMerchantEnterpriseAuthContext,
  entitlement:requireMerchantEnterpriseEntitlement,allow:createAttendanceSelfLimiter(),execute:executePeriodDelegatedClosures,bodyTimeoutMs:5000};
const AUTH_ERRORS:Readonly<Record<string,number>>={unauthorized:401,authentication_required:401,enterprise_auth_unavailable:503,
  enterprise_entitlement_unavailable:503,enterprise_management_disabled:403,employee_password_authentication_required:403};
async function readBody(request:Request,timeoutMs:number){
  if(!/^application\/json\s*(?:;\s*charset\s*=\s*(?:utf-8|"utf-8"))?$/i.test(request.headers.get("content-type")?.trim()??""))throw new MerchantAttendanceError("attendance_invalid_content_type");
  const length=request.headers.get("content-length");if(length!==null&&(!/^\d+$/.test(length)||Number(length)>8192))throw new MerchantAttendanceError("attendance_body_too_large");
  if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>5000)throw new MerchantAttendanceError("attendance_unavailable");
  const reader=request.body?.getReader();if(!reader)throw new MerchantAttendanceError("attendance_invalid_request");
  const decoder=new TextDecoder("utf-8",{fatal:true}),deadline=performance.now()+timeoutMs;let size=0,text="",stopped=false,reject!: (error:MerchantAttendanceError)=>void;
  const interruption=new Promise<never>((_,no)=>{reject=no;}),stop=()=>{if(stopped)return;stopped=true;reject(new MerchantAttendanceError("attendance_invalid_request"));void reader.cancel().catch(()=>{});};
  const timer=setTimeout(stop,timeoutMs);request.signal.addEventListener("abort",stop,{once:true});
  const consume=async()=>{while(true){if(stopped||request.signal.aborted||performance.now()>=deadline)throw new MerchantAttendanceError("attendance_invalid_request");const part=await reader.read();
    if(stopped||request.signal.aborted||performance.now()>=deadline)throw new MerchantAttendanceError("attendance_invalid_request");if(part.done)break;size+=part.value.byteLength;
    if(size>8192)throw new MerchantAttendanceError("attendance_body_too_large");text+=decoder.decode(part.value,{stream:true});}return parseCaptureBrowserJson(text+decoder.decode());};
  try{if(request.signal.aborted)stop();return await Promise.race([consume(),interruption]);}
  catch(e){void reader.cancel().catch(()=>{});if(e instanceof MerchantAttendanceError)throw e;throw new MerchantAttendanceError("attendance_invalid_request");}
  finally{clearTimeout(timer);request.signal.removeEventListener("abort",stop);reader.releaseLock();}
}
export async function handlePeriodDelegatedClosures(request:Request,overrides:Partial<typeof periodDelegatedClosuresDependencies>={}){
  const deps={...periodDelegatedClosuresDependencies,...overrides};const reply=(body:unknown,status:number)=>NextResponse.json(body,{status,headers:{"Cache-Control":"private, no-store",Vary:"Cookie, Authorization, x-merchant-access-token","X-Content-Type-Options":"nosniff",
    ...(status===429?{"Retry-After":"60"}:{}),...(status===405?{Allow:"GET, POST"}:{})}});
  if(!["GET","POST"].includes(request.method))return reply({ok:false,error:"method_not_allowed"},405);
  const origin=request.headers.get("origin");if(!isCanonicalPortalRequest(request)||origin!==null&&origin!==resolveCanonicalPortalOrigin()
    ||["cross-site","same-site"].includes(request.headers.get("sec-fetch-site")??"")||!isTrustedSameOriginMutationRequest(request))return reply({ok:false,error:"forbidden_origin"},403);
  try{const context=await deps.authenticate(request);requireMerchantEnterprisePasswordAuthentication(context);
    const authUserId=attendanceSelfUuid(context.user.id);if(!deps.allow(authUserId))throw new MerchantAttendanceError("attendance_rate_limited");
    if(request.method==="POST"&&new URL(request.url).search)throw new MerchantAttendanceError("attendance_invalid_request");
    const parsed=request.method==="POST"?parsePeriodDelegatedClosureBody(await readBody(request,deps.bodyTimeoutMs)):null;
    const query=parsed?.query??parsePeriodDelegatedClosureHttpQuery(request.url);
    // Original-id GET alone bypasses fresh entitlement. It never returns source or grants access.
    const safe = request.method === "GET" && query.mode === "recover";
    const moduleEnabled=!safe && attendanceModuleEnabled(await deps.entitlement(query.siteId))&&deps.siteEnabled(query.siteId);
    if (!moduleEnabled && !safe) throw new MerchantAttendanceError("attendance_period_delegation_disabled");
    const data=await deps.execute({query,command:parsed?.command??null,authUserId,moduleEnabled});const body={ok:true as const,moduleEnabled,data};
    return reply(parsePeriodDelegatedClosureResponse(body,query,{authUserId},parsed?.command??null),200);
  }catch(error){if(error instanceof MerchantEnterpriseAccessError){if(Object.hasOwn(AUTH_ERRORS,error.code)&&AUTH_ERRORS[error.code]===error.status)return reply({ok:false,error:error.code},error.status);return reply({ok:false,error:"attendance_unavailable"},503);}
    const code=error instanceof MerchantAttendanceError?error.code:"attendance_unavailable",known=Object.hasOwn(PERIOD_DELEGATED_CLOSURE_ERRORS,code);return reply({ok:false,error:known?code:"attendance_unavailable"},known?PERIOD_DELEGATED_CLOSURE_ERRORS[code]:503);}
}
