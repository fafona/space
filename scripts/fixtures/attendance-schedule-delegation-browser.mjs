// Inert unless called by the root's existing owned native runner. No disk bundle,
//external origin, new database, production Auth, or unrelated browser context.
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
const root=fileURLToPath(new URL('../../',import.meta.url)),canonical='https://www.faolla.com';
const endpoint='/api/merchant-enterprise/attendance/schedule-delegation',selfEndpoint='/api/merchant-enterprise/attendance/self',adminEndpoint='/api/merchant-enterprise/attendance/admin';
async function bounded(promise){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('schedule_delegation_browser_timeout')),15000);})]);}finally{clearTimeout(timer);}}
async function assets(){
  const bundle=await build({absWorkingDir:root,entryPoints:['scripts/fixtures/attendance-schedule-delegation-browser.tsx'],bundle:true,write:false,metafile:true,platform:'browser',format:'esm',target:['es2020'],jsx:'automatic',
    tsconfig:path.join(root,'tsconfig.json'),outfile:'qa.js',logLevel:'warning',define:{'process.env':'{}','process.env.NODE_ENV':'"development"'}});
  for(const name of Object.keys(bundle.metafile.inputs))assert(!/node:crypto|\.server\.ts$/.test(name),'schedule_delegation_server_browser_import');
  const candidates=new Set();for(const name of Object.keys(bundle.metafile.inputs).filter(n=>/\.tsx?$/.test(n)&&!n.includes('node_modules'))){
    const ast=ts.createSourceFile(name,await readFile(path.join(root,name),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
    const visit=node=>{if(ts.isStringLiteral(node)||ts.isNoSubstitutionTemplateLiteral(node)||ts.isTemplateHead(node)||ts.isTemplateMiddle(node)||ts.isTemplateTail(node))node.text.split(/\s+/).filter(Boolean).forEach(v=>candidates.add(v));ts.forEachChild(node,visit);};visit(ast);}
  const css=(await compile('@import "tailwindcss";',{base:root,onDependency:()=>{}})).build([...candidates])
    +'body{margin:0;background:#f1f5f9;font-family:Arial,sans-serif}.qa-toolbar{padding:8px;background:#fff7ed;font-size:12px;overflow-wrap:anywhere}.qa-controls{display:flex;flex-wrap:wrap;gap:6px}.qa-controls button{border:1px solid #94a3b8;background:white;padding:6px}.qa-main{max-width:1000px;margin:auto;padding:8px;min-width:0}';
  return {js:bundle.outputFiles.find(f=>f.path.endsWith('.js')).contents,css};
}
// A fixture-only rendering of the selected instant in the actual returned zone.
function wall(value,zone){const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(value)).map(x=>[x.type,x.value]));
  const local=`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`,minutes=Math.round((Date.parse(local+':00Z')-Date.parse(value))/60000),sign=minutes<0?'-':'+';
  return {local,offset:`${sign}${String(Math.floor(Math.abs(minutes)/60)).padStart(2,'0')}:${String(Math.abs(minutes)%60).padStart(2,'0')}`};}
