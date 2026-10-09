// Pure construction/closed-boundary tests. Opaque SQL spies do not prove any
// employee activation, permission edit, configuration save or attendance write.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {createAttendanceOnboardingTransport,onboardingSelfMigrationPlan,validateAttendanceOnboardingRpcInput} from './merchant-attendance-onboarding-fixture.mjs';
import {createInvitationBrowserTransport} from './merchant-attendance-invitation-browser-fixture.mjs';
import {createInitialPasswordFixtureTransport} from './merchant-attendance-initial-password-fixture.mjs';
import {qualifyAttendanceSandbox} from './merchant-attendance-concurrency-sandbox.mjs';

const require=createRequire(import.meta.url);
const {executeAttendanceAdmin}=require('../src/lib/merchantAttendanceAdmin.server.ts');
const {executeAttendanceSelf}=require('../src/lib/merchantAttendanceSelf.server.ts');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const site='99990001',owned={schema:'attendance_race_'+'a'.repeat(32),oid:123,tableOid:456,
  owner:'postgres',marker:'faolla-synthetic-concurrency:12345678-1234-1234-1234-123456789abc'};
const roleName='faolla_update_merchant_enterprise_role_v3',adminName='faolla_attendance_admin_v1',selfName='faolla_attendance_self_v1';
const setupNames=['claim','complete','release'].map(action=>`faolla_${action}_merchant_employee_initial_password_setup_v1`);
const acceptName='faolla_accept_merchant_employee_invitation_v1',waiveName='faolla_waive_employee_initial_password_v1';
const roleInput=()=>({merchant_id:site,actor_type:'owner',actor_id:id(99),role_id:id(30),expected_version:1,
  permissions:['enterprise.view','attendance.self.view','attendance.self.clock']});
const selfCommand=()=>({operationId:id(1001),expectedWorkerId:id(201),locationId:id(301),action:'clock_in',expectedSequence:0});
const selfArgs=()=>({p_site_id:site,p_auth_user_id:id(2),p_command:selfCommand(),p_operation_id:null});
const settingsCommand=()=>({operationId:id(1002),expectedVersion:0,kind:'settings',
  values:{timeZone:'Europe/Madrid',enabled:true,webClockEnabled:true,webBreakPaid:false}});
const adminArgs=()=>({p_site_id:site,p_auth_user_id:id(99),p_query:{view:'settings',cursor:null,search:''},p_command:settingsCommand(),p_operation_id:null});
const setupInput=()=>({merchant_id:site,auth_user_id:id(2),invitation_version:7,token_hash:'a'.repeat(64),
  operation_id:id(1003),password_fingerprint:'b'.repeat(64)});
function fixture(reply=()=>JSON.stringify({role:'service_role',data:{opaquePureProbe:true}})){
  const sql=[];let currentOwned=owned;
  const raw=source=>{sql.push(source);return source.includes("'schema',n.nspname")?JSON.stringify(currentOwned):reply(source);};
  const prepared=createInvitationBrowserTransport(raw,owned);Object.assign(prepared,createInitialPasswordFixtureTransport(prepared));
  const transport=createAttendanceOnboardingTransport(prepared);
  return {prepared,transport,sql,setOwned:value=>{currentOwned=value;},statements:()=>sql.filter(source=>!source.includes("'schema',n.nspname"))};
}
const request=(table,query)=>new Request('https://attendance-auth.invalid/rest/v1/'+table+'?'+new URLSearchParams(query),
  {headers:{apikey:'attendance-synthetic-service',authorization:'Bearer attendance-synthetic-service',accept:'application/json'}});

