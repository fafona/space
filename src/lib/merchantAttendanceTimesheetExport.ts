import {attendanceSelfSite,attendanceSelfUuid} from "./merchantAttendanceSelf";
import {attendanceRecordInstant} from "./merchantAttendanceManagement";
import {attendanceTimeZone,MerchantAttendanceError} from "./merchantAttendanceTime";
import {parseAttendanceTimesheetQuery,attendanceTimesheetQueryString,parseAttendanceTimesheetResult,ATTENDANCE_TIMESHEET_ERRORS,type AttendanceTimesheetResult,type AttendanceTimesheetSourceVersion} from "./merchantAttendanceTimesheet";
import {parseAttendanceScopedTimesheetResult,type AttendanceScopedTimesheetQuery,type AttendanceScopedTimesheetResult} from "./merchantAttendanceScopedTimesheet";
import {attendanceAuditCsvCell} from "./merchantAttendanceAuditExport";
import type {AttendanceSessionAmounts} from "./merchantAttendanceSession";
import {parseAttendanceTimesheetComputedResponse} from "./merchantAttendanceTimesheetResponse";

export type TimesheetExportQuery={access:"owner"|"self"|"manager";workerId:string|null;locationId:string|null;expectedWorkerId:string|null;
  fromDate:string;throughDate:string;expectedTimeZone:string;expectedScopeRevision:number|null};
export type TimesheetExportCommand={siteId:string;operationId:string;query:TimesheetExportQuery};
export type TimesheetExportReceipt={operationId:string;siteId:string;access:TimesheetExportQuery["access"];workerId:string;locationId:string|null;
  fromDate:string;throughDate:string;timeZone:string;scopeRevision:number|null;asOf:string;recordedAt:string;sourceSha256:string;sourceBytes:number;
  sessionCount:number;schemaVersion:1;status:"source_read";downloadConfirmed:false};
