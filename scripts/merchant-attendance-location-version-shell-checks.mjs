// Settings-only version advancement through actual owner UI and isolated SQL.
// No injected business results, production access or employee location sampling.
import assert from 'node:assert/strict';

export async function checkLocationVersionShell({owner,phone,newPage,openOwner,admin,exec,transport,requests,pass,site,actors,locationId,control,
  endpoints,panel,pending,writes,drafts,notices,setup,settings,location,config,preserved,immutable,step,reload,fillPolicy,savePolicy,setupIntent,saveSetup}) {
  assert.equal(site,'99990001');
  const wasEnabled=transport.state.moduleEnabled,priorDialogs=control.acceptDialogs;
  const locations=()=>JSON.parse(exec(`select jsonb_agg(to_jsonb(t) order by id) from public.merchant_attendance_locations t where merchant_id='${site}';`));
  const snapshot=()=>({drafts:drafts(),notices:notices(),setup:setup(),settings:settings(),locations:locations(),config:config()});
  const before=snapshot(),counts=Object.fromEntries(['policy','notice','setup'].map(kind=>[kind,writes(kind).length]));
  assert.equal(before.config.length,6);assert.equal(before.drafts.length,6);assert.equal(before.notices.length,4);assert.equal(before.setup.length,9);
  const keep=()=>{preserved();for(const key of ['drafts','notices','setup','config'])immutable(before[key],snapshot()[key]);assert.deepEqual(locations(),before.locations);};
  const status=(page,kind,text)=>panel(page,kind).getByRole('status').filter({hasText:text});
  const readButton=(page,kind)=>panel(page,kind).getByRole('button',{name:kind==='policy'?'重新读取／核对保存':'重新读取／核对收据',exact:true});
  const retry=(page,kind)=>panel(page,kind).getByRole('button',{name:kind==='policy'?'原编号重试（先查询收据）':'原编号重试',exact:true});
  const response=(page,kind,method='GET',code=200,operationId=null)=>page.waitForResponse(r=>{
    const url=new URL(r.url());return url.pathname===endpoints[kind]&&r.request().method()===method&&r.status()===code
      &&(method!=='GET'||url.searchParams.get('siteId')===site&&url.searchParams.get('locationId')===locationId
        &&(!operationId||url.searchParams.get('operationId')===operationId));
  });
  const payload=async reply=>{const value=await(await reply).json();assert.equal(value.ok,true);return value;};
  const originalGet=(from,kind,op)=>{
    const reads=requests.slice(from).filter(r=>r.path===endpoints[kind]);assert.equal(reads.length,1);assert.equal(reads[0].method,'GET');
    assert.equal(reads[0].query.siteId,site);assert.equal(reads[0].query.locationId,locationId);assert.equal(reads[0].query.operationId,op);
    if(kind==='notice')assert.equal(reads[0].query.access,'owner');
  };
  const rpc=kind=>kind==='policy'?'faolla_attendance_location_policy_draft_v1':`faolla_attendance_location_${kind}_v1`;
  const rpcWrites=kind=>transport.calls.filter(call=>call.name===rpc(kind)&&call.command!==null);
  const prepareNotice=async(page,action,reason)=>{
    await panel(page,'notice').getByRole('combobox',{name:/^操作/}).selectOption(action);
    await panel(page,'notice').getByRole('textbox',{name:/^操作说明/}).fill(reason);
    await panel(page,'notice').getByRole('checkbox',{name:action==='publish'?/^我确认向员工公开下方草稿/:/^我确认撤回当前告知/}).check();
  };
  const noticeSave=async(page,action)=>{
    const reply=response(page,'notice','POST');await panel(page,'notice').getByRole('button',{name:action==='publish'?'发布告知版本':'撤回告知版本',exact:true}).click();
    const value=await payload(reply);await status(page,'notice','操作已确认').waitFor();assert.equal(await pending(page,'notice'),null);return value;
  };
  const loseBeforeHandler=async(page,kind,button)=>{
    const state=snapshot(),calls=rpcWrites(kind).length,postCount=writes(kind).length;control.unsent=endpoints[kind];
    await panel(page,kind).getByRole('button',{name:button,exact:true}).click();
    await status(page,kind,kind==='policy'?'暂时无法确认':kind==='setup'?'未能确认结果或访问权限':'暂时无法确认结果或访问权限').waitFor();
    await retry(page,kind).waitFor();assert.equal(control.unsent,null);const raw=await pending(page,kind);assert(raw);
    const intent=JSON.parse(raw),request=writes(kind).at(-1);assert.equal(request.fault,'before-handler');assert.equal(request.status,null);
    assert.equal(request.body.operationId,intent.command.operationId);assert.equal(writes(kind).length,postCount+1);assert.equal(rpcWrites(kind).length,calls);assert.deepEqual(snapshot(),state);
    return {page,kind,raw,intent,request};
  };
  let configPage=null;
  const configIds=[];
  try {
    control.acceptDialogs=true;transport.state.moduleEnabled=true;
    configPage=await newPage();await openOwner(configPage);
    const adminEndpoint='/api/merchant-enterprise/attendance/admin';
    const adminResponse=(method='GET')=>configPage.waitForResponse(r=>{const url=new URL(r.url());return url.pathname===adminEndpoint&&r.request().method()===method&&r.status()===200
      &&(method==='POST'||url.searchParams.get('siteId')===site&&url.searchParams.get('view')==='settings');});
    const bumpSettingsOnly=async()=>{
      const state=snapshot(),postCount=requests.filter(r=>r.path===adminEndpoint&&r.method==='POST').length;
      const loaded=adminResponse();await admin(configPage).getByRole('button',{name:'考勤设置',exact:true}).click();const current=await payload(loaded);
      assert.equal(current.version,state.settings.version);assert.equal(current.moduleEnabled,true);
      const values={timeZone:state.settings.time_zone,enabled:state.settings.enabled,webClockEnabled:state.settings.web_clock_enabled,webBreakPaid:state.settings.web_break_paid};
      assert.deepEqual(current.settings,values);const savedResponse=adminResponse('POST');
      await admin(configPage).getByRole('button',{name:'保存考勤设置',exact:true}).click();const saved=await payload(savedResponse);
      await admin(configPage).getByRole('status').filter({hasText:`保存已确认 · 配置版本 ${saved.version}`}).waitFor();
      const after=snapshot();assert.equal(after.settings.version,state.settings.version+1);
      assert.deepEqual({...after.settings,version:state.settings.version,updated_at:state.settings.updated_at},state.settings);
      for(const key of ['drafts','notices','setup','locations'])assert.deepEqual(after[key],state[key]);
      assert.equal(after.config.length,state.config.length+1);immutable(state.config,after.config);assert.equal(saved.receipt.kind,'settings');assert.equal(saved.receipt.targetId,null);
      const row=after.config.find(item=>item.operation_id===saved.receipt.operationId);assert(row);assert.equal(row.actor_auth_user_id,actors[0].id);
      assert.deepEqual(row.before_value,state.settings);assert.deepEqual(row.after_value,values);
      assert.deepEqual(row.command,{operationId:saved.receipt.operationId,expectedVersion:state.settings.version,kind:'settings',values});
      const posts=requests.filter(r=>r.path===adminEndpoint&&r.method==='POST');assert.equal(posts.length,postCount+1);
      assert.deepEqual(posts.at(-1).body,{siteId:site,...row.command});configIds.push(saved.receipt.operationId);keep();return {before:state,after};
    };

    for(const kind of ['policy','notice']) {
      const initial=await (kind==='policy'?reload(owner,'policy'):step(owner,'notice'));
      // A rejected old form retains the workspace's conservative input guard.
      // Explicitly confirm leaving it; a fresh GET is not a save receipt.
      const oldPhone=await step(phone,kind,{discard:kind==='notice'});assert.equal(initial.settingsVersion,oldPhone.settingsVersion);assert.equal(initial.settingsVersion,settings().version);
      if(kind==='policy'){
        await fillPolicy(owner,{purpose:'合成未送达政策：仅基础版本前进后不得重发'});
        await fillPolicy(phone,{purpose:'合成旧政策表单：SQL必须拒绝旧基础版本'});
      }else{
        assert.equal(initial.canPublish,true);assert.equal(oldPhone.canPublish,true);
        await prepareNotice(owner,'publish','合成未送达发布：仅基础版本前进后不得重发');
        await prepareNotice(phone,'publish','合成旧发布表单：SQL必须拒绝旧基础版本');
      }
      const lost=await loseBeforeHandler(owner,kind,kind==='policy'?'保存草稿 · 不启用定位':'发布告知版本');
      const bumped=await bumpSettingsOnly();assert.equal(lost.intent.command.expectedSettingsVersion,bumped.before.settings.version);
      const from=requests.length,read=response(owner,kind,'GET',200,lost.intent.command.operationId);
      await retry(owner,kind).click();const fenced=await payload(read);
      await status(owner,kind,kind==='policy'?'原收据未找到且版本已变化':'原编号未找到，但版本已变化').waitFor();
      assert.equal(fenced.receipt,null);assert.equal(fenced.settingsVersion,bumped.after.settings.version);
      assert.deepEqual(fenced.current,initial.current);assert.deepEqual(fenced.location,initial.location);
      if(kind==='notice'){assert.deepEqual(fenced.draft,initial.draft);assert.equal(fenced.canPublish,false);}
      assert.equal(await pending(owner,kind),null);originalGet(from,kind,lost.intent.command.operationId);assert.deepEqual(snapshot(),bumped.after);keep();
      pass(`actual ${kind} unsent command: real original-value settings save advances only settingsVersion; original-ID GET has no receipt, clears fenced pending, and sends no POST or location journal write`);

      const rejectedState=snapshot(),rejectFrom=requests.length,callCount=rpcWrites(kind).length;
      const rejectedResponse=response(phone,kind,'POST',409);await panel(phone,kind).getByRole('button',{name:kind==='policy'?'保存草稿 · 不启用定位':'发布告知版本',exact:true}).click();
      const rejected=await(await rejectedResponse).json();assert.equal(rejected.error,'attendance_version_conflict');
      await status(phone,kind,kind==='policy'?'配置已被修改':'暂时无法确认结果或访问权限').waitFor();assert.equal(await pending(phone,kind),null);
      const onlyPost=requests.slice(rejectFrom).filter(r=>r.path===endpoints[kind]);assert.equal(onlyPost.length,1);assert.equal(onlyPost[0].method,'POST');assert.equal(onlyPost[0].status,409);
      assert.equal(onlyPost[0].body.expectedSettingsVersion,initial.settingsVersion);assert.equal(onlyPost[0].body.expectedLocationVersion,initial.location.version);
      assert.equal(onlyPost[0].body.expectedRevision,initial.current?.revision??0);assert.notEqual(onlyPost[0].body.operationId,lost.intent.command.operationId);
      if(kind==='notice')assert.equal(onlyPost[0].body.draftRevision,initial.draft.revision);
      assert.equal(rpcWrites(kind).length,callCount+1);assert.equal(rpcWrites(kind).at(-1).allowWrite,true);
      assert.deepEqual(snapshot(),rejectedState);keep();
      pass(`actual stale ${kind} form submits its unchanged old settings fence without rereading; handler/SQL returns409 attendance_version_conflict, clears rejected intent, and appends no journal`);

      // Rebind A via an explicit new draft, never rewrite a saved draft in SQL.
      if(kind==='notice')await step(owner,'policy',{discard:true});
      await fillPolicy(owner,{purpose:`合成当前版本政策：${kind}旧请求核对后明确重新保存`});
      const current=await savePolicy(owner);assert.equal(current.current.settingsVersion,settings().version);assert.equal(current.current.locationVersion,location().version);
      await reload(phone,kind);
    }

    const publishable=await step(owner,'notice');assert.equal(publishable.canPublish,true);
    await prepareNotice(owner,'publish','合成安全操作验收：明确发布当前绑定版本');const published=await noticeSave(owner,'publish');assert.equal(published.noticeCurrent,true);
    const ready=await step(owner,'setup');assert.equal(ready.canEnable,true);assert.equal(ready.channelEnabled,false);
    await setupIntent(owner,'enable','合成安全操作验收：明确启用后再测试暂停');await saveSetup(owner,'enable');
    const noticeReady=await reload(phone,'notice');assert.equal(noticeReady.canWithdraw,true);assert.equal(noticeReady.noticeCurrent,true);
    await setupIntent(owner,'pause','合成原编号暂停：基础版本变化也必须允许关闭');
    await prepareNotice(phone,'withdraw','合成原编号撤回：基础版本变化也必须允许撤回');
    const pause=await loseBeforeHandler(owner,'setup','暂停企业定位通路'),withdraw=await loseBeforeHandler(phone,'notice','撤回告知版本');
    const safeBump=await bumpSettingsOnly();transport.state.moduleEnabled=false;
    for(const lost of [pause,withdraw]){
      const {page,kind,intent,raw}=lost,from=requests.length,read=response(page,kind,'GET',200,intent.command.operationId);
      await readButton(page,kind).click();const checked=await payload(read);
      await status(page,kind,kind==='setup'?'尚未确认原操作':'原操作尚未确认').waitFor();
      assert.equal(checked.moduleEnabled,false);assert.equal(checked.receipt,null);assert.equal(checked.settingsVersion,safeBump.after.settings.version);
      assert.equal(intent.command.expectedSettingsVersion,safeBump.before.settings.version);assert.equal(await pending(page,kind),raw);
      if(kind==='setup'){assert.equal(checked.channelVersion,intent.command.expectedChannelVersion);assert.equal(checked.canPause,true);}
      else{assert.equal(checked.current.revision,intent.command.expectedRevision);assert.equal(checked.canWithdraw,true);assert.equal(checked.noticeCurrent,false);}
      originalGet(from,kind,intent.command.operationId);assert.deepEqual(snapshot(),safeBump.after);
    }
    for(const lost of [pause,withdraw]){
      const {page,kind,intent}=lost,state=snapshot(),from=requests.length,done=response(page,kind,'POST');await retry(page,kind).click();const confirmed=await payload(done);
      await status(page,kind,kind==='setup'?'服务器已确认原操作':'操作已确认').waitFor();assert.equal(confirmed.moduleEnabled,false);assert.equal(await pending(page,kind),null);
      const sequence=requests.slice(from).filter(r=>r.path===endpoints[kind]);assert.deepEqual(sequence.map(r=>r.method),['GET','POST']);
      assert.equal(sequence[0].query.siteId,site);assert.equal(sequence[0].query.locationId,locationId);assert.equal(sequence[0].query.operationId,intent.command.operationId);
      if(kind==='notice')assert.equal(sequence[0].query.access,'owner');assert.deepEqual(sequence[1].body,lost.request.body);
      const after=snapshot();
      if(kind==='setup'){
        assert.deepEqual(confirmed.receipt.command,intent.command);assert.equal(confirmed.receipt.before.settingsVersion,safeBump.after.settings.version);assert.equal(confirmed.receipt.after.settingsVersion,safeBump.after.settings.version);
        assert.equal(confirmed.receipt.before.channelVersion,intent.command.expectedChannelVersion);assert.equal(confirmed.receipt.after.channelVersion,intent.command.expectedChannelVersion+1);
        assert.equal(confirmed.receipt.before.channelEnabled,true);assert.equal(confirmed.receipt.after.channelEnabled,false);
        assert.deepEqual({...confirmed.receipt.after,channelVersion:confirmed.receipt.before.channelVersion,channelEnabled:true},confirmed.receipt.before);
        assert.equal(after.setup.length,state.setup.length+1);assert.deepEqual(after.setup.find(row=>row.operation_id===intent.command.operationId).command,intent.command);
        assert.equal(after.settings.location_channel_version,state.settings.location_channel_version+1);assert.equal(after.settings.location_clock_enabled,false);
        assert.deepEqual({...after.settings,location_clock_enabled:state.settings.location_clock_enabled,location_channel_version:state.settings.location_channel_version,updated_at:state.settings.updated_at},state.settings);
        for(const key of ['drafts','notices','locations','config'])assert.deepEqual(after[key],state[key]);
      }else{
        assert.equal(confirmed.receipt.operationId,intent.command.operationId);assert.equal(confirmed.receipt.action,'withdraw');assert.equal(confirmed.receipt.revision,intent.command.expectedRevision+1);
        assert.equal(confirmed.receipt.draftRevision,null);assert.equal(confirmed.current.action,'withdraw');assert.equal(after.notices.length,state.notices.length+1);
        assert.deepEqual(after.notices.find(row=>row.operation_id===intent.command.operationId).command,intent.command);
        for(const key of ['drafts','setup','settings','locations','config'])assert.deepEqual(after[key],state[key]);
      }
      for(const key of ['setup','notices'])immutable(state[key],after[key]);keep();
      pass(`actual ${kind==='setup'?'pause':'withdraw'} unsent command survives settings-only advance: paused original-ID GET retains exact pending; explicit retry GET plus original POST with identical parsed payload commits once, preserving other journals and original facts`);
    }
    assert.equal(configIds.length,3);assert.equal(new Set(configIds).size,3);assert.equal(config().length,before.config.length+3);
    assert.equal(settings().version,before.settings.version+3);assert.equal(settings().location_clock_enabled,false);
    assert.equal(settings().location_channel_version,before.settings.location_channel_version+2);
    assert.deepEqual({...settings(),version:before.settings.version,location_channel_version:before.settings.location_channel_version,updated_at:before.settings.updated_at},before.settings);
    assert.equal(drafts().length,8);assert.equal(notices().length,6);assert.equal(setup().length,11);
    assert.deepEqual(writes('policy').slice(counts.policy).map(r=>r.status),[null,409,200,200]);
    assert.deepEqual(writes('notice').slice(counts.notice).map(r=>r.status),[null,409,200,null,200]);
    assert.deepEqual(writes('setup').slice(counts.setup).map(r=>r.status),[200,null,200]);
    await step(owner,'policy');await step(phone,'setup');keep();
    return {configCountBefore:before.config.length,configCountAfter:config().length,configWritesAdded:3,configOperationIds:configIds,
      settingsVersionBefore:before.settings.version,settingsVersionAfter:settings().version,locationRowsUnchanged:true};
  } finally {
    control.unsent=null;control.lose=null;transport.state.moduleEnabled=wasEnabled;control.acceptDialogs=priorDialogs;
    if(configPage)await configPage.context().close();
  }
}