test('self installation retains the complete original111 migration with only outer transaction/schema adaptation',()=>{
  const scope={schema:owned.schema,sql:source=>qualifyAttendanceSandbox(source,owned.schema)};
  const plan=onboardingSelfMigrationPlan(root,scope);
  assert.equal(plan.migration,'202610020111_merchant_attendance_self_clock_identity.sql');
  assert.equal(plan.original,readFileSync(path.join(root,'scripts/supabase-migrations',plan.migration),'utf8'));
  assert.equal(plan.statement.replaceAll(owned.schema,'public'),plan.original.replace(/^begin;\s*$/m,'').replace(/^commit;\s*$/m,''));
  assert.doesNotMatch(plan.statement,/\bpublic\./);assert.match(plan.statement,/create or replace function .*faolla_attendance_self_v1/);
  assert.match(plan.statement,/actor_employee_id is distinct from v_employee\.id/);
  assert.match(plan.statement,/grant execute on function .*faolla_attendance_self_v1\(text,uuid,jsonb,uuid\) to service_role/);
  assert.match(plan.statement,/revoke all on function .* from public,anon,authenticated/);
  assert.match(plan.statement,/faolla_schema_migrations/);
  assert.throws(()=>onboardingSelfMigrationPlan('relative',scope));
  assert.throws(()=>onboardingSelfMigrationPlan(root,{schema:'public',sql:value=>value}));
  assert.throws(()=>onboardingSelfMigrationPlan(root,{schema:owned.schema,sql:value=>value}));
});

test('RPC list is exactly setup/invitation/role/admin/self; role patch is only six fields and three permitted names',()=>{
  const h=fixture();assert(Object.isFrozen(h.transport.onboardingRpcNames));
  assert.deepEqual(h.transport.onboardingRpcNames,[...setupNames,acceptName,waiveName,roleName,adminName,selfName]);
  for(const n of [30,31,32])assert.equal(validateAttendanceOnboardingRpcInput(roleName,{p_input:{...roleInput(),role_id:id(n)}}).role_id,id(n));
  for(const permissions of [['enterprise.view'],['enterprise.view','attendance.self.view'],roleInput().permissions])
    assert.deepEqual(validateAttendanceOnboardingRpcInput(roleName,{p_input:{...roleInput(),permissions}}).permissions,permissions);
  const bad=[null,{},[],{p_input:roleInput(),extra:true},{p_input:{...roleInput(),actor_id:id(2)}},
    {p_input:{...roleInput(),actor_type:'employee'}},{p_input:{...roleInput(),merchant_id:'99990002'}},
    {p_input:{...roleInput(),role_id:id(33)}},{p_input:{...roleInput(),expected_version:'1'}},
    {p_input:{...roleInput(),expected_version:0}},{p_input:{...roleInput(),expected_version:Number.MAX_SAFE_INTEGER}},
    ...['attendance.self.request','attendance.self.export','roles.manage','tasks.view'].map(permission=>({p_input:{...roleInput(),permissions:['enterprise.view',permission]}})),
    {p_input:{...roleInput(),permissions:['enterprise.view','enterprise.view']}},{p_input:{...roleInput(),permissions:[]}},
    ...['status','name','description','access_scope','allowed_board_ids'].map(key=>({p_input:{...roleInput(),[key]:'extra'}}))];
  for(const args of bad)assert.throws(()=>validateAttendanceOnboardingRpcInput(roleName,args));
  for(const name of ['faolla_attendance_history_v1','faolla_update_merchant_enterprise_employee_v1','unknown',roleName+';select 1'])
    assert.throws(()=>validateAttendanceOnboardingRpcInput(name,{p_input:roleInput()}));
  assert.deepEqual(h.statements(),[]);
});

test('admin accepts the exact existing settings/location/worker DTOs and four synthetic actors, without fabricating owner authorization',()=>{
  const variants=[settingsCommand(),{operationId:id(1002),expectedVersion:1,kind:'location',
    values:{id:id(301),name:'合成新地点',timeZone:'Europe/Madrid',active:true}},
  {operationId:id(1002),expectedVersion:2,kind:'worker',values:{id:id(201),employeeId:id(102),workerNo:'ONBOARDING-B',
    displayName:'合成新员工',locationId:id(301),active:true,startsOn:'2026-10-03'}}];
  for(const p_command of variants)for(const actor of [1,2,3,99]){
    const args={...adminArgs(),p_command,p_auth_user_id:id(actor)};
    assert.deepEqual(validateAttendanceOnboardingRpcInput(adminName,args),args);
  }
  for(const view of ['settings','locations','workers','employees']){
    const args={...adminArgs(),p_command:null,p_operation_id:id(1002),p_query:{view,cursor:id(301),search:'合成'}};
    assert.deepEqual(validateAttendanceOnboardingRpcInput(adminName,args),args);
  }
});

