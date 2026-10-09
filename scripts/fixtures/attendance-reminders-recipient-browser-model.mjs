//201 two recipient navigation groups. Strict synthetic API, never SQL/Auth.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),base='/api/merchant-enterprise/attendance/';
export const recipientReminderPaths=Object.freeze({overview:'/api/merchant-enterprise/overview',reminders:base+'reminders',self:base+'operational-punch-self',legacySelf:base+'self',correction:base+'correction-delegation'});
export async function createRecipientReminderModel(){
 const r=require('../../src/lib/merchantAttendanceReminders.ts'),rh=require('../../src/lib/merchantAttendanceRemindersHttp.ts'),rc=require('../../src/lib/merchantAttendanceRemindersClient.ts');
 const p=require('../../src/lib/merchantAttendanceOperationalPunch.ts'),pf=require('../../src/lib/merchantAttendanceOperationalPunchTestFixtures.ts'),pu=require('../../src/lib/merchantAttendanceOperationalPunchUi.ts');
 const sn=require('../../src/lib/merchantAttendanceRemindersSelfNavigation.ts'),sp=require('../../src/lib/merchantAttendanceSelf.ts');
 const c=require('../../src/lib/merchantAttendanceCorrectionDelegation.ts'),cf=require('../../src/lib/merchantAttendanceCorrectionDelegationTestFixtures.ts'),cc=require('../../src/lib/merchantAttendanceCorrectionDelegationClient.ts');
 const f=await pf.punchStartFixture(true),siteId=pf.punchSite,id=n=>`20110000-0000-4000-8000-${String(n).padStart(12,'0')}`,stamp='2026-10-08T14:05:00.000000Z';
 const currentSession={...f.result,operation:null,clock:{...f.result.clock,receipt:null},canBreak:true,canFinish:true};
 await p.parseOperationalPunchResponse({ok:true,data:currentSession},{siteId,channel:'self',authUserId:pf.punchId(3),query:{mode:'prepare'},command:null,write:false},pu.operationalPunchUiErrors('self'));
 const grant=cf.correctionDelegationGrant(),original=cf.correctionDelegationDetail();
 const correctSelf={kind:'open_session',workerId:pf.punchId(1),startEventId:pf.punchId(21)},wrongSelf={...correctSelf,startEventId:id(91)};
 const correction={kind:'pending_review',family:'correction',requestId:original.requestId,responsibilityRevision:1,responsibilityOperationId:id(92)};
 const batch=(batchId,category,target)=>({batchId,category,windowStart:'2026-10-08T14:00:00.000000Z',windowEnd:'2026-10-08T15:00:00.000000Z',recordedAt:stamp,itemCount:1,readAt:null,
  items:[{planId:id(category==='open_session'?3:4),ordinal:1,target,observedAt:stamp}]});
 const selfBatch=batch(id(1),'open_session',wrongSelf),delegateBatch=batch(id(2),'pending_review',correction);
 const seed={siteId,paths:Object.values(recipientReminderPaths),self:{employeeId:pf.punchId(2),authUserId:pf.punchId(3),workerId:pf.punchId(1),startEventId:pf.punchId(21),batchId:selfBatch.batchId},
  delegate:{employeeId:cf.correctionDelegationEmployee,authUserId:cf.correctionDelegationAuth,requestId:original.requestId,grantId:grant.grantId,batchId:delegateBatch.batchId},
  other:{employeeId:id(80),authUserId:id(81)},tokens:{self:'synthetic201-self-recipient',delegate:'synthetic201-correction-recipient',other:'synthetic201-other-recipient'},
  slots:{self:rc.attendanceReminderPendingKey(siteId,pf.punchId(3)),selfBlocked:sn.reminderSelfNavigationPendingKeys(siteId,pf.punchId(3),pf.punchId(2))[0],
   delegate:rc.attendanceReminderPendingKey(siteId,cf.correctionDelegationAuth),correction:cc.correctionDelegationPendingKey(siteId,'delegate',cf.correctionDelegationEmployee)}};
 const actor=identity=>({type:'employee',id:seed[identity].employeeId,siteId,displayName:`Synthetic201 ${identity}`,email:`synthetic201-${identity}@example.test`,roleId:id(82),
  permissions:identity==='self'?['enterprise.view','attendance.self.view','attendance.self.clock']:identity==='delegate'?['enterprise.view','attendance.correction.review']:['enterprise.view'],accessScope:'all',allowedBoardIds:[]});
 async function respond(url,method,text,headers={}){
  const u=new URL(url),identity=Object.entries(seed.tokens).find(([,token])=>token===headers['x-merchant-access-token'])?.[0];
  assert(identity,'unknown_synthetic_identity');assert(seed.paths.includes(u.pathname),'unknown_path');assert.equal(method,'GET','recipient_business_POST_forbidden');assert.equal(text,'');
  let body,q=null;
  if(u.pathname===recipientReminderPaths.overview){assert.deepEqual([...u.searchParams],[['siteId',siteId]]);body={ok:true,actor:actor(identity),currentAuthUserId:seed[identity].authUserId,snapshot:{roles:[],employees:[],boards:[],columns:[],tasks:[]},needsBootstrap:false};}
  else if(u.pathname===recipientReminderPaths.reminders){assert(identity!=='other');const parsed=rh.parseAttendanceReminderHttpQuery(url);assert.equal(parsed.expectedCommand,null);q=parsed.query;
   assert.equal(q.siteId,siteId);assert(['list','detail'].includes(q.mode));const b=identity==='self'?selfBatch:delegateBatch;
   const common={protocol:r.ATTENDANCE_REMINDERS_PROTOCOL,siteId,actor:{kind:'auth',authUserId:seed[identity].authUserId},readAt:stamp,receipt:null};
   if(q.mode==='list'){assert.equal(q.cursor,null);body={...common,data:{kind:'list',items:[Object.fromEntries(['batchId','category','windowStart','windowEnd','recordedAt','itemCount','readAt'].map(k=>[k,b[k]]))],nextCursor:null}};}
   else{assert.equal(q.batchId,b.batchId);body={...common,data:{kind:'batch',batch:b}};}
   await r.parseAttendanceReminderResult(body,q,seed[identity].authUserId);body={ok:true,data:body};
  }else if(u.pathname===recipientReminderPaths.self){assert.equal(identity,'self');assert.deepEqual([...u.searchParams],[['siteId',siteId],['mode','prepare']]);q=p.parseOperationalPunchQuery({mode:'prepare'});
   await p.parseOperationalPunchResponse({ok:true,data:currentSession},{siteId,channel:'self',authUserId:seed.self.authUserId,query:q,command:null,write:false},pu.operationalPunchUiErrors('self'));body={ok:true,data:currentSession};
  }else if(u.pathname===recipientReminderPaths.legacySelf){assert.equal(identity,'self');q=sp.parseAttendanceSelfQuery(url);assert.equal(q.siteId,siteId);assert.equal(q.operationId,null);
   body={ok:true,moduleEnabled:true,...currentSession.clock};sp.parseAttendanceSelfResult(body,{siteId,command:null,operationId:null});
  }else{assert.equal(u.pathname,recipientReminderPaths.correction);assert.equal(identity,'delegate');q=c.parseCorrectionDelegationHttpQuery(url);assert.equal(q.siteId,siteId);assert.equal(q.access,'delegate');
   assert(['grants','list','detail'].includes(q.mode));assert.equal(q.afterId,null);assert.equal(q.beforeAt,null);assert.equal(q.beforeId,null);
   if(q.mode!=='grants')assert.equal(q.grantId,grant.grantId);if(q.mode==='detail')assert.equal(q.requestId,original.requestId);
   body=cf.correctionDelegationHttp(q);c.parseCorrectionDelegationResponse(body,q,{authUserId:seed.delegate.authUserId,employeeId:seed.delegate.employeeId},null);
  }
  return{status:200,text:JSON.stringify(body),identity,query:q,actor:seed[identity].authUserId};
 }
 return{seed,actor,respond,currentSession,grant,original,selfBatch,delegateBatch,pointer:valid=>{assert.equal(typeof valid,'boolean');selfBatch.items[0].target=valid?correctSelf:wrongSelf;}};
}
