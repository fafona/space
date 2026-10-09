// Inert import. Root alone invokes this callback in its existing owned schema.
// All browser requests intercepted; temporary loopback serves memory assets only.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {build} from 'esbuild';
import {compile} from '@tailwindcss/node';
import ts from 'typescript';
import {chromium} from 'playwright';
import {runAttendanceCleanupSteps} from './attendance-cleanup.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url)),canonical='https://www.faolla.com',pagePath='/enterprise/attendance-terminal/clock';
const endpoint='/api/merchant-enterprise/attendance/terminal-schedule',oldEndpoint='/api/merchant-enterprise/attendance/terminal-clock',deviceEndpoint='/api/merchant-enterprise/attendance/terminal-device';
async function bounded(work){let timer;try{return await Promise.race([work,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('pin_schedule_browser_timeout')),15000);})]);}finally{clearTimeout(timer);}}
async function assets(){
  const base={absWorkingDir:root,entryPoints:['scripts/fixtures/attendance-pin-schedule-browser.tsx'],bundle:true,write:false,metafile:true,
    platform:'browser',format:'esm',target:['es2020'],jsx:'automatic',tsconfig:path.join(root,'tsconfig.json'),outfile:'qa.js',logLevel:'warning'};
  const on=await build({...base,define:{'process.env':'{}','process.env.NODE_ENV':'"development"','process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_PIN_SCHEDULE_ENABLED':'"1"'}});
  const off=await build({...base,define:{'process.env':'{}','process.env.NODE_ENV':'"development"'}});
  for(const result of [on,off])for(const name of Object.keys(result.metafile.inputs))assert(!/node:crypto|\.server\.ts$/.test(name),'server_module_in_browser_bundle');
  const candidates=new Set();
  for(const name of Object.keys(on.metafile.inputs).filter(f=>/\.tsx?$/.test(f)&&!f.includes('node_modules'))){
    const ast=ts.createSourceFile(name,await readFile(path.join(root,name),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
    const visit=node=>{if(ts.isStringLiteral(node)||ts.isNoSubstitutionTemplateLiteral(node)||ts.isTemplateHead(node)||ts.isTemplateMiddle(node)||ts.isTemplateTail(node))node.text.split(/\s+/).filter(Boolean).forEach(v=>candidates.add(v));ts.forEachChild(node,visit);};visit(ast);
  }
  const css=(await compile('@import "tailwindcss";',{base:root,onDependency:()=>{}})).build([...candidates])+'body{margin:0;background:#f1f5f9;font-family:Arial,sans-serif}.qa-toolbar{padding:12px;background:#fff7ed;font-size:13px;overflow-wrap:anywhere}';
  return {on:on.outputFiles.find(f=>f.path.endsWith('.js')).contents,off:off.outputFiles.find(f=>f.path.endsWith('.js')).contents,css};
}
export async function checkAttendancePinScheduleBrowser(native,scope,d){
  assert(scope&&scope.schema===d.owned.schema);const files=await assets(),before=d.counts(),definitions=d.definitions();
  const mutable=['merchant_attendance_events','merchant_attendance_pin_clock_receipts','merchant_attendance_shift_schedule_relations','merchant_attendance_shift_plan_adoptions',...d.authTables];
  const protectedTables=d.inventory().filter(t=>!mutable.includes(t)),fingerprint=d.fingerprint(protectedTables);
  const suffix=`${d.site}:${d.terminal}:${encodeURIComponent(d.workerNo.toLowerCase())}`,pendingKey=`faolla:attendance:pin-schedule:v1:${suffix}`,oldKey=`faolla:attendance:pin-clock:v1:${suffix}`;
  const requests=[],errors=[],inflight=new Set();let browser,origin,closing=false,feature=true,bundleOff=false,dropNext=null,checks=0;
  const server=createServer((request,response)=>{
    if(!origin||request.headers.host!==new URL(origin).host||request.method!=='GET')return response.writeHead(403).end();
    response.setHeader('Cache-Control','no-store');response.setHeader('X-Content-Type-Options','nosniff');response.setHeader('Referrer-Policy','no-referrer');
    response.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'");
    if(request.url==='/')return response.writeHead(200,{'Content-Type':'text/html;charset=utf-8'}).end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>隔离 PIN 选班验收</title><link rel="stylesheet" href="/qa.css"><div id="qa-root"></div><script type="module" src="/qa.js"></script></html>');
    if(request.url==='/qa.js')return response.writeHead(200,{'Content-Type':'text/javascript;charset=utf-8'}).end(bundleOff?files.off:files.on);
    if(request.url==='/qa.css')return response.writeHead(200,{'Content-Type':'text/css;charset=utf-8'}).end(files.css);return response.writeHead(403).end();
  });
  const child=page=>page.getByRole('region',{name:'本次排班与 PIN 上班',exact:true});
  const choice=page=>child(page).getByLabel('本次 PIN 排班',{exact:true});
  const writes=()=>requests.filter(r=>r.command),newWrites=()=>writes().filter(r=>r.path===endpoint);
  const saved=page=>page.evaluate(k=>{const raw=sessionStorage.getItem(k);return raw===null?null:JSON.parse(raw);},pendingKey);
  const quiet=async page=>{await page.waitForLoadState('networkidle');await bounded(Promise.all([...inflight]));};
  const ready=async page=>{await page.getByRole('status').filter({hasText:'终端已配对'}).waitFor();};
  const read=async(page,expected=endpoint)=>{
    await page.getByLabel('考勤工号',{exact:true}).fill(d.workerNo);await page.getByLabel('员工 PIN',{exact:true}).fill(d.pin);
    const [response]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname===expected&&r.request().method()==='POST'&&r.request().postDataJSON()?.command===null),page.getByRole('button',{name:'验证并读取／核对原操作',exact:true}).click()]);
    assert.equal(await response.finished(),null);assert.equal(response.status(),200);await page.getByRole('status').filter({hasText:/已验证本人|原编号尚未查到|已核对原编号|原打卡已确认/}).waitFor();
    assert.equal(await page.getByLabel('考勤工号',{exact:true}).inputValue(),'');assert.equal(await page.getByLabel('员工 PIN',{exact:true}).inputValue(),'');return response.json();
  };
  const finish=async page=>{
    await read(page);const button=child(page).getByRole('button',{name:'确认下班',exact:true});
    const [response]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname===oldEndpoint&&r.request().method()==='POST'&&r.request().postDataJSON()?.command?.action==='clock_out'),button.click()]);
    assert.equal(await response.finished(),null);assert.equal(response.status(),200);const body=await response.json();assert.equal(body.state.status,'off');assert.equal(body.receipt.action,'clock_out');
    await child(page).getByRole('status').filter({hasText:'原号打卡收据已确认'}).waitFor();assert.equal((await d.oldRead()).state.status,'off');
  };
  try{
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const address=server.address();assert(address&&typeof address==='object');origin=`http://127.0.0.1:${address.port}`;
    browser=await chromium.launch({headless:true});
    const run=async(name,check,{off=false,width=1280}={})=>{
      // Independent synthetic scenarios only; retain real PIN/KDF/lease checks.
      // This is not a rate-limit acceptance test and never resets a live lease.
      assert.equal(d.authState().consumed,true);d.resetAuthBudget();feature=true;bundleOff=off;dropNext=null;
      const context=await browser.newContext({serviceWorkers:'block',acceptDownloads:false,viewport:{width,height:1000}});
      try{
        await context.addInitScript(({keys,pin})=>{
          const probe={unexpectedStorage:[],csp:[]};Object.defineProperty(window,'__pinScheduleProbe',{value:probe});
          for(const method of ['setItem','removeItem','clear']){const original=Storage.prototype[method];Storage.prototype[method]=function(...args){
            if(this!==sessionStorage||method==='clear'||!keys.includes(args[0])||method==='setItem'&&(String(args[1]).includes(pin)||/"pin"|"lease"|"verifier"|"secret"/.test(String(args[1]))))probe.unexpectedStorage.push(method+':'+String(args[0]));
            return original.apply(this,args);};}
          document.addEventListener('securitypolicyviolation',e=>probe.csp.push(e.violatedDirective));
        },{keys:[pendingKey,oldKey],pin:d.pin});
        await context.route('**/*',route=>{
          if(closing)return route.abort().catch(()=>{});
          const work=(async()=>{
            const req=route.request(),url=new URL(req.url());assert.equal(url.origin,canonical,'external_origin');assert.equal(url.search,'','credentials_or_identity_in_URL');
            if([pagePath,'/qa.js','/qa.css'].includes(url.pathname)){
              assert.equal(req.method(),'GET');const local=await fetch(origin+(url.pathname===pagePath?'/':url.pathname));
              return route.fulfill({status:local.status,headers:Object.fromEntries(local.headers),body:Buffer.from(await local.arrayBuffer())});
            }
            assert([endpoint,oldEndpoint,deviceEndpoint].includes(url.pathname));assert.equal(req.method(),url.pathname===deviceEndpoint?'GET':'POST');assert(requests.length<65,'request_budget');
            const body=req.method()==='POST'?req.postDataJSON():null;
            // Never retain/log the PIN body or terminal cookie in test records.
            const record={path:url.pathname,method:req.method(),command:body?.command??null,operationId:body?.operationId??null,selection:body?.selection??null};requests.push(record);
            const drop=url.pathname===endpoint&&body?.command?dropNext:null;if(drop)dropNext=null;
            if(drop==='before'){record.status='undelivered';return route.abort('failed');}
            const handler=url.pathname===endpoint?d.handleNew:url.pathname===oldEndpoint?d.handleOld:d.handleDevice;
            const response=await handler(new Request(canonical+url.pathname,{method:req.method(),headers:{host:'www.faolla.com',origin:canonical,'sec-fetch-site':'same-origin',cookie:d.cookie,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})}),url.pathname===endpoint?{featureEnabled:()=>feature}:{});
            record.status=response.status;const text=await response.text();assert(!text.includes(d.pin),'PIN_in_response');assert.equal(response.headers.get('cache-control'),'private, no-store');
            if(response.status!==200)record.error=JSON.parse(text).error;
            if(drop==='after'){assert.equal(response.status,200);return route.abort('failed');}
            await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:text});
          })();inflight.add(work);void work.finally(()=>inflight.delete(work)).catch(()=>{});
          return work.catch(async error=>{if(!closing)errors.push(error instanceof Error?error.message:'route_error');await route.abort().catch(()=>{});});
        });
        const page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));page.on('download',()=>errors.push('download'));page.on('popup',()=>errors.push('popup'));
        page.on('dialog',dialog=>{errors.push('dialog');void dialog.dismiss().catch(()=>{});});
        await page.goto(canonical+pagePath);await ready(page);
        try{await check(page);}catch(error){error.message=`${name}: ${error.message}; recent=${JSON.stringify(requests.slice(-5))}`;throw error;}
        await quiet(page);assert.deepEqual(await page.evaluate(()=>window.__pinScheduleProbe),{unexpectedStorage:[],csp:[]});assert.equal(await page.evaluate(()=>localStorage.length),0);
        assert.equal(d.fingerprint(protectedTables),fingerprint);assert.equal(d.definitions(),definitions);assert.equal(d.authState().consumed,true);checks++;native.pass(name);
      }finally{await context.close();}
    };
    await run('PIN default-off actual parent reads only device until explicit PIN, then original state',async page=>{
      await quiet(page);assert.equal(await child(page).count(),0);assert.equal(requests.filter(r=>r.path!==deviceEndpoint).length,0);
      await read(page,oldEndpoint);assert.equal(await child(page).count(),0);assert.equal(requests.filter(r=>r.path===endpoint).length,0);assert.equal(writes().length,0);
    },{off:true});
    await run('390px PIN-authenticated choices require explicit selection and commit actual association/adoption',async page=>{
      const mark=requests.length;await read(page);assert.equal(requests.slice(mark).filter(r=>r.path===endpoint).length,1);assert.equal(await choice(page).inputValue(),'');
      assert.equal(await child(page).getByRole('button',{name:'PIN 上班 · 请先明确选择',exact:true}).isDisabled(),true);await choice(page).selectOption(d.slots.browser.id);
      await child(page).getByRole('button',{name:'PIN 上班 · 已选排班',exact:true}).click();await child(page).locator('[data-pin-schedule-association="linked"]').waitFor();await child(page).locator('[data-pin-schedule-adoption="adopted"]').waitFor();
      assert.deepEqual(newWrites().at(-1).selection,{slotId:d.slots.browser.id,revision:d.slots.browser.revision});assert.equal(await saved(page),null);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.equal(await child(page).evaluate(el=>el.scrollWidth<=el.clientWidth+1),true);assert.equal(await page.locator('img').count(),0);
      await finish(page);
    },{width:390});
    await run('lost committed PIN selection reload needs fresh PIN read and never automatically rewrites',async page=>{
      await read(page);await choice(page).selectOption(d.slots.browser.id);const events=d.counts().events,count=writes().length;dropNext='after';
      await child(page).getByRole('button',{name:'PIN 上班 · 已选排班',exact:true}).click();await child(page).getByRole('status').filter({hasText:'原编号和原选择保留'}).waitFor();
      const original=await saved(page);assert(original);assert.equal(d.counts().events,events+1);const mark=requests.length;await page.reload();await ready(page);await quiet(page);
      assert.equal(await child(page).count(),0);assert.equal(requests.slice(mark).filter(r=>r.path!==deviceEndpoint).length,0);await read(page);
      await child(page).locator('[data-pin-schedule-association="linked"]').waitFor();assert.equal(await saved(page),null);assert.equal(writes().length,count+1);
      assert(requests.slice(mark).some(r=>r.path===endpoint&&r.operationId===original.command.operationId));await finish(page);
    });
    await run('feature rollback preserves undelivered PIN selection; only fresh PIN read and explicit original retry',async page=>{
      await read(page);await choice(page).selectOption('none');const events=d.counts().events;dropNext='before';
      await child(page).getByRole('button',{name:'PIN 上班 · 不关联排班',exact:true}).click();await child(page).getByRole('status').filter({hasText:'原编号和原选择保留'}).waitFor();const original=await saved(page);assert(original);
      assert.equal(d.counts().events,events);feature=false;bundleOff=true;const count=writes().length;await page.reload();await ready(page);await read(page);
      assert.deepEqual(await saved(page),original);assert.equal(await child(page).getByRole('button',{name:'PIN 核对后原编号重试',exact:true}).isDisabled(),true);assert.equal(writes().length,count);assert.equal(await page.getByRole('button',{name:'确认上班',exact:true}).count(),0);
      feature=true;bundleOff=false;await page.reload();await ready(page);await read(page);await child(page).getByRole('button',{name:'PIN 核对后原编号重试',exact:true}).click();
      await child(page).locator('[data-pin-schedule-association="unselected"]').waitFor();assert.deepEqual(newWrites().at(-1).command,original.command);assert.equal(newWrites().at(-1).selection,null);assert.equal(await saved(page),null);
      await finish(page);
    });
    assert.equal(checks,4);assert.deepEqual(errors,[]);assert.equal(writes().filter(r=>r.path===oldEndpoint&&r.command.action==='clock_in').length,0);
    const final=d.counts();assert.deepEqual(final,{...before,events:before.events+6,receipts:before.receipts+6,relations:before.relations+3,adoptions:before.adoptions+3});
    assert.equal(d.fingerprint(protectedTables),fingerprint);assert.equal(d.definitions(),definitions);
    return {checks,apiRequests:requests.length,pinAuthenticatedReads:requests.filter(r=>r.method==='POST'&&!r.command).length,newWriteAttempts:newWrites().length,
      actualClockIns:3,oldClockOuts:3,eventsAdded:6,relationsAdded:3,adoptionsAdded:3,actualParentHandlerKdfSql:true,syntheticDeviceCookie:true,productionAccess:false,
      externalRequests:0,otherStorageWrites:0,pinPersisted:false,leasePersisted:false,explicitRecovery:true,flagRollback:true,serverModulesBundled:false,newCluster:false,
      independentSyntheticAuthBudgetReset:true,rateLimitCoverage:false,before,final};
  }finally{
    closing=true;await runAttendanceCleanupSteps([
      {name:'pin-schedule-browser',run:async()=>{await browser?.close();}},
      {name:'pin-schedule-interceptions',run:async()=>{await bounded(Promise.allSettled([...inflight]));}},
      {name:'pin-schedule-loopback',run:async()=>{if(server.listening){server.closeAllConnections();await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}}},
    ]);
  }
}
