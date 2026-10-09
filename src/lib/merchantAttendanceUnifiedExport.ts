import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { attendanceAuditCsvCell } from "./merchantAttendanceAuditExport";
import { parseTimesheetExportCommand, parseTimesheetExportReceipt, TIMESHEET_EXPORT_ERRORS, TIMESHEET_EXPORT_MAX_BYTES, type TimesheetExportCommand, type TimesheetExportReceipt } from "./merchantAttendanceTimesheetExport";
import { parseUnifiedSource, parseUnifiedResponse, UNIFIED_REPORT_ERRORS, type UnifiedQuery, type UnifiedReport } from "./merchantAttendanceUnifiedTimesheet";
import type { AttendanceSessionAmounts as Amounts } from "./merchantAttendanceSession";
export { parseTimesheetExportCommand as parseUnifiedExportCommand, TIMESHEET_EXPORT_MAX_BYTES as UNIFIED_EXPORT_MAX_BYTES };
export type UnifiedExportCommand = TimesheetExportCommand;
export type UnifiedExportReceipt = TimesheetExportReceipt & { reportVersion: "attendance-unified-v1"; missingCount: number; sourceCount: number };
const fail = (): never => { throw new MerchantAttendanceError("attendance_report_invalid_data"); };
const object = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : fail();
const exact = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
export function unifiedExportQuery(command: UnifiedExportCommand): UnifiedQuery {
  const c = parseTimesheetExportCommand(command), q = c.query, period = { siteId: c.siteId, fromDate: q.fromDate, throughDate: q.throughDate };
  return q.access === "owner" ? { ...period, access: q.access, workerId: q.workerId! } : q.access === "self" ? { ...period, access: q.access, expectedWorkerId: q.expectedWorkerId }
    : { ...period, access: q.access, workerId: q.workerId!, locationId: q.locationId! };
}
export function unifiedExportSelection(r: UnifiedReport): Omit<UnifiedExportCommand, "operationId"> {
  const b = r.base;
  return { siteId: b.siteId, query: { access: r.access, workerId: r.access === "self" ? null : b.workerId, expectedWorkerId: r.access === "self" ? b.workerId : null,
    locationId: "locationId" in b ? b.locationId : null, expectedScopeRevision: "scopeRevision" in b ? b.scopeRevision : null, fromDate: b.fromDate, throughDate: b.throughDate, expectedTimeZone: b.timeZone } };
}
export function parseUnifiedExportReceipt(value: unknown, command: UnifiedExportCommand): UnifiedExportReceipt {
  const v = object(value), { reportVersion, missingCount, sourceCount, ...original } = v, receipt = parseTimesheetExportReceipt(original, command);
  if (reportVersion !== "attendance-unified-v1" || !Number.isSafeInteger(missingCount) || Number(missingCount) < 0 || Number(missingCount) > 100
    || !Number.isSafeInteger(sourceCount) || sourceCount !== receipt.sessionCount + Number(missingCount) || Number(sourceCount) > 100) fail();
  return { ...receipt, reportVersion: "attendance-unified-v1", missingCount: Number(missingCount), sourceCount: Number(sourceCount) };
}
export function parseUnifiedExportSource(value: unknown, command: UnifiedExportCommand) {
  const v = object(value), c = parseTimesheetExportCommand(command);
  if (!exact(v, ["receipt", "replayed", "report"]) || typeof v.replayed !== "boolean") fail();
  const receipt = parseUnifiedExportReceipt(v.receipt, c);
  if (v.replayed) { if (v.report !== null) fail(); return { receipt, replayed: true as const, report: null }; }
  const report = parseUnifiedSource(v.report, unifiedExportQuery(c)), b = report.base;
  if (b.asOf !== receipt.asOf || b.timeZone !== receipt.timeZone || b.rows.length !== receipt.sessionCount || report.missing.length !== receipt.missingCount
    || ("scopeRevision" in b && b.scopeRevision !== receipt.scopeRevision)) fail();
  return { receipt, replayed: false as const, report };
}
export function unifiedExportFilename(c: UnifiedExportCommand) {
  const { siteId, operationId, query: q } = parseTimesheetExportCommand(c);
  return `attendance-unified-${siteId}-${q.fromDate}-${q.throughDate}-${operationId}.csv`;
}
const instantUs = (s: string) => BigInt(Date.parse(s.slice(0, 23) + "Z")) * BigInt(1000) + BigInt(s.slice(23, 26));
// Separate views are explicitly labelled. Never sum whole-source and clipped
// rows together; never emit fake punch identifiers for whole-missing declarations.
export function buildUnifiedExportCsv(r: UnifiedReport, receipt: UnifiedExportReceipt) {
  const administrative=r.base.sourceVersion==="raw-and-approved-v3";
  if(administrative)parseUnifiedResponse({...r,ok:true,moduleEnabled:false},unifiedExportQuery({...unifiedExportSelection(r),operationId:receipt.operationId}),
    "viewerEmployeeId" in r.base?r.base.viewerEmployeeId:r.base.employeeId??r.base.workerId);
  const b = r.base, rows: string[][] = [["记录类型", "口径", "企业日期", "来源类别", "来源编号", "字段", "值", "开始 UTC", "结束 UTC", "来源时区", "起止微秒", "休息微秒", "带薪休息微秒", "工作微秒", "状态", "带薪标记"]];
  const meta: Record<string, string | number | boolean | null> = {
    导出编号: receipt.operationId, 商户: b.siteId, 人员编号: b.workerId, 当前姓名: b.workerName, 当前工号: b.workerNo,
    访问范围: r.access, 地点编号: receipt.locationId, 范围版本: receipt.scopeRevision, 起始日期: b.fromDate, 截止日期含: b.throughDate, 企业日期时区: b.timeZone,
    来源版本: r.version, 原记录来源版本: b.sourceVersion ?? "", 计算版本: b.calculationVersion, 文件格式版本: "unified-csv-v1", 可用于工资结算: false,
    数据截至UTC: b.asOf, 来源读取记录UTC: receipt.recordedAt, 来源读取SHA256: receipt.sourceSha256, 来源字节数: receipt.sourceBytes,
    原记录来源数: receipt.sessionCount, 整段申报来源数: receipt.missingCount, 来源合计数: receipt.sourceCount, 未结束班次数: b.openSessionCount, 周期尚未结束: b.periodInProgress,
    范围说明: r.access === "owner" ? "当前负责人可见来源" : "仅当前完整授权来源；不是完整个人月报；不可见或混合归属班次不纳入",
    口径说明: "selected=recordedSelected+missingSelected；recordedSelected 使用最新批准补正替换原始，不与 original 叠加；difference=selected-original",
    计算说明: "工作段=起止-全部休息；带薪休息独立列示，不自动加回或计算工资；未结束班次不估算；空白或零值不代表缺勤",
    行类型说明: "汇总、日明细、完整来源与区间来源是不同视图，不可混合累加；日明细按企业自然日裁剪；完整来源可能超出查询区间",
    时间说明: "时间戳使用 UTC，保留微秒；人员标题是当前资料，整段申报姓名地点是提交时快照；不伪造原始打卡",
    记录说明: "仅记录来源读取，不证明浏览器保存文件；来源哈希不是 CSV 校验值、签名或冻结证明；服务器不保留 CSV 副本",
  };
  if(administrative)Object.assign(meta,{行政结案未核定班次数:b.administrativeUnassessedCount,合计完整:b.totalsComplete,
    汇总口径:"已知小计；行政结案工时未知，不计作0"});
  for (const [key, value] of Object.entries(meta)) rows.push(["元数据", "", "", "", "", key, value === null ? "" : String(value)]);
  const amounts = (a: Amounts | null) => a ? [a.elapsedUs, a.breakUs, a.paidBreakUs, a.workedUs].map(String) : ["", "", "", ""];
  for (const k of ["original", "recordedSelected", "missingSelected", "selected", "difference"] as const) rows.push(["汇总", k, "", "", "", "", "", "", "", "", ...amounts(r.totals[k])]);
  for (const d of r.days) for (const k of ["original", "recordedSelected", "missingSelected", "selected"] as const) rows.push(["日明细", k, d.date, "", "", "", "", "", "", b.timeZone, ...amounts(d[k])]);
  for (const day of b.skippedDates) rows.push(["跳过自然日", "", day, "", "", "原因", "时区历史变更，不算缺勤"]);
  for (const row of b.rows) {
    const id = row.startEventId;
    for (const k of ["original", "selected"] as const) {
      const s = row[k], basis = k === "original" ? k : "recordedSelected",status=administrative&&row.administrativeBoundary?"administratively_closed_unassessed":s.status;
      rows.push(["打卡班次完整", basis, "", row.source, id, "", "", s.startAt, s.endAt ?? "", s.timeZone, ...amounts(s.totals), status]);
      rows.push(["打卡班次区间", basis, "", row.source, id, "", "", "", "", b.timeZone, ...amounts(s.endAt === null ? null : k === "original" ? row.originalInPeriod : row.selectedInPeriod), status]);
      for (const rest of s.breaks) rows.push(["休息", basis, "", row.source, id, "", "", rest.startAt, rest.endAt, s.timeZone, "", "", "", "", "completed", String(rest.paid)]);
      if (s.openBreak) rows.push(["休息", basis, "", row.source, id, "", "", s.openBreak.startAt, "", s.timeZone, "", "", "", "", "open", String(s.openBreak.paid)]);
    }
    for (const eventId of row.eventIds) rows.push(["原始动作", "original", "", "raw", id, "eventId", eventId]);
    if(administrative)for(const [kind,proof] of [["行政结案旁证",row.administrativeBoundary],["行政前驱旁证",row.predecessorBoundary]] as const)
      if(proof)for(const [key,value] of Object.entries(proof))rows.push([kind,"original","","raw",id,key,String(value)]);
    if (row.correction) for (const [key, value] of Object.entries(row.correction)) {
      if (key === "lineage" && row.correction.lineage) for (const [field, entry] of Object.entries(row.correction.lineage)) rows.push(["批准来源", "recordedSelected", "", "approved", id, `lineage.${field}`, entry ?? ""]);
      else rows.push(["批准来源", "recordedSelected", "", "approved", id, key, String(value)]);
    }
  }
  for (const m of r.missing) {
    const p = m.proposal, elapsedUs = Number(instantUs(p.endAt) - instantUs(p.startAt)); let breakUs = 0, paidBreakUs = 0;
    for (const rest of p.breaks) { const n = Number(instantUs(rest.endAt) - instantUs(rest.startAt)); breakUs += n; if (rest.paid) paidBreakUs += n; }
    rows.push(["整段申报完整", "missingSelected", "", m.source, m.requestId, "", "", p.startAt, p.endAt, m.timeZone, ...amounts({ elapsedUs, breakUs, paidBreakUs, workedUs: elapsedUs - breakUs }), "approved"]);
    rows.push(["整段申报区间", "missingSelected", "", m.source, m.requestId, "", "", "", "", b.timeZone, ...amounts(m.inPeriod), "approved"]);
    for (const rest of p.breaks) rows.push(["休息", "missingSelected", "", m.source, m.requestId, "", "", rest.startAt, rest.endAt, m.timeZone, "", "", "", "", "completed", String(rest.paid)]);
    for (const [key, value] of Object.entries({ requestId: m.requestId, operationId: m.operationId, submittedAt: m.submittedAt, approvedAt: m.approvedAt,
      policyRevision: m.policyRevision, 提交时姓名: m.workerName, 地点编号: m.locationId, 提交时地点: m.locationName, 原始打卡: "无，不伪造事件" })) rows.push(["批准来源", "missingSelected", "", m.source, m.requestId, key, String(value)]);
  }
  if (rows.some(row => row.length > 16)) fail();
  const csv = "\ufeff" + rows.map(row => Array.from({ length: 16 }, (_, n) => attendanceAuditCsvCell(row[n] ?? "")).join(",")).join("\r\n") + "\r\n";
  if (new TextEncoder().encode(csv).byteLength > TIMESHEET_EXPORT_MAX_BYTES) throw new MerchantAttendanceError("attendance_report_too_large");
  return csv;
}
export const UNIFIED_EXPORT_ERRORS: Readonly<Record<string, number>> = { ...TIMESHEET_EXPORT_ERRORS, ...UNIFIED_REPORT_ERRORS };
