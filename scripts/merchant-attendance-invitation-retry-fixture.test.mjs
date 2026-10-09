// Pure construction tests only. Captured installation SQL is never executed.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {invitationRetryFixturePlan,prepareAttendanceInvitationRetry} from './merchant-attendance-invitation-retry-fixture.mjs';
import {qualifyAttendanceSandbox} from './merchant-attendance-concurrency-sandbox.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),plan=invitationRetryFixturePlan(root);
const accept='faolla_accept_merchant_employee_invitation_v1',waive='faolla_waive_employee_initial_password_v1';
const owned={schema:'attendance_race_'+'a'.repeat(32),oid:123,tableOid:456,owner:'postgres',marker:'faolla-synthetic-concurrency:12345678-1234-1234-1234-123456789abc'};
const scope={schema:owned.schema,sql:value=>qualifyAttendanceSandbox(value,owned.schema)};
const before={merchants:'a'.repeat(32),employees:'b'.repeat(32),roles:'c'.repeat(32),audits:'d'.repeat(32),events:'e'.repeat(32)};
const stop=Error('pure probe: stop before SQL installation');
const native=patch=>({root,query:source=>JSON.stringify(source.includes('obj_description')?owned:before),querySteps:async()=>{throw stop;},...patch});

test('four complete original functions preserve the exact003 -> audit019 -> password043 chain',()=>{
  assert.deepEqual(plan.sources.map(item=>item.file),plan.sourceMigrations);
  for(const item of plan.sources)assert.equal(item.source,readFileSync(path.join(root,'scripts/supabase-migrations',item.file),'utf8'));
  const functions=plan.definitions.filter(item=>item.kind==='function');assert.equal(functions.length,4);
  assert.deepEqual(functions.map(item=>item.name),[accept+'_preaudit_019','faolla_accept_employee_invite_pre043',waive,accept]);
  for(const [index,item] of functions.entries()){
    const originalFile=plan.sources.find(source=>source.file===item.file).source;assert(originalFile.includes(item.original));
    assert.match(item.original,/^create or replace function\s+public\./);assert.match(item.original,/\n\$\$;$/);
    assert.equal(item.statement,index<2?item.original.replace(`public.${accept}(`,`public.${item.name}(`):item.original);
    assert.equal(item.statement.slice(item.statement.indexOf('as $$')),item.original.slice(item.original.indexOf('as $$')));
  }
  assert.match(functions[1].statement,/'invitation.accept', 'accepting_employee'/);
  assert.match(functions[1].statement,/faolla_accept_merchant_employee_invitation_v1_preaudit_019\(p_input\)/);
  assert.match(functions[3].statement,/faolla_accept_employee_invite_pre043\(p_input\)/);
  assert.throws(()=>invitationRetryFixturePlan('relative'),/absolute_root_required/);
});

test('policy prefix, full setup table and partial unique index are copied from043 without loading its unrelated recovery/bind chain',()=>{
  const ddl=plan.definitions.filter(item=>item.kind==='ddl');assert.equal(ddl.length,3);
  for(const item of ddl){assert.equal(item.statement,item.original);assert(plan.sources.find(source=>source.file===item.file).source.includes(item.original));}
  const policy=ddl.find(item=>item.name==='initial-password-policy').statement;
  assert.match(policy,/add column if not exists initial_password_policy text default 'waived'/);
  assert.match(policy,/where initial_password_policy is null/);assert.match(policy,/set default 'required'/);assert.match(policy,/set not null/);
  assert.match(policy,/check \(initial_password_policy in \('required', 'waived', 'completed'\)\)/);
  assert.match(ddl[1].statement,/references public\.merchant_enterprise_employees\(id\) on delete cascade/);
  assert.match(ddl[1].statement,/unique \(merchant_id, auth_user_id\)/);assert.match(ddl[2].statement,/where state = 'claimed'/);
  const sql=plan.statements.join('\n');
  assert.doesNotMatch(sql,/auth_password_recovery|bind_employee_invite_identity|faolla_schema_migrations|owner to supabase_admin|create role|alter role/i);
});

test('legacy active replay and pre-accept waiver rejection remain unmodified for the diagnostic',()=>{
  const functions=plan.definitions.filter(item=>item.kind==='function');
  assert.match(functions[0].statement,/if v_employee\.status = 'active' then[\s\S]*?'already_active',[\s\S]*?true/);
  assert.match(functions[0].statement,/invitation_token_hash = null/);
  const waiver=functions[2].statement;
  const check=waiver.indexOf("if v_employee.status <> 'invited'"),policy=waiver.indexOf("if v_employee.initial_password_policy = 'waived'");
  assert(check>0&&policy>check);assert.match(waiver.slice(check,policy),/employee_invitation_invalid_or_expired/);
  assert.match(functions[3].statement,/employee_initial_password_setup_incomplete/);
});

