import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {validateInvitationRetryRpcInput,assertInvitationRetryDivergence,assertInvitationRetryRecovery,validateInvitationRecoveryRead,createInvitationRetryRecoveryRead} from './merchant-attendance-invitation-retry-native.mjs';

const waive='faolla_waive_employee_initial_password_v1',accept='faolla_accept_merchant_employee_invitation_v1';
const subject='00000000-0000-4000-8000-000000000001';
const input=()=>({merchant_id:'99990001',auth_user_id:subject,invitation_version:7,token_hash:'a'.repeat(64)});
const diagnostic=()=>({retryStatus:410,retryBody:{ok:false,error:'employee_invitation_superseded'},retryRpcs:[waive],
  reentryStatus:200,reentryBody:{ok:true,alreadyActive:true,employee:{id:'synthetic-employee',status:'active'}},reentryRpcs:[accept],employeeId:'synthetic-employee'});

test('strict transport allows only the two original public RPCs and server-derived synthetic subject/tenant shapes',()=>{
  for(const name of [waive,accept])assert.deepEqual(validateInvitationRetryRpcInput(name,{p_input:input()}),input());
  assert.deepEqual(validateInvitationRetryRpcInput(accept,{p_input:{merchant_id:'99990001',auth_user_id:subject}}),{merchant_id:'99990001',auth_user_id:subject});
  for(const name of [accept+'_preaudit_019','faolla_accept_employee_invite_pre043','faolla_update_merchant_enterprise_employee_v1','arbitrary'])
    assert.throws(()=>validateInvitationRetryRpcInput(name,{p_input:input()}));
  assert.throws(()=>validateInvitationRetryRpcInput(waive,{p_input:{merchant_id:'99990001',auth_user_id:subject}}));
});

test('transport rejects extras, raw tokens, foreign tenant/subject and malformed invitation fields before SQL construction',()=>{
  for(const patch of [{merchant_id:'99990002'},{merchant_id:"99990001';delete"},{auth_user_id:'00000000-0000-4000-8000-000000000099'},
    {auth_user_id:'foreign'},{token_hash:'A'.repeat(64)},{token_hash:'raw-token'},{invitation_version:0},{invitation_version:1.5},
    {invitation_version:'7'},{invitationToken:'secret'},{actor_id:subject}])
    assert.throws(()=>validateInvitationRetryRpcInput(waive,{p_input:{...input(),...patch}}));
  for(const args of [null,[],{}, {p_input:null},{p_input:[]},{p_input:input(),other:true}])assert.throws(()=>validateInvitationRetryRpcInput(waive,args));
});

test('diagnostic must simultaneously prove failed credential retry and successful same-row credential-free reentry',()=>{
  assert.deepEqual(assertInvitationRetryDivergence(diagnostic()),{defectReproduced:true,retryRecoveryPassed:false,credentialRetryStatus:410,passwordAuthenticatedReentryStatus:200});
  for(const patch of [{retryStatus:200},{retryStatus:503},{retryBody:{ok:false,error:'other'}},{retryRpcs:[waive,accept]},
    {reentryStatus:410},{reentryRpcs:[waive,accept]},{employeeId:'another-employee'},
    {reentryBody:{ok:true,alreadyActive:false,employee:{id:'synthetic-employee',status:'active'}}},
    {reentryBody:{ok:true,alreadyActive:true,employee:{id:'synthetic-employee',status:'invited'}}}])
    assert.throws(()=>assertInvitationRetryDivergence({...diagnostic(),...patch}));
});

