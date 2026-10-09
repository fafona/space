// Pure construction/boundary tests, not SQL execution or Auth acceptance proof.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {initialPasswordFixturePlan,validateInitialPasswordRpcInput,createInitialPasswordFixtureTransport} from './merchant-attendance-initial-password-fixture.mjs';
import {createInvitationBrowserTransport} from './merchant-attendance-invitation-browser-fixture.mjs';
import {qualifyAttendanceSandbox} from './merchant-attendance-concurrency-sandbox.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),plan=initialPasswordFixturePlan(root);
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const owned={schema:'attendance_race_'+'a'.repeat(32),oid:123,tableOid:456,owner:'postgres',marker:'faolla-synthetic-concurrency:12345678-1234-1234-1234-123456789abc'};
const input=()=>({merchant_id:'99990001',auth_user_id:id(2),invitation_version:7,token_hash:'a'.repeat(64),operation_id:id(1001),password_fingerprint:'b'.repeat(64)});
const invitation=()=>({siteId:'99990001',authUserId:id(2),invitationVersion:7,tokenHash:'a'.repeat(64),nowIso:'2026-10-03T12:00:00.000Z'});
function spy(reply=sql=>JSON.stringify({role:sql.includes('set local role service_role')?'service_role':'postgres',data:{opaquePureProbe:true}})){
  const sql=[];let currentOwned=owned;
  const raw=source=>{sql.push(source);return source.includes("'schema',n.nspname")?JSON.stringify(currentOwned):reply(source);};
  const prepared=createInvitationBrowserTransport(raw,owned),transport=createInitialPasswordFixtureTransport(prepared);
  return {prepared,transport,sql,setOwned:value=>{currentOwned=value;},businessSql:()=>sql.filter(value=>!value.includes("'schema',n.nspname"))};
}

test('only exact033 identity DDL and three complete043 definitions are extracted without altering their business bodies',()=>{
  assert.equal(plan.definitions.length,4);assert.equal(plan.definitions[0].name,'merchant_enterprise_staff_identities');
  assert.deepEqual(plan.definitions.slice(1).map(item=>item.name),plan.rpcNames);
  for(const source of plan.sources)assert.equal(source.source,readFileSync(path.join(root,'scripts/supabase-migrations',source.file),'utf8'));
  for(const definition of plan.definitions){
    const source=plan.sources.find(item=>item.file===definition.file).source;
    assert(source.includes(definition.original));assert.equal(definition.statement,definition.original);
    if(plan.rpcNames.includes(definition.name)){
      const complete=source.match(new RegExp(`create or replace function\\s+public\\.${definition.name}\\([\\s\\S]*?\\n\\$\\$;`));
      assert.equal(definition.statement,complete?.[0]);assert.match(definition.statement,/security definer\nset search_path = public/);
    }
  }
  assert.match(plan.definitions[0].statement,/auth_user_id uuid primary key/);
  assert.doesNotMatch(plan.definitions[0].statement,/references|auth\.users/);
  assert.throws(()=>initialPasswordFixturePlan('relative'),/absolute_root_required/);
});

test('source plan restricts execute grants to its three service RPCs, denies identity direct rights and retains the diagnosed policy order',()=>{
  assert(Object.isFrozen(plan.rpcNames));assert.equal(plan.rpcNames.length,3);
  assert.deepEqual(plan.statements.filter(value=>value.startsWith('grant ')),plan.rpcNames.map(name=>`grant execute on function public.${name}(jsonb) to service_role;`));
  for(const name of plan.rpcNames)assert(plan.statements.includes(`revoke all on function public.${name}(jsonb) from public,anon,authenticated,service_role;`));
  assert(plan.statements.includes('alter table public.merchant_enterprise_staff_identities enable row level security;'));
  assert(plan.statements.includes('revoke all on table public.merchant_enterprise_staff_identities from public,anon,authenticated,service_role;'));
  const claim=plan.definitions[1].statement,complete=plan.definitions[2].statement;
  assert(claim.indexOf("initial_password_policy <> 'required'")<claim.indexOf("v_setup.state = 'completed'"));
  assert.match(complete,/set initial_password_policy = 'completed'/);
  assert.doesNotMatch(plan.statements.join('\n'),/auth_password_recovery_grants|auth\.users|owner to|create role|alter role|faolla_schema_migrations/i);
});

test('namespace-only source rewriting leaves no public qualifier or search_path and preserves complete original function contents otherwise',()=>{
  for(const definition of plan.definitions){
    const scoped=qualifyAttendanceSandbox(definition.statement.replace(/(set search_path\s*=\s*)public\b/g,`$1${owned.schema}`),owned.schema);
    assert.doesNotMatch(scoped,/\bpublic\.|set search_path\s*=\s*public\b/);
    assert.equal(scoped.replaceAll(owned.schema,'public'),definition.original);
  }
});

