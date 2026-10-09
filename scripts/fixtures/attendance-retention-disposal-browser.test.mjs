import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {createRetentionDisposalBrowserModel,retentionDisposalBrowserLimits} from './attendance-retention-disposal-browser.mjs';
const require=createRequire(import.meta.url),f=require('./attendance-retention-disposal-execution-model.ts'),p=require('../../src/lib/merchantAttendanceRetentionDisposalExecution.ts');
const api='http://127.0.0.1/api/merchant-enterprise/attendance/retention-disposal';
test('browser model keeps approval separate, unknown original receipt and actual execution',async()=>{
 const m=await createRetentionDisposalBrowserModel(),q=f.disposalQuery(),c=await f.disposalApprove();
 const first=await m.respond(api,'POST',JSON.stringify({query:q,command:c}),m.seed.owner);assert.throws(()=>JSON.parse(first.text));assert.equal(m.isDisposed(),false);
 const recover={siteId:m.seed.siteId,mode:'recover',eventId:null,operationId:c.operationId},get=async query=>JSON.parse((await m.respond(api+'?'+p.disposalExecutionQueryString(query),'GET','',m.seed.owner)).text).data;
 m.enabled(false);m.hideReceipt(true);assert.equal((await get(recover)).data.receipt,null);m.hideReceipt(false);assert.equal((await get(recover)).data.receipt.operationId,c.operationId);
 const execute={action:'execute',operationId:f.disposalId(8),eventId:q.eventId,approvalOperationId:c.operationId};await assert.rejects(m.respond(api,'POST',JSON.stringify({query:q,command:execute}),m.seed.owner),/new_write_disabled/);
 m.enabled(true);await m.respond(api,'POST',JSON.stringify({query:q,command:execute}),m.seed.owner);assert.equal(m.isDisposed(),true);const final=await get(q);assert.deepEqual(final.data.preview.blockers,['precision_not_present','already_disposed']);
 await assert.rejects(m.respond(api+'?'+p.disposalExecutionQueryString(q),'GET','',m.seed.other));assert.equal(m.records.size,2);
});
test('197 browser is bounded, inert, localhost-only and never persists a bundle or downloads',async()=>{
 assert.deepEqual(retentionDisposalBrowserLimits,{ttlMs:180000,http:40,api:20,posts:2});
 const source=await readFile(new URL('./attendance-retention-disposal-browser.mjs',import.meta.url),'utf8'),entry=await readFile(new URL('./attendance-retention-disposal-browser-entry.tsx',import.meta.url),'utf8');
 for(const part of ['write:false',"server.listen(0,'127.0.0.1'",'actualSql:false','actualAuth:false',"process.argv[2]==='--run-local'",'runAttendanceCleanupSteps','assert(!browser?.isConnected()&&!server?.listening)',"serviceWorkers:'block'",'acceptDownloads:false'])assert(source.includes(part),part);
 for(const part of ['MerchantAttendanceAdminPanel','MerchantAttendanceDelegationRecoveryPage','registerLeaveGuard={register}','new ReadableStream'])assert(entry.includes(part),part);
 assert(!/writeFile|screenshot\(|download\.saveAs|initdb/.test(source));
});
