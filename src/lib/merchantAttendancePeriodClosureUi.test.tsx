import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import React from "react";
import { periodClosureAllowsMutation, periodClosureCanSendPreview } from "./merchantAttendancePeriodClosureClient";
import { renderToStaticMarkup } from "react-dom/server";
import Launcher from "../components/enterprise/MerchantAttendancePeriodClosureLauncher";
import Workspace, { buildPeriodClosureOutput, confirmPeriodClosureAction, PeriodClosureSavedReport, periodClosureSavedContext } from "../components/enterprise/MerchantAttendancePeriodClosureWorkspace";
import { periodClosureUiArtifact as artifact, periodClosureUiId as id, periodClosureUiOwner as owner, periodClosureUiEmployee as employee,
  periodClosureUiPeriod as period, periodClosureUiQuery as query } from "../../scripts/fixtures/attendance-period-closure-ui-model";
const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const component = (name: string) => source(`../components/enterprise/${name}.tsx`);
const q = query(); let calls = 0;
const props = { siteId: q.siteId, access: "owner" as const, actorId: owner, workerId: q.workerId, fromDate: q.fromDate, throughDate: q.throughDate,
  apiFetch: async () => { calls++; throw Error("SSR must never fetch"); } };

test("new entry is exact default-off and closed; SSR never fetches or reads storage", () => {
  const before = process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_PERIOD_CLOSURES_ENABLED;
  try { for (const value of [undefined, "", "true", "0"]) { if (value === undefined) delete process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_PERIOD_CLOSURES_ENABLED; else process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_PERIOD_CLOSURES_ENABLED = value;
    assert.equal(renderToStaticMarkup(<Launcher {...props}/>), ""); }
    const html = renderToStaticMarkup(<Launcher {...props} enabled/>); assert.match(html, /周期核对、争议与封存/); assert.doesNotMatch(html, /data-period-closure|textarea/); assert.equal(calls, 0);
  } finally { if (before === undefined) delete process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_PERIOD_CLOSURES_ENABLED; else process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_PERIOD_CLOSURES_ENABLED = before; }
});
test("owner/self workspace explains the same saved version, explicit consent and limited authority", () => {
  const a = renderToStaticMarkup(<Workspace {...props} enabled onClose={() => {}}/>), b = renderToStaticMarkup(<Workspace {...props} access="self" actorId={employee} enabled onClose={() => {}}/>);
  for (const html of [a, b]) { assert.match(html, /aria-label="周期核对与封存"/); assert.match(html, /沉默、已读或负责人回复不代替本人确认/); assert.match(html, /包含原始记录、最新批准补正及整段漏卡/); assert.match(html, /缺记录不等于缺勤/); assert.match(html, /读取周期列表/); }
  assert.match(a, /封存及重开仅当前负责人操作/); assert.match(a, /预览完整周期资料/); assert.match(b, /不能代负责人封存或重开/); assert.doesNotMatch(b, /预览完整周期资料/); assert.equal(calls, 0);
});
test("flag-off recovery view does not promise disabled server recovery or automatic reads", () => {
  const html = renderToStaticMarkup(<Workspace {...props} enabled={false} onClose={() => {}}/>);
  assert.match(html, /不保证当前服务器一定可恢复/); assert.match(html, /新操作入口关闭/); assert.equal(calls, 0);
});
test("saved report renders distinct raw/corrected/missing values and identities safely", () => {
  const a = artifact(); a.worker.workerName = '<img src=x onerror="bad">';
  const html = renderToStaticMarkup(<PeriodClosureSavedReport artifact={a}/>);
  assert.match(html, /&lt;img/); assert.doesNotMatch(html, /<img/); assert.match(html, /独立已批准整段漏卡（不是原打卡）/);
  assert.match(html, /原记录与最新批准补正/); assert.match(html, /2026-09-02T08:00:00.000000Z/); assert.match(html, /2026-09-02T09:00:00.000000Z/);
  assert.match(html, /最新批准整段漏卡/); assert.match(html, /不自动加回工作段/); assert.match(html, new RegExp(a.report.missing[0].operationId));
});
test("source rendering is bounded to ten visible records with local pager, not giant JSON", () => {
  const a = artifact(), template = a.report.base.rows[0];
  // This test isolates bounded rendering, not arithmetic/source validity.
  a.report.base.rows = Array.from({ length: 12 }, (_, n) => ({ ...structuredClone(template), startEventId: id(3000 + n) })); a.report.missing = [];
  const html = renderToStaticMarkup(<PeriodClosureSavedReport artifact={a}/>); assert.match(html, /周期来源本地分页/); assert.match(html, /每页最多 10 条/);
  assert.match(html, new RegExp(id(3009))); assert.doesNotMatch(html, new RegExp(id(3010))); assert.doesNotMatch(html, /UI only|synthetic/);
});
test("frozen CSV/print contain saved versions, original event and correction/missing evidence without today's calculations", () => {
  const a = artifact(), file = buildPeriodClosureOutput(a, period, 1);
  assert.match(file.csv, /固定版本，不是工资或法律签名/); assert.match(file.csv, /原事件引用/); assert.match(file.csv, /批准版本/); assert.match(file.csv, /已批准整段漏卡/);
  assert.match(file.csv, /保存日界/); assert.match(file.csv, new RegExp(a.sourceFingerprint)); assert.match(file.csv, new RegExp(a.report.missing[0].operationId));
  assert.match(file.html, /data-attendance-print-document="unified"/); assert.match(file.html, /Content-Security-Policy/); assert.match(file.html, /不是工资结算、法律签名或当前事实未变化的证明/);
  assert.equal(file.filename, `attendance-period-${period}-v1.csv`);
  const code = component("MerchantAttendancePeriodClosureWorkspace"); assert.doesNotMatch(code, /buildUnifiedExport|parseUnifiedSource|attendanceDayUtcRange|Intl\.|Date\.parse/);
});
test("CSV formula cells are inert and HTML is escaped; worker labels cannot become scripts", () => {
  const a = artifact(); a.worker.workerName = '=HYPERLINK("https://bad")'; a.worker.workerNo = '<svg onload="bad">';
  const file = buildPeriodClosureOutput(a, period, 1); assert.match(file.csv, /"'=HYPERLINK/); assert.match(file.html, /&lt;svg/); assert.doesNotMatch(file.html, /<svg|<script|<iframe/);
});
test("all saved context sections and latest missing revision are included in fixed outputs without truncation", () => {
  const a = artifact(), entries = periodClosureSavedContext(a), file = buildPeriodClosureOutput(a, period, 1), html = renderToStaticMarkup(<PeriodClosureSavedReport artifact={a}/>);
  assert.equal(entries.length, 6);
  for (const entry of entries) { assert.match(html, new RegExp(entry.title)); assert(file.csv.includes(entry.title)); assert(file.html.includes(entry.title)); }
  assert.match(file.html, /&quot;revision&quot;:2/); assert.match(file.html, /Synthetic leave &lt;img/); assert.doesNotMatch(file.html, /<img/);
  assert.match(html, /周期已保存完整上下文/); assert.match(html, /完整保存来源（含原事件、身份与最新修订链）/); assert.doesNotMatch(html, /Synthetic leave/);
  assert(file.csv.includes('""purpose""') === false); assert(file.csv.includes('"purpose"')); // Root fields are preserved individually.
});
test("confirmation cannot cross synchronous identity/generation changes or rejected dialogs", () => {
  let current = true, writes = 0;
  assert.equal(confirmPeriodClosureAction(() => false, () => current, () => writes++), false);
  assert.equal(confirmPeriodClosureAction(() => { current = false; return true; }, () => current, () => writes++), false);
  assert.equal(confirmPeriodClosureAction(() => true, () => current, () => writes++), false); assert.equal(writes, 0);
  current = true; assert.equal(confirmPeriodClosureAction(() => true, () => current, () => writes++), true); assert.equal(writes, 1);
});
test("reopen remains an explicit owner-only sealed-state UI action while creation is paused", () => {
  assert.equal(periodClosureAllowsMutation("reopen", false, false), true);
  for (const action of ["send", "confirm", "dispute", "respond", "seal"] as const) assert.equal(periodClosureAllowsMutation(action, false, false), false);
  const code = component("MerchantAttendancePeriodClosureWorkspace"); assert.match(code, /newActions \|\| access === "owner" && period\?\.sealed/);
  assert.match(code, /disabled=\{!writable \|\| !validReason \|\| !period\.sealed/);
});
test("send UI distinguishes unfinished period from complete but unresolved review material", () => {
  assert.equal(periodClosureCanSendPreview([]), true); assert.equal(periodClosureCanSendPreview(["open_session", "pending_correction", "pending_missing", "pending_leave", "unresolved_review"]), true);
  assert.equal(periodClosureCanSendPreview(["period_in_progress"]), false); assert.equal(periodClosureCanSendPreview(["pending_missing", "period_in_progress"]), false);
  const code = component("MerchantAttendancePeriodClosureWorkspace"); assert.match(code, /这些问题解决前不能封存/); assert.match(code, /!periodClosureCanSendPreview\(result\.preview\.blockers\)/);
});
test("workspace lifetime, leave guard, pending and fixed export do not use localStorage, polling or generic POST retry", () => {
  const code = component("MerchantAttendancePeriodClosureWorkspace"), client = source("./merchantAttendancePeriodClosureClient.ts");
  assert.match(code, /registerLeaveGuard\?\.\(leave\)/); assert.match(code, /beforeunload/); assert.match(code, /pagehide/); assert.match(code, /visibilitychange/);
  assert.match(code, /epoch\.current/); assert.match(code, /printController\.current\?\.abort/); assert.match(code, /client\.pause/); assert.match(code, /sessionStorage/);
  assert.match(code, /当前来源未重新核查/); assert.match(code, /结果|state\.definitiveRejection/); assert.match(code, /client\.exportVersion/);
  assert.doesNotMatch(code + client, /localStorage|setInterval|\.retry\(|clock_out|location-schedule|terminal-schedule/);
  assert.match(code, /key=\{artifact\.sourceFingerprint\}/); assert.match(client, /query\("export", periodId, version\)/);
});
test("Unified is the only complete-report mount, with owner/self only and guards through both legacy navigation shells", () => {
  const unified = component("MerchantAttendanceUnifiedTimesheetPanel"); assert.match(unified, /MerchantAttendancePeriodClosureLauncher/); assert.match(unified, /query\.access !== "manager"/);
  assert.match(unified, /registerLeaveGuard=\{registerPeriodGuard\}/); assert.match(unified, /key=\{state\.result\?\.base\.asOf \?\? state\.phase\}/);
  for (const name of ["MerchantAttendanceTimesheetPanel", "MerchantAttendanceScopedTimesheetPanel"]) {
    const code = component(name); assert.match(code, /registerLeaveGuard\?\.\(mayLeave\)/); assert.match(code, /registerLeaveGuard=\{registerChildGuard\}/);
    assert.match(code, /if\(mayLeave\(\)\).*client\.setDates/); assert.doesNotMatch(code, /MerchantAttendancePeriodClosureWorkspace/);
  }
  assert.match(component("MerchantAttendanceUnifiedTimesheetLauncher"), /registerLeaveGuard\?/); assert.match(component("MerchantAttendanceScopedTimesheetLauncher"), /registerLeaveGuard\?/);
});
test("Admin/self forced-auth keys and safe clock-out remain separate from period leave protection", () => {
  const admin = component("MerchantAttendanceAdminPanel"), self = component("MerchantAttendanceSelfPanel");
  assert.match(admin, /period-context:.*authorizationEpoch/); assert.match(self, /period-context:.*authorizationEpoch/); assert.match(self, /registerLeaveGuard=\{registerPeriodLeaveGuard\}/);
  assert.match(self, /const mayLeavePeriod/); assert.match(self, /if \(!mayLeavePeriod\(\)\) return/);
  assert.doesNotMatch(self, /periodClosurePendingKey|AttendancePeriodClosureClient|period.*blocksOtherActions|mayLeavePeriod[^\n]*clock_out/);
  assert.doesNotMatch(source("./merchantAttendancePeriodClosureClient.ts"), /new AttendanceSelfClient|new AttendanceLocationClockClient|new AttendancePinClockClient/);
});
test("browser callback is inert and bounded, routes only real period endpoint and awaits the actual response before assertions", () => {
  const code = source("../../scripts/fixtures/attendance-period-closure-browser.mjs"), entry = source("../../scripts/fixtures/attendance-period-closure-browser-entry.tsx");
  assert.match(code, /export async function runPeriodClosureBrowserAcceptance/); assert.match(code, /write:false/); assert.match(code, /requests\.length<45/); assert.match(code, /await handle\(req/);
  assert.match(code, /waitForResponse/); assert.match(code, /response\.finished/); assert.match(code, /period_get_changed_facts/); assert.match(code, /runAttendanceCleanupSteps/);
  assert.match(code, /owner\.paused_reopen/); assert.match(code, /owner\.reload_recover/); assert.match(code, /frozen\.export_v1/); assert.match(code, /period_390px_overflow/);
  assert.match(entry, /UnifiedLauncher/); assert.doesNotMatch(code, /writeFile|screenshot\(|process\.argv|execCommand|newCluster|pg_ctl/);
});