test('only the two intended public functions are executable and setup table grants no direct service/browser access',()=>{
  assert.deepEqual(plan.rpcNames,[waive,accept]);assert(Object.isFrozen(plan.rpcNames));
  assert.deepEqual(plan.statements.filter(statement=>statement.startsWith('grant ')),
    plan.rpcNames.map(name=>`grant execute on function public.${name}(jsonb) to service_role;`));
  for(const signature of plan.functions)assert(plan.statements.includes(`revoke all on function public.${signature} from public,anon,authenticated,service_role;`));
  assert(plan.statements.includes('alter table public.merchant_employee_initial_password_setups enable row level security;'));
  assert(plan.statements.includes('revoke all on table public.merchant_employee_initial_password_setups from public,anon,authenticated,service_role;'));
});

test('constructed transaction fences exact owned OIDs, schema, marker and merchant fingerprint before and after installation',async()=>{
  let steps;await assert.rejects(prepareAttendanceInvitationRetry(native({querySteps:async input=>{steps=input;throw stop;}}),scope),error=>error===stop);
  assert.match(steps[0],/^begin;reset role;/);assert.equal(steps.at(-1),'commit;');
  for(const statement of [steps[0],steps.at(-2)]){
    assert.match(statement,/c\.oid=456 and n\.oid=123/);assert(statement.includes(owned.schema));assert(statement.includes(owned.marker));
    assert(statement.includes(before.merchants));assert.match(statement,/invitation_retry_merchants_changed/);assert.match(statement,/n\.nspowner::regrole::text='postgres'/);
  }
  assert.match(steps[0],/invitation_retry_management_prerequisite_required/);assert.match(steps[0],/invitation_retry_fixture_already_present/);
  assert.match(steps[0],/attname='initial_password_policy'/);assert.match(steps[0],/merchant_enterprise_employees_touch/);
  for(const step of steps){assert.doesNotMatch(step,/\bpublic\./);assert.doesNotMatch(step,/set search_path\s*=\s*public\b/);}
  for(const definition of plan.definitions){
    const expected=scope.sql(definition.statement.replace(/(set search_path\s*=\s*)public\b/g,`$1${owned.schema}`));assert(steps.includes(expected));
  }
});

test('unowned, mismatched, unqualified or malformed-fingerprint inputs cannot reach installation',async()=>{
  for(const patch of [{schema:'public'},{owner:'service_role'},{oid:0},{tableOid:0},{marker:'not-owned'}]){
    let submitted=false;
    await assert.rejects(prepareAttendanceInvitationRetry(native({query:()=>JSON.stringify({...owned,...patch}),querySteps:async()=>{submitted=true;}}),scope),/lifecycle_owned_schema_required/);
    assert.equal(submitted,false);
  }
  await assert.rejects(prepareAttendanceInvitationRetry(native(),{...scope,schema:'attendance_race_'+'b'.repeat(32)}),/scope_mismatch/);
  await assert.rejects(prepareAttendanceInvitationRetry(native(),{...scope,sql:value=>value}),/qualifier_required/);
  await assert.rejects(prepareAttendanceInvitationRetry(native({query:sql=>JSON.stringify(sql.includes('obj_description')?owned:{...before,merchants:'unsafe'})}),scope),/merchant_fingerprint_required/);
});

test('postconditions independently require real catalogs, preserved prior facts and zero seeds without external services',()=>{
  const source=readFileSync(new URL('./merchant-attendance-invitation-retry-fixture.mjs',import.meta.url),'utf8');
  assert.match(source,/invitation_retry_install_changed_original_facts/);assert.match(source,/to_jsonb\(t\)-'initial_password_policy'/);
  assert.match(source,/functions:4,servicePublic:2,servicePrivate:0,browserCallable:0,setupRls:true,setupPrivileges:0,setupRows:0,nonWaivedExisting:0/);
  assert.match(source,/p\.prosecdef and p\.proowner='postgres'::regrole and p\.proconfig/);
  assert.match(source,/has_table_privilege\(r\.name/);assert.match(source,/seededEmployees:0/);
  assert.doesNotMatch(source,/dotenv|DATABASE_URL|SUPABASE_|spawn\(|createClient|listen\(|drop schema|create schema|disable trigger|\.rpc\(|insert into public\./i);
});
