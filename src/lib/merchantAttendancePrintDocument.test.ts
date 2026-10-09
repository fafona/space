import assert from "node:assert/strict";
import test from "node:test";
import { timesheetExportCommand, timesheetExportWire } from "../../scripts/fixtures/attendance-timesheet-export-model";
import { unifiedExportCommand, unifiedExportWire } from "../../scripts/fixtures/attendance-unified-export-model";
import { firstApprovalSourceV2, sheetEffect, sheetEvent, timesheetId as id } from "../../scripts/fixtures/attendance-timesheet-model";
import { buildTimesheetExportCsv, parseTimesheetExportSource, timesheetExportFilename } from "./merchantAttendanceTimesheetExport";
import { buildUnifiedExportCsv, parseUnifiedExportSource, unifiedExportFilename } from "./merchantAttendanceUnifiedExport";
import { ATTENDANCE_PRINT_MAX_BYTES, ATTENDANCE_PRINT_MAX_CELL_CHARACTERS, ATTENDANCE_PRINT_MAX_DOCUMENT_BYTES, ATTENDANCE_PRINT_MAX_ROWS,
  buildAttendancePrintDocument as build, type AttendancePrintKind } from "./merchantAttendancePrintDocument";

function fixture(kind: AttendancePrintKind, access: "owner" | "self" | "manager" = "owner") {
  if (kind === "timesheet") {
    const command = timesheetExportCommand(access), wire = timesheetExportWire(command);
    wire.report.items[0].effect = sheetEffect({ startAt: "2026-09-05T08:00:00.000000Z", endAt: "2026-09-05T15:00:00.000003Z",
      breaks: [{ startAt: "2026-09-05T10:00:00.000001Z", endAt: "2026-09-05T10:30:00.000002Z", paid: true }] });
    if (access === "self") Object.assign(wire.report.items[0].effect, { employeeId: id(2) });
    const parsed = parseTimesheetExportSource({ ...wire, report: firstApprovalSourceV2(wire.report) }, command, "raw-and-approved-v2");
    return { csv: buildTimesheetExportCsv(parsed.report!, parsed.receipt), filename: timesheetExportFilename(command) };
  }
  const command = unifiedExportCommand(access), parsed = parseUnifiedExportSource(unifiedExportWire(command), command);
  return { csv: buildUnifiedExportCsv(parsed.report!, parsed.receipt), filename: unifiedExportFilename(command) };
}
const quoted = (value: string) => `"${value.replaceAll('"', '""')}"`;
// Fixture mutation helpers only use the ordinary single-line fixtures above;
// the multiline tests exercise the production parser, not these helpers.
const lines = (csv: string) => csv.slice(1).trimEnd().split("\r\n");
const withLines = (file: { csv: string; filename: string }, rows: string[]) => ({ ...file, csv: "\ufeff" + rows.join("\r\n") + "\r\n" });
const both = ["timesheet", "unified"] as const;

