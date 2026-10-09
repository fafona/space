import { attendanceSelfUuid } from "./merchantAttendanceSelf";
import { attendanceRecordInstant } from "./merchantAttendanceManagement";
import { attendanceDayUtcRange, attendanceTimeZone, MerchantAttendanceError } from "./merchantAttendanceTime";
import { missingProposal } from "./merchantAttendanceMissing";
import { parseAttendanceTimesheetQuery, parseAttendanceTimesheetResult, type AttendanceTimesheetQuery, type AttendanceTimesheetResult } from "./merchantAttendanceTimesheet";
import { parseAttendanceScopedTimesheetQuery, parseAttendanceScopedTimesheetResult, ATTENDANCE_SCOPED_TIMESHEET_ERRORS, type AttendanceScopedTimesheetQuery, type AttendanceScopedTimesheetResult } from "./merchantAttendanceScopedTimesheet";
import { parseAttendanceTimesheetResponse } from "./merchantAttendanceTimesheetResponse";
import { parseScopedTimesheetResponse } from "./merchantAttendanceScopedTimesheetResponse";
import type { CorrectionProposal } from "./merchantAttendanceCorrection";
import type { AttendanceSessionAmounts as Amounts } from "./merchantAttendanceSession";
import { currentAttendanceReportVersion } from "./merchantAttendanceCurrentReportVersion";
export type UnifiedQuery = (AttendanceTimesheetQuery & { access: "owner" }) | AttendanceScopedTimesheetQuery;
export type UnifiedBase = AttendanceTimesheetResult | AttendanceScopedTimesheetResult;
export type MissingReportSource = { source: "missing-approved"; requestId: string; operationId: string; workerId: string; employeeId: string | null;
  workerName: string; locationId: string; locationName: string; timeZone: string; policyRevision: number; proposal: CorrectionProposal; submittedAt: string; approvedAt: string };
export type UnifiedAmounts = { original: Amounts; recordedSelected: Amounts; missingSelected: Amounts; selected: Amounts; difference: Amounts };
export type UnifiedReport = { version: "attendance-unified-v1"; access: UnifiedQuery["access"]; base: UnifiedBase; missing: (MissingReportSource & { inPeriod: Amounts })[];
  days: ({ date: string } & UnifiedAmounts)[]; totals: UnifiedAmounts; complete: true; payrollReady: false };
