import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {backlogNavigationRequestAllowed as allowed,backlogNavigationLimits,backlogNavigationGroups,backlogNavigationHeaders} from './merchant-attendance-owner-backlog-navigation-browser-check.mjs';
const require=createRequire(import.meta.url);
const {createBacklogNavigationModel,backlogNavigationSeed:seed,backlogNavigationApi:api,backlogNavigationPending,backlogNavigationMissingQueryString}=require('./fixtures/attendance-owner-backlog-navigation-browser-model.ts');
const origin='http://127.0.0.1:49123';
const url=(kind,id=seed[kind],op=null)=>kind==='missing'?origin+api[kind]+'?'+backlogNavigationMissingQueryString(id)+(op?'&operationId='+op:'')
 :origin+api[kind]+'?'+new URLSearchParams({siteId:seed.siteId,requestId:id,...(op?{operationId:op}:{})});
const read=(model,href,actor=seed.owner)=>model.respond({url:href,method:'GET',actor});
test('inert module exports bounded explicit loopback configuration only',()=>{
 assert.deepEqual(backlogNavigationLimits,{ttlMs:240000,requestLimit:100,postLimit:0});assert.equal(backlogNavigationGroups.length,11);
 const text=readFileSync(new URL('./merchant-attendance-owner-backlog-navigation-browser-check.mjs',import.meta.url),'utf8');
 assert.match(text,/if\(process\.argv\[1\]/);assert.match(text,/write:false/);assert.match(text,/server\.listen\(0,'127\.0\.0\.1'/);
 assert.doesNotMatch(text,/runAttendanceLabelsReuse|initdb|pg_ctl|localhost:3131|node_modules.*copy/i);
 assert.match(backlogNavigationHeaders['Content-Security-Policy'],/connect-src 'self'/);assert.equal(backlogNavigationHeaders['Cache-Control'],'no-store');
});
test('exact GET route allowlist rejects external, authority tricks and all writes',()=>{
 for(const p of ['/', '/qa.js', '/qa.css', '/favicon.ico', ...Object.values(api)])assert(allowed(origin+p,'GET',origin));
 for(const method of ['POST','PUT','DELETE','HEAD'])assert.equal(allowed(url('missing'),method,origin),false);
 for(const raw of ['https://www.faolla.com/',origin+'/api/other',origin+'/qa.js?x=1',origin+'/#x','http://user@127.0.0.1:49123/',origin+'/bad\\path'])assert.equal(allowed(raw,'GET',origin),false);
});
test('synthetic Admin and117 responses use production strict validators',()=>{
 const m=createBacklogNavigationModel();assert.equal(read(m,origin+api.admin+'?siteId='+seed.siteId+'&view=settings').status,200);
 const result=read(m,origin+api.backlog+'?siteId='+seed.siteId+'&kind=all');assert.equal(result.status,200);
 assert.deepEqual(result.body.items.map(x=>x.kind),['correction','revision','missing']);assert.equal(result.body.readOnly,true);
 assert.equal(m.snapshot().successfulWrites,0);
});
for(const kind of ['correction','revision','missing'])test(kind+' exact target normal/processed/paused/denied responses remain strict',()=>{
 const m=createBacklogNavigationModel();assert.equal(read(m,url(kind)).status,200);
 m.configure({kind,mode:'processed'});assert.equal(read(m,url(kind)).status,200);
 m.configure({kind,mode:'paused'});const off=read(m,url(kind));assert.equal(off.status,200);assert.equal(off.body.moduleEnabled,false);
 m.configure({kind,mode:'denied'});assert.deepEqual(read(m,url(kind)),{status:403,body:{ok:false,error:'attendance_access_denied'}});
});
for(const kind of ['correction','revision','missing'])test(kind+' original pending receipt is separate from newly selected target and recoverable with writes off',()=>{
 const m=createBacklogNavigationModel(),p=backlogNavigationPending(kind);assert.notEqual(p.requestId,seed[kind]);assert(p.key.includes(seed.owner));assert(JSON.parse(p.raw).command.operationId===p.operationId);
 m.configure({mode:'paused',receiptAvailable:false});const unknown=read(m,url(kind,p.requestId,p.operationId));assert.equal(unknown.status,200);assert.equal(unknown.body.receipt,null);
 m.configure({receiptAvailable:true});const saved=read(m,url(kind,p.requestId,p.operationId));assert.equal(saved.status,200);assert.equal(saved.body.moduleEnabled,false);assert.equal(saved.body.receipt.operationId,p.operationId);
 assert.equal(read(m,url(kind)).body.receipt,null);assert.equal(m.snapshot().successfulWrites,0);
});
test('denied actor and POST never produce a synthetic success or business mutation',()=>{
 const m=createBacklogNavigationModel();assert.equal(read(m,url('correction'),seed.other).status,403);
 assert.equal(m.respond({url:url('missing'),method:'POST',actor:seed.owner}).status,405);assert.equal(m.snapshot().successfulWrites,0);
 assert.throws(()=>m.configure({unbounded:true}));assert.throws(()=>m.configure({kind:'leave',mode:'normal'}));
});

test('original Missing launcher accepts a strict empty list rather than a fabricated target',()=>{
 const m=createBacklogNavigationModel(),u=new URL(url('missing'));u.searchParams.delete('requestId');
 const r=read(m,u.href);assert.equal(r.status,200);assert.equal(r.body.detail,null);assert.equal(r.body.receipt,null);assert.deepEqual(r.body.items,[]);
});

test('explicit runner has GET-only actual-component groups with fixed cleanup and honest boundaries',()=>{
 const text=readFileSync(new URL('./merchant-attendance-owner-backlog-navigation-browser-check.mjs',import.meta.url),'utf8');
 assert.match(text,/--run-local/);assert.match(text,/chromium\.launch\(\{headless:true\}\)/);
 assert.match(text,/180000/);assert.match(text,/await context\?\.close\(\)/);assert.match(text,/await browser\?\.close\(\)/);assert.match(text,/await server\?\.close\(\)/);
 assert.match(text,/if\(closing\)\{await server\.close/);assert.match(text,/actualUiGeneratedSubmission:false/);assert.match(text,/preexistingPendingFixture:true/);
 assert.match(text,/assert\.equal\(summary\.postAttempts,0\)/);assert.match(text,/server\.snapshot\(\)\.listenerActive,false/);
});

test('three parent-protection groups use actual Admin guard and preserve runtime pending data',()=>{
 assert.deepEqual(backlogNavigationGroups.slice(8),['parent_settings_draft_blocks_navigation','parent_config_pending_runtime_blocks_selected_row','outer_leave_guard_preserves_or_discards_draft_explicitly']);
 const runner=readFileSync(new URL('./merchant-attendance-owner-backlog-navigation-browser-check.mjs',import.meta.url),'utf8');
 const harness=readFileSync(new URL('./fixtures/attendance-owner-backlog-navigation-browser.tsx',import.meta.url),'utf8');
 assert.match(harness,/registerLeaveGuard=\{registerLeaveGuard\}/);assert.match(harness,/if \(leaveGuard\.current\?\.\(\)\) setMounted\(false\)/);
 assert.match(runner,/assert\.equal\(calls\(\)\.length,beforePendingCalls\)/);assert.match(runner,/sessionStorage\.getItem\(key\)===raw\)sessionStorage\.removeItem\(key\)/);
 assert.match(runner,/assert\.equal\(await outerDraft\.inputValue\(\),'229 外层离开未提交草稿'\)/);assert.match(runner,/assert\.equal\(outerDialogs\.length,2\)/);
});
