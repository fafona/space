// Loopback only. Bundles in memory, no .env, production credentials or full build.
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { compile } from "@tailwindcss/node";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const demo = ["owner-entry", "portal", "revision-history", "revision-approval", "revision-cycle", "timesheet-export", "scoped-timesheet", "timesheet", "correction-decision", "correction-controls", "correction-review", "correction", "exception-workspace", "employee-location-workspace", "location-workspace", "location-setup", "location-notice", "location-discussion", "location-review", "location-policy", "location-clock", "location", "management", "admin"].find(name => process.argv.includes(`--${name}`)) ?? "self";
const withDatabaseEntry=process.argv.includes('--database-entry');
const withMerchantShell=process.argv.includes('--merchant-shell');
const withLeaveShell=withMerchantShell&&process.argv.includes('--leave-shell');
if(process.argv.includes('--leave-shell')&&!withMerchantShell)throw Error('attendance_leave_shell_requires_merchant_shell');
if(withLeaveShell&&process.argv.slice(2).some(flag=>!['--merchant-shell','--leave-shell','--check-only'].includes(flag)))
  throw Error('attendance_leave_shell_conflicting_entry_flags');
const withTerminalShell=withMerchantShell&&process.argv.includes('--terminal-shell');
const withPinShell=withMerchantShell&&process.argv.includes('--pin-shell');
if(process.argv.includes('--pin-shell')&&!withMerchantShell)throw Error('attendance_pin_shell_requires_merchant_shell');
if(withPinShell&&process.argv.slice(2).some(flag=>!['--merchant-shell','--pin-shell','--check-only'].includes(flag)))
  throw Error('attendance_pin_shell_conflicting_entry_flags');
if(process.argv.includes('--terminal-shell')&&!withMerchantShell)throw Error('attendance_terminal_shell_requires_merchant_shell');
if(withTerminalShell&&process.argv.slice(2).some(flag=>!['--merchant-shell','--terminal-shell','--check-only'].includes(flag)))
  throw Error('attendance_terminal_shell_conflicting_entry_flags');
const withControls=withMerchantShell&&process.argv.includes('--controls');
const withCorrectionFlow=withMerchantShell&&process.argv.includes('--correction-flow');
const withMissingFlow=withCorrectionFlow&&process.argv.includes('--missing-flow');
if(process.argv.includes('--missing-flow')&&!withCorrectionFlow)throw Error('attendance_missing_flow_requires_correction_shell');
if(process.argv.includes('--correction-flow')&&!withMerchantShell)throw Error('attendance_correction_flow_requires_merchant_shell');
if(withCorrectionFlow&&process.argv.slice(2).some(flag=>!['--merchant-shell','--correction-flow','--missing-flow','--check-only'].includes(flag)))
  throw Error('attendance_correction_flow_conflicting_entry_flags');
const withLocationSettings=withMerchantShell&&process.argv.includes('--location-settings');
const withLocationExceptions=withMerchantShell&&process.argv.includes('--location-exceptions');
if(process.argv.includes('--location-exceptions')&&!withMerchantShell)throw Error('attendance_location_exceptions_require_merchant_shell');
const withEmployeeLocation=withMerchantShell&&(process.argv.includes('--employee-location')||withLocationExceptions);
if(process.argv.includes('--employee-location')&&!withMerchantShell)throw Error('attendance_employee_location_require_merchant_shell');
if(withEmployeeLocation&&process.argv.slice(2).some(flag=>!['--merchant-shell',withLocationExceptions?'--location-exceptions':'--employee-location','--check-only'].includes(flag)))
  throw Error('attendance_employee_location_conflicting_entry_flags');
if(process.argv.includes('--location-settings')&&!withMerchantShell)throw Error('attendance_location_settings_require_merchant_shell');
if(withLocationSettings&&process.argv.slice(2).some(flag=>!['--merchant-shell','--location-settings','--check-only'].includes(flag)))
  throw Error('attendance_location_settings_conflicting_entry_flags');
if(process.argv.includes('--controls')&&!withMerchantShell)throw Error('attendance_controls_require_merchant_shell');
if(withControls&&process.argv.slice(2).some(flag=>!['--merchant-shell','--controls','--check-only'].includes(flag)))
  throw Error('attendance_controls_conflicting_entry_flags');
