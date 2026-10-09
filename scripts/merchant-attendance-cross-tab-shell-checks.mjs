// Local same-context SDK isolation acceptance. The legacy diagnostic export is
// retained for the historical, unguarded build; it is not a success assertion.
// Only synthetic identities are used. No auth state or SDK events are injected.
import assert from 'node:assert/strict';

export function assertCrossTabIdentityMismatch({storedAccount,pageAccount,requestAccount,worker,expectedA,expectedB,workerB}){
  assert.notEqual(expectedA,expectedB);
  assert.deepEqual(storedAccount,[expectedA],'cross_tab_original_storage_not_preserved');
  assert.equal(pageAccount,expectedB,'cross_tab_foreign_page_identity_not_reproduced');
  assert.equal(requestAccount,expectedB,'cross_tab_foreign_request_not_reproduced');
  assert.equal(worker,workerB,'cross_tab_foreign_worker_not_reproduced');
  return {storageAndPageIdentityDiverged:true,foreignPrincipalUsedForRead:true};
}

export async function diagnoseAttendanceCrossTabShell({phone,newSiblingPage,response,requests,exec,events,audits,prepared,origin,actors,tabId,pass}){
  const c=prepared.consts,endpoint='/api/merchant-enterprise/attendance/self',overview='/api/merchant-enterprise/overview';
  const stored=page=>page.evaluate(()=>Object.keys(sessionStorage).filter(key=>key.endsWith('-enterprise-auth-token'))
    .map(key=>{try{return JSON.parse(sessionStorage.getItem(key)).user?.id??null;}catch{return null;}}));
  const facts=()=>exec("select md5(jsonb_build_object("+
    "'employees',(select jsonb_agg(to_jsonb(t) order by id) from public.merchant_enterprise_employees t),"+
    "'workers',(select jsonb_agg(to_jsonb(t) order by id) from public.merchant_attendance_workers t),"+
    "'roles',(select jsonb_agg(to_jsonb(t) order by id) from public.merchant_enterprise_roles t),"+
    "'settings',(select jsonb_agg(to_jsonb(t) order by merchant_id) from public.merchant_attendance_settings t),"+
    "'locations',(select jsonb_agg(to_jsonb(t) order by id) from public.merchant_attendance_locations t))::text);");
  const baseline=facts(),documentOrigin=await phone.evaluate(()=>performance.timeOrigin);
  const safe=()=>{assert.equal(facts(),baseline);assert.deepEqual(events(),[]);assert.deepEqual(audits(),[]);
    assert.equal(requests.filter(row=>row.path.startsWith('/api/merchant-enterprise/attendance/')&&row.method!=='GET').length,0);};
  const self=page=>page.getByRole('region',{name:'我的考勤',exact:true});
  assert.deepEqual(await stored(phone),[c.authUsers.a]);
  await self(phone).getByText(c.labels.a+' · 仅记录本人打卡',{exact:true}).waitFor();safe();
  const sibling=await newSiblingPage();assert.equal(sibling.context(),phone.context());assert.notEqual(tabId(sibling),tabId(phone));
  await sibling.goto(origin+'/enterprise/'+c.site);
  await sibling.getByLabel('员工邮箱',{exact:true}).waitFor();assert(await sibling.evaluate(()=>window.opener===null));
  assert.deepEqual(await stored(sibling),[]);assert.deepEqual(await stored(phone),[c.authUsers.a]);
  pass('diagnostic baseline: two same-context, same-origin pages have no opener; A is logged in while the new sibling has no saved employee session');

  // Observe the unchanged SDK's broadcast. Do not send a forged channel message,
  // rewrite auth storage, activate another SDK, or bring either page to front.
  const aChanged=phone.waitForResponse(async reply=>new URL(reply.url()).pathname===overview&&reply.request().method()==='GET'
    &&reply.status()===200&&(await reply.json()).actor?.id===c.employees.b,{timeout:12000});
  void aChanged.catch(()=>{});
  const bReady=response(sibling,overview,'GET');
  const b=actors.find(actor=>actor.id===c.authUsers.b);assert(b);
  await sibling.getByLabel('员工邮箱',{exact:true}).fill(b.email);
  await sibling.getByLabel('密码',{exact:true}).fill('Synthetic-attendance-only!');
  await sibling.getByRole('button',{name:'登录企业工作台',exact:true}).click();
  assert.equal((await(await bReady).json()).actor.id,c.employees.b);
  const aActor=(await(await aChanged).json()).actor;assert.equal(aActor.id,c.employees.b);
  assert.deepEqual(await stored(phone),[c.authUsers.a]);assert.deepEqual(await stored(sibling),[c.authUsers.b]);
  assert.equal(await phone.evaluate(()=>performance.timeOrigin),documentOrigin);safe();
  pass('DEFECT REPRODUCED: B login in the sibling causes the original A page to accept B overview without a local A-page login; A sessionStorage still belongs to A');

  const read=response(phone,endpoint,'GET');
  const button=phone.getByRole('navigation',{name:'企业管理功能',exact:true}).getByRole('button',{name:'我的考勤',exact:true});
  if(!await button.isVisible())await phone.getByRole('button',{name:'打开员工工作区导航',exact:true}).click();
  await button.click();const result=await(await read).json();
  await self(phone).getByText(c.labels.b+' · 仅记录本人打卡',{exact:true}).waitFor();
  const aRequest=requests.filter(row=>row.tabId===tabId(phone)&&row.path===endpoint&&row.method==='GET').at(-1);assert(aRequest);
  const proof=assertCrossTabIdentityMismatch({storedAccount:await stored(phone),pageAccount:c.authUsers.b,requestAccount:aRequest.actorId,
    worker:result.workerId,expectedA:c.authUsers.a,expectedB:c.authUsers.b,workerB:c.workers.b});
  assert.equal(result.ok,true);assert.equal(result.state.sequence,0);assert.equal(result.receipt,null);
  assert.equal(await phone.evaluate(()=>performance.timeOrigin),documentOrigin);safe();
  pass('DEFECT REPRODUCED: original A page sends B principal to the actual self handler and reads B worker, while its own stored SDK account remains A; zero punches and unchanged database');
  return {...proof,isolationPassed:false,defectReproduced:true,sameBrowserContext:true,openerAbsent:true,
    sameOriginalDocument:true,attendanceEvents:0,attendanceWrites:0,managementAudits:0,configurationUnchanged:true};
}