test('admin rejects extra RPC/query/command fields, canonicalization changes, invalid dates and non-boolean settings before SQL',async()=>{
  const h=fixture(),args=adminArgs();
  const bad=[{...args,extra:true},{...args,p_site_id:'99990002'},{...args,p_auth_user_id:id(4)},
    {...args,p_query:{...args.p_query,extra:true}},{...args,p_query:{...args.p_query,search:' padded '}},
    {...args,p_query:{...args.p_query,cursor:undefined}},{...args,p_query:{...args.p_query,view:'records'}},
    {...args,p_query:{...args.p_query,search:'x'.repeat(81)}},{...args,p_operation_id:id(1001)},
    {...args,p_command:{...args.p_command,extra:true}},{...args,p_command:{...args.p_command,expectedVersion:'0'}},
    ...[1,'true',null].map(enabled=>({...args,p_command:{...args.p_command,values:{...args.p_command.values,enabled}}})),
    {...args,p_command:{...args.p_command,values:{...args.p_command.values,timeZone:'Not/AZone'}}},
    {...args,p_command:{operationId:id(1001),expectedVersion:1,kind:'worker',values:{id:id(201),employeeId:id(102),workerNo:'W',displayName:'D',locationId:id(301),active:true,startsOn:'2026-02-30'}}}];
  for(const input of bad)await assert.rejects(h.transport.onboardingRpc(adminName,input),/^Error: onboarding_fixture_rpc_forbidden$/);
  assert.deepEqual(h.statements(),[]);assert.deepEqual(h.transport.onboardingCalls,[]);
});

test('self exact five-field intent and read-only original operation preserve actor/worker pin without widening accepted primitives',async()=>{
  for(const actor of [1,2,3,99])for(const action of ['clock_in','break_start','break_end','clock_out']){
    const args={...selfArgs(),p_auth_user_id:id(actor),p_command:{...selfCommand(),action}};
    assert.deepEqual(validateAttendanceOnboardingRpcInput(selfName,args),args);
  }
  for(const p_operation_id of [null,id(1001)]){
    const args={...selfArgs(),p_command:null,p_operation_id};assert.deepEqual(validateAttendanceOnboardingRpcInput(selfName,args),args);
  }
  const h=fixture(),args=selfArgs();
  const bad=[{...args,p_site_id:'99990002'},{...args,p_auth_user_id:id(4)},{...args,p_allow_new:true},
    {...args,p_operation_id:id(1001)},{...args,p_command:{...args.p_command,extra:true}},
    {...args,p_command:{...args.p_command,siteId:site}},
    ...[-1,0.1,'0',true,Number.MAX_SAFE_INTEGER].map(expectedSequence=>({...args,p_command:{...args.p_command,expectedSequence}})),
    {...args,p_command:{...args.p_command,expectedWorkerId:null}},
    {...args,p_command:{...args.p_command,action:'save'}},{...args,p_command:null,p_operation_id:undefined}];
  for(const input of bad)await assert.rejects(h.transport.onboardingRpc(selfName,input),/^Error: onboarding_fixture_rpc_forbidden$/);
  assert.deepEqual(h.statements(),[]);
});

