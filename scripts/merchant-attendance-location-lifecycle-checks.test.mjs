import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {checkAttendanceLocationLifecycle} from './merchant-attendance-location-lifecycle-checks.mjs';
const read=name=>readFileSync(new URL(name,import.meta.url),'utf8');
const owned={schema:'attendance_race_0123456789abcdef0123456789abcdef',oid:1234,tableOid:1235,owner:'postgres',
  marker:'faolla-synthetic-concurrency:12345678-1234-1234-1234-123456789abc'};

test('location lifecycle cannot seed an unowned database or occupied synthetic tenant',async()=>{
  for(const occupied of [false,true]){
    const queries=[];
    await assert.rejects(checkAttendanceLocationLifecycle({query:source=>{
      queries.push(source);
      if(source.includes("'schema'"))return JSON.stringify(occupied?owned:{...owned,schema:'public'});
      if(source.includes('count(*)'))return '1';assert.fail('must not write');
    }},{sql:source=>source}),occupied?/location_lifecycle_tenant_exists/:/lifecycle_owned_schema_required/);
    assert.equal(queries.length,occupied?2:1);assert(queries.every(source=>!source.includes('insert into')));
  }
});
test('location lifecycle uses actual clock RPCs for original and closing facts, never fixture event inserts',()=>{
  const source=read('./merchant-attendance-location-lifecycle-checks.mjs');
  assert.match(source,/faolla_attendance_location_clock_v2/);assert.match(source,/faolla_attendance_location_policy_draft_v1/);
  assert.match(source,/faolla_attendance_location_notice_v1/);assert.match(source,/reason:'not_provided',capturedAt:null,accuracyMeters:null,distanceMeters:null/);
  assert.match(source,/safeFinish:true/);assert.match(source,/realGps:false/);
  assert.doesNotMatch(source,/insert into public\.merchant_attendance_(events|location_results|location_clock_notices)/);
  assert.doesNotMatch(source,/DATABASE_URL|SUPABASE_|process\.env|pg_sleep|fetch\(|spawn\(/);
});
test('location lifecycle preserves permission-specific reads, rollback semantics, original facts and exact replay',()=>{
  const source=read('./merchant-attendance-location-lifecycle-checks.mjs');
  for(const evidence of ['assert.equal(witnesses,4)','rollback:true','revocation-first must not append','location_lifecycle_recovery_mutated_facts',
    'f.read().finish,null','assert.equal(f.config(),config)','assert.deepEqual(after[key][0],before[key][0])',
    "assert.equal(replay.replayed,true)","race(service(f.call(f.command)),f.deactivate)"])assert(source.includes(evidence),evidence);
});
