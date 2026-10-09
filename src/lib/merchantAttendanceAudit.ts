import {attendanceSelfSite,attendanceSelfUuid} from "./merchantAttendanceSelf";
import {attendanceRecordInstant} from "./merchantAttendanceManagement";
import {MerchantAttendanceError,attendanceTimeZone} from "./merchantAttendanceTime";

export type AttendanceAuditSource="config"|"scope";
export type AttendanceAuditKind="settings"|"location"|"worker"|"grant_put"|"grant_remove";
export type AttendanceAuditQuery={siteId:string;source:AttendanceAuditSource}&(
  {mode:"list";fromAt:string;toAt:string;asOf:string|null;cursorAt:string|null;cursorId:string|null}|
  {mode:"detail";operationId:string});
export type AttendanceAuditItem={operationId:string;recordedAt:string;kind:AttendanceAuditKind;version:number;
  targetId:string|null;employeeId:string|null;actorRef:string;byCurrentOwner:boolean};
export type AttendanceAuditValue=Record<string,string|boolean|string[]|null>;
export type AttendanceAuditResult={siteId:string;source:AttendanceAuditSource}&(
  {mode:"list";asOf:string;items:AttendanceAuditItem[];nextCursor:{recordedAt:string;operationId:string}|null}|
  {mode:"detail";item:AttendanceAuditItem;before:AttendanceAuditValue|null;after:AttendanceAuditValue|null});
