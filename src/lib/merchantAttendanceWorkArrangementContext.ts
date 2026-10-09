import { parseWorkArrangementContextItem, type WorkArrangementContextItem } from "./merchantAttendanceWorkArrangement";
import { MerchantAttendanceError } from "./merchantAttendanceTime";

/** Saved UTC and zone literals only: never reinterpret an old archive with the
 * browser's timezone database, current worker binding or current policy. */
export function validatePeriodWorkArrangements(raw: unknown,
  worker: { workerId: string; employeeId: string; employeeAuthUserId: string },
  period: { startAt: string; endAt: string }): WorkArrangementContextItem[] {
  const fail = (): never => { throw new MerchantAttendanceError("attendance_period_closure_invalid"); };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fail();
  const source = raw as Record<string, unknown>;
  const context = source.context && typeof source.context === "object" && !Array.isArray(source.context) ? source.context as Record<string, unknown> : null;
  // Historical v1 validators intentionally accept their original sources.
  // Do not invent an empty work-arrangement section for such archives.
  if (source.sourceVersion !== "attendance-period-source-v2" && source.sourceVersion !== "attendance-period-source-v3") {
    if (context && Object.hasOwn(context, "workArrangements")) fail();
    return [];
  }
  //Posthoc opt-in determines v3 independently of work arrangements. Absence is
  //valid; when this saved section exists, all original v2 checks still apply.
  if (source.sourceVersion === "attendance-period-source-v3" && context && !Object.hasOwn(context, "workArrangements")) return [];
  if (!context || !Array.isArray(context.workArrangements) || !context.workArrangements.length || context.workArrangements.length > 100) return fail();
  try {
    const items = context.workArrangements.map(parseWorkArrangementContextItem);
    let previous = ""; const ids = new Set<string>();
    for (const item of items) {
      const key = item.startAt + item.requestId;
      if (item.workerId !== worker.workerId || item.employeeId !== worker.employeeId || item.employeeAuthUserId !== worker.employeeAuthUserId
        || Date.parse(item.startAt) >= Date.parse(period.endAt) || Date.parse(item.endAt) <= Date.parse(period.startAt)
        || key <= previous || ids.has(item.requestId)) fail();
      previous = key; ids.add(item.requestId);
    }
    return items;
  } catch { return fail(); }
}
