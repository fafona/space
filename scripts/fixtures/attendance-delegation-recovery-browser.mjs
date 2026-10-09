//191 Imports are inert. Only root invokes this callback in its owned schema.
//No Next server: next/link is rendered as its native href-bearing anchor. The
//same tab really navigates between two documents mounting the actual routes.
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
const endpoint='/api/merchant-enterprise/attendance/application-delegation',memberships='/api/merchant-enterprise/memberships';
const selectorPath='/enterprise',recoveryPath='/enterprise/attendance-recovery';
export const delegationRecoveryBrowserAuthSource=`
  const seed=()=>window.__delegationRecoverySeed;
  const probe=()=>window.__delegationRecoveryProbe;
  export const isEnterpriseLogoutBlocked=()=>false;
  export const onEnterpriseAuthStateChange=()=>({data:{subscription:{unsubscribe(){}}}});
  const forbidden=()=>{throw Error('synthetic_auth_write_forbidden');};
  export const signInEnterpriseWithPassword=forbidden,signOutEnterpriseSession=forbidden;
  export const merchantEnterpriseSupabase={auth:{
    getSession:async()=>{probe().getSession++;return {data:{session:{access_token:seed().token,user:{id:seed().auth}}},error:null};},
    getUser:async(token)=>{probe().getUser++;if(token!==seed().token)throw Error('synthetic_auth_token_mismatch');
      return seed().mode==='failed' ? {data:{user:null},error:{message:'synthetic getUser verification failed'}}
        : {data:{user:{id:seed().auth}},error:null};},
    exchangeCodeForSession:forbidden,setSession:forbidden,updateUser:forbidden
  }};
`;
const nativeLinkSource='import {createElement} from "react";export default function Link({href,children,...props}){return createElement("a",{...props,href},children);}';

