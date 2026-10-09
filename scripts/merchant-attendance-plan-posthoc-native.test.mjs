// Static architecture assertions, not evidence that the PostgreSQL run passed.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
const source=readFileSync(new URL('./merchant-attendance-plan-posthoc-native.mjs',import.meta.url),'utf8');
test('targeted runner only reuses the explicit original owned sandbox; no full scenario replay or new runtime',()=>{
  for(const s of ['runAttendanceLabelsReuse(args','withAttendanceConcurrencySandbox(native','preparePlanAdoptionViewNative','seedPlanExceptionHistoryNative'])assert(source.includes(s));
  for(const s of ['initdb','CREATE DATABASE','pg_dump','runPlanClearanceNative','--with-browser','npm run build','supabase.co'])assert(!source.includes(s));
});
test('runner preserves prior env values and tests real SQL through strict Node projection and service',()=>{
  assert(source.includes('finally{keys.forEach'));assert(source.includes('delete process.env[k]'));assert(source.includes('projectPlanPosthocResult(call('));assert(source.includes('executePlanPosthoc({query:q(a.operationId)'));
});
test('old functions, old facts, selected hours and original fixed archive are independent invariants',()=>{
  for(const s of ['oldFunctionHash(),functionsBefore','d.fingerprint(oldNames),factsBeforeLedger','artifact.report.totals','archive().artifactText,oldArchive.artifactText','archive().artifactSha256,oldArchive.artifactSha256'])assert(source.includes(s));
});
test('CAS race requires actual PID lock witness and explicit rejection, not a timer assumption',()=>{
  assert(source.includes('lifecycleRace('));assert(source.includes('assert(race.witnessed)'));assert(source.includes('race.right.error'));assert(!source.includes('sleep('));
});
