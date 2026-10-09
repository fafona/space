// Real capture UI/client -> actual handlers/services ->130/131 SQL. Identity,
// entitlement and failures are synthetic. Import starts nothing; root owns PG.
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
import {prepareGroupsNativeFixture} from './merchant-attendance-groups-native.mjs';
import {rulesMigrationPlan,rulesNativeSave,rulesNativePublish,rulesQueryInput} from './merchant-attendance-rules-native.mjs';
import {personalRulesMigrationPlan,personalRulesNativeApprove,personalRulesQueryInput} from './merchant-attendance-personal-rules-native.mjs';
import {ruleSourcesMigrationPlan} from './merchant-attendance-rule-sources-native.mjs';
import {ruleCapturesMigrationPlan,ruleCapturesNativeTables} from './merchant-attendance-rule-captures-native.mjs';
import {lifecycleId as id,lifecycleJson as json} from './merchant-attendance-lifecycle-native-support.mjs';
import {runAttendanceCleanupSteps} from './fixtures/attendance-cleanup.mjs';

const root=fileURLToPath(new URL('../',import.meta.url)),require=createRequire(import.meta.url),canonical='https://www.faolla.com';
const capturePath='/api/merchant-enterprise/attendance/rule-captures',sourcePath='/api/merchant-enterprise/attendance/rule-sources';
const siteId='99990001',ownerId=id(99),workerId=id(201),secondWorker=id(202),unrelatedKey='qa-captures-unrelated';
const prefix='faolla:attendance:rule-captures:v1:',storageKey=`${prefix}${siteId}:${ownerId}:${workerId}`;
const quote=value=>"'"+String(value).replaceAll("'","''")+"'";
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
async function bounded(promise){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('rule_captures_browser_timeout')),15000);})]);}finally{clearTimeout(timer);}}

