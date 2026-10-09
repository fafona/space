import { attendanceSelfSite, attendanceSelfUuid } from "./merchantAttendanceSelf";
import { attendanceRecordInstant } from "./merchantAttendanceManagement";
import { attendanceDayUtcRange, attendanceTimeZone, MerchantAttendanceError } from "./merchantAttendanceTime";
import { parseCorrectionResult, previewCorrection, type CorrectionResult, type CorrectionSummary } from "./merchantAttendanceCorrection";
import { parseAttendanceSessionResult, type AttendanceSessionEvent, type AttendanceSessionResult } from "./merchantAttendanceSession";

export type CorrectionReviewQuery = { siteId: string } & (
  { mode: "list"; fromAt: string; toAt: string; workerId: string | null; status: "all" | "submitted" | "withdrawn";
    asOf: string | null; cursorAt: string | null; cursorId: string | null } | { mode: "detail"; requestId: string });
export type CorrectionReviewItem = CorrectionSummary & { workerId: string; employeeId: string; workerName: string; workerNo: string };
export const CORRECTION_BASIS_ISSUES = ["attendance_session_not_found", "attendance_session_invalid_records", "attendance_session_too_large",
  "attendance_session_span_too_long", "attendance_correction_unsupported_basis"] as const;
export type CorrectionReviewEvidence = { bindingCurrent: boolean; ownApplication: boolean; currentBasis: AttendanceSessionResult | null;
  basisIssue: typeof CORRECTION_BASIS_ISSUES[number] | null; previous: AttendanceSessionEvent | null; next: AttendanceSessionEvent | null;
  employmentPeriods: { startsOn: string; endsOn: string | null }[]; employmentTruncated: boolean };
export type CorrectionReviewResult = { siteId: string; asOf: string; approvalAvailable: false; rulesEnforced?:true;decisionsAvailable?:true } & (
  { mode: "list"; items: CorrectionReviewItem[]; scanned: number; nextCursor: { recordedAt: string; requestId: string } | null } |
  { mode: "detail"; item: CorrectionReviewItem; application: Extract<CorrectionResult, { mode: "detail" }>; evidence: CorrectionReviewEvidence });
