import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createRequire} from 'node:module';
import net from 'node:net';
import {chromium} from 'playwright';
import {runAttendanceLabelsReuse} from './merchant-attendance-choice-labels-reuse-native.mjs';
import {checkAttendancePin} from './merchant-attendance-pin-native.mjs';
const require=createRequire(import.meta.url);
const {handlePinAdmin}=require('../src/app/api/merchant-enterprise/attendance/pin-credentials/route-handler.ts');
const {handlePinVerify}=require('../src/app/api/merchant-enterprise/attendance/terminal-pin/route-handler.ts');
const {executePinAdmin,executePinVerification}=require('../src/lib/merchantAttendancePin.server.ts');
const {TERMINAL_COOKIE}=require('../src/lib/merchantAttendanceTerminal.ts');
async function browserCheck(env){
  const {root,exec,owner,pass,site,terminalId,deviceSecret,service,query,pin,nextPin,set,resetAttempts}=env;
  const origin='https://attendance.synthetic.test',localOrigin='http://127.0.0.1:3131',canonical='https://www.faolla.com';
  const probe=net.createServer();await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(3131,'127.0.0.1',resolve);});await new Promise(resolve=>probe.close(resolve));
  const child=spawn(process.execPath,['scripts/attendance-self-browser-harness.mjs','--pin'],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});
  const errors=[],external=[],requests=[];let browser,loseOwner=true,loseDevice=false;
  try{
    await new Promise((resolve,reject)=>{let output='';const timer=setTimeout(()=>reject(Error('pin_harness_timeout')),20000);
      child.stdout.on('data',v=>{output+=v;if(output.includes('Attendance synthetic component QA')){clearTimeout(timer);resolve();}});
      child.stderr.on('data',v=>errors.push(String(v)));child.once('exit',code=>{clearTimeout(timer);reject(Error('pin_harness_exit_'+code));});});
    browser=await chromium.launch({headless:true});
    async function context(device=false){
      const ctx=await browser.newContext({viewport:{width:1100,height:1000},serviceWorkers:'block'});
      if(device)await ctx.addCookies([{name:TERMINAL_COOKIE,value:`${site}.${terminalId}.${deviceSecret}`,url:origin,httpOnly:true,secure:true,sameSite:'Strict'}]);
      await ctx.route('**/*',async route=>{
        const r=route.request(),url=new URL(r.url());
        if(url.origin!==origin){external.push(url.origin);return route.abort();}
        if(!url.pathname.startsWith('/api/')){if(!['/','/harness.js','/harness.css'].includes(url.pathname))return route.abort();return route.fulfill({response:await ctx.request.get(localOrigin+url.pathname)});}
        try{
          const headers=new Headers(await r.allHeaders());if(headers.get('origin')===origin)headers.set('origin',canonical);headers.set('host','www.faolla.com');
          if(headers.get('referer')?.startsWith(origin))headers.set('referer',canonical+'/');
          const req=new Request(canonical+url.pathname+url.search,{method:r.method(),headers,body:r.postData()??undefined});
          const deps={enabled:()=>true,allow:()=>true,entitlement:async()=>({permissionConfig:{allowEnterpriseManagement:true,allowEmployeeAttendance:true}})};
          let response;
          if(url.pathname.endsWith('/pin-credentials'))response=await handlePinAdmin(req,{...deps,authenticate:async()=>{assert.equal(headers.get('x-attendance-test-actor'),'owner');return {user:{id:owner},accessToken:'synthetic',authenticationMethods:['password']};},execute:input=>executePinAdmin(input,service)});
          else{assert.equal(url.pathname,'/api/merchant-enterprise/attendance/terminal-pin');response=await handlePinVerify(req,{...deps,execute:input=>executePinVerification(input,service)});}
          requests.push({path:url.pathname,method:r.method(),status:response.status}); // Never keep a PIN or request body in diagnostics.
          if(loseOwner&&url.pathname.endsWith('/pin-credentials')&&r.method()==='POST'&&response.status===200){loseOwner=false;return route.abort('connectionfailed');}
          if(loseDevice&&url.pathname.endsWith('/terminal-pin')&&response.status===200){loseDevice=false;return route.abort('connectionfailed');}
          return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:await response.text()});
        }catch(e){errors.push(String(e));return route.abort();}
      });return ctx;
    }
    const ownerContext=await context(),deviceContext=await context(true),ownerPage=await ownerContext.newPage(),devicePage=await deviceContext.newPage();
    for(const p of [ownerPage,devicePage]){p.setDefaultTimeout(12000);p.on('pageerror',e=>errors.push(String(e)));}
    await ownerPage.goto(origin);await ownerPage.getByRole('button',{name:'管理员工终端 PIN',exact:true}).click();
    const panel=ownerPage.getByRole('region',{name:'员工终端 PIN 管理'});
    await panel.getByLabel('考勤工号',{exact:true}).fill('PIN-01');await panel.getByRole('button',{name:'读取员工 PIN 状态',exact:true}).click();
    await panel.getByRole('status').filter({hasText:'已读取当前状态'}).waitFor();
    await panel.getByLabel('新 PIN（8–12 位数字）',{exact:true}).fill(nextPin);await panel.getByRole('checkbox',{name:/我已核对员工/}).check();
    await panel.getByRole('button',{name:'确认设置／重置 PIN',exact:true}).click();
    await panel.getByRole('status').filter({hasText:'暂时无法确认'}).waitFor();await panel.getByRole('button',{name:'核对原 PIN 操作',exact:true}).click();
    await panel.getByRole('status').filter({hasText:'原操作已确认（版本 5）'}).waitFor();
    assert.equal(await panel.getByLabel('新 PIN（8–12 位数字）',{exact:true}).inputValue(),'');
    assert.equal(requests.filter(r=>r.path.endsWith('/pin-credentials')&&r.method==='POST').length,1);
    pass('actual PIN owner launcher recovers committed reset after response loss using GET only, retaining no plaintext or browser-storage PIN');
    await devicePage.goto(origin+'/#device');
    const verify=async value=>{await devicePage.getByLabel('考勤工号',{exact:true}).fill('PIN-01');await devicePage.getByLabel('员工 PIN',{exact:true}).fill(value);await devicePage.getByRole('button',{name:'验证 PIN（不打卡）',exact:true}).click();};
    await verify(pin);await devicePage.getByRole('status').filter({hasText:'工号或 PIN 不可用'}).waitFor();
    await verify(nextPin);try{await devicePage.getByRole('status').filter({hasText:'已验证：PIN 合成员工'}).waitFor();}catch(e){console.error(JSON.stringify({status:await devicePage.getByRole('status').textContent(),requests,errors}));throw e;}
    assert.match(await devicePage.getByRole('status').textContent(),/这不是打卡成功/);
    assert.equal(await devicePage.getByLabel('员工 PIN',{exact:true}).inputValue(),'');assert.equal(await devicePage.getByLabel('考勤工号',{exact:true}).inputValue(),'');
    await devicePage.clock.install();await verify(nextPin);await devicePage.getByRole('status').filter({hasText:'已验证：'}).waitFor();await devicePage.clock.fastForward(15010);
    await devicePage.getByRole('status').filter({hasText:'验证信息已清除'}).waitFor();
    pass('actual terminal browser rejects old PIN, verifies new PIN with secure device cookie, clears fields and expires result in 15s without a punch/session');
    const countBefore=requests.filter(r=>r.path.endsWith('/terminal-pin')).length;
    loseDevice=true;await verify(nextPin);await devicePage.getByRole('status').filter({hasText:'暂时无法确认'}).waitFor();
    await devicePage.clock.fastForward(15010);await devicePage.getByRole('status').filter({hasText:'验证信息已清除'}).waitFor();
    assert.equal(requests.filter(r=>r.path.endsWith('/terminal-pin')).length,countBefore+1);
    await devicePage.getByLabel('员工 PIN',{exact:true}).fill(nextPin);
    await devicePage.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});
    assert.equal(await devicePage.getByLabel('员工 PIN',{exact:true}).inputValue(),'');
    await devicePage.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));});
    await panel.getByRole('checkbox',{name:/我已核对员工/}).check();await panel.getByRole('button',{name:'撤销当前 PIN',exact:true}).click();
    await panel.getByRole('status').filter({hasText:'原操作已确认（版本 6）'}).waitFor();
    await verify(nextPin);await devicePage.getByRole('status').filter({hasText:'工号或 PIN 不可用'}).waitFor();
    pass('lost verification response is never auto-retried; hidden tab clears PIN; owner revocation rejects the formerly valid PIN');
    for(const p of [ownerPage,devicePage]){await p.setViewportSize({width:390,height:844});assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'PIN mobile overflow');assert.equal(await p.evaluate(()=>localStorage.length+sessionStorage.length),0);}
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.equal(exec('select count(*) from public.merchant_attendance_events;'),'0');
    pass('390px PIN owner/device layouts, zero external requests, no script errors, no local storage and zero punches');
    await executePinAdmin({...query,command:set(4010,6)},service);resetAttempts();
  }finally{await browser?.close();if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}}
}
await runAttendanceLabelsReuse(process.argv.slice(2),native=>checkAttendancePin(native,browserCheck));
