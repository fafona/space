import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
const source=readFileSync(new URL('./merchant-attendance-period-timezone-boundary-native.mjs',import.meta.url),'utf8');
test('timezone diagnostic reuses owned synthetic runtime and restores ephemeral environment secrets',()=>{
  for(const part of ['runAttendanceLabelsReuse(args','withAttendanceConcurrencySandbox(native',
    'preparePlanAdoptionViewNative(native,scope)','seedPlanExceptionHistoryNative({d,native,scope})',
    'delete process.env[key]','process.env[key]=previous[i]'])assert(source.includes(part),part);
  assert.doesNotMatch(source,/initdb|create database|DATABASE_URL|service_role_key|chromium\.launch|--with-browser/i);
});
test('timezone diagnostic installs the existing154 candidate and preserves staged151',()=>{
  assert(source.includes("'202610050154_merchant_attendance_period_missing_root_capacity.sql'"));
  assert(source.includes('native.query(scope.sql(readFileSync('));
  assert.doesNotMatch(source,/boundClockMigrationBody\([^)]*rangesMigration|202610060155|create or replace function|alter table/i);
});
test('timezone diagnostic delegates explicit actual-flow evidence and verifies full restoration',()=>{
  for(const part of ['verifyPeriodTimezoneBoundaryNative({d,native,scope,h})','d.fingerprint(),facts',
    'd.definitions(),definitions','d.tableCatalog(),catalog','process.exitCode=1'])assert(source.includes(part),part);
});
test('timezone diagnostic does not claim implementation or production delivery',()=>{
  for(const part of ['diagnosticOnly:true','businessFunctionsChanged:false','productionAccess:false','newCluster:false',
    'browser:null','deployment:false','migrationCandidate:154'])assert(source.includes(part),part);
  assert.doesNotMatch(source,/update public\.|delete from public\.|grant execute/i);
});