test('RPC validation accepts exact six-key synthetic inputs and rejects extra keys, types, subjects, generations, hashes and UUID variants',()=>{
  for(const name of plan.rpcNames)assert.deepEqual(validateInitialPasswordRpcInput(name,{p_input:input()}),input());
  const invalid=[null,[],{}, {p_input:input(),extra:true},{p_input:{...input(),password:'do-not-log'}},
    {p_input:{...input(),merchant_id:'99990002'}},{p_input:{...input(),auth_user_id:id(99)}},
    {p_input:{...input(),auth_user_id:id(4)}},{p_input:{...input(),invitation_version:'7'}},
    {p_input:{...input(),invitation_version:8}},{p_input:{...input(),invitation_version:true}},
    {p_input:{...input(),token_hash:'A'.repeat(64)}},{p_input:{...input(),token_hash:'x'.repeat(43)}},
    {p_input:{...input(),password_fingerprint:null}},{p_input:{...input(),operation_id:id(1001).replace('-4000-','-1000-')}},
    {p_input:{...input(),operation_id:id(1001)+"';select 1;"}}];
  for(const args of invalid)assert.throws(()=>validateInitialPasswordRpcInput(plan.rpcNames[0],args));
  for(const name of ['faolla_accept_merchant_employee_invitation_v1',plan.rpcNames[0]+';select 1','unknown'])
    assert.throws(()=>validateInitialPasswordRpcInput(name,{p_input:input()}));
});

test('valid calls build actual guarded service-role RPC statements and preserve opaque SQL replies without invented setup success',async()=>{
  const h=spy();
  for(const name of plan.rpcNames)assert.deepEqual(await h.transport.initialPasswordRpc(name,{p_input:input()}),{data:{opaquePureProbe:true},error:null});
  for(const source of h.businessSql()){
    assert.match(source,/^begin;reset role;do \$owned\$/);assert.match(source,/c\.oid=456 and n\.oid=123/);
    assert(source.includes(owned.marker));assert.match(source,/set local role service_role/);
    assert(plan.rpcNames.some(name=>source.includes('public.'+name+'(')));
  }
  assert.deepEqual(h.transport.initialPasswordRpcCalls,plan.rpcNames.map(name=>({name,error:null})));
  assert(!JSON.stringify(h.transport.initialPasswordRpcCalls).includes(input().token_hash));
  assert(!JSON.stringify(h.transport.initialPasswordRpcCalls).includes(input().password_fingerprint));
});

test('factory reads project the exact handler columns and predicates under an owned read-only diagnostic transaction',()=>{
  const h=spy();
  assert.deepEqual(h.transport.loadInvitation(invitation()),{data:{opaquePureProbe:true},error:null});
  assert.deepEqual(h.transport.loadRole({siteId:'99990001',roleId:id(30)}),{data:{opaquePureProbe:true},error:null});
  assert.deepEqual(h.transport.loadStaffIdentity({authUserId:id(2),emailHash:'c'.repeat(64)}),{data:{opaquePureProbe:true},error:null});
  const sql=h.businessSql();assert.equal(sql.length,3);
  for(const statement of sql){assert.match(statement,/^begin read only;reset role;do \$owned\$/);assert.doesNotMatch(statement,/set local role service_role/);assert.match(statement,/limit 1/);}
  assert.match(sql[0],/select id,merchant_id,auth_user_id,email,role_id,status,accepted_at,invitation_version,invitation_token_hash,invitation_expires_at,invitation_revoked_at/);
  assert.match(sql[0],/status='invited' and accepted_at is null and invitation_revoked_at is null/);
  assert.match(sql[0],/invitation_version=7 and invitation_token_hash=/);assert.match(sql[0],/invitation_expires_at>'2026-10-03T12:00:00\.000Z'::timestamptz/);
  assert.match(sql[1],/select id,merchant_id,status/);assert.match(sql[1],/status='active'/);
  assert.match(sql[2],/select auth_user_id,email_hash,principal_type/);assert.match(sql[2],/principal_type='merchant_staff'/);
  assert.deepEqual(h.transport.initialPasswordReadCalls,[{kind:'invitation'},{kind:'role'},{kind:'identity'}]);
});

test('malformed read or RPC arguments fail before any business SQL and null database matches remain null',async()=>{
  const h=spy(()=>JSON.stringify({role:'postgres',data:null}));
  for(const value of [{...invitation(),siteId:'99990002'},{...invitation(),authUserId:id(99)},
    {...invitation(),nowIso:'2026-10-03'},{...invitation(),nowIso:"';delete"},{...invitation(),extra:true}])
    assert.throws(()=>h.transport.loadInvitation(value),/^Error: initial_password_fixture_read_forbidden$/);
  for(const value of [{siteId:'99990001',roleId:id(33)},{siteId:'99990002',roleId:id(30)}])
    assert.throws(()=>h.transport.loadRole(value),/^Error: initial_password_fixture_read_forbidden$/);
  for(const value of [{authUserId:id(4),emailHash:'a'.repeat(64)},{authUserId:id(2),emailHash:'a'.repeat(64),extra:true}])
    assert.throws(()=>h.transport.loadStaffIdentity(value),/^Error: initial_password_fixture_read_forbidden$/);
  await assert.rejects(h.transport.initialPasswordRpc('unknown',{p_input:input()}),/^Error: initial_password_fixture_rpc_forbidden$/);
  assert.deepEqual(h.businessSql(),[]);assert.deepEqual(h.transport.initialPasswordReadCalls,[]);
  assert.deepEqual(h.transport.loadInvitation(invitation()),{data:null,error:null});
});

