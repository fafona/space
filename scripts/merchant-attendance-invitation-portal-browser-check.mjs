// Opt-in local Portal acceptance. Real UI/SDK/accept/overview/SQL; synthetic
// Auth callback and explicit already-password rejection, not real email/setup.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {AsyncLocalStorage} from 'node:async_hooks';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import net from 'node:net';
import {chromium} from 'playwright';
import {runAttendanceLabelsReuse} from './merchant-attendance-choice-labels-reuse-native.mjs';
import {withAttendanceConcurrencySandbox} from './merchant-attendance-concurrency-sandbox.mjs';
import {prepareInvitationBrowser} from './merchant-attendance-invitation-browser-fixture.mjs';
import {validateInvitationRecoveryRead} from './merchant-attendance-invitation-retry-native.mjs';
import {runAttendanceCleanupSteps} from './fixtures/attendance-cleanup.mjs';
const require=createRequire(import.meta.url);
const {withAttendanceApplicationAuth}=require('./fixtures/attendance-application-auth.ts');
const {POST:accept}=require('../src/app/api/merchant-enterprise/employees/accept/route-handler.ts');
const {GET:overview}=require('../src/app/api/merchant-enterprise/overview/route-handler.ts');
const {resolveValidatedMerchantEnterpriseAuthContext}=require('../src/lib/merchantEnterpriseAuth.server.ts');
const {resolveMerchantBusinessActor}=require('../src/lib/merchantBusinessActor.server.ts');
const {handleMerchantBusinessCapabilitiesGet}=require('../src/app/api/merchant-business/capabilities/route-handler.ts');
const origin='http://127.0.0.1:3131',canonical='https://www.faolla.com',site='99990001';
const endpoint='/api/merchant-enterprise/employees/accept',storageKey='faolla:enterprise-invitation:v1:'+site;
const localFetch=globalThis.fetch;
const bounded=async(promise,label)=>{let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(label)),15000);})]);}finally{clearTimeout(timer);}};

export function assertInvitationPortalPreserved(stored,expected,prior){
  assert(stored,'invitation_portal_pending_missing');
  assert.equal(stored.stage,'accept_pending');assert.equal(stored.authUserId,expected.actor.id);
  assert.equal(stored.invitationVersion,expected.version);assert.equal(stored.invitationToken,expected.token);
  assert.equal(stored.initialPasswordOperationId,null);
  assert.match(stored.attemptId,/^[0-9a-f-]{36}$/);assert(Number.isSafeInteger(stored.createdAt));
  if(prior)for(const key of ['attemptId','createdAt','authUserId','invitationVersion','invitationToken'])assert.equal(stored[key],prior[key],'invitation_portal_handoff_changed');
}

export function assertInvitationPortalAccountRejected({stored,prior,sdkAccounts,passwordSubject,expectedAccount,apiAttempts,workspaceVisible,beforeFacts,afterFacts}){
  assert(prior&&typeof prior.authUserId==='string','invitation_portal_original_binding_required');
  assert.notEqual(prior.authUserId,expectedAccount,'invitation_portal_other_account_required');
  assert.deepEqual(stored,prior,'invitation_portal_rejected_handoff_changed');
  assert.deepEqual(sdkAccounts,[expectedAccount],'invitation_portal_other_sdk_session_required');
  assert.equal(passwordSubject,expectedAccount,'invitation_portal_other_password_login_required');
  assert.equal(workspaceVisible,false,'invitation_portal_rejected_workspace_visible');
  assert.equal(apiAttempts.filter(row=>row.path===endpoint).length,0,'invitation_portal_rejected_accept_started');
  assert.equal(apiAttempts.filter(row=>row.path==='/api/merchant-enterprise/overview').length,0,'invitation_portal_rejected_overview_started');
  assert.deepEqual(afterFacts,beforeFacts,'invitation_portal_rejected_facts_changed');
}

