import type { SourcesResult } from "./merchantAttendanceSources";
import type { LeaveStatus } from "./merchantAttendanceLeave";
import { attendanceRecordInstant } from "./merchantAttendanceManagement";
import { attendanceSelfSite, attendanceSelfUuid } from "./merchantAttendanceSelf";
import { attendanceDayUtcRange, attendanceTimeZone, MerchantAttendanceError } from "./merchantAttendanceTime";

export type ScheduleEvidenceRelation = "schedule-limited" | "outside-window" | "zero-duration" | "no-time-candidate" | "one-time-candidate" | "ambiguous";
export type ScheduleEvidenceRecord = Readonly<{
  key: string; kind: "original" | "approved" | "missing-approved"; referenceId: string; startEventId: string | null;
  operationId: string | null; revision: number | null; startAt: string; endAt: string | null; timeZone: string;
  observedUntilAt: string | null; windowPartial: boolean; candidateScheduleIds: readonly string[];
  relation: ScheduleEvidenceRelation; reasons: readonly string[];
  timeDifference: Readonly<{ scheduleId: string; startDeltaUs: number; endDeltaUs: number }> | null;
}>;
export type ScheduleEvidenceSlot = Readonly<{
  id: string; revision: number; locationId: string; locationName: string; timeZone: string;
  startAt: string; endAt: string; cancelled: boolean; windowPartial: boolean; phase: "future" | "ongoing" | "ended";
  leave: readonly Readonly<{ requestId: string; operationId: string; revision: number; status: LeaveStatus; employeeMatches: boolean; fromAt: string; toAt: string }>[];
  calendar: readonly Readonly<{ entryId: string; revision: number; status: "created" | "cancelled"; title: string; kind: "holiday" | "closure"; locationId: string | null; timeZone: string; fromAt: string; toAt: string }>[];
}>;
export type ScheduleEvidenceView = Readonly<{
  kind: "original" | "selected"; records: readonly ScheduleEvidenceRecord[];
  schedules: readonly Readonly<{ id: string; recordKeys: readonly string[]; relation: ScheduleEvidenceRelation }>[];
}>;
export type ScheduleEvidenceResult = Readonly<{
  protocol: "schedule-evidence-v1"; siteId: string; workerId: string; actorId: string; timeZone: string;
  fromAt: string; toAt: string; readAt: string; asOf: string; applied: false; formalReady: false;
  coverage: Readonly<{ schedule: "complete" | "limited"; leave: "complete" | "limited"; calendar: "complete" | "limited"; identityChanged: boolean }>;
  limitations: readonly string[]; slots: readonly ScheduleEvidenceSlot[]; views: readonly ScheduleEvidenceView[];
}>;

const invalid = (): never => { throw new MerchantAttendanceError("attendance_schedule_evidence_invalid"); };
const tooLarge = (): never => { throw new MerchantAttendanceError("attendance_schedule_evidence_too_large"); };
const min = (a: bigint, b: bigint) => a < b ? a : b, max = (a: bigint, b: bigint) => a > b ? a : b;
function at(value: unknown) {
  // A legal local query at 2000/2100 can have a UTC boundary in1999/2101.
  // The Sources parser already restricts event/read times and local dates.
  return attendanceRecordInstant(value);
}
const us = (value: string) => BigInt(Date.parse(`${value.slice(0,23)}Z`)) * BigInt(1000) + BigInt(value.slice(23,26));
const stamp = (value: bigint) => `${new Date(Number(value / BigInt(1000))).toISOString().slice(0,23)}${String(value % BigInt(1000)).padStart(3,"0")}Z`;
function integer(value: number) { if (!Number.isSafeInteger(value) || value < 1) invalid(); return value; }
function label(value: string) { if (typeof value !== "string" || !value || [...value].length > 160 || /[\u0000-\u001f\u007f]/.test(value)) invalid(); return value; }
function bounded<T>(items: T[]) { if (!Array.isArray(items)) invalid(); if (items.length > 100) tooLarge(); return items; }
function unique(values: string[]) { if (new Set(values).size !== values.length) invalid(); }
function intersection(a: bigint, b: bigint, c: bigint, d: bigint): [bigint, bigint] | null {
  const start = max(a,c), end = min(b,d); return start < end ? [start,end] : null;
}

