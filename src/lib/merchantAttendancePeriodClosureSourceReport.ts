import { MERCHANT_ATTENDANCE_ACTIONS } from "./merchantAttendance";
import { attendanceSelfSite, attendanceSelfUuid } from "./merchantAttendanceSelf";
import { attendanceRecordInstant } from "./merchantAttendanceManagement";
import { parseCorrectionProposal } from "./merchantAttendanceCorrection";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import type { AttendanceSessionAmounts, AttendanceSessionEvent, AttendanceSessionReport } from "./merchantAttendanceSession";
import type { AttendanceTimesheetCorrection, AttendanceTimesheetResult, AttendanceTimesheetRow } from "./merchantAttendanceTimesheet";
import type { UnifiedAmounts, UnifiedBase, UnifiedReport, MissingReportSource } from "./merchantAttendanceUnifiedTimesheet";
import type { PeriodDelegatedReport } from "./merchantAttendancePeriodDelegatedArtifact";
import { administrativeSegmentBoundaries, type AdministrativeReportBoundary } from "./merchantAttendanceAdministrativeBoundary";

export type PeriodClosureSourceBasis = {
  siteId: string; access: "owner" | "self"; workerId: string; employeeId: string; employeeAuthUserId: string;
  fromDate: string; throughDate: string; timeZone: string; fromAt: string; toAt: string;
  dayBoundaries: { date: string; fromAt: string; toAt: string; skipped: boolean }[];
};
type Amounts = AttendanceSessionAmounts;
type Span = Omit<AttendanceSessionReport, "days">;
const fields = ["elapsedUs", "breakUs", "paidBreakUs", "workedUs"] as const;
const fail = (code = "attendance_report_invalid_data"): never => { throw new MerchantAttendanceError(code); };
const object = (v: unknown): Record<string, unknown> => {
  if (v === null || typeof v !== "object" || Array.isArray(v) || Object.getPrototypeOf(v) !== Object.prototype
    || Object.keys(v).some(k => ["__proto__", "constructor", "prototype"].includes(k))
    || Object.values(Object.getOwnPropertyDescriptors(v)).some(d => !Object.hasOwn(d, "value") || !d.enumerable)) return fail();
  return v as Record<string, unknown>;
};
const exact = (v: unknown, keys: string[]) => {
  const o = object(v); if (Object.keys(o).length !== keys.length || keys.some(k => !Object.hasOwn(o, k))) fail(); return o;
};
const dense = (v: unknown): v is unknown[] => Array.isArray(v) && Object.getPrototypeOf(v) === Array.prototype
  && Object.keys(v).length === v.length && Object.entries(Object.getOwnPropertyDescriptors(v)).every(([key, d]) => key === "length"
    || /^(0|[1-9]\d*)$/.test(key) && Number(key) < v.length && Object.hasOwn(d, "value") && d.enumerable);
