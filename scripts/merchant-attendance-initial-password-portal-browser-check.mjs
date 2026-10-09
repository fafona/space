// Opt-in local Portal -> setup -> password login -> accept/overview acceptance.
// Real component/SDK/handlers/SQL, but modeled Auth and injected setup reads.
// No real email, Next server, proxy, phone, account or production access.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import net from 'node:net';
import {chromium} from 'playwright';
import {runAttendanceLabelsReuse} from './merchant-attendance-choice-labels-reuse-native.mjs';
import {withAttendanceConcurrencySandbox} from './merchant-attendance-concurrency-sandbox.mjs';
import {prepareAttendanceInitialPasswordFixture,applyInitialPasswordReplayFixture} from './merchant-attendance-initial-password-fixture.mjs';
import {createInitialPasswordAuthModel} from './merchant-attendance-initial-password-native.mjs';
import {createInitialPasswordAuthBridge} from './merchant-attendance-initial-password-auth-bridge.mjs';
import {assertInvitationPortalPreserved} from './merchant-attendance-invitation-portal-browser-check.mjs';
import {runAttendanceCleanupSteps} from './fixtures/attendance-cleanup.mjs';
const require=createRequire(import.meta.url);
const {withAttendanceApplicationAuth}=require('./fixtures/attendance-application-auth.ts');
const {createMerchantEnterpriseInitialPasswordHandler}=require('../src/app/api/merchant-enterprise/invitations/initial-password/route-handler.ts');
const {resolveValidatedMerchantEnterpriseAuthUser}=require('../src/lib/merchantEnterpriseAuth.server.ts');
const {POST:accept}=require('../src/app/api/merchant-enterprise/employees/accept/route-handler.ts');
const {GET:overview}=require('../src/app/api/merchant-enterprise/overview/route-handler.ts');
const {resolveMerchantBusinessActor}=require('../src/lib/merchantBusinessActor.server.ts');
const {handleMerchantBusinessCapabilitiesGet}=require('../src/app/api/merchant-business/capabilities/route-handler.ts');
const origin='http://127.0.0.1:3131',canonical='https://www.faolla.com',site='99990001';
const setupPath='/api/merchant-enterprise/invitations/initial-password',acceptPath='/api/merchant-enterprise/employees/accept';
const storageKey='faolla:enterprise-invitation:v1:'+site,password='Synthetic-new-staff-only!2026';
const localFetch=globalThis.fetch;
const bounded=async(promise,label)=>{let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(label)),15000);})]);}finally{clearTimeout(timer);}};

