//229 INERT on import. Explicit loopback React protocol acceptance only; no DB.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {build,stop} from 'esbuild';
import {compile} from '@tailwindcss/node';
import ts from 'typescript';
const root=fileURLToPath(new URL('../',import.meta.url)),require=createRequire(import.meta.url);
const {createBacklogNavigationModel,backlogNavigationSeed:seed,backlogNavigationApi:api}=require('./fixtures/attendance-owner-backlog-navigation-browser-model.ts');
export const backlogNavigationLimits=Object.freeze({ttlMs:240000,requestLimit:100,postLimit:0});
export const backlogNavigationGroups=Object.freeze(['correction_fresh_target','revision_fresh_target','missing_exact_submission_day',
 'stale_row_processed_denied_and_paused','three_original_pending_receipts_before_new_target','dirty_exit_and_explicit_fresh_backlog',
 'single_host_and_feature_gate','hidden_actor_late_reply_and_mobile','parent_settings_draft_blocks_navigation',
 'parent_config_pending_runtime_blocks_selected_row','outer_leave_guard_preserves_or_discards_draft_explicitly']);
const paths=new Set(Object.values(api)),statics=new Set(['/','/qa.js','/qa.css','/favicon.ico']);
export const backlogNavigationHeaders=Object.freeze({'Content-Security-Policy':"default-src 'self'; script-src 'self'; connect-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
 'X-Frame-Options':'DENY','X-Content-Type-Options':'nosniff','Cache-Control':'no-store','Referrer-Policy':'no-referrer'});
