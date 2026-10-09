import {ATTENDANCE_REPORT_SOURCE_VERSION,parseAttendanceTimesheetQuery,parseAttendanceTimesheetResult,type AttendanceTimesheetQuery,type AttendanceTimesheetSourceVersion} from "../../src/lib/merchantAttendanceTimesheet";
import {attendanceDayUtcRange} from "../../src/lib/merchantAttendanceTime";
import {attendanceRecordInstant} from "../../src/lib/merchantAttendanceManagement";
import {firstApprovalSourceV2,sheetWire,sheetEvent,sheetEffect,timesheetId as id,timesheetQuery} from "./attendance-timesheet-model";
import type {AttendanceApiFetch} from "../../src/lib/merchantAttendanceSelfClient";
export function timesheetResponse(q:AttendanceTimesheetQuery=timesheetQuery,mode="normal",sourceVersion:AttendanceTimesheetSourceVersion="raw-and-approved-v1"){
  const wire=sheetWire();Object.assign(wire,q,{asOf:"2026-10-01T22:00:00.000000Z",employeeId:q.workerId===id(5)?null:id(2),workerName:q.workerId===id(5)?"停用人员乙":"合成人员甲",workerNo:q.workerId===id(5)?"HISTORY-B":"REPORT-A"});
  if(mode==="zonechanged")wire.timeZone="UTC";
  wire.fromAt=attendanceRecordInstant(attendanceDayUtcRange(q.fromDate,wire.timeZone).startAt);wire.toAt=attendanceRecordInstant(attendanceDayUtcRange(q.throughDate,wire.timeZone).endAt);
  wire.items[0].events=[sheetEvent(1,"clock_in",`${q.fromDate}T08:00:00.000000Z`),sheetEvent(2,"clock_out",`${q.fromDate}T16:00:00.000000Z`)];
  if(mode==="normal"||mode==="paused"||mode==="tampered"){
    const effect=sheetEffect({startAt:`${q.fromDate}T08:00:00.000000Z`,endAt:`${q.fromDate}T15:00:00.000000Z`,breaks:[]});effect.recordedAt=wire.asOf;wire.items[0].effect=effect;
  }
  if(mode==="open"){wire.items[0].events.pop();wire.items[0].events.push(sheetEvent(2,"break_start",`${q.fromDate}T10:00:00.000000Z`,true));}
  if(mode==="empty"||q.workerId===id(5))wire.items=[];
  const result={ok:true,moduleEnabled:mode!=="paused",...parseAttendanceTimesheetResult(sourceVersion==="raw-and-approved-v2"?firstApprovalSourceV2(wire):wire,q,sourceVersion)};
  if(mode==="tampered")result.totals.selected.workedUs++;
  return result;
}
export function createTimesheetClientFixture(){
  let mode="normal";const calls:{url:string;method:string;signal:AbortSignal|null|undefined}[]=[];
  const held:{release:()=>void}[]=[];
  const workers=Array.from({length:27},(_,n)=>({id:id(4+n),label:n===0?"合成人员甲":n===1?"停用人员乙":`合成人员 ${n+1}`,detail:n===1?"HISTORY-B":`REPORT-${n+1}`,eligible:n!==1}));
  const apiFetch:AttendanceApiFetch=async(url,init={})=>{
    const method=init.method??"GET";calls.push({url,method,signal:init.signal});if(method!=="GET")throw Error("read_only_fixture");
    const u=new URL(url,"https://synthetic.invalid"),path=u.pathname;
    if(u.searchParams.get("siteId")!==timesheetQuery.siteId)throw Error("synthetic_tenant_only");
    if(mode==="denied")return Response.json({ok:false,error:"attendance_access_denied"},{status:403});
    if(mode==="offline")throw Error("synthetic_offline");
    if(path.endsWith("/admin"))return Response.json({ok:true,moduleEnabled:true,siteId:timesheetQuery.siteId,version:mode==="unconfigured"?0:1,view:"settings",items:[],nextCursor:null,receipt:null,
      settings:mode==="unconfigured"?null:{timeZone:"Europe/Madrid",enabled:true,webClockEnabled:true,webBreakPaid:false}});
    if(path.endsWith("/choices")){
      const search=u.searchParams.get("search")??"",cursor=u.searchParams.get("cursor");const list=workers.filter(w=>(!cursor||w.id>cursor)&&(!search||(w.label+w.detail).includes(search)));
      return Response.json({ok:true,moduleEnabled:mode!=="paused",siteId:timesheetQuery.siteId,kind:"workers",items:list.slice(0,25),nextCursor:list.length>25?list[24].id:null});
    }
    if(!path.endsWith("/timesheet"))throw Error("synthetic_route_only");
    if(mode==="large")return Response.json({ok:false,error:"attendance_report_too_large"},{status:422});
    const result=timesheetResponse(parseAttendanceTimesheetQuery(u.toString()),mode,ATTENDANCE_REPORT_SOURCE_VERSION);
    if(mode==="held")return new Promise<Response>(resolve=>held.push({release:()=>resolve(Response.json(result))}));
    return Response.json(result);
  };
  return {apiFetch,calls,mode:(v:string)=>{mode=v;},release:()=>{for(const h of held.splice(0))h.release();}};
}
