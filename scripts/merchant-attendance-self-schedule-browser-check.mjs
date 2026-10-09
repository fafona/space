// Same owned DB namespace as160 native. Import is inert; root alone invokes
// this bounded in-memory bundle / loopback / Chromium lifecycle.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {build} from 'esbuild';
import {compile} from '@tailwindcss/node';
import ts from 'typescript';
import {chromium} from 'playwright';
import {runAttendanceCleanupSteps} from './fixtures/attendance-cleanup.mjs';

const root=fileURLToPath(new URL('../',import.meta.url)),canonical='https://www.faolla.com';
const endpoint='/api/merchant-enterprise/attendance/self-schedule',oldEndpoint='/api/merchant-enterprise/attendance/self';
async function bounded(promise){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('self_schedule_browser_timeout')),15000);})]);}finally{clearTimeout(timer);}}
async function assets(){
  const base={absWorkingDir:root,entryPoints:['scripts/fixtures/attendance-self-schedule-browser.tsx'],bundle:true,write:false,metafile:true,
    platform:'browser',format:'esm',target:['es2020'],jsx:'automatic',tsconfig:path.join(root,'tsconfig.json'),outfile:'qa.js',logLevel:'warning'};
  const enabled=await build({...base,define:{'process.env':'{}','process.env.NODE_ENV':'"development"','process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_SELF_SCHEDULE_ENABLED':'"1"'}});
  const disabled=await build({...base,define:{'process.env':'{}','process.env.NODE_ENV':'"development"'}});
  for(const bundle of [enabled,disabled])for(const file of Object.keys(bundle.metafile.inputs))assert(!/node:crypto|\.server\.ts$/.test(file),'self_schedule_browser_imported_server');
  const candidates=new Set();
  for(const filename of Object.keys(enabled.metafile.inputs).filter(name=>/\.tsx?$/.test(name)&&!name.includes('node_modules'))){
    const ast=ts.createSourceFile(filename,await readFile(path.join(root,filename),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
    const visit=node=>{if(ts.isStringLiteral(node)||ts.isNoSubstitutionTemplateLiteral(node)||ts.isTemplateHead(node)||ts.isTemplateMiddle(node)||ts.isTemplateTail(node))node.text.split(/\s+/).filter(Boolean).forEach(v=>candidates.add(v));ts.forEachChild(node,visit);};visit(ast);
  }
  const css=(await compile('@import "tailwindcss";',{base:root,onDependency:()=>{}})).build([...candidates])
    +'body{margin:0;background:#f1f5f9;font-family:Arial,sans-serif}.qa-toolbar{padding:12px;background:#fff7ed;font-size:13px;overflow-wrap:anywhere}.qa-main{max-width:1050px;margin:auto;padding:12px;min-width:0}';
  return {on:enabled.outputFiles.find(f=>f.path.endsWith('.js')).contents,off:disabled.outputFiles.find(f=>f.path.endsWith('.js')).contents,css};
}

export async function checkAttendanceSelfScheduleBrowser(native,scope,d,options={}){
  assert(scope&&scope.schema===d.owned.schema);assert(options.captureScreenshot===undefined||typeof options.captureScreenshot==='function');
  const files=await assets(),before=d.counts(),definitions=d.definitions(),pendingKey=`faolla:attendance:self-schedule:v1:${d.site}:${d.employee}`;
  const protectedTables=d.inventory().filter(t=>!['merchant_attendance_events','merchant_attendance_shift_schedule_relations'].includes(t)),protectedBefore=d.fingerprint(protectedTables);
  const requests=[],errors=[],pending=new Set();let browser,origin,closing=false,featureEnabled=true,dropNext=null,checks=0;
  const server=createServer((request,response)=>{
    if(!origin||request.headers.host!==new URL(origin).host||request.method!=='GET')return response.writeHead(403).end();
    response.setHeader('Cache-Control','no-store');response.setHeader('X-Content-Type-Options','nosniff');
    response.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'");
    const url=new URL(request.url??'/',origin);if(url.search)return response.writeHead(403).end();
    if(url.pathname==='/'||url.pathname==='/off')return response.writeHead(200,{'Content-Type':'text/html;charset=utf-8'}).end(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>隔离本人选班验收</title><link rel="stylesheet" href="/qa.css"><div id="qa-root"></div><script type="module" src="/${url.pathname==='/off'?'qa-off':'qa'}.js"></script></html>`);
    if(url.pathname==='/qa.js'||url.pathname==='/qa-off.js')return response.writeHead(200,{'Content-Type':'text/javascript;charset=utf-8'}).end(url.pathname==='/qa.js'?files.on:files.off);
    if(url.pathname==='/qa.css')return response.writeHead(200,{'Content-Type':'text/css;charset=utf-8'}).end(files.css);return response.writeHead(403).end();
  });
  const parent=page=>page.getByRole('region',{name:'我的考勤',exact:true});
  const section=page=>page.getByRole('region',{name:'本次排班与上班打卡',exact:true});
  const choice=page=>section(page).getByLabel('本次排班',{exact:true});
  const association=(page,status)=>section(page).locator(`[data-self-schedule-association="${status}"]`);
  const postCount=()=>requests.filter(r=>r.method==='POST').length;
  const newPosts=()=>requests.filter(r=>r.method==='POST'&&r.path===endpoint);
  const waitReady=async page=>{await choice(page).waitFor();await page.waitForFunction(()=>{const select=document.querySelector('[data-self-schedule-clock] select');return select instanceof HTMLSelectElement&&!select.disabled;});};
  const quiet=async page=>{await page.waitForLoadState('networkidle');await bounded(Promise.all([...pending]));};
  const endShift=async page=>{const out=parent(page).getByRole('button',{name:'下班打卡',exact:true});await out.waitFor();await out.click();
    await parent(page).getByRole('button',{name:'刷新状态',exact:true}).waitFor();await out.waitFor({state:'detached'});await quiet(page);assert.equal((await d.request()).body.clock.state.status,'off');};
  const savedPending=page=>page.evaluate(key=>{const value=sessionStorage.getItem(key);return value===null?null:JSON.parse(value);},pendingKey);
  const noNewPost=async(page,count)=>{await quiet(page);assert.equal(postCount(),count,'unexpected_automatic_POST');};
  try{
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const address=server.address();assert(address&&typeof address==='object');origin=`http://127.0.0.1:${address.port}`;
    browser=await chromium.launch({headless:true});
    const run=async(name,check,{width=1280,off=false}={})=>{
      featureEnabled=true;dropNext=null;const context=await browser.newContext({serviceWorkers:'block',acceptDownloads:false,viewport:{width,height:1050}});
      try{
        await context.addInitScript(seed=>{
          Object.defineProperty(window,'__selfScheduleSeed',{value:seed});
          if(sessionStorage.getItem('qa-unrelated')===null)sessionStorage.setItem('qa-unrelated','preserve');
          if(localStorage.getItem('qa-unrelated')===null)localStorage.setItem('qa-unrelated','preserve');
          const probe={csp:[],unexpectedStorage:[]};Object.defineProperty(window,'__selfScheduleBrowserProbe',{value:probe});
          for(const method of ['setItem','removeItem','clear']){const original=Storage.prototype[method];Storage.prototype[method]=function(...args){
            if(this!==sessionStorage||method==='clear'||typeof args[0]!=='string'||!args[0].startsWith('faolla:attendance:self'))probe.unexpectedStorage.push(method+':'+String(args[0]));
            return original.apply(this,args);};}
          document.addEventListener('securitypolicyviolation',event=>probe.csp.push(event.violatedDirective));
        },{siteId:d.site,employeeId:d.employee});
        await context.route('**/*',route=>{
          if(closing)return route.abort().catch(()=>{});
          const work=(async()=>{
            const request=route.request(),url=new URL(request.url());assert.equal(url.origin,origin,'self_schedule_external_request');
            if(['/', '/off','/qa.js','/qa-off.js','/qa.css'].includes(url.pathname)){assert.equal(request.method(),'GET');assert.equal(url.search,'');return route.continue();}
            assert([endpoint,oldEndpoint].includes(url.pathname));assert(['GET','POST'].includes(request.method()));assert(requests.length<90,'self_schedule_browser_request_budget');
            const body=request.method()==='POST'?JSON.parse(request.postData()??'null'):null;
            const record={path:url.pathname,method:request.method(),query:Object.fromEntries(url.searchParams),body,status:null,delivered:true};requests.push(record);
            // This one explicit undelivered attempt exercises unknown outcome;
            // no fake SQL result or successful response is manufactured.
            const drop=url.pathname===endpoint&&request.method()==='POST'?dropNext:null;if(drop)dropNext=null;
            if(drop==='before'){record.delivered=false;record.status='transport-abort-before-handler';return route.abort('failed');}
            const response=await (url.pathname===endpoint?d.handle:d.handleOld)(new Request(canonical+url.pathname+url.search,{method:request.method(),
              headers:{host:'www.faolla.com',origin:canonical,'sec-fetch-site':'same-origin',...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})}),
              url.pathname===endpoint?{featureEnabled:()=>featureEnabled}:{});
            record.status=response.status;const text=await response.text();record.response=JSON.parse(text);
            assert.equal(response.headers.get('cache-control'),'private, no-store');
            if(drop==='after'){assert.equal(response.status,200);record.delivered=false;return route.abort('failed');}
            await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:text});
          })();pending.add(work);void work.finally(()=>pending.delete(work)).catch(()=>{});
          return work.catch(async error=>{if(!closing)errors.push(error instanceof Error?error.message:'self_schedule_route_failed');await route.abort().catch(()=>{});});
        });
        const page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',error=>errors.push(error.message));page.on('download',()=>errors.push('unexpected_download'));page.on('popup',()=>errors.push('unexpected_popup'));
        page.on('dialog',dialog=>{if(dialog.type()==='beforeunload')void dialog.accept().catch(()=>{});else{errors.push('unexpected_dialog');void dialog.dismiss().catch(()=>{});}});
        await page.goto(origin+(off?'/off':''));await parent(page).waitFor();
        try{await check(page);}catch(error){error.message=`${name}: ${error.message}`;throw error;}
        await quiet(page);assert.deepEqual(await page.evaluate(()=>window.__selfScheduleBrowserProbe),{csp:[],unexpectedStorage:[]});
        assert.deepEqual(await page.evaluate(()=>[sessionStorage.getItem('qa-unrelated'),localStorage.getItem('qa-unrelated')]),['preserve','preserve']);
        assert.equal(d.fingerprint(protectedTables),protectedBefore);assert.equal(d.definitions(),definitions);checks++;native.pass(name);
      }finally{await context.close();}
    };
    await run('self-schedule frontend defaultoff keeps old self only and never queries new selection endpoint',async page=>{
      await parent(page).getByRole('button',{name:'上班打卡',exact:true}).waitFor();await quiet(page);
      assert.equal(await section(page).count(),0);assert.equal(requests.filter(r=>r.path===endpoint).length,0);assert.equal(postCount(),0);
    },{off:true});
    await run('actual390px parent requires explicit none or slot and saves both through new handler SQL without auto-selection',async page=>{
      await waitReady(page);assert.equal(await choice(page).inputValue(),'');const beforePosts=postCount();await noNewPost(page,beforePosts);
      assert.equal(await section(page).getByRole('button',{name:'上班打卡 · 请先明确选择',exact:true}).isDisabled(),true);
      await choice(page).selectOption('none');await noNewPost(page,beforePosts);
      await section(page).getByRole('button',{name:'上班打卡 · 不关联排班',exact:true}).click();await association(page,'unselected').waitFor();
      assert.equal(newPosts().at(-1).body.selection,null);assert.equal(newPosts().at(-1).response.association.status,'unselected');await endShift(page);
      await section(page).getByRole('button',{name:'核对选班与打卡结果',exact:true}).click();await waitReady(page);assert.equal(await choice(page).inputValue(),'');
      await choice(page).selectOption(d.slots.browser.id);const posts=postCount();await noNewPost(page,posts);
      await section(page).getByRole('button',{name:'上班打卡 · 已选排班',exact:true}).click();await association(page,'linked').waitFor();
      assert.deepEqual(newPosts().at(-1).body.selection,d.selected(d.slots.browser));
      const linked=newPosts().at(-1).response;await association(page,'linked').getByText('核对原始选择与编号',{exact:true}).click();
      assert((await association(page,'linked').innerText()).includes(linked.clock.receipt.id));assert((await section(page).innerText()).includes('<img src=x>'));
      assert.equal(await page.locator('img').count(),0);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      assert.equal(await section(page).evaluate(element=>element.scrollWidth<=element.clientWidth+1),true);
      if(options.captureScreenshot)await options.captureScreenshot(await page.screenshot({fullPage:true}));await endShift(page);
    },{width:390});
    await run('committed selected POST lost response reloads original-ID GET and clears pending without another POST',async page=>{
      await waitReady(page);await choice(page).selectOption(d.slots.browser.id);dropNext='after';const beforePosts=postCount(),beforeEvents=d.counts().events;
      await section(page).getByRole('button',{name:'上班打卡 · 已选排班',exact:true}).click();
      await section(page).getByRole('status').filter({hasText:'未能可靠核对'}).waitFor();const saved=await savedPending(page);
      assert(saved);assert.equal(saved.version,1);assert.deepEqual(saved.selection,d.selected(d.slots.browser));assert.equal(d.counts().events,beforeEvents+1);
      assert.equal(newPosts().at(-1).body.command.operationId,saved.command.operationId);assert.equal(newPosts().at(-1).response.association.status,'linked');
      const beforeReload=requests.length;await page.reload();await association(page,'linked').waitFor();await noNewPost(page,beforePosts+1);
      assert.equal(await savedPending(page),null);assert(requests.slice(beforeReload).some(r=>r.path===endpoint&&r.method==='GET'&&r.query.operationId===saved.command.operationId));
      assert.equal(newPosts().filter(r=>r.body.command.operationId===saved.command.operationId).length,1);assert.equal(d.counts().events,beforeEvents+1);await endShift(page);
    });
    await run('flag rollback preserves undelivered original intent with GET only and no old clock-in fallback before explicit same-ID retry',async page=>{
      await waitReady(page);await choice(page).selectOption(d.slots.alternate.id);dropNext='before';const beforeEvents=d.counts().events;
      await section(page).getByRole('button',{name:'上班打卡 · 已选排班',exact:true}).click();await section(page).getByRole('status').filter({hasText:'未能可靠核对'}).waitFor();
      const saved=await savedPending(page);assert(saved);assert.equal(d.counts().events,beforeEvents);const posts=postCount(),changeAt=requests.length;
      featureEnabled=false;await page.goto(origin+'/off');await section(page).getByText(`原操作编号：${saved.command.operationId}`,{exact:true}).waitFor();
      await section(page).getByRole('status').filter({hasText:'暂未查到原号收据'}).waitFor();await noNewPost(page,posts);
      assert.deepEqual(await savedPending(page),saved);assert.equal(await section(page).getByRole('button',{name:'用原编号重试选班上班',exact:true}).isDisabled(),true);
      assert.equal(await parent(page).getByRole('button',{name:'上班打卡',exact:true}).isDisabled(),true);
      assert(requests.slice(changeAt).some(r=>r.path===endpoint&&r.method==='GET'&&r.query.operationId===saved.command.operationId));assert(requests.slice(changeAt).every(r=>r.method==='GET'));
      featureEnabled=true;await page.goto(origin+'/');await section(page).getByRole('status').filter({hasText:'暂未查到原号收据'}).waitFor();const retryAt=requests.length;
      await section(page).getByRole('button',{name:'用原编号重试选班上班',exact:true}).click();await association(page,'linked').waitFor();await quiet(page);
      const retry=requests.slice(retryAt).filter(r=>r.path===endpoint);assert.equal(retry[0].method,'GET');assert.equal(retry[0].query.operationId,saved.command.operationId);
      assert.equal(retry.filter(r=>r.method==='POST').length,1);assert.deepEqual(retry.find(r=>r.method==='POST').body,{siteId:d.site,command:saved.command,selection:saved.selection});
      assert.equal(await savedPending(page),null);assert.equal(d.counts().events,beforeEvents+1);await endShift(page);
    });
    assert.equal(checks,4);assert.deepEqual(errors,[]);assert.equal(requests.filter(r=>r.method==='POST'&&r.path===oldEndpoint&&r.body.action==='clock_in').length,0);
    const final=d.counts();assert.deepEqual(final,{...before,events:before.events+8,relations:before.relations+4});
    assert.equal(d.fingerprint(protectedTables),protectedBefore);assert.equal(d.definitions(),definitions);
    return {checks,apiRequests:requests.length,newPostAttempts:newPosts().length,actualNewClockIns:4,oldClockOuts:4,eventsAdded:8,relationsAdded:4,
      before,final,actualParentHandlerServiceSql:true,syntheticAuth:true,realAuth:false,externalRequests:0,otherStorageWrites:0,
      sessionPendingRecovery:true,committedResponseLoss:true,undeliveredFlagRollback:true,serverModulesBundled:false,newCluster:false,productionAccess:false};
  }finally{
    closing=true;await runAttendanceCleanupSteps([
      {name:'self-schedule-browser',run:async()=>{await browser?.close();}},
      {name:'self-schedule-interceptions',run:async()=>{await bounded(Promise.allSettled([...pending]));}},
      {name:'self-schedule-loopback',run:async()=>{if(server.listening){server.closeAllConnections();await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}}},
    ]);
  }
}
