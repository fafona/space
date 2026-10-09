/** Presentation only: callers must obtain a fresh, currently authorized export.
 * This module neither authenticates a CSV nor recalculates attendance/payroll. */
import { formatAttendanceTimesheetDuration } from "./merchantAttendanceTimesheetDisplay";
import type { TimesheetExportReceipt } from "./merchantAttendanceTimesheetExport";
import type { UnifiedExportReceipt } from "./merchantAttendanceUnifiedExport";
import {parseAdministrativeReportBoundary} from "./merchantAttendanceAdministrativeBoundary";

export type AttendancePrintKind = "timesheet" | "unified";
export const ATTENDANCE_PRINT_MAX_BYTES = 4 * 1024 * 1024;
export const ATTENDANCE_PRINT_MAX_ROWS = 12_000;
export const ATTENDANCE_PRINT_MAX_CELL_CHARACTERS = 16_384;
export const ATTENDANCE_PRINT_MAX_DOCUMENT_BYTES = 12 * 1024 * 1024;

const invalid = (): never => { throw new Error("attendance_report_invalid_data"); };
const tooLarge = (): never => { throw new Error("attendance_report_too_large"); };
const encoder = new TextEncoder();
const headers = {
  timesheet: ["记录类型", "口径", "企业日期", "班次编号", "字段", "值", "开始 UTC", "结束 UTC", "班次时区", "起止微秒", "休息微秒", "带薪休息微秒", "工作微秒", "状态", "带薪标记"],
  unified: ["记录类型", "口径", "企业日期", "来源类别", "来源编号", "字段", "值", "开始 UTC", "结束 UTC", "来源时区", "起止微秒", "休息微秒", "带薪休息微秒", "工作微秒", "状态", "带薪标记"],
};
const commonMetadata = ["导出编号", "商户", "人员编号", "当前姓名", "当前工号", "访问范围", "地点编号", "范围版本", "起始日期", "截止日期含", "企业日期时区", "数据截至UTC", "来源读取记录UTC", "来源读取SHA256", "来源字节数", "计算版本", "文件格式版本", "周期尚未结束", "可用于工资结算", "范围说明", "计算说明", "行类型说明", "时间说明", "记录说明"];
const correctionFields = ["requestId", "operationId", "revision", "policyRevision", "recordedAt"];
const lineageFields = ["lineage.rootRequestId", "lineage.rootOperationId", "lineage.rootRecordedAt", "lineage.previousOperationId"];
const missingFields = ["requestId", "operationId", "submittedAt", "approvedAt", "policyRevision", "提交时姓名", "地点编号", "提交时地点", "原始打卡"];
const administrativeMetadata=["行政结案未核定班次数","合计完整","汇总口径"];
const boundaryFields=["protocol","operationId","startEventId","startSequence","startAt","tailEventId","tailSequence","tailAction","tailOccurredAt","verifiedEndAt","recordedAt","sourceFingerprint"];
const administrativeStatus="administratively_closed_unassessed";
const basisLabels: Record<string, string> = {
  original: "原始记录 original", selected: "核定合计 selected", difference: "核定减原始 difference",
  recordedSelected: "打卡核定 recordedSelected", missingSelected: "整段漏卡申报 missingSelected / wholeMissing",
};
type Row = { type: string; basis: string; date: string; source: string; id: string; field: string; value: string;
  start: string; end: string; zone: string; amounts: string[]; status: string; paid: string };
type Source = { id: string; missing: boolean; rows: Row[] };

/** Bounded RFC-4180-style state machine. Newlines inside quotes are cell text,
 * not rows; a quote in an unquoted cell or text after a closing quote is invalid. */
