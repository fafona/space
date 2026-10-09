import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {onsiteLifecyclePlan,checkAttendanceOnsiteLifecycle} from './merchant-attendance-onsite-lifecycle-checks.mjs';

const source=readFileSync(new URL('./merchant-attendance-onsite-lifecycle-checks.mjs',import.meta.url),'utf8');
const owned={schema:'attendance_race_'+'a'.repeat(32),oid:321,tableOid:654,owner:'postgres',
  marker:'faolla-synthetic-concurrency:12345678-1234-1234-1234-123456789abc'};
function probe({isolation=owned,existing='0'}={}){
  const calls=[],sentinel=Error('pure construction stops before any SQL execution');
  const native={query:statement=>{
    calls.push(statement);
    if(statement.includes("'marker',obj_description"))return JSON.stringify(isolation);
    if(statement.startsWith('reset role;select count(*)'))return existing;
    throw sentinel;
  },connect:()=>{throw Error('pure construction must not open a connection');},pass:()=>{throw Error('pure construction must not report a business pass');}};
  return {native,calls,sentinel};
}

test('onsite lifecycle plan constructs three independent synthetic actors and original six-field commands, without claiming business results',()=>{
  const plan=onsiteLifecyclePlan();assert.equal(plan.site,'99990005');assert.equal(plan.subjects.length,3);
  assert.equal(new Set(plan.subjects.flatMap(p=>[p.auth,p.employee,p.worker,p.role,p.command.operationId])).size,15);
  for(const p of plan.subjects){
    for(const key of ['auth','employee','worker','role'])assert.match(p[key],/^00000000-0000-4000-8000-000001022\d{3}$/);
    assert.deepEqual(Object.keys(p.command).sort(),['action','expectedEmployeeId','expectedSequence','expectedWorkerId','locationId','operationId']);
    assert.equal(p.command.expectedWorkerId,p.worker);assert.equal(p.command.expectedEmployeeId,p.employee);
    assert.equal(p.command.locationId,plan.location);assert.equal(p.command.action,'clock_in');assert.equal(p.command.expectedSequence,0);
  }
  assert.equal((plan.seed.match(/@example\.test/g)||[]).length,3);
  assert.match(plan.seed,/web_clock_enabled\) values\('99990005','UTC',true,false\)/);
  assert.equal((plan.seed.match(/'2000-01-01'/g)||[]).length,3);
  assert.doesNotMatch(plan.seed,/insert into public\.merchant_attendance_(events|onsite_receipts)/);
});

test('entry revalidates owned namespace/table identity and tenant absence before constructing fixture inserts',async()=>{
  const p=probe();await assert.rejects(checkAttendanceOnsiteLifecycle(p.native,{sql:s=>s}),error=>error===p.sentinel);
  assert.equal(p.calls.length,3);const seed=p.calls[2];assert.match(seed,/^begin;reset role;do \$owned\$/);
  assert.match(seed,/c\.oid=654 and n\.oid=321/);assert(seed.includes(owned.schema)&&seed.includes(owned.marker));
  assert(seed.indexOf("raise exception 'onsite_lifecycle_tenant_exists'")<seed.indexOf('insert into public.merchants'));
  assert.match(seed,/commit;$/);
});

test('unowned and occupied namespaces cannot seed or start any race',async()=>{
  for(const change of [{schema:'public'},{oid:0},{tableOid:'654'},{owner:'service_role'},{marker:'unowned'}]){
    const p=probe({isolation:{...owned,...change}});
    await assert.rejects(checkAttendanceOnsiteLifecycle(p.native,{sql:s=>s}),/lifecycle_owned_schema_required/);assert.equal(p.calls.length,1);
  }
  const p=probe({existing:'1'});await assert.rejects(checkAttendanceOnsiteLifecycle(p.native,{sql:s=>s}),/onsite_lifecycle_tenant_exists/);
  assert.equal(p.calls.length,2);
});