const withSchedule=process.argv.includes('--schedule');
const withMissing=process.argv.includes('--missing');
const withUnified=process.argv.includes('--unified');
const withTerminals=process.argv.includes('--terminals');
const withKioskCorrection=process.argv.includes('--kiosk-correction');
const withPin=process.argv.includes('--pin');
const withPinClock=process.argv.includes('--pin-clock');
const withPinWorkflow=process.argv.includes('--pin-workflow');
const withTerminalRecovery=process.argv.includes('--terminal-recovery');
const withOnsiteQr=process.argv.includes('--onsite-qr');
const withEventChannels=process.argv.includes('--event-channels');
const withEventChannelsShell=process.argv.includes('--event-channels-shell');
const withNoticeCoverage=process.argv.includes('--notice-coverage');
if(withNoticeCoverage&&process.argv.slice(2).some(flag=>!['--notice-coverage','--check-only'].includes(flag)))throw Error('attendance_notice_coverage_conflicting_flags');
const withSelfRevisionHistory=process.argv.includes('--self-revision-history');
if(withSelfRevisionHistory&&process.argv.slice(2).some(flag=>!['--self-revision-history','--check-only'].includes(flag)))throw Error('attendance_self_revision_history_conflicting_flags');
const withOwnerBacklog=process.argv.includes('--owner-backlog');
if(withOwnerBacklog&&process.argv.slice(2).some(flag=>!['--owner-backlog','--check-only'].includes(flag)))throw Error('attendance_owner_backlog_conflicting_flags');
const withSelfRequests=process.argv.includes('--self-requests');
if(withSelfRequests&&process.argv.slice(2).some(flag=>!['--self-requests','--check-only'].includes(flag)))throw Error('attendance_self_requests_conflicting_flags');
const withShiftTemplates=process.argv.includes('--shift-templates');
if(withShiftTemplates&&process.argv.slice(2).some(flag=>!['--shift-templates','--check-only'].includes(flag)))throw Error('attendance_shift_templates_conflicting_flags');
const withScheduleOverview=process.argv.includes('--schedule-overview');
if(withScheduleOverview&&process.argv.slice(2).some(flag=>!['--schedule-overview','--check-only'].includes(flag)))throw Error('attendance_schedule_overview_conflicting_flags');
const withLeave=process.argv.includes('--leave');
if(withLeave&&process.argv.slice(2).some(flag=>!['--leave','--check-only'].includes(flag)))throw Error('attendance_leave_conflicting_flags');
const withLeaveNotifications=process.argv.includes('--leave-notifications');
if(withLeaveNotifications&&process.argv.slice(2).some(flag=>!['--leave-notifications','--check-only'].includes(flag)))throw Error('attendance_leave_notifications_conflicting_flags');
const withLeaveReview=process.argv.includes('--leave-review');
if(withLeaveReview&&process.argv.slice(2).some(flag=>!['--leave-review','--check-only'].includes(flag)))throw Error('attendance_leave_review_conflicting_flags');
const withLeaveParentBoundary=process.argv.includes('--leave-parent-boundary');
if(withLeaveParentBoundary&&process.argv.slice(2).some(flag=>!['--leave-parent-boundary','--check-only'].includes(flag)))throw Error('attendance_leave_parent_boundary_conflicting_flags');
const withCalendar=process.argv.includes('--calendar');
if(withCalendar&&process.argv.slice(2).some(flag=>!['--calendar','--check-only'].includes(flag)))throw Error('attendance_calendar_conflicting_flags');
const withGroups=process.argv.includes('--groups');
if(withGroups&&process.argv.slice(2).some(flag=>!['--groups','--check-only'].includes(flag)))throw Error('attendance_groups_conflicting_flags');
const withEnterpriseShell=demo==='portal'||demo==='owner-entry'||withDatabaseEntry||withMerchantShell||withSchedule||withMissing||withUnified||withTerminals||withKioskCorrection||withPin||withPinClock||withPinWorkflow||withTerminalRecovery||withOnsiteQr||withEventChannels||withEventChannelsShell||withNoticeCoverage||withSelfRevisionHistory||withOwnerBacklog||withSelfRequests||withShiftTemplates||withScheduleOverview||withLeave||withLeaveNotifications||withLeaveReview||withLeaveParentBoundary||withCalendar||withGroups;
const entry = `scripts/fixtures/attendance-${withGroups?'groups':withCalendar?'calendar':withLeaveParentBoundary?'leave-parent-boundary':withLeaveReview?'leave-review':withLeaveNotifications?'leave-notifications':withLeave?'leave':withScheduleOverview?'schedule-overview':withShiftTemplates?'shift-templates':withSelfRequests?'self-requests':withOwnerBacklog?'owner-backlog':withSelfRevisionHistory?'self-revision-history':withNoticeCoverage?'notice-coverage':withEventChannelsShell?'event-channels-shell':withEventChannels?'event-channels':withOnsiteQr?'onsite-qr':withTerminalRecovery?'terminal-recovery':withPinWorkflow?'pin-workflow':withPinClock?'pin-clock':withPin?'pin':withKioskCorrection?'kiosk-correction':withTerminals?'terminals':withUnified?'unified':withMissing?'missing':withSchedule?'schedule':withMerchantShell?'merchant-shell':withDatabaseEntry?'database':demo}-browser.tsx`;
// Standalone panels also import Next client helpers. Replace unknown env reads
// with an empty browser-only object in every mode; never load actual .env.
const portalDefines=withEnterpriseShell?{"process.env":'{}',"process.env.NEXT_PUBLIC_SUPABASE_URL":'"http://127.0.0.1:3131"',"process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY":'"attendance-synthetic-anon"',"process.env.NEXT_PUBLIC_SUPABASE_DISABLE_AUTO_REFRESH":'"1"'}:{"process.env":'{}'};
portalDefines['process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_EVENT_CHANNELS_ENABLED']=withEventChannels||withEventChannelsShell?'"1"':'"0"';
portalDefines['process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_NOTICE_COVERAGE_ENABLED']=withNoticeCoverage?'"1"':'"0"';
portalDefines['process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_SELF_REVISION_HISTORY_ENABLED']=withSelfRevisionHistory?'"1"':'"0"';
portalDefines['process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_OWNER_BACKLOG_ENABLED']=withOwnerBacklog?'"1"':'"0"';
portalDefines['process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_SELF_REQUESTS_ENABLED']=withSelfRequests?'"1"':'"0"';
portalDefines['process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_SHIFT_TEMPLATES_ENABLED']=withShiftTemplates?'"1"':'"0"';
portalDefines['process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_SCHEDULE_OVERVIEW_ENABLED']=withScheduleOverview?'"1"':'"0"';
portalDefines['process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_LEAVE_ENABLED']=withLeave||withLeaveReview||withLeaveParentBoundary?'"1"':'"0"';
portalDefines['process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_LEAVE_NOTIFICATIONS_ENABLED']=withLeaveNotifications||withLeaveParentBoundary?'"1"':'"0"';
portalDefines['process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_LEAVE_REVIEW_ENABLED']=withLeaveReview?'"1"':'"0"';
portalDefines['process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_CALENDAR_ENABLED']=withCalendar?'"1"':'"0"';
portalDefines['process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_GROUPS_ENABLED']=withGroups?'"1"':'"0"';
portalDefines['process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_SCHEDULE_ENABLED']=withSchedule?'"1"':'"0"';
portalDefines['process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_MISSING_ENABLED']=withMissing?'"1"':'"0"';
portalDefines['process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_TERMINALS_ENABLED']=withTerminals||withTerminalShell||withPinShell?'"1"':'"0"';
portalDefines['process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_PIN_ENABLED']=withPin||withPinShell?'"1"':'"0"';
portalDefines['process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_PIN_CLOCK_ENABLED']=withPinClock||withTerminalRecovery||withPinShell?'"1"':'"0"';
portalDefines['process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_UNIFIED_REPORT_ENABLED']=withUnified||withEventChannelsShell?'"1"':'"0"';
portalDefines['process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_UNIFIED_EXPORT_ENABLED']=process.argv.includes('--unified-export')?'"1"':'"0"';
if(withDatabaseEntry)portalDefines['process.env.NEXT_PUBLIC_SUPABASE_URL']='"https://127.0.0.1:3131"';
if(withMerchantShell)portalDefines['process.env.NEXT_PUBLIC_SUPABASE_URL']='"https://127.0.0.1:3131"';
if(withEventChannelsShell)portalDefines['process.env.NEXT_PUBLIC_SUPABASE_URL']='"https://127.0.0.1:3131"';
const portalFeatureDefines=demo==='portal'&&process.argv.includes("--portal-features")?Object.fromEntries(["EMPLOYEE_LOCATION_WORKSPACE","CORRECTIONS"].map(name=>["process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_"+name+"_ENABLED",'"1"'])):{};
if(withLeaveShell)for(const feature of ['LEAVE','LEAVE_NOTIFICATIONS'])portalFeatureDefines['process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_'+feature+'_ENABLED']='"1"';
if(withPinWorkflow)portalFeatureDefines['process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_REVISION_CYCLES_ENABLED']='"1"';
if(withEventChannelsShell)for(const feature of ['CORRECTIONS','SCOPED_TIMESHEET'])portalFeatureDefines['process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_'+feature+'_ENABLED']='"1"';
if(withControls)portalFeatureDefines['process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_CORRECTION_CONTROLS_ENABLED']='"1"';
if(withCorrectionFlow)for(const feature of ['CORRECTIONS','CORRECTION_REVIEW','CORRECTION_CONTROLS','CORRECTION_DECISIONS','CURRENT_CORRECTION_DECISIONS','REVISION_CYCLES','REVISION_DECISIONS','REVISION_HISTORY','TIMESHEET','SCOPED_TIMESHEET','TIMESHEET_EXPORT'])
  portalFeatureDefines['process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_'+feature+'_ENABLED']='"1"';