export async function checkInvitationPortal(native){
  await withAttendanceConcurrencySandbox(native,async scope=>{
    const prepared=await prepareInvitationBrowser(native,scope),[a,b,c]=prepared.invitations;
    const baseline=prepared.protectedFingerprint(),initial=prepared.facts();
    const probe=net.createServer();await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(3131,'127.0.0.1',resolve);});await new Promise(resolve=>probe.close(resolve));
    const child=spawn(process.execPath,['scripts/attendance-self-browser-harness.mjs','--portal'],{cwd:native.root,windowsHide:true,stdio:['ignore','pipe','pipe']});
    const requestScope=new AsyncLocalStorage(),requests=[],apiAttempts=[],pendingRoutes=new Set(),errors=[],external=[];
    let browser,closing=false,phase='start';
    const savedMode=process.env.FAOLLA_PLATFORM_SNAPSHOT_WRITE_MODE;
    child.stderr.on('data',()=>errors.push('harness_stderr'));
    const safe=()=>assert.equal(prepared.protectedFingerprint(),baseline,'invitation_portal_protected_facts_changed');
    try{
      process.env.FAOLLA_PLATFORM_SNAPSHOT_WRITE_MODE='off';
      await bounded(new Promise((resolve,reject)=>{let output='';child.stdout.on('data',value=>{output+=String(value);if(output.includes('Attendance synthetic component QA'))resolve();});child.once('error',()=>reject(Error('harness_start_failed')));child.once('exit',()=>reject(Error('harness_exited')));}), 'invitation_portal_harness_timeout');
      browser=await chromium.launch({headless:true});
      // The standalone server is GET-only; interception is the only local API.
      assert.equal((await localFetch(origin+endpoint,{method:'POST'})).status,403);
      const read=request=>{
        const url=new URL(request.url),state=requestScope.getStore();
        if(state?.readUnavailable&&url.pathname==='/rest/v1/merchant_enterprise_employees'&&url.searchParams.has('invitation_token_hash')){
          validateInvitationRecoveryRead(request);
          state.readFailures++;return Response.json({code:'synthetic_read_unavailable',message:'unavailable'},{status:503});
        }
        return prepared.read(request);
      };
      await withAttendanceApplicationAuth(prepared.actors,prepared.rpc,async auth=>{
        try{
        const tokenSubjects=new Map();
        const stored=page=>page.evaluate(key=>{const raw=sessionStorage.getItem(key);return raw?JSON.parse(raw):null;},storageKey);
        const newPage=async(label,mobile=false)=>{
          const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1280,height:960},isMobile:mobile,hasTouch:mobile,serviceWorkers:'block'});
          const state={label,dropNextSuccess:false,readUnavailable:false,readFailures:0,invitation:null,passwordSubject:null};
          await context.addInitScript(()=>localStorage.setItem('merchant-space:locale:v1','zh-CN'));
          await context.route('**/*',route=>{
            if(closing)return route.abort().catch(()=>{});
            const work=requestScope.run(state,async()=>{
              const r=route.request(),url=new URL(r.url());
              if(url.origin!==origin){external.push('external_request');return route.abort();}
              // Credentials live in the callback fragment or body, never a query.
              assert(!url.searchParams.has('it')&&!url.searchParams.has('access_token'));
              if(url.pathname.startsWith('/auth/v1/')){
                const reply=await fetch(new Request('https://attendance-auth.invalid'+url.pathname+url.search,{method:r.method(),headers:await r.allHeaders(),body:r.postData()??undefined}));
                const body=await reply.text();
                if(reply.ok&&url.pathname==='/auth/v1/token'){
                  const session=JSON.parse(body);assert(prepared.actors.some(actor=>actor.id===session.user.id));
                  tokenSubjects.set(session.access_token,session.user.id);
                  if(url.searchParams.get('grant_type')==='password')state.passwordSubject=session.user.id;
                }
                return route.fulfill({status:reply.status,headers:Object.fromEntries(reply.headers),body});
              }
              if(!url.pathname.startsWith('/api/')){
                assert.equal(r.method(),'GET');assert(['/enterprise/'+site,'/harness.js','/harness.css'].includes(url.pathname));
                return route.continue();
              }
              apiAttempts.push({page:label,path:url.pathname,method:r.method()});
              const headers=new Headers(await r.allHeaders());assert(headers.get('x-merchant-access-token'));
              assert.equal(headers.get('cookie'),null);
              if(headers.get('origin')===origin)headers.set('origin',canonical);
              if(headers.get('referer')?.startsWith(origin+'/'))headers.set('referer',canonical+headers.get('referer').slice(origin.length));
              headers.set('host','www.faolla.com');
              const request=new Request(canonical+url.pathname+url.search,{method:r.method(),headers,body:r.postData()??undefined});
              let originalCredentials=null;
              if(url.pathname===endpoint){
                const input=JSON.parse(r.postData());
                originalCredentials=Object.keys(input).sort().join(',')==='invitationToken,invitationVersion,siteId'&&input.siteId===site&&
                  input.invitationVersion===state.invitation?.version&&input.invitationToken===state.invitation?.token;
                assert.equal(originalCredentials,true,'invitation_portal_original_credentials_required');
              }
              let reply;
              if(url.pathname===endpoint){assert.equal(r.method(),'POST');reply=await accept(request);}
              else if(url.pathname==='/api/merchant-enterprise/overview'){assert.equal(r.method(),'GET');reply=await overview(request);}
              else if(url.pathname==='/api/merchant-business/capabilities'){
                assert.equal(r.method(),'GET');reply=await handleMerchantBusinessCapabilitiesGet(request,{
                  resolveActor:(input,options)=>resolveMerchantBusinessActor(input,options,{rolloutConfig:{mode:'off',siteIds:[],valid:true},loadSite:async()=>({id:site,permissionConfig:{allowEnterpriseManagement:true}})}),
                });
              }else if(url.pathname==='/api/merchant-enterprise/invitations/initial-password'){
                // Explicitly synthetic PRECONDITION rejection for existing-password
                // accounts. This does not pretend to set a password or accept an invite.
                assert.equal(r.method(),'POST');const identity=await resolveValidatedMerchantEnterpriseAuthContext(request),body=await request.json();
                const invite=prepared.invitations.find(item=>item.actor.id===identity.user.id);assert(invite);
                assert.deepEqual(Object.keys(body).sort(),['invitationToken','invitationVersion','newPassword','operationId','siteId']);
                assert.equal(body.siteId,site);assert.equal(body.invitationVersion,invite.version);assert.equal(body.invitationToken,invite.token);
                assert.equal(typeof body.newPassword,'string');assert(body.newPassword.length>=8);assert.match(body.operationId,/^[0-9a-f-]{36}$/);
                reply=Response.json({ok:false,error:'employee_password_already_initialized'},{status:409});
              }else{
                assert.equal(r.method(),'GET');assert(['/api/merchant-enterprise/current-operations','/api/merchant-enterprise/todos','/api/merchant-enterprise/workflow-permission-gaps'].includes(url.pathname),'invitation_portal_unexpected_api');
                await resolveValidatedMerchantEnterpriseAuthContext(request);
                reply=Response.json({ok:false,error:'synthetic_unrelated_read_out_of_scope'},{status:503});
              }
              const body=await reply.text(),payload=JSON.parse(body);
              const record={page:label,path:url.pathname,method:r.method(),status:reply.status,employeeId:payload.employee?.id??payload.actor?.id??null,alreadyActive:payload.alreadyActive===true,error:payload.error??null,
                ...(url.pathname===endpoint?{originalCredentials,authSubject:tokenSubjects.get(headers.get('x-merchant-access-token'))??null}:{} )};requests.push(record);
              if(url.pathname===endpoint&&reply.status===200&&state.dropNextSuccess){state.dropNextSuccess=false;record.dropped=true;return route.abort('connectionreset');}
              return route.fulfill({status:reply.status,headers:Object.fromEntries(reply.headers),body});
            });
            pendingRoutes.add(work);void work.finally(()=>pendingRoutes.delete(work)).catch(()=>{});
            return work.catch(async()=>{errors.push('invitation_portal_route_failed');await route.abort().catch(()=>{});});
          });
          const page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',()=>errors.push('pageerror'));
          return {page,state};
        };
        const callback=async(client,invite)=>{
          const {page,state}=client;state.invitation=invite;
          const callbackToken=auth.issue(invite.actor,['invite']);tokenSubjects.set(callbackToken,invite.actor.id);
          const hash=new URLSearchParams({iv:String(invite.version),it:invite.token,access_token:callbackToken,refresh_token:randomUUID()});
          await page.goto(origin+'/enterprise/'+site+'#'+hash);
          await page.getByRole('heading',{name:'设置员工登录密码',exact:true}).waitFor();
          assert.equal(page.url(),origin+'/enterprise/'+site);
          const pending=await stored(page);assert.equal(pending.stage,'password_pending');assert.equal(pending.authUserId,invite.actor.id);
          await page.getByLabel('新密码',{exact:true}).fill('Synthetic-attendance-only!');
          await page.getByLabel('确认新密码',{exact:true}).fill('Synthetic-attendance-only!');
          await page.getByRole('button',{name:'设置密码并进入工作台',exact:true}).click();
          await page.getByRole('heading',{name:'员工登录',exact:true}).waitFor();
          await page.getByText('该员工账号已有密码或属于历史账号，请使用现有密码登录；忘记密码时可发送重置邮件。',{exact:true}).waitFor();
          assert.equal((await stored(page)).authUserId,invite.actor.id);
          return pending;
        };
        const login=async(page,invite)=>{
          await page.getByLabel('员工邮箱',{exact:true}).fill(invite.actor.email);
          await page.getByLabel('密码',{exact:true}).fill('Synthetic-attendance-only!');
          await page.getByRole('button',{name:'登录企业工作台',exact:true}).click();
        };
        const workspace=async(page,invite,label)=>{
          await page.getByRole('navigation',{name:'企业管理功能',exact:true}).waitFor({state:'attached'});
          const records=requests.filter(row=>row.page===label&&row.path==='/api/merchant-enterprise/overview'&&row.status===200);
          assert(records.length>0);assert(records.every(row=>row.employeeId===invite.employeeId));
          assert.equal(await stored(page),null);
          assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'invitation_portal_horizontal_overflow');safe();
        };
        const accepts=label=>requests.filter(row=>row.page===label&&row.path===endpoint);
        const rejectOtherAccount=async(client,wrongAccount,original,beforeFacts)=>{
          const {page,state}=client,rejectionPhase=phase;
          const signedIn=page.waitForResponse(reply=>{
            const url=new URL(reply.url());
            return url.pathname==='/auth/v1/token'&&url.searchParams.get('grant_type')==='password'&&reply.request().method()==='POST';
          });void signedIn.catch(()=>{});
          phase=rejectionPhase+':password-login';await login(page,wrongAccount);
          phase=rejectionPhase+':sdk-response';assert.equal((await signedIn).status(),200,'invitation_portal_other_login_failed');
          // The auth listener can warn before manual login finishes. Wait for
          // idle text, not just a transient alert. The rejection clears password,
          // so the idle login button must remain disabled despite busy=false.
          phase=rejectionPhase+':busy-settled';
          const idleLogin=page.getByRole('button',{name:'登录企业工作台',exact:true});await idleLogin.waitFor();
          phase=rejectionPhase+':password-cleared';
          assert.equal(await page.getByLabel('密码',{exact:true}).inputValue(),'','invitation_portal_rejected_password_not_cleared');
          assert(await idleLogin.isDisabled(),'invitation_portal_empty_password_login_enabled');
          phase=rejectionPhase+':login-heading';
          await page.getByRole('heading',{name:'员工登录',exact:true}).waitFor();
          phase=rejectionPhase+':binding-message';
          await page.getByText('请使用该邀请已验证的员工账号登录后重试。',{exact:true}).waitFor();
          phase=rejectionPhase+':sdk-storage';
          const sdkAccounts=await page.evaluate(()=>Object.keys(sessionStorage).filter(key=>key.endsWith('-enterprise-auth-token'))
            .map(key=>{try{return JSON.parse(sessionStorage.getItem(key)).user?.id??null;}catch{return null;}}));
          assert.deepEqual(sdkAccounts,[wrongAccount.actor.id],'invitation_portal_other_sdk_session_required');
          assert.equal(state.passwordSubject,wrongAccount.actor.id,'invitation_portal_other_password_login_required');
          phase=rejectionPhase+':handoff-api-facts-oracle';
          assertInvitationPortalAccountRejected({stored:await stored(page),prior:original,sdkAccounts,passwordSubject:state.passwordSubject,
            expectedAccount:wrongAccount.actor.id,apiAttempts:apiAttempts.filter(row=>row.page===state.label),
            workspaceVisible:await page.getByRole('navigation',{name:'企业管理功能',exact:true}).isVisible(),beforeFacts,afterFacts:prepared.facts()});
          phase=rejectionPhase+':protected-fingerprint';safe();phase=rejectionPhase+':complete';
        };
        const firstAuditCount=initial.audits.length;

        phase='desktop-retry';
        const desktop=await newPage('desktop'),initialA=await callback(desktop,a);assert.deepEqual(prepared.facts(),initial);safe();
        desktop.state.dropNextSuccess=true;await login(desktop.page,a);
        await desktop.page.getByRole('button',{name:'重试确认邀请',exact:true}).waitFor();
        assertInvitationPortalPreserved(await stored(desktop.page),a,initialA);
        const committedA=prepared.facts();assert.equal(committedA.employees.find(row=>row.id===a.employeeId).status,'active');assert.equal(committedA.audits.length,firstAuditCount+1);
        assert.equal(accepts('desktop').filter(row=>row.status===200&&!row.alreadyActive&&row.dropped).length,1);
        native.pass('desktop actual Portal keeps its own invitation after the real accept SQL commits but the browser response is aborted');

        phase='desktop-read-failure';
        desktop.state.readUnavailable=true;await desktop.page.getByRole('button',{name:'重试确认邀请',exact:true}).click();
        await desktop.page.getByRole('alert').waitFor();await desktop.page.getByRole('button',{name:'重试确认邀请',exact:true}).waitFor();
        assert(desktop.state.readFailures>0);assertInvitationPortalPreserved(await stored(desktop.page),a,initialA);assert.deepEqual(prepared.facts(),committedA);safe();
        desktop.state.readUnavailable=false;await desktop.page.getByRole('button',{name:'重试确认邀请',exact:true}).click();
        await workspace(desktop.page,a,'desktop');assert.deepEqual(prepared.facts(),committedA);
        assert(accepts('desktop').some(row=>row.status===503));assert(accepts('desktop').some(row=>row.status===200&&row.alreadyActive));
        assert(accepts('desktop').every(row=>row.originalCredentials&&row.authSubject===a.actor.id));
        native.pass('desktop recovery read failure stays retryable; explicit retry enters real own-member overview and clears only completed invitation, without a second activation or audit');

        phase='different-invited-account-rejected';
        const otherPending=await newPage('other-pending');await callback(otherPending,c);
        const originalOtherPending=await stored(otherPending.page),beforeOtherPending=prepared.facts();
        assert.equal(beforeOtherPending.employees.find(row=>row.id===b.employeeId).status,'invited');
        await rejectOtherAccount(otherPending,b,originalOtherPending,beforeOtherPending);
        native.pass('Portal rejects different still-invited B after actual SDK password login completes: C handoff is unchanged, no accept/overview request starts and SQL facts remain unchanged');

        phase='mobile-reload';
        const mobile=await newPage('mobile',true),initialB=await callback(mobile,b);mobile.state.dropNextSuccess=true;await login(mobile.page,b);
        await mobile.page.getByRole('button',{name:'重试确认邀请',exact:true}).waitFor();
        const pendingB=await stored(mobile.page);assertInvitationPortalPreserved(pendingB,b,initialB);
        const committedB=prepared.facts();assert.equal(committedB.audits.length,firstAuditCount+2);
        await mobile.page.reload();await workspace(mobile.page,b,'mobile');assert.deepEqual(prepared.facts(),committedB);
        assert(accepts('mobile').some(row=>row.dropped&&row.status===200&&!row.alreadyActive));assert(accepts('mobile').some(row=>row.status===200&&row.alreadyActive));
        assert(accepts('mobile').every(row=>row.originalCredentials&&row.authSubject===b.actor.id));
        native.pass('390px Portal reload resumes its SDK session and original stored invitation through actual handler/SQL; clears pending credentials only after200 recovery');

        phase='different-active-account-rejected';
        const changed=await newPage('changed');await callback(changed,c);
        const originalChanged=await stored(changed.page),beforeChanged=prepared.facts(),changedDocument=await changed.page.evaluate(()=>performance.timeOrigin);
        assert.equal(beforeChanged.employees.find(row=>row.id===b.employeeId).status,'active');
        assert.equal(beforeChanged.employees.find(row=>row.id===c.employeeId).status,'invited');
        await rejectOtherAccount(changed,b,originalChanged,beforeChanged);
        native.pass('Portal also rejects already-active B without consuming C handoff or loading B workspace; the original invitation and complete SQL facts remain unchanged');

        phase='correct-account-same-page';
        await login(changed.page,c);await workspace(changed.page,c,'changed');
        assert.equal(await changed.page.evaluate(()=>performance.timeOrigin),changedDocument);
        const completed=prepared.facts(),acceptsC=accepts('changed');
        assert.equal(acceptsC.length,1);assert.equal(acceptsC[0].status,200);assert.equal(acceptsC[0].alreadyActive,false);
        assert.equal(acceptsC[0].originalCredentials,true);assert.equal(acceptsC[0].authSubject,c.actor.id);assert.equal(acceptsC[0].employeeId,c.employeeId);
        assert.equal(completed.employees.find(row=>row.id===c.employeeId).status,'active');
        for(const invite of [a,b])assert.deepEqual(completed.employees.find(row=>row.id===invite.employeeId),beforeChanged.employees.find(row=>row.id===invite.employeeId));
        assert.deepEqual(completed.setups,beforeChanged.setups);assert.equal(completed.audits.length,firstAuditCount+3);
        for(const audit of beforeChanged.audits)assert.deepEqual(completed.audits.find(row=>row.id===audit.id),audit);
        native.pass('the same C pending document accepts the correct C password login exactly once, clears only the completed handoff and opens real C overview; total activation audits are three');
        assert.deepEqual(external,[]);assert.deepEqual(errors,[]);assert.deepEqual(prepared.errors,[]);
        assert.equal(prepared.facts().audits.length,firstAuditCount+3);safe();
        console.log(JSON.stringify({invitationPortal:true,desktopRetryPassed:true,mobileReloadPassed:true,readFailurePreservesInvitation:true,
          accountBindingPassed:true,wrongInvitedAccountRejected:true,wrongActiveAccountRejected:true,correctAccountSamePageAccepted:true,addedAcceptanceAudits:3,
          realAcceptHandler:true,realOverview:true,realSql:true,syntheticInitialPassword409:true,realPasswordSetup:false,
          realAuthService:false,realEmail:false,realNextServer:false,realPhone:false,productionAccess:false,externalRequests:0}));
        }finally{
          // Shut down pages and await their routes BEFORE the closed Auth fetch
          // and environment are restored; a late poll must never escape it.
          closing=true;
          await runAttendanceCleanupSteps([{name:'auth-owned-browser',run:()=>browser?.close()},
            {name:'auth-owned-routes',run:()=>Promise.allSettled([...pendingRoutes])}]);
        }
      },undefined,read);
    }catch{
      // Never dump browser URLs, DOM inputs, raw SQL or assertion expected/actual.
      console.error(JSON.stringify({invitationPortalFailed:true,phase,routeErrors:errors.length,requests:requests.map(({page,path,method,status,error})=>({page,path,method,status,error}))}));
      throw Error('invitation_portal_acceptance_failed');
    }finally{
      closing=true;
      try{await runAttendanceCleanupSteps([{name:'browser',run:()=>browser?.close()},{name:'routes',run:()=>Promise.allSettled([...pendingRoutes])},
        {name:'harness',timeoutMs:10000,run:async()=>{if(child.pid!==undefined&&child.exitCode===null&&child.signalCode===null){const stopped=once(child,'exit');child.kill();await stopped;}}}]);}
      finally{if(savedMode===undefined)delete process.env.FAOLLA_PLATFORM_SNAPSHOT_WRITE_MODE;else process.env.FAOLLA_PLATFORM_SNAPSHOT_WRITE_MODE=savedMode;}
    }
  });
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  await runAttendanceLabelsReuse(process.argv.slice(2),checkInvitationPortal).catch(()=>{console.error('invitation_portal_local_check_failed');process.exitCode=1;});
}