test('setup and invitation inputs reuse their existing strict validators, and all secret-bearing logs stay name/error only',async()=>{
  const h=fixture();
  for(const name of setupNames)assert.deepEqual(await h.transport.onboardingRpc(name,{p_input:setupInput()}),{data:{opaquePureProbe:true},error:null});
  for(const name of [acceptName,waiveName])assert.deepEqual(await h.transport.onboardingRpc(name,{p_input:{merchant_id:site,
    auth_user_id:id(2),invitation_version:7,token_hash:'a'.repeat(64)}}),{data:{opaquePureProbe:true},error:null});
  assert.deepEqual(await h.transport.onboardingRpc(acceptName,{p_input:{merchant_id:site,auth_user_id:id(2)}}),{data:{opaquePureProbe:true},error:null});
  const expected=[...setupNames,acceptName,waiveName,acceptName].map(name=>({name,error:null}));
  assert.deepEqual(h.transport.onboardingCalls,expected);
  assert(!JSON.stringify(h.transport.onboardingCalls).includes('a'.repeat(64)));
  assert(!JSON.stringify(h.transport.onboardingCalls).includes('b'.repeat(64)));
  const before=h.statements().length;
  for(const name of [...setupNames,acceptName,waiveName]){
    await assert.rejects(h.transport.onboardingRpc(name,{p_input:{...setupInput(),auth_user_id:id(99)}}),/onboarding_fixture_rpc_forbidden/);
    await assert.rejects(h.transport.onboardingRpc(name,{p_input:{...setupInput(),auth_user_id:id(4)}}),/onboarding_fixture_rpc_forbidden/);
  }
  await assert.rejects(h.transport.onboardingRpc(waiveName,{p_input:{merchant_id:site,auth_user_id:id(2)}}),/onboarding_fixture_rpc_forbidden/);
  assert.equal(h.statements().length,before);
});