const text = (v: unknown, size: number): string => typeof v === "string" && v.trim() && v.length <= size && !/[\u0000-\u001f\u007f]/.test(v) ? v : fail();
const savedText = (v: unknown, size: number) => { const s = text(v, size); if (s !== s.trim()) fail(); return s; };
// Saved zone names are labels, not requests to consult today's timezone database.
const zone = (v: unknown): string => { const z = text(v, 100); if (z !== "UTC" && !/^[A-Za-z_+-]+(?:\/[A-Za-z0-9_+-]+)+$/.test(z)) fail(); return z; };
const instant = (v: unknown): string => {
  const s = attendanceRecordInstant(v); if (s !== v || s < "2000-01-01" || s >= "2101-01-01") fail(); return s;
};
const boundaryInstant = (v: unknown): string => {
  const s = attendanceRecordInstant(v); if (s !== v) fail(); return s;
};
const date = (v: unknown): string => {
  if (typeof v !== "string" || !/^(?:20\d{2}|2100)-\d{2}-\d{2}$/.test(v)
    || !Number.isFinite(Date.parse(v + "T00:00:00Z")) || new Date(v + "T00:00:00Z").toISOString().slice(0, 10) !== v) return fail();
  return v;
};
const nextDate = (d: string) => new Date(Date.parse(d + "T00:00:00Z") + 86400000).toISOString().slice(0, 10);
const us = (s: string) => BigInt(Date.parse(s.slice(0, 23) + "Z")) * BigInt(1000) + BigInt(s.slice(23, 26));
const max = (a: bigint, b: bigint) => a > b ? a : b, min = (a: bigint, b: bigint) => a < b ? a : b;
const zero = (): Amounts => ({ elapsedUs: 0, breakUs: 0, paidBreakUs: 0, workedUs: 0 });
const add = (a: Amounts, b: Amounts) => { for (const k of fields) { a[k] += b[k]; if (!Number.isSafeInteger(a[k])) fail(); } };
function basis(raw: unknown, delegated: boolean): Omit<PeriodClosureSourceBasis,"access"> & {access:"owner"|"self"|"delegate"} {
  const v = exact(raw, ["siteId", "access", "workerId", "employeeId", "employeeAuthUserId", "fromDate", "throughDate", "timeZone", "fromAt", "toAt", "dayBoundaries"]);
  const fromDate = date(v.fromDate), throughDate = date(v.throughDate), count = (Date.parse(throughDate) - Date.parse(fromDate)) / 86400000 + 1;
  if ((delegated ? v.access !== "delegate" : v.access !== "owner" && v.access !== "self") || count < 1 || count > 31 || !dense(v.dayBoundaries) || v.dayBoundaries.length !== count) fail();
  const fromAt = boundaryInstant(v.fromAt), toAt = boundaryInstant(v.toAt); if (fromAt >= toAt) fail();
  let expectedDate = fromDate, previous = fromAt;
  const dayBoundaries = (v.dayBoundaries as unknown[]).map(raw => {
    const d = exact(raw, ["date", "fromAt", "toAt", "skipped"]), day = date(d.date), start = boundaryInstant(d.fromAt), end = boundaryInstant(d.toAt);
    if (day !== expectedDate || start !== previous || start > end || typeof d.skipped !== "boolean" || d.skipped !== (start === end)) fail();
    expectedDate = nextDate(day); previous = end; return { date: day, fromAt: start, toAt: end, skipped: d.skipped as boolean };
  });
  if (previous !== toAt || dayBoundaries[0].skipped || dayBoundaries.at(-1)!.skipped) fail();
  return { siteId: attendanceSelfSite(v.siteId), access: v.access as "owner" | "self" | "delegate", workerId: attendanceSelfUuid(v.workerId),
    employeeId: attendanceSelfUuid(v.employeeId), employeeAuthUserId: attendanceSelfUuid(v.employeeAuthUserId),
    fromDate, throughDate, timeZone: zone(v.timeZone), fromAt, toAt, dayBoundaries };
}
function intervalAmounts(start: bigint, end: bigint, breaks: Span["breaks"]): Amounts {
  const part = zero(); if (end <= start) return part;
  part.elapsedUs = Number(end - start);
  for (const rest of breaks) {
    const overlap = Number(max(BigInt(0), min(end, us(rest.endAt)) - max(start, us(rest.startAt))));
    part.breakUs += overlap; if (rest.paid) part.paidBreakUs += overlap;
  }
  part.workedUs = part.elapsedUs - part.breakUs;
  if (fields.some(k => !Number.isSafeInteger(part[k]) || part[k] < 0)) fail(); return part;
}
// Same UTC state machine and durations as Session, without its discarded local
// day projection. In particular an open shift has NO estimated totals/end time.
function session(events: AttendanceSessionEvent[]): Span {
  const first = events[0]; if (!first || first.action !== "clock_in" || events.length > 2002) fail("attendance_session_invalid_records");
  let status: Span["status"] = "working", endAt: string | null = null, openBreak: Span["openBreak"] = null;
  const breaks: Span["breaks"] = [];
  for (let n = 1; n < events.length; n++) {
    const e = events[n], previous = events[n - 1];
    if (e.sequence !== previous.sequence + 1 || e.occurredAt < previous.occurredAt || status === "completed") fail("attendance_session_invalid_records");
    if (e.action === "break_start" && status === "working") {
      if (breaks.length >= 1000) fail("attendance_session_too_large"); openBreak = { startAt: e.occurredAt, paid: e.breakPaid! }; status = "break";
    } else if (e.action === "break_end" && status === "break" && openBreak) {
      breaks.push({ ...openBreak, endAt: e.occurredAt }); openBreak = null; status = "working";
    } else if (e.action === "clock_out" && status === "working") { endAt = e.occurredAt; status = "completed"; }
    else fail("attendance_session_invalid_records");
  }
  const base = { status, startAt: first.occurredAt, endAt, timeZone: first.timeZone, breaks, openBreak };
  if (endAt === null) return { ...base, totals: null };
  if (us(endAt) - us(first.occurredAt) > BigInt(2678400000000)) fail("attendance_session_span_too_long");
  return { ...base, totals: intervalAmounts(us(first.occurredAt), us(endAt), breaks) };
}
function combined(original: Amounts, recordedSelected: Amounts, missingSelected: Amounts): UnifiedAmounts {
  const selected = { ...recordedSelected }, difference = zero(); add(selected, missingSelected);
  for (const k of fields) difference[k] = selected[k] - original[k];
  return { original: { ...original }, recordedSelected: { ...recordedSelected }, missingSelected: { ...missingSelected }, selected, difference };
}

