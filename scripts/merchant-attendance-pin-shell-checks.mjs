// Real owner controls and separately paired device. Never inject a PIN result,
// paired cookie, event or SQL proof; no clock/limiter override or saved artifacts.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {runAttendanceCleanupSteps} from './fixtures/attendance-cleanup.mjs';
const require=createRequire(import.meta.url);
const {TERMINAL_COOKIE,parseTerminalToken}=require('../src/lib/merchantAttendanceTerminal.ts');
const {pinClockPendingKey}=require('../src/lib/merchantAttendancePinClockClient.ts');

export async function checkAttendancePinShell({owner,newPage,openOwner,admin,exec,transport,requests,pass,origin,site,actors,control}){
  assert.equal(site,'99990001');assert.equal(control.lose,null);
  const oldPin='72941863',pin='85649271',label='合成 PIN 专用终端';
  const rows=(table,order='to_jsonb(t)::text')=>JSON.parse(exec(`select coalesce(jsonb_agg(to_jsonb(t) order by ${order}),'[]'::jsonb) from public.${table} t;`));
  const protectedFacts=()=>Object.fromEntries(['merchant_attendance_workers','merchant_attendance_locations','merchant_attendance_employment_periods',
    'merchant_enterprise_employees','merchant_enterprise_roles','merchant_attendance_scopes','merchant_attendance_scope_workers',
    'merchant_attendance_scope_locations','merchant_attendance_scope_grants','merchant_attendance_scope_operations'].map(table=>[table,rows(table)]));
  const base=protectedFacts(),worker=base.merchant_attendance_workers[0],location=base.merchant_attendance_locations[0];
  const config=()=>rows('merchant_attendance_config_operations','operation_id'),settings=()=>rows('merchant_attendance_settings')[0];
  const events=()=>rows('merchant_attendance_events','sequence'),receipts=()=>rows('merchant_attendance_pin_clock_receipts','event_id');
  const credentials=()=>rows('merchant_attendance_pin_credentials')[0],pinAudit=()=>rows('merchant_attendance_pin_audit','revision');
  const terminalAudit=()=>rows('merchant_attendance_terminal_audit','recorded_at,action');
  const oldConfig=config(),oldSettings=settings(),wasEnabled=transport.state.moduleEnabled;
  assert.equal(base.merchant_attendance_workers.length,1);assert.equal(base.merchant_attendance_locations.length,1);
  assert.equal(worker.default_location_id,location.id);assert.equal(location.radius_meters,null);
  assert.equal(base.merchant_enterprise_employees.find(e=>e.id===worker.employee_id).auth_user_id,actors[2].id);
  assert.equal(oldConfig.length,4);assert.equal(oldSettings.enabled,false);assert.equal(oldSettings.web_clock_enabled,false);
  assert.equal(events().length,0);assert.equal(receipts().length,0);assert.equal(pinAudit().length,0);assert.equal(terminalAudit().length,0);
  const originals=()=>{
    assert.deepEqual(protectedFacts(),base);assert.equal(config().length,5);
    for(const row of oldConfig)assert.deepEqual(config().find(r=>r.operation_id===row.operation_id),row);
    const current=settings();assert.equal(current.enabled,true);assert.equal(current.web_clock_enabled,false);assert.equal(current.version,oldSettings.version+1);
    assert.deepEqual({...current,enabled:oldSettings.enabled,version:oldSettings.version,updated_at:oldSettings.updated_at},oldSettings);
  };
  const endpoint=name=>'/api/merchant-enterprise/attendance/'+name;
  const posts=name=>requests.filter(r=>r.path===endpoint(name)&&r.method==='POST');
  const mutations=()=>posts('terminal-clock').filter(r=>r.body.command!==null);
  const response=(page,name,method='GET',status=200)=>page.waitForResponse(r=>new URL(r.url()).pathname===endpoint(name)&&r.request().method()===method&&r.status()===status);
  const click=async(page,name,button,method='GET',status=200)=>{
    const waiting=response(page,name,method,status);await button.click();const body=await (await waiting).json();assert.equal(body.ok,status===200);return body;
  };
  const terminal=()=>owner.getByRole('region',{name:'门店终端管理',exact:true});
  const pins=()=>owner.getByRole('region',{name:'员工终端 PIN 管理',exact:true});
  let device,terminalId;
  const state=()=>device.getByRole('region',{name:'当前员工打卡状态',exact:true});
  const safeStorage=async page=>{
    const safe=await page.evaluate(([a,b])=>{const s=JSON.stringify({local:Object.entries(localStorage),session:Object.entries(sessionStorage)});
      return !s.includes(a)&&!s.includes(b)&&!s.includes('pairSecret')&&!s.includes('verifier')&&!s.includes('aq1.')
        &&!/\d{8}\.[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}/.test(s);
    },[oldPin,pin]);assert(safe,'pin_shell_storage_must_not_contain_capability');
  };
  const noPinInput=async()=>assert((await device.getByLabel('员工 PIN',{exact:true}).inputValue())==='','pin_shell_input_cleared');
  const read=async(value=pin,status=200)=>{
    await device.getByLabel('考勤工号',{exact:true}).fill(worker.worker_no);await device.getByLabel('员工 PIN',{exact:true}).fill(value);
    const r=await click(device,'terminal-clock',device.getByRole('button',{name:'验证并读取／核对原操作',exact:true}),'POST',status);
    await noPinInput();return r;
  };
  const checkEvents=count=>{
    const current=events();assert.equal(current.length,count);assert.equal(receipts().length,count);
    const commands=mutations();assert.equal(commands.length,count);
    for(const [index,event] of current.entries()){
      assert.equal(event.source,'kiosk');assert.equal(event.action,['clock_in','break_start','break_end','clock_out'][index]);
      assert.equal(event.merchant_id,site);assert.equal(event.worker_id,worker.id);assert.equal(event.actor_employee_id,worker.employee_id);
      assert.equal(event.location_id,location.id);assert.equal(event.sequence,index+1);
      const receipt=receipts().find(r=>r.event_id===event.id);assert(receipt);
      assert.equal(receipt.terminal_id,terminalId);assert.equal(receipt.worker_id,worker.id);assert.equal(receipt.employee_id,worker.employee_id);
      assert.equal(receipt.operation_id,event.operation_id);assert.deepEqual(receipt.command,commands[index].body.command);
    }
    originals();return current;
  };
  try{
    transport.state.moduleEnabled=true;await openOwner(owner);
    await admin(owner).getByRole('button',{name:'考勤设置',exact:true}).click();
    await admin(owner).getByRole('checkbox',{name:/^启用企业考勤/}).check();
    assert.equal(await admin(owner).getByRole('checkbox',{name:/^允许普通网页打卡/}).isChecked(),false);
    await click(owner,'admin',admin(owner).getByRole('button',{name:'保存考勤设置',exact:true}),'POST');originals();
    await click(owner,'terminals',admin(owner).getByRole('button',{name:'门店终端配对',exact:true}));
    await terminal().getByText(/此处只管理终端配对，不会直接打卡/).waitFor();
    assert.doesNotMatch(await terminal().innerText(),/尚未开放|尚不能|尚未接入/);
    await click(owner,'admin',terminal().getByRole('button',{name:'读取工作地点',exact:true}));
    await terminal().getByRole('combobox',{name:/^绑定工作地点/}).selectOption(location.id);
    await terminal().getByRole('textbox',{name:'终端名称',exact:true}).fill(label);
    await click(owner,'terminals',terminal().getByRole('button',{name:'生成五分钟配对码',exact:true}),'POST');
    const pairing=await terminal().getByRole('textbox',{name:'一次性配对码',exact:true}).inputValue();terminalId=parseTerminalToken(pairing).terminalId;
    await terminal().getByRole('button',{name:'管理员工终端 PIN',exact:true}).click();
    await pins().getByText(/此页仅管理独立 PIN，不产生打卡记录/).waitFor();
    await pins().getByLabel('考勤工号',{exact:true}).fill(worker.worker_no);
    const initial=await click(owner,'pin-credentials',pins().getByRole('button',{name:'读取员工 PIN 状态',exact:true}));assert.equal(initial.revision,0);
    for(const [index,value] of [oldPin,pin].entries()){
      await pins().getByLabel('新 PIN（8–12 位数字）',{exact:true}).fill(value);
      await pins().getByRole('checkbox',{name:/^我已核对员工/}).check();
      const r=await click(owner,'pin-credentials',pins().getByRole('button',{name:'确认设置／重置 PIN',exact:true}),'POST');
      assert.equal(r.revision,index+1);assert.equal(r.receipt.action,'set');assert.equal(r.workerId,worker.id);assert.equal(r.employeeId,worker.employee_id);
      assert((await pins().getByLabel('新 PIN（8–12 位数字）',{exact:true}).inputValue())==='','pin_shell_owner_input_cleared');
    }
    assert.equal(pinAudit().length,2);assert.equal(credentials().revision,2);assert.equal(credentials().attempts,0);
    const initialPinAudit=pinAudit();checkEvents(0);await safeStorage(owner);
    pass('actual owner enterprise terminal launcher creates device and explicitly sets then resets independent PIN; two audited revisions, unchanged employee and role bindings and no punches');

    device=await newPage({device:true,mobile:true});assert.equal((await device.context().cookies(origin)).length,0);
    const href=await terminal().getByRole('link',{name:'终端配对页',exact:true}).getAttribute('href');assert.equal(href,'/enterprise/attendance-terminal');
    const empty=response(device,'terminal-device');await device.goto(new URL(href,origin).href);assert.equal((await (await empty).json()).paired,false);
    await device.getByRole('textbox',{name:'粘贴一次性配对码',exact:true}).fill(pairing);
    await click(device,'terminal-device',device.getByRole('button',{name:'确认配对此浏览器',exact:true}),'POST');
    await device.getByRole('heading',{name:label,exact:true}).waitFor();
    await device.getByText(/配对后可从本页进入独立 PIN 打卡入口/).waitFor();
    await device.getByRole('status').filter({hasText:'请到独立 PIN 打卡入口核对权限与状态'}).waitFor();
    assert.equal(await device.getByRole('link',{name:'展示门店动态现场码（需已配对）',exact:true}).count(),0);
    assert.doesNotMatch(await device.locator('main').innerText(),/尚未开放|尚不能|尚未接入/);
    assert(await device.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'pin_shell_pairing_guidance_mobile_layout');
    const cookies=await device.context().cookies(origin);assert.equal(cookies.length,1);const cookie=cookies[0];
    assert.equal(cookie.name,TERMINAL_COOKIE);assert.equal(cookie.httpOnly,true);assert.equal(cookie.secure,true);assert.equal(cookie.sameSite,'Strict');assert.equal(cookie.path,'/');
    assert(cookie.value!==pairing&&parseTerminalToken(cookie.value).terminalId===terminalId,'pin_shell_independent_paired_credential');
    assert(await device.evaluate(()=>document.cookie===''&&localStorage.length===0&&sessionStorage.length===0),'pin_shell_no_account_or_durable_capability');
    await terminal().getByRole('button',{name:'隐藏并清除配对码',exact:true}).click();
    const ready=response(device,'terminal-device');await device.getByRole('link',{name:'进入门店 PIN 打卡',exact:true}).click();await ready;
    await device.getByRole('status').filter({hasText:'终端已配对'}).waitFor();checkEvents(0);
    assert.deepEqual(terminalAudit().map(r=>r.action),['create','pair']);
    pass('independent390px device is actually paired and follows the real PIN-clock link, with only its HttpOnly cookie and no account login, PIN or automatic punch');

    const denied=await read(oldPin,403);assert.equal(denied.error,'attendance_pin_denied');assert.equal(await state().count(),0);
    assert.equal(credentials().attempts,1);checkEvents(0);
    const status=await read();assert.equal(status.state.status,'off');assert.equal(status.state.sequence,0);assert.equal(status.workerId,worker.id);
    await state().getByRole('button',{name:'确认上班',exact:true}).waitFor();assert.equal(credentials().attempts,2);checkEvents(0);
    pass('reset old PIN is rejected generically with no employee details; current PIN reads current person only and consumes real SQL attempts without creating attendance');

    control.lose=endpoint('terminal-clock');await state().getByRole('button',{name:'确认上班',exact:true}).click();
    await device.getByRole('status').filter({hasText:'请重新输入本人工号和 PIN'}).waitFor();assert.equal(control.lose,null);
    const originalEvent=checkEvents(1)[0],key=pinClockPendingKey({siteId:site,terminalId},worker.worker_no);
    const saved=await device.evaluate(k=>sessionStorage.getItem(k),key);assert(saved,'pin_shell_pending_original_intent_required');
    const intent=JSON.parse(saved);assert.equal(intent.command.operationId,originalEvent.operation_id);assert.equal(intent.workerNo,worker.worker_no);
    assert.equal(intent.command.expectedEmployeeId,worker.employee_id);await safeStorage(device);assert.equal(credentials().attempts,3);
    const beforeReload=posts('terminal-clock').length;await device.reload();await device.getByRole('status').filter({hasText:'终端已配对'}).waitFor();
    assert.equal(posts('terminal-clock').length,beforeReload);assert.equal(await state().count(),0);await noPinInput();
    pass('explicit PIN clock-in commits once before response loss; reload stores scoped original intent only, hides person and PIN and never automatically resubmits or reads a private receipt');

    const recovered=await read();assert.equal(recovered.receipt.id,originalEvent.id);assert.equal(recovered.receipt.operationId,intent.command.operationId);
    await device.getByRole('status').filter({hasText:'原打卡已确认，未重复提交'}).waitFor();assert.equal(mutations().length,1);
    assert.equal(posts('terminal-clock').at(-1).body.command,null);assert.equal(posts('terminal-clock').at(-1).body.operationId,intent.command.operationId);
    assert.equal(await device.evaluate(k=>sessionStorage.getItem(k),key),null);assert.equal(credentials().attempts,4);
    const resting=await click(device,'terminal-clock',state().getByRole('button',{name:'确认开始休息',exact:true}),'POST');
    assert.equal(resting.state.status,'break');assert.equal(credentials().attempts,5);assert.deepEqual(checkEvents(2)[0],originalEvent);
    pass('re-entered current PIN authenticates original-operation query POST with command null; exact receipt clears pending without duplicate write, then explicit break-start creates only the next event');

    const beforeHidden=posts('terminal-clock').length;
    await state().waitFor({state:'detached',timeout:20000});assert.equal(posts('terminal-clock').length,beforeHidden);await safeStorage(device);await noPinInput();
    const onBreak=await read();assert.equal(onBreak.state.status,'break');
    const resumed=await click(device,'terminal-clock',state().getByRole('button',{name:'确认结束休息',exact:true}),'POST');
    assert.equal(resumed.state.status,'working');assert.equal(credentials().attempts,7);checkEvents(3);
    pass('real client success timeout hides person within20seconds without polling or clock override; fresh PIN revalidation and explicit break-end preserve source receipts and cumulative verification count');

    transport.state.moduleEnabled=false;const paused=await read();assert.equal(paused.canStart,false);assert.equal(paused.canFinish,true);
    assert(await state().getByRole('button',{name:'确认开始休息',exact:true}).isDisabled());
    const ended=await click(device,'terminal-clock',state().getByRole('button',{name:'确认下班',exact:true}),'POST');
    assert.equal(ended.state.status,'off');assert.equal(ended.state.sequence,4);assert.equal(credentials().attempts,9);
    const completed=checkEvents(4),completedReceipts=receipts();assert.equal(ended.receipt.id,completed[3].id);
    assert.equal(await device.evaluate(()=>sessionStorage.length),0);await safeStorage(device);
    pass('platform pause blocks a new break but permits explicit finishing of existing shift; four kiosk events and four bound receipts, nine credential attempts including one stale-PIN failure and no ordinary web clock enablement');

    const ownerStatus=await click(owner,'pin-credentials',pins().getByRole('button',{name:'读取员工 PIN 状态',exact:true}));assert.equal(ownerStatus.moduleEnabled,false);
    await pins().getByRole('checkbox',{name:/^我已核对员工/}).check();
    const revokedPin=await click(owner,'pin-credentials',pins().getByRole('button',{name:'撤销当前 PIN',exact:true}),'POST');
    assert.equal(revokedPin.revision,3);assert.equal(revokedPin.enabled,false);assert.equal(pinAudit().length,3);
    assert.deepEqual(pinAudit().slice(0,2),initialPinAudit);assert.equal(credentials().salt,null);assert.equal(credentials().verifier,null);
    const pinDenied=await read(pin,403);assert.equal(pinDenied.error,'attendance_pin_denied');assert.equal(await state().count(),0);
    assert.equal(credentials().attempts,9);assert.equal(posts('terminal-clock').length,10);
    const reread=await click(owner,'terminals',terminal().getByRole('button',{name:'重新读取／核对原终端',exact:true}));assert.equal(reread.moduleEnabled,false);
    const row=terminal().locator('article').filter({hasText:terminalId});await row.getByRole('button',{name:'撤销终端',exact:true}).click();
    await click(owner,'terminals',row.getByRole('button',{name:'确认撤销此终端',exact:true}),'POST');
    const dead=await click(device,'terminal-device',device.getByRole('button',{name:'重新检查设备',exact:true}),'GET',403);assert.equal(dead.error,'attendance_terminal_denied');
    assert(await device.getByLabel('员工 PIN',{exact:true}).isDisabled());assert(await device.getByLabel('考勤工号',{exact:true}).isDisabled());assert.equal(await state().count(),0);
    assert.deepEqual(events(),completed);assert.deepEqual(receipts(),completedReceipts);assert.deepEqual(terminalAudit().map(r=>r.action),['create','pair','revoke']);
    assert(rows('merchant_attendance_terminals')[0].revoked_at);assert.equal(rows('merchant_attendance_terminals').length,1);
    assert.equal(posts('pin-credentials').length,3);assert.equal(posts('terminals').length,2);assert.equal(posts('terminal-device').length,1);
    assert.equal(transport.calls.filter(r=>r.name==='faolla_attendance_pin_begin_v1').length,10);
    assert.equal(transport.calls.filter(r=>r.name==='faolla_attendance_pin_clock_v1').length,9);
    assert(await device.evaluate(()=>localStorage.length===0&&sessionStorage.length===0&&document.documentElement.scrollWidth<=innerWidth),'pin_shell_final_empty_storage_and_mobile_layout');
    await safeStorage(owner);await safeStorage(device);originals();
    pass('paused owner revokes PIN then device: disabled credential rejects even correct PIN without changing facts or resetting attempts; revoked device blocks entry, no account fallback, original four facts and both audit chains remain');
    return {events:4,pinReceipts:4,pinAudit:3,terminalAudit:3,configCount:5,revoked:true,originalFactsUnchanged:true};
  }finally{
    control.lose=null;transport.state.moduleEnabled=wasEnabled;
    await runAttendanceCleanupSteps(device?[{name:'pin-shell-device-context',timeoutMs:10000,run:()=>device.context().close()}]:[]);
  }
}
