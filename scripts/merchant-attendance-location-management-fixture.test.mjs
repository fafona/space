import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {createAttendanceLocationManagementRpc,locationManagementFixturePlan,prepareAttendanceLocationManagement} from './merchant-attendance-location-management-fixture.mjs';
import {qualifyAttendanceSandbox} from './merchant-attendance-concurrency-sandbox.mjs';
import {lifecycleId as id} from './merchant-attendance-lifecycle-native-support.mjs';

const require=createRequire(import.meta.url);
const {executeAttendanceLocationClock}=require('../src/lib/merchantAttendanceLocationClock.server.ts');
const {executeAttendanceSelfContext}=require('../src/lib/merchantAttendanceSelfContext.server.ts');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const owned={schema:'attendance_race_'+'a'.repeat(32),oid:123,tableOid:456,owner:'postgres',
  marker:'faolla-synthetic-concurrency:12345678-1234-1234-1234-123456789abc'};
const bound={site:'99990001',employeeAuthId:id(1),workerId:id(201),placeId:id(301)};
const options={...bound,ownerId:id(99)};
const scope={schema:owned.schema,sql:source=>qualifyAttendanceSandbox(source,owned.schema)};
const name='faolla_attendance_location_clock_v2',context='faolla_attendance_self_context_v1';
const read={p_site_id:bound.site,p_auth_user_id:bound.employeeAuthId,p_expected_worker_id:bound.workerId,
  p_command:null,p_operation_id:null,p_assertion:null,p_allow_new_sessions:false,p_require_clock:false};
const command={operationId:id(8501),locationId:bound.placeId,action:'clock_in',expectedSequence:0,
  settingsVersion:2,workerVersion:1,locationVersion:3,noticeRevision:1,safeFinish:false};
const assertion={policyFingerprint:'a'.repeat(32),algorithmVersion:1,reason:'denied',capturedAt:null,accuracyMeters:null,distanceMeters:null};
const write={...read,p_command:command,p_assertion:assertion,p_allow_new_sessions:true,p_require_clock:true};
function adapter(respond=()=>JSON.stringify({role:'service_role',data:{opaqueDatabaseReply:true}})){
  const statements=[];
  const rpc=createAttendanceLocationManagementRpc(statement=>{
    if(statement.includes('obj_description'))return JSON.stringify(owned);
    statements.push(statement);return respond(statement);
  },bound);
  return {rpc,statements};
}

test('seven complete migration files are preserved in dependency order, including private v1 and current 113 guard',()=>{
  const plan=locationManagementFixturePlan(root);
  assert.deepEqual(plan.map(item=>item.name.split('_')[0].slice(-3)),['071','072','073','076','077','079','113']);
  for(const item of plan)assert.equal(item.source,readFileSync(path.join(root,'scripts/supabase-migrations',item.name),'utf8'));
  assert.match(plan.at(-1).source,/actor_employee_id is distinct from e\.id/);
  assert.match(plan.at(-1).source,/revoke all on function public\.faolla_attendance_location_clock_v1/);
  assert.match(plan.find(item=>item.name.includes('079_')).source,/faolla_attendance_self_context_v1\(p_site_id text,p_auth_user_id uuid\)/);
});

test('installation construction rechecks exact owned schema before every unmodified scoped migration',async()=>{
  let steps;const stop=Error('pure migration construction: not executed');
  const native={root,query:statement=>statement.includes('obj_description')?JSON.stringify(owned):'pure fingerprint',
    querySteps:async value=>{steps=value;throw stop;}};
  await assert.rejects(prepareAttendanceLocationManagement(native,scope,options),error=>error===stop);
  const plan=locationManagementFixturePlan(root);assert.equal(steps.length,plan.length*2);
  for(let n=0;n<plan.length;n++){
    assert(steps[n*2].includes('c.oid=456 and n.oid=123'));assert(steps[n*2].includes(owned.marker));
    assert.match(steps[n*2],/location_management_seed_binding_required/);
    assert.equal(steps[n*2+1],scope.sql(plan[n].source));assert.doesNotMatch(steps[n*2+1],/\bpublic\./);
  }
  for(const change of [{schema:'public'},{owner:'service_role'},{oid:0},{marker:'foreign'}]){
    let submitted=false;
    await assert.rejects(prepareAttendanceLocationManagement({...native,query:()=>JSON.stringify({...owned,...change}),querySteps:async()=>{submitted=true;}},scope,options),/lifecycle_owned_schema_required/);
    assert.equal(submitted,false);
  }
  await assert.rejects(prepareAttendanceLocationManagement(native,{...scope,schema:'attendance_race_'+'b'.repeat(32)},options),/location_management_scope_mismatch/);
  await assert.rejects(prepareAttendanceLocationManagement(native,{...scope,sql:source=>source},options),/location_management_qualifier_required/);
});

