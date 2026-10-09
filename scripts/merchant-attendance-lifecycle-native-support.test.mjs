import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {lifecycleId,lifecycleJson,assertLifecycleSandbox,lifecycleRace} from './merchant-attendance-lifecycle-native-support.mjs';
const owned={schema:'attendance_race_0123456789abcdef0123456789abcdef',oid:1234,tableOid:1235,owner:'postgres',
  marker:'faolla-synthetic-concurrency:12345678-1234-1234-1234-123456789abc'};
test('lifecycle helper refuses unowned namespaces before any fixture writes',()=>{
  assert.deepEqual(assertLifecycleSandbox(()=>JSON.stringify(owned)),owned);
  for(const change of [{schema:'public'},{owner:'service_role'},{marker:null},{oid:0},{tableOid:-1},{oid:'1234'}]){
    let calls=0;assert.throws(()=>assertLifecycleSandbox(source=>{calls++;assert(source.startsWith('reset role;select'));return JSON.stringify({...owned,...change});}),/lifecycle_owned_schema_required/);
    assert.equal(calls,1);
  }
});
test('synthetic IDs are bounded and SQL JSON escapes only literals',()=>{
  assert.equal(lifecycleId(1023001),'00000000-0000-4000-8000-000001023001');
  for(const n of [0,-1,1.1,1e12,NaN,'1'])assert.throws(()=>lifecycleId(n));
  assert.equal(lifecycleJson(null),'null');assert.equal(lifecycleJson({value:"a'b"}),`'{"value":"a''b"}'::jsonb`);
});
function mock({failure=false,queryFailure=false}={}){
  const steps=[],closed=[];let release;let connected=0;
  const result=new Promise(resolve=>{release=resolve;});
  const context={sql:source=>source.replaceAll('public.','synthetic.'),query:source=>{
    steps.push(['query',source]);assert.match(source,/wait_event_type='Lock'/);assert.match(source,/765=any\(pg_blocking_pids\(pid\)\)/);
    if(queryFailure)throw Error('synthetic observer failure');return '1';
  },connect:()=>{
    const index=connected++;
    return {name:`attendance_race_${String(index).repeat(32)}`,step:async source=>{
      steps.push([index,source]);
      if(source==='select pg_backend_pid();')return '765';
      if(index===1){await result;if(failure)throw Error('synthetic waiter denial');return '{"waiter":true}';}
      if(source==='commit;'||source==='rollback;')release();
      return '{"holder":true}';
    },close:async()=>{closed.push(index);release();}};
  }};
  return {context,steps,closed};
}
for(const rollback of [false,true])test(`lifecycle race witnesses exact blocker before ${rollback?'rollback':'commit'} and closes both connections`,async()=>{
  const m=mock();const result=await lifecycleRace(m.context,'select public.left;','select public.right;',{rollback});
  assert.equal(result.witnessed,true);assert.equal(result.right.output,'{"waiter":true}');assert.equal(result.right.error,null);
  const witness=m.steps.findIndex(([kind])=>kind==='query'),commit=m.steps.findIndex(([,sql])=>sql===(rollback?'rollback;':'commit;'));
  assert(witness>=0&&commit>witness);assert.deepEqual(m.closed.sort(),[0,1]);
  assert(m.steps.some(([,sql])=>sql==='begin;select synthetic.right;commit;'));
});
test('waiter errors are explicit outcomes, never replaced with successful JSON',async()=>{
  const m=mock({failure:true}),result=await lifecycleRace(m.context,'select 1;','select 2;');
  assert.equal(result.right.output,null);assert.match(result.right.error.message,/synthetic waiter denial/);assert.deepEqual(m.closed.sort(),[0,1]);
});
test('observation failure still closes both sessions and drains waiting work',async()=>{
  const m=mock({queryFailure:true});await assert.rejects(lifecycleRace(m.context,'select 1;','select 2;'),/synthetic observer failure/);
  assert.deepEqual(m.closed.sort(),[0,1]);assert(!m.steps.some(([,sql])=>sql==='commit;'));
});

test('runner stays opt-in, serial and namespace-owned with current guarded candidate definitions',()=>{
  const source=readFileSync(new URL('./merchant-attendance-lifecycle-reuse-native.mjs',import.meta.url),'utf8');
  assert.match(source,/runAttendanceLabelsReuse\(process.argv.slice\(2\),check\)/);
  assert.match(source,/for\(const channel of channels\)await withAttendanceConcurrencySandbox/);
  for(const marker of ['checkAttendanceLocationLifecycle','checkAttendancePinLifecycle','checkAttendanceOnsiteLifecycle',
    '202610020111','202610020112','202610020113','productionAccess:false','realAuthService:false'])assert(source.includes(marker));
  assert.doesNotMatch(source,/DATABASE_URL|SUPABASE_|dotenv|process\.env|initdb|pg_ctl|create database|drop database|mkdtemp|writeFile|fetch\(/);
});
