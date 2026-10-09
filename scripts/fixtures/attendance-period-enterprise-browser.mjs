//235 INERT, complete real Manager/Admin with strict synthetic API. No database.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {runAttendanceCleanupSteps} from './attendance-cleanup.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url)),require=createRequire(import.meta.url);
export const periodEnterpriseLimits=Object.freeze({ttlMs:180000,http:80,api:20});
export const periodEnterprisePaths=Object.freeze({overview:'/api/merchant-enterprise/overview',operations:'/api/merchant-enterprise/current-operations',todos:'/api/merchant-enterprise/todos',
 admin:'/api/merchant-enterprise/attendance/admin',delegation:'/api/merchant-enterprise/attendance/period-delegation',closure:'/api/merchant-enterprise/attendance/period-delegated-closure'});
const paths=new Set(Object.values(periodEnterprisePaths)),statics=new Set(['/','/qa.js','/qa.css','/favicon.ico']);
const sha=text=>createHash('sha256').update(text,'utf8').digest('hex');
export function createPeriodEnterpriseModel(){
 const m=require('./attendance-period-closure-ui-model.ts'),p=require('../../src/lib/merchantAttendancePeriodDelegatedClosure.ts'),g=require('../../src/lib/merchantAttendancePeriodDelegation.ts');
 const a=require('../../src/lib/merchantAttendanceAdmin.ts'),json=require('../../src/lib/merchantAttendanceRuleCapturesBrowser.ts');
 const operations=require('../../src/lib/merchantEnterpriseCurrentOperations.ts'),todos=require('../../src/lib/merchantEnterpriseTodos.ts'),id=m.periodClosureUiId;
 const artifact=m.periodClosureUiArtifact(),original=m.periodClosureUiSummary(),siteId=original.siteId??m.periodClosureUiQuery('detail').siteId;
 const seed={siteId,actorEmployeeId:id(735001),authUserId:id(735002),ownerId:id(735003),otherEmployeeId:id(735004),otherAuthUserId:id(735005),grantId:id(735006),workerId:original.workerId,
  targetEmployeeId:artifact.worker.employeeId,targetAuthUserId:artifact.worker.employeeAuthUserId,fromDate:'2026-09-02',throughDate:'2026-09-02',closureEndpoint:periodEnterprisePaths.closure,
  tokens:{employee:'synthetic235-employee-token',other:'synthetic235-other-token',owner:'synthetic235-owner-token'}};
 const stamp='2026-10-08T12:00:00.000001Z',writes=[],receipts=new Map();let revision=original.revision;
 const actor=identity=>({type:identity==='owner'?'owner':'employee',id:identity==='owner'?seed.ownerId:identity==='employee'?seed.actorEmployeeId:seed.otherEmployeeId,siteId,
  displayName:`Synthetic235 ${identity}`,email:`synthetic235-${identity}@example.test`,permissions:identity==='employee'?['enterprise.view','attendance.period.view','attendance.period.respond']:['enterprise.view'],
  accessScope:'all',allowedBoardIds:[],...(identity==='owner'?{}:{roleId:id(735007)})});
 const snapshot={roles:[],employees:[],boards:[],columns:[],tasks:[]};
 const grant={grantId:seed.grantId,revision:1,status:'granted',delegate:{employeeId:seed.actorEmployeeId,authUserId:seed.authUserId,name:'Synthetic235 supervisor'},
  worker:{workerId:seed.workerId,employeeId:seed.targetEmployeeId,authUserId:seed.targetAuthUserId,name:artifact.worker.workerName,workerNo:artifact.worker.workerNo},fromDate:'2026-09-01',throughDate:'2026-09-30',
  actions:['view','respond'],includeExisting:true,validFrom:'2026-10-01T00:00:00.000000Z',validUntil:'2026-11-01T00:00:00.000000Z',grantedBy:seed.ownerId,
  grantedAt:'2026-10-01T00:00:00.000000Z',reason:'Synthetic235 saved grant',usableActions:['view','respond'],revocation:null};
 const flat=(url,expected)=>{assert.deepEqual([...url.searchParams].sort(),Object.entries(expected).sort());};
 function respond(url,method,text,token){
  const u=new URL(url),identity=Object.entries(seed.tokens).find(([,value])=>value===token)?.[0];assert(identity,'qa_unknown_auth');assert(paths.has(u.pathname),'qa_unknown_path');
  assert(['GET','POST'].includes(method));assert(method==='POST'?u.pathname===periodEnterprisePaths.closure:text==='');let body,q=null,c=null;
  const authUserId=identity==='owner'?seed.ownerId:identity==='employee'?seed.authUserId:seed.otherAuthUserId;
  if(u.pathname===periodEnterprisePaths.overview){assert.equal(method,'GET');flat(u,{siteId});body={ok:true,actor:actor(identity),currentAuthUserId:authUserId,snapshot,needsBootstrap:false};}
  else if(u.pathname===periodEnterprisePaths.operations){assert.equal(identity,'owner');flat(u,{siteId});body=operations.buildMerchantEnterpriseCurrentOperationsFallback({actor:actor(identity),boards:[],columns:[],tasks:[]},Date.parse('2026-10-08T12:00:00Z'));assert(operations.normalizeMerchantEnterpriseCurrentOperations(body));}
  else if(u.pathname===periodEnterprisePaths.todos){assert.equal(identity,'employee');flat(u,{siteId,category:'all',limit:'20'});body={ok:true,merchantId:siteId,items:[],counts:{openCount:0,taskCount:0,overdueCount:0,dueSoonCount:0,acknowledgementCount:0,executionCount:0,feedbackCount:0},nextCursor:null};assert(todos.normalizeMerchantEnterpriseTodoPage(body));}
  else if(u.pathname===periodEnterprisePaths.admin){assert.equal(identity,'owner');q=a.parseAttendanceAdminQuery(u.href);assert.equal(q.siteId,siteId);assert.equal(q.view,'settings');assert(!q.operationId&&!q.cursor&&!q.search);
   body={ok:true,moduleEnabled:true,siteId,view:'settings',version:1,settings:{timeZone:'UTC',enabled:true,webClockEnabled:true,webBreakPaid:false},items:[],nextCursor:null,receipt:null};a.parseAttendanceAdminResult(body,q);}
  else if(u.pathname===periodEnterprisePaths.delegation){assert.notEqual(identity,'other');q=g.parsePeriodDelegationHttpQuery(u.href);assert.equal(q.siteId,siteId);assert.equal(q.access,identity==='owner'?'owner':'delegate');assert(['list','detail'].includes(q.mode));
   assert.equal(q.grantId,q.mode==='detail'?seed.grantId:null);assert.equal(q.catalog,null);assert.equal(q.afterId,null);assert.equal(q.operationId,null);
   body={ok:true,protocol:'period-delegation-v1',siteId,access:q.access,actorId:authUserId,employeeId:identity==='owner'?null:seed.actorEmployeeId,mode:q.mode,canWrite:identity==='owner',
    grants:q.mode==='list'?[grant]:[],catalogItems:[],nextAfterId:null,detail:q.mode==='detail'?grant:null,receipt:null,readAt:stamp};g.parsePeriodDelegationResponse(body,q,{authUserId});
  }else{
   assert.equal(identity,'employee');const input=method==='POST'?p.parsePeriodDelegatedClosureBody(json.parseCaptureBrowserJson(text)):null;q=input?.query??p.parsePeriodDelegatedClosureHttpQuery(u.href);c=input?.command??null;
   assert.equal(q.siteId,siteId);assert.equal(q.workerId,seed.workerId);assert.equal(q.grantId,seed.grantId);const common={protocol:'period-delegated-closure-v1',siteId,workerId:seed.workerId,grantId:seed.grantId,actorId:authUserId,
    employeeId:seed.actorEmployeeId,access:'delegate',readAt:stamp,usableActions:c||q.mode==='recover'?[]:['view','respond']};let data;
   if(c){assert.equal(writes.length,0,'qa_one_post_only');assert.equal(q.mode,'detail');assert.equal(c.action,'respond');assert.equal(c.periodId,original.periodId);assert.equal(c.expectedRevision,revision);assert.equal(c.expectedVersion,original.currentVersion);
    assert.equal(q.fromDate,original.fromDate);assert.equal(q.throughDate,original.throughDate);const receipt={operationId:c.operationId,action:c.action,grantId:seed.grantId,grantRevision:1,periodId:c.periodId,periodRevision:++revision,actorId:authUserId,recordedAt:stamp,commandFingerprint:sha(p.periodDelegatedClosureFingerprintText(q,c))};
    receipts.set(c.operationId,receipt);writes.push({query:q,command:c,receipt});data={...common,kind:'receipt',receipt};
   }else if(q.mode==='list'){assert.equal(q.fromDate,seed.fromDate);assert.equal(q.throughDate,seed.throughDate);data={...common,kind:'list',items:[{...original,revision,openedAt:'2026-09-11T10:00:00.000001Z'}],nextCursor:null};}
   else if(q.mode==='recover'){assert.equal(q.periodId,original.periodId);assert(receipts.has(q.operationId));data={...common,kind:'receipt',receipt:receipts.get(q.operationId)};}
   else{assert.equal(q.mode,'detail');assert.equal(q.periodId,original.periodId);assert.equal(q.fromDate,original.fromDate);assert.equal(q.throughDate,original.throughDate);data={...common,kind:'detail',period:{...original,revision},artifact,artifactVersion:original.currentVersion,sourceChanged:false,operation:null,replayed:false};}
   body=p.parsePeriodDelegatedClosureResponse({ok:true,moduleEnabled:true,data},q,{authUserId,employeeId:seed.actorEmployeeId,targetEmployeeId:seed.targetEmployeeId,targetAuthUserId:seed.targetAuthUserId},c);
  }
  return{body,text:c?'{"ok":':JSON.stringify(body),identity,query:q,command:c,committed:!!c};
 }
 return{seed,actor,respond,writes,artifact,original};
}
async function bounded(promise,ms=12000){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('enterprise_browser_deadline')),ms);})]);}finally{clearTimeout(timer);}}
async function assets(seed){
 const {build}=await import('esbuild'),{compile}=await import('@tailwindcss/node'),{default:ts}=await import('typescript');
 const bundle=await build({absWorkingDir:root,entryPoints:['scripts/fixtures/attendance-period-enterprise-browser-entry.tsx'],bundle:true,write:false,metafile:true,platform:'browser',format:'esm',target:['es2020'],jsx:'automatic',tsconfig:path.join(root,'tsconfig.json'),outfile:'qa.js',logLevel:'warning',
  define:{'process.env':JSON.stringify({NEXT_PUBLIC_FAOLLA_ATTENDANCE_PERIOD_DELEGATION_ENABLED:'1',NEXT_PUBLIC_FAOLLA_ATTENDANCE_PERIOD_CLOSURES_ENABLED:'1',NEXT_PUBLIC_FAOLLA_ATTENDANCE_PERIOD_CONTINUATION_ENABLED:'1'}),'process.env.NODE_ENV':'"development"',__PERIOD_ENTERPRISE_SEED__:JSON.stringify(seed)}});
 const candidates=new Set();for(const name of Object.keys(bundle.metafile.inputs)){assert(!/node:crypto|\.server\.ts$/.test(name),'qa_server_import');if(!/\.tsx?$/.test(name)||name.includes('node_modules'))continue;
  const ast=ts.createSourceFile(name,await readFile(path.join(root,name),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);const visit=node=>{if(ts.isStringLiteral(node)||ts.isNoSubstitutionTemplateLiteral(node)||ts.isTemplateHead(node)||ts.isTemplateMiddle(node)||ts.isTemplateTail(node))node.text.split(/\s+/).filter(Boolean).forEach(v=>candidates.add(v));ts.forEachChild(node,visit);};visit(ast);}
 assert(Object.keys(bundle.metafile.inputs).some(n=>n.includes('next/dynamic'))||Object.keys(bundle.metafile.inputs).some(n=>n.includes('next/dist/shared/lib/dynamic')),'actual_next_dynamic_required');
 const css=(await compile('@import "tailwindcss";',{base:root,onDependency:()=>{}})).build([...candidates])+bundle.outputFiles.filter(f=>f.path.endsWith('.css')).map(f=>f.text).join('\n')+'body{margin:0;background:#f8fafc;font-family:Arial,sans-serif}.qa-main{max-width:1200px;margin:auto;min-width:0}';
 return{js:bundle.outputFiles.find(f=>f.path.endsWith('.js')).contents,css};
}
export async function verifyPeriodEnterpriseBrowser(){
 const model=createPeriodEnterpriseModel(),requests=[],errors=[],inflight=new Set(),deadline=Date.now()+periodEnterpriseLimits.ttlMs;
 let server,browser,context,page,origin,files,totalHttp=0,closing=false,failure=null,stage='setup',accept=true,dialogs=0,report;
 const timer=setTimeout(()=>{closing=true;void context?.close().catch(()=>{});server?.closeAllConnections();},periodEnterpriseLimits.ttlMs);
 const settle=async()=>{await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await bounded(Promise.allSettled([...inflight]));};
 const region=()=>page.getByRole('region',{name:'受托周期核对',exact:true});
 const click=async(locator,pathname,mode)=>{const [response]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname===pathname&&(!mode||new URL(r.url()).searchParams.get('mode')===mode)),locator.click()]);await response.finished();assert.equal(response.status(),200,await response.text());await settle();return response;};
 const enter=async()=>{await page.getByRole('button',{name:'我的受托周期',exact:true}).click();await page.getByRole('button',{name:'读取授权',exact:true}).waitFor();
  await click(page.getByRole('button',{name:'读取授权',exact:true}),periodEnterprisePaths.delegation,'list');await click(page.getByRole('button',{name:'核验详情',exact:true}),periodEnterprisePaths.delegation,'detail');
  await page.getByLabel('受托周期起始日期',{exact:true}).fill(model.seed.fromDate);await page.getByLabel('受托周期截止日期',{exact:true}).fill(model.seed.throughDate);await page.getByRole('button',{name:'打开受托周期工作区',exact:true}).click();await region().waitFor();await settle();};
 const identity=async value=>{const response=page.waitForResponse(r=>new URL(r.url()).pathname===periodEnterprisePaths.overview);await page.evaluate(v=>window.__periodEnterpriseHarness.identity(v),value);await(await response).finished();await settle();};
 try{
  files=await bounded(assets(model.seed),45000);
  server=createServer((request,response)=>{const work=(async()=>{assert(!closing&&Date.now()<deadline);assert(++totalHttp<=periodEnterpriseLimits.http,'qa_http_limit');assert(request.headers.host===new URL(origin).host);
   const url=new URL(request.url,origin);response.setHeader('Cache-Control','no-store');response.setHeader('X-Content-Type-Options','nosniff');response.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
   if(statics.has(url.pathname)){assert.equal(request.method,'GET');assert.equal(url.search,'');if(url.pathname==='/favicon.ico')return response.writeHead(204).end();const html='<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="/favicon.ico"><link rel="stylesheet" href="/qa.css"><div id="qa-root"></div><script type="module" src="/qa.js"></script></html>';
    return response.writeHead(200,{'Content-Type':url.pathname==='/'?'text/html;charset=utf-8':url.pathname==='/qa.js'?'text/javascript;charset=utf-8':'text/css;charset=utf-8'}).end(url.pathname==='/'?html:url.pathname==='/qa.js'?files.js:files.css);}
   assert(paths.has(url.pathname));assert(requests.length<periodEnterpriseLimits.api,'qa_api_limit');let text='',bytes=0;for await(const chunk of request){bytes+=chunk.length;assert(bytes<=8192);text+=chunk.toString('utf8');}
   const outcome=model.respond(url.href,request.method,text,request.headers['x-merchant-access-token']);requests.push({method:request.method,path:url.pathname,identity:outcome.identity,query:outcome.query,committed:outcome.committed});response.writeHead(200,{'Content-Type':'application/json;charset=utf-8'}).end(outcome.text);
  })();inflight.add(work);void work.catch(error=>{errors.push(String(error.message));if(!response.headersSent)response.writeHead(500,{'Content-Type':'application/json'});response.end('{"ok":false,"error":"attendance_unavailable"}');}).finally(()=>inflight.delete(work));});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const address=server.address();assert(address&&typeof address==='object'&&address.address==='127.0.0.1');origin=`http://127.0.0.1:${address.port}`;
  const {chromium}=await import('playwright');const launch=chromium.launch({headless:true});void launch.then(value=>{if(closing)return value.close();}).catch(()=>{});browser=await bounded(launch,15000);
  context=await browser.newContext({serviceWorkers:'block',acceptDownloads:false,viewport:{width:390,height:900}});await context.route('**/*',async route=>{const r=route.request(),u=new URL(r.url());
   if(u.origin!==origin||!(statics.has(u.pathname)&&r.method()==='GET'&&!u.search||paths.has(u.pathname)&&(r.method()==='GET'||r.method()==='POST'&&u.pathname===periodEnterprisePaths.closure))){errors.push('external_or_unknown_request');return route.abort();}await route.continue();});
  page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('download',()=>errors.push('unexpected_download'));page.on('popup',()=>errors.push('unexpected_popup'));
  page.on('dialog',dialog=>{dialogs++;void(accept?dialog.accept():dialog.dismiss()).catch(e=>{if(!closing)errors.push(e.message);});});
  stage='employee_without_self_view';await page.goto(origin);await page.getByRole('button',{name:'我的受托周期',exact:true}).waitFor();await settle();assert.equal(requests.length,1);assert.equal(await page.getByRole('button',{name:'我的考勤',exact:true}).count(),0);
  assert(!model.actor('employee').permissions.includes('attendance.self.view'));await enter();assert.equal(requests.length,3);
  stage='real_workspace_read';await click(region().getByRole('button',{name:'读取受托周期列表',exact:true}),periodEnterprisePaths.closure,'list');await click(region().getByRole('button',{name:'读取受托保存版本',exact:true}),periodEnterprisePaths.closure,'detail');
  await page.locator('[data-period-closure-artifact]').waitFor();const reason=()=>region().getByRole('textbox',{name:'本次操作理由（1–500字符）',exact:true});await reason().fill('Synthetic235 browser explicit response');
  stage='one_post_unknown';const [posted]=await Promise.all([page.waitForResponse(r=>r.request().method()==='POST'),region().getByRole('button',{name:'回复周期事项',exact:true}).click()]);await posted.finished();await region().getByRole('button',{name:'只读核对原周期编号',exact:true}).waitFor();await settle();assert.equal(model.writes.length,1);
  const pending=await page.evaluate(()=>{const keys=Object.keys(sessionStorage).filter(k=>k.startsWith('faolla:attendance:period-delegated-closure:v1:'));if(keys.length!==1)throw Error('qa_one_pending');return{key:keys[0],raw:sessionStorage.getItem(keys[0])};});
  assert.deepEqual(JSON.parse(pending.raw).command,model.writes[0].command);assert.equal(JSON.parse(pending.raw).commandFingerprint,model.writes[0].receipt.commandFingerprint);
  stage='manager_registered_guard_cancel_accept';accept=false;let count=dialogs;assert.equal(await page.evaluate(()=>window.__periodEnterpriseHarness.navigate('todos')),false);assert.equal(dialogs,count+1);await region().waitFor();
  assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),pending.key),pending.raw);accept=true;count=dialogs;const todoResponse=page.waitForResponse(r=>new URL(r.url()).pathname===periodEnterprisePaths.todos);
  assert.equal(await page.evaluate(()=>window.__periodEnterpriseHarness.navigate('todos')),true);await(await todoResponse).finished();await settle();assert.equal(dialogs,count+1);assert.equal(await region().count(),0);assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),pending.key),pending.raw);
  stage='return_explicit_read_hidden';const beforeReturn=requests.length;assert.equal(await page.evaluate(()=>window.__periodEnterpriseHarness.navigate('overview')),true);await page.getByRole('button',{name:'我的受托周期',exact:true}).waitFor();await settle();assert.equal(requests.length,beforeReturn);await enter();
  await region().getByRole('button',{name:'只读核对原周期编号',exact:true}).waitFor();const beforeHide=requests.length;await page.evaluate(()=>window.__periodEnterpriseHarness.visibility(true));await page.evaluate(()=>window.__periodEnterpriseHarness.visibility(false));await settle();
  assert.equal(requests.length,beforeHide);assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),pending.key),pending.raw);
  stage='auth_late_minimum_receipt';await page.evaluate(()=>window.__periodEnterpriseHarness.holdNext());await region().getByRole('button',{name:'只读核对原周期编号',exact:true}).click();await page.waitForFunction(()=>window.__periodEnterpriseHarness.snapshot().held);
  await identity('other');await page.evaluate(()=>window.__periodEnterpriseHarness.release());await settle();assert.equal(await region().count(),0);assert.equal(await page.getByRole('button',{name:'我的受托周期',exact:true}).count(),0);assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),pending.key),pending.raw);
  stage='owner_actual_admin';await identity('owner');await page.getByRole('navigation',{name:'企业管理功能',exact:true}).waitFor();await click(page.getByRole('navigation',{name:'企业管理功能',exact:true}).getByRole('button',{name:'考勤配置',exact:true}),periodEnterprisePaths.admin);
  const launcher=page.getByRole('button',{name:'周期管理授权',exact:true});await launcher.waitFor();await page.getByLabel('企业考勤时区',{exact:true}).fill('Europe/Madrid');await settle();assert.equal(await launcher.isDisabled(),true);
  await page.getByLabel('企业考勤时区',{exact:true}).fill('UTC');await settle();assert.equal(await launcher.isDisabled(),false);await launcher.click();
  await click(page.getByRole('button',{name:'读取授权',exact:true}),periodEnterprisePaths.delegation,'list');await click(page.getByRole('button',{name:'核验详情',exact:true}),periodEnterprisePaths.delegation,'detail');
  assert.equal(await page.getByRole('button',{name:'打开受托周期工作区',exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'撤销授权',exact:true}).count(),1);assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),pending.key),pending.raw);
  stage='mobile_and_budgets';assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'qa_mobile_overflow');assert.equal(requests.filter(r=>r.method==='POST').length,1);assert.equal(model.writes.length,1);assert.deepEqual(errors,[]);
  assert(!requests.some(r=>r.identity==='employee'&&[periodEnterprisePaths.operations,periodEnterprisePaths.admin].includes(r.path)));
  report={groups:8,actualManager:true,actualOwnerAdmin:true,actualLauncherAndWorkspace:true,actualNextDynamic:true,syntheticAuth:true,actualSql:false,nextWholeSite:false,
   externalNavigation:'real Manager registered guard, driven by synthetic parent shell; not an internal tab click',ownerNavigation:'actual internal attendance configuration button',
   employeeHasSelfView:false,requests:requests.length,gets:requests.length-1,posts:1,totalHttp,syntheticCommittedRows:1,unknownPendingPreserved:true,lateAuthReceiptPreserved:true,
   hiddenPendingPreserved:true,ownerDraftBlocksLauncher:true,mobileWidth:390,horizontalOverflow:false,externalRequests:0,consoleErrors:0,diskBundles:false};
 }catch(error){failure=Error(`period_enterprise_browser_failed:${stage}:${String(error?.message??error)}:diagnostics=${JSON.stringify({errors,requests:requests.slice(-6)})}`,{cause:error});throw failure;}
 finally{closing=true;clearTimeout(timer);await runAttendanceCleanupSteps([
  {name:'enterprise held response',run:async()=>{if(page&&!page.isClosed())await page.evaluate(()=>window.__periodEnterpriseHarness?.release()).catch(()=>{});}},
  {name:'enterprise own context',run:()=>context?bounded(context.close(),6000):undefined},{name:'enterprise own browser',run:()=>browser?bounded(browser.close(),6000):undefined},
  {name:'enterprise HTTP work',run:()=>bounded(Promise.allSettled([...inflight]),6000)},
  {name:'enterprise own loopback listener',run:()=>{server?.closeAllConnections();return server?.listening?bounded(new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve())),6000):undefined;}},
  {name:'enterprise esbuild',run:async()=>{(await import('esbuild')).stop();}},
 ]).catch(error=>{if(failure)throw new AggregateError([failure,error],'period_enterprise_browser_and_cleanup_failed');throw error;});}
 assert(!browser?.isConnected()&&!server?.listening);return{...report,browserClosed:true,listenerStopped:true};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv.length===3&&process.argv[2]==='--run-local')console.log(JSON.stringify(await verifyPeriodEnterpriseBrowser()));
 else if(process.argv.length===2)console.log('Inert. Explicit local synthetic check: node --import tsx scripts/fixtures/attendance-period-enterprise-browser.mjs --run-local');
 else throw Error('explicit_run_local_only');
}
