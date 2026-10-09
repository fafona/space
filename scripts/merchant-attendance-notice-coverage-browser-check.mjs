// Explicit local-only acceptance of the actual owner notice lazy child. Auth
// service and HTTP routing are synthetic; handler/SDK/RPC/SQL are real source.
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
import {prepareNoticeCoverageNativeFixture,checkAttendanceNoticeCoverageNative} from './merchant-attendance-notice-coverage-native.mjs';
import {runAttendanceCleanupSteps} from './fixtures/attendance-cleanup.mjs';
const require=createRequire(import.meta.url);
const {withAttendanceApplicationAuth}=require('./fixtures/attendance-application-auth.ts');
const {handleAttendanceNotice}=require('../src/app/api/merchant-enterprise/attendance/location-notice/route-handler.ts');
const {handleAttendanceNoticeCoverage}=require('../src/app/api/merchant-enterprise/attendance/location-notice-coverage/route-handler.ts');
const {requireMerchantEnterpriseEntitlement}=require('../src/lib/merchantEnterpriseAuth.server.ts');
const {MERCHANT_AUTH_COOKIE}=require('../src/lib/merchantAuthSession.ts');
const origin='https://127.0.0.1:3131',staticOrigin='http://127.0.0.1:3131',canonical='https://www.faolla.com';
const noticePath='/api/merchant-enterprise/attendance/location-notice',coveragePath=noticePath+'-coverage';
const localFetch=globalThis.fetch;
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const bounded=async(promise)=>{let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('coverage_browser_timeout')),20000);})]);}finally{clearTimeout(timer);}};

