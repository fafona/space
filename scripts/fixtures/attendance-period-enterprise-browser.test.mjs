import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {createPeriodEnterpriseModel,periodEnterpriseLimits,periodEnterprisePaths as api} from './attendance-period-enterprise-browser.mjs';
const require=createRequire(import.meta.url),p=require('../../src/lib/merchantAttendancePeriodDelegatedClosure.ts'),g=require('../../src/lib/merchantAttendancePeriodDelegation.ts');
const url=(pathname,q)=>'http://127.0.0.1'+pathname+(q?'?'+new URLSearchParams(q):'');
const dq=(m,access='delegate',mode='list')=>({siteId:m.seed.siteId,access,mode,catalog:null,grantId:mode==='detail'?m.seed.grantId:null,afterId:null,operationId:null});
const cq=(m,mode='detail')=>({siteId:m.seed.siteId,access:'delegate',grantId:m.seed.grantId,workerId:m.seed.workerId,fromDate:mode==='list'?m.seed.fromDate:m.original.fromDate,
 throughDate:mode==='list'?m.seed.throughDate:m.original.throughDate,mode,periodId:mode==='list'?null:m.original.periodId,operationId:null,version:null,cursor:null});
test('employee overview gives period-only supervisor no self/tasks/directory permissions or rows',()=>{
 const m=createPeriodEnterpriseModel(),r=m.respond(url(api.overview,{siteId:m.seed.siteId}),'GET','',m.seed.tokens.employee).body;
 assert.equal(r.actor.type,'employee');assert.equal(r.actor.id,m.seed.actorEmployeeId);assert.equal(r.currentAuthUserId,m.seed.authUserId);
 assert.notEqual(r.actor.id,r.currentAuthUserId);assert.deepEqual(r.actor.permissions,['enterprise.view','attendance.period.view','attendance.period.respond']);
 for(const values of Object.values(r.snapshot))assert.deepEqual(values,[]);assert.equal(m.writes.length,0);
});
test('owner Admin, operations and employee todo reads have real parser-compatible empty DTOs',()=>{
 const m=createPeriodEnterpriseModel();assert.equal(m.respond(url(api.overview,{siteId:m.seed.siteId}),'GET','',m.seed.tokens.owner).body.currentAuthUserId,m.seed.ownerId);
 for(const [path,q,identity]of [[api.operations,{siteId:m.seed.siteId},'owner'],[api.admin,{siteId:m.seed.siteId,view:'settings',search:''},'owner'],[api.todos,{siteId:m.seed.siteId,category:'all',limit:'20'},'employee']]){
  assert.equal(m.respond(url(path,q),'GET','',m.seed.tokens[identity]).body.ok,true);
 }assert.throws(()=>m.respond(url(api.operations,{siteId:m.seed.siteId}),'GET','',m.seed.tokens.employee));
 assert.throws(()=>m.respond(url(api.admin,{siteId:m.seed.siteId,view:'settings',search:''}),'GET','',m.seed.tokens.employee));
});
test('both real grant interfaces and delegated saved period interfaces strictly parse',()=>{
 const m=createPeriodEnterpriseModel();for(const identity of ['owner','employee'])for(const mode of ['list','detail']){
  const q=dq(m,identity==='owner'?'owner':'delegate',mode),r=m.respond('http://127.0.0.1'+api.delegation+'?'+g.periodDelegationQueryString(q),'GET','',m.seed.tokens[identity]);
  assert.equal(r.body.actorId,identity==='owner'?m.seed.ownerId:m.seed.authUserId);assert.equal(r.body.employeeId,identity==='owner'?null:m.seed.actorEmployeeId);
 }
 for(const mode of ['list','detail']){const q=cq(m,mode),r=m.respond('http://127.0.0.1'+api.closure+'?'+p.periodDelegatedClosureQueryString(q),'GET','',m.seed.tokens.employee);
  assert.equal(r.body.data.kind,mode);assert.equal(r.body.data.actorId,m.seed.authUserId);}
});
test('one exact real-protocol command saves receipt before only its response is malformed',()=>{
 const m=createPeriodEnterpriseModel(),q=cq(m),command={action:'respond',operationId:'73000000-0000-4000-8000-000000235001',periodId:m.original.periodId,
  expectedRevision:m.original.revision,expectedVersion:m.original.currentVersion,expectedFingerprint:null,reason:'Explicit synthetic parent response'};
 const r=m.respond(url(api.closure),'POST',JSON.stringify({query:q,command}),m.seed.tokens.employee);assert.equal(r.text,'{"ok":');assert.equal(m.writes.length,1);assert.deepEqual(m.writes[0].command,command);
 const recover={...q,mode:'recover',operationId:command.operationId},saved=m.respond('http://127.0.0.1'+api.closure+'?'+p.periodDelegatedClosureQueryString(recover),'GET','',m.seed.tokens.employee);
 assert.deepEqual(saved.body.data.receipt,r.body.data.receipt);assert.deepEqual(saved.body.data.usableActions,[]);assert.equal(m.writes.length,1);
 assert.throws(()=>m.respond(url(api.closure),'POST',JSON.stringify({query:q,command}),m.seed.tokens.employee),/one_post_only/);
});
test('six API allowlist rejects other token, hidden directory, authority extras and writes elsewhere',()=>{
 const m=createPeriodEnterpriseModel();assert.equal(Object.values(api).length,6);
 assert.throws(()=>m.respond(url(api.overview,{siteId:m.seed.siteId}),'GET','','not-a-token'));
 assert.throws(()=>m.respond(url('/api/merchant-enterprise/employees',{siteId:m.seed.siteId}),'GET','',m.seed.tokens.employee));
 assert.throws(()=>m.respond(url(api.overview,{siteId:m.seed.siteId,actorId:m.seed.ownerId}),'GET','',m.seed.tokens.employee));
 assert.throws(()=>m.respond(url(api.delegation),'POST','{}',m.seed.tokens.owner));
 assert.throws(()=>m.respond('http://127.0.0.1'+api.delegation+'?'+g.periodDelegationQueryString(dq(m)),'GET','',m.seed.tokens.other));
});
test('entry mounts actual whole Manager and uses its formal outer navigation guard; no host aliases',async()=>{
 const text=await readFile(new URL('./attendance-period-enterprise-browser-entry.tsx',import.meta.url),'utf8');
 assert.match(text,/import Manager.*MerchantEnterpriseManager/);assert.match(text,/<Manager siteId=/);assert.match(text,/registerViewChangeGuard/);
 assert.match(text,/navigationGuard\.current\(next\)/);assert.match(text,/navigation=\{identity==="owner"\?undefined:navigation\}/);
 assert.match(text,/collaborationRefreshIntervalMs=\{240000\}/);assert.match(text,/controller\.enqueue\(bytes\.slice\(0,1\)\)/);
 assert.doesNotMatch(text,/import .*Launcher|import .*AdminPanel|createClient\(|getUser\(|sessionStorage\.setItem/);
});
test('runner is inert, bounded and memory-only; real Next dynamic and CSS retained; all resources closed',async()=>{
 const text=await readFile(new URL('./attendance-period-enterprise-browser.mjs',import.meta.url),'utf8');
 assert.deepEqual(periodEnterpriseLimits,{ttlMs:180000,http:80,api:20});assert.match(text,/process\.argv\[2\]==='--run-local'/);
 assert.match(text,/server\.listen\(0,'127\.0\.0\.1'/);assert.match(text,/write:false/);assert.match(text,/actual_next_dynamic_required/);
 assert.match(text,/bundle\.outputFiles\.filter\(f=>f\.path\.endsWith\('\.css'\)\)/);assert.match(text,/finally\{closing=true/);
 for(const pattern of [/context\.close\(\)/,/browser\.close\(\)/,/server\?\.closeAllConnections\(\)/,/server\.close\(/,/esbuild/])assert.match(text,pattern);
 assert.doesNotMatch(text,/spawn\(|execFile\(|initdb|pg_ctl|writeFile|launchPersistentContext|connectOverCDP|force:true|force: true/);
 assert.match(text,/not an internal tab click/);assert.match(text,/actualSql:false/);assert.match(text,/nextWholeSite:false/);assert.match(text,/assert\.deepEqual\(errors,\[\]\)/);
});
