// Inert unless explicitly invoked. All HTTP is one owned loopback origin;
// protocol fixtures are synthetic, not logged-in users or SQL execution.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {runAttendanceCleanupSteps} from './attendance-cleanup.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url)),require=createRequire(import.meta.url);
const endpoint='/api/merchant-enterprise/attendance/period-delegated-closure',staticPaths=new Set(['/','/qa.js','/qa.css','/favicon.ico']);
const foundationEndpoint='/api/merchant-enterprise/attendance/period-delegation';
export const delegatedPeriodBrowserLimits=Object.freeze({ttlMs:180000,http:80,api:20});
const sha=text=>createHash('sha256').update(text,'utf8').digest('hex');
function model(){
 const m=require('./attendance-period-closure-ui-model.ts'),p=require('../../src/lib/merchantAttendancePeriodDelegatedClosure.ts'),g=require('../../src/lib/merchantAttendancePeriodDelegation.ts'),json=require('../../src/lib/merchantAttendanceRuleCapturesBrowser.ts');
 const artifact=m.periodClosureUiArtifact(),q0=m.periodClosureUiQuery('detail'),id=m.periodClosureUiId;
 const seed={siteId:q0.siteId,workerId:q0.workerId,actorEmployeeId:id(71001),expectedAuthUserId:id(71002),grantId:id(71003),
  targetEmployeeId:artifact.worker.employeeId,targetAuthUserId:artifact.worker.employeeAuthUserId,authorizedFromDate:'2026-09-01',authorizedThroughDate:'2026-09-30',
  fromDate:'2026-09-02',throughDate:'2026-09-02',otherEmployeeId:id(71004),otherAuthUserId:id(71005)};
 let revision=1;const receipts=new Map(),writes=[];
 function respond(url,method,text,auth,employee,enabled){
  if(new URL(url).pathname===foundationEndpoint){
   assert.equal(method,'GET');assert.equal(text,'');assert(enabled,'qa_disabled_foundation_request');
   assert.equal(auth,seed.expectedAuthUserId);assert.equal(employee,seed.actorEmployeeId);
   const q=g.parsePeriodDelegationHttpQuery(url);assert.equal(q.siteId,seed.siteId);assert.equal(q.access,'delegate');assert(['list','detail'].includes(q.mode));
   assert.equal(q.grantId,q.mode==='detail'?seed.grantId:null);assert.equal(q.catalog,null);assert.equal(q.afterId,null);assert.equal(q.operationId,null);
   const grant={grantId:seed.grantId,revision:1,status:'granted',delegate:{employeeId:employee,authUserId:auth,name:'Synthetic supervisor'},
    worker:{workerId:seed.workerId,employeeId:seed.targetEmployeeId,authUserId:seed.targetAuthUserId,name:artifact.worker.workerName,workerNo:artifact.worker.workerNo},
    fromDate:seed.authorizedFromDate,throughDate:seed.authorizedThroughDate,actions:['view','send','respond','seal','reopen'],includeExisting:true,
    validFrom:'2026-10-01T00:00:00.000000Z',validUntil:'2026-11-01T00:00:00.000000Z',grantedBy:id(71006),grantedAt:'2026-10-01T00:00:00.000000Z',
    reason:'Synthetic browser grant',usableActions:['view','send','respond','seal','reopen'],revocation:null};
   const body=g.parsePeriodDelegationResponse({ok:true,protocol:'period-delegation-v1',siteId:q.siteId,access:'delegate',actorId:auth,employeeId:employee,mode:q.mode,
    canWrite:false,grants:q.mode==='list'?[grant]:[],catalogItems:[],nextAfterId:null,detail:q.mode==='detail'?grant:null,receipt:null,readAt:'2026-10-08T12:00:00.000001Z'},q,{authUserId:auth});
   return{body:{ok:true,...body},q,c:null,truncate:false};
  }
  const body=method==='POST'?p.parsePeriodDelegatedClosureBody(json.parseCaptureBrowserJson(text)):null,q=body?.query??p.parsePeriodDelegatedClosureHttpQuery(url),c=body?.command??null;
  assert.equal(q.siteId,seed.siteId);assert.equal(q.workerId,seed.workerId);assert.equal(q.grantId,seed.grantId);
  assert.equal(auth,seed.expectedAuthUserId,'unexpected_qa_auth');assert.equal(employee,seed.actorEmployeeId,'unexpected_qa_employee');
  assert(q.mode==='recover'||enabled,'qa_disabled_ordinary_request');
  const common={protocol:'period-delegated-closure-v1',siteId:q.siteId,workerId:q.workerId,grantId:q.grantId,actorId:auth,employeeId:employee,access:'delegate',
   readAt:'2026-10-08T12:00:00.000001Z',usableActions:c||q.mode==='recover'?[]:['view','respond']};
  const period={...m.periodClosureUiSummary(),revision};let data;
  if(c){assert.equal(c.action,'respond');assert.equal(q.mode,'detail');assert.equal(c.periodId,period.periodId);assert.equal(c.expectedRevision,revision);assert.equal(c.expectedVersion,1);
   assert(!receipts.has(c.operationId),'duplicate_qa_post');assert.equal(q.fromDate,period.fromDate);assert.equal(q.throughDate,period.throughDate);
   const receipt={operationId:c.operationId,action:c.action,grantId:q.grantId,grantRevision:1,periodId:c.periodId,periodRevision:++revision,actorId:auth,
    recordedAt:common.readAt,commandFingerprint:sha(p.periodDelegatedClosureFingerprintText(q,c))};receipts.set(c.operationId,receipt);writes.push({query:q,command:c,receipt});
   data={...common,kind:'receipt',receipt};
  }else if(q.mode==='list'){assert.equal(q.fromDate,seed.fromDate);assert.equal(q.throughDate,seed.throughDate);
   data={...common,kind:'list',items:[{...period,openedAt:'2026-09-11T10:00:00.000001Z'}],nextCursor:null};
  }else if(q.mode==='recover'){data={...common,kind:'receipt',receipt:receipts.get(q.operationId)??null};
  }else{assert.equal(q.mode,'detail');assert.equal(q.periodId,period.periodId);assert.equal(q.fromDate,period.fromDate);assert.equal(q.throughDate,period.throughDate);
   data={...common,kind:'detail',period,artifact,artifactVersion:1,sourceChanged:false,operation:null,replayed:false};}
  const checked=p.parsePeriodDelegatedClosureResponse({ok:true,moduleEnabled:enabled,data},q,{authUserId:auth,employeeId:employee,targetEmployeeId:seed.targetEmployeeId,targetAuthUserId:seed.targetAuthUserId},c);
  return{body:checked,q,c,truncate:!!c};
 }
 return{seed,periodId:q0.periodId,respond,writes};
}
async function bounded(promise,ms=12000){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('delegated_period_browser_deadline')),ms);})]);}finally{clearTimeout(timer);}}
async function assets(seed){
 const {build}=await import('esbuild'),{compile}=await import('@tailwindcss/node'),{default:ts}=await import('typescript');
 const bundle=await build({absWorkingDir:root,entryPoints:['scripts/fixtures/attendance-period-delegated-closure-browser-entry.tsx'],bundle:true,write:false,metafile:true,platform:'browser',format:'esm',target:['es2020'],jsx:'automatic',tsconfig:path.join(root,'tsconfig.json'),outfile:'qa.js',logLevel:'warning',
  define:{'process.env':'{}','process.env.NODE_ENV':'"development"',__DELEGATED_PERIOD_SEED__:JSON.stringify(seed)}});
 const candidates=new Set();for(const name of Object.keys(bundle.metafile.inputs)){assert(!/node:crypto|\.server\.ts$/.test(name),'qa_server_import');
  if(!/\.tsx?$/.test(name)||name.includes('node_modules'))continue;const ast=ts.createSourceFile(name,await readFile(path.join(root,name),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const visit=node=>{if(ts.isStringLiteral(node)||ts.isNoSubstitutionTemplateLiteral(node)||ts.isTemplateHead(node)||ts.isTemplateMiddle(node)||ts.isTemplateTail(node))node.text.split(/\s+/).filter(Boolean).forEach(v=>candidates.add(v));ts.forEachChild(node,visit);};visit(ast);}
 const css=(await compile('@import "tailwindcss";',{base:root,onDependency:()=>{}})).build([...candidates])+'body{margin:0;background:#f8fafc;font-family:Arial,sans-serif}.qa-main{max-width:1000px;margin:auto;padding:8px;min-width:0}';
 return{js:bundle.outputFiles.find(f=>f.path.endsWith('.js')).contents,css};
}
export async function verifyPeriodDelegatedClosureBrowser(){
 const synthetic=model(),requests=[],errors=[],inflight=new Set(),deadline=Date.now()+180000;
 let server,browser,context,page,origin,files,totalHttp=0,closing=false,failure=null,stage='setup',accept=true,dialogs=0;
 const timer=setTimeout(()=>{closing=true;void context?.close().catch(()=>{});server?.closeAllConnections();},180000);
 const region=()=>page.getByRole('region',{name:'受托周期核对',exact:true});
 const settle=async()=>{await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await bounded(Promise.allSettled([...inflight]));};
 const click=async(locator,mode,api=endpoint)=>{const [response]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname===api&&new URL(r.url()).searchParams.get('mode')===mode),locator.click()]);
  await response.finished();assert.equal(response.status(),200,await response.text());await settle();return response.json();};
 const list=()=>click(region().getByRole('button',{name:'读取受托周期列表',exact:true}),'list');
 const select=()=>click(region().getByRole('button',{name:'读取受托保存版本',exact:true}),'detail');
 const configure=value=>page.evaluate(v=>window.__delegatedPeriodHarness.configure(v),value);
 try{
  files=await bounded(assets(synthetic.seed),45000);
  server=createServer((request,response)=>{const work=(async()=>{
   assert(!closing&&Date.now()<deadline,'qa_deadline');assert(++totalHttp<=80,'qa_http_limit');assert(origin&&request.headers.host===new URL(origin).host,'qa_host');
   const url=new URL(request.url,origin);response.setHeader('Cache-Control','no-store');response.setHeader('X-Content-Type-Options','nosniff');
   response.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
   if(staticPaths.has(url.pathname)){assert.equal(request.method,'GET');assert.equal(url.search,'');if(url.pathname==='/favicon.ico')return response.writeHead(204).end();
    const html='<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/qa.css"><div id="qa-root"></div><script type="module" src="/qa.js"></script></html>';
    return response.writeHead(200,{'Content-Type':url.pathname==='/'?'text/html;charset=utf-8':url.pathname==='/qa.js'?'text/javascript;charset=utf-8':'text/css;charset=utf-8'}).end(url.pathname==='/'?html:url.pathname==='/qa.js'?files.js:files.css);}
   assert([endpoint,foundationEndpoint].includes(url.pathname));assert(['GET','POST'].includes(request.method));assert(requests.length<20,'qa_api_limit');let text='',bytes=0;
   for await(const chunk of request){bytes+=chunk.length;assert(bytes<=8192,'qa_body_limit');text+=chunk.toString('utf8');}
   const outcome=synthetic.respond(url.href,request.method,text,request.headers['x-delegated-period-qa-auth'],request.headers['x-delegated-period-qa-employee'],request.headers['x-delegated-period-qa-enabled']==='1');
   requests.push({path:url.pathname,method:request.method,query:outcome.q,operationId:outcome.c?.operationId??outcome.q.operationId,syntheticCommitted:!!outcome.c,truncatedJson:outcome.truncate});
   response.writeHead(200,{'Content-Type':'application/json;charset=utf-8'}).end(outcome.truncate?'{"ok":':JSON.stringify(outcome.body));
  })();inflight.add(work);void work.catch(error=>{errors.push(String(error.message));if(!response.headersSent)response.writeHead(500,{'Content-Type':'application/json'});response.end('{"ok":false,"error":"attendance_unavailable"}');}).finally(()=>inflight.delete(work));});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const address=server.address();assert(address&&typeof address==='object'&&address.address==='127.0.0.1');origin=`http://127.0.0.1:${address.port}`;
  const {chromium}=await import('playwright');const launch=chromium.launch({headless:true});void launch.then(value=>{if(closing)return value.close();}).catch(()=>{});
  browser=await bounded(launch,15000);context=await browser.newContext({serviceWorkers:'block',acceptDownloads:false,viewport:{width:390,height:900}});
  await context.route('**/*',async route=>{const req=route.request(),url=new URL(req.url());if(url.origin!==origin||!['GET','POST'].includes(req.method())
    ||!(staticPaths.has(url.pathname)&&req.method()==='GET'&&!url.search||[endpoint,foundationEndpoint].includes(url.pathname))){errors.push('unexpected_external_request');await route.abort();return;}await route.continue();});
  page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  page.on('download',()=>errors.push('unexpected_download'));page.on('popup',()=>errors.push('unexpected_popup'));page.on('dialog',dialog=>{dialogs++;void(accept?dialog.accept():dialog.dismiss()).catch(error=>{if(!closing)errors.push(error.message);});});
  stage='initial.inert';await page.goto(origin);await page.getByRole('button',{name:'我的受托周期',exact:true}).waitFor();await settle();assert.equal(requests.length,0);assert.equal(await page.evaluate(()=>window.__delegatedPeriodHarness.snapshot().calls),0);
  stage='parent.grant_scope';await page.getByRole('button',{name:'我的受托周期',exact:true}).click();await page.getByRole('button',{name:'读取授权',exact:true}).waitFor();await settle();assert.equal(requests.length,0);
  await click(page.getByRole('button',{name:'读取授权',exact:true}),'list',foundationEndpoint);
  await click(page.getByRole('button',{name:'核验详情',exact:true}),'detail',foundationEndpoint);
  await page.getByLabel('受托周期起始日期',{exact:true}).fill(synthetic.seed.fromDate);await page.getByLabel('受托周期截止日期',{exact:true}).fill(synthetic.seed.throughDate);
  await page.getByRole('button',{name:'打开受托周期工作区',exact:true}).click();await region().waitFor();await settle();assert.equal(requests.length,2);
  stage='saved.full_scope';await list();await select();assert.equal(requests.at(-1).query.fromDate,'2026-09-01');assert.equal(requests.at(-1).query.throughDate,'2026-09-03');
  await page.locator('[data-period-closure-artifact]').waitFor();const textarea=()=>region().getByRole('textbox',{name:'本次操作理由（1–500字符）',exact:true});
  stage='dialog.cancel';await textarea().fill('合成浏览器明确回复');accept=false;const before=dialogs;
  await region().getByRole('button',{name:'回复周期事项',exact:true}).click();await settle();assert.equal(dialogs,before+1);assert.equal(synthetic.writes.length,0);assert.equal(await textarea().inputValue(),'合成浏览器明确回复');
  await page.keyboard.press('Escape');await region().waitFor();assert.equal(dialogs,before+2);accept=true;
  stage='one_post.lost_json';const [posted]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname===endpoint&&r.request().method()==='POST'),region().getByRole('button',{name:'回复周期事项',exact:true}).click()]);
  await posted.finished();await region().getByRole('button',{name:'只读核对原周期编号',exact:true}).waitFor();await settle();assert.equal(synthetic.writes.length,1);
  const pending=await page.evaluate(()=>{const keys=Object.keys(sessionStorage).filter(k=>k.startsWith('faolla:attendance:period-delegated-closure:v1:'));if(keys.length!==1)throw Error('qa_exact_pending_key');return{key:keys[0],raw:sessionStorage.getItem(keys[0])};});
  const persisted=JSON.parse(pending.raw);assert.deepEqual(persisted.command,synthetic.writes[0].command);assert.equal(persisted.commandFingerprint,synthetic.writes[0].receipt.commandFingerprint);
  // Deliberately exercise the independent Workspace recovery port here. The
  // actual flag-off launcher navigates to the separate recovery page instead.
  stage='flagoff.reload_get';await page.evaluate(()=>{sessionStorage.setItem('qa-delegated-period-disabled','1');sessionStorage.setItem('qa-delegated-period-direct','1');});const beforeReload=requests.length;await page.reload();await region().waitFor();
  await region().getByRole('button',{name:'只读核对原周期编号',exact:true}).waitFor();await settle();assert.equal(requests.length,beforeReload);
  assert.equal(await region().getByRole('button',{name:'读取受托周期列表',exact:true}).isDisabled(),true);assert.equal(await region().getByRole('button',{name:'预览导航日期完整周期',exact:true}).isDisabled(),true);
  await click(region().getByRole('button',{name:'只读核对原周期编号',exact:true}),'recover');assert.equal(requests.at(-1).operationId,persisted.command.operationId);
  assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),pending.key),null);assert.equal(synthetic.writes.length,1);assert.equal(await textarea().count(),0);
  stage='auth.delayed_detail';await configure({enabled:true});await settle();const noRead=requests.length;await settle();assert.equal(requests.length,noRead);await list();
  await page.evaluate(()=>window.__delegatedPeriodHarness.holdNext());await region().getByRole('button',{name:'读取受托保存版本',exact:true}).click();await page.waitForFunction(()=>window.__delegatedPeriodHarness.snapshot().held);
  await configure({other:true});await page.evaluate(()=>window.__delegatedPeriodHarness.release());await page.waitForFunction(()=>!window.__delegatedPeriodHarness.snapshot().held);await settle();
  assert.equal(await page.locator('[data-period-closure-artifact]').count(),0);assert.equal(await textarea().count(),0);
  stage='mobile.hidden';await configure({other:false});await settle();await list();await select();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false,'qa_390px_overflow');
  await textarea().fill('隐藏时必须丢弃草稿');const beforeHide=requests.length;await page.evaluate(()=>window.__delegatedPeriodHarness.visibility(true));assert.equal(await page.locator('[data-period-closure-artifact]').count(),0);assert.equal(await textarea().count(),0);
  await page.evaluate(()=>window.__delegatedPeriodHarness.visibility(false));await settle();assert.equal(requests.length,beforeHide);assert.equal(await textarea().count(),0);
  assert.equal(requests.filter(r=>r.method==='POST').length,1);assert.equal(synthetic.writes.length,1);assert.deepEqual(errors,[]);
  return{groups:9,actualChromium:true,actualWorkspace:true,actualClient:true,syntheticAuth:true,actualSql:false,requests:requests.length,gets:requests.filter(r=>r.method==='GET').length,posts:1,
    syntheticCommittedRows:1,responseFault:'complete HTTP200 with truncated JSON; not a TCP disconnect',originalGetRecovery:true,flagoffRecoveryViaDirectWorkspace:true,mobileWidth:390,horizontalOverflow:false,externalRequests:0,consoleErrors:0,diskBundles:false,parentLauncherCovered:true,parentFoundationGets:2,totalHttp};
 }catch(error){failure=Error(`period_delegated_browser_failed:${stage}:${String(error?.message??error)}`,{cause:error});throw failure;}
 finally{closing=true;clearTimeout(timer);await runAttendanceCleanupSteps([
  {name:'delegated period held response',run:async()=>{if(page&&!page.isClosed())await page.evaluate(()=>window.__delegatedPeriodHarness?.release()).catch(()=>{});}},
  {name:'delegated period own context',run:()=>context?bounded(context.close(),6000):undefined},
  {name:'delegated period own browser',run:()=>browser?bounded(browser.close(),6000):undefined},
  {name:'delegated period HTTP work',run:()=>bounded(Promise.allSettled([...inflight]),6000)},
  {name:'delegated period own loopback listener',run:()=>{server?.closeAllConnections();return server?.listening?bounded(new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve())),6000):undefined;}},
  {name:'delegated period esbuild',run:async()=>{(await import('esbuild')).stop();}},
 ]).catch(error=>{if(failure)throw new AggregateError([failure,error],'period_delegated_browser_and_cleanup_failed');throw error;});}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv.length===3&&process.argv[2]==='--run-local')console.log(JSON.stringify(await verifyPeriodDelegatedClosureBrowser()));
 else if(process.argv.length===2)console.log('Inert. Explicit local synthetic check: node --import tsx scripts/fixtures/attendance-period-delegated-closure-browser.mjs --run-local');
 else throw Error('explicit_run_local_only');
}
