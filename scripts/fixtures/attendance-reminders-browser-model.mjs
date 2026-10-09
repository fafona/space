//201 synthetic HTTP only. Reuse strict old protocol models, never SQL/Auth.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createPeriodEnterpriseModel,periodEnterprisePaths} from './attendance-period-enterprise-browser.mjs';
const require=createRequire(import.meta.url),base='/api/merchant-enterprise/attendance/';
export const reminderBrowserPaths=Object.freeze({reminders:base+'reminders',routing:base+'review-routing',admin:base+'admin',cycle:base+'operational-cycle',
 work:base+'work-arrangements',correction:base+'correction-decisions',revision:base+'revision-decisions',missing:base+'missing',leave:base+'leave',leaveReview:base+'leave-review',
 overview:periodEnterprisePaths.overview,todos:periodEnterprisePaths.todos,operations:periodEnterprisePaths.operations});
export async function createRemindersBrowserModel(){
 const r=require('../../src/lib/merchantAttendanceReminders.ts'),rh=require('../../src/lib/merchantAttendanceRemindersHttp.ts'),rc=require('../../src/lib/merchantAttendanceRemindersClient.ts');
 const routing=require('./attendance-review-routing-model.ts'),rp=require('../../src/lib/merchantAttendanceReviewRouting.ts');
 const work=require('./attendance-work-arrangement-model.ts'),wp=require('../../src/lib/merchantAttendanceWorkArrangement.ts');
 const cycle=require('./attendance-cycle-intent-model.ts'),cp=require('../../src/lib/merchantAttendanceCycleIntent.ts'),cr=require('../../src/lib/merchantAttendanceCycleIntentResult.ts');
 const ap=require('../../src/lib/merchantAttendanceAdmin.ts'),correction=require('../../src/lib/merchantAttendanceCorrectionDecisionClient.ts'),routingClient=require('../../src/lib/merchantAttendanceReviewRoutingClient.ts');
 const parsers={correction:require('../../src/lib/merchantAttendanceCorrectionDecision.ts').parseCorrectionDecisionQuery,
  revision:require('../../src/lib/merchantAttendanceRevisionApprovalResponse.ts').parseRevisionApprovalHttpQuery,
  missing:require('../../src/lib/merchantAttendanceMissing.ts').parseMissingQuery,leave:require('../../src/lib/merchantAttendanceLeave.ts').parseLeaveHttpQuery,
  leaveReview:require('../../src/lib/merchantAttendanceLeaveReview.ts').parseLeaveReviewHttpQuery};
 const cm=await cycle.cycleModel(),enterprise=createPeriodEnterpriseModel(),original=work.workArrangementDetail('owner'),owner=work.workArrangementOwner;
 const families=['work_arrangement','correction','correction_revision','missing','missing_revision','leave'];
 const refs=families.map((family,n)=>family==='work_arrangement'?{family,category:family,requestId:original.requestId,workerId:original.workerId,employeeId:original.employeeId,
  employeeAuthUserId:original.employeeAuthUserId,submittedRevision:1,submittedAt:original.submittedAt,kind:original.kind}:routing.routingRequest(family,120+n));
 const details=refs.map(request=>{const current=routing.routingCapture(request,{assignment:{kind:'owner',authUserId:owner}}),observation=routing.routingObservation(request,current,owner);
  return routing.routingResult({kind:'detail',request,current,observation,canRegister:false,canTakeOver:false},null,owner);});
 const id=n=>`20100000-0000-4000-8000-${String(n).padStart(12,'0')}`,stamp='2026-10-08T14:05:00.000000Z';
 const makeBatch=(batchId,category,targets)=>({batchId,category,windowStart:'2026-10-08T14:00:00.000000Z',windowEnd:'2026-10-08T15:00:00.000000Z',recordedAt:stamp,
  itemCount:targets.length,readAt:null,items:targets.map((target,n)=>({planId:id(100+n),ordinal:n+1,target,observedAt:stamp}))});
 const reviewBatch=makeBatch(id(10),'pending_review',details.map(d=>({kind:'pending_review',family:d.data.request.family,requestId:d.data.request.requestId,
  responsibilityRevision:d.data.current.revision,responsibilityOperationId:d.data.current.operationId})));
 const cycleBatch=makeBatch(id(11),'period_due',[{kind:'period_due',workerId:cm.scope.workerId,intentId:cm.intent.intentId}]);
 const inboxBatch=makeBatch(id(12),'pending_review',[reviewBatch.items[0].target]);
 const seed={review:{siteId:routing.routingSite,owner,batchId:reviewBatch.batchId},cycle:{siteId:cycle.cycleSite,owner:cycle.cycleOwner,batchId:cycleBatch.batchId,intentId:cm.intent.intentId},
  enterprise:enterprise.seed,paths:Object.values(reminderBrowserPaths),slots:{review:rc.attendanceReminderPendingKey(routing.routingSite,owner),cycle:rc.attendanceReminderPendingKey(cycle.cycleSite,cycle.cycleOwner),
   inbox:rc.attendanceReminderPendingKey(enterprise.seed.siteId,enterprise.seed.authUserId),correction:correction.correctionDecisionKey(routing.routingSite,owner),routing:routingClient.reviewRoutingPendingKey(routing.routingSite,owner)}};
 const batches=new Map([[routing.routingSite+':'+owner,reviewBatch],[cycle.cycleSite+':'+cycle.cycleOwner,cycleBatch],[enterprise.seed.siteId+':'+enterprise.seed.authUserId,inboxBatch]]),receipts=new Map();
 let loseNext=false,recovery='valid';
 const reply=(value,extra={})=>({status:200,text:JSON.stringify(value),...extra});
 async function respond(url,method,text,headers={}){
  const u=new URL(url);assert(seed.paths.includes(u.pathname));assert(['GET','POST'].includes(method));
  const token=headers['x-merchant-access-token'],identity=Object.entries(enterprise.seed.tokens).find(([,t])=>t===token)?.[0];
  const actor=headers['x-synthetic-actor']??(identity==='employee'?enterprise.seed.authUserId:identity==='other'?enterprise.seed.otherAuthUserId:identity==='owner'?enterprise.seed.ownerId:null);
  if([reminderBrowserPaths.overview,reminderBrowserPaths.todos,reminderBrowserPaths.operations].includes(u.pathname)){
   assert.equal(method,'GET');const value=enterprise.respond(url,method,text,token);return{status:200,text:value.text,identity};}
  if(u.pathname===reminderBrowserPaths.reminders){
   const pair=method==='POST'?rh.parseAttendanceReminderHttpBodyJson(text):null,read=pair?null:rh.parseAttendanceReminderHttpQuery(url),q=pair?.query??read.query,c=pair?.command??read.expectedCommand;
   const key=q.siteId+':'+actor,batch=batches.get(key),common={protocol:r.ATTENDANCE_REMINDERS_PROTOCOL,siteId:q.siteId,actor:{kind:'auth',authUserId:actor},readAt:stamp};let data,receipt=null;
   assert(batch||identity==='other');
   if(method==='POST'){assert.equal(headers['x-synthetic-enabled']!=='false',true);assert(batch);assert(!receipts.has(c.operationId),'duplicate_POST');
    const fingerprint=await r.attendanceReminderCommandFingerprint(q,actor,c),result=c.action==='mark_read'?{kind:'mark_read',batchId:batch.batchId,readAt:stamp}:
     {kind:'run',status:'completed',checkedCount:0,deliveredCount:0,deferredCount:0,stoppedCount:0,batchIds:[],nextCursor:null};
    if(c.action==='mark_read'){assert.equal(c.batchId,batch.batchId);batch.readAt=stamp;}
    receipt={operationId:c.operationId,action:c.action,actorKind:'auth',actorId:actor,commandFingerprint:fingerprint,recordedAt:stamp,result};receipts.set(c.operationId,{query:q,command:c,receipt});data={kind:'receipt'};
   }else if(q.mode==='recover'){const saved=receipts.get(q.operationId);assert(saved);assert.equal(saved.receipt.actorId,actor);assert.deepEqual(c,saved.command);receipt=recovery==='null'?null:structuredClone(saved.receipt);data={kind:'receipt'};}
   else if(q.mode==='list'){assert.equal(q.cursor,null);const items=batch?[Object.fromEntries(['batchId','category','windowStart','windowEnd','recordedAt','itemCount','readAt'].map(k=>[k,batch[k]]))]:[];data={kind:'list',items,nextCursor:null};}
   else{assert.equal(q.mode,'detail');assert.equal(q.batchId,batch.batchId);data={kind:'batch',batch};}
   const result={...common,data,receipt};await r.parseAttendanceReminderResult(result,q,actor,c);
   const lose=method==='POST'&&loseNext;if(lose)loseNext=false;return{status:200,text:lose?'{"ok":':JSON.stringify({ok:true,data:result}),query:q,action:pair?.command.action,actor};
  }
  assert.equal(method,'GET','original_business_POST_forbidden');assert.equal(text,'');
  if(u.pathname===reminderBrowserPaths.admin){assert([owner,cycle.cycleOwner].includes(actor));const q=ap.parseAttendanceAdminQuery(url);assert.equal(q.view,'settings');assert.equal(q.siteId,actor===owner?routing.routingSite:cycle.cycleSite);
   const value={ok:true,moduleEnabled:true,siteId:q.siteId,view:'settings',version:1,settings:{timeZone:'Europe/Madrid',enabled:true,webClockEnabled:true,webBreakPaid:false},items:[],nextCursor:null,receipt:null};ap.parseAttendanceAdminResult(value,q);return reply(value,{query:q});}
  if(u.pathname===reminderBrowserPaths.routing){assert.equal(actor,owner);const q=rp.parseReviewRoutingHttpQuery(url);assert.equal(q.mode,'detail');const detail=details.find(d=>d.data.request.family===q.family&&d.data.request.requestId===q.requestId);assert(detail);
   await rp.parseReviewRoutingResult(detail,q,actor);return reply({ok:true,data:detail},{query:q});}
  if(u.pathname===reminderBrowserPaths.cycle){assert.equal(actor,cycle.cycleOwner);const q=cp.parseCycleIntentHttpQuery(url);assert.deepEqual(q,cm.query);const result=cm.result({kind:'detail',intent:cm.intent,head:cm.receipt});await cr.parseCycleIntentResult(result,q,actor);return reply({ok:true,data:result},{query:q});}
  if(u.pathname===reminderBrowserPaths.work){assert.equal(actor,owner);const q=wp.parseWorkArrangementHttpQuery(url);assert.equal(q.access,'owner');assert(q.requestId===null||q.requestId===original.requestId);
   const value=work.workArrangementHttp('owner');value.readAt=routing.routingReadAt;if(q.requestId)value.detail=original;wp.parseWorkArrangementResponse(value,q,null,{ownerId:owner});return reply(value,{query:q,positiveOriginal:q.requestId!==null});}
  const kind=Object.keys(parsers).find(k=>reminderBrowserPaths[k]===u.pathname);assert(kind,'unknown_original');assert.equal(actor,owner);assert.equal(typeof parsers[kind],'function','missing_real_query_parser');
  const q=parsers[kind](url),requestId=q.requestId??q.query?.requestId;
  if(kind==='leave'&&q.requestId===null){assert.equal(q.access,'owner');assert.equal(q.siteId,routing.routingSite);
   const lp=require('../../src/lib/merchantAttendanceLeave.ts'),value={ok:true,moduleEnabled:true,protocol:'leave-v1',siteId:q.siteId,access:'owner',actorId:owner,employeeId:null,workerId:null,
    timeZone:'Europe/Madrid',settingsVersion:1,canSubmit:false,items:[],nextCursor:null,detail:null,receipt:null};lp.parseLeaveResponse(value,q,null,owner);return reply(value,{query:q});}
  assert(refs.some(ref=>ref.requestId===requestId));
  return{status:503,text:JSON.stringify({ok:false,error:'attendance_unavailable'}),query:q,safeDenial:true};
 }
 return{seed,refs,details,reviewBatch,cycleBatch,inboxBatch,enterprise,cm,receipts,respond,lose:()=>{loseNext=true;},recovery:value=>{assert(['valid','null'].includes(value));recovery=value;}};
}