export type TimesheetExportReport=AttendanceTimesheetResult|AttendanceScopedTimesheetResult;
function fail(code="attendance_report_invalid_data"):never{throw new MerchantAttendanceError(code);}
const obj=(v:unknown):Record<string,unknown>=>v&&typeof v==="object"&&!Array.isArray(v)?v as Record<string,unknown>:fail();
const exact=(v:Record<string,unknown>,keys:string[])=>Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
export const TIMESHEET_EXPORT_MAX_BYTES=4*1024*1024;
export function parseTimesheetExportCommand(value:unknown):TimesheetExportCommand{
  try{
    const c=obj(value),q=obj(c.query);
    if(!exact(c,["siteId","operationId","query"])||!exact(q,["access","workerId","locationId","expectedWorkerId","fromDate","throughDate","expectedTimeZone","expectedScopeRevision"]))fail();
    if(!["owner","self","manager"].includes(q.access as string))fail();
    const siteId=attendanceSelfSite(c.siteId),operationId=attendanceSelfUuid(c.operationId),access=q.access as TimesheetExportQuery["access"];
    const workerId=q.workerId===null?null:attendanceSelfUuid(q.workerId),locationId=q.locationId===null?null:attendanceSelfUuid(q.locationId),expectedWorkerId=q.expectedWorkerId===null?null:attendanceSelfUuid(q.expectedWorkerId);
    if(access==="self"?workerId!==null||locationId!==null||expectedWorkerId===null:workerId===null||expectedWorkerId!==null||(access==="owner"?locationId!==null:locationId===null))fail();
    const revision=q.expectedScopeRevision;
    if(access==="manager"?!Number.isSafeInteger(revision)||Number(revision)<1||Number(revision)>9007199254740990:revision!==null)fail();
    if(typeof q.fromDate!=="string"||typeof q.throughDate!=="string"||typeof q.expectedTimeZone!=="string"||q.expectedTimeZone.length>100)fail();
    const dates=parseAttendanceTimesheetQuery("https://local.invalid/?"+attendanceTimesheetQueryString({siteId,workerId:(workerId??expectedWorkerId)!,fromDate:q.fromDate,throughDate:q.throughDate}));
    const expectedTimeZone=attendanceTimeZone(q.expectedTimeZone);if(expectedTimeZone!==q.expectedTimeZone)fail();
    return {siteId,operationId,query:{access,workerId,locationId,expectedWorkerId,fromDate:dates.fromDate,throughDate:dates.throughDate,expectedTimeZone,expectedScopeRevision:revision as number|null}};
  }catch{fail("attendance_invalid_request");}
}
export function parseTimesheetExportReceipt(value:unknown,command:TimesheetExportCommand):TimesheetExportReceipt{
  const v=obj(value),c=parseTimesheetExportCommand(command),q=c.query;
  if(!exact(v,["operationId","siteId","access","workerId","locationId","fromDate","throughDate","timeZone","scopeRevision","asOf","recordedAt","sourceSha256","sourceBytes","sessionCount","schemaVersion","status","downloadConfirmed"])
    ||v.operationId!==c.operationId||v.siteId!==c.siteId||v.access!==q.access||v.workerId!==(q.workerId??q.expectedWorkerId)||v.locationId!==q.locationId
    ||v.fromDate!==q.fromDate||v.throughDate!==q.throughDate||v.timeZone!==q.expectedTimeZone||v.scopeRevision!==q.expectedScopeRevision
    ||v.schemaVersion!==1||v.status!=="source_read"||v.downloadConfirmed!==false||typeof v.sourceSha256!=="string"||! /^[a-f0-9]{64}$/.test(v.sourceSha256)
    ||!Number.isSafeInteger(v.sourceBytes)||Number(v.sourceBytes)<1||Number(v.sourceBytes)>1048576
    ||!Number.isSafeInteger(v.sessionCount)||Number(v.sessionCount)<0||Number(v.sessionCount)>100)fail();
  const asOf=attendanceRecordInstant(v.asOf),recordedAt=attendanceRecordInstant(v.recordedAt);
  if(asOf!==v.asOf||recordedAt!==v.recordedAt||recordedAt<asOf||asOf<"2000-01-01"||recordedAt>="2101-01-01")fail();
  return v as TimesheetExportReceipt;
}
export function parseTimesheetExportSource(value:unknown,command:TimesheetExportCommand,sourceVersion:AttendanceTimesheetSourceVersion="raw-and-approved-v1"){
  const v=obj(value),c=parseTimesheetExportCommand(command),q=c.query;
  if(!exact(v,["receipt","replayed","report"])||typeof v.replayed!=="boolean")fail();
  const receipt=parseTimesheetExportReceipt(v.receipt,c);
  if(v.replayed){if(v.report!==null)fail();return {receipt,replayed:true as const,report:null};}
  const query={siteId:c.siteId,fromDate:q.fromDate,throughDate:q.throughDate};
  const report=q.access==="owner"?parseAttendanceTimesheetResult(v.report,{...query,workerId:q.workerId!},sourceVersion):
    parseAttendanceScopedTimesheetResult(v.report,q.access==="self"?{...query,access:"self",expectedWorkerId:q.expectedWorkerId}:{...query,access:"manager",workerId:q.workerId!,locationId:q.locationId!} satisfies AttendanceScopedTimesheetQuery,sourceVersion);
  if(report.asOf!==receipt.asOf||report.timeZone!==receipt.timeZone||report.rows.length!==receipt.sessionCount
    ||("scopeRevision" in report&&report.scopeRevision!==receipt.scopeRevision))fail();
  return {receipt,replayed:false as const,report};
}
export function timesheetExportFilename(c:TimesheetExportCommand){
  const {siteId,operationId,query:q}=parseTimesheetExportCommand(c);
  return `attendance-${siteId}-${q.fromDate}-${q.throughDate}-${operationId}.csv`;
}
// A metadata row is mandatory even for an empty interval. Never use an open
// session's zero contribution as its duration. All durations are exact integer
// microseconds; totals, daily rows and whole sessions are separate views.
export function buildTimesheetExportCsv(report:TimesheetExportReport,receipt:TimesheetExportReceipt){
  const administrative=report.sourceVersion==="raw-and-approved-v3";
  if(administrative)parseAttendanceTimesheetComputedResponse({...report,ok:true,moduleEnabled:false},
    {siteId:report.siteId,workerId:report.workerId,fromDate:report.fromDate,throughDate:report.throughDate},"raw-and-approved-v3");
  const rows:string[][]=[["记录类型","口径","企业日期","班次编号","字段","值","开始 UTC","结束 UTC","班次时区","起止微秒","休息微秒","带薪休息微秒","工作微秒","状态","带薪标记"]];
  const metadata:Record<string,string|number|boolean|null>={导出编号:receipt.operationId,商户:receipt.siteId,人员编号:report.workerId,当前姓名:report.workerName,当前工号:report.workerNo,
    访问范围:receipt.access,地点编号:receipt.locationId,范围版本:receipt.scopeRevision,起始日期:report.fromDate,截止日期含:report.throughDate,企业日期时区:report.timeZone,
    数据截至UTC:report.asOf,来源读取记录UTC:receipt.recordedAt,来源读取SHA256:receipt.sourceSha256,来源字节数:receipt.sourceBytes,计算版本:report.calculationVersion,
    文件格式版本:1,尚未结束班次数:report.openSessionCount,周期尚未结束:report.periodInProgress,可用于工资结算:false,
    范围说明:receipt.access==="owner"?"当前负责人可见班次":"仅当前完整授权班次；非个人完整月报；跨地点或归属不明班次可能不纳入",
    计算说明:"核定替换已批准补正，不叠加原始；工作段=起止-全部休息；带薪休息单列，不自动加回；未结束班次不估算；空白或零值不代表缺勤",
    行类型说明:"汇总、日明细、班次完整与班次区间为不同视图，不可混合累加；日明细按企业时区裁剪；班次完整可能超出查询日期",
    时间说明:"时间戳使用 UTC，保留微秒；姓名工号为当前标签，不是历史身份快照",
    记录说明:"仅记录来源读取，不证明文件保存成功；来源哈希不是 CSV 校验值、签名或冻结证明"};
  if(report.sourceVersion)metadata.来源版本=report.sourceVersion;
  if(administrative)Object.assign(metadata,{行政结案未核定班次数:report.administrativeUnassessedCount,合计完整:report.totalsComplete,
    汇总口径:"已知小计；行政结案工时未知，不计作0"});
  for(const [key,value] of Object.entries(metadata))rows.push(["元数据","","","",key,value===null?"":String(value)]);
  const amounts=(a:AttendanceSessionAmounts|null)=>a?[a.elapsedUs,a.breakUs,a.paidBreakUs,a.workedUs].map(String):["","","",""];
  for(const k of ["original","selected","difference"] as const)rows.push(["汇总",k,"","","","","","","",...amounts(report.totals[k])]);
  for(const d of report.days)for(const k of ["original","selected"] as const)rows.push(["日明细",k,d.date,"","","","","","",...amounts(d[k])]);
  for(const date of report.skippedDates)rows.push(["跳过自然日","",date,"","原因","时区历史变更；不算缺勤"]);
  for(const r of report.rows){
    for(const k of ["original","selected"] as const){
      const s=r[k],id=r.startEventId,status=administrative&&r.administrativeBoundary?"administratively_closed_unassessed":s.status;
      rows.push(["班次完整",k,"",id,"来源",r.source,s.startAt,s.endAt??"",s.timeZone,...amounts(s.totals),status]);
      rows.push(["班次区间",k,"",id,"","","","",report.timeZone,...amounts(s.endAt===null?null:k==="original"?r.originalInPeriod:r.selectedInPeriod),status]);
      for(const b of s.breaks)rows.push(["休息",k,"",id,"","",b.startAt,b.endAt,s.timeZone,"","","","","completed",String(b.paid)]);
      if(s.openBreak)rows.push(["休息",k,"",id,"","",s.openBreak.startAt,"",s.timeZone,"","","","","open",String(s.openBreak.paid)]);
    }
    for(const event of r.eventIds)rows.push(["原始动作","original","",r.startEventId,"eventId",event]);
    if(administrative)for(const [kind,proof] of [["行政结案旁证",r.administrativeBoundary],["行政前驱旁证",r.predecessorBoundary]] as const)
      if(proof)for(const [key,value] of Object.entries(proof))rows.push([kind,"original","",r.startEventId,key,String(value)]);
    if(r.correction)for(const [key,value] of Object.entries(r.correction)){
      if(key==="lineage"&&r.correction.lineage){
        for(const [field,id] of Object.entries(r.correction.lineage))rows.push(["批准来源","selected","",r.startEventId,`lineage.${field}`,id??""]);
      }else rows.push(["批准来源","selected","",r.startEventId,key,String(value)]);
    }
  }
  const csv="\ufeff"+rows.map(r=>Array.from({length:15},(_,i)=>attendanceAuditCsvCell(r[i]??"")).join(",")).join("\r\n")+"\r\n";
  if(new TextEncoder().encode(csv).byteLength>TIMESHEET_EXPORT_MAX_BYTES)fail("attendance_report_too_large");
  return csv;
}
export const TIMESHEET_EXPORT_ERRORS:Readonly<Record<string,number>>={...ATTENDANCE_TIMESHEET_ERRORS,attendance_export_denied:403,
  attendance_worker_changed:409,attendance_version_conflict:409,attendance_operation_conflict:409,attendance_report_zone_changed:409,
  attendance_invalid_content_type:415,attendance_body_too_large:413};
