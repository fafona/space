//215 validates saved values only. Never fetch current identities, rerun clocks,
//or reinterpret a historic period using today's timezone database.
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { exact, integer, micros, safeTree, safePeriodSourceTree, same, site, stamp, uuid } from "./merchantAttendancePlanExceptionValidation";
import { parseOutageInterval, type OutageInterval } from "./merchantAttendanceOutageTime";
import { parseOutageReviewSavedEntry, parseOutageReviewSavedProposal, parseOutageReviewSavedStatus } from "./merchantAttendanceOutageReview";
import type { OutageReviewEntry, OutageReviewProposal, OutageReviewStatus, OutageReviewQuery } from "./merchantAttendanceOutageReviewContract";
import type { PeriodClosureRange, PeriodClosureWorker } from "./merchantAttendancePeriodClosure";

export type PeriodOutageContextEntry = {
  declarationId: string; workerId: string; employeeId: string; employeeAuthUserId: string; interval: OutageInterval;
  revision: number; resultVersion: number; current: OutageReviewEntry | null; proposal: OutageReviewProposal | null; response: OutageReviewEntry | null;
  status: Omit<OutageReviewStatus, "canPropose" | "canConfirm" | "canResolve">;
};
const fail = (): never => { throw new MerchantAttendanceError("attendance_period_closure_invalid"); };
function object(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fail();
  return raw as Record<string, unknown>;
}
// Strip only the new context for the unchanged v1/v2/v3 validators. The actual
// returned/stored artifact remains v4 with its original complete source bytes.
export function periodSourceWithoutOutages(raw: unknown, completeSource = false) {
  (completeSource ? safePeriodSourceTree : safeTree)(raw, 2097152);
  const source = object(raw);
  if (source.sourceVersion !== "attendance-period-source-v4") return source;
  const { outages: _outages, ...context } = object(source.context); void _outages;
  return { ...source, sourceVersion: Object.hasOwn(context, "posthoc") ? "attendance-period-source-v3"
    : Object.hasOwn(context, "workArrangements") ? "attendance-period-source-v2" : "attendance-period-source-v1", context };
}
export function validatePeriodOutageContext(raw: unknown, worker: PeriodClosureWorker, period: PeriodClosureRange, completeSource = false): PeriodOutageContextEntry[] {
  try {
    const tree = completeSource ? safePeriodSourceTree : safeTree;
    tree(raw, 2097152);
    const source = object(raw), context = source.context == null ? null : object(source.context);
    if (source.sourceVersion !== "attendance-period-source-v4") {
      if (context && Object.hasOwn(context, "outages")) fail();
      return [];
    }
    tree(source, 1048576);
    if (!context || source.workerId !== worker.workerId || source.employeeId !== worker.employeeId || source.employeeAuthUserId !== worker.employeeAuthUserId
      || source.fromDate !== period.fromDate || source.throughDate !== period.throughDate || source.timeZone !== period.timeZone
      || source.fromAt !== period.startAt || source.toAt !== period.endAt) return fail();
    const siteId = site(source.siteId);
    exact(context, ["pendingCorrections", "missing", "leave", "calendar", "plans", "reviews", "outages",
      ...(Object.hasOwn(context, "posthoc") ? ["posthoc"] : []), ...(Object.hasOwn(context, "workArrangements") ? ["workArrangements"] : [])]);
    if (!Array.isArray(context.outages) || !context.outages.length || context.outages.length > 100) return fail();
    let previous = "";
    return context.outages.map(rawItem => {
      const item = exact(rawItem, ["declarationId", "workerId", "employeeId", "employeeAuthUserId", "interval", "revision", "resultVersion", "current", "proposal", "response", "status"]);
      const declarationId = uuid(item.declarationId), interval = parseOutageInterval(item.interval, false);
      if (declarationId <= previous || item.workerId !== worker.workerId || item.employeeId !== worker.employeeId || item.employeeAuthUserId !== worker.employeeAuthUserId
        || micros(interval.startAt) >= micros(period.endAt) || micros(interval.endAt) <= micros(period.startAt)) fail();
      previous = declarationId;
      const revision = integer(item.revision, 0, 1000), resultVersion = integer(item.resultVersion, 0, 998);
      if (resultVersion > revision || (revision === 0) !== (resultVersion === 0) || (item.current === null) !== (revision === 0) || (item.proposal === null) !== (resultVersion === 0)) fail();
      // This query labels a pure saved schema. It does not grant owner access
      // or call a privileged endpoint on behalf of the viewing employee.
      const q: OutageReviewQuery = { siteId, access: "owner", declarationId, mode: "detail" };
      const lastAt = item.current === null ? interval.endAt : stamp(object(item.current).recordedAt);
      const current = item.current === null ? null : parseOutageReviewSavedEntry(item.current, lastAt);
      const proposal = item.proposal === null ? null : parseOutageReviewSavedProposal(item.proposal, q, lastAt);
      const response = item.response === null ? null : parseOutageReviewSavedEntry(item.response, lastAt);
      if (current && proposal) {
        const basis = proposal.evidence.linkEvidence;
        if (current.revision !== revision || current.resultVersion !== resultVersion || proposal.resultVersion !== resultVersion
          || current.resultFingerprint !== proposal.resultFingerprint || proposal.revision > current.revision
          || basis.workerId !== worker.workerId || basis.employeeId !== worker.employeeId || basis.employeeAuthUserId !== worker.employeeAuthUserId
          || !same(basis.declaredInterval, interval)) fail();
        if (current.action === "propose" && !same(current, Object.fromEntries(Object.entries(proposal).filter(([k]) => k !== "evidence")))) fail();
      }
      if (response && (!proposal || !current || !["confirm", "dispute"].includes(response.action) || response.resultVersion !== resultVersion
        || response.resultFingerprint !== proposal.resultFingerprint || response.actorId !== worker.employeeAuthUserId
        || response.revision <= proposal.revision || response.revision > current.revision || micros(response.recordedAt) < micros(proposal.recordedAt))) fail();
      if (current && ["confirm", "dispute"].includes(current.action) && !same(current, response) || current?.action === "propose" && response !== null
        || current && ["resolve", "reopen"].includes(current.action) && response?.action !== "confirm") fail();
      const rawStatus = exact(item.status, ["basisFingerprint", "linkOperationId", "linkRevision", "linkFingerprint", "blockers", "resolved"]);
      const parsedStatus = parseOutageReviewSavedStatus({ ...rawStatus, canPropose: false, canConfirm: false, canResolve: false }, q, current, proposal, response, false);
      const { canPropose: _p, canConfirm: _c, canResolve: _r, ...status } = parsedStatus; void _p; void _c; void _r;
      return { declarationId, workerId: worker.workerId, employeeId: worker.employeeId, employeeAuthUserId: worker.employeeAuthUserId,
        interval, revision, resultVersion, current, proposal, response, status };
    });
  } catch { return fail(); }
}
