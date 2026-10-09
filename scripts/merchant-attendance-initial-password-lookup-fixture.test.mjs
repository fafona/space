// Pure construction and failure-boundary checks, not PostgreSQL/Auth evidence.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {initialPasswordLookupFixturePlan,createInitialPasswordLookupTransport,installInitialPasswordLookupFixture} from './merchant-attendance-initial-password-lookup-fixture.mjs';
import {createInvitationBrowserTransport} from './merchant-attendance-invitation-browser-fixture.mjs';
import {qualifyAttendanceSandbox} from './merchant-attendance-concurrency-sandbox.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const owned={schema:'attendance_race_'+'a'.repeat(32),oid:123,tableOid:456,owner:'postgres',
  marker:'faolla-synthetic-concurrency:12345678-1234-1234-1234-123456789abc'};
const scope={schema:owned.schema,sql:source=>qualifyAttendanceSandbox(source,owned.schema)};
const name='faolla_lookup_merchant_enterprise_staff_identity_v1';
const hash=value=>createHash('sha256').update(value,'utf8').digest('hex');
const actors=[1,2,3].map(n=>({id:id(n),email:`invite-retry-${n}@example.test`}));
const originalRows=()=>actors.map(actor=>({auth_user_id:actor.id,email_hash:hash(actor.email),principal_type:'merchant_staff',created_at:'2026-10-03T12:00:00.123456+00:00'}));
const plan=initialPasswordLookupFixturePlan(root,scope);
const expectedCatalog={lookup:{stable:true,definer:true,owner:'postgres',path:['search_path='+owned.schema]},service:true,browser:0,
  digest:{immutable:true,strict:true,invoker:true,owner:'postgres'},digestCallable:0,tablesPrivate:0,authRls:true,authRows:3};
function fixture(reply=()=>JSON.stringify({role:'service_role',data:{opaquePureProbe:true}})){
  let currentOwned=owned,rows=originalRows();const sql=[];
  const raw=source=>{
    sql.push(source);
    if(source.includes("'schema',n.nspname"))return JSON.stringify(currentOwned);
    if(source.includes("'lookup',(select jsonb_build_object"))return JSON.stringify(expectedCatalog);
    if(source.includes('create table '+owned.schema+'.merchant_enterprise_fixture_auth_users'))return '';
    if(source.includes("'users',(select"))return 'auth-and-acl-fingerprint';
    if(source.includes('jsonb_agg(to_jsonb(t) order by auth_user_id)'))return JSON.stringify(rows);
    if(source.includes('with removed as(delete from')){
      const target=source.match(/where auth_user_id='([^']+)'/)[1];const old=rows.find(row=>row.auth_user_id===target);assert(old);
      const json=source.match(/and to_jsonb\(merchant_enterprise_staff_identities\)='((?:''|[^'])*)'::jsonb/)[1];
      assert.deepEqual(JSON.parse(json.replaceAll("''","'")),old);rows=rows.filter(row=>row!==old);return '1';
    }
    if(source.includes('do $restore$')){
      const data=source.match(/jsonb_populate_record\(null::public\.merchant_enterprise_staff_identities,'((?:''|[^'])*)'::jsonb\)/)[1];
      const old=JSON.parse(data.replaceAll("''","'"));
      if(rows.some(row=>row.auth_user_id===old.auth_user_id||row.email_hash===old.email_hash))throw Error('ERROR: initial_password_lookup_restore_conflict');
      rows.push(old);rows.sort((a,b)=>a.auth_user_id.localeCompare(b.auth_user_id));return '';
    }
    return reply(source);
  };
  const prepared=createInvitationBrowserTransport(raw,owned);
  Object.assign(prepared,{actors,facts:()=>({employees:[{status:'invited'}],setups:[],audits:[]}),
    protectedFingerprint:()=>JSON.stringify(rows)});
  const transport=createInitialPasswordLookupTransport(prepared);
  return {prepared,transport,sql,setOwned:value=>{currentOwned=value;},rows:()=>structuredClone(rows),
    business:()=>sql.filter(source=>!source.includes("'schema',n.nspname"))};
}