const fail = (): never => { throw new MerchantAttendanceError("attendance_invalid_request"); };
const obj = (v: unknown): Record<string, unknown> => !v || typeof v !== "object" || Array.isArray(v) ? fail() : v as Record<string, unknown>;
const bool = (v: unknown) => typeof v === "boolean" ? v : fail();
const label = (v: unknown, max: number) => typeof v === "string" && v.trim() && [...v].length <= max && !/[\u0000-\u001f\u007f-\u009f]/.test(v) ? v : fail();
const date = (v: unknown) => { if (typeof v !== "string") return fail(); attendanceDayUtcRange(v, "UTC"); return v; };
const micros = (v: string) => BigInt(Date.parse(v.slice(0, 23) + "Z")) * BigInt(1000) + BigInt(v.slice(23, 26));
export function correctionReviewQueryString(q: CorrectionReviewQuery) { return new URLSearchParams(Object.entries(q).filter((e): e is [string, string] => e[1] !== null)).toString(); }
export function parseCorrectionReviewQuery(url: string): CorrectionReviewQuery {
  const p = new URL(url).searchParams, mode = p.get("mode"), siteId = attendanceSelfSite(p.get("siteId"));
  const allowed = mode === "detail" ? ["siteId", "mode", "requestId"] : mode === "list" ? ["siteId", "mode", "fromAt", "toAt", "workerId", "status", "asOf", "cursorAt", "cursorId"] : fail();
  for (const k of p.keys()) if (!allowed.includes(k) || p.getAll(k).length !== 1) fail();
  if (mode === "detail") return { siteId, mode, requestId: attendanceSelfUuid(p.get("requestId")) };
  const fromAt = attendanceRecordInstant(p.get("fromAt")), toAt = attendanceRecordInstant(p.get("toAt")), status = p.get("status");
  const asOf = p.has("asOf") ? attendanceRecordInstant(p.get("asOf")) : null;
  const cursorAt = p.has("cursorAt") ? attendanceRecordInstant(p.get("cursorAt")) : null, cursorId = p.has("cursorId") ? attendanceSelfUuid(p.get("cursorId")) : null;
  if (fromAt >= toAt || micros(toAt) - micros(fromAt) > BigInt(2678400000000) || fromAt < "2000-01-01" || toAt > "2101-01-01T00:00:00.000000Z"
    || !["all", "submitted", "withdrawn"].includes(status ?? "") || (cursorAt === null) !== (cursorId === null)
    || cursorAt && (!asOf || cursorAt < fromAt || cursorAt >= toAt || cursorAt > asOf)) fail();
  return { siteId, mode: "list", fromAt, toAt, status: status as "all" | "submitted" | "withdrawn", asOf, cursorAt, cursorId,
    workerId: p.has("workerId") ? attendanceSelfUuid(p.get("workerId")) : null };
}
function item(raw: unknown, siteId: string, asOf: string): CorrectionReviewItem {
  const v = obj(raw), workerId = attendanceSelfUuid(v.workerId), employeeId = attendanceSelfUuid(v.employeeId);
  const parsed = parseCorrectionResult({ siteId, workerId, employeeId, asOf, canRequest: false, mode: "list", items: [v], nextCursor: null },
    { siteId, expectedWorkerId: workerId, mode: "list", cursorAt: null, cursorId: null });
  if (parsed.mode !== "list") return fail();
  return { ...parsed.items[0], workerId, employeeId, workerName: label(v.workerName, 120), workerNo: label(v.workerNo, 40) };
}
function boundary(raw: unknown, action: "clock_in" | "clock_out", asOf: string): AttendanceSessionEvent | null {
  if (raw === null) return null;
  const v = obj(raw), occurredAt = attendanceRecordInstant(v.occurredAt);
  if (v.action !== action || v.breakPaid !== null || !["web", "kiosk"].includes(String(v.source))
    || !Number.isSafeInteger(v.sequence) || Number(v.sequence) < 1 || Number(v.sequence) > Number.MAX_SAFE_INTEGER || occurredAt > asOf) fail();
  // Neighboring shifts can have a different location/time zone; do not use the label for instant comparison.
  return { id: attendanceSelfUuid(v.id), locationId: attendanceSelfUuid(v.locationId), sequence: Number(v.sequence), action,
    occurredAt, timeZone: attendanceTimeZone(v.timeZone as string), breakPaid: null, source: v.source as "web" | "kiosk" };
}
export function parseCorrectionReviewResult(raw: unknown, q: CorrectionReviewQuery, requireRules=false,requireDecisions=false): CorrectionReviewResult {
  const v = obj(raw), asOf = attendanceRecordInstant(v.asOf);
  if (v.siteId !== q.siteId || v.mode !== q.mode || v.approvalAvailable !== false) fail();
  if(requireRules&&v.rulesEnforced!==true)fail();
  if((requireDecisions||v.decisionsAvailable!==undefined)&&v.decisionsAvailable!==true)fail();
  const base = { siteId: q.siteId, asOf, approvalAvailable: false as const,...(v.rulesEnforced===true?{rulesEnforced:true as const}:{}),...(v.decisionsAvailable===true?{decisionsAvailable:true as const}:{}) };
  if (q.mode === "list") {
    if (q.asOf !== null && asOf !== q.asOf || !Number.isSafeInteger(v.scanned) || Number(v.scanned) < 0 || Number(v.scanned) > 50
      || !Array.isArray(v.items) || v.items.length > Number(v.scanned)) fail();
    let previous = q.cursorAt ? { recordedAt: q.cursorAt, requestId: q.cursorId! } : null;
    const items = (v.items as unknown[]).map(raw => {
      const r = item(raw, q.siteId, asOf);
      if(v.decisionsAvailable===true&&r.decision===undefined)fail();
      if (r.submittedAt < q.fromAt || r.submittedAt >= q.toAt || q.workerId && r.workerId !== q.workerId || q.status !== "all" && r.status !== q.status
        || previous && (r.submittedAt > previous.recordedAt || r.submittedAt === previous.recordedAt && r.requestId >= previous.requestId)) fail();
      previous = { recordedAt: r.submittedAt, requestId: r.requestId }; return r;
    });
    if (new Set(items.map(i => i.requestId)).size !== items.length) fail();
    let nextCursor = null;
    if (v.nextCursor !== null) {
      const c = obj(v.nextCursor); nextCursor = { recordedAt: attendanceRecordInstant(c.recordedAt), requestId: attendanceSelfUuid(c.requestId) };
      if (v.scanned !== 50 || nextCursor.recordedAt < q.fromAt || nextCursor.recordedAt >= q.toAt || nextCursor.recordedAt > asOf
        || previous && (nextCursor.recordedAt > previous.recordedAt || nextCursor.recordedAt === previous.recordedAt && nextCursor.requestId > previous.requestId)
        || q.cursorAt && (nextCursor.recordedAt > q.cursorAt || nextCursor.recordedAt === q.cursorAt && nextCursor.requestId >= q.cursorId!)) fail();
    }
    return { ...base, mode: "list", items, scanned: Number(v.scanned), nextCursor };
  }
  const r = item(v.item, q.siteId, asOf), a = obj(v.application);
  if (r.requestId !== q.requestId || a.canRequest !== false || a.receipt !== null || a.asOf !== asOf) fail();
  const application = parseCorrectionResult(a, { siteId: q.siteId, expectedWorkerId: r.workerId, mode: "detail", requestId: q.requestId, operationId: null },requireRules,requireDecisions||v.decisionsAvailable===true);
  if (application.mode !== "detail" || application.employeeId !== r.employeeId || Object.keys(application.item).some(k => JSON.stringify(application.item[k as keyof CorrectionSummary]) !== JSON.stringify(r[k as keyof CorrectionSummary]))) return fail();
  const e = obj(v.evidence), basisIssue = e.basisIssue === null ? null : CORRECTION_BASIS_ISSUES.includes(e.basisIssue as typeof CORRECTION_BASIS_ISSUES[number]) ? e.basisIssue as typeof CORRECTION_BASIS_ISSUES[number] : fail();
  const currentBasis = e.currentBasis === null ? null : parseAttendanceSessionResult(e.currentBasis, { siteId: q.siteId, startEventId: r.startEventId });
  if ((currentBasis === null) !== (basisIssue !== null) || currentBasis && (currentBasis.workerId !== r.workerId || currentBasis.employeeId !== r.employeeId
    || currentBasis.asOf !== asOf || currentBasis.events.length > 202)) fail();
  let previous: AttendanceSessionEvent | null = null, next: AttendanceSessionEvent | null = null;
  if (currentBasis) {
    const first = currentBasis.events[0], last = currentBasis.events.at(-1)!;
    previous = boundary(e.previous, "clock_out", asOf); next = boundary(e.next, "clock_in", asOf);
    if (first.sequence === 1 ? previous !== null : !previous || previous.sequence !== first.sequence - 1 || previous.occurredAt > first.occurredAt) fail();
    if (next && (last.action !== "clock_out" || next.sequence !== last.sequence + 1 || next.occurredAt < last.occurredAt)) fail();
  } else if (e.previous !== null || e.next !== null) fail();
  if (!Array.isArray(e.employmentPeriods) || e.employmentPeriods.length > 100) fail();
  let priorDate = "";
  const employmentPeriods = (e.employmentPeriods as unknown[]).map(raw => { const p = obj(raw), startsOn = date(p.startsOn), endsOn = p.endsOn === null ? null : date(p.endsOn);
    if (startsOn <= priorDate || endsOn && endsOn < startsOn) fail(); priorDate = startsOn; return { startsOn, endsOn }; });
  if (e.employmentTruncated === true && employmentPeriods.length !== 100) fail();
  return { ...base, mode: "detail", item: r, application, evidence: { bindingCurrent: bool(e.bindingCurrent), ownApplication: bool(e.ownApplication),
    basisIssue, currentBasis, previous, next, employmentPeriods, employmentTruncated: bool(e.employmentTruncated) } };
}
export const CORRECTION_CHECK_LABELS = {
  withdrawn: "申请已撤回", binding_changed: "原申请账号或人员绑定已改变", self_review: "负责人不能审批本人申请",
  basis_unavailable: "当前原始班次无法完整核对", basis_changed: "提交后原始打卡已变化", open_session: "原始班次尚未结束",
  overlap_previous: "声明开始早于前一班次结束", overlap_next: "声明结束晚于后一班次开始", employment_gap: "声明未完全落在在职日期内",
  employment_ambiguous: "在职区间重叠，需要核查", employment_limit: "在职区间超过核对上限",
  declaration_range: "声明日期超出当前考勤支持范围（2000–2100）",
  declaration_unreviewable: "声明时段无法按班次时区完整计算，需要核查",
} as const;
export type CorrectionCheckIssue = keyof typeof CORRECTION_CHECK_LABELS;
export function correctionReviewComparison(r: Extract<CorrectionReviewResult, { mode: "detail" }>) {
  const a = r.application;
  if (a.proposal.startAt < "2000-01-01T00:00:00.000000Z" || a.proposal.endAt > "2101-01-01T00:00:00.000000Z") return null;
  try { return previewCorrection(a.basis, a.proposal); }
  catch { return null; } // Keep historical declarations visible without crashing the owner screen.
}
export function inspectCorrectionReview(r: Extract<CorrectionReviewResult, { mode: "detail" }>) {
  const issues: CorrectionCheckIssue[] = [], e = r.evidence, a = r.application;
  if (a.item.status === "withdrawn") issues.push("withdrawn");
  if (!e.bindingCurrent) issues.push("binding_changed"); if (e.ownApplication) issues.push("self_review");
  if (!e.currentBasis) issues.push("basis_unavailable");
  else {
    if (JSON.stringify(e.currentBasis.events) !== JSON.stringify(a.basis.events)) issues.push("basis_changed");
    if (e.currentBasis.events.at(-1)?.action !== "clock_out") issues.push("open_session");
    if (e.previous && a.proposal.startAt < e.previous.occurredAt) issues.push("overlap_previous");
    if (e.next && a.proposal.endAt > e.next.occurredAt) issues.push("overlap_next");
  }
  const comparison = correctionReviewComparison(r);
  if (a.proposal.startAt < "2000-01-01T00:00:00.000000Z" || a.proposal.endAt > "2101-01-01T00:00:00.000000Z") issues.push("declaration_range");
  else if (!comparison) issues.push("declaration_unreviewable");
  if (e.employmentTruncated) issues.push("employment_limit");
  else if (comparison) {
    // Shared instant-based, half-open day splitting also skips nonexistent calendar days.
    for (const day of comparison.proposed.days) {
      const count = e.employmentPeriods.filter(p => p.startsOn <= day.date && (!p.endsOn || p.endsOn >= day.date)).length;
      if (!count && !issues.includes("employment_gap")) issues.push("employment_gap");
      if (count > 1 && !issues.includes("employment_ambiguous")) issues.push("employment_ambiguous");
    }
  }
  return { kind: "read_only_preflight" as const, approvalAvailable: false as const, issues,
    remainingChecks: [...(a.rules ? [] : ["申请期限与审批政策尚未接入本核对流程", "工时锁定周期尚未接入本核对流程"]), "本页不提供审批操作；须在决定事务重新核对全部事实与核定修订", "周期报表、已批准后的再次修订与工资尚未接入"] };
}
export const CORRECTION_REVIEW_ERRORS: Readonly<Record<string, number>> = { attendance_invalid_request: 400, attendance_invalid_instant: 400,
  attendance_access_denied: 403, attendance_settings_required: 409, attendance_correction_not_found: 404, attendance_rate_limited: 429 };
