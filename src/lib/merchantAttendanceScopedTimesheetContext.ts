import {attendanceSelfSite,attendanceSelfUuid} from "./merchantAttendanceSelf";
import {attendanceRecordInstant} from "./merchantAttendanceManagement";
import {attendanceTimeZone,MerchantAttendanceError} from "./merchantAttendanceTime";
export type ScopedContextQuery={siteId:string;access:"self"|"manager";search:string;cursor:string|null;scopeRevision:number|null};
export type ScopedPair={workerId:string;workerName:string;workerNo:string;locationId:string;locationName:string};
export type ScopedContext={siteId:string;access:"self"|"manager";viewerEmployeeId:string;timeZone:string;asOf:string;accessValidUntil:string|null;scopeRevision:number|null;
  worker:{id:string;label:string;detail:string}|null;items:ScopedPair[];nextCursor:string|null};
const fail=():never=>{throw new MerchantAttendanceError("attendance_invalid_request");};
const object=(v:unknown)=>!v||typeof v!=="object"||Array.isArray(v)?fail():v as Record<string,unknown>;
const text=(v:unknown,n:number)=>typeof v==="string"&&v.trim()&&v.length<=n&&!/[\u0000-\u001f\u007f]/.test(v)?v:fail();
export const scopedPairKey=(p:Pick<ScopedPair,"workerId"|"locationId">)=>p.workerId+"."+p.locationId;
function cursor(v:unknown){if(typeof v!=="string"||v.length!==73) return fail();const a=v.split(".");if(a.length!==2)return fail();return attendanceSelfUuid(a[0])+"."+attendanceSelfUuid(a[1]);}
function revision(v:unknown){if(!Number.isSafeInteger(v)||Number(v)<1||Number(v)>9007199254740990)return fail();return Number(v);}
export function scopedContextQueryString(q:ScopedContextQuery){
  const p=new URLSearchParams({siteId:q.siteId,access:q.access});
  if(q.access==="manager"){p.set("search",q.search);if(q.cursor!==null)p.set("cursor",q.cursor);if(q.scopeRevision!==null)p.set("scopeRevision",String(q.scopeRevision));}return p.toString();
}
export function parseScopedContextQuery(url:string):ScopedContextQuery{
  const p=new URL(url).searchParams,access=p.get("access");
  if(access!=="self"&&access!=="manager")return fail();
  const allowed=access==="self"?["siteId","access"]:["siteId","access","search","cursor","scopeRevision"];
  if([...p.keys()].some(k=>!allowed.includes(k)||p.getAll(k).length!==1))return fail();
  const search=(p.get("search")??"").trim();if(search.length>80||/[\u0000-\u001f\u007f]/.test(search))return fail();
  const next=p.has("cursor")?cursor(p.get("cursor")):null,rev=p.has("scopeRevision")?revision(Number(p.get("scopeRevision"))):null;
  if((next===null)!==(rev===null))return fail();
  return {siteId:attendanceSelfSite(p.get("siteId")),access,search,cursor:next,scopeRevision:rev};
}
export function parseScopedContext(raw:unknown,q:ScopedContextQuery):ScopedContext{
  const v=object(raw);if(v.siteId!==q.siteId||v.access!==q.access||!Array.isArray(v.items)||v.items.length>25)return fail();
  const viewerEmployeeId=attendanceSelfUuid(v.viewerEmployeeId),timeZone=attendanceTimeZone(v.timeZone as string),asOf=attendanceRecordInstant(v.asOf);
  const accessValidUntil=v.accessValidUntil===null?null:attendanceRecordInstant(v.accessValidUntil);
  if(asOf!==v.asOf||(accessValidUntil!==null&&(accessValidUntil!==v.accessValidUntil||accessValidUntil<=asOf)))return fail();
  let worker:ScopedContext["worker"]=null,scopeRevision:number|null=null;
  if(q.access==="self"){const w=object(v.worker);worker={id:attendanceSelfUuid(w.id),label:text(w.label,120),detail:text(w.detail,40)};
    if(v.scopeRevision!==null||v.items.length||v.nextCursor!==null||accessValidUntil!==null)return fail();
  }else{if(v.worker!==null)return fail();scopeRevision=revision(v.scopeRevision);if(q.scopeRevision!==null&&q.scopeRevision!==scopeRevision)return fail();}
  let previous=q.cursor;
  const items=v.items.map(raw=>{const p=object(raw),pair={workerId:attendanceSelfUuid(p.workerId),workerName:text(p.workerName,120),workerNo:text(p.workerNo,40),locationId:attendanceSelfUuid(p.locationId),locationName:text(p.locationName,120)};
    const key=scopedPairKey(pair);if(previous&&key<=previous)return fail();previous=key;return pair;});
  const nextCursor=v.nextCursor===null?null:cursor(v.nextCursor);if(nextCursor&&(items.length!==25||nextCursor!==previous))return fail();
  return {siteId:q.siteId,access:q.access,viewerEmployeeId,timeZone,asOf,accessValidUntil,scopeRevision,worker,items,nextCursor};
}