if(withMissingFlow)for(const feature of ['MISSING','UNIFIED_REPORT','UNIFIED_EXPORT'])
  portalFeatureDefines['process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_'+feature+'_ENABLED']='"1"';
if(withLocationSettings||withEmployeeLocation)portalFeatureDefines['process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_LOCATION_WORKSPACE_ENABLED']='"1"';
if(withEmployeeLocation)portalFeatureDefines['process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_EMPLOYEE_LOCATION_WORKSPACE_ENABLED']='"1"';
if(withLocationExceptions)portalFeatureDefines['process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_EXCEPTION_WORKSPACE_ENABLED']='"1"';
const bundle = await build({ absWorkingDir: root, entryPoints: [entry], bundle: true, write: false, metafile:withEnterpriseShell,format: "esm", platform: "browser",
  outfile:withEnterpriseShell?"attendance-qa.js":undefined, target: ["es2020"], jsx: "automatic", tsconfig: path.join(root, "tsconfig.json"), define: { ...portalDefines, "process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_REVISION_HISTORY_ENABLED": '"0"', "process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_REVISION_DECISIONS_ENABLED": '"0"', "process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_REVISION_CYCLES_ENABLED": '\"0\"', "process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_TIMESHEET_EXPORT_ENABLED": '\"0\"', "process.env.NODE_ENV": '"development"', "process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_LOCATION_WORKSPACE_ENABLED": '"0"', "process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_EMPLOYEE_LOCATION_WORKSPACE_ENABLED": '"0"', "process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_EXCEPTION_WORKSPACE_ENABLED": '"0"', "process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_CORRECTIONS_ENABLED": '"0"', "process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_CORRECTION_REVIEW_ENABLED": '"0"', "process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_CORRECTION_CONTROLS_ENABLED": '"0"', "process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_CORRECTION_DECISIONS_ENABLED": '"0"', "process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_SCOPED_TIMESHEET_ENABLED": '"0"', "process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_TIMESHEET_ENABLED": '"0"' , ...portalFeatureDefines }, logLevel: "warning" });
