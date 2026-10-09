//194 Inert imports only. Root starts this in the existing owned schema, after
//193's regression has returned the target employee to active. Exactly one real
//PATCH creates a lost-response pending intent. Every later browser API is GET.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {build,stop} from 'esbuild';
import {compile} from '@tailwindcss/node';
import ts from 'typescript';
import {chromium} from 'playwright';
import {runAttendanceCleanupSteps} from './attendance-cleanup.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url)),canonical='https://www.faolla.com';
const endpoint='/api/merchant-enterprise/attendance/account-suspensions',employees='/api/merchant-enterprise/employees';
const overview='/api/merchant-enterprise/overview',currentOperations='/api/merchant-enterprise/current-operations',memberships='/api/merchant-enterprise/memberships';
const notifications='/api/merchant-enterprise/notifications';
const managerPath='/qa-manager',selectorPath='/enterprise',recoveryPath='/enterprise/attendance-recovery';
const documents=[managerPath,selectorPath,recoveryPath],assetsPaths=['/qa.js','/qa.css'];
const authSource=`
  const seed=()=>window.__accountStatusRecoverySeed;
  const probe=()=>window.__accountStatusRecoveryProbe;
  export const isEnterpriseLogoutBlocked=()=>false;
  export const onEnterpriseAuthStateChange=()=>({data:{subscription:{unsubscribe(){}}}});
  const forbidden=()=>{throw Error('synthetic_auth_write_forbidden');};
  export const signInEnterpriseWithPassword=forbidden,signOutEnterpriseSession=forbidden;
  export const merchantEnterpriseSupabase={auth:{
    getSession:async()=>{probe().getSession++;return {data:{session:{access_token:seed().token,user:{id:seed().auth}}},error:null};},
    getUser:async(token)=>{probe().getUser++;if(token!==seed().token)throw Error('synthetic_auth_token_mismatch');
      return seed().mode==='failed'?{data:{user:null},error:{message:'synthetic getUser verification failed'}}
        :{data:{user:{id:seed().auth}},error:null};},
    exchangeCodeForSession:forbidden,setSession:forbidden,updateUser:forbidden
  }};
`;
const linkSource='import {createElement} from "react";export default function Link({href,children,...props}){return createElement("a",{...props,href},children);}';
async function bounded(promise){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('account_status_recovery_browser_timeout')),15000);})]);}finally{clearTimeout(timer);}}
async function cleanup(steps,primary){
  try{assert(Array.isArray(steps)&&steps.every(s=>s&&typeof s==='object'&&!Array.isArray(s)&&typeof s.name==='string'&&typeof s.run==='function'),'account_status_recovery_cleanup_shape');await runAttendanceCleanupSteps(steps);}
  catch(error){if(primary)throw new AggregateError([primary,error],'account_status_recovery_and_cleanup_failed',{cause:primary});throw error;}
}
async function assets(){
  const bundle=await build({absWorkingDir:root,entryPoints:['scripts/fixtures/attendance-account-status-recovery-browser.tsx'],bundle:true,write:false,metafile:true,
    platform:'browser',format:'esm',target:['es2020'],jsx:'automatic',tsconfig:path.join(root,'tsconfig.json'),outfile:'qa.js',logLevel:'warning',
    define:{'process.env':'{}','process.env.NODE_ENV':'"development"'},plugins:[{name:'isolated-account-recovery-auth-and-link',setup(b){
      b.onResolve({filter:/^(?:@\/lib\/merchantEnterpriseSupabase|next\/link)$/},args=>({path:args.path,namespace:'account-recovery-fixture'}));
      b.onLoad({filter:/.*/,namespace:'account-recovery-fixture'},args=>({contents:args.path==='next/link'?linkSource:authSource,loader:'js',resolveDir:root}));
    }}]});
  const inputs=Object.keys(bundle.metafile.inputs);
  for(const expected of ['MerchantEnterpriseManager.tsx','EnterpriseSelectorClient.tsx','MerchantAttendanceDelegationRecoveryPage.tsx','merchantAttendanceRecovery.ts','merchantAttendanceAccountStatusRecovery.ts'])assert(inputs.some(n=>n.endsWith(expected)),'missing_actual_browser_path '+expected);
  for(const name of inputs)assert(!/node:crypto|\.server\.ts$|@supabase\//.test(name),'account_recovery_server_or_live_auth_import');
  const candidates=new Set();for(const name of inputs.filter(n=>/\.tsx?$/.test(n)&&!n.includes('node_modules')&&!n.startsWith('account-recovery-fixture:'))){
    const ast=ts.createSourceFile(name,await readFile(path.join(root,name),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
    const visit=node=>{if(ts.isStringLiteral(node)||ts.isNoSubstitutionTemplateLiteral(node)||ts.isTemplateHead(node)||ts.isTemplateMiddle(node)||ts.isTemplateTail(node))node.text.split(/\s+/).filter(Boolean).forEach(v=>candidates.add(v));ts.forEachChild(node,visit);};visit(ast);
  }
  const css=(await compile('@import "tailwindcss";',{base:root,onDependency:()=>{}})).build([...candidates])
    +'body{margin:0;font-family:Arial,sans-serif}.qa-disclaimer{padding:8px;background:#fff7ed;font-size:12px;overflow-wrap:anywhere}.qa-manager{max-width:1000px;margin:auto;min-width:0}';
  return {js:bundle.outputFiles.find(f=>f.path.endsWith('.js')).contents,css};
}

export async function runAccountStatusRecoveryBrowserAcceptance(ctx){
  const {d,h,employeeId,employeeName,withRestrictedRole,statusRecoveryPorts:ports}=ctx??{},scope=ctx?.scope??d?.owned;
  assert(d?.syntheticOnly===true&&h?.syntheticOnly===true&&scope?.schema===d.owned.schema&&employeeId&&employeeName&&typeof withRestrictedRole==='function','account_status_recovery_owned_context');
  assert(ports?.managerAuth===d.auth&&ports.managerAuth!==d.owner&&typeof ports.managerToken==='string'&&ports.managerToken.length>0,'account_status_recovery_real_employee_actor');
  assert(['handleEmployee','handleOverview','handleSuspension','handleCurrentOperations','handleNotifications'].every(k=>typeof ports[k]==='function'),'account_status_recovery_real_ports');
  const site=ctx.site??d.site,key=`faolla:attendance:account-status:v1:${site}:${ports.managerAuth}`;
  assert.equal(site,d.site);assert.notEqual(employeeId,d.employee,'target_must_not_be_authenticated_manager');
  const definitions=d.definitions(),inventory=d.inventory(),requests=[],errors=[],inflight=new Set(),contexts=[];
  let files,browser,origin,page,stage='setup',closing=false,failure=null,pending=null,submitted=null,receipt=null,checks=0,readChecks=0;
  let recoveryOnly=false,restrictedFacts=null,dropPatch=true;
  const server=createServer((request,response)=>{
    if(!origin||request.headers.host!==new URL(origin).host||request.method!=='GET')return response.writeHead(403).end();
    response.setHeader('Cache-Control','no-store');response.setHeader('X-Content-Type-Options','nosniff');response.setHeader('Referrer-Policy','no-referrer');
    response.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; object-src 'none'");
    const url=new URL(request.url??'/',origin);if(url.search)return response.writeHead(403).end();
    if(documents.includes(url.pathname))return response.writeHead(200,{'Content-Type':'text/html;charset=utf-8'}).end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>员工账号原号恢复隔离验收</title><link rel="stylesheet" href="/qa.css"><div id="qa-root"></div><script type="module" src="/qa.js"></script></html>');
    if(url.pathname==='/qa.js')return response.writeHead(200,{'Content-Type':'text/javascript;charset=utf-8'}).end(files.js);
    if(url.pathname==='/qa.css')return response.writeHead(200,{'Content-Type':'text/css;charset=utf-8'}).end(files.css);
    return response.writeHead(403).end();
  });
  const patches=()=>requests.filter(r=>r.method==='PATCH'),recoveries=()=>requests.filter(r=>r.path===endpoint);
  const readUnchanged=(before)=>{assert.equal(d.fingerprint(),before,'account_status_recovery_get_wrote');if(restrictedFacts!==null)assert.equal(d.fingerprint(),restrictedFacts);assert.equal(d.definitions(),definitions);readChecks++;};
  const quiet=async()=>{await page.waitForLoadState('networkidle');await bounded(Promise.all([...inflight]));assert.deepEqual(errors,[]);};
  const newContext=async(mode,seedPending=null)=>{
    const auth=mode==='wrong'?d.owner:ports.managerAuth,token=mode==='wrong'?'qa-account-status-wrong-auth':ports.managerToken;
    const context=await browser.newContext({serviceWorkers:'block',acceptDownloads:false,viewport:{width:390,height:900}});contexts.push(context);
    await context.addInitScript(seed=>{
      Object.defineProperty(window,'__accountStatusRecoverySeed',{value:seed});const set=Storage.prototype.setItem;
      if(sessionStorage.getItem('qa-account-recovery-seeded')===null){
        if(seed.pending)set.call(sessionStorage,seed.pending.key,seed.pending.raw);
        set.call(sessionStorage,'qa-account-recovery-seeded','1');set.call(sessionStorage,'qa-unrelated','keep');set.call(localStorage,'qa-unrelated','keep');
      }
      const probe={getSession:0,getUser:0,writes:[],csp:[]};Object.defineProperty(window,'__accountStatusRecoveryProbe',{value:probe});
      for(const method of ['setItem','removeItem','clear']){const old=Storage.prototype[method];Storage.prototype[method]=function(...args){probe.writes.push({method,key:args[0]??null,local:this===localStorage,bytes:new TextEncoder().encode(String(args[1]??'')).length});return old.apply(this,args);};}
      document.addEventListener('securitypolicyviolation',event=>probe.csp.push(event.violatedDirective));
    },{site,auth,token,mode,pending:seedPending});
    await context.route('**/*',route=>{
      if(closing)return route.abort().catch(()=>{});
      const task=(async()=>{
        const request=route.request(),url=new URL(request.url()),method=request.method();assert.equal(url.origin,origin,'account_status_recovery_external_request');
        if([...documents,...assetsPaths].includes(url.pathname)){assert.equal(method,'GET');assert.equal(url.search,'');return route.continue();}
        assert(requests.length<20,'account_status_recovery_request_budget');
        assert.equal(request.headers()['x-merchant-access-token'],token,'account_status_recovery_original_token_header');
        assert(!url.href.includes(token),'token_in_url');
        if(recoveryOnly)assert.equal(method,'GET','account_status_recovery_zero_writes_after_revoke');
        const before=method==='GET'?d.fingerprint():null;
        if(url.pathname===memberships){
          assert.equal(method,'GET');assert.equal(url.search,'');readUnchanged(before);
          requests.push({mode,path:memberships,method,status:200,synthetic:true});
          return route.fulfill({status:200,headers:{'content-type':'application/json','cache-control':'private, no-store'},body:JSON.stringify({ok:true,memberships:[{
            siteId:site,siteName:'合成无进入权限企业',employeeId:d.employee,displayName:'合成当前身份',roleId:'',roleName:'无可进入权限',status:'active',enterable:false,reason:'merchant_access_denied'}]})});
        }
        assert.equal(auth,ports.managerAuth,'wrong_auth_sent_business_request');assert.equal(token,ports.managerToken);
        const headers={...request.headers(),host:'www.faolla.com',origin:canonical,'sec-fetch-site':'same-origin'};delete headers['content-length'];
        const body=request.postData(),realRequest=new Request(canonical+url.pathname+url.search,{method,headers,...(body?{body}:{})});let response;
        if(!recoveryOnly&&url.pathname===overview&&method==='GET'){
          response=await ports.handleOverview(realRequest);const data=await response.clone().json();assert.equal(response.status,200);assert.equal(data.currentAuthUserId,ports.managerAuth);
          assert.equal(data.actor.type,'employee');assert.equal(data.actor.id,d.employee);assert(data.snapshot.employees.every(e=>e.authUserId===''));
        }else if(!recoveryOnly&&url.pathname===currentOperations&&method==='GET'){
          response=await ports.handleCurrentOperations(realRequest);assert.equal(response.status,503,'out_of_scope_current_operations_not_a_fake_success');
        }else if(!recoveryOnly&&url.pathname===notifications&&method==='GET'){
          response=await ports.handleNotifications(realRequest);assert.equal(response.status,503,'out_of_scope_notifications_not_a_fake_success');
        }else if(!recoveryOnly&&url.pathname===employees&&method==='PATCH'){
          assert(dropPatch&&patches().length===0,'only_one_original_status_patch');assert.equal(mode,'correct');submitted=JSON.parse(body);
          assert.equal(submitted.siteId,site);assert.equal(submitted.employeeId,employeeId);assert.equal(submitted.status,'disabled');assert.equal(submitted.offboardingMode,'unassign');assert(submitted.operationId);
          response=await ports.handleEmployee(realRequest);
        }else if(recoveryOnly&&url.pathname===endpoint&&method==='GET'){
          assert(['correct','unavailable'].includes(mode));assert.equal(body,null);
          assert.deepEqual(Object.fromEntries(url.searchParams),{siteId:site,mode:'recover-status',operationId:pending.operationId});
          response=await ports.handleSuspension(realRequest);
        }else throw Error('account_status_recovery_unexpected_route '+method+' '+url.pathname);
        const text=await response.text(),json=JSON.parse(text);if(method==='GET')readUnchanged(before);
        const record={mode,path:url.pathname,method,status:response.status,error:json.error??null};requests.push(record);
        if(method==='PATCH'){
          assert.equal(response.status,200,text);assert.equal(json.ok,true);assert.equal(json.employee.id,employeeId);assert.equal(json.employee.status,'disabled');
          dropPatch=false;record.responseLost=true;return route.abort('failed');
        }
        if(url.pathname===endpoint){
          assert.equal(response.status,200,text);assert.equal(response.headers.get('cache-control'),'private, no-store');assert.equal(json.ok,true);
          assert.deepEqual(json.items,[]);assert.equal(json.nextAfterId,null);assert.equal(json.detail,null);assert.equal(json.receipt,null);
          const r=json.statusReceipt,p=JSON.parse(pending.raw);assert(r);assert.equal(r.operationId,pending.operationId);assert.equal(r.actorId,ports.managerAuth);
          assert.equal(r.employeeId,employeeId);assert.equal(r.expectedVersion,submitted.version);assert.equal(r.version,submitted.version+1);assert.equal(r.status,'disabled');
          assert.equal(r.commandFingerprint,p.commandFingerprint);assert(r.suspensionId);if(receipt)assert.deepEqual(r,receipt);else receipt=r;
          if(mode==='unavailable'){
            // A transport-only 503 hides this successful read. No fake receipt
            // or database error is invented; the browser must keep its bytes.
            record.actualStatus=response.status;record.status=503;record.error='attendance_unavailable';record.injected=true;
            return route.fulfill({status:503,headers:{'content-type':'application/json','cache-control':'private, no-store'},body:JSON.stringify({ok:false,error:'attendance_unavailable'})});
          }
        }
        return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:text});
      })();inflight.add(task);void task.finally(()=>inflight.delete(task)).catch(()=>{});
      return task.catch(async error=>{if(!closing)errors.push(String(error?.message??error));await route.abort().catch(()=>{});});
    });
    const target=await context.newPage();target.setDefaultTimeout(12000);target.on('pageerror',error=>errors.push(error.message));target.on('popup',()=>errors.push('unexpected_popup'));
    target.on('dialog',dialog=>{const allowed=dialog.type()==='beforeunload'&&stage==='correct.selector';if(!allowed)errors.push('unexpected_dialog:'+dialog.type());
      void(allowed?dialog.accept():dialog.dismiss()).catch(error=>{if(!closing)errors.push('dialog_failed:'+error.message);});});
    return {context,page:target};
  };
  try{
    files=await assets();await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const address=server.address();assert(address&&typeof address==='object');origin=`http://127.0.0.1:${address.port}`;
    browser=await chromium.launch({headless:true});const original=await newContext('correct');page=original.page;
    stage='manager.actual_overview';await page.goto(origin+managerPath);const row=page.locator(`[data-enterprise-employee-id="${employeeId}"]`);
    await row.getByRole('button',{name:'停用',exact:true}).waitFor();await quiet();assert.equal(patches().length,0);assert.equal(recoveries().length,0);
    stage='manager.original_patch_response_lost';await row.getByRole('button',{name:'停用',exact:true}).click();
    const dialog=page.getByRole('dialog',{name:'安全停用员工',exact:true});await dialog.waitFor();await quiet();
    const failed=page.waitForEvent('requestfailed',{predicate:r=>new URL(r.url()).pathname===employees&&r.method()==='PATCH'});
    await dialog.getByRole('button',{name:'停用并解除负责人',exact:true}).click();await failed;
    await page.getByRole('button',{name:'核对原员工账号编号',exact:true}).waitFor();await quiet();assert.equal(patches().length,1);assert.equal(recoveries().length,0);
    const raw=await page.evaluate(key=>sessionStorage.getItem(key),key);assert(raw);assert(Buffer.byteLength(raw,'utf8')<=8192);const stored=JSON.parse(raw);
    assert.deepEqual(Object.keys(stored).sort(),['actorId','command','commandFingerprint','siteId','version']);assert.equal(stored.version,1);assert.equal(stored.actorId,ports.managerAuth);assert.equal(stored.siteId,site);
    const {siteId:_site,...sentCommand}=submitted;void _site;assert.deepEqual(stored.command,sentCommand);assert.match(stored.commandFingerprint,/^[a-f0-9]{64}$/);
    pending={key,raw,operationId:stored.command.operationId};
    const initialProbe=await page.evaluate(()=>window.__accountStatusRecoveryProbe);assert.deepEqual(initialProbe.csp,[]);
    assert(initialProbe.writes.length>0&&initialProbe.writes.every(w=>!w.local&&w.method==='setItem'&&w.key===key&&w.bytes<=8192),'original_controller_only_persists_its_small_pending');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false,'manager_390_overflow');
    assert.equal(d.definitions(),definitions);assert.deepEqual(d.inventory(),inventory);
    recoveryOnly=true;
    const restoredRole=await withRestrictedRole(async()=>{
      restrictedFacts=d.fingerprint();
      for(const mode of ['correct','wrong','failed','unavailable']){
        const current=mode==='correct'?original:await newContext(mode,pending);page=current.page;stage=mode+'.selector';
        const beforeReads=recoveries().length;
        const [membershipResponse]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname===memberships),page.goto(origin+selectorPath)]);await membershipResponse.finished();
        const denied=page.getByRole('button',{name:'无法进入',exact:true});await denied.waitFor();assert.equal(await denied.isDisabled(),true);assert.equal(recoveries().length,beforeReads);
        assert(!(await page.locator('body').innerText()).includes(pending.operationId));
        const link=page.getByRole('link',{name:'核对未确认考勤操作',exact:true});assert.equal(await link.getAttribute('href'),recoveryPath);
        stage=mode+'.same_tab_navigation';await Promise.all([page.waitForURL(origin+recoveryPath),link.click()]);assert.equal(current.context.pages().length,1);assert.equal(new URL(page.url()).search,'');assert.equal(new URL(page.url()).hash,'');
        const region=page.getByRole('region',{name:'考勤原编号恢复',exact:true});
        if(mode==='failed'){
          await page.getByRole('alert').filter({hasText:'当前没有可核验的员工登录身份'}).waitFor();assert.equal(await region.count(),0);
          assert.equal(await page.getByRole('button',{name:'查找本标签页待确认编号',exact:true}).count(),0);assert(!(await page.locator('body').innerText()).includes(pending.operationId));
        }else{
          await region.waitFor();assert(!(await region.innerText()).includes(pending.operationId));assert.equal(recoveries().length,beforeReads);
          stage=mode+'.explicit_local_scan';await region.getByRole('button',{name:'查找本标签页待确认编号',exact:true}).click();
          if(mode==='wrong'){
            await region.getByRole('status').filter({hasText:'本标签页没有当前账号可核验'}).waitFor();assert.equal(await region.getByRole('button',{name:'读取这个原编号',exact:true}).count(),0);
            assert(!(await region.innerText()).includes(pending.operationId));
          }else{
            const read=region.getByRole('button',{name:'读取这个原编号',exact:true});await read.waitFor();assert.equal(recoveries().length,beforeReads,'local_scan_sent_request');
            const item=region.locator('[data-attendance-recovery-kind="account-status"]');assert((await item.innerText()).includes(pending.operationId));
            for(const privateValue of [employeeId,employeeName,stored.commandFingerprint])assert(!(await item.innerText()).includes(privateValue));
            stage=mode+'.explicit_original_get';const [response]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname===endpoint&&r.request().method()==='GET'),read.click()]);await response.finished();
            assert.equal(response.status(),mode==='correct'?200:503);
            if(mode==='correct'){
              const confirmed=page.getByRole('region',{name:'已核实最小回执',exact:true});await confirmed.waitFor();const text=await confirmed.innerText();
              assert.equal(await confirmed.getAttribute('data-attendance-recovery-receipt'),'account-status');
              for(const value of [pending.operationId,ports.managerAuth,receipt.recordedAt,'原操作确认：企业账号已停用','四个独立结果','不证明当前账号仍处于该状态'])assert(text.includes(value));
              for(const value of [employeeId,employeeName,stored.commandFingerprint,receipt.suspensionId])assert(!text.includes(value),'account_status_recovery_disclosed_target_context');
              assert.equal(await confirmed.getByRole('button').count(),0);assert.equal(await region.getByRole('button',{name:'读取这个原编号',exact:true}).count(),0);
            }else{
              await region.getByRole('status').filter({hasText:'原结果尚未核实；查无回执不等于失败'}).waitFor();assert.equal(await page.getByRole('region',{name:'已核实最小回执',exact:true}).count(),0);
              assert.equal(await read.isEnabled(),true);
            }
          }
        }
        await quiet();assert.equal(recoveries().length,beforeReads+(['correct','unavailable'].includes(mode)?1:0));assert.equal(patches().length,1);
        const observed=await page.evaluate(key=>({probe:window.__accountStatusRecoveryProbe,raw:sessionStorage.getItem(key),session:sessionStorage.getItem('qa-unrelated'),local:localStorage.getItem('qa-unrelated'),localKeys:Object.keys(localStorage)}),key);
        assert.equal(observed.probe.getSession,1);assert.equal(observed.probe.getUser,1);assert.deepEqual(observed.probe.csp,[]);
        assert.equal(observed.raw,mode==='correct'?null:pending.raw);assert.equal(observed.session,'keep');assert.equal(observed.local,'keep');assert.deepEqual(observed.localKeys,['qa-unrelated']);
        assert.deepEqual(observed.probe.writes,mode==='correct'?[{method:'removeItem',key,local:false,bytes:0}]:[]);
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false,'recovery_390_overflow');
        assert.equal(d.fingerprint(),restrictedFacts);assert.equal(d.definitions(),definitions);checks++;
        await bounded(current.context.close());contexts.splice(contexts.indexOf(current.context),1);page=null;
      }
    });
    restrictedFacts=null;assert.equal(restoredRole.permissionRestored,true);assert.equal(restoredRole.roleVersionAdvances,2);
    assert.equal(d.fingerprint(),restoredRole.restoredFacts,'role_restore_changed_after_validation');assert.equal(d.definitions(),definitions);assert.deepEqual(d.inventory(),inventory);assert.deepEqual(errors,[]);
    assert.equal(patches().length,1);assert.equal(recoveries().length,2);assert.equal(requests.filter(r=>r.method==='POST').length,0);
    return {checks,requests:requests.length,readChecks,originalStatusPatches:1,recoveryPosts:0,recoveryPatches:0,actualOriginalRecoveryGets:2,
      actualEmployeeManager:true,actualEmployeeActorToken:true,verifiedOverviewAuth:true,originalControllerCreatedPending:true,successfulPatchResponseLost:true,
      actualSelectorAndRecoveryPage:true,sameTabNavigation:true,nextLinkNativeAnchorShim:true,syntheticSdkAuth:true,syntheticMembershipInitialization:true,
      realPermissionRemovalAndRestore:true,noSelfViewEntryRequired:true,explicitLocalScan:true,noAutomaticRecoveryRequest:true,minimalReceiptOnly:true,
      wrongAuthPendingHidden:true,getUserFailurePendingHidden:true,http503TransportInjectedAfterActualRead:true,failedRecoveryBytesPreserved:true,
      everyGetFactsUnchanged:true,originalDisableAndTwoRealRoleVersionAdvances:true,definitionsAndCatalogUnchanged:true,unrelatedStoragePreserved:true,width390:true,externalRequests:0,diskBundles:false,
      disabledManagerBrowserNotClaimed:true,unrelatedCurrentOperationsAndNotifications:'real authenticated handlers, explicit unavailable stores (503)',pending};
  }catch(error){const diagnostic={stage,message:String(error?.message??error).slice(0,1500),stack:String(error?.stack??'').split('\n').slice(0,2).join('\n'),requests:requests.slice(-10),errors};
    if(page)diagnostic.ui=await page.locator('body').innerText().then(text=>text.slice(-4500)).catch(()=>'<closed>');failure=Error('account_status_recovery_browser_failed '+JSON.stringify(diagnostic),{cause:error});throw failure;
  }finally{closing=true;await cleanup([
    {name:'account status recovery inflight',run:()=>bounded(Promise.allSettled([...inflight]))},
    {name:'account status recovery contexts',run:()=>bounded(Promise.allSettled(contexts.map(context=>context.close())).then(results=>{const failed=results.filter(r=>r.status==='rejected');if(failed.length)throw new AggregateError(failed.map(r=>r.reason),'account_recovery_context_close_failed');}))},
    {name:'account status recovery browser',run:()=>browser?bounded(browser.close()):undefined},
    {name:'account status recovery HTTP listener',run:()=>{server.closeAllConnections?.();return server.listening?bounded(new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()))):undefined;}},
    {name:'account status recovery esbuild service',run:()=>stop()},
  ],failure);}
}
