import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {createPeriodRecoveryBrowserModel,periodRecoveryBrowserLimits} from './attendance-period-recovery-browser.mjs';
const require=createRequire(import.meta.url),aggregate=require('../../src/lib/merchantAttendanceRecovery.ts');
const g=require('../../src/lib/merchantAttendancePeriodDelegation.ts'),p=require('../../src/lib/merchantAttendancePeriodDelegatedClosure.ts'),a=require('../../src/lib/merchantAttendanceAccountSuspension.ts');
function store(entries){const values=new Map(entries.map(e=>[e.key,e.raw]));return{values,get length(){return values.size;},key:n=>[...values.keys()][n]??null,
 getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};}
const current=()=>true;
function urls(m){return[g.PERIOD_DELEGATION_API+'?'+g.periodDelegationQueryString(m.recovered.grant),p.PERIOD_DELEGATED_CLOSURE_API+'?'+p.periodDelegatedClosureQueryString(m.recovered.closure),a.ACCOUNT_SUSPENSION_API+'?'+a.accountSuspensionQueryString(m.recovered.status)];}

test('strict synthetic originals are accepted by the real aggregate without exposing draft data',async()=>{
 const m=await createPeriodRecoveryBrowserModel(),s=store(m.entries),before=[...s.values];
 const r=await aggregate.listKnownAttendanceRecoveries(s,m.seed.authUserId,current);
 assert.equal(r.invalid,false);assert.deepEqual(r.entries.map(e=>e.kind).sort(),['account-status','period-closure','period-delegation']);
 assert.doesNotMatch(JSON.stringify(r),/Private synthetic|workerId|targetAuthUserId/);assert.deepEqual([...s.values],before);
 assert.equal((await aggregate.listKnownAttendanceRecoveries(s,m.seed.otherAuthUserId,current)).entries.length,0);
});
test('all three actual recovery clients accept only GET minimal receipts with flags off',async()=>{
 const m=await createPeriodRecoveryBrowserModel(),s=store(m.entries);let gets=0;
 for(const entry of (await aggregate.listKnownAttendanceRecoveries(s,m.seed.authUserId,current)).entries){
  const r=await aggregate.recoverKnownAttendance(entry,{authenticatedUserId:m.seed.authUserId,storage:s,isCurrentAuth:current,signal:new AbortController().signal,
   apiFetch:async(path,init)=>{gets++;assert.equal(init.method,'GET');assert.equal(init.body,undefined);const v=m.respond('http://127.0.0.1'+path,init.method,m.seed.authUserId);
    assert.equal(v.query.operationId,entry.operationId);return new Response(v.text,{headers:{'content-type':'application/json'}});}});
  assert.equal(r.kind,entry.kind);assert.equal(s.getItem(entry.storageKey),null);assert.doesNotMatch(JSON.stringify(r),/Private synthetic|commandFingerprint|targetAuthUserId/);
 }assert.equal(gets,3);assert.equal(s.length,0);
});
test('Node model rejects fresh queries, extra authority, wrong Auth, unknown routes and every write',async()=>{
 const m=await createPeriodRecoveryBrowserModel();for(const url of urls(m)){
  const absolute='http://127.0.0.1'+url;
  assert.throws(()=>m.respond(absolute,'POST',m.seed.authUserId),/get_only/);
  assert.throws(()=>m.respond(absolute,'GET',m.seed.otherAuthUserId),/synthetic_auth/);
  assert.throws(()=>m.respond(absolute+'&ownerId='+m.seed.authUserId,'GET',m.seed.authUserId));
  assert.throws(()=>m.respond(absolute.replace('mode=recover','mode=detail'),'GET',m.seed.authUserId));
 }assert.throws(()=>m.respond('http://127.0.0.1/api/unknown','GET',m.seed.authUserId));
});
test('null and malformed transport faults preserve both period pending formats through real clients',async()=>{
 for(const kind of ['period-delegation','period-closure'])for(const fault of ['null','malformed']){
  const m=await createPeriodRecoveryBrowserModel(),s=store(m.entries),entry=(await aggregate.listKnownAttendanceRecoveries(s,m.seed.authUserId,current)).entries.find(e=>e.kind===kind),before=s.getItem(entry.storageKey);
  const r=await aggregate.recoverKnownAttendance(entry,{authenticatedUserId:m.seed.authUserId,storage:s,isCurrentAuth:current,signal:new AbortController().signal,
   apiFetch:async(path,init)=>new Response(m.respond('http://127.0.0.1'+path,init.method,m.seed.authUserId,fault).text,{headers:{'content-type':'application/json'}})});
  assert.equal(r,null);assert.equal(s.getItem(entry.storageKey),before);
 }
});
test('the concurrent replacement is a different valid exact intent, not corrupt placeholder bytes',async()=>{
 const m=await createPeriodRecoveryBrowserModel(),s=store([m.entries[1]]);s.setItem(m.replacement.key,m.replacement.raw);
 const r=await aggregate.listKnownAttendanceRecoveries(s,m.seed.authUserId,current);assert.equal(r.invalid,false);assert.equal(r.entries.length,1);
 assert.notEqual(r.entries[0].operationId,m.entries[1].operationId);assert.equal(s.getItem(m.replacement.key),m.replacement.raw);
});
test('global64 budget includes legacy plus new types, while each per-kind inventory remains bounded',async()=>{
 const m=await createPeriodRecoveryBrowserModel(),s=store(m.entries);for(let n=0;n<61;n++)s.setItem(`faolla:attendance:period-delegation:v1:qa-cap-${n}`,'{}');
 assert.equal(s.length,64);const r=await aggregate.listKnownAttendanceRecoveries(s,m.seed.authUserId,current);assert.equal(r.entries.length,3);assert.equal(r.invalid,true);
 s.setItem('faolla:attendance:period-delegation:v1:qa-cap-61','{}');const before=[...s.values];
 await assert.rejects(aggregate.listKnownAttendanceRecoveries(s,m.seed.authUserId,current),/recovery_storage_limit/);assert.deepEqual([...s.values],before);
});
test('runner is inert, loopback-only, in-memory, bounded and finally closes every owned resource',async()=>{
 const text=await readFile(new URL('./attendance-period-recovery-browser.mjs',import.meta.url),'utf8');
 assert.deepEqual(periodRecoveryBrowserLimits,{ttlMs:180000,http:80,api:20});assert.match(text,/process\.argv\[2\]==='--run-local'/);assert.match(text,/server\.listen\(0,'127\.0\.0\.1'/);
 assert.match(text,/write:false/);assert.match(text,/req\.method\(\)!=='GET'/);assert.match(text,/finally\{closing=true/);
 for(const pattern of [/context\.close\(\)/,/browser\.close\(\)/,/server\?\.closeAllConnections\(\)/,/server\.close\(/,/esbuild/])assert.match(text,pattern);
 assert.doesNotMatch(text,/spawn\(|execFile\(|initdb|pg_ctl|writeFile|launchPersistentContext|connectOverCDP/);
 assert.match(text,/img-src 'self'/);assert.match(text,/href="\/favicon\.ico"/);assert.doesNotMatch(text,/href="data:/);
 assert.match(text,/pageSupabaseAuthVerified:false/);assert.match(text,/actualSql:false/);assert.match(text,/requests:requests\.slice\(-5\)/);
});
test('entry uses the real independent Panel, synthetic Auth lease and delayed actual response bytes',async()=>{
 const text=await readFile(new URL('./attendance-period-recovery-browser-entry.tsx',import.meta.url),'utf8');
 assert.match(text,/import RecoveryPanel from .*MerchantAttendanceDelegationRecoveryPanel/);assert.match(text,/<RecoveryPanel key=\{generation\} authUserId=/);
 assert.match(text,/generation === generation/);assert.match(text,/controller\.enqueue\(bytes\.slice\(0, 1\)\)/);assert.match(text,/featureFlagsEnabled: false/);
 assert.doesNotMatch(text,/getUser\(|createClient\(|sessionStorage\.setItem|POST|PATCH/);
});
