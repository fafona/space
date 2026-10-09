import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer,request as httpRequest} from 'node:http';
import {POSTHOC_BROWSER_APIS as api,POSTHOC_BROWSER_DEADLINE_MS,validatePosthocBrowserRequest,posthocBrowserRequestSummary,verifyPosthocBrowserFacts,truncatePosthocBrowserResponse,posthocBrowserDeadline} from './attendance-plan-posthoc-browser.mjs';

//Import is inert. One transport-only test opens its own ephemeral loopback
//listener; no app assets, actual bridge, browser, esbuild or SQL is started.
const origin='http://127.0.0.1:32123',token='synthetic-test-token';
const subject={site:'12002008',owner:'owner-auth',employee:'employee-id',auth:'employee-auth',worker:'worker-id',slotId:'slot-id'};
const selected=[{kind:'session',startEventId:'start',lastEventId:'end',lastSequence:2,effectOperationId:null,effectRevision:null},
 {kind:'missing',requestId:'request',rootRequestId:'root',approvalOperationId:'approval'}];
const scope={origin,token,subject,selected};
function request(path,query={},command=null,access='owner'){
 const method=command?'POST':'GET';
 return {url:path+(method==='GET'&&Object.keys(query).length?'?'+new URLSearchParams(Object.entries(query).filter(([,v])=>v!==null)):''),method,
  headers:{host:new URL(origin).host,origin,'sec-fetch-site':'same-origin','x-posthoc-qa-token':token,'x-posthoc-qa-access':access,
   ...(command?{'content-type':'application/json'}:{})},remoteAddress:'127.0.0.1',body:command?{query,command}:null};
}
const detail={siteId:subject.site,workerId:subject.worker,slotId:subject.slotId,mode:'detail',operationId:null};
const apply={operationId:'op',action:'apply',employeeId:subject.employee,employeeAuthUserId:subject.auth,sources:selected};
const check=r=>validatePosthocBrowserRequest(r,scope);

test('bridge import is inert and statics require exact loopback origin and host',()=>{
 assert.equal(POSTHOC_BROWSER_DEADLINE_MS,1200000);
 for(const path of ['/','/qa.js','/qa.css','/favicon.ico'])assert.equal(check(request(path)).kind,'asset');
 assert.equal(check(request('/__qa/stats')).kind,'stats');
 for(const change of [{remoteAddress:'10.0.0.1'},{url:'http://evil.test/qa.js'},{url:'/qa.js?token=x'},
  {headers:{host:'evil.test',origin}},{headers:{host:new URL(origin).host,origin:'https://evil.test'}},
  {headers:{host:new URL(origin).host,'sec-fetch-site':'cross-site'}},{headers:{host:new URL(origin).host,'x-forwarded-host':'anything'}}]){
  assert.throws(()=>check({...request('/qa.js'),...change}));
 }
});

test('every business request needs token, one query value and approved API/subject',()=>{
 assert.equal(check(request(api.adoption,detail)).kind,'api');
 for(const mutate of [r=>{r.headers['x-posthoc-qa-token']='wrong';},r=>{r.headers['x-posthoc-qa-access']='manager';},
  r=>{r.url+='&siteId='+subject.site;},r=>{r.url=r.url.replace(subject.site,'99999999');},r=>{r.url=r.url.replace('worker-id','other-worker');},
  r=>{r.url='/api/merchant-enterprise/employees';},r=>{r.method='DELETE';}]){
  const r=request(api.adoption,detail);mutate(r);assert.throws(()=>check(r));
 }
});

test('owner admin and employee self are read-only, evaluation cannot write',()=>{
 assert.equal(check(request(api.admin,{siteId:subject.site})).kind,'api');
 assert.equal(check(request(api.self,{siteId:subject.site},null,'self')).kind,'api');
 assert.equal(check(request(api.evaluation,detail)).kind,'api');
 assert.throws(()=>check(request(api.admin,{siteId:subject.site},{action:'settings_save'})));
 assert.throws(()=>check(request(api.self,{siteId:subject.site},{action:'clock_out'},'self')));
 assert.throws(()=>check(request(api.evaluation,detail,apply)));
 assert.throws(()=>check(request(api.admin,{siteId:subject.site},null,'self')));
 assert.throws(()=>check(request(api.self,{siteId:subject.site})));
});

