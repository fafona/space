// Local synthetic acceptance: actual SelfPanel + lazy readonly launcher/panel.
// Existing clock denial is explicitly mocked, not evidence of a real punch or
// login. New list reads use default authentication/SDK/executor and isolated SQL.
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
import {prepareSelfRevisionHistoryNativeFixture} from './merchant-attendance-self-revision-history-native.mjs';
import {runAttendanceCleanupSteps} from './fixtures/attendance-cleanup.mjs';
const require=createRequire(import.meta.url);
const {withAttendanceApplicationAuth}=require('./fixtures/attendance-application-auth.ts');
const {handleSelfRevisionHistory}=require('../src/app/api/merchant-enterprise/attendance/self-revision-history/route-handler.ts');
const {handleCorrectionContext}=require('../src/app/api/merchant-enterprise/attendance/corrections/context/route-handler.ts');
const {parseSelfRevisionHistoryQuery}=require('../src/lib/merchantAttendanceSelfRevisionHistory.ts');
const {requireMerchantEnterpriseEntitlement}=require('../src/lib/merchantEnterpriseAuth.server.ts');
const {MERCHANT_AUTH_COOKIE}=require('../src/lib/merchantAuthSession.ts');
const origin='https://127.0.0.1:3131',staticOrigin='http://127.0.0.1:3131',canonical='https://www.faolla.com';
const endpoint='/api/merchant-enterprise/attendance/self-revision-history',rpcName='faolla_attendance_self_revision_history_v1';
const contextEndpoint='/api/merchant-enterprise/attendance/corrections/context',contextRpc='faolla_attendance_self_context_v1';
const localFetch=globalThis.fetch;
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const bounded=async(promise)=>{let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('self_revision_browser_timeout')),20000);})]);}finally{clearTimeout(timer);}};
const labels={submitted:'待负责人审批',approved:'已批准',rejected:'已驳回',withdrawn:'已撤回'};

export function assertSelfRevisionHistoryBrowserPage(body,{siteId,employeeId,workerId,requestIds,status='all',asOf}){
  assert.equal(body.ok,true);assert.equal(body.protocol,'self-revision-history-v1');assert.equal(body.readOnly,true);assert.equal(body.moduleEnabled,false);
  assert.equal(body.siteId,siteId);assert.equal(body.employeeId,employeeId);assert.equal(body.workerId,workerId);
  assert.match(body.asOf,/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/);if(asOf!==undefined)assert.equal(body.asOf,asOf);
  assert(Number.isInteger(body.scanned)&&body.scanned>=0&&body.scanned<=50);assert(body.items.length<=body.scanned);
  assert.deepEqual(body.items.map(item=>item.requestId),requestIds);
  for(const item of body.items){assert.equal(item.workerId,workerId);assert.equal(item.employeeId,employeeId);assert.notEqual(item.requestId,item.rootRequestId);
    assert(Object.hasOwn(labels,item.status));if(status!=='all')assert.equal(item.status,status);}
  if(body.nextCursor!==null){assert.equal(body.scanned,50);assert.equal(typeof body.nextCursor.requestId,'string');assert.equal(typeof body.nextCursor.recordedAt,'string');}
}

