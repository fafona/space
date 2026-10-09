import {
  attendanceInstant,
  attendanceLocalDate,
  attendanceTimeZone,
  MerchantAttendanceError,
  splitAttendanceIntervalByDay,
} from "./merchantAttendanceTime";

export const MERCHANT_ATTENDANCE_ACTIONS = ["clock_in", "break_start", "break_end", "clock_out"] as const;
export type AttendanceAction = (typeof MERCHANT_ATTENDANCE_ACTIONS)[number];

export type AttendanceCommand = {
  siteId: string;
  workerId: string;
  operationId: string;
  locationId: string;
  action: AttendanceAction;
  breakPaid: boolean | null;
};

// Server-assigned sequence and instant. This is NOT a client POST schema.
export type AttendanceEvent = AttendanceCommand & {
  id: string;
  sequence: number;
  occurredAt: string;
  timeZone: string;
};

export type AttendanceBreak = { startAt: string; endAt: string; paid: boolean };
type OpenSession = {
  startAt: string;
  startEventId: string;
  startLocationId: string;
  timeZone: string;
  breaks: AttendanceBreak[];
  currentBreak: { startAt: string; paid: boolean } | null;
};

export type AttendanceState = {
  siteId: string;
  workerId: string;
  sequence: number;
  lastOccurredAt: string | null;
  status: "off" | "working" | "break";
  session: OpenSession | null;
};

export type AttendanceSession = {
  siteId: string;
  workerId: string;
  startEventId: string;
  endEventId: string;
  startLocationId: string;
  endLocationId: string;
  startAt: string;
  endAt: string;
  timeZone: string;
  startDate: string;
  breaks: AttendanceBreak[];
};

function fail(code: string): never { throw new MerchantAttendanceError(code); }
export function requireAttendanceUuid(value: string): void {
  // Canonical DB UUID spelling keeps replay comparisons identical to storage.
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)) {
    fail("attendance_invalid_id");
  }
}

function requireScope(siteId: string, workerId: string): void {
  if (typeof siteId !== "string" || !/^\d{8}$/.test(siteId)) fail("attendance_invalid_site");
  requireAttendanceUuid(workerId);
}

export function validateAttendanceCommand(command: AttendanceCommand): void {
  requireScope(command.siteId, command.workerId);
  requireAttendanceUuid(command.operationId);
  requireAttendanceUuid(command.locationId);
  if (!MERCHANT_ATTENDANCE_ACTIONS.includes(command.action)) fail("attendance_invalid_action");
  if (command.action === "break_start" ? typeof command.breakPaid !== "boolean" : command.breakPaid !== null) {
    fail("attendance_invalid_break_type");
  }
}

// The commit transaction must perform this check before comparing the current
// state revision. A committed operation remains the same after subsequent work.
export function isAttendanceCommandReplay(original: AttendanceCommand, retry: AttendanceCommand): boolean {
  validateAttendanceCommand(original);
  validateAttendanceCommand(retry);
  if (original.siteId !== retry.siteId || original.workerId !== retry.workerId ||
      original.operationId !== retry.operationId) return false;
  if (original.locationId !== retry.locationId || original.action !== retry.action || original.breakPaid !== retry.breakPaid) {
    fail("attendance_operation_conflict");
  }
  return true;
}

export function initialAttendanceState(siteId: string, workerId: string): AttendanceState {
  requireScope(siteId, workerId);
  return { siteId, workerId, sequence: 0, lastOccurredAt: null, status: "off", session: null };
}

function checkBreaks(breaks: AttendanceBreak[], start: number, end: number): void {
  let previousEnd = start;
  if (!Array.isArray(breaks) || breaks.length > 1_000) fail("attendance_invalid_breaks");
  for (const item of breaks) {
    const from = attendanceInstant(item.startAt), to = attendanceInstant(item.endAt);
    if (from < previousEnd || to < from || to > end || typeof item.paid !== "boolean") fail("attendance_invalid_breaks");
    previousEnd = to;
  }
}

function validateState(state: AttendanceState): void {
  requireScope(state.siteId, state.workerId);
  if (!Number.isSafeInteger(state.sequence) || state.sequence < 0 ||
      (state.sequence === 0) !== (state.lastOccurredAt === null)) fail("attendance_invalid_state");
  if (state.lastOccurredAt !== null) attendanceInstant(state.lastOccurredAt);
  if (state.status === "off") {
    if (state.session !== null) fail("attendance_invalid_state");
    return;
  }
  if ((state.status !== "working" && state.status !== "break") || !state.session || !state.lastOccurredAt) {
    fail("attendance_invalid_state");
  }
  const session = state.session;
  requireAttendanceUuid(session.startEventId);
  requireAttendanceUuid(session.startLocationId);
  attendanceTimeZone(session.timeZone);
  const start = attendanceInstant(session.startAt), last = attendanceInstant(state.lastOccurredAt);
  if (last < start) fail("attendance_invalid_state");
  checkBreaks(session.breaks, start, last);
  if ((state.status === "break") !== (session.currentBreak !== null)) fail("attendance_invalid_state");
  if (session.currentBreak) {
    const currentStart = attendanceInstant(session.currentBreak.startAt);
    const previousEnd = session.breaks.at(-1)?.endAt ?? session.startAt;
    if (currentStart < attendanceInstant(previousEnd) || currentStart > last ||
        typeof session.currentBreak.paid !== "boolean") fail("attendance_invalid_state");
  }
}

