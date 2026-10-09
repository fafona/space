// Actual enterprise manager, not AdminClient/login/Next middleware. Synthetic
// owner cookie + actual application auth resolver; all business data in memory.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import net from 'node:net';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {chromium} from 'playwright';
const require=createRequire(import.meta.url),{withAttendanceApplicationAuth}=require('./fixtures/attendance-application-auth.ts');
const {entryOwner,createOwnerEntryModel}=require('./fixtures/attendance-owner-entry-model.ts');
const {resolveValidatedMerchantEnterpriseAuthContext}=require('../src/lib/merchantEnterpriseAuth.server.ts');
const {MERCHANT_AUTH_COOKIE}=require('../src/lib/merchantAuthSession.ts');
// Intercepted HTTPS browser origin permits the real __Host- Secure cookie.
// Static bytes come from our GET-only loopback harness; no TLS/proxy deployment
// is being tested and browser cookies are never forwarded to that harness.
const origin='https://127.0.0.1:3131',staticOrigin='http://127.0.0.1:3131',localFetch=globalThis.fetch,root=fileURLToPath(new URL('../',import.meta.url));
const probe=net.createServer();await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(3131,'127.0.0.1',resolve);});await new Promise(resolve=>probe.close(resolve));
const child=spawn(process.execPath,['scripts/attendance-self-browser-harness.mjs','--owner-entry'],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});
let browser,checks=0;const errors=[],external=[];
try{
  await new Promise((resolve,reject)=>{let output='';const timer=setTimeout(()=>reject(Error('harness_timeout')),15000);child.stdout.on('data',chunk=>{output+=String(chunk);if(output.includes('Attendance synthetic component QA')){clearTimeout(timer);resolve();}});child.stderr.on('data',chunk=>errors.push(String(chunk)));child.once('exit',code=>{clearTimeout(timer);reject(Error(`harness_exit_${code}`));});});
  browser=await chromium.launch({headless:true});const panel=p=>p.getByRole('region',{name:'考勤配置管理',exact:true});
  const run=async(name,fn,mobile=false)=>withAttendanceApplicationAuth([entryOwner],null,async auth=>{
    const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1280,height:960},isMobile:mobile,hasTouch:mobile,serviceWorkers:'block'}),model=createOwnerEntryModel();
    const token=await auth.login(entryOwner);await context.addCookies([{name:MERCHANT_AUTH_COOKIE,value:token,url:origin,secure:true,httpOnly:true,sameSite:'Lax'}]);
    let heldResponse=null;
    const holdNext=path=>{assert.equal(heldResponse,null);let entered,release;const gate={path,entered:new Promise(resolve=>{entered=resolve;}),released:new Promise(resolve=>{release=resolve;}),arrive:()=>entered(),release:()=>release()};heldResponse=gate;return gate;};
    await context.route('**/*',async route=>{
      const r=route.request(),url=new URL(r.url());if(url.origin!==origin){external.push(url.origin+url.pathname);return route.abort();}
      if(!url.pathname.startsWith('/api/')){
        if(r.method()!=='GET'||!['/','/harness.js','/harness.css'].includes(url.pathname))return route.abort();
        const staticResponse=await localFetch(staticOrigin+url.pathname);return route.fulfill({status:staticResponse.status,headers:Object.fromEntries(staticResponse.headers),body:Buffer.from(await staticResponse.arrayBuffer())});
      }
      try{
        const headers=await r.allHeaders();assert.equal(headers['x-merchant-access-token'],undefined);assert(headers.cookie?.includes(MERCHANT_AUTH_COOKIE+'='),'owner_cookie_required');
        const request=new Request('https://www.faolla.com'+url.pathname+url.search,{headers,method:r.method(),body:r.postData()??undefined});
        let response;try{const identity=await resolveValidatedMerchantEnterpriseAuthContext(request);response=await model.respond(request,identity.user.id);}
        catch(e){if(e.code==='unauthorized')response=Response.json({ok:false,error:'unauthorized'},{status:401});else throw e;}
        if(heldResponse?.path===url.pathname&&r.method()==='GET'){const gate=heldResponse;gate.arrive();await gate.released;heldResponse=null;}
        if(response===null)return route.abort('connectionreset');return route.fulfill({status:response.status,contentType:'application/json',body:await response.text()});
      }catch(e){errors.push(url.pathname+': '+e.message);await route.abort();}
    });
    const p=await context.newPage();p.setDefaultTimeout(8000);p.on('pageerror',e=>errors.push(e.message));p.on('dialog',d=>d.accept());
    const renewSession=async()=>{const nextToken=await auth.login(entryOwner);await context.addCookies([{name:MERCHANT_AUTH_COOKIE,value:nextToken,url:origin,secure:true,httpOnly:true,sameSite:'Lax'}]);return nextToken;};
    try{await p.goto(origin);await panel(p).getByRole('button',{name:'创建考勤配置',exact:true}).waitFor();await fn({p,model,auth,token,renewSession,holdNext});assert.deepEqual(errors,[]);assert.deepEqual(external,[]);checks++;console.log('PASS '+name);}
    catch(e){console.error('OWNER_UI_FAILURE',name,(await p.locator('body').innerText()).slice(-4000));throw e;}finally{heldResponse?.release();await context.close();}
  });
  const save=async p=>{await panel(p).getByLabel('企业考勤时区',{exact:true}).fill('UTC');await panel(p).getByRole('button',{name:'创建考勤配置',exact:true}).click();};
  await run('owner external enterprise navigation exposes configuration, never employee self attendance',async({p,model})=>{
    assert.equal(await p.getByRole('button',{name:'进入员工本人考勤',exact:true}).count(),0);await p.getByRole('button',{name:'进入考勤配置',exact:true}).click();await save(p);
    await panel(p).getByRole('button',{name:'保存考勤设置',exact:true}).waitFor();assert.equal(model.posts,1);assert.equal(model.writes(),1);
  });
  await run('mobile owner configuration is reachable before task bootstrap and has no overflow',async({p,model})=>{
    assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await save(p);await panel(p).getByRole('button',{name:'保存考勤设置',exact:true}).waitFor();assert.equal(model.writes(),1);assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  },true);
  await run('owner unknown save receipt survives reload with no second POST',async({p,model})=>{
    model.lost=true;await save(p);await panel(p).getByText(/待确认/).first().waitFor();assert.equal(model.writes(),1);model.lost=false;await p.reload();await panel(p).getByRole('button',{name:'保存考勤设置',exact:true}).waitFor();assert.equal(model.posts,1);assert.equal(model.writes(),1);
  });
  await run('owner revoked session and manual enterprise refresh remove configuration and never write',async({p,model,auth,token})=>{
    auth.revoke(token);await p.getByRole('button',{name:'刷新数据',exact:true}).click();await p.getByText(/企业登录已失效|请先登录|企业管理加载失败|登录状态/).first().waitFor();assert.equal(await panel(p).count(),0);assert.equal(model.posts,0);
  });
  const denied=p=>p.getByRole('region',{name:'企业身份需重新核验',exact:true});
  const refresh=p=>p.getByRole('button',{name:'刷新数据',exact:true}).click();
  const retry=p=>p.getByRole('button',{name:'重新核验企业身份',exact:true}).click();
  const waitForGate=async gate=>{let timer;try{await Promise.race([gate.entered,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('held_request_not_received')),8000);})]);}finally{clearTimeout(timer);}};
  for(const status of [401,403])await run(`overview ${status} without JSON removes protected tree and rechecks before recovery`,async({p,model})=>{
    await panel(p).getByLabel('企业考勤时区',{exact:true}).fill('UTC');model.overviewStatus=status;model.invalidOverviewBody=true;await refresh(p);await denied(p).waitFor();
    assert.equal(await panel(p).count(),0);assert.equal(await p.getByRole('navigation',{name:'验收外层企业导航'}).getByRole('button').count(),0);
    await retry(p);await denied(p).waitFor();assert.equal(await panel(p).count(),0);
    model.overviewStatus=200;await retry(p);await panel(p).getByRole('button',{name:'创建考勤配置',exact:true}).waitFor();
    assert.notEqual(await panel(p).getByLabel('企业考勤时区',{exact:true}).inputValue(),'UTC');assert.equal(model.posts,0);
  });
  for(const status of [500,429,0])await run(`temporary overview ${status||'network failure'} retains unsaved configuration`,async({p,model})=>{
    await panel(p).getByLabel('企业考勤时区',{exact:true}).fill('UTC');model.overviewStatus=status;
    const finished=status?p.waitForResponse(r=>r.url().includes('/overview?')&&r.status()===status):p.waitForEvent('requestfailed',{predicate:r=>r.url().includes('/overview?')});
    await refresh(p);await finished;await p.getByRole('button',{name:'刷新数据',exact:true}).waitFor();
    assert.equal(await denied(p).count(),0);assert.equal(await panel(p).getByLabel('企业考勤时区',{exact:true}).inputValue(),'UTC');
    model.overviewStatus=200;await save(p);await panel(p).getByRole('button',{name:'保存考勤设置',exact:true}).waitFor();assert.equal(model.posts,1);
  });
  await run('unknown committed owner save survives auth invalidation and recovery without another POST',async({p,model,auth,token,renewSession})=>{
    model.lost=true;await save(p);await panel(p).getByText(/待确认/).first().waitFor();assert.equal(model.writes(),1);
    const operationId=model.operationIds()[0],readCount=model.receiptQueries.length;
    auth.revoke(token);await refresh(p);await denied(p).waitFor();assert.equal(await panel(p).count(),0);
    model.lost=false;await renewSession();await retry(p);await panel(p).getByRole('button',{name:'保存考勤设置',exact:true}).waitFor();
    assert.equal(await panel(p).getByLabel('企业考勤时区',{exact:true}).inputValue(),'UTC');assert.equal(model.posts,1);assert.equal(model.writes(),1);
    assert(model.receiptQueries.slice(readCount).includes(operationId),'reauthentication must query the original uncertain operation id');
  });
  await run('parent navigation callback changes do not reload overview or discard drafts',async({p,model})=>{
    await panel(p).getByLabel('企业考勤时区',{exact:true}).fill('UTC');const reads=model.overviewGets;
    for(let i=0;i<3;i++)await p.getByRole('button',{name:/重绘外层/}).click();
    assert.equal(await p.getByRole('button',{name:'重绘外层 3',exact:true}).count(),1);assert.equal(model.overviewGets,reads);
    assert.equal(await panel(p).getByLabel('企业考勤时区',{exact:true}).inputValue(),'UTC');assert.equal(model.posts,0);
  });
  await run('late attendance reader cannot resurrect the denied enterprise tree',async({p,model,holdNext})=>{
    const gate=holdNext('/api/merchant-enterprise/attendance/admin');await panel(p).getByRole('button',{name:'重新读取',exact:true}).click();await waitForGate(gate);
    model.overviewStatus=403;await refresh(p);await denied(p).waitFor();gate.release();await p.waitForLoadState('networkidle');
    assert.equal(await panel(p).count(),0);assert.equal(await denied(p).count(),1);assert.equal(model.posts,0);
  });
  await run('late todo response cannot restore the cleared outer badge after access loss',async({p,model,holdNext})=>{
    model.needsBootstrap=false;const gate=holdNext('/api/merchant-enterprise/todos');await refresh(p);await waitForGate(gate);
    model.overviewStatus=403;await refresh(p);await denied(p).waitFor();gate.release();await p.waitForLoadState('networkidle');
    assert.equal(await p.getByRole('status',{name:'外层待办数'}).innerText(),'0');assert.equal(await denied(p).count(),1);assert.equal(model.posts,0);
  });
  await run('feature-specific write denial does not invalidate enterprise identity',async({p,model})=>{
    model.moduleEnabled=false;const failed=p.waitForResponse(r=>r.url().endsWith('/attendance/admin')&&r.request().method()==='POST'&&r.status()===403);
    await save(p);await failed;assert.equal(await denied(p).count(),0);assert.equal(await p.getByRole('button',{name:'刷新数据',exact:true}).count(),1);assert.equal(model.writes(),0);
  });
  await run('mobile authorization denial removes configuration and can recover',async({p,model})=>{
    model.overviewStatus=403;await refresh(p);await denied(p).waitFor();assert.equal(await panel(p).count(),0);assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    model.overviewStatus=200;await retry(p);await panel(p).getByRole('button',{name:'创建考勤配置',exact:true}).waitFor();assert.equal(model.posts,0);
  },true);
  for(const view of ['roles','tasks'])await run(`${view} drafts and parent badges are cleared only on authoritative denial`,async({p,model})=>{
    model.needsBootstrap=false;await refresh(p);await p.getByRole('status',{name:'外层待办数'}).filter({hasText:'2'}).waitFor();
    await p.getByRole('button',{name:view==='roles'?'进入角色管理':'进入任务管理',exact:true}).click();
    if(view==='roles')await p.getByRole('button',{name:/新建角色/}).click();
    const field=()=>p.getByLabel(view==='roles'?'角色名称':'任务标题',{exact:true});await field().fill('合成未保存草稿');
    await p.getByRole('button',{name:'读取导航防护',exact:true}).click();assert.equal(await p.getByRole('status',{name:'外层导航防护'}).innerText(),'true / true');
    model.overviewStatus=500;const failed=p.waitForResponse(r=>r.url().includes('/overview?')&&r.status()===500);await refresh(p);await failed;assert.equal(await field().inputValue(),'合成未保存草稿');
    model.overviewStatus=403;await refresh(p);await denied(p).waitFor();assert.equal(await field().count(),0);
    assert.equal(await p.getByRole('status',{name:'外层待办数'}).innerText(),'0');assert.equal(await p.getByRole('navigation',{name:'验收外层企业导航'}).getByRole('button').count(),0);
    await p.getByRole('button',{name:'读取导航防护',exact:true}).click();assert.equal(await p.getByRole('status',{name:'外层导航防护'}).innerText(),'false / false');
    model.overviewStatus=200;await retry(p);if(view==='roles')await p.getByRole('button',{name:/新建角色/}).click();
    await field().waitFor();assert.equal(await field().inputValue(),'');assert.equal(model.posts,0);
  });
  console.log(JSON.stringify({checks,actualEnterpriseManager:true,fullAdminClient:false,realLoginService:false,syntheticAuthAndBusinessTransport:true,externalRequests:external.length,artifactsWritten:0}));
}finally{await browser?.close();if(child.exitCode===null){const stopped=once(child,'exit');child.kill();await stopped;}}
