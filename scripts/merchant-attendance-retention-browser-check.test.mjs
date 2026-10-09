import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {retentionBrowserAllowedRequest,retentionBrowserHeaders,retentionBrowserLimits,startRetentionBrowserServer} from './merchant-attendance-retention-browser-check.mjs';
import {retentionAcceptanceArguments,retentionAcceptanceDeliveryHeaders,retentionAcceptanceGroups,retentionAcceptanceLimits} from './merchant-attendance-retention-acceptance.mjs';
const require=createRequire(import.meta.url);
const {createRetentionBrowserModel,retentionBrowserSeed:seed}=require('./fixtures/attendance-retention-browser-model.ts');
const {RETENTION_API,retentionWriteQuery,retentionQueryString,parseRetentionResponse}=require('../src/lib/merchantAttendanceRetention.ts');
const {readRetentionWorkers,readRetentionPeriods}=require('../src/lib/merchantAttendanceRetentionDirectory.ts');
const origin='http://127.0.0.1:54321',q={siteId:seed.siteId,mode:'policies'};
const read=(m,query=q,enabled=true,actor=seed.owner)=>m.respond({url:origin+RETENTION_API+'?'+retentionQueryString(query),method:'GET',actor,enabled});
const write=(m,c,enabled=true)=>m.respond({url:origin+RETENTION_API,method:'POST',actor:seed.owner,enabled,body:JSON.stringify({query:retentionWriteQuery(c),command:c})});
const policy=()=>({siteId:seed.siteId,operationId:randomUUID(),action:'set_policy',category:'events',expectedRevision:0,retentionDays:90,reason:'合成期限，不删除'});

test('only exact loopback assets, three named read endpoints and retention POST are allowed',()=>{
  for(const suffix of ['/','/qa.js','/qa.css','/favicon.ico',RETENTION_API+'?mode=policies','/api/merchant-enterprise/attendance/admin?view=workers','/api/merchant-enterprise/attendance/period-closures?mode=list'])
    assert(retentionBrowserAllowedRequest(origin+suffix,'GET',origin));
  assert(retentionBrowserAllowedRequest(origin+RETENTION_API,'POST',origin));
  for(const [url,method] of [['https://example.com/','GET'],['http://user@127.0.0.1:54321/','GET'],[origin+'/qa.js?query=1','GET'],[origin+RETENTION_API+'?query=1','POST'],
    [origin+'/api/merchant-enterprise/attendance/admin','POST'],[origin+'/api/merchant-enterprise/attendance/period-closures','POST'],[origin+'/api/publish','GET'],[origin+RETENTION_API,'DELETE']])
    assert.equal(retentionBrowserAllowedRequest(url,method,origin),false,url);
  for(const base of ['http://localhost:54321','http://0.0.0.0:54321','http://127.0.0.1','https://127.0.0.1:54321',origin+'/'])assert.equal(retentionBrowserAllowedRequest(base+'/qa.js','GET',base),false);
});

test('synthetic policy and record mutations are strictly parsed, immutable-source metadata only',()=>{
  const model=createRetentionBrowserModel(),c=policy(),initial=model.snapshot();
  assert(read(model).body.data.data.items.every(p=>p.retentionDays===null));
  const p=write(model,c);assert.equal(p.status,200);parseRetentionResponse(p.body,q,seed.owner,c);
  const recordQuery={siteId:seed.siteId,mode:'record',category:'events',recordId:seed.recordId},record=read(model,recordQuery).body.data.data.item;
  const hold={siteId:seed.siteId,operationId:randomUUID(),action:'hold',category:'events',recordId:seed.recordId,expectedRevision:0,expectedSourceFingerprint:record.sourceFingerprint,reason:'合成保全'};
  assert.equal(write(model,hold).status,200);assert.equal(read(model,recordQuery).body.data.data.item.preservation.held,true);
  const release={...hold,operationId:randomUUID(),action:'release',expectedRevision:1,reason:'合成解除但不删除'};assert.equal(write(model,release).status,200);
  assert.equal(model.snapshot().successfulWrites,3);assert.deepEqual(model.snapshot().records.map(r=>r.source),initial.records.map(r=>r.source));
  assert.deepEqual(model.snapshot().records.map(r=>r.sourceFingerprint),initial.records.map(r=>r.sourceFingerprint));
  assert.equal(model.snapshot().records[0].preservation.held,false);
});

