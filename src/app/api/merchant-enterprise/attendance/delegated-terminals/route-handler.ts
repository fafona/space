import { attendanceManagementHttpDependencies, handleAttendanceManagementHttp, type AttendanceManagementHttpAdapter } from "@/lib/merchantAttendanceManagementHttp.server";
import * as p from "@/lib/merchantAttendanceDelegatedCredentials";
import { delegatedTerminalsSiteEnabled, executeDelegatedTerminal, readDelegatedTerminalReceipt } from "@/lib/merchantAttendanceDelegatedCredentials.server";
import { MerchantAttendanceError } from "@/lib/merchantAttendanceTime";

//HTTP-local ephemeral envelope. Only envelope.command is projected, hashed or
//persisted by callers. The secret must never appear in a receipt or error.
export type DelegatedTerminalHttpCommand = Readonly<{ command: p.DelegatedTerminalCommand; pairSecret: string | null }>;
function requestValue<T>(run: () => T): T { try { return run(); } catch { throw new MerchantAttendanceError("attendance_invalid_request"); } }
export function parseDelegatedTerminalsHttpQuery(input: string): p.DelegatedCredentialsQuery {
  return requestValue(() => {
    const url = new URL(input), entries = [...url.searchParams];
    if (input.length > 4096 || url.hash || input.includes("#") || entries.some(([key], i) => entries.findIndex(([other]) => key === other) !== i)) throw Error();
    decodeURIComponent(url.search.slice(1).replace(/\+/g, " "));
    const raw: Record<string, unknown> = Object.fromEntries(entries); if (raw.operationId === "") raw.operationId = null;
    return p.parseDelegatedCredentialsQuery(raw);
  });
}
const adapter: AttendanceManagementHttpAdapter<p.DelegatedCredentialsQuery, DelegatedTerminalHttpCommand, p.DelegatedTerminalResult> = {
  errors: p.DELEGATED_TERMINALS_ERRORS, invalidCode: "attendance_delegated_terminals_invalid",
  requestBytes: p.DELEGATED_CREDENTIALS_REQUEST_BYTES, resultBytes: p.DELEGATED_CREDENTIALS_RESULT_BYTES,
  parseQuery: parseDelegatedTerminalsHttpQuery,
  parseBody: text => requestValue(() => {
    const raw = p.parseDelegatedCredentialsJson(text), command = Object.getOwnPropertyDescriptor(raw, "command")?.value;
    if (command && Object.getOwnPropertyDescriptor(command, "action")?.value === "terminal_prepare") {
      const b = p.parseDelegatedTerminalPrepareEphemeralBody(raw); return { query: b.query, command: { command: b.command, pairSecret: b.pairSecret } };
    }
    const b = p.parseDelegatedTerminalBody(raw); return { query: b.query, command: { command: b.command, pairSecret: null } };
  }),
  enabled: delegatedTerminalsSiteEnabled,
  execute: ({ query, command, authUserId, allowed, signal }) => {
    if (query.mode === "recover") return readDelegatedTerminalReceipt({ query, authUserId }, undefined, signal);
    if (command === null && !allowed) throw new MerchantAttendanceError("attendance_access_denied");
    return executeDelegatedTerminal({ query, command: command?.command ?? null, pairSecret: command?.pairSecret ?? null, authUserId, allowWrite: allowed }, undefined, signal);
  },
  project: (raw, query, actor, ephemeral) => p.parseDelegatedTerminalResult(raw, query, actor, ephemeral?.command ?? null),
};
export const delegatedTerminalsHttpDependencies = attendanceManagementHttpDependencies(adapter);
export function handleDelegatedTerminals(request: Request, overrides: Partial<typeof delegatedTerminalsHttpDependencies> = {}) {
  return handleAttendanceManagementHttp(request, adapter, delegatedTerminalsHttpDependencies, overrides);
}
