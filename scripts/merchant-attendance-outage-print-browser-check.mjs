// INERT on import. Explicit local-only synthetic HTTP + actual parent UI.
// No SQL/Auth/production/physical printer/PDF/download/bundle files.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,realpath,stat} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {build,stop} from 'esbuild';
import {compile} from '@tailwindcss/node';
import ts from 'typescript';
import {chromium} from 'playwright';
import {runAttendanceCleanupSteps} from './fixtures/attendance-cleanup.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),require=createRequire(import.meta.url);
const {outagePrintSeed:seed,outagePrintSyntheticResponse,outagePrintPendingSeed,outagePrintLongModel}=require('./fixtures/attendance-outage-print-model.ts');
const {OUTAGE_APIS}=require('../src/lib/merchantAttendanceOutageHttp.ts');
const {buildOutageHandoffPrintDocument}=require('../src/lib/merchantAttendanceOutagePrintDocument.ts');
export const outagePrintBrowserHeaders=Object.freeze({
  'Content-Security-Policy':"frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'",
  'X-Frame-Options':'DENY','X-Content-Type-Options':'nosniff','Cache-Control':'no-store',
});
const staticPaths=new Set(['/','/qa.js','/qa.css']);
export function outagePrintAllowedRequest(url,method,origin){
  try{const u=new URL(url);return u.origin===origin&&method==='GET'&&!u.hash&&!u.username&&!u.password&&(staticPaths.has(u.pathname)?u.search==='':[OUTAGE_APIS.outages,OUTAGE_APIS.reviews].includes(u.pathname));}catch{return false;}
}
export function outagePrintScreenshotPaths(directory){
  const allowed=path.join(root,'.tmp','attendance-outage-print-220-qa');
  assert.equal(path.resolve(directory),allowed,'outage_print_screenshot_owned_directory');
  return ['blank','handoff'].map(kind=>path.join(allowed,`${kind}.png`));
}
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
const bounded=async(promise,label,ms=10000)=>{let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(label)),ms);})]);}finally{clearTimeout(timer);}};