test('lost response recovery has an existing receipt and flag-off replay cannot append',()=>{
  const model=createRetentionBrowserModel(),command=policy(),saved=write(model,command);assert.equal(saved.status,200);
  const recovered=read(model,{siteId:seed.siteId,mode:'recover',operationId:command.operationId},false);assert.deepEqual(recovered.body.data.receipt,saved.body.data.receipt);
  assert.equal(recovered.body.canWrite,false);assert.deepEqual(write(model,command,false).body.data.receipt,saved.body.data.receipt);
  assert.equal(write(model,{...command,reason:'changed'},false).status,409);assert.equal(model.snapshot().successfulWrites,1);
  assert.equal(write(model,{...command,operationId:randomUUID(),expectedRevision:1,retentionDays:120},false).status,403);
  const absent=read(model,{siteId:seed.siteId,mode:'recover',operationId:randomUUID()},false);assert.equal(absent.status,200);assert.equal(absent.body.data.receipt,null);
});

test('foreign actor/site, stale CAS/fingerprint and malformed envelopes cannot mutate',()=>{
  const model=createRetentionBrowserModel(),c=policy();assert.equal(read(model,q,true,seed.other).status,403);
  assert.equal(write(model,{...c,siteId:'99999999'}).status,403);assert.equal(write(model,{...c,expectedRevision:2}).status,409);
  const hold={siteId:seed.siteId,operationId:randomUUID(),action:'hold',category:'events',recordId:seed.recordId,expectedRevision:0,expectedSourceFingerprint:'f'.repeat(64),reason:'wrong source'};
  assert.equal(write(model,hold).status,409);
  assert.equal(model.respond({url:origin+RETENTION_API,method:'POST',actor:seed.owner,enabled:true,body:JSON.stringify({query:q,command:c,extra:true})}).status,400);
  assert.equal(model.snapshot().successfulWrites,0);
});

test('hard limits and inert entry points validate without opening a listener or browser',async()=>{
  assert.deepEqual(retentionBrowserLimits,{ttlMs:300000,requestLimit:80,postLimit:6});
  assert.deepEqual([retentionAcceptanceLimits.deadlineMs,retentionAcceptanceLimits.requestLimit,retentionAcceptanceLimits.postLimit],[300000,80,6]);
  for(const opts of [{ttlMs:0},{ttlMs:300001},{requestLimit:81},{postLimit:7}])await assert.rejects(startRetentionBrowserServer(opts));
  assert.deepEqual(retentionAcceptanceArguments([]),{run:false});assert.deepEqual(retentionAcceptanceArguments(['--run-local']),{run:true});
  for(const args of [['--production'],['--run-local','--run-local'],['--url=https://example.com']])assert.throws(()=>retentionAcceptanceArguments(args));
  assert.equal(retentionAcceptanceGroups.length,7);
});

