// Only for the ownership-checked synthetic attendance database. Authentication
// and the outer shell remain synthetic; attendance replies use the actual SQL.
import assert from "node:assert/strict";
import { createAttendanceDatabaseTransport, databaseActors, databaseId } from "./attendance-database-transport";
import { missingQueryString, parseMissingBody, parseMissingQuery, type MissingQuery } from "../../src/lib/merchantAttendanceMissing";
import { parseOnsiteClaims } from "../../src/lib/merchantAttendanceOnsiteQr";
import { parsePinClockRequest } from "../../src/lib/merchantAttendancePinClock";

export { createAttendanceDatabaseTransport, databaseActors, databaseId };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const isUuid = (value: unknown): value is string => typeof value === "string" && uuid.test(value);
const isHash = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
const integer = (value: unknown, min: number, max = Number.MAX_SAFE_INTEGER): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;
const exact = (value: unknown, keys: readonly string[]): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const literal = (value: unknown) => value === null ? "null" : "'" + String(value).replaceAll("'", "''") + "'";
const snapshot = (value: unknown): unknown => JSON.parse(JSON.stringify(value));
const json = (value: unknown) => value === null ? "null" : literal(JSON.stringify(value)) + "::jsonb";

// Own-property lookup is required: inherited names such as constructor must
// never become SQL identifiers. The singular scope/choice_labels RPCs do not
// exist: both choices routes call choices_v1 with different exact query shapes.
const parameters = Object.freeze({
  faolla_attendance_self_v1: ["p_site_id", "p_auth_user_id", "p_command", "p_operation_id"],
  faolla_attendance_admin_v1: ["p_site_id", "p_auth_user_id", "p_query", "p_command", "p_operation_id"],
  faolla_attendance_self_history_v1: ["p_site_id", "p_auth_user_id", "p_query"],
  faolla_attendance_self_session_v1: ["p_site_id", "p_auth_user_id", "p_start_event_id"],
  faolla_attendance_correction_self_v3: ["p_site_id", "p_auth_user_id", "p_query", "p_command", "p_platform_enabled"],
  faolla_attendance_correction_owner_review_v3: ["p_site_id", "p_auth_user_id", "p_query"],
  faolla_attendance_correction_decide_v2: ["p_site_id", "p_auth_user_id", "p_request_id", "p_command", "p_operation_id", "p_allow_write"],
  faolla_attendance_revision_self_v2: ["p_site_id", "p_auth_user_id", "p_query", "p_command", "p_platform_enabled"],
  faolla_attendance_revision_owner_review_v3: ["p_site_id", "p_auth_user_id", "p_request_id"],
  faolla_attendance_revision_decide_v2: ["p_site_id", "p_auth_user_id", "p_request_id", "p_command", "p_operation_id", "p_allow_write"],
  faolla_attendance_revision_history_v1: ["p_site_id", "p_auth_user_id", "p_query"],
  faolla_attendance_period_report_v2: ["p_site_id", "p_auth_user_id", "p_query"],
  faolla_attendance_scoped_period_report_v2: ["p_site_id", "p_auth_user_id", "p_query"],
  faolla_attendance_scoped_report_context_v1: ["p_site_id", "p_auth_user_id", "p_query"],
  faolla_attendance_period_export_v2: ["p_site_id", "p_auth_user_id", "p_operation_id", "p_query"],
  faolla_attendance_missing_v1: ["p_query", "p_auth_user_id", "p_command", "p_allow_write"],
  faolla_attendance_unified_report_v1: ["p_site_id", "p_auth_user_id", "p_query"],
  faolla_attendance_unified_export_v1: ["p_site_id", "p_auth_user_id", "p_operation_id", "p_query"],
  faolla_attendance_terminal_admin_v1: ["p_site", "p_auth", "p_query", "p_command", "p_allow_create"],
  faolla_attendance_terminal_device_v1: ["p_site", "p_id", "p_secret_hash", "p_device_hash", "p_allow_pair"],
  faolla_attendance_onsite_issue_v1: ["p_site", "p_terminal", "p_secret_hash"],
  faolla_attendance_onsite_clock_v1: ["p_site", "p_auth", "p_claims", "p_command", "p_operation", "p_allow_new"],
  faolla_attendance_pin_admin_v1: ["p_site", "p_auth", "p_no", "p_operation", "p_command", "p_allow_set"],
  faolla_attendance_pin_begin_v1: ["p_site", "p_terminal", "p_secret_hash", "p_no", "p_lease", "p_allow"],
  faolla_attendance_pin_finish_v1: ["p_site", "p_terminal", "p_secret_hash", "p_no", "p_lease", "p_verified", "p_allow"],
  faolla_attendance_pin_clock_v1: ["p_site", "p_terminal", "p_secret_hash", "p_no", "p_lease", "p_verified", "p_request", "p_allow_new"],
  faolla_attendance_audit_v1: ["p_site_id", "p_auth_user_id", "p_query"],
  faolla_attendance_audit_export_v1: ["p_site_id", "p_auth_user_id", "p_query"],
  faolla_attendance_scopes_v1: ["p_site_id", "p_auth_user_id", "p_employee_id", "p_command", "p_operation_id"],
  faolla_attendance_choices_v1: ["p_site_id", "p_auth_user_id", "p_query"],
  faolla_attendance_correction_controls_v2: ["p_site_id", "p_auth_user_id", "p_command", "p_operation_id", "p_before_revision", "p_allow_write"],
  faolla_attendance_location_policy_draft_v1: ["p_site_id", "p_auth_user_id", "p_location_id", "p_command", "p_operation_id", "p_allow_write"],
  faolla_attendance_location_setup_v1: ["p_site_id", "p_auth_user_id", "p_location_id", "p_command", "p_operation_id", "p_allow_prepare"],
  faolla_attendance_location_notice_v1: ["p_site_id", "p_auth_user_id", "p_query", "p_command", "p_allow_publish"],
  faolla_attendance_self_context_v1: ["p_site_id", "p_auth_user_id"],
  faolla_attendance_location_clock_v2: ["p_site_id", "p_auth_user_id", "p_expected_worker_id", "p_command", "p_operation_id", "p_assertion", "p_allow_new_sessions", "p_require_clock"],
  faolla_attendance_location_reviews_v1: ["p_site_id", "p_auth_user_id", "p_query", "p_command"],
  faolla_attendance_location_discussion_v1: ["p_site_id", "p_auth_user_id", "p_query", "p_command"],
} satisfies Record<string, readonly string[]>);

