// Pure oracle tests use fabricated objects. They do not claim SQL or browser success.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {assertLeaveAccountSwitchPending,assertLeaveAccountSwitchIsolation,assertLeaveAccountSwitchEvidence} from './merchant-attendance-leave-account-switch-checks.mjs';

const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const site='99990001',authUserId=id(1),otherActorId=id(2),ownerId=id(99),employeeId=id(101),workerId=id(201);
const leavePath='/api/merchant-enterprise/attendance/leave',noticePath=leavePath+'-notifications';
const submissionId=id(501),approvalId=id(502),reason='Synthetic original A reason';
const startAt='2026-10-06T08:00:00.000Z',endAt='2026-10-06T16:00:00.000Z';
const expected={kind:'leave',site,actorId:authUserId,employeeId,workerId,startAt,endAt,reason,settingsVersion:1,timeZone:'UTC'};
const command=()=>({action:'submit',operationId:submissionId,reason,expectedWorkerId:workerId,expectedSettingsVersion:1,timeZone:'UTC',startAt,endAt});
const pending=()=>({siteId:site,access:'self',actorId:authUserId,employeeId,command:command()});
const noticePending=()=>({siteId:site,actorId:authUserId,employeeId,workerId,notificationId:approvalId});

function evidence(){
  const approvedCommand={action:'approve',operationId:approvalId,requestId:submissionId,expectedRevision:1,reason:'Synthetic explicit approval'};
  const submittedAt='2026-10-04T10:00:00.123456Z',decidedAt='2026-10-04T10:01:00.654321Z',readAt='2026-10-04T10:02:00.112233Z';
  const summary={requestId:submissionId,workerName:'Synthetic A',startAt,endAt,timeZone:'UTC',submittedAt,revision:1,status:'submitted'};
  const approvedSummary={...summary,revision:2,status:'approved'};
  const facts={requests:[{merchant_id:site,request_id:submissionId,worker_id:workerId,employee_id:employeeId,actor_auth_user_id:authUserId,
    worker_name:'Synthetic A',time_zone:'UTC',start_at:startAt,end_at:endAt,submitted_at:submittedAt,reason}],
    entries:[{merchant_id:site,operation_id:submissionId,request_id:submissionId,revision:1,action:'submit',actor_auth_user_id:authUserId,
      command:command(),snapshot:summary,recorded_at:submittedAt},
    {merchant_id:site,operation_id:approvalId,request_id:submissionId,revision:2,action:'approve',actor_auth_user_id:ownerId,
      command:approvedCommand,snapshot:approvedSummary,recorded_at:decidedAt}],
    notifications:[{merchant_id:site,notification_id:approvalId,request_id:submissionId,worker_id:workerId,employee_id:employeeId,
      recipient_auth_user_id:authUserId,revision:2,action:'approve',decided_at:decidedAt}],
    reads:[{merchant_id:site,notification_id:approvalId,worker_id:workerId,employee_id:employeeId,recipient_auth_user_id:authUserId,read_at:readAt}]};
  const commits=[{actorId:authUserId,path:leavePath,input:{query:{siteId:site,access:'self',requestId:null},command:command()},
    body:{ok:true,siteId:site,actorId:authUserId,employeeId,workerId,receipt:{command:command(),item:structuredClone(summary),requestId:submissionId,revision:1}}},
  {actorId:ownerId,path:leavePath,input:{query:{siteId:site,access:'owner',requestId:submissionId},command:structuredClone(approvedCommand)},
    body:{ok:true,siteId:site,actorId:ownerId,receipt:{command:structuredClone(approvedCommand),item:structuredClone(approvedSummary),requestId:submissionId,revision:2}}},
  {actorId:authUserId,path:noticePath,input:{query:{siteId:site,expectedEmployeeId:employeeId,expectedWorkerId:workerId,notificationId:approvalId},command:{action:'mark_read',notificationId:approvalId}},
    body:{ok:true,siteId:site,actorId:authUserId,employeeId,workerId,detail:{notificationId:approvalId,requestId:submissionId,readAt}}}];
  const writes=[{actor:'employee',actorId:authUserId,path:leavePath,method:'POST',status:200,action:'submit',operationId:submissionId},
    {actor:'owner',actorId:ownerId,path:leavePath,method:'POST',status:200,action:'approve',operationId:approvalId},
    {actor:'employee',actorId:authUserId,path:noticePath,method:'POST',status:200,action:'mark_read',notificationId:approvalId}];
  return {facts,commits,writes,site,employeeId,workerId,authUserId,ownerId,leavePath,noticePath,submissionId,approvalId,marked:true};
}

