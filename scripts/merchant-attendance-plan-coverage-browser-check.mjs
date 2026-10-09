// Inert164 browser harness. Root invokes this inside the SAME native namespace.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {build} from 'esbuild';
import {compile} from '@tailwindcss/node';
import ts from 'typescript';
import {chromium} from 'playwright';
import {runAttendanceCleanupSteps} from './fixtures/attendance-cleanup.mjs';
import {assertShiftCheckBrowserProjection} from './merchant-attendance-shift-check-native.mjs';
import {lifecycleId as id} from './merchant-attendance-lifecycle-native-support.mjs';

const root=fileURLToPath(new URL('../',import.meta.url)),require=createRequire(import.meta.url);
const endpoint='/api/merchant-enterprise/attendance/plan-coverage',sourcePath='/api/merchant-enterprise/attendance/sources';
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
async function bounded(promise){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('plan_coverage_browser_timeout')),15000);})]);}finally{clearTimeout(timer);}}
async function assets(){
  const common={absWorkingDir:root,entryPoints:['scripts/fixtures/attendance-plan-coverage-browser.tsx'],bundle:true,write:false,metafile:true,platform:'browser',format:'esm',
    target:['es2020'],jsx:'automatic',tsconfig:path.join(root,'tsconfig.json'),outfile:'qa.js',logLevel:'warning'};
  const definitions={'process.env':'{}','process.env.NODE_ENV':'"development"'};
  const on=await build({...common,define:{...definitions,'process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_PLAN_COVERAGE_ENABLED':'"1"'}}),off=await build({...common,define:definitions});
  for(const bundle of [on,off])for(const file of Object.keys(bundle.metafile.inputs))assert(!/node:crypto|\.server\.ts$|merchantAttendanceShiftRuleBinding\.ts$/.test(file),'plan_coverage_browser_imported_server');
  const candidates=new Set();
  for(const filename of Object.keys(on.metafile.inputs).filter(name=>/\.tsx?$/.test(name)&&!name.includes('node_modules'))){
    const ast=ts.createSourceFile(filename,await readFile(path.join(root,filename),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
    const visit=node=>{if(ts.isStringLiteral(node)||ts.isNoSubstitutionTemplateLiteral(node)||ts.isTemplateHead(node)||ts.isTemplateMiddle(node)||ts.isTemplateTail(node))
      node.text.split(/\s+/).filter(Boolean).forEach(value=>candidates.add(value));ts.forEachChild(node,visit);};visit(ast);
  }
  const css=(await compile('@import "tailwindcss";',{base:root,onDependency:()=>{}})).build([...candidates])+
    'body{margin:0;background:#f1f5f9;font-family:Arial,sans-serif}.qa-toolbar{padding:12px;overflow-wrap:anywhere;background:#fff7ed;font-size:13px}.qa-controls{display:flex;flex-wrap:wrap;gap:8px}.qa-controls button{max-width:100%;border:1px solid #94a3b8;padding:6px;background:white}.qa-main{max-width:1100px;margin:auto;padding:12px;min-width:0}';
  return {on:on.outputFiles.find(f=>f.path.endsWith('.js')).contents,off:off.outputFiles.find(f=>f.path.endsWith('.js')).contents,css};
}
export async function checkAttendancePlanCoverageBrowser(native,scope,d,options={}){
  assert.equal(scope.sql,d.sql);assert(options.captureScreenshot===undefined||typeof options.captureScreenshot==='function');
  const parentSource=await readFile(path.join(root,'src/components/enterprise/MerchantAttendanceSourcesPanel.tsx'),'utf8');
  assert.match(parentSource,/<PlanCoverage source=\{r\} ownerId=\{ownerId\} apiFetch=\{apiFetch\}\/>/);
  const files=await assets(),definitions=d.definitions();let baseline=d.fingerprint();
  const {handlePlanCoverage}=require('../src/app/api/merchant-enterprise/attendance/plan-coverage/route-handler.ts');
  const {executePlanCoverage}=require('../src/lib/merchantAttendancePlanCoverage.server.ts');
  const {parsePlanCoverageResponse}=require('../src/lib/merchantAttendancePlanCoverage.ts');
  const {handleSources}=require('../src/app/api/merchant-enterprise/attendance/sources/route-handler.ts');
  const {executeSources}=require('../src/lib/merchantAttendanceSources.server.ts');
  const {MerchantEnterpriseAccessError}=require('../src/lib/merchantEnterpriseAuth.server.ts');
  const requests=[],errors=[],pending=new Set(),gates=new Set();let browser,origin,closing=false,hold=null,moduleEnabled=true,authMode='owner',checks=0,detailReads=0,parentReads=0;
  const service={rpc:async(name,args)=>{assert.deepEqual(Object.keys(args).sort(),['p_auth_user_id','p_query']);const facts=d.fingerprint();try{
    if(name==='faolla_attendance_sources_v1'){parentReads++;return {data:d.readSourceRaw(args.p_query,args.p_auth_user_id),error:null};}
    assert.equal(name,'faolla_attendance_plan_coverage_v1');detailReads++;return {data:d.readRaw(args.p_query,args.p_auth_user_id),error:null};
  }catch(error){const code=String(error).match(/ERROR:\s+(attendance_[a-z_]+)/)?.[1];if(!code)throw error;return {data:null,error:{message:code}};}
  finally{assert.equal(d.fingerprint(),facts,'plan_coverage_browser_read_changed_facts');assert.equal(d.definitions(),definitions);}}};
  const dependencies=(actor,source)=>({enabled:()=>true,allow:()=>true,authenticate:async()=>{
    if(authMode==='unauthenticated')throw new MerchantEnterpriseAccessError('unauthorized',401);
    return {user:{id:authMode==='wrong-owner'?id(98):actor},authenticationMethods:['password']};},
    entitlement:async site=>{assert.equal(site,d.site);return {permissionConfig:{allowEnterpriseManagement:true,allowEmployeeAttendance:moduleEnabled}};},
    execute:input=>source?executeSources(input,service):executePlanCoverage(input,service)});
  const server=createServer((request,response)=>{
    if(!origin||request.headers.host!==new URL(origin).host||request.method!=='GET')return response.writeHead(403).end();
    response.setHeader('Cache-Control','no-store');response.setHeader('X-Content-Type-Options','nosniff');
    response.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'");
    const url=new URL(request.url??'/',origin);if(url.search)return response.writeHead(403).end();
    if(url.pathname==='/'||url.pathname==='/off')return response.writeHead(200,{'Content-Type':'text/html;charset=utf-8'}).end(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>隔离计划关联核对验收</title><link rel="stylesheet" href="/qa.css"><div id="qa-root"></div><script type="module" src="/${url.pathname==='/off'?'qa-off':'qa'}.js"></script></html>`);
    if(url.pathname==='/qa.js'||url.pathname==='/qa-off.js')return response.writeHead(200,{'Content-Type':'text/javascript;charset=utf-8'}).end(url.pathname==='/qa.js'?files.on:files.off);
    if(url.pathname==='/qa.css')return response.writeHead(200,{'Content-Type':'text/css;charset=utf-8'}).end(files.css);return response.writeHead(403).end();
  });
  const panel=page=>page.getByRole('region',{name:'计划关联核对',exact:true}),detail=page=>panel(page).locator('[data-plan-coverage-detail]');
  const selection=page=>panel(page).getByLabel('核对排班选择',{exact:true}),readButton=page=>panel(page).getByRole('button',{name:'读取计划关联核对',exact:true});
  const choose=(page,name)=>selection(page).selectOption(d.slots[name].id);
  const latest=()=>{const packet=requests.at(-1);assert.equal(packet.path,endpoint);assert.equal(packet.status,200);return parsePlanCoverageResponse(packet.body,packet.query,d.owner);};
  const read=async(page,name)=>{await choose(page,name);await readButton(page).click();await detail(page).waitFor();const result=latest();assert.equal(result.slot.id,d.slots[name].id);return result;};
  const clear=page=>detail(page).waitFor({state:'detached'}),control=(page,key)=>page.getByTestId(key).click();
  const quiet=async(page,count)=>{await page.waitForLoadState('networkidle');await bounded(Promise.all([...pending]));assert.equal(requests.length,count,'unexpected_automatic_plan_coverage');};
  const gateNext=()=>{assert.equal(hold,null);const gate={ready:deferred(),release:deferred(),finished:deferred()};hold=gate;gates.add(gate);return gate;};
  const parent=page=>page.getByRole('region',{name:'单员工资料核查',exact:true});
  const readParent=async(page,q=d.historicalSourceQuery)=>{await control(page,'parent');await parent(page).getByLabel('核查开始日期').fill(q.fromDate);await parent(page).getByLabel('核查结束日期').fill(q.throughDate);
    await parent(page).getByRole('button',{name:'读取核查资料',exact:true}).click();await parent(page).getByRole('region',{name:'排班与记录时间对照',exact:true}).waitFor();};
  try{
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const address=server.address();assert(address&&typeof address==='object');origin=`http://127.0.0.1:${address.port}`;
    browser=await chromium.launch({headless:true});
    const run=async(name,check,width=1280,flagOff=false)=>{
      moduleEnabled=true;authMode='owner';const context=await browser.newContext({serviceWorkers:'block',acceptDownloads:false,viewport:{width,height:1050}});
      try{
        await context.addInitScript(seed=>{
          Object.defineProperty(window,'__planCoverageSeed',{value:seed});sessionStorage.setItem('qa-unrelated','preserve');localStorage.setItem('qa-unrelated','preserve');
          const probe={csp:[],storageWrites:0};Object.defineProperty(window,'__planCoverageProbe',{value:probe});
          for(const method of ['setItem','removeItem','clear']){const original=Storage.prototype[method];Storage.prototype[method]=function(...args){probe.storageWrites++;return original.apply(this,args);};}
          document.addEventListener('securitypolicyviolation',event=>probe.csp.push(event.violatedDirective));
        },{source:d.historicalSource,otherSource:d.source,owner:d.owner,otherOwner:id(98),flagOff});
        await context.route('**/*',route=>{
          if(closing)return route.abort().catch(()=>{});
          const work=(async()=>{
            const request=route.request(),url=new URL(request.url());assert.equal(url.origin,origin,'external_plan_coverage_request');assert.equal(request.method(),'GET','plan_coverage_must_not_write');
            if(['/','/off','/qa.js','/qa-off.js','/qa.css'].includes(url.pathname)){assert.equal(url.search,'');return route.continue();}
            assert([endpoint,sourcePath].includes(url.pathname));assert.equal(request.postData(),null);assert(requests.length<45,'plan_coverage_request_budget');
            const actor=request.headers()['x-qa-owner'];assert([d.owner,id(98)].includes(actor));const source=url.pathname===sourcePath;
            const response=await (source?handleSources:handlePlanCoverage)(new Request('https://www.faolla.com'+url.pathname+url.search,{headers:{Host:'www.faolla.com',Origin:'https://www.faolla.com'}}),dependencies(actor,source));
            const body=await response.text(),parsed=JSON.parse(body);assert.equal(response.headers.get('Cache-Control'),'private, no-store');
            if(!source&&response.ok){assertShiftCheckBrowserProjection(parsed);parsePlanCoverageResponse(parsed,Object.fromEntries(url.searchParams),actor);assert(Buffer.byteLength(body,'utf8')<=1048576);}
            requests.push({path:url.pathname,status:response.status,body:parsed,query:Object.fromEntries(url.searchParams)});
            const gate=!source?hold:null;if(gate){hold=null;gate.ready.resolve(parsed);await gate.release.promise;}
            try{await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body});}catch(error){if(!gate&&!closing)throw error;}
            finally{if(gate){gate.finished.resolve();gates.delete(gate);}}
          })();pending.add(work);void work.finally(()=>pending.delete(work)).catch(()=>{});
          return work.catch(async error=>{if(!closing)errors.push(error.message??'plan_coverage_route_failed');await route.abort().catch(()=>{});});
        });
        const page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',error=>errors.push(error.message));page.on('download',()=>errors.push('unexpected_download'));page.on('popup',()=>errors.push('unexpected_popup'));
        page.on('dialog',dialog=>{errors.push('unexpected_dialog');void dialog.dismiss();});await page.goto(origin+(flagOff?'/off':''));await page.getByTestId('enable').waitFor();
        try{await check(page);}catch(error){error.message=`${name}: ${error.message}`;throw error;}
        assert.deepEqual(await page.evaluate(()=>window.__planCoverageProbe),{csp:[],storageWrites:0});
        assert.deepEqual(await page.evaluate(()=>[sessionStorage.getItem('qa-unrelated'),localStorage.getItem('qa-unrelated')]),['preserve','preserve']);
        assert.equal(d.fingerprint(),baseline);assert.equal(d.definitions(),definitions);checks++;native.pass(name);
      }finally{for(const gate of gates)gate.release.resolve();await context.close();}
    };
    await run('164 defaultoff actual128 parent has no new child or automatic detail GET',async page=>{
      await quiet(page,requests.length);const before=requests.length;await readParent(page);await quiet(page,before+1);assert.equal(await panel(page).count(),0);assert.equal(requests.at(-1).path,sourcePath);
    },1280,true);
    await run('164 actual128 parent390 accepts latest095 coverage and later111 end099 cancellation without refreshing parent',async page=>{
      await readParent(page);await panel(page).waitFor();const before=requests.length;assert.equal(await selection(page).inputValue(),'');await choose(page,'historical');await quiet(page,before);
      await readButton(page).click();await detail(page).waitFor();const prior=latest();assert.equal(prior.sessions.length,2);assert.equal(prior.original.coveredUs,'0');assert.equal(prior.selected.coveredUs,'1800000000');
      const revision=d.reviseHistorical(true);baseline=d.fingerprint();
      const changed=await read(page,'historical');assert.equal(changed.selected.coveredUs,'3600000000');assert.equal(changed.original.coveredUs,'0');
      assert(changed.sessions.some(session=>session.effect?.revision===revision.revision&&session.effect.operationId===revision.operationId));
      const revised=detail(page).locator('[data-plan-coverage-session]').filter({hasText:revision.operationId});assert.equal(await revised.count(),1);
      await revised.locator('summary').click();assert((await revised.innerText()).includes(`修订 ${revision.revision}`));assert((await revised.innerText()).includes(revision.operationId));
      assert.equal(await detail(page).locator('[data-plan-coverage-view]').count(),2);assert.equal(await detail(page).locator('[data-plan-coverage-gaps="available"]').count(),2);
      assert((await panel(page).innerText()).includes('不是净工时'));assert((await detail(page).innerText()).includes('包含休息'));
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.equal(await panel(page).evaluate(el=>el.scrollWidth<=el.clientWidth+1),true);
      assert.equal(await page.locator('img,script[src="x"]').count(),0);if(options.captureScreenshot){await detail(page).scrollIntoViewIfNeeded();await options.captureScreenshot(await page.screenshot({fullPage:false}));}
      // Switch to the MAIN actual137 worker, then explicitly read its real128
      // parent. Historical source/events/relations above are honest synthetic
      // fixture facts for the other worker, not historic137 calls.
      await control(page,'worker-change');await readParent(page,d.sourceQuery);await panel(page).waitFor();
      const open=await read(page,'future');assert.equal(open.worker.workerId,d.worker);assert.equal(open.sessions.length,3);assert.equal(open.original.openIds.length,1);assert.equal(open.original.gaps,null);
      await d.finishCurrent();d.cancel(d.slots.future);baseline=d.fingerprint();
      const cancelled=await read(page,'future');assert.equal(cancelled.slot.cancelled,true);assert.equal(cancelled.original.openIds.length,0);assert.equal(cancelled.original.closedCount,3);
      assert(cancelled.sessions.every(session=>session.relation.currentCancelled===true));assert.equal(cancelled.original.gaps,null);assert((await detail(page).innerText()).includes('当前已取消'));
      const empty=await read(page,'zero');assert.equal(empty.sessions.length,0);assert((await detail(page).innerText()).includes('未保存明确关联'));
      const legacy=await read(page,'legacy');assert.equal(legacy.sessions.length,1);assert.equal(legacy.original.unverifiedIds.length,1);assert((await detail(page).innerText()).includes('缺少发布依据'));
      moduleEnabled=false;await read(page,'future');assert((await detail(page).innerText()).includes('暂停'));assert.equal(requests.at(-1).body.moduleEnabled,false);
    },390);
    await run('164 latest plan selection wins after earlier real response release',async page=>{
      await control(page,'enable');const gate=gateNext();await choose(page,'historical');await readButton(page).click();await bounded(gate.ready.promise);
      await control(page,'worker-change');await read(page,'zero');gate.release.resolve();await bounded(gate.finished.promise);await quiet(page,requests.length);assert.equal(await selection(page).inputValue(),d.slots.zero.id);
      assert((await detail(page).innerText()).includes('未保存明确关联'));assert.equal(await detail(page).locator('[data-plan-coverage-session]').count(),0);
    });
    await run('164 source worker owner API and authorization generation clear old detail without re-reading',async page=>{
      await control(page,'enable');for(const key of ['source-change','api-change','epoch']){await read(page,'historical');const n=requests.length;await control(page,key);await clear(page);await quiet(page,n);assert.equal(await selection(page).inputValue(),'');}
      await read(page,'historical');let n=requests.length;await control(page,'worker-change');await clear(page);await quiet(page,n);assert.equal(await selection(page).locator('option').count(),4);
      await control(page,'worker-restore');await read(page,'historical');n=requests.length;await control(page,'owner-change');await clear(page);await quiet(page,n);await control(page,'owner-restore');await quiet(page,n);
    });
    await run('164 held transport body hide pagehide and unmount cannot resurrect details',async page=>{
      await control(page,'enable');const gate=gateNext();await choose(page,'historical');await readButton(page).click();await bounded(gate.ready.promise);await control(page,'hide');await clear(page);
      gate.release.resolve();await bounded(gate.finished.promise);await control(page,'show');await quiet(page,requests.length);await clear(page);
      await control(page,'arm-body');await choose(page,'historical');await readButton(page).click();await page.getByTestId('body-phase').filter({hasText:'held'}).waitFor();const n=requests.length;
      await control(page,'api-change');await control(page,'release-body');await quiet(page,n);await clear(page);
      await read(page,'historical');await control(page,'pagehide');await clear(page);await control(page,'pageshow');await quiet(page,requests.length);
      const last=gateNext();await choose(page,'historical');await readButton(page).click();await bounded(last.ready.promise);await control(page,'unmount');last.release.resolve();await bounded(last.finished.promise);
      await control(page,'mount');await quiet(page,requests.length);await clear(page);
    });
    await run('164401403 clear old detail; actual parent date edits and close remove child',async page=>{
      await control(page,'enable');for(const mode of ['unauthenticated','wrong-owner']){authMode='owner';await read(page,'historical');authMode=mode;await readButton(page).click();await panel(page).getByRole('alert').waitFor();await clear(page);assert.equal(requests.at(-1).status,mode==='unauthenticated'?401:403);}
      authMode='owner';await readParent(page);await panel(page).waitFor();await read(page,'historical');let n=requests.length;
      await parent(page).getByLabel('核查开始日期').fill('');await panel(page).waitFor({state:'detached'});await quiet(page,n);
      await parent(page).getByLabel('核查开始日期').fill(d.historicalSourceQuery.fromDate);await parent(page).getByRole('button',{name:'读取核查资料',exact:true}).click();await panel(page).waitFor();
      n=requests.length;await parent(page).getByRole('button',{name:'关闭资料核查',exact:true}).click();await panel(page).waitFor({state:'detached'});await quiet(page,n);await page.getByTestId('closed').waitFor();
    });
    assert.equal(checks,6);assert.deepEqual(errors,[]);assert.equal(d.fingerprint(),baseline);assert.equal(d.definitions(),definitions);
    return {checks,apiRequests:requests.length,parentReads,detailReads,actual128Parent:true,actual139HandlerService:true,actualLater095Revision:true,actualLater111End:true,actualLater099Cancellation:true,
      syntheticAuth:true,posts:0,storageWrites:0,externalRequests:0,sourceTextSentToBrowser:false,nodeCryptoBundled:false,readFingerprintsUnchanged:true,
      explicitFixtureWrites:{approvedRevisions:1,clockEvents:1,scheduleCancellations:1},syntheticHistoricalPlan:true,syntheticHistoricalEvents:4,syntheticHistoricalRelations:2,
      realPastPublication:false,fullAdminE2E:false,productionAccess:false,newCluster:false};
  }finally{closing=true;for(const gate of gates)gate.release.resolve();await runAttendanceCleanupSteps([
    {name:'plan-coverage-browser',run:async()=>{await browser?.close();}},
    {name:'plan-coverage-interceptions',run:async()=>{await bounded(Promise.allSettled([...pending]));}},
    {name:'plan-coverage-loopback',run:async()=>{if(server.listening){server.closeAllConnections();await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}}},
  ]);}
}
