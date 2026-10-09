//196 INERT unless --run-local. Four finite actual React browser scenarios.
//All cookie, credentials, API and data are explicitly synthetic; no real Auth.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {runAttendanceCleanupSteps} from './attendance-cleanup.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url)),require=createRequire(import.meta.url);
const api='/api/merchant-enterprise/attendance/independent-terminal',deviceApi='/api/merchant-enterprise/attendance/terminal-device';
export const independentTerminalBrowserLimits=Object.freeze({groups:4,ttlMs:180000,http:35,api:20,posts:12,mobileWidth:390});
export async function createIndependentTerminalBrowserModel(){
 const p=require('../../src/lib/merchantAttendanceIndependent.ts'),f=require('./attendance-independent-ui-model.ts'),t=require('../../src/lib/merchantAttendanceTerminal.ts');
 const id=f.independentUiId,siteId=f.independentUiSite,terminalId=id(50),workerNo='LOCAL-01',readAt=f.independentUiReadAt,records=new Map();
 const subject={subjectId:id(2),workerId:id(3),workerNo,displayName:'Synthetic196 独立员工',generation:0,workerVersion:3,credentialId:id(60),credentialRevision:1,settingsVersion:1,locationId:id(4),locationVersion:1,timeZone:'UTC'};
 const terminal={id:terminalId,label:'Synthetic196 已配对终端',locationId:id(4),locationName:'Synthetic196 地点',timeZone:'UTC',state:'active',createdAt:'2026-10-08T08:00:00.000Z',pairExpiresAt:'2026-10-08T08:05:00.000Z',pairedAt:'2026-10-08T08:01:00.000Z',deviceExpiresAt:'2026-11-07T08:01:00.000Z',revokedAt:null};
 let head={sequence:0,status:'off',lastEventId:null,lastAction:null,lastAt:null},hide=false,lose=false;
 const envelope=data=>({protocol:p.INDEPENDENT_TERMINAL_PROTOCOL,siteId,terminalId,readAt,data});
 const paired={ok:true,paired:true,moduleEnabled:true,siteId,terminal,attendanceEnabled:true,clockEnabled:false};t.parseTerminalDevice({siteId,terminal,attendanceEnabled:true,clockEnabled:false});
 async function respond(url,method,text){const u=new URL(url);assert.equal(u.search,'');
  if(u.pathname===deviceApi){assert.equal(method,'GET');return{status:200,text:JSON.stringify(paired),kind:'device'};}
  assert.equal(u.pathname,api);assert.equal(method,'POST');const b=p.parseIndependentTerminalBody(p.parseIndependentJson(text,true));assert.equal(b.siteId,siteId);assert.equal(b.terminalId,terminalId);assert.equal(b.workerNo,workerNo);assert.equal(b.pin,'12345678');let data;
  if(b.request.kind==='state')data={kind:'state',subject,head};
  else if(b.request.kind==='clock'){
   const c=b.request.command;assert(!records.has(c.operationId),'duplicate_clock_POST');assert.equal(c.expectedSequence,head.sequence);assert.equal(c.subjectId,subject.subjectId);assert.equal(c.workerId,subject.workerId);
   const allowed=head.status==='off'?['clock_in']:head.status==='break'?['break_end']:['break_start','clock_out'];assert(allowed.includes(c.action));
   const commandFingerprint=createHash('sha256').update(p.independentClockCommandText(siteId,terminalId,c)).digest('hex'),at='2026-10-08T09:00:00.000001Z';
   const event={id:id(1000+records.size),operationId:c.operationId,sequence:c.expectedSequence+1,action:c.action,locationId:c.locationId,occurredAt:at,receivedAt:at,timeZone:'UTC',breakPaid:c.breakPaid,source:'kiosk',actorEmployeeId:null};
   const receipt={operationId:c.operationId,command:c,commandFingerprint,event,source:{subjectId:c.subjectId,generation:c.generation,credentialId:c.credentialId,credentialRevision:c.credentialRevision,credentialIssueOperationId:id(61),terminalId,workerVersion:c.expectedWorkerVersion,settingsVersion:c.expectedSettingsVersion,locationVersion:c.expectedLocationVersion,commandFingerprint}};
   records.set(c.operationId,receipt);head={sequence:event.sequence,status:c.action==='clock_out'?'off':c.action==='break_start'?'break':'working',lastEventId:event.id,lastAction:event.action,lastAt:at};data={kind:'clock',subject,head,receipt};
  }else if(b.request.kind==='recover'){data={kind:'receipt',receipt:hide?null:records.get(b.request.operationId)??null};}
  else{assert.equal(b.request.fromDate,'2026-10-08');assert.equal(b.request.throughDate,'2026-10-08');assert.equal(b.request.cursor,null);
   data={kind:'personal',report:{protocol:p.INDEPENDENT_RAW_PROTOCOL,siteId,subjectId:subject.subjectId,workerId:subject.workerId,workerNo,displayName:subject.displayName,timeZone:'UTC',fromDate:b.request.fromDate,throughDate:b.request.throughDate,
    fromAt:'2026-10-08T00:00:00.000000Z',toAt:'2026-10-09T00:00:00.000000Z',readAt,items:[],nextCursor:null,pageComplete:true,rangeComplete:true,rulesAssessment:'unassessed',fixedPeriodEligible:false}};}
  const result=envelope(data);await p.parseIndependentTerminalResult(result,b);const lost=b.request.kind==='clock'&&lose;if(lost)lose=false;
  return{status:200,text:lost?'{"ok":':JSON.stringify({ok:true,data:result}),kind:b.request.kind,action:b.request.kind==='clock'?b.request.command.action:null};
 }
 return{seed:{siteId,terminalId,workerNo},records,respond,hideReceipt:v=>{hide=v;},loseNextClock:()=>{lose=true;},working:()=>{head={sequence:10,status:'working',lastEventId:id(900),lastAction:'clock_in',lastAt:'2026-10-08T08:00:00.000001Z'};}};
}
async function bounded(work,ms=12000){let timer;try{return await Promise.race([work,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('independent_terminal_browser_deadline')),ms);})]);}finally{clearTimeout(timer);}}
async function assets(){
 const{build}=await import('esbuild'),{compile}=await import('@tailwindcss/node'),{default:ts}=await import('typescript');
 const bundle=await build({absWorkingDir:root,entryPoints:['scripts/fixtures/attendance-independent-terminal-browser-entry.tsx'],bundle:true,write:false,metafile:true,platform:'browser',format:'esm',target:['es2020'],jsx:'automatic',tsconfig:path.join(root,'tsconfig.json'),outfile:'qa.js',logLevel:'warning',
  define:{'process.env':'{}','process.env.NODE_ENV':'"development"','process.env.FAOLLA_ATTENDANCE_INDEPENDENT_WORKERS_ENABLED':'"1"'}});
 const candidates=new Set();for(const name of Object.keys(bundle.metafile.inputs)){assert(!/node:crypto|\.server\.ts$/.test(name));if(!/\.tsx?$/.test(name)||name.includes('node_modules'))continue;const ast=ts.createSourceFile(name,await readFile(path.join(root,name),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);const visit=n=>{if(ts.isStringLiteral(n)||ts.isNoSubstitutionTemplateLiteral(n)||ts.isTemplateHead(n)||ts.isTemplateMiddle(n)||ts.isTemplateTail(n))n.text.split(/\s+/).filter(Boolean).forEach(v=>candidates.add(v));ts.forEachChild(n,visit);};visit(ast);}
 const css=(await compile('@import "tailwindcss";',{base:root,onDependency:()=>{}})).build([...candidates])+'body{margin:0;background:#f8fafc;font-family:Arial,sans-serif}';return{js:bundle.outputFiles.find(f=>f.path.endsWith('.js')).contents,css};
}
export async function verifyIndependentTerminalBrowser(){
 const started=Date.now(),model=await createIndependentTerminalBrowserModel(),requests=[],errors=[],inflight=new Set();let totalHttp=0,posts=0,server,browser,context,page,origin,files,closing=false,report,failure,stage='setup';
 const timer=setTimeout(()=>{closing=true;void context?.close().catch(()=>{});server?.closeAllConnections();},independentTerminalBrowserLimits.ttlMs);
 const button=name=>page.getByRole('button',{name,exact:true}),settle=async()=>{await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));await bounded(Promise.allSettled([...inflight]));};
 const click=async(name,pathname=api,method='POST')=>{const[r]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname===pathname&&r.request().method()===method),button(name).click()]);await r.finished();assert.equal(r.status(),200,await r.text());await settle();};
 const pin=async()=>page.getByLabel('本次操作的本人 PIN',{exact:true}).fill('12345678');
 const no=async()=>page.getByLabel('本人考勤工号',{exact:true}).fill(model.seed.workerNo);
 const pending=()=>page.evaluate(()=>Object.entries(sessionStorage).filter(([key])=>key.startsWith('faolla:attendance:independent-terminal:v1:')));
 const ready=async()=>{await click('检查已配对设备',deviceApi,'GET');await no();await pin();await click('验证并读取当前状态');};
 const mount=async flagoff=>{await page.evaluate(v=>window.__independentTerminalHarness.mount(v),flagoff);await button('检查已配对设备').waitFor();await settle();};
 const recover=async()=>{await no();await pin();await click('只读核对原编号（不重新打卡）');};
 try{
  files=await bounded(assets(),45000);server=createServer((req,res)=>{const task=(async()=>{assert(!closing);assert(++totalHttp<=independentTerminalBrowserLimits.http);assert.equal(req.headers.host,new URL(origin).host);const u=new URL(req.url,origin);res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Security-Policy',"default-src 'none';script-src 'self';style-src 'self' 'unsafe-inline';connect-src 'self';img-src 'self';base-uri 'none';form-action 'none';frame-ancestors 'none'");
   if(['/', '/qa.js','/qa.css','/favicon.ico'].includes(u.pathname)){assert.equal(req.method,'GET');assert.equal(u.search,'');if(u.pathname==='/favicon.ico')return res.writeHead(204).end();const html='<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="/favicon.ico"><link rel="stylesheet" href="/qa.css"><div id="qa-root"></div><script type="module" src="/qa.js"></script></html>';return res.writeHead(200,{'Content-Type':u.pathname==='/'?'text/html;charset=utf-8':u.pathname==='/qa.js'?'text/javascript;charset=utf-8':'text/css;charset=utf-8'}).end(u.pathname==='/'?html:u.pathname==='/qa.js'?files.js:files.css);}
   assert([api,deviceApi].includes(u.pathname));assert(requests.length<independentTerminalBrowserLimits.api);assert.equal(req.headers.cookie,'synthetic196paired=not-a-real-device-secret');if(req.method==='POST')assert(++posts<=independentTerminalBrowserLimits.posts);
   let text='',bytes=0;for await(const chunk of req){bytes+=chunk.length;assert(bytes<=8192);text+=chunk.toString('utf8');}const value=await model.respond(u.href,req.method,text);requests.push({path:u.pathname,method:req.method,kind:value.kind,action:value.action});res.writeHead(value.status,{'Content-Type':'application/json;charset=utf-8'}).end(value.text);
  })();inflight.add(task);void task.catch(e=>{errors.push(e.message);if(!res.headersSent)res.writeHead(500,{'Content-Type':'application/json'});res.end('{"ok":false}');}).finally(()=>inflight.delete(task));});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const address=server.address();assert(address&&typeof address==='object'&&address.address==='127.0.0.1');origin=`http://127.0.0.1:${address.port}`;
  const{chromium}=await import('playwright'),launch=chromium.launch({headless:true});void launch.then(b=>{if(closing)return b.close();}).catch(()=>{});browser=await bounded(launch,15000);context=await browser.newContext({serviceWorkers:'block',acceptDownloads:false,viewport:{width:390,height:900}});
  await context.addCookies([{name:'synthetic196paired',value:'not-a-real-device-secret',url:origin,httpOnly:true,sameSite:'Strict'}]);
  await context.route('**/*',async route=>{const r=route.request(),u=new URL(r.url());if(u.origin!==origin||!(['/', '/qa.js','/qa.css','/favicon.ico'].includes(u.pathname)&&r.method()==='GET'&&!u.search||u.pathname===api&&r.method()==='POST'&&!u.search||u.pathname===deviceApi&&r.method()==='GET'&&!u.search)){errors.push('external_or_unknown_request');return route.abort();}await route.continue();});
  page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('popup',()=>errors.push('popup'));page.on('download',()=>errors.push('download'));page.on('dialog',d=>void d.accept().catch(()=>{}));
  stage='actual_page_empty_then_one_clock_and_original_read';await page.goto(origin);await button('检查已配对设备').waitFor();await settle();assert.equal(requests.length,0);assert.equal(await page.evaluate(()=>document.cookie),'');await ready();await pin();await click('确认上班');assert.equal(await page.getByLabel('本次操作的本人 PIN',{exact:true}).inputValue(),'');assert.equal((await pending()).length,1);assert.equal(model.records.size,1);await recover();assert.equal((await pending()).length,0);
  stage='lost_reply_remount_null_then_exact_original';await pin();await click('验证并读取当前状态');model.loseNextClock();await pin();await click('确认下班');const original=await pending();assert.equal(original.length,1);await mount(false);const inert=requests.length;await settle();assert.equal(requests.length,inert);await click('检查已配对设备',deviceApi,'GET');model.hideReceipt(true);await recover();assert.deepEqual(await pending(),original);model.hideReceipt(false);await recover();assert.equal((await pending()).length,0);assert.equal(model.records.size,2);
  stage='flagoff_working_safe_finish_no_newstart';model.working();await mount(true);await ready();await pin();assert.equal(await button('确认开始休息').isDisabled(),true);await click('确认下班');assert.equal((await pending()).length,1);await recover();assert.equal((await pending()).length,0);
  stage='raw_personal_bounds_visibility_and_mobile';await mount(true);await ready();await page.getByLabel('开始日期',{exact:true}).fill('2026-10-08');await page.getByLabel('结束日期',{exact:true}).fill('2026-11-08');await pin();const beforeInvalid=requests.length;await button('重新验证 PIN 并查询当前页').click();await settle();assert.equal(requests.length,beforeInvalid);await page.getByLabel('结束日期',{exact:true}).fill('2026-10-08');await pin();await click('重新验证 PIN 并查询当前页');await page.getByText('当前范围没有班次。',{exact:true}).waitFor();await pin();const beforeHide=requests.length;await page.evaluate(()=>window.__independentTerminalHarness.hide(true));assert.equal(await page.getByLabel('本次操作的本人 PIN',{exact:true}).inputValue(),'');assert.equal(await page.getByText('当前范围没有班次。',{exact:true}).count(),0);await page.evaluate(()=>window.__independentTerminalHarness.hide(false));await settle();assert.equal(requests.length,beforeHide);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);
  assert.equal(posts,12);assert.equal(requests.length,16);report={groups:4,actualPanel:true,actualPageComponent:true,sourceOnlyNextRoute:true,syntheticCookie:true,actualAuth:false,actualSql:false,kdf:0,initialApiRequests:0,originalRecoveryOnly:true,nullKeepsPending:true,lostReplyKeepsPending:true,flagoffSafeEnd:true,rawPersonal:true,hiddenClearsBodyAndPin:true,mobileWidth:390,horizontalOverflow:false,posts,apiRequests:requests.length,totalHttp,externalRequests:0,diskBundle:false,elapsedMs:Date.now()-started};
 }catch(e){failure=Error(`independent_terminal_browser_failed:${stage}:${e.message}:${JSON.stringify({errors,requests})}`,{cause:e});throw failure;}
 finally{closing=true;clearTimeout(timer);await runAttendanceCleanupSteps([{name:'owned context',run:()=>context?bounded(context.close(),6000):undefined},{name:'owned browser',run:()=>browser?bounded(browser.close(),6000):undefined},{name:'HTTP work',run:()=>bounded(Promise.allSettled([...inflight]),6000)},{name:'owned listener',run:()=>{server?.closeAllConnections();return server?.listening?bounded(new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve())),6000):undefined;}},{name:'esbuild',run:async()=>{(await import('esbuild')).stop();}}]).catch(e=>{if(failure)throw new AggregateError([failure,e],'independent_terminal_browser_cleanup_failed');throw e;});assert(!browser?.isConnected()&&!server?.listening);if(failure)console.error(JSON.stringify({cleanup:'independent-terminal-browser',browserClosed:!browser?.isConnected(),listenerStopped:!server?.listening,apiRequests:requests.length,totalHttp}));}
 return{...report,browserClosed:true,listenerStopped:true};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv.length===3&&process.argv[2]==='--run-local')console.log(JSON.stringify(await verifyIndependentTerminalBrowser()));
 else if(process.argv.length===2)console.log('Inert. node --import tsx scripts/fixtures/attendance-independent-terminal-browser.mjs --run-local');else throw Error('explicit_run_local_only');
}