export async function checkAttendanceNoticeCoverageBrowser(native,scope){
  const data=await prepareNoticeCoverageNativeFixture(native,scope),baseline=data.fingerprint();
  const owner={id:data.owner,email:'owner-entry@example.test'};
  const probe=net.createServer();await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(3131,'127.0.0.1',resolve);});await new Promise(resolve=>probe.close(resolve));
  const child=spawn(process.execPath,['scripts/attendance-self-browser-harness.mjs','--notice-coverage'],{cwd:native.root,windowsHide:true,stdio:['ignore','pipe','pipe']});
  const errors=[],requests=[],pending=new Set(),gates=new Set(),rpcCalls=[];let browser,closing=false,phase='harness',hold=null;
  child.stderr.on('data',()=>errors.push('harness_stderr'));
  const json=value=>"'"+JSON.stringify(value).replaceAll("'","''")+"'::jsonb";
  const rpc=async(name,args)=>{
    assert.equal(args.p_site_id,data.site);assert.equal(args.p_auth_user_id,data.owner);
    let params;
    if(name==='faolla_attendance_location_notice_coverage_v1'){
      assert.deepEqual(Object.keys(args).sort(),['p_auth_user_id','p_query','p_site_id']);assert.equal(args.p_query.locationId,data.place);
      params=`'${data.site}','${data.owner}',${json(args.p_query)}`;
    }else{
      assert.equal(name,'faolla_attendance_location_notice_v1');assert.deepEqual(Object.keys(args).sort(),['p_allow_publish','p_auth_user_id','p_command','p_query','p_site_id']);
      assert.equal(args.p_command,null);assert.deepEqual(args.p_query,{access:'owner',locationId:data.place,expectedWorkerId:null,operationId:null});assert.equal(typeof args.p_allow_publish,'boolean');
      params=`'${data.site}','${data.owner}',${json(args.p_query)},null,${args.p_allow_publish}`;
    }
    rpcCalls.push(name);
    const value=JSON.parse(data.exec(`begin;set local role service_role;select jsonb_build_object('role',current_user,'data',public.${name}(${params}));commit;`));
    assert.equal(value.role,'service_role');return {data:value.data,error:null};
  };
  try{
    await bounded(new Promise((resolve,reject)=>{let output='';child.stdout.on('data',chunk=>{output+=String(chunk);if(output.includes('Attendance synthetic component QA'))resolve();});child.once('error',()=>reject(Error('coverage_harness_failed')));child.once('exit',()=>reject(Error('coverage_harness_exited')));}));
    assert.equal((await localFetch(staticOrigin+coveragePath,{method:'POST'})).status,403);
    browser=await chromium.launch({headless:true});
    await withAttendanceApplicationAuth([owner],rpc,async auth=>{
      try{
        const entitlement=value=>requireMerchantEnterpriseEntitlement(value,async()=>[{id:data.site,permissionConfig:{allowEnterpriseManagement:true,allowEmployeeAttendance:false}}]);
        const context=await browser.newContext({viewport:{width:1280,height:1000},serviceWorkers:'block',acceptDownloads:false});
        await context.addCookies([{name:MERCHANT_AUTH_COOKIE,value:await auth.login(owner),url:origin,secure:true,httpOnly:true,sameSite:'Lax'}]);
        await context.route('**/*',route=>{
          const work=(async()=>{
            if(closing)return route.abort();
            const request=route.request(),url=new URL(request.url());assert.equal(url.origin,origin);assert.equal(request.method(),'GET');
            if(['/', '/harness.js','/harness.css'].includes(url.pathname)){
              const r=await localFetch(staticOrigin+url.pathname);return route.fulfill({status:r.status,headers:Object.fromEntries(r.headers),body:Buffer.from(await r.arrayBuffer())});
            }
            assert([noticePath,coveragePath].includes(url.pathname));const headers=new Headers(await request.allHeaders());
            assert.equal(headers.get('x-merchant-access-token'),null);assert(headers.get('cookie')?.includes(MERCHANT_AUTH_COOKIE+'='));
            headers.set('host','www.faolla.com');headers.set('referer',canonical+'/');
            const input=new Request(canonical+url.pathname+url.search,{headers});
            const r=url.pathname===noticePath?await handleAttendanceNotice(input,{enabled:()=>true,accessEnabled:()=>true,entitlement}):await handleAttendanceNoticeCoverage(input,{enabled:()=>true,entitlement});
            const body=await r.text(),parsed=JSON.parse(body);requests.push({path:url.pathname,status:r.status});
            const gate=url.pathname===coveragePath?hold:null;if(gate){hold=null;gate.ready.resolve(parsed);await gate.release.promise;}
            try{await route.fulfill({status:r.status,headers:Object.fromEntries(r.headers),body});}finally{if(gate){gate.finished.resolve();gates.delete(gate);}}
          })();pending.add(work);void work.finally(()=>pending.delete(work)).catch(()=>{});
          return work.catch(async()=>{if(!closing&&!route.request().failure())errors.push('route_failed');await route.abort().catch(()=>{});});
        });
        const page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',()=>errors.push('page_error'));
        const panel=()=>page.getByRole('region',{name:'定位告知确认情况',exact:true});
        const count=()=>requests.filter(row=>row.path===coveragePath).length;
        const read=async(button='重新查询首页')=>{
          const done=page.waitForResponse(r=>new URL(r.url()).pathname===coveragePath).then(async r=>{assert.equal(r.status(),200);return r.json();});void done.catch(()=>{});
          await panel().getByRole('button',{name:button,exact:true}).click();const body=await done;
          await panel().getByRole('status').filter({hasText:'已读取本页'}).waitFor();assert.deepEqual(body.counts,data.counts);assert.equal(body.moduleEnabled,false);
          assert.deepEqual(await panel().locator('dl dd').allTextContents(),['57','51','6','1','50']);
          assert.equal(await panel().locator('li').count(),body.items.length);assert.equal(data.fingerprint(),baseline);return body;
        };
        phase='parent-lazy-entry';
        await page.goto(origin+'/?'+new URLSearchParams({siteId:data.site,locationId:data.place,ownerId:data.owner}));await panel().waitFor();
        assert.equal(count(),0);assert.equal(await panel().locator('li').count(),0);
        native.pass('owner actual notice parent loads its default-gated readonly child without querying coverage or acknowledging');
        phase='real-first-and-next';const first=await read();assert.equal(first.items.length,50);assert(first.nextCursor);
        const second=await read('下一页');assert.equal(second.items.length,7);assert.equal(second.nextCursor,null);
        assert.equal(new Set([...first.items,...second.items].map(row=>row.workerId)).size,57);
        assert.equal(await panel().getByRole('button',{name:'下一页',exact:true}).isDisabled(),true);
        assert((await panel().textContent()).includes('不符合基本身份条件'));assert.equal(count(),2);
        native.pass('actual parent child uses default read handler and service-role SQL for50+7 replacement pages with57/51/6/1/50 counts while attendance is paused');
        phase='mobile-page';await page.setViewportSize({width:390,height:844});await read();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
        native.pass('390px actual notice coverage page remains readable without document overflow or automatic viewport-triggered queries');
        phase='late-unmount';const gate={ready:deferred(),release:deferred(),finished:deferred()};hold=gate;gates.add(gate);
        await panel().getByRole('button',{name:'重新查询首页',exact:true}).click();assert.equal((await bounded(gate.ready.promise)).items.length,50);
        await page.getByRole('button',{name:'卸载测试面板',exact:true}).click();await panel().waitFor({state:'detached'});gate.release.resolve();await bounded(gate.finished.promise);
        await page.getByRole('button',{name:'重挂测试面板',exact:true}).click();await panel().waitFor();assert.equal(await panel().locator('li').count(),0);assert.equal(count(),4);
        await read();assert.equal(count(),5);assert.equal(data.fingerprint(),baseline);assert.deepEqual(errors,[]);
        assert.equal(rpcCalls.filter(name=>name==='faolla_attendance_location_notice_coverage_v1').length,5);
        native.pass('unmounted notice child discards held SQL200; remount stays empty until explicit query and every report read preserves the same business fingerprint');
        console.log(JSON.stringify({noticeCoverageBrowser:true,browserChecks:4,reportReads:5,roster:57,reportBusinessWrites:0,fixtureDrafts:1,fixturePublications:1,fixtureAcknowledgements:1,actualNoticeParent:true,
          syntheticAuth:true,realAuthService:false,realNextServer:false,realPhone:false,productionAccess:false}));
      }finally{closing=true;for(const gate of gates)gate.release.resolve();await runAttendanceCleanupSteps([{name:'coverage-browser',run:()=>browser?.close()},{name:'coverage-routes',run:()=>Promise.allSettled([...pending])}]);}
    });
  }catch(error){console.error(JSON.stringify({noticeCoverageBrowserFailed:true,phase,sourceLine:String(error?.stack??'').match(/notice-coverage-browser-check\.mjs:(\d+):/)?.[1]??null,errors,requests}));throw Error('notice_coverage_browser_failed');}
  finally{closing=true;for(const gate of gates)gate.release.resolve();await runAttendanceCleanupSteps([{name:'browser',run:()=>browser?.close()},{name:'routes',run:()=>Promise.allSettled([...pending])},
    {name:'harness',timeoutMs:10000,run:async()=>{if(child.pid!==undefined&&child.exitCode===null&&child.signalCode===null){const stopped=once(child,'exit');child.kill();await stopped;}}}]);}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  await runAttendanceLabelsReuse(process.argv.slice(2),async native=>{
    await withAttendanceConcurrencySandbox(native,scope=>checkAttendanceNoticeCoverageNative(native,scope));
    await withAttendanceConcurrencySandbox(native,scope=>checkAttendanceNoticeCoverageBrowser(native,scope));
  }).catch(()=>{console.error('notice_coverage_local_check_failed');process.exitCode=1;});
}
