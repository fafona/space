// Local synthetic PIN device with real owner lifecycle editors, handlers, KDF
// and SQL. No employee account is installed on the shared device.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {assertLocationManagementEmployeeAudit} from './merchant-attendance-location-management-shell-checks.mjs';
const require=createRequire(import.meta.url);
const {TERMINAL_COOKIE,parseTerminalToken}=require('../src/lib/merchantAttendanceTerminal.ts');
const {pinClockPendingKey}=require('../src/lib/merchantAttendancePinClockClient.ts');
const full=['enterprise.view','attendance.self.view','attendance.self.clock'],viewOnly=['enterprise.view','attendance.self.view'];
const sorted=value=>[...value].sort();

export function assertPinManagementAudit(rows,{site,employeeId,roleId}){
  assert.equal(rows.length,6);
  const employees=rows.filter(row=>row.entity_type==='employee').sort((a,b)=>a.created_at.localeCompare(b.created_at));
  assert.equal(employees.length,4);
  for(const start of [0,2])assertLocationManagementEmployeeAudit(employees.slice(start,start+2),{site,employeeId});
  const roles=rows.filter(row=>row.entity_type==='role').sort((a,b)=>a.created_at.localeCompare(b.created_at));assert.equal(roles.length,2);
  for(const [index,row] of roles.entries()){
    assert.equal(row.merchant_id,site);assert.equal(row.entity_id,roleId);assert.equal(row.event_type,'role.updated');assert.equal(row.target_label,'合成员工角色');
    assert.equal(row.actor_type,'owner');assert.equal(row.actor_id,null);
    assert.deepEqual(sorted(row.before_data.permissions),sorted(index?viewOnly:full));assert.deepEqual(sorted(row.after_data.permissions),sorted(index?full:viewOnly));
    assert.deepEqual({...row.after_data,permissions:row.before_data.permissions},row.before_data);
    for(const data of [row.before_data,row.after_data])for(const key of ['email','auth_user_id','password','token','invitation_token_hash'])assert.equal(key in data,false);
  }
}

export function assertPinManagementAttempts(previous,current,{credentialAttempts}){
  assert.equal(current.credentialAttempts,credentialAttempts);
  for(const field of ['lease_id','lease_expires','worker_id','employee_id','credential_revision'])assert.equal(current.device[field],null,'pin_management_lease_not_consumed');
  if(previous){
    assert.equal(current.credentialWindow,previous.credentialWindow,'pin_management_credential_window_reset');
    const before=Date.parse(previous.device.window_at),after=Date.parse(current.device.window_at);assert(Number.isFinite(before)&&Number.isFinite(after));
    if(before===after)assert.equal(current.device.attempts,previous.device.attempts+1);
    else{assert(after-before>=60000,'pin_management_device_window_rewound');assert.equal(current.device.attempts,1);}
  }else assert.equal(current.device.attempts,1);
}

