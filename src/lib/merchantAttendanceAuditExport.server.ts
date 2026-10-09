import {createServerSupabaseServiceClient} from "./superAdminServer";
import type {AttendanceSelfRpc} from "./merchantAttendanceSelf.server";
import {ATTENDANCE_AUDIT_EXPORT_ERRORS,parseAttendanceAuditExportResult,type AttendanceAuditExportQuery} from "./merchantAttendanceAuditExport";
import {MerchantAttendanceError} from "./merchantAttendanceTime";

export async function executeAttendanceAuditExport(input:AttendanceAuditExportQuery&{authUserId:string},service:AttendanceSelfRpc|null=createServerSupabaseServiceClient()){
  if(!service)throw new MerchantAttendanceError("attendance_unavailable");
  const result=await service.rpc("faolla_attendance_audit_export_v1",{p_site_id:input.siteId,p_auth_user_id:input.authUserId,
    p_query:{source:input.source,fromAt:input.fromAt,toAt:input.toAt}});
  if(result.error){const code=result.error.message??"";throw new MerchantAttendanceError(Object.hasOwn(ATTENDANCE_AUDIT_EXPORT_ERRORS,code)?code:"attendance_unavailable");}
  try{return parseAttendanceAuditExportResult(result.data,input);}catch{throw new MerchantAttendanceError("attendance_unavailable");}
}
// Per-process resource guard, not a claim of a distributed/global quota.
export function createAttendanceAuditExportLimiter(){
  const buckets=new Map<string,{count:number;until:number}>();
  return (id:string,now=Date.now())=>{
    if(buckets.size>=3000){for(const [key,v] of buckets)if(v.until<=now)buckets.delete(key);if(buckets.size>=3000&&!buckets.has(id))return false;}
    const v=buckets.get(id);
    if(!v||v.until<=now){buckets.set(id,{count:1,until:now+60000});return true;}
    return ++v.count<=6;
  };
}
