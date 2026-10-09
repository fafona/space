// Inert import. Root alone invokes this memory-only bundle / loopback browser
// in the SAME checked owned DB namespace as the171 native fixture.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {build} from 'esbuild';
import {compile} from '@tailwindcss/node';
import ts from 'typescript';
import {chromium} from 'playwright';
import {runAttendanceCleanupSteps} from './attendance-cleanup.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url)),canonical='https://www.faolla.com';
const endpoint='/api/merchant-enterprise/attendance/self-schedule-adoption',legacyEndpoint='/api/merchant-enterprise/attendance/self-schedule',oldEndpoint='/api/merchant-enterprise/attendance/self';
async function bounded(promise){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('self_adoption_browser_timeout')),15000);})]);}finally{clearTimeout(timer);}}
async function assets(){
  const base={absWorkingDir:root,entryPoints:['scripts/fixtures/attendance-self-schedule-adoption-browser.tsx'],bundle:true,write:false,metafile:true,
    platform:'browser',format:'esm',target:['es2020'],jsx:'automatic',tsconfig:path.join(root,'tsconfig.json'),outfile:'qa.js',logLevel:'warning'};
  const on=await build({...base,define:{'process.env':'{}','process.env.NODE_ENV':'"development"',
    'process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_SELF_SCHEDULE_ENABLED':'"1"','process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_SELF_SCHEDULE_ADOPTION_ENABLED':'"1"'}});
  const off=await build({...base,define:{'process.env':'{}','process.env.NODE_ENV':'"development"'}});
  for(const bundle of [on,off])for(const name of Object.keys(bundle.metafile.inputs))assert(!/node:crypto|\.server\.ts$/.test(name),'self_adoption_server_import');
  const candidates=new Set();
  for(const name of Object.keys(on.metafile.inputs).filter(n=>/\.tsx?$/.test(n)&&!n.includes('node_modules'))){
    const ast=ts.createSourceFile(name,await readFile(path.join(root,name),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
    const visit=node=>{if(ts.isStringLiteral(node)||ts.isNoSubstitutionTemplateLiteral(node)||ts.isTemplateHead(node)||ts.isTemplateMiddle(node)||ts.isTemplateTail(node))node.text.split(/\s+/).filter(Boolean).forEach(v=>candidates.add(v));ts.forEachChild(node,visit);};visit(ast);
  }
  const css=(await compile('@import "tailwindcss";',{base:root,onDependency:()=>{}})).build([...candidates])
    +'body{margin:0;background:#f1f5f9;font-family:Arial,sans-serif}.qa-toolbar{padding:12px;background:#fff7ed;font-size:13px;overflow-wrap:anywhere}.qa-main{max-width:1050px;margin:auto;padding:12px;min-width:0}';
  return {on:on.outputFiles.find(f=>f.path.endsWith('.js')).contents,off:off.outputFiles.find(f=>f.path.endsWith('.js')).contents,css};
}

export async function checkAttendanceSelfScheduleAdoptionBrowser(native,scope,d){
  assert(scope&&scope.schema===d.owned.schema);
  const files=await assets(),before=d.counts(),definitions=d.definitions();
  const newKey=`faolla:attendance:self-schedule-adoption:v1:${d.site}:${d.employee}`,legacyKey=`faolla:attendance:self-schedule:v1:${d.site}:${d.employee}`;
  const allowedStorage=[newKey,legacyKey,`faolla:attendance:self:v1:${d.site}:${d.employee}`];
  const mutable=['merchant_attendance_events','merchant_attendance_shift_schedule_relations','merchant_attendance_shift_plan_adoptions','merchant_attendance_shift_rule_bindings','merchant_attendance_shift_rule_sources'];
  const protectedTables=d.inventory().filter(t=>!mutable.includes(t)),protectedBefore=d.fingerprint(protectedTables);
  const requests=[],errors=[],inflight=new Set();let browser,origin,closing=false,featureEnabled=true,dropNext=null,checks=0;
  const server=createServer((request,response)=>{
    if(!origin||request.headers.host!==new URL(origin).host||request.method!=='GET')return response.writeHead(403).end();
    response.setHeader('Cache-Control','no-store');response.setHeader('X-Content-Type-Options','nosniff');
    response.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'");
    const url=new URL(request.url??'/',origin);if(url.search)return response.writeHead(403).end();
    if(url.pathname==='/'||url.pathname==='/off')return response.writeHead(200,{'Content-Type':'text/html;charset=utf-8'}).end(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>隔离本人核准选班验收</title><link rel="stylesheet" href="/qa.css"><div id="qa-root"></div><script type="module" src="/${url.pathname==='/off'?'qa-off':'qa'}.js"></script></html>`);
    if(url.pathname==='/qa.js'||url.pathname==='/qa-off.js')return response.writeHead(200,{'Content-Type':'text/javascript;charset=utf-8'}).end(url.pathname==='/qa.js'?files.on:files.off);
    if(url.pathname==='/qa.css')return response.writeHead(200,{'Content-Type':'text/css;charset=utf-8'}).end(files.css);return response.writeHead(403).end();
  });
  const parent=p=>p.getByRole('region',{name:'我的考勤',exact:true});
  const section=p=>p.getByRole('region',{name:'本人选班与核准引用',exact:true});
  const oldSection=p=>p.getByRole('region',{name:'本次排班与上班打卡',exact:true});
  const choice=p=>section(p).getByLabel('本次核准选班',{exact:true});
  const detail=(p,status)=>section(p).locator(`[data-self-schedule-adoption-status="${status}"]`);
  const postCount=()=>requests.filter(r=>r.method==='POST').length;
  const newPosts=()=>requests.filter(r=>r.method==='POST'&&r.path===endpoint);
  const scheduleRequests=from=>requests.slice(from).filter(r=>[endpoint,legacyEndpoint].includes(r.path));
  const quiet=async p=>{await p.waitForLoadState('networkidle');await bounded(Promise.all([...inflight]));};
  const saved=(p,key=newKey)=>p.evaluate(k=>{const raw=sessionStorage.getItem(k);return raw===null?null:JSON.parse(raw);},key);
  const clickResponse=async(p,button,match)=>{
    const [response]=await Promise.all([p.waitForResponse(r=>{const req=r.request();return match(new URL(r.url()).pathname,req.method(),req.method()==='POST'?req.postDataJSON():null);}),button.click()]);
    await response.finished();assert.equal(response.status(),200,await response.text());return response.json();
  };
  const parentReady=async p=>{await parent(p).getByRole('button',{name:'刷新状态',exact:true}).waitFor();await p.waitForFunction(()=>{
    const region=document.querySelector('[aria-label="我的考勤"]');return [...(region?.querySelectorAll('button')??[])].some(b=>b.textContent==='刷新状态'&&!b.disabled);
  });};
  const read=async p=>{await parentReady(p);const body=await clickResponse(p,section(p).getByRole('button',{name:'核对选班与核准结果',exact:true}),(url,method)=>url===endpoint&&method==='GET');
    await p.waitForFunction(()=>{const s=document.querySelector('[data-self-schedule-adoption-clock] select');return s instanceof HTMLSelectElement&&!s.disabled;});return body;};
  const submit=async(p,selection,status)=>{await choice(p).selectOption(selection);const body=await clickResponse(p,section(p).getByRole('button',{name:`上班并保存核准引用 · ${selection==='none'?'不关联排班':'已选排班'}`,exact:true}),(url,method)=>url===endpoint&&method==='POST');
    await detail(p,status).waitFor();assert.equal(body.adoption.status,status);return body;};
  const end=async p=>{
    const out=parent(p).getByRole('button',{name:'下班打卡',exact:true});await out.waitFor();
    // Wait BEFORE click for the actual later POST, not a snapshot of in-flight
    // GETs/networkidle. This avoids the previously observed false working read.
    const body=await clickResponse(p,out,(url,method,data)=>url===oldEndpoint&&method==='POST'&&data?.action==='clock_out');
    assert.equal(body.state.status,'off');await out.waitFor({state:'detached'});await parentReady(p);await quiet(p);
    const current=await d.oldRead();assert.equal((current.body??current).state.status,'off');
  };
  try{
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const address=server.address();assert(address&&typeof address==='object');origin=`http://127.0.0.1:${address.port}`;
    browser=await chromium.launch({headless:true});
    const run=async(name,check,{off=false,width=1280,oldPending=null,newPending=null,rawNew=null}={})=>{
      featureEnabled=true;dropNext=null;const start=requests.length,context=await browser.newContext({serviceWorkers:'block',acceptDownloads:false,viewport:{width,height:1050}});
      try{
        await context.addInitScript(seed=>{
          Object.defineProperty(window,'__selfScheduleAdoptionSeed',{value:seed});
          if(sessionStorage.getItem('qa-unrelated')===null)sessionStorage.setItem('qa-unrelated','preserve');
          if(localStorage.getItem('qa-unrelated')===null)localStorage.setItem('qa-unrelated','preserve');
          if(seed.oldPending&&sessionStorage.getItem('qa-old-seeded')===null){sessionStorage.setItem(seed.legacyKey,JSON.stringify(seed.oldPending));sessionStorage.setItem('qa-old-seeded','1');}
          if(seed.rawNew!==null&&sessionStorage.getItem('qa-new-seeded')===null){sessionStorage.setItem(seed.newKey,seed.rawNew);sessionStorage.setItem('qa-new-seeded','1');}
          const probe={csp:[],unexpectedStorage:[]};Object.defineProperty(window,'__selfAdoptionProbe',{value:probe});
          for(const method of ['setItem','removeItem','clear']){const original=Storage.prototype[method];Storage.prototype[method]=function(...args){
            if(this!==sessionStorage||method==='clear'||!seed.allowedStorage.includes(args[0]))probe.unexpectedStorage.push(method+':'+String(args[0]));return original.apply(this,args);};}
          document.addEventListener('securitypolicyviolation',e=>probe.csp.push(e.violatedDirective));
        },{siteId:d.site,employeeId:d.employee,allowedStorage,legacyKey,newKey,oldPending,rawNew:rawNew??(newPending?JSON.stringify(newPending):null)});
        await context.route('**/*',route=>{
          if(closing)return route.abort().catch(()=>{});
          const work=(async()=>{
            const request=route.request(),url=new URL(request.url());assert.equal(url.origin,origin,'self_adoption_external_request');
            if(['/','/off','/qa.js','/qa-off.js','/qa.css'].includes(url.pathname)){assert.equal(request.method(),'GET');assert.equal(url.search,'');return route.continue();}
            assert([endpoint,legacyEndpoint,oldEndpoint].includes(url.pathname));assert(['GET','POST'].includes(request.method()));assert(requests.length<100,'self_adoption_request_budget');
            const body=request.method()==='POST'?JSON.parse(request.postData()??'null'):null;
            const record={path:url.pathname,method:request.method(),query:Object.fromEntries(url.searchParams),body,status:null,delivered:true};requests.push(record);
            const drop=url.pathname===endpoint&&request.method()==='POST'?dropNext:null;if(drop)dropNext=null;
            if(drop==='before'){record.delivered=false;record.status='transport-abort-before-handler';return route.abort('failed');}
            const handler=url.pathname===endpoint?d.handleNew:url.pathname===legacyEndpoint?d.handle137:d.handleOld;
            const response=await handler(new Request(canonical+url.pathname+url.search,{method:request.method(),headers:{host:'www.faolla.com',origin:canonical,'sec-fetch-site':'same-origin',...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})}),url.pathname===endpoint?{featureEnabled:()=>featureEnabled}:{});
            record.status=response.status;const text=await response.text();record.response=JSON.parse(text);assert.equal(response.headers.get('cache-control'),'private, no-store');
            if(drop==='after'){assert.equal(response.status,200);record.delivered=false;return route.abort('failed');}
            await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:text});
          })();inflight.add(work);void work.finally(()=>inflight.delete(work)).catch(()=>{});
          return work.catch(async error=>{if(!closing)errors.push(error instanceof Error?error.message:'self_adoption_route_failed');await route.abort().catch(()=>{});});
        });
        const page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));page.on('download',()=>errors.push('unexpected_download'));page.on('popup',()=>errors.push('unexpected_popup'));
        page.on('dialog',dialog=>{if(dialog.type()==='beforeunload')void dialog.accept().catch(()=>{});else{errors.push('unexpected_dialog');void dialog.dismiss().catch(()=>{});}});
        await page.goto(origin+(off?'/off':''));await parentReady(page);
        try{await check(page,start);}catch(error){error.message=`${name}: ${error.message}; lastRequests=${JSON.stringify(requests.slice(-6).map(r=>({path:r.path,method:r.method,status:r.status,error:r.response?.error,action:r.body?.command?.action??r.body?.action})))}`;throw error;}
        await quiet(page);assert.deepEqual(await page.evaluate(()=>window.__selfAdoptionProbe),{csp:[],unexpectedStorage:[]});
        assert.deepEqual(await page.evaluate(()=>[sessionStorage.getItem('qa-unrelated'),localStorage.getItem('qa-unrelated')]),['preserve','preserve']);
        assert.equal(d.fingerprint(protectedTables),protectedBefore);assert.equal(d.definitions(),definitions);checks++;native.pass(name);
      }finally{await context.close();}
    };
    await run('self adoption frontend defaultoff retains old self only with zero schedule requests',async(p,start)=>{
      await parent(p).getByRole('button',{name:'上班打卡',exact:true}).waitFor();await quiet(p);assert.equal(await section(p).count(),0);
      assert.equal(scheduleRequests(start).length,0);assert.equal(postCount(),0);
    },{off:true});
    await run('actual390px parent explicitly reads one candidate source then persists none and selected adoption',async(p,start)=>{
      await section(p).waitFor();await quiet(p);assert.equal(scheduleRequests(start).length,0);assert.equal(await choice(p).inputValue(),'');assert.equal(await choice(p).isDisabled(),true);
      await read(p);assert.equal(await choice(p).inputValue(),'');assert.equal(await section(p).getByRole('button',{name:'上班并保存核准引用 · 请先明确选择',exact:true}).isDisabled(),true);
      await submit(p,'none','unselected');await end(p);await read(p);const selected=await submit(p,d.slots.browser.id,'adopted');
      assert.deepEqual(newPosts().at(-1).body.selection,d.selected(d.slots.browser));
      await detail(p,'adopted').getByText('核对固定核准引用',{exact:true}).click();assert((await detail(p,'adopted').innerText()).includes(selected.adoption.approval.sourceSha256));
      assert.equal(await p.locator('img').count(),0);assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      assert.equal(await section(p).evaluate(e=>e.scrollWidth<=e.clientWidth+1),true);assert.equal(scheduleRequests(start).filter(r=>r.path===legacyEndpoint).length,0);await end(p);
    },{width:390});
    await run('committed new POST loss survives reload and settles only explicit original-ID GET',async p=>{
      await read(p);await choice(p).selectOption(d.slots.browser.id);dropNext='after';const events=d.counts().events,posts=postCount();
      await section(p).getByRole('button',{name:'上班并保存核准引用 · 已选排班',exact:true}).click();await section(p).getByRole('status').filter({hasText:'未能可靠核对'}).waitFor();
      const pending=await saved(p);assert(pending);assert.equal(d.counts().events,events+1);const reloadAt=requests.length;
      await p.reload();await section(p).getByText(`原操作编号：${pending.command.operationId}`,{exact:true}).waitFor();await quiet(p);
      assert.equal(scheduleRequests(reloadAt).length,0);assert.equal(postCount(),posts+1);
      await clickResponse(p,p.getByRole('button',{name:'核对新核准原号',exact:true}),(url,method)=>url===endpoint&&method==='GET');await detail(p,'adopted').waitFor();
      assert.equal(await saved(p),null);assert.equal(newPosts().filter(r=>r.body.command.operationId===pending.command.operationId).length,1);assert.equal(d.counts().events,events+1);await end(p);
    });
    await run('new unknown intent survives flagoff GET-only and returns only by explicit original GET then POST',async p=>{
      await read(p);await choice(p).selectOption(d.slots.browser.id);dropNext='before';const events=d.counts().events;
      await section(p).getByRole('button',{name:'上班并保存核准引用 · 已选排班',exact:true}).click();await section(p).getByRole('status').filter({hasText:'未能可靠核对'}).waitFor();
      const pending=await saved(p);assert(pending);assert.equal(d.counts().events,events);const posts=postCount();featureEnabled=false;const offAt=requests.length;
      await p.goto(origin+'/off');await section(p).getByText(`原操作编号：${pending.command.operationId}`,{exact:true}).waitFor();await quiet(p);assert.equal(scheduleRequests(offAt).length,0);
      await clickResponse(p,p.getByRole('button',{name:'核对新核准原号',exact:true}),(url,method)=>url===endpoint&&method==='GET');await section(p).getByRole('status').filter({hasText:'暂未查到原号'}).waitFor();
      assert.deepEqual(await saved(p),pending);assert.equal(await section(p).getByRole('button',{name:'用原编号重试核准选班上班',exact:true}).isDisabled(),true);
      await quiet(p);assert.equal(postCount(),posts);assert(requests.slice(offAt).every(r=>r.method==='GET'));
      featureEnabled=true;await p.goto(origin+'/');await section(p).getByText(`原操作编号：${pending.command.operationId}`,{exact:true}).waitFor();
      await clickResponse(p,p.getByRole('button',{name:'核对新核准原号',exact:true}),(url,method)=>url===endpoint&&method==='GET');await section(p).getByRole('status').filter({hasText:'暂未查到原号'}).waitFor();const retryAt=requests.length;
      await clickResponse(p,section(p).getByRole('button',{name:'用原编号重试核准选班上班',exact:true}),(url,method)=>url===endpoint&&method==='POST');await detail(p,'adopted').waitFor();
      const retry=scheduleRequests(retryAt);assert.equal(retry[0].method,'GET');assert.equal(retry[0].query.operationId,pending.command.operationId);
      assert.deepEqual(retry.find(r=>r.method==='POST').body,{siteId:d.site,command:pending.command,selection:pending.selection});assert.equal(await saved(p),null);assert.equal(d.counts().events,events+1);await end(p);
    });
    // A real137 commit with its original exact local envelope models a lost
    // response. It is not a fake receipt or a migrated new-protocol operation.
    const oldCommand=d.command(),oldSelection=d.selected(d.slots.browser),oldResponse=await d.legacyRequest(oldCommand,oldSelection);
    assert.equal(oldResponse.status,200);assert.equal(oldResponse.body.association.status,'linked');
    const oldPending={version:1,siteId:d.site,employeeId:d.employee,command:oldCommand,selection:oldSelection};
    await run('legacy137 pending stays original endpoint and next explicit refresh alone selects new candidate source',async(p,start)=>{
      await oldSection(p).getByText(`原操作编号：${oldCommand.operationId}`,{exact:true}).waitFor();await quiet(p);assert.equal(scheduleRequests(start).length,0);
      await clickResponse(p,p.getByRole('button',{name:'核对旧选班原号',exact:true}),(url,method)=>url===legacyEndpoint&&method==='GET');
      await oldSection(p).locator('[data-self-schedule-association="linked"]').waitFor();assert.equal(await saved(p,legacyKey),null);assert.equal(await saved(p),null);await quiet(p);
      assert.equal(scheduleRequests(start).filter(r=>r.path===endpoint).length,0);await end(p);const nextAt=requests.length;
      await clickResponse(p,oldSection(p).getByRole('button',{name:'核对选班与打卡结果',exact:true}),(url,method)=>url===endpoint&&method==='GET');await choice(p).waitFor();await quiet(p);
      assert.deepEqual(scheduleRequests(nextAt).map(r=>[r.path,r.method]),[[endpoint,'GET']]);assert.equal(await choice(p).inputValue(),'');
    },{oldPending});
    const noWriteBefore=d.counts(),noWritePosts=postCount(),corrupt='{"version":1,"command":';
    await run('both flags off retain corrupt new bytes with visible storage alert and zero automatic schedule requests',async(p,start)=>{
      await parent(p).getByRole('alert').filter({hasText:'新核准选班恢复存储'}).waitFor();await section(p).waitFor();await quiet(p);
      assert.equal(await p.evaluate(key=>sessionStorage.getItem(key),newKey),corrupt);
      assert.equal(scheduleRequests(start).length,0);assert.equal(postCount(),noWritePosts);
      assert.equal(await parent(p).getByRole('button',{name:'上班打卡',exact:true}).isDisabled(),true);
      assert.equal(await section(p).getByRole('button',{name:'上班并保存核准引用 · 请先明确选择',exact:true}).isDisabled(),true);
      assert.deepEqual(d.counts(),noWriteBefore);
    },{off:true,rawNew:corrupt});
    // These exact, different operation IDs have NEVER been sent. The local
    // envelopes model interrupted intents only, not fabricated server receipts.
    const oldUnsent={version:1,siteId:d.site,employeeId:d.employee,command:d.command(),selection:d.selected(d.slots.browser)};
    const newUnsent={version:1,siteId:d.site,employeeId:d.employee,command:d.command(),selection:d.selected(d.slots.browser)};
    assert.notEqual(oldUnsent.command.operationId,newUnsent.command.operationId);
    assert.equal(oldUnsent.command.expectedSequence,newUnsent.command.expectedSequence);
    await run('two undelivered original-protocol intents are read individually without second automatic GET or any POST',async(p,start)=>{
      await parent(p).getByText('两个选班协议各有待确认编号。仅逐号读取，两个编号均核清前不提交；不会迁移编号或自动读取另一号。',{exact:true}).waitFor();
      await quiet(p);assert.equal(scheduleRequests(start).length,0);
      const first=await clickResponse(p,p.getByRole('button',{name:'核对旧选班原号',exact:true}),(url,method)=>url===legacyEndpoint&&method==='GET');
      assert.equal(first.clock.receipt,null);await oldSection(p).getByRole('status').filter({hasText:'暂未查到原号'}).waitFor();await quiet(p);
      assert.deepEqual(scheduleRequests(start).map(r=>[r.path,r.method,r.query.operationId]),[[legacyEndpoint,'GET',oldUnsent.command.operationId]]);
      assert.equal(await oldSection(p).getByRole('button',{name:'用原编号重试选班上班',exact:true}).isDisabled(),true);
      assert.equal(await oldSection(p).locator('select').count(),0);
      const secondAt=requests.length;
      const second=await clickResponse(p,p.getByRole('button',{name:'核对新核准原号',exact:true}),(url,method)=>url===endpoint&&method==='GET');
      assert.equal(second.clock.receipt,null);await section(p).getByRole('status').filter({hasText:'暂未查到原号'}).waitFor();await quiet(p);
      assert.deepEqual(scheduleRequests(secondAt).map(r=>[r.path,r.method,r.query.operationId]),[[endpoint,'GET',newUnsent.command.operationId]]);
      assert.equal(await section(p).getByRole('button',{name:'用原编号重试核准选班上班',exact:true}).isDisabled(),true);
      assert.equal(await choice(p).count(),0);assert.equal(await parent(p).getByRole('button',{name:'上班打卡',exact:true}).count(),0);
      assert.deepEqual(await p.evaluate(keys=>keys.map(key=>sessionStorage.getItem(key)),[legacyKey,newKey]),[JSON.stringify(oldUnsent),JSON.stringify(newUnsent)]);
      assert.equal(postCount(),noWritePosts);assert.deepEqual(d.counts(),noWriteBefore);
    },{oldPending:oldUnsent,newPending:newUnsent});
    assert.equal(checks,7);assert(requests.length<100,'self_adoption_final_request_budget');assert.deepEqual(errors,[]);assert.equal(requests.filter(r=>r.path===oldEndpoint&&r.method==='POST'&&r.body.action==='clock_in').length,0);
    assert.equal(requests.filter(r=>r.path===legacyEndpoint&&r.method==='POST').length,0);
    const final=d.counts();assert.equal(final.events,before.events+10);assert.equal(final.relations,before.relations+5);assert.equal(final.adoptions,before.adoptions+4);
    assert.equal(d.fingerprint(protectedTables),protectedBefore);assert.equal(d.definitions(),definitions);
    return {checks,apiRequests:requests.length,newPostAttempts:newPosts().length,actualNewClockIns:4,actualLegacyFixtureClockIns:1,oldClockOuts:5,
      before,final,actualParentHandlerServiceSql:true,syntheticAuth:true,realAuth:false,externalRequests:0,otherStorageWrites:0,
      oneExplicitCandidateSource:true,originalProtocolRecovery:true,committedResponseLoss:true,undeliveredFlagRollback:true,
      flagOffCorruptStorageVisible:true,dualUndeliveredPendingReadOnly:true,zeroWriteExtraGroups:2,serverModulesBundled:false,newCluster:false,productionAccess:false};
  }finally{
    closing=true;await runAttendanceCleanupSteps([
      {name:'self-adoption-browser',run:async()=>{await browser?.close();}},
      {name:'self-adoption-interceptions',run:async()=>{await bounded(Promise.allSettled([...inflight]));}},
      {name:'self-adoption-loopback',run:async()=>{if(server.listening){server.closeAllConnections();await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}}},
    ]);
  }
}