test('apply permits only the actual selected references and explicit empty apply',()=>{
 assert.equal(check(request(api.adoption,detail,apply)).command,apply);
 assert.equal(check(request(api.adoption,detail,{...apply,sources:[]})).command.sources.length,0);
 assert.equal(check(request(api.adoption,detail,{...apply,sources:[selected[1],selected[0]]})).command.sources[0].kind,'missing');
 for(const sources of [[{...selected[0],lastSequence:3}],[{...selected[1],requestId:'other'}],[selected[0],selected[0]],
  [{...selected[1],forged:true}],Array(11).fill(selected[0])])assert.throws(()=>check(request(api.adoption,detail,{...apply,sources})));
 assert.throws(()=>check(request(api.adoption,detail,{...apply,employeeAuthUserId:'wrong'})));
 const {sources:_sources,...revoke}=apply;void _sources;
 assert.equal(check(request(api.adoption,detail,{...revoke,action:'revoke'})).command.action,'revoke');
 assert.throws(()=>check(request(api.adoption,detail,apply,'self')));
});

test('POST requires same-origin JSON and no search, recovery stays GET-only',()=>{
 for(const mutate of [r=>{delete r.headers.origin;},r=>{r.headers['content-type']='text/plain';},r=>{r.url+='?unused=1';}]){
  const r=request(api.adoption,detail,apply);mutate(r);assert.throws(()=>check(r));
 }
 const recovered=check(request(api.adoption,{...detail,mode:'recover',operationId:'old-op'}));
 assert.equal(recovered.command,null);assert.equal(recovered.query.operationId,'old-op');
});

test('exception writes limited to owner decide or current employee note/ack',()=>{
 const owner={...detail,access:'owner',mode:'decide'},self={...detail,access:'self',mode:'note'};
 assert.equal(check(request(api.exception,owner,{employeeId:subject.employee,employeeAuthUserId:subject.auth,outcome:'confirmed'})).query.mode,'decide');
 for(const mode of ['note','ack'])assert.equal(check(request(api.exception,{...self,mode},{operationId:'self-op'},'self')).query.mode,mode);
 assert.throws(()=>check(request(api.exception,{...owner,mode:'ack'},{operationId:'op'})));
 assert.throws(()=>check(request(api.exception,{...owner,access:'self'},{operationId:'op'},'self')));
 assert.throws(()=>check(request(api.exception,{...self,workerId:'other'},{operationId:'op'},'self')));
 assert.throws(()=>check(request(api.exception,owner)));
});

test('notification guard retains real self query binding and only mark_read',()=>{
 const q={siteId:subject.site,expectedEmployeeId:subject.employee,expectedWorkerId:subject.worker,notificationId:'message'};
 assert.equal(check(request(api.notification,q,null,'self')).kind,'api');
 assert.equal(check(request(api.notification,q,{action:'mark_read',notificationId:'message'},'self')).command.action,'mark_read');
 assert.throws(()=>check(request(api.notification,q,null,'owner')));
 assert.throws(()=>check(request(api.notification,{...q,expectedEmployeeId:'other'},null,'self')));
 assert.throws(()=>check(request(api.notification,q,{action:'ack',notificationId:'message'},'self')));
 assert.throws(()=>check(request(api.notification,q,{action:'mark_read',notificationId:'message',command:'sql'},'self')));
});

test('QA controls are explicit narrow JSON, never arbitrary SQL or fetch',()=>{
 const r=request('/__qa/control',{},{});r.body={action:'hold-get',value:true};
 assert.deepEqual(check(r),{kind:'control',action:'hold-get',value:true});
 for(const body of [{action:'execute',value:true},{action:'hold-get',value:'true'},{action:'hold-get',value:true,sql:'select 1'}])assert.throws(()=>check({...r,body}));
 assert.throws(()=>check({...r,method:'GET'}));
});

