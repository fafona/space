// Actual128 SourcesPanel /156 child -> new compact handler/service -> existing135.
// Inert import. Root alone owns PG, Chromium and the loopback server lifecycle.
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
import {prepareShiftRuleViewNativeFixture} from './fixtures/attendance-shift-rule-view-native.mjs';
import {lifecycleId as id,lifecycleJson as json} from './merchant-attendance-lifecycle-native-support.mjs';
import {runAttendanceCleanupSteps} from './fixtures/attendance-cleanup.mjs';

const root=fileURLToPath(new URL('../',import.meta.url)),require=createRequire(import.meta.url),canonical='https://www.faolla.com';
const endpoint='/api/merchant-enterprise/attendance/shift-rule-binding-view',sourcesPath='/api/merchant-enterprise/attendance/sources';
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
async function bounded(promise){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('shift_rule_view_browser_timeout')),15000);})]);}finally{clearTimeout(timer);}}
export function assertCompactShiftRuleBrowserData(value){
  if(!value||typeof value!=='object')return;
  for(const [key,child] of Object.entries(value)){
    assert(!['sourceText','sourceGraph','history'].includes(key),`compact_view_leaked_${key}`);
    assertCompactShiftRuleBrowserData(child);
  }
}
async function assets(){
  const options={absWorkingDir:root,entryPoints:['scripts/fixtures/attendance-shift-rule-view-browser.tsx'],bundle:true,write:false,metafile:true,
    platform:'browser',format:'esm',target:['es2020'],jsx:'automatic',tsconfig:path.join(root,'tsconfig.json'),outfile:'qa.js',logLevel:'warning'};
  const bundle=await build({...options,define:{'process.env':'{}','process.env.NODE_ENV':'"development"',
    'process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_SHIFT_RULE_BINDING_READ_ENABLED':'"1"'}});
  const off=await build({...options,define:{'process.env':'{}','process.env.NODE_ENV':'"development"'}});
  for(const graph of [bundle,off])for(const file of Object.keys(graph.metafile.inputs)){
    assert(!/node:crypto|merchantAttendanceShiftRuleBinding(?:\.server)?\.ts$|\.server\.ts$/.test(file),'browser_imported_server_validation');
  }
  const candidates=new Set();
  for(const filename of Object.keys(bundle.metafile.inputs).filter(name=>/\.tsx?$/.test(name)&&!name.includes('node_modules'))){
    const ast=ts.createSourceFile(filename,await readFile(path.join(root,filename),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
    const visit=node=>{if(ts.isStringLiteral(node)||ts.isNoSubstitutionTemplateLiteral(node)||ts.isTemplateHead(node)||ts.isTemplateMiddle(node)||ts.isTemplateTail(node))
      node.text.split(/\s+/).filter(Boolean).forEach(candidate=>candidates.add(candidate));ts.forEachChild(node,visit);};visit(ast);
  }
  const css=(await compile('@import "tailwindcss";',{base:root,onDependency:()=>{}})).build([...candidates])
    +'body{margin:0;background:#f1f5f9;font-family:Arial,sans-serif}.qa-toolbar{padding:12px;background:#fff7ed;font-size:13px;overflow-wrap:anywhere}.qa-controls{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}.qa-controls button{max-width:100%;background:white;border:1px solid #94a3b8;padding:6px}.qa-main{max-width:1100px;margin:auto;padding:12px;min-width:0}';
  return {javascript:bundle.outputFiles.find(file=>file.path.endsWith('.js')).contents,off:off.outputFiles.find(file=>file.path.endsWith('.js')).contents,css};
}

export async function checkAttendanceShiftRuleViewBrowser(native,scope,options={}){
  assert(options.captureScreenshot===undefined||typeof options.captureScreenshot==='function');
  const parent=await readFile(path.join(root,'src/components/enterprise/MerchantAttendanceSourcesPanel.tsx'),'utf8');
  assert.match(parent,/<ShiftRuleReview source=\{r\} ownerId=\{ownerId\} apiFetch=\{apiFetch\}\/>/);
  const data=await prepareShiftRuleViewNativeFixture(native,scope),files=await assets(),baseline=data.fingerprint(),definitions=data.definitions();
  const {handleShiftRuleView}=require('../src/app/api/merchant-enterprise/attendance/shift-rule-binding-view/route-handler.ts');
  const {executeShiftRuleView}=require('../src/lib/merchantAttendanceShiftRuleView.server.ts');
  const {parseShiftRuleViewResponse}=require('../src/lib/merchantAttendanceShiftRuleView.ts');
  const {handleSources}=require('../src/app/api/merchant-enterprise/attendance/sources/route-handler.ts');
  const {executeSources}=require('../src/lib/merchantAttendanceSources.server.ts');
  const {MerchantEnterpriseAccessError}=require('../src/lib/merchantEnterpriseAuth.server.ts');
  const requests=[],errors=[],pending=new Set(),gates=new Set();let browser,origin,closing=false,hold=null,moduleEnabled=true,authMode='owner',checks=0,detailReads=0,parentReads=0;
  const service={rpc:async(name,args)=>{
    assert.deepEqual(Object.keys(args).sort(),['p_auth_user_id','p_query']);assert([data.owner,id(98)].includes(args.p_auth_user_id));
    const before=data.fingerprint();try{
      if(name==='faolla_attendance_sources_v1'){parentReads++;return {data:data.readRaw(args.p_query,args.p_auth_user_id),error:null};}
      assert.equal(name,'faolla_attendance_shift_rule_binding_v1');detailReads++;
      assert(Object.values(data.anchors).includes(args.p_query.startEventId));
      return {data:JSON.parse(data.exec(`set local role service_role;select public.faolla_attendance_shift_rule_binding_v1(${json(args.p_query)},'${args.p_auth_user_id}');`)),error:null};
    }catch(error){const code=String(error).match(/ERROR:\s+(attendance_[a-z_]+)/)?.[1];if(!code)throw error;return {data:null,error:{message:code}};}
    finally{assert.equal(data.fingerprint(),before,'view_browser_read_changed_facts');assert.equal(data.definitions(),definitions);}
  }};
  const dependencies=(actor,isSource)=>({enabled:()=>true,authenticate:async()=>{
    if(authMode==='unauthenticated')throw new MerchantEnterpriseAccessError('unauthorized',401);
    return {user:{id:authMode==='wrong-owner'?id(98):actor},authenticationMethods:['password']};},allow:()=>true,
    entitlement:async site=>{assert.equal(site,data.site);return {permissionConfig:{allowEnterpriseManagement:true,allowEmployeeAttendance:moduleEnabled}};},
    execute:input=>isSource?executeSources(input,service):executeShiftRuleView(input,service)});
  const server=createServer((request,response)=>{
    if(!origin||request.headers.host!==new URL(origin).host||request.method!=='GET')return response.writeHead(403).end();
    response.setHeader('Cache-Control','no-store');response.setHeader('X-Content-Type-Options','nosniff');
    response.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'");
    const url=new URL(request.url??'/',origin);if(url.search)return response.writeHead(403).end();
    if(url.pathname==='/'||url.pathname==='/off')return response.writeHead(200,{'Content-Type':'text/html;charset=utf-8'}).end(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>隔离原班次依据验收</title><link rel="stylesheet" href="/qa.css"><div id="qa-root"></div><script type="module" src="/${url.pathname==='/off'?'qa-off':'qa'}.js"></script></html>`);
    if(url.pathname==='/qa.js'||url.pathname==='/qa-off.js')return response.writeHead(200,{'Content-Type':'text/javascript;charset=utf-8'}).end(url.pathname==='/qa.js'?files.javascript:files.off);
    if(url.pathname==='/qa.css')return response.writeHead(200,{'Content-Type':'text/css;charset=utf-8'}).end(files.css);return response.writeHead(403).end();
  });
  const gateNext=()=>{assert.equal(hold,null);const gate={ready:deferred(),release:deferred(),finished:deferred()};hold=gate;gates.add(gate);return gate;};
  const panel=page=>page.getByRole('region',{name:'原班次固定规则依据',exact:true});
  const detail=page=>panel(page).locator('[data-shift-rule-detail]');
  const selection=page=>panel(page).getByLabel('选择原始班次',{exact:true});
  const readButton=page=>panel(page).getByRole('button',{name:'读取原班次依据',exact:true});
  const choose=(page,status)=>selection(page).selectOption(data.anchors[status]);
  const read=async(page,status)=>{await choose(page,status);await readButton(page).click();await panel(page).locator(`[data-shift-rule-detail][data-shift-rule-status="${status}"]`).waitFor();};
  const clear=page=>detail(page).waitFor({state:'detached'});
  const control=(page,key)=>page.getByTestId(key).click();
  const quiet=async(page,count)=>{await page.waitForLoadState('networkidle');await bounded(Promise.all([...pending]));assert.equal(requests.length,count,'automatic_shift_rule_request');};
  const failed=async page=>{await page.waitForLoadState('networkidle');await panel(page).getByRole('status').filter({hasText:/未能|无法|失败|隐藏|重新/}).waitFor();await clear(page);};
  try{
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const address=server.address();assert(address&&typeof address==='object');origin=`http://127.0.0.1:${address.port}`;
    browser=await chromium.launch({headless:true});
    const run=async(name,check,width=1280,flagOffRun=false)=>{
      moduleEnabled=true;authMode='owner';const context=await browser.newContext({serviceWorkers:'block',acceptDownloads:false,viewport:{width,height:1050}});
      try{
        await context.addInitScript(seed=>{
          Object.defineProperty(window,'__shiftRuleSeed',{value:seed});sessionStorage.setItem('qa-unrelated','preserve');localStorage.setItem('qa-unrelated','preserve');
          const probe={csp:[],storageWrites:0};Object.defineProperty(window,'__shiftRuleBrowserProbe',{value:probe});
          for(const method of ['setItem','removeItem','clear']){const original=Storage.prototype[method];Storage.prototype[method]=function(...args){probe.storageWrites++;return original.apply(this,args);};}
          document.addEventListener('securitypolicyviolation',event=>probe.csp.push(event.violatedDirective));
        },{source:data.source,emptySource:data.emptySource,owner:data.owner,otherOwner:id(98),flagOffRun});
        await context.route('**/*',route=>{
          if(closing)return route.abort().catch(()=>{});
          const work=(async()=>{
            const request=route.request(),url=new URL(request.url());assert.equal(url.origin,origin,'external_request_blocked');assert.equal(request.method(),'GET','view_must_not_write');
            if(['/', '/off','/qa.js','/qa-off.js','/qa.css'].includes(url.pathname)){assert.equal(url.search,'');return route.continue();}
            assert([endpoint,sourcesPath].includes(url.pathname));assert.equal(request.postData(),null);assert(requests.length<40,'view_browser_request_budget');
            const actor=request.headers()['x-qa-owner'];assert([data.owner,id(98)].includes(actor));
            const sourceRequest=url.pathname===sourcesPath,handler=sourceRequest?handleSources:handleShiftRuleView;
            const response=await handler(new Request(canonical+url.pathname+url.search,{headers:{Host:'www.faolla.com',Origin:canonical}}),dependencies(actor,sourceRequest));
            const body=await response.text(),parsed=JSON.parse(body);assert.equal(response.headers.get('Cache-Control'),'private, no-store');
            if(!sourceRequest&&response.ok){assertCompactShiftRuleBrowserData(parsed);parseShiftRuleViewResponse(parsed,Object.fromEntries(url.searchParams),actor);assert(Buffer.byteLength(body,'utf8')<=32768);}
            requests.push({path:url.pathname,query:Object.fromEntries(url.searchParams),status:response.status,body:parsed});
            const gate=!sourceRequest?hold:null;if(gate){hold=null;gate.ready.resolve(parsed);await gate.release.promise;}
            try{await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body});}catch(error){if(!gate&&!closing)throw error;}
            finally{if(gate){gate.finished.resolve();gates.delete(gate);}}
          })();pending.add(work);void work.finally(()=>pending.delete(work)).catch(()=>{});
          return work.catch(async error=>{if(!closing)errors.push(error instanceof Error?error.message:'view_route_failed');await route.abort().catch(()=>{});});
        });
        const page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',error=>errors.push(error.message));page.on('download',()=>errors.push('unexpected_download'));page.on('popup',()=>errors.push('unexpected_popup'));
        page.on('dialog',dialog=>{errors.push('unexpected_dialog');void dialog.dismiss().catch(()=>{});});
        await page.goto(origin+(flagOffRun?'/off':''));await page.getByTestId('enable').waitFor();
        try{await check(page);}catch(error){error.message=`${name}: ${error.message}`;throw error;}
        assert.deepEqual(await page.evaluate(()=>window.__shiftRuleBrowserProbe),{csp:[],storageWrites:0});
        assert.deepEqual(await page.evaluate(()=>[sessionStorage.getItem('qa-unrelated'),localStorage.getItem('qa-unrelated')]),['preserve','preserve']);
        assert.equal(data.fingerprint(),baseline);assert.equal(data.definitions(),definitions);checks++;native.pass(name);
      }finally{for(const gate of gates)gate.release.resolve();await context.close();}
    };
    await run('view actual defaultoff has no child or detail request; explicit enable and select still do not auto-read',async page=>{
      assert.equal(await panel(page).count(),0);await quiet(page,0);await control(page,'enable');await panel(page).waitFor();await quiet(page,0);
      assert.equal(await selection(page).inputValue(),'');assert.equal(await selection(page).locator('option').count(),4);await choose(page,'verified');await quiet(page,0);assert.equal(await detail(page).count(),0);
    },1280,true);
    await run('view390px distinguishes actual missing verified unverified with compact provenance and no original source body',async page=>{
      await control(page,'enable');await read(page,'missing');assert((await detail(page).innerText()).includes('未'));
      await read(page,'verified');const verified=requests.at(-1);assert.equal(verified.query.startEventId,data.anchors.verified);assert.equal(verified.body.data.status,'verified');
      const text=await detail(page).innerText();assert(text.includes('0'));assert(text.includes('停用'));assert(text.includes('个人'));assert(text.includes('企业'));
      await detail(page).getByText('核对完整三层来源',{exact:true}).first().click();
      const traceText=await detail(page).locator('[data-shift-rule-field="lateGraceMinutes"]').innerText();
      for(const trace of verified.body.data.evidence.fields.lateGraceMinutes.trace)if(trace.source)assert(traceText.includes(trace.source.operationId));
      await detail(page).getByText('核对服务端验证的来源摘要',{exact:true}).click();assert((await detail(page).innerText()).includes(verified.body.data.evidence.sourceSha256));
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.equal(await panel(page).evaluate(element=>element.scrollWidth<=element.clientWidth+1),true);
      assert.equal(await page.locator('img,script[src="x"]').count(),0);if(options.captureScreenshot)await options.captureScreenshot(await page.screenshot({fullPage:true}));
      await read(page,'unverified');assert.equal(requests.at(-1).body.data.reason,'inactive_group');assert.equal(await detail(page).getAttribute('data-shift-rule-status'),'unverified');
      assert((await detail(page).innerText()).includes('当时考勤组已停用'));
      moduleEnabled=false;await read(page,'verified');assert.equal(requests.at(-1).body.moduleEnabled,false);assert((await panel(page).innerText()).includes('暂停'));
    },390);
    await run('view latest selected original anchor wins even when earlier real response is released late',async page=>{
      await control(page,'enable');const gate=gateNext();await choose(page,'verified');await readButton(page).click();await bounded(gate.ready.promise);
      await choose(page,'missing');await clear(page);await readButton(page).click();await panel(page).locator('[data-shift-rule-status="missing"]').waitFor();
      gate.release.resolve();await bounded(gate.finished.promise);await quiet(page,requests.length);assert.equal(await detail(page).getAttribute('data-shift-rule-status'),'missing');
    });
    await run('view source worker owner and apiFetch changes synchronously discard details and do not automatically request',async page=>{
      await control(page,'enable');await read(page,'verified');let count=requests.length;await control(page,'source-change');await clear(page);await quiet(page,count);assert.equal(await selection(page).inputValue(),'');
      await read(page,'verified');count=requests.length;await control(page,'api-change');await clear(page);await quiet(page,count);assert.equal(await selection(page).inputValue(),'');
      await read(page,'verified');count=requests.length;await control(page,'worker-change');await clear(page);await quiet(page,count);assert.equal(await selection(page).locator('option').count(),1);
      await control(page,'worker-restore');await read(page,'verified');count=requests.length;await control(page,'owner-change');await clear(page);await quiet(page,count);
      await control(page,'owner-restore');await quiet(page,count);await control(page,'epoch');await quiet(page,count);await clear(page);
    });
    await run('view late transport and body cannot resurrect hidden pagehide unmounted or changed-api details',async page=>{
      await control(page,'enable');const gate=gateNext();await choose(page,'verified');await readButton(page).click();await bounded(gate.ready.promise);await control(page,'hide');await clear(page);
      gate.release.resolve();await bounded(gate.finished.promise);await control(page,'show');await quiet(page,requests.length);await clear(page);
      await control(page,'arm-body');await choose(page,'verified');await readButton(page).click();await page.getByTestId('body-phase').filter({hasText:'held'}).waitFor();const count=requests.length;
      await control(page,'api-change');await control(page,'release-body');await quiet(page,count);await clear(page);
      await read(page,'verified');await control(page,'pagehide');await clear(page);await control(page,'pageshow');await quiet(page,requests.length);
      const late=gateNext();await choose(page,'verified');await readButton(page).click();await bounded(late.ready.promise);await control(page,'unmount');late.release.resolve();await bounded(late.finished.promise);
      await control(page,'mount');await quiet(page,requests.length);await clear(page);
    });
    await run('view401 and current-owner403 remove previous details without retry or writes',async page=>{
      await control(page,'enable');await read(page,'verified');authMode='unauthenticated';await readButton(page).click();await failed(page);assert.equal(requests.at(-1).status,401);
      authMode='owner';await read(page,'verified');authMode='wrong-owner';await readButton(page).click();await failed(page);assert.equal(requests.at(-1).status,403);
    });
    await run('actual128 parent renders new child only after explicit read; date edit and parent close clear it without extra details',async page=>{
      await control(page,'parent');const parent=page.getByRole('region',{name:'单员工资料核查',exact:true});await parent.waitFor();const before=requests.length;
      assert.equal(await panel(page).count(),0);await quiet(page,before);
      await parent.getByLabel('核查开始日期').fill(data.query.fromDate);await parent.getByLabel('核查结束日期').fill(data.query.throughDate);
      await parent.getByRole('button',{name:'读取核查资料',exact:true}).click();await panel(page).waitFor();assert.equal(requests.at(-1).path,sourcesPath);await quiet(page,before+1);
      assert((await parent.innerText()).includes('Current group <img src=x onerror=alert(1)>'));assert.equal(await page.locator('img').count(),0);
      await read(page,'verified');const count=requests.length;await parent.getByLabel('核查开始日期').fill('');await panel(page).waitFor({state:'detached'});await quiet(page,count);
      await parent.getByLabel('核查开始日期').fill(data.query.fromDate);await parent.getByRole('button',{name:'读取核查资料',exact:true}).click();await panel(page).waitFor();await read(page,'missing');
      await parent.getByRole('button',{name:'关闭资料核查',exact:true}).click();await panel(page).waitFor({state:'detached'});await quiet(page,requests.length);
      assert.equal(await page.getByTestId('closed').count(),1);
    });
    assert.equal(checks,7);assert.deepEqual(errors,[]);assert.equal(data.fingerprint(),baseline);assert.equal(data.definitions(),definitions);assert.deepEqual(data.counts(),{events:6,bindings:2,sources:1});
    return {checks,apiRequests:requests.length,detailReads,parentReads,...data.counts(),actual128Parent:true,actualCompactHandlerService135:true,actualSelfClockCalls:6,
      originalVsSelectedCorrectionBrowserTested:false,fullAdminE2E:false,realAuth:false,syntheticOnly:true,posts:0,storageWrites:0,externalRequests:0,
      sourceTextSentToBrowser:false,serverCryptoBundled:false,allFactsAndDefinitionsUnchanged:true,newCluster:false,productionAccess:false,callerOwnedNamespaceCleanup:true};
  }finally{
    closing=true;for(const gate of gates)gate.release.resolve();
    await runAttendanceCleanupSteps([
      {name:'shift-rule-view-browser',run:async()=>{await browser?.close();}},
      {name:'shift-rule-view-interceptions',run:async()=>{await bounded(Promise.allSettled([...pending]));}},
      {name:'shift-rule-view-loopback',run:async()=>{if(server.listening){server.closeAllConnections();await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}}},
    ]);
  }
}
