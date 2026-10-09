import { attendanceManagementHttpDependencies, handleAttendanceManagementHttp, type AttendanceManagementHttpAdapter } from "@/lib/merchantAttendanceManagementHttp.server";
import { DELEGATED_GROUPS_ERRORS, DELEGATED_GROUPS_REQUEST_BYTES, DELEGATED_GROUPS_RESULT_BYTES,
  parseDelegatedGroupsBody, parseDelegatedGroupsJson, parseDelegatedGroupsQuery, parseDelegatedGroupsResult,
  type DelegatedGroupsQuery, type DelegatedGroupsResult } from "@/lib/merchantAttendanceDelegatedGroups";
import type { GroupsCommand } from "@/lib/merchantAttendanceGroups";
import { delegatedGroupsSiteEnabled, executeDelegatedGroups, readDelegatedGroupsReceipt } from "@/lib/merchantAttendanceDelegatedGroups.server";
import { MerchantAttendanceError } from "@/lib/merchantAttendanceTime";

function requestValue<T>(parse: () => T): T {
  try { return parse(); } catch { throw new MerchantAttendanceError("attendance_invalid_request"); }
}
export function parseDelegatedGroupsHttpQuery(input: string): DelegatedGroupsQuery {
  return requestValue(() => {
    const url = new URL(input), entries = [...url.searchParams];
    if (url.hash || entries.some(([key], index) => entries.findIndex(([other]) => key === other) !== index)) throw new MerchantAttendanceError("attendance_invalid_request");
    const raw: Record<string, unknown> = Object.fromEntries(entries);
    if (raw.operationId === "") raw.operationId = null;
    return parseDelegatedGroupsQuery(raw);
  });
}
const adapter: AttendanceManagementHttpAdapter<DelegatedGroupsQuery, GroupsCommand, DelegatedGroupsResult> = {
  errors: DELEGATED_GROUPS_ERRORS, invalidCode: "attendance_delegated_groups_invalid", requestBytes: DELEGATED_GROUPS_REQUEST_BYTES, resultBytes: DELEGATED_GROUPS_RESULT_BYTES,
  parseQuery: parseDelegatedGroupsHttpQuery, parseBody: text => requestValue(() => parseDelegatedGroupsBody(parseDelegatedGroupsJson(text))),
  enabled: delegatedGroupsSiteEnabled,
  execute: ({ query, command, authUserId, allowed, signal }) => {
    if (query.mode === "recover") return readDelegatedGroupsReceipt({ query, authUserId }, undefined, signal);
    if (command === null && !allowed) throw new MerchantAttendanceError("attendance_access_denied");
    //The Node adapter checks an exact saved original before the new-write gate.
    return executeDelegatedGroups({ query, command, authUserId, allowWrite: allowed }, undefined, signal);
  },
  project: parseDelegatedGroupsResult,
};
export const delegatedGroupsHttpDependencies = attendanceManagementHttpDependencies(adapter);
export function handleDelegatedGroups(request: Request, overrides: Partial<typeof delegatedGroupsHttpDependencies> = {}) {
  return handleAttendanceManagementHttp(request, adapter, delegatedGroupsHttpDependencies, overrides);
}
