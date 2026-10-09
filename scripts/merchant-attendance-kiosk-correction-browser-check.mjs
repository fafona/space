import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createRequire} from 'node:module';
import net from 'node:net';
import {chromium} from 'playwright';
import {runAttendanceLabelsReuse} from './merchant-attendance-choice-labels-reuse-native.mjs';
import {checkKioskCorrection,kioskJson as json} from './merchant-attendance-kiosk-correction-native.mjs';
const require=createRequire(import.meta.url);
const {handleAttendanceCorrection}=require('../src/app/api/merchant-enterprise/attendance/corrections/route-handler.ts');
const {executeAttendanceCorrection}=require('../src/lib/merchantAttendanceCorrection.server.ts');
const {handleAttendanceHistory}=require('../src/app/api/merchant-enterprise/attendance/history/route-handler.ts');
const {executeAttendanceHistory}=require('../src/lib/merchantAttendanceHistory.server.ts');
const {handleCorrectionContext}=require('../src/app/api/merchant-enterprise/attendance/corrections/context/route-handler.ts');
const {executeAttendanceSelfContext}=require('../src/lib/merchantAttendanceSelfContext.server.ts');
async function browserCheck(env){
  const {root,exec,auth,site,id,day,approve,pass}=env,origin='http://127.0.0.1:3131',canonical='https://www.faolla.com';
  const probe=net.createServer();await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(3131,'127.0.0.1',resolve);});await new Promise(resolve=>probe.close(resolve));
  const child=spawn(process.execPath,['scripts/attendance-self-browser-harness.mjs','--kiosk-correction'],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});
  let browser,loseResponse=true;const errors=[],external=[],posts=[];
  const service={rpc:async(name,a)=>{
    assert.equal(a.p_site_id,site);assert.equal(a.p_auth_user_id,auth);
    const params=[`'${site}'`,`'${auth}'`];
    if(name==='faolla_attendance_correction_self_v3')params.push(json(a.p_query),json(a.p_command),a.p_platform_enabled===true?'true':'false');
    else if(name==='faolla_attendance_self_history_v1')params.push(json(a.p_query));
    else assert.equal(name,'faolla_attendance_self_context_v1');
    try{return {data:JSON.parse(exec(`set role service_role;select public.${name}(${params.join(',')});`)),error:null};}
    catch(e){const code=String(e).match(/ERROR:\s+(attendance_[a-z_]+)/)?.[1];if(!code)throw e;return {data:null,error:{message:code}};}
  }};
  try{
    await new Promise((resolve,reject)=>{let output='';const timer=setTimeout(()=>reject(Error('kiosk_correction_harness_timeout')),20000);
      child.stdout.on('data',v=>{output+=v;if(output.includes('Attendance synthetic component QA')){clearTimeout(timer);resolve();}});
      child.stderr.on('data',v=>errors.push(String(v)));child.once('exit',code=>{clearTimeout(timer);reject(Error('harness_exit_'+code));});});
    browser=await chromium.launch({headless:true});
    const context=async mobile=>{
      const ctx=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1200,height:960},serviceWorkers:'block'});
      await ctx.route('**/*',async route=>{
        const r=route.request(),url=new URL(r.url());if(url.origin!==origin){external.push(url.origin);return route.abort();}
        if(!url.pathname.startsWith('/api/'))return route.continue();
        try{
          const headers=new Headers(await r.allHeaders());headers.set('host','www.faolla.com');headers.set('origin',canonical);headers.set('referer',canonical+'/');
          const req=new Request(canonical+url.pathname+url.search,{method:r.method(),headers,body:r.postData()??undefined});
          const deps={enabled:()=>true,allow:()=>true,authenticate:async()=>({user:{id:auth},accessToken:'synthetic',authenticationMethods:['password']}),entitlement:async()=>({permissionConfig:{allowEnterpriseManagement:true,allowEmployeeAttendance:true}})};
          let response;
          if(url.pathname.endsWith('/context'))response=await handleCorrectionContext(req,{...deps,execute:i=>executeAttendanceSelfContext(i,service)});
          else if(url.pathname.endsWith('/history'))response=await handleAttendanceHistory(req,{...deps,execute:i=>executeAttendanceHistory(i,service)});
          else {assert.equal(url.pathname,'/api/merchant-enterprise/attendance/corrections');response=await handleAttendanceCorrection(req,{...deps,execute:i=>executeAttendanceCorrection(i,service)});}
          if(r.method()==='POST'){posts.push({status:response.status,body:JSON.parse(r.postData())});if(response.status===200&&loseResponse){loseResponse=false;return route.abort('connectionfailed');}}
          await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:await response.text()});
        }catch(e){errors.push(String(e));await route.abort();}
      });return ctx;
    };
    const desktop=await context(false),p=await desktop.newPage();p.setDefaultTimeout(10000);p.on('pageerror',e=>errors.push(e.message));p.on('dialog',d=>d.accept());
    await p.goto(origin);await p.getByRole('heading',{name:'本人申请记录',exact:true}).waitFor();
    await p.getByRole('button',{name:'选择原始班次',exact:true}).click();
    const h=p.getByRole('region',{name:'本人历史打卡',exact:true});await h.getByLabel('开始日期',{exact:true}).fill(day(-1));await h.getByLabel('结束日期（含当天）',{exact:true}).fill(day(-1));
    await h.getByRole('button',{name:'查询本人记录',exact:true}).click();
    const start=h.locator('article').filter({hasText:'终端打卡'});await start.getByRole('button',{name:'选择本班次申请补正',exact:true}).click();
    await p.getByRole('heading',{name:'原始班次 · 只读',exact:true}).waitFor();
    await p.getByText('查看完整原始动作（2 条）',{exact:true}).click();const actions=p.locator('ol');assert.match(await actions.innerText(),/终端打卡/);assert.match(await actions.innerText(),/网页打卡/);
    await p.getByLabel('申请下班时间',{exact:true}).fill(day(-1)+'T17:00');await p.getByLabel('申请理由（1～500 字，不含换行）',{exact:true}).fill('终端与网页混合班次合成补正');
    await p.getByRole('checkbox',{name:/我已核对全部时间/}).check();await p.getByRole('button',{name:'明确提交补正申请',exact:true}).click();
    await p.getByRole('button',{name:'明确用原编号重试',exact:true}).waitFor();assert.equal(posts.length,1);assert.equal(posts[0].status,200);
    await p.reload();await p.getByRole('heading',{name:'已提交 · 未审批',exact:true}).waitFor();assert.equal(posts.length,1);
    const request=posts[0].body.operationId;assert.equal(exec(`select count(*) from public.merchant_attendance_correction_entries where request_id='${request}';`),'1');
    assert.equal(await p.getByRole('button',{name:'明确用原编号重试',exact:true}).count(),0);
    pass('actual desktop history selects kiosk clock-in; mixed-source preview submits through real handler/executor/SQL and recovers lost response with GET only');
    approve(request,id(9300));await p.getByRole('button',{name:'重新读取',exact:true}).click();await p.getByText('已批准 · 核定修订',{exact:true}).waitFor();
    await p.getByRole('region',{name:'补正审批决定',exact:true}).waitFor();
    assert.match(await p.getByRole('region',{name:'补正审批决定',exact:true}).innerText(),/网页／终端来源不变/);await desktop.close();
    const mobile=await context(true),m=await mobile.newPage();m.setDefaultTimeout(10000);m.on('pageerror',e=>errors.push(e.message));
    await m.goto(origin);
    await m.getByText(/^已批准 · 核定修订 · 版本 1$/).first().waitFor();
    await m.getByRole('button',{name:'查看差异／撤回',exact:true}).first().click();
    await m.getByRole('region',{name:'补正审批决定',exact:true}).waitFor();assert(await m.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await m.getByText('查看完整原始动作（2 条）',{exact:true}).click();assert.match(await m.locator('ol').innerText(),/终端打卡/);assert.match(await m.locator('ol').innerText(),/网页打卡/);
    exec(`update public.merchant_enterprise_employees set status='disabled' where id='${env.employee}';`);
    await m.getByRole('button',{name:'重新读取',exact:true}).click();await m.getByRole('status').filter({hasText:/权限/}).waitFor();assert.equal(await m.getByRole('region',{name:'补正审批决定',exact:true}).count(),0);assert.equal(posts.length,1);
    exec(`update public.merchant_enterprise_employees set status='active' where id='${env.employee}';`);await mobile.close();
    pass('approved mixed-source details visible on desktop/390px mobile; disabling membership removes evidence on refresh, with no extra write');
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.equal(env.raw(),env.rawBefore);
  }finally{await browser?.close();if(child.exitCode===null){const stopped=once(child,'exit');child.kill();await stopped;}}
}
await runAttendanceLabelsReuse(process.argv.slice(2),native=>checkKioskCorrection(native,browserCheck));
