//INERT231 callback. Commits only one NEW synthetic empty-day period inside the
//existing parent-owned namespace. Parent207 removes that namespace afterward;
//this browser group is explicitly NOT per-case rollback or real authentication.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {assertLifecycleSandbox,lifecycleJson as json} from '../merchant-attendance-lifecycle-native-support.mjs';
import {quote} from './attendance-bound-clocks-native.mjs';
import {outageNativeFingerprintSql} from './attendance-outage-native.mjs';
import {periodContinuationArchiveBytes,periodContinuationSerialization} from './attendance-period-continuation-native.mjs';
import {runAttendanceCleanupSteps} from './attendance-cleanup.mjs';
const require=createRequire(import.meta.url),root=fileURLToPath(new URL('../../',import.meta.url));
export const periodContinuationLiveEndpoint='/api/merchant-enterprise/attendance/period-closures-v2';
export const periodContinuationLiveDate='2010-01-05';
export const periodContinuationLiveLimits=Object.freeze({ttlMs:300000,http:45,api:30,posts:3});
const assetsPaths=new Set(['/','/qa.js','/qa.css','/favicon.ico']);
const tables=Object.freeze(['merchant_attendance_period_closures','merchant_attendance_period_artifacts','merchant_attendance_period_versions',
 'merchant_attendance_period_entries','merchant_attendance_period_artifact_metadata','merchant_attendance_period_storage']);
