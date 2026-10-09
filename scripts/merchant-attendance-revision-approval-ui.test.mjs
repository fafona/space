import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8'),ui=read('src/components/enterprise/MerchantAttendanceRevisionApprovalPanel.tsx');
test('continuous owner approval is lazy and separately default-off in real attendance admin',()=>{
  const s=read('src/components/enterprise/MerchantAttendanceAdminPanel.tsx');assert(s.includes('lazy(() => import("./MerchantAttendanceRevisionApprovalPanel"))'));
  assert(s.includes('NEXT_PUBLIC_FAOLLA_ATTENDANCE_REVISION_DECISIONS_ENABLED'));assert(s.includes('连续修订审批／恢复'));assert(s.includes('revisionApprovalEnabled &&'));
});
test('owner UI differentiates immutable raw, captured source, proposed statement, own decision and latest source',()=>{
  for(const t of ['原始打卡','提交时核定','本次员工声明','本次审批结果','当前有效核定','r.current.revision','b.revision+1','后续批准替换','待办列表候选入口尚未开放'])assert(ui.includes(t),t);
  assert(ui.includes('r.decision?'));assert(ui.includes('r.canApprove'));assert(ui.includes('r.canReject'));assert(!ui.includes('r.review.checksPassed'));
});
test('explicit reason and acknowledgement reset, leave/hidden protection and no background approvals',()=>{
  for(const t of ['setAck(false)','!permitted||!valid||!ack','visibilitychange','beforeunload','client.pause()','client.initialize()','window.confirm'])assert(ui.includes(t),t);
  assert(!/setInterval|navigator.geolocation|localStorage/.test(ui));assert(ui.includes('grid min-w-0 gap-3 md:grid-cols-2'));
});
test('outer revision leave guard shares close confirmation and preserves pending on either answer',()=>{
  const guard=ui.slice(ui.indexOf('const leavePanel='),ui.indexOf('const navigate='));
  assert.match(ui,/registerLeaveGuard\?:\(guard:\(\(\)=>boolean\)\|null\)=>void/);
  assert.match(guard,/if\(\(dirty\|\|client.hasLeaveRisk\(\)\)&&!window.confirm\([^\n]+\)\)return false/);
  assert.match(guard,/client.pause\(\);return true/);
  assert.match(guard,/registerLeaveGuard\?\.\(leavePanel\);return\(\)=>registerLeaveGuard\?\.\(null\)/);
  assert.match(ui,/if\(leavePanel\(\)\)onClose\(\)/);
  assert.doesNotMatch(guard,/setDirty|removeItem|initialize|submit|retry/);
});