function parseCsv(csv: string, width: number): string[][] {
  if (csv.length > ATTENDANCE_PRINT_MAX_BYTES || encoder.encode(csv).byteLength > ATTENDANCE_PRINT_MAX_BYTES) tooLarge();
  if (csv.startsWith("\ufeff")) csv = csv.slice(1);
  const rows: string[][] = []; let row: string[] = [], cell = "", state: "plain" | "quoted" | "closed" = "plain";
  let pending = false;
  const finishCell = () => {
    if (row.length >= width) invalid();
    row.push(cell); cell = ""; state = "plain";
  };
  const finishRow = () => {
    finishCell(); if (row.length !== width) invalid();
    rows.push(row); row = []; pending = false;
    if (rows.length > ATTENDANCE_PRINT_MAX_ROWS) tooLarge();
  };
  for (let n = 0; n < csv.length; n++) {
    const char = csv[n]; pending = true;
    if (state === "quoted") {
      if (char === '"') {
        if (csv[n + 1] === '"') { cell += '"'; n++; } else state = "closed";
      } else cell += char;
    } else if (char === ",") finishCell();
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && csv[++n] !== "\n") invalid();
      finishRow();
    } else if (char === '"' && state === "plain" && cell === "") state = "quoted";
    else {
      if (state === "closed" || char === '"') invalid();
      cell += char;
    }
    if (cell.length > ATTENDANCE_PRINT_MAX_CELL_CHARACTERS) tooLarge();
  }
  if (state === "quoted") invalid();
  if (pending) finishRow();
  if (!rows.length) invalid();
  return rows;
}

const uuid = (v: string) => /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
const date = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
const instant = (v: string) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(v)
  && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v.slice(0, 23) + "Z";
const count = (v: string, max: number) => /^(0|[1-9]\d*)$/.test(v) && Number.isSafeInteger(Number(v)) && Number(v) <= max;
const empty = (...v: string[]) => { if (v.some(Boolean)) invalid(); };
const requireFields = (actual: Iterable<string>, expected: string[]) => {
  const found = new Set(actual); if (found.size !== expected.length || expected.some(key => !found.has(key))) invalid();
};
function amount(v: string, difference: boolean) {
  // CSV's formula protection prefixes negative integers with an apostrophe.
  // Remove it only here, never generally from employee-supplied text.
  const clean = v.startsWith("'-") ? v.slice(1) : v;
  if (!(difference ? /^-?(0|[1-9]\d*)$/ : /^(0|[1-9]\d*)$/).test(clean) || !Number.isSafeInteger(Number(clean))) invalid();
  return clean;
}