export function periodContinuationLiveAllowedRequest(raw,method,origin){
 try{const b=new URL(origin),u=new URL(raw);return b.protocol==='http:'&&b.hostname==='127.0.0.1'&&!!b.port&&b.origin===origin
  &&u.origin===origin&&!u.username&&!u.password&&!u.hash&&!/[\u0000-\u0020\u007f\\]/.test(raw)
  &&(assetsPaths.has(u.pathname)?method==='GET'&&!u.search:u.pathname===periodContinuationLiveEndpoint&&['GET','POST'].includes(method));}catch{return false;}
}
//The original rows remain in this hash. Only exact new IDs and the target quota
//projection are excluded. The latter is separately equal to the artifact sum.
export function periodContinuationLiveFactsSql(names,{siteId,periodId=null,operations=[]}){
 assert(Array.isArray(names)&&names.length>0&&new Set(names).size===names.length);assert(/^[0-9]{8}$/.test(siteId));
 assert(operations.length<=3&&new Set(operations).size===operations.length);for(const v of [periodId,...operations].filter(Boolean))assert(/^[a-f0-9-]{36}$/.test(v));
 assert(periodId===null?operations.length===0:operations.length>=1,'period_live_allowance_requires_first_operation');
 const filters={merchant_attendance_period_storage:`r.merchant_id<>${quote(siteId)}`};
 if(periodId){filters.merchant_attendance_period_closures=`not(r.merchant_id=${quote(siteId)} and r.period_id=${quote(periodId)})`;
  filters.merchant_attendance_period_versions=`not(r.merchant_id=${quote(siteId)} and r.period_id=${quote(periodId)} and r.operation_id=${quote(operations[0])})`;
  for(const name of ['merchant_attendance_period_artifacts','merchant_attendance_period_artifact_metadata'])filters[name]=`not(r.merchant_id=${quote(siteId)} and r.artifact_id=${quote(operations[0])})`;
  filters.merchant_attendance_period_entries=`not(r.merchant_id=${quote(siteId)} and r.operation_id=any(array[${operations.map(quote).join(',')}]::uuid[]))`;
 }
 return `(select md5(jsonb_object_agg(n,rows_value order by n)::text) from (${names.map(name=>{
  assert(/^(?:merchants|faolla_schema_migrations|merchant_[a-z0-9_]+)$/.test(name)&&name.length<=63);
  return `select ${quote(name)} n,(select coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),'[]') from public.${name} r ${filters[name]?'where '+filters[name]:''}) rows_value`;
 }).join(' union all ')}) facts)`;
}
async function bounded(promise,ms=15000){let timer;try{return await Promise.race([promise,new Promise((_,no)=>{timer=setTimeout(()=>no(Error('period_live_deadline')),ms);})]);}finally{clearTimeout(timer);}}
async function assets(seed){
 const {build}=await import('esbuild'),{compile}=await import('@tailwindcss/node'),{default:ts}=await import('typescript');
 const bundle=await build({absWorkingDir:root,entryPoints:['scripts/fixtures/attendance-period-continuation-live-browser-entry.tsx'],bundle:true,write:false,metafile:true,
  platform:'browser',format:'esm',target:['es2020'],jsx:'automatic',tsconfig:path.join(root,'tsconfig.json'),outfile:'qa.js',logLevel:'warning',
  define:{'process.env':'{}','process.env.NODE_ENV':'"development"',__PERIOD_LIVE_SEED__:JSON.stringify(seed)}});
 const candidates=new Set();for(const name of Object.keys(bundle.metafile.inputs)){assert(!/node:crypto|\.server\.ts$/.test(name),'period_live_server_in_browser');
  if(!/\.tsx?$/.test(name)||name.includes('node_modules'))continue;const ast=ts.createSourceFile(name,await readFile(path.join(root,name),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const visit=n=>{if(ts.isStringLiteral(n)||ts.isNoSubstitutionTemplateLiteral(n)||ts.isTemplateHead(n)||ts.isTemplateMiddle(n)||ts.isTemplateTail(n))n.text.split(/\s+/).filter(Boolean).forEach(v=>candidates.add(v));ts.forEachChild(n,visit);};visit(ast);}
 const css=(await compile('@import "tailwindcss";',{base:root,onDependency:()=>{}})).build([...candidates])+'body{margin:0;background:#f8fafc;font-family:Arial,sans-serif}.qa-main{max-width:1000px;margin:auto;padding:8px;min-width:0}';
 return {js:bundle.outputFiles.find(f=>f.path.endsWith('.js')).contents,css};
}
export async function verifyPeriodContinuationLiveBrowser(ctx){
 const {d,h,native,scope,pq,period,periodId:oldPeriodId,archive,oldArchive,periodArchive}=ctx;
 assert(d?.syntheticOnly===true&&h?.syntheticOnly===true,'period_live_owned_synthetic_context_required');
 assert.equal(typeof period,'function');
 assert.deepEqual(assertLifecycleSandbox(sql=>native.query(scope.sql(sql))),d.owned);assert.equal(scope.schema,d.owned.schema);
 const names=d.inventory();for(const name of tables)assert(names.includes(name));
 const definitions=d.definitions(),catalog=d.tableCatalog(),old155=periodContinuationArchiveBytes(archive()),old207=periodContinuationArchiveBytes(periodArchive());
 assert.deepEqual(old155,periodContinuationArchiveBytes(oldArchive));
 const prefix=periodContinuationSerialization+d.guard,sql=source=>d.exec(prefix+source),site=quote(d.site);
 const fixedFacts=sql('select '+periodContinuationLiveFactsSql(names,{siteId:d.site})+';');
 const originalRows=JSON.parse(sql(`select jsonb_build_object(${tables.map(name=>`${quote(name)},(select coalesce(jsonb_agg(to_jsonb(r)),'[]') from public.${name} r ${name==='merchant_attendance_period_storage'?`where r.merchant_id<>${site}`:''})`).join(',')});`));
 assert(Buffer.byteLength(JSON.stringify(originalRows),'utf8')<=1048576,'period_live_original_rows_bounded');assert.equal(scope.sql(json(originalRows)),json(originalRows));
 const originals=tables.map(name=>`assert not exists(select old_row.value from jsonb_array_elements(${json(originalRows)}->${quote(name)}) old_row(value)
  except select to_jsonb(current_row) from public.${name} current_row),'period_live_original_row_changed:${name}';`).join('\n');
 let target=null;const operations=[],requests=[],errors=[],inflight=new Set(),fullHash=outageNativeFingerprintSql(names);
 let browser,context,page,server,origin,files,closing=false,stage='prepare',failure=null,totalHttp=0,rpcCalls=0,roleAssertions=0,dropSeal=true,sealSaved=null;
 const integrity=()=>{
  const hash=periodContinuationLiveFactsSql(names,{siteId:d.site,periodId:target,operations});
  sql(`do $period_live_integrity$ begin ${originals}
   assert ${hash}=${quote(fixedFacts)},'period_live_outside_exact_new_rows';
   assert (select used_bytes from public.merchant_attendance_period_storage where merchant_id=${site})=(select sum(artifact_bytes) from public.merchant_attendance_period_artifacts where merchant_id=${site}),'period_live_quota_sum';
  end;$period_live_integrity$;`);
  assert.equal(d.definitions(),definitions);assert.equal(d.tableCatalog(),catalog);
  assert.deepEqual(periodContinuationArchiveBytes(archive()),old155);assert.deepEqual(periodContinuationArchiveBytes(periodArchive()),old207);
 };
 const {executePeriodClosuresV2}=require('../../src/lib/merchantAttendancePeriodClosureV2.server.ts');
 const {parsePeriodClosureV2HttpQuery,parsePeriodClosureV2Body,parsePeriodClosureV2Query}=require('../../src/lib/merchantAttendancePeriodClosureV2.ts');
 const {parsePeriodClosureQuery,parsePeriodClosureCommand}=require('../../src/lib/merchantAttendancePeriodClosure.ts');
 const {handlePeriodClosuresV2}=require('../../src/app/api/merchant-enterprise/attendance/period-closures-v2/route-handler.ts');
 const oldQuery=parsePeriodClosureQuery(pq('detail','owner',oldPeriodId));
 const legacy=JSON.parse(sql(`select jsonb_build_object('command',e.command,'actorId',e.actor_auth_user_id,'employeeId',c.employee_id,'employeeAuthUserId',c.employee_auth_user_id)
  from public.merchant_attendance_period_closures c join public.merchant_attendance_period_versions v on v.merchant_id=c.merchant_id and v.period_id=c.period_id and v.version=1
  join public.merchant_attendance_period_artifacts a on a.merchant_id=v.merchant_id and a.artifact_id=v.artifact_id
  join public.merchant_attendance_period_entries e on e.merchant_id=a.merchant_id and e.operation_id=a.artifact_id
  where c.merchant_id=${site} and c.period_id=${quote(oldPeriodId)};`));
 assert.equal(legacy.actorId,d.owner);assert.equal(legacy.command.action,'send');parsePeriodClosureCommand(oldQuery,legacy.command);
 const oldPendingRaw=JSON.stringify({format:1,actorId:d.owner,employeeId:legacy.employeeId,employeeAuthUserId:legacy.employeeAuthUserId,query:oldQuery,command:legacy.command},null,2);
 const query=()=>parsePeriodClosureV2Query({siteId:d.site,access:'owner',workerId:h.workerId,fromDate:periodContinuationLiveDate,throughDate:periodContinuationLiveDate,
  mode:'preview',periodId:null,operationId:null,version:null,cursor:null});
 const validQuery=q=>{
  assert.equal(q.siteId,d.site);assert.equal(q.workerId,h.workerId);
  if(q.periodId===oldPeriodId){assert.equal(q.mode,'recover');assert.equal(q.access,'owner');assert.equal(q.operationId,legacy.command.operationId);assert.equal(q.fromDate,oldQuery.fromDate);assert.equal(q.throughDate,oldQuery.throughDate);}
  else{assert.equal(q.fromDate,periodContinuationLiveDate);assert.equal(q.throughDate,periodContinuationLiveDate);assert(q.periodId===null||target!==null&&q.periodId===target);}
 };
 const service={rpc:async(name,args)=>{
  assert(['faolla_attendance_period_closure_v2','faolla_attendance_period_closure_source_v1'].includes(name));
  validQuery(args.p_query);assert.equal(args.p_auth_user_id,args.p_query.access==='self'?h.employeeAuthUserId:d.owner);
  const keys=name.endsWith('_source_v1')?['p_query','p_auth_user_id']:['p_query','p_auth_user_id','p_command','p_artifact','p_allow_write'];
  assert.deepEqual(Object.keys(args).sort(),[...keys].sort());assert.equal(scope.sql(json(args)),json(args));
  if(args.p_command){assert.equal(args.p_command.periodId,target);assert(operations.includes(args.p_command.operationId));}
  const expression=`public.${name}(${keys.map(k=>k==='p_auth_user_id'?quote(args[k]):k==='p_allow_write'?String(args[k]):json(args[k])).join(',')})`;
  const v=JSON.parse(sql(`do $period_live_rpc$ declare before_facts text;value jsonb;failure text;context_value text;begin
   before_facts:=${fullHash};begin set local role service_role;assert current_user='service_role','period_live_actual_role';
    value:=${expression};set constraints all immediate;set constraints all deferred;
   exception when others then get stacked diagnostics failure=message_text,context_value=pg_exception_context;end;reset role;
   if failure is not null or ${args.p_command==null?'true':'false'} then assert ${fullHash}=before_facts,'period_live_get_rejection_changed_facts';end if;
   perform set_config('faolla.period_live_result',jsonb_build_object('value',value,'error',failure,'context',context_value)::text,true);
  end;$period_live_rpc$;select current_setting('faolla.period_live_result')::jsonb;`));
  rpcCalls++;roleAssertions++;integrity();if(v.error)return {data:null,error:{message:v.error}};return {data:v.value,error:null};
 }};
 const handle=(request,access,enabled)=>handlePeriodClosuresV2(request,{siteEnabled:()=>enabled,allow:()=>true,
  authenticate:async()=>({user:{id:access==='self'?h.employeeAuthUserId:d.owner},authenticationMethods:['password']}),
  entitlement:async()=>({permissionConfig:{allowEnterpriseManagement:true,allowEmployeeAttendance:true}}),execute:input=>executePeriodClosuresV2(input,service)});
 const deadline=Date.now()+periodContinuationLiveLimits.ttlMs,timer=setTimeout(()=>{closing=true;void context?.close().catch(()=>{});server?.closeAllConnections();},periodContinuationLiveLimits.ttlMs);
 const key=`faolla:attendance:period-closures:v1:${d.site}:owner:${d.owner}`;
 try{
  sql(`do $period_live_window$ begin assert not exists(select 1 from public.merchant_attendance_period_closures where merchant_id=${site} and worker_id=${quote(h.workerId)}
   and start_at<'2010-01-06T00:00:00Z'::timestamptz and end_at>'2010-01-05T00:00:00Z'::timestamptz),'period_live_new_day_must_be_unoccupied';end;$period_live_window$;`);
  const prepared=await executePeriodClosuresV2({query:query(),authUserId:d.owner,moduleEnabled:true},service);
  assert.equal(prepared.kind,'preview');assert.deepEqual(prepared.preview.blockers,[]);assert.equal(prepared.preview.period,null);
  assert.deepEqual(prepared.preview.artifact.report.base.rows,[]);assert.deepEqual(prepared.preview.artifact.report.missing,[]);
  files=await bounded(assets({siteId:d.site,owner:d.owner,employee:h.employeeId,workerId:h.workerId,date:periodContinuationLiveDate}),60000);
  server=createServer((request,response)=>{if(closing||!origin||request.headers.host!==new URL(origin).host||request.method!=='GET')return response.writeHead(403).end();
   const u=new URL(request.url,origin);if(!assetsPaths.has(u.pathname)||u.search)return response.writeHead(403).end();
   response.setHeader('Cache-Control','no-store');response.setHeader('X-Content-Type-Options','nosniff');response.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
   if(u.pathname==='/favicon.ico')return response.writeHead(204).end();
   const html='<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><link rel="stylesheet" href="/qa.css"><div id="qa-root"></div><script type="module" src="/qa.js"></script></html>';
   response.writeHead(200,{'Content-Type':u.pathname==='/'?'text/html;charset=utf-8':u.pathname==='/qa.js'?'text/javascript;charset=utf-8':'text/css;charset=utf-8'}).end(u.pathname==='/'?html:u.pathname==='/qa.js'?files.js:files.css);});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const address=server.address();assert(address&&typeof address==='object'&&address.address==='127.0.0.1');origin=`http://127.0.0.1:${address.port}`;
  const {chromium}=await import('playwright');browser=await chromium.launch({headless:true});context=await browser.newContext({serviceWorkers:'block',acceptDownloads:false,viewport:{width:390,height:940}});
  await context.addInitScript(()=>{window.__periodLiveCsp=[];document.addEventListener('securitypolicyviolation',e=>window.__periodLiveCsp.push(e.violatedDirective));});
  await context.route('**/*',route=>{const work=(async()=>{const request=route.request(),u=new URL(request.url()),method=request.method();
   assert(Date.now()<deadline&&++totalHttp<=periodContinuationLiveLimits.http,'period_live_http_limit');assert(periodContinuationLiveAllowedRequest(u.href,method,origin),'period_live_external_request');
   if(assetsPaths.has(u.pathname))return route.continue();assert(requests.length<periodContinuationLiveLimits.api);
   const access=request.headers()['x-period-live-access'],gate=request.headers()['x-period-live-enabled'];assert(['owner','self'].includes(access));assert(['0','1'].includes(gate));
   const text=request.postData();let parsed=null;if(method==='POST'){
    assert(text&&Buffer.byteLength(text,'utf8')<=8192);parsed=parsePeriodClosureV2Body(JSON.parse(text));
    assert.equal(parsed.query.access,access);assert.equal(parsed.query.fromDate,periodContinuationLiveDate);assert.equal(parsed.query.throughDate,periodContinuationLiveDate);
    assert.equal(parsed.command.action,['send','confirm','seal'][operations.length]);assert.equal(access,['owner','self','owner'][operations.length]);assert(operations.length<3);
    if(target===null){target=parsed.command.periodId;sql(`do $period_live_newid$ begin assert not exists(select 1 from public.merchant_attendance_period_closures where merchant_id=${site} and period_id=${quote(target)}),'period_live_new_id_used';end;$period_live_newid$;`);}
    assert.equal(parsed.command.periodId,target);assert(!operations.includes(parsed.command.operationId));
    sql(`do $period_live_newop$ begin assert not exists(select 1 from public.merchant_attendance_period_entries where merchant_id=${site} and operation_id=${quote(parsed.command.operationId)}),'period_live_operation_used';end;$period_live_newop$;`);
    operations.push(parsed.command.operationId);
   }
   const q=parsed?.query??parsePeriodClosureV2HttpQuery(u.href);validQuery(q);assert.equal(q.access,access);
   const canonical='https://www.faolla.com',headers={host:'www.faolla.com',origin:canonical,'sec-fetch-site':'same-origin',...(text?{'content-type':'application/json'}:{})};
   const response=await handle(new Request(canonical+u.pathname+u.search,{method,headers,...(text?{body:text}:{})}),access,gate==='1'),output=await response.text();
   assert.equal(response.status,200,output);assert.equal(response.headers.get('cache-control'),'private, no-store');const body=JSON.parse(output);
   requests.push({method,mode:q.mode,action:parsed?.command.action??null,access,enabled:gate==='1',status:response.status});integrity();
   const truncate=method==='POST'&&parsed.command.action==='seal'&&dropSeal;if(truncate){dropSeal=false;sealSaved=body.data;}
   await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:truncate?output.slice(0,8):output});
  })();inflight.add(work);void work.finally(()=>inflight.delete(work)).catch(()=>{});return work.catch(async error=>{if(!closing)errors.push(error.message);await route.abort().catch(()=>{});});});
  page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));page.on('popup',()=>errors.push('unexpected_popup'));page.on('download',()=>errors.push('unexpected_download'));
  page.on('dialog',dialog=>void dialog.accept().catch(()=>{}));
  const region=()=>page.locator('[data-period-closure-v2]'),quiet=async()=>{await page.waitForLoadState('networkidle');await bounded(Promise.all([...inflight]));};
  const open=async()=>{await page.getByRole('button',{name:/^(周期核对、争议与封存|核对待确认周期原编号)$/}).click();await region().waitFor();await quiet();};
  const click=async(locator,mode,method='GET',malformed=false)=>{const [response]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname===periodContinuationLiveEndpoint&&r.request().method()===method&&
    (method==='POST'?r.request().postDataJSON()?.query.mode:new URL(r.url()).searchParams.get('mode'))===mode),locator.click()]);await response.finished();assert.equal(response.status(),200);await quiet();return malformed?null:response.json();};
  const detail=async()=>{const listed=await click(region().getByRole('button',{name:'读取周期列表',exact:true}),'list');assert.equal(listed.data.items.length,1);
   assert.equal(listed.data.items[0].periodId,target);return click(region().getByRole('button',{name:'读取保存版本',exact:true}),'detail');};
  const act=async(label,reason,malformed=false)=>{await region().getByLabel('周期操作理由',{exact:true}).fill(reason);return click(region().getByRole('button',{name:label,exact:true}),'detail','POST',malformed);};
  stage='initial';await page.goto(origin);await open();assert.equal(requests.length,0);
  stage='owner_send';const preview=await click(region().getByRole('button',{name:'预览完整周期资料',exact:true}),'preview');assert.deepEqual(preview.data.preview.blockers,[]);
  const sent=await act('保存版本并发起核对','231 browser explicit new empty-day review');assert.equal(sent.data.period.revision,1);assert.equal(sent.data.period.currentVersion,1);assert.equal(sent.data.period.periodId,target);
  stage='self_confirm';await page.getByTestId('live-self').click();await open();const self=await detail();assert.deepEqual(self.data.artifact,sent.data.artifact);
  const confirmed=await act('确认本保存版本','231 browser employee explicitly confirms this saved version');assert.equal(confirmed.data.period.confirmedVersion,1);assert.equal(confirmed.data.period.revision,2);
  stage='owner_seal_loss';await page.getByTestId('live-owner').click();await open();await detail();await act('封存本人已确认版本','231 browser seals only this newly created empty day',true);
  await region().locator('[data-period-closure-pending]').waitFor();const pendingRaw=await page.evaluate(k=>sessionStorage.getItem(k),key);assert(pendingRaw);
  const pending=JSON.parse(pendingRaw);assert.equal(pending.format,2);assert.equal(pending.command.operationId,operations[2]);assert.equal(sealSaved.period.sealed,true);assert.equal(sealSaved.period.revision,3);
  stage='flagoff_recover';await page.getByTestId('live-off').click();await page.reload();await open();await region().locator('[data-period-closure-pending]').waitFor();assert.equal(requests.filter(r=>r.method==='POST').length,3);
  assert.equal(await page.evaluate(k=>sessionStorage.getItem(k),key),pendingRaw);
  const recovered=await click(region().getByRole('button',{name:'核对原周期编号',exact:true}),'recover');assert.deepEqual(recovered.data.operation,sealSaved.operation);assert.equal(recovered.moduleEnabled,false);
  assert.equal(await page.evaluate(k=>sessionStorage.getItem(k),key),null);assert.equal(await region().getByLabel('周期操作理由',{exact:true}).isDisabled(),true);
  stage='legacy_format1';await page.evaluate(({key,raw})=>sessionStorage.setItem(key,raw),{key,raw:oldPendingRaw});const beforeLegacy=requests.length;await page.reload();await open();
  assert.equal(requests.length,beforeLegacy);assert.equal(await page.evaluate(k=>sessionStorage.getItem(k),key),oldPendingRaw);await region().locator('[data-period-closure-pending]').waitFor();
  const legacyRecovered=await click(region().getByRole('button',{name:'核对原周期编号',exact:true}),'recover');assert.equal(legacyRecovered.moduleEnabled,false);
  assert.equal(legacyRecovered.data.period.periodId,oldPeriodId);assert.equal(legacyRecovered.data.artifactVersion,1);assert.deepEqual(legacyRecovered.data.operation.command,legacy.command);
  assert.deepEqual(legacyRecovered.data.artifact,JSON.parse(old207.artifactText));assert.equal(await page.evaluate(k=>sessionStorage.getItem(k),key),null);
  assert.equal(await region().getByLabel('周期操作理由',{exact:true}).isDisabled(),true);assert.equal(await region().getByRole('button',{name:'下载本保存版本 CSV',exact:true}).isDisabled(),true);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false,'period_live_mobile_overflow');
  assert.deepEqual(errors,[]);assert.deepEqual(await page.evaluate(()=>window.__periodLiveCsp),[]);assert.equal(operations.length,3);assert.equal(requests.filter(r=>r.method==='POST').length,3);integrity();
  const proof=JSON.parse(sql(`select jsonb_build_object('heads',(select count(*) from public.merchant_attendance_period_closures where merchant_id=${site} and period_id=${quote(target)}),
   'artifacts',(select count(*) from public.merchant_attendance_period_artifacts where merchant_id=${site} and period_id=${quote(target)}),
   'versions',(select count(*) from public.merchant_attendance_period_versions where merchant_id=${site} and period_id=${quote(target)}),
   'entries',(select count(*) from public.merchant_attendance_period_entries where merchant_id=${site} and period_id=${quote(target)}),
   'bytes',(select sum(artifact_bytes) from public.merchant_attendance_period_artifacts where merchant_id=${site} and period_id=${quote(target)}));`));
  assert.deepEqual([proof.heads,proof.artifacts,proof.versions,proof.entries],[1,1,1,3]);assert(proof.bytes>0&&proof.bytes<=262144);
  return {groups:2,actualReactLauncher:true,actualV2Workspace:true,actualRouteHandlerServiceSql:true,syntheticAuth:true,realAuth:false,
   newPeriodDate:periodContinuationLiveDate,newPeriodId:target,posts:3,apiRequests:requests.length,totalHttp,rpcCalls,roleAssertions,preflightReads:1,
   newRows:proof,bodyTruncatedAfterCommit:true,networkDisconnectSimulated:false,browserGeneratedOperations:true,flagoffGetRecovery:true,
   format1LocalPendingSynthetic:true,format1ReceiptFromRealV1:true,old155And207ArchivesUnchanged:true,allOriginalRowsUnchanged:true,quotaEqualsArtifactSum:true,
   perCaseRollback:false,cleanupOwner:'parent207 owned namespace and public baseline',width390:true,headless:true,externalRequests:0,diskBundles:false,screenshots:false};
 }catch(error){failure=Error('period_continuation_live_failed:'+stage+':'+String(error?.message??error),{cause:error});throw failure;}
 finally{closing=true;clearTimeout(timer);const cleanup=[];
  for(const step of [{name:'period live context',run:()=>context?context.close():undefined},{name:'period live browser',run:()=>browser?browser.close():undefined},
   {name:'period live inflight',run:()=>Promise.allSettled([...inflight])},{name:'period live listener',run:()=>{server?.closeAllConnections();return server?.listening?new Promise((r,j)=>server.close(e=>e?j(e):r())):undefined;}},
   {name:'period live esbuild',run:async()=>{(await import('esbuild')).stop();}},{name:'period live original facts',run:async()=>{
    integrity();const unchanged=await period(pq('detail','owner',oldPeriodId));assert.equal(unchanged.period.sealed,true);assert.equal(unchanged.sourceChanged,false);
   }}])cleanup.push(step);
  try{await runAttendanceCleanupSteps(cleanup);}catch(error){if(failure)throw new AggregateError([failure,error],'period_live_failure_and_cleanup_failure',{cause:failure});throw error;}
 }
}
export const runPeriodContinuationLiveBrowser=verifyPeriodContinuationLiveBrowser;
