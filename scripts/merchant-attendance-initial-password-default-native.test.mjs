import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {assertInitialPasswordDefaultAclDefect,assertInitialPasswordDefaultCompleted} from './merchant-attendance-initial-password-default-native.mjs';
const proof=()=>{
  const before={employees:[{status:'invited',accepted_at:null}],setups:[],audits:[]};
  const authBefore={updates:0,reads:0,initialized:false,retained:'unchanged'};
  return {status:503,body:{ok:false,error:'employee_initial_password_store_unavailable'},
    reads:[{kind:'invitation',status:200,error:null},{kind:'role',status:200,error:null},{kind:'identity',status:403,error:'42501'}],
    rpcCalls:[],adminCalls:[],before,after:structuredClone(before),authBefore,authAfter:structuredClone(authBefore)};
};
test('default ACL diagnostic proof reports a reproduced failure, never successful setup',()=>{
  const value=proof(),copy=structuredClone(value);
  assert.deepEqual(assertInitialPasswordDefaultAclDefect(value),{defaultSetupSuccess:false,identityReadAclDefectReproduced:true});
  assert.deepEqual(value,copy);
});
test('default ACL diagnostic requires the exact service read sequence and error, not an arbitrary 503',()=>{
  for(const mutate of [p=>p.status=200,p=>p.body.error='employee_initial_password_setup_failed',p=>p.reads.pop(),
    p=>p.reads.reverse(),p=>p.reads[2].status=200,p=>p.reads[2].error='unknown',p=>p.reads[0].error='42501']){
    const value=proof();mutate(value);assert.throws(()=>assertInitialPasswordDefaultAclDefect(value));
  }
});
test('default ACL diagnostic rejects any setup/Auth call or changed employee, audit, receipt or password facts',()=>{
  for(const mutate of [p=>p.rpcCalls.push({name:'claim'}),p=>p.adminCalls.push({method:'GET'}),
    p=>p.after.employees[0].status='active',p=>p.after.setups.push({state:'claimed'}),p=>p.after.audits.push({}),
    p=>p.authAfter.updates++,p=>p.authAfter.reads++,p=>p.authAfter.initialized=true,
    p=>{p.before.setups.push({});p.after=structuredClone(p.before);},
    p=>{p.authBefore.updates=1;p.authAfter=structuredClone(p.authBefore);},
    p=>{p.before.employees[0].accepted_at='2026-01-01';p.after=structuredClone(p.before);}]){
    const value=proof();mutate(value);assert.throws(()=>assertInitialPasswordDefaultAclDefect(value));
  }
});
test('runner calls the exported default POST without grants, factory injection or real-network fallback',()=>{
  const source=readFileSync(new URL('./merchant-attendance-initial-password-default-native.mjs',import.meta.url),'utf8');
  assert.match(source,/const \{POST\}=require\('\.\.\/src\/app\/api\/merchant-enterprise\/invitations\/initial-password\/route-handler\.ts'\)/);
  assert.match(source,/await POST\(new Request/);
  assert.match(source,/withAttendanceApplicationAuth\(\[invite.actor\],rpc,/);
  assert.match(source,/\},undefined,transport.read\)/);
  assert.doesNotMatch(source,/\bgrant\s+(?:select|all)\b|\b(?:insert into|update|delete from)\s+public\.|createMerchantEnterpriseInitialPasswordHandler\(/i);
  assert.match(source,/prepared\.initialPasswordReadCalls,\[\]/);
  assert.match(source,/realPostgrestService:false,realAuthService:false,realBrowser:false,realEmail:false/);
});

const completeProof=()=>{
  const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,hash=value=>createHash('sha256').update(value,'utf8').digest('hex');
  const invite={employeeId:id(102),actor:{id:id(2)},token:'A'.repeat(43),version:7};
  const command={siteId:'99990001',invitationToken:invite.token,invitationVersion:7,newPassword:'Synthetic-password-only!2026',operationId:id(901)};
  const before={employees:[{id:invite.employeeId,initial_password_policy:'required',status:'invited',accepted_at:null,version:1,updated_at:'2026-10-03T08:00:00Z'}],setups:[],audits:[]};
  const after=structuredClone(before);Object.assign(after.employees[0],{initial_password_policy:'completed',version:2,updated_at:'2026-10-03T08:00:01Z'});
  after.setups=[{employee_id:invite.employeeId,merchant_id:command.siteId,auth_user_id:invite.actor.id,invitation_version:7,
    invitation_token_hash:hash(invite.token),operation_id:command.operationId,
    password_fingerprint:hash('faolla:merchant-employee-initial-password:v1\0'+invite.token+'\0'+command.newPassword),
    state:'completed',claim_expires_at:null,claimed_at:'2026-10-03T08:00:00Z',completed_at:'2026-10-03T08:00:01Z'}];
  return {before,after,invite,command,auth:{updates:1,reads:1,initialized:true,retained:'unchanged'}};
};
test('completed default proof requires a single original setup and only the intended invited password-policy transition',()=>{
  const value=completeProof(),copy=structuredClone(value);assert.doesNotThrow(()=>assertInitialPasswordDefaultCompleted(value));assert.deepEqual(value,copy);
});
test('completed default proof rejects changed identity, password, operation, audit or duplicate writes',()=>{
  for(const change of [p=>p.after.setups.push({...p.after.setups[0]}),p=>p.after.setups[0].auth_user_id='foreign',
    p=>p.after.setups[0].password_fingerprint='0'.repeat(64),p=>p.after.setups[0].operation_id='foreign',
    p=>p.after.setups[0].state='claimed',p=>p.after.setups[0].claim_expires_at='2026-10-03',p=>p.after.setups[0].completed_at=null,
    p=>p.after.employees[0].status='active',p=>p.after.employees[0].version++,p=>p.after.audits.push({}),
    p=>p.auth.updates++,p=>p.auth.initialized=false,p=>p.auth.retained='lost']){
    const value=completeProof();change(value);assert.throws(()=>assertInitialPasswordDefaultCompleted(value));
  }
});
test('native repair exercises original recovery branch and both commit outcomes without factory or fake RPC results',()=>{
  const source=readFileSync(new URL('./merchant-attendance-initial-password-default-native.mjs',import.meta.url),'utf8');
  assert.match(source,/lookup\.withMissingRegistry\(invite.actor/);assert.match(source,/lookup\.lookupCalls.at\(-1\).source,'auth_recovery'/);
  assert.match(source,/lostReply:true/);assert.match(source,/model.loseNextUpdateReply\(\)/);
  assert.match(source,/lookup\.lookupRpc\(name,args\):prepared.initialPasswordRpc\(name,args\)/);
  assert.match(source,/default_route_must_not_select_registry/);
});
