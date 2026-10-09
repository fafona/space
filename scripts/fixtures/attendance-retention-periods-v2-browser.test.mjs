// Pure protocol/static tests. These do not launch a server or browser.
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {createRetentionPeriodsBrowserModel,retentionPeriodsBrowserLimits} from './attendance-retention-periods-v2-browser.mjs';
const require=createRequire(import.meta.url),p=require('../../src/lib/merchantAttendancePeriodClosureV2.ts'),r=require('../../src/lib/merchantAttendanceRetention.ts');
const source=readFileSync(new URL('./attendance-retention-periods-v2-browser.mjs',import.meta.url),'utf8');
const entry=readFileSync(new URL('./attendance-retention-periods-v2-browser-entry.tsx',import.meta.url),'utf8');
const url=(endpoint,q)=>'http://127.0.0.1:12345'+endpoint+'?'+new URLSearchParams(Object.entries(q).filter(([,v])=>v!==null).map(([k,v])=>[k,typeof v==='object'?JSON.stringify(v):String(v)]));
const query=m=>({siteId:m.seed.siteId,access:'owner',workerId:m.seed.workerId,fromDate:m.seed.fromDate,throughDate:m.seed.throughDate,mode:'list',periodId:null,operationId:null,version:null,cursor:null});
const call=(m,q)=>m.respond(url(m.seed.endpoints[1],q),'GET',m.seed.actorId);
test('module import is inert and resource ceilings are frozen',()=>{
 assert.deepEqual(retentionPeriodsBrowserLimits,{ttlMs:180000,http:100,api:40});assert(Object.isFrozen(retentionPeriodsBrowserLimits));
 assert(source.includes("process.argv.length===3&&process.argv[2]==='--run-local'"));
 assert.doesNotMatch(source,/execFile|spawn\(|pg_ctl|initdb|\.screenshot\(|writeFile|mkdir|CREATE DATABASE/i);
});
test('strict actual admin directory response is the only source of the selected worker',()=>{
 const m=createRetentionPeriodsBrowserModel(),result=m.respond(url(m.seed.endpoints[0],{siteId:m.seed.siteId,view:'workers',search:''}),'GET',m.seed.actorId);
 assert.equal(result.body.items.length,1);assert.equal(result.body.items[0].id,m.seed.workerId);assert.equal(result.body.items[0].employeeId,m.target.employeeId);
 assert.throws(()=>m.respond(url(m.seed.endpoints[0],{siteId:m.seed.siteId,view:'workers',search:'not-whitelisted'}),'GET',m.seed.actorId));
});
test('26 non-overlapping periods page25+1 with exact observed cursor and high numeric heads',()=>{
 const m=createRetentionPeriodsBrowserModel(),q=query(m),first=call(m,q).body.data;
 assert.equal(first.items.length,25);assert(first.items.every(x=>x.revision===101&&x.currentVersion===21));
 const second=call(m,{...q,cursor:first.nextCursor}).body.data;assert.equal(second.items.length,1);assert.equal(second.nextCursor,null);
 assert.equal(new Set([...first.items,...second.items].map(x=>x.periodId)).size,26);
 const byDate=[...m.periods].sort((a,b)=>a.startAt.localeCompare(b.startAt));
 for(let n=1;n<byDate.length;n++)assert(byDate[n-1].endAt<=byDate[n].startAt);
});
test('versions requests must use saved complete dates instead of the intersecting search window',()=>{
 const m=createRetentionPeriodsBrowserModel(),q={...query(m),mode:'versions',periodId:m.target.periodId,fromDate:m.target.fromDate,throughDate:m.target.throughDate};
 assert.notEqual(q.fromDate,m.seed.fromDate);assert.notEqual(q.throughDate,m.seed.throughDate);
 assert.equal(call(m,q).body.data.items.length,20);
 assert.throws(()=>call(m,{...q,fromDate:m.seed.fromDate,throughDate:m.seed.throughDate}));
});
test('21 versions page20+1 and repeated immutable artifact remains valid without body loading',()=>{
 const m=createRetentionPeriodsBrowserModel(),q={...query(m),mode:'versions',periodId:m.target.periodId,fromDate:m.target.fromDate,throughDate:m.target.throughDate};
 const first=call(m,q).body.data,second=call(m,{...q,cursor:first.nextCursor}).body.data,items=[...first.items,...second.items];
 assert.deepEqual(items.map(x=>x.version),Array.from({length:21},(_,i)=>21-i));assert.equal(second.nextCursor,null);
 assert.equal(new Set(items.map(x=>x.artifactId)).size,1);assert.equal(new Set(items.map(x=>x.operationId)).size,21);
 for(const item of items)assert.deepEqual(Object.keys(item).sort(),['version','operationId','recordedAt','artifactId','sourceFingerprint','artifactBytes','artifactSha256'].sort());
});
test('bad cursors and foreign identities or source endpoints never produce a valid fixture response',()=>{
 const m=createRetentionPeriodsBrowserModel(),q=query(m),first=call(m,q).body.data;
 for(const patch of [{workerId:m.seed.otherActorId},{access:'self'},{mode:'detail',periodId:m.target.periodId},
  {cursor:{...first.nextCursor,beforePeriodId:m.target.periodId}},{cursor:{...first.nextCursor,fromDate:'2026-09-03'}}])assert.throws(()=>call(m,{...q,...patch}));
 assert.throws(()=>m.respond(url(m.seed.endpoints[1],q),'GET',m.seed.otherActorId));
 assert.throws(()=>m.respond(url('/api/merchant-enterprise/attendance/period-closures',q),'GET',m.seed.actorId));
});
test('original retention record GET uses artifact id, not period/version and not whole-period preview',()=>{
 const m=createRetentionPeriodsBrowserModel(),q={siteId:m.seed.siteId,mode:'record',category:'period_artifact',recordId:m.record.recordId};
 const body=m.respond(url(m.seed.endpoints[2],q),'GET',m.seed.actorId).body;
 assert.equal(r.parseRetentionResponse(body,q,m.seed.actorId).result.data.item.source.periodId,m.target.periodId);
 assert.equal(body.data.data.item.source.sourceFingerprint,m.versions[0].sourceFingerprint);
 assert.equal(body.data.data.item.source.artifactSha256,m.versions[0].artifactSha256);
 assert.throws(()=>m.respond(url(m.seed.endpoints[2],{...q,recordId:m.target.periodId}),'GET',m.seed.actorId));
 assert.throws(()=>m.respond(url(m.seed.endpoints[2],{siteId:m.seed.siteId,mode:'preview',category:'period_artifact',workerId:m.seed.workerId,periodId:m.target.periodId}),'GET',m.seed.actorId));
});
test('synthetic pending slot is strict original-client format but is explicitly never posted',()=>{
 const m=createRetentionPeriodsBrowserModel(),pending=JSON.parse(m.pendingRaw);
 assert.deepEqual(Object.keys(pending).sort(),['version','actorId','query','command'].sort());assert.equal(pending.actorId,m.seed.actorId);assert.equal(pending.version,1);
 assert.deepEqual(pending.query,r.retentionWriteQuery(r.parseRetentionCommand(pending.command)));assert.equal(pending.command.action,'hold');
 for(const endpoint of m.seed.endpoints)assert.throws(()=>m.respond(url(endpoint,query(m)),'POST',m.seed.actorId,'{}'),/qa_zero_post/);
});
test('high v2 metadata cannot silently fall back to old v1 or become a period body export',()=>{
 const m=createRetentionPeriodsBrowserModel(),q=query(m),value=call(m,q).body.data;
 assert.equal(p.parsePeriodClosureV2Response({ok:true,moduleEnabled:true,data:value},q,{ownerId:m.seed.actorId}).data.items[0].revision,101);
 assert(source.includes("assert.equal(q.mode,'versions','qa_only_metadata')"));assert(!source.includes('periodClosureUiArtifact('));
 assert(source.includes("assert(!requests.some(x=>x.query.mode==='preview'||x.query.mode==='detail'||x.query.mode==='history'||x.query.mode==='export'))"));
});
test('browser mounts actual RetentionPanel with strict stream transport, not mocked component state',()=>{
 assert(entry.includes('import Panel from "../../src/components/enterprise/MerchantAttendanceRetentionPanel"'));
 assert(entry.includes('<Panel key={actorId}'));assert(entry.includes('periodsV2Enabled={config.enabled}'));
 assert(entry.includes('new ReadableStream<Uint8Array>'));assert(entry.includes('controller.enqueue(bytes.slice(0, 1))'));
 assert(entry.includes('[actorId, config.apiEpoch]'));assert(entry.includes('document.dispatchEvent(new Event("visibilitychange"))'));
 assert.doesNotMatch(entry,/getSnapshot|setSnapshot|prototype|mockImplementation|data-period-id|data-version/);
});
test('runner checks actual DOM pages, saved-range handoff, dirty/pending gates and all three late-body leases',()=>{
 for(const text of ["'periods25plus1'","'high_head_saved_range_versions'","'select_actual_retention_record'","'repeated_artifact_explicit_handoff'",
  "'dirty_blocks_picker'","'pending_blocks_picker'","'hidden_late_body'","'api_instance_late_body'","'auth_late_body'",'qa_versions_mobile_overflow',"'qa_final_mobile_overflow'"])
  assert(source.includes(text),text);
 assert(source.includes('assert.equal(requests.length,before'));assert(source.includes('assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),model.pendingKey),model.pendingRaw)'));
 assert(source.includes("getByRole('combobox',{name:/^资料类别/})"));assert(source.includes("getByRole('combobox',{name:/^选择人员/})"));
 assert(source.includes("dialog.type()==='beforeunload'?dialog.accept():dialog.dismiss()"));
});
test('owned resource cleanup is complete even on failure, with late browser-launch cleanup and no persistent bundle',()=>{
 for(const text of ["server.listen(0,'127.0.0.1'",'write:false','if(closing)return value.close()',"serviceWorkers:'block',acceptDownloads:false",
  'finally{closing=true;clearTimeout(timer)','window.__retentionPeriodsHarness?.release()','context.close()','browser.close()',
  'Promise.allSettled([...inflight])','server?.closeAllConnections()','server.close(error=>','esbuild','!browser?.isConnected()&&!server?.listening'])assert(source.includes(text),text);
 assert(source.includes("url.origin!==origin||req.method()!=='GET'"));assert(source.includes('requests.length<retentionPeriodsBrowserLimits.api'));
});
