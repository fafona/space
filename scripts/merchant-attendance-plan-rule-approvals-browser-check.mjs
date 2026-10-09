// Inert headless check, invoked only within the root-owned synthetic namespace.
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
import {runAttendanceCleanupSteps} from './fixtures/attendance-cleanup.mjs';

const root=fileURLToPath(new URL('../',import.meta.url)),require=createRequire(import.meta.url);
const endpoint='/api/merchant-enterprise/attendance/plan-rule-approvals',sources='/api/merchant-enterprise/attendance/sources';
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
async function assets(){
  const options={absWorkingDir:root,entryPoints:['scripts/fixtures/attendance-plan-rule-approvals-browser.tsx'],bundle:true,write:false,metafile:true,
    platform:'browser',format:'esm',target:['es2020'],jsx:'automatic',tsconfig:path.join(root,'tsconfig.json'),outfile:'qa.js',logLevel:'warning'};
  const defines={'process.env':'{}','process.env.NODE_ENV':'"development"'};
  const on=await build({...options,define:{...defines,'process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_PLAN_RULE_APPROVALS_ENABLED':'"1"'}}),off=await build({...options,define:defines});
  for(const bundle of [on,off])for(const file of Object.keys(bundle.metafile.inputs))assert(!/node:crypto|\.server\.ts$|merchantAttendanceShiftRuleBinding\.ts$/.test(file));
  const candidates=new Set();
  for(const filename of Object.keys(on.metafile.inputs).filter(f=>/\.tsx?$/.test(f)&&!f.includes('node_modules'))){
    const ast=ts.createSourceFile(filename,await readFile(path.join(root,filename),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
    const visit=node=>{if(ts.isStringLiteral(node)||ts.isNoSubstitutionTemplateLiteral(node)||ts.isTemplateHead(node)||ts.isTemplateMiddle(node)||ts.isTemplateTail(node))node.text.split(/\s+/).filter(Boolean).forEach(s=>candidates.add(s));ts.forEachChild(node,visit);};visit(ast);
  }
  const css=(await compile('@import "tailwindcss";',{base:root,onDependency:()=>{}})).build([...candidates])+
    'body{margin:0;background:#f1f5f9;font-family:Arial,sans-serif}.qa-main{max-width:1100px;margin:auto;padding:12px;min-width:0}.qa-toolbar{padding:12px;font-size:13px;background:#fff7ed;overflow-wrap:anywhere}.qa-toolbar button{margin:4px;border:1px solid #94a3b8;padding:6px;background:white}';
  return {on:on.outputFiles.find(f=>f.path.endsWith('.js')).contents,off:off.outputFiles.find(f=>f.path.endsWith('.js')).contents,css};
}
export async function checkPlanRuleApprovalsBrowser(native,scope,d){
  assert.equal(scope.sql,d.sql);
  const files=await assets(),definitions=d.definitions();
  const {handleSources}=require('../src/app/api/merchant-enterprise/attendance/sources/route-handler.ts');
  const {executeSources}=require('../src/lib/merchantAttendanceSources.server.ts');
  const {handlePlanRuleApprovals}=require('../src/app/api/merchant-enterprise/attendance/plan-rule-approvals/route-handler.ts');
  const {executePlanRuleApprovals}=require('../src/lib/merchantAttendancePlanRuleApprovals.server.ts');
  const {MerchantEnterpriseAccessError}=require('../src/lib/merchantEnterpriseAuth.server.ts');
  let browser,origin,closing=false,dropNext=false,moduleEnabled=true,authOk=true,hold=null,checks=0;
  const requests=[],pending=new Set(),errors=[],gates=new Set();
  const service={rpc:async(name,args)=>{
    assert(['faolla_attendance_sources_v1','faolla_attendance_plan_rule_approvals_v1'].includes(name));
    const readOnly=name==='faolla_attendance_sources_v1'||args.p_query.mode!=='approve',before=readOnly?d.fingerprint():null;
    try{return {data:name==='faolla_attendance_sources_v1'?d.sourceRaw(args.p_query,args.p_auth_user_id):d.raw(args.p_query,args.p_command,args.p_auth_user_id,args.p_module_enabled),error:null};}
    catch(error){const code=String(error).match(/ERROR:\s+(attendance_[a-z_]+)/)?.[1];if(!code)throw error;return {data:null,error:{message:code}};}
    finally{if(readOnly)assert.equal(d.fingerprint(),before);assert.equal(d.definitions(),definitions);}
  }};
  const deps=source=>({enabled:()=>true,allow:()=>true,authenticate:async()=>{
    if(!authOk)throw new MerchantEnterpriseAccessError('unauthorized',401);
    return {user:{id:d.owner},authenticationMethods:['password']};},
    entitlement:async()=>({permissionConfig:{allowEnterpriseManagement:true,allowEmployeeAttendance:moduleEnabled}}),
    execute:input=>source?executeSources(input,service):executePlanRuleApprovals(input,service)});
  const server=createServer((request,response)=>{
    if(!origin||request.headers.host!==new URL(origin).host||request.method!=='GET')return response.writeHead(403).end();
    const url=new URL(request.url??'/',origin);if(url.search)return response.writeHead(403).end();
    response.setHeader('Cache-Control','no-store');response.setHeader('X-Content-Type-Options','nosniff');
    response.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'");
    if(url.pathname==='/'||url.pathname==='/off')return response.writeHead(200,{'Content-Type':'text/html;charset=utf-8'}).end(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>本地排班规则核准</title><link rel="stylesheet" href="/qa.css"><div id="qa-root"></div><script type="module" src="/${url.pathname==='/off'?'off':'qa'}.js"></script></html>`);
    if(url.pathname==='/qa.js'||url.pathname==='/off.js')return response.writeHead(200,{'Content-Type':'text/javascript;charset=utf-8'}).end(url.pathname==='/qa.js'?files.on:files.off);
    if(url.pathname==='/qa.css')return response.writeHead(200,{'Content-Type':'text/css;charset=utf-8'}).end(files.css);return response.writeHead(403).end();
  });
  const region=page=>page.getByRole('region',{name:'排班规则核准',exact:true}),parent=page=>page.getByRole('region',{name:'单员工资料核查',exact:true});
  const readParent=async page=>{await parent(page).getByLabel('核查开始日期').fill(d.sourceQuery.fromDate);await parent(page).getByLabel('核查结束日期').fill(d.sourceQuery.throughDate);
    await parent(page).getByRole('button',{name:'读取核查资料',exact:true}).click();await parent(page).getByRole('region',{name:'排班与记录时间对照',exact:true}).waitFor();};
  const choose=async(page,slot)=>{await region(page).getByLabel('选择核准排班',{exact:true}).selectOption(slot.id);};
  const preview=async(page,slot)=>{await choose(page,slot);await region(page).getByRole('button',{name:'预览排班规则',exact:true}).click();await region(page).locator('[data-plan-rule-detail]').waitFor();};
  const approve=async(page,reason)=>{await region(page).getByLabel('核准理由',{exact:true}).fill(reason);
    await region(page).getByRole('button',{name:'预览排班规则',exact:true}).click();await region(page).locator('[data-plan-rule-detail="preview"]').waitFor();
    await region(page).getByRole('button',{name:'确认核准本排班规则',exact:true}).click();};
  const last=()=>requests.at(-1);
  try{
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});origin=`http://127.0.0.1:${server.address().port}`;
    browser=await chromium.launch({headless:true});
    const run=async(name,check,{off=false,width=1280}={})=>{
      moduleEnabled=true;authOk=true;dropNext=false;
      const context=await browser.newContext({viewport:{width,height:1000},serviceWorkers:'block',acceptDownloads:false});
      try{
        await context.addInitScript(seed=>{Object.defineProperty(window,'__planRulesSeed',{value:seed});sessionStorage.setItem('qa-unrelated','keep');localStorage.setItem('qa-unrelated','keep');},
          {site:d.site,worker:d.worker,owner:d.owner});
        const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('dialog',dialog=>dialog.accept());
        await page.route('**/*',route=>{
          const work=(async()=>{
            const request=route.request(),url=new URL(request.url());assert.equal(url.origin,origin,'external_browser_request');
            if(![endpoint,sources].includes(url.pathname))return route.continue();
            const method=request.method();assert(['GET','POST'].includes(method));assert(url.pathname===endpoint||method==='GET');
            const body=request.postData();assert(!body||Buffer.byteLength(body)<=8192);
            const req=new Request(`https://www.faolla.com${url.pathname}${url.search}`,{method,headers:{Origin:'https://www.faolla.com','Sec-Fetch-Site':'same-origin',...(body?{'Content-Type':'application/json'}:{})},...(body?{body}:{})});
            const response=await (url.pathname===sources?handleSources(req,deps(true)):handlePlanRuleApprovals(req,deps(false))),packet=await response.json();
            requests.push({path:url.pathname,method,status:response.status,body:packet});
            if(dropNext&&method==='POST'){dropNext=false;return route.abort('failed');}
            if(hold&&url.pathname===endpoint){const gate=hold;hold=null;gate.ready.resolve();await gate.release.promise;}
            if(closing)return route.abort();
            return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:JSON.stringify(packet)});
          })();pending.add(work);void work.finally(()=>pending.delete(work));return work;
        });
        await page.goto(origin+(off?'/off':'/'));await readParent(page);await check(page);await Promise.all([...pending]);
        assert.equal(await page.evaluate(()=>localStorage.getItem('qa-unrelated')),'keep');assert.equal(await page.evaluate(()=>sessionStorage.getItem('qa-unrelated')),'keep');
        checks++;native.pass(name);
      }finally{await context.close();}
    };
    await run('166 default-off actual parent performs no plan-rule request',async page=>{assert.equal(await region(page).count(),0);assert.equal(requests.filter(r=>r.path===endpoint).length,0);},{off:true});
    await run('166 real parent390 preview approve read retains one fixed independent version',async page=>{
      await preview(page,d.slots.browser);assert.equal(last().body.data.preview.eligible,true);
      await approve(page,'Synthetic166 browser explicit approval');await region(page).locator('[data-plan-rule-detail="approval"]').waitFor();
      assert.equal(last().method,'POST');assert.equal(last().status,200);const saved=last().body.data.approval;
      await region(page).getByRole('button',{name:'读取已核准规则',exact:true}).click();await region(page).locator('[data-plan-rule-detail="approval"]').waitFor();
      assert.deepEqual(last().body.data.approval,saved);assert.equal(await region(page).locator('[data-plan-rule-pending]').count(),0);
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'mobile_horizontal_overflow');
      assert.equal(await page.evaluate(()=>Object.keys(sessionStorage).filter(k=>k.startsWith('faolla:attendance:plan-rule-approvals:')).length),0);
    },{width:390});
    await run('166 lost real POST response recovers only by original GET after remount',async page=>{
      await preview(page,d.slots.cancelBefore);dropNext=true;const before=requests.filter(r=>r.method==='POST').length;
      await approve(page,'Synthetic166 unknown network outcome');await region(page).locator('[data-plan-rule-pending]').waitFor();
      await region(page).getByRole('button',{name:'核对原核准编号',exact:true}).waitFor({state:'visible'});
      await page.getByTestId('remount').click();await readParent(page);await region(page).locator('[data-plan-rule-pending]').waitFor();
      await region(page).getByRole('button',{name:'核对原核准编号',exact:true}).click();await region(page).locator('[data-plan-rule-detail="approval"]').waitFor();
      assert.equal(requests.filter(r=>r.method==='POST').length,before+1);assert.equal(last().method,'GET');assert.equal(last().body.data.approval.revision,1);
    });
    await run('166 later actual cancellation preserves approval while new preview and paused approval are blocked',async page=>{
      d.cancel(d.slots.browser);await choose(page,d.slots.browser);
      await region(page).getByRole('button',{name:'读取已核准规则',exact:true}).click();await region(page).locator('[data-plan-rule-detail="approval"]').waitFor();
      assert.equal(last().body.data.slot.cancelled,true);assert(last().body.data.approval);
      await preview(page,d.slots.browser);assert(last().body.data.preview.blockers.includes('cancelled'));
      moduleEnabled=false;await preview(page,d.slots.cancelAfter);assert(last().body.data.preview.blockers.includes('module_paused'));
      assert(await region(page).getByRole('button',{name:'确认核准本排班规则',exact:true}).isDisabled());
    });
    await run('166 delayed preview unmount and authentication failure clear old data without auto retry',async page=>{
      const gate={ready:deferred(),release:deferred()};gates.add(gate);hold=gate;
      await choose(page,d.slots.cancelAfter);await region(page).getByRole('button',{name:'预览排班规则',exact:true}).click();await gate.ready.promise;
      await page.getByTestId('unmount').click();gate.release.resolve();await Promise.all([...pending]);assert.equal(await region(page).count(),0);
      await page.getByTestId('remount').click();await readParent(page);await preview(page,d.slots.cancelAfter);
      authOk=false;await region(page).getByRole('button',{name:'预览排班规则',exact:true}).click();await region(page).getByRole('alert').waitFor();
      assert.equal(last().status,401);assert.equal(await region(page).locator('[data-plan-rule-detail]').count(),0);
    });
    assert.deepEqual(errors,[]);assert.equal(d.definitions(),definitions);assert.equal(d.oldDefinitions(),d.oldDefs);
    return {checks,apiRequests:requests.length,posts:requests.filter(r=>r.method==='POST').length,actual128Parent:true,actual140HandlerServiceSql:true,
      actualLater099Cancellation:true,syntheticAuth:true,realPhone:false,fullAdminE2E:false,externalRequests:0,newCluster:false,productionAccess:false,filesWritten:0};
  }finally{closing=true;for(const gate of gates)gate.release.resolve();await runAttendanceCleanupSteps([
    {name:'plan-rule-browser',run:async()=>{await browser?.close();}},
    {name:'plan-rule-interceptions',run:async()=>{await Promise.allSettled([...pending]);}},
    {name:'plan-rule-loopback',run:async()=>{if(server.listening){server.closeAllConnections();await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}}},
  ]);}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const {runPlanRuleApprovalsNative,planRuleApprovalsNativeFailure}=await import('./merchant-attendance-plan-rule-approvals-native.mjs');
  runPlanRuleApprovalsNative(process.argv.slice(2),checkPlanRuleApprovalsBrowser).then(result=>console.log(JSON.stringify({result}))).catch(error=>{
    console.error(JSON.stringify(planRuleApprovalsNativeFailure(error)));process.exitCode=1;
  });
}
