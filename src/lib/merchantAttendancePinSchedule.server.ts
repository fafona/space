import {randomBytes,randomUUID,timingSafeEqual} from "node:crypto";
import {createServerSupabaseServiceClient} from "./superAdminServer";
import type {AttendanceSelfRpc} from "./merchantAttendanceSelf.server";
import {attendanceClockRpcName} from "./merchantAttendanceRuleBindingDispatch.server";
import {attendanceSelfSite,attendanceSelfUuid} from "./merchantAttendanceSelf";
import {terminalHash} from "./merchantAttendanceTerminal.server";
import {terminalSecret,terminalObject} from "./merchantAttendanceTerminal";
import {withAttendancePinKdf,attendancePinPepper,deriveAttendancePin} from "./merchantAttendancePin.server";
import {parsePinScheduleBody,parsePinScheduleResult,PIN_SCHEDULE_ERRORS,type PinScheduleResult} from "./merchantAttendancePinSchedule";
import {MerchantAttendanceError} from "./merchantAttendanceTime";

type Environment=Readonly<Record<string,string|undefined>>;
export function attendancePinScheduleEnabled(siteId:string,env:Environment=process.env):boolean{
  if(env.FAOLLA_ATTENDANCE_PIN_SCHEDULE_ENABLED!=="1"||!/^\d{8}$/.test(siteId))return false;
  const raw=env.FAOLLA_ATTENDANCE_PIN_SCHEDULE_SITE_IDS;if(typeof raw!=="string"||raw.length>4096)return false;
  const sites=raw.split(",").map(s=>s.trim());return sites.length<=100&&sites.every(s=>/^\d{8}$/.test(s))&&sites.includes(siteId);
}
export function attendancePinScheduleBindRules(siteId:string):boolean{
  return attendanceClockRpcName("pin",siteId)==="faolla_attendance_pin_clock_bound_v1";
}
export type AttendancePinScheduleInput=ReturnType<typeof parsePinScheduleBody>&{
  siteId:string;terminalId:string;secret:string;moduleEnabled:boolean;allowWrite:boolean;bindRules:boolean;
};
/** Each read, recovery and clock-in performs the existing begin + real KDF +
 * lease finish flow. No reusable employee token or browser verified flag.
 * Only the new SQL can keep lease consumption outside its business savepoint. */
export async function executeAttendancePinSchedule(input:AttendancePinScheduleInput,
  service:AttendanceSelfRpc|null=createServerSupabaseServiceClient()):Promise<PinScheduleResult>{
  if(!service)throw new MerchantAttendanceError("attendance_unavailable");
  const siteId=attendanceSelfSite(input.siteId),terminalId=attendanceSelfUuid(input.terminalId),secret=terminalSecret(input.secret);
  if(siteId.length!==8||[input.moduleEnabled,input.allowWrite,input.bindRules].some(v=>typeof v!=="boolean"))throw new MerchantAttendanceError("attendance_invalid_request");
  const body=parsePinScheduleBody({workerNo:input.workerNo,pin:input.pin,command:input.command,operationId:input.operationId,selection:input.selection});
  const key=attendancePinPepper();
  const rpc=async(name:string,args:Record<string,unknown>)=>{
    let result;try{result=await service.rpc(name,args);}catch{throw new MerchantAttendanceError("attendance_unavailable");}
    if(result.error){const code=result.error.message??"";throw new MerchantAttendanceError(Object.hasOwn(PIN_SCHEDULE_ERRORS,code)?code:"attendance_unavailable");}
    return result.data;
  };
  // Same process-wide single-KDF gate and dedicated pepper as the original
  // channel. Paused new admission still authenticates original-number reads.
  return withAttendancePinKdf(async()=>{
    const common={p_site:siteId,p_terminal:terminalId,p_secret_hash:terminalHash(secret),p_no:body.workerNo,p_lease:randomUUID()};
    const raw=await rpc("faolla_attendance_pin_begin_v1",{...common,p_allow:true}) as Record<string,unknown>;
    if(raw?.limited===true){terminalObject(raw,["limited"]);throw new MerchantAttendanceError("attendance_pin_busy");}
    let denied=false,salt:string,verifier:string,binding:{siteId:string;workerId:string;employeeId:string};
    if(raw?.denied===true){terminalObject(raw,["denied"]);denied=true;salt=randomBytes(16).toString("hex");verifier="0".repeat(64);binding={siteId,workerId:"dummy",employeeId:"dummy"};}
    else{
      const r=terminalObject(raw,["workerId","employeeId","revision","salt","verifier"]);
      if(typeof r.salt!=="string"||!/^[0-9a-f]{32}$/.test(r.salt)||typeof r.verifier!=="string"||!/^[0-9a-f]{64}$/.test(r.verifier)
        ||!Number.isSafeInteger(r.revision)||Number(r.revision)<1)throw new MerchantAttendanceError("attendance_unavailable");
      salt=r.salt;verifier=r.verifier;binding={siteId,workerId:attendanceSelfUuid(r.workerId),employeeId:attendanceSelfUuid(r.employeeId)};
    }
    const candidate=await deriveAttendancePin(body.pin,salt,binding,key),verified=!denied&&timingSafeEqual(Buffer.from(candidate,"hex"),Buffer.from(verifier,"hex"));
    if(denied)throw new MerchantAttendanceError("attendance_pin_denied");
    const result=await rpc("faolla_attendance_pin_schedule_v1",{...common,p_verified:verified,
      p_request:{command:body.command,operationId:body.operationId},p_allow_new:input.moduleEnabled,
      p_selection:body.selection,p_allow_schedule:input.allowWrite,p_bind_rules:input.bindRules});
    if(result&&typeof result==="object"&&Object.hasOwn(result,"error")){
      const r=terminalObject(result,["error"]);throw new MerchantAttendanceError(typeof r.error==="string"&&Object.hasOwn(PIN_SCHEDULE_ERRORS,r.error)?r.error:"attendance_unavailable");
    }
    return parsePinScheduleResult(result,{siteId,terminalId,workerNo:body.workerNo,command:body.command,operationId:body.operationId,selection:body.selection,
      expectedWorkerId:binding.workerId,expectedEmployeeId:binding.employeeId});
  });
}
