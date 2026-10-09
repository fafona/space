// Opt-in actual AdminClient/Portal/forms -> handlers/default executors -> owned
// local SQL. Auth, merchant bootstrap and platform eligibility remain modeled.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import net from 'node:net';
import {chromium} from 'playwright';
import {runAttendanceLabelsReuse} from './merchant-attendance-choice-labels-reuse-native.mjs';
import {withAttendanceConcurrencySandbox} from './merchant-attendance-concurrency-sandbox.mjs';
import {prepareAttendanceOnboardingUiFixture} from './merchant-attendance-onboarding-ui-fixture.mjs';
import {createInitialPasswordAuthModel} from './merchant-attendance-initial-password-native.mjs';
import {createInitialPasswordAuthBridge} from './merchant-attendance-initial-password-auth-bridge.mjs';
import {assertOnboardingEnrollment} from './merchant-attendance-onboarding-native.mjs';
import {runAttendanceCleanupSteps} from './fixtures/attendance-cleanup.mjs';
const require=createRequire(import.meta.url);
const {withAttendanceApplicationAuth}=require('./fixtures/attendance-application-auth.ts');
const {serveAttendanceMerchantBootstrap}=require('./fixtures/attendance-merchant-shell-transport.ts');
const {MERCHANT_AUTH_COOKIE}=require('../src/lib/merchantAuthSession.ts');
const {createMerchantEnterpriseInitialPasswordHandler}=require('../src/app/api/merchant-enterprise/invitations/initial-password/route-handler.ts');
const {resolveValidatedMerchantEnterpriseAuthUser,requireMerchantEnterpriseEntitlement}=require('../src/lib/merchantEnterpriseAuth.server.ts');
const {POST:accept}=require('../src/app/api/merchant-enterprise/employees/accept/route-handler.ts');
const {GET:overview}=require('../src/app/api/merchant-enterprise/overview/route-handler.ts');
const {PATCH:updateRole}=require('../src/app/api/merchant-enterprise/roles/route-handler.ts');
const {handleAttendanceAdmin}=require('../src/app/api/merchant-enterprise/attendance/admin/route-handler.ts');
const {handleAttendanceSelf}=require('../src/app/api/merchant-enterprise/attendance/self/route-handler.ts');
const {resolveMerchantBusinessActor}=require('../src/lib/merchantBusinessActor.server.ts');
const {handleMerchantBusinessCapabilitiesGet}=require('../src/app/api/merchant-business/capabilities/route-handler.ts');
const origin='https://127.0.0.1:3131',staticOrigin='http://127.0.0.1:3131',canonical='https://www.faolla.com';
const site='99990001',roleId='00000000-0000-4000-8000-000000000030',password='Synthetic-new-staff-only!2026';
const prefix='/api/merchant-enterprise/',setupPath=prefix+'invitations/initial-password',acceptPath=prefix+'employees/accept';
const adminPath=prefix+'attendance/admin',selfPath=prefix+'attendance/self',rolePath=prefix+'roles',overviewPath=prefix+'overview';
const localFetch=globalThis.fetch;
const bounded=async(promise,label)=>{let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(label)),20000);})]);}finally{clearTimeout(timer);}};

export function assertOnboardingUiPunch({before,after,body,employeeId,workerId,locationId,operationId}){
  assert.equal(before.events.length,0);assert.equal(after.events.length,1);
  assert.deepEqual({...after,events:before.events},before);
  const event=after.events[0];assert.equal(event.merchant_id,site);assert.equal(event.actor_employee_id,employeeId);
  assert.equal(event.worker_id,workerId);assert.equal(event.location_id,locationId);assert.equal(event.operation_id,operationId);
  assert.equal(event.source,'web');assert.equal(event.action,'clock_in');assert.equal(event.sequence,1);
  assert.equal(body.ok,true);assert.equal(body.workerId,workerId);assert.equal(body.locationId,locationId);assert.equal(body.replayed,false);
  assert.equal(body.state.status,'working');assert.equal(body.state.sequence,1);assert.deepEqual(body.state.lastEvent,body.receipt);
  const receipt=body.receipt;
  for(const [dto,raw] of [['id','id'],['siteId','merchant_id'],['workerId','worker_id'],['locationId','location_id'],['operationId','operation_id'],['action','action'],['sequence','sequence'],['timeZone','time_zone'],['breakPaid','break_paid']])assert.equal(receipt[dto],event[raw]);
  assert.equal(receipt.timeZone,'Europe/Madrid');assert(Number.isFinite(Date.parse(event.occurred_at)));
  assert.equal(Date.parse(receipt.occurredAt),Date.parse(event.occurred_at));
}

