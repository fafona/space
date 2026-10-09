import {MERCHANT_ATTENDANCE_ACTIONS} from "./merchantAttendance";
import {attendanceSelfSite,attendanceSelfUuid} from "./merchantAttendanceSelf";
import {attendanceRecordInstant} from "./merchantAttendanceManagement";
import {attendanceDayUtcRange,attendanceLocalDate,attendanceTimeZone,MerchantAttendanceError} from "./merchantAttendanceTime";
import {summarizeAttendanceSessionRecords,type AttendanceSessionEvent,type AttendanceSessionReport,type AttendanceSessionAmounts} from "./merchantAttendanceSession";
import {parseCorrectionProposal} from "./merchantAttendanceCorrection";
import {administrativeSegmentBoundaries,type AdministrativeReportBoundary} from "./merchantAttendanceAdministrativeBoundary";
import {captureBrowserExact} from "./merchantAttendanceRuleCapturesBrowser";

export type AttendanceTimesheetQuery={siteId:string;workerId:string;fromDate:string;throughDate:string};
export type AttendanceTimesheetSourceVersion="raw-and-approved-v1"|"raw-and-approved-v2"|"raw-and-approved-v3";
// Service and browser callers select this together, never from response data.
// Candidate release requires migration 093; no v1 fallback on failure.
export const ATTENDANCE_REPORT_SOURCE_VERSION="raw-and-approved-v2" as const;
export type AttendanceTimesheetLineage={rootRequestId:string;rootOperationId:string;rootRecordedAt:string;previousOperationId:string|null};
export type AttendanceTimesheetCorrection={requestId:string;operationId:string;revision:number;policyRevision:number;recordedAt:string;lineage?:AttendanceTimesheetLineage};
type Span=Omit<AttendanceSessionReport,"days">;
export type AttendanceTimesheetRow={startEventId:string;lastEventId:string;eventIds:string[];source:"original"|"approved";
  original:Span;selected:Span;correction:AttendanceTimesheetCorrection|null;originalInPeriod:AttendanceSessionAmounts|null;selectedInPeriod:AttendanceSessionAmounts|null;
  administrativeBoundary?:AdministrativeReportBoundary|null;predecessorBoundary?:AdministrativeReportBoundary|null};
export type AttendanceTimesheetResult={siteId:string;workerId:string;workerName:string;workerNo:string;employeeId:string|null;
  sourceVersion?:"raw-and-approved-v2"|"raw-and-approved-v3";administrativeUnassessedCount?:number;totalsComplete?:boolean;
  fromDate:string;throughDate:string;fromAt:string;toAt:string;timeZone:string;asOf:string;calculationVersion:"attendance-timesheet-v1";payrollReady:false;
  rows:AttendanceTimesheetRow[];days:{date:string;original:AttendanceSessionAmounts;selected:AttendanceSessionAmounts}[];skippedDates:string[];
  totals:{original:AttendanceSessionAmounts;selected:AttendanceSessionAmounts;difference:AttendanceSessionAmounts};openSessionCount:number;periodInProgress:boolean};
const fields=["elapsedUs","breakUs","paidBreakUs","workedUs"] as const;
const fail=(code="attendance_report_invalid_data"):never=>{throw new MerchantAttendanceError(code);};
const obj=(v:unknown):Record<string,unknown>=>!v||typeof v!=="object"||Array.isArray(v)?fail():v as Record<string,unknown>;
const zero=():AttendanceSessionAmounts=>({elapsedUs:0,breakUs:0,paidBreakUs:0,workedUs:0});
const add=(a:AttendanceSessionAmounts,b:AttendanceSessionAmounts)=>{for(const k of fields)a[k]+=b[k];};
const us=(v:string)=>BigInt(Date.parse(`${v.slice(0,23)}Z`))*BigInt(1000)+BigInt(v.slice(23,26));
const min=(a:bigint,b:bigint)=>a<b?a:b,max=(a:bigint,b:bigint)=>a>b?a:b;
const utc=(v:bigint)=>new Date(Number(v/BigInt(1000))).toISOString();
const instant=(v:unknown)=>attendanceRecordInstant(v);
const shortText=(v:unknown,max:number)=>typeof v==="string"&&v.trim()&&v.length<=max&&!/[\u0000-\u001f\u007f]/.test(v)?v:fail();
const span=(r:AttendanceSessionReport):Span=>({status:r.status,startAt:r.startAt,endAt:r.endAt,timeZone:r.timeZone,breaks:r.breaks,openBreak:r.openBreak,totals:r.totals});
export function attendanceTimesheetQueryString(q:AttendanceTimesheetQuery){return new URLSearchParams(q).toString();}
export function parseAttendanceTimesheetQuery(url:string):AttendanceTimesheetQuery{
  const q=new URL(url).searchParams,keys=["siteId","workerId","fromDate","throughDate"];
  if([...q.keys()].some(k=>!keys.includes(k))||keys.some(k=>q.getAll(k).length!==1))fail("attendance_invalid_request");
  const fromDate=q.get("fromDate")!,throughDate=q.get("throughDate")!;
  try{attendanceDayUtcRange(fromDate,"UTC");attendanceDayUtcRange(throughDate,"UTC");}catch{fail("attendance_invalid_request");}
  const distance=Date.parse(`${throughDate}T00:00:00Z`)-Date.parse(`${fromDate}T00:00:00Z`);
  if(distance<0||distance>30*86400000)fail("attendance_invalid_request");
  return {siteId:attendanceSelfSite(q.get("siteId")),workerId:attendanceSelfUuid(q.get("workerId")),fromDate,throughDate};
}

