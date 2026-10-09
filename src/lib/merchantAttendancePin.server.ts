import {createHmac,createHash,scrypt,randomUUID,randomBytes,timingSafeEqual} from "node:crypto";
import {createServerSupabaseServiceClient} from "./superAdminServer";
import type {AttendanceSelfRpc} from "./merchantAttendanceSelf.server";
import {MerchantAttendanceError} from "./merchantAttendanceTime";
import {terminalHash} from "./merchantAttendanceTerminal.server";
import {terminalObject} from "./merchantAttendanceTerminal";
import {attendanceSelfUuid} from "./merchantAttendanceSelf";
import {PIN_ERRORS,parsePinBody,parsePinStatus,parsePinVerification,attendancePin,pinWorkerNo,type PinCommand,type PinQuery} from "./merchantAttendancePin";
// One KDF per process, zero queue. No new native package or worker process.
let deriving=false;
export const PIN_SCRYPT_OPTIONS=Object.freeze({N:131072,r:8,p:1,maxmem:160*1024*1024});
function pepper(){const v=process.env.FAOLLA_ATTENDANCE_PIN_PEPPER;if(!v||!/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(v))throw new MerchantAttendanceError("attendance_pin_unconfigured");return v;}
export async function deriveAttendancePin(pin:string,salt:string,binding:{siteId:string;workerId:string;employeeId:string},key=pepper()){
  attendancePin(pin);if(!/^[0-9a-f]{32}$/.test(salt)||!key)throw new MerchantAttendanceError("attendance_invalid_request");
  const secret=createHmac("sha256",key).update(JSON.stringify(["faolla-attendance-pin-v1",binding.siteId,binding.workerId,binding.employeeId,pin])).digest();
  try{return await new Promise<string>((resolve,reject)=>scrypt(secret,Buffer.from(salt,"hex"),32,PIN_SCRYPT_OPTIONS,(e,hash)=>e?reject(e):resolve(hash.toString("hex"))));}finally{secret.fill(0);}
}
async function exclusive<T>(run:()=>Promise<T>){if(deriving)throw new MerchantAttendanceError("attendance_pin_busy");deriving=true;try{return await run();}finally{deriving=false;}}
// New channels share the SAME gate and dedicated pepper. Existing behavior unchanged.
export {exclusive as withAttendancePinKdf,pepper as attendancePinPepper};
async function rpc(service:AttendanceSelfRpc|null,name:string,args:Record<string,unknown>){
  if(!service)throw new MerchantAttendanceError("attendance_unavailable");
  let r;try{r=await service.rpc(name,args);}catch{throw new MerchantAttendanceError("attendance_unavailable");}
  if(r.error)throw new MerchantAttendanceError(Object.hasOwn(PIN_ERRORS,r.error.message??"")?r.error.message!:"attendance_unavailable");return r.data;
}
type AdminInput=PinQuery&{authUserId:string;command:PinCommand|null;allowSet:boolean};
export async function executePinAdmin(i:AdminInput,service:AttendanceSelfRpc|null=createServerSupabaseServiceClient()){
  const read=async(command:Record<string,unknown>|null)=>{
    const raw=await rpc(service,"faolla_attendance_pin_admin_v1",{p_site:i.siteId,p_auth:i.authUserId,p_no:i.workerNo,p_operation:i.operationId,p_command:command,p_allow_set:i.allowSet});
    try{return parsePinStatus(raw,{...i,operationId:i.command?.operationId??i.operationId});}catch{throw new MerchantAttendanceError("attendance_unavailable");}
  };
  if(!i.command)return read(null);
  const c=parsePinBody({siteId:i.siteId,workerNo:i.workerNo,command:i.command}).command;
  if(i.operationId!==null)throw new MerchantAttendanceError("attendance_invalid_request");
  const write=async()=>{
    // Authenticate actual owner and exact worker binding BEFORE spending KDF resources.
    const current=await executePinAdmin({...i,command:null,operationId:c.operationId},service);
    if(current.workerId!==c.workerId||current.employeeId!==c.employeeId||(!current.receipt&&current.revision!==c.expectedRevision)
      ||current.receipt&&(current.receipt.action!==c.action||current.receipt.revision!==c.expectedRevision+1))throw new MerchantAttendanceError("attendance_pin_changed");
    if(!current.receipt&&c.action==="set"&&(!i.allowSet||!current.ready))throw new MerchantAttendanceError(i.allowSet?"attendance_pin_worker_not_ready":"attendance_platform_paused");
    const verifier=c.action==="set"?await deriveAttendancePin(c.pin!,c.salt!,{siteId:i.siteId,workerId:c.workerId,employeeId:c.employeeId!}):null;
    const payload={action:c.action,operationId:c.operationId,expectedRevision:c.expectedRevision,workerId:c.workerId,employeeId:c.employeeId,salt:c.salt??null,verifier};
    const commandHash=createHash("sha256").update(JSON.stringify(payload)).digest("hex");
    const result=await read({...payload,commandHash});
    if(!result.receipt||result.receipt.operationId!==c.operationId||result.receipt.action!==c.action||result.receipt.revision!==c.expectedRevision+1)throw new MerchantAttendanceError("attendance_unavailable");return result;
  };
  return c.action==="set"?exclusive(write):write();
}
export async function executePinVerification(i:{siteId:string;terminalId:string;secret:string;workerNo:string;pin:string;allowVerify:boolean},service:AttendanceSelfRpc|null=createServerSupabaseServiceClient()){
  attendancePin(i.pin);pinWorkerNo(i.workerNo);const key=pepper();
  return exclusive(async()=>{
    const lease=randomUUID(),common={p_site:i.siteId,p_terminal:i.terminalId,p_secret_hash:terminalHash(i.secret),p_no:i.workerNo,p_lease:lease,p_allow:i.allowVerify};
    const raw=await rpc(service,"faolla_attendance_pin_begin_v1",common) as Record<string,unknown>;
    if(raw?.limited===true){terminalObject(raw,["limited"]);throw new MerchantAttendanceError("attendance_pin_busy");}
    let denied=false,salt:string,verifier:string,binding:{siteId:string;workerId:string;employeeId:string};
    if(raw?.denied===true){terminalObject(raw,["denied"]);denied=true;salt=randomBytes(16).toString("hex");verifier="0".repeat(64);binding={siteId:i.siteId,workerId:"dummy",employeeId:"dummy"};}
    else{
      const r=terminalObject(raw,["workerId","employeeId","revision","salt","verifier"]);
      if(typeof r.salt!=="string"||!/^[0-9a-f]{32}$/.test(r.salt)||typeof r.verifier!=="string"||!/^[0-9a-f]{64}$/.test(r.verifier)||!Number.isSafeInteger(r.revision)||Number(r.revision)<1)throw new MerchantAttendanceError("attendance_unavailable");
      salt=r.salt;verifier=r.verifier;binding={siteId:i.siteId,workerId:attendanceSelfUuid(r.workerId),employeeId:attendanceSelfUuid(r.employeeId)};
    }
    const candidate=await deriveAttendancePin(i.pin,salt,binding,key),verified=!denied&&timingSafeEqual(Buffer.from(candidate,"hex"),Buffer.from(verifier,"hex"));
    if(denied)throw new MerchantAttendanceError("attendance_pin_denied");
    const result=await rpc(service,"faolla_attendance_pin_finish_v1",{...common,p_verified:verified}) as Record<string,unknown>;
    if(result?.verified===false){terminalObject(result,["verified"]);throw new MerchantAttendanceError("attendance_pin_denied");}
    try{return parsePinVerification(result);}catch{throw new MerchantAttendanceError("attendance_unavailable");}
  });
}