const fail=():never=>{throw new MerchantAttendanceError("attendance_invalid_request");};
const object=(v:unknown):Record<string,unknown>=>!v||typeof v!=="object"||Array.isArray(v)?fail():v as Record<string,unknown>;
export function attendanceAuditQueryString(query:AttendanceAuditQuery){
  const q=new URLSearchParams();for(const [k,v] of Object.entries(query))if(v!==null)q.set(k,v);return q.toString();
}
export function parseAttendanceAuditQuery(url:string):AttendanceAuditQuery {
  const q=new URL(url).searchParams,mode=q.get("mode"),source=q.get("source");
  if(!["list","detail"].includes(mode??"")||!["config","scope"].includes(source??""))fail();
  const fields=mode==="list"?["siteId","mode","source","fromAt","toAt","asOf","cursorAt","cursorId"]:["siteId","mode","source","operationId"];
  for(const key of q.keys())if(!fields.includes(key)||q.getAll(key).length!==1)fail();
  const base={siteId:attendanceSelfSite(q.get("siteId")),source:source as AttendanceAuditSource};
  if(mode==="detail")return {...base,mode,operationId:attendanceSelfUuid(q.get("operationId"))};
  const fromAt=attendanceRecordInstant(q.get("fromAt")),toAt=attendanceRecordInstant(q.get("toAt"));
  const micros=(v:string)=>BigInt(Date.parse(`${v.slice(0,23)}Z`))*BigInt(1000)+BigInt(v.slice(23,26));
  if(toAt<=fromAt||micros(toAt)-micros(fromAt)>BigInt(2678400000000))fail();
  const asOf=q.has("asOf")?attendanceRecordInstant(q.get("asOf")):null;
  const cursorAt=q.has("cursorAt")?attendanceRecordInstant(q.get("cursorAt")):null;
  const cursorId=q.has("cursorId")?attendanceSelfUuid(q.get("cursorId")):null;
  if((cursorAt===null)!==(cursorId===null)||(cursorId&&(!asOf||cursorAt!<fromAt||cursorAt!>=toAt||cursorAt!>=asOf)))fail();
  return {...base,mode:"list",fromAt,toAt,asOf,cursorAt,cursorId};
}
function item(raw:unknown,source:AttendanceAuditSource):AttendanceAuditItem {
  const r=object(raw),kind=r.kind as AttendanceAuditKind;
  if(!(source==="config"?["settings","location","worker"]:["grant_put","grant_remove"]).includes(kind)
    ||!Number.isSafeInteger(r.version)||(r.version as number)<1||(r.version as number)>=Number.MAX_SAFE_INTEGER
    ||typeof r.actorRef!=="string"||!/^[0-9a-f]{32}$/.test(r.actorRef)||typeof r.byCurrentOwner!=="boolean")return fail();
  const targetId=r.targetId===null?null:attendanceSelfUuid(r.targetId),employeeId=r.employeeId===null?null:attendanceSelfUuid(r.employeeId);
  if((kind==="settings")!==(targetId===null)||(source==="config")!==(employeeId===null))fail();
  return {operationId:attendanceSelfUuid(r.operationId),recordedAt:attendanceRecordInstant(r.recordedAt),kind,version:r.version as number,
    targetId,employeeId,actorRef:r.actorRef,byCurrentOwner:r.byCurrentOwner};
}
function snapshot(raw:unknown,entry:AttendanceAuditItem,before:boolean):AttendanceAuditValue|null {
  if(raw===null)return null;
  const o=object(raw),kind=entry.kind;
  const keys=kind==="settings"?["timeZone","enabled","webClockEnabled","webBreakPaid"]:kind==="location"?["id","name","timeZone","active"]:
    kind==="worker"?["id","employeeId","workerNo","displayName","locationId","active","startsOn"]:["id","workerIds","locationIds","validFrom","validUntil"];
  if(Object.keys(o).length!==keys.length||keys.some(k=>!Object.hasOwn(o,k)))return fail();
  const value:AttendanceAuditValue={};
  for(const key of keys){const v=o[key];
    if(["enabled","active","webClockEnabled","webBreakPaid"].includes(key)){if(typeof v!=="boolean")return fail();value[key]=v;}
    else if(["workerIds","locationIds"].includes(key)){
      if(!Array.isArray(v)||!v.length||v.length>(key==="workerIds"?200:50))return fail();
      const ids=Array.from(v,attendanceSelfUuid);if(new Set(ids).size!==ids.length||ids.some((id,n)=>n>0&&id<=ids[n-1]))return fail();value[key]=ids;
    }else if(["id","employeeId","locationId"].includes(key)){value[key]=before&&v===null&&key!=="id"?null:attendanceSelfUuid(v);}
    else if(key==="validFrom"||key==="validUntil"){value[key]=key==="validUntil"&&v===null?null:attendanceRecordInstant(v);}
    else if(key==="startsOn"){
      if(before&&v===null)value[key]=null;
      else{if(typeof v!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(v)||v<"2000-01-01"||v>"2100-12-31"
        ||!Number.isFinite(Date.parse(`${v}T00:00:00Z`))||new Date(`${v}T00:00:00Z`).toISOString().slice(0,10)!==v)return fail();value[key]=v;}
    }else{if(typeof v!=="string"||!v.trim()||v.length>(key==="workerNo"?40:120)||/[\u0000-\u001f\u007f]/.test(v))return fail();value[key]=key==="timeZone"?attendanceTimeZone(v):v;}
  }
  if(kind!=="settings"&&value.id!==entry.targetId)fail();
  if(value.validUntil&&value.validFrom&&value.validUntil<=value.validFrom)fail();
  return value;
}
export function parseAttendanceAuditResult(raw:unknown,expected:AttendanceAuditQuery):AttendanceAuditResult {
  const o=object(raw);if(o.siteId!==expected.siteId||o.source!==expected.source||o.mode!==expected.mode)fail();
  const base={siteId:expected.siteId,source:expected.source};
  if(expected.mode==="detail"){
    const entry=item(o.item,expected.source);if(entry.operationId!==expected.operationId)fail();
    const before=snapshot(o.before,entry,true),after=snapshot(o.after,entry,false);
    if(entry.kind==="grant_remove"?(!before||after!==null):!after)fail();
    return {...base,mode:"detail",item:entry,before,after};
  }
  const asOf=attendanceRecordInstant(o.asOf);if((expected.asOf!==null&&asOf!==expected.asOf)||!Array.isArray(o.items)||o.items.length>25)fail();
  let previous=expected.cursorId?{recordedAt:expected.cursorAt!,operationId:expected.cursorId}:null;
  const items=Array.from(o.items as unknown[],r=>{const entry=item(r,expected.source);
    if(entry.recordedAt<expected.fromAt||entry.recordedAt>=expected.toAt||entry.recordedAt>=asOf
      ||(previous&&(entry.recordedAt>previous.recordedAt||(entry.recordedAt===previous.recordedAt&&entry.operationId>=previous.operationId))))fail();
    previous=entry;return entry;
  });
  if(new Set(items.map(r=>r.operationId)).size!==items.length)fail();
  let nextCursor:null|{recordedAt:string;operationId:string}=null;
  if(o.nextCursor!==null){const c=object(o.nextCursor);nextCursor={recordedAt:attendanceRecordInstant(c.recordedAt),operationId:attendanceSelfUuid(c.operationId)};
    if(items.length!==25||nextCursor.recordedAt!==items.at(-1)?.recordedAt||nextCursor.operationId!==items.at(-1)?.operationId)fail();}
  return {...base,mode:"list",asOf,items,nextCursor};
}
export const ATTENDANCE_AUDIT_ERRORS:Readonly<Record<string,number>>={attendance_invalid_request:400,attendance_invalid_instant:400,
  attendance_access_denied:403,attendance_audit_not_found:404,attendance_rate_limited:429};