test('statistics expose operation metadata, not reason, pending or full evidence',()=>{
 const r=check(request(api.exception,{...detail,access:'owner',mode:'decide'},{operationId:'op',employeeId:subject.employee,employeeAuthUserId:subject.auth,outcome:'confirmed',reason:'private reason'}));
 const result=posthocBrowserRequestSummary(r,{status:200},{ok:true,data:{receipt:{operationId:'op',command:r.command,item:{outcome:'confirmed',revision:9,evidence:{source:'private source'}}},detail:{revision:9,latestDecision:{outcome:'confirmed'}}}});
 assert.equal(result.operationId,'op');assert.equal(result.receiptOutcome,'confirmed');assert.equal(result.receiptRevision,9);assert.equal(result.outcome,'confirmed');
 assert(!JSON.stringify(result).includes('private'));assert(!Object.hasOwn(result,'command'));assert(!Object.hasOwn(result,'reason'));
 assert.equal(posthocBrowserRequestSummary(check(request(api.adoption,detail)),{status:200},{ok:true,canWrite:false,data:{revision:3}}).canWrite,false);
});

test('409 rejected apply/revoke/decide get a fact-stability statistic only after whole-facts equality',()=>{
 const cases=[request(api.adoption,detail,apply),request(api.adoption,detail,{...apply,action:'revoke'}),
  request(api.exception,{...detail,access:'owner',mode:'decide'},{operationId:'decision-op',employeeId:subject.employee,employeeAuthUserId:subject.auth,outcome:'confirmed'})];
 for(const candidate of cases){
  const parsed=check(candidate),reply=new Response(JSON.stringify({ok:false,error:'attendance_period_sealed'}),{status:409});
  let reads=0;
  const entry={...posthocBrowserRequestSummary(parsed,reply,{ok:false,error:'attendance_period_sealed'}),
   ...verifyPosthocBrowserFacts('POST',reply,'whole-owned-facts',()=>{reads++;return 'whole-owned-facts';})};
  assert.equal(reads,1);assert.equal(entry.status,409);assert.equal(entry.method,'POST');
  assert.equal(entry.rejectedPostFactHashUnchanged,true);assert.equal(entry.getFactHashUnchanged,false);
  assert.equal(entry.error,'attendance_period_sealed');assert.equal(entry.receiptOperationId,null);
  assert(!Object.hasOwn(entry,'before'));assert(!Object.hasOwn(entry,'after'));
 }
});

test('failed POST mutation aborts the proof, while successful POST can change facts',()=>{
 for(const status of [400,403,404,409,422,503]){
  const reply=new Response(null,{status});
  assert.throws(()=>verifyPosthocBrowserFacts('POST',reply,'before',()=> 'changed'),/qa_rejected_post_wrote/);
  assert.equal(verifyPosthocBrowserFacts('POST',reply,'before',()=> 'before').rejectedPostFactHashUnchanged,true);
 }
 for(const status of [200,201,204]){
  assert.deepEqual(verifyPosthocBrowserFacts('POST',new Response(null,{status}),'before',()=>assert.fail('successful POST must not assert unchanged')),
   {getFactHashUnchanged:false,rejectedPostFactHashUnchanged:false});
 }
});

test('all GET responses retain the old no-write assertion, including rejected reads',()=>{
 for(const status of [200,409,503]){
  const reply=new Response(null,{status});
  assert.deepEqual(verifyPosthocBrowserFacts('GET',reply,'same',()=> 'same'),{getFactHashUnchanged:true,rejectedPostFactHashUnchanged:false});
  assert.throws(()=>verifyPosthocBrowserFacts('GET',reply,'before',()=> 'changed'),/qa_get_wrote/);
 }
});