const keys = ["elapsedUs", "breakUs", "paidBreakUs", "workedUs"] as const;
const fail = (code = "attendance_report_invalid_data"): never => { throw new MerchantAttendanceError(code); };
const object = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : fail();
const instant = (v: unknown) => { const s = attendanceRecordInstant(v); if (v !== s || s < "2000-01-01" || s >= "2101-01-01") fail(); return s; };
const text = (v: unknown, max = 120) => typeof v === "string" && v === v.trim() && v.length > 0 && v.length <= max && !/[\u0000-\u001f\u007f]/.test(v) ? v : fail();
const us = (s: string) => BigInt(Date.parse(s.slice(0, 23) + "Z")) * BigInt(1000) + BigInt(s.slice(23, 26));
const max = (a: bigint, b: bigint) => a > b ? a : b, min = (a: bigint, b: bigint) => a < b ? a : b;
const zero = (): Amounts => ({ elapsedUs: 0, breakUs: 0, paidBreakUs: 0, workedUs: 0 });
const add = (a: Amounts, b: Amounts) => { for (const k of keys) { a[k] += b[k]; if (!Number.isSafeInteger(a[k])) fail(); } };
export function unifiedQueryString(q: UnifiedQuery) { const p = new URLSearchParams(); for (const [k, v] of Object.entries(q)) if (v !== null) p.set(k, v); return p.toString(); }
export function parseUnifiedQuery(url: string): UnifiedQuery {
  const u = new URL(url), access = u.searchParams.get("access");
  if (u.searchParams.getAll("access").length !== 1) fail("attendance_invalid_request");
  if (access === "owner") { u.searchParams.delete("access"); return { ...parseAttendanceTimesheetQuery(u.toString()), access }; }
  return parseAttendanceScopedTimesheetQuery(url);
}
function source(raw: unknown, base: UnifiedBase, q: UnifiedQuery): MissingReportSource {
  const v = object(raw), requestId = attendanceSelfUuid(v.requestId), operationId = attendanceSelfUuid(v.operationId), workerId = attendanceSelfUuid(v.workerId);
  const employeeId = v.employeeId === null ? null : attendanceSelfUuid(v.employeeId), locationId = attendanceSelfUuid(v.locationId);
  const proposal = missingProposal(v.proposal), submittedAt = instant(v.submittedAt), approvedAt = instant(v.approvedAt);
  if (v.source !== "missing-approved" || workerId !== base.workerId || requestId === operationId || proposal.endAt > submittedAt || submittedAt > approvedAt || approvedAt > base.asOf
    || proposal.startAt >= base.toAt || proposal.endAt <= base.fromAt || !Number.isSafeInteger(v.policyRevision) || Number(v.policyRevision) < 1 || Number(v.policyRevision) > 9007199254740989) fail();
  if (q.access === "self" ? !("viewerEmployeeId" in base) || employeeId !== base.viewerEmployeeId : employeeId !== null) fail();
  if (q.access === "manager" && locationId !== q.locationId) fail();
  return { source: "missing-approved", requestId, operationId, workerId, employeeId, locationId, workerName: text(v.workerName), locationName: text(v.locationName),
    timeZone: attendanceTimeZone(text(v.timeZone)), policyRevision: Number(v.policyRevision), proposal, submittedAt, approvedAt };
}
function combined(original: Amounts, recordedSelected: Amounts, missingSelected: Amounts): UnifiedAmounts {
  const selected = { ...recordedSelected }, difference = zero(); add(selected, missingSelected);
  for (const k of keys) difference[k] = selected[k] - original[k];
  return { original: { ...original }, recordedSelected: { ...recordedSelected }, missingSelected: { ...missingSelected }, selected, difference };
}
// No synthetic event IDs, no writeback and no conversion of a declaration into an
// original punch. Original selected calculations are reused without modification.
function assemble(base: UnifiedBase, rawMissing: unknown, q: UnifiedQuery): UnifiedReport {
  if (!Array.isArray(rawMissing)) return fail();
  if (rawMissing.length + base.rows.length > 100) fail("attendance_report_too_large");
  const requests = new Set<string>(), operations = new Set<string>();
  const daily = base.days.map(d => ({ date: d.date, ...combined(d.original, d.selected, zero()) }));
  const ranges = daily.map(d => { const range = attendanceDayUtcRange(d.date, base.timeZone); return { from: us(attendanceRecordInstant(range.startAt)), to: us(attendanceRecordInstant(range.endAt)) }; });
  // Administrative ends delimit overlap coverage only, never measured work.
  const intervals = base.rows.map(r => ({ from: r.selected.startAt, to: r.selected.endAt ?? r.administrativeBoundary?.verifiedEndAt ?? base.asOf })).filter(s => s.from < s.to && s.to > base.fromAt && s.from < base.toAt);
  let prior: MissingReportSource | null = null;
  const missing = rawMissing.map(raw => {
    const m = source(raw, base, q);
    if (requests.has(m.requestId) || operations.has(m.operationId) || prior && (m.proposal.startAt < prior.proposal.startAt || m.proposal.startAt === prior.proposal.startAt && m.requestId <= prior.requestId)) fail();
    requests.add(m.requestId); operations.add(m.operationId); prior = m;
    const inPeriod = zero();
    const from = us(m.proposal.startAt), to = us(m.proposal.endAt);
    for (let n = 0; n < ranges.length; n++) {
      const a = max(from, ranges[n].from), b = min(to, ranges[n].to); if (b <= a) continue;
      const part = zero(); part.elapsedUs = Number(b - a);
      for (const rest of m.proposal.breaks) { const overlap = Number(max(BigInt(0), min(b, us(rest.endAt)) - max(a, us(rest.startAt)))); part.breakUs += overlap; if (rest.paid) part.paidBreakUs += overlap; }
      part.workedUs = part.elapsedUs - part.breakUs; add(inPeriod, part); add(daily[n].missingSelected, part);
    }
    intervals.push({ from: m.proposal.startAt, to: m.proposal.endAt }); return { ...m, inPeriod };
  });
  intervals.sort((a, b) => a.from.localeCompare(b.from));
  for (let n = 1; n < intervals.length; n++) if (intervals[n].from < intervals[n - 1].to) fail("attendance_report_reconciliation_required");
  const missingSelected = zero(); for (const m of missing) add(missingSelected, m.inPeriod);
  const days = daily.map(d => ({ date: d.date, ...combined(d.original, d.recordedSelected, d.missingSelected) }));
  return { version: "attendance-unified-v1", access: q.access, base, missing, days, totals: combined(base.totals.original, base.totals.selected, missingSelected), complete: true, payrollReady: false };
}
export function parseUnifiedSource(raw: unknown, query: UnifiedQuery): UnifiedReport {
  const q = parseUnifiedQuery(`https://local.invalid/?${unifiedQueryString(query)}`), v = object(raw);
  if (v.version !== "attendance-unified-v1" || v.access !== q.access || v.complete !== true || v.payrollReady !== false) fail();
  const version = currentAttendanceReportVersion(v.base);
  const base = q.access === "owner" ? parseAttendanceTimesheetResult(v.base, { siteId: q.siteId, workerId: q.workerId, fromDate: q.fromDate, throughDate: q.throughDate }, version) : parseAttendanceScopedTimesheetResult(v.base, q, version);
  return assemble(base, v.missing, q);
}
export function parseUnifiedResponse(raw: unknown, query: UnifiedQuery, actorId: string): UnifiedReport & { moduleEnabled: boolean } {
  const q = parseUnifiedQuery(`https://local.invalid/?${unifiedQueryString(query)}`), v = object(raw);
  if (v.ok !== true || typeof v.moduleEnabled !== "boolean" || v.version !== "attendance-unified-v1" || v.access !== q.access || v.complete !== true || v.payrollReady !== false) fail();
  const wire = { ...object(v.base), ok: true, moduleEnabled: v.moduleEnabled };
  const version = currentAttendanceReportVersion(wire);
  const base = q.access === "owner" ? parseAttendanceTimesheetResponse(wire, { siteId: q.siteId, workerId: q.workerId, fromDate: q.fromDate, throughDate: q.throughDate }, version) : parseScopedTimesheetResponse(wire, q, actorId, version);
  const { moduleEnabled: _moduleEnabled, ...cleanBase } = base;
  void _moduleEnabled;
  const computed = assemble(cleanBase, v.missing, q);
  const amounts = (raw: unknown, expected: UnifiedAmounts) => { const a = object(raw); for (const k of ["original", "recordedSelected", "missingSelected", "selected", "difference"] as const) {
    const part = object(a[k]); for (const f of keys) if (part[f] !== expected[k][f]) fail();
  } };
  amounts(v.totals, computed.totals);
  if (!Array.isArray(v.days) || v.days.length !== computed.days.length) fail();
  (v.days as unknown[]).forEach((raw, n) => { const d = object(raw); if (d.date !== computed.days[n].date) fail(); amounts(d, computed.days[n]); });
  (v.missing as unknown[]).forEach((raw, n) => { const actual = object(object(raw).inPeriod); for (const k of keys) if (actual[k] !== computed.missing[n].inPeriod[k]) fail(); });
  return { ...computed, moduleEnabled: v.moduleEnabled as boolean };
}
export const UNIFIED_REPORT_ERRORS: Readonly<Record<string, number>> = { ...ATTENDANCE_SCOPED_TIMESHEET_ERRORS, attendance_report_reconciliation_required: 422 };
export function unifiedMessage(code: string) { return ({ attendance_report_reconciliation_required: "工时来源需要负责人重新核对，暂不展示合计，避免重复计时。", attendance_report_overlap: "工时来源重叠，暂不展示合计，请负责人核对。",
  attendance_report_too_large: "此范围记录过多，请缩短日期范围；不会显示不完整合计。", attendance_access_denied: "当前身份或授权范围已失效，资料已隐藏。", attendance_worker_changed: "员工关联已变化，请重新选择并核对。" } as Record<string, string>)[code] ?? "无法读取可靠的工时报表，请重新核对权限和查询条件。"; }
