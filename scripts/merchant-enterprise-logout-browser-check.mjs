// Actual portal/selector + installed SDK, with in-memory synthetic Auth/business
// transport. No database, real credentials, production network or disk artifacts.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createRequire} from 'node:module';
import net from 'node:net';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';

const require=createRequire(import.meta.url);
const {withAttendanceApplicationAuth}=require('./fixtures/attendance-application-auth.ts');
const {createAttendancePortalModel,portalActors,portalId}=require('./fixtures/attendance-portal-model.ts');
const {resolveValidatedMerchantEnterpriseAuthContext,requireMerchantEnterprisePasswordAuthentication}=require('../src/lib/merchantEnterpriseAuth.server.ts');
const {attendancePendingKey}=require('../src/lib/merchantAttendanceSelfClient.ts');
// Capture before withAttendanceApplicationAuth replaces global fetch.
const localFetch=globalThis.fetch;
const root=fileURLToPath(new URL('../',import.meta.url)),origin='http://127.0.0.1:3131';
const authOrigin='https://attendance-auth.invalid';
const sentinel={ownerKey:'sb-logout-owner-fixture-auth-token',ownerValue:'noncredential synthetic owner sentinel',
  pendingKey:attendancePendingKey('99990001',portalActors[0].id),pendingValue:JSON.stringify({version:1,siteId:'99990001',
    employeeId:portalActors[0].id,workerId:portalId(10),command:{expectedWorkerId:portalId(10),locationId:portalId(20),
      action:'clock_in',expectedSequence:0,operationId:portalId(9901)}})};
function deferred(){let resolve;const promise=new Promise(yes=>{resolve=yes;});return {promise,resolve};}
async function bounded(promise,label,ms=10000){
  let timer;
  try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(label)),ms);})]);}
  finally{clearTimeout(timer);}
}

const probe=net.createServer();
await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(3131,'127.0.0.1',resolve);});
await new Promise(resolve=>probe.close(resolve));
const child=spawn(process.execPath,['scripts/attendance-self-browser-harness.mjs','--portal'],
  {cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});