test('ownership substitution and unknown SQL failures are fixed failures; only exact known SQL codes are returned without secret details',async()=>{
  const h=spy();h.setOwned({...owned,oid:999});
  await assert.rejects(h.transport.initialPasswordRpc(plan.rpcNames[0],{p_input:input()}),/^Error: initial_password_fixture_rpc_failed$/);
  assert.throws(()=>h.transport.loadInvitation(invitation()),/^Error: initial_password_fixture_read_failed$/);assert.deepEqual(h.businessSql(),[]);
  const unknown=spy(()=>{throw Error('ERROR: internal_error '+input().token_hash+' '+input().password_fingerprint);});
  await assert.rejects(unknown.transport.initialPasswordRpc(plan.rpcNames[0],{p_input:input()}),/^Error: initial_password_fixture_rpc_failed$/);
  assert.deepEqual(unknown.transport.initialPasswordErrors,['initial_password_fixture_rpc_failed']);
  const known=spy(()=>{throw Error('ERROR: employee_initial_password_not_required\nDETAIL: '+input().password_fingerprint);});
  assert.deepEqual(await known.transport.initialPasswordRpc(plan.rpcNames[0],{p_input:input()}),{data:null,error:{message:'employee_initial_password_not_required'}});
  assert.deepEqual(known.transport.initialPasswordRpcCalls,[{name:plan.rpcNames[0],error:'employee_initial_password_not_required'}]);
});

test('preparation retains original invited prestate, checks absent objects and real ACLs, and seeds only three identity hashes',()=>{
  const source=readFileSync(new URL('./merchant-attendance-initial-password-fixture.mjs',import.meta.url),'utf8');
  assert.match(source,/await prepareInvitationBrowser\(native,scope\)/);
  assert.match(source,/to_regclass\('public\.\$\{identityTable\}'\) is not null/);
  assert.match(source,/to_regprocedure\('public\.'\|\|f\.signature\) is not null/);
  assert.match(source,/initial_password_fixture_install_changed_facts/);assert.match(source,/initial_password_fixture_seed_changed_facts/);
  assert.match(source,/functions:3,serviceCallable:3,browserCallable:0,identityRls:true,identityDirectPrivileges:0,identities:3/);
  assert.match(source,/prepared\.exec\(scoped\(`/);assert.match(source,/initial_password_fixture_qualification_required/);
  assert.match(source,/createHash\('sha256'\)\.update\(actor\.email\.trim\(\)\.toLowerCase\(\),'utf8'\)/);
  assert.match(source,/injectedReadRole:'postgres',defaultRestDependencies:false,seededIdentities:3,seededSetups:0,seededActiveEmployees:0/);
  assert.match(source,/protectedFingerprint:\(\)=>originalFingerprint\(\)/);
  assert.doesNotMatch(source,/\binsert into public\.(?:merchant_enterprise_employees|merchant_employee_initial_password_setups|merchant_attendance_)/);
  assert.doesNotMatch(source,/console\.|create schema|drop schema|disable trigger|spawn\(|listen\(|fetch\(|createClient\(/i);
});

test('candidate replay installation is opt-in, ownership checked and preserves actual facts and function ownership on reapplication',()=>{
  const text=readFileSync(new URL('./merchant-attendance-initial-password-fixture.mjs',import.meta.url),'utf8');
  const start=text.indexOf('export function applyInitialPasswordReplayFixture(');assert(start>=0);const section=text.slice(start);
  assert.match(section,/assertLifecycleSandbox\(prepared\.exec\),prepared\.owned/);
  assert.match(section,/202610030114_merchant_employee_initial_password_replay\.sql/);
  assert.match(section,/source-subset fixture, NOT evidence/);
  assert.match(section,/initial_password_replay_fresh_registry_required/);
  assert.match(section,/initial_password_replay_migration_changed_facts/);
  assert.match(section,/initial_password_replay_migration_changed_acl_or_owner/);
  assert.equal((section.match(/prepared\.exec\(scoped\)/g)||[]).length,2);
  assert.match(section,/assert\.deepEqual\(catalog\(\),previousCatalog\)/);
  assert.doesNotMatch(section,/insert into public\.(?:merchant_enterprise_employees|merchant_employee_initial_password_setups)|owner to|create role/i);
});
