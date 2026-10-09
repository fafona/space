// Extend the actual owner-location shell; use only its existing synthetic DB.
// No employee location sampling, business-result stubs or hidden recovery POSTs.
import assert from 'node:assert/strict';

async function settle(page) {
  await page.evaluate(()=>new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('location_recovery_task_timeout')),5000);
    requestAnimationFrame(()=>requestAnimationFrame(()=>{clearTimeout(timer);resolve();}));
  }));
}

export async function checkLocationSettingsRecoveryShell({owner,admin,transport,requests,pass,site,locationId,control,holdLocationSettingsResponse,
  endpoints,workspace,panel,pending,writes,drafts,notices,setup,settings,location,config,preserved,immutable,open,step,fillPolicy}) {
  const wasEnabled=transport.state.moduleEnabled,priorDialogs=control.acceptDialogs;
  const dialogs=[],observe=dialog=>dialogs.push(dialog.message());owner.on('dialog',observe);
  const before={drafts:drafts(),notices:notices(),operational:{setup:setup(),settings:settings(),location:location(),config:config()}};
  assert.equal(before.drafts.length,3);assert.equal(before.notices.length,1);
  const keep=()=>{
    preserved();immutable(before.drafts,drafts());immutable(before.notices,notices());
    assert.deepEqual({setup:setup(),settings:settings(),location:location(),config:config()},before.operational,'policy_notice_recovery_changed_operational_state');
  };
  const read=(kind,query={})=>owner.waitForResponse(response=>{
    const url=new URL(response.url());return url.pathname===endpoints[kind]&&response.request().method()==='GET'&&response.status()===200
      &&url.searchParams.get('siteId')===site&&url.searchParams.get('locationId')===locationId
      &&Object.entries(query).every(([key,value])=>url.searchParams.get(key)===value);
  });
  const body=async reply=>{const value=await(await reply).json();assert.equal(value.ok,true);return value;};
  const status=(kind,text)=>panel(owner,kind).getByRole('status').filter({hasText:text});
  const uncertain=async kind=>{
    await panel(owner,kind).getByRole('button',{name:kind==='policy'?'原编号重试（先查询收据）':'原编号重试',exact:true}).waitFor();
    await settle(owner);const raw=await pending(owner,kind);assert(raw);
    assert(await workspace(owner).getByRole('button',{name:'返回工作地点',exact:true}).isDisabled());
    for(const button of await workspace(owner).getByRole('navigation',{name:'地点定位设置步骤',exact:true}).getByRole('button').all())assert(await button.isDisabled());
    return {raw,intent:JSON.parse(raw)};
  };
  const retry=kind=>panel(owner,kind).getByRole('button',{name:kind==='policy'?'原编号重试（先查询收据）':'原编号重试',exact:true});
  const reopen=async kind=>{
    await owner.getByRole('button',{name:'考勤配置',exact:true}).click();await admin(owner).waitFor();return open(owner,kind);
  };
  const leave=async()=>{
    await owner.getByRole('button',{name:'主管考勤范围',exact:true}).click();await workspace(owner).waitFor({state:'detached'});
    await owner.getByRole('region',{name:'主管考勤范围',exact:true}).waitFor();
  };
  const prepareNotice=async(action,reason)=>{
    await panel(owner,'notice').getByRole('combobox',{name:/^操作/}).selectOption(action);
    await panel(owner,'notice').getByRole('textbox',{name:/^操作说明/}).fill(reason);
    await panel(owner,'notice').getByRole('checkbox',{name:action==='publish'?/^我确认向员工公开下方草稿/:/^我确认撤回当前告知/}).check();
  };
  try {
    control.acceptDialogs=true;transport.state.moduleEnabled=true;await step(owner,'policy');
    const originalPurpose=await panel(owner,'policy').getByRole('textbox',{name:'定位用途',exact:true}).inputValue();
    const draft='合成外层离开：仅输入，不保存政策',from=requests.length;
    await fillPolicy(owner,{purpose:draft});control.acceptDialogs=false;const beforeDialogs=dialogs.length;
    await owner.getByRole('button',{name:'主管考勤范围',exact:true}).click();
    assert.equal(dialogs.length,beforeDialogs+1);assert.match(dialogs.at(-1),/未保存/);assert.match(dialogs.at(-1),/放弃/);
    assert.equal(await panel(owner,'policy').getByRole('textbox',{name:'定位用途',exact:true}).inputValue(),draft);
    assert(await panel(owner,'policy').getByRole('checkbox',{name:/^我理解这里只保存政策草稿/}).isChecked());
    control.acceptDialogs=true;await leave();assert.equal(dialogs.length,beforeDialogs+2);assert.match(dialogs.at(-1),/放弃/);await reopen('policy');
    assert.equal(await panel(owner,'policy').getByRole('textbox',{name:'定位用途',exact:true}).inputValue(),originalPurpose);
    assert.equal(await panel(owner,'policy').getByRole('checkbox',{name:/^我理解这里只保存政策草稿/}).isChecked(),false);
    assert.equal(await pending(owner,'policy'),null);assert.equal(requests.slice(from).filter(r=>r.method==='POST').length,0);keep();
    pass('actual owner policy outer navigation: cancel preserves unsent values/ack; accept unmounts and re-entry shows only saved policy with fresh confirmation, zero POST or pending operation');

    // A pause alone cannot prove that an earlier uncertain operation failed.
    // Both families keep the exact bytes while an explicit retry is GET-only.
    for(const kind of ['policy','notice']) {
      if(kind==='policy')await fillPolicy(owner,{purpose:'合成验收：政策未送达后只用原编号重试'});
      else {const current=await step(owner,'notice');assert.equal(current.canPublish,true);await prepareNotice('publish','合成验收：告知未送达后只用原编号重试');}
      const rowCount=kind==='policy'?drafts:notices;
      const rpc=kind==='policy'?'faolla_attendance_location_policy_draft_v1':'faolla_attendance_location_notice_v1';
      const priorRows=rowCount(),postCount=writes(kind).length,callCount=transport.calls.filter(c=>c.name===rpc&&c.command!==null).length;
      control.unsent=endpoints[kind];
      await panel(owner,kind).getByRole('button',{name:kind==='policy'?'保存草稿 · 不启用定位':'发布告知版本',exact:true}).click();
      const {raw,intent}=await uncertain(kind);assert.equal(control.unsent,null);assert.deepEqual(rowCount(),priorRows);
      assert.equal(transport.calls.filter(c=>c.name===rpc&&c.command!==null).length,callCount);
      assert.equal(writes(kind).at(-1).fault,'before-handler');assert.equal(writes(kind).length,postCount+1);
      transport.state.moduleEnabled=false;
      const pausedRead=read(kind,{operationId:intent.command.operationId});await retry(kind).click();const paused=await body(pausedRead);
      await status(kind,kind==='policy'?'保存结果尚未确认':'原操作尚未确认').waitFor();await settle(owner);
      assert.equal(paused.moduleEnabled,false);assert.equal(paused.receipt,null);assert.equal(await pending(owner,kind),raw);
      assert.equal(writes(kind).length,postCount+1);assert.deepEqual(rowCount(),priorRows);keep();
      transport.state.moduleEnabled=true;const start=requests.length;
      const submitted=owner.waitForResponse(r=>new URL(r.url()).pathname===endpoints[kind]&&r.request().method()==='POST'&&r.status()===200);
      await retry(kind).click();const confirmed=await body(submitted);await status(kind,kind==='policy'?'草稿保存已确认':'操作已确认').waitFor();
      const sequence=requests.slice(start).filter(r=>r.path===endpoints[kind]);assert.deepEqual(sequence.map(r=>r.method),['GET','POST']);
      assert.equal(sequence[0].query.operationId,intent.command.operationId);assert.equal(sequence[0].query.locationId,locationId);
      assert.deepEqual(writes(kind).slice(postCount).map(r=>r.body),[writes(kind)[postCount].body,writes(kind)[postCount].body]);
      assert.equal(confirmed.receipt.operationId,intent.command.operationId);assert.equal(await pending(owner,kind),null);
      assert.equal(rowCount().length,priorRows.length+1);immutable(priorRows,rowCount());keep();
      pass(`actual ${kind} request lost BEFORE handler: pause preserves original pending and explicit retry is GET-only; resume then explicit retry reads the same receipt ID and sends identical command once, with no operational or employee changes`);

      // Policy gets a new draft; notice withdraws the actual new publication.
      // The latter is a safe action even while new attendance is paused.
      if(kind==='policy')await fillPolicy(owner,{purpose:'合成验收：已提交政策离开后恢复原收据'});
      else {transport.state.moduleEnabled=false;const currentRead=read(kind);await panel(owner,kind).getByRole('button',{name:'重新读取／核对收据',exact:true}).click();const current=await body(currentRead);assert.equal(current.canWithdraw,true);await prepareNotice('withdraw','合成验收：已提交撤回离开后恢复原收据');}
      const beforeHeld=rowCount(),heldCount=writes(kind).length,held=holdLocationSettingsResponse(owner,endpoints[kind]);
      await panel(owner,kind).getByRole('button',{name:kind==='policy'?'保存草稿 · 不启用定位':'撤回告知版本',exact:true}).click();const committed=await held.ready();
      const heldRaw=await pending(owner,kind);assert(heldRaw);const heldIntent=JSON.parse(heldRaw);
      assert.equal(committed.receipt.operationId,heldIntent.command.operationId);assert.equal(rowCount().length,beforeHeld.length+1);
      assert.equal(writes(kind).length,heldCount+1);assert.equal(writes(kind).at(-1).fault,'held-after-sql');
      await leave();await held.release();await settle(owner);assert.equal(await workspace(owner).count(),0);
      assert.equal(await pending(owner,kind),heldRaw,'late_location_reply_cleared_unmounted_pending');
      const privateText=kind==='policy'?heldIntent.command.values.purpose:heldIntent.command.reason;
      assert.equal((await owner.locator('body').innerText()).includes(privateText),false);
      transport.state.moduleEnabled=false;const restoreStart=requests.length,recovered=await reopen(kind);
      await status(kind,kind==='policy'?'草稿保存已确认':'操作已确认').waitFor();
      assert.equal(recovered.moduleEnabled,false);assert.equal(recovered.receipt.operationId,heldIntent.command.operationId);
      assert.equal(await pending(owner,kind),null);assert.equal(writes(kind).length,heldCount+1);
      const reads=requests.slice(restoreStart).filter(r=>r.path===endpoints[kind]);assert.equal(reads.length,1);assert.equal(reads[0].method,'GET');
      assert.equal(reads[0].query.operationId,heldIntent.command.operationId);assert.equal(reads[0].query.locationId,locationId);
      if(kind==='notice'){assert.equal(recovered.current.action,'withdraw');assert.equal(recovered.canPublish,false);assert.equal(recovered.canWithdraw,false);assert.equal(committed.operationalChanged,false);}
      immutable(beforeHeld,rowCount());keep();
      pass(`actual ${kind} SQL success held until outer navigation unmount: old details stay absent, exact pending survives; paused re-entry GET confirms the same receipt without a second POST, fence/channel/employee facts unchanged`);
      if(kind==='policy')transport.state.moduleEnabled=true;
    }
    assert.equal(drafts().length,5);assert.equal(notices().length,3);assert.equal(setup().length,7);
    assert.deepEqual(writes('policy').map(r=>r.status),[200,200,409,null,200,200]);
    assert.deepEqual(writes('notice').map(r=>r.status),[200,null,200,200]);
    assert.equal(writes('setup').length,8);keep();
    await step(owner,'policy');
  } finally {transport.state.moduleEnabled=wasEnabled;control.acceptDialogs=priorDialogs;control.lose=null;control.unsent=null;owner.off('dialog',observe);}
}