async function assets(){
  const output=await build({absWorkingDir:root,entryPoints:['scripts/fixtures/attendance-outage-print-browser.tsx'],bundle:true,write:false,metafile:true,platform:'browser',format:'esm',jsx:'automatic',target:['es2020'],
    tsconfig:path.join(root,'tsconfig.json'),outfile:'outage-print-qa.js',logLevel:'warning',define:{'process.env':'{}','process.env.NODE_ENV':'"development"'}});
  for(const filename of Object.keys(output.metafile.inputs))assert(!/node:crypto|\.server\.ts$/.test(filename),'outage_print_browser_server_import');
  const tokens=new Set();for(const filename of Object.keys(output.metafile.inputs).filter(name=>/\.tsx?$/.test(name)&&!name.includes('node_modules'))){
    const source=ts.createSourceFile(filename,await readFile(path.join(root,filename),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
    const visit=node=>{if(ts.isStringLiteral(node)||ts.isNoSubstitutionTemplateLiteral(node)||ts.isTemplateHead(node)||ts.isTemplateMiddle(node)||ts.isTemplateTail(node))node.text.split(/\s+/).filter(Boolean).forEach(token=>tokens.add(token));ts.forEachChild(node,visit);};visit(source);
  }
  const css=(await compile('@import "tailwindcss";',{base:root,onDependency:()=>{}})).build([...tokens])
    +output.outputFiles.filter(file=>file.path.endsWith('.css')).map(file=>file.text).join('\n')
    +'body{margin:0;background:#f8fafc;color:#111;font-family:Arial,sans-serif}.qa-main{max-width:1000px;margin:auto;padding:8px}.qa-notice{font-size:12px;overflow-wrap:anywhere}';
  const js=output.outputFiles.find(file=>file.path.endsWith('.js'));assert(js);return {js:js.contents,css};
}

// Installed before app scripts. Capturing load replaces the newly loaded srcdoc
// Window.print before the real adapter's target listener invokes it.
function installPrintProbe(){
  const proof={prints:[],errors:[],csp:[]};Object.defineProperty(window,'__outagePrintProbe',{value:proof});
  window.print=()=>{proof.errors.push('top_level_print_forbidden');throw Error('physical_print_forbidden');};
  document.addEventListener('securitypolicyviolation',event=>proof.csp.push(event.violatedDirective));
  document.addEventListener('load',event=>{
    const frame=event.target;if(!(frame instanceof HTMLIFrameElement))return;
    try{
      const win=frame.contentWindow,doc=frame.contentDocument;if(!win||!doc)throw Error('frame_unreadable');
      Object.defineProperty(win,'print',{configurable:true,value:()=>{
        proof.prints.push({kind:doc.body?.getAttribute('data-attendance-outage-print-document'),text:doc.body?.textContent??'',html:doc.documentElement.outerHTML,
          title:frame.title,sandbox:frame.getAttribute('sandbox'),src:frame.getAttribute('src'),srcdoc:frame.hasAttribute('srcdoc'),connected:frame.isConnected,
          offscreen:frame.getBoundingClientRect().right<0,ariaHidden:frame.getAttribute('aria-hidden'),scripts:doc.scripts.length,forms:doc.forms.length,
          resources:doc.querySelectorAll('img,iframe,object,embed,link,script').length,csp:doc.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content')??''});
        queueMicrotask(()=>win.dispatchEvent(new win.Event('afterprint')));
      }});
    }catch{proof.errors.push('iframe_probe_failed');frame.remove();}
  },true);
}

export async function runOutagePrintBrowserAcceptance({screenshots=false}={}){
  const shotPaths=screenshots?outagePrintScreenshotPaths(path.join(root,'.tmp','attendance-outage-print-220-qa')):[];
  if(screenshots){const dir=path.dirname(shotPaths[0]);assert((await stat(dir)).isDirectory());assert.equal(await realpath(dir),dir,'outage_print_screenshot_symlink');}
  let files,origin,browser,closing=false,deadline;const errors=[],external=[],requests=[],contexts=new Set(),inflight=new Set(),gates=new Set(),documents=new Map();
  let checks=0,dispatches=0,printMediaLayout=null;
  const server=createServer((request,response)=>{
    for(const [key,value] of Object.entries(outagePrintBrowserHeaders))response.setHeader(key,value);
    if(!origin||request.headers.host!==new URL(origin).host||request.method!=='GET')return response.writeHead(403).end();
    const url=new URL(request.url??'/',origin);
    if(url.origin!==origin||url.search||!staticPaths.has(url.pathname)||request.headers.origin&&request.headers.origin!==origin)return response.writeHead(403).end();
    if(url.pathname==='/')return response.writeHead(200,{'Content-Type':'text/html;charset=utf-8'}).end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>故障纸表合成验收</title><link rel="stylesheet" href="/qa.css"><div id="qa-root"></div><script type="module" src="/qa.js"></script></html>');
    return response.writeHead(200,{'Content-Type':url.pathname==='/qa.js'?'text/javascript;charset=utf-8':'text/css;charset=utf-8'}).end(url.pathname==='/qa.js'?files.js:files.css);
  });
  const settle=page=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const dialog=page=>page.getByRole('dialog',{name:'故障登记与恢复工作区',exact:true});
  const panel=page=>dialog(page).getByRole('region',{name:'故障登记与逐人声明',exact:true});
  const printing=page=>dialog(page).getByRole('region',{name:'故障备用纸表与交接打印',exact:true});
  const probe=page=>page.evaluate(()=>window.__outagePrintProbe);
  const configure=(page,value)=>page.evaluate(v=>window.__outagePrintHarness.configure(v),value);
  const open=async(page,access='owner')=>{await page.getByRole('button',{name:access==='owner'?'登记该人员故障声明':'我的故障声明与核对',exact:true}).click();await panel(page).waitFor();await printing(page).waitFor();await settle(page);};
  const readDeclaration=async(page,id=seed.declarationId)=>{
    await panel(page).getByLabel('已知声明编号',{exact:true}).fill(id);
    const response=page.waitForResponse(r=>new URL(r.url()).pathname===OUTAGE_APIS.outages&&new URL(r.url()).searchParams.get('declarationId')===id);
    await panel(page).getByRole('button',{name:'读取声明与恢复核对',exact:true}).click();assert.equal((await response).status(),200);
    await printing(page).getByRole('checkbox',{name:'确认保管故障交接资料',exact:true}).waitFor();await settle(page);
  };
  const start=async page=>{await printing(page).getByRole('checkbox',{name:'确认保管故障交接资料',exact:true}).check();await printing(page).getByRole('button',{name:'重新核验并打印此声明交接单',exact:true}).click();};
  const expectNoPrint=async page=>{await settle(page);assert.equal((await probe(page)).prints.length,0);assert.equal(await page.locator('iframe').count(),0);};
  const waitPrint=async(page,kind)=>{await page.waitForFunction(k=>window.__outagePrintProbe.prints.length===1&&window.__outagePrintProbe.prints[0].kind===k,kind);await page.locator('iframe').waitFor({state:'detached'});};
  const run=async(name,callback,{pending=false,access='owner'}={})=>{
    const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block',acceptDownloads:false});contexts.add(context);
    const pendingSeed=pending?outagePrintPendingSeed(pending):null,state={records:[],deny:null,hold:false,held:deferred(),release:deferred(),insertedPending:[]};
    await context.addInitScript(({seed,pendingSeed})=>{
      Object.defineProperty(window,'__outagePrintSeed',{value:seed});localStorage.setItem('qa-unrelated','preserve');sessionStorage.setItem('qa-unrelated','preserve');
      if(pendingSeed)sessionStorage.setItem(pendingSeed.key,pendingSeed.raw);
    },{seed,pendingSeed});await context.addInitScript(installPrintProbe);
    await context.route('**/*',route=>{
      if(closing)return route.abort().catch(()=>{});
      const work=(async()=>{
        const request=route.request(),url=new URL(request.url());
        if(!outagePrintAllowedRequest(url.href,request.method(),origin)){external.push({method:request.method(),sameOrigin:url.origin===origin});await route.abort();return;}
        if(staticPaths.has(url.pathname))return route.continue();
        assert(requests.length<40,'outage_print_request_budget');const actor=request.headers()['x-outage-print-qa-actor'];
        const record={method:request.method(),endpoint:url.pathname,mode:url.searchParams.get('mode'),declarationId:url.searchParams.get('declarationId'),actor,status:200,canWrite:null};requests.push(record);state.records.push(record);
        const wire=outagePrintSyntheticResponse(url.href,actor),denied=state.deny;state.deny=null;
        record.canWrite=wire.canWrite;
        const held=state.hold&&url.pathname===OUTAGE_APIS.reviews;
        if(held){state.hold=false;gates.add(state.release);state.held.resolve();await state.release.promise;}
        try{
          record.status=denied??200;
          await route.fulfill({status:record.status,headers:{'Content-Type':'application/json','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'},
            body:JSON.stringify(denied?{ok:false,error:denied===401?'unauthorized':'attendance_access_denied'}:wire)});
        }catch(error){if(!held)throw error;record.discarded=true;}finally{if(held)gates.delete(state.release);}
      })();inflight.add(work);void work.finally(()=>inflight.delete(work)).catch(()=>{});
      return work.catch(async error=>{if(!closing)errors.push({kind:'route',message:String(error.message).slice(0,180)});await route.abort().catch(()=>{});});
    });
    const page=await context.newPage();page.setDefaultTimeout(8000);page.on('pageerror',error=>errors.push({kind:'pageerror',message:error.message}));
    page.on('download',download=>{errors.push('unexpected_download');void download.cancel();void download.delete();});
    page.on('dialog',d=>{errors.push('unexpected_dialog');void d.dismiss();});
    try{
      const response=await page.goto(origin);assert.equal(response.status(),200);for(const [key,value] of Object.entries(outagePrintBrowserHeaders))assert.equal(response.headers()[key.toLowerCase()],value);
      await page.waitForFunction(()=>!!window.__outagePrintHarness);if(access==='self')await configure(page,{access:'self'});
      await open(page,access);assert.equal(state.records.length,0,'opening_must_not_fetch');await callback(page,state);
      const p=await probe(page);assert.deepEqual(p.errors,[]);assert.deepEqual(p.csp,[]);
      for(const printed of p.prints){assert.equal(printed.sandbox,'allow-same-origin allow-modals');assert.equal(printed.src,null);assert(printed.srcdoc&&printed.connected&&printed.offscreen);assert.equal(printed.ariaHidden,'true');
        assert.equal(printed.scripts+printed.forms+printed.resources,0);assert(printed.csp.includes("default-src 'none'"));documents.set(printed.kind,printed.html);}
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'390px_page_overflow');
      if(await dialog(page).count())assert(await dialog(page).evaluate(el=>el.scrollWidth<=el.clientWidth+1),'390px_dialog_overflow');
      assert.deepEqual(await page.evaluate(()=>({local:localStorage.getItem('qa-unrelated'),session:sessionStorage.getItem('qa-unrelated')})),{local:'preserve',session:'preserve'});
      const storage=await page.evaluate(()=>({local:Object.keys(localStorage),session:Object.keys(sessionStorage)}));assert.deepEqual(storage.local,['qa-unrelated']);
      const expectedPending=[...(pendingSeed?[pendingSeed]:[]),...state.insertedPending];
      assert.deepEqual(storage.session.sort(),['qa-unrelated',...expectedPending.map(p=>p.key)].sort());
      for(const p of expectedPending)assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),p.key),p.raw);
      dispatches+=p.prints.length;checks++;console.log('PASS '+name);
    }catch(error){console.error(JSON.stringify({outagePrintCaseFailed:name,requests:state.records,errors}));throw error;}
    finally{state.release.resolve();await bounded(Promise.allSettled([...inflight]),'outage_print_routes_timeout');await context.close();contexts.delete(context);}
  };
  try{
    files=await assets();await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    const address=server.address();assert(address&&typeof address==='object'&&address.address==='127.0.0.1');origin=`http://127.0.0.1:${address.port}`;
    assert.equal((await fetch(origin+OUTAGE_APIS.outages,{method:'POST'})).status,403);assert.equal((await fetch(origin+OUTAGE_APIS.outages)).status,403);
    browser=await chromium.launch({headless:true});deadline=setTimeout(()=>{errors.push('outage_print_browser_deadline');for(const gate of gates)gate.resolve();void browser.close();},180000);
    await run('blank: actual launcher, zero business GET/POST, no identity prefill',async(page,state)=>{
      await printing(page).getByRole('button',{name:'打印空白备用表',exact:true}).click();await waitPrint(page,'blank');assert.equal(state.records.length,0);
      const print=(await probe(page)).prints[0];for(const value of Object.values(seed))assert(!print.text.includes(value));assert(print.text.includes('单人单表'));assert(print.text.includes('第 2／2 页'));
    });
    await run('handoff: selected declaration plus fresh owner two GETs, canWrite=false',async(page,state)=>{
      await readDeclaration(page);assert.equal(state.records.length,1);assert(await printing(page).getByRole('button',{name:'重新核验并打印此声明交接单',exact:true}).isDisabled());
      await start(page);await waitPrint(page,'handoff');assert.deepEqual(state.records.map(r=>r.endpoint),[OUTAGE_APIS.outages,OUTAGE_APIS.outages,OUTAGE_APIS.reviews]);
      assert(state.records.every(r=>r.method==='GET'&&r.actor===seed.owner&&r.canWrite===false));const printed=(await probe(page)).prints[0];
      assert(printed.text.includes('当前已核完'));assert(printed.text.includes(seed.employeeId));assert(printed.text.includes('负责人代录'));
      assert(!printed.text.includes(seed.owner)&&!printed.text.includes(seed.self));assert(!printed.html.includes('employeeAuthUserId'));assert(!/[a-f0-9]{64}/.test(printed.text));
    });
    await run('self gets blank only; print flag off removes controls without requests',async(page,state)=>{
      assert.equal(await printing(page).getByRole('button',{name:'重新核验并打印此声明交接单',exact:true}).count(),0);
      await printing(page).getByRole('button',{name:'打印空白备用表',exact:true}).click();await waitPrint(page,'blank');
      await configure(page,{printEnabled:false});await printing(page).waitFor({state:'detached'});assert.equal(state.records.length,0);
    },{access:'self'});
    for(const status of [401,403])await run(`${status}: authorization failure never prints or retries`,async(page,state)=>{
      await readDeclaration(page);state.deny=status;await start(page);await printing(page).getByRole('status').filter({hasText:'未生成交接打印'}).waitFor();await expectNoPrint(page);
      assert.equal(state.records.length,2);assert.equal(state.records.at(-1).status,status);
    });
    for(const change of ['actor','declaration','close','hidden'])await run(`held detail discarded after ${change}`,async(page,state)=>{
      await readDeclaration(page);state.hold=true;await start(page);await bounded(state.held.promise,'outage_print_held_get_required');
      if(change==='actor')await configure(page,{other:true});
      else if(change==='declaration')await readDeclaration(page,seed.otherDeclarationId);
      else if(change==='close'){await panel(page).getByRole('button',{name:'关闭故障工作区',exact:true}).click();await dialog(page).waitFor({state:'detached'});}
      else await page.evaluate(()=>window.__outagePrintHarness.visibility(true));
      state.release.resolve();await bounded(Promise.allSettled([...inflight]),'outage_print_delayed_release');await expectNoPrint(page);
      assert.equal(state.records.length,change==='declaration'?4:3);assert(state.records.every(r=>r.method==='GET'));
      if(change==='hidden')await page.evaluate(()=>window.__outagePrintHarness.visibility(false));
    });
    await run('dirty incident draft blocks even blank print without clearing draft',async(page,state)=>{
      const response=page.waitForResponse(r=>new URL(r.url()).searchParams.get('mode')==='incidents');await panel(page).getByRole('button',{name:'读取故障登记列表',exact:true}).click();assert.equal((await response).status(),200);
      const reason=panel(page).getByLabel('故障登记理由',{exact:true});await reason.fill('未提交的合成草稿');
      await printing(page).getByRole('button',{name:'打印空白备用表',exact:true}).click();await expectNoPrint(page);assert.equal(await reason.inputValue(),'未提交的合成草稿');assert.equal(state.records.length,1);
    });
    for(const kind of ['outages','links','reviews'])await run(`${kind} exact pending keeps bytes and prevents print without GET or POST`,async(page,state)=>{
      const button=printing(page).getByRole('button',{name:'打印空白备用表',exact:true});assert(await button.isDisabled());await button.evaluate(el=>el.click());await expectNoPrint(page);assert.equal(state.records.length,0);
    },{pending:kind});
    await run('new exact reviews pending inserted during held GET prevents stale handoff without deleting intent',async(page,state)=>{
      await readDeclaration(page);state.hold=true;await start(page);await bounded(state.held.promise,'outage_print_held_get_required');
      const pending=outagePrintPendingSeed('reviews');state.insertedPending.push(pending);
      // Deliberately no storage/focus event: the production availability guard
      // must synchronously inspect exact keys before accepting the late body.
      await page.evaluate(p=>sessionStorage.setItem(p.key,p.raw),pending);
      state.release.resolve();await bounded(Promise.allSettled([...inflight]),'outage_print_pending_release');
      await printing(page).getByRole('status').filter({hasText:/未交付打印|打印资料已取消或超时/}).waitFor();await expectNoPrint(page);assert.equal(state.records.length,3);
    });
    assert.equal(checks,14);assert.equal(dispatches,3);assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert(requests.every(r=>r.method==='GET'));
    // A4 has 182mm content width and 269mm height after this document's 14mm
    // margins. Print-media CSS inspection is not a PDF or physical page claim.
    const long=outagePrintLongModel();documents.set('handoff',buildOutageHandoffPrintDocument(long.declaration,long.review));
    const layoutContext=await browser.newContext({viewport:{width:Math.ceil(182*96/25.4),height:1123},serviceWorkers:'block',acceptDownloads:false});contexts.add(layoutContext);
    await layoutContext.route('**/*',route=>{errors.push('layout_external_request');return route.abort();});
    printMediaLayout={blankPageHeights:[],maximumContentHeight:269*96/25.4,longHandoffSources:10};
    for(const [index,kind] of ['blank','handoff'].entries()){
      const page=await layoutContext.newPage();page.on('pageerror',error=>errors.push({kind:'layout_pageerror',message:error.message}));
      await page.emulateMedia({media:'print'});assert(documents.has(kind));await page.setContent(documents.get(kind),{waitUntil:'load'});
      const layout=await page.evaluate(()=>{
        // Explicit physical content width, not a desktop-width substitute.
        document.documentElement.style.width='182mm';
        const rules=[...document.styleSheets].flatMap(sheet=>[...sheet.cssRules]),pageRule=rules.find(rule=>rule.type===CSSRule.PAGE_RULE);
        return {printMedia:matchMedia('print').matches,width:document.documentElement.getBoundingClientRect().width,scrollWidth:document.documentElement.scrollWidth,
          pages:[...document.querySelectorAll('.page')].map(el=>el.getBoundingClientRect().height),pageSize:pageRule?.style.getPropertyValue('size'),margin:pageRule?.style.getPropertyValue('margin'),
          overflowing:[...document.querySelectorAll('section,dl,dt,dd,p,li')].filter(el=>el.getBoundingClientRect().right>innerWidth+1||el.scrollWidth>el.clientWidth+1).length,
          scripts:document.scripts.length,resources:document.querySelectorAll('img,iframe,object,embed,link,script').length,sources:document.querySelectorAll('h3').length};
      });
      assert.equal(layout.printMedia,true);assert(Math.abs(layout.width-182*96/25.4)<1);assert(layout.scrollWidth<=Math.ceil(layout.width)+1);
      assert.equal(layout.overflowing,0);assert.equal(layout.scripts+layout.resources,0);assert(['a4','a4 portrait'].includes(layout.pageSize.toLowerCase()));assert.equal(layout.margin,'14mm');
      if(kind==='blank'){assert.equal(layout.pages.length,2);assert(layout.pages.every(height=>height>0&&height<=269*96/25.4+1));printMediaLayout.blankPageHeights=layout.pages;}
      else assert.equal(layout.sources,10);
      if(screenshots)await page.screenshot({path:shotPaths[index],fullPage:true});await page.close();
    }
    await layoutContext.close();contexts.delete(layoutContext);assert.deepEqual(errors,[]);checks++;console.log('PASS print media: two bounded blank pages and long ten-source handoff without overflow');
    return {outagePrintBrowser:true,checks,requests:requests.length,getRequests:requests.length,postRequests:0,printDispatches:dispatches,actualLauncherAndPanel:true,
      syntheticHttp:true,syntheticAuth:true,realSql:false,realAuth:false,realPhone:false,physicalPrinter:false,viewportWidth:390,externalRequests:0,
      unexpectedStorageWrites:0,printMediaLayout,retainedFiles:shotPaths.length,screenshots:shotPaths};
  }finally{
    closing=true;clearTimeout(deadline);for(const gate of gates)gate.resolve();
    await runAttendanceCleanupSteps([{name:'outage-print-contexts',run:()=>Promise.allSettled([...contexts].map(c=>c.close()))},
      {name:'outage-print-browser',run:()=>browser?.close()},{name:'outage-print-routes',run:()=>Promise.allSettled([...inflight])},
      {name:'outage-print-server',run:()=>server.listening?new Promise((resolve,reject)=>{server.close(error=>error?reject(error):resolve());server.closeAllConnections();}):undefined},
      {name:'outage-print-esbuild',run:()=>stop()}]);
  }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2);
  if(!args.includes('--run-local')||args.some(arg=>!['--run-local','--screenshots'].includes(arg))){console.error('Usage: node --import tsx scripts/merchant-attendance-outage-print-browser-check.mjs --run-local [--screenshots]');process.exitCode=1;}
  else await runOutagePrintBrowserAcceptance({screenshots:args.includes('--screenshots')}).then(result=>console.log(JSON.stringify(result))).catch(error=>{
    console.error(JSON.stringify({outagePrintBrowserFailed:true,error:String(error.message),sourceLine:String(error.stack).match(/outage-print-browser-check\.mjs:(\d+):/)?.[1]??null}));process.exitCode=1;
  });
}
