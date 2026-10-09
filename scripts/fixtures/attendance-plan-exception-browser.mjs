// Inert174 definition. Root supplies the existing owned SQL fixture and alone
// invokes this callback. No DB startup, output bundle files or full app build.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {build} from 'esbuild';
import {compile} from '@tailwindcss/node';
import ts from 'typescript';
import {chromium} from 'playwright';
import {runAttendanceCleanupSteps} from './attendance-cleanup.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url)),canonical='https://www.faolla.com';
const endpoint='/api/merchant-enterprise/attendance/plan-exceptions',sources='/api/merchant-enterprise/attendance/sources',plan='/api/merchant-enterprise/attendance/plan-coverage-adoptions';
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
async function bounded(promise){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('plan_exception_browser_timeout')),15000);})]);}finally{clearTimeout(timer);}}
async function assets(){
  const bundle=await build({absWorkingDir:root,entryPoints:['scripts/fixtures/attendance-plan-exception-browser-entry.tsx'],bundle:true,write:false,metafile:true,platform:'browser',format:'esm',target:['es2020'],jsx:'automatic',tsconfig:path.join(root,'tsconfig.json'),outfile:'qa.js',logLevel:'warning',
    define:{'process.env':'{}','process.env.NODE_ENV':'"development"','process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_PLAN_EXCEPTIONS_ENABLED':'"1"','process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_PLAN_COVERAGE_ENABLED':'"1"','process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_PLAN_ADOPTION_VIEW_ENABLED':'"1"'}});
  for(const name of Object.keys(bundle.metafile.inputs))assert(!/node:crypto|\.server\.ts$|merchantAttendanceShiftRuleBinding\.ts$/.test(name),'plan_exception_server_import');
  const candidates=new Set();
  for(const name of Object.keys(bundle.metafile.inputs).filter(n=>/\.tsx?$/.test(n)&&!n.includes('node_modules'))){
    const ast=ts.createSourceFile(name,await readFile(path.join(root,name),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
    const visit=node=>{if(ts.isStringLiteral(node)||ts.isNoSubstitutionTemplateLiteral(node)||ts.isTemplateHead(node)||ts.isTemplateMiddle(node)||ts.isTemplateTail(node))node.text.split(/\s+/).filter(Boolean).forEach(v=>candidates.add(v));ts.forEachChild(node,visit);};visit(ast);
  }
  const css=(await compile('@import "tailwindcss";',{base:root,onDependency:()=>{}})).build([...candidates])+
    'body{margin:0;background:#f1f5f9;font-family:Arial,sans-serif}.qa-toolbar{padding:10px;background:#fff7ed;font-size:12px;overflow-wrap:anywhere}.qa-controls{display:flex;flex-wrap:wrap;gap:6px}.qa-controls button{border:1px solid #94a3b8;padding:6px;background:white;max-width:100%}.qa-main{max-width:1100px;margin:auto;padding:8px;min-width:0}';
  return {js:bundle.outputFiles.find(f=>f.path.endsWith('.js')).contents,css};
}
function request(url,method,body){return new Request(canonical+url,{method,headers:{host:'www.faolla.com',origin:canonical,'sec-fetch-site':'same-origin',...(body?{'content-type':'application/json'}:{})},...(body?{body}:{} )});}
export async function runPlanExceptionBrowserAcceptance(d){
  const v=d.exceptionBrowser;assert(v&&v.handle&&v.handleSources&&v.handlePlan&&v.sourceQuery&&v.slotId,'plan_exception_browser_fixture_missing');
  const files=await assets(),requests=[],errors=[],inflight=new Set(),gates=new Set();let browser,origin,closing=false,dropNextPost=false,hold=null,checks=0,staleChecked=false,stage='setup';
  const definitions=typeof d.definitions==='function'?d.definitions():null;
  const handlers={[endpoint]:v.handle,[sources]:v.handleSources,[plan]:v.handlePlan};
  const server=createServer((req,res)=>{
    if(!origin||req.headers.host!==new URL(origin).host||req.method!=='GET')return res.writeHead(403).end();
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'");
    const url=new URL(req.url??'/',origin);if(url.search)return res.writeHead(403).end();
    if(url.pathname==='/')return res.writeHead(200,{'Content-Type':'text/html;charset=utf-8'}).end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>隔离异常处理验收</title><link rel="stylesheet" href="/qa.css"><div id="qa-root"></div><script type="module" src="/qa.js"></script></html>');
    if(url.pathname==='/qa.js')return res.writeHead(200,{'Content-Type':'text/javascript;charset=utf-8'}).end(files.js);
    if(url.pathname==='/qa.css')return res.writeHead(200,{'Content-Type':'text/css;charset=utf-8'}).end(files.css);return res.writeHead(403).end();
  });
  const owner=p=>p.getByRole('region',{name:'排班异常处理',exact:true}),self=p=>p.getByRole('region',{name:'异常说明与处理结果',exact:true});
  const detail=region=>region.locator('[data-plan-exception-detail]');
  const control=(p,name)=>p.getByTestId(name).click();
  const quiet=async(p,count=requests.length)=>{await p.waitForLoadState('networkidle');await bounded(Promise.all([...inflight]));assert.equal(requests.length,count,'unexpected_automatic_exception_request');};
  const responseClick=async(p,locator,{method='GET',mode,pathName=endpoint}={})=>{
    const [response]=await Promise.all([p.waitForResponse(r=>{if(new URL(r.url()).pathname!==pathName||r.request().method()!==method)return false;
      const m=method==='POST'?r.request().postDataJSON()?.query?.mode:new URL(r.url()).searchParams.get('mode');return mode===undefined||m===mode;}),locator.click()]);
    await response.finished();const text=await response.text();assert.equal(response.status(),200,text);return JSON.parse(text);
  };
  const current=async(p)=>{const body=await responseClick(p,owner(p).getByRole('button',{name:'读取本排班当前依据',exact:true}),{mode:'detail'});await detail(owner(p)).waitFor();return body;};
  const follow=async(p,note)=>{await owner(p).getByLabel('异常处理选择',{exact:true}).selectOption('follow_up');await owner(p).getByLabel('异常处理理由',{exact:true}).fill(note);
    return responseClick(p,owner(p).getByRole('button',{name:'确认保存异常处理',exact:true}),{method:'POST',mode:'decide'});};
  const gateNext=()=>{assert.equal(hold,null);const gate={ready:deferred(),release:deferred(),finished:deferred()};hold=gate;gates.add(gate);return gate;};
  try{
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const address=server.address();assert(address&&typeof address==='object');origin=`http://127.0.0.1:${address.port}`;
    browser=await chromium.launch({headless:true});const context=await browser.newContext({serviceWorkers:'block',acceptDownloads:false,viewport:{width:390,height:980}});
    let page,acceptDialog=true;const confirmations=[];
    try{
      await context.addInitScript(seed=>{
        Object.defineProperty(window,'__planExceptionSeed',{value:seed});
        const originalSet=Storage.prototype.setItem;originalSet.call(sessionStorage,'qa-unrelated','preserve');originalSet.call(localStorage,'qa-unrelated','preserve');
        const probe={writes:[],csp:[],dialogEvents:[]};Object.defineProperty(window,'__planExceptionProbe',{value:probe});
        for(const method of ['setItem','removeItem','clear']){const original=Storage.prototype[method];Storage.prototype[method]=function(...args){probe.writes.push({method,key:args[0]??null,local:this===localStorage,bytes:method==='setItem'?new TextEncoder().encode(args[1]).byteLength:0});return original.apply(this,args);};}
        document.addEventListener('securitypolicyviolation',e=>probe.csp.push(e.violatedDirective));
        for(const type of ['keydown','cancel','close'])document.addEventListener(type,event=>{
          if(type==='keydown'&&event.key!=='Escape')return;
          const element=event.target instanceof Element?event.target.closest('dialog'):null;
          if(!element)return;
          const snapshot={type,cancelable:event.cancelable,defaultPreventedBefore:event.defaultPrevented,defaultPreventedAfter:null,openBefore:element.open,openAfter:null};
          probe.dialogEvents.push(snapshot);if(probe.dialogEvents.length>16)probe.dialogEvents.shift();
          queueMicrotask(()=>{snapshot.defaultPreventedAfter=event.defaultPrevented;snapshot.openAfter=element.open;});
        },true);
      },{site:v.site,owner:v.owner,auth:v.auth,employee:v.employee,worker:v.worker,slotId:v.slotId});
      await context.route('**/*',route=>{
        if(closing)return route.abort().catch(()=>{});
        const work=(async()=>{
          const req=route.request(),url=new URL(req.url());assert.equal(url.origin,origin,'exception_external_request');
          if(['/','/qa.js','/qa.css'].includes(url.pathname)){assert.equal(req.method(),'GET');assert.equal(url.search,'');return route.continue();}
          assert(Object.hasOwn(handlers,url.pathname),'unexpected_exception_endpoint');assert(requests.length<30,'exception_request_budget');
          const method=req.method(),body=req.postData();assert(['GET','POST'].includes(method));if(method==='POST')assert.equal(url.pathname,endpoint);
          if(body)assert(Buffer.byteLength(body,'utf8')<=8192);const access=req.headers()['x-qa-access'];assert(['owner','self'].includes(access));
          const expectedActor=access==='owner'?v.owner:v.auth;
          const overrides={authenticate:async()=>({user:{id:expectedActor},authenticationMethods:['password']})};
          const before=typeof d.fingerprint==='function'?d.fingerprint():null;
          const response=await handlers[url.pathname](request(url.pathname+url.search,method,body),overrides),text=await response.text(),parsed=JSON.parse(text);
          if(method==='GET'&&before!==null)assert.equal(d.fingerprint(),before,'exception_get_changed_facts');
          if(definitions!==null)assert.equal(d.definitions(),definitions);assert.equal(response.headers.get('cache-control'),'private, no-store');
          if(response.ok)assert(!text.includes('"sourceText"')&&!text.includes('"source_text"'),'private_exception_bytes_leaked');
          requests.push({path:url.pathname,method,status:response.status,mode:method==='POST'?JSON.parse(body).query.mode:url.searchParams.get('mode'),body:parsed});
          if(method==='POST'&&dropNextPost){dropNextPost=false;assert.equal(response.status,200,text);await route.abort('failed');return;}
          const gate=method==='GET'&&url.pathname===endpoint?hold:null;if(gate){hold=null;gate.ready.resolve(parsed);await gate.release.promise;}
          try{await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:text});}catch(error){if(!gate&&!closing)throw error;}
          finally{if(gate){gate.finished.resolve();gates.delete(gate);}}
        })();inflight.add(work);void work.finally(()=>inflight.delete(work)).catch(()=>{});
        return work.catch(async error=>{if(!closing)errors.push(error.message??'exception_route_failed');await route.abort().catch(()=>{});});
      });
      page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));page.on('download',()=>errors.push('unexpected_download'));page.on('popup',()=>errors.push('unexpected_popup'));
      page.on('dialog',dialog=>{confirmations.push({stage,type:dialog.type(),accepted:acceptDialog});if(confirmations.length>16)confirmations.shift();void(acceptDialog?dialog.accept():dialog.dismiss()).catch(()=>{});});
      stage='parent.launch';
      await page.goto(origin);await page.getByRole('button',{name:'资料核查（只读）',exact:true}).waitFor();await quiet(page,0);
      // 1. Real parent route + write, then guard both parent date and native Esc.
      await page.getByRole('button',{name:'资料核查（只读）',exact:true}).click();const parent=page.getByRole('region',{name:'单员工资料核查',exact:true});await parent.waitFor();await quiet(page,0);
      await parent.getByLabel('核查开始日期').fill(v.sourceQuery.fromDate);await parent.getByLabel('核查结束日期').fill(v.sourceQuery.throughDate);
      stage='parent.read_sources';await responseClick(page,parent.getByRole('button',{name:'读取核查资料',exact:true}),{pathName:sources});
      const coverage=parent.getByRole('region',{name:'计划关联核对',exact:true});await coverage.getByLabel('核对排班选择').selectOption(v.slotId);
      stage='parent.read_plan';await responseClick(page,coverage.getByRole('button',{name:'读取计划关联核对',exact:true}),{pathName:plan});
      stage='parent.open_exception';await coverage.getByRole('button',{name:'处理本排班异常',exact:true}).click();await owner(page).waitFor();const beforeFirst=requests.length;await quiet(page,beforeFirst);
      stage='parent.owner_decide';await current(page);const first=await follow(page,'174 browser owner follow-up');assert.equal(first.data.receipt.item.outcome,'follow_up');
      stage='parent.owner_history';
      await responseClick(page,owner(page).getByRole('button',{name:'读取异常处理记录',exact:true}),{mode:'list'});
      assert(await owner(page).locator(`[data-plan-exception-slot="${v.slotId}"]`).count()>0);await current(page);
      await owner(page).getByLabel('异常处理理由').fill('unsaved local reason');acceptDialog=false;
      stage='parent.dirty_date_dismiss';await parent.getByLabel('核查开始日期').fill(v.sourceQuery.throughDate);assert.equal(await parent.getByLabel('核查开始日期').inputValue(),v.sourceQuery.fromDate);await owner(page).waitFor();
      stage='parent.dirty_escape_dismiss';const beforeDismiss=confirmations.length;await page.keyboard.press('Escape');await owner(page).waitFor();
      assert.equal(confirmations.length,beforeDismiss+1,'escape_dismiss_requires_one_confirmation');assert.equal(confirmations.at(-1)?.accepted,false);assert.equal(await page.locator('dialog[open]').count(),1);
      stage='parent.dirty_escape_accept';const beforeAccept=confirmations.length;acceptDialog=true;await page.keyboard.press('Escape');await parent.waitFor({state:'detached'});
      assert.equal(confirmations.length,beforeAccept+1,'escape_accept_requires_one_confirmation');assert.equal(confirmations.at(-1)?.accepted,true);checks++;
      // 2. Actual employee workflow. Auth is synthetic, SQL and note/read writers are real.
      stage='self.open_history';await control(page,'self');await self(page).waitFor();await responseClick(page,self(page).getByRole('button',{name:'读取异常处理记录',exact:true}),{mode:'list'});
      await responseClick(page,self(page).locator(`[data-plan-exception-slot="${v.slotId}"]`).getByRole('button',{name:'查看说明与处理',exact:true}),{mode:'detail'});
      assert.match(await detail(self(page)).innerText(),/当前依据未重新核查/);
      await self(page).getByLabel('异常本人说明',{exact:true}).fill('174 browser employee explanation');
      assert(await self(page).getByRole('button',{name:'明确已读处理结果',exact:true}).isDisabled(),'ack_must_not_discard_unsent_explanation');
      stage='self.note';const note=await responseClick(page,self(page).getByRole('button',{name:'提交本人说明',exact:true}),{method:'POST',mode:'note'});
      assert.equal(note.data.receipt.command.decisionOperationId,first.data.receipt.operationId);
      stage='self.ack';const ack=await responseClick(page,self(page).getByRole('button',{name:'明确已读处理结果',exact:true}),{method:'POST',mode:'ack'});assert.equal(ack.data.readReceipt.decisionOperationId,first.data.receipt.operationId);
      assert(await self(page).getByRole('button',{name:'本决定已明确已读',exact:true}).isDisabled());
      const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+2);assert.equal(overflow,false,'exception_390px_overflow');checks++;
      // 3. Successful POST response loss; only original-ID GET after reload/flag off.
      stage='standalone.owner_after_self';await control(page,'owner');await owner(page).waitFor();await current(page);await owner(page).getByLabel('异常处理选择').selectOption('follow_up');
      await owner(page).getByLabel('异常处理理由').fill('174 browser lost-response owner follow-up');dropNextPost=true;
      stage='standalone.lost_post_response';await owner(page).getByRole('button',{name:'确认保存异常处理',exact:true}).click();await owner(page).locator('[data-plan-exception-pending]').waitFor();
      await bounded(Promise.all([...inflight]));await page.waitForFunction(()=>!!document.querySelector('[data-plan-exception-pending]')&&document.querySelector('[data-plan-exception-workspace]')?.textContent?.includes('无法可靠确认'));
      const ownerKey=`faolla:attendance:plan-exceptions:v1:${v.site}:owner:${v.owner}`,pending=await page.evaluate(key=>sessionStorage.getItem(key),ownerKey);assert(pending);
      const operationId=JSON.parse(pending).command.operationId,postCount=requests.filter(r=>r.method==='POST').length;
      stage='standalone.reload_pending';await page.reload();await quiet(page);await control(page,'owner');await owner(page).locator('[data-plan-exception-pending]').waitFor();await control(page,'feature-off');
      stage='standalone.flag_off_recover';
      await owner(page).locator('[data-plan-exception-pending]').waitFor();const recovered=await responseClick(page,owner(page).getByRole('button',{name:'核对原异常编号',exact:true}),{mode:'recover'});
      assert.equal(recovered.data.receipt.operationId,operationId);assert.equal(requests.filter(r=>r.method==='POST').length,postCount);
      assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),ownerKey),null);checks++;
      // 4. Current source changes only via the root-owned fixture callback.
      stage='standalone.changed_source';await control(page,'feature-on');await current(page);
      if(typeof v.changeSource==='function'){const n=requests.length;await v.changeSource();await quiet(page,n);const changed=await current(page);assert.equal(changed.data.detail.stale,true);staleChecked=true;}
      stage='standalone.late_api_response';const gate=gateNext();await owner(page).getByRole('button',{name:'读取本排班当前依据',exact:true}).click();await bounded(gate.ready.promise);
      await control(page,'api-change');assert.equal(await detail(owner(page)).count(),0);gate.release.resolve();await bounded(gate.finished.promise);await quiet(page);assert.equal(await detail(owner(page)).count(),0);
      stage='standalone.hide_pagehide_unmount';await current(page);await control(page,'hide');assert.equal(await detail(owner(page)).count(),0);const hiddenCount=requests.length;await control(page,'show');await quiet(page,hiddenCount);
      await control(page,'pagehide');await control(page,'pageshow');await quiet(page,hiddenCount);await control(page,'unmount');await control(page,'mount');await quiet(page,hiddenCount);checks++;
      stage='final.readonly_storage_audit';const probe=await page.evaluate(()=>window.__planExceptionProbe);assert.deepEqual(probe.csp,[]);
      assert(probe.writes.every(w=>!w.local&&w.bytes<=8192&&[`faolla:attendance:plan-exceptions:v1:${v.site}:owner:${v.owner}`,`faolla:attendance:plan-exceptions:v1:${v.site}:self:${v.employee}`].includes(w.key)),'unexpected_exception_storage_write');
      assert.deepEqual(await page.evaluate(()=>[sessionStorage.getItem('qa-unrelated'),localStorage.getItem('qa-unrelated')]),['preserve','preserve']);
      await quiet(page);assert.deepEqual(errors,[]);assert.equal(requests.filter(r=>r.method==='POST').length,4);assert(requests.length<=30);
      return {checks,requests:requests.length,posts:4,staleChecked,ownerPath:'actual SourcesLauncher→SourcesPanel→PlanCoverage→Workspace→handler/service/SQL',selfPath:'actual Workspace only; SelfPanel mounting covered by static tests',authentication:'synthetic current owner/employee, real SQL',storage:'bounded exact-key pending commands only',externalRequests:0};
    }catch(error){
      // Bounded synthetic-UI diagnostics: never dump response bodies, storage,
      // input values or source evidence. Distinguish identical region waits.
      let dom=null;
      if(page&&!page.isClosed())try{dom=await bounded(page.evaluate(()=>{
        const visible=node=>!!(node.getClientRects().length&&getComputedStyle(node).visibility!=='hidden');
        const text=node=>(node.textContent??'').replace(/\s+/g,' ').trim().slice(0,180);
        const main=document.querySelector('[data-qa-mode]');
        return {hidden:document.hidden,visibility:document.visibilityState,mode:main?.getAttribute('data-qa-mode'),mounted:main?.getAttribute('data-qa-mounted'),closed:main?.getAttribute('data-qa-closed'),generation:main?.getAttribute('data-qa-generation'),
          dialogEvents:window.__planExceptionProbe?.dialogEvents??[],
          dialogs:[...document.querySelectorAll('dialog')].slice(0,3).map(node=>({label:node.getAttribute('aria-label'),open:node.open,visible:visible(node)})),
          regions:[...document.querySelectorAll('section[aria-label]')].slice(0,24).map(node=>({label:node.getAttribute('aria-label'),visible:visible(node)})),
          workspaces:[...document.querySelectorAll('[data-plan-exception-workspace]')].slice(0,3).map(node=>({label:node.getAttribute('aria-label'),visible:visible(node),pending:!!node.querySelector('[data-plan-exception-pending]')})),
          statuses:[...document.querySelectorAll('[role="status"],[role="alert"]')].slice(0,10).map(node=>({role:node.getAttribute('role'),visible:visible(node),text:text(node)})),
          buttons:[...document.querySelectorAll('button')].filter(node=>visible(node)&&/异常|本人|负责人|资料核查|返回考勤/.test(node.textContent??'')).slice(0,15).map(node=>({text:text(node),disabled:node.disabled})),
        };
      }));}catch(diagnosticError){dom={diagnosticError:diagnosticError.message};}
      const diagnostic={stage,acceptDialog,confirmations,checks,inflight:inflight.size,requests:requests.slice(-6).map(({path,method,status,mode,body})=>({path,method,status,mode,error:typeof body?.error==='string'?body.error:null})),errors:errors.slice(-6).map(value=>String(value).slice(0,300)),dom};
      throw new Error(`plan_exception_browser_failed:${JSON.stringify(diagnostic)}\n${error.message}`,{cause:error});
    }finally{for(const gate of gates)gate.release.resolve();await bounded(context.close());}
  }finally{
    closing=true;for(const gate of gates)gate.release.resolve();
    await runAttendanceCleanupSteps([{name:'plan-exception pending route responses',run:()=>bounded(Promise.allSettled([...inflight]))},
      {name:'plan-exception Chromium',run:async()=>{if(browser)await browser.close();}},
      {name:'plan-exception loopback listener',run:()=>new Promise((resolve,reject)=>{server.close(error=>error&&error.code!=='ERR_SERVER_NOT_RUNNING'?reject(error):resolve());server.closeAllConnections?.();})}]);
  }
}
