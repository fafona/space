// Inert import; root invokes this callback inside its existing owned namespace.
// Canonical browser requests are all intercepted. Static assets are read from
// this temporary loopback-only in-memory server, never the public network.
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

const root=fileURLToPath(new URL('../../',import.meta.url)),canonical='https://www.faolla.com',scanPath='/enterprise/attendance-scan';
const endpoint='/api/merchant-enterprise/attendance/onsite-schedule',oldEndpoint='/api/merchant-enterprise/attendance/onsite-clock';
async function bounded(work){let timer;try{return await Promise.race([work,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('onsite_schedule_browser_timeout')),15000);})]);}finally{clearTimeout(timer);}}
async function assets(){
  const authPlugin={name:'synthetic-employee-auth-only',setup(b){
    b.onResolve({filter:/merchantEnterpriseSupabase$/},()=>({path:'synthetic-onsite-auth',namespace:'qa-auth'}));
    b.onLoad({filter:/.*/,namespace:'qa-auth'},()=>({loader:'js',contents:`
      const listeners=new Set();let signedOut=false;
      const session=()=>signedOut?null:{access_token:'synthetic-onsite-session',user:{id:window.__onsiteScheduleSeed.auth,email:'synthetic-onsite@example.test'}};
      export const merchantEnterpriseSupabase={auth:{getSession:async()=>({data:{session:session()},error:null})}};
      export const isEnterpriseLogoutBlocked=()=>false;
      export const onEnterpriseAuthStateChange=fn=>{listeners.add(fn);return {data:{subscription:{unsubscribe:()=>listeners.delete(fn)}}};};
      export const signInEnterpriseWithPassword=async()=>{signedOut=false;const s=session();for(const fn of listeners)fn('SIGNED_IN',s);return {data:{session:s},error:null};};
      export const signOutEnterpriseSession=async()=>{signedOut=true;for(const fn of listeners)fn('SIGNED_OUT',null);return {error:null,localCleared:true};};
    `}));
  }};
  const base={absWorkingDir:root,entryPoints:['scripts/fixtures/attendance-onsite-schedule-browser.tsx'],bundle:true,write:false,metafile:true,
    platform:'browser',format:'esm',target:['es2020'],jsx:'automatic',tsconfig:path.join(root,'tsconfig.json'),outfile:'qa.js',logLevel:'warning',plugins:[authPlugin]};
  const on=await build({...base,define:{'process.env':'{}','process.env.NODE_ENV':'"development"','process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_ONSITE_SCHEDULE_ENABLED':'"1"'}});
  const off=await build({...base,define:{'process.env':'{}','process.env.NODE_ENV':'"development"'}});
  for(const b of [on,off])for(const name of Object.keys(b.metafile.inputs))assert(!/node:crypto|\.server\.ts$|src\/lib\/merchantEnterpriseSupabase\.ts/.test(name),'unexpected_server_or_real_auth_bundle');
  const candidates=new Set();
  for(const filename of Object.keys(on.metafile.inputs).filter(name=>/\.tsx?$/.test(name)&&!name.includes('node_modules'))){
    const ast=ts.createSourceFile(filename,await readFile(path.join(root,filename),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
    const visit=node=>{if(ts.isStringLiteral(node)||ts.isNoSubstitutionTemplateLiteral(node)||ts.isTemplateHead(node)||ts.isTemplateMiddle(node)||ts.isTemplateTail(node))node.text.split(/\s+/).filter(Boolean).forEach(v=>candidates.add(v));ts.forEachChild(node,visit);};visit(ast);
  }
  const css=(await compile('@import "tailwindcss";',{base:root,onDependency:()=>{}})).build([...candidates])+'body{margin:0;background:#f1f5f9;font-family:Arial,sans-serif}.qa-toolbar{padding:12px;background:#fff7ed;font-size:13px;overflow-wrap:anywhere}';
  return {on:on.outputFiles.find(f=>f.path.endsWith('.js')).contents,off:off.outputFiles.find(f=>f.path.endsWith('.js')).contents,css};
}
export async function checkAttendanceOnsiteScheduleBrowser(native,scope,d){
  assert(scope&&scope.schema===d.owned.schema);const files=await assets(),before=d.counts(),definitions=d.definitions();
  const mutable=['merchant_attendance_events','merchant_attendance_onsite_receipts','merchant_attendance_shift_schedule_relations','merchant_attendance_shift_plan_adoptions'];
  const protectedTables=d.inventory().filter(t=>!mutable.includes(t)),fingerprint=d.fingerprint(protectedTables);
  const pendingKey=`faolla:attendance:onsite-schedule:v1:${d.site}:${d.auth}`,oldKey=`faolla:attendance:onsite-clock:v1:${d.site}:${d.auth}`;
  const requests=[],errors=[],inflight=new Set();let browser,origin,closing=false,feature=true,bundleOff=false,dropNext=null,checks=0;
  const server=createServer((request,response)=>{
    if(!origin||request.headers.host!==new URL(origin).host||request.method!=='GET')return response.writeHead(403).end();
    response.setHeader('Cache-Control','no-store');response.setHeader('X-Content-Type-Options','nosniff');response.setHeader('Referrer-Policy','no-referrer');
    response.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'");
    if(request.url==='/')return response.writeHead(200,{'Content-Type':'text/html;charset=utf-8'}).end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>隔离现场选班验收</title><link rel="stylesheet" href="/qa.css"><div id="qa-root"></div><script type="module" src="/qa.js"></script></html>');
    if(request.url==='/qa.js')return response.writeHead(200,{'Content-Type':'text/javascript;charset=utf-8'}).end(bundleOff?files.off:files.on);
    if(request.url==='/qa.css')return response.writeHead(200,{'Content-Type':'text/css;charset=utf-8'}).end(files.css);return response.writeHead(403).end();
  });
  const parent=page=>page.getByRole('region',{name:'本人现场打卡确认',exact:true}),child=page=>page.getByRole('region',{name:'本次排班与现场上班',exact:true});
  const choice=page=>child(page).getByLabel('本次现场排班',{exact:true});
  const posts=()=>requests.filter(r=>r.method==='POST'),newPosts=()=>posts().filter(r=>r.path===endpoint);
  const quiet=async page=>{await page.waitForLoadState('networkidle');await bounded(Promise.all([...inflight]));};
  const saved=page=>page.evaluate(k=>{const raw=sessionStorage.getItem(k);return raw===null?null:JSON.parse(raw);},pendingKey);
  const read=async page=>{const button=child(page).getByRole('button',{name:'读取现场选班／原编号',exact:true});
    const [response]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname===endpoint&&r.request().method()==='GET'),button.click()]);
    assert.equal(await response.finished(),null);assert.equal(response.status(),200);
    await child(page).getByRole('status').filter({hasText:/已读取默认地点本人候选|现场上班原号收据已核验|暂未查到原号收据/}).waitFor();
  };
  const scan=async page=>{
    const issued=await d.issue(),link=`${canonical}${scanPath}?siteId=${d.site}#qr=${issued.token}`;
    const input=page.getByLabel('现场码链接',{exact:true});if(!await input.isVisible())await page.getByText('无法使用摄像头？粘贴现场码链接',{exact:true}).click();
    await input.fill(link);await page.getByRole('button',{name:'读取现场码（不打卡）',exact:true}).click();await page.waitForFunction(()=>!location.hash);
    assert.equal(await input.inputValue(),'');return issued.token;
  };
  const finish=async page=>{
    await parent(page).getByText('当前：工作中',{exact:true}).waitFor();await scan(page);
    const button=parent(page).getByRole('button',{name:'确认下班',exact:true});
    const [response]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname===oldEndpoint&&r.request().method()==='POST'&&r.request().postDataJSON()?.command?.action==='clock_out'),button.click()]);
    assert.equal(await response.finished(),null);assert.equal(response.status(),200);const body=await response.json();assert.equal(body.state.status,'off');assert.equal(body.receipt.action,'clock_out');
    await parent(page).getByText('当前：未上班',{exact:true}).waitFor();assert.equal((await d.oldRead()).state.status,'off');
  };
  try{
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const address=server.address();assert(address&&typeof address==='object');origin=`http://127.0.0.1:${address.port}`;
    browser=await chromium.launch({headless:true});
    const run=async(name,check,{off=false,width=1280}={})=>{
      feature=true;bundleOff=off;dropNext=null;const context=await browser.newContext({serviceWorkers:'block',acceptDownloads:false,viewport:{width,height:1000}});
      try{
        await context.addInitScript(({seed,keys})=>{
          Object.defineProperty(window,'__onsiteScheduleSeed',{value:seed});const probe={unexpectedStorage:[],csp:[]};Object.defineProperty(window,'__onsiteScheduleProbe',{value:probe});
          for(const method of ['setItem','removeItem','clear']){const original=Storage.prototype[method];Storage.prototype[method]=function(...args){
            if(this!==sessionStorage||method==='clear'||!keys.includes(args[0])||method==='setItem'&&/aq1\.|nonce|"token"|"claims"/.test(String(args[1])))probe.unexpectedStorage.push(method+':'+String(args[0]));
            return original.apply(this,args);};}
          document.addEventListener('securitypolicyviolation',e=>probe.csp.push(e.violatedDirective));
        },{seed:{auth:d.auth},keys:[pendingKey,oldKey]});
        await context.route('**/*',route=>{
          if(closing)return route.abort().catch(()=>{});
          const work=(async()=>{
            const req=route.request(),url=new URL(req.url());assert.equal(url.origin,canonical,'external_origin');assert(!url.search.includes('aq1.')&&!url.searchParams.has('token'),'token_in_request_URL');
            if([scanPath,'/qa.js','/qa.css'].includes(url.pathname)){
              assert.equal(req.method(),'GET');const local=await fetch(origin+(url.pathname===scanPath?'/':url.pathname));
              return route.fulfill({status:local.status,headers:Object.fromEntries(local.headers),body:Buffer.from(await local.arrayBuffer())});
            }
            assert([endpoint,oldEndpoint].includes(url.pathname));assert(['GET','POST'].includes(req.method()));assert(requests.length<75,'request_budget');
            const body=req.method()==='POST'?JSON.parse(req.postData()??'null'):null;
            const record={path:url.pathname,method:req.method(),query:Object.fromEntries(url.searchParams),body:body?{...body,token:'[memory-only capability]'}:null,status:null};requests.push(record);
            const drop=url.pathname===endpoint&&req.method()==='POST'?dropNext:null;if(drop)dropNext=null;
            if(drop==='before'){record.status='undelivered';return route.abort('failed');}
            const response=await(url.pathname===endpoint?d.handleNew:d.handleOld)(new Request(canonical+url.pathname+url.search,{method:req.method(),headers:{host:'www.faolla.com',origin:canonical,'sec-fetch-site':'same-origin',
              'x-merchant-access-token':'synthetic-onsite-session',...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})}),url.pathname===endpoint?{featureEnabled:()=>feature}:{});
            record.status=response.status;const text=await response.text();record.response=JSON.parse(text);assert.equal(response.headers.get('cache-control'),'private, no-store');
            if(drop==='after'){assert.equal(response.status,200);return route.abort('failed');}
            await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:text});
          })();inflight.add(work);void work.finally(()=>inflight.delete(work)).catch(()=>{});
          return work.catch(async error=>{if(!closing)errors.push(error instanceof Error?error.message:'route_error');await route.abort().catch(()=>{});});
        });
        const page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));page.on('download',()=>errors.push('download'));page.on('popup',()=>errors.push('popup'));
        page.on('dialog',dialog=>{if(dialog.type()==='beforeunload')void dialog.accept().catch(()=>{});else{errors.push('dialog');void dialog.dismiss().catch(()=>{});}});
        await page.goto(`${canonical}${scanPath}?siteId=${d.site}`);await parent(page).getByRole('status',{exact:true}).filter({hasText:'状态已同步'}).waitFor();
        try{await check(page);}catch(error){error.message=`${name}: ${error.message}`;throw error;}
        await quiet(page);assert.deepEqual(await page.evaluate(()=>window.__onsiteScheduleProbe),{unexpectedStorage:[],csp:[]});assert.equal(await page.evaluate(()=>localStorage.length),0);
        assert.equal(d.fingerprint(protectedTables),fingerprint);assert.equal(d.definitions(),definitions);checks++;native.pass(name);
      }finally{await context.close();}
    };
    await run('onsite default-off actual Phone reads only old state with no new endpoint/camera/POST',async page=>{
      await quiet(page);assert.equal(await child(page).count(),0);assert.equal(requests.filter(r=>r.path===endpoint).length,0);assert.equal(posts().length,0);
      assert.equal(await page.getByRole('button',{name:'打开摄像头扫码',exact:true}).isEnabled(),true);
    },{off:true});
    await run('390px actual Phone explicitly selects before fresh QR then commits relation/adoption and old clock-out',async page=>{
      await read(page);assert.equal(await choice(page).inputValue(),'');assert.equal(await choice(page).locator('option[value="none"]').count(),1);
      await choice(page).selectOption(d.slots.browser.id);const button=child(page).getByRole('button',{name:'现场上班 · 已选排班',exact:true});assert.equal(await button.isDisabled(),true);
      assert.equal(posts().length,0);await scan(page);await button.click();await child(page).locator('[data-onsite-schedule-association="linked"]').waitFor();await child(page).locator('[data-onsite-schedule-adoption="adopted"]').waitFor();
      assert.deepEqual(newPosts().at(-1).body.selection,{slotId:d.slots.browser.id,revision:d.slots.browser.revision});assert.equal(await saved(page),null);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.equal(await child(page).evaluate(el=>el.scrollWidth<=el.clientWidth+1),true);
      assert.equal(await page.locator('img').count(),0);assert(!page.url().includes('aq1.'));await finish(page);
    },{width:390});
    await run('lost committed onsite POST reload uses explicit original-ID GET without code or another POST',async page=>{
      await read(page);await choice(page).selectOption(d.slots.browser.id);await scan(page);dropNext='after';const count=posts().length,events=d.counts().events;
      await child(page).getByRole('button',{name:'现场上班 · 已选排班',exact:true}).click();await child(page).getByRole('status').filter({hasText:'结果尚未确认'}).waitFor();
      const original=await saved(page);assert(original);assert.equal(d.counts().events,events+1);const mark=requests.length;await page.reload();
      await child(page).getByRole('status').filter({hasText:'发现现场选班原编号'}).waitFor();assert.equal(requests.slice(mark).filter(r=>r.path===endpoint).length,0);
      await read(page);await child(page).locator('[data-onsite-schedule-association="linked"]').waitFor();assert.equal(await saved(page),null);assert.equal(posts().length,count+1);
      assert(requests.slice(mark).some(r=>r.path===endpoint&&r.query.operationId===original.command.operationId));await finish(page);
    });
    await run('flag rollback keeps undelivered onsite selection GET-only; explicit retry requires a new issued code',async page=>{
      await read(page);await choice(page).selectOption(d.slots.browser.id);const firstToken=await scan(page);dropNext='before';const events=d.counts().events;
      await child(page).getByRole('button',{name:'现场上班 · 已选排班',exact:true}).click();await child(page).getByRole('status').filter({hasText:'结果尚未确认'}).waitFor();
      const original=await saved(page);assert(original);assert.equal(d.counts().events,events);const count=posts().length;feature=false;bundleOff=true;await page.reload();
      await child(page).getByRole('status').filter({hasText:'发现现场选班原编号'}).waitFor();await read(page);assert.deepEqual(await saved(page),original);
      assert.equal(await child(page).getByRole('button',{name:'新码核对后原编号重试',exact:true}).isDisabled(),true);assert.equal(posts().length,count);
      assert.equal(await parent(page).getByRole('button',{name:'确认上班',exact:true}).isDisabled(),true);
      feature=true;bundleOff=false;await page.reload();await child(page).getByRole('status').filter({hasText:'发现现场选班原编号'}).waitFor();await read(page);
      const retry=child(page).getByRole('button',{name:'新码核对后原编号重试',exact:true});assert.equal(await retry.isDisabled(),true);const fresh=await scan(page);assert.notEqual(fresh,firstToken);
      const mark=requests.length;await retry.click();await child(page).locator('[data-onsite-schedule-association="linked"]').waitFor();
      const chain=requests.slice(mark).filter(r=>r.path===endpoint);assert.equal(chain[0].method,'GET');assert.equal(chain[0].query.operationId,original.command.operationId);
      const post=chain.find(r=>r.method==='POST');assert(post);assert.deepEqual(post.body.command,original.command);assert.deepEqual(post.body.selection,original.selection);
      assert.equal(await saved(page),null);assert.equal(d.counts().events,events+1);await finish(page);
    });
    assert.equal(checks,4);assert.deepEqual(errors,[]);assert.equal(posts().filter(r=>r.path===oldEndpoint&&r.body.command.action==='clock_in').length,0);
    const final=d.counts();assert.deepEqual(final,{...before,events:before.events+6,relations:before.relations+3,adoptions:before.adoptions+3,nonces:before.nonces+6});
    assert.equal(d.fingerprint(protectedTables),fingerprint);assert.equal(d.definitions(),definitions);
    return {checks,apiRequests:requests.length,newPostAttempts:newPosts().length,actualClockIns:3,oldClockOuts:3,eventsAdded:6,relationsAdded:3,adoptionsAdded:3,noncesAdded:6,
      actualPhoneHandlerServiceSql:true,actualSignedCodes:true,syntheticAuth:true,realAuth:false,realCamera:false,externalRequests:0,otherStorageWrites:0,tokenPersisted:false,
      explicitRecovery:true,flagRollback:true,serverModulesBundled:false,newCluster:false,productionAccess:false,before,final};
  }finally{
    closing=true;await runAttendanceCleanupSteps([
      {name:'onsite-schedule-browser',run:async()=>{await browser?.close();}},
      {name:'onsite-schedule-interceptions',run:async()=>{await bounded(Promise.allSettled([...inflight]));}},
      {name:'onsite-schedule-loopback',run:async()=>{if(server.listening){server.closeAllConnections();await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}}},
    ]);
  }
}
