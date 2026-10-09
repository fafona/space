import assert from "node:assert/strict";
import test from "node:test";
import { createPlanPosthocFormalCases, planPosthocFormalCases, planPosthocFormalExpected } from "./attendance-plan-posthoc-formal-cases";

const by = (group: string) => { const value = planPosthocFormalCases.find(c => c.group === group); assert(value, group); return value.expectedDerived5; };
test("206 private SQL inputs are bounded detached normalized172 facts, with exact five-field TS oracles", () => {
  assert.equal(planPosthocFormalCases.length, 19); assert.equal(new Set(planPosthocFormalCases.map(c => c.group)).size, 19);
  const copy = createPlanPosthocFormalCases(); assert.deepEqual(copy, planPosthocFormalCases);
  copy[0].facts.source.posthoc.current!.reason = "Detached mutation"; assert.notEqual(copy[0].facts.source.posthoc.current!.reason, planPosthocFormalCases[0].facts.source.posthoc.current!.reason);
  for (const c of planPosthocFormalCases) {
    assert.deepEqual(Object.keys(c.facts).sort(), ["protocol", "siteId", "actorId", "worker", "slot", "readAt", "source", "fingerprint"].sort());
    assert.deepEqual(Object.keys(c.expectedDerived5).sort(), ["state", "eligible", "blockers", "leaveEdges", "candidate"].sort());
    assert.equal(c.facts.siteId, "99990009"); assert.equal(c.facts.protocol, "plan-posthoc-evaluation-v1");
    assert(!JSON.stringify(c.facts).includes('"sealed"')); assert(Buffer.byteLength(JSON.stringify(c.facts)) < 131072);
    assert.deepEqual(planPosthocFormalExpected(JSON.parse(JSON.stringify(c.facts))), c.expectedDerived5);
  }
});
test("full approved leave without work is not_applicable, not fabricated edges, zero work or cleared", () => {
  const r = by("full_leave_no_work_no_rule"); assert.equal(r.state, "not_applicable"); assert(r.eligible); assert.deepEqual(r.blockers, []);
  assert.equal(r.leaveEdges.fullCoverage, true); assert.deepEqual(r.leaveEdges.work, []); assert.deepEqual(r.leaveEdges.remainingRequired, []);
  assert.deepEqual(r.candidate.selected, { startAt: null, endAt: null }); assert.equal(r.candidate.late.state, "blocked"); assert.equal(r.candidate.early.state, "blocked");
});
test("edge leave changes only required edges, internal leave cannot excuse the two outer edges", () => {
  const edge = by("partial_edges_touch_work"); assert.equal(edge.state, "required"); assert.equal(edge.leaveEdges.requiredStartAt, "2026-10-08T08:10:00.000000Z");
  assert.equal(edge.leaveEdges.requiredEndAt, "2026-10-08T15:50:00.000000Z"); assert.deepEqual(edge.leaveEdges.workLeaveOverlaps, []);
  assert.equal(edge.candidate.late.rawDeltaUs, "0"); assert.equal(edge.candidate.early.rawDeltaUs, "0");
  const inner = by("internal_leave_keeps_outer_edges"); assert.equal(inner.state, "required"); assert.equal(inner.leaveEdges.remainingRequired?.length, 2);
  assert.equal(inner.leaveEdges.requiredStartAt, "2026-10-08T08:00:00.000000Z"); assert.equal(inner.leaveEdges.requiredEndAt, "2026-10-08T16:00:00.000000Z");
  assert.equal(inner.candidate.late.excessUs, "600000000"); assert.equal(inner.candidate.early.excessUs, "300000000"); assert.deepEqual(inner.leaveEdges.workLeaveOverlaps, []);
});
test("touching and overlapping leave union is clipped, preserves both refs and never duplicates coverage", () => {
  for (const name of ["touching_leave_union", "overlapping_leave_clipped_union"]) {
    const r = by(name); assert.equal(r.state, "not_applicable"); const coverage = r.leaveEdges.approvedCoverage!;
    assert.equal(coverage.length, 1); assert.equal(coverage[0].startAt, "2026-10-08T08:00:00.000000Z"); assert.equal(coverage[0].endAt, "2026-10-08T16:00:00.000000Z"); assert.equal(coverage[0].leaveRefs.length, 2);
  }
  const conflict = by("actual_work_overlaps_leave"); assert.equal(conflict.state, "blocked"); assert(conflict.blockers.includes("work_leave_overlap")); assert.equal(conflict.leaveEdges.workLeaveOverlaps?.length, 1);
});
test("microsecond work/leave overlap and lateness are not rounded away", () => {
  const overlap = by("one_microsecond_leave_overlap"); assert.equal(overlap.state, "blocked"); assert(overlap.blockers.includes("work_leave_overlap"));
  assert.equal(overlap.leaveEdges.workLeaveOverlaps?.length, 1);
  assert.equal(overlap.leaveEdges.workLeaveOverlaps![0].startAt, "2026-10-08T08:09:59.999999Z"); assert.equal(overlap.leaveEdges.workLeaveOverlaps![0].endAt, "2026-10-08T08:10:00.000000Z");
  const late = by("one_microsecond_late"); assert.equal(late.state, "required"); assert.equal(late.candidate.late.rawDeltaUs, "1"); assert.equal(late.candidate.late.excessUs, "1");
});
test("saved UTC windows spanning both Madrid DST changes are evaluated without current Intl day boundaries", () => {
  const original = Intl.DateTimeFormat;
  try {
    Intl.DateTimeFormat = function () { throw Error("no current timezone projection permitted"); } as unknown as typeof Intl.DateTimeFormat;
    for (const group of ["spring_dst_fixed_utc", "autumn_dst_fixed_utc"]) {
      const c = planPosthocFormalCases.find(c => c.group === group)!; const r = planPosthocFormalExpected(c.facts);
      assert.equal(r.state, "required"); assert.equal(r.candidate.late.rawDeltaUs, "600000001"); assert.equal(r.candidate.early.rawDeltaUs, "600000000");
      assert.equal(r.leaveEdges.plan.startAt.slice(11), "00:00:00.000000Z"); assert.equal(r.leaveEdges.plan.endAt.slice(11), "03:00:00.000000Z");
    }
  } finally { Intl.DateTimeFormat = original; }
});
test("no work and unresolved leave are blocked, not absence or an empty known context", () => {
  const empty = by("no_work_not_absence"); assert.equal(empty.state, "blocked"); assert(empty.blockers.includes("work_endpoint_missing"));
  const unknown = by("unresolved_leave_not_empty"); assert.equal(unknown.state, "blocked"); assert(unknown.blockers.includes("context_unknown")); assert.equal(unknown.leaveEdges.approvedCoverage, null); assert.equal(unknown.leaveEdges.fullCoverage, null);
});
test("disabled and unconfigured rules retain distinct nonnumeric states; absent/revoked ledgers map to formal blocked", () => {
  assert.equal(by("original_associated_zero_and_five_minute_rules").candidate.late.minutes, 0);
  for (const [group, state] of [["disabled_not_zero", "disabled"], ["unconfigured_not_zero", "unconfigured"]]) {
    const r = by(group); assert.equal(r.state, "required"); assert.deepEqual(r.candidate.late, { state, minutes: null, rawDeltaUs: null, excessUs: null });
  }
  for (const group of ["revoked_not_active", "no_posthoc_ledger"]) { const r = by(group); assert.equal(r.state, "blocked"); assert.equal(r.eligible, false); assert(r.blockers.includes("posthoc_inactive")); }
});
test("work-v2 retained source is not leave or attendance and submitted work still blocks", () => {
  const pending = by("work_v2_pending"); assert.equal(pending.state, "blocked"); assert(pending.blockers.includes("work_arrangement_pending"));
  const approved = by("work_v2_approved_not_work_or_leave"); assert.equal(approved.state, "required"); assert.equal(approved.leaveEdges.work.length, 1); assert.deepEqual(approved.leaveEdges.leave.items, []);
  assert.deepEqual(approved.candidate, by("original_associated_zero_and_five_minute_rules").candidate);
});
