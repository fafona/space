//200 INERT unless --run-local. Actual Admin/185 selection/Intent/Send UI;
//strict synthetic wire only, no real Auth/SQL/source authority/production.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {runAttendanceCleanupSteps} from './attendance-cleanup.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url)),require=createRequire(import.meta.url);
const base='/api/merchant-enterprise/attendance/',api=base+'operational-cycle',sendApi=api+'/send',admin=base+'admin',foundation=base+'period-delegation';
const ownerPreview=base+'period-closures-v2',delegatePreview=base+'period-delegated-closure',apis=[api,sendApi,admin,foundation,ownerPreview,delegatePreview];
export const cycleBrowserLimits=Object.freeze({ttlMs:180000,http:45,api:30,posts:4,groups:4});
export async function createCycleBrowserModel(){
 const f=require('./attendance-cycle-intent-model.ts'),ui=require('./attendance-cycle-send-ui-model.ts'),sm=require('./attendance-cycle-send-model.ts');
 const p=require('../../src/lib/merchantAttendanceCycleIntent.ts'),r=require('../../src/lib/merchantAttendanceCycleIntentResult.ts');
 const s=require('../../src/lib/merchantAttendanceCycleSend.ts'),sr=require('../../src/lib/merchantAttendanceCycleSendResult.ts');
 const g=require('../../src/lib/merchantAttendancePeriodDelegation.ts'),ap=require('../../src/lib/merchantAttendanceAdmin.ts');
 const v2=require('../../src/lib/merchantAttendancePeriodClosureV2.ts'),dc=require('../../src/lib/merchantAttendancePeriodDelegatedClosure.ts');
 const original=require('../../src/lib/merchantAttendancePeriodClosureClient.ts'),old=require('../../src/lib/merchantAttendancePeriodClosure.ts'),delegatedKey=require('../../src/lib/merchantAttendancePeriodDelegatedClosureClient.ts');
 const oldModel=require('./attendance-period-closure-ui-model.ts');
 const m=await f.cycleModel(),owner=await ui.createCycleSendUiModel(),delegate=await ui.createCycleSendUiModel('delegate',f.cycleId(91)),template=await sm.cycleSendModel();
 const d=delegate.delegateScope,seed={siteId:m.scope.siteId,owner:f.cycleOwner,delegate:d.expectedAuthUserId,delegateEmployee:d.actorEmployeeId,worker:m.scope.workerId,
  employee:m.intent.employeeId,employeeAuth:m.intent.employeeAuthUserId,grant:d.grantId,anchor:m.command.anchorDate,delegateIntent:m.intent.intentId,ownerFixtureIntent:m.intent.intentId,
  ownerSlot:original.periodClosurePendingKey(m.scope.siteId,'owner',f.cycleOwner),delegateSlot:delegatedKey.periodDelegatedClosurePendingKey(d)};
 const intents=new Map([['delegate:'+seed.delegateIntent,structuredClone(delegate.detail.data)],['owner:'+seed.ownerFixtureIntent,structuredClone(owner.detail.data)]]),receipts=new Map(),sends=new Map();let recovery='valid',lost=true;
 const legacyQuery={...oldModel.periodClosureUiQuery('detail'),siteId:seed.siteId,access:'owner',workerId:seed.worker,fromDate:m.intent.fromDate,throughDate:m.intent.throughDate,periodId:f.cycleId(3000)};
 const legacyCommand={...oldModel.periodClosureUiCommand(),periodId:legacyQuery.periodId,operationId:f.cycleId(3001)};
 const pending=(format,query,command)=>JSON.stringify({format,actorId:seed.owner,employeeId:seed.employee,employeeAuthUserId:seed.employeeAuth,query,command});
 const q1=old.parsePeriodClosureQuery(legacyQuery),q2=v2.parsePeriodClosureV2Query({...legacyQuery,cursor:null});
 const legacyRaws=[pending(1,q1,old.parsePeriodClosureCommand(q1,legacyCommand)),pending(2,q2,v2.parsePeriodClosureV2Command(q2,legacyCommand)),'{'];
 const reply=(data,extra={})=>({status:200,text:JSON.stringify(data),...extra});
 const common=actor=>({protocol:p.CYCLE_INTENT_PROTOCOL,siteId:seed.siteId,actorId:actor,readAt:f.cycleReadAt});
 async function respond(url,method,text,actor,enabled=true){
  const u=new URL(url);assert(apis.includes(u.pathname));assert(['GET','POST'].includes(method));assert([seed.owner,seed.delegate].includes(actor));
  if(u.pathname===admin){assert.equal(method,'GET');assert.equal(actor,seed.owner);const q=ap.parseAttendanceAdminQuery(u.href);assert.equal(q.siteId,seed.siteId);assert(['settings','workers'].includes(q.view));
   const data={ok:true,moduleEnabled:true,siteId:seed.siteId,version:1,view:q.view,settings:{timeZone:'Europe/Madrid',enabled:true,webClockEnabled:true,webBreakPaid:false},
    items:q.view==='workers'?[{id:seed.worker,employeeId:seed.employee,workerNo:'SYNTHETIC-200',displayName:'合成周期人员200',locationId:f.cycleId(72),active:true,startsOn:'2026-01-01'}]:[],nextCursor:null,receipt:null};
   ap.parseAttendanceAdminResult(data,q);return reply(data,{query:q});}
  if(u.pathname===foundation){assert.equal(method,'GET');assert.equal(actor,seed.delegate);const q=g.parsePeriodDelegationHttpQuery(u.href);assert.equal(q.siteId,seed.siteId);assert.equal(q.access,'delegate');assert(['list','detail'].includes(q.mode));
   assert.equal(q.grantId,q.mode==='detail'?seed.grant:null);
   const grant={grantId:seed.grant,revision:1,status:'granted',delegate:{employeeId:seed.delegateEmployee,authUserId:seed.delegate,name:'Synthetic200 supervisor'},
    worker:{workerId:seed.worker,employeeId:seed.employee,authUserId:seed.employeeAuth,name:'Synthetic200 target',workerNo:'SYNTHETIC-200'},
    fromDate:d.authorizedFromDate,throughDate:d.authorizedThroughDate,actions:['view','send'],usableActions:['view','send'],includeExisting:false,
    validFrom:'2026-10-01T00:00:00.000000Z',validUntil:'2026-11-01T00:00:00.000000Z',grantedBy:seed.owner,grantedAt:'2026-10-01T00:00:00.000000Z',reason:'Synthetic200 actual host selection',revocation:null};
   const data=g.parsePeriodDelegationResponse({ok:true,protocol:'period-delegation-v1',siteId:seed.siteId,access:'delegate',actorId:actor,employeeId:seed.delegateEmployee,
    mode:q.mode,canWrite:false,grants:q.mode==='list'?[grant]:[],catalogItems:[],nextAfterId:null,detail:q.mode==='detail'?grant:null,receipt:null,readAt:f.cycleReadAt},q,{authUserId:actor});
   return reply({ok:true,...data},{query:q});}
  if([ownerPreview,delegatePreview].includes(u.pathname)){assert.equal(method,'GET');assert(enabled);const access=u.pathname===ownerPreview?'owner':'delegate',model=access==='owner'?owner:delegate;
   assert.equal(actor,access==='owner'?seed.owner:seed.delegate);const q=access==='owner'?v2.parsePeriodClosureV2HttpQuery(u.href):dc.parsePeriodDelegatedClosureHttpQuery(u.href);
   assert.deepEqual(q,model.request.query);assert.equal(q.periodId,null);assert.equal(q.mode,'preview');return reply(model.raw,{query:q});}
  if(u.pathname===api){const pair=method==='POST'?p.parseCycleIntentBodyJson(text):null,q=pair?.query??p.parseCycleIntentHttpQuery(u.href),c=pair?.command??null;
   assert.equal(q.siteId,seed.siteId);assert.equal(q.workerId,seed.worker);assert.equal(actor,q.access==='owner'?seed.owner:seed.delegate);assert.equal(q.grantId,q.access==='owner'?null:seed.grant);let data;
   if(c){assert(enabled);assert.equal(c.action,'accept');assert.equal(q.access,'owner');assert(!receipts.has(c.operationId),'unexpected_duplicate_POST');
    assert.equal(c.expectedPreparationFingerprint,m.preparation.preparationFingerprint);assert.equal(c.expectedFrameRevision,0);
    const hash=await p.cycleIntentCommandFingerprint(q,c,actor),receipt={...m.receipt,operationId:c.operationId,intentId:c.intentId,actorId:actor,commandFingerprint:hash};
    const intent={...m.intent,intentId:c.intentId,actorId:actor,acceptCommand:c};
    intent.intentFingerprint=f.cycleHash(['attendance-cycle-intent-v1',seed.siteId,c.intentId,actor,q.access,q.grantId,q.workerId,intent.employeeId,intent.employeeAuthUserId,
     intent.anchorDate,intent.fromDate,intent.throughDate,intent.timeZone,intent.fromAt,intent.toAt,intent.dueAt,m.preparation.preparationFingerprint,m.source.sourceFingerprint,hash,f.cycleRecordedAt]);
    intents.set('owner:'+c.intentId,{kind:'detail',intent,head:receipt});receipts.set(c.operationId,{receipt,command:c});data={...common(actor),data:{kind:'receipt'},receipt};
   }else if(q.mode==='prepare'){assert.equal(q.anchorDate,seed.anchor);data=await r.parseCycleIntentResult({...common(actor),data:{kind:'preparation',source:m.source,anchorDate:q.anchorDate,activation:{revision:1,active:true},frameHead:{revision:0,lastOperationId:null}},receipt:null},q,actor,null,'sql');
   }else if(q.mode==='recover'){const saved=receipts.get(q.operationId);assert(saved);data={...common(actor),data:{kind:'receipt'},receipt:saved.receipt};
   }else{assert.equal(q.mode,'detail');const saved=intents.get(q.access+':'+q.intentId);assert(saved);data={...common(actor),data:saved,receipt:null};}
   await r.parseCycleIntentResult(data,q,actor,c);return reply({ok:true,data},{query:q,action:c?.action});}
  assert.equal(u.pathname,sendApi);const pair=method==='POST'?s.parseCycleSendBodyJson(text):null,q=pair?null:s.parseCycleSendHttpQuery(u.href),frame=pair?.frame??s.cycleSendQueryFrame(q),command=pair?.command??null;
  assert.equal(frame.siteId,seed.siteId);assert.equal(frame.workerId,seed.worker);assert.equal(actor,frame.access==='owner'?seed.owner:seed.delegate);let record;
  if(command){assert(enabled);assert(!sends.has(command.operationId),'unexpected_duplicate_POST');const intent=intents.get(frame.access+':'+frame.intentId);assert(intent);assert.equal(intent.head.action,'accept');assert.equal(intent.intent.actorId,actor);
   assert.equal(frame.expectedIntentFingerprint,intent.intent.intentFingerprint);assert.equal(command.expectedFingerprint,(frame.access==='owner'?owner:delegate).source.artifact.sourceFingerprint);
   const fingerprint=await s.cycleSendCommandFingerprint(frame,command,actor),value=template.linked();value.actorId=actor;value.siteId=seed.siteId;value.readAt=f.cycleReadAt;
   value.data.periodOperation={operationId:command.operationId,revision:1,action:'send',version:1,actorId:actor,reason:command.reason,recordedAt:f.cycleRecordedAt,command};
   value.receipt={operationId:command.operationId,intentId:frame.intentId,action:'link',actorId:actor,revision:2,recordedAt:f.cycleRecordedAt,commandFingerprint:fingerprint,periodId:frame.periodId,sendOperationId:command.operationId};
   await sr.parseCycleSendResult(value,frame,actor,command.operationId,fingerprint,command);record={frame,command,fingerprint,value};sends.set(command.operationId,record);intent.head=value.receipt;
  }else{assert.equal(q.mode,'recover');record=sends.get(q.operationId);assert(record);assert.equal(q.commandFingerprint,record.fingerprint);assert.deepEqual(frame,record.frame);}
  const raw={ok:true,moduleEnabled:enabled,data:structuredClone(record.value)};
  if(!command&&recovery==='foreign')raw.data.receipt.actorId=f.cycleId(99);
  else await sr.parseCycleSendResponse(raw,frame,actor,record.command.operationId,record.fingerprint,command);
  const lose=!!command&&frame.access==='owner'&&lost;if(lose)lost=false;
  return{status:200,text:lose?'{"ok":':JSON.stringify(raw),query:frame,action:command?.action};
 }
 return{seed,delegateScope:d,owner,delegate,intents,receipts,sends,legacyRaws,respond,recovery:value=>{assert(['valid','foreign'].includes(value));recovery=value;}};
}
async function bounded(work,ms=12000){let timer;try{return await Promise.race([work,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('cycle_browser_deadline')),ms);})]);}finally{clearTimeout(timer);}}
async function assets(seed){
 const{build}=await import('esbuild'),{compile}=await import('@tailwindcss/node'),{default:ts}=await import('typescript');
 const bundle=await build({absWorkingDir:root,entryPoints:['scripts/fixtures/attendance-cycle-browser-entry.tsx'],bundle:true,write:false,metafile:true,platform:'browser',format:'esm',target:['es2020'],jsx:'automatic',tsconfig:path.join(root,'tsconfig.json'),outfile:'qa.js',logLevel:'warning',
  define:{'process.env':'{}','process.env.NODE_ENV':'"development"',__CYCLE_SEED__:JSON.stringify(seed)}});
 const candidates=new Set();for(const name of Object.keys(bundle.metafile.inputs)){assert(!/node:crypto|\.server\.ts$/.test(name));if(!/\.tsx?$/.test(name)||name.includes('node_modules'))continue;
  const ast=ts.createSourceFile(name,await readFile(path.join(root,name),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);const visit=n=>{if(ts.isStringLiteral(n)||ts.isNoSubstitutionTemplateLiteral(n)||ts.isTemplateHead(n)||ts.isTemplateMiddle(n)||ts.isTemplateTail(n))n.text.split(/\s+/).filter(Boolean).forEach(v=>candidates.add(v));ts.forEachChild(n,visit);};visit(ast);}
 const css=(await compile('@import "tailwindcss";',{base:root,onDependency:()=>{}})).build([...candidates])+'body{margin:0;background:#f8fafc;font-family:Arial,sans-serif}.qa-main{max-width:1100px;margin:auto;min-width:0}';
 return{js:bundle.outputFiles.find(f=>f.path.endsWith('.js')).contents,css};
}
export async function verifyCycleBrowser(){
 const started=Date.now(),model=await createCycleBrowserModel(),requests=[],errors=[],inflight=new Set(),groups=[];let totalHttp=0,posts=0,server,browser,context,page,origin,files,closing=false,failure,report,stage='setup',accept=true;
 const timer=setTimeout(()=>{closing=true;void context?.close().catch(()=>{});server?.closeAllConnections();},cycleBrowserLimits.ttlMs);
 const button=name=>page.getByRole('button',{name,exact:true}),intent=()=>page.getByRole('region',{name:'周期采用意向工作区',exact:true}),send=()=>page.getByRole('region',{name:'周期首次送审工作区',exact:true});
 const settle=async()=>{await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));await bounded(Promise.allSettled([...inflight]));};
 const click=async(name,path=api,method='GET')=>{const[r]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname===path&&r.request().method()===method),button(name).click()]);await r.finished();assert.equal(r.status(),200,await r.text());await settle();};
 const configure=async v=>{await page.evaluate(v=>window.__cycleHarness.configure(v),v);await settle();};
 const pending=slot=>page.evaluate(key=>sessionStorage.getItem(key),slot),overflow=async()=>assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'390px_overflow');
 const openIntent=async()=>{const n=requests.length;await button('周期采用意向').click();await intent().waitFor();await button('读取采用意向列表').waitFor();await settle();assert.equal(requests.length,n);};
 const detail=async id=>{await page.getByLabel('已知意向编号',{exact:true}).fill(id);await click('读取意向详情');};
 const openSend=async()=>{const n=requests.length;await button('打开首次送审／核验原号').click();await send().waitFor();await button('读取本地原槽（不联网）').waitFor();await settle();assert.equal(requests.length,n);};
 const fillSend=async reason=>{await page.getByLabel('首次送审理由',{exact:true}).fill(reason);await page.getByRole('checkbox',{name:/已核对人员、保存日期和来源/}).check();};
 const group=async(name,run)=>{stage=name;const count=requests.length,p=posts;await run();groups.push({name,apiRequests:requests.length-count,posts:posts-p});};
 try{
  files=await bounded(assets(model.seed),45000);server=createServer((req,res)=>{const work=(async()=>{assert(!closing);assert(++totalHttp<=cycleBrowserLimits.http);assert.equal(req.headers.host,new URL(origin).host);const u=new URL(req.url,origin);
   res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Security-Policy',"default-src 'none';script-src 'self';style-src 'self' 'unsafe-inline';connect-src 'self';img-src 'self';base-uri 'none';form-action 'none';frame-ancestors 'none'");
   if(['/', '/qa.js','/qa.css','/favicon.ico'].includes(u.pathname)){assert.equal(req.method,'GET');assert.equal(u.search,'');if(u.pathname==='/favicon.ico')return res.writeHead(204).end();const html='<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="/favicon.ico"><link rel="stylesheet" href="/qa.css"><div id="qa-root"></div><script type="module" src="/qa.js"></script></html>';
    return res.writeHead(200,{'Content-Type':u.pathname==='/'?'text/html;charset=utf-8':u.pathname==='/qa.js'?'text/javascript;charset=utf-8':'text/css;charset=utf-8'}).end(u.pathname==='/'?html:u.pathname==='/qa.js'?files.js:files.css);}
   assert(apis.includes(u.pathname));assert(requests.length<cycleBrowserLimits.api);const record={path:u.pathname,method:req.method};requests.push(record);if(req.method==='POST')assert(++posts<=cycleBrowserLimits.posts);let text='',bytes=0;for await(const chunk of req){bytes+=chunk.length;assert(bytes<=8192);text+=chunk.toString('utf8');}
   const result=await model.respond(u.href,req.method,text,req.headers['x-synthetic-actor'],req.headers['x-synthetic-enabled']==='true');Object.assign(record,{access:result.query?.access,mode:result.query?.mode,action:result.action});res.writeHead(result.status,{'Content-Type':'application/json;charset=utf-8'}).end(result.text);
  })();inflight.add(work);void work.catch(error=>{errors.push(error.message);if(!res.headersSent)res.writeHead(500,{'Content-Type':'application/json'});res.end('{"ok":false}');}).finally(()=>inflight.delete(work));});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const address=server.address();assert(address&&typeof address==='object'&&address.address==='127.0.0.1');origin=`http://127.0.0.1:${address.port}`;
  const{chromium}=await import('playwright'),launch=chromium.launch({headless:true});void launch.then(b=>{if(closing)return b.close();}).catch(()=>{});browser=await bounded(launch,15000);context=await browser.newContext({serviceWorkers:'block',acceptDownloads:false,viewport:{width:390,height:900}});
  await context.route('**/*',async route=>{const r=route.request(),u=new URL(r.url());if(u.origin!==origin||!(['/', '/qa.js','/qa.css','/favicon.ico'].includes(u.pathname)&&r.method()==='GET'&&!u.search||apis.includes(u.pathname)&&['GET','POST'].includes(r.method()))){errors.push('external_or_unknown_request');return route.abort();}await route.continue();});
  page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('popup',()=>errors.push('popup'));page.on('download',()=>errors.push('download'));page.on('dialog',d=>void(accept?d.accept():d.dismiss()).catch(()=>{}));
  await group('owner_actual_adopt_original_GET_lazy_send_unknown_flagoff',async()=>{
   await page.goto(origin);await button('打开负责人合成父入口').waitFor();assert.equal(requests.length,0);await button('打开负责人合成父入口').click();await page.getByLabel('企业考勤时区',{exact:true}).waitFor();await settle();
   await page.getByLabel('企业考勤时区',{exact:true}).fill('UTC');accept=false;assert.equal(await page.evaluate(()=>window.__cycleHarness.leave()),false);accept=true;await page.getByLabel('企业考勤时区',{exact:true}).fill('Europe/Madrid');
   await click('考勤人员',admin);await openIntent();await page.getByLabel('周期参考日期',{exact:true}).fill(model.seed.anchor);await click('读取来源和日期候选');
   await page.getByLabel('周期意向理由',{exact:true}).fill('Synthetic200 explicit adoption');await page.getByRole('checkbox',{name:/已核对人员和日期/}).check();await click('明确保存采用意向',api,'POST');await click('仅 GET 核验原编号');
   const saved=[...model.receipts.values()][0].receipt;await detail(saved.intentId);await openSend();await click('读取当前工时来源',ownerPreview);await fillSend('Synthetic200 first owner send');await click('明确首次送审第 1 版',sendApi,'POST');
   const raw=await pending(model.seed.ownerSlot);assert(raw);assert.equal(JSON.parse(raw).format,3);model.recovery('foreign');await click('仅 GET 核验首次送审原号',sendApi);assert.equal(await pending(model.seed.ownerSlot),raw);model.recovery('valid');
   await configure({enabled:false});await openIntent();await detail(saved.intentId);await openSend();assert.match(await send().innerText(),/新首次送审尚未开放/);await click('仅 GET 核验首次送审原号',sendApi);assert.equal(await pending(model.seed.ownerSlot),null);assert.match(await send().innerText(),/第 1 版/);await overflow();
   await button('关闭首次送审').click();await button('关闭周期意向').click();
  });
  await group('old_v1_v2_corrupt_shared_slot_blocks_new_POST_and_preserves',async()=>{
   const p0=posts;
   for(const raw of model.legacyRaws){
    await page.evaluate(({key,raw})=>sessionStorage.setItem(key,raw),{key:model.seed.ownerSlot,raw});await openIntent();await detail(model.seed.ownerFixtureIntent);assert.match(await intent().innerText(),/已保存周期意向 · 采用意向/);await openSend();assert(await button('读取当前工时来源').isDisabled());const n=requests.length;
    await button('仅 GET 核验首次送审原号').click();await settle();assert.equal(requests.length,n);assert.equal(await pending(model.seed.ownerSlot),raw);
    accept=false;assert.equal(await page.evaluate(()=>window.__cycleHarness.leave()),false);accept=true;await button('关闭首次送审').click();await button('关闭周期意向').click();assert.equal(await pending(model.seed.ownerSlot),raw);
    // Test-owned artificial raw only; the product never retires these bytes.
    await page.evaluate(({key,raw})=>{if(sessionStorage.getItem(key)!==raw)throw Error('fixture_slot_changed');sessionStorage.removeItem(key);},{key:model.seed.ownerSlot,raw});
   }assert.equal(posts,p0);
  });
  await group('delegate_real185_nine_scope_selection_and_outer_guard',async()=>{
   await configure({mode:'delegate',enabled:true});const n=requests.length;await button('我的受托周期').click();await button('读取授权').waitFor();await settle();assert.equal(requests.length,n);
   await click('读取授权',foundation);await click('核验详情',foundation);await page.getByLabel('受托周期起始日期',{exact:true}).fill('2026-10-05');await page.getByLabel('受托周期截止日期',{exact:true}).fill('2026-10-11');
   const before=requests.length;await button('打开受托周期工作区').click();await page.getByRole('region',{name:'受托周期核对',exact:true}).waitFor();await settle();assert.equal(requests.length,before);
   await openIntent();await detail(model.seed.delegateIntent);await openSend();await click('读取当前工时来源',delegatePreview);assert.equal(requests.at(-1).access,'delegate');await fillSend('Synthetic200 delegate guarded draft');
   accept=false;assert.equal(await page.evaluate(()=>window.__cycleHarness.leave()),false);assert.equal(await page.getByLabel('首次送审理由',{exact:true}).inputValue(),'Synthetic200 delegate guarded draft');accept=true;await overflow();
  });
  await group('hidden_Auth_requester_late_bodies_keep_original_mobile_close_no_HTTP',async()=>{
   await page.evaluate(path=>window.__cycleHarness.hold(path,'POST'),sendApi);await click('明确首次送审第 1 版',sendApi,'POST');await page.waitForFunction(()=>window.__cycleHarness.held());const raw=await pending(model.seed.delegateSlot);assert(raw);
   await page.evaluate(()=>window.__cycleHarness.visibility(true));await page.evaluate(()=>window.__cycleHarness.pagehide());assert.equal(await send().count(),0);assert.equal(await page.getByLabel('首次送审理由',{exact:true}).count(),0);
   const count=requests.length;await page.evaluate(()=>window.__cycleHarness.authValid(false));await page.evaluate(()=>window.__cycleHarness.release());await settle();assert.equal(await pending(model.seed.delegateSlot),raw);assert.equal(requests.length,count);
   await page.evaluate(()=>window.__cycleHarness.visibility(false));await page.evaluate(()=>window.__cycleHarness.authValid(true));await settle();assert.equal(requests.length,count);
   // Visibility arrived while Auth was false, so the old workspace correctly
   // stays hidden. Explicitly return and freshly select the actual185 grant;
   // never revive the old body or infer authority from the saved intent.
   await button('返回授权列表').click();await button('读取授权').waitFor();await settle();assert.equal(requests.length,count);assert.equal(await pending(model.seed.delegateSlot),raw);
   await click('读取授权',foundation);await click('核验详情',foundation);await page.getByLabel('受托周期起始日期',{exact:true}).fill('2026-10-05');await page.getByLabel('受托周期截止日期',{exact:true}).fill('2026-10-11');
   const reselected=requests.length;await button('打开受托周期工作区').click();await page.getByRole('region',{name:'受托周期核对',exact:true}).waitFor();await settle();assert.equal(requests.length,reselected);assert.equal(await pending(model.seed.delegateSlot),raw);
   await openIntent();await detail(model.seed.delegateIntent);await openSend();await click('仅 GET 核验首次送审原号',sendApi);assert.equal(await pending(model.seed.delegateSlot),null);await button('关闭首次送审').click();
   await page.evaluate(path=>window.__cycleHarness.hold(path,'GET'),api);await click('读取意向详情');await page.waitForFunction(()=>window.__cycleHarness.held());await configure({requester:1});await page.evaluate(()=>window.__cycleHarness.release());await settle();assert.equal(await intent().count(),0);assert.equal(await send().count(),0);assert.equal(await pending(model.seed.delegateSlot),null);
   await overflow();const done=requests.length;await button('我的受托周期').click();await page.getByRole('dialog',{name:'周期管理授权与受托核对工作区',exact:true}).press('Escape');await settle();assert.equal(requests.length,done);assert.deepEqual(errors,[]);
  });
  assert.equal(groups.length,4);assert.equal(posts,3);report={groups,actualAdminParent:true,actual185SelectionHost:true,actualIntentLauncher:true,actualIntentPanel:true,actualSendPanel:true,
   actualAuth:false,actualSql:false,syntheticViewerProps:true,mockedData:true,syntheticGrant:true,realAuthority:false,posts,gets:requests.filter(r=>r.method==='GET').length,apiRequests:requests.length,totalHttp,
   sharedOriginalSlots:true,unknownPOSTRetained:true,foreignReceiptRetained:true,flagoffMatchingGET:true,oldFormatsBlocked:true,parentChildGuards:true,
   hiddenClearsBody:true,lateAuthPreservesPending:true,requesterInvalidatesBody:true,mobileWidth:390,horizontalOverflow:false,externalRequests:0,diskBundle:false,elapsedMs:Date.now()-started};
 }catch(error){failure=Error(`cycle_browser_failed:${stage}:${error.message}:${JSON.stringify({errors,apiRequests:requests.length,posts,totalHttp,last:requests.slice(-5)})}`,{cause:error});throw failure;}
 finally{closing=true;clearTimeout(timer);await runAttendanceCleanupSteps([{name:'held body',run:async()=>{if(page&&!page.isClosed())await page.evaluate(()=>window.__cycleHarness?.release()).catch(()=>{});}},
  {name:'owned context',run:()=>context?bounded(context.close(),6000):undefined},{name:'owned browser',run:()=>browser?bounded(browser.close(),6000):undefined},{name:'HTTP work',run:()=>bounded(Promise.allSettled([...inflight]),6000)},
  {name:'owned listener',run:()=>{server?.closeAllConnections();return server?.listening?bounded(new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve())),6000):undefined;}},{name:'esbuild',run:async()=>{(await import('esbuild')).stop();}}]).catch(error=>{if(failure)throw new AggregateError([failure,error],'cycle_browser_cleanup_failed');throw error;});assert(!browser?.isConnected()&&!server?.listening);
  if(failure)console.error(JSON.stringify({cleanup:'cycle-browser',browserClosed:!browser?.isConnected(),listenerStopped:!server?.listening,apiRequests:requests.length,totalHttp}));}
 return{...report,browserClosed:true,listenerStopped:true};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv.length===3&&process.argv[2]==='--run-local')console.log(JSON.stringify(await verifyCycleBrowser()));
 else if(process.argv.length===2)console.log('Inert. node --import tsx scripts/fixtures/attendance-cycle-browser.mjs --run-local');else throw Error('explicit_run_local_only');
}
