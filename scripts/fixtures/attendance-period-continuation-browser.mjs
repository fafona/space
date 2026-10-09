// Inert on import. Root explicitly invokes this synthetic, GET-only UI check.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {runAttendanceCleanupSteps} from './attendance-cleanup.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url)),require=createRequire(import.meta.url);
export const continuationBrowserEndpoint='/api/merchant-enterprise/attendance/period-closures-v2';
export const continuationBrowserLimits=Object.freeze({ttlMs:300000,http:80,posts:0});
const staticPaths=new Set(['/','/qa.js','/qa.css','/favicon.ico']);
export function continuationBrowserAllowedRequest(raw,method,origin){
 try{const base=new URL(origin),url=new URL(raw);return base.protocol==='http:'&&base.hostname==='127.0.0.1'&&!!base.port&&base.origin===origin
  &&url.origin===origin&&!url.username&&!url.password&&!url.hash&&!/[\u0000-\u0020\u007f\\]/.test(raw)&&method==='GET'
  &&(staticPaths.has(url.pathname)?!url.search:url.pathname===continuationBrowserEndpoint);}catch{return false;}
}
export function createContinuationBrowserModel(){
 const m=require('./attendance-period-closure-ui-model.ts'),p=require('../../src/lib/merchantAttendancePeriodClosureV2.ts');
 const q0=m.periodClosureUiQuery('detail'),artifact=m.periodClosureUiArtifact(),head={...m.periodClosureUiSummary(),revision:101,currentVersion:21};
 const seed={siteId:q0.siteId,owner:m.periodClosureUiOwner,other:m.periodClosureUiId(991),workerId:q0.workerId,fromDate:'2026-09-01',throughDate:'2026-09-30'};
 const command=m.periodClosureUiCommand(),pending={format:1,actorId:seed.owner,employeeId:head.employeeId,employeeAuthUserId:head.employeeAuthUserId,query:q0,command};
 const pendingKey=`faolla:attendance:period-closures:v1:${seed.siteId}:owner:${seed.owner}`;
 const items=Array.from({length:26},(_,n)=>{const day=String(n+3).padStart(2,'0'),next=String(n+4).padStart(2,'0');
  return {...head,periodId:n===0?head.periodId:m.periodClosureUiId(800+n),...(n===0?{}:{fromDate:`2026-09-${day}`,throughDate:`2026-09-${day}`,startAt:`2026-09-${day}T00:00:00.000000Z`,endAt:`2026-09-${next}T00:00:00.000000Z`}),
   openedAt:`2026-10-07T00:00:${String(59-n).padStart(2,'0')}.000001Z`};});
 function respond(url,actor=seed.owner,enabled=true){
  const q=p.parsePeriodClosureV2HttpQuery(url);assert.equal(q.siteId,seed.siteId);assert.equal(q.workerId,seed.workerId);assert.equal(q.access,'owner');
  if(actor!==seed.owner)return {status:403,body:{ok:false,error:'attendance_access_denied'}};
  const common={protocol:'period-closure-v2',siteId:q.siteId,workerId:q.workerId,actorId:actor,access:q.access,readAt:'2026-10-08T00:00:00.000001Z'};
  const scope={siteId:q.siteId,access:q.access,workerId:q.workerId,fromDate:q.fromDate,throughDate:q.throughDate,periodId:q.periodId};let data;
  if(q.mode==='list'){
   assert.equal(q.fromDate,seed.fromDate);assert.equal(q.throughDate,seed.throughDate);
   const anchor=q.cursor?items.findIndex(x=>x.periodId===q.cursor.beforePeriodId):-1;if(q.cursor)assert(anchor>=0,'unknown_synthetic_cursor');const start=anchor+1;
   const rows=items.slice(start,start+25),last=rows.at(-1),nextCursor=start+rows.length<items.length?{...scope,kind:'list',atOpenedAt:items[0].openedAt,atPeriodId:items[0].periodId,beforeOpenedAt:last.openedAt,beforePeriodId:last.periodId}:null;
   data={...common,kind:'list',items:rows,nextCursor};
  }else{
   assert.equal(q.periodId,head.periodId);assert.equal(q.fromDate,head.fromDate);assert.equal(q.throughDate,head.throughDate);
   if(q.mode==='history'){
    const top=q.cursor?q.cursor.beforeRevision-1:101;
    const rows=Array.from({length:Math.min(50,top)},(_,i)=>{const revision=top-i;
     return m.periodClosureUiEntry({...command,operationId:m.periodClosureUiId(4000+revision),action:revision===1?'send':'respond',expectedRevision:revision-1,expectedVersion:revision===1?0:Math.min(21,revision-1),reason:`Synthetic history ${revision}`});});
    // Metadata is synthetic; every returned DTO still passes the actual strict parser.
    const nextCursor=top>50?{...scope,kind:'history',atRevision:q.cursor?.atRevision??101,beforeRevision:rows.at(-1).revision}:null;
    data={...common,kind:'history',period:head,items:rows,nextCursor};
   }else if(q.mode==='versions'){
    const top=q.cursor?q.cursor.beforeVersion-1:21,rows=Array.from({length:Math.min(20,top)},(_,i)=>({version:top-i,operationId:m.periodClosureUiId(5000+top-i),recordedAt:'2026-09-11T10:00:00.000001Z',artifactId:m.periodClosureUiId(900),sourceFingerprint:artifact.sourceFingerprint,artifactBytes:1024,artifactSha256:'b'.repeat(64)}));
    data={...common,kind:'versions',period:head,items:rows,nextCursor:top>20?{...scope,kind:'versions',atVersion:q.cursor?.atVersion??21,beforeVersion:rows.at(-1).version}:null};
   }else{
    assert(['detail','recover'].includes(q.mode),'continuation_qa_no_export_or_mutation');if(q.mode==='recover')assert.equal(q.operationId,command.operationId);
    data={...common,kind:'detail',period:head,artifact,artifactVersion:q.mode==='recover'?1:q.version??21,sourceChanged:q.mode==='recover'||q.version!==null?null:false,operation:q.mode==='recover'?m.periodClosureUiEntry(command):null,replayed:q.mode==='recover'};
   }
  }
  const body=p.parsePeriodClosureV2Response({ok:true,moduleEnabled:enabled,data},q,{ownerId:seed.owner});return {status:200,body};
 }
 return {seed,pendingKey,pendingRaw:JSON.stringify(pending,null,2),periodId:head.periodId,query:q0,respond};
}
async function bounded(promise,ms=12000){let timer;try{return await Promise.race([promise,new Promise((_,no)=>{timer=setTimeout(()=>no(Error('continuation_browser_deadline')),ms);})]);}finally{clearTimeout(timer);}}
async function assets(seed){
 const {build}=await import('esbuild'),{compile}=await import('@tailwindcss/node'),{default:ts}=await import('typescript');
 const bundle=await build({absWorkingDir:root,entryPoints:['scripts/fixtures/attendance-period-continuation-browser-entry.tsx'],bundle:true,write:false,metafile:true,platform:'browser',format:'esm',target:['es2020'],jsx:'automatic',tsconfig:path.join(root,'tsconfig.json'),outfile:'qa.js',logLevel:'warning',
  define:{'process.env':'{}','process.env.NODE_ENV':'"development"',__CONTINUATION_SEED__:JSON.stringify(seed)}});
 const candidates=new Set();for(const name of Object.keys(bundle.metafile.inputs)){assert(!/node:crypto|\.server\.ts$/.test(name),'continuation_server_import');
  if(!/\.tsx?$/.test(name)||name.includes('node_modules'))continue;const ast=ts.createSourceFile(name,await readFile(path.join(root,name),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const visit=node=>{if(ts.isStringLiteral(node)||ts.isNoSubstitutionTemplateLiteral(node)||ts.isTemplateHead(node)||ts.isTemplateMiddle(node)||ts.isTemplateTail(node))node.text.split(/\s+/).filter(Boolean).forEach(v=>candidates.add(v));ts.forEachChild(node,visit);};visit(ast);}
 const css=(await compile('@import "tailwindcss";',{base:root,onDependency:()=>{}})).build([...candidates])+'body{margin:0;background:#f8fafc;font-family:Arial,sans-serif}.qa-main{max-width:1000px;margin:auto;padding:8px;min-width:0}';
 return {js:bundle.outputFiles.find(f=>f.path.endsWith('.js')).contents,css};
}
export async function runPeriodContinuationBrowserAcceptance(){
 const model=createContinuationBrowserModel(),requests=[],errors=[],inflight=new Set();let server,browser,context,page,origin,files,closing=false,total=0,stage='setup',failure=null,accept=true,dialogs=0;
 const deadline=Date.now()+continuationBrowserLimits.ttlMs,timer=setTimeout(()=>{closing=true;void context?.close().catch(()=>{});server?.closeAllConnections();},continuationBrowserLimits.ttlMs);
 const region=()=>page.getByRole('region',{name:'周期核对与封存',exact:true});
 const settle=async()=>{await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await bounded(Promise.all([...inflight]));};
 const open=async()=>{await page.getByRole('button',{name:/^(周期核对、争议与封存|核对待确认周期原编号)$/}).click();await region().waitFor();await settle();};
 const click=async(locator,mode)=>{const [response]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname===continuationBrowserEndpoint&&new URL(r.url()).searchParams.get('mode')===mode),locator.click()]);await response.finished();assert.equal(response.status(),200,await response.text());await settle();return response.json();};
 const list=()=>click(region().getByRole('button',{name:'读取周期列表',exact:true}),'list');
 const fresh=()=>click(region().getByRole('button',{name:'重新核对当前版本',exact:true}),'detail');
 const configure=value=>page.evaluate(v=>window.__continuationHarness.configure(v),value);
 const legacy=async()=>{await page.evaluate(({key,raw})=>{sessionStorage.setItem(key,raw);sessionStorage.setItem('qa-disabled','1');},{key:model.pendingKey,raw:model.pendingRaw});await page.reload();await open();await region().locator('[data-period-closure-pending]').waitFor();};
 try{
  files=await bounded(assets(model.seed),60000);
  server=createServer((request,response)=>{if(closing||!origin||request.headers.host!==new URL(origin).host||request.method!=='GET')return response.writeHead(403).end();const url=new URL(request.url,origin);
   response.setHeader('Cache-Control','no-store');response.setHeader('X-Content-Type-Options','nosniff');response.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
   if(!staticPaths.has(url.pathname)||url.search)return response.writeHead(403).end();if(url.pathname==='/favicon.ico')return response.writeHead(204).end();
   const html='<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/qa.css"><div id="qa-root"></div><script type="module" src="/qa.js"></script></html>';
   response.writeHead(200,{'Content-Type':url.pathname==='/'?'text/html;charset=utf-8':url.pathname==='/qa.js'?'text/javascript;charset=utf-8':'text/css;charset=utf-8'}).end(url.pathname==='/'?html:url.pathname==='/qa.js'?files.js:files.css);});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const address=server.address();assert(address&&typeof address==='object'&&address.address==='127.0.0.1');origin=`http://127.0.0.1:${address.port}`;
  const {chromium}=await import('playwright');browser=await chromium.launch({headless:true});context=await browser.newContext({serviceWorkers:'block',acceptDownloads:false,viewport:{width:390,height:900}});
  await context.route('**/*',route=>{const work=(async()=>{const request=route.request(),url=new URL(request.url());assert(Date.now()<deadline&&++total<=80,'continuation_http_budget');assert(continuationBrowserAllowedRequest(request.url(),request.method(),origin),'continuation_external_or_write_request');
   if(staticPaths.has(url.pathname))return route.continue();const actor=request.headers()['x-continuation-qa-actor'],enabled=request.headers()['x-continuation-qa-enabled'];assert(['0','1'].includes(enabled));
   const outcome=model.respond(url.href,actor,enabled==='1');requests.push({method:request.method(),mode:url.searchParams.get('mode'),version:url.searchParams.get('version'),actor,status:outcome.status});
   await route.fulfill({status:outcome.status,headers:{'Content-Type':'application/json;charset=utf-8','Cache-Control':'private, no-store'},body:JSON.stringify(outcome.body)});
  })();inflight.add(work);void work.finally(()=>inflight.delete(work)).catch(()=>{});return work.catch(async error=>{if(!closing)errors.push(error.message);await route.abort().catch(()=>{});});});
  page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',error=>errors.push(error.message));page.on('download',()=>errors.push('unexpected_download'));page.on('popup',()=>errors.push('unexpected_popup'));
  page.on('dialog',dialog=>{dialogs++;void(accept?dialog.accept():dialog.dismiss()).catch(error=>{if(!closing)errors.push(error.message);});});
  stage='initial.zero_http';await page.goto(origin);await open();assert.equal(requests.length,0);assert.equal(await page.evaluate(()=>window.__continuationHarness.snapshot().calls),0);
  stage='list.pages';await list();const listing=()=>region().getByRole('region',{name:'保存周期列表',exact:true});await page.waitForFunction(()=>document.querySelectorAll('[aria-label="保存周期列表"] li').length===25);assert.equal(await listing().getByRole('listitem').count(),25);
  await click(listing().getByRole('button',{name:'读取下一页周期',exact:true}),'list');assert.equal(await listing().getByRole('listitem').count(),1);assert.equal(await listing().getByRole('button',{name:'读取下一页周期',exact:true}).isDisabled(),true);
  await click(listing().getByRole('button',{name:'刷新列表第一页',exact:true}),'list');await click(listing().getByRole('listitem').filter({hasText:model.periodId}).getByRole('button',{name:'读取保存版本',exact:true}),'detail');
  stage='history.pages';await click(region().getByRole('button',{name:'读取操作历史第一页',exact:true}),'history');const history=()=>region().getByRole('region',{name:'周期操作历史',exact:true});assert.equal(await history().getByRole('listitem').count(),50);
  await click(history().getByRole('button',{name:'读取下一页操作历史',exact:true}),'history');assert.equal(await history().getByRole('listitem').count(),50);assert(!await history().innerText().then(t=>t.includes('Synthetic history 101')));
  await click(history().getByRole('button',{name:'读取下一页操作历史',exact:true}),'history');assert.equal(await history().getByRole('listitem').count(),1);assert.equal(await history().getByRole('button',{name:'读取下一页操作历史',exact:true}).isDisabled(),true);
  await fresh();stage='versions.pages';await click(region().getByRole('button',{name:'读取保存版本第一页',exact:true}),'versions');const versions=()=>region().getByRole('region',{name:'保存版本列表',exact:true});assert.equal(await versions().getByRole('listitem').count(),20);
  await click(versions().getByRole('button',{name:'读取下一页保存版本',exact:true}),'versions');assert.equal(await versions().getByRole('listitem').count(),1);assert.equal((await click(versions().getByRole('button',{name:'查看保存版本 1',exact:true}),'detail')).data.artifactVersion,1);assert.equal(requests.at(-1).version,'1');
  assert.equal(await region().getByLabel('周期操作理由',{exact:true}).isDisabled(),true);for(const label of ['回复周期争议','封存本人已确认版本','说明理由并重开'])assert.equal(await region().getByRole('button',{name:label,exact:true}).isDisabled(),true);
  stage='dirty.guard';await fresh();await region().getByLabel('周期操作理由',{exact:true}).fill('Synthetic unsaved reason');accept=false;const beforeGuard=requests.length,beforeDialogs=dialogs;
  await region().getByRole('button',{name:'返回合并核对',exact:true}).click();assert.equal(await region().getByLabel('周期操作理由',{exact:true}).inputValue(),'Synthetic unsaved reason');
  await page.getByRole('button',{name:'离开合成宿主',exact:true}).click();await region().waitFor();assert.equal(requests.length,beforeGuard);assert.equal(dialogs,beforeDialogs+2);accept=true;
  stage='hidden.mobile';await fresh();assert.equal(await page.locator('[data-period-closure-artifact]').count(),1);const beforeHide=requests.length;await page.evaluate(()=>window.__continuationHarness.visibility(true));assert.equal(await page.locator('[data-period-closure-artifact]').count(),0);
  await page.evaluate(()=>window.__continuationHarness.visibility(false));await settle();assert.equal(requests.length,beforeHide);await list();await click(listing().getByRole('listitem').filter({hasText:model.periodId}).getByRole('button',{name:'读取保存版本',exact:true}),'detail');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false,'continuation_390px_overflow');
  stage='legacy.paused_recovery';const beforeLegacy=requests.length;await legacy();assert.equal(requests.length,beforeLegacy);assert(await region().innerText().then(t=>t.includes('新操作入口关闭')));accept=false;const beforePendingDialog=dialogs;await region().getByRole('button',{name:'返回合并核对',exact:true}).click();await region().waitFor();assert.equal(dialogs,beforePendingDialog+1);assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),model.pendingKey),model.pendingRaw);accept=true;
  await click(region().getByRole('button',{name:'核对原周期编号',exact:true}),'recover');assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),model.pendingKey),null);assert.equal(await region().getByLabel('周期操作理由',{exact:true}).isDisabled(),true);
  stage='identity.delayed_receipt';await legacy();await page.evaluate(()=>window.__continuationHarness.holdNext());await region().getByRole('button',{name:'核对原周期编号',exact:true}).click();await page.waitForFunction(()=>window.__continuationHarness.snapshot().held);
  await configure({other:true});await page.evaluate(()=>window.__continuationHarness.release());await page.waitForFunction(()=>!window.__continuationHarness.snapshot().held);await settle();assert.equal(await page.locator('[data-period-closure-artifact]').count(),0);
  assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),model.pendingKey),model.pendingRaw);assert(requests.every(r=>r.method==='GET'));assert.deepEqual(errors,[]);
  return {groups:8,mockedData:true,actualSql:false,actualAuth:false,actualReactLauncher:true,actualChromium:true,requests:requests.length,totalHttp:total,posts:0,listPageSize:25,historyPageSize:50,versionPageSize:20,mobileWidth:390,externalRequests:0,diskBundles:false,downloads:0};
 }catch(error){failure=Error(`continuation_browser_failed:${stage}:${String(error?.message??error)}`,{cause:error});throw failure;}
 finally{closing=true;clearTimeout(timer);await runAttendanceCleanupSteps([
  {name:'continuation gated response',run:async()=>{if(page&&!page.isClosed())await page.evaluate(()=>window.__continuationHarness?.release()).catch(()=>{});}},
  {name:'continuation owned context',run:()=>context?bounded(context.close(),6000):undefined},
  {name:'continuation owned browser',run:()=>browser?bounded(browser.close(),6000):undefined},
  {name:'continuation inflight routes',run:()=>bounded(Promise.allSettled([...inflight]),6000)},
  {name:'continuation loopback listener',run:()=>{server?.closeAllConnections();return server?.listening?bounded(new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve())),6000):undefined;}},
  {name:'continuation esbuild',run:async()=>{(await import('esbuild')).stop();}},
 ]).catch(error=>{if(failure)throw new AggregateError([failure,error],'continuation_browser_and_cleanup_failed');throw error;});}
}
