// Real readonly history UI -> actual handlers/services -> 132/131 SQL.
// Synthetic auth and entitlement, loopback only, no production or new cluster.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {build} from 'esbuild';
import {compile} from '@tailwindcss/node';
import ts from 'typescript';
import {chromium} from 'playwright';
import {prepareRuleCaptureHistoryNativeFixture} from './merchant-attendance-rule-capture-history-native.mjs';
import {lifecycleId as id,lifecycleJson as json} from './merchant-attendance-lifecycle-native-support.mjs';
import {runAttendanceCleanupSteps} from './fixtures/attendance-cleanup.mjs';

const root=fileURLToPath(new URL('../',import.meta.url)),require=createRequire(import.meta.url),canonical='https://www.faolla.com';
const historyPath='/api/merchant-enterprise/attendance/rule-capture-history',capturePath='/api/merchant-enterprise/attendance/rule-captures';
const siteId='99990001',ownerId=id(99),workerId=id(201),secondWorker=id(202);
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
async function bounded(promise){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('rule_capture_history_browser_timeout')),15000);})]);}finally{clearTimeout(timer);}}
async function assets(){
  const bundle=await build({absWorkingDir:root,entryPoints:['scripts/fixtures/attendance-rule-capture-history-browser.tsx'],bundle:true,write:false,metafile:true,
    platform:'browser',format:'esm',target:['es2020'],jsx:'automatic',tsconfig:path.join(root,'tsconfig.json'),outfile:'qa.js',
    define:{'process.env':'{}','process.env.NODE_ENV':'"development"'},logLevel:'warning'});
  const candidates=new Set();
  for(const filename of Object.keys(bundle.metafile.inputs).filter(name=>/\.tsx?$/.test(name)&&!name.includes('node_modules'))){
    const source=ts.createSourceFile(filename,await readFile(path.join(root,filename),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
    const visit=node=>{if(ts.isStringLiteral(node)||ts.isNoSubstitutionTemplateLiteral(node)||ts.isTemplateHead(node)||ts.isTemplateMiddle(node)||ts.isTemplateTail(node))
      node.text.split(/\s+/).filter(Boolean).forEach(candidate=>candidates.add(candidate));ts.forEachChild(node,visit);};visit(source);
  }
  const css=(await compile('@import "tailwindcss";',{base:root,onDependency:()=>{}})).build([...candidates])
    +'body{margin:0;background:#f1f5f9;font-family:Arial,sans-serif}.qa-toolbar{padding:12px;background:#fff7ed;font-size:13px;overflow-wrap:anywhere}.qa-controls{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}.qa-controls button,.qa-controls select{max-width:100%;background:white;border:1px solid #94a3b8;padding:6px}.qa-main{max-width:1160px;margin:auto;padding:12px;min-width:0}';
  return {javascript:bundle.outputFiles.find(file=>file.path.endsWith('.js')).contents,css};
}

export async function checkAttendanceRuleCaptureHistoryBrowser(native,scope){
  const [admin,launcher]=await Promise.all(['src/components/enterprise/MerchantAttendanceAdminPanel.tsx','src/components/enterprise/MerchantAttendanceRuleCaptureHistoryLauncher.tsx'].map(filename=>readFile(path.join(root,filename),'utf8')));
  const entry=admin.match(/<RuleCaptureHistoryLauncher\b[\s\S]*?\/>/g);assert.equal(entry?.length,1);
  assert(entry[0].includes('key={`rule-capture-history:${state.authorizationEpoch}`}'));
  assert(entry[0].includes('siteId={siteId} ownerId={ownerId} workerId={item.id} apiFetch={apiFetch}'));assert(!/\benabled\s*=/.test(entry[0]));
  assert(entry[0].includes('active={!busy && !state.pending && !editor && state.phase === "ready" && !exceptionOpen && !correctionReviewOpen && !correctionControlsOpen && !revisionApprovalOpen && !(timesheetEnabled && timesheetOpen)}'));
  assert(launcher.includes('process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_RULE_CAPTURE_HISTORY_ENABLED === "1"'));assert(launcher.includes('.showModal()'));
  const data=await prepareRuleCaptureHistoryNativeFixture(native,scope),files=await assets();
  const {handleRuleCaptureHistory}=require('../src/app/api/merchant-enterprise/attendance/rule-capture-history/route-handler.ts');
  const {handleRuleCaptures}=require('../src/app/api/merchant-enterprise/attendance/rule-captures/route-handler.ts');
  const {executeRuleCaptureHistory}=require('../src/lib/merchantAttendanceRuleCaptureHistory.server.ts');
  const {executeRuleCaptures}=require('../src/lib/merchantAttendanceRuleCaptures.server.ts');
  const {RULE_CAPTURE_HISTORY_ERRORS}=require('../src/lib/merchantAttendanceRuleCaptureHistory.ts');
  const {RULE_CAPTURES_ERRORS}=require('../src/lib/merchantAttendanceRuleCaptures.ts');
  const {MerchantEnterpriseAccessError}=require('../src/lib/merchantEnterpriseAuth.server.ts');
  const before=data.fingerprint(),definitions=data.definitions();
  const requests=[],errors=[],pending=new Set(),gates=new Set();let browser,origin,closing=false,moduleEnabled=true,authMode='owner',hold=null,checks=0,historyReads=0,captureReads=0;
  const service={rpc:async(name,args)=>{
    assert([ownerId,id(98)].includes(args.p_auth_user_id));assert.equal(args.p_query.siteId,siteId);assert([workerId,secondWorker].includes(args.p_query.workerId));
    const saved=data.fingerprint();
    try{
      if(name==='faolla_attendance_rule_capture_history_v1'){
        historyReads++;assert.deepEqual(Object.keys(args).sort(),['p_auth_user_id','p_query']);
        return {data:JSON.parse(data.exec(`set local role service_role;select public.faolla_attendance_rule_capture_history_v1(${json(args.p_query)},'${args.p_auth_user_id}');`)),error:null};
      }
      assert.equal(name,'faolla_attendance_rule_captures_v1');captureReads++;assert.deepEqual(Object.keys(args).sort(),['p_auth_user_id','p_command','p_module_enabled','p_query']);assert.equal(args.p_command,null);
      return {data:JSON.parse(data.exec(`set local role service_role;select public.faolla_attendance_rule_captures_v1(${json(args.p_query)},'${args.p_auth_user_id}',null,${args.p_module_enabled?'true':'false'});`)),error:null};
    }catch(error){const code=String(error).match(/ERROR:\s+(?:[0-9A-Z]{5}:\s+)?([a-z_]+)(?=\r?\n|$)/)?.[1];
      if(!Object.hasOwn({...RULE_CAPTURE_HISTORY_ERRORS,...RULE_CAPTURES_ERRORS},code??''))throw error;return {data:null,error:{message:code}};
    }finally{assert.equal(data.fingerprint(),saved,'history_or_detail_read_changed_facts');}
  }};
  const dependencies=(actor,isHistory)=>({enabled:()=>true,authenticate:async()=>{
    if(authMode==='unauthenticated')throw new MerchantEnterpriseAccessError('unauthorized',401);
    return {user:{id:authMode==='wrong-owner'?id(98):actor},authenticationMethods:['password']};},allow:()=>true,
    entitlement:async site=>{assert.equal(site,siteId);return {permissionConfig:{allowEnterpriseManagement:true,allowEmployeeAttendance:moduleEnabled}};},
    execute:input=>isHistory?executeRuleCaptureHistory(input,service):executeRuleCaptures(input,service)});
  const server=createServer((request,response)=>{
    if(!origin||request.headers.host!==new URL(origin).host||request.method!=='GET')return response.writeHead(403).end();
    response.setHeader('Cache-Control','no-store');response.setHeader('X-Content-Type-Options','nosniff');
    response.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'");
    const url=new URL(request.url??'/',origin);if(url.search)return response.writeHead(403).end();
    if(url.pathname==='/')return response.writeHead(200,{'Content-Type':'text/html;charset=utf-8'}).end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>隔离留存历史验收</title><link rel="stylesheet" href="/qa.css"><div id="qa-root"></div><script type="module" src="/qa.js"></script></html>');
    if(url.pathname==='/qa.js')return response.writeHead(200,{'Content-Type':'text/javascript;charset=utf-8'}).end(files.javascript);
    if(url.pathname==='/qa.css')return response.writeHead(200,{'Content-Type':'text/css;charset=utf-8'}).end(files.css);return response.writeHead(403).end();
  });
  const gateNext=(pathname=historyPath)=>{assert.equal(hold,null);const gate={pathname,ready:deferred(),release:deferred(),finished:deferred()};gates.add(gate);hold=gate;return gate;};
  const force=(page,key)=>page.getByTestId(key).evaluate(element=>element.click());
  const select=(page,key,value)=>page.getByTestId(key).evaluate((element,value)=>{element.value=value;element.dispatchEvent(new Event('change',{bubbles:true}));},value);
  const panel=page=>page.getByRole('region',{name:'单员工候选留存历史',exact:true});
  const modal=page=>page.getByRole('dialog',{name:'候选留存历史（只读）',exact:true});
  const result=page=>panel(page).locator('[data-rule-capture-history-result]');
  const items=page=>panel(page).locator('[data-rule-capture-history-item]');
  const receipt=page=>panel(page).locator('[data-rule-capture-result]');
  const firstButton=page=>panel(page).getByRole('button',{name:'读取历史首页',exact:true});
  const nextButton=page=>panel(page).getByRole('button',{name:'下一页',exact:true});
  const detailButton=page=>items(page).first().getByRole('button',{name:'读取原留存',exact:true});
  const enable=page=>page.getByTestId('enable').click();
  const open=async page=>{await page.getByRole('button',{name:'候选留存历史（只读）',exact:true}).click();await firstButton(page).waitFor();};
  const close=page=>panel(page).getByRole('button',{name:'关闭候选留存历史',exact:true}).click();
  const read=async page=>{await firstButton(page).click();await result(page).waitFor();};
  const detail=async page=>{await detailButton(page).click();await receipt(page).waitFor();};
  const quiet=async(page,count)=>{await page.waitForLoadState('networkidle');await bounded(Promise.all([...pending]));assert.equal(requests.length,count,'unexpected_automatic_history_request');};
  const cleared=async page=>{assert.equal(await result(page).count(),0);assert.equal(await receipt(page).count(),0);};
  const failed=async page=>{await page.waitForLoadState('networkidle');await panel(page).getByRole('status').filter({hasText:/未能|无法|已隐藏|失败/}).waitFor();};
  try{
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const address=server.address();assert(address&&typeof address==='object');origin=`http://127.0.0.1:${address.port}`;
    browser=await chromium.launch({headless:true});
    const run=async(name,check,width=1280)=>{
      moduleEnabled=true;authMode='owner';const context=await browser.newContext({serviceWorkers:'block',acceptDownloads:false,viewport:{width,height:1100}});
      try{
        await context.addInitScript(()=>{
          sessionStorage.setItem('qa-unrelated','preserve');localStorage.setItem('qa-unrelated','preserve');const probe={csp:[],storageWrites:0};Object.defineProperty(window,'__historyBrowserProbe',{value:probe});
          for(const method of ['setItem','removeItem','clear']){const original=Storage.prototype[method];Storage.prototype[method]=function(...args){probe.storageWrites++;return original.apply(this,args);};}
          document.addEventListener('securitypolicyviolation',event=>probe.csp.push(event.violatedDirective));
        });
        await context.route('**/*',route=>{
          if(closing)return route.abort().catch(()=>{});
          const work=(async()=>{
            const request=route.request(),url=new URL(request.url());assert.equal(url.origin,origin,'external_request_blocked');assert.equal(request.method(),'GET','readonly_history_must_never_write');
            if(['/', '/qa.js','/qa.css'].includes(url.pathname)){assert.equal(url.search,'');return route.continue();}
            assert([historyPath,capturePath].includes(url.pathname));assert(requests.length<45,'history_browser_request_budget');assert.equal(request.postData(),null);
            const actor=request.headers()['x-qa-owner'];assert([ownerId,id(98)].includes(actor));
            const handler=url.pathname===historyPath?handleRuleCaptureHistory:handleRuleCaptures;
            const response=await handler(new Request(canonical+url.pathname+url.search,{method:'GET',headers:{Host:'www.faolla.com',Origin:canonical}}),dependencies(actor,url.pathname===historyPath));
            const body=await response.text(),parsed=JSON.parse(body);assert.equal(response.headers.get('Cache-Control'),'private, no-store');
            if(url.pathname===historyPath&&response.ok){assert(!Object.hasOwn(parsed.data,'sourceText'));assert(Buffer.byteLength(body,'utf8')<66000);assert(parsed.data.items.every(item=>!Object.hasOwn(item,'sourceText')));}
            requests.push({path:url.pathname,search:url.search,status:response.status,body:parsed});
            const gate=hold?.pathname===url.pathname?hold:null;if(gate){hold=null;gate.ready.resolve(parsed);await gate.release.promise;}
            try{await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body});}catch(error){if(!gate&&!closing)throw error;}
            finally{if(gate){gate.finished.resolve();gates.delete(gate);}}
          })();pending.add(work);void work.finally(()=>pending.delete(work)).catch(()=>{});
          return work.catch(async error=>{if(!closing)errors.push(error instanceof Error?error.message:'history_route_failed');await route.abort().catch(()=>{});});
        });
        const page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',error=>errors.push(error.message));page.on('download',()=>errors.push('unexpected_download'));page.on('popup',()=>errors.push('unexpected_popup'));
        page.on('dialog',dialog=>{errors.push('unexpected_dialog');void dialog.dismiss().catch(()=>{});});
        await page.goto(origin);await page.getByTestId('enable').waitFor();try{await check(page);}catch(error){error.message=`${name}: ${error.message}`;throw error;}
        assert.deepEqual(await page.evaluate(()=>window.__historyBrowserProbe),{csp:[],storageWrites:0});
        assert.deepEqual(await page.evaluate(()=>[sessionStorage.getItem('qa-unrelated'),localStorage.getItem('qa-unrelated')]),['preserve','preserve']);
        assert.equal(data.fingerprint(),before);assert.equal(data.definitions(),definitions);checks++;native.pass(name);
      }finally{for(const gate of gates)gate.release.resolve();await context.close();}
    };
    await run('history defaultoff and opened component make zero requests; explicit metadata132 read only',async page=>{
      assert.equal(requests.length,0);assert.equal(await panel(page).count(),0);assert.equal(await page.getByRole('button',{name:'候选留存历史（只读）',exact:true}).count(),0);
      await enable(page);await open(page);await quiet(page,0);await read(page);assert.equal(requests.length,1);assert.equal(requests[0].path,historyPath);
      assert.equal(await items(page).count(),25);assert.equal(captureReads,0);assert.equal(await receipt(page).count(),0);
    });
    await run('history390px modal explicit25plus2 tie-safe pages then original131 detail with verified SHA and zero storage writes',async page=>{
      await enable(page);await open(page);await read(page);const first=requests.at(-1).body.data;
      assert.equal(await modal(page).evaluate(element=>element.matches(':modal')),true);await assert.rejects(page.getByTestId('unmount').click({timeout:500}),/Timeout|intercepts pointer events/);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.equal(await modal(page).evaluate(element=>element.scrollWidth<=element.clientWidth+1),true);assert.equal(await page.locator('form form').count(),0);
      await nextButton(page).click();await result(page).waitFor();const second=requests.at(-1).body.data;
      assert.equal(second.asOf,first.asOf);assert.equal(await items(page).count(),2);assert.equal(second.nextCursor,null);assert.equal(await nextButton(page).isDisabled(),true);
      assert.equal(new Set([...first.items,...second.items].map(item=>item.operationId)).size,27);assert.equal(await receipt(page).count(),0);
      const selected=second.items[0];await detail(page);const original=requests.at(-1);assert.equal(original.path,capturePath);assert.equal(original.status,200);
      assert.equal(original.body.data.receipt.operationId,selected.operationId);assert.equal(original.body.data.receipt.sourceSha256,selected.sourceSha256);
      assert((await receipt(page).innerText()).includes(selected.sourceSha256));assert.equal(original.body.data.receipt.applied,false);assert.equal(original.body.data.receipt.historicalApplicationProven,false);
      const count=requests.length;await close(page);await open(page);await quiet(page,count);await page.keyboard.press('Escape');await panel(page).waitFor({state:'detached'});await quiet(page,count);
    },390);
    await run('history modulepaused remains readonly; current worker with no eligible history is explicitly empty',async page=>{
      await enable(page);await open(page);moduleEnabled=false;await read(page);assert.equal(requests.at(-1).body.moduleEnabled,false);await detail(page);assert.equal(requests.at(-1).body.moduleEnabled,false);
      await select(page,'worker',secondWorker);await open(page);const count=requests.length;await quiet(page,count);await read(page);assert.equal(requests.at(-1).status,200);assert.equal(requests.at(-1).body.data.items.length,0);assert.equal(await items(page).count(),0);
    });
    await run('history delayed page cannot paint after owner worker or authorization epoch changes',async page=>{
      await enable(page);await open(page);await read(page);const gate=gateNext();await nextButton(page).click();await bounded(gate.ready.promise);await cleared(page);
      await select(page,'worker',secondWorker);await select(page,'owner',id(98));await force(page,'epoch');gate.release.resolve();await bounded(gate.finished.promise);
      await open(page);await cleared(page);await quiet(page,requests.length);await select(page,'owner',ownerId);await select(page,'worker',workerId);await open(page);await read(page);assert.equal(await items(page).count(),25);
    });
    await run('history delayed detail and body invalidate on hide pagehide apiFetch and unmount without automatic reload',async page=>{
      await enable(page);await open(page);await read(page);const gate=gateNext(capturePath);await detailButton(page).click();await bounded(gate.ready.promise);
      await force(page,'hide');await cleared(page);gate.release.resolve();await bounded(gate.finished.promise);await force(page,'show');await quiet(page,requests.length);await cleared(page);
      await force(page,'arm-body');await firstButton(page).click();await page.getByTestId('body-phase').filter({hasText:'held'}).waitFor();const count=requests.length;
      await force(page,'api-change');await force(page,'release-body');await cleared(page);await quiet(page,count);if(await panel(page).count()===0)await open(page);
      await read(page);await detail(page);await force(page,'pagehide');await cleared(page);await force(page,'pageshow');await quiet(page,requests.length);
      const late=gateNext();await firstButton(page).click();await bounded(late.ready.promise);await force(page,'unmount');late.release.resolve();await bounded(late.finished.promise);await force(page,'mount');await open(page);await cleared(page);await quiet(page,requests.length);
    });
    await run('history401 and owner403 clear previously verified list and detail, no writes',async page=>{
      await enable(page);await open(page);await read(page);await detail(page);authMode='unauthenticated';await firstButton(page).click();await failed(page);await cleared(page);assert.equal(requests.at(-1).status,401);
      authMode='owner';await read(page);authMode='wrong-owner';await detailButton(page).click();await failed(page);await cleared(page);assert.equal(requests.at(-1).status,403);
    });
    assert.equal(checks,6);assert.deepEqual(errors,[]);assert.equal(data.fingerprint(),before);assert.equal(data.definitions(),definitions);
    return {checks,apiRequests:requests.length,historyReads,captureReads,posts:0,storageWrites:0,externalRequests:0,productionAccess:false,realAuth:false,fullAdminE2E:false,
      actualHandlerServiceSql:true,syntheticOnly:true,syntheticPaginationRows:26,realCaptureOperations:1,allFactsAndDefinitionsUnchanged:true,callerOwnedNamespaceCleanup:true};
  }finally{
    closing=true;for(const gate of gates)gate.release.resolve();
    await runAttendanceCleanupSteps([
      {name:'rule-capture-history-browser',run:async()=>{await browser?.close();}},
      {name:'rule-capture-history-interceptions',run:async()=>{await Promise.allSettled([...pending]);}},
      {name:'rule-capture-history-loopback',run:async()=>{if(server.listening){server.closeAllConnections();await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}}},
    ]);
  }
}