test('bridge and real-parent entry have bounded in-memory lifecycle without a browser launch',async()=>{
 const source=await readFile(new URL('./attendance-plan-posthoc-browser.mjs',import.meta.url),'utf8');
 const entry=await readFile(new URL('./attendance-plan-posthoc-browser.tsx',import.meta.url),'utf8');
 assert.match(source,/write:false/);assert.match(source,/server\.listen\(0,'127\.0\.0\.1'/);
 assert.match(source,/requestFinish:/);assert.match(source,/await deadline\.wait\(ctx\.onBrowserReady/);
 assert.match(source,/await deadline\.wait\(done\)/);assert.match(source,/deadline\?\.cancel\(\)/);
 assert.match(source,/const before=ctx\.all\(\)/);
 assert.match(source,/verifyPosthocBrowserFacts\(req\.method,reply,before,\(\)=>ctx\.all\(\)\)/);
 const verifyAt=source.indexOf('const facts=verifyPosthocBrowserFacts('),pushAt=source.indexOf('requests.push(entry)',verifyAt),queueAt=source.indexOf('const task=queue.then(work)'),dropAt=source.indexOf("if(req.method==='POST'&&reply.ok&&state.dropPost)");
 assert(verifyAt>source.indexOf('const work=async()=>')&&verifyAt<pushAt&&pushAt<queueAt&&queueAt<dropAt,'proof stays inside serialized work, before record/fault injection');
 assert.match(source,/rejectedPostFactHashChecks:requests\.filter\(x=>x\.rejectedPostFactHashUnchanged===true\)\.length/);
 assert.match(source,/runAttendanceCleanupSteps\(\[\s*\{name:/);
 assert.match(source,/AggregateError\(\[failure,error\]/);assert.match(source,/Object\.entries\(previous\)/);
 assert.match(source,/bridgeTransport:'loopback-http'/);assert.match(source,/externalDriverAssertions:true/);
 assert.doesNotMatch(source,/manualCua:true|manualAssertionsByRoot:true|from ['"]playwright|chromium\.launch|writeFile|mkdir|Start-Process/);
 assert.match(entry,/import AdminPanel from/);assert.match(entry,/import SelfPanel from/);
 for(const id of ['owner-parent','self-parent','flags-on','flags-off','exception-off','drop-post','hold-get','release-get','hide','show','remount','width390'])assert(entry.includes(`data-testid="${id}"`),id);
 assert.match(entry,/不是实际登录、用户浏览器或手机认证验收/);assert.match(entry,/非实际换绑或授权验证/);
 assert.doesNotMatch(entry,/setInterval|\.click\(\)|\.submit\(\)|\.evaluate\(/);
});

test('truncated response sends status and partial body before disconnect, never a complete receipt',async()=>{
 const output=JSON.stringify({ok:true,receipt:{operationId:'synthetic-only',text:'核对结果'}});let calls=0,serverFailure;
 const server=createServer((req,res)=>{calls++;req.resume();void truncatePosthocBrowserResponse(res,200,{'Cache-Control':'no-store'},output).catch(error=>{serverFailure=error;res.destroy();});});
 try{
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const address=server.address();assert(address&&typeof address==='object');
  const seen=await new Promise((resolve,reject)=>{
   const req=httpRequest({host:'127.0.0.1',port:address.port,path:'/',method:'POST',agent:false,headers:{'Content-Length':'2','Content-Type':'application/json'}},res=>{
    const chunks=[];let aborted=false;res.on('data',chunk=>chunks.push(chunk));res.on('aborted',()=>{aborted=true;});res.on('error',()=>{});
    res.on('close',()=>resolve({status:res.statusCode,length:res.headers['content-length'],bytes:Buffer.concat(chunks),aborted,complete:res.complete}));
   });req.setTimeout(2000,()=>req.destroy(Error('transport_test_timeout')));req.on('error',reject);req.end('{}');
  });
  assert.equal(serverFailure,undefined);assert.equal(calls,1);assert.equal(seen.status,200);assert.equal(seen.length,String(Buffer.byteLength(output)));
  assert.deepEqual(seen.bytes,Buffer.from(output).subarray(0,8));assert.equal(seen.aborted,true);assert.equal(seen.complete,false);
  assert.throws(()=>JSON.parse(seen.bytes.toString('utf8')));
 }finally{server.closeAllConnections();await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
});

test('independent expiry interrupts a suspended callback, while ordinary finish does not',async()=>{
 let expired=false;const deadline=posthocBrowserDeadline(()=>{expired=true;},10);
 try{await assert.rejects(deadline.wait(new Promise(()=>{})),/20_minute_deadline/);assert.equal(expired,true);}finally{deadline.cancel();}
 let callbackDone,finish,settled=false;
 const done=new Promise(resolve=>{finish=resolve;}),callback=new Promise(resolve=>{callbackDone=resolve;});
 const bounded=posthocBrowserDeadline(()=>assert.fail('unexpected expiry'),1000);
 try{
  const running=(async()=>{await bounded.wait(callback);await bounded.wait(done);settled=true;})();
  finish();await new Promise(resolve=>setImmediate(resolve));assert.equal(settled,false);
  callbackDone();await running;assert.equal(settled,true);
 }finally{bounded.cancel();}
});
