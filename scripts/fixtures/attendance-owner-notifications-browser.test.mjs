import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {createOwnerNotificationsBrowserModel,ownerNotificationsBrowserLimits} from './attendance-owner-notifications-browser.mjs';
const require=createRequire(import.meta.url),n=require('../../src/lib/merchantAttendanceOwnerNotifications.ts'),nc=require('../../src/lib/merchantAttendanceOwnerNotificationsClient.ts'),p=require('../../src/lib/merchantAttendancePeriodClosureV2.ts');
const op='23600000-0000-4000-8000-000000000099';
const q=(m,mode='list')=>({siteId:m.seed.siteId,mode,notificationId:mode==='list'?null:m.periodItem.notificationId,operationId:mode==='recover'?op:null,beforeAt:null,beforeId:null});
const url=(m,query=q(m))=>'http://127.0.0.1'+n.OWNER_NOTIFICATIONS_API+'?'+n.ownerNotificationsQueryString(query);
function post(m,fault='none'){
 const command={action:'mark_read',operationId:op,notificationId:m.periodItem.notificationId};
 return m.respond('http://127.0.0.1'+n.OWNER_NOTIFICATIONS_API,'POST',m.seed.actorId,JSON.stringify({query:q(m,'detail'),command}),fault);
}
test('strict synthetic list and detail are metadata-only, inert and read-only',()=>{
 const m=createOwnerNotificationsBrowserModel();const list=m.respond(url(m),'GET',m.seed.actorId);assert.equal(list.body.items.length,2);
 assert.deepEqual(list.body.items.map(v=>v.sourceCategory),['period','plan_exception']);assert.equal(m.snapshot().rows,0);
 const detail=m.respond(url(m,q(m,'detail')),'GET',m.seed.actorId);assert.equal(detail.body.item.notificationId,m.periodItem.notificationId);
 assert.doesNotMatch(JSON.stringify(detail.body),/reason|note|latitude|commandFingerprint/);
});
test('actual response parsers accept fresh original V2 target with exact full frame, without a source write',()=>{
 const m=createOwnerNotificationsBrowserModel(),r=m.respond('http://127.0.0.1'+m.seed.endpoints[1]+'?'+p.periodClosureV2QueryString(m.pq),'GET',m.seed.actorId);
 assert.equal(r.body.data.kind,'detail');assert.equal(r.body.data.period.periodId,m.periodItem.sourceId);assert.equal(r.body.data.period.employeeAuthUserId,m.periodItem.employeeAuthUserId);
 assert.equal(r.body.data.operation,null);assert.equal(r.body.data.period.unresolvedDispute,true);assert.equal(m.snapshot().rows,0);
 assert.throws(()=>m.respond('http://127.0.0.1'+m.seed.endpoints[1],'POST',m.seed.actorId,'{}'),/period_never_written/);
});
test('save precedes malformed transport and repeat exact original is one immutable model row',()=>{
 const m=createOwnerNotificationsBrowserModel(),r=post(m,'malformed');assert.equal(r.text,'{"ok":');assert.equal(m.snapshot().rows,1);
 assert.equal(r.body.receipt.operationId,op);post(m);assert.equal(m.snapshot().rows,1);
 const detail=m.respond(url(m,q(m,'detail')),'GET',m.seed.actorId);assert.equal(detail.body.item.readAt,r.body.receipt.readAt);
 const recovered=m.respond(url(m,q(m,'recover')),'GET',m.seed.actorId);assert.deepEqual(recovered.body.receipt,r.body.receipt);
 assert.deepEqual(Object.keys(recovered.body.receipt).sort(),['actorId','notificationId','operationId','readAt']);
});
test('null/malformed recover are explicit transport faults, never ledger loss or another POST',()=>{
 const m=createOwnerNotificationsBrowserModel();post(m);const before=m.snapshot();
 assert.equal(m.respond(url(m,q(m,'recover')),'GET',m.seed.actorId,'','null').body.receipt,null);
 assert.equal(m.respond(url(m,q(m,'recover')),'GET',m.seed.actorId,'','malformed').text,'{"ok":');assert.deepEqual(m.snapshot(),before);
});
test('unknown paths, Auth, body authority and conflicting operation are rejected',()=>{
 const m=createOwnerNotificationsBrowserModel();assert.throws(()=>m.respond(url(m),'GET',m.seed.otherActorId),/synthetic_auth/);
 assert.throws(()=>m.respond(url(m)+'&ownerId='+m.seed.actorId,'GET',m.seed.actorId));assert.throws(()=>m.respond('http://127.0.0.1/other','GET',m.seed.actorId),/unknown_endpoint/);
 post(m);const command={action:'mark_read',operationId:op,notificationId:m.planItem.notificationId};
 assert.throws(()=>m.respond('http://127.0.0.1'+n.OWNER_NOTIFICATIONS_API,'POST',m.seed.actorId,JSON.stringify({query:{...q(m,'detail'),notificationId:command.notificationId},command})),/operation_conflict/);
 assert.equal(m.snapshot().rows,1);
});
test('concurrent replacement is a valid different local-only intent without source or message text',()=>{
 const m=createOwnerNotificationsBrowserModel(),raw=JSON.stringify({version:1,actorId:m.seed.actorId,query:q(m,'detail'),command:{action:'mark_read',operationId:op,notificationId:m.periodItem.notificationId}});
 const replacement=m.replacement(raw),parsed=nc.parseOwnerNotificationsPending(replacement,m.seed.siteId,m.seed.actorId);
 assert.notEqual(parsed.command.operationId,op);assert.equal(parsed.command.notificationId,m.periodItem.notificationId);assert.equal(m.snapshot().rows,0);
 assert.doesNotMatch(replacement,/sourceCategory|reason|note|employeeAuthUserId/);
});
test('inert runner remains loopback/in-memory/budgeted with all owned resources closed in finally',async()=>{
 const text=await readFile(new URL('./attendance-owner-notifications-browser.mjs',import.meta.url),'utf8');
 assert.deepEqual(ownerNotificationsBrowserLimits,{ttlMs:180000,http:80,api:20});assert.match(text,/process\.argv\[2\]==='--run-local'/);assert.match(text,/server\.listen\(0,'127\.0\.0\.1'/);
 assert.match(text,/write:false/);assert.match(text,/finally\{closing=true/);for(const pattern of [/context\.close\(\)/,/browser\.close\(\)/,/server\?\.closeAllConnections\(\)/,/server\.close\(/,/esbuild/])assert.match(text,pattern);
 assert.doesNotMatch(text,/spawn\(|execFile\(|initdb|pg_ctl|writeFile|launchPersistentContext|connectOverCDP/);
 assert.match(text,/actualAuth:false/);assert.match(text,/actualSql:false/);assert.match(text,/complete HTTP 200 with malformed JSON/);assert.match(text,/requests:requests\.slice\(-5\)/);
 assert.match(text,/img-src 'self'/);assert.match(text,/href="\/favicon\.ico"/);
});
test('entry renders actual Launcher with a synthetic Auth lease and holds strict bytes only after first byte',async()=>{
 const text=await readFile(new URL('./attendance-owner-notifications-browser-entry.tsx',import.meta.url),'utf8');
 assert.match(text,/import Launcher from .*MerchantAttendanceOwnerNotificationsLauncher/);assert.match(text,/<Launcher key=\{token\}/);assert.match(text,/isCurrentAuth=\{isCurrentAuth\}/);
 assert.match(text,/controller\.enqueue\(bytes\.slice\(0, 1\)\)/);assert.doesNotMatch(text,/getUser\(|createClient\(|sessionStorage\.setItem|localStorage/);
});
