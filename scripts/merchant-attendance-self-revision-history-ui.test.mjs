import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const launcher=read('src/components/enterprise/MerchantAttendanceSelfRevisionHistoryLauncher.tsx');
const panel=read('src/components/enterprise/MerchantAttendanceSelfRevisionHistoryPanel.tsx');
const client=read('src/lib/merchantAttendanceSelfRevisionHistoryClient.ts');

test('new standalone launcher is default-off and independently resolves identity without requiring successful current clock state',()=>{
  assert.match(launcher,/NEXT_PUBLIC_FAOLLA_ATTENDANCE_SELF_REVISION_HISTORY_ENABLED === "1"/);
  assert.match(launcher,/if \(!enabled\) return null/);assert.match(launcher,/lazy\(\(\) => import\("\.\/MerchantAttendanceSelfRevisionHistoryPanel"\)\)/);
  assert.match(launcher,/key=\{`\$\{props\.siteId\}:\$\{props\.employeeId\}`\}/);
  assert.doesNotMatch(launcher,/workerId|canClock|state\.result/);
  assert.match(read('src/components/enterprise/MerchantAttendanceSelfPanel.tsx'),/<SelfRevisionHistoryLauncher siteId=\{siteId\} employeeId=\{employeeId\} apiFetch=\{apiFetch\}\/>/);
  assert.match(client,/corrections\/context\?siteId=/);assert.match(client,/context\.employeeId !== this\.identity\.employeeId/);
  assert.match(client,/expectedWorkerId: context\.workerId/);
});

test('explicit reads only; hide, pagehide and unmount abort and clear without resuming queries or touching existing pending state',()=>{
  const effect=panel.slice(panel.indexOf('useEffect(() =>'),panel.indexOf('return <section'));
  for(const event of ['visibilitychange','pagehide'])assert(effect.includes(event));
  assert.match(effect,/return \(\) => \{ hide\(\)/);assert.doesNotMatch(effect,/client\.(?:begin|next)\(/);
  assert.match(client,/this\.generation\+\+; this\.controller\?\.abort\(\)/);
  assert.match(client,/result\.employeeId !== this\.identity\.employeeId/);
  assert.match(client,/this\.options\.timeoutMs \?\? 12000\) - \(performance\.now\(\) - started\)/);
  assert.match(client,/timeoutMs: remaining\(\), maxBytes: 2048/);assert.match(client,/timeoutMs: remaining\(\), maxBytes: 131072/);
  assert.match(panel,/onChange=\{event => \{ client\.pause\(\); setStatus/);
  assert.match(panel,/disabled=\{busy \|\| !result\?\.nextCursor\}/);
  assert.doesNotMatch(launcher+panel+client,/localStorage|sessionStorage|setInterval|geolocation|method:\s*["'](?:POST|PATCH|PUT|DELETE)|sendBeacon|AttendanceRevisionCycleClient|onSelect|onRequestCorrection/);
});

test('list distinguishes empty intermediate pages, snapshot status and exact root/request IDs without claiming complete pending recovery or payroll',()=>{
  for(const copy of ['仍有下一页','已到末页'])assert(client.includes(copy));
  for(const copy of ['不包括首次补正、整段漏卡及浏览器待确认操作','不是全部考勤申请或工资记录','不是待审总数','只保留当前页','同一状态截点','不提交、撤回、审批或恢复未知操作'])assert(panel.includes(copy));
  assert.match(panel,/item\.rootRequestId/);assert.match(panel,/item\.requestId/);assert.match(panel,/result\.asOf/);assert.match(panel,/result\.scanned/);
  assert.doesNotMatch(panel,/dangerouslySetInnerHTML|查看修订详情|明确提交|明确撤回/);
});
