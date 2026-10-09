// Real read-only Launcher/Panel/Client -> handler/service/parser -> actual130.
// Auth, flags and lifecycle/failure injection are explicitly synthetic. Import
// is inert: caller alone owns the PG namespace and starts/stops the database.
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
import {prepareGroupsNativeFixture,groupsQueryInput,groupsNativeSave,groupsNativeAssign} from './merchant-attendance-groups-native.mjs';
import {rulesMigrationPlan,rulesQueryInput,rulesNativeSave,rulesNativePublish} from './merchant-attendance-rules-native.mjs';
import {personalRulesMigrationPlan,personalRulesQueryInput,personalRulesNativeApprove,personalRulesNativeWithdraw} from './merchant-attendance-personal-rules-native.mjs';
import {ruleSourcesMigrationPlan} from './merchant-attendance-rule-sources-native.mjs';
import {lifecycleId as id,lifecycleJson as json} from './merchant-attendance-lifecycle-native-support.mjs';
import {runAttendanceCleanupSteps} from './fixtures/attendance-cleanup.mjs';

const root=fileURLToPath(new URL('../',import.meta.url)),require=createRequire(import.meta.url);
const endpoint='/api/merchant-enterprise/attendance/rule-sources',canonical='https://www.faolla.com';
const siteId='99990001',ownerId=id(99),workerId=id(201),secondWorker=id(202),groupId=id(7001);
const literalEvidence='<img src=x onerror=alert(1)> literal evidence',unrelatedKey='qa-rule-sources-preserve';
const quote=value=>"'"+String(value).replaceAll("'","''")+"'";
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
async function bounded(promise){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('rule_sources_browser_timeout')),15000);})]);}finally{clearTimeout(timer);}}

