// INERT unless --run-local. Actual Chromium + parent Launcher/Panel; isolated
// synthetic HTTP/Auth only. No SQL, production, screenshots, downloads or files.
import assert from 'node:assert/strict';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';
import {runAttendanceCleanupSteps} from './fixtures/attendance-cleanup.mjs';

export const outageRelationsAcceptanceLimits=Object.freeze({deadlineMs:180000,requestLimit:100,postLimit:4,viewport:{width:390,height:900}});
export const outageRelationsAcceptanceGroups=Object.freeze([
  'actual_parent_zero_read_then_three_get_apply',
  'explicit_revoke_saved_history_not_merge',
  'self_current_and_history_read_no_write_controls',
  'child_dirty_parent_close_escape_and_390px',
  'committed_truncated_post_reload_flagoff_original_get',
  'second_declaration_failure_no_partial_pair',
  'hidden_late_third_get_no_body_or_automatic_reread',
  'changed_actor_late_second_get_no_body_or_storage_mutation',
  'identity_changed_apply_disabled_saved_head_safe_revoke',
  'owner_self_27_history_two_pages_and_old_receipts',
]);
const OUTAGES='/api/merchant-enterprise/attendance/outages',RELATIONS='/api/merchant-enterprise/attendance/outage-relations';
export function outageRelationsAcceptanceRequestAllowed(raw,method,origin){
  try{const u=new URL(raw),base=new URL(origin);if(base.protocol!=='http:'||base.hostname!=='127.0.0.1'||!base.port||base.origin!==origin
      ||u.origin!==origin||u.username||u.password||u.hash||/[\u0000-\u0020\u007f\\]/.test(raw))return false;
    if(['/','/qa.js','/qa.css','/favicon.ico'].includes(u.pathname))return method==='GET'&&!u.search;
    if(u.pathname===OUTAGES)return method==='GET';
    return u.pathname===RELATIONS&&(method==='GET'||method==='POST'&&!u.search);
  }catch{return false;}
}
export function outageRelationsAcceptanceArguments(args){
  assert(Array.isArray(args)&&args.every(v=>typeof v==='string'),'outage_relations_invalid_arguments');
  assert(args.length===0||args.length===1&&args[0]==='--run-local','outage_relations_unknown_argument');
  return {run:args.length===1};
}
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
const bounded=async(promise,label,ms=12000)=>{let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(label)),ms);})]);}finally{clearTimeout(timer);}};
export function outageRelationsDeliveryHeaders(headers){
  const result={...headers};delete result['content-length'];delete result['transfer-encoding'];delete result['content-encoding'];return result;
}
export function assertOutageRelationsHistoryPages(first,second,rows){
  assert.equal(rows.length,27);assert.equal(first.length,25);assert.equal(second.length,2);
  const combined=[...first,...second],expected=rows.toReversed();
  assert.deepEqual(combined.map(e=>[e.revision,e.operationId]),expected.map(e=>[e.revision,e.operationId]));
  assert.equal(new Set(combined.map(e=>e.operationId)).size,27);
  return {total:combined.length,firstPage:first.length,secondPage:second.length,beforeRevision:first.at(-1).revision};
}