export function backlogNavigationRequestAllowed(raw,method,origin){
 try{const base=new URL(origin),u=new URL(raw);if(base.protocol!=='http:'||base.hostname!=='127.0.0.1'||!base.port||base.origin!==origin||u.origin!==origin||u.username||u.password||u.hash||/[\u0000-\u0020\u007f\\]/.test(raw)||method!=='GET')return false;
  return statics.has(u.pathname)?!u.search:paths.has(u.pathname);
 }catch{return false;}
}
async function assets(){
 const output=await build({absWorkingDir:root,entryPoints:['scripts/fixtures/attendance-owner-backlog-navigation-browser.tsx'],bundle:true,write:false,metafile:true,
  platform:'browser',format:'esm',jsx:'automatic',target:['es2020'],tsconfig:path.join(root,'tsconfig.json'),outfile:'backlog-navigation-qa.js',logLevel:'warning',
  define:{'process.env':'{}','process.env.NODE_ENV':'"development"',__BACKLOG_NAV_SEED__:JSON.stringify(seed)}});
 for(const filename of Object.keys(output.metafile.inputs))assert(!/node:crypto|\.server\.ts$|browser-model/.test(filename),'backlog_navigation_server_import');
 const tokens=new Set();for(const filename of Object.keys(output.metafile.inputs).filter(n=>/\.tsx?$/.test(n)&&!n.includes('node_modules'))){
  const source=ts.createSourceFile(filename,await readFile(path.join(root,filename),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const visit=node=>{if(ts.isStringLiteral(node)||ts.isNoSubstitutionTemplateLiteral(node)||ts.isTemplateHead(node)||ts.isTemplateMiddle(node)||ts.isTemplateTail(node))node.text.split(/\s+/).filter(Boolean).forEach(token=>tokens.add(token));ts.forEachChild(node,visit);};visit(source);
 }
 const css=(await compile('@import "tailwindcss";',{base:root,onDependency:()=>{}})).build([...tokens])+output.outputFiles.filter(f=>f.path.endsWith('.css')).map(f=>f.text).join('\n')
  +'body{margin:0;background:#f8fafc;color:#111;font-family:Arial,sans-serif}.qa-main{max-width:1200px;margin:auto;padding:8px}.qa-toolbar{padding:12px;font-size:12px}.qa-controls{display:flex;gap:8px;flex-wrap:wrap}.qa-controls button{border:1px solid #64748b;padding:6px}';
 const js=output.outputFiles.find(f=>f.path.endsWith('.js'));assert(js);return {js:js.contents,css};
}
export async function startOwnerBacklogNavigationBrowserServer({ttlMs=240000,requestLimit=100}={}){
 assert(Number.isInteger(ttlMs)&&ttlMs>=1000&&ttlMs<=240000,'backlog_navigation_ttl');assert(Number.isInteger(requestLimit)&&requestLimit>=1&&requestLimit<=100,'backlog_navigation_budget');
 let files;try{files=await assets();}catch(e){stop();throw e;}
 const model=createBacklogNavigationModel(),requests=[],errors=[];let origin=null,total=0,posts=0,closing=false,timer,closePromise,closedResolve;
 const closed=new Promise(resolve=>{closedResolve=resolve;});
 const server=createServer((request,response)=>{try{
  for(const [key,value]of Object.entries(backlogNavigationHeaders))response.setHeader(key,value);
  if(closing||!origin||request.headers.host!==new URL(origin).host||request.headers.origin&&request.headers.origin!==origin||['cross-site','same-site'].includes(request.headers['sec-fetch-site']??''))return response.writeHead(403).end();
  const url=new URL(request.url??'/',origin),method=request.method??'';if(method==='POST')posts++;
  if(!backlogNavigationRequestAllowed(url.href,method,origin))return response.writeHead(403).end();
  if(++total>requestLimit)return response.writeHead(429).end();
  if(statics.has(url.pathname)){
   if(url.pathname==='/favicon.ico')return response.writeHead(204).end();
   if(url.pathname==='/')return response.writeHead(200,{'Content-Type':'text/html;charset=utf-8'}).end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>229 合成待审导航验收</title><link rel="stylesheet" href="/qa.css"><div id="qa-root"></div><script type="module" src="/qa.js"></script></html>');
   return response.writeHead(200,{'Content-Type':url.pathname==='/qa.js'?'text/javascript;charset=utf-8':'text/css;charset=utf-8'}).end(url.pathname==='/qa.js'?files.js:files.css);
  }
  const actor=request.headers['x-backlog-navigation-actor'];if(typeof actor!=='string')return response.writeHead(403).end();
  const outcome=model.respond({url:url.href,method,actor});requests.push({method,path:url.pathname,actor,status:outcome.status});
  response.writeHead(outcome.status,{'Content-Type':'application/json;charset=utf-8'}).end(JSON.stringify(outcome.body));
 }catch(e){if(!closing)errors.push(e.message);if(!response.destroyed)response.writeHead(400,{'Content-Type':'application/json'}).end(JSON.stringify({ok:false,error:'attendance_invalid_request'}));}});
 const snapshot=()=>({syntheticOnly:true,realSql:false,realAuth:false,listenerActive:server.listening,totalHttpRequests:total,postAttempts:posts,requests:structuredClone(requests),errors:[...errors],model:model.snapshot()});
 const close=()=>closePromise??=(async()=>{closing=true;clearTimeout(timer);try{if(server.listening)await new Promise((resolve,reject)=>{server.close(e=>e?reject(e):resolve());server.closeAllConnections();});}finally{stop();closedResolve();}})();
 try{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const address=server.address();assert(address&&typeof address==='object'&&address.address==='127.0.0.1');origin=`http://127.0.0.1:${address.port}`;
  timer=setTimeout(()=>void close(),ttlMs);return {origin,seed,api,configure:model.configure,pending:model.pending,snapshot,close,closed};
 }catch(e){await close();throw e;}
}
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
export async function runOwnerBacklogNavigationBrowserAcceptance(){
 let server,browser,context,closing=false,timer,held=null,stage='server';const errors=[],consoleErrors=[],requests=[],groups=[],gates=new Set();
 const run=async()=>{
  server=await startOwnerBacklogNavigationBrowserServer();if(closing){await server.close();throw Error('backlog_navigation_expired');}
  const {chromium}=await import('playwright');if(closing)throw Error('backlog_navigation_expired');browser=await chromium.launch({headless:true});
  if(closing){await browser.close();throw Error('backlog_navigation_expired');}
  context=await browser.newContext({viewport:{width:1280,height:1000},serviceWorkers:'block',acceptDownloads:false});
  if(closing){await context.close();throw Error('backlog_navigation_expired');}
  await context.route('**/*',async route=>{
   const request=route.request();if(closing)return route.abort().catch(()=>{});
   if(!backlogNavigationRequestAllowed(request.url(),request.method(),server.origin)){errors.push('unexpected_route_or_method');return route.abort();}
   requests.push({method:request.method(),path:new URL(request.url()).pathname});
   const gate=held&&new URL(request.url()).pathname===held.path?held:null;
   if(!gate)return route.continue();held=null;gates.add(gate);
   try{const response=await route.fetch();gate.ready.resolve();await gate.release.promise;if(!closing)await route.fulfill({response});}
   catch(e){if(!closing&&!gate.cancelled)errors.push('held_route:'+e.message);}
   finally{gate.done.resolve();gates.delete(gate);}
  });
  const page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
  //Intentional403 resources have browser console entries. They are counted,
  //not mislabeled as uncaught component errors or successful Auth tests.
  page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text());});
  const names={correction:'负责人补正审批',revision:'负责人连续修订审批',missing:'整段漏卡审核工作区'};
  const closeNames={correction:'返回核对列表',revision:'返回考勤管理',missing:'关闭整段漏卡'};
  const region=kind=>page.getByRole('region',{name:names[kind],exact:true});
  const list=()=>page.getByRole('region',{name:'负责人待审积压（只读）',exact:true});
  const calls=()=>server.snapshot().model.calls;
  const listCount=()=>calls().filter(c=>c.path===api.backlog).length;
  const targetCalls=kind=>calls().filter(c=>c.path===api[kind]);
  const settle=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const waitModel=async predicate=>{for(let n=0;n<100;n++){if(predicate())return;await settle();}assert(predicate(),'backlog_navigation_expected_request');};
  const requestRead=async(kind,requestId=server.seed[kind],operationId=null)=>{
   await waitModel(()=>targetCalls(kind).some(c=>c.requestId===requestId&&c.operationId===operationId));
   await region(kind).waitFor();await region(kind).getByRole('status').filter({hasText:/已重新读取|已读取|原操作|原审批|已确认|核对条件|平台|当前账号|当前身份/}).first().waitFor();
  };
  const reset=async()=>{
   server.configure({mode:'normal',receiptAvailable:false});
   const off=page.getByRole('button',{name:'开启测试导航开关',exact:true});if(await off.count())await off.click();
   const wrong=page.getByRole('button',{name:'恢复测试负责人',exact:true});if(await wrong.count())await wrong.click();
   const unmount=page.getByRole('button',{name:'卸载测试管理页',exact:true});if(await unmount.count())await unmount.click();
   await page.getByRole('button',{name:'重挂测试管理页',exact:true}).click();
   await page.getByRole('button',{name:'负责人待审积压（只读）',exact:true}).waitFor();
   await page.waitForFunction(()=>{const b=[...document.querySelectorAll('button')].find(e=>e.textContent==='负责人待审积压（只读）');return b&&!b.disabled;});
  };
  const openList=async()=>{
   const before=listCount();await page.getByRole('button',{name:'负责人待审积压（只读）',exact:true}).click();await list().waitFor();assert.equal(listCount(),before,'opening_backlog_is_not_query');
   await list().getByRole('button',{name:'查询待审积压',exact:true}).click();await list().locator('li').filter({hasText:server.seed.missing}).waitFor();assert.equal(listCount(),before+1);
  };
  const select=kind=>list().locator('li').filter({hasText:server.seed[kind]}).getByRole('button',{name:'打开审批详情',exact:true}).click();
  const returned=async kind=>{
   const before=listCount();await region(kind).getByRole('button',{name:closeNames[kind],exact:true}).click();await list().waitFor();assert.equal(listCount(),before,'return_must_not_automatically_query');
   assert.equal(await list().locator('li').count(),0);await list().getByRole('button',{name:'查询待审积压',exact:true}).click();await list().locator('li').first().waitFor();assert.equal(listCount(),before+1);
  };
  stage='initial';await page.goto(server.origin);await reset();
  for(const kind of ['correction','revision','missing']){
   stage=kind+'_fresh';if(kind!=='correction')await reset();await openList();const before=targetCalls(kind).length;await select(kind);await requestRead(kind);
   const c=targetCalls(kind).slice(before);assert.equal(c.length,1);assert.equal(c[0].requestId,server.seed[kind]);assert.equal(c[0].operationId,null);assert.equal(c[0].status,200);
   assert.equal(await region(kind).count(),1);assert.equal(await list().count(),0);
   if(kind==='missing'){
    const path=await page.evaluate(()=>performance.getEntriesByType('resource').map(v=>v.name).filter(v=>v.includes('/attendance/missing?')).at(-1));
    assert.equal(new URL(path).searchParams.get('fromDate'),server.seed.submittedAt.slice(0,10));assert.equal(new URL(path).searchParams.get('throughDate'),server.seed.submittedAt.slice(0,10));
   }
   await returned(kind);groups.push(backlogNavigationGroups[groups.length]);
  }
  stage='stale_row';
  for(const [mode,kind]of [['processed','correction'],['denied','revision'],['paused','missing']]){
   await reset();await openList();server.configure({kind,mode});const before=targetCalls(kind).length;await select(kind);await waitModel(()=>targetCalls(kind).length===before+1);await region(kind).waitFor();await settle();
   if(mode==='processed'){await region(kind).getByText('申请已有决定，不能重复处理。',{exact:true}).waitFor();assert.equal(await region(kind).getByRole('form',{name:'确认补正决定'}).count(),0);}
   if(mode==='denied'){await region(kind).getByRole('status').filter({hasText:'当前账号不是此企业的有效负责人'}).waitFor();assert.equal(targetCalls(kind).at(-1).status,403);}
   if(mode==='paused'){await region(kind).getByText('平台暂未开放新申请和审批；可以查询及撤回本人待审申请。',{exact:true}).waitFor();
    for(const b of await region(kind).getByRole('button',{name:/批准|驳回/}).all())assert(await b.isDisabled());}
  }
  groups.push(backlogNavigationGroups[3]);
  stage='pending';
  for(const kind of ['correction','revision','missing']){
   await reset();const p=server.pending(kind);await page.evaluate(p=>sessionStorage.setItem(p.key,p.raw),p);await openList();const before=targetCalls(kind).length;await select(kind);
   await waitModel(()=>targetCalls(kind).length===before+1);await region(kind).getByText(p.operationId,{exact:false}).first().waitFor();
   assert.equal(targetCalls(kind).at(-1).requestId,p.requestId);assert.equal(targetCalls(kind).at(-1).operationId,p.operationId);
   assert.equal(await page.evaluate(p=>sessionStorage.getItem(p.key),p),p.raw);
   server.configure({kind,mode:'paused',receiptAvailable:true});const label=kind==='missing'?'重新读取／查原收据':'重新核对／查原收据';
   await region(kind).getByRole('button',{name:label,exact:true}).click();await page.waitForFunction(key=>sessionStorage.getItem(key)===null,p.key);
   const recent=targetCalls(kind).slice(before);assert.equal(recent.length,2);assert(recent.every(c=>c.requestId===p.requestId&&c.operationId===p.operationId&&c.method==='GET'));
   assert.equal(recent.at(-1).status,200);
  }
  groups.push(backlogNavigationGroups[4]);
  stage='dirty';await reset();await openList();await select('correction');await requestRead('correction');
  const reason=region('correction').getByRole('textbox',{name:/决定理由/});await reason.fill('229 尚未提交草稿');
  const dialogs=[];page.once('dialog',async dialog=>{dialogs.push(dialog.message());await dialog.dismiss();});
  await region('correction').getByRole('button',{name:closeNames.correction,exact:true}).click();assert.equal(await reason.inputValue(),'229 尚未提交草稿');assert.equal(await list().count(),0);
  page.once('dialog',async dialog=>{dialogs.push(dialog.message());await dialog.accept();});await returned('correction');assert.equal(dialogs.length,2);groups.push(backlogNavigationGroups[5]);
  stage='single_host_gate';await reset();await openList();await page.getByRole('button',{name:'关闭测试导航开关',exact:true}).click();
  for(const kind of ['correction','revision','missing'])assert(await list().locator('li').filter({hasText:server.seed[kind]}).getByRole('button',{name:'打开审批详情',exact:true}).isDisabled());
  await page.getByRole('button',{name:'开启测试导航开关',exact:true}).click();await select('missing');await requestRead('missing');assert.equal(await region('missing').count(),1);
  assert.equal(await page.getByRole('button',{name:'整段漏卡审核',exact:true}).isVisible(),false);await returned('missing');
  await list().getByRole('button',{name:'关闭待审积压',exact:true}).click();await page.getByRole('button',{name:'整段漏卡审核',exact:true}).click();await region('missing').waitFor();assert.equal(await region('missing').count(),1);
  groups.push(backlogNavigationGroups[6]);
  stage='hidden_late';await reset();await openList();
  const hold=()=>{const gate={path:api.correction,ready:deferred(),release:deferred(),done:deferred(),cancelled:false};held=gate;return gate;};
  let gate=hold();await select('correction');await gate.ready.promise;
  await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
  gate.cancelled=true;gate.release.resolve();await gate.done.promise;await settle();assert.equal(await page.getByText('229 尚未提交草稿',{exact:true}).count(),0);
  assert(!(await page.locator('main').textContent()).includes(server.seed.correction));
  await page.getByRole('button',{name:'卸载测试管理页',exact:true}).click();
  await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));});
  await reset();await openList();gate=hold();await select('correction');await gate.ready.promise;
  await page.getByRole('button',{name:'切换测试负责人',exact:true}).click();gate.cancelled=true;gate.release.resolve();await gate.done.promise;await settle();
  assert.equal(await region('correction').count(),0);assert(!(await page.locator('main').textContent()).includes(server.seed.correction));
  await reset();await openList();await page.setViewportSize({width:390,height:900});await settle();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  groups.push(backlogNavigationGroups[7]);
  stage='parent_settings_draft';await page.setViewportSize({width:1280,height:1000});await reset();
  const zone=page.getByLabel('企业考勤时区',{exact:true}),originalZone=await zone.inputValue(),beforeDraftCalls=calls().length;
  assert.equal(originalZone,'Europe/Madrid');await zone.fill('UTC');await settle();
  assert(await page.getByRole('button',{name:'负责人待审积压（只读）',exact:true}).isDisabled());assert.equal(calls().length,beforeDraftCalls);
  await zone.fill(originalZone);await settle();assert.equal(await page.getByRole('button',{name:'负责人待审积压（只读）',exact:true}).isDisabled(),false);
  await openList();groups.push(backlogNavigationGroups[8]);
  stage='parent_pending_runtime';
  const adminKey=`faolla:attendance:config:v1:${server.seed.siteId}:${server.seed.owner}`,adminRaw='229 synthetic non-null parent pending slot';
  assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),adminKey),null);
  await page.evaluate(({key,raw})=>sessionStorage.setItem(key,raw),{key:adminKey,raw:adminRaw});
  const beforePendingCalls=calls().length;
  try{
   await select('correction');await page.getByRole('status').filter({hasText:'请先完成或关闭现有编辑、工作区及待确认操作'}).waitFor();await settle();
   assert.equal(calls().length,beforePendingCalls);assert.equal(await region('correction').count(),0);assert(await list().isVisible());
   assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),adminKey),adminRaw);
  }finally{
   await page.evaluate(({key,raw})=>{if(sessionStorage.getItem(key)===raw)sessionStorage.removeItem(key);},{key:adminKey,raw:adminRaw});
  }
  groups.push(backlogNavigationGroups[9]);
  stage='outer_leave_guard';await reset();await openList();await select('correction');await requestRead('correction');
  const outerDraft=region('correction').getByRole('textbox',{name:/决定理由/});await outerDraft.fill('229 外层离开未提交草稿');
  const beforeOuterCalls=calls().length,outerDialogs=[];
  page.once('dialog',async dialog=>{outerDialogs.push(dialog.message());await dialog.dismiss();});
  await page.getByRole('button',{name:'尝试离开测试管理页',exact:true}).click();await settle();
  assert.equal(await outerDraft.inputValue(),'229 外层离开未提交草稿');assert(await region('correction').isVisible());assert.equal(calls().length,beforeOuterCalls);
  page.once('dialog',async dialog=>{outerDialogs.push(dialog.message());await dialog.accept();});
  await page.getByRole('button',{name:'尝试离开测试管理页',exact:true}).click();await page.getByRole('button',{name:'重挂测试管理页',exact:true}).waitFor();await settle();
  assert.equal(await region('correction').count(),0);assert.equal((await page.locator('main').textContent()).trim(),'');assert.equal(calls().length,beforeOuterCalls);assert.equal(outerDialogs.length,2);
  assert(outerDialogs.every(message=>message.includes('未提交的审批理由')));groups.push(backlogNavigationGroups[10]);
  assert.deepEqual(groups,backlogNavigationGroups);assert.deepEqual(errors,[]);
  assert(consoleErrors.every(s=>/Failed to load resource:.*403/.test(s)),JSON.stringify(consoleErrors));
  const attempts=await page.evaluate(()=>window.backlogNavigationAttempts());assert(attempts.every(c=>c.method==='GET'));assert(requests.every(c=>c.method==='GET'));
  const summary=server.snapshot();assert.equal(summary.postAttempts,0);assert.equal(summary.model.successfulWrites,0);assert.deepEqual(summary.errors,[]);
  return {phase:229,groups,apiRequests:summary.requests.length,totalRequests:summary.totalHttpRequests,posts:0,successfulWrites:0,syntheticProtocolOnly:true,
   realComponents:true,realSql:false,realAuth:false,realWriter:false,expectedDeniedConsoleEntries:consoleErrors.length,pageErrors:errors,
   preexistingPendingFixture:true,actualUiGeneratedSubmission:false,screenshots:false};
 };
 let result;
 try{result=await Promise.race([run(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('backlog_navigation_lifetime:'+stage)),180000);})]);}
 catch(e){throw new Error('backlog_navigation_acceptance_failed:'+stage+':'+e.message,{cause:e});}
 finally{closing=true;clearTimeout(timer);for(const gate of gates){gate.cancelled=true;gate.release.resolve();}held?.release.resolve();
  const cleanup=[];try{await context?.close();}catch(e){cleanup.push(e);}try{await browser?.close();}catch(e){cleanup.push(e);}try{await server?.close();}catch(e){cleanup.push(e);}
  if(cleanup.length)throw new AggregateError(cleanup,'backlog_navigation_cleanup_failed');
 }
 assert.equal(server.snapshot().listenerActive,false);return {...result,browserClosed:true,serverStopped:true};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv.length===3&&process.argv[2]==='--run-local')runOwnerBacklogNavigationBrowserAcceptance().then(result=>console.log(JSON.stringify(result))).catch(e=>{console.error(e.stack);process.exitCode=1;});
 else if(process.argv.length!==3||process.argv[2]!=='--serve-local'){console.error('Usage: node --import tsx scripts/merchant-attendance-owner-backlog-navigation-browser-check.mjs --serve-local|--run-local');process.exitCode=1;}
 else{const server=await startOwnerBacklogNavigationBrowserServer();const close=()=>void server.close();process.once('SIGINT',close);process.once('SIGTERM',close);
  console.log(JSON.stringify({syntheticBacklogNavigation:true,origin:server.origin,...backlogNavigationLimits,realSql:false,realAuth:false}));await server.closed;
  process.removeListener('SIGINT',close);process.removeListener('SIGTERM',close);console.log(JSON.stringify({...server.snapshot(),closed:true}));}
}
