import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const launcher=read('src/components/enterprise/MerchantAttendanceScheduleOverviewLauncher.tsx');
const panel=read('src/components/enterprise/MerchantAttendanceScheduleOverviewPanel.tsx');
const admin=read('src/components/enterprise/MerchantAttendanceAdminPanel.tsx');

test('overview launcher is lazy, owner/site keyed, default-off and parent-hidden workspaces unmount it',()=>{
  assert.match(launcher,/NEXT_PUBLIC_FAOLLA_ATTENDANCE_SCHEDULE_OVERVIEW_ENABLED === "1"/);
  assert.match(launcher,/if \(!enabled \|\| !active\) return null/);
  assert.match(launcher,/lazy\(\(\) => import\("\.\/MerchantAttendanceScheduleOverviewPanel"\)\)/);
  assert.match(launcher,/key=\{`\$\{props\.siteId\}:\$\{props\.ownerId\}`\}/);
  assert.match(launcher,/>多人排班总览（只读）<\/button>/);
  assert.match(admin,/import ScheduleOverviewLauncher from "\.\/MerchantAttendanceScheduleOverviewLauncher"/);
  const active='active={!missingOpen && !exceptionOpen && !correctionReviewOpen && !correctionControlsOpen && !revisionApprovalOpen && !(timesheetEnabled && timesheetOpen)}';
  assert(admin.includes(`<ScheduleOverviewLauncher siteId={siteId} ownerId={ownerId} apiFetch={apiFetch} ${active}/>`));
  assert.doesNotMatch(launcher,/AttendanceScheduleOverviewClient|client\.|begin\(|fetch\(/);
});

test('opening is inert; hidden, pagehide, close and unmount abort both bounded readers and clear results',()=>{
  const effect=panel.slice(panel.indexOf('useEffect(() =>'),panel.indexOf('const readWorkers'));
  for(const event of ['visibilitychange','pagehide'])assert(effect.includes(event));
  assert.match(effect,/picker\.generation\+\+; picker\.controller\?\.abort\(\)/);
  assert.match(effect,/setWorkers\(\[\]\); setWorkerCursor\(null\); setSelected\(\[\]\); setSearch\(""\); client\.pause\(\)/);
  assert.doesNotMatch(effect,/client\.(?:begin|next)\(|readWorkers\(/);
  assert.match(panel,/const close = \(\) => \{ stopPicker\(true\); client\.pause\(\); onClose\(\); \}/);
  assert.match(panel,/timeoutMs: 12000, maxBytes: 131072/);
  assert.match(panel,/if \(document\.hidden\) \{ stopPicker\(true\); setSelected\(\[\]\); setSearch\(""\); client\.pause\(\); return; \}/);
  assert.match(panel,/if \(state\.phase !== "blocked"\) return;[\s\S]*setWorkers\(\[\]\); setWorkerCursor\(null\); setSelected\(\[\]\); setSearch\(""\)/);
  assert.match(panel,/catch \{[\s\S]*setSelected\(\[\]\); client\.pause\(\)/);
  assert.doesNotMatch(panel+launcher,/setInterval|localStorage|sessionStorage|sendBeacon|geolocation/);
});

test('worker discovery is explicit bounded admin GET, keeps inactive workers selectable and caps current identities at twenty',()=>{
  assert.match(panel,/attendanceManagementRequest\(apiFetch, `\/api\/merchant-enterprise\/attendance\/admin\?\$\{params\}`/);
  assert.match(panel,/\{ siteId, view: "workers", search \}/);
  assert.match(panel,/parseAttendanceAdminResult\(raw, \{ siteId, view: "workers", operationId: null \}\)/);
  assert.match(panel,/onClick=\{\(\) => void readWorkers\(null\)\}>搜索考勤人员/);
  assert.match(panel,/onClick=\{\(\) => void readWorkers\(workerCursor\)\}>下一页人员/);
  assert.match(panel,/selected\.length >= 20/);
  assert.match(panel,/停用（仍可核对历史）/);
  assert.match(panel,/aria-label=\{label\}/);
  const checkbox=panel.slice(panel.indexOf('aria-label={label}'),panel.indexOf('/><span><span className="font-semibold">{label}'));
  assert.doesNotMatch(checkbox,/worker\.active/);
  assert.match(panel,/selected\.map\(worker => worker\.id\)\.sort\(\)/);
});

test('every query filter edit clears the overview and only the explicit valid query can begin',()=>{
  assert.match(panel,/const changeSearch = \(value: string\) => \{ stopPicker\(true\); client\.pause\(\)/);
  assert.match(panel,/const toggleWorker = \(worker: AttendanceAdminWorker\) => \{\s*client\.pause\(\)/);
  assert.match(panel,/const changeDate = [\s\S]*client\.pause\(\)/);
  const dates=panel.slice(panel.indexOf('aria-label="总览开始日期"'),panel.indexOf('onClick={begin}>查询排班总览'));
  assert.doesNotMatch(dates,/disabled=\{busy\}/);
  assert.match(panel,/days >= 0 && days <= 30/);
  assert.match(panel,/client\.begin\(\{ workerIds: selected\.map\(worker => worker\.id\)\.sort\(\), fromDate, throughDate \}\)/);
  for(const label of ['总览人员搜索','搜索考勤人员','下一页人员','总览开始日期','总览结束日期','查询排班总览','下一页安排','关闭排班总览'])assert(panel.includes(label));
  assert.doesNotMatch(panel,/<form\b|onSubmit=|type="submit"|method:\s*"POST"/);
});

test('rows retain cancellations and distinguish local historical labels from current picker labels without totals or absence claims',()=>{
  for(const field of ['item.id','item.workerId','item.workerName','item.locationId','item.locationName','item.timeZone','item.workDate','item.startAt','item.endAt','item.revision','item.cancelled','item.cancelRevision'])assert(panel.includes(field));
  for(const copy of ['当前考勤档案','排班历史员工标签','排班历史地点标签','工作日（地点本地）','地点本地时段','已取消（保留历史行）','不是排班总数','不表示员工缺勤','两者可能不同'])assert(panel.includes(copy));
  assert.match(panel,/localStamp\(item\.startAt, item\.timeZone\)/);
  assert.match(panel,/localStamp\(item\.endAt, item\.timeZone\)/);
  assert.match(panel,/本页扫描 \{result\.scanned\} 条候选/);
  assert.match(panel,/!result\.moduleEnabled/);
  assert.match(panel,/不把跨地点日期范围当成一个 UTC 日/);
  assert.doesNotMatch(panel,/总计[^。<]*条|缺勤人数|未排班人数|完整排班总数/);
});