test('preparation constructs bounded synthetic config plus real policy publish and ACK, never a clock call or role write',async()=>{
  const submitted=[];const stop=Error('pure preparation construction: no setup RPC executed');
  const native={root,query:statement=>{
    submitted.push(statement);
    if(statement.startsWith('reset role;select jsonb_build_object(\'schema\''))return JSON.stringify(owned);
    if(statement.includes('do $prepare$'))throw stop;
    if(statement.includes("'settingsVersion',s.version"))return JSON.stringify({settingsVersion:2,workerVersion:1,locationVersion:3});
    return 'pure fingerprint';
  },querySteps:async()=>{}};
  await assert.rejects(prepareAttendanceLocationManagement(native,scope,options),error=>error===stop);
  const prepared=submitted.at(-1);assert.match(prepared,/set local role service_role;do \$prepare\$/);
  assert.match(prepared,/perform [a-z0-9_]+\.faolla_attendance_location_policy_draft_v1/);
  assert.equal((prepared.match(/perform [a-z0-9_]+\.faolla_attendance_location_notice_v1/g)||[]).length,2);
  assert(prepared.includes('"expectedSettingsVersion":2'));assert(prepared.includes('"expectedLocationVersion":3'));
  assert(prepared.includes('"action":"publish"'));assert(prepared.includes('"action":"acknowledge"'));
  assert.doesNotMatch(prepared,/faolla_attendance_location_clock_v[12]|insert into|update |delete from/i);
  const update=submitted.find(statement=>statement.includes('update '+owned.schema+'.merchant_attendance_settings'));
  assert(update);assert.equal((update.match(/update /g)||[]).length,2);
  assert(update.includes("where merchant_id='99990001' and id='"+bound.placeId+"'"));
  assert.doesNotMatch(update,/merchant_enterprise_roles set|merchant_enterprise_employees set|merchant_attendance_events|version=version/);
});

test('clock read, write and safe-finish shapes are forwarded only as real service-role SQL and opaque replies remain opaque',async()=>{
  const {rpc,statements}=adapter();
  for(const args of [read,{...read,p_operation_id:id(8501),p_require_clock:true},write,
    {...write,p_assertion:null},
    {...write,p_command:{...command,action:'clock_out',noticeRevision:null,safeFinish:true},p_assertion:null},
    {...write,p_assertion:{...assertion,reason:'inside',capturedAt:'2026-10-03T12:00:00.123Z',accuracyMeters:5.5,distanceMeters:4}}]){
    assert.deepEqual(await rpc(name,args),{data:{opaqueDatabaseReply:true},error:null});
  }
  assert.equal(statements.length,6);
  for(const statement of statements){assert.match(statement,/^begin;set local role service_role;/);assert.match(statement,/commit;$/);assert.doesNotMatch(statement,/latitude|longitude|positionFailure|expectedWorkerId/);}
  assert(statements[2].includes(JSON.stringify(command)));assert(statements[2].includes(JSON.stringify(assertion)));
});

