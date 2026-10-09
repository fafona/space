// Small, browser-safe adapters. No credential or position becomes a saved intent.
import type { AttendanceAction } from "./merchantAttendance";
import type { AttendanceApiFetch } from "./merchantAttendanceSelfClient";
import { attendancePendingKey } from "./merchantAttendanceSelfClient";
import { selfSchedulePendingKey } from "./merchantAttendanceSelfScheduleClient";
import { selfScheduleAdoptionPendingKey } from "./merchantAttendanceSelfScheduleAdoptionClient";
import { attendanceLocationClockPendingKey } from "./merchantAttendanceLocationClockClient";
import { locationSchedulePendingKey } from "./merchantAttendanceLocationScheduleClient";
import { onsiteClockPendingKey } from "./merchantAttendanceOnsiteClockClient";
import { onsiteSchedulePendingKey } from "./merchantAttendanceOnsiteScheduleClient";
import { pinClockPendingKey } from "./merchantAttendancePinClockClient";
import { pinSchedulePendingKey } from "./merchantAttendancePinScheduleClient";
import { SELF_SCHEDULE_ADOPTION_ERRORS } from "./merchantAttendanceSelfScheduleAdoption";
import { LOCATION_SCHEDULE_ERRORS } from "./merchantAttendanceLocationSchedule";
import { PIN_SCHEDULE_ERRORS } from "./merchantAttendancePinSchedule";
import { ONSITE_SCHEDULE_ERRORS } from "./merchantAttendanceOnsiteSchedule";
import { OPERATIONAL_PUNCH_ERRORS, parseOperationalPunchCommand, type OperationalPunchChannel, type OperationalPunchCommand, type OperationalPunchResult } from "./merchantAttendanceOperationalPunch";
import { operationalPunchPendingKey, parseOperationalPunchPending, type OperationalPunchClientScope, type OperationalPunchClientContext, type OperationalPunchTransport } from "./merchantAttendanceOperationalPunchClient";
import type { SelfScheduleSelection } from "./merchantAttendanceSelfSchedule";
import type { AttendancePosition } from "./merchantAttendanceLocation";
import type { AttendancePositionFailure } from "./merchantAttendanceLocationClock";

