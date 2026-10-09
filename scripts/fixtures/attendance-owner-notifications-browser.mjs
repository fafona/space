// Inert actual-component protocol acceptance. Synthetic API/Auth only, not SQL.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {runAttendanceCleanupSteps} from './attendance-cleanup.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url)),require=createRequire(import.meta.url);
const staticPaths=new Set(['/','/qa.js','/qa.css','/favicon.ico']);
export const ownerNotificationsBrowserLimits=Object.freeze({ttlMs:180000,http:80,api:20});

export function createOwnerNotificationsBrowserModel(){
 const n=require('../../src/lib/merchantAttendanceOwnerNotifications.ts'),nc=require('../../src/lib/merchantAttendanceOwnerNotificationsClient.ts');
 const p=require('../../src/lib/merchantAttendancePeriodClosureV2.ts'),pc=require('../../src/lib/merchantAttendancePeriodClosureV2Client.ts');
 const fixture=require('./attendance-period-closure-ui-model.ts'),id=fixture.periodClosureUiId,actorId=fixture.periodClosureUiOwner;
 const pq={...fixture.periodClosureUiQuery('detail'),cursor:null},period={...fixture.periodClosureUiSummary(),revision:3,state:'disputed',unresolvedDispute:true},artifact=fixture.periodClosureUiArtifact(),stamp='2026-10-08T10:00:00.000001Z';
 const siteId=pq.siteId,entries=[],ledger=new Map(),readAts=new Map();
 const shared={workerId:period.workerId,employeeId:period.employeeId,employeeAuthUserId:period.employeeAuthUserId,readAt:null};
 const periodItem=n.parseOwnerNotificationsItem({...shared,notificationId:id(23601),sourceCategory:'period',sourceOperationId:id(23602),sourceId:period.periodId,
  sourceRevision:2,occurredAt:stamp,target:{periodId:period.periodId,fromDate:period.fromDate,throughDate:period.throughDate}});
 const planItem=n.parseOwnerNotificationsItem({...shared,notificationId:id(23603),sourceCategory:'plan_exception',sourceOperationId:id(23604),sourceId:id(23605),
  sourceRevision:2,occurredAt:'2026-10-08T10:00:00.000000Z',target:{slotId:id(23606)}});
 const items=[periodItem,planItem],base={protocol:'owner-attendance-notifications-v1',siteId,actorId};
 function respond(url,method,auth,bodyText='',fault='none'){
  assert.equal(auth,actorId,'qa_synthetic_auth');assert(['none','null','malformed'].includes(fault),'qa_fault');
  const pathname=new URL(url).pathname;let query,command=null,body;
  if(pathname===n.OWNER_NOTIFICATIONS_API){
   assert(['GET','POST'].includes(method),'qa_method');
   if(method==='POST')({query,command}=n.parseOwnerNotificationsBody(n.parseOwnerNotificationsJson(bodyText,'request')));
   else{assert.equal(bodyText,'','qa_get_body');query=n.parseOwnerNotificationsHttpQuery(url);}
   assert.equal(query.siteId,siteId);const item=items.find(v=>v.notificationId===query.notificationId);
   if(command){assert(item,'qa_known_notification');const previous=ledger.get(command.operationId);
    if(previous)assert.deepEqual(previous.command,command,'qa_operation_conflict');
    else{const receipt={operationId:command.operationId,notificationId:command.notificationId,actorId,readAt:stamp};
     ledger.set(command.operationId,{command:{...command},receipt});entries.push({command:{...command},receipt});if(!readAts.has(item.notificationId))readAts.set(item.notificationId,stamp);}
    body={ok:true,...base,kind:'receipt',receipt:ledger.get(command.operationId).receipt};
   }else if(query.mode==='list'){assert.equal(query.beforeAt,null,'qa_only_first_page');body={ok:true,...base,kind:'list',items:items.map(value=>({...value,readAt:readAts.get(value.notificationId)??null})),nextCursor:null};}
   else if(query.mode==='detail'){assert(item,'qa_known_notification');body={ok:true,...base,kind:'detail',item:{...item,readAt:readAts.get(item.notificationId)??null},canMarkRead:true};}
   else{const saved=ledger.get(query.operationId);assert(!saved||saved.receipt.notificationId===query.notificationId,'qa_recovery_binding');
    body={ok:true,...base,kind:'receipt',receipt:fault==='null'?null:saved?.receipt??null};}
   n.parseOwnerNotificationsResponse(body,query,actorId,command);
  }else{
   assert.equal(pathname,pc.PERIOD_CLOSURE_V2_CLIENT_API,'qa_unknown_endpoint');assert.equal(method,'GET','qa_period_never_written');assert.equal(bodyText,'');
   query=p.parsePeriodClosureV2HttpQuery(url);assert.deepEqual(query,pq,'qa_fresh_exact_target');
   body={ok:true,moduleEnabled:true,data:{protocol:'period-closure-v2',siteId,workerId:period.workerId,actorId,access:'owner',readAt:stamp,kind:'detail',
    period,artifact,artifactVersion:period.currentVersion,sourceChanged:false,operation:null,replayed:false}};
   p.parsePeriodClosureV2Response(body,query,{ownerId:actorId});
  }
  return{query,command,body,text:fault==='malformed'?'{"ok":':JSON.stringify(body),fault};
 }
 return{seed:{siteId,actorId,otherActorId:id(23699),endpoints:[n.OWNER_NOTIFICATIONS_API,pc.PERIOD_CLOSURE_V2_CLIENT_API]},periodItem,planItem,pq,respond,
  key:nc.ownerNotificationsPendingKey(siteId,actorId),replacement(raw){const old=nc.parseOwnerNotificationsPending(raw,siteId,actorId);
   const result=JSON.stringify({...old,command:{...old.command,operationId:id(23698)}});nc.parseOwnerNotificationsPending(result,siteId,actorId);return result;},
  snapshot:()=>({rows:entries.length,entries:structuredClone(entries)})};
}
async function bounded(promise,ms=12000){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('owner_notifications_browser_deadline')),ms);})]);}finally{clearTimeout(timer);}}
async function assets(seed){
 const {build}=await import('esbuild'),{compile}=await import('@tailwindcss/node'),{default:ts}=await import('typescript');
 const bundle=await build({absWorkingDir:root,entryPoints:['scripts/fixtures/attendance-owner-notifications-browser-entry.tsx'],bundle:true,write:false,metafile:true,platform:'browser',format:'esm',target:['es2020'],jsx:'automatic',tsconfig:path.join(root,'tsconfig.json'),outfile:'qa.js',logLevel:'warning',
  define:{'process.env':'{}','process.env.NODE_ENV':'"development"',__OWNER_NOTIFICATIONS_SEED__:JSON.stringify(seed)}});
 const candidates=new Set();for(const name of Object.keys(bundle.metafile.inputs)){assert(!/node:crypto|\.server\.ts$/.test(name),'qa_server_import');if(!/\.tsx?$/.test(name)||name.includes('node_modules'))continue;
  const ast=ts.createSourceFile(name,await readFile(path.join(root,name),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const visit=node=>{if(ts.isStringLiteral(node)||ts.isNoSubstitutionTemplateLiteral(node)||ts.isTemplateHead(node)||ts.isTemplateMiddle(node)||ts.isTemplateTail(node))node.text.split(/\s+/).filter(Boolean).forEach(v=>candidates.add(v));ts.forEachChild(node,visit);};visit(ast);}
 const css=(await compile('@import "tailwindcss";',{base:root,onDependency:()=>{}})).build([...candidates])+'body{margin:0;background:#f8fafc;font-family:Arial,sans-serif}.qa-main{max-width:1000px;margin:auto;padding:8px;min-width:0}';
 return{js:bundle.outputFiles.find(f=>f.path.endsWith('.js')).contents,css};
}
export async function verifyOwnerNotificationsBrowser(){
 const model=createOwnerNotificationsBrowserModel(),requests=[],errors=[],inflight=new Set(),deadline=Date.now()+ownerNotificationsBrowserLimits.ttlMs;
 let server,browser,context,page,origin,files,totalHttp=0,closing=false,failure=null,stage='setup',fault='none',dropPost=true,report;
 const timer=setTimeout(()=>{closing=true;void context?.close().catch(()=>{});server?.closeAllConnections();},ownerNotificationsBrowserLimits.ttlMs);
 const settle=async()=>{await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await bounded(Promise.allSettled([...inflight]));};
 const slot=()=>page.evaluate(key=>sessionStorage.getItem(key),model.key);
 const seed=raw=>page.evaluate(({key,raw})=>sessionStorage.setItem(key,raw),{key:model.key,raw});
 const pending=()=>page.getByRole('button',{name:'只读核对标读原号',exact:true});
 const open=async disabled=>{const before=requests.length;await page.getByRole('button',{name:disabled?'核对待确认标读原号':'负责人考勤收件',exact:true}).click();
  await page.getByRole('region',{name:'负责人考勤收件',exact:true}).waitFor();await settle();assert.equal(requests.length,before,'qa_open_zero_http');};
 const clickRequest=async(name,pathname=model.seed.endpoints[0])=>{const [response]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname===pathname),page.getByRole('button',{name,exact:true}).click()]);
  await response.finished();assert.equal(response.status(),200,await response.text());await settle();};
 const detail=async()=>{await clickRequest('读取负责人收件');await page.getByRole('region',{name:'负责人收件列表',exact:true}).getByRole('button',{name:'读取收件详情',exact:true}).first().click();
  await page.getByRole('region',{name:'负责人收件详情',exact:true}).waitFor();await settle();};
 const delay=async()=>{await page.evaluate(()=>window.__ownerNotificationsHarness.holdNext());await pending().click();await page.waitForFunction(()=>window.__ownerNotificationsHarness.snapshot().held);};
 const release=async()=>{await page.evaluate(()=>window.__ownerNotificationsHarness.release());await page.waitForFunction(()=>!window.__ownerNotificationsHarness.snapshot().held);await settle();};
 try{
  files=await bounded(assets(model.seed),45000);
  server=createServer((request,response)=>{const work=(async()=>{
   assert(!closing&&Date.now()<deadline,'qa_deadline');assert(++totalHttp<=ownerNotificationsBrowserLimits.http,'qa_http_limit');assert(origin&&request.headers.host===new URL(origin).host,'qa_host');
   const url=new URL(request.url,origin);response.setHeader('Cache-Control','no-store');response.setHeader('X-Content-Type-Options','nosniff');
   response.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
   if(staticPaths.has(url.pathname)){assert.equal(request.method,'GET');assert(!url.search||url.pathname==='/'&&url.search==='?disabled=1','qa_static_query');if(url.pathname==='/favicon.ico')return response.writeHead(204).end();
    const html='<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="/favicon.ico"><link rel="stylesheet" href="/qa.css"><div id="qa-root"></div><script type="module" src="/qa.js"></script></html>';
    return response.writeHead(200,{'Content-Type':url.pathname==='/'?'text/html;charset=utf-8':url.pathname==='/qa.js'?'text/javascript;charset=utf-8':'text/css;charset=utf-8'}).end(url.pathname==='/'?html:url.pathname==='/qa.js'?files.js:files.css);}
   assert(model.seed.endpoints.includes(url.pathname),'qa_unknown_endpoint');assert(requests.length<ownerNotificationsBrowserLimits.api,'qa_api_limit');
   let bodyText='',bytes=0;for await(const chunk of request){bytes+=chunk.length;assert(bytes<=4096,'qa_body_limit');bodyText+=chunk.toString('utf8');}
   const chosen=request.method==='POST'&&dropPost?'malformed':fault;fault='none';
   const outcome=model.respond(url.href,request.method,request.headers['x-owner-notifications-qa-auth'],bodyText,chosen);if(request.method==='POST')dropPost=false;
   requests.push({path:url.pathname,method:request.method,query:outcome.query,command:outcome.command,fault:chosen});
   response.writeHead(200,{'Content-Type':'application/json;charset=utf-8'}).end(outcome.text);
  })();inflight.add(work);void work.catch(error=>{errors.push(String(error.message));if(!response.headersSent)response.writeHead(500,{'Content-Type':'application/json'});response.end('{"ok":false,"error":"attendance_unavailable"}');}).finally(()=>inflight.delete(work));});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const address=server.address();assert(address&&typeof address==='object'&&address.address==='127.0.0.1');origin=`http://127.0.0.1:${address.port}`;
  const {chromium}=await import('playwright');const launch=chromium.launch({headless:true});void launch.then(value=>{if(closing)return value.close();}).catch(()=>{});
  browser=await bounded(launch,15000);context=await browser.newContext({serviceWorkers:'block',acceptDownloads:false,viewport:{width:390,height:900}});
  await context.route('**/*',async route=>{const req=route.request(),url=new URL(req.url());if(url.origin!==origin||!['GET','POST'].includes(req.method())
    ||!(staticPaths.has(url.pathname)&&req.method()==='GET'&&(!url.search||url.pathname==='/'&&url.search==='?disabled=1')||model.seed.endpoints.includes(url.pathname))){errors.push('unexpected_external_or_write_request');await route.abort();return;}await route.continue();});
  page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  page.on('download',()=>errors.push('unexpected_download'));page.on('popup',()=>errors.push('unexpected_popup'));
  page.on('dialog',dialog=>dialog.accept());
  stage='inert.explicit_list_and_detail';await page.goto(origin);await page.getByRole('button',{name:'负责人考勤收件',exact:true}).waitFor();await settle();assert.equal(requests.length,0);await open(false);
  await detail();assert.equal(requests.length,2);assert.equal(model.snapshot().rows,0);assert.equal(await page.getByRole('button',{name:'明确标为已读',exact:true}).isEnabled(),false);
  stage='explicit_source_target';const beforeTarget=requests.length;await page.getByRole('button',{name:'打开原事项（重新核验）',exact:true}).click();
  await page.getByRole('button',{name:'读取消息原周期当前详情',exact:true}).waitFor();await settle();assert.equal(requests.length,beforeTarget);
  await clickRequest('读取消息原周期当前详情',model.seed.endpoints[1]);await page.locator('[data-period-closure-detail]').waitFor();
  assert.equal(requests.at(-1).query.periodId,model.periodItem.sourceId);assert.equal(requests.at(-1).query.mode,'detail');assert.equal(model.snapshot().rows,0);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'qa_source_mobile_overflow');
  const beforeBack=requests.length;await page.getByRole('button',{name:'返回合并核对',exact:true}).click();await page.getByRole('button',{name:'读取负责人收件',exact:true}).waitFor();await settle();assert.equal(requests.length,beforeBack);
  stage='single_mark_read_committed_bad_body';await detail();await page.getByRole('checkbox',{name:'仅确认已阅读此收件，不代替任何业务处理',exact:true}).check();
  await clickRequest('明确标为已读');await pending().waitFor();const original=await slot();assert(original,'qa_actual_client_marker');
  const command=JSON.parse(original).command;assert.equal(model.snapshot().rows,1);assert.equal(command.operationId,model.snapshot().entries[0].command.operationId);
  assert.equal(requests.filter(r=>r.method==='POST').length,1);assert.equal(command.action,'mark_read');assert.deepEqual(Object.keys(command).sort(),['action','notificationId','operationId']);
  assert.equal(await page.getByRole('button',{name:'读取负责人收件',exact:true}).isEnabled(),false);
  stage='null_and_corrupt_recovery';for(const value of ['null','malformed']){fault=value;await clickRequest('只读核对标读原号');assert.equal(await slot(),original);assert.equal(await pending().count(),1);}
  stage='flag_off_refresh_get_recovery';let before=requests.length;await page.goto(origin+'/?disabled=1');await settle();assert.equal(requests.length,before);await open(true);assert.equal(await slot(),original);
  await clickRequest('只读核对标读原号');assert.equal(await slot(),null);const minimum=page.getByRole('region',{name:'标读最小回执',exact:true});await minimum.waitFor();
  assert.match(await minimum.innerText(),new RegExp(command.operationId));assert.doesNotMatch(await minimum.innerText(),/employeeAuth|employeeId|sourceCategory|Synthetic/);
  stage='concurrent_local_replacement';await seed(original);await page.reload();await open(true);await delay();const replacement=model.replacement(original);await seed(replacement);await release();assert.equal(await slot(),replacement);assert.equal(await minimum.count(),0);
  stage='late_body_auth_switch';await seed(original);await page.reload();await open(true);await delay();await page.evaluate(()=>window.__ownerNotificationsHarness.configure(true));await release();
  assert.equal(await slot(),original);assert.equal(await pending().count(),0);assert.equal(await minimum.count(),0);assert.equal(await page.locator('dialog').count(),0);
  before=requests.length;await page.evaluate(()=>window.__ownerNotificationsHarness.configure(false));await settle();assert.equal(requests.length,before);await open(true);assert.equal(await slot(),original);
  stage='hidden_clear_and_mobile';await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});
  assert.equal(await pending().count(),0);assert.equal(await slot(),original);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'qa_mobile_overflow');
  assert.equal(requests.length,11);assert.equal(requests.filter(r=>r.method==='POST').length,1);assert.equal(requests.filter(r=>r.path===model.seed.endpoints[1]).length,1);
  assert(requests.filter(r=>r.method==='POST').every(r=>r.path===model.seed.endpoints[0]&&r.command.action==='mark_read'));assert.deepEqual(errors,[]);
  report={groups:8,actualChromium:true,actualLauncherAndPanel:true,actualPeriodV2Workspace:true,actualEnterpriseHost:false,actualAuth:false,actualSql:false,
   model:'strict synthetic API and Auth; one actual random browser mark intent saved in in-memory ledger',sourceTargetRequests:1,sourcePosts:0,automaticMarkRead:false,
   requests:requests.length,gets:requests.filter(r=>r.method==='GET').length,posts:1,totalHttp,syntheticCommittedRows:model.snapshot().rows,
   flagOffRecovery:true,nullAndMalformedRetained:true,concurrentReplacementPreserved:true,lateAuthBodyPreserved:true,hiddenPendingPreserved:true,
   laterPendingSetup:'same actual submitted marker reinstated locally; concurrent replacement is a separate synthetic local-only intent',
   lostReply:'complete HTTP 200 with malformed JSON after model commit, not TCP loss',mobileWidth:390,horizontalOverflow:false,externalRequests:0,consoleErrors:0,diskBundles:false};
 }catch(error){failure=Error(`owner_notifications_browser_failed:${stage}:${String(error?.message??error)}:diagnostics=${JSON.stringify({errors,requests:requests.slice(-5)})}`,{cause:error});throw failure;}
 finally{closing=true;clearTimeout(timer);await runAttendanceCleanupSteps([
  {name:'owner notifications held body',run:async()=>{if(page&&!page.isClosed())await page.evaluate(()=>window.__ownerNotificationsHarness?.release()).catch(()=>{});}},
  {name:'owner notifications context',run:()=>context?bounded(context.close(),6000):undefined},
  {name:'owner notifications browser',run:()=>browser?bounded(browser.close(),6000):undefined},
  {name:'owner notifications HTTP work',run:()=>bounded(Promise.allSettled([...inflight]),6000)},
  {name:'owner notifications listener',run:()=>{server?.closeAllConnections();return server?.listening?bounded(new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve())),6000):undefined;}},
  {name:'owner notifications esbuild',run:async()=>{(await import('esbuild')).stop();}},
 ]).catch(error=>{if(failure)throw new AggregateError([failure,error],'owner_notifications_browser_and_cleanup_failed');throw error;});}
 assert(!browser?.isConnected()&&!server?.listening,'qa_cleanup_incomplete');return{...report,browserClosed:true,listenerStopped:true};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv.length===3&&process.argv[2]==='--run-local')console.log(JSON.stringify(await verifyOwnerNotificationsBrowser()));
 else if(process.argv.length===2)console.log('Inert. Explicit local synthetic check: node --import tsx scripts/fixtures/attendance-owner-notifications-browser.mjs --run-local');
 else throw Error('explicit_run_local_only');
}
