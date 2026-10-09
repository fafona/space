// Real SourcesLauncher/Panel/Client -> real handler/service/parser -> actual128.
// The caller prepares and owns the synthetic SQL namespace. Import starts no
// server/browser/database. Auth/entitlement are explicit synthetic test seams.
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
import {lifecycleId as id} from './merchant-attendance-lifecycle-native-support.mjs';
import {runAttendanceCleanupSteps} from './fixtures/attendance-cleanup.mjs';

const root=fileURLToPath(new URL('../',import.meta.url)),require=createRequire(import.meta.url);
const endpoint='/api/merchant-enterprise/attendance/sources',canonical='https://www.faolla.com';
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
async function bounded(promise){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('sources_browser_timeout')),15000);})]);}finally{clearTimeout(timer);}}

async function assets(){
  const bundle=await build({absWorkingDir:root,entryPoints:['scripts/fixtures/attendance-sources-browser.tsx'],bundle:true,write:false,metafile:true,
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

export async function checkAttendanceSourcesBrowser(native,scope,data,options={verifyCandidateRules:false,verifyScheduleEvidence:false}){
  const verifyCandidateRules=options.verifyCandidateRules??false;assert.equal(typeof verifyCandidateRules,'boolean');
  const verifyScheduleEvidence=options.verifyScheduleEvidence??false;assert.equal(typeof verifyScheduleEvidence,'boolean');
  assert.equal(data.syntheticOnly,true,'synthetic_fixture_required');assert.equal(data.sql,scope.sql,'caller_owned_scope_required');
  assert.equal(data.site,'99990001');assert.equal(data.owner,id(99));assert.equal(data.worker,id(201));
  const [adminSource,launcherSource]=await Promise.all([
    'src/components/enterprise/MerchantAttendanceAdminPanel.tsx','src/components/enterprise/MerchantAttendanceSourcesLauncher.tsx',
  ].map(filename=>readFile(path.join(root,filename),'utf8')));
  // This source assertion covers the old parent's additive epoch-keyed insertion,
  // not full end-to-end rendering of AdminPanel or the production auth system.
  assert.match(adminSource,/<SourcesLauncher key=\{`sources:\$\{state\.authorizationEpoch\}`\}/);
  assert(adminSource.includes('workerId={item.id} apiFetch={apiFetch}'));
  assert(launcherSource.includes('process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_SOURCES_ENABLED === "1"'));
  assert(launcherSource.includes('if (!enabled || !active) return null'));
  assert(launcherSource.includes('element.showModal()'));
  const {handleSources}=require('../src/app/api/merchant-enterprise/attendance/sources/route-handler.ts');
  const {executeSources}=require('../src/lib/merchantAttendanceSources.server.ts');
  const {parseSourcesQuery,SOURCES_ERRORS}=require('../src/lib/merchantAttendanceSources.ts');
  const baseline=data.protectedFingerprint(),files=await assets(),requests=[],errors=[],gates=new Set(),pending=new Set();
  let browser,origin,closing=false,moduleEnabled=true,hold=null,checks=0,serviceCalls=0,externalRequests=0;
  const service={rpc:async(name,args)=>{
    assert.equal(name,'faolla_attendance_sources_v1');assert.deepEqual(Object.keys(args).sort(),['p_auth_user_id','p_query']);
    assert.equal(args.p_auth_user_id,data.owner);const query=parseSourcesQuery(args.p_query);
    assert.equal(query.siteId,data.site);assert.equal(query.workerId,data.worker);serviceCalls++;
    try{return {data:data.readRaw(query,args.p_auth_user_id),error:null};}
    catch(error){const code=String(error).match(/ERROR:\s+([a-z_]+)(?=\r?\n|$)/)?.[1];if(!Object.hasOwn(SOURCES_ERRORS,code??''))throw error;return {data:null,error:{message:code}};}
  }};
  const dependencies={enabled:()=>true,authenticate:async()=>({user:{id:data.owner},authenticationMethods:['password']}),allow:()=>true,
    entitlement:async site=>{assert.equal(site,data.site);return {permissionConfig:{allowEnterpriseManagement:true,allowEmployeeAttendance:moduleEnabled}};},
    execute:input=>executeSources(input,service)};
  const server=createServer((request,response)=>{
    if(!origin||request.headers.host!==new URL(origin).host||request.method!=='GET')return response.writeHead(403).end();
    response.setHeader('Cache-Control','no-store');response.setHeader('X-Content-Type-Options','nosniff');
    response.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'");
    const url=new URL(request.url??'/',origin);if(url.search)return response.writeHead(403).end();
    if(url.pathname==='/')return response.writeHead(200,{'Content-Type':'text/html;charset=utf-8'}).end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>隔离员工资料核查验收</title><link rel="stylesheet" href="/qa.css"><div id="qa-root"></div><script type="module" src="/qa.js"></script></html>');
    if(url.pathname==='/qa.js')return response.writeHead(200,{'Content-Type':'text/javascript;charset=utf-8'}).end(files.javascript);
    if(url.pathname==='/qa.css')return response.writeHead(200,{'Content-Type':'text/css;charset=utf-8'}).end(files.css);
    return response.writeHead(403).end();
  });
  const gateNextRead=()=>{assert.equal(hold,null);const gate={ready:deferred(),release:deferred(),finished:deferred()};gates.add(gate);hold=gate;return gate;};
  const panel=page=>page.getByRole('region',{name:'单员工资料核查',exact:true});
  const modal=page=>page.getByRole('dialog',{name:'员工考勤资料核查',exact:true});
  const result=page=>panel(page).locator('[data-attendance-sources-result]');
  const region=(page,name)=>panel(page).getByRole('region',{name,exact:true});
  const candidateRegion=page=>region(page,'候选规则解析（未应用）');
  const scheduleRegion=page=>region(page,'排班与记录时间对照');
  const originalControls=async page=>assert.equal(await panel(page).getByRole('button').evaluateAll(elements=>
    elements.filter(element=>!element.closest('[data-schedule-evidence]')).length),2,'source_controls_outside_schedule_evidence');
  const candidateCleared=async(page,label)=>{
    if(verifyCandidateRules)assert.equal(await candidateRegion(page).count(),0,`${label}_left_candidate_rule_resolution`);
    if(verifyScheduleEvidence){
      assert.equal(await scheduleRegion(page).count(),0,`${label}_left_schedule_evidence`);
      assert.equal(await panel(page).locator('[data-schedule-evidence]').count(),0,`${label}_left_schedule_evidence_marker`);
    }
  };
  const scheduleEvidence=async page=>{
    if(!verifyScheduleEvidence)return;
    const child=scheduleRegion(page);await child.waitFor();assert.equal(await child.count(),1);
    assert.notEqual(await child.getAttribute('data-schedule-evidence'),null);assert.equal(await child.getByRole('alert').count(),0);
    const before=requests.length;
    for(const [name,kind] of [['当前核定记录','selected'],['原始记录','original']]){
      const tab=child.getByRole('tab',{name,exact:true});await tab.click();await settle(page);
      assert.equal(await tab.getAttribute('aria-selected'),'true');
      assert.equal(await child.locator(`[data-schedule-evidence-view="${kind}"]`).count(),1);
      assert.equal(await child.locator('[data-schedule-evidence-view]').count(),1);
      assert.equal(requests.length,before,'schedule_evidence_tab_made_request');assert.equal(await child.getByRole('alert').count(),0);
    }
  };
  const candidateRules=async(page,kind)=>{
    if(!verifyCandidateRules)return;
    const candidate=candidateRegion(page);await candidate.waitFor();
    assert.equal(await candidate.getAttribute('data-rule-resolution')!==null,true);
    assert((await candidate.innerText()).includes('个人例外尚未接入'));assert((await candidate.innerText()).includes('不作正式考勤判定'));
    const segments=candidate.locator('article[data-rule-segment]');assert.equal(await segments.count(),1);
    const segment=segments.first();assert.equal(await segment.getAttribute('data-rule-status'),'candidate');
    const definitions=require('../src/lib/merchantAttendanceRuleDraft.ts').RULE_DEFINITIONS;
    const expected={lateGraceMinutes:['value','group',0],earlyGraceMinutes:['disabled','group',null],openSpanWarningMinutes:['unconfigured','none',null],completedBreakMinimumMinutes:['value','group',1]};
    assert.equal(await segment.locator('[data-rule-field]').count(),4);
    for(const [key,[state,layer,minutes]] of Object.entries(expected)){
      const field=segment.locator(`[data-rule-field="${key}"]`);assert.equal(await field.count(),1);assert((await field.innerText()).includes(definitions[key].label));
      assert.equal(await field.getAttribute('data-rule-state'),kind==='past'?'unconfigured':state);
      assert.equal(await field.getAttribute('data-rule-layer'),kind==='past'?'none':layer);
      if(kind==='future'&&minutes!==null)assert.match(await field.innerText(),new RegExp(`(?:^|\\D)${minutes}\\s*分钟`));
    }
    for(const details of await candidate.locator('details').all())if(!await details.evaluate(element=>element.open))await details.locator('summary').click();
    const text=await candidate.innerText();assert(text.includes(id(7103)),'active_assignment_provenance_missing');assert(!text.includes(id(7101)),'cancelled_assignment_was_selected');
    if(kind==='future'){
      assert(text.includes(id(7702)),'selected_group_publication_missing');assert(text.includes(id(7502)),'enterprise_trace_publication_missing');assert(!text.includes(id(7504)),'withdrawn_publication_was_selected');
      const inherited=await segment.locator('[data-rule-field="openSpanWarningMinutes"]').innerText();
      assert(inherited.includes(id(7702))&&inherited.includes(id(7502)),'all_inherit_trace_lost_layer_provenance');
    }else{assert(!text.includes(id(7702))&&!text.includes(id(7502)),'future_publication_applied_to_past');}
  };
  const open=async page=>{await page.getByRole('button',{name:'资料核查（只读）',exact:true}).click();await panel(page).getByLabel('核查开始日期',{exact:true}).waitFor();};
  const enable=page=>page.getByRole('button',{name:'开启验收入口',exact:true}).click();
  const close=page=>panel(page).getByRole('button',{name:'关闭资料核查',exact:true}).click();
  const dates=async(page,query=data.queryInput())=>{
    await panel(page).getByLabel('核查开始日期',{exact:true}).fill(query.fromDate);
    await panel(page).getByLabel('核查结束日期',{exact:true}).fill(query.throughDate);
  };
  const submit=page=>panel(page).getByRole('button',{name:'读取核查资料',exact:true}).click();
  const read=async(page,query=data.queryInput())=>{
    await dates(page,query);await submit(page);await result(page).waitFor();assert.equal(requests.at(-1).status,200);await scheduleEvidence(page);
  };
  // Only these controls simulate external lifecycle changes behind the modal.
  // Ordinary parent clicks are tested separately and must remain blocked.
  const forceControl=(page,label)=>page.locator('.qa-controls button').filter({hasText:label}).evaluate(element=>element.click());
  const forceSelection=(page,label,value)=>page.locator(`.qa-controls select[aria-label="${label}"]`).evaluate((element,value)=>{
    element.value=value;element.dispatchEvent(new Event('change',{bubbles:true}));
  },value);
  const settle=page=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  try{
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    const address=server.address();assert(address&&typeof address==='object');origin=`http://127.0.0.1:${address.port}`;
    browser=await chromium.launch({headless:true});
    const run=async(name,check,width=1280)=>{
      moduleEnabled=true;const beforeReads=requests.length;
      const context=await browser.newContext({serviceWorkers:'block',acceptDownloads:false,viewport:{width,height:1000}});
      try{
        await context.addInitScript(()=>{
          const probe={csp:[],storageCalls:[]};Object.defineProperty(window,'__sourcesBrowserProbe',{value:probe});
          for(const name of ['getItem','setItem','removeItem','clear','key']){
            const original=Storage.prototype[name];Storage.prototype[name]=function(...args){probe.storageCalls.push(name);return original.apply(this,args);};
          }
          for(const name of ['open','deleteDatabase']){indexedDB[name]=function(){probe.storageCalls.push('indexedDB.'+name);throw Error('sources_storage_forbidden');};}
          document.addEventListener('securitypolicyviolation',event=>probe.csp.push(event.violatedDirective));
        });
        await context.route('**/*',route=>{
          if(closing)return route.abort().catch(()=>{});
          const work=(async()=>{
            const request=route.request(),url=new URL(request.url());
            if(url.origin!==origin){externalRequests++;throw Error('sources_external_request_blocked');}
            if(['/', '/qa.js','/qa.css'].includes(url.pathname)){assert.equal(request.method(),'GET');assert.equal(url.search,'');return route.continue();}
            assert.equal(url.pathname,endpoint,'unexpected_business_endpoint');assert.equal(request.method(),'GET','sources_write_request_forbidden');assert(requests.length<20,'sources_request_budget_exceeded');
            assert.equal(request.postData(),null,'sources_get_body_forbidden');
            const response=await handleSources(new Request(canonical+endpoint+url.search,{method:'GET',headers:{Host:'www.faolla.com',Origin:canonical,'Sec-Fetch-Site':'same-origin'}}),dependencies);
            const body=await response.text(),parsed=JSON.parse(body);assert.equal(response.headers.get('Cache-Control'),'private, no-store');
            requests.push({method:'GET',search:url.search,status:response.status,body:parsed});
            const gate=hold;if(gate){hold=null;gate.ready.resolve(parsed);await gate.release.promise;}
            try{await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body});}
            catch(error){if(!gate&&!closing)throw error;}
            finally{if(gate){gate.finished.resolve();gates.delete(gate);}}
          })();pending.add(work);void work.finally(()=>pending.delete(work)).catch(()=>{});
          return work.catch(async error=>{if(!closing)errors.push(`route_failed:${String(error.message).slice(0,200)}`);await route.abort().catch(()=>{});});
        });
        const page=await context.newPage();page.setDefaultTimeout(10000);
        page.on('pageerror',error=>errors.push(error.message));page.on('download',()=>errors.push('unexpected_download'));page.on('popup',()=>errors.push('unexpected_popup'));
        page.on('dialog',dialog=>{errors.push('unexpected_dialog');void dialog.dismiss().catch(()=>{});});
        await page.goto(origin);await page.getByRole('button',{name:'开启验收入口',exact:true}).waitFor();
        try{await check(page,beforeReads);}catch(error){error.message=`${name}: ${error.message}`;throw error;}
        assert.deepEqual(await page.evaluate(()=>window.__sourcesBrowserProbe),{csp:[],storageCalls:[]});
        assert.equal(await page.locator('form form').count(),0);assert.equal(data.protectedFingerprint(),baseline,'sources_browser_changed_any_table');
        assert.deepEqual(errors,[]);checks++;native.pass(name);
      }finally{for(const gate of gates)gate.release.resolve();await context.close();}
    };

    await run('sources browser default-off closed open and filled dates require an explicit read, with zero automatic requests',async(page,start)=>{
      assert.equal(await panel(page).count(),0);assert.equal(await page.getByRole('button',{name:'资料核查（只读）',exact:true}).count(),0);
      assert.equal(requests.length,start);await enable(page);assert.equal(requests.length,start);await open(page);
      assert.equal(await panel(page).getByRole('button',{name:'读取核查资料',exact:true}).isDisabled(),true);
      await dates(page);await settle(page);assert.equal(requests.length,start);assert.equal(await result(page).count(),0);
      await candidateCleared(page,'before_explicit_read');
      await close(page);assert.equal(await modal(page).count(),0);assert.equal(requests.length,start);
    });
    await run('sources browser actual past SQL preserves original latest correction whole-missing and ongoing evidence separately',async(page,start)=>{
      await enable(page);await open(page);await read(page);assert.equal(requests.length,start+1);
      const evidence=region(page,'打卡与核定来源');assert.equal(await evidence.getByRole('article').count(),4);
      const corrected=evidence.getByRole('article').filter({hasText:id(8101)});
      assert.match(await corrected.innerText(),/原始打卡 \+ 已批准补正/);assert.match(await corrected.innerText(),/当前核定/);
      assert((await corrected.innerText()).includes(id(8113)));assert((await corrected.innerText()).includes(data.at(-1,'02:00').replace('.000Z','.000000Z')));
      assert((await corrected.innerText()).includes(data.at(-1,'03:30').replace('.000Z','.000000Z')));assert(!(await corrected.innerText()).includes(id(8111)));
      const missing=evidence.getByRole('article').filter({hasText:id(8203)});
      assert.match(await missing.innerText(),/已批准整段漏卡申报（不是原始打卡）/);assert((await missing.innerText()).includes(id(8204)));
      assert(!(await evidence.innerText()).includes(id(8201)));
      assert.match(await evidence.getByRole('article').filter({hasText:id(8105)}).innerText(),/班次未结束/);
      assert((await evidence.innerText()).includes('未结束班次不折算为零工时'));
      assert.equal(requests.at(-1).body.data.attendance.base.items.length,3);assert.equal(requests.at(-1).body.data.attendance.missing.length,1);
      assert((await region(page,'资料边界').innerText()).includes('不是已封存的历史计算版本'));
      await candidateRules(page,'past');
    });
    await run('sources browser future UTC carry-in cancelled leave group history and unapplied rule publications use separate semantic regions',async(page,start)=>{
      await enable(page);await open(page);await read(page,data.futureQuery);assert.equal(requests.length,start+1);
      const plans=region(page,'排班来源');assert.equal(await plans.getByRole('article').count(),2);
      assert((await plans.innerText()).includes(data.at(2,'22:00')));assert((await plans.innerText()).includes(data.at(3,'06:00')));
      assert((await plans.innerText()).includes('已取消排班'));assert((await plans.innerText()).includes('已发布排班'));
      const leave=region(page,'请假来源');assert.equal(await leave.getByRole('article').count(),2);
      const cancelled=leave.getByRole('article').filter({hasText:id(7301)});assert.match(await cancelled.innerText(),/已取消/);
      assert((await cancelled.innerText()).includes(id(7303)));assert((await cancelled.innerText()).includes(data.at(5,'16:00')));
      const groups=region(page,'归组来源');assert.equal(await groups.getByRole('article').count(),2);assert((await groups.innerText()).includes('不代替原归组快照'));
      const rules=region(page,'候选规则来源（未应用）');assert.equal(await rules.getByRole('article').count(),2);
      assert((await rules.innerText()).includes('账本版本 35'));
      for(const details of await rules.locator('details').all())await details.locator('summary').click();
      assert((await rules.innerText()).includes(id(7502)));assert((await rules.innerText()).includes(id(7702)));assert(!(await rules.innerText()).includes(id(7504)));
      const hints=region(page,'日历提示来源');assert.equal(await hints.getByRole('article').count(),2);
      assert((await hints.innerText()).includes('不自动免除排班或异常'));
      assert((await region(page,'资料边界').innerText()).includes('候选规则尚未应用，不能据此判定迟到、早退或缺勤'));
      await originalControls(page);
      await candidateRules(page,'future');
    });
    await run('sources browser 390px modal blocks parent controls, date edits clear immediately, over-seven-day input stays local, Escape closes',async(page,start)=>{
      await enable(page);await open(page);await read(page,data.futureQuery);assert.equal(requests.length,start+1);
      await candidateRules(page,'future');
      for(const details of await panel(page).locator('details').all())if(!verifyCandidateRules||!await details.evaluate(element=>element.open))await details.locator('summary').click();
      assert.equal(await modal(page).evaluate(element=>element.matches(':modal')),true);
      await assert.rejects(page.locator('.qa-controls button').filter({hasText:'卸载验收资料'}).click({timeout:600}),/Timeout|intercepts pointer events/);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'document_horizontal_overflow');
      assert.equal(await modal(page).evaluate(element=>element.scrollWidth<=element.clientWidth+1&&element.getBoundingClientRect().width<=innerWidth),true,'modal_horizontal_overflow');
      await panel(page).getByLabel('核查结束日期',{exact:true}).fill(data.futureQuery.fromDate);
      assert.equal(await result(page).count(),0,'date_edit_left_stale_result');assert.equal(requests.length,start+1);
      await candidateCleared(page,'date_edit');
      await dates(page,{...data.queryInput(),throughDate:data.day(5)});await submit(page);
      await panel(page).getByRole('alert').waitFor();assert((await panel(page).getByRole('alert').innerText()).includes('最多 7 个当地日期'));
      assert.equal(await result(page).count(),0);assert.equal(requests.length,start+1,'invalid_range_made_get');
      await page.keyboard.press('Escape');await modal(page).waitFor({state:'detached'});assert.equal(requests.length,start+1);
      await open(page);assert.equal(await panel(page).getByLabel('核查开始日期',{exact:true}).inputValue(),'');
      assert.equal(await result(page).count(),0);assert.equal(requests.length,start+1,'reopen_must_not_auto_read');
      await candidateCleared(page,'reopen');
    },390);
    await run('sources browser held GET cannot resurrect hidden pagehide unmounted old-owner old-worker or old-epoch evidence',async(page,start)=>{
      await enable(page);
      const changes=[
        {label:'hidden',change:()=>forceControl(page,'隐藏验收文档'),restore:()=>forceControl(page,'显示验收文档'),keepsPanel:true},
        {label:'pagehide',change:()=>forceControl(page,'触发验收 pagehide'),restore:()=>forceControl(page,'显示验收文档'),keepsPanel:true},
        {label:'unmount',change:()=>forceControl(page,'卸载验收资料'),restore:()=>forceControl(page,'重挂验收资料')},
        {label:'owner',change:()=>forceSelection(page,'验收身份',id(98)),restore:()=>forceSelection(page,'验收身份',data.owner)},
        {label:'worker',change:()=>forceSelection(page,'验收员工',id(202)),restore:()=>forceSelection(page,'验收员工',data.worker)},
        {label:'epoch',change:()=>forceControl(page,'递增验收授权代次'),restore:async()=>{}},
      ];
      for(const change of changes){
        await open(page);const before=requests.length,gate=gateNextRead();await dates(page);await submit(page);
        const payload=await bounded(gate.ready.promise);assert.equal(payload.ok,true);assert.equal(requests.length,before+1);
        await change.change();assert.equal(await result(page).count(),0,`${change.label}_failed_to_clear_synchronously`);
        await candidateCleared(page,`${change.label}_synchronous_clear`);
        gate.release.resolve();await bounded(gate.finished.promise);await settle(page);
        assert.equal(await result(page).count(),0,`${change.label}_late_response_resurrected`);
        await candidateCleared(page,`${change.label}_late_response`);
        if(change.keepsPanel){
          assert.equal(await panel(page).getByLabel('核查开始日期',{exact:true}).inputValue(),'');
          assert.equal(await panel(page).getByLabel('核查结束日期',{exact:true}).inputValue(),'');
        }else assert.equal(await modal(page).count(),0,`${change.label}_old_modal_survived`);
        await change.restore();await settle(page);assert.equal(requests.length,before+1,`${change.label}_automatic_requery`);
        if(change.keepsPanel){assert.equal(await result(page).count(),0);await close(page);}
      }
      assert.equal(requests.length,start+changes.length);
    });
    await run('sources browser paused module keeps explicit authorized reads available without storage polling or writes',async(page,start)=>{
      moduleEnabled=false;await enable(page);await open(page);await read(page);
      assert.equal(requests.length,start+1);assert.equal(requests.at(-1).body.moduleEnabled,false);
      await candidateRules(page,'past');
      assert((await panel(page).innerText()).includes('新考勤已暂停；本页只核查当前仍有权限读取的资料'));
      assert.equal(await panel(page).getByRole('button',{name:'读取核查资料',exact:true}).isDisabled(),false);
      await settle(page);assert.equal(requests.length,start+1);await originalControls(page);
    });
    assert.deepEqual(errors,[]);assert.equal(serviceCalls,requests.length);assert(requests.length<=20);assert.equal(externalRequests,0);
    assert(requests.every(request=>request.method==='GET'&&request.status===200));assert.equal(data.protectedFingerprint(),baseline);
    return {checks,apiRequests:requests.length,posts:0,externalRequests:0,storageCalls:0,productionAccess:false,realAuth:false,
      actualHandlerServiceSql:true,syntheticOnly:true,allTableFingerprintsUnchanged:true,parentIntegrationSourceAsserted:true,
      ...(verifyCandidateRules?{candidateRuleResolutionVerified:true,candidateRulesApplied:false}:{}),
      ...(verifyScheduleEvidence?{scheduleEvidenceVerified:true,scheduleEvidenceAssessmentPerformed:false}:{}),
      fullAdminE2E:false,callerOwnedNamespaceCleanup:true};
  }finally{
    closing=true;for(const gate of gates)gate.release.resolve();
    await runAttendanceCleanupSteps([
      {name:'sources-browser',run:async()=>{await browser?.close();}},
      {name:'sources-intercepted-requests',run:async()=>{await Promise.allSettled([...pending]);}},
      {name:'sources-loopback',run:async()=>{if(server.listening){server.closeAllConnections();await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}}},
    ]);
  }
}
