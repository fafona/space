import {randomBytes,randomUUID,timingSafeEqual} from "node:crypto";
import {createServerSupabaseServiceClient} from "./superAdminServer";
import {attendanceClockRpcName} from "./merchantAttendanceRuleBindingDispatch.server";
import type {AttendanceSelfRpc} from "./merchantAttendanceSelf.server";
import {terminalHash} from "./merchantAttendanceTerminal.server";
import {terminalObject} from "./merchantAttendanceTerminal";
import {attendanceSelfUuid} from "./merchantAttendanceSelf";
import {withAttendancePinKdf,attendancePinPepper,deriveAttendancePin} from "./merchantAttendancePin.server";
import {parsePinClockBody,parsePinClockResult,PIN_CLOCK_ERRORS,type PinClockRequest} from "./merchantAttendancePinClock";
import {MerchantAttendanceError} from "./merchantAttendanceTime";
type Input=PinClockRequest&{siteId:string;terminalId:string;secret:string;workerNo:string;pin:string;allowNew:boolean};
export async function executePinClock(i:Input,service:AttendanceSelfRpc|null=createServerSupabaseServiceClient()){
  const clockRpcName=attendanceClockRpcName("pin",i.siteId);
  const body=parsePinClockBody({workerNo:i.workerNo,pin:i.pin,command:i.command,operationId:i.operationId}),key=attendancePinPepper();
  const rpc=async(name:string,args:Record<string,unknown>)=>{
    if(!service)throw new MerchantAttendanceError("attendance_unavailable");
    let r;try{r=await service.rpc(name,args);}catch{throw new MerchantAttendanceError("attendance_unavailable");}
    if(r.error)throw new MerchantAttendanceError(Object.hasOwn(PIN_CLOCK_ERRORS,r.error.message??"")?r.error.message!:"attendance_unavailable");return r.data;
  };
  return withAttendancePinKdf(async()=>{
    const common={p_site:i.siteId,p_terminal:i.terminalId,p_secret_hash:terminalHash(i.secret),p_no:body.workerNo,p_lease:randomUUID()};
    // Platform admission pause still permits authenticated status/recovery/finish.
    // The authoritative final RPC receives allowNew, never a browser claim.
    const raw=await rpc("faolla_attendance_pin_begin_v1",{...common,p_allow:true}) as Record<string,unknown>;
    if(raw?.limited===true){terminalObject(raw,["limited"]);throw new MerchantAttendanceError("attendance_pin_busy");}
    let denied=false,salt:string,verifier:string,binding:{siteId:string;workerId:string;employeeId:string};
    if(raw?.denied===true){terminalObject(raw,["denied"]);denied=true;salt=randomBytes(16).toString("hex");verifier="0".repeat(64);binding={siteId:i.siteId,workerId:"dummy",employeeId:"dummy"};}
    else{const r=terminalObject(raw,["workerId","employeeId","revision","salt","verifier"]);
      if(typeof r.salt!=="string"||!/^[0-9a-f]{32}$/.test(r.salt)||typeof r.verifier!=="string"||!/^[0-9a-f]{64}$/.test(r.verifier)||!Number.isSafeInteger(r.revision)||Number(r.revision)<1)throw new MerchantAttendanceError("attendance_unavailable");
      salt=r.salt;verifier=r.verifier;binding={siteId:i.siteId,workerId:attendanceSelfUuid(r.workerId),employeeId:attendanceSelfUuid(r.employeeId)};
    }
    const candidate=await deriveAttendancePin(body.pin,salt,binding,key),verified=!denied&&timingSafeEqual(Buffer.from(candidate,"hex"),Buffer.from(verifier,"hex"));
    if(denied)throw new MerchantAttendanceError("attendance_pin_denied");
    const result=await rpc(clockRpcName,{...common,p_verified:verified,p_request:{command:body.command,operationId:body.operationId},p_allow_new:i.allowNew}) as Record<string,unknown>;
    if(result&&Object.hasOwn(result,"error")){terminalObject(result,["error"]);throw new MerchantAttendanceError(typeof result.error==="string"&&Object.hasOwn(PIN_CLOCK_ERRORS,result.error)?result.error:"attendance_unavailable");}
    try{return parsePinClockResult(result,{...i,...body});}catch{throw new MerchantAttendanceError("attendance_unavailable");}
  });
}
