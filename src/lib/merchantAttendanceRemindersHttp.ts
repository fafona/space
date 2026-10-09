//201 Auth-only HTTP wire. System-run inputs and actor claims have no variant here.
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { captureBrowserExact as exact } from "./merchantAttendanceRuleCapturesBrowser";
import { operationalRuleLedgerFreeze as freeze } from "./merchantAttendanceOperationalRuleLedger";
import { ATTENDANCE_REMINDER_REQUEST_BYTES, ATTENDANCE_REMINDER_RESULT_BYTES, assertAttendanceReminderTree,
  parseAttendanceReminderJson, parseAttendanceReminderQuery, parseAttendanceReminderCommand, parseAttendanceReminderBody,
  parseAttendanceReminderResult, type AttendanceReminderQuery, type AttendanceReminderCommand, type AttendanceReminderResult } from "./merchantAttendanceReminders";

export const ATTENDANCE_REMINDERS_API = "/api/merchant-enterprise/attendance/reminders";
export const ATTENDANCE_REMINDER_HTTP_URL_LIMIT = 32768;
export type AttendanceReminderHttpRead = Readonly<
  { query: Extract<AttendanceReminderQuery, { mode: "recover" }>; expectedCommand: AttendanceReminderCommand }
  | { query: Exclude<AttendanceReminderQuery, { mode: "recover" }>; expectedCommand: null }
>;
const invalid = (): never => { throw new MerchantAttendanceError("attendance_invalid_request"); };
export function parseAttendanceReminderHttpRead(raw: unknown): AttendanceReminderHttpRead {
  try {
    assertAttendanceReminderTree(raw, "request"); const v = exact(raw, ["query", "expectedCommand"]), query = parseAttendanceReminderQuery(v.query);
    if (query.mode === "recover") { const expectedCommand = parseAttendanceReminderCommand(v.expectedCommand); if (query.operationId !== expectedCommand.operationId) return invalid(); return freeze({ query, expectedCommand }); }
    if (v.expectedCommand !== null) return invalid(); return freeze({ query, expectedCommand: null });
  } catch { return invalid(); }
}
export function parseAttendanceReminderHttpQuery(input: string | URL): AttendanceReminderHttpRead {
  try {
    const text = String(input); if (text.length > ATTENDANCE_REMINDER_HTTP_URL_LIMIT || text.includes("#")) return invalid();
    const url = new URL(text); if (url.hash || url.username || url.password) return invalid();
    // URLSearchParams replaces malformed UTF8. Reject it before that permissive
    // decoder can normalize a different request into this exact query.
    decodeURIComponent(url.search.slice(1).replace(/\+/g, " "));
    const entries = [...url.searchParams]; if (entries.length !== 1 || entries[0][0] !== "request") return invalid();
    const json = entries[0][1]; if (new TextEncoder().encode(json).byteLength > ATTENDANCE_REMINDER_REQUEST_BYTES) return invalid();
    return parseAttendanceReminderHttpRead(parseAttendanceReminderJson(json));
  } catch { return invalid(); }
}
export function attendanceReminderHttpQueryString(raw: AttendanceReminderHttpRead): string {
  const input = parseAttendanceReminderHttpRead(raw), text = JSON.stringify(input);
  if (new TextEncoder().encode(text).byteLength > ATTENDANCE_REMINDER_REQUEST_BYTES) return invalid();
  return new URLSearchParams({ request: text }).toString();
}
export function parseAttendanceReminderHttpBodyJson(text: string) { return parseAttendanceReminderBody(parseAttendanceReminderJson(text)); }
/** Success envelope includes its overhead in the same 128KiB bound. Results
 * are detached and SHA-verified again at the final Auth HTTP boundary. */
export async function parseAttendanceReminderHttpEnvelope(raw: unknown, query: AttendanceReminderQuery, actualActorId: string,
  expectedCommand: AttendanceReminderCommand | null = null): Promise<Readonly<{ ok: true; data: AttendanceReminderResult }>> {
  try {
    assertAttendanceReminderTree(raw); const v = exact(raw, ["ok", "data"]);
    if (v.ok !== true || new TextEncoder().encode(JSON.stringify(raw)).byteLength > ATTENDANCE_REMINDER_RESULT_BYTES) throw Error();
    return freeze({ ok: true as const, data: await parseAttendanceReminderResult(v.data, query, actualActorId, expectedCommand) });
  } catch { throw new MerchantAttendanceError("attendance_reminder_invalid"); }
}
