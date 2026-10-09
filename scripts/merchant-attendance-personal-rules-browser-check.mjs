// Actual PersonalRulesLauncher/Panel/Client -> handler/service/parser ->129 SQL.
// Identity, entitlement and failure injection are explicitly synthetic. Import
// is inert. No Next server, real authentication, external assets or build files.
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
import {rulesMigrationPlan} from './merchant-attendance-rules-native.mjs';
import {personalRulesMigrationPlan,personalRulesNativePlan,personalRulesNativeTables,personalRulesQueryInput} from './merchant-attendance-personal-rules-native.mjs';
import {lifecycleId as id,lifecycleJson as json} from './merchant-attendance-lifecycle-native-support.mjs';
import {runAttendanceCleanupSteps} from './fixtures/attendance-cleanup.mjs';

const root=fileURLToPath(new URL('../',import.meta.url)),require=createRequire(import.meta.url);
const endpoint='/api/merchant-enterprise/attendance/personal-rules',canonical='https://www.faolla.com';
const siteId='99990001',ownerId=id(99),workerId=id(201),secondWorker=id(202),unrelatedKey='qa-unrelated-personal-rule';
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
async function bounded(promise){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('personal_rules_browser_timeout')),15000);})]);}finally{clearTimeout(timer);}}

async function assets(){
  const bundle=await build({absWorkingDir:root,entryPoints:['scripts/fixtures/attendance-personal-rules-browser.tsx'],bundle:true,write:false,metafile:true,
    platform:'browser',format:'esm',target:['es2020'],jsx:'automatic',tsconfig:path.join(root,'tsconfig.json'),outfile:'qa.js',
    define:{'process.env':'{}','process.env.NODE_ENV':'"development"'},logLevel:'warning'});
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
    +'body{margin:0;background:#f1f5f9;font-family:Arial,sans-serif}.qa-toolbar{padding:12px;background:#fff7ed;font-size:13px;overflow-wrap:anywhere}.qa-controls{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}.qa-controls button,.qa-controls select{max-width:100%;background:white;border:1px solid #94a3b8;padding:6px}.qa-main{max-width:1160px;margin:auto;padding:12px;min-width:0}';
  return {javascript:bundle.outputFiles.find(file=>file.path.endsWith('.js')).contents,css};
}

// Minimal setup only, not the145 acceptance suite. Existing fixtures enforce
// random namespace OID, marker and owner on every SQL execution.
async function prepare(native,scope){
  const foundation=await prepareGroupsNativeFixture(native,scope),{exec,owned}=foundation;
  exec(rulesMigrationPlan(native.root,scope).body);exec(personalRulesMigrationPlan(native.root,scope).body);
  const tables=JSON.parse(exec(`select jsonb_agg(relname order by relname) from pg_class where relnamespace=${owned.oid} and relkind in('r','p');`));
  const plan=personalRulesNativePlan(owned,tables);
  for(const table of personalRulesNativeTables)assert.equal(exec(`select count(*) from public.${table};`),'0','personal_browser_requires_empty_ledger');
  const {parsePersonalRulesResult}=require('../src/lib/merchantAttendancePersonalRules.ts');
  const call=(query=personalRulesQueryInput(),command=null,allow=false,actor=ownerId)=>{
    const raw=JSON.parse(exec(`set local role service_role;select public.faolla_attendance_personal_rules_v1(${json(query)},'${actor}',${json(command)},${allow?'true':'false'});`));
    const result=parsePersonalRulesResult(raw,query,command,actor);assert.deepEqual(result,raw,'personal_browser_SQL_parser_disagreed');return result;
  };
  return {exec,call,read:(patch={})=>call(personalRulesQueryInput(patch)),
    fingerprint:()=>exec(`select ${plan.fingerprint};`),protectedFingerprint:()=>exec(`select ${plan.protectedFingerprint};`),
    counts:()=>JSON.parse(exec(`select jsonb_build_object('streams',(select count(*)::integer from public.merchant_attendance_personal_rule_streams),
      'operations',(select count(*)::integer from public.merchant_attendance_personal_rule_operations));`))};
}