function isolation(){
  const before={leaveA:JSON.stringify(pending()),leaveB:null,noticeA:JSON.stringify(noticePending()),noticeB:null};
  return {before,after:{...before},bodyText:'Synthetic B own empty list',otherActorId,otherEmployeeId:id(102),otherWorkerId:id(202),
    requests:[{path:leavePath,method:'GET',status:200,actorId:otherActorId,operationId:null,requestId:null},
      {path:noticePath,method:'GET',status:200,actorId:otherActorId,notificationId:null,expectedEmployeeId:id(102),expectedWorkerId:null}],
    forbidden:[reason,submissionId,approvalId],leavePath,noticePath};
}

test('submission pending is bound to distinct Auth/employee/worker and the complete original form command',()=>{
  assert.deepEqual(assertLeaveAccountSwitchPending(JSON.stringify(pending()),expected),command());
  for(const patch of [{siteId:'99990002'},{actorId:otherActorId},{employeeId:authUserId},{employeeId:id(102)},{access:'owner'},
    {token:'must-not-be-stored'},{command:{...command(),operationId:'not-a-uuid'}},{command:{...command(),expectedWorkerId:id(202)}},
    {command:{...command(),expectedSettingsVersion:2}},{command:{...command(),timeZone:'Europe/Madrid'}},
    {command:{...command(),startAt:endAt}},{command:{...command(),reason:'Substituted'}},{command:{...command(),extra:true}}]){
    assert.throws(()=>assertLeaveAccountSwitchPending(JSON.stringify({...pending(),...patch}),expected));
  }
  for(const raw of [null,'','null','[]','{','x'.repeat(8193)])assert.throws(()=>assertLeaveAccountSwitchPending(raw,expected));
});

test('notification pending rejects cross-account, cross-worker and replacement notification identities',()=>{
  const options={kind:'notice',site,actorId:authUserId,employeeId,workerId,notificationId:approvalId};
  assert.deepEqual(assertLeaveAccountSwitchPending(JSON.stringify(noticePending()),options),noticePending());
  for(const patch of [{actorId:otherActorId},{employeeId:id(102)},{workerId:id(202)},{notificationId:submissionId},
    {siteId:'99990002'},{command:{action:'mark_read'}},{token:'private'}])
    assert.throws(()=>assertLeaveAccountSwitchPending(JSON.stringify({...noticePending(),...patch}),options));
  assert.throws(()=>assertLeaveAccountSwitchPending(' '.repeat(2049),options));
});

test('pending isolation requires byte equality, own successful reads and no foreign DOM/query identifiers',()=>{
  assert.doesNotThrow(()=>assertLeaveAccountSwitchIsolation(isolation()));
  for(const mutate of [x=>x.after.leaveA=null,x=>x.after.noticeA=null,x=>x.after.leaveB=x.before.leaveA,
    x=>x.after.noticeB=x.before.noticeA,x=>x.after.leaveA=JSON.stringify(JSON.parse(x.before.leaveA),null,1),
    x=>x.requests=[],x=>x.requests[0].status=403,x=>x.requests[0].actorId=authUserId,x=>x.requests[0].method='POST',
    x=>x.requests[0].operationId=submissionId,x=>x.requests[0].requestId=submissionId,x=>x.requests[1].notificationId=approvalId,
    x=>x.requests[1].expectedEmployeeId=employeeId,x=>x.requests[1].expectedWorkerId=workerId,
    x=>x.bodyText+=' '+reason,x=>x.bodyText+=' '+submissionId,x=>x.bodyText+=' '+approvalId]){
    const input=isolation();mutate(input);assert.throws(()=>assertLeaveAccountSwitchIsolation(input));
  }
});

test('evidence links each SQL fact to independently captured request/receipt/principal and supports all three stages',()=>{
  assert.doesNotThrow(()=>assertLeaveAccountSwitchEvidence(evidence()));
  const approved=evidence();approved.marked=false;approved.facts.reads=[];approved.commits.pop();approved.writes.pop();
  assert.doesNotThrow(()=>assertLeaveAccountSwitchEvidence(approved));
  approved.approvalId=undefined;approved.facts.notifications=[];approved.facts.entries.pop();approved.commits.pop();approved.writes.pop();
  assert.doesNotThrow(()=>assertLeaveAccountSwitchEvidence(approved));
});

