// Saved v5 source proof only. No current policy, account, Intl or hours
// recomputation; SQL additionally verifies the immutable ledger/source rows.
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { exact, integer, safeTree, safePeriodSourceTree, same, site, stamp, uuid } from "./merchantAttendancePlanExceptionValidation";
import { parseAdministrativeClosureBoundary, type AdministrativeClosureBoundary } from "./merchantAttendanceAdministrativeClosure";
import { administrativeReportBoundaryMatches, administrativeSegmentBoundaries } from "./merchantAttendanceAdministrativeBoundary";
import type { PeriodClosureRange, PeriodClosureWorker } from "./merchantAttendancePeriodClosure";

const VERSION = "attendance-period-source-v5";
const fail = (): never => { throw new MerchantAttendanceError("attendance_period_closure_invalid"); };
function obj(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return fail();
  return v as Record<string, unknown>;
}
function list(v: unknown, max: number): unknown[] { return Array.isArray(v) && v.length <= max ? v : fail(); }

// Strip only this added context for the unchanged prior-context validators.
// Returned/stored artifacts keep their complete original v5 source and bytes.
export function periodSourceWithoutAdministrativeClosures(raw: unknown, completeSource = false) {
  (completeSource ? safePeriodSourceTree : safeTree)(raw, 2097152); const source = obj(raw);
  if (source.sourceVersion !== VERSION) return source;
  const { administrativeClosures: _proof, ...context } = obj(source.context); void _proof;
  return { ...source, sourceVersion: Object.hasOwn(context, "outages") ? "attendance-period-source-v4"
    : Object.hasOwn(context, "posthoc") ? "attendance-period-source-v3"
    : Object.hasOwn(context, "workArrangements") ? "attendance-period-source-v2" : "attendance-period-source-v1", context };
}

// Validate ordered stored events without interpreting their timezone or
// calculating durations. Unknown segments must remain raw/open, not clock-outs.
function events(raw: unknown, readAt: string) {
  const rows = list(raw, 2002); if (!rows.length) fail();
  const seen = new Set<string>(); let status = "off", previousAt = "", previousSequence = 0;
  return rows.map((rawEvent, n) => {
    const e = obj(rawEvent), id = uuid(e.id), sequence = integer(e.sequence), occurredAt = stamp(e.occurredAt);
    if (seen.has(id) || occurredAt > readAt || occurredAt < "2000-01-01" || occurredAt >= "2101-01-01"
      || n > 0 && (sequence !== previousSequence + 1 || occurredAt < previousAt)
      || typeof e.timeZone !== "string" || !e.timeZone || e.timeZone.length > 100
      || !["web", "kiosk"].includes(String(e.source)) || (e.action === "break_start" ? typeof e.breakPaid !== "boolean" : e.breakPaid !== null)) fail();
    uuid(e.locationId);
    if (n === 0 && e.action === "clock_in") status = "working";
    else if (n > 0 && e.action === "break_start" && status === "working") status = "break";
    else if (n > 0 && e.action === "break_end" && status === "break") status = "working";
    else if (n > 0 && e.action === "clock_out" && status === "working") status = "completed";
    else fail();
    seen.add(id); previousAt = occurredAt; previousSequence = sequence;
    return { id, sequence, occurredAt, action: String(e.action) };
  });
}

