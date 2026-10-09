import { createServerSupabaseServiceClient } from "./superAdminServer";
import type { AttendanceSelfRpc } from "./merchantAttendanceSelf.server";
import { attendanceSelfUuid } from "./merchantAttendanceSelf";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { parseOwnerBacklogQuery, parseOwnerBacklogResult, OWNER_BACKLOG_ERRORS, type OwnerBacklogQuery } from "./merchantAttendanceOwnerBacklog";
export type OwnerBacklogInput = { query: OwnerBacklogQuery; authUserId: string };
export async function executeOwnerBacklog(input: OwnerBacklogInput, service: AttendanceSelfRpc | null = createServerSupabaseServiceClient()) {
  const query = parseOwnerBacklogQuery(input.query), { siteId, ...rpcQuery } = query;
  const authUserId = attendanceSelfUuid(input.authUserId);
  if (!service) throw new MerchantAttendanceError("attendance_unavailable");
  let response;
  try { response = await service.rpc("faolla_attendance_owner_backlog_v1", { p_site_id: siteId, p_auth_user_id: authUserId, p_query: rpcQuery }); }
  catch { throw new MerchantAttendanceError("attendance_unavailable"); }
  if (response.error) {
    const code = response.error.message ?? "";
    throw new MerchantAttendanceError(Object.hasOwn(OWNER_BACKLOG_ERRORS, code) ? code : "attendance_unavailable");
  }
  try {
    const result = parseOwnerBacklogResult(response.data, query);
    if (result.ownerId !== authUserId) throw Error("owner_response_mismatch");
    return result;
  } catch { throw new MerchantAttendanceError("attendance_unavailable"); }
}
