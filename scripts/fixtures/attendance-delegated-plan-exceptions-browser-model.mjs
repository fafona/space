// Synthetic transport only. No SQL, credentials, real grants or network work.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),p=require('../../src/lib/merchantAttendanceDelegatedPlanExceptions.ts'),
 m=require('../../src/lib/merchantAttendanceManagementDelegation.ts'),
 {attendanceManagementPendingKey}=require('../../src/lib/merchantAttendanceManagementDelegatedClient.ts'),
 {delegatedPlanExceptionsModel}=require('./attendance-delegated-plan-exceptions-model.ts');
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0'),clone=structuredClone;
export const delegatedPlanExceptionsBrowserPaths=Object.freeze({management:m.MANAGEMENT_DELEGATION_API,exceptions:p.DELEGATED_PLAN_EXCEPTIONS_API});
export function createDelegatedPlanExceptionsBrowserModel(){
 const base=delegatedPlanExceptionsModel(),owner=id(209010),employeeId=id(209011),other=id(209012),saved=new Map(),writes=[];
 let eligible=true,recovery='valid';
 const seed={siteId:base.query.siteId,owner,delegate:base.actor,other,employeeId,query:base.query,scope:base.context.scope,
  paths:Object.values(delegatedPlanExceptionsBrowserPaths),slots:{owner:attendanceManagementPendingKey(base.query.siteId,owner),delegate:attendanceManagementPendingKey(base.query.siteId,base.actor)}};
 const grant={grantId:base.query.grantId,revision:1,status:'granted',ownerId:owner,delegate:{employeeId,authUserId:base.actor,generation:1},delegatedAction:'plan_exception_decide',
  capability:'attendance.plan_exception.review',scope:base.context.scope,targetGeneration:1,validFrom:'2026-10-09T10:00:00.000000Z',validUntil:'2026-10-10T12:00:00.000000Z',
  reason:'Synthetic209 exact formal grant',grantedAt:'2026-10-09T11:00:00.000000Z',revocation:null,authorityCurrent:true};
 const baseResult=(protocol,actor)=>({protocol,siteId:seed.siteId,actorId:actor,readAt:base.context.readAt});
 return{seed,writes,eligible:value=>{assert.equal(typeof value,'boolean');eligible=value;},recovery:value=>{assert(['valid','null','wrong-sha'].includes(value));recovery=value;},
 async respond(input,method,text,headers){
  const url=new URL(input),actor=headers['x-synthetic-actor'];assert([owner,base.actor,other].includes(actor));assert(['GET','POST'].includes(method));
  const domain=url.pathname===delegatedPlanExceptionsBrowserPaths.management?'management':url.pathname===delegatedPlanExceptionsBrowserPaths.exceptions?'plan-exceptions':assert.fail('unknown_synthetic_path');
  let query,command=null,data;
  if(domain==='management'){
   assert.equal(actor,owner,'synthetic_management_requires_owner');
   if(method==='POST'){({query,command}=m.parseManagementDelegationBody(p.parseDelegatedPlanExceptionsJson(text,false)));assert.equal(command.action,'grant');assert.equal(command.delegatedAction,'plan_exception_decide');
    data={...baseResult(m.MANAGEMENT_DELEGATION_PROTOCOL,actor),kind:'receipt',receipt:{operationId:command.operationId,actorId:actor,action:command.action,grantId:command.operationId,revision:1,
     commandFingerprint:createHash('sha256').update(m.managementDelegationFingerprintText(seed.siteId,actor,command)).digest('hex'),recordedAt:base.context.readAt}};
    saved.set(command.operationId,clone(data));writes.push({domain,actor,query,command});
   }else{query=m.parseManagementDelegationHttpQuery(url.href);
    if(query.mode==='recover')data=clone(saved.get(query.operationId)??{...baseResult(m.MANAGEMENT_DELEGATION_PROTOCOL,actor),kind:'receipt',receipt:null});
    else if(query.mode==='list'){assert.equal(query.delegatedAction,'plan_exception_decide');data={...baseResult(m.MANAGEMENT_DELEGATION_PROTOCOL,actor),kind:'list',canGrant:true,items:query.afterId?[]:[clone(grant)],nextId:null};}
    else{assert.equal(query.mode,'detail');assert.equal(query.grantId,grant.grantId);data={...baseResult(m.MANAGEMENT_DELEGATION_PROTOCOL,actor),kind:'detail',canGrant:true,item:clone(grant)};}
   }
   await m.parseManagementDelegationResult(data,query,actor,command);
  }else{
   assert.equal(actor,base.actor,'synthetic_formal_requires_actual_delegate');
   if(method==='POST'){({query,command}=p.parseDelegatedPlanExceptionsBody(p.parseDelegatedPlanExceptionsJson(text,false)));assert.deepEqual(query,base.query);
    const fixture=delegatedPlanExceptionsModel(eligible);p.delegatedPlanExceptionsCommandForContext(fixture.context,command);
    data=clone(fixture.receipt);data.receipt.operationId=command.operationId;data.receipt.reference.caseId=command.operationId;data.receipt.reference.decisionRevision=command.expectedRevision+1;
    data.receipt.commandFingerprint=createHash('sha256').update(p.delegatedPlanExceptionsFingerprintText(query,actor,command)).digest('hex');saved.set(command.operationId,clone(data));writes.push({domain,actor,query,command});
   }else{const entries=[...url.searchParams];assert(!url.hash&&entries.every(([key],i)=>entries.findIndex(([other])=>key===other)===i));query=p.parseDelegatedPlanExceptionsQuery(Object.fromEntries(entries));
    if(query.mode==='context'){assert.deepEqual(query,base.query);data=delegatedPlanExceptionsModel(eligible).context;}
    else{data=clone(saved.get(query.operationId)??{...baseResult(p.DELEGATED_PLAN_EXCEPTIONS_PROTOCOL,actor),kind:'receipt',receipt:null});
     if(recovery==='null')data.receipt=null;else if(recovery==='wrong-sha'&&data.receipt)data.receipt.commandFingerprint='f'.repeat(64);}
   }
   if(recovery!=='wrong-sha'||query.mode!=='recover')await p.parseDelegatedPlanExceptionsResult(data,query,actor,command);
  }
  return{status:200,text:JSON.stringify({ok:true,data}),query,command,actor,domain};
 }};
}
