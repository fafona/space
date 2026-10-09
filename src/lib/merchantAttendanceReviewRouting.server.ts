import { createServerSupabaseServiceClient } from "./superAdminServer";
import type { AttendanceSelfRpc } from "./merchantAttendanceSelf.server";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { REVIEW_ROUTING_ERRORS, parseReviewRoutingQuery, parseReviewRoutingBody, parseReviewRoutingResult, type ReviewRoutingQuery, type ReviewRoutingCommand } from "./merchantAttendanceReviewRouting";
export type ReviewRoutingServiceInput={query:ReviewRoutingQuery;command:ReviewRoutingCommand|null;authUserId:string;allowWrite:boolean};
export function reviewRoutingEnabled(siteId:string,env:Readonly<Record<string,string|undefined>>=process.env):boolean{
  if(!/^[0-9]{8}$/.test(siteId)||siteId.length!==8||env.FAOLLA_ATTENDANCE_REVIEW_ROUTING_ENABLED!=="1")return false;
  const raw=env.FAOLLA_ATTENDANCE_REVIEW_ROUTING_SITE_IDS;if(typeof raw!=="string"||raw.length>899)return false;
  const ids=raw.split(",");return ids.length<=100&&new Set(ids).size===ids.length&&ids.every(id=>id.length===8&&/^[0-9]{8}$/.test(id))&&ids.includes(siteId);
}
export async function executeReviewRouting(input:ReviewRoutingServiceInput,service:AttendanceSelfRpc|null=createServerSupabaseServiceClient()){
  const query=parseReviewRoutingQuery(input.query),command=input.command===null?null:parseReviewRoutingBody({query,command:input.command}).command,auth=input.authUserId;
  if(typeof input.allowWrite!=="boolean"||typeof auth!=="string"||auth.length!==36||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(auth))throw new MerchantAttendanceError("attendance_invalid_request");
  if(!service)throw new MerchantAttendanceError("attendance_review_routing_invalid");
  let response;try{response=await service.rpc("faolla_attendance_review_routing_v1",{p_query:query,p_auth_user_id:auth,p_command:command,p_allow_write:input.allowWrite});}catch{throw new MerchantAttendanceError("attendance_review_routing_invalid");}
  if(response.error){const code=response.error.message??"";throw new MerchantAttendanceError(Object.hasOwn(REVIEW_ROUTING_ERRORS,code)?code:"attendance_review_routing_invalid");}
  return parseReviewRoutingResult(response.data,query,auth,command);
}