export async function runScheduleDelegationBrowserAcceptance(ctx){
  assert(ctx&&typeof ctx.createBrowserSubject==='function'&&typeof ctx.handleSchedule==='function'&&typeof ctx.handleAdmin==='function'&&typeof ctx.handleSelf==='function'&&typeof ctx.fingerprint==='function','schedule_delegation_browser_ports');
  const subject=await ctx.createBrowserSubject({grant:false});
  for(const key of ['site','owner','delegateEmployee','delegateAuth','worker','employee','location','fromDate','throughDate'])assert.equal(typeof subject[key],'string',`schedule_delegation_subject_${key}`);
  assert(Array.isArray(subject.slots)&&subject.slots.length>0&&subject.slots.length<=3,'schedule_delegation_browser_small_slots');
  assert(subject.grantInput?.validFrom&&subject.grantInput?.validUntil,'schedule_delegation_grant_window');
  const scope=ctx.scope??ctx.d?.owned;assert(scope?.schema&&ctx.d?.owned?.schema===scope.schema,'schedule_delegation_owned_schema');
  const requests=[],errors=[],inflight=new Set(),storageHistory=[],cspHistory=[];
  let files,browser,context,page,origin,closing=false,accept=true,dropPost=false,serverEnabled=true,stage='setup',failure=null,checks=0,holdGet=false,releaseGet=null,heldObserved=null;
  const key=`faolla:attendance:schedule-delegation:v1:${subject.site}:delegate:${subject.delegateEmployee}`;
  const server=createServer((request,response)=>{if(!origin||request.headers.host!==new URL(origin).host||request.method!=='GET')return response.writeHead(403).end();
    response.setHeader('Cache-Control','no-store');response.setHeader('X-Content-Type-Options','nosniff');response.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; object-src 'none'");
    const u=new URL(request.url??'/',origin);if(u.search)return response.writeHead(403).end();
    if(u.pathname==='/')return response.writeHead(200,{'Content-Type':'text/html;charset=utf-8'}).end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>主管排班隔离验收</title><link rel="stylesheet" href="/qa.css"><div id="qa-root"></div><script type="module" src="/qa.js"></script></html>');
    if(u.pathname==='/qa.js')return response.writeHead(200,{'Content-Type':'text/javascript;charset=utf-8'}).end(files.js);if(u.pathname==='/qa.css')return response.writeHead(200,{'Content-Type':'text/css;charset=utf-8'}).end(files.css);return response.writeHead(403).end();});
  const region=()=>page.getByRole('region',{name:'排班委托',exact:true}),ownRequests=()=>requests.filter(r=>r.path===endpoint),posts=()=>ownRequests().filter(r=>r.method==='POST');
  const quiet=async()=>{await page.waitForLoadState('networkidle');await bounded(Promise.all([...inflight]));};
  const clickResponse=async(locator,{method='GET',mode,action,operationId,catalog}={})=>{
    const [response]=await Promise.all([page.waitForResponse(r=>{const u=new URL(r.url());if(u.pathname!==endpoint||r.request().method()!==method)return false;
      const body=method==='POST'?r.request().postDataJSON():null;return (!mode||(body?.query.mode??u.searchParams.get('mode'))===mode)&&(!action||(body?.command.action??body?.command.decision?.action)===action)
        &&(!operationId||u.searchParams.get('operationId')===operationId)&&(!catalog||u.searchParams.get('catalog')===catalog);}),locator.click()]);
    await response.finished();const text=await response.text();assert.equal(response.status(),200,text);return JSON.parse(text);
  };
  const open=async(access='delegate',off=false)=>{await page.getByRole('button',{name:access==='owner'?(off?'排班授权核验／撤销':'主管排班授权'):(off?'核对待确认排班委托操作':'受托排班'),exact:true}).click();await region().waitFor();};
  const close=async()=>{await region().getByRole('button',{name:'关闭排班委托',exact:true}).click();await page.getByRole('dialog',{name:'排班委托工作区',exact:true}).waitFor({state:'detached'});};
  const readSchedule=async grantId=>{
    await clickResponse(region().getByRole('button',{name:'读取我的排班授权',exact:true}),{mode:'grants'});
    const article=region().locator(`[data-schedule-delegation-grant="${grantId}"]`);assert.equal(await article.count(),1);
    await article.locator('..').getByRole('button',{name:'选择此排班授权',exact:true}).click();
    await region().getByLabel('受托排班开始日期',{exact:true}).fill(subject.fromDate);await region().getByLabel('受托排班结束日期',{exact:true}).fill(subject.throughDate);
    const result=await clickResponse(region().getByRole('button',{name:'读取授权排班',exact:true}),{mode:'schedule'});await region().locator('[data-schedule-delegation-schedule]').waitFor();return result.schedule;
  };
  try{
    files=await assets();await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const address=server.address();assert(address&&typeof address==='object');origin=`http://127.0.0.1:${address.port}`;
    browser=await chromium.launch({headless:true});context=await browser.newContext({serviceWorkers:'block',acceptDownloads:false,viewport:{width:390,height:900}});
    await context.addInitScript(seed=>{Object.defineProperty(window,'__scheduleDelegationSeed',{value:seed});const set=Storage.prototype.setItem;set.call(sessionStorage,'qa-unrelated','keep');set.call(localStorage,'qa-unrelated','keep');
      const probe={writes:[],csp:[]};Object.defineProperty(window,'__scheduleDelegationProbe',{value:probe});for(const method of ['setItem','removeItem','clear']){const old=Storage.prototype[method];Storage.prototype[method]=function(...args){probe.writes.push({method,key:args[0]??null,local:this===localStorage,bytes:method==='setItem'?new TextEncoder().encode(args[1]).byteLength:0});return old.apply(this,args);};}
      document.addEventListener('securitypolicyviolation',event=>probe.csp.push(event.violatedDirective));
    },{site:subject.site,owner:subject.owner,employee:subject.delegateEmployee});
    await context.route('**/*',route=>{if(closing)return route.abort().catch(()=>{});const task=(async()=>{const request=route.request(),url=new URL(request.url());assert.equal(url.origin,origin,'schedule_delegation_external_request');
      if(['/','/qa.js','/qa.css'].includes(url.pathname)){assert.equal(request.method(),'GET');assert.equal(url.search,'');return route.continue();}
      assert(requests.length<50,'schedule_delegation_browser_budget');const method=request.method(),access=request.headers()['x-qa-access'];assert(['owner','delegate'].includes(access));
      assert([endpoint,adminEndpoint,selfEndpoint].includes(url.pathname),'schedule_delegation_unexpected_endpoint');const text=request.postData();if(text)assert(Buffer.byteLength(text,'utf8')<=8192);
      const body=text?JSON.parse(text):null,command=body?.command??null;
      const mapped=new Request(canonical+url.pathname+url.search,{method,headers:{host:'www.faolla.com',origin:canonical,'sec-fetch-site':'same-origin',...(text?{'content-type':'application/json'}:{})},...(text?{body:text}:{})});
      const before=await ctx.fingerprint();let response;
      if(url.pathname===endpoint){assert(ownRequests().length<30);assert(['GET','POST'].includes(method));response=await ctx.handleSchedule(mapped,{enabled:()=>serverEnabled});}
      else{assert.equal(method,'GET');assert.equal(access,url.pathname===adminEndpoint?'owner':'delegate');response=await(url.pathname===adminEndpoint?ctx.handleAdmin(mapped):ctx.handleSelf(mapped));}
      const output=await response.text(),payload=JSON.parse(output);if(method==='GET')assert.equal(await ctx.fingerprint(),before,'schedule_delegation_get_wrote');
      requests.push({path:url.pathname,method,status:response.status,access,mode:command?body.query.mode:url.searchParams.get('mode'),action:command?.action??command?.decision?.action??null,
        operationId:command?.operationId??command?.decision?.operationId??url.searchParams.get('operationId'),error:payload.error??null});
      let heldResponse=false;
      if(url.pathname===endpoint){assert.equal(response.headers.get('cache-control'),'private, no-store');if(method==='POST'&&dropPost){dropPost=false;assert.equal(response.status,200,output);return route.abort('failed');}
        if(method==='GET'&&holdGet){heldResponse=true;holdGet=false;await new Promise(resolve=>{releaseGet=resolve;heldObserved?.();});}}
      try{return await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:output});}catch(error){if(heldResponse&&request.failure())return;throw error;}
    })();inflight.add(task);void task.finally(()=>inflight.delete(task)).catch(()=>{});return task.catch(async error=>{if(!closing)errors.push(error.message);await route.abort().catch(()=>{});});});
    page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',error=>errors.push(error.message));page.on('popup',()=>errors.push('unexpected_popup'));
    page.on('dialog',dialog=>{void(accept?dialog.accept():dialog.dismiss()).catch(error=>{if(!closing)errors.push('dialog_failed:'+error.message);});});
    stage='default_off';await page.goto(origin);await quiet();assert.equal(ownRequests().length,0);assert.equal(await page.getByRole('button',{name:'受托排班',exact:true}).count(),0);checks++;
    stage='owner_explicit_catalog_grant';await page.getByTestId('feature-on').click();await page.getByTestId('owner').click();await quiet();await open('owner');assert.equal(ownRequests().length,0);
    await clickResponse(region().getByRole('button',{name:'读取排班授权列表',exact:true}),{mode:'list'});
    for(const [catalog,label,identity] of [['delegates','排班主管',subject.delegateEmployee],['workers','目标考勤员工',subject.worker],['locations','授权地点',subject.location]]){
      await clickResponse(region().getByRole('button',{name:'选择'+label,exact:true}),{catalog});let row=region().locator(`[data-schedule-delegation-catalog-id="${identity}"]`),pages=0;
      while(await row.count()===0){assert(++pages<=2,'schedule_delegation_catalog_page_budget');await clickResponse(region().getByRole('button',{name:'下一页排班授权目录',exact:true}),{catalog});row=region().locator(`[data-schedule-delegation-catalog-id="${identity}"]`);}
      await row.getByRole('button',{name:'选用此'+label,exact:true}).click();}
    for(const name of ['授权发布排班','授权取消班次','包含授权前已存在未来班次'])assert.equal(await region().getByLabel(name,{exact:true}).isChecked(),false);
    await region().getByLabel('授权发布排班',{exact:true}).check();await region().getByLabel('授权取消班次',{exact:true}).check();
    await region().getByLabel('排班授权开始（UTC）',{exact:true}).fill(subject.grantInput.validFrom.slice(0,16));await region().getByLabel('排班授权结束（UTC）',{exact:true}).fill(subject.grantInput.validUntil.slice(0,16));
    const grantReason='198 browser explicit bounded schedule authority';await region().getByLabel('排班授权理由',{exact:true}).fill(grantReason);
    accept=false;const escape=page.waitForEvent('dialog');await page.keyboard.press('Escape');await escape;await region().waitFor();assert.equal(await region().getByLabel('排班授权理由',{exact:true}).inputValue(),grantReason);assert.equal(posts().length,0);accept=true;
    await region().getByLabel('确认排班授权范围',{exact:true}).check();const granted=await clickResponse(region().getByRole('button',{name:'明确授予排班委托',exact:true}),{method:'POST',action:'grant'});
    assert.equal(granted.receipt.action,'grant');const grantId=granted.receipt.grantId;subject.grantId=grantId;await region().locator('[data-schedule-delegation-receipt="grant"]').waitFor();await close();checks++;
    stage='delegate_preview_publish';await page.getByTestId('delegate').click();await quiet();await open();const schedule=await readSchedule(grantId);assert.equal(schedule.rangeLimited,false);assert(schedule.grant.usableActions.includes('publish'));
    const form=region().getByRole('form',{name:'受托班次预览与发布',exact:true});
    for(let n=0;n<subject.slots.length;n++){if(n)await form.getByRole('button',{name:'增加班次段',exact:true}).click();for(const [i,label] of [[0,'开始'],[1,'结束']]){const value=wall(subject.slots[n][i],schedule.timeZone);
      await form.getByLabel(`第${n+1}段${label}`,{exact:true}).fill(value.local);const offset=form.getByLabel(`第${n+1}段${label}偏移`,{exact:true});if(await offset.count())await offset.selectOption(value.offset);}}
    const publishReason='198 browser explicit planned slots';await form.getByLabel('受托排班发布理由',{exact:true}).fill(publishReason);await form.getByRole('button',{name:'预览受托班次',exact:true}).click();
    await form.locator('[data-schedule-delegation-preview]').waitFor();for(const pair of subject.slots)for(const value of pair)assert((await form.innerText()).includes(value));
    await form.getByLabel('确认受托排班预览',{exact:true}).check();const published=await clickResponse(form.getByRole('button',{name:'明确发布受托班次',exact:true}),{method:'POST',action:'publish'});
    assert.equal(published.receipt.actorId,subject.delegateAuth);await region().locator('[data-schedule-delegation-receipt="publish"]').waitFor();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false,'schedule_delegation_390_document_overflow');assert.equal(await region().evaluate(element=>element.scrollWidth>element.clientWidth+2),false,'schedule_delegation_390_panel_overflow');checks++;
    stage='cancel_lost_response';const current=await readSchedule(grantId),entry=current.entries.find(e=>e.startAt===subject.slots[0][0]&&e.endAt===subject.slots[0][1]);assert(entry?.canCancel);
    const card=region().locator(`[data-schedule-delegation-slot="${entry.slotId}"]`),privateReason='198 private cancellation intent not shown by recovery';
    await card.getByLabel('取消班次理由',{exact:true}).fill(privateReason);await card.getByLabel('确认明确取消受托班次',{exact:true}).check();dropPost=true;
    const failed=page.waitForEvent('requestfailed',{predicate:request=>new URL(request.url()).pathname===endpoint&&request.method()==='POST'});await card.getByRole('button',{name:'明确取消受托班次',exact:true}).click();await failed;await quiet();await region().locator('[data-schedule-delegation-pending]').waitFor();
    const pendingRaw=await page.evaluate(storageKey=>sessionStorage.getItem(storageKey),key);assert(pendingRaw);const operationId=JSON.parse(pendingRaw).command.decision.operationId,postCount=posts().length;assert.equal(postCount,3);assert(!(await region().innerText()).includes(privateReason));
    const earlier=await page.evaluate(()=>window.__scheduleDelegationProbe);storageHistory.push(...earlier.writes);cspHistory.push(...earlier.csp);
    stage='flagoff_original_get';serverEnabled=false;const beforeReload=ownRequests().length;await page.reload();await quiet();assert.equal(ownRequests().length,beforeReload);await open('delegate',true);await region().locator('[data-schedule-delegation-pending]').waitFor();
    const recovered=await clickResponse(region().getByRole('button',{name:'核对原排班委托编号',exact:true}),{mode:'recover',operationId});assert.equal(recovered.receipt.operationId,operationId);assert.equal(recovered.receipt.action,'cancel');assert.equal(recovered.detail,null);assert.equal(recovered.schedule,null);assert.deepEqual(recovered.grants,[]);assert.deepEqual(recovered.catalogItems,[]);
    await region().locator('[data-schedule-delegation-receipt="cancel"]').waitFor();assert(!(await region().innerText()).includes(privateReason));assert.equal(posts().length,postCount);assert.equal(await page.evaluate(storageKey=>sessionStorage.getItem(storageKey),key),null);
    const beforeFocus=ownRequests().length;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await quiet();await region().locator('[data-schedule-delegation-receipt="cancel"]').waitFor();assert.equal(ownRequests().length,beforeFocus);await close();await page.getByRole('button',{name:'核对待确认排班委托操作',exact:true}).waitFor({state:'detached'});checks++;
    stage='owner_flagoff_safe_revoke';await page.getByTestId('owner').click();await quiet();await open('owner',true);await clickResponse(region().getByRole('button',{name:'读取排班授权列表',exact:true}),{mode:'list'});
    await clickResponse(region().locator(`[data-schedule-delegation-grant="${grantId}"]`).locator('..').getByRole('button',{name:'选择此排班授权',exact:true}),{mode:'detail'});
    await region().getByLabel('撤权理由',{exact:true}).fill('198 browser paused-feature safe revoke');await region().getByLabel('确认明确撤销排班委托',{exact:true}).check();
    const revoked=await clickResponse(region().getByRole('button',{name:'明确撤销排班委托',exact:true}),{method:'POST',action:'revoke'});assert.equal(revoked.receipt.action,'revoke');assert.equal(revoked.receipt.grantRevision,2);await region().locator('[data-schedule-delegation-receipt="revoke"]').waitFor();checks++;
    stage='hidden_late_read';const held=new Promise(resolve=>{heldObserved=resolve;});holdGet=true;await region().getByRole('button',{name:'读取排班授权列表',exact:true}).click();await bounded(held);
    await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});releaseGet();releaseGet=null;await quiet();
    assert.equal(await region().locator('[data-schedule-delegation-grant]').count(),0);assert.equal(await region().locator('[data-schedule-delegation-receipt]').count(),0);const afterHidden=ownRequests().length;
    await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));});await quiet();assert.equal(ownRequests().length,afterHidden);await close();checks++;
    const probe=await page.evaluate(()=>({writes:window.__scheduleDelegationProbe.writes,csp:window.__scheduleDelegationProbe.csp,local:localStorage.getItem('qa-unrelated'),session:sessionStorage.getItem('qa-unrelated')}));
    storageHistory.push(...probe.writes);cspHistory.push(...probe.csp);assert.equal(probe.local,'keep');assert.equal(probe.session,'keep');assert.deepEqual(cspHistory,[]);
    assert(storageHistory.every(item=>!item.local&&item.method!=='clear'&&item.key.startsWith(`faolla:attendance:schedule-delegation:v1:${subject.site}:`)&&item.bytes<=8192));assert.equal(posts().length,4);assert.deepEqual(errors,[]);
    return {checks,requests:requests.length,delegationRequests:ownRequests().length,posts:posts().length,actualAdminAndSelfParents:true,actualParentReads:true,syntheticAuth:true,actualHandlerServiceSql:true,
      realCatalogGrant:true,explicitPublishAndCancel:true,publishedSlotCount:subject.slots.length,defaultOffNoNewRequests:true,dirtyEscapeDismissed:true,flagOffRecoveryOnly:true,ownerFlagOffSafeRevoke:true,
      recoveredReceiptSurvivesFocus:true,noPendingBodyDisclosure:true,hiddenLateReadCleared:true,width390:true,readOnlyGetFingerprints:true,independentOuterRecoveryNotCovered:true,externalRequests:0,diskBundles:false};
  }catch(error){const diagnostic={stage,message:String(error?.message??error).slice(0,1500),stack:String(error?.stack??'').split('\n').slice(0,2).join('\n'),requests:requests.slice(-8),errors};
    if(page)diagnostic.ui=await page.locator('body').innerText().then(text=>text.slice(-5500)).catch(()=>'<closed>');failure=Error('schedule_delegation_browser_failed '+JSON.stringify(diagnostic),{cause:error});throw failure;
  }finally{closing=true;releaseGet?.();try{await runAttendanceCleanupSteps([
    {name:'schedule delegation inflight',run:()=>bounded(Promise.allSettled([...inflight]))},
    {name:'schedule delegation context',run:()=>context?bounded(context.close()):undefined},
    {name:'schedule delegation browser',run:()=>browser?bounded(browser.close()):undefined},
    {name:'schedule delegation HTTP listener',run:()=>{server.closeAllConnections?.();return server.listening?bounded(new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()))):undefined;}},
    {name:'schedule delegation esbuild service',run:()=>stop()},
  ]);}catch(error){if(failure)throw new AggregateError([failure,error],'schedule_delegation_and_cleanup_failed',{cause:failure});throw error;}}
}