export async function checkAttendanceSelfRevisionHistoryBrowser(native,scope){
  const data=await prepareSelfRevisionHistoryNativeFixture(native,scope),baseline=data.fingerprint();
  const actor={id:data.authUserId,email:'employee-a@example.test'};
  const probe=net.createServer();await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(3131,'127.0.0.1',resolve);});await new Promise(resolve=>probe.close(resolve));
  const child=spawn(process.execPath,['scripts/attendance-self-browser-harness.mjs','--self-revision-history'],{cwd:native.root,windowsHide:true,stdio:['ignore','pipe','pipe']});
  const errors=[],requests=[],pending=new Set(),gates=new Set(),rpcCalls=[];let browser,closing=false,phase='harness',hold=null;
  child.stderr.on('data',()=>errors.push('harness_stderr'));
  const rpc=async(name,args)=>{
    assert([rpcName,contextRpc].includes(name));assert.deepEqual(Object.keys(args).sort(),name===rpcName?['p_auth_user_id','p_query','p_site_id']:['p_auth_user_id','p_site_id']);
    assert.equal(args.p_site_id,data.site);assert.equal(args.p_auth_user_id,data.authUserId);
    let suffix='';
    if(name===rpcName){
      const {siteId,...query}=parseSelfRevisionHistoryQuery({siteId:args.p_site_id,...args.p_query});assert.equal(siteId,data.site);assert.deepEqual(query,args.p_query);
      assert.equal(query.expectedWorkerId,data.workerId);rpcCalls.push({name,query:structuredClone(query)});
      suffix=",'"+JSON.stringify(query).replaceAll("'","''")+"'::jsonb";
    }else rpcCalls.push({name});
    const result=JSON.parse(data.exec(`begin;set local role service_role;select jsonb_build_object('role',current_user,'data',public.${name}('${data.site}','${data.authUserId}'${suffix}));commit;`));
    assert.equal(result.role,'service_role');return {data:result.data,error:null};
  };
  try{
    await bounded(new Promise((resolve,reject)=>{let output='';child.stdout.on('data',chunk=>{output+=String(chunk);if(output.includes('Attendance synthetic component QA'))resolve();});child.once('error',()=>reject(Error('self_revision_harness_failed')));child.once('exit',()=>reject(Error('self_revision_harness_exited')));}));
    assert.equal((await localFetch(staticOrigin+endpoint,{method:'POST'})).status,403);
    browser=await chromium.launch({headless:true});
    await withAttendanceApplicationAuth([actor],rpc,async auth=>{
      try{
        const entitlement=value=>requireMerchantEnterpriseEntitlement(value,async()=>[{id:data.site,permissionConfig:{allowEnterpriseManagement:true,allowEmployeeAttendance:false}}]);
        const context=await browser.newContext({viewport:{width:1280,height:1000},serviceWorkers:'block',acceptDownloads:false});
        await context.addCookies([{name:MERCHANT_AUTH_COOKIE,value:await auth.login(actor),url:origin,secure:true,httpOnly:true,sameSite:'Lax'}]);
        await context.route('**/*',route=>{
          if(closing)return route.abort().catch(()=>{});
          const work=(async()=>{
            const request=route.request(),url=new URL(request.url());assert.equal(url.origin,origin);assert.equal(request.method(),'GET');
            if(['/', '/harness.js','/harness.css'].includes(url.pathname)){
              const r=await localFetch(staticOrigin+url.pathname);return route.fulfill({status:r.status,headers:Object.fromEntries(r.headers),body:Buffer.from(await r.arrayBuffer())});
            }
            assert([endpoint,contextEndpoint].includes(url.pathname));const headers=new Headers(await request.allHeaders());
            assert.equal(headers.get('x-merchant-access-token'),null);assert(headers.get('cookie')?.includes(MERCHANT_AUTH_COOKIE+'='));
            headers.set('host','www.faolla.com');headers.set('referer',canonical+'/');
            const handler=url.pathname===endpoint?handleSelfRevisionHistory:handleCorrectionContext;
            const response=await handler(new Request(canonical+url.pathname+url.search,{headers}),{enabled:()=>true,entitlement});
            const body=await response.text(),parsed=JSON.parse(body);requests.push({path:url.pathname,status:response.status});
            const gate=url.pathname===endpoint?hold:null;if(gate){hold=null;gate.ready.resolve(parsed);await gate.release.promise;}
            try{await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body});}finally{if(gate){gate.finished.resolve();gates.delete(gate);}}
          })();pending.add(work);void work.finally(()=>pending.delete(work)).catch(()=>{});
          return work.catch(async()=>{if(!closing&&!route.request().failure())errors.push('route_failed');await route.abort().catch(()=>{});});
        });
        const page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',()=>errors.push('page_error'));
        const panel=()=>page.getByRole('region',{name:'本人跨班次修订记录',exact:true}),count=()=>requests.filter(r=>r.path===endpoint).length;
        const expected={siteId:data.site,employeeId:data.employeeId,workerId:data.workerId};
        const open=async()=>{const before=requests.length;await page.getByRole('button',{name:'本人跨班次修订记录',exact:true}).click();await panel().waitFor();assert.equal(requests.length,before);assert.equal(await panel().locator('li').count(),0);};
        const read=async(requestIds,{button='查询本人修订记录',status='all',asOf}={})=>{
          const done=page.waitForResponse(r=>new URL(r.url()).pathname===endpoint).then(async r=>{assert.equal(r.status(),200);return r.json();});void done.catch(()=>{});
          await panel().getByRole('button',{name:button,exact:true}).click();const body=await done;
          assertSelfRevisionHistoryBrowserPage(body,{...expected,requestIds,status,asOf});
          await panel().getByRole('status').filter({hasText:body.items.length?'已读取本页':body.nextCursor?'仍有下一页':'已到末页'}).waitFor();
          const rows=panel().locator('li');assert.equal(await rows.count(),body.items.length);
          for(const [index,item] of body.items.entries()){
            const row=rows.nth(index);assert(await row.isVisible());const text=await row.textContent();
            for(const value of [item.requestId,item.rootRequestId,item.workerName,item.workerNo,labels[item.status],item.submittedAt])assert(text.includes(value));
          }
          assert.equal(data.fingerprint(),baseline);return body;
        };
        phase='actual-self-entry';await page.goto(origin+'/?'+new URLSearchParams({siteId:data.site,employeeId:data.employeeId,workerId:data.workerId,locationId:data.place}));
        await page.getByRole('region',{name:'我的考勤',exact:true}).waitFor();await open();assert.equal(count(),0);
        const denied=await handleSelfRevisionHistory(new Request(canonical+endpoint,{method:'POST',headers:{'content-type':'application/json'},body:'{}'}),{enabled:()=>true,entitlement});
        assert.equal(denied.status,405);assert.equal(rpcCalls.length,0);assert.equal(data.fingerprint(),baseline);
        native.pass('actual SelfPanel readonly launcher opens despite synthetic clock403 without history requests; real new handler rejects POST without RPC');
        phase='all-pages';const first=await read(data.expected.all.slice(0,50));assert(first.nextCursor);
        const last=await read(data.expected.all.slice(50),{button:'下一页候选',asOf:first.asOf});assert.equal(last.nextCursor,null);
        assert.deepEqual([...first.items,...last.items].map(item=>item.requestId),data.expected.all);
        assert.equal(new Set([...first.items,...last.items].map(item=>item.rootRequestId)).size,2);
        native.pass('actual list and visible ordered rows cover both own roots across50 and terminal pages with fixed microsecond asOf and no duplicated or foreign IDs');
        phase='empty-status-page';const beforeFilter=count();await panel().getByRole('combobox',{name:'申请状态',exact:true}).selectOption('approved');assert.equal(count(),beforeFilter);assert.equal(await panel().locator('li').count(),0);
        const empty=await read([],{status:'approved'});assert(empty.nextCursor);assert.equal(empty.scanned,50);
        const approved=await read(data.expected.approved,{button:'下一页候选',status:'approved',asOf:empty.asOf});assert.equal(approved.nextCursor,null);
        assert.equal(await panel().getByRole('button',{name:'下一页候选',exact:true}).isDisabled(),true);
        native.pass('approved filter produces a truthful empty intermediate page and explicit next reaches the genuine approved result instead of declaring no history');
        phase='mobile-paused';const beforeViewport=count();await page.setViewportSize({width:390,height:844});await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));assert.equal(count(),beforeViewport);
        await panel().getByRole('combobox',{name:'申请状态',exact:true}).selectOption('all');await read(data.expected.all.slice(0,50));
        await panel().getByText('新考勤已暂停；仍按当前权限只读核对，不开启提交或审批。',{exact:true}).waitFor();
        assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
        native.pass('390px readonly page has no document overflow or viewport-triggered query and remains readable under paused attendance');
        phase='held-unmount';const gate={ready:deferred(),release:deferred(),finished:deferred()};hold=gate;gates.add(gate);
        await panel().getByRole('button',{name:'重新查询首页',exact:true}).click();assertSelfRevisionHistoryBrowserPage(await bounded(gate.ready.promise),{...expected,requestIds:data.expected.all.slice(0,50)});
        await page.getByRole('button',{name:'卸载测试本人面板',exact:true}).click();await panel().waitFor({state:'detached'});gate.release.resolve();await bounded(gate.finished.promise);
        await page.getByRole('button',{name:'重挂测试本人面板',exact:true}).click();await open();assert.equal(count(),6);
        await read(data.expected.all.slice(0,50));assert.equal(count(),7);assert.equal(rpcCalls.filter(call=>call.name===rpcName).length,7);
        assert.equal(rpcCalls.filter(call=>call.name===contextRpc).length,5);assert.equal(requests.filter(r=>r.path===contextEndpoint).length,5);
        assert.deepEqual(errors,[]);assert.equal(data.fingerprint(),baseline);
        native.pass('held real SQL200 cannot restore an unmounted SelfPanel list; remount stays empty until explicit query and every report read preserves all business facts');
        console.log(JSON.stringify({selfRevisionHistoryBrowser:true,browserChecks:5,historyReads:7,contextReads:5,reportBusinessWrites:0,
          actualSelfPanel:true,syntheticExistingClockDenial:true,syntheticAuth:true,syntheticOpeningFlagsAndEntitlement:true,
          realLoginForm:false,realAuthService:false,realNextServer:false,realPhone:false,productionAccess:false}));
      }finally{closing=true;for(const gate of gates)gate.release.resolve();await runAttendanceCleanupSteps([{name:'self-history-browser',run:()=>browser?.close()},{name:'self-history-routes',run:()=>Promise.allSettled([...pending])}]);}
    });
  }catch(error){console.error(JSON.stringify({selfRevisionHistoryBrowserFailed:true,phase,sourceLine:String(error?.stack??'').match(/self-revision-history-browser-check\.mjs:(\d+):/)?.[1]??null,errors,requests}));throw Error('self_revision_history_browser_failed');}
  finally{closing=true;for(const gate of gates)gate.release.resolve();await runAttendanceCleanupSteps([{name:'browser',run:()=>browser?.close()},{name:'routes',run:()=>Promise.allSettled([...pending])},
    {name:'harness',timeoutMs:10000,run:async()=>{if(child.pid!==undefined&&child.exitCode===null&&child.signalCode===null){const stopped=once(child,'exit');child.kill();await stopped;}}}]);}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  await runAttendanceLabelsReuse(process.argv.slice(2),native=>withAttendanceConcurrencySandbox(native,scope=>checkAttendanceSelfRevisionHistoryBrowser(native,scope)))
    .catch(()=>{console.error('self_revision_history_browser_failed');process.exitCode=1;});
}