const candidates = new Set();
for (const file of [entry, ...Object.keys(bundle.metafile?.inputs??{}).filter(f=>f.startsWith('src/')&&/\.tsx?$/.test(f)), "src/components/enterprise/MerchantAttendanceRevisionHistoryPanel.tsx", "src/components/enterprise/MerchantAttendanceRevisionApprovalPanel.tsx", "src/components/enterprise/MerchantAttendanceRevisionWorkspace.tsx", "src/components/enterprise/MerchantAttendanceTimesheetExport.tsx", "src/components/enterprise/MerchantAttendanceScopedTimesheetPanel.tsx", "src/components/enterprise/MerchantAttendanceScopedTimesheetLauncher.tsx", "src/components/enterprise/MerchantAttendanceTimesheetPanel.tsx", "src/components/enterprise/MerchantAttendanceSelfPanel.tsx", "src/components/enterprise/MerchantAttendanceAdminPanel.tsx",
  "src/components/enterprise/MerchantAttendanceScopePanel.tsx", "src/components/enterprise/MerchantAttendanceRecordsPanel.tsx", "src/components/enterprise/MerchantAttendanceCorrectionControlsPanel.tsx", "src/components/enterprise/MerchantAttendanceCorrectionDecisionPanel.tsx",
  "src/components/enterprise/MerchantAttendanceHistoryPanel.tsx", "src/components/enterprise/MerchantAttendanceCorrectionWorkspace.tsx", "src/components/enterprise/MerchantAttendanceCorrectionReviewPanel.tsx", "src/components/enterprise/MerchantAttendanceAuditPanel.tsx", "src/components/enterprise/MerchantAttendanceAuditExport.tsx",
  "src/components/enterprise/MerchantAttendanceSessionPanel.tsx", "src/components/enterprise/MerchantAttendanceLocationCheckPanel.tsx",
  "src/components/enterprise/MerchantAttendanceLocationClockPanel.tsx", "src/components/enterprise/MerchantAttendanceLocationPolicyPanel.tsx",
  "src/components/enterprise/MerchantAttendanceLocationReviewPanel.tsx", "src/components/enterprise/MerchantAttendanceLocationDiscussionPanel.tsx",
  "src/components/enterprise/MerchantAttendanceLocationNoticePanel.tsx", "src/components/enterprise/MerchantAttendanceLocationSetupPanel.tsx",
  "src/components/enterprise/MerchantAttendanceLocationWorkspace.tsx", "src/components/enterprise/MerchantAttendanceEmployeeLocationWorkspace.tsx", "src/components/enterprise/MerchantAttendanceExceptionWorkspace.tsx"]) {
  const source = ts.createSourceFile(file, await readFile(path.join(root, file), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  function visit(node) {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node))
      node.text.split(/\s+/).filter(Boolean).forEach((candidate) => candidates.add(candidate));
    ts.forEachChild(node, visit);
  }
  visit(source);
}
const css = (await compile('@import "tailwindcss";', { base: root, onDependency: () => {} })).build([...candidates]) +
  bundle.outputFiles.filter(f=>f.path.endsWith('.css')).map(f=>f.text).join('\n')+
  "body{margin:0;background:#f1f5f9;color:#0f172a;font-family:Arial,sans-serif}.qa-toolbar{background:#fff7ed;padding:12px;border-bottom:2px solid #fb923c;font-size:13px}.qa-controls{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0}.qa-controls button,.qa-controls select{background:white;border:1px solid #94a3b8;border-radius:6px;padding:5px 9px}.qa-main{max-width:1160px;margin:auto;padding:16px}.qa-controls button:disabled{opacity:.4}";
