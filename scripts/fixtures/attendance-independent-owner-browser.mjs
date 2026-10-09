//196 INERT unless --run-local. Actual owner components, synthetic HTTP/Auth.
//The26 historical sessions/52 receipts are UI fixtures, not SQL-created facts.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {runAttendanceCleanupSteps} from './attendance-cleanup.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url)),require=createRequire(import.meta.url);
const api='/api/merchant-enterprise/attendance/independent',admin='/api/merchant-enterprise/attendance/admin';
export const independentOwnerBrowserLimits=Object.freeze({groups:4,ttlMs:180000,http:60,api:35,posts:6,mobileWidth:390});
export async function createIndependentOwnerBrowserModel(){
 const p=require('../../src/lib/merchantAttendanceIndependent.ts'),f=require('./attendance-independent-ui-model.ts'),ap=require('../../src/lib/merchantAttendanceAdmin.ts');
 const id=f.independentUiId,seed={siteId:f.independentUiSite,owner:f.independentUiOwner,location:f.independentUiLocationId,member:id(11),memberAuth:id(12),other:id(99),disableSubject:id(31),revokeSubject:id(32)};
 const records=new Map(),subjects=new Map(),history=[];let created=null,lost=true,hideReceipt=false;
 const emptyHead=()=>({sequence:0,status:'off',lastEventId:null,lastAction:null,lastAt:null});
 const absent=()=>({credentialId:null,revision:0,enabled:false,generation:null,changedAt:null});
 const common=()=>f.independentUiAdmin({kind:'receipt'});
 // Separate explicit preseed identities: disable revokes its credential, so a
 // different real fixture identity is needed for the revoke control. No reset.
 for(const [n,subjectId,label] of [[31,seed.disableSubject,'停用专用合成员工'],[32,seed.revokeSubject,'撤销专用合成员工']]){
  const subject={...f.independentUiSubject(),subjectId,workerId:id(n+10),workerNo:'SAFE-'+n,displayName:label,enabled:true,revision:3,workerVersion:3,createdAt:'2026-10-08T06:00:00.000001Z'};
  subjects.set(subjectId,{subject,credential:{credentialId:id(n+20),revision:1,enabled:true,generation:0,changedAt:'2026-10-08T07:00:00.000001Z'},head:emptyHead(),binding:null});
 }
 const detail=entry=>({kind:'detail',...structuredClone(entry)});
 async function prepareHistory(entry,issueOperationId){
  assert.equal(history.length,0);const s=entry.subject,c=entry.credential,terminal=id(50);
  for(let n=0;n<52;n++){
   const action=n%2===0?'clock_in':'clock_out',operationId=id(1000+n),at=`2026-10-08T10:${String(n).padStart(2,'0')}:00.000001Z`;
   const command={operationId,subjectId:s.subjectId,workerId:s.workerId,generation:s.generation,credentialId:c.credentialId,credentialRevision:c.revision,
    expectedWorkerVersion:s.workerVersion,expectedSettingsVersion:1,locationId:s.locationId,expectedLocationVersion:1,expectedSequence:n,action,breakPaid:null};
   const commandFingerprint=createHash('sha256').update(p.independentClockCommandText(seed.siteId,terminal,command)).digest('hex');
   const event={id:id(2000+n),operationId,sequence:n+1,action,locationId:s.locationId,occurredAt:at,receivedAt:at,timeZone:'UTC',breakPaid:null,source:'kiosk',actorEmployeeId:null};
   const receipt={operationId,command,commandFingerprint,event,source:{subjectId:s.subjectId,generation:s.generation,credentialId:c.credentialId,credentialRevision:c.revision,
    credentialIssueOperationId:issueOperationId,terminalId:terminal,workerVersion:s.workerVersion,settingsVersion:1,locationVersion:1,commandFingerprint}};
   await p.parseIndependentClockReceipt(receipt,seed.siteId,terminal,f.independentUiReadAt);
   if(n%2===0)history.push({startEventId:event.id,endEventId:null,complete:false,events:[receipt]});
   else{const shift=history.at(-1);shift.endEventId=event.id;shift.complete=true;shift.events.push(receipt);}
  }
  const last=history.at(-1).events.at(-1).event;entry.head={sequence:52,status:'off',lastEventId:last.id,lastAction:last.action,lastAt:last.occurredAt};
 }
 async function respond(url,method,text,actor){
  const u=new URL(url);assert([api,admin].includes(u.pathname));assert.equal(actor,seed.owner,'synthetic_original_owner_only');
  if(u.pathname===admin){assert.equal(method,'GET');const q=ap.parseAttendanceAdminQuery(u.href);assert.equal(q.siteId,seed.siteId);assert.equal(q.view,'settings');
   const data={ok:true,moduleEnabled:true,siteId:seed.siteId,version:1,view:q.view,settings:{timeZone:'Europe/Madrid',enabled:true,webClockEnabled:true,webBreakPaid:false},items:[],nextCursor:null,receipt:null};
   ap.parseAttendanceAdminResult(data,q);return{status:200,text:JSON.stringify(data),query:q};}
  let query,command=null,pin=null;if(method==='POST')({query,command,pin=null}=p.parseIndependentOwnerBody(p.parseIndependentJson(text,true)));else{assert.equal(method,'GET');query=p.parseIndependentHttpQuery(u.href);}
  assert.equal(query.siteId,seed.siteId);let data;
  if(command){
   assert(!records.has(command.operationId),'unexpected_duplicate_owner_POST');assert.equal(command.expectedSettingsVersion,1);let entry=subjects.get(command.subjectId);
   if(command.action==='create'){
    assert(!entry);assert.equal(command.locationId,seed.location);assert.equal(created,null);
    entry={subject:{...f.independentUiSubject(),subjectId:command.subjectId,workerId:command.workerId,workerNo:command.workerNo,displayName:command.displayName,startsOn:command.startsOn,locationId:command.locationId},credential:absent(),head:emptyHead(),binding:null};
    created=command.subjectId;subjects.set(command.subjectId,entry);
   }else{
    assert(entry);const s=entry.subject,c=entry.credential;assert.equal(s.state,'independent');assert.equal(command.expectedSubjectRevision,s.revision);assert.equal(command.expectedGeneration,s.generation);assert.equal(command.expectedWorkerVersion,s.workerVersion);
    if('expectedCredentialRevision'in command)assert.equal(command.expectedCredentialRevision,c.revision);
    s.revision++;s.workerVersion++;
    if(command.action==='enable')s.enabled=true;
    else if(command.action==='issue_pin'){assert.equal(pin,'12345678');assert(s.enabled);Object.assign(c,{credentialId:id(60),revision:c.revision+1,enabled:true,generation:s.generation,changedAt:'2026-10-08T08:02:00.000001Z'});await prepareHistory(entry,command.operationId);}
    else{
     s.generation++;if(c.revision!==0)c.revision++;c.enabled=false;if(c.revision!==0)c.changedAt='2026-10-08T15:00:00.000001Z';
     if(command.action==='disable')s.enabled=false;
     if(command.action==='bind_member'){
      assert.equal(command.targetEmployeeId,seed.member);assert.equal(command.targetAuthUserId,seed.memberAuth);assert.equal(entry.head.status,'off');
      assert.equal(command.expectedLastEventId,entry.head.lastEventId);assert.equal(command.expectedSequence,entry.head.sequence);
      s.state='bound';s.enabled=false;entry.binding={protocol:p.INDEPENDENT_BINDING_PROTOCOL,siteId:seed.siteId,workerId:s.workerId,subjectId:s.subjectId,
       bindingOperationId:command.operationId,employeeId:seed.member,employeeAuthUserId:seed.memberAuth,workerVersion:s.workerVersion,generation:s.generation,
       lastIndependentEventId:entry.head.lastEventId,lastSequence:entry.head.sequence,boundAt:'2026-10-08T15:00:00.000001Z'};
     }
    }
   }
   const s=entry.subject,c=entry.credential,recordedAt=command.action==='create'?'2026-10-08T08:00:00.000001Z':command.action==='enable'?'2026-10-08T08:01:00.000001Z':command.action==='issue_pin'?'2026-10-08T08:02:00.000001Z':'2026-10-08T15:00:00.000001Z';
   const receipt={operationId:command.operationId,subjectId:s.subjectId,workerId:s.workerId,action:command.action,actorId:actor,subjectRevision:s.revision,generation:s.generation,workerVersion:s.workerVersion,
    credentialRevision:['create','enable'].includes(command.action)?null:c.revision,recordedAt,commandFingerprint:await p.independentAdminCommandFingerprint(seed.siteId,actor,command)};
   data={...common(),receipt};records.set(command.operationId,{command:structuredClone(command),receipt});
  }else if(query.mode==='recover'){const saved=records.get(query.operationId);assert(saved);assert.equal(saved.receipt.actorId,actor);assert.equal(saved.receipt.subjectId,query.subjectId);data={...common(),receipt:hideReceipt?null:saved.receipt};}
  else if(query.mode==='list')data=f.independentUiAdmin({kind:'list',items:[...subjects.values()].map(e=>structuredClone(e.subject)).filter(s=>query.state==='all'||s.state===query.state).sort((a,b)=>a.subjectId.localeCompare(b.subjectId)),nextCursor:null});
  else if(query.mode==='locations')data=f.independentUiAdmin({kind:'locations',items:[{locationId:seed.location,name:'合成真实候选地点',timeZone:'UTC'}],nextCursor:null});
  else if(query.mode==='members')data=f.independentUiAdmin({kind:'members',items:[{employeeId:seed.member,authUserId:seed.memberAuth,displayName:'经核实的合成企业账号'}],nextCursor:null});
  else if(query.mode==='detail'){assert(subjects.has(query.subjectId));data=f.independentUiAdmin(detail(subjects.get(query.subjectId)));}
  else{assert.equal(query.mode,'history');assert.equal(query.subjectId,created);assert.equal(query.fromDate,'2026-10-08');assert.equal(query.throughDate,'2026-10-08');const entry=subjects.get(created),s=entry.subject;
   const start=query.cursor===null?0:history.findIndex(h=>h.startEventId===query.cursor)+1;assert(start>=0);const items=structuredClone(history.slice(start,start+25));
   const nextCursor=start+25<history.length?items.at(-1).startEventId:null;
   data=f.independentUiAdmin({kind:'history',report:{protocol:p.INDEPENDENT_RAW_PROTOCOL,siteId:seed.siteId,subjectId:s.subjectId,workerId:s.workerId,workerNo:s.workerNo,displayName:s.displayName,timeZone:'UTC',fromDate:query.fromDate,throughDate:query.throughDate,
    fromAt:'2026-10-08T00:00:00.000000Z',toAt:'2026-10-09T00:00:00.000000Z',readAt:f.independentUiReadAt,items,nextCursor,pageComplete:true,rangeComplete:query.cursor===null&&nextCursor===null,rulesAssessment:'unassessed',fixedPeriodEligible:false}});}
  await p.parseIndependentAdminResult(data,query,actor,command);const lose=command&&lost;if(lose)lost=false;
  return{status:200,text:lose?'{"ok":':JSON.stringify({ok:true,data}),query,command};
 }
 return{seed,subjects,records,history,respond,hideReceipt:value=>{hideReceipt=value;},createdSubject:()=>created};
}
async function bounded(work,ms=12000){let timer;try{return await Promise.race([work,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('independent_owner_browser_deadline')),ms);})]);}finally{clearTimeout(timer);}}
async function assets(seed){
 const{build}=await import('esbuild'),{compile}=await import('@tailwindcss/node'),{default:ts}=await import('typescript');
 const bundle=await build({absWorkingDir:root,entryPoints:['scripts/fixtures/attendance-independent-owner-browser-entry.tsx'],bundle:true,write:false,metafile:true,platform:'browser',format:'esm',target:['es2020'],jsx:'automatic',tsconfig:path.join(root,'tsconfig.json'),outfile:'qa.js',logLevel:'warning',
  define:{'process.env':'{}','process.env.NODE_ENV':'"development"','process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_INDEPENDENT_WORKERS_ENABLED':'"1"',__INDEPENDENT_OWNER_SEED__:JSON.stringify(seed)}});
 const candidates=new Set();for(const name of Object.keys(bundle.metafile.inputs)){assert(!/node:crypto|\.server\.ts$/.test(name));if(!/\.tsx?$/.test(name)||name.includes('node_modules'))continue;
  const ast=ts.createSourceFile(name,await readFile(path.join(root,name),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);const visit=n=>{if(ts.isStringLiteral(n)||ts.isNoSubstitutionTemplateLiteral(n)||ts.isTemplateHead(n)||ts.isTemplateMiddle(n)||ts.isTemplateTail(n))n.text.split(/\s+/).filter(Boolean).forEach(v=>candidates.add(v));ts.forEachChild(n,visit);};visit(ast);}
 const css=(await compile('@import "tailwindcss";',{base:root,onDependency:()=>{}})).build([...candidates])+'body{margin:0;background:#f8fafc;font-family:Arial,sans-serif}.qa-main{max-width:1100px;margin:auto;min-width:0}';
 return{js:bundle.outputFiles.find(f=>f.path.endsWith('.js')).contents,css};
}
export async function verifyIndependentOwnerBrowser(){
 const started=Date.now(),model=await createIndependentOwnerBrowserModel(),requests=[],errors=[],inflight=new Set();let totalHttp=0,posts=0,server,browser,context,page,origin,files,closing=false,failure,report,stage='setup',accept=true;
 const timer=setTimeout(()=>{closing=true;void context?.close().catch(()=>{});server?.closeAllConnections();},independentOwnerBrowserLimits.ttlMs);
 const button=name=>page.getByRole('button',{name,exact:true}),dialog=()=>page.getByRole('dialog',{name:'独立员工管理工作区',exact:true});
 const settle=async()=>{await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));await bounded(Promise.allSettled([...inflight]));};
 const click=async(name,method='GET')=>{const[r]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname===api&&r.request().method()===method),button(name).click()]);await r.finished();assert.equal(r.status(),200,await r.text());await settle();};
 const configure=async value=>{await page.evaluate(v=>window.__independentOwnerHarness.configure(v),value);await settle();};
 const pending=()=>page.evaluate(()=>Object.entries(sessionStorage).filter(([key])=>key.startsWith('faolla:attendance:independent-admin:v1:')));
 const open=async()=>{await button('无邮箱员工／独立终端打卡').click();await dialog().waitFor();await settle();};
 const fill=async reason=>{await page.getByLabel('本次理由',{exact:true}).fill(reason);await page.getByRole('checkbox',{name:/已核实本人、档案和本次操作/}).check();};
 const fresh=async name=>{await click('读取档案');await click((await dialog().getByRole('button',{name:new RegExp('^'+name+' ·')}).innerText()));};
 const recover=async()=>{await click('仅 GET 核验原编号');};
 const overflow=async()=>assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'390px_overflow');
 try{
  files=await bounded(assets(model.seed),45000);server=createServer((req,res)=>{const work=(async()=>{assert(!closing);assert(++totalHttp<=independentOwnerBrowserLimits.http);assert.equal(req.headers.host,new URL(origin).host);const u=new URL(req.url,origin);
   res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Security-Policy',"default-src 'none';script-src 'self';style-src 'self' 'unsafe-inline';connect-src 'self';img-src 'self';base-uri 'none';form-action 'none';frame-ancestors 'none'");
   if(['/', '/qa.js','/qa.css','/favicon.ico'].includes(u.pathname)){assert.equal(req.method,'GET');assert.equal(u.search,'');if(u.pathname==='/favicon.ico')return res.writeHead(204).end();const html='<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="/favicon.ico"><link rel="stylesheet" href="/qa.css"><div id="qa-root"></div><script type="module" src="/qa.js"></script></html>';
    return res.writeHead(200,{'Content-Type':u.pathname==='/'?'text/html;charset=utf-8':u.pathname==='/qa.js'?'text/javascript;charset=utf-8':'text/css;charset=utf-8'}).end(u.pathname==='/'?html:u.pathname==='/qa.js'?files.js:files.css);}
   assert([api,admin].includes(u.pathname));assert(requests.length<independentOwnerBrowserLimits.api);if(req.method==='POST')assert(++posts<=independentOwnerBrowserLimits.posts);let text='',bytes=0;for await(const chunk of req){bytes+=chunk.length;assert(bytes<=8192);text+=chunk.toString('utf8');}
   const result=await model.respond(u.href,req.method,text,req.headers['x-synthetic-actor']);requests.push({path:u.pathname,method:req.method,query:result.query,action:result.command?.action});res.writeHead(result.status,{'Content-Type':'application/json;charset=utf-8'}).end(result.text);
  })();inflight.add(work);void work.catch(error=>{errors.push(error.message);if(!res.headersSent)res.writeHead(500,{'Content-Type':'application/json'});res.end('{"ok":false}');}).finally(()=>inflight.delete(work));});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const address=server.address();assert(address&&typeof address==='object'&&address.address==='127.0.0.1');origin=`http://127.0.0.1:${address.port}`;
  const{chromium}=await import('playwright'),launch=chromium.launch({headless:true});void launch.then(b=>{if(closing)return b.close();}).catch(()=>{});browser=await bounded(launch,15000);context=await browser.newContext({serviceWorkers:'block',acceptDownloads:false,viewport:{width:390,height:900}});
  await context.route('**/*',async route=>{const r=route.request(),u=new URL(r.url());if(u.origin!==origin||!(['/', '/qa.js','/qa.css','/favicon.ico'].includes(u.pathname)&&r.method()==='GET'&&!u.search||[api,admin].includes(u.pathname)&&['GET','POST'].includes(r.method()))){errors.push('external_or_unknown_request');return route.abort();}await route.continue();});
  page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('popup',()=>errors.push('popup'));page.on('download',()=>errors.push('download'));page.on('dialog',d=>void(accept?d.accept():d.dismiss()).catch(()=>{}));
  stage='actual_parent_guard_and_inert_child';await page.goto(origin);await button('打开独立员工合成父入口').waitFor();assert.equal(requests.length,0);await button('打开独立员工合成父入口').click();await page.getByLabel('企业考勤时区',{exact:true}).waitFor();await settle();
  await page.getByLabel('企业考勤时区',{exact:true}).fill('UTC');assert.equal(await button('无邮箱员工／独立终端打卡').isDisabled(),true);accept=false;assert.equal(await page.evaluate(()=>window.__independentOwnerHarness.leave()),false);accept=true;assert.equal(posts,0);
  await page.getByLabel('企业考勤时区',{exact:true}).fill('Europe/Madrid');const inert=requests.length;await open();assert.equal(requests.length,inert);
  stage='real_candidate_create_unknown_flagoff_original_get';await click('读取档案');await button('新建无邮箱员工').click();await page.getByLabel('姓名',{exact:true}).fill('新建合成员工196');await page.getByLabel('工号',{exact:true}).fill('NEW-196');await page.getByLabel('任职开始日期',{exact:true}).fill('2026-10-08');
  await click('读取可用工作地点');await page.getByRole('combobox',{name:'工作地点',exact:true}).selectOption(model.seed.location);await fill('Synthetic196 create');await click('建立档案（默认停用）','POST');const original=await pending();assert.equal(original.length,1);assert.equal(posts,1);
  await configure({mode:'isolated',enabled:false});await open();model.hideReceipt(true);await recover();assert.deepEqual(await pending(),original);model.hideReceipt(false);await recover();assert.equal((await pending()).length,0);
  await configure({enabled:true});await fresh('新建合成员工196');assert.match(await dialog().innerText(),/独立身份已停用/);
  stage='enable_issue_bind_closed_head_and_raw_pages';await fill('Synthetic196 enable');await click('启用独立打卡','POST');await recover();await fresh('新建合成员工196');
  await page.getByLabel('本次签发 PIN（8–12位数字）',{exact:true}).fill('12345678');await fill('Synthetic196 issue');await click('签发／重置 PIN','POST');const withPin=await pending();assert.doesNotMatch(JSON.stringify(withPin),/12345678|"pin"|verifier|salt/);await recover();await fresh('新建合成员工196');
  assert.match(await dialog().innerText(),/序列 52/);await click('读取可绑定的企业员工');await page.getByRole('combobox',{name:'经核实为同一人的企业账号',exact:true}).selectOption(model.seed.member);await fill('Synthetic196 bind');await click('绑定本人企业账号','POST');
  const binding=[...model.records.values()].find(r=>r.command.action==='bind_member').command;assert.equal(binding.targetAuthUserId,model.seed.memberAuth);assert.equal(binding.expectedSequence,52);assert.equal(binding.expectedLastEventId,model.history.at(-1).endEventId);
  await recover();await fresh('新建合成员工196');assert.match(await dialog().innerText(),/已绑定账号，独立 PIN 已停用/);await page.getByLabel('记录开始日期',{exact:true}).fill('2026-10-08');await page.getByLabel('记录结束日期（最多31天）',{exact:true}).fill('2026-10-08');
  await click('读取原始记录');assert.equal(await page.getByText('原始班次已闭合',{exact:true}).count(),25);await click('下一页原始班次');assert.equal(await page.getByText('原始班次已闭合',{exact:true}).count(),1);await overflow();
  stage='flagoff_safety_hidden_late_and_stable_auth';await configure({mode:'idle'});await configure({mode:'isolated',enabled:true,requester:1});await open();await fresh('停用专用合成员工');await page.getByLabel('本次签发 PIN（8–12位数字）',{exact:true}).fill('12345678');await fill('Synthetic196 private draft');accept=false;
  await page.evaluate(()=>window.__independentOwnerHarness.resetObservations());const beforeClose=await page.evaluate(()=>window.__independentOwnerHarness.observations());
  assert(beforeClose.modalOpen&&beforeClose.reasonNonempty&&beforeClose.pinNonempty,JSON.stringify(beforeClose));
  await dialog().getByRole('button',{name:'关闭',exact:true}).click();await settle();const closeObservation=await page.evaluate(()=>window.__independentOwnerHarness.observations());
  assert.deepEqual(closeObservation.confirms,[{kind:'leave',result:false}],JSON.stringify(closeObservation));
  assert(closeObservation.modalOpen&&closeObservation.reasonNonempty&&closeObservation.pinNonempty,JSON.stringify(closeObservation));accept=true;
  const beforePagehide=requests.length;await page.evaluate(()=>window.__independentOwnerHarness.pagehide());assert.equal(await page.getByText('停用专用合成员工 · SAFE-31',{exact:true}).count(),0);assert.equal(await page.getByLabel('本次签发 PIN（8–12位数字）',{exact:true}).count(),0);assert.equal(requests.length,beforePagehide);
  await configure({enabled:false});await fresh('停用专用合成员工');await fill('Synthetic196 flagoff disable');assert.equal(await button('启用独立打卡').isDisabled(),true);await click('停用独立打卡','POST');await recover();
  await fresh('撤销专用合成员工');await fill('Synthetic196 flagoff revoke');await page.evaluate(()=>window.__independentOwnerHarness.hold('POST'));await click('撤销 PIN','POST');await page.waitForFunction(()=>window.__independentOwnerHarness.held());const late=await pending();assert.equal(late.length,1);
  await page.evaluate(()=>window.__independentOwnerHarness.visibility(true));await page.evaluate(()=>window.__independentOwnerHarness.release());await settle();assert.deepEqual(await pending(),late);assert.equal(await page.getByText('撤销专用合成员工 · SAFE-32',{exact:true}).count(),0);
  await page.evaluate(()=>window.__independentOwnerHarness.visibility(false));await button('读取本地状态（不联网）').click();await settle();await recover();assert.equal((await pending()).length,0);
  await page.evaluate(()=>window.__independentOwnerHarness.hold('GET'));await click('读取档案');await page.waitForFunction(()=>window.__independentOwnerHarness.held());await configure({requester:2});await page.evaluate(()=>window.__independentOwnerHarness.release());await settle();assert.equal(await page.getByText('新建合成员工196 · NEW-196 · 已绑定账号',{exact:true}).count(),0);
  await click('读取档案');await overflow();await page.evaluate(()=>window.__independentOwnerHarness.authValid(false));assert.equal(await dialog().count(),0);assert.equal(await page.getByText('新建合成员工196 · NEW-196 · 已绑定账号',{exact:true}).count(),0);assert.equal(posts,6);assert.equal(requests.length,35);assert.deepEqual(errors,[]);
  report={groups:4,actualAdminParent:true,actualLauncher:true,actualPanel:true,actualAuth:false,actualSql:false,kdf:0,syntheticViewerProps:true,syntheticHistorySessions:26,syntheticHistoryReceipts:52,historyPages:[25,1],
   separateSafetySubjects:2,parentDraftGuard:true,childInitialNetwork:0,realLocationCandidateUi:true,realMemberCandidateUi:true,closedHeadBinding:true,
   unknownPostPending:true,nullKeepsPending:true,exactOriginalGetRecovery:true,flagoffDisableRevoke:true,pagehideClearsBodyPin:true,hiddenLatePreservesPending:true,lateRequesterInvalidatesBody:true,stableAuthFalseSuppressesBody:true,dirtyCloseGuard:true,
   posts,gets:requests.filter(r=>r.method==='GET').length,apiRequests:requests.length,totalHttp,mobileWidth:390,horizontalOverflow:false,externalRequests:0,diskBundle:false,elapsedMs:Date.now()-started};
 }catch(error){failure=Error(`independent_owner_browser_failed:${stage}:${error.message}:${JSON.stringify({errors,requests:requests.slice(-5)})}`,{cause:error});throw failure;}
 finally{closing=true;clearTimeout(timer);await runAttendanceCleanupSteps([{name:'held body',run:async()=>{if(page&&!page.isClosed())await page.evaluate(()=>window.__independentOwnerHarness?.release()).catch(()=>{});}},
  {name:'owned context',run:()=>context?bounded(context.close(),6000):undefined},{name:'owned browser',run:()=>browser?bounded(browser.close(),6000):undefined},{name:'HTTP work',run:()=>bounded(Promise.allSettled([...inflight]),6000)},
  {name:'owned listener',run:()=>{server?.closeAllConnections();return server?.listening?bounded(new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve())),6000):undefined;}},
  {name:'esbuild',run:async()=>{(await import('esbuild')).stop();}}]).catch(error=>{if(failure)throw new AggregateError([failure,error],'independent_owner_browser_cleanup_failed');throw error;});
  assert(!browser?.isConnected()&&!server?.listening);if(failure)console.error(JSON.stringify({cleanup:'independent-owner-browser',browserClosed:!browser?.isConnected(),listenerStopped:!server?.listening,apiRequests:requests.length,totalHttp,posts}));}
 return{...report,browserClosed:true,listenerStopped:true};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv.length===3&&process.argv[2]==='--run-local')console.log(JSON.stringify(await verifyIndependentOwnerBrowser()));
 else if(process.argv.length===2)console.log('Inert. node --import tsx scripts/fixtures/attendance-independent-owner-browser.mjs --run-local');else throw Error('explicit_run_local_only');
}