function instantMicros(value: unknown): bigint | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}(?:\d{3})?Z$/.test(value)) return null;
  const millis = `${value.slice(0, 23)}Z`, epoch = Date.parse(millis);
  if (!Number.isFinite(epoch) || new Date(epoch).toISOString() !== millis) return null;
  return BigInt(epoch) * BigInt(1000) + BigInt(value.length === 27 ? value.slice(23, 26) : 0);
}

function validExceptionRange(query: Record<string, unknown>): boolean {
  const from = instantMicros(query.fromAt), to = instantMicros(query.toAt);
  const asOf = query.asOf === null ? null : instantMicros(query.asOf);
  const cursor = query.cursorAt === null ? null : instantMicros(query.cursorAt);
  return from !== null && to !== null && to > from && to - from <= BigInt(2678400000000)
    && (query.asOf === null || asOf !== null)
    && (query.cursorId === null && query.cursorAt === null
      || isUuid(query.cursorId) && cursor !== null && asOf !== null && cursor >= from && cursor < to && cursor < asOf);
}

function validExceptionNote(value: unknown): boolean {
  return typeof value === "string" && value.length > 0 && value === value.trim()
    && Array.from(value).length <= 500 && !/[\u0000-\u001f\u007f]/.test(value);
}

function validCorrectionReason(value: unknown): boolean {
  return validExceptionNote(value) && !/[\u0080-\u009f]/.test(value as string);
}

function validCorrectionProposal(value: unknown): boolean {
  if (!exact(value, ["startAt", "endAt", "breaks"]) || !Array.isArray(value.breaks) || value.breaks.length > 32) return false;
  const start = instantMicros(value.startAt), end = instantMicros(value.endAt);
  if (start === null || end === null || end <= start || end - start > BigInt(2678400000000)) return false;
  let previous = start;
  for (const item of value.breaks) {
    if (!exact(item, ["startAt", "endAt", "paid"]) || typeof item.paid !== "boolean") return false;
    const from = instantMicros(item.startAt), to = instantMicros(item.endAt);
    if (from === null || to === null || from < previous || to <= from || to > end) return false;
    previous = to;
  }
  return true;
}

function validCorrectionQuery(query: unknown): boolean {
  if (!query || typeof query !== "object" || Array.isArray(query)) return false;
  const value = query as Record<string, unknown>;
  if (!isUuid(value.expectedWorkerId)) return false;
  if (value.mode === "prepare") return exact(value, ["mode", "expectedWorkerId", "startEventId"]) && isUuid(value.startEventId);
  if (value.mode === "detail") return exact(value, ["mode", "expectedWorkerId", "requestId", "operationId"])
    && isUuid(value.requestId) && (value.operationId === null || isUuid(value.operationId));
  return value.mode === "list" && exact(value, ["mode", "expectedWorkerId", "cursorAt", "cursorId"])
    && (value.cursorAt === null && value.cursorId === null || instantMicros(value.cursorAt) !== null && isUuid(value.cursorId));
}

function validCorrectionReviewQuery(query: unknown): boolean {
  if (exact(query, ["mode", "requestId"]) && query.mode === "detail") return isUuid(query.requestId);
  if (!exact(query, ["mode", "fromAt", "toAt", "workerId", "status", "asOf", "cursorAt", "cursorId"])
    || query.mode !== "list" || query.workerId !== null && !isUuid(query.workerId)
    || typeof query.status !== "string" || !["all", "submitted", "withdrawn"].includes(query.status)) return false;
  const from = instantMicros(query.fromAt), to = instantMicros(query.toAt), asOf = instantMicros(query.asOf), cursor = instantMicros(query.cursorAt);
  return from !== null && to !== null && to > from && to - from <= BigInt(2678400000000)
    && from >= BigInt(946684800000000) && to <= BigInt(4133980800000000)
    && (query.asOf === null || asOf !== null)
    && (query.cursorAt === null && query.cursorId === null
      || cursor !== null && isUuid(query.cursorId) && asOf !== null && cursor >= from && cursor < to && cursor <= asOf);
}

function validRevisionQuery(query: unknown): boolean {
  return exact(query, ["mode", "expectedWorkerId", "baseRequestId", "requestId", "operationId"])
    && isUuid(query.expectedWorkerId) && isUuid(query.baseRequestId)
    && (query.mode === "prepare" && query.requestId === null && query.operationId === null
      || query.mode === "detail" && isUuid(query.requestId) && (query.operationId === null || isUuid(query.operationId)));
}

function validRevisionHistoryQuery(query: unknown): boolean {
  if (!query || typeof query !== "object" || Array.isArray(query)) return false;
  const value = query as Record<string, unknown>, owner = value.access === "owner";
  if (!(owner || value.access === "self")
    || !exact(value, ["access", "scope", "status", "asOf", "cursorAt", "cursorId", ...(owner ? ["fromAt", "toAt"] : ["expectedWorkerId", "rootRequestId"])])
    || typeof value.status !== "string" || !["all", "submitted", "approved", "rejected", "withdrawn"].includes(value.status)) return false;
  // The history executor forwards canonical six-digit UTC instants unchanged.
  const instant = (raw: unknown) => typeof raw === "string" && raw.length === 27 ? instantMicros(raw) : null;
  const asOf = instant(value.asOf), cursor = instant(value.cursorAt);
  if (value.asOf !== null && asOf === null
    || !(value.cursorAt === null && value.cursorId === null
      || cursor !== null && isUuid(value.cursorId) && asOf !== null && cursor <= asOf)) return false;
  if (!owner) return value.scope === "root-history" && isUuid(value.expectedWorkerId) && isUuid(value.rootRequestId);
  const from = instant(value.fromAt), to = instant(value.toAt);
  return value.scope === "submission-period" && from !== null && to !== null && to > from && to - from <= BigInt(2678400000000)
    && from >= BigInt(946684800000000) && to <= BigInt(4133980800000000)
    && (cursor === null || cursor >= from && cursor < to);
}

function validReportDates(query: Record<string, unknown>): boolean {
  const day = (raw: unknown) => {
    if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw) || raw < "2000-01-01" || raw > "2100-12-31") return null;
    const value = `${raw}T00:00:00.000Z`, epoch = Date.parse(value);
    return Number.isFinite(epoch) && new Date(epoch).toISOString() === value ? epoch : null;
  };
  const from = day(query.fromDate), through = day(query.throughDate);
  return from !== null && through !== null && through >= from && through - from <= 30 * 86400000;
}