function parseDocument(csv: string, kind: AttendancePrintKind) {
  const cells = parseCsv(csv, headers[kind].length), head = cells.shift()!;
  if (head.some((v, n) => v !== headers[kind][n])) invalid();
  const unified = kind === "unified", shift = unified ? 1 : 0;
  const requiredMetadata = [...commonMetadata, ...(unified
    ? ["来源版本", "原记录来源版本", "原记录来源数", "整段申报来源数", "来源合计数", "未结束班次数", "口径说明"] : ["尚未结束班次数"])];
  const allowedMetadata = new Set([...requiredMetadata, "来源版本",...administrativeMetadata]), meta = new Map<string, string>();
  const rows: Row[] = []; let sawData = false;
  for (const values of cells) {
    const r: Row = { type: values[0], basis: values[1], date: values[2], source: unified ? values[3] : "", id: values[3 + shift],
      field: values[4 + shift], value: values[5 + shift], start: values[6 + shift], end: values[7 + shift], zone: values[8 + shift],
      amounts: values.slice(9 + shift, 13 + shift), status: values[13 + shift], paid: values[14 + shift] };
    if (r.type === "元数据") {
      if (sawData || !allowedMetadata.has(r.field) || meta.has(r.field)) invalid();
      empty(r.basis, r.date, r.source, r.id, r.start, r.end, r.zone, ...r.amounts, r.status, r.paid);
      meta.set(r.field, r.value);
    } else { sawData = true; rows.push(r); }
  }
  if (requiredMetadata.some(key => !meta.has(key))) invalid();
  for (const [key, value] of meta) if (!["地点编号", "范围版本", "原记录来源版本"].includes(key) && !value.trim()) invalid();
  const get = (key: string) => meta.get(key) ?? "";
  if (!uuid(get("导出编号")) || !uuid(get("人员编号")) || !/^[0-9]{8}$/.test(get("商户"))
    || !["owner", "self", "manager"].includes(get("访问范围")) || !date(get("起始日期")) || !date(get("截止日期含"))
    || !instant(get("数据截至UTC")) || !instant(get("来源读取记录UTC")) || get("来源读取记录UTC") < get("数据截至UTC")
    || !/^[a-f0-9]{64}$/.test(get("来源读取SHA256")) || !count(get("来源字节数"), 1048576) || get("来源字节数") === "0"
    || get("计算版本") !== "attendance-timesheet-v1" || get("文件格式版本") !== (unified ? "unified-csv-v1" : "1")
    || get("可用于工资结算") !== "false" || !["true", "false"].includes(get("周期尚未结束"))
    || !count(get(unified ? "未结束班次数" : "尚未结束班次数"), 100)) invalid();
  if (get("访问范围") === "manager") {
    if (!uuid(get("地点编号")) || !count(get("范围版本"), Number.MAX_SAFE_INTEGER - 1) || get("范围版本") === "0") invalid();
  } else empty(get("地点编号"), get("范围版本"));
  const sourceVersion=get(unified?"原记录来源版本":"来源版本"),administrative=sourceVersion==="raw-and-approved-v3";
  if (unified ? get("来源版本") !== "attendance-unified-v1" || !["raw-and-approved-v2","raw-and-approved-v3"].includes(sourceVersion)
    : meta.has("来源版本") && !["raw-and-approved-v2","raw-and-approved-v3"].includes(sourceVersion)) invalid();
  if(administrative){
    if(administrativeMetadata.some(k=>!meta.has(k))||!count(get("行政结案未核定班次数"),100)||!["true","false"].includes(get("合计完整"))
      ||get("汇总口径")!=="已知小计；行政结案工时未知，不计作0")invalid();
  }else if(administrativeMetadata.some(k=>meta.has(k)))invalid();
  const zones = new Set<string>();
  const checkZone = (zone: string) => {
    if (!zone || zone.length > 100) invalid();
    if (!zones.has(zone)) {
      try { new Intl.DateTimeFormat("en", { timeZone: zone }); } catch { invalid(); }
      zones.add(zone);
    }
  };
  checkZone(get("企业日期时区"));
  const startDay = Date.parse(get("起始日期")), endDay = Date.parse(get("截止日期含"));
  if (endDay < startDay || endDay - startDay > 30 * 86400000) invalid();
  const bases = unified ? ["original", "recordedSelected", "missingSelected", "selected", "difference"] : ["original", "selected", "difference"];
  const summaries = new Map<string, Row>(), days = new Map<string, Map<string, Row>>(), skipped = new Map<string, Row>(), sources = new Map<string, Source>();
  for (const r of rows) {
    if (r.type === "汇总" || r.type === "日明细") {
      empty(r.source, r.id, r.field, r.value, r.start, r.end, r.status, r.paid);
      if (!bases.includes(r.basis)) invalid();
      r.amounts = r.amounts.map(v => amount(v, r.basis === "difference"));
      if (r.type === "汇总") {
        empty(r.date, r.zone); if (summaries.has(r.basis)) invalid(); summaries.set(r.basis, r);
      } else {
        if (r.basis === "difference" || !date(r.date) || r.date < get("起始日期") || r.date > get("截止日期含") || r.zone !== (unified ? get("企业日期时区") : "")) invalid();
        const group = days.get(r.date) ?? new Map<string, Row>(); if (group.has(r.basis)) invalid();
        group.set(r.basis, r); days.set(r.date, group);
      }
      continue;
    }
    if (r.type === "跳过自然日") {
      empty(r.basis, r.source, r.id, r.start, r.end, r.zone, ...r.amounts, r.status, r.paid);
      if (!date(r.date) || r.field !== "原因" || !r.value || skipped.has(r.date)) invalid(); skipped.set(r.date, r); continue;
    }
    if (!uuid(r.id)) invalid();
    const missing = r.basis === "missingSelected", sourceKey = `${missing ? "missing" : "recorded"}:${r.id}`;
    const source = sources.get(sourceKey) ?? { id: r.id, missing, rows: [] };
    source.rows.push(r); sources.set(sourceKey, source);
    if (sources.size > 100) tooLarge();
    empty(r.date);
    if (!(missing ? unified : ["original", unified ? "recordedSelected" : "selected"].includes(r.basis))) invalid();
    const fullType = missing ? "整段申报完整" : unified ? "打卡班次完整" : "班次完整";
    const periodType = missing ? "整段申报区间" : unified ? "打卡班次区间" : "班次区间";
    if (r.type === fullType || r.type === periodType) {
      empty(r.paid);
      if (unified) {
        empty(r.field, r.value);
        if (missing ? r.source !== "missing-approved" : !["original", "approved"].includes(r.source)) invalid();
      } else if (r.type === fullType) {
        if (r.field !== "来源" || !["original", "approved"].includes(r.value)) invalid();
      } else empty(r.field, r.value);
      const closed = r.status === "completed" || missing && r.status === "approved";
      if (!closed && !["working", "break",...(administrative&&!missing?[administrativeStatus]:[])].includes(r.status) || missing && !closed) invalid();
      if (closed) r.amounts = r.amounts.map(v => amount(v, false)); else empty(...r.amounts);
      checkZone(r.zone);
      if (r.type === fullType) {
        if (!instant(r.start) || (closed ? !instant(r.end) || r.end < r.start : r.end !== "")) invalid();
      } else { empty(r.start, r.end); if (r.zone !== get("企业日期时区")) invalid(); }
    } else if (r.type === "休息") {
      empty(r.field, r.value, ...r.amounts);
      if (!instant(r.start) || !["true", "false"].includes(r.paid) || !["open", "completed"].includes(r.status)
        || (r.status === "open" ? r.end !== "" || missing : !instant(r.end) || r.end < r.start)) invalid();
      checkZone(r.zone);
      if (unified && !(missing ? r.source === "missing-approved" : ["original", "approved"].includes(r.source))) invalid();
    } else if (r.type === "行政结案旁证" || r.type === "行政前驱旁证") {
      empty(r.start,r.end,r.zone,...r.amounts,r.status,r.paid);
      if(!administrative||missing||r.basis!=="original"||unified&&r.source!=="raw"||!boundaryFields.includes(r.field)||!r.value)invalid();
    } else if (r.type === "原始动作" || r.type === "批准来源") {
      empty(r.start, r.end, r.zone, ...r.amounts, r.status, r.paid);
      if (r.type === "原始动作") {
        if (r.basis !== "original" || r.field !== "eventId" || !uuid(r.value) || unified && r.source !== "raw") invalid();
      } else {
        if (r.basis !== (missing ? "missingSelected" : unified ? "recordedSelected" : "selected")
          || !(missing ? missingFields : [...correctionFields, ...lineageFields]).includes(r.field)
          || !r.value && r.field !== "lineage.previousOperationId"
          || unified && r.source !== (missing ? "missing-approved" : "approved")) invalid();
      }
    } else invalid();
  }
  requireFields(summaries.keys(), bases);
  for (let day = startDay; day <= endDay; day += 86400000) {
    const key = new Date(day).toISOString().slice(0, 10), values = days.get(key);
    if (skipped.has(key)) { if (values) invalid(); }
    else if (values) requireFields(values.keys(), bases.filter(b => b !== "difference")); else invalid();
  }
  if ([...skipped.keys()].some(key => key < get("起始日期") || key > get("截止日期含"))) invalid();
  let openCount = 0,administrativeCount=0,boundaryCount=0;
  const boundaryOperations=new Set<string>();
  const boundaryValues=new Map<string,ReturnType<typeof parseAdministrativeReportBoundary>>();
  for (const source of sources.values()) {
    const detail = source.rows.filter(r => /完整$|区间$/.test(r.type)), expectedBases = source.missing ? ["missingSelected"] : ["original", unified ? "recordedSelected" : "selected"];
    if (detail.length !== expectedBases.length * 2) invalid();
    for (const basis of expectedBases) {
      const full = detail.filter(r => r.basis === basis && r.type.endsWith("完整")), period = detail.filter(r => r.basis === basis && r.type.endsWith("区间"));
      if (full.length !== 1 || period.length !== 1 || full[0].status !== period[0].status || unified && full[0].source !== period[0].source) invalid();
      if (basis === "original" && full[0].status !== "completed") openCount++;
    }
    const refs = source.rows.filter(r => r.type === "批准来源"), fields = refs.map(r => r.field);
    if (new Set(fields).size !== fields.length) invalid();
    if (source.missing) requireFields(fields, missingFields);
    else {
      const events = source.rows.filter(r => r.type === "原始动作");
      if (!events.some(r => r.value === source.id) || new Set(events.map(r => r.value)).size !== events.length) invalid();
      const approved = detail.some(r => (unified ? r.source : r.value) === "approved");
      if (approved) requireFields(fields, [...correctionFields, ...(fields.some(f => f.startsWith("lineage.")) ? lineageFields : [])]);
      else if (refs.length) invalid();
      if(administrative){
        const readBoundary=(kind:string)=>{
          const proofRows=source.rows.filter(r=>r.type===kind);if(!proofRows.length)return null;
          if(proofRows.length!==boundaryFields.length)invalid();requireFields(proofRows.map(r=>r.field),boundaryFields);
          const values:Record<string,unknown>=Object.fromEntries(proofRows.map(r=>[r.field,r.value]));
          for(const key of ["startSequence","tailSequence"]){const v=String(values[key]);if(!count(v,Number.MAX_SAFE_INTEGER-1)||v==="0")invalid();values[key]=Number(v);}
          try{
            const proof=parseAdministrativeReportBoundary(values),previous=boundaryValues.get(proof.operationId);
            if(previous&&boundaryFields.some(key=>previous[key as keyof typeof previous]!==proof[key as keyof typeof proof]))invalid();
            boundaryValues.set(proof.operationId,proof);return proof;
          }catch{return invalid();}
        };
        const own=readBoundary("行政结案旁证"),prior=readBoundary("行政前驱旁证"),full=detail.find(r=>r.basis==="original"&&r.type.endsWith("完整"))!;
        if(own){
          if(approved||own.startEventId!==source.id||events[0]?.value!==own.startEventId||events.at(-1)?.value!==own.tailEventId
            ||own.startAt!==full.start||own.recordedAt>get("数据截至UTC")||events.length!==own.tailSequence-own.startSequence+1
            ||detail.some(r=>r.status!==administrativeStatus)||boundaryOperations.has(own.operationId))invalid();
          boundaryOperations.add(own.operationId);administrativeCount++;boundaryCount++;
        }else if(detail.some(r=>r.status===administrativeStatus))invalid();
        if(prior){
          if(prior.verifiedEndAt>full.start||prior.recordedAt>get("数据截至UTC")||prior.operationId===own?.operationId
            ||events.some(r=>r.value===prior.startEventId||r.value===prior.tailEventId)||own&&prior.tailSequence+1!==own.startSequence)invalid();
          boundaryCount++;
        }
      }
    }
  }
  if (openCount !== Number(get(unified ? "未结束班次数" : "尚未结束班次数"))) invalid();
  if(administrative){
    if(!boundaryCount||administrativeCount!==Number(get("行政结案未核定班次数"))||get("合计完整")!==String(administrativeCount===0&&openCount===0))invalid();
    // Only known, clipped amounts are summed; a boundary never supplies time.
    const sum=(items:Row[])=>[0,1,2,3].map(n=>{const total=items.reduce((a,r)=>a+(r.amounts[n]===""?0:Number(r.amounts[n])),0);if(!Number.isSafeInteger(total))invalid();return total;});
    const periods=[...sources.values()].flatMap(s=>s.rows.filter(r=>r.type.endsWith("区间")));
    const original=sum(periods.filter(r=>r.basis==="original")),recorded=sum(periods.filter(r=>r.basis===(unified?"recordedSelected":"selected"))),missing=sum(periods.filter(r=>r.basis==="missingSelected"));
    const selected=recorded.map((v,n)=>v+missing[n]),difference=selected.map((v,n)=>v-original[n]);
    const expected:Record<string,number[]>={original,recordedSelected:recorded,missingSelected:missing,selected,difference};
    for(const key of bases)if(summaries.get(key)!.amounts.some((v,n)=>!Number.isSafeInteger(expected[key][n])||Number(v)!==expected[key][n]))invalid();
    for(const key of bases.filter(k=>k!=="difference"))if(sum([...days.values()].map(d=>d.get(key)!)).some((v,n)=>v!==expected[key][n]))invalid();
  }
  if (unified) {
    const missingCount = [...sources.values()].filter(s => s.missing).length;
    for (const key of ["原记录来源数", "整段申报来源数", "来源合计数"]) if (!count(get(key), 100)) invalid();
    if (Number(get("整段申报来源数")) !== missingCount || Number(get("来源合计数")) !== sources.size || Number(get("原记录来源数")) !== sources.size - missingCount) invalid();
  }
  return { meta, summaries, days, skipped, sources, openCount, administrative, administrativeCount };
}

