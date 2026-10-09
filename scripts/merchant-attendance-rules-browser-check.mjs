// Real RulesLauncher/Panel/Client -> real handler/service/parser -> owned SQL.
// Auth and entitlement are explicitly synthetic. No Next server, real Auth,
// production, external resources, downloads or persistent build artifacts.
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
import {prepareRulesNativeFixture} from './merchant-attendance-rules-native.mjs';
import {lifecycleId} from './merchant-attendance-lifecycle-native-support.mjs';
import {runAttendanceCleanupSteps} from './fixtures/attendance-cleanup.mjs';

const root=fileURLToPath(new URL('../',import.meta.url)),require=createRequire(import.meta.url);
const endpoint='/api/merchant-enterprise/attendance/rules',canonical='https://www.faolla.com';
const groupId=lifecycleId(7001),unrelatedKey='qa-unrelated-rule-version';
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
async function bounded(promise){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('rules_browser_timeout')),15000);})]);}finally{clearTimeout(timer);}}

async function assets(){
  const bundle=await build({absWorkingDir:root,entryPoints:['scripts/fixtures/attendance-rules-browser.tsx'],bundle:true,write:false,metafile:true,
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

export async function checkAttendanceRulesBrowser(native,scope){
  const [adminSource,groupsSource,launcherSource,groupsLauncherSource]=await Promise.all([
    'src/components/enterprise/MerchantAttendanceAdminPanel.tsx','src/components/enterprise/MerchantAttendanceGroupsPanel.tsx',
    'src/components/enterprise/MerchantAttendanceRulesLauncher.tsx','src/components/enterprise/MerchantAttendanceGroupsLauncher.tsx',
  ].map(filename=>readFile(path.join(root,filename),'utf8')));
  assert.match(adminSource,/<RulesLauncher key=\{`rules:\$\{siteId\}:\$\{ownerId\}:\$\{state\.authorizationEpoch\}`\}/);
  assert(adminSource.includes('groupId={null} apiFetch={apiFetch}'));
  assert(adminSource.includes('rulesAuthorizationEpoch={state.authorizationEpoch}'));
  assert(groupsLauncherSource.includes('rulesAuthorizationEpoch?: number'));
  assert(groupsSource.includes('<RulesLauncher key={rulesAuthorizationEpoch}'));
  assert(groupsSource.includes('groupId={result.group.groupId} apiFetch={apiFetch} active={!locked && !dirty}'));
  assert(launcherSource.includes('process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_RULES_ENABLED === "1"'));
  assert(launcherSource.includes('if (!enabled || !active) return null'));
  assert(launcherSource.includes('dialog.showModal()'));
  assert(launcherSource.includes('onCancel={event => { event.preventDefault(); requestClose(); }}'));
  const data=await prepareRulesNativeFixture(native,scope),initial=data.read(),siteId=initial.siteId,ownerId=initial.actorId;
  assert.equal(siteId,'99990001');assert.equal(ownerId,lifecycleId(99));assert.equal(data.read({groupId}).group.groupId,groupId);
  const protectedBefore=data.protectedFingerprint();
  const tomorrow=data.exec("select ((clock_timestamp() at time zone 'UTC')::date+1)::text;");
  const counts=()=>JSON.parse(data.exec(`select jsonb_build_object('streams',(select count(*)::integer from public.merchant_attendance_rule_streams),
    'operations',(select count(*)::integer from public.merchant_attendance_rule_operations));`));
  const {handleRules}=require('../src/app/api/merchant-enterprise/attendance/rules/route-handler.ts');
  const {executeRules}=require('../src/lib/merchantAttendanceRules.server.ts');
  const {parseRulesBody,parseRulesQuery,RULES_ERRORS}=require('../src/lib/merchantAttendanceRules.ts');
  const files=await assets(),requests=[],errors=[],gates=new Set(),pending=new Set();
  let browser,origin,closing=false,moduleEnabled=true,loseSuccessfulPost=false,hold=null,checks=0,serviceCalls=0;
  const service={rpc:async(name,args)=>{
    assert.equal(name,'faolla_attendance_rules_v1');assert.deepEqual(Object.keys(args).sort(),['p_allow_write','p_auth_user_id','p_command','p_query']);
    assert.equal(args.p_auth_user_id,ownerId);assert.equal(typeof args.p_allow_write,'boolean');
    const query=parseRulesQuery(args.p_query),command=args.p_command===null?null:parseRulesBody({query,command:args.p_command}).command;
    assert.equal(query.siteId,siteId);assert([null,groupId].includes(query.groupId));serviceCalls++;
    try{return {data:data.call(query,command,args.p_allow_write,args.p_auth_user_id),error:null};}
    catch(error){const code=String(error).match(/ERROR:\s+([a-z_]+)(?=\r?\n|$)/)?.[1];if(!Object.hasOwn(RULES_ERRORS,code??''))throw error;return {data:null,error:{message:code}};}
  }};
  const dependencies={enabled:()=>true,authenticate:async()=>({user:{id:ownerId},authenticationMethods:['password']}),allow:()=>true,
    entitlement:async requestedSite=>{assert.equal(requestedSite,siteId);return {permissionConfig:{allowEnterpriseManagement:true,allowEmployeeAttendance:moduleEnabled}};},
    execute:input=>executeRules(input,service)};
  const server=createServer((request,response)=>{
    if(!origin||request.headers.host!==new URL(origin).host||request.method!=='GET')return response.writeHead(403).end();
    response.setHeader('Cache-Control','no-store');response.setHeader('X-Content-Type-Options','nosniff');
    response.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'");
    const url=new URL(request.url??'/',origin);if(url.search)return response.writeHead(403).end();
    if(url.pathname==='/')return response.writeHead(200,{'Content-Type':'text/html;charset=utf-8'}).end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>隔离候选规则版本验收</title><link rel="stylesheet" href="/qa.css"><div id="qa-root"></div><script type="module" src="/qa.js"></script></html>');
    if(url.pathname==='/qa.js')return response.writeHead(200,{'Content-Type':'text/javascript;charset=utf-8'}).end(files.javascript);
    if(url.pathname==='/qa.css')return response.writeHead(200,{'Content-Type':'text/css;charset=utf-8'}).end(files.css);
    return response.writeHead(403).end();
  });
  const posts=()=>requests.filter(request=>request.method==='POST').length;
  const gateNextRead=()=>{assert.equal(hold,null);const gate={ready:deferred(),release:deferred(),finished:deferred()};gates.add(gate);hold=gate;return gate;};
  const panel=page=>page.getByRole('region',{name:'考勤规则版本记录（未应用）',exact:true});
  const modal=page=>page.getByRole('dialog',{name:'考勤规则版本管理（未应用）',exact:true});
  const receipt=page=>panel(page).getByRole('region',{name:'原操作收据',exact:true});
  const history=page=>panel(page).getByRole('region',{name:'规则版本历史',exact:true});
  const lateMode=page=>panel(page).locator('select[id$="lateGraceMinutes-mode"]');
  const lateMinutes=page=>panel(page).locator('input[id$="lateGraceMinutes-value"]');
  // These deliberately model external lifecycle/identity changes. A real user
  // cannot click parent controls while the native rules dialog is modal.
  const forceControl=async(page,label)=>page.locator('.qa-controls button').filter({hasText:label}).evaluate(element=>element.click());
  const forceSelection=async(page,label,value)=>page.locator(`.qa-controls select[aria-label="${label}"]`).evaluate((element,value)=>{
    element.value=value;element.dispatchEvent(new Event('change',{bubbles:true}));
  },value);
  const ready=async(page,isGroup=false)=>{await panel(page).getByText(isGroup?'当前目标':'企业默认层',{exact:true}).waitFor();await panel(page).getByRole('button',{name:'重新读取规则版本',exact:true}).waitFor();};
  const open=async(page,isGroup=false)=>{await page.getByRole('button',{name:isGroup?'本组规则版本（未应用）':'企业规则版本（未应用）',exact:true}).click();};
  const enable=async page=>{await page.getByRole('button',{name:'开启验收入口',exact:true}).click();};
  const waitReceipt=async(page,revision,action)=>{await receipt(page).getByText(new RegExp(`记录版本 ${revision} · ${action}`)).waitFor();};
  const save=async(page,reason,value='0')=>{
    await lateMode(page).selectOption('value');await lateMinutes(page).fill(value);
    await panel(page).getByLabel('保存草稿原因',{exact:true}).fill(reason);
    await panel(page).getByRole('button',{name:'保存本层草稿',exact:true}).click();
  };
  const publish=async(page,reason)=>{
    await panel(page).getByLabel('未来拟生效日期（企业时区）',{exact:true}).fill(tomorrow);
    await panel(page).getByLabel('登记未来版本原因',{exact:true}).fill(reason);
    await panel(page).getByRole('button',{name:'确认登记已保存草稿',exact:true}).click();await waitReceipt(page,2,'登记未来版本');
  };
  const withdraw=async(page,reason)=>{
    await history(page).getByLabel('撤回版本 2 的原因',{exact:true}).fill(reason);
    await history(page).getByRole('button',{name:'请求撤回尚未生效的版本 2',exact:true}).click();await waitReceipt(page,3,'撤回未来版本');
  };
  try{
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    const address=server.address();assert(address&&typeof address==='object');origin=`http://127.0.0.1:${address.port}`;
    browser=await chromium.launch({headless:true});
    const run=async(name,check,width=1280)=>{
      moduleEnabled=true;const context=await browser.newContext({serviceWorkers:'block',acceptDownloads:false,viewport:{width,height:1100}});
      try{
        await context.addInitScript(key=>{sessionStorage.setItem(key,'preserve');const probe={csp:[],localStorageWrites:0};Object.defineProperty(window,'__rulesBrowserProbe',{value:probe});
          const original=Storage.prototype.setItem;Storage.prototype.setItem=function(...args){if(this===localStorage)probe.localStorageWrites++;return original.apply(this,args);};
          document.addEventListener('securitypolicyviolation',event=>probe.csp.push(event.violatedDirective));},unrelatedKey);
        await context.route('**/*',route=>{
          if(closing)return route.abort().catch(()=>{});
          const work=(async()=>{
            const request=route.request(),url=new URL(request.url());assert.equal(url.origin,origin,'external_request_blocked');
            if(['/', '/qa.js','/qa.css'].includes(url.pathname)){assert.equal(request.method(),'GET');assert.equal(url.search,'');return route.continue();}
            assert.equal(url.pathname,endpoint);assert(['GET','POST'].includes(request.method()));assert(requests.length<48,'request_budget_exceeded');
            const headers=new Headers({'Host':'www.faolla.com','Origin':canonical,'Content-Type':'application/json'});
            const response=await handleRules(new Request(canonical+endpoint+url.search,{method:request.method(),headers,body:request.postData()??undefined}),dependencies);
            const body=await response.text(),parsed=JSON.parse(body);assert.equal(response.headers.get('Cache-Control'),'private, no-store');
            requests.push({method:request.method(),search:url.search,status:response.status,body:parsed});
            if(request.method()==='POST'&&response.status===200&&loseSuccessfulPost){loseSuccessfulPost=false;return route.abort('failed');}
            const gate=request.method()==='GET'?hold:null;
            if(gate){hold=null;gate.ready.resolve(parsed);await gate.release.promise;}
            try{await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body});}
            catch(error){if(!gate&&!closing)throw error;}
            finally{if(gate){gate.finished.resolve();gates.delete(gate);}}
          })();pending.add(work);void work.finally(()=>pending.delete(work)).catch(()=>{});
          return work.catch(async()=>{if(!closing)errors.push('route_failed');await route.abort().catch(()=>{});});
        });
        const page=await context.newPage();page.setDefaultTimeout(10000);
        page.on('pageerror',error=>errors.push(error.message));page.on('download',()=>errors.push('unexpected_download'));page.on('popup',()=>errors.push('unexpected_popup'));
        let nextConfirm='accept';const confirmations=[];
        const dialogs={confirmations,dismissNextConfirm:()=>{assert.equal(nextConfirm,'accept');nextConfirm='dismiss';}};
        page.on('dialog',dialog=>{
          if(dialog.type()==='confirm'){
            const disposition=nextConfirm;nextConfirm='accept';confirmations.push({message:dialog.message(),disposition});
            void (disposition==='dismiss'?dialog.dismiss():dialog.accept()).catch(()=>errors.push('dialog_resolution_failed'));
          }else{errors.push('unexpected_dialog');void dialog.dismiss().catch(()=>errors.push('dialog_resolution_failed'));}
        });
        await page.goto(origin);await page.getByRole('button',{name:'开启验收入口',exact:true}).waitFor();
        try{await check(page,dialogs);}catch(error){error.message=`${name}: ${error.message}`;throw error;}
        assert.equal(nextConfirm,'accept','unused_confirm_disposition');
        assert.deepEqual(await page.evaluate(()=>window.__rulesBrowserProbe),{csp:[],localStorageWrites:0});
        assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),unrelatedKey),'preserve');
        assert.equal(await page.evaluate(()=>Object.keys(sessionStorage).filter(key=>key.startsWith('faolla:attendance:rules:v1:')).length),0,'pending_not_cleared');
        assert.equal(data.protectedFingerprint(),protectedBefore,'browser_changed_old_facts');checks++;native.pass(name);
      }finally{for(const gate of gates)gate.release.resolve();await context.close();}
    };

    await run('rules browser default-off and closed launcher make zero API reads; explicit open reads actual empty SQL context',async page=>{
      assert.equal(requests.length,0);assert.equal(await panel(page).count(),0);
      assert.equal(await page.getByRole('button',{name:'企业规则版本（未应用）',exact:true}).count(),0);
      await enable(page);assert.equal(requests.length,0);await open(page);await ready(page);
      assert.equal(requests.length,1);assert.equal(requests[0].method,'GET');assert.equal(requests[0].body.revision,0);
      assert.deepEqual(counts(),{streams:0,operations:0});assert.equal(await page.locator('form form').count(),0);
    });
    await run('rules browser enterprise explicit-zero draft publishes tomorrow and withdraws through actual handler SQL receipts',async(page,dialogs)=>{
      await enable(page);await open(page);await ready(page);
      await panel(page).locator('select[id$="earlyGraceMinutes-mode"]').selectOption('disabled');
      await save(page,'Browser enterprise zero draft');await waitReceipt(page,1,'保存草稿');
      assert.equal(dialogs.confirmations.length,1);assert.equal(dialogs.confirmations[0].disposition,'accept');
      assert.match(dialogs.confirmations[0].message,/^将当前规则输入保存为企业默认层/);
      assert.deepEqual(data.read().draft.rules.lateGraceMinutes,{mode:'value',minutes:0});
      assert.deepEqual(data.read().draft.rules.earlyGraceMinutes,{mode:'disabled'});
      await publish(page,'Browser enterprise tomorrow');const published=data.read();assert.equal(published.draft,null);
      assert.equal(published.items[0].effectiveAt,tomorrow+'T00:00:00.000Z');assert.equal(published.items[0].actorId,ownerId);
      // Publishing consumes the saved draft. These replacement values are ONLY
      // unsaved editor input; cancellation must not silently discard them.
      await lateMode(page).selectOption('value');await lateMinutes(page).fill('37');
      await panel(page).getByLabel('保存草稿原因',{exact:true}).fill('Unsaved replacement must survive cancelled withdrawal');
      await history(page).getByLabel('撤回版本 2 的原因',{exact:true}).fill('Browser cancelled withdrawal');
      const beforeEsc={requests:requests.length,posts:posts(),facts:data.fingerprint(),confirmations:dialogs.confirmations.length};
      assert.equal(await modal(page).evaluate(element=>element.matches(':modal')),true);
      // This is a real Playwright pointer action, not an evaluate shortcut: the
      // browser must refuse access to the underlying parent while modal.
      await assert.rejects(page.locator('.qa-controls button').filter({hasText:'卸载验收规则'}).click({timeout:600}),/Timeout|intercepts pointer events/);
      const escapePrompt=page.waitForEvent('dialog',{timeout:5000});
      dialogs.dismissNextConfirm();await page.keyboard.press('Escape');await escapePrompt;
      assert.equal(dialogs.confirmations.length,beforeEsc.confirmations+1);assert.equal(dialogs.confirmations.at(-1).disposition,'dismiss');
      assert.match(dialogs.confirmations.at(-1).message,/^未提交的规则输入将清除/);
      assert.equal(await modal(page).evaluate(element=>element.matches(':modal')),true);
      assert.equal(await lateMinutes(page).inputValue(),'37');
      assert.equal(await panel(page).getByLabel('保存草稿原因',{exact:true}).inputValue(),'Unsaved replacement must survive cancelled withdrawal');
      assert.equal(await history(page).getByLabel('撤回版本 2 的原因',{exact:true}).inputValue(),'Browser cancelled withdrawal');
      assert.equal(requests.length,beforeEsc.requests);assert.equal(posts(),beforeEsc.posts);assert.equal(data.fingerprint(),beforeEsc.facts);checks++;
      native.pass('rules browser native modal blocks parent interaction and cancelled Escape retains unsent inputs without requests');
      const beforeCancel={requests:requests.length,posts:posts(),facts:data.fingerprint(),confirmations:dialogs.confirmations.length};
      dialogs.dismissNextConfirm();
      await history(page).getByRole('button',{name:'请求撤回尚未生效的版本 2',exact:true}).click();
      assert.equal(dialogs.confirmations.length,beforeCancel.confirmations+1);assert.equal(dialogs.confirmations.at(-1).disposition,'dismiss');
      assert.match(dialogs.confirmations.at(-1).message,/^请求撤回版本 2（目标：企业默认层/);
      assert(dialogs.confirmations.at(-1).message.includes('本页其他尚未提交的输入将清除，且不会随本次操作保存。'));
      assert.equal(await lateMode(page).inputValue(),'value');assert.equal(await lateMinutes(page).inputValue(),'37');
      assert.equal(await panel(page).getByLabel('保存草稿原因',{exact:true}).inputValue(),'Unsaved replacement must survive cancelled withdrawal');
      assert.equal(await history(page).getByLabel('撤回版本 2 的原因',{exact:true}).inputValue(),'Browser cancelled withdrawal');
      assert.equal(requests.length,beforeCancel.requests);assert.equal(posts(),beforeCancel.posts);assert.equal(data.fingerprint(),beforeCancel.facts);
      assert.equal(data.protectedFingerprint(),protectedBefore);checks++;
      native.pass('rules browser cancelled cross-form withdrawal retains unsaved replacement values and reasons with zero requests or ledger writes');
      await withdraw(page,'Browser enterprise withdrawal');assert.equal(data.read().items.find(item=>item.revision===2).withdrawnByRevision,3);
      assert.deepEqual(data.read().items.find(item=>item.revision===2).rules.lateGraceMinutes,{mode:'value',minutes:0});
      assert.equal(data.read({groupId}).revision,0);assert.equal(posts(),3);assert.deepEqual(counts(),{streams:1,operations:3});
    });
    await run('rules browser selected group starts independently with inherit choices and its own save-publish-withdraw ledger',async page=>{
      const enterprise=JSON.stringify(data.read());await enable(page);await page.getByLabel('验收目标',{exact:true}).selectOption(groupId);await open(page,true);await ready(page,true);
      assert.equal(await lateMode(page).inputValue(),'inherit');assert.equal(await lateMinutes(page).inputValue(),'');
      assert.equal(await panel(page).locator('select[id$="earlyGraceMinutes-mode"]').inputValue(),'inherit');
      await save(page,'Browser group seven draft','7');await waitReceipt(page,1,'保存草稿');
      assert.equal(data.read({groupId}).draft.groupRevision,1);await publish(page,'Browser group tomorrow');await withdraw(page,'Browser group withdrawal');
      assert.equal(data.read({groupId}).revision,3);assert.deepEqual(data.read({groupId}).items.find(item=>item.revision===2).rules.lateGraceMinutes,{mode:'value',minutes:7});
      assert.equal(JSON.stringify(data.read()),enterprise,'group_write_changed_enterprise');assert.equal(posts(),6);assert.deepEqual(counts(),{streams:2,operations:6});
    });
    await run('rules browser lost successful POST recovers its original receipt by paused GET without another POST',async page=>{
      await enable(page);await open(page);await ready(page);loseSuccessfulPost=true;
      await save(page,'Browser lost successful save');await panel(page).getByRole('status').filter({hasText:'无法可靠确认结果'}).waitFor();
      const key=`faolla:attendance:rules:v1:${siteId}:${ownerId}:enterprise`;
      const stored=JSON.parse(await page.evaluate(key=>sessionStorage.getItem(key),key));assert.equal(stored.command.action,'save_draft');assert.equal(stored.command.expectedRevision,3);
      assert.equal(posts(),7);assert.equal(data.read().revision,4);const confirmed=data.read({operationId:stored.command.operationId}).receipt;
      moduleEnabled=false;await panel(page).getByRole('button',{name:'查询原操作收据',exact:true}).click();await waitReceipt(page,4,'保存草稿');
      assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),key),null);assert.equal(posts(),7);
      assert(requests.some(request=>request.method==='GET'&&new URLSearchParams(request.search).get('operationId')===stored.command.operationId));
      assert.deepEqual(requests.at(-1).body.receipt,confirmed);assert.equal(requests.at(-1).body.moduleEnabled,false);
      assert.equal(await panel(page).getByRole('button',{name:'保存本层草稿',exact:true}).isDisabled(),true);assert.deepEqual(counts(),{streams:2,operations:7});
    });
    await run('rules browser held reads cannot restore hidden unmounted previous-target or previous-owner details',async page=>{
      const baseline=data.fingerprint();await enable(page);
      let gate=gateNextRead();await open(page);await bounded(gate.ready.promise);
      await forceControl(page,'隐藏验收文档');gate.release.resolve();await bounded(gate.finished.promise);
      assert.equal(await panel(page).locator('dl').count(),0);assert.equal(await receipt(page).count(),0);
      await forceControl(page,'显示验收文档');await ready(page);await panel(page).getByRole('button',{name:'关闭规则版本',exact:true}).click();
      gate=gateNextRead();await open(page);await bounded(gate.ready.promise);
      await forceControl(page,'卸载验收规则');gate.release.resolve();await bounded(gate.finished.promise);assert.equal(await panel(page).count(),0);
      await page.getByRole('button',{name:'重挂验收规则',exact:true}).click();gate=gateNextRead();await open(page);await bounded(gate.ready.promise);
      await forceSelection(page,'验收目标',groupId);gate.release.resolve();await bounded(gate.finished.promise);assert.equal(await panel(page).count(),0);
      await open(page,true);await ready(page,true);assert.equal(await panel(page).getByText('企业默认层',{exact:true}).count(),0);
      await panel(page).getByRole('button',{name:'关闭规则版本',exact:true}).click();gate=gateNextRead();await open(page,true);await bounded(gate.ready.promise);
      await forceControl(page,'递增验收授权代次');gate.release.resolve();await bounded(gate.finished.promise);assert.equal(await panel(page).count(),0);
      gate=gateNextRead();await open(page,true);await bounded(gate.ready.promise);
      await forceSelection(page,'验收身份',lifecycleId(98));gate.release.resolve();await bounded(gate.finished.promise);assert.equal(await panel(page).count(),0);
      assert.equal(data.fingerprint(),baseline,'lifecycle_reads_changed_ledger');assert.equal(posts(),7);
    });
    await run('rules browser 390px layout and blank minutes reject locally without treating blank as zero or adding an operation',async page=>{
      await enable(page);await open(page);await ready(page);const baseline=data.fingerprint(),reads=requests.length;
      await lateMode(page).selectOption('value');await lateMinutes(page).fill('');await panel(page).getByLabel('保存草稿原因',{exact:true}).fill('Browser invalid blank');
      await panel(page).getByRole('button',{name:'保存本层草稿',exact:true}).click();await panel(page).getByRole('alert').waitFor();
      assert.match(await panel(page).getByRole('alert').innerText(),/空白不等于 0/);assert.equal(requests.length,reads);assert.equal(posts(),7);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'horizontal_overflow');
      assert.equal(await lateMode(page).evaluate(element=>element.getBoundingClientRect().width>200),true);assert.equal(await page.locator('form form').count(),0);
      assert.equal(data.fingerprint(),baseline);assert.deepEqual(counts(),{streams:2,operations:7});
      const beforeEpoch=requests.length;
      await forceControl(page,'递增验收授权代次');await panel(page).waitFor({state:'detached'});
      assert.equal(await modal(page).count(),0);assert.equal(requests.length,beforeEpoch,'epoch_change_must_not_auto_read');
      assert.equal(await page.evaluate(()=>Object.keys(sessionStorage).filter(key=>key.startsWith('faolla:attendance:rules:v1:')).length),0);
      await open(page);await ready(page);
      assert.equal(requests.length,beforeEpoch+1);assert.equal(requests.at(-1).method,'GET');assert.equal(posts(),7);
      assert.equal(await lateMinutes(page).inputValue(),'0','new_epoch_reloads_saved_draft_not_dirty_blank');
      assert.equal(await panel(page).getByLabel('保存草稿原因',{exact:true}).inputValue(),'');
      assert.equal(data.fingerprint(),baseline);assert.equal(data.protectedFingerprint(),protectedBefore);checks++;
      native.pass('rules browser same-owner target authorization epoch replaces only the new keyed launcher and clears dirty inputs without POST');
    },390);
    assert.deepEqual(errors,[]);assert.equal(serviceCalls,requests.length);assert.equal(posts(),7);assert.equal(data.protectedFingerprint(),protectedBefore);
    return {checks,streams:2,operations:7,apiRequests:requests.length,posts:7,externalRequests:0,productionAccess:false,realAuth:false,
      actualHandlerServiceSql:true,syntheticOnly:true,oldFactsUnchanged:true,callerOwnedNamespaceCleanup:true};
  }finally{
    closing=true;for(const gate of gates)gate.release.resolve();
    await runAttendanceCleanupSteps([
      {name:'rules-browser',run:async()=>{await browser?.close();}},
      {name:'rules-intercepted-requests',run:async()=>{await Promise.allSettled([...pending]);}},
      {name:'rules-loopback',run:async()=>{if(server.listening){server.closeAllConnections();await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}}},
    ]);
  }
}
