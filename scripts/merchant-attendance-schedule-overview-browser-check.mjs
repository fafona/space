// Actual owner AdminPanel + default handlers/SDK + owned synthetic SQL.
// No production, real Auth service, Next server, phone, screenshots or recordings.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import net from 'node:net';
import {chromium} from 'playwright';
import {runAttendanceLabelsReuse} from './merchant-attendance-choice-labels-reuse-native.mjs';
import {withAttendanceConcurrencySandbox} from './merchant-attendance-concurrency-sandbox.mjs';
import {prepareScheduleOverviewNativeFixture} from './merchant-attendance-schedule-overview-native.mjs';
import {runAttendanceCleanupSteps} from './fixtures/attendance-cleanup.mjs';
const require=createRequire(import.meta.url);
const {withAttendanceApplicationAuth}=require('./fixtures/attendance-application-auth.ts');
const {handleScheduleOverview}=require('../src/app/api/merchant-enterprise/attendance/schedule-overview/route-handler.ts');
const {handleAttendanceAdmin}=require('../src/app/api/merchant-enterprise/attendance/admin/route-handler.ts');
const {parseScheduleOverviewHttpQuery,parseScheduleOverviewResponse}=require('../src/lib/merchantAttendanceScheduleOverview.ts');
const {requireMerchantEnterpriseEntitlement}=require('../src/lib/merchantEnterpriseAuth.server.ts');
const {MERCHANT_AUTH_COOKIE}=require('../src/lib/merchantAuthSession.ts');
const origin='https://127.0.0.1:3131',staticOrigin='http://127.0.0.1:3131',canonical='https://www.faolla.com';
const endpoint='/api/merchant-enterprise/attendance/schedule-overview',adminEndpoint='/api/merchant-enterprise/attendance/admin';
const literal=v=>"'"+String(v).replaceAll("'","''")+"'",json=v=>literal(JSON.stringify(v))+'::jsonb';
const localFetch=globalThis.fetch;
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const bounded=async promise=>{let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('schedule_overview_browser_timeout')),20000);})]);}finally{clearTimeout(timer);}};
export async function checkScheduleOverviewBrowser(native,scope){
  const data=await prepareScheduleOverviewNativeFixture(native,scope);
  let baseline=data.fingerprint();const expected=data.rows();assert.equal(expected.length,72);
  const actor={id:data.owner,email:'overview-owner@example.test'},requests=[],errors=[],pending=new Set(),gates=new Set();
  let closing=false,browser,hold=null,phase='harness',rpcCalls=0;
  const probe=net.createServer();await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(3131,'127.0.0.1',resolve);});await new Promise(resolve=>probe.close(resolve));
  const child=spawn(process.execPath,['scripts/attendance-self-browser-harness.mjs','--schedule-overview'],{cwd:native.root,windowsHide:true,stdio:['ignore','pipe','pipe']});
  child.stderr.on('data',()=>errors.push('harness_stderr'));
  const rpc=async(name,args)=>{
    rpcCalls++;assert.equal(args.p_auth_user_id,data.owner);let params;
    if(name==='faolla_attendance_schedule_overview_v1'){
      assert.equal(args.p_query.siteId,data.site);assert.deepEqual(Object.keys(args).sort(),['p_auth_user_id','p_query']);params=[json(args.p_query),literal(data.owner)];
    }else{
      assert.equal(name,'faolla_attendance_admin_v1');assert.equal(args.p_site_id,data.site);assert.equal(args.p_command,null);assert.equal(args.p_operation_id,null);
      params=[literal(data.site),literal(data.owner),json(args.p_query),'null','null'];
    }
    const reply=JSON.parse(data.exec(`begin;set local role service_role;select jsonb_build_object('role',current_user,'data',public.${name}(${params.join(',')}));commit;`));
    assert.equal(reply.role,'service_role');return {data:reply.data,error:null};
  };
  try{
    await bounded(new Promise((resolve,reject)=>{let output='';child.stdout.on('data',chunk=>{output+=String(chunk);if(output.includes('Attendance synthetic component QA'))resolve();});child.once('error',()=>reject(Error('harness_failed')));child.once('exit',()=>reject(Error('harness_exited')));}));
    browser=await chromium.launch({headless:true});
    await withAttendanceApplicationAuth([actor],rpc,async auth=>{
      try{
        const entitlement=value=>requireMerchantEnterpriseEntitlement(value,async()=>[{id:data.site,permissionConfig:{allowEnterpriseManagement:true,allowEmployeeAttendance:false}}]);
        const context=await browser.newContext({viewport:{width:1280,height:1000},serviceWorkers:'block',acceptDownloads:false});
        await context.addCookies([{name:MERCHANT_AUTH_COOKIE,value:await auth.login(actor),url:origin,secure:true,httpOnly:true,sameSite:'Lax'}]);
        await context.addInitScript(()=>{sessionStorage.setItem('qa-pending','untouched');localStorage.setItem('qa-draft','untouched');});
        await context.route('**/*',route=>{
          if(closing)return route.abort().catch(()=>{});
          const work=(async()=>{
            const request=route.request(),url=new URL(request.url());assert.equal(url.origin,origin);assert.equal(request.method(),'GET');
            if(['/', '/harness.js','/harness.css'].includes(url.pathname)){
              const response=await localFetch(staticOrigin+url.pathname);return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});
            }
            assert([endpoint,adminEndpoint].includes(url.pathname));const headers=new Headers(await request.allHeaders());
            assert(headers.get('cookie')?.includes(MERCHANT_AUTH_COOKIE+'='));assert.equal(headers.get('x-merchant-access-token'),null);
            headers.set('host','www.faolla.com');headers.set('referer',canonical+'/');
            const handler=url.pathname===endpoint?handleScheduleOverview:handleAttendanceAdmin;
            const response=await handler(new Request(canonical+url.pathname+url.search,{headers}),{enabled:()=>true,entitlement});
            const body=await response.text(),parsed=JSON.parse(body);requests.push({path:url.pathname,status:response.status});
            const gate=url.pathname===endpoint?hold:null;if(gate){hold=null;gate.ready.resolve(parsed);await gate.release.promise;}
            try{await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body});}finally{if(gate){gate.finished.resolve();gates.delete(gate);}}
          })();pending.add(work);void work.finally(()=>pending.delete(work)).catch(()=>{});
          return work.catch(async()=>{if(!closing&&!route.request().failure())errors.push('route_failed');await route.abort().catch(()=>{});});
        });
        const page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',()=>errors.push('page_error'));
        const panel=()=>page.getByRole('region',{name:'多人排班总览（只读）',exact:true});
        const reads=()=>requests.filter(r=>r.path===endpoint).length;
        const open=async()=>{const before=reads();await page.getByRole('button',{name:'多人排班总览（只读）',exact:true}).click();await panel().waitFor();assert.equal(reads(),before);assert.equal(await panel().locator('article').count(),0);};
        const choose=async()=>{
          await panel().getByRole('button',{name:'搜索考勤人员',exact:true}).click();
          for(const worker of data.workerChoices)await panel().getByRole('checkbox',{name:`${worker.displayName} · ${worker.workerNo}`,exact:true}).check();
          await panel().getByLabel('总览开始日期',{exact:true}).fill(data.fromDate);await panel().getByLabel('总览结束日期',{exact:true}).fill(data.throughDate);
        };
        const read=async(expectedRows,{next=false,revision}={})=>{
          const done=page.waitForResponse(r=>new URL(r.url()).pathname===endpoint).then(async response=>{
            assert.equal(response.status(),200);return parseScheduleOverviewResponse(await response.json(),parseScheduleOverviewHttpQuery(response.url()));
          });void done.catch(()=>{});
          await panel().getByRole('button',{name:next?'下一页安排':'查询排班总览',exact:true}).click();const result=await done;
          assert.equal(result.ownerId,data.owner);assert.equal(result.moduleEnabled,false);if(revision!==undefined)assert.equal(result.revision,revision);
          assert.deepEqual(result.items,expectedRows);await panel().getByRole('status').filter({hasText:result.items.length?'已读取本页':result.nextCursor?'仍有下一页':'已到末页'}).waitFor();
          const rows=panel().locator('article');assert.equal(await rows.count(),expectedRows.length);
          for(const [i,item] of expectedRows.entries()){
            const row=rows.nth(i);assert(await row.isVisible());const text=await row.textContent();
            for(const value of [item.id,item.workerName,item.locationName,item.timeZone,item.workDate,item.cancelled?'已取消':'已安排'])assert(text.includes(value));
          }
          assert.equal(data.fingerprint(),baseline);return result;
        };
        phase='entry';await page.goto(origin+'/?'+new URLSearchParams({siteId:data.site,ownerId:data.owner}));await open();
        const beforeRpc=rpcCalls,denied=await handleScheduleOverview(new Request(canonical+endpoint,{method:'POST'}),{enabled:()=>true,entitlement});
        assert.equal(denied.status,405);assert.equal(rpcCalls,beforeRpc);await choose();assert.equal(reads(),0);
        native.pass('actual AdminPanel opens optional overview, explicit staff search and date selection cause no overview read; POST never reaches SQL');
        phase='first-page';const first=await read(expected.slice(0,50));assert(first.nextCursor);assert.equal(first.scanned,50);
        native.pass('actual default handlers/SDK/SQL render first50 from three selected workers with historical location labels and cancelled plans while admission paused');
        phase='revision-stability';const target=expected.slice(50).find(row=>!row.cancelled);assert(target);data.cancel(target.id);baseline=data.fingerprint();
        const second=await read(expected.slice(50),{next:true,revision:first.revision});assert.equal(second.nextCursor,null);
        assert.equal(second.items.find(row=>row.id===target.id).cancelled,false);assert.equal(await panel().getByRole('button',{name:'下一页安排',exact:true}).isDisabled(),true);
        native.pass('an original099 cancellation between pages cannot alter the prior revision; all72 original rows are traversed once without omission');
        phase='fresh-revision';const current=data.rows();assert.equal(current.find(row=>row.id===target.id).cancelled,true);
        const refreshed=await read(current.slice(0,50));assert(refreshed.revision>first.revision);await read(current.slice(50),{next:true,revision:refreshed.revision});
        native.pass('explicit new first-page query acquires newer revision and displays the newly cancelled row without erasing historical plans');
        phase='mobile-filter';await page.setViewportSize({width:390,height:844});const beforeFilter=reads();
        for(const worker of data.workerChoices.slice(1))await panel().getByRole('checkbox',{name:`${worker.displayName} · ${worker.workerNo}`,exact:true}).uncheck();
        assert.equal(reads(),beforeFilter);assert.equal(await panel().locator('article').count(),0);
        await read(current.filter(row=>row.workerId===data.workers[0]));assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
        native.pass('390px selected-worker change clears old view without fetching; explicit query contains only the chosen worker and no horizontal overflow');
        phase='held-unmount';const gate={ready:deferred(),release:deferred(),finished:deferred()};gates.add(gate);hold=gate;
        await panel().getByRole('button',{name:'查询排班总览',exact:true}).click();const held=await bounded(gate.ready.promise);assert(held.items.length>0);
        await page.getByRole('button',{name:'卸载测试管理页',exact:true}).click();await panel().waitFor({state:'detached'});gate.release.resolve();await bounded(gate.finished.promise);
        const beforeRemount=reads();await page.getByRole('button',{name:'重挂测试管理页',exact:true}).click();await open();assert.equal(reads(),beforeRemount);
        assert.equal(await panel().getByRole('button',{name:'查询排班总览',exact:true}).isDisabled(),true);
        assert.deepEqual(await page.evaluate(()=>({pending:sessionStorage.getItem('qa-pending'),draft:localStorage.getItem('qa-draft')})),{pending:'untouched',draft:'untouched'});
        assert.equal(data.fingerprint(),baseline);assert.deepEqual(errors,[]);
        native.pass('late realSQL200 cannot restore an unmounted view; remount has no selected identities or automatic reads and unrelated pending/draft storage stays intact');
        console.log(JSON.stringify({scheduleOverviewBrowser:true,browserChecks:6,overviewReads:reads(),adminReads:requests.filter(r=>r.path===adminEndpoint).length,
          syntheticAuth:true,realAuthService:false,realNextServer:false,realPhone:false,productionAccess:false}));
      }finally{closing=true;for(const gate of gates)gate.release.resolve();await runAttendanceCleanupSteps([{name:'overview-browser',run:()=>browser?.close()},{name:'overview-routes',run:()=>Promise.allSettled([...pending])}]);}
    });
  }catch(error){console.error(JSON.stringify({scheduleOverviewBrowserFailed:true,phase,sourceLine:String(error?.stack??'').match(/schedule-overview-browser-check\.mjs:(\d+):/)?.[1]??null,errors,requests}));throw Error('schedule_overview_browser_failed');}
  finally{closing=true;for(const gate of gates)gate.release.resolve();await runAttendanceCleanupSteps([{name:'browser',run:()=>browser?.close()},{name:'routes',run:()=>Promise.allSettled([...pending])},
    {name:'harness',timeoutMs:10000,run:async()=>{if(child.pid!==undefined&&child.exitCode===null&&child.signalCode===null){const stopped=once(child,'exit');child.kill();await stopped;}}}]);}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  await runAttendanceLabelsReuse(process.argv.slice(2),native=>withAttendanceConcurrencySandbox(native,scope=>checkScheduleOverviewBrowser(native,scope)))
    .catch(()=>{console.error('schedule_overview_browser_failed');process.exitCode=1;});
}
