import { attendanceManagementHttpDependencies, handleAttendanceManagementHttp, type AttendanceManagementHttpAdapter } from "@/lib/merchantAttendanceManagementHttp.server";
import { DELEGATED_RULES_ERRORS, DELEGATED_RULES_REQUEST_BYTES, DELEGATED_RULES_RESULT_BYTES,
  parseDelegatedRulesBody, parseDelegatedRulesJson, parseDelegatedRulesQuery, parseDelegatedRulesResult,
  type DelegatedRulesQuery, type DelegatedRulesCommand, type DelegatedRulesResult } from "@/lib/merchantAttendanceDelegatedRules";
import { delegatedRulesSiteEnabled, executeDelegatedRules, readDelegatedRulesReceipt } from "@/lib/merchantAttendanceDelegatedRules.server";
import { MerchantAttendanceError } from "@/lib/merchantAttendanceTime";

function requestValue<T>(parse: () => T): T {
  try { return parse(); } catch { throw new MerchantAttendanceError("attendance_invalid_request"); }
}
export function parseDelegatedRulesHttpQuery(input: string): DelegatedRulesQuery {
  return requestValue(() => {
    const url = new URL(input), entries = [...url.searchParams];
    if (input.length > 12288 || url.hash || input.includes("#") || entries.some(([key], index) => entries.findIndex(([other]) => key === other) !== index)) throw new MerchantAttendanceError("attendance_invalid_request");
    try { decodeURIComponent(url.search.slice(1).replace(/\+/g, " ")); } catch { throw new MerchantAttendanceError("attendance_invalid_request"); }
    const raw: Record<string, unknown> = Object.fromEntries(entries);
    for (const k of ["operationId", "endsOn"]) if (raw[k] === "") raw[k] = null;
    if (Object.hasOwn(raw, "cursor")) raw.cursor = raw.cursor === "" ? null : parseDelegatedRulesJson(String(raw.cursor));
    if (Object.hasOwn(raw, "sourceDraftRevision")) raw.sourceDraftRevision = typeof raw.sourceDraftRevision === "string" && /^[1-9][0-9]*$/.test(raw.sourceDraftRevision) ? Number(raw.sourceDraftRevision) : NaN;
    return parseDelegatedRulesQuery(raw);
  });
}
const adapter: AttendanceManagementHttpAdapter<DelegatedRulesQuery, DelegatedRulesCommand, DelegatedRulesResult> = {
  errors: DELEGATED_RULES_ERRORS, invalidCode: "attendance_delegated_rules_invalid",
  //Only this new adapter opts into49KiB.204/205 retain their original limits.
  requestBytes: DELEGATED_RULES_REQUEST_BYTES, resultBytes: DELEGATED_RULES_RESULT_BYTES,
  parseQuery: parseDelegatedRulesHttpQuery, parseBody: text => requestValue(() => parseDelegatedRulesBody(parseDelegatedRulesJson(text))),
  enabled: delegatedRulesSiteEnabled,
  execute: ({ query, command, authUserId, allowed, signal }) => {
    if (query.mode === "recover") return readDelegatedRulesReceipt({ query, authUserId }, undefined, signal);
    if (command === null && !allowed) throw new MerchantAttendanceError("attendance_access_denied");
    return executeDelegatedRules({ query, command, authUserId, allowWrite: allowed }, undefined, signal);
  },
  project: parseDelegatedRulesResult,
};
export const delegatedRulesHttpDependencies = attendanceManagementHttpDependencies(adapter);
export function handleDelegatedRules(request: Request, overrides: Partial<typeof delegatedRulesHttpDependencies> = {}) {
  return handleAttendanceManagementHttp(request, adapter, delegatedRulesHttpDependencies, overrides);
}
