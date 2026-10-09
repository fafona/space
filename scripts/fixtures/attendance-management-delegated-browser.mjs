// INERT unless explicitly local. Legacy7 OR rules4 OR credentials3 OR revisions3.
// Reuses 201's in-memory/esbuild/Tailwind/stream-hold and bounded cleanup pattern.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {runAttendanceCleanupSteps} from './attendance-cleanup.mjs';
import {createManagementBrowserModel,managementBrowserPaths as paths} from './attendance-management-delegated-browser-model.mjs';
export {createManagementBrowserModel,managementBrowserPaths} from './attendance-management-delegated-browser-model.mjs';
export const managementBrowserLimits=Object.freeze({groups:7,api:60,http:100,posts:5,ttlMs:180000,mobileWidth:390});
export const managementRulesBrowserLimits=Object.freeze({groups:4,api:32,http:42,posts:3,ttlMs:180000,mobileWidth:390});
export const managementCredentialsBrowserLimits=Object.freeze({groups:3,api:45,http:60,posts:4,ttlMs:180000,mobileWidth:390});
export const managementRevisionsBrowserLimits=Object.freeze({groups:3,api:40,http:50,posts:3,ttlMs:90000,mobileWidth:390});
const root=fileURLToPath(new URL('../../',import.meta.url)),statics=['/','/qa.js','/qa.css','/favicon.ico'];
async function bounded(work,ms=12000){let timer;try{return await Promise.race([work,new Promise((_,no)=>{timer=setTimeout(()=>no(Error('management_browser_deadline')),ms);})]);}finally{clearTimeout(timer);}}
async function assets(seed,suite){
 const{build}=await import('esbuild'),{compile}=await import('@tailwindcss/node'),{default:ts}=await import('typescript');
 const bundle=await build({absWorkingDir:root,entryPoints:['scripts/fixtures/attendance-management-delegated-browser-entry.tsx'],bundle:true,write:false,metafile:true,platform:'browser',format:'esm',target:['es2020'],jsx:'automatic',
  tsconfig:path.join(root,'tsconfig.json'),outfile:'qa.js',logLevel:'warning',define:{'process.env':JSON.stringify({
   NEXT_PUBLIC_FAOLLA_ATTENDANCE_MANAGEMENT_DELEGATIONS_ENABLED:'1',NEXT_PUBLIC_FAOLLA_ATTENDANCE_DELEGATED_AUDIT_ENABLED:'1',NEXT_PUBLIC_FAOLLA_ATTENDANCE_DELEGATED_GROUPS_ENABLED:'1',NEXT_PUBLIC_FAOLLA_ATTENDANCE_DELEGATED_CONFIGURATION_ENABLED:'1',NEXT_PUBLIC_FAOLLA_ATTENDANCE_DELEGATED_RULES_ENABLED:'1',
   ...(suite==='credentials'?{NEXT_PUBLIC_FAOLLA_ATTENDANCE_DELEGATED_TERMINALS_ENABLED:'1',NEXT_PUBLIC_FAOLLA_ATTENDANCE_DELEGATED_PIN_ENABLED:'1'}:{}),
   ...(suite==='revisions'?{NEXT_PUBLIC_FAOLLA_ATTENDANCE_DELEGATED_REVISIONS_ENABLED:'1'}:{}),
   NEXT_PUBLIC_FAOLLA_ATTENDANCE_PERIOD_DELEGATION_ENABLED:'1',NEXT_PUBLIC_FAOLLA_ATTENDANCE_CORRECTION_DELEGATION_ENABLED:'1'}),
   'process.env.NODE_ENV':'"development"',__MANAGEMENT_SEED__:JSON.stringify(seed)}});
 const candidates=new Set();for(const name of Object.keys(bundle.metafile.inputs)){assert(!/node:crypto|\.server\.ts$/.test(name),'server_import_in_browser');if(!/\.tsx?$/.test(name)||name.includes('node_modules'))continue;
  const ast=ts.createSourceFile(name,await readFile(path.join(root,name),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);const visit=n=>{if(ts.isStringLiteral(n)||ts.isNoSubstitutionTemplateLiteral(n)||ts.isTemplateHead(n)||ts.isTemplateMiddle(n)||ts.isTemplateTail(n))n.text.split(/\s+/).filter(Boolean).forEach(c=>candidates.add(c));ts.forEachChild(n,visit);};visit(ast);}
 const css=(await compile('@import "tailwindcss";',{base:root,onDependency:()=>{}})).build([...candidates])+bundle.outputFiles.filter(f=>f.path.endsWith('.css')).map(f=>f.text).join('\n')+
  'body{margin:0;background:#f8fafc;font-family:Arial,sans-serif}.qa-main{max-width:1100px;margin:auto;min-width:0}';
 return{js:bundle.outputFiles.find(f=>f.path.endsWith('.js')).contents,css};
}
export async function verifyManagementBrowser({suite='legacy'}={}){
 assert(['legacy','rules','credentials','revisions'].includes(suite));const limits=suite==='revisions'?managementRevisionsBrowserLimits:suite==='credentials'?managementCredentialsBrowserLimits:suite==='rules'?managementRulesBrowserLimits:managementBrowserLimits;
 const started=Date.now(),model=await createManagementBrowserModel(),requests=[],errors=[],groups=[],inflight=new Set();
 let server,browser,context,page,origin,files,totalHttp=0,posts=0,closing=false,accept=true,downloads=0,confirmationCount=0,stage='setup',failure,report;
 const timer=setTimeout(()=>{closing=true;void context?.close().catch(()=>{});server?.closeAllConnections();},limits.ttlMs);
 const button=name=>page.getByRole('button',{name,exact:true}),dialog=()=>page.getByRole('dialog',{name:'管理委托与资源审计工作区',exact:true});
 const settle=async()=>{await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));await bounded(Promise.allSettled([...inflight]));};
 const configure=async value=>{await page.evaluate(v=>window.__managementHarness.configure(v),value);await settle();};
 const click=async(name,pathname,method='GET')=>{const[r]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname===pathname&&r.request().method()===method),button(name).click()]);await r.finished();assert.equal(r.status(),200);await settle();};
 const raw=slot=>page.evaluate(k=>sessionStorage.getItem(k),slot),overflow=async()=>{assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'390px_page_overflow');
  if(await dialog().count())assert.equal(await dialog().evaluate(el=>el.scrollWidth>el.clientWidth+1),false,'390px_dialog_overflow');};
 const open=async()=>{const n=requests.length;await button('管理委托／资源审计').click();await dialog().waitFor();await button('读取本地状态（不联网）').waitFor();await settle();assert.equal(requests.length,n,'opening_management_must_not_fetch');};
 const close=async()=>{await dialog().getByRole('button',{name:'关闭',exact:true}).click();await settle();};
 const group=async(name,work)=>{stage=name;const n=requests.length,p=posts;await work();await overflow();groups.push({name,apiRequests:requests.length-n,posts:posts-p});};
 const readGroup=async()=>{await page.getByLabel('真实组管理授权编号',{exact:true}).fill(model.seed.groupGrantId);await click('读取此授权上下文（GET）',paths.groups);await page.getByLabel('组名称',{exact:true}).waitFor();};
 const readConfiguration=async grantId=>{await page.getByLabel('真实档案／地点配置授权编号',{exact:true}).fill(grantId);
  await click('读取配置授权上下文（GET）',paths.configuration);await page.locator('[data-delegated-configuration-context]').waitFor();};
 const fillAudit=async()=>{await page.getByLabel('真实审计授权编号',{exact:true}).fill(model.seed.auditGrantId);
  await page.getByLabel('开始时间（UTC，含端点）',{exact:true}).fill('2026-10-08T00:00');await page.getByLabel('结束时间（UTC，不含端点，范围≤31天）',{exact:true}).fill('2026-10-09T00:00');};
 const runRulesGroups=async()=>{
  const ruleAck='已核验此一个授权动作、固定身份、允许键和当前版本；未知结果仅 GET 原号',grantAck='已核验真实身份、固定层级、允许键、地点与期限，只授上述一个规则动作',
   readRules=async grantId=>{await page.getByLabel('真实规则授权编号',{exact:true}).fill(grantId);await click('读取规则授权上下文（GET）',paths.rules);await page.locator('[data-delegated-rules-context]').waitFor();};
  await group('206_actual_Admin_eight_structured_action_forms_one_explicit_grant',async()=>{
   await page.goto(origin);await button('打开负责人合成父入口').waitFor();assert.equal(requests.length,0);await button('打开负责人合成父入口').click();await page.getByLabel('企业考勤时区',{exact:true}).waitFor();await open();
   await click('读取授权（每页25条）',paths.management);
   const form=page.locator('details').filter({has:page.locator('summary',{hasText:'授予规则权限（八个明确动作）'})});await form.locator('summary').click();
   const action=form.getByLabel(/^规则明确动作/),scope=form.getByLabel(/^规则固定层级/),actions=await action.locator('option').evaluateAll(items=>items.map(el=>el.value));
   assert.deepEqual(actions,['rule_draft','rule_publish','rule_withdraw','personal_rule_approve','personal_rule_withdraw','operational_rule_draft','operational_rule_publish','operational_rule_withdraw']);
   await form.getByLabel('规则被委托员工 ID',{exact:true}).fill(model.seed.employeeId);await form.getByLabel('规则被委托账户 Auth ID',{exact:true}).fill(model.seed.delegate);
   await form.getByLabel('规则授权生效时间（UTC）',{exact:true}).fill('2026-10-08T10:00');await form.getByLabel('规则授权失效时间（UTC，不含端点）',{exact:true}).fill('2026-10-09T10:00');
   await form.getByLabel('规则授权理由',{exact:true}).fill('Synthetic206 explicit scoped rule grant');
   for(const value of actions){await action.selectOption(value);
    const personal=value.startsWith('personal_'),operational=value.startsWith('operational_');
    await scope.selectOption(personal?'personal':value==='rule_publish'?'group':'enterprise');
    if(personal){for(const[label,identity]of[['规则目标 Worker ID',model.seed.configurationWorkerId],['规则目标 Employee ID',model.seed.configurationEmployeeId],['规则目标 Auth ID',model.seed.other]])await form.getByLabel(label,{exact:true}).fill(identity);}
    if(value==='rule_publish')await form.getByLabel('规则目标 Group ID',{exact:true}).fill(model.seed.groupId);
    assert.equal(await scope.inputValue(),personal?'personal':value==='rule_publish'?'group':'enterprise');
    await form.getByLabel(operational?'审核路由':'迟到宽限',{exact:true}).check();if(operational)await form.getByLabel('周期方式',{exact:true}).check();await form.getByLabel(grantAck,{exact:true}).check();
    const before=posts,confirms=confirmationCount;accept=false;await button('授予此规则动作（一次提交）').click();await settle();assert.equal(confirmationCount,confirms+1);assert.equal(posts,before);assert.equal(await raw(model.seed.slots.owner),null);
   }
   accept=true;await action.selectOption('operational_rule_draft');await scope.selectOption('enterprise');await form.getByLabel('审核路由',{exact:true}).check();await form.getByLabel('周期方式',{exact:true}).check();await form.getByLabel(grantAck,{exact:true}).check();
   await click('授予此规则动作（一次提交）',paths.management,'POST');const pending=JSON.parse(await raw(model.seed.slots.owner));assert.equal(pending.domain,'management');assert.equal(pending.command.delegatedAction,'operational_rule_draft');
   assert.deepEqual(pending.command.scope,{kind:'rules',family:'operational',subject:{kind:'enterprise'},allowedRuleKeys:['reviewRouting','timesheetCycle'],locationIds:[]});await click('仅 GET 核验原编号',paths.management);assert.equal(await raw(model.seed.slots.owner),null);await close();
  });
  await group('206_actual_Manager_full_baseline_nested_pending_dual_lanes_exact_GET',async()=>{
   await configure({mode:'overview',identity:'employee',ownerMode:false,requester:2061});await button('管理委托／资源审计').waitFor();await open();await readRules(model.seed.baseRulesGrantId);
   assert.equal(requests.at(-1).actor,model.seed.delegate);const early=page.getByRole('group',{name:'早退宽限（未授权，原值保留）',exact:true});assert.match(await early.textContent(),/23/);assert.equal(await early.locator('input,select,textarea').count(),0);
   await page.getByLabel('迟到宽限处理方式',{exact:true}).selectOption('value');await page.getByLabel('迟到宽限分钟',{exact:true}).fill('12');await page.getByLabel('规则本次操作理由',{exact:true}).fill('Synthetic206 preserve all unallowed baseline keys');await page.getByLabel(ruleAck,{exact:true}).check();
   accept=false;assert.equal(await page.evaluate(()=>window.__managementHarness.navigate('todos')),false);accept=true;const before=requests.length;
   await page.evaluate(()=>{for(const name of ['我的受托周期','受托首次补正审批']){const b=[...document.querySelectorAll('button')].find(el=>el.textContent===name);if(!b)throw Error('missing_dual_lane_launcher:'+name);b.click();}});await settle();assert.equal(requests.length,before);
   assert.equal(await page.getByRole('dialog',{name:'周期管理授权与受托核对工作区',exact:true}).count(),0);assert.equal(await page.getByRole('dialog',{name:'首次补正审批委托工作区',exact:true}).count(),0);
   await page.evaluate(path=>window.__managementHarness.hold(path,'POST'),paths.rules);await click('基础规则：保存草稿（一次提交）',paths.rules,'POST');await page.waitForFunction(()=>window.__managementHarness.held());
   const original=await raw(model.seed.slots.delegate);assert(original);const pending=JSON.parse(original);assert.equal(pending.domain,'rules');assert.equal(pending.actorId,model.seed.delegate);assert.equal(pending.command.operationId,undefined);assert.match(pending.command.decision.operationId,/^[\da-f-]{36}$/);
   assert.equal(pending.command.decision.expectedRevision,4);assert.equal(pending.command.decision.expectedSettingsVersion,9);assert.deepEqual(pending.command.decision.rules.earlyGraceMinutes,{mode:'value',minutes:23});assert.deepEqual(pending.command.decision.rules.lateGraceMinutes,{mode:'value',minutes:12});
   await page.evaluate(()=>window.__managementHarness.visibility(true));assert.equal(await page.locator('[data-delegated-rules-context]').count(),0);assert.equal(await page.getByLabel('真实规则授权编号',{exact:true}).inputValue(),'');await page.evaluate(()=>window.__managementHarness.release());await settle();assert.equal(await raw(model.seed.slots.delegate),original);await page.evaluate(()=>window.__managementHarness.visibility(false));
   await configure({mode:'strict',ownerMode:false,grant:false,audit:false,groups:false,configuration:false,rules:false,requester:2062});await open();
   assert.equal(await button('读取授权（每页25条）').count(),0,'delegate_has_no_owner_authorization_list');
   for(const name of ['读取审计首页（GET）','读取此授权上下文（GET）','读取配置授权上下文（GET）','读取规则授权上下文（GET）'])assert(await button(name).isDisabled());
   for(const recovery of ['null','wrong-sha']){model.recovery(recovery);await click('仅 GET 核验原编号',paths.rules);assert.equal(await raw(model.seed.slots.delegate),original);}
   model.recovery('valid');await click('仅 GET 核验原编号',paths.rules);assert.equal(await raw(model.seed.slots.delegate),null);await close();
  });
  await group('206_actual_Manager_known_route_choices_preview_before_confirm_publish',async()=>{
   await configure({mode:'overview',identity:'employee',ownerMode:false,requester:2063});await button('管理委托／资源审计').waitFor();await open();await readRules(model.seed.operationalDraftGrantId);
   const pair=model.seed.knownRouteEmployeeId+'/'+model.seed.knownRouteAuthId;
   for(const name of ['首次补正','整段漏卡','请假','工作安排']){const route=page.getByRole('group',{name,exact:true}).getByLabel(/^路由目标/);assert.deepEqual(await route.locator('option').evaluateAll(items=>items.map(el=>el.value)),['owner',pair]);}
   assert.equal(await page.getByLabel('路由员工 ID',{exact:true}).count(),0);assert.equal(await page.getByLabel('路由账户 Auth ID',{exact:true}).count(),0);
   const correction=page.getByRole('group',{name:'首次补正',exact:true}).getByLabel(/^路由目标/);await correction.selectOption('owner');await correction.selectOption(pair);assert.equal(await correction.inputValue(),pair);await close();await open();await readRules(model.seed.operationalPublishGrantId);
   await page.getByLabel('规则未来开始日期（企业时区）',{exact:true}).fill('2026-10-10');await page.getByLabel('规则本次操作理由',{exact:true}).fill('Synthetic206 explicit preview before publish');await page.getByLabel(ruleAck,{exact:true}).check();
   let confirms=confirmationCount;const before=posts;await button('运营规则：核准未来发布（一次提交）').click();await settle();assert.equal(confirmationCount,confirms);assert.equal(posts,before);
   await click('核验已保存运营草稿与明确引用（GET）',paths.rules);await page.getByText('applied=false；只核对保存引用，不证明全员最终权限或业务已使用。',{exact:true}).waitFor();
   assert.equal(requests.at(-1).query.sourceDraftRevision,3);await page.getByLabel(ruleAck,{exact:true}).check();accept=false;confirms=confirmationCount;await button('运营规则：核准未来发布（一次提交）').click();await settle();assert.equal(confirmationCount,confirms+1);assert.equal(posts,before);accept=true;
   await click('运营规则：核准未来发布（一次提交）',paths.rules,'POST');const pending=JSON.parse(await raw(model.seed.slots.delegate));assert.equal(pending.domain,'rules');assert.equal(pending.command.family,'operational');assert.equal(pending.command.decision.action,'publish');assert.equal(pending.command.decision.expectedRevision,3);assert.match(pending.command.decision.previewFingerprint,/^[a-f\d]{64}$/);
   await click('仅 GET 核验原编号',paths.rules);assert.equal(await raw(model.seed.slots.delegate),null);await close();
  });
  await group('206_StrictMode_independent_flags_Auth_double_epoch_hidden_late_GET_390px',async()=>{
   await configure({mode:'strict',ownerMode:true,grant:true,audit:false,groups:false,configuration:false,rules:false,requester:2064});await open();await click('读取授权（每页25条）',paths.management);await page.locator('summary',{hasText:'授予规则权限（八个明确动作）'}).click();assert(await page.getByLabel(/^规则明确动作/).isDisabled());await close();
   await configure({grant:false,rules:true});await open();await click('读取授权（每页25条）',paths.management);await page.locator('summary',{hasText:'授予规则权限（八个明确动作）'}).click();assert(await page.getByLabel(/^规则明确动作/).isDisabled());await close();
   await configure({ownerMode:false,rules:false,requester:2065});await open();await readRules(model.seed.baseRulesGrantId);assert(await page.getByLabel('迟到宽限处理方式',{exact:true}).isDisabled());await close();
   await configure({rules:true});await open();await page.getByLabel('真实规则授权编号',{exact:true}).fill(model.seed.baseRulesGrantId);await page.evaluate(path=>window.__managementHarness.hold(path,'GET'),paths.rules);await click('读取规则授权上下文（GET）',paths.rules);await page.waitForFunction(()=>window.__managementHarness.held());
   await page.evaluate(()=>window.__managementHarness.authValid(false));assert.equal(await dialog().count(),0);await page.evaluate(()=>window.__managementHarness.authValid(true));await page.evaluate(()=>window.__managementHarness.release());await settle();assert.equal(await page.locator('[data-delegated-rules-context]').count(),0);
   await open();await page.getByLabel('真实规则授权编号',{exact:true}).fill(model.seed.baseRulesGrantId);await page.evaluate(path=>window.__managementHarness.hold(path,'GET'),paths.rules);await click('读取规则授权上下文（GET）',paths.rules);await page.waitForFunction(()=>window.__managementHarness.held());
   await configure({identity:'other',requester:2066});await configure({identity:'employee',requester:2065});await page.evaluate(()=>window.__managementHarness.release());await settle();assert.equal(await dialog().count(),0);assert.equal(await page.locator('[data-delegated-rules-context]').count(),0);
   await open();await readRules(model.seed.baseRulesGrantId);await page.getByLabel('规则本次操作理由',{exact:true}).fill('Synthetic private rule draft must clear');const n=requests.length;
   await page.evaluate(()=>window.__managementHarness.visibility(true));assert.equal(await page.locator('[data-delegated-rules-context]').count(),0);assert.equal(await page.getByLabel('真实规则授权编号',{exact:true}).inputValue(),'');await page.evaluate(()=>window.__managementHarness.visibility(false));await settle();assert.equal(requests.length,n);assert.equal(await raw(model.seed.slots.delegate),null);await close();
  });
  assert.deepEqual(model.writes.filter(w=>w.domain==='rules').map(w=>[w.command.family,w.command.decision.action]),[['base','save_draft'],['operational','publish']]);assert.equal(await page.evaluate(()=>window.__managementHarness.objectUrls()),0);
 };
 const runCredentialsGroups=async()=>{
  const grantAck='已核验精确身份、地点、动作和期限；不授其他设备或人员权限',credentialAck='已核验此一个凭据动作、精确身份及当前版本；秘密丢失只核验原编号不重发',
   pinLabel='本次 PIN（8—12位数字，仅一次发送）',pairLabel=/^本次临时配对码（生成后15秒清除）/;let finalOriginal=null;
  const readCredentials=async(domain,grantId)=>{await page.getByLabel('终端／PIN授权类型',{exact:true}).selectOption(domain);await page.getByLabel('真实终端／PIN授权编号',{exact:true}).fill(grantId);
   await click('读取凭据授权上下文（GET）',paths[domain]);await page.locator('[data-delegated-credentials-context]').waitFor();};
  //Synthetic test value is generated ONLY inside the browser and never returned
  //to Node, a diagnostic message, a screenshot, a saved file or an original slot.
  const fillPin=async()=>{await page.getByLabel(pinLabel,{exact:true}).evaluate(el=>{
   Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,'9'.repeat(8));el.dispatchEvent(new Event('input',{bubbles:true}));});await settle();};
  const secretFree=async slot=>{assert(await page.evaluate(key=>{
   const raw=sessionStorage.getItem(key),display=[...document.querySelectorAll('textarea')].find(el=>el.readOnly&&el.value);
   return raw!==null&&!/"(?:pin|pairSecret|p_material|salt|verifier)":/.test(raw)&&(!display||!raw.includes(display.value));},slot),'nonsecret_original_slot');};
  const confirmCredential=async label=>{await page.getByLabel('凭据本次操作理由',{exact:true}).fill('Synthetic207 explicit scoped credential action');
   await page.getByLabel(credentialAck,{exact:true}).check();await click(label, label.startsWith('准备')||label.startsWith('撤销指定终端')?paths.terminals:paths.pin,'POST');};
  await group('207_actual_Admin_four_exact_grants_member_independent_fill_cancel_zero_POST',async()=>{
   await page.goto(origin);await button('打开负责人合成父入口').waitFor();assert.equal(requests.length,0);await button('打开负责人合成父入口').click();await page.getByLabel('企业考勤时区',{exact:true}).waitFor();
   await page.getByLabel('企业考勤时区',{exact:true}).fill('UTC');const before=requests.length;assert(await button('管理委托／资源审计').isDisabled());await button('管理委托／资源审计').evaluate(el=>el.click());await settle();assert.equal(await dialog().count(),0);assert.equal(requests.length,before);
   await page.getByLabel('企业考勤时区',{exact:true}).fill('Europe/Madrid');await open();await click('读取授权（每页25条）',paths.management);
   const form=page.locator('details').filter({has:page.locator('summary',{hasText:'授予终端／PIN权限（四项精确授权）'})});await form.locator('summary').click();
   const action=form.getByLabel('凭据明确授权动作',{exact:true});assert.deepEqual(await action.locator('option').evaluateAll(items=>items.map(el=>el.value)),['terminal_prepare','terminal_revoke','pin_issue','pin_revoke']);
   await form.getByLabel('凭据被委托员工 ID',{exact:true}).fill(model.seed.employeeId);await form.getByLabel('凭据被委托账户 Auth ID',{exact:true}).fill(model.seed.delegate);
   for(const value of ['terminal_prepare','terminal_revoke','pin_issue','pin_revoke']){await action.selectOption(value);
    for(const identity of value.startsWith('terminal_')?['terminal']:['member_pin','independent_pin']){
     if(identity==='terminal'){await form.getByLabel('授权终端 ID',{exact:true}).fill(model.seed.credentialTerminalId);await form.getByLabel('授权终端地点 ID',{exact:true}).fill(model.seed.credentialLocationId);}
     else{await form.getByLabel('授权 PIN 身份类型',{exact:true}).selectOption(identity);await form.getByLabel('PIN目标 Worker ID',{exact:true}).fill(identity==='member_pin'?model.seed.credentialWorkerId:model.seed.credentialIndependentWorkerId);
      if(identity==='member_pin'){await form.getByLabel('PIN目标 Employee ID',{exact:true}).fill(model.seed.credentialEmployeeId);await form.getByLabel('PIN目标 Auth ID',{exact:true}).fill(model.seed.credentialAuthId);}
      else{assert.equal(await form.getByLabel('PIN目标 Employee ID',{exact:true}).count(),0);assert.equal(await form.getByLabel('PIN目标 Auth ID',{exact:true}).count(),0);await form.getByLabel('PIN目标独立 Subject ID',{exact:true}).fill(model.seed.credentialSubjectId);await form.getByLabel('已核验独立主体代际',{exact:true}).fill('1');}
      // React-controlled textarea text can become part of its implicit label
      // after the previous iteration. Keep the exact static label prefix and
      // unique control, without depending on its current editable value.
      const places=form.getByLabel(/^PIN授权地点 ID（1—25个，逗号或换行分隔）/);assert.equal(await places.count(),1);await places.fill(model.seed.credentialLocationId);}
     await form.getByLabel('凭据授权生效时间（UTC）',{exact:true}).fill('2026-10-08T10:00');await form.getByLabel('凭据授权失效时间（UTC，不含端点）',{exact:true}).fill('2026-10-09T10:00');
     await form.getByLabel('凭据授权理由',{exact:true}).fill('Synthetic207 exact grant canceled before submission');await form.getByLabel(grantAck,{exact:true}).check();
     const confirms=confirmationCount;accept=false;await button('授予此凭据动作（一次提交）').click();await settle();assert.equal(confirmationCount,confirms+1);assert.equal(posts,0);assert.equal(await raw(model.seed.slots.owner),null);
    }
   }accept=true;await close();
  });
  await group('207_actual_Manager_prepare_member_issue_two_revokes_transient_secrets_original_GET',async()=>{
   await configure({mode:'overview',identity:'employee',ownerMode:false,requester:2071});await button('管理委托／资源审计').waitFor();await open();await readCredentials('terminals',model.seed.terminalPrepareGrantId);
   assert.equal(requests.at(-1).actor,model.seed.delegate);assert.notEqual(requests.at(-1).actor,model.seed.employeeId);await page.getByLabel('本次终端显示名称',{exact:true}).fill('Synthetic207 entrance');
   await confirmCredential('准备指定终端配对（一次提交）');await page.getByLabel(pairLabel,{exact:true}).waitFor();assert(await page.getByLabel(pairLabel,{exact:true}).evaluate(el=>el.readOnly&&el.value.length>0),'readonly_transient_pair_display');await secretFree(model.seed.slots.delegate);
   const prepareOriginal=await raw(model.seed.slots.delegate);accept=false;assert.equal(await page.evaluate(()=>window.__managementHarness.navigate('todos')),false);accept=true;
   await page.waitForFunction(()=>![...document.querySelectorAll('textarea')].some(el=>el.readOnly&&el.value),null,{timeout:17000});assert.equal(await raw(model.seed.slots.delegate),prepareOriginal,'timer_keeps_original');
   await click('仅 GET 核验原编号',paths.terminals);assert.equal(await raw(model.seed.slots.delegate),null);assert.equal(await page.getByLabel(pairLabel,{exact:true}).count(),0);
   await readCredentials('pin',model.seed.memberPinIssueGrantId);await fillPin();await page.evaluate(path=>window.__managementHarness.hold(path,'POST'),paths.pin);await confirmCredential('签发指定人员 PIN（一次提交）');await page.waitForFunction(()=>window.__managementHarness.held());
   await secretFree(model.seed.slots.delegate);const issueOriginal=await raw(model.seed.slots.delegate);assert(!await page.getByLabel(pinLabel,{exact:true}).count()||await page.getByLabel(pinLabel,{exact:true}).evaluate(el=>el.value===''),'PIN_cleared_on_submit');
   await page.evaluate(()=>window.__managementHarness.visibility(true));assert.equal(await page.locator('[data-delegated-credentials-context]').count(),0);await page.evaluate(()=>window.__managementHarness.release());await settle();assert.equal(await raw(model.seed.slots.delegate),issueOriginal);await page.evaluate(()=>window.__managementHarness.visibility(false));
   await configure({mode:'strict',ownerMode:false,grant:false,audit:false,groups:false,configuration:false,rules:false,terminals:false,pin:false,requester:2072});await open();await click('仅 GET 核验原编号',paths.pin);assert.equal(await raw(model.seed.slots.delegate),null);
   assert.equal(await page.getByLabel(pairLabel,{exact:true}).count(),0);assert.equal(await page.getByLabel(pinLabel,{exact:true}).count(),0);await close();
   await configure({terminals:true,pin:true,requester:2073});await open();await readCredentials('terminals',model.seed.terminalRevokeGrantId);await confirmCredential('撤销指定终端（一次提交）');await secretFree(model.seed.slots.delegate);
   await click('仅 GET 核验原编号',paths.terminals);assert.equal(await raw(model.seed.slots.delegate),null);await readCredentials('pin',model.seed.memberPinRevokeGrantId);
   assert.match(await page.locator('[data-delegated-credentials-context]').textContent(),/PIN版本 2/);await confirmCredential('撤销指定人员 PIN（一次提交）');await secretFree(model.seed.slots.delegate);finalOriginal=await raw(model.seed.slots.delegate);assert(finalOriginal);await close();
   assert.deepEqual(model.writes.map(w=>[w.domain,w.command.action]),[['terminals','terminal_prepare'],['pin','pin_issue'],['terminals','terminal_revoke'],['pin','pin_revoke']]);assert.equal(model.secretChecks.preparePosts,1);assert.equal(model.secretChecks.pinPosts,1);
  });
  await group('207_StrictMode_flags_wrong_receipt_PIN15s_hidden_Auth_late_390px_close_zero_HTTP',async()=>{
   await configure({terminals:false,pin:false,requester:2074});await open();for(const mode of ['null','wrong-sha']){model.recovery(mode);await click('仅 GET 核验原编号',paths.pin);assert.equal(await raw(model.seed.slots.delegate),finalOriginal);}
   model.recovery('valid');await click('仅 GET 核验原编号',paths.pin);assert.equal(await raw(model.seed.slots.delegate),null);await readCredentials('pin',model.seed.memberPinIssueGrantId);
   assert(await page.getByLabel(pinLabel,{exact:true}).isDisabled());assert(await button('签发指定人员 PIN（一次提交）').isDisabled());const n=requests.length;await button('签发指定人员 PIN（一次提交）').evaluate(el=>el.click());await settle();assert.equal(requests.length,n);
   for(const[domain,grantId,label]of[['terminals',model.seed.terminalRevokeGrantId,'撤销指定终端（一次提交）'],['pin',model.seed.memberPinRevokeGrantId,'撤销指定人员 PIN（一次提交）']]){
    await readCredentials(domain,grantId);assert(await button(label).isDisabled());const before=requests.length;await button(label).evaluate(el=>el.click());await settle();assert.equal(requests.length,before);}
   await close();
   await configure({terminals:true,pin:true,requester:2075});await open();await readCredentials('pin',model.seed.independentPinIssueGrantId);assert.match(await page.locator('[data-delegated-credentials-context]').textContent(),/独立主体/);
   await fillPin();await page.waitForFunction(()=>![...document.querySelectorAll('input[type="password"]')].some(el=>el.value),null,{timeout:17000});assert.equal(await raw(model.seed.slots.delegate),null);assert(await button('签发指定人员 PIN（一次提交）').isDisabled());
   await fillPin();const hiddenBefore=requests.length;await page.evaluate(()=>window.__managementHarness.visibility(true));assert.equal(await page.locator('[data-delegated-credentials-context]').count(),0);assert.equal(await page.getByLabel('真实终端／PIN授权编号',{exact:true}).inputValue(),'');
   await page.evaluate(()=>window.__managementHarness.visibility(false));await settle();assert.equal(requests.length,hiddenBefore);await close();await open();await readCredentials('pin',model.seed.memberPinIssueGrantId);await fillPin();await page.evaluate(()=>window.__managementHarness.pagehide());assert.equal(await page.locator('[data-delegated-credentials-context]').count(),0);await close();
   await configure({requester:2076});await open();await page.getByLabel('终端／PIN授权类型',{exact:true}).selectOption('pin');await page.getByLabel('真实终端／PIN授权编号',{exact:true}).fill(model.seed.independentPinIssueGrantId);
   await page.evaluate(path=>window.__managementHarness.hold(path,'GET'),paths.pin);await click('读取凭据授权上下文（GET）',paths.pin);await page.waitForFunction(()=>window.__managementHarness.held());
   await page.evaluate(()=>window.__managementHarness.authValid(false));assert.equal(await dialog().count(),0);await page.evaluate(()=>window.__managementHarness.authValid(true));await page.evaluate(()=>window.__managementHarness.release());await settle();assert.equal(await page.locator('[data-delegated-credentials-context]').count(),0);
   await open();await readCredentials('pin',model.seed.independentPinIssueGrantId);await fillPin();await configure({identity:'other',requester:2077});await settle();assert.equal(await dialog().count(),0);assert.equal(await page.getByLabel(pinLabel,{exact:true}).count(),0);
   await configure({identity:'employee',requester:2078});await open();const beforeClose=requests.length;await close();await settle();assert.equal(requests.length,beforeClose);assert.equal(await raw(model.seed.slots.delegate),null);assert.equal(posts,4);
  });
  assert.equal(await page.evaluate(()=>window.__managementHarness.objectUrls()),0);assert.equal(downloads,0);
 };
 const runRevisionsGroups=async()=>{
  const grantAck='已核验真实双身份、地点、待办口径和期限，只授此一个修订动作',
   decisionAck='已核对目标员工、原始记录、提交时基准、声明差异和理由，只执行显示动作且了解决定不能撤销',
   reasonLabel='修订决定理由（单行1—500字，员工可见）';let approveOriginal=null;
  const selectRevision=async target=>{await page.getByLabel('真实连续修订授权编号',{exact:true}).fill(target.grantId);await page.getByLabel('连续修订申请编号',{exact:true}).fill(target.requestId);};
  const readRevision=async target=>{await selectRevision(target);await click('读取修订授权上下文（GET）',paths.revisions);await page.locator('[data-delegated-revisions-context]').waitFor();};
  const readonlyReview=async which=>{
   const area=page.locator('[data-delegated-revisions-review]');assert.match(await area.textContent(),new RegExp('Synthetic208 '+which+' employee'));
   for(const name of ['原始打卡（保留不变）','提交时核定（修订 2）','本次员工声明（尚未生效）']){const region=area.getByRole('region',{name,exact:true});await region.waitFor();assert.equal(await region.locator('input,select,textarea').count(),0);}
   assert.equal(await area.locator('input,select,textarea').count(),0);assert.match(await area.textContent(),/不支持撤销决定/);
   assert.equal(await button(which==='approve'?'驳回指定连续修订（一次提交）':'批准指定连续修订（一次提交）').count(),0,'grant_only_one_revision_action');
  };
  const fillDecision=async reason=>{await page.getByLabel(reasonLabel,{exact:true}).fill(reason);await page.getByLabel(decisionAck,{exact:true}).check();};
  await group('208_actual_Admin_two_precise_revision_grants_fill_confirm_cancel_zero_POST',async()=>{
   await page.goto(origin);await button('打开负责人合成父入口').waitFor();assert.equal(requests.length,0);await button('打开负责人合成父入口').click();await page.getByLabel('企业考勤时区',{exact:true}).waitFor();
   await page.getByLabel('企业考勤时区',{exact:true}).fill('UTC');const before=requests.length;assert(await button('管理委托／资源审计').isDisabled());await button('管理委托／资源审计').evaluate(el=>el.click());await settle();assert.equal(await dialog().count(),0);assert.equal(requests.length,before);
   await page.getByLabel('企业考勤时区',{exact:true}).fill('Europe/Madrid');await open();await click('读取授权（每页25条）',paths.management);
   const form=page.locator('details').filter({has:page.locator('summary',{hasText:'授予连续修订审批（批准／驳回精确授权）'})});await form.locator('summary').click();
   const action=form.getByLabel('唯一修订授权动作',{exact:true});assert.deepEqual(await action.locator('option').evaluateAll(items=>items.map(el=>el.value)),['revision_approve','revision_reject']);
   await form.getByLabel('修订受托员工 ID',{exact:true}).fill(model.seed.employeeId);await form.getByLabel('修订受托账户 Auth ID',{exact:true}).fill(model.seed.delegate);
   for(const [which,target]of Object.entries(model.seed.revisions)){await action.selectOption('revision_'+which);
    for(const[label,value]of[['修订目标 Worker ID',target.workerId],['修订目标 Employee ID',target.employeeId],['修订目标 Auth ID',target.employeeAuthUserId]])await form.getByLabel(label,{exact:true}).fill(value);
    await form.getByLabel('修订授权地点 ID（1—25个，逗号或换行分隔）',{exact:true}).fill(target.locationId);
    await form.getByLabel('明确纳入授权前已提交、目前仍待审批的修订申请',{exact:true}).setChecked(which==='reject');
    await form.getByLabel('修订授权生效时间（UTC）',{exact:true}).fill('2026-10-08T10:00');await form.getByLabel('修订授权失效时间（UTC，不含端点）',{exact:true}).fill('2026-10-09T10:00');
    await form.getByLabel('修订授权理由',{exact:true}).fill('Synthetic208 precise approval grant canceled');await form.getByLabel(grantAck,{exact:true}).check();
    const confirms=confirmationCount;accept=false;await button('授予此修订动作（一次提交）').click();await settle();assert.equal(confirmationCount,confirms+1);assert.equal(posts,0);assert.equal(await raw(model.seed.slots.owner),null);
   }accept=true;await close();
  });
  await group('208_actual_Manager_readonly_three_way_review_approve_lost_reply_shared_original_flagoff_GET',async()=>{
   await configure({mode:'overview',identity:'employee',ownerMode:false,requester:2081});await button('管理委托／资源审计').waitFor();await open();await readRevision(model.seed.revisions.approve);await readonlyReview('approve');
   assert.equal(requests.at(-1).actor,model.seed.delegate);assert.notEqual(requests.at(-1).actor,model.seed.employeeId);await fillDecision('Synthetic208 explicit approve after readonly comparison');
   accept=false;assert.equal(await page.evaluate(()=>window.__managementHarness.navigate('todos')),false);const confirms=confirmationCount;await button('批准指定连续修订（一次提交）').click();await settle();assert.equal(confirmationCount,confirms+1);assert.equal(posts,0);accept=true;
   await page.evaluate(path=>window.__managementHarness.hold(path,'POST'),paths.revisions);await click('批准指定连续修订（一次提交）',paths.revisions,'POST');await page.waitForFunction(()=>window.__managementHarness.held());
   approveOriginal=await raw(model.seed.slots.delegate);assert(approveOriginal);const pending=JSON.parse(approveOriginal);assert.equal(pending.domain,'revisions');assert.equal(pending.actorId,model.seed.delegate);
   assert.equal(pending.query.requestId,model.seed.revisions.approve.requestId);assert.equal(pending.command.action,'approve');assert.equal(pending.command.expectedRevision,2);assert.match(pending.command.expectedEvidence,/^[a-f0-9]{32}$/);assert.match(pending.commandFingerprint,/^[a-f0-9]{64}$/);
   await page.evaluate(()=>window.__managementHarness.visibility(true));assert.equal(await page.locator('[data-delegated-revisions-context]').count(),0);assert.equal(await page.getByLabel('真实连续修订授权编号',{exact:true}).inputValue(),'');assert.equal(await page.getByLabel('连续修订申请编号',{exact:true}).inputValue(),'');
   await page.evaluate(()=>window.__managementHarness.release());await settle();assert.equal(await raw(model.seed.slots.delegate),approveOriginal);await page.evaluate(()=>window.__managementHarness.visibility(false));
   await configure({mode:'strict',ownerMode:false,grant:false,audit:false,groups:false,configuration:false,rules:false,terminals:false,pin:false,revisions:false,requester:2082});await open();
   for(const mode of ['null','wrong-sha']){model.recovery(mode);await click('仅 GET 核验原编号',paths.revisions);assert.equal(await raw(model.seed.slots.delegate),approveOriginal);}
   model.recovery('valid');await click('仅 GET 核验原编号',paths.revisions);assert.equal(await raw(model.seed.slots.delegate),null);assert.equal(await page.locator('[data-delegated-revisions-context]').count(),0);assert.match(await dialog().textContent(),/修订决定最小回执/);
   await readRevision(model.seed.revisions.reject);await readonlyReview('reject');assert(await page.getByLabel(reasonLabel,{exact:true}).isDisabled());assert(await button('驳回指定连续修订（一次提交）').isDisabled());
   const n=requests.length;await button('驳回指定连续修订（一次提交）').evaluate(el=>el.click());await settle();assert.equal(requests.length,n,'flagoff_no_new_revision_write');assert.equal(posts,1);await close();
  });
  await group('208_StrictMode_reject_exact_action_Auth_hidden_requester_late_original_GET_390px',async()=>{
   await configure({revisions:true,requester:2083});await open();await selectRevision(model.seed.revisions.reject);await page.evaluate(path=>window.__managementHarness.hold(path,'GET'),paths.revisions);
   await click('读取修订授权上下文（GET）',paths.revisions);await page.waitForFunction(()=>window.__managementHarness.held());await page.evaluate(()=>window.__managementHarness.authValid(false));assert.equal(await dialog().count(),0);
   await page.evaluate(()=>window.__managementHarness.authValid(true));await page.evaluate(()=>window.__managementHarness.release());await settle();assert.equal(await page.locator('[data-delegated-revisions-context]').count(),0);
   await open();await readRevision(model.seed.revisions.reject);await page.getByLabel(reasonLabel,{exact:true}).fill('Synthetic208 private draft must clear');const beforeHide=requests.length;
   await page.evaluate(()=>window.__managementHarness.visibility(true));await page.evaluate(()=>window.__managementHarness.pagehide());assert.equal(await page.locator('[data-delegated-revisions-context]').count(),0);assert.equal(await page.getByLabel(reasonLabel,{exact:true}).count(),0);
   assert.equal(await page.getByLabel('连续修订申请编号',{exact:true}).inputValue(),'');await page.evaluate(()=>window.__managementHarness.visibility(false));await settle();assert.equal(requests.length,beforeHide);await close();
   await open();await selectRevision(model.seed.revisions.reject);await page.evaluate(path=>window.__managementHarness.hold(path,'GET'),paths.revisions);await click('读取修订授权上下文（GET）',paths.revisions);await page.waitForFunction(()=>window.__managementHarness.held());
   await configure({identity:'other',requester:2084});await configure({identity:'employee',requester:2083});await page.evaluate(()=>window.__managementHarness.release());await settle();assert.equal(await dialog().count(),0);assert.equal(await page.locator('[data-delegated-revisions-context]').count(),0);
   await open();await readRevision(model.seed.revisions.reject);await readonlyReview('reject');await fillDecision('Synthetic208 explicit reject without effective-hours change');await click('驳回指定连续修订（一次提交）',paths.revisions,'POST');
   const original=await raw(model.seed.slots.delegate);assert(original);assert.equal(JSON.parse(original).command.action,'reject');assert.match(await dialog().textContent(),/修订决定最小回执/);await close();
   await configure({revisions:false,requester:2085});await open();await click('仅 GET 核验原编号',paths.revisions);assert.equal(await raw(model.seed.slots.delegate),null);
   const beforeClose=requests.length;await close();await settle();assert.equal(requests.length,beforeClose);assert.equal(posts,2);assert.deepEqual(model.writes.map(w=>[w.domain,w.command.action]),[['revisions','approve'],['revisions','reject']]);
  });
  assert.equal(downloads,0);assert.equal(await page.evaluate(()=>window.__managementHarness.objectUrls()),0);
 };
 try{
  files=await bounded(assets(model.seed,suite),45000);server=createServer((req,res)=>{const work=(async()=>{assert(!closing);assert(++totalHttp<=limits.http,'HTTP_cap');assert.equal(req.headers.host,new URL(origin).host);
   const u=new URL(req.url,origin);res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Security-Policy',"default-src 'none';script-src 'self';style-src 'self' 'unsafe-inline';connect-src 'self';img-src 'self';base-uri 'none';form-action 'none';frame-ancestors 'none'");
   if(statics.includes(u.pathname)){assert.equal(req.method,'GET');assert.equal(u.search,'');if(u.pathname==='/favicon.ico')return res.writeHead(204).end();const html='<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="/favicon.ico"><link rel="stylesheet" href="/qa.css"><div id="qa-root"></div><script type="module" src="/qa.js"></script></html>';
    return res.writeHead(200,{'Content-Type':u.pathname==='/'?'text/html;charset=utf-8':u.pathname==='/qa.js'?'text/javascript;charset=utf-8':'text/css;charset=utf-8'}).end(u.pathname==='/'?html:u.pathname==='/qa.js'?files.js:files.css);}
   assert(model.seed.paths.includes(u.pathname));assert(requests.length<limits.api,'API_cap');if(req.method==='POST'){
    assert((suite==='revisions'?[paths.revisions]:suite==='credentials'?[paths.terminals,paths.pin]:suite==='rules'?[paths.management,paths.rules]:[paths.management,paths.audit,paths.groups,paths.configuration]).includes(u.pathname),'original_writer_POST_forbidden');assert(++posts<=limits.posts,'POST_cap');}
   const record={path:u.pathname,method:req.method};requests.push(record);let text='',bytes=0;for await(const chunk of req){bytes+=chunk.length;assert(bytes<=8192);text+=chunk.toString('utf8');}
   const result=await model.respond(u.href,req.method,text,req.headers);Object.assign(record,{query:result.query,command:result.command,actor:result.actor,domain:result.domain});
   res.writeHead(result.status,{'Content-Type':'application/json;charset=utf-8'}).end(result.text);
  })();inflight.add(work);void work.catch(error=>{errors.push(error.message);if(!res.headersSent)res.writeHead(500,{'Content-Type':'application/json'});res.end('{"ok":false}');}).finally(()=>inflight.delete(work));});
  await new Promise((yes,no)=>{server.once('error',no);server.listen(0,'127.0.0.1',yes);});const address=server.address();assert(address&&typeof address==='object'&&address.address==='127.0.0.1');origin=`http://127.0.0.1:${address.port}`;
  const{chromium}=await import('playwright'),launch=chromium.launch({headless:true});void launch.then(b=>{if(closing)return b.close();}).catch(()=>{});browser=await bounded(launch,15000);
  context=await browser.newContext({serviceWorkers:'block',acceptDownloads:false,viewport:{width:390,height:900}});
  await context.route('**/*',async route=>{const r=route.request(),u=new URL(r.url());if(u.origin!==origin||!((statics.includes(u.pathname)&&r.method()==='GET'&&!u.search)||model.seed.paths.includes(u.pathname)&&['GET','POST'].includes(r.method()))){errors.push('external_or_unknown_request');return route.abort();}await route.continue();});
  page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  page.on('popup',()=>errors.push('popup'));page.on('download',()=>{downloads++;if(downloads>(suite==='legacy'?1:0))errors.push('unexpected_download');});page.on('dialog',d=>{confirmationCount++;void(accept?d.accept():d.dismiss()).catch(()=>{});});
  if(suite==='legacy'){
  await group('actual_admin_zero_mount_parent_dirty_guard_structured_scoped_grant',async()=>{
   await page.goto(origin);await button('打开负责人合成父入口').waitFor();assert.equal(requests.length,0);await button('打开负责人合成父入口').click();await page.getByLabel('企业考勤时区',{exact:true}).waitFor();await settle();
   await page.getByLabel('企业考勤时区',{exact:true}).fill('UTC');const before=requests.length;assert(await button('管理委托／资源审计').isDisabled());
   await button('管理委托／资源审计').evaluate(el=>el.click());await settle();assert.equal(await dialog().count(),0);assert.equal(requests.length,before);
   accept=false;assert.equal(await page.evaluate(()=>window.__managementHarness.leave()),false);accept=true;await page.getByLabel('企业考勤时区',{exact:true}).fill('Europe/Madrid');await open();
   await click('读取授权（每页25条）',paths.management);const form=page.locator('details').filter({has:page.locator('summary',{hasText:'授予审计权限（结构化表单）'})});await form.locator('summary').click();
   await form.getByLabel('被委托员工 ID',{exact:true}).fill(model.seed.employeeId);await form.getByLabel('被委托账户 Auth ID',{exact:true}).fill(model.seed.delegate);
   await form.getByLabel('档案／地点配置',{exact:true}).check();await form.getByLabel('生效时间（UTC）',{exact:true}).fill('2026-10-08T10:00');
   await form.getByLabel('失效时间（UTC，不含端点）',{exact:true}).fill('2026-10-09T10:00');await form.getByLabel('授权理由',{exact:true}).fill('Synthetic explicit scoped audit grant');
   await form.getByLabel('已核验真实双身份、地点、来源及期限，只授此明确审计动作',{exact:true}).check();accept=false;
   await button('授予明确审计权限（一次提交）').click();await settle();assert.equal(posts,0);accept=true;await click('授予明确审计权限（一次提交）',paths.management,'POST');
   const original=await raw(model.seed.slots.owner);assert(original);assert.equal(JSON.parse(original).command.scope.kind,'audit_company');assert.equal(JSON.parse(original).actorId,model.seed.owner);
   await click('仅 GET 核验原编号',paths.management);assert.equal(await raw(model.seed.slots.owner),null);await close();
  });
  await group('split_flags_real_203_query_detail_export_download_receipt_only_GET',async()=>{
   await configure({mode:'strict',ownerMode:true,grant:false,audit:true,groups:false});await open();await click('读取授权（每页25条）',paths.management);
   await page.locator('summary',{hasText:'授予审计权限（结构化表单）'}).click();assert(await page.getByLabel('被委托员工 ID',{exact:true}).first().isDisabled());
   await page.locator('summary',{hasText:'授予指定组动作（四项结构化授权）'}).click();assert(await page.getByLabel(/^唯一组动作/).isDisabled());assert.equal(await button('生成审计 CSV（一次提交）').isDisabled(),false);await close();
   await configure({grant:true,audit:false,groups:true});await open();await click('读取授权（每页25条）',paths.management);
   await page.locator('summary',{hasText:'授予审计权限（结构化表单）'}).click();assert.equal(await page.getByLabel('被委托员工 ID',{exact:true}).first().isDisabled(),false);
   await page.locator('summary',{hasText:'授予指定组动作（四项结构化授权）'}).click();assert.equal(await page.getByLabel(/^唯一组动作/).isDisabled(),false);assert(await button('生成审计 CSV（一次提交）').isDisabled());await close();
   await configure({ownerMode:false,grant:false,audit:true,groups:false});await open();await fillAudit();await click('读取审计首页（GET）',paths.audit);
   await click('2026-10-08T11:00:00.000001Z · worker · 20400000-0000-4000-8000-000000000010',paths.audit);await page.getByText('Synthetic browser worker',{exact:true}).waitFor();
   await click('生成审计 CSV（一次提交）',paths.audit,'POST');const original=await raw(model.seed.slots.delegate);assert(original);assert.equal(JSON.parse(original).domain,'audit');
   const [download]=await Promise.all([page.waitForEvent('download'),button('下载已核验 CSV').click()]);assert.match(download.suggestedFilename(),/^attendance-resource-audit-.*\.csv$/);await download.cancel();await settle();
   assert.equal(await page.evaluate(()=>window.__managementHarness.objectUrls()),0);await click('仅 GET 核验原编号',paths.audit);assert.equal(await raw(model.seed.slots.delegate),null);
   assert.equal(await button('下载已核验 CSV').count(),0);await readGroup();
   assert(await page.getByLabel('组名称',{exact:true}).isDisabled());await close();
  });
  await group('actual_manager_auth_dual_lane_guard_group_save_hidden_pending_fullSHA_GET',async()=>{
   await configure({mode:'overview',identity:'employee',requester:1});await button('管理委托／资源审计').waitFor();await settle();assert.notEqual(model.seed.delegate,model.seed.employeeId);await open();
   assert.equal(await page.getByText('负责人：授权管理',{exact:true}).count(),0);await readGroup();assert.equal(requests.at(-1).actor,model.seed.delegate);
   await page.getByLabel('组名称',{exact:true}).fill('Synthetic204 revised Kitchen');await page.getByLabel('本次组操作理由',{exact:true}).fill('Synthetic explicit scoped save');
   await page.getByLabel('已核验本授权、目标双身份、日期和上述版本，只执行显示的这一个动作',{exact:true}).check();
   accept=false;assert.equal(await page.evaluate(()=>window.__managementHarness.navigate('todos')),false);assert.equal(await page.getByLabel('组名称',{exact:true}).inputValue(),'Synthetic204 revised Kitchen');accept=true;
   const before=requests.length;await page.evaluate(()=>{for(const name of ['我的受托周期','受托首次补正审批']){const b=[...document.querySelectorAll('button')].find(e=>e.textContent===name);if(!b)throw Error('missing_dual_lane_launcher:'+name);b.click();}});await settle();
   assert.equal(requests.length,before);assert.equal(await page.getByRole('dialog',{name:'周期管理授权与受托核对工作区',exact:true}).count(),0);assert.equal(await page.getByRole('dialog',{name:'首次补正审批委托工作区',exact:true}).count(),0);
   await page.evaluate(path=>window.__managementHarness.hold(path,'POST'),paths.groups);await click('保存指定组（一次提交）',paths.groups,'POST');await page.waitForFunction(()=>window.__managementHarness.held());
   const original=await raw(model.seed.slots.delegate);assert(original);const pending=JSON.parse(original);assert.equal(pending.domain,'groups');assert.equal(pending.command.expectedRevision,3);assert.equal(pending.actorId,model.seed.delegate);
   await page.evaluate(()=>window.__managementHarness.visibility(true));await page.evaluate(()=>window.__managementHarness.pagehide());assert.equal(await page.getByLabel('组名称',{exact:true}).count(),0);
   await page.evaluate(()=>window.__managementHarness.release());await settle();assert.equal(await raw(model.seed.slots.delegate),original);await page.evaluate(()=>window.__managementHarness.visibility(false));
   await configure({mode:'strict',ownerMode:false,grant:false,audit:false,groups:false,requester:2});await open();assert(await button('读取审计首页（GET）').isDisabled());assert(await button('读取此授权上下文（GET）').isDisabled());
   for(const recovery of ['null','wrong-sha']){model.recovery(recovery);await click('仅 GET 核验原编号',paths.groups);assert.equal(await raw(model.seed.slots.delegate),original);}
   model.recovery('valid');await click('仅 GET 核验原编号',paths.groups);assert.equal(await raw(model.seed.slots.delegate),null);assert.equal(posts,3);await close();
  });
  await group('requester_A_B_A_Auth_double_epoch_and_hidden_late_response',async()=>{
   await configure({mode:'overview',ownerMode:false,identity:'employee',grant:false,audit:false,groups:true,requester:3});await button('管理委托／资源审计').waitFor();await open();
   await page.getByLabel('真实组管理授权编号',{exact:true}).fill(model.seed.groupGrantId);await page.evaluate(path=>window.__managementHarness.hold(path,'GET'),paths.groups);
   await click('读取此授权上下文（GET）',paths.groups);await page.waitForFunction(()=>window.__managementHarness.held());
   await configure({requester:4,identity:'other'});await button('管理委托／资源审计').waitFor();await configure({requester:3,identity:'employee'});await button('管理委托／资源审计').waitFor();
   await page.evaluate(()=>window.__managementHarness.release());await settle();assert.equal(await dialog().count(),0);
   await configure({mode:'strict',ownerMode:false,identity:'employee',requester:6});await open();
   await page.getByLabel('真实组管理授权编号',{exact:true}).fill(model.seed.groupGrantId);await page.evaluate(path=>window.__managementHarness.hold(path,'GET'),paths.groups);
   await click('读取此授权上下文（GET）',paths.groups);await page.waitForFunction(()=>window.__managementHarness.held());await page.evaluate(()=>window.__managementHarness.authValid(false));
   assert.equal(await dialog().count(),0);await page.evaluate(()=>window.__managementHarness.authValid(true));await page.evaluate(()=>window.__managementHarness.release());await settle();assert.equal(await page.getByLabel('组名称',{exact:true}).count(),0);await open();
   await readGroup();await page.getByLabel('本次组操作理由',{exact:true}).fill('Private draft must clear synchronously');const before=requests.length;
   await page.evaluate(()=>window.__managementHarness.visibility(true));assert.equal(await page.getByLabel('组名称',{exact:true}).count(),0);
   assert.equal(await page.getByLabel('真实组管理授权编号',{exact:true}).inputValue(),'');await page.evaluate(()=>window.__managementHarness.pagehide());await settle();assert.equal(requests.length,before);
   await page.evaluate(()=>window.__managementHarness.visibility(false));await close();
  });
  await group('StrictMode_replay_raw_pending_blocks_no_background_390px',async()=>{
   await configure({mode:'strict',ownerMode:false,groups:true,requester:5});const slot=model.seed.slots.delegate;await page.evaluate(k=>sessionStorage.setItem(k,'{'),slot);
   const before=requests.length;await open();assert(await button('读取此授权上下文（GET）').isDisabled());await button('仅 GET 核验原编号').click();await settle();assert.equal(requests.length,before);assert.equal(await raw(slot),'{');await close();
   await page.evaluate(k=>{if(sessionStorage.getItem(k)!=='{')throw Error('owned_slot_changed');sessionStorage.removeItem(k);},slot);await open();const noHttp=requests.length;
   await button('读取本地状态（不联网）').click();await settle();assert.equal(requests.length,noHttp);await readGroup();assert.equal(await page.getByLabel('组名称',{exact:true}).inputValue(),'Synthetic204 Kitchen');await close();
   const closed=requests.length;await settle();assert.equal(requests.length,closed);assert.equal(downloads,1);assert.deepEqual(errors,[]);
  });
  await group('205_actual_admin_structured_grant_cancel_split_flags_manager_worker_save_shared_pending',async()=>{
   // Admin does not receive a configuration prop: this exercises its REAL
   // Launcher/Panel default env path. Both grant forms confirm-cancel, no POST.
   await configure({mode:'admin',ownerMode:true,grant:true,audit:false,groups:false,configuration:false,requester:10});await page.getByLabel('企业考勤时区',{exact:true}).waitFor();await open();
   await click('读取授权（每页25条）',paths.management);const form=page.locator('details').filter({has:page.locator('summary',{hasText:'授予指定档案／地点保存权（结构化授权）'})});await form.locator('summary').click();
   assert.equal(await form.getByLabel('唯一配置动作',{exact:true}).isDisabled(),false);
   await form.getByLabel('配置受托员工 ID',{exact:true}).fill(model.seed.employeeId);await form.getByLabel('配置受托账户 Auth ID',{exact:true}).fill(model.seed.delegate);
   await form.getByLabel('配置目标 Worker ID',{exact:true}).fill(model.seed.configurationWorkerId);await form.getByLabel('配置目标 Employee ID',{exact:true}).fill(model.seed.configurationEmployeeId);
   await form.getByLabel('配置目标账户 Auth ID',{exact:true}).fill(model.seed.other);await form.getByLabel('配置允许地点 ID（1—25个，逗号或换行分隔）',{exact:true}).fill(model.seed.configurationLocationId);
   await form.getByLabel('配置授权生效时间（UTC）',{exact:true}).fill('2026-10-08T10:00');await form.getByLabel('配置授权失效时间（UTC，不含端点）',{exact:true}).fill('2026-10-09T10:00');
   await form.getByLabel('配置授权理由',{exact:true}).fill('Synthetic205 owner explicitly inspected worker scope');
   const acknowledge='已核验真实双身份、唯一目标、允许地点与期限，只授此一个配置保存动作';await form.getByLabel(acknowledge,{exact:true}).check();
   let confirms=confirmationCount;const beforePosts=posts;accept=false;await button('授予此配置保存权（一次提交）').click();await settle();assert.equal(confirmationCount,confirms+1);assert.equal(posts,beforePosts);
   await form.getByLabel('唯一配置动作',{exact:true}).selectOption('location_save');await form.getByLabel('配置目标 Location ID',{exact:true}).fill(model.seed.configurationLocationId);
   await form.getByLabel(acknowledge,{exact:true}).check();confirms=confirmationCount;await button('授予此配置保存权（一次提交）').click();await settle();assert.equal(confirmationCount,confirms+1);assert.equal(posts,beforePosts);accept=true;await close();
   for(const flags of [{grant:true,configuration:false},{grant:false,configuration:true}]){
    await configure({mode:'strict',ownerMode:true,audit:false,groups:false,...flags,requester:11});await open();await click('读取授权（每页25条）',paths.management);
    await page.locator('summary',{hasText:'授予指定档案／地点保存权（结构化授权）'}).click();assert(await page.getByLabel('唯一配置动作',{exact:true}).isDisabled());await close();
   }
   await configure({ownerMode:false,grant:false,audit:true,groups:true,configuration:false,requester:12});await open();await readConfiguration(model.seed.workerConfigurationGrantId);
   assert(await page.getByLabel('档案显示名称',{exact:true}).isDisabled());assert.equal(await button('生成审计 CSV（一次提交）').isDisabled(),false);await close();
   await configure({mode:'overview',identity:'employee',ownerMode:false,requester:13});await button('管理委托／资源审计').waitFor();await open();await readConfiguration(model.seed.workerConfigurationGrantId);
   assert.equal(requests.at(-1).actor,model.seed.delegate);assert.equal(await page.getByLabel('档案显示名称',{exact:true}).isDisabled(),false);
   await page.getByLabel('档案显示名称',{exact:true}).fill('Synthetic205 worker edited through actual Manager');
   const cfgAck='已核验此授权、固定目标身份、允许地点和上述全局配置版本，只保存此一个资源';await page.getByLabel(cfgAck,{exact:true}).check();
   confirms=confirmationCount;accept=false;await button('保存此指定配置（一次提交）').click();await settle();assert.equal(confirmationCount,confirms+1);assert.equal(posts,beforePosts);accept=true;
   await page.evaluate(path=>window.__managementHarness.hold(path,'POST'),paths.configuration);await click('保存此指定配置（一次提交）',paths.configuration,'POST');await page.waitForFunction(()=>window.__managementHarness.held());
   const original=await raw(model.seed.slots.delegate);assert(original);const pending=JSON.parse(original);assert.equal(pending.domain,'configuration');assert.equal(pending.actorId,model.seed.delegate);
   assert.equal(pending.command.expectedVersion,10);assert.notEqual(pending.command.expectedVersion,3);assert.equal(pending.command.values.id,model.seed.configurationWorkerId);assert.equal(pending.command.values.employeeId,model.seed.configurationEmployeeId);
   await page.evaluate(()=>window.__managementHarness.visibility(true));assert.equal(await page.getByLabel('档案显示名称',{exact:true}).count(),0);assert.equal(await page.getByLabel('真实档案／地点配置授权编号',{exact:true}).inputValue(),'');
   await page.evaluate(()=>window.__managementHarness.release());await settle();assert.equal(await raw(model.seed.slots.delegate),original);await page.evaluate(()=>window.__managementHarness.visibility(false));
   await configure({mode:'strict',ownerMode:false,grant:false,audit:false,groups:false,configuration:false,requester:14});await open();
   for(const name of ['读取审计首页（GET）','读取此授权上下文（GET）','读取配置授权上下文（GET）'])assert(await button(name).isDisabled());
   for(const recovery of ['null','wrong-sha']){model.recovery(recovery);await click('仅 GET 核验原编号',paths.configuration);assert.equal(await raw(model.seed.slots.delegate),original);}
   model.recovery('valid');await click('仅 GET 核验原编号',paths.configuration);assert.equal(await raw(model.seed.slots.delegate),null);assert.equal(posts,4);await close();
  });
  await group('205_actual_manager_fresh_location_context_global_CAS_user_save_original_GET',async()=>{
   await configure({mode:'overview',identity:'employee',ownerMode:false,requester:15});await button('管理委托／资源审计').waitFor();await open();await readConfiguration(model.seed.locationConfigurationGrantId);
   assert.equal(requests.at(-1).actor,model.seed.delegate);assert.equal(await page.getByLabel('工作地点名称',{exact:true}).inputValue(),'Synthetic205 scoped location');
   assert.equal(await page.getByLabel('档案显示名称',{exact:true}).count(),0);await page.getByLabel('工作地点名称',{exact:true}).fill('Synthetic205 location edited through actual Manager');
   await page.getByLabel('工作地点时区（IANA／UTC）',{exact:true}).fill('UTC');await page.getByLabel('已核验此授权、固定目标身份、允许地点和上述全局配置版本，只保存此一个资源',{exact:true}).check();
   await click('保存此指定配置（一次提交）',paths.configuration,'POST');const original=await raw(model.seed.slots.delegate);assert(original);const pending=JSON.parse(original);
   assert.equal(pending.domain,'configuration');assert.equal(pending.command.kind,'location');assert.equal(pending.command.expectedVersion,14);assert.notEqual(pending.command.expectedVersion,4);
   assert.equal(pending.command.values.id,model.seed.configurationLocationId);assert.equal(pending.command.values.timeZone,'UTC');await click('仅 GET 核验原编号',paths.configuration);
   assert.equal(await raw(model.seed.slots.delegate),null);assert.equal(await page.getByLabel('工作地点名称',{exact:true}).count(),0);await close();
  });
  assert.equal(groups.length,7);assert.equal(posts,5);assert.deepEqual(model.writes.filter(w=>w.domain==='configuration').map(w=>w.command.kind),['worker','location']);
  }else if(suite==='rules'){
   await runRulesGroups();assert.equal(groups.length,4);assert.equal(posts,3);assert.equal(downloads,0);
  }else if(suite==='credentials'){
   await runCredentialsGroups();assert.equal(groups.length,3);assert.equal(posts,4);assert.equal(downloads,0);
  }else{
   await runRevisionsGroups();assert.equal(groups.length,3);assert.equal(posts,2);assert.equal(downloads,0);
  }
  assert.deepEqual(errors,[]);
  report={groups,apiRequests:requests.length,gets:requests.filter(r=>r.method==='GET').length,posts,totalHttp,elapsedMs:Date.now()-started,
   actualAdminParent:true,actualEnterpriseManager:true,actualLauncher:true,actualPanel:true,actualUserGrantPost:true,actualUserAuditExportPost:true,actualUserGroupSavePost:true,
   splitFlags:true,actualAuthNotMembership:true,requesterDoubleEpoch:true,AuthDoubleEpoch:true,hiddenClearsBody:true,lateResponseFenced:true,dualLaneGuard:true,
   originalFullShaGetOnly:true,rawPendingPreserved:true,StrictModeReplay:true,configurationFlagIndependent:true,configurationOwnerGrantConfirmedThenCanceled:true,
   actualUserWorkerSavePost:true,actualUserLocationSavePost:true,configurationGlobalCasNotTargetVersion:true,configurationNoEditableIdentity:true,mobileWidth:390,horizontalOverflow:false,initialManagementHTTP:0,
   downloadsObserved:downloads,downloadSaved:false,objectUrlsRemaining:0,syntheticAuth:true,syntheticApi:true,actualAuth:false,actualSql:false,realAuthority:false,
   externalRequests:0,originalWriterPosts:0,diskBundle:false};
  if(suite==='rules')report={groups,apiRequests:requests.length,gets:requests.filter(r=>r.method==='GET').length,posts,totalHttp,elapsedMs:Date.now()-started,
   actualAdminParent:true,actualEnterpriseManager:true,actualLauncher:true,actualPanel:true,ownerRuleActionsInspected:8,ownerRuleGrantPosts:1,
   actualUserBaseRuleDraftPost:true,actualUserOperationalRulePublishPost:true,knownSameLayerRouteChoicesOnly:true,fullUnauthorizedBaselinePreserved:true,
   previewBeforeConfirmation:true,oneSharedActorSlot:true,nestedOriginalOperationId:true,originalFullShaGetOnly:true,rawPendingPreserved:true,
   rulesFlagIndependent:true,StrictModeReplay:true,hiddenClearsBody:true,lateResponseFenced:true,AuthDoubleEpoch:true,dualLaneGuard:true,
   mobileWidth:390,horizontalOverflow:false,initialManagementHTTP:0,downloadsObserved:downloads,downloadSaved:false,objectUrlsRemaining:0,
   syntheticAuth:true,syntheticApi:true,actualAuth:false,actualSql:false,realAuthority:false,externalRequests:0,originalWriterPosts:0,diskBundle:false};
  if(suite==='credentials')report={groups,apiRequests:requests.length,gets:requests.filter(r=>r.method==='GET').length,posts,totalHttp,elapsedMs:Date.now()-started,
   actualAdminParent:true,actualEnterpriseManager:true,actualLauncher:true,actualPanel:true,ownerCredentialActionsInspected:4,ownerPinIdentityShapesInspected:2,ownerCredentialGrantPosts:0,
   actualTerminalPreparePost:true,actualMemberPinIssuePost:true,actualTerminalRevokePost:true,actualMemberPinRevokePost:true,terminalAuditActionNotCAS:true,
   sharedActorSlot:true,secretFreePending:true,transientReadonlyPairDisplay:true,pair15sCleared:true,PIN15sCleared:true,hiddenClearsSecrets:true,AuthClearsSecrets:true,
   lostReplyOnlyOriginalGet:true,wrongReceiptPreservesOriginal:true,flagsOffOriginalGet:true,flagsOffNoNewRevoke:true,actualAuthNotMembership:true,lateResponseFenced:true,
   StrictModeReplay:true,mobileWidth:390,horizontalOverflow:false,initialManagementHTTP:0,downloadsObserved:0,downloadSaved:false,objectUrlsRemaining:0,
   syntheticAuth:true,syntheticApi:true,actualAuth:false,actualSql:false,actualKdf:false,actualDevice:false,realAuthority:false,externalRequests:0,originalWriterPosts:0,diskBundle:false};
  if(suite==='revisions')report={groups,apiRequests:requests.length,gets:requests.filter(r=>r.method==='GET').length,posts,totalHttp,elapsedMs:Date.now()-started,
   actualAdminParent:true,actualEnterpriseManager:true,actualLauncher:true,actualPanel:true,ownerRevisionActionsInspected:2,ownerRevisionGrantPosts:0,
   actualApprovePost:true,actualRejectPost:true,originalSubmittedProposedReadonly:true,grantOneActionOnly:true,oldV2StrictParser:true,
   sharedActorSlot:true,fullCommandShaOriginalGet:true,lostReplyOnlyOriginalGet:true,wrongReceiptPreservesOriginal:true,flagsOffOriginalGet:true,flagsOffNoNewWrite:true,
   hiddenClearsBodyAndReason:true,AuthClearsBody:true,requesterDoubleEpoch:true,lateResponseFenced:true,StrictModeReplay:true,
   mobileWidth:390,horizontalOverflow:false,initialManagementHTTP:0,downloadsObserved:0,downloadSaved:false,objectUrlsRemaining:0,
   syntheticAuth:true,syntheticApi:true,actualAuth:false,actualSql:false,actualKdf:false,realAuthority:false,externalRequests:0,originalWriterPosts:0,diskBundle:false};
 }catch(error){failure=Error(`management_browser_failed:${stage}:${error.message}:${JSON.stringify({errors,completedGroups:groups,apiRequests:requests.length,posts,totalHttp,elapsedMs:Date.now()-started,last:requests.slice(-6).map(r=>({path:r.path,method:r.method,mode:r.query?.mode,action:r.command?.action??r.command?.decision?.action}))})}`,{cause:error});throw failure;}
 finally{closing=true;clearTimeout(timer);await runAttendanceCleanupSteps([{name:'held body',run:async()=>{if(page&&!page.isClosed())await page.evaluate(()=>window.__managementHarness?.release()).catch(()=>{});}},
  {name:'owned context',run:()=>context?bounded(context.close(),6000):undefined},{name:'owned browser',run:()=>browser?bounded(browser.close(),6000):undefined},
  {name:'HTTP work',run:()=>bounded(Promise.allSettled([...inflight]),6000)},{name:'owned listener',run:()=>{server?.closeAllConnections();return server?.listening?bounded(new Promise((yes,no)=>server.close(e=>e?no(e):yes())),6000):undefined;}},
  {name:'esbuild',run:async()=>{(await import('esbuild')).stop();}}]).catch(error=>{if(failure)throw new AggregateError([failure,error],'management_browser_cleanup_failed');throw error;});
  assert(!browser?.isConnected()&&!server?.listening);if(failure)console.error(JSON.stringify({cleanup:'management-browser',browserClosed:!browser?.isConnected(),listenerStopped:!server?.listening,apiRequests:requests.length,posts,totalHttp}));}
 return{...report,browserClosed:true,listenerStopped:true};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv.length===3&&['--run-local','--run-local-rules','--run-local-credentials','--run-local-revisions'].includes(process.argv[2]))console.log(JSON.stringify(await verifyManagementBrowser({suite:process.argv[2]==='--run-local-revisions'?'revisions':process.argv[2]==='--run-local-credentials'?'credentials':process.argv[2]==='--run-local-rules'?'rules':'legacy'})));
 else if(process.argv.length===2)console.log('Inert. node --import tsx scripts/fixtures/attendance-management-delegated-browser.mjs --run-local OR --run-local-rules OR --run-local-credentials OR --run-local-revisions');else throw Error('explicit_run_local_only');
}
