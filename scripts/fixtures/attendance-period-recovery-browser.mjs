// Inert UI-protocol acceptance. No database, production requests, user browser,
// disk bundle, source mutation, or assertion of genuine Supabase authentication.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {runAttendanceCleanupSteps} from './attendance-cleanup.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url)),require=createRequire(import.meta.url);
const staticPaths=new Set(['/','/qa.js','/qa.css','/favicon.ico']);
export const periodRecoveryBrowserLimits=Object.freeze({ttlMs:180000,http:80,api:20});
const sha=text=>createHash('sha256').update(text,'utf8').digest('hex');

export async function createPeriodRecoveryBrowserModel(){
 const g=require('../../src/lib/merchantAttendancePeriodDelegation.ts'),gc=require('../../src/lib/merchantAttendancePeriodDelegationClient.ts');
 const p=require('../../src/lib/merchantAttendancePeriodDelegatedClosure.ts'),pc=require('../../src/lib/merchantAttendancePeriodDelegatedClosureClient.ts');
 const a=require('../../src/lib/merchantAttendanceAccountSuspension.ts'),ac=require('../../src/lib/merchantAttendanceAccountSuspensionClient.ts');
 const legacy=require('./attendance-account-suspension-model.ts'),id=legacy.accountSuspensionId,authUserId=legacy.accountSuspensionOwner,siteId=legacy.accountSuspensionSite;
 const stamp='2026-10-08T10:00:00.000001Z',entries=[];
 const query={siteId,access:'owner',mode:'detail',catalog:null,grantId:id(23408),afterId:null,operationId:null};
 const command={action:'revoke',operationId:id(23409),grantId:query.grantId,expectedRevision:1,reason:'Private synthetic management reason'};
 const commandFingerprint=await g.periodDelegationCommandFingerprint(query,command);
 entries.push({kind:'period-delegation',key:gc.periodDelegationPendingKey(siteId,'owner',authUserId),operationId:command.operationId,
  raw:JSON.stringify({version:1,anchorId:authUserId,actorId:authUserId,employeeId:null,query,command,commandFingerprint},null,2)});
 const scope={siteId,actorEmployeeId:id(23402),expectedAuthUserId:authUserId,grantId:id(23418),workerId:id(23403),targetEmployeeId:id(23404),targetAuthUserId:id(23405),
  authorizedFromDate:'2026-09-01',authorizedThroughDate:'2026-09-30'};
 const q={siteId,access:'delegate',grantId:scope.grantId,workerId:scope.workerId,fromDate:'2026-09-02',throughDate:'2026-09-03',mode:'detail',periodId:id(23406),operationId:null,version:null,cursor:null};
 const c={action:'respond',operationId:id(23407),periodId:q.periodId,expectedRevision:2,expectedVersion:1,expectedFingerprint:null,reason:'Private synthetic period reason'};
 const closureFingerprint=sha(p.periodDelegatedClosureFingerprintText(q,c)),closureKey=pc.periodDelegatedClosurePendingKey(scope);
 const closureRaw=command=>JSON.stringify({format:1,scope,query:q,command,commandFingerprint:sha(p.periodDelegatedClosureFingerprintText(q,command))},null,2);
 entries.push({kind:'period-closure',key:closureKey,operationId:c.operationId,raw:closureRaw(c)});
 const statusCommand=legacy.accountStatusCommand(),statusFingerprint=await a.accountStatusCommandFingerprint(siteId,statusCommand);
 entries.push({kind:'account-status',key:ac.accountStatusPendingKey(siteId,authUserId),operationId:statusCommand.operationId,
  raw:JSON.stringify({version:1,siteId,actorId:authUserId,command:statusCommand,commandFingerprint:statusFingerprint},null,2)});
 const legacyBody=await legacy.accountStatusReceiptHttp(statusCommand),endpoints=[g.PERIOD_DELEGATION_API,p.PERIOD_DELEGATED_CLOSURE_API,a.ACCOUNT_SUSPENSION_API];
 const recovered={grant:{...query,mode:'recover',grantId:null,operationId:command.operationId},closure:{...q,mode:'recover',operationId:c.operationId},
  status:{siteId,mode:'recover-status',afterId:null,suspensionId:null,operationId:statusCommand.operationId}};
 function respond(url,method,auth,fault='none'){
  assert.equal(method,'GET','qa_recovery_get_only');assert.equal(auth,authUserId,'qa_synthetic_auth');assert(['none','null','malformed'].includes(fault));
  const pathname=new URL(url).pathname;let query,body,kind;
  if(pathname===g.PERIOD_DELEGATION_API){
   query=g.parsePeriodDelegationHttpQuery(url);assert.deepEqual(query,recovered.grant);kind='period-delegation';
   const receipt=fault==='null'?null:{operationId:command.operationId,action:command.action,grantId:command.grantId,grantRevision:2,periodId:null,periodRevision:null,
    actorId:authUserId,recordedAt:stamp,commandFingerprint};
   body={ok:true,protocol:'period-delegation-v1',siteId,access:'owner',actorId:authUserId,employeeId:null,mode:'recover',canWrite:false,grants:[],catalogItems:[],nextAfterId:null,detail:null,receipt,readAt:stamp};
   g.parsePeriodDelegationResponse(body,query,{authUserId});
  }else if(pathname===p.PERIOD_DELEGATED_CLOSURE_API){
   query=p.parsePeriodDelegatedClosureHttpQuery(url);assert.deepEqual(query,recovered.closure);kind='period-closure';
   const receipt=fault==='null'?null:{operationId:c.operationId,action:c.action,grantId:scope.grantId,grantRevision:1,periodId:c.periodId,periodRevision:3,actorId:authUserId,recordedAt:stamp,commandFingerprint:closureFingerprint};
   body={ok:true,moduleEnabled:false,data:{protocol:'period-delegated-closure-v1',siteId,workerId:scope.workerId,grantId:scope.grantId,actorId:authUserId,
    employeeId:scope.actorEmployeeId,access:'delegate',readAt:stamp,usableActions:[],kind:'receipt',receipt}};
   p.parsePeriodDelegatedClosureResponse(body,query,{authUserId,employeeId:scope.actorEmployeeId,targetEmployeeId:scope.targetEmployeeId,targetAuthUserId:scope.targetAuthUserId});
  }else{
   assert.equal(pathname,a.ACCOUNT_SUSPENSION_API,'qa_unknown_endpoint');query=a.parseAccountSuspensionHttpQuery(url);assert.deepEqual(query,recovered.status);kind='account-status';
   body=fault==='null'?{...legacyBody,statusReceipt:null}:legacyBody;a.parseAccountSuspensionResponse(body,query,authUserId);
  }
  // Malformed is an explicit transport fault applied after checking the saved DTO.
  return{kind,query,body,text:fault==='malformed'?'{"ok":':JSON.stringify(body),fault};
 }
 return{seed:{authUserId,otherAuthUserId:id(23499),endpoints},entries,recovered,respond,
  replacement:{key:closureKey,raw:closureRaw({...c,operationId:id(23447),reason:'New concurrent synthetic pending'})}};
}

