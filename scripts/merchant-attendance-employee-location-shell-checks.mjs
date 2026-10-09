// Explicit opt-in scenarios for the existing ownership-checked local schema and
// real merchant/employee shell. Auth and one-shot GPS are synthetic; no real
// browser location, employee account, external server, or production is used.
import assert from 'node:assert/strict';

export async function checkAttendanceEmployeeLocationShell({owner,newPage,admin,exec,transport,requests,pass,origin,site,actors,control}) {
  assert.equal(site,'99990001');
  const endpoints=Object.fromEntries(['policy','setup','notice','clock'].map(kind=>[kind,`/api/merchant-enterprise/attendance/location-${kind}`]));
  const ownerWorkspace=()=>owner.getByRole('region',{name:'地点定位工作区',exact:true});
  const names={policy:'定位政策草稿',setup:'负责人定位策略设置',notice:'定位政策告知',clock:'定位打卡隔离原型'};
  const panel=(page,kind)=>page.getByRole('region',{name:names[kind],exact:true});
  const ownerSteps={policy:/^1 · 政策草稿/,setup:/^2 \/ 4 · 围栏与通路/,notice:/^3 · 发布告知/};
  const rows=(table,order='operation_id')=>JSON.parse(exec(`select coalesce(jsonb_agg(to_jsonb(t) order by ${order}),'[]'::jsonb) from public.${table} t;`));
  const workers=rows('merchant_attendance_workers','id');assert.equal(workers.length,1);const worker=workers[0],employeeId=worker.employee_id,workerId=worker.id,locationId=worker.default_location_id;
  const employeeRow=JSON.parse(exec(`select to_jsonb(t) from public.merchant_enterprise_employees t where merchant_id='${site}' and id='${employeeId}';`));
  assert.equal(employeeRow.auth_user_id,actors[2].id);
  const role=JSON.parse(exec(`select to_jsonb(t) from public.merchant_enterprise_roles t where merchant_id='${site}' and id='${employeeRow.role_id}';`));
  assert(role.permissions.includes('enterprise.view'));assert(role.permissions.includes('attendance.self.view'));assert(role.permissions.includes('attendance.self.clock'));
  const config=()=>rows('merchant_attendance_config_operations'),drafts=()=>rows('merchant_attendance_location_policy_drafts','revision'),notices=()=>rows('merchant_attendance_location_notices','revision'),setup=()=>rows('merchant_attendance_location_setup_operations');
  const events=()=>rows('merchant_attendance_events','sequence'),acks=()=>rows('merchant_attendance_location_notice_acknowledgements','notice_revision');
  const evidence=()=>({events:events(),summaries:rows('merchant_attendance_location_results','event_id'),gates:rows('merchant_attendance_location_clock_notices','event_id')});
  const keys={notice:`faolla:attendance:notice:v1:${site}:self:${employeeId}`,clock:`faolla:attendance:location-clock:v1:${site}:${employeeId}`};
  const pending=(page,kind)=>page.evaluate(key=>sessionStorage.getItem(key),keys[kind]);
  const clockWrites=()=>requests.filter(r=>r.path===endpoints.clock&&r.method==='POST');
  const ackWrites=()=>requests.filter(r=>r.path===endpoints.notice&&r.method==='POST'&&r.body?.access==='self');
  const baselineConfig=config(),baselineScopes={scopes:rows('merchant_attendance_scopes','employee_id'),grants:rows('merchant_attendance_scope_grants','id'),workers:rows('merchant_attendance_scope_workers','worker_id'),locations:rows('merchant_attendance_scope_locations','location_id'),operations:rows('merchant_attendance_scope_operations')};
  assert.equal(baselineConfig.length,4);assert.equal(baselineScopes.operations.length,2);assert.equal(events().length,0);assert.equal(acks().length,0);
  const preserved=()=>{
    assert.deepEqual(rows('merchant_attendance_workers','id'),workers);
    assert.deepEqual({scopes:rows('merchant_attendance_scopes','employee_id'),grants:rows('merchant_attendance_scope_grants','id'),workers:rows('merchant_attendance_scope_workers','worker_id'),locations:rows('merchant_attendance_scope_locations','location_id'),operations:rows('merchant_attendance_scope_operations')},baselineScopes);
    for(const original of baselineConfig)assert.deepEqual(config().find(row=>row.operation_id===original.operation_id),original,'original_config_receipt_rewritten');
  };
  const done=(page,kind,method='GET',status=200)=>page.waitForResponse(r=>new URL(r.url()).pathname===endpoints[kind]&&r.request().method()===method&&r.status()===status);
  const result=async response=>{const value=await (await response).json();assert.equal(value.ok,true);return value;};
  const ownerStep=async kind=>{const response=done(owner,kind);await ownerWorkspace().getByRole('button',{name:ownerSteps[kind]}).click();const value=await result(response);await panel(owner,kind).getByRole('button',{name:kind==='policy'?'重新读取／核对保存':'重新读取／核对收据',exact:true}).waitFor();return value;};
  const ownerSetup=async(action,reason)=>{
    const region=panel(owner,'setup');await region.getByRole('combobox',{name:/^操作/}).selectOption(action);await region.getByRole('textbox',{name:/^内部操作说明/}).fill(reason);await region.getByRole('checkbox',{name:/^我已核对影响范围/}).check();
    const response=done(owner,'setup','POST');await region.getByRole('button',{name:{prepare:'应用草稿围栏',enable:'启用企业定位通路',pause:'暂停企业定位通路'}[action],exact:true}).click();const value=await result(response);await region.getByRole('status').filter({hasText:'服务器已确认原操作'}).waitFor();assert.equal(value.receipt.command.action,action);return value;
  };
  const ownerNotice=async action=>{
    const region=panel(owner,'notice');await region.getByRole('combobox',{name:/^操作/}).selectOption(action);await region.getByRole('textbox',{name:/^操作说明/}).fill(action==='publish'?'合成验收：明确公开已核对政策':'合成验收：明确撤回旧告知');await region.getByRole('checkbox',{name:action==='publish'?/^我确认向员工公开下方草稿/:/^我确认撤回当前告知/}).check();
    const response=done(owner,'notice','POST');await region.getByRole('button',{name:action==='publish'?'发布告知版本':'撤回告知版本',exact:true}).click();const value=await result(response);await region.getByRole('status').filter({hasText:'操作已确认'}).waitFor();assert.equal(value.current.action,action);return value;
  };
  let employee=null,roleChanged=false,statusChanged=false;const wasEnabled=transport.state.moduleEnabled;
  const restoreRole=()=>{const permissions=role.permissions.map(permission=>`'${permission.replaceAll("'","''")}'`).join(',');exec(`update public.merchant_enterprise_roles set permissions=array[${permissions}],version=version+1 where merchant_id='${site}' and id='${role.id}';`);roleChanged=false;};
  try {
    transport.state.moduleEnabled=true;
    await admin(owner).getByRole('button',{name:'考勤设置',exact:true}).click();await admin(owner).getByRole('checkbox',{name:/^启用企业考勤/}).check();await admin(owner).getByRole('checkbox',{name:/^允许普通网页打卡/}).check();
    const settingsResponse=owner.waitForResponse(r=>new URL(r.url()).pathname==='/api/merchant-enterprise/attendance/admin'&&r.request().method()==='POST'&&r.status()===200);await admin(owner).getByRole('button',{name:'保存考勤设置',exact:true}).click();await result(settingsResponse);
    await admin(owner).getByRole('button',{name:'工作地点',exact:true}).click();const policyRead=done(owner,'policy');await admin(owner).getByRole('button',{name:'定位政策与围栏',exact:true}).click();const empty=await result(policyRead);assert.equal(empty.current,null);
    const values={purpose:'合成员工定位考勤验收',notice:'仅合成本地验收，不代表真实到店证明',contact:'合成负责人',alternative:'联系负责人核查登记',latitude:40.4168,longitude:-3.7038,radiusMeters:120,retentionDays:30};
    for(const [key,label] of Object.entries({purpose:'定位用途',notice:'补充告知',contact:'咨询／核查联系人',alternative:'无法提供位置时的替代登记说明'}))await panel(owner,'policy').getByRole('textbox',{name:label,exact:true}).fill(values[key]);
    for(const [key,label] of Object.entries({latitude:'拟定地点纬度',longitude:'拟定地点经度',radiusMeters:'拟定范围半径（米）',retentionDays:'拟定定位摘要保留天数'}))await panel(owner,'policy').getByRole('spinbutton',{name:label,exact:true}).fill(String(values[key]));
    await panel(owner,'policy').getByRole('checkbox',{name:/^我理解这里只保存政策草稿/}).check();const policySave=done(owner,'policy','POST');await panel(owner,'policy').getByRole('button',{name:'保存草稿 · 不启用定位',exact:true}).click();await result(policySave);await panel(owner,'policy').getByRole('status').filter({hasText:'草稿保存已确认'}).waitFor();
    await ownerStep('setup');const prepared=await ownerSetup('prepare','合成验收：明确应用员工测试围栏');assert.equal(prepared.channelEnabled,false);assert.equal(prepared.draft.revision,2);assert.equal(notices().length,0);
    await ownerStep('notice');const published=await ownerNotice('publish');assert.equal(published.current.revision,1);assert.equal(published.current.draftRevision,2);await ownerStep('setup');const enabled=await ownerSetup('enable','合成验收：明确开启测试定位通路');assert.equal(enabled.channelEnabled,true);
    assert.equal(config().length,5);assert.equal(drafts().length,2);assert.equal(setup().length,2);assert.equal(events().length,0);assert.equal(acks().length,0);preserved();

    employee=await newPage({employee:true,mobile:true});
    await employee.addInitScript(()=>{
      // Sole GPS source for this test. No browser permission is granted and no
      // native API is called. Reload resets this document-local observation.
      const state={mode:'denied',calls:0,watchCalls:0};Object.defineProperty(window,'__attendanceSyntheticGps',{value:state,configurable:true});
      Object.defineProperty(navigator,'geolocation',{configurable:true,value:{
        getCurrentPosition(success,failure,options){state.calls++;if(options.enableHighAccuracy!==true||options.maximumAge!==0)throw Error('synthetic_gps_one_shot_options');queueMicrotask(()=>{if(state.mode==='denied')failure({code:1,message:'synthetic_denial'});else success({timestamp:Date.now(),coords:{latitude:40.4168,longitude:-3.7038,accuracy:5,altitude:null,altitudeAccuracy:null,heading:null,speed:null}});});},
        watchPosition(){state.watchCalls++;throw Error('synthetic_gps_watch_forbidden');},clearWatch(){throw Error('synthetic_gps_watch_forbidden');},
      }});
    });
    const gps=()=>employee.evaluate(()=>({...window.__attendanceSyntheticGps}));
    const own=()=>employee.getByRole('region',{name:'我的考勤',exact:true}),workspace=()=>employee.getByRole('region',{name:'我的定位考勤',exact:true});
    const nav=async name=>{
      // Attendance is an inner enterprise tab, not a mobile sidebar item.
      // Wait through SDK/capability/overview bootstrap instead of treating a
      // temporarily absent tab as an instruction to open the sidebar overlay.
      await employee.locator('[data-employee-merchant-main="1"]').waitFor();
      const close=employee.getByRole('button',{name:'关闭员工工作区导航',exact:true});
      if(await close.isVisible()){
        await close.click({position:{x:employee.viewportSize().width-12,y:20}});
        await close.waitFor({state:'detached'});
      }
      const tabs=employee.getByRole('navigation',{name:'企业管理功能',exact:true});
      await tabs.waitFor();await tabs.getByRole('button',{name,exact:true}).click();
    };
    const enter=async(kind='clock')=>{await nav('我的考勤');await own().getByRole('button',{name:'刷新状态',exact:true}).waitFor();const response=done(employee,kind);await own().getByRole('button',{name:'定位打卡／地点告知',exact:true}).click();const value=await result(response);await panel(employee,kind).getByRole('status').filter({hasText:kind==='clock'?/状态已同步|打卡已/:/已读取当前告知|操作已确认/}).waitFor();return value;};
    const switchEmployee=async kind=>{const response=done(employee,kind);await workspace().getByRole('button',{name:kind==='clock'?'打卡与原班次收尾':'查看／确认地点告知',exact:true}).click();const value=await result(response);await panel(employee,kind).getByRole('status').filter({hasText:kind==='clock'?'状态已同步':'已读取当前告知'}).waitFor();return value;};
    const reload=async kind=>{const response=done(employee,kind);await panel(employee,kind).getByRole('button',{name:'重新读取／核对收据',exact:true}).click();const value=await result(response);await panel(employee,kind).getByRole('status').filter({hasText:kind==='clock'?/状态已同步|打卡已/:/已读取当前告知|操作已确认/}).waitFor();return value;};
    const receipt=async response=>{const value=await result(response);await panel(employee,'clock').getByRole('status').filter({hasText:/打卡已记录|打卡已由服务器记录/}).waitFor();const event=events().find(event=>event.id===value.receipt.id);assert(event);assert.equal(event.operation_id,value.receipt.operationId);assert.equal(event.actor_employee_id,employeeId);assert.equal(event.worker_id,workerId);assert.equal(event.location_id,locationId);assert.equal(event.source,'web');assert.equal(event.sequence,value.receipt.sequence);assert.equal(await pending(employee,'clock'),null);return value;};
    await employee.goto(origin+'/enterprise');await employee.getByLabel('员工邮箱',{exact:true}).fill(actors[2].email);await employee.getByLabel('密码',{exact:true}).fill('Synthetic-attendance-only!');await employee.getByRole('button',{name:'登录并选择企业',exact:true}).click();await employee.locator('article').filter({hasText:`企业编号 ${site}`}).getByRole('button',{name:'进入工作台',exact:true}).click();await employee.waitForURL(url=>url.pathname==='/enterprise/'+site);
    const initial=await enter();assert.equal(initial.workerId,workerId);assert.equal(initial.employeeId,employeeId);assert.equal(initial.state.sequence,0);assert.equal(initial.noticeGate.reason,'acknowledgement_required');assert.equal(initial.channelEnabled,false);assert(await panel(employee,'clock').getByRole('button',{name:'定位并登记上班',exact:true}).isDisabled());
    assert.equal((await gps()).calls,0);assert.equal(clockWrites().length,0);assert.equal(ackWrites().length,0);assert.equal(events().length,0);assert.equal(acks().length,0);assert(await employee.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    pass('real owner UI explicitly sets up policy/fence/notice/channel, then390px employee SDK login enters current worker workspace; entry only reads, asks for no GPS and creates no acknowledgement or punch');

    const notice=await switchEmployee('notice');assert.equal(notice.current.revision,1);assert.equal(notice.canAcknowledge,true);assert.equal(notice.acknowledgedAt,null);
    await panel(employee,'notice').getByRole('checkbox',{name:/^我确认收到上方第 1 版告知/}).check();control.lose=endpoints.notice;await panel(employee,'notice').getByRole('button',{name:'确认收到本版本告知',exact:true}).click();await panel(employee,'notice').getByRole('status').filter({hasText:'暂时无法确认结果或访问权限'}).waitFor();
    const lostAckRaw=await pending(employee,'notice');assert(lostAckRaw);const lostAck=JSON.parse(lostAckRaw);assert.equal(acks().length,1);assert.equal(acks()[0].operation_id,lostAck.command.operationId);assert.equal(ackWrites().at(-1).fault,'after-sql');assert.equal((await gps()).calls,0);assert.equal(events().length,0);assert(await workspace().getByRole('button',{name:'返回我的考勤',exact:true}).isDisabled());
    const beforeAckRecovery=ackWrites().length;await employee.reload();const recoveredAck=await enter('notice');assert.equal(recoveredAck.receipt.operationId,lostAck.command.operationId);assert(recoveredAck.acknowledgedAt);assert.equal(await pending(employee,'notice'),null);assert.equal(ackWrites().length,beforeAckRecovery);assert.equal(acks().length,1);assert.equal(events().length,0);assert.equal((await gps()).calls,0);
    assert(requests.some(r=>r.path===endpoints.notice&&r.method==='GET'&&r.query.operationId===lostAck.command.operationId));
    pass('explicit employee acknowledgement with a reply lost AFTER SQL recovers its original receipt after full SDK-shell reload using GET only; ACK is not consent to location and neither recovery nor acknowledgement requests GPS or punches');

    const accepted=await switchEmployee('clock');assert.equal(accepted.noticeGate.ready,true);assert.equal(accepted.channelEnabled,true);const beforeDenied=clockWrites().length;
    await panel(employee,'clock').getByRole('button',{name:'定位并登记上班',exact:true}).click();await panel(employee,'clock').getByRole('status').filter({hasText:'未能取得可用位置，尚未发送打卡'}).waitFor();assert.equal((await gps()).calls,1);assert.equal(await pending(employee,'clock'),null);assert.equal(clockWrites().length,beforeDenied);assert.equal(events().length,0);
    await reload('clock');await panel(employee,'clock').locator('summary').filter({hasText:'无法提供位置？明确选择无定位登记'}).click();await panel(employee,'clock').getByRole('combobox',{name:/^此次原因/}).selectOption('denied');await panel(employee,'clock').getByRole('checkbox',{name:/^我确认按所选动作登记实际工作情况/}).check();
    const fallbackResponse=done(employee,'clock','POST');await panel(employee,'clock').getByRole('button',{name:'无定位登记上班 · 待核查',exact:true}).click();const fallback=await receipt(fallbackResponse);assert.equal(fallback.receipt.action,'clock_in');assert.equal(fallback.state.sequence,1);assert.equal(fallback.locationResult.reason,'denied');assert.equal(fallback.locationResult.needsReview,true);assert.equal(fallback.receiptGate.safeFinish,false);assert.equal(fallback.receiptGate.noticeRevision,1);assert.equal(clockWrites().at(-1).body.position,null);assert.equal(clockWrites().at(-1).body.positionFailure,'denied');assert.equal((await gps()).calls,1);assert.equal(events().length,1);preserved();
    pass('synthetic GPS permission denial causes no pending operation, POST or event; only explicit reread, reason and acknowledgement permit a separate locationless clock-in marked denied/needs-review');

    await employee.evaluate(()=>{window.__attendanceSyntheticGps.mode='inside';});await panel(employee,'clock').getByRole('combobox',{name:'登记动作',exact:true}).selectOption('break_start');control.lose=endpoints.clock;
    await panel(employee,'clock').getByRole('button',{name:'定位并登记开始休息',exact:true}).click();await panel(employee,'clock').getByRole('status').filter({hasText:'结果仍待确认，原操作编号已保留'}).waitFor();
    const lostClockRaw=await pending(employee,'clock');assert(lostClockRaw);const lostClock=JSON.parse(lostClockRaw);assert.deepEqual(Object.keys(lostClock).sort(),['employeeId','intent','siteId','version']);assert.equal('position' in lostClock.intent,false);assert.equal('latitude' in lostClock.intent,false);assert.equal('longitude' in lostClock.intent,false);assert.equal((await gps()).calls,2);assert.equal(events().length,2);assert.equal(events()[1].operation_id,lostClock.intent.operationId);assert.equal(clockWrites().at(-1).fault,'after-sql');
    const beforeClockRecovery=clockWrites().length;await employee.reload();const recoveredClock=await enter();assert.equal(recoveredClock.receipt.operationId,lostClock.intent.operationId);assert.equal(recoveredClock.receipt.action,'break_start');assert.equal(recoveredClock.state.status,'break');assert.equal(recoveredClock.state.sequence,2);assert.equal(recoveredClock.locationResult.reason,'inside');assert.equal(recoveredClock.locationResult.needsReview,false);assert.equal(await pending(employee,'clock'),null);assert.equal(clockWrites().length,beforeClockRecovery);assert.equal((await gps()).calls,0);assert.equal(events().length,2);const firstShift=evidence();
    assert(requests.some(r=>r.path===endpoints.clock&&r.method==='GET'&&r.query.operationId===lostClock.intent.operationId));
    pass('one synthetic inside-position break-start commits atomically with its summary; lost response persists intent without coordinates and full-shell receipt recovery performs no new GPS acquisition or POST');

    await ownerStep('notice');const withdrawn=await ownerNotice('withdraw');assert.equal(withdrawn.current.revision,2);const withdrawnClock=await reload('clock');assert.equal(withdrawnClock.noticeGate.reason,'withdrawn');assert.equal(withdrawnClock.channelEnabled,false);assert(withdrawnClock.finish);assert(await panel(employee,'clock').getByRole('button',{name:'定位并登记结束休息',exact:true}).isDisabled());
    const republished=await ownerNotice('publish');assert.equal(republished.current.revision,3);assert.equal(republished.current.draftRevision,2);const needsNewAck=await reload('clock');assert.equal(needsNewAck.noticeGate.reason,'acknowledgement_required');assert.equal(needsNewAck.noticeGate.revision,3);assert.equal(acks().length,1);assert.equal((await gps()).calls,0);assert.deepEqual(evidence(),firstShift);
    const newNotice=await switchEmployee('notice');assert.equal(newNotice.current.revision,3);assert.equal(newNotice.acknowledgedAt,null);assert.equal(newNotice.canAcknowledge,true);await panel(employee,'notice').getByRole('checkbox',{name:/^我确认收到上方第 3 版告知/}).check();const newAckResponse=done(employee,'notice','POST');await panel(employee,'notice').getByRole('button',{name:'确认收到本版本告知',exact:true}).click();const newAck=await result(newAckResponse);await panel(employee,'notice').getByRole('status').filter({hasText:'操作已确认'}).waitFor();assert.equal(newAck.receipt.revision,3);assert.equal(acks().length,2);assert.deepEqual(acks().map(row=>row.notice_revision),[1,3]);
    const current=await switchEmployee('clock');assert.equal(current.noticeGate.ready,true);assert.equal(current.noticeGate.revision,3);assert.equal((await gps()).calls,0);assert.deepEqual(evidence(),firstShift);preserved();
    pass('actual owner withdrawal and republication fence the old acknowledgement: existing facts remain immutable, the clock is gated, and only a fresh explicit employee ACK makes notice revision3 current without any automatic GPS or event');

    transport.state.moduleEnabled=false;await ownerStep('setup');const channelPaused=await ownerSetup('pause','合成验收：平台暂停期间明确暂停定位通路');assert.equal(channelPaused.channelEnabled,false);assert.equal(channelPaused.moduleEnabled,false);
    const finishReady=await reload('clock');assert.equal(finishReady.moduleEnabled,false);assert.equal(finishReady.channelEnabled,false);assert.equal(finishReady.state.status,'break');assert.equal(finishReady.finish.locationId,locationId);assert(await panel(employee,'clock').getByRole('button',{name:'定位并登记结束休息',exact:true}).isDisabled());
    await panel(employee,'clock').getByRole('checkbox',{name:/^确认现在结束休息；之后仍需登记下班/}).check();const endResponse=done(employee,'clock','POST');await panel(employee,'clock').getByRole('button',{name:'无定位结束休息 · 待核查',exact:true}).click();const ended=await receipt(endResponse);
    assert.equal(ended.receipt.action,'break_end');assert.equal(ended.state.sequence,3);assert.equal(ended.state.status,'working');assert.equal(ended.receiptGate.safeFinish,true);assert.equal(ended.receiptGate.noticeRevision,null);assert.equal(ended.locationResult.reason,'not_provided');assert.equal(ended.locationResult.needsReview,true);assert.equal(events().length,3);
    assert.equal(await panel(employee,'clock').getByRole('checkbox',{name:/^确认现在下班，并登记为无定位/}).isChecked(),false);assert(await panel(employee,'clock').getByRole('button',{name:'无定位下班 · 待核查',exact:true}).isDisabled());
    await panel(employee,'clock').getByRole('checkbox',{name:/^确认现在下班，并登记为无定位/}).check();const outResponse=done(employee,'clock','POST');await panel(employee,'clock').getByRole('button',{name:'无定位下班 · 待核查',exact:true}).click();const out=await receipt(outResponse);
    assert.equal(out.receipt.action,'clock_out');assert.equal(out.state.sequence,4);assert.equal(out.state.status,'off');assert.equal(out.receiptGate.safeFinish,true);assert.equal(out.receiptGate.noticeRevision,null);assert.equal(out.locationResult.reason,'not_provided');assert.equal(out.finish,null);assert.equal((await gps()).calls,0);
    const safeCommands=clockWrites().slice(-2).map(row=>row.body);assert.deepEqual(safeCommands.map(command=>[command.action,command.safeFinish,command.position,command.positionFailure,command.noticeRevision]),[['break_end',true,null,'not_provided',null],['clock_out',true,null,'not_provided',null]]);
    const fullShift=evidence();for(const old of firstShift.events)assert.deepEqual(fullShift.events.find(row=>row.id===old.id),old);for(const old of firstShift.summaries)assert.deepEqual(fullShift.summaries.find(row=>row.event_id===old.event_id),old);
    assert.deepEqual(fullShift.events.map(row=>row.action),['clock_in','break_start','break_end','clock_out']);assert.deepEqual(fullShift.events.map(row=>row.sequence),[1,2,3,4]);assert.equal(fullShift.summaries.length,4);assert.equal(fullShift.gates.length,4);assert.equal(fullShift.gates.filter(row=>row.safe_finish).length,2);preserved();
    pass('platform and actual channel pause still permit explicit existing-shift safe finish: break-end and clock-out are two separately acknowledged, server-timed, no-GPS writes retaining original location and immutable prior facts');

    transport.state.moduleEnabled=true;const ownerReload=done(owner,'setup');await panel(owner,'setup').getByRole('button',{name:'重新读取／核对收据',exact:true}).click();await result(ownerReload);await ownerSetup('enable','合成验收：恢复通路以单独验证只读员工权限');
    const roleVersionBefore=Number(exec(`select version from public.merchant_enterprise_roles where merchant_id='${site}' and id='${role.id}';`));roleChanged=true;exec(`update public.merchant_enterprise_roles set permissions=array['enterprise.view','attendance.self.view'],version=version+1 where merchant_id='${site}' and id='${role.id}';`);
    const capabilities=employee.waitForResponse(r=>new URL(r.url()).pathname==='/api/merchant-business/capabilities'&&r.status()===200);await employee.evaluate(()=>window.dispatchEvent(new Event('focus')));const capabilityPayload=await result(capabilities);assert.equal(capabilityPayload.actor.authorizationVersion,`${roleVersionBefore+1}:1`);await workspace().waitFor({state:'detached'});
    const viewOnly=await enter();assert.equal(viewOnly.state.sequence,4);assert.equal(viewOnly.noticeGate.ready,true);
    // SQL reports this employee's eligibility, not merely the enterprise switch.
    assert.equal(exec(`select location_clock_enabled from public.merchant_attendance_settings where merchant_id='${site}';`),'t');assert.equal(viewOnly.channelEnabled,false);
    assert(await panel(employee,'clock').getByRole('button',{name:'定位并登记上班',exact:true}).isDisabled());await panel(employee,'clock').locator('summary').filter({hasText:'无法提供位置？明确选择无定位登记'}).click();assert(await panel(employee,'clock').getByRole('button',{name:'无定位登记上班 · 待核查',exact:true}).isDisabled());assert.equal((await gps()).calls,0);assert.deepEqual(evidence(),fullShift);assert.equal(await panel(employee,'clock').locator('dl').count(),0);
    assert(await employee.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));preserved();
    pass('current role-version refresh remounts the real employee shell and clears old receipts; with the enterprise switch independently enabled, self.view-only reads current notice/sequence but SQL actor eligibility is false and both punch buttons remain disabled on390px');

    restoreRole();await employee.reload();await enter();const beforeRevokeWrites=clockWrites().length;statusChanged=true;exec(`update public.merchant_enterprise_employees set status='disabled' where merchant_id='${site}' and id='${employeeId}';`);
    const denied=done(employee,'clock','GET',403);await panel(employee,'clock').getByRole('button',{name:'重新读取／核对收据',exact:true}).click();const deniedBody=await (await denied).json();assert.equal(deniedBody.error,'attendance_access_denied');await panel(employee,'clock').getByRole('status').filter({hasText:'未能核对服务器结果'}).waitFor();assert.equal(await panel(employee,'clock').locator('dl').count(),0);assert(await panel(employee,'clock').getByRole('button',{name:'定位并登记上班',exact:true}).isDisabled());
    const revokedCapabilities=employee.waitForResponse(r=>new URL(r.url()).pathname==='/api/merchant-business/capabilities'&&r.status()===403);await employee.evaluate(()=>window.dispatchEvent(new Event('focus')));await revokedCapabilities;await employee.getByText('登录状态或角色权限已变化，请重新核验。',{exact:true}).waitFor();assert.equal(await workspace().count(),0);assert.equal(clockWrites().length,beforeRevokeWrites);assert.deepEqual(evidence(),fullShift);
    const stored=await employee.evaluate(()=>[...Object.values(localStorage),...Object.values(sessionStorage)].join('\n'));for(const event of fullShift.events)assert(!stored.includes(event.id));assert(!stored.includes('"latitude"'));assert(!stored.includes('"longitude"'));assert.equal(await pending(employee,'notice'),null);assert.equal(await pending(employee,'clock'),null);assert.equal((await gps()).calls,0);assert.equal((await gps()).watchCalls,0);
    assert.equal(config().length,5);assert.equal(drafts().length,2);assert.equal(notices().length,3);assert.equal(setup().length,4);assert.equal(acks().length,2);assert.equal(events().length,4);assert.equal(clockWrites().length,4);assert.equal(ackWrites().length,2);preserved();
    pass('current employee revocation denies the next actual SQL read, then capability403 unmounts the entire employee workspace; no extra event/ACK/GPS, coordinate storage or rewritten prior facts survives the completed four-event shift');
  } catch(error) {
    // Capture only bounded rendered synthetic text before context cleanup; no
    // input values, storage, request headers or URL are included in diagnostics.
    if(employee&&!employee.isClosed()){
      let timer;
      try {
        const body=await Promise.race([employee.locator('body').innerText({timeout:2000}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('employee_location_diagnostic_timeout')),3000);})]);
        const redacted=body.replace(/https?:\/\/\S+/g,'[url]').replace(/\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/g,'[token]').replaceAll('Synthetic-attendance-only!','[password]').slice(-12000);
        console.error(JSON.stringify({employeeLocationFailure:{body:redacted}}));
      }catch {console.error('employee_location_diagnostics_unavailable');}finally {clearTimeout(timer);}
    }
    throw error;
  } finally {
    control.lose=null;control.unsent=null;transport.state.moduleEnabled=wasEnabled;
    try {if(roleChanged)restoreRole();} finally {
      try {if(statusChanged)exec(`update public.merchant_enterprise_employees set status='${employeeRow.status}' where merchant_id='${site}' and id='${employeeId}';`);} finally {if(employee)await employee.context().close();}
    }
  }
}
