// Read-only boundary validation. A boundary is not a clock-out or assessed work;
// these structural checks do not replace the SQL ledger/source/identity checks.
import { captureBrowserExact, captureBrowserUuid } from "./merchantAttendanceRuleCapturesBrowser";
import { parseAdministrativeClosureBoundary, type AdministrativeClosureBoundary } from "./merchantAttendanceAdministrativeClosure";
import { MerchantAttendanceError } from "./merchantAttendanceTime";

export const ADMINISTRATIVE_REPORT_BOUNDARY_PROTOCOL = "attendance-administrative-report-boundary-v1" as const;
export type AdministrativeReportBoundary = Readonly<{
  protocol: typeof ADMINISTRATIVE_REPORT_BOUNDARY_PROTOCOL; operationId: string;
  startEventId: string; startSequence: number; startAt: string;
  tailEventId: string; tailSequence: number; tailAction: "clock_in" | "break_start" | "break_end";
  tailOccurredAt: string; verifiedEndAt: string; recordedAt: string; sourceFingerprint: string;
}>;
type BoundaryEvent = Readonly<{ id: string; sequence: number; action: string; occurredAt: string }>;
const KEYS = ["protocol", "operationId", "startEventId", "startSequence", "startAt", "tailEventId", "tailSequence", "tailAction", "tailOccurredAt", "verifiedEndAt", "recordedAt", "sourceFingerprint"] as const;
function fail(): never { throw new MerchantAttendanceError("attendance_administrative_closure_invalid"); }
function integer(v: unknown): number { return typeof v === "number" && Number.isSafeInteger(v) && v > 0 && v <= 9007199254740990 ? v : fail(); }
function stamp(v: unknown): string {
  if (typeof v !== "string" || v.length !== 27 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(v)
    || v < "2000-01-01" || v >= "2101-01-01") fail();
  const ms = v.slice(0, 23) + "Z";
  if (!Number.isFinite(Date.parse(ms)) || new Date(ms).toISOString() !== ms) fail();
  return v;
}
export function parseAdministrativeReportBoundary(raw: unknown): AdministrativeReportBoundary {
  try {
    const v = captureBrowserExact(raw, KEYS);
    if (v.protocol !== ADMINISTRATIVE_REPORT_BOUNDARY_PROTOCOL || !["clock_in", "break_start", "break_end"].includes(v.tailAction as string)
      || typeof v.sourceFingerprint !== "string" || v.sourceFingerprint.length !== 64 || !/^[0-9a-f]{64}$/.test(v.sourceFingerprint)) fail();
    const r: AdministrativeReportBoundary = { protocol: ADMINISTRATIVE_REPORT_BOUNDARY_PROTOCOL, operationId: captureBrowserUuid(v.operationId),
      startEventId: captureBrowserUuid(v.startEventId), startSequence: integer(v.startSequence), startAt: stamp(v.startAt),
      tailEventId: captureBrowserUuid(v.tailEventId), tailSequence: integer(v.tailSequence), tailAction: v.tailAction as AdministrativeReportBoundary["tailAction"],
      tailOccurredAt: stamp(v.tailOccurredAt), verifiedEndAt: stamp(v.verifiedEndAt), recordedAt: stamp(v.recordedAt), sourceFingerprint: v.sourceFingerprint };
    if (r.tailSequence < r.startSequence || r.tailSequence - r.startSequence > 2001 || r.tailOccurredAt < r.startAt
      || r.verifiedEndAt < r.tailOccurredAt || r.recordedAt < r.verifiedEndAt) fail();
    if (r.tailSequence === r.startSequence ? r.tailEventId !== r.startEventId || r.tailAction !== "clock_in" || r.tailOccurredAt !== r.startAt
      : r.tailEventId === r.startEventId || r.tailAction === "clock_in") fail();
    return Object.freeze(r);
  } catch { return fail(); }
}
export function administrativeReportBoundaryProjection(raw: AdministrativeClosureBoundary): AdministrativeReportBoundary {
  const full = parseAdministrativeClosureBoundary(raw);
  return parseAdministrativeReportBoundary(Object.fromEntries(KEYS.map(k => [k, k === "protocol" ? ADMINISTRATIVE_REPORT_BOUNDARY_PROTOCOL : full[k]])));
}
export function administrativeReportBoundaryMatches(publicBoundary: AdministrativeReportBoundary, full: AdministrativeClosureBoundary): boolean {
  try { const a = parseAdministrativeReportBoundary(publicBoundary), b = administrativeReportBoundaryProjection(full); return KEYS.every(k => a[k] === b[k]); } catch { return false; }
}
// Both fields must be present together in the new wire branch. Old responses
// retain their exact old shape; explicit undefined/null is not an old branch.
export function administrativeSegmentBoundaries(raw: object, events: readonly BoundaryEvent[], readAt: string):
  { administrativeBoundary: AdministrativeReportBoundary | null; predecessorBoundary: AdministrativeReportBoundary | null } | null {
  const own = Object.getOwnPropertyDescriptor(raw, "administrativeBoundary"), prior = Object.getOwnPropertyDescriptor(raw, "predecessorBoundary");
  if (!own && !prior) return null;
  if (!own || !prior || !("value" in own) || !("value" in prior) || !own.enumerable || !prior.enumerable || !events.length || events[0].action !== "clock_in") fail();
  const administrativeBoundary = own.value === null ? null : parseAdministrativeReportBoundary(own.value);
  const predecessorBoundary = prior.value === null ? null : parseAdministrativeReportBoundary(prior.value);
  const first = events[0], last = events.at(-1)!;
  stamp(readAt);
  if (administrativeBoundary) {
    const b = administrativeBoundary;
    if (b.startEventId !== first.id || b.startSequence !== first.sequence || b.startAt !== first.occurredAt
      || b.tailEventId !== last.id || b.tailSequence !== last.sequence || b.tailAction !== last.action || b.tailOccurredAt !== last.occurredAt
      || b.recordedAt > readAt || events.length !== b.tailSequence - b.startSequence + 1) fail();
  }
  if (predecessorBoundary) {
    const b = predecessorBoundary;
    if (b.tailSequence + 1 !== first.sequence || b.verifiedEndAt > first.occurredAt || b.recordedAt > readAt
      || events.some(e => e.id === b.startEventId || e.id === b.tailEventId)
      || administrativeBoundary?.operationId === b.operationId) fail();
  }
  return { administrativeBoundary, predecessorBoundary };
}
export function administrativeClockBoundary(raw: unknown, expected: {
  siteId: string; workerId: string; status: string; sequence: number;
  lastEvent: (BoundaryEvent & { timeZone: string }) | null;
}): AdministrativeClosureBoundary {
  const b = parseAdministrativeClosureBoundary(raw), e = expected.lastEvent;
  if (!e || expected.status !== "off" || b.siteId !== expected.siteId || b.workerId !== expected.workerId
    || b.tailEventId !== e.id || b.tailSequence !== e.sequence || e.sequence !== expected.sequence || b.tailAction !== e.action
    || b.timeZone !== e.timeZone || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(e.occurredAt)
    || b.tailOccurredAt !== e.occurredAt.slice(0, 23) + "000Z") fail();
  return b;
}