test('source guards enforce actual components, memory bundles, no DB, strict cleanup and honest reporting',()=>{
  const server=readFileSync(new URL('./merchant-attendance-retention-browser-check.mjs',import.meta.url),'utf8');
  const acceptance=readFileSync(new URL('./merchant-attendance-retention-acceptance.mjs',import.meta.url),'utf8');
  const fixture=readFileSync(new URL('./fixtures/attendance-retention-browser.tsx',import.meta.url),'utf8');
  const model=readFileSync(new URL('./fixtures/attendance-retention-browser-model.ts',import.meta.url),'utf8');
  assert(server.includes('write:false'));assert(server.includes("server.listen(0,'127.0.0.1'"));assert(server.includes('server.closeAllConnections()'));
  for(const forbidden of [/writeFile/,/execFile/,/spawn\(/,/initdb/,/pg_ctl/])assert.doesNotMatch(server+acceptance,forbidden);
  assert(fixture.includes('import RetentionLauncher'));assert(fixture.includes('<RetentionLauncher'));assert(fixture.includes('<StrictMode>'));
  assert(fixture.includes('enabled: false'));assert(fixture.includes('credentials: "omit"'));assert.doesNotMatch(fixture,/sessionStorage\.setItem|localStorage/);
  assert.doesNotMatch(model,/\.server|Supabase|\.rpc\(/);assert(model.includes('parseRetentionResponse'));
  for(const phrase of ['realSql:false','realAuth:false','production:false','pickerProof','document visibility event is synthetic'])assert(acceptance.includes(phrase));
  for(const key of ["default-src 'self'","connect-src 'self'","form-action 'none'"])assert(retentionBrowserHeaders['Content-Security-Policy'].includes(key));
  assert.equal(retentionBrowserHeaders['Cache-Control'],'no-store');
});

test('intercepted delivery removes transport length but preserves safe content-type',()=>{
  assert.deepEqual(retentionAcceptanceDeliveryHeaders({'content-length':'999','transfer-encoding':'chunked','content-encoding':'gzip','content-type':'application/json'}),{'content-type':'application/json'});
});

test('real directory helper accepts active/inactive workers and exact historical period with only GETs',async()=>{
  const model=createRetentionBrowserModel(),calls=[],signal=new AbortController().signal;
  const apiFetch=async(path,init)=>{calls.push({path,init});const outcome=model.respond({url:origin+path,method:init.method,actor:seed.owner,enabled:false});
    return new Response(JSON.stringify(outcome.body),{status:outcome.status,headers:{'content-type':'application/json'}});};
  const workers=await readRetentionWorkers(apiFetch,seed.siteId,signal,'合成');
  assert.equal(workers.items.length,2);assert.deepEqual(workers.items.map(w=>w.active),[false,true]);assert.equal(workers.nextCursor,null);
  const periods=await readRetentionPeriods(apiFetch,seed.siteId,seed.owner,seed.workerId,seed.fromDate,seed.throughDate,signal);
  assert.equal(periods.length,1);assert.equal(periods[0].periodId,seed.periodId);assert.equal(periods[0].sealed,true);
  const notExact=await readRetentionPeriods(apiFetch,seed.siteId,seed.owner,seed.workerId,'2026-10-06',seed.throughDate,signal);assert.deepEqual(notExact,[]);
  assert(calls.every(c=>c.init.method==='GET'&&c.init.body===undefined));assert.equal(model.snapshot().successfulWrites,0);
});

test('strict previews select inactive historical worker, UTC bounds, and archive rather than period identifier',()=>{
  const model=createRetentionBrowserModel();
  for(const category of ['events','location_results']){
    const query={siteId:seed.siteId,mode:'preview',category,workerId:seed.workerId,fromAt:'2026-10-07T00:00:00.000000Z',toAt:'2026-10-08T00:00:00.000000Z'};
    const preview=read(model,query);assert.equal(preview.status,200);parseRetentionResponse(preview.body,query,seed.owner);
    assert.equal(preview.body.data.data.items.length,1);assert.equal(preview.body.data.data.items[0].category,category);
    assert.equal(read(model,{...query,workerId:seed.activeWorkerId}).body.data.data.items.length,0);
    assert.equal(read(model,{...query,toAt:seed.at}).body.data.data.items.length,0);
  }
  const query={siteId:seed.siteId,mode:'preview',category:'period_artifact',workerId:seed.workerId,periodId:seed.periodId};
  const preview=read(model,query);assert.equal(preview.status,200);parseRetentionResponse(preview.body,query,seed.owner);
  const item=preview.body.data.data.items[0];assert.equal(item.recordId,seed.artifactId);assert.equal(item.source.periodId,seed.periodId);assert.notEqual(item.recordId,item.source.periodId);
  assert.equal(read(model,{...query,periodId:randomUUID()}).body.data.data.items.length,0);assert.equal(model.snapshot().successfulWrites,0);
});
