// Actual employee selector/login/workspace and scoped readers. Auth service,
// entitlement and outer bootstrap are synthetic; real attendance SQL is local.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import net from 'node:net';
import {chromium} from 'playwright';
import {runAttendanceLabelsReuse} from './merchant-attendance-choice-labels-reuse-native.mjs';
import {checkEventChannels} from './merchant-attendance-event-channels-native.mjs';
const require=createRequire(import.meta.url);
const {withAttendanceApplicationAuth}=require('./fixtures/attendance-application-auth.ts');
const {createEventChannelsShellTransport}=require('./fixtures/attendance-event-channels-shell-transport.ts');
const {resolveValidatedMerchantEnterpriseAuthContext}=require('../src/lib/merchantEnterpriseAuth.server.ts');
const handlers=Object.fromEntries([
  ['self','handleAttendanceSelf'],['history','handleAttendanceHistory'],['session','handleAttendanceSession'],
  ['corrections/context','handleCorrectionContext'],['corrections','handleAttendanceCorrection'],
  ['records','handleAttendanceRecords'],['scoped-timesheet-context','handleAttendanceScopedContext'],
  ['scoped-timesheet','handleAttendanceScopedTimesheet'],['unified-timesheet','handleUnifiedTimesheet'],['event-channels','handleEventChannels'],
].map(([route,handler])=>[route,require(`../src/app/api/merchant-enterprise/attendance/${route}/route-handler.ts`)[handler]]));
const localFetch=globalThis.fetch;
async function prepare(env){
  const {exec,id,owner,p,pass}=env,secondary={site:'99990002',employee:id(150),worker:id(250),location:id(350),events:[]};
  exec(`begin;insert into public.merchants(id,user_id) values('${secondary.site}','${owner}');
    insert into public.merchant_attendance_settings(merchant_id,time_zone,enabled,web_clock_enabled) values('${secondary.site}','Europe/Madrid',true,true);
    insert into public.merchant_attendance_locations(id,merchant_id,name,time_zone,active) values('${secondary.location}','${secondary.site}','乙企业测试地点','Europe/Madrid',true);
    insert into public.merchant_enterprise_roles(id,merchant_id,name,permissions) values('${id(50)}','${secondary.site}','乙企业本人角色',array['enterprise.view','attendance.self.view','attendance.self.clock']);
    insert into public.merchant_enterprise_employees(id,merchant_id,auth_user_id,email,display_name,role_id,status) values('${secondary.employee}','${secondary.site}','${p.auth}','staff5@example.test','乙企业独立员工','${id(50)}','active');
    insert into public.merchant_attendance_workers(id,merchant_id,employee_id,worker_no,display_name,default_location_id,active) values('${secondary.worker}','${secondary.site}','${secondary.employee}','SECOND-05','乙企业独立员工','${secondary.location}',true);
    insert into public.merchant_attendance_employment_periods(merchant_id,worker_id,starts_on) values('${secondary.site}','${secondary.worker}','2020-01-01');
    grant select on public.merchants,public.merchant_enterprise_roles,public.merchant_enterprise_employees to service_role;commit;`);
  for(const [sequence,action] of ['clock_in','clock_out'].entries()){
    const command={expectedWorkerId:secondary.worker,locationId:secondary.location,action,expectedSequence:sequence,operationId:randomUUID()};
    const result=JSON.parse(exec(`set role service_role;select public.faolla_attendance_self_v1('${secondary.site}','${p.auth}','${JSON.stringify(command)}'::jsonb,null);`));secondary.events.push(result.receipt.id);
  }
  pass('second synthetic tenant has a distinct same-account employee/worker and two facts created by the original SQL writer before read-only baselines');
  return {secondary};
}
async function browserCheck(env){
  const {root,exec,id,owner,p,people,site,secondary,events,pass,fromDate,throughDate}=env;
  const actors=[{id:owner,email:'owner@example.test'},...people.map((person,index)=>({id:person.auth,email:`staff${index+3}@example.test`}))];
  const transport=createEventChannelsShellTransport(exec,actors);
  const origin='https://127.0.0.1:3131',staticOrigin='http://127.0.0.1:3131',canonical='https://www.faolla.com';
  const probe=net.createServer();await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(3131,'127.0.0.1',resolve);});await new Promise(resolve=>probe.close(resolve));
  const child=spawn(process.execPath,['scripts/attendance-self-browser-harness.mjs','--event-channels-shell'],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});
  let browser,page,releaseHeld=null,held=false,holdNext=false;const errors=[],external=[],requests=[],tokens=new Map();
  try{
    await new Promise((resolve,reject)=>{let out='';const timer=setTimeout(()=>reject(Error('event_channels_shell_harness_timeout')),25000);child.stdout.on('data',v=>{out+=v;if(out.includes('Attendance synthetic component QA')){clearTimeout(timer);resolve();}});child.stderr.on('data',v=>errors.push(String(v)));child.once('exit',code=>{clearTimeout(timer);reject(Error('event_channels_shell_harness_exit_'+code));});});
    assert.equal((await localFetch(staticOrigin+'/api/merchant-enterprise/attendance/event-channels',{method:'POST'})).status,403);
    browser=await chromium.launch({headless:true});
    await withAttendanceApplicationAuth(actors,transport.rpc,async auth=>{
      const context=await browser.newContext({viewport:{width:1280,height:1000},serviceWorkers:'block'});
      await context.route('**/*',async route=>{
        const request=route.request(),url=new URL(request.url());if(url.origin!==origin){external.push(url.origin);return route.abort();}
        if(!url.pathname.startsWith('/api/')&&!url.pathname.startsWith('/auth/v1/')){
          assert.equal(request.method(),'GET');assert(['/enterprise','/enterprise/99990001','/enterprise/99990002','/harness.js','/harness.css'].includes(url.pathname));
          const response=await localFetch(staticOrigin+url.pathname);return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});
        }
        try{
          const headers=new Headers(await request.allHeaders()),body=request.postData()??undefined;let response;
          if(url.pathname.startsWith('/auth/v1/'))response=await fetch(new Request('https://attendance-auth.invalid'+url.pathname+url.search,{method:request.method(),headers,body}));
          else{
            assert(headers.get('x-merchant-access-token'),'explicit_employee_token_required');assert.equal(headers.get('cookie'),null);
            if(headers.get('origin')===origin)headers.set('origin',canonical);headers.set('host','www.faolla.com');if(headers.get('referer')?.startsWith(origin))headers.set('referer',canonical+'/');
            const req=new Request(canonical+url.pathname+url.search,{method:request.method(),headers,body});
            const key=url.pathname.replace('/api/merchant-enterprise/attendance/','');
            assert(request.method()==='GET'||key==='event-channels'||url.pathname==='/api/merchant-enterprise/employees/accept','shell_browser_business_writes_forbidden');
            if(handlers[key]){
              // Authentication and execute use the real defaults. Only opening
              // flags, per-process limiter and entitlement are fixture adapters.
              response=await handlers[key](req,{enabled:()=>true,accessEnabled:()=>true,allow:()=>true,entitlement:async()=>({permissionConfig:{allowEnterpriseManagement:true,allowEmployeeAttendance:transport.state.moduleEnabled}})});
              assert.equal(response.headers.get('cache-control'),'private, no-store');
            }else{
              try{const identity=await resolveValidatedMerchantEnterpriseAuthContext(req);tokens.set(identity.user.id,headers.get('x-merchant-access-token'));response=await transport.serveShell(req,identity.user.id);}
              catch(e){if(e.code==='unauthorized')response=Response.json({ok:false,error:'unauthorized'},{status:401});else throw e;}
            }
            requests.push({path:url.pathname,method:request.method(),status:response.status,siteId:url.searchParams.get('siteId')??(body?JSON.parse(body).siteId:null)});
            if(key==='event-channels'&&holdNext&&response.status===200){holdNext=false;held=true;await new Promise(resolve=>{releaseHeld=resolve;});held=false;releaseHeld=null;}
          }
          return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:await response.text()});
        }catch(e){errors.push(url.pathname+': '+String(e));return route.abort();}
      });
      page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(String(e)));page.on('dialog',d=>d.accept());
      const own=()=>page.getByRole('region',{name:'我的考勤',exact:true});
      const channelCount=()=>requests.filter(r=>r.path.endsWith('/event-channels')).length;
      const select=async which=>{await page.locator('article').filter({hasText:`企业编号 ${which}`}).getByRole('button',{name:'进入工作台',exact:true}).click();await page.waitForURL(url=>url.pathname==='/enterprise/'+which);};
      const login=async(person,selector=true)=>{await page.getByLabel('员工邮箱',{exact:true}).fill(actors.find(a=>a.id===person.auth).email);await page.getByLabel('密码',{exact:true}).fill('Synthetic-attendance-only!');await page.getByRole('button',{name:selector?'登录并选择企业':'登录企业工作台',exact:true}).click();if(selector)await select(site);};
      const enter=async()=>{await page.getByRole('button',{name:'我的考勤',exact:true}).click();await own().getByRole('button',{name:'刷新状态',exact:true}).waitFor();};
      const nav=async name=>{
        if(!await page.getByRole('button',{name,exact:true}).isVisible())await page.getByRole('button',{name:'打开员工工作区导航',exact:true}).click();
        const logout=name==='退出员工登录'?page.waitForResponse(r=>new URL(r.url()).pathname==='/auth/v1/logout'&&r.status()===204):null;
        await page.getByRole('button',{name,exact:true}).click();
        if(logout){
          await logout;
          // The portal hides private content optimistically. Do not unload its
          // page before the SDK has finished removing the persisted session.
          await page.waitForFunction(()=>![...Object.keys(sessionStorage),...Object.keys(localStorage)].some(key=>key.endsWith('-enterprise-auth-token')));
          await page.getByRole('button',{name:'登录企业工作台',exact:true}).waitFor();
        }
      };
      const history=async(expected)=>{
        await own().getByRole('button',{name:'查看本人历史打卡',exact:true}).click();const result=page.getByRole('region',{name:'本人历史打卡',exact:true});
        await result.getByLabel('开始日期',{exact:true}).fill(fromDate);await result.getByLabel('结束日期（含当天）',{exact:true}).fill(throughDate);await result.getByRole('button',{name:'查询本人记录',exact:true}).click();
        await result.getByRole('button',{name:`核对详细打卡通路（${expected} 条）`,exact:true}).waitFor();return result;
      };
      const channels=async(parent,n)=>{const before=channelCount();await parent.getByRole('button',{name:`核对详细打卡通路（${n} 条）`,exact:true}).click();const result=parent.getByRole('region',{name:'详细打卡通路',exact:true});await result.getByRole('button',{name:`读取本批通路（${n} 条）`,exact:true}).waitFor();assert.equal(channelCount(),before);await result.getByRole('button',{name:`读取本批通路（${n} 条）`,exact:true}).click();await result.getByRole('status').filter({hasText:'本批原始打卡通路已核对'}).waitFor();assert.equal(channelCount(),before+1);assert.equal(await result.locator('li').count(),n);return result;};
      const report=()=>page.getByRole('region',{name:'受限周期工时核对',exact:true});
      const queryReport=async()=>{await report().getByLabel('开始日期',{exact:true}).fill(fromDate);await report().getByLabel('结束日期（含）',{exact:true}).fill(throughDate);await report().getByRole('button',{name:'查询可见工时',exact:true}).click();await report().getByRole('article',{name:'可见工时查询结果',exact:true}).waitFor();};
      await page.goto(origin+'/enterprise');assert.equal(requests.length,0);await login(p);await enter();
      let h=await history(8),detail=await channels(h,8);assert.equal(await detail.locator('li').filter({hasText:'现场动态码 · 手机提交'}).count(),2);
      pass('real selector/password SDK/portal/workspace/manager opens same-database history and QR provenance; IDs are employee IDs, not authentication IDs');
      await detail.getByRole('button',{name:'关闭通路核对',exact:true}).click();await h.getByRole('button',{name:'核对本班次工作／休息',exact:true}).first().click();
      const session=h.getByRole('region',{name:'本人班次核对',exact:true});detail=await channels(session,4);assert.equal(await detail.locator('li').filter({hasText:'现场动态码 · 手机提交'}).count(),2);
      pass('full enterprise history opens the actual session panel and its four-action mixed-source batch with unchanged work/rest totals');
      await nav('切换企业');await select(secondary.site);assert.equal(await page.getByRole('region',{name:'详细打卡通路',exact:true}).count(),0);await enter();h=await history(2);detail=await channels(h,2);
      assert.equal(await detail.locator('li').filter({hasText:'现场动态码 · 手机提交'}).count(),0);for(const oldId of events)assert(!(await page.locator('body').innerText()).includes(oldId));
      const crossStatus=await page.evaluate(async q=>(await fetch('/api/merchant-enterprise/attendance/event-channels',{method:'POST',headers:{'content-type':'application/json','x-merchant-access-token':q.token},body:JSON.stringify(q.query)})).status,{token:tokens.get(p.auth),query:{siteId:secondary.site,access:'self',workerId:p.worker,locationId:null,eventIds:[events[0]]}});assert.equal(crossStatus,403);
      pass('same login switching to second real tenant shows only its own worker and facts; foreign first-tenant event IDs are denied by current SQL authorization');
      await nav('切换企业');await select(site);await enter();assert.equal(await page.getByRole('region',{name:'详细打卡通路',exact:true}).count(),0);
      await own().getByRole('button',{name:'我的补正申请／核对结果',exact:true}).click();const correction=page.getByRole('region',{name:'本人考勤补正申请',exact:true});await correction.getByRole('button',{name:'选择原始班次',exact:true}).click();
      const picker=correction.getByRole('region',{name:'本人历史打卡',exact:true});await picker.getByRole('button',{name:'查询本人记录',exact:true}).click();await picker.getByRole('button',{name:'选择本班次申请补正',exact:true}).first().click();detail=await channels(correction,4);
      assert.equal(await detail.locator('li').filter({hasText:'现场动态码 · 手机提交'}).count(),2);await correction.getByRole('button',{name:'返回我的考勤',exact:true}).click();
      await own().getByRole('button',{name:'我的周期工时核对',exact:true}).click();await queryReport();detail=await channels(report(),8);assert.equal(await detail.locator('li').filter({hasText:'现场动态码 · 手机提交'}).count(),2);
      await report().getByRole('button',{name:'含整段漏卡的工时核对',exact:true}).click();const unified=report().getByRole('region',{name:'含整段漏卡工时工作区',exact:true});await unified.getByRole('button',{name:'查询含整段漏卡工时',exact:true}).click();await channels(unified,8);
      pass('real employee navigation reaches correction, scoped self report and unified report; all read the identical QR/web/PIN facts without posting a correction or export');
      // A captured, authorized response is delivered only after actual logout.
      await page.reload();await enter();h=await history(8);await h.getByRole('button',{name:'核对详细打卡通路（8 条）',exact:true}).click();detail=h.getByRole('region',{name:'详细打卡通路',exact:true});
      holdNext=true;await detail.getByRole('button',{name:'读取本批通路（8 条）',exact:true}).click();for(let n=0;n<60&&!held;n++)await new Promise(resolve=>setTimeout(resolve,25));assert(held);
      await nav('退出员工登录');await page.getByRole('button',{name:'登录企业工作台',exact:true}).waitFor();releaseHeld();await login(people[0],false);await enter();h=await history(4);detail=await channels(h,4);
      assert.equal(await detail.locator('li').filter({hasText:'现场动态码 · 手机提交'}).count(),0);for(const oldId of events)assert(!(await page.locator('body').innerText()).includes(oldId));
      pass('real logout clears an in-flight source result; subsequent login as another employee cannot display the first employee late response or IDs');
      await nav('退出员工登录');await page.goto(origin+'/enterprise');await login(people[1]);
      exec(`update public.merchant_attendance_scope_grants set valid_until=null where id='${id(710)}';`);
      await page.getByRole('button',{name:'考勤明细',exact:true}).click();const records=page.getByRole('region',{name:'考勤明细',exact:true});await records.getByRole('button',{name:'授权范围工时核对',exact:true}).click();
      const pair=report().getByRole('button').filter({hasText:p.no}).filter({hasText:'合成前台'});await pair.first().click();await queryReport();detail=await channels(report(),8);
      assert.equal(await detail.locator('li').filter({hasText:'现场动态码 · 手机提交'}).count(),2);
      // Parent report and nested channel request both revalidate active grants.
      exec(`update public.merchant_attendance_scope_grants set valid_until=clock_timestamp()-interval '1 second' where id='${id(710)}';`);
      await detail.getByRole('button',{name:'读取本批通路（8 条）',exact:true}).click();await detail.getByRole('status').filter({hasText:'当前权限不能查看本批'}).waitFor();assert.equal(await detail.locator('li').count(),0);
      await report().getByRole('button',{name:'重新读取当前权限与范围',exact:true}).click();await report().getByText('没有匹配且当前获授权的人员与地点组合。',{exact:true}).waitFor();assert.equal(await report().getByRole('article',{name:'可见工时查询结果',exact:true}).count(),0);
      pass('actual manager menu selects an explicit same-grant worker/location pair; expiry denies the next source query and removes report/pair on current-scope refresh');
      exec(`update public.merchant_attendance_scope_grants set valid_until=null where id='${id(710)}';`);
      await report().getByRole('button',{name:'重新读取当前权限与范围',exact:true}).click();await pair.first().click();await queryReport();detail=await channels(report(),8);
      const managerToken=tokens.get(people[1].auth);
      exec(`update public.merchant_enterprise_roles set permissions=array['enterprise.view'],version=version+1 where id='${id(31)}';`);
      try{await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.getByRole('button',{name:'考勤明细',exact:true}).waitFor({state:'detached'});assert.equal(await page.getByRole('region',{name:'详细打卡通路',exact:true}).count(),0);assert.equal(tokens.get(people[1].auth),managerToken);}
      finally{exec(`update public.merchant_enterprise_roles set permissions=array['enterprise.view','attendance.records.view'],version=version+1 where id='${id(31)}';`);}
      pass('active manager role loses records permission without logging out or changing token; current capabilities remount the enterprise shell and clear descendant source results');
      await page.reload();await page.getByRole('button',{name:'考勤明细',exact:true}).click();await page.getByRole('region',{name:'考勤明细',exact:true}).getByRole('button',{name:'授权范围工时核对',exact:true}).click();await pair.first().click();await queryReport();detail=await channels(report(),8);
      exec(`update public.merchant_enterprise_employees set status='disabled' where id='${people[1].employee}';`);
      try{await page.getByRole('button',{name:'刷新数据',exact:true}).click();await page.getByText('当前账号已无权访问企业管理，请联系负责人或重新登录。',{exact:true}).waitFor();assert.equal(await page.getByRole('region',{name:'详细打卡通路',exact:true}).count(),0);for(const oldId of events)assert(!(await page.locator('body').innerText()).includes(oldId));}
      finally{exec(`update public.merchant_enterprise_employees set status='active' where id='${people[1].employee}';`);}
      pass('outer enterprise overview403 from current disabled SQL membership unmounts report and provenance rather than leaving old private details visible');
      await page.setViewportSize({width:390,height:844});await page.goto(origin+'/enterprise');await select(site);await page.getByRole('button',{name:'考勤明细',exact:true}).click();await page.getByRole('region',{name:'考勤明细',exact:true}).getByRole('button',{name:'授权范围工时核对',exact:true}).click();await pair.first().click();await queryReport();detail=await channels(report(),8);
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      const beforeTokens=transport.calls.length;for(const token of tokens.values())auth.revoke(token);await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
      await page.getByText('登录状态或角色权限已变化，请重新核验。',{exact:true}).waitFor();assert.equal(await page.getByRole('region',{name:'详细打卡通路',exact:true}).count(),0);assert.equal(transport.calls.length,beforeTokens);
      const persisted=await page.evaluate(()=>[...Object.values(localStorage),...Object.values(sessionStorage)].join('\n'));for(const eventId of [...events,...secondary.events])assert(!persisted.includes(eventId));
      assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.deepEqual(transport.errors,[]);assert(requests.every(r=>[200,401,403].includes(r.status)));
      pass('390px actual manager shell has no horizontal overflow; revoked signed auth removes the workspace before a new attendance RPC, with no event details in persistent storage');
      console.log(JSON.stringify({eventChannelsEnterpriseShell:true,productionAccess:false,realAuthService:false,realNextRuntime:false,tenants:2,channelRequests:channelCount(),businessWrites:0,persistentArtifacts:false}));
      await context.close();
    });
  }catch(e){if(page&&!page.isClosed())console.error(JSON.stringify({statuses:await page.getByRole('status').allTextContents(),requests:requests.slice(-15),errors}));throw e;}
  finally{releaseHeld?.();await browser?.close();if(child.exitCode===null){const ended=once(child,'exit');child.kill();await ended;}}
}
await runAttendanceLabelsReuse(process.argv.slice(2),native=>checkEventChannels(native,browserCheck,prepare));
