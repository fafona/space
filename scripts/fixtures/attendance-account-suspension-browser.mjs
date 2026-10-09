// Inert 193 callback. Root alone starts this in the existing owned native scope.
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
const endpoint='/api/merchant-enterprise/attendance/account-suspensions',employees='/api/merchant-enterprise/employees',overview='/api/merchant-enterprise/overview',admin='/api/merchant-enterprise/attendance/admin';
const bounded=async(promise)=>{let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('account_suspension_browser_timeout')),15000);})]);}finally{clearTimeout(timer);}};
export async function cleanupAccountSuspensionBrowser(steps,primaryError=null){
  try{assert(Array.isArray(steps)&&steps.every(s=>s&&typeof s==='object'&&!Array.isArray(s)&&typeof s.name==='string'&&typeof s.run==='function'),'account_suspension_cleanup_shape');await runAttendanceCleanupSteps(steps);}
  catch(error){if(primaryError)throw new AggregateError([primaryError,error],'account_suspension_and_cleanup_failed',{cause:primaryError});throw error;}
}
async function assets(){
  const bundle=await build({absWorkingDir:root,entryPoints:['scripts/fixtures/attendance-account-suspension-browser.tsx'],bundle:true,write:false,metafile:true,platform:'browser',format:'esm',target:['es2020'],jsx:'automatic',
    tsconfig:path.join(root,'tsconfig.json'),outfile:'qa.js',logLevel:'warning',define:{'process.env':'{}','process.env.NODE_ENV':'"development"'}});
  const inputs=Object.keys(bundle.metafile.inputs);assert(inputs.some(n=>n.endsWith('MerchantEnterpriseManager.tsx')));assert(inputs.some(n=>n.endsWith('MerchantAttendanceAdminPanel.tsx')));
  for(const name of inputs)assert(!/node:crypto|\.server\.ts$/.test(name),'account_suspension_server_browser_import');
  const candidates=new Set();for(const name of inputs.filter(n=>/\.tsx?$/.test(n)&&!n.includes('node_modules'))){
    const ast=ts.createSourceFile(name,await readFile(path.join(root,name),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
    const visit=node=>{if(ts.isStringLiteral(node)||ts.isNoSubstitutionTemplateLiteral(node)||ts.isTemplateHead(node)||ts.isTemplateMiddle(node)||ts.isTemplateTail(node))node.text.split(/\s+/).filter(Boolean).forEach(v=>candidates.add(v));ts.forEachChild(node,visit);};visit(ast);}
  const css=(await compile('@import "tailwindcss";',{base:root,onDependency:()=>{}})).build([...candidates])
    +'body{margin:0;background:#f1f5f9;font-family:Arial,sans-serif}.qa-toolbar{padding:8px;background:#fff7ed;font-size:12px;overflow-wrap:anywhere}.qa-controls{display:flex;flex-wrap:wrap;gap:6px}.qa-controls button{border:1px solid #94a3b8;background:white;padding:6px}.qa-main{max-width:1000px;margin:auto;min-width:0}';
  return {js:bundle.outputFiles.find(f=>f.path.endsWith('.js')).contents,css};
}
export async function runAccountSuspensionBrowserAcceptance(ctx){
  const {site,owner,employeeId,employeeName,handleEmployee,handleSuspension,overview:readOverview,handleAdmin,handleCurrentOperations}=ctx??{};
  assert(/^\d{8}$/.test(site)&&owner&&employeeId&&employeeName&&[handleEmployee,handleSuspension,readOverview,handleAdmin,handleCurrentOperations].every(fn=>typeof fn==='function'),'account_suspension_browser_dependencies');
  const requests=[],errors=[],inflight=new Set();let files,browser,context,page,origin,closing=false,accept=true,drop=null,stage='setup',failure=null,checks=0;
  const statusKey=`faolla:attendance:account-status:v1:${site}:${owner}`,restoreKey=`faolla:attendance:account-suspension:v1:${site}:${owner}`;
  const server=createServer((request,response)=>{if(!origin||request.headers.host!==new URL(origin).host||request.method!=='GET')return response.writeHead(403).end();
    response.setHeader('Cache-Control','no-store');response.setHeader('X-Content-Type-Options','nosniff');response.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; object-src 'none'");
    const u=new URL(request.url??'/',origin);if(u.search)return response.writeHead(403).end();
    if(u.pathname==='/')return response.writeHead(200,{'Content-Type':'text/html;charset=utf-8'}).end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>账号暂停本地验收</title><link rel="stylesheet" href="/qa.css"><div id="qa-root"></div><script type="module" src="/qa.js"></script></html>');
    if(u.pathname==='/qa.js')return response.writeHead(200,{'Content-Type':'text/javascript;charset=utf-8'}).end(files.js);if(u.pathname==='/qa.css')return response.writeHead(200,{'Content-Type':'text/css;charset=utf-8'}).end(files.css);return response.writeHead(403).end();});
  const region=()=>page.getByRole('region',{name:'账号与考勤暂停核验',exact:true}),row=()=>page.locator(`[data-enterprise-employee-id="${employeeId}"]`);
  const newRequests=()=>requests.filter(r=>r.path===endpoint),patches=()=>requests.filter(r=>r.path===employees&&r.method==='PATCH'),posts=()=>newRequests().filter(r=>r.method==='POST');
  const quiet=async()=>{await page.waitForLoadState('networkidle');await bounded(Promise.all([...inflight]));};
  const clickResponse=async(locator,{path:expectedPath=endpoint,method='GET',mode}={})=>{
    const [response]=await Promise.all([page.waitForResponse(r=>{const u=new URL(r.url());return u.pathname===expectedPath&&r.request().method()===method&&(!mode||u.searchParams.get('mode')===mode);}),locator.click()]);
    await response.finished();assert.equal(response.status(),200);const body=await response.json();assert.equal(body.ok,true);await quiet();return body;
  };
  const status=async(value,{lost=false}={})=>{
    if(value==='disabled'){await row().getByRole('button',{name:'停用',exact:true}).click();await page.getByRole('dialog',{name:'安全停用员工',exact:true}).waitFor();}
    const button=value==='disabled'?page.getByRole('dialog',{name:'安全停用员工',exact:true}).getByRole('button',{name:'停用并解除负责人',exact:true}):row().getByRole('button',{name:'恢复',exact:true});
    if(lost){drop=employees;const failed=page.waitForEvent('requestfailed',{predicate:r=>new URL(r.url()).pathname===employees&&r.method()==='PATCH'});await button.click();await failed;await quiet();
      await page.getByRole('button',{name:'核对原员工账号编号',exact:true}).waitFor();return null;}
    const reply=await clickResponse(button,{mode:'recover-status'});assert.equal(reply.statusReceipt?.status,value);assert.equal(reply.statusReceipt?.employeeId,employeeId);
    await page.locator('[data-account-status-receipt]').waitFor();await row().getByRole('button',{name:value==='disabled'?'恢复':'停用',exact:true}).waitFor();return reply.statusReceipt;
  };
  const openDetail=async(suspensionId)=>{
    await page.getByTestId('attendance-admin').click();await page.getByRole('region',{name:'考勤配置管理',exact:true}).waitFor();const before=newRequests().length;
    await page.getByRole('button',{name:'考勤暂停待核验',exact:true}).click();await region().waitFor();await quiet();assert.equal(newRequests().length,before,'opening_must_not_fetch');
    const list=await clickResponse(region().getByRole('button',{name:'读取当前暂停列表',exact:true}),{mode:'list'});assert(list.items.some(item=>item.suspensionId===suspensionId));
    const response=await clickResponse(region().locator(`[data-account-suspension-id="${suspensionId}"]`).getByRole('button',{name:'核验此暂停',exact:true}),{mode:'detail'});
    await region().locator('[data-account-suspension-detail]').waitFor();assert.equal(response.detail.suspension.employeeId,employeeId);return response.detail;
  };
  const restore=async({lost=false}={})=>{
    await region().getByLabel('恢复核验理由',{exact:true}).fill('真实父页核对同一身份与原始在班状态');await region().getByLabel('确认同一身份解除暂停',{exact:true}).check();
    const button=region().getByRole('button',{name:'明确解除考勤暂停',exact:true});
    if(lost){drop=endpoint;const failed=page.waitForEvent('requestfailed',{predicate:r=>new URL(r.url()).pathname===endpoint&&r.method()==='POST'});await button.click();await failed;await quiet();await region().locator('[data-account-suspension-pending]').waitFor();return null;}
    const response=await clickResponse(button,{method:'POST'});assert.equal(response.receipt?.employeeId,employeeId);await region().locator('[data-account-suspension-receipt]').waitFor();return response.receipt;
  };
  const close=async()=>{await region().getByRole('button',{name:'关闭暂停核验',exact:true}).click();await page.getByRole('dialog',{name:'账号与考勤暂停工作区',exact:true}).waitFor({state:'detached'});};
  try{
    files=await assets();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin=`http://127.0.0.1:${server.address().port}`;
    browser=await chromium.launch({headless:true});context=await browser.newContext({serviceWorkers:'block',acceptDownloads:false,viewport:{width:390,height:900}});
    await context.addInitScript(({site,owner})=>{window.__accountSuspensionSeed={site,owner};sessionStorage.setItem('qa-unrelated','keep');localStorage.setItem('qa-unrelated','keep');
      window.__accountSuspensionProbe={writes:[],csp:[]};document.addEventListener('securitypolicyviolation',event=>window.__accountSuspensionProbe.csp.push(event.violatedDirective));
      for(const method of ['setItem','removeItem','clear']){const original=Storage.prototype[method];Storage.prototype[method]=function(...args){window.__accountSuspensionProbe.writes.push({method,local:this===localStorage,key:String(args[0]??''),bytes:new TextEncoder().encode(String(args[1]??'')).length});return original.apply(this,args);};}
    },{site,owner});
    await context.route('**/*',route=>{const task=(async()=>{const request=route.request(),u=new URL(request.url());assert.equal(u.origin,origin,'account_suspension_external_request');
      if(['/','/qa.js','/qa.css'].includes(u.pathname)&&request.method()==='GET')return route.continue();
      const method=request.method(),body=request.postData(),headers={...request.headers(),host:'www.faolla.com',origin:canonical};delete headers['content-length'];
      const req=new Request(canonical+u.pathname+u.search,{method,headers,...(body?{body}: {})});let response;
      if(u.pathname===overview&&method==='GET'){const result=await readOverview(req);response=result instanceof Response?result:Response.json(result);}
      else if(u.pathname===employees&&method==='PATCH')response=await handleEmployee(req);
      else if(u.pathname===endpoint)response=await handleSuspension(req);
      else if(u.pathname===admin&&method==='GET')response=await handleAdmin(req);
      else if(u.pathname==='/api/merchant-enterprise/current-operations'&&method==='GET')response=await handleCurrentOperations(req);
      else throw Error('account_suspension_unexpected_route '+method+' '+u.pathname);
      const text=await response.text(),json=JSON.parse(text),command=body?JSON.parse(body):null;
      requests.push({path:u.pathname,method,mode:u.searchParams.get('mode'),status:response.status,error:json.error??null,operationId:command?.operationId??command?.command?.operationId??u.searchParams.get('operationId')});
      assert(requests.length<=65,'account_suspension_request_budget');
      if(drop===u.pathname&&(method==='PATCH'||method==='POST')){drop=null;assert.equal(response.status,200);return route.abort('failed');}
      await route.fulfill({status:response.status,headers:{'content-type':'application/json','cache-control':'no-store'},body:text});
    })().catch(async error=>{errors.push(String(error?.message??error));if(!closing)await route.abort('failed').catch(()=>{});});inflight.add(task);void task.finally(()=>inflight.delete(task));});
    page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',dialog=>{void(accept?dialog.accept():dialog.dismiss()).catch(error=>{if(!closing)errors.push('dialog '+String(error));});});
    stage='default_off';await page.goto(origin);await row().getByRole('button',{name:'停用',exact:true}).waitFor();await quiet();assert.equal(newRequests().length,0);assert.equal(patches().length,0);checks++;
    await page.getByTestId('feature-on').click();stage='actual_disable';const disabled=await status('disabled');assert(disabled.suspensionId);assert.equal(patches().length,1);checks++;
    stage='account_restore_is_not_attendance_restore';await status('active');const detail=await openDetail(disabled.suspensionId);assert.equal(detail.employeeStatus,'active');assert.equal(detail.canRestore,true);
    assert.equal(detail.workerActive,false);assert(['clock_in','break_start','break_end'].includes(detail.originalAction));assert.equal(detail.currentAction,detail.originalAction);
    assert.equal(detail.pendingReview.unknownOperations,'not_observable');assert.equal(detail.pinInvalidated,true);assert.equal(detail.delegationsInvalidated,true);checks++;
    stage='dirty_and_390';await region().getByLabel('恢复核验理由',{exact:true}).fill('未提交核验理由');accept=false;
    const dismissed=page.waitForEvent('dialog');await region().getByLabel('恢复核验理由',{exact:true}).press('Escape');await dismissed;await quiet();await region().waitFor();assert.equal(await region().getByLabel('恢复核验理由',{exact:true}).inputValue(),'未提交核验理由');accept=true;
    const box=await page.getByRole('dialog',{name:'账号与考勤暂停工作区',exact:true}).boundingBox();assert(box&&box.x>=0&&box.x+box.width<=391);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1));
    const restored=await restore();assert.equal(restored.workerActive,true);await close();checks++;
    stage='lost_status_flagoff_get_only';await page.getByTestId('employees').click();await row().getByRole('button',{name:'停用',exact:true}).waitFor();await status('disabled',{lost:true});
    const raw=await page.evaluate(key=>sessionStorage.getItem(key),statusKey);assert(raw);const op=JSON.parse(raw).command.operationId,beforeRecovery=patches().length;assert.equal(beforeRecovery,3);
    await page.getByTestId('feature-off').click();const recovered=await clickResponse(page.getByRole('button',{name:'核对原员工账号编号',exact:true}),{mode:'recover-status'});
    assert.equal(recovered.statusReceipt.operationId,op);assert.equal(patches().length,beforeRecovery);assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),statusKey),null);checks++;
    // A new account restore is a new explicit intent, never a fallback retry.
    await page.getByTestId('feature-on').click();await status('active');await page.getByTestId('feature-off').click();stage='flagoff_restore_lost_response';
    await openDetail(recovered.statusReceipt.suspensionId);await restore({lost:true});const restoreRaw=await page.evaluate(key=>sessionStorage.getItem(key),restoreKey);assert(restoreRaw);const restoreOp=JSON.parse(restoreRaw).command.operationId,beforeRead=posts().length;
    const recoveredRestore=await clickResponse(region().getByRole('button',{name:'核对原恢复编号',exact:true}),{mode:'recover'});assert.equal(recoveredRestore.receipt.operationId,restoreOp);assert.equal(posts().length,beforeRead);
    await region().locator('[data-account-suspension-receipt]').waitFor();await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await quiet();await region().locator('[data-account-suspension-receipt]').waitFor();await close();checks++;
    const probe=await page.evaluate(()=>({writes:window.__accountSuspensionProbe.writes,csp:window.__accountSuspensionProbe.csp,local:localStorage.getItem('qa-unrelated'),session:sessionStorage.getItem('qa-unrelated')}));
    assert.equal(probe.local,'keep');assert.equal(probe.session,'keep');assert.deepEqual(probe.csp,[]);assert(probe.writes.every(v=>!v.local&&v.method!=='clear'&&[statusKey,restoreKey].includes(v.key)&&v.bytes<=8192));
    assert.equal(patches().length,4);assert(patches().every(v=>v.operationId));assert.equal(posts().length,2);assert.deepEqual(errors,[]);
    return {checks,requests:requests.length,statusPatches:4,restorePosts:2,actualEmployeeManagerAndAdmin:true,syntheticAuth:true,actualHandlerServiceSql:true,
      defaultOffZeroAutomaticRequests:true,lostStatusGetOnly:true,flagOffRestore:true,lostRestoreGetOnly:true,dirtyEscapePreserved:true,width390:true,
      noPersistedPersonalBodyInView:true,otherBrowserUnknownNotObservable:true,unrelatedStoragePreserved:true,externalRequests:0,diskBundles:false,
      unrelatedCurrentOperationsRead:'authenticated route; explicit out-of-scope unavailable store (503), not a simulated success'};
  }catch(error){const diagnostic={stage,message:String(error?.message??error).slice(0,1200),stack:String(error?.stack??'').split('\n').slice(0,2).join('\n'),requests:requests.slice(-8),errors};
    if(page)diagnostic.ui=await page.locator('body').innerText().then(s=>s.slice(-5000)).catch(()=>'<closed>');failure=Error('account_suspension_browser_failed '+JSON.stringify(diagnostic),{cause:error});throw failure;
  }finally{closing=true;await cleanupAccountSuspensionBrowser([
    {name:'account suspension inflight',run:()=>bounded(Promise.allSettled([...inflight]))},
    {name:'account suspension context',run:()=>context?bounded(context.close()):undefined},
    {name:'account suspension browser',run:()=>browser?bounded(browser.close()):undefined},
    {name:'account suspension listener',run:()=>{server.closeAllConnections?.();return server.listening?bounded(new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()))):undefined;}},
    {name:'account suspension esbuild service',run:()=>stop()},
  ],failure);}
}
