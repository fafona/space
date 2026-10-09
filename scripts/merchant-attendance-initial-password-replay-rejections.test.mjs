// SQL-construction and failure-cleanup tests only; no database result is modeled
// as a successful claim or as evidence that PostgreSQL accepted a mutation.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {
  assertInitialPasswordReplayPrestate,
  assertInitialPasswordReplayRejectionProof,
  initialPasswordReplayRejectionPlan,
  checkInitialPasswordReplayRejections,
} from './merchant-attendance-initial-password-replay-rejections.mjs';

const invite={employeeId:'00000000-0000-4000-8000-000000000102',actor:{id:'00000000-0000-4000-8000-000000000002'},version:7,token:'A'.repeat(43)};
const input={merchant_id:'99990001',auth_user_id:invite.actor.id,invitation_version:7,
  token_hash:createHash('sha256').update(invite.token).digest('hex'),operation_id:'00000000-0000-4000-8000-000000117001',password_fingerprint:'a'.repeat(64)};
const facts=()=>({employees:[{id:invite.employeeId,merchant_id:input.merchant_id,auth_user_id:input.auth_user_id,
  status:'invited',accepted_at:null,invitation_revoked_at:null,initial_password_policy:'completed',
  invitation_version:7,invitation_token_hash:input.token_hash}],setups:[{employee_id:invite.employeeId,
  merchant_id:input.merchant_id,auth_user_id:input.auth_user_id,invitation_version:7,invitation_token_hash:input.token_hash,
  operation_id:input.operation_id,password_fingerprint:input.password_fingerprint,state:'completed',
  completed_at:'2026-10-03T10:00:00.000000Z',claim_expires_at:null}],audits:[]});

test('closed plan has thirteen distinct cases, exact errors and one explicitly rollback-only transaction per case',()=>{
  const plan=initialPasswordReplayRejectionPlan(invite,input);
  assert.deepEqual(plan.map(item=>item.name),['receipt_missing','receipt_claimed','receipt_merchant','receipt_auth','receipt_version',
    'receipt_hash','receipt_operation','receipt_fingerprint','role_inactive','employee_expired','employee_revoked','employee_disabled','employee_generation']);
  assert(plan.slice(0,8).every(item=>item.error==='employee_initial_password_not_required'));
  assert.deepEqual(plan.slice(8).map(item=>item.error),['merchant_access_denied','employee_invitation_expired','employee_invitation_revoked','employee_invitation_not_pending','employee_invitation_superseded']);
  for(const item of plan){
    assert.match(item.sql,/^begin;reset role;/);assert.match(item.sql,/rollback;$/);
    assert.doesNotMatch(item.sql,/\b(?:commit|truncate|drop|alter|grant|revoke)\b/i);
    assert(!item.sql.includes(invite.token));
  }
});

test('prestate requires a real completed receipt bound to every original input field and an unaccepted member',()=>{
  const original=facts();assert.doesNotThrow(()=>assertInitialPasswordReplayPrestate(original,invite,input));assert.deepEqual(original,facts());
  for(const change of [{merchant_id:'99990002'},{auth_user_id:'00000000-0000-4000-8000-000000000001'},
    {invitation_version:8},{invitation_token_hash:'0'.repeat(64)},{operation_id:'00000000-0000-4000-8000-000000117002'},
    {password_fingerprint:'b'.repeat(64)},{state:'claimed'},{completed_at:null},{completed_at:'invalid'},{claim_expires_at:'2026-10-03T10:10:00Z'}]){
    const value=facts();Object.assign(value.setups[0],change);assert.throws(()=>assertInitialPasswordReplayPrestate(value,invite,input));
  }
  for(const change of [{status:'active'},{accepted_at:'2026-10-03T10:00:00Z'},{initial_password_policy:'required'},
    {invitation_revoked_at:'2026-10-03T10:00:00Z'},{invitation_token_hash:'0'.repeat(64)}]){
    const value=facts();Object.assign(value.employees[0],change);assert.throws(()=>assertInitialPasswordReplayPrestate(value,invite,input));
  }
  for(const value of [{...facts(),setups:[]},{...facts(),setups:[...facts().setups,...facts().setups]},null])
    assert.throws(()=>assertInitialPasswordReplayPrestate(value,invite,input));
});

test('SQL construction rejects foreign tenants, unknown subjects, unsafe fields and unbound fixture identity before quoting',()=>{
  for(const patch of [{merchant_id:'99990002'},{auth_user_id:'00000000-0000-4000-8000-000000000099'},
    {invitation_version:8},{token_hash:"';delete from public.merchants;--"},{password_fingerprint:'raw-password'},
    {operation_id:'not-a-uuid'},{extra:'select 1'}])assert.throws(()=>initialPasswordReplayRejectionPlan(invite,{...input,...patch}));
  for(const patch of [{employeeId:'foreign'},{employeeId:'00000000-0000-4000-8000-000000000999'},
    {actor:{id:'00000000-0000-4000-8000-000000000001'}},{version:8},{token:'B'.repeat(43)}])
    assert.throws(()=>initialPasswordReplayRejectionPlan({...invite,...patch},input));
});

