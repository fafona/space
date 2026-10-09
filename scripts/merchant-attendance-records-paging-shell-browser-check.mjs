// Local synthetic bulk-history fixtures -> actual employee enterprise shell ->
// actual handlers/default executors/service-role SQL. Not real punch creation,
// Auth service, Next middleware, physical devices, production or a load test.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {createRequire} from 'node:module';
import {chromium} from 'playwright';
import {runAttendanceLabelsReuse} from './merchant-attendance-choice-labels-reuse-native.mjs';
import {withAttendanceConcurrencySandbox} from './merchant-attendance-concurrency-sandbox.mjs';
import {runAttendanceCleanupSteps} from './fixtures/attendance-cleanup.mjs';
import {prepareAttendanceRecordsPagingData} from './fixtures/attendance-records-paging-data.mjs';
const require=createRequire(import.meta.url);
const {withAttendanceApplicationAuth}=require('./fixtures/attendance-application-auth.ts');
const {createEventChannelsShellTransport}=require('./fixtures/attendance-event-channels-shell-transport.ts');
const {resolveValidatedMerchantEnterpriseAuthContext}=require('../src/lib/merchantEnterpriseAuth.server.ts');
const {handleAttendanceRecords}=require('../src/app/api/merchant-enterprise/attendance/records/route-handler.ts');
const {handleAttendanceScopedContext}=require('../src/app/api/merchant-enterprise/attendance/scoped-timesheet-context/route-handler.ts');
const selfHistoryMode=process.argv.includes('--self-history');
const handlers=selfHistoryMode?{
  self:require('../src/app/api/merchant-enterprise/attendance/self/route-handler.ts').handleAttendanceSelf,
  history:require('../src/app/api/merchant-enterprise/attendance/history/route-handler.ts').handleAttendanceHistory,
  session:require('../src/app/api/merchant-enterprise/attendance/session/route-handler.ts').handleAttendanceSession,
}:{records:handleAttendanceRecords,'scoped-timesheet-context':handleAttendanceScopedContext};
const localFetch=globalThis.fetch,origin='https://127.0.0.1:3131',staticOrigin='http://127.0.0.1:3131',canonical='https://www.faolla.com';
async function bounded(promise,label,ms=15000){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(label)),ms);})]);}finally{clearTimeout(timer);}}
async function check(native){
  const {root,query,pass}=native;
  await withAttendanceConcurrencySandbox(native,async({sql})=>{
    const exec=source=>query(sql(source));
    exec(readFileSync(path.join(root,'scripts/supabase-migrations',selfHistoryMode?'202609300068_merchant_attendance_self_history.sql':'202610010089_merchant_attendance_scoped_report_context.sql'),'utf8'));
    // The candidate reader tightens identity without changing response fields.
    // Apply after the legacy definitions, never overwrite it with 068/070.
    exec(readFileSync(path.join(root,'scripts/supabase-migrations/202610020110_merchant_attendance_self_history_identity.sql'),'utf8'));
    const prepare=selfHistoryMode?(await import('./fixtures/attendance-self-history-paging-data.mjs')).prepareAttendanceSelfHistoryPagingData:prepareAttendanceRecordsPagingData;
    const data=prepare({exec}),transport=createEventChannelsShellTransport(exec,data.actors);
    transport.state.moduleEnabled=false;
    const probe=net.createServer();await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(3131,'127.0.0.1',resolve);});await new Promise(resolve=>probe.close(resolve));
    const child=spawn(process.execPath,['scripts/attendance-self-browser-harness.mjs','--event-channels-shell'],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});
    let browser,closing=false;const errors=[],external=[],requests=[],pending=new Set();
    try {
      await bounded(new Promise((resolve,reject)=>{
        let out='';child.stdout.on('data',v=>{out+=String(v);if(out.includes('Attendance synthetic component QA'))resolve();});
        child.stderr.on('data',v=>errors.push(String(v)));child.once('error',reject);child.once('exit',code=>reject(Error('paging_shell_harness_exit_'+code)));
      }),'paging_shell_harness_timeout',25000);
      assert.equal((await localFetch(staticOrigin+'/api/merchant-enterprise/attendance/records',{method:'POST'})).status,403);
      browser=await chromium.launch({headless:true});
      await withAttendanceApplicationAuth(data.actors,transport.rpc,async()=>{
        try {
          const newPage=async mobile=>{
            const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1280,height:960},isMobile:mobile,hasTouch:mobile,serviceWorkers:'block',acceptDownloads:false});
            await context.addInitScript(()=>localStorage.setItem('merchant-space:locale:v1','zh-CN'));
            await context.route('**/*',route=>{
              if(closing)return route.abort().catch(()=>{});
              const work=(async()=>{
                const request=route.request(),url=new URL(request.url());
                if(url.origin!==origin){external.push(url.origin+url.pathname);return route.abort();}
                if(!url.pathname.startsWith('/api/')&&!url.pathname.startsWith('/auth/v1/')){
                  assert.equal(request.method(),'GET');assert(['/enterprise','/enterprise/99990001','/harness.js','/harness.css'].includes(url.pathname));
                  const response=await localFetch(staticOrigin+url.pathname);
                  return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});
                }
                const headers=new Headers(await request.allHeaders()),body=request.postData()??undefined;let response;
                if(url.pathname.startsWith('/auth/v1/'))response=await fetch(new Request('https://attendance-auth.invalid'+url.pathname+url.search,{method:request.method(),headers,body}));
                else {
                  assert(headers.get('x-merchant-access-token'));assert.equal(headers.get('cookie'),null);
                  assert(request.method()==='GET'||url.pathname==='/api/merchant-enterprise/employees/accept','paging_shell_browser_business_writes_forbidden');
                  if(headers.get('origin')===origin)headers.set('origin',canonical);headers.set('host','www.faolla.com');
                  if(headers.get('referer')?.startsWith(origin+'/'))headers.set('referer',canonical+'/');
                  const req=new Request(canonical+url.pathname+url.search,{method:request.method(),headers,body});
                  if(url.pathname.startsWith('/api/merchant-enterprise/attendance/')){
                    const handler=handlers[url.pathname.slice('/api/merchant-enterprise/attendance/'.length)];assert(handler,'paging_shell_unexpected_attendance_endpoint');
                    // Real authenticate/execute/limiter; only feature admission
                    // and this synthetic tenant's entitlement are adapted.
                    response=await handler(req,{enabled:()=>true,...(handler===handleAttendanceScopedContext?{accessEnabled:access=>access==='manager'}:{}),entitlement:async site=>{
                      assert.equal(site,data.site);return {permissionConfig:{allowEnterpriseManagement:true,allowEmployeeAttendance:transport.state.moduleEnabled}};
                    }});
                    assert.equal(response.headers.get('cache-control'),'private, no-store');
                  }else{
                    const identity=await resolveValidatedMerchantEnterpriseAuthContext(req);response=await transport.serveShell(req,identity.user.id);
                  }
                  requests.push({path:url.pathname,method:request.method(),status:response.status,query:Object.fromEntries(url.searchParams)});
                }
                await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:await response.text()});
              })();
              pending.add(work);void work.finally(()=>pending.delete(work)).catch(()=>{});
              return work.catch(async error=>{if(!route.request().failure())errors.push(error.message);await route.abort().catch(()=>{});});
            });
            const page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',dialog=>dialog.accept());return page;
          };
          const endpoint=name=>'/api/merchant-enterprise/attendance/'+name;
          const count=name=>requests.filter(r=>r.path===endpoint(name)).length;
          const read=(page,name,status=200)=>{
            const promise=page.waitForResponse(r=>new URL(r.url()).pathname===endpoint(name)&&r.request().method()==='GET')
              .then(async response=>{assert.equal(response.status(),status,name+'_unexpected_status');const body=await response.json();assert.equal(body.ok,status===200);return body;});
            void promise.catch(()=>{});return promise;
          };
          const click=async(page,name,button,status=200)=>{const done=read(page,name,status);await button.click();return done;};
          if(selfHistoryMode){
            const {checkAttendanceSelfHistoryPagingShell}=await import('./merchant-attendance-self-history-paging-shell-checks.mjs');
            await checkAttendanceSelfHistoryPagingShell({newPage,read,click,count,requests,data,pass,origin});
            assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.deepEqual(transport.errors,[]);return;
          }
          const records=page=>page.getByRole('region',{name:'考勤明细',exact:true});
          const scoped=page=>page.getByRole('region',{name:'受限周期工时核对',exact:true});
          const pairs=page=>scoped(page).locator('button[aria-pressed]');
          const verifyPairs=async(page,items)=>{
            if(items.length)await pairs(page).filter({hasText:items.at(-1).workerNo}).waitFor();
            assert.equal(await pairs(page).count(),items.length);
            for(const [index,item] of items.entries()){
              const text=await pairs(page).nth(index).innerText();
              for(const label of [item.workerName,item.workerNo,item.locationName])assert(text.includes(label));
              assert.equal(await pairs(page).nth(index).getAttribute('aria-pressed'),'false');
            }
          };
          const login=async page=>{
            await page.goto(origin+'/enterprise');await page.getByLabel('员工邮箱',{exact:true}).fill(data.actors.find(a=>a.id===data.managerAuth).email);
            await page.getByLabel('密码',{exact:true}).fill('Synthetic-attendance-only!');await page.getByRole('button',{name:'登录并选择企业',exact:true}).click();
            await page.locator('article').filter({hasText:'企业编号 '+data.site}).getByRole('button',{name:'进入工作台',exact:true}).click();
            await page.waitForURL(url=>url.pathname==='/enterprise/'+data.site);
            await page.getByRole('navigation',{name:'企业管理功能',exact:true}).getByRole('button',{name:'考勤明细',exact:true}).click();
            await records(page).getByLabel('开始日期',{exact:true}).fill(data.date);await records(page).getByLabel('结束日期（含当天）',{exact:true}).fill(data.date);
          };
          const verifyRows=async(page,result,ids)=>{
            assert.deepEqual(result.items.map(r=>r.id),ids);assert.equal(result.access,'manager');assert.equal(result.siteId,data.site);assert.equal(result.moduleEnabled,false);
            await records(page).getByRole('status').filter({hasText:ids.length?`本页 ${ids.length} 条原始打卡事实`:'当前条件及授权范围内没有记录。'}).waitFor();
            await page.waitForFunction(expected=>{
              const section=document.querySelector('section[aria-label="考勤明细"]');
              if(!section)return false;
              const rows=[...section.querySelectorAll('article')];
              return rows.length===expected.length&&rows.every((row,index)=>row.textContent.includes(expected[index]));
            },ids,{timeout:5000});
            assert.equal(await records(page).locator('article').count(),ids.length);
            const dom=await records(page).textContent();for(const id of ids)assert(dom.includes(id));for(const id of data.forbiddenIds)assert(!dom.includes(id));
            for(const row of result.items)assert(row.workerId===data.workers[0]&&row.locationId===data.locations[0]||row.workerId===data.workers[27]&&row.locationId===data.locations[1]);
            data.assertFactsUnchanged();
          };
          const home=async page=>click(page,'records',records(page).getByRole('button',{name:'查询明细',exact:true}));
          const next=async page=>click(page,'records',records(page).getByRole('button',{name:'下一页',exact:true}));
          const desktop=await newPage(false);await login(desktop);
          assert.equal(count('records'),0);assert.equal(count('scoped-timesheet-context'),0);assert.equal(await records(desktop).locator('article').count(),0);
          assert(await records(desktop).getByRole('button',{name:'下一页',exact:true}).isDisabled());
          pass('actual SDK enterprise login enters manager records while paused without automatic history, pair query, selection or business mutation');

          const pages=[await home(desktop)];await verifyRows(desktop,pages[0],data.allowedIds.slice(0,50));
          for(const [start,end] of [[50,100],[100,104]]){const r=await next(desktop);pages.push(r);await verifyRows(desktop,r,data.allowedIds.slice(start,end));}
          assert.equal(new Set(pages.flatMap(r=>r.items.map(i=>i.id))).size,104);assert.equal(pages[1].asOf,pages[0].asOf);assert.equal(pages[2].asOf,pages[0].asOf);
          for(let n=1;n<3;n++){
            assert.equal(pages[n-1].items.at(-1).occurredAt,pages[n].items[0].occurredAt,'equal_timestamp_must_cross_each_page_boundary');
            assert(pages[n-1].items.at(-1).id>pages[n].items[0].id,'UUID_tie_break_must_descend_across_pages');
          }
          assert.equal(pages[2].nextCursor,null);assert(await records(desktop).getByRole('button',{name:'下一页',exact:true}).isDisabled());
          const continued=requests.filter(r=>r.path===endpoint('records'));
          for(let n=1;n<3;n++){assert.equal(continued[n].query.cursorAt,pages[n-1].nextCursor.occurredAt);assert.equal(continued[n].query.cursorId,pages[n-1].nextCursor.id);}
          pass('actual manager history pages 50/50/4 exact authorized IDs with stable asOf and microsecond/UUID cursor; duplicate grant adds no facts and cross-grant/hidden/foreign rows never enter current-page DOM');

          const all=pages.flatMap(r=>r.items);await home(desktop);
          const first=all[0],workerIds=all.filter(r=>r.workerId===first.workerId).map(r=>r.id);
          let filtered=await click(desktop,'records',records(desktop).getByRole('button',{name:'仅看此人员',exact:true}).first());await verifyRows(desktop,filtered,workerIds.slice(0,50));
          filtered=await next(desktop);await verifyRows(desktop,filtered,workerIds.slice(50));
          await records(desktop).locator('article').first().getByText('原始时间与记录编号',{exact:true}).click();
          assert((await records(desktop).locator('article').first().innerText()).includes(filtered.items[0].occurredAt));
          await click(desktop,'records',records(desktop).getByRole('button',{name:/^人员：/}));
          const locationIds=all.filter(r=>r.locationId===first.locationId).map(r=>r.id);
          filtered=await click(desktop,'records',records(desktop).getByRole('button',{name:'仅看此地点',exact:true}).first());await verifyRows(desktop,filtered,locationIds.slice(0,50));
          filtered=await next(desktop);await verifyRows(desktop,filtered,locationIds.slice(50));
          await click(desktop,'records',records(desktop).getByRole('button',{name:/^地点：/}));
          pass('actual row person/location filters reset pagination and each return52 exact authorized facts; expanded raw-detail preserves six-digit UTC and UUID without fetching a whole history');

          const firstContext=await click(desktop,'scoped-timesheet-context',records(desktop).getByRole('button',{name:'授权范围工时核对',exact:true}));
          assert.equal(firstContext.items.length,25);assert.equal(firstContext.scopeRevision,3);await pairs(desktop).nth(24).waitFor();assert.equal(await pairs(desktop).count(),25);
          await verifyPairs(desktop,firstContext.items);
          const secondContext=await click(desktop,'scoped-timesheet-context',scoped(desktop).getByRole('button',{name:'组合下一页',exact:true}));
          assert.equal(secondContext.items.length,3);assert.equal(secondContext.nextCursor,null);await pairs(desktop).filter({hasText:secondContext.items[0].workerNo}).waitFor();assert.equal(await pairs(desktop).count(),3);
          await verifyPairs(desktop,secondContext.items);
          const combined=[...firstContext.items,...secondContext.items];assert.equal(new Set(combined.map(p=>p.workerId+'.'+p.locationId)).size,28);
          assert.deepEqual(combined.map(p=>[p.workerId,p.locationId]),data.workers.map((worker,index)=>[worker,data.locations[index===27?1:0]]));
          for(const p of combined)assert.equal(p.locationId,p.workerId===data.workers[27]?data.locations[1]:data.locations[0]);
          assert(await scoped(desktop).getByRole('button',{name:'查询可见工时',exact:true}).isDisabled());
          await scoped(desktop).getByLabel('人员／工号／地点',{exact:true}).fill('HIDDEN');
          const hidden=await click(desktop,'scoped-timesheet-context',scoped(desktop).getByRole('button',{name:'搜索授权组合',exact:true}));assert.deepEqual(hidden.items,[]);await scoped(desktop).getByText('没有匹配且当前获授权的人员与地点组合。',{exact:true}).waitFor();assert.equal(await pairs(desktop).count(),0);
          await click(desktop,'scoped-timesheet-context',scoped(desktop).getByRole('button',{name:'重新读取当前权限与范围',exact:true}));
          pass('actual authorized-pair picker pages25/3 without cross-grant Cartesian expansion, duplicate pairs or auto-selection; hidden personnel search returns no names or pairs');

          data.revoke(data.grants[2]);
          const conflict=await click(desktop,'scoped-timesheet-context',scoped(desktop).getByRole('button',{name:'组合下一页',exact:true}),409);
          assert.equal(conflict.error,'attendance_version_conflict');await scoped(desktop).getByRole('status').filter({hasText:'主管授权已更新'}).waitFor();assert.equal(await pairs(desktop).count(),0);
          assert(await scoped(desktop).getByRole('button',{name:'查询可见工时',exact:true}).isDisabled());
          const refreshed=await click(desktop,'scoped-timesheet-context',scoped(desktop).getByRole('button',{name:'重新读取当前权限与范围',exact:true}));assert.equal(refreshed.scopeRevision,4);assert.equal(refreshed.items.length,25);
          await scoped(desktop).getByRole('button',{name:'关闭工时核对',exact:true}).click();data.assertFactsUnchanged();
          pass('actual owner scope RPC removes overlapping grant; old pair-page cursor gets409 and clears choices, explicit fresh context uses revision4 while original records remain unchanged');

          const beforeRevoke=await home(desktop);await verifyRows(desktop,beforeRevoke,data.allowedIds.slice(0,50));data.revoke(data.grants[0]);
          const remaining=all.filter(r=>r.workerId===data.workers[27]).map(r=>r.id),remainingSet=new Set(remaining);
          const tail=data.allowedIds.slice(50).filter(id=>remainingSet.has(id));const afterRevoke=await next(desktop);await verifyRows(desktop,afterRevoke,tail.slice(0,50));assert.equal(afterRevoke.scopeRevision,5);
          const fresh=await home(desktop);await verifyRows(desktop,fresh,remaining.slice(0,50));await verifyRows(desktop,await next(desktop),remaining.slice(50));
          pass('manager old record cursor rechecks current grants after partial revoke: no revoked worker/location survives, fresh pages50/2 contain only the52 remaining facts; this is filtered history, not a frozen export');

          const phone=await newPage(true);const reads=count('records');await login(phone);assert.equal(count('records'),reads);
          await verifyRows(phone,await home(phone),remaining.slice(0,50));assert(await phone.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
          await home(desktop);data.revoke(data.grants[1]);
          for(const page of [desktop,phone]){
            const empty=await next(page);await verifyRows(page,empty,[]);assert.equal(empty.scopeRevision,6);assert.equal(empty.nextCursor,null);
            assert(await records(page).getByRole('button',{name:'下一页',exact:true}).isDisabled());
            const context=await click(page,'scoped-timesheet-context',records(page).getByRole('button',{name:'授权范围工时核对',exact:true}));assert.deepEqual(context.items,[]);
            assert(await scoped(page).getByRole('button',{name:'查询可见工时',exact:true}).isDisabled());
            const persisted=await page.evaluate(()=>[...Object.values(localStorage),...Object.values(sessionStorage)].join('\n'));
            for(const id of [...data.allowedIds,...data.forbiddenIds])assert(!persisted.includes(id));
          }
          assert.equal(exec('select count(*) from public.merchant_attendance_scope_grants;'),'0');assert.equal(exec('select count(*) from public.merchant_attendance_scope_operations;'),'6');
          assert(requests.filter(r=>r.method==='POST').every(r=>r.path==='/api/merchant-enterprise/employees/accept'));
          assert(requests.every(r=>r.status===200||r.path===endpoint('scoped-timesheet-context')&&r.status===409));
          assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.deepEqual(transport.errors,[]);data.assertFactsUnchanged();
          pass('after final scope RPC revoke, desktop and390px old history pages return authorized empty200 and clear raw details; pair selectors empty, no persisted event IDs, zero active grants or browser business writes');
          console.log(JSON.stringify({actualRecordsPagingEnterpriseShell:true,recordPages:[50,50,4],authorizedFacts:104,authorizedPairs:28,scopeOperations:6,realAuthService:false,realNextRuntime:false,syntheticPreseededFacts:true,browserBusinessWrites:0,productionAccess:false,externalRequests:0}));
        } finally {
          closing=true;await bounded(Promise.allSettled([...pending]),'paging_shell_routes_cleanup_timeout');
        }
      });
    } catch(error) {
      console.error('PAGING_SHELL_DIAGNOSTICS',JSON.stringify({requests:requests.slice(-8),errors}));throw error;
    } finally {
      closing=true;await runAttendanceCleanupSteps([
        {name:'paging-browser',run:()=>browser?.close()},
        {name:'paging-routes',run:()=>Promise.allSettled([...pending])},
        {name:'paging-harness',timeoutMs:10000,run:async()=>{if(child.pid!==undefined&&child.exitCode===null&&child.signalCode===null){const ended=once(child,'exit');child.kill();await ended;}}},
      ]);
    }
  });
}
await runAttendanceLabelsReuse(process.argv.slice(2).filter(arg=>arg!=='--self-history'),check).catch(error=>{console.error(error?.stack??String(error));process.exitCode=1;});
