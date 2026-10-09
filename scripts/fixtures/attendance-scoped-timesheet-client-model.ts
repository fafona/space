import {timesheetResponse} from "./attendance-timesheet-client-model";
import {timesheetId as id,timesheetQuery} from "./attendance-timesheet-model";
import {parseAttendanceScopedTimesheetQuery,type AttendanceScopedTimesheetQuery} from "../../src/lib/merchantAttendanceScopedTimesheet";
import {parseScopedContextQuery,scopedPairKey,type ScopedContextQuery} from "../../src/lib/merchantAttendanceScopedTimesheetContext";
import type {AttendanceApiFetch} from "../../src/lib/merchantAttendanceSelfClient";
import {ATTENDANCE_REPORT_SOURCE_VERSION,type AttendanceTimesheetSourceVersion} from "../../src/lib/merchantAttendanceTimesheet";
export const scopedActor=(access:"self"|"manager")=>id(access==="self"?2:90);
export function scopedComputed(q:AttendanceScopedTimesheetQuery,mode="normal",sourceVersion:AttendanceTimesheetSourceVersion="raw-and-approved-v1"){
  const {employeeId:unused,...computed}=timesheetResponse({...timesheetQuery,fromDate:q.fromDate,throughDate:q.throughDate,workerId:q.access==="self"?q.expectedWorkerId??id(4):q.workerId},mode,sourceVersion);
  void unused;
  return {...computed,access:q.access,viewerEmployeeId:scopedActor(q.access),coverage:"authorized-complete-sessions-v1",scopeRevision:q.access==="manager"?1:null,locationId:q.access==="manager"?q.locationId:null,accessValidUntil:null as string|null};
}
export function scopedContextFixture(q:ScopedContextQuery,mode="normal"){
  const pairs=Array.from({length:27},(_,n)=>({workerId:id(n<2?4:n+4),workerName:n<2?"合成人员甲":"合成人员 "+n,workerNo:"W-"+n,locationId:id(n===1?6:5),locationName:n===1?"授权分店乙":"授权门店甲"}));
  const filtered=pairs.filter(p=>(!q.cursor||scopedPairKey(p)>q.cursor)&&(!q.search||(p.workerName+p.workerNo+p.locationName).includes(q.search)));
  return {ok:true,moduleEnabled:true,siteId:q.siteId,access:q.access,viewerEmployeeId:scopedActor(q.access),timeZone:"Europe/Madrid",asOf:"2026-10-01T22:00:00.000000Z",
    accessValidUntil:mode==="expiring"?"2026-10-01T22:00:05.000000Z":null,scopeRevision:q.access==="manager"?1:null,
    worker:q.access==="self"?{id:id(4),label:"合成员工本人",detail:"SELF-1"}:null,items:q.access==="self"?[]:filtered.slice(0,25),nextCursor:q.access==="manager"&&filtered.length>25?scopedPairKey(filtered[24]):null};
}
export function createScopedClientFixture(){
  let mode="normal";const calls:{url:string;method:string;signal?:AbortSignal|null}[]=[],held:(()=>void)[]=[];
  const apiFetch:AttendanceApiFetch=async(url,init={})=>{
    calls.push({url,method:init.method??"GET",signal:init.signal});if((init.method??"GET")!=="GET")throw Error("synthetic_read_only");
    const u=new URL(url,"https://synthetic.invalid");if(u.searchParams.get("siteId")!==timesheetQuery.siteId)throw Error("synthetic_tenant_only");
    if(mode==="denied")return Response.json({ok:false,error:"attendance_access_denied"},{status:403});
    if(mode==="offline")throw Error("synthetic_offline");
    if(u.pathname.endsWith("/scoped-timesheet-context")){
      const q=parseScopedContextQuery(u.toString()),data=scopedContextFixture(q,mode);
      if(mode==="wrongactor")data.viewerEmployeeId=id(99);
      return Response.json(data);
    }
    if(!u.pathname.endsWith("/scoped-timesheet"))throw Error("synthetic_route_only");
    if(mode==="large")return Response.json({ok:false,error:"attendance_report_too_large"},{status:422});
    if(mode==="rebound")return Response.json({ok:false,error:"attendance_worker_changed"},{status:409});
    const q=parseAttendanceScopedTimesheetQuery(u.toString()),data=scopedComputed(q,mode,ATTENDANCE_REPORT_SOURCE_VERSION);
    if(mode==="revision")data.scopeRevision=2;
    if(mode==="wrongactor")data.viewerEmployeeId=id(99);
    if(mode==="held")await new Promise<void>(resolve=>held.push(resolve));
    return Response.json(data);
  };
  return {apiFetch,calls,mode:(m:string)=>{mode=m;},release:()=>{held.splice(0).forEach(f=>f());}};
}