export function assertInitialPasswordPortalPending(stored,invite,prior){
  assert(stored&&typeof stored==='object');
  assert.deepEqual(Object.keys(stored).sort(),['attemptId','authUserId','createdAt','initialPasswordOperationId','invitationToken','invitationVersion','stage']);
  assert.equal(stored.stage,'password_pending');assert.equal(stored.authUserId,invite.actor.id);
  assert.equal(stored.invitationVersion,invite.version);assert.equal(stored.invitationToken,invite.token);
  for(const key of ['attemptId','initialPasswordOperationId'])assert.match(stored[key],/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert(Number.isSafeInteger(stored.createdAt)&&stored.createdAt>0);
  if(prior)assert.deepEqual(stored,prior,'initial_password_original_handoff_changed');
}

export function assertInitialPasswordPortalReplay({records,operationId,authProof,before,after}){
  assert.equal(records.length,1);const record=records[0];
  assert.equal(record.path,setupPath);assert.equal(record.status,200);assert.equal(record.operationId,operationId);
  assert.equal(record.originalCredentials,true);assert.equal(record.originalPassword,true);
  assert.equal(record.factsUnchanged,true);assert.equal(record.passwordUpdatesDelta,0);
  assert.deepEqual(record.rpcNames,['faolla_claim_merchant_employee_initial_password_setup_v1']);
  assert.equal(authProof.updates,1);assert.equal(authProof.initialized,true);assert.deepEqual(after,before);
}

async function checkScenario(native,{mobile}){
  await withAttendanceConcurrencySandbox(native,async scope=>{
    const prepared=await prepareAttendanceInitialPasswordFixture(native,scope),invite=prepared.invitations[1];
    applyInitialPasswordReplayFixture(native,scope,prepared);
    const initial=prepared.facts(),baseline=prepared.protectedFingerprint(),model=createInitialPasswordAuthModel(invite.actor);
    const safe=()=>assert.equal(prepared.protectedFingerprint(),baseline,'initial_password_portal_protected_facts_changed');
    const probe=net.createServer();await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(3131,'127.0.0.1',resolve);});await new Promise(resolve=>probe.close(resolve));
    const child=spawn(process.execPath,['scripts/attendance-self-browser-harness.mjs','--portal'],{cwd:native.root,windowsHide:true,stdio:['ignore','pipe','pipe']});
    const requests=[],errors=[],external=[],pendingRoutes=new Set();
    let browser,closing=false,phase='harness',originalPending,dropSetup=true,dropAccept=!mobile;
    const savedMode=process.env.FAOLLA_PLATFORM_SNAPSHOT_WRITE_MODE;
    child.stderr.on('data',()=>errors.push('harness_stderr'));
    try{
      process.env.FAOLLA_PLATFORM_SNAPSHOT_WRITE_MODE='off';
      await bounded(new Promise((resolve,reject)=>{let output='';child.stdout.on('data',value=>{output+=String(value);if(output.includes('Attendance synthetic component QA'))resolve();});child.once('error',()=>reject(Error('harness_start_failed')));child.once('exit',()=>reject(Error('harness_exited')));}), 'initial_password_portal_harness_timeout');
      browser=await chromium.launch({headless:true});
      assert.equal((await localFetch(origin+setupPath,{method:'POST'})).status,403);
      await withAttendanceApplicationAuth(prepared.actors,prepared.rpc,async protocol=>{
        const protocolFetch=globalThis.fetch,bridge=createInitialPasswordAuthBridge(protocolFetch,invite.actor,model);
        globalThis.fetch=bridge.fetch;
        try{
          const setupCall=kind=>input=>prepared.initialPasswordRpc(`faolla_${kind}_merchant_employee_initial_password_setup_v1`,{p_input:{
            merchant_id:input.siteId,auth_user_id:input.authUserId,invitation_version:input.invitationVersion,token_hash:input.tokenHash,
            operation_id:input.operationId,password_fingerprint:input.passwordFingerprint}});
          const handleSetup=createMerchantEnterpriseInitialPasswordHandler({resolveAuthUser:resolveValidatedMerchantEnterpriseAuthUser,
            loadInvitation:prepared.loadInvitation,loadRole:prepared.loadRole,loadStaffIdentity:prepared.loadStaffIdentity,
            getAuthUserById:model.getAuthUserById,updateAuthUserById:model.updateAuthUserById,
            claimInitialPasswordSetup:setupCall('claim'),completeInitialPasswordSetup:setupCall('complete'),releaseInitialPasswordSetup:setupCall('release'),now:()=>new Date()});
          const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1280,height:960},isMobile:mobile,hasTouch:mobile,serviceWorkers:'block'});
          await context.addInitScript(()=>localStorage.setItem('merchant-space:locale:v1','zh-CN'));
          await context.route('**/*',route=>{
            if(closing)return route.abort().catch(()=>{});
            const work=(async()=>{
              const r=route.request(),url=new URL(r.url());
              if(url.origin!==origin){external.push('external_request');return route.abort();}
              assert(!url.searchParams.has('it')&&!url.searchParams.has('access_token'));
              if(url.pathname.startsWith('/auth/v1/')){
                const response=await fetch(new Request('https://attendance-auth.invalid'+url.pathname+url.search,{method:r.method(),headers:await r.allHeaders(),body:r.postData()??undefined}));
                const body=await response.text();return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body});
              }
              if(!url.pathname.startsWith('/api/')){
                assert.equal(r.method(),'GET');assert(['/enterprise/'+site,'/harness.js','/harness.css'].includes(url.pathname));return route.continue();
              }
              const headers=new Headers(await r.allHeaders());assert(headers.get('x-merchant-access-token'));assert.equal(headers.get('cookie'),null);
              if(headers.get('origin')===origin)headers.set('origin',canonical);
              if(headers.get('referer')?.startsWith(origin+'/'))headers.set('referer',canonical+headers.get('referer').slice(origin.length));
              headers.set('host','www.faolla.com');
              const request=new Request(canonical+url.pathname+url.search,{method:r.method(),headers,body:r.postData()??undefined});
              const record={path:url.pathname,method:r.method(),status:null};requests.push(record);
              let response;
              if(url.pathname===setupPath){
                assert.equal(r.method(),'POST');const input=JSON.parse(r.postData());
                assert.deepEqual(Object.keys(input).sort(),['invitationToken','invitationVersion','newPassword','operationId','siteId']);
                record.originalCredentials=input.siteId===site&&input.invitationVersion===invite.version&&input.invitationToken===invite.token;
                record.originalPassword=input.newPassword===password;record.operationId=input.operationId;
                assert(record.originalCredentials&&record.originalPassword);assert.equal(input.operationId,originalPending.initialPasswordOperationId);
                const rpcStart=prepared.initialPasswordRpcCalls.length,setupBefore=prepared.facts(),updatesBefore=model.proof().updates;
                response=await handleSetup(request);
                record.factsUnchanged=isDeepStrictEqual(prepared.facts(),setupBefore);record.passwordUpdatesDelta=model.proof().updates-updatesBefore;
                record.rpcNames=prepared.initialPasswordRpcCalls.slice(rpcStart).map(row=>row.name);
              }else if(url.pathname===acceptPath){
                assert.equal(r.method(),'POST');const input=JSON.parse(r.postData());
                assert.deepEqual(input,{siteId:site,invitationVersion:invite.version,invitationToken:invite.token});
                assert.equal(model.proof().updates,1);assert(bridge.proof().passwordAccepted>0,'initial_password_new_login_required_before_accept');
                response=await accept(request);
              }else if(url.pathname==='/api/merchant-enterprise/overview'){
                assert.equal(r.method(),'GET');response=await overview(request);
              }else if(url.pathname==='/api/merchant-business/capabilities'){
                assert.equal(r.method(),'GET');response=await handleMerchantBusinessCapabilitiesGet(request,{
                  resolveActor:(input,options)=>resolveMerchantBusinessActor(input,options,{rolloutConfig:{mode:'off',siteIds:[],valid:true},loadSite:async()=>({id:site,permissionConfig:{allowEnterpriseManagement:true}})}),
                });
              }else{
                assert.equal(r.method(),'GET');assert(['/api/merchant-enterprise/current-operations','/api/merchant-enterprise/todos','/api/merchant-enterprise/workflow-permission-gaps'].includes(url.pathname));
                await resolveValidatedMerchantEnterpriseAuthUser(request);response=Response.json({ok:false,error:'synthetic_unrelated_read_out_of_scope'},{status:503});
              }
              const body=await response.text(),payload=JSON.parse(body);record.status=response.status;record.error=payload.error??null;
              record.employeeId=payload.employee?.id??payload.actor?.id??null;record.alreadyActive=payload.alreadyActive===true;
              if(url.pathname===setupPath&&response.status===200&&dropSetup){dropSetup=false;record.dropped=true;return route.abort('connectionreset');}
              if(url.pathname===acceptPath&&response.status===200&&dropAccept){dropAccept=false;record.dropped=true;return route.abort('connectionreset');}
              return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body});
            })();
            pendingRoutes.add(work);void work.finally(()=>pendingRoutes.delete(work)).catch(()=>{});
            return work.catch(async()=>{errors.push('initial_password_portal_route_failed');await route.abort().catch(()=>{});});
          });
          const page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',()=>errors.push('pageerror'));
          const stored=()=>page.evaluate(key=>{const raw=sessionStorage.getItem(key);return raw?JSON.parse(raw):null;},storageKey);
          const passwordNotStored=async()=>assert(await page.evaluate(value=>[sessionStorage,localStorage].every(storage=>Object.keys(storage).every(key=>!storage.getItem(key).includes(value))),password),'initial_password_plaintext_persisted');
          const enterPassword=async()=>{await page.getByLabel('新密码',{exact:true}).fill(password);await page.getByLabel('确认新密码',{exact:true}).fill(password);};
          const submit=()=>page.getByRole('button',{name:'设置密码并进入工作台',exact:true}).click();
          const settledFailure=async()=>{await page.getByRole('alert').waitFor();await page.getByRole('button',{name:'设置密码并进入工作台',exact:true}).waitFor();
            assertInitialPasswordPortalPending(await stored(),invite,originalPending);
            assert.equal(await page.getByLabel('新密码',{exact:true}).inputValue(),password);
            assert.equal(await page.getByLabel('确认新密码',{exact:true}).inputValue(),password);
            assert.equal(bridge.proof().passwordAccepted,0);assert.equal(requests.filter(row=>row.path===acceptPath).length,0);
            await passwordNotStored();safe();};
          phase='callback';
          const callbackToken=protocol.issue(invite.actor,['invite']);
          await page.goto(origin+'/enterprise/'+site+'#'+new URLSearchParams({iv:String(invite.version),it:invite.token,access_token:callbackToken,refresh_token:randomUUID()}));
          await page.getByRole('heading',{name:'设置员工登录密码',exact:true}).waitFor();
          assert.equal(page.url(),origin+'/enterprise/'+site);originalPending=await stored();assertInitialPasswordPortalPending(originalPending,invite);
          assert.deepEqual(prepared.facts(),initial);assert.equal(requests.length,0);await passwordNotStored();safe();
          native.pass(`${mobile?'390px':'desktop'} actual callback creates its own bound password operation without setup/accept calls or persisted password`);

          if(mobile){
            phase='auth-update-reply-lost';model.loseNextUpdateReply();await enterPassword();await submit();await settledFailure();
            const pending=prepared.facts();assert.equal(pending.setups.length,1);assert.equal(pending.setups[0].state,'claimed');
            assert.equal(pending.employees.find(row=>row.id===invite.employeeId).status,'invited');assert.deepEqual(pending.audits,initial.audits);
            assert.equal(model.proof().updates,1);assert.equal(model.proof().initialized,true);assert.equal(requests.filter(row=>row.path===setupPath).at(-1).status,503);
            native.pass('390px actual form retains original password and operation after modeled Auth commit/503; real SQL remains claimed and no password login or acceptance starts');
          }else await enterPassword();

          phase='completed-setup-http-reply-lost';await submit();await settledFailure();
          const completed=prepared.facts();assert.equal(completed.setups.length,1);assert.equal(completed.setups[0].state,'completed');
          const member=completed.employees.find(row=>row.id===invite.employeeId);assert.equal(member.status,'invited');assert.equal(member.accepted_at,null);assert.equal(member.initial_password_policy,'completed');
          assert.deepEqual(completed.audits,initial.audits);assert.equal(model.proof().updates,1);
          const dropped=requests.filter(row=>row.path===setupPath&&row.dropped);assert.equal(dropped.length,1);assert.equal(dropped[0].status,200);
          native.pass(`${mobile?'390px':'desktop'} real setup SQL completes but aborted HTTP200 leaves the actual Portal password_pending with the original request and no premature membership activation`);

          if(mobile){
            phase='reload-empty-passwords';const beforeRequests=requests.length,documentBefore=await page.evaluate(()=>performance.timeOrigin);
            await page.reload();await page.getByRole('heading',{name:'设置员工登录密码',exact:true}).waitFor();
            assert.notEqual(await page.evaluate(()=>performance.timeOrigin),documentBefore);assertInitialPasswordPortalPending(await stored(),invite,originalPending);
            assert.equal(await page.getByLabel('新密码',{exact:true}).inputValue(),'');assert.equal(await page.getByLabel('确认新密码',{exact:true}).inputValue(),'');
            assert(await page.getByRole('button',{name:'设置密码并进入工作台',exact:true}).isDisabled());assert.equal(requests.length,beforeRequests);
            assert.deepEqual(prepared.facts(),completed);await passwordNotStored();safe();
            native.pass('390px reload naturally restores the SDK/invitation and original operation, empties both password fields and does not automatically submit setup or acceptance');
            await enterPassword();
          }

          phase='original-completed-request-retry';const replayStart=requests.length;await submit();
          if(!mobile){
            await page.getByRole('button',{name:'重试确认邀请',exact:true}).waitFor();
            assertInvitationPortalPreserved(await stored(),invite,originalPending);
          }else await page.getByRole('navigation',{name:'企业管理功能',exact:true}).waitFor({state:'attached'});
          const afterAccept=prepared.facts(),replayed=requests.slice(replayStart).filter(row=>row.path===setupPath);
          // The accept handler legitimately changes employee/audit facts after
          // replay. The receipt itself must still equal the completed snapshot.
          assertInitialPasswordPortalReplay({records:replayed,operationId:originalPending.initialPasswordOperationId,authProof:model.proof(),before:completed.setups,after:afterAccept.setups});
          assert.equal(bridge.proof().passwordAccepted,1);assert(protocol.calls.some(row=>row.path==='/auth/v1/logout'&&row.method==='POST'));
          assert.equal(afterAccept.employees.find(row=>row.id===invite.employeeId).status,'active');assert.equal(afterAccept.audits.length,initial.audits.length+1);
          for(const row of initial.employees.filter(row=>row.id!==invite.employeeId))assert.deepEqual(afterAccept.employees.find(next=>next.id===row.id),row);
          for(const row of initial.audits)assert.deepEqual(afterAccept.audits.find(next=>next.id===row.id),row);
          const newAudit=afterAccept.audits.filter(row=>!initial.audits.some(previous=>previous.id===row.id));assert.equal(newAudit[0].event_type,'invitation.accepted');assert.equal(newAudit[0].entity_id,invite.employeeId);
          native.pass(`${mobile?'390px after reload':'desktop same document'} explicit retry sends the original completed operation, uses claim-only recovery, then actual SDK local logout/new-password login and one real SQL membership activation`);

          if(!mobile){
            phase='accept-reply-retry';await page.getByRole('button',{name:'重试确认邀请',exact:true}).click();
            await page.getByRole('navigation',{name:'企业管理功能',exact:true}).waitFor({state:'attached'});
            assert.deepEqual(prepared.facts(),afterAccept);assert.equal(requests.filter(row=>row.path===setupPath).length,2);
            const accepts=requests.filter(row=>row.path===acceptPath);assert.equal(accepts.length,2);assert(accepts[0].dropped&&!accepts[0].alreadyActive);assert.equal(accepts[1].alreadyActive,true);
            native.pass('after successful new-password login, a second lost acceptance reply recovers in the real Portal without another setup/password mutation or membership audit');
          }
          phase='final-proof';
          assert.equal(await stored(),null);await passwordNotStored();
          assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'initial_password_portal_horizontal_overflow');
          const overviews=requests.filter(row=>row.path==='/api/merchant-enterprise/overview');assert(overviews.length>0&&overviews.every(row=>row.status===200&&row.employeeId===invite.employeeId));
          const sdkAccounts=await page.evaluate(()=>Object.keys(sessionStorage).filter(key=>key.endsWith('-enterprise-auth-token')).map(key=>JSON.parse(sessionStorage.getItem(key)).user.id));
          assert.deepEqual(sdkAccounts,[invite.actor.id]);assert.equal(model.proof().updates,1);safe();
          assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.deepEqual(prepared.errors,[]);assert.deepEqual(prepared.initialPasswordErrors,[]);
          console.log(JSON.stringify({initialPasswordPortal:true,mobile,completedSetupRetryPassed:true,reloadPassed:mobile,authCommitReplyLossPassed:mobile,acceptReplyRecoveryPassed:!mobile,
            passwordMutationCalls:1,passwordLoginCalls:bridge.proof().passwordAccepted,addedAcceptanceAudits:1,realPortal:true,realSetupHandlerFactory:true,realAuthResolver:true,realSql:true,
            modeledSharedPasswordState:true,injectedSetupReads:true,defaultSetupDependencies:false,realAuthService:false,realEmail:false,realPhone:false,realNextServer:false,productionAccess:false,externalRequests:0}));
        }finally{
          closing=true;
          try{await runAttendanceCleanupSteps([{name:'auth-owned-browser',run:()=>browser?.close()},{name:'auth-owned-routes',run:()=>Promise.allSettled([...pendingRoutes])}]);}
          finally{globalThis.fetch=protocolFetch;}
        }
      },undefined,prepared.read,(actor,value)=>actor.id===invite.actor.id&&model.proof().initialized&&model.passwordMatches(value));
    }catch{
      console.error(JSON.stringify({initialPasswordPortalFailed:true,mobile,phase,routeErrors:errors.length,requests:requests.map(({path,method,status,error})=>({path,method,status,error}))}));
      throw Error('initial_password_portal_acceptance_failed');
    }finally{
      closing=true;
      try{await runAttendanceCleanupSteps([{name:'browser',run:()=>browser?.close()},{name:'routes',run:()=>Promise.allSettled([...pendingRoutes])},
        {name:'harness',timeoutMs:10000,run:async()=>{if(child.pid!==undefined&&child.exitCode===null&&child.signalCode===null){const stopped=once(child,'exit');child.kill();await stopped;}}}]);}
      finally{if(savedMode===undefined)delete process.env.FAOLLA_PLATFORM_SNAPSHOT_WRITE_MODE;else process.env.FAOLLA_PLATFORM_SNAPSHOT_WRITE_MODE=savedMode;}
    }
  });
}

export async function checkInitialPasswordPortal(native){
  await checkScenario(native,{mobile:false});
  await checkScenario(native,{mobile:true});
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  await runAttendanceLabelsReuse(process.argv.slice(2),checkInitialPasswordPortal).catch(()=>{console.error('initial_password_portal_local_check_failed');process.exitCode=1;});
}
