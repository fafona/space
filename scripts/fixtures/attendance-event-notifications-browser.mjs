// Inert until the root's owned native runner calls this function. No database,
// browser, server, bundle, or request is started by importing this fixture.
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
const root=fileURLToPath(new URL('../../',import.meta.url)),endpoint='/api/merchant-enterprise/attendance/event-notifications',selfEndpoint='/api/merchant-enterprise/attendance/self';
async function bounded(promise){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('event_notifications_browser_timeout')),15000);})]);}finally{clearTimeout(timer);}}
async function assets(){
  const bundle=await build({absWorkingDir:root,entryPoints:['scripts/fixtures/attendance-event-notifications-browser.tsx'],bundle:true,write:false,metafile:true,platform:'browser',format:'esm',target:['es2020'],jsx:'automatic',
    tsconfig:path.join(root,'tsconfig.json'),outfile:'qa.js',logLevel:'warning',define:{'process.env':'{}','process.env.NODE_ENV':'"development"','process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_LEAVE_NOTIFICATIONS_ENABLED':'"1"'}});
  for(const name of Object.keys(bundle.metafile.inputs))assert(!/node:crypto|\.server\.ts$/.test(name),'event_notifications_server_browser_import');
  const candidates=new Set();for(const name of Object.keys(bundle.metafile.inputs).filter(n=>/\.tsx?$/.test(n)&&!n.includes('node_modules'))){
    const ast=ts.createSourceFile(name,await readFile(path.join(root,name),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
    const visit=node=>{if(ts.isStringLiteral(node)||ts.isNoSubstitutionTemplateLiteral(node)||ts.isTemplateHead(node)||ts.isTemplateMiddle(node)||ts.isTemplateTail(node))node.text.split(/\s+/).filter(Boolean).forEach(v=>candidates.add(v));ts.forEachChild(node,visit);};visit(ast);}
  const css=(await compile('@import "tailwindcss";',{base:root,onDependency:()=>{}})).build([...candidates])
    +'body{margin:0;background:#f1f5f9;font-family:Arial,sans-serif}.qa-toolbar{padding:8px;background:#fff7ed;font-size:12px;overflow-wrap:anywhere}.qa-controls{display:flex;flex-wrap:wrap;gap:6px}.qa-controls button{border:1px solid #94a3b8;background:white;padding:6px}.qa-main{max-width:1000px;margin:auto;padding:8px;min-width:0}';
  return {js:bundle.outputFiles.find(f=>f.path.endsWith('.js')).contents,css};
}
export async function runEventNotificationsBrowserAcceptance(ctx){
  assert(ctx&&typeof ctx.handleNotifications==='function'&&typeof ctx.handleSelf==='function'&&typeof ctx.fingerprint==='function'&&typeof ctx.readState==='function','event_notifications_browser_ports');
  const subject=ctx.subject;for(const name of ['site','employee','auth','worker'])assert.equal(typeof subject?.[name],'string',`event_notifications_subject_${name}`);
  const scope=ctx.scope??ctx.d?.owned;assert(scope?.schema&&ctx.d?.owned?.schema===scope.schema,'event_notifications_owned_schema');
  const initial=await ctx.readState(),selected={};for(const category of ['schedule','work_arrangement','plan_exception']){
    selected[category]=initial.items.find(item=>item.sourceCategory===category&&item.readAt===null);assert(selected[category],`event_notifications_unread_${category}_required`);}
  const protectedTables=ctx.d.inventory().filter(name=>name!=='merchant_attendance_event_notification_reads'),protectedFacts=ctx.d.fingerprint(protectedTables);
  const canonical=ctx.origin??'https://www.faolla.com',key=`faolla:attendance:event-notifications:v1:${subject.site}:${subject.employee}`;
  const requests=[],errors=[],inflight=new Set(),storageHistory=[],cspHistory=[];
  let files,browser,context,page,origin,closing=false,accept=true,serverRead=true,dropAfterWrite=false,dropBeforeWrite=false,stage='setup',failure=null,checks=0,holdGet=false,releaseGet=null,heldObserved=null;
  const server=createServer((request,response)=>{if(!origin||request.headers.host!==new URL(origin).host||request.method!=='GET')return response.writeHead(403).end();
    response.setHeader('Cache-Control','no-store');response.setHeader('X-Content-Type-Options','nosniff');response.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; object-src 'none'");
    const u=new URL(request.url??'/',origin);if(u.search)return response.writeHead(403).end();
    if(u.pathname==='/')return response.writeHead(200,{'Content-Type':'text/html;charset=utf-8'}).end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>考勤消息隔离验收</title><link rel="stylesheet" href="/qa.css"><div id="qa-root"></div><script type="module" src="/qa.js"></script></html>');
    if(u.pathname==='/qa.js')return response.writeHead(200,{'Content-Type':'text/javascript;charset=utf-8'}).end(files.js);if(u.pathname==='/qa.css')return response.writeHead(200,{'Content-Type':'text/css;charset=utf-8'}).end(files.css);return response.writeHead(403).end();});
  const region=()=>page.getByRole('region',{name:'考勤消息',exact:true}),own=()=>requests.filter(r=>r.path===endpoint),posts=()=>own().filter(r=>r.method==='POST');
  const quiet=async()=>{await page.waitForLoadState('networkidle');await bounded(Promise.all([...inflight]));};
  const responseClick=async(locator,{method='GET',id=null,status=200}={})=>{
    const [response]=await Promise.all([page.waitForResponse(r=>{const u=new URL(r.url());if(u.pathname!==endpoint||r.request().method()!==method)return false;
      return (method==='POST'?r.request().postDataJSON().command.notificationId:u.searchParams.get('notificationId'))===id;}),locator.click()]);
    await response.finished();const text=await response.text();assert.equal(response.status(),status,text);return JSON.parse(text);
  };
  const open=async(off=false)=>{await page.getByRole('button',{name:off?'核对待确认消息标读':'考勤消息',exact:true}).click();await region().waitFor();};
  const close=async()=>{await region().getByRole('button',{name:'关闭考勤消息',exact:true}).click();await page.getByRole('dialog',{name:'考勤消息工作区',exact:true}).waitFor({state:'detached'});};
  const loadDetail=async(item)=>{await responseClick(region().getByRole('button',{name:'读取考勤消息',exact:true}));
    let row=region().locator(`[data-event-notification-id="${item.notificationId}"]`),pages=0;
    while(await row.count()===0){assert(++pages<=1,'event_notifications_browser_page_budget');await responseClick(region().getByRole('button',{name:'下一页考勤消息',exact:true}));row=region().locator(`[data-event-notification-id="${item.notificationId}"]`);}
    const reply=await responseClick(row.getByRole('button',{name:'查看考勤消息详情',exact:true}),{id:item.notificationId});await region().locator(`[data-event-notifications-detail="${item.sourceCategory}"]`).waitFor();
    assert.equal(reply.detail.notificationId,item.notificationId);assert.equal(reply.detail.readAt,item.readAt);assert((await region().innerText()).includes('当前事项状态未重新核查'));
    const summary=reply.detail.summary,spans=summary.segments??[summary];for(const span of spans){for(const value of [span.startAt,span.endAt,span.timeZone])assert((await region().innerText()).includes(value));}
    return reply;
  };
  const confirmRead=async(retry=false)=>{await region().getByLabel('确认仅标读这条消息',{exact:true}).check();return region().getByRole('button',{name:retry?'明确再次标记这条消息已读':'明确标记这条消息已读',exact:true});};
  const dropClick=async(locator)=>{const failed=page.waitForEvent('requestfailed',{predicate:request=>new URL(request.url()).pathname===endpoint&&request.method()==='POST'});await locator.click();await failed;await quiet();await region().locator('[data-event-notifications-pending]').waitFor();};
  try{
    files=await assets();await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const address=server.address();assert(address&&typeof address==='object');origin=`http://127.0.0.1:${address.port}`;
    browser=await chromium.launch({headless:true});context=await browser.newContext({serviceWorkers:'block',acceptDownloads:false,viewport:{width:390,height:900}});
    await context.addInitScript(seed=>{Object.defineProperty(window,'__eventNotificationsSeed',{value:seed});const set=Storage.prototype.setItem;set.call(sessionStorage,'qa-unrelated','keep');set.call(localStorage,'qa-unrelated','keep');
      const probe={writes:[],csp:[]};Object.defineProperty(window,'__eventNotificationsProbe',{value:probe});for(const method of ['setItem','removeItem','clear']){const old=Storage.prototype[method];Storage.prototype[method]=function(...args){probe.writes.push({method,key:args[0]??null,local:this===localStorage,bytes:method==='setItem'?new TextEncoder().encode(args[1]).byteLength:0});return old.apply(this,args);};}
      document.addEventListener('securitypolicyviolation',event=>probe.csp.push(event.violatedDirective));
    },{site:subject.site,employee:subject.employee});
    await context.route('**/*',route=>{if(closing)return route.abort().catch(()=>{});const task=(async()=>{const request=route.request(),url=new URL(request.url());assert.equal(url.origin,origin,'event_notifications_external_request');
      if(['/','/qa.js','/qa.css'].includes(url.pathname)){assert.equal(request.method(),'GET');assert.equal(url.search,'');return route.continue();}
      assert(requests.length<36,'event_notifications_browser_total_budget');assert([endpoint,selfEndpoint].includes(url.pathname),'event_notifications_unexpected_endpoint');const method=request.method(),text=request.postData();
      if(text)assert(Buffer.byteLength(text,'utf8')<=4096);const body=text?JSON.parse(text):null,id=body?.command.notificationId??url.searchParams.get('notificationId');
      if(url.pathname===endpoint){assert(own().length<24,'event_notifications_browser_api_budget');assert(['GET','POST'].includes(method));
        if(method==='POST'){assert.deepEqual(Object.keys(body.command).sort(),['action','notificationId']);assert.equal(body.command.action,'mark_read');
          if(dropBeforeWrite){dropBeforeWrite=false;requests.push({path:url.pathname,method,status:null,id,error:'synthetic_request_lost_before_server',reachedServer:false});return route.abort('failed');}}}
      else assert.equal(method,'GET');
      const mapped=new Request(canonical+url.pathname+url.search,{method,headers:{host:new URL(canonical).host,origin:canonical,'sec-fetch-site':'same-origin',...(text?{'content-type':'application/json'}:{})},...(text?{body:text}:{})});
      const before=await ctx.fingerprint(),response=url.pathname===endpoint?await ctx.handleNotifications(mapped,{enabled:()=>serverRead}):await ctx.handleSelf(mapped),output=await response.text(),payload=JSON.parse(output);
      if(method==='GET')assert.equal(await ctx.fingerprint(),before,'event_notifications_get_wrote');
      requests.push({path:url.pathname,method,status:response.status,id,error:payload.error??null,reachedServer:true});let heldResponse=false;
      if(url.pathname===endpoint){assert.equal(response.headers.get('cache-control'),'private, no-store');if(method==='POST'&&dropAfterWrite){dropAfterWrite=false;assert.equal(response.status,200,output);assert(payload.detail.readAt);return route.abort('failed');}
        if(method==='GET'&&holdGet){holdGet=false;heldResponse=true;await new Promise(resolve=>{releaseGet=resolve;heldObserved?.();});}}
      try{return await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:output});}catch(error){if(heldResponse&&request.failure())return;throw error;}
    })();inflight.add(task);void task.finally(()=>inflight.delete(task)).catch(()=>{});return task.catch(async error=>{if(!closing)errors.push(error.message);await route.abort().catch(()=>{});});});
    page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',error=>errors.push(error.message));page.on('popup',()=>errors.push('unexpected_popup'));
    page.on('dialog',dialog=>{void(accept?dialog.accept():dialog.dismiss()).catch(error=>{if(!closing)errors.push('dialog_failed:'+error.message);});});
    stage='default_off_actual_parent';await page.goto(origin);await quiet();await page.getByRole('region',{name:'我的考勤',exact:true}).waitFor();assert.equal(own().length,0);
    assert.equal(await page.getByRole('button',{name:'考勤消息',exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'请假结果通知',exact:true}).count(),1);checks++;
    stage='schedule_explicit_read_and_dirty_escape';await page.getByTestId('feature-on').click();await open();await quiet();assert.equal(own().length,0);
    const schedule=await loadDetail(selected.schedule);assert.equal(posts().length,0);const markButton=await confirmRead();
    accept=false;const escape=page.waitForEvent('dialog');await page.keyboard.press('Escape');await escape;await region().waitFor();assert.equal(await region().getByLabel('确认仅标读这条消息',{exact:true}).isChecked(),true);assert.equal(posts().length,0);accept=true;
    const marked=await responseClick(markButton,{method:'POST',id:selected.schedule.notificationId});assert(marked.detail.readAt);assert.deepEqual(marked.detail.summary,schedule.detail.summary);await region().locator('[data-event-notification-read-at]').waitFor();
    assert.equal(await region().getByRole('button',{name:'明确标记这条消息已读',exact:true}).count(),0);checks++;
    stage='work_result_lost_response';await loadDetail(selected.work_arrangement);dropAfterWrite=true;await dropClick(await confirmRead());const savedRaw=await page.evaluate(storageKey=>sessionStorage.getItem(storageKey),key);assert(savedRaw);
    assert.deepEqual(Object.keys(JSON.parse(savedRaw)).sort(),['version','siteId','employeeId','actorId','workerId','notificationId'].sort());assert.equal(JSON.parse(savedRaw).notificationId,selected.work_arrangement.notificationId);
    assert.equal(await region().locator('[data-event-notifications-detail]').count(),0);const beforeReload=own().length,postCount=posts().length;assert.equal(postCount,2);
    const earlier=await page.evaluate(()=>window.__eventNotificationsProbe);storageHistory.push(...earlier.writes);cspHistory.push(...earlier.csp);
    stage='frontend_off_read_off_retains_then_get_only';await page.reload();await quiet();assert.equal(own().length,beforeReload);await open(true);await region().locator('[data-event-notifications-pending]').waitFor();assert.equal(own().length,beforeReload);
    serverRead=false;const rejected=await responseClick(region().getByRole('button',{name:'核对原消息已读结果',exact:true}),{id:selected.work_arrangement.notificationId,status:404});assert.equal(rejected.error,'attendance_not_available');
    assert.equal(await page.evaluate(storageKey=>sessionStorage.getItem(storageKey),key),savedRaw);assert.equal(posts().length,postCount);
    serverRead=true;const recovered=await responseClick(region().getByRole('button',{name:'核对原消息已读结果',exact:true}),{id:selected.work_arrangement.notificationId});assert(recovered.detail.readAt);await region().locator('[data-event-notification-read-at]').waitFor();
    assert.equal(await page.evaluate(storageKey=>sessionStorage.getItem(storageKey),key),null);assert.equal(posts().length,postCount);
    const beforeFocus=own().length;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await quiet();await region().locator('[data-event-notification-read-at]').waitFor();assert.equal(own().length,beforeFocus);
    await close();await page.getByRole('button',{name:'核对待确认消息标读',exact:true}).waitFor({state:'detached'});checks++;
    stage='exception_unread_get_never_auto_posts';await page.getByTestId('feature-on').click();await open();const exception=await loadDetail(selected.plan_exception);dropBeforeWrite=true;await dropClick(await confirmRead());
    const unreadRaw=await page.evaluate(storageKey=>sessionStorage.getItem(storageKey),key);assert(unreadRaw);const beforeRecoveryPosts=posts().length;
    const unread=await responseClick(region().getByRole('button',{name:'核对原消息已读结果',exact:true}),{id:selected.plan_exception.notificationId});assert.equal(unread.detail.readAt,null);await quiet();
    assert.equal(await page.evaluate(storageKey=>sessionStorage.getItem(storageKey),key),unreadRaw);assert.equal(posts().length,beforeRecoveryPosts);await region().getByRole('button',{name:'明确再次标记这条消息已读',exact:true}).waitFor();
    const finalRead=await responseClick(await confirmRead(true),{method:'POST',id:selected.plan_exception.notificationId});assert(finalRead.detail.readAt);assert.deepEqual(finalRead.detail.summary,exception.detail.summary);await region().locator('[data-event-notification-read-at]').waitFor();checks++;
    stage='narrow_layout';assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false,'event_notifications_390_document_overflow');
    assert.equal(await region().evaluate(element=>element.scrollWidth>element.clientWidth+2),false,'event_notifications_390_panel_overflow');
    const dialogBox=await page.getByRole('dialog',{name:'考勤消息工作区',exact:true}).boundingBox();assert(dialogBox&&dialogBox.x>=0&&dialogBox.width<=390);checks++;
    stage='hidden_late_get_clears';const held=new Promise(resolve=>{heldObserved=resolve;});holdGet=true;await region().getByRole('button',{name:'读取考勤消息',exact:true}).click();await bounded(held);
    await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});releaseGet();releaseGet=null;await quiet();
    assert.equal(await region().locator('[data-event-notification-id]').count(),0);assert.equal(await region().locator('[data-event-notifications-detail]').count(),0);const afterHidden=own().length;
    await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));});await quiet();assert.equal(own().length,afterHidden);await close();checks++;
    const probe=await page.evaluate(()=>({writes:window.__eventNotificationsProbe.writes,csp:window.__eventNotificationsProbe.csp,local:localStorage.getItem('qa-unrelated'),session:sessionStorage.getItem('qa-unrelated')}));
    storageHistory.push(...probe.writes);cspHistory.push(...probe.csp);assert.equal(probe.local,'keep');assert.equal(probe.session,'keep');assert.deepEqual(cspHistory,[]);
    assert(storageHistory.every(item=>!item.local&&item.method!=='clear'&&item.key===key&&item.bytes<=4096));assert.equal(posts().length,4);assert.equal(posts().filter(r=>r.reachedServer).length,3);assert.deepEqual(errors,[]);
    assert.equal(ctx.d.fingerprint(protectedTables),protectedFacts,'event_notifications_browser_changed_original_business_or_captures');
    const final=await ctx.readState();for(const item of Object.values(selected))assert(final.items.find(v=>v.notificationId===item.notificationId)?.readAt);
    return {checks,requests:requests.length,notificationRequests:own().length,postAttempts:posts().length,actualMarkReadPosts:3,requestLostBeforeServer:1,actualSelfParent:true,actualHandlerServiceSql:true,syntheticAuth:true,
      threeHistoricalCategories:true,oldLeaveEntryPreserved:true,explicitReadOnlyCheckbox:true,dirtyEscapeDismissed:true,frontendOffRecoveryOnly:true,serverReadOff404Retains:true,
      unreadRecoveryNeverAutoPosts:true,explicitSameMessageRetry:true,recoveredDetailSurvivesFocus:true,hiddenLateReadCleared:true,width390:true,getFactHashesUnchanged:true,originalBusinessAndCaptureHashesUnchanged:true,
      externalRequests:0,diskBundles:false,realLogin:false};
  }catch(error){const diagnostic={stage,message:String(error?.message??error).slice(0,1500),stack:String(error?.stack??'').split('\n').slice(0,2).join('\n'),requests:requests.slice(-8),errors};
    if(page)diagnostic.ui=await page.locator('body').innerText().then(text=>text.slice(-6000)).catch(()=>'<closed>');failure=Error('event_notifications_browser_failed '+JSON.stringify(diagnostic),{cause:error});throw failure;
  }finally{closing=true;releaseGet?.();try{await runAttendanceCleanupSteps([
    {name:'event notifications inflight',run:()=>bounded(Promise.allSettled([...inflight]))},
    {name:'event notifications context',run:()=>context?bounded(context.close()):undefined},
    {name:'event notifications browser',run:()=>browser?bounded(browser.close()):undefined},
    {name:'event notifications HTTP listener',run:()=>{server.closeAllConnections?.();return server.listening?bounded(new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()))):undefined;}},
    {name:'event notifications esbuild service',run:()=>stop()},
  ]);}catch(error){if(failure)throw new AggregateError([failure,error],'event_notifications_and_cleanup_failed',{cause:failure});throw error;}}
}
