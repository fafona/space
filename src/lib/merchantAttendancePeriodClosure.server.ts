import { createHash } from "node:crypto";
import { createServerSupabaseServiceClient } from "./superAdminServer";
import type { AttendanceSelfRpc } from "./merchantAttendanceSelf.server";
import { attendanceSelfUuid } from "./merchantAttendanceSelf";
import { parsePeriodClosureSourceReport, parsePeriodDelegatedSourceReport } from "./merchantAttendancePeriodClosureSourceReport";
import { parseCaptureBrowserJson } from "./merchantAttendanceRuleCapturesBrowser";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { ownerNotificationsEnabled } from "./merchantAttendanceOwnerNotifications.server";
import { periodAdministrativeHoursUnassessed } from "./merchantAttendancePeriodAdministrativeContext";
import { PERIOD_CLOSURE_ERRORS, parsePeriodClosureQuery, parsePeriodClosureCommand, parsePeriodClosureArtifact, parseCompletePeriodClosureSourceArtifact, parsePeriodDelegatedArtifactDraft,
  parsePeriodClosureResult, periodClosureFail, periodClosureObject as obj, periodClosureSame,
  type PeriodClosureQuery, type PeriodClosureCommand } from "./merchantAttendancePeriodClosure";

export function periodClosuresSiteEnabled(siteId:string,env:Readonly<Record<string,string|undefined>>=process.env){
  const raw=env.FAOLLA_ATTENDANCE_PERIOD_CLOSURES_SITE_IDS;
  if(env.FAOLLA_ATTENDANCE_PERIOD_CLOSURES_ENABLED!=="1"||!/^\d{8}$/.test(siteId)||typeof raw!=="string"||raw.length>4096)return false;
  const sites=raw.split(",").map(s=>s.trim());return sites.length<=100&&sites.every(s=>/^\d{8}$/.test(s))&&sites.includes(siteId);
}
// Only the period identity crosses this boundary. The155 collector loads saved
// UTC/day boundaries after current authorization; callers cannot supply them.
const sourceQuery=(q:PeriodClosureQuery)=>({siteId:q.siteId,access:q.access,workerId:q.workerId,fromDate:q.fromDate,throughDate:q.throughDate,periodId:q.periodId});
// Must match148's explicit access-only whitelist. Bind the saved canonical
// material to the actual raw report; a self-consistent hash alone is not enough.
function canonicalSource(v:Record<string,unknown>){
  const report={...obj(v.report)},base={...obj(report.base)};
  for(const k of ["asOf","access","viewerEmployeeId","scopeRevision","locationId","coverage","accessValidUntil"])delete base[k];
  if(!Array.isArray(base.items)||!Array.isArray(report.missing))periodClosureFail();
  base.items=(base.items as unknown[]).map(raw=>{const item={...obj(raw)};if(!Array.isArray(item.events))periodClosureFail();
    item.events=(item.events as unknown[]).map(raw=>{const event={...obj(raw)};delete event.actorEmployeeId;return event;});return item;});
  report.base=base;report.missing=(report.missing as unknown[]).map(raw=>({...obj(raw),employeeId:v.employeeId}));delete report.access;
  return {...Object.fromEntries(["sourceVersion","siteId","workerId","employeeId","employeeAuthUserId","timeZone","fromDate","throughDate","fromAt","toAt","dayBoundaries","context"].map(k=>[k,v[k]])),report};
}
function checkedSource(raw:unknown,q:{siteId:string;workerId:string;fromDate:string;throughDate:string}){
  const v=obj(raw),source=obj(v.sourceCanonical),wire=obj(v.report),base=obj(wire.base);
  if(!["attendance-period-source-v1","attendance-period-source-v2","attendance-period-source-v3","attendance-period-source-v4","attendance-period-source-v5"].includes(String(v.sourceVersion))||v.complete!==true||v.siteId!==q.siteId||v.workerId!==q.workerId
    ||v.fromDate!==q.fromDate||v.throughDate!==q.throughDate||!Array.isArray(v.blockers)||v.blockers.length>30
    ||v.blockers.some(x=>typeof x!=="string"||!/^[a-z_]{1,100}$/.test(x))||new Set(v.blockers).size!==v.blockers.length
    ||typeof v.sourceText!=="string"||Buffer.byteLength(v.sourceText,"utf8")>1048576
    ||Buffer.byteLength(JSON.stringify(v),"utf8")>4194304
    ||createHash("sha256").update(v.sourceText,"utf8").digest("hex")!==v.sourceFingerprint
    ||!periodClosureSame(parseCaptureBrowserJson(v.sourceText),source)||!periodClosureSame(canonicalSource(v),source))periodClosureFail();
  return {v,source,wire,base};
}
function checkedBlockers(artifact:{source:Record<string,unknown>},v:Record<string,unknown>){
  if(Buffer.byteLength(JSON.stringify(artifact),"utf8")>2097152)periodClosureFail("attendance_period_source_too_large");
  const outages=obj(artifact.source.context).outages;
  const unresolved=Array.isArray(outages)&&outages.some(item=>obj(obj(item).status).resolved!==true);
  if(unresolved!==(v.blockers as string[]).includes("unresolved_outage"))periodClosureFail();
  if(periodAdministrativeHoursUnassessed(artifact.source)!==(v.blockers as string[]).includes("administrative_hours_unassessed"))periodClosureFail();
  return v.blockers as string[];
}
function projectClosureSource(raw:unknown,q:PeriodClosureQuery,completeSource:boolean){
  const {v,source,wire,base}=checkedSource(raw,q);
  const report=parsePeriodClosureSourceReport(wire,{siteId:q.siteId,access:q.access,workerId:q.workerId,
    employeeId:attendanceSelfUuid(v.employeeId),employeeAuthUserId:attendanceSelfUuid(v.employeeAuthUserId),
    fromDate:q.fromDate,throughDate:q.throughDate,timeZone:v.timeZone,fromAt:v.fromAt,toAt:v.toAt,dayBoundaries:v.dayBoundaries},v.sourceVersion==="attendance-period-source-v5");
  const parseArtifact=completeSource?parseCompletePeriodClosureSourceArtifact:parsePeriodClosureArtifact;
  const artifact=parseArtifact({protocol:"attendance-period-artifact-v1",sourceFingerprint:v.sourceFingerprint,source,
    worker:{workerId:q.workerId,employeeId:attendanceSelfUuid(v.employeeId),employeeAuthUserId:attendanceSelfUuid(v.employeeAuthUserId),workerName:base.workerName,workerNo:base.workerNo},
    period:{fromDate:q.fromDate,throughDate:q.throughDate,timeZone:v.timeZone,startAt:v.fromAt,endAt:v.toAt},report,
    dayBoundaries:v.dayBoundaries,calculationVersion:"timesheet-v2-unified-v1"});
  return {artifact,blockers:checkedBlockers(artifact,v)};
}
export function projectPeriodClosureSource(raw:unknown,q:PeriodClosureQuery){return projectClosureSource(raw,q,false);}
// Explicit complete-event profile for199. Existing period reads/writes and
// all saved-archive consumers keep the original default validation profile.
export function projectCompletePeriodClosureSource(raw:unknown,q:PeriodClosureQuery){return projectClosureSource(raw,q,true);}
/** Dedicated delegate boundary: neither authorization markers nor the real
 * report access are rewritten to owner/self. SQL187 supplies saved authority. */