test('lookup plan reproduces whole033 definition plus the exact042 digest repair and original service-only ACL',()=>{
  assert.equal(plan.originalSource,readFileSync(path.join(root,'scripts/supabase-migrations',plan.sourceMigrations[0]),'utf8'));
  assert.equal(plan.repairSource,readFileSync(path.join(root,'scripts/supabase-migrations',plan.sourceMigrations[1]),'utf8'));
  assert(plan.originalSource.includes(plan.original));assert(plan.originalSource.includes(plan.revoke));assert(plan.originalSource.includes(plan.grant));
  assert.equal(plan.latest,plan.original.replace('digest(','extensions.digest('));
  assert.equal((plan.latest.match(/extensions\.digest\(/g)||[]).length,1);assert.equal((plan.latest.match(/auth\.users/g)||[]).length,1);
  assert.match(plan.latest,/language plpgsql\r?\nstable\r?\nsecurity definer/);
  assert.match(plan.grant,/to service_role;/);assert.match(plan.revoke,/from public, anon, authenticated, service_role;/);
  assert.match(plan.repairSource,/'public\.faolla_lookup_merchant_enterprise_staff_identity_v1\(text\)'/);
});

test('namespace/auth/digest adaptation is fully reversible with no real auth/public/extension references left',()=>{
  const definition=plan.statements[2];
  const reversed=definition.replaceAll(owned.schema+'.digest(','extensions.digest(')
    .replaceAll(owned.schema+'.merchant_enterprise_fixture_auth_users','auth.users')
    .replaceAll(owned.schema,'public');
  assert.equal(reversed,plan.latest);
  for(const statement of plan.statements)assert.doesNotMatch(statement,/\bauth\.users\b|\bpublic\.|\bextensions\.digest\(/);
  assert.throws(()=>initialPasswordLookupFixturePlan('relative',scope));
  assert.throws(()=>initialPasswordLookupFixturePlan(root,{schema:'public',sql:value=>value}));
  assert.throws(()=>initialPasswordLookupFixturePlan(root,{schema:owned.schema,sql:value=>value}));
});

test('real SHA256 wrapper is immutable strict invoker and private; synthetic Auth relation has no direct runtime grants',()=>{
  assert.match(plan.wrapper,/immutable strict security invoker set search_path=pg_catalog/);
  assert.match(plan.wrapper,/p_algorithm is distinct from 'sha256'/);assert.match(plan.wrapper,/return pg_catalog\.sha256\(p_data\)/);
  assert.match(plan.wrapper,/revoke all on function public\.digest\(bytea,text\) from public,anon,authenticated,service_role/);
  assert.match(plan.statements[0],/enable row level security/);assert.match(plan.statements[0],/revoke all on table .* from public,anon,authenticated,service_role/);
  assert.equal(plan.statements.filter(statement=>/^grant execute/.test(statement)).length,1);
  assert.doesNotMatch(plan.statements.join('\n'),/create extension|grant select|grant all|alter role|create role|auth\.users/i);
});

test('lookup accepts one exact hash field for prepared synthetic actors only and never logs hashes or returned subjects',async()=>{
  const h=fixture(()=>JSON.stringify({role:'service_role',data:{found:true,auth_user_id:id(2),source:'registry'}}));
  for(const actor of actors)await h.transport.lookupRpc(name,{p_email_hash:hash(actor.email)});
  assert.deepEqual(h.transport.lookupCalls,actors.map(()=>({name,error:null,source:'registry'})));
  const before=h.business().length;
  const bad=[null,[],{}, {p_email_hash:hash(actors[1].email),extra:true},{p_email_hash:'a'.repeat(64)},
    {p_email_hash:hash(actors[1].email).toUpperCase()},{p_email_hash:' '+hash(actors[1].email)},{p_email_hash:null}];
  for(const args of bad)await assert.rejects(h.transport.lookupRpc(name,args),/^Error: initial_password_lookup_rpc_forbidden$/);
  await assert.rejects(h.transport.lookupRpc(name+';select 1',{p_email_hash:hash(actors[1].email)}),/initial_password_lookup_rpc_forbidden/);
  assert.equal(h.business().length,before);
  const log=JSON.stringify({calls:h.transport.lookupCalls,errors:h.transport.lookupErrors});
  for(const actor of actors)assert(!log.includes(actor.id)&&!log.includes(actor.email)&&!log.includes(hash(actor.email)));
});

test('lookup SQL is guarded read-only service execution; namespace/unknown errors fail closed and exact known conflicts remain typed',async()=>{
  const h=fixture();assert.deepEqual(await h.transport.lookupRpc(name,{p_email_hash:hash(actors[1].email)}),{data:{opaquePureProbe:true},error:null});
  const source=h.business()[0];assert.match(source,/^begin read only;reset role;do \$owned\$/);
  assert.match(source,/c\.oid=456 and n\.oid=123/);assert(source.includes(owned.marker));assert.match(source,/set local role service_role/);
  assert.match(source,/public\.faolla_lookup_merchant_enterprise_staff_identity_v1\('[a-f0-9]{64}'\)/);
  assert.doesNotMatch(source,/\b(insert|update|delete)\b/i);
  const changed=fixture();changed.setOwned({...owned,oid:999});
  await assert.rejects(changed.transport.lookupRpc(name,{p_email_hash:hash(actors[1].email)}),/^Error: initial_password_lookup_rpc_failed$/);assert.deepEqual(changed.business(),[]);
  const failed=fixture(()=>{throw Error('ERROR: private_detail '+hash(actors[1].email));});
  await assert.rejects(failed.transport.lookupRpc(name,{p_email_hash:hash(actors[1].email)}),/^Error: initial_password_lookup_rpc_failed$/);
  const conflict=fixture(()=>{throw Error('ERROR: merchant_enterprise_staff_identity_conflict\nDETAIL: private-value');});
  assert.deepEqual(await conflict.transport.lookupRpc(name,{p_email_hash:hash(actors[1].email)}),{data:null,error:{message:'merchant_enterprise_staff_identity_conflict'}});
});

test('missing-registry case removes only its exact row, restores every original field on callback failure, and forbids overlapping cases',async()=>{
  const h=fixture(),before=h.rows();let entered=0;
  const value=await h.transport.withMissingRegistry(actors[1],async()=>{
    entered++;assert.deepEqual(h.rows(),before.filter(row=>row.auth_user_id!==actors[1].id));
    await assert.rejects(h.transport.withMissingRegistry(actors[0],async()=>{}),/initial_password_lookup_case_already_running/);
    return 'callback result';
  });
  assert.equal(value,'callback result');assert.equal(entered,1);assert.deepEqual(h.rows(),before);
  await assert.rejects(h.transport.withMissingRegistry(actors[1],async()=>{throw Error('bounded callback failure');}),/bounded callback failure/);
  assert.deepEqual(h.rows(),before);assert.equal(h.rows()[1].created_at,'2026-10-03T12:00:00.123456+00:00');
  await assert.rejects(h.transport.withMissingRegistry({...actors[1],id:id(99)},async()=>{}),/initial_password_lookup_case_actor_forbidden/);
  const removes=h.business().filter(source=>source.includes('with removed as(delete from'));
  const restores=h.business().filter(source=>source.includes('do $restore$'));assert.equal(removes.length,2);assert.equal(restores.length,2);
  for(const source of [...removes,...restores])assert.match(source,/c\.oid=456 and n\.oid=123/);
  assert(restores.every(source=>source.includes('initial_password_lookup_restore_conflict')&&source.includes('jsonb_populate_record')));
});

test('installation construction preserves prepared registry/facts, seeds only private synthetic Auth rows and verifies original runtime ACLs',()=>{
  const h=fixture(),before=h.rows();
  const installed=installInitialPasswordLookupFixture({root},scope,h.prepared);
  assert.equal(typeof installed.lookupRpc,'function');assert.equal(typeof installed.withMissingRegistry,'function');
  assert.deepEqual(installed.installation.catalog,expectedCatalog);assert.equal(installed.installation.identityDirectGrants,false);
  assert.equal(installed.installation.registryChanged,false);assert.equal(installed.installation.syntheticAuthRows,3);
  assert.deepEqual(h.rows(),before);
  const statement=h.business().find(source=>source.includes('create table '+owned.schema+'.merchant_enterprise_fixture_auth_users'));assert(statement);
  assert.match(statement,/initial_password_lookup_fresh_objects_required/);assert.match(statement,/pg_catalog\.sha256\(bytea\)/);
  assert.match(statement,/initial_password_lookup_private_registry_required/);
  assert.match(statement,/insert into .*merchant_enterprise_fixture_auth_users\(id,email,raw_app_meta_data\)/);
  assert.doesNotMatch(statement,/insert into .*merchant_enterprise_staff_identities/);
  // The real rawExec applies scope.sql after the common owned guard is added.
  assert.doesNotMatch(scope.sql(statement),/grant select|auth\.users|\bextensions\.|\bpublic\.|create extension/);
});

test('fixture limits Auth adaptation to private data and retains finally restoration without disabling registry protections',()=>{
  const source=readFileSync(new URL('./merchant-attendance-initial-password-lookup-fixture.mjs',import.meta.url),'utf8');
  assert.match(source,/same\(prepared\.facts\(\),before,'initial_password_lookup_install_changed_facts'\)/);
  assert.match(source,/initial_password_lookup_install_changed_protected_facts/);
  assert.match(source,/initial_password_lookup_case_changed_auth_or_acl/);
  assert.match(source,/finally\{[\s\S]*if\(removed\)/);
  assert.match(source,/initial_password_lookup_restore_conflict/);
  assert.doesNotMatch(source,/disable trigger|session_replication_role|create extension|fetch\(|spawn\(|console\.|process\.env|create schema|drop schema/);
});