for (const kind of both) for (const access of ["owner", "self", "manager"] as const) {
  test(`${kind}/${access}: actual CSV builder output yields inert A4 document with exact provenance`, () => {
    const file = fixture(kind, access), html = build(file, kind);
    assert(html.startsWith("<!doctype html>"));
    assert(html.includes(`data-attendance-print-document="${kind}"`));
    for (const value of [file.filename, id(4), id(800), "2026-09-01", "2026-09-30", "Europe/Madrid", "2026-09-30T12:00:00.000000Z",
      "a".repeat(64), "2048", "raw-and-approved-v2", "attendance-timesheet-v1", "核对明细，非已封账工资表", "此资料未冻结", "不是 CSV 校验值、签名或冻结证明", "不可混合累加", "空白、零或缺失不代表缺勤"]) assert(html.includes(value), value);
    assert.match(html, /@page\{size:A4 portrait/);
    assert.match(html, /thead\{display:table-header-group\}/);
    assert.match(html, /tr\{break-inside:avoid-page/);
    assert.match(html, /default-src 'none'; script-src 'none'/);
    assert(!/<script|<iframe|<link|<img|<form|\bon\w+=|\b(?:src|href)=/i.test(html));
    for (const secret of [id(2), id(90), "actor_auth_user_id", "latitude", "longitude", "employeeId"]) assert(!html.includes(secret), secret);
    assert(Buffer.byteLength(html, "utf8") < ATTENDANCE_PRINT_MAX_DOCUMENT_BYTES);
    if (access !== "owner") assert.match(html, /(?:非个人完整月报|不是完整个人月报)/);
  });
}

test("microseconds, negative differences, breaks and original/selected approval lineage stay separate", () => {
  const html = build(fixture("timesheet"), "timesheet");
  for (const value of ["23400000002", "-5399999998", "1800000001", "2026-09-05T15:00:00.000003Z", "2026-09-05T10:30:00.000002Z",
    "原始记录 original", "核定合计 selected", "班次完整", "班次区间", "来源类别：approved", "rootRequestId", id(30), id(40), "previousOperationId", "带薪标记：是（true）"]) assert(html.includes(value), value);
  assert(!html.includes("&#39;-5399999998"));
  assert(html.includes("6 小时 30 分 0.000002 秒"));
  assert(html.includes("−1 小时 29 分 59.999998 秒"));
  assert(html.indexOf("<h2>查询区间汇总") < html.indexOf("<h2>来源、范围与读取记录"));
  assert.match(html, /班次完整[\s\S]*原始记录 original/);
  assert.match(html, /班次完整[\s\S]*核定合计 selected/);
});

test("unified sources preserve whole-missing declarations without fabricated original punches", () => {
  const html = build(fixture("unified"), "unified");
  for (const value of ["attendance-unified-v1", "unified-csv-v1", "54000000001", "25200000001", "3600000000", "2026-09-07T05:00:00.000001Z",
    "整段漏卡申报（wholeMissing），不是原始打卡", "missingSelected / wholeMissing", "recordedSelected", "missing-approved", "申报时员工", "申报时地点", "无，不伪造事件", id(500), id(501)]) assert(html.includes(value), value);
  const missingSection = html.slice(html.indexOf("整段漏卡申报（wholeMissing），不是原始打卡"));
  assert(!missingSection.includes("原始动作"));
});

test("quoted multiline Unicode and doubled quotes survive; user strings are HTML text only", () => {
  const command = unifiedExportCommand(), parsed = parseUnifiedExportSource(unifiedExportWire(command), command);
  const hostileName = '员工 ñ 😀, "姓名"\r\n第二行\n</td><script>alert(1)</script><img src=x onerror=alert(2)>';
  parsed.report!.base.workerName = hostileName;
  parsed.report!.missing[0].locationName = '<style>@import "https://evil.invalid";</style> & café';
  const csv = buildUnifiedExportCsv(parsed.report!, parsed.receipt);
  const html = build({ csv, filename: unifiedExportFilename(command) }, "unified");
  assert(html.includes('员工 ñ 😀, &quot;姓名&quot;\r\n第二行\n&lt;/td&gt;&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert(html.includes('&lt;style&gt;@import &quot;https://evil.invalid&quot;;&lt;/style&gt; &amp; café'));
  assert.throws(() => build({ csv, filename: '</title><svg onload="bad">.csv' }, "unified"), /attendance_report_invalid_data/);
  assert(!html.includes("<script>")); assert(!html.includes("<svg")); assert(!html.includes("<img"));
  assert.equal((html.match(/<style>/g) ?? []).length, 1);
  assert.equal((html.match(/<\/title>/g) ?? []).length, 1);
});

test("CSV formula protection in names remains text; only numeric duration apostrophes are removed", () => {
  const file = fixture("timesheet");
  const changed = { ...file, csv: file.csv.replace(quoted("Synthetic worker"), quoted("'=HYPERLINK(\"x\")")) };
  const html = build(changed, "timesheet");
  assert(html.includes("&#39;=HYPERLINK(&quot;x&quot;)"));
});

for (const kind of both) test(`${kind}: empty interval has metadata and explicit no-source caveat`, () => {
  let file: { csv: string; filename: string };
  if (kind === "timesheet") {
    const command = timesheetExportCommand(), wire = timesheetExportWire(command); wire.report.items = []; wire.receipt.sessionCount = 0;
    const parsed = parseTimesheetExportSource(wire, command);
    file = { csv: buildTimesheetExportCsv(parsed.report!, parsed.receipt), filename: timesheetExportFilename(command) };
  } else {
    const command = unifiedExportCommand(), wire = unifiedExportWire(command); wire.report.base.items = []; wire.report.missing = [];
    wire.receipt.sessionCount = wire.receipt.missingCount = wire.receipt.sourceCount = 0;
    const parsed = parseUnifiedExportSource(wire, command);
    file = { csv: buildUnifiedExportCsv(parsed.report!, parsed.receipt), filename: unifiedExportFilename(command) };
  }
  const html = build(file, kind);
  assert.match(html, /逐来源明细 · 0 个来源/);
  assert.match(html, /没有可列示来源；不表示缺勤/);
  assert.match(html, /来源读取SHA256/);
  if (kind === "timesheet") assert.match(html, /旧版 CSV 未提供/);
});

for (const kind of both) test(`${kind}: open shifts and open breaks retain unknown durations, not false zero hours`, () => {
  let file: { csv: string; filename: string };
  const events = [sheetEvent(1, "clock_in", "2026-09-05T08:00:00.000000Z"), sheetEvent(2, "break_start", "2026-09-05T10:00:00.000000Z", true)];
  if (kind === "timesheet") {
    const command = timesheetExportCommand(), wire = timesheetExportWire(command);
    wire.report.items = [{ startEventId: id(101), events, effect: null }];
    const parsed = parseTimesheetExportSource(wire, command);
    file = { csv: buildTimesheetExportCsv(parsed.report!, parsed.receipt), filename: timesheetExportFilename(command) };
  } else {
    const command = unifiedExportCommand(), wire = unifiedExportWire(command);
    wire.report.base.items = [{ startEventId: id(101), events, effect: null }]; wire.report.missing = [];
    wire.receipt.missingCount = 0; wire.receipt.sourceCount = 1;
    const parsed = parseUnifiedExportSource(wire, command);
    file = { csv: buildUnifiedExportCsv(parsed.report!, parsed.receipt), filename: unifiedExportFilename(command) };
  }
  const html = build(file, kind);
  assert.match(html, /有 1 个尚未结束班次/);
  assert.match(html, /汇总不含其未知时长/);
  const section = html.slice(html.indexOf('<section class="source">'));
  assert.match(section, /工作段：尚未结束 \/ 未知，不计作 0/);
  assert.match(section, /状态：break/); assert.match(section, /状态：open/);
  assert(!section.includes("工作段：0"));
});

test("BOM is optional; CRLF and LF record terminators and optional final newline are supported", () => {
  const file = fixture("timesheet"), expected = build(file, "timesheet");
  for (const csv of [file.csv.slice(1), file.csv.replaceAll("\r\n", "\n"), file.csv.slice(0, -2)]) {
    assert.equal(build({ ...file, csv }, "timesheet"), expected);
  }
});

for (const kind of both) test(`${kind}: malformed CSV, unknown rows/fields and missing or duplicated required data fail closed`, () => {
  const file = fixture(kind), rows = lines(file.csv);
  const variants = ["", '\ufeff"unclosed', file.csv.slice(0, -3), file.csv.replace('"记录类型",', '"记录类型"junk,'),
    file.csv.replace('"记录类型",', '記"录类型,'), file.csv.replace("\r\n", "\r"), file.csv.replace('"记录类型"', '"未知表头"'),
    file.csv.replace('"原始动作"', '"latitude"'), file.csv.replace('"导出编号"', '"secretToken"'),
    file.csv.replace('"false"', '"true"')];
  for (const csv of variants) assert.throws(() => build({ ...file, csv }, kind), /attendance_report_invalid_data/);
  for (const token of ['"商户"', '"来源读取SHA256"', '"数据截至UTC"', '"范围说明"', '"汇总","original"', '"日明细","original"', kind === "unified" ? '"打卡班次完整"' : '"班次完整"']) {
    const index = rows.findIndex(row => row.includes(token)); assert(index > 0, token);
    assert.throws(() => build(withLines(file, rows.filter((_, n) => n !== index)), kind), /attendance_report_invalid_data/, token);
    assert.throws(() => build(withLines(file, [...rows.slice(0, index), rows[index], ...rows.slice(index)]), kind), /attendance_report_invalid_data/, token);
  }
  assert.throws(() => build(withLines(file, [...rows, rows[1]]), kind), /attendance_report_invalid_data/);
  assert.throws(() => build({ ...file, csv: file.csv.replace("28800000000", "NaN") }, kind), /attendance_report_invalid_data/);
  assert.throws(() => build(file, kind === "timesheet" ? "unified" : "timesheet"), /attendance_report_invalid_data/);
});

test("source approval completeness, unknown fields, inconsistent counts and open durations are rejected", () => {
  const file = fixture("unified");
  for (const token of ['"requestId"', '"提交时地点"']) {
    assert.throws(() => build(withLines(file, lines(file.csv).filter(row => !row.includes(token))), "unified"), /attendance_report_invalid_data/);
  }
  for (const [before, after] of [[quoted("提交时姓名"), quoted("latitude")], [quoted("54000000001"), quoted("9007199254740993")],
    ['"来源合计数","2"', '"来源合计数","1"'], ['"completed"', '"working"']]) {
    assert.notEqual(file.csv.replace(before, after), file.csv);
    assert.throws(() => build({ ...file, csv: file.csv.replace(before, after) }, "unified"), /attendance_report_invalid_data/);
  }
});

test("UTF-8 bytes, row count, cell length and input-shape limits reject rather than truncate", () => {
  const file = fixture("timesheet");
  assert.equal(ATTENDANCE_PRINT_MAX_BYTES, 4 * 1024 * 1024);
  assert.throws(() => build({ ...file, csv: "x".repeat(ATTENDANCE_PRINT_MAX_BYTES + 1) }, "timesheet"), /attendance_report_too_large/);
  assert.throws(() => build({ ...file, csv: "字".repeat(Math.floor(ATTENDANCE_PRINT_MAX_BYTES / 3) + 1) }, "timesheet"), /attendance_report_too_large/);
  const giantCell = file.csv.replace("Synthetic worker", "x".repeat(ATTENDANCE_PRINT_MAX_CELL_CHARACTERS + 1));
  assert.throws(() => build({ ...file, csv: giantCell }, "timesheet"), /attendance_report_too_large/);
  const row = lines(file.csv).find(line => line.startsWith('"原始动作"'))!;
  const tooManyRows = file.csv + (row + "\r\n").repeat(ATTENDANCE_PRINT_MAX_ROWS);
  assert(Buffer.byteLength(tooManyRows) < ATTENDANCE_PRINT_MAX_BYTES);
  assert.throws(() => build({ ...file, csv: tooManyRows }, "timesheet"), /attendance_report_too_large/);
  for (const filename of ["", "  ", "x".repeat(513)]) assert.throws(() => build({ ...file, filename }, "timesheet"), /attendance_report_invalid_data/);
  assert.throws(() => build(file, "bad" as AttendancePrintKind), /attendance_report_invalid_data/);
  assert.throws(() => build(null as unknown as Parameters<typeof build>[0], "timesheet"), /attendance_report_invalid_data/);
});

for (const kind of both) test(`${kind}: source receipt binds every identity, permission scope, time, hash and count`, () => {
  const command = timesheetExportCommand("manager"), file = fixture(kind, "manager");
  const receipt = kind === "unified" ? parseUnifiedExportSource(unifiedExportWire(command), command).receipt
    : parseTimesheetExportSource(timesheetExportWire(command), command).receipt;
  assert.equal(build(file, kind, receipt), build(file, kind));
  for (const patch of [{ operationId: id(801) }, { siteId: "99990008" }, { workerId: id(9) }, { access: "self" as const }, { locationId: id(6) },
    { scopeRevision: 2 }, { fromDate: "2026-09-02" }, { throughDate: "2026-09-29" }, { timeZone: "UTC" },
    { asOf: "2026-09-30T12:00:00.000001Z" }, { recordedAt: "2026-09-30T12:00:00.000001Z" }, { sourceSha256: "b".repeat(64) }, { sourceBytes: 2049 }, { sessionCount: 2 }]) {
    assert.throws(() => build(file, kind, { ...receipt, ...patch }), /attendance_report_invalid_data/, JSON.stringify(patch));
  }
  for (const [before, after] of [[quoted(id(4)), quoted(id(9))], [quoted("a".repeat(64)), quoted("b".repeat(64))], [quoted("2048"), quoted("2049")]]) {
    assert.throws(() => build({ ...file, csv: file.csv.replace(before, after) }, kind, receipt), /attendance_report_invalid_data/);
  }
  if (kind === "unified" && "reportVersion" in receipt) {
    for (const patch of [{ missingCount: 0 }, { sourceCount: 1 }]) assert.throws(() => build(file, kind, { ...receipt, ...patch }), /attendance_report_invalid_data/);
    assert.throws(() => build(file, kind, timesheetExportWire(command).receipt), /attendance_report_invalid_data/);
  } else assert.throws(() => build(file, kind, unifiedExportWire(command).receipt), /attendance_report_invalid_data/);
});

for (const kind of both) test(`${kind}: filename cannot disguise another operation, merchant, period or report kind`, () => {
  const file = fixture(kind);
  for (const filename of [file.filename.replace(id(800), id(801)), file.filename.replace("99990009", "99990008"),
    file.filename.replace("2026-09-01", "2026-09-02"), file.filename.replace("2026-09-30", "2026-09-29"), "report.csv"]) {
    assert.throws(() => build({ ...file, filename }, kind), /attendance_report_invalid_data/);
  }
  assert.throws(() => build({ ...file, csv: file.csv.replace(quoted(id(800)), quoted(id(801))) }, kind), /attendance_report_invalid_data/);
});

test("HTML escaping expansion is bounded independently from valid CSV byte and row limits", () => {
  const command = unifiedExportCommand(), parsed = parseUnifiedExportSource(unifiedExportWire(command), command), report = parsed.report!;
  const missing = report.missing[0], text = "<".repeat(ATTENDANCE_PRINT_MAX_CELL_CHARACTERS);
  report.missing = Array.from({ length: 99 }, (_, n) => ({ ...missing, requestId: id(500 + n * 2), operationId: id(501 + n * 2), workerName: text, locationName: text }));
  const receipt = { ...parsed.receipt, missingCount: 99, sourceCount: 100 };
  const file = { csv: buildUnifiedExportCsv(report, receipt), filename: unifiedExportFilename(command) };
  assert(Buffer.byteLength(file.csv) < ATTENDANCE_PRINT_MAX_BYTES);
  assert.throws(() => build(file, "unified", receipt), /attendance_report_too_large/);
});