// Never record setup passwords, invitation tokens, auth bodies, URL fragments or
// arbitrary payload properties. Admin/self commands contain synthetic input only.
export function onboardingBrowserRecord(pathname,method,status,payload,input,query={}){
  const record={path:pathname,method,status,error:typeof payload?.error==='string'&&/^[a-z_]{1,80}$/.test(payload.error)?payload.error:null};
  if([adminPath,selfPath].includes(pathname)){
    if(input){
      const pick=(value,keys)=>Object.fromEntries(keys.filter(key=>Object.hasOwn(value,key)).map(key=>[key,structuredClone(value[key])]));
      record.operationId=input.operationId;
      record.command=pick(input,pathname===selfPath?['siteId','expectedWorkerId','operationId','locationId','action','expectedSequence']:['siteId','operationId','expectedVersion','kind']);
      if(pathname===adminPath&&input.values&&typeof input.values==='object'){
        const fields={settings:['timeZone','enabled','webClockEnabled','webBreakPaid'],location:['id','name','timeZone','active'],worker:['id','employeeId','workerNo','displayName','locationId','active','startsOn']}[input.kind];
        if(fields)record.command.values=pick(input.values,fields);
      }
    }
    if(query.operationId)record.recoveryOperationId=query.operationId;
  }
  return record;
}

