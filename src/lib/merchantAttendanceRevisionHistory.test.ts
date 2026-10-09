import assert from "node:assert/strict";
import test from "node:test";
import {parseRevisionHistoryHttpQuery,parseRevisionHistoryQuery,parseRevisionHistoryResult,parseRevisionHistoryResponse,revisionHistoryQueryString} from "./merchantAttendanceRevisionHistory";
import {executeRevisionHistory} from "./merchantAttendanceRevisionHistory.server";
import {AttendanceRevisionHistoryClient} from "./merchantAttendanceRevisionHistoryClient";
import {historyOwnerQuery as ownerQ,historySelfQuery as selfQ,historyValue,historyItem,historyModel,historyEmployee,historyOwner,historyAsOf,historySite} from "../../scripts/fixtures/attendance-revision-history-model";
import {correctionId as id} from "../../scripts/fixtures/attendance-correction-model";
test("history scope/query fields are exact and duplicate, forged identity, invalid scope or unbounded range rejected",()=>{
  for(const q of [ownerQ,selfQ])assert.deepEqual(parseRevisionHistoryHttpQuery('https://local.invalid/?'+revisionHistoryQueryString(q)),q);
  for(const patch of [{authUserId:id(99)},{moduleEnabled:true},{scope:'root-history'},{status:'pending'},{toAt:'2026-11-01T00:00:00.000000Z'},{fromAt:'2026-09-31T00:00:00.000000Z'},{asOf:historyAsOf,cursorAt:historyAsOf},{cursorAt:'2026-09-30T13:00:00.000000Z',cursorId:id(77)}])assert.throws(()=>parseRevisionHistoryQuery({...ownerQ,...patch}));
  for(const patch of [{fromAt:'2026-09-01T00:00:00.000000Z'},{expectedWorkerId:''},{rootRequestId:null},{scope:'submission-period'}])assert.throws(()=>parseRevisionHistoryQuery({...selfQ,...patch}));
  assert.throws(()=>parseRevisionHistoryHttpQuery('https://local.invalid/?'+revisionHistoryQueryString(ownerQ)+'&siteId='+historySite));
});
test("all four true request states are explicit; impossible terminal summaries and authority/capability fields rejected",()=>{
  for(const status of ['submitted','approved','rejected','withdrawn'] as const){const r=historyValue(ownerQ,[historyItem(0,status)]);assert.equal(parseRevisionHistoryResult(r,ownerQ).items[0].status,status);}
  const v=historyValue(ownerQ),item=v.items[0];for(const patch of [{status:'approved'},{status:'withdrawn',decisionOperationId:id(88)},{closedAt:historyAsOf},{submittedAt:'2026-10-02T00:00:00.000000Z'},{proposedEndAt:item.proposedStartAt},{submittedRevision:0},{workerName:''},{requestId:item.rootRequestId},{canApprove:true}])assert.throws(()=>parseRevisionHistoryResult({...v,items:[{...item,...patch}]},ownerQ));
  for(const patch of [{readOnly:false},{protocol:'revision-history-v0'},{scanned:51},{scanned:0},{employeeId:historyEmployee},{current:{}},{items:[item,item]}])assert.throws(()=>parseRevisionHistoryResult({...v,...patch},ownerQ));
});
test("snapshot bounds and strictly descending cursor allow empty intermediate pages but never looping cursors",()=>{
  const r=historyValue(ownerQ,[historyItem(0),historyItem(1)]);assert.equal(parseRevisionHistoryResult(r,ownerQ).items.length,2);
  assert.throws(()=>parseRevisionHistoryResult({...r,items:[...r.items].reverse()},ownerQ));
  const cursor={recordedAt:historyItem(49).submittedAt,requestId:historyItem(49).requestId},q={...ownerQ,asOf:r.asOf,cursorAt:cursor.recordedAt,cursorId:cursor.requestId};
  assert.equal(parseRevisionHistoryResult({...r,scanned:50,items:[],nextCursor:cursor},ownerQ).items.length,0);
  assert.throws(()=>parseRevisionHistoryResult({...r,scanned:50,items:[],nextCursor:cursor},q));assert.throws(()=>parseRevisionHistoryResult({...r,asOf:'2026-10-01T15:01:00.000000Z'},q));
  assert.throws(()=>parseRevisionHistoryResult({...r,scanned:49,nextCursor:cursor},ownerQ));
});
test("self list ties every item to authenticated employee, expected worker and requested root; HTTP extras cannot leak",()=>{
  const r=historyValue(selfQ),item=r.items[0];assert.equal(parseRevisionHistoryResponse({ok:true,...r,moduleEnabled:false},selfQ).moduleEnabled,false);
  for(const patch of [{employeeId:id(99)},{workerId:id(99)},{rootRequestId:id(99)}])assert.throws(()=>parseRevisionHistoryResult({...r,items:[{...item,...patch}]},selfQ));
  for(const patch of [{ok:false},{moduleEnabled:'true'},{secret:'no'},{approvalAvailable:true}])assert.throws(()=>parseRevisionHistoryResponse({ok:true,...r,moduleEnabled:true,...patch},selfQ));
});
test("executor sends authenticated actor plus parsed read-only scope and masks private or malformed service responses",async()=>{
  const calls:unknown[]=[];const result=await executeRevisionHistory({query:ownerQ,authUserId:historyOwner},{rpc:async(name,args)=>{calls.push({name,args});return {data:historyValue(ownerQ),error:null};}});
  assert.equal(result.readOnly,true);const {siteId,...query}=ownerQ;assert.deepEqual(calls,[{name:'faolla_attendance_revision_history_v1',args:{p_site_id:siteId,p_auth_user_id:historyOwner,p_query:query}}]);
  for(const message of ['private_table','attendance_worker_changed'])await assert.rejects(executeRevisionHistory({query:ownerQ,authUserId:historyOwner},{rpc:async()=>({data:null,error:{message}})}),new RegExp(message==='private_table'?'attendance_unavailable':message));
  await assert.rejects(executeRevisionHistory({query:ownerQ,authUserId:historyOwner},{rpc:async()=>({data:{...historyValue(ownerQ),canApprove:true},error:null})}),/attendance_unavailable/);
});
function setup(access:'owner'|'self'='owner'){
  const model=historyModel(),options={siteId:historySite,actorId:access==='owner'?historyOwner:historyEmployee,access,apiFetch:model.apiFetch};return {model,options,client:new AttendanceRevisionHistoryClient(options)};
}
test("client pages 61 records once with same cutoff, sparse page continues and never sends POST",async()=>{
  const s=setup();s.model.records(Array.from({length:61},(_,n)=>historyItem(n,n<50?'withdrawn':'approved')));
  await s.client.initialize({...ownerQ,status:'approved'});let r=s.client.getSnapshot().result!;assert.equal(r.items.length,0);assert.equal(r.scanned,50);assert(r.nextCursor);
  const stamp=r.asOf;await Promise.all([s.client.next(),s.client.next()]);r=s.client.getSnapshot().result!;assert.equal(r.items.length,11);assert.equal(r.asOf,stamp);assert.equal(r.nextCursor,null);assert.equal(s.client.getSnapshot().page,2);
  assert.equal(s.model.calls.length,2);assert(s.model.calls.every(c=>c.method==='GET'));s.client.pause();
});
test("refresh discards cursor and cutoff, while scope/status changes start at page one",async()=>{
  const s=setup();s.model.records(Array.from({length:52},(_,n)=>historyItem(n)));await s.client.initialize(ownerQ);await s.client.next();s.model.now('2026-10-01T15:01:00.000000Z');await s.client.refresh();
  const state=s.client.getSnapshot();assert.equal(state.page,1);assert.equal(state.query!.asOf,null);assert.equal(state.query!.cursorAt,null);assert.equal(state.result!.asOf,'2026-10-01T15:01:00.000000Z');
  await s.client.initialize({...ownerQ,status:'rejected'});assert.equal(s.client.getSnapshot().result!.items.length,0);assert.equal(s.client.getSnapshot().page,1);s.client.pause();
});
test("revoked access hides earlier page and prevents blind next, self identity mismatch hides summaries",async()=>{
  for(const access of ['owner','self'] as const){const s=setup(access),q=access==='owner'?ownerQ:selfQ;s.model.records(Array.from({length:52},(_,n)=>historyItem(n)));await s.client.initialize(q);s.model.mode(access==='owner'?'denied':'wrong_employee');await s.client.next();
    assert.equal(s.client.getSnapshot().phase,'blocked');assert.equal(s.client.getSnapshot().result,null);const count=s.model.calls.length;await s.client.next();assert.equal(s.model.calls.length,count);s.client.pause();}
});
test("paused history stays readable but invalid scopes never reach network",async()=>{
  const s=setup();s.model.mode('paused');await s.client.initialize(ownerQ);assert.equal(s.client.getSnapshot().result!.moduleEnabled,false);
  const count=s.model.calls.length;await s.client.initialize(selfQ);assert.equal(s.client.getSnapshot().phase,'blocked');assert.equal(s.model.calls.length,count);await s.client.initialize({...ownerQ,siteId:'99990002'});assert.equal(s.model.calls.length,count);s.client.pause();
});
test("hidden or replaced list requests cannot repopulate rows from a late response",{timeout:5000},async()=>{
  const s=setup();let release!:()=>void,entered!:()=>void;const held=new Promise<void>(r=>release=r),started=new Promise<void>(r=>entered=r);
  s.options.apiFetch=async(path,init)=>{const r=await s.model.apiFetch(path,init);entered();await held;return r;};const read=s.client.initialize(ownerQ);await started;s.client.pause();release();await read;assert.equal(s.client.getSnapshot().result,null);
  s.options.apiFetch=s.model.apiFetch;await s.client.refresh();assert.equal(s.client.getSnapshot().phase,'ready');s.client.pause();
});
test("corrupt success or network failure clears old rows without pretending empty success",async()=>{
  for(const mode of ['offline','corrupt']){const s=setup();await s.client.initialize(ownerQ);s.model.mode(mode);await s.client.refresh();assert.equal(s.client.getSnapshot().phase,'blocked');assert.equal(s.client.getSnapshot().result,null);s.client.pause();}
});
