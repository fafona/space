import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
const fixture=readFileSync(new URL('./attendance-missing-delegation-native.mjs',import.meta.url),'utf8');
const security=readFileSync(new URL('./attendance-missing-delegation-security-native.mjs',import.meta.url),'utf8');
const runner=readFileSync(new URL('../merchant-attendance-missing-delegation-native.mjs',import.meta.url),'utf8');
test('189 native reuses the existing guarded lifecycle and never creates production/database copies',()=>{
  assert.match(runner,/runAttendanceLabelsReuse\(args,native=>withAttendanceConcurrencySandbox/);
  assert.match(runner,/preparePlanAdoptionViewNative/);assert.match(runner,/old155ArchivePreserved:true/);
  for(const code of [fixture,security,runner])assert.doesNotMatch(code,/\b(?:initdb|createdb|dropdb|pg_dump|supabase\.co|DATABASE_URL|SUPABASE_SERVICE_ROLE_KEY)\b/);
  assert.match(fixture,/assertLifecycleSandbox/);assert.match(security,/assertLifecycleSandbox/);
});
test('189 migrates concurrent index outside wrapper and protects old function/fact hashes',()=>{
  assert.match(fixture,/native\.query\(scope\.sql\(readFileSync/);assert.match(fixture,/assert\.equal\(oldDefs\(\),originalDefs\)/);
  assert.match(fixture,/assert\.equal\(d\.fingerprint\(prior\),facts\)/);assert.match(fixture,/assert\.equal\(d\.definitions\(\),definitions\)/);
});
test('189 exercises actual receipt fingerprint, period seal, owner/self and exact-PID revoke race',()=>{
  for(const marker of ['executeAttendanceMissing','executePeriodClosures','executeMissingDelegation','handleMissingDelegation','lifecycleRace','race.witnessed','oldEntry.actor','fingerprint(postQuery,decision)'])assert(fixture.includes(marker));
  assert.match(security,/role_removed/);assert.match(security,/employee_disabled/);assert.match(security,/delegate_rebound/);assert.match(security,/target_rebound/);assert.match(security,/owner_changed/);
  assert.match(security,/finally\{assert\.equal\(d\.fingerprint\(\),baseline/);assert.match(security,/set constraints all immediate;rollback/);
});
