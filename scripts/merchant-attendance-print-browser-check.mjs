// LOCAL SYNTHETIC browser acceptance only. No database, Auth, real printer,
// production credentials, persistent bundle, screenshot or retained download.
// Run with the repository's installed TS loader: node --import tsx <this-file>.
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
import {runAttendanceCleanupSteps} from './fixtures/attendance-cleanup.mjs';

const root=fileURLToPath(new URL('../',import.meta.url)),require=createRequire(import.meta.url);
const {timesheetExportWire}=require('./fixtures/attendance-timesheet-export-model.ts');
const {unifiedExportWire}=require('./fixtures/attendance-unified-export-model.ts');
const {timesheetId:id}=require('./fixtures/attendance-timesheet-model.ts');
const {ATTENDANCE_REPORT_SOURCE_VERSION}=require('../src/lib/merchantAttendanceTimesheet.ts');
const {parseTimesheetExportCommand,parseTimesheetExportSource,buildTimesheetExportCsv,timesheetExportFilename}=require('../src/lib/merchantAttendanceTimesheetExport.ts');
const {parseUnifiedExportSource,buildUnifiedExportCsv,unifiedExportFilename}=require('../src/lib/merchantAttendanceUnifiedExport.ts');
const paths={timesheet:'/api/merchant-enterprise/attendance/timesheet-export',unified:'/api/merchant-enterprise/attendance/unified-export'};
// Match sensitive middleware.ts headers exactly, without relaxing frame policy.
export const printBrowserSecurityHeaders=Object.freeze({
  'Content-Security-Policy':"frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'",
  'X-Frame-Options':'DENY','X-Content-Type-Options':'nosniff','Cache-Control':'no-store',
});

export function printBrowserResponse(kind,raw,{paused=false}={}){
  assert(Object.hasOwn(paths,kind));const command=parseTimesheetExportCommand(raw);
  let receipt,csv,filename;
  if(kind==='timesheet'){
    const wire=timesheetExportWire(command);wire.report.sourceVersion=ATTENDANCE_REPORT_SOURCE_VERSION;
    const source=parseTimesheetExportSource(wire,command,ATTENDANCE_REPORT_SOURCE_VERSION);receipt=source.receipt;
    csv=buildTimesheetExportCsv(source.report,receipt);filename=timesheetExportFilename(command);
  }else{
    const source=parseUnifiedExportSource(unifiedExportWire(command),command);receipt=source.receipt;
    csv=buildUnifiedExportCsv(source.report,receipt);filename=unifiedExportFilename(command);
  }
  return {ok:true,moduleEnabled:!paused,receipt,replayed:false,csv,filename,
    viewerEmployeeId:command.query.access==='owner'?null:command.query.access==='self'?id(2):id(90),accessValidUntil:null};
}

const bounded=async(promise,label)=>{let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(label)),15000);})]);}finally{clearTimeout(timer);}};
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};

