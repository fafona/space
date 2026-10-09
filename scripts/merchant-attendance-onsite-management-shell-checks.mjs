// Local synthetic owner lifecycle editors -> separately paired QR display ->
// authenticated employee phone. Real time, default limits, HMAC and SQL remain.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {isDeepStrictEqual} from 'node:util';
import sharp from 'sharp';
import jsQR from 'jsqr';
import {assertPinManagementAudit} from './merchant-attendance-pin-management-shell-checks.mjs';
const require=createRequire(import.meta.url);
const {TERMINAL_COOKIE,parseTerminalToken}=require('../src/lib/merchantAttendanceTerminal.ts');
const {parseOnsiteScanUrl}=require('../src/lib/merchantAttendanceOnsiteQrBrowser.ts');
const {onsiteClockPendingKey}=require('../src/lib/merchantAttendanceOnsiteClockClient.ts');
const full=['enterprise.view','attendance.self.view','attendance.self.clock'],viewOnly=['enterprise.view','attendance.self.view'];
const sorted=value=>[...value].sort();

export function assertOnsiteManagementFacts(previous,current,{site,employeeId,workerId,placeId,terminalId,accepted}){
  assert.equal(current.events.length,accepted.length);assert.equal(current.receipts.length,accepted.length);
  assert.equal(new Set(current.events.map(row=>row.id)).size,accepted.length);
  assert.equal(new Set(current.receipts.map(row=>row.event_id)).size,accepted.length);
  for(const name of ['events','receipts'])for(const old of previous[name]){
    const field=name==='events'?'id':'event_id';
    assert(isDeepStrictEqual(current[name].find(row=>row[field]===old[field]),old),'onsite_management_original_fact_changed');
  }
  for(const [index,event] of current.events.entries()){
    const proof=accepted[index],receipt=current.receipts.find(row=>row.event_id===event.id);
    assert.equal(event.merchant_id,site);assert.equal(event.worker_id,workerId);assert.equal(event.actor_employee_id,employeeId);
    assert.equal(event.location_id,placeId);assert.equal(event.source,'web');assert.equal(event.sequence,index+1);
    assert.equal(event.action,['clock_in','break_start','break_end','clock_out'][index]);
    assert.equal(event.id,proof.result.receipt.id);assert.equal(event.operation_id,proof.result.receipt.operationId);
    assert.equal(event.operation_id,proof.command.operationId);assert.equal(proof.result.receipt.sequence,index+1);
    assert.equal(proof.result.receipt.action,event.action);assert.equal(proof.result.workerId,workerId);assert.equal(proof.result.employeeId,employeeId);
    assert(receipt,'onsite_management_origin_receipt_missing');
    for(const [field,value] of Object.entries({merchant_id:site,worker_id:workerId,employee_id:employeeId,terminal_id:terminalId,operation_id:event.operation_id}))assert.equal(receipt[field],value);
    assert(receipt.nonce===proof.claims.nonce,'onsite_management_nonce_binding_changed');
    assert(isDeepStrictEqual(receipt.claims,proof.claims),'onsite_management_claim_binding_changed');
    assert(isDeepStrictEqual(receipt.command,proof.command),'onsite_management_command_binding_changed');
  }
}