// Use an actual successful command/receipt, not a fabricated approval. The
//browser's production pending parser independently verifies its SHA binding.
export function delegationRecoveryBrowserPending({site,delegateAuth,delegateEmployee,approved}){
  const {query,command,receipt,recovery}=approved??{};
  assert(query?.siteId===site&&query.access==='delegate'&&query.mode==='decide');
  assert(command?.decision?.operationId===receipt?.operationId&&receipt.actorId===delegateAuth);
  assert.equal(query.requestId,command.decision.requestId);assert.equal(command.grantId,query.grantId);
  assert.equal(receipt.requestId,query.requestId);assert.equal(receipt.grantId,query.grantId);
  assert.equal(receipt.action,command.decision.action);assert.match(receipt.commandFingerprint,/^[a-f0-9]{64}$/);
  assert(recovery?.siteId===site&&recovery.access==='delegate'&&recovery.mode==='recover'&&recovery.operationId===receipt.operationId);
  const key=`faolla:attendance:application-delegation:v1:${site}:delegate:${delegateEmployee}`;
  const raw=JSON.stringify({version:1,anchorId:delegateEmployee,actorId:delegateAuth,employeeId:delegateEmployee,query,command,commandFingerprint:receipt.commandFingerprint});
  assert(Buffer.byteLength(raw,'utf8')<=8192);return {key,raw,operationId:receipt.operationId};
}
async function bounded(promise){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('delegation_recovery_browser_timeout')),15000);})]);}finally{clearTimeout(timer);}}
export async function cleanupDelegationRecoveryBrowser(steps,primaryError=null){
  try{assert(Array.isArray(steps)&&steps.every(s=>s&&typeof s==='object'&&!Array.isArray(s)&&typeof s.name==='string'&&typeof s.run==='function'),'delegation_recovery_cleanup_shape');await runAttendanceCleanupSteps(steps);}
  catch(error){if(primaryError)throw new AggregateError([primaryError,error],'delegation_recovery_and_cleanup_failed',{cause:primaryError});throw error;}
}
async function assets(){
  const bundle=await build({absWorkingDir:root,entryPoints:['scripts/fixtures/attendance-delegation-recovery-browser.tsx'],bundle:true,write:false,metafile:true,platform:'browser',format:'esm',target:['es2020'],jsx:'automatic',
    tsconfig:path.join(root,'tsconfig.json'),outfile:'qa.js',logLevel:'warning',define:{'process.env':'{}','process.env.NODE_ENV':'"development"'},plugins:[{name:'isolated-recovery-auth-and-link',setup(b){
      b.onResolve({filter:/^(?:@\/lib\/merchantEnterpriseSupabase|next\/link)$/},args=>({path:args.path,namespace:'recovery-fixture'}));
      b.onLoad({filter:/.*/,namespace:'recovery-fixture'},args=>({contents:args.path==='next/link'?nativeLinkSource:delegationRecoveryBrowserAuthSource,loader:'js',resolveDir:root}));
    }}]});
  const inputs=Object.keys(bundle.metafile.inputs);assert(inputs.some(n=>n.endsWith('EnterpriseSelectorClient.tsx')));assert(inputs.some(n=>n.endsWith('MerchantAttendanceDelegationRecoveryPage.tsx')));
  for(const name of inputs)assert(!/node:crypto|\.server\.ts$|@supabase\//.test(name),'delegation_recovery_server_or_real_auth_import');
  const candidates=new Set();for(const name of inputs.filter(n=>/\.tsx?$/.test(n)&&!n.includes('node_modules')&&!n.startsWith('recovery-fixture:'))){
    const ast=ts.createSourceFile(name,await readFile(path.join(root,name),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
    const visit=node=>{if(ts.isStringLiteral(node)||ts.isNoSubstitutionTemplateLiteral(node)||ts.isTemplateHead(node)||ts.isTemplateMiddle(node)||ts.isTemplateTail(node))node.text.split(/\s+/).filter(Boolean).forEach(v=>candidates.add(v));ts.forEachChild(node,visit);};visit(ast);}
  const css=(await compile('@import "tailwindcss";',{base:root,onDependency:()=>{}})).build([...candidates])+'body{margin:0;font-family:Arial,sans-serif}.qa-disclaimer{padding:8px;background:#fff7ed;font-size:12px;overflow-wrap:anywhere}';
  return {js:bundle.outputFiles.find(f=>f.path.endsWith('.js')).contents,css};
}
export async function runDelegationRecoveryBrowserAcceptance(ctx){
  const {d,h,delegateAuth,delegateEmployee,handle,approved,roleWithoutSelf}=ctx??{},scope=ctx?.scope??d?.owned;
  assert(d?.syntheticOnly===true&&h?.syntheticOnly===true&&scope?.schema===d.owned.schema&&typeof roleWithoutSelf==='function'&&typeof handle==='function','delegation_recovery_browser_dependencies');
  const pending=delegationRecoveryBrowserPending({site:d.site,delegateAuth,delegateEmployee,approved});
  assert(d.owner&&d.owner!==delegateAuth,'delegation_recovery_distinct_test_auth');
  const originalFacts=d.fingerprint(),definitions=d.definitions(),inventory=d.inventory();
  const requests=[],errors=[],inflight=new Set(),contexts=[];let files,browser,origin,page,stage='setup',closing=false,failure=null,checks=0;
  const server=createServer((request,response)=>{if(!origin||request.headers.host!==new URL(origin).host||request.method!=='GET')return response.writeHead(403).end();
    response.setHeader('Cache-Control','no-store');response.setHeader('X-Content-Type-Options','nosniff');response.setHeader('Referrer-Policy','no-referrer');
    response.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; object-src 'none'");
    const url=new URL(request.url??'/',origin);if(url.search)return response.writeHead(403).end();
    if([selectorPath,recoveryPath].includes(url.pathname))return response.writeHead(200,{'Content-Type':'text/html;charset=utf-8'}).end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>独立原号恢复隔离验收</title><link rel="stylesheet" href="/qa.css"><div id="qa-root"></div><script type="module" src="/qa.js"></script></html>');
    if(url.pathname==='/qa.js')return response.writeHead(200,{'Content-Type':'text/javascript;charset=utf-8'}).end(files.js);if(url.pathname==='/qa.css')return response.writeHead(200,{'Content-Type':'text/css;charset=utf-8'}).end(files.css);return response.writeHead(403).end();});
  const delegationRequests=()=>requests.filter(r=>r.path===endpoint);
  try{
    files=await assets();await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const address=server.address();assert(address&&typeof address==='object');origin=`http://127.0.0.1:${address.port}`;
    browser=await chromium.launch({headless:true});
    await roleWithoutSelf(async()=>{
      // The root helper removes actual synthetic role permissions and restores
      //them in finally. Membership JSON below is not proof of DB authorization.
      const restrictedFacts=d.fingerprint();
      for(const mode of ['correct','wrong','failed']){
        stage=mode+'.selector';const auth=mode==='wrong'?d.owner:delegateAuth,token='qa-synthetic-recovery-'+mode;
        const context=await browser.newContext({serviceWorkers:'block',acceptDownloads:false,viewport:{width:390,height:900}});contexts.push(context);
        await context.addInitScript(seed=>{Object.defineProperty(window,'__delegationRecoverySeed',{value:seed});const set=Storage.prototype.setItem;
          if(sessionStorage.getItem('qa-recovery-seeded')===null){set.call(sessionStorage,seed.key,seed.raw);set.call(sessionStorage,'qa-recovery-seeded','1');set.call(sessionStorage,'qa-unrelated','keep');set.call(localStorage,'qa-unrelated','keep');}
          const probe={getSession:0,getUser:0,writes:[],csp:[]};Object.defineProperty(window,'__delegationRecoveryProbe',{value:probe});
          for(const method of ['setItem','removeItem','clear']){const old=Storage.prototype[method];Storage.prototype[method]=function(...args){probe.writes.push({method,key:args[0]??null,local:this===localStorage});return old.apply(this,args);};}
          document.addEventListener('securitypolicyviolation',event=>probe.csp.push(event.violatedDirective));
        },{mode,auth,token,key:pending.key,raw:pending.raw});
        await context.route('**/*',route=>{if(closing)return route.abort().catch(()=>{});const task=(async()=>{const request=route.request(),url=new URL(request.url());assert.equal(url.origin,origin,'delegation_recovery_external_request');assert.equal(request.method(),'GET','delegation_recovery_zero_post');
          if([selectorPath,recoveryPath,'/qa.js','/qa.css'].includes(url.pathname)){assert.equal(url.search,'');return route.continue();}
          assert(requests.length<8,'delegation_recovery_request_budget');assert.equal(request.headers()['x-merchant-access-token'],token,'delegation_recovery_auth_header');
          if(url.pathname===memberships){assert.equal(url.search,'');requests.push({mode,path:memberships,method:'GET',status:200,synthetic:true});
            return route.fulfill({status:200,headers:{'content-type':'application/json','cache-control':'private, no-store'},body:JSON.stringify({ok:true,memberships:[{siteId:d.site,siteName:'合成无进入权限企业',employeeId:delegateEmployee,displayName:'合成当前身份',roleId:'',roleName:'无可进入权限',status:'active',enterable:false,reason:'merchant_access_denied'}]})});}
          assert.equal(url.pathname,endpoint);assert.equal(mode,'correct','foreign_or_unverified_auth_sent_recovery');assert.equal(request.postData(),null);
          assert.deepEqual(Object.fromEntries(url.searchParams),Object.fromEntries(Object.entries(approved.recovery).filter(([,v])=>v!==null).map(([k,v])=>[k,String(v)])));
          const before=d.fingerprint(),response=await handle(new Request(canonical+url.pathname+url.search,{headers:{host:'www.faolla.com',origin:canonical,'sec-fetch-site':'same-origin','x-merchant-access-token':token}}),'delegate',false);
          const text=await response.text(),body=JSON.parse(text);assert.equal(d.fingerprint(),before,'delegation_recovery_get_wrote');assert.equal(d.fingerprint(),restrictedFacts);assert.equal(d.definitions(),definitions);
          requests.push({mode,path:endpoint,method:'GET',status:response.status,error:body.error??null});assert.equal(response.status,200,text);assert.equal(response.headers.get('cache-control'),'private, no-store');
          assert.deepEqual(body.receipt,approved.receipt);assert.equal(body.detail,null);assert.deepEqual(body.items,[]);assert.deepEqual(body.grants,[]);
          return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:text});
        })();inflight.add(task);void task.finally(()=>inflight.delete(task)).catch(()=>{});return task.catch(async error=>{if(!closing)errors.push(error.message);await route.abort().catch(()=>{});});});
        page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',error=>errors.push(error.message));page.on('popup',()=>errors.push('unexpected_popup'));
        page.on('dialog',dialog=>{errors.push('unexpected_dialog');void dialog.dismiss().catch(error=>{if(!closing)errors.push('dialog_failed:'+error.message);});});
        const beforeRead=delegationRequests().length;
        const [membershipResponse]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname===memberships),page.goto(origin+selectorPath)]);await membershipResponse.finished();
        const disabled=page.getByRole('button',{name:'无法进入',exact:true});await disabled.waitFor();assert.equal(await disabled.isDisabled(),true);assert.equal(delegationRequests().length,beforeRead);
        assert(!(await page.locator('body').innerText()).includes(pending.operationId));
        const link=page.getByRole('link',{name:'核对未确认考勤操作',exact:true});assert.equal(await link.getAttribute('href'),recoveryPath);
        stage=mode+'.same_tab_navigation';await Promise.all([page.waitForURL(origin+recoveryPath),link.click()]);assert.equal(context.pages().length,1);assert.equal(new URL(page.url()).search,'');assert.equal(new URL(page.url()).hash,'');
        const region=page.getByRole('region',{name:'考勤原编号恢复',exact:true});
        if(mode==='failed'){
          await page.getByRole('alert').filter({hasText:'当前没有可核验的员工登录身份'}).waitFor();assert.equal(await region.count(),0);assert.equal(await page.getByRole('button',{name:'查找本标签页待确认编号',exact:true}).count(),0);
          assert(!(await page.locator('body').innerText()).includes(pending.operationId));assert.equal(delegationRequests().length,beforeRead);
        }else{
          await region.waitFor();assert(!(await region.innerText()).includes(pending.operationId));assert.equal(delegationRequests().length,beforeRead);
          stage=mode+'.explicit_scan';await region.getByRole('button',{name:'查找本标签页待确认编号',exact:true}).click();
          if(mode==='wrong'){
            await region.getByRole('status').filter({hasText:'本标签页没有当前账号可核验'}).waitFor();assert.equal(await region.getByRole('button',{name:'读取这个原编号',exact:true}).count(),0);assert(!(await region.innerText()).includes(pending.operationId));assert.equal(delegationRequests().length,beforeRead);
          }else{
            const read=region.getByRole('button',{name:'读取这个原编号',exact:true});await read.waitFor();assert.equal(delegationRequests().length,beforeRead);assert((await region.innerText()).includes(pending.operationId));
            assert(!(await region.innerText()).includes(approved.command.decision.reason));assert(!(await region.innerText()).includes(approved.query.requestId));
            stage=mode+'.actual_original_get';const [response]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname===endpoint&&r.request().method()==='GET'),read.click()]);await response.finished();assert.equal(response.status(),200);
            const receipt=page.getByRole('region',{name:'已核实最小回执',exact:true});await receipt.waitFor();const content=await receipt.innerText();
            for(const value of [approved.receipt.operationId,approved.receipt.recordedAt,delegateAuth])assert(content.includes(value));
            for(const value of [approved.command.decision.reason,approved.request?.reason,approved.query.requestId,approved.command.grantId,h.employeeId].filter(Boolean))assert(!content.includes(value),'delegation_recovery_receipt_disclosed_private_context');
            assert.equal(delegationRequests().length,beforeRead+1);assert.equal(await region.getByRole('button',{name:'读取这个原编号',exact:true}).count(),0);
            assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false,'delegation_recovery_390_overflow');
          }
        }
        const observed=await page.evaluate(key=>({probe:window.__delegationRecoveryProbe,pending:sessionStorage.getItem(key),session:sessionStorage.getItem('qa-unrelated'),local:localStorage.getItem('qa-unrelated')}),pending.key);
        assert.equal(observed.probe.getUser,1);assert.equal(observed.probe.getSession,1);assert.deepEqual(observed.probe.csp,[]);assert.equal(observed.pending,mode==='correct'?null:pending.raw);assert.equal(observed.session,'keep');assert.equal(observed.local,'keep');
        assert.deepEqual(observed.probe.writes,mode==='correct'?[{method:'removeItem',key:pending.key,local:false}]:[]);assert.equal(d.fingerprint(),restrictedFacts);assert.equal(d.definitions(),definitions);checks++;
        await bounded(context.close());contexts.splice(contexts.indexOf(context),1);page=null;
      }
    });
    assert.equal(d.fingerprint(),originalFacts,'delegation_recovery_roles_not_restored');assert.equal(d.definitions(),definitions);assert.deepEqual(d.inventory(),inventory);assert.deepEqual(errors,[]);assert.equal(delegationRequests().length,1);
    return {checks,requests:requests.length,posts:0,originalRecoveryGets:1,actualSelectorAndRecoveryPage:true,actualSameTabHrefNavigation:true,nextLinkNativeAnchorShim:true,syntheticSupabaseAuth:true,syntheticMembershipInitialization:true,
      realPermissionRemovalAndRestore:true,actualHandlerServiceSql:true,actualRevokedGrant:true,featureOffRecovery:true,noSelfViewEntryRequired:true,explicitLocalScan:true,noAutomaticAttendanceRequest:true,minimalReceiptOnly:true,
      wrongAuthPendingHidden:true,getUserFailurePendingHidden:true,pendingPreservedOnAuthFailures:true,allFactsUnchanged:true,definitionsAndCatalogUnchanged:true,width390:true,externalRequests:0,diskBundles:false};
  }catch(error){const diagnostic={stage,message:String(error?.message??error).slice(0,1500),stack:String(error?.stack??'').split('\n').slice(0,2).join('\n'),requests:requests.slice(-8),errors};
    if(page)diagnostic.ui=await page.locator('body').innerText().then(text=>text.slice(-4500)).catch(()=>'<closed>');failure=Error('delegation_recovery_browser_failed '+JSON.stringify(diagnostic),{cause:error});throw failure;
  }finally{closing=true;await cleanupDelegationRecoveryBrowser([
    {name:'delegation recovery inflight',run:()=>bounded(Promise.allSettled([...inflight]))},
    {name:'delegation recovery contexts',run:()=>bounded(Promise.allSettled(contexts.map(context=>context.close())).then(results=>{const failed=results.filter(r=>r.status==='rejected');if(failed.length)throw new AggregateError(failed.map(r=>r.reason),'recovery_context_close_failed');}))},
    {name:'delegation recovery browser',run:()=>browser?bounded(browser.close()):undefined},
    {name:'delegation recovery HTTP listener',run:()=>{server.closeAllConnections?.();return server.listening?bounded(new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()))):undefined;}},
    {name:'delegation recovery esbuild service',run:()=>stop()},
  ],failure);}
}
