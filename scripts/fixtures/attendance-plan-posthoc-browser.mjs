//208 inert loopback UI bridge. Importing performs no build, listen,
//SQL call or browser launch. Only the root-owned native callback may invoke it.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {randomBytes} from 'node:crypto';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {assertLifecycleSandbox,lifecycleJson as json} from '../merchant-attendance-lifecycle-native-support.mjs';
import {quote} from './attendance-bound-clocks-native.mjs';
import {runAttendanceCleanupSteps} from './attendance-cleanup.mjs';
const require=createRequire(import.meta.url),root=fileURLToPath(new URL('../../',import.meta.url));
export const POSTHOC_BROWSER_APIS=Object.freeze({
 admin:'/api/merchant-enterprise/attendance/admin',self:'/api/merchant-enterprise/attendance/self',
 exception:'/api/merchant-enterprise/attendance/plan-exceptions',adoption:'/api/merchant-enterprise/attendance/plan-posthoc',
 evaluation:'/api/merchant-enterprise/attendance/plan-posthoc-evaluation',notification:'/api/merchant-enterprise/attendance/event-notifications',
});
export const POSTHOC_BROWSER_DEADLINE_MS=20*60*1000;
//Finish and expiry are separate signals. Finishing the bridge must not abandon
//the external callback's browser cleanup; only expiry can interrupt that wait.
export function posthocBrowserDeadline(onExpire,timeoutMs=POSTHOC_BROWSER_DEADLINE_MS){
 let timer;const expired=new Promise((_,reject)=>{timer=setTimeout(()=>{
  try{onExpire();}finally{reject(Error('plan_posthoc_browser_20_minute_deadline'));}
 },timeoutMs);});void expired.catch(()=>{});
 return {wait:pending=>Promise.race([pending,expired]),cancel:()=>clearTimeout(timer)};
}
//Send headers and part of the declared body first: an empty pre-header socket
//reset can trigger Chromium's transparent HTTP retry of the same POST.
export async function truncatePosthocBrowserResponse(res,status,headers,output){
 const bytes=Buffer.from(output,'utf8');assert(bytes.length>8);
 if(res.destroyed)return;
 res.writeHead(status,{...headers,'Content-Type':'application/json;charset=utf-8','Content-Length':String(bytes.length)});
 res.flushHeaders();
 await new Promise(resolve=>{res.once('close',resolve);res.write(bytes.subarray(0,8),()=>setImmediate(()=>res.destroy()));});
}
const paths=new Set(Object.values(POSTHOC_BROWSER_APIS));
const rpcArguments=Object.freeze({
 faolla_attendance_admin_v1:['p_site_id','p_auth_user_id','p_query','p_command','p_operation_id'],
 faolla_attendance_self_v1:['p_site_id','p_auth_user_id','p_command','p_operation_id'],
 faolla_attendance_self_bound_v1:['p_site_id','p_auth_user_id','p_command','p_operation_id'],
 faolla_attendance_plan_exception_posthoc_review_v1:['p_query','p_auth_user_id','p_command','p_allow_write','p_allow_posthoc','p_allow_clearance','p_capture_notifications'],
 faolla_attendance_plan_posthoc_adoption_v1:['p_query','p_auth_user_id','p_command','p_allow_write'],
 faolla_attendance_plan_posthoc_evaluation_v1:['p_query','p_auth_user_id'],
 faolla_attendance_event_notifications_v1:['p_query','p_auth_user_id','p_command','p_allow_write'],
});
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const exact=(value,keys)=>{assert(object(value));assert.deepEqual(Object.keys(value).sort(),[...keys].sort());return value;};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const refKey=r=>r.kind==='session'?'session:'+r.startEventId:'missing:'+r.requestId;
//Pure request guard. Request parsing below cannot grant business permission:
//the real route/parser/service and current synthetic SQL actor still authorize.
export function validatePosthocBrowserRequest({url,method,headers,remoteAddress,body=null},{origin,token,subject,selected}){
 const u=new URL(url,origin),h=new Headers(headers);
 assert.equal(new URL(origin).hostname,'127.0.0.1');assert.equal(u.origin,origin);assert(!u.hash);
 assert(['127.0.0.1','::ffff:127.0.0.1'].includes(remoteAddress),'non_loopback_peer');
 assert.equal(h.get('host'),new URL(origin).host,'wrong_host');
 assert(!h.has('forwarded')&&!h.has('x-forwarded-host')&&!h.has('x-forwarded-for'),'forwarded_headers');
 assert(!['cross-site','same-site'].includes(h.get('sec-fetch-site')),'cross_origin');
 assert(h.get('origin')===null||h.get('origin')===origin,'wrong_origin');
 assert(['GET','POST'].includes(method),'method_not_allowed');
 for(const key of u.searchParams.keys())assert.equal(u.searchParams.getAll(key).length,1,'duplicate_query');
 if(['/', '/qa.js','/qa.css','/favicon.ico'].includes(u.pathname)){assert.equal(method,'GET');assert.equal(u.search,'');return {kind:'asset',path:u.pathname};}
 if(u.pathname==='/__qa/stats'){assert.equal(method,'GET');assert.equal(u.search,'');return {kind:'stats',path:u.pathname};}
 assert.equal(h.get('x-posthoc-qa-token'),token,'missing_qa_token');
 if(method==='POST'){assert.equal(h.get('origin'),origin,'mutation_origin_required');assert.equal(h.get('content-type')?.split(';')[0].trim(),'application/json');}
 if(u.pathname==='/__qa/control'){
  assert.equal(method,'POST');assert.equal(u.search,'');exact(body,['action','value']);
  assert(['server-gate','drop-post','hold-get','release-get','finish'].includes(body.action));assert.equal(typeof body.value,'boolean');
  return {kind:'control',action:body.action,value:body.value};
 }
 assert(paths.has(u.pathname),'unexpected_api');
 const access=h.get('x-posthoc-qa-access');assert(['owner','self'].includes(access),'invalid_access');
 const q=method==='POST'?(assert(object(body)&&object(body.query)&&object(body.command)),body.query):Object.fromEntries(u.searchParams);
 assert.equal(q.siteId,subject.site,'wrong_site');
 if(method==='POST')assert.equal(u.search,'','post_query_forbidden');
 if(u.pathname===POSTHOC_BROWSER_APIS.admin){assert.equal(access,'owner');assert.equal(method,'GET');}
 if(u.pathname===POSTHOC_BROWSER_APIS.self){assert.equal(access,'self');assert.equal(method,'GET');}
 if([POSTHOC_BROWSER_APIS.adoption,POSTHOC_BROWSER_APIS.evaluation].includes(u.pathname)){
  assert.equal(access,'owner');assert.equal(q.workerId,subject.worker);assert.equal(q.slotId,subject.slotId);
  if(u.pathname===POSTHOC_BROWSER_APIS.evaluation)assert.equal(method,'GET');
  if(method==='POST'){
   const c=body.command;assert(['apply','revoke'].includes(c.action));assert.equal(c.employeeId,subject.employee);assert.equal(c.employeeAuthUserId,subject.auth);
   if(c.action==='apply'){assert(Array.isArray(c.sources)&&c.sources.length<=10);assert.equal(new Set(c.sources.map(refKey)).size,c.sources.length);
    for(const source of c.sources){const allowed=selected.find(item=>refKey(item)===refKey(source));assert(allowed&&Object.keys(allowed).length===Object.keys(source).length&&Object.keys(allowed).every(k=>same(allowed[k],source[k])),'source_outside_approved_fixture');}}
  }
 }
 if(u.pathname===POSTHOC_BROWSER_APIS.exception){
  assert.equal(q.access,access);assert(['list','detail','recover','decide','note','ack'].includes(q.mode));
  if(q.mode!=='list'){assert.equal(q.workerId,subject.worker);assert.equal(q.slotId,subject.slotId);}
  if(method==='POST'){
   assert(access==='owner'?q.mode==='decide':['note','ack'].includes(q.mode),'unapproved_exception_action');
   if(q.mode==='decide'){assert.equal(body.command.employeeId,subject.employee);assert.equal(body.command.employeeAuthUserId,subject.auth);
    assert(['confirmed','excused','follow_up','cleared','not_applicable'].includes(body.command.outcome));}
  }else assert(['list','detail','recover'].includes(q.mode));
 }
 if(u.pathname===POSTHOC_BROWSER_APIS.notification){
  assert.equal(access,'self');assert.equal(q.expectedEmployeeId,subject.employee);
  assert(q.expectedWorkerId==null||q.expectedWorkerId===subject.worker);
  if(method==='POST'){exact(body.command,['action','notificationId']);assert.equal(body.command.action,'mark_read');}
 }
 return {kind:'api',path:u.pathname,access,query:q,command:method==='POST'?body.command:null};
}
export function posthocBrowserRequestSummary(request,response,payload){
 const data=payload?.data??payload,receipt=data?.receipt??data?.readReceipt??null;
 return {path:request.path,method:request.command?'POST':'GET',access:request.access,mode:request.query.mode??null,
  action:request.command?.action??(request.query.mode==='decide'?'decide':request.command?request.query.mode:null),
  operationId:request.command?.operationId??request.query.operationId??null,outcome:request.command?.outcome??null,status:response.status,error:payload?.error??null,
  receiptOperationId:receipt?.operationId??null,receiptOutcome:receipt?.item?.outcome??null,receiptRevision:receipt?.item?.revision??null,
  currentRevision:data?.revision??data?.detail?.revision??null,currentOutcome:data?.detail?.latestDecision?.outcome??null,
  canWrite:typeof payload?.canWrite==='boolean'?payload.canWrite:null,canMarkRead:typeof data?.canMarkRead==='boolean'?data.canMarkRead:null,
  notificationId:data?.detail?.notificationId??null,notificationReadAt:data?.detail?.readAt??null,
  dropped:false,held:false};
}
//Use the same whole-owned-facts fingerprint for reads and rejected writes.
//This runs inside the bridge's serialized SQL task, before fault injection or
//publication of the request statistic. Successful writes are allowed to mutate.
export function verifyPosthocBrowserFacts(method,response,before,readFacts){
 assert(['GET','POST'].includes(method));
 const getFactHashUnchanged=method==='GET',rejectedPostFactHashUnchanged=method==='POST'&&!response.ok;
 if(getFactHashUnchanged||rejectedPostFactHashUnchanged){
  assert.equal(readFacts(),before,getFactHashUnchanged?'qa_get_wrote':'qa_rejected_post_wrote');
 }
 return {getFactHashUnchanged,rejectedPostFactHashUnchanged};
}
async function assets(){
 const {build}=await import('esbuild'),{compile}=await import('@tailwindcss/node'),{default:ts}=await import('typescript');
 const bundle=await build({absWorkingDir:root,entryPoints:['scripts/fixtures/attendance-plan-posthoc-browser.tsx'],bundle:true,write:false,metafile:true,
  platform:'browser',format:'esm',target:['es2020'],jsx:'automatic',tsconfig:path.join(root,'tsconfig.json'),outfile:'qa.js',logLevel:'warning',
  define:{'process.env':'{}','process.env.NODE_ENV':'"development"',
   'process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_PLAN_POSTHOC_ENABLED':'window.__posthocFrontFlag',
   'process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_PLAN_POSTHOC_REVIEW_ENABLED':'window.__posthocFrontFlag',
   'process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_PLAN_CLEARANCE_ENABLED':'window.__posthocFrontFlag'}});
 for(const name of Object.keys(bundle.metafile.inputs))assert(!/node:crypto|\.server\.ts$/.test(name),'server_code_in_browser');
 const candidates=new Set();
 for(const name of Object.keys(bundle.metafile.inputs).filter(n=>/\.tsx?$/.test(n)&&!n.includes('node_modules'))){
  const ast=ts.createSourceFile(name,await readFile(path.join(root,name),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const visit=node=>{if(ts.isStringLiteral(node)||ts.isNoSubstitutionTemplateLiteral(node)||ts.isTemplateHead(node)||ts.isTemplateMiddle(node)||ts.isTemplateTail(node))node.text.split(/\s+/).filter(Boolean).forEach(v=>candidates.add(v));ts.forEachChild(node,visit);};visit(ast);
 }
 const css=(await compile('@import "tailwindcss";',{base:root,onDependency:()=>{}})).build([...candidates])+
  'body{margin:0;background:#f1f5f9;font-family:Arial,sans-serif}.qa-toolbar{padding:8px;background:#fff7ed;font-size:12px;overflow-wrap:anywhere}.qa-controls{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0}.qa-controls button{border:1px solid #94a3b8;background:white;padding:6px}.qa-main{max-width:1050px;margin:auto;padding:8px;min-width:0;box-sizing:border-box}.qa-main[data-narrow=true]{width:390px;max-width:100%}.qa-note{padding:6px;white-space:pre-wrap}.qa-toolbar pre{max-height:12em;overflow:auto}';
 return {js:bundle.outputFiles.find(f=>f.path.endsWith('.js')).text,css};
}
function buildPorts(ctx,state){
 const {d,h}=ctx,subject={site:d.site,owner:d.owner,employee:h.employeeId,auth:h.employeeAuthUserId,worker:h.workerId,slotId:h.slot.id};
 const {handleAttendanceAdmin}=require('../../src/app/api/merchant-enterprise/attendance/admin/route-handler.ts');
 const {executeAttendanceAdmin}=require('../../src/lib/merchantAttendanceAdmin.server.ts');
 const {handleAttendanceSelf}=require('../../src/app/api/merchant-enterprise/attendance/self/route-handler.ts');
 const {executeAttendanceSelf}=require('../../src/lib/merchantAttendanceSelf.server.ts');
 const {handlePlanExceptions}=require('../../src/app/api/merchant-enterprise/attendance/plan-exceptions/route-handler.ts');
 const {executePlanExceptions}=require('../../src/lib/merchantAttendancePlanExceptions.server.ts');
 const {handlePlanPosthoc}=require('../../src/app/api/merchant-enterprise/attendance/plan-posthoc/route-handler.ts');
 const {executePlanPosthoc}=require('../../src/lib/merchantAttendancePlanPosthoc.server.ts');
 const {handlePlanPosthocEvaluation}=require('../../src/app/api/merchant-enterprise/attendance/plan-posthoc-evaluation/route-handler.ts');
 const {executePlanPosthocEvaluation}=require('../../src/lib/merchantAttendancePlanPosthocEvaluation.server.ts');
 const {handleEventNotifications}=require('../../src/app/api/merchant-enterprise/attendance/event-notifications/route-handler.ts');
 const {executeEventNotifications}=require('../../src/lib/merchantAttendanceEventNotifications.server.ts');
 const owned=()=>assert.deepEqual(assertLifecycleSandbox(sql=>ctx.native.query(ctx.scope.sql(sql))),d.owned);
 const service={rpc:async(name,args)=>{
  assert(Object.hasOwn(rpcArguments,name),'unapproved_rpc:'+name);exact(args,rpcArguments[name]);
  assert([subject.owner,subject.auth].includes(args.p_auth_user_id),'wrong_rpc_actor');
  assert.equal(args.p_site_id??args.p_query.siteId,subject.site,'wrong_rpc_site');
  if([POSTHOC_BROWSER_APIS.admin,POSTHOC_BROWSER_APIS.self].includes(state.path))assert.equal(args.p_command,null,'no_clock_or_config_writes');
  // Gate narrows the real server env; it cannot bypass SQL entitlement/replay.
  if(name==='faolla_attendance_plan_exception_posthoc_review_v1')args={...args,p_allow_posthoc:args.p_allow_posthoc&&state.serverGate,p_allow_clearance:args.p_allow_clearance&&state.serverGate};
  if(name==='faolla_attendance_plan_posthoc_adoption_v1')args={...args,p_allow_write:args.p_allow_write&&state.serverGate};
  owned();const parts=Object.entries(args).map(([key,value])=>key+'=>'+(value===null?'null':typeof value==='boolean'?String(value):typeof value==='object'?json(value):quote(value)));
  try{return {data:JSON.parse(d.exec('set local role service_role;select public.'+name+'('+parts.join(',')+');')),error:null};}
  catch(error){const code=String(error).match(/ERROR:\s+(attendance_[a-z_]+)/)?.[1];if(!code)throw error;return {data:null,error:{message:code}};}
 }};
 const auth=id=>async()=>({user:{id},authenticationMethods:['password']});
 const common={enabled:()=>true,siteEnabled:()=>true,allow:()=>true,entitlement:async()=>({permissionConfig:{allowEnterpriseManagement:true,allowEmployeeAttendance:true}})};
 return {subject,owned,async handle(request,access){
  const p=new URL(request.url).pathname;state.path=p;
  if(p===POSTHOC_BROWSER_APIS.admin)return handleAttendanceAdmin(request,{...common,authenticate:auth(subject.owner),execute:i=>executeAttendanceAdmin(i,service)});
  if(p===POSTHOC_BROWSER_APIS.self)return handleAttendanceSelf(request,{...common,authenticate:auth(subject.auth),execute:i=>executeAttendanceSelf(i,service)});
  if(p===POSTHOC_BROWSER_APIS.exception)return handlePlanExceptions(request,{...common,authenticate:auth(access==='owner'?subject.owner:subject.auth),execute:i=>executePlanExceptions(i,service)});
  if(p===POSTHOC_BROWSER_APIS.adoption)return handlePlanPosthoc(request,{...common,siteEnabled:()=>state.serverGate,authenticate:auth(subject.owner),execute:i=>executePlanPosthoc(i,service)});
  if(p===POSTHOC_BROWSER_APIS.evaluation)return handlePlanPosthocEvaluation(request,{...common,authenticate:auth(subject.owner),execute:i=>executePlanPosthocEvaluation(i,service)});
  if(p===POSTHOC_BROWSER_APIS.notification)return handleEventNotifications(request,{...common,authenticate:auth(subject.auth),execute:i=>executeEventNotifications(i,service)});
  throw Error('unapproved_handler');
 }};
}
async function readBody(req){
 assert(/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']??''));const declared=req.headers['content-length'];
 assert(declared===undefined||/^\d+$/.test(declared)&&Number(declared)<=8192);let bytes=0;const chunks=[];
 const timer=setTimeout(()=>req.destroy(Error('qa_body_timeout')),5000);
 try{for await(const chunk of req){bytes+=chunk.length;assert(bytes<=8192,'qa_body_too_large');chunks.push(chunk);}return Buffer.concat(chunks).toString('utf8');}finally{clearTimeout(timer);}
}
export async function runPlanPosthocBrowserAcceptance(ctx){
 assert(ctx?.d?.syntheticOnly&&ctx?.h?.syntheticOnly,'synthetic_context_required');
 for(const key of ['all','archive'])assert.equal(typeof ctx[key],'function');
 const state={serverGate:false,path:null,dropPost:false,holdGet:false},ports=buildPorts(ctx,state);ports.owned();
 assert(Array.isArray(ctx.selected)&&ctx.selected.length<=10);const token=randomBytes(24).toString('hex');
 const requests=[],rejections=[],inflight=new Set(),held=new Set();let files,origin,server,deadline,failure=null,closing=false,completed=false,queue=Promise.resolve(),qaRequests=0;
 let resolveDone;const done=new Promise(resolve=>{resolveDone=resolve;});
 const env={FAOLLA_ATTENDANCE_PLAN_POSTHOC_ENABLED:'1',FAOLLA_ATTENDANCE_PLAN_POSTHOC_SITE_IDS:ports.subject.site,
  FAOLLA_ATTENDANCE_PLAN_POSTHOC_REVIEW_ENABLED:'1',FAOLLA_ATTENDANCE_PLAN_POSTHOC_REVIEW_SITE_IDS:ports.subject.site,
  FAOLLA_ATTENDANCE_PLAN_CLEARANCE_ENABLED:'1',FAOLLA_ATTENDANCE_PLAN_CLEARANCE_SITE_IDS:ports.subject.site,
  FAOLLA_ATTENDANCE_EVENT_NOTIFICATIONS_CAPTURE_ENABLED:'1',FAOLLA_ATTENDANCE_EVENT_NOTIFICATIONS_CAPTURE_SITES:ports.subject.site,
  FAOLLA_ATTENDANCE_EVENT_NOTIFICATIONS_READ_ENABLED:'1',FAOLLA_ATTENDANCE_EVENT_NOTIFICATIONS_READ_SITES:ports.subject.site};
 const previous=Object.fromEntries(Object.keys(env).map(k=>[k,process.env[k]]));Object.assign(process.env,env);
 const stats=()=>({phase:208,bridgeTransport:'loopback-http',completed,serverGate:state.serverGate,dropPostArmed:state.dropPost,holdGetArmed:state.holdGet,heldResponses:held.size,
  apiRequests:requests.length,posts:requests.filter(x=>x.method==='POST').length,gets:requests.filter(x=>x.method==='GET').length,qaRequests,
  rejectedPosts:requests.filter(x=>x.method==='POST'&&(x.status<200||x.status>=300)).length,
  rejectedPostFactHashChecks:requests.filter(x=>x.rejectedPostFactHashUnchanged===true).length,
  requests:requests.map(x=>({...x})),bridgeRejections:rejections.slice(-20),actualAdminAndSelfParents:true,actualHandlerServiceSql:true,syntheticAuth:true,realLogin:false,
  production:false,newCluster:false,diskBundles:false,browserLaunchedByFixture:false});
 const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin',
  'Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; object-src 'none'; frame-ancestors 'none'"};
 const respond=(res,status,data,type='application/json;charset=utf-8')=>{if(!res.destroyed)res.writeHead(status,{...headers,'Content-Type':type}).end(typeof data==='string'?data:JSON.stringify(data));};
 const release=()=>{for(const resume of held)resume();held.clear();};
 const serve=async(req,res)=>{
  assert(!closing);const text=req.method==='POST'?await readBody(req):null,body=text===null?null:JSON.parse(text);
  const check=validatePosthocBrowserRequest({url:req.url??'/',method:req.method,headers:req.headers,remoteAddress:req.socket.remoteAddress,body},{origin,token,subject:ports.subject,selected:ctx.selected});
  if(check.kind==='asset'){
   if(check.path==='/favicon.ico')return respond(res,204,'');
   if(check.path==='/qa.css')return respond(res,200,files.css,'text/css;charset=utf-8');
   if(check.path==='/qa.js')return respond(res,200,'window.__posthocSeed='+JSON.stringify({...ports.subject,token})+';window.__posthocFrontFlag="0";\n'+files.js,'text/javascript;charset=utf-8');
   return respond(res,200,'<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>208隔离父页验收</title><link rel="stylesheet" href="/qa.css"><div id="qa-root"></div><script type="module" src="/qa.js"></script></html>','text/html;charset=utf-8');
  }
  if(check.kind==='stats')return respond(res,200,stats());
  if(check.kind==='control'){
   assert(++qaRequests<=150,'qa_control_budget');
   if(check.action==='server-gate')state.serverGate=check.value;
   if(check.action==='drop-post')state.dropPost=check.value;
   if(check.action==='hold-get')state.holdGet=check.value;
   if(check.action==='release-get'){state.holdGet=false;release();}
   if(check.action==='finish'){
    assert(!completed);completed=true;closing=true;release();
    res.once('finish',()=>resolveDone());respond(res,200,{...stats(),message:'仅结束本次测试桥；根代理随后核验及清理合成环境。'});return;
   }
   return respond(res,200,stats());
  }
  assert(requests.length<200&&requests.filter(x=>x.method==='POST').length<20,'qa_business_request_budget');
  const work=async()=>{
   ports.owned();const before=ctx.all(),canonical=require('../../src/lib/canonicalPortalRequest.ts').resolveCanonicalPortalOrigin();
   //No network is made to canonical. This in-process Request exercises the
   //actual same-origin guard AFTER this bridge checks loopback CSRF itself.
   const mapped=new Request(canonical+check.path+new URL(req.url,origin).search,{method:req.method,
    headers:{host:new URL(canonical).host,origin:canonical,'sec-fetch-site':'same-origin',...(text?{'content-type':'application/json'}:{})},...(text?{body:text}:{})});
   const reply=await ports.handle(mapped,check.access),output=await reply.text();assert(Buffer.byteLength(output)<=4194304);
   const facts=verifyPosthocBrowserFacts(req.method,reply,before,()=>ctx.all());
   const payload=JSON.parse(output),entry={...posthocBrowserRequestSummary(check,reply,payload),...facts};
   requests.push(entry);
   return {reply,output,entry};
  };
  const task=queue.then(work);queue=task.then(()=>{},()=>{});const {reply,output,entry}=await task;
  if(req.method==='POST'&&reply.ok&&state.dropPost){state.dropPost=false;entry.dropped=true;await truncatePosthocBrowserResponse(res,reply.status,headers,output);return;}
  if(req.method==='GET'&&state.holdGet){state.holdGet=false;entry.held=true;await new Promise(resolve=>{const resume=()=>{held.delete(resume);resolve();};held.add(resume);res.once('close',resume);});}
  if(!res.destroyed)respond(res,reply.status,output);
 };
 try{
  deadline=posthocBrowserDeadline(()=>{closing=true;release();});
  files=await deadline.wait(assets());
  server=createServer((req,res)=>{
   const work=serve(req,res).catch(error=>{const message=String(error?.message??error).slice(0,400);rejections.push({path:String(req.url??'').split('?')[0],message});
    if(!closing)respond(res,403,{ok:false,error:'qa_bridge_rejected',message});});
   inflight.add(work);void work.finally(()=>inflight.delete(work)).catch(()=>{});
  });
  server.requestTimeout=10000;server.headersTimeout=10000;server.keepAliveTimeout=1000;
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const address=server.address();assert(address&&typeof address==='object');origin='http://127.0.0.1:'+address.port;
  console.log(JSON.stringify({event:'plan_posthoc_browser_ready',url:origin,stats:origin+'/__qa/stats',deadlineMs:POSTHOC_BROWSER_DEADLINE_MS,syntheticAuth:true,scope:ctx.d.owned.schema}));
  if(ctx.onBrowserReady)await deadline.wait(ctx.onBrowserReady({url:origin,origin,subject:{...ports.subject},statsUrl:origin+'/__qa/stats',stats:()=>JSON.parse(JSON.stringify(stats())),
    requestFinish:()=>{if(!completed){completed=true;closing=true;release();resolveDone();}}}));
  await deadline.wait(done);await deadline.wait(queue);ports.owned();
  const archived=ctx.archive();assert.equal(archived.artifactText,ctx.oldArchive.artifactText);assert.equal(archived.artifactSha256,ctx.oldArchive.artifactSha256);
  return {...stats(),old155ArchivePreserved:true,externalDriverAssertions:true};
 }catch(error){failure=error;throw error;}
 finally{
  closing=true;deadline?.cancel();release();
  try{await runAttendanceCleanupSteps([
   {name:'posthoc bridge in-flight work',run:()=>Promise.allSettled([...inflight])},
   {name:'posthoc bridge HTTP server',run:()=>{server?.closeAllConnections?.();return server?.listening?new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve())):undefined;}},
   {name:'posthoc bridge esbuild',run:async()=>{const {stop}=await import('esbuild');stop();}},
  ]);}catch(error){if(failure)throw new AggregateError([failure,error],'plan_posthoc_bridge_and_cleanup_failed',{cause:failure});throw error;}
  finally{for(const [key,value]of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
 }
}
