import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const parent=read('src/components/enterprise/MerchantAttendanceCorrectionWorkspace.tsx'),panel=read('src/components/enterprise/MerchantAttendanceRevisionWorkspace.tsx'),client=read('src/lib/merchantAttendanceRevisionCycleClient.ts');
test('employee entry is opt-in lazy and pauses its parent; recovery is separate from ordinary clock-out',()=>{
  for(const marker of ['NEXT_PUBLIC_FAOLLA_ATTENDANCE_REVISION_CYCLES_ENABLED==="1"','lazy(() => import("./MerchantAttendanceRevisionWorkspace"))','if(revisionTarget!==undefined || windowTarget)return;','恢复待确认修订','r.item.decision?.action==="approve"'])assert(parent.includes(marker),marker);
  assert(!read('src/components/enterprise/MerchantAttendanceSelfPanel.tsx').includes('revisionCycleKey'));
});
test('employee form displays current basis and historical outcome separately and keeps explicit confirmation',()=>{
  for(const marker of ['原始打卡 · 保留不变','当前有效核定','提交时的核定基准','本次批准结果 · 历史保留','current.proposal','setAck(false)','明确提交修订申请','明确撤回修订','data-revision-dirty','beforeunload','document.visibilityState','window.confirm','不采集定位'])assert(panel.includes(marker),marker);
  for(const s of [panel,parent]){assert(s.includes('correctionTimeControlValue(value.local)'));assert(s.includes('step="0.001"'));assert(!s.includes('step="0.000001"'));}
  assert(!/navigator.geolocation|setInterval|localStorage|dangerouslySetInnerHTML/.test(panel+client));
});
test('uncertain revision retry reads first and keeps full root/predecessor command; no automatic resubmission on entry',()=>{
  const initialize=client.slice(client.indexOf('initialize=async'),client.indexOf('private canNavigate'));
  assert(!initialize.includes('"POST"'));assert(initialize.includes('pending?.query'));assert(client.includes('expectedEffectiveOperationId:r.current.operationId'));
  assert(client.includes('expectedBaseOperationId:r.current.lineage.rootOperationId'));assert(client.includes('JSON.stringify(parseRevisionCycleCommand(result.receipt.command))!==JSON.stringify(p.command)'));
  assert(client.includes('const outcome=await this.run(this.state.pending.query,null,false)'));assert(client.includes('e.message!=="attendance_operation_conflict"'));assert(client.includes('this.checkStorage()'));
});
test('new browser verification is isolated loopback and produces no persistent artifacts or external requests',()=>{
  const s=read('scripts/merchant-attendance-revision-cycle-browser-check.mjs');
  for(const marker of ['chromium.launch({headless:true})',"new URL(route.request().url()).origin!==origin",'finally{await context.close();}','await browser?.close()','child.kill()'])assert(s.includes(marker),marker);
  assert(!/launchPersistentContext|storageState|process.env|\.env|tracing.start|recordVideo/.test(s));
});