export function assertOnsiteManagementPending(raw,{site,authUserId,employeeId,workerId,placeId,action,sequence}){
  assert(typeof raw==='string'&&raw.length<=2048,'onsite_management_pending_required');
  assert(!raw.includes('aq1.')&&!raw.includes('token')&&!raw.includes('password'),'onsite_management_pending_secret');
  const value=JSON.parse(raw);
  assert.deepEqual(Object.keys(value).sort(),['version','siteId','authUserId','command'].sort());
  assert.equal(value.version,1);assert.equal(value.siteId,site);assert.equal(value.authUserId,authUserId);
  assert.deepEqual(Object.keys(value.command).sort(),['expectedWorkerId','expectedEmployeeId','operationId','locationId','action','expectedSequence'].sort());
  assert.equal(value.command.expectedEmployeeId,employeeId);assert.equal(value.command.expectedWorkerId,workerId);
  assert.equal(value.command.locationId,placeId);assert.equal(value.command.action,action);assert.equal(value.command.expectedSequence,sequence);
  assert.match(value.command.operationId,/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  return value.command;
}

export async function checkAttendanceOnsiteManagementShell({owner,newDevicePage,newEmployeePage,response,requests,exec,events,audits,employee,
  roleRpcCalls,employeeRpcCalls,onsitePrepared,site,employeeId,workerId,placeId,roleId,origin,actor,pass,holdResponse}){
  assert.equal(site,'99990001');assert.equal(events().length,0);assert.equal(audits().length,0);
  const endpoint=name=>'/api/merchant-enterprise/attendance/'+name,clock=endpoint('onsite-clock');
  const rows=(table,order='id')=>JSON.parse(exec(`select coalesce(jsonb_agg(to_jsonb(t) order by ${order}),'[]'::jsonb) from public.${table} t;`));
  const facts=()=>({events:rows('merchant_attendance_events','sequence'),receipts:rows('merchant_attendance_onsite_receipts','event_id')});
  const role=()=>JSON.parse(exec(`select to_jsonb(t) from public.merchant_enterprise_roles t where id='${roleId}' and merchant_id='${site}';`));
  const config=()=>exec(`select jsonb_build_object(
    'workers',(select jsonb_agg(to_jsonb(t) order by id) from public.merchant_attendance_workers t),
    'settings',(select jsonb_agg(to_jsonb(t) order by merchant_id) from public.merchant_attendance_settings t),
    'locations',(select jsonb_agg(to_jsonb(t) order by id) from public.merchant_attendance_locations t),
    'periods',(select jsonb_agg(to_jsonb(t) order by worker_id) from public.merchant_attendance_employment_periods t),
    'otherRoles',(select jsonb_agg(to_jsonb(t) order by id) from public.merchant_enterprise_roles t where id<>'${roleId}'),
    'boards',(select jsonb_agg(to_jsonb(t) order by id) from public.merchant_task_boards t),
    'columns',(select jsonb_agg(to_jsonb(t) order by id) from public.merchant_task_columns t));`);
  const originalConfig=config(),originalEmployee=employee(),originalRole=role();
  const call=async(page,name,button,method='GET',status=200)=>{const waiting=response(page,endpoint(name),method,status);await button.click();return (await waiting).json();};
  const admin=()=>owner.getByRole('region',{name:'考勤配置管理',exact:true}),terminal=()=>owner.getByRole('region',{name:'门店终端管理',exact:true});
  await owner.getByRole('button',{name:'考勤配置',exact:true}).click();await admin().waitFor();
  await call(owner,'terminals',admin().getByRole('button',{name:'门店终端配对',exact:true}));
  await call(owner,'admin',terminal().getByRole('button',{name:'读取工作地点',exact:true}));
  const label='合成生命周期现场码终端';
  await terminal().getByRole('combobox',{name:/^绑定工作地点/}).selectOption(placeId);
  await terminal().getByRole('textbox',{name:'终端名称',exact:true}).fill(label);
  await call(owner,'terminals',terminal().getByRole('button',{name:'生成五分钟配对码',exact:true}),'POST');
  const pairing=await terminal().getByRole('textbox',{name:'一次性配对码',exact:true}).inputValue(),terminalId=parseTerminalToken(pairing).terminalId;
  const device=await newDevicePage(),phone=await newEmployeePage();
  assert.equal((await device.context().cookies(origin)).length,0);assert.equal((await phone.context().cookies(origin)).length,0);
  const empty=response(device,endpoint('terminal-device'),'GET');await device.goto(origin+'/enterprise/attendance-terminal');assert.equal((await(await empty).json()).paired,false);
  await device.getByRole('textbox',{name:'粘贴一次性配对码',exact:true}).fill(pairing);
  await call(device,'terminal-device',device.getByRole('button',{name:'确认配对此浏览器',exact:true}),'POST');
  await device.getByRole('heading',{name:label,exact:true}).waitFor();
  const cookies=await device.context().cookies(origin);assert.equal(cookies.length,1);const cookie=cookies[0];
  assert.equal(cookie.name,TERMINAL_COOKIE);assert.equal(cookie.httpOnly,true);assert.equal(cookie.secure,true);assert.equal(cookie.sameSite,'Strict');
  assert(cookie.value!==pairing&&parseTerminalToken(cookie.value).terminalId===terminalId,'onsite_management_independent_cookie');
  const terminalFingerprint=()=>exec(`select md5(jsonb_build_object(
    'terminals',(select jsonb_agg(to_jsonb(t) order by id) from public.merchant_attendance_terminals t),
    'audit',(select jsonb_agg(to_jsonb(t) order by recorded_at,action) from public.merchant_attendance_terminal_audit t))::text);`);
  const pairedTerminalFingerprint=terminalFingerprint();
  await terminal().getByRole('button',{name:'隐藏并清除配对码',exact:true}).click();
  const issued=response(device,endpoint('onsite-code'),'POST');await device.getByRole('link',{name:'展示门店动态现场码（需已配对）',exact:true}).click();assert.equal((await(await issued).json()).ok,true);
  const imageAlt='门店动态现场码，请用本人手机扫描后登录并选择打卡动作';
  const qr=()=>device.getByRole('img',{name:imageAlt,exact:true}),confirmation=()=>phone.getByRole('region',{name:'本人现场打卡确认',exact:true});
  const pendingKey=onsiteClockPendingKey(site,actor.id),pending=()=>phone.evaluate(key=>sessionStorage.getItem(key),pendingKey);
  const posts=()=>requests.filter(row=>row.path===clock&&row.method==='POST'),accepted=[];
  let previous=facts(),lastImage=null;
  const usedNonces=new Set();
  const freshCode=async()=>{
    // Keep this display mounted: no reload/reset to evade its rolling2/minute
    // and5second limits. Real automatic refresh supplies new images/nonces.
    const deadline=Date.now()+90000;
    while(Date.now()<deadline){
      await device.waitForFunction(({alt,old})=>{const node=[...document.querySelectorAll('img')].find(img=>img.alt===alt);return node&&node.getAttribute('src')!==old;},
        {alt:imageAlt,old:lastImage},{timeout:Math.max(1,deadline-Date.now())});
      const image=await qr().getAttribute('src');lastImage=image;
      assert(typeof image==='string'&&image.startsWith('data:image/png;base64,'),'onsite_management_local_png_required');
      const raw=await sharp(Buffer.from(image.slice(image.indexOf(',')+1),'base64')).ensureAlpha().raw().toBuffer({resolveWithObject:true});
      assert.equal(raw.info.width,512);assert.equal(raw.info.height,512);
      const link=jsQR(new Uint8ClampedArray(raw.data),raw.info.width,raw.info.height)?.data;
      assert(typeof link==='string','onsite_management_png_must_decode');
      const parsed=parseOnsiteScanUrl(link,origin),claims=parsed.claims;
      assert(claims.siteId===site&&claims.terminalId===terminalId&&claims.locationId===placeId,'onsite_management_display_scope');
      assert.equal(claims.expiresAtMs-claims.issuedAtMs,45000);
      if(claims.expiresAtMs-Date.now()<15000||usedNonces.has(claims.nonce))continue;
      usedNonces.add(claims.nonce);return {link,claims};
    }
    throw Error('onsite_management_fresh_display_timeout');
  };
  const privacy=async()=>{
    for(const page of [owner,device,phone])assert(await page.evaluate(()=>{const raw=JSON.stringify({local:Object.entries(localStorage),session:Object.entries(sessionStorage)});
      return !raw.includes('aq1.')&&!raw.includes('pairSecret')&&!/\d{8}\.[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}/.test(raw)&&!raw.includes('Synthetic-attendance-only!');}),
    'onsite_management_persisted_capability');
    assert(new URL(phone.url()).hash==='','onsite_management_fragment_not_scrubbed');
    assert.equal((await phone.context().cookies(origin)).length,0);
    assert(await device.evaluate(()=>localStorage.length===0&&sessionStorage.length===0&&document.cookie===''),'onsite_management_device_account_state');
  };
  const paste=async code=>{
    if(!await phone.getByLabel('现场码链接',{exact:true}).isVisible())await phone.getByText('无法使用摄像头？粘贴现场码链接',{exact:true}).click();
    await phone.getByLabel('现场码链接',{exact:true}).fill(code.link);await phone.getByRole('button',{name:'读取现场码（不打卡）',exact:true}).click();
    await confirmation().getByText(/当前现场码剩余约/).waitFor();
    assert((await phone.getByLabel('现场码链接',{exact:true}).inputValue())==='','onsite_management_paste_not_cleared');await privacy();
  };
  const checkFacts=result=>{
    const current=facts();assertOnsiteManagementFacts(previous,current,{site,employeeId,workerId,placeId,terminalId,accepted});previous=current;
    assert.equal(config(),originalConfig);
    if(result?.receipt)assert(current.events.some(row=>row.id===result.receipt.id&&row.operation_id===result.receipt.operationId),'onsite_management_recovery_receipt_mismatch');
  };
  const add=(result,code)=>{
    assert.equal(result.ok,true);const matches=posts().filter(row=>row.status===200&&row.body.command.operationId===result.receipt.operationId);assert.equal(matches.length,1);
    accepted.push({result,claims:code.claims,command:matches[0].body.command});checkFacts(result);
  };
  const read=async(status=200)=>{
    const before=posts().length,value=await call(phone,'onsite-clock',confirmation().getByRole('button',{name:'只读核对当前状态／原操作',exact:true}),'GET',status);
    assert.equal(posts().length,before);
    if(status!==200){assert.deepEqual(value,{ok:false,error:'attendance_access_denied'});await confirmation().getByText(/^当前：/).waitFor({state:'detached'});}
    return value;
  };
  const showReceipt=async result=>{await confirmation().getByText('原操作收据：'+result.receipt.id,{exact:false}).waitFor();assert.equal(await pending(),null);};
  const tokenless=()=>confirmation().getByText('未持有可用现场码；可重新扫码，查询原结果无需扫码。',{exact:true}).waitFor();
  const commandFromPending=(raw,action,sequence)=>assertOnsiteManagementPending(raw,{site,authUserId:actor.id,employeeId,workerId,placeId,action,sequence});
  const employeeCard=()=>owner.getByText('合成员工甲',{exact:true}).locator('xpath=../../..');
  const prepareEmployee=async()=>{await owner.getByRole('button',{name:'员工账号',exact:true}).click();await employeeCard().getByRole('button',{name:/^(停用|恢复)$/}).waitFor();};
  const setEmployee=async disabled=>{
    const before=employee(),old=facts(),n=audits().length;
    if(disabled)await employeeCard().getByRole('button',{name:'停用',exact:true}).click();const changed=response(owner,'/api/merchant-enterprise/employees','PATCH');
    if(disabled)await owner.getByRole('dialog',{name:'安全停用员工',exact:true}).getByRole('button',{name:'停用并解除负责人',exact:true}).click();
    else await employeeCard().getByRole('button',{name:'恢复',exact:true}).click();
    await changed;await employeeCard().getByRole('button',{name:disabled?'恢复':'停用',exact:true}).waitFor();
    assert.equal(employee().version,before.version+1);assert.equal(employee().status,disabled?'disabled':'active');
    assert.deepEqual({...employee(),status:before.status,version:before.version,updated_at:before.updated_at},before);
    assert.equal(audits().length,n+1);assert(isDeepStrictEqual(facts(),old),'onsite_management_status_mutated_facts');checkFacts();
  };
  const roleBody=()=>owner.locator(`[id="role-editor-${roleId}-body"]`),clockPermission=()=>roleBody().locator(`[id="role-${roleId}-attendance.self.clock"]`);
  const openRole=async()=>{await owner.getByRole('button',{name:'角色权限',exact:true}).click();const expand=owner.locator(`button[aria-controls="role-editor-${roleId}-body"]`);
    if(await expand.getAttribute('aria-expanded')!=='true')await expand.click();await roleBody().getByRole('navigation',{name:'权限主要板块',exact:true}).getByRole('button',{name:/^员工考勤，/}).click();};
  const saveRole=async enabled=>{
    const before=role(),n=audits().length;await clockPermission().setChecked(enabled);
    const saved=response(owner,'/api/merchant-enterprise/roles','PATCH'),overview=response(owner,'/api/merchant-enterprise/overview','GET');
    await roleBody().getByRole('button',{name:'保存角色',exact:true}).click();await saved;await overview;await owner.getByText('角色已保存。',{exact:true}).waitFor();
    assert.equal(role().version,before.version+1);assert.deepEqual(sorted(role().permissions),sorted(enabled?full:viewOnly));
    assert.deepEqual({...role(),permissions:before.permissions,version:before.version,updated_at:before.updated_at},before);assert.equal(audits().length,n+1);checkFacts();
  };

  const firstCode=await freshCode();await phone.goto(firstCode.link);await phone.getByRole('heading',{name:'先登录本人员工账号',exact:true}).waitFor();
  assert(new URL(phone.url()).hash==='','onsite_management_fragment_not_scrubbed');assert.equal(posts().length,0);
  await phone.getByLabel('员工邮箱',{exact:true}).fill(actor.email);await phone.getByLabel('密码',{exact:true}).fill('Synthetic-attendance-only!');
  const loggedIn=response(phone,clock,'GET');await phone.getByRole('button',{name:'登录后核对打卡',exact:true}).click();const initial=await(await loggedIn).json();
  assert.equal(initial.employeeId,employeeId);assert.equal(initial.workerId,workerId);assert.equal(initial.state.sequence,0);
  await confirmation().getByText('当前：未上班',{exact:true}).waitFor();assert.equal(posts().length,0);await privacy();
  pass('actual owner creates terminal, independent browser pairs and renders local512px QR;390px phone scrubs fragment then uses actual SDK login and tokenless status without automatic attendance');
  // Login may consume most of the45seconds; never force an expired code through.
  const up=firstCode.claims.expiresAtMs-Date.now()>=15000?firstCode:await freshCode();await paste(up);
  const first=await call(phone,'onsite-clock',confirmation().getByRole('button',{name:'确认上班',exact:true}),'POST');add(first,up);await showReceipt(first);await tokenless();
  pass('explicit fresh-code clock-in writes one web-source fact and matching immutable onsite employee/terminal/nonce/command receipt; no capability survives the action');

  await prepareEmployee();const deniedCode=await freshCode();await paste(deniedCode);
  const preflight=holdResponse('GET');await confirmation().getByRole('button',{name:'确认开始休息',exact:true}).click();const authorized=await preflight.ready();assert.equal(authorized.state.sequence,1);
  await setEmployee(true);const refused=response(phone,clock,'POST',403);await preflight.release();assert.deepEqual(await(await refused).json(),{ok:false,error:'attendance_access_denied'});
  await confirmation().getByRole('status').filter({hasText:'原操作编号仍保留'}).waitFor();await tokenless();assert.equal(await confirmation().getByText(/^当前：/).count(),0);
  const deniedPending=await pending(),deniedCommand=commandFromPending(deniedPending,'break_start',1);assert.equal(posts().length,2);checkFacts();
  pass('actual employee disable after an authorized held preflight is rechecked on POST:403 clears onsite state/code, keeps exact principal-bound intent and adds no event or origin receipt');
  await setEmployee(false);const absent=await read();assert.equal(absent.receipt,null);assert.equal(absent.state.sequence,1);assert.equal(await pending(),deniedPending);await tokenless();
  assert(await confirmation().getByRole('button',{name:'核对后按原编号重试',exact:true}).isDisabled());
  const retryCode=await freshCode();await paste(retryCode);const retried=await call(phone,'onsite-clock',confirmation().getByRole('button',{name:'核对后按原编号重试',exact:true}),'POST');
  assert.equal(retried.receipt.operationId,deniedCommand.operationId);add(retried,retryCode);await showReceipt(retried);
  pass('same employee restore GET alone retains same-sequence unknown intent; only a genuinely new displayed QR plus explicit original-ID retry creates the single break-start');

  await openRole();await saveRole(false);const view=await read();assert.equal(view.state.status,'break');assert.equal(view.receipt,null);assert.equal(await pending(),null);
  const roleCode=await freshCode();await paste(roleCode);const roleDenied=await call(phone,'onsite-clock',confirmation().getByRole('button',{name:'确认结束休息',exact:true}),'POST',403);
  assert.deepEqual(roleDenied,{ok:false,error:'attendance_access_denied'});await confirmation().getByRole('status').filter({hasText:'原操作编号仍保留'}).waitFor();
  const rolePending=await pending(),finishCommand=commandFromPending(rolePending,'break_end',2);await tokenless();checkFacts();assert.equal(posts().length,4);
  pass('actual role editor removes self.clock while keeping self.view: onsite GET remains permitted, but explicit QR-authorized break-end POST is refused and its original intent retained');
  await saveRole(true);await prepareEmployee();const beforeRetry=await read();assert.equal(beforeRetry.receipt,null);assert.equal(await pending(),rolePending);
  const finishCode=await freshCode();await paste(finishCode);const gate=holdResponse('POST');await confirmation().getByRole('button',{name:'核对后按原编号重试',exact:true}).click();
  const late=await gate.ready();assert.equal(late.receipt.operationId,finishCommand.operationId);add(late,finishCode);assert.equal(await pending(),rolePending);
  await setEmployee(true);const beforeReload=posts().length,reload=response(phone,clock,'GET',403);await phone.reload();assert.deepEqual(await(await reload).json(),{ok:false,error:'attendance_access_denied'});
  await confirmation().getByRole('button',{name:'只读核对当前状态／原操作',exact:true}).waitFor();
  await gate.release();await phone.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  assert.equal(await confirmation().getByText(/^当前：/).count(),0);assert.equal(await confirmation().getByText(/原操作收据：/).count(),0);
  assert.equal(await pending(),rolePending);assert.equal(posts().length,beforeReload);await tokenless();checkFacts();await privacy();
  pass('restored role retry commits break-end once; second real employee disable plus explicit phone reload denies original GET, and released old success cannot revive attendance or erase pending');
  await setEmployee(false);const recovered=await read();assert.deepEqual(recovered.receipt,late.receipt);assert.equal(recovered.employeeId,employeeId);assert.equal(recovered.workerId,workerId);
  await showReceipt(recovered);await tokenless();assert.equal(posts().length,5);checkFacts(recovered);
  pass('same-member restore recovers the committed original break-end via authenticated GET without QR, fresh operation or repeat POST');
  const outCode=await freshCode();await paste(outCode);const ended=await call(phone,'onsite-clock',confirmation().getByRole('button',{name:'确认下班',exact:true}),'POST');
  assert.equal(ended.state.status,'off');add(ended,outCode);await showReceipt(ended);await tokenless();
  pass('a separately displayed fresh nonce and explicit clock-out complete four actions, each backed by its own exact immutable onsite receipt');

  assert.equal(posts().length,6);assert.equal(posts().filter(row=>row.status===403).length,2);assert.equal(posts().filter(row=>row.status===200).length,4);
  assert.equal(employeeRpcCalls.length,4);assert.equal(roleRpcCalls.length,2);assertPinManagementAudit(audits(),{site,employeeId,roleId});
  assert.equal(employee().version,originalEmployee.version+4);assert.deepEqual({...employee(),version:originalEmployee.version,updated_at:originalEmployee.updated_at},originalEmployee);
  assert.equal(role().version,originalRole.version+2);assert.deepEqual(sorted(role().permissions),sorted(originalRole.permissions));
  assert.deepEqual({...role(),permissions:originalRole.permissions,version:originalRole.version,updated_at:originalRole.updated_at},originalRole);
  assert.deepEqual(rows('merchant_attendance_terminal_audit','recorded_at,action').map(row=>row.action),['create','pair']);
  assert.equal(terminalFingerprint(),pairedTerminalFingerprint,'onsite_management_paired_terminal_or_audit_changed');
  assert.equal(rows('merchant_attendance_terminals').length,1);assert(onsitePrepared.calls.some(row=>row.name==='faolla_attendance_onsite_issue_v1'));
  assert(!JSON.stringify(requests).includes('aq1.'),'onsite_management_token_in_request_log');assert(!JSON.stringify(onsitePrepared.calls).includes('aq1.'),'onsite_management_token_in_rpc_log');
  await privacy();checkFacts();assert(await phone.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  pass('six exact management audits preserve account binding/configuration and prior facts; four source receipts, six explicit POSTs, no stored code, no time or limiter override and390px phone layout');
  return {events:4,onsiteReceipts:4,managementAudits:6,terminalAudit:2,onsitePosts:6,rejectedPosts:2,employeeChanges:4,roleChanges:2,
    freshDisplayCodes:usedNonces.size,originalFactsUnchanged:true,recovery:'authenticated-tokenless-GET',lateSuccessAfterExplicitReload:true};
}
