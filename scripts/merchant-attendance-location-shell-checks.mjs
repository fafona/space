// Opt-in owner-location acceptance inside the existing isolated merchant shell.
// This module creates no server/database and never samples employee geolocation.
// Explicit UI writes use the real handlers/SQL; only module admission and owner
// revocation are controlled fixture state. Employee ACK/device/punch flows are
// deliberately outside this owner-settings acceptance.
import assert from 'node:assert/strict';

export async function checkAttendanceLocationShell({owner,phone,newPage,openOwner,admin,exec,transport,requests,pass,origin,site,actors,id,control,holdLocationSettingsResponse}) {
  assert.equal(site,'99990001');
  const endpoints=Object.fromEntries(['policy','setup','notice'].map(kind=>[kind,`/api/merchant-enterprise/attendance/location-${kind}`]));
  const labels={policy:'定位政策草稿',setup:'负责人定位策略设置',notice:'定位政策告知'};
  const steps={policy:/^1 · 政策草稿/,setup:/^2 \/ 4 · 围栏与通路/,notice:/^3 · 发布告知/};
  const actions={prepare:'应用草稿围栏',enable:'启用企业定位通路',pause:'暂停企业定位通路'};
  const workspace=page=>page.getByRole('region',{name:'地点定位工作区',exact:true});
  const panel=(page,kind)=>page.getByRole('region',{name:labels[kind],exact:true});
  const rows=table=>JSON.parse(exec(`select coalesce(jsonb_agg(to_jsonb(t) order by operation_id),'[]'::jsonb) from public.${table} t where merchant_id='${site}';`));
  const config=()=>rows('merchant_attendance_config_operations');
  const drafts=()=>rows('merchant_attendance_location_policy_drafts').sort((a,b)=>a.revision-b.revision);
  const notices=()=>rows('merchant_attendance_location_notices').sort((a,b)=>a.revision-b.revision);
  const setup=()=>rows('merchant_attendance_location_setup_operations');
  const settings=()=>JSON.parse(exec(`select to_jsonb(t) from public.merchant_attendance_settings t where merchant_id='${site}';`));
  const locations=JSON.parse(exec(`select jsonb_agg(to_jsonb(t) order by id) from public.merchant_attendance_locations t where merchant_id='${site}';`));
  assert.equal(locations.length,1);const locationId=locations[0].id;
  assert.match(locationId,/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  const location=()=>JSON.parse(exec(`select to_jsonb(t) from public.merchant_attendance_locations t where merchant_id='${site}' and id='${locationId}';`));
  const keys={policy:`faolla:attendance:location-policy:v1:${site}:${actors[0].id}:${locationId}`,setup:`faolla:attendance:location-setup:v1:${site}:${actors[0].id}`,notice:`faolla:attendance:notice:v1:${site}:owner:${actors[0].id}`};
  const pending=(page,kind)=>page.evaluate(key=>sessionStorage.getItem(key),keys[kind]);
  const writes=kind=>requests.filter(r=>Object.values(endpoints).includes(r.path)&&r.method==='POST'&&(!kind||r.path===endpoints[kind]));
  const setupCalls=()=>transport.calls.filter(c=>c.name==='faolla_attendance_location_setup_v1');
  const protectedFacts=()=>exec(`select jsonb_build_object(
    'events',(select md5(coalesce(jsonb_agg(to_jsonb(t) order by merchant_id,worker_id,sequence)::text,'[]')) from public.merchant_attendance_events t),
    'workers',(select md5(coalesce(jsonb_agg(to_jsonb(t) order by merchant_id,id)::text,'[]')) from public.merchant_attendance_workers t),
    'scopes',(select md5(coalesce(jsonb_agg(to_jsonb(t) order by merchant_id,employee_id)::text,'[]')) from public.merchant_attendance_scopes t),
    'grants',(select md5(coalesce(jsonb_agg(to_jsonb(t) order by merchant_id,employee_id,id)::text,'[]')) from public.merchant_attendance_scope_grants t),
    'scopeWorkers',(select md5(coalesce(jsonb_agg(to_jsonb(t) order by merchant_id,employee_id,grant_id,worker_id)::text,'[]')) from public.merchant_attendance_scope_workers t),
    'scopeLocations',(select md5(coalesce(jsonb_agg(to_jsonb(t) order by merchant_id,employee_id,grant_id,location_id)::text,'[]')) from public.merchant_attendance_scope_locations t),
    'scopeOperations',(select md5(coalesce(jsonb_agg(to_jsonb(t) order by merchant_id,operation_id)::text,'[]')) from public.merchant_attendance_scope_operations t),
    'acknowledgements',(select count(*) from public.merchant_attendance_location_notice_acknowledgements),
    'locationResults',(select count(*) from public.merchant_attendance_location_results));`);
  const originalConfig=config(),baseline=protectedFacts(),wasEnabled=transport.state.moduleEnabled;
  assert.equal(originalConfig.length,4);assert.deepEqual(drafts(),[]);assert.deepEqual(notices(),[]);assert.deepEqual(setup(),[]);
  const preserved=()=>{
    assert.equal(protectedFacts(),baseline,'owner_location_changed_protected_employee_or_scope_facts');
    const current=config();for(const old of originalConfig)assert.deepEqual(current.find(row=>row.operation_id===old.operation_id),old,'prior_config_receipt_rewritten');
    assert.equal(exec('select count(*) from public.merchant_attendance_events;'),'0');
    assert.equal(exec('select count(*) from public.merchant_attendance_location_notice_acknowledgements;'),'0');
  };
  const immutable=(before,after)=>{for(const old of before)assert.deepEqual(after.find(row=>row.operation_id===old.operation_id),old,'location_receipt_rewritten');};
  const done=(page,kind,method='GET',status=200)=>page.waitForResponse(r=>new URL(r.url()).pathname===endpoints[kind]&&r.request().method()===method&&r.status()===status);
  const visibleResult=async(page,kind,value)=>{
    if(kind==='policy')await panel(page,kind).getByRole('textbox',{name:'定位用途',exact:true}).waitFor();
    else if(kind==='setup')await panel(page,kind).getByRole('heading',{name:`企业定位通路 · 开关版本 ${value.channelVersion}`,exact:true}).waitFor();
    else await panel(page,kind).getByRole('heading',{name:`${value.location.name} · ${value.current?`告知版本 ${value.current.revision}`:'尚未发布告知'}`,exact:true}).waitFor();
  };
  const consume=async(page,kind,response)=>{const value=await (await response).json();assert.equal(value.ok,true);await visibleResult(page,kind,value);return value;};
  const step=async(page,kind,{discard=false}={})=>{
    const response=done(page,kind);await workspace(page).getByRole('button',{name:steps[kind]}).click();
    if(discard)await workspace(page).getByRole('button',{name:'放弃未保存输入并继续',exact:true}).click();
    return consume(page,kind,response);
  };
  const open=async(page,kind='policy')=>{
    await admin(page).getByRole('button',{name:'工作地点',exact:true}).click();
    const response=done(page,kind);await admin(page).getByText(locations[0].name,{exact:true}).locator('../..').getByRole('button',{name:'定位政策与围栏',exact:true}).click();return consume(page,kind,response);
  };
  const reload=async(page,kind)=>{
    const response=done(page,kind);await panel(page,kind).getByRole('button',{name:kind==='policy'?'重新读取／核对保存':'重新读取／核对收据',exact:true}).click();return consume(page,kind,response);
  };
  const fullRefresh=async(page)=>{
    await page.reload();await page.getByRole('button',{name:'企业管理',exact:true}).click();await page.getByRole('button',{name:'考勤配置',exact:true}).click();return open(page,'setup');
  };
  const values={purpose:'合成验收：到店考勤用途',notice:'仅用于本地候选验收，不采集员工位置',contact:'合成负责人',alternative:'无法提供位置时联系负责人核查登记',latitude:40.4168,longitude:-3.7038,radiusMeters:120,retentionDays:30};
  const fillPolicy=async(page,overrides={})=>{
    const v={...values,...overrides};
    for(const [key,label] of Object.entries({purpose:'定位用途',notice:'补充告知',contact:'咨询／核查联系人',alternative:'无法提供位置时的替代登记说明'}))await panel(page,'policy').getByRole('textbox',{name:label,exact:true}).fill(v[key]);
    for(const [key,label] of Object.entries({latitude:'拟定地点纬度',longitude:'拟定地点经度',radiusMeters:'拟定范围半径（米）',retentionDays:'拟定定位摘要保留天数'}))await panel(page,'policy').getByRole('spinbutton',{name:label,exact:true}).fill(String(v[key]));
    await panel(page,'policy').getByRole('checkbox',{name:/^我理解这里只保存政策草稿/}).check();
  };
  const savePolicy=async(page,status=200)=>{
    const response=done(page,'policy','POST',status);await panel(page,'policy').getByRole('button',{name:'保存草稿 · 不启用定位',exact:true}).click();const value=await (await response).json();
    if(status===200){await panel(page,'policy').getByRole('status').filter({hasText:'草稿保存已确认'}).waitFor();const stored=drafts().find(row=>row.operation_id===value.receipt.operationId);assert(stored);assert.deepEqual(stored.command.values,value.current.values);assert.equal(stored.revision,value.receipt.revision);assert.equal(await pending(page,'policy'),null);}
    return value;
  };
  const setupIntent=async(page,action,reason)=>{
    await panel(page,'setup').getByRole('combobox',{name:/^操作/}).selectOption(action);
    await panel(page,'setup').getByRole('textbox',{name:/^内部操作说明/}).fill(reason);
    await panel(page,'setup').getByRole('checkbox',{name:/^我已核对影响范围/}).check();
  };
  const saveSetup=async(page,action)=>{
    const response=done(page,'setup','POST');await panel(page,'setup').getByRole('button',{name:actions[action],exact:true}).click();const value=await (await response).json();
    await panel(page,'setup').getByRole('status').filter({hasText:'服务器已确认原操作'}).waitFor();await visibleResult(page,'setup',value);
    const stored=setup().find(row=>row.operation_id===value.receipt.command.operationId);assert(stored);assert.deepEqual(stored.command,value.receipt.command);assert.deepEqual(stored.before_value,value.receipt.before);assert.deepEqual(stored.after_value,value.receipt.after);assert.equal(stored.actor_auth_user_id,actors[0].id);assert.equal(await pending(page,'setup'),null);return value;
  };
  const uncertain=async page=>{
    await panel(page,'setup').getByRole('status').filter({hasText:'未能确认结果或访问权限'}).waitFor();const raw=await pending(page,'setup');assert(raw);
    assert(await workspace(page).getByRole('button',{name:'返回工作地点',exact:true}).isDisabled());
    for(const name of Object.values(steps))assert(await workspace(page).getByRole('button',{name}).isDisabled());return JSON.parse(raw);
  };
  let ownerChanged=false,noticePage=null;
  try {
    transport.state.moduleEnabled=true;
    await admin(owner).getByRole('button',{name:'考勤设置',exact:true}).click();
    await admin(owner).getByRole('checkbox',{name:/^启用企业考勤/}).check();await admin(owner).getByRole('checkbox',{name:/^允许普通网页打卡/}).check();
    const settingsResponse=owner.waitForResponse(r=>new URL(r.url()).pathname==='/api/merchant-enterprise/attendance/admin'&&r.request().method()==='POST'&&r.status()===200);
    await admin(owner).getByRole('button',{name:'保存考勤设置',exact:true}).click();await (await settingsResponse).json();
    assert.equal(settings().enabled,true);assert.equal(settings().web_clock_enabled,true);assert.equal(config().length,5);
    const empty=await open(owner);assert.equal(empty.current,null);assert.equal(empty.receipt,null);assert.equal(writes().length,0);
    await panel(owner,'policy').getByRole('textbox',{name:'定位用途',exact:true}).fill('合成未保存输入');
    await workspace(owner).getByRole('button',{name:steps.setup}).click();await workspace(owner).getByRole('alert').filter({hasText:'是否放弃尚未保存的输入'}).waitFor();
    await workspace(owner).getByRole('button',{name:'继续编辑',exact:true}).click();assert.equal(await panel(owner,'policy').getByRole('textbox',{name:'定位用途',exact:true}).inputValue(),'合成未保存输入');
    const noDraft=await step(owner,'setup',{discard:true});assert.equal(noDraft.draft,null);assert.equal(noDraft.location.fence,null);assert.equal(noDraft.channelEnabled,false);assert.equal(noDraft.canEnable,false);
    await step(owner,'policy');assert.equal(await panel(owner,'policy').getByRole('textbox',{name:'定位用途',exact:true}).inputValue(),'');assert.equal(writes().length,0);preserved();
    pass('actual owner location workspace reads without drafts/writes; explicit basic-settings enable adds one config receipt, while cancel/discard step guards preserve or discard only unsaved input');

    const beforeLocation=location(),beforeSettings=settings();await fillPolicy(owner);const first=await savePolicy(owner);assert.equal(first.current.revision,1);assert.equal(first.draftOnly,true);
    assert.deepEqual(location(),beforeLocation);assert.deepEqual(settings(),beforeSettings);assert.deepEqual(notices(),[]);assert.deepEqual(setup(),[]);const originalDrafts=drafts();
    const preparation=await step(owner,'setup');assert.equal(preparation.canPrepare,true);assert.equal(preparation.canEnable,false);assert.equal(preparation.noticeMatches,false);
    await setupIntent(owner,'prepare','合成验收：明确应用草稿围栏');const prepared=await saveSetup(owner,'prepare');
    assert.equal(prepared.channelEnabled,false);assert.equal(prepared.location.version,beforeLocation.version+1);assert.equal(prepared.draft.revision,2);assert.equal(prepared.draft.locationVersion,prepared.location.version);assert.equal(prepared.settingsVersion,beforeSettings.version);
    assert.deepEqual(prepared.location.fence,{latitude:values.latitude,longitude:values.longitude,radiusMeters:values.radiusMeters});assert.deepEqual(prepared.draft.values,values);
    assert.equal(drafts()[1].operation_id,prepared.receipt.command.operationId);immutable(originalDrafts,drafts());assert.equal(notices().length,0);assert.equal(setup().length,1);assert.equal(config().length,5);preserved();
    pass('draft save changes no runtime settings; explicit fence preparation appends its own receipt and same-UUID rebased draft, preserving the old draft without publication, channel enable or employee acknowledgement');

    const beforePublish=settings(),unpublished=await step(owner,'notice');assert.equal(unpublished.current,null);assert.equal(unpublished.draft.revision,prepared.draft.revision);assert.equal(unpublished.canPublish,true);assert.equal(unpublished.canAcknowledge,false);assert.equal(unpublished.acknowledgedAt,null);
    await panel(owner,'notice').getByRole('combobox',{name:/^操作/}).selectOption('publish');await panel(owner,'notice').getByRole('textbox',{name:/^操作说明/}).fill('合成验收：公开当前已核对的政策告知');await panel(owner,'notice').getByRole('checkbox',{name:/^我确认向员工公开下方草稿/}).check();
    const publishedResponse=done(owner,'notice','POST');await panel(owner,'notice').getByRole('button',{name:'发布告知版本',exact:true}).click();const published=await (await publishedResponse).json();await panel(owner,'notice').getByRole('status').filter({hasText:'操作已确认'}).waitFor();
    assert.equal(published.current.action,'publish');assert.equal(published.current.draftRevision,prepared.draft.revision);assert.equal(published.noticeCurrent,true);assert.equal(published.acknowledgedAt,null);assert.equal(published.operationalChanged,false);assert.equal('latitude' in published.current.values,false);assert.equal('longitude' in published.current.values,false);
    assert.equal(notices()[0].operation_id,published.receipt.operationId);assert.deepEqual(settings(),beforePublish);assert.equal(await pending(owner,'notice'),null);
    const ready=await step(owner,'setup');assert.equal(ready.noticeMatches,true);assert.equal(ready.canEnable,true);await setupIntent(owner,'enable','合成验收：单独启用企业定位通路');const enabled=await saveSetup(owner,'enable');
    assert.equal(enabled.channelEnabled,true);assert.equal(enabled.channelVersion,ready.channelVersion+1);assert.equal(enabled.settingsVersion,ready.settingsVersion);assert.deepEqual(enabled.location,ready.location);assert.equal(setup().length,2);preserved();
    pass('owner explicitly publishes the rebased draft then separately enables the matching enterprise channel; public notice omits coordinates, zero employee ACKs/events are created, and publication alone never activates the channel');

    const phoneDraft=await open(phone);assert.equal(phoneDraft.current.revision,2);await step(owner,'policy');await fillPolicy(owner,{purpose:'合成验收：负责人更新用途草稿'});const winning=await savePolicy(owner);assert.equal(winning.current.revision,3);
    await fillPolicy(phone,{purpose:'合成验收：过期手机草稿不得覆盖'});const beforeConflict=drafts(),conflict=await savePolicy(phone,409);assert.equal(conflict.error,'attendance_version_conflict');
    await panel(phone,'policy').getByRole('status').filter({hasText:'配置已被修改'}).waitFor();assert.equal(await pending(phone,'policy'),null);assert.deepEqual(drafts(),beforeConflict);assert.equal(writes('policy').at(-1).body.expectedRevision,phoneDraft.current.revision);
    await reload(phone,'policy');await step(phone,'setup',{discard:true});assert.equal(notices().length,1);assert.equal(notices()[0].draft_revision,2);assert.equal(settings().location_clock_enabled,true);preserved();
    pass('two actual owner contexts enforce draft revision CAS: stale mobile save rejects409 and clears its rejected intent without overwriting the winning draft or silently replacing the published notice');

    await step(owner,'setup');await setupIntent(owner,'pause','合成验收：为响应丢失场景明确暂停');const paused=await saveSetup(owner,'pause');assert.equal(paused.channelEnabled,false);await reload(phone,'setup');
    await setupIntent(owner,'enable','合成验收：提交已完成但响应丢失');const beforeLost=writes('setup').length;control.lose=endpoints.setup;await panel(owner,'setup').getByRole('button',{name:actions.enable,exact:true}).click();const lost=await uncertain(owner);
    assert.equal(control.lose,null);assert.equal(setup().length,4);assert.equal(settings().location_clock_enabled,true);assert.equal(writes('setup').length,beforeLost+1);assert.equal(writes('setup').at(-1).fault,'after-sql');
    const lostRow=setup().find(row=>row.operation_id===lost.command.operationId);assert(lostRow);assert.deepEqual(lostRow.command,lost.command);
    await reload(phone,'setup');await setupIntent(phone,'pause','合成验收：另一上下文明确暂停最新通路');const newer=await saveSetup(phone,'pause');assert.equal(newer.channelEnabled,false);assert.equal(setup().length,5);
    const beforeRefresh=writes().length,recovered=await fullRefresh(owner);assert.equal(recovered.receipt.command.operationId,lost.command.operationId);assert.equal(recovered.receipt.command.action,'enable');assert.equal(recovered.receipt.after.channelEnabled,true);assert.equal(recovered.channelEnabled,false);assert.equal(recovered.channelVersion,newer.channelVersion);assert.equal(await pending(owner,'setup'),null);assert.equal(writes().length,beforeRefresh);
    assert(setupCalls().some(call=>call.command===null&&call.operationId===lost.command.operationId));assert.equal(settings().location_clock_enabled,false);assert.equal(setup().length,5);preserved();
    pass('enable reply lost AFTER actual SQL commit recovers after full merchant-shell refresh using original-operation GET; a second context already paused, so the old successful receipt neither reenables nor repeats POST');

    await setupIntent(owner,'enable','合成验收：未送达命令必须明确原编号重试');const beforeUnsent=writes('setup').length,callsBeforeUnsent=setupCalls().length;control.unsent=endpoints.setup;
    await panel(owner,'setup').getByRole('button',{name:actions.enable,exact:true}).click();const unsent=await uncertain(owner);assert.equal(control.unsent,null);assert.equal(setupCalls().length,callsBeforeUnsent);assert.equal(setup().length,5);const raw=await pending(owner,'setup');
    const readOnlyRestore=await fullRefresh(owner);assert.equal(readOnlyRestore.receipt,null);assert.equal(await pending(owner,'setup'),raw);assert.equal(writes('setup').length,beforeUnsent+1);assert.equal(setup().length,5);
    const explicitStart=requests.length,retryResponse=done(owner,'setup','POST');await panel(owner,'setup').getByRole('button',{name:'原编号重试',exact:true}).click();const retried=await (await retryResponse).json();await panel(owner,'setup').getByRole('status').filter({hasText:'服务器已确认原操作'}).waitFor();
    const retryRequests=requests.slice(explicitStart).filter(r=>r.path===endpoints.setup);assert.deepEqual(retryRequests.map(r=>r.method),['GET','POST']);assert.equal(retryRequests[0].query.operationId,unsent.command.operationId);assert.deepEqual(writes('setup').slice(beforeUnsent).map(r=>r.body),[{siteId:site,locationId,...unsent.command},{siteId:site,locationId,...unsent.command}]);
    assert.equal(writes('setup')[beforeUnsent].fault,'before-handler');assert.deepEqual(retried.receipt.command,unsent.command);assert.equal(retried.channelEnabled,true);assert.equal(await pending(owner,'setup'),null);assert.equal(setup().length,6);preserved();
    pass('request aborted BEFORE handler/SQL retains original setup intent and refresh performs only GET; explicit retry checks that UUID then sends exactly the original command once, appending one receipt');

    transport.state.moduleEnabled=false;const beforePausedWrites=writes().length,pausedDraft=await step(owner,'policy');assert.equal(pausedDraft.moduleEnabled,false);assert(await panel(owner,'policy').getByRole('textbox',{name:'定位用途',exact:true}).isDisabled());assert(await panel(owner,'policy').getByRole('button',{name:'保存草稿 · 不启用定位',exact:true}).isDisabled());
    const pausedNotice=await step(owner,'notice');assert.equal(pausedNotice.moduleEnabled,false);assert.equal(pausedNotice.canPublish,false);assert.equal(pausedNotice.canWithdraw,true);
    // Playwright's label retargeting can inspect the enabled SELECT for an
    // OPTION; check this option's native disabled property and selector instead.
    assert(await panel(owner,'notice').locator('option[value="publish"]').evaluate(option=>option instanceof HTMLOptionElement&&option.disabled&&option.matches(':disabled')));
    const pausedSetup=await step(owner,'setup');assert.equal(pausedSetup.moduleEnabled,false);assert.equal(pausedSetup.canPrepare,false);assert.equal(pausedSetup.canEnable,false);assert.equal(pausedSetup.canPause,true);assert.equal(writes().length,beforePausedWrites);
    await setupIntent(owner,'pause','合成验收：平台暂停期间仍可关闭定位通路');const safePause=await saveSetup(owner,'pause');assert.equal(safePause.moduleEnabled,false);assert.equal(safePause.channelEnabled,false);assert.equal(writes().length,beforePausedWrites+1);assert.equal(setup().length,7);
    const mobilePaused=await reload(phone,'setup');assert.equal(mobilePaused.moduleEnabled,false);assert.equal(mobilePaused.canPause,false);assert.equal(await panel(phone,'setup').locator('form').count(),0);assert(await phone.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.equal(drafts().length,3);assert.equal(notices().length,1);preserved();
    pass('paused module still reads all owner steps and390px shell, disables new draft/publication/preparation/enable in UI, yet an explicitly confirmed channel pause remains a real successful SQL write; notice withdrawal remains available but is not exercised');

    const {checkLocationSettingsRecoveryShell}=await import('./merchant-attendance-location-recovery-shell-checks.mjs');
    await checkLocationSettingsRecoveryShell({owner,admin,transport,requests,pass,site,locationId,control,holdLocationSettingsResponse,
      endpoints,workspace,panel,pending,writes,drafts,notices,setup,settings,location,config,preserved,immutable,open,step,fillPolicy});

    const {checkLocationCrossRecoveryShell}=await import('./merchant-attendance-location-cross-recovery-shell-checks.mjs');
    const locationProof=await checkLocationCrossRecoveryShell({owner,admin,exec,transport,requests,pass,site,actors,id,locationId,control,holdLocationSettingsResponse,
      endpoints,workspace,panel,pending,writes,drafts,notices,setup,settings,location,config,preserved,immutable,step,fillPolicy,setupIntent,saveSetup});

    const {checkLocationVersionShell}=await import('./merchant-attendance-location-version-shell-checks.mjs');
    const versionProof=await checkLocationVersionShell({owner,phone,newPage,openOwner,admin,exec,transport,requests,pass,site,actors,locationId,control,
      endpoints,panel,pending,writes,drafts,notices,setup,settings,location,config,preserved,immutable,step,reload,fillPolicy,savePolicy,setupIntent,saveSetup});

    await step(owner,'policy');noticePage=await newPage();await openOwner(noticePage);await open(noticePage);await step(noticePage,'notice');
    const employee=await newPage({actor:actors[1]});try {
      await employee.goto(origin+'/harness.css');
      for(const kind of Object.keys(endpoints)){
        const url=endpoints[kind]+'?'+new URLSearchParams({siteId:site,locationId,...(kind==='notice'?{access:'owner'}:{})});
        const denied=await employee.evaluate(async url=>{const r=await fetch(url);return {status:r.status,body:await r.json()};},url);assert.equal(denied.status,403);assert.equal(denied.body.error,'attendance_access_denied');
        for(const key of ['current','draft','receipt','location','channelEnabled'])assert.equal(key in denied.body,false);
      }
    }finally {await employee.context().close();}
    const beforeRevocation={drafts:drafts(),notices:notices(),setup:setup(),settings:settings(),location:location()},beforeDenied=writes().length;
    ownerChanged=true;exec(`update public.merchants set user_id='${id(98)}',auth_user_id=null,owner_user_id=null,owner_id=null,auth_id=null,created_by=null,created_by_user_id=null where id='${site}';`);
    for(const [page,kind] of [[owner,'policy'],[phone,'setup'],[noticePage,'notice']]){
      const denied=done(page,kind,'GET',403);await panel(page,kind).getByRole('button',{name:kind==='policy'?'重新读取／核对保存':'重新读取／核对收据',exact:true}).click();const payload=await (await denied).json();assert.equal(payload.error,'attendance_access_denied');
      const message=kind==='policy'?'仅当前商户负责人可以管理考勤配置':kind==='setup'?'未能确认结果或访问权限':'暂时无法确认结果或访问权限';await panel(page,kind).getByRole('status').filter({hasText:message}).waitFor();
      assert.equal(await panel(page,kind).locator('form').count(),0);assert.equal(await panel(page,kind).getByText('合成验收：负责人更新用途草稿',{exact:true}).count(),0);
      if(kind==='setup')assert.equal(await panel(page,kind).getByRole('heading',{name:/^企业定位通路/}).count(),0);
      if(kind==='notice')assert.equal(await panel(page,kind).locator('details').count(),0);
    }
    assert.equal(writes().length,beforeDenied);assert.deepEqual({drafts:drafts(),notices:notices(),setup:setup(),settings:settings(),location:location()},beforeRevocation);assert.equal(config().length,versionProof.configCountAfter);preserved();
    pass('employee cannot request any owner location API; clearing all current owner aliases makes the next real GET403 hide draft/setup/notice details without new POSTs, rewritten receipts, ACKs or attendance events');
    return {...locationProof,versionProof};
  } finally {
    control.lose=null;control.unsent=null;transport.state.moduleEnabled=wasEnabled;
    if(ownerChanged)exec(`update public.merchants set user_id='${actors[0].id}' where id='${site}';`);
    if(noticePage)await noticePage.context().close();
  }
}
