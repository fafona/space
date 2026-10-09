// Inert unless --run-local. Actual React + Chromium, synthetic local HTTP only.
// No production, database, real Auth, downloads, screenshots or bundle files.
import assert from 'node:assert/strict';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';
import {runAttendanceCleanupSteps} from './fixtures/attendance-cleanup.mjs';
export const retentionAcceptanceLimits=Object.freeze({deadlineMs:300000,requestLimit:80,postLimit:6,viewport:{width:390,height:900}});
export const retentionAcceptanceGroups=Object.freeze(['strictmode_zero_automatic_http','actual_policy_save_exact_receipt',
  'actual_historical_record_hold_then_release','dirty_close_escape_preserves_input_390px',
  'committed_lost_response_reload_flagoff_initial_hidden_local_pending_get_recovery','owner_switch_late_response_scope_isolation',
  'inactive_worker_utc_event_location_and_exact_period_artifact_pickers']);
const API='/api/merchant-enterprise/attendance/retention';
export function retentionAcceptanceArguments(args){
  assert(Array.isArray(args)&&args.every(v=>typeof v==='string'),'retention_qa_arguments');
  assert(args.length===0||args.length===1&&args[0]==='--run-local','retention_qa_unknown_argument');return {run:args.length===1};
}
export function retentionAcceptanceDeliveryHeaders(headers){const value={...headers};for(const key of ['content-length','transfer-encoding','content-encoding'])delete value[key];return value;}
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
async function bounded(promise,label,ms=12000){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(label)),ms);})]);}finally{clearTimeout(timer);}}

// Also reusable as an explicitly read-only group during bounded diagnostics.
export async function checkRetentionPicker({panel,click,seed,requests}){
  const pickerStart=requests.length,writeCount=requests.filter(r=>r.method==='POST').length;
  await panel().getByLabel('查找考勤人员',{exact:true}).fill('合成');
  const directory=await click(panel().getByRole('button',{name:'读取人员',exact:true}),'GET',null,'/api/merchant-enterprise/attendance/admin');
  assert.equal(directory.items.length,2);assert(directory.items.some(w=>w.id===seed.workerId&&w.active===false));
  assert(directory.items.some(w=>w.id===seed.activeWorkerId&&w.active===true));
  // Wrapped select labels include option text in this actual accessible DOM.
  // Match the stable prefix, then wait for and assert the precise option/value.
  const selector=panel().getByLabel(/^选择人员/);
  await selector.locator(`option[value="${seed.workerId}"]`).waitFor({state:'attached'});
  assert((await selector.locator('option').allTextContents()).some(text=>text.includes('合成停用人员（已停用）')));
  await selector.selectOption(seed.workerId);assert.equal(await selector.inputValue(),seed.workerId);
  await panel().getByLabel('UTC起日',{exact:true}).fill(seed.fromDate);await panel().getByLabel('UTC结束日',{exact:true}).fill(seed.throughDate);
  const pickerPreviews=[];
  for(const category of ['events','location_results']){
    await panel().getByLabel(/^资料类别/).selectOption(category);
    const preview=await click(panel().getByRole('button',{name:'只读试算',exact:true}),'GET','preview');
    const chosenQuery=requests.at(-1).query;assert.deepEqual([chosenQuery.category,chosenQuery.workerId,chosenQuery.fromAt,chosenQuery.toAt],
      [category,seed.workerId,'2026-10-07T00:00:00.000000Z','2026-10-08T00:00:00.000000Z']);
    assert.equal(preview.data.data.items.length,1);assert.equal(preview.data.data.items[0].category,category);assert.equal(preview.data.canWrite,false);
    const selected=await click(panel().getByRole('button',{name:new RegExp(seed.recordId)}),'GET','record');
    assert.equal(selected.data.data.item.category,category);assert.equal(selected.data.data.item.recordId,seed.recordId);
    assert.equal(selected.data.data.item.source.kind,category==='events'?'event':'location_summary');pickerPreviews.push(category);
  }
  await panel().getByLabel(/^资料类别/).selectOption('period_artifact');
  const periodList=await click(panel().getByRole('button',{name:'读取相同起止日期的已有周期',exact:true}),'GET','list','/api/merchant-enterprise/attendance/period-closures');
  assert.equal(periodList.data.items.length,1);assert.equal(periodList.data.items[0].periodId,seed.periodId);
  assert.deepEqual([requests.at(-1).query.fromDate,requests.at(-1).query.throughDate],[seed.fromDate,seed.throughDate]);
  const periods=panel().getByLabel(/^选择固定归档所属周期/);await periods.locator(`option[value="${seed.periodId}"]`).waitFor({state:'attached'});
  await periods.selectOption(seed.periodId);assert.equal(await periods.inputValue(),seed.periodId);
  const artifacts=await click(panel().getByRole('button',{name:'只读试算',exact:true}),'GET','preview');
  assert.equal(artifacts.data.data.items.length,1);const archive=artifacts.data.data.items[0];
  assert.equal(archive.recordId,seed.artifactId);assert.notEqual(archive.recordId,seed.periodId);assert.equal(archive.source.kind,'period_artifact');assert.equal(archive.source.periodId,seed.periodId);
  const archivedRecord=await click(panel().getByRole('button',{name:new RegExp(seed.artifactId)}),'GET','record');
  assert.equal(archivedRecord.data.data.item.recordId,seed.artifactId);assert.equal(archivedRecord.data.data.item.source.periodId,seed.periodId);
  assert.equal(requests.filter(r=>r.method==='POST').length,writeCount);assert(requests.slice(pickerStart).every(r=>r.method==='GET'));
  return {workers:2,inactiveSelected:true,utcExclusiveEnd:'2026-10-08T00:00:00.000000Z',previewCategories:[...pickerPreviews,'period_artifact'],
    exactPeriodDates:true,artifactIdDistinctFromPeriodId:true,individualRecordsOpened:3,getRequests:requests.length-pickerStart,newPosts:0};
}

