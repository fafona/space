// Actual owner entry -> dedicated browser pairing -> locally rendered QR ->
// employee SDK login. Only the owned synthetic namespace is changed. No camera,
// account-cookie injection into the device, direct punch RPC or saved QR file.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {isDeepStrictEqual} from 'node:util';
import sharp from 'sharp';
import jsQR from 'jsqr';
import {runAttendanceCleanupSteps} from './fixtures/attendance-cleanup.mjs';

const require=createRequire(import.meta.url);
const {TERMINAL_COOKIE,parseTerminalToken}=require('../src/lib/merchantAttendanceTerminal.ts');
const {parseOnsiteScanUrl}=require('../src/lib/merchantAttendanceOnsiteQrBrowser.ts');
const {onsiteClockPendingKey}=require('../src/lib/merchantAttendanceOnsiteClockClient.ts');

export async function checkAttendanceTerminalShell({owner,newPage,openOwner,admin,exec,transport,requests,pass,origin,site,actors,control}) {
  assert.equal(site,'99990001');assert.equal(control.lose,null);
  const endpoint=name=>'/api/merchant-enterprise/attendance/'+name;
  const rows=(table,order)=>JSON.parse(exec(`select coalesce(jsonb_agg(to_jsonb(t) order by ${order}),'[]'::jsonb) from public.${table} t;`));
  const protectedRows=()=>Object.fromEntries([
    ['merchant_attendance_workers','id'],['merchant_attendance_locations','id'],
    ['merchant_attendance_employment_periods','id'],['merchant_attendance_scope_operations','revision'],
    ['merchant_attendance_scope_grants','id'],['merchant_enterprise_employees','id'],['merchant_enterprise_roles','id'],
    ...['merchant_attendance_scopes','merchant_attendance_scope_workers','merchant_attendance_scope_locations'].map(table=>[table,'to_jsonb(t)::text']),
  ].map(([table,order])=>[table,rows(table,order)]));
  const config=()=>rows('merchant_attendance_config_operations','operation_id');
  const settings=()=>rows('merchant_attendance_settings','merchant_id')[0];
  const events=()=>rows('merchant_attendance_events','sequence');
  const receipts=()=>rows('merchant_attendance_onsite_receipts','event_id');
  const audits=()=>rows('merchant_attendance_terminal_audit','recorded_at,action');
  const terminals=()=>rows('merchant_attendance_terminals','id');
  const posts=name=>requests.filter(r=>r.path===endpoint(name)&&r.method==='POST');
  const response=(page,name,method='GET',status=200,predicate=()=>true)=>page.waitForResponse(r=>
    new URL(r.url()).pathname===endpoint(name)&&r.request().method()===method&&r.status()===status&&predicate(r));
  const result=async pending=>{const value=await (await pending).json();assert.equal(value.ok,true);return value;};
  const click=async(page,name,button,method='GET')=>{const pending=response(page,name,method);await button.click();return result(pending);};
  const panel=()=>owner.getByRole('region',{name:'门店终端管理',exact:true});
  const confirmation=()=>employee.getByRole('region',{name:'本人现场打卡确认',exact:true});
  const qr=()=>device.getByRole('img',{name:'门店动态现场码，请用本人手机扫描后登录并选择打卡动作',exact:true});
  const base=protectedRows(),oldConfig=config(),oldSettings=settings();
  const worker=base.merchant_attendance_workers[0],location=base.merchant_attendance_locations[0];
  assert.equal(base.merchant_attendance_workers.length,1);assert.equal(base.merchant_attendance_locations.length,1);
  assert.equal(worker.default_location_id,location.id);assert.equal(location.radius_meters,null);
  assert.equal(base.merchant_enterprise_employees.find(e=>e.id===worker.employee_id).auth_user_id,actors[2].id);
  assert.equal(oldConfig.length,4);assert.equal(base.merchant_attendance_scope_operations.length,2);
  assert.equal(oldSettings.enabled,false);assert.equal(oldSettings.web_clock_enabled,false);
  assert.equal(events().length,0);assert.equal(receipts().length,0);assert.equal(terminals().length,0);assert.equal(audits().length,0);
  const originalFacts=()=>{
    assert.deepEqual(protectedRows(),base);
    const current=config();assert.equal(current.length,5);
    for(const row of oldConfig)assert.deepEqual(current.find(v=>v.operation_id===row.operation_id),row);
    const now=settings();assert.equal(now.enabled,true);assert.equal(now.web_clock_enabled,false);assert.equal(now.version,oldSettings.version+1);
    assert.deepEqual({...now,enabled:oldSettings.enabled,version:oldSettings.version,updated_at:oldSettings.updated_at},oldSettings);
  };
  const noStoredCapability=async page=>assert(await page.evaluate(()=>{
    const data=JSON.stringify({local:Object.entries(localStorage),session:Object.entries(sessionStorage)});
    return !data.includes('aq1.')&&!data.includes('pairSecret')&&!/\d{8}\.[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}/.test(data)
      &&!data.includes('Synthetic-attendance-only!');
  }),'terminal_shell_no_durable_pair_device_or_qr_capability');
  const decode=async()=>{
    await qr().waitFor();const image=await qr().getAttribute('src');
    assert(typeof image==='string'&&image.startsWith('data:image/png;base64,'),'terminal_shell_local_png_required');
    const raw=await sharp(Buffer.from(image.slice(image.indexOf(',')+1),'base64')).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    assert.equal(raw.info.width,512);assert.equal(raw.info.height,512);
    const link=jsQR(new Uint8ClampedArray(raw.data),raw.info.width,raw.info.height)?.data;
    assert(typeof link==='string','terminal_shell_png_must_decode');
    const parsed=parseOnsiteScanUrl(link,origin);
    assert.equal(parsed.siteId,site);assert.equal(parsed.claims.terminalId,terminalId);assert.equal(parsed.claims.locationId,location.id);
    assert.equal(parsed.claims.expiresAtMs-parsed.claims.issuedAtMs,45000);
    assert(parsed.claims.expiresAtMs>Date.now()+1000,'terminal_shell_live_display_code_required');
    return {link,claims:parsed.claims,image};
  };
  const paste=async link=>{
    if(!await employee.getByLabel('现场码链接',{exact:true}).isVisible())await employee.getByText('无法使用摄像头？粘贴现场码链接',{exact:true}).click();
    await employee.getByLabel('现场码链接',{exact:true}).fill(link);
    await employee.getByRole('button',{name:'读取现场码（不打卡）',exact:true}).click();
    await confirmation().getByText(/当前现场码剩余约/).waitFor();
    assert(new URL(employee.url()).hash==='','terminal_shell_fragment_scrubbed');
    assert((await employee.getByLabel('现场码链接',{exact:true}).inputValue())==='','terminal_shell_paste_input_cleared');
  };
  const checkBinding=(event,claims,command)=>{
    assert.equal(event.merchant_id,site);assert.equal(event.worker_id,worker.id);assert.equal(event.actor_employee_id,worker.employee_id);
    assert.equal(event.location_id,location.id);assert.equal(event.source,'web');
    const binding=receipts().find(r=>r.event_id===event.id);assert(binding);
    assert.equal(binding.merchant_id,site);assert.equal(binding.worker_id,worker.id);assert.equal(binding.employee_id,worker.employee_id);
    assert.equal(binding.terminal_id,terminalId);assert.equal(binding.operation_id,event.operation_id);assert.equal(binding.nonce,claims.nonce);
    assert(isDeepStrictEqual(binding.claims,claims),'terminal_shell_claim_binding_matches');assert.deepEqual(binding.command,command);
  };
  const wasEnabled=transport.state.moduleEnabled,label='合成终端完整企业入口';
  let device,employee,terminalId;
  try{
    transport.state.moduleEnabled=true;await openOwner(owner);
    await admin(owner).getByRole('button',{name:'考勤设置',exact:true}).click();
    await admin(owner).getByRole('checkbox',{name:/^启用企业考勤/}).check();
    assert.equal(await admin(owner).getByRole('checkbox',{name:/^允许普通网页打卡/}).isChecked(),false);
    await click(owner,'admin',admin(owner).getByRole('button',{name:'保存考勤设置',exact:true}),'POST');originalFacts();
    await click(owner,'terminals',admin(owner).getByRole('button',{name:'门店终端配对',exact:true}));
    await panel().getByText(/此处只管理终端配对，不会直接打卡/).waitFor();
    assert.doesNotMatch(await panel().innerText(),/尚未开放|尚不能|尚未接入/);
    await click(owner,'admin',panel().getByRole('button',{name:'读取工作地点',exact:true}));
    await panel().getByRole('combobox',{name:/^绑定工作地点/}).selectOption(location.id);
    await panel().getByRole('textbox',{name:'终端名称',exact:true}).fill(label);
    const created=await click(owner,'terminals',panel().getByRole('button',{name:'生成五分钟配对码',exact:true}),'POST');
    await panel().getByRole('textbox',{name:'一次性配对码',exact:true}).waitFor();
    const pairing=await panel().getByRole('textbox',{name:'一次性配对码',exact:true}).inputValue(),credential=parseTerminalToken(pairing);
    terminalId=credential.terminalId;assert.equal(credential.siteId,site);
    assert.equal(created.items.length,1);assert.equal(created.items[0].id,terminalId);assert.equal(created.items[0].state,'pending');
    assert.equal(terminals().length,1);assert.equal(audits().length,1);assert.equal(audits()[0].action,'create');assert.equal(events().length,0);
    await noStoredCapability(owner);originalFacts();
    pass('actual owner enterprise settings enables attendance with ordinary web clock still off; actual terminal launcher creates one pending device and one audit, preserves original four configuration receipts and creates no punch');

    device=await newPage({device:true});assert.equal((await device.context().cookies(origin)).length,0);
    const href=await panel().getByRole('link',{name:'终端配对页',exact:true}).getAttribute('href');assert.equal(href,'/enterprise/attendance-terminal');
    // The ordinary owner link does not isolate cookies. Use its real href in a
    // separately created dedicated browser, as the visible instructions require.
    const emptyStatus=response(device,'terminal-device');await device.goto(new URL(href,origin).href);assert.equal((await result(emptyStatus)).paired,false);
    await device.getByRole('textbox',{name:'粘贴一次性配对码',exact:true}).fill(pairing);
    const paired=await click(device,'terminal-device',device.getByRole('button',{name:'确认配对此浏览器',exact:true}),'POST');
    await device.getByRole('heading',{name:label,exact:true}).waitFor();assert.equal(paired.terminal.id,terminalId);assert.equal(paired.terminal.state,'active');
    await device.getByText(/配对后可从本页进入现场码展示入口/).waitFor();
    await device.getByRole('status').filter({hasText:'请到员工本人手机上的现场码打卡页核对权限与状态'}).waitFor();
    assert.equal(await device.getByRole('link',{name:'进入门店 PIN 打卡',exact:true}).count(),0);
    assert.doesNotMatch(await device.locator('main').innerText(),/尚未开放|尚不能|尚未接入|现场码和 PIN 入口分别/);
    assert.equal(await device.getByRole('textbox',{name:'粘贴一次性配对码',exact:true}).count(),0);
    const cookies=await device.context().cookies(origin);assert.equal(cookies.length,1);const cookie=cookies[0];
    assert.equal(cookie.name,TERMINAL_COOKIE);assert.equal(cookie.httpOnly,true);assert.equal(cookie.secure,true);assert.equal(cookie.sameSite,'Strict');assert.equal(cookie.path,'/');
    assert(parseTerminalToken(cookie.value).terminalId===terminalId&&cookie.value!==pairing,'terminal_shell_device_credential_must_be_distinct');
    assert(!(await device.evaluate(()=>document.cookie)).includes(TERMINAL_COOKIE),'terminal_shell_device_cookie_is_not_javascript_readable');
    assert(await device.evaluate(()=>localStorage.length===0&&sessionStorage.length===0),'terminal_shell_device_storage_remains_empty');
    assert.equal(posts('terminal-device').filter(r=>r.body?.action==='pair').length,1);
    assert.deepEqual(audits().map(a=>a.action),['create','pair']);assert.equal(events().length,0);await noStoredCapability(device);originalFacts();
    await panel().getByRole('button',{name:'隐藏并清除配对码',exact:true}).click();await panel().getByRole('textbox',{name:'一次性配对码',exact:true}).waitFor({state:'detached'});
    pass('dedicated unauthenticated browser follows the real pairing-page href and receives its own HttpOnly Secure Strict cookie from actual pairing; one-use pairing and hiding the owner code never log in an account or create attendance');

    const issued=response(device,'onsite-code','POST');await device.getByRole('link',{name:'展示门店动态现场码（需已配对）',exact:true}).click();
    const issue=await result(issued);assert.equal(issue.terminalId,terminalId);const first=await decode();
    assert(first.claims.issuedAtMs===issue.issuedAtMs&&first.claims.expiresAtMs===issue.expiresAtMs,'terminal_shell_png_matches_actual_issuance');
    assert.equal(events().length,0);assert.equal(receipts().length,0);await noStoredCapability(device);
    employee=await newPage({employee:true,mobile:true});assert.equal(employee.viewportSize().width,390);assert.equal((await employee.context().cookies(origin)).length,0);
    await employee.goto(first.link);await employee.getByRole('heading',{name:'先登录本人员工账号',exact:true}).waitFor();assert(new URL(employee.url()).hash==='','terminal_shell_fragment_scrubbed');
    assert.equal(posts('onsite-clock').length,0);assert.equal(events().length,0);
    await employee.getByLabel('员工邮箱',{exact:true}).fill(actors[2].email);await employee.getByLabel('密码',{exact:true}).fill('Synthetic-attendance-only!');
    const initialStatus=response(employee,'onsite-clock');await employee.getByRole('button',{name:'登录后核对打卡',exact:true}).click();
    const initial=await result(initialStatus);assert.equal(initial.workerId,worker.id);assert.equal(initial.employeeId,worker.employee_id);assert.equal(initial.state.status,'off');assert.equal(initial.state.sequence,0);
    await employee.getByRole('region',{name:'当前登录员工',exact:true}).getByText('本人账号：'+actors[2].email,{exact:true}).waitFor();
    await confirmation().getByText('当前：未上班',{exact:true}).waitFor();await noStoredCapability(employee);
    assert.equal(await employee.getByLabel('密码',{exact:true}).count(),0);assert.equal(posts('onsite-clock').length,0);assert.equal(events().length,0);
    pass('actual display PNG decodes locally to the exact scan entry;390px phone consumes and scrubs the fragment then uses real SDK password login and authenticated status only, without automatic punches or persisted QR capability');

    // Re-use the first genuinely displayed code, not a separately signed fixture.
    await paste(first.link);const clocked=await click(employee,'onsite-clock',confirmation().getByRole('button',{name:'确认上班',exact:true}),'POST');
    await confirmation().getByText('当前：工作中',{exact:true}).waitFor();assert.equal(clocked.state.sequence,1);assert.equal(clocked.receipt.action,'clock_in');
    assert.equal(events().length,1);assert.equal(receipts().length,1);assert.equal(posts('onsite-clock').length,1);
    const firstEvent=events()[0],firstBinding=receipts()[0];checkBinding(firstEvent,first.claims,posts('onsite-clock')[0].body.command);
    assert.equal(clocked.receipt.id,firstEvent.id);assert.equal(clocked.receipt.operationId,firstEvent.operation_id);
    const pendingKey=onsiteClockPendingKey(site,actors[2].id);assert.equal(await employee.evaluate(key=>sessionStorage.getItem(key),pendingKey),null);
    originalFacts();await noStoredCapability(employee);
    pass('one explicit phone clock-in performs fresh authenticated preflight and actual SQL write; one web-source event has matching immutable onsite provenance, employee, worker, terminal and operation, while ordinary web clock remains disabled');

    transport.state.moduleEnabled=false;
    const paused=await click(employee,'onsite-clock',confirmation().getByRole('button',{name:'只读核对当前状态／原操作',exact:true}));assert.equal(paused.moduleEnabled,false);
    const previousImage=await qr().getAttribute('src');
    // Real client timing: five-second button throttle and two attempts/minute.
    // A prior automatic refresh may require waiting for the genuine window.
    await device.getByRole('button',{name:/^(刷新现场码|重新获取现场码)/}).click({timeout:65000});
    await device.waitForFunction(old=>{const img=document.querySelector('img[alt="门店动态现场码，请用本人手机扫描后登录并选择打卡动作"]');return !!img&&img.getAttribute('src')!==old;},previousImage,{timeout:15000});
    const second=await decode();assert(first.claims.nonce!==second.claims.nonce,'terminal_shell_second_action_requires_new_display_code');
    await device.getByText(/平台已暂停新增上班和开始休息/).waitFor();
    // Leaving the real display stops automatic refresh before the fault/recovery
    // work. No synthetic browser clock or direct issuance RPC is used.
    const backStatus=response(device,'terminal-device');await device.getByRole('link',{name:'查看或配对门店终端',exact:true}).click();assert.equal((await result(backStatus)).paired,true);
    await device.getByRole('status').filter({hasText:'平台已暂停新增考勤'}).waitFor();
    assert.match(await device.getByRole('status').innerText(),/能否结束已有班次或核对原操作.*重新核对权限与状态/);
    assert.doesNotMatch(await device.getByRole('status').innerText(),/不能打卡/);
    await paste(second.link);assert(await confirmation().getByRole('button',{name:'确认开始休息',exact:true}).isDisabled());
    assert(await confirmation().getByRole('button',{name:'确认下班',exact:true}).isEnabled());
    control.lose=endpoint('onsite-clock');await confirmation().getByRole('button',{name:'确认下班',exact:true}).click();
    await confirmation().getByRole('status').filter({hasText:'原操作编号仍保留'}).waitFor();assert.equal(control.lose,null);
    const saved=await employee.evaluate(key=>sessionStorage.getItem(key),pendingKey);assert(saved,'terminal_shell_pending_intent_required');
    assert(!saved.includes('aq1.')&&!saved.includes('token')&&!saved.includes('Synthetic-attendance'),'terminal_shell_pending_contains_intent_only');
    const intent=JSON.parse(saved);assert.equal(intent.authUserId,actors[2].id);assert.equal(intent.siteId,site);assert.equal(intent.command.expectedEmployeeId,worker.employee_id);
    assert.equal(intent.command.action,'clock_out');assert.equal(intent.command.expectedSequence,1);
    assert.equal(events().length,2);assert.equal(receipts().length,2);assert.equal(posts('onsite-clock').length,2);assert.equal(posts('onsite-clock')[1].fault,'after-sql');
    const endedEvent=events()[1];assert.equal(endedEvent.action,'clock_out');assert.equal(endedEvent.operation_id,intent.command.operationId);
    checkBinding(endedEvent,second.claims,intent.command);assert.deepEqual(events()[0],firstEvent);assert.deepEqual(receipts().find(r=>r.event_id===firstEvent.id),firstBinding);
    originalFacts();await noStoredCapability(employee);
    pass('actual refreshed second display code permits explicit existing-shift finish during platform pause; reply lost only after SQL commit leaves the original account-bound intent, exactly two events and no duplicate or stored QR');

    const terminalRead=await click(owner,'terminals',panel().getByRole('button',{name:'重新读取／核对原终端',exact:true}));assert.equal(terminalRead.moduleEnabled,false);
    const row=panel().locator('article').filter({hasText:terminalId});await row.getByRole('button',{name:'撤销终端',exact:true}).click();
    const revoked=await click(owner,'terminals',row.getByRole('button',{name:'确认撤销此终端',exact:true}),'POST');assert.equal(revoked.items[0].state,'revoked');
    await panel().getByRole('heading',{name:label+' · 已撤销',exact:true}).waitFor();
    assert.equal(audits().length,3);assert.deepEqual(audits().map(a=>a.action),['create','pair','revoke']);assert(terminals()[0].revoked_at);
    const beforeRecovery=posts('onsite-clock').length,recovery=response(employee,'onsite-clock','GET',200,r=>new URL(r.url()).searchParams.get('operationId')===intent.command.operationId);
    await employee.reload();const recovered=await result(recovery);await confirmation().getByRole('status').filter({hasText:'打卡已由服务器确认'}).waitFor();
    assert.equal(recovered.moduleEnabled,false);assert.equal(recovered.state.status,'off');assert.equal(recovered.state.sequence,2);
    assert.equal(recovered.receipt.id,endedEvent.id);assert.equal(recovered.receipt.operationId,intent.command.operationId);assert.equal(recovered.receipt.action,'clock_out');
    assert.equal(recovered.workerId,worker.id);assert.equal(recovered.employeeId,worker.employee_id);assert.equal(posts('onsite-clock').length,beforeRecovery);
    assert.equal(await employee.evaluate(key=>sessionStorage.getItem(key),pendingKey),null);assert(new URL(employee.url()).hash==='','terminal_shell_fragment_scrubbed');
    await confirmation().getByText('未持有可用现场码；可重新扫码，查询原结果无需扫码。',{exact:true}).waitFor();
    const deniedDevice=response(device,'terminal-device','GET',403);await device.getByRole('button',{name:'检查当前终端状态',exact:true}).click();
    assert.equal((await (await deniedDevice).json()).error,'attendance_terminal_denied');await device.getByRole('heading',{name:label,exact:true}).waitFor({state:'detached'});
    const deniedIssue=response(device,'onsite-code','POST',403);await device.getByRole('link',{name:'展示门店动态现场码（需已配对）',exact:true}).click();
    assert.equal((await (await deniedIssue).json()).error,'attendance_terminal_denied');
    await device.getByRole('status').filter({hasText:'终端凭证已失效、过期或被撤销'}).waitFor();assert.equal(await qr().count(),0);
    assert.equal(events().length,2);assert.equal(receipts().length,2);assert.equal(terminals().length,1);assert.equal(audits().length,3);
    assert.equal(posts('terminals').length,2);assert.equal(posts('terminal-device').length,1);assert.equal(posts('onsite-clock').length,2);
    assert.deepEqual(events()[0],firstEvent);assert.deepEqual(events()[1],endedEvent);assert.deepEqual(receipts().find(r=>r.event_id===firstEvent.id),firstBinding);
    await noStoredCapability(owner);await noStoredCapability(device);await noStoredCapability(employee);originalFacts();
    assert(await device.evaluate(()=>localStorage.length===0&&sessionStorage.length===0),'terminal_shell_device_storage_remains_empty');
    assert(await employee.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    pass('paused owner revokes the real paired terminal before phone reload; original tokenless GET recovers the committed finish with no POST, device status and real display re-entry reject403 and hide metadata/QR, and390px layout plus protected facts remain intact');
    return {events:2,onsiteReceipts:2,terminalAudit:3,configCount:5,revoked:true,originalFactsUnchanged:true};
  }finally{
    control.lose=null;transport.state.moduleEnabled=wasEnabled;
    await runAttendanceCleanupSteps([
      ...(employee?[{name:'terminal-shell-employee-context',timeoutMs:10000,run:()=>employee.context().close()}]:[]),
      ...(device?[{name:'terminal-shell-device-context',timeoutMs:10000,run:()=>device.context().close()}]:[]),
    ]);
  }
}
