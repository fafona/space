import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {invitationBrowserSeedPlan,isInvitationBrowserRecoveryRead,createInvitationBrowserTransport,prepareInvitationBrowser} from './merchant-attendance-invitation-browser-fixture.mjs';

const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const owned={schema:'attendance_race_'+'a'.repeat(32),oid:123,tableOid:456,owner:'postgres',marker:'faolla-synthetic-concurrency:12345678-1234-1234-1234-123456789abc'};
const tokens=['A'.repeat(43),'B'.repeat(43),'C'.repeat(43)];
const hash=token=>createHash('sha256').update(token).digest('hex');
const columns='id,merchant_id,auth_user_id,email,display_name,role_id,status,invited_at,accepted_at,last_active_at,invitation_version,invitation_expires_at,invitation_revoked_at,invitation_sent_at,invitation_delivery_status,version,created_at,updated_at';
const request=(params,method='GET')=>{
  const url=new URL('https://attendance-auth.invalid/rest/v1/merchant_enterprise_employees');
  for(const [key,value] of Object.entries(params))url.searchParams.set(key,value);
  return new Request(url,{method,headers:{apikey:'attendance-synthetic-service',authorization:'Bearer attendance-synthetic-service'}});
};
const recoveryParams=()=>({select:columns,merchant_id:'eq.99990001',auth_user_id:'eq.'+id(1),status:'eq.active',invitation_version:'eq.7',accepted_at:'not.is.null',invitation_revoked_at:'is.null',invitation_token_hash:'is.null',limit:'1'});
function spy(reply=()=>{throw Error('pure construction stop');}){
  const sql=[];let currentOwned=owned;
  const raw=source=>{sql.push(source);if(source.includes("'schema',n.nspname"))return JSON.stringify(currentOwned);return reply(source);};
  const transport=createInvitationBrowserTransport(raw,owned);
  return {transport,sql,setOwned:value=>{currentOwned=value;},businessSql:()=>sql.filter(source=>!source.includes("'schema',n.nspname"))};
}

test('pure seed plan constructs only three invited identities and complete bootstrap prestate; raw invitation tokens never enter SQL',()=>{
  const plan=invitationBrowserSeedPlan(tokens);
  assert.equal(plan.site,'99990001');assert.equal(plan.ownerId,id(99));
  assert.deepEqual(plan.actors.map(actor=>actor.id),[id(1),id(2),id(3)]);
  assert.deepEqual(plan.invitations.map(item=>[item.n,item.employeeId,item.version,item.policy]),[[1,id(101),7,'waived'],[2,id(102),7,'required'],[3,id(103),7,'waived']]);
  const source=plan.identitiesSql+plan.invitationsSql+plan.workspaceSql;
  for(const token of tokens){assert(!source.includes(token));assert(plan.invitationsSql.includes(hash(token)));}
  assert.equal((plan.invitationsSql.match(/'invited',7/g)??[]).length,3);
  assert.doesNotMatch(plan.invitationsSql,/\baccepted_at\b|'active'|\bupdate\b/i);
  assert.doesNotMatch(source,/\bmerchant_attendance_|\b(?:update|delete|truncate|drop)\b/i);
  for(const key of ['employee','supervisor','administrator'])assert(plan.identitiesSql.includes(`'${key}',array['enterprise.view']`));
  assert.equal((plan.identitiesSql.match(/array\['enterprise.view'\]/g)??[]).length,3);
  for(const key of ['todo','in_progress','blocked','done'])assert(plan.workspaceSql.includes(`'${key}'`));
  for(const value of [id(401),id(410),id(411),id(412),id(413)])assert(plan.workspaceSql.includes(value));
});

test('pure seed construction rejects duplicated, malformed or incomplete token inputs',()=>{
  for(const value of [null,[],tokens.slice(0,2),[...tokens,'D'.repeat(43)],[tokens[0],tokens[0],tokens[2]],
    [null,tokens[1],tokens[2]],['x'.repeat(42),tokens[1],tokens[2]],["'".repeat(43),tokens[1],tokens[2]]]){
    assert.throws(()=>invitationBrowserSeedPlan(value));
  }
});