export async function runRetentionBrowserAcceptance(){
  const {startRetentionBrowserServer,retentionBrowserAllowedRequest}=await import('./merchant-attendance-retention-browser-check.mjs');
  const {chromium}=await import('playwright');
  let server,browser,context,page,deadline,stage='setup',failure=null,report=null,closing=false,accept=true,truncatePost=false,hold=false,gate=null;
  let committed=null;const requests=[],errors=[],external=[],inflight=new Set(),groups=[];
  const dialog=()=>page.getByRole('dialog',{name:'资料保留与单条保全',exact:true});
  const panel=()=>dialog().getByRole('region',{name:'考勤资料保留工作区',exact:true});
  const settle=async()=>{await page.waitForLoadState('networkidle');await bounded(Promise.all([...inflight]),'retention_qa_routes_stalled');
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));};
  const configure=value=>page.evaluate(v=>window.__retentionHarness.configure(v),value);
  const visibility=value=>page.evaluate(v=>window.__retentionHarness.visibility(v),value);
  const open=async(recovery=false)=>{await page.getByRole('button',{name:recovery?'核对资料保留待确认操作':'资料保留与单条保全',exact:true}).click();await panel().waitFor();await settle();};
  const close=async()=>{accept=true;await panel().getByRole('button',{name:'关闭',exact:true}).click();await dialog().waitFor({state:'detached'});await settle();};
  const click=async(locator,method,mode=null,endpoint=API)=>{const [response]=await Promise.all([page.waitForResponse(r=>r.request().method()===method&&new URL(r.url()).pathname===endpoint
    &&(mode===null||new URL(r.url()).searchParams.get('mode')===mode)),locator.click()]);
    await response.finished();assert.equal(response.status(),200,'retention_qa_unexpected_status');await settle();return JSON.parse(await response.text());};
  const policyRead=()=>click(panel().getByRole('button',{name:'读取保留设置',exact:true}),'GET','policies');
  const recordRead=()=>click(panel().getByRole('button',{name:'读取本条资料',exact:true}),'GET','record');
  try{
    deadline=setTimeout(()=>{errors.push('retention_qa_deadline');gate?.released.resolve();void context?.close();void server?.close();},retentionAcceptanceLimits.deadlineMs);
    const starting=startRetentionBrowserServer(retentionAcceptanceLimits);
    try{server=await bounded(starting,'retention_qa_server_start_timeout',30000);}
    catch(error){void starting.then(late=>late.close()).catch(()=>{});const {stop}=await import('esbuild');stop();throw error;}
    const {origin,seed}=server;
    browser=await chromium.launch({headless:true,timeout:15000});
    context=await browser.newContext({serviceWorkers:'block',acceptDownloads:false,viewport:retentionAcceptanceLimits.viewport});
    await context.addInitScript(()=>{sessionStorage.setItem('retention-qa-unrelated','preserve');localStorage.setItem('retention-qa-unrelated','preserve');});
    await context.route('**/*',route=>{
      const task=(async()=>{
        if(closing)return route.abort().catch(()=>{});
        const request=route.request(),url=new URL(request.url()),method=request.method();
        if(!retentionBrowserAllowedRequest(url.href,method,origin)){external.push({method,origin:url.origin,path:url.pathname});return route.abort();}
        if(!url.pathname.startsWith('/api/'))return route.continue();
        assert(requests.length<retentionAcceptanceLimits.requestLimit,'retention_qa_request_cap');
        const raw=request.postData();assert(raw===null||Buffer.byteLength(raw,'utf8')<=8192,'retention_qa_body_cap');
        const body=raw===null?null:JSON.parse(raw),query=body?.query??Object.fromEntries(url.searchParams);
        if(method==='POST')assert(requests.filter(r=>r.method==='POST').length<retentionAcceptanceLimits.postLimit,'retention_qa_post_cap');
        requests.push({method,path:url.pathname,mode:query.mode,actor:request.headers()['x-retention-qa-actor'],operationId:body?.command.operationId??query.operationId??null,query,body});
        const response=await route.fetch({maxRedirects:0,timeout:12000}),wire=await response.json();
        const deliver=value=>route.fulfill({status:response.status(),headers:retentionAcceptanceDeliveryHeaders(response.headers()),body:typeof value==='string'?value:JSON.stringify(value)});
        if(method==='POST'&&truncatePost){truncatePost=false;assert.equal(response.status(),200);assert(wire.data.receipt);
          committed={body:structuredClone(body),receipt:structuredClone(wire.data.receipt)};
          return deliver(JSON.stringify(wire).slice(0,Math.floor(JSON.stringify(wire).length/2)));}
        if(method==='GET'&&hold&&query.mode==='policies'){hold=false;const current=gate;current.entered.resolve();await bounded(current.released.promise,'retention_qa_held_read_timeout');}
        try{return await deliver(wire);}catch(error){if(closing||request.failure())return;throw error;}
      })();inflight.add(task);void task.finally(()=>inflight.delete(task)).catch(()=>{});
      return task.catch(async error=>{if(!closing)errors.push(error.message);await route.abort().catch(()=>{});});
    });
    page=await context.newPage();page.setDefaultTimeout(12000);page.setDefaultNavigationTimeout(15000);
    await page.clock.install({time:new Date(seed.at)});
    page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(`console:${message.text()}`);});
    page.on('dialog',value=>{void(accept?value.accept():value.dismiss()).catch(()=>{});});
    page.on('download',download=>{errors.push('retention_qa_unexpected_download');void download.cancel();});
    context.on('page',extra=>{if(extra!==page){errors.push('retention_qa_unexpected_popup');void extra.close();}});

    stage=retentionAcceptanceGroups[0];await page.goto(origin);await settle();assert.equal(requests.length,0);
    assert.equal(await page.getByRole('button',{name:'资料保留与单条保全',exact:true}).count(),0);
    await configure({enabled:true});await open();assert.equal(requests.length,0);groups.push(stage);

    stage=retentionAcceptanceGroups[1];const defaults=await policyRead();assert(defaults.data.data.items.every(p=>p.retentionDays===null&&p.revision===0));
    await panel().getByLabel('保留天数（留空为不设置）',{exact:true}).fill('90');await panel().getByLabel('设置理由',{exact:true}).fill('合成验收：明确90天试算，不删除资料');
    const policySaved=await click(panel().getByRole('button',{name:'保存试算期限',exact:true}),'POST');
    assert.equal(policySaved.data.receipt.command.action,'set_policy');assert.equal(policySaved.data.receipt.revision,1);
    const key=`faolla:attendance:retention-client:v1:${seed.siteId}:owner:${seed.owner}`;
    assert.equal(await page.evaluate(k=>sessionStorage.getItem(k),key),null);groups.push(stage);

    stage=retentionAcceptanceGroups[2];await panel().getByLabel('原始事件编号',{exact:true}).fill(seed.recordId);const beforeHold=await recordRead();
    assert.equal(beforeHold.data.data.item.preservation.held,false);assert.equal(beforeHold.data.data.item.policy.retentionDays,90);
    await panel().getByLabel('保全理由',{exact:true}).fill('合成验收：保全本条旧事件');const held=await click(panel().getByRole('button',{name:'登记本条资料保全',exact:true}),'POST');
    assert.equal(held.data.receipt.command.action,'hold');assert.equal(held.data.receipt.revision,1);
    const heldRead=await recordRead();assert.equal(heldRead.data.data.item.preservation.held,true);
    await panel().getByLabel('解除理由',{exact:true}).fill('合成验收：解除仅元数据，不删除');const released=await click(panel().getByRole('button',{name:'明确解除本条保全',exact:true}),'POST');
    assert.equal(released.data.receipt.command.action,'release');assert.equal(released.data.receipt.revision,2);
    assert.equal(held.data.receipt.command.expectedSourceFingerprint,released.data.receipt.command.expectedSourceFingerprint);groups.push(stage);

    stage=retentionAcceptanceGroups[3];await policyRead();await panel().getByLabel('保留天数（留空为不设置）',{exact:true}).fill('120');
    const reason='合成验收：保存后截断响应，保留原编号';await panel().getByLabel('设置理由',{exact:true}).fill(reason);accept=false;
    for(const action of [()=>panel().getByRole('button',{name:'关闭',exact:true}).click(),()=>page.keyboard.press('Escape')]){
      const prompted=page.waitForEvent('dialog');await action();await prompted;await settle();assert(await dialog().isVisible());
      assert.equal(await panel().getByLabel('设置理由',{exact:true}).inputValue(),reason);
    }
    const mobileDocument=await page.evaluate(()=>({scrollWidth:document.documentElement.scrollWidth,innerWidth}));
    const mobilePanel=await panel().evaluate(element=>({scrollWidth:element.scrollWidth,clientWidth:element.clientWidth}));
    assert(mobileDocument.scrollWidth<=mobileDocument.innerWidth);assert(mobilePanel.scrollWidth<=mobilePanel.clientWidth);accept=true;groups.push(stage);

    stage=retentionAcceptanceGroups[4];truncatePost=true;await panel().getByRole('button',{name:'保存试算期限',exact:true}).click();
    await panel().getByText('没有回执不代表失败，不会自动重发或生成新编号。',{exact:true}).waitFor();await settle();assert(committed);
    const bytes=await page.evaluate(k=>sessionStorage.getItem(k),key);assert(bytes);const durable=JSON.parse(bytes);
    assert.deepEqual(durable.command,committed.body.command);assert.equal(durable.command.operationId,committed.receipt.operationId);assert.equal(durable.actorId,seed.owner);
    const beforeReload=requests.length,posts=requests.filter(r=>r.method==='POST').length;await page.reload();await settle();assert.equal(requests.length,beforeReload);
    await configure({other:true});assert.equal(await page.getByRole('button',{name:'核对资料保留待确认操作',exact:true}).count(),0);
    assert.equal(await page.evaluate(k=>sessionStorage.getItem(k),key),bytes);await configure({other:false});
    await visibility(true);await open(true);assert.equal(requests.length,beforeReload);
    assert.equal(await panel().getByRole('button',{name:'读取原编号回执',exact:true}).count(),0);
    await visibility(false);await panel().getByRole('button',{name:'读取原编号回执',exact:true}).waitFor();await settle();assert.equal(requests.length,beforeReload);
    assert.equal(await page.evaluate(k=>sessionStorage.getItem(k),key),bytes);
    const recovered=await click(panel().getByRole('button',{name:'读取原编号回执',exact:true}),'GET','recover');
    assert.deepEqual(recovered.data.receipt,committed.receipt);assert.equal(await page.evaluate(k=>sessionStorage.getItem(k),key),null);
    assert.equal(requests.filter(r=>r.method==='POST').length,posts);assert.deepEqual(requests.slice(beforeReload).map(r=>[r.method,r.mode,r.operationId]),[['GET','recover',durable.command.operationId]]);groups.push(stage);

    stage=retentionAcceptanceGroups[5];await close();await configure({enabled:true,other:false});await open();
    gate={entered:deferred(),released:deferred()};hold=true;
    await panel().getByRole('button',{name:'读取保留设置',exact:true}).click();await bounded(gate.entered.promise,'retention_qa_held_read_missing');
    const count=requests.length;await configure({other:true});gate.released.resolve();await settle();assert.equal(await dialog().count(),0);
    await open();assert.equal(requests.length,count);assert.equal(await panel().getByLabel('设置理由',{exact:true}).count(),0);
    const otherKey=`faolla:attendance:retention-client:v1:${seed.siteId}:owner:${seed.other}`;
    assert.equal(await page.evaluate(k=>sessionStorage.getItem(k),otherKey),null);assert.equal(await page.evaluate(k=>sessionStorage.getItem(k),key),null);groups.push(stage);

    stage=retentionAcceptanceGroups[6];await close();await configure({other:false,enabled:true});await open();
    const pickerProof=await checkRetentionPicker({panel,click,seed,requests});groups.push(stage);

    const snapshot=server.snapshot();assert.equal(requests.filter(r=>r.method==='POST').length,4);assert.equal(snapshot.postAttempts,4);assert.equal(snapshot.model.successfulWrites,4);
    assert.equal(snapshot.model.receipts.length,4);assert.equal(snapshot.model.records.find(r=>r.category==='events').preservation.held,false);
    assert.equal(snapshot.model.records.find(r=>r.category==='events').preservation.revision,2);assert.equal(snapshot.model.policies.find(p=>p.category==='events').retentionDays,120);
    assert.equal(snapshot.model.records.find(r=>r.category==='events').sourceFingerprint,beforeHold.data.data.item.sourceFingerprint);
    assert.equal(snapshot.errors.length,0);assert.equal(errors.length,0,JSON.stringify(errors));assert.equal(external.length,0);
    assert(snapshot.totalHttpRequests<=80);assert.equal(snapshot.requests.length,requests.length);
    assert.deepEqual(await page.evaluate(()=>[sessionStorage.getItem('retention-qa-unrelated'),localStorage.getItem('retention-qa-unrelated')]),['preserve','preserve']);
    report={groups,checks:groups.length,actualReact:true,actualLauncher:true,actualPanel:true,actualChromium:true,strictMode:true,fakeClock:true,
      syntheticMetadata:true,syntheticAuth:true,realSql:false,realAuth:false,production:false,
      apiRequests:requests.length,postAttempts:4,totalHttpRequests:snapshot.totalHttpRequests,externalRequests:external.length,browserErrors:errors.length,
      mobileDocument,mobilePanel,pickerProof,ledger:{successfulWrites:snapshot.model.successfulWrites,policyRevision:2,preservationRevision:2},
      notCovered:['real SQL or authentication','native OS tab visibility: document visibility event is synthetic'],closed:false};
  }catch(error){failure=new Error(`retention_browser_acceptance_failed:${stage}`,{cause:error});}
  finally{
    clearTimeout(deadline);closing=true;gate?.released.resolve();let cleanupFailure=null;
    try{await runAttendanceCleanupSteps([{name:'retention browser context',run:()=>context?.close()},{name:'retention browser',run:()=>browser?.close()},
      {name:'retention routes',run:()=>Promise.allSettled([...inflight])},{name:'retention server',run:()=>server?.close()}]);}catch(error){cleanupFailure=error;}
    if(failure&&cleanupFailure)throw new AggregateError([failure,cleanupFailure],'retention_acceptance_and_cleanup_failed');if(cleanupFailure)throw cleanupFailure;
  }
  if(failure)throw failure;assert(report);assert.equal(browser.isConnected(),false);await bounded(server.closed,'retention_qa_server_close_timeout');assert.equal(server.snapshot().listenerActive,false);
  return {...report,closed:true,listenerActive:false};
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
  try{const args=retentionAcceptanceArguments(process.argv.slice(2));
    if(!args.run)console.log(JSON.stringify({ran:false,reason:'explicit --run-local required',command:`node --import tsx ${path.relative(process.cwd(),fileURLToPath(import.meta.url))} --run-local`,database:false,production:false}));
    else console.log(JSON.stringify(await runRetentionBrowserAcceptance(),null,2));
  }catch(error){console.error(error);process.exitCode=1;}
}
