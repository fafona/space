// Local synthetic acceptance, actual AdminPanel + read handlers/default SDK/SQL.
// No real login service, Next server, phone, production connection or feature flag.
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
import {prepareOwnerBacklogNativeFixture} from './merchant-attendance-owner-backlog-native.mjs';
import {runAttendanceCleanupSteps} from './fixtures/attendance-cleanup.mjs';
const require=createRequire(import.meta.url);
const {withAttendanceApplicationAuth}=require('./fixtures/attendance-application-auth.ts');
const {handleOwnerBacklog}=require('../src/app/api/merchant-enterprise/attendance/owner-backlog/route-handler.ts');
const {handleAttendanceAdmin}=require('../src/app/api/merchant-enterprise/attendance/admin/route-handler.ts');
const {parseOwnerBacklogQuery,parseOwnerBacklogHttpQuery,parseOwnerBacklogResponse}=require('../src/lib/merchantAttendanceOwnerBacklog.ts');
const {requireMerchantEnterpriseEntitlement}=require('../src/lib/merchantEnterpriseAuth.server.ts');
const {MERCHANT_AUTH_COOKIE}=require('../src/lib/merchantAuthSession.ts');
const origin='https://127.0.0.1:3131',staticOrigin='http://127.0.0.1:3131',canonical='https://www.faolla.com';
const endpoint='/api/merchant-enterprise/attendance/owner-backlog',rpcName='faolla_attendance_owner_backlog_v1';
const adminEndpoint='/api/merchant-enterprise/attendance/admin',adminRpc='faolla_attendance_admin_v1';
const localFetch=globalThis.fetch,labels={correction:'首次补正',revision:'再次修订',missing:'整段漏卡'};
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const bounded=async promise=>{let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('owner_backlog_browser_timeout')),20000);})]);}finally{clearTimeout(timer);}};
const pair=row=>({kind:row.kind,requestId:row.requestId});

export function assertOwnerBacklogBrowserPage(body,{query,ownerId,expected,asOf}){
  const parsed=parseOwnerBacklogResponse(body,query);
  assert.equal(parsed.ownerId,ownerId);assert.equal(parsed.moduleEnabled,false);
  if(asOf!==undefined)assert.equal(parsed.asOf,asOf);
  assert.deepEqual(parsed.items.map(pair),expected);
  return parsed;
}