test('permitted RPCs construct only ownership-guarded real service-role statements and preserve opaque results',async()=>{
  const h=fixture();
  for(const [name,args] of [[roleName,{p_input:roleInput()}],[adminName,adminArgs()],[selfName,selfArgs()]]){
    assert.deepEqual(await h.transport.onboardingRpc(name,args),{data:{opaquePureProbe:true},error:null});
  }
  for(const statement of h.statements()){
    assert.match(statement,/^begin;reset role;do \$owned\$/);assert.match(statement,/c\.oid=456 and n\.oid=123/);
    assert(statement.includes(owned.marker));assert.match(statement,/set local role service_role/);
    assert.match(statement,/select jsonb_build_object\('role',current_user,'data',public\.faolla_/);
    assert.doesNotMatch(statement,/\b(?:insert|update|delete|truncate)\s+(?:into|from|public\.)/i);
  }
  assert.deepEqual(h.transport.onboardingCalls.map(call=>call.input),[roleInput(),adminArgs(),selfArgs()]);
});

test('actual default executors retain actor, query, original operation and worker pin on typed SQL rejection',async()=>{
  const h=fixture(()=>{throw Error('ERROR: attendance_access_denied\nDETAIL: never expose private SQL');});
  const service={rpc:h.transport.onboardingRpc};
  await assert.rejects(executeAttendanceSelf({siteId:site,authUserId:id(3),command:selfCommand(),operationId:null},service),error=>error.code==='attendance_access_denied');
  await assert.rejects(executeAttendanceSelf({siteId:site,authUserId:id(2),command:null,operationId:id(1001)},service),error=>error.code==='attendance_access_denied');
  await assert.rejects(executeAttendanceAdmin({siteId:site,authUserId:id(99),view:'settings',cursor:null,search:'',operationId:null,command:settingsCommand()},service),error=>error.code==='attendance_access_denied');
  assert.deepEqual(h.transport.onboardingCalls.map(call=>call.input),[
    {...selfArgs(),p_auth_user_id:id(3)}, {...selfArgs(),p_command:null,p_operation_id:id(1001)},adminArgs()]);
  assert(h.transport.onboardingCalls.every(call=>call.error==='attendance_access_denied'));
  assert.deepEqual(h.transport.onboardingErrors,[]);
});

test('ownership substitution, role mismatch and unknown or lookalike SQL codes fail closed without diagnostic data',async()=>{
  const changed=fixture();changed.setOwned({...owned,oid:999});
  await assert.rejects(changed.transport.onboardingRpc(selfName,selfArgs()),/^Error: onboarding_fixture_rpc_failed$/);
  assert.deepEqual(changed.statements(),[]);
  for(const message of ['ERROR: internal_error private-value','ERROR: attendance_access_denied123\nsecret','ERROR: attendance_access_deniedSensitive\nsecret']){
    const h=fixture(()=>{throw Error(message);});
    await assert.rejects(h.transport.onboardingRpc(selfName,selfArgs()),/^Error: onboarding_fixture_rpc_failed$/);
    assert.deepEqual(h.transport.onboardingErrors,['onboarding_fixture_rpc_failed']);
  }
  const wrongRole=fixture(()=>JSON.stringify({role:'postgres',data:{private:true}}));
  await assert.rejects(wrongRole.transport.onboardingRpc(selfName,selfArgs()),/^Error: onboarding_fixture_rpc_failed$/);
  const conflict=fixture(()=>{throw Error('ERROR: enterprise_version_conflict\nDETAIL: private');});
  assert.deepEqual(await conflict.transport.onboardingRpc(roleName,{p_input:roleInput()}),{data:null,error:{message:'enterprise_version_conflict'}});
});

test('ordinary strict reads cover owner and all three invitees; malformed recovery can never fall back to the ordinary reader',async()=>{
  const h=fixture(()=> '[]');
  for(const actor of [99,1,2,3]){
    const result=h.transport.onboardingRead(request('merchant_enterprise_employees',{select:'id',auth_user_id:'eq.'+id(actor),limit:'1'}));
    assert.deepEqual(await result.json(),[]);
  }
  assert.equal(h.transport.onboardingReadCalls.length,4);
  const before=h.statements().length;
  assert.throws(()=>h.transport.onboardingRead(request('merchant_enterprise_employees',{select:'id',auth_user_id:'eq.'+id(2),limit:'1',invitation_version:'eq.7'})),/invitation_browser_recovery_forbidden/);
  assert.throws(()=>h.transport.onboardingRead(request('merchant_enterprise_employees',{select:'id',auth_user_id:'eq.'+id(4),limit:'1'})),/employee_management_read_forbidden/);
  assert.equal(h.transport.onboardingReadCalls.length,4);assert.equal(h.statements().length,before);
});

test('preparation composes original fixtures, requires empty attendance and preserves complete raw facts with every other owned table protected',()=>{
  const source=readFileSync(new URL('./merchant-attendance-onboarding-fixture.mjs',import.meta.url),'utf8');
  assert.match(source,/await prepareAttendanceInitialPasswordFixture\(native,scope\)/);
  assert.match(source,/applyInitialPasswordReplayFixture\(native,scope,prepared\)/);
  assert.match(source,/await prepareAttendanceRoleManagement\(native,scope\)/);
  assert.match(source,/prepared\.exec\(self\.statement\)/);
  assert.match(source,/employee\.status==='invited'&&employee\.accepted_at===null/);
  assert.match(source,/settings:0,locations:0,workers:0,periods:0,events:0,configOperations:0/);
  assert.match(source,/onboarding_fixture_install_changed_enterprise_facts/);
  assert.match(source,/onboardingFacts=\(\)=>\(\{enterprise:prepared\.facts\(\)/);
  assert.match(source,/jsonb_agg\(to_jsonb\(t\) order by to_jsonb\(t\)::text\)/);
  assert.match(source,/relnamespace=\$\{prepared\.owned\.oid\} and relkind in\('r','p'\)/);
  assert.match(source,/catalog\.filter\(table=>!mutableTables\.has\(table\.name\)\)/);
  assert.match(source,/assert\.deepEqual\(tableCatalog\(\),catalog,'onboarding_fixture_table_catalog_changed'\)/);
  assert.match(source,/merchant_enterprise_staff_identities/);assert.match(source,/faolla_schema_migrations/);
  assert.match(source,/Object\.defineProperty\(prepared,'onboardingErrors'/);
  assert.doesNotMatch(source,/\b(?:insert into|update|delete from|truncate)\s+public\./i);
  assert.doesNotMatch(source,/console\.|create schema|drop schema|disable trigger|process\.env|spawn\(|listen\(|fetch\(|createClient\(/i);
});
