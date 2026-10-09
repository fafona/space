// INERT unless --run-local. Memory-only wire model; no database or real Auth.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {runAttendanceCleanupSteps} from './attendance-cleanup.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url)),require=createRequire(import.meta.url);
const endpoints=['self','pin','onsite'].map(channel=>`/api/merchant-enterprise/attendance/operational-punch-${channel}`);
export const punchBrowserLimits=Object.freeze({ttlMs:180000,http:70,api:25});
export async function createPunchBrowserModel(){
 const f=require('../../src/lib/merchantAttendanceOperationalPunchTestFixtures.ts'),p=require('../../src/lib/merchantAttendanceOperationalPunch.ts');
 const qr=require('../../src/lib/merchantAttendanceOnsiteQr.ts');
 const base=await f.punchStartFixture(true),seed={siteId:f.punchSite,auth:f.punchId(3),other:f.punchId(90),worker:f.punchId(1),employee:f.punchId(2),terminal:f.punchId(91)};
 const policies=Object.fromEntries(await Promise.all(['self','pin','onsite'].map(async channel=>[channel,{...base.policy,policyFingerprint:await p.operationalPunchPolicyFingerprint(seed.siteId,channel,base.policy,base.source)}])));
 let state={sequence:0,status:'off',lastEvent:null},session=null,tokenSerial=800;const records=new Map(),writes=[],credentialChecks=[],tokens=new Map();
 const syntheticPin='24681357';
 // Synthetic decoder-compatible tokens only: the zero signature is NOT an HMAC.
 const issueToken=(expired=false)=>{const issuedAtMs=Date.now()-(expired?60000:0),claims=qr.parseOnsiteClaims({v:1,purpose:'faolla.attendance.onsite',siteId:seed.siteId,terminalId:seed.terminal,
  locationId:base.policy.locationId,pairedAtMs:issuedAtMs-1000,issuedAtMs,expiresAtMs:issuedAtMs+qr.ONSITE_QR_LIFETIME_MS,nonce:f.punchId(++tokenSerial)});
  const token='aq1.'+Buffer.from(JSON.stringify(claims)).toString('base64url')+'.'+Buffer.alloc(32).toString('base64url');tokens.set(token,{claims,used:false});return token;};
 const prepared=channel=>({...base.result,channel,clock:{...base.result.clock,state,receipt:null,replayed:false,...(channel==='self'?{}:{employeeId:seed.employee}),
  ...(channel==='pin'?{siteId:seed.siteId,terminalId:seed.terminal,workerNo:'qa-worker',workerName:'Synthetic PIN worker',canStart:true,canFinish:true,blockReason:null}:{})},policy:state.status==='off'?policies[channel]:null,session:state.status==='off'?null:session,
  operation:null,association:null,adoption:null,replayed:false,canStart:state.status==='off',canBreak:state.status==='working',canFinish:state.status!=='off'});
 async function respond(url,method,text){
  const u=new URL(url);assert(endpoints.includes(u.pathname));const channel=u.pathname.slice(u.pathname.lastIndexOf('-')+1);let query,command=null,token=null;
  const rejected=(code,status)=>({channel,query,command,status,text:JSON.stringify({ok:false,error:{code,message:code}})});
  if(method==='POST'){const b=p.parseOperationalPunchJson(text,'request');assert.deepEqual(Object.keys(b).sort(),(channel==='pin'?['workerNo','pin','command','query']:['command','query','siteId',...(channel==='onsite'?['token']:[])]).sort());
   query=p.parseOperationalPunchQuery(b.query);command=b.command===null?null:p.parseOperationalPunchCommand(b.command,channel,seed.siteId);
   if(channel==='pin'){const valid=b.workerNo==='qa-worker'&&b.pin===syntheticPin;credentialChecks.push({channel,mode:query.mode,write:command!==null,valid});if(!valid)return rejected('attendance_pin_denied',403);}
   else{assert.equal(b.siteId,seed.siteId);assert(command);if(channel==='onsite')token=b.token;}
  }else{assert.equal(method,'GET');assert.notEqual(channel,'pin');assert.equal(u.searchParams.get('siteId'),seed.siteId);query=p.parseOperationalPunchQuery(Object.fromEntries([...u.searchParams].filter(([k])=>k!=='siteId')));}
  let data,lost=false;
  if(command){assert.equal(query.mode,'recover');assert.equal(query.operationId,command.clock.operationId);assert(!records.has(query.operationId),'unexpected_duplicate_POST');
   if(channel==='onsite'){const issued=tokens.get(token),valid=!!issued&&!issued.used&&issued.claims.expiresAtMs>Date.now();credentialChecks.push({channel,mode:query.mode,write:true,valid});
    if(!issued)return rejected('attendance_qr_invalid',400);if(issued.used)return rejected('attendance_qr_used',409);if(issued.claims.expiresAtMs<=Date.now())return rejected('attendance_qr_expired',409);issued.used=true;}
   const c=command.clock;assert.equal(c.expectedSequence,state.sequence);const sequence=state.sequence+1,at=`2026-10-08T12:00:${String(sequence).padStart(2,'0')}.123000Z`;
   const event={...base.result.clock.receipt,id:f.punchId(100+sequence),operationId:c.operationId,action:c.action,sequence,occurredAt:at.slice(0,23)+'Z',breakPaid:c.action==='break_start'?command.choice.breakType==='paid':null};
   if(c.action==='clock_in'){assert.equal(command.choice.expectedPolicyFingerprint,policies[channel].policyFingerprint);assert.equal(command.choice.selection,null);
    session={...base.session,channel,actorAuthUserId:channel==='pin'?null:seed.auth,policyFingerprint:policies[channel].policyFingerprint,startEventId:event.id,operationId:c.operationId,startSequence:sequence,occurredAt:at};session.sessionFingerprint=await p.operationalPunchSessionFingerprint(seed.siteId,session);}
   if(c.action==='break_start'){assert.equal(command.choice.startEventId,session.startEventId);assert.equal(command.choice.expectedSessionFingerprint,session.sessionFingerprint);assert(['paid','unpaid'].includes(command.choice.breakType));}
   state={sequence,status:c.action==='clock_out'?'off':c.action==='break_start'?'break':'working',lastEvent:event};
   const operation={...base.result.operation,channel,actorAuthUserId:channel==='pin'?null:seed.auth,operationId:c.operationId,eventId:event.id,action:c.action,startEventId:session.startEventId,sequence,recordedAt:at,sessionFingerprint:session.sessionFingerprint,
    commandFingerprint:await p.operationalPunchCommandFingerprint(seed.siteId,channel,channel==='pin'?null:seed.auth,{workerId:seed.worker,employeeId:seed.employee,employeeAuthUserId:seed.auth},command),breakPaid:event.breakPaid};
   data={...prepared(channel),readAt:at,policy:null,session:c.action==='clock_in'?session:null,clock:{...prepared(channel).clock,receipt:event},operation,canStart:false,canBreak:false,canFinish:false};
   records.set(c.operationId,{command,data});writes.push(command);lost=c.action==='clock_in';
  }else if(query.mode==='prepare'){data={...prepared(channel),readAt:'2026-10-08T12:01:00.123000Z'};}
  else{const saved=records.get(query.operationId);assert(saved,'synthetic_receipt_not_found');assert.equal(saved.data.channel,channel);data={...saved.data,readAt:'2026-10-08T12:01:00.123000Z',clock:{...saved.data.clock,state},policy:null,session:null,choices:null,association:null,adoption:null};}
  const input={...base.input,channel,authUserId:channel==='pin'?null:seed.auth,query,command,write:command!==null,...(channel==='pin'?{terminalId:seed.terminal,workerNo:'qa-worker',expectedWorkerId:seed.worker,expectedEmployeeId:seed.employee}:{})};await p.parseOperationalPunchResult(data,input);
  return{channel,query,command,status:200,text:lost?'{"ok":':JSON.stringify({ok:true,data})};
 }
 return{seed,respond,writes,records,syntheticPin,issueToken,credentialChecks};
}
async function bounded(promise,ms=12000){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('punch_browser_deadline')),ms);})]);}finally{clearTimeout(timer);}}
async function assets(seed){
 const{build}=await import('esbuild'),{compile}=await import('@tailwindcss/node'),{default:ts}=await import('typescript');
 const bundle=await build({absWorkingDir:root,entryPoints:['scripts/fixtures/attendance-operational-punch-browser-entry.tsx'],bundle:true,write:false,metafile:true,platform:'browser',format:'esm',target:['es2020'],jsx:'automatic',tsconfig:path.join(root,'tsconfig.json'),outfile:'qa.js',logLevel:'warning',define:{'process.env':'{}','process.env.NODE_ENV':'"development"',__PUNCH_SEED__:JSON.stringify(seed)}});
 const candidates=new Set();for(const name of Object.keys(bundle.metafile.inputs)){assert(!/node:crypto|\.server\.ts$/.test(name),'server_import');if(!/\.tsx?$/.test(name)||name.includes('node_modules'))continue;
  const ast=ts.createSourceFile(name,await readFile(path.join(root,name),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);const visit=n=>{if(ts.isStringLiteral(n)||ts.isNoSubstitutionTemplateLiteral(n)||ts.isTemplateHead(n)||ts.isTemplateMiddle(n)||ts.isTemplateTail(n))n.text.split(/\s+/).filter(Boolean).forEach(v=>candidates.add(v));ts.forEachChild(n,visit);};visit(ast);}
 const css=(await compile('@import "tailwindcss";',{base:root,onDependency:()=>{}})).build([...candidates])+'body{margin:0;background:#f8fafc;font-family:Arial,sans-serif}.qa-main{max-width:1200px;margin:auto;min-width:0}';
 return{js:bundle.outputFiles.find(f=>f.path.endsWith('.js')).contents,css};
}
export async function verifyOperationalPunchBrowser(){
 const started=Date.now(),model=await createPunchBrowserModel(),requests=[],errors=[],inflight=new Set();
 let totalHttp=0,server,browser,context,page,origin,files,closing=false,stage='setup',failure,report;
 const timer=setTimeout(()=>{closing=true;void context?.close().catch(()=>{});server?.closeAllConnections();},punchBrowserLimits.ttlMs);
 const button=name=>page.getByRole('button',{name,exact:true});
 const settle=async()=>{await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));await bounded(Promise.allSettled([...inflight]));};
 const click=async(name,method='GET',channel='self')=>{const[response]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname===`/api/merchant-enterprise/attendance/operational-punch-${channel}`&&r.request().method()===method),button(name).click()]);await response.finished();assert.equal(response.status(),200,await response.text());await settle();};
 const open=async()=>{await button('规则打卡／原号核对').click();await button('读取本次规则与状态').waitFor();await settle();};
 try{
  files=await bounded(assets(model.seed),45000);
  server=createServer((req,res)=>{const work=(async()=>{assert(!closing);assert(++totalHttp<=punchBrowserLimits.http);assert.equal(req.headers.host,new URL(origin).host);const u=new URL(req.url,origin);
   res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Security-Policy',"default-src 'none';script-src 'self';style-src 'self' 'unsafe-inline';img-src 'self';connect-src 'self';base-uri 'none';form-action 'none';frame-ancestors 'none'");
   if(['/', '/qa.js','/qa.css','/favicon.ico'].includes(u.pathname)){assert.equal(req.method,'GET');assert.equal(u.search,'');if(u.pathname==='/favicon.ico')return res.writeHead(204).end();const html='<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="/favicon.ico"><link rel="stylesheet" href="/qa.css"><div id="qa-root"></div><script type="module" src="/qa.js"></script></html>';
    return res.writeHead(200,{'Content-Type':u.pathname==='/'?'text/html;charset=utf-8':u.pathname==='/qa.js'?'text/javascript;charset=utf-8':'text/css;charset=utf-8'}).end(u.pathname==='/'?html:u.pathname==='/qa.js'?files.js:files.css);}
   assert(endpoints.includes(u.pathname));assert(requests.length<punchBrowserLimits.api);let text='',bytes=0;for await(const chunk of req){bytes+=chunk.length;assert(bytes<=4096);text+=chunk.toString('utf8');}
   const value=await model.respond(u.href,req.method,text);requests.push({channel:value.channel,method:req.method,query:value.query,action:value.command?.clock.action});res.writeHead(value.status,{'Content-Type':'application/json;charset=utf-8'}).end(value.text);
  })();inflight.add(work);void work.catch(e=>{errors.push(e.message);if(!res.headersSent)res.writeHead(500,{'Content-Type':'application/json'});res.end('{"ok":false}');}).finally(()=>inflight.delete(work));});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const address=server.address();assert(address&&typeof address==='object'&&address.address==='127.0.0.1');origin=`http://127.0.0.1:${address.port}`;
  const{chromium}=await import('playwright');const launch=chromium.launch({headless:true});void launch.then(b=>{if(closing)return b.close();}).catch(()=>{});browser=await bounded(launch,15000);context=await browser.newContext({serviceWorkers:'block',acceptDownloads:false,viewport:{width:390,height:900}});
  await context.route('**/*',async route=>{const r=route.request(),u=new URL(r.url());if(u.origin!==origin||!(['/', '/qa.js','/qa.css','/favicon.ico'].includes(u.pathname)&&r.method()==='GET'&&!u.search||endpoints.includes(u.pathname)&&['GET','POST'].includes(r.method()))){errors.push('external_or_unknown_request');return route.abort();}await route.continue();});
  page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('popup',()=>errors.push('popup'));page.on('download',()=>errors.push('download'));page.on('dialog',d=>void d.accept().catch(e=>{if(!closing)errors.push(e.message);}));
  stage='shared_host_zero_initial';await page.goto(origin);await button('规则打卡／原号核对').waitFor();await settle();assert.equal(requests.length,0);await open();assert.equal(requests.length,0);assert.equal(await page.getByRole('region',{name:'合成旧入口占位'}).count(),0);
  stage='explicit_start_and_lost_reply';await click('读取本次规则与状态');assert.equal(await button('确认规则上班').isEnabled(),false);await page.getByLabel('本次排班关联',{exact:true}).selectOption('none');await click('确认规则上班','POST');await button('核对原操作结果（不重发）').waitFor();assert.equal(model.writes.length,1);
  const saved=await page.evaluate(()=>Object.entries(sessionStorage).filter(([k])=>k.startsWith('faolla:attendance:operational-punch:v1:')));assert.equal(saved.length,1);assert.deepEqual(JSON.parse(saved[0][1]).command,model.writes[0]);assert.equal(await button('返回原打卡入口').isEnabled(),false);
  await page.reload();await button('核对原操作结果（不重发）').waitFor();const beforeRecovery=requests.length;await settle();assert.equal(requests.length,beforeRecovery);await click('核对原操作结果（不重发）');assert.equal(await page.evaluate(k=>sessionStorage.getItem(k),saved[0][0]),null);assert.equal(model.writes.length,1);
  stage='fixed_explicit_breaks';for(const value of ['paid','unpaid']){await click('读取本次规则与状态');assert.equal(await button('确认开始休息').isEnabled(),false);await page.getByLabel('本次休息类型',{exact:true}).selectOption(value);await click('确认开始休息','POST');await click('读取本次规则与状态');await click('确认结束休息','POST');}
  stage='flagoff_finish';await page.evaluate(()=>window.__punchHarness.configure({enabled:false}));await click('读取本次规则与状态');assert.equal(await button('确认下班').isEnabled(),true);await click('确认下班','POST');assert.equal(model.writes.length,6);await click('读取本次规则与状态');await page.getByLabel('本次排班关联',{exact:true}).selectOption('none');assert.equal(await button('确认规则上班').isEnabled(),false);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'390_overflow');
  stage='hidden_auth_late_body';await page.evaluate(()=>window.__punchHarness.hold());await button('读取本次规则与状态').click();await page.waitForFunction(()=>window.__punchHarness.held());await page.evaluate(()=>window.__punchHarness.visibility(true));await page.evaluate(()=>window.__punchHarness.configure({other:true}));await page.evaluate(()=>{window.__punchHarness.release();window.__punchHarness.visibility(false);});await settle();assert.equal(await page.getByText('已确认：',{exact:false}).count(),0);assert.equal(await page.getByLabel('本次排班关联',{exact:true}).count(),0);
  stage='pin_memory_scope_and_hidden';await page.evaluate(()=>window.__punchHarness.configure({pin:true,other:false}));await open();await page.getByLabel('规则打卡 PIN',{exact:true}).fill('12345678');await page.evaluate(()=>window.__punchHarness.visibility(true));assert.equal(await page.getByLabel('规则打卡 PIN',{exact:true}).inputValue(),'');await page.evaluate(()=>window.__punchHarness.visibility(false));await page.getByLabel('规则打卡 PIN',{exact:true}).fill('87654321');await page.evaluate(()=>window.__punchHarness.configure({other:true}));await open();assert.equal(await page.getByLabel('规则打卡 PIN',{exact:true}).inputValue(),'');
  assert.deepEqual(model.writes.map(c=>c.clock.action),['clock_in','break_start','break_end','break_start','break_end','clock_out']);
  const pendingRows=()=>page.evaluate(()=>Object.entries(sessionStorage).filter(([k])=>k.startsWith('faolla:attendance:operational-punch:v1:')));
  const assertNoSecrets=async secrets=>{const stored=await page.evaluate(()=>JSON.stringify([Object.entries(sessionStorage),Object.entries(localStorage)]));
   for(const secret of secrets)assert(!stored.includes(secret),'credential_persisted');for(const [,raw] of await pendingRows()){const parsed=JSON.parse(raw);assert.deepEqual(Object.keys(parsed).sort(),['command','scope','version']);assert.deepEqual(Object.keys(parsed.command).sort(),['choice','clock']);}};
  stage='PIN_prepare_and_actual_component_reverification';await page.evaluate(()=>window.__punchHarness.configure({enabled:true,other:false,pin:true,onsite:false}));await open();
  const noPin=requests.length;await button('读取本次规则与状态').click();await settle();assert.equal(requests.length,noPin);assert.equal(await page.getByLabel('本次排班关联',{exact:true}).count(),0);
  await page.getByLabel('规则打卡 PIN',{exact:true}).fill(model.syntheticPin);await click('读取本次规则与状态','POST','pin');assert.equal(await page.getByLabel('规则打卡 PIN',{exact:true}).inputValue(),'');
  assert.equal(await button('确认规则上班').isEnabled(),false);await page.getByLabel('本次排班关联',{exact:true}).selectOption('none');await click('确认规则上班','POST','pin');
  await button('核对原操作结果（不重发）').waitFor();const pinPending=await pendingRows();assert.equal(pinPending.length,1);assert.equal(JSON.parse(pinPending[0][1]).scope.channel,'pin');
  assert.deepEqual(model.credentialChecks.filter(x=>x.channel==='pin').map(x=>[x.mode,x.write,x.valid]),[['prepare',false,true],['recover',true,true]]);await assertNoSecrets([model.syntheticPin]);
  const noRecoveryPin=requests.length;await button('核对原操作结果（不重发）').click();await settle();assert.equal(requests.length,noRecoveryPin);
  await page.getByLabel('规则打卡 PIN',{exact:true}).fill(model.syntheticPin);await click('核对原操作结果（不重发）','POST','pin');assert.equal((await pendingRows()).length,0);
  await page.getByLabel('规则打卡 PIN',{exact:true}).fill(model.syntheticPin);await click('读取本次规则与状态','POST','pin');await click('确认下班','POST','pin');
  assert.equal(model.credentialChecks.filter(x=>x.channel==='pin'&&x.valid).length,5);assert.equal((await pendingRows()).length,0);await assertNoSecrets([model.syntheticPin]);
  stage='onsite_selection_fresh_code_consumed_expired_and_recovery';await page.evaluate(()=>window.__punchHarness.configure({pin:false,onsite:true,other:false}));await open();
  await click('读取本次规则与状态','GET','onsite');await page.getByLabel('本次排班关联',{exact:true}).selectOption('none');assert.equal(await button('确认规则上班').isEnabled(),false);
  const freshCode=model.issueToken();await page.evaluate(value=>window.__punchHarness.scan(value),freshCode);assert.equal(await page.getByLabel('本次排班关联',{exact:true}).inputValue(),'none');
  await click('确认规则上班','POST','onsite');await button('核对原操作结果（不重发）').waitFor();assert.equal(await page.evaluate(()=>window.__punchHarness.consumed()),1);
  assert.equal(await button('核对后按原编号重试').isEnabled(),false,'consumed code cannot be reused');await assertNoSecrets([model.syntheticPin,freshCode]);
  await page.evaluate(()=>window.__punchHarness.scan(null));await click('核对原操作结果（不重发）','GET','onsite');assert.equal((await pendingRows()).length,0);
  await click('读取本次规则与状态','GET','onsite');assert.equal(await button('确认下班').isEnabled(),false);
  const expiredCode=model.issueToken(true);await page.evaluate(value=>window.__punchHarness.scan(value),expiredCode);const beforeExpired=requests.length;
  await button('确认下班').click();await button('核对原操作结果（不重发）').waitFor();await settle();assert.equal(requests.length,beforeExpired,'expired token must not reach HTTP');
  const expiredPending=await pendingRows();assert.equal(expiredPending.length,1);assert.equal(JSON.parse(expiredPending[0][1]).command.clock.action,'clock_out');
  assert.equal(await page.evaluate(()=>window.__punchHarness.consumed()),1);await assertNoSecrets([expiredCode,freshCode]);
  const secondCode=model.issueToken();await page.evaluate(value=>window.__punchHarness.scan(value),secondCode);await click('核对后按原编号重试','POST','onsite');assert.equal((await pendingRows()).length,0);
  assert.equal(model.writes.at(-1).clock.operationId,JSON.parse(expiredPending[0][1]).command.clock.operationId);assert.equal(await page.evaluate(()=>window.__punchHarness.consumed()),2);
  await assertNoSecrets([model.syntheticPin,freshCode,expiredCode,secondCode]);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'390_credentials_overflow');
  assert.deepEqual(errors,[]);assert.equal(model.writes.length,10);assert.equal(requests.filter(r=>r.channel==='pin').length,5);assert.equal(requests.filter(r=>r.channel==='onsite').length,5);
  report={groups:8,actualSharedHost:true,actualSharedWorkspace:true,legacyHostPlaceholder:true,syntheticAuth:true,actualSql:false,actualPinVerification:false,actualTokenHmac:false,
   syntheticPinCredentialChecks:5,syntheticOnsiteCredentialChecks:2,onsiteExpiredBlockedBeforeHttp:true,onsiteConsumedNotReused:true,onsiteRecoveryWithoutToken:true,credentialStorage:false,
   gets:requests.filter(r=>r.method==='GET').length,posts:requests.filter(r=>r.method==='POST').length,businessWrites:model.writes.length,apiRequests:requests.length,totalHttp,loss:'truncated JSON after synthetic commit',newPendingReload:true,explicitPaidAndUnpaid:true,noAutomaticPost:true,mobileWidth:390,horizontalOverflow:false,externalRequests:0,consoleErrors:0,diskBundle:false,port:new URL(origin).port,elapsedMs:Date.now()-started};
 }catch(error){failure=Error(`punch_browser_failed:${stage}:${error.message}:${JSON.stringify({errors,requests:requests.slice(-4)})}`,{cause:error});throw failure;}
 finally{closing=true;clearTimeout(timer);await runAttendanceCleanupSteps([{name:'held body',run:async()=>{if(page&&!page.isClosed())await page.evaluate(()=>window.__punchHarness?.release()).catch(()=>{});}},
  {name:'owned context',run:()=>context?bounded(context.close(),6000):undefined},{name:'owned browser',run:()=>browser?bounded(browser.close(),6000):undefined},
  {name:'HTTP work',run:()=>bounded(Promise.allSettled([...inflight]),6000)},{name:'owned listener',run:()=>{server?.closeAllConnections();return server?.listening?bounded(new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve())),6000):undefined;}},
  {name:'esbuild',run:async()=>{(await import('esbuild')).stop();}}]).catch(error=>{if(failure)throw new AggregateError([failure,error],'punch_browser_cleanup_failed');throw error;});assert(!browser?.isConnected()&&!server?.listening);
  if(failure)console.error(JSON.stringify({cleanup:'punch-browser',browserClosed:!browser?.isConnected(),listenerStopped:!server?.listening,port:origin?new URL(origin).port:null,apiRequests:requests.length,totalHttp}));}
 return{...report,browserClosed:true,listenerStopped:true};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv.length===3&&process.argv[2]==='--run-local')console.log(JSON.stringify(await verifyOperationalPunchBrowser()));
 else if(process.argv.length===2)console.log('Inert. node --import tsx scripts/fixtures/attendance-operational-punch-browser.mjs --run-local');
 else throw Error('explicit_run_local_only');
}
