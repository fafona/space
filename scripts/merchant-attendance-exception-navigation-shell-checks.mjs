// Continues Phase78 in the owned synthetic namespace. The installed employee
// SDK, outer shell, exception UI, handlers and SQL are real; the second business
// root is an explicitly opt-in EMPTY read-only conversation fixture.
import assert from 'node:assert/strict';

async function bounded(work,label,ms=5000) {
  let timer;
  try {return await Promise.race([work,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(label)),ms);})]);}
  finally {clearTimeout(timer);}
}

export async function checkAttendanceExceptionNavigationShell({owner,admin,newPage,exec,transport,requests,pass,origin,site,actors,control}) {
  assert.equal(site,'99990001');
  const endpoint='/api/merchant-enterprise/attendance/location-discussion',businessPath='/api/merchant-peer-messages';
  const literal=value=>"'"+String(value).replaceAll("'","''")+"'";
  const rows=table=>JSON.parse(exec(`select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.${table} t;`));
  const events=rows('merchant_attendance_events'),target=events.find(row=>row.sequence===1);assert.equal(events.length,4);assert(target);
  const employeeId=target.actor_employee_id;
  const originalEmployee=JSON.parse(exec(`select to_jsonb(t) from public.merchant_enterprise_employees t where merchant_id='${site}' and id='${employeeId}';`));
  assert.equal(originalEmployee.auth_user_id,actors[2].id);assert.equal(originalEmployee.status,'active');
  const originalRole=JSON.parse(exec(`select to_jsonb(t) from public.merchant_enterprise_roles t where merchant_id='${site}' and id='${originalEmployee.role_id}';`));
  assert.equal(originalRole.status,'active');assert(originalRole.permissions.includes('attendance.self.clock'));assert(!originalRole.permissions.includes('conversations.view'));
  const originalReviews=rows('merchant_attendance_location_reviews'),originalMessages=rows('merchant_attendance_location_discussion');
  assert.equal(originalReviews.length,3);assert.equal(originalMessages.length,6);
  const protectedTables=['merchant_attendance_events','merchant_attendance_location_results','merchant_attendance_location_clock_notices','merchant_attendance_location_notice_acknowledgements','merchant_attendance_location_policy_drafts','merchant_attendance_location_notices','merchant_attendance_location_setup_operations','merchant_attendance_settings','merchant_attendance_locations','merchant_attendance_workers','merchant_attendance_config_operations','merchant_attendance_scopes','merchant_attendance_scope_grants','merchant_attendance_scope_workers','merchant_attendance_scope_locations','merchant_attendance_scope_operations','merchant_attendance_location_reviews'];
  const facts=()=>exec(`select jsonb_build_object(${protectedTables.map(table=>`'${table}',(select md5(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text)::text,'[]')) from public.${table} t)`).join(',')});`),baseline=facts();
  const messages=()=>rows('merchant_attendance_location_discussion');
  const preserved=()=>{assert.equal(facts(),baseline,'navigation_changed_original_attendance_facts');for(const row of originalMessages)assert.deepEqual(messages().find(value=>value.operation_id===row.operation_id),row,'navigation_rewrote_original_message');};
  const setPermissions=permissions=>exec(`update public.merchant_enterprise_roles set permissions=array[${permissions.map(literal).join(',')}]::text[],version=version+1 where merchant_id='${site}' and id='${originalRole.id}';`);
  const setStatus=status=>exec(`update public.merchant_enterprise_employees set status=${literal(status)} where merchant_id='${site}' and id='${employeeId}';`);
  const pendingKey=`faolla:attendance:discussion:v1:${site}:self:${employeeId}`;
  const firstRequest=requests.length,writes=()=>requests.slice(firstRequest).filter(row=>row.method==='POST'&&row.path.startsWith('/api/merchant-enterprise/attendance/'));
  const originalFlag=transport.state.navigationConversationsEnabled,originalDialogs=control.acceptDialogs,originalModule=transport.state.moduleEnabled;
  assert.equal(originalFlag,false);
  let employee=null,roleChanged=false,statusChanged=false;
  const dialogs=[],ownerDialogs=[],observeOwnerDialog=dialog=>ownerDialogs.push(dialog.message());
  try {
    setPermissions([...originalRole.permissions,'conversations.view']);roleChanged=true;
    transport.state.navigationConversationsEnabled=true;
    employee=await newPage({employee:true,mobile:true});
    await employee.addInitScript(()=>{const state={calls:0};Object.defineProperty(window,'__attendanceNavigationGps',{value:state});Object.defineProperty(navigator,'geolocation',{configurable:true,value:{getCurrentPosition(){state.calls++;throw Error('navigation_must_not_request_gps');},watchPosition(){state.calls++;throw Error('navigation_must_not_watch_gps');},clearWatch(){}}});});
    employee.on('dialog',dialog=>dialogs.push(dialog.message()));
    const workspace=()=>employee.getByRole('region',{name:'考勤异常工作区',exact:true});
    const panel=()=>employee.getByRole('region',{name:'定位异常说明与回复',exact:true});
    const input=()=>panel().getByRole('textbox',{name:/^补充说明/});
    const pending=()=>employee.evaluate(key=>sessionStorage.getItem(key),pendingKey);
    const settled=()=>bounded(employee.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))),'exception_navigation_settle_timeout');
    const done=({method='GET',mode='detail'}={})=>employee.waitForResponse(response=>{const url=new URL(response.url());return url.pathname===endpoint&&response.request().method()===method&&response.status()===200&&(method==='POST'||url.searchParams.get('mode')===mode);});
    const result=async response=>{const value=await (await response).json();assert.equal(value.ok,true);for(const review of originalReviews)assert(!JSON.stringify(value).includes(review.note),'navigation_private_note_leak');return value;};
    const openSidebar=async()=>{const trigger=employee.getByRole('button',{name:'打开员工工作区导航',exact:true});if(await trigger.isVisible())await trigger.click();};
    const rootButton=name=>employee.getByRole('navigation',{name:'员工工作区主导航',exact:true}).getByRole('button',{name,exact:true});
    const rootClick=async name=>{await openSidebar();await rootButton(name).click();await settled();};
    const enterException=async()=>{
      await employee.locator('[data-employee-merchant-main="1"]').waitFor();
      await employee.getByRole('navigation',{name:'企业管理功能',exact:true}).getByRole('button',{name:'我的考勤',exact:true}).click();
      const own=employee.getByRole('region',{name:'我的考勤',exact:true});await own.getByRole('button',{name:'刷新状态',exact:true}).waitFor();
      await own.getByRole('button',{name:'我的定位异常／提交说明',exact:true}).click();await panel().waitFor();
    };
    const login=async()=>{
      await employee.goto(origin+'/enterprise');await employee.getByLabel('员工邮箱',{exact:true}).fill(actors[2].email);await employee.getByLabel('密码',{exact:true}).fill('Synthetic-attendance-only!');
      await employee.getByRole('button',{name:'登录并选择企业',exact:true}).click();
      await employee.locator('article').filter({hasText:`企业编号 ${site}`}).getByRole('button',{name:'进入工作台',exact:true}).click();await employee.waitForURL(url=>url.pathname==='/enterprise/'+site);
    };
    const listAndSelect=async()=>{
      const day=target.occurred_at.slice(0,10);await panel().getByLabel('开始日期',{exact:true}).fill(day);await panel().getByLabel('结束日期',{exact:true}).fill(day);await panel().getByLabel('查询时区',{exact:true}).fill('UTC');
      const listing=done({mode:'list'});await panel().getByRole('button',{name:'查询／刷新首批',exact:true}).click();const list=await result(listing),index=list.items.findIndex(item=>item.eventId===target.id);assert(index>=0);
      const reading=done();await panel().locator('article').nth(index).getByRole('button',{name:'查看说明与回复',exact:true}).click();const detail=await result(reading);await input().waitFor();return detail;
    };
    const business=async()=>{
      const reply=employee.waitForResponse(response=>new URL(response.url()).pathname===businessPath&&response.status()===200);
      await rootClick('会话');const payload=await (await reply).json();assert.deepEqual(payload,{ok:true,currentMerchantId:site,contacts:[],threads:[],readState:{peerLastRead:{}}});
      await employee.locator('[data-employee-merchant-content="business"]').getByText('暂无普通会话。',{exact:true}).waitFor();assert.equal(await workspace().count(),0);
    };
    const recover=async(raw,enter)=>{
      const before=writes().length,start=requests.length,intent=JSON.parse(raw),reply=done();await enter();const detail=await result(reply);
      await panel().getByRole('status').filter({hasText:'已确认保存'}).waitFor();assert.equal(detail.receipt.operationId,intent.command.operationId);assert.equal(detail.receipt.note,intent.command.note);assert.equal(await pending(),null);assert.equal(writes().length,before);
      const ownRequests=requests.slice(start).filter(row=>row.path===endpoint);assert(ownRequests.length>=1);assert(ownRequests.every(row=>row.method==='GET'));assert(ownRequests.some(row=>row.query.operationId===intent.command.operationId));
      await panel().locator('ol > li').first().getByText(intent.command.note,{exact:true}).waitFor();assert.equal(messages().filter(row=>row.operation_id===intent.command.operationId).length,1);return detail;
    };
    const lostMessage=async(note,count)=>{
      await input().fill(note);await panel().getByRole('checkbox',{name:/^我确认将说明提交给企业负责人/}).check();control.lose=endpoint;
      const before=writes().length;await panel().getByRole('button',{name:'提交说明',exact:true}).click();await panel().getByRole('status').filter({hasText:'暂时无法确认结果或访问权限'}).waitFor();
      const raw=await pending();assert(raw);const intent=JSON.parse(raw);assert.equal(intent.actorId,employeeId);assert.equal(intent.query.access,'self');assert.equal(intent.query.siteId,site);assert.equal(intent.query.eventId,target.id);
      assert.equal(messages().length,count);assert.equal(messages().find(row=>row.operation_id===intent.command.operationId)?.note,note);assert.equal(writes().length,before+1);assert.equal(writes().at(-1).fault,'after-sql');return raw;
    };
    const revokeCapabilities=async()=>{
      const beforeDialogs=dialogs.length,beforeWrites=writes().length;control.acceptDialogs=false;statusChanged=true;setStatus('disabled');
      const denial=employee.waitForResponse(response=>new URL(response.url()).pathname==='/api/merchant-business/capabilities'&&response.status()===403);await employee.evaluate(()=>window.dispatchEvent(new Event('focus')));await denial;
      await employee.getByText('登录状态或角色权限已变化，请重新核验。',{exact:true}).waitFor();await settled();assert.equal(dialogs.length,beforeDialogs,'revocation_must_not_consult_leave_guard');assert.equal(await workspace().count(),0);assert.equal(writes().length,beforeWrites);
    };
    const restoreCapabilities=async()=>{
      setStatus(originalEmployee.status);statusChanged=false;const reply=employee.waitForResponse(response=>new URL(response.url()).pathname==='/api/merchant-business/capabilities'&&response.status()===200);
      await employee.getByRole('button',{name:'重新核验权限',exact:true}).click();await reply;
    };

    await login();await enterException();const initial=await listAndSelect();assert.equal(initial.item.revision,6);assert.equal(await pending(),null);
    const draft='合成跨业务导航草稿：取消保留，确认丢弃';await input().fill(draft);const beforeSame=dialogs.length;
    control.acceptDialogs=false;await rootClick('企业协作');assert.equal(dialogs.length,beforeSame);assert.equal(await input().inputValue(),draft);
    await rootClick('会话');assert.equal(dialogs.length,beforeSame+1);assert.match(dialogs.at(-1),/尚未提交/);assert.equal(await input().inputValue(),draft);assert.equal(await employee.locator('[data-employee-merchant-content="business"]').count(),0);assert.equal(writes().length,0);
    control.acceptDialogs=true;await business();assert.equal(dialogs.length,beforeSame+2);assert.match(dialogs.at(-1),/尚未提交/);assert.equal(await pending(),null);assert.equal(writes().length,0);
    await rootClick('企业协作');await enterException();await listAndSelect();assert.equal(await input().inputValue(),'');assert.equal(messages().length,6);preserved();
    pass('real 390px employee root navigation: same enterprise root is silent; cross-business draft cancel preserves text and accept discards only unsent text, with zero attendance or conversation POST');

    const firstRaw=await lostMessage('合成跨业务待确认说明：离开不会撤销原编号',7),beforePendingDialogs=dialogs.length;
    control.acceptDialogs=false;await rootClick('会话');assert.equal(dialogs.length,beforePendingDialogs+1);assert.match(dialogs.at(-1),/结果仍待确认/);assert.match(dialogs.at(-1),/不会撤销/);assert.equal(await pending(),firstRaw);assert.equal(writes().length,1);
    control.acceptDialogs=true;await business();assert.equal(dialogs.length,beforePendingDialogs+2);assert.match(dialogs.at(-1),/结果仍待确认/);assert.match(dialogs.at(-1),/不会撤销/);assert.equal(await pending(),firstRaw);
    const firstRecovered=await recover(firstRaw,async()=>{await rootClick('企业协作');await enterException();});assert.equal(firstRecovered.item.revision,7);
    const beforeClean=dialogs.length;control.acceptDialogs=false;await business();assert.equal(dialogs.length,beforeClean,'confirmed_clean_workspace_must_not_warn');assert.equal(await pending(),null);
    await rootClick('企业协作');await enterException();await listAndSelect();assert.equal(messages().length,7);preserved();
    pass('a committed reply lost in transport keeps exact account-owned pending bytes through both cross-business choices; re-entry GET recovers its original receipt without POST, and confirmed clean navigation produces no warning');

    const revokedDraft='合成权限撤销必须立即清除的未提交文字';await input().fill(revokedDraft);await revokeCapabilities();assert.equal(await pending(),null);assert(!(await employee.locator('body').innerText()).includes(revokedDraft));
    await restoreCapabilities();await enterException();await listAndSelect();assert.equal(await input().inputValue(),'');assert.equal(messages().length,7);preserved();
    pass('current membership capability403 clears an unsent dirty exception workspace without asking for navigation confirmation or saving the draft; explicit recheck opens a clean authorized view');

    const secondRaw=await lostMessage('合成权限撤销待确认说明：恢复后只读原收据',8);await revokeCapabilities();assert.equal(await pending(),secondRaw);assert(!(await employee.locator('body').innerText()).includes(JSON.parse(secondRaw).command.note));
    const secondRecovered=await recover(secondRaw,async()=>{await restoreCapabilities();await enterException();});assert.equal(secondRecovered.item.revision,8);assert.equal(writes().length,2);preserved();
    pass('capability403 also bypasses a pending leave guard, clears protected UI immediately and retains the exact uncertain operation; restored authority recovers it by GET only');

    const logoutRaw=await lostMessage('合成退出登录待确认说明：同一账号重新核对',9),beforeLogoutDialogs=dialogs.length;control.acceptDialogs=false;
    const loggedOut=employee.waitForResponse(response=>new URL(response.url()).pathname==='/auth/v1/logout'&&response.status()===204);await openSidebar();await employee.getByRole('button',{name:'退出员工登录',exact:true}).click();await loggedOut;
    await employee.waitForFunction(()=>![...Object.keys(sessionStorage),...Object.keys(localStorage)].some(key=>key.endsWith('-enterprise-auth-token')));
    await employee.getByRole('button',{name:'登录企业工作台',exact:true}).waitFor();await settled();assert.equal(dialogs.length,beforeLogoutDialogs,'logout_must_not_consult_leave_guard');assert.equal(await workspace().count(),0);assert.equal(await pending(),logoutRaw);assert.equal(writes().length,3);
    const stored=await employee.evaluate(()=>Object.keys(sessionStorage).filter(key=>key.startsWith('faolla:attendance:discussion:v1:')));assert.deepEqual(stored,[pendingKey]);
    const logoutRecovered=await recover(logoutRaw,async()=>{await login();await enterException();});assert.equal(logoutRecovered.item.revision,9);assert.equal(await panel().locator('ol > li').count(),9);assert.equal(writes().length,3);assert.equal(messages().length,9);preserved();
    assert.equal(await employee.evaluate(()=>window.__attendanceNavigationGps.calls),0);assert(await employee.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    const secondBusinessRequests=requests.slice(firstRequest).filter(row=>row.path===businessPath);assert(secondBusinessRequests.length>=3);assert(secondBusinessRequests.every(row=>row.method==='GET'&&row.status===200&&row.body===null));
    assert.deepEqual(rows('merchant_attendance_location_reviews'),originalReviews);
    pass('explicit employee logout bypasses pending navigation confirmation and removes SDK session keys while retaining only the employee-scoped receipt intent; same-account SDK login recovers by GET, with final events4/reviews3/messages9 and no GPS or business writes');

    // Admin keeps the parent settings form hidden (not unmounted) while an
    // exception sub-workspace is open. A clean child must not bypass that
    // existing parent draft boundary. The changed time zone is NEVER submitted.
    transport.state.moduleEnabled=true;control.acceptDialogs=true;
    await owner.getByRole('button',{name:'主管考勤范围',exact:true}).click();await owner.getByRole('region',{name:'考勤异常工作区',exact:true}).waitFor({state:'detached'});
    await owner.getByRole('button',{name:'考勤配置',exact:true}).click();
    const zoneInput=()=>admin(owner).getByLabel('企业考勤时区',{exact:true});await zoneInput().waitFor();
    const currentZone=JSON.parse(exec(`select to_jsonb(t) from public.merchant_attendance_settings t where merchant_id='${site}';`)).time_zone;
    assert.equal(await zoneInput().inputValue(),currentZone);const draftZone=currentZone==='Europe/Madrid'?'UTC':'Europe/Madrid';await zoneInput().fill(draftZone);
    const ownerWorkspace=()=>owner.getByRole('region',{name:'考勤异常工作区',exact:true});
    const openCleanOwnerException=async()=>{
      await admin(owner).getByRole('button',{name:'定位异常核查／员工说明',exact:true}).click();
      const review=owner.getByRole('region',{name:'定位异常核查',exact:true}),day=target.occurred_at.slice(0,10);await review.getByRole('button',{name:'查询异常',exact:true}).waitFor();
      await review.getByLabel('开始日期',{exact:true}).fill(day);await review.getByLabel('结束日期（含当天）',{exact:true}).fill(day);await review.getByRole('combobox',{name:/^核查状态/}).selectOption('all');
      const reply=owner.waitForResponse(response=>{const url=new URL(response.url());return url.pathname==='/api/merchant-enterprise/attendance/location-reviews'&&url.searchParams.get('mode')==='list'&&response.status()===200;});
      await review.getByRole('button',{name:'查询异常',exact:true}).click();assert.equal((await (await reply).json()).ok,true);
      await owner.waitForFunction(()=>Array.from(document.querySelectorAll('button')).some(button=>button.textContent==='查询异常'&&!button.disabled));
    };
    owner.on('dialog',observeOwnerDialog);const beforeOwnerWrites=writes().length;await openCleanOwnerException();control.acceptDialogs=false;
    await owner.getByRole('button',{name:'主管考勤范围',exact:true}).click();assert.equal(ownerDialogs.length,1);assert.match(ownerDialogs[0],/考勤配置/);assert.match(ownerDialogs[0],/未提交/);
    await ownerWorkspace().waitFor();await ownerWorkspace().getByRole('button',{name:'返回考勤',exact:true}).click();await zoneInput().waitFor();assert.equal(await zoneInput().inputValue(),draftZone);
    await openCleanOwnerException();control.acceptDialogs=true;await owner.getByRole('button',{name:'主管考勤范围',exact:true}).click();await ownerWorkspace().waitFor({state:'detached'});assert.equal(ownerDialogs.length,2);assert.match(ownerDialogs[1],/未提交/);
    await owner.getByRole('button',{name:'考勤配置',exact:true}).click();await zoneInput().waitFor();assert.equal(await zoneInput().inputValue(),currentZone);assert.equal(writes().length,beforeOwnerWrites);assert.equal(messages().length,9);preserved();
    pass('a clean owner exception child still protects its hidden parent settings draft: one cancel keeps the edited time zone, one accept discards it, and re-entry shows the unchanged SQL setting with zero config POST');
  } catch(error) {
    // Only rendered synthetic text, never form values, storage, URL or tokens.
    if(employee&&!employee.isClosed())console.error('EXCEPTION_NAVIGATION_SYNTHETIC_DOM',(await bounded(employee.locator('body').innerText(),'exception_navigation_diagnostics_timeout',3000).catch(()=>'')).slice(-1800));
    throw error;
  } finally {
    control.acceptDialogs=originalDialogs;control.lose=null;control.unsent=null;
    transport.state.navigationConversationsEnabled=originalFlag;
    transport.state.moduleEnabled=originalModule;owner.off('dialog',observeOwnerDialog);
    try {
      try {if(statusChanged)setStatus(originalEmployee.status);} finally {if(roleChanged)setPermissions(originalRole.permissions);}
    } finally {if(employee)await bounded(employee.context().close(),'exception_navigation_employee_close_timeout');}
  }
}