test('fault fixtures honor original legal role, revocation and setup-state shapes and verify the original row before mutation',()=>{
  const byName=Object.fromEntries(initialPasswordReplayRejectionPlan(invite,input).map(item=>[item.name,item.sql]));
  assert.match(byName.role_inactive,/set status='archived'/);assert.doesNotMatch(byName.role_inactive,/set status='disabled'/);
  assert.match(byName.employee_revoked,/invitation_revoked_at=clock_timestamp\(\),invitation_token_hash=null,invitation_delivery_status='revoked'/);
  assert.match(byName.receipt_claimed,/state='claimed',completed_at=null,claim_expires_at=clock_timestamp\(\)\+interval '10 minutes'/);
  assert(byName.receipt_operation.includes("set operation_id='00000000-0000-4000-8000-000000117002'"),'alternate operation must differ even when the input equals the first candidate');
  for(const sql of Object.values(byName)){
    assert.match(sql,/e\.invitation_expires_at>clock_timestamp\(\)/);
    assert.match(sql,/s\.state='completed'[\s\S]+s\.completed_at is not null and s\.claim_expires_at is null/);
    assert.match(sql,/get diagnostics changed=row_count;[\s\S]+if changed<>1 then raise exception/);
    assert(sql.indexOf('initial_password_replay_original_completed_required')<sql.indexOf('get diagnostics changed=row_count'));
  }
});

test('only the actual service-role claim exception can satisfy a case and unexpected success or a different SQL error fails closed',()=>{
  for(const {sql,error} of initialPasswordReplayRejectionPlan(invite,input)){
    const service=sql.slice(sql.indexOf('set local role service_role;'));
    assert.match(service,/current_user<>'service_role'/);
    assert.match(service,/begin perform public\.faolla_claim_merchant_employee_initial_password_setup_v1\(/);
    assert.match(service,/exception when others then actual_error:=SQLERRM;end;/);
    assert(service.includes(`if actual_error is distinct from '${error}' then raise exception 'initial_password_replay_unexpected_result'`));
    assert.doesNotMatch(service,/\b(?:insert|update|delete|execute)\b/i);
    assert.match(service,/select jsonb_build_object\('case',[\s\S]+'error',current_setting\('[a-z_.]+'\),'role',current_user\)/);
  }
});

test('fixed SQL proof is key-order independent but rejects extra fields, another role, another case or another error',()=>{
  const expected={name:'receipt_missing',error:'employee_initial_password_not_required'};
  const proof={role:'service_role',error:expected.error,case:expected.name};
  assert.doesNotThrow(()=>assertInitialPasswordReplayRejectionProof(proof,expected));
  for(const value of [null,[],{}, {...proof,role:'postgres'},{...proof,case:'receipt_claimed'},
    {...proof,error:'permission_denied'},{...proof,extra:'unexpected'}])
    assert.throws(()=>assertInitialPasswordReplayRejectionProof(value,expected));
});

test('unknown schema identity is rejected before facts or fault mutations are touched',async()=>{
  let factReads=0,execCalls=0;
  const prepared={exec:()=>{execCalls++;return JSON.stringify({schema:'public',oid:1,tableOid:2,owner:'postgres',marker:'not-owned'});},
    facts:()=>{factReads++;return facts();},protectedFingerprint:()=>'',owned:{}};
  await assert.rejects(()=>checkInitialPasswordReplayRejections({pass:()=>{}},{sql:value=>value,schema:'public'},prepared,invite,input),/lifecycle_owned_schema_required/);
  assert.equal(factReads,0);assert.equal(execCalls,1);
});

test('an unexpected execution failure is not a passed case, is sanitized, and still checks both restoration fingerprints',async()=>{
  const owned={schema:'attendance_race_'+'a'.repeat(32),oid:123,tableOid:456,owner:'postgres',marker:'faolla-synthetic-concurrency:10000000-0000-4000-8000-000000000001'};
  let queries=0,factReads=0,protectedReads=0,passes=0;
  const prepared={owned,exec:sql=>{queries++;if(queries===1)return JSON.stringify(owned);
    assert.match(sql,/^begin;reset role;/);throw Error('raw SQL '+input.token_hash);},
  facts:()=>{factReads++;return facts();},protectedFingerprint:()=>{protectedReads++;return 'unchanged';}};
  await assert.rejects(()=>checkInitialPasswordReplayRejections({pass:()=>{passes++;}},{schema:owned.schema,sql:value=>value},prepared,invite,input),
    error=>error.message==='initial_password_replay_rejection_failed:receipt_missing'&&!String(error).includes(input.token_hash));
  assert.equal(queries,2);assert.equal(passes,0);assert.equal(factReads,3);assert.equal(protectedReads,3);
});