/**
 * Pure time-candidate display of an ALREADY PARSED SourcesResult. Not a wire
 * validator, authorization boundary, historical binding resolver or assessment.
 * In particular Sources128 omits historical punch identity/location and the153
 * rule bindings. A unique temporal edge does not establish a formal match.
 * Never applies grace rules, sums hours, invents a clock-out or writes anything.
 */
export function resolveAttendanceScheduleEvidence(source: SourcesResult): ScheduleEvidenceResult {
  if (!source || source.protocol !== "sources-v1" || !source.worker || !source.attendance
    || source.attendance.version !== "attendance-unified-v1" || source.attendance.access !== "owner"
    || source.attendance.complete !== true || source.attendance.payrollReady !== false || !Array.isArray(source.warnings)) invalid();
  const siteId = attendanceSelfSite(source.siteId), workerId = attendanceSelfUuid(source.worker.workerId), actorId = attendanceSelfUuid(source.actorId);
  const timeZone = attendanceTimeZone(source.timeZone), fromAt = at(source.fromAt), toAt = at(source.toAt), readAt = at(source.readAt);
  const base = source.attendance.base;
  if (!base || !("employeeId" in base) || base.siteId !== siteId || base.workerId !== workerId || base.timeZone !== timeZone
    || base.employeeId !== source.worker.employeeId || base.fromDate !== source.fromDate || base.throughDate !== source.throughDate
    || at(base.fromAt) !== fromAt || at(base.toAt) !== toAt || base.payrollReady !== false) invalid();
  const asOf = at(base.asOf), from = us(fromAt), to = us(toAt), observed = us(asOf);
  if (from >= to || asOf > readAt || fromAt !== at(attendanceDayUtcRange(source.fromDate,timeZone).startAt)
    || toAt !== at(attendanceDayUtcRange(source.throughDate,timeZone).endAt)) invalid();
  const dateCount = (Date.parse(source.throughDate) - Date.parse(source.fromDate))/86400000 + 1;
  if (!Number.isInteger(dateCount) || dateCount < 1 || dateCount > 7) invalid();
  const rows = bounded(base.rows), missing = bounded(source.attendance.missing);
  if (rows.length + missing.length > 100) tooLarge();
  for (const key of ["schedule","leave","calendar"] as const) {
    const section = source[key];
    if (!section || typeof section.limited !== "boolean") invalid();
    bounded<unknown>(section.items);
    if (section.limited && section.items.length) invalid();
  }
  const identityChanged = source.warnings.some(w => w === "identity_changed" || w === "assignment_identity_changed" || w === "leave_identity_changed")
    || source.leave.items.some(item => item.employeeId !== source.worker.employeeId);
  const coverage = Object.freeze({schedule: source.schedule.limited ? "limited" : "complete", leave: source.leave.limited ? "limited" : "complete",
    calendar: source.calendar.limited ? "limited" : "complete", identityChanged} as const);
  const limitations = Object.freeze(["temporal_candidates_only","location_not_proven","historical_identity_not_proven","clock_rule_binding_not_loaded","current_sources_not_frozen"]);

  // Normalize date precision once. Calendar scope is the actual schedule's
  // saved location, never the worker's current default. Cancelled notices remain
  // visible as cancelled, not as active exemptions. Intersections are query-only.
  const leaves = source.leave.items.map(item => {
    if (item.workerId !== workerId || !["submitted","withdrawn","approved","rejected","cancelled"].includes(item.summary.status)) invalid();
    const start = us(at(item.summary.startAt)), end = us(at(item.summary.endAt)); if (start >= end) invalid();
    return {start,end,value:{requestId:attendanceSelfUuid(item.summary.requestId),operationId:attendanceSelfUuid(item.operationId),
      revision:integer(item.summary.revision),status:item.summary.status,employeeMatches:item.employeeId === source.worker.employeeId}};
  });
  const calendars = source.calendar.items.map(item => {
    if (!["created","cancelled"].includes(item.status) || !["holiday","closure"].includes(item.kind)) invalid();
    const zone = attendanceTimeZone(item.timeZone), start = us(at(attendanceDayUtcRange(item.fromDate,zone).startAt)), end = us(at(attendanceDayUtcRange(item.throughDate,zone).endAt));
    if (start >= end) invalid();
    return {start,end,value:{entryId:attendanceSelfUuid(item.entryId),revision:integer(item.revision),status:item.status,title:label(item.title),kind:item.kind,
      locationId:item.locationId === null ? null : attendanceSelfUuid(item.locationId),timeZone:zone}};
  });
  unique(leaves.map(item => item.value.requestId)); unique(calendars.map(item => item.value.entryId));
  const slots: ScheduleEvidenceSlot[] = source.schedule.items.map(slot => {
    if (slot.workerId !== workerId || typeof slot.cancelled !== "boolean") invalid();
    const startAt = at(slot.startAt), endAt = at(slot.endAt), start = us(startAt), end = us(endAt);
    if (start >= end || end-start > BigInt(86400000000) || !intersection(start,end,from,to)) invalid();
    const locationId = attendanceSelfUuid(slot.locationId), clipStart = max(start,from), clipEnd = min(end,to);
    const leave = leaves.flatMap(item => {
      const part = intersection(item.start,item.end,clipStart,clipEnd);
      return part ? [Object.freeze({...item.value,fromAt:stamp(part[0]),toAt:stamp(part[1])})] : [];
    });
    const calendar = calendars.flatMap(item => {
      if (item.value.locationId !== null && item.value.locationId !== locationId) return [];
      const part = intersection(item.start,item.end,clipStart,clipEnd);
      return part ? [Object.freeze({...item.value,fromAt:stamp(part[0]),toAt:stamp(part[1])})] : [];
    });
    return Object.freeze({id:attendanceSelfUuid(slot.id),revision:integer(slot.revision),locationId,locationName:label(slot.locationName),timeZone:attendanceTimeZone(slot.timeZone),
      startAt,endAt,cancelled:slot.cancelled,windowPartial:start < from || end > to,phase:observed < start ? "future" : observed < end ? "ongoing" : "ended",
      leave:Object.freeze(leave),calendar:Object.freeze(calendar)});
  });
  unique(slots.map(slot => slot.id));
  const active = slots.filter(slot => !slot.cancelled).sort((a,b) => a.startAt.localeCompare(b.startAt) || a.id.localeCompare(b.id));
  const byId = new Map(active.map(slot => [slot.id,slot]));
  for (let n=1;n<active.length;n++) if (active[n].startAt < active[n-1].endAt) invalid();

  type Input = {key:string;kind:ScheduleEvidenceRecord["kind"];referenceId:string;startEventId:string|null;operationId:string|null;revision:number|null;startAt:string;endAt:string|null;timeZone:string};
  function graph(kind: ScheduleEvidenceView["kind"]): ScheduleEvidenceView {
    const inputs: Input[] = rows.map(row => {
      if (!["original","approved"].includes(row.source) || (row.source === "approved") !== (row.correction !== null)) invalid();
      const span = kind === "original" ? row.original : row.selected, startEventId = attendanceSelfUuid(row.startEventId);
      const corrected = kind === "selected" && row.source === "approved";
      return {key:`raw:${startEventId}`,kind:corrected ? "approved" : "original",referenceId:startEventId,startEventId,
        operationId:corrected ? attendanceSelfUuid(row.correction!.operationId) : null,revision:corrected ? integer(row.correction!.revision) : null,
        startAt:at(span.startAt),endAt:span.endAt === null ? null : at(span.endAt),timeZone:attendanceTimeZone(span.timeZone)};
    });
    if (kind === "selected") for (const item of missing) {
      if (item.source !== "missing-approved" || item.workerId !== workerId) invalid();
      const requestId = attendanceSelfUuid(item.requestId);
      inputs.push({key:`missing:${requestId}`,kind:"missing-approved",referenceId:requestId,startEventId:null,
        operationId:attendanceSelfUuid(item.operationId),revision:null,startAt:at(item.proposal.startAt),endAt:at(item.proposal.endAt),timeZone:attendanceTimeZone(item.timeZone)});
    }
    unique(inputs.map(item => item.key));
    const edges = new Map(active.map(slot => [slot.id,[] as string[]]));
    const candidates = inputs.map(item => {
      const start = us(item.startAt), end = item.endAt === null ? observed : us(item.endAt);
      if (start > observed || end > observed || end < start) invalid();
      const pointInWindow = start >= from && start < to;
      const visible = intersection(start,end,from,to), zeroDuration = item.endAt !== null && start === end;
      const ids = visible ? active.filter(slot => intersection(visible[0],visible[1],us(slot.startAt),us(slot.endAt))).map(slot => slot.id) : [];
      for (const id of ids) edges.get(id)!.push(item.key);
      return {item,start,end,visible,zeroDuration,pointInWindow,ids};
    });
    const records = candidates.map(({item,start,end,visible,zeroDuration,pointInWindow,ids}): ScheduleEvidenceRecord => {
      const windowPartial = start < from || end > to, reasons: string[] = [];
      if (windowPartial) reasons.push("record_crosses_window");
      if (item.endAt === null) reasons.push("open_record");
      if (identityChanged) reasons.push("identity_changed");
      if (source.leave.limited) reasons.push("leave_limited");
      if (source.calendar.limited) reasons.push("calendar_limited");
      if (!source.worker.active) reasons.push("inactive_worker");
      const slot = ids.length === 1 ? byId.get(ids[0])! : null;
      if (ids.some(id => byId.get(id)!.windowPartial)) reasons.push("schedule_crosses_window");
      if (ids.some(id => byId.get(id)!.phase !== "ended")) reasons.push("schedule_not_ended");
      const ambiguous = ids.length > 1 || ids.some(id => edges.get(id)!.length > 1);
      const relation: ScheduleEvidenceRelation = !visible && !pointInWindow ? "outside-window" : zeroDuration ? "zero-duration"
        : source.schedule.limited ? "schedule-limited" : !ids.length ? "no-time-candidate" : ambiguous ? "ambiguous" : "one-time-candidate";
      if (ambiguous) reasons.push("multiple_temporal_candidates");
      // Signed literal differences ONLY. No grace rules or leave/calendar
      // deductions. A unique edge still lacks historical identity/location.
      const timeDifference = relation === "one-time-candidate" && slot && !reasons.length && item.endAt !== null
        ? Object.freeze({scheduleId:slot.id,startDeltaUs:Number(start-us(slot.startAt)),endDeltaUs:Number(end-us(slot.endAt))}) : null;
      return Object.freeze({...item,observedUntilAt:item.endAt === null ? asOf : null,windowPartial,candidateScheduleIds:Object.freeze(ids),relation,reasons:Object.freeze(reasons),timeDifference});
    });
    const schedules = active.map(slot => {
      const recordKeys = edges.get(slot.id)!, ambiguous = recordKeys.length > 1 || recordKeys.some(key => records.find(row => row.key === key)!.candidateScheduleIds.length > 1);
      const relation: ScheduleEvidenceRelation = source.schedule.limited ? "schedule-limited" : !recordKeys.length ? "no-time-candidate" : ambiguous ? "ambiguous" : "one-time-candidate";
      return Object.freeze({id:slot.id,recordKeys:Object.freeze(recordKeys),relation});
    });
    return Object.freeze({kind,records:Object.freeze(records),schedules:Object.freeze(schedules)});
  }
  return Object.freeze({protocol:"schedule-evidence-v1",siteId,workerId,actorId,timeZone,fromAt,toAt,readAt,asOf,applied:false,formalReady:false,
    coverage,limitations,slots:Object.freeze(slots),views:Object.freeze([graph("original"),graph("selected")])});
}