test('diagnostic executes actual handler and service SQL with ownership rechecks and no manufactured active employee',()=>{
  const source=readFileSync(new URL('./merchant-attendance-invitation-retry-native.mjs',import.meta.url),'utf8');
  assert.match(source,/employees\/accept\/route-handler\.ts/);
  assert.match(source,/await POST\(new Request/);assert.match(source,/await auth\.login\(actor\)/);
  assert.match(source,/assert\.deepEqual\(assertLifecycleSandbox\(exec\),owned/);
  assert.match(source,/c\.oid=\$\{owned\.tableOid\} and n\.oid=\$\{owned\.oid\}/);
  assert.match(source,/obj_description\(n\.oid,'pg_namespace'\)=\$\{quote\(owned\.marker\)\}/);
  assert.match(source,/set local role service_role/);assert.match(source,/assert\.equal\(result\.role,'service_role'\)/);
  assert.doesNotMatch(source,/update public\.|\.serveShell\(|getSession\(|\.admin\./i);
  assert.match(source,/const afterCommit=snapshot\(\),retry=await request\(item\.actor,body\(item\)\);assert\.equal\(snapshot\(\),afterCommit\)/);
  assert.match(source,/reentry=await request\(item\.actor,\{siteId:site\}\);assert\.equal\(snapshot\(\),afterCommit\)/);
  assert.match(source,/retryRecoveryPassed:false/);assert.match(source,/realBrowser:false/);
  assert.doesNotMatch(source,/console\.(?:log|error)\((?:error|args|input|tokens|invitations|committed)/);
});

test('successful recovery must match exact credential-free DTO while adding no second writable RPC',()=>{
  const value={...diagnostic(),retryStatus:200,retryBody:diagnostic().reentryBody,retryReads:1,reentryReads:0};
  assert.deepEqual(assertInvitationRetryRecovery(value),{defectReproduced:false,retryRecoveryPassed:true,credentialRetryStatus:200,passwordAuthenticatedReentryStatus:200});
  for(const patch of [{retryStatus:410},{retryStatus:503},{retryReads:0},{retryReads:2},{retryRpcs:[waive,accept]},
    {reentryReads:1},{reentryRpcs:[waive,accept]},{employeeId:'foreign'},
    {retryBody:{...value.retryBody,alreadyActive:false}},{retryBody:{...value.retryBody,employee:{...value.retryBody.employee,id:'foreign'}}},
    {retryBody:{...value.retryBody,extra:'secret'}}])assert.throws(()=>assertInvitationRetryRecovery({...value,...patch}));
});

const columns='id,merchant_id,auth_user_id,email,display_name,role_id,status,invited_at,accepted_at,last_active_at,invitation_version,invitation_expires_at,invitation_revoked_at,invitation_sent_at,invitation_delivery_status,version,created_at,updated_at';
const recoveryRequest=(change=()=>{},headers={})=>{
  const url=new URL('https://attendance-auth.invalid/rest/v1/merchant_enterprise_employees');
  for(const [key,value] of Object.entries({select:columns,merchant_id:'eq.99990001',auth_user_id:'eq.'+subject,status:'eq.active',invitation_version:'eq.7',accepted_at:'not.is.null',invitation_revoked_at:'is.null',invitation_token_hash:'is.null',limit:'1'}))url.searchParams.set(key,value);
  change(url);return new Request(url,{headers:{apikey:'attendance-synthetic-service',authorization:'Bearer attendance-synthetic-service',...headers}});
};
test('recovery REST parser accepts exact safe projection with array or maybeSingle object response negotiation',()=>{
  assert.deepEqual(validateInvitationRecoveryRead(recoveryRequest()),{actorId:subject,version:7,object:false});
  assert.deepEqual(validateInvitationRecoveryRead(recoveryRequest(()=>{},{accept:'application/vnd.pgrst.object+json'})),{actorId:subject,version:7,object:true});
  const helper=readFileSync(new URL('../src/lib/merchantEnterpriseInvitationRecovery.server.ts',import.meta.url),'utf8');assert(helper.includes('"'+columns+'"'));
  assert(!columns.split(',').includes('invitation_token_hash'));
});
test('recovery read rejects every weakened predicate, tenant/auth escape, unsafe projection and write before SQL',()=>{
  for(const change of [url=>url.hostname='other.invalid',url=>url.pathname='/rest/v1/merchants',url=>url.hash='secret',url=>url.username='user',
    url=>url.searchParams.append('limit','2'),url=>url.searchParams.set('select','*'),url=>url.searchParams.set('select',columns+',invitation_token_hash'),
    url=>url.searchParams.set('merchant_id','eq.99990002'),url=>url.searchParams.set('auth_user_id','eq.00000000-0000-4000-8000-000000000099'),
    url=>url.searchParams.set('status','eq.invited'),url=>url.searchParams.set('accepted_at','is.null'),url=>url.searchParams.delete('accepted_at'),
    url=>url.searchParams.set('invitation_version','eq.0'),url=>url.searchParams.set('invitation_version','eq.1;delete'),
    url=>url.searchParams.set('invitation_version','eq.9007199254740992'),url=>url.searchParams.set('invitation_revoked_at','not.is.null'),
    url=>url.searchParams.delete('invitation_token_hash'),url=>url.searchParams.set('limit','2'),url=>url.searchParams.set('or','(status.eq.active)')])
    assert.throws(()=>validateInvitationRecoveryRead(recoveryRequest(change)));
  for(const headers of [{apikey:'anon'},{authorization:'Bearer wrong'},{range:'0-9'},{prefer:'count=exact'},{'content-profile':'public'},{'accept-profile':'evil'},{accept:'text/plain'}])
    assert.throws(()=>validateInvitationRecoveryRead(recoveryRequest(()=>{},headers)));
  for(const method of ['POST','PATCH','DELETE','HEAD'])assert.throws(()=>validateInvitationRecoveryRead(new Request(recoveryRequest(),{method})));
});
test('recovery adapter checks owned namespace then builds only bounded service-role read-only SQL',()=>{
  const owned={schema:'attendance_race_'+'a'.repeat(32),oid:123,tableOid:456,owner:'postgres',marker:'faolla-synthetic-concurrency:12345678-1234-1234-1234-123456789abc'};
  let calls=0,submitted;const exec=sql=>{calls++;if(calls===1)return JSON.stringify(owned);submitted=sql;throw Error('pure stop before SQL');};
  const read=createInvitationRetryRecoveryRead(exec,{owned,ownedGuard:'do $owned$ begin perform 1; end;$owned$;',fallback:()=>{throw Error('unrelated read');}});
  assert.throws(()=>read.read(recoveryRequest()),/invitation_retry_recovery_read_failed/);assert.equal(calls,2);
  assert.match(submitted,/^begin read only;reset role;/);assert.match(submitted,/set local role service_role/);
  assert.match(submitted,/status='active' and invitation_version=7 and accepted_at is not null/);
  assert.match(submitted,/invitation_revoked_at is null and invitation_token_hash is null limit 1/);
  assert.doesNotMatch(submitted,/\b(?:insert|update|delete|truncate|alter|grant|revoke)\b/i);
  assert.deepEqual(read.calls,[{actorId:subject,version:7,object:false}]);assert.deepEqual(read.errors,['invitation_retry_recovery_read_failed']);
});
test('acceptance records each concurrent handler independently and tests read failure and old active generation without new SQL activation',()=>{
  const source=readFileSync(new URL('./merchant-attendance-invitation-retry-native.mjs',import.meta.url),'utf8');
  assert.match(source,/new AsyncLocalStorage\(\)/);assert.match(source,/requestScope\.run\(\{rpcs:\[\],reads:0,\.\.\.options\}/);
  assert.match(source,/context\.holdWaiver\.ready\.resolve\(\);await context\.holdWaiver\.release\.promise/);
  assert.match(source,/await bounded\(gate\.ready\.promise\);committed=await request/);assert.match(source,/finally\{gate\.release\.resolve\(\);\}/);
  assert.match(source,/concurrentRetry=await bounded\(held\)/);assert.match(source,/if\(concurrentRetry\)assertInvitationRetryRecovery/);
  assert.match(source,/invitationVersion:item\.version-1/);assert.match(source,/503,'merchant_employee_accept_failed',\[waive\]/);
  assert.match(source,/request\(disabled\.actor,\{siteId:site\}\),403,'employee_account_disabled',\[accept\]/);
  assert.match(source,/invitationRetryAcceptance:true,defectReproduced:false,retryRecoveryPassed:proofs\.every/);
  assert.doesNotMatch(source,/retryRpcs:rpcCalls\.slice|setTimeout\([^\n]*resolve|update public\./i);
});
