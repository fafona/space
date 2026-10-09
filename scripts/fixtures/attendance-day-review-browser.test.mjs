// Public synthetic browser model/source tests only, no browser or database.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {createDayReviewBrowserModel,dayReviewBrowserLimits} from './attendance-day-review-browser.mjs';
const require=createRequire(import.meta.url),p=require('../../src/lib/merchantAttendanceDayReviewContract.ts');
const f=require('./attendance-day-review-ui-model.ts'),s=require('../../src/lib/merchantAttendanceDayReviewSource.ts');
const saved=require('../../src/lib/merchantAttendanceDayReviewResult.ts'),classification=require('../../src/lib/merchantAttendanceDayClassification.ts');
const api='http://127.0.0.1/api/merchant-enterprise/attendance/day-reviews';
const get=async(m,q,actor=m.seed.owner)=>JSON.parse((await m.respond(api+'?'+p.dayReviewQueryString(q),'GET','',actor)).text).data;
const preview=m=>({siteId:m.seed.siteId,access:'owner',mode:'preview',workerId:m.seed.worker,workDate:f.dayUiDate,slotId:f.dayUiId(11),caseId:null});
async function decide(m){
 const query=preview(m),view=await get(m,query),command={action:'decide',operationId:f.dayUiId(2000),caseId:f.dayUiId(2001),expectedRevision:0,
  workerId:m.seed.worker,employeeId:m.seed.employee,employeeAuthUserId:m.seed.self,expectedFingerprint:view.input.source.fingerprint,outcome:'follow_up',
  calendarReference:null,selfStatementOperationId:null,reason:'Synthetic199 owner test'};
 const reply=await m.respond(api,'POST',JSON.stringify({query,command}),m.seed.owner);assert.throws(()=>JSON.parse(reply.text));return{query,command};
}
test('199 public synthetic model supplies two complete plans and detailed background without upgrading caller observations',async()=>{
 const m=await createDayReviewBrowserModel(),q={siteId:m.seed.siteId,access:'owner',mode:'candidates',workerId:m.seed.worker,workDate:f.dayUiDate};
 const clean=await get(m,q);assert.equal(s.parseDayReviewSourceView(clean,q,m.seed.owner).input.source.plans.length,2);
 const evaluated=classification.evaluateDayClassification(clean.input);assert(evaluated.observations.includes('no_record'));assert.equal(evaluated.authorityChecked,false);
 assert.equal(evaluated.candidates.find(v=>v.outcome==='not_worked_reported').candidateState,'blocked');
 m.rich(true);const detailed=await get(m,q);assert.equal(detailed.input.source.calendar.length,1);assert.equal(detailed.input.source.pending.length,1);
 assert.equal(detailed.input.source.arrangements.length,1);assert.equal(detailed.input.source.conflicts.length,1);assert.equal(detailed.input.source.records.length,2);
 assert(classification.evaluateDayClassification(detailed.input).observations.includes('source_conflict'));assert.equal(m.records.size,0);
});
test('199 lost POST saves once, null/foreign receipt cannot clear and exact original actor receipt is parsed independently',async()=>{
 const m=await createDayReviewBrowserModel(),{query,command}=await decide(m),recover={siteId:m.seed.siteId,mode:'recover',operationId:command.operationId};
 assert.equal(m.records.size,1);for(const fault of ['null','foreign']){m.recovery(fault);assert.throws(()=>saved.parseDayReviewSavedResult(undefined,recover,m.seed.owner));
  const raw=await get(m,recover);assert.throws(()=>saved.parseDayReviewSavedResult(raw,recover,m.seed.owner));}
 m.recovery('valid');const receipt=await get(m,recover);saved.parseDayReviewSavedResult(receipt,recover,m.seed.owner);
 assert(p.dayReviewReceiptMatches(receipt.receipt,query,m.seed.owner,command,m.records.get(command.operationId).receipt.commandFingerprint));
 await assert.rejects(m.respond(api,'POST',JSON.stringify({query,command}),m.seed.owner),/unexpected_duplicate_POST/);
 await assert.rejects(get(m,recover,m.seed.self),/unknown_original_actor/);assert.equal(m.records.size,1);
 const same=await get(m,{...query,caseId:command.caseId});assert.equal(same.saved.head.caseId,command.caseId);assert.equal(same.input.source.caseHead.caseId,command.caseId);
});
test('199 synthetic saved history has exact contiguous exclusive pages25+1 and self explanations bind the saved decision',async()=>{
 const m=await createDayReviewBrowserModel(),hq={siteId:m.seed.siteId,access:'self',mode:'history',caseId:m.seed.history,beforeRevision:null};
 const first=await get(m,hq,m.seed.self);assert.equal(first.items.length,25);assert.equal(first.items[0].receipt.revision,26);assert.equal(first.nextRevision,2);
 const last=await get(m,{...hq,beforeRevision:first.nextRevision},m.seed.self);assert.equal(last.items.length,1);assert.equal(last.items[0].receipt.revision,1);assert.equal(last.nextRevision,null);
 const {command}=await decide(m),q={siteId:m.seed.siteId,access:'self',mode:'detail',caseId:command.caseId};
 const explanation={action:'explain',operationId:f.dayUiId(2002),expectedRevision:1,decisionOperationId:command.operationId,claim:'uncertain',reason:'Synthetic199 self test'};
 const response=await m.respond(api,'POST',JSON.stringify({query:q,command:explanation}),m.seed.self);const receipt=JSON.parse(response.text).data;
 saved.parseDayReviewSavedResult(receipt,q,m.seed.self,{command:explanation,fingerprint:receipt.receipt.commandFingerprint});
 const detail=await get(m,q,m.seed.self);assert.equal(detail.head.revision,2);assert.equal(detail.head.latestSelf.decisionOperationId,command.operationId);assert.equal(detail.head.needsResponse,true);
 assert.equal(m.history.length,26);assert.equal(m.records.size,2);
});
test('199 actual parent read models satisfy their existing parsers without membership or clock mutation',async()=>{
 const m=await createDayReviewBrowserModel();
 for(const view of ['settings','workers']){const reply=await m.respond('http://127.0.0.1/api/merchant-enterprise/attendance/admin?siteId='+m.seed.siteId+'&view='+view,'GET','',m.seed.owner);assert.equal(reply.status,200);}
 const self=JSON.parse((await m.respond('http://127.0.0.1/api/merchant-enterprise/attendance/self?siteId='+m.seed.siteId,'GET','',m.seed.self)).text);
 assert.equal(self.state.sequence,0);assert.equal(self.state.lastEvent,null);assert.equal(m.records.size,0);
 await assert.rejects(m.respond('http://127.0.0.1/api/merchant-enterprise/attendance/self?siteId='+m.seed.siteId,'POST','',m.seed.self));
});
test('199 runner remains inert, finite, memory-only and owns explicit real parent/body cleanup',async()=>{
 assert.deepEqual(dayReviewBrowserLimits,{ttlMs:180000,http:80,api:50,posts:3,groups:8});
 const runner=await readFile(new URL('./attendance-day-review-browser.mjs',import.meta.url),'utf8'),entry=await readFile(new URL('./attendance-day-review-browser-entry.tsx',import.meta.url),'utf8');
 for(const value of ['write:false',"server.listen(0,'127.0.0.1'",'serviceWorkers:\'block\'','acceptDownloads:false','actualAuth:false','actualSql:false',
  "process.argv[2]==='--run-local'",'runAttendanceCleanupSteps','assert(!browser?.isConnected()&&!server?.listening)',"stage='actual_admin_parent_draft_inert'","stage='mobile_close_no_background_retry'"])
  assert(runner.includes(value),value);
 for(const value of ['MerchantAttendanceAdminPanel','MerchantAttendanceSelfPanel','MerchantAttendanceDayReviewLauncher','registerLeaveGuard={register}','isCurrentAuth={current}',
  'canClock={false}','new ReadableStream','config.requester','authValid: value','flushSync'])assert(entry.includes(value),value);
 assert(runner.includes("configure({mode:'isolated',actor:model.seed.other,access:'self'})"));
 assert(!/writeFile|screenshot\(|download\.saveAs|initdb/.test(runner));assert(!runner.includes('memberships'));
 assert(!/merchantAttendanceDayReview\.server|day_review_v1\(/.test(runner));
 const ui=await readFile(new URL('../../src/components/enterprise/MerchantAttendanceDayReviewWorkspace.tsx',import.meta.url),'utf8');
 for(const value of ['本人回应','读取保存历史','读取更早25条历史','读取此核查详情','出勤核查理由','核查此完整排班'])assert(ui.includes(value),value);
 assert(runner.includes("getByRole('combobox',{name:/^本人回应/})"));
 assert(!runner.includes("getByLabel('本人回应'"));
});
