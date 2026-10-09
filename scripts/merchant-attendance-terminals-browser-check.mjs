import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import net from 'node:net';
import { chromium } from 'playwright';
import { runAttendanceLabelsReuse } from './merchant-attendance-choice-labels-reuse-native.mjs';
import { checkAttendanceTerminals, terminalJson as json, terminalLiteral as literal } from './merchant-attendance-terminals-native.mjs';
const require=createRequire(import.meta.url);
const {handleTerminalAdmin}=require('../src/app/api/merchant-enterprise/attendance/terminals/route-handler.ts');
const {handleTerminalDevice}=require('../src/app/api/merchant-enterprise/attendance/terminal-device/route-handler.ts');
const {executeTerminalAdmin,executeTerminalDevice}=require('../src/lib/merchantAttendanceTerminal.server.ts');
const {handleAttendanceAdmin}=require('../src/app/api/merchant-enterprise/attendance/admin/route-handler.ts');
const {executeAttendanceAdmin}=require('../src/lib/merchantAttendanceAdmin.server.ts');
const {createAttendanceDatabaseTransport}=require('./fixtures/attendance-database-transport.ts');
const {TERMINAL_COOKIE}=require('../src/lib/merchantAttendanceTerminal.ts');
async function browserCheck(env){
  // Secure virtual origin is fulfilled exclusively from the loopback harness.
  // Tests actual browser cookie policy, not real DNS/TLS or production middleware.
  const {root,exec,owner,location,pass}=env,origin='https://attendance.synthetic.test',localOrigin='http://127.0.0.1:3131',canonical='https://www.faolla.com';
  const probe=net.createServer();await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(3131,'127.0.0.1',resolve);});await new Promise(resolve=>probe.close(resolve));
  const child=spawn(process.execPath,['scripts/attendance-self-browser-harness.mjs','--terminals'],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});
  const errors=[],external=[],requests=[],controls={loseOwner:true,deviceLoss:'body',moduleEnabled:true};let browser;
  const transport=createAttendanceDatabaseTransport(exec);
  const service={rpc:async(name,a)=>{
    if(name==='faolla_attendance_admin_v1')return transport.rpc(name,a);
    let source;
    if(name==='faolla_attendance_terminal_admin_v1')source=`public.${name}(${literal(a.p_site)},${literal(a.p_auth)},${json(a.p_query)},${json(a.p_command)},${a.p_allow_create===true})`;
    else {assert.equal(name,'faolla_attendance_terminal_device_v1');source=`public.${name}(${literal(a.p_site)},${literal(a.p_id)},${literal(a.p_secret_hash)},${a.p_device_hash===null?'null':literal(a.p_device_hash)},${a.p_allow_pair===true})`;}
    assert.equal(a.p_site,'99990001');
    try{return {data:JSON.parse(exec(`set role service_role;select ${source};`)),error:null};}
    catch(e){const code=String(e).match(/ERROR:\s+(attendance_[a-z_]+)/)?.[1];if(!code)throw e;return {data:null,error:{message:code}};}
  }};
  try{
    await new Promise((resolve,reject)=>{let output='';const timer=setTimeout(()=>reject(Error('terminal_harness_timeout')),20000);
      child.stdout.on('data',v=>{output+=v;if(output.includes('Attendance synthetic component QA')){clearTimeout(timer);resolve();}});
      child.stderr.on('data',v=>errors.push(String(v)));child.once('exit',code=>{clearTimeout(timer);reject(Error('terminal_harness_exit_'+code));});});
    browser=await chromium.launch({headless:true});
    async function context(){
      const ctx=await browser.newContext({viewport:{width:1100,height:1000},serviceWorkers:'block'});
      await ctx.route('**/*',async route=>{
        const r=route.request(),url=new URL(r.url());
        if(url.origin!==origin){external.push(url.origin);return route.abort();}
        if(!url.pathname.startsWith('/api/')){if(!['/','/harness.js','/harness.css'].includes(url.pathname))return route.abort();
          return route.fulfill({response:await ctx.request.get(localOrigin+url.pathname)});}
        try{
          const headers=new Headers(await r.allHeaders());if(headers.get('origin')===origin)headers.set('origin',canonical);headers.set('host','www.faolla.com');
          if(headers.get('referer')?.startsWith(origin))headers.set('referer',canonical+'/');
          const req=new Request(canonical+url.pathname+url.search,{method:r.method(),headers,body:r.postData()??undefined});
          const deps={enabled:()=>true,allow:()=>true,entitlement:async()=>({permissionConfig:{allowEnterpriseManagement:true,allowEmployeeAttendance:controls.moduleEnabled}})};
          const auth=async()=>{assert.equal(headers.get('x-attendance-test-actor'),'owner');return {user:{id:owner},accessToken:'synthetic',authenticationMethods:['password']};};
          let response;
          if(url.pathname.endsWith('/terminal-device'))response=await handleTerminalDevice(req,{...deps,execute:input=>executeTerminalDevice(input,service)});
          else if(url.pathname.endsWith('/terminals'))response=await handleTerminalAdmin(req,{...deps,authenticate:auth,execute:input=>executeTerminalAdmin(input,service)});
          else{assert.equal(url.pathname,'/api/merchant-enterprise/attendance/admin');assert.equal(r.method(),'GET');response=await handleAttendanceAdmin(req,{...deps,authenticate:auth,execute:input=>executeAttendanceAdmin(input,service)});}
          const body=r.postData()?JSON.parse(r.postData()):null;requests.push({path:url.pathname,method:r.method(),status:response.status,action:body?.action??body?.command?.action});
          if(controls.loseOwner&&url.pathname.endsWith('/terminals')&&r.method()==='POST'&&response.status===200){controls.loseOwner=false;return route.abort('connectionfailed');}
          if(controls.deviceLoss&&url.pathname.endsWith('/terminal-device')&&body?.action==='pair'&&response.status===200){
            const lose=controls.deviceLoss;controls.deviceLoss='';if(lose==='all')return route.abort('connectionfailed');
            return route.fulfill({status:200,headers:Object.fromEntries(response.headers),body:'invalid/truncated JSON'});
          }
          return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:await response.text()});
        }catch(e){errors.push(String(e));return route.abort();}
      });return ctx;
    }
    const ownerContext=await context(),deviceContext=await context(),ownerPage=await ownerContext.newPage(),devicePage=await deviceContext.newPage();
    for(const p of [ownerPage,devicePage])p.on('pageerror',e=>errors.push(String(e)));
    await ownerPage.goto(origin);await ownerPage.getByRole('button',{name:'门店终端配对',exact:true}).click();
    const panel=ownerPage.getByRole('region',{name:'门店终端管理'});
    await panel.getByRole('status').filter({hasText:'已读取当前状态'}).waitFor();
    assert.equal(await panel.locator('a[href="/enterprise/attendance-terminal"]').count(),1);
    await panel.getByRole('button',{name:'读取工作地点',exact:true}).click();
    await panel.getByRole('combobox',{name:'绑定工作地点'}).selectOption(location);
    await panel.getByRole('textbox',{name:'终端名称'}).fill('浏览器合成前台');await panel.getByRole('button',{name:'生成五分钟配对码'}).click();
    await panel.getByRole('button',{name:'原样重试此操作'}).waitFor();
    await panel.getByRole('button',{name:'重新读取／核对原终端'}).click();await panel.getByRole('textbox',{name:'一次性配对码',exact:true}).waitFor();
    const token=await panel.getByRole('textbox',{name:'一次性配对码',exact:true}).inputValue();const terminalId=token.split('.')[1];
    assert.equal(requests.filter(r=>r.path.endsWith('/terminals')&&r.action==='create').length,1);
    assert.equal(await ownerPage.evaluate(()=>localStorage.length+sessionStorage.length),0);
    pass('real owner launcher creates/retrieves pair code after lost response using GET only; no browser-storage secrets');
    await devicePage.goto(origin);await devicePage.getByRole('button',{name:'门店设备界面'}).click();
    await devicePage.getByRole('textbox',{name:'粘贴一次性配对码'}).fill(token);await devicePage.getByRole('button',{name:'确认配对此浏览器'}).click();
    await devicePage.getByRole('status').filter({hasText:'暂时无法确认'}).waitFor();
    const cookies=await deviceContext.cookies(origin);const cookie=cookies.find(c=>c.name===TERMINAL_COOKIE);
    assert(cookie,'real browser must accept secure host cookie on isolated HTTPS origin');assert.equal(cookie.httpOnly,true);assert.equal(cookie.secure,true);assert.equal(cookie.sameSite,'Strict');
    assert(!(await devicePage.evaluate(()=>document.cookie)).includes(TERMINAL_COOKIE));
    await devicePage.getByRole('button',{name:'检查当前终端状态'}).click();await devicePage.getByRole('heading',{name:'浏览器合成前台',exact:true}).waitFor();
    assert.equal(requests.filter(r=>r.action==='pair').length,1);
    assert.equal(await devicePage.evaluate(()=>localStorage.length+sessionStorage.length),0);
    pass('real device component receives HttpOnly/Secure/Strict cookie; lost response body recovers by cookie GET without re-pair');
    controls.moduleEnabled=false;
    await panel.getByRole('button',{name:'重新读取／核对原终端'}).click();
    let row=panel.locator('article').filter({hasText:terminalId});await row.getByRole('button',{name:'撤销终端',exact:true}).click();await row.getByRole('button',{name:'确认撤销此终端'}).click();
    await panel.getByRole('heading',{name:'浏览器合成前台 · 已撤销',exact:true}).waitFor();
    await devicePage.getByRole('button',{name:'检查当前终端状态'}).click();await devicePage.getByRole('status').filter({hasText:'终端凭证或配对码不可用'}).waitFor();
    assert.equal(await devicePage.getByRole('heading',{name:'浏览器合成前台',exact:true}).count(),0);
    pass('owner can revoke while attendance paused; device re-check hides stale paired metadata');
    await devicePage.getByRole('checkbox').check();await devicePage.getByRole('button',{name:'清除此浏览器终端凭证'}).click();
    await devicePage.getByRole('textbox',{name:'粘贴一次性配对码'}).waitFor();assert(!(await deviceContext.cookies(origin)).some(c=>c.name===TERMINAL_COOKIE));
    controls.moduleEnabled=true;await panel.getByRole('button',{name:'重新读取／核对原终端'}).click();await panel.getByRole('button',{name:'生成五分钟配对码'}).waitFor({state:'visible'});
    await panel.getByRole('textbox',{name:'终端名称'}).fill('配对响应全部丢失');await panel.getByRole('button',{name:'生成五分钟配对码'}).click();
    await panel.getByRole('textbox',{name:'一次性配对码',exact:true}).waitFor();const secondToken=await panel.getByRole('textbox',{name:'一次性配对码',exact:true}).inputValue();
    controls.deviceLoss='all';await devicePage.getByRole('textbox',{name:'粘贴一次性配对码'}).fill(secondToken);await devicePage.getByRole('button',{name:'确认配对此浏览器'}).click();
    await devicePage.getByRole('status').filter({hasText:'暂时无法确认'}).waitFor();await devicePage.getByRole('button',{name:'检查当前终端状态'}).click();
    await devicePage.getByRole('status').filter({hasText:'当前浏览器没有终端凭证'}).waitFor();
    assert(!(await deviceContext.cookies(origin)).some(c=>c.name===TERMINAL_COOKIE));
    await panel.getByRole('button',{name:'重新读取／核对原终端'}).click();row=panel.locator('article').filter({hasText:secondToken.split('.')[1]});
    await row.getByRole('heading',{name:'配对响应全部丢失 · 已配对',exact:true}).waitFor();
    await row.getByRole('button',{name:'撤销终端',exact:true}).click();await row.getByRole('button',{name:'确认撤销此终端'}).click();
    await panel.getByRole('heading',{name:'配对响应全部丢失 · 已撤销',exact:true}).waitFor();
    assert.equal(requests.filter(r=>r.action==='pair').length,2);
    pass('lost Set-Cookie cannot fabricate/replay a credential; UI sends user to owner for explicit revocation/re-pair');
    for(const p of [ownerPage,devicePage]){await p.setViewportSize({width:390,height:844});assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'terminal mobile overflow');}
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.equal(exec('select count(*) from public.merchant_attendance_events;'),'0');
    pass('owner/device layouts fit 390px, no external requests, no JS errors and no attendance writes');
  }finally{await browser?.close();if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}}
}
await runAttendanceLabelsReuse(process.argv.slice(2),native=>checkAttendanceTerminals(native,browserCheck));
