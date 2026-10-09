// Actual outer enterprise navigation, never a simulated component callback.
// These two scenarios edit ONLY unsent drafts and must issue no POST at all.
import assert from 'node:assert/strict';

const path=name=>'/api/merchant-enterprise/attendance/'+name;
function read(page,name,query) {
  return page.waitForResponse(response=>{
    const url=new URL(response.url());return url.pathname===path(name)&&response.request().method()==='GET'&&response.status()===200
      &&Object.entries(query).every(([key,value])=>url.searchParams.get(key)===value);
  });
}
async function payload(reply) {const value=await(await reply).json();assert.equal(value.ok,true);return value;}
function noPost(requests,from) {assert.equal(requests.slice(from).filter(request=>request.method==='POST').length,0,'correction_draft_navigation_must_not_post');}
function retainedDialog(message) {assert.match(message,/未保存|未提交/);assert.match(message,/放弃|丢弃|清除/);}

export async function checkCorrectionSelfDraftLeave({employee,prepared,requests,pass,control}) {
  assert.equal(prepared.mode,'prepare');assert.equal(prepared.canRequest,true);assert.equal(prepared.pendingRequestId,null);
  const original=structuredClone(prepared.basis.events),start=original[0];assert.equal(start.action,'clock_in');
  const panel=()=>employee.getByRole('region',{name:'本人考勤补正申请',exact:true});
  const own=()=>employee.getByRole('region',{name:'我的考勤',exact:true});
  const navigation=()=>employee.getByRole('navigation',{name:'企业管理功能',exact:true});
  const reason=()=>panel().getByRole('textbox',{name:/^申请理由/});
  const ack=()=>panel().getByRole('checkbox',{name:/^我已核对全部时间与休息/});
  const pendingKey=`faolla:attendance:correction:v1:${prepared.siteId}:${prepared.employeeId}`;
  const noPending=async()=>assert.equal(await employee.evaluate(key=>sessionStorage.getItem(key),pendingKey),null);
  const from=requests.length,priorDialogs=control.acceptDialogs,dialogs=[],observe=dialog=>dialogs.push(dialog.message());
  employee.on('dialog',observe);
  try {
    await reason().waitFor();assert.equal(await reason().inputValue(),'');assert.equal(await ack().isChecked(),false);await noPending();
    const draft='合成外层导航草稿：取消保留，确认离开不提交';await reason().fill(draft);await ack().check();
    assert.equal(await panel().getByRole('button',{name:'明确提交补正申请',exact:true}).isDisabled(),false);
    const originalControls=await panel().locator('input[type="datetime-local"]').evaluateAll(inputs=>inputs.map(input=>input.value));

    control.acceptDialogs=false;await navigation().getByRole('button',{name:'工作台',exact:true}).click();
    assert.equal(dialogs.length,1);retainedDialog(dialogs[0]);await panel().waitFor();assert.equal(await reason().inputValue(),draft);assert.equal(await ack().isChecked(),true);
    assert.deepEqual(await panel().locator('input[type="datetime-local"]').evaluateAll(inputs=>inputs.map(input=>input.value)),originalControls);await noPending();noPost(requests,from);

    control.acceptDialogs=true;await navigation().getByRole('button',{name:'工作台',exact:true}).click();await panel().waitFor({state:'detached'});
    assert.equal(dialogs.length,2);retainedDialog(dialogs[1]);await noPending();noPost(requests,from);
    // Reconstruct through the real outer/inner entry and original-history
    // choice. The caller's in-panel reprepare shortcut cannot prove remount.
    await navigation().getByRole('button',{name:'我的考勤',exact:true}).click();
    const listing=read(employee,'corrections',{siteId:prepared.siteId,mode:'list',expectedWorkerId:prepared.workerId});
    await own().getByRole('button',{name:'我的补正申请／核对结果',exact:true}).click();const list=await payload(listing);
    assert.equal(list.mode,'list');assert.equal(list.employeeId,prepared.employeeId);assert.equal(list.workerId,prepared.workerId);
    await panel().getByRole('button',{name:'选择原始班次',exact:true}).click();const history=employee.getByRole('region',{name:'本人历史打卡',exact:true});
    const day=start.occurredAt.slice(0,10);await history.getByLabel('开始日期',{exact:true}).fill(day);await history.getByLabel('结束日期（含当天）',{exact:true}).fill(day);await history.getByLabel('查询／显示时区',{exact:true}).fill('UTC');
    const reading=read(employee,'history',{siteId:prepared.siteId});await history.getByRole('button',{name:'查询本人记录',exact:true}).click();const records=await payload(reading);
    assert.equal(records.workerId,prepared.workerId);const index=records.items.findIndex(item=>item.id===start.id);assert(index>=0,'correction_navigation_original_start_missing');assert.equal(records.items[index].action,'clock_in');
    const preparation=read(employee,'corrections',{siteId:prepared.siteId,mode:'prepare',expectedWorkerId:prepared.workerId,startEventId:start.id});
    await history.locator('article').nth(index).getByRole('button',{name:'选择本班次申请补正',exact:true}).click();const restored=await payload(preparation);
    assert.equal(restored.mode,'prepare');assert.equal(restored.employeeId,prepared.employeeId);assert.equal(restored.workerId,prepared.workerId);assert.equal(restored.revision,prepared.revision);assert.equal(restored.pendingRequestId,null);assert.equal(restored.canRequest,true);assert.deepEqual(restored.basis.events,original);
    await panel().locator('form[data-correction-dirty="false"]').waitFor();assert.equal(await reason().inputValue(),'');assert.equal(await ack().isChecked(),false);
    assert.equal(await panel().getByRole('button',{name:'明确提交补正申请',exact:true}).isDisabled(),true);
    assert.deepEqual(await panel().locator('input[type="datetime-local"]').evaluateAll(inputs=>inputs.map(input=>input.value)),originalControls);
    assert.equal(dialogs.length,2);await noPending();noPost(requests,from);assert(await employee.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    pass('real employee outer enterprise navigation: cancel keeps unsent correction reason/ack/times; accept unmounts the workspace, then My Attendance/history reselects the exact original clock-in into a clean draft, with no POST or pending operation');
    return restored;
  } finally {control.acceptDialogs=priorDialogs;employee.off('dialog',observe);}
}

export async function checkCorrectionOwnerDraftLeave({owner,requestId,ownerTarget,admin,requests,pass,control}) {
  const panel=()=>owner.getByRole('region',{name:'负责人补正审批',exact:true});
  const choice=()=>panel().getByRole('combobox',{name:'选择决定',exact:true});
  const reason=()=>panel().getByRole('textbox',{name:/^决定理由/});
  const ack=()=>panel().getByRole('checkbox',{name:/^我已核对申请人/});
  const from=requests.length,priorDialogs=control.acceptDialogs,dialogs=[],observe=dialog=>dialogs.push(dialog.message());
  owner.on('dialog',observe);
  try {
    const current=await ownerTarget(requestId);assert.equal(current.review.item.requestId,requestId);assert.equal(current.decision,null);assert.equal(current.canApprove,true);
    assert.equal(await choice().inputValue(),'');assert.equal(await reason().inputValue(),'');assert.equal(await ack().isChecked(),false);
    const draft='合成审批导航草稿：未提交决定，离开后必须重新选择';await choice().selectOption('approve');await reason().fill(draft);await ack().check();
    assert.equal(await panel().getByRole('button',{name:'确认批准',exact:true}).isDisabled(),false);
    const beforeDialogs=dialogs.length;control.acceptDialogs=false;await owner.getByRole('button',{name:'主管考勤范围',exact:true}).click();
    assert.equal(dialogs.length,beforeDialogs+1);retainedDialog(dialogs.at(-1));await panel().waitFor();assert.equal(await choice().inputValue(),'approve');assert.equal(await reason().inputValue(),draft);assert.equal(await ack().isChecked(),true);noPost(requests,from);

    control.acceptDialogs=true;await owner.getByRole('button',{name:'主管考勤范围',exact:true}).click();await panel().waitFor({state:'detached'});
    await owner.getByRole('region',{name:'主管考勤范围',exact:true}).waitFor();assert.equal(dialogs.length,beforeDialogs+2);retainedDialog(dialogs.at(-1));noPost(requests,from);
    await owner.getByRole('button',{name:'考勤配置',exact:true}).click();await admin(owner).getByRole('button',{name:'补正申请核对（只读）',exact:true}).waitFor();
    // The existing generic Manager guard also warns when leaving the scope
    // panel. This is separate from the two draft-leave attempts above; do not
    // claim the current implementation only warns for genuinely dirty forms.
    assert.equal(dialogs.length,beforeDialogs+3);retainedDialog(dialogs.at(-1));
    const restored=await ownerTarget(requestId);assert.equal(restored.review.item.requestId,requestId);assert.equal(restored.review.item.revision,current.review.item.revision);assert.equal(restored.decision,null);
    assert.deepEqual(restored.review.application.proposal,current.review.application.proposal);assert.deepEqual(restored.review.application.basis.events,current.review.application.basis.events);
    assert.equal(await choice().inputValue(),'');assert.equal(await reason().inputValue(),'');assert.equal(await ack().isChecked(),false);assert.equal(await panel().getByRole('button',{name:'请选择决定',exact:true}).isDisabled(),true);
    assert.equal(dialogs.length,beforeDialogs+3);noPost(requests,from);
    pass('real owner outer navigation: cancel preserves unsent approval choice/reason/ack, accept discards only that draft; reopening the same immutable request requires a fresh empty choice and confirmation, with no decision or other POST');
    return restored;
  } finally {control.acceptDialogs=priorDialogs;owner.off('dialog',observe);}
}