export async function checkAttendanceOwnerBacklogBrowser(native,scope){
  const data=await prepareOwnerBacklogNativeFixture(native,scope),baseline=data.fingerprint();
  const actor={id:data.owner,email:'owner@example.test'};
  const probe=net.createServer();await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(3131,'127.0.0.1',resolve);});await new Promise(resolve=>probe.close(resolve));
  const child=spawn(process.execPath,['scripts/attendance-self-browser-harness.mjs','--owner-backlog'],{cwd:native.root,windowsHide:true,stdio:['ignore','pipe','pipe']});
  const errors=[],requests=[],pending=new Set(),gates=new Set(),rpcCalls=[];let browser,closing=false,phase='harness',hold=null;
  child.stderr.on('data',()=>errors.push('harness_stderr'));
  const rpc=async(name,args)=>{
    assert([rpcName,adminRpc].includes(name));
    assert.equal(args.p_site_id,data.site);assert.equal(args.p_auth_user_id,data.owner);
    let suffix;
    if(name===rpcName){
      assert.deepEqual(Object.keys(args).sort(),['p_auth_user_id','p_query','p_site_id']);
      const {siteId,...query}=parseOwnerBacklogQuery({siteId:args.p_site_id,...args.p_query});assert.equal(siteId,data.site);assert.deepEqual(query,args.p_query);
      rpcCalls.push({name,query:structuredClone(query)});suffix=",'"+JSON.stringify(query).replaceAll("'","''")+"'::jsonb";
    }else{
      assert.deepEqual(Object.keys(args).sort(),['p_auth_user_id','p_command','p_operation_id','p_query','p_site_id']);
      assert.equal(args.p_command,null);assert.equal(args.p_operation_id,null);
      assert.equal(args.p_query.view,'settings');assert.equal(args.p_query.cursor,null);assert.equal(args.p_query.search,'');
      rpcCalls.push({name});suffix=",'"+JSON.stringify(args.p_query).replaceAll("'","''")+"'::jsonb,null,null";
    }
    const result=JSON.parse(data.exec(`begin;set local role service_role;select jsonb_build_object('role',current_user,'data',public.${name}('${data.site}','${data.owner}'${suffix}));commit;`));
    assert.equal(result.role,'service_role');return {data:result.data,error:null};
  };
  try{
    await bounded(new Promise((resolve,reject)=>{let output='';child.stdout.on('data',chunk=>{output+=String(chunk);if(output.includes('Attendance synthetic component QA'))resolve();});child.once('error',()=>reject(Error('owner_backlog_harness_failed')));child.once('exit',()=>reject(Error('owner_backlog_harness_exited')));}));
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
            assert([endpoint,adminEndpoint].includes(url.pathname));const headers=new Headers(await request.allHeaders());
            assert.equal(headers.get('x-merchant-access-token'),null);assert(headers.get('cookie')?.includes(MERCHANT_AUTH_COOKIE+'='));
            headers.set('host','www.faolla.com');headers.set('referer',canonical+'/');
            const handler=url.pathname===endpoint?handleOwnerBacklog:handleAttendanceAdmin;
            const response=await handler(new Request(canonical+url.pathname+url.search,{headers}),{enabled:()=>true,entitlement});
            const body=await response.text(),parsed=JSON.parse(body);requests.push({path:url.pathname,status:response.status});
            const gate=url.pathname===endpoint?hold:null;if(gate){hold=null;gate.ready.resolve(parsed);await gate.release.promise;}
            try{await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body});}finally{if(gate){gate.finished.resolve();gates.delete(gate);}}
          })();pending.add(work);void work.finally(()=>pending.delete(work)).catch(()=>{});
          return work.catch(async()=>{if(!closing&&!route.request().failure())errors.push('route_failed');await route.abort().catch(()=>{});});
        });
        const page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',()=>errors.push('page_error'));
        const panel=()=>page.getByRole('region',{name:'负责人待审积压（只读）',exact:true}),count=()=>requests.filter(r=>r.path===endpoint).length;
        const open=async()=>{const before=count();await page.getByRole('button',{name:'负责人待审积压（只读）',exact:true}).click();await panel().waitFor();assert.equal(count(),before);assert.equal(await panel().locator('li').count(),0);};
        const storage=()=>page.evaluate(()=>({session:sessionStorage.getItem('qa-existing-pending-operation'),local:localStorage.getItem('qa-existing-draft')}));
        const assertRows=async body=>{
          await panel().getByRole('status').filter({hasText:body.items.length?'已读取本页':body.nextCursor?'仍有下一页':'已到末页'}).waitFor();
          const rows=panel().locator('li');assert.equal(await rows.count(),body.items.length);
          for(const [index,item] of body.items.entries()){
            const row=rows.nth(index);assert(await row.isVisible());const text=await row.textContent();
            for(const value of [item.requestId,item.workerName,item.workerNo,labels[item.kind],item.submittedAt])assert(text.includes(value));
          }
        };
        const read=async({button='查询待审积压',remaining,asOf}={})=>{
          const done=page.waitForResponse(r=>new URL(r.url()).pathname===endpoint).then(async r=>{assert.equal(r.status(),200);return {body:await r.json(),query:parseOwnerBacklogHttpQuery(r.url())};});void done.catch(()=>{});
          await panel().getByRole('button',{name:button,exact:true}).click();const {body,query}=await done;
          assertOwnerBacklogBrowserPage(body,{query,ownerId:data.owner,expected:remaining.slice(0,body.items.length),asOf});
          await assertRows(body);assert.equal(data.fingerprint(),baseline);return body;
        };
        const walk=async kind=>{
          const expected=data.expected[kind],found=[];let previous=null,pages=0,empty=0,asOf;
          do{
            assert(++pages<=10,'owner_backlog_browser_bounded_pages');
            const body=await read({button:previous?'下一页候选':'查询待审积压',remaining:expected.slice(found.length),asOf});
            asOf??=body.asOf;if(!body.items.length&&body.nextCursor)empty++;
            found.push(...body.items.map(pair));previous=body;
          }while(previous.nextCursor);
          assert.deepEqual(found,expected);assert.equal(new Set(found.map(r=>r.kind+':'+r.requestId)).size,found.length);
          assert.equal(await panel().getByRole('button',{name:'下一页候选',exact:true}).isDisabled(),true);
          return {pages,empty};
        };
        phase='actual-owner-entry';await page.goto(origin+'/?'+new URLSearchParams({siteId:data.site,ownerId:data.owner}));
        await page.getByRole('button',{name:'补正申请核对（只读）',exact:true}).waitFor();
        await page.waitForFunction(()=>!Array.from(document.querySelectorAll('button')).find(el=>el.textContent==='补正申请核对（只读）')?.disabled);
        assert.equal(requests.filter(r=>r.path===adminEndpoint&&r.status===200).length,1);await open();assert.equal(count(),0);
        const beforePost=rpcCalls.length,denied=await handleOwnerBacklog(new Request(canonical+endpoint,{method:'POST',headers:{'content-type':'application/json'},body:'{}'}),{enabled:()=>true,entitlement});
        assert.equal(denied.status,405);assert.equal(rpcCalls.length,beforePost);assert.equal(data.fingerprint(),baseline);
        native.pass('actual AdminPanel SQL settings and new lazy readonly entry work with zero automatic backlog query; POST cannot reach RPC');
        phase='all-pages';const all=await walk('all');assert(all.empty>=1);
        assert(Date.parse(data.expectedRows[0].submittedAt)<Date.now()-31*86400000);
        native.pass('actual visible all-kind pages cover old requests beyond31 days, advance empty50 candidates, and match the complete independent pending oracle without duplicate or omitted IDs');
        phase='type-filter';const beforeFilter=count();await panel().getByRole('combobox',{name:'申请类型',exact:true}).selectOption('missing');
        assert.equal(count(),beforeFilter);assert.equal(await panel().locator('li').count(),0);await walk('missing');
        native.pass('type changes clear without fetching; explicit missing-only query matches original and revision requests without copying closed decisions');
        phase='mobile-paused';const beforeViewport=count();await page.setViewportSize({width:390,height:844});await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
        assert.equal(count(),beforeViewport);await panel().getByText('新考勤已暂停；仍按当前负责人权限只读核对，不开放审批。',{exact:true}).waitFor();
        assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
        native.pass('390px paused attendance remains readable without overflow, automatic polling or viewport-triggered requests');
        phase='parent-hidden';const beforeHidden=count();await page.getByRole('button',{name:'补正申请核对（只读）',exact:true}).click();
        await panel().waitFor({state:'detached'});await page.getByRole('button',{name:'返回考勤管理',exact:true}).click();await open();
        assert.equal(count(),beforeHidden);assert.equal(await panel().locator('li').count(),0);
        native.pass('opening an existing owner workspace unmounts the new list, and returning requires an explicit fresh query');
        phase='held-unmount';await panel().getByRole('combobox',{name:'申请类型',exact:true}).selectOption('missing');
        const gate={ready:deferred(),release:deferred(),finished:deferred()};hold=gate;gates.add(gate);
        await panel().getByRole('button',{name:'查询待审积压',exact:true}).click();const held=await bounded(gate.ready.promise);
        assertOwnerBacklogBrowserPage(held,{query:parseOwnerBacklogQuery({siteId:data.site,kind:'missing',asOf:null,cursorAt:null,cursorKind:null,cursorId:null}),ownerId:data.owner,expected:data.expected.missing});assert(held.items.length);
        await page.getByRole('button',{name:'卸载测试负责人面板',exact:true}).click();await panel().waitFor({state:'detached'});gate.release.resolve();await bounded(gate.finished.promise);
        const beforeRemount=count();await page.getByRole('button',{name:'重挂测试负责人面板',exact:true}).click();await open();assert.equal(count(),beforeRemount);
        await panel().getByRole('combobox',{name:'申请类型',exact:true}).selectOption('missing');await walk('missing');
        assert.deepEqual(await storage(),{session:'synthetic-unchanged',local:'synthetic-unchanged'});
        assert.equal(rpcCalls.filter(call=>call.name===rpcName).length,count());assert.deepEqual(errors,[]);assert.equal(data.fingerprint(),baseline);
        native.pass('held real SQL200 cannot restore an unmounted list; remount is empty until query; unrelated storage and all business facts remain unchanged');
        console.log(JSON.stringify({ownerBacklogBrowser:true,browserChecks:6,backlogReads:count(),adminReads:requests.filter(r=>r.path===adminEndpoint).length,
          actualAdminPanel:true,reportBusinessWrites:0,syntheticAuth:true,syntheticOpeningFlagsAndEntitlement:true,
          realLoginForm:false,realAuthService:false,realNextServer:false,realPhone:false,productionAccess:false}));
      }finally{closing=true;for(const gate of gates)gate.release.resolve();await runAttendanceCleanupSteps([{name:'owner-backlog-browser',run:()=>browser?.close()},{name:'owner-backlog-routes',run:()=>Promise.allSettled([...pending])}]);}
    });
  }catch(error){console.error(JSON.stringify({ownerBacklogBrowserFailed:true,phase,sourceLine:String(error?.stack??'').match(/owner-backlog-browser-check\.mjs:(\d+):/)?.[1]??null,errors,requests}));throw Error('owner_backlog_browser_failed');}
  finally{closing=true;for(const gate of gates)gate.release.resolve();await runAttendanceCleanupSteps([{name:'browser',run:()=>browser?.close()},{name:'routes',run:()=>Promise.allSettled([...pending])},
    {name:'harness',timeoutMs:10000,run:async()=>{if(child.pid!==undefined&&child.exitCode===null&&child.signalCode===null){const stopped=once(child,'exit');child.kill();await stopped;}}}]);}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  await runAttendanceLabelsReuse(process.argv.slice(2),native=>withAttendanceConcurrencySandbox(native,scope=>checkAttendanceOwnerBacklogBrowser(native,scope)))
    .catch(()=>{console.error('owner_backlog_browser_failed');process.exitCode=1;});
}
