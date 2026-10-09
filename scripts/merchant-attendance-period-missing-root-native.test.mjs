import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
const source=readFileSync(new URL('./merchant-attendance-period-missing-root-native.mjs',import.meta.url),'utf8');
test('root diagnosis reuses the guarded owned fixture and restores ephemeral secrets',()=>{
  for(const part of ['runAttendanceLabelsReuse(args','withAttendanceConcurrencySandbox(native',
    'preparePlanAdoptionViewNative(native,scope)','seedPlanExceptionHistoryNative({d,native,scope})',
    'verifyPeriodMissingRootCapacityNative({d,native,scope,h})','delete process.env[key]','process.env[key]=previous[i]'])assert(source.includes(part),part);
  assert.doesNotMatch(source,/initdb|create database|DATABASE_URL|service_role_key|chromium\.launch|browserCheck|--with-browser/i);
});
test('diagnosis installs the existing153 candidate and preserves staged151 installation',()=>{
  assert(source.includes("'202610050153_merchant_attendance_period_session_capacity.sql'"));
  assert(source.includes('native.query(scope.sql(readFileSync('));
  assert(source.includes("phase='install151';d.exec('select 1;')"));
  assert.doesNotMatch(source,/boundClockMigrationBody\([^)]*rangesMigration|202610050154|create or replace function|alter table/i);
});
test('diagnosis has independent full restoration checks and cannot report a fix',()=>{
  for(const part of ['d.fingerprint(),facts','d.definitions(),definitions','d.tableCatalog(),catalog',
    'diagnosticOnly:true','businessReadersChanged:false','productionAccess:false','newCluster:false','browser:null','process.exitCode=1'])assert(source.includes(part),part);
});
test('only the owned historical fixture employee role receives request permission before baseline',()=>{
  assert(source.includes("permissions||array['attendance.self.request']"));
  assert(source.includes('where merchant_id=${quote(d.site)} and id=(select role_id from public.merchant_enterprise_employees where merchant_id=${quote(d.site)} and id=${quote(h.employeeId)})'));
  const setup=source.indexOf('d.exec(`update public.merchant_enterprise_roles'),baseline=source.indexOf('const facts=d.fingerprint()');
  assert(setup>0&&baseline>setup);
});
