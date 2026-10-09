import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {createAdministrativeClosureBrowserModel,administrativeClosureBrowserLimits} from './attendance-administrative-closure-browser.mjs';
const require=createRequire(import.meta.url);
const {administrativeClosureQueryString,parseAdministrativeClosureResult}=require('../../src/lib/merchantAttendanceAdministrativeClosure.ts');
const {closureId,closureContext,closureEnd}=require('../../src/lib/merchantAttendanceAdministrativeClosureTestFixtures.ts');
const api='http://127.0.0.1/api/merchant-enterprise/attendance/administrative-closures';

test('195 browser model saves unknown separately, recovers exact receipt and retains raw candidate identity',async()=>{
 const m=await createAdministrativeClosureBrowserModel(),q={siteId:m.seed.siteId,access:'owner',mode:'candidate',workerId:m.seed.worker};
 const get=async query=>JSON.parse((await m.respond(api+'?'+administrativeClosureQueryString(query),'GET','',m.seed.owner)).text);
 const initial=await get(q);assert.equal(initial.data.data.detail.summary,null);assert.equal(initial.data.data.detail.frame.tailAction,'clock_in');
 const command={operationId:closureId(5000),startEventId:m.seed.start,expectedRevision:0,reason:'Synthetic unknown end',action:'record_unknown',workerId:m.seed.worker,expectedSourceFingerprint:closureContext().sourceFingerprint,verifiedEndAt:null};
 const reply=await m.respond(api,'POST',JSON.stringify({query:q,command}),m.seed.owner);assert.throws(()=>JSON.parse(reply.text));assert.equal(m.entries.length,1);
 const recover={siteId:m.seed.siteId,access:'owner',mode:'recover',operationId:command.operationId};m.hideReceipt(true);assert.equal((await get(recover)).data.data.receipt,null);
 m.hideReceipt(false);const receipt=(await get(recover)).data;await parseAdministrativeClosureResult(receipt,recover,m.seed.owner,command);assert.equal(receipt.data.receipt.operationId,command.operationId);
 const current=(await get(q)).data.data.detail;assert.equal(current.summary.state,'pending');assert.equal(current.closure,null);assert.equal(current.frame.tailAction,'clock_in');assert.equal(current.currentEntry.verifiedEndAt,null);
 const close={...command,operationId:closureId(5001),expectedRevision:1,action:'close',verifiedEndAt:closureEnd};await m.respond(api,'POST',JSON.stringify({query:q,command:close}),m.seed.owner);
 const closed=(await get({siteId:m.seed.siteId,access:'owner',mode:'detail',startEventId:m.seed.start})).data.data.detail;assert.equal(closed.summary.state,'closed');assert.equal(closed.closure.verifiedEndAt,closureEnd);assert.equal(closed.frame.tailAction,'clock_in');
 await assert.rejects(m.respond(api+'?'+administrativeClosureQueryString(q),'GET','',m.seed.other));assert.equal(m.entries.length,2);
});

test('195 browser history uses strict exclusive pages of 25 then 1 without additional writes',async()=>{
 const m=await createAdministrativeClosureBrowserModel(),q={siteId:m.seed.siteId,access:'self',mode:'history',startEventId:m.seed.history,beforeRevision:null};
 const first=JSON.parse((await m.respond(api+'?'+administrativeClosureQueryString(q),'GET','',m.seed.self)).text).data;assert.equal(first.data.items.length,25);assert.equal(first.data.items[0].revision,26);assert.equal(first.data.nextBeforeRevision,2);
 const lastQuery={...q,beforeRevision:first.data.nextBeforeRevision},last=JSON.parse((await m.respond(api+'?'+administrativeClosureQueryString(lastQuery),'GET','',m.seed.self)).text).data;
 assert.equal(last.data.items.length,1);assert.equal(last.data.items[0].revision,1);assert.equal(last.data.nextBeforeRevision,null);assert.equal(m.entries.length,0);assert.equal(m.records.size,0);
});

test('195 browser runner remains inert, bounded, memory bundled and explicitly synthetic',async()=>{
 const source=await readFile(new URL('./attendance-administrative-closure-browser.mjs',import.meta.url),'utf8'),entry=await readFile(new URL('./attendance-administrative-closure-browser-entry.tsx',import.meta.url),'utf8');
 assert.deepEqual(administrativeClosureBrowserLimits,{ttlMs:180000,http:70,api:40,posts:3});
 for(const fragment of ['write:false',"server.listen(0,'127.0.0.1'",'serviceWorkers:\'block\'','acceptDownloads:false','actualSql:false','actualAuth:false',"process.argv[2]==='--run-local'",'runAttendanceCleanupSteps','assert(!browser?.isConnected()&&!server?.listening)'])assert(source.includes(fragment),fragment);
 for(const fragment of ['MerchantAttendanceAdminPanel','MerchantAttendanceAdministrativeClosurePage','registerLeaveGuard={register}','new ReadableStream'])assert(entry.includes(fragment),fragment);
 assert(!/writeFile|screenshot\(|download\.saveAs|initdb/.test(source));assert(!source.includes('memberships'));
});
