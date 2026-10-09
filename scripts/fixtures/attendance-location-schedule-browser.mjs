// Import inert. Root owns the one reused PG namespace and calls this callback;
// no new cluster, output bundles, production auth or real-device claim.
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

const root=fileURLToPath(new URL('../../',import.meta.url)),canonical='https://www.faolla.com';
const endpoint='/api/merchant-enterprise/attendance/location-schedule',oldEndpoint='/api/merchant-enterprise/attendance/location-clock';
async function bounded(work){let timer;try{return await Promise.race([work,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('location_schedule_browser_timeout')),15000);})]);}finally{clearTimeout(timer);}}
async function assets(){
  const base={absWorkingDir:root,entryPoints:['scripts/fixtures/attendance-location-schedule-browser.tsx'],bundle:true,write:false,metafile:true,
    platform:'browser',format:'esm',target:['es2020'],jsx:'automatic',tsconfig:path.join(root,'tsconfig.json'),outfile:'qa.js',logLevel:'warning'};
  const on=await build({...base,define:{'process.env':'{}','process.env.NODE_ENV':'"development"','process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_LOCATION_SCHEDULE_ENABLED':'"1"'}});
  const off=await build({...base,define:{'process.env':'{}','process.env.NODE_ENV':'"development"'}});
  const candidates=new Set();
  for(const b of [on,off])for(const name of Object.keys(b.metafile.inputs))assert(!/node:crypto|\.server\.ts$/.test(name),'browser_contains_server');
  for(const filename of Object.keys(on.metafile.inputs).filter(name=>/\.tsx?$/.test(name)&&!name.includes('node_modules'))){
    const ast=ts.createSourceFile(filename,await readFile(path.join(root,filename),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
    const visit=node=>{if(ts.isStringLiteral(node)||ts.isNoSubstitutionTemplateLiteral(node)||ts.isTemplateHead(node)||ts.isTemplateMiddle(node)||ts.isTemplateTail(node))node.text.split(/\s+/).filter(Boolean).forEach(v=>candidates.add(v));ts.forEachChild(node,visit);};visit(ast);
  }
  const css=(await compile('@import "tailwindcss";',{base:root,onDependency:()=>{}})).build([...candidates])
    +'body{margin:0;background:#f1f5f9;font-family:Arial,sans-serif}.qa-toolbar{padding:12px;background:#fff7ed;font-size:13px;overflow-wrap:anywhere}.qa-main{max-width:1000px;margin:auto;padding:12px;min-width:0}';
  return {on:on.outputFiles.find(f=>f.path.endsWith('.js')).contents,off:off.outputFiles.find(f=>f.path.endsWith('.js')).contents,css};
}
export async function checkAttendanceLocationScheduleBrowser(native,scope,d){
  assert(scope&&scope.schema===d.owned.schema);
  const files=await assets(),before=d.counts(),definitions=d.definitions();
  const mutable=['merchant_attendance_events','merchant_attendance_shift_schedule_relations','merchant_attendance_shift_plan_adoptions','merchant_attendance_location_results','merchant_attendance_location_clock_notices'];
  const protectedTables=d.inventory().filter(t=>!mutable.includes(t)),fingerprint=d.fingerprint(protectedTables);
  const pendingKey=`faolla:attendance:location-schedule:v1:${d.site}:${d.employee}`,oldKey=`faolla:attendance:location-clock:v1:${d.site}:${d.employee}`;
  const requests=[],errors=[],inflight=new Set();let browser,origin,closing=false,feature=true,dropNext=null,checks=0;
  const server=createServer((request,response)=>{
    if(!origin||request.headers.host!==new URL(origin).host||request.method!=='GET')return response.writeHead(403).end();
    response.setHeader('Cache-Control','no-store');response.setHeader('X-Content-Type-Options','nosniff');
    response.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'");
    const url=new URL(request.url??'/',origin);if(url.search)return response.writeHead(403).end();
    if(url.pathname==='/'||url.pathname==='/off')return response.writeHead(200,{'Content-Type':'text/html;charset=utf-8'}).end(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>隔离定位选班验收</title><link rel="stylesheet" href="/qa.css"><div id="qa-root"></div><script type="module" src="/${url.pathname==='/off'?'qa-off':'qa'}.js"></script></html>`);
    if(url.pathname==='/qa.js'||url.pathname==='/qa-off.js')return response.writeHead(200,{'Content-Type':'text/javascript;charset=utf-8'}).end(url.pathname==='/qa.js'?files.on:files.off);
    if(url.pathname==='/qa.css')return response.writeHead(200,{'Content-Type':'text/css;charset=utf-8'}).end(files.css);return response.writeHead(403).end();
  });
  const parent=page=>page.getByRole('region',{name:'定位打卡隔离原型',exact:true});
  const child=page=>page.getByRole('region',{name:'本次排班与定位上班',exact:true});
  const choice=page=>child(page).getByLabel('本次定位排班',{exact:true});
  const posts=()=>requests.filter(r=>r.method==='POST'),newPosts=()=>posts().filter(r=>r.path===endpoint);
  const quiet=async page=>{await page.waitForLoadState('networkidle');await bounded(Promise.all([...inflight]));};
  const read=async page=>{const button=child(page).getByRole('button',{name:'核对定位选班与原号',exact:true});await button.waitFor();
    const [response]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname===endpoint&&r.request().method()==='GET'),button.click()]);
    assert.equal(await response.finished(),null);assert.equal(response.status(),200);
    await child(page).getByRole('status').filter({hasText:/已核对本人状态与排班|定位上班收据已核验|未查到原号收据/}).waitFor();
  };
  const choose=async(page,value)=>{await read(page);await choice(page).selectOption(value);};
  const receipt=(page,status)=>child(page).locator(`[data-location-schedule-association="${status}"]`);
  const saved=page=>page.evaluate(key=>{const value=sessionStorage.getItem(key);return value===null?null:JSON.parse(value);},pendingKey);
  const end=async page=>{const button=parent(page).getByRole('button',{name:'定位并登记下班',exact:true});await button.waitFor();const requestStart=requests.length;
    // Register before click. A fulfilled preflight GET does not mean its later
    // GPS -> POST chain completed; networkidle is not an operation receipt.
    const [response]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname===oldEndpoint&&r.request().method()==='POST'
      &&r.request().postDataJSON()?.action==='clock_out'),button.click()]);
    assert.equal(await response.finished(),null);assert.equal(response.status(),200);
    const body=await response.json();assert.equal(body.state.status,'off');assert.equal(body.receipt.action,'clock_out');
    await parent(page).locator(':scope > dl').getByText('下班',{exact:true}).waitFor();
    const actual=(await d.oldRead()).state.status;
    if(actual!=='off'){
      // Failure diagnostics deliberately omit positions, assertions and source
      // bodies. They distinguish a synchronous UI guard from GET/GPS/POST failure.
      const ui=await parent(page).evaluate((element,keys)=>({
        statuses:[...element.querySelectorAll('[role="status"]')].map(node=>node.textContent?.trim().slice(0,600)),
        buttons:[...element.querySelectorAll('button')].map(node=>({label:node.textContent?.trim(),disabled:node.disabled})),
        pending:keys.map(key=>{const raw=sessionStorage.getItem(key);if(raw===null)return {key,present:false};
          try{const parsed=JSON.parse(raw);return {key,present:true,operationId:parsed.intent?.operationId??null,action:parsed.intent?.action??null,selection:parsed.selection??null};}
          catch{return {key,present:true,malformed:true};}}),
        gps:window.__locationScheduleProbe.gps,hidden:document.hidden,
      }),[pendingKey,oldKey]);
      const recent=requests.slice(-6).map(r=>({path:r.path,method:r.method,status:r.status,error:r.response?.error??null,action:r.body?.command?.action??r.body?.action??null}));
      throw Error(`location_schedule_old_clock_out_incomplete ${JSON.stringify({actual,requestsAfterClick:requests.length-requestStart,recent,ui})}`);
    }
  };
  try{
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const address=server.address();assert(address&&typeof address==='object');origin=`http://127.0.0.1:${address.port}`;
    browser=await chromium.launch({headless:true});
    const run=async(name,check,{width=1280,off=false}={})=>{
      feature=true;dropNext=null;const context=await browser.newContext({serviceWorkers:'block',acceptDownloads:false,viewport:{width,height:1050}});
      try{
        await context.addInitScript(({seed,keys})=>{
          Object.defineProperty(window,'__locationScheduleSeed',{value:seed});
          if(sessionStorage.getItem('qa-unrelated')===null)sessionStorage.setItem('qa-unrelated','preserve');
          if(localStorage.getItem('qa-unrelated')===null)localStorage.setItem('qa-unrelated','preserve');
          const probe={gps:0,csp:[],unexpectedStorage:[]};Object.defineProperty(window,'__locationScheduleProbe',{value:probe});
          for(const method of ['setItem','removeItem','clear']){const original=Storage.prototype[method];Storage.prototype[method]=function(...args){
            if(this!==sessionStorage||method==='clear'||!keys.includes(args[0])||method==='setItem'&&/latitude|longitude|accuracyMeters|capturedAt|"position"/.test(String(args[1])))probe.unexpectedStorage.push(method+':'+String(args[0]));
            return original.apply(this,args);};}
          document.addEventListener('securitypolicyviolation',event=>probe.csp.push(event.violatedDirective));
        },{seed:{siteId:d.site,employeeId:d.employee,workerId:d.worker},keys:[pendingKey,oldKey]});
        await context.route('**/*',route=>{
          if(closing)return route.abort().catch(()=>{});
          const work=(async()=>{
            const req=route.request(),url=new URL(req.url());assert.equal(url.origin,origin,'external_request');
            if(['/','/off','/qa.js','/qa-off.js','/qa.css'].includes(url.pathname)){assert.equal(req.method(),'GET');return route.continue();}
            assert([endpoint,oldEndpoint].includes(url.pathname));assert(['GET','POST'].includes(req.method()));assert(requests.length<80,'request_budget');
            const body=req.method()==='POST'?JSON.parse(req.postData()??'null'):null;
            const record={path:url.pathname,method:req.method(),query:Object.fromEntries(url.searchParams),body,status:null};requests.push(record);
            const drop=url.pathname===endpoint&&req.method()==='POST'?dropNext:null;if(drop)dropNext=null;
            if(drop==='before'){record.status='undelivered';return route.abort('failed');}
            const response=await (url.pathname===endpoint?d.handleNew:d.handleOld)(new Request(canonical+url.pathname+url.search,{method:req.method(),
              headers:{host:'www.faolla.com',origin:canonical,'sec-fetch-site':'same-origin',...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})}),
              url.pathname===endpoint?{featureEnabled:()=>feature}:{});
            record.status=response.status;const text=await response.text();record.response=JSON.parse(text);assert.equal(response.headers.get('cache-control'),'private, no-store');
            if(drop==='after'){assert.equal(response.status,200);return route.abort('failed');}
            await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:text});
          })();inflight.add(work);void work.finally(()=>inflight.delete(work)).catch(()=>{});
          return work.catch(async error=>{if(!closing)errors.push(error instanceof Error?error.message:'route_error');await route.abort().catch(()=>{});});
        });
        const page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',error=>errors.push(error.message));page.on('download',()=>errors.push('download'));page.on('popup',()=>errors.push('popup'));
        page.on('dialog',dialog=>{if(dialog.type()==='beforeunload')void dialog.accept().catch(()=>{});else{errors.push('dialog');void dialog.dismiss().catch(()=>{});}});
        await page.goto(origin+(off?'/off':''));await parent(page).waitFor();
        await parent(page).locator(':scope > [role="status"]').filter({hasText:'状态已同步'}).waitFor();await quiet(page);
        try{await check(page);}catch(error){error.message=`${name}: ${error.message}`;throw error;}
        await quiet(page);const probe=await page.evaluate(()=>window.__locationScheduleProbe);assert.deepEqual(probe.csp,[]);assert.deepEqual(probe.unexpectedStorage,[]);
        assert.deepEqual(await page.evaluate(()=>[sessionStorage.getItem('qa-unrelated'),localStorage.getItem('qa-unrelated')]),['preserve','preserve']);
        assert.equal(d.fingerprint(protectedTables),fingerprint);assert.equal(d.definitions(),definitions);checks++;native.pass(name);
      }finally{await context.close();}
    };
    await run('location schedule default-off preserves old panel with zero new HTTP and zero GPS',async page=>{
      assert.equal(await child(page).count(),0);assert.equal(requests.filter(r=>r.path===endpoint).length,0);assert.equal(posts().length,0);
      assert.equal(await page.evaluate(()=>window.__locationScheduleProbe.gps),0);assert.equal(await parent(page).getByRole('button',{name:'定位并登记上班',exact:true}).isEnabled(),true);
    },{off:true});
    await run('390px actual parent explicit none and chosen slot save relation and approved reference',async page=>{
      const count=requests.length;assert.equal(requests.filter(r=>r.path===endpoint).length,0);await read(page);
      assert.equal(await choice(page).inputValue(),'');assert.equal(await page.evaluate(()=>window.__locationScheduleProbe.gps),0);
      assert.equal(await child(page).getByRole('button',{name:'定位上班 · 请先明确选择',exact:true}).isDisabled(),true);
      await choice(page).selectOption('none');assert.equal(posts().length,0);await child(page).getByRole('button',{name:'定位上班 · 不关联排班',exact:true}).click();await receipt(page,'unselected').waitFor();
      assert.equal(newPosts().at(-1).body.selection,null);assert.equal(newPosts().at(-1).response.adoption.status,'unselected');await end(page);
      await choose(page,d.slots.browser.id);assert.equal(await choice(page).inputValue(),d.slots.browser.id);
      await child(page).getByRole('button',{name:'定位上班 · 已选排班',exact:true}).click();await receipt(page,'linked').waitFor();
      await child(page).locator('[data-location-schedule-adoption="adopted"]').waitFor();assert.deepEqual(newPosts().at(-1).body.selection,{slotId:d.slots.browser.id,revision:d.slots.browser.revision});
      assert.equal(await saved(page),null);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      assert.equal(await child(page).evaluate(el=>el.scrollWidth<=el.clientWidth+1),true);assert.equal(await page.locator('img').count(),0);assert(requests.length>count);await end(page);
    },{width:390});
    await run('committed selected response loss reload discovers pending locally then explicit GET settles without POST',async page=>{
      await choose(page,d.slots.browser.id);dropNext='after';const beforePosts=posts().length,events=d.counts().events;
      await child(page).getByRole('button',{name:'定位上班 · 已选排班',exact:true}).click();await child(page).getByRole('status').filter({hasText:'结果仍待确认'}).waitFor();
      const original=await saved(page);assert(original);assert.equal(d.counts().events,events+1);const mark=requests.length;await page.reload();await quiet(page);
      assert.equal(requests.slice(mark).filter(r=>r.path===endpoint).length,0);assert.equal(await page.evaluate(()=>window.__locationScheduleProbe.gps),0);
      await read(page);await receipt(page,'linked').waitFor();assert.equal(await saved(page),null);assert.equal(posts().length,beforePosts+1);
      assert(requests.slice(mark).some(r=>r.path===endpoint&&r.query.operationId===original.intent.operationId));await end(page);
    });
    await run('flag rollback retains undelivered intent and only GET; restored explicit retry keeps original selection',async page=>{
      await choose(page,d.slots.browser.id);dropNext='before';const events=d.counts().events;
      await child(page).getByRole('button',{name:'定位上班 · 已选排班',exact:true}).click();await child(page).getByRole('status').filter({hasText:'结果仍待确认'}).waitFor();
      const original=await saved(page);assert(original);assert.equal(d.counts().events,events);const beforePosts=posts().length;feature=false;
      await page.goto(origin+'/off');await quiet(page);assert.deepEqual(await saved(page),original);await read(page);assert.deepEqual(await saved(page),original);
      assert.equal(await child(page).getByRole('button',{name:'原编号定位重试',exact:true}).isDisabled(),true);
      assert.equal(await parent(page).getByRole('button',{name:'定位并登记上班',exact:true}).isDisabled(),true);assert.equal(posts().length,beforePosts);
      assert.equal(await page.evaluate(()=>window.__locationScheduleProbe.gps),0);feature=true;await page.goto(origin+'/');await quiet(page);await read(page);
      const mark=requests.length;await child(page).getByRole('button',{name:'原编号定位重试',exact:true}).click();await receipt(page,'linked').waitFor();await quiet(page);
      const retry=requests.slice(mark).filter(r=>r.path===endpoint);assert.equal(retry[0].method,'GET');assert.equal(retry[0].query.operationId,original.intent.operationId);
      const submitted=retry.find(r=>r.method==='POST');assert(submitted);assert.deepEqual(submitted.body.selection,original.selection);
      const {position:_p,positionFailure:_f,...intent}=submitted.body.command;void _p;void _f;assert.deepEqual(intent,original.intent);
      assert.equal(d.counts().events,events+1);assert.equal(await saved(page),null);await end(page);
    });
    assert.equal(checks,4);assert.deepEqual(errors,[]);assert.equal(posts().filter(r=>r.path===oldEndpoint&&r.body.action==='clock_in').length,0);
    const final=d.counts();assert.deepEqual(final,{...before,events:before.events+8,relations:before.relations+4,adoptions:before.adoptions+4,results:before.results+8,notices:before.notices+8});
    assert.equal(d.fingerprint(protectedTables),fingerprint);assert.equal(d.definitions(),definitions);
    return {checks,apiRequests:requests.length,newPostAttempts:newPosts().length,actualClockIns:4,oldClockOuts:4,eventsAdded:8,relationsAdded:4,adoptionsAdded:4,
      actualParentHandlerServiceSql:true,syntheticAuth:true,syntheticGeolocation:true,realDevice:false,externalRequests:0,otherStorageWrites:0,coordinatesPersisted:false,
      explicitRecovery:true,unknownFlagRollback:true,serverModulesBundled:false,newCluster:false,productionAccess:false,before,final};
  }finally{
    closing=true;await runAttendanceCleanupSteps([
      {name:'location-schedule-browser',run:async()=>{await browser?.close();}},
      {name:'location-schedule-interceptions',run:async()=>{await bounded(Promise.allSettled([...inflight]));}},
      {name:'location-schedule-loopback',run:async()=>{if(server.listening){server.closeAllConnections();await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}}},
    ]);
  }
}
