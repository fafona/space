import {MERCHANT_ATTENDANCE_ACTIONS,type AttendanceAction} from "./merchantAttendance";
import {attendanceSelfSite,attendanceSelfUuid} from "./merchantAttendanceSelf";
import {attendanceRecordInstant} from "./merchantAttendanceManagement";
import {attendanceDayUtcRange,attendanceLocalDate,attendanceTimeZone,MerchantAttendanceError} from "./merchantAttendanceTime";
import {administrativeSegmentBoundaries,type AdministrativeReportBoundary} from "./merchantAttendanceAdministrativeBoundary";

export type AttendanceSessionQuery={siteId:string;startEventId:string};
export type AttendanceSessionEvent={id:string;locationId:string;sequence:number;action:AttendanceAction;
  occurredAt:string;timeZone:string;breakPaid:boolean|null;source:"web"|"kiosk"};
export type AttendanceSessionResult={siteId:string;employeeId:string;workerId:string;asOf:string;events:AttendanceSessionEvent[];
  administrativeBoundary?:AdministrativeReportBoundary|null;predecessorBoundary?:AdministrativeReportBoundary|null};
export type AttendanceSessionBreak={startAt:string;endAt:string;paid:boolean};
export type AttendanceSessionAmounts={elapsedUs:number;breakUs:number;paidBreakUs:number;workedUs:number};
export type AttendanceSessionDay=AttendanceSessionAmounts&{date:string;startAt:string;endAt:string};
export type AttendanceSessionReport={status:"completed"|"working"|"break";startAt:string;endAt:string|null;timeZone:string;
  breaks:AttendanceSessionBreak[];openBreak:{startAt:string;paid:boolean}|null;totals:AttendanceSessionAmounts|null;days:AttendanceSessionDay[]};
const fail=(code="attendance_session_invalid_records"):never=>{throw new MerchantAttendanceError(code);};
const object=(value:unknown):Record<string,unknown>=>!value||typeof value!=="object"||Array.isArray(value)?fail():value as Record<string,unknown>;
// UTC epoch microseconds stay bigint until bounded durations are converted.
const micros=(value:string)=>BigInt(Date.parse(`${value.slice(0,23)}Z`))*BigInt(1000)+BigInt(value.slice(23,26));
const instant=(value:bigint)=>new Date(Number(value/BigInt(1000))).toISOString().slice(0,23)+String(value%BigInt(1000)).padStart(3,"0")+"Z";
const min=(a:bigint,b:bigint)=>a<b?a:b,max=(a:bigint,b:bigint)=>a>b?a:b;
export function attendanceSessionQueryString(query:AttendanceSessionQuery){return new URLSearchParams(query).toString();}
export function parseAttendanceSessionQuery(url:string):AttendanceSessionQuery{
  const q=new URL(url).searchParams;
  for(const key of q.keys())if(!["siteId","startEventId"].includes(key)||q.getAll(key).length!==1)fail("attendance_invalid_request");
  return {siteId:attendanceSelfSite(q.get("siteId")),startEventId:attendanceSelfUuid(q.get("startEventId"))};
}
export function parseAttendanceSessionResult(raw:unknown,query:AttendanceSessionQuery):AttendanceSessionResult{
  const body=object(raw);if(body.siteId!==query.siteId||!Array.isArray(body.events)||!body.events.length||body.events.length>2002)return fail();
  const asOf=attendanceRecordInstant(body.asOf);
  const events=Array.from(body.events,(raw):AttendanceSessionEvent=>{
    const e=object(raw);
    if(!Number.isSafeInteger(e.sequence)||(e.sequence as number)<1||(e.sequence as number)>Number.MAX_SAFE_INTEGER
      ||!MERCHANT_ATTENDANCE_ACTIONS.includes(e.action as AttendanceAction)||(e.source!=="web"&&e.source!=="kiosk")
      ||(e.action==="break_start"?typeof e.breakPaid!=="boolean":e.breakPaid!==null))return fail();
    const occurredAt=attendanceRecordInstant(e.occurredAt);
    if(occurredAt>asOf||occurredAt<"2000-01-01"||occurredAt>="2101-01-01")fail();
    return {id:attendanceSelfUuid(e.id),locationId:attendanceSelfUuid(e.locationId),sequence:e.sequence as number,
      action:e.action as AttendanceAction,occurredAt,timeZone:attendanceTimeZone(e.timeZone as string),breakPaid:e.breakPaid as boolean|null,source:e.source};
  });
  if(events[0].id!==query.startEventId||events[0].action!=="clock_in"||new Set(events.map(e=>e.id)).size!==events.length)fail();
  const boundaries=administrativeSegmentBoundaries(body,events,asOf);
  if(boundaries&&!boundaries.administrativeBoundary&&!boundaries.predecessorBoundary)fail();
  const result={siteId:query.siteId,employeeId:attendanceSelfUuid(body.employeeId),workerId:attendanceSelfUuid(body.workerId),asOf,events,...(boundaries??{})};
  // Validate the whole ordered segment before forwarding any event to the browser.
  summarizeAttendanceSessionRecords(result);
  return result;
}