export function projectPeriodDelegatedSource(raw:unknown,q:{siteId:string;workerId:string;fromDate:string;throughDate:string;periodId?:string|null}){
  const {v,source,wire,base}=checkedSource(raw,q);
  if(v.validation!=="delegate_checked"||wire.access!=="delegate")periodClosureFail();
  if(q.periodId!==undefined&&q.periodId!==null)attendanceSelfUuid(q.periodId);
  const report=parsePeriodDelegatedSourceReport(wire,{siteId:q.siteId,access:"delegate",workerId:q.workerId,
    employeeId:attendanceSelfUuid(v.employeeId),employeeAuthUserId:attendanceSelfUuid(v.employeeAuthUserId),
    fromDate:q.fromDate,throughDate:q.throughDate,timeZone:v.timeZone,fromAt:v.fromAt,toAt:v.toAt,dayBoundaries:v.dayBoundaries},v.sourceVersion==="attendance-period-source-v5");
  const artifact=parsePeriodDelegatedArtifactDraft({protocol:"attendance-period-artifact-v2",sourceFingerprint:v.sourceFingerprint,source,
    worker:{workerId:q.workerId,employeeId:attendanceSelfUuid(v.employeeId),employeeAuthUserId:attendanceSelfUuid(v.employeeAuthUserId),workerName:base.workerName,workerNo:base.workerNo},
    period:{fromDate:q.fromDate,throughDate:q.throughDate,timeZone:v.timeZone,startAt:v.fromAt,endAt:v.toAt},report,
    dayBoundaries:v.dayBoundaries,calculationVersion:"timesheet-v2-unified-v1"});
  return {artifact,blockers:checkedBlockers(artifact,v)};
}
async function rpc(service:AttendanceSelfRpc|null,name:string,args:Record<string,unknown>){
  if(!service)throw new MerchantAttendanceError("attendance_unavailable");let response;
  try{response=await service.rpc(name,args);}catch{throw new MerchantAttendanceError("attendance_unavailable");}
  if(response.error){const code=response.error.message??"";throw new MerchantAttendanceError(Object.hasOwn(PERIOD_CLOSURE_ERRORS,code)?code:"attendance_unavailable");}return response.data;
}
function project(raw:unknown,q:PeriodClosureQuery,actor:string,c:PeriodClosureCommand|null){const r={...obj(raw)};
  if(r.kind==="preview"){const value=projectPeriodClosureSource(r.source,q);const period=r.period;delete r.source;delete r.period;return parsePeriodClosureResult({...r,preview:{...value,period}},q,{authUserId:actor},c);}
  if(r.kind==="detail"&&r.artifact!==null){if(typeof r.artifactText!=="string"||Buffer.byteLength(r.artifactText,"utf8")>2097152
    ||Buffer.byteLength(r.artifactText,"utf8")!==r.artifactBytes||createHash("sha256").update(r.artifactText,"utf8").digest("hex")!==r.artifactSha256
    ||!periodClosureSame(parseCaptureBrowserJson(r.artifactText),r.artifact))periodClosureFail();}
  delete r.artifactText;delete r.artifactBytes;delete r.artifactSha256;
  return parsePeriodClosureResult(r,q,{authUserId:actor},c);
}
export async function executePeriodClosures(input:{query:PeriodClosureQuery;command?:PeriodClosureCommand|null;authUserId:string;moduleEnabled?:boolean},service:AttendanceSelfRpc|null=createServerSupabaseServiceClient()){
  const q=parsePeriodClosureQuery(input.query),actor=attendanceSelfUuid(input.authUserId),c=input.command==null?null:parsePeriodClosureCommand(q,input.command);
  if(typeof(input.moduleEnabled??false)!=="boolean")periodClosureFail("attendance_invalid_request");
  let artifact=null;
  if(c?.action==="send"){
    // Recovery comes before source collection, pause or new-state validation.
    // A completed operation must not become unrecoverable when sources change.
    const recovery={...q,mode:"recover" as const,operationId:c.operationId};
    try{const raw=await rpc(service,"faolla_attendance_period_closure_v1",{p_query:recovery,p_auth_user_id:actor,p_command:null,p_artifact:null,p_allow_write:false});
      const recovered=project(raw,recovery,actor,null);if(recovered.kind!=="detail"||!recovered.operation||!periodClosureSame(recovered.operation.command,c))periodClosureFail("attendance_operation_conflict");
      return parsePeriodClosureResult({...recovered,replayed:true},q,{authUserId:actor},c);
    }catch(error){if(!(error instanceof MerchantAttendanceError)||error.code!=="attendance_operation_not_found")throw error;}
    const source=await rpc(service,"faolla_attendance_period_closure_source_v1",{p_query:sourceQuery(q),p_auth_user_id:actor});
    artifact=projectPeriodClosureSource(source,q).artifact;
    if(artifact.sourceFingerprint!==c.expectedFingerprint)periodClosureFail("attendance_period_source_changed");
  }
  const ownerCapture=q.access==="self"&&c?.action==="dispute"&&ownerNotificationsEnabled(q.siteId,"capture");
  return project(await rpc(service,ownerCapture?"faolla_attendance_period_closure_owner_event_v1":"faolla_attendance_period_closure_v1",{p_query:q,p_auth_user_id:actor,p_command:c,p_artifact:artifact,p_allow_write:input.moduleEnabled??false,
    ...(ownerCapture?{p_capture_owner_notifications:true}:{})}),q,actor,c);
}