function validReportZone(raw: unknown): boolean {
  if (typeof raw !== "string" || raw.length > 100 || raw !== "UTC" && !/^[A-Za-z_+-]+(?:\/[A-Za-z0-9_+-]+)+$/.test(raw)) return false;
  try { new Intl.DateTimeFormat("en-CA", { timeZone: raw }); return true; } catch { return false; }
}

function validScopedReportQuery(query: unknown): boolean {
  return exact(query, ["access", "fromDate", "throughDate", "workerId", "locationId", "expectedWorkerId"])
    && validReportDates(query)
    && (query.access === "self" && query.workerId === null && query.locationId === null && (query.expectedWorkerId === null || isUuid(query.expectedWorkerId))
      || query.access === "manager" && isUuid(query.workerId) && isUuid(query.locationId) && query.expectedWorkerId === null);
}

function validScopedReportContext(query: unknown): boolean {
  if (!exact(query, ["access", "search", "cursor", "scopeRevision"]) || typeof query.search !== "string"
    || query.search !== query.search.trim() || query.search.length > 80 || /[\u0000-\u001f\u007f]/.test(query.search)) return false;
  if (query.access === "self") return query.search === "" && query.cursor === null && query.scopeRevision === null;
  if (query.access !== "manager") return false;
  if (query.cursor === null) return query.scopeRevision === null;
  if (typeof query.cursor !== "string") return false;
  const pair = query.cursor.split(".");
  return pair.length === 2 && pair.every(isUuid) && integer(query.scopeRevision, 1, Number.MAX_SAFE_INTEGER - 1);
}

function validReportExportQuery(query: unknown): boolean {
  if (!exact(query, ["access", "workerId", "locationId", "expectedWorkerId", "fromDate", "throughDate", "expectedTimeZone", "expectedScopeRevision"])
    || !validReportDates(query) || !validReportZone(query.expectedTimeZone)) return false;
  if (query.access === "owner") return isUuid(query.workerId) && query.locationId === null && query.expectedWorkerId === null && query.expectedScopeRevision === null;
  if (query.access === "self") return query.workerId === null && query.locationId === null && isUuid(query.expectedWorkerId) && query.expectedScopeRevision === null;
  return query.access === "manager" && isUuid(query.workerId) && isUuid(query.locationId) && query.expectedWorkerId === null
    && integer(query.expectedScopeRevision, 1, Number.MAX_SAFE_INTEGER - 1);
}

function validMissingQuery(query: unknown): boolean {
  if (!exact(query, ["siteId", "access", "fromDate", "throughDate", "requestId", "operationId", "beforeAt", "beforeId"])) return false;
  try {
    // The executor sends the parser's canonical DTO, not URL-coerced numbers,
    // omitted nulls or three-digit cursors. Keep SQL's six-digit cursor fence.
    const parsed = parseMissingQuery(`https://local.invalid/?${missingQueryString(query as MissingQuery)}`);
    assert.deepEqual(parsed, query);
    return true;
  } catch { return false; }
}

function validQuery(name: string, query: unknown): boolean {
  switch (name) {
    case "faolla_attendance_admin_v1": return exact(query, ["view", "cursor", "search"]);
    case "faolla_attendance_self_history_v1": return exact(query, ["fromAt", "toAt", "expectedWorkerId", "asOf", "cursorAt", "cursorId"]);
    case "faolla_attendance_correction_self_v3": return validCorrectionQuery(query);
    case "faolla_attendance_correction_owner_review_v3": return validCorrectionReviewQuery(query);
    case "faolla_attendance_revision_self_v2": return validRevisionQuery(query);
    case "faolla_attendance_revision_history_v1": return validRevisionHistoryQuery(query);
    case "faolla_attendance_period_report_v2": return exact(query, ["workerId", "fromDate", "throughDate"]) && isUuid(query.workerId) && validReportDates(query);
    case "faolla_attendance_scoped_period_report_v2": return validScopedReportQuery(query);
    case "faolla_attendance_scoped_report_context_v1": return validScopedReportContext(query);
    case "faolla_attendance_period_export_v2": return validReportExportQuery(query);
    case "faolla_attendance_missing_v1": return validMissingQuery(query);
    case "faolla_attendance_unified_report_v1": return exact(query, ["access", "workerId", "fromDate", "throughDate"])
      && query.access === "owner" && isUuid(query.workerId) && validReportDates(query) || validScopedReportQuery(query);
    case "faolla_attendance_unified_export_v1": return validReportExportQuery(query);
    case "faolla_attendance_terminal_admin_v1": return exact(query, ["cursor", "terminalId"])
      && (query.cursor === null || isUuid(query.cursor)) && (query.terminalId === null || isUuid(query.terminalId))
      && (query.cursor === null || query.terminalId === null);
    case "faolla_attendance_audit_v1":
      return exact(query, ["mode", "source", "operationId"]) && query.mode === "detail"
        || exact(query, ["mode", "source", "fromAt", "toAt", "asOf", "cursorAt", "cursorId"]) && query.mode === "list";
    case "faolla_attendance_audit_export_v1": return exact(query, ["source", "fromAt", "toAt"]);
    case "faolla_attendance_choices_v1": return exact(query, ["kind", "search", "cursor"]) || exact(query, ["kind", "ids"]);
    case "faolla_attendance_location_notice_v1": return exact(query, ["access", "locationId", "expectedWorkerId", "operationId"])
      && isUuid(query.locationId)
      && (query.access === "owner" && query.expectedWorkerId === null || query.access === "self" && isUuid(query.expectedWorkerId))
      && (query.operationId === null || isUuid(query.operationId));
    case "faolla_attendance_location_reviews_v1":
      return exact(query, ["mode", "eventId", "operationId"]) && query.mode === "detail" && isUuid(query.eventId)
        && (query.operationId === null || isUuid(query.operationId))
        || exact(query, ["mode", "fromAt", "toAt", "workerId", "locationId", "status", "asOf", "cursorAt", "cursorId"])
        && query.mode === "list" && (query.workerId === null || isUuid(query.workerId))
        && (query.locationId === null || isUuid(query.locationId)) && typeof query.status === "string"
        && ["all", "pending", "reviewed", "follow_up"].includes(query.status) && validExceptionRange(query);
    case "faolla_attendance_location_discussion_v1": {
      const detail = exact(query, ["access", "mode", "expectedWorkerId", "eventId", "operationId"]) && query.mode === "detail";
      const list = exact(query, ["access", "mode", "expectedWorkerId", "fromAt", "toAt", "asOf", "cursorAt", "cursorId"]) && query.mode === "list";
      if (!detail && !list) return false;
      const value = query as Record<string, unknown>;
      if (!(value.access === "owner" && value.expectedWorkerId === null
        || value.access === "self" && (isUuid(value.expectedWorkerId) || list && value.cursorId === null && value.expectedWorkerId === null))) return false;
      return detail ? isUuid(value.eventId) && (value.operationId === null || isUuid(value.operationId)) : validExceptionRange(value);
    }
    default: return false;
  }
}