const escape = (v: string) => v.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
const text = (v: string) => escape(v || "未提供 / 不适用");
const basis = (v: string) => escape(basisLabels[v] ?? v);
const amountHeaders = ["起止时长", "全部休息", "带薪休息", "工作段"];
const duration = (v: string, signed = false) => v
  ? `${escape(formatAttendanceTimesheetDuration(Number(v), signed))}<br><small>${text(v)} 微秒</small>` : "尚未结束 / 未知，不计作 0";
const table = (labels: string[], body: string, className = "") => `<table class="${className}"><thead><tr>${labels.map(label => `<th scope="col">${escape(label)}</th>`).join("")}</tr></thead><tbody>${body}</tbody></table>`;
const amountCells = (r: Row) => r.amounts.map(v => `<td class="number">${duration(v, r.basis === "difference")}</td>`).join("");
function details(r: Row) {
  const time: string[] = [];
  if (r.start) time.push(`开始 UTC：${text(r.start)}`);
  if (r.end || r.start) time.push(`结束 UTC：${r.end ? text(r.end) : r.status===administrativeStatus?"无实测下班；行政截止不作工时终点":"尚未结束 / 未知，不估算"}`);
  if (r.zone) time.push(`时区：${text(r.zone)}`);
  if (r.status) time.push(`状态：${r.status===administrativeStatus?"行政结案；工时未核定（不是实测下班）":text(r.status)}`);
  if (r.paid) time.push(`带薪标记：${r.paid === "true" ? "是（true）" : "否（false）"}`);
  const quantities = r.type.endsWith("完整") || r.type.endsWith("区间")
    ? r.amounts.map((v, n) => `${amountHeaders[n]}：${duration(v)}`).join("<br>") : "";
  const field = r.field ? `${text(r.field)}：${text(r.value)}` : "";
  const sourceLabel = r.source || (r.field === "来源" ? r.value : "");
  return `<tr><td>${text(r.type)}<br>${basis(r.basis)}${sourceLabel ? `<br>来源类别：${text(sourceLabel)}` : ""}</td><td>${time.join("<br>") || field || "不适用"}</td><td>${quantities || (time.length ? field : "") || "不适用"}</td></tr>`;
}