test('five scenario contract uses witnessed races in both directions, valid issuer metadata, and original operation retries',()=>{
  assert.equal((source.match(/await lifecycleRace\(/g)||[]).length,3);
  assert.match(source,/lifecycleRace\(raceContext,employeeSql\(member,'disabled'\),clockSql\(member,memberClaims,member\.command\)\)/);
  assert.match(source,/lifecycleRace\(raceContext,roleSql\(role,false\),clockSql\(role,roleClaims,role\.command\)\)/);
  assert.match(source,/lifecycleRace\(raceContext,clockSql\(punch,punchClaims,punch\.command\),employeeSql\(punch,'disabled'\)\)/);
  assert.equal((source.match(/pass\('onsite SQL:/g)||[]).length,5);
  assert.match(source,/faolla_attendance_onsite_issue_v1/);assert.match(source,/expiresAtMs-issued\.issuedAtMs,45000/);
  assert.match(source,/fresh\(memberClaims\);unchanged\(empty\)/);assert.match(source,/fresh\(roleClaims\);unchanged\(beforeRole\)/);
  assert.match(source,/clock\(member,memberRetryClaims,member\.command\)/);assert.match(source,/clock\(role,roleRetryClaims,role\.command\)/);
  assert.match(source,/const recovered=|recovered=read\(p\)/);assert.match(source,/const replay=clock\(p,claims,p\.command\)/);
  assert.match(source,/signedTokenVerified:false,httpVerified:false/);
});

test('denials/replays compare complete facts and three actual writes preserve all earlier events and bindings',()=>{
  assert.match(source,/'events',coalesce\(\(select jsonb_agg\(to_jsonb\(e\)/);
  assert.match(source,/'receipts',coalesce\(\(select jsonb_agg\(to_jsonb\(r\)/);
  assert.match(source,/assert\.throws\(\(\)=>run\(statement\),[^;]+;unchanged\(before\)/);
  assert.match(source,/old raw event changed/);assert.match(source,/old raw receipt changed/);
  assert.match(source,/receipt\.nonce,claims\.nonce/);assert.match(source,/receipt\.command,p\.command/);assert.match(source,/receipt\.claims,claims/);
  assert.match(source,/deny\(clockSql\(punch,null,null,punch\.command\.operationId\)\)/);
  assert.match(source,/deny\(clockSql\(punch,punchClaims,punch\.command\)\)/);assert.match(source,/deny\(clockSql\(punch,issue\(\),finish\)\)/);
  assert.match(source,/assert\.equal\(finalFacts\.events\.length,3\);assert\.equal\(finalFacts\.receipts\.length,3\)/);
  assert.match(source,/assert\.equal\(exec\(stableSql\),stable/);assert.match(source,/assert\.deepEqual\(lifecycle\.employees/);
  assert.match(source,/assert\.deepEqual\(lifecycle\.roles/);
});

test('helper has no connection discovery, schema creation, event rewrite, artificial clock or nonce reset',()=>{
  assert.doesNotMatch(source,/dotenv|DATABASE_URL|SUPABASE_|spawn\(|createClient|readFileSync|listen\(/);
  assert.doesNotMatch(source,/\b(?:create table|create schema|create or replace|alter table|truncate|delete from|disable trigger|session_replication_role)\b/i);
  assert.doesNotMatch(source,/\b(?:insert into|update) public\.merchant_attendance_(?:events|onsite_receipts)\b/i);
  assert.doesNotMatch(source,/pg_sleep|setTimeout|statement_timeout|lock_timeout|device_expires_at\s*=/);
  assert.equal((source.match(/let nonceIndex=0/g)||[]).length,1);assert.match(source,/nonce:id\(1022700\+\(\+\+nonceIndex\)\)/);
  assert.match(source,/where merchant_id='\$\{site\}' and id='\$\{p\.employee\}' and auth_user_id='\$\{p\.auth\}'/);
  assert.match(source,/where merchant_id='\$\{site\}' and id='\$\{p\.role\}'/);
});
