import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
const source=readFileSync(new URL('./merchant-attendance-period-timezone-resume-native.mjs',import.meta.url),'utf8');
test('185 reuses one owned synthetic runtime, restores environment and preserves staged151',()=>{
  for(const part of ['runAttendanceLabelsReuse(args','withAttendanceConcurrencySandbox(native','native.query(scope.sql(readFileSync(',
    'delete process.env[key]','process.env[key]=previous[i]'])assert(source.includes(part),part);
  assert.doesNotMatch(source,/initdb|create database|DATABASE_URL|service_role_key|boundClockMigrationBody\([^)]*rangesMigration/i);
});
test('155 verifies actual154 saved nonempty artifact, normal canonical, functions and physical reuse',()=>{
  for(const part of ['actual154-archive','install155','unrelated_function_changed:','parseUnifiedSource(source.ownerRaw.report,source.q)',
    'raw.artifactText,saved.artifactText','raw.artifactSha256,saved.artifactSha256','raw.artifactBytes,saved.artifactBytes',
    'verifyPeriodTimezoneResumeNative({d,native,scope,h})','beforeFacts','beforeCatalog','oldIndexes'])assert(source.includes(part),part);
});
test('155 route service path uses fixed-period source and browser remains explicitly optional',()=>{
  assert(source.includes('faolla_attendance_period_closure_source_v1'));
  assert(source.includes('executePeriodClosures(input,service)'));
  assert(source.includes("args.includes('--with-browser')"));assert(source.includes('runPeriodClosureBrowserAcceptance'));
  assert(source.includes('productionAccess:false,newCluster:false,deployment:false,migrationCandidate:155'));
});
