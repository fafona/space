// Inert until the root's ownership-checked native driver invokes the callback.
// No browser, server, bundle, or request is started by importing this module.
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
const root=fileURLToPath(new URL('../../',import.meta.url));
const exceptionApi='/api/merchant-enterprise/attendance/plan-exceptions',notificationApi='/api/merchant-enterprise/attendance/event-notifications';
const adminApi='/api/merchant-enterprise/attendance/admin',selfApi='/api/merchant-enterprise/attendance/self';
const clearanceLabel='核对后未触发本次迟到／早退规则';
async function bounded(promise){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('plan_clearance_browser_timeout')),15000);})]);}finally{clearTimeout(timer);}}
async function assets(){
  const bundle=await build({absWorkingDir:root,entryPoints:['scripts/fixtures/attendance-plan-clearance-browser.tsx'],bundle:true,write:false,metafile:true,platform:'browser',format:'esm',target:['es2020'],jsx:'automatic',
    tsconfig:path.join(root,'tsconfig.json'),outfile:'qa.js',logLevel:'warning',define:{'process.env':'{}','process.env.NODE_ENV':'"development"',
      'process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_PLAN_CLEARANCE_ENABLED':'window.__planClearanceFlag'}});
  for(const name of Object.keys(bundle.metafile.inputs))assert(!/node:crypto|\.server\.ts$/.test(name),'plan_clearance_server_browser_import');
  const candidates=new Set();for(const name of Object.keys(bundle.metafile.inputs).filter(n=>/\.tsx?$/.test(n)&&!n.includes('node_modules'))){
    const ast=ts.createSourceFile(name,await readFile(path.join(root,name),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
    const visit=node=>{if(ts.isStringLiteral(node)||ts.isNoSubstitutionTemplateLiteral(node)||ts.isTemplateHead(node)||ts.isTemplateMiddle(node)||ts.isTemplateTail(node))node.text.split(/\s+/).filter(Boolean).forEach(v=>candidates.add(v));ts.forEachChild(node,visit);};visit(ast);}
  const css=(await compile('@import "tailwindcss";',{base:root,onDependency:()=>{}})).build([...candidates])
    +'body{margin:0;background:#f1f5f9;font-family:Arial,sans-serif}.qa-toolbar{padding:8px;background:#fff7ed;font-size:12px;overflow-wrap:anywhere}.qa-controls{display:flex;flex-wrap:wrap;gap:6px}.qa-controls button{border:1px solid #94a3b8;background:white;padding:6px}.qa-main{max-width:1000px;margin:auto;padding:8px;min-width:0}';
  return {js:bundle.outputFiles.find(f=>f.path.endsWith('.js')).contents,css};
}
export async function runPlanClearanceBrowserAcceptance(ctx){
  for(const name of ['handleAdmin','handleSelf','handleException','handleNotifications','fingerprint'])assert.equal(typeof ctx?.[name],'function',`plan_clearance_port_${name}`);
  const subject=ctx.subject;for(const name of ['site','owner','employee','auth','worker','slotId'])assert.equal(typeof subject?.[name],'string',`plan_clearance_subject_${name}`);
  const scope=ctx.scope??ctx.d?.owned;assert(scope?.schema&&(!ctx.d?.owned||ctx.d.owned.schema===scope.schema),'plan_clearance_owned_schema');
  const canonical=ctx.origin??'https://www.faolla.com',ownerKey=`faolla:attendance:plan-exceptions:v1:${subject.site}:owner:${subject.owner}`;
  const allowedKeys=[ownerKey,`faolla:attendance:plan-exceptions:v1:${subject.site}:self:${subject.employee}`,`faolla:attendance:event-notifications:v1:${subject.site}:${subject.employee}`];
  const requests=[],errors=[],inflight=new Set(),storageHistory=[],cspHistory=[];
  let files,browser,context,page,origin,closing=false,accept=true,serverClearance=true,dropPost=false,stage='setup',failure=null,checks=0;
  let holdGet=false,heldObserved=null,releaseGet=null,lostOperation=null;
  const server=createServer((request,response)=>{if(!origin||request.headers.host!==new URL(origin).host||request.method!=='GET')return response.writeHead(403).end();
    response.setHeader('Cache-Control','no-store');response.setHeader('X-Content-Type-Options','nosniff');response.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; object-src 'none'");
    const u=new URL(request.url??'/',origin);if(u.search)return response.writeHead(403).end();
    if(u.pathname==='/')return response.writeHead(200,{'Content-Type':'text/html;charset=utf-8'}).end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>结案隔离验收</title><link rel="stylesheet" href="/qa.css"><div id="qa-root"></div><script type="module" src="/qa.js"></script></html>');
    if(u.pathname==='/qa.js')return response.writeHead(200,{'Content-Type':'text/javascript;charset=utf-8'}).end(files.js);if(u.pathname==='/qa.css')return response.writeHead(200,{'Content-Type':'text/css;charset=utf-8'}).end(files.css);return response.writeHead(403).end();});
  const region=(access='owner')=>page.getByRole('region',{name:access==='owner'?'排班异常处理':'异常说明与处理结果',exact:true});
  const own=()=>requests.filter(r=>[exceptionApi,notificationApi].includes(r.path)),posts=()=>requests.filter(r=>r.method==='POST');
  const quiet=async()=>{await page.waitForLoadState('networkidle');await bounded(Promise.all([...inflight]));};
  const responseClick=async(locator,{api=exceptionApi,method='GET',mode=null,id=null,status=200}={})=>{
    const [response]=await Promise.all([page.waitForResponse(r=>{const u=new URL(r.url());if(u.pathname!==api||r.request().method()!==method)return false;
      const body=method==='POST'?r.request().postDataJSON():null;return (!mode||(body?.query?.mode??u.searchParams.get('mode'))===mode)
        &&(!id||(body?.command.notificationId??u.searchParams.get('notificationId'))===id);}),locator.click()]);
    await response.finished();const text=await response.text();assert.equal(response.status(),status,text);return JSON.parse(text);
  };
  const open=async(access='owner')=>{await page.getByRole('button',{name:access==='owner'?'排班异常处理／历史与恢复':'异常说明与处理结果',exact:true}).click();await region(access).waitFor();};
  const loadDetail=async(access='owner')=>{const panel=region(access);await responseClick(panel.getByRole('button',{name:'读取异常处理记录',exact:true}),{mode:'list'});
    const row=panel.locator(`[data-plan-exception-slot="${subject.slotId}"]`);await row.waitFor();const reply=await responseClick(row.getByRole('button',{name:'查看说明与处理',exact:true}),{mode:'detail'});
    await panel.locator('[data-plan-exception-detail]').waitFor();assert.equal(reply.data.detail.slotId,subject.slotId);return reply.data.detail;
  };
  const close=async(access='owner')=>{await region(access).getByRole('button',{name:'返回考勤',exact:true}).click();await region(access).waitFor({state:'detached'});};
  const narrow=async(locator)=>{assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false,'plan_clearance_390_document_overflow');
    assert.equal(await locator.evaluate(element=>element.scrollWidth>element.clientWidth+2),false,'plan_clearance_390_component_overflow');};
  try{
    files=await assets();await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const address=server.address();assert(address&&typeof address==='object');origin=`http://127.0.0.1:${address.port}`;
    browser=await chromium.launch({headless:true});context=await browser.newContext({serviceWorkers:'block',acceptDownloads:false,viewport:{width:390,height:900}});
    await context.addInitScript(seed=>{Object.defineProperty(window,'__planClearanceSeed',{value:seed});window.__planClearanceFlag='0';
      const set=Storage.prototype.setItem;set.call(sessionStorage,'qa-unrelated','keep');set.call(localStorage,'qa-unrelated','keep');
      const probe={writes:[],csp:[]};Object.defineProperty(window,'__planClearanceProbe',{value:probe});for(const method of ['setItem','removeItem','clear']){const old=Storage.prototype[method];Storage.prototype[method]=function(...args){probe.writes.push({method,key:args[0]??null,local:this===localStorage,bytes:method==='setItem'?new TextEncoder().encode(args[1]).byteLength:0});return old.apply(this,args);};}
      document.addEventListener('securitypolicyviolation',event=>probe.csp.push(event.violatedDirective));
    },{site:subject.site,owner:subject.owner,employee:subject.employee});
    await context.route('**/*',route=>{if(closing)return route.abort().catch(()=>{});const task=(async()=>{const request=route.request(),url=new URL(request.url());assert.equal(url.origin,origin,'plan_clearance_external_request');
      if(['/','/qa.js','/qa.css'].includes(url.pathname)){assert.equal(request.method(),'GET');assert.equal(url.search,'');return route.continue();}
      assert(requests.length<40&&own().length<30,'plan_clearance_browser_request_budget');assert([adminApi,selfApi,exceptionApi,notificationApi].includes(url.pathname),'plan_clearance_unexpected_api');
      const method=request.method(),text=request.postData(),body=text?JSON.parse(text):null,access=request.headers()['x-plan-clearance-access'];assert(['owner','self'].includes(access));assert(['GET','POST'].includes(method));
      if(text)assert(Buffer.byteLength(text,'utf8')<=8192);if([adminApi,selfApi].includes(url.pathname))assert.equal(method,'GET');
      if(method==='POST'&&url.pathname===exceptionApi)assert(['decide','ack'].includes(body.query.mode));
      if(method==='POST'&&url.pathname===notificationApi){assert.deepEqual(Object.keys(body.command).sort(),['action','notificationId']);assert.equal(body.command.action,'mark_read');}
      const mapped=new Request(canonical+url.pathname+url.search,{method,headers:{host:new URL(canonical).host,origin:canonical,'sec-fetch-site':'same-origin',...(text?{'content-type':'application/json'}:{})},...(text?{body:text}:{})});
      const before=await ctx.fingerprint();const response=url.pathname===adminApi?await ctx.handleAdmin(mapped):url.pathname===selfApi?await ctx.handleSelf(mapped)
        :url.pathname===exceptionApi?await ctx.handleException(mapped,access,{clearanceEnabled:serverClearance}):await ctx.handleNotifications(mapped);
      const output=await response.text(),payload=JSON.parse(output);if(method==='GET')assert.equal(await ctx.fingerprint(),before,'plan_clearance_get_wrote');
      requests.push({path:url.pathname,method,access,status:response.status,mode:body?.query?.mode??url.searchParams.get('mode'),error:payload.error??null});
      if(url.pathname===exceptionApi&&method==='POST'&&dropPost){dropPost=false;assert.equal(body.command.outcome,'cleared');assert.equal(response.status,200,output);
        assert.equal(payload.data.receipt.item.outcome,'cleared');lostOperation=body.command.operationId;return route.abort('failed');}
      let heldResponse=false;if(url.pathname===exceptionApi&&method==='GET'&&holdGet){holdGet=false;heldResponse=true;await new Promise(resolve=>{releaseGet=resolve;heldObserved?.();});}
      try{return await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:output});}catch(error){if(heldResponse&&request.failure())return;throw error;}
    })();inflight.add(task);void task.finally(()=>inflight.delete(task)).catch(()=>{});return task.catch(async error=>{if(!closing)errors.push(error.message);await route.abort().catch(()=>{});});});
    page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',error=>errors.push(error.message));page.on('popup',()=>errors.push('unexpected_popup'));
    page.on('dialog',dialog=>{void(accept?dialog.accept():dialog.dismiss()).catch(error=>{if(!closing)errors.push('dialog_failed:'+error.message);});});
    stage='actual_owner_default_off';await page.goto(origin);await quiet();await page.getByRole('region',{name:'考勤配置管理',exact:true}).waitFor();assert.equal(own().length,0);
    await open();await quiet();assert.equal(own().length,0);const first=await loadDetail();assert(first.caseId&&first.revision>=1);
    // Root may supply an old cleared decision made stale by a later actual
    // correction. It remains visible; this UI must explicitly append a fresh one.
    if(first.latestDecision.outcome==='cleared'){assert.equal(first.stale,true);await region().locator('[data-plan-exception-cleared]').waitFor();}
    const select=region().getByLabel('异常处理选择',{exact:true});assert.deepEqual(await select.locator('option').allTextContents(),['请选择明确处理','继续核查','确认异常','说明后豁免']);
    assert.equal(await select.locator('option[value="cleared"]').count(),0);await close();checks++;
    stage='existing_case_explicit_clearance_dirty_leave';await page.getByTestId('clearance-on').click();await open();const detail=await loadDetail();assert(detail.current.eligible);
    assert.equal(detail.current.candidate.late.state,'not_triggered');assert.equal(detail.current.candidate.early.state,'not_triggered');
    assert.equal(await region().getByLabel('异常处理选择',{exact:true}).locator('option[value="cleared"]').isDisabled(),false);
    await region().getByLabel('异常处理选择',{exact:true}).selectOption('cleared');await region().getByLabel('异常处理理由',{exact:true}).fill('本地隔离验收：逐项核对保存宽限及原始、核定端点，本次两项均未触发。');
    accept=false;const leaveDialog=page.waitForEvent('dialog');await region().getByRole('button',{name:'返回考勤',exact:true}).click();await leaveDialog;await region().waitFor();
    assert.equal(await region().getByLabel('异常处理选择',{exact:true}).inputValue(),'cleared');assert.equal(posts().length,0);accept=true;await narrow(region());checks++;
    stage='clearance_lost_response';dropPost=true;const failed=page.waitForEvent('requestfailed',{predicate:r=>new URL(r.url()).pathname===exceptionApi&&r.method()==='POST'});
    await region().getByRole('button',{name:'确认保存异常处理',exact:true}).click();await failed;await quiet();await region().locator('[data-plan-exception-pending]').waitFor();
    const raw=await page.evaluate(key=>sessionStorage.getItem(key),ownerKey);assert(raw);assert.equal(JSON.parse(raw).command.operationId,lostOperation);assert.equal(JSON.parse(raw).command.outcome,'cleared');
    assert.equal(posts().length,1);const beforeReload=own().length,earlier=await page.evaluate(()=>window.__planClearanceProbe);storageHistory.push(...earlier.writes);cspHistory.push(...earlier.csp);
    serverClearance=false;await page.reload();await quiet();assert.equal(own().length,beforeReload);await open();await region().locator('[data-plan-exception-pending]').waitFor();assert.equal(own().length,beforeReload);
    assert.equal(await region().getByRole('button',{name:'原编号核对并重试',exact:true}).isDisabled(),true);
    const restored=await responseClick(region().getByRole('button',{name:'核对原异常编号',exact:true}),{mode:'recover'});assert.equal(restored.data.receipt.operationId,lostOperation);
    await region().locator('[data-plan-exception-cleared]').waitFor();assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),ownerKey),null);assert.equal(posts().length,1);
    assert((await region().innerText()).includes('当前依据未重新核查'));assert((await region().innerText()).includes(clearanceLabel));await narrow(region());await close();checks++;
    stage='actual_self_history_and_explicit_business_read';await page.getByTestId('self-parent').click();await page.getByRole('region',{name:'我的考勤',exact:true}).waitFor();await quiet();await open('self');
    const selfDetail=await loadDetail('self');assert.equal(selfDetail.latestDecision.operationId,lostOperation);assert.equal(selfDetail.currentValidation,'not_checked');
    await region('self').locator('[data-plan-exception-cleared]').waitFor();assert((await region('self').innerText()).includes('已读不等于认可'));assert.equal(selfDetail.latestDecision.readAt,null);
    const read=await responseClick(region('self').getByRole('button',{name:'明确已读处理结果',exact:true}),{method:'POST',mode:'ack'});assert.equal(read.data.readReceipt.decisionOperationId,lostOperation);
    await region('self').getByRole('button',{name:'本决定已明确已读',exact:true}).waitFor();assert.equal(posts().length,2);await narrow(region('self'));await close('self');checks++;
    stage='actual_notification_clearance_and_explicit_message_read';await page.getByRole('button',{name:'考勤消息',exact:true}).click();const notifications=page.getByRole('region',{name:'考勤消息',exact:true});await notifications.waitFor();
    const listed=await responseClick(notifications.getByRole('button',{name:'读取考勤消息',exact:true}),{api:notificationApi});
    const message=listed.items.find(item=>item.sourceCategory==='plan_exception'&&item.type==='cleared'&&item.sourceOperationId===lostOperation);assert(message,'clearance_notification_missing');
    const messageReply=await responseClick(notifications.locator(`[data-event-notification-id="${message.notificationId}"]`).getByRole('button',{name:'查看考勤消息详情',exact:true}),{api:notificationApi,id:message.notificationId});
    assert.equal(messageReply.detail.summary.outcome,'cleared');assert.equal(messageReply.detail.readAt,null);await notifications.locator('[data-event-notification-cleared]').waitFor();
    assert((await notifications.innerText()).includes('不提交异常业务已读确认'));await narrow(notifications);
    await notifications.getByLabel('确认仅标读这条消息',{exact:true}).check();const marked=await responseClick(notifications.getByRole('button',{name:'明确标记这条消息已读',exact:true}),{api:notificationApi,method:'POST',id:message.notificationId});
    assert(marked.detail.readAt);assert.deepEqual(marked.detail.summary,messageReply.detail.summary);await notifications.locator('[data-event-notification-read-at]').waitFor();
    await notifications.getByRole('button',{name:'关闭考勤消息',exact:true}).click();await page.getByRole('dialog',{name:'考勤消息工作区',exact:true}).waitFor({state:'detached'});checks++;
    stage='hidden_late_read';await open('self');const held=new Promise(resolve=>{heldObserved=resolve;});holdGet=true;await region('self').getByRole('button',{name:'读取异常处理记录',exact:true}).click();await bounded(held);
    await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});releaseGet();releaseGet=null;await quiet();
    assert.equal(await region('self').locator('[data-plan-exception-detail],[data-plan-exception-case]').count(),0);const afterHidden=own().length;
    await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));});await quiet();assert.equal(own().length,afterHidden);await close('self');checks++;
    const probe=await page.evaluate(()=>({writes:window.__planClearanceProbe.writes,csp:window.__planClearanceProbe.csp,local:localStorage.getItem('qa-unrelated'),session:sessionStorage.getItem('qa-unrelated')}));
    storageHistory.push(...probe.writes);cspHistory.push(...probe.csp);assert.equal(probe.local,'keep');assert.equal(probe.session,'keep');assert.deepEqual(cspHistory,[]);
    assert(storageHistory.every(item=>!item.local&&item.method!=='clear'&&allowedKeys.includes(item.key)&&item.bytes<=8192));assert.equal(posts().length,3);assert.deepEqual(errors,[]);
    return {checks,requests:requests.length,workflowRequests:own().length,posts:posts().length,actualAdminAndSelfParents:true,actualHandlerServiceSql:true,syntheticAuth:true,
      oldThreeOptionsPreserved:true,independentDefaultOff:true,existingCaseRequired:true,dirtyLeaveDismissed:true,lostClearanceGetOnlyRecovery:true,writeFlagOffHistoryAndRecovery:true,
      selfBusinessReadExplicit:true,messageReadSeparate:true,hiddenLateReadCleared:true,width390:true,getFactHashesUnchanged:true,externalRequests:0,diskBundles:false,realLogin:false};
  }catch(error){const diagnostic={stage,message:String(error?.message??error).slice(0,1500),stack:String(error?.stack??'').split('\n').slice(0,2).join('\n'),requests:requests.slice(-8),errors};
    if(page)diagnostic.ui=await page.locator('body').innerText().then(text=>text.slice(-6500)).catch(()=>'<closed>');failure=Error('plan_clearance_browser_failed '+JSON.stringify(diagnostic),{cause:error});throw failure;
  }finally{closing=true;releaseGet?.();try{await runAttendanceCleanupSteps([
    {name:'plan clearance inflight',run:()=>bounded(Promise.allSettled([...inflight]))},
    {name:'plan clearance context',run:()=>context?bounded(context.close()):undefined},
    {name:'plan clearance browser',run:()=>browser?bounded(browser.close()):undefined},
    {name:'plan clearance HTTP listener',run:()=>{server.closeAllConnections?.();return server.listening?bounded(new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()))):undefined;}},
    {name:'plan clearance esbuild service',run:()=>stop()},
  ]);}catch(error){if(failure)throw new AggregateError([failure,error],'plan_clearance_and_cleanup_failed',{cause:failure});throw error;}}
}
