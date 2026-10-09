// Inert on import. Bounded real UI + synthetic API only; no SQL, login, cluster,
// dependency installation, copied node_modules, source mutation or full build.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import path from 'node:path';
import {build,stop} from 'esbuild';
import {compile} from '@tailwindcss/node';
import ts from 'typescript';
import {chromium} from 'playwright';
import {runAttendanceCleanupSteps} from './attendance-cleanup.mjs';
const require=createRequire(import.meta.url);
const {OUTAGE_APIS,parseOutageHttpBody,parseOutageHttpQuery,parseOutageHttpResponse}=require('../../src/lib/merchantAttendanceOutageHttp.ts');
const {outageCommandFingerprintText}=require('../../src/lib/merchantAttendanceOutage.ts');
const {outageLinksCommandFingerprintText}=require('../../src/lib/merchantAttendanceOutageLinks.ts');
const {outageReviewCommandFingerprintText}=require('../../src/lib/merchantAttendanceOutageReview.ts');
const {OUTAGE_SUBJECT_API,parseOutageSubjectHttpQuery,parseOutageSubjectResponse}=require('../../src/lib/merchantAttendanceOutageSubject.ts');
const root=fileURLToPath(new URL('../../',import.meta.url));
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const seed={siteId:'99990001',owner:id(217001),self:id(217002),other:id(217099),workerId:id(217003)};
const employee=id(217004),location=id(217005),ref={kind:'session',startEventId:id(217006),lastEventId:id(217007),lastSequence:2,effectOperationId:null,effectRevision:null};
const sha=value=>createHash('sha256').update(value,'utf8').digest('hex');
const instant=()=>new Date().toISOString().replace(/(\.\d{3})Z$/,'$1000Z');
const clone=value=>structuredClone(value);
async function assets(){
  const output=await build({absWorkingDir:root,entryPoints:['scripts/fixtures/attendance-outage-workspace-browser.tsx'],bundle:true,write:false,metafile:true,platform:'browser',format:'esm',jsx:'automatic',target:['es2020'],tsconfig:path.join(root,'tsconfig.json'),outfile:'qa.js',logLevel:'warning',define:{'process.env':'{}','process.env.NODE_ENV':'"development"'}});
  for(const name of Object.keys(output.metafile.inputs))assert(!/node:crypto|\.server\.ts$/.test(name),'outage_ui_server_import');
  const tokens=new Set();for(const name of Object.keys(output.metafile.inputs).filter(n=>/\.tsx?$/.test(n)&&!n.includes('node_modules'))){
    const ast=ts.createSourceFile(name,await readFile(path.join(root,name),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
    const visit=node=>{if(ts.isStringLiteral(node)||ts.isNoSubstitutionTemplateLiteral(node))node.text.split(/\s+/).filter(Boolean).forEach(token=>tokens.add(token));ts.forEachChild(node,visit);};visit(ast);}
  const css=(await compile('@import "tailwindcss";',{base:root,onDependency:()=>{}})).build([...tokens])+'body{margin:0;font-family:Arial,sans-serif;background:#f8fafc}.qa-main{max-width:1000px;margin:auto;padding:8px}.qa-notice{font-size:12px;overflow-wrap:anywhere}';
  return {js:output.outputFiles.find(f=>f.path.endsWith('.js')).contents,css};
}
function syntheticApi(){
  const incidents=new Map(),declarations=new Map(),operations=new Map();let linked=null,reviewEntries=[],proposal=null,response=null;
  const savedKey=(kind,actor,op)=>[kind,actor,op].join(':');
  const commandHash=(kind,q,c)=>sha(kind==='outages'?outageCommandFingerprintText(q,c):kind==='links'?outageLinksCommandFingerprintText(q,c):outageReviewCommandFingerprintText(q,c));
  const linkEvidence=declaration=>({protocol:'outage-link-evidence-v1',siteId:seed.siteId,declarationId:declaration.id,workerId:seed.workerId,employeeId:employee,employeeAuthUserId:seed.self,
    workerVersion:2,employeeVersion:3,generation:0,declaredInterval:clone(declaration.interval),items:[{reference:ref,locationId:location,timeZone:'Etc/UTC',original:{startAt:declaration.interval.startAt,endAt:declaration.interval.endAt},selected:{startAt:declaration.interval.startAt,endAt:declaration.interval.endAt},evidenceFingerprint:sha('synthetic immutable source'),pending:false,open:false}]});
  const reviewEvidence=()=>({protocol:'outage-review-evidence-v1',siteId:seed.siteId,declarationId:linked.evidence.declarationId,linkOperationId:linked.operationId,linkRevision:linked.revision,linkFingerprint:linked.fingerprint,linkEvidence:clone(linked.evidence),original:{status:'not_required',operationId:null,channel:null,eventId:null}});
  function result(kind,q,actor,c){
    const common={siteId:q.siteId,access:q.access,mode:q.mode,actorId:actor,readAt:instant(),canWrite:true};
    if(kind==='outages'){
      const r={protocol:'attendance-outage-v1',...common,items:[],detail:null,receipt:null,nextId:null};
      if(c){
        const at=instant(),record=c.action==='create_incident'?{kind:'incident',id:c.incidentId,operationId:c.operationId,type:c.type,channel:c.channel,locationId:c.locationId,interval:c.interval,reason:c.reason,actorId:actor,recordedAt:at}
          :{kind:'declaration',id:c.declarationId,operationId:c.operationId,incidentId:c.incidentId,workerId:c.workerId,employeeId:c.employeeId,employeeAuthUserId:c.employeeAuthUserId,
            workerVersion:c.expectedWorkerVersion,employeeVersion:c.expectedEmployeeVersion,generation:c.expectedGeneration,interval:c.interval,statement:c.statement,originalOperationId:c.originalOperationId,originalChannel:c.originalChannel,paperReference:c.paperReference,recordedBy:q.access,actorId:actor,actorEmployeeId:q.access==='self'?employee:null,recordedAt:at};
        if(c.action==='declare'){assert(incidents.has(c.incidentId));assert.equal(c.workerId,seed.workerId);assert.equal(c.employeeAuthUserId,seed.self);assert.equal(c.expectedWorkerVersion,2);assert.equal(c.expectedEmployeeVersion,3);assert.equal(c.expectedGeneration,0);}
        (c.action==='create_incident'?incidents:declarations).set(record.id,record);
        r.canWrite=false;r.receipt={operationId:c.operationId,action:c.action,recordId:record.id,incidentId:c.incidentId,actorId:actor,commandFingerprint:commandHash(kind,q,c),recordedAt:at};
        operations.set(savedKey(kind,actor,c.operationId),clone(r));
      }else if(q.mode==='recover'){const saved=operations.get(savedKey(kind,actor,q.operationId));assert(saved,'synthetic_receipt_required');return {...clone(saved),mode:'recover',readAt:instant()};}
      else if(q.mode==='incidents')r.items=[...incidents.values()].filter(i=>!q.afterId||i.id>q.afterId).sort((a,b)=>a.id.localeCompare(b.id));
      else if(q.mode==='declarations')r.items=[...declarations.values()].filter(d=>d.incidentId===q.incidentId&&(q.access==='owner'||d.employeeAuthUserId===actor)).sort((a,b)=>a.id.localeCompare(b.id));
      else r.detail=clone((q.mode==='incident'?incidents:declarations).get(q.mode==='incident'?q.incidentId:q.declarationId));
      r.readAt=instant();return r;
    }
    const declaration=declarations.get(q.declarationId);assert(declaration,'synthetic_declaration_required');
    if(kind==='links'){
      const r={protocol:'attendance-outage-links-v1',...common,declarationId:q.declarationId,canWrite:q.access==='owner',revision:linked?.revision??0,current:clone(linked),preview:null,history:[],historyTruncated:false,receipt:null};
      if(c){assert.equal(c.action,'apply');assert.equal(c.expectedRevision,r.revision);assert.deepEqual(c.sources,[ref]);const evidence=linkEvidence(declaration);assert.equal(c.expectedFingerprint,sha(JSON.stringify(evidence)));
        linked={operationId:c.operationId,revision:r.revision+1,action:'apply',actorId:actor,reason:c.reason,sources:clone(c.sources),evidence,fingerprint:c.expectedFingerprint,recordedAt:instant()};
        r.revision=linked.revision;r.current=null;r.canWrite=false;r.receipt={operationId:c.operationId,commandFingerprint:commandHash(kind,q,c),entry:clone(linked)};operations.set(savedKey(kind,actor,c.operationId),clone(r));
      }else if(q.mode==='recover'){const saved=operations.get(savedKey(kind,actor,q.operationId));assert(saved);return {...clone(saved),mode:'recover',readAt:instant()};}
      else if(q.mode==='preview'||linked){const evidence=linkEvidence(declaration);if(q.mode==='preview')assert.deepEqual(q.sources,[ref]);r.preview={fingerprint:sha(JSON.stringify(evidence)),evidence,eligible:true,blockers:[],observations:evidence.items.map(i=>({reference:i.reference,current:i,available:true,changed:false,open:false,pending:false}))};}
      r.readAt=instant();return r;
    }
    const head=reviewEntries.at(-1)??null,ev=linked?reviewEvidence():null,basis=ev?sha(JSON.stringify(ev)):null;
    const r={protocol:'attendance-outage-review-v1',...common,declarationId:q.declarationId,revision:head?.revision??0,resultVersion:proposal?.resultVersion??0,current:clone(head),proposal:clone(proposal),response:clone(response),status:null,history:[],historyTruncated:false,receipt:null};
    if(c){assert.equal(c.expectedRevision,r.revision);assert.equal(c.expectedResultVersion,r.resultVersion);assert.equal(c.expectedFingerprint,c.action==='propose'?basis:proposal.resultFingerprint);
      const entry={operationId:c.operationId,revision:r.revision+1,action:c.action,actorId:actor,resultVersion:r.resultVersion+(c.action==='propose'?1:0),resultFingerprint:c.expectedFingerprint,reason:c.reason,recordedAt:instant()};
      if(c.action==='propose'){assert.equal(q.access,'owner');proposal={...entry,evidence:ev};response=null;}
      else if(c.action==='confirm'){assert.equal(q.access,'self');assert(['propose','dispute','reopen'].includes(head.action));response=entry;}
      else if(c.action==='resolve'){assert.equal(q.access,'owner');assert.equal(head.action,'confirm');}
      else if(c.action==='reopen'){assert.equal(q.access,'owner');assert.equal(head.action,'resolve');}
      else throw Error('synthetic_action_outside_fixture');reviewEntries=[...reviewEntries,entry];
      Object.assign(r,{canWrite:false,revision:entry.revision,resultVersion:entry.resultVersion,current:null,proposal:null,response:null,receipt:{operationId:c.operationId,commandFingerprint:commandHash(kind,q,c),entry,proposal:clone(proposal)}});
      operations.set(savedKey(kind,actor,c.operationId),clone(r));
    }else if(q.mode==='recover'){const saved=operations.get(savedKey(kind,actor,q.operationId));assert(saved);return {...clone(saved),mode:'recover',readAt:instant()};}
    else{
      const blockers=[...(!linked?['link_missing']:[]),...(!proposal?['result_missing']:[]),...(response?.action==='confirm'?[]:['unconfirmed']),...(head?.action==='reopen'?['reopened']:[])];
      r.status={basisFingerprint:basis,linkOperationId:linked?.operationId??null,linkRevision:linked?.revision??0,linkFingerprint:linked?.fingerprint??null,blockers,
        canPropose:q.access==='owner'&&!!linked&&head?.action!=='resolve',canConfirm:q.access==='self'&&!!proposal&&['propose','dispute','reopen'].includes(head.action),canResolve:q.access==='owner'&&head?.action==='confirm',resolved:head?.action==='resolve'&&response?.action==='confirm'};
    }
    r.readAt=instant();return r;
  }
  return {incidents,declarations,operations,dispatch(pathname,url,actor,body){
    assert([seed.owner,seed.self].includes(actor),'synthetic_actor_scope');
    if(pathname===OUTAGE_SUBJECT_API){const q=parseOutageSubjectHttpQuery(url),incident=incidents.get(q.incidentId);assert(incident);assert.equal(q.access,actor===seed.owner?'owner':'self');
      const data={protocol:'attendance-outage-subject-v1',siteId:q.siteId,access:q.access,actorId:actor,readAt:instant(),canWrite:true,
        subject:{workerId:seed.workerId,employeeId:employee,employeeAuthUserId:seed.self,workerVersion:2,employeeVersion:3,generation:0,displayName:'合成核验员工',active:true,paused:false},
        incident:Object.fromEntries(['id','type','channel','locationId','interval'].map(key=>[key,clone(incident[key])]))};const wire={ok:true,canWrite:true,data};parseOutageSubjectResponse(wire,q,actor);return wire;}
    const kind=Object.keys(OUTAGE_APIS).find(k=>OUTAGE_APIS[k]===pathname);assert(kind,'synthetic_endpoint');
    const parsed=body===null?null:parseOutageHttpBody(kind,body,actor),q=parsed?.query??parseOutageHttpQuery(kind,url),c=parsed?.command??null;
    assert.equal(q.siteId,seed.siteId);assert.equal(q.access,actor===seed.owner?'owner':'self');
    const wire={ok:true,canWrite:true,data:result(kind,q,actor,c)};parseOutageHttpResponse(kind,wire,q,actor,c);return wire;
  }};
}
export async function runOutageWorkspaceBrowserAcceptance({screenshotPath=null}={}){
  if(screenshotPath!==null){const folder=path.join(root,'.tmp','outage-217-qa-8f970ac3');assert.equal(path.dirname(path.resolve(screenshotPath)),folder,'outage_ui_screenshot_owned_directory');assert.equal(path.extname(screenshotPath),'.png');}
  const api=syntheticApi(),requests=[],errors=[],inflight=new Set();let files,browser,context,page,origin,closing=false,failure=null,report=null,stage='setup',accept=true,dropNext=false,holdNext=false,releaseHeld=null,heldNotify=null;
  const server=createServer((request,response)=>{
    if(!origin||request.headers.host!==new URL(origin).host||request.method!=='GET')return response.writeHead(403).end();
    const u=new URL(request.url??'/',origin);if(u.search||!['/','/qa.js','/qa.css'].includes(u.pathname))return response.writeHead(403).end();
    response.setHeader('Cache-Control','no-store');response.setHeader('X-Content-Type-Options','nosniff');response.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; object-src 'none'");
    if(u.pathname==='/')return response.writeHead(200,{'Content-Type':'text/html;charset=utf-8'}).end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>故障工作区合成验收</title><link rel="stylesheet" href="/qa.css"><div id="qa-root"></div><script type="module" src="/qa.js"></script></html>');
    return response.writeHead(200,{'Content-Type':u.pathname==='/qa.js'?'text/javascript;charset=utf-8':'text/css;charset=utf-8'}).end(u.pathname==='/qa.js'?files.js:files.css);
  });
  const dialog=()=>page.getByRole('dialog',{name:'故障登记与恢复工作区',exact:true}),panel=()=>dialog().getByRole('region',{name:'故障登记与逐人声明',exact:true}),resolution=()=>dialog().getByRole('region',{name:'故障来源与核对结果',exact:true});
  const configure=async(access,enabled=true,other=false)=>{await page.evaluate(value=>window.__outageWorkspaceHarness.configure(value),{access,enabled,other});};
  const quiet=async()=>{await page.waitForLoadState('networkidle');await Promise.all([...inflight]);};
  const click=async(locator,method='GET',endpoint=null)=>{const [response]=await Promise.all([page.waitForResponse(r=>r.request().method()===method&&(!endpoint||new URL(r.url()).pathname===endpoint)&&new URL(r.url()).pathname.startsWith('/api/')),locator.click()]);
    await response.finished();const text=await response.text();assert.equal(response.status(),200,text);await quiet();return JSON.parse(text);};
  const open=async(access,off=false)=>{await page.getByRole('button',{name:off?'核对待确认故障操作':access==='owner'?'登记该人员故障声明':'我的故障声明与核对',exact:true}).click();await panel().waitFor();await quiet();};
  const close=async()=>{await panel().getByRole('button',{name:'关闭故障工作区',exact:true}).click();await dialog().waitFor({state:'detached'});};
  const openDeclaration=async id=>{await panel().getByLabel('已知声明编号',{exact:true}).fill(id);await click(panel().getByRole('button',{name:'读取声明与恢复核对',exact:true}),'GET',OUTAGE_APIS.outages);await resolution().waitFor();};
  const reviewAction=async(name,reason)=>{await resolution().getByLabel(name.startsWith('本人')?'本人核对说明':'负责人核对理由',{exact:true}).fill(reason);await resolution().getByLabel('确认已核对结果精确版本与证据',{exact:true}).check();return resolution().getByRole('button',{name,exact:true});};
  let deadline;
  try{
    files=await assets();await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const address=server.address();assert(address&&typeof address==='object');origin=`http://127.0.0.1:${address.port}`;
    browser=await chromium.launch({headless:true});context=await browser.newContext({serviceWorkers:'block',acceptDownloads:false,viewport:{width:390,height:900}});
    deadline=setTimeout(()=>{errors.push('outage_workspace_browser_deadline');void context.close();},180000);
    await context.addInitScript(seed=>{Object.defineProperty(window,'__outageWorkspaceSeed',{value:seed});sessionStorage.setItem('qa-unrelated','preserve');localStorage.setItem('qa-unrelated','preserve');},seed);
    await context.route('**/*',route=>{if(closing)return route.abort().catch(()=>{});const task=(async()=>{
      const request=route.request(),url=new URL(request.url());assert.equal(url.origin,origin,'outage_workspace_external_network');
      if(['/','/qa.js','/qa.css'].includes(url.pathname))return route.continue();
      assert(requests.length<40,'outage_workspace_request_budget');assert([...Object.values(OUTAGE_APIS),OUTAGE_SUBJECT_API].includes(url.pathname),'outage_workspace_unknown_endpoint');
      const method=request.method();assert(['GET','POST'].includes(method));if(method==='POST')assert(requests.filter(r=>r.method==='POST').length<8,'outage_workspace_post_budget');
      const raw=request.postData();assert(!raw||Buffer.byteLength(raw,'utf8')<=32768);
      const actor=request.headers()['x-outage-qa-actor'],body=raw===null?null:JSON.parse(raw),wire=api.dispatch(url.pathname,url.href,actor,body);
      requests.push({path:url.pathname,method,mode:body?.query.mode??url.searchParams.get('mode'),action:body?.command.action??null,actor,status:200});
      if(method==='POST'&&dropNext){dropNext=false;return route.abort('failed');}
      if(method==='GET'&&holdNext){holdNext=false;await new Promise(resolve=>{releaseHeld=resolve;heldNotify?.();});}
      try{return await route.fulfill({status:200,headers:{'Content-Type':'application/json','Cache-Control':'private, no-store'},body:JSON.stringify(wire)});}catch(error){if(request.failure())return;throw error;}
    })();inflight.add(task);void task.finally(()=>inflight.delete(task)).catch(()=>{});return task.catch(async error=>{if(!closing)errors.push(error.message);await route.abort().catch(()=>{});});});
    page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',error=>errors.push(error.message));page.on('dialog',d=>{void(accept?d.accept():d.dismiss()).catch(()=>{});});
    const checks=[];
    stage='default_off_and_owner_create';await page.goto(origin);await quiet();assert.equal(requests.length,0);assert.equal(await page.getByRole('button',{name:'登记该人员故障声明',exact:true}).count(),0);
    await configure('owner');await open('owner');assert.equal(requests.length,0);await click(panel().getByRole('button',{name:'读取故障登记列表',exact:true}),'GET',OUTAGE_APIS.outages);
    const day=new Date(Date.now()-7*86400000).toISOString().slice(0,10);
    for(const [label,value] of [['故障当地开始',day+'T08:00'],['故障当地结束',day+'T10:00'],['故障IANA时区','Etc/UTC'],['故障开始UTC偏移分钟','0'],['故障结束UTC偏移分钟','0'],['故障登记理由','合成浏览器网络中断登记']])await panel().getByLabel(label,{exact:true}).fill(value);
    await panel().getByLabel('确认登记故障',{exact:true}).check();const created=await click(panel().getByRole('button',{name:'明确登记故障',exact:true}),'POST',OUTAGE_APIS.outages),incidentId=created.data.receipt.recordId;
    assert.equal(created.data.receipt.action,'create_incident');await panel().locator('[data-outage-receipt]').waitFor();checks.push('owner_launcher_explicit_create');
    stage='self_explicit_prepare_and_declare';await close();await configure('self');await open('self');const beforePrepare=requests.length;
    await panel().getByLabel('已知故障编号',{exact:true}).fill(incidentId);const prepared=await click(panel().getByRole('button',{name:'核验故障与本人声明资格',exact:true}),'GET',OUTAGE_SUBJECT_API);assert.equal(requests.length,beforePrepare+1);assert.equal(prepared.data.subject.employeeAuthUserId,seed.self);
    await panel().getByRole('button',{name:'使用已核验故障时段（仍需明确确认）',exact:true}).click();await panel().getByLabel('故障声明说明',{exact:true}).fill('合成本人逐人说明，不认定原打卡失败');await panel().getByLabel('确认逐人故障声明',{exact:true}).check();
    const declared=await click(panel().getByRole('button',{name:'明确保存故障声明',exact:true}),'POST',OUTAGE_APIS.outages),declarationId=declared.data.receipt.recordId;
    await click(panel().getByRole('button',{name:'读取该已保存记录',exact:true}),'GET',OUTAGE_APIS.outages);await resolution().waitFor();assert.equal(await resolution().getByRole('button',{name:'预览这些明确来源',exact:true}).count(),0);checks.push('self_prepare_snapshot_and_declare');
    stage='owner_sources_and_proposal';await close();await configure('owner');await open('owner');await openDeclaration(declarationId);
    for(const [label,value] of [['第1项开始事件编号',ref.startEventId],['第1项末尾事件编号',ref.lastEventId],['第1项末尾序号','2']])await resolution().getByLabel(label,{exact:true}).fill(value);
    await click(resolution().getByRole('button',{name:'预览这些明确来源',exact:true}),'GET',OUTAGE_APIS.links);await resolution().getByLabel('来源关联理由',{exact:true}).fill('明确核对合成历史工作段');await resolution().getByLabel('确认已核对整组来源与声明',{exact:true}).check();
    await click(resolution().getByRole('button',{name:'保存本次整组来源关联',exact:true}),'POST',OUTAGE_APIS.links);assert((await resolution().innerText()).includes('来源关联原号回执'));
    await click(resolution().getByRole('button',{name:'读取当前核对结果',exact:true}),'GET',OUTAGE_APIS.reviews);await click(await reviewAction('提出新核对结果','负责人提出供本人核对的合成结果'),'POST',OUTAGE_APIS.reviews);checks.push('explicit_links_preview_apply_and_propose');
    stage='self_confirmation';await close();await configure('self');await open('self');await openDeclaration(declarationId);await click(resolution().getByRole('button',{name:'读取当前核对结果',exact:true}),'GET',OUTAGE_APIS.reviews);
    await click(await reviewAction('本人确认当前结果','本人明确确认此精确结果版本'),'POST',OUTAGE_APIS.reviews);checks.push('self_exact_version_confirm');
    stage='owner_resolution';await close();await configure('owner');await open('owner');await openDeclaration(declarationId);await click(resolution().getByRole('button',{name:'读取当前核对结果',exact:true}),'GET',OUTAGE_APIS.reviews);
    await click(await reviewAction('明确结案','依据本人的当前确认明确结案'),'POST',OUTAGE_APIS.reviews);await click(resolution().getByRole('button',{name:'读取当前核对结果',exact:true}),'GET',OUTAGE_APIS.reviews);assert((await resolution().innerText()).includes('本次核验：该声明当前已结案'));
    if(screenshotPath){await resolution().getByRole('region',{name:'当前结案核验',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:screenshotPath,fullPage:false});}checks.push('owner_explicit_resolve_then_read');
    stage='lost_post_flagoff_reload_get_only';dropNext=true;const failed=page.waitForEvent('requestfailed',{predicate:r=>r.method()==='POST'&&new URL(r.url()).pathname===OUTAGE_APIS.reviews});await (await reviewAction('重开已结案结果','合成丢响应场景的明确重开')).click();await failed;await quiet();
    const key=`faolla:attendance:outage-client:v1:reviews:${seed.siteId}:owner:${seed.owner}`,raw=await page.evaluate(k=>sessionStorage.getItem(k),key);assert(raw);assert.equal(JSON.parse(raw).command.action,'reopen');assert(!(await resolution().innerText()).includes('合成丢响应场景的明确重开'));
    const beforeReload=requests.length,posts=requests.filter(r=>r.method==='POST').length;await page.reload();await quiet();assert.equal(requests.length,beforeReload);await open('owner',true);assert.equal(requests.length,beforeReload);
    await panel().getByRole('button',{name:'核对待确认恢复结果',exact:true}).click();await resolution().waitFor();await quiet();assert.equal(requests.length,beforeReload);
    await click(resolution().getByRole('button',{name:'只核对核对结果原编号',exact:true}),'GET',OUTAGE_APIS.reviews);assert.equal(await page.evaluate(k=>sessionStorage.getItem(k),key),null);assert.equal(requests.filter(r=>r.method==='POST').length,posts);checks.push('lost_post_flagoff_reload_original_get_hash');
    stage='dirty_exit_and_narrow_layout';await close();await configure('owner');await open('owner');await openDeclaration(declarationId);await resolution().getByLabel('第1项开始事件编号',{exact:true}).fill(ref.startEventId);
    accept=false;const dismissed=page.waitForEvent('dialog');await panel().getByRole('button',{name:'关闭故障工作区',exact:true}).click();await dismissed;assert(await dialog().isVisible());assert.equal(await resolution().getByLabel('第1项开始事件编号',{exact:true}).inputValue(),ref.startEventId);accept=true;
    const mobileDocument=await page.evaluate(()=>({scrollWidth:document.documentElement.scrollWidth,innerWidth})),mobilePanel=await resolution().evaluate(e=>({scrollWidth:e.scrollWidth,clientWidth:e.clientWidth}));assert(mobileDocument.scrollWidth<=mobileDocument.innerWidth);assert(mobilePanel.scrollWidth<=mobilePanel.clientWidth);checks.push('child_dirty_parent_leave_guard_and_390px');
    stage='late_auth_and_hidden_read';const held=new Promise(resolve=>{heldNotify=resolve;});holdNext=true;await resolution().getByRole('button',{name:'读取当前核对结果',exact:true}).click();await held;
    await configure('self');await dialog().waitFor({state:'detached'});releaseHeld();releaseHeld=null;await quiet();await open('self');assert(!(await panel().innerText()).includes('负责人提出供本人核对的合成结果'));
    await openDeclaration(declarationId);const held2=new Promise(resolve=>{heldNotify=resolve;});holdNext=true;await resolution().getByRole('button',{name:'读取当前核对结果',exact:true}).click();await held2;
    await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});releaseHeld();releaseHeld=null;await quiet();assert.equal(await resolution().count(),0);
    const beforeVisible=requests.length;await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));});await quiet();assert.equal(requests.length,beforeVisible);checks.push('auth_switch_and_hide_late_get_no_body');
    assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>sessionStorage.getItem('qa-unrelated')),'preserve');assert.equal(await page.evaluate(()=>localStorage.getItem('qa-unrelated')),'preserve');
    assert.equal(requests.filter(r=>r.method==='POST').length,7);assert.equal(api.incidents.size,1);assert.equal(api.declarations.size,1);
    report={checks:checks.length,groups:checks,requests:requests.length,getRequests:requests.filter(r=>r.method==='GET').length,postAttempts:7,syntheticSavedOperations:api.operations.size,
      actualLauncherAndPanels:true,actualBrowser:true,syntheticApi:true,actualAuthentication:false,database:false,production:false,network:'127.0.0.1 only',browserErrors:errors.length,mobileDocument,mobilePanel,origin,screenshotPath,closed:false};
  }catch(error){failure=new Error(`outage_workspace_browser_failed:${stage}`,{cause:error});}
  finally{
    clearTimeout(deadline);closing=true;releaseHeld?.();let cleanupFailure=null;
    try{await runAttendanceCleanupSteps([{name:'outage UI context',run:()=>context?.close()},{name:'outage UI browser',run:()=>browser?.close()},
      {name:'outage UI requests',run:()=>Promise.allSettled([...inflight])},{name:'outage UI loopback server',run:()=>new Promise((resolve,reject)=>{if(!server.listening)return resolve();server.close(error=>error?reject(error):resolve());server.closeAllConnections();})},
      {name:'outage UI esbuild service',run:()=>stop()}]);}catch(error){cleanupFailure=error;}
    if(failure&&cleanupFailure)throw new AggregateError([failure,cleanupFailure],'outage_workspace_browser_and_cleanup_failed');if(cleanupFailure)throw cleanupFailure;
  }
  if(failure)throw failure;assert(report);assert.equal(server.listening,false);assert.equal(browser.isConnected(),false);return {...report,closed:true};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  try{assert(process.argv.slice(2).every(arg=>arg==='--screenshot'),'outage_ui_unknown_argument');console.log(JSON.stringify(await runOutageWorkspaceBrowserAcceptance({screenshotPath:process.argv.includes('--screenshot')?path.join(root,'.tmp','outage-217-qa-8f970ac3','resolved-mobile.png'):null}),null,2));}catch(error){console.error(error);process.exitCode=1;}
}
