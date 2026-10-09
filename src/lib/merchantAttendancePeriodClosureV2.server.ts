import { createHash } from "node:crypto";
import { createServerSupabaseServiceClient } from "./superAdminServer";
import type { AttendanceSelfRpc } from "./merchantAttendanceSelf.server";
import { attendanceSelfUuid } from "./merchantAttendanceSelf";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { ownerNotificationsEnabled } from "./merchantAttendanceOwnerNotifications.server";
import { parseCaptureBrowserJson } from "./merchantAttendanceRuleCapturesBrowser";
import { parsePeriodClosureQuery, periodClosureFail, periodClosureObject as obj, periodClosureSame } from "./merchantAttendancePeriodClosure";
import { periodClosuresSiteEnabled, projectPeriodClosureSource } from "./merchantAttendancePeriodClosure.server";
import { PERIOD_CLOSURE_V2_ERRORS, parsePeriodClosureV2Query, parsePeriodClosureV2Command, parsePeriodClosureV2Result,
  type PeriodClosureV2Query, type PeriodClosureV2Command } from "./merchantAttendancePeriodClosureV2";

// New writes require both existing site entitlement and an explicit continuation
// rollout. Authorized saved reads/recovery and necessary owner reopening remain
// available when creation is paused, exactly as for the original period path.
export function periodClosuresV2SiteEnabled(siteId:string, env:Readonly<Record<string,string|undefined>>=process.env) {
  return env.FAOLLA_ATTENDANCE_PERIOD_CONTINUATION_ENABLED === "1" && periodClosuresSiteEnabled(siteId, env);
}
function sourceScope(q:PeriodClosureV2Query) {
  return parsePeriodClosureQuery({siteId:q.siteId,access:q.access,workerId:q.workerId,fromDate:q.fromDate,
    throughDate:q.throughDate,mode:"preview",periodId:q.periodId,operationId:null,version:null});
}
const sourceQuery=(q:PeriodClosureV2Query)=>({siteId:q.siteId,access:q.access,workerId:q.workerId,
  fromDate:q.fromDate,throughDate:q.throughDate,periodId:q.periodId});
async function rpc(service:AttendanceSelfRpc|null,name:string,args:Record<string,unknown>) {
  if(!service)throw new MerchantAttendanceError("attendance_unavailable");let response;
  try { response=await service.rpc(name,args); } catch { throw new MerchantAttendanceError("attendance_unavailable"); }
  if(response.error){const code=response.error.message??"";
    throw new MerchantAttendanceError(Object.hasOwn(PERIOD_CLOSURE_V2_ERRORS,code)?code:"attendance_unavailable");}
  return response.data;
}
export function projectPeriodClosureV2Result(raw:unknown,q:PeriodClosureV2Query,actor:string,c:PeriodClosureV2Command|null) {
  const r={...obj(raw)};
  if(r.kind==="preview") {
    const value=projectPeriodClosureSource(r.source,sourceScope(q)),period=r.period;
    delete r.source;delete r.period;
    return parsePeriodClosureV2Result({...r,preview:{...value,period}},q,{authUserId:actor},c);
  }
  if(r.kind==="detail") {
    if(r.artifact!==null) {
      if(typeof r.artifactText!=="string" || Buffer.byteLength(r.artifactText,"utf8")>2097152
        || Buffer.byteLength(r.artifactText,"utf8")!==r.artifactBytes
        || createHash("sha256").update(r.artifactText,"utf8").digest("hex")!==r.artifactSha256
        || !periodClosureSame(parseCaptureBrowserJson(r.artifactText),r.artifact))periodClosureFail();
    } else if(r.artifactText!==null || r.artifactBytes!==null || r.artifactSha256!==null)periodClosureFail();
    delete r.artifactText;delete r.artifactBytes;delete r.artifactSha256;
  }
  return parsePeriodClosureV2Result(r,q,{authUserId:actor},c);
}
export async function executePeriodClosuresV2(input:{query:PeriodClosureV2Query;command?:PeriodClosureV2Command|null;authUserId:string;moduleEnabled?:boolean},
  service:AttendanceSelfRpc|null=createServerSupabaseServiceClient()) {
  const q=parsePeriodClosureV2Query(input.query),actor=attendanceSelfUuid(input.authUserId),
    c=input.command==null?null:parsePeriodClosureV2Command(q,input.command);
  if(typeof(input.moduleEnabled??false)!=="boolean")periodClosureFail("attendance_invalid_request");
  let artifact=null;
  if(c?.action==="send") {
    // A saved operation must be recoverable without collecting the current
    // source, checking new-artifact capacity or synthesizing a replacement id.
    const recovery=parsePeriodClosureV2Query({...q,mode:"recover",operationId:c.operationId,version:null,cursor:null});
    try {
      const raw=await rpc(service,"faolla_attendance_period_closure_v2",{p_query:recovery,p_auth_user_id:actor,p_command:null,p_artifact:null,p_allow_write:false});
      const recovered=projectPeriodClosureV2Result(raw,recovery,actor,null);
      if(recovered.kind!=="detail" || !recovered.operation || !periodClosureSame(recovered.operation.command,c))periodClosureFail("attendance_operation_conflict");
      return parsePeriodClosureV2Result({...recovered,replayed:true},q,{authUserId:actor},c);
    } catch(error) { if(!(error instanceof MerchantAttendanceError)||error.code!=="attendance_operation_not_found")throw error; }
    const source=await rpc(service,"faolla_attendance_period_closure_source_v1",{p_query:sourceQuery(q),p_auth_user_id:actor});
    artifact=projectPeriodClosureSource(source,sourceScope(q)).artifact;
    if(artifact.sourceFingerprint!==c.expectedFingerprint)periodClosureFail("attendance_period_source_changed");
  }
  const ownerCapture=q.access==="self"&&c?.action==="dispute"&&ownerNotificationsEnabled(q.siteId,"capture");
  return projectPeriodClosureV2Result(await rpc(service,ownerCapture?"faolla_attendance_period_closure_owner_event_v2":"faolla_attendance_period_closure_v2",{p_query:q,p_auth_user_id:actor,p_command:c,
    p_artifact:artifact,p_allow_write:input.moduleEnabled??false,...(ownerCapture?{p_capture_owner_notifications:true}:{})}),q,actor,c);
}