let browser,checks=0;
const harnessErrors=[];
try{
  await bounded(new Promise((resolve,reject)=>{
    let output='';child.stdout.on('data',value=>{output+=value;if(output.includes('Attendance synthetic component QA'))resolve();});
    child.stderr.on('data',value=>harnessErrors.push(String(value)));
    child.once('exit',code=>reject(Error('logout_harness_exit_'+code)));
  }),'logout_harness_timeout',25000);
  const shell=await localFetch(origin+'/enterprise');assert.equal(shell.status,200);
  assert.match(shell.headers.get('content-security-policy'),/connect-src 'self';/);
  for(const [path,method] of [['/auth/v1/logout','POST'],['/api/merchant-enterprise/attendance/self','GET']])
    assert.equal((await localFetch(origin+path,{method})).status,403);
  browser=await chromium.launch({headless:true});

  const attendance=page=>page.getByRole('region',{name:'我的考勤',exact:true});
  const login=async(page,{index=0,selector=true,enterCompany=true,password='Synthetic-attendance-only!'}={})=>{
    await page.getByLabel('员工邮箱',{exact:true}).fill(portalActors[index].email);
    await page.getByLabel('密码',{exact:true}).fill(password);
    await page.getByRole('button',{name:selector?'登录并选择企业':'登录企业工作台',exact:true}).click();
    if(selector&&enterCompany)await page.getByRole('button',{name:'进入工作台',exact:true}).click();
  };
  const enter=async page=>{
    await page.getByRole('button',{name:'我的考勤',exact:true}).click();
    await attendance(page).getByRole('button',{name:'上班打卡',exact:true}).waitFor();
  };
  const logout=async(page,selector=false)=>{
    const name=selector?'退出登录':'退出员工登录';
    if(!selector&&!await page.getByRole('button',{name,exact:true}).isVisible())
      await page.getByRole('button',{name:'打开员工工作区导航',exact:true}).click();
    // Deliberately do NOT await network completion or storage polling here.
    await page.getByRole('button',{name,exact:true}).click();
    await page.getByLabel('员工邮箱',{exact:true}).waitFor();
  };
  const seed=page=>page.evaluate(value=>{
    // Noncredential sentinels only; no application auth/session is injected.
    localStorage.setItem(value.ownerKey,value.ownerValue);
    sessionStorage.setItem(value.pendingKey,value.pendingValue);
  },sentinel);
  const preserved=async page=>{
    const stored=await page.evaluate(value=>({owner:localStorage.getItem(value.ownerKey),pending:sessionStorage.getItem(value.pendingKey)}),sentinel);
    assert.deepEqual(stored,{owner:sentinel.ownerValue,pending:sentinel.pendingValue});
  };
  const noSavedEnterpriseSession=async page=>{
    const keys=await page.evaluate(()=>[...Object.keys(sessionStorage),...Object.keys(localStorage)]
      .filter(key=>key.endsWith('-enterprise-auth-token')||key.endsWith('-enterprise-auth-token-user')));
    assert.deepEqual(keys,[],'reloadable_employee_credentials_must_be_absent');
  };
  const signedOut=async(page,selector)=>{
    await page.getByRole('button',{name:selector?'登录并选择企业':'登录企业工作台',exact:true}).waitFor();
    assert.equal(await attendance(page).count(),0);
    assert.equal(await page.locator('[data-employee-merchant-shell]').count(),0);
    assert.doesNotMatch(await page.locator('body').innerText(),/合成员工甲|合成员工乙|收据编号/);
    await noSavedEnterpriseSession(page);
  };

  const run=async(name,check,mobile=false)=>withAttendanceApplicationAuth(portalActors,null,async()=>{
    const model=createAttendancePortalModel(),calls=[],authCalls=[],errors=[],external=[],tokens=new Map(),gates=[];
    const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1280,height:960},isMobile:mobile,hasTouch:mobile,serviceWorkers:'block'});
    let page,nextGate=null;
    const active=new Set();
    const arm=(mode='hold')=>{
      assert.equal(nextGate,null);const seen=deferred(),release=deferred(),done=deferred();
      const gate={mode,seen:seen.promise,done:done.promise,release:()=>release.resolve(),token:null,processed:false,
        allowCancelled:false,signalSeen:seen.resolve,wait:release.promise,signalDone:done.resolve};
      nextGate=gate;gates.push(gate);return gate;
    };
    const validToken=async token=>{
      assert(token);
      const response=await fetch(new Request(authOrigin+'/auth/v1/user',{headers:{apikey:'attendance-synthetic-anon',authorization:'Bearer '+token}}));
      assert.equal(response.status,200,'held_or_failed_logout_must_not_rely_on_remote_token_revocation');
    };
    await context.route('**/*',route=>{
      const task=(async()=>{
        const request=route.request(),url=new URL(request.url());
        if(url.origin!==origin){external.push(url.origin+url.pathname);return route.abort();}
        if(!url.pathname.startsWith('/auth/v1/')&&!url.pathname.startsWith('/api/')){
          assert.equal(request.method(),'GET');
          assert(['/enterprise','/enterprise/99990001','/harness.js','/harness.css'].includes(url.pathname));
          return route.continue();
        }
        let gate=null;
        try{
          const headers=await request.allHeaders(),body=request.postData()??undefined;
          let response;
          if(url.pathname.startsWith('/auth/v1/')){
            authCalls.push({path:url.pathname,method:request.method()});
            assert(['/auth/v1/token','/auth/v1/user','/auth/v1/logout'].includes(url.pathname));
            if(url.pathname==='/auth/v1/logout'){
              gate=nextGate;nextGate=null;assert(gate,'unexpected_sdk_logout');
              assert.equal(request.method(),'POST');assert.equal(url.searchParams.get('scope'),'global');
              const token=(headers.authorization??'').replace(/^Bearer /,'');
              assert(token&&[...tokens.values()].includes(token),'sdk_logout_must_use_pre_logout_bearer');
              gate.token=token;gate.signalSeen();
              if(gate.mode==='hold')await bounded(gate.wait,'held_logout_release_timeout',20000);
              if(gate.mode==='disconnect'){await route.abort('connectionreset');return;}
              if(gate.mode==='server500')response=Response.json({code:'synthetic_logout_unavailable',message:'Synthetic logout unavailable'},{status:500});
              else{gate.processed=true;response=await fetch(new Request(authOrigin+url.pathname+url.search,{method:request.method(),headers,body}));}
            }else response=await fetch(new Request(authOrigin+url.pathname+url.search,{method:request.method(),headers,body}));
          }else{
            assert(request.method()==='GET'||url.pathname==='/api/merchant-enterprise/employees/accept','logout_journey_business_writes_forbidden');
            assert(headers['x-merchant-access-token'],'explicit_employee_token_required');assert.equal(headers.cookie,undefined);
            const req=new Request('https://www.faolla.com'+url.pathname+url.search,{method:request.method(),headers,body});
            try{
              const identity=await resolveValidatedMerchantEnterpriseAuthContext(req);requireMerchantEnterprisePasswordAuthentication(identity);
              tokens.set(identity.user.id,headers['x-merchant-access-token']);response=await model.respond(req,identity.user.id);
            }catch(error){if(error.code==='unauthorized')response=Response.json({ok:false,error:'unauthorized'},{status:401});else throw error;}
            assert(response);calls.push({path:url.pathname,method:request.method(),status:response.status});
          }
          await route.fulfill({status:response.status,headers:{'content-type':'application/json','cache-control':'no-store'},body:await response.text()});
        }catch(error){
          // A held request belongs to the intentionally unloaded old document.
          // Only its cancelled delivery is ignorable, never request processing.
          if(!(gate?.allowCancelled&&gate.processed&&/closed|Invalid InterceptionId|interception|canceled|cancelled/i.test(String(error))))errors.push(url.pathname+': '+String(error));
          await route.abort().catch(()=>{});
        }finally{gate?.signalDone();}
      })();
      active.add(task);void task.finally(()=>active.delete(task));return task;
    });
    try{
      page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',error=>errors.push(String(error)));
      await page.goto(origin+'/enterprise');
      await check({page,model,calls,authCalls,tokens,arm,validToken});
      assert.equal(model.posts,0);assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.deepEqual(harnessErrors,[]);
      assert(calls.every(call=>call.status===200));checks++;console.log('PASS '+name);
    }catch(error){
      if(page&&!page.isClosed())console.error(JSON.stringify({check:name,statuses:await page.getByRole('status').allTextContents(),calls,authCalls,errors}));
      throw error;
    }finally{
      for(const gate of gates){gate.allowCancelled=true;gate.release();}
      try{await bounded(Promise.allSettled([...active]),'logout_route_cleanup_timeout',10000);}
      finally{await context.close();}
    }
  });

  await run('ordinary same-tab reload preserves real SDK login before any logout',async({page,tokens})=>{
    await login(page);await enter(page);const token=tokens.get(portalActors[0].id);assert(token);
    await page.reload();await enter(page);assert.equal(tokens.get(portalActors[0].id),token);
    assert.match(await attendance(page).innerText(),/合成员工甲/);
  });

  const heldCase=async(f,{selectorLogout=false,navigate=false}={})=>{
    const {page,calls,authCalls,arm,validToken}=f;
    await login(page,{enterCompany:!selectorLogout});
    if(selectorLogout)await page.getByRole('button',{name:'进入工作台',exact:true}).waitFor();else await enter(page);
    await seed(page);const gate=arm();await logout(page,selectorLogout);await bounded(gate.seen,'sdk_logout_not_sent');
    assert.equal(gate.processed,false);await validToken(gate.token);await noSavedEnterpriseSession(page);await preserved(page);
    const beforeApi=calls.length,beforeAuth=authCalls.length;gate.allowCancelled=true;
    if(navigate)await page.goto(origin+'/enterprise');else await page.reload();
    await signedOut(page,selectorLogout||navigate);await preserved(page);
    await page.waitForLoadState('networkidle');assert.equal(calls.length,beforeApi);assert.equal(authCalls.length,beforeAuth);
    assert.equal(gate.processed,false);await validToken(gate.token);
    gate.release();await bounded(gate.done,'sdk_logout_not_finished');await signedOut(page,selectorLogout||navigate);
    assert.equal(calls.length,beforeApi);await preserved(page);
    if(navigate)assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  };
  await run('portal logout immediately reloads safely while the original bearer remains valid remotely',f=>heldCase(f));
  await run('390px portal logout immediately navigates to selector without restoring auth or private API requests',f=>heldCase(f,{navigate:true}),true);
  await run('selector logout immediately reloads safely without restoring memberships or a saved employee token',f=>heldCase(f,{selectorLogout:true}));

  for(const mode of ['server500','disconnect'])await run(mode+' logout keeps local denial, preserves unrelated storage and permits an explicit fresh login',async({page,calls,arm,validToken,tokens})=>{
    await login(page);await enter(page);await seed(page);const oldToken=tokens.get(portalActors[0].id),gate=arm(mode);
    await logout(page);await bounded(gate.done,'failed_logout_not_finished');
    await page.getByText('已清除本标签页登录，服务器退出请求未确认。其他设备的登录状态可能仍有效。',{exact:true}).waitFor();
    await signedOut(page,false);await preserved(page);assert.equal(gate.processed,false);await validToken(oldToken);
    const before=calls.length;
    await login(page,{index:1,selector:false,password:'wrong-synthetic-password'});
    await page.getByText('Invalid credentials',{exact:true}).waitFor();await signedOut(page,false);assert.equal(calls.length,before);
    await page.reload();await signedOut(page,false);assert.equal(calls.length,before);await preserved(page);
    await login(page,{index:1,selector:false});await enter(page);assert.match(await attendance(page).innerText(),/合成员工乙/);
    assert.doesNotMatch(await attendance(page).innerText(),/合成员工甲/);assert.notEqual(tokens.get(portalActors[1].id),oldToken);await preserved(page);
    await page.reload();await enter(page);assert.match(await attendance(page).innerText(),/合成员工乙/);await preserved(page);
  });
  console.log(JSON.stringify({checks,actualPortalSelectorAndSdk:true,syntheticAuthAndBusinessTransport:true,
    remoteLogoutHeldBeforeProcessing:true,databaseAccess:false,productionAccess:false,businessWrites:0,persistentArtifacts:false}));
}finally{
  await browser?.close();
  if(child.exitCode===null){const stopped=once(child,'exit');child.kill();await bounded(stopped,'logout_harness_cleanup_timeout',10000);}
}
