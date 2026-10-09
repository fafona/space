import {attendanceRecordInstant} from "./merchantAttendanceManagement";
import {attendanceSelfUuid} from "./merchantAttendanceSelf";
import {attendanceDayUtcRange,attendanceTimeZone,MerchantAttendanceError} from "./merchantAttendanceTime";
import {attendanceTimesheetQueryString,parseAttendanceTimesheetQuery,type AttendanceTimesheetQuery,type AttendanceTimesheetResult,type AttendanceTimesheetRow,type AttendanceTimesheetSourceVersion} from "./merchantAttendanceTimesheet";
import type {AttendanceSessionAmounts} from "./merchantAttendanceSession";
import {parseAdministrativeReportBoundary,type AdministrativeReportBoundary} from "./merchantAttendanceAdministrativeBoundary";
import {captureBrowserExact} from "./merchantAttendanceRuleCapturesBrowser";

// The HTTP API returns computed rows, not SQL evidence. Validate that distinct
// protocol, including every aggregate, without treating summaries as raw events.
const fields=["elapsedUs","breakUs","paidBreakUs","workedUs"] as const;
const fail=():never=>{throw Error("attendance_report_invalid_data");};
const obj=(v:unknown):Record<string,unknown>=>!v||typeof v!=="object"||Array.isArray(v)?fail():v as Record<string,unknown>;
const zero=():AttendanceSessionAmounts=>({elapsedUs:0,breakUs:0,paidBreakUs:0,workedUs:0});
const instant=(v:unknown)=>{const s=attendanceRecordInstant(v);if(s!==v||s<"2000-01-01"||s>="2101-01-01")fail();return s;};
const us=(s:string)=>BigInt(Date.parse(s.slice(0,23)+"Z"))*BigInt(1000)+BigInt(s.slice(23,26));
const min=(a:bigint,b:bigint)=>a<b?a:b,max=(a:bigint,b:bigint)=>a>b?a:b;
const text=(v:unknown,n:number)=>typeof v==="string"&&v.trim()&&v.length<=n&&!/[\u0000-\u001f\u007f]/.test(v)?v:fail();
function checkAmounts(raw:unknown,expected:AttendanceSessionAmounts){
  const o=obj(raw);for(const k of fields)if(!Number.isSafeInteger(o[k])||o[k]!==expected[k])fail();return {...expected};
}
const add=(a:AttendanceSessionAmounts,b:AttendanceSessionAmounts)=>{for(const k of fields){a[k]+=b[k];if(!Number.isSafeInteger(a[k]))fail();}};
function span(raw:unknown,asOf:string,maxBreaks:number):AttendanceTimesheetRow["original"]{
  const v=obj(raw),startAt=instant(v.startAt),endAt=v.endAt===null?null:instant(v.endAt),timeZone=attendanceTimeZone(v.timeZone as string);
  if(startAt>asOf||!Array.isArray(v.breaks)||v.breaks.length>maxBreaks)fail();
  let cursor=startAt;const totals=zero();
  const breaks=(v.breaks as unknown[]).map(raw=>{
    const b=obj(raw),startAt=instant(b.startAt),endAt=instant(b.endAt);
    if(startAt<cursor||endAt<startAt||endAt>asOf||typeof b.paid!=="boolean")fail();
    cursor=endAt;const duration=Number(us(endAt)-us(startAt));totals.breakUs+=duration;if(b.paid)totals.paidBreakUs+=duration;
    return {startAt,endAt,paid:b.paid as boolean};
  });
  if(endAt!==null){
    if(v.status!=="completed"||v.openBreak!==null||endAt<cursor||endAt>asOf)fail();
    totals.elapsedUs=Number(us(endAt)-us(startAt));totals.workedUs=totals.elapsedUs-totals.breakUs;
    if(totals.elapsedUs>2678400000000)fail();
    return {status:"completed",startAt,endAt,timeZone,breaks,openBreak:null,totals:checkAmounts(v.totals,totals)};
  }
  if(v.totals!==null)fail();
  if(v.status==="working"&&v.openBreak===null)return {status:"working",startAt,endAt:null,timeZone,breaks,openBreak:null,totals:null};
  const b=obj(v.openBreak),breakStart=instant(b.startAt);
  if(v.status!=="break"||breakStart<cursor||breakStart>asOf||typeof b.paid!=="boolean")fail();
  return {status:"break",startAt,endAt:null,timeZone,breaks,openBreak:{startAt:breakStart,paid:b.paid as boolean},totals:null};
}
// Common computed-data validation; it does not infer any account binding or
// visibility scope. Each reader validates and returns its own identity metadata.
export function parseAttendanceTimesheetComputedResponse(raw:unknown,query:AttendanceTimesheetQuery,sourceVersion:AttendanceTimesheetSourceVersion="raw-and-approved-v1"):Omit<AttendanceTimesheetResult,"employeeId">&{moduleEnabled:boolean}{
  if(sourceVersion!=="raw-and-approved-v1"&&sourceVersion!=="raw-and-approved-v2"&&sourceVersion!=="raw-and-approved-v3")fail();
  const administrative=sourceVersion==="raw-and-approved-v3";
  const q=parseAttendanceTimesheetQuery(`https://local.invalid/?${attendanceTimesheetQueryString(query)}`),v=obj(raw);
  if(v.ok!==true||typeof v.moduleEnabled!=="boolean"||v.siteId!==q.siteId||v.workerId!==q.workerId||v.fromDate!==q.fromDate||v.throughDate!==q.throughDate
    ||v.calculationVersion!=="attendance-timesheet-v1"||v.payrollReady!==false||!Array.isArray(v.rows)||v.rows.length>100
    ||(sourceVersion!=="raw-and-approved-v1"?v.sourceVersion!==sourceVersion:v.sourceVersion!==undefined))fail();
  const timeZone=attendanceTimeZone(v.timeZone as string),asOf=instant(v.asOf),fromAt=attendanceRecordInstant(v.fromAt),toAt=attendanceRecordInstant(v.toAt);
  if(fromAt!==attendanceRecordInstant(attendanceDayUtcRange(q.fromDate,timeZone).startAt)||toAt!==attendanceRecordInstant(attendanceDayUtcRange(q.throughDate,timeZone).endAt))fail();
  const days:AttendanceTimesheetResult["days"]=[],skippedDates:string[]=[],ranges:{from:bigint;to:bigint}[]=[];
  for(let date=q.fromDate;date<=q.throughDate;date=new Date(Date.parse(date+"T00:00:00Z")+86400000).toISOString().slice(0,10)){
    try{const range=attendanceDayUtcRange(date,timeZone);ranges.push({from:us(attendanceRecordInstant(range.startAt)),to:us(attendanceRecordInstant(range.endAt))});days.push({date,original:zero(),selected:zero()});}
    catch(e){if(!(e instanceof MerchantAttendanceError)||e.code!=="attendance_local_date_does_not_exist")throw e;skippedDates.push(date);}
  }
  function clipped(s:AttendanceTimesheetRow["original"],kind:"original"|"selected"){
    const amount=zero();if(s.endAt===null)return amount;
    const breaks=s.breaks.map(b=>({from:us(b.startAt),to:us(b.endAt),paid:b.paid}));
    for(let n=0;n<days.length;n++){
      const from=max(ranges[n].from,us(s.startAt)),to=min(ranges[n].to,us(s.endAt));if(to<=from)continue;
      const part=zero();part.elapsedUs=Number(to-from);
      for(const b of breaks){const duration=Number(max(BigInt(0),min(to,b.to)-max(from,b.from)));part.breakUs+=duration;if(b.paid)part.paidBreakUs+=duration;}
      part.workedUs=part.elapsedUs-part.breakUs;add(amount,part);add(days[n][kind],part);
    }return amount;
  }
  const ids=new Set<string>(),requests=new Set<string>(),operations=new Set<string>(),rootRequests=new Set<string>(),rootOperations=new Set<string>();let count=0,previousEnd="",previousOpen=false;
  let previousBoundary:AdministrativeReportBoundary|null=null,hasBoundary=false;
  const parsedRows=(v.rows as unknown[]).map((raw):AttendanceTimesheetRow=>{
    const r=obj(raw),original=span(r.original,asOf,1000),selected=span(r.selected,asOf,r.source==="original"?1000:32);
    return parseRow(r,original,selected);
  });
  function parseRow(r:Record<string,unknown>,original:AttendanceTimesheetRow["original"],selected:AttendanceTimesheetRow["selected"]):AttendanceTimesheetRow{
    if(previousOpen||original.startAt<previousEnd||!Array.isArray(r.eventIds)||r.eventIds.length<1||r.eventIds.length>2002||(count+=r.eventIds.length)>4000)fail();
    const eventIds=(r.eventIds as unknown[]).map(value=>{const id=attendanceSelfUuid(value);if(ids.has(id))fail();ids.add(id);return id;});
    if(eventIds.length!==1+original.breaks.length*2+(original.openBreak?1:0)+(original.endAt?1:0)||eventIds[0]!==r.startEventId||eventIds.at(-1)!==r.lastEventId)fail();
    let administrativeBoundary:AdministrativeReportBoundary|null=null,predecessorBoundary:AdministrativeReportBoundary|null=null;
    if(administrative){
      captureBrowserExact(r,["startEventId","lastEventId","eventIds","source","original","selected","correction","originalInPeriod","selectedInPeriod","administrativeBoundary","predecessorBoundary"]);
      administrativeBoundary=r.administrativeBoundary===null?null:parseAdministrativeReportBoundary(r.administrativeBoundary);
      predecessorBoundary=r.predecessorBoundary===null?null:parseAdministrativeReportBoundary(r.predecessorBoundary);
      if(administrativeBoundary){const b=administrativeBoundary;
        const tailAction=original.openBreak?"break_start":original.breaks.length?"break_end":"clock_in",tailAt=original.openBreak?.startAt??original.breaks.at(-1)?.endAt??original.startAt;
        if(original.endAt!==null||r.source!=="original"||r.correction!==null||b.startEventId!==eventIds[0]||b.tailEventId!==eventIds.at(-1)
          ||b.startAt!==original.startAt||b.tailAction!==tailAction||b.tailOccurredAt!==tailAt||b.tailSequence-b.startSequence+1!==eventIds.length||b.recordedAt>asOf
          ||r.originalInPeriod!==null||r.selectedInPeriod!==null)fail();
      }
      if(predecessorBoundary){const b=predecessorBoundary;
        if(b.verifiedEndAt>original.startAt||b.recordedAt>asOf||eventIds.includes(b.startEventId)||eventIds.includes(b.tailEventId)
          ||administrativeBoundary&&(b.tailSequence+1!==administrativeBoundary.startSequence||b.operationId===administrativeBoundary.operationId)
          ||previousBoundary&&b.tailSequence<=previousBoundary.tailSequence&&JSON.stringify(b)!==JSON.stringify(previousBoundary))fail();
      }
      hasBoundary ||= !!administrativeBoundary||!!predecessorBoundary;
    }else if(Object.hasOwn(r,"administrativeBoundary")||Object.hasOwn(r,"predecessorBoundary"))fail();
    previousOpen=original.endAt===null;previousEnd=original.endAt??original.startAt;
    if(administrativeBoundary){previousOpen=false;previousEnd=administrativeBoundary.verifiedEndAt;}
    previousBoundary=administrativeBoundary;
    let correction:AttendanceTimesheetRow["correction"]=null;
    if(r.source==="approved"){
      const c=obj(r.correction),requestId=attendanceSelfUuid(c.requestId),operationId=attendanceSelfUuid(c.operationId),recordedAt=instant(c.recordedAt);
      if(original.status!=="completed"||selected.status!=="completed"||original.timeZone!==selected.timeZone
        ||(sourceVersion==="raw-and-approved-v1"?c.revision!==1:!Number.isSafeInteger(c.revision)||Number(c.revision)<1||Number(c.revision)>2147483647)
        ||!Number.isSafeInteger(c.policyRevision)||Number(c.policyRevision)<1||Number(c.policyRevision)>9007199254740989
        ||recordedAt>asOf||recordedAt<original.endAt!||recordedAt<selected.endAt!||requests.has(requestId)||operations.has(operationId))fail();
      requests.add(requestId);operations.add(operationId);correction={requestId,operationId,revision:Number(c.revision),policyRevision:Number(c.policyRevision),recordedAt};
      if(sourceVersion!=="raw-and-approved-v1"){
        const l=obj(c.lineage),rootRequestId=attendanceSelfUuid(l.rootRequestId),rootOperationId=attendanceSelfUuid(l.rootOperationId),rootRecordedAt=instant(l.rootRecordedAt);
        const previousOperationId=l.previousOperationId===null?null:attendanceSelfUuid(l.previousOperationId);
        if(Object.keys(l).length!==4||rootRequests.has(rootRequestId)||rootOperations.has(rootOperationId)||rootRecordedAt<original.endAt!||rootRecordedAt>recordedAt
          ||(c.revision===1?rootRequestId!==requestId||rootOperationId!==operationId||rootRecordedAt!==recordedAt||previousOperationId!==null:
            rootRequestId===requestId||rootOperationId===operationId||rootRecordedAt>=recordedAt||previousOperationId===null||previousOperationId===operationId
            ||(c.revision===2?previousOperationId!==rootOperationId:previousOperationId===rootOperationId)))fail();
        rootRequests.add(rootRequestId);rootOperations.add(rootOperationId);
        correction.lineage={rootRequestId,rootOperationId,rootRecordedAt,previousOperationId};
      }else if(c.lineage!==undefined)fail();
    }else if(r.source!=="original"||r.correction!==null||JSON.stringify(original)!==JSON.stringify(selected))fail();
    const relevant=(s:typeof original)=>s.endAt===null?s.startAt<toAt&&asOf>fromAt:s.startAt<toAt&&(s.endAt>fromAt||s.startAt>=fromAt);
    if(administrativeBoundary?!(administrativeBoundary.startAt<toAt&&(administrativeBoundary.verifiedEndAt>fromAt||administrativeBoundary.startAt>=fromAt)):!relevant(original)&&!relevant(selected))fail();
    return {startEventId:eventIds[0],lastEventId:eventIds.at(-1)!,eventIds,source:r.source as AttendanceTimesheetRow["source"],original,selected,correction,
      originalInPeriod:administrativeBoundary?null:checkAmounts(r.originalInPeriod,clipped(original,"original")),selectedInPeriod:administrativeBoundary?null:checkAmounts(r.selectedInPeriod,clipped(selected,"selected")),
      ...(administrative?{administrativeBoundary,predecessorBoundary}:{})};
  }
  const intervals=parsedRows.filter(r=>r.selected.endAt!==null).map(r=>({from:max(us(fromAt),us(r.selected.startAt)),to:min(us(toAt),us(r.selected.endAt!))})).filter(r=>r.to>r.from).sort((a,b)=>a.from<b.from?-1:a.from>b.from?1:0);
  for(let n=1;n<intervals.length;n++)if(intervals[n].from<intervals[n-1].to)fail();
  if(!Array.isArray(v.days)||v.days.length!==days.length||!Array.isArray(v.skippedDates)||JSON.stringify(v.skippedDates)!==JSON.stringify(skippedDates))fail();
  const original=zero(),selected=zero(),difference=zero();
  for(let n=0;n<days.length;n++){const d=obj((v.days as unknown[])[n]);if(d.date!==days[n].date)fail();checkAmounts(d.original,days[n].original);checkAmounts(d.selected,days[n].selected);add(original,days[n].original);add(selected,days[n].selected);}
  for(const k of fields)difference[k]=selected[k]-original[k];
  const totals=obj(v.totals);checkAmounts(totals.original,original);checkAmounts(totals.selected,selected);checkAmounts(totals.difference,difference);
  const openSessionCount=parsedRows.filter(r=>r.original.endAt===null).length,periodInProgress=toAt>asOf;
  if(v.openSessionCount!==openSessionCount||v.periodInProgress!==periodInProgress)fail();
  const administrativeUnassessedCount=parsedRows.filter(r=>r.administrativeBoundary).length,totalsComplete=administrativeUnassessedCount===0&&openSessionCount===0;
  if(administrative&&(!hasBoundary||v.administrativeUnassessedCount!==administrativeUnassessedCount||v.totalsComplete!==totalsComplete))fail();
  return {...q,...(sourceVersion!=="raw-and-approved-v1"?{sourceVersion}:{}),...(administrative?{administrativeUnassessedCount,totalsComplete}:{}),timeZone,asOf,fromAt,toAt,workerName:text(v.workerName,120),workerNo:text(v.workerNo,40),
    calculationVersion:"attendance-timesheet-v1",payrollReady:false,moduleEnabled:v.moduleEnabled as boolean,rows:parsedRows,days,skippedDates,totals:{original,selected,difference},openSessionCount,periodInProgress};
}
export function parseAttendanceTimesheetResponse(raw:unknown,query:AttendanceTimesheetQuery,sourceVersion:AttendanceTimesheetSourceVersion="raw-and-approved-v1"):AttendanceTimesheetResult&{moduleEnabled:boolean}{
  const result=parseAttendanceTimesheetComputedResponse(raw,query,sourceVersion),v=obj(raw);
  return {...result,employeeId:v.employeeId===null?null:attendanceSelfUuid(v.employeeId)};
}
