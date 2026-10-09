import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
test("attendance entry is lazy, employee permission gated and independent of task bootstrap", () => {
  const source = read("src/components/admin/MerchantEnterpriseManager.tsx");
  assert.match(source, /dynamic\(\(\) => import\("@\/components\/enterprise\/MerchantAttendanceSelfPanel"\)/);
  assert.match(source, /key: "attendance", label: "我的考勤", permission: "attendance.self.view"/);
  assert.equal((source.match(/item\.key !== "attendance" \|\| actor\.type === "employee"/g) ?? []).length, 2);
  assert.match(source, /requestedView !== "attendance" \|\| actor.type === "employee"/);
  assert.match(source, /\{tab === "attendance" && actor.type === "employee" \? \(/);
  assert.match(source, /needsBootstrap && tab !== "attendance"/);
});
test("UI does not poll, fabricate time, store tokens or auto-submit restored intent", () => {
  const panel = read("src/components/enterprise/MerchantAttendanceSelfPanel.tsx");
  const client = read("src/lib/merchantAttendanceSelfClient.ts");
  assert.doesNotMatch(panel, /setInterval|geolocation|localStorage|accessToken/);
  assert.match(panel, /window.sessionStorage/);
  assert.match(panel, /event\.occurredAt/);
  assert.match(client, /this\.persist\(pending\); this\.set\(\{ pending, confirmed: null \}\)/);
  assert.match(client, /result\.state\.sequence > pending\.command\.expectedSequence/);
});
test("browser QA is loopback-only, in-memory and rejects outbound connections and HTTP writes", () => {
  const harness = read("scripts/attendance-self-browser-harness.mjs");
  assert.match(harness, /server.listen\(3131, "127\.0\.0\.1"/);
  assert(harness.includes("connect-src ${withEnterpriseShell?\"'self'\":\"'none'\"}"));
  assert(harness.includes("withEnterpriseShell=demo==='portal'||demo==='owner-entry'"));
  assert.match(harness, /write: false/);
  assert.match(harness, /request\.method !== "GET"/);
  assert.doesNotMatch(harness, /dotenv|DATABASE_URL|writeFile/);
  assert(harness.includes('"process.env":\'{}\''));
  assert.match(harness, /const portalDefines=withEnterpriseShell\?\{[^\n]+\}:\{"process\.env":'\{\}'\};/);
  assert(harness.includes('"process.env.NEXT_PUBLIC_SUPABASE_URL":\'"http://127.0.0.1:3131"\''));
  assert(harness.includes('"process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY":\'"attendance-synthetic-anon"\''));
});
test("both attendance screens expose paused status and gate fresh writes without hiding recovery",()=>{
  const admin=read("src/components/enterprise/MerchantAttendanceAdminPanel.tsx");
  const self=read("src/components/enterprise/MerchantAttendanceSelfPanel.tsx");
  assert.match(admin,/!state.result\?\.moduleEnabled/);
  assert.match(admin,/if \(confirmed\) \{ setEditor\(null\)/);
  assert.match(admin,/const confirmed = await client.submit/);
  assert.match(admin,/原编号重试保存/);
  assert.match(self,/attendanceActionAllowed\(state.result.moduleEnabled, action\)/);
  assert.match(self,/暂停新考勤/);
});
test("scope and records UI are lazy, independently routed and do not need task bootstrap",()=>{
  const manager=read("src/components/admin/MerchantEnterpriseManager.tsx");
  assert.match(manager,/dynamic\(\(\) => import\("@\/components\/enterprise\/MerchantAttendanceScopePanel"\)/);
  assert.match(manager,/dynamic\(\(\) => import\("@\/components\/enterprise\/MerchantAttendanceRecordsPanel"\)/);
  assert.equal((manager.match(/item\.key !== "attendanceScopes" \|\| actor\.type === "owner"/g)||[]).length,2);
  assert.match(manager,/key: "attendanceRecords", label: "考勤明细", permission: "attendance.records.view"/);
  assert.match(manager,/needsBootstrap && tab !== "attendance" && tab !== "attendanceAdmin" && tab !== "attendanceScopes" && tab !== "attendanceRecords"/);
});
test("records UI has no global candidates, polls, persisted rows or fabricated durations",()=>{
  const panel=read("src/components/enterprise/MerchantAttendanceRecordsPanel.tsx");
  assert.doesNotMatch(panel,/\/choices|setInterval|sessionStorage|localStorage|geolocation/);
  assert.match(panel,/visibilityState === "hidden"/);assert.match(panel,/client.invalidate\(\)/);
  assert.match(panel,/key=\{`\$\{props.siteId\}:\$\{props.access\}:\$\{props.actorId\}`\}/);
  assert.match(panel,/不推算缺卡、工资或应出勤时数/);
});
test("selected scope names are isolated per edit and cannot enter authorization command payloads",()=>{
  const panel=read("src/components/enterprise/MerchantAttendanceScopePanel.tsx");
  const labels=read("src/lib/merchantAttendanceChoiceLabelsClient.ts");
  assert.match(panel,/SelectedChoices key=\{`\$\{siteId\}:\$\{state.employeeId\}:\$\{draft.id\}:\$\{draft.revision\}`\}/);
  assert.match(panel,/grant: \{ workerIds, locationIds, validFrom, validUntil \}/);
  assert.doesNotMatch(labels,/setInterval|sessionStorage|localStorage|method: "POST"/);
  assert.match(labels,/offset \+= 25/);assert.match(labels,/this.cache.clear\(\)/);
  assert.match(panel,/刷新已选名称/);
});

test("self history is lazy, isolated by employee and has no directories, polling or stored rows",()=>{
  const self=read("src/components/enterprise/MerchantAttendanceSelfPanel.tsx");
  const panel=read("src/components/enterprise/MerchantAttendanceHistoryPanel.tsx");
  const client=read("src/lib/merchantAttendanceHistoryClient.ts");
  assert.match(self,/lazy\(\(\) => import\("\.\/MerchantAttendanceHistoryPanel"\)\)/);
  assert.match(self,/historyOpen && <Suspense/);
  assert.match(panel,/key=\{`\$\{props.siteId\}:\$\{props.employeeId\}`\}/);
  assert.match(panel,/visibilityState==="hidden"\)client.invalidate\(\)/);
  assert.doesNotMatch(panel+client,/\/choices|sessionStorage|localStorage|setInterval|geolocation|method: ?"POST"/);
  assert.match(client,/result.employeeId!==this.options.employeeId/);
  assert.match(client,/expectedWorkerId:result.workerId/);
});
