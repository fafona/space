// INERT unless explicitly --run-local. One owned localhost server/context; no DB.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {runAttendanceCleanupSteps} from './attendance-cleanup.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url)),require=createRequire(import.meta.url);
export const correctionBrowserLimits=Object.freeze({ttlMs:180000,http:100,api:40});
const api='/api/merchant-enterprise/attendance/correction-delegation',overview='/api/merchant-enterprise/overview',admin='/api/merchant-enterprise/attendance/admin',operations='/api/merchant-enterprise/current-operations';
const paths=new Set([api,overview,admin,operations]),statics=new Set(['/','/qa.js','/qa.css','/favicon.ico']);
export function createCorrectionBrowserModel(){
  const f=require('../../src/lib/merchantAttendanceCorrectionDelegationTestFixtures.ts'),p=require('../../src/lib/merchantAttendanceCorrectionDelegation.ts'),a=require('../../src/lib/merchantAttendanceAdmin.ts'),ops=require('../../src/lib/merchantEnterpriseCurrentOperations.ts');
  const seed={siteId:'99990001',endpoint:api,owner:f.correctionDelegationOwner,employee:f.correctionDelegationEmployee,auth:f.correctionDelegationAuth,other:f.correctionDelegationId(99),tokens:{owner:'synthetic238-owner',delegate:'synthetic238-delegate',other:'synthetic238-other'}};
  const writes=[],receipts=new Map(),statuses=new Map([[f.correctionDelegationId(20),'submitted'],[f.correctionDelegationId(22),'submitted']]);let grant=null;
  const actor=identity=>({type:identity==='owner'?'owner':'employee',id:identity==='owner'?seed.owner:identity==='delegate'?seed.employee:seed.other,siteId:seed.siteId,displayName:`Synthetic238 ${identity}`,email:`synthetic238-${identity}@example.test`,
    permissions:identity==='delegate'?['enterprise.view','attendance.correction.review']:['enterprise.view'],accessScope:'all',allowedBoardIds:[],...(identity==='owner'?{}:{roleId:f.correctionDelegationId(80)})});
  async function respond(url,method,text,token){const u=new URL(url),identity=Object.entries(seed.tokens).find(([,v])=>v===token)?.[0];assert(identity,'unknown_auth');assert(paths.has(u.pathname));
    const auth=identity==='owner'?seed.owner:identity==='delegate'?seed.auth:seed.other;let body,q=null,c=null,lost=false;
    if(u.pathname===overview){assert.equal(method,'GET');assert.deepEqual([...u.searchParams], [['siteId',seed.siteId]]);body={ok:true,actor:actor(identity),currentAuthUserId:auth,snapshot:{roles:[],employees:[],boards:[],columns:[],tasks:[]},needsBootstrap:false};}
    else if(u.pathname===operations){assert.equal(method,'GET');assert.equal(identity,'owner');body=ops.buildMerchantEnterpriseCurrentOperationsFallback({actor:actor(identity),boards:[],columns:[],tasks:[]},Date.parse('2026-10-08T12:00:00Z'));assert(ops.normalizeMerchantEnterpriseCurrentOperations(body));}
    else if(u.pathname===admin){assert.equal(method,'GET');assert.equal(identity,'owner');q=a.parseAttendanceAdminQuery(u.href);assert.equal(q.view,'settings');assert.equal(q.siteId,seed.siteId);assert(!q.operationId&&!q.cursor&&!q.search);
      body={ok:true,moduleEnabled:true,siteId:seed.siteId,view:'settings',version:1,settings:{timeZone:'UTC',enabled:true,webClockEnabled:true,webBreakPaid:false},items:[],nextCursor:null,receipt:null};a.parseAttendanceAdminResult(body,q);}
    else {assert.notEqual(identity,'other');const parsed=method==='POST'?p.parseCorrectionDelegationBody(p.parseCorrectionDelegationJson(text,'request')):null;q=parsed?.query??p.parseCorrectionDelegationHttpQuery(u.href);c=parsed?.command??null;
      assert.equal(q.siteId,seed.siteId);assert.equal(q.access,identity==='owner'?'owner':'delegate');assert.equal(q.afterId,null);body={ok:true,...f.correctionDelegationWire(q)};
      if(c){assert(!receipts.has(p.correctionDelegationOperation(c)),'duplicate_post');
        if(identity==='owner'){assert.equal(c.action,'grant');assert.equal(c.includePending,false);assert.deepEqual([c.delegateEmployeeId,c.delegateAuthUserId,c.workerId,c.employeeId,c.employeeAuthUserId,c.locationId],[seed.employee,seed.auth,f.correctionDelegationWorker,f.correctionDelegationId(5),f.correctionDelegationId(6),f.correctionDelegationId(7)]);
          grant={...f.correctionDelegationGrant(),grantId:c.operationId,grantedAt:'2026-10-06T11:00:00.000000Z',includePending:c.includePending,validFrom:c.validFrom,validUntil:c.validUntil,reason:c.reason};
        }else{assert(grant);assert.equal(c.grantId,grant.grantId);assert.equal(c.expectedGrantRevision,1);assert.equal(c.decision.expectedRevision,3);assert.equal(c.decision.expectedEvidence,'a'.repeat(32));assert.equal(statuses.get(c.decision.requestId),'submitted');statuses.set(c.decision.requestId,c.decision.action==='approve'?'approved':'rejected');lost=c.decision.action==='approve';}
        body=await f.correctionDelegationReceiptHttp(q,c);if(identity==='owner')assert.equal(grant.grantedAt,body.receipt.recordedAt);else body.receipt.recordedAt='2026-10-06T11:45:00.000000Z';const operationId=p.correctionDelegationOperation(c);receipts.set(operationId,body.receipt);writes.push({query:q,command:c,receipt:body.receipt,lost});
      }else if(q.mode==='recover'){assert(receipts.has(q.operationId));body={...body,canWrite:false,receipt:receipts.get(q.operationId)};}
      else if(identity==='owner'){if(q.mode==='list')body.items=grant?[grant]:[];else if(q.mode==='detail'){assert.equal(q.grantId,grant?.grantId);body.detail=grant;}else assert.equal(q.mode,'catalog');}
      else if(q.mode==='grants'){assert(grant);body.grants=[grant];}
      else {assert.equal(q.grantId,grant?.grantId);assert.equal(q.beforeAt,null);assert.equal(q.beforeId,null);
        if(q.mode==='list')body.items=[...statuses].filter(([,s])=>s==='submitted').map(([requestId])=>({...f.correctionDelegationSummary(),requestId,startEventId:f.correctionDelegationId(requestId===f.correctionDelegationId(22)?23:21),submittedAt:'2026-10-06T11:30:00.000000Z'})).sort((a,b)=>b.requestId.localeCompare(a.requestId));
        else {assert.equal(q.mode,'detail');assert.equal(statuses.get(q.requestId),'submitted');const second=q.requestId===f.correctionDelegationId(22),day=second?'2026-10-02':'2026-10-03';
          body.detail={...f.correctionDelegationDetail(),requestId:q.requestId,startEventId:f.correctionDelegationId(second?23:21),submittedAt:'2026-10-06T11:30:00.000000Z',
            original:{startAt:day+'T08:00:00.000000Z',endAt:day+'T09:59:00.000000Z',breaks:[{startAt:day+'T08:20:00.000000Z',endAt:day+'T08:30:00.000000Z',paid:false}]},
            proposal:{startAt:day+'T08:00:00.000000Z',endAt:day+'T10:00:00.000000Z',breaks:[{startAt:day+'T08:22:00.000000Z',endAt:day+'T08:32:00.000000Z',paid:true}]}};}}
      p.parseCorrectionDelegationResponse(body,q,{authUserId:auth,...(identity==='owner'?{ownerId:auth}:{employeeId:seed.employee})},c);
    }
    return {body,text:lost?'{"ok":':JSON.stringify(body),identity,query:q,command:c};
  }
  return{seed,respond,writes,statuses,actor};
}
async function bounded(promise,ms=12000){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('correction_browser_deadline')),ms);})]);}finally{clearTimeout(timer);}}
async function assets(seed){
  const {build}=await import('esbuild'),{compile}=await import('@tailwindcss/node'),{default:ts}=await import('typescript');
  const bundle=await build({absWorkingDir:root,entryPoints:['scripts/fixtures/attendance-correction-delegation-browser-entry.tsx'],bundle:true,write:false,metafile:true,platform:'browser',format:'esm',target:['es2020'],jsx:'automatic',tsconfig:path.join(root,'tsconfig.json'),outfile:'qa.js',logLevel:'warning',
    define:{'process.env':JSON.stringify({NEXT_PUBLIC_FAOLLA_ATTENDANCE_CORRECTION_DELEGATION_ENABLED:'1'}),'process.env.NODE_ENV':'"development"',__CORRECTION_BROWSER_SEED__:JSON.stringify(seed)}});
  const candidates=new Set();for(const name of Object.keys(bundle.metafile.inputs)){assert(!/node:crypto|\.server\.ts$/.test(name),'server_import');if(!/\.tsx?$/.test(name)||name.includes('node_modules'))continue;
    const ast=ts.createSourceFile(name,await readFile(path.join(root,name),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);const visit=n=>{if(ts.isStringLiteral(n)||ts.isNoSubstitutionTemplateLiteral(n)||ts.isTemplateHead(n)||ts.isTemplateMiddle(n)||ts.isTemplateTail(n))n.text.split(/\s+/).filter(Boolean).forEach(v=>candidates.add(v));ts.forEachChild(n,visit);};visit(ast);}
  const css=(await compile('@import "tailwindcss";',{base:root,onDependency:()=>{}})).build([...candidates])+bundle.outputFiles.filter(f=>f.path.endsWith('.css')).map(f=>f.text).join('\n')+'body{margin:0;background:#f8fafc;font-family:Arial,sans-serif}.qa-main{max-width:1200px;margin:auto;min-width:0}';
  return{js:bundle.outputFiles.find(f=>f.path.endsWith('.js')).contents,css};
}
export async function verifyCorrectionDelegationBrowser(){
  const started=Date.now(),deadline=started+correctionBrowserLimits.ttlMs,model=createCorrectionBrowserModel(),requests=[],errors=[],inflight=new Set();let totalHttp=0,server,browser,context,page,files,origin,closing=false,stage='setup',failure,report,accept=true;
  const timer=setTimeout(()=>{closing=true;void context?.close().catch(()=>{});server?.closeAllConnections();},correctionBrowserLimits.ttlMs);
  const settle=async()=>{await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));await bounded(Promise.allSettled([...inflight]));};
  const click=async(locator,mode,method='GET',endpoint=api)=>{const [r]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname===endpoint&&r.request().method()===method&&(!mode||new URL(r.url()).searchParams.get('mode')===mode)),locator.click()]);await r.finished();assert.equal(r.status(),200,await r.text());await settle();return r;};
  const button=name=>page.getByRole('button',{name,exact:true});
  const identity=async value=>{const r=page.waitForResponse(r=>new URL(r.url()).pathname===overview);await page.evaluate(v=>window.__correctionHarness.identity(v),value);await(await r).finished();await settle();};
  const enterDelegate=async()=>{await button('受托首次补正审批').click();await button('读取我的补正委托').waitFor();await click(button('读取我的补正委托'),'grants');await click(button('读取此委托待审补正'),'list');await click(button('读取受托补正详情').first(),'detail');};
  try{
    files=await bounded(assets(model.seed),45000);server=createServer((req,res)=>{const work=(async()=>{assert(!closing&&Date.now()<deadline);assert(++totalHttp<=correctionBrowserLimits.http);assert.equal(req.headers.host,new URL(origin).host);const u=new URL(req.url,origin);
      res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
      if(statics.has(u.pathname)){assert.equal(req.method,'GET');assert.equal(u.search,'');if(u.pathname==='/favicon.ico')return res.writeHead(204).end();const html='<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="/favicon.ico"><link rel="stylesheet" href="/qa.css"><div id="qa-root"></div><script type="module" src="/qa.js"></script></html>';
        return res.writeHead(200,{'Content-Type':u.pathname==='/'?'text/html;charset=utf-8':u.pathname==='/qa.js'?'text/javascript;charset=utf-8':'text/css;charset=utf-8'}).end(u.pathname==='/'?html:u.pathname==='/qa.js'?files.js:files.css);}
      assert(paths.has(u.pathname));assert(requests.length<correctionBrowserLimits.api);let text='',bytes=0;for await(const chunk of req){bytes+=chunk.length;assert(bytes<=8192);text+=chunk.toString('utf8');}
      const value=await model.respond(u.href,req.method,text,req.headers['x-merchant-access-token']);requests.push({method:req.method,path:u.pathname,identity:value.identity,mode:value.query?.mode,operationId:value.command?('decision' in value.command?value.command.decision.operationId:value.command.operationId):value.query?.operationId});res.writeHead(200,{'Content-Type':'application/json;charset=utf-8'}).end(value.text);
    })();inflight.add(work);void work.catch(e=>{errors.push(e.message);if(!res.headersSent)res.writeHead(500,{'Content-Type':'application/json'});res.end('{"ok":false,"error":"attendance_unavailable"}');}).finally(()=>inflight.delete(work));});
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const address=server.address();assert(address&&typeof address==='object'&&address.address==='127.0.0.1');origin=`http://127.0.0.1:${address.port}`;
    const {chromium}=await import('playwright');const launch=chromium.launch({headless:true});void launch.then(b=>{if(closing)return b.close();}).catch(()=>{});browser=await bounded(launch,15000);context=await browser.newContext({serviceWorkers:'block',acceptDownloads:false,viewport:{width:390,height:900}});
    await context.route('**/*',async route=>{const r=route.request(),u=new URL(r.url());if(u.origin!==origin||!(statics.has(u.pathname)&&r.method()==='GET'&&!u.search||paths.has(u.pathname)&&(r.method()==='GET'||r.method()==='POST'&&u.pathname===api))){errors.push('external_or_unknown_request');return route.abort();}await route.continue();});
    page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('download',()=>errors.push('download'));page.on('popup',()=>errors.push('popup'));page.on('dialog',d=>void(accept?d.accept():d.dismiss()).catch(e=>{if(!closing)errors.push(e.message);}));
    stage='owner_admin_catalogs';await page.goto(origin);await page.getByRole('navigation',{name:'企业管理功能',exact:true}).waitFor();await settle();await click(page.getByRole('navigation',{name:'企业管理功能',exact:true}).getByRole('button',{name:'考勤配置',exact:true}),null,'GET',admin);
    const before=requests.length;await button('首次补正审批委托管理').click();await button('读取补正委托列表').waitFor();await settle();assert.equal(requests.length,before);await click(button('读取补正委托列表'),'list');
    for(const name of ['受托审批员工','目标考勤员工','原始班次保存地点']){await click(button('选择'+name),'catalog');await button('选用此'+name).click();await settle();}
    assert.equal(await page.getByLabel('包含已有待审补正',{exact:true}).isChecked(),false);
    await page.getByLabel('补正委托开始时间（UTC）',{exact:true}).fill('2026-10-01T00:00');await page.getByLabel('补正委托结束时间（UTC）',{exact:true}).fill('2026-11-01T00:00');await page.getByLabel('补正委托授权理由',{exact:true}).fill('Synthetic238 explicit catalog grant');await page.getByLabel('确认首次补正委托',{exact:true}).check();
    stage='owner_dirty_guard';accept=false;await button('关闭补正委托').click();await button('明确授予首次补正委托').waitFor();assert.equal(model.writes.length,0);accept=true;await click(button('明确授予首次补正委托'),null,'POST');await page.getByRole('region',{name:'补正委托最小回执',exact:true}).waitFor();assert.equal(model.writes.length,1);await button('关闭补正委托').click();
    stage='delegate_no_self_worker';await identity('delegate');assert(!model.actor('delegate').permissions.includes('attendance.self.view'));assert.equal(await button('我的考勤').count(),0);await enterDelegate();
    const detail=page.locator('[data-correction-delegation-detail]');await detail.waitFor();assert((await detail.innerText()).includes('原始完整记录'));assert((await detail.innerText()).includes('员工申请调整'));assert((await detail.innerText()).includes('无薪'));assert((await detail.innerText()).includes('带薪'));
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'mobile_document_overflow');assert.equal(await detail.evaluate(e=>e.scrollWidth>e.clientWidth),false,'mobile_detail_overflow');
    await page.getByLabel('受托补正审核理由',{exact:true}).fill('Synthetic238 approve original request');await page.getByLabel('确认受托补正审核',{exact:true}).check();accept=false;await button('明确批准受托补正').click();assert.equal(model.writes.length,1);accept=true;
    stage='lost_reply_original_get';await click(button('明确批准受托补正'),null,'POST');await button('核对原补正委托编号').waitFor();assert.equal(model.writes.length,2);
    const pending=await page.evaluate(()=>{const keys=Object.keys(sessionStorage).filter(k=>k.startsWith('faolla:attendance:correction-delegation:v1:'));if(keys.length!==1)throw Error('one_pending_required');return{key:keys[0],raw:sessionStorage.getItem(keys[0])};});
    assert.deepEqual(JSON.parse(pending.raw).command,model.writes[1].command);assert.equal(JSON.parse(pending.raw).commandFingerprint,model.writes[1].receipt.commandFingerprint);await click(button('核对原补正委托编号'),'recover');assert.equal(await page.evaluate(k=>sessionStorage.getItem(k),pending.key),null);assert.equal(model.writes.length,2);
    stage='fresh_second_request_reject';await click(button('读取我的补正委托'),'grants');await click(button('读取此委托待审补正'),'list');await click(button('读取受托补正详情'),'detail');await page.getByLabel('受托补正审核理由',{exact:true}).fill('Synthetic238 reject second request');await page.getByLabel('确认受托补正审核',{exact:true}).check();await click(button('明确驳回受托补正'),null,'POST');assert.equal(model.writes.length,3);
    stage='hidden_and_changed_auth_late_body';await page.evaluate(()=>window.__correctionHarness.hold());await button('读取我的补正委托').click();await page.waitForFunction(()=>window.__correctionHarness.held());await page.evaluate(()=>window.__correctionHarness.visibility(true));await page.evaluate(()=>window.__correctionHarness.visibility(false));await settle();assert.equal(await detail.count(),0);await identity('other');await page.evaluate(()=>window.__correctionHarness.release());await settle();assert.equal(await button('受托首次补正审批').count(),0);assert.equal(await detail.count(),0);
    assert.deepEqual(errors,[]);assert.equal(requests.filter(r=>r.method==='POST').length,3);assert.deepEqual(model.writes.map(w=>'decision'in w.command?w.command.decision.action:w.command.action),['grant','approve','reject']);
    report={groups:7,actualManager:true,actualOwnerAdmin:true,actualLauncherAndPanel:true,syntheticAuth:true,actualSql:false,wholeNextSite:false,gets:requests.filter(r=>r.method==='GET').length,posts:3,requests:requests.length,totalHttp,
      ownerCatalogSelections:3,includePending:false,employeeSelfView:false,employeeWorkerRequired:false,unknownReply:'truncated JSON after synthetic commit, not TCP outage',originalGetRecovery:true,syntheticWrites:3,mobileWidth:390,horizontalOverflow:false,
      errors:0,externalRequests:0,diskBundle:false,port:new URL(origin).port,elapsedMs:Date.now()-started};
  }catch(e){failure=Error(`correction_browser_failed:${stage}:${e.message}:${JSON.stringify({errors,requests:requests.slice(-6)})}`,{cause:e});throw failure;}
  finally{closing=true;clearTimeout(timer);await runAttendanceCleanupSteps([{name:'held body',run:async()=>{if(page&&!page.isClosed())await page.evaluate(()=>window.__correctionHarness?.release()).catch(()=>{});}},
    {name:'owned context',run:()=>context?bounded(context.close(),6000):undefined},{name:'owned browser',run:()=>browser?bounded(browser.close(),6000):undefined},
    {name:'HTTP work',run:()=>bounded(Promise.allSettled([...inflight]),6000)},{name:'owned listener',run:()=>{server?.closeAllConnections();return server?.listening?bounded(new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve())),6000):undefined;}},
    {name:'esbuild',run:async()=>{(await import('esbuild')).stop();}}]).catch(e=>{if(failure)throw new AggregateError([failure,e],'correction_browser_cleanup_failed');throw e;});
    assert(!browser?.isConnected()&&!server?.listening);if(failure)console.error(JSON.stringify({cleanup:'correction-browser',browserClosed:!browser?.isConnected(),listenerStopped:!server?.listening,port:origin?new URL(origin).port:null,requests:requests.length,totalHttp}));}
  assert(!browser?.isConnected()&&!server?.listening);return{...report,browserClosed:true,listenerStopped:true};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.argv.length===3&&process.argv[2]==='--run-local')console.log(JSON.stringify(await verifyCorrectionDelegationBrowser()));
  else if(process.argv.length===2)console.log('Inert. node --import tsx scripts/fixtures/attendance-correction-delegation-browser.mjs --run-local');
  else throw Error('explicit_run_local_only');
}
