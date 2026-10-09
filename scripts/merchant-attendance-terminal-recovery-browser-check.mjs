import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {readFileSync} from 'node:fs';
import {randomBytes,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import path from 'node:path';
import net from 'node:net';
import sharp from 'sharp';
import jsQR from 'jsqr';
import {chromium} from 'playwright';
import {checkPinClock} from './merchant-attendance-pin-clock-native.mjs';
import {runAttendanceLabelsReuse} from './merchant-attendance-choice-labels-reuse-native.mjs';
const require=createRequire(import.meta.url);
const {executePinAdmin}=require('../src/lib/merchantAttendancePin.server.ts');
const {executeTerminalAdmin,executeTerminalDevice}=require('../src/lib/merchantAttendanceTerminal.server.ts');
const {MerchantEnterpriseAccessError}=require('../src/lib/merchantEnterpriseAuth.server.ts');
const {TERMINAL_COOKIE}=require('../src/lib/merchantAttendanceTerminal.ts');
const handlers=Object.fromEntries([
  ['terminal-device','handleTerminalDevice','merchantAttendanceTerminal','executeTerminalDevice'],
  ['terminal-clock','handlePinClock','merchantAttendancePinClock','executePinClock'],
  ['history','handleAttendanceHistory','merchantAttendanceHistory','executeAttendanceHistory'],
  ['records','handleAttendanceRecords','merchantAttendanceManagement','executeAttendanceRecords'],
].map(([route,handler,module,executor])=>[route,[require(`../src/app/api/merchant-enterprise/attendance/${route}/route-handler.ts`)[handler],require(`../src/lib/${module}.server.ts`)[executor]]]));
assert(Object.values(handlers).every(pair=>pair.every(fn=>typeof fn==='function')));
const lit=v=>v==null?'null':"'"+String(v).replaceAll("'","''")+"'",json=v=>v==null?'null':lit(JSON.stringify(v))+'::jsonb';
async function check(env){
  const {root,exec,id,site,owner,location,pass}=env,auth=id(2),worker=id(202),employee=id(102),pin='03918276';
  exec(readFileSync(path.join(root,'scripts/supabase-migrations/202609300068_merchant_attendance_self_history.sql'),'utf8'));
  exec(`insert into public.merchant_enterprise_employees(id,merchant_id,auth_user_id,email,display_name,role_id,status) values('${employee}','${site}','${auth}','recovery@example.test','核对员工','${id(30)}','active');
    insert into public.merchant_attendance_workers(id,merchant_id,employee_id,worker_no,display_name,default_location_id,active) values('${worker}','${site}','${employee}','PIN-02','核对员工','${location}',true);
    insert into public.merchant_attendance_employment_periods(merchant_id,worker_id,starts_on) values('${site}','${worker}','2020-01-01');`);
  const service={rpc:async(name,a)=>{
    if(!['faolla_attendance_terminal_admin_v1','faolla_attendance_self_history_v1','faolla_attendance_records_v1'].includes(name))return env.service.rpc(name,a);
    let args;
    if(name==='faolla_attendance_terminal_admin_v1'){assert.equal(a.p_site,site);assert.equal(a.p_auth,owner);args=[lit(site),lit(owner),json(a.p_query),json(a.p_command),String(a.p_allow_create===true)];}
    else{assert.equal(a.p_site_id,site);assert([auth,owner,id(1)].includes(a.p_auth_user_id));args=[lit(site),lit(a.p_auth_user_id),json(a.p_query)];}
    try{return {data:JSON.parse(exec(`set role service_role;select public.${name}(${args.join(',')});`)),error:null};}
    catch(e){const code=String(e).match(/ERROR:\s+(attendance_[a-z_]+)/)?.[1];if(!code)throw e;return {data:null,error:{message:code}};}
  }};
  await executePinAdmin({siteId:site,authUserId:owner,workerNo:'PIN-02',operationId:null,allowSet:true,command:{action:'set',operationId:randomUUID(),expectedRevision:0,workerId:worker,employeeId:employee,pin,salt:randomBytes(16).toString('hex')}},env.service);
  const admin=(command)=>executeTerminalAdmin({siteId:site,authUserId:owner,terminalId:null,cursor:null,command,allowCreate:true},service);
  const device=async n=>{const pairSecret=randomBytes(32).toString('base64url'),secret=randomBytes(32).toString('base64url'),terminalId=id(n);
    await admin({action:'create',terminalId,locationId:location,label:'合成查询终端 '+n,pairSecret});
    await executeTerminalDevice({siteId:site,terminalId,secret:pairSecret,deviceSecret:secret,allowPair:true},service);return {terminalId,secret};};
  const expiring=await device(71),revoked=await device(72);
  const origin='https://www.faolla.com',local='http://127.0.0.1:3131',requests=[],errors=[],external=[];let browser,child,lose=true,moduleEnabled=true;
  const probe=net.createServer();await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(3131,'127.0.0.1',resolve);});await new Promise(resolve=>probe.close(resolve));
  try{
    child=spawn(process.execPath,['scripts/attendance-self-browser-harness.mjs','--terminal-recovery'],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});
    await new Promise((resolve,reject)=>{let out='';const timer=setTimeout(()=>reject(Error('recovery_harness_timeout')),20000);child.stdout.on('data',v=>{out+=v;if(out.includes('Attendance synthetic component QA')){clearTimeout(timer);resolve();}});child.stderr.on('data',v=>errors.push(String(v)));child.once('exit',code=>{clearTimeout(timer);reject(Error('recovery_harness_exit_'+code));});});
    browser=await chromium.launch({headless:true});
    const newPage=async(label,authUserId=null,terminal=null)=>{
      const ctx=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
      if(terminal)await ctx.addCookies([{name:TERMINAL_COOKIE,value:`${site}.${terminal.terminalId}.${terminal.secret}`,url:origin,httpOnly:true,secure:true,sameSite:'Strict'}]);
      await ctx.route('**/*',async route=>{
        const r=route.request(),url=new URL(r.url());if(url.origin!==origin){external.push(url.origin);return route.abort();}
        if(!url.pathname.startsWith('/api/')){assert(['/','/enterprise','/harness.js','/harness.css'].includes(url.pathname));return route.fulfill({response:await ctx.request.get(local+(url.pathname==='/enterprise'?'/':url.pathname))});}
        try{
          const key=url.pathname.replace('/api/merchant-enterprise/attendance/',''),pair=handlers[key];assert(pair);
          const req=new Request(r.url(),{method:r.method(),headers:await r.allHeaders(),body:r.postData()??undefined});
          const deps={enabled:()=>true,allow:()=>true,authenticate:async()=>{if(!authUserId)throw new MerchantEnterpriseAccessError('unauthorized',401);return {user:{id:authUserId},accessToken:'synthetic',authenticationMethods:['password']};},entitlement:async()=>({permissionConfig:{allowEnterpriseManagement:true,allowEmployeeAttendance:moduleEnabled}})};
          const response=await pair[0](req,{...deps,execute:i=>pair[1](i,service)});
          const b=r.postData()?JSON.parse(r.postData()):null;requests.push({label,key,method:r.method(),command:!!b?.command,status:response.status});
          if(lose&&key==='terminal-clock'&&b?.command&&response.status===200){lose=false;return route.abort('connectionfailed');}
          await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:await response.text()});
        }catch(e){errors.push(String(e));await route.abort();}
      });
      const page=await ctx.newPage();page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(String(e)));return {ctx,page};
    };
    const shared=await newPage('shared',null,expiring),p=shared.page;
    await p.goto(origin);await p.getByRole('status').filter({hasText:'终端已配对'}).waitFor();
    await p.getByLabel('考勤工号',{exact:true}).fill('PIN-02');await p.getByLabel('员工 PIN',{exact:true}).fill(pin);await p.getByRole('button',{name:'验证并读取／核对原操作',exact:true}).click();await p.getByRole('button',{name:'确认上班',exact:true}).click();
    await p.getByRole('status').filter({hasText:'请重新输入本人工号和 PIN'}).waitFor();
    const saved=await p.evaluate(()=>Object.values(sessionStorage)),pending=JSON.parse(saved[0]);assert.equal(saved.length,1);assert(!saved[0].includes(pin));
    const event=JSON.parse(exec(`select jsonb_build_object('id',id,'operation',operation_id,'source',source) from public.merchant_attendance_events where worker_id='${worker}';`));assert.equal(event.operation,pending.command.operationId);assert.equal(event.source,'kiosk');
    const fingerprint=()=>exec("select md5(jsonb_agg(to_jsonb(e) order by worker_id,sequence)::text) from public.merchant_attendance_events e;"),before=fingerprint();
    const openHelp=async page=>{await page.getByText('设备失效或打卡结果不确定？核对记录',{exact:true}).click();return page.getByRole('region',{name:'终端打卡核对指引'});};
    let requestCount=requests.length;const help=await openHelp(p),qr=help.getByRole('img',{name:'企业工作台登录入口二维码，不是打卡码'});await qr.waitFor();
    const src=await qr.getAttribute('src'),{data,info}=await sharp(Buffer.from(src.split(',')[1],'base64')).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    const destination=jsQR(new Uint8ClampedArray(data),info.width,info.height)?.data;assert.equal(destination,origin+'/enterprise');assert.equal(requests.length,requestCount);assert.deepEqual(await p.evaluate(()=>Object.values(sessionStorage)),saved);
    assert.equal(await help.getByRole('link').count(),0);assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await p.evaluate(()=>{Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw Error('synthetic_denial');}}});});
    await help.getByRole('button',{name:'复制企业工作台地址',exact:true}).click();await help.getByText('无法自动复制，请在本人设备手动输入上方地址。',{exact:true}).waitFor();
    assert.equal(requests.length,requestCount);assert.equal(fingerprint(),before);
    pass('lost-response PIN fact is preserved; help opens without API/storage writes; rendered QR decodes to credential-free login, clipboard denial falls back and 390px fits');
    // Expire only this synthetic terminal while retaining its exact lifetime
    // constraints; never disable constraints or alter original punch times.
    exec(`update public.merchant_attendance_terminals set created_at=created_at-interval '744 hours',pair_expires_at=pair_expires_at-interval '744 hours',paired_at=paired_at-interval '744 hours',device_expires_at=device_expires_at-interval '744 hours' where id='${expiring.terminalId}';`);
    await p.getByRole('button',{name:'重新检查设备',exact:true}).click();await p.getByRole('status').filter({hasText:'终端凭证'}).waitFor();assert(await p.getByLabel('员工 PIN',{exact:true}).isDisabled());assert.deepEqual(await p.evaluate(()=>Object.values(sessionStorage)),saved);
    const denied=await p.evaluate(async body=>{const r=await fetch('/api/merchant-enterprise/attendance/terminal-clock',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});return {status:r.status,data:await r.json()};},{workerNo:'PIN-02',pin,command:pending.command,operationId:null});assert.equal(denied.status,403);assert.equal(denied.data.error,'attendance_terminal_denied');assert.equal(fingerprint(),before);
    // Only this isolated synthetic browser context: model loss, not application cleanup.
    await p.evaluate(()=>sessionStorage.clear());await p.reload();await p.getByRole('status').filter({hasText:'终端凭证'}).waitFor();await openHelp(p);assert.equal(await p.getByLabel('员工 PIN',{exact:true}).isDisabled(),true);assert.equal(fingerprint(),before);
    pass('expired terminal remains denied even with original command; pending is not deleted by help; after synthetic storage loss guidance remains available without a punch');
    const phone=await newPage('phone');await phone.page.goto(destination);await phone.page.getByRole('heading',{name:'进入企业工作台',exact:true}).waitFor();assert.equal(await phone.page.getByRole('button',{name:'登录并选择企业',exact:true}).isDisabled(),true);
    assert.equal((await phone.ctx.cookies()).some(c=>c.name===TERMINAL_COOKIE),false);
    const from=new Date(Date.now()-86400000).toISOString().slice(0,10),through=new Date(Date.now()+86400000).toISOString().slice(0,10);
    const historyUrl='/api/merchant-enterprise/attendance/history?'+new URLSearchParams({siteId:site,fromAt:from+'T00:00:00.000000Z',toAt:through+'T23:59:59.999999Z'});
    assert.equal(await phone.page.evaluate(async url=>(await fetch(url)).status,historyUrl),401);await phone.ctx.close();
    pass('phone handoff opens actual existing login screen without terminal Cookie or automatic account; unauthenticated history still returns 401');
    const personal=await newPage('employee',auth);await personal.page.goto(origin+'/?mode=history');const history=personal.page.getByRole('region',{name:'本人历史打卡',exact:true});
    await history.getByLabel('开始日期',{exact:true}).fill(from);await history.getByLabel('结束日期（含当天）',{exact:true}).fill(through);await history.getByRole('button',{name:'查询本人记录',exact:true}).click();
    await history.getByRole('article').filter({hasText:'核对员工'}).waitFor();assert.equal(await history.getByRole('article').count(),1);await history.getByText('原始时间与记录编号',{exact:true}).click();await history.getByText('记录编号：'+event.id,{exact:false}).waitFor();
    moduleEnabled=false;await history.getByRole('button',{name:'重新查询首页',exact:true}).click();await history.getByText('平台暂停新考勤，历史仍按本人当前权限提供。',{exact:true}).waitFor();assert.equal(await history.getByRole('article').count(),1);
    exec(`update public.merchant_enterprise_employees set status='disabled' where id='${employee}';`);await history.getByRole('button',{name:'重新查询首页',exact:true}).click();await history.getByRole('status').filter({hasText:/权限/}).waitFor();assert.equal(await history.getByRole('article').count(),0);
    pass('authorized personal history finds the exact committed kiosk record without a terminal Cookie; platform pause permits reads but employee revocation hides data');
    const manager=await newPage('owner',owner);await manager.page.goto(origin+'/?mode=records');const records=manager.page.getByRole('region',{name:'考勤明细',exact:true});
    await records.getByLabel('开始日期',{exact:true}).fill(from);await records.getByLabel('结束日期（含当天）',{exact:true}).fill(through);await records.getByRole('button',{name:'查询明细',exact:true}).click();
    const own=records.getByRole('article').filter({hasText:'核对员工'});await own.getByText('原始时间与记录编号',{exact:true}).click();await own.getByText('编号：'+event.id,{exact:false}).waitFor();await own.getByRole('button',{name:'仅看此人员',exact:true}).click();assert.equal(await records.getByRole('article').count(),1);assert.equal(fingerprint(),before);
    pass('current owner can still inspect and filter the original record after employee revocation and platform pause; no replacement event or correction is synthesized');
    const replaced=await newPage('revoked',null,revoked);await replaced.page.goto(origin+'/?mode=device');await replaced.page.getByText('合成查询终端 72',{exact:true}).waitFor();
    await admin({action:'revoke',terminalId:revoked.terminalId});await replaced.page.getByRole('button',{name:'检查当前终端状态',exact:true}).click();await replaced.page.getByRole('status').filter({hasText:'终端凭证'}).waitFor();await openHelp(replaced.page);
    assert.equal(await replaced.page.getByRole('heading',{name:'合成查询终端 72',exact:true}).count(),0);await replaced.ctx.clearCookies();await replaced.page.reload();await replaced.page.getByRole('status').filter({hasText:'没有终端凭证'}).waitFor();await openHelp(replaced.page);assert.equal(fingerprint(),before);
    pass('pairing page keeps recovery guidance for revoked and missing-device-Cookie states; reopening help never repairs or re-pairs a device');
    const fallback=await newPage('fallback');requestCount=requests.length;await fallback.page.goto(origin+'/?mode=help&no-link=1');const missing=await openHelp(fallback.page);assert.equal(await missing.getByRole('img').count(),0);assert.equal(await missing.getByRole('button').count(),0);assert.equal(requests.length,requestCount);
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.equal(fingerprint(),before);
    assert.equal(requests.filter(r=>r.command&&r.status===200).length,1);assert(requests.filter(r=>['history','records'].includes(r.key)).every(r=>r.method==='GET'));
    pass('missing safe portal configuration fails closed to manual assistance; all alternative record checks are GET-only, with zero unexpected network access');
    exec(`update public.merchant_enterprise_employees set status='active' where id='${employee}';`);env.reset();
    console.log(JSON.stringify({terminalRecoveryBrowser:true,productionAccess:false,realAuth:false,realTls:false,confirmedSyntheticPunches:1,replayedPunches:0,exportedArtifacts:false}));
  }catch(e){console.error(JSON.stringify({requests,errors}));throw e;}
  finally{await browser?.close();if(child&&child.exitCode===null){const ended=once(child,'exit');child.kill();await ended;}}
}
await runAttendanceLabelsReuse(process.argv.slice(2),native=>checkPinClock(native,check));