export const OPERATIONAL_PUNCH_ACTION_LABELS: Record<AttendanceAction, string> = { clock_in: "上班", break_start: "开始休息", break_end: "结束休息", clock_out: "下班" };
export function operationalPunchUiNewKeys(scope: OperationalPunchClientScope): string[] {
  return scope.channel === "pin" ? [operationalPunchPendingKey(scope)] : (["self", "location", "onsite"] as const).map(channel => operationalPunchPendingKey({ ...scope, channel }));
}
export type OperationalPunchPendingRoute = { scope: OperationalPunchClientScope; valid: boolean; workerId: string | null };
export function operationalPunchUiPendingRoutes(scope: OperationalPunchClientScope, storage: Pick<Storage, "getItem">): OperationalPunchPendingRoute[] {
  const scopes = scope.channel === "pin" ? [scope] : (["self", "location", "onsite"] as const).map(channel => ({ ...scope, channel }));
  return scopes.flatMap<OperationalPunchPendingRoute>(s => {
    const raw = storage.getItem(operationalPunchPendingKey(s)); if (raw === null) return [];
    try { const pending = parseOperationalPunchPending(raw, s); return [{ scope: s, valid: true, workerId: pending.command.clock.expectedWorkerId }]; }
    catch { return [{ scope: s, valid: false, workerId: null }]; }
  });
}
export function operationalPunchUiErrors(channel: OperationalPunchChannel) {
  return { ...(channel === "self" ? SELF_SCHEDULE_ADOPTION_ERRORS : channel === "location" ? LOCATION_SCHEDULE_ERRORS : channel === "onsite" ? ONSITE_SCHEDULE_ERRORS : PIN_SCHEDULE_ERRORS), ...OPERATIONAL_PUNCH_ERRORS };
}
export function operationalPunchUiBlockedKeys(scope: OperationalPunchClientScope, employeeId: string | null): string[] {
  if (scope.channel === "pin") {
    if (!scope.terminalId || !scope.workerNo) throw Error("identity_required");
    const device = { siteId: scope.siteId, terminalId: scope.terminalId };
    return [pinClockPendingKey(device, scope.workerNo), pinSchedulePendingKey(device, scope.workerNo)];
  }
  if (!scope.authUserId) throw Error("identity_required");
  const keys = [onsiteClockPendingKey(scope.siteId, scope.authUserId), onsiteSchedulePendingKey(scope.siteId, scope.authUserId)];
  if (employeeId) keys.push(attendancePendingKey(scope.siteId, employeeId), selfSchedulePendingKey(scope.siteId, employeeId), selfScheduleAdoptionPendingKey(scope.siteId, employeeId),
    attendanceLocationClockPendingKey(scope.siteId, employeeId), locationSchedulePendingKey(scope.siteId, employeeId));
  for (const channel of ["self", "location", "onsite"] as const) if (channel !== scope.channel) keys.push(operationalPunchPendingKey({ ...scope, channel }));
  return keys;
}
export function operationalPunchUiContext(scope: OperationalPunchClientScope, workerId: string | null, employeeId: string | null): OperationalPunchClientContext {
  const { siteId, channel } = scope;
  if (channel === "pin") { if (!scope.terminalId || !scope.workerNo) throw Error("identity_required"); return { siteId, channel, authUserId: null, terminalId: scope.terminalId, workerNo: scope.workerNo, expectedWorkerId: workerId, expectedEmployeeId: employeeId }; }
  if (!scope.authUserId) throw Error("identity_required");
  if (channel === "location") { if (!workerId) throw Error("identity_required"); return { siteId, channel, authUserId: scope.authUserId, expectedWorkerId: workerId }; }
  return { siteId, channel, authUserId: scope.authUserId };
}
export function operationalPunchUiCommand(result: OperationalPunchResult, action: AttendanceAction, operationId: string,
  selection: SelfScheduleSelection | null | undefined, breakType: "paid" | "unpaid" | null, safeFinish = false): OperationalPunchCommand {
  if (result.operation) throw Error("fresh_read_required");
  const clock = result.clock, base = { expectedWorkerId: clock.workerId, operationId, locationId: clock.locationId, action, expectedSequence: clock.state.sequence };
  let choice: OperationalPunchCommand["choice"];
  if (action === "clock_in") {
    if (!result.canStart || !result.policy || selection === undefined) throw Error("explicit_selection_required");
    if (selection && !result.choices?.entries.some(v => v.id === selection.slotId && v.revision === selection.revision)) throw Error("selection_changed");
    const shift = result.policy.fields.shiftSource;
    if (selection && (shift.state === "disabled" || shift.value === "unplanned")) throw Error("selection_denied");
    choice = { kind: "start", expectedPolicyFingerprint: result.policy.policyFingerprint, selection };
    base.locationId = result.policy.locationId;
  } else if (action === "break_start") {
    if (!result.canBreak) throw Error("break_denied");
    if (result.session) { const field = result.session.fields.breakTypes;
      if (field.state === "value" && field.value?.selection === "explicit" ? breakType === null || !field.value.allowed.includes(breakType) : breakType !== null) throw Error("explicit_break_required");
      choice = { kind: "break", startEventId: result.session.startEventId, expectedSessionFingerprint: result.session.sessionFingerprint, breakType };
    } else { if (breakType !== null) throw Error("legacy_break_selection"); choice = { kind: "legacy_break" }; }
  } else { if (!result.canFinish) throw Error("finish_denied"); choice = { kind: "finish" }; }
  if (result.channel === "location") {
    const finish = safeFinish ? result.clock.finish : null, policy = result.clock.policy;
    if (safeFinish && (!finish || !["clock_out", "break_end"].includes(action)) || !safeFinish && (!policy || !result.clock.noticeGate.ready || result.clock.noticeGate.revision === null)) throw Error("location_notice_required");
    const versions = finish ?? policy!;
    return parseOperationalPunchCommand({ clock: { ...base, locationId: finish?.locationId ?? base.locationId, settingsVersion: versions.settingsVersion, workerVersion: versions.workerVersion,
      locationVersion: versions.locationVersion, noticeRevision: safeFinish ? null : result.clock.noticeGate.revision, safeFinish }, choice }, result.channel, result.siteId);
  }
  if (safeFinish) throw Error("wrong_channel");
  return parseOperationalPunchCommand({ clock: result.channel === "self" ? base : { ...base, expectedEmployeeId: result.clock.employeeId }, choice }, result.channel, result.siteId);
}
export type OperationalPunchTransient = { pin?: string; token?: string; position?: AttendancePosition | null; positionFailure?: AttendancePositionFailure | null };
export function operationalPunchUiTransport(scope: OperationalPunchClientScope, apiFetch: AttendanceApiFetch, expectedWorkerId: string | null,
  credential: (write: boolean, signal: AbortSignal) => Promise<OperationalPunchTransient>): OperationalPunchTransport {
  return async (query, command, signal) => {
    const endpoint = `/api/merchant-enterprise/attendance/operational-punch-${scope.channel}`;
    if (signal.aborted) throw Error("aborted");
    if (scope.channel !== "pin" && !command) {
      const params = new URLSearchParams({ siteId: scope.siteId, mode: query.mode });
      if (query.mode === "recover") params.set("operationId", query.operationId);
      if (scope.channel === "location") { if (!expectedWorkerId) throw Error("identity_required"); params.set("expectedWorkerId", expectedWorkerId); }
      return apiFetch(`${endpoint}?${params}`, { method: "GET", cache: "no-store", redirect: "error", signal });
    }
    const transient = await credential(command !== null, signal); if (signal.aborted) throw Error("aborted");
    const body = scope.channel === "pin" ? { workerNo: scope.workerNo, pin: transient.pin, query, command }
      : scope.channel === "location" ? { siteId: scope.siteId, query, command, position: transient.position ?? null, positionFailure: transient.positionFailure ?? null }
      : scope.channel === "onsite" ? { siteId: scope.siteId, query, command, token: transient.token }
      : { siteId: scope.siteId, query, command };
    return apiFetch(endpoint, { method: "POST", cache: "no-store", redirect: "error", signal, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  };
}
