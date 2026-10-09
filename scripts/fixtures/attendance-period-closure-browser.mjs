// Inert176 callback: root supplies the one existing owned PostgreSQL fixture.
// No DB startup, full app build, disk bundle, screenshot or production account.
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
const root=fileURLToPath(new URL('../../',import.meta.url)),canonical='https://www.faolla.com',endpoint='/api/merchant-enterprise/attendance/period-closures';
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
async function bounded(promise){let timer;try{return await Promise.race([promise,new Promise((_,no)=>{timer=setTimeout(()=>no(Error('period_browser_timeout')),15000);})]);}finally{clearTimeout(timer);}}
async function assets(){
  const bundle=await build({absWorkingDir:root,entryPoints:['scripts/fixtures/attendance-period-closure-browser-entry.tsx'],bundle:true,write:false,metafile:true,platform:'browser',format:'esm',target:['es2020'],jsx:'automatic',tsconfig:path.join(root,'tsconfig.json'),outfile:'qa.js',logLevel:'warning',
    define:{'process.env':'{}','process.env.NODE_ENV':'"development"','process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_PERIOD_CLOSURES_ENABLED':'"1"'}});
  for(const name of Object.keys(bundle.metafile.inputs))assert(!/node:crypto|\.server\.ts$/.test(name),'period_server_import');
  const candidates=new Set();for(const name of Object.keys(bundle.metafile.inputs).filter(n=>/\.tsx?$/.test(n)&&!n.includes('node_modules'))){const ast=ts.createSourceFile(name,await readFile(path.join(root,name),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
    const visit=node=>{if(ts.isStringLiteral(node)||ts.isNoSubstitutionTemplateLiteral(node)||ts.isTemplateHead(node)||ts.isTemplateMiddle(node)||ts.isTemplateTail(node))node.text.split(/\s+/).filter(Boolean).forEach(v=>candidates.add(v));ts.forEachChild(node,visit);};visit(ast);}
  const css=(await compile('@import "tailwindcss";',{base:root,onDependency:()=>{}})).build([...candidates])+'body{margin:0;background:#f1f5f9;font-family:Arial,sans-serif}.qa-toolbar{padding:8px;background:#fff7ed;font-size:12px;overflow-wrap:anywhere}.qa-controls{display:flex;flex-wrap:wrap;gap:6px}.qa-controls button{border:1px solid #94a3b8;padding:6px;background:white}.qa-main{max-width:1000px;margin:auto;padding:8px;min-width:0}';
  return {js:bundle.outputFiles.find(f=>f.path.endsWith('.js')).contents,css};
}
function req(url,method,body){return new Request(canonical+url,{method,headers:{host:'www.faolla.com',origin:canonical,'sec-fetch-site':'same-origin',...(body?{'content-type':'application/json'}:{})},...(body?{body}:{})});}
// Parse the producer's all-quoted CSV, including escaped quotes and embedded
// commas/newlines. Assertions below compare fields in the SAME evidence row.
export function parsePeriodClosureCsv(text){
  assert.equal(typeof text,'string');let i=text.charCodeAt(0)===0xfeff?1:0;const rows=[];
  while(i<text.length){const row=[];let ended=false;
    while(!ended){assert.equal(text[i++],'"','period_csv_expected_quoted_cell');let value='',closed=false;
      while(i<text.length){const c=text[i++];if(c!=='"'){value+=c;continue;}if(text[i]==='"'){value+='"';i++;}else{closed=true;break;}}
      assert(closed,'period_csv_unterminated_cell');row.push(value);
      if(text[i]===','){i++;continue;}if(i===text.length){ended=true;continue;}
      assert.equal(text.slice(i,i+2),'\r\n','period_csv_expected_row_end');i+=2;ended=true;
    }rows.push(row);
  }
  assert(rows.length>0,'period_csv_empty');return rows;
}
export function assertPeriodClosureSavedRows(rows,artifact,periodId,version){
  assert(Array.isArray(rows)&&rows.length>1,'period_output_rows');assert(rows.every(row=>Array.isArray(row)&&row.length===11),'period_output_columns');
  assert.equal(rows[0][0],'记录类型');const values=rows.slice(1);assert(values.every(row=>row[2]===String(version)),'period_output_fixed_version');
  const one=(type,key,field=1)=>{const matches=values.filter(row=>row[0]===type&&row[field]===key);assert.equal(matches.length,1,`period_output_unique_row:${type}:${key}`);return matches[0];};
  const period=one('周期',periodId);assert.equal(period[4],artifact.period.startAt);assert.equal(period[5],artifact.period.endAt);assert.equal(period[10],artifact.calculationVersion);
  const fp=one('来源指纹',artifact.sourceFingerprint);assert.equal(fp[3],artifact.period.timeZone);assert.equal(fp[4],artifact.period.fromDate);assert.equal(fp[5],artifact.period.throughDate);
  const context=Object.entries(artifact.source.context);assert.equal(values.filter(row=>row[0]==='保存上下文完整证据').length,context.length,'period_output_context_count');
  for(const [key,value] of context){const row=one('保存上下文完整证据',key,3);assert.deepEqual(JSON.parse(row[10]),value,`period_output_context_value:${key}`);}
  const source=Object.entries(artifact.source).filter(([key])=>key!=='context');assert.equal(values.filter(row=>row[0]==='保存来源完整字段').length,source.length,'period_output_source_count');
  for(const [key,value] of source){const row=one('保存来源完整字段',key);assert.deepEqual(JSON.parse(row[10]),value,`period_output_source_value:${key}`);}
  const missing=values.filter(row=>row[0]==='已批准整段漏卡');assert.equal(missing.length,artifact.report.missing.length,'period_output_missing_count');
  for(const item of artifact.report.missing){const row=one('已批准整段漏卡',item.requestId);assert.equal(row[10],item.operationId);assert.equal(row[4],item.proposal.startAt);assert.equal(row[5],item.proposal.endAt);}
}
export async function cleanupPeriodClosureResources(steps,primaryError=null){
  try{
    assert(Array.isArray(steps)&&steps.every(step=>step&&typeof step==='object'&&!Array.isArray(step)&&typeof step.name==='string'&&typeof step.run==='function'),'period_browser_cleanup_shape');
    await runAttendanceCleanupSteps(steps);
  }catch(error){
    if(primaryError)throw new AggregateError([primaryError,error],'period_browser_failed_and_cleanup_failed',{cause:primaryError});
    throw error;
  }
}
export async function runPeriodClosureBrowserAcceptance({d,h,q,handle,pid}){
  assert(d&&h&&q&&handle&&pid,'period_browser_dependencies');const query=q(),requests=[],errors=[],inflight=new Set(),gates=new Set();
  const definitions=d.definitions();let files,browser,origin,closing=false,stage='setup',checks=0,dropPost=false,hold=null,failure=null;
  const server=createServer((request,response)=>{if(!origin||request.headers.host!==new URL(origin).host||request.method!=='GET')return response.writeHead(403).end();
    response.setHeader('Cache-Control','no-store');response.setHeader('X-Content-Type-Options','nosniff');response.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-src 'self' about:; base-uri 'none'; form-action 'none'; object-src 'none'");
    const u=new URL(request.url??'/',origin);if(u.search)return response.writeHead(403).end();
    if(u.pathname==='/')return response.writeHead(200,{'Content-Type':'text/html;charset=utf-8'}).end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>周期核对隔离验收</title><link rel="stylesheet" href="/qa.css"><div id="qa-root"></div><script type="module" src="/qa.js"></script></html>');
    if(u.pathname==='/qa.js')return response.writeHead(200,{'Content-Type':'text/javascript;charset=utf-8'}).end(files.js);if(u.pathname==='/qa.css')return response.writeHead(200,{'Content-Type':'text/css;charset=utf-8'}).end(files.css);return response.writeHead(403).end();});
  const region=p=>p.getByRole('region',{name:'周期核对与封存',exact:true}),parent=p=>p.getByRole('region',{name:'含整段漏卡工时工作区',exact:true});
  const quiet=async p=>{await p.waitForLoadState('networkidle');await bounded(Promise.all([...inflight]));};
  const clickResponse=async(p,locator,{method='GET',mode,action}={})=>{const [response]=await Promise.all([p.waitForResponse(r=>{if(new URL(r.url()).pathname!==endpoint||r.request().method()!==method)return false;
    const b=method==='POST'?r.request().postDataJSON():null;return (!mode||(b?.query.mode??new URL(r.url()).searchParams.get('mode'))===mode)&&(!action||b?.command.action===action);}),locator.click()]);
    await response.finished();const text=await response.text();assert.equal(response.status(),200,text);return JSON.parse(text);};
  const open=async p=>{const launch=p.getByRole('button',{name:'含整段漏卡的工时核对',exact:true});if(await launch.count())await launch.click();await parent(p).waitFor();
    const periodLaunch=parent(p).getByRole('button',{name:'周期核对、争议与封存',exact:true});if(await periodLaunch.count())await periodLaunch.click();await region(p).waitFor();};
  const detail=async p=>{await open(p);await clickResponse(p,region(p).getByRole('button',{name:'读取周期列表',exact:true}),{mode:'list'});
    const item=region(p).getByRole('listitem').filter({hasText:pid});assert.equal(await item.count(),1);const body=await clickResponse(p,item.getByRole('button',{name:'读取保存版本',exact:true}),{mode:'detail'});
    await region(p).locator('[data-period-closure-detail]').waitFor();return body;};
  const action=async(p,name,verb,reason)=>{await region(p).getByLabel('周期操作理由',{exact:true}).fill(reason);return clickResponse(p,region(p).getByRole('button',{name,exact:true}),{method:'POST',action:verb});};
  const switchAccess=async(p,access)=>{await p.getByTestId(access).click();await open(p);};
  try{
    files=await assets();
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const address=server.address();assert(address&&typeof address==='object');origin=`http://127.0.0.1:${address.port}`;
    browser=await chromium.launch({headless:true});const context=await browser.newContext({serviceWorkers:'block',acceptDownloads:false,viewport:{width:390,height:980}});let page,accept=true;
    try{
      await context.addInitScript(seed=>{Object.defineProperty(window,'__periodClosureSeed',{value:seed});const set=Storage.prototype.setItem;set.call(sessionStorage,'qa-unrelated','keep');set.call(localStorage,'qa-unrelated','keep');
        const probe={writes:[],csv:[],print:[],csp:[]};Object.defineProperty(window,'__periodClosureProbe',{value:probe});
        for(const method of ['setItem','removeItem','clear']){const old=Storage.prototype[method];Storage.prototype[method]=function(...args){probe.writes.push({method,key:args[0]??null,local:this===localStorage,bytes:method==='setItem'?new TextEncoder().encode(args[1]).byteLength:0});return old.apply(this,args);};}
        const create=URL.createObjectURL.bind(URL);URL.createObjectURL=value=>{if(value instanceof Blob&&value.type.startsWith('text/csv'))void value.text().then(text=>probe.csv.push(text));return create(value);};
        const observer=new MutationObserver(records=>{for(const r of records)for(const node of r.addedNodes)if(node instanceof HTMLIFrameElement&&node.title==='考勤打印明细')node.addEventListener('load',()=>{if(node.contentDocument?.body?.hasAttribute('data-attendance-print-document'))node.contentWindow.print=()=>{
          probe.print.push({title:node.contentDocument.querySelector('h1')?.textContent,rows:Array.from(node.contentDocument.querySelectorAll('table tr'),row=>Array.from(row.children,cell=>cell.textContent))});
          queueMicrotask(()=>node.contentWindow?.dispatchEvent(new Event('afterprint')));};},{capture:true});});
        observer.observe(document,{childList:true,subtree:true});document.addEventListener('securitypolicyviolation',e=>probe.csp.push(e.violatedDirective));
      },{site:d.site,owner:d.owner,employee:h.employeeId,worker:h.workerId,fromDate:query.fromDate,throughDate:query.throughDate});
      await context.route('**/*',route=>{if(closing)return route.abort().catch(()=>{});const work=(async()=>{const r=route.request(),u=new URL(r.url());assert.equal(u.origin,origin,'period_external_request');
        if(['/','/qa.js','/qa.css'].includes(u.pathname)){assert.equal(r.method(),'GET');assert.equal(u.search,'');return route.continue();}
        assert.equal(u.pathname,endpoint,'period_unexpected_endpoint');assert(requests.length<45,'period_request_budget');const method=r.method(),body=r.postData();assert(['GET','POST'].includes(method));
        if(body)assert(Buffer.byteLength(body,'utf8')<=8192);const access=r.headers()['x-qa-access'];assert(['owner','self'].includes(access));const enabled=r.headers()['x-qa-paused']!=='true';
        const before=d.fingerprint(),response=await handle(req(u.pathname+u.search,method,body),access,enabled),text=await response.text(),parsed=JSON.parse(text);
        if(method==='GET')assert.equal(d.fingerprint(),before,'period_get_changed_facts');assert.equal(d.definitions(),definitions);assert.equal(response.headers.get('cache-control'),'private, no-store');
        requests.push({method,mode:method==='POST'?JSON.parse(body).query.mode:u.searchParams.get('mode'),action:method==='POST'?JSON.parse(body).command.action:null,status:response.status,access,enabled,body:parsed});
        if(method==='POST'&&dropPost){dropPost=false;assert.equal(response.status,200,text);await route.abort('failed');return;}
        const gate=method==='GET'?hold:null;if(gate){hold=null;gate.ready.resolve();await gate.release.promise;}
        try{await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:text});}catch(e){if(!gate&&!closing)throw e;}finally{if(gate){gate.done.resolve();gates.delete(gate);}}
      })();inflight.add(work);void work.finally(()=>inflight.delete(work)).catch(()=>{});return work.catch(async e=>{if(!closing)errors.push(e.message);await route.abort().catch(()=>{});});});
      page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));page.on('popup',()=>errors.push('unexpected_popup'));page.on('dialog',dialog=>void(accept?dialog.accept():dialog.dismiss()).catch(error=>{if(!closing)errors.push(`period_dialog_failed:${error.message}`);}));
      stage='parent.initial';await page.goto(origin);await open(page);await quiet(page);assert.equal(requests.length,0);
      let saved=await detail(page);assert.equal(saved.data.period.sealed,true);assert.equal(saved.data.artifactVersion,2);
      await region(page).getByRole('region',{name:'周期已保存完整上下文',exact:true}).waitFor();
      stage='parent.guard';await region(page).getByLabel('周期操作理由').fill('unsaved reason');accept=false;
      const otherDay=new Date(Date.parse(query.fromDate+'T00:00:00Z')-86400000).toISOString().slice(0,10);assert.notEqual(otherDay,query.fromDate);
      await parent(page).getByLabel('合并核对开始日期',{exact:true}).fill(otherDay);assert.equal(await parent(page).getByLabel('合并核对开始日期',{exact:true}).inputValue(),query.fromDate);
      await parent(page).getByRole('button',{name:'关闭合并核对',exact:true}).click();await region(page).waitFor();assert.equal(requests.length,2);accept=true;
      stage='owner.paused_reopen';await page.getByTestId('paused').click();saved=await detail(page);assert.equal(saved.moduleEnabled,false);
      const reopened=await action(page,'说明理由并重开','reopen','176 browser authorized paused reopening');assert.equal(reopened.data.period.state,'open');assert.equal(reopened.data.period.confirmedVersion,null);checks++;
      stage='owner.preview_send';await page.getByTestId('enabled').click();await detail(page);const preview=await clickResponse(page,region(page).getByRole('button',{name:'预览完整周期资料',exact:true}),{mode:'preview'});assert.deepEqual(preview.data.preview.blockers,[]);
      const sent=await action(page,'保存版本并发起核对','send','176 browser same complete source new review');assert.equal(sent.data.period.currentVersion,3);assert.equal(sent.data.period.confirmedVersion,null);checks++;
      stage='self.dispute';await switchAccess(page,'self');const selfSaved=await detail(page);assert.deepEqual(selfSaved.data.artifact,sent.data.artifact);
      const disputed=await action(page,'提交周期争议','dispute','176 browser employee dispute');assert.equal(disputed.data.period.unresolvedDispute,true);
      stage='owner.respond';await switchAccess(page,'owner');await detail(page);const responded=await action(page,'回复周期争议','respond','176 browser owner explains, does not impersonate consent');assert.equal(responded.data.period.unresolvedDispute,true);
      stage='self.confirm';await switchAccess(page,'self');await detail(page);const confirmed=await action(page,'确认本保存版本','confirm','176 browser explicitly reviewed saved version');assert.equal(confirmed.data.period.unresolvedDispute,false);assert.equal(confirmed.data.period.confirmedVersion,3);checks++;
      stage='owner.seal_lost';await switchAccess(page,'owner');await detail(page);await region(page).getByLabel('周期操作理由').fill('176 browser seal with response loss');dropPost=true;
      const lost=page.waitForEvent('requestfailed',{predicate:r=>new URL(r.url()).pathname===endpoint&&r.method()==='POST'});await region(page).getByRole('button',{name:'封存本人已确认版本',exact:true}).click();await lost;await quiet(page);
      const key=`faolla:attendance:period-closures:v1:${d.site}:owner:${d.owner}`,raw=await page.evaluate(k=>sessionStorage.getItem(k),key);assert(raw);const op=JSON.parse(raw).command.operationId,posts=requests.filter(r=>r.method==='POST').length;
      stage='owner.reload_recover';await page.reload();await open(page);await region(page).locator('[data-period-closure-pending]').waitFor();await quiet(page);assert.equal(requests.filter(r=>r.method==='POST').length,posts);
      await page.getByTestId('paused').click();await region(page).locator('[data-period-closure-pending]').waitFor();const recovered=await clickResponse(page,region(page).getByRole('button',{name:'核对原周期编号',exact:true}),{mode:'recover'});
      assert.equal(recovered.data.operation.operationId,op);assert.equal(recovered.data.period.sealed,true);assert.equal(requests.filter(r=>r.method==='POST').length,posts);assert.equal(await page.evaluate(k=>sessionStorage.getItem(k),key),null);checks++;
      stage='frozen.export_v1';
      // selectOption is the action, not a click; install waiter before selection.
      const [versionResponse]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname===endpoint&&new URL(r.url()).searchParams.get('version')==='1'),region(page).getByLabel('选择保存版本',{exact:true}).selectOption('1')]);
      await versionResponse.finished();assert.equal(versionResponse.status(),200);const firstVersion=await versionResponse.json();assert.equal(firstVersion.data.artifactVersion,1);
      const exportBody=await clickResponse(page,region(page).getByRole('button',{name:'下载本保存版本 CSV',exact:true}),{mode:'export'});assert.equal(exportBody.data.artifactVersion,1);assert.deepEqual(exportBody.data.artifact,firstVersion.data.artifact);
      await page.waitForFunction(()=>window.__periodClosureProbe.csv.length===1);const csv=await page.evaluate(()=>window.__periodClosureProbe.csv[0]);assertPeriodClosureSavedRows(parsePeriodClosureCsv(csv),exportBody.data.artifact,pid,1);
      stage='frozen.print_v1';const printBody=await clickResponse(page,region(page).getByRole('button',{name:'打印本保存版本',exact:true}),{mode:'export'});assert.equal(printBody.data.artifactVersion,1);assert.deepEqual(printBody.data.artifact,firstVersion.data.artifact);
      await page.waitForFunction(()=>window.__periodClosureProbe.print.length===1);const printed=await page.evaluate(()=>window.__periodClosureProbe.print[0]);assert.equal(printed.title,'周期保存版本 1');assertPeriodClosureSavedRows(printed.rows,firstVersion.data.artifact,pid,1);checks++;
      stage='lifetime.late';const gate={ready:deferred(),release:deferred(),done:deferred()};hold=gate;gates.add(gate);await region(page).getByRole('button',{name:'读取周期列表',exact:true}).click();await bounded(gate.ready.promise);
      await page.getByTestId('api-change').click();gate.release.resolve();await bounded(gate.done.promise);await quiet(page);assert.equal(await region(page).locator('[data-period-closure-detail]').count(),0);
      await detail(page);const beforeHide=requests.length;await page.getByTestId('hide').click();assert.equal(await page.locator('[data-period-closure-artifact]').count(),0);await page.getByTestId('show').click();await quiet(page);assert.equal(requests.length,beforeHide);
      await detail(page);await page.getByTestId('pagehide').click();assert.equal(await page.locator('[data-period-closure-artifact]').count(),0);await page.getByTestId('pageshow').click();await quiet(page);
      await detail(page);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false,'period_390px_overflow');await page.getByTestId('epoch').click();assert.equal(await page.locator('[data-period-closure-artifact]').count(),0);checks++;
      const probe=await page.evaluate(()=>({writes:window.__periodClosureProbe.writes,csp:window.__periodClosureProbe.csp,local:localStorage.getItem('qa-unrelated'),session:sessionStorage.getItem('qa-unrelated')}));
      assert.equal(probe.local,'keep');assert.equal(probe.session,'keep');assert(probe.writes.every(x=>!x.local&&x.method!=='clear'&&x.key.startsWith(`faolla:attendance:period-closures:v1:${d.site}:`)&&x.bytes<=8192));assert.deepEqual(probe.csp,[]);assert.deepEqual(errors,[]);assert.equal(d.definitions(),definitions);
      return {checks,requests:requests.length,posts:requests.filter(r=>r.method==='POST').length,pausedReopen:true,version:3,frozenExportVersion:1,syntheticAuth:true,actualUnifiedParent:true,fullAdminSelfShell:false,printedDocumentIntercepted:true,externalRequests:0,diskBundles:false};
    }catch(error){const diagnostic={stage,message:String(error?.message??error).slice(0,1500),stack:String(error?.stack??'').split('\n').slice(0,2).join('\n'),requests:requests.slice(-8).map(({body,...r})=>({...r,error:body.error??null})),errors};if(page)diagnostic.ui=await page.locator('body').innerText().then(t=>t.slice(-5000)).catch(()=>'<closed>');failure=Error(`period_closure_browser_failed ${JSON.stringify(diagnostic)}`,{cause:error});throw failure;}
    finally{closing=true;for(const gate of gates)gate.release.resolve();await cleanupPeriodClosureResources([
      {name:'period inflight responses',run:()=>bounded(Promise.allSettled([...inflight]))},
      {name:'period browser context',run:()=>bounded(context.close())},
    ],failure);}
  }catch(error){failure=error;throw error;}
  finally{closing=true;await cleanupPeriodClosureResources([
    {name:'period browser',run:()=>browser?bounded(browser.close()):undefined},
    {name:'period HTTP listener',run:()=>{server.closeAllConnections?.();return server.listening?bounded(new Promise((r,j)=>server.close(e=>e?j(e):r()))):undefined;}},
    {name:'period esbuild service',run:()=>stop()},
  ],failure);}
}