async function assets(){
  const bundle=await build({absWorkingDir:root,entryPoints:['scripts/fixtures/attendance-rule-sources-browser.tsx'],bundle:true,write:false,metafile:true,
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

// Minimal real writer setup only. Do not invoke147's native acceptance, its26
// drafts, concurrency race or100-row cap fixture from this page acceptance.
async function prepare(native,scope){
  const foundation=await prepareGroupsNativeFixture(native,scope),{exec,owned}=foundation;
  for(const migration of [rulesMigrationPlan,personalRulesMigrationPlan,ruleSourcesMigrationPlan])exec(migration(native.root,scope).body);
  const tables=JSON.parse(exec(`select jsonb_agg(relname order by relname) from pg_class where relnamespace=${owned.oid} and relkind in('r','p');`));
  const changed=new Set(['merchant_attendance_groups','merchant_attendance_group_operations','merchant_attendance_group_assignments','merchant_attendance_group_assignment_operations',
    'merchant_attendance_rule_streams','merchant_attendance_rule_operations','merchant_attendance_personal_rule_streams','merchant_attendance_personal_rule_operations']);
  const hash=selected=>`(select md5(jsonb_build_object(${selected.map(table=>`${quote(table)},(select coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),'[]'::jsonb) from public.${table} r)`).join(',')})::text))`;
  const fp=hash(tables),protectedFp=hash(tables.filter(table=>!changed.has(table))),protectedBefore=exec(`select ${protectedFp};`);
  for(const table of changed)assert.equal(exec(`select count(*) from public.${table};`),'0','rule_sources_browser_requires_empty_candidate_ledgers');
  const today=exec("select (clock_timestamp() at time zone 'UTC')::date::text;"),day=n=>new Date(Date.parse(today+'T00:00:00.000Z')+n*86400000).toISOString().slice(0,10);
  foundation.call(groupsQueryInput(),groupsNativeSave(7001,{name:literalEvidence}),true);
  foundation.call(groupsQueryInput({groupId,workerId}),groupsNativeAssign(7101,groupId,workerId,{startsOn:day(2),endsOn:day(6)}),true);
  const write=(rpc,query,command)=>JSON.parse(exec(`set local role service_role;select public.${rpc}(${json(query)},'${ownerId}',${json(command)},true);`));
  const enterprise={lateGraceMinutes:{mode:'value',minutes:12},earlyGraceMinutes:{mode:'value',minutes:3},openSpanWarningMinutes:{mode:'value',minutes:120},completedBreakMinimumMinutes:{mode:'disabled'}};
  const group={lateGraceMinutes:{mode:'value',minutes:7},earlyGraceMinutes:{mode:'disabled'},openSpanWarningMinutes:{mode:'inherit'},completedBreakMinimumMinutes:{mode:'value',minutes:1}};
  for(const [target,start,rules] of [[null,7501,enterprise],[groupId,7701,group]]){
    const patch={expectedGroupRevision:target===null?null:1};
    write('faolla_attendance_rules_v1',rulesQueryInput({groupId:target}),rulesNativeSave(start,0,{...patch,rules}));
    write('faolla_attendance_rules_v1',rulesQueryInput({groupId:target}),rulesNativePublish(start+1,1,day(2),patch));
  }
  const personal={lateGraceMinutes:{mode:'value',minutes:0},earlyGraceMinutes:{mode:'inherit'},openSpanWarningMinutes:{mode:'inherit'},completedBreakMinimumMinutes:{mode:'inherit'}};
  write('faolla_attendance_personal_rules_v1',personalRulesQueryInput(),personalRulesNativeApprove(8001,0,day(2),day(2),{rules:personal,reason:'Withdrawn synthetic approval'}));
  write('faolla_attendance_personal_rules_v1',personalRulesQueryInput(),personalRulesNativeWithdraw(8002,1,1));
  write('faolla_attendance_personal_rules_v1',personalRulesQueryInput(),personalRulesNativeApprove(8003,2,day(2),day(2),{rules:personal,reason:literalEvidence}));
  assert.equal(exec(`select ${protectedFp};`),protectedBefore,'minimal_rule_setup_changed_old_business_facts');
  const fingerprint=()=>exec(`select ${fp};`),baseline=fingerprint();let reads=0;
  const readRaw=(query,actor)=>{const before=fingerprint();try{reads++;return JSON.parse(exec(`set local role service_role;select public.faolla_attendance_rule_sources_v1(${json(query)},'${actor}');`));}
    finally{assert.equal(fingerprint(),before,'rule_sources_browser_RPC_changed_facts');}};
  return {day,readRaw,fingerprint,baseline,reads:()=>reads};
}

export async function checkAttendanceRuleSourcesBrowser(native,scope){
  const [adminSource,launcherSource]=await Promise.all(['src/components/enterprise/MerchantAttendanceAdminPanel.tsx',
    'src/components/enterprise/MerchantAttendanceRuleSourcesLauncher.tsx'].map(filename=>readFile(path.join(root,filename),'utf8')));
  const integration=adminSource.match(/<RuleSourcesLauncher\b[\s\S]*?\/>/g);assert.equal(integration?.length,1,'rule_sources_launcher_integration_count');
  const entry=integration[0];assert(entry.includes('key={`rule-sources:${state.authorizationEpoch}`}'));
  assert(entry.includes('siteId={siteId} ownerId={ownerId} workerId={item.id} apiFetch={apiFetch}'));
  assert(entry.includes('active={!busy && !state.pending && !editor && state.phase === "ready" && !exceptionOpen && !correctionReviewOpen && !correctionControlsOpen && !revisionApprovalOpen && !(timesheetEnabled && timesheetOpen)}'));
  assert(!/\benabled\s*=/.test(entry),'rule_sources_parent_must_not_override_default_flag');
  assert(launcherSource.includes('process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_RULE_SOURCES_ENABLED === "1"'));assert(launcherSource.includes('.showModal()'));
  const data=await prepare(native,scope),{day}=data;
  const {handleRuleSources}=require('../src/app/api/merchant-enterprise/attendance/rule-sources/route-handler.ts');
  const {executeRuleSources}=require('../src/lib/merchantAttendanceRuleSources.server.ts');
  const {parseRuleSourcesQuery,RULE_SOURCES_ERRORS}=require('../src/lib/merchantAttendanceRuleSources.ts');
  const {MerchantEnterpriseAccessError}=require('../src/lib/merchantEnterpriseAuth.server.ts');
  const files=await assets(),requests=[],errors=[],gates=new Set(),pending=new Set();
  let browser,origin,closing=false,moduleEnabled=true,authMode='owner',hold=null,checks=0,serviceCalls=0;
  const service={rpc:async(name,args)=>{
    assert.equal(name,'faolla_attendance_rule_sources_v1');assert.deepEqual(Object.keys(args).sort(),['p_auth_user_id','p_query']);
    const query=parseRuleSourcesQuery(args.p_query);assert.equal(query.siteId,siteId);assert([workerId,secondWorker].includes(query.workerId));
    assert([ownerId,id(98)].includes(args.p_auth_user_id));serviceCalls++;
    try{return {data:data.readRaw(query,args.p_auth_user_id),error:null};}
    catch(error){const code=String(error).match(/ERROR:\s+(?:[0-9A-Z]{5}:\s+)?([a-z_]+)(?=\r?\n|$)/)?.[1];if(!Object.hasOwn(RULE_SOURCES_ERRORS,code??''))throw error;return {data:null,error:{message:code}};}
  }};
  const dependencies=actor=>({enabled:()=>true,authenticate:async()=>{
    if(authMode==='unauthenticated')throw new MerchantEnterpriseAccessError('unauthorized',401);
    return {user:{id:authMode==='wrong-owner'?id(98):actor},authenticationMethods:['password']};
  },allow:()=>true,entitlement:async requestedSite=>{assert.equal(requestedSite,siteId);return {permissionConfig:{allowEnterpriseManagement:true,allowEmployeeAttendance:moduleEnabled}};},execute:input=>executeRuleSources(input,service)});
  const server=createServer((request,response)=>{
    if(!origin||request.headers.host!==new URL(origin).host||request.method!=='GET')return response.writeHead(403).end();
    response.setHeader('Cache-Control','no-store');response.setHeader('X-Content-Type-Options','nosniff');
    response.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'");
    const url=new URL(request.url??'/',origin);if(url.search)return response.writeHead(403).end();
    if(url.pathname==='/')return response.writeHead(200,{'Content-Type':'text/html;charset=utf-8'}).end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>隔离三层规则只读验收</title><link rel="stylesheet" href="/qa.css"><div id="qa-root"></div><script type="module" src="/qa.js"></script></html>');
    if(url.pathname==='/qa.js')return response.writeHead(200,{'Content-Type':'text/javascript;charset=utf-8'}).end(files.javascript);
    if(url.pathname==='/qa.css')return response.writeHead(200,{'Content-Type':'text/css;charset=utf-8'}).end(files.css);
    return response.writeHead(403).end();
  });
  const gateNext=()=>{assert.equal(hold,null);const gate={ready:deferred(),release:deferred(),finished:deferred()};gates.add(gate);hold=gate;return gate;};
  const force=(page,testId)=>page.getByTestId(testId).evaluate(element=>element.click());
  const select=(page,testId,value)=>page.getByTestId(testId).evaluate((element,value)=>{element.value=value;element.dispatchEvent(new Event('change',{bubbles:true}));},value);
  const panel=page=>page.getByRole('region',{name:'单员工三层规则只读预览',exact:true});
  const modal=page=>page.getByRole('dialog',{name:'三层规则只读预览（未应用）',exact:true});
  const result=page=>panel(page).locator('[data-rule-sources-result]');
  const candidate=page=>panel(page).getByRole('region',{name:'三层候选规则解析（未应用）',exact:true});
  const segments=page=>candidate(page).locator('[data-three-layer-segment]');
  const from=page=>panel(page).getByLabel('规则预览开始日期',{exact:true});
  const through=page=>panel(page).getByLabel('规则预览结束日期',{exact:true});
  const submit=page=>panel(page).getByRole('button',{name:'读取三层规则来源',exact:true});
  const close=page=>panel(page).getByRole('button',{name:'关闭三层规则预览',exact:true}).click();
  const open=async page=>{await page.getByRole('button',{name:'三层规则预览（未应用）',exact:true}).click();await from(page).waitFor();};
  const enable=page=>page.getByTestId('enable').click();
  const fill=async(page,start=day(2),end=day(4))=>{await from(page).fill(start);await through(page).fill(end);};
  const read=async(page,start=day(2),end=day(4))=>{await fill(page,start,end);await submit(page).click();await result(page).waitFor();};
  const cleared=async page=>{assert.equal(await result(page).count(),0);assert.equal(await candidate(page).count(),0);};
  const noAutoRead=async(page,count)=>{await page.waitForLoadState('networkidle');await bounded(Promise.all([...pending]));assert.equal(requests.length,count,'unexpected_automatic_rule_sources_read');};
  const verifyResolution=async(page,personal=true)=>{
    assert.equal(await segments(page).count(),personal?2:1);const all=await segments(page).all();
    for(let index=0;index<all.length;index++){
      const segment=all[index];assert.equal(await segment.getAttribute('data-rule-status'),'candidate');
      const isPersonal=personal&&index===0;
      const expected={lateGraceMinutes:['value',isPersonal?'personal':'group',isPersonal?0:7],earlyGraceMinutes:['disabled','group',null],
        openSpanWarningMinutes:['value','enterprise',120],completedBreakMinimumMinutes:['value','group',1]};
      assert.equal(await segment.locator('[data-rule-field]').count(),4);
      for(const [key,[state,layer,minutes]] of Object.entries(expected)){
        const field=segment.locator(`[data-rule-field="${key}"]`);assert.equal(await field.getAttribute('data-rule-state'),state);assert.equal(await field.getAttribute('data-rule-layer'),layer);
        if(minutes!==null)assert.match(await field.innerText(),new RegExp(`(?:^|\\D)${minutes}\\s*分钟`));
      }
    }
    const text=await candidate(page).innerText();assert(text.includes('未应用'));assert(text.includes('正式'));
  };

  try{
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    const address=server.address();assert(address&&typeof address==='object');origin=`http://127.0.0.1:${address.port}`;
    browser=await chromium.launch({headless:true});
    const run=async(name,check,width=1280)=>{
      moduleEnabled=true;authMode='owner';const context=await browser.newContext({serviceWorkers:'block',acceptDownloads:false,viewport:{width,height:1100}});
      try{
        await context.addInitScript(key=>{
          sessionStorage.setItem(key,'preserve');const probe={csp:[],storageWrites:[]};Object.defineProperty(window,'__ruleSourcesBrowserProbe',{value:probe});
          for(const method of ['setItem','removeItem','clear']){
            const original=Storage.prototype[method];Storage.prototype[method]=function(...args){probe.storageWrites.push([this===localStorage?'local':'session',method,...args]);return original.apply(this,args);};
          }
          document.addEventListener('securitypolicyviolation',event=>probe.csp.push(event.violatedDirective));
        },unrelatedKey);
        await context.route('**/*',route=>{
          if(closing)return route.abort().catch(()=>{});
          const work=(async()=>{
            const request=route.request(),url=new URL(request.url());assert.equal(url.origin,origin,'external_request_blocked');
            if(['/', '/qa.js','/qa.css'].includes(url.pathname)){assert.equal(request.method(),'GET');assert.equal(url.search,'');return route.continue();}
            assert.equal(url.pathname,endpoint);assert.equal(request.method(),'GET');assert.equal(request.postData(),null);assert(requests.length<60,'rule_sources_request_budget_exceeded');
            const actor=request.headers()['x-qa-owner'];assert([ownerId,id(98)].includes(actor));
            const fetchGeneration=Number(request.headers()['x-qa-fetch-generation']);assert(Number.isSafeInteger(fetchGeneration)&&fetchGeneration>=0&&fetchGeneration<=3);
            const headers=new Headers({'Host':'www.faolla.com','Origin':canonical});
            const response=await handleRuleSources(new Request(canonical+endpoint+url.search,{headers}),dependencies(actor));
            const body=await response.text(),parsed=JSON.parse(body);assert.equal(response.headers.get('Cache-Control'),'private, no-store');
            requests.push({method:'GET',search:url.search,status:response.status,body:parsed,fetchGeneration});
            const gate=hold;if(gate){hold=null;gate.ready.resolve(parsed);await gate.release.promise;}
            try{await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body});}
            catch(error){if(!gate&&!closing)throw error;}
            finally{if(gate){gate.finished.resolve();gates.delete(gate);}}
          })();pending.add(work);void work.finally(()=>pending.delete(work)).catch(()=>{});
          return work.catch(async error=>{if(!closing)errors.push(error instanceof Error?error.message:'route_failed');await route.abort().catch(()=>{});});
        });
        const page=await context.newPage();page.setDefaultTimeout(10000);
        page.on('pageerror',error=>errors.push(error.message));page.on('download',()=>errors.push('unexpected_download'));page.on('popup',()=>errors.push('unexpected_popup'));
        page.on('dialog',dialog=>{errors.push('unexpected_native_dialog');void dialog.dismiss().catch(()=>{});});
        await page.goto(origin);await page.getByTestId('enable').waitFor();
        try{await check(page);}catch(error){error.message=`${name}: ${error.message}`;throw error;}
        assert.deepEqual(await page.evaluate(()=>window.__ruleSourcesBrowserProbe),{csp:[],storageWrites:[]});
        assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),unrelatedKey),'preserve');
        assert.equal(data.fingerprint(),data.baseline,'rule_sources_page_changed_facts');checks++;native.pass(name);
      }finally{for(const gate of gates)gate.release.resolve();await context.close();}
    };

    await run('rule sources browser default-off, closed and empty-date opening perform zero reads',async page=>{
      assert.equal(requests.length,0);assert.equal(await panel(page).count(),0);
      assert.equal(await page.getByRole('button',{name:'三层规则预览（未应用）',exact:true}).count(),0);
      await enable(page);assert.equal(requests.length,0);await open(page);
      assert.equal(await from(page).inputValue(),'');assert.equal(await through(page).inputValue(),'');await cleared(page);
      await noAutoRead(page,0);await close(page);assert.equal(await modal(page).count(),0);await noAutoRead(page,0);
    });

    await run('rule sources desktop real SQL shows personal zero, disabled and enterprise fallback; personal end restores group and escaped source text',async page=>{
      await enable(page);await open(page);await read(page);await verifyResolution(page);
      const response=requests.at(-1);assert.equal(response.status,200);assert.equal(response.body.data.personal.revision,3);
      assert.deepEqual(response.body.data.personal.items.map(pair=>[pair.approval.revision,pair.withdrawal?.revision??null]),[[1,2],[3,null]]);
      assert.equal(response.body.data.assignments.items.length,1);assert.equal(response.body.data.rules.items.length,2);
      for(const detail of await result(page).locator('details').all())if(!await detail.evaluate(element=>element.open))await detail.locator('summary').click();
      assert((await result(page).innerText()).includes(literalEvidence));assert.equal(await result(page).locator('img,script,iframe,svg').count(),0);
      assert.equal(await result(page).locator('[data-personal-rule-source="approve"]').count(),2);
      assert.equal(await result(page).locator('[data-personal-rule-source="withdraw"]').count(),1);
      assert.equal(await result(page).locator('[data-rule-assignment-source]').count(),1);
      assert.equal(await result(page).locator('[data-rule-publication-source]').count(),2);
      const before=requests.length;const paging=candidate(page).getByRole('navigation',{name:'三层规则时间段分页',exact:true});
      // The minimal SQL fixture has two segments, fitting one bounded local
      // page. Cross-page behavior belongs to the separate component tests;
      // do not invent extra SQL history just to inflate this page acceptance.
      assert.equal(await paging.count(),0);assert((await segments(page).count())<=10);
      assert((await candidate(page).innerText()).includes('每页最多 10 段'));
      assert.equal(await modal(page).evaluate(element=>element.matches(':modal')),true);
      await assert.rejects(page.getByTestId('unmount').click({timeout:500}),/Timeout|intercepts pointer events/);
      await page.keyboard.press('Escape');await panel(page).waitFor({state:'detached'});await noAutoRead(page,before);
      await open(page);await cleared(page);assert.equal(await from(page).inputValue(),'');await noAutoRead(page,before);
    });

    await run('rule sources390px layout and edited dates clear all old evidence before an explicit narrower read',async page=>{
      await enable(page);await open(page);await read(page);await verifyResolution(page);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'rule_sources_document_overflow');
      assert.equal(await modal(page).evaluate(element=>element.scrollWidth<=element.clientWidth+1),true,'rule_sources_modal_overflow');
      assert.equal(await page.locator('form form').count(),0);const before=requests.length;
      await from(page).fill(day(3));await cleared(page);await noAutoRead(page,before);
      await submit(page).click();await result(page).waitFor();await verifyResolution(page,false);
      assert.equal(requests.at(-1).body.data.fromDate,day(3));assert.deepEqual(requests.at(-1).body.data.personal.items,[]);
      const after=requests.length;await through(page).fill('');await cleared(page);await noAutoRead(page,after);
    },390);

    await run('rule sources paused module remains explicit GET-only and401/403 erase prior rendered evidence',async page=>{
      await enable(page);await open(page);moduleEnabled=false;await read(page);await verifyResolution(page);
      assert.equal(requests.at(-1).body.moduleEnabled,false);const before=requests.length,calls=serviceCalls;
      authMode='unauthenticated';await submit(page).click();await panel(page).getByRole('status').filter({hasText:'旧内容已隐藏'}).waitFor();await cleared(page);
      assert.equal(requests.length,before+1);assert.equal(requests.at(-1).status,401);assert.equal(serviceCalls,calls);
      authMode='owner';await submit(page).click();await result(page).waitFor();authMode='wrong-owner';await submit(page).click();
      await panel(page).getByRole('status').filter({hasText:'旧规则来源已隐藏'}).waitFor();await cleared(page);
      assert.equal(requests.at(-1).status,403);assert.equal(requests.at(-1).body.error,'attendance_access_denied');
      await noAutoRead(page,requests.length);
    });

    await run('rule sources held headers cannot restore evidence after hidden or pagehide; visibility return never auto-reads',async page=>{
      await enable(page);await open(page);
      for(const [leave,enter] of [['hide','show'],['pagehide','pageshow']]){
        await fill(page);const gate=gateNext();await submit(page).click();await bounded(gate.ready.promise);const count=requests.length;
        await force(page,leave);await cleared(page);assert.equal(await from(page).inputValue(),'');assert.equal(await through(page).inputValue(),'');
        gate.release.resolve();await bounded(gate.finished.promise);await force(page,enter);await cleared(page);await noAutoRead(page,count);
      }
      await read(page);await verifyResolution(page);
    });

    await run('rule sources late header response cannot cross worker owner site epoch active or unmount boundaries',async page=>{
      await enable(page);
      const cases=[
        {change:()=>select(page,'worker',secondWorker),restore:()=>select(page,'worker',workerId)},
        {change:()=>select(page,'owner',id(98)),restore:()=>select(page,'owner',ownerId)},
        {change:()=>select(page,'site','99990002'),restore:()=>select(page,'site',siteId)},
        {change:()=>force(page,'epoch'),restore:async()=>{}},
        {change:()=>force(page,'deactivate'),restore:()=>force(page,'activate')},
        {change:()=>force(page,'unmount'),restore:()=>force(page,'mount')},
      ];
      for(const item of cases){
        await open(page);await fill(page);const gate=gateNext();await submit(page).click();await bounded(gate.ready.promise);const count=requests.length;
        await item.change();gate.release.resolve();await bounded(gate.finished.promise);await cleared(page);await noAutoRead(page,count);
        await item.restore();assert.equal(await panel(page).count(),0);await noAutoRead(page,count);
      }
      await select(page,'worker',secondWorker);await open(page);await read(page);
      assert.equal(requests.at(-1).body.data.worker.workerId,secondWorker);assert.equal(requests.at(-1).body.data.personal.revision,0);
      assert.equal(await result(page).getByText(literalEvidence,{exact:true}).count(),0);
    });

    await run('rule sources delayed actual response body cannot survive apiFetch replacement or hidden lifetime',async page=>{
      await enable(page);await open(page);
      for(const action of ['api-change','hide']){
        await fill(page);await force(page,'arm-body');await submit(page).click();await page.getByTestId('body-phase').filter({hasText:'held'}).waitFor();
        const count=requests.length;await force(page,action);await cleared(page);await force(page,'release-body');
        if(action==='hide')await force(page,'show');await noAutoRead(page,count);await cleared(page);
        if(await panel(page).count()===0)await open(page);assert.equal(await from(page).inputValue(),'');assert.equal(await through(page).inputValue(),'');
      }
      await read(page);await verifyResolution(page);assert.equal(requests.at(-1).fetchGeneration,1);
    });

    assert.equal(checks,7);assert.deepEqual(errors,[]);assert(requests.every(request=>request.method==='GET'));assert.equal(serviceCalls,data.reads());
    assert.equal(data.fingerprint(),data.baseline);
    return {checks,apiRequests:requests.length,gets:requests.length,posts:0,sourceReads:data.reads(),seededGroups:1,seededAssignments:1,seededRulePublications:2,seededPersonalOperations:3,
      externalRequests:0,productionAccess:false,realAuth:false,fullAdminE2E:false,actualHandlerServiceSql:true,syntheticOnly:true,oldFactsUnchanged:true,
      allReadFingerprintsUnchanged:true,callerOwnedNamespaceCleanup:true};
  }finally{
    closing=true;for(const gate of gates)gate.release.resolve();
    await runAttendanceCleanupSteps([
      {name:'rule-sources-browser',run:async()=>{await browser?.close();}},
      {name:'rule-sources-intercepted-requests',run:async()=>{await Promise.allSettled([...pending]);}},
      {name:'rule-sources-loopback',run:async()=>{if(server.listening){server.closeAllConnections();await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}}},
    ]);
  }
}
