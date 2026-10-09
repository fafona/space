// Actual two-location UI + real handler/SQL receipts. Only the owned synthetic
// merchant is eligible; no real Auth, production, GPS or inferred business writes.
import assert from 'node:assert/strict';

async function settle(page) {
  await page.evaluate(()=>new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('location_cross_task_timeout')),5000);
    requestAnimationFrame(()=>requestAnimationFrame(()=>{clearTimeout(timer);resolve();}));
  }));
}

export async function checkLocationCrossRecoveryShell({owner,admin,exec,transport,requests,pass,site,actors,id,locationId,control,holdLocationSettingsResponse,
  endpoints,workspace,panel,pending,writes,drafts,notices,setup,settings,location,config,preserved,immutable,step,fillPolicy,setupIntent,saveSetup}) {
  assert.equal(site,'99990001');
  const wasEnabled=transport.state.moduleEnabled,priorDialogs=control.acceptDialogs;
  const before={drafts:drafts(),notices:notices(),setup:setup(),settings:settings(),location:location(),config:config()};
  assert.equal(before.config.length,5);assert.equal(before.drafts.length,5);assert.equal(before.notices.length,3);assert.equal(before.setup.length,7);
  const fields=['user_id','auth_user_id','owner_user_id','owner_id','auth_id','created_by','created_by_user_id'];
  const binding=()=>JSON.parse(exec(`select jsonb_build_object(${fields.map(field=>`'${field}',${field}`).join(',')}) from public.merchants where id='${site}';`));
  const originalBinding=binding();assert.equal(originalBinding.user_id,actors[0].id);
  for(const value of Object.values(originalBinding))assert(value===null||/^[0-9a-f-]{36}$/.test(value));
  let revoked=false,other=null,postCreationSettings=null,postCreationConfig=null;
  const restore=()=>{exec(`update public.merchants set ${fields.map(field=>`${field}=${originalBinding[field]===null?'null':`'${originalBinding[field]}'`}`).join(',')} where id='${site}';`);revoked=false;assert.deepEqual(binding(),originalBinding);};
  const revoke=()=>{revoked=true;exec(`update public.merchants set user_id='${id(98)}',auth_user_id=null,owner_user_id=null,owner_id=null,auth_id=null,created_by=null,created_by_user_id=null where id='${site}';`);};
  const allLocations=()=>JSON.parse(exec(`select jsonb_agg(to_jsonb(t) order by id) from public.merchant_attendance_locations t where merchant_id='${site}';`));
  const snapshot=()=>({drafts:drafts(),notices:notices(),setup:setup(),settings:settings(),locations:allLocations(),config:config()});
  const keep=()=>{
    preserved();immutable(before.drafts,drafts());immutable(before.notices,notices());immutable(before.setup,setup());immutable(before.config,config());
    assert.deepEqual(location(),before.location,'cross_recovery_changed_A_location');
    if(other){assert.deepEqual(allLocations().find(row=>row.id===other.id),other,'cross_recovery_changed_B_location');assert.equal(allLocations().length,2);}
    if(postCreationConfig)assert.deepEqual(config(),postCreationConfig);
  };
  const response=(kind,method='GET',status=200,query={})=>owner.waitForResponse(r=>{
    const url=new URL(r.url());return url.pathname===endpoints[kind]&&r.request().method()===method&&r.status()===status
      &&(method!=='GET'||url.searchParams.get('siteId')===site&&Object.entries(query).every(([key,value])=>url.searchParams.get(key)===value));
  });
  const payload=async reply=>{const value=await(await reply).json();assert.equal(value.ok,true);return value;};
  const adminResponse=(method='GET')=>owner.waitForResponse(r=>{const url=new URL(r.url());return url.pathname==='/api/merchant-enterprise/attendance/admin'&&r.request().method()===method&&r.status()===200
    &&(method==='POST'||url.searchParams.get('siteId')===site&&url.searchParams.get('view')==='locations');});
  const leave=async()=>{await owner.getByRole('button',{name:'主管考勤范围',exact:true}).click();await workspace(owner).waitFor({state:'detached'});await owner.getByRole('region',{name:'主管考勤范围',exact:true}).waitFor();};
  const list=async()=>{
    await owner.getByRole('button',{name:'考勤配置',exact:true}).click();await admin(owner).waitFor();
    const loaded=adminResponse();await admin(owner).getByRole('button',{name:'工作地点',exact:true}).click();const value=await payload(loaded);
    if(other){assert.equal(value.items.length,2);assert(value.items.some(item=>item.id===locationId));assert(value.items.some(item=>item.id===other.id));}
    return value;
  };
  const entry=name=>admin(owner).getByText(name,{exact:true}).locator('../..').getByRole('button',{name:'定位政策与围栏',exact:true});
  const enter=async(selected,kind='policy',query={},status=200)=>{
    const loaded=response(kind,'GET',status,{locationId:query.locationId??selected.id,...query});await entry(selected.name).click();
    await workspace(owner).getByRole('heading',{name:`${selected.name} · 定位设置`,exact:true}).waitFor();return (await loaded).json();
  };
  const success=kind=>panel(owner,kind).getByRole('status').filter({hasText:kind==='policy'?'草稿保存已确认':kind==='setup'?'服务器已确认原操作':'操作已确认'});
  const readButton=kind=>panel(owner,kind).getByRole('button',{name:kind==='policy'?'重新读取／核对保存':'重新读取／核对收据',exact:true});
  const readOnly=(from,kind,operationId)=>{
    const selected=requests.slice(from).filter(r=>r.path===endpoints[kind]);assert.equal(selected.length,1);assert.equal(selected[0].method,'GET');
    assert.equal(selected[0].query.locationId,locationId);assert.equal(selected[0].query.operationId,operationId);
    if(kind==='notice')assert.equal(selected[0].query.access,'owner');
  };
  try {
    control.acceptDialogs=true;transport.state.moduleEnabled=true;await leave();await list();
    await admin(owner).getByRole('button',{name:'新增地点',exact:true}).click();
    const otherName='合成跨地点 B · 仅本地恢复验收';await admin(owner).getByLabel('地点名称',{exact:true}).fill(otherName);
    await admin(owner).getByLabel('启用此地点',{exact:true}).check();
    const savedResponse=adminResponse('POST'),listed=adminResponse();await admin(owner).getByRole('button',{name:'保存地点',exact:true}).click();
    const created=await payload(savedResponse);await payload(listed);await admin(owner).getByRole('button',{name:'保存地点',exact:true}).waitFor({state:'detached'});
    assert.equal(created.receipt.kind,'location');assert.equal(created.version,before.settings.version+1);
    other=allLocations().find(row=>row.id===created.receipt.targetId);assert(other);assert.notEqual(other.id,locationId);assert.equal(other.name,otherName);assert.equal(other.version,1);assert.equal(other.active,true);
    postCreationSettings=settings();postCreationConfig=config();assert.equal(postCreationConfig.length,6);immutable(before.config,postCreationConfig);
    assert.deepEqual({...postCreationSettings,version:before.settings.version,updated_at:before.settings.updated_at},before.settings);
    const newConfig=postCreationConfig.filter(row=>!before.config.some(old=>old.operation_id===row.operation_id));assert.equal(newConfig.length,1);
    assert.equal(newConfig[0].operation_id,created.receipt.operationId);assert.equal(newConfig[0].command.kind,'location');assert.equal(newConfig[0].command.values.id,other.id);keep();
    const refreshed=await enter(before.location);assert.equal(refreshed.settingsVersion,postCreationSettings.version);assert.equal(refreshed.current.revision,5);assert.equal(refreshed.current.settingsVersion,before.settings.version);

    for(const kind of ['policy','notice','setup']) {
      transport.state.moduleEnabled=true;
      if(kind==='policy')await fillPolicy(owner,{purpose:'合成 A 专属政策：跨地点恢复不得混入 B'});
      if(kind==='notice'){
        const publishable=await step(owner,'notice');assert.equal(publishable.canPublish,true);assert.equal(publishable.draft.revision,6);
        await panel(owner,kind).getByRole('combobox',{name:/^操作/}).selectOption('publish');await panel(owner,kind).getByRole('textbox',{name:/^操作说明/}).fill('合成 A 告知：B 入口只核对 A 原操作');
        await panel(owner,kind).getByRole('checkbox',{name:/^我确认向员工公开下方草稿/}).check();
      }
      if(kind==='setup'){
        const enabled=await step(owner,'setup');assert.equal(enabled.canEnable,true);assert.equal(enabled.channelEnabled,false);
        await setupIntent(owner,'enable','合成 A 启用收据：B 入口不得重做原操作');
      }
      const beforeWrite=snapshot(),postCount=writes(kind).length,held=holdLocationSettingsResponse(owner,endpoints[kind]);
      await panel(owner,kind).getByRole('button',{name:kind==='policy'?'保存草稿 · 不启用定位':kind==='notice'?'发布告知版本':'启用企业定位通路',exact:true}).click();
      const committed=await held.ready(),raw=await pending(owner,kind);assert(raw);const intent=JSON.parse(raw),op=intent.command.operationId;
      assert.equal(kind==='setup'?committed.receipt.command.operationId:committed.receipt.operationId,op);assert.equal(writes(kind).length,postCount+1);assert.equal(writes(kind).at(-1).fault,'held-after-sql');
      const committedState=snapshot();assert.equal(committedState[kind==='policy'?'drafts':kind==='notice'?'notices':'setup'].length,beforeWrite[kind==='policy'?'drafts':kind==='notice'?'notices':'setup'].length+1);
      await leave();await held.release();await settle(owner);assert.equal(await pending(owner,kind),raw);assert.equal(await workspace(owner).count(),0);
      await list();
      if(kind==='policy'){
        // Policy slots are per location. Merely selecting B must not scan,
        // consume, or display A's pending policy. Global slots below do recover A.
        const from=requests.length,bPolicy=await enter(other);assert.equal(bPolicy.current,null);assert.equal(bPolicy.receipt,null);assert.equal(bPolicy.locationId,other.id);
        await panel(owner,'policy').getByRole('textbox',{name:'定位用途',exact:true}).waitFor();assert.equal(await panel(owner,'policy').getByRole('textbox',{name:'定位用途',exact:true}).inputValue(),'');
        assert.equal(await pending(owner,'policy'),raw);const reads=requests.slice(from).filter(r=>r.path===endpoints.policy);
        assert.equal(reads.length,1);assert.equal(reads[0].query.locationId,other.id);assert.equal(reads[0].query.operationId,undefined);assert.deepEqual(snapshot(),committedState);
        await leave();await list();
      }
      // Keep the authenticated Admin locations list already loaded; revocation
      // now targets the real child read, not an earlier blocked parent page.
      const selected=kind==='policy'?before.location:other,deniedFrom=requests.length;revoke();
      const denied=await enter(selected,kind,{locationId,operationId:op},403);assert.equal(denied.error,'attendance_access_denied');
      for(const field of ['receipt','current','draft','location','channelEnabled'])assert.equal(field in denied,false);
      await panel(owner,kind).getByRole('status').filter({hasText:kind==='policy'?'仅当前商户负责人可以管理考勤配置':kind==='setup'?'未能确认结果或访问权限':'暂时无法确认结果或访问权限'}).waitFor();
      assert.equal(await panel(owner,kind).locator('form').count(),0);assert.equal(await panel(owner,kind).locator('details').count(),0);
      const privateText=kind==='policy'?intent.command.values.purpose:intent.command.reason;assert.equal((await panel(owner,kind).innerText()).includes(privateText),false);
      assert.equal(await pending(owner,kind),raw);readOnly(deniedFrom,kind,op);assert.deepEqual(snapshot(),committedState);assert.equal(writes(kind).length,postCount+1);keep();
      if(kind!=='policy')await workspace(owner).getByText(`正在恢复另一个地点（${locationId}）的原操作，不是修改上方所选地点。核对后点击步骤按钮回到所选地点。`,{exact:true}).waitFor();
      restore();transport.state.moduleEnabled=false;const restoreFrom=requests.length,recoveredResponse=response(kind,'GET',200,{locationId,operationId:op});await readButton(kind).click();const recovered=await payload(recoveredResponse);
      await success(kind).waitFor();assert.equal(recovered.moduleEnabled,false);assert.equal(kind==='setup'?recovered.receipt.command.operationId:recovered.receipt.operationId,op);
      assert.equal(kind==='notice'?recovered.location.id:recovered.locationId,locationId);assert.equal(await pending(owner,kind),null);readOnly(restoreFrom,kind,op);
      assert.deepEqual(snapshot(),committedState);assert.equal(writes(kind).length,postCount+1);keep();
      if(kind!=='policy'){
        const label=kind==='notice'?/^3 · 发布告知/:/^2 \/ 4 · 围栏与通路/;
        const bResponse=response(kind,'GET',200,{locationId:other.id}),bFrom=requests.length;await workspace(owner).getByRole('button',{name:label}).click();const b=await payload(bResponse);
        assert.equal(kind==='notice'?b.location.id:b.locationId,other.id);assert.equal(b.receipt,null);assert.equal(b.draft,null);
        if(kind==='notice')assert.equal(b.current,null);else{assert.equal(b.location.fence,null);assert.equal(b.channelEnabled,true);}
        const bReads=requests.slice(bFrom).filter(r=>r.path===endpoints[kind]);assert.equal(bReads.length,1);assert.equal(bReads[0].query.operationId,undefined);
        assert.equal((await panel(owner,kind).innerText()).includes(privateText),false);assert.equal(writes(kind).length,postCount+1);assert.deepEqual(snapshot(),committedState);
      }
      pass(kind==='policy'
        ?'actual per-location policy pending: opening B never consumes or displays A; reopening A after all owner aliases are revoked gives SQL403 and preserves pending; restored owner while paused confirms A by original-ID GET with no duplicate save'
        :`actual ${kind} global pending: B entry restores A target/original ID, revoked owner gets SQL403 with no private details and unchanged pending; restored paused owner GET confirms only A, explicit step then reads B with no receipt or second POST`);
      await leave();await list();await enter(before.location);
    }
    // End this isolated scenario with the original channel value, via a real,
    // explicitly confirmed pause. Do not delete the successful enable receipt.
    const beforePause=await step(owner,'setup');assert.equal(beforePause.moduleEnabled,false);assert.equal(beforePause.canPause,true);
    await setupIntent(owner,'pause','合成验收结束：明确暂停企业定位通路');const paused=await saveSetup(owner,'pause');assert.equal(paused.channelEnabled,false);
    assert.equal(settings().version,postCreationSettings.version);assert.equal(settings().location_clock_enabled,false);
    assert.equal(drafts().length,6);assert.equal(notices().length,4);assert.equal(setup().length,9);keep();
    assert.equal(writes('policy').length,7);assert.equal(writes('notice').length,5);assert.equal(writes('setup').length,10);
    assert(drafts().every(row=>row.location_id===locationId));assert(notices().every(row=>row.location_id===locationId));assert(setup().every(row=>row.location_id===locationId));
    await step(owner,'policy');return {configCountBefore:5,configCountAfter:6,configWritesAdded:1,configOperationId:created.receipt.operationId,locationCount:2,otherLocationUnchanged:true};
  } finally {
    transport.state.moduleEnabled=wasEnabled;control.acceptDialogs=priorDialogs;control.lose=null;control.unsent=null;
    if(revoked)restore();
  }
}