test('evidence rejects missing/extra SQL rows, extra POSTs and counterfeit browser principals',()=>{
  for(const mutate of [x=>x.facts.requests=[],x=>x.facts.requests.push(structuredClone(x.facts.requests[0])),
    x=>x.facts.entries.pop(),x=>x.facts.entries.reverse(),x=>x.facts.notifications=[],x=>x.facts.reads=[],
    x=>x.facts.reads.push(structuredClone(x.facts.reads[0])),x=>x.commits.pop(),x=>x.writes.push(structuredClone(x.writes[2])),
    x=>x.commits[0].actorId=otherActorId,x=>x.writes[2].actorId=otherActorId,x=>x.writes[0].actorId=employeeId,
    x=>x.commits[1].body.actorId=authUserId,x=>x.writes[1].status=403,x=>x.writes[1].path=noticePath]){
    const input=evidence();mutate(input);assert.throws(()=>assertLeaveAccountSwitchEvidence(input));
  }
});

test('evidence rejects crossed SQL identity, changed immutable command/snapshot, wrong original IDs and read timestamp drift',()=>{
  for(const mutate of [x=>x.facts.requests[0].actor_auth_user_id=otherActorId,x=>x.facts.requests[0].employee_id=id(102),
    x=>x.facts.requests[0].worker_id=id(202),x=>x.facts.requests[0].reason='Changed',x=>x.facts.requests[0].time_zone='Europe/Madrid',
    x=>x.facts.entries[0].command.reason='Changed',x=>x.facts.entries[0].snapshot.status='approved',
    x=>x.facts.entries[1].actor_auth_user_id=authUserId,x=>x.facts.entries[1].operation_id=id(999),
    x=>x.facts.notifications[0].recipient_auth_user_id=otherActorId,x=>x.facts.notifications[0].employee_id=id(102),
    x=>x.facts.notifications[0].worker_id=id(202),x=>x.facts.notifications[0].notification_id=submissionId,
    x=>x.facts.notifications[0].decided_at='2026-10-04T10:01:00.654320Z',x=>x.facts.reads[0].recipient_auth_user_id=otherActorId,
    x=>x.facts.reads[0].read_at='2026-10-04T10:02:00.112232Z',x=>x.commits[2].input.query.expectedWorkerId=id(202),
    x=>x.commits[2].input.command.notificationId=id(999),x=>x.commits[2].body.detail.requestId=id(999),
    x=>x.commits[0].body.receipt.command.operationId=id(999),x=>x.commits[1].body.receipt.revision=1]){
    const input=evidence();mutate(input);assert.throws(()=>assertLeaveAccountSwitchEvidence(input));
  }
});

test('SQL/API timestamp equality preserves six digits across offsets, never merely millisecond rounding',()=>{
  const input=evidence();input.facts.requests[0].submitted_at='2026-10-04T12:00:00.123456+02:00';
  input.facts.entries[0].recorded_at='2026-10-04T05:00:00.123456-05:00';
  input.facts.notifications[0].decided_at='2026-10-04T15:31:00.654321+05:30';
  input.facts.reads[0].read_at='2026-10-04T12:02:00.112233+02:00';
  assert.doesNotThrow(()=>assertLeaveAccountSwitchEvidence(input));
  input.facts.reads[0].read_at='2026-10-04T12:02:00.112233';
  assert.throws(()=>assertLeaveAccountSwitchEvidence(input),/invalid_timestamp/);
});

test('workflow has actual shell SDK actions, single sentinel setup and no stored intent injection or direct business probes',()=>{
  const source=readFileSync(new URL('./merchant-attendance-leave-account-switch-checks.mjs',import.meta.url),'utf8');
  assert.match(source,/name:'退出员工登录'/);assert.match(source,/name:'登录企业工作台'/);assert.match(source,/name:'登录并选择企业'/);
  assert.match(source,/performance\.timeOrigin/);assert.match(source,/await release\(markGate\)/);assert.match(source,/await release\(recoveryGate\)/);
  assert(source.indexOf('await release(markGate)')<source.indexOf('await release(recoveryGate)'));
  assert.equal((source.match(/sessionStorage\.setItem/g)??[]).length,2);
  assert.equal((source.match(/phone\.evaluate\(key=>sessionStorage\.setItem\(key,'preserve'\),sentinel\)/g)??[]).length,1);
  assert.doesNotMatch(source,/force\s*:\s*true|\.reload\(|\.addInitScript\(|sessionStorage\.(?:clear|removeItem)\(|\b(?:fetch|apiFetch|query|rpc)\s*\(|\b(?:data|c)\.exec\s*\(/);
  assert.doesNotMatch(source,/\broute\.fulfill|new Response\(|\bResponse\.json|\bstorage\.setItem/);
});
