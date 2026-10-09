//243 INERT except explicit --run-local. Only synthetic HTTP/Auth DTOs; no SQL.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {runAttendanceCleanupSteps} from './attendance-cleanup.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url)),require=createRequire(import.meta.url),base='/api/merchant-enterprise/attendance/';
const endpoints=['application-window','corrections','corrections/context','history','revision-requests','missing'].map(v=>base+v);
export const applicationWindowBrowserLimits=Object.freeze({ttlMs:180000,http:70,api:40,posts:3});
export async function createApplicationWindowBrowserModel(){
 const f=require('../../src/lib/merchantAttendanceApplicationWindowTestFixtures.ts'),p=require('../../src/lib/merchantAttendanceApplicationWindow.ts');
 const old=require('./attendance-correction-model.ts').createCorrectionFixture(),revision=require('./attendance-revision-cycle-model.ts');
 const fixtures=Object.fromEntries(await Promise.all(p.APPLICATION_WINDOW_FAMILIES.map(async family=>[family,await f.applicationWindowFixture(family)])));
 const seed={siteId:f.windowSite,employee:f.windowId(3),auth:f.windowActor,other:f.windowId(99),worker:f.windowWorker,root:f.windowId(100)},records=new Map(),writes=[];let hideReceipt=false,loseFirst=true;
 async function respond(url,method,text,actor=seed.auth){
  const u=new URL(url);assert(endpoints.includes(u.pathname));assert(['GET','POST'].includes(method));assert([seed.auth,seed.other].includes(actor));
  if(u.pathname!==base+'application-window'){
   if(actor!==seed.auth)return{status:403,text:JSON.stringify({ok:false,error:'attendance_access_denied'})};
   if(u.pathname===base+'revision-requests'){assert.equal(method,'GET');return{status:200,text:JSON.stringify({ok:true,...revision.wire(),moduleEnabled:true})};}
   if(u.pathname===base+'missing'){assert.equal(method,'GET');const app=fixtures.missing_revision.result.application,requestId=u.searchParams.get('requestId');return{status:200,text:JSON.stringify({ok:true,...app,
    moduleEnabled:true,fromDate:u.searchParams.get('fromDate'),throughDate:u.searchParams.get('throughDate'),detail:requestId&&requestId!=='null'?app.detail:null})};}
   const r=await old.apiFetch(u.pathname+u.search,{method,...(method==='POST'?{body:text}:{} )});return{status:r.status,text:await r.text()};
  }
  let query,command=null;if(method==='POST')({query,command}=p.parseApplicationWindowBody(p.parseApplicationWindowJson(text,'request')));else query=p.parseApplicationWindowHttpQuery(u.href);
  const fixture=fixtures[query.family];let data;
  if(command){assert.equal(actor,seed.auth);assert(!records.has(command.command.operationId),'unexpected_duplicate_POST');assert.equal(command.expectedWindowFingerprint,fixture.result.window.windowFingerprint);
   const receipt={...fixture.post.receipt,operationId:command.command.operationId,requestId:command.command.operationId,
    commandFingerprint:await p.applicationWindowCommandFingerprint(query,command,actor)};
   data={...fixture.post,receipt};records.set(receipt.operationId,{data,query,command});writes.push({query,command});
  }else if(query.mode==='prepare'){
   assert.equal(actor,seed.auth);let application=fixture.result.application;
   if(query.family.startsWith('missing'))application={...application,fromDate:query.fromDate,throughDate:query.throughDate};data={...fixture.result,application};
  }else{assert.equal(query.mode,'recover');const saved=records.get(query.operationId);data={...fixture.post,actorId:actor,mode:'recover',receipt:actor===seed.auth&&!hideReceipt?saved?.data.receipt??null:null};}
  await p.parseApplicationWindowResult(data,{query,command,authUserId:actor});const lost=!!command&&loseFirst; if(lost)loseFirst=false;
  return{status:200,text:lost?'{"ok":':JSON.stringify({ok:true,data}),query,command};
 }
 return{seed,fixtures,records,writes,old,respond,hideReceipt:v=>{hideReceipt=v;}};
}
async function bounded(promise,ms=12000){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('window_browser_deadline')),ms);})]);}finally{clearTimeout(timer);}}
async function assets(seed){
 const{build}=await import('esbuild'),{compile}=await import('@tailwindcss/node'),{default:ts}=await import('typescript');
 const bundle=await build({absWorkingDir:root,entryPoints:['scripts/fixtures/attendance-application-window-browser-entry.tsx'],bundle:true,write:false,metafile:true,platform:'browser',format:'esm',target:['es2020'],jsx:'automatic',tsconfig:path.join(root,'tsconfig.json'),outfile:'qa.js',logLevel:'warning',define:{'process.env':'{}','process.env.NODE_ENV':'"development"',__AW_SEED__:JSON.stringify(seed)}});
 const candidates=new Set();for(const name of Object.keys(bundle.metafile.inputs)){assert(!/node:crypto|\.server\.ts$/.test(name));if(!/\.tsx?$/.test(name)||name.includes('node_modules'))continue;
  const ast=ts.createSourceFile(name,await readFile(path.join(root,name),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);const visit=n=>{if(ts.isStringLiteral(n)||ts.isNoSubstitutionTemplateLiteral(n)||ts.isTemplateHead(n)||ts.isTemplateMiddle(n)||ts.isTemplateTail(n))n.text.split(/\s+/).filter(Boolean).forEach(v=>candidates.add(v));ts.forEachChild(n,visit);};visit(ast);}
 const css=(await compile('@import "tailwindcss";',{base:root,onDependency:()=>{}})).build([...candidates])+'body{margin:0;background:#f8fafc;font-family:Arial,sans-serif}.qa-main{max-width:1100px;margin:auto;min-width:0}';
 return{js:bundle.outputFiles.find(f=>f.path.endsWith('.js')).contents,css};
}
export async function verifyApplicationWindowBrowser(){
 const started=Date.now(),model=await createApplicationWindowBrowserModel(),requests=[],errors=[],inflight=new Set();let totalHttp=0,posts=0,server,browser,context,page,origin,files,closing=false,failure,report,stage='setup',dialogAccept=true;
 const timer=setTimeout(()=>{closing=true;void context?.close().catch(()=>{});server?.closeAllConnections();},applicationWindowBrowserLimits.ttlMs);
 const button=name=>page.getByRole('button',{name,exact:true});
 const settle=async()=>{await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));await bounded(Promise.allSettled([...inflight]));};
 const click=async(name,endpoint='application-window',method='GET')=>{const[r]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname===base+endpoint&&r.request().method()===method),button(name).click()]);await r.finished();assert.equal(r.status(),200,await r.text());await settle();};
 const configure=async v=>{await page.evaluate(v=>window.__awHarness.configure(v),v);await settle();};
 const pending=()=>page.evaluate(()=>Object.entries(sessionStorage).filter(([key])=>/^faolla:attendance:(correction:v1|revision-cycle:v2|missing:v1):/.test(key)));
 const chooseCorrection=async()=>{await button('选择原始班次').click();await page.getByLabel('开始日期',{exact:true}).fill('2026-09-28');await page.getByLabel('结束日期（含当天）',{exact:true}).fill('2026-09-28');await click('查询本人记录','history');await button('选择本班次申请补正').click();await button('读取当前申请窗口').waitFor();await settle();};
 const recoverLocal=async()=>{await button('核验规则窗口原编号').click();await page.getByRole('button',{name:/^打开原编号核对：/}).click();await button('仅 GET 核对原编号').waitFor();await settle();};
 const fillNew=async reason=>{await page.getByLabel('申请理由',{exact:true}).fill(reason);await page.getByRole('checkbox',{name:/我已核对声明时间/}).check();};
 try{
  files=await bounded(assets(model.seed),45000);server=createServer((req,res)=>{const work=(async()=>{assert(!closing);assert(++totalHttp<=applicationWindowBrowserLimits.http);assert.equal(req.headers.host,new URL(origin).host);const u=new URL(req.url,origin);
   res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Security-Policy',"default-src 'none';script-src 'self';style-src 'self' 'unsafe-inline';connect-src 'self';img-src 'self';base-uri 'none';form-action 'none';frame-ancestors 'none'");
   if(['/', '/qa.js','/qa.css','/favicon.ico'].includes(u.pathname)){assert.equal(req.method,'GET');assert.equal(u.search,'');if(u.pathname==='/favicon.ico')return res.writeHead(204).end();const html='<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="/favicon.ico"><link rel="stylesheet" href="/qa.css"><div id="qa-root"></div><script type="module" src="/qa.js"></script></html>';
    return res.writeHead(200,{'Content-Type':u.pathname==='/'?'text/html;charset=utf-8':u.pathname==='/qa.js'?'text/javascript;charset=utf-8':'text/css;charset=utf-8'}).end(u.pathname==='/'?html:u.pathname==='/qa.js'?files.js:files.css);}
   assert(endpoints.includes(u.pathname));assert(requests.length<applicationWindowBrowserLimits.api);if(req.method==='POST')assert(++posts<=applicationWindowBrowserLimits.posts);let text='',bytes=0;for await(const chunk of req){bytes+=chunk.length;assert(bytes<=16384);text+=chunk.toString('utf8');}
   const result=await model.respond(u.href,req.method,text,req.headers['x-synthetic-actor']);requests.push({path:u.pathname,method:req.method,query:result.query,action:result.command?.command.action});res.writeHead(result.status,{'Content-Type':'application/json;charset=utf-8'}).end(result.text);
  })();inflight.add(work);void work.catch(error=>{errors.push(error.message);if(!res.headersSent)res.writeHead(500,{'Content-Type':'application/json'});res.end('{"ok":false}');}).finally(()=>inflight.delete(work));});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const address=server.address();assert(address&&typeof address==='object'&&address.address==='127.0.0.1');origin=`http://127.0.0.1:${address.port}`;
  const{chromium}=await import('playwright'),launch=chromium.launch({headless:true});void launch.then(b=>{if(closing)return b.close();}).catch(()=>{});browser=await bounded(launch,15000);context=await browser.newContext({serviceWorkers:'block',acceptDownloads:false,viewport:{width:390,height:900}});
  await context.route('**/*',async route=>{const r=route.request(),u=new URL(r.url());if(u.origin!==origin||!(['/', '/qa.js','/qa.css','/favicon.ico'].includes(u.pathname)&&r.method()==='GET'&&!u.search||endpoints.includes(u.pathname)&&['GET','POST'].includes(r.method()))){errors.push('external_or_unknown_request');return route.abort();}await route.continue();});
  page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&!m.text().includes('status of 403'))errors.push(m.text());});page.on('popup',()=>errors.push('popup'));page.on('download',()=>errors.push('download'));page.on('dialog',d=>void(dialogAccept?d.accept():d.dismiss()).catch(()=>{}));
  stage='host_initial_and_new_prepare';await page.goto(origin);await button('打开合成申请宿主').waitFor();assert.equal(requests.length,0);await button('打开合成申请宿主').click();await button('选择原始班次').waitFor({state:'visible'});await page.waitForFunction(()=>!Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='选择原始班次')?.disabled);await settle();
  await chooseCorrection();const beforeRead=requests.length;await settle();assert.equal(requests.length,beforeRead);assert.equal(await page.getByRole('region',{name:'本人考勤补正申请'}).count(),0);await click('读取当前申请窗口');await page.getByLabel('申请理由',{exact:true}).waitFor();
  await fillNew('Synthetic browser first');await click('提交本人申请','application-window','POST');await button('仅 GET 核对原编号').waitFor();const original=await pending();assert.equal(original.length,1);assert.equal(model.writes.length,1);
  stage='reload_null_and_exact_get_recovery';await page.reload();await configure({enabled:false});await button('打开合成申请宿主').click();await button('核验规则窗口原编号').waitFor();await settle();await recoverLocal();model.hideReceipt(true);await click('仅 GET 核对原编号');assert.deepEqual(await pending(),original);model.hideReceipt(false);await click('仅 GET 核对原编号');assert.equal((await pending()).length,0);assert.equal(model.writes.length,1);
  stage='dirty_hide_and_identity_late_body';await configure({enabled:true});await page.waitForFunction(()=>!Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='选择原始班次')?.disabled);await chooseCorrection();await click('读取当前申请窗口');await page.getByLabel('申请理由',{exact:true}).fill('Synthetic dirty draft');dialogAccept=false;await button('返回原申请页').click();assert.equal(await page.getByLabel('申请理由',{exact:true}).inputValue(),'Synthetic dirty draft');assert.equal(await page.evaluate(()=>window.__awHarness.leave()),false);dialogAccept=true;
  const beforeHide=requests.length;await page.evaluate(()=>window.__awHarness.visibility(true));assert.equal(await page.getByLabel('申请理由',{exact:true}).count(),0);await page.evaluate(()=>window.__awHarness.visibility(false));await settle();assert.equal(requests.length,beforeHide);await click('读取当前申请窗口');assert.equal(await page.getByLabel('申请理由',{exact:true}).inputValue(),'');await fillNew('Synthetic delayed receipt');await page.evaluate(()=>window.__awHarness.hold());await click('提交本人申请','application-window','POST');await page.waitForFunction(()=>window.__awHarness.held());const late=await pending();assert.equal(late.length,1);await configure({other:true});await page.evaluate(()=>window.__awHarness.release());await settle();assert.deepEqual(await pending(),late);await configure({other:false});await recoverLocal();await click('仅 GET 核对原编号');assert.equal((await pending()).length,0);assert.equal(model.writes.length,2);
  stage='revision_actual_host_prepare';await configure({kind:'correction_revision',open:true});await button('通过规则窗口准备再次修订').waitFor();await button('通过规则窗口准备再次修订').click();await click('读取当前申请窗口');assert.match(await page.getByRole('region',{name:'规则申请窗口'}).innerText(),/原根申请截止上限/);
  stage='missing_draft_then_prepare';await configure({kind:'missing',open:true});await page.getByLabel('申报开始时间',{exact:true}).waitFor();await page.getByLabel('申报开始时间',{exact:true}).fill('2026-09-28T10:00');await page.getByLabel('申报结束时间',{exact:true}).fill('2026-09-28T19:00');await page.getByLabel('漏卡原因',{exact:true}).fill('Synthetic missing seed');await page.getByRole('checkbox',{name:/确认整段无打卡/}).check();const beforeSeed=posts;await button('继续核验规则窗口').click();assert.equal(posts,beforeSeed);await click('读取当前申请窗口');assert.equal(await page.getByLabel('申请理由',{exact:true}).inputValue(),'Synthetic missing seed');assert.equal(await page.getByLabel('申请上班时间',{exact:true}).inputValue(),'2026-09-28T10:00');
  stage='missing_revision_actual_host_prepare';await configure({kind:'missing',open:false});await button('打开合成申请宿主').click();await page.getByRole('button',{name:/查看申请 0400/}).click();await button('申请修订整段申报').click();await page.getByLabel('修订原因',{exact:true}).fill('Synthetic missing revision');await page.getByRole('checkbox',{name:/确认整段无打卡/}).check();await button('继续核验规则窗口').click();await click('读取当前申请窗口');assert.match(await page.getByRole('region',{name:'规则申请窗口'}).innerText(),/原根申请截止上限/);
  stage='flagoff_legacy_success';await configure({kind:'correction',enabled:false,open:true});await page.waitForFunction(()=>!Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='选择原始班次')?.disabled);await button('选择原始班次').click();await page.getByLabel('开始日期',{exact:true}).fill('2026-09-28');await page.getByLabel('结束日期（含当天）',{exact:true}).fill('2026-09-28');await click('查询本人记录','history');await click('选择本班次申请补正','corrections');await page.getByLabel('申请理由（1～500 字，不含换行）',{exact:true}).fill('Synthetic legacy still works');await page.getByRole('checkbox',{name:/我已核对全部时间与休息/}).check();await click('明确提交补正申请','corrections','POST');assert.equal(model.old.writes(),1);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'390px_overflow');assert.deepEqual(errors,[]);assert.equal(posts,3);
  report={groups:7,actualHosts:['correction','correction_revision','missing','missing_revision'],actualWindow:true,mockedData:true,actualSql:false,actualAuth:false,
   windowPosts:model.writes.length,legacyPosts:model.old.writes(),gets:requests.filter(r=>r.method==='GET').length,posts,apiRequests:requests.length,totalHttp,initialHttp:0,newPanelAutomaticHttp:0,
   exactOriginalRecovery:true,flagoffOriginalRecovery:true,unknownNullKeepsPending:true,identityLateBodyPreserves:true,dirtyLeaveRejected:true,hiddenNoAutomaticHttp:true,flagoffLegacySuccess:true,mobileWidth:390,horizontalOverflow:false,
   externalRequests:0,diskBundle:false,elapsedMs:Date.now()-started};
 }catch(error){failure=Error(`application_window_browser_failed:${stage}:${error.message}:${JSON.stringify({errors,requests:requests.slice(-5)})}`,{cause:error});throw failure;}
 finally{closing=true;clearTimeout(timer);await runAttendanceCleanupSteps([{name:'held body',run:async()=>{if(page&&!page.isClosed())await page.evaluate(()=>window.__awHarness?.release()).catch(()=>{});}},
  {name:'owned context',run:()=>context?bounded(context.close(),6000):undefined},{name:'owned browser',run:()=>browser?bounded(browser.close(),6000):undefined},{name:'HTTP work',run:()=>bounded(Promise.allSettled([...inflight]),6000)},
  {name:'owned listener',run:()=>{server?.closeAllConnections();return server?.listening?bounded(new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve())),6000):undefined;}},{name:'esbuild',run:async()=>{(await import('esbuild')).stop();}}]).catch(error=>{if(failure)throw new AggregateError([failure,error],'window_browser_cleanup_failed');throw error;});assert(!browser?.isConnected()&&!server?.listening);
  if(failure)console.error(JSON.stringify({cleanup:'application-window-browser',browserClosed:!browser?.isConnected(),listenerStopped:!server?.listening,apiRequests:requests.length,totalHttp}));}
 return{...report,browserClosed:true,listenerStopped:true};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv.length===3&&process.argv[2]==='--run-local')console.log(JSON.stringify(await verifyApplicationWindowBrowser()));
 else if(process.argv.length===2)console.log('Inert. node --import tsx scripts/fixtures/attendance-application-window-browser.mjs --run-local');else throw Error('explicit_run_local_only');
}