// Pure deterministic reducer. Persisting a command still requires an authorized
// DB transaction, durable idempotency and concurrency control (not provided here).
export function applyAttendanceEvent(state: AttendanceState, event: AttendanceEvent): {
  state: AttendanceState;
  completedSession: AttendanceSession | null;
} {
  validateState(state);
  validateAttendanceCommand(event);
  requireAttendanceUuid(event.id);
  attendanceTimeZone(event.timeZone);
  const at = attendanceInstant(event.occurredAt);
  if (event.siteId !== state.siteId || event.workerId !== state.workerId) fail("attendance_scope_mismatch");
  if (!Number.isSafeInteger(event.sequence) || event.sequence !== state.sequence + 1) fail("attendance_sequence_conflict");
  if (state.lastOccurredAt !== null && at < attendanceInstant(state.lastOccurredAt)) fail("attendance_time_reversed");
  const next: AttendanceState = {
    ...state, sequence: event.sequence, lastOccurredAt: event.occurredAt,
    session: state.session ? { ...state.session, breaks: state.session.breaks.map((item) => ({ ...item })),
      currentBreak: state.session.currentBreak ? { ...state.session.currentBreak } : null } : null,
  };
  switch (event.action) {
    case "clock_in":
      if (state.status !== "off") fail("attendance_already_clocked_in");
      next.status = "working";
      next.session = { startAt: event.occurredAt, startEventId: event.id, startLocationId: event.locationId,
        timeZone: event.timeZone, breaks: [], currentBreak: null };
      break;
    case "break_start":
      if (state.status !== "working") fail("attendance_not_working");
      if (next.session!.breaks.length >= 1_000) fail("attendance_break_limit");
      next.status = "break";
      next.session!.currentBreak = { startAt: event.occurredAt, paid: event.breakPaid! };
      break;
    case "break_end":
      if (state.status !== "break") fail("attendance_not_on_break");
      next.session!.breaks.push({ ...next.session!.currentBreak!, endAt: event.occurredAt });
      next.session!.currentBreak = null;
      next.status = "working";
      break;
    case "clock_out": {
      if (state.status === "break") fail("attendance_break_must_end");
      if (state.status !== "working") fail("attendance_not_clocked_in");
      const session = next.session!;
      const completedSession: AttendanceSession = {
        siteId: state.siteId, workerId: state.workerId,
        startEventId: session.startEventId, endEventId: event.id,
        startLocationId: session.startLocationId, endLocationId: event.locationId,
        startAt: session.startAt, endAt: event.occurredAt,
        timeZone: session.timeZone, startDate: attendanceLocalDate(session.startAt, session.timeZone),
        breaks: session.breaks,
      };
      next.status = "off";
      next.session = null;
      return { state: next, completedSession };
    }
  }
  return { state: next, completedSession: null };
}

export function summarizeAttendanceSession(session: AttendanceSession) {
  requireScope(session.siteId, session.workerId);
  const start = attendanceInstant(session.startAt), end = attendanceInstant(session.endAt);
  attendanceTimeZone(session.timeZone);
  if (end < start || end - start > 31 * 86_400_000) fail("attendance_interval_out_of_bounds");
  if (session.startDate !== attendanceLocalDate(session.startAt, session.timeZone)) fail("attendance_invalid_start_date");
  checkBreaks(session.breaks, start, end);
  const daily = splitAttendanceIntervalByDay(session.startAt, session.endAt, session.timeZone).map((day) => {
    const from = attendanceInstant(day.startAt), to = attendanceInstant(day.endAt);
    let breakMs = 0, paidBreakMs = 0;
    for (const item of session.breaks) {
      const overlap = Math.max(0, Math.min(to, attendanceInstant(item.endAt)) - Math.max(from, attendanceInstant(item.startAt)));
      breakMs += overlap;
      if (item.paid) paidBreakMs += overlap;
    }
    return { ...day, breakMs, paidBreakMs, workedMs: day.durationMs - breakMs,
      // This is a policy classification, NOT an amount of wages owed.
      creditedMs: day.durationMs - breakMs + paidBreakMs };
  });
  return {
    elapsedMs: end - start,
    breakMs: daily.reduce((sum, day) => sum + day.breakMs, 0),
    paidBreakMs: daily.reduce((sum, day) => sum + day.paidBreakMs, 0),
    workedMs: daily.reduce((sum, day) => sum + day.workedMs, 0),
    creditedMs: daily.reduce((sum, day) => sum + day.creditedMs, 0),
    daily,
  };
}