export function validatePeriodAdministrativeContext(raw: unknown, worker: PeriodClosureWorker, period: PeriodClosureRange,
  computedReport: unknown, completeSource = false): AdministrativeClosureBoundary[] {
  try {
    const tree = completeSource ? safePeriodSourceTree : safeTree;
    tree(raw, 2097152); tree(computedReport, 2097152);
    const s = obj(raw), c = s.context == null ? null : obj(s.context), report = obj(computedReport), b = obj(report.base);
    if (s.sourceVersion !== VERSION) {
      if (c && Object.hasOwn(c, "administrativeClosures") || b.sourceVersion === "raw-and-approved-v3"
        || Object.hasOwn(b, "administrativeUnassessedCount") || Object.hasOwn(b, "totalsComplete")
        || list(b.rows, 100).some(r => Object.hasOwn(obj(r), "administrativeBoundary") || Object.hasOwn(obj(r), "predecessorBoundary"))) fail();
      return [];
    }
    exact(s, ["sourceVersion", "siteId", "workerId", "employeeId", "employeeAuthUserId", "timeZone", "fromDate", "throughDate", "fromAt", "toAt", "dayBoundaries", "report", "context"]);
    if (!c) return fail();
    if (s.workerId !== worker.workerId || s.employeeId !== worker.employeeId || s.employeeAuthUserId !== worker.employeeAuthUserId
      || s.timeZone !== period.timeZone || s.fromDate !== period.fromDate || s.throughDate !== period.throughDate
      || s.fromAt !== period.startAt || s.toAt !== period.endAt) fail();
    const siteId = site(s.siteId), readAt = stamp(b.asOf);
    exact(c, ["pendingCorrections", "missing", "leave", "calendar", "plans", "reviews", "administrativeClosures",
      ...["posthoc", "workArrangements", "outages"].filter(k => Object.hasOwn(c, k))]);
    const plan = exact(c.plans, ["items", "sessions"]), proofs = list(c.administrativeClosures, 200).map(parseAdministrativeClosureBoundary);
    if (!proofs.length) fail();
    let previousId = ""; const byId = new Map<string, AdministrativeClosureBoundary>();
    for (const p of proofs) {
      if (p.startEventId <= previousId || p.siteId !== siteId || p.workerId !== worker.workerId || p.employeeId !== worker.employeeId
        || p.employeeAuthUserId !== worker.employeeAuthUserId || p.recordedAt > readAt) fail();
      previousId = p.startEventId; byId.set(p.startEventId, p);
    }
    const used = new Set<string>(), sessionMap = new Map<string, Record<string, unknown>>();
    for (const rawChild of list(plan.sessions, 100)) {
      const item = exact(obj(rawChild).item, ["startEventId", "events", "effect", "administrativeBoundary", "predecessorBoundary"]);
      const e = events(item.events, readAt), id = uuid(item.startEventId);
      if (id !== e[0].id || sessionMap.has(id)) fail();
      const bs = administrativeSegmentBoundaries(item, e, readAt)!;
      if (bs.administrativeBoundary && item.effect !== null) fail();
      for (const p of [bs.administrativeBoundary, bs.predecessorBoundary]) {
        if (!p) continue; const full = byId.get(p.startEventId);
        if (!full || !administrativeReportBoundaryMatches(p, full)) fail(); used.add(p.startEventId);
      }
      sessionMap.set(id, item);
    }
    if (used.size !== byId.size) fail();
    const wire = obj(s.report), rawBase = obj(wire.base), rawItems = list(rawBase.items, 100), computedRows = list(b.rows, 100);
    if (wire.version !== "attendance-unified-v1" || wire.complete !== true || wire.payrollReady !== false || Object.hasOwn(wire, "access")
      || !["raw-and-approved-v2", "raw-and-approved-v3"].includes(String(rawBase.sourceVersion)) || b.sourceVersion !== rawBase.sourceVersion
      || rawBase.complete !== true || computedRows.length !== rawItems.length || b.siteId !== siteId || rawBase.siteId !== siteId) fail();
    for (const x of [rawBase, b]) {
      if (x.workerId !== worker.workerId || x.employeeId !== worker.employeeId || x.fromDate !== period.fromDate || x.throughDate !== period.throughDate
        || x.timeZone !== period.timeZone || x.fromAt !== period.startAt || x.toAt !== period.endAt) fail();
    }
    let count = 0, complete = true, hasProof = false; const rawIds = new Set<string>();
    for (let i = 0; i < rawItems.length; i++) {
      const item = obj(rawItems[i]), id = uuid(item.startEventId), matched = sessionMap.get(id), row = obj(computedRows[i]);
      if (!matched) return fail();
      if (rawIds.has(id) || row.startEventId !== id) fail(); rawIds.add(id);
      const { administrativeBoundary: own, predecessorBoundary: prior, ...old } = matched;
      if (rawBase.sourceVersion === "raw-and-approved-v3") {
        if (!same(item, matched) || !same(row.administrativeBoundary, own) || !same(row.predecessorBoundary, prior)) fail();
      } else if (!same(item, old) || own !== null || prior !== null || Object.hasOwn(row, "administrativeBoundary") || Object.hasOwn(row, "predecessorBoundary")) fail();
      hasProof ||= own !== null || prior !== null;
      if (own !== null) {
        count++; complete = false; const p = obj(own), original = obj(row.original), selected = obj(row.selected);
        if (row.originalInPeriod !== null || row.selectedInPeriod !== null || row.source !== "original" || row.correction !== null
          || original.startAt !== p.startAt || original.endAt !== null || original.totals !== null || selected.endAt !== null
          || !same(original, selected) || original.status !== (p.tailAction === "break_start" ? "break" : "working")
          || row.lastEventId !== p.tailEventId || !same(row.eventIds, list(item.events, 2002).map(e => obj(e).id))) fail();
      }
      if (obj(list(item.events, 2002).at(-1)).action !== "clock_out") complete = false;
    }
    if (rawBase.sourceVersion === "raw-and-approved-v3") {
      if (!hasProof || [rawBase, b].some(x => x.administrativeUnassessedCount !== count || x.totalsComplete !== complete)) fail();
    } else if ([rawBase, b].some(x => Object.hasOwn(x, "administrativeUnassessedCount") || Object.hasOwn(x, "totalsComplete"))) fail();
    return proofs;
  } catch { return fail(); }
}

// Mirrors195: only a proof used as this segment's own boundary blocks the
// overlapping period; a predecessor proof alone must not block later work.
export function periodAdministrativeHoursUnassessed(raw: unknown): boolean {
  const s = obj(raw); if (s.sourceVersion !== VERSION) return false;
  const fromAt = stamp(s.fromAt), toAt = stamp(s.toAt);
  return list(obj(obj(s.context).plans).sessions, 100).some(child => {
    const b = obj(obj(child).item).administrativeBoundary;
    if (b === null) return false;
    const p = obj(b), startAt = stamp(p.startAt), endAt = stamp(p.verifiedEndAt);
    return startAt === endAt ? startAt >= fromAt && startAt < toAt : startAt < toAt && endAt > fromAt;
  });
}
