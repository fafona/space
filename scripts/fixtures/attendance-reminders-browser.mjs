//201 INERT unless --run-local. Four finite groups, actual UI/synthetic HTTP.
//Five original approval paths test safe-denial dispatch only, NOT approval.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {runAttendanceCleanupSteps} from './attendance-cleanup.mjs';
import {createRemindersBrowserModel,reminderBrowserPaths as paths} from './attendance-reminders-browser-model.mjs';
export {createRemindersBrowserModel,reminderBrowserPaths} from './attendance-reminders-browser-model.mjs';
export const remindersBrowserLimits=Object.freeze({groups:4,api:60,http:85,posts:3,ttlMs:180000,mobileWidth:390});
const root=fileURLToPath(new URL('../../',import.meta.url)),statics=['/','/qa.js','/qa.css','/favicon.ico'];
async function bounded(work,ms=12000){let timer;try{return await Promise.race([work,new Promise((_,no)=>{timer=setTimeout(()=>no(Error('reminder_browser_deadline')),ms);})]);}finally{clearTimeout(timer);}}
async function assets(seed){
 const{build}=await import('esbuild'),{compile}=await import('@tailwindcss/node'),{default:ts}=await import('typescript');
 const bundle=await build({absWorkingDir:root,entryPoints:['scripts/fixtures/attendance-reminders-browser-entry.tsx'],bundle:true,write:false,metafile:true,platform:'browser',format:'esm',target:['es2020'],jsx:'automatic',
  tsconfig:path.join(root,'tsconfig.json'),outfile:'qa.js',logLevel:'warning',define:{'process.env':JSON.stringify({NEXT_PUBLIC_FAOLLA_ATTENDANCE_REMINDERS_ENABLED:'1',NEXT_PUBLIC_FAOLLA_ATTENDANCE_LEAVE_ENABLED:'1'}),
   'process.env.NODE_ENV':'"development"',__REMINDERS_SEED__:JSON.stringify(seed)}});
 const candidates=new Set();for(const name of Object.keys(bundle.metafile.inputs)){assert(!/node:crypto|\.server\.ts$/.test(name),'server_import_in_browser');if(!/\.tsx?$/.test(name)||name.includes('node_modules'))continue;
  const ast=ts.createSourceFile(name,await readFile(path.join(root,name),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);const visit=n=>{if(ts.isStringLiteral(n)||ts.isNoSubstitutionTemplateLiteral(n)||ts.isTemplateHead(n)||ts.isTemplateMiddle(n)||ts.isTemplateTail(n))n.text.split(/\s+/).filter(Boolean).forEach(c=>candidates.add(c));ts.forEachChild(n,visit);};visit(ast);}
 const css=(await compile('@import "tailwindcss";',{base:root,onDependency:()=>{}})).build([...candidates])+bundle.outputFiles.filter(f=>f.path.endsWith('.css')).map(f=>f.text).join('\n')+
  'body{margin:0;background:#f8fafc;font-family:Arial,sans-serif}.qa-main{max-width:1100px;margin:auto;min-width:0}';
 return{js:bundle.outputFiles.find(f=>f.path.endsWith('.js')).contents,css};
}
export async function verifyRemindersBrowser(){
 const started=Date.now(),model=await createRemindersBrowserModel(),requests=[],errors=[],expected503Console=[],groups=[],inflight=new Set();
 let server,browser,context,page,origin,files,totalHttp=0,posts=0,closing=false,accept=true,stage='setup',failure,report;
 const timer=setTimeout(()=>{closing=true;void context?.close().catch(()=>{});server?.closeAllConnections();},remindersBrowserLimits.ttlMs);
 const button=name=>page.getByRole('button',{name,exact:true}),region=()=>page.getByRole('region',{name:'考勤站内提醒工作区',exact:true});
 const settle=async()=>{await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));await bounded(Promise.allSettled([...inflight]));};
 const configure=async value=>{await page.evaluate(v=>window.__reminderHarness.configure(v),value);await settle();};
 const click=async(name,pathname=paths.reminders,method='GET')=>{const[r]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname===pathname&&r.request().method()===method),button(name).click()]);await r.finished();assert.equal(r.status(),200);await settle();};
 const raw=slot=>page.evaluate(k=>sessionStorage.getItem(k),slot),overflow=async()=>assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'390px_overflow');
 const open=async()=>{const n=requests.length;await button('考勤站内提醒').click();await region().waitFor();await button('读取提醒列表').waitFor();await settle();assert.equal(requests.length,n,'opening_reminder_must_not_fetch');};
 const readBatch=async()=>{await click('读取提醒列表');await click('明确读取此提醒详情');};
 const group=async(name,work)=>{stage=name;const n=requests.length,p=posts;await work();groups.push({name,apiRequests:requests.length-n,posts:posts-p});};
 const removeOwned=async(slot,value)=>page.evaluate(({slot,value})=>{if(sessionStorage.getItem(slot)!==value)throw Error('owned_fixture_slot_changed');sessionStorage.removeItem(slot);},{slot,value});
 try{
  files=await bounded(assets(model.seed),45000);server=createServer((req,res)=>{const work=(async()=>{assert(!closing);assert(++totalHttp<=remindersBrowserLimits.http,'HTTP_cap');assert.equal(req.headers.host,new URL(origin).host);
   const u=new URL(req.url,origin);res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Security-Policy',"default-src 'none';script-src 'self';style-src 'self' 'unsafe-inline';connect-src 'self';img-src 'self';base-uri 'none';form-action 'none';frame-ancestors 'none'");
   if(statics.includes(u.pathname)){assert.equal(req.method,'GET');assert.equal(u.search,'');if(u.pathname==='/favicon.ico')return res.writeHead(204).end();const html='<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="/favicon.ico"><link rel="stylesheet" href="/qa.css"><div id="qa-root"></div><script type="module" src="/qa.js"></script></html>';
    return res.writeHead(200,{'Content-Type':u.pathname==='/'?'text/html;charset=utf-8':u.pathname==='/qa.js'?'text/javascript;charset=utf-8':'text/css;charset=utf-8'}).end(u.pathname==='/'?html:u.pathname==='/qa.js'?files.js:files.css);}
   assert(model.seed.paths.includes(u.pathname));assert(requests.length<remindersBrowserLimits.api,'API_cap');if(req.method==='POST'){assert.equal(u.pathname,paths.reminders,'original_approval_POST_forbidden');assert(++posts<=remindersBrowserLimits.posts,'POST_cap');}
   const record={path:u.pathname,method:req.method};requests.push(record);let text='',bytes=0;for await(const chunk of req){bytes+=chunk.length;assert(bytes<=8192);text+=chunk.toString('utf8');}
   const result=await model.respond(u.href,req.method,text,req.headers);Object.assign(record,{query:result.query,action:result.action,actor:result.actor,safeDenial:result.safeDenial===true,positiveOriginal:result.positiveOriginal===true});
   res.writeHead(result.status,{'Content-Type':'application/json;charset=utf-8'}).end(result.text);
  })();inflight.add(work);void work.catch(error=>{errors.push(error.message);if(!res.headersSent)res.writeHead(500,{'Content-Type':'application/json'});res.end('{"ok":false}');}).finally(()=>inflight.delete(work));});
  await new Promise((yes,no)=>{server.once('error',no);server.listen(0,'127.0.0.1',yes);});const address=server.address();assert(address&&typeof address==='object'&&address.address==='127.0.0.1');origin=`http://127.0.0.1:${address.port}`;
  const{chromium}=await import('playwright'),launch=chromium.launch({headless:true});void launch.then(b=>{if(closing)return b.close();}).catch(()=>{});browser=await bounded(launch,15000);
  context=await browser.newContext({serviceWorkers:'block',acceptDownloads:false,viewport:{width:390,height:900}});
  await context.route('**/*',async route=>{const r=route.request(),u=new URL(r.url());if(u.origin!==origin||!((statics.includes(u.pathname)&&r.method()==='GET'&&!u.search)||model.seed.paths.includes(u.pathname)&&['GET','POST'].includes(r.method()))){errors.push('external_or_unknown_request');return route.abort();}await route.continue();});
  page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()!=='error')return;
   if(/^Failed to load resource: the server responded with a status of 503 \(Service Unavailable\)$/.test(m.text()))expected503Console.push(m.text());else errors.push(m.text());});
  page.on('popup',()=>errors.push('popup'));page.on('download',()=>errors.push('download'));page.on('dialog',d=>void(accept?d.accept():d.dismiss()).catch(()=>{}));
  await group('owner_actual_parent_six_families_one_positive_five_safe_denials',async()=>{
   await page.goto(origin);await button('打开负责人合成父入口').waitFor();assert.equal(requests.length,0);await button('打开负责人合成父入口').click();await page.getByLabel('企业考勤时区',{exact:true}).waitFor();await settle();
   await page.getByLabel('企业考勤时区',{exact:true}).fill('UTC');assert(await button('考勤站内提醒').isDisabled());accept=false;assert.equal(await page.evaluate(()=>window.__reminderHarness.leave()),false);accept=true;await page.getByLabel('企业考勤时区',{exact:true}).fill('Europe/Madrid');
   const expected=[{region:'工作安排申请与审批',close:'关闭工作安排',path:paths.work},{region:'负责人补正审批',close:'返回核对列表',path:paths.correction},
    {region:'负责人连续修订审批',close:'返回考勤管理',path:paths.revision},{region:'整段漏卡审核工作区',close:'关闭整段漏卡',path:paths.missing},
    {region:'整段漏卡审核工作区',close:'关闭整段漏卡',path:paths.missing},{region:'请假申请审批',close:'关闭请假申请',path:paths.leave}];
   for(let n=0;n<model.refs.length;n++){
    await open();await readBatch();const ref=model.refs[n],before=requests.length;
    const item=page.locator('[data-reminder-batch]').locator('div.rounded-xl.border.p-3').filter({has:page.getByRole('button',{name:'重新核验并打开审批原入口',exact:true})}).nth(n);
    await item.getByRole('button',{name:'重新核验并打开审批原入口',exact:true}).click();await page.getByRole('region',{name:expected[n].region,exact:true}).waitFor();
    if(n===0){await page.getByText('Synthetic trip',{exact:true}).first().waitFor();await page.getByLabel('工作安排处理理由',{exact:true}).fill('Synthetic201 original draft');accept=false;
     await button(expected[n].close).click();assert.equal(await page.getByLabel('工作安排处理理由',{exact:true}).inputValue(),'Synthetic201 original draft');accept=true;}
    await page.waitForFunction(({pathname,id})=>performance.getEntriesByType('resource').some(r=>new URL(r.name).pathname===pathname&&new URL(r.name).searchParams.get('requestId')===id),{pathname:expected[n].path,id:ref.requestId});await settle();
    const transition=requests.slice(before);assert(transition.some(r=>r.path===paths.routing&&r.query?.requestId===ref.requestId&&r.query?.family===ref.family));
    assert(transition.some(r=>r.path===expected[n].path&&r.query?.requestId===ref.requestId));assert(transition.every(r=>r.method==='GET'));
    if(n===0)assert(transition.some(r=>r.positiveOriginal));else assert(transition.some(r=>r.safeDenial));
    await button(expected[n].close).click();await settle();if(await region().count())await button('关闭提醒').click();await overflow();
   }assert.equal(posts,0);
  });
  await group('owner_period_due_fresh_200_detail_ID_only_explicit_original_read',async()=>{
   await configure({mode:'cycle'});await page.getByLabel('企业考勤时区',{exact:true}).waitFor();await open();await readBatch();const before=requests.length;
   await button('重新核验并打开周期意向原入口').click();await page.getByRole('region',{name:'周期采用意向工作区',exact:true}).waitFor();await settle();
   assert.equal(requests.length,before+1);assert.equal(requests.at(-1).path,paths.cycle);assert.equal(requests.at(-1).query.intentId,model.seed.cycle.intentId);
   assert.equal(await page.getByLabel('已知意向编号',{exact:true}).inputValue(),model.seed.cycle.intentId);assert.equal(await page.locator('[data-cycle-detail]').count(),0);
   await click('读取意向详情',paths.cycle);assert.match(await page.getByRole('region',{name:'周期采用意向工作区',exact:true}).innerText(),/已保存周期意向/);assert.equal(posts,0);
   await button('关闭周期意向').click();await overflow();
  });
  await group('whole_enterprise_actualAuth_inbox_workerless_mark_unknown_original_GET',async()=>{
   await configure({mode:'overview'});await button('考勤站内提醒').waitFor();await settle();assert.notEqual(model.seed.enterprise.authUserId,model.seed.enterprise.actorEmployeeId);await open();
   assert.equal(await button('现在手动检查本窗').count(),0);await readBatch();assert.equal(requests.at(-1).actor,model.seed.enterprise.authUserId);assert.equal(await button('重新核验并打开审批原入口').count(),0);
   model.lose();await click('明确标记此提醒已读',paths.reminders,'POST');const original=await raw(model.seed.slots.inbox);assert(original);assert.equal(JSON.parse(original).actorId,model.seed.enterprise.authUserId);
   accept=false;await button('关闭提醒').click();assert.equal(await region().count(),1);accept=true;model.recovery('null');await click('以 GET 核验原操作');assert.equal(await raw(model.seed.slots.inbox),original);
   model.recovery('valid');await click('以 GET 核验原操作');assert.equal(await raw(model.seed.slots.inbox),null);assert.match(await region().innerText(),/原号 GET 已核验/);await button('关闭提醒').click();await overflow();
  });
  await group('raw_slot_hidden_auth_requester_late_flagoff_StrictMode_mobile_no_background',async()=>{
   await configure({mode:'review',enabled:true});await page.getByLabel('企业考勤时区',{exact:true}).waitFor();await open();await readBatch();
   for(const slot of [model.seed.slots.correction,model.seed.slots.routing]){
    await page.evaluate(k=>sessionStorage.setItem(k,'{'),slot);const before=requests.length;await button('重新核验并打开审批原入口').first().click();await settle();assert.equal(requests.length,before);assert.equal(await raw(slot),'{');await removeOwned(slot,'{');
   }
   await page.evaluate(path=>window.__reminderHarness.hold(path,'GET'),paths.reminders);await click('读取提醒列表');await page.waitForFunction(()=>window.__reminderHarness.held());
   await configure({requester:1});await page.evaluate(()=>window.__reminderHarness.release());await settle();assert.equal(await page.locator('[data-reminder-batch]').count(),0);assert.equal(await region().count(),0);
   await open();await readBatch();await page.evaluate(path=>window.__reminderHarness.hold(path,'POST'),paths.reminders);await click('现在手动检查本窗',paths.reminders,'POST');await page.waitForFunction(()=>window.__reminderHarness.held());
   const original=await raw(model.seed.slots.review);assert(original);assert.equal(JSON.parse(original).command.action,'run_due');await page.evaluate(()=>window.__reminderHarness.visibility(true));await page.evaluate(()=>window.__reminderHarness.pagehide());
   assert.equal(await page.locator('[data-reminder-batch]').count(),0);await page.evaluate(()=>window.__reminderHarness.authValid(false));const before=requests.length;await page.evaluate(()=>window.__reminderHarness.release());await settle();assert.equal(requests.length,before);assert.equal(await raw(model.seed.slots.review),original);
   await page.evaluate(()=>window.__reminderHarness.visibility(false));await page.evaluate(()=>window.__reminderHarness.authValid(true));await configure({enabled:false});await open();await click('以 GET 核验原操作');
   assert.equal(await raw(model.seed.slots.review),null);assert.match(await region().innerText(),/原号 GET 已核验/);assert(await button('现在手动检查本窗').isDisabled());await button('关闭提醒').click();
   await page.evaluate(k=>sessionStorage.setItem(k,'{'),model.seed.slots.review);await open();await settle();assert(await button('读取提醒列表').isDisabled());const noGet=requests.length;
   await button('以 GET 核验原操作').click();await settle();assert.equal(requests.length,noGet);assert.equal(await raw(model.seed.slots.review),'{');await button('关闭提醒').click();await removeOwned(model.seed.slots.review,'{');
   await configure({mode:'strict',enabled:true});await region().waitFor();const replay=requests.length;await settle();assert.equal(requests.length,replay);await click('读取提醒列表');await overflow();await button('关闭提醒').click();
   const closed=requests.length;await settle();assert.equal(requests.length,closed);assert.equal(posts,2);assert.deepEqual(errors,[]);assert(expected503Console.length<=requests.filter(r=>r.safeDenial).length);
  });
  assert.equal(groups.length,4);report={groups,apiRequests:requests.length,gets:requests.filter(r=>r.method==='GET').length,posts,totalHttp,elapsedMs:Date.now()-started,
   actualAdminParent:true,actualEnterpriseManager:true,actualRemindersLauncher:true,actualRemindersPanel:true,actualOriginalWorkDetail:true,
   otherFiveOriginalPaths:'fresh198_then_authorized_GET_safe_denial_only_not_approval_body_or_success',safeDenialRequests:requests.filter(r=>r.safeDenial).length,
   actualOwnerPeriodIntent:true,actualAuthRecipientNotMembership:true,workerlessSyntheticEmployee:true,matchingOriginalGET:true,rawPendingPreserved:true,flagoffOriginalGET:true,
   hiddenClearsBody:true,lateRequesterFenced:true,lateAuthPreservesRaw:true,newPanelStrictModeReplay:true,initialReminderHTTP:0,mobileWidth:390,horizontalOverflow:false,
   actualAuth:false,actualSql:false,syntheticAuth:true,syntheticApi:true,realAuthority:false,originalApprovalPosts:0,externalRequests:0,diskBundle:false};
 }catch(error){failure=Error(`reminders_browser_failed:${stage}:${error.message}:${JSON.stringify({errors,apiRequests:requests.length,posts,totalHttp,last:requests.slice(-6).map(r=>({path:r.path,method:r.method,mode:r.query?.mode,action:r.action,safeDenial:r.safeDenial}))})}`,{cause:error});throw failure;}
 finally{closing=true;clearTimeout(timer);await runAttendanceCleanupSteps([{name:'held body',run:async()=>{if(page&&!page.isClosed())await page.evaluate(()=>window.__reminderHarness?.release()).catch(()=>{});}},
  {name:'owned context',run:()=>context?bounded(context.close(),6000):undefined},{name:'owned browser',run:()=>browser?bounded(browser.close(),6000):undefined},
  {name:'HTTP work',run:()=>bounded(Promise.allSettled([...inflight]),6000)},{name:'owned listener',run:()=>{server?.closeAllConnections();return server?.listening?bounded(new Promise((yes,no)=>server.close(e=>e?no(e):yes())),6000):undefined;}},
  {name:'esbuild',run:async()=>{(await import('esbuild')).stop();}}]).catch(error=>{if(failure)throw new AggregateError([failure,error],'reminder_browser_cleanup_failed');throw error;});
  assert(!browser?.isConnected()&&!server?.listening);if(failure)console.error(JSON.stringify({cleanup:'reminders-browser',browserClosed:!browser?.isConnected(),listenerStopped:!server?.listening,apiRequests:requests.length,posts,totalHttp}));}
 return{...report,browserClosed:true,listenerStopped:true};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv.length===3&&process.argv[2]==='--run-local')console.log(JSON.stringify(await verifyRemindersBrowser()));
 else if(process.argv.length===2)console.log('Inert. node --import tsx scripts/fixtures/attendance-reminders-browser.mjs --run-local');else throw Error('explicit_run_local_only');
}
