import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createRequire} from 'node:module';
import {randomBytes,randomUUID} from 'node:crypto';
import net from 'node:net';
import {chromium} from 'playwright';
import {runAttendanceLabelsReuse} from './merchant-attendance-choice-labels-reuse-native.mjs';
import {checkPinClock} from './merchant-attendance-pin-clock-native.mjs';
const require=createRequire(import.meta.url);
const {handlePinClock}=require('../src/app/api/merchant-enterprise/attendance/terminal-clock/route-handler.ts');
const {executePinClock}=require('../src/lib/merchantAttendancePinClock.server.ts');
const {handleTerminalDevice}=require('../src/app/api/merchant-enterprise/attendance/terminal-device/route-handler.ts');
const {executeTerminalDevice}=require('../src/lib/merchantAttendanceTerminal.server.ts');
const {executePinAdmin}=require('../src/lib/merchantAttendancePin.server.ts');
const {TERMINAL_COOKIE}=require('../src/lib/merchantAttendanceTerminal.ts');
async function browserCheck(env){
  const {root,exec,pass,site,owner,id,terminalId,location,secret,pin,service,reset}=env,secondPin='85649271';
  exec(`insert into public.merchant_enterprise_employees(id,merchant_id,auth_user_id,email,display_name,role_id,status) values('${id(102)}','${site}','${id(2)}','other@example.test','第二位员工','${id(30)}','active');
    insert into public.merchant_attendance_workers(id,merchant_id,employee_id,worker_no,display_name,default_location_id,active) values('${id(202)}','${site}','${id(102)}','PIN-02','第二位员工','${location}',true);
    insert into public.merchant_attendance_employment_periods(id,merchant_id,worker_id,starts_on) values('${id(402)}','${site}','${id(202)}','2020-01-01');`);
  await executePinAdmin({siteId:site,authUserId:owner,workerNo:'PIN-02',operationId:null,allowSet:true,command:{action:'set',operationId:randomUUID(),expectedRevision:0,workerId:id(202),employeeId:id(102),pin:secondPin,salt:randomBytes(16).toString('hex')}},service);
  const origin='https://attendance.synthetic.test',local='http://127.0.0.1:3131',canonical='https://www.faolla.com';
  const probe=net.createServer();await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(3131,'127.0.0.1',resolve);});await new Promise(resolve=>probe.close(resolve));
  const child=spawn(process.execPath,['scripts/attendance-self-browser-harness.mjs','--pin-clock'],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});
  const errors=[],external=[],requests=[];let browser,loseFirst=true,page;
  try{
    await new Promise((resolve,reject)=>{let out='';const timer=setTimeout(()=>reject(Error('pin_clock_harness_timeout')),20000);child.stdout.on('data',v=>{out+=v;if(out.includes('Attendance synthetic component QA')){clearTimeout(timer);resolve();}});child.stderr.on('data',v=>errors.push(String(v)));child.once('exit',code=>{clearTimeout(timer);reject(Error('pin_clock_harness_exit_'+code));});});
    browser=await chromium.launch({headless:true});const ctx=await browser.newContext({viewport:{width:1100,height:1000},serviceWorkers:'block'});
    await ctx.addCookies([{name:TERMINAL_COOKIE,value:`${site}.${terminalId}.${secret}`,url:origin,httpOnly:true,secure:true,sameSite:'Strict'}]);
    await ctx.route('**/*',async route=>{
      const r=route.request(),url=new URL(r.url());if(url.origin!==origin){external.push(url.origin);return route.abort();}
      if(!url.pathname.startsWith('/api/')){if(!['/','/harness.js','/harness.css','/enterprise/attendance-terminal/clock'].includes(url.pathname))return route.abort();return route.fulfill({response:await ctx.request.get(local+(url.pathname.endsWith('/clock')?'/':url.pathname))});}
      try{
        const headers=new Headers(await r.allHeaders());if(headers.get('origin')===origin)headers.set('origin',canonical);headers.set('host','www.faolla.com');if(headers.get('referer')?.startsWith(origin))headers.set('referer',canonical+'/');
        const req=new Request(canonical+url.pathname+url.search,{method:r.method(),headers,body:r.postData()??undefined});
        const deps={enabled:()=>true,allow:()=>true,entitlement:async()=>({permissionConfig:{allowEnterpriseManagement:true,allowEmployeeAttendance:true}})};
        let response;
        if(url.pathname.endsWith('/terminal-device'))response=await handleTerminalDevice(req,{...deps,execute:i=>executeTerminalDevice(i,service)});
        else{assert.equal(url.pathname,'/api/merchant-enterprise/attendance/terminal-clock');response=await handlePinClock(req,{...deps,execute:i=>executePinClock(i,service)});}
        const body=r.postData()?JSON.parse(r.postData()):null;requests.push({path:url.pathname,command:!!body?.command,status:response.status});
        if(loseFirst&&body?.command&&response.status===200){loseFirst=false;return route.abort('connectionfailed');}
        return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:await response.text()});
      }catch(e){errors.push(String(e));return route.abort();}
    });
    page=await ctx.newPage();page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(String(e)));await page.goto(origin);
    await page.getByRole('link',{name:'进入门店 PIN 打卡',exact:true}).click();await page.getByRole('heading',{name:'门店 PIN 打卡',exact:true}).waitFor();
    const read=async(no,p)=>{await page.getByLabel('考勤工号',{exact:true}).fill(no);await page.getByLabel('员工 PIN',{exact:true}).fill(p);await page.getByRole('button',{name:'验证并读取／核对原操作',exact:true}).click();};
    await page.getByRole('status').filter({hasText:'终端已配对'}).waitFor();await read('PIN-01',pin);await page.getByRole('button',{name:'确认上班',exact:true}).click();
    await page.getByRole('status').filter({hasText:'请重新输入本人工号和 PIN'}).waitFor();
    assert.equal(await page.getByLabel('员工 PIN',{exact:true}).inputValue(),'');
    let stored=await page.evaluate(()=>Object.values(sessionStorage));assert.equal(stored.length,1);assert(!stored[0].includes(pin));assert(!stored[0].includes('secret'));assert(!stored[0].includes('workerName'));
    await page.reload();await page.getByRole('status').filter({hasText:'终端已配对'}).waitFor();assert.equal(requests.filter(r=>r.command).length,1);
    pass('actual terminal writes kiosk clock-in then loses response; reload stores only scoped non-secret intent and does not auto-submit');
    await read('PIN-02',secondPin);await page.getByRole('heading',{name:'第二位员工 · PIN-02',exact:true}).waitFor();await page.getByRole('button',{name:'确认上班',exact:true}).click();
    await page.getByRole('status').filter({hasText:'打卡已确认：上班'}).waitFor();assert.equal(await page.evaluate(()=>sessionStorage.length),1);
    await page.getByRole('button',{name:'清除资料／下一位'}).click();await read('PIN-01',secondPin);await page.getByRole('status').filter({hasText:'工号或 PIN 不可用'}).waitFor();
    assert.equal(await page.getByRole('region',{name:'当前员工打卡状态'}).count(),0);assert.equal(await page.evaluate(()=>sessionStorage.length),1);
    await read('PIN-01',pin);await page.getByRole('status').filter({hasText:'原打卡已确认，未重复提交'}).waitFor();assert.equal(requests.filter(r=>r.command).length,2);assert.equal(await page.evaluate(()=>sessionStorage.length),0);
    assert.equal(exec(`select count(*) from public.merchant_attendance_events where worker_id='${id(201)}' and sequence=9;`),'1');
    pass('another employee clocks while first is pending; wrong PIN reveals no result; original employee recovers exact receipt without duplicate POST');
    await page.clock.install();await page.getByRole('button',{name:'确认下班',exact:true}).click();await page.getByRole('status').filter({hasText:'打卡已确认：下班'}).waitFor();
    assert.equal(await page.getByRole('button',{name:'确认下班',exact:true}).count(),0);await page.clock.fastForward(15010);assert.equal(await page.getByRole('region',{name:'当前员工打卡状态'}).count(),0);
    reset();await read('PIN-01',pin);await page.getByRole('button',{name:'确认上班',exact:true}).waitFor();const before=requests.length;await page.clock.fastForward(30010);
    assert.equal(await page.getByRole('button',{name:'确认上班',exact:true}).count(),0);assert.equal(requests.length,before);
    await page.getByLabel('员工 PIN',{exact:true}).fill(pin);await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});assert.equal(await page.getByLabel('员工 PIN',{exact:true}).inputValue(),'');
    await page.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));});
    await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.equal(await page.evaluate(()=>localStorage.length),0);
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
    pass('explicit clock-out confirms server receipt; PIN eligibility expires in 30s, success hides in 15s, hidden input clears and 390px layout fits');reset();
  }catch(e){if(page)console.error(JSON.stringify({status:await page.getByRole('status').textContent(),requests,errors}));throw e;}
  finally{await browser?.close();if(child.exitCode===null){const stopped=once(child,'exit');child.kill();await stopped;}}
}
await runAttendanceLabelsReuse(process.argv.slice(2),native=>checkPinClock(native,browserCheck));
