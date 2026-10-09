//199 INERT unless --run-local. Actual React parents/Launcher/Workspace;
//synthetic current-viewer/API only, not real Auth, SQL or source authority.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {runAttendanceCleanupSteps} from './attendance-cleanup.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url)),require=createRequire(import.meta.url);
const api='/api/merchant-enterprise/attendance/day-reviews',admin='/api/merchant-enterprise/attendance/admin',selfApi='/api/merchant-enterprise/attendance/self';
export const dayReviewBrowserLimits=Object.freeze({ttlMs:180000,http:80,api:50,posts:3,groups:8});
export async function createDayReviewBrowserModel(){
 const f=require('./attendance-day-review-ui-model.ts'),p=require('../../src/lib/merchantAttendanceDayReviewContract.ts');
 const sourceParser=require('../../src/lib/merchantAttendanceDayReviewSource.ts'),savedParser=require('../../src/lib/merchantAttendanceDayReviewResult.ts');
 const ap=require('../../src/lib/merchantAttendanceAdmin.ts'),sp=require('../../src/lib/merchantAttendanceSelf.ts');
 const seed={siteId:f.dayUiSite,owner:f.dayUiOwner,self:f.dayUiSelf,employee:f.dayUiId(2),worker:f.dayUiWorker,other:f.dayUiId(99),history:f.dayUiId(400)},records=new Map(),cases=new Map(),history=[];
 let lost=true,recovery='valid',rich=false;
 const common=actor=>({protocol:p.DAY_REVIEW_PROTOCOL,siteId:seed.siteId,actorId:actor,readAt:f.dayUiAt});
 const head=entries=>{const initial=entries[0],latestDecision=entries.findLast(e=>e.action==='decide'),latest=entries.at(-1),latestSelf=latest.action==='decide'?null:latest;
  return{caseId:initial.receipt.caseId,target:cases.get(initial.receipt.caseId).target,openedAt:initial.receipt.recordedAt,revision:latest.receipt.revision,latestDecision,latestSelf,needsResponse:latestSelf!==null};};
 const historyTarget=f.dayUiHead().target;cases.set(seed.history,{target:historyTarget,entries:history});
 for(let n=1;n<=26;n++)history.push({...f.dayUiHead().latestDecision,reason:'Synthetic199 historical '+n,
  receipt:{...f.dayUiHead().latestDecision.receipt,caseId:seed.history,operationId:f.dayUiId(1000+n),revision:n}});
 function source(q){
  const existing=q.mode==='preview'&&q.caseId!==null?head(cases.get(q.caseId).entries):null;
  let value=structuredClone(f.dayUiSource(q.mode,false));
  if(q.mode==='preview'&&q.slotId!==null){const plan=value.input.source.plans.find(v=>v.slotId===q.slotId);assert(plan);
   value.input.target={...value.input.target,kind:'plan',slotId:plan.slotId,fromAt:plan.startAt,toAt:plan.endAt};value.input.source.plans=[plan];}
  if(existing){value.saved={...common(seed.owner),kind:'detail',access:'owner',head:existing,operation:null,replayed:false};
   value.input.source.caseHead=sourceParser.dayReviewClassificationHead(value.saved);value.sourceChanged=existing.latestDecision.sourceFingerprint!==value.input.source.fingerprint;}
  if(rich){const identity={workerId:seed.worker,employeeId:seed.employee,employeeAuthUserId:seed.self,locationId:f.dayUiId(5)};
   value.input.source.records=[0,1].map(n=>{const endpoints={startAt:`2026-10-07T0${8+n}:00:00.000000Z`,endAt:`2026-10-07T${10+n}:00:00.000000Z`};
    return{...identity,kind:'session',sourceId:f.dayUiId(50+n),operationId:null,revision:0,original:endpoints,selected:endpoints,association:{slotId:f.dayUiId(11),operationId:f.dayUiId(70+n)}};});
   value.input.source.pending=[{kind:'leave',sourceId:f.dayUiId(60),operationId:f.dayUiId(61),revision:1}];
   value.input.source.arrangements=[{requestId:f.dayUiId(62),operationId:f.dayUiId(63),revision:1,startAt:'2026-10-07T08:00:00.000000Z',endAt:'2026-10-07T12:00:00.000000Z'}];
   value.input.source.conflicts=[{kind:'records_overlap',sourceIds:[f.dayUiId(50),f.dayUiId(51)]}];}
  return sourceParser.parseDayReviewSourceView(value,q,seed.owner);
 }
 async function respond(url,method,text,actor){
  const u=new URL(url);assert([api,admin,selfApi].includes(u.pathname));assert(['GET','POST'].includes(method));
  if(u.pathname===admin){assert.equal(method,'GET');assert.equal(actor,seed.owner);const q=ap.parseAttendanceAdminQuery(u.href);assert.equal(q.siteId,seed.siteId);assert(['settings','workers'].includes(q.view));
   const data={ok:true,moduleEnabled:true,siteId:seed.siteId,version:1,view:q.view,settings:{timeZone:'Europe/Madrid',enabled:true,webClockEnabled:true,webBreakPaid:false},
    items:q.view==='workers'?[{id:seed.worker,employeeId:seed.employee,workerNo:'SYNTHETIC-199',displayName:'合成核查人员199',locationId:f.dayUiId(5),active:true,startsOn:'2026-01-01'}]:[],nextCursor:null,receipt:null};
   ap.parseAttendanceAdminResult(data,q);return{status:200,text:JSON.stringify(data)};}
  if(u.pathname===selfApi){assert.equal(method,'GET');assert.equal(actor,seed.self);assert.equal(u.searchParams.get('siteId'),seed.siteId);assert.equal([...u.searchParams.keys()].length,1);
   const data={ok:true,moduleEnabled:true,workerId:seed.worker,locationId:f.dayUiId(5),state:{sequence:0,status:'off',lastEvent:null},receipt:null,replayed:false};
   sp.parseAttendanceSelfResult(data,{siteId:seed.siteId,command:null,operationId:null});return{status:200,text:JSON.stringify(data)};}
  let query,command=null;if(method==='POST')({query,command}=p.parseDayReviewBody(p.parseDayReviewJson(text)));else query=p.parseDayReviewHttpQuery(u.href);
  assert.equal(query.siteId,seed.siteId);assert([seed.owner,seed.self].includes(actor));if(query.mode!=='recover')assert.equal(actor,query.access==='owner'?seed.owner:seed.self);
  let data;
  if(command){assert(!records.has(command.operationId),'unexpected_duplicate_POST');const caseId=command.action==='decide'?command.caseId:query.caseId;
   let saved=cases.get(caseId);assert.equal(command.expectedRevision,saved?.entries.length??0);
   if(command.action==='decide'){const view=source(query);if(!saved){saved={target:view.input.target,entries:[]};cases.set(caseId,saved);}assert.equal(command.expectedFingerprint,view.input.source.fingerprint);}
   assert(saved);const receipt={operationId:command.operationId,caseId,revision:command.expectedRevision+1,action:command.action,actorId:actor,recordedAt:f.dayUiAt,
    commandFingerprint:createHash('sha256').update(p.dayReviewCommandFingerprintText(query,actor,command)).digest('hex')};
   const entry=command.action==='decide'?{receipt,action:'decide',reason:command.reason,outcome:command.outcome,sourceFingerprint:command.expectedFingerprint,observations:['no_record'],calendarReference:command.calendarReference,selfStatementOperationId:command.selfStatementOperationId}
    :{receipt,action:command.action,reason:command.reason,decisionOperationId:command.decisionOperationId,claim:command.claim};
   saved.entries.push(entry);records.set(command.operationId,entry);data={...common(actor),kind:'receipt',receipt,replayed:false};
   savedParser.parseDayReviewSavedResult(data,query,actor,{command,fingerprint:receipt.commandFingerprint});
  }else if(query.mode==='recover'){const entry=records.get(query.operationId);assert(entry&&entry.receipt.actorId===actor,'unknown_original_actor');
   data={...common(actor),kind:'receipt',receipt:recovery==='null'?null:recovery==='foreign'?{...entry.receipt,actorId:seed.other}:entry.receipt,replayed:true};
   if(recovery==='valid')savedParser.parseDayReviewSavedResult(data,query,actor);
  }else if(query.mode==='candidates'||query.mode==='preview')data=source(query);
  else if(query.mode==='list'){const items=[...cases.values()].map(v=>head(v.entries)).sort((a,b)=>(b.openedAt+b.caseId).localeCompare(a.openedAt+a.caseId));
   data={...common(actor),kind:'list',access:query.access,items,nextCursor:null};
  }else{const saved=cases.get(query.caseId);assert(saved);const h=head(saved.entries);
   if(query.mode==='detail')data={...common(actor),kind:'detail',access:query.access,head:h,operation:null,replayed:false};
   else{assert.equal(query.mode,'history');const all=saved.entries.toReversed().filter(e=>query.beforeRevision===null||e.receipt.revision<query.beforeRevision),items=all.slice(0,25);
    data={...common(actor),kind:'history',access:query.access,head:h,items,nextRevision:all.length>25?items.at(-1).receipt.revision:null};}}
  if(query.mode!=='candidates'&&query.mode!=='preview'&&!command&&query.mode!=='recover')savedParser.parseDayReviewSavedResult(data,query,actor);
  const lose=command&&lost;if(lose)lost=false;return{status:200,text:lose?'{"ok":':JSON.stringify({ok:true,data}),query,command};
 }
 return{seed,records,cases,history,respond,recovery:value=>{assert(['valid','null','foreign'].includes(value));recovery=value;},rich:value=>{rich=value;}};
}
async function bounded(work,ms=12000){let timer;try{return await Promise.race([work,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('day_review_browser_deadline')),ms);})]);}finally{clearTimeout(timer);}}
async function assets(seed){
 const{build}=await import('esbuild'),{compile}=await import('@tailwindcss/node'),{default:ts}=await import('typescript');
 const bundle=await build({absWorkingDir:root,entryPoints:['scripts/fixtures/attendance-day-review-browser-entry.tsx'],bundle:true,write:false,metafile:true,platform:'browser',format:'esm',target:['es2020'],jsx:'automatic',tsconfig:path.join(root,'tsconfig.json'),outfile:'qa.js',logLevel:'warning',
  define:{'process.env':'{}','process.env.NODE_ENV':'"development"','process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_DAY_REVIEWS_ENABLED':'"1"',__DAY_SEED__:JSON.stringify(seed)}});
 const candidates=new Set();for(const name of Object.keys(bundle.metafile.inputs)){assert(!/node:crypto|\.server\.ts$/.test(name));if(!/\.tsx?$/.test(name)||name.includes('node_modules'))continue;
  const ast=ts.createSourceFile(name,await readFile(path.join(root,name),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);const visit=n=>{if(ts.isStringLiteral(n)||ts.isNoSubstitutionTemplateLiteral(n)||ts.isTemplateHead(n)||ts.isTemplateMiddle(n)||ts.isTemplateTail(n))n.text.split(/\s+/).filter(Boolean).forEach(v=>candidates.add(v));ts.forEachChild(n,visit);};visit(ast);}
 const css=(await compile('@import "tailwindcss";',{base:root,onDependency:()=>{}})).build([...candidates])+'body{margin:0;background:#f8fafc;font-family:Arial,sans-serif}.qa-main{max-width:1100px;margin:auto;min-width:0}';
 return{js:bundle.outputFiles.find(f=>f.path.endsWith('.js')).contents,css};
}
export async function verifyDayReviewBrowser(){
 const started=Date.now(),model=await createDayReviewBrowserModel(),requests=[],errors=[],inflight=new Set();let totalHttp=0,posts=0,server,browser,context,page,origin,files,closing=false,failure,report,stage='setup',accept=true;
 const timer=setTimeout(()=>{closing=true;void context?.close().catch(()=>{});server?.closeAllConnections();},dayReviewBrowserLimits.ttlMs);
 const button=name=>page.getByRole('button',{name,exact:true}),region=()=>page.getByRole('region',{name:'出勤情况核查',exact:true});
 const settle=async()=>{await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));await bounded(Promise.allSettled([...inflight]));};
 const click=async(name,method='GET',within=page)=>{const[r]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname===api&&r.request().method()===method),within.getByRole('button',{name,exact:true}).click()]);await r.finished();assert.equal(r.status(),200,await r.text());await settle();};
 const configure=async v=>{await page.evaluate(v=>window.__dayHarness.configure(v),v);await settle();};
 const pending=()=>page.evaluate(()=>Object.entries(sessionStorage).filter(([key])=>key.startsWith('faolla:attendance:day-reviews:v1:')));
 const fill=async reason=>{await page.getByLabel('出勤核查理由',{exact:true}).fill(reason);await page.getByRole('checkbox',{name:/我确认以上固定范围与理由/}).check();};
 const open=async(access='owner')=>{await button(access==='owner'?'出勤情况核查／历史与恢复':'我的出勤核查与说明').click();await region().waitFor();await settle();};
 const listCard=text=>page.getByText(text,{exact:true}).locator('..').locator('..').locator('..');
 const selectHistory=async()=>{await click('读取已保存核查');await click('读取此核查详情','GET',listCard('Synthetic199 historical 26'));};
 const overflow=async()=>assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'390px_overflow');
 try{
  files=await bounded(assets(model.seed),45000);server=createServer((req,res)=>{const work=(async()=>{assert(!closing);assert(++totalHttp<=dayReviewBrowserLimits.http);assert.equal(req.headers.host,new URL(origin).host);const u=new URL(req.url,origin);
   res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Security-Policy',"default-src 'none';script-src 'self';style-src 'self' 'unsafe-inline';connect-src 'self';img-src 'self';base-uri 'none';form-action 'none';frame-ancestors 'none'");
   if(['/', '/qa.js','/qa.css','/favicon.ico'].includes(u.pathname)){assert.equal(req.method,'GET');assert.equal(u.search,'');if(u.pathname==='/favicon.ico')return res.writeHead(204).end();const html='<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="/favicon.ico"><link rel="stylesheet" href="/qa.css"><div id="qa-root"></div><script type="module" src="/qa.js"></script></html>';
    return res.writeHead(200,{'Content-Type':u.pathname==='/'?'text/html;charset=utf-8':u.pathname==='/qa.js'?'text/javascript;charset=utf-8':'text/css;charset=utf-8'}).end(u.pathname==='/'?html:u.pathname==='/qa.js'?files.js:files.css);}
   assert([api,admin,selfApi].includes(u.pathname));assert(requests.length<dayReviewBrowserLimits.api);if(req.method==='POST')assert(++posts<=dayReviewBrowserLimits.posts);let text='',bytes=0;for await(const chunk of req){bytes+=chunk.length;assert(bytes<=8192);text+=chunk.toString('utf8');}
   const result=await model.respond(u.href,req.method,text,req.headers['x-synthetic-actor']);requests.push({path:u.pathname,method:req.method,query:result.query,action:result.command?.action});res.writeHead(result.status,{'Content-Type':'application/json;charset=utf-8'}).end(result.text);
  })();inflight.add(work);void work.catch(error=>{errors.push(error.message);if(!res.headersSent)res.writeHead(500,{'Content-Type':'application/json'});res.end('{"ok":false}');}).finally(()=>inflight.delete(work));});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const address=server.address();assert(address&&typeof address==='object'&&address.address==='127.0.0.1');origin=`http://127.0.0.1:${address.port}`;
  const{chromium}=await import('playwright'),launch=chromium.launch({headless:true});void launch.then(b=>{if(closing)return b.close();}).catch(()=>{});browser=await bounded(launch,15000);context=await browser.newContext({serviceWorkers:'block',acceptDownloads:false,viewport:{width:390,height:900}});
  await context.route('**/*',async route=>{const r=route.request(),u=new URL(r.url());if(u.origin!==origin||!(['/', '/qa.js','/qa.css','/favicon.ico'].includes(u.pathname)&&r.method()==='GET'&&!u.search||[api,admin,selfApi].includes(u.pathname)&&['GET','POST'].includes(r.method()))){errors.push('external_or_unknown_request');return route.abort();}await route.continue();});
  page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('popup',()=>errors.push('popup'));page.on('download',()=>errors.push('download'));page.on('dialog',d=>void(accept?d.accept():d.dismiss()).catch(()=>{}));
  stage='actual_admin_parent_draft_inert';await page.goto(origin);await button('打开负责人合成父入口').waitFor();assert.equal(requests.length,0);await button('打开负责人合成父入口').click();await page.getByLabel('企业考勤时区',{exact:true}).waitFor();await settle();
  await page.getByLabel('企业考勤时区',{exact:true}).fill('UTC');accept=false;assert.equal(await page.evaluate(()=>window.__dayHarness.leave()),false);accept=true;assert.equal(posts,0);await page.getByLabel('企业考勤时区',{exact:true}).fill('Europe/Madrid');
  await button('考勤人员').click();await button('出勤情况核查／历史与恢复').waitFor();const idle=requests.length;await open();await settle();assert.equal(requests.length,idle);
  stage='full_day_background_and_plan_draft';model.rich(true);await page.getByLabel('出勤核查日期',{exact:true}).fill('2026-10-07');await click('读取完整本日来源');assert.match(await region().innerText(),/停业事项/);assert.match(await region().innerText(),/请假待审/);assert.match(await region().innerText(),/获批工作安排/);assert.match(await region().innerText(),/工作记录重叠/);await overflow();
  model.rich(false);await click('读取完整本日来源');assert.match(await region().innerText(),/未发现记录，待本人说明（不等于未工作）/);assert.equal(await button('核查此完整排班').count(),2);await click('核查此完整排班','GET',button('核查此完整排班').first().locator('..'));
  assert.equal(await page.locator('option').filter({hasText:'据本人说明，经负责人核对为未工作（条件不足）'}).count(),1);await fill('Synthetic199 owner decision');accept=false;await button('关闭出勤核查').click();assert.equal(await page.getByLabel('出勤核查理由',{exact:true}).inputValue(),'Synthetic199 owner decision');await button('明确提交一次').click();await settle();assert.equal(posts,0);accept=true;
  stage='unknown_post_flagoff_original_get';await click('明确提交一次','POST');const original=await pending();assert.equal(original.length,1);assert.equal(posts,1);const ownerCase=[...model.records.values()][0].receipt.caseId;
  await configure({mode:'isolated',enabled:false});await open();for(const fault of ['null','foreign']){model.recovery(fault);await click('仅 GET 核验原编号');assert.deepEqual(await pending(),original);}model.recovery('valid');await click('仅 GET 核验原编号');assert.equal((await pending()).length,0);assert.equal(posts,1);
  stage='saved_case_plan_identity_and_history';await click('读取已保存核查');await click('读取此核查详情','GET',listCard('Synthetic199 owner decision'));await click('重新核验此固定范围');assert.equal(requests.at(-1).query.caseId,ownerCase);
  await click('核查此完整排班');assert.equal(requests.at(-1).query.caseId,ownerCase);assert.match(await region().innerText(),/新决定开关关闭/);await selectHistory();await click('读取保存历史');assert.equal(await page.getByText(/^Synthetic199 historical /).count(),26);await click('读取更早25条历史');assert.equal(await page.getByText(/^Synthetic199 historical /).count(),2);await overflow();
  stage='actual_self_parent_and_statement';await configure({mode:'self',actor:model.seed.self,access:'self',enabled:true});await button('我的出勤核查与说明').waitFor();await open('self');await click('读取已保存核查');await click('读取此核查详情','GET',listCard('Synthetic199 owner decision'));await fill('Synthetic199 self statement');await click('明确提交一次','POST');assert.equal(posts,2);assert.equal((await pending()).length,1);await click('仅 GET 核验原编号');assert.equal((await pending()).length,0);
  stage='hidden_late_post_original_preserved';await click('读取已保存核查');await click('读取此核查详情','GET',listCard('Synthetic199 self statement'));await page.getByRole('combobox',{name:/^本人回应/}).selectOption('dispute');await fill('Synthetic199 delayed dispute');await page.evaluate(()=>window.__dayHarness.hold('POST'));await click('明确提交一次','POST');await page.waitForFunction(()=>window.__dayHarness.held());const late=await pending();assert.equal(late.length,1);const beforeHide=requests.filter(r=>r.path===api).length;
  await page.evaluate(()=>window.__dayHarness.visibility(true));assert.equal(await page.getByText('Synthetic199 self statement',{exact:true}).count(),0);assert.equal(await page.getByLabel('出勤核查理由',{exact:true}).count(),0);await page.evaluate(()=>window.__dayHarness.authValid(false));assert.equal(await region().count(),0);
  await configure({mode:'isolated',actor:model.seed.other,access:'self'});await page.evaluate(()=>window.__dayHarness.release());await settle();assert.deepEqual(await pending(),late);
  await page.evaluate(()=>window.__dayHarness.visibility(false));await page.evaluate(()=>window.__dayHarness.authValid(true));await settle();assert.equal(requests.filter(r=>r.path===api).length,beforeHide);
  await configure({mode:'self',actor:model.seed.self,access:'self'});await open('self');await click('仅 GET 核验原编号');assert.equal((await pending()).length,0);assert.equal(posts,3);
  stage='late_get_requester_and_stable_auth';await page.evaluate(()=>window.__dayHarness.hold('GET'));await click('读取已保存核查');await page.waitForFunction(()=>window.__dayHarness.held());await configure({requester:1});await page.evaluate(()=>window.__dayHarness.release());await settle();assert.equal(await page.getByText('Synthetic199 delayed dispute',{exact:true}).count(),0);await button('读取已保存核查').waitFor();await click('读取已保存核查');await click('读取此核查详情','GET',listCard('Synthetic199 delayed dispute'));await fill('Synthetic199 private draft');await page.evaluate(()=>window.__dayHarness.authValid(false));assert.equal(await region().count(),0);assert.equal(await page.getByText('Synthetic199 delayed dispute',{exact:true}).count(),0);
  stage='mobile_close_no_background_retry';await page.evaluate(()=>window.__dayHarness.authValid(true));await open('self');await selectHistory();await click('读取保存历史');await overflow();const done=requests.length;accept=false;await button('关闭出勤核查').click();accept=true;await settle();assert.equal(await region().count(),0);assert.equal(requests.length,done);assert.deepEqual(errors,[]);
  report={groups:8,actualAdminParent:true,actualSelfParent:true,actualLauncher:true,actualWorkspace:true,actualAuth:false,actualSql:false,mockedData:true,
   syntheticViewerProps:true,membershipRequests:0,posts,gets:requests.filter(r=>r.method==='GET').length,apiRequests:requests.length,totalHttp,syntheticHistoryEntries:26,historyPages:[25,1],
   parentDraftGuard:true,exactOriginalRecovery:true,flagoffRecovery:true,wrongReceiptRetains:true,savedCaseIdPreserved:true,hiddenClearsBody:true,lateAuthPreservesPending:true,
   requesterInvalidatesBody:true,stableAuthFalseSuppressesBody:true,noAutomaticDayReviewHttp:true,mobileWidth:390,horizontalOverflow:false,externalRequests:0,diskBundle:false,elapsedMs:Date.now()-started};
 }catch(error){failure=Error(`day_review_browser_failed:${stage}:${error.message}:${JSON.stringify({errors,requests:requests.slice(-5)})}`,{cause:error});throw failure;}
 finally{closing=true;clearTimeout(timer);await runAttendanceCleanupSteps([{name:'held body',run:async()=>{if(page&&!page.isClosed())await page.evaluate(()=>window.__dayHarness?.release()).catch(()=>{});}},
  {name:'owned context',run:()=>context?bounded(context.close(),6000):undefined},{name:'owned browser',run:()=>browser?bounded(browser.close(),6000):undefined},{name:'HTTP work',run:()=>bounded(Promise.allSettled([...inflight]),6000)},
  {name:'owned listener',run:()=>{server?.closeAllConnections();return server?.listening?bounded(new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve())),6000):undefined;}},{name:'esbuild',run:async()=>{(await import('esbuild')).stop();}}]).catch(error=>{if(failure)throw new AggregateError([failure,error],'day_review_browser_cleanup_failed');throw error;});assert(!browser?.isConnected()&&!server?.listening);
  if(failure)console.error(JSON.stringify({cleanup:'day-review-browser',browserClosed:!browser?.isConnected(),listenerStopped:!server?.listening,apiRequests:requests.length,totalHttp}));}
 return{...report,browserClosed:true,listenerStopped:true};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv.length===3&&process.argv[2]==='--run-local')console.log(JSON.stringify(await verifyDayReviewBrowser()));
 else if(process.argv.length===2)console.log('Inert. node --import tsx scripts/fixtures/attendance-day-review-browser.mjs --run-local');else throw Error('explicit_run_local_only');
}
