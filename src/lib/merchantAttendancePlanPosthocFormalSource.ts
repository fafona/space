import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { exact, safeTree, same, freeze } from "./merchantAttendancePlanExceptionValidation";
import { parsePlanExceptionSource } from "./merchantAttendancePlanExceptionSource";
import { PLAN_ADOPTION_VIEW_ERRORS } from "./merchantAttendancePlanAdoptionView";
import { PLAN_POSTHOC_EVALUATION_ERRORS, parsePlanPosthocEvaluation, parsePlanPosthocEvaluationQuery } from "./merchantAttendancePlanPosthocEvaluation";
import type { PlanPosthocFormalSource, PlanPosthocFormalSourceQuery, PlanPosthocFormalSourceResult, PlanPosthocFormalSourceV3Result } from "./merchantAttendancePlanPosthocFormalSourceContract";
export type { PlanPosthocFormalSource, PlanPosthocFormalSourceQuery, PlanPosthocFormalSourceResult, PlanPosthocFormalSourceV3Result, PlanPosthocFormalSourceState } from "./merchantAttendancePlanPosthocFormalSourceContract";

export const PLAN_POSTHOC_FORMAL_SOURCE_ERRORS: Readonly<Record<string, number>> = Object.freeze({
  ...PLAN_ADOPTION_VIEW_ERRORS, ...PLAN_POSTHOC_EVALUATION_ERRORS,
  attendance_work_arrangement_too_large: 422, attendance_work_arrangement_invalid: 503, attendance_work_arrangement_binding_changed: 409,
  attendance_plan_exception_invalid: 503, attendance_plan_exception_too_large: 422,
  attendance_plan_posthoc_formal_invalid: 503, attendance_plan_posthoc_formal_too_large: 422,
});
const invalid = (): never => { throw new MerchantAttendanceError("attendance_plan_posthoc_formal_invalid"); };
export const parsePlanPosthocFormalSourceQuery = parsePlanPosthocEvaluationQuery;

// This deliberately does not normalize the wire. SQL must supply canonical
//facts already stripped of sealed-only write eligibility, otherwise its hash
//would describe different evidence than the result shown to the caller.
export function parsePlanPosthocFormalSource(raw: unknown, query: PlanPosthocFormalSourceQuery, expectedActorId: string): PlanPosthocFormalSourceResult {
  let detached: unknown;
  try { safeTree(raw, 3145728); detached = JSON.parse(JSON.stringify(raw)); }
  catch { return invalid(); }
  const protocol = (detached as { protocol?: unknown } | null)?.protocol;
  if (protocol === "plan-exception-source-v1" || protocol === "plan-exception-source-v2") {
    return parsePlanExceptionSource(detached, query, expectedActorId);
  }
  try {
    const v = exact(detached, ["protocol", "siteId", "actorId", "worker", "slot", "readAt", "source", "fingerprint", "state", "eligible", "blockers", "candidate", "leaveEdges"]);
    if (v.protocol !== "plan-exception-source-v3") return invalid();
    safeTree(v.source, 1048576);
    const s = exact(v.source, ["protocol", "policy", "evaluation"]);
    if (s.protocol !== "plan-exception-evidence-v3" || s.policy !== "owner-confirmed-plan-edges-posthoc-v3") return invalid();
    const result = parsePlanPosthocEvaluation({ protocol: "plan-posthoc-evaluation-v1", siteId: v.siteId, actorId: v.actorId,
      worker: v.worker, slot: v.slot, readAt: v.readAt, source: s.evaluation, fingerprint: v.fingerprint }, query, expectedActorId);
    if (result.source.posthoc.current === null || result.source.posthoc.revision < 1
      || result.source.observations.some(o => o.current?.blockers.includes("sealed"))) return invalid();
    const state = result.state === "not_active" ? "blocked" : result.state;
    for (const [actual, expected] of [[v.state, state], [v.eligible, result.eligible], [v.blockers, result.blockers],
      [v.candidate, result.candidate], [v.leaveEdges, result.leaveEdges]]) if (!same(actual, expected)) return invalid();
    const source: PlanPosthocFormalSource = { protocol: "plan-exception-evidence-v3", policy: "owner-confirmed-plan-edges-posthoc-v3", evaluation: result.source };
    // Keep canonical fields byte-equivalent in value (including timestamp
    //precision); don't return a normalized source whose hash was never checked.
    if (!same(v.source, source)) return invalid();
    const checked: PlanPosthocFormalSourceV3Result = { protocol: "plan-exception-source-v3", siteId: result.siteId, actorId: result.actorId,
      worker: result.worker, slot: result.slot, readAt: result.readAt, source, fingerprint: result.fingerprint,
      state, eligible: result.eligible, blockers: result.blockers, candidate: result.candidate, leaveEdges: result.leaveEdges };
    safeTree(checked, 3145728); return freeze(checked);
  } catch { return invalid(); }
}
