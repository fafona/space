import {parseAttendanceAuditQuery,parseAttendanceAuditResult,type AttendanceAuditResult,type AttendanceAuditSource} from "./merchantAttendanceAudit";
import {attendanceRecordInstant} from "./merchantAttendanceManagement";
import {MerchantAttendanceError} from "./merchantAttendanceTime";

export const ATTENDANCE_AUDIT_EXPORT_MAX_ROWS=250;
export const ATTENDANCE_AUDIT_EXPORT_ERRORS:Readonly<Record<string,number>>={attendance_invalid_request:400,attendance_invalid_instant:400,
  attendance_access_denied:403,attendance_export_too_large:413,attendance_rate_limited:429};
export type AttendanceAuditExportQuery={siteId:string;source:AttendanceAuditSource;fromAt:string;toAt:string};
type Row=Pick<Extract<AttendanceAuditResult,{mode:"detail"}>,"item"|"before"|"after">;
export type AttendanceAuditExportResult=AttendanceAuditExportQuery&{schemaVersion:1;asOf:string;count:number;rows:Row[]};
const fail=():never=>{throw new MerchantAttendanceError("attendance_invalid_request");};
const object=(v:unknown):Record<string,unknown>=>!v||typeof v!=="object"||Array.isArray(v)?fail():v as Record<string,unknown>;
export function attendanceAuditExportQueryString(q:AttendanceAuditExportQuery){return new URLSearchParams({...q}).toString();}
export function parseAttendanceAuditExportQuery(url:string):AttendanceAuditExportQuery {
  const q=new URL(url).searchParams;
  for(const k of q.keys())if(!["siteId","source","fromAt","toAt"].includes(k)||q.getAll(k).length!==1)fail();
  q.set("mode","list");
  const value=parseAttendanceAuditQuery(`https://local.invalid/?${q}`);
  if(value.mode!=="list")return fail();
  return {siteId:value.siteId,source:value.source,fromAt:value.fromAt,toAt:value.toAt};
}
export function parseAttendanceAuditExportResult(raw:unknown,q:AttendanceAuditExportQuery):AttendanceAuditExportResult {
  const v=object(raw);
  if(v.siteId!==q.siteId||v.source!==q.source||v.schemaVersion!==1||v.fromAt!==q.fromAt||v.toAt!==q.toAt
    ||!Array.isArray(v.rows)||v.rows.length>ATTENDANCE_AUDIT_EXPORT_MAX_ROWS||v.count!==v.rows.length)fail();
  const asOf=attendanceRecordInstant(v.asOf);
  let previous:Row["item"]|null=null;
  const ids=new Set<string>();
  const rows=(v.rows as unknown[]).map(raw=>{
    const row=object(raw),item=object(row.item);
    const detail=parseAttendanceAuditResult({...row,siteId:q.siteId,source:q.source,mode:"detail"},
      {siteId:q.siteId,source:q.source,mode:"detail",operationId:typeof item.operationId==="string"?item.operationId:fail()});
    if(detail.mode!=="detail")return fail();
    const i=detail.item;
    if(i.recordedAt<q.fromAt||i.recordedAt>=q.toAt||i.recordedAt>=asOf||ids.has(i.operationId)
      ||(previous&&(i.recordedAt>previous.recordedAt||(i.recordedAt===previous.recordedAt&&i.operationId>=previous.operationId))))fail();
    previous=i;ids.add(i.operationId);
    return {item:i,before:detail.before,after:detail.after};
  });
  return {siteId:q.siteId,source:q.source,fromAt:q.fromAt,toAt:q.toAt,schemaVersion:1,asOf,count:rows.length,rows};
}
// Quote EVERY cell and neutralize formula-leading text, including whitespace.
export function attendanceAuditCsvCell(value:string):string {
  const probe=value.replace(/^[\s\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2060]+/u,"");
  const safe=/^[=+\-@]/.test(probe)||/^[\t\r\n]/.test(value)?`'${value}`:value;
  return `"${safe.replaceAll('"','""')}"`;
}
export function buildAttendanceAuditCsv(raw:AttendanceAuditExportResult){
  const q=parseAttendanceAuditExportQuery(`https://local.invalid/?${attendanceAuditExportQueryString({siteId:raw.siteId,source:raw.source,fromAt:raw.fromAt,toAt:raw.toAt})}`);
  const result=parseAttendanceAuditExportResult(raw,q);
  const kinds={settings:"考勤设置",location:"工作地点",worker:"考勤人员",grant_put:"保存主管授权",grant_remove:"撤销主管授权"};
  const header=["格式版本","企业编号","记录类型","查询起点UTC（含）","查询终点UTC（不含）","导出读取时间UTC","导出总条数",
    "操作编号","记录时间UTC","变更类型","版本","目标编号","授权对象员工编号","企业内操作人标识","当前负责人操作","修改前JSON","修改后JSON"];
  const metadata=["1",q.siteId,q.source,q.fromAt,q.toAt,result.asOf,String(result.count)];
  const records=result.rows.map(({item,before,after})=>[...metadata,item.operationId,item.recordedAt,kinds[item.kind],String(item.version),
    item.targetId??"",item.employeeId??"",item.actorRef,item.byCurrentOwner?"是":"否",JSON.stringify(before),JSON.stringify(after)]);
  // Explicit metadata even for empty ranges, without pretending it is a receipt.
  if(!records.length)records.push([...metadata,...Array<string>(10).fill("")]);
  return {filename:`attendance-audit-${q.source}-${q.siteId}-${result.asOf.slice(0,10)}.csv`,
    csv:"\ufeff"+[header,...records].map(row=>row.map(attendanceAuditCsvCell).join(",")).join("\r\n")+"\r\n",
    count:result.count,asOf:result.asOf};
}
