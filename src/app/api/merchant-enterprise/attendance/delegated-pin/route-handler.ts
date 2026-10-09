import { attendanceManagementHttpDependencies, handleAttendanceManagementHttp, type AttendanceManagementHttpAdapter } from "@/lib/merchantAttendanceManagementHttp.server";
import * as p from "@/lib/merchantAttendanceDelegatedCredentials";
import { delegatedPinSiteEnabled, executeDelegatedPin, readDelegatedPinReceipt } from "@/lib/merchantAttendanceDelegatedCredentials.server";
import { MerchantAttendanceError } from "@/lib/merchantAttendanceTime";

export type DelegatedPinHttpCommand = Readonly<{ command: p.DelegatedPinCommand; pin: string | null }>;
function requestValue<T>(run: () => T): T { try { return run(); } catch { throw new MerchantAttendanceError("attendance_invalid_request"); } }
export function parseDelegatedPinHttpQuery(input: string): p.DelegatedCredentialsQuery {
  return requestValue(() => {
    const url = new URL(input), entries = [...url.searchParams];
    if (input.length > 4096 || url.hash || input.includes("#") || entries.some(([key], i) => entries.findIndex(([other]) => key === other) !== i)) throw Error();
    decodeURIComponent(url.search.slice(1).replace(/\+/g, " "));
    const raw: Record<string, unknown> = Object.fromEntries(entries); if (raw.operationId === "") raw.operationId = null;
    return p.parseDelegatedCredentialsQuery(raw);
  });
}
const adapter: AttendanceManagementHttpAdapter<p.DelegatedCredentialsQuery, DelegatedPinHttpCommand, p.DelegatedPinResult> = {
  errors: p.DELEGATED_PIN_ERRORS, invalidCode: "attendance_delegated_pin_invalid",
  requestBytes: p.DELEGATED_CREDENTIALS_REQUEST_BYTES, resultBytes: p.DELEGATED_CREDENTIALS_RESULT_BYTES,
  parseQuery: parseDelegatedPinHttpQuery,
  parseBody: text => requestValue(() => {
    const raw = p.parseDelegatedCredentialsJson(text), command = Object.getOwnPropertyDescriptor(raw, "command")?.value;
    if (command && Object.getOwnPropertyDescriptor(command, "action")?.value === "pin_issue") {
      const b = p.parseDelegatedPinIssueEphemeralBody(raw); return { query: b.query, command: { command: b.command, pin: b.pin } };
    }
    const b = p.parseDelegatedPinBody(raw); return { query: b.query, command: { command: b.command, pin: null } };
  }),
  enabled: delegatedPinSiteEnabled,
  execute: ({ query, command, authUserId, allowed, signal }) => {
    if (query.mode === "recover") return readDelegatedPinReceipt({ query, authUserId }, undefined, signal);
    if (command === null && !allowed) throw new MerchantAttendanceError("attendance_access_denied");
    return executeDelegatedPin({ query, command: command?.command ?? null, pin: command?.pin ?? null, authUserId, allowWrite: allowed }, undefined, signal);
  },
  project: (raw, query, actor, ephemeral) => p.parseDelegatedPinResult(raw, query, actor, ephemeral?.command ?? null),
};
export const delegatedPinHttpDependencies = attendanceManagementHttpDependencies(adapter);
export function handleDelegatedPin(request: Request, overrides: Partial<typeof delegatedPinHttpDependencies> = {}) {
  return handleAttendanceManagementHttp(request, adapter, delegatedPinHttpDependencies, overrides);
}
