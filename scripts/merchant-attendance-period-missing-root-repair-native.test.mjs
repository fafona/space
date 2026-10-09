import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
const source=readFileSync(new URL('./merchant-attendance-period-missing-root-repair-native.mjs',import.meta.url),'utf8');
test('repair acceptance reuses the guarded owned fixture and restores ephemeral secrets',()=>{
  for(const part of ['runAttendanceLabelsReuse(args','withAttendanceConcurrencySandbox(native',
    'preparePlanAdoptionViewNative(native,scope)','seedPlanExceptionHistoryNative({d,native,scope})',
    'delete process.env[key]','process.env[key]=previous[i]'])assert(source.includes(part),part);
  assert.doesNotMatch(source,/initdb|create database|DATABASE_URL|service_role_key|chromium\.launch|--with-browser/i);
});
test('repair acceptance preserves staged151 and archives actual153 before applying154',()=>{
  assert(source.includes('native.query(scope.sql(readFileSync('));
  assert.doesNotMatch(source,/boundClockMigrationBody\([^)]*rangesMigration/);
  const old=source.indexOf("phase='source153'"),archive=source.indexOf("phase='archive-install154'"),install=source.indexOf("phase='install154'");
  assert(old>0&&archive>old&&install>archive);
  assert(source.includes('verifyPeriodMissingRootRepairInstallNative({d,native,scope,h,source})'));
});
test('repair acceptance compares unrelated definitions and verifies full per-probe restoration',()=>{
  for(const part of ["p.proname<>'faolla_attendance_period_source_v1'",'coalesce(p.proacl::text',
    'd.fingerprint(),facts','d.definitions(),definitions','d.tableCatalog(),catalog',
    'd.exec(unrelatedFunctionsSql),unrelatedFunctions'])assert(source.includes(part),part);
});
test('repair acceptance cannot claim production, browser testing or deployment',()=>{
  for(const part of ['productionAccess:false','newCluster:false','browser:null','deployment:false','migrationCandidate:154',
    'process.exitCode=1','verifyPeriodMissingRootRepairNative({d,native,scope,h})'])assert(source.includes(part),part);
});
test('request and archive-export setup remains scoped to the owned synthetic historical employee role',()=>{
  assert(source.includes("permissions||array['attendance.self.request','attendance.self.export']"));
  assert(source.includes('where merchant_id=${quote(d.site)} and id=(select role_id from public.merchant_enterprise_employees where merchant_id=${quote(d.site)} and id=${quote(h.employeeId)})'));
  assert(source.indexOf('d.exec(`update public.merchant_enterprise_roles')<source.indexOf("phase='source153'"));
});
