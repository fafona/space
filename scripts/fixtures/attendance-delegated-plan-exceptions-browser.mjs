// INERT unless explicit --run-local. Four finite groups, memory bundle only.
// Actual independent209 Launcher/Panel; API/Auth synthetic, not real SQL/hosts.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {runAttendanceCleanupSteps} from './attendance-cleanup.mjs';
import {createDelegatedPlanExceptionsBrowserModel,delegatedPlanExceptionsBrowserPaths as paths} from './attendance-delegated-plan-exceptions-browser-model.mjs';
export {createDelegatedPlanExceptionsBrowserModel,delegatedPlanExceptionsBrowserPaths} from './attendance-delegated-plan-exceptions-browser-model.mjs';
export const delegatedPlanExceptionsBrowserLimits=Object.freeze({groups:4,api:30,http:45,posts:3,ttlMs:90000,mobileWidth:390});
const root=fileURLToPath(new URL('../../',import.meta.url)),statics=['/','/qa.js','/qa.css','/favicon.ico'];
async function bounded(work,ms=12000){let timer;try{return await Promise.race([work,new Promise((_,no)=>{timer=setTimeout(()=>no(Error('formal209_browser_deadline')),ms);})]);}finally{clearTimeout(timer);}}
async function assets(seed){
 const{build}=await import('esbuild'),{compile}=await import('@tailwindcss/node'),{default:ts}=await import('typescript');
 const bundle=await build({absWorkingDir:root,entryPoints:['scripts/fixtures/attendance-delegated-plan-exceptions-browser-entry.tsx'],bundle:true,write:false,metafile:true,platform:'browser',format:'esm',target:['es2020'],jsx:'automatic',
  tsconfig:path.join(root,'tsconfig.json'),outfile:'qa.js',logLevel:'warning',define:{'process.env':JSON.stringify({NEXT_PUBLIC_FAOLLA_ATTENDANCE_DELEGATED_PLAN_EXCEPTIONS_ENABLED:'1'}),
   'process.env.NODE_ENV':'"development"',__FORMAL209_SEED__:JSON.stringify(seed)}});
 const candidates=new Set();for(const name of Object.keys(bundle.metafile.inputs)){assert(!/node:crypto|\.server\.ts$/.test(name),'server_import_in_browser');if(!/\.tsx?$/.test(name)||name.includes('node_modules'))continue;
  const ast=ts.createSourceFile(name,await readFile(path.join(root,name),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);const visit=n=>{if(ts.isStringLiteral(n)||ts.isNoSubstitutionTemplateLiteral(n)||ts.isTemplateHead(n)||ts.isTemplateMiddle(n)||ts.isTemplateTail(n))n.text.split(/\s+/).filter(Boolean).forEach(c=>candidates.add(c));ts.forEachChild(n,visit);};visit(ast);}
 const css=(await compile('@import "tailwindcss";',{base:root,onDependency:()=>{}})).build([...candidates])+bundle.outputFiles.filter(f=>f.path.endsWith('.css')).map(f=>f.text).join('\n')+
  'body{margin:0;background:#f8fafc;font-family:Arial,sans-serif}.qa-main{max-width:1100px;margin:auto;min-width:0}';
 return{js:bundle.outputFiles.find(f=>f.path.endsWith('.js')).contents,css};
}
export async function verifyDelegatedPlanExceptionsBrowser(){
 const limits=delegatedPlanExceptionsBrowserLimits,started=Date.now(),model=createDelegatedPlanExceptionsBrowserModel(),requests=[],errors=[],groups=[],inflight=new Set();
 let server,browser,context,page,origin,files,totalHttp=0,posts=0,closing=false,accept=true,confirmationCount=0,stage='setup',failure,report;
 const timer=setTimeout(()=>{closing=true;void context?.close().catch(()=>{});server?.closeAllConnections();},limits.ttlMs);
 const button=name=>page.getByRole('button',{name,exact:true}),dialog=()=>page.getByRole('dialog',{name:'正式异常审批委托工作区',exact:true});
 const settle=async()=>{await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));await bounded(Promise.allSettled([...inflight]));};
 const configure=async value=>{await page.evaluate(v=>window.__formal209Harness.configure(v),value);await settle();};
 const click=async(name,pathname,method='GET')=>{const[r]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname===pathname&&r.request().method()===method),button(name).click()]);await r.finished();assert.equal(r.status(),200);await settle();};
 const raw=slot=>page.evaluate(k=>sessionStorage.getItem(k),slot),overflow=async()=>{assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'390px_page_overflow');
  if(await dialog().count())assert.equal(await dialog().evaluate(el=>el.scrollWidth>el.clientWidth+1),false,'390px_dialog_overflow');};
 const open=async(enabled=true)=>{const n=requests.length;await button(enabled?'正式异常审批委托':'核对正式异常委托原编号').click();await dialog().waitFor();await button('读取本地状态（不联网）').waitFor();await settle();
  await button('读取本地状态（不联网）').click();await settle();assert.equal(requests.length,n,'opening_and_local_initialization_must_not_fetch');};
 const close=async()=>{await dialog().getByRole('button',{name:'关闭',exact:true}).click();await settle();};
 const group=async(name,work)=>{stage=name;const n=requests.length,p=posts;await work();await overflow();groups.push({name,apiRequests:requests.length-n,posts:posts-p});};
 const target=async()=>{for(const[label,value]of[['真实授权 Grant ID',model.seed.query.grantId],['指定档案 Worker ID',model.seed.query.workerId],['指定排班 Slot ID',model.seed.query.slotId]])await page.getByLabel(label,{exact:true}).fill(value);};
 const read=async()=>{await target();await click('读取此授权／人员／排班',paths.exceptions);await page.locator('[data-delegated-plan-exceptions-review]').waitFor();};
 const fillDecision=async(outcome,note)=>{await page.getByLabel('明确处理',{exact:true}).selectOption(outcome);await page.getByLabel('处理说明',{exact:true}).fill(note);
  await page.getByLabel('已核验此真实人员、排班及完整依据，明确处理',{exact:true}).check();};
 const grantForm=()=>page.locator('details').filter({has:page.locator('summary',{hasText:'新增唯一人员的正式异常审批授权'})});
 const fillGrant=async()=>{const form=grantForm();await form.locator('summary').click();for(const[label,value]of[['受托员工 Employee ID',model.seed.employeeId],['受托账户 Auth ID',model.seed.delegate],
  ['目标档案 Worker ID',model.seed.scope.workerId],['目标员工 Employee ID',model.seed.scope.employeeId],['目标账户 Auth ID',model.seed.scope.employeeAuthUserId]])await form.getByLabel(label,{exact:true}).fill(value);
  await form.getByLabel(/^真实地点 ID/).fill(model.seed.scope.locationIds.join(','));await form.getByLabel('生效时间（UTC）',{exact:true}).fill('2026-10-09T10:00');
  await form.getByLabel('失效时间（UTC，不含端点）',{exact:true}).fill('2026-10-10T12:00');await form.getByLabel('授权理由',{exact:true}).fill('Synthetic209 finite exact formal grant');
  assert.equal(await form.getByLabel(/^明确包含授权登记前/).isChecked(),false);await form.getByLabel('已核验双身份、地点、期限和旧排班边界，只授此明确动作',{exact:true}).check();};
 try{
  files=await bounded(assets(model.seed),45000);assert(!closing);server=createServer((req,res)=>{const work=(async()=>{assert(!closing);assert(++totalHttp<=limits.http,'HTTP_cap');assert.equal(req.headers.host,new URL(origin).host);
   const u=new URL(req.url,origin);res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Security-Policy',"default-src 'none';script-src 'self';style-src 'self' 'unsafe-inline';connect-src 'self';img-src 'self';base-uri 'none';form-action 'none';frame-ancestors 'none'");
   if(statics.includes(u.pathname)){assert.equal(req.method,'GET');assert.equal(u.search,'');if(u.pathname==='/favicon.ico')return res.writeHead(204).end();const html='<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="/favicon.ico"><link rel="stylesheet" href="/qa.css"><div id="qa-root"></div><script type="module" src="/qa.js"></script></html>';
    return res.writeHead(200,{'Content-Type':u.pathname==='/'?'text/html;charset=utf-8':u.pathname==='/qa.js'?'text/javascript;charset=utf-8':'text/css;charset=utf-8'}).end(u.pathname==='/'?html:u.pathname==='/qa.js'?files.js:files.css);}
   assert(model.seed.paths.includes(u.pathname));assert(requests.length<limits.api,'API_cap');assert(['GET','POST'].includes(req.method));if(req.method==='POST')assert(++posts<=limits.posts,'POST_cap');
   const record={path:u.pathname,method:req.method};requests.push(record);let text='',bytes=0;for await(const chunk of req){bytes+=chunk.length;assert(bytes<=8192);text+=chunk.toString('utf8');}
   const result=await model.respond(u.href,req.method,text,req.headers);Object.assign(record,{query:result.query,command:result.command,actor:result.actor,domain:result.domain});
   res.writeHead(result.status,{'Content-Type':'application/json;charset=utf-8'}).end(result.text);
  })();inflight.add(work);void work.catch(error=>{errors.push(error.message);if(!res.headersSent)res.writeHead(500,{'Content-Type':'application/json'});res.end('{"ok":false}');}).finally(()=>inflight.delete(work));});
  await new Promise((yes,no)=>{server.once('error',no);server.listen(0,'127.0.0.1',yes);});const address=server.address();assert(address&&typeof address==='object'&&address.address==='127.0.0.1');origin=`http://127.0.0.1:${address.port}`;
  const{chromium}=await import('playwright'),launch=chromium.launch({headless:true});void launch.then(b=>{if(closing)return b.close();}).catch(()=>{});browser=await bounded(launch,15000);
  context=await browser.newContext({serviceWorkers:'block',acceptDownloads:false,viewport:{width:390,height:900}});
  await context.route('**/*',async route=>{const r=route.request(),u=new URL(r.url());if(u.origin!==origin||!((statics.includes(u.pathname)&&r.method()==='GET'&&!u.search)||model.seed.paths.includes(u.pathname)&&['GET','POST'].includes(r.method()))){errors.push('external_or_unknown_request');return route.abort();}await route.continue();});
  page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  page.on('popup',()=>errors.push('popup'));page.on('download',()=>errors.push('unexpected_download'));page.on('dialog',d=>{confirmationCount++;void(accept?d.accept():d.dismiss()).catch(()=>{});});
  await group('209_actual_owner_structured_future_only_grant_dirty_target_cancel_and_gateoff_revoke',async()=>{
   await page.goto(origin);await button('正式异常审批委托').waitFor();assert.equal(requests.length,0);await open();await click('读取正式异常授权（25条）',paths.management);await fillGrant();
   await grantForm().getByLabel('授权理由',{exact:true}).fill('Synthetic209 finite exact formal grant revised');assert.equal(await grantForm().getByLabel('已核验双身份、地点、期限和旧排班边界，只授此明确动作',{exact:true}).isChecked(),false);
   await grantForm().getByLabel('授权理由',{exact:true}).fill('Synthetic209 finite exact formal grant');await grantForm().getByLabel('已核验双身份、地点、期限和旧排班边界，只授此明确动作',{exact:true}).check();
   const before=requests.length,confirms=confirmationCount;accept=false;await page.getByLabel('真实授权 Grant ID',{exact:true}).fill(model.seed.query.grantId);await settle();
   assert.equal(confirmationCount,confirms+1);assert.equal(await page.getByLabel('真实授权 Grant ID',{exact:true}).inputValue(),'');assert.equal(await grantForm().getByLabel('授权理由',{exact:true}).inputValue(),'Synthetic209 finite exact formal grant');
   assert.equal(await page.evaluate(()=>window.__formal209Harness.leave()),false);assert.equal(requests.length,before);accept=true;
   await page.getByLabel('真实授权 Grant ID',{exact:true}).fill(model.seed.query.grantId);await settle();assert.equal(await grantForm().getByLabel('授权理由',{exact:true}).inputValue(),'');
   await click('读取正式异常授权（25条）',paths.management);if(await grantForm().getByLabel('授权理由',{exact:true}).isVisible())await grantForm().locator('summary').click();await fillGrant();
   accept=false;const p=posts;await button('授予正式异常审批权（一次提交）').click();await settle();assert.equal(posts,p);assert.equal(await raw(model.seed.slots.owner),null);
   accept=true;await click('授予正式异常审批权（一次提交）',paths.management,'POST');const pending=JSON.parse(await raw(model.seed.slots.owner));assert.equal(pending.domain,'management');assert.equal(pending.command.scope.includePending,false);
   assert.equal(pending.command.delegatedAction,'plan_exception_decide');await click('仅 GET 核验原编号',paths.management);assert.equal(await raw(model.seed.slots.owner),null);await close();
   await configure({grant:false,requester:1});await open();await page.getByLabel('真实授权编号',{exact:true}).fill(model.seed.query.grantId);await click('读取授权详情',paths.management);
   assert(await button('撤销此授权（一次提交）').isDisabled());assert(await page.getByLabel('撤销理由',{exact:true}).isDisabled());await close();
  });
  await group('209_actual_delegate_confirmed_once_hidden_late_POST_exact_original_GET_flags_off',async()=>{
   await configure({ownerMode:false,grant:false,enabled:true,requester:2});await open();assert.equal(await button('读取正式异常授权（25条）').count(),0);await read();
   assert.match(await page.locator('[data-delegated-plan-exceptions-review]').textContent(),/异常分钟/);assert.equal(await page.locator('[data-delegated-plan-exceptions-review] img').count(),0);
   await fillDecision('confirmed','Synthetic209 confirmed without replacing original events');await page.getByLabel('处理说明',{exact:true}).fill('Synthetic209 confirmed explicit revised note');
   assert.equal(await page.getByLabel('已核验此真实人员、排班及完整依据，明确处理',{exact:true}).isChecked(),false);assert(await button('提交本次处理（一次提交）').isDisabled());await page.getByLabel('已核验此真实人员、排班及完整依据，明确处理',{exact:true}).check();
   accept=false;const p=posts;await button('提交本次处理（一次提交）').click();await settle();assert.equal(posts,p);accept=true;
   await page.evaluate(path=>window.__formal209Harness.hold(path,'POST'),paths.exceptions);await click('提交本次处理（一次提交）',paths.exceptions,'POST');await page.waitForFunction(()=>window.__formal209Harness.held());
   const original=await raw(model.seed.slots.delegate);assert(original);const pending=JSON.parse(original);assert.equal(pending.domain,'plan-exceptions');assert.equal(pending.actorId,model.seed.delegate);
   assert.equal(pending.command.outcome,'confirmed');assert.deepEqual(pending.query,model.seed.query);assert.match(pending.commandFingerprint,/^[a-f\d]{64}$/);assert.equal(pending.command.action,undefined);
   await page.evaluate(()=>window.__formal209Harness.visibility(true));await page.evaluate(()=>window.__formal209Harness.pagehide());assert.equal(await page.locator('[data-delegated-plan-exceptions-review]').count(),0);
   await page.evaluate(()=>window.__formal209Harness.release());await settle();assert.equal(await raw(model.seed.slots.delegate),original);await page.evaluate(()=>window.__formal209Harness.visibility(false));await close();
   await configure({enabled:false,requester:3});await open(false);assert(await button('读取此授权／人员／排班').isDisabled());
   for(const r of ['null','wrong-sha']){model.recovery(r);await click('仅 GET 核验原编号',paths.exceptions);assert.equal(await raw(model.seed.slots.delegate),original);}
   model.recovery('valid');await click('仅 GET 核验原编号',paths.exceptions);assert.equal(await raw(model.seed.slots.delegate),null);assert.equal(await page.locator('[data-delegated-plan-exceptions-review]').count(),0);await close();
  });
  await group('209_blocked_only_followup_dirty_target_cancel_preserves_old_context_and_reason',async()=>{
   model.eligible(false);await configure({enabled:true,requester:4});await open();await read();
   // Playwright isDisabled retargets label-nested option to its enabled select.
   // Check the actual native OPTION properties, not that parent control state.
   assert.deepEqual(await page.getByLabel('明确处理',{exact:true}).locator('option[value="confirmed"],option[value="excused"]').evaluateAll(items=>items.map(item=>({value:item.value,disabled:item.disabled}))),
    [{value:'confirmed',disabled:true},{value:'excused',disabled:true}]);
   assert.equal(await page.getByLabel('明确处理',{exact:true}).locator('option[value="cleared"],option[value="not_applicable"],option[value="annul"]').count(),0);
   await fillDecision('follow_up','Synthetic209 private followup must not silently disappear');accept=false;const original=await page.getByLabel('指定排班 Slot ID',{exact:true}).inputValue(),n=requests.length;
   await page.getByLabel('指定排班 Slot ID',{exact:true}).fill(model.seed.query.grantId);await settle();assert.equal(await page.getByLabel('指定排班 Slot ID',{exact:true}).inputValue(),original);
   assert.equal(await page.getByLabel('处理说明',{exact:true}).inputValue(),'Synthetic209 private followup must not silently disappear');assert.equal(await page.locator('[data-delegated-plan-exceptions-review]').count(),1);
   assert.equal(await page.evaluate(()=>window.__formal209Harness.leave()),false);assert.equal(requests.length,n);accept=true;
   await click('提交本次处理（一次提交）',paths.exceptions,'POST');assert.equal(JSON.parse(await raw(model.seed.slots.delegate)).command.outcome,'follow_up');await click('仅 GET 核验原编号',paths.exceptions);
   assert.equal(await raw(model.seed.slots.delegate),null);await close();
  });
  await group('209_Auth_requester_double_epoch_hidden_GET_StrictMode_foreign_slot_390px',async()=>{
   model.eligible(true);await configure({requester:5});await open();await target();await page.evaluate(path=>window.__formal209Harness.hold(path,'GET'),paths.exceptions);
   await click('读取此授权／人员／排班',paths.exceptions);await page.waitForFunction(()=>window.__formal209Harness.held());await page.evaluate(()=>window.__formal209Harness.authValid(false));assert.equal(await dialog().count(),0);
   await page.evaluate(()=>window.__formal209Harness.authValid(true));await page.evaluate(()=>window.__formal209Harness.release());await settle();assert.equal(await page.locator('[data-delegated-plan-exceptions-review]').count(),0);
   await open();await target();await page.evaluate(path=>window.__formal209Harness.hold(path,'GET'),paths.exceptions);await click('读取此授权／人员／排班',paths.exceptions);await page.waitForFunction(()=>window.__formal209Harness.held());
   await configure({identity:'other',requester:6});await configure({identity:'delegate',requester:5});await page.evaluate(()=>window.__formal209Harness.release());await settle();assert.equal(await dialog().count(),0);
   await open();await read();await page.getByLabel('处理说明',{exact:true}).fill('Synthetic209 secret-free private draft clears');const n=requests.length;
   await page.evaluate(()=>window.__formal209Harness.visibility(true));assert.equal(await page.locator('[data-delegated-plan-exceptions-review]').count(),0);assert.equal(await page.getByLabel('指定排班 Slot ID',{exact:true}).inputValue(),'');
   await page.evaluate(()=>window.__formal209Harness.visibility(false));await settle();assert.equal(requests.length,n);await close();
   await page.evaluate(k=>sessionStorage.setItem(k,'{'),model.seed.slots.delegate);await open();assert(await button('读取此授权／人员／排班').isDisabled());const before=requests.length;
   await button('仅 GET 核验原编号').click();await settle();assert.equal(requests.length,before);assert.equal(await raw(model.seed.slots.delegate),'{');await close();
   await page.evaluate(k=>{if(sessionStorage.getItem(k)!=='{')throw Error('owned_slot_changed');sessionStorage.removeItem(k);},model.seed.slots.delegate);
  });
  assert.equal(groups.length,limits.groups);assert.equal(posts,3);assert.deepEqual(errors,[]);assert.deepEqual(model.writes.map(w=>[w.domain,w.command.action??w.command.outcome]),[['management','grant'],['plan-exceptions','confirmed'],['plan-exceptions','follow_up']]);
  report={groups,apiRequests:requests.length,gets:requests.filter(r=>r.method==='GET').length,posts,totalHttp,elapsedMs:Date.now()-started,
   actualLauncher:true,actualPanel:true,actualAdminParent:false,actualEnterpriseManager:false,structuredOwnerGrantPost:true,futureOnlyDefault:true,gateOffRevokeDisabled:true,
   actualDelegateConfirmedPost:true,blockedOnlyFollowupPost:true,dirtyTargetCancelPreservesAll:true,oneSharedActorSlot:true,originalFullShaGETOnly:true,
   flagsOffOriginalGET:true,hiddenClearsBodyAndReason:true,lateResponseFenced:true,AuthDoubleEpoch:true,requesterDoubleEpoch:true,StrictModeReplay:true,
   mobileWidth:390,horizontalOverflow:false,syntheticAuth:true,syntheticApi:true,actualAuth:false,actualSql:false,realAuthority:false,externalRequests:0,originalWriterPosts:0,diskBundle:false};
 }catch(error){failure=Error(`formal209_browser_failed:${stage}:${error.message}:${JSON.stringify({errors,groups,apiRequests:requests.length,posts,totalHttp,elapsedMs:Date.now()-started,last:requests.slice(-4).map(r=>({path:r.path,method:r.method,mode:r.query?.mode}))})}`,{cause:error});throw failure;}
 finally{closing=true;clearTimeout(timer);await runAttendanceCleanupSteps([{name:'held body',run:async()=>{if(page&&!page.isClosed())await page.evaluate(()=>window.__formal209Harness?.release()).catch(()=>{});}},
  {name:'owned context',run:()=>context?bounded(context.close(),6000):undefined},{name:'owned browser',run:()=>browser?bounded(browser.close(),6000):undefined},
  {name:'HTTP work',run:()=>bounded(Promise.allSettled([...inflight]),6000)},{name:'owned listener',run:()=>{server?.closeAllConnections();return server?.listening?bounded(new Promise((yes,no)=>server.close(e=>e?no(e):yes())),6000):undefined;}},
  {name:'esbuild',run:async()=>{(await import('esbuild')).stop();}}]).catch(error=>{if(failure)throw new AggregateError([failure,error],'formal209_browser_cleanup_failed');throw error;});
  assert(!browser?.isConnected()&&!server?.listening);if(failure)console.error(JSON.stringify({cleanup:'formal209-browser',browserClosed:!browser?.isConnected(),listenerStopped:!server?.listening,apiRequests:requests.length,posts,totalHttp}));}
 return{...report,browserClosed:true,listenerStopped:true};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv.length===3&&process.argv[2]==='--run-local')console.log(JSON.stringify(await verifyDelegatedPlanExceptionsBrowser()));
 else if(process.argv.length===2)console.log('Inert. node --import tsx scripts/fixtures/attendance-delegated-plan-exceptions-browser.mjs --run-local');else throw Error('explicit_run_local_only');
}