export async function checkAttendancePinManagementShell({owner,newDevicePage,response,requests,exec,events,audits,employee,roleRpcCalls,employeeRpcCalls,pinPrepared,
  site,employeeId,workerId,placeId,roleId,origin,pass,holdResponse}){
  assert.equal(site,'99990001');assert.equal(events().length,0);assert.equal(audits().length,0);
  const pin='74628519',label='合成生命周期 PIN 终端',workerNo=pinPrepared.workerNo;
  const endpoint=name=>'/api/merchant-enterprise/attendance/'+name,clock=endpoint('terminal-clock');
  const rows=(table,order='id')=>JSON.parse(exec(`select coalesce(jsonb_agg(to_jsonb(t) order by ${order}),'[]'::jsonb) from public.${table} t;`));
  const facts=()=>({events:rows('merchant_attendance_events','sequence'),receipts:rows('merchant_attendance_pin_clock_receipts','event_id')});
  const role=()=>JSON.parse(exec(`select to_jsonb(t) from public.merchant_enterprise_roles t where id='${roleId}';`));
  const originalEmployee=employee(),originalRole=role();let previous=facts(),previousAttempts=null;
  const originalConfig=()=>exec(`select jsonb_build_object(
    'workers',(select jsonb_agg(to_jsonb(t) order by id) from public.merchant_attendance_workers t),
    'settings',(select jsonb_agg(to_jsonb(t) order by merchant_id) from public.merchant_attendance_settings t),
    'locations',(select jsonb_agg(to_jsonb(t) order by id) from public.merchant_attendance_locations t),
    'periods',(select jsonb_agg(to_jsonb(t) order by worker_id) from public.merchant_attendance_employment_periods t),
    'otherRoles',(select jsonb_agg(to_jsonb(t) order by id) from public.merchant_enterprise_roles t where id<>'${roleId}'),
    'boards',(select jsonb_agg(to_jsonb(t) order by id) from public.merchant_task_boards t),
    'columns',(select jsonb_agg(to_jsonb(t) order by id) from public.merchant_task_columns t));`);
  const config=originalConfig(),posts=()=>requests.filter(row=>row.path===clock&&row.method==='POST');
  const mutations=()=>posts().filter(row=>row.body.command!==null);
  const call=async(page,name,button,method='GET',status=200)=>{const waiting=response(page,endpoint(name),method,status);await button.click();const body=await(await waiting).json();assert.equal(body.ok,status===200);return body;};
  const admin=()=>owner.getByRole('region',{name:'考勤配置管理',exact:true}),terminal=()=>owner.getByRole('region',{name:'门店终端管理',exact:true});
  const pins=()=>owner.getByRole('region',{name:'员工终端 PIN 管理',exact:true});
  await owner.getByRole('button',{name:'考勤配置',exact:true}).click();await admin().waitFor();
  await call(owner,'terminals',admin().getByRole('button',{name:'门店终端配对',exact:true}));
  await call(owner,'admin',terminal().getByRole('button',{name:'读取工作地点',exact:true}));
  await terminal().getByRole('combobox',{name:/^绑定工作地点/}).selectOption(placeId);await terminal().getByRole('textbox',{name:'终端名称',exact:true}).fill(label);
  await call(owner,'terminals',terminal().getByRole('button',{name:'生成五分钟配对码',exact:true}),'POST');
  const pairing=await terminal().getByRole('textbox',{name:'一次性配对码',exact:true}).inputValue(),terminalId=parseTerminalToken(pairing).terminalId;
  await terminal().getByRole('button',{name:'管理员工终端 PIN',exact:true}).click();
  await pins().getByLabel('考勤工号',{exact:true}).fill(workerNo);await call(owner,'pin-credentials',pins().getByRole('button',{name:'读取员工 PIN 状态',exact:true}));
  await pins().getByLabel('新 PIN（8–12 位数字）',{exact:true}).fill(pin);await pins().getByRole('checkbox',{name:/^我已核对员工/}).check();
  const set=await call(owner,'pin-credentials',pins().getByRole('button',{name:'确认设置／重置 PIN',exact:true}),'POST');assert.equal(set.revision,1);
  assert((await pins().getByLabel('新 PIN（8–12 位数字）',{exact:true}).inputValue())==='','pin_management_owner_input_cleared');assert.equal(events().length,0);assert.equal(audits().length,0);
  const device=await newDevicePage(),state=()=>device.getByRole('region',{name:'当前员工打卡状态',exact:true});
  assert.equal((await device.context().cookies(origin)).length,0);
  const empty=response(device,endpoint('terminal-device'),'GET');await device.goto(origin+'/enterprise/attendance-terminal');assert.equal((await(await empty).json()).paired,false);
  await device.getByRole('textbox',{name:'粘贴一次性配对码',exact:true}).fill(pairing);await call(device,'terminal-device',device.getByRole('button',{name:'确认配对此浏览器',exact:true}),'POST');
  await device.getByRole('heading',{name:label,exact:true}).waitFor();await terminal().getByRole('button',{name:'隐藏并清除配对码',exact:true}).click();
  const cookie=(await device.context().cookies(origin))[0];assert.equal(cookie.name,TERMINAL_COOKIE);assert.equal(cookie.httpOnly,true);assert.equal(cookie.secure,true);assert.equal(cookie.sameSite,'Strict');
  assert(cookie.value!==pairing&&parseTerminalToken(cookie.value).terminalId===terminalId,'pin_management_cookie_not_independently_paired');
  await call(device,'terminal-device',device.getByRole('link',{name:'进入门店 PIN 打卡',exact:true}));await device.getByRole('status').filter({hasText:'终端已配对'}).waitFor();
  const key=pinClockPendingKey({siteId:site,terminalId},workerNo),pending=()=>device.evaluate(key=>sessionStorage.getItem(key),key);
  const secretFingerprint=()=>exec(`select md5(jsonb_build_object(
    'credential',(select to_jsonb(t)-'attempts' from public.merchant_attendance_pin_credentials t),
    'terminal',(select to_jsonb(t) from public.merchant_attendance_terminals t),
    'pinAudit',(select jsonb_agg(to_jsonb(t) order by revision) from public.merchant_attendance_pin_audit t),
    'terminalAudit',(select jsonb_agg(to_jsonb(t) order by recorded_at,action) from public.merchant_attendance_terminal_audit t))::text);`);
  const originalSecrets=secretFingerprint();
  const safeStorage=async()=>{
    assert(await device.evaluate(secret=>{const value=JSON.stringify({local:Object.entries(localStorage),session:Object.entries(sessionStorage)});
      return localStorage.length===0&&document.cookie===''&&!value.includes(secret)&&!value.includes('pairSecret')&&!value.includes('verifier')&&!value.includes('aq1.')
        &&!value.includes('access_token')&&!value.includes('"pin"');},pin),'pin_management_secret_in_device_storage');
    assert((await device.getByLabel('员工 PIN',{exact:true}).inputValue())==='','pin_management_device_input_cleared');
  };
  const attempts=count=>{
    const current=JSON.parse(exec(`select jsonb_build_object('credentialAttempts',(select attempts from public.merchant_attendance_pin_credentials),
      'credentialWindow',(select window_at from public.merchant_attendance_pin_credentials),
      'device',(select jsonb_build_object('attempts',attempts,'window_at',window_at,'lease_id',lease_id,'lease_expires',lease_expires,'worker_id',worker_id,'employee_id',employee_id,'credential_revision',credential_revision) from public.merchant_attendance_pin_attempts));`));
    assertPinManagementAttempts(previousAttempts,current,{credentialAttempts:count});previousAttempts=current;assert.equal(secretFingerprint(),originalSecrets);
  };
  const checkFacts=(count,result=null)=>{
    const current=facts();assert.equal(current.events.length,count);assert.equal(current.receipts.length,count);
    for(const name of ['events','receipts'])for(const row of previous[name]){const field=name==='events'?'id':'event_id';assert.deepEqual(current[name].find(value=>value[field]===row[field]),row);}
    for(const [index,event] of current.events.entries()){
      assert.equal(event.action,['clock_in','break_start','break_end','clock_out'][index]);assert.equal(event.sequence,index+1);assert.equal(event.source,'kiosk');
      assert.equal(event.actor_employee_id,employeeId);assert.equal(event.worker_id,workerId);assert.equal(event.location_id,placeId);
      const receipt=current.receipts.find(row=>row.event_id===event.id);assert(receipt);assert.equal(receipt.employee_id,employeeId);assert.equal(receipt.worker_id,workerId);
      assert.equal(receipt.operation_id,event.operation_id);assert.equal(receipt.terminal_id,terminalId);assert.equal(receipt.command.operationId,event.operation_id);
      const matching=mutations().filter(row=>row.status===200&&row.body.command.operationId===event.operation_id);assert.equal(matching.length,1);assert.deepEqual(receipt.command,matching[0].body.command);
    }
    if(result?.receipt){const event=current.events.find(row=>row.id===result.receipt.id);assert(event);assert.equal(event.operation_id,result.receipt.operationId);assert.equal(event.action,result.receipt.action);assert.equal(event.sequence,result.receipt.sequence);}
    previous=current;assert.equal(originalConfig(),config);return current;
  };
  const read=async(count,status=200)=>{
    await device.getByLabel('考勤工号',{exact:true}).fill(workerNo);await device.getByLabel('员工 PIN',{exact:true}).fill(pin);
    const value=await call(device,'terminal-clock',device.getByRole('button',{name:'验证并读取／核对原操作',exact:true}),'POST',status);attempts(count);await safeStorage();
    assert.equal(posts().at(-1).body.command,null);if(status!==200){assert.deepEqual(value,{ok:false,error:'attendance_pin_denied'});assert.equal(await state().count(),0);}return value;
  };
  const punch=async(label,count,status=200)=>{const value=await call(device,'terminal-clock',state().getByRole('button',{name:label,exact:true}),'POST',status);attempts(count);await safeStorage();return value;};
  const employeeCard=()=>owner.getByText('合成员工甲',{exact:true}).locator('xpath=../../..');
  const prepareEmployee=async()=>{await owner.getByRole('button',{name:'员工账号',exact:true}).click();await employeeCard().getByRole('button',{name:/^(停用|恢复)$/}).waitFor();};
  const setEmployee=async disabled=>{
    const before=employee(),old=facts(),n=audits().length;
    if(disabled)await employeeCard().getByRole('button',{name:'停用',exact:true}).click();const changed=response(owner,'/api/merchant-enterprise/employees','PATCH');
    if(disabled)await owner.getByRole('dialog',{name:'安全停用员工',exact:true}).getByRole('button',{name:'停用并解除负责人',exact:true}).click();else await employeeCard().getByRole('button',{name:'恢复',exact:true}).click();
    await changed;await employeeCard().getByRole('button',{name:disabled?'恢复':'停用',exact:true}).waitFor();assert.equal(employee().version,before.version+1);
    assert.equal(employee().status,disabled?'disabled':'active');assert.deepEqual({...employee(),status:before.status,version:before.version,updated_at:before.updated_at},before);
    assert.equal(audits().length,n+1);assert.deepEqual(facts(),old);assert.equal(originalConfig(),config);
  };
  const roleBody=()=>owner.locator(`[id="role-editor-${roleId}-body"]`),clockPermission=()=>roleBody().locator(`[id="role-${roleId}-attendance.self.clock"]`);
  const openRole=async()=>{
    await owner.getByRole('button',{name:'角色权限',exact:true}).click();const expand=owner.locator(`button[aria-controls="role-editor-${roleId}-body"]`);if(await expand.getAttribute('aria-expanded')!=='true')await expand.click();
    await roleBody().getByRole('navigation',{name:'权限主要板块',exact:true}).getByRole('button',{name:/^员工考勤，/}).click();
  };
  const saveRole=async enabled=>{
    const before=role(),old=facts(),n=audits().length;await clockPermission().setChecked(enabled);
    const changed=response(owner,'/api/merchant-enterprise/roles','PATCH'),overview=response(owner,'/api/merchant-enterprise/overview','GET');
    await roleBody().getByRole('button',{name:'保存角色',exact:true}).click();await changed;await overview;await owner.getByText('角色已保存。',{exact:true}).waitFor();
    assert.equal(role().version,before.version+1);assert.deepEqual(sorted(role().permissions),sorted(enabled?full:viewOnly));
    assert.deepEqual({...role(),permissions:before.permissions,version:before.version,updated_at:before.updated_at},before);assert.equal(audits().length,n+1);assert.deepEqual(facts(),old);
  };
  pass('actual owner creates a terminal and PIN, independent390px device pairs through its real cookie then follows PIN entry; no account injection, fake verifier or initial punch');

  const initial=await read(1);assert.equal(initial.state.status,'off');const first=await punch('确认上班',2);checkFacts(1,first);assert.equal(await pending(),null);
  pass('real PIN KDF and two distinct SQL verifications produce exactly one kiosk clock-in and source receipt, consuming two credential attempts');
  await prepareEmployee();await read(3);await setEmployee(true);const rejected=await punch('确认开始休息',3,403);assert.deepEqual(rejected,{ok:false,error:'attendance_pin_denied'});
  const deniedPending=await pending();assert(deniedPending);const rejectedId=JSON.parse(deniedPending).command.operationId;assert.equal(await state().count(),0);checkFacts(1);
  pass('real employee disable rejects previously authorized PIN-page action; device count increases but no new lease/credential attempt or fact, private display clears and original intent persists');
  await setEmployee(false);const absent=await read(4);assert.equal(absent.receipt,null);assert.equal(await pending(),deniedPending);assert.equal(posts().at(-1).body.operationId,rejectedId);assert.equal(mutations().length,2);checkFacts(1);
  const retry=await punch('按原编号重试原动作',5);assert.equal(retry.receipt.operationId,rejectedId);assert.equal(await pending(),null);checkFacts(2,retry);
  pass('same employee restore requires re-entered PIN for command-null original-ID query, then explicit original-ID retry adds only one break-start; no automatic recovery write');

  await openRole();await read(6);await saveRole(false);const roleDenied=await punch('确认结束休息',6,403);assert.deepEqual(roleDenied,{ok:false,error:'attendance_pin_denied'});
  const rolePending=await pending();assert(rolePending);const finishId=JSON.parse(rolePending).command.operationId;assert.equal(await state().count(),0);checkFacts(2);
  pass('actual role editor removes only self.clock; unlike web self.view reads, PIN verification refuses the stale action generically and retains its original break-end intent');
  await saveRole(true);await prepareEmployee();const finishRead=await read(7);assert.equal(finishRead.receipt,null);assert.equal(await pending(),rolePending);assert.equal(posts().at(-1).body.operationId,finishId);
  const gate=holdResponse();await state().getByRole('button',{name:'按原编号重试原动作',exact:true}).click();const late=await gate.ready();attempts(8);assert.equal(late.receipt.operationId,finishId);checkFacts(3,late);
  await setEmployee(true);
  const beforeReload=posts().length,deviceReload=response(device,endpoint('terminal-device'),'GET');await device.reload();await deviceReload;await device.getByRole('status').filter({hasText:'终端已配对'}).waitFor();
  await gate.release();await device.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  assert.equal(posts().length,beforeReload);assert.equal(await state().count(),0);assert.equal(await pending(),rolePending);await safeStorage();checkFacts(3);
  pass('restored role explicitly retries once and SQL commits break-end; real employee disable plus explicit device reload disposes old client, so released late success cannot revive person or erase pending');
  const blocked=await read(8,403);assert.equal(blocked.error,'attendance_pin_denied');assert.equal(posts().at(-1).body.operationId,finishId);assert.equal(await pending(),rolePending);checkFacts(3);
  pass('paired device alone cannot read disabled employee committed receipt: fresh PIN query rejects privately, keeps original intent and consumes no employee verification slot');
  await setEmployee(false);const recovered=await read(9);assert.deepEqual(recovered.receipt,late.receipt);assert.equal(posts().at(-1).body.operationId,finishId);assert.equal(await pending(),null);checkFacts(3,recovered);
  const ended=await punch('确认下班',10);assert.equal(ended.state.status,'off');assert.equal(ended.state.sequence,4);checkFacts(4,ended);assert.equal(await pending(),null);
  pass('same-member restore with fresh real PIN query recovers committed receipt without repeat command; explicit clock-out completes four actions at exactly ten credential verifications');

  assert.equal(posts().length,13);assert.equal(mutations().length,6);assert.equal(mutations().filter(row=>row.status===403).length,2);
  assert.equal(pinPrepared.calls.filter(row=>row.name==='faolla_attendance_pin_begin_v1').length,13);
  assert.equal(pinPrepared.calls.filter(row=>row.name==='faolla_attendance_pin_clock_v1').length,10);
  assert.equal(pinPrepared.calls.filter(row=>row.name==='faolla_attendance_pin_finish_v1').length,0);
  assert.equal(employeeRpcCalls.length,4);assert.equal(roleRpcCalls.length,2);assertPinManagementAudit(audits(),{site,employeeId,roleId});
  assert.deepEqual({...employee(),version:originalEmployee.version,updated_at:originalEmployee.updated_at},originalEmployee);assert.equal(employee().version,originalEmployee.version+4);
  assert.deepEqual(sorted(role().permissions),sorted(originalRole.permissions));assert.equal(role().version,originalRole.version+2);
  assert.deepEqual({...role(),permissions:originalRole.permissions,version:originalRole.version,updated_at:originalRole.updated_at},originalRole);
  assert.equal(rows('merchant_attendance_pin_audit','revision').length,1);assert.deepEqual(rows('merchant_attendance_terminal_audit','recorded_at,action').map(row=>row.action),['create','pair']);
  assert.equal(secretFingerprint(),originalSecrets);assert.equal(originalConfig(),config);
  assert(!JSON.stringify(requests).includes(pin));assert(!JSON.stringify(pinPrepared.calls).includes(pin));
  await safeStorage();assert(await device.evaluate(()=>sessionStorage.length===0&&document.documentElement.scrollWidth<=innerWidth));
  await state().getByRole('button',{name:'清除资料／下一位',exact:true}).click();assert.equal(await state().count(),0);
  pass('six exact employee/role audits, unchanged PIN credential/device and old facts, consumed leases and naturally counted windows; no limiter reset, persisted PIN or employee login on shared device');
  console.log(JSON.stringify({actualPinManagementShell:true,employeeChanges:4,roleChanges:2,managementAudits:6,pinHttpRequests:13,
    credentialAttempts:10,pinBeginCalls:13,pinClockCalls:10,punchCommands:6,acceptedFacts:4,rejectedCommands:2,
    originalReceiptRecovery:'POST-command-null-fresh-PIN',lateSuccessAfterExplicitReload:true,realKdf:true,
    realAuthService:false,realPhone:false,productionAccess:false}));
}
