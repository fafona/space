import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {checkAttendancePinIdentityNative} from './merchant-attendance-pin-identity-native-checks.mjs';

function constructionProbe(options={}){
  const state={steps:null,snapshots:0,execCalls:[],passed:[],existing:'0',isolation:{schema:'attendance_race_'+'a'.repeat(32),
    oid:123,tableOid:456,owner:'postgres',marker:'faolla-synthetic-concurrency:00000000-0000-4000-8000-000000000001'},...options};
  const exec=statement=>{
    state.execCalls.push(statement);
    if(statement.includes("'marker',obj_description"))return JSON.stringify(state.isolation);
    if(statement.includes('select count(*) from public.merchants'))return state.existing;
    if(statement.includes('select md5(coalesce(jsonb_agg')){
      state.snapshots++;return state.snapshots===2&&state.changedBaseline?'changed opaque digest':'original opaque digest';
    }
    throw Error('Unexpected construction probe SQL');
  };
  const querySteps=async steps=>{
    state.steps=steps;if(state.executionError)throw state.executionError;
    // Only the diagnostic manifest is returned. No mock SQL business results
    // are invented or counted as a successful lease, punch or identity check.
    return steps.flatMap(step=>[...step.matchAll(/set_config\('faolla\.pin_identity_observation',\('((?:[^']|'')*)'::jsonb\|\|/g)]
      .map(match=>JSON.stringify(JSON.parse(match[1].replaceAll("''","'"))))).join('\n');
  };
  return {exec,querySteps,pass:label=>state.passed.push(label),state};
}

test('constructs ten honest SQL-only concern/baseline cases with bounded independent identities and explicit write counts',async()=>{
  const p=constructionProbe(),result=await checkAttendancePinIdentityNative(p);
  assert.equal(result.siteId,'99990006');assert.equal(result.rolledBack,true);assert.equal(result.syntheticOnly,true);assert.equal(result.pinPasswordVerified,false);
  assert.deepEqual(result.expected,{cases:10,beginCalls:28,clockCalls:32,denials:4,pinWrites:8,syntheticEvents:13});
  assert.equal(result.cases.length,10);assert.equal(result.observations.length,10);assert.equal(result.observations.filter(row=>row.concern).length,6);
  assert.equal(new Set(result.cases.map(row=>row.workerId)).size,10);assert.equal(new Set(result.cases.map(row=>row.terminalId)).size,10);
  assert.equal(new Set(result.cases.map(row=>row.employeeId)).size,10);
  assert(result.observations.every(row=>row.beginCalls<=4));assert.equal(p.state.snapshots,2);assert.deepEqual(p.state.passed,result.checks);
  for(let n=0;n<10;n++){
    assert(result.checks[n].startsWith(result.observations[n].concern?'CONCERN:':'BASELINE:'));
    assert.match(result.checks[n],/no PIN password verification/);
  }
  assert.equal(result.observations.filter(row=>row.preparationPinWrites===1).length,2);
});

test('one owned transaction uses real begin/clock under service_role, retains all counters and performs only the final rollback',async()=>{
  const p=constructionProbe();await checkAttendancePinIdentityNative(p);const steps=p.state.steps,sql=steps.join('\n');
  assert.equal(steps.length,12);assert.match(steps[0],/^begin;/);assert.match(steps.at(-1),/rollback;$/);
  assert.match(steps[0],/c\.oid=456 and n\.oid=123/);assert(steps[0].includes(p.state.isolation.schema)&&steps[0].includes(p.state.isolation.marker));
  assert.match(steps[0],/statement_timeout='10s'/);assert.match(steps[0],/attendance\.self\.view','attendance\.self\.clock/);
  assert.equal([...sql.matchAll(/savepoint pin_identity_case;/g)].length,20); // SAVEPOINT and RELEASE only.
  assert.equal([...sql.matchAll(/release savepoint pin_identity_case;/g)].length,10);
  assert.equal([...sql.matchAll(/faolla_attendance_pin_begin_v1\(/g)].length,28);
  assert.equal([...sql.matchAll(/faolla_attendance_pin_clock_v1\(/g)].length,32);
  assert.equal([...sql.matchAll(/set local role service_role;/g)].length,32);
  assert.doesNotMatch(sql,/rollback to|\b(?:update public\.|delete from|alter table|create table|create function|create index|truncate|disable trigger|session_replication_role)\b/i);
  assert.match(steps.at(-1),/all credential attempts retained until final rollback/);
  assert.match(steps.at(-1),/all device attempts retained until final rollback/);
  assert.match(sql,/starts_on\) values\('[^']+','[^']+','2000-01-01'\)/);
  const source=readFileSync(new URL('./merchant-attendance-pin-identity-native-checks.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(source,/dotenv|DATABASE_URL|SUPABASE_|spawn\(|createClient|listen\(|readFileSync/);
  assert.match(source,/synthetic credential rows and verified=true/);
});

test('guarded mode keeps identical seeds but consumes leases on denials without exposing the protected projection',async()=>{
  const legacy=constructionProbe(),guarded=constructionProbe();await checkAttendancePinIdentityNative(legacy);
  const result=await checkAttendancePinIdentityNative({...guarded,mode:'guarded'});
  assert.deepEqual(result.expected,{cases:10,beginCalls:28,clockCalls:44,denials:16,pinWrites:4,syntheticEvents:13});
  assert(result.observations.every(row=>!row.concern));assert.equal(result.checks.filter(label=>label.startsWith('GUARDED:')).length,6);
  assert.equal(result.checks.filter(label=>label.startsWith('BASELINE:')).length,4);
  assert.equal(legacy.state.steps[0],guarded.state.steps[0]);
  for(let n=1;n<=10;n++)assert.equal(legacy.state.steps[n].split('do $initialize$')[0],guarded.state.steps[n].split('do $initialize$')[0]);
  const sql=guarded.state.steps.join('\n');
  assert.equal([...sql.matchAll(/exact business denial contains no private projection/g)].length,16);
  assert.equal([...sql.matchAll(/same spent lease cannot reveal state or receipt/g)].length,16);
  assert.equal([...sql.matchAll(/r=jsonb_build_object\('error','attendance_access_denied'\)/g)].length,12);
  assert.equal([...sql.matchAll(/r=jsonb_build_object\('error','attendance_operation_conflict'\)/g)].length,4);
  for(const step of guarded.state.steps.slice(1,-1)){
    assert.match(step,/lease_id is null and lease_expires is null and worker_id is null and employee_id is null and credential_revision is null/);
    assert.match(step,/credential attempt count retained/);assert.match(step,/exact expected PIN receipt growth/);
  }
  const alternate=constructionProbe();await checkAttendancePinIdentityNative({...alternate,mode:'guarded',identityError:'attendance_worker_changed'});
  assert.equal([...alternate.state.steps.join('\n').matchAll(/r=jsonb_build_object\('error','attendance_worker_changed'\)/g)].length,12);
});

test('observable request contracts and begin projection never contain credential material or a lease capability',async()=>{
  const p=constructionProbe(),result=await checkAttendancePinIdentityNative(p),sql=p.state.steps.join('\n');
  const inputs=[...sql.matchAll(/'input','((?:[^']|'')*)'::jsonb/g)].map(match=>JSON.parse(match[1].replaceAll("''","'")));
  assert.equal(inputs.length,28);
  for(const request of inputs){
    assert.deepEqual(Object.keys(request).sort(),['allowNew','command','operationId','siteId','terminalId','workerNo']);
    assert.equal(request.siteId,result.siteId);assert.equal(request.allowNew,true);
    const scope=result.cases.find(row=>row.terminalId===request.terminalId);assert(scope);assert.equal(request.workerNo,scope.workerNo);
    if(request.command){
      assert.deepEqual(Object.keys(request.command).sort(),['action','expectedEmployeeId','expectedSequence','expectedWorkerId','locationId','operationId']);
      assert.equal(request.operationId,null);assert.equal(request.command.expectedWorkerId,scope.workerId);
      assert.equal(request.command.expectedEmployeeId,scope.employeeId);assert.equal(request.command.locationId,result.locationId);
    }
  }
  const visible=JSON.stringify({result,inputs});
  assert.doesNotMatch(visible,/"(?:salt|verifier|secret|secretHash|pairHash|lease|leaseId|p_verified|pin)"|a{64}|b{64}|c{32}|d{64}/);
  assert.equal([...sql.matchAll(/'beginIdentity',jsonb_build_object\('workerId',b->'workerId','employeeId',b->'employeeId','revision',b->'revision'\)/g)].length,28);
  assert.doesNotMatch(sql,/'beginIdentity',b[),]/);
});

test('old foreign/null receipts stay conflicts and positive controls actually append, recover and replay a PIN receipt',async()=>{
  const p=constructionProbe(),result=await checkAttendancePinIdentityNative({...p,mode:'guarded'});
  const named=name=>p.state.steps[result.cases.findIndex(row=>row.name===name)+1];
  for(const name of ['own_latest_other_old_receipt_conflict','own_latest_null_old_receipt_conflict']){
    const step=named(name);assert.match(step,/own latest state remains readable/);
    assert.equal([...step.matchAll(/r=jsonb_build_object\('error','attendance_operation_conflict'\)/g)].length,2);
    assert.match(step,/jsonb_array_length\(new_rows\)=0/);assert.doesNotMatch(step,/attendance_access_denied/);
  }
  for(const name of ['empty_worker_first_pin_write_and_recovery','own_web_state_pin_close_and_recovery']){
    const step=named(name);assert.match(step,/new same-actor PIN action succeeds/);assert.match(step,/original own PIN receipt read-only recovery/);
    assert.match(step,/original own PIN command replay without second write/);assert.match(step,/jsonb_array_length\(new_rows\)=1/);
    assert.match(step,/e\.source='kiosk'/);assert.doesNotMatch(step,/attendance_access_denied/);
  }
  assert.doesNotMatch(named('empty_worker_first_pin_write_and_recovery'),/insert into public\.merchant_attendance_events/);
  assert.match(named('own_web_state_pin_close_and_recovery'),/'clock_in','web','UTC'/);
  for(const name of ['own_real_pin_receipt_under_other_latest','own_real_pin_receipt_under_null_latest']){
    const step=named(name);assert.match(step,/preparation is one real own PIN write/);
    assert(step.indexOf('faolla_attendance_pin_clock_v1')<step.indexOf('insert into public.merchant_attendance_events'));
    assert.doesNotMatch(step,/insert into public\.merchant_attendance_pin_clock_receipts/);
    assert.match(step,/jsonb_array_length\(after_rows\)=2 and jsonb_array_length\(new_rows\)=0/);
    assert.equal([...step.matchAll(/r=jsonb_build_object\('error','attendance_access_denied'\)/g)].length,2);
  }
});

test('all old raw facts and origin receipts are compared before observation and full secret-bearing tables are fingerprinted after rollback',async()=>{
  const p=constructionProbe();await checkAttendancePinIdentityNative(p);
  for(const step of p.state.steps.slice(1,-1)){
    assert.match(step,/all previous raw facts unchanged/);assert.match(step,/all previous PIN receipts unchanged/);
    assert(step.indexOf('all previous raw facts unchanged')<step.indexOf("set_config('faolla.pin_identity_observation'"));
    assert(step.indexOf("select current_setting('faolla.pin_identity_observation')")<step.indexOf('release savepoint pin_identity_case'));
  }
  const baseline=p.state.execCalls.filter(sql=>sql.includes('select md5(coalesce(jsonb_agg'));
  assert.equal(baseline.length,2);assert.equal(baseline[0],baseline[1]);
  for(const table of ['pin_credentials','pin_attempts','pin_audit','pin_clock_receipts','terminals','terminal_audit','events','workers',
    'locations','settings','employment_periods'])assert(baseline[0].includes(`merchant_attendance_${table}`));
  for(const table of ['merchant_enterprise_employees','merchant_enterprise_roles','public.merchants'])assert(baseline[0].includes(table));
});

test('invalid mode/error, unowned or occupied namespace never reaches execution',async()=>{
  for(const options of [{mode:'auto'},{mode:null},{identityError:'attendance_pin_denied'},{identityError:"');select 1;--"}]){
    const p=constructionProbe();await assert.rejects(checkAttendancePinIdentityNative({...p,...options}),/pin_identity_native_invalid_/);
    assert.equal(p.state.execCalls.length,0);assert.equal(p.state.steps,null);
  }
  for(const patch of [{schema:'public'},{oid:0},{tableOid:'456'},{owner:'service_role'},{marker:'not-owned'}]){
    const p=constructionProbe();Object.assign(p.state.isolation,patch);
    await assert.rejects(checkAttendancePinIdentityNative(p),/pin_identity_native_owned_schema_required/);assert.equal(p.state.steps,null);
  }
  const p=constructionProbe({existing:'1'});await assert.rejects(checkAttendancePinIdentityNative(p),/pin_identity_native_tenant_exists/);
  assert.equal(p.state.steps,null);assert.equal(p.state.snapshots,0);
});

test('execution failures remain visible and baseline mismatch fails closed without any passed claim',async()=>{
  const failure=Error('synthetic SQL execution error'),p=constructionProbe({executionError:failure});
  await assert.rejects(checkAttendancePinIdentityNative(p),error=>error===failure);assert.equal(p.state.snapshots,2);assert.deepEqual(p.state.passed,[]);
  const changed=constructionProbe({changedBaseline:true});await assert.rejects(checkAttendancePinIdentityNative(changed),/pin_identity_native_baseline_not_restored/);
  assert.equal(changed.state.snapshots,2);assert.deepEqual(changed.state.passed,[]);
});
