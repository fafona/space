//189 Inert callback. Root alone owns invocation, existing PG and teardown.
//Memory-only bundle; loopback-only HTTP; synthetic Auth/old parent initialization.
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
import {workArrangementParentMock} from './attendance-work-arrangement-browser.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url)),canonical='https://www.faolla.com';
const endpoint='/api/merchant-enterprise/attendance/missing-delegation',selfEndpoint='/api/merchant-enterprise/attendance/self',adminEndpoint='/api/merchant-enterprise/attendance/admin';
async function bounded(promise){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('missing_delegation_browser_timeout')),15000);})]);}finally{clearTimeout(timer);}}
async function assets(){
  const bundle=await build({absWorkingDir:root,entryPoints:['scripts/fixtures/attendance-missing-delegation-browser.tsx'],bundle:true,write:false,metafile:true,platform:'browser',format:'esm',target:['es2020'],jsx:'automatic',
    tsconfig:path.join(root,'tsconfig.json'),outfile:'qa.js',logLevel:'warning',define:{'process.env':'{}','process.env.NODE_ENV':'"development"'}});
  for(const name of Object.keys(bundle.metafile.inputs))assert(!/node:crypto|\.server\.ts$/.test(name),'missing_delegation_server_browser_import');
  const candidates=new Set();
  for(const name of Object.keys(bundle.metafile.inputs).filter(n=>/\.tsx?$/.test(n)&&!n.includes('node_modules'))){const ast=ts.createSourceFile(name,await readFile(path.join(root,name),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
    const visit=node=>{if(ts.isStringLiteral(node)||ts.isNoSubstitutionTemplateLiteral(node)||ts.isTemplateHead(node)||ts.isTemplateMiddle(node)||ts.isTemplateTail(node))node.text.split(/\s+/).filter(Boolean).forEach(v=>candidates.add(v));ts.forEachChild(node,visit);};visit(ast);}
  const css=(await compile('@import "tailwindcss";',{base:root,onDependency:()=>{}})).build([...candidates])
    +'body{margin:0;background:#f1f5f9;font-family:Arial,sans-serif}.qa-toolbar{padding:8px;background:#fff7ed;font-size:12px;overflow-wrap:anywhere}.qa-controls{display:flex;flex-wrap:wrap;gap:6px}.qa-controls button{border:1px solid #94a3b8;background:white;padding:6px}.qa-main{max-width:1000px;margin:auto;padding:8px;min-width:0}';
  return {js:bundle.outputFiles.find(f=>f.path.endsWith('.js')).contents,css};
}
export async function cleanupMissingDelegationBrowser(steps,primaryError=null){
  try{assert(Array.isArray(steps)&&steps.every(s=>s&&typeof s==='object'&&!Array.isArray(s)&&typeof s.name==='string'&&typeof s.run==='function'),'missing_delegation_cleanup_shape');await runAttendanceCleanupSteps(steps);}
  catch(error){if(primaryError)throw new AggregateError([primaryError,error],'missing_delegation_and_cleanup_failed',{cause:primaryError});throw error;}
}
export async function runMissingDelegationBrowserAcceptance({d,h,scope,handle,submit,missing,mq,employee,actor}){
  assert(d&&h&&scope&&handle&&submit&&missing&&mq&&employee&&actor&&scope.schema===d.owned.schema,'missing_delegation_browser_dependencies');
  // These are two real employee applications, created by the existing writer
  //before the read-only browser baseline, not fabricated response fixtures.
  const first=await submit(),second=await submit();
  const requests=[],errors=[],inflight=new Set(),dialogs=[],storageHistory=[],cspHistory=[];
  let files,browser,context,origin,page,closing=false,accept=true,dropPost=false,serverEnabled=true,stage='setup',failure=null,checks=0;
  const definitions=d.definitions(),protectedTables=d.inventory().filter(t=>!['merchant_attendance_missing_delegations','merchant_attendance_missing_delegation_revocations',
    'merchant_attendance_missing_delegation_decisions','merchant_attendance_missing_entries'].includes(t));
  const protectedBefore=d.fingerprint(protectedTables);
  const counts=()=>JSON.parse(d.exec("select jsonb_build_object('grants',(select count(*) from public.merchant_attendance_missing_delegations),'revocations',(select count(*) from public.merchant_attendance_missing_delegation_revocations),'decisions',(select count(*) from public.merchant_attendance_missing_delegation_decisions),'entries',(select count(*) from public.merchant_attendance_missing_entries));"));
  const beforeCounts=counts(),key=`faolla:attendance:missing-delegation:v1:${d.site}:delegate:${employee}`;
  const server=createServer((request,response)=>{if(!origin||request.headers.host!==new URL(origin).host||request.method!=='GET')return response.writeHead(403).end();
    response.setHeader('Cache-Control','no-store');response.setHeader('X-Content-Type-Options','nosniff');response.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; object-src 'none'");
    const u=new URL(request.url??'/',origin);if(u.search)return response.writeHead(403).end();
    if(u.pathname==='/')return response.writeHead(200,{'Content-Type':'text/html;charset=utf-8'}).end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>漏卡委托隔离验收</title><link rel="stylesheet" href="/qa.css"><div id="qa-root"></div><script type="module" src="/qa.js"></script></html>');
    if(u.pathname==='/qa.js')return response.writeHead(200,{'Content-Type':'text/javascript;charset=utf-8'}).end(files.js);if(u.pathname==='/qa.css')return response.writeHead(200,{'Content-Type':'text/css;charset=utf-8'}).end(files.css);return response.writeHead(403).end();});
  const region=()=>page.getByRole('region',{name:'漏卡审批委托',exact:true}),newRequests=()=>requests.filter(r=>r.path===endpoint),posts=()=>newRequests().filter(r=>r.method==='POST');
  const quiet=async()=>{await page.waitForLoadState('networkidle');await bounded(Promise.all([...inflight]));};
  const clickResponse=async(locator,{method='GET',mode,action,operationId,catalog}={})=>{
    const [response]=await Promise.all([page.waitForResponse(r=>{const u=new URL(r.url());if(u.pathname!==endpoint||r.request().method()!==method)return false;
      const body=method==='POST'?r.request().postDataJSON():null;return (!mode||(body?.query.mode??u.searchParams.get('mode'))===mode)
        &&(!action||(body?.command.action??body?.command.decision?.action)===action)&&(!operationId||u.searchParams.get('operationId')===operationId)&&(!catalog||u.searchParams.get('catalog')===catalog);}),locator.click()]);
    await response.finished();const text=await response.text();assert.equal(response.status(),200,text);return JSON.parse(text);
  };
  const open=async(access='delegate',off=false)=>{await page.getByRole('button',{name:off?'核对待确认漏卡委托操作':access==='owner'?'漏卡审批委托管理':'受托漏卡审批',exact:true}).click();await region().waitFor();};
  const close=async()=>{await region().getByRole('button',{name:'关闭漏卡委托',exact:true}).click();await page.getByRole('dialog',{name:'漏卡审批委托工作区',exact:true}).waitFor({state:'detached'});};
  const readGrantList=()=>clickResponse(region().getByRole('button',{name:'读取我的有效委托',exact:true}),{mode:'grants'});
  const requestDetail=async(grantId,requestId)=>{await readGrantList();const grantRow=region().locator(`[data-missing-delegation-grant-id="${grantId}"]`);
    await clickResponse(grantRow.getByRole('button',{name:'读取此委托待审申请',exact:true}),{mode:'list'});
    const row=region().getByRole('region',{name:'范围内待审漏卡',exact:true}).getByRole('listitem').filter({hasText:requestId});assert.equal(await row.count(),1);
    const response=await clickResponse(row.getByRole('button',{name:'读取受托申请详情',exact:true}),{mode:'detail'});await region().locator('[data-missing-delegation-detail]').waitFor();return response;};
  try{
    files=await assets();await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const address=server.address();assert(address&&typeof address==='object');origin=`http://127.0.0.1:${address.port}`;
    browser=await chromium.launch({headless:true});context=await browser.newContext({serviceWorkers:'block',acceptDownloads:false,viewport:{width:390,height:900}});
    await context.addInitScript(seed=>{Object.defineProperty(window,'__missingDelegationSeed',{value:seed});const set=Storage.prototype.setItem;set.call(sessionStorage,'qa-unrelated','keep');set.call(localStorage,'qa-unrelated','keep');
      const probe={writes:[],csp:[]};Object.defineProperty(window,'__missingDelegationProbe',{value:probe});for(const method of ['setItem','removeItem','clear']){const old=Storage.prototype[method];Storage.prototype[method]=function(...args){probe.writes.push({method,key:args[0]??null,local:this===localStorage,bytes:method==='setItem'?new TextEncoder().encode(args[1]).byteLength:0});return old.apply(this,args);};}
      document.addEventListener('securitypolicyviolation',event=>probe.csp.push(event.violatedDirective));
    },{site:d.site,owner:d.owner,employee});
    await context.route('**/*',route=>{if(closing)return route.abort().catch(()=>{});const task=(async()=>{const request=route.request(),url=new URL(request.url());assert.equal(url.origin,origin,'missing_delegation_external_request');
      if(['/','/qa.js','/qa.css'].includes(url.pathname)){assert.equal(request.method(),'GET');assert.equal(url.search,'');return route.continue();}
      assert(requests.length<45,'missing_delegation_browser_budget');const method=request.method(),access=request.headers()['x-qa-access'];assert(['owner','delegate'].includes(access));
      if([selfEndpoint,adminEndpoint].includes(url.pathname)){assert.equal(access,url.pathname===selfEndpoint?'delegate':'owner');const body=workArrangementParentMock(url,method,{site:d.site,worker:d.worker,zone:'UTC'});
        requests.push({path:url.pathname,method,status:200,access,synthetic:true});return route.fulfill({status:200,headers:{'content-type':'application/json','cache-control':'private, no-store'},body:JSON.stringify(body)});}
      assert.equal(url.pathname,endpoint,'missing_delegation_unexpected_endpoint');assert(newRequests().length<25);assert(['GET','POST'].includes(method));
      const text=request.postData();if(text)assert(Buffer.byteLength(text,'utf8')<=8192);const command=text?JSON.parse(text).command:null;
      const before=d.fingerprint(),response=await handle(new Request(canonical+url.pathname+url.search,{method,headers:{host:'www.faolla.com',origin:canonical,'sec-fetch-site':'same-origin',...(text?{'content-type':'application/json'}:{})},...(text?{body:text}:{})}),access,serverEnabled);
      const output=await response.text(),body=JSON.parse(output);if(method==='GET')assert.equal(d.fingerprint(),before,'missing_delegation_get_wrote');assert.equal(d.definitions(),definitions);assert.equal(d.fingerprint(protectedTables),protectedBefore,'missing_delegation_unrelated_facts_changed');
      requests.push({path:url.pathname,method,status:response.status,access,mode:command?JSON.parse(text).query.mode:url.searchParams.get('mode'),action:command?.action??command?.decision?.action??null,
        operationId:command?.operationId??command?.decision?.operationId??url.searchParams.get('operationId'),error:body.error??null});
      assert.equal(response.headers.get('cache-control'),'private, no-store');
      if(method==='POST'&&dropPost){dropPost=false;assert.equal(response.status,200,output);return route.abort('failed');}
      return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:output});
    })();inflight.add(task);void task.finally(()=>inflight.delete(task)).catch(()=>{});return task.catch(async error=>{if(!closing)errors.push(error.message);await route.abort().catch(()=>{});});});
    page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',error=>errors.push(error.message));page.on('popup',()=>errors.push('unexpected_popup'));
    page.on('dialog',dialog=>{const choice=accept;void(choice?dialog.accept():dialog.dismiss()).then(()=>dialogs.push({type:dialog.type(),accepted:choice})).catch(error=>{if(!closing)errors.push('dialog_failed:'+error.message);});});
    stage='default_off';await page.goto(origin);await quiet();assert.equal(newRequests().length,0);assert.equal(await page.getByRole('button',{name:'受托漏卡审批',exact:true}).count(),0);checks++;
    stage='owner_catalog_and_grant';await page.getByTestId('feature-on').click();await page.getByTestId('owner').click();await open('owner');assert.equal(newRequests().length,0);
    const home=await clickResponse(region().getByRole('button',{name:'读取漏卡委托列表',exact:true}),{mode:'list'});
    const selection=[['delegates','受托审批员工',employee],['workers','目标考勤员工',h.workerId],['locations','申请保存地点',d.location]];
    for(const [kind,label,identity] of selection){await clickResponse(region().getByRole('button',{name:'选择'+label,exact:true}),{catalog:kind});
      let row=region().locator(`[data-missing-delegation-catalog-id="${identity}"]`),pages=0;
      while(await row.count()===0){assert(++pages<=2,'missing_delegation_catalog_page_budget');await clickResponse(region().getByRole('button',{name:'下一页目录',exact:true}),{catalog:kind});row=region().locator(`[data-missing-delegation-catalog-id="${identity}"]`);}
      await row.getByRole('button',{name:'选用此'+label,exact:true}).click();}
    const now=Date.parse(home.readAt.slice(0,23)+'Z'),from=new Date(now-3600000).toISOString().slice(0,16),until=new Date(now+86400000).toISOString().slice(0,16);
    await region().getByLabel('委托开始时间（UTC）',{exact:true}).fill(from);await region().getByLabel('委托结束时间（UTC）',{exact:true}).fill(until);
    const reason='189 browser owner explicit delegation';await region().getByLabel('漏卡委托授权理由',{exact:true}).fill(reason);await region().getByLabel('确认漏卡审批委托',{exact:true}).check();
    accept=false;const escape=page.waitForEvent('dialog');await page.keyboard.press('Escape');await escape;await quiet();await region().waitFor();assert.equal(await region().getByLabel('漏卡委托授权理由',{exact:true}).inputValue(),reason);
    const denied=page.waitForEvent('dialog');await region().getByRole('button',{name:'关闭漏卡委托',exact:true}).click();await denied;await quiet();await region().waitFor();assert.equal(posts().length,0);accept=true;
    const granted=await clickResponse(region().getByRole('button',{name:'明确授予漏卡审批委托',exact:true}),{method:'POST',action:'grant'});const grantId=granted.receipt.grantId;
    await region().locator('[data-missing-delegation-receipt]').waitFor();await close();checks++;
    stage='delegate_real_approval';await page.getByTestId('delegate').click();await open();const reviewed=await requestDetail(grantId,first.operationId);assert.equal(reviewed.detail.canApprove,true);
    await region().getByLabel('受托漏卡审核理由',{exact:true}).fill('189 browser explicit approval');await region().getByLabel('确认受托漏卡审核',{exact:true}).check();
    const decided=await clickResponse(region().getByRole('button',{name:'明确批准受托漏卡',exact:true}),{method:'POST',action:'approve'});assert.equal(decided.receipt.actorId,actor);assert.equal(decided.receipt.status,'approved');await region().locator('[data-missing-delegation-receipt]').waitFor();
    assert.equal((await missing(mq({requestId:first.operationId}))).detail.status,'approved');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false,'missing_delegation_390_document_overflow');assert.equal(await region().evaluate(element=>element.scrollWidth>element.clientWidth+2),false,'missing_delegation_390_panel_overflow');checks++;
    stage='lost_decision_response';await requestDetail(grantId,second.operationId);const privateReason='189 browser private reason must not reappear during recovery';
    await region().getByLabel('受托漏卡审核理由',{exact:true}).fill(privateReason);await region().getByLabel('确认受托漏卡审核',{exact:true}).check();dropPost=true;
    const failed=page.waitForEvent('requestfailed',{predicate:request=>new URL(request.url()).pathname===endpoint&&request.method()==='POST'});await region().getByRole('button',{name:'明确驳回受托漏卡',exact:true}).click();await failed;await quiet();await region().locator('[data-missing-delegation-pending]').waitFor();
    const pendingRaw=await page.evaluate(storageKey=>sessionStorage.getItem(storageKey),key);assert(pendingRaw);const operationId=JSON.parse(pendingRaw).command.decision.operationId,postCount=posts().length;assert.equal(postCount,3);
    assert(!(await region().innerText()).includes(privateReason));const probeBefore=await page.evaluate(()=>window.__missingDelegationProbe);storageHistory.push(...probeBefore.writes);cspHistory.push(...probeBefore.csp);
    stage='flagoff_minimal_recovery';serverEnabled=false;const beforeReload=newRequests().length;await page.reload();await quiet();assert.equal(newRequests().length,beforeReload);assert.equal(posts().length,postCount);
    await open('delegate',true);await region().locator('[data-missing-delegation-pending]').waitFor();assert(!(await region().innerText()).includes(privateReason));
    const recovered=await clickResponse(region().getByRole('button',{name:'核对原漏卡委托编号',exact:true}),{mode:'recover',operationId});assert.equal(recovered.receipt.operationId,operationId);assert.equal(recovered.receipt.status,'rejected');assert.equal(recovered.detail,null);assert.deepEqual(recovered.items,[]);assert.deepEqual(recovered.grants,[]);
    await region().locator('[data-missing-delegation-receipt]').waitFor();assert(!(await region().innerText()).includes(privateReason));assert.equal(posts().length,postCount);assert.equal(await page.evaluate(storageKey=>sessionStorage.getItem(storageKey),key),null);
    stage='flagoff_recovered_receipt_focus';const beforeFocus=newRequests().length;
    await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await quiet();await region().locator('[data-missing-delegation-receipt]').waitFor();
    assert.equal(await page.getByRole('dialog',{name:'漏卡审批委托工作区',exact:true}).count(),1);assert(!(await region().innerText()).includes(privateReason));
    assert.equal(newRequests().length,beforeFocus);assert.equal(posts().length,postCount);
    assert.equal((await missing(mq({requestId:second.operationId}))).detail.status,'rejected');await close();
    await page.getByRole('button',{name:'核对待确认漏卡委托操作',exact:true}).waitFor({state:'detached'});assert.equal(newRequests().length,beforeFocus);checks++;
    const probe=await page.evaluate(()=>({writes:window.__missingDelegationProbe.writes,csp:window.__missingDelegationProbe.csp,local:localStorage.getItem('qa-unrelated'),session:sessionStorage.getItem('qa-unrelated')}));
    storageHistory.push(...probe.writes);cspHistory.push(...probe.csp);assert.equal(probe.local,'keep');assert.equal(probe.session,'keep');assert.deepEqual(cspHistory,[]);
    assert(storageHistory.every(item=>!item.local&&item.method!=='clear'&&item.key.startsWith(`faolla:attendance:missing-delegation:v1:${d.site}:`)&&item.bytes<=8192));
    const after=counts();assert.deepEqual(after,{grants:beforeCounts.grants+1,revocations:beforeCounts.revocations,decisions:beforeCounts.decisions+2,entries:beforeCounts.entries+2});
    assert.equal(d.fingerprint(protectedTables),protectedBefore);assert.equal(d.definitions(),definitions);assert.deepEqual(errors,[]);
    return {checks,requests:requests.length,delegationRequests:newRequests().length,posts:postCount,preparedRealSelfRequests:2,grantDelta:1,decisionAuthorityDelta:2,oldDecisionEntryDelta:2,
      actualAdminAndSelfParents:true,parentInitializationSynthetic:true,syntheticAuth:true,actualHandlerServiceSql:true,defaultOff:true,dirtyEscapeAndClose:true,
      flagOffRecoveryOnly:true,recoveredReceiptSurvivesFocus:true,settledEntryDisappearsOnClose:true,noPendingReasonDisclosure:true,width390:true,readOnlyGetFingerprints:true,oldSelfResults:true,externalRequests:0,diskBundles:false};
  }catch(error){const diagnostic={stage,message:String(error?.message??error).slice(0,1500),stack:String(error?.stack??'').split('\n').slice(0,2).join('\n'),requests:requests.slice(-8),errors};
    if(page)diagnostic.ui=await page.locator('body').innerText().then(text=>text.slice(-5500)).catch(()=>'<closed>');failure=Error('missing_delegation_browser_failed '+JSON.stringify(diagnostic),{cause:error});throw failure;
  }finally{closing=true;await cleanupMissingDelegationBrowser([
    {name:'missing delegation inflight',run:()=>bounded(Promise.allSettled([...inflight]))},
    {name:'missing delegation context',run:()=>context?bounded(context.close()):undefined},
    {name:'missing delegation browser',run:()=>browser?bounded(browser.close()):undefined},
    {name:'missing delegation HTTP listener',run:()=>{server.closeAllConnections?.();return server.listening?bounded(new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()))):undefined;}},
    {name:'missing delegation esbuild service',run:()=>stop()},
  ],failure);}
}