async function inMemoryAssets(){
  const entry='scripts/fixtures/attendance-print-browser.tsx';
  const bundle=await build({absWorkingDir:root,entryPoints:[entry],bundle:true,write:false,metafile:true,format:'esm',platform:'browser',target:['es2020'],jsx:'automatic',
    tsconfig:path.join(root,'tsconfig.json'),outfile:'attendance-print-qa.js',define:{'process.env':'{}','process.env.NODE_ENV':'"development"'},logLevel:'warning'});
  const candidates=new Set();
  for(const filename of Object.keys(bundle.metafile.inputs).filter(name=>/\.tsx?$/.test(name)&&!name.includes('node_modules'))){
    const source=ts.createSourceFile(filename,await readFile(path.join(root,filename),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
    const visit=node=>{
      if(ts.isStringLiteral(node)||ts.isNoSubstitutionTemplateLiteral(node)||ts.isTemplateHead(node)||ts.isTemplateMiddle(node)||ts.isTemplateTail(node))
        node.text.split(/\s+/).filter(Boolean).forEach(candidate=>candidates.add(candidate));
      ts.forEachChild(node,visit);
    };visit(source);
  }
  const css=(await compile('@import "tailwindcss";',{base:root,onDependency:()=>{}})).build([...candidates])
    +bundle.outputFiles.filter(file=>file.path.endsWith('.css')).map(file=>file.text).join('\n')
    +'body{margin:0;background:#f1f5f9;color:#0f172a;font-family:Arial,sans-serif}.qa-toolbar{padding:12px;background:#fff7ed;font-size:13px}.qa-controls{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0}.qa-controls button,.qa-controls select{background:white;border:1px solid #94a3b8;border-radius:6px;padding:5px 9px}.qa-main{max-width:1160px;margin:auto;padding:16px;display:grid;gap:16px}';
  const javascript=bundle.outputFiles.find(file=>file.path.endsWith('.js'));assert(javascript);
  return {javascript:javascript.contents,css};
}

// Runs before application code. Capturing iframe load precedes the driver's
// target listener and patches the new srcdoc Window, not its old about:blank.
// This proves dispatch only: no real window.print implementation is ever called.
function installPrintProbe(){
  const proof={prints:[],errors:[],csp:[],holdLoads:false,heldLoads:[],releasedLoads:[]},heldFrames=[];
  Object.defineProperty(window,'__attendancePrintProbe',{value:proof});
  const releaseLoads=()=>{
    proof.holdLoads=false;
    for(const frame of heldFrames.splice(0)){
      const record={connectedAtRelease:frame.isConnected,events:0};proof.releasedLoads.push(record);
      // Even a detached target receives explicitly dispatched stale events.
      // Production cleanup must have removed its load listener already.
      for(let n=0;n<2;n++){frame.dispatchEvent(new Event('load'));record.events++;}
    }
  };
  Object.defineProperty(window,'__attendancePrintControl',{value:{releaseLoads,
    releaseWhenDetached:label=>{
      const target=[...document.querySelectorAll('section[aria-label]')].find(element=>element.getAttribute('aria-label')===label);
      if(!target)throw Error('print_probe_parent_required');
      const observer=new MutationObserver(()=>{if(!target.isConnected){observer.disconnect();releaseLoads();}});
      observer.observe(document.getElementById('qa-root'),{subtree:true,childList:true});
    },
  }});
  window.print=()=>{proof.errors.push('unexpected_top_level_print');throw Error('physical_print_forbidden');};
  document.addEventListener('securitypolicyviolation',event=>proof.csp.push(event.violatedDirective));
  document.addEventListener('load',event=>{
    const frame=event.target;
    if(!(frame instanceof HTMLIFrameElement))return;
    try{
      const target=frame.contentWindow,document=frame.contentDocument;if(!target||!document)throw Error('iframe_document_unavailable');
      Object.defineProperty(target,'print',{configurable:true,value:()=>{
        proof.prints.push({title:frame.title,sandbox:frame.getAttribute('sandbox'),src:frame.getAttribute('src'),srcdoc:frame.hasAttribute('srcdoc'),
          marker:document.body?.getAttribute('data-attendance-print-document')??null,documentTitle:document.title,text:document.body?.textContent??'',
          scriptCount:document.scripts.length,formCount:document.forms.length,resourceCount:document.querySelectorAll('img,iframe,object,embed,link,script').length,
          metaCsp:document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content')??'',connected:frame.isConnected,
          offscreen:frame.getBoundingClientRect().right<0,ariaHidden:frame.getAttribute('aria-hidden')});
        queueMicrotask(()=>target.dispatchEvent(new target.Event('afterprint')));
      }});
      if(proof.holdLoads&&document.body?.hasAttribute('data-attendance-print-document')){
        event.stopImmediatePropagation();
        if(!heldFrames.includes(frame)){
          heldFrames.push(frame);proof.heldLoads.push({marker:document.body.getAttribute('data-attendance-print-document'),connected:frame.isConnected});
        }
      }
    }catch{proof.errors.push('iframe_probe_failed');frame.remove();}
  },true);
}

export async function checkAttendancePrintBrowser(){
  const assets=await inMemoryAssets(),errors=[],external=[];let browser,closing=false,origin,checks=0,printCalls=0,csvDownloads=0,lateLoadChecks=0,printMediaChecks=0;
  const contexts=new Set(),pendingRoutes=new Set(),gates=new Set(),allDownloads=new Set();
  const server=createServer((request,response)=>{
    if(request.headers.host!==new URL(origin).host)return response.writeHead(403).end();
    for(const [key,value] of Object.entries(printBrowserSecurityHeaders))response.setHeader(key,value);
    if(request.method!=='GET')return response.writeHead(403).end();
    const pathname=new URL(request.url??'/',origin).pathname;
    if(pathname==='/')return response.writeHead(200,{'Content-Type':'text/html;charset=utf-8'}).end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>隔离考勤打印验收</title><link rel="stylesheet" href="/harness.css"><div id="qa-root"></div><script type="module" src="/harness.js"></script></html>');
    if(pathname==='/harness.js')return response.writeHead(200,{'Content-Type':'text/javascript;charset=utf-8'}).end(assets.javascript);
    if(pathname==='/harness.css')return response.writeHead(200,{'Content-Type':'text/css;charset=utf-8'}).end(assets.css);
    return response.writeHead(403).end();
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const address=server.address();assert(address&&typeof address==='object'&&address.address==='127.0.0.1');origin=`http://127.0.0.1:${address.port}`;
  const printed=page=>page.evaluate(()=>window.__attendancePrintProbe.prints);
  const settle=page=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const printSection=(page,kind)=>page.getByRole('region',{name:kind==='timesheet'?'打印工时明细':'打印含整段申报工时明细',exact:true});
  const csvSection=(page,kind)=>page.getByRole('region',{name:kind==='timesheet'?'受控工时导出':'含整段申报的受控导出',exact:true});
  const startPrint=async(page,kind)=>{const section=printSection(page,kind);await section.getByRole('checkbox').check();await section.getByRole('button',{name:'核验并打印',exact:true}).click();};
  const waitPrint=page=>page.waitForFunction(()=>window.__attendancePrintProbe.prints.length===1);
  const release=async state=>{for(const gate of state.gates)gate.release.resolve();await bounded(Promise.all(state.gates.map(gate=>gate.finished.promise)),'print_browser_release_timeout');};
  const run=async(name,kind,access,check,mobile=false)=>{
    const context=await browser.newContext({acceptDownloads:true,serviceWorkers:'block',viewport:mobile?{width:390,height:844}:{width:1280,height:960},isMobile:mobile,hasTouch:mobile});contexts.add(context);
    const state={mode:'normal',records:[],gates:[],downloads:[]};await context.addInitScript(installPrintProbe);
    await context.route('**/*',route=>{
      if(closing)return route.abort().catch(()=>{});
      const work=(async()=>{
        const request=route.request(),url=new URL(request.url());
        if(url.origin!==origin){external.push('external_request');return route.abort();}
        if(!url.pathname.startsWith('/api/')){assert.equal(request.method(),'GET');assert(['/','/harness.js','/harness.css'].includes(url.pathname));return route.continue();}
        assert.equal(url.pathname,paths[kind]);assert.equal(url.search,'');assert.equal(request.method(),'POST');
        const command=parseTimesheetExportCommand(JSON.parse(request.postData())),mode=state.mode;
        assert.equal(command.query.access,access);assert.equal(command.siteId,'99990009');
        const record={kind,access,method:'POST',operationId:command.operationId,mode,delivered:false};state.records.push(record);
        let gate=null;
        if(mode==='held'){gate={release:deferred(),finished:deferred()};gates.add(gate);state.gates.push(gate);await gate.release.promise;}
        try{
          if(mode==='lost'){await route.abort('connectionreset');return;}
          const payload=mode==='denied'?{ok:false,error:'attendance_export_denied'}:printBrowserResponse(kind,command,{paused:mode==='paused'});
          try{await route.fulfill({status:mode==='denied'?403:200,headers:{'content-type':'application/json','cache-control':'private, no-store'},body:JSON.stringify(payload)});record.delivered=true;}
          catch(error){if(!gate||!request.failure())throw error;record.delivered='aborted_after_invalidation';}
        }finally{if(gate){gate.finished.resolve();gates.delete(gate);}}
      })();pendingRoutes.add(work);void work.finally(()=>pendingRoutes.delete(work)).catch(()=>{});
      return work.catch(async error=>{if(!closing)errors.push({kind:'route',sourceLine:String(error?.stack??'').match(/print-browser-check\.mjs:(\d+):/)?.[1]??null});await route.abort().catch(()=>{});});
    });
    const page=await context.newPage();page.setDefaultTimeout(8000);page.on('pageerror',error=>errors.push({kind:'pageerror',message:String(error.message).slice(0,180)}));
    page.on('dialog',dialog=>{errors.push('unexpected_physical_dialog');void dialog.dismiss();});
    page.on('download',download=>{state.downloads.push(download);allDownloads.add(download);});
    try{
      const response=await page.goto(origin);assert.equal(response.status(),200);
      for(const [key,value] of Object.entries(printBrowserSecurityHeaders))assert.equal(response.headers()[key.toLowerCase()],value);
      await page.getByLabel('验收报表类型',{exact:true}).selectOption(kind);await page.getByLabel('验收访问视角',{exact:true}).selectOption(access);
      await printSection(page,kind).waitFor();await settle(page);assert.equal(state.records.length,0);assert.equal((await printed(page)).length,0);
      await check(page,state);
      const probe=await page.evaluate(()=>window.__attendancePrintProbe);assert.deepEqual(probe.errors,[]);assert.deepEqual(probe.csp,[]);
      assert.equal(await page.evaluate(()=>Object.keys(localStorage).length+Object.keys(sessionStorage).length),0,'print_browser_persistent_storage_written');
      if(mobile)assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'print_browser_horizontal_overflow');
      printCalls+=probe.prints.length;checks++;console.log('PASS '+name);
    }catch(error){
      console.error(JSON.stringify({printBrowserCaseFailed:name,errors,requests:state.records,...(state.layout?{layout:state.layout}:{}),
        document:await page.evaluate(()=>({title:document.title,rootChildren:document.getElementById('qa-root')?.childElementCount??null,
          labels:document.querySelectorAll('label').length,iframes:document.querySelectorAll('iframe').length,probe:window.__attendancePrintProbe?.errors??null})).catch(()=>null)}));
      throw error;
    }finally{
      for(const gate of state.gates)gate.release.resolve();await release(state);
      for(const download of state.downloads){await download.delete();allDownloads.delete(download);}await context.close();contexts.delete(context);
    }
  };
  try{
    // The HTTP server itself cannot process API writes. Only closed interception
    // returns synthetic wire data; there is no application server behind it.
    assert.equal((await fetch(origin+paths.timesheet,{method:'POST'})).status,403);
    browser=await chromium.launch({headless:true});
    for(const kind of ['timesheet','unified'])for(const access of ['owner','self','manager']){
      await run(`${kind} ${access}: explicit print and unchanged CSV under sensitive CSP`,kind,access,async(page,state)=>{
        const section=printSection(page,kind),button=section.getByRole('button',{name:'核验并打印',exact:true});
        assert(await button.isDisabled());await button.evaluate(element=>element.click());await settle(page);assert.equal(state.records.length,0);
        if(access==='manager')state.mode='paused';
        await startPrint(page,kind);await waitPrint(page);assert.equal(state.records.length,1);assert.equal(state.records[0].method,'POST');
        const print=(await printed(page))[0];assert.equal(print.title,'考勤打印明细');assert.equal(print.sandbox,'allow-same-origin allow-modals');
        assert.equal(print.src,null);assert.equal(print.srcdoc,true);assert.equal(print.marker,kind);assert.equal(print.connected,true);
        assert.equal(print.offscreen,true);assert.equal(print.ariaHidden,'true');
        await page.locator('iframe[title="考勤打印明细"]').waitFor({state:'detached'});
        assert.equal(print.scriptCount,0);assert.equal(print.formCount,0);assert.equal(print.resourceCount,0);assert(print.metaCsp.includes("default-src 'none'"));
        assert(print.text.includes('Synthetic worker'));assert(print.text.includes('核对明细，非已封账工资表。'));
        assert(print.text.includes('此资料未冻结，不是工资结算、签名或考勤完整性证明。'));
        assert(print.documentTitle.startsWith(kind==='timesheet'?'考勤工时核对明细':'考勤统一核对明细'));
        assert(print.text.includes('打卡班次：原始与核定分列'));
        if(kind==='unified')assert(print.text.includes('整段漏卡申报（wholeMissing），不是原始打卡'));
        assert.equal(state.downloads.length,0);
        const csv=csvSection(page,kind);await csv.getByRole('checkbox').check();const downloaded=page.waitForEvent('download');await csv.getByRole('button').click();const download=await downloaded;
        assert.match(download.suggestedFilename(),kind==='timesheet'?/^attendance-99990009-.*\.csv$/:/^attendance-unified-99990009-.*\.csv$/);
        const stream=await download.createReadStream();assert(stream);const chunks=[];let bytes=0;
        for await(const chunk of stream){bytes+=chunk.length;assert(bytes<=4*1024*1024);chunks.push(chunk);}
        const contents=Buffer.concat(chunks).toString('utf8');assert(contents.startsWith('\ufeff"记录类型",'));assert(contents.endsWith('\r\n'));assert(contents.includes('来源读取SHA256'));
        assert.equal(await download.failure(),null);assert.equal(state.records.length,2);assert.notEqual(state.records[0].operationId,state.records[1].operationId);
        await settle(page);assert.equal((await printed(page)).length,1);csvDownloads++;
      },access==='manager');
    }
    for(const kind of ['timesheet','unified']){
      await run(`${kind}: double click has one request and one print`,kind,'owner',async(page,state)=>{
        state.mode='held';const section=printSection(page,kind);await section.getByRole('checkbox').check();
        await section.getByRole('button',{name:'核验并打印',exact:true}).evaluate(button=>{button.click();button.click();});
        await bounded((async()=>{while(state.gates.length===0)await settle(page);})(),'print_browser_request_not_started');
        assert.equal(state.records.length,1);assert.equal((await printed(page)).length,0);await release(state);await waitPrint(page);await settle(page);
        assert.equal(state.records.length,1);assert.equal((await printed(page)).length,1);
      });
      await run(`${kind}: lost response never auto retries or prints`,kind,'owner',async(page,state)=>{
        state.mode='lost';await startPrint(page,kind);await printSection(page,kind).getByRole('status').filter({hasText:/未确认|未能|不自动/}).waitFor();await settle(page);
        assert.equal(state.records.length,1);assert.equal((await printed(page)).length,0);assert.equal(await page.locator('iframe[title="考勤打印明细"]').count(),0);
        assert.equal(await printSection(page,kind).getByRole('checkbox').isChecked(),false);assert.equal(state.downloads.length,0);
      });
      for(const change of ['隐藏验收文档','切换验收身份'])await run(`${kind}: delayed response discarded after ${change}`,kind,'owner',async(page,state)=>{
        state.mode='held';await startPrint(page,kind);await bounded((async()=>{while(state.gates.length===0)await settle(page);})(),'print_browser_request_not_started');
        await page.getByRole('button',{name:change,exact:true}).click();await release(state);await settle(page);
        assert.equal(state.records.length,1);assert.equal((await printed(page)).length,0);assert.equal(await page.locator('iframe[title="考勤打印明细"]').count(),0);
        if(change==='隐藏验收文档')await page.getByRole('button',{name:'显示验收文档',exact:true}).click();await settle(page);
        assert.equal(state.records.length,1);assert.equal(await printSection(page,kind).getByRole('checkbox').isChecked(),false);
      });
      for(const change of ['卸载验收导出','切换验收身份'])await run(`${kind}: prepared iframe late load rejected after ${change}`,kind,'owner',async(page,state)=>{
        await page.evaluate(()=>{window.__attendancePrintProbe.holdLoads=true;});await startPrint(page,kind);
        await page.waitForFunction(()=>window.__attendancePrintProbe.heldLoads.length===1);
        const before=await page.evaluate(()=>window.__attendancePrintProbe);assert.deepEqual(before.heldLoads,[{marker:kind,connected:true}]);
        assert.equal(before.prints.length,0);assert.equal(state.records.length,1);assert.equal(state.records[0].delivered,true);
        assert.equal(await page.locator('iframe[title="考勤打印明细"]').count(),1);
        // Release in the first DOM-mutation microtask after the old controls
        // detach, rather than waiting for a later frame/passive-effect cleanup.
        await page.evaluate(label=>window.__attendancePrintControl.releaseWhenDetached(label),kind==='timesheet'?'打印工时明细':'打印含整段申报工时明细');
        await page.getByRole('button',{name:change,exact:true}).click();
        await page.waitForFunction(()=>window.__attendancePrintProbe.releasedLoads.length===1);
        const after=await page.evaluate(()=>window.__attendancePrintProbe);
        assert.deepEqual(after.releasedLoads,[{connectedAtRelease:false,events:2}]);assert.equal(after.prints.length,0);
        assert.equal(await page.locator('iframe[title="考勤打印明细"]').count(),0);assert.equal(state.records.length,1);assert.equal(state.downloads.length,0);
        await settle(page);assert.equal((await printed(page)).length,0);lateLoadChecks++;
      });
      await run(`${kind}: print media layout and local platform fonts`,kind,'owner',async(page,state)=>{
        await page.emulateMedia({media:'print'});await page.evaluate(()=>{window.__attendancePrintProbe.holdLoads=true;});await startPrint(page,kind);
        await page.waitForFunction(()=>window.__attendancePrintProbe.heldLoads.length===1);
        const layout=await page.evaluate(()=>{
          const frame=document.querySelector('iframe[title="考勤打印明细"]'),doc=frame.contentDocument,win=frame.contentWindow;
          const headings=[...doc.querySelectorAll('h2')],summary=headings.find(element=>element.textContent.startsWith('查询区间汇总')).parentElement;
          const metadata=headings.find(element=>element.textContent==='来源、范围与读取记录').parentElement;
          const tables=[...doc.querySelectorAll('table')],rules=[...doc.styleSheets].flatMap(sheet=>[...sheet.cssRules]);
          const pageRule=rules.find(rule=>rule.type===win.CSSRule.PAGE_RULE),firstCell=summary.querySelector('td'),rootStyle=win.getComputedStyle(doc.documentElement);
          return {printMedia:win.matchMedia('print').matches,width:win.innerWidth,scrollWidth:doc.documentElement.scrollWidth,scrollHeight:doc.documentElement.scrollHeight,height:win.innerHeight,
            overflowing:tables.flatMap(table=>[table,...table.querySelectorAll('th,td')]).filter(element=>element.getBoundingClientRect().right>win.innerWidth+1||element.scrollWidth>element.clientWidth+1).length,
            headings:headings.map(element=>element.textContent),summaryBeforeMetadata:summary.getBoundingClientRect().top<metadata.getBoundingClientRect().top,
            summaryText:summary.textContent,rootFont:rootStyle.fontFamily,rootFontSize:parseFloat(rootStyle.fontSize),cellFontSize:parseFloat(win.getComputedStyle(firstCell).fontSize),
            localFontFaces:doc.fonts.size,fontStatus:doc.fonts.status,allTableHeaders:tables.every(table=>table.tHead&&win.getComputedStyle(table.tHead).display==='table-header-group'),
            allRowsAvoidBreak:[...doc.querySelectorAll('tr')].every(row=>['avoid','avoid-page'].includes(win.getComputedStyle(row).breakInside)),sourceCanPaginate:[...doc.querySelectorAll('.source')].every(source=>win.getComputedStyle(source).breakInside==='auto'),
            pageSize:pageRule?.style.getPropertyValue('size')??'',pageMargin:pageRule?.style.getPropertyValue('margin')??'',bodyPadding:win.getComputedStyle(doc.body).padding,
            sourceRules:rules.map(rule=>rule.cssText).join('\n'),resourceElements:doc.querySelectorAll('link,img,object,embed,script').length};
        });
        state.layout={printMedia:layout.printMedia,width:layout.width,scrollWidth:layout.scrollWidth,scrollHeight:layout.scrollHeight,overflowing:layout.overflowing,
          pageSize:layout.pageSize,pageMargin:layout.pageMargin,bodyPadding:layout.bodyPadding,rootFont:layout.rootFont,rootFontSize:layout.rootFontSize,cellFontSize:layout.cellFontSize,
          allTableHeaders:layout.allTableHeaders,allRowsAvoidBreak:layout.allRowsAvoidBreak,sourceCanPaginate:layout.sourceCanPaginate};
        assert.equal(layout.printMedia,true);assert(layout.scrollWidth<=layout.width+1);assert.equal(layout.overflowing,0);
        assert(layout.scrollHeight>2*layout.height,'print_browser_multipage_source_required');assert.equal(layout.summaryBeforeMetadata,true);
        assert.equal(layout.headings[0],'查询区间汇总（各口径独立）');assert(layout.summaryText.includes('8 小时 0 分 0 秒'));assert(layout.summaryText.includes('28800000000 微秒'));
        assert.equal(layout.rootFont,'Arial, "Microsoft YaHei", sans-serif');assert(layout.rootFontSize>=13.3&&layout.cellFontSize>=13.3);
        assert.equal(layout.localFontFaces,0);assert.equal(layout.fontStatus,'loaded');assert.equal(layout.resourceElements,0);
        assert.equal(layout.allTableHeaders,true);assert.equal(layout.allRowsAvoidBreak,true);assert.equal(layout.sourceCanPaginate,true);
        // CSSOM omits portrait because it is the default orientation for A4.
        assert(['a4','a4 portrait'].includes(layout.pageSize.toLowerCase()));assert.equal(layout.pageMargin,'14mm 12mm 16mm');assert.equal(layout.bodyPadding,'0px');
        assert(!/@font-face|url\s*\(|@import/i.test(layout.sourceRules));
        // Inspect fonts actually chosen by Chromium, not only requested CSS
        // family names. They must all be installed platform fonts, never custom.
        const cdp=await page.context().newCDPSession(page);let fontCount=0;
        try{
          await cdp.send('DOM.enable');await cdp.send('CSS.enable');const tree=(await cdp.send('DOM.getDocument',{depth:-1,pierce:true})).root;
          const nodes=[],visit=node=>{nodes.push(node);if(node.contentDocument)visit(node.contentDocument);for(const child of node.children??[])visit(child);};visit(tree);
          const printBody=nodes.find(node=>node.nodeName==='BODY'&&node.attributes?.includes('data-attendance-print-document'));assert(printBody);
          const inside=[],walk=node=>{inside.push(node);for(const child of node.children??[])walk(child);};walk(printBody);
          for(const node of inside.filter(node=>node.nodeName==='H1'||node.nodeName==='TD').slice(0,4)){
            const fonts=(await cdp.send('CSS.getPlatformFontsForNode',{nodeId:node.nodeId})).fonts;assert(fonts.length>0);
            for(const font of fonts){assert.equal(font.isCustomFont,false);assert.equal(typeof font.familyName,'string');assert(font.familyName.length>0);fontCount++;}
          }
          assert(fontCount>0);
        }finally{await cdp.detach();}
        await page.evaluate(()=>window.__attendancePrintControl.releaseLoads());await waitPrint(page);
        await page.locator('iframe[title="考勤打印明细"]').waitFor({state:'detached'});assert.equal(state.records.length,1);assert.equal(state.downloads.length,0);
        printMediaChecks++;
      });
      await run(`${kind}: denied export clears actual parent and never prints`,kind,'manager',async(page,state)=>{
        state.mode='denied';await startPrint(page,kind);await page.getByRole('status').filter({hasText:'已清除工时资料'}).waitFor();
        assert.equal(await printSection(page,kind).count(),0);assert.equal(JSON.parse(await page.getByLabel('验收父级清理',{exact:true}).innerText()).denials,1);
        assert.equal(state.records.length,1);assert.equal((await printed(page)).length,0);assert.equal(await page.locator('iframe').count(),0);assert.equal(state.downloads.length,0);
      },true);
    }
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.equal(checks,22);assert.equal(printCalls,10);assert.equal(csvDownloads,6);assert.equal(lateLoadChecks,4);assert.equal(printMediaChecks,2);
    console.log(JSON.stringify({attendancePrintBrowser:true,checks,preparedIframeLateLoadChecks:lateLoadChecks,printMediaLayoutChecks:printMediaChecks,printDispatches:printCalls,csvDownloads,actualExportWrappers:true,actualPrintDriver:true,
      modeledPrintFunction:true,sensitiveMiddlewareHeaders:true,syntheticReportsAndHttp:true,productionRequests:0,realAuth:false,realSql:false,realNextServer:false,
      realPhone:false,physicalPrinter:false,retainedFiles:0,persistentStorageWrites:0}));
  }finally{
    closing=true;for(const gate of gates)gate.release.resolve();
    await runAttendanceCleanupSteps([{name:'print-browser-downloads',run:()=>Promise.allSettled([...allDownloads].map(download=>download.delete()))},
      {name:'print-browser-contexts',run:()=>Promise.allSettled([...contexts].map(context=>context.close()))},{name:'print-browser',run:()=>browser?.close()},
      {name:'print-browser-routes',run:()=>Promise.allSettled([...pendingRoutes])},{name:'print-browser-loopback',run:()=>new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()))}]);
  }
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  await checkAttendancePrintBrowser().catch(error=>{console.error(JSON.stringify({attendancePrintBrowserFailed:true,sourceLine:String(error?.stack??'').match(/print-browser-check\.mjs:(\d+):/)?.[1]??null,error:typeof error?.code==='string'?error.code:'local_check_failed'}));process.exitCode=1;});
}