async function assets(){
  const bundle=await build({absWorkingDir:root,entryPoints:['scripts/fixtures/attendance-rule-captures-browser.tsx'],bundle:true,write:false,metafile:true,
    platform:'browser',format:'esm',target:['es2020'],jsx:'automatic',tsconfig:path.join(root,'tsconfig.json'),outfile:'qa.js',
    define:{'process.env':'{}','process.env.NODE_ENV':'"development"'},logLevel:'warning'});
  const candidates=new Set();
  for(const filename of Object.keys(bundle.metafile.inputs).filter(name=>/\.tsx?$/.test(name)&&!name.includes('node_modules'))){
    const source=ts.createSourceFile(filename,await readFile(path.join(root,filename),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
    const visit=node=>{if(ts.isStringLiteral(node)||ts.isNoSubstitutionTemplateLiteral(node)||ts.isTemplateHead(node)||ts.isTemplateMiddle(node)||ts.isTemplateTail(node))
      node.text.split(/\s+/).filter(Boolean).forEach(candidate=>candidates.add(candidate));ts.forEachChild(node,visit);};visit(source);
  }
  const css=(await compile('@import "tailwindcss";',{base:root,onDependency:()=>{}})).build([...candidates])
    +'body{margin:0;background:#f1f5f9;font-family:Arial,sans-serif}.qa-toolbar{padding:12px;background:#fff7ed;font-size:13px;overflow-wrap:anywhere}.qa-controls{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}.qa-controls button,.qa-controls select{max-width:100%;background:white;border:1px solid #94a3b8;padding:6px}.qa-main{max-width:1160px;margin:auto;padding:12px;min-width:0}';
  return {javascript:bundle.outputFiles.find(file=>file.path.endsWith('.js')).contents,css};
}

async function prepare(native,scope){
  const {exec,owned}=await prepareGroupsNativeFixture(native,scope);
  for(const plan of [rulesMigrationPlan,personalRulesMigrationPlan,ruleSourcesMigrationPlan,ruleCapturesMigrationPlan])exec(plan(native.root,scope).body);
  const tables=JSON.parse(exec(`select jsonb_agg(relname order by relname) from pg_class where relnamespace=${owned.oid} and relkind in('r','p');`));
  const hash=selected=>`(select md5(jsonb_build_object(${selected.map(table=>`${quote(table)},(select coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),'[]'::jsonb) from public.${table} r)`).join(',')})::text))`;
  const all=hash(tables),old=hash(tables.filter(table=>!ruleCapturesNativeTables.includes(table)));
  for(const table of ruleCapturesNativeTables)assert.equal(exec(`select count(*) from public.${table};`),'0');
  const today=exec("select (clock_timestamp() at time zone 'UTC')::date::text;"),day=n=>new Date(Date.parse(today+'T00:00:00.000Z')+n*86400000).toISOString().slice(0,10);
  const write=(name,query,command)=>exec(`set local role service_role;select public.${name}(${json(query)},'${ownerId}',${json(command)},true);`);
  write('faolla_attendance_rules_v1',rulesQueryInput(),rulesNativeSave(7501));write('faolla_attendance_rules_v1',rulesQueryInput(),rulesNativePublish(7502,1,day(2)));
  write('faolla_attendance_personal_rules_v1',personalRulesQueryInput(),personalRulesNativeApprove(8001,0,day(2)));
  const fingerprint=()=>exec(`select ${all};`),protectedFingerprint=()=>exec(`select ${old};`),protectedBefore=protectedFingerprint();
  const definition=()=>exec(`select md5(coalesce(jsonb_agg(jsonb_build_array(p.proname,pg_get_functiondef(p.oid),p.proowner,p.proacl,p.proconfig) order by p.proname,p.oid),'[]'::jsonb)::text)
    from pg_proc p where p.pronamespace=${owned.oid} and p.prokind='f';`),definitionBefore=definition();
  let sourceReads=0,captureReads=0,captureWrites=0;
  const source=(query,actor)=>{const before=fingerprint();try{sourceReads++;return JSON.parse(exec(`set local role service_role;select public.faolla_attendance_rule_sources_v1(${json(query)},'${actor}');`));}
    finally{assert.equal(fingerprint(),before,'browser_source_read_changed_facts');}};
  const capture=(query,command,enabled,actor)=>{const before=fingerprint();try{
    if(command)captureWrites++;else captureReads++;
    return JSON.parse(exec(`set local role service_role;select public.faolla_attendance_rule_captures_v1(${json(query)},'${actor}',${json(command)},${enabled?'true':'false'});`));
  }finally{assert.equal(protectedFingerprint(),protectedBefore,'browser_capture_changed_old_facts');if(!command)assert.equal(fingerprint(),before,'browser_capture_GET_changed_facts');}};
  const counts=()=>JSON.parse(exec(`select jsonb_build_object('artifacts',(select count(*) from public.merchant_attendance_rule_capture_artifacts),
    'operations',(select count(*) from public.merchant_attendance_rule_capture_operations));`));
  return {day,source,capture,fingerprint,protectedFingerprint,protectedBefore,definition,definitionBefore,counts,stats:()=>({sourceReads,captureReads,captureWrites})};
}

