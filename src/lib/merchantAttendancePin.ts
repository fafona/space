import {attendanceSelfSite,attendanceSelfUuid} from "./merchantAttendanceSelf";
import {attendanceRecordInstant} from "./merchantAttendanceManagement";
import {MerchantAttendanceError} from "./merchantAttendanceTime";
import {terminalObject,TERMINAL_ERRORS} from "./merchantAttendanceTerminal";
export const PIN_ADMIN_API="/api/merchant-enterprise/attendance/pin-credentials";
export const PIN_VERIFY_API="/api/merchant-enterprise/attendance/terminal-pin";
const fail=():never=>{throw new MerchantAttendanceError("attendance_invalid_request");};
export function pinWorkerNo(v:unknown){return typeof v==="string"&&v===v.trim()&&[...v].length>0&&[...v].length<=40&&!/[\u0000-\u001f\u007f-\u009f]/.test(v)?v:fail();}
export function attendancePin(v:unknown){return typeof v==="string"&&/^[0-9]{8,12}$/.test(v)?v:fail();}
const revision=(v:unknown)=>typeof v==="number"&&Number.isInteger(v)&&v>=0&&v<999999999?v:fail();
export type PinQuery={siteId:string;workerNo:string;operationId:string|null};
export type PinCommand={action:"set"|"revoke";operationId:string;expectedRevision:number;workerId:string;employeeId:string|null;pin?:string;salt?:string};
export type PinStatus={siteId:string;workerId:string;employeeId:string|null;workerNo:string;workerName:string;ready:boolean;revision:number;enabled:boolean;bindingCurrent:boolean;changedAt:string|null;receipt:{operationId:string;revision:number;action:"set"|"revoke"}|null};
export function parsePinQuery(url:string):PinQuery{
  const q=new URL(url).searchParams;for(const k of q.keys())if(!["siteId","workerNo","operationId"].includes(k)||q.getAll(k).length!==1)fail();
  return {siteId:attendanceSelfSite(q.get("siteId")),workerNo:pinWorkerNo(q.get("workerNo")),operationId:q.has("operationId")?attendanceSelfUuid(q.get("operationId")):null};
}
export function parsePinBody(raw:unknown):PinQuery&{command:PinCommand}{
  const b=terminalObject(raw,["siteId","workerNo","command"]),o=b.command as {action?:unknown}|null;
  const c=terminalObject(o,o?.action==="set"?["action","operationId","expectedRevision","workerId","employeeId","pin","salt"]:["action","operationId","expectedRevision","workerId","employeeId"]);
  if(c.action!=="set"&&c.action!=="revoke")fail();
  const command:PinCommand={action:c.action as PinCommand["action"],operationId:attendanceSelfUuid(c.operationId),expectedRevision:revision(c.expectedRevision),workerId:attendanceSelfUuid(c.workerId),employeeId:c.employeeId===null?null:attendanceSelfUuid(c.employeeId)};
  if(command.action==="set"){
    if(command.employeeId===null||typeof c.salt!=="string"||!/^[0-9a-f]{32}$/.test(c.salt))fail();
    command.pin=attendancePin(c.pin);command.salt=c.salt as string;
  }
  return {siteId:attendanceSelfSite(b.siteId),workerNo:pinWorkerNo(b.workerNo),operationId:null,command};
}
export function parsePinStatus(raw:unknown,q:PinQuery):PinStatus{
  const o=terminalObject(raw,["siteId","workerId","employeeId","workerNo","workerName","ready","revision","enabled","bindingCurrent","changedAt","receipt"]);
  if(o.siteId!==q.siteId||pinWorkerNo(o.workerNo).toLowerCase()!==q.workerNo.toLowerCase()||typeof o.workerName!=="string"||o.workerName.length>480||["ready","enabled","bindingCurrent"].some(k=>typeof o[k]!=="boolean"))fail();
  const rev=revision(o.revision),changedAt=o.changedAt===null?null:attendanceRecordInstant(o.changedAt);
  if((rev===0)!==(changedAt===null)||rev===0&&(o.enabled||o.bindingCurrent)||o.employeeId===null&&(o.ready||o.bindingCurrent))fail();
  let receipt:PinStatus["receipt"]=null;
  if(o.receipt!==null){const r=terminalObject(o.receipt,["operationId","revision","action"]);if(r.operationId!==q.operationId||!["set","revoke"].includes(String(r.action))||revision(r.revision)===0||Number(r.revision)>rev)fail();receipt={operationId:attendanceSelfUuid(r.operationId),revision:Number(r.revision),action:r.action as "set"|"revoke"};}
  return {siteId:q.siteId,workerId:attendanceSelfUuid(o.workerId),employeeId:o.employeeId===null?null:attendanceSelfUuid(o.employeeId),workerNo:o.workerNo as string,workerName:o.workerName as string,ready:o.ready as boolean,revision:rev,enabled:o.enabled as boolean,bindingCurrent:o.bindingCurrent as boolean,changedAt,receipt};
}
export function parsePinVerification(raw:unknown){
  const o=terminalObject(raw,["verified","workerNo","workerName","clockEnabled"]);
  if(o.verified!==true||o.clockEnabled!==false||typeof o.workerName!=="string"||o.workerName.length>480)fail();
  return {verified:true as const,workerNo:pinWorkerNo(o.workerNo),workerName:o.workerName as string,clockEnabled:false as const};
}
export const PIN_ERRORS:Readonly<Record<string,{status:number;message:string}>>={...TERMINAL_ERRORS,
  attendance_disabled:{status:403,message:"企业考勤未启用，不能验证终端 PIN。"},
  attendance_pin_denied:{status:403,message:"工号或 PIN 不可用，或尝试次数已达限制，请稍后重试或联系负责人。"},
  attendance_pin_worker_not_found:{status:404,message:"未找到此企业的考勤工号。"},
  attendance_pin_worker_not_ready:{status:409,message:"需先绑定有效员工账号，并授予本人查看和打卡权限。"},
  attendance_pin_changed:{status:409,message:"档案或 PIN 版本已变更，请重新读取后确认。"},
  attendance_pin_busy:{status:429,message:"安全验证正在处理，请稍后手动重试。"},
  attendance_pin_unconfigured:{status:503,message:"终端 PIN 的服务器安全配置未完成，功能仍关闭。"},
};
export const pinErrorStatuses=Object.fromEntries(Object.entries(PIN_ERRORS).map(([k,v])=>[k,v.status]));
export const pinMessage=(e:unknown)=>PIN_ERRORS[e instanceof Error?e.message:String(e)]?.message??"暂时无法确认结果。请先核对原操作，不会自动重复提交。";