async function bounded(promise,ms=12000){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('period_recovery_browser_deadline')),ms);})]);}finally{clearTimeout(timer);}}
async function assets(seed){
 const {build}=await import('esbuild'),{compile}=await import('@tailwindcss/node'),{default:ts}=await import('typescript');
 const bundle=await build({absWorkingDir:root,entryPoints:['scripts/fixtures/attendance-period-recovery-browser-entry.tsx'],bundle:true,write:false,metafile:true,platform:'browser',format:'esm',target:['es2020'],jsx:'automatic',tsconfig:path.join(root,'tsconfig.json'),outfile:'qa.js',logLevel:'warning',
  define:{'process.env':'{}','process.env.NODE_ENV':'"development"',__PERIOD_RECOVERY_SEED__:JSON.stringify(seed)}});
 const candidates=new Set();for(const name of Object.keys(bundle.metafile.inputs)){assert(!/node:crypto|\.server\.ts$/.test(name),'qa_server_import');
  if(!/\.tsx?$/.test(name)||name.includes('node_modules'))continue;const ast=ts.createSourceFile(name,await readFile(path.join(root,name),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const visit=node=>{if(ts.isStringLiteral(node)||ts.isNoSubstitutionTemplateLiteral(node)||ts.isTemplateHead(node)||ts.isTemplateMiddle(node)||ts.isTemplateTail(node))node.text.split(/\s+/).filter(Boolean).forEach(v=>candidates.add(v));ts.forEachChild(node,visit);};visit(ast);}
 const css=(await compile('@import "tailwindcss";',{base:root,onDependency:()=>{}})).build([...candidates])+'body{margin:0;background:#f8fafc;font-family:Arial,sans-serif}.qa-main{max-width:1000px;margin:auto;padding:8px;min-width:0}';
 return{js:bundle.outputFiles.find(f=>f.path.endsWith('.js')).contents,css};
}

export async function verifyPeriodRecoveryBrowser(){
 const synthetic=await createPeriodRecoveryBrowserModel(),requests=[],errors=[],inflight=new Set(),deadline=Date.now()+periodRecoveryBrowserLimits.ttlMs;
 let server,browser,context,page,origin,files,totalHttp=0,closing=false,failure=null,stage='setup',fault='none',report;
 const timer=setTimeout(()=>{closing=true;void context?.close().catch(()=>{});server?.closeAllConnections();},periodRecoveryBrowserLimits.ttlMs);
 const rows=()=>page.locator('[data-attendance-recovery-kind]'),row=kind=>page.locator(`[data-attendance-recovery-kind="${kind}"]`);
 const receipt=()=>page.getByRole('region',{name:'已核实最小回执',exact:true}),scanButton=()=>page.getByRole('button',{name:'查找本标签页待确认编号',exact:true});
 const settle=async()=>{await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await bounded(Promise.allSettled([...inflight]));};
 const slot=entry=>page.evaluate(key=>sessionStorage.getItem(key),entry.key);
 const seed=entries=>page.evaluate(values=>{for(const e of values)sessionStorage.setItem(e.key,e.raw);},entries);
 const scan=async()=>{const before=requests.length;await scanButton().click();await page.waitForFunction(()=>!document.querySelector('section[aria-label="考勤原编号恢复"] button')?.disabled);await settle();assert.equal(requests.length,before,'scan_must_be_local');};
 const recover=async kind=>{const [response]=await Promise.all([page.waitForResponse(r=>synthetic.seed.endpoints.includes(new URL(r.url()).pathname)),row(kind).getByRole('button',{name:'读取这个原编号',exact:true}).click()]);
  await response.finished();assert.equal(response.status(),200,await response.text());await page.waitForFunction(()=>!document.querySelector('section[aria-label="考勤原编号恢复"] button')?.disabled);await settle();};
 const delayed=async()=>{await page.evaluate(()=>window.__periodRecoveryHarness.holdNext());await row('period-closure').getByRole('button',{name:'读取这个原编号',exact:true}).click();
  await page.waitForFunction(()=>window.__periodRecoveryHarness.snapshot().held);};
 const release=async()=>{await page.evaluate(()=>window.__periodRecoveryHarness.release());await page.waitForFunction(()=>!window.__periodRecoveryHarness.snapshot().held);await settle();};
 const [grant,closure,legacy]=synthetic.entries;
 try{
  files=await bounded(assets(synthetic.seed),45000);
  server=createServer((request,response)=>{const work=(async()=>{
   assert(!closing&&Date.now()<deadline,'qa_deadline');assert(++totalHttp<=periodRecoveryBrowserLimits.http,'qa_http_limit');assert(origin&&request.headers.host===new URL(origin).host,'qa_host');
   const url=new URL(request.url,origin);response.setHeader('Cache-Control','no-store');response.setHeader('X-Content-Type-Options','nosniff');
   response.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
   assert.equal(request.method,'GET','qa_recovery_get_only');assert.equal(request.headers['transfer-encoding'],undefined);assert(!request.headers['content-length']||request.headers['content-length']==='0');
   if(staticPaths.has(url.pathname)){assert.equal(url.search,'');if(url.pathname==='/favicon.ico')return response.writeHead(204).end();
    const html='<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="/favicon.ico"><link rel="stylesheet" href="/qa.css"><div id="qa-root"></div><script type="module" src="/qa.js"></script></html>';
    return response.writeHead(200,{'Content-Type':url.pathname==='/'?'text/html;charset=utf-8':url.pathname==='/qa.js'?'text/javascript;charset=utf-8':'text/css;charset=utf-8'}).end(url.pathname==='/'?html:url.pathname==='/qa.js'?files.js:files.css);}
   assert(synthetic.seed.endpoints.includes(url.pathname),'qa_unknown_endpoint');assert(requests.length<periodRecoveryBrowserLimits.api,'qa_api_limit');
   const outcome=synthetic.respond(url.href,request.method,request.headers['x-period-recovery-qa-auth'],fault);fault='none';
   requests.push({kind:outcome.kind,path:url.pathname,method:request.method,query:outcome.query,fault:outcome.fault});
   response.writeHead(200,{'Content-Type':'application/json;charset=utf-8'}).end(outcome.text);
  })();inflight.add(work);void work.catch(error=>{errors.push(String(error.message));if(!response.headersSent)response.writeHead(500,{'Content-Type':'application/json'});response.end('{"ok":false,"error":"attendance_unavailable"}');}).finally(()=>inflight.delete(work));});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const address=server.address();assert(address&&typeof address==='object'&&address.address==='127.0.0.1');origin=`http://127.0.0.1:${address.port}`;
  const {chromium}=await import('playwright');const launch=chromium.launch({headless:true});void launch.then(value=>{if(closing)return value.close();}).catch(()=>{});
  browser=await bounded(launch,15000);context=await browser.newContext({serviceWorkers:'block',acceptDownloads:false,viewport:{width:390,height:900}});
  await context.route('**/*',async route=>{const req=route.request(),url=new URL(req.url());if(url.origin!==origin||req.method()!=='GET'
    ||!(staticPaths.has(url.pathname)&&!url.search||synthetic.seed.endpoints.includes(url.pathname))){errors.push('unexpected_external_or_write_request');await route.abort();return;}await route.continue();});
  await context.addInitScript(entries=>{for(const entry of entries)sessionStorage.setItem(entry.key,entry.raw);},synthetic.entries);
  page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  page.on('download',()=>errors.push('unexpected_download'));page.on('popup',()=>errors.push('unexpected_popup'));
  stage='inert.explicit_local_scan';await page.goto(origin);await scanButton().waitFor();await settle();assert.equal(requests.length,0);assert.equal(await rows().count(),0);
  assert.equal(await page.evaluate(()=>window.__periodRecoveryHarness.snapshot().featureFlagsEnabled),false);await scan();assert.equal(await rows().count(),3);
  assert.doesNotMatch(await page.locator('main').innerText(),/Private synthetic|New concurrent synthetic/);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'qa_390px_list_overflow');
  stage='period_delegation.minimum_receipt';await recover('period-delegation');assert.equal(await slot(grant),null);assert.equal(await slot(closure),closure.raw);assert.equal(await slot(legacy),legacy.raw);
  assert.equal(await receipt().getAttribute('data-attendance-recovery-receipt'),'period-delegation');
  assert.doesNotMatch(await receipt().innerText(),/Private synthetic|commandFingerprint|workerId|targetAuth/);
  stage='unknown.null_and_malformed';for(const variant of ['null','malformed']){fault=variant;await recover('period-closure');assert.equal(await slot(closure),closure.raw);assert.equal(await receipt().count(),0);assert.equal(await row('period-closure').count(),1);
    assert.match(await page.getByRole('status').innerText(),/查无回执不等于失败/);}
  stage='period_closure.flagoff_receipt';await recover('period-closure');assert.equal(await slot(closure),null);assert.equal(await receipt().getAttribute('data-attendance-recovery-receipt'),'period-closure');
  assert.match(await receipt().innerText(),/不恢复周期查看或审批权限/);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'qa_390px_receipt_overflow');
  stage='legacy_mixed_receipt';await recover('account-status');assert.equal(await slot(legacy),null);assert.equal(await rows().count(),0);assert.equal(await receipt().getAttribute('data-attendance-recovery-receipt'),'account-status');
  stage='concurrent_storage_replacement';await seed([closure]);await scan();await delayed();await seed([synthetic.replacement]);await release();
  await page.waitForFunction(()=>!document.querySelector('section[aria-label="考勤原编号恢复"] button')?.disabled);
  assert.equal(await slot(closure),synthetic.replacement.raw);assert.equal(await receipt().count(),0);
  stage='auth_change_after_first_byte';await seed([closure]);await scan();await delayed();await page.evaluate(()=>window.__periodRecoveryHarness.configure(true));await release();
  assert.equal(await slot(closure),closure.raw);assert.equal(await rows().count(),0);assert.equal(await receipt().count(),0);await scan();assert.equal(await rows().count(),0);
  await page.evaluate(()=>window.__periodRecoveryHarness.configure(false));await settle();assert.equal(await rows().count(),0);assert.equal(await slot(closure),closure.raw);
  stage='shared_global64_cap';await seed(synthetic.entries);await page.evaluate(()=>{for(let n=0;n<61;n++)sessionStorage.setItem(`faolla:attendance:period-delegation:v1:qa-cap-${n}`,'{}');});
  await scan();assert.equal(await rows().count(),3);assert.match(await page.getByRole('status').innerText(),/部分本地记录无法核验/);
  await page.evaluate(()=>sessionStorage.setItem('faolla:attendance:period-delegation:v1:qa-cap-61','{}'));await scan();assert.equal(await rows().count(),0);assert.match(await page.getByRole('status').innerText(),/无法安全读取本地存储/);
  for(const entry of synthetic.entries)assert.equal(await slot(entry),entry.raw);
  assert.equal(await page.evaluate(()=>Object.keys(sessionStorage).filter(k=>k.startsWith('faolla:attendance:')).length),65);
  assert.equal(requests.length,7);assert(requests.every(r=>r.method==='GET'&&['recover','recover-status'].includes(r.query.mode)));assert.deepEqual(errors,[]);
  report={groups:8,actualChromium:true,actualRecoveryPanel:true,actualAggregateAndClients:true,syntheticAuth:true,pageSupabaseAuthVerified:false,actualSql:false,
   localPending:'explicit synthetic saved intents; not actual POST lifecycle',featureFlagsEnabled:false,explicitScanRequests:0,requests:requests.length,gets:requests.length,posts:0,totalHttp,
   minimumReceiptKinds:synthetic.entries.map(e=>e.kind),unknownRepliesRetained:true,concurrentStoragePreserved:true,lateAuthResponsePreserved:true,globalSlotsAccepted:64,globalSlotsRejected:65,
   mobileWidth:390,horizontalOverflow:false,externalRequests:0,consoleErrors:0,diskBundles:false,latencyFault:'valid synthetic response held after headers and one body byte'};
 }catch(error){failure=Error(`period_recovery_browser_failed:${stage}:${String(error?.message??error)}:diagnostics=${JSON.stringify({errors,requests:requests.slice(-5)})}`,{cause:error});throw failure;}
 finally{closing=true;clearTimeout(timer);await runAttendanceCleanupSteps([
  {name:'period recovery held response',run:async()=>{if(page&&!page.isClosed())await page.evaluate(()=>window.__periodRecoveryHarness?.release()).catch(()=>{});}},
  {name:'period recovery own context',run:()=>context?bounded(context.close(),6000):undefined},
  {name:'period recovery own browser',run:()=>browser?bounded(browser.close(),6000):undefined},
  {name:'period recovery HTTP work',run:()=>bounded(Promise.allSettled([...inflight]),6000)},
  {name:'period recovery own loopback listener',run:()=>{server?.closeAllConnections();return server?.listening?bounded(new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve())),6000):undefined;}},
  {name:'period recovery esbuild',run:async()=>{(await import('esbuild')).stop();}},
 ]).catch(error=>{if(failure)throw new AggregateError([failure,error],'period_recovery_browser_and_cleanup_failed');throw error;});}
 assert(!browser?.isConnected()&&!server?.listening,'qa_cleanup_incomplete');return{...report,browserClosed:true,listenerStopped:true};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv.length===3&&process.argv[2]==='--run-local')console.log(JSON.stringify(await verifyPeriodRecoveryBrowser()));
 else if(process.argv.length===2)console.log('Inert. Explicit local synthetic check: node --import tsx scripts/fixtures/attendance-period-recovery-browser.mjs --run-local');
 else throw Error('explicit_run_local_only');
}