export function assertCrossTabIsolatedRead({storedAccounts,visibleLabels,requestAccount,result,expectedAccount,expectedWorker,expectedLabel,site,place}){
  assert.deepEqual(storedAccounts,[expectedAccount],'cross_tab_saved_identity_changed');
  assert.deepEqual(visibleLabels,[expectedLabel+' · 仅记录本人打卡'],'cross_tab_visible_identity_changed');
  assert.equal(requestAccount,expectedAccount,'cross_tab_request_identity_changed');
  assert.equal(result.ok,true);assert.equal(result.workerId,expectedWorker);assert.equal(result.locationId,place);
  assert.equal(result.receipt,null);assert.equal(result.replayed,false);
  assert.deepEqual(result.state,{status:'off',sequence:0,lastEvent:null});
  // Self's current envelope has no siteId; the exact HTTP query carries it.
  assert.equal(site,'99990001');
}

export function assertCrossTabRequestIsolation(requests,tabAccounts){
  const ids=Object.keys(tabAccounts);assert.equal(ids.length,2);assert.notEqual(tabAccounts[ids[0]],tabAccounts[ids[1]]);
  for(const row of requests){
    if(!Object.hasOwn(tabAccounts,row.tabId))continue;
    if(row.path.startsWith('/api/merchant-enterprise/attendance/')){
      assert.equal(row.method,'GET','cross_tab_unexpected_attendance_write');
      assert.equal(row.actorId,tabAccounts[row.tabId],'cross_tab_foreign_attendance_principal');
      assert.equal(row.status,200,'cross_tab_attendance_read_failed');
    }
    if(row.path==='/api/merchant-enterprise/overview'){
      assert.equal(row.method,'GET');assert.equal(row.status,200,'cross_tab_overview_failed');
      assert.equal(row.actorId,tabAccounts[row.tabId],'cross_tab_foreign_overview_principal');
    }
  }
}