type AuditShellCall = {
  name: string; actor: string | null; siteId: string; employeeId: string | null;
  operationId: string | null; command: unknown; query: unknown;
  allowWrite?: boolean;
  locationId?: string;
  expectedWorkerId?: string;
  assertion?: unknown;
  allowNewSessions?: boolean;
  requireClock?: boolean;
  platformEnabled?: boolean;
  requestId?: string;
  baseRequestId?: string;
  startEventId?: string;
  terminalId?: string | null;
  allowCreate?: boolean;
  allowPair?: boolean;
  allowNew?: boolean;
  allowSet?: boolean;
  allowVerify?: boolean;
};

function validClockAssertion(value: unknown): boolean {
  if (!exact(value, ["policyFingerprint", "algorithmVersion", "reason", "capturedAt", "accuracyMeters", "distanceMeters"])
    || typeof value.policyFingerprint !== "string" || !/^[0-9a-f]{32}$/.test(value.policyFingerprint) || value.algorithmVersion !== 1) return false;
  if (["inside", "outside", "uncertain"].includes(String(value.reason))) {
    return typeof value.reason === "string" && typeof value.capturedAt === "string"
      && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.capturedAt)
      && Number.isFinite(Date.parse(value.capturedAt)) && new Date(value.capturedAt).toISOString() === value.capturedAt
      && typeof value.accuracyMeters === "number" && Number.isFinite(value.accuracyMeters)
      && value.accuracyMeters >= 0 && value.accuracyMeters <= 40100000 && integer(value.distanceMeters, 0, 20100000);
  }
  return typeof value.reason === "string" && ["denied", "timeout", "unavailable", "unsupported", "not_provided"].includes(value.reason)
    && value.capturedAt === null && value.accuracyMeters === null && value.distanceMeters === null;
}

