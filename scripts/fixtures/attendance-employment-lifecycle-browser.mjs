//196 Inert callback; root owns all actual browser/DB execution and cleanup.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {build,stop} from 'esbuild';
import {compile} from '@tailwindcss/node';
import ts from 'typescript';
import {chromium} from 'playwright';
import {runAttendanceCleanupSteps} from './attendance-cleanup.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
const endpoint='/api/merchant-enterprise/attendance/employment-lifecycle',admin='/api/merchant-enterprise/attendance/admin';
async function bounded(promise){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('employment_lifecycle_browser_timeout')),15000);})]);}finally{clearTimeout(timer);}}
async function cleanup(steps,primary){try{assert(Array.isArray(steps)&&steps.every(s=>s&&typeof s==='object'&&!Array.isArray(s)&&typeof s.name==='string'&&typeof s.run==='function'));await runAttendanceCleanupSteps(steps);}
  catch(error){if(primary)throw new AggregateError([primary,error],'employment_lifecycle_browser_cleanup_failed',{cause:primary});throw error;}}
async function assets(){
  const bundle=await build({absWorkingDir:root,entryPoints:['scripts/fixtures/attendance-employment-lifecycle-browser.tsx'],bundle:true,write:false,metafile:true,platform:'browser',format:'esm',target:['es2020'],jsx:'automatic',
    tsconfig:path.join(root,'tsconfig.json'),outfile:'qa.js',logLevel:'warning',define:{'process.env':'{}','process.env.NODE_ENV':'"development"',
      'process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_SCHEDULE_ENABLED':'"1"','process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_LEAVE_ENABLED':'"1"'}});
  const inputs=Object.keys(bundle.metafile.inputs);for(const name of ['MerchantAttendanceAdminPanel.tsx','MerchantAttendanceEmploymentLifecyclePanel.tsx','merchantAttendanceEmploymentLifecycleClient.ts'])assert(inputs.some(n=>n.endsWith(name)),'missing_actual_parent_path '+name);
  for(const name of inputs)assert(!/node:crypto|\.server\.ts$/.test(name),'employment_lifecycle_server_browser_import');
  const candidates=new Set();for(const name of inputs.filter(n=>/\.tsx?$/.test(n)&&!n.includes('node_modules'))){const ast=ts.createSourceFile(name,await readFile(path.join(root,name),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
    const visit=node=>{if(ts.isStringLiteral(node)||ts.isNoSubstitutionTemplateLiteral(node)||ts.isTemplateHead(node)||ts.isTemplateMiddle(node)||ts.isTemplateTail(node))node.text.split(/\s+/).filter(Boolean).forEach(v=>candidates.add(v));ts.forEachChild(node,visit);};visit(ast);}
  const css=(await compile('@import "tailwindcss";',{base:root,onDependency:()=>{}})).build([...candidates])+'body{margin:0;font-family:Arial,sans-serif;background:#f1f5f9}.qa-toolbar{padding:8px;background:#fff7ed;font-size:12px;overflow-wrap:anywhere}.qa-controls{display:flex;flex-wrap:wrap;gap:6px}.qa-controls button{padding:6px;background:white;border:1px solid #94a3b8}.qa-main{max-width:1000px;margin:auto;padding:8px;min-width:0}';
  return {js:bundle.outputFiles.find(f=>f.path.endsWith('.js')).contents,css};
}
export async function runEmploymentLifecycleBrowserAcceptance(ctx){
  const {d,h,scope,owner,createBrowserSubject,advanceCivilDate,readDetail,fingerprint,handleLifecycle,handleAdmin}=ctx??{};
  assert(d?.syntheticOnly===true&&h?.syntheticOnly===true&&scope?.schema===d.owned.schema&&owner===d.owner,'employment_lifecycle_browser_owned_context');
  assert([createBrowserSubject,advanceCivilDate,readDetail,fingerprint,handleLifecycle,handleAdmin].every(fn=>typeof fn==='function'),'employment_lifecycle_browser_ports');
  const canonical=ctx.origin??'https://www.faolla.com';
  const blocked=await createBrowserSubject({blocked:true,active:true}),subject=await createBrowserSubject({active:true});
  assert.notEqual(blocked.site,subject.site);assert.equal(blocked.owner,owner);assert.equal(subject.owner,owner);
  const definitions=d.definitions(),catalog=d.tableCatalog(),requests=[],errors=[],inflight=new Set();
  let files,browser,context,page,origin,closing=false,accept=true,allowWrite=false,drop=false,stage='setup',failure=null,checks=0,readChecks=0;
  const key=`faolla:attendance:employment-lifecycle:v1:${subject.site}:${owner}`;
  const server=createServer((request,response)=>{if(!origin||request.headers.host!==new URL(origin).host||request.method!=='GET')return response.writeHead(403).end();
    response.setHeader('Cache-Control','no-store');response.setHeader('X-Content-Type-Options','nosniff');response.setHeader('Referrer-Policy','no-referrer');
    response.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; object-src 'none'");
    const url=new URL(request.url??'/',origin);if(url.search)return response.writeHead(403).end();
    if(url.pathname==='/')return response.writeHead(200,{'Content-Type':'text/html;charset=utf-8'}).end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>任职生命周期隔离验收</title><link rel="stylesheet" href="/qa.css"><div id="qa-root"></div><script type="module" src="/qa.js"></script></html>');
    if(url.pathname==='/qa.js')return response.writeHead(200,{'Content-Type':'text/javascript;charset=utf-8'}).end(files.js);if(url.pathname==='/qa.css')return response.writeHead(200,{'Content-Type':'text/css;charset=utf-8'}).end(files.css);return response.writeHead(403).end();});
  const lifecycleRequests=()=>requests.filter(r=>r.path===endpoint),posts=()=>lifecycleRequests().filter(r=>r.method==='POST');
  const region=()=>page.getByRole('region',{name:'任职结束与再入职',exact:true}),dialog=()=>page.getByRole('dialog',{name:'任职生命周期工作区',exact:true});
  const quiet=async()=>{await page.waitForLoadState('networkidle');await bounded(Promise.all([...inflight]));assert.deepEqual(errors,[]);};
  const responseClick=async(locator,{path:target=endpoint,method='GET',mode}={})=>{const [response]=await Promise.all([page.waitForResponse(r=>{const url=new URL(r.url());return url.pathname===target&&r.request().method()===method&&(!mode||url.searchParams.get('mode')===mode);}),locator.click()]);
    await response.finished();const body=await response.json();assert.equal(response.status(),200,JSON.stringify(body));assert.equal(body.ok,true);await quiet();return body;};
  const openWorker=async()=>{const before=lifecycleRequests().length;await page.getByRole('button',{name:'核验任职期',exact:true}).click();await region().waitFor();await quiet();assert.equal(lifecycleRequests().length,before,'opening_must_be_local_only');};
  const detail=()=>responseClick(region().getByRole('button',{name:'读取该人员任职依据',exact:true}),{mode:'detail'});
  const close=async()=>{await region().getByRole('button',{name:'关闭任职核验',exact:true}).click();await dialog().waitFor({state:'detached'});await page.getByRole('region',{name:'考勤配置管理',exact:true}).waitFor();};
  try{
    files=await assets();await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const address=server.address();assert(address&&typeof address==='object');origin=`http://127.0.0.1:${address.port}`;
    browser=await chromium.launch({headless:true});context=await browser.newContext({serviceWorkers:'block',acceptDownloads:false,viewport:{width:390,height:900}});
    await context.addInitScript(subjects=>{window.__employmentLifecycleSeed={subjects};sessionStorage.setItem('qa-unrelated','keep');localStorage.setItem('qa-unrelated','keep');
      const probe=window.__employmentLifecycleProbe={writes:[],csp:[]};document.addEventListener('securitypolicyviolation',event=>probe.csp.push(event.violatedDirective));
      for(const method of ['setItem','removeItem','clear']){const old=Storage.prototype[method];Storage.prototype[method]=function(...args){probe.writes.push({method,key:String(args[0]??''),local:this===localStorage,bytes:new TextEncoder().encode(String(args[1]??'')).length});return old.apply(this,args);};}
    },[blocked,subject].map(s=>({site:s.site,owner:s.owner,worker:s.worker,name:s.name})));
    await context.route('**/*',route=>{if(closing)return route.abort().catch(()=>{});const task=(async()=>{
      const request=route.request(),url=new URL(request.url()),method=request.method();assert.equal(url.origin,origin,'employment_lifecycle_external_request');
      if(['/','/qa.js','/qa.css'].includes(url.pathname)){assert.equal(method,'GET');return route.continue();}
      assert(requests.length<30,'employment_lifecycle_browser_budget');assert([endpoint,admin].includes(url.pathname),'employment_lifecycle_unexpected_endpoint');
      assert(method==='GET'||url.pathname===endpoint&&method==='POST','employment_lifecycle_no_legacy_writes');
      const body=request.postData(),command=body?JSON.parse(body).command:null;assert(!command||['close','rejoin'].includes(command.action));
      const before=method==='GET'?fingerprint():null,headers={...request.headers(),host:new URL(canonical).host,origin:canonical,'sec-fetch-site':'same-origin'};delete headers['content-length'];
      const req=new Request(canonical+url.pathname+url.search,{method,headers,...(body?{body}:{})});
      const response=url.pathname===admin?await handleAdmin(req):await handleLifecycle(req,{enabled:()=>allowWrite});
      const text=await response.text(),json=JSON.parse(text);if(method==='GET'){assert.equal(fingerprint(),before,'employment_lifecycle_get_wrote');readChecks++;}
      requests.push({path:url.pathname,method,mode:url.searchParams.get('mode'),action:command?.action??null,status:response.status,error:json.error??null});
      assert.equal(response.status,200,text);assert.equal(json.ok,true);
      if(command){assert.equal(json.receipt?.action,command.action);assert.equal(json.receipt?.operationId,command.operationId);assert.equal(json.detail,null);assert.equal(command.workerId,subject.worker);}
      if(drop&&method==='POST'){drop=false;return route.abort('failed');}
      return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:text});
    })();inflight.add(task);void task.finally(()=>inflight.delete(task)).catch(()=>{});return task.catch(async error=>{if(!closing)errors.push(String(error?.message??error));await route.abort().catch(()=>{});});});
    page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',error=>errors.push(error.message));page.on('popup',()=>errors.push('unexpected_popup'));
    page.on('dialog',value=>{void(accept?value.accept():value.dismiss()).catch(error=>{if(!closing)errors.push('dialog_failed:'+error.message);});});
    stage='default_off';await page.goto(origin);await page.getByRole('region',{name:'考勤配置管理',exact:true}).waitFor();await quiet();
    await responseClick(page.getByRole('button',{name:'考勤人员',exact:true}),{path:admin});assert.equal(lifecycleRequests().length,0);
    assert.equal(await page.getByRole('button',{name:'任职结束／再入职',exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'核验任职期',exact:true}).count(),0);checks++;
    stage='future_blocker_read_and_return';allowWrite=true;await page.getByTestId('feature-on').click();await openWorker();const blockedRead=await detail();
    assert.equal(blockedRead.detail.canClose,false);assert(blockedRead.detail.pending.items.some(v=>v.kind==='schedule'));await region().locator('[data-employment-lifecycle-detail]').waitFor();
    assert((await region().innerText()).includes('不会自动取消、拒绝、补下班'));assert.equal(await region().getByRole('button',{name:'明确结束当日任职',exact:true}).count(),0);
    await close();for(const name of ['员工排班','请假申请审批','工作安排审批与政策']){const entry=page.getByRole('button',{name,exact:true});await entry.waitFor();assert.equal(await entry.isEnabled(),true);}
    assert.equal(posts().length,0);checks++;
    stage='eligible_subject_parent';await page.getByTestId('subject-1').click();await quiet();await responseClick(page.getByRole('button',{name:'考勤人员',exact:true}),{path:admin});await openWorker();
    const ready=await detail();assert.equal(ready.detail.canClose,true);const closeDate=ready.detail.today;
    stage='dirty_escape_390';await region().getByLabel('任职办理理由',{exact:true}).fill('未提交的任职核验');accept=false;
    const dismissal=page.waitForEvent('dialog');await region().getByLabel('任职办理理由',{exact:true}).press('Escape');await dismissal;await quiet();await dialog().waitFor();
    assert.equal(await region().getByLabel('任职办理理由',{exact:true}).inputValue(),'未提交的任职核验');accept=true;
    const box=await dialog().boundingBox();assert(box&&box.x>=0&&box.x+box.width<=391);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false);checks++;
    stage='close_lost_response';await region().getByLabel('任职办理理由',{exact:true}).fill('Synthetic196 browser explicit same-identity closure');await region().getByLabel('确认同身份与办理日期',{exact:true}).check();drop=true;
    const lost=page.waitForEvent('requestfailed',{predicate:r=>new URL(r.url()).pathname===endpoint&&r.method()==='POST'});await region().getByRole('button',{name:'明确结束当日任职',exact:true}).click();await lost;
    await region().locator('[data-employment-lifecycle-pending]').waitFor();await quiet();const raw=await page.evaluate(key=>sessionStorage.getItem(key),key);assert(raw);const pending=JSON.parse(raw);
    assert.equal(pending.command.action,'close');assert.equal(pending.command.expectedDate,closeDate);assert.equal(posts().length,1);
    // Fixture rollout control models a feature-flag change, not a business UI action.
    allowWrite=false;await page.evaluate(()=>window.dispatchEvent(new CustomEvent('qa-employment-rollout',{detail:false})));await page.getByTestId('feature-state').filter({hasText:'off'}).waitFor();
    await region().getByRole('button',{name:'核对原任职编号',exact:true}).waitFor();await quiet();assert.equal(posts().length,1);
    const recovered=await responseClick(region().getByRole('button',{name:'核对原任职编号',exact:true}),{mode:'recover'});assert.equal(recovered.receipt.operationId,pending.command.operationId);assert.equal(recovered.receipt.endsOn,closeDate);
    await region().locator('[data-employment-lifecycle-receipt="close"]').waitFor();await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await quiet();await region().locator('[data-employment-lifecycle-receipt="close"]').waitFor();
    assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),key),null);assert.equal(posts().length,1);await close();assert.equal(await page.getByRole('button',{name:'核对待确认任职操作',exact:true}).count(),0);checks++;
    stage='actual_civil_date_advance';await advanceCivilDate(subject);const afterDate=await readDetail(subject);assert(afterDate.today>closeDate);assert.equal(afterDate.canRejoin,true);
    allowWrite=true;await page.getByTestId('feature-on').click();await openWorker();const rejoinReady=await detail();assert.equal(rejoinReady.detail.today,afterDate.today);assert.equal(rejoinReady.detail.canRejoin,true);
    await region().getByLabel('任职办理理由',{exact:true}).fill('Synthetic196 browser explicit same-identity rejoin');await region().getByLabel('确认同身份与办理日期',{exact:true}).check();
    const rejoined=await responseClick(region().getByRole('button',{name:'明确新增当日任职期',exact:true}),{method:'POST'});assert.equal(rejoined.receipt.action,'rejoin');assert.equal(rejoined.receipt.startsOn,afterDate.today);assert.equal(rejoined.receipt.endsOn,null);
    await region().locator('[data-employment-lifecycle-receipt="rejoin"]').waitFor();assert.equal(posts().length,2);checks++;
    stage='saved_history_no_auto_restore';await responseClick(region().getByRole('button',{name:'读取该人员当前任职',exact:true}),{mode:'detail'});
    const history=await responseClick(region().getByRole('button',{name:'读取任职操作历史',exact:true}),{mode:'history'});assert.deepEqual(history.history.map(r=>r.action),['close','rejoin']);
    assert.equal(await region().locator('[data-employment-lifecycle-receipt]').count(),2);assert((await region().innerText()).includes('不证明当前任职状态或打卡资格'));
    const final=await readDetail(subject);assert.equal(final.state,'rejoined');assert.equal(final.worker.active,false);assert.equal(final.suspension.paused,true);assert.equal(final.periods.length,2);assert.equal(final.currentAction,null);
    await close();assert.equal(await page.getByRole('button',{name:'任职结束／再入职',exact:true}).isEnabled(),true);checks++;
    const observed=await page.evaluate(key=>({probe:window.__employmentLifecycleProbe,pending:sessionStorage.getItem(key),session:sessionStorage.getItem('qa-unrelated'),local:localStorage.getItem('qa-unrelated')}),key);
    assert.equal(observed.pending,null);assert.equal(observed.session,'keep');assert.equal(observed.local,'keep');assert.deepEqual(observed.probe.csp,[]);
    assert(observed.probe.writes.every(w=>!w.local&&w.key===key&&['setItem','removeItem'].includes(w.method)&&w.bytes<=8192));
    assert.equal(posts().length,2);assert.equal(requests.filter(r=>r.method==='PATCH').length,0);assert.equal(d.definitions(),definitions);assert.equal(d.tableCatalog(),catalog);assert.deepEqual(errors,[]);
    return {checks,requests:requests.length,readsVerifiedUnchanged:readChecks,lifecyclePosts:2,actualAdminParent:true,actualHandlerServiceSql:true,syntheticAuth:true,
      defaultOffNoLifecycleRequest:true,explicitReadOnlyOpening:true,futureBlockerPreserved:true,originalEntrypointsVisibleAfterClose:true,noAutomaticCancellation:true,
      dirtyEscapePreserved:true,width390:true,lostCloseOriginalGetOnly:true,flagOffRecovery:true,openReceiptSurvivesFocus:true,
      actualCivilDateAdvanceVia064:true,waitedOvernight:false,closeDate,rejoinDate:afterDate.today,actualRejoin:true,historyRead:true,
      workerStillPaused:true,noAutoAccountPinGrantRestore:true,restoreAndFreshClockCoveredBySeparateNativeOnly:true,
      unrelatedStoragePreserved:true,definitionsAndCatalogUnchanged:true,externalRequests:0,diskBundles:false};
  }catch(error){const diagnostic={stage,message:String(error?.message??error).slice(0,1400),stack:String(error?.stack??'').split('\n').slice(0,2).join('\n'),requests:requests.slice(-10),errors};
    if(page)diagnostic.ui=await page.locator('body').innerText().then(text=>text.slice(-5000)).catch(()=>'<closed>');failure=Error('employment_lifecycle_browser_failed '+JSON.stringify(diagnostic),{cause:error});throw failure;
  }finally{closing=true;await cleanup([
    {name:'employment lifecycle inflight',run:()=>bounded(Promise.allSettled([...inflight]))},
    {name:'employment lifecycle context',run:()=>context?bounded(context.close()):undefined},
    {name:'employment lifecycle browser',run:()=>browser?bounded(browser.close()):undefined},
    {name:'employment lifecycle listener',run:()=>{server.closeAllConnections?.();return server.listening?bounded(new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()))):undefined;}},
    {name:'employment lifecycle esbuild',run:()=>stop()},
  ],failure);}
}
