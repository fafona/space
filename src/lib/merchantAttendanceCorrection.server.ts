import {createServerSupabaseServiceClient} from "./superAdminServer";
import type {AttendanceSelfRpc} from "./merchantAttendanceSelf.server";
import {MerchantAttendanceError} from "./merchantAttendanceTime";
import {CORRECTION_ERRORS,parseCorrectionResult,type CorrectionCommand,type CorrectionQuery} from "./merchantAttendanceCorrection";
export type CorrectionInput={query:CorrectionQuery;authUserId:string;command:CorrectionCommand|null;moduleEnabled:boolean};
export async function executeAttendanceCorrection(input:CorrectionInput,service:AttendanceSelfRpc|null=createServerSupabaseServiceClient()){
  if(!service)throw new MerchantAttendanceError("attendance_unavailable");
  const q=input.query,c=input.command;
  if(c&&(q.mode!=="detail"||q.operationId!==null||q.requestId!==(c.action==="submit"?c.operationId:c.requestId)))throw new MerchantAttendanceError("attendance_invalid_request");
  const base={mode:q.mode,expectedWorkerId:q.expectedWorkerId};
  const rpcQuery=q.mode==="prepare"?{...base,startEventId:q.startEventId}:q.mode==="detail"?{...base,requestId:q.requestId,operationId:q.operationId}:
    {...base,cursorAt:q.cursorAt,cursorId:q.cursorId};
  const result=await service.rpc("faolla_attendance_correction_self_v3",{p_site_id:q.siteId,p_auth_user_id:input.authUserId,p_query:rpcQuery,p_command:c,p_platform_enabled:input.moduleEnabled});
  if(result.error){const code=result.error.message??"";throw new MerchantAttendanceError(Object.hasOwn(CORRECTION_ERRORS,code)?code:"attendance_unavailable");}
  try{
    const parsed=parseCorrectionResult(result.data,c&&q.mode==="detail"?{...q,operationId:c.operationId}:q,true,true);
    if(c&&(parsed.mode!=="detail"||!parsed.receipt||parsed.receipt.revision!==c.expectedRevision+1||parsed.receipt.action!==c.action
      ||c.action==="submit"&&(parsed.item.startEventId!==c.startEventId||parsed.reason!==c.reason||JSON.stringify(parsed.proposal)!==JSON.stringify(c.proposal)||parsed.basis.events.at(-1)?.id!==c.expectedLastEventId||parsed.rules?.policy?.revision!==c.expectedPolicyRevision)
      ||c.action==="withdraw"&&parsed.withdrawal?.reason!==c.reason))throw Error("receipt_mismatch");
    return parsed;
  }catch{throw new MerchantAttendanceError("attendance_unavailable");}
}
// Larger than punch bodies only because a bounded 32-break declaration is allowed.
export async function readCorrectionJson(request:Request,timeoutMs=12000):Promise<unknown>{
  if(request.headers.get("content-type")?.split(";")[0].trim().toLowerCase()!=="application/json")throw new MerchantAttendanceError("attendance_invalid_content_type");
  const length=request.headers.get("content-length");
  if(length!==null&&(!/^\d+$/.test(length)||Number(length)>8192))throw new MerchantAttendanceError("attendance_body_too_large");
  const reader=request.body?.getReader();if(!reader)throw new MerchantAttendanceError("attendance_invalid_request");
  let rejectCancel:(e:Error)=>void=()=>{};
  const cancel=()=>{void reader.cancel().catch(()=>{});rejectCancel(new MerchantAttendanceError("attendance_invalid_request"));};
  let timer:ReturnType<typeof setTimeout>|undefined;
  const deadline=new Promise<never>((_,reject)=>{rejectCancel=reject;timer=setTimeout(cancel,timeoutMs);});
  request.signal.addEventListener("abort",cancel,{once:true});
  const run=async()=>{let bytes=0,text="";const decoder=new TextDecoder("utf-8",{fatal:true});
    try{if(request.signal.aborted)throw new MerchantAttendanceError("attendance_invalid_request");
      while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;
      if(bytes>8192){void reader.cancel().catch(()=>{});throw new MerchantAttendanceError("attendance_body_too_large");}text+=decoder.decode(value,{stream:true});}
      return JSON.parse(text+decoder.decode());
    }catch(e){if(e instanceof MerchantAttendanceError)throw e;throw new MerchantAttendanceError("attendance_invalid_request");}
    finally{reader.releaseLock();}
  };
  try{return await Promise.race([run(),deadline]);}finally{clearTimeout(timer);request.signal.removeEventListener("abort",cancel);}
}