// Read-only reconstruction of one stored clock-in through its first clock-out.
// Never fills a missing event, rounds timestamps, clips to the history page, or
// substitutes asOf for an absent clock-out. No wages, scheduled hours or overtime.
export function summarizeAttendanceSessionRecords<T extends Pick<AttendanceSessionResult,"events">>(result:T):AttendanceSessionReport{
  const first=result.events[0];if(!first||first.action!=="clock_in"||result.events.length>2002)fail();
  let status:AttendanceSessionReport["status"]="working",endAt:string|null=null;
  let openBreak:AttendanceSessionReport["openBreak"]=null;
  const breaks:AttendanceSessionBreak[]=[];
  for(let n=1;n<result.events.length;n++){
    const event=result.events[n],previous=result.events[n-1];
    if(event.sequence!==previous.sequence+1||event.occurredAt<previous.occurredAt||status==="completed")fail();
    if(event.action==="break_start"&&status==="working"){
      if(breaks.length>=1000)fail("attendance_session_too_large");
      openBreak={startAt:event.occurredAt,paid:event.breakPaid!};status="break";
    }else if(event.action==="break_end"&&status==="break"&&openBreak){
      breaks.push({...openBreak,endAt:event.occurredAt});openBreak=null;status="working";
    }else if(event.action==="clock_out"&&status==="working"){
      endAt=event.occurredAt;status="completed";
    }else fail();
  }
  const base={status,startAt:first.occurredAt,endAt,timeZone:first.timeZone,breaks,openBreak};
  if(!endAt)return {...base,totals:null,days:[]};
  const start=micros(first.occurredAt),end=micros(endAt);
  if(end-start>BigInt(2678400000000))fail("attendance_session_span_too_long");
  const timedBreaks=breaks.map(item=>({start:micros(item.startAt),end:micros(item.endAt),paid:item.paid}));
  const days:AttendanceSessionDay[]=[];
  let cursor=start;
  while(cursor<end){
    const date=attendanceLocalDate(new Date(Number(cursor/BigInt(1000))).toISOString(),first.timeZone);
    const boundary=micros(attendanceRecordInstant(attendanceDayUtcRange(date,first.timeZone).endAt));
    const to=min(end,boundary);if(to<=cursor||days.length>=34)fail();
    let breakUs=0,paidBreakUs=0;
    for(const item of timedBreaks){
      const overlap=Number(max(BigInt(0),min(to,item.end)-max(cursor,item.start)));
      breakUs+=overlap;if(item.paid)paidBreakUs+=overlap;
    }
    const elapsedUs=Number(to-cursor);
    days.push({date,startAt:instant(cursor),endAt:instant(to),elapsedUs,breakUs,paidBreakUs,workedUs:elapsedUs-breakUs});cursor=to;
  }
  return {...base,days,totals:days.reduce<AttendanceSessionAmounts>((sum,day)=>({elapsedUs:sum.elapsedUs+day.elapsedUs,
    breakUs:sum.breakUs+day.breakUs,paidBreakUs:sum.paidBreakUs+day.paidBreakUs,workedUs:sum.workedUs+day.workedUs}),
    {elapsedUs:0,breakUs:0,paidBreakUs:0,workedUs:0})};
}
export function formatAttendanceDurationUs(value:number){
  if(!Number.isSafeInteger(value)||value<0||value>2678400000000)fail();
  const seconds=Math.floor(value/1000000),fraction=String(value%1000000).padStart(6,"0").replace(/0+$/,"");
  return `${Math.floor(seconds/3600)} 小时 ${Math.floor(seconds/60)%60} 分 ${seconds%60}${fraction?`.${fraction}`:""} 秒`;
}
export const ATTENDANCE_SESSION_ERRORS:Readonly<Record<string,number>>={attendance_invalid_request:400,
  attendance_access_denied:403,attendance_settings_required:409,attendance_session_not_found:404,
  attendance_session_too_large:422,attendance_session_invalid_records:422,attendance_session_span_too_long:422,attendance_rate_limited:429};
