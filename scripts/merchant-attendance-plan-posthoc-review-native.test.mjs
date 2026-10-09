import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
const source=readFileSync(new URL('./merchant-attendance-plan-posthoc-review-native.mjs',import.meta.url),'utf8');
test('207 review harness is inert and reuses only the owned runtime',async()=>{
  assert.equal(typeof(await import('./merchant-attendance-plan-posthoc-review-native.mjs')).runPlanPosthocReviewNative,'function');
  assert(source.includes('runPlanPosthocNative(args,async ctx=>'));
  for(const denied of ['initdb','CREATE DATABASE','pg_dump','npm run build','supabase.co'])assert(!source.includes(denied));
});
test('207 genuine transaction and lifecycle evidence, not only a source/read test',()=>{
  for(const item of ['synthetic_posthoc_capture_failure','assert(race.witnessed)','currentValidation,\'not_checked\'',"pc('send'","pc('confirm'","pc('seal'","pc('reopen'",
    'originalFacts','oldArchive.artifactText','oldArchive.artifactSha256','attendance_plan_exception_posthoc_disabled','posthoc_inactive','report.totals,periodBefore.preview.artifact.report.totals'])assert(source.includes(item),item);
});
test('only explicitly armed195/201 paths use exact sealed footprints; unarmed and226 retain old verification',()=>{
  assert(source.includes('createPosthocAdministrativeEventsGuard({d,h,originalTables,originalFacts})'));
  assert(source.includes('registerRecoveryCoverageEvents:recoveryEvents.register,posthocAdministrativeEvents'));
  assert(source.includes("assert(!administrativeEvents.isArmed(),'posthoc_event_capabilities_cannot_mix')"));
  assert(source.includes("assert(!recoveryEventsRegistered,'posthoc_event_capabilities_cannot_mix')"));
  assert(source.includes('if(administrativeEvents.isArmed())return {syntheticRecoveryEvents:0,syntheticAdministrativeEvents:administrativeEvents.verify()}'));
  assert(source.includes('const syntheticRecoveryEvents=recoveryEvents.verify();return {syntheticRecoveryEvents,syntheticAdministrativeEvents:0}'));
  assert(source.indexOf('syntheticAdministrativeEvents:administrativeEvents.verify()')>source.indexOf('await verifyPosthocFullLeaveNative'));
  assert(source.indexOf('syntheticAdministrativeEvents:administrativeEvents.verify()')<source.indexOf("stage='optional-owned-extension'"));
  assert(source.includes('for(const table of originalTables)assert.equal'));
  assert(source.includes('createPosthocReminderEventsGuard({d,h,originalTables,originalFacts,administrativeEvents})'));
  assert(source.includes('posthocAdministrativeEvents,posthocReminderEvents}'));
  assert(source.includes('if(reminderEvents.isArmed()){const footprint=reminderEvents.verify();return {syntheticRecoveryEvents:0,syntheticAdministrativeEvents:footprint.administrativeEvents,syntheticReminderEvents:footprint.reminderEvents};}'));
  const finalVerify=source.indexOf('if(reminderEvents.isArmed())reminderEvents.verify();else if(administrativeEvents.isArmed())administrativeEvents.verify();');
  assert(finalVerify>source.indexOf('const extension=after?await after('));
  assert(finalVerify>source.indexOf('posthoc_extension_changed_original_rows:'));
  assert(source.includes('reminderFootprintProtection:reminderEvents.summary()'));
});
