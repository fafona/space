import { attendanceManagementHttpDependencies, handleAttendanceManagementHttp, type AttendanceManagementHttpAdapter } from "@/lib/merchantAttendanceManagementHttp.server";
import { DELEGATED_CONFIGURATION_ERRORS, DELEGATED_CONFIGURATION_REQUEST_BYTES, DELEGATED_CONFIGURATION_RESULT_BYTES,
  parseDelegatedConfigurationBody, parseDelegatedConfigurationJson, parseDelegatedConfigurationQuery, parseDelegatedConfigurationResult,
  type DelegatedConfigurationCommand, type DelegatedConfigurationQuery, type DelegatedConfigurationResult } from "@/lib/merchantAttendanceDelegatedConfiguration";
import { delegatedConfigurationSiteEnabled, executeDelegatedConfiguration, readDelegatedConfigurationReceipt } from "@/lib/merchantAttendanceDelegatedConfiguration.server";
import { MerchantAttendanceError } from "@/lib/merchantAttendanceTime";

function requestValue<T>(parse: () => T): T {
  try { return parse(); } catch { throw new MerchantAttendanceError("attendance_invalid_request"); }
}
export function parseDelegatedConfigurationHttpQuery(input: string): DelegatedConfigurationQuery {
  return requestValue(() => {
    const url = new URL(input), entries = [...url.searchParams];
    if (url.hash || entries.some(([key], index) => entries.findIndex(([other]) => key === other) !== index)) throw new MerchantAttendanceError("attendance_invalid_request");
    const raw: Record<string, unknown> = Object.fromEntries(entries);
    if (raw.operationId === "") raw.operationId = null;
    return parseDelegatedConfigurationQuery(raw);
  });
}
const adapter: AttendanceManagementHttpAdapter<DelegatedConfigurationQuery, DelegatedConfigurationCommand, DelegatedConfigurationResult> = {
  errors: DELEGATED_CONFIGURATION_ERRORS, invalidCode: "attendance_delegated_configuration_invalid",
  requestBytes: DELEGATED_CONFIGURATION_REQUEST_BYTES, resultBytes: DELEGATED_CONFIGURATION_RESULT_BYTES,
  parseQuery: parseDelegatedConfigurationHttpQuery, parseBody: text => requestValue(() => parseDelegatedConfigurationBody(parseDelegatedConfigurationJson(text))),
  enabled: delegatedConfigurationSiteEnabled,
  execute: ({ query, command, authUserId, allowed, signal }) => {
    if (query.mode === "recover") return readDelegatedConfigurationReceipt({ query, authUserId }, undefined, signal);
    if (command === null && !allowed) throw new MerchantAttendanceError("attendance_access_denied");
    //Original command recovery is checked by Node before the new-write gate.
    return executeDelegatedConfiguration({ query, command, authUserId, allowWrite: allowed }, undefined, signal);
  },
  project: parseDelegatedConfigurationResult,
};
export const delegatedConfigurationHttpDependencies = attendanceManagementHttpDependencies(adapter);
export function handleDelegatedConfiguration(request: Request, overrides: Partial<typeof delegatedConfigurationHttpDependencies> = {}) {
  return handleAttendanceManagementHttp(request, adapter, delegatedConfigurationHttpDependencies, overrides);
}
