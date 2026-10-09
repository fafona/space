// Actual outer enterprise navigation + existing isolated handler/SQL pipeline.
// This tests the Manager's generic confirmation, not a new dirty-only guard.
import assert from 'node:assert/strict';

async function settle(page) {
  await page.evaluate(()=>new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('controls_navigation_task_timeout')),5000);
    requestAnimationFrame(()=>requestAnimationFrame(()=>{clearTimeout(timer);resolve();}));
  }));
}

export async function checkControlsNavigationShell({owner,phone,admin,transport,requests,pass,site,control,holdControlsResponse,
  endpoint,panel,ledger,periods,writes,rpcCalls,pending,unchanged,protectedFacts,open,reload,policy,lock,atRevision,preservePrior}) {
  assert.equal(site,'99990001');
  const wasEnabled=transport.state.moduleEnabled,priorDialogs=control.acceptDialogs;
  const before={ledger:ledger(),periods:periods(),facts:unchanged(),protected:protectedFacts(),posts:writes().length};
  assert.equal(before.ledger.length,8);assert.equal(before.posts,14);
  const keep=()=>{assert.equal(unchanged(),before.facts);assert.equal(protectedFacts(),before.protected);assert.deepEqual(periods(),before.periods);preservePrior(before.ledger,ledger());};
  const dialogs=new Map([[owner,[]],[phone,[]]]),observers=new Map();
  for(const page of [owner,phone]){const observer=dialog=>dialogs.get(page).push(dialog.message());observers.set(page,observer);page.on('dialog',observer);}
  const generic=(page,previous)=>{
    assert.equal(dialogs.get(page).length,previous+1);assert.match(dialogs.get(page).at(-1),/未保存/);assert.match(dialogs.get(page).at(-1),/放弃/);
  };
  const outer=async(page,accept)=>{
    const count=dialogs.get(page).length;control.acceptDialogs=accept;
    await page.getByRole('button',{name:'主管考勤范围',exact:true}).click();generic(page,count);
    if(accept){await panel(page).waitFor({state:'detached'});await page.getByRole('region',{name:'主管考勤范围',exact:true}).waitFor();}
    else await panel(page).waitFor();
  };
  const reopen=async(page,revision)=>{
    const count=dialogs.get(page).length;control.acceptDialogs=true;
    await page.getByRole('button',{name:'考勤配置',exact:true}).click();await admin(page).waitFor();generic(page,count);
    return open(page,revision);
  };
  const noPost=from=>assert.equal(requests.slice(from).filter(r=>r.method==='POST').length,0);
  const originalRead=(from,operationId)=>{
    const sequence=requests.slice(from).filter(r=>r.path===endpoint);assert.equal(sequence.length,1);assert.equal(sequence[0].method,'GET');
    assert.equal(sequence[0].query.siteId,site);assert.equal(sequence[0].query.operationId,operationId);assert.equal(sequence[0].query.beforeRevision,undefined);
  };
  const reason=page=>panel(page).getByRole('textbox',{name:/^变更理由/});
  const ack=page=>panel(page).getByRole('checkbox',{name:/^已核对范围与理由/});
  const days=page=>panel(page).getByRole('spinbutton',{name:/^原始上班日期后可提交天数/});
  const status=(page,text)=>panel(page).getByRole('status').filter({hasText:text});
  const response=(page,method='GET',operationId=null)=>page.waitForResponse(r=>{
    const url=new URL(r.url());return url.pathname===endpoint&&r.request().method()===method&&r.status()===200
      &&(method!=='GET'||url.searchParams.get('siteId')===site&&(!operationId||url.searchParams.get('operationId')===operationId));
  });
  const payload=async reply=>{const value=await(await reply).json();assert.equal(value.ok,true);return value;};
  const retry=page=>panel(page).getByRole('button',{name:'用原编号明确重试',exact:true});
  try {
    control.acceptDialogs=true;transport.state.moduleEnabled=true;
    const initial=await reload(owner,8);assert.equal(initial.policy.values.submissionWindowDays,12);assert.equal(await pending(owner),null);
    const draftFrom=requests.length,draft='合成外层期限草稿：取消保留，确认丢弃';await policy(owner,24,draft);
    await outer(owner,false);assert.equal(await days(owner).inputValue(),'24');assert.equal(await reason(owner).inputValue(),draft);assert(await ack(owner).isChecked());assert.equal(await pending(owner),null);
    await outer(owner,true);const restored=await reopen(owner,8);assert.deepEqual(restored.policy,initial.policy);assert.deepEqual(restored.entries,initial.entries);
    assert.equal(await days(owner).inputValue(),'12');assert.equal(await reason(owner).inputValue(),'');assert.equal(await ack(owner).isChecked(),false);assert.equal(await pending(owner),null);
    assert(await panel(owner).getByRole('button',{name:'确认设置申请期限',exact:true}).isDisabled());noPost(draftFrom);assert.deepEqual(ledger(),before.ledger);keep();
    pass('actual desktop controls outer navigation: cancel retains unsent policy days/reason/ack, accept unmounts; re-entry reads the same saved policy and resets reason/ack, with no POST or pending intent');

    await reload(phone,8);const lockFrom=requests.length;await lock(phone,'2026-03-26','2026-03-27');
    await outer(phone,false);assert.equal(await panel(phone).getByRole('combobox',{name:/^配置操作/}).inputValue(),'lock_period');
    assert.equal(await panel(phone).getByLabel('锁定开始日期',{exact:true}).inputValue(),'2026-03-26');assert.equal(await panel(phone).getByLabel('锁定结束日期（含）',{exact:true}).inputValue(),'2026-03-27');
    assert.equal(await reason(phone).inputValue(),'合成验收：锁定已结束的周期');assert(await ack(phone).isChecked());assert.equal(await pending(phone),null);
    await outer(phone,true);const mobile=await reopen(phone,8);assert.deepEqual(mobile.activePeriods,initial.activePeriods);assert.deepEqual(mobile.policy,initial.policy);
    assert.equal(await panel(phone).getByRole('combobox',{name:/^配置操作/}).inputValue(),'set_policy');assert.equal(await reason(phone).inputValue(),'');assert.equal(await ack(phone).isChecked(),false);
    await panel(phone).getByRole('combobox',{name:/^配置操作/}).selectOption('lock_period');
    assert.equal(await panel(phone).getByLabel('锁定开始日期',{exact:true}).inputValue(),'');assert.equal(await panel(phone).getByLabel('锁定结束日期（含）',{exact:true}).inputValue(),'');
    // This selection is itself a new unsaved input. Use the existing explicit
    // reread confirmation to leave the caller with a clean policy form.
    await reload(phone,8);assert.equal(await pending(phone),null);assert(await phone.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    noPost(lockFrom);assert.deepEqual(ledger(),before.ledger);keep();
    pass('actual390px controls outer navigation: cancel preserves unsent lock dates/reason/ack; accepted leave resets the action and date fields on re-entry, creates no lock period, receipt or POST');

    await policy(owner,23,'合成未送达期限：外层离开后只核对原编号');const unsentFrom=writes().length,rpcBefore=rpcCalls().length;control.unsent=endpoint;
    await panel(owner).getByRole('button',{name:'确认设置申请期限',exact:true}).click();await status(owner,'未能确认结果').waitFor();
    const raw=await pending(owner);assert(raw);const intent=JSON.parse(raw),unsent=writes().at(-1);assert.equal(control.unsent,null);
    assert.equal(unsent.fault,'before-handler');assert.equal(unsent.status,null);assert.equal(writes().length,unsentFrom+1);assert.equal(rpcCalls().length,rpcBefore);assert.deepEqual(ledger(),before.ledger);keep();
    await outer(owner,false);assert.equal(await pending(owner),raw);await outer(owner,true);assert.equal(await pending(owner),raw);
    transport.state.moduleEnabled=false;const recoveryFrom=requests.length,recovered=await reopen(owner,8);
    await status(owner,'保存尚未确认').waitFor();assert.equal(recovered.moduleEnabled,false);assert.equal(recovered.receipt,null);assert.equal(await pending(owner),raw);
    originalRead(recoveryFrom,intent.command.operationId);noPost(recoveryFrom);assert.deepEqual(ledger(),before.ledger);keep();
    const pausedFrom=requests.length,pausedRead=response(owner,'GET',intent.command.operationId);await retry(owner).click();await payload(pausedRead);await status(owner,'保存尚未确认').waitFor();
    assert.equal(await pending(owner),raw);originalRead(pausedFrom,intent.command.operationId);noPost(pausedFrom);assert.deepEqual(ledger(),before.ledger);
    transport.state.moduleEnabled=true;const explicitFrom=requests.length,submitted=response(owner,'POST');await retry(owner).click();const confirmed=await payload(submitted);
    await status(owner,'原操作已确认').waitFor();await atRevision(owner,9);const sequence=requests.slice(explicitFrom).filter(r=>r.path===endpoint);
    assert.deepEqual(sequence.map(r=>r.method),['GET','POST']);assert.equal(sequence[0].query.siteId,site);assert.equal(sequence[0].query.operationId,intent.command.operationId);assert.deepEqual(sequence[1].body,unsent.body);
    assert.equal(confirmed.receipt.operationId,intent.command.operationId);assert.equal(confirmed.policy.values.submissionWindowDays,23);assert.equal(await pending(owner),null);
    assert.equal(writes().length,unsentFrom+2);assert.equal(ledger().length,9);assert.equal(ledger().at(-1).operation_id,intent.command.operationId);keep();
    pass('controls request aborted before handler survives cancelled/accepted outer leave; paused re-entry and paused explicit retry only GET the same UUID; reopening writes plus explicit retry sends the original payload once and adds one receipt');

    // Restore the initial policy value via an explicit audited operation, hold
    // its real SQL success, and release only after actual outer unmount.
    await policy(owner,initial.policy.values.submissionWindowDays,'合成已提交期限：外层离开后确认原收据，不重复恢复');
    const beforeHeld=ledger(),heldPosts=writes().length,held=holdControlsResponse(owner,endpoint);
    await panel(owner).getByRole('button',{name:'确认设置申请期限',exact:true}).click();const committed=await held.ready(),heldRaw=await pending(owner);assert(heldRaw);const heldIntent=JSON.parse(heldRaw);
    assert.equal(committed.receipt.operationId,heldIntent.command.operationId);assert.equal(committed.revision,10);assert.equal(ledger().length,10);preservePrior(beforeHeld,ledger());
    assert.equal(writes().length,heldPosts+1);assert.equal(writes().at(-1).fault,'held-after-sql');assert.equal(ledger().at(-1).operation_id,heldIntent.command.operationId);
    await outer(owner,false);assert.equal(await pending(owner),heldRaw);assert.equal(await panel(owner).locator('article').count(),0);
    await outer(owner,true);await held.release();await settle(owner);assert.equal(await panel(owner).count(),0);assert.equal(await pending(owner),heldRaw);
    assert.equal((await owner.locator('body').innerText()).includes(heldIntent.command.reason),false);
    const committedLedger=ledger(),heldRecoveryFrom=requests.length;transport.state.moduleEnabled=false;const receipt=await reopen(owner,10);await status(owner,'原操作已确认').waitFor();
    assert.equal(receipt.moduleEnabled,false);assert.equal(receipt.receipt.operationId,heldIntent.command.operationId);assert.equal(receipt.receipt.reason,heldIntent.command.reason);
    assert.deepEqual(receipt.policy.values,initial.policy.values);assert.equal(await pending(owner),null);originalRead(heldRecoveryFrom,heldIntent.command.operationId);noPost(heldRecoveryFrom);
    assert.equal(writes().length,heldPosts+1);assert.deepEqual(ledger(),committedLedger);assert.equal(await reason(owner).inputValue(),'');assert.equal(await ack(owner).isChecked(),false);keep();
    pass('controls real SQL success held across outer leave: cancel preserves pending, accept unmounts before release; old details stay hidden and paused re-entry confirms exactly the original receipt by GET without repeating the policy write');

    assert.equal(writes().length,before.posts+3);assert.deepEqual(writes().slice(before.posts).map(r=>r.status),[null,200,200]);
    assert.deepEqual(ledger().slice(before.ledger.length).map(row=>row.operation_id),[intent.command.operationId,heldIntent.command.operationId]);
    return {controlsCountBefore:before.ledger.length,controlsCountAfter:ledger().length,controlsPostCountBefore:before.posts,controlsPostCountAfter:writes().length,
      operationIds:[intent.command.operationId,heldIntent.command.operationId],policyValuesRestored:true,periodsUnchanged:true};
  } finally {
    transport.state.moduleEnabled=wasEnabled;control.acceptDialogs=priorDialogs;control.unsent=null;control.lose=null;
    for(const [page,observer] of observers)page.off('dialog',observer);
  }
}
