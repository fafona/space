import {terminalObject} from "./merchantAttendanceTerminal";
import {attendancePin,pinWorkerNo,PIN_ERRORS} from "./merchantAttendancePin";
import {attendanceSelfSite,attendanceSelfUuid,parseAttendanceSelfResult,ATTENDANCE_SELF_ERROR_STATUS,type AttendanceSelfCommand,type AttendanceSelfResult} from "./merchantAttendanceSelf";
import {MerchantAttendanceError} from "./merchantAttendanceTime";
import {attendanceMessage} from "./merchantAttendanceSelfClient";
import {MERCHANT_ATTENDANCE_ACTIONS,type AttendanceAction} from "./merchantAttendance";
import {parseIndependentBinding,type IndependentBinding} from "./merchantAttendanceIndependent";
export const PIN_CLOCK_API="/api/merchant-enterprise/attendance/terminal-clock";
export type PinClockCommand=AttendanceSelfCommand&{expectedEmployeeId:string};
export type PinClockRequest={command:PinClockCommand|null;operationId:string|null};
export type PinClockResult=AttendanceSelfResult&{state:AttendanceSelfResult["state"]&{independentBindingBoundary?:IndependentBinding};siteId:string;terminalId:string;workerNo:string;workerName:string;employeeId:string;canStart:boolean;canFinish:boolean;blockReason:string|null};
const fail=():never=>{throw new MerchantAttendanceError("attendance_invalid_request");};
export function parsePinClockRequest(value:unknown):PinClockRequest{
  const o=terminalObject(value,["command","operationId"]);
  if(o.command!==null){
    if(o.operationId!==null)fail();const c=terminalObject(o.command,["expectedWorkerId","expectedEmployeeId","operationId","locationId","action","expectedSequence"]);
    if(!MERCHANT_ATTENDANCE_ACTIONS.includes(c.action as AttendanceAction)||!Number.isSafeInteger(c.expectedSequence)||Number(c.expectedSequence)<0||Number(c.expectedSequence)>=Number.MAX_SAFE_INTEGER)fail();
    return {command:{expectedWorkerId:attendanceSelfUuid(c.expectedWorkerId),expectedEmployeeId:attendanceSelfUuid(c.expectedEmployeeId),operationId:attendanceSelfUuid(c.operationId),locationId:attendanceSelfUuid(c.locationId),action:c.action as AttendanceAction,expectedSequence:Number(c.expectedSequence)},operationId:null};
  }
  return {command:null,operationId:o.operationId===null?null:attendanceSelfUuid(o.operationId)};
}
export function parsePinClockBody(value:unknown){const o=terminalObject(value,["workerNo","pin","command","operationId"]);return {workerNo:pinWorkerNo(o.workerNo),pin:attendancePin(o.pin),...parsePinClockRequest({command:o.command,operationId:o.operationId})};}
export function parsePinClockResult(value:unknown,input:{siteId:string;terminalId:string;workerNo:string}&PinClockRequest):PinClockResult{
  const o=terminalObject(value,["siteId","terminalId","workerNo","workerName","employeeId","workerId","locationId","state","receipt","replayed","canStart","canFinish","blockReason"]);
  if(o.siteId!==input.siteId||o.terminalId!==input.terminalId||pinWorkerNo(o.workerNo).toLowerCase()!==input.workerNo.toLowerCase()||typeof o.workerName!=="string"||o.workerName.length>480
    ||typeof o.canStart!=="boolean"||typeof o.canFinish!=="boolean"||o.canStart&&!o.canFinish||![null,"attendance_location_denied","attendance_location_verification_required","attendance_not_employed"].includes(o.blockReason as null)
    ||(o.blockReason===null)!==o.canFinish)fail();
  const hasIndependentBoundary=o.state&&typeof o.state==="object"&&Object.hasOwn(o.state,"independentBindingBoundary");
  terminalObject(o.state,["sequence","status","lastEvent",...(o.state&&typeof o.state==="object"&&Object.hasOwn(o.state,"administrativeBoundary")?["administrativeBoundary"]:[]),...(hasIndependentBoundary?["independentBindingBoundary"]:[])]);
  for(const e of [(o.state as AttendanceSelfResult["state"]).lastEvent,o.receipt])if(e!==null)terminalObject(e,["id","siteId","workerId","operationId","locationId","sequence","action","breakPaid","occurredAt","timeZone"]);
  const result=parseAttendanceSelfResult(o,input);if(result.locationId===null)fail();
  if(result.state.administrativeBoundary&&result.state.administrativeBoundary.employeeId!==o.employeeId)fail();
  let independentBoundary:IndependentBinding|undefined;
  if(hasIndependentBoundary){
    const raw=(o.state as Record<string,unknown>).independentBindingBoundary;independentBoundary=parseIndependentBinding(raw);
    const last=result.state.lastEvent;
    if(result.state.administrativeBoundary||independentBoundary.siteId!==input.siteId||independentBoundary.workerId!==result.workerId||independentBoundary.employeeId!==o.employeeId
      ||result.state.status!=="off"||independentBoundary.lastSequence!==result.state.sequence||independentBoundary.lastIndependentEventId!==(last?.id??null)
      ||last!==null&&(last.action!=="clock_out"||last.occurredAt.slice(0,-1).padEnd(26,"0")+"Z">independentBoundary.boundAt))fail();
  }
  if(input.command&&(result.receipt?.sequence!==input.command.expectedSequence+1||o.employeeId!==input.command.expectedEmployeeId))fail();
  return {...result,state:{...result.state,...(independentBoundary?{independentBindingBoundary:independentBoundary}:{})},siteId:attendanceSelfSite(o.siteId),terminalId:attendanceSelfUuid(o.terminalId),employeeId:attendanceSelfUuid(o.employeeId),workerNo:o.workerNo as string,workerName:o.workerName as string,canStart:o.canStart as boolean,canFinish:o.canFinish as boolean,blockReason:o.blockReason as string|null};
}
export const PIN_CLOCK_ERRORS:Readonly<Record<string,number>>={...ATTENDANCE_SELF_ERROR_STATUS,...Object.fromEntries(Object.entries(PIN_ERRORS).map(([k,v])=>[k,v.status]))};
export const pinClockMessage=(e:unknown)=>{
  const code=e instanceof Error?e.message:String(e);
  // Clock authorization/record ownership is not the owner-only terminal admin gate.
  if(code==="attendance_access_denied")return "无法确认当前员工的考勤权限或记录归属，已停止读取和打卡。如有待确认编号，请保留并联系企业负责人核验。";
  return PIN_ERRORS[code]?.message??attendanceMessage(code);
};
