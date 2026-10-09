// Actual SelfPanel, readonly handlers, installed SDK and isolated SQL. Auth and
// existing clock denial are synthetic; no real login/Next/phone/production claim.
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
import {prepareSelfRequestsNativeFixture} from './merchant-attendance-self-requests-native.mjs';
import {runAttendanceCleanupSteps} from './fixtures/attendance-cleanup.mjs';
const require=createRequire(import.meta.url);
const {withAttendanceApplicationAuth}=require('./fixtures/attendance-application-auth.ts');
const {handleSelfRequests}=require('../src/app/api/merchant-enterprise/attendance/self-requests/route-handler.ts');
const {handleCorrectionContext}=require('../src/app/api/merchant-enterprise/attendance/corrections/context/route-handler.ts');
const {parseSelfRequestsQuery,parseSelfRequestsHttpQuery,parseSelfRequestsResponse}=require('../src/lib/merchantAttendanceSelfRequests.ts');
const {requireMerchantEnterpriseEntitlement}=require('../src/lib/merchantEnterpriseAuth.server.ts');
const {MERCHANT_AUTH_COOKIE}=require('../src/lib/merchantAuthSession.ts');
const origin='https://127.0.0.1:3131',staticOrigin='http://127.0.0.1:3131',canonical='https://www.faolla.com';
const endpoint='/api/merchant-enterprise/attendance/self-requests',rpcName='faolla_attendance_self_requests_v1';
const contextEndpoint='/api/merchant-enterprise/attendance/corrections/context',contextRpc='faolla_attendance_self_context_v1';
const localFetch=globalThis.fetch,kinds={correction:'首次补正',revision:'再次修订',missing:'整段漏卡'},statuses={submitted:'待审批',approved:'已批准',rejected:'已驳回',withdrawn:'已撤回'};
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const bounded=async promise=>{let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('self_requests_browser_timeout')),20000);})]);}finally{clearTimeout(timer);}};
const identity=row=>({kind:row.kind,requestId:row.requestId,status:row.status});
export function assertSelfRequestsBrowserPage(body,{query,expected,asOf}){
  const parsed=parseSelfRequestsResponse(body,query);assert.equal(parsed.moduleEnabled,false);
  if(asOf!==undefined)assert.equal(parsed.asOf,asOf);
  assert.deepEqual(parsed.items.map(identity),expected.map(identity));return parsed;
}
export async function checkAttendanceSelfRequestsBrowser(native,scope){
  const data=await prepareSelfRequestsNativeFixture(native,scope),baseline=data.fingerprint(),actor={id:data.authUserId,email:'employee@example.test'};
  const probe=net.createServer();await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(3131,'127.0.0.1',resolve);});await new Promise(resolve=>probe.close(resolve));
  const child=spawn(process.execPath,['scripts/attendance-self-browser-harness.mjs','--self-requests'],{cwd:native.root,windowsHide:true,stdio:['ignore','pipe','pipe']});
  const errors=[],requests=[],pending=new Set(),gates=new Set(),rpcCalls=[];let browser,closing=false,phase='harness',hold=null;
  child.stderr.on('data',()=>errors.push('harness_stderr'));
  const rpc=async(name,args)=>{
    assert([rpcName,contextRpc].includes(name));assert.equal(args.p_site_id,data.site);assert.equal(args.p_auth_user_id,data.authUserId);
    assert.deepEqual(Object.keys(args).sort(),name===rpcName?['p_auth_user_id','p_query','p_site_id']:['p_auth_user_id','p_site_id']);
    let suffix='';
    if(name===rpcName){
      const {siteId,...query}=parseSelfRequestsQuery({siteId:args.p_site_id,...args.p_query});assert.equal(siteId,data.site);assert.deepEqual(query,args.p_query);
      assert.equal(query.expectedEmployeeId,data.employeeId);assert.equal(query.expectedWorkerId,data.workerId);
      rpcCalls.push({name,query:structuredClone(query)});suffix=",'"+JSON.stringify(query).replaceAll("'","''")+"'::jsonb";
    }else rpcCalls.push({name});
    const result=JSON.parse(data.exec(`begin;set local role service_role;select jsonb_build_object('role',current_user,'data',public.${name}('${data.site}','${data.authUserId}'${suffix}));commit;`));
    assert.equal(result.role,'service_role');return {data:result.data,error:null};
  };
  try{
    await bounded(new Promise((resolve,reject)=>{let output='';child.stdout.on('data',chunk=>{output+=String(chunk);if(output.includes('Attendance synthetic component QA'))resolve();});child.once('error',()=>reject(Error('self_requests_harness_failed')));child.once('exit',()=>reject(Error('self_requests_harness_exited')));}));
    assert.equal((await localFetch(staticOrigin+endpoint,{method:'POST'})).status,403);
    browser=await chromium.launch({headless:true});
    await withAttendanceApplicationAuth([actor],rpc,async auth=>{
      try{
        const entitlement=value=>requireMerchantEnterpriseEntitlement(value,async()=>[{id:data.site,permissionConfig:{allowEnterpriseManagement:true,allowEmployeeAttendance:false}}]);
        const context=await browser.newContext({viewport:{width:1280,height:1000},serviceWorkers:'block',acceptDownloads:false});
        await context.addCookies([{name:MERCHANT_AUTH_COOKIE,value:await auth.login(actor),url:origin,secure:true,httpOnly:true,sameSite:'Lax'}]);
        await context.addInitScript(()=>{sessionStorage.setItem('qa-existing-pending-operation','synthetic-unchanged');localStorage.setItem('qa-existing-draft','synthetic-unchanged');});
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
            const handler=url.pathname===endpoint?handleSelfRequests:handleCorrectionContext;
            const response=await handler(new Request(canonical+url.pathname+url.search,{headers}),{enabled:()=>true,entitlement});
            const body=await response.text(),parsed=JSON.parse(body);requests.push({path:url.pathname,status:response.status});
            const gate=url.pathname===endpoint?hold:null;if(gate){hold=null;gate.ready.resolve(parsed);await gate.release.promise;}
            try{await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body});}finally{if(gate){gate.finished.resolve();gates.delete(gate);}}
          })();pending.add(work);void work.finally(()=>pending.delete(work)).catch(()=>{});
          return work.catch(async()=>{if(!closing&&!route.request().failure())errors.push('route_failed');await route.abort().catch(()=>{});});
        });
        const page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',()=>errors.push('page_error'));
        const panel=()=>page.getByRole('region',{name:'我的申请记录（只读）',exact:true}),count=()=>requests.filter(r=>r.path===endpoint).length;
        const open=async()=>{const before=requests.length;await page.getByRole('button',{name:'我的申请记录（只读）',exact:true}).click();await panel().waitFor();assert.equal(requests.length,before);assert.equal(await panel().locator('li').count(),0);};
        const expected=(kind,status)=>data.expectedRows.filter(row=>(kind==='all'||row.kind===kind)&&(status==='all'||row.status===status));
        const read=async({button='查询我的申请',remaining,asOf}={})=>{
          const done=page.waitForResponse(r=>new URL(r.url()).pathname===endpoint).then(async r=>{assert.equal(r.status(),200);return {body:await r.json(),query:parseSelfRequestsHttpQuery(r.url())};});void done.catch(()=>{});
          await panel().getByRole('button',{name:button,exact:true}).click();const {body,query}=await done;
          assertSelfRequestsBrowserPage(body,{query,expected:remaining.slice(0,body.items.length),asOf});
          await panel().getByRole('status').filter({hasText:body.items.length?'已读取本页':body.nextCursor?'仍有下一页':'已到末页'}).waitFor();
          const rows=panel().locator('li');assert.equal(await rows.count(),body.items.length);
          for(const [index,item] of body.items.entries()){
            const row=rows.nth(index);assert(await row.isVisible());const text=await row.textContent();
            for(const value of [item.requestId,item.rootRequestId,item.workerName,item.workerNo,kinds[item.kind],statuses[item.status],item.submittedAt])assert(text.includes(value));
          }
          assert.equal(data.fingerprint(),baseline);return body;
        };
        const walk=async(kind='all',status='all')=>{
          const wanted=expected(kind,status),found=[];let previous=null,pages=0,empty=0,asOf;
          do{
            assert(++pages<=10,'self_requests_browser_bounded_pages');
            const body=await read({button:previous?'下一页候选':'查询我的申请',remaining:wanted.slice(found.length),asOf});asOf??=body.asOf;
            if(!body.items.length&&body.nextCursor)empty++;found.push(...body.items.map(identity));previous=body;
          }while(previous.nextCursor);
          assert.deepEqual(found,wanted.map(identity));assert.equal(new Set(found.map(r=>r.kind+':'+r.requestId)).size,found.length);
          assert.equal(await panel().getByRole('button',{name:'下一页候选',exact:true}).isDisabled(),true);return {pages,empty};
        };
        phase='actual-self-entry';await page.goto(origin+'/?'+new URLSearchParams({siteId:data.site,employeeId:data.employeeId}));
        await page.getByRole('region',{name:'我的考勤',exact:true}).waitFor();await open();assert.equal(requests.length,0);
        const denied=await handleSelfRequests(new Request(canonical+endpoint,{method:'POST',headers:{'content-type':'application/json'},body:'{}'}),{enabled:()=>true,entitlement});
        assert.equal(denied.status,405);assert.equal(rpcCalls.length,0);assert.equal(data.fingerprint(),baseline);
        native.pass('actual SelfPanel opens the lazy list without network despite synthetic clock403; POST cannot reach SQL');
        phase='all-kinds';await walk();assert.equal(new Set(data.expectedRows.map(row=>row.kind)).size,3);
        assert.equal(new Set(data.expectedRows.map(row=>row.status)).size,4);assert(data.expectedRows.some(row=>Date.parse(row.submittedAt)<Date.now()-31*86400000));
        native.pass('actual all-kind pages and every visible row match independent owned request/status oracle across dates with no duplicates or foreign identities');
        phase='empty-filter-page';const beforeFilter=requests.length;await panel().getByRole('combobox',{name:'申请类型',exact:true}).selectOption('revision');
        await panel().getByRole('combobox',{name:'申请状态',exact:true}).selectOption('approved');assert.equal(requests.length,beforeFilter);assert.equal(await panel().locator('li').count(),0);
        const filtered=await walk('revision','approved');assert(filtered.empty>=1);
        native.pass('combined kind/status filters clear without fetching and explicit next advances the empty50 candidates to the genuine approved result');
        phase='mobile-paused';const beforeViewport=requests.length;await page.setViewportSize({width:390,height:844});await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
        assert.equal(requests.length,beforeViewport);await panel().getByRole('combobox',{name:'申请类型',exact:true}).selectOption('missing');
        await panel().getByRole('combobox',{name:'申请状态',exact:true}).selectOption('all');await walk('missing');
        await panel().getByText('新考勤已暂停；仍可只读核对本人申请，不开放提交或审批。',{exact:true}).waitFor();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
        native.pass('390px paused self history has no document overflow or viewport-triggered read and includes original and revised missing requests');
        phase='held-unmount';const gate={ready:deferred(),release:deferred(),finished:deferred()};hold=gate;gates.add(gate);
        await panel().getByRole('button',{name:'重新查询首页',exact:true}).click();const held=await bounded(gate.ready.promise);assert(held.items.length);
        const heldQuery={siteId:data.site,expectedEmployeeId:data.employeeId,expectedWorkerId:data.workerId,kind:'missing',status:'all',asOf:null,cursorAt:null,cursorKind:null,cursorId:null};
        assertSelfRequestsBrowserPage(held,{query:heldQuery,expected:expected('missing','all').slice(0,held.items.length)});
        await page.getByRole('button',{name:'卸载测试本人面板',exact:true}).click();await panel().waitFor({state:'detached'});gate.release.resolve();await bounded(gate.finished.promise);
        const beforeRemount=requests.length;await page.getByRole('button',{name:'重挂测试本人面板',exact:true}).click();await open();assert.equal(requests.length,beforeRemount);
        await panel().getByRole('combobox',{name:'申请类型',exact:true}).selectOption('missing');await walk('missing');
        assert.deepEqual(await page.evaluate(()=>({session:sessionStorage.getItem('qa-existing-pending-operation'),local:localStorage.getItem('qa-existing-draft')})),{session:'synthetic-unchanged',local:'synthetic-unchanged'});
        assert.equal(rpcCalls.filter(call=>call.name===rpcName).length,count());assert.equal(rpcCalls.filter(call=>call.name===contextRpc).length,requests.filter(r=>r.path===contextEndpoint).length);
        assert.deepEqual(errors,[]);assert.equal(data.fingerprint(),baseline);
        native.pass('held real SQL200 cannot revive unmounted self history; remount needs explicit query; unrelated storage and all business facts are unchanged');
        console.log(JSON.stringify({selfRequestsBrowser:true,browserChecks:5,historyReads:count(),contextReads:requests.filter(r=>r.path===contextEndpoint).length,
          actualSelfPanel:true,reportBusinessWrites:0,syntheticExistingClockDenial:true,syntheticAuth:true,syntheticOpeningFlagsAndEntitlement:true,
          realLoginForm:false,realAuthService:false,realNextServer:false,realPhone:false,productionAccess:false}));
      }finally{closing=true;for(const gate of gates)gate.release.resolve();await runAttendanceCleanupSteps([{name:'self-requests-browser',run:()=>browser?.close()},{name:'self-requests-routes',run:()=>Promise.allSettled([...pending])}]);}
    });
  }catch(error){console.error(JSON.stringify({selfRequestsBrowserFailed:true,phase,sourceLine:String(error?.stack??'').match(/self-requests-browser-check\.mjs:(\d+):/)?.[1]??null,errors,requests}));throw Error('self_requests_browser_failed');}
  finally{closing=true;for(const gate of gates)gate.release.resolve();await runAttendanceCleanupSteps([{name:'browser',run:()=>browser?.close()},{name:'routes',run:()=>Promise.allSettled([...pending])},
    {name:'harness',timeoutMs:10000,run:async()=>{if(child.pid!==undefined&&child.exitCode===null&&child.signalCode===null){const stopped=once(child,'exit');child.kill();await stopped;}}}]);}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  await runAttendanceLabelsReuse(process.argv.slice(2),native=>withAttendanceConcurrencySandbox(native,scope=>checkAttendanceSelfRequestsBrowser(native,scope)))
    .catch(()=>{console.error('self_requests_browser_failed');process.exitCode=1;});
}