export function createAttendanceAuditShellTransport(exec: (sql: string) => string) {
  // Keep the existing admin/self/history and shell behavior. The connection
  // setting only makes their existing quoted literals independent of backslash
  // settings inherited by the isolated test connection.
  const execute = (sql: string) => exec(`set standard_conforming_strings=on;${sql}`);
  const base = createAttendanceDatabaseTransport(execute);
  // Opt-in only for the real employee-shell navigation acceptance. The
  // conversation page is an empty synthetic read surface, never a business
  // message service and never enabled by the ordinary audit scenarios.
  const state = Object.assign(base.state, { navigationConversationsEnabled: false });
  const calls: AuditShellCall[] = [];
  const rpc = async (name: string, args: Record<string, unknown>) => {
    assert(Object.hasOwn(parameters, name), "attendance_audit_shell_unexpected_rpc");
    const fields = parameters[name as keyof typeof parameters];
    assert(exact(args, fields), "attendance_audit_shell_invalid_rpc_arguments");
    const missingRpc = name === "faolla_attendance_missing_v1";
    const terminalAdmin = name === "faolla_attendance_terminal_admin_v1", terminalDevice = name === "faolla_attendance_terminal_device_v1";
    const onsiteIssue = name === "faolla_attendance_onsite_issue_v1", onsiteClock = name === "faolla_attendance_onsite_clock_v1";
    const terminalRpc = terminalAdmin || terminalDevice || onsiteIssue || onsiteClock;
    const pinAdmin = name === "faolla_attendance_pin_admin_v1", pinBegin = name === "faolla_attendance_pin_begin_v1";
    const pinFinish = name === "faolla_attendance_pin_finish_v1", pinClock = name === "faolla_attendance_pin_clock_v1";
    const pinDeviceRpc = pinBegin || pinFinish || pinClock, pinRpc = pinAdmin || pinDeviceRpc;
    const deviceCredentialRpc = terminalDevice || onsiteIssue || pinDeviceRpc;
    // Only this real RPC carries the tenant inside its exact query envelope.
    const siteId = missingRpc ? (args.p_query as Record<string, unknown> | null)?.siteId : terminalRpc || pinRpc ? args.p_site : args.p_site_id;
    assert.equal(siteId, "99990001", "attendance_audit_shell_invalid_site");
    const authUserId = terminalAdmin || onsiteClock || pinAdmin ? args.p_auth : args.p_auth_user_id;
    assert(deviceCredentialRpc || typeof authUserId === "string" && databaseActors.some(actor => actor.id === authUserId),
      "attendance_audit_shell_invalid_actor");
    if (Object.hasOwn(args, "p_query")) assert(validQuery(name, args.p_query), "attendance_audit_shell_invalid_query");
    if (Object.hasOwn(args, "p_operation_id")) assert(args.p_operation_id === null || isUuid(args.p_operation_id), "attendance_audit_shell_invalid_operation");
    if (name === "faolla_attendance_period_export_v2" || name === "faolla_attendance_unified_export_v1")
      assert(isUuid(args.p_operation_id), "attendance_report_shell_invalid_operation");
    if (pinRpc) {
      assert(typeof args.p_no === "string" && args.p_no === args.p_no.trim() && Array.from(args.p_no).length >= 1
        && Array.from(args.p_no).length <= 40 && !/[\u0000-\u001f\u007f-\u009f]/.test(args.p_no), "attendance_pin_shell_invalid_worker_number");
      if (pinAdmin) {
        assert(args.p_operation === null || isUuid(args.p_operation), "attendance_pin_shell_invalid_operation");
        assert(typeof args.p_allow_set === "boolean", "attendance_pin_shell_invalid_set_gate");
        const command = args.p_command;
        if (command !== null) {
          assert(exact(command, ["action", "operationId", "expectedRevision", "workerId", "employeeId", "salt", "verifier", "commandHash"])
            && isUuid(command.operationId) && isUuid(command.workerId) && isHash(command.commandHash)
            && integer(command.expectedRevision, 0, 999999998)
            && (command.action === "set" && isUuid(command.employeeId) && typeof command.salt === "string"
              && /^[0-9a-f]{32}$/.test(command.salt) && isHash(command.verifier)
              || command.action === "revoke" && (command.employeeId === null || isUuid(command.employeeId))
              && command.salt === null && command.verifier === null), "attendance_pin_shell_invalid_command");
          assert(args.p_operation === null, "attendance_pin_shell_mixed_write_read");
        }
      } else {
        assert(isUuid(args.p_lease), "attendance_pin_shell_invalid_lease");
        if (pinBegin || pinFinish) assert(typeof args.p_allow === "boolean", "attendance_pin_shell_invalid_verify_gate");
        if (pinFinish || pinClock) assert(typeof args.p_verified === "boolean", "attendance_pin_shell_invalid_proof");
        if (pinClock) {
          assert(typeof args.p_allow_new === "boolean", "attendance_pin_shell_invalid_clock_gate");
          let valid = false;
          try { assert.deepEqual(parsePinClockRequest(args.p_request), args.p_request); valid = true; }
          catch { /* No raw request, PIN or proof is attached to the error. */ }
          assert(valid, "attendance_pin_shell_invalid_request");
        }
      }
      // Only the actual server KDF may produce verification evidence. The
      // fixture validates its shape, never manufactures a successful proof,
      // lease, status, authorization decision or attendance receipt.
    }
    if (terminalAdmin) {
      assert(typeof args.p_allow_create === "boolean", "attendance_terminal_shell_invalid_create_gate");
      const command = args.p_command, query = args.p_query as Record<string, unknown>;
      if (command !== null) {
        const create = exact(command, ["action", "terminalId", "locationId", "label", "pairHash"])
          && command.action === "create" && isUuid(command.terminalId) && isUuid(command.locationId) && isHash(command.pairHash)
          && typeof command.label === "string" && command.label === command.label.trim()
          && Array.from(command.label).length >= 1 && Array.from(command.label).length <= 80 && !/[\u0000-\u001f\u007f-\u009f]/.test(command.label);
        const revoke = exact(command, ["action", "terminalId"]) && command.action === "revoke" && isUuid(command.terminalId);
        assert(create || revoke, "attendance_terminal_shell_invalid_command");
        assert(query.cursor === null && query.terminalId === null, "attendance_terminal_shell_mixed_write_read");
      }
    }
    if (deviceCredentialRpc) {
      assert(isUuid(terminalDevice ? args.p_id : args.p_terminal), "attendance_terminal_shell_invalid_terminal");
      assert(isHash(args.p_secret_hash), "attendance_terminal_shell_invalid_secret_hash");
      if (terminalDevice) {
        assert(args.p_device_hash === null || isHash(args.p_device_hash), "attendance_terminal_shell_invalid_device_hash");
        assert(typeof args.p_allow_pair === "boolean", "attendance_terminal_shell_invalid_pair_gate");
      }
      // Pair-vs-device credential validity, one-use pairing and pause decisions
      // are made by SQL; hashes never grant an actor exception to another RPC.
    }
    if (onsiteClock) {
      assert(typeof args.p_allow_new === "boolean", "attendance_terminal_shell_invalid_clock_gate");
      assert(args.p_operation === null || isUuid(args.p_operation), "attendance_terminal_shell_invalid_operation");
      const command = args.p_command;
      if (command === null) {
        assert(args.p_claims === null, "attendance_terminal_shell_read_claims");
      } else {
        assert(exact(command, ["expectedWorkerId", "expectedEmployeeId", "operationId", "locationId", "action", "expectedSequence"])
          && isUuid(command.expectedWorkerId) && isUuid(command.expectedEmployeeId) && isUuid(command.operationId) && isUuid(command.locationId)
          && typeof command.action === "string" && ["clock_in", "break_start", "break_end", "clock_out"].includes(command.action)
          && integer(command.expectedSequence, 0, Number.MAX_SAFE_INTEGER - 1), "attendance_terminal_shell_invalid_clock_command");
        assert(args.p_operation === null, "attendance_terminal_shell_mixed_write_read");
        let valid = false;
        try {
          const claims = parseOnsiteClaims(args.p_claims);
          assert.deepEqual(claims, args.p_claims);
          valid = claims.siteId === siteId && claims.locationId === command.locationId;
        } catch { /* Signature verification is in the real server executor. */ }
        assert(valid, "attendance_terminal_shell_invalid_claims");
        // No fixture clock/freshness check: SQL evaluates current time after
        // locks and may return an exact prior receipt for an expired token.
      }
    }
    if (missingRpc) {
      assert(typeof args.p_allow_write === "boolean", "attendance_missing_shell_invalid_write_gate");
      if (args.p_command !== null) {
        let valid = false;
        try {
          const parsed = parseMissingBody({ query: args.p_query, command: args.p_command });
          assert.deepEqual(parsed.command, args.p_command);
          valid = true;
        } catch { /* Fail closed before logging or invoking the SQL connection. */ }
        assert(valid, "attendance_missing_shell_invalid_command");
      }
      // Actor authority, pauses, current settings/policy and evidence are SQL
      // decisions. Any allowlisted actor and a false write gate still reach it.
    }
    const correctionSelf = name === "faolla_attendance_correction_self_v3";
    const correctionDecision = name === "faolla_attendance_correction_decide_v2";
    const revisionSelf = name === "faolla_attendance_revision_self_v2";
    const revisionReview = name === "faolla_attendance_revision_owner_review_v3";
    const revisionDecision = name === "faolla_attendance_revision_decide_v2";
    if (name === "faolla_attendance_self_session_v1") assert(isUuid(args.p_start_event_id), "attendance_correction_shell_invalid_start_event");
    if (correctionSelf) {
      assert(typeof args.p_platform_enabled === "boolean", "attendance_correction_shell_invalid_platform_gate");
      const command = args.p_command, query = args.p_query as Record<string, unknown>;
      if (command !== null) {
        assert(command && typeof command === "object" && !Array.isArray(command), "attendance_correction_shell_invalid_command");
        const value = command as Record<string, unknown>, submit = value.action === "submit";
        const fields = ["action", "operationId", "expectedRevision", "reason", ...(submit
          ? ["startEventId", "expectedLastEventId", "proposal", ...(Object.hasOwn(value, "expectedPolicyRevision") ? ["expectedPolicyRevision"] : [])]
          : ["requestId"])];
        assert((submit || value.action === "withdraw") && exact(value, fields) && isUuid(value.operationId)
          && integer(value.expectedRevision, 0, Number.MAX_SAFE_INTEGER - 3) && validCorrectionReason(value.reason)
          && (submit ? isUuid(value.startEventId) && isUuid(value.expectedLastEventId) && validCorrectionProposal(value.proposal)
            && (!Object.hasOwn(value, "expectedPolicyRevision") || integer(value.expectedPolicyRevision, 1, Number.MAX_SAFE_INTEGER - 2))
            : isUuid(value.requestId)), "attendance_correction_shell_invalid_command");
        assert(query.mode === "detail" && query.operationId === null && query.requestId === (submit ? value.operationId : value.requestId),
          "attendance_correction_shell_mixed_write_read");
        // Missing policy revision, paused platform and stale evidence remain
        // authoritative SQL decisions, not fixture-generated business replies.
      }
    }
    if (revisionSelf) {
      assert(typeof args.p_platform_enabled === "boolean", "attendance_revision_shell_invalid_platform_gate");
      const command = args.p_command, query = args.p_query as Record<string, unknown>;
      if (command !== null) {
        assert(command && typeof command === "object" && !Array.isArray(command), "attendance_revision_shell_invalid_command");
        const value = command as Record<string, unknown>, submit = value.action === "submit";
        assert((submit || value.action === "withdraw") && exact(value, ["action", "operationId", "expectedRevision", "reason", ...(submit
          ? ["expectedBaseOperationId", "expectedEffectiveOperationId", "expectedPolicyRevision", "proposal"] : ["requestId"])])
          && isUuid(value.operationId) && integer(value.expectedRevision, 0, Number.MAX_SAFE_INTEGER - 3) && validCorrectionReason(value.reason)
          && (submit ? isUuid(value.expectedBaseOperationId) && isUuid(value.expectedEffectiveOperationId)
            && integer(value.expectedPolicyRevision, 1, Number.MAX_SAFE_INTEGER - 2) && validCorrectionProposal(value.proposal)
            : isUuid(value.requestId)), "attendance_revision_shell_invalid_command");
        assert(query.mode === "detail" && query.operationId === null && query.requestId === (submit ? value.operationId : value.requestId),
          "attendance_revision_shell_mixed_write_read");
        // Current executors require the effective-source fence on new submits.
        // SQL still decides authorization, stale lineage, policy and replay.
      }
    }
    if (revisionReview) assert(isUuid(args.p_request_id), "attendance_revision_shell_invalid_request_id");
    if (correctionDecision || revisionDecision) {
      assert(isUuid(args.p_request_id), "attendance_correction_shell_invalid_request_id");
      assert(typeof args.p_allow_write === "boolean", "attendance_correction_shell_invalid_write_gate");
      const command = args.p_command;
      if (command !== null) {
        assert(exact(command, ["action", "operationId", "requestId", "expectedRevision", "expectedEvidence", "reason", ...(revisionDecision ? ["expectedBaseOperationId"] : [])])
          && (command.action === "approve" || command.action === "reject") && isUuid(command.operationId) && isUuid(command.requestId)
          && integer(command.expectedRevision, 1, Number.MAX_SAFE_INTEGER - 2)
          && typeof command.expectedEvidence === "string" && /^[0-9a-f]{32}$/.test(command.expectedEvidence)
          && validCorrectionReason(command.reason) && (!revisionDecision || isUuid(command.expectedBaseOperationId)), "attendance_correction_shell_invalid_decision");
        assert(command.requestId === args.p_request_id && args.p_operation_id === null, "attendance_correction_shell_mixed_write_read");
      }
    }
    const exceptionRpc = name === "faolla_attendance_location_reviews_v1" || name === "faolla_attendance_location_discussion_v1";
    if (exceptionRpc && args.p_command !== null) {
      const command = args.p_command, query = args.p_query as Record<string, unknown>;
      const review = name === "faolla_attendance_location_reviews_v1";
      assert(exact(command, review ? ["eventId", "operationId", "expectedRevision", "outcome", "note"] : ["eventId", "operationId", "expectedRevision", "note"])
        && isUuid(command.eventId) && isUuid(command.operationId) && integer(command.expectedRevision, 0, Number.MAX_SAFE_INTEGER - 2)
        && validExceptionNote(command.note)
        && (!review || typeof command.outcome === "string" && ["noted", "follow_up", "reopen"].includes(command.outcome)),
      "attendance_exception_shell_invalid_command");
      assert(query.mode === "detail" && query.eventId === command.eventId && query.operationId === null,
        "attendance_exception_shell_mixed_write_read");
      // Deliberately do not infer authority from the synthetic actor ID. The
      // actual RPC checks current ownership / self role and original actor.
    }
    const locationRpc = name === "faolla_attendance_location_policy_draft_v1" || name === "faolla_attendance_location_setup_v1" || name === "faolla_attendance_location_notice_v1";
    const writeGate = name === "faolla_attendance_location_setup_v1" ? "p_allow_prepare" : name === "faolla_attendance_location_notice_v1" ? "p_allow_publish" : "p_allow_write";
    if (locationRpc) {
      assert(typeof args[writeGate] === "boolean", "attendance_location_shell_invalid_write_gate");
      if (Object.hasOwn(args, "p_location_id")) assert(isUuid(args.p_location_id), "attendance_location_shell_invalid_location");
      const command = args.p_command;
      if (command !== null) {
        assert(command && typeof command === "object" && !Array.isArray(command), "attendance_location_shell_invalid_command");
        const value = command as Record<string, unknown>;
        assert(isUuid(value.operationId), "attendance_location_shell_invalid_operation");
        if (name === "faolla_attendance_location_policy_draft_v1") {
          assert(exact(value, ["operationId", "expectedRevision", "expectedSettingsVersion", "expectedLocationVersion", "values"])
            && exact(value.values, ["purpose", "notice", "contact", "alternative", "retentionDays", "latitude", "longitude", "radiusMeters"]), "attendance_location_shell_invalid_policy");
        } else if (name === "faolla_attendance_location_setup_v1") {
          assert(exact(value, ["action", "operationId", "expectedSettingsVersion", "expectedLocationVersion", "expectedChannelVersion", "draftRevision", "reason"])
            && ["prepare", "enable", "pause"].includes(String(value.action))
            && (value.action === "prepare" ? Number.isSafeInteger(value.draftRevision) && Number(value.draftRevision) > 0 : value.draftRevision === null), "attendance_location_shell_invalid_setup");
        } else if ((args.p_query as Record<string, unknown>).access === "self") {
          assert(exact(value, ["action", "operationId", "expectedRevision"]) && value.action === "acknowledge"
            && integer(value.expectedRevision, 1, Number.MAX_SAFE_INTEGER - 1), "attendance_location_shell_invalid_notice");
        } else {
          assert(exact(value, ["action", "operationId", "expectedRevision", "draftRevision", "expectedSettingsVersion", "expectedLocationVersion", "reason"])
            && ["publish", "withdraw"].includes(String(value.action))
            && (value.action === "publish" ? Number.isSafeInteger(value.draftRevision) && Number(value.draftRevision) > 0 : value.draftRevision === null), "attendance_location_shell_invalid_notice");
        }
        assert(name === "faolla_attendance_location_notice_v1" ? (args.p_query as Record<string, unknown>).operationId === null : args.p_operation_id === null,
          "attendance_location_shell_mixed_write_read");
      }
    }
    if (name === "faolla_attendance_location_clock_v2") {
      assert(isUuid(args.p_expected_worker_id), "attendance_location_shell_invalid_worker");
      assert(typeof args.p_allow_new_sessions === "boolean" && typeof args.p_require_clock === "boolean", "attendance_location_shell_invalid_clock_gates");
      const command = args.p_command;
      if (command === null) {
        assert(args.p_assertion === null, "attendance_location_shell_read_assertion");
      } else {
        assert(exact(command, ["operationId", "locationId", "action", "expectedSequence", "settingsVersion", "workerVersion", "locationVersion", "noticeRevision", "safeFinish"])
          && isUuid(command.operationId) && isUuid(command.locationId) && typeof command.action === "string"
          && ["clock_in", "clock_out", "break_start", "break_end"].includes(command.action)
          && integer(command.expectedSequence, 0, Number.MAX_SAFE_INTEGER - 1)
          && ["settingsVersion", "workerVersion", "locationVersion"].every(key => integer(command[key], 1))
          && typeof command.safeFinish === "boolean", "attendance_location_shell_invalid_clock_command");
        assert(args.p_operation_id === null, "attendance_location_shell_mixed_write_read");
        if (command.safeFinish) {
          assert(command.noticeRevision === null && ["break_end", "clock_out"].includes(command.action)
            && args.p_assertion === null, "attendance_location_shell_invalid_safe_finish");
        } else {
          assert(integer(command.noticeRevision, 1, Number.MAX_SAFE_INTEGER - 1), "attendance_location_shell_invalid_clock_notice");
          // The actual executor intentionally forwards null on a missing or
          // denied policy snapshot, leaving the authoritative rejection to SQL.
          assert(args.p_assertion === null || validClockAssertion(args.p_assertion), "attendance_location_shell_invalid_assertion");
        }
      }
    }
    if (name === "faolla_attendance_correction_controls_v2") {
      assert(typeof args.p_allow_write === "boolean", "attendance_controls_shell_invalid_write_gate");
      assert(args.p_before_revision === null || typeof args.p_before_revision === "number"
        && Number.isSafeInteger(args.p_before_revision) && args.p_before_revision >= 1
        && args.p_before_revision <= Number.MAX_SAFE_INTEGER - 2, "attendance_controls_shell_invalid_cursor");
      const command = args.p_command;
      if (command !== null) {
        assert(command && typeof command === "object" && !Array.isArray(command), "attendance_controls_shell_invalid_command");
        const value = command as Record<string, unknown>, common = ["operationId", "expectedRevision", "expectedSettingsVersion", "reason", "action"];
        const fields = value.action === "set_policy" ? ["submissionWindowDays"] : value.action === "lock_period" ? ["fromDate", "throughDate"]
          : value.action === "unlock_period" ? ["periodId"] : null;
        assert(fields && exact(value, [...common, ...fields]) && isUuid(value.operationId), "attendance_controls_shell_invalid_command");
        assert(args.p_operation_id === null && args.p_before_revision === null, "attendance_controls_shell_mixed_write_read");
      }
    }
    if (name === "faolla_attendance_scopes_v1") {
      assert(isUuid(args.p_employee_id), "attendance_audit_shell_invalid_employee");
      const command = args.p_command;
      if (command !== null) {
        assert(exact(command, ["operationId", "expectedRevision", "action", "grantId", "grant"]), "attendance_audit_shell_invalid_scope_command");
        assert(isUuid(command.operationId) && isUuid(command.grantId), "attendance_audit_shell_invalid_scope_identity");
        assert(command.action === "remove" && command.grant === null
          || command.action === "put" && exact(command.grant, ["workerIds", "locationIds", "validFrom", "validUntil"]),
        "attendance_audit_shell_invalid_scope_grant");
      }
    }
    // JSON values and their exact keys must survive serialization unchanged.
    // Values such as undefined/NaN must not silently become missing/null data.
    const copied = snapshot(args) as Record<string, unknown>;
    if (pinRpc) {
      try { assert.deepEqual(copied, args); }
      catch { throw new Error("attendance_pin_shell_non_json_arguments"); }
    } else assert.deepEqual(copied, args, "attendance_audit_shell_non_json_arguments");
    const pinRequest = pinClock ? copied.p_request as { command: { operationId: string } | null; operationId: string | null } : null;
    const command = (pinClock ? pinRequest?.command : copied.p_command) as { operationId?: string } | null | undefined;
    const loggedCommand = pinAdmin && copied.p_command !== null
      ? Object.fromEntries(Object.entries(copied.p_command as Record<string, unknown>).filter(([key]) => !["salt", "verifier", "commandHash"].includes(key)))
      : terminalAdmin && (copied.p_command as { action?: string } | null)?.action === "create"
        ? Object.fromEntries(Object.entries(copied.p_command as Record<string, unknown>).filter(([key]) => key !== "pairHash"))
        : pinClock ? pinRequest?.command ?? null : copied.p_command ?? null;
    calls.push({ name, actor: deviceCredentialRpc ? null : authUserId as string, siteId: "99990001",
      employeeId: copied.p_employee_id as string | undefined ?? null,
      operationId: command?.operationId ?? copied.p_operation_id as string | undefined
        ?? (onsiteClock || pinAdmin ? copied.p_operation as string | null : pinRequest?.operationId ?? null)
        ?? (name === "faolla_attendance_location_notice_v1" || exceptionRpc || correctionSelf || revisionSelf || missingRpc ? (copied.p_query as { operationId?: string | null }).operationId ?? null : null),
      command: loggedCommand,
      query: pinRpc ? { workerNo: copied.p_no, ...(pinAdmin || pinClock ? { operationId: pinAdmin ? copied.p_operation : pinRequest?.operationId } : {}) }
        : name === "faolla_attendance_correction_controls_v2" ? { operationId: copied.p_operation_id, beforeRevision: copied.p_before_revision }
        : correctionDecision || revisionDecision ? { requestId: copied.p_request_id, operationId: copied.p_operation_id }
          : revisionReview ? { requestId: copied.p_request_id }
          : name === "faolla_attendance_self_session_v1" ? { startEventId: copied.p_start_event_id } : copied.p_query ?? null,
      ...(name === "faolla_attendance_correction_controls_v2" ? { allowWrite: copied.p_allow_write as boolean } : {}),
      ...(missingRpc ? { allowWrite: copied.p_allow_write as boolean } : {}),
      ...(pinAdmin ? { allowSet: copied.p_allow_set as boolean } : {}),
      ...(pinDeviceRpc ? { terminalId: copied.p_terminal as string } : {}),
      ...(pinBegin || pinFinish ? { allowVerify: copied.p_allow as boolean } : {}),
      ...(pinClock ? { allowNew: copied.p_allow_new as boolean } : {}),
      ...(terminalAdmin ? { allowCreate: copied.p_allow_create as boolean,
        terminalId: (copied.p_command as { terminalId: string } | null)?.terminalId ?? (copied.p_query as { terminalId: string | null }).terminalId } : {}),
      ...(terminalDevice ? { terminalId: copied.p_id as string, allowPair: copied.p_allow_pair as boolean } : {}),
      ...(onsiteIssue ? { terminalId: copied.p_terminal as string } : {}),
      ...(onsiteClock ? { allowNew: copied.p_allow_new as boolean,
        ...(command ? { terminalId: (copied.p_claims as { terminalId: string }).terminalId,
          locationId: (copied.p_command as { locationId: string }).locationId,
          expectedWorkerId: (copied.p_command as { expectedWorkerId: string }).expectedWorkerId } : {}) } : {}),
      ...(correctionSelf || revisionSelf ? { platformEnabled: copied.p_platform_enabled as boolean, expectedWorkerId: (copied.p_query as { expectedWorkerId: string }).expectedWorkerId } : {}),
      ...(revisionSelf ? { baseRequestId: (copied.p_query as { baseRequestId: string }).baseRequestId } : {}),
      ...(correctionDecision || revisionDecision ? { requestId: copied.p_request_id as string, allowWrite: copied.p_allow_write as boolean } : {}),
      ...(revisionReview ? { requestId: copied.p_request_id as string } : {}),
      ...(name === "faolla_attendance_self_session_v1" ? { startEventId: copied.p_start_event_id as string } : {}),
      ...(locationRpc ? { allowWrite: copied[writeGate] as boolean,
        locationId: (name === "faolla_attendance_location_notice_v1" ? (copied.p_query as { locationId: string }).locationId : copied.p_location_id) as string } : {}),
      ...(name === "faolla_attendance_location_clock_v2" ? { expectedWorkerId: copied.p_expected_worker_id as string,
        assertion: copied.p_assertion, allowNewSessions: copied.p_allow_new_sessions as boolean, requireClock: copied.p_require_clock as boolean,
        ...(command ? { locationId: (copied.p_command as { locationId: string }).locationId } : {}) } : {}) });
    if (name === "faolla_attendance_self_v1" || name === "faolla_attendance_admin_v1" || name === "faolla_attendance_self_history_v1")
      return base.rpc(name, args);
    const values = fields.map(field => ["p_query", "p_command", "p_assertion", "p_claims", "p_request"].includes(field) ? json(copied[field])
      : ["p_allow_write", "p_allow_prepare", "p_allow_publish", "p_allow_new_sessions", "p_require_clock", "p_platform_enabled", "p_allow_create", "p_allow_pair", "p_allow_new", "p_allow_set", "p_allow", "p_verified"].includes(field) ? String(copied[field]) : literal(copied[field]));
    try {
      const result: unknown = JSON.parse(execute(`set role service_role;select jsonb_build_object('role',current_user,'data',public.${name}(${values.join(",")}));`));
      assert(exact(result, ["role", "data"]) && result.role === "service_role", "attendance_audit_shell_wrong_database_role");
      return { data: result.data, error: null };
    } catch (error) {
      const code = String(error).match(/ERROR:\s+(attendance_[a-z_]+)/)?.[1];
      if (code) return { data: null, error: { message: code } };
      if (terminalRpc || pinRpc) {
        // PostgreSQL driver failures can echo the full SQL statement. These
        // four calls may contain credential hashes or private QR claims.
        const message = error instanceof Error && error.message === "attendance_audit_shell_wrong_database_role"
          ? error.message : pinRpc ? "attendance_pin_shell_sql_failure" : "attendance_terminal_shell_sql_failure";
        base.errors.push(message);
        throw new Error(message);
      }
      base.errors.push(String(error).slice(0, 1600));
      throw error;
    }
  };
  const serveShell = async (request: Request, authUserId: string) => {
    const url = new URL(request.url);
    if (url.pathname === "/api/merchant-peer-messages") {
      assert(state.navigationConversationsEnabled, "attendance_navigation_conversations_disabled");
      assert.equal(request.method, "GET", "attendance_navigation_conversation_write_forbidden");
      assert.deepEqual([...url.searchParams.keys()], ["siteId"], "attendance_navigation_conversation_query_forbidden");
      assert.equal(url.searchParams.get("siteId"), "99990001");
      assert(databaseActors.some(actor => actor.id === authUserId), "attendance_navigation_unknown_actor");
      const allowed = execute(`select count(*) from public.merchant_enterprise_employees e
        join public.merchant_enterprise_roles r on r.id=e.role_id and r.merchant_id=e.merchant_id
        where e.merchant_id='99990001' and e.auth_user_id=${literal(authUserId)} and e.status='active' and r.status='active'
          and 'enterprise.view'=any(r.permissions) and 'conversations.view'=any(r.permissions);`) === "1";
      if (!allowed) return Response.json({ ok: false, error: "merchant_employee_access_denied" }, { status: 403 });
      return Response.json({ ok: true, currentMerchantId: "99990001", contacts: [], threads: [], readState: { peerLastRead: {} } },
        { headers: { "cache-control": "private, no-store" } });
    }
    const response = await base.serveShell(request, authUserId);
    if (!state.navigationConversationsEnabled || url.pathname !== "/api/merchant-business/capabilities" || !response.ok) return response;
    assert.equal(request.method, "GET");
    assert.deepEqual([...url.searchParams.keys()], ["siteId"]);
    const payload = await response.json();
    assert(Array.isArray(payload.collaborationPermissions));
    const canView = payload.collaborationPermissions.includes("conversations.view");
    return Response.json({ ...payload,
      collaborationPermissions: payload.collaborationPermissions.filter((permission: string) => permission !== "conversations.view"),
      permissions: canView ? ["conversations.view"] : [] }, { headers: { "cache-control": "private, no-store" } });
  };
  return { state, calls, errors: base.errors, rpc, serveShell };
}