// SQL acquires current-owner/settings/worker locks and supplies every candidate,
// including approvals whose ORIGINAL shift is outside the requested period.
// No rounding, browser-local zone, new clock-out, payroll rule or mutation here.
// The caller selects the protocol, never the incoming payload. Existing callers
// can explicitly retain v1; application read/export callers bind the constant above.
export function parseAttendanceTimesheetResult(raw:unknown,query:AttendanceTimesheetQuery,sourceVersion:AttendanceTimesheetSourceVersion="raw-and-approved-v1"):AttendanceTimesheetResult{
  if(sourceVersion!=="raw-and-approved-v1"&&sourceVersion!=="raw-and-approved-v2"&&sourceVersion!=="raw-and-approved-v3")fail();
  const administrative=sourceVersion==="raw-and-approved-v3";
  const q=parseAttendanceTimesheetQuery(`https://local.invalid/?${attendanceTimesheetQueryString(query)}`),v=obj(raw);
  if(v.siteId!==q.siteId||v.workerId!==q.workerId||v.fromDate!==q.fromDate||v.throughDate!==q.throughDate
    ||v.complete!==true||v.sourceVersion!==sourceVersion||!Array.isArray(v.items)||v.items.length>100)fail();
  const asOf=instant(v.asOf),timeZone=attendanceTimeZone(v.timeZone as string),fromAt=instant(v.fromAt),toAt=instant(v.toAt);
  if(asOf<"2000-01-01"||asOf>="2101-01-01"||fromAt!==instant(attendanceDayUtcRange(q.fromDate,timeZone).startAt)||toAt!==instant(attendanceDayUtcRange(q.throughDate,timeZone).endAt)||fromAt>=toAt)fail();
  const employeeId=v.employeeId===null?null:attendanceSelfUuid(v.employeeId);
  const workerName=shortText(v.workerName,120),workerNo=shortText(v.workerNo,40);
  const from=us(fromAt),to=us(toAt),allEvents=new Set<string>(),requests=new Set<string>(),operations=new Set<string>();
  const rootRequests=new Set<string>(),rootOperations=new Set<string>();
  let totalEvents=0,previousSequence=0,previousAt="",previousOpen=false;
  let previousBoundary:AdministrativeReportBoundary|null=null,hasBoundary=false;
  const days:AttendanceTimesheetResult["days"]=[],skippedDates:string[]=[];
  for(let date=q.fromDate;date<=q.throughDate;date=new Date(Date.parse(`${date}T00:00:00Z`)+86400000).toISOString().slice(0,10)){
    try {attendanceDayUtcRange(date,timeZone);days.push({date,original:zero(),selected:zero()});}
    catch(e){if(!(e instanceof MerchantAttendanceError)||e.code!=="attendance_local_date_does_not_exist")throw e;skippedDates.push(date);}
  }
  function clipped(report:Span,kind:"original"|"selected"){
    const amount=zero();if(report.endAt===null)return amount;
    let cursor=max(from,us(report.startAt));const end=min(to,us(report.endAt));
    while(cursor<end){
      const date=attendanceLocalDate(utc(cursor),timeZone),day=days.find(d=>d.date===date)??fail();
      const stop=min(end,us(instant(attendanceDayUtcRange(date,timeZone).endAt)));if(stop<=cursor)fail();
      const part=zero();part.elapsedUs=Number(stop-cursor);
      for(const b of report.breaks){const overlap=Number(max(BigInt(0),min(stop,us(b.endAt))-max(cursor,us(b.startAt))));part.breakUs+=overlap;if(b.paid)part.paidBreakUs+=overlap;}
      part.workedUs=part.elapsedUs-part.breakUs;add(amount,part);add(day[kind],part);cursor=stop;
    }
    return amount;
  }
  const relevant=(r:Span)=>r.endAt===null?r.startAt<toAt&&asOf>fromAt:r.startAt<toAt&&(r.endAt>fromAt||r.startAt>=fromAt);
  const rows=(v.items as unknown[]).map((raw):AttendanceTimesheetRow=>{
    const i=obj(raw),startEventId=attendanceSelfUuid(i.startEventId);
    if(administrative)captureBrowserExact(i,["startEventId","events","effect","administrativeBoundary","predecessorBoundary"]);
    else if(Object.hasOwn(i,"administrativeBoundary")||Object.hasOwn(i,"predecessorBoundary"))fail();
    if(!Array.isArray(i.events)||i.events.length<1||i.events.length>2002||(totalEvents+=i.events.length)>4000)fail();
    const events=(i.events as unknown[]).map((raw):AttendanceSessionEvent=>{
      const e=obj(raw),id=attendanceSelfUuid(e.id),occurredAt=instant(e.occurredAt);
      if(allEvents.has(id)||!Number.isSafeInteger(e.sequence)||Number(e.sequence)<1||!MERCHANT_ATTENDANCE_ACTIONS.includes(e.action as AttendanceSessionEvent["action"])
        ||(e.source!=="web"&&e.source!=="kiosk")||(e.action==="break_start"?typeof e.breakPaid!=="boolean":e.breakPaid!==null)
        ||occurredAt>asOf||occurredAt<"2000-01-01"||occurredAt>="2101-01-01")fail();
      allEvents.add(id);return {id,locationId:attendanceSelfUuid(e.locationId),sequence:Number(e.sequence),action:e.action as AttendanceSessionEvent["action"],
        occurredAt,timeZone:attendanceTimeZone(e.timeZone as string),breakPaid:e.breakPaid as boolean|null,source:e.source as "web"|"kiosk"};
    });
    const boundaries=administrative?administrativeSegmentBoundaries(i,events,asOf):null;
    const ownBoundary=boundaries?.administrativeBoundary??null,predecessor=boundaries?.predecessorBoundary??null;
    if(administrative&&!boundaries)fail();
    if(previousBoundary&&events[0].sequence===previousSequence+1&&JSON.stringify(predecessor)!==JSON.stringify(previousBoundary))fail();
    if(predecessor&&predecessor.tailSequence<=previousSequence&&JSON.stringify(predecessor)!==JSON.stringify(previousBoundary))fail();
    if(previousOpen||events[0].id!==startEventId||events[0].sequence<=previousSequence||events[0].occurredAt<previousAt)fail();
    previousSequence=events.at(-1)!.sequence;previousAt=events.at(-1)!.occurredAt;
    const original=span(summarizeAttendanceSessionRecords({events}));let selected=original,correction:AttendanceTimesheetCorrection|null=null;
    previousOpen=original.endAt===null&&!ownBoundary;previousBoundary=ownBoundary;
    if(ownBoundary){if(i.effect!==null)fail();previousAt=ownBoundary.verifiedEndAt;}
    hasBoundary ||= !!ownBoundary||!!predecessor;
    if(i.effect!==null){
      const e=obj(i.effect),requestId=attendanceSelfUuid(e.requestId),operationId=attendanceSelfUuid(e.operationId),recordedAt=instant(e.recordedAt);
      if(original.status!=="completed"||(sourceVersion==="raw-and-approved-v1"?e.revision!==1:!Number.isSafeInteger(e.revision)||Number(e.revision)<1||Number(e.revision)>2147483647)||e.action!=="approve"||e.calculationVersion!=="declaration-v1"
        ||!Number.isSafeInteger(e.policyRevision)||Number(e.policyRevision)<1||Number(e.policyRevision)>9007199254740989
        ||e.timeZone!==original.timeZone||e.originalLastEventId!==events.at(-1)!.id||recordedAt>asOf||recordedAt<original.endAt!
        ||requests.has(requestId)||operations.has(operationId))fail();
      requests.add(requestId);operations.add(operationId);
      const proposal=parseCorrectionProposal(e.proposal,recordedAt),first=events[0];
      const positions=[{action:"clock_in" as const,occurredAt:proposal.startAt,breakPaid:null},...proposal.breaks.flatMap(b=>[
        {action:"break_start" as const,occurredAt:b.startAt,breakPaid:b.paid},{action:"break_end" as const,occurredAt:b.endAt,breakPaid:null}]),
        {action:"clock_out" as const,occurredAt:proposal.endAt,breakPaid:null}];
      selected=span(summarizeAttendanceSessionRecords({events:positions.map((p,n)=>({...first,...p,sequence:n+1}))}));
      for(const k of fields)if(!Number.isSafeInteger(e[k])||e[k]!==selected.totals![k])fail();
      correction={requestId,operationId,revision:Number(e.revision),policyRevision:Number(e.policyRevision),recordedAt};
      if(sourceVersion!=="raw-and-approved-v1"){
        const l=obj(e.lineage),rootRequestId=attendanceSelfUuid(l.rootRequestId),rootOperationId=attendanceSelfUuid(l.rootOperationId),rootRecordedAt=instant(l.rootRecordedAt);
        const previousOperationId=l.previousOperationId===null?null:attendanceSelfUuid(l.previousOperationId);
        if(Object.keys(l).length!==4||rootRequests.has(rootRequestId)||rootOperations.has(rootOperationId)||rootRecordedAt<original.endAt!||rootRecordedAt>recordedAt
          ||(e.revision===1?rootRequestId!==requestId||rootOperationId!==operationId||rootRecordedAt!==recordedAt||previousOperationId!==null:
            rootRequestId===requestId||rootOperationId===operationId||rootRecordedAt>=recordedAt||previousOperationId===null||previousOperationId===operationId
            ||(e.revision===2?previousOperationId!==rootOperationId:previousOperationId===rootOperationId)))fail();
        rootRequests.add(rootRequestId);rootOperations.add(rootOperationId);
        correction.lineage={rootRequestId,rootOperationId,rootRecordedAt,previousOperationId};
      }
    }
    if(ownBoundary?!(ownBoundary.startAt<toAt&&(ownBoundary.verifiedEndAt>fromAt||ownBoundary.startAt>=fromAt)):!relevant(original)&&!relevant(selected))fail();
    return {startEventId,lastEventId:events.at(-1)!.id,eventIds:events.map(e=>e.id),source:correction?"approved":"original",original,selected,correction,
      originalInPeriod:ownBoundary?null:clipped(original,"original"),selectedInPeriod:ownBoundary?null:clipped(selected,"selected"),...(boundaries??{})};
  });
  // Defense in depth: a clipped period may never count overlapping selected spans.
  const intervals=rows.filter(r=>r.selected.endAt!==null).map(r=>({from:max(from,us(r.selected.startAt)),to:min(to,us(r.selected.endAt!))}))
    .filter(r=>r.to>r.from).sort((a,b)=>a.from<b.from?-1:a.from>b.from?1:0);
  for(let n=1;n<intervals.length;n++)if(intervals[n].from<intervals[n-1].to)fail("attendance_report_overlap");
  const original=zero(),selected=zero(),difference=zero();for(const day of days){add(original,day.original);add(selected,day.selected);}
  for(const k of fields){if(!Number.isSafeInteger(original[k])||!Number.isSafeInteger(selected[k]))fail();difference[k]=selected[k]-original[k];}
  const openSessionCount=rows.filter(r=>r.original.endAt===null).length,administrativeUnassessedCount=rows.filter(r=>r.administrativeBoundary).length,totalsComplete=administrativeUnassessedCount===0&&openSessionCount===0;
  if(administrative&&(!hasBoundary||v.administrativeUnassessedCount!==administrativeUnassessedCount||v.totalsComplete!==totalsComplete))fail();
  return {...q,...(sourceVersion!=="raw-and-approved-v1"?{sourceVersion} : {}),...(administrative?{administrativeUnassessedCount,totalsComplete}:{}),employeeId,workerName,workerNo,fromAt,toAt,timeZone,asOf,calculationVersion:"attendance-timesheet-v1",payrollReady:false,
    rows,days,skippedDates,totals:{original,selected,difference},openSessionCount,periodInProgress:toAt>asOf};
}
export const ATTENDANCE_TIMESHEET_ERRORS:Readonly<Record<string,number>>={attendance_invalid_request:400,attendance_access_denied:403,
  attendance_settings_required:409,attendance_worker_not_found:404,attendance_report_version_required:409,attendance_report_too_large:422,attendance_session_invalid_records:422,
  attendance_session_span_too_long:422,attendance_report_overlap:422,attendance_local_date_does_not_exist:422,attendance_rate_limited:429};
