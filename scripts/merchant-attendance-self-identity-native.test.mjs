import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {checkAttendanceSelfIdentityNative} from './merchant-attendance-self-identity-native-checks.mjs';

const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function constructionProbe(options={}){
  const state={steps:null,snapshots:0,execCalls:[],passed:[],existing:'0',isolation:{schema:'attendance_race_'+'a'.repeat(32),
    oid:123,tableOid:456,owner:'postgres',marker:'faolla-synthetic-concurrency:00000000-0000-4000-8000-000000000001'},...options};
  const exec=statement=>{
    state.execCalls.push(statement);
    if(statement.includes("'marker',obj_description"))return JSON.stringify(state.isolation);
    if(statement.includes('select count(*) from public.merchants'))return state.existing;
    if(statement.includes("'events',(select")){state.snapshots++;return state.snapshots===2&&state.changedBaseline?'changed opaque baseline':'original opaque baseline';}
    throw Error('Unexpected construction probe SQL');
  };
  const querySteps=async steps=>{
    state.steps=steps;
    if(state.executionError)throw state.executionError;
    // Manifest only: no synthetic function response is presented as evidence
    // that PostgreSQL accepted, replayed, or appended any business operation.
    const manifests=steps.flatMap(step=>[...step.matchAll(/jsonb_build_object\('case','([^']+)','concern',(true|false),/g)]
      .map(match=>({case:match[1],concern:match[2]==='true'})));
    return manifests.map(item=>JSON.stringify(item)).join('\n');
  };
  return {exec,querySteps,pass:label=>state.passed.push(label),state};
}

test('current-behavior diagnostic constructs thirteen explicitly classified scenarios rather than claiming actor isolation',async()=>{
  const p=constructionProbe(),result=await checkAttendanceSelfIdentityNative(p);
  assert.equal(result.siteId,'99990006');assert.equal(result.employeeId,id(970101));assert.equal(result.authUserId,id(970001));
  assert.equal(result.rolledBack,true);assert.equal(result.syntheticOnly,true);assert.equal(result.checks.length,13);
  assert.deepEqual(result.observations.map(item=>item.case),['same_actor_recovery','other_last_status','null_last_status','own_last_other_receipt',
    'own_last_null_receipt','close_other_open','close_null_open','worker_pin_rejected','same_actor_new_close','same_actor_kiosk_new_close',
    'restart_after_other_closed','restart_after_null_closed','empty_worker_new_clock_in']);
  assert.equal(result.observations.filter(item=>item.concern).length,8);
  for(let n=0;n<result.checks.length;n++)assert(result.checks[n].startsWith(result.observations[n].concern?'CONCERN:':'BASELINE:'));
  assert.deepEqual(result.checks,p.state.passed);assert.equal(p.state.snapshots,2);
  assert(result.actors.every(actor=>actor.email.endsWith('@example.test')));
});

test('only guarded isolated seed inputs and bounded rollback statements are constructed; no business or migration edits',async()=>{
  const p=constructionProbe();await checkAttendanceSelfIdentityNative(p);const steps=p.state.steps,sql=steps.join('\n');
  assert.equal(steps.length,15);assert.match(steps[0],/^begin;/);assert.match(steps.at(-1),/rollback;$/);
  assert.match(steps[0],/c\.oid=456 and n\.oid=123/);assert(steps[0].includes(p.state.isolation.schema)&&steps[0].includes(p.state.isolation.marker));
  assert.match(steps[0],/statement_timeout='10s'/);assert.match(steps[0],/array\['enterprise\.view','attendance\.self\.view','attendance\.self\.clock'\]/);
  assert.match(steps[0],/time_zone,enabled,web_clock_enabled\) values\('[^']+','UTC',true,true\)/);
  assert.match(steps[0],/merchant_attendance_employment_periods\(merchant_id,worker_id,starts_on\)[^;]+'2000-01-01'/);
  assert.equal([...sql.matchAll(/(?:^|\n)\s*savepoint self_actor_case;/g)].length,13);
  assert.equal([...sql.matchAll(/rollback to savepoint self_actor_case/g)].length,13);
  assert.equal([...sql.matchAll(/set local role service_role;/g)].length,13);
  assert.doesNotMatch(sql,/\b(?:update public\.|delete from|alter table|create table|create index|create or replace|truncate|disable trigger|session_replication_role)\b/i);
  for(const step of steps.slice(1,-1)){
    const seed=step.match(/insert into public\.merchant_attendance_events\([^)]+\) values\s*([\s\S]+?);/);
    if(step.includes("'case','empty_worker_new_clock_in'")){assert.equal(seed,null);continue;}assert(seed);
    assert([...seed[1].matchAll(/\('00000000/g)].length<=2);assert.match(seed[0],/actor_employee_id/);
  }
  const source=readFileSync(new URL('./merchant-attendance-self-identity-native-checks.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(source,/dotenv|DATABASE_URL|SUPABASE_|spawn\(|createClient|listen\(|readFileSync/);
});

test('status, historical receipt, original replay, one explicit close and wrong-worker requests preserve exact existing API inputs',async()=>{
  const p=constructionProbe(),result=await checkAttendanceSelfIdentityNative(p);
  const sql=p.state.steps.join('\n'),requests=[...sql.matchAll(/'input','((?:[^']|'')*)'::jsonb/g)].map(match=>JSON.parse(match[1].replaceAll("''","'")));
  assert(requests.length>16);
  for(const request of requests){
    assert.deepEqual(Object.keys(request).sort(),['authUserId','command','operationId','siteId']);
    assert.equal(request.siteId,result.siteId);assert.equal(request.authUserId,result.authUserId);
    if(request.command){
      assert.deepEqual(Object.keys(request.command).sort(),['action','expectedSequence','expectedWorkerId','locationId','operationId']);
      assert.equal(request.operationId,null);assert.equal(request.command.locationId,result.locationId);
    }
  }
  const receiptGets=requests.filter(request=>request.command===null&&request.operationId===id(972001));assert.equal(receiptGets.length,5);
  const historicalReplays=requests.filter(request=>request.command?.operationId===id(972001)&&request.command.expectedWorkerId===result.workerId);
  assert.equal(historicalReplays.length,3);assert(historicalReplays.every(request=>request.command.action==='clock_in'&&request.command.expectedSequence===0));
  const closes=requests.filter(request=>request.command?.operationId===id(972003)&&request.command.action==='clock_out');assert.equal(closes.length,8);
  assert(closes.every(request=>request.command.action==='clock_out'&&request.command.expectedSequence===1));
  assert.equal(requests.filter(request=>request.command?.expectedWorkerId===result.otherWorkerId).length,1);
  assert.match(sql,/if sqlerrm<>'attendance_worker_changed' then raise/);
});

test('each observation verifies complete old raw rows and exact permitted growth before selecting evidence and rolling back',async()=>{
  const p=constructionProbe();await checkAttendanceSelfIdentityNative(p);
  for(const step of p.state.steps.slice(1,-1)){
    assert.match(step,/'original raw facts unchanged'/);assert.match(step,/'exact expected raw growth'/);
    assert.match(step,/'rawBefore',before_rows,'rawAfter',after_rows,'newRows',new_rows/);
    assert(step.indexOf("'original raw facts unchanged'")<step.indexOf("'faolla.self_actor_observation'"));
    assert(step.indexOf("select current_setting('faolla.self_actor_observation')")<step.indexOf('rollback to savepoint self_actor_case'));
  }
  const closing=p.state.steps.filter(step=>step.includes("'only explicit current-actor append'"));assert.equal(closing.length,7);
  for(const step of closing){
    assert.match(step,/jsonb_array_length\(new_rows\)=1 and jsonb_array_length\(after_rows\)=[123]/);
    assert(step.includes(`new_rows->0->>'actor_employee_id'='${id(970101)}'`));
    assert.match(step,/'own append exact replay does not duplicate'/);assert.match(step,/'own append recoverable by original GET'/);
  }
});

test('unowned or occupied namespaces cannot reach transaction execution',async()=>{
  for(const patch of [{schema:'public'},{oid:0},{tableOid:'456'},{owner:'service_role'},{marker:'not-owned'}]){
    const p=constructionProbe();Object.assign(p.state.isolation,patch);
    await assert.rejects(checkAttendanceSelfIdentityNative(p),/self_actor_native_owned_schema_required/);assert.equal(p.state.steps,null);
  }
  const p=constructionProbe({existing:'1'});await assert.rejects(checkAttendanceSelfIdentityNative(p),/self_actor_native_tenant_exists/);
  assert.equal(p.state.steps,null);assert.equal(p.state.snapshots,0);
});

test('native execution errors remain visible and cannot bypass the caller-baseline restoration check',async()=>{
  const failure=Error('synthetic native execution failure'),p=constructionProbe({executionError:failure});
  await assert.rejects(checkAttendanceSelfIdentityNative(p),error=>error===failure);assert.equal(p.state.snapshots,2);assert.deepEqual(p.state.passed,[]);
  const changed=constructionProbe({changedBaseline:true});await assert.rejects(checkAttendanceSelfIdentityNative(changed),/self_actor_native_baseline_not_restored/);
  assert.equal(changed.state.snapshots,2);assert.deepEqual(changed.state.passed,[]);
});

test('guarded mode reuses identical raw inputs, denies all eight concern cases and retains three genuine new-write baselines',async()=>{
  const legacy=constructionProbe(),guarded=constructionProbe();
  await checkAttendanceSelfIdentityNative(legacy);const result=await checkAttendanceSelfIdentityNative({...guarded,mode:'guarded'});
  assert.equal(result.mode,'guarded');assert.equal(result.observations.length,13);assert(result.observations.every(row=>row.concern===false));
  assert.equal(result.checks.filter(label=>label.startsWith('GUARDED:')).length,8);assert.equal(result.checks.filter(label=>label.startsWith('BASELINE:')).length,5);
  assert.equal(guarded.state.steps[0],legacy.state.steps[0]);assert.equal(guarded.state.steps.at(-1),legacy.state.steps.at(-1));
  for(let n=1;n<=13;n++){
    const before=legacy.state.steps[n].split('do $before$')[0],after=guarded.state.steps[n].split('do $before$')[0];
    assert.equal(after,before,'mode must never change the seeded actor or fact');
    const isNewBaseline=['same_actor_new_close','same_actor_kiosk_new_close','empty_worker_new_clock_in'].includes(result.observations[n-1].case);
    assert(guarded.state.steps[n].includes(`jsonb_array_length(new_rows)=${isNewBaseline?1:0}`));
    assert.match(guarded.state.steps[n],/'original raw facts unchanged'/);
  }
  const sql=guarded.state.steps.join('\n');assert.equal([...sql.matchAll(/'error','attendance_access_denied'/g)].length,24);
  assert.equal([...sql.matchAll(/'only explicit current-actor append'/g)].length,3);
  assert.match(sql,/existing operation replay ignores historical actor/); // Same-actor baseline remains an exact replay.
  assert.match(sql,/'own current last remains readable'/);assert.match(sql,/if sqlerrm<>'attendance_worker_changed' then raise/);
});

test('same-actor web/kiosk and empty-worker compatibility actually construct new writes plus original receipt recovery',async()=>{
  const p=constructionProbe();await checkAttendanceSelfIdentityNative({...p,mode:'guarded'});
  const named=name=>p.state.steps.find(step=>step.includes(`'case','${name}'`));
  for(const name of ['same_actor_new_close','same_actor_kiosk_new_close','empty_worker_new_clock_in']){
    const sql=named(name);assert.match(sql,/jsonb_array_length\(new_rows\)=1/);assert.doesNotMatch(sql,/'error','attendance_access_denied'/);
    assert.match(sql,/'own append recoverable by original GET'/);assert.match(sql,/'own append exact replay does not duplicate'/);
    assert(sql.includes(`new_rows->0->>'actor_employee_id'='${id(970101)}'`));assert.match(sql,/new_rows->0->>'source'='web'/);
  }
  const kiosk=named('same_actor_kiosk_new_close');assert.match(kiosk,/'clock_in','kiosk','UTC'/);assert.match(kiosk,/before_rows->0->>'source'='kiosk'/);
  assert.doesNotMatch(p.state.steps.join('\n'),/'kiosk_pin'|'onsite_qr'/);
  const empty=named('empty_worker_new_clock_in');assert.doesNotMatch(empty,/insert into public\.merchant_attendance_events/);
  assert.match(empty,/lastEvent'='null'::jsonb and r->'state'->>'sequence'='0'/);
  assert.match(empty,/"action":"clock_in","expectedSequence":0/);assert.match(empty,/new_rows->0->>'sequence'='1'/);
});

test('unattributable closed latest events cannot authorize a restart or expose an earlier owned receipt in guarded mode',async()=>{
  const p=constructionProbe();await checkAttendanceSelfIdentityNative({...p,mode:'guarded'});
  for(const name of ['restart_after_other_closed','restart_after_null_closed']){
    const sql=p.state.steps.find(step=>step.includes(`'case','${name}'`));
    assert.match(sql,/jsonb_array_length\(new_rows\)=0 and jsonb_array_length\(after_rows\)=2/);
    assert.equal([...sql.matchAll(/'error','attendance_access_denied'/g)].length,5);
    const requests=[...sql.matchAll(/'input','((?:[^']|'')*)'::jsonb/g)].map(match=>JSON.parse(match[1].replaceAll("''","'")));
    assert(requests.some(request=>request.command===null&&request.operationId===id(972001)));
    assert(requests.some(request=>request.command?.action==='clock_in'&&request.command.expectedSequence===2));
    const seed=sql.slice(sql.indexOf('insert into public.merchant_attendance_events'),sql.indexOf('do $before$'));
    assert(seed.includes(`clock_timestamp(),'${id(970101)}')`));
    assert(seed.includes(name==='restart_after_other_closed'?`clock_timestamp(),'${id(970102)}')`:'clock_timestamp(),null)'));
    assert.match(seed,/'clock_out','web','UTC'/);
  }
});

test('unknown validation modes fail before any database inspection',async()=>{
  for(const mode of ['owner','auto',null,1]){
    const p=constructionProbe();await assert.rejects(checkAttendanceSelfIdentityNative({...p,mode}),/self_actor_native_invalid_mode/);
    assert.deepEqual(p.state.execCalls,[]);assert.equal(p.state.steps,null);
  }
});
