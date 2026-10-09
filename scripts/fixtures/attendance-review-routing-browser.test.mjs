import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {createReviewRoutingBrowserModel,reviewRoutingBrowserLimits} from './attendance-review-routing-browser.mjs';
const require=createRequire(import.meta.url),p=require('../../src/lib/merchantAttendanceReviewRouting.ts'),f=require('./attendance-review-routing-model.ts'),w=require('./attendance-work-arrangement-model.ts');
const api='http://127.0.0.1/api/merchant-enterprise/attendance/review-routing';
test('198 browser model retains exact original identity, one explicit grant and no parallel approval writer',async()=>{
 const m=await createReviewRoutingBrowserModel(),query={siteId:m.seed.siteId,mode:'detail',family:'work_arrangement',requestId:m.seed.request};
 const d=JSON.parse((await m.respond(api+'?'+p.reviewRoutingQueryString(query),'GET','',m.seed.owner)).text).data;
 assert.equal(d.data.current,null);assert.equal(d.data.canRegister,true);assert.equal(d.data.request.employeeAuthUserId,m.seed.self);
 const grants=JSON.parse((await m.respond(api+'?'+p.reviewRoutingQueryString({...query,mode:'grants',cursor:null}),'GET','',m.seed.owner)).text).data;
 assert.equal(grants.data.items.length,1);assert.equal(grants.data.items[0].usable,true);
 const original=JSON.parse((await m.respond('http://127.0.0.1/api/merchant-enterprise/attendance/work-arrangements?'+new URLSearchParams({siteId:m.seed.siteId,access:'owner',requestId:m.seed.request}),'GET','',m.seed.owner)).text);
 assert.equal(original.detail.workerId,d.data.request.workerId);assert.equal(original.detail.employeeId,d.data.request.employeeId);assert.equal(original.detail.employeeAuthUserId,d.data.request.employeeAuthUserId);
 await assert.rejects(m.respond('http://127.0.0.1/api/merchant-enterprise/attendance/work-arrangements','POST','{}',m.seed.owner),/no_parallel_approval_writer/);assert.equal(m.records.size,0);
});
test('198 browser lost original receipt recovers by same actor GET and handover has no new grant',async()=>{
 const m=await createReviewRoutingBrowserModel(),query={siteId:m.seed.siteId,mode:'detail',family:'work_arrangement',requestId:m.seed.request};
 const d=JSON.parse((await m.respond(api+'?'+p.reviewRoutingQueryString(query),'GET','',m.seed.owner)).text).data.data;
 const command=f.routingCommand({expectedRequestRevision:d.observation.requestRevision,expectedObservationFingerprint:d.observation.observationFingerprint});
 const saved=await m.respond(api,'POST',JSON.stringify({query,command}),m.seed.owner);assert.throws(()=>JSON.parse(saved.text));assert.equal(m.records.size,1);
 const recover={siteId:m.seed.siteId,mode:'recover',family:'work_arrangement',operationId:command.operationId},get=async actor=>JSON.parse((await m.respond(api+'?'+p.reviewRoutingQueryString(recover),'GET','',actor)).text).data;
 m.hideReceipt(true);assert.equal((await get(m.seed.owner)).receipt,null);m.hideReceipt(false);assert.equal((await get(m.seed.other)).receipt,null);m.owner(m.seed.other);
 const recovered=await get(m.seed.owner);assert.equal(recovered.receipt.commandFingerprint,f.routingCommandHash(query,command,m.seed.owner));assert.equal(recovered.data.kind,'receipt');assert(!('request'in recovered.data));
 m.owner(m.seed.owner);const handoverQuery={...query,requestId:m.seed.handover},handover=JSON.parse((await m.respond(api+'?'+p.reviewRoutingQueryString(handoverQuery),'GET','',m.seed.owner)).text).data.data;assert.equal(handover.canTakeOver,true);
 const take=f.routingCommand({action:'take_over',operationId:f.routingId(301),grantId:null,expectedResponsibilityRevision:1,expectedResponsibilityOperationId:m.seed.handover,expectedRequestRevision:1,expectedObservationFingerprint:handover.observation.observationFingerprint});
 await m.respond(api,'POST',JSON.stringify({query:handoverQuery,command:take}),m.seed.owner);assert.equal(m.heads.get(m.seed.handover).assignment.kind,'owner');assert.equal(m.records.size,2);
 assert.equal(w.workArrangementOwner,m.seed.owner);
});
test('198 runner is inert, finite, memory-only and scoped to its own local browser/listener',async()=>{
 const source=await readFile(new URL('./attendance-review-routing-browser.mjs',import.meta.url),'utf8'),entry=await readFile(new URL('./attendance-review-routing-browser-entry.tsx',import.meta.url),'utf8');
 assert.deepEqual(reviewRoutingBrowserLimits,{groups:4,ttlMs:180000,http:55,api:32,posts:2,mobileWidth:390});
 for(const fragment of ['write:false',"server.listen(0,'127.0.0.1'",'serviceWorkers:\'block\'','acceptDownloads:false','actualSql:false','actualAuth:false',"process.argv[2]==='--run-local'",'runAttendanceCleanupSteps','assert(!browser?.isConnected()&&!server?.listening)'])assert(source.includes(fragment),fragment);
 for(const fragment of ['MerchantAttendanceAdminPanel','MerchantAttendanceDelegationRecoveryPage','MerchantAttendanceReviewRoutingSelf','registerLeaveGuard={register}','new ReadableStream'])assert(entry.includes(fragment),fragment);
 assert(!/writeFile|screenshot\(|download\.saveAs|initdb/.test(source));assert(!source.includes('memberships'));
});