export async function checkAttendanceRuleCapturesBrowser(native,scope){
  const [adminSource,launcherSource]=await Promise.all(['src/components/enterprise/MerchantAttendanceAdminPanel.tsx','src/components/enterprise/MerchantAttendanceRuleCapturesLauncher.tsx'].map(filename=>readFile(path.join(root,filename),'utf8')));
  const entry=adminSource.match(/<RuleCapturesLauncher\b[\s\S]*?\/>/g);assert.equal(entry?.length,1);assert(entry[0].includes('key={`rule-captures:${state.authorizationEpoch}`}'));
  assert(entry[0].includes('siteId={siteId} ownerId={ownerId} workerId={item.id} apiFetch={apiFetch}'));assert(!/\benabled\s*=/.test(entry[0]));
  assert(entry[0].includes('active={!busy && !state.pending && !editor && state.phase === "ready" && !exceptionOpen && !correctionReviewOpen && !correctionControlsOpen && !revisionApprovalOpen && !(timesheetEnabled && timesheetOpen)}'));
  assert(launcherSource.includes('process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_RULE_CAPTURES_ENABLED === "1"'));assert(launcherSource.includes('.showModal()'));
  const data=await prepare(native,scope),{day}=data,files=await assets();
  const {handleRuleCaptures}=require('../src/app/api/merchant-enterprise/attendance/rule-captures/route-handler.ts');
  const {handleRuleSources}=require('../src/app/api/merchant-enterprise/attendance/rule-sources/route-handler.ts');
  const {executeRuleCaptures}=require('../src/lib/merchantAttendanceRuleCaptures.server.ts');
  const {executeRuleSources}=require('../src/lib/merchantAttendanceRuleSources.server.ts');
  const {parseRuleCapturesQuery,parseRuleCapturesBody,RULE_CAPTURES_ERRORS}=require('../src/lib/merchantAttendanceRuleCaptures.ts');
  const {parseRuleSourcesQuery,RULE_SOURCES_ERRORS}=require('../src/lib/merchantAttendanceRuleSources.ts');
  const {MerchantEnterpriseAccessError}=require('../src/lib/merchantEnterpriseAuth.server.ts');
  const requests=[],errors=[],pending=new Set(),gates=new Set();let browser,origin,closing=false,moduleEnabled=true,authMode='owner',hold=null,loseSuccessfulPost=false,abortUnsentPost=false,checks=0,serviceCalls=0;
  const service={rpc:async(name,args)=>{serviceCalls++;assert([ownerId,id(98)].includes(args.p_auth_user_id));
    try{
      if(name==='faolla_attendance_rule_sources_v1'){
        assert.deepEqual(Object.keys(args).sort(),['p_auth_user_id','p_query']);const query=parseRuleSourcesQuery(args.p_query);assert.equal(query.siteId,siteId);assert([workerId,secondWorker].includes(query.workerId));
        return {data:data.source(query,args.p_auth_user_id),error:null};
      }
      assert.equal(name,'faolla_attendance_rule_captures_v1');assert.deepEqual(Object.keys(args).sort(),['p_auth_user_id','p_command','p_module_enabled','p_query']);
      const query=parseRuleCapturesQuery(args.p_query),command=args.p_command===null?null:parseRuleCapturesBody({query,command:args.p_command}).command;
      assert.equal(query.siteId,siteId);assert([workerId,secondWorker].includes(query.workerId));return {data:data.capture(query,command,args.p_module_enabled,args.p_auth_user_id),error:null};
    }catch(error){const code=String(error).match(/ERROR:\s+(?:[0-9A-Z]{5}:\s+)?([a-z_]+)(?=\r?\n|$)/)?.[1];if(!Object.hasOwn({...RULE_SOURCES_ERRORS,...RULE_CAPTURES_ERRORS},code??''))throw error;return {data:null,error:{message:code}};}
  }};
  const dependencies=(actor,isCapture)=>({enabled:()=>true,authenticate:async()=>{if(authMode==='unauthenticated')throw new MerchantEnterpriseAccessError('unauthorized',401);
    return {user:{id:authMode==='wrong-owner'?id(98):actor},authenticationMethods:['password']};},allow:()=>true,
    entitlement:async site=>{assert.equal(site,siteId);return {permissionConfig:{allowEnterpriseManagement:true,allowEmployeeAttendance:moduleEnabled}};},
    execute:input=>isCapture?executeRuleCaptures(input,service):executeRuleSources(input,service)});
  const server=createServer((request,response)=>{
    if(!origin||request.headers.host!==new URL(origin).host||request.method!=='GET')return response.writeHead(403).end();
    response.setHeader('Cache-Control','no-store');response.setHeader('X-Content-Type-Options','nosniff');
    response.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'");
    const url=new URL(request.url??'/',origin);if(url.search)return response.writeHead(403).end();
    if(url.pathname==='/')return response.writeHead(200,{'Content-Type':'text/html;charset=utf-8'}).end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>隔离候选来源留存验收</title><link rel="stylesheet" href="/qa.css"><div id="qa-root"></div><script type="module" src="/qa.js"></script></html>');
    if(url.pathname==='/qa.js')return response.writeHead(200,{'Content-Type':'text/javascript;charset=utf-8'}).end(files.javascript);
    if(url.pathname==='/qa.css')return response.writeHead(200,{'Content-Type':'text/css;charset=utf-8'}).end(files.css);return response.writeHead(403).end();
  });
  const posts=()=>requests.filter(request=>request.method==='POST').length;
  const gateNext=(method='GET',pathname=capturePath)=>{assert.equal(hold,null);const gate={method,pathname,ready:deferred(),release:deferred(),finished:deferred()};gates.add(gate);hold=gate;return gate;};
  const force=(page,key)=>page.getByTestId(key).evaluate(element=>element.click());
  const select=(page,key,value)=>page.getByTestId(key).evaluate((element,value)=>{element.value=value;element.dispatchEvent(new Event('change',{bubbles:true}));},value);
  const slot=page=>page.evaluate(key=>{const raw=sessionStorage.getItem(key);return raw===null?null:JSON.parse(raw);},storageKey);
  // Names below are stable user-facing contracts of the actual new components.
  const panel=page=>page.getByRole('region',{name:'单员工候选来源留存',exact:true});
  const modal=page=>page.getByRole('dialog',{name:'候选来源留存（未应用）',exact:true});
  const preflight=page=>panel(page).locator('[data-rule-capture-preflight]');
  const receipt=page=>panel(page).locator('[data-rule-capture-result]');
  const from=page=>panel(page).getByLabel('留存开始日期',{exact:true});
  const through=page=>panel(page).getByLabel('留存结束日期',{exact:true});
  const reason=page=>panel(page).getByLabel('留存理由',{exact:true});
  const sourceButton=page=>panel(page).getByRole('button',{name:'读取留存前核对',exact:true});
  const captureButton=page=>panel(page).getByRole('button',{name:'确认留存当前来源',exact:true});
  const recoverButton=page=>panel(page).getByRole('button',{name:'核对原留存编号',exact:true});
  const retryButton=page=>panel(page).getByRole('button',{name:'原编号核对并重试',exact:true});
  const receiptInput=page=>panel(page).getByLabel('留存操作编号',{exact:true});
  const manualButton=page=>panel(page).getByRole('button',{name:'读取指定留存',exact:true});
  const enable=page=>page.getByTestId('enable').click();
  const open=async page=>{await page.getByRole('button',{name:'候选来源留存（未应用）',exact:true}).click();await from(page).waitFor();};
  const close=page=>panel(page).getByRole('button',{name:'关闭候选来源留存',exact:true}).click();
  const readSource=async(page,text='Browser candidate capture')=>{await from(page).fill(day(2));await through(page).fill(day(3));await reason(page).fill(text);await sourceButton(page).click();await preflight(page).waitFor();};
  const waitReceipt=async(page,operation)=>{await receipt(page).waitFor();if(operation)await receipt(page).getByText(operation,{exact:false}).first().waitFor();};
  const manual=async(page,operation)=>{await receiptInput(page).fill(operation);await manualButton(page).click();await waitReceipt(page,operation);};
  const quiet=async(page,count)=>{await page.waitForLoadState('networkidle');await bounded(Promise.all([...pending]));assert.equal(requests.length,count,'unexpected_automatic_capture_request');};
  const cleared=async page=>{assert.equal(await preflight(page).count(),0);assert.equal(await receipt(page).count(),0);};
  const failed=async page=>{await page.waitForLoadState('networkidle');await panel(page).getByRole('status').filter({hasText:/未能|无法|待确认|已隐藏/}).waitFor();};
  let originalOperation,originalReceipt;

  try{
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const address=server.address();assert(address&&typeof address==='object');origin=`http://127.0.0.1:${address.port}`;
    browser=await chromium.launch({headless:true});
    const run=async(name,check,width=1280)=>{
      moduleEnabled=true;authMode='owner';const context=await browser.newContext({serviceWorkers:'block',acceptDownloads:false,viewport:{width,height:1100}});
      try{
        await context.addInitScript(({key,prefix})=>{
          sessionStorage.setItem(key,'preserve');const probe={csp:[],localWrites:0,unrelatedWrites:[],sourceTextStored:false};Object.defineProperty(window,'__captureBrowserProbe',{value:probe});
          for(const method of ['setItem','removeItem','clear']){const original=Storage.prototype[method];Storage.prototype[method]=function(...args){
            if(this===localStorage)probe.localWrites++;else if(!String(args[0]).startsWith(prefix))probe.unrelatedWrites.push([method,String(args[0])]);
            if(method==='setItem'&&String(args[1]).includes('sourceText'))probe.sourceTextStored=true;return original.apply(this,args);
          };}document.addEventListener('securitypolicyviolation',event=>probe.csp.push(event.violatedDirective));
        },{key:unrelatedKey,prefix});
        await context.route('**/*',route=>{
          if(closing)return route.abort().catch(()=>{});
          const work=(async()=>{
            const request=route.request(),url=new URL(request.url());assert.equal(url.origin,origin,'external_request_blocked');
            if(['/', '/qa.js','/qa.css'].includes(url.pathname)){assert.equal(request.method(),'GET');assert.equal(url.search,'');return route.continue();}
            assert([capturePath,sourcePath].includes(url.pathname));assert(['GET','POST'].includes(request.method()));if(url.pathname===sourcePath)assert.equal(request.method(),'GET');assert(requests.length<60,'capture_browser_request_budget');
            const sent=request.postData()===null?null:JSON.parse(request.postData()),actor=request.headers()['x-qa-owner'],fetchGeneration=Number(request.headers()['x-qa-fetch-generation']);
            assert([ownerId,id(98)].includes(actor));assert(Number.isInteger(fetchGeneration)&&fetchGeneration>=0&&fetchGeneration<=2);
            if(request.method()==='POST'&&abortUnsentPost){abortUnsentPost=false;requests.push({path:url.pathname,method:'POST',search:url.search,status:null,body:null,sent,delivered:false,fetchGeneration});return route.abort('failed');}
            const handler=url.pathname===capturePath?handleRuleCaptures:handleRuleSources;
            const response=await handler(new Request(canonical+url.pathname+url.search,{method:request.method(),headers:{Host:'www.faolla.com',Origin:canonical,'Content-Type':'application/json'},body:request.postData()??undefined}),dependencies(actor,url.pathname===capturePath));
            const body=await response.text(),parsed=JSON.parse(body);assert.equal(response.headers.get('Cache-Control'),'private, no-store');
            requests.push({path:url.pathname,method:request.method(),search:url.search,status:response.status,body:parsed,sent,delivered:true,fetchGeneration});
            if(request.method()==='POST'&&response.status===200&&loseSuccessfulPost){loseSuccessfulPost=false;return route.abort('failed');}
            const gate=hold?.method===request.method()&&hold?.pathname===url.pathname?hold:null;if(gate){hold=null;gate.ready.resolve(parsed);await gate.release.promise;}
            try{await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body});}catch(error){if(!gate&&!closing)throw error;}
            finally{if(gate){gate.finished.resolve();gates.delete(gate);}}
          })();pending.add(work);void work.finally(()=>pending.delete(work)).catch(()=>{});
          return work.catch(async error=>{if(!closing)errors.push(error instanceof Error?error.message:'capture_route_failed');await route.abort().catch(()=>{});});
        });
        const page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',error=>errors.push(error.message));page.on('download',()=>errors.push('unexpected_download'));page.on('popup',()=>errors.push('unexpected_popup'));
        const confirmations=[];let nextConfirm='accept',reloadAllowed=false;
        const dialogs={confirmations,dismissNext:()=>{assert.equal(nextConfirm,'accept');nextConfirm='dismiss';},reload:async()=>{reloadAllowed=true;try{await page.reload();}finally{reloadAllowed=false;}}};
        page.on('dialog',dialog=>{if(dialog.type()==='confirm'){const disposition=nextConfirm;nextConfirm='accept';confirmations.push({message:dialog.message(),disposition});void(disposition==='dismiss'?dialog.dismiss():dialog.accept()).catch(()=>errors.push('confirm_failed'));}
          else if(dialog.type()==='beforeunload'&&reloadAllowed)void dialog.accept().catch(()=>errors.push('reload_confirm_failed'));else{errors.push('unexpected_dialog');void dialog.dismiss().catch(()=>{});}});
        await page.goto(origin);await page.getByTestId('enable').waitFor();try{await check(page,dialogs);}catch(error){error.message=`${name}: ${error.message}`;throw error;}
        assert.equal(nextConfirm,'accept');assert.deepEqual(await page.evaluate(()=>window.__captureBrowserProbe),{csp:[],localWrites:0,unrelatedWrites:[],sourceTextStored:false});
        assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),unrelatedKey),'preserve');
        const slots=await page.evaluate(prefix=>Object.keys(sessionStorage).filter(key=>key.startsWith(prefix)).map(key=>JSON.parse(sessionStorage.getItem(key))),prefix);
        for(const stored of slots){assert.deepEqual(Object.keys(stored).sort(),['latestId','ownerId','pending','siteId','version','workerId']);assert.equal(stored.version,1);assert.equal(stored.pending,null);assert(!JSON.stringify(stored).includes('sourceText'));}
        assert.equal(data.protectedFingerprint(),data.protectedBefore);assert.equal(data.definition(),data.definitionBefore);checks++;native.pass(name);
      }finally{for(const gate of gates)gate.release.resolve();await context.close();}
    };

    await run('capture browser defaultoff closed and newly opened have zero requests; explicit preflight is actual130 GET',async page=>{
      assert.equal(requests.length,0);assert.equal(await panel(page).count(),0);assert.equal(await page.getByRole('button',{name:'候选来源留存（未应用）',exact:true}).count(),0);
      await enable(page);await open(page);assert.equal(await from(page).inputValue(),'');await quiet(page,0);await readSource(page);
      assert.equal(requests.length,1);assert.equal(requests[0].path,sourcePath);assert.equal(posts(),0);assert.equal(requests[0].body.data.worker.workerId,workerId);
      assert.deepEqual(data.counts(),{artifacts:0,operations:0});
    });

    await run('capture browser390px cancel performs noPOST then explicit confirmation saves one real receipt; native modal protects parent',async(page,dialogs)=>{
      await enable(page);await open(page);await readSource(page,'First browser capture 中文🙂');const before=requests.length,beforeFacts=data.fingerprint();
      dialogs.dismissNext();await captureButton(page).click();assert.equal(dialogs.confirmations.at(-1).disposition,'dismiss');assert.equal(requests.length,before);assert.equal(data.fingerprint(),beforeFacts);
      const confirmation=dialogs.confirmations.at(-1).message;for(const text of [workerId,day(2),day(3),'First browser capture 中文🙂','服务器会重新读取','不证明过去实际采用','确认留存？'])assert(confirmation.includes(text));
      assert.equal(await modal(page).evaluate(element=>element.matches(':modal')),true);await assert.rejects(page.getByTestId('unmount').click({timeout:500}),/Timeout|intercepts pointer events/);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.equal(await modal(page).evaluate(element=>element.scrollWidth<=element.clientWidth+1),true);assert.equal(await page.locator('form form').count(),0);
      await captureButton(page).click();await waitReceipt(page);const saved=requests.at(-1);assert.equal(saved.method,'POST');assert.equal(saved.status,200);originalReceipt=saved.body.data.receipt;originalOperation=originalReceipt.operationId;
      assert.equal(originalReceipt.sourceId,originalOperation);assert.equal(originalReceipt.applied,false);assert.equal(originalReceipt.historicalApplicationProven,false);
      assert((await receipt(page).innerText()).includes(originalReceipt.sourceSha256));assert.deepEqual(data.counts(),{artifacts:1,operations:1});assert.equal(posts(),1);
      assert.equal((await slot(page)).pending,null);assert.equal((await slot(page)).latestId,originalOperation);
      const count=requests.length;await close(page);await open(page);await quiet(page,count);await page.keyboard.press('Escape');await panel(page).waitFor({state:'detached'});await quiet(page,count);
    },390);

    await run('capture browser newnumber same source deduplicates original bytes; manual receipt remains readable while modulepaused',async page=>{
      await enable(page);await open(page);await readSource(page,'Second operation, same immutable source');await captureButton(page).click();await waitReceipt(page);
      const second=requests.at(-1).body.data.receipt;assert.notEqual(second.operationId,originalOperation);assert.equal(second.sourceId,originalReceipt.sourceId);assert.equal(second.sourceText,originalReceipt.sourceText);
      assert.equal(second.sourceReadAt,originalReceipt.sourceReadAt);assert(second.observedAt>originalReceipt.observedAt);assert.deepEqual(data.counts(),{artifacts:1,operations:2});assert.equal(posts(),2);
      moduleEnabled=false;const facts=data.fingerprint(),count=requests.length;await manual(page,originalOperation);
      assert.equal(requests.length,count+1);assert.equal(requests.at(-1).method,'GET');assert.equal(requests.at(-1).body.moduleEnabled,false);assert.deepEqual(requests.at(-1).body.data.receipt,originalReceipt);assert.equal(data.fingerprint(),facts);
      assert.equal(posts(),2);
    });

    await run('capture browser committed reply loss survives realreload and requires explicit original-ID GET only',async(page,dialogs)=>{
      await enable(page);await open(page);await readSource(page,'Committed reply intentionally lost');loseSuccessfulPost=true;await captureButton(page).click();await failed(page);
      const stored=await slot(page);assert(stored?.pending);const pendingCommand=stored.pending.command,committed=requests.at(-1).body.data.receipt;
      assert.equal(committed.operationId,pendingCommand.operationId);assert.equal(posts(),3);assert.deepEqual(data.counts(),{artifacts:1,operations:3});const count=requests.length,facts=data.fingerprint();
      moduleEnabled=false;await dialogs.reload();await enable(page);await open(page);await quiet(page,count);assert.deepEqual(await slot(page),stored);
      await recoverButton(page).click();await waitReceipt(page,pendingCommand.operationId);assert.equal(requests.length,count+1);assert.equal(requests.at(-1).method,'GET');
      assert.equal(new URLSearchParams(requests.at(-1).search).get('operationId'),pendingCommand.operationId);assert.deepEqual(requests.at(-1).body.data.receipt,committed);
      assert.equal(posts(),3);assert.equal(data.fingerprint(),facts);assert.equal((await slot(page)).pending,null);assert.equal((await slot(page)).latestId,pendingCommand.operationId);
    });

    await run('capture browser undeliveredPOST retries only after explicit GETnull and exact original POST',async page=>{
      await enable(page);await open(page);await readSource(page,'Undelivered command recovery');abortUnsentPost=true;const facts=data.fingerprint(),calls=serviceCalls;
      await captureButton(page).click();await failed(page);const stored=await slot(page);assert(stored?.pending);assert.equal(serviceCalls,calls);assert.equal(requests.at(-1).delivered,false);
      assert.equal(posts(),4);assert.equal(data.fingerprint(),facts);const count=requests.length;
      await retryButton(page).click();await waitReceipt(page,stored.pending.command.operationId);const retried=requests.slice(count);assert.equal(retried.length,2);assert.deepEqual(retried.map(item=>item.method),['GET','POST']);
      assert.equal(retried[0].body.data.receipt,null);assert.equal(retried[0].body.moduleEnabled,true);assert.deepEqual(retried[1].sent,stored.pending);assert.equal(posts(),5);
      assert.equal((await slot(page)).pending,null);assert.deepEqual(data.counts(),{artifacts:1,operations:4});
    });

    await run('capture browser successful latePOST cannot consume old pending after hide worker owner and epoch changes',async page=>{
      await enable(page);await open(page);await readSource(page,'Held committed response');const gate=gateNext('POST');await captureButton(page).click();await bounded(gate.ready.promise);
      const stored=await slot(page);assert(stored?.pending);assert.deepEqual(data.counts(),{artifacts:1,operations:5});assert.equal(posts(),6);
      await force(page,'hide');await cleared(page);await select(page,'worker',secondWorker);gate.release.resolve();await bounded(gate.finished.promise);assert.deepEqual(await slot(page),stored);
      await force(page,'show');await open(page);await select(page,'owner',id(98));await force(page,'epoch');const count=requests.length;await quiet(page,count);assert.deepEqual(await slot(page),stored);
      await select(page,'owner',ownerId);await select(page,'worker',workerId);await open(page);await quiet(page,count);await recoverButton(page).click();await waitReceipt(page,stored.pending.command.operationId);
      assert.equal(requests.at(-1).method,'GET');assert.equal(posts(),6);assert.equal((await slot(page)).pending,null);assert.deepEqual(data.counts(),{artifacts:1,operations:5});
    });

    await run('capture browser latebody apiFetch and pagehide invalidate data;401403 clear old receipt without writes',async page=>{
      await enable(page);await open(page);await from(page).fill(day(2));await through(page).fill(day(3));await reason(page).fill('Stale body preflight');await force(page,'arm-body');await sourceButton(page).click();
      await page.getByTestId('body-phase').filter({hasText:'held'}).waitFor();const count=requests.length;await force(page,'api-change');await force(page,'release-body');await cleared(page);await quiet(page,count);
      if(await panel(page).count()===0)await open(page);await manual(page,originalOperation);
      const gate=gateNext();await manualButton(page).click();await bounded(gate.ready.promise);const heldCount=requests.length;await force(page,'pagehide');gate.release.resolve();await bounded(gate.finished.promise);await cleared(page);
      await force(page,'pageshow');await quiet(page,heldCount);
      await manual(page,originalOperation);authMode='unauthenticated';await manualButton(page).click();await failed(page);await cleared(page);assert.equal(requests.at(-1).status,401);
      authMode='owner';await manual(page,originalOperation);authMode='wrong-owner';await manualButton(page).click();await failed(page);await cleared(page);assert.equal(requests.at(-1).status,403);
      assert.equal(posts(),6);assert.deepEqual(data.counts(),{artifacts:1,operations:5});
    });
    assert.equal(checks,7);assert.deepEqual(errors,[]);assert.equal(posts(),6);assert.deepEqual(data.counts(),{artifacts:1,operations:5});assert.equal(data.protectedFingerprint(),data.protectedBefore);assert.equal(data.definition(),data.definitionBefore);
    return {checks,apiRequests:requests.length,posts:posts(),...data.counts(),...data.stats(),externalRequests:0,productionAccess:false,realAuth:false,fullAdminE2E:false,
      actualHandlerServiceSql:true,syntheticOnly:true,oldFactsAndDefinitionsUnchanged:true,storageContainsNoSourceText:true,callerOwnedNamespaceCleanup:true};
  }finally{
    closing=true;for(const gate of gates)gate.release.resolve();
    await runAttendanceCleanupSteps([
      {name:'rule-captures-browser',run:async()=>{await browser?.close();}},
      {name:'rule-captures-interceptions',run:async()=>{await Promise.allSettled([...pending]);}},
      {name:'rule-captures-loopback',run:async()=>{if(server.listening){server.closeAllConnections();await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}}},
    ]);
  }
}
