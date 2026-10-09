// Loopback-only, memory bundle and synthetic transport. No production accounts,
// Next middleware, actual Auth service or database are implied by these checks.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import net from 'node:net';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {withAttendanceApplicationAuth}=require('./fixtures/attendance-application-auth.ts');
const {createAttendancePortalModel,portalActors}=require('./fixtures/attendance-portal-model.ts');
const {resolveValidatedMerchantEnterpriseAuthContext,requireMerchantEnterprisePasswordAuthentication}=require('../src/lib/merchantEnterpriseAuth.server.ts');
const root=fileURLToPath(new URL('../',import.meta.url)),origin='http://127.0.0.1:3131';
const features=process.argv.includes('--features');
const probe=net.createServer();await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(3131,'127.0.0.1',resolve);});await new Promise(resolve=>probe.close(resolve));
const child=spawn(process.execPath,['scripts/attendance-self-browser-harness.mjs','--portal',...(features?['--portal-features']:[])],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});
let browser,checks=0;const errors=[],external=[];
try{
  await new Promise((resolve,reject)=>{let output='';const timer=setTimeout(()=>reject(Error('harness_timeout')),15000);child.stdout.on('data',c=>{output+=String(c);if(output.includes('Attendance synthetic component QA')){clearTimeout(timer);resolve();}});child.stderr.on('data',c=>errors.push(String(c)));child.once('exit',code=>{clearTimeout(timer);reject(Error(`harness_exit_${code}`));});});
  browser=await chromium.launch({headless:true});
  // Without Playwright's interception the harness is GET-only and has no API.
  // Even opening this page manually cannot reach auth or write business data.
  const harnessPage=await fetch(origin+'/enterprise');assert.equal(harnessPage.status,200);
  assert.match(harnessPage.headers.get('content-security-policy'),/connect-src 'self';/);
  for(const [path,method] of [['/auth/v1/token','POST'],['/api/merchant-enterprise/attendance/self','POST'],['/api/merchant-enterprise/attendance/self','GET']])
    assert.equal((await fetch(origin+path,{method})).status,403);
  const attendance=p=>p.getByRole('region',{name:'我的考勤',exact:true});
  const login=async(p,index=0,selector=true)=>{
    await p.getByLabel('员工邮箱',{exact:true}).fill(portalActors[index].email);
    await p.getByLabel('密码',{exact:true}).fill('Synthetic-attendance-only!');
    await p.getByRole('button',{name:selector?'登录并选择企业':'登录企业工作台',exact:true}).click();
    if(selector)await p.getByRole('button',{name:'进入工作台',exact:true}).click();
  };
  const enter=async p=>{await p.getByRole('button',{name:'我的考勤',exact:true}).click();await attendance(p).getByRole('button',{name:'上班打卡',exact:true}).waitFor();};
  const confirmed=p=>attendance(p).getByText('打卡已确认',{exact:true}).waitFor();
  const logout=async p=>{if(!await p.getByRole('button',{name:'退出员工登录',exact:true}).isVisible())await p.getByRole('button',{name:'打开员工工作区导航',exact:true}).click();await p.getByRole('button',{name:'退出员工登录',exact:true}).click();};
  const noOverflow=async p=>assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'horizontal_overflow');
  const run=async(name,fn,mobile=false)=>withAttendanceApplicationAuth(portalActors,null,async auth=>{
    const model=createAttendancePortalModel(features),context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1280,height:960},isMobile:mobile,hasTouch:mobile,serviceWorkers:'block'});
    let gpsCalls=0;
    await context.exposeBinding('attendanceQaPositionUsed',()=>{gpsCalls++;});
    await context.addInitScript(()=>Object.defineProperty(navigator,'geolocation',{value:{getCurrentPosition(success){void window.attendanceQaPositionUsed();queueMicrotask(()=>success({timestamp:Date.now(),coords:{latitude:37.3,longitude:-5.9,accuracy:10}}));}}}));
    const calls=[],tokens=new Set();let holdSelf=false,release=null;
    await context.route('**/*',async route=>{
      const r=route.request(),url=new URL(r.url());
      if(url.origin!==origin){external.push(url.origin+url.pathname);return route.abort();}
      if(!url.pathname.startsWith('/auth/v1/')&&!url.pathname.startsWith('/api/'))return route.continue();
      try{
        calls.push({path:url.pathname,method:r.method()});const headers=await r.allHeaders(),body=r.postData()??undefined;
        let response;
        if(url.pathname.startsWith('/auth/v1/'))response=await fetch(new Request('https://attendance-auth.invalid'+url.pathname+url.search,{method:r.method(),headers,body}));
        else{
          const request=new Request('https://www.faolla.com'+url.pathname+url.search,{method:r.method(),headers,body});
          assert(headers['x-merchant-access-token'],'explicit_employee_token_required');tokens.add(headers['x-merchant-access-token']);
          try{const actor=await resolveValidatedMerchantEnterpriseAuthContext(request);requireMerchantEnterprisePasswordAuthentication(actor);response=await model.respond(request,actor.user.id);}
          catch(e){if(e.code==='unauthorized')response=Response.json({ok:false,error:'unauthorized'},{status:401});else throw e;}
          if(holdSelf&&url.pathname.endsWith('/attendance/self')&&r.method()==='GET'){holdSelf=false;await new Promise(resolve=>{release=resolve;});release=null;}
        }
        if(response===null)return route.abort('connectionreset');
        return route.fulfill({status:response.status,headers:{'content-type':'application/json','cache-control':'no-store'},body:await response.text()});
      }catch(e){errors.push(`${url.pathname}: ${e.message}`);await route.abort();}
    });
    const p=await context.newPage();p.setDefaultTimeout(8000);p.on('pageerror',e=>errors.push(e.message));p.on('dialog',d=>d.accept());
    try{
      await p.goto(origin+'/enterprise');
      await fn({p,model,auth,calls,tokens,gps:()=>gpsCalls,hold:()=>{holdSelf=true;},release:()=>release?.(),held:()=>Boolean(release)});
      assert.equal(external.length,0);assert.deepEqual(errors,[]);checks++;console.log('PASS '+name);
    }catch(e){console.error('UI_FAILURE',name,(await p.locator('body').innerText()).slice(-6500));throw e;}
    finally{release?.();await context.close();}
  });
  await run('employee actual selector / login / workspace / attendance; one explicit clock write',async({p,model})=>{
    await login(p);await enter(p);assert.equal(await p.getByRole('button',{name:'考勤配置',exact:true}).count(),0);
    await attendance(p).getByRole('button',{name:'上班打卡',exact:true}).click();await confirmed(p);assert.equal(model.posts,1);assert.equal(model.count(),1);await noOverflow(p);
  });
  await run('mobile actual employee entry remains usable without horizontal overflow',async({p,model})=>{
    await login(p);await enter(p);await noOverflow(p);await attendance(p).getByRole('button',{name:'上班打卡',exact:true}).click();await confirmed(p);await noOverflow(p);assert.equal(model.posts,1);
  },true);
  await run('view-only role cannot issue a clock command',async({p,model})=>{
    model.canClock=false;await login(p);await enter(p);assert(await attendance(p).getByRole('button',{name:'上班打卡',exact:true}).isDisabled());assert.equal(model.posts,0);
  });
  await run('clock permission downgrade remounts a read-only panel and preserves only confirmed state',async({p,model})=>{
    await login(p);await enter(p);await attendance(p).getByRole('button',{name:'上班打卡',exact:true}).click();await confirmed(p);
    model.canClock=false;model.version++;await p.evaluate(()=>window.dispatchEvent(new Event('focus')));
    await p.getByRole('button',{name:'我的考勤',exact:true}).click();await attendance(p).getByRole('button',{name:'下班打卡',exact:true}).waitFor();
    assert(await attendance(p).getByRole('button',{name:'下班打卡',exact:true}).isDisabled());assert.equal(model.posts,1);
  });
  await run('invalid password never requests membership or business access',async({p,calls})=>{
    await p.getByLabel('员工邮箱',{exact:true}).fill(portalActors[0].email);await p.getByLabel('密码',{exact:true}).fill('wrong-synthetic-password');
    await p.getByRole('button',{name:'登录并选择企业',exact:true}).click();await p.getByText('Invalid credentials',{exact:true}).waitFor();
    assert.equal(calls.filter(c=>c.path.startsWith('/api/')).length,0);assert.equal(await attendance(p).count(),0);
  });
  await run('role permission loss via actual capability refresh unmounts private attendance',async({p,model})=>{
    await login(p);await enter(p);model.denied=true;await p.evaluate(()=>window.dispatchEvent(new Event('focus')));
    await p.getByText('登录状态或角色权限已变化，请重新核验。',{exact:true}).waitFor();assert.equal(await attendance(p).count(),0);assert.equal(model.posts,0);
  });
  await run('revoked signed session removes workspace; never falls back to merchant cookies',async({p,auth,tokens})=>{
    await login(p);await enter(p);for(const token of tokens)auth.revoke(token);await p.evaluate(()=>window.dispatchEvent(new Event('focus')));
    await p.getByText('登录状态或角色权限已变化，请重新核验。',{exact:true}).waitFor();assert.equal(await attendance(p).count(),0);
  });
  await run('actual logout and login as another employee never exposes the first employee receipt',async({p,model})=>{
    await login(p);await enter(p);await attendance(p).getByRole('button',{name:'上班打卡',exact:true}).click();await confirmed(p);
    await p.getByRole('button',{name:'退出员工登录',exact:true}).click();await p.getByRole('button',{name:'登录企业工作台',exact:true}).waitFor();assert.equal(await attendance(p).count(),0);
    await login(p,1,false);await enter(p);assert.match(await attendance(p).innerText(),/合成员工乙/);assert.doesNotMatch(await attendance(p).innerText(),/合成员工甲|收据编号/);assert.equal(model.count(portalActors[1].id),0);assert.equal(model.posts,1);
  });
  await run('lost clock response survives full reload and is reconciled by GET, not another POST',async({p,model})=>{
    await login(p);await enter(p);model.loseNextPost=true;await attendance(p).getByRole('button',{name:'上班打卡',exact:true}).click();await attendance(p).getByText('打卡结果待确认',{exact:true}).waitFor();
    await p.reload();await p.getByRole('button',{name:'我的考勤',exact:true}).click();await confirmed(p);assert.equal(model.posts,1);assert.equal(model.count(),1);assert(model.receipts>=1);
  });
  await run('actual SDK token refresh preserves identity and uncertain operation reconciliation',async({p,model,tokens})=>{
    await login(p);await enter(p);model.loseNextPost=true;await attendance(p).getByRole('button',{name:'上班打卡',exact:true}).click();await attendance(p).getByText('打卡结果待确认',{exact:true}).waitFor();
    await p.getByRole('button',{name:'验收 SDK 刷新会话'}).click();await p.getByRole('button',{name:'我的考勤',exact:true}).click();await confirmed(p);assert(tokens.size>=2);assert.equal(model.posts,1);assert.equal(model.count(),1);
  });
  await run('failed SDK refresh signs out and removes prior employee data',async({p,auth,tokens})=>{
    await login(p);await enter(p);for(const token of tokens)auth.revoke(token);
    await p.getByRole('button',{name:'验收 SDK 刷新会话'}).click();await p.getByRole('button',{name:'登录企业工作台',exact:true}).waitFor();assert.equal(await attendance(p).count(),0);
  });
  await run('employee session survives same-tab reload but is absent in a fresh tab and persistent storage',async({p,model})=>{
    await login(p);await enter(p);const keys=await p.evaluate(()=>Object.keys(localStorage));assert(!keys.some(k=>k.includes('enterprise-auth-token')));
    assert(!(await p.context().cookies()).some(c=>c.name.includes('auth')));
    const fresh=await p.context().newPage();await fresh.goto(origin+'/enterprise');await fresh.getByRole('button',{name:'登录并选择企业',exact:true}).waitFor();assert.equal(await attendance(fresh).count(),0);await fresh.close();
    await p.reload();await enter(p);assert.equal(model.posts,0);
  });
  await run('old delayed self response cannot repopulate a signed-out portal',async({p,hold,held,release})=>{
    await login(p);hold();await p.getByRole('button',{name:'我的考勤',exact:true}).click();
    await p.waitForFunction(()=>Boolean(document.querySelector('section[aria-label="我的考勤"]')));
    for(let n=0;n<100&&!held();n++)await new Promise(r=>setTimeout(r,20));assert(held());
    await p.getByRole('button',{name:'退出员工登录',exact:true}).click();await p.getByRole('button',{name:'登录企业工作台',exact:true}).waitFor();release();
    await p.waitForLoadState('networkidle');assert.equal(await attendance(p).count(),0);assert.equal(await p.getByText('收据编号',{exact:false}).count(),0);
  });
  if(features){
    const location=p=>p.getByRole('region',{name:'我的定位考勤',exact:true});
    const clock=p=>p.getByRole('region',{name:'定位打卡隔离原型',exact:true});
    const correction=p=>p.getByRole('region',{name:'本人考勤补正申请',exact:true});
    const openLocation=async p=>{await attendance(p).getByRole('button',{name:'定位打卡／地点告知',exact:true}).click();await clock(p).getByRole('combobox',{name:'登记动作',exact:true}).waitFor();};
    const acknowledge=async p=>{
      await location(p).getByRole('button',{name:'查看／确认地点告知',exact:true}).click();const notice=p.getByRole('region',{name:'定位政策告知',exact:true});
      await notice.getByRole('checkbox').check();await notice.getByRole('button',{name:'确认收到本版本告知',exact:true}).click();await notice.getByText(/本人已确认收到此版本/).waitFor();
      await location(p).getByRole('button',{name:'打卡与原班次收尾',exact:true}).click();await clock(p).getByRole('button',{name:'定位并登记上班',exact:true}).waitFor();
    };
    const openCorrection=async p=>{await attendance(p).getByRole('button',{name:'我的补正申请／核对结果',exact:true}).click();await correction(p).getByRole('button',{name:'选择原始班次',exact:true}).waitFor();};
    const prepareCorrection=async p=>{
      await correction(p).getByRole('button',{name:'选择原始班次',exact:true}).click();const h=p.getByRole('region',{name:'本人历史打卡',exact:true});
      await h.getByLabel('开始日期',{exact:true}).fill('2026-09-28');await h.getByLabel('结束日期（含当天）',{exact:true}).fill('2026-09-30');
      await h.getByRole('button',{name:'查询本人记录',exact:true}).click();await h.getByRole('button',{name:'选择本班次申请补正',exact:true}).click();
      await correction(p).getByLabel('申请理由（1～500 字，不含换行）',{exact:true}).fill('合成申请，仅浏览器隔离验收');
      await correction(p).getByRole('checkbox',{name:/我已核对全部时间与休息/}).check();
    };
    await run('enabled location entry fetches no position before explicit clock; notice acknowledgement is separate',async({p,model,gps})=>{
      const f=model.location.get(portalActors[0].id);await f.publish();await login(p);await enter(p);await openLocation(p);assert.equal(gps(),0);assert.equal(f.metrics().punches,0);
      assert(await clock(p).getByRole('button',{name:'定位并登记上班',exact:true}).isDisabled());await acknowledge(p);assert.equal(gps(),0);assert.equal(f.metrics().punches,0);
      await clock(p).getByRole('button',{name:'定位并登记上班',exact:true}).click();await clock(p).getByText('服务器确认动作',{exact:true}).waitFor();assert.equal(gps(),1);assert.equal(f.metrics().punches,1);await noOverflow(p);
    });
    await run('mobile lost location response blocks the other channel and reload recovers without another position request',async({p,model,gps})=>{
      const f=model.location.get(portalActors[0].id);await f.publish();await login(p);await enter(p);await openLocation(p);await acknowledge(p);f.mode('lost');
      await clock(p).getByRole('button',{name:'定位并登记上班',exact:true}).click();await clock(p).getByText(/结果仍待确认/).waitFor();assert.equal(gps(),1);assert.equal(f.metrics().punches,1);
      const pendingStorage=await p.evaluate(()=>Object.entries(sessionStorage).filter(([key])=>key.includes('attendance')).map(([,value])=>value).join('\n'));assert.doesNotMatch(pendingStorage,/latitude|longitude|accuracyMeters|37\.3|-5\.9/);
      await p.reload();await p.getByRole('button',{name:'我的考勤',exact:true}).click();await attendance(p).getByRole('button',{name:'下班打卡',exact:true}).waitFor();assert(await attendance(p).getByRole('button',{name:'下班打卡',exact:true}).isDisabled());await noOverflow(p);f.mode('normal');
      await openLocation(p);await clock(p).getByText('服务器确认动作',{exact:true}).waitFor();assert.equal(gps(),1);assert.equal(f.metrics().punches,1);assert.equal(f.metrics().posts,2);await noOverflow(p);
    },true);
    await run('location workflow revoked identity is removed by real workspace capability refresh',async({p,model,gps})=>{
      await login(p);await enter(p);await openLocation(p);model.denied=true;await p.evaluate(()=>window.dispatchEvent(new Event('focus')));
      await p.getByText('登录状态或角色权限已变化，请重新核验。',{exact:true}).waitFor();assert.equal(await location(p).count(),0);assert.equal(gps(),0);
    });
    await run('actual portal correction selection and submit; ordinary punch channel has no new write',async({p,model})=>{
      await login(p);await enter(p);await openCorrection(p);await prepareCorrection(p);await correction(p).getByRole('button',{name:'明确提交补正申请',exact:true}).click();
      await correction(p).getByRole('button',{name:'明确撤回申请',exact:true}).waitFor();assert.equal(model.corrections.get(portalActors[0].id).writes(),1);assert.equal(model.posts,0);await noOverflow(p);
    });
    await run('lost correction submit survives token refresh and only re-reads original receipt',async({p,model})=>{
      const f=model.corrections.get(portalActors[0].id);await login(p);await enter(p);await openCorrection(p);await prepareCorrection(p);f.mode('lost');
      await correction(p).getByRole('button',{name:'明确提交补正申请',exact:true}).click();await correction(p).getByText(/待确认：提交补正/).waitFor();
      await p.getByRole('button',{name:'验收 SDK 刷新会话'}).click();await enter(p);f.mode('normal');await openCorrection(p);await correction(p).getByRole('button',{name:'明确撤回申请',exact:true}).waitFor();
      assert.equal(f.writes(),1);assert.equal(f.calls.filter(c=>c.method==='POST').length,1);
    });
    await run('correction request permission downgrade hides submit form after fresh role generation',async({p,model})=>{
      await login(p);await enter(p);await openCorrection(p);await prepareCorrection(p);model.canRequest=false;model.version++;
      await p.evaluate(()=>window.dispatchEvent(new Event('focus')));await enter(p);await openCorrection(p);await correction(p).getByRole('button',{name:'选择原始班次',exact:true}).click();
      const h=p.getByRole('region',{name:'本人历史打卡',exact:true});await h.getByLabel('开始日期',{exact:true}).fill('2026-09-28');await h.getByLabel('结束日期（含当天）',{exact:true}).fill('2026-09-30');
      await h.getByRole('button',{name:'查询本人记录',exact:true}).click();await h.getByRole('button',{name:'选择本班次申请补正',exact:true}).click();
      await correction(p).getByText('当前权限、平台状态或申请规则不允许新提交；未创建补正。',{exact:true}).waitFor();assert.equal(await correction(p).getByRole('button',{name:'明确提交补正申请',exact:true}).count(),0);assert.equal(model.corrections.get(portalActors[0].id).writes(),0);
    });
    await run('logout during a correction draft and login as employee B reveals neither draft nor employee A request',async({p,model})=>{
      await login(p);await enter(p);await openCorrection(p);await prepareCorrection(p);await logout(p);
      await p.getByRole('button',{name:'登录企业工作台',exact:true}).waitFor();await login(p,1,false);await enter(p);await openCorrection(p);
      await correction(p).getByText('本页没有申请记录。可选择原始班次开始申请。',{exact:true}).waitFor();assert.doesNotMatch(await correction(p).innerText(),/合成申请，仅浏览器隔离验收/);
      assert.equal(model.corrections.get(portalActors[0].id).writes(),0);assert.equal(model.corrections.get(portalActors[1].id).writes(),0);await noOverflow(p);
    },true);
    await run('pending correction remains owned by A through logout, B session, and fresh login by A',async({p,model})=>{
      const a=model.corrections.get(portalActors[0].id),b=model.corrections.get(portalActors[1].id);
      await login(p);await enter(p);await openCorrection(p);await prepareCorrection(p);a.mode('lost');await correction(p).getByRole('button',{name:'明确提交补正申请',exact:true}).click();
      await correction(p).getByText(/待确认：提交补正/).waitFor();await logout(p);await p.getByRole('button',{name:'登录企业工作台',exact:true}).waitFor();
      await login(p,1,false);await enter(p);await openCorrection(p);await correction(p).getByText('本页没有申请记录。可选择原始班次开始申请。',{exact:true}).waitFor();assert.equal(b.writes(),0);
      await logout(p);await p.getByRole('button',{name:'登录企业工作台',exact:true}).waitFor();a.mode('normal');await login(p,0,false);await enter(p);await openCorrection(p);
      await correction(p).getByRole('button',{name:'明确撤回申请',exact:true}).waitFor();assert.equal(a.writes(),1);assert.equal(a.calls.filter(c=>c.method==='POST').length,1);
    });
  }
  console.log(JSON.stringify({checks,features,externalRequests:external.length,browserErrors:errors.length,actualEmployeePages:true,syntheticAuthAndBusinessTransport:true,syntheticPosition:true,productionWrites:0,artifactsWritten:0}));
}finally{
  if(browser)await browser.close();if(child.exitCode===null){const stopped=once(child,'exit');child.kill();await stopped;}
}
