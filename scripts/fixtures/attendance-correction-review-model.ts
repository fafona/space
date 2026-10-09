import { correctionBasis, correctionEmployee, correctionWorker, correctionSite, correctionId, correctionNow, correctionProposal, correctionStart } from "./attendance-correction-model";
import type { AttendanceApiFetch } from "../../src/lib/merchantAttendanceSelfClient";
import type { CorrectionReviewResult } from "../../src/lib/merchantAttendanceCorrectionReview";
import {correctionRules} from "./attendance-correction-model";
export const reviewQuery = { siteId: correctionSite, mode: "detail" as const, requestId: correctionId(100) };
export function correctionReviewDetail(): Extract<CorrectionReviewResult, { mode: "detail" }> {
  const basis = correctionBasis();
  const item = { requestId: reviewQuery.requestId, startEventId: correctionStart, revision: 1, status: "submitted" as const,decision:null,
    submittedAt: correctionNow, startAt: correctionProposal.startAt, endAt: correctionProposal.endAt };
  return { siteId: correctionSite, mode: "detail" as const, asOf: correctionNow, approvalAvailable: false as const,rulesEnforced:true,decisionsAvailable:true,
    item: { ...item, workerId: correctionWorker, employeeId: correctionEmployee, workerName: "合成员工", workerNo: "TEST-01" },
    application: { siteId: correctionSite, employeeId: correctionEmployee, workerId: correctionWorker, asOf: correctionNow, canRequest: false,rulesEnforced:true,decisionsAvailable:true,rules:correctionRules("bound"),
      mode: "detail" as const, item, basis, proposal: structuredClone(correctionProposal), reason: "合成资料：核对实际离店时间", withdrawal: null, receipt: null },
    evidence: { bindingCurrent: true, ownApplication: false, currentBasis: structuredClone(basis), basisIssue: null, previous: null, next: null,
      employmentPeriods: [{ startsOn: "2026-01-01", endsOn: null }], employmentTruncated: false } };
}
export function createCorrectionReviewFixture() {
  let mode = "normal"; const calls: { path: string; method: string }[] = [];
  const apiFetch: AttendanceApiFetch = async (path, init) => {
    calls.push({ path, method: init?.method ?? "GET" });
    if (init?.method && init.method !== "GET") throw Error("synthetic_writes_forbidden");
    if (mode === "offline") throw Error("offline");
    if (mode === "denied") return Response.json({ ok: false, error: "attendance_access_denied" }, { status: 403 });
    const q = new URL(path, "https://synthetic.invalid").searchParams;
    if (!path.startsWith("/api/merchant-enterprise/attendance/correction-reviews?")) throw Error("synthetic_route_missing");
    const detail = correctionReviewDetail();
    if (mode === "gap") detail.evidence.employmentPeriods = [];
    if (mode === "binding") detail.evidence.bindingCurrent = false;
    if (mode === "own") detail.evidence.ownApplication = true;
    if (mode === "changed") { detail.application.basis.events.pop(); }
    if (mode === "overlap") { detail.evidence.next = { ...detail.evidence.currentBasis!.events[0], id: correctionId(90), sequence: 3, occurredAt: "2026-09-28T16:30:00.000000Z" }; }
    if (q.get("mode") === "detail") {
      if (q.get("requestId") !== detail.item.requestId) return Response.json({ ok: false, error: "attendance_correction_not_found" }, { status: 404 });
      return Response.json({ ok: true, moduleEnabled: false, ...detail });
    }
    const asOf = q.get("asOf") ?? correctionNow;
    const matches = detail.item.submittedAt >= (q.get("fromAt") ?? "") && detail.item.submittedAt < (q.get("toAt") ?? "")
      && (!q.get("workerId") || q.get("workerId") === detail.item.workerId) && q.get("status") !== "withdrawn" && !q.get("cursorId");
    return Response.json({ ok: true, moduleEnabled: false, siteId: correctionSite, mode: "list", asOf, approvalAvailable: false,rulesEnforced:true,decisionsAvailable:true, scanned: matches ? 1 : 0,
      items: matches ? [detail.item] : [], nextCursor: null });
  };
  return { apiFetch, calls, mode: (value: string) => { mode = value; } };
}
