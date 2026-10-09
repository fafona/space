//237 INERT: actual component/browser, strict synthetic API/Auth, no SQL or POST.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {runAttendanceCleanupSteps} from './attendance-cleanup.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url)),require=createRequire(import.meta.url);
const staticPaths=new Set(['/','/qa.js','/qa.css','/favicon.ico']);
export const retentionPeriodsBrowserLimits=Object.freeze({ttlMs:180000,http:100,api:40});
export function createRetentionPeriodsBrowserModel(){
 const p=require('../../src/lib/merchantAttendancePeriodClosureV2.ts'),r=require('../../src/lib/merchantAttendanceRetention.ts');
 const rc=require('../../src/lib/merchantAttendanceRetentionClient.ts'),admin=require('../../src/lib/merchantAttendanceAdmin.ts');
 const f=require('./attendance-period-closure-ui-model.ts'),id=f.periodClosureUiId,base=f.periodClosureUiSummary(),actorId=f.periodClosureUiOwner;
 const siteId=f.periodClosureUiQuery().siteId,workerId=base.workerId,fromDate='2026-09-02',throughDate='2026-09-28';
 const openedAt='2026-10-01T10:00:00.000001Z',readAt='2026-10-08T10:00:00.000001Z',artifactId=id(237100),sourceFingerprint='a'.repeat(64),artifactSha256='b'.repeat(64);
 const endpoints=['/api/merchant-enterprise/attendance/admin','/api/merchant-enterprise/attendance/period-closures-v2',r.RETENTION_API];
 const periods=Array.from({length:26},(_,index)=>{const day=index===0?1:index+3,end=index===0?3:day,date=n=>'2026-09-'+String(n).padStart(2,'0');
  return {...base,periodId:id(237026-index),fromDate:date(day),throughDate:date(end),startAt:date(day)+'T00:00:00.000000Z',endAt:date(end+1)+'T00:00:00.000000Z',
   revision:101,currentVersion:21,openedAt};});
 const target=periods[0],summary=({openedAt:unused,...value})=>{void unused;return value;};
 const versions=Array.from({length:21},(_,index)=>({version:21-index,operationId:id(237200+21-index),recordedAt:openedAt,artifactId,sourceFingerprint,artifactBytes:9000,artifactSha256}));
 const scope=q=>({kind:q.mode,siteId:q.siteId,access:q.access,workerId:q.workerId,fromDate:q.fromDate,throughDate:q.throughDate,periodId:q.periodId});
 const policy=category=>({category,revision:0,retentionDays:null,operationId:null,recordedAt:null});
 const artifactSource={kind:'period_artifact',artifactId,periodId:target.periodId,workerId,employeeId:target.employeeId,fromDate:target.fromDate,throughDate:target.throughDate,
  timeZone:target.timeZone,startAt:target.startAt,endAt:target.endAt,recordedAt:openedAt,artifactSha256,artifactBytes:9000,sourceFingerprint};
 const record={category:'period_artifact',recordId:artifactId,source:artifactSource,sourceFingerprint:'c'.repeat(64),policy:policy('period_artifact'),anchorAt:openedAt,asOf:readAt,dueAt:null,
  ageState:'unconfigured',preservation:{revision:0,held:false,operationId:null,actorId:null,reason:null,recordedAt:null}};
 const common=q=>({protocol:'period-closure-v2',siteId,workerId,actorId,access:'owner',readAt,kind:q.mode});
 function respond(url,method,actor,bodyText=''){
  assert.equal(method,'GET','qa_zero_post');assert.equal(bodyText,'','qa_no_body');assert.equal(actor,actorId,'qa_original_synthetic_actor');
  const pathname=new URL(url).pathname;let q,body;
  if(pathname===endpoints[0]){
   q=admin.parseAttendanceAdminQuery(url);assert.deepEqual(q,{siteId,view:'workers',search:'',cursor:null,operationId:null});
   body={ok:true,siteId,version:1,settings:{timeZone:'UTC',enabled:true,webClockEnabled:true,webBreakPaid:false},view:'workers',
    items:[{id:workerId,employeeId:base.employeeId,workerNo:base.workerNo,displayName:'Synthetic237 saved worker',locationId:id(237900),active:true,startsOn:'2020-01-01'}],nextCursor:null,receipt:null,moduleEnabled:true};
   admin.parseAttendanceAdminResult(body,q);
  }else if(pathname===endpoints[1]){
   q=p.parsePeriodClosureV2HttpQuery(url);assert.equal(q.siteId,siteId);assert.equal(q.access,'owner');assert.equal(q.workerId,workerId);assert.equal(q.operationId,null);assert.equal(q.version,null);
   let data;
   if(q.mode==='list'){
    assert.equal(q.fromDate,fromDate);assert.equal(q.throughDate,throughDate);assert.equal(q.periodId,null);
    if(q.cursor)assert.deepEqual(q.cursor,{...scope(q),atOpenedAt:openedAt,atPeriodId:target.periodId,beforeOpenedAt:openedAt,beforePeriodId:periods[24].periodId});
    const items=q.cursor?periods.slice(25):periods.slice(0,25),last=items.at(-1);
    data={...common(q),items,nextCursor:q.cursor?null:{...scope(q),atOpenedAt:openedAt,atPeriodId:target.periodId,beforeOpenedAt:last.openedAt,beforePeriodId:last.periodId}};
   }else{
    assert.equal(q.mode,'versions','qa_only_metadata');assert.equal(q.periodId,target.periodId);assert.equal(q.fromDate,target.fromDate);assert.equal(q.throughDate,target.throughDate);
    if(q.cursor)assert.deepEqual(q.cursor,{...scope(q),atVersion:21,beforeVersion:2});
    data={...common(q),period:summary(target),items:q.cursor?versions.slice(20):versions.slice(0,20),nextCursor:q.cursor?null:{...scope(q),atVersion:21,beforeVersion:2}};
   }
   body={ok:true,moduleEnabled:true,data};p.parsePeriodClosureV2Response(body,q,{ownerId:actorId});
  }else{
   assert.equal(pathname,endpoints[2],'qa_known_endpoint');q=r.parseRetentionHttpQuery(url);assert.equal(q.siteId,siteId);
   assert(['record','policies'].includes(q.mode),'qa_no_preview_or_write');
   if(q.mode==='record')assert.deepEqual(q,{siteId,mode:'record',category:'period_artifact',recordId:artifactId});
   body={ok:true,canWrite:true,data:{protocol:'attendance-retention-v1',siteId,actorId,readAt,canWrite:true,
    data:q.mode==='record'?{kind:'record',item:record}:{kind:'policies',items:r.RETENTION_CATEGORIES.map(policy)},receipt:null,disposition:'preview_only'}};
   r.parseRetentionResponse(body,q,actorId);
  }
  return{query:q,body,text:JSON.stringify(body)};
 }
 const command=r.parseRetentionCommand({siteId,action:'hold',category:'period_artifact',recordId:artifactId,operationId:id(237999),expectedRevision:0,expectedSourceFingerprint:record.sourceFingerprint,reason:'Synthetic local pending only, never POSTed'});
 return{seed:{siteId,actorId,workerId,otherActorId:id(237998),fromDate,throughDate,endpoints},target,periods,versions,record,respond,
  pendingKey:rc.retentionClientPendingKey(siteId,actorId),pendingRaw:JSON.stringify({version:1,actorId,query:r.retentionWriteQuery(command),command})};
}
async function bounded(promise,ms=12000){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('retention_periods_browser_deadline')),ms);})]);}finally{clearTimeout(timer);}}
async function assets(seed){
 const {build}=await import('esbuild'),{compile}=await import('@tailwindcss/node'),{default:ts}=await import('typescript');
 const bundle=await build({absWorkingDir:root,entryPoints:['scripts/fixtures/attendance-retention-periods-v2-browser-entry.tsx'],bundle:true,write:false,metafile:true,platform:'browser',format:'esm',target:['es2020'],jsx:'automatic',tsconfig:path.join(root,'tsconfig.json'),outfile:'qa.js',logLevel:'warning',
  define:{'process.env':'{}','process.env.NODE_ENV':'"development"',__RETENTION_PERIODS_SEED__:JSON.stringify(seed)}});
 const candidates=new Set();for(const name of Object.keys(bundle.metafile.inputs)){assert(!/node:crypto|\.server\.ts$/.test(name),'qa_server_import');if(!/\.tsx?$/.test(name)||name.includes('node_modules'))continue;
  const ast=ts.createSourceFile(name,await readFile(path.join(root,name),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const visit=node=>{if(ts.isStringLiteral(node)||ts.isNoSubstitutionTemplateLiteral(node)||ts.isTemplateHead(node)||ts.isTemplateMiddle(node)||ts.isTemplateTail(node))node.text.split(/\s+/).filter(Boolean).forEach(v=>candidates.add(v));ts.forEachChild(node,visit);};visit(ast);}
 const css=(await compile('@import "tailwindcss";',{base:root,onDependency:()=>{}})).build([...candidates])+'body{margin:0;background:#f8fafc;font-family:Arial,sans-serif}.qa-main{max-width:1000px;margin:auto;padding:8px;min-width:0}';
 return{js:bundle.outputFiles.find(f=>f.path.endsWith('.js')).contents,css};
}
export async function verifyRetentionPeriodsV2Browser(){
 const model=createRetentionPeriodsBrowserModel(),requests=[],errors=[],inflight=new Set(),startedAt=Date.now(),deadline=startedAt+retentionPeriodsBrowserLimits.ttlMs;
 let server,browser,context,page,origin,files,totalHttp=0,closing=false,failure=null,stage='setup',report;
 const timer=setTimeout(()=>{closing=true;void context?.close().catch(()=>{});server?.closeAllConnections();},retentionPeriodsBrowserLimits.ttlMs);
 const settle=async()=>{await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await bounded(Promise.allSettled([...inflight]));};
 const button=name=>page.getByRole('button',{name,exact:true});
 const clickGet=async(name,endpoint,index=null)=>{const target=index===null?button(name):button(name).nth(index);
  const [response]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname===endpoint),target.click()]);await response.finished();assert.equal(response.status(),200,await response.text());await settle();};
 // A wrapping label's text includes its select option text. Match the unique
 // field-name prefix instead of assuming the accessible name stops there.
 const prepare=async()=>{await page.getByRole('combobox',{name:/^资料类别/}).selectOption('period_artifact');await clickGet('读取人员',model.seed.endpoints[0]);
  await page.getByRole('combobox',{name:/^选择人员/}).selectOption(model.seed.workerId);await page.getByLabel('UTC起日',{exact:true}).fill(model.seed.fromDate);await page.getByLabel('UTC结束日',{exact:true}).fill(model.seed.throughDate);};
 const open=async()=>{const before=requests.length;await button('按长期周期／版本查找归档').click();await button('读取长期周期').waitFor();await settle();assert.equal(requests.length,before,'qa_open_zero_get');};
 const list=()=>clickGet('读取长期周期',model.seed.endpoints[1]);
 const versions=async()=>{await page.locator(`[data-period-id="${model.target.periodId}"]`).getByRole('button',{name:'读取此周期版本',exact:true}).click();await page.locator('[data-version="21"]').waitFor();await settle();};
 const delay=async()=>{await page.evaluate(()=>window.__retentionPeriodsHarness.holdNext());await button('读取长期周期').click();await page.waitForFunction(()=>window.__retentionPeriodsHarness.snapshot().held);};
 const release=async()=>{await page.evaluate(()=>window.__retentionPeriodsHarness.release());await page.waitForFunction(()=>!window.__retentionPeriodsHarness.snapshot().held);await settle();};
 const noSelection=async()=>{assert.equal(await page.locator('[data-period-id]').count(),0);assert.equal(await page.locator('[data-version]').count(),0);};
 try{
  files=await bounded(assets(model.seed),45000);
  server=createServer((request,response)=>{const work=(async()=>{
   assert(!closing&&Date.now()<deadline,'qa_deadline');assert(++totalHttp<=retentionPeriodsBrowserLimits.http,'qa_http_limit');assert(origin&&request.headers.host===new URL(origin).host,'qa_host');
   assert.equal(request.method,'GET','qa_zero_posts');const url=new URL(request.url,origin);response.setHeader('Cache-Control','no-store');response.setHeader('X-Content-Type-Options','nosniff');
   response.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
   if(staticPaths.has(url.pathname)){assert(!url.search,'qa_static_query');if(url.pathname==='/favicon.ico')return response.writeHead(204).end();
    const html='<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="/favicon.ico"><link rel="stylesheet" href="/qa.css"><div id="qa-root"></div><script type="module" src="/qa.js"></script></html>';
    return response.writeHead(200,{'Content-Type':url.pathname==='/'?'text/html;charset=utf-8':url.pathname==='/qa.js'?'text/javascript;charset=utf-8':'text/css;charset=utf-8'}).end(url.pathname==='/'?html:url.pathname==='/qa.js'?files.js:files.css);}
   assert(model.seed.endpoints.includes(url.pathname),'qa_unknown_endpoint');assert(requests.length<retentionPeriodsBrowserLimits.api,'qa_api_limit');
   let bytes=0;for await(const chunk of request){bytes+=chunk.length;assert.equal(bytes,0,'qa_get_no_body');}
   const outcome=model.respond(url.href,request.method,request.headers['x-retention-periods-qa-auth']);requests.push({path:url.pathname,method:request.method,query:outcome.query});
   response.writeHead(200,{'Content-Type':'application/json;charset=utf-8'}).end(outcome.text);
  })();inflight.add(work);void work.catch(error=>{errors.push(String(error.message));if(!response.headersSent)response.writeHead(500,{'Content-Type':'application/json'});response.end('{"ok":false,"error":"attendance_unavailable"}');}).finally(()=>inflight.delete(work));});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const address=server.address();assert(address&&typeof address==='object'&&address.address==='127.0.0.1');origin=`http://127.0.0.1:${address.port}`;
  const {chromium}=await import('playwright');const launch=chromium.launch({headless:true});void launch.then(value=>{if(closing)return value.close();}).catch(()=>{});
  browser=await bounded(launch,15000);context=await browser.newContext({serviceWorkers:'block',acceptDownloads:false,viewport:{width:390,height:900}});
  await context.route('**/*',async route=>{const req=route.request(),url=new URL(req.url());if(url.origin!==origin||req.method()!=='GET'||!(staticPaths.has(url.pathname)&&!url.search||model.seed.endpoints.includes(url.pathname))){errors.push('unexpected_external_or_write_request');await route.abort();return;}await route.continue();});
  page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});page.on('download',()=>errors.push('unexpected_download'));page.on('popup',()=>errors.push('unexpected_popup'));page.on('dialog',dialog=>dialog.type()==='beforeunload'?dialog.accept():dialog.dismiss());
  stage='inert_parent';await page.goto(origin);await page.getByRole('region',{name:'考勤资料保留工作区',exact:true}).waitFor();await settle();assert.equal(requests.length,0);
  await prepare();await open();
  stage='periods25plus1';await list();assert.equal(await page.locator('[data-period-id]').count(),25);const firstIds=await page.locator('[data-period-id]').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('data-period-id')));
  await clickGet('下一页周期',model.seed.endpoints[1]);assert.equal(await page.locator('[data-period-id]').count(),1);assert.equal(await button('下一页周期').isEnabled(),false);
  const secondIds=await page.locator('[data-period-id]').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('data-period-id')));assert.equal(new Set([...firstIds,...secondIds]).size,26);
  stage='high_head_saved_range_versions';await list();await versions();assert.equal(requests.at(-1).query.fromDate,model.target.fromDate);assert.equal(requests.at(-1).query.throughDate,model.target.throughDate);
  assert.notEqual(requests.at(-1).query.fromDate,model.seed.fromDate);assert.equal(await page.locator('[data-version]').count(),20);assert.equal(new Set(await page.locator('[data-artifact-id]').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('data-artifact-id')))).size,1);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'qa_versions_mobile_overflow');
  await clickGet('下一页版本',model.seed.endpoints[1]);assert.equal(await page.locator('[data-version]').count(),1);assert.equal(await button('下一页版本').isEnabled(),false);
  stage='select_actual_retention_record';await clickGet('核对本条归档',model.seed.endpoints[2]);await page.getByRole('heading',{name:'固定周期归档 · 当前保存事实',exact:true}).waitFor();
  assert.deepEqual(requests.at(-1).query,{siteId:model.seed.siteId,mode:'record',category:'period_artifact',recordId:model.record.recordId});assert.equal(await button('读取长期周期').count(),0);
  stage='repeated_artifact_explicit_handoff';await open();await list();await versions();await clickGet('核对本条归档',model.seed.endpoints[2],0);
  assert.equal(requests.filter(x=>x.path===model.seed.endpoints[2]&&x.query.mode==='record').length,2);assert.equal(requests.at(-1).query.recordId,model.record.recordId);
  stage='dirty_blocks_picker';await page.getByLabel('保全理由',{exact:true}).fill('Synthetic unsaved reason');let before=requests.length;
  if(await button('按长期周期／版本查找归档').isEnabled())await button('按长期周期／版本查找归档').click();await settle();assert.equal(requests.length,before);assert.equal(await button('读取长期周期').count(),0);assert.equal(await page.getByLabel('保全理由',{exact:true}).inputValue(),'Synthetic unsaved reason');
  stage='pending_blocks_picker';await page.evaluate(({key,raw})=>sessionStorage.setItem(key,raw),{key:model.pendingKey,raw:model.pendingRaw});await page.reload();await button('读取原编号回执').waitFor();await settle();assert.equal(requests.length,before);
  assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),model.pendingKey),model.pendingRaw);assert.equal(await button('读取长期周期').count(),0);
  if(await button('按长期周期／版本查找归档').count())assert.equal(await button('按长期周期／版本查找归档').isEnabled(),false);
  await page.evaluate(key=>sessionStorage.removeItem(key),model.pendingKey);await page.reload();await prepare();await open();
  stage='hidden_late_body';await delay();await page.evaluate(()=>window.__retentionPeriodsHarness.visibility(false));await release();await noSelection();before=requests.length;
  await page.evaluate(()=>window.__retentionPeriodsHarness.visibility(true));await settle();assert.equal(requests.length,before);await noSelection();
  await prepare();await open();stage='api_instance_late_body';await delay();await page.evaluate(()=>window.__retentionPeriodsHarness.configure({apiEpoch:1}));await release();await noSelection();
  await prepare();await open();stage='auth_late_body';await delay();await page.evaluate(()=>window.__retentionPeriodsHarness.configure({other:true}));await release();await noSelection();before=requests.length;
  await page.evaluate(()=>window.__retentionPeriodsHarness.configure({other:false,enabled:false}));await settle();assert.equal(requests.length,before);assert.equal(await button('按长期周期／版本查找归档').count(),0);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'qa_final_mobile_overflow');assert.deepEqual(errors,[]);
  assert(requests.every(x=>x.method==='GET'));assert(!requests.some(x=>x.query.mode==='preview'||x.query.mode==='detail'||x.query.mode==='history'||x.query.mode==='export'));
  report={groups:10,actualChromium:true,actualRetentionPanel:true,actualPicker:true,actualRetentionRecordClient:true,actualEnterpriseHost:false,actualAuth:false,actualSql:false,
   requests:requests.length,gets:requests.length,posts:0,totalHttp,periodPageSizes:[25,1],versionPageSizes:[20,1],revision:101,currentVersion:21,
   repeatedArtifact:true,intersectionUsesSavedDates:true,dirtyPreserved:true,pendingPreserved:true,pendingSetup:'explicit synthetic local-only marker; no POST or claim of a committed result',
   hiddenLateBodyDiscarded:true,apiInstanceLateBodyDiscarded:true,authLateBodyDiscarded:true,flagOffNoEntry:true,mobileWidth:390,horizontalOverflow:false,externalRequests:0,consoleErrors:0,diskBundles:false};
 }catch(error){const dom=page&&!page.isClosed()?await page.locator('body').innerText({timeout:1000}).catch(()=>null):null;
  failure=Error(`retention_periods_browser_failed:${stage}:${String(error?.message??error)}:diagnostics=${JSON.stringify({errors,requests:requests.slice(-5),dom:dom?.slice(0,6000)})}`,{cause:error});throw failure;}
 finally{closing=true;clearTimeout(timer);await runAttendanceCleanupSteps([
  {name:'retention periods held body',run:async()=>{if(page&&!page.isClosed())await page.evaluate(()=>window.__retentionPeriodsHarness?.release()).catch(()=>{});}},
  {name:'retention periods context',run:()=>context?bounded(context.close(),6000):undefined},
  {name:'retention periods browser',run:()=>browser?bounded(browser.close(),6000):undefined},
  {name:'retention periods HTTP work',run:()=>bounded(Promise.allSettled([...inflight]),6000)},
  {name:'retention periods listener',run:()=>{server?.closeAllConnections();return server?.listening?bounded(new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve())),6000):undefined;}},
  {name:'retention periods esbuild',run:async()=>{(await import('esbuild')).stop();}},
 ]).catch(error=>{if(failure)throw new AggregateError([failure,error],'retention_periods_browser_and_cleanup_failed');throw error;});
  assert(!browser?.isConnected()&&!server?.listening,'qa_cleanup_incomplete');
  if(failure)failure.message+=`:cleanup=${JSON.stringify({browserClosed:true,listenerStopped:true,origin,processId:process.pid})}`;
 }
 return{...report,browserClosed:true,listenerStopped:true,origin,processId:process.pid,elapsedMs:Date.now()-startedAt};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv.length===3&&process.argv[2]==='--run-local')console.log(JSON.stringify(await verifyRetentionPeriodsV2Browser()));
 else if(process.argv.length===2)console.log('Inert. Explicit local synthetic check: node --import tsx scripts/fixtures/attendance-retention-periods-v2-browser.mjs --run-local');
 else throw Error('explicit_run_local_only');
}