/** Closure-only fresh-source projection. The caller binds this SQL-owned basis
 * to sourceCanonical/SHA first. Never use it to reinterpret an existing artifact
 * or accept client-supplied day boundaries for the general dynamic report. */
export function parsePeriodClosureSourceReport(raw: unknown, input: unknown, allowAdministrative = false): UnifiedReport {
  return sourceReport(raw,input,false,allowAdministrative) as UnifiedReport;
}
export function parsePeriodDelegatedSourceReport(raw: unknown, input: unknown, allowAdministrative = false): PeriodDelegatedReport {
  return sourceReport(raw,input,true,allowAdministrative) as PeriodDelegatedReport;
}
function sourceReport(raw:unknown,input:unknown,delegated:boolean,allowAdministrative:boolean):UnifiedReport|PeriodDelegatedReport{
  const f = basis(input,delegated), v = exact(raw, ["version", "access", "base", "missing", "complete", "payrollReady"]), b = object(v.base);
  const administrative = allowAdministrative === true && b.sourceVersion === "raw-and-approved-v3";
  if (v.version !== "attendance-unified-v1" || v.access !== f.access || v.complete !== true || v.payrollReady !== false
    || b.siteId !== f.siteId || b.workerId !== f.workerId || b.employeeId !== f.employeeId || b.fromDate !== f.fromDate || b.throughDate !== f.throughDate
    || b.timeZone !== f.timeZone || b.fromAt !== f.fromAt || b.toAt !== f.toAt || b.complete !== true || (!administrative && b.sourceVersion !== "raw-and-approved-v2")
    || !dense(b.items) || b.items.length > 100 || !dense(v.missing)) fail();
  const asOf = instant(b.asOf), workerName = text(b.workerName, 120), workerNo = text(b.workerNo, 40);
  if (f.access === "self" && (b.access !== "self" || b.viewerEmployeeId !== f.employeeId || b.scopeRevision !== null || b.locationId !== null
    || b.coverage !== "authorized-complete-sessions-v1" || b.accessValidUntil !== null)) fail();
  if (f.access === "delegate" && ["access","viewerEmployeeId","scopeRevision","locationId","coverage","accessValidUntil"].some(k=>Object.hasOwn(b,k))) fail();
  const from = us(f.fromAt), to = us(f.toAt), days = f.dayBoundaries.filter(d => !d.skipped).map(d => ({ date: d.date, original: zero(), selected: zero() }));
  const ranges = f.dayBoundaries.filter(d => !d.skipped).map(d => ({ from: us(d.fromAt), to: us(d.toAt) }));
  const allEvents = new Set<string>(), requests = new Set<string>(), operations = new Set<string>(), rootRequests = new Set<string>(), rootOperations = new Set<string>();
  let totalEvents = 0, previousSequence = 0, previousAt = "", previousOpen = false;
  let previousBoundary: AdministrativeReportBoundary | null = null, hasBoundary = false;
  const clipped = (span: Span, kind: "original" | "selected") => {
    const amount = zero(); if (span.endAt === null) return amount;
    for (let n = 0; n < ranges.length; n++) {
      const part = intervalAmounts(max(ranges[n].from, us(span.startAt)), min(ranges[n].to, us(span.endAt)), span.breaks);
      add(amount, part); add(days[n][kind], part);
    }
    return amount;
  };
  const relevant = (s: Span) => s.endAt === null ? s.startAt < f.toAt && asOf > f.fromAt : s.startAt < f.toAt && (s.endAt > f.fromAt || s.startAt >= f.fromAt);
  const rows = (b.items as unknown[]).map((raw): AttendanceTimesheetRow => {
    const item = exact(raw, ["startEventId", "events", "effect", ...(administrative ? ["administrativeBoundary", "predecessorBoundary"] : [])]), startEventId = attendanceSelfUuid(item.startEventId);
    if (!dense(item.events) || item.events.length < 1 || item.events.length > 2002 || (totalEvents += item.events.length) > 4000) fail();
    const events = (item.events as unknown[]).map((raw): AttendanceSessionEvent => {
      const e = object(raw), id = attendanceSelfUuid(e.id), occurredAt = instant(e.occurredAt);
      if (allEvents.has(id) || !Number.isSafeInteger(e.sequence) || Number(e.sequence) < 1 || !MERCHANT_ATTENDANCE_ACTIONS.includes(e.action as AttendanceSessionEvent["action"])
        || e.source !== "web" && e.source !== "kiosk" || (e.action === "break_start" ? typeof e.breakPaid !== "boolean" : e.breakPaid !== null)
        || occurredAt > asOf || f.access === "self" && e.actorEmployeeId !== f.employeeId) fail();
      allEvents.add(id); return { id, locationId: attendanceSelfUuid(e.locationId), sequence: Number(e.sequence), action: e.action as AttendanceSessionEvent["action"],
        occurredAt, timeZone: zone(e.timeZone), breakPaid: e.breakPaid as boolean | null, source: e.source as "web" | "kiosk" };
    });
    const boundaries = administrative ? administrativeSegmentBoundaries(item, events, asOf) : null;
    const ownBoundary = boundaries?.administrativeBoundary ?? null, predecessor = boundaries?.predecessorBoundary ?? null;
    if (administrative && !boundaries) fail();
    if (previousBoundary && events[0].sequence === previousSequence + 1 && JSON.stringify(predecessor) !== JSON.stringify(previousBoundary)) fail();
    if (predecessor && predecessor.tailSequence <= previousSequence && JSON.stringify(predecessor) !== JSON.stringify(previousBoundary)) fail();
    if (previousOpen || events[0].id !== startEventId || events[0].sequence <= previousSequence || events[0].occurredAt < previousAt) fail();
    previousSequence = events.at(-1)!.sequence; previousAt = events.at(-1)!.occurredAt;
    const original = session(events); let selected = original, correction: AttendanceTimesheetCorrection | null = null;
    previousOpen = original.endAt === null && !ownBoundary; previousBoundary = ownBoundary;
    if (ownBoundary) { if (item.effect !== null) fail(); previousAt = ownBoundary.verifiedEndAt; }
    hasBoundary ||= !!ownBoundary || !!predecessor;
    if (item.effect !== null) {
      const e = object(item.effect), requestId = attendanceSelfUuid(e.requestId), operationId = attendanceSelfUuid(e.operationId), recordedAt = instant(e.recordedAt);
      if (original.status !== "completed" || !Number.isSafeInteger(e.revision) || Number(e.revision) < 1 || Number(e.revision) > 2147483647
        || e.action !== "approve" || e.calculationVersion !== "declaration-v1" || !Number.isSafeInteger(e.policyRevision) || Number(e.policyRevision) < 1 || Number(e.policyRevision) > 9007199254740989
        || e.timeZone !== original.timeZone || e.originalLastEventId !== events.at(-1)!.id || recordedAt > asOf || recordedAt < original.endAt!
        || requests.has(requestId) || operations.has(operationId) || f.access === "self" && e.employeeId !== f.employeeId) fail();
      requests.add(requestId); operations.add(operationId);
      const p = parseCorrectionProposal(e.proposal, recordedAt), first = events[0];
      const positions = [{ action: "clock_in" as const, occurredAt: p.startAt, breakPaid: null }, ...p.breaks.flatMap(rest => [
        { action: "break_start" as const, occurredAt: rest.startAt, breakPaid: rest.paid }, { action: "break_end" as const, occurredAt: rest.endAt, breakPaid: null }]),
        { action: "clock_out" as const, occurredAt: p.endAt, breakPaid: null }];
      selected = session(positions.map((p, n) => ({ ...first, ...p, sequence: n + 1 })));
      for (const k of fields) if (!Number.isSafeInteger(e[k]) || e[k] !== selected.totals![k]) fail();
      const l = exact(e.lineage, ["rootRequestId", "rootOperationId", "rootRecordedAt", "previousOperationId"]);
      const rootRequestId = attendanceSelfUuid(l.rootRequestId), rootOperationId = attendanceSelfUuid(l.rootOperationId), rootRecordedAt = instant(l.rootRecordedAt);
      const previousOperationId = l.previousOperationId === null ? null : attendanceSelfUuid(l.previousOperationId);
      if (rootRequests.has(rootRequestId) || rootOperations.has(rootOperationId) || rootRecordedAt < original.endAt! || rootRecordedAt > recordedAt
        || (e.revision === 1 ? rootRequestId !== requestId || rootOperationId !== operationId || rootRecordedAt !== recordedAt || previousOperationId !== null
          : rootRequestId === requestId || rootOperationId === operationId || rootRecordedAt >= recordedAt || previousOperationId === null || previousOperationId === operationId
          || (e.revision === 2 ? previousOperationId !== rootOperationId : previousOperationId === rootOperationId))) fail();
      rootRequests.add(rootRequestId); rootOperations.add(rootOperationId);
      correction = { requestId, operationId, revision: Number(e.revision), policyRevision: Number(e.policyRevision), recordedAt,
        lineage: { rootRequestId, rootOperationId, rootRecordedAt, previousOperationId } };
    }
    if (ownBoundary ? !(ownBoundary.startAt < f.toAt && (ownBoundary.verifiedEndAt > f.fromAt || ownBoundary.startAt >= f.fromAt)) : !relevant(original) && !relevant(selected)) fail();
    return { startEventId, lastEventId: events.at(-1)!.id, eventIds: events.map(e => e.id), source: correction ? "approved" : "original", original, selected, correction,
      originalInPeriod: ownBoundary ? null : clipped(original, "original"), selectedInPeriod: ownBoundary ? null : clipped(selected, "selected"), ...(boundaries ?? {}) };
  });
  const selectedIntervals = rows.filter(r => r.selected.endAt !== null).map(r => ({ from: max(from, us(r.selected.startAt)), to: min(to, us(r.selected.endAt!)) }))
    .filter(s => s.to > s.from).sort((a, b) => a.from < b.from ? -1 : a.from > b.from ? 1 : 0);
  for (let n = 1; n < selectedIntervals.length; n++) if (selectedIntervals[n].from < selectedIntervals[n - 1].to) fail("attendance_report_overlap");
  const original = zero(), selected = zero(), difference = zero();
  for (const day of days) { add(original, day.original); add(selected, day.selected); }
  for (const k of fields) difference[k] = selected[k] - original[k];
  const openSessionCount = rows.filter(r => r.original.endAt === null).length, administrativeUnassessedCount = rows.filter(r => r.administrativeBoundary).length, totalsComplete = administrativeUnassessedCount === 0 && openSessionCount === 0;
  if (administrative && (!hasBoundary || b.administrativeUnassessedCount !== administrativeUnassessedCount || b.totalsComplete !== totalsComplete)) fail();
  const base: AttendanceTimesheetResult = { siteId: f.siteId, workerId: f.workerId, fromDate: f.fromDate, throughDate: f.throughDate, sourceVersion: administrative ? "raw-and-approved-v3" : "raw-and-approved-v2",
    ...(administrative ? { administrativeUnassessedCount, totalsComplete } : {}),
    employeeId: f.employeeId, workerName, workerNo, fromAt: f.fromAt, toAt: f.toAt, timeZone: f.timeZone, asOf, calculationVersion: "attendance-timesheet-v1", payrollReady: false,
    rows, days, skippedDates: f.dayBoundaries.filter(d => d.skipped).map(d => d.date), totals: { original, selected, difference }, openSessionCount, periodInProgress: f.toAt > asOf };
  let outputBase: UnifiedBase = base;
  if (f.access === "self") {
    const { employeeId: _employee, ...rest } = base; void _employee;
    outputBase = { ...rest, access: "self", viewerEmployeeId: f.employeeId, scopeRevision: null, locationId: null, coverage: "authorized-complete-sessions-v1", accessValidUntil: null };
  }
  const rawMissing = v.missing as unknown[];
  if (rawMissing.length + rows.length > 100) fail("attendance_report_too_large");
  const daily = days.map(d => ({ date: d.date, ...combined(d.original, d.selected, zero()) }));
  const missingIds = new Set<string>(), missingOperations = new Set<string>(); let prior: MissingReportSource | null = null;
  const intervals = rows.map(r => ({ from: r.selected.startAt, to: r.selected.endAt ?? r.administrativeBoundary?.verifiedEndAt ?? asOf })).filter(s => s.from < s.to && s.to > f.fromAt && s.from < f.toAt);
  const missing = rawMissing.map(raw => {
    const m = object(raw), requestId = attendanceSelfUuid(m.requestId), operationId = attendanceSelfUuid(m.operationId), workerId = attendanceSelfUuid(m.workerId);
    const employeeId = m.employeeId === null ? null : attendanceSelfUuid(m.employeeId), locationId = attendanceSelfUuid(m.locationId);
    const p = parseCorrectionProposal(m.proposal), submittedAt = instant(m.submittedAt), approvedAt = instant(m.approvedAt);
    if (us(p.endAt) - us(p.startAt) > BigInt(86400000000) || p.breaks.length > 8 || m.source !== "missing-approved" || workerId !== f.workerId
      || requestId === operationId || p.endAt > submittedAt || submittedAt > approvedAt || approvedAt > asOf || p.startAt >= f.toAt || p.endAt <= f.fromAt
      || !Number.isSafeInteger(m.policyRevision) || Number(m.policyRevision) < 1 || Number(m.policyRevision) > 9007199254740989
      || (f.access === "self" ? employeeId !== f.employeeId : employeeId !== null) || missingIds.has(requestId) || missingOperations.has(operationId)
      || prior && (p.startAt < prior.proposal.startAt || p.startAt === prior.proposal.startAt && requestId <= prior.requestId)) fail();
    const source: MissingReportSource = { source: "missing-approved", requestId, operationId, workerId, employeeId, locationId,
      workerName: savedText(m.workerName, 120), locationName: savedText(m.locationName, 120), timeZone: zone(m.timeZone), policyRevision: Number(m.policyRevision), proposal: p, submittedAt, approvedAt };
    missingIds.add(requestId); missingOperations.add(operationId); prior = source;
    const inPeriod = zero();
    for (let n = 0; n < ranges.length; n++) {
      const part = intervalAmounts(max(ranges[n].from, us(p.startAt)), min(ranges[n].to, us(p.endAt)), p.breaks);
      add(inPeriod, part); add(daily[n].missingSelected, part);
    }
    intervals.push({ from: p.startAt, to: p.endAt }); return { ...source, inPeriod };
  });
  intervals.sort((a, b) => a.from.localeCompare(b.from));
  for (let n = 1; n < intervals.length; n++) if (intervals[n].from < intervals[n - 1].to) fail("attendance_report_reconciliation_required");
  const missingSelected = zero(); for (const m of missing) add(missingSelected, m.inPeriod);
  const combinedReport = { version: "attendance-unified-v1" as const, missing,
    days: daily.map(d => ({ date: d.date, ...combined(d.original, d.recordedSelected, d.missingSelected) })),
    totals: combined(original, selected, missingSelected), complete: true as const, payrollReady: false as const };
  return f.access==="delegate"?{...combinedReport,access:"delegate",base}:{...combinedReport,access:f.access,base:outputBase};
}
