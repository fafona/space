// Inert187 callback: root alone invokes this against its already owned schema.
// No DB lifecycle, disk bundle, real authentication, screenshot or deployment.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {build,stop} from 'esbuild';
import {compile} from '@tailwindcss/node';
import ts from 'typescript';
import {chromium} from 'playwright';
import {runAttendanceCleanupSteps} from './attendance-cleanup.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url)),canonical='https://www.faolla.com';
const endpoint='/api/merchant-enterprise/attendance/work-arrangements',selfEndpoint='/api/merchant-enterprise/attendance/self',adminEndpoint='/api/merchant-enterprise/attendance/admin';
async function bounded(promise){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('work_arrangement_browser_timeout')),15000);})]);}finally{clearTimeout(timer);}}
async function assets(){
  const bundle=await build({absWorkingDir:root,entryPoints:['scripts/fixtures/attendance-work-arrangement-browser.tsx'],bundle:true,write:false,metafile:true,
    platform:'browser',format:'esm',target:['es2020'],jsx:'automatic',tsconfig:path.join(root,'tsconfig.json'),outfile:'qa.js',logLevel:'warning',define:{'process.env':'{}','process.env.NODE_ENV':'"development"'}});
  for(const name of Object.keys(bundle.metafile.inputs))assert(!/node:crypto|\.server\.ts$/.test(name),'work_arrangement_server_browser_import');
  const candidates=new Set();
  for(const name of Object.keys(bundle.metafile.inputs).filter(n=>/\.tsx?$/.test(n)&&!n.includes('node_modules'))){const ast=ts.createSourceFile(name,await readFile(path.join(root,name),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
    const visit=node=>{if(ts.isStringLiteral(node)||ts.isNoSubstitutionTemplateLiteral(node)||ts.isTemplateHead(node)||ts.isTemplateMiddle(node)||ts.isTemplateTail(node))node.text.split(/\s+/).filter(Boolean).forEach(v=>candidates.add(v));ts.forEachChild(node,visit);};visit(ast);}
  const css=(await compile('@import "tailwindcss";',{base:root,onDependency:()=>{}})).build([...candidates])
    +'body{margin:0;background:#f1f5f9;font-family:Arial,sans-serif}.qa-toolbar{padding:8px;background:#fff7ed;font-size:12px;overflow-wrap:anywhere}.qa-controls{display:flex;flex-wrap:wrap;gap:6px}.qa-controls button{border:1px solid #94a3b8;background:white;padding:6px}.qa-main{max-width:1000px;margin:auto;padding:8px;min-width:0}';
  return {js:bundle.outputFiles.find(f=>f.path.endsWith('.js')).contents,css};
}
export function workArrangementParentMock(url,method,{site,worker,zone}){
  assert.equal(method,'GET','work_arrangement_parent_writes_forbidden');assert.equal(url.searchParams.get('siteId'),site);assert(!url.searchParams.has('operationId'));
  if(url.pathname===selfEndpoint)return {ok:true,moduleEnabled:true,workerId:worker,locationId:null,state:{sequence:0,status:'off',lastEvent:null},receipt:null,replayed:false};
  assert.equal(url.pathname,adminEndpoint);assert.equal(url.searchParams.get('view'),'settings');
  return {ok:true,moduleEnabled:true,siteId:site,version:1,settings:{timeZone:zone,enabled:true,webClockEnabled:false,webBreakPaid:false},view:'settings',items:[],nextCursor:null,receipt:null};
}
export async function cleanupWorkArrangementBrowser(steps,primaryError=null){
  try{assert(Array.isArray(steps)&&steps.every(s=>s&&typeof s==='object'&&!Array.isArray(s)&&typeof s.name==='string'&&typeof s.run==='function'),'work_arrangement_cleanup_shape');await runAttendanceCleanupSteps(steps);}
  catch(error){if(primaryError)throw new AggregateError([primaryError,error],'work_arrangement_and_cleanup_failed',{cause:primaryError});throw error;}
}
export async function runWorkArrangementBrowserAcceptance({d,h,scope,handle,span}){
  assert(d&&h&&scope&&handle&&span&&scope.schema===d.owned.schema,'work_arrangement_browser_dependencies');
  const requests=[],errors=[],inflight=new Set(),dialogs=[],storageHistory=[],cspHistory=[];let files,browser,context,origin,closing=false,accept=true,dropPost=false,stage='setup',failure=null,checks=0,page;
  const definitions=d.definitions(),protectedTables=d.inventory().filter(t=>!['merchant_attendance_work_arrangement_requests','merchant_attendance_work_arrangement_entries'].includes(t));
  const protectedBefore=d.fingerprint(protectedTables);
  const counts=()=>JSON.parse(d.exec("select jsonb_build_object('requests',(select count(*) from public.merchant_attendance_work_arrangement_requests),'entries',(select count(*) from public.merchant_attendance_work_arrangement_entries))::text;"));
  const beforeCounts=counts(),key=`faolla:attendance:work-arrangements:v1:${d.site}:self:${h.employeeId}`;
  const server=createServer((request,response)=>{if(!origin||request.headers.host!==new URL(origin).host||request.method!=='GET')return response.writeHead(403).end();
    response.setHeader('Cache-Control','no-store');response.setHeader('X-Content-Type-Options','nosniff');response.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; object-src 'none'");
    const u=new URL(request.url??'/',origin);if(u.search)return response.writeHead(403).end();
    if(u.pathname==='/')return response.writeHead(200,{'Content-Type':'text/html;charset=utf-8'}).end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>工作安排隔离验收</title><link rel="stylesheet" href="/qa.css"><div id="qa-root"></div><script type="module" src="/qa.js"></script></html>');
    if(u.pathname==='/qa.js')return response.writeHead(200,{'Content-Type':'text/javascript;charset=utf-8'}).end(files.js);if(u.pathname==='/qa.css')return response.writeHead(200,{'Content-Type':'text/css;charset=utf-8'}).end(files.css);return response.writeHead(403).end();});
  const region=()=>page.getByRole('region',{name:'工作安排申请与审批',exact:true}),newRequests=()=>requests.filter(r=>r.path===endpoint),posts=()=>newRequests().filter(r=>r.method==='POST');
  const quiet=async()=>{await page.waitForLoadState('networkidle');await bounded(Promise.all([...inflight]));};
  const clickResponse=async(locator,{method='GET',action,requestId,operationId,preview=false}={})=>{
    const [response]=await Promise.all([page.waitForResponse(r=>{const u=new URL(r.url());if(u.pathname!==endpoint||r.request().method()!==method)return false;
      const b=method==='POST'?r.request().postDataJSON():null;return (!action||b?.command.action===action)&&(!requestId||(b?.query.requestId??u.searchParams.get('requestId'))===requestId)
        &&(!operationId||u.searchParams.get('operationId')===operationId)&&(!preview||u.searchParams.has('preview'));}),locator.click()]);
    await response.finished();const text=await response.text();assert.equal(response.status(),200,text);return JSON.parse(text);
  };
  const open=async(access='self',off=false)=>{await page.getByRole('button',{name:off?'核对待确认工作安排':access==='self'?'我的出差／外勤／远程申请':'工作安排审批与政策',exact:true}).click();await region().waitFor();};
  const close=async()=>{await region().getByRole('button',{name:'关闭工作安排',exact:true}).click();await page.getByRole('dialog',{name:'出差、外勤与远程工作安排',exact:true}).waitFor({state:'detached'});};
  const load=()=>clickResponse(region().getByRole('button',{name:'读取工作安排首页',exact:true}));
  const chooseDetail=async requestId=>{await load();const row=region().getByRole('region',{name:'工作安排记录',exact:true}).getByRole('listitem').filter({hasText:requestId});assert.equal(await row.count(),1);
    const r=await clickResponse(row.getByRole('button',{name:'查看工作安排详情',exact:true}),{requestId});await region().locator('[data-work-arrangement-detail]').waitFor();return r;};
  const prepare=async(day,kind,reason)=>{await region().getByLabel('工作安排类别',{exact:true}).selectOption(kind);await region().getByLabel('工作安排开始时间',{exact:true}).fill(day+'T09:00');await region().getByLabel('工作安排结束时间',{exact:true}).fill(day+'T11:00');
    await region().getByLabel('工作安排申请理由',{exact:true}).fill(reason);const p=await clickResponse(region().getByRole('button',{name:'预览时间与冲突',exact:true}),{preview:true});assert.equal(p.preview.kind,kind);assert.equal(p.preview.canSubmit,true);
    await region().locator('[data-work-arrangement-preview]').waitFor();assert.equal(await region().getByLabel('工作安排申请理由',{exact:true}).inputValue(),reason,'work_arrangement_preview_lost_draft');await region().getByLabel('确认工作安排申请',{exact:true}).check();return p;};
  try{
    files=await assets();await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const address=server.address();assert(address&&typeof address==='object');origin=`http://127.0.0.1:${address.port}`;
    browser=await chromium.launch({headless:true});context=await browser.newContext({serviceWorkers:'block',acceptDownloads:false,viewport:{width:390,height:900}});
    await context.addInitScript(seed=>{Object.defineProperty(window,'__workArrangementSeed',{value:seed});const set=Storage.prototype.setItem;set.call(sessionStorage,'qa-unrelated','keep');set.call(localStorage,'qa-unrelated','keep');
      const probe={writes:[],csp:[]};Object.defineProperty(window,'__workArrangementProbe',{value:probe});for(const method of ['setItem','removeItem','clear']){const old=Storage.prototype[method];Storage.prototype[method]=function(...args){probe.writes.push({method,key:args[0]??null,local:this===localStorage,bytes:method==='setItem'?new TextEncoder().encode(args[1]).byteLength:0});return old.apply(this,args);};}
      document.addEventListener('securitypolicyviolation',e=>probe.csp.push(e.violatedDirective));
    },{site:d.site,owner:d.owner,employee:h.employeeId});
    await context.route('**/*',route=>{if(closing)return route.abort().catch(()=>{});const task=(async()=>{const r=route.request(),u=new URL(r.url());assert.equal(u.origin,origin,'work_arrangement_external_request');
      if(['/','/qa.js','/qa.css'].includes(u.pathname)){assert.equal(r.method(),'GET');assert.equal(u.search,'');return route.continue();}
      assert(requests.length<40,'work_arrangement_browser_request_budget');const method=r.method(),access=r.headers()['x-qa-access'];assert(['owner','self'].includes(access));
      if([selfEndpoint,adminEndpoint].includes(u.pathname)){assert.equal(access,u.pathname===selfEndpoint?'self':'owner');const body=workArrangementParentMock(u,method,{site:d.site,worker:h.workerId,zone:span.timeZone});requests.push({path:u.pathname,method,status:200,access,synthetic:true});
        return route.fulfill({status:200,headers:{'content-type':'application/json','cache-control':'private, no-store'},body:JSON.stringify(body)});}
      assert.equal(u.pathname,endpoint,'work_arrangement_unexpected_endpoint');assert(newRequests().length<25);assert(['GET','POST'].includes(method));
      const text=r.postData();if(text)assert(Buffer.byteLength(text,'utf8')<=8192);const command=text?JSON.parse(text).command:null;
      const before=d.fingerprint(),response=await handle(new Request(canonical+u.pathname+u.search,{method,headers:{host:'www.faolla.com',origin:canonical,'sec-fetch-site':'same-origin',...(text?{'content-type':'application/json'}:{})},...(text?{body:text}:{})}),access,true);
      const output=await response.text(),body=JSON.parse(output);if(method==='GET')assert.equal(d.fingerprint(),before,'work_arrangement_get_wrote_facts');assert.equal(d.definitions(),definitions);assert.equal(d.fingerprint(protectedTables),protectedBefore,'work_arrangement_changed_unrelated_facts');
      requests.push({path:u.pathname,method,status:response.status,access,action:command?.action??null,operationId:command?.operationId??u.searchParams.get('operationId'),error:body.error??null});
      assert.equal(response.headers.get('cache-control'),'private, no-store');
      if(method==='POST'&&dropPost){dropPost=false;assert.equal(response.status,200,output);return route.abort('failed');}
      return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:output});
    })();inflight.add(task);void task.finally(()=>inflight.delete(task)).catch(()=>{});return task.catch(async error=>{if(!closing)errors.push(error.message);await route.abort().catch(()=>{});});});
    page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));page.on('popup',()=>errors.push('unexpected_popup'));
    page.on('dialog',dialog=>{const choice=accept;void(choice?dialog.accept():dialog.dismiss()).then(()=>dialogs.push({type:dialog.type(),accepted:choice})).catch(error=>{if(!closing)errors.push(`work_arrangement_dialog_failed:${error.message}`);});});
    stage='default_off';await page.goto(origin);await quiet();assert.equal(newRequests().length,0);assert.equal(await page.getByRole('button',{name:'我的出差／外勤／远程申请',exact:true}).count(),0);checks++;
    stage='self_preview_and_guard';await page.getByTestId('feature-on').click();await open();assert.equal(newRequests().length,0);const home=await load();
    const day=offset=>new Date(Date.parse(home.readAt.slice(0,10)+'T00:00:00Z')+offset*86400000).toISOString().slice(0,10),reason='187 browser future remote arrangement';
    await prepare(day(12),'remote',reason);accept=false;const dialogCount=dialogs.length;
    const escaped=page.waitForEvent('dialog');await page.keyboard.press('Escape');await escaped;await quiet();assert.equal(dialogs.length,dialogCount+1);assert.equal(dialogs.at(-1).accepted,false);await region().waitFor();assert.equal(await region().getByLabel('工作安排申请理由',{exact:true}).inputValue(),reason);
    const refused=page.waitForEvent('dialog');await region().getByRole('button',{name:'关闭工作安排',exact:true}).click();await refused;await quiet();await region().waitFor();assert.equal(posts().length,0);accept=true;checks++;
    stage='self_submit';const first=await clickResponse(region().getByRole('button',{name:'明确提交工作安排',exact:true}),{method:'POST',action:'submit'});const requestId=first.receipt.item.requestId;
    assert.equal(first.receipt.item.kind,'remote');assert.equal(first.receipt.item.status,'submitted');assert.equal(first.receipt.command.expectedPolicyRevision,home.policy.revision);await region().locator('[data-work-arrangement-receipt]').waitFor();await close();checks++;
    stage='owner_approve';await page.getByTestId('owner').click();await open('owner');const reviewed=await chooseDetail(requestId);assert.equal(reviewed.detail.canApprove,true);
    await region().getByLabel('工作安排处理理由',{exact:true}).fill('187 browser explicit owner decision');if(reviewed.detail.conflicts.length)await region().getByLabel('明确确认重叠资料',{exact:true}).check();await region().getByLabel('确认工作安排处理',{exact:true}).check();
    const approved=await clickResponse(region().getByRole('button',{name:'明确批准申请',exact:true}),{method:'POST',action:'approve',requestId});assert.equal(approved.receipt.item.status,'approved');await region().locator('[data-work-arrangement-receipt]').waitFor();await close();
    stage='self_result';await page.getByTestId('self').click();await open();const observed=await chooseDetail(requestId);assert.equal(observed.detail.status,'approved');assert.equal(observed.detail.history.length,2);assert.equal(await region().getByRole('button',{name:'明确批准申请',exact:true}).count(),0);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false,'work_arrangement_390_document_overflow');assert.equal(await region().evaluate(e=>e.scrollWidth>e.clientWidth+2),false,'work_arrangement_390_panel_overflow');checks++;
    stage='lost_response';await load();await prepare(day(13),'field','187 browser committed response loss');dropPost=true;
    const failed=page.waitForEvent('requestfailed',{predicate:r=>new URL(r.url()).pathname===endpoint&&r.method()==='POST'});await region().getByRole('button',{name:'明确提交工作安排',exact:true}).click();await failed;await quiet();await region().locator('[data-work-arrangement-pending]').waitFor();
    const raw=await page.evaluate(k=>sessionStorage.getItem(k),key);assert(raw);const operationId=JSON.parse(raw).command.operationId,postCount=posts().length;assert.equal(postCount,3);
    const preReloadProbe=await page.evaluate(()=>window.__workArrangementProbe);storageHistory.push(...preReloadProbe.writes);cspHistory.push(...preReloadProbe.csp);
    stage='flagoff_reload_recovery';await page.reload();await quiet();assert.equal(posts().length,postCount);await open('self',true);await region().locator('[data-work-arrangement-pending]').waitFor();
    const recovered=await clickResponse(region().getByRole('button',{name:'核对原工作安排编号',exact:true}),{operationId});assert.equal(recovered.receipt.command.operationId,operationId);assert.equal(recovered.receipt.item.kind,'field');assert.equal(posts().length,postCount);
    await region().locator('[data-work-arrangement-receipt]').waitFor();assert.equal(await page.evaluate(k=>sessionStorage.getItem(k),key),null);await close();assert.equal(await page.getByRole('button',{name:'我的出差／外勤／远程申请',exact:true}).count(),0);checks++;
    const probe=await page.evaluate(()=>({writes:window.__workArrangementProbe.writes,csp:window.__workArrangementProbe.csp,local:localStorage.getItem('qa-unrelated'),session:sessionStorage.getItem('qa-unrelated')}));
    storageHistory.push(...probe.writes);cspHistory.push(...probe.csp);assert.equal(probe.local,'keep');assert.equal(probe.session,'keep');assert.deepEqual(cspHistory,[]);
    assert(storageHistory.every(w=>!w.local&&w.method!=='clear'&&w.key.startsWith(`faolla:attendance:work-arrangements:v1:${d.site}:`)&&w.bytes<=8192));
    const after=counts();assert.equal(after.requests-beforeCounts.requests,2);assert.equal(after.entries-beforeCounts.entries,3);assert.equal(d.fingerprint(protectedTables),protectedBefore);assert.equal(d.definitions(),definitions);assert.deepEqual(errors,[]);
    return {checks,requests:requests.length,workArrangementRequests:newRequests().length,posts:postCount,requestDelta:2,entryDelta:3,actualSelfAndAdminParents:true,parentInitializationSynthetic:true,
      syntheticAuth:true,actualWorkArrangementHandlerServiceSql:true,readOnlyGetFingerprints:true,defaultOff:true,flagOffOriginalRecovery:true,dirtyEscapeAndClose:true,width390:true,externalRequests:0,diskBundles:false};
  }catch(error){const diagnostic={stage,message:String(error?.message??error).slice(0,1500),stack:String(error?.stack??'').split('\n').slice(0,2).join('\n'),requests:requests.slice(-8),errors};
    if(page)diagnostic.ui=await page.locator('body').innerText().then(t=>t.slice(-5500)).catch(()=>'<closed>');failure=Error(`work_arrangement_browser_failed ${JSON.stringify(diagnostic)}`,{cause:error});throw failure;
  }finally{closing=true;await cleanupWorkArrangementBrowser([
    {name:'work arrangement inflight',run:()=>bounded(Promise.allSettled([...inflight]))},
    {name:'work arrangement context',run:()=>context?bounded(context.close()):undefined},
    {name:'work arrangement browser',run:()=>browser?bounded(browser.close()):undefined},
    {name:'work arrangement HTTP listener',run:()=>{server.closeAllConnections?.();return server.listening?bounded(new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()))):undefined;}},
    {name:'work arrangement esbuild service',run:()=>stop()},
  ],failure);}
}
