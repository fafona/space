import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const launcher=read('src/components/enterprise/MerchantAttendanceOwnerBacklogLauncher.tsx');
const panel=read('src/components/enterprise/MerchantAttendanceOwnerBacklogPanel.tsx');
const client=read('src/lib/merchantAttendanceOwnerBacklogClient.ts');

test('owner backlog launcher remains lazy/default-off, controlled or standalone and isolated from hidden approval workspaces',()=>{
  assert.match(launcher,/NEXT_PUBLIC_FAOLLA_ATTENDANCE_OWNER_BACKLOG_ENABLED === "1"/);
  assert.match(launcher,/if \(!enabled \|\| !active\) return null/);
  assert.match(launcher,/lazy\(\(\) => import\("\.\/MerchantAttendanceOwnerBacklogPanel"\)\)/);
  assert.match(launcher,/key=\{`\$\{props\.siteId\}:\$\{props\.ownerId\}`\}/);
  const admin=read('src/components/enterprise/MerchantAttendanceAdminPanel.tsx');
  const entry=admin.slice(admin.indexOf('<OwnerBacklogLauncher'),admin.indexOf('<ScheduleOverviewLauncher'));
  assert.match(entry,/active=\{!missingOpen && !exceptionOpen && !correctionReviewOpen && !correctionControlsOpen && !revisionApprovalOpen && !\(timesheetEnabled && timesheetOpen\)\}/);
  assert.match(entry,/open=\{backlogOpen\} onOpenChange=\{setBacklogOpen\}/);
  assert.match(launcher,/controlledOpen \?\? localOpen/);
  assert.doesNotMatch(launcher,/state\.result|pending|canApprove|client\.initialize/);
});

test('only explicit bounded GETs; hide/pagehide/unmount and close abort, clear and never auto-query or touch operation storage',()=>{
  const effect=panel.slice(panel.indexOf('useEffect(() =>'),panel.indexOf('return <section'));
  for(const event of ['visibilitychange','pagehide'])assert(effect.includes(event));
  assert.match(effect,/return \(\) => \{ hide\(\)/);assert.doesNotMatch(effect,/client\.(?:begin|next)\(/);
  assert.match(client,/this\.generation\+\+; this\.controller\?\.abort\(\)/);
  assert.match(client,/result\.ownerId !== this\.identity\.ownerId/);
  assert.match(client,/timeoutMs: this\.options\.timeoutMs \?\? 12000, maxBytes: 131072/);
  assert.match(panel,/onChange=\{event => \{ client\.pause\(\); setKind/);
  assert.match(panel,/client\.pause\(\); onClose\(\)/);
  assert.match(panel,/disabled=\{busy \|\| !result\?\.nextCursor\}/);
  assert.doesNotMatch(launcher+panel+client,/localStorage|sessionStorage|setInterval|geolocation|method:\s*["'](?:POST|PATCH|PUT|DELETE)|sendBeacon|ApprovalClient|DecisionClient|onRequestCorrection/);
  assert.match(panel,/ownerBacklogTarget\(client\.getSnapshot\(\), item, navigation\)/);
  assert.match(panel,/if \(target && onSelect\(target\)\) client\.pause\(\)/);
});

test('readonly oldest-first queue distinguishes empty intermediate pages, non-total candidate counts and non-authorizing pending state',()=>{
  for(const copy of ['仍有下一页','已到末页'])assert(client.includes(copy));
  for(const copy of ['跨全部提交时间','最旧申请优先','待审不等于当前可批准','不是积压总数','不导航审批','不是历史身份快照','只保留当前页','同一状态截点'])assert(panel.includes(copy));
  assert.match(panel,/key=\{`\$\{item\.kind\}:\$\{item\.requestId\}`\}/);
  assert.match(panel,/item\.requestId/);assert.match(panel,/result\.asOf/);assert.match(panel,/result\.scanned/);
  assert.doesNotMatch(panel,/dangerouslySetInnerHTML|type="date"|href=|canApprove|reason|evidenceToken/);
});
