import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {verifyWorkArrangementSecurityNative} from './attendance-work-arrangements-security-native.mjs';
const source=readFileSync(new URL('./attendance-work-arrangements-security-native.mjs',import.meta.url),'utf8');
test('security fixture is inert and refuses non-owned setup before touching runtime',async()=>{
  let called=false;await assert.rejects(verifyWorkArrangementSecurityNative({d:{syntheticOnly:false},native:{query(){called=true;}}}));assert.equal(called,false);
  assert.doesNotMatch(source,/spawn|execFile|pg_ctl|initdb|disable trigger|session_replication_role/i);
});
test('authorization probes retain real service role and each expected error compares all-table hashes',()=>{
  for(const text of ['set local role service_role','security_rejected_rpc_left_writes','security_recovery_wrote','security_rollback_restore',
    'attendance.self.work_arrangement',"permissions=array['enterprise.view']",'attendance_work_arrangement_binding_changed','attendance_operation_conflict','security_private_helper_acl'])assert(source.includes(text),text);
  assert.match(source,/set constraints all immediate;rollback/);
});
test('race witnesses exact PIDs through existing helper and discloses only its own real committed history',()=>{
  assert.match(source,/await lifecycleRace/);assert.match(source,/race\.witnessed,true/);assert.match(source,/attendance_work_arrangement_closed/);
  assert.match(source,/requests:1,entries:2,loser:0/);assert.match(source,/race_changed_other_facts/);assert.match(source,/sealCompetition:false/);
});
test('all-table hash uses a dedicated row alias disjoint from PLpgSQL receipt variables',()=>{
  assert.match(source,/to_jsonb\(work_arrangement_security_row\)/);
  assert.doesNotMatch(source,/to_jsonb\(r\)/);
  assert.doesNotMatch(source,/declare[^;]*work_arrangement_security_row/);
  assert.match(source,/declare before_hash text;r jsonb/);
});