export async function checkAttendanceOnboardingBrowser(native){
  await withAttendanceConcurrencySandbox(native,async scope=>{
    const prepared=await prepareAttendanceOnboardingUiFixture(native,scope),invite=prepared.invitations[1],model=createInitialPasswordAuthModel(invite.actor);
    const initial=prepared.uiFacts(),baseline=prepared.onboardingProtectedFingerprint();
    const safe=()=>assert.equal(prepared.onboardingProtectedFingerprint(),baseline);
    const probe=net.createServer();await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(3131,'127.0.0.1',resolve);});await new Promise(resolve=>probe.close(resolve));
    const child=spawn(process.execPath,['scripts/attendance-self-browser-harness.mjs','--merchant-shell','--database-entry'],{cwd:native.root,windowsHide:true,stdio:['ignore','pipe','pipe']});
    let browser,closing=false,phase='harness',dropWorker=false,dropPunch=false;
    const requests=[],errors=[],external=[],pendingRoutes=new Set(),commits=[];
    const savedMode=process.env.FAOLLA_PLATFORM_SNAPSHOT_WRITE_MODE;process.env.FAOLLA_PLATFORM_SNAPSHOT_WRITE_MODE='off';
    child.stderr.on('data',()=>errors.push('harness_stderr'));
    try{
      await bounded(new Promise((resolve,reject)=>{let output='';child.stdout.on('data',value=>{output+=String(value);if(output.includes('Attendance synthetic component QA'))resolve();});child.once('error',()=>reject(Error('harness_start_failed')));child.once('exit',()=>reject(Error('harness_exited')));}), 'onboarding_browser_harness_timeout');
      assert.equal((await localFetch(staticOrigin+adminPath,{method:'POST'})).status,403);
      browser=await chromium.launch({headless:true});
      await withAttendanceApplicationAuth(prepared.onboardingActors,prepared.uiRpc,async protocol=>{
        const ownerToken=await protocol.login(prepared.owner),protocolFetch=globalThis.fetch;
        const bridge=createInitialPasswordAuthBridge(protocolFetch,invite.actor,model);
        globalThis.fetch=async(input,init)=>{
          const request=new Request(input,init),url=new URL(request.url);
          if(url.origin==='https://attendance-auth.invalid'&&url.pathname==='/auth/v1/user'&&request.method==='GET'&&request.headers.get('authorization')==='Bearer '+ownerToken)return protocolFetch(request);
          return bridge.fetch(request);
        };
        try{
          const entitlement=value=>requireMerchantEnterpriseEntitlement(value,async()=>[{id:site,permissionConfig:{allowEnterpriseManagement:true,allowEmployeeAttendance:true}}]);
          const setupCall=kind=>input=>prepared.initialPasswordRpc(`faolla_${kind}_merchant_employee_initial_password_setup_v1`,{p_input:{merchant_id:input.siteId,auth_user_id:input.authUserId,invitation_version:input.invitationVersion,token_hash:input.tokenHash,operation_id:input.operationId,password_fingerprint:input.passwordFingerprint}});
          const setup=createMerchantEnterpriseInitialPasswordHandler({resolveAuthUser:resolveValidatedMerchantEnterpriseAuthUser,loadInvitation:prepared.loadInvitation,loadRole:prepared.loadRole,loadStaffIdentity:prepared.loadStaffIdentity,getAuthUserById:model.getAuthUserById,updateAuthUserById:model.updateAuthUserById,claimInitialPasswordSetup:setupCall('claim'),completeInitialPasswordSetup:setupCall('complete'),releaseInitialPasswordSetup:setupCall('release'),now:()=>new Date()});
          const newPage=async owner=>{
            const context=await browser.newContext({viewport:owner?{width:1280,height:960}:{width:390,height:844},isMobile:!owner,hasTouch:!owner,serviceWorkers:'block'});
            await context.addInitScript(()=>localStorage.setItem('merchant-space:locale:v1','zh-CN'));
            if(owner)await context.addCookies([{name:MERCHANT_AUTH_COOKIE,value:ownerToken,url:origin,secure:true,httpOnly:true,sameSite:'Lax'}]);
            await context.route('**/*',route=>{
              if(closing)return route.abort().catch(()=>{});
              const work=(async()=>{
                const r=route.request(),url=new URL(r.url());
                if(url.origin!==origin){external.push('external_request');return route.abort();}
                assert(!url.searchParams.has('it')&&!url.searchParams.has('access_token'));
                if(owner&&url.pathname==='/downloads/faolla-android-version.json'){assert.equal(r.method(),'GET');return route.fulfill({status:404,contentType:'application/json',body:'{"ok":false,"error":"synthetic_download_unavailable"}'});}
                if(owner&&['/auth/v1/settings','/rest/v1/'].includes(url.pathname)){assert.equal(r.method(),'GET');return route.fulfill({status:200,contentType:'application/json',body:'{}'});}
                if(!url.pathname.startsWith('/api/')&&!url.pathname.startsWith('/auth/v1/')){
                  assert.equal(r.method(),'GET');assert(['/99990001','/enterprise','/enterprise/'+site,'/harness.js','/harness.css'].includes(url.pathname));
                  const response=await localFetch(staticOrigin+url.pathname);return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});
                }
                const headers=new Headers(await r.allHeaders()),raw=r.postData()??undefined;
                if(url.pathname.startsWith('/auth/v1/')){
                  const response=await fetch(new Request('https://attendance-auth.invalid'+url.pathname+url.search,{method:r.method(),headers,body:raw}));
                  return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:await response.text()});
                }
                if(owner){assert.equal(headers.get('x-merchant-access-token'),null);assert(headers.get('cookie')?.includes(MERCHANT_AUTH_COOKIE+'='));}
                else{assert(headers.get('x-merchant-access-token'));assert.equal(headers.get('cookie'),null);}
                if(headers.get('origin')===origin)headers.set('origin',canonical);
                if(headers.get('referer')?.startsWith(origin+'/'))headers.set('referer',canonical+headers.get('referer').slice(origin.length));headers.set('host','www.faolla.com');
                const request=new Request(canonical+url.pathname+url.search,{method:r.method(),headers,body:raw}),input=raw?JSON.parse(raw):null;
                let response;
                if(url.pathname===setupPath){assert(!owner);assert.equal(r.method(),'POST');assert.equal(input.newPassword,password);assert.equal(input.invitationToken,invite.token);response=await setup(request);}
                else if(url.pathname===acceptPath){assert(!owner);assert.equal(r.method(),'POST');assert.equal(bridge.proof().passwordAccepted,1);response=await accept(request);}
                else if(url.pathname===overviewPath){assert.equal(r.method(),'GET');response=await overview(request);}
                else if(url.pathname===rolePath){assert(owner);assert.equal(r.method(),'PATCH');response=await updateRole(request);}
                else if(url.pathname===adminPath)response=await handleAttendanceAdmin(request,{entitlement});
                else if(url.pathname===selfPath)response=await handleAttendanceSelf(request,{entitlement});
                else if(url.pathname==='/api/merchant-business/capabilities'){
                  assert.equal(r.method(),'GET');response=await handleMerchantBusinessCapabilitiesGet(request,{resolveActor:(value,options)=>resolveMerchantBusinessActor(value,options,{rolloutConfig:{mode:'off',siteIds:[],valid:true},loadSite:async()=>({id:site,permissionConfig:{allowEnterpriseManagement:true,allowEmployeeAttendance:true}})})});
                }else if([prefix+'current-operations',prefix+'todos',prefix+'workflow-permission-gaps'].includes(url.pathname)){
                  assert.equal(r.method(),'GET');await resolveValidatedMerchantEnterpriseAuthUser(request);response=Response.json({ok:false,error:'synthetic_unrelated_read_out_of_scope'},{status:503});
                }else{const identity=await resolveValidatedMerchantEnterpriseAuthUser(request);response=owner?serveAttendanceMerchantBootstrap(request,identity.id):null;assert(response,'onboarding_unexpected_endpoint');}
                const body=await response.text(),payload=JSON.parse(body),record=onboardingBrowserRecord(url.pathname,r.method(),response.status,payload,input,Object.fromEntries(url.searchParams));requests.push(record);
                if([adminPath,selfPath].includes(url.pathname)&&r.method()==='POST'&&response.status===200)commits.push({path:url.pathname,input:structuredClone(input),body:payload});
                if(dropWorker&&url.pathname===adminPath&&input?.kind==='worker'&&response.status===200){dropWorker=false;record.dropped=true;return route.abort('connectionreset');}
                if(dropPunch&&url.pathname===selfPath&&r.method()==='POST'&&response.status===200){dropPunch=false;record.dropped=true;return route.abort('connectionreset');}
                return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body});
              })();pendingRoutes.add(work);void work.finally(()=>pendingRoutes.delete(work)).catch(()=>{});
              return work.catch(async error=>{errors.push({kind:'route',sourceLine:String(error?.stack??'').match(/onboarding-browser-check\.mjs:(\d+):/)?.[1]??null});await route.abort().catch(()=>{});});
            });
            const page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',()=>errors.push('pageerror'));page.on('dialog',dialog=>dialog.accept());return page;
          };
          const owner=await newPage(true),phone=await newPage(false),admin=()=>owner.getByRole('region',{name:'考勤配置管理',exact:true}),self=()=>phone.getByRole('region',{name:'我的考勤',exact:true});
          const nav=()=>phone.getByRole('navigation',{name:'企业管理功能',exact:true});
          const response=(page,endpoint,method,status=200)=>{const promise=page.waitForResponse(r=>new URL(r.url()).pathname===endpoint&&r.request().method()===method).then(r=>{assert.equal(r.status(),status);return r;});void promise.catch(()=>{});return promise;};
          const adminSave=async label=>{const done=response(owner,adminPath,'POST');await admin().getByRole('button',{name:label,exact:true}).click();const result=await(await done).json();await admin().getByText(/保存已确认/).waitFor();safe();return result;};
          const goAdmin=async()=>{await owner.getByRole('button',{name:'考勤配置',exact:true}).click();await admin().getByRole('button',{name:'重新读取',exact:true}).waitFor();};
          const pendingKey=`faolla:attendance:self:v1:${site}:${invite.employeeId}`,configKey=`faolla:attendance:config:v1:${site}:${prepared.owner.id}`;
          const pending=()=>phone.evaluate(key=>sessionStorage.getItem(key),pendingKey);
          const posts=pathname=>requests.filter(row=>row.path===pathname&&row.method==='POST');
          const refreshEmployee=async permissions=>{
            const caps=response(phone,'/api/merchant-business/capabilities','GET',403),done=response(phone,overviewPath,'GET');
            await phone.evaluate(()=>window.dispatchEvent(new Event('focus')));await caps;const data=await(await done).json();
            assert.deepEqual([...data.actor.permissions].sort(),[...permissions].sort());await nav().waitFor();
          };
          const enterSelf=async(status=200)=>{const done=response(phone,selfPath,'GET',status);await nav().getByRole('button',{name:'我的考勤',exact:true}).click();const result=await(await done).json();await self().getByRole('button',{name:/^(刷新状态|核对打卡结果)$/}).waitFor();return result;};
          const grant=async permission=>{
            await owner.getByRole('button',{name:'角色权限',exact:true}).click();
            const toggle=owner.locator(`button[aria-controls="role-editor-${roleId}-body"]`);if(await toggle.getAttribute('aria-expanded')!=='true')await toggle.click();
            const editor=owner.locator(`[id="role-editor-${roleId}-body"]`);
            await editor.getByRole('navigation',{name:'权限主要板块',exact:true}).getByRole('button',{name:/^员工考勤，/}).click();
            await editor.locator(`[id="role-${roleId}-${permission}"]`).check();
            const done=response(owner,rolePath,'PATCH'),refreshed=response(owner,overviewPath,'GET');
            await editor.getByRole('button',{name:'保存角色',exact:true}).click();await done;await refreshed;await owner.getByText('角色已保存。',{exact:true}).waitFor();safe();
          };

          phase='owner-settings-location';await owner.goto(origin+'/'+site);await owner.getByRole('button',{name:'企业管理',exact:true}).click();await goAdmin();
          await admin().getByRole('button',{name:'创建考勤配置',exact:true}).waitFor();assert.deepEqual(prepared.uiFacts(),initial);
          await admin().getByLabel(/^启用企业考勤/).check();assert.equal(await admin().getByLabel(/^允许普通网页打卡/).isChecked(),false);await adminSave('创建考勤配置');
          await admin().getByRole('button',{name:'工作地点',exact:true}).click();await admin().getByRole('button',{name:'新增地点',exact:true}).click();
          await admin().getByLabel('地点名称',{exact:true}).fill('合成入职地点');await admin().getByLabel('启用此地点',{exact:true}).check();await adminSave('保存地点');
          assert.equal(prepared.uiFacts().configOperations.length,2);assert.equal(prepared.uiFacts().workers.length,0);
          const locationId=prepared.uiFacts().locations[0].id;
          native.pass('actual owner AdminClient creates settings and a browser-generated location via real admin SQL; all employees remain invited and web punching remains disabled');

          phase='actual-invitation-setup';const callback=protocol.issue(invite.actor,['invite']);
          await phone.goto(origin+'/enterprise/'+site+'#'+new URLSearchParams({iv:String(invite.version),it:invite.token,access_token:callback,refresh_token:randomUUID()}));
          await phone.getByRole('heading',{name:'设置员工登录密码',exact:true}).waitFor();assert.equal(phone.url(),origin+'/enterprise/'+site);
          await phone.getByLabel('新密码',{exact:true}).fill(password);await phone.getByLabel('确认新密码',{exact:true}).fill(password);
          await phone.getByRole('button',{name:'设置密码并进入工作台',exact:true}).click();await nav().waitFor();
          const accepted=prepared.uiFacts();assert.equal(accepted.enterprise.employees.find(row=>row.id===invite.employeeId).status,'active');
          assert.equal(accepted.enterprise.setups.length,1);assert.equal(accepted.enterprise.setups[0].state,'completed');
          for(const row of initial.enterprise.employees.filter(row=>row.id!==invite.employeeId))assert.deepEqual(accepted.enterprise.employees.find(next=>next.id===row.id),row);
          assert.equal(accepted.enterprise.audits.length,initial.enterprise.audits.length+1);assert.equal(model.proof().updates,1);assert.equal(bridge.proof().passwordAccepted,1);
          assert.equal(await nav().getByRole('button',{name:'我的考勤',exact:true}).count(),0);assert.equal(accepted.workers.length,0);assert.equal(accepted.events.length,0);safe();
          native.pass('actual mobile-width Portal sets the shared modeled password, logs in through SDK and accepts the invitation once without granting attendance or creating a worker');

          phase='view-grant-before-worker';await grant('attendance.self.view');await refreshEmployee(['enterprise.view','attendance.self.view']);
          const denied=await enterSelf(403);assert.equal(denied.error,'attendance_access_denied');assert.equal(prepared.uiFacts().workers.length,0);assert.equal(prepared.uiFacts().events.length,0);
          native.pass('actual role editor grants self-view and employee overview reload reveals attendance, but the real page cannot read attendance before enrollment');

          phase='worker-form-lost-reply';await goAdmin();await admin().getByRole('button',{name:'考勤人员',exact:true}).click();await admin().getByRole('button',{name:'新增考勤人员',exact:true}).click();
          const choiceResponse=response(owner,adminPath,'GET');await admin().getByRole('button',{name:'选择已有员工',exact:true}).click();
          assert.deepEqual((await(await choiceResponse).json()).items.map(row=>row.id),[invite.employeeId]);
          await admin().getByRole('button',{name:'选择',exact:true}).click();await admin().getByLabel('企业内工号',{exact:true}).fill('ONBOARD-120');await admin().getByLabel('在职起始日期',{exact:true}).fill('2000-01-01');
          await admin().getByRole('button',{name:'选择工作地点',exact:true}).click();await admin().getByRole('button',{name:'选择',exact:true}).click();await admin().getByLabel('启用此考勤人员',{exact:true}).check();
          const beforeWorker=prepared.uiFacts();dropWorker=true;await admin().getByRole('button',{name:'保存考勤人员',exact:true}).click();await admin().getByText('保存结果待确认',{exact:true}).waitFor();
          const workerCommit=commits.find(row=>row.path===adminPath&&row.input.kind==='worker');assert(workerCommit);
          const worker=workerCommit.input.values,afterWorker=prepared.uiFacts();assert.equal(worker.locationId,locationId);
          assertOnboardingEnrollment({before:beforeWorker,after:afterWorker,employeeId:invite.employeeId,worker,receipt:workerCommit.body.receipt,operationId:workerCommit.input.operationId,ownerId:prepared.owner.id});
          const storedConfig=await owner.evaluate(key=>sessionStorage.getItem(key),configKey);assert(storedConfig);assert.equal(JSON.parse(storedConfig).command.operationId,workerCommit.input.operationId);
          const configPosts=posts(adminPath).length,recovery=response(owner,adminPath,'GET');await admin().getByRole('button',{name:'重新读取',exact:true}).click();const recovered=await(await recovery).json();
          assert.deepEqual(recovered.receipt,workerCommit.body.receipt);await admin().getByText(/保存已确认/).waitFor();assert.equal(await owner.evaluate(key=>sessionStorage.getItem(key),configKey),null);
          assert.equal(posts(adminPath).length,configPosts);assert.deepEqual(prepared.uiFacts(),afterWorker);safe();
          native.pass('real employee chooser selects only the accepted member; lost successful enrollment reply keeps its original ID and the actual reload button recovers by GET without another worker or POST');

          phase='view-only-read';const ready=response(phone,selfPath,'GET');await self().getByRole('button',{name:'刷新状态',exact:true}).click();const idle=await(await ready).json();
          assert.equal(idle.workerId,worker.id);assert.equal(idle.state.sequence,0);assert.equal(idle.state.status,'off');
          await self().getByText('当前角色仅可查看本人考勤，不能提交打卡。',{exact:true}).waitFor();assert(await self().getByRole('button',{name:'上班打卡',exact:true}).isDisabled());assert.equal(posts(selfPath).length,0);
          native.pass('enrolled employee page reads its own off state while view-only permissions keep punch actions disabled');

          phase='clock-granted-web-still-off';await grant('attendance.self.clock');await refreshEmployee(['enterprise.view','attendance.self.view','attendance.self.clock']);await enterSelf();
          const webDenied=response(phone,selfPath,'POST',403);await self().getByRole('button',{name:'上班打卡',exact:true}).click();assert.equal((await(await webDenied).json()).error,'attendance_web_disabled');
          await self().getByRole('button',{name:'刷新状态',exact:true}).waitFor();assert.equal(await pending(),null);assert.equal(prepared.uiFacts().events.length,0);
          native.pass('granting clock permission through the real editor does not bypass web-clock disable; explicit first rejection creates no event or uncertain operation');

          phase='first-punch-reply-lost';await goAdmin();await admin().getByLabel(/^允许普通网页打卡/).check();await adminSave('保存考勤设置');
          const refreshed=response(phone,selfPath,'GET');await self().getByRole('button',{name:'刷新状态',exact:true}).click();await refreshed;
          const beforePunch=prepared.uiFacts();dropPunch=true;await self().getByRole('button',{name:'上班打卡',exact:true}).click();await self().getByRole('button',{name:'核对打卡结果',exact:true}).waitFor();
          const first=commits.find(row=>row.path===selfPath);assert(first);const afterPunch=prepared.uiFacts();
          assertOnboardingUiPunch({before:beforePunch,after:afterPunch,body:first.body,employeeId:invite.employeeId,workerId:worker.id,locationId,operationId:first.input.operationId});
          const savedPending=await pending();assert(savedPending);assert.equal(JSON.parse(savedPending).command.operationId,first.input.operationId);
          assert.equal(await self().getByText('收据编号：'+first.body.receipt.id,{exact:true}).count(),0);assert.equal(posts(selfPath).length,2);
          native.pass('owner explicitly enables web punching; the new employee first punch commits once, while its lost HTTP200 leaves the actual page pending rather than showing a fabricated success');

          phase='reload-original-receipt';const postCount=posts(selfPath).length,documentBefore=await phone.evaluate(()=>performance.timeOrigin);
          await phone.reload();await nav().waitFor();assert.notEqual(await phone.evaluate(()=>performance.timeOrigin),documentBefore);assert.equal(await pending(),savedPending);
          const restored=await enterSelf();assert.deepEqual(restored.receipt,first.body.receipt);await self().getByText('收据编号：'+first.body.receipt.id,{exact:true}).waitFor();
          assert.equal(await pending(),null);assert.equal(posts(selfPath).length,postCount);assert.deepEqual(prepared.uiFacts(),afterPunch);
          assert(requests.some(row=>row.path===selfPath&&row.method==='GET'&&row.recoveryOperationId===first.input.operationId));safe();
          native.pass('real document reload preserves SDK identity and original pending ID; entering attendance retrieves the committed receipt by GET only and clears pending without a duplicate event');

          phase='final';const final=prepared.uiFacts();assert.equal(final.workers.length,1);assert.equal(final.periods.length,1);assert.equal(final.events.length,1);assert.equal(final.configOperations.length,4);
          const newAudits=final.enterprise.audits.filter(row=>!initial.enterprise.audits.some(old=>old.id===row.id));assert.equal(newAudits.length,3);assert.equal(newAudits.filter(row=>row.event_type==='role.updated').length,2);
          assert.equal(newAudits.filter(row=>row.event_type==='invitation.accepted').length,1);assert.deepEqual(final.enterprise.employees,accepted.enterprise.employees);assert.deepEqual(final.enterprise.setups,accepted.enterprise.setups);
          assert.equal(await phone.evaluate(key=>sessionStorage.getItem(key),'faolla:enterprise-invitation:v1:'+site),null);
          for(const row of initial.enterprise.audits)assert.deepEqual(final.enterprise.audits.find(next=>next.id===row.id),row);
          for(const row of initial.roles.filter(row=>row.id!==roleId))assert.deepEqual(final.roles.find(next=>next.id===row.id),row);
          for(const page of [owner,phone]){assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert(await page.evaluate(value=>[sessionStorage,localStorage].every(storage=>Object.keys(storage).every(key=>!storage.getItem(key).includes(value))),password));}
          assert.equal(model.proof().updates,1);assert.equal(bridge.proof().passwordAccepted,1);assert.deepEqual(external,[]);assert.deepEqual(errors,[]);assert.deepEqual(prepared.uiErrors,[]);safe();
          console.log(JSON.stringify({onboardingBrowser:true,actualPortal:true,actualAdminClient:true,actualRoleAndAdminForms:true,workerRows:1,events:1,configOperations:4,newAudits:3,lostWorkerReplyRecoveredByGet:true,lostPunchReplyRecoveredAfterReload:true,defaultAttendanceExecutors:true,sharedModeledAuth:true,syntheticMerchantCookieAndBootstrap:true,injectedSetupReads:true,realMerchantLoginPage:false,realAuthService:false,realEmail:false,realPhone:false,realNextServer:false,productionAccess:false,externalRequests:0}));
        }finally{
          closing=true;try{await runAttendanceCleanupSteps([{name:'auth-owned-browser',run:()=>browser?.close()},{name:'auth-owned-routes',run:()=>Promise.allSettled([...pendingRoutes])}]);}finally{globalThis.fetch=protocolFetch;}
        }
      },undefined,prepared.uiRead,(actor,value)=>actor.id===prepared.owner.id?value==='Synthetic-attendance-only!':actor.id===invite.actor.id&&model.proof().initialized&&model.passwordMatches(value));
    }catch(error){
      const sourceLine=String(error?.stack??'').match(/onboarding-browser-check\.mjs:(\d+):/)?.[1]??null;
      console.error(JSON.stringify({onboardingBrowserFailed:true,phase,sourceLine,errors,requests:requests.map(({path,method,status,error})=>({path,method,status,error}))}));throw Error('onboarding_browser_local_check_failed');
    }finally{
      closing=true;try{await runAttendanceCleanupSteps([{name:'browser',run:()=>browser?.close()},{name:'routes',run:()=>Promise.allSettled([...pendingRoutes])},{name:'harness',timeoutMs:10000,run:async()=>{if(child.pid!==undefined&&child.exitCode===null&&child.signalCode===null){const stopped=once(child,'exit');child.kill();await stopped;}}}]);}
      finally{if(savedMode===undefined)delete process.env.FAOLLA_PLATFORM_SNAPSHOT_WRITE_MODE;else process.env.FAOLLA_PLATFORM_SNAPSHOT_WRITE_MODE=savedMode;}
    }
  });
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  await runAttendanceLabelsReuse(process.argv.slice(2),checkAttendanceOnboardingBrowser).catch(()=>{console.error('onboarding_browser_failed');process.exitCode=1;});
}