export async function checkAttendanceCrossTabShell({phone,newSiblingPage,response,requests,exec,events,audits,prepared,origin,actors,tabId,pass}){
  const c=prepared.consts,endpoint='/api/merchant-enterprise/attendance/self',overview='/api/merchant-enterprise/overview';
  assert.equal(c.site,'99990001');assert.notEqual(c.authUsers.a,c.authUsers.b);assert.notEqual(c.workers.a,c.workers.b);
  const self=page=>page.getByRole('region',{name:'我的考勤',exact:true});
  const nav=page=>page.getByRole('navigation',{name:'企业管理功能',exact:true});
  const stored=page=>page.evaluate(()=>Object.keys(sessionStorage).filter(key=>key.endsWith('-enterprise-auth-token'))
    .map(key=>{try{return JSON.parse(sessionStorage.getItem(key)).user?.id??null;}catch{return null;}}));
  const originOf=page=>page.evaluate(()=>performance.timeOrigin);
  const facts=()=>exec('select md5(jsonb_build_object('+[
    'merchants','merchant_enterprise_employees','merchant_enterprise_roles','merchant_enterprise_role_boards',
    'merchant_attendance_workers','merchant_attendance_employment_periods','merchant_attendance_settings','merchant_attendance_locations',
    'merchant_attendance_config_operations','merchant_attendance_scopes','merchant_attendance_scope_grants','merchant_attendance_scope_operations',
    'merchant_task_boards','merchant_task_columns','merchant_tasks','merchant_task_assignees',
  ].map(table=>`'${table}',(select jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text) from public.${table} t)`).join(',')+')::text);');
  const baseline=facts(),aOrigin=await originOf(phone);
  const safe=()=>{assert.equal(facts(),baseline,'cross_tab_configuration_changed');assert.deepEqual(events(),[]);assert.deepEqual(audits(),[]);
    assert.equal(requests.filter(row=>row.path.startsWith('/api/merchant-enterprise/attendance/')&&row.method!=='GET').length,0);
    assertCrossTabRequestIsolation(requests,tabAccounts);};
  const show=async(page,button)=>{if(!await button.isVisible())await page.getByRole('button',{name:'打开员工工作区导航',exact:true}).click();await button.waitFor({state:'visible'});};
  const waitForRead=(page,path)=>{
    const waiting=response(page,path,'GET').then(async reply=>{assert.equal(new URL(reply.url()).origin,origin);return reply.json();});
    void waiting.catch(()=>{});return waiting;
  };
  const read=async(page,member)=>{
    const waiting=waitForRead(page,endpoint);
    if(await self(page).count())await self(page).getByRole('button',{name:'刷新状态',exact:true}).click();
    else{const button=nav(page).getByRole('button',{name:'我的考勤',exact:true});await show(page,button);await button.click();}
    const result=await waiting;
    await self(page).getByText(c.labels[member]+' · 仅记录本人打卡',{exact:true}).waitFor();
    await self(page).getByRole('button',{name:'刷新状态',exact:true}).waitFor();
    const request=requests.filter(row=>row.tabId===tabId(page)&&row.path===endpoint&&row.method==='GET').at(-1);assert(request);
    assert.equal(request.query.siteId,c.site);assert.equal(request.query.operationId,undefined);
    assertCrossTabIsolatedRead({storedAccounts:await stored(page),visibleLabels:await self(page).locator('p').filter({hasText:'仅记录本人打卡'}).allTextContents(),
      requestAccount:request.actorId,result,expectedAccount:c.authUsers[member],expectedWorker:c.workers[member],expectedLabel:c.labels[member],site:c.site,place:c.place});
    assert(!((await self(page).innerText()).includes(c.labels[member==='a'?'b':'a'])),'cross_tab_other_employee_visible');safe();
  };
  const login=async(page,member)=>{
    const actor=actors.find(value=>value.id===c.authUsers[member]);assert(actor);const previousOrigin=await originOf(page);
    await page.getByLabel('员工邮箱',{exact:true}).fill(actor.email);await page.getByLabel('密码',{exact:true}).fill('Synthetic-attendance-only!');
    const waiting=waitForRead(page,overview);await page.getByRole('button',{name:'登录企业工作台',exact:true}).click();
    const payload=await waiting;assert.equal(payload.actor.type,'employee');assert.equal(payload.actor.id,c.employees[member]);
    await nav(page).waitFor({state:'attached'});assert.equal(await originOf(page),previousOrigin,'cross_tab_login_reloaded_document');
    assert.deepEqual(await stored(page),[c.authUsers[member]]);safe();
  };
  const signedOut=async page=>{
    await page.getByLabel('员工邮箱',{exact:true}).waitFor();await page.getByRole('button',{name:'登录企业工作台',exact:true}).waitFor();
    await page.waitForFunction(()=>!Object.keys(sessionStorage).some(key=>key.endsWith('-enterprise-auth-token')));
    assert.deepEqual(await stored(page),[]);assert.equal(await self(page).count(),0);assert.equal(await nav(page).count(),0);
    assert.equal(new URL(page.url()).pathname,'/enterprise/'+c.site);safe();
  };
  const logout=async page=>{
    const previousOrigin=await originOf(page),button=page.getByRole('button',{name:'退出员工登录',exact:true});await show(page,button);
    const waiting=page.waitForResponse(reply=>new URL(reply.url()).origin===origin&&new URL(reply.url()).pathname==='/auth/v1/logout'&&reply.request().method()==='POST');
    void waiting.catch(()=>{});await button.click();assert.equal((await waiting).status(),204);await signedOut(page);
    assert.equal(await originOf(page),previousOrigin,'cross_tab_logout_reloaded_document');
  };
  const reload=async(page,member)=>{
    const previousOrigin=await originOf(page),waiting=waitForRead(page,overview);await page.reload();
    const payload=await waiting;assert.equal(payload.actor.type,'employee');assert.equal(payload.actor.id,c.employees[member]);
    await nav(page).waitFor({state:'attached'});assert.notEqual(await originOf(page),previousOrigin,'cross_tab_reload_not_observed');
    assert(await page.evaluate(()=>window.opener===null));await read(page,member);
  };
  // Every checkpoint performs real application/SQL reads in both directions.
  // Full request history also catches a transient foreign overview, even when
  // later UI state happens to recover. No sleep is treated as isolation proof.
  const pair=async()=>{await read(phone,'a');await read(sibling,'b');await read(phone,'a');safe();};
  assert.deepEqual(await stored(phone),[c.authUsers.a]);await self(phone).getByText(c.labels.a+' · 仅记录本人打卡',{exact:true}).waitFor();
  assert(await phone.evaluate(()=>window.opener===null));
  const sibling=await newSiblingPage();assert.equal(sibling.context(),phone.context());assert.notEqual(tabId(sibling),tabId(phone));
  const tabAccounts={[tabId(phone)]:c.authUsers.a,[tabId(sibling)]:c.authUsers.b};
  // Pages are owned by the shared runner's browser cleanup; never close the
  // original context here or hide a failure from its bounded DOM diagnostics.
  await sibling.goto(origin+'/enterprise/'+c.site);await signedOut(sibling);const bOrigin=await originOf(sibling);
  assert(await sibling.evaluate(()=>window.opener===null));await read(phone,'a');assert.equal(await originOf(phone),aOrigin);safe();
  pass('two same-context/no-opener pages start with only A logged in; B has no saved session, while real A self GET and unchanged SQL facts establish the baseline');

  await login(sibling,'b');await pair();assert.equal(await originOf(phone),aOrigin);assert.equal(await originOf(sibling),bOrigin);
  pass('B actual SDK password login leaves A storage, visible employee and real self request principal at A; reciprocal A/B/A reads and every recorded overview/self request remain tab-owned');

  // Existing fixture toolbar invokes the same application's real SDK instance.
  // Inspect only Auth response status; never read/log its returned credentials.
  const refreshed=sibling.waitForResponse(reply=>{
    const url=new URL(reply.url());return url.origin===origin&&url.pathname==='/auth/v1/token'
      &&url.searchParams.get('grant_type')==='refresh_token'&&reply.request().method()==='POST';
  });void refreshed.catch(()=>{});
  const refreshedOverview=waitForRead(sibling,overview);
  await sibling.getByRole('button',{name:'验收 SDK 刷新会话',exact:true}).click();assert.equal((await refreshed).status(),200);
  const renewed=await refreshedOverview;assert.equal(renewed.actor.type,'employee');assert.equal(renewed.actor.id,c.employees.b);
  await nav(sibling).waitFor({state:'attached'});await pair();assert.equal(await originOf(phone),aOrigin);assert.equal(await originOf(sibling),bOrigin);
  pass('existing fixture toolbar runs the actual SDK refresh-token exchange and B authorized overview; A/B/A real self reads remain isolated, without inspecting or injecting returned Auth credentials');

  await logout(sibling);await read(phone,'a');await signedOut(sibling);assert.equal(await originOf(phone),aOrigin);assert.equal(await originOf(sibling),bOrigin);
  pass('B actual UI logout clears only its employee session and DOM; A stays logged in and its explicit real self refresh still reads A, with no attendance write');

  await reload(phone,'a');await signedOut(sibling);await login(sibling,'b');await pair();assert.equal(await originOf(sibling),bOrigin);
  pass('A full document reload restores its own saved SDK session while B remains logged out; B re-login and reciprocal real reads stay isolated without injected auth events or storage');

  await logout(phone);await read(sibling,'b');await reload(sibling,'b');await signedOut(phone);await login(phone,'a');await pair();safe();
  assert(await phone.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert(await sibling.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  pass('the reverse direction also holds: A logout/re-login cannot replace B, and B full reload retains its own session; all observed reads are correctly bound and database/configuration remains unchanged');
  return {isolationPassed:true,defectReproduced:false,sameBrowserContext:true,openerAbsent:true,independentDocumentReloads:2,
    logoutOperations:2,passwordLoginsInCheck:3,sessionRefreshes:1,attendanceEvents:0,attendanceWrites:0,managementAudits:0,configurationUnchanged:true,
    crossTabReadPrincipalsIsolated:true,syntheticAuthAndEntitlement:true,realAuthService:false,productionAccess:false};
}