test('RPC whitelist rejects extra or inherited fields, foreign site/actor/worker, malformed flags and raw coordinate assertions before execution',async()=>{
  const {rpc,statements}=adapter();
  const invalid=[
    {...read,extra:true},{...read,p_site_id:'99990002'},{...read,p_auth_user_id:id(2)},{...read,p_expected_worker_id:id(202)},
    {...read,p_allow_new_sessions:1},{...read,p_require_clock:null},{...read,p_operation_id:'not-a-uuid'},
    {...read,p_assertion:assertion},Object.assign(Object.create({hidden:true}),read),
    {...write,p_require_clock:false},{...write,p_operation_id:id(8502)},
    {...write,p_command:{...command,position:{latitude:37.3,longitude:-5.9}}},
    {...write,p_command:{...command,locationId:id(302)}},{...write,p_command:{...command,settingsVersion:0}},
    {...write,p_command:{...command,expectedSequence:Number.MAX_SAFE_INTEGER}},
    {...write,p_command:{...command,safeFinish:true}},{...write,p_command:{...command,noticeRevision:null}},
    {...write,p_assertion:{...assertion,latitude:37.3}},
    {...write,p_assertion:{...assertion,reason:'denied',capturedAt:'2026-10-03T12:00:00.123Z'}},
    {...write,p_assertion:{...assertion,reason:'inside',capturedAt:'2026-02-30T12:00:00.123Z',accuracyMeters:5,distanceMeters:3}},
  ];
  for(const args of invalid)await assert.rejects(rpc(name,args));
  await assert.rejects(rpc('faolla_attendance_location_clock_v1',read),/rpc_not_allowed/);
  await assert.rejects(rpc('faolla_attendance_self_v1',read),/rpc_not_allowed/);
  assert.equal(statements.length,0);
  for(const change of [{site:'12345678'},{employeeAuthId:id(2)},{workerId:id(202)},{placeId:id(302)}])
    assert.throws(()=>createAttendanceLocationManagementRpc(()=>JSON.stringify(owned),{...bound,...change}),/synthetic_binding_required/);
});

test('context default executor retains actual actor and exact two-field shape without writable RPC fallback',async()=>{
  const {rpc,statements}=adapter(()=>JSON.stringify({role:'service_role',data:{siteId:bound.site,employeeId:id(101),workerId:bound.workerId,locationId:bound.placeId}}));
  const result=await executeAttendanceSelfContext({siteId:bound.site,authUserId:bound.employeeAuthId},{rpc});
  assert.equal(result.workerId,bound.workerId);assert.equal(statements.length,1);
  assert(statements[0].includes(`${context}('99990001','${bound.employeeAuthId}')`));
  for(const args of [{p_site_id:bound.site,p_auth_user_id:bound.employeeAuthId,command:null},
    {p_site_id:bound.site,p_auth_user_id:id(99)},{p_site_id:'99990002',p_auth_user_id:bound.employeeAuthId}])await assert.rejects(rpc(context,args));
  assert.equal(statements.length,1);
});

test('default location executor performs identity-pinned preflight; denial is propagated without a SQL write or raw GPS',async()=>{
  const {rpc,statements}=adapter(()=>{throw Error('ERROR: attendance_access_denied\nCONTEXT: synthetic diagnostic details');});
  const input={siteId:bound.site,authUserId:bound.employeeAuthId,expectedWorkerId:bound.workerId,operationId:null,moduleEnabled:true,
    command:{expectedWorkerId:bound.workerId,...command,position:{latitude:37.3,longitude:-5.9,accuracyMeters:5,capturedAt:'2026-10-03T12:00:00.123Z'},positionFailure:null}};
  await assert.rejects(executeAttendanceLocationClock(input,{rpc}),error=>error.code==='attendance_access_denied');
  assert.equal(statements.length,1);
  assert(statements[0].includes(`${name}('99990001','${bound.employeeAuthId}','${bound.workerId}',null,'${command.operationId}',null,true,true)`));
  assert.doesNotMatch(statements[0],/latitude|longitude|37\.3|5\.9/);
});

test('typed SQL errors survive while unknown exceptions, diagnostics and wrong-role envelopes are sanitized',async()=>{
  for(const code of ['attendance_access_denied','attendance_worker_changed','attendance_location_policy_changed','attendance_notice_required']){
    const {rpc}=adapter(()=>{throw Error('ERROR: '+code+'\nCONTEXT: protected SQL detail');});
    assert.deepEqual(await rpc(name,read),{data:null,error:{message:code}});
  }
  for(const respond of [()=>{throw Error('ERROR: attendance_secret_not_public\nPIN or SQL detail');},
    ()=>{throw Error('connection failure with credentials');},()=>'{malformed',()=>JSON.stringify({role:'postgres',data:{private:true}})]){
    const {rpc}=adapter(respond);assert.deepEqual(await rpc(name,read),{data:null,error:{message:'attendance_unavailable'}});
  }
  const source=readFileSync(new URL('./merchant-attendance-location-management-fixture.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(source,/dotenv|DATABASE_URL|spawn\(|createClient|listen\(|drop schema|create schema/);
  assert.match(source,/preparation_changed_protected_facts/);assert.match(source,/seededAttendanceEvents:0/);
});