test('strict RPC builds guarded service-role SQL and passes an opaque fake reply unchanged, without fabricating acceptance',async()=>{
  const opaque={pureConstructionSentinel:true};
  const h=spy(()=>JSON.stringify({role:'service_role',data:opaque}));
  const input={merchant_id:'99990001',auth_user_id:id(2),invitation_version:7,token_hash:hash(tokens[1])};
  assert.deepEqual(await h.transport.rpc('faolla_waive_employee_initial_password_v1',{p_input:input}),{data:opaque,error:null});
  assert.deepEqual(await h.transport.rpc('faolla_accept_merchant_employee_invitation_v1',{p_input:{merchant_id:'99990001',auth_user_id:id(2)}}),{data:opaque,error:null});
  for(const sql of h.businessSql()){
    assert.match(sql,/^begin;reset role;do \$owned\$/);
    assert.match(sql,/c\.oid=456 and n\.oid=123/);assert(sql.includes(owned.marker));
    assert.match(sql,/set local role service_role/);assert.match(sql,/public\.faolla_(?:waive_employee_initial_password|accept_merchant_employee_invitation)_v1\(/);
  }
  assert.deepEqual(h.transport.rpcCalls,[{name:'faolla_waive_employee_initial_password_v1',error:null},{name:'faolla_accept_merchant_employee_invitation_v1',error:null}]);
  assert(!JSON.stringify(h.transport.rpcCalls).includes(input.token_hash));assert.deepEqual(h.transport.errors,[]);
});

test('RPC rejects unsupported subjects, tenant, private delegates and extras before any business SQL',async()=>{
  const good={p_input:{merchant_id:'99990001',auth_user_id:id(1),invitation_version:7,token_hash:hash(tokens[0])}};
  for(const [name,args] of [
    ['faolla_accept_employee_invite_pre043',good],['faolla_update_merchant_enterprise_employee_v1',good],
    ['faolla_accept_merchant_employee_invitation_v1',{p_input:{...good.p_input,auth_user_id:id(4)}}],
    ['faolla_accept_merchant_employee_invitation_v1',{p_input:{...good.p_input,merchant_id:'99990002'}}],
    ['faolla_accept_merchant_employee_invitation_v1',{p_input:{...good.p_input,invitationToken:tokens[0]}}],
    ['faolla_accept_merchant_employee_invitation_v1',{...good,extra:true}],
  ]){
    const h=spy();await assert.rejects(h.transport.rpc(name,args),/^Error: invitation_browser_rpc_forbidden$/);
    assert.deepEqual(h.businessSql(),[]);assert.deepEqual(h.transport.rpcCalls,[]);
  }
});

test('recovery-specific predicates are routed strictly while current employee and overview snapshot reads retain their original adapter',async()=>{
  const h=spy(sql=>sql.includes("'role',current_user")?JSON.stringify({role:'service_role',data:[]}):'[]');
  const current=request({select:'id,merchant_id,auth_user_id,email,display_name,role_id,status,invited_at,accepted_at,last_active_at,version,created_at,updated_at',merchant_id:'eq.99990001',auth_user_id:'eq.'+id(1),status:'eq.active',limit:'1'});
  const snapshot=request({select:columns,merchant_id:'eq.99990001',order:'created_at.asc,id.asc',offset:'0',limit:'500'});
  for(const req of [current,snapshot]){
    assert.equal(isInvitationBrowserRecoveryRead(req),false);assert.deepEqual(await h.transport.read(req).json(),[]);
  }
  const recover=request(recoveryParams());assert.equal(isInvitationBrowserRecoveryRead(recover),true);
  assert.deepEqual(await h.transport.read(recover).json(),[]);
  assert.deepEqual(h.transport.readCalls.map(call=>call.shape),['current-employee','snapshot-page']);
  assert.deepEqual(h.transport.recoveryCalls,[{actorId:id(1),version:7,object:false}]);
  const sql=h.businessSql().at(-1);assert.match(sql,/^begin read only;reset role;do \$owned\$/);
  assert.match(sql,/invitation_revoked_at is null and invitation_token_hash is null limit 1/);
  assert.deepEqual(h.transport.errors,[]);
});

test('malformed recovery reads never fall back, and owner/extra synthetic subjects are not silently admitted',()=>{
  for(const patch of [{auth_user_id:'eq.'+id(4)},{auth_user_id:'eq.'+id(99)},{merchant_id:'eq.99990002'},
    {accepted_at:'is.null'},{invitation_version:'eq.0'},{select:'*'}]){
    const h=spy();assert.throws(()=>h.transport.read(request({...recoveryParams(),...patch})),/^Error: invitation_browser_recovery_forbidden$/);
    assert.deepEqual(h.businessSql(),[]);assert.deepEqual(h.transport.readCalls,[]);assert.deepEqual(h.transport.recoveryCalls,[]);
  }
  const h=spy();assert.throws(()=>h.transport.read(request(recoveryParams(),'POST')),/^Error: invitation_browser_recovery_forbidden$/);
  assert.deepEqual(h.businessSql(),[]);
});

test('namespace substitution stops before business SQL and unknown SQL failures cannot expose credentials',async()=>{
  const h=spy(()=>{throw Error(`ERROR: internal_error ${tokens[0]} ${hash(tokens[0])}`);});
  h.setOwned({...owned,oid:999});
  assert.throws(()=>h.transport.exec('select 1;'),/invitation_browser_namespace_changed/);
  assert.deepEqual(h.businessSql(),[]);
  h.setOwned(owned);
  await assert.rejects(h.transport.rpc('faolla_accept_merchant_employee_invitation_v1',{p_input:{merchant_id:'99990001',auth_user_id:id(1)}}),/^Error: invitation_browser_rpc_failed$/);
  assert.deepEqual(h.transport.errors,['invitation_browser_rpc_failed']);
  assert(!JSON.stringify(h.transport.rpcCalls).includes(tokens[0]));
  const business=spy(()=>{throw Error('ERROR: employee_invitation_invalid_or_expired\nsecret details');});
  assert.deepEqual(await business.transport.rpc('faolla_accept_merchant_employee_invitation_v1',{p_input:{merchant_id:'99990001',auth_user_id:id(1)}}),
    {data:null,error:{message:'employee_invitation_invalid_or_expired'}});
  assert.deepEqual(business.transport.rpcCalls,[{name:'faolla_accept_merchant_employee_invitation_v1',error:'employee_invitation_invalid_or_expired'}]);
});

test('preparation requires the exact existing owned scope and original installers before invited workspace seed',async()=>{
  const submitted=[];
  await assert.rejects(prepareInvitationBrowser({query:sql=>{submitted.push(sql);return JSON.stringify(owned);}},{schema:'attendance_race_'+'b'.repeat(32),sql:value=>value}),/invitation_browser_scope_mismatch/);
  assert.equal(submitted.length,1);assert.doesNotMatch(submitted[0],/\b(?:insert|update|delete|create|drop)\b/i);
  const source=readFileSync(new URL('./merchant-attendance-invitation-browser-fixture.mjs',import.meta.url),'utf8');
  assert(source.indexOf('await prepareAttendanceEmployeeManagement(native,scope)')<source.indexOf('await prepareAttendanceInvitationRetry(native,scope)'));
  assert(source.indexOf('await prepareAttendanceInvitationRetry(native,scope)')<source.indexOf('transport.exec(`${plan.invitationsSql}'));
  assert.match(source,/invitation_browser_empty_namespace_required/);
  assert.match(source,/roles:3,boards:1,columns:4,workers:0,events:0,settings:0,locations:0/);
  assert.doesNotMatch(source,/console\.|\.serveShell\(|checkInvitationRetryNative\(|create database|drop schema|disable trigger/i);
  assert.match(source,/seededActiveEmployees:0,seededAttendanceEvents:0/);
});
