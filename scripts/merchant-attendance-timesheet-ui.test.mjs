import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
const read=p=>readFileSync(new URL(`../${p}`,import.meta.url),"utf8");
const admin=read("src/components/enterprise/MerchantAttendanceAdminPanel.tsx"),panel=read("src/components/enterprise/MerchantAttendanceTimesheetPanel.tsx"),client=read("src/lib/merchantAttendanceTimesheetClient.ts");
test("timesheet owner entry is lazy, default-off and does not alter mutation forms",()=>{
  assert.match(admin,/NEXT_PUBLIC_FAOLLA_ATTENDANCE_TIMESHEET_ENABLED === "1"/);assert.match(admin,/lazy\(\(\) => import\("\.\/MerchantAttendanceTimesheetPanel"\)\)/);assert.match(admin,/timesheetEnabled && timesheetOpen/);assert.match(admin,/<TimesheetPanel key=\{`period-context:\$\{siteId\}:\$\{ownerId\}:\$\{state.authorizationEpoch\}`\} siteId=\{siteId\} ownerId=\{ownerId\}/);
  assert.match(panel,/key=\{`\$\{props.siteId\}:\$\{props.ownerId\}`\}/);assert.doesNotMatch(panel+client,/method:\s*["']POST|sessionStorage|localStorage|setInterval|navigator\.geolocation|dangerouslySetInnerHTML/);
});
test("timesheet UI handles pagehide/bfcache and displays uncertainty, provenance and accurate units",()=>{
  for(const s of ["visibilitychange","pagehide","pageshow","e.persisted","client.invalidate()","未结束班次不估算时长","不代表缺勤","批准申请","微秒"]){if(s==="微秒")assert.match(read("src/lib/merchantAttendanceTimesheetResponse.ts"),/BigInt/);else assert(panel.includes(s),s);}
  assert.match(panel,/formatAttendanceTimesheetDuration/);assert.match(panel,/r\.openSessionCount/);assert.match(panel,/r\.periodInProgress/);assert.match(panel,/r\.skippedDates/);
});
