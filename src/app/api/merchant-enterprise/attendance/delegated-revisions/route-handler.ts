import { attendanceManagementHttpDependencies, handleAttendanceManagementHttp, type AttendanceManagementHttpAdapter } from "@/lib/merchantAttendanceManagementHttp.server";
import * as p from "@/lib/merchantAttendanceDelegatedRevisions";
import { delegatedRevisionsSiteEnabled, executeDelegatedRevisions, readDelegatedRevisionsReceipt } from "@/lib/merchantAttendanceDelegatedRevisions.server";
import { MerchantAttendanceError } from "@/lib/merchantAttendanceTime";

function requestValue<T>(run: () => T): T { try { return run(); } catch { throw new MerchantAttendanceError("attendance_invalid_request"); } }
export function parseDelegatedRevisionsHttpQuery(input: string): p.DelegatedRevisionsQuery {
  return requestValue(() => {
    const url = new URL(input), entries = [...url.searchParams];
    if (input.length > 4096 || url.hash || input.includes("#") || entries.some(([key], i) => entries.findIndex(([other]) => key === other) !== i)) throw Error();
    decodeURIComponent(url.search.slice(1).replace(/\+/g, " "));
    return p.parseDelegatedRevisionsQuery(Object.fromEntries(entries));
  });
}
const adapter: AttendanceManagementHttpAdapter<p.DelegatedRevisionsQuery, p.DelegatedRevisionsCommand, p.DelegatedRevisionsResult> = {
  errors: p.DELEGATED_REVISIONS_ERRORS, invalidCode: "attendance_delegated_revisions_invalid",
  requestBytes: p.DELEGATED_REVISIONS_REQUEST_BYTES, resultBytes: p.DELEGATED_REVISIONS_RESULT_BYTES,
  parseQuery: parseDelegatedRevisionsHttpQuery,
  parseBody: text => requestValue(() => p.parseDelegatedRevisionsBody(p.parseDelegatedRevisionsJson(text))),
  enabled: delegatedRevisionsSiteEnabled,
  execute: ({ query, command, authUserId, allowed, signal }) => {
    if (query.mode === "recover") return readDelegatedRevisionsReceipt({ query, authUserId }, undefined, signal);
    if (command === null && !allowed) throw new MerchantAttendanceError("attendance_access_denied");
    return executeDelegatedRevisions({ query, command, authUserId, allowWrite: allowed }, undefined, signal);
  },
  project: (raw, query, actor, command) => p.parseDelegatedRevisionsResult(raw, query, actor, command),
};
export const delegatedRevisionsHttpDependencies = attendanceManagementHttpDependencies(adapter);
export function handleDelegatedRevisions(request: Request, overrides: Partial<typeof delegatedRevisionsHttpDependencies> = {}) {
  return handleAttendanceManagementHttp(request, adapter, delegatedRevisionsHttpDependencies, overrides);
}