if (process.argv.includes("--check-only")) {
  console.log(JSON.stringify({inMemoryBundle:true,entry,javascriptBytes:bundle.outputFiles[0].contents.length,cssBytes:Buffer.byteLength(css),serverStarted:false}));
  process.exit(0);
}
const server = createServer((request, response) => {
  if (request.headers.host !== "127.0.0.1:3131") return response.writeHead(403).end();
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Security-Policy", `default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src ${withEnterpriseShell?"'self'":"'none'"}; img-src 'self' data:; ${withOnsiteQr?"media-src 'self' blob:; ":""}font-src 'self'; base-uri 'none'; frame-ancestors 'none'`);
  if (request.method !== "GET") return response.writeHead(403).end();
  const pathname = new URL(request.url || "/", "http://127.0.0.1:3131").pathname;
  if (pathname === "/" || (demo==="portal"||withDatabaseEntry||withEmployeeLocation||withCorrectionFlow||withLeaveShell)&&["/enterprise","/enterprise/99990001"].includes(pathname) || withDatabaseEntry&&pathname==="/owner" || withMerchantShell&&["/99990001","/login"].includes(pathname) || withTerminalShell&&["/enterprise/attendance-terminal","/enterprise/attendance-terminal/onsite","/enterprise/attendance-scan"].includes(pathname) || withPinShell&&["/enterprise/attendance-terminal","/enterprise/attendance-terminal/clock"].includes(pathname) || withEventChannelsShell&&["/enterprise","/enterprise/99990001","/enterprise/99990002"].includes(pathname)) return response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Faolla 考勤隔离验收</title><link rel="stylesheet" href="/harness.css"><div id="qa-root"></div><script type="module" src="/harness.js"></script></html>');
  if (pathname === "/harness.js") return response.writeHead(200, { "Content-Type": "text/javascript" }).end(bundle.outputFiles[0].contents);
  if (pathname === "/harness.css") return response.writeHead(200, { "Content-Type": "text/css" }).end(css);
  return response.writeHead(403).end();
});
server.listen(3131, "127.0.0.1", () => console.log("Attendance synthetic component QA http://127.0.0.1:3131 ; no production network, data or credentials; in-memory bundle only"));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.close(() => process.exit(0)));
