// Inert172 acceptance. Root invokes against its EXISTING owned fixture; this
// file owns only an in-memory bundle, loopback HTTP and one Chromium lifecycle.
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
import {runAttendanceCleanupSteps} from './attendance-cleanup.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url)),require=createRequire(import.meta.url),canonical='https://www.faolla.com';
const sourcePath='/api/merchant-enterprise/attendance/sources',shiftPath='/api/merchant-enterprise/attendance/shift-check-adoption',planPath='/api/merchant-enterprise/attendance/plan-coverage-adoptions';
const oldShiftPath='/api/merchant-enterprise/attendance/shift-check',oldPlanPath='/api/merchant-enterprise/attendance/plan-coverage';
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
async function bounded(promise){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('plan_adoption_browser_timeout')),15000);})]);}finally{clearTimeout(timer);}}
async function assets(){
  const base={absWorkingDir:root,entryPoints:['scripts/fixtures/attendance-plan-adoption-view-browser.tsx'],bundle:true,write:false,metafile:true,platform:'browser',format:'esm',
    target:['es2020'],jsx:'automatic',tsconfig:path.join(root,'tsconfig.json'),outfile:'qa.js',logLevel:'warning'};
  const definitions={'process.env':'{}','process.env.NODE_ENV':'"development"','process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_SHIFT_CHECK_ENABLED':'"1"','process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_PLAN_COVERAGE_ENABLED':'"1"'};
  const on=await build({...base,define:{...definitions,'process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_PLAN_ADOPTION_VIEW_ENABLED':'"1"'}}),off=await build({...base,define:definitions});
  for(const bundle of [on,off])for(const name of Object.keys(bundle.metafile.inputs))assert(!/node:crypto|\.server\.ts$|merchantAttendanceShiftRuleBinding\.ts$/.test(name),'adoption_view_server_import');
  const candidates=new Set();
  for(const name of Object.keys(on.metafile.inputs).filter(n=>/\.tsx?$/.test(n)&&!n.includes('node_modules'))){
    const ast=ts.createSourceFile(name,await readFile(path.join(root,name),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
    const visit=node=>{if(ts.isStringLiteral(node)||ts.isNoSubstitutionTemplateLiteral(node)||ts.isTemplateHead(node)||ts.isTemplateMiddle(node)||ts.isTemplateTail(node))node.text.split(/\s+/).filter(Boolean).forEach(value=>candidates.add(value));ts.forEachChild(node,visit);};visit(ast);
  }
  const css=(await compile('@import "tailwindcss";',{base:root,onDependency:()=>{}})).build([...candidates])+
    'body{margin:0;background:#f1f5f9;font-family:Arial,sans-serif}.qa-toolbar{padding:12px;background:#fff7ed;font-size:13px;overflow-wrap:anywhere}.qa-controls{display:flex;flex-wrap:wrap;gap:8px}.qa-controls button{border:1px solid #94a3b8;padding:6px;background:white;max-width:100%}.qa-main{max-width:1100px;margin:auto;padding:12px;min-width:0}';
  return {on:on.outputFiles.find(f=>f.path.endsWith('.js')).contents,off:off.outputFiles.find(f=>f.path.endsWith('.js')).contents,css};
}
function canonicalRequest(url){return new Request(canonical+url,{headers:{host:'www.faolla.com',origin:canonical,'sec-fetch-site':'same-origin'}});}

export async function runPlanAdoptionViewBrowserAcceptance(d){
  const v=d.viewBrowser;assert(v&&v.sourceQuery&&v.startEventId&&v.slotId);
  const {parseSourcesResponse}=require('../../src/lib/merchantAttendanceSources.ts');
  const {parseShiftCheckAdoptionResponse,parsePlanCoverageAdoptionsResponse}=require('../../src/lib/merchantAttendancePlanAdoptionView.ts');
  const {MerchantEnterpriseAccessError}=require('../../src/lib/merchantEnterpriseAuth.server.ts');
  const definitions=d.definitions(),baseline=d.fingerprint();let seedReads=0,source=v.source;
  if(!source){const response=await v.handleSources(canonicalRequest(sourcePath+'?'+new URLSearchParams(v.sourceQuery)));assert.equal(response.status,200);
    source=parseSourcesResponse(await response.json(),v.sourceQuery,v.owner);seedReads++;}
  assert.equal(source.actorId,v.owner);assert.equal(source.siteId,v.site);assert.equal(d.fingerprint(),baseline);
  const files=await assets(),requests=[],errors=[],pending=new Set(),gates=new Set();
  const otherOwner='00000000-0000-4000-8000-000000000098';assert.notEqual(otherOwner,v.owner);
  let browser,origin,closing=false,hold=null,authMode='owner',moduleEnabled=true,checks=0;
  const handlers={[sourcePath]:v.handleSources,[shiftPath]:v.handleShift,[planPath]:v.handlePlan,[oldShiftPath]:v.handleOldShift,[oldPlanPath]:v.handleOldPlan};
  const server=createServer((request,response)=>{
    if(!origin||request.headers.host!==new URL(origin).host||request.method!=='GET')return response.writeHead(403).end();
    response.setHeader('Cache-Control','no-store');response.setHeader('X-Content-Type-Options','nosniff');
    response.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'");
    const url=new URL(request.url??'/',origin);if(url.search)return response.writeHead(403).end();
    if(url.pathname==='/'||url.pathname==='/off')return response.writeHead(200,{'Content-Type':'text/html;charset=utf-8'}).end(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>隔离固定采用引用验收</title><link rel="stylesheet" href="/qa.css"><div id="qa-root"></div><script type="module" src="/${url.pathname==='/off'?'qa-off':'qa'}.js"></script></html>`);
    if(url.pathname==='/qa.js'||url.pathname==='/qa-off.js')return response.writeHead(200,{'Content-Type':'text/javascript;charset=utf-8'}).end(url.pathname==='/qa.js'?files.on:files.off);
    if(url.pathname==='/qa.css')return response.writeHead(200,{'Content-Type':'text/css;charset=utf-8'}).end(files.css);return response.writeHead(403).end();
  });
  const parent=p=>p.getByRole('region',{name:'单员工资料核查',exact:true}),panel=(p,kind)=>p.getByRole('region',{name:kind==='shift'?'单班次独立核查':'计划关联核对',exact:true});
  const choice=(p,kind)=>panel(p,kind).getByLabel(kind==='shift'?'选择核查原始班次':'核对排班选择',{exact:true});
  const button=(p,kind)=>panel(p,kind).getByRole('button',{name:kind==='shift'?'读取班次核查':'读取计划关联核对',exact:true});
  const detail=(p,kind)=>panel(p,kind).locator(kind==='shift'?'[data-shift-check-detail]':'[data-plan-coverage-detail]');
  const refs=(p,kind)=>panel(p,kind).locator('[data-plan-adoption-reference]');
  const control=(p,name)=>p.getByTestId(name).click();
  const quiet=async(p,count=requests.length)=>{await p.waitForLoadState('networkidle');await bounded(Promise.all([...pending]));assert.equal(requests.length,count,'unexpected_automatic_adoption_view_read');};
  const clickRead=async(p,kind,pathName=kind==='shift'?shiftPath:planPath)=>{
    const [response]=await Promise.all([p.waitForResponse(r=>new URL(r.url()).pathname===pathName&&r.request().method()==='GET'),button(p,kind).click()]);
    await response.finished();assert.equal(response.status(),200,await response.text());await detail(p,kind).waitFor();return response.json();
  };
  const read=async(p,kind,pathName)=>{await choice(p,kind).selectOption(kind==='shift'?v.startEventId:v.slotId);return clickRead(p,kind,pathName);};
  const parentRead=async p=>{await parent(p).getByLabel('核查开始日期').fill(v.sourceQuery.fromDate);await parent(p).getByLabel('核查结束日期').fill(v.sourceQuery.throughDate);
    const [response]=await Promise.all([p.waitForResponse(r=>new URL(r.url()).pathname===sourcePath),parent(p).getByRole('button',{name:'读取核查资料',exact:true}).click()]);
    await response.finished();assert.equal(response.status(),200,await response.text());await panel(p,'shift').waitFor();await panel(p,'plan').waitFor();};
  const cleared=async(p,kind)=>{await detail(p,kind).waitFor({state:'detached'});assert.equal(await refs(p,kind).count(),0);};
  const gateNext=()=>{assert.equal(hold,null);const gate={ready:deferred(),release:deferred(),finished:deferred()};hold=gate;gates.add(gate);return gate;};
  try{
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const address=server.address();assert(address&&typeof address==='object');origin=`http://127.0.0.1:${address.port}`;
    browser=await chromium.launch({headless:true});
    const run=async(name,check,{off=false,width=1280}={})=>{
      authMode='owner';moduleEnabled=true;const start=requests.length,context=await browser.newContext({serviceWorkers:'block',acceptDownloads:false,viewport:{width,height:1050}});
      try{
        await context.addInitScript(seed=>{
          Object.defineProperty(window,'__planAdoptionViewSeed',{value:seed});sessionStorage.setItem('qa-unrelated','preserve');localStorage.setItem('qa-unrelated','preserve');
          const probe={csp:[],storageWrites:0};Object.defineProperty(window,'__planAdoptionProbe',{value:probe});
          for(const method of ['setItem','removeItem','clear']){const original=Storage.prototype[method];Storage.prototype[method]=function(...args){probe.storageWrites++;return original.apply(this,args);};}
          document.addEventListener('securitypolicyviolation',e=>probe.csp.push(e.violatedDirective));
        },{source,owner:v.owner,otherOwner});
        await context.route('**/*',route=>{
          if(closing)return route.abort().catch(()=>{});
          const work=(async()=>{
            const req=route.request(),url=new URL(req.url());assert.equal(url.origin,origin,'adoption_view_external_request');assert.equal(req.method(),'GET','adoption_view_must_not_write');assert.equal(req.postData(),null);
            if(['/','/off','/qa.js','/qa-off.js','/qa.css'].includes(url.pathname)){assert.equal(url.search,'');return route.continue();}
            assert(Object.hasOwn(handlers,url.pathname));assert(requests.length+seedReads<25,'adoption_view_request_budget');const actor=req.headers()['x-qa-owner'];assert([v.owner,otherOwner].includes(actor));
            const overrides={authenticate:async()=>{if(authMode==='unauthenticated')throw new MerchantEnterpriseAccessError('unauthorized',401);
              return {user:{id:authMode==='wrong-owner'?otherOwner:actor},authenticationMethods:['password']};},
              entitlement:async site=>{assert.equal(site,v.site);return {permissionConfig:{allowEnterpriseManagement:true,allowEmployeeAttendance:moduleEnabled}};}};
            const before=d.fingerprint(),response=await handlers[url.pathname](canonicalRequest(url.pathname+url.search),overrides),text=await response.text(),body=JSON.parse(text);
            assert.equal(d.fingerprint(),before);assert.equal(d.definitions(),definitions);assert.equal(response.headers.get('cache-control'),'private, no-store');
            const query=Object.fromEntries(url.searchParams);
            if(response.ok&&[shiftPath,planPath].includes(url.pathname)){
              assert(Buffer.byteLength(text,'utf8')<=1048576);assert(!text.includes('"sourceText"')&&!text.includes('"source_text"'),'private_source_bytes_leaked');
              if(url.pathname===shiftPath)parseShiftCheckAdoptionResponse(body,query,actor);else parsePlanCoverageAdoptionsResponse(body,query,actor);
            }
            requests.push({path:url.pathname,status:response.status,query,body});
            const gate=url.pathname!==sourcePath?hold:null;if(gate){hold=null;gate.ready.resolve(body);await gate.release.promise;}
            try{await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:text});}catch(error){if(!gate&&!closing)throw error;}
            finally{if(gate){gate.finished.resolve();gates.delete(gate);}}
          })();pending.add(work);void work.finally(()=>pending.delete(work)).catch(()=>{});
          return work.catch(async error=>{if(!closing)errors.push(error.message??'adoption_view_route_failed');await route.abort().catch(()=>{});});
        });
        const page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));page.on('download',()=>errors.push('unexpected_download'));page.on('popup',()=>errors.push('unexpected_popup'));
        page.on('dialog',dialog=>{errors.push('unexpected_dialog');void dialog.dismiss().catch(()=>{});});await page.goto(origin+(off?'/off':''));await parent(page).waitFor();
        try{await check(page,start);}catch(error){error.message=`${name}: ${error.message}; last=${JSON.stringify(requests.slice(-4).map(r=>({path:r.path,status:r.status,error:r.body?.error})))}`;throw error;}
        await quiet(page);assert.deepEqual(await page.evaluate(()=>window.__planAdoptionProbe),{csp:[],storageWrites:0});
        assert.deepEqual(await page.evaluate(()=>[sessionStorage.getItem('qa-unrelated'),localStorage.getItem('qa-unrelated')]),['preserve','preserve']);
        assert.equal(d.fingerprint(),baseline);assert.equal(d.definitions(),definitions);checks++;
      }finally{for(const gate of gates)gate.release.resolve();await context.close();}
    };
    await run('new defaultoff preserves two old existing owner reads with no new wrapper request',async(p,start)=>{
      await quiet(p,start);await parentRead(p);await quiet(p,start+1);await read(p,'shift',oldShiftPath);await read(p,'plan',oldPlanPath);await quiet(p,start+3);
      assert.equal(await refs(p,'shift').count(),0);assert.equal(await refs(p,'plan').count(),0);assert(requests.slice(start).every(r=>![shiftPath,planPath].includes(r.path)));
    },{off:true});
    await run('actual390px Sources parent explicitly reads wrappers once and shows four fixed channels plus legacy absence',async(p,start)=>{
      await quiet(p,start);await parentRead(p);await quiet(p,start+1);assert.equal(await choice(p,'shift').inputValue(),'');assert.equal(await choice(p,'plan').inputValue(),'');
      await choice(p,'shift').selectOption(v.startEventId);await quiet(p,start+1);const shift=await clickRead(p,'shift');await refs(p,'shift').waitFor();
      assert.equal(await refs(p,'shift').getAttribute('data-plan-adoption-status'),shift.data.adoption?.status??'missing');
      const plan=await read(p,'plan');assert.equal(plan.data.adoptions.length,5);assert.equal(plan.data.adoptions.filter(e=>e.adoption?.status==='adopted').length,4);
      assert.equal(plan.data.adoptions.filter(e=>e.adoption===null).length,1);assert.equal(await refs(p,'plan').count(),5);
      assert.deepEqual(await refs(p,'plan').evaluateAll(elements=>elements.map(e=>[e.getAttribute('data-plan-adoption-reference'),e.getAttribute('data-plan-adoption-status')])),
        plan.data.adoptions.map(e=>[e.startEventId,e.adoption?.status??'missing']));
      const adopted=panel(p,'plan').locator('[data-plan-adoption-status="adopted"]').first();await adopted.locator('summary').click();assert((await adopted.innerText()).includes(plan.data.adoptions.find(e=>e.adoption?.status==='adopted').adoption.approval.sourceSha256));
      assert((await panel(p,'plan').innerText()).includes('不是净工时'));assert((await panel(p,'plan').innerText()).includes('不等于当时没有核准'));
      assert.equal(await p.locator('img').count(),0);assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      for(const kind of ['shift','plan'])assert.equal(await panel(p,kind).evaluate(e=>e.scrollWidth<=e.clientWidth+1),true);
      moduleEnabled=false;await read(p,'plan');assert((await detail(p,'plan').innerText()).includes('暂停'));
      assert(requests.slice(start).every(r=>![oldShiftPath,oldPlanPath].includes(r.path)));
    },{width:390});
    await run('late headers/body and source API owner flag hide or unmount clear both old detail and fixed reference',async p=>{
      await control(p,'direct');let count=requests.length;await quiet(p,count);const gate=gateNext();await choice(p,'shift').selectOption(v.startEventId);await button(p,'shift').click();await bounded(gate.ready.promise);
      await choice(p,'shift').selectOption('');await cleared(p,'shift');gate.release.resolve();await bounded(gate.finished.promise);await quiet(p,requests.length);await cleared(p,'shift');
      await control(p,'arm-body');await choice(p,'shift').selectOption(v.startEventId);await button(p,'shift').click();await p.getByTestId('body-phase').filter({hasText:'held'}).waitFor();count=requests.length;
      await control(p,'api-change');await control(p,'release-body');await quiet(p,count);await cleared(p,'shift');
      for(const [kind,key,restore] of [['plan','source-change',null],['shift','hide','show'],['plan','pagehide','pageshow'],['plan','owner-change','owner-restore'],['shift','reference-off','reference-on'],['plan','unmount','mount']]){
        await read(p,kind);count=requests.length;await control(p,key);await cleared(p,kind);if(restore)await control(p,restore);await quiet(p,count);await cleared(p,kind);
      }
    });
    await run('401403 never fallback and parent date edit or close removes both added receipts',async p=>{
      await control(p,'direct');for(const [kind,mode,status] of [['shift','unauthenticated',401],['plan','wrong-owner',403]]){
        authMode='owner';await read(p,kind);authMode=mode;await button(p,kind).click();await panel(p,kind).getByRole('alert').waitFor();await cleared(p,kind);assert.equal(requests.at(-1).status,status);
      }
      authMode='owner';await control(p,'parent');await parentRead(p);await read(p,'shift');let count=requests.length;
      await parent(p).getByLabel('核查开始日期').fill('');await panel(p,'shift').waitFor({state:'detached'});await panel(p,'plan').waitFor({state:'detached'});await quiet(p,count);
      await parentRead(p);count=requests.length;await parent(p).getByRole('button',{name:'关闭资料核查',exact:true}).click();await p.getByTestId('closed').waitFor();await quiet(p,count);
    });
    assert.equal(checks,4);assert.deepEqual(errors,[]);assert(requests.length+seedReads<=25);assert.equal(d.fingerprint(),baseline);assert.equal(d.definitions(),definitions);
    return {checks,apiRequests:requests.length,seedReads,totalReads:requests.length+seedReads,actual128Parent:true,existingPages:true,
      wrapperReads:requests.filter(r=>[shiftPath,planPath].includes(r.path)).length,oldCompatibilityReads:requests.filter(r=>[oldShiftPath,oldPlanPath].includes(r.path)).length,
      syntheticAuth:true,realAuth:false,posts:0,storageWrites:0,externalRequests:0,sourceTextSentToBrowser:false,nodeCryptoBundled:false,readFingerprintsUnchanged:true,
      fourChannelsAndLegacyAbsence:true,referenceFlagSwitchFence:true,fullAdminE2E:false,newCluster:false,productionAccess:false};
  }finally{closing=true;for(const gate of gates)gate.release.resolve();await runAttendanceCleanupSteps([
    {name:'plan-adoption-view-browser',run:async()=>{await browser?.close();}},
    {name:'plan-adoption-view-interceptions',run:async()=>{await bounded(Promise.allSettled([...pending]));}},
    {name:'plan-adoption-view-loopback',run:async()=>{if(server.listening){server.closeAllConnections();await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}}},
  ]);}
}
