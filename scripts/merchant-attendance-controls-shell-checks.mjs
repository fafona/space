// Opt-in scenarios for the existing audit/merchant-shell runner, never a new
// database, server, browser harness or production route. All writes are explicit
// real owner controls against that runner's ownership-checked synthetic schema.
import assert from 'node:assert/strict';

export async function checkAttendanceControlsShell({owner,phone,newPage,admin,exec,transport,requests,pass,origin,site,actors,id,control,holdControlsResponse}){
  const endpoint='/api/merchant-enterprise/attendance/correction-controls';
  const panel=page=>page.getByRole('region',{name:'补正规则与锁定配置',exact:true});
  const ledger=()=>JSON.parse(exec(`select coalesce(jsonb_agg(to_jsonb(t) order by revision),'[]'::jsonb) from public.merchant_attendance_correction_controls t where merchant_id='${site}';`));
  const periods=()=>JSON.parse(exec(`select coalesce(jsonb_agg(to_jsonb(t) order by period_id),'[]'::jsonb) from public.merchant_attendance_correction_periods t where merchant_id='${site}';`));
  const writes=()=>requests.filter(r=>r.path===endpoint&&r.method==='POST');
  const rpcCalls=()=>transport.calls.filter(c=>c.name==='faolla_attendance_correction_controls_v2');
  const key=`faolla:attendance:correction-controls:v1:${site}:${actors[0].id}`;
  const pending=page=>page.evaluate(key=>sessionStorage.getItem(key),key);
  const unchanged=()=>exec(`select jsonb_build_object(
    'events',(select md5(coalesce(jsonb_agg(to_jsonb(t) order by merchant_id,worker_id,sequence)::text,'[]')) from public.merchant_attendance_events t),
    'settings',(select md5(coalesce(jsonb_agg(to_jsonb(t) order by merchant_id)::text,'[]')) from public.merchant_attendance_settings t),
    'config',(select md5(coalesce(jsonb_agg(to_jsonb(t) order by merchant_id,operation_id)::text,'[]')) from public.merchant_attendance_config_operations t),
    'scope',(select md5(coalesce(jsonb_agg(to_jsonb(t) order by merchant_id,employee_id,operation_id)::text,'[]')) from public.merchant_attendance_scope_operations t));`);
  const baseline=unchanged(),wasEnabled=transport.state.moduleEnabled;
  const configRows=()=>JSON.parse(exec(`select coalesce(jsonb_agg(to_jsonb(t) order by version),'[]'::jsonb) from public.merchant_attendance_config_operations t where merchant_id='${site}';`));
  const settingsRow=()=>JSON.parse(exec(`select to_jsonb(t) from public.merchant_attendance_settings t where merchant_id='${site}';`));
  const protectedTables=['merchant_attendance_events','merchant_attendance_workers','merchant_attendance_locations','merchant_attendance_scopes','merchant_attendance_scope_grants','merchant_attendance_scope_workers','merchant_attendance_scope_locations','merchant_attendance_scope_operations'];
  const protectedFacts=()=>exec(`select jsonb_build_object(${protectedTables.map(table=>`'${table}',(select md5(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text)::text,'[]')) from public.${table} t)`).join(',')});`);
  const originalProtectedFacts=protectedFacts();
  let ownerChanged=false;
  const atRevision=async(page,revision)=>{await panel(page).getByText(new RegExp('^当前配置版本 '+revision+' ·')).waitFor();};
  const open=async(page,revision)=>{
    const done=page.waitForResponse(r=>r.url().includes(endpoint+'?')&&r.request().method()==='GET'&&r.status()===200);
    await admin(page).getByRole('button',{name:'补正规则／锁定配置',exact:true}).click();const response=await done;const value=await response.json();
    assert.equal(value.rulesEnforced,true);assert.equal(value.controlsOnly,true);assert.equal(value.approvalAvailable,false);
    await atRevision(page,revision);return value;
  };
  const reload=async(page,revision)=>{
    const done=page.waitForResponse(r=>r.url().includes(endpoint+'?')&&r.request().method()==='GET'&&r.status()===200);
    await panel(page).getByRole('button',{name:'重新读取／查原收据',exact:true}).click();const response=await done;const value=await response.json();await atRevision(page,revision);return value;
  };
  const reasonAndAck=async(page,reason)=>{
    await panel(page).getByRole('textbox',{name:/^变更理由/}).fill(reason);
    await panel(page).getByRole('checkbox',{name:/^已核对范围与理由/}).check();
  };
  const policy=async(page,days,reason)=>{
    await panel(page).getByRole('combobox',{name:/^配置操作/}).selectOption('set_policy');
    await panel(page).getByRole('spinbutton',{name:/^原始上班日期后可提交天数/}).fill(String(days));await reasonAndAck(page,reason);
  };
  const lock=async(page,fromDate='2026-03-28',throughDate='2026-03-29')=>{
    await panel(page).getByRole('combobox',{name:/^配置操作/}).selectOption('lock_period');
    await panel(page).getByLabel('锁定开始日期',{exact:true}).fill(fromDate);await panel(page).getByLabel('锁定结束日期（含）',{exact:true}).fill(throughDate);
    await reasonAndAck(page,'合成验收：锁定已结束的周期');
  };
  const unlock=async(page,periodId)=>{
    await panel(page).getByRole('combobox',{name:/^配置操作/}).selectOption('unlock_period');
    await panel(page).getByRole('combobox',{name:/^选择需要解锁的周期/}).selectOption(periodId);await reasonAndAck(page,'合成验收：明确解锁原周期');
  };
  const save=async(page,label,status=200)=>{
    const done=page.waitForResponse(r=>r.url().endsWith(endpoint)&&r.request().method()==='POST'&&r.status()===status);
    await panel(page).getByRole('button',{name:label,exact:true}).click();const response=await done;const value=await response.json();
    if(status===200){await atRevision(page,value.revision);const stored=ledger().find(entry=>entry.operation_id===value.receipt.operationId);assert(stored);assert.equal(stored.revision,value.receipt.revision);assert.equal(stored.action,value.receipt.action);assert.equal(stored.reason,value.receipt.reason);assert.equal(stored.actor_auth_user_id,actors[0].id);}
    return value;
  };
  const uncertain=async page=>{await panel(page).getByRole('status').filter({hasText:'未能确认结果'}).waitFor();const raw=await pending(page);assert(raw);return JSON.parse(raw);};
  const fullRefresh=async(page,revision)=>{
    await page.reload();await page.getByRole('button',{name:'企业管理',exact:true}).click();await page.getByRole('button',{name:'考勤配置',exact:true}).click();return open(page,revision);
  };
  const preservePrior=(before,after)=>assert.deepEqual(after.slice(0,before.length),before,'old_controls_receipts_rewritten');
  try{
    transport.state.moduleEnabled=true;assert.deepEqual(ledger(),[]);assert.deepEqual(periods(),[]);
    const empty=await open(owner,0);assert.equal(empty.policy,null);assert.deepEqual(empty.entries,[]);assert.deepEqual(empty.activePeriods,[]);assert.equal(writes().length,0);
    await policy(owner,7,'合成未保存草稿');control.acceptDialogs=false;await panel(owner).getByRole('button',{name:'返回考勤管理',exact:true}).click();
    assert.equal(await panel(owner).getByRole('textbox',{name:/^变更理由/}).inputValue(),'合成未保存草稿');assert.equal(writes().length,0);
    control.acceptDialogs=true;await panel(owner).getByRole('button',{name:'返回考勤管理',exact:true}).click();assert.equal(await panel(owner).count(),0);await open(owner,0);
    assert.equal(await panel(owner).getByRole('textbox',{name:/^变更理由/}).inputValue(),'');assert.deepEqual(ledger(),[]);assert.equal(unchanged(),baseline);
    pass('actual owner controls entry is read-only with no invented policy; cancel preserves an unsaved draft and explicit leave discards it without any POST');

    await policy(owner,7,'合成验收：七个自然日');const first=await save(owner,'确认设置申请期限');assert.equal(first.revision,1);assert.equal(first.policy.values.submissionWindowDays,7);assert.equal(first.policy.values.timeZone,'Europe/Madrid');
    await lock(owner);const locked=await save(owner,'确认锁定周期');assert.equal(locked.revision,2);assert.equal(locked.activePeriods.length,1);const firstLock=locked.receipt.operationId;
    assert.equal(locked.activePeriods[0].periodId,firstLock);assert.equal(locked.activePeriods[0].startAt,'2026-03-27T23:00:00.000000Z');assert.equal(locked.activePeriods[0].endAt,'2026-03-29T22:00:00.000000Z');
    assert.equal(exec(`select extract(epoch from end_at-start_at)/3600 from public.merchant_attendance_correction_periods where merchant_id='${site}' and period_id='${firstLock}';`).replace(/\.0+$/,''),'47');assert.equal(ledger().length,2);assert.equal(unchanged(),baseline);
    pass('explicit reason/acknowledgement saves policy and a Madrid DST period through the real v2 handler/SQL; inclusive March28-29 maps to its exact 47-hour UTC range');

    await open(phone,2);await policy(owner,8,'合成验收：更新八个自然日');await save(owner,'确认设置申请期限');await policy(phone,9,'合成验收：旧页面不得覆盖新规则');
    const conflict=await save(phone,'确认设置申请期限',409);assert.equal(conflict.error,'attendance_version_conflict');await panel(phone).getByRole('status').filter({hasText:'配置或规则版本已改变'}).waitFor();assert.equal(await pending(phone),null);assert.equal(ledger().length,3);assert.equal(writes().at(-1).body.expectedRevision,2);await reload(phone,3);
    pass('two real owner contexts enforce current revision: stale mobile save receives SQL409, clears only its rejected intent, and never overwrites the winning policy');

    for(const [from,through,error] of [['2026-03-29','2026-03-29','attendance_period_overlap'],['2099-01-01','2099-01-02','attendance_period_future']]){
      await lock(owner,from,through);const denied=await save(owner,'确认锁定周期',409);assert.equal(denied.error,error);assert.equal(ledger().length,3);await reload(owner,3);
    }
    const prior=ledger();await unlock(owner,firstLock);const unlocked=await save(owner,'确认解锁周期');assert.equal(unlocked.revision,4);assert.deepEqual(unlocked.activePeriods,[]);preservePrior(prior,ledger());assert.equal(periods().find(p=>p.period_id===firstLock).locked,false);assert.equal(unchanged(),baseline);
    pass('actual overlapping/future period submissions reject without audit rows; explicit unlock appends one receipt while preserving all earlier receipts and original attendance/settings/config/scope facts');

    await lock(owner);const countBeforeLost=writes().length;control.lose=endpoint;await panel(owner).getByRole('button',{name:'确认锁定周期',exact:true}).click();const lost=await uncertain(owner);
    assert.equal(control.lose,null);assert.equal(ledger().length,5);assert.equal(ledger().at(-1).operation_id,lost.command.operationId);assert.equal(writes().length,countBeforeLost+1);assert.equal(writes().at(-1).fault,'after-sql');
    await reload(phone,5);await unlock(phone,lost.command.operationId);const newer=await save(phone,'确认解锁周期');assert.equal(newer.revision,6);assert.deepEqual(newer.activePeriods,[]);
    const beforeRefresh=writes().length,restored=await fullRefresh(owner,6);assert.equal(restored.receipt.operationId,lost.command.operationId);assert.equal(restored.receipt.action,'lock_period');assert.deepEqual(restored.activePeriods,[]);assert.equal(await pending(owner),null);assert.equal(writes().length,beforeRefresh);assert.equal(ledger().length,6);
    assert(rpcCalls().some(call=>call.operationId===lost.command.operationId&&call.command===null));assert(periods().every(p=>!p.locked));assert.equal(unchanged(),baseline);
    pass('lock reply lost AFTER real SQL commit recovers by original-operation GET after full AdminClient refresh; another context already unlocked it, so old receipt never relocks or repeats POST');

    await policy(owner,11,'合成验收：未送达命令明确重试');const beforeUnsent=writes().length,callsBeforeUnsent=rpcCalls().length;control.unsent=endpoint;
    await panel(owner).getByRole('button',{name:'确认设置申请期限',exact:true}).click();const unsent=await uncertain(owner);assert.equal(control.unsent,null);assert.equal(ledger().length,6);assert.equal(rpcCalls().length,callsBeforeUnsent);
    const raw=await pending(owner);await fullRefresh(owner,6);assert.equal(await pending(owner),raw);assert.equal(writes().length,beforeUnsent+1);assert.equal(ledger().length,6);
    const explicitStart=requests.length,retryDone=owner.waitForResponse(r=>r.url().endsWith(endpoint)&&r.request().method()==='POST'&&r.status()===200);await panel(owner).getByRole('button',{name:'用原编号明确重试',exact:true}).click();await retryDone;await atRevision(owner,7);
    const retryRequests=requests.slice(explicitStart).filter(r=>r.path===endpoint);assert.deepEqual(retryRequests.map(r=>r.method),['GET','POST']);assert.equal(retryRequests[0].query.operationId,unsent.command.operationId);
    assert.deepEqual(writes().slice(beforeUnsent).map(r=>r.body),[{siteId:site,...unsent.command},{siteId:site,...unsent.command}]);assert.equal(writes()[beforeUnsent].fault,'before-handler');assert.equal(ledger().length,7);assert.equal(await pending(owner),null);assert.equal(unchanged(),baseline);
    pass('request lost BEFORE handler/SQL remains uncertain after refresh GET only; explicit retry checks receipt then sends identical original command/UUID and creates exactly one new receipt');

    transport.state.moduleEnabled=false;const beforePause=writes().length;const paused=await reload(owner,7);assert.equal(paused.moduleEnabled,false);await reload(phone,7);
    for(const page of [owner,phone]){assert(await panel(page).getByRole('combobox',{name:/^配置操作/}).isDisabled());assert(await panel(page).getByRole('button',{name:'确认设置申请期限',exact:true}).isDisabled());}
    assert.equal(writes().length,beforePause);assert.equal(ledger().length,7);assert(await phone.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.equal(unchanged(),baseline);
    pass('paused controls still read current history on desktop and390px actual merchant shell; all new policy/lock/unlock selection is disabled and no new POST occurs');

    // Extend only after the original core assertions. Settings writes below are
    // explicit UI operations with immutable receipts, not a relaxed baseline.
    const originalSettings=settingsRow(),originalConfig=configRows(),beforeSettingsControls=ledger(),beforeSettingsPeriods=periods();
    assert.equal(originalConfig.length,4);assert.equal(beforeSettingsControls.length,7);assert.equal(originalSettings.web_break_paid,false);
    const adminEndpoint='/api/merchant-enterprise/attendance/admin';
    const adminResponse=(method='GET')=>phone.waitForResponse(response=>{const url=new URL(response.url());return url.pathname===adminEndpoint&&response.request().method()===method&&response.status()===200
      &&(method==='POST'||url.searchParams.get('siteId')===site&&url.searchParams.get('view')==='settings');});
    const adminWritesBefore=requests.filter(request=>request.path===adminEndpoint&&request.method==='POST').length;
    transport.state.moduleEnabled=true;const oldSettingsView=await reload(owner,7);assert.equal(oldSettingsView.settingsVersion,originalSettings.version);
    await policy(owner,13,'合成验收：仅企业设置版本改变时拒绝旧规则命令');
    await panel(phone).getByRole('button',{name:'返回考勤管理',exact:true}).click();
    const settingsReady=adminResponse();await admin(phone).getByRole('button',{name:'考勤设置',exact:true}).click();
    const initialSettings=await(await settingsReady).json();assert.equal(initialSettings.moduleEnabled,true);assert.equal(initialSettings.version,originalSettings.version);
    const paid=()=>admin(phone).getByRole('checkbox',{name:/^休息计入计薪候选时长/});await paid().waitFor();assert.equal(await paid().isChecked(),false);
    const changePaid=async(value,before)=>{
      await paid().setChecked(value);const reply=adminResponse('POST');await admin(phone).getByRole('button',{name:'保存考勤设置',exact:true}).click();const saved=await(await reply).json();
      assert.equal(saved.ok,true);assert.equal(saved.version,before.version+1);assert.equal(saved.settings.webBreakPaid,value);assert.equal(saved.receipt.kind,'settings');
      await admin(phone).getByRole('status').filter({hasText:`保存已确认 · 配置版本 ${saved.version}`}).waitFor();
      const after=settingsRow();assert.equal(after.version,before.version+1);assert.deepEqual({...after,version:before.version,updated_at:before.updated_at},{...before,web_break_paid:value});
      const entry=configRows().find(row=>row.operation_id===saved.receipt.operationId);assert(entry);assert.equal(entry.actor_auth_user_id,actors[0].id);assert.equal(entry.version,saved.version);assert.equal(entry.command.kind,'settings');assert.equal(entry.command.expectedVersion,before.version);
      assert.deepEqual(entry.before_value,before);assert.deepEqual(entry.after_value,{timeZone:before.time_zone,enabled:before.enabled,webClockEnabled:before.web_clock_enabled,webBreakPaid:value});
      assert.deepEqual(entry.command.values,entry.after_value);assert.equal(protectedFacts(),originalProtectedFacts);return {saved,after};
    };
    const changedSettings=await changePaid(true,originalSettings);assert.deepEqual(ledger(),beforeSettingsControls);assert.deepEqual(periods(),beforeSettingsPeriods);
    const beforeSettingsReject=writes().length,settingsConflict=await save(owner,'确认设置申请期限',409);assert.equal(settingsConflict.error,'attendance_version_conflict');
    await panel(owner).getByRole('status').filter({hasText:'配置或规则版本已改变'}).waitFor();assert.equal(await pending(owner),null);
    assert.equal(writes().length,beforeSettingsReject+1);const rejectedSettingsCommand=writes().at(-1).body;
    assert.equal(rejectedSettingsCommand.expectedRevision,7);assert.equal(rejectedSettingsCommand.expectedSettingsVersion,originalSettings.version);
    assert(rpcCalls().some(call=>call.command?.operationId===rejectedSettingsCommand.operationId&&call.allowWrite===true));
    assert.deepEqual(ledger(),beforeSettingsControls);assert.deepEqual(periods(),beforeSettingsPeriods);
    const changedRead=await reload(owner,7);assert.equal(changedRead.settingsVersion,changedSettings.after.version);assert.equal(changedRead.revision,oldSettingsView.revision);assert.equal(changedRead.receipt,null);
    assert.equal(await panel(owner).getByRole('textbox',{name:/^变更理由/}).inputValue(),'');assert.equal(await panel(owner).getByRole('checkbox',{name:/^已核对范围与理由/}).isChecked(),false);
    const revertedSettings=await changePaid(originalSettings.web_break_paid,changedSettings.after),finalSettings=revertedSettings.after,finalConfig=configRows();
    assert.equal(finalSettings.version,originalSettings.version+2);assert.deepEqual({...finalSettings,version:originalSettings.version,updated_at:originalSettings.updated_at},originalSettings);
    assert.equal(finalConfig.length,originalConfig.length+2);assert.deepEqual(finalConfig.slice(0,originalConfig.length),originalConfig);
    assert.deepEqual(finalConfig.slice(-2).map(row=>row.operation_id),[changedSettings.saved.receipt.operationId,revertedSettings.saved.receipt.operationId]);
    assert.equal(requests.filter(request=>request.path===adminEndpoint&&request.method==='POST').length,adminWritesBefore+2);
    const restoredSettingsView=await reload(owner,7);assert.equal(restoredSettingsView.settingsVersion,finalSettings.version);await open(phone,7);
    assert.deepEqual(ledger(),beforeSettingsControls);assert.deepEqual(periods(),beforeSettingsPeriods);assert.equal(protectedFacts(),originalProtectedFacts);
    const verifiedNewBaseline=unchanged();
    pass('settings-only CAS: real mobile admin toggles paid-break configuration while controls revision stays7; old desktop policy POST receives SQL409 with no controls/period mutation, reread clears draft, and a second explicit admin save restores original values while preserving all four old config receipts');

    await policy(owner,12,'合成验收：暂停期间只恢复已提交的原规则收据');const beforePausedCommit=writes().length;control.lose=endpoint;
    await panel(owner).getByRole('button',{name:'确认设置申请期限',exact:true}).click();const committedWhileEnabled=await uncertain(owner),committedRaw=await pending(owner);
    assert.equal(control.lose,null);assert.equal(writes().length,beforePausedCommit+1);assert.equal(writes().at(-1).fault,'after-sql');assert.equal(ledger().length,8);preservePrior(beforeSettingsControls,ledger());
    const committedEntry=ledger().at(-1);assert.equal(committedEntry.operation_id,committedWhileEnabled.command.operationId);assert.equal(committedEntry.command.expectedSettingsVersion,finalSettings.version);
    const phonePrepared=await reload(phone,8);assert.equal(phonePrepared.moduleEnabled,true);assert.equal(phonePrepared.settingsVersion,finalSettings.version);await policy(phone,14,'合成验收：已准备的旧页面不能越过平台暂停');
    transport.state.moduleEnabled=false;const recoveryStart=requests.length,recoveryWrites=writes().length,committedLedger=ledger(),committedPeriods=periods();
    assert.equal(await pending(owner),committedRaw);const pausedReceipt=await fullRefresh(owner,8);
    assert.equal(pausedReceipt.moduleEnabled,false);assert.equal(pausedReceipt.receipt.operationId,committedWhileEnabled.command.operationId);assert.equal(pausedReceipt.receipt.action,'set_policy');assert.equal(pausedReceipt.policy.values.submissionWindowDays,12);
    await panel(owner).getByRole('status').filter({hasText:'原操作已确认'}).waitFor();assert.equal(await pending(owner),null);assert.equal(writes().length,recoveryWrites);
    const recoveryRequests=requests.slice(recoveryStart).filter(request=>request.path===endpoint);assert.equal(recoveryRequests.length,1);assert.equal(recoveryRequests[0].method,'GET');assert.equal(recoveryRequests[0].query.operationId,committedWhileEnabled.command.operationId);
    assert(rpcCalls().some(call=>call.operationId===committedWhileEnabled.command.operationId&&call.command===null&&call.allowWrite===false));
    assert(await panel(owner).getByRole('combobox',{name:/^配置操作/}).isDisabled());assert.deepEqual(ledger(),committedLedger);assert.deepEqual(periods(),committedPeriods);
    // The phone intentionally has NOT refreshed its previously enabled result.
    // A real UI click therefore reaches the real paused handler/SQL admission.
    assert.equal(await panel(phone).getByRole('button',{name:'确认设置申请期限',exact:true}).isDisabled(),false);
    const pausedRejected=await save(phone,'确认设置申请期限',403);assert.equal(pausedRejected.error,'attendance_platform_paused');
    await panel(phone).getByRole('status').filter({hasText:'平台暂停新配置写入'}).waitFor();assert.equal(await pending(phone),null);assert.equal(writes().length,recoveryWrites+1);
    const pausedCommand=writes().at(-1).body;assert.equal(pausedCommand.expectedRevision,8);assert.equal(pausedCommand.expectedSettingsVersion,finalSettings.version);
    assert(rpcCalls().some(call=>call.command?.operationId===pausedCommand.operationId&&call.allowWrite===false));assert.deepEqual(ledger(),committedLedger);assert.deepEqual(periods(),committedPeriods);
    const pausedPhone=await reload(phone,8);assert.equal(pausedPhone.moduleEnabled,false);assert(await panel(phone).getByRole('combobox',{name:/^配置操作/}).isDisabled());assert.equal(unchanged(),verifiedNewBaseline);assert.equal(protectedFacts(),originalProtectedFacts);
    pass('paused original receipt recovery: a policy committed before reply loss resolves by exactly one original-ID GET with allowWrite=false and no repeat POST; a previously prepared enabled mobile form then reaches SQL403 on its explicit new policy POST, appending no receipt or period change');

    const {checkControlsNavigationShell}=await import('./merchant-attendance-controls-navigation-shell-checks.mjs');
    const navigationProof=await checkControlsNavigationShell({owner,phone,admin,transport,requests,pass,site,control,holdControlsResponse,
      endpoint,panel,ledger,periods,writes,rpcCalls,pending,unchanged,protectedFacts,open,reload,policy,lock,atRevision,preservePrior});

    transport.state.moduleEnabled=true;await reload(owner,navigationProof.controlsCountAfter);await policy(owner,15,'合成验收：撤权期间保留未确认编号');control.unsent=endpoint;await panel(owner).getByRole('button',{name:'确认设置申请期限',exact:true}).click();await uncertain(owner);const uncertainRaw=await pending(owner);
    const employee=await newPage({actor:actors[1]});try{await employee.goto(origin+'/harness.css');const denied=await employee.evaluate(async site=>{const r=await fetch('/api/merchant-enterprise/attendance/correction-controls?siteId='+site);return {status:r.status,body:await r.json()};},site);assert.equal(denied.status,403);assert.equal(denied.body.error,'attendance_access_denied');assert.equal('entries' in denied.body,false);}finally{await employee.context().close();}
    const beforeDenied=writes().length,beforeRevocation=ledger();ownerChanged=true;exec(`update public.merchants set user_id='${id(98)}',auth_user_id=null,owner_user_id=null,owner_id=null,auth_id=null,created_by=null,created_by_user_id=null where id='${site}';`);
    for(const page of [owner,phone]){const response=page.waitForResponse(r=>r.url().includes(endpoint+'?')&&r.status()===403);await panel(page).getByRole('button',{name:'重新读取／查原收据',exact:true}).click();await response;await panel(page).getByRole('status').filter({hasText:'负责人权限已变化，已隐藏资料。'}).waitFor();assert.equal(await panel(page).locator('article').count(),0);assert.equal(await panel(page).getByRole('combobox').count(),0);}
    assert.equal(await pending(owner),uncertainRaw);assert.equal(writes().length,beforeDenied);assert.deepEqual(ledger(),beforeRevocation);assert.equal(unchanged(),verifiedNewBaseline);assert.equal(protectedFacts(),originalProtectedFacts);
    pass('employee read cannot impersonate controls owner; current owner revocation clears private controls in both contexts while retaining only the original uncertain intent, with zero recovery POST or rewritten facts');
    assert.equal(ledger().length,navigationProof.controlsCountAfter);assert.equal(writes().length,navigationProof.controlsPostCountAfter+1);assert.deepEqual(ledger().slice(0,beforeSettingsControls.length),beforeSettingsControls);assert.deepEqual(configRows(),finalConfig);
    return {configCountBefore:originalConfig.length,configCountAfter:finalConfig.length,configWritesAdded:2,
      configOperationIds:[changedSettings.saved.receipt.operationId,revertedSettings.saved.receipt.operationId],
      settingsVersionBefore:originalSettings.version,settingsVersionAfter:finalSettings.version,settingsValuesRestored:true,
      controlsCount:ledger().length,controlsPostCount:writes().length,navigationProof,settingsConflictOperationId:rejectedSettingsCommand.operationId,
      pausedReceiptOperationId:committedWhileEnabled.command.operationId,pausedRejectedOperationId:pausedCommand.operationId,
      protectedFactsBefore:originalProtectedFacts,protectedFactsAfter:protectedFacts()};
  }finally{
    control.lose=null;control.unsent=null;control.acceptDialogs=true;transport.state.moduleEnabled=wasEnabled;
    if(ownerChanged)exec(`update public.merchants set user_id='${actors[0].id}' where id='${site}';`);
  }
}
