//INERT unless --run-local. Only two new 201 recipient chains, no old matrix.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {runAttendanceCleanupSteps} from './attendance-cleanup.mjs';
import {createRecipientReminderModel,recipientReminderPaths as paths} from './attendance-reminders-recipient-browser-model.mjs';
export {createRecipientReminderModel,recipientReminderPaths} from './attendance-reminders-recipient-browser-model.mjs';
export const recipientReminderLimits=Object.freeze({groups:2,api:32,http:40,posts:0,ttlMs:120000,mobileWidth:390});
const root=fileURLToPath(new URL('../../',import.meta.url)),statics=['/','/qa.js','/qa.css','/favicon.ico'];
async function bounded(work,ms=12000){let timer;try{return await Promise.race([work,new Promise((_,no)=>{timer=setTimeout(()=>no(Error('recipient_browser_deadline')),ms);})]);}finally{clearTimeout(timer);}}
async function assets(seed){
 const{build}=await import('esbuild'),{compile}=await import('@tailwindcss/node'),{default:ts}=await import('typescript');
 const bundle=await build({absWorkingDir:root,entryPoints:['scripts/fixtures/attendance-reminders-recipient-browser-entry.tsx'],bundle:true,write:false,metafile:true,platform:'browser',format:'esm',target:['es2020'],jsx:'automatic',
  tsconfig:path.join(root,'tsconfig.json'),outfile:'qa.js',logLevel:'warning',define:{'process.env':JSON.stringify({NEXT_PUBLIC_FAOLLA_ATTENDANCE_REMINDERS_ENABLED:'1',NEXT_PUBLIC_FAOLLA_ATTENDANCE_CORRECTION_DELEGATION_ENABLED:'1',NEXT_PUBLIC_FAOLLA_ATTENDANCE_OPERATIONAL_PUNCH_ENABLED:'1'}),
   'process.env.NODE_ENV':'"development"',__REMINDER_RECIPIENT_SEED__:JSON.stringify(seed)}});
 const candidates=new Set();for(const name of Object.keys(bundle.metafile.inputs)){assert(!/node:crypto|\.server\.ts$/.test(name),'server_import_in_browser');if(!/\.tsx?$/.test(name)||name.includes('node_modules'))continue;
  const ast=ts.createSourceFile(name,await readFile(path.join(root,name),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);const visit=n=>{if(ts.isStringLiteral(n)||ts.isNoSubstitutionTemplateLiteral(n)||ts.isTemplateHead(n)||ts.isTemplateMiddle(n)||ts.isTemplateTail(n))n.text.split(/\s+/).filter(Boolean).forEach(c=>candidates.add(c));ts.forEachChild(n,visit);};visit(ast);}
 const css=(await compile('@import "tailwindcss";',{base:root,onDependency:()=>{}})).build([...candidates])+bundle.outputFiles.filter(f=>f.path.endsWith('.css')).map(f=>f.text).join('\n')+
  'body{margin:0;background:#f8fafc;font-family:Arial,sans-serif}.qa-main{max-width:1100px;margin:auto;min-width:0}';
 return{js:bundle.outputFiles.find(f=>f.path.endsWith('.js')).contents,css};
}
export async function verifyRecipientReminderBrowser(){
 const started=Date.now(),model=await createRecipientReminderModel(),requests=[],errors=[],groups=[],inflight=new Set();
 let server,browser,context,page,origin,files,totalHttp=0,closing=false,accept=true,stage='setup',failure,report;
 const timer=setTimeout(()=>{closing=true;void context?.close().catch(()=>{});server?.closeAllConnections();},recipientReminderLimits.ttlMs);
 const button=name=>page.getByRole('button',{name,exact:true}),region=()=>page.getByRole('region',{name:'考勤站内提醒工作区',exact:true}),rules=()=>page.getByRole('region',{name:'规则打卡与原号核对',exact:true});
 const settle=async()=>{await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));await bounded(Promise.allSettled([...inflight]));};
 const click=async(name,pathname=paths.reminders,mode=null)=>{const[r]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname===pathname&&r.request().method()==='GET'&&(!mode||new URL(r.url()).searchParams.get('mode')===mode)),button(name).click()]);await r.finished();assert.equal(r.status(),200);await settle();};
 const raw=slot=>page.evaluate(k=>sessionStorage.getItem(k),slot),overflow=async()=>assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'390px_overflow');
 const open=async()=>{const n=requests.length;await button('考勤站内提醒').click();await region().waitFor();await button('读取提醒列表').waitFor();await settle();assert.equal(requests.length,n,'open_must_not_fetch');};
 const readBatch=async()=>{await click('读取提醒列表');await click('明确读取此提醒详情');};
 const identity=async value=>{const response=page.waitForResponse(r=>new URL(r.url()).pathname===paths.overview);await page.evaluate(v=>window.__recipientReminderHarness.identity(v),value);await(await response).finished();await settle();};
 const removeOwned=async slot=>page.evaluate(k=>{if(sessionStorage.getItem(k)!=='{')throw Error('owned_fixture_slot_changed');sessionStorage.removeItem(k);},slot);
 const group=async(name,work)=>{stage=name;const n=requests.length;await work();groups.push({name,apiRequests:requests.length-n,posts:0});};
 try{
  files=await bounded(assets(model.seed),45000);server=createServer((req,res)=>{const work=(async()=>{assert(!closing);assert(++totalHttp<=recipientReminderLimits.http,'HTTP_cap');assert.equal(req.headers.host,new URL(origin).host);
   const u=new URL(req.url,origin);res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Security-Policy',"default-src 'none';script-src 'self';style-src 'self' 'unsafe-inline';connect-src 'self';img-src 'self';base-uri 'none';form-action 'none';frame-ancestors 'none'");
   assert.equal(req.method,'GET','recipient_business_POST_forbidden');if(statics.includes(u.pathname)){assert.equal(u.search,'');if(u.pathname==='/favicon.ico')return res.writeHead(204).end();const html='<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="/favicon.ico"><link rel="stylesheet" href="/qa.css"><div id="qa-root"></div><script type="module" src="/qa.js"></script></html>';
    return res.writeHead(200,{'Content-Type':u.pathname==='/'?'text/html;charset=utf-8':u.pathname==='/qa.js'?'text/javascript;charset=utf-8':'text/css;charset=utf-8'}).end(u.pathname==='/'?html:u.pathname==='/qa.js'?files.js:files.css);}
   assert(model.seed.paths.includes(u.pathname));assert(requests.length<recipientReminderLimits.api,'API_cap');const record={path:u.pathname,method:req.method};requests.push(record);
   let text='',bytes=0;for await(const chunk of req){bytes+=chunk.length;assert(bytes<=8192);text+=chunk.toString('utf8');}const result=await model.respond(u.href,req.method,text,req.headers);
   Object.assign(record,{identity:result.identity,mode:result.query?.mode,actor:result.actor});res.writeHead(result.status,{'Content-Type':'application/json;charset=utf-8'}).end(result.text);
  })();inflight.add(work);void work.catch(error=>{errors.push(error.message);if(!res.headersSent)res.writeHead(500,{'Content-Type':'application/json'});res.end('{"ok":false}');}).finally(()=>inflight.delete(work));});
  await new Promise((yes,no)=>{server.once('error',no);server.listen(0,'127.0.0.1',yes);});const address=server.address();assert(address&&typeof address==='object'&&address.address==='127.0.0.1');origin=`http://127.0.0.1:${address.port}`;
  const{chromium}=await import('playwright'),launch=chromium.launch({headless:true});void launch.then(b=>{if(closing)return b.close();}).catch(()=>{});browser=await bounded(launch,15000);
  context=await browser.newContext({serviceWorkers:'block',acceptDownloads:false,viewport:{width:390,height:900}});await context.route('**/*',async route=>{const r=route.request(),u=new URL(r.url());
   if(u.origin!==origin||r.method()!=='GET'||!(statics.includes(u.pathname)&&!u.search||model.seed.paths.includes(u.pathname))){errors.push('external_unknown_or_POST_request');return route.abort();}await route.continue();});
  page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('popup',()=>errors.push('popup'));page.on('download',()=>errors.push('download'));page.on('dialog',d=>void(accept?d.accept():d.dismiss()).catch(()=>{}));
  await group('self_actual_Manager_pointer_recheck_stable_redraw_local_hint_raw_hidden_Auth',async()=>{
   await page.goto(origin);await button('考勤站内提醒').waitFor();await settle();assert.equal(requests.length,1);assert.notEqual(model.seed.self.authUserId,model.seed.self.employeeId);await open();await readBatch();
   await click('重新核验并打开本人当前班次',paths.self,'prepare');await page.getByText('本次结果尚不能核实；原号保留，不会自动重发或跳转。请明确重新核验。',{exact:true}).waitFor();assert.equal(await rules().count(),0);assert.equal(await region().count(),1);
   model.pointer(true);await readBatch();await page.evaluate(k=>sessionStorage.setItem(k,'{'),model.seed.slots.selfBlocked);const blocked=requests.length;
   await button('重新核验并打开本人当前班次').click();await settle();assert.equal(requests.length,blocked);assert.equal(await raw(model.seed.slots.selfBlocked),'{');await removeOwned(model.seed.slots.selfBlocked);
   await page.evaluate(path=>window.__recipientReminderHarness.hold(path),paths.self);await click('重新核验并打开本人当前班次',paths.self,'prepare');await page.waitForFunction(()=>window.__recipientReminderHarness.held());
   const prepared=requests.length;await page.evaluate(()=>window.__recipientReminderHarness.redraw());await settle();assert.equal(await page.evaluate(()=>window.__recipientReminderHarness.canceled()),false,'ordinary_callback_redraw_must_not_abort');
   await page.evaluate(()=>window.__recipientReminderHarness.release());await rules().waitFor();await settle();assert.equal(await region().count(),0);assert.equal(requests.length,prepared,'self_hint_mount_is_local_only');
   assert.equal(await button('读取本次规则与状态').count(),1);assert.equal(await button('确认下班').count(),0);await overflow();
   assert.equal(await page.evaluate(()=>window.__recipientReminderHarness.navigate('overview')),true);await button('考勤站内提醒').waitFor();const legacy=page.waitForResponse(r=>new URL(r.url()).pathname===paths.legacySelf);
   assert.equal(await page.evaluate(()=>window.__recipientReminderHarness.navigate('attendance')),true);await(await legacy).finished();await settle();assert.equal(await rules().count(),0,'consumed_hint_must_not_reopen');
   assert.equal(await page.evaluate(()=>window.__recipientReminderHarness.navigate('overview')),true);await button('考勤站内提醒').waitFor();await open();await readBatch();
   await page.evaluate(path=>window.__recipientReminderHarness.hold(path),paths.self);await click('重新核验并打开本人当前班次',paths.self,'prepare');await page.waitForFunction(()=>window.__recipientReminderHarness.held());
   await page.evaluate(k=>sessionStorage.setItem(k,'{'),model.seed.slots.selfBlocked);await page.evaluate(()=>window.__recipientReminderHarness.visibility(true));await page.evaluate(()=>window.__recipientReminderHarness.pagehide());
   await identity('other');await page.evaluate(()=>window.__recipientReminderHarness.release());await settle();assert.equal(await rules().count(),0);assert.equal(await page.locator('[data-reminder-batch]').count(),0);assert.equal(await raw(model.seed.slots.selfBlocked),'{');
   await page.evaluate(()=>window.__recipientReminderHarness.visibility(false));await settle();await removeOwned(model.seed.slots.selfBlocked);await overflow();
  });
  await group('delegate_actual_correction_selector_explicit_three_GET_no_grant_injection_dirty_raw_hidden_Auth',async()=>{
   await identity('delegate');await button('考勤站内提醒').waitFor();assert(!model.actor('delegate').permissions.includes('attendance.self.view'));await open();await readBatch();
   await page.evaluate(k=>sessionStorage.setItem(k,'{'),model.seed.slots.correction);const blocked=requests.length;await button('打开受托补正入口（需重新选择授权）').click();await settle();assert.equal(requests.length,blocked);assert.equal(await raw(model.seed.slots.correction),'{');await removeOwned(model.seed.slots.correction);
   const opened=requests.length;await button('打开受托补正入口（需重新选择授权）').click();await page.getByRole('dialog',{name:'提醒中的受托首次补正原入口',exact:true}).waitFor();await button('读取我的补正委托').waitFor();await settle();
   assert.equal(requests.length,opened,'wrapper_and_original_selector_must_not_fetch');assert.equal(await page.locator('[data-correction-delegation-detail]').count(),0);assert.equal(await region().count(),0);
   const explicit=requests.length;await click('读取我的补正委托',paths.correction,'grants');await click('读取此委托待审补正',paths.correction,'list');await click('读取受托补正详情',paths.correction,'detail');
   assert.deepEqual(requests.slice(explicit).map(r=>r.mode),['grants','list','detail']);const detail=page.locator('[data-correction-delegation-detail]');await detail.waitFor();assert.match(await detail.innerText(),/原始完整记录/);assert.match(await detail.innerText(),/员工申请调整/);
   await page.getByLabel('受托补正审核理由',{exact:true}).fill('Synthetic201 navigation draft');accept=false;await button('关闭补正委托').click();assert.equal(await page.getByLabel('受托补正审核理由',{exact:true}).inputValue(),'Synthetic201 navigation draft');accept=true;await overflow();
   await page.evaluate(path=>window.__recipientReminderHarness.hold(path),paths.correction);await click('读取我的补正委托',paths.correction,'grants');await page.waitForFunction(()=>window.__recipientReminderHarness.held());
   await page.evaluate(k=>sessionStorage.setItem(k,'{'),model.seed.slots.correction);await page.evaluate(()=>window.__recipientReminderHarness.visibility(true));await identity('other');await page.evaluate(()=>window.__recipientReminderHarness.release());await settle();
   assert.equal(await page.locator('[data-correction-delegation-detail]').count(),0);assert.equal(await page.getByRole('dialog',{name:'提醒中的受托首次补正原入口',exact:true}).count(),0);assert.equal(await raw(model.seed.slots.correction),'{');
   await page.evaluate(()=>window.__recipientReminderHarness.visibility(false));await settle();const closed=requests.length;await settle();assert.equal(requests.length,closed,'closed_workspaces_must_not_fetch');await overflow();await removeOwned(model.seed.slots.correction);
  });
  assert.equal(groups.length,2);assert.deepEqual(errors,[]);assert(requests.every(r=>r.method==='GET'));report={groups,apiRequests:requests.length,gets:requests.length,posts:0,totalHttp,elapsedMs:Date.now()-started,
   actualManager:true,actualRemindersLauncherAndPanel:true,actualSelfOperationalHost:true,actualCorrectionWrapperAndOriginalPanel:true,selfFresh193GET:true,selfLocalHintHTTP:0,consumedHintNoReopen:true,
   sameCapabilityRedrawKeepsReader:true,delegateExplicitGET:['grants','list','detail'],delegateNoInjectedGrant:true,dirtyCloseCanceled:true,rawPendingPreserved:true,hiddenAuthLateClearsBody:true,
   mobileWidth:390,horizontalOverflow:false,syntheticAuth:true,syntheticApi:true,actualAuth:false,actualSql:false,realAuthority:false,businessPosts:0,externalRequests:0,diskBundle:false};
 }catch(error){failure=Error(`recipient_reminder_browser_failed:${stage}:${error.message}:${JSON.stringify({errors,apiRequests:requests.length,totalHttp,last:requests.slice(-6)})}`,{cause:error});throw failure;}
 finally{closing=true;clearTimeout(timer);await runAttendanceCleanupSteps([{name:'held body',run:async()=>{if(page&&!page.isClosed())await page.evaluate(()=>window.__recipientReminderHarness?.release()).catch(()=>{});}},
  {name:'owned context',run:()=>context?bounded(context.close(),6000):undefined},{name:'owned browser',run:()=>browser?bounded(browser.close(),6000):undefined},
  {name:'HTTP work',run:()=>bounded(Promise.allSettled([...inflight]),6000)},{name:'owned listener',run:()=>{server?.closeAllConnections();return server?.listening?bounded(new Promise((yes,no)=>server.close(e=>e?no(e):yes())),6000):undefined;}},
  {name:'esbuild',run:async()=>{(await import('esbuild')).stop();}}]).catch(error=>{if(failure)throw new AggregateError([failure,error],'recipient_browser_cleanup_failed');throw error;});
  assert(!browser?.isConnected()&&!server?.listening);if(failure)console.error(JSON.stringify({cleanup:'reminders-recipient-browser',browserClosed:!browser?.isConnected(),listenerStopped:!server?.listening,apiRequests:requests.length,posts:0,totalHttp}));}
 return{...report,browserClosed:true,listenerStopped:true};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv.length===3&&process.argv[2]==='--run-local')console.log(JSON.stringify(await verifyRecipientReminderBrowser()));
 else if(process.argv.length===2)console.log('Inert. node --import tsx scripts/fixtures/attendance-reminders-recipient-browser.mjs --run-local');else throw Error('explicit_run_local_only');
}