export async function runOutageRelationsBrowserAcceptance(){
  const {startOutageRelationsBrowserServer}=await import('./merchant-attendance-outage-relations-browser-check.mjs');
  const {chromium}=await import('playwright');
  let server,browser,context,page,deadline,closing=false,stage='setup',failure=null,report=null,accept=true;
  let truncatePost=false,badRecover=false,badSecond=false,holdMatch=null,gate=null;
  let committed=null;const requests=[],postBodies=[],errors=[],external=[],inflight=new Set(),gates=new Set(),groups=[];
  const dialog=()=>page.getByRole('dialog',{name:'故障登记与恢复工作区',exact:true});
  const parent=()=>dialog().getByRole('region',{name:'故障登记与逐人声明',exact:true});
  const relations=()=>dialog().getByRole('region',{name:'声明之间的明确关系',exact:true});
  const bodyPair=()=>relations().getByRole('region',{name:'已完整核对的双方声明',exact:true});
  const pending=()=>relations().locator('[data-outage-relations-pending]');
  const settle=async()=>{await page.waitForLoadState('networkidle');await bounded(Promise.all([...inflight]),'outage_relations_inflight_timeout');
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));};
  const configure=value=>page.evaluate(v=>window.__outageRelationsHarness.configure(v),value);
  const open=async(recovery=false)=>{await page.getByRole('button',{name:recovery?'核对待确认故障操作':'故障声明关系与资料核对',exact:true}).click();await parent().waitFor();await settle();};
  const close=async()=>{accept=true;await parent().getByRole('button',{name:'关闭故障工作区',exact:true}).click();await dialog().waitFor({state:'detached'});await settle();};
  const click=async(locator,method,endpoint,mode=null)=>{const [response]=await Promise.all([page.waitForResponse(r=>r.request().method()===method&&new URL(r.url()).pathname===endpoint
    &&(mode===null||new URL(r.url()).searchParams.get('mode')===mode)),locator.click()]);
    await response.finished();assert.equal(response.status(),200,'outage_relations_unexpected_http_status');await settle();return JSON.parse(await response.text());};
  const readDeclaration=async id=>{await parent().getByLabel('已知声明编号',{exact:true}).fill(id);
    await click(parent().getByRole('button',{name:'读取声明与恢复核对',exact:true}),'GET',OUTAGES,'declaration');await relations().waitFor();};
  const fillPair=async id=>{await relations().getByLabel('关系另一声明编号',{exact:true}).fill(id);};
  const readPair=async id=>{await fillPair(id);const before=requests.length;
    const wire=await click(relations().getByRole('button',{name:'读取双方声明与关系依据',exact:true}),'GET',RELATIONS,'detail');await bodyPair().waitFor();
    assert.deepEqual(requests.slice(before).map(r=>[r.path,r.method,r.mode]),[[OUTAGES,'GET','declaration'],[OUTAGES,'GET','declaration'],[RELATIONS,'GET','detail']]);return wire;};
  const draft=async(kind,reason)=>{if(kind)await relations().getByLabel('声明关系类型',{exact:true}).selectOption(kind);
    await relations().getByLabel('声明关系理由',{exact:true}).fill(reason);await relations().getByLabel('确认双方声明关系',{exact:true}).check();};
  const armHold=predicate=>{assert.equal(holdMatch,null);gate={entered:deferred(),released:deferred()};gates.add(gate);holdMatch=predicate;return gate;};
  try{
    const starting=startOutageRelationsBrowserServer({ttlMs:210000,requestLimit:120});
    try{server=await bounded(starting,'outage_relations_server_start_timeout',30000);}
    catch(error){void starting.then(late=>late.close()).catch(()=>{});const {stop}=await import('esbuild');stop();throw error;}
    const {origin,seed}=server;assert.equal(new URL(origin).hostname,'127.0.0.1');assert.equal(new URL(origin).protocol,'http:');
    browser=await chromium.launch({headless:true,timeout:15000});
    context=await browser.newContext({serviceWorkers:'block',acceptDownloads:false,viewport:outageRelationsAcceptanceLimits.viewport});
    deadline=setTimeout(()=>{errors.push('outage_relations_acceptance_deadline');for(const g of gates)g.released.resolve();void context?.close();},outageRelationsAcceptanceLimits.deadlineMs);
    await context.addInitScript(()=>{sessionStorage.setItem('qa-relations-unrelated','preserve');localStorage.setItem('qa-relations-unrelated','preserve');});
    await context.route('**/*',route=>{if(closing)return route.abort().catch(()=>{});const task=(async()=>{
      const request=route.request(),url=new URL(request.url()),method=request.method();
      if(!outageRelationsAcceptanceRequestAllowed(url.href,method,origin)){external.push({method,origin:url.origin,path:url.pathname});return route.abort();}
      if(!url.pathname.startsWith('/api/'))return route.continue();
      assert(requests.length<outageRelationsAcceptanceLimits.requestLimit,'outage_relations_request_cap');
      const raw=request.postData();assert(raw===null||Buffer.byteLength(raw,'utf8')<=32768,'outage_relations_body_cap');
      const body=raw===null?null:JSON.parse(raw),q=body?.query??Object.fromEntries(url.searchParams);
      if(method==='POST'){assert(requests.filter(r=>r.method==='POST').length<outageRelationsAcceptanceLimits.postLimit,'outage_relations_post_cap');postBodies.push(structuredClone(body));}
      requests.push({path:url.pathname,method,mode:q.mode,actor:request.headers()['x-outage-relations-qa-actor'],
        declarationId:q.declarationId,relatedDeclarationId:q.relatedDeclarationId??null,operationId:body?.command.operationId??q.operationId??null,beforeRevision:q.beforeRevision??null});
      // All successes originate from the actual local HTTP model and strict
      // projector. Intercept only delivery, never synthesize a successful write.
      const response=await route.fetch({maxRedirects:0,timeout:12000}),wire=await response.json();
      const deliver=value=>route.fulfill({status:response.status(),headers:outageRelationsDeliveryHeaders(response.headers()),body:typeof value==='string'?value:JSON.stringify(value)});
      if(method==='POST'&&truncatePost){truncatePost=false;assert.equal(response.status(),200);assert(wire.data?.receipt);assert.equal(wire.data.receipt.operationId,body.command.operationId);
        committed={body:structuredClone(body),receipt:structuredClone(wire.data.receipt)};
        return deliver(JSON.stringify(wire).slice(0,Math.max(1,Math.floor(JSON.stringify(wire).length/2))));}
      if(method==='GET'&&badRecover&&url.pathname===RELATIONS&&q.mode==='recover'){badRecover=false;assert.equal(response.status(),200);assert(wire.data?.receipt);
        wire.data.receipt.commandFingerprint='0'.repeat(64);return deliver(wire);}
      if(method==='GET'&&badSecond&&url.pathname===OUTAGES&&q.declarationId===seed.related){badSecond=false;assert.equal(response.status(),200);
        return deliver({ok:true,canWrite:false,data:null});}
      if(holdMatch?.({url,q,method})){holdMatch=null;const held=gate;assert(held);held.entered.resolve();await bounded(held.released.promise,'outage_relations_held_get_timeout');gates.delete(held);}
      try{return await deliver(wire);}catch(error){if(closing||request.failure())return;throw error;}
    })();inflight.add(task);void task.finally(()=>inflight.delete(task)).catch(()=>{});
    return task.catch(async error=>{if(!closing)errors.push(error.message);await route.abort().catch(()=>{});});});
    page=await context.newPage();page.setDefaultTimeout(12000);page.setDefaultNavigationTimeout(15000);
    page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(`console:${message.text()}`);});
    page.on('dialog',value=>{void(accept?value.accept():value.dismiss()).catch(()=>{});});
    page.on('download',download=>{errors.push('outage_relations_unexpected_download');void download.cancel();});
    context.on('page',extra=>{if(extra!==page){errors.push('outage_relations_unexpected_popup');void extra.close();}});

    stage=outageRelationsAcceptanceGroups[0];await page.goto(origin);await settle();assert.equal(requests.length,0);
    assert.equal(await page.getByRole('button',{name:'故障声明关系与资料核对',exact:true}).count(),0);
    await configure({access:'owner',other:false,enabled:true});await open();assert.equal(requests.length,0);
    await readDeclaration(seed.declaration);const firstChild=requests.length;await settle();assert.equal(requests.length,firstChild);
    await readPair(seed.related);assert((await bodyPair().innerText()).includes('负责人代录（非本人确认）'));assert.equal(await bodyPair().locator('script').count(),0);
    assert((await relations().innerText()).includes('不自动合并'));await draft('possible_duplicate','223 明确登记可能重复；不合并声明');
    const applied=await click(relations().getByRole('button',{name:'明确登记声明关系',exact:true}),'POST',RELATIONS);
    assert.equal(applied.data.receipt.entry.action,'apply');assert.equal(applied.data.receipt.entry.revision,1);
    const key=`faolla:attendance:outage-client:v1:relations:${seed.siteId}:owner:${seed.owner}`;
    assert.equal(await page.evaluate(k=>sessionStorage.getItem(k),key),null);groups.push(stage);

    stage=outageRelationsAcceptanceGroups[1];await click(relations().getByRole('button',{name:'读取双方声明与当前关系',exact:true}),'GET',RELATIONS,'detail');
    await bodyPair().waitFor();await draft(null,'223 明确撤销提示，双方事实保留');
    assert(await relations().getByRole('button',{name:'明确登记声明关系',exact:true}).isDisabled());
    const revoked=await click(relations().getByRole('button',{name:'明确撤销声明关系',exact:true}),'POST',RELATIONS);
    assert.equal(revoked.data.receipt.entry.action,'revoke');assert.equal(revoked.data.receipt.entry.revision,2);
    await click(relations().getByRole('button',{name:'读取本声明关系',exact:true}),'GET',RELATIONS,'list');assert((await relations().innerText()).includes('撤销'));
    const history=await click(relations().getByRole('button',{name:'读取这对关系历史',exact:true}),'GET',RELATIONS,'history');assert.deepEqual(history.data.history.map(e=>e.revision),[2,1]);groups.push(stage);

    stage=outageRelationsAcceptanceGroups[2];await close();await configure({access:'self',other:false,enabled:true});await open();await readDeclaration(seed.declaration);
    for(const label of ['关系另一声明编号','声明关系类型','声明关系理由'])assert.equal(await relations().getByLabel(label,{exact:true}).count(),0);
    for(const label of ['明确登记声明关系','明确撤销声明关系'])assert.equal(await relations().getByRole('button',{name:label,exact:true}).count(),0);
    const selfStart=requests.length;await click(relations().getByRole('button',{name:'读取本声明关系',exact:true}),'GET',RELATIONS,'list');
    await click(relations().getByRole('button',{name:'读取双方声明与当前关系',exact:true}),'GET',RELATIONS,'detail');await bodyPair().waitFor();
    await click(relations().getByRole('button',{name:'读取这对关系历史',exact:true}),'GET',RELATIONS,'history');
    assert(requests.slice(selfStart).every(r=>r.method==='GET'&&r.actor===seed.auth));groups.push(stage);

    stage=outageRelationsAcceptanceGroups[3];await close();await configure({access:'owner',other:false,enabled:true});await open();await readDeclaration(seed.declaration);await readPair(seed.related);
    const lostReason='223 保存后截断结果：相互补充，不改变各自结案';await draft('complementary',lostReason);
    accept=false;for(const action of [()=>parent().getByRole('button',{name:'关闭故障工作区',exact:true}).click(),()=>page.keyboard.press('Escape')]){
      const seen=page.waitForEvent('dialog');await action();await seen;assert(await dialog().isVisible());assert.equal(await relations().getByLabel('声明关系理由',{exact:true}).inputValue(),lostReason);}
    accept=true;const mobileDocument=await page.evaluate(()=>({scrollWidth:document.documentElement.scrollWidth,innerWidth})),mobilePanel=await relations().evaluate(e=>({scrollWidth:e.scrollWidth,clientWidth:e.clientWidth}));
    assert(mobileDocument.scrollWidth<=mobileDocument.innerWidth);assert(mobilePanel.scrollWidth<=mobilePanel.clientWidth);groups.push(stage);

    stage=outageRelationsAcceptanceGroups[4];truncatePost=true;await relations().getByRole('button',{name:'明确登记声明关系',exact:true}).click();await pending().waitFor();await settle();assert(committed);
    const bytes=await page.evaluate(k=>sessionStorage.getItem(k),key);assert(bytes);const durable=JSON.parse(bytes);
    assert.deepEqual(Object.keys(durable).sort(),['actorId','command','kind','query','version']);assert.equal(durable.actorId,seed.owner);assert.equal(durable.kind,'relations');assert.equal(durable.version,1);
    assert.deepEqual(durable.query,committed.body.query);assert.deepEqual(durable.command,committed.body.command);assert.equal(durable.command.operationId,committed.receipt.operationId);
    assert.equal(durable.query.declarationId,seed.declaration);assert.equal(durable.query.relatedDeclarationId,seed.related);assert(!await pending().innerText().then(t=>t.includes(lostReason)));
    const beforeReload=requests.length,posts=requests.filter(r=>r.method==='POST').length;await page.reload();await settle();assert.equal(requests.length,beforeReload);await open(true);assert.equal(requests.length,beforeReload);
    await parent().getByRole('button',{name:'核对待确认声明关系',exact:true}).click();await relations().waitFor();await settle();assert.equal(requests.length,beforeReload);
    assert(await relations().getByRole('button',{name:'明确登记声明关系',exact:true}).isDisabled());assert(await relations().getByRole('button',{name:'明确撤销声明关系',exact:true}).isDisabled());
    badRecover=true;await click(relations().getByRole('button',{name:'核对声明关系原编号',exact:true}),'GET',RELATIONS,'recover');
    assert.equal(await page.evaluate(k=>sessionStorage.getItem(k),key),bytes);assert.equal(await relations().getByRole('button',{name:'明确结束被拒绝关系尝试',exact:true}).count(),0);
    const recovered=await click(relations().getByRole('button',{name:'核对声明关系原编号',exact:true}),'GET',RELATIONS,'recover');
    assert.deepEqual(recovered.data.receipt,committed.receipt);assert.equal(await page.evaluate(k=>sessionStorage.getItem(k),key),null);assert.equal(requests.filter(r=>r.method==='POST').length,posts);
    for(const r of requests.slice(beforeReload))assert.deepEqual([r.method,r.mode,r.declarationId,r.relatedDeclarationId,r.operationId],['GET','recover',seed.declaration,seed.related,durable.command.operationId]);groups.push(stage);

    stage=outageRelationsAcceptanceGroups[5];await close();await configure({access:'owner',other:false,enabled:true});await open();await readDeclaration(seed.declaration);await fillPair(seed.related);
    const beforeFailure=requests.length;badSecond=true;await click(relations().getByRole('button',{name:'读取双方声明与关系依据',exact:true}),'GET',OUTAGES,'declaration');
    await relations().getByText('未能完整核对双方声明与关系依据，已清除本次正文。请检查权限后明确重读；未提交任何关系。',{exact:true}).waitFor();
    assert.equal(requests.length-beforeFailure,2);assert.equal(await bodyPair().count(),0);assert(await relations().getByRole('button',{name:'明确登记声明关系',exact:true}).isDisabled());groups.push(stage);

    stage=outageRelationsAcceptanceGroups[6];await fillPair(seed.related);const hiddenGate=armHold(({url,q})=>url.pathname===RELATIONS&&q.mode==='detail');
    await relations().getByRole('button',{name:'读取双方声明与关系依据',exact:true}).click();await bounded(hiddenGate.entered.promise,'outage_relations_missing_held_third_get');
    assert.equal(await bodyPair().count(),0);await page.evaluate(()=>window.__outageRelationsHarness.visibility(true));hiddenGate.released.resolve();await settle();assert.equal(await relations().count(),0);
    const beforeVisible=requests.length;await page.evaluate(()=>window.__outageRelationsHarness.visibility(false));await settle();assert.equal(requests.length,beforeVisible);groups.push(stage);

    stage=outageRelationsAcceptanceGroups[7];await readDeclaration(seed.declaration);await fillPair(seed.related);
    const authGate=armHold(({url,q})=>url.pathname===OUTAGES&&q.declarationId===seed.related);await relations().getByRole('button',{name:'读取双方声明与关系依据',exact:true}).click();
    await bounded(authGate.entered.promise,'outage_relations_missing_held_second_get');const beforeActor=requests.length;
    await configure({other:true});await dialog().waitFor({state:'detached'});authGate.released.resolve();await settle();assert.equal(requests.length,beforeActor);
    await configure({access:'self',other:false,enabled:true});await open();assert.equal(requests.length,beforeActor);
    assert.equal(await relations().count(),0);assert.equal(await parent().getByRole('region',{name:'已完整核对的双方声明',exact:true}).count(),0);
    assert.equal(await page.evaluate(k=>sessionStorage.getItem(k),key),null);assert.equal(await page.evaluate(()=>sessionStorage.getItem('qa-relations-unrelated')),'preserve');
    assert.equal(await page.evaluate(()=>localStorage.getItem('qa-relations-unrelated')),'preserve');groups.push(stage);

    // Preserve the complete 223 proof before any 224 setup or fourth UI write.
    assert.deepEqual(groups,outageRelationsAcceptanceGroups.slice(0,8));assert.deepEqual(external,[]);assert.deepEqual(errors,[]);assert.equal(requests.filter(r=>r.method==='POST').length,3);
    const legacySnapshot=server.snapshot();assert.deepEqual(legacySnapshot.errors,[]);assert.equal(legacySnapshot.model.successfulWrites,3);
    assert.deepEqual(legacySnapshot.model.rows.map(row=>[row.revision,row.action,row.kind]),[[1,'apply','possible_duplicate'],[2,'revoke','possible_duplicate'],[3,'apply','complementary']]);
    const legacyCounts={groups:8,requests:requests.length,postAttempts:3};

    stage=outageRelationsAcceptanceGroups[8];await close();server.controls.setIdentityChanged(true);
    await configure({access:'owner',other:false,enabled:true});await open();await readDeclaration(seed.declaration);
    const blocked=await readPair(seed.related);
    assert.equal(blocked.data.canWrite,true);assert.equal(blocked.data.preview.eligible,false);assert.deepEqual(blocked.data.preview.blockers,['identity_changed']);
    assert.equal(blocked.data.preview.fingerprint,null);assert.equal(blocked.data.preview.evidence,null);assert.deepEqual(blocked.data.current,committed.receipt.entry);
    assert((await relations().innerText()).includes('当前身份绑定与保存声明不同'));
    await draft('possible_duplicate','224 当前资格变化，仅明确撤销保存关系提示');
    assert(await relations().getByRole('button',{name:'明确登记声明关系',exact:true}).isDisabled());assert(await relations().getByRole('button',{name:'明确撤销声明关系',exact:true}).isEnabled());
    const safeRevoked=await click(relations().getByRole('button',{name:'明确撤销声明关系',exact:true}),'POST',RELATIONS),safeBody=postBodies.at(-1);
    assert.equal(safeBody.command.action,'revoke');assert.equal(safeBody.command.expectedRevision,3);assert.equal(safeBody.command.expectedFingerprint,committed.receipt.entry.fingerprint);
    assert.equal(safeBody.query.declarationId,seed.declaration);assert.equal(safeBody.query.relatedDeclarationId,seed.related);assert(!Object.hasOwn(safeBody.command,'kind'));
    assert.equal(safeRevoked.data.receipt.entry.revision,4);assert.equal(safeRevoked.data.receipt.entry.action,'revoke');assert.equal(safeRevoked.data.receipt.entry.kind,'complementary');assert.equal(safeRevoked.data.receipt.entry.evidence,null);
    assert.equal(await page.evaluate(k=>sessionStorage.getItem(k),key),null);assert.equal(requests.filter(r=>r.method==='POST').length,4);groups.push(stage);

    stage=outageRelationsAcceptanceGroups[9];server.controls.setIdentityChanged(false);
    const beforeSetupRequests=requests.length,beforeSetupSnapshot=server.snapshot(),setup=server.controls.prepareHistory(27),afterSetup=server.snapshot();
    assert.equal(setup.fromRevision,4);assert.equal(setup.throughRevision,27);assert.equal(setup.setupWrites,23);assert.equal(requests.length,beforeSetupRequests);
    assert.equal(afterSetup.requests.length,beforeSetupSnapshot.requests.length);assert.equal(afterSetup.model.successfulWrites,4);assert.equal(afterSetup.model.setupWrites,23);
    assert.deepEqual(afterSetup.model.rows.slice(0,4),beforeSetupSnapshot.model.rows);assert.equal(afterSetup.model.rows.length,27);
    const historyProof=[],historyLayouts=[];
    const assertHistoryDom=async entries=>{const cards=relations().getByRole('region',{name:'已保存声明关系资料',exact:true}).locator('article');
      assert.equal(await cards.count(),entries.length);
      for(let index=0;index<entries.length;index++){const text=await cards.nth(index).innerText();assert(text.includes(entries[index].operationId));assert.match(text,new RegExp(`版本 ${entries[index].revision}(?:\\D|$)`));}
    };
    for(const access of ['owner','self']){
      await close();await configure({access,other:false,enabled:true});await open();await readDeclaration(seed.declaration);
      const firstRequest=requests.length;
      await click(relations().getByRole('button',{name:'读取本声明关系',exact:true}),'GET',RELATIONS,'list');
      const first=await click(relations().getByRole('button',{name:'读取这对关系历史',exact:true}),'GET',RELATIONS,'history');
      assert.equal(first.data.history.length,25);assert.equal(first.data.historyTruncated,true);assert.equal(first.data.history.at(-1).revision,3);await assertHistoryDom(first.data.history);
      const older=relations().getByRole('button',{name:'更早的声明关系历史',exact:true});assert(await older.isVisible());
      const layout={access,document:await page.evaluate(()=>({scrollWidth:document.documentElement.scrollWidth,innerWidth})),panel:await relations().evaluate(e=>({scrollWidth:e.scrollWidth,clientWidth:e.clientWidth}))};
      assert(layout.document.scrollWidth<=layout.document.innerWidth);assert(layout.panel.scrollWidth<=layout.panel.clientWidth);historyLayouts.push(layout);
      const second=await click(older,'GET',RELATIONS,'history');assert.equal(second.data.historyTruncated,false);assert.equal(await older.count(),0);await assertHistoryDom(second.data.history);
      const pages=requests.slice(firstRequest).filter(r=>r.mode==='history');assert.equal(pages.length,2);
      assert.deepEqual(pages.map(r=>r.beforeRevision),[null,'3']);assert(requests.slice(firstRequest).every(r=>r.method==='GET'&&r.actor===(access==='owner'?seed.owner:seed.auth)));
      historyProof.push({access,...assertOutageRelationsHistoryPages(first.data.history,second.data.history,afterSetup.model.rows)});
    }
    // Explicit transport GETs, not extra UI recovery buttons or seeded pending:
    // history setup must preserve the complete three previously verified receipts.
    await close();await configure({access:'owner',other:false,enabled:false});const beforeOldReceipts=requests.length;
    for(const expected of [applied.data.receipt,revoked.data.receipt,committed.receipt]){
      const originalQuery={siteId:seed.siteId,access:'owner',mode:'recover',declarationId:seed.declaration,relatedDeclarationId:seed.related,operationId:expected.operationId};
      const checked=await page.evaluate(async({endpoint,query,actor})=>{const response=await fetch(endpoint+'?'+new URLSearchParams(query),{method:'GET',credentials:'omit',redirect:'error',
        headers:{'x-outage-relations-qa-actor':actor,'x-outage-relations-qa-enabled':'0'}});return {status:response.status,wire:await response.json()};},{endpoint:RELATIONS,query:originalQuery,actor:seed.owner});
      assert.equal(checked.status,200);assert.deepEqual(checked.wire.data.receipt,expected);
    }
    await settle();assert.equal(requests.length-beforeOldReceipts,3);assert(requests.slice(beforeOldReceipts).every(r=>r.method==='GET'&&r.mode==='recover'&&r.actor===seed.owner));
    assert.equal(await page.evaluate(k=>sessionStorage.getItem(k),key),null);groups.push(stage);

    assert.deepEqual(groups,outageRelationsAcceptanceGroups);assert.deepEqual(external,[]);assert.deepEqual(errors,[]);assert.equal(requests.filter(r=>r.method==='POST').length,4);
    const snapshot=server.snapshot();assert.deepEqual(snapshot.errors,[]);assert.equal(snapshot.model.successfulWrites,4);assert.equal(snapshot.model.setupWrites,23);assert.equal(snapshot.model.rows.length,27);
    assert.equal(snapshot.model.setupGets,23);assert.equal(snapshot.model.setupPosts,23);assert.equal(snapshot.model.setupRequests,46);assert.equal(snapshot.model.setupErrors,0);
    assert.deepEqual(snapshot.model.rows,afterSetup.model.rows);
    report={groups,checks:groups.length,requests:requests.length,getRequests:requests.filter(r=>r.method==='GET').length,postAttempts:4,legacyCounts,
      syntheticHistorySetup:{via:'Node-only model.respond, not HTTP or UI',fromRevision:setup.fromRevision,throughRevision:setup.throughRevision,writes:setup.setupWrites,reads:snapshot.model.setupGets,requests:snapshot.model.setupRequests},
      safeRevoke:{expectedRevision:safeBody.command.expectedRevision,revision:4,savedHeadFingerprintMatched:true},historyProof,historyLayouts,oldReceiptTransportGetChecks:3,
      actualParentLauncher:true,actualPanels:true,actualBrowser:true,syntheticApi:true,actualAuthentication:false,database:false,production:false,
      unknownPostMethod:'actual synthetic POST saved, HTTP 200 result truncated before delivery; original GET verifies exact receipt',
      notCovered:['real Auth or SQL transport','native tab visibility; visibilitychange is synthetic'],
      network:'127.0.0.1 only',externalRequests:external.length,browserErrors:errors.length,mobileDocument,mobilePanel,server:snapshot,closed:false};
  }catch(error){failure=new Error(`outage_relations_browser_acceptance_failed:${stage}`,{cause:error});}
  finally{
    clearTimeout(deadline);closing=true;for(const held of gates)held.released.resolve();let cleanupFailure=null;
    try{await runAttendanceCleanupSteps([{name:'relations browser context',run:()=>context?.close()},{name:'relations browser',run:()=>browser?.close()},
      {name:'relations routes',run:()=>Promise.allSettled([...inflight])},{name:'relations server',run:()=>server?.close()}]);}catch(error){cleanupFailure=error;}
    if(failure&&cleanupFailure)throw new AggregateError([failure,cleanupFailure],'outage_relations_acceptance_and_cleanup_failed');if(cleanupFailure)throw cleanupFailure;
  }
  if(failure)throw failure;assert(report);assert.equal(browser.isConnected(),false);await bounded(server.closed,'outage_relations_server_closed_timeout');assert.equal(server.snapshot().listenerActive,false);
  return {...report,closed:true,listenerActive:false};
}

const isMain=process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url;
if(isMain){try{const args=outageRelationsAcceptanceArguments(process.argv.slice(2));
  if(!args.run)console.log(JSON.stringify({ran:false,reason:'explicit --run-local required',command:`node --import tsx ${path.relative(process.cwd(),fileURLToPath(import.meta.url))} --run-local`,database:false,production:false}));
  else console.log(JSON.stringify(await runOutageRelationsBrowserAcceptance(),null,2));
}catch(error){console.error(error);process.exitCode=1;}}