/** Produces a complete, inert document; never opens windows, prints, or saves.
 * Limits reject the whole document, never silently truncate rows or fields. */
export function buildAttendancePrintDocument(file: { csv: string; filename: string }, kind: AttendancePrintKind, expected?: TimesheetExportReceipt | UnifiedExportReceipt): string {
  if (!file || typeof file.csv !== "string" || typeof file.filename !== "string" || !file.filename.trim()
    || file.filename.length > 512 || !["timesheet", "unified"].includes(kind)) invalid();
  const report = parseDocument(file.csv, kind), title = kind === "unified" ? "考勤统一核对明细" : "考勤工时核对明细";
  const get = (key: string) => report.meta.get(key) ?? "";
  const expectedFilename = `attendance-${kind === "unified" ? "unified-" : ""}${get("商户")}-${get("起始日期")}-${get("截止日期含")}-${get("导出编号")}.csv`;
  if (file.filename !== expectedFilename) invalid();
  if (expected !== undefined) {
    if (!expected || typeof expected !== "object") invalid();
    const bindings: Record<string, string | number | null> = { 导出编号: expected.operationId, 商户: expected.siteId, 人员编号: expected.workerId,
      访问范围: expected.access, 地点编号: expected.locationId, 范围版本: expected.scopeRevision, 起始日期: expected.fromDate, 截止日期含: expected.throughDate,
      企业日期时区: expected.timeZone, 数据截至UTC: expected.asOf, 来源读取记录UTC: expected.recordedAt, 来源读取SHA256: expected.sourceSha256, 来源字节数: expected.sourceBytes };
    if (Object.entries(bindings).some(([key, value]) => get(key) !== (value === null ? "" : String(value)))) invalid();
    const missingCount = [...report.sources.values()].filter(source => source.missing).length;
    if (report.sources.size - missingCount !== expected.sessionCount) invalid();
    if (kind === "unified") {
      if (!("reportVersion" in expected) || get("来源版本") !== expected.reportVersion || missingCount !== expected.missingCount || report.sources.size !== expected.sourceCount) invalid();
    } else if ("reportVersion" in expected) invalid();
  }
  const metaRows = [...report.meta].map(([key, value]) => `<tr><th scope="row">${escape(key)}</th><td>${text(value)}</td></tr>`).join("");
  const summaryRows = [...report.summaries.values()].map(r => `<tr><th scope="row">${basis(r.basis)}</th>${amountCells(r)}</tr>`).join("");
  const dailyRows = [...report.days].sort(([a], [b]) => a.localeCompare(b)).flatMap(([day, rows]) => [...rows.values()].map(r => `<tr><td>${escape(day)}</td><th scope="row">${basis(r.basis)}</th>${amountCells(r)}</tr>`)).join("");
  const sourceSections = [...report.sources.values()].map((source, n) => `<section class="source"><h3>${n + 1}. ${source.missing ? "整段漏卡申报（wholeMissing），不是原始打卡" : "打卡班次：原始与核定分列"}</h3><p class="source-id">${source.missing ? "申报编号" : "班次起始动作编号"}：${text(source.id)}</p>${table(["记录类型 / 口径 / 来源", "UTC 时间、状态或来源字段", "精确时长 / 补充字段"], source.rows.map(details).join(""), "details")}</section>`).join("");
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src 'none'; font-src 'none'; connect-src 'none'; base-uri 'none'; form-action 'none'; object-src 'none'"><meta name="referrer" content="no-referrer"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(title)} — ${escape(file.filename)}</title><style>
@page{size:A4 portrait;margin:14mm 12mm 16mm}*{box-sizing:border-box}html{color:#111;background:white;font-family:Arial,"Microsoft YaHei",sans-serif;font-size:10pt;line-height:1.45}body{margin:0 auto;max-width:190mm;padding:7mm}h1{font-size:19pt;margin:0 0 3mm}h2{font-size:14pt;margin:7mm 0 3mm}h3{font-size:12pt;margin:6mm 0 2mm}p{margin:2mm 0}h1,h2,h3,.source-id{break-after:avoid-page;page-break-after:avoid}table{border-collapse:collapse;table-layout:fixed;width:100%;margin:3mm 0 5mm}thead{display:table-header-group}tfoot{display:table-footer-group}tr{break-inside:avoid-page;page-break-inside:avoid}th,td{border:1px solid #777;padding:2mm;vertical-align:top;overflow-wrap:anywhere;white-space:pre-wrap}th{text-align:left;font-weight:600;background:#f1f1f1}.metadata th{width:31%}.details th:first-child{width:25%}.details th:nth-child(2){width:39%}.number{font-variant-numeric:tabular-nums;text-align:right}.notice{border:1.5px solid #333;padding:3mm}.muted{color:#333}.source{break-inside:auto}footer{border-top:1px solid #777;margin-top:6mm;padding-top:3mm;font-size:9pt}@media print{body{padding:0;max-width:none}html{print-color-adjust:exact;-webkit-print-color-adjust:exact}}@media screen{body{box-shadow:0 0 8px #aaa}}
</style></head><body data-attendance-print-document="${kind}"><header><h1>${escape(title)}</h1><p>${text(report.meta.get("当前姓名")!)} · ${text(report.meta.get("当前工号")!)}</p><p>${text(report.meta.get("起始日期")!)} 至 ${text(report.meta.get("截止日期含")!)}（含） · ${text(report.meta.get("企业日期时区")!)}</p><p class="muted">来源 CSV 文件名：${text(file.filename)}</p></header>
<aside class="notice"><strong>核对明细，非已封账工资表。</strong><p>此资料未冻结，不是工资结算、签名或考勤完整性证明。来源读取 SHA256 是来源哈希，不是 CSV 校验值、签名或冻结证明。</p><p>仅代表读取时当前授权范围；非完整个人月报。原始、核定、整段申报、日明细、完整来源与查询区间是不同视图，不可混合累加。空白、零或缺失不代表缺勤；未结束时长不估算，带薪休息不自动加回。</p>${report.administrative?`<p>此 v3 报表仅列已知小计；${report.administrativeCount} 个行政结案班次工时未核定，未知不是 0。行政截止及前驱旁证仅界定班次边界，不作为实测下班或工资时长。</p>`:""}<p>时长显示小时、分、秒及原始整数微秒，均不舍入。${report.administrative?`有 ${report.openCount} 个缺少实测结束的班次（含行政结案）；小计不含其未知时长。`:report.openCount ? `有 ${report.openCount} 个尚未结束班次；汇总不含其未知时长，不是最终合计。` : "没有尚未结束班次不等于周期已结算。"}打印调用不证明已经出纸或保存 PDF，已保存或打印的资料无法远程收回。</p></aside>
<section><h2>${report.administrative?"查询区间已知小计":"查询区间汇总"}（各口径独立）</h2>${table(["口径", ...amountHeaders], summaryRows)}</section>
<section><h2>来源、范围与读取记录</h2>${table(["元数据字段", "来源值"], metaRows, "metadata")}${!report.meta.has("来源版本") ? "<p>来源版本：旧版 CSV 未提供；不推断为冻结版本。</p>" : ""}</section>
<section><h2>企业自然日明细（与汇总是不同视图）</h2>${table(["企业日期", "口径", ...amountHeaders], dailyRows)}${[...report.skipped.values()].map(r => `<p>跳过自然日 ${text(r.date)}：${text(r.value)}</p>`).join("")}</section>
<section><h2>逐来源明细 · ${report.sources.size} 个来源</h2>${sourceSections || "<p>此当前授权范围内没有可列示来源；不表示缺勤，也不证明其他范围没有记录。</p>"}</section>
<footer>仅使用当前受控导出所含字段；无精确定位、账户凭据或第三方资源。姓名与工号的当前标签不等于历史身份快照；整段申报保留提交时标签。报表无数据回写。</footer></body></html>`;
  if (encoder.encode(html).byteLength > ATTENDANCE_PRINT_MAX_DOCUMENT_BYTES) tooLarge();
  return html;
}