export async function checkAttendancePersonalRulesBrowser(native,scope){
  const [adminSource,launcherSource]=await Promise.all(['src/components/enterprise/MerchantAttendanceAdminPanel.tsx',
    'src/components/enterprise/MerchantAttendancePersonalRulesLauncher.tsx'].map(filename=>readFile(path.join(root,filename),'utf8')));
  const integration=adminSource.match(/<PersonalRulesLauncher\b[\s\S]*?\/>/g);
  assert.equal(integration?.length,1,'personal_launcher_integration_count');
  const entry=integration[0];
  assert(entry.includes('key={`personal-rules:${state.authorizationEpoch}`}'));
  assert(entry.includes('siteId={siteId} ownerId={ownerId} workerId={item.id} apiFetch={apiFetch}'));
  assert(entry.includes('active={!busy && !state.pending && !editor && state.phase === "ready" && !exceptionOpen && !correctionReviewOpen && !correctionControlsOpen && !revisionApprovalOpen && !(timesheetEnabled && timesheetOpen)}'));
  assert(!/\benabled\s*=/.test(entry),'personal_parent_must_not_override_default_flag');
  assert(launcherSource.includes('process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_PERSONAL_RULES_ENABLED === "1"'));
  assert(launcherSource.includes('dialog.showModal()'));
  const data=await prepare(native,scope),protectedBefore=data.protectedFingerprint();
  const today=data.exec("select ((clock_timestamp() at time zone 'UTC')::date)::text;");
  const day=n=>new Date(Date.parse(today+'T00:00:00.000Z')+n*86400000).toISOString().slice(0,10);
  const {handlePersonalRules}=require('../src/app/api/merchant-enterprise/attendance/personal-rules/route-handler.ts');
  const {executePersonalRules}=require('../src/lib/merchantAttendancePersonalRules.server.ts');
  const {parsePersonalRulesBody,parsePersonalRulesQuery,PERSONAL_RULES_ERRORS}=require('../src/lib/merchantAttendancePersonalRules.ts');
  const files=await assets(),requests=[],errors=[],gates=new Set(),pending=new Set();
  let browser,origin,closing=false,moduleEnabled=true,loseSuccessfulPost=false,abortUnsentPost=false,hold=null,checks=0,serviceCalls=0;
  const service={rpc:async(name,args)=>{
    assert.equal(name,'faolla_attendance_personal_rules_v1');assert.deepEqual(Object.keys(args).sort(),['p_allow_write','p_auth_user_id','p_command','p_query']);
    assert.equal(args.p_auth_user_id,ownerId);assert.equal(typeof args.p_allow_write,'boolean');
    const query=parsePersonalRulesQuery(args.p_query),command=args.p_command===null?null:parsePersonalRulesBody({query,command:args.p_command}).command;
    assert.equal(query.siteId,siteId);assert([workerId,secondWorker].includes(query.workerId));serviceCalls++;
    try{return {data:data.call(query,command,args.p_allow_write,args.p_auth_user_id),error:null};}
    catch(error){const code=String(error).match(/ERROR:\s+(?:[0-9A-Z]{5}:\s+)?([a-z_]+)(?=\r?\n|$)/)?.[1];if(!Object.hasOwn(PERSONAL_RULES_ERRORS,code??''))throw error;return {data:null,error:{message:code}};}
  }};
  const dependencies={enabled:()=>true,authenticate:async()=>({user:{id:ownerId},authenticationMethods:['password']}),allow:()=>true,
    entitlement:async requestedSite=>{assert.equal(requestedSite,siteId);return {permissionConfig:{allowEnterpriseManagement:true,allowEmployeeAttendance:moduleEnabled}};},
    execute:input=>executePersonalRules(input,service)};
  const server=createServer((request,response)=>{
    if(!origin||request.headers.host!==new URL(origin).host||request.method!=='GET')return response.writeHead(403).end();
    response.setHeader('Cache-Control','no-store');response.setHeader('X-Content-Type-Options','nosniff');
    response.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'");
    const url=new URL(request.url??'/',origin);if(url.search)return response.writeHead(403).end();
    if(url.pathname==='/')return response.writeHead(200,{'Content-Type':'text/html;charset=utf-8'}).end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>隔离个人例外验收</title><link rel="stylesheet" href="/qa.css"><div id="qa-root"></div><script type="module" src="/qa.js"></script></html>');
    if(url.pathname==='/qa.js')return response.writeHead(200,{'Content-Type':'text/javascript;charset=utf-8'}).end(files.javascript);
    if(url.pathname==='/qa.css')return response.writeHead(200,{'Content-Type':'text/css;charset=utf-8'}).end(files.css);
    return response.writeHead(403).end();
  });
  const posts=()=>requests.filter(request=>request.method==='POST').length;
  const gateNext=(method='GET')=>{assert.equal(hold,null);const gate={method,ready:deferred(),release:deferred(),finished:deferred()};gates.add(gate);hold=gate;return gate;};
  // A native modal deliberately prevents normal parent interaction. Only these
  // forced DOM actions model outside identity/lifecycle changes.
  const force=async(page,testId)=>page.getByTestId(testId).evaluate(element=>element.click());
  const select=async(page,testId,value)=>page.getByTestId(testId).evaluate((element,value)=>{
    element.value=value;element.dispatchEvent(new Event('change',{bubbles:true}));
  },value);
  const stored=async(page,key)=>page.evaluate(key=>sessionStorage.getItem(key),key);
  const storagePrefix='faolla:attendance:personal-rules:v1:',storageKey=`${storagePrefix}${siteId}:${ownerId}:${workerId}`;
  const panel=page=>page.getByRole('region',{name:'个人例外候选记录（未应用）',exact:true});
  const modal=page=>page.getByRole('dialog',{name:'个人例外候选管理（未应用）',exact:true});
  const receipt=page=>panel(page).getByRole('region',{name:'个人例外原操作收据',exact:true});
  const history=page=>panel(page).getByRole('region',{name:'个人例外候选历史',exact:true});
  const mode=(page,key='lateGraceMinutes')=>panel(page).locator(`select[id$="${key}-mode"]`);
  const minutes=(page,key='lateGraceMinutes')=>panel(page).locator(`input[id$="${key}-value"]`);
  const approveButton=page=>panel(page).getByRole('button',{name:'核对并核准个人例外候选',exact:true});
  const enable=async page=>page.getByTestId('enable').click();
  const open=async page=>page.getByRole('button',{name:'个人例外候选（未应用）',exact:true}).click();
  const close=async page=>panel(page).getByRole('button',{name:'关闭个人例外',exact:true}).click();
  const ready=async(page,target=workerId)=>{
    await panel(page).getByText('当前目标人员',{exact:true}).waitFor();
    await panel(page).locator('dl').first().getByText(new RegExp(target)).waitFor();
  };
  const waitReceipt=async(page,revision,action='负责人核准登记')=>receipt(page).getByText(new RegExp(`版本 ${revision} · ${action}`)).waitFor();
  const failed=async page=>panel(page).getByRole('status').filter({hasText:'未能可靠确认结果'}).waitFor();
  const fillApproval=async(page,date,reason,value='0')=>{
    await panel(page).getByLabel('开始日期（企业当地）',{exact:true}).fill(date);
    await panel(page).getByLabel('结束日期（含尾日）',{exact:true}).fill(date);
    await mode(page).selectOption('value');await minutes(page).fill(value);
    await mode(page,'earlyGraceMinutes').selectOption('disabled');
    await mode(page,'completedBreakMinimumMinutes').selectOption('value');await minutes(page,'completedBreakMinimumMinutes').fill('1');
    await panel(page).getByLabel('负责人核准理由',{exact:true}).fill(reason);
  };
  const approve=async(page,date,reason,value='0')=>{await fillApproval(page,date,reason,value);await approveButton(page).click();};

  try{
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    const address=server.address();assert(address&&typeof address==='object');origin=`http://127.0.0.1:${address.port}`;
    browser=await chromium.launch({headless:true});
    const run=async(name,check,width=1280)=>{
      moduleEnabled=true;const context=await browser.newContext({serviceWorkers:'block',acceptDownloads:false,viewport:{width,height:1100}});
      try{
        await context.addInitScript(key=>{
          sessionStorage.setItem(key,'preserve');const probe={csp:[],localStorageWrites:0,unexpectedStorageWrites:[]};Object.defineProperty(window,'__personalRulesBrowserProbe',{value:probe});
          for(const method of ['setItem','removeItem']){
            const original=Storage.prototype[method];Storage.prototype[method]=function(...args){
              if(this===localStorage)probe.localStorageWrites++;
              else if(!String(args[0]).startsWith('faolla:attendance:personal-rules:v1:'))probe.unexpectedStorageWrites.push(String(args[0]));
              return original.apply(this,args);
            };
          }
          document.addEventListener('securitypolicyviolation',event=>probe.csp.push(event.violatedDirective));
        },unrelatedKey);
        await context.route('**/*',route=>{
          if(closing)return route.abort().catch(()=>{});
          const work=(async()=>{
            const request=route.request(),url=new URL(request.url());assert.equal(url.origin,origin,'external_request_blocked');
            if(['/', '/qa.js','/qa.css'].includes(url.pathname)){assert.equal(request.method(),'GET');assert.equal(url.search,'');return route.continue();}
            assert.equal(url.pathname,endpoint);assert(['GET','POST'].includes(request.method()));assert(requests.length<60,'request_budget_exceeded');
            const sent=request.postData()===null?null:JSON.parse(request.postData()),fetchGeneration=Number(request.headers()['x-qa-fetch-generation']);
            assert(Number.isSafeInteger(fetchGeneration)&&fetchGeneration>=0&&fetchGeneration<=2,'invalid_synthetic_fetch_generation');
            if(request.method()==='POST'&&abortUnsentPost){abortUnsentPost=false;requests.push({method:'POST',search:url.search,status:null,body:null,sent,delivered:false,fetchGeneration});return route.abort('failed');}
            const headers=new Headers({'Host':'www.faolla.com','Origin':canonical,'Content-Type':'application/json'});
            const response=await handlePersonalRules(new Request(canonical+endpoint+url.search,{method:request.method(),headers,body:request.postData()??undefined}),dependencies);
            const body=await response.text(),parsed=JSON.parse(body);assert.equal(response.headers.get('Cache-Control'),'private, no-store');
            requests.push({method:request.method(),search:url.search,status:response.status,body:parsed,sent,delivered:true,fetchGeneration});
            if(request.method()==='POST'&&response.status===200&&loseSuccessfulPost){loseSuccessfulPost=false;return route.abort('failed');}
            const gate=hold?.method===request.method()?hold:null;
            if(gate){hold=null;gate.ready.resolve(parsed);await gate.release.promise;}
            try{await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body});}
            catch(error){if(!gate&&!closing)throw error;}
            finally{if(gate){gate.finished.resolve();gates.delete(gate);}}
          })();pending.add(work);void work.finally(()=>pending.delete(work)).catch(()=>{});
          return work.catch(async error=>{if(!closing)errors.push(error instanceof Error?error.message:'route_failed');await route.abort().catch(()=>{});});
        });
        const page=await context.newPage();page.setDefaultTimeout(10000);
        page.on('pageerror',error=>errors.push(error.message));page.on('download',()=>errors.push('unexpected_download'));page.on('popup',()=>errors.push('unexpected_popup'));
        let nextConfirm='accept',allowReloadPrompt=false;const confirmations=[];
        const dialogs={confirmations,dismissNextConfirm:()=>{assert.equal(nextConfirm,'accept');nextConfirm='dismiss';},
          reload:async()=>{assert.equal(allowReloadPrompt,false);allowReloadPrompt=true;try{await page.reload();}finally{allowReloadPrompt=false;}}};
        page.on('dialog',dialog=>{
          if(dialog.type()==='confirm'){
            const disposition=nextConfirm;nextConfirm='accept';confirmations.push({message:dialog.message(),disposition});
            void(disposition==='dismiss'?dialog.dismiss():dialog.accept()).catch(()=>errors.push('dialog_resolution_failed'));
          }else if(dialog.type()==='beforeunload'&&allowReloadPrompt){void dialog.accept().catch(()=>errors.push('dialog_resolution_failed'));}
          else{errors.push('unexpected_dialog');void dialog.dismiss().catch(()=>errors.push('dialog_resolution_failed'));}
        });
        await page.goto(origin);await page.getByTestId('enable').waitFor();
        try{await check(page,dialogs);}catch(error){error.message=`${name}: ${error.message}`;throw error;}
        assert.equal(nextConfirm,'accept','unused_confirm_disposition');
        assert.deepEqual(await page.evaluate(()=>window.__personalRulesBrowserProbe),{csp:[],localStorageWrites:0,unexpectedStorageWrites:[]});
        assert.equal(await stored(page,unrelatedKey),'preserve');
        assert.equal(await page.evaluate(prefix=>Object.keys(sessionStorage).filter(key=>key.startsWith(prefix)).length,storagePrefix),0,'personal_pending_not_cleared');
        assert.equal(data.protectedFingerprint(),protectedBefore,'personal_browser_changed_old_facts');checks++;native.pass(name);
      }finally{for(const gate of gates)gate.release.resolve();await context.close();}
    };

    await run('personal browser default-off and closed launcher make zero reads; explicit open reads actual empty SQL context',async page=>{
      assert.equal(requests.length,0);assert.equal(await panel(page).count(),0);
      assert.equal(await page.getByRole('button',{name:'个人例外候选（未应用）',exact:true}).count(),0);
      await enable(page);assert.equal(requests.length,0);await open(page);await ready(page);
      assert.equal(requests.length,1);assert.equal(requests[0].method,'GET');assert.equal(requests[0].body.revision,0);
      assert.equal(requests[0].body.worker.workerId,workerId);assert.equal(requests[0].body.worker.employeeId,id(101));
      assert.equal(await mode(page).inputValue(),'inherit');assert.equal(await minutes(page).inputValue(),'');
      assert.deepEqual(data.counts(),{streams:0,operations:0});assert.equal(await page.locator('form form').count(),0);
    });

    await run('personal browser390px explicit-zero approval and future withdrawal; native modal and cancelled Escape preserve unsent input',async(page,dialogs)=>{
      await enable(page);await open(page);await ready(page);
      const beforeBlank={requests:requests.length,facts:data.fingerprint()};
      await fillApproval(page,day(7),'Browser invalid blank','');await approveButton(page).click();
      await panel(page).getByRole('alert').filter({hasText:'空白不等于 0'}).waitFor();
      assert.equal(requests.length,beforeBlank.requests);assert.equal(data.fingerprint(),beforeBlank.facts);assert.equal(dialogs.confirmations.length,0);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'personal_document_horizontal_overflow');
      assert.equal(await modal(page).evaluate(element=>element.scrollWidth<=element.clientWidth+1),true,'personal_modal_horizontal_overflow');
      assert.equal(await page.locator('form form').count(),0);
      await approve(page,day(7),'Browser owner approval');await waitReceipt(page,1);
      const approved=data.read().items[0];assert.equal(approved.action,'approve');assert.equal(approved.employeeId,id(101));assert.equal(approved.employeeAuthUserId,id(1));
      assert.equal(approved.startsOn,day(7));assert.equal(approved.fromAt,day(7)+'T00:00:00.000Z');assert.equal(approved.toAt,day(8)+'T00:00:00.000Z');
      assert.deepEqual(approved.rules,{lateGraceMinutes:{mode:'value',minutes:0},earlyGraceMinutes:{mode:'disabled'},
        openSpanWarningMinutes:{mode:'inherit'},completedBreakMinimumMinutes:{mode:'value',minutes:1}});
      const approvalReceipt=data.read({operationId:approved.operationId}).receipt;
      assert.match(dialogs.confirmations.at(-1).message,/^请二次核对个人例外候选/);
      assert(dialogs.confirmations.at(-1).message.includes(workerId));assert(dialogs.confirmations.at(-1).message.includes(id(1)));
      await mode(page).selectOption('value');await minutes(page).fill('37');
      await panel(page).getByLabel('负责人核准理由',{exact:true}).fill('Unsaved input must survive cancellation');
      await history(page).getByLabel('撤回版本 1 的理由',{exact:true}).fill('Browser cancelled withdrawal');
      const beforeCancel={requests:requests.length,posts:posts(),facts:data.fingerprint(),confirmations:dialogs.confirmations.length};
      assert.equal(await modal(page).evaluate(element=>element.matches(':modal')),true);
      await assert.rejects(page.getByTestId('unmount').click({timeout:600}),/Timeout|intercepts pointer events/);
      const prompt=page.waitForEvent('dialog',{timeout:5000});dialogs.dismissNextConfirm();await page.keyboard.press('Escape');await prompt;
      assert.equal(dialogs.confirmations.length,beforeCancel.confirmations+1);assert.match(dialogs.confirmations.at(-1).message,/^未提交的个人例外输入将清除/);
      assert.equal(dialogs.confirmations.at(-1).disposition,'dismiss');assert.equal(await modal(page).evaluate(element=>element.matches(':modal')),true);
      assert.equal(await minutes(page).inputValue(),'37');assert.equal(await panel(page).getByLabel('负责人核准理由',{exact:true}).inputValue(),'Unsaved input must survive cancellation');
      dialogs.dismissNextConfirm();await history(page).getByRole('button',{name:'请求撤回未开始候选 1',exact:true}).click();
      assert.equal(dialogs.confirmations.at(-1).disposition,'dismiss');assert.match(dialogs.confirmations.at(-1).message,/^仅请求撤回个人例外核准版本 1/);
      assert.equal(await minutes(page).inputValue(),'37');assert.equal(await history(page).getByLabel('撤回版本 1 的理由',{exact:true}).inputValue(),'Browser cancelled withdrawal');
      assert.equal(requests.length,beforeCancel.requests);assert.equal(posts(),beforeCancel.posts);assert.equal(data.fingerprint(),beforeCancel.facts);
      await history(page).getByRole('button',{name:'请求撤回未开始候选 1',exact:true}).click();await waitReceipt(page,2,'撤回未开始候选');
      const withdrawn=data.read();assert.equal(withdrawn.items.find(item=>item.revision===1).withdrawnByRevision,2);
      assert.deepEqual(data.read({operationId:approved.operationId}).receipt,approvalReceipt,'withdraw_changed_original_receipt');
      assert.deepEqual(data.counts(),{streams:1,operations:2});assert.equal(posts(),2);
    },390);

    await run('personal browser committed200 response loss survives actual reload and recovers original receipt by paused GET only',async(page,dialogs)=>{
      await enable(page);await open(page);await ready(page);loseSuccessfulPost=true;
      await approve(page,day(10),'Browser committed but reply lost');await failed(page);
      const raw=await stored(page,storageKey),pendingCommand=JSON.parse(raw).command;
      assert.equal(pendingCommand.action,'approve');assert.equal(pendingCommand.expectedRevision,2);assert.equal(posts(),3);assert.equal(data.read().revision,3);
      const original=data.read({operationId:pendingCommand.operationId}).receipt,baseline=data.fingerprint(),beforeReload=requests.length;
      moduleEnabled=false;await dialogs.reload();await page.getByTestId('enable').waitFor();
      assert.equal(await stored(page,storageKey),raw);assert.equal(requests.length,beforeReload,'reload_must_not_read_closed_feature');
      await enable(page);await open(page);await waitReceipt(page,3);
      assert.equal(requests.length,beforeReload+1);assert.equal(requests.at(-1).method,'GET');
      assert.equal(new URLSearchParams(requests.at(-1).search).get('operationId'),pendingCommand.operationId);
      assert.deepEqual(requests.at(-1).body.receipt,original);assert.equal(requests.at(-1).body.moduleEnabled,false);
      assert.equal(await stored(page,storageKey),null);assert.equal(posts(),3);assert.equal(data.fingerprint(),baseline);
      assert.equal(await mode(page).isDisabled(),true);assert.equal(await approveButton(page).isDisabled(),true);
      assert.equal(await history(page).getByRole('button',{name:'请求撤回未开始候选 3',exact:true}).isDisabled(),true);
      await panel(page).getByText('当前不开放新写入；仍可读取已有记录和查询原收据，不会丢弃待确认编号。',{exact:true}).waitFor();
    });

    await run('personal browser actual overlap409 clears only rejected pending and never retries on refresh',async page=>{
      await enable(page);await open(page);await ready(page);const baseline=data.fingerprint();
      await approve(page,day(10),'Browser rejected overlap');await failed(page);
      assert.equal(requests.at(-1).status,409);assert.deepEqual(requests.at(-1).body,{ok:false,error:'attendance_personal_rule_overlap'});
      assert.equal(await stored(page,storageKey),null);assert.equal(posts(),4);assert.equal(data.fingerprint(),baseline);
      const rejectedId=requests.at(-1).sent.command.operationId;assert.equal(data.read({operationId:rejectedId}).receipt,null);
      assert.equal(await panel(page).getByRole('button',{name:'按原编号核对并重试个人例外',exact:true}).count(),0);
      await panel(page).getByRole('button',{name:'重新读取个人例外',exact:true}).click();await ready(page);
      assert.equal(posts(),4);assert.equal(requests.at(-1).method,'GET');assert.equal(new URLSearchParams(requests.at(-1).search).get('operationId'),null);
      assert.equal(data.fingerprint(),baseline);
    });

    await run('personal browser request not delivered retries only after explicit original-ID GET and exact original POST',async page=>{
      await enable(page);await open(page);await ready(page);const baseline=data.fingerprint(),calls=serviceCalls;
      abortUnsentPost=true;await approve(page,day(12),'Browser request never delivered');await failed(page);
      const raw=await stored(page,storageKey),original=JSON.parse(raw),first=requests.at(-1);
      assert.equal(first.delivered,false);assert.equal(first.status,null);assert.equal(serviceCalls,calls);assert.deepEqual(first.sent.command,original.command);
      assert.equal(data.fingerprint(),baseline);assert.equal(data.read({operationId:original.command.operationId}).receipt,null);assert.equal(posts(),5);
      const beforeRetry=requests.length;await panel(page).getByRole('button',{name:'按原编号核对并重试个人例外',exact:true}).click();await waitReceipt(page,4);
      const retried=requests.slice(beforeRetry);assert.equal(retried.length,2);assert.deepEqual(retried.map(request=>request.method),['GET','POST']);
      assert.equal(new URLSearchParams(retried[0].search).get('operationId'),original.command.operationId);assert.equal(retried[0].body.receipt,null);
      assert.deepEqual(retried[1].sent,{query:original.query,command:original.command});assert.equal(retried[1].status,200);
      assert.equal(await stored(page,storageKey),null);assert.equal(posts(),6);assert.deepEqual(data.counts(),{streams:1,operations:4});
    });

    await run('personal browser late committed reply after pagehide cannot consume another worker or owner pending scope',async page=>{
      await enable(page);await open(page);await ready(page);const gate=gateNext('POST');
      await approve(page,day(14),'Browser committed response held across lifecycle');await bounded(gate.ready.promise);
      const raw=await stored(page,storageKey),original=JSON.parse(raw);assert.equal(data.read().revision,5);assert.equal(posts(),7);
      await force(page,'pagehide');assert.equal(await panel(page).locator('dl').count(),0);assert.equal(await receipt(page).count(),0);
      await select(page,'worker',secondWorker);await panel(page).waitFor({state:'detached'});
      gate.release.resolve();await bounded(gate.finished.promise);assert.equal(await stored(page,storageKey),raw,'late_reply_consumed_old_pending');
      await open(page);await ready(page,secondWorker);assert.equal(requests.at(-1).body.worker.workerId,secondWorker);assert.equal(requests.at(-1).body.revision,0);
      assert.equal(await panel(page).getByText(new RegExp(original.command.operationId)).count(),0);assert.equal(await stored(page,storageKey),raw);
      const beforeIdentity=requests.length;await select(page,'owner',id(98));await panel(page).waitFor({state:'detached'});
      await select(page,'worker',workerId);assert.equal(await panel(page).count(),0);assert.equal(requests.length,beforeIdentity);
      assert.equal(await stored(page,storageKey),raw);await select(page,'owner',ownerId);await open(page);await waitReceipt(page,5);
      assert.equal(requests.at(-1).method,'GET');assert.equal(new URLSearchParams(requests.at(-1).search).get('operationId'),original.command.operationId);
      assert.equal(await stored(page,storageKey),null);assert.equal(posts(),7);assert.deepEqual(data.counts(),{streams:1,operations:5});
    });

    await run('personal browser held GET cannot restore hidden unmounted prior-worker prior-owner or prior-epoch details',async page=>{
      const baseline=data.fingerprint();await enable(page);
      let gate=gateNext();await open(page);await bounded(gate.ready.promise);await force(page,'hide');
      gate.release.resolve();await bounded(gate.finished.promise);assert.equal(await panel(page).locator('dl').count(),0);assert.equal(await receipt(page).count(),0);
      await force(page,'show');await ready(page);await close(page);
      gate=gateNext();await open(page);await bounded(gate.ready.promise);await force(page,'unmount');
      gate.release.resolve();await bounded(gate.finished.promise);assert.equal(await panel(page).count(),0);
      await page.getByTestId('mount').click();gate=gateNext();await open(page);await bounded(gate.ready.promise);await select(page,'worker',secondWorker);
      gate.release.resolve();await bounded(gate.finished.promise);assert.equal(await panel(page).count(),0);
      await open(page);await ready(page,secondWorker);assert.equal(requests.at(-1).body.revision,0);await close(page);
      gate=gateNext();await open(page);await bounded(gate.ready.promise);await force(page,'epoch');
      gate.release.resolve();await bounded(gate.finished.promise);assert.equal(await panel(page).count(),0);
      gate=gateNext();await open(page);await bounded(gate.ready.promise);await select(page,'owner',id(98));
      gate.release.resolve();await bounded(gate.finished.promise);assert.equal(await panel(page).count(),0);assert.equal(await modal(page).count(),0);
      assert.equal(data.fingerprint(),baseline);assert.equal(posts(),7);
    });
    await run('personal browser synthetic confirmation re-entry rejects stale navigation and close after same-scope client replacement',async(page,dialogs)=>{
      const baseline=data.fingerprint();await enable(page);await open(page);await ready(page);
      assert.equal(await page.getByTestId('fetch-generation').innerText(),'0');
      await panel(page).getByLabel('负责人核准理由',{exact:true}).fill('Synthetic stale navigate guard');
      await force(page,'confirm-api-change');const beforeNavigate=requests.length,confirmations=dialogs.confirmations.length;
      await panel(page).getByRole('button',{name:'重新读取个人例外',exact:true}).click();await ready(page);
      // Quiet-network observation includes a wrongly launched old-client read;
      // do not hide it by aborting the interception or returning a fake response.
      await page.waitForLoadState('networkidle');await bounded(Promise.all([...pending]));
      assert.equal(await page.getByTestId('fetch-generation').innerText(),'1');
      assert.equal(dialogs.confirmations.length,confirmations+1);assert.match(dialogs.confirmations.at(-1).message,/^未提交的个人例外输入将清除/);
      assert.deepEqual(requests.slice(beforeNavigate).map(request=>({method:request.method,fetchGeneration:request.fetchGeneration})),
        [{method:'GET',fetchGeneration:1}],'stale_navigate_must_not_issue_old_client_GET');
      assert.equal(await modal(page).evaluate(element=>element.matches(':modal')),true);
      assert.equal(await panel(page).getByLabel('负责人核准理由',{exact:true}).inputValue(),'');
      await panel(page).getByLabel('负责人核准理由',{exact:true}).fill('Synthetic stale close guard');
      await force(page,'confirm-api-change');const beforeClose=requests.length;
      await close(page);await ready(page);await page.waitForLoadState('networkidle');await bounded(Promise.all([...pending]));
      assert.equal(await page.getByTestId('fetch-generation').innerText(),'2');
      assert.equal(dialogs.confirmations.length,confirmations+2);assert.equal(dialogs.confirmations.at(-1).disposition,'accept');
      assert.equal(await modal(page).evaluate(element=>element.matches(':modal')),true,'stale_close_must_not_close_new_client_panel');
      assert.deepEqual(requests.slice(beforeClose).map(request=>({method:request.method,fetchGeneration:request.fetchGeneration})),[{method:'GET',fetchGeneration:2}]);
      assert.equal(await panel(page).getByLabel('负责人核准理由',{exact:true}).inputValue(),'');
      assert.equal(data.fingerprint(),baseline);assert.equal(posts(),7);assert.deepEqual(data.counts(),{streams:1,operations:5});
    });
    assert.deepEqual(errors,[]);assert.equal(serviceCalls,requests.filter(request=>request.delivered).length);
    assert.equal(checks,8);assert.equal(posts(),7);assert.deepEqual(data.counts(),{streams:1,operations:5});
    return {checks,apiRequests:requests.length,posts:posts(),...data.counts(),externalRequests:0,productionAccess:false,realAuth:false,
      fullAdminE2E:false,actualHandlerServiceSql:true,syntheticOnly:true,oldFactsUnchanged:true,callerOwnedNamespaceCleanup:true};
  }finally{
    closing=true;for(const gate of gates)gate.release.resolve();
    await runAttendanceCleanupSteps([
      {name:'personal-rules-browser',run:async()=>{await browser?.close();}},
      {name:'personal-rules-intercepted-requests',run:async()=>{await Promise.allSettled([...pending]);}},
      {name:'personal-rules-loopback',run:async()=>{if(server.listening){server.closeAllConnections();await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}}},
    ]);
  }
}
