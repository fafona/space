// Opt-in local-only lifecycle races. One owned namespace per channel, reused
// stopped cluster, current candidate functions. No production environment load.
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {runAttendanceLabelsReuse} from './merchant-attendance-choice-labels-reuse-native.mjs';
import {withAttendanceConcurrencySandbox} from './merchant-attendance-concurrency-sandbox.mjs';
import {checkAttendanceLocationLifecycle} from './merchant-attendance-location-lifecycle-checks.mjs';
import {checkAttendancePinLifecycle} from './merchant-attendance-pin-lifecycle-checks.mjs';
import {checkAttendanceOnsiteLifecycle} from './merchant-attendance-onsite-lifecycle-checks.mjs';

async function check(native){
  const channels=[
    {name:'location',run:checkAttendanceLocationLifecycle,migrations:[
      '202609300071_merchant_attendance_location_precheck.sql','202609300072_merchant_attendance_location_clock.sql',
      '202609300073_merchant_attendance_location_policy_drafts.sql','202609300076_merchant_attendance_location_notices.sql',
      '202609300077_merchant_attendance_location_clock_notice_guard.sql','202610020111_merchant_attendance_self_clock_identity.sql',
      '202610020113_merchant_attendance_location_receipt_identity.sql']},
    {name:'pin',run:checkAttendancePinLifecycle,migrations:[
      '202610010104_merchant_attendance_terminals.sql','202610010106_merchant_attendance_pin_credentials.sql',
      '202610010107_merchant_attendance_pin_clock.sql','202610020111_merchant_attendance_self_clock_identity.sql',
      '202610020112_merchant_attendance_pin_clock_identity.sql']},
    {name:'onsite',run:checkAttendanceOnsiteLifecycle,migrations:[
      '202610010104_merchant_attendance_terminals.sql','202610010108_merchant_attendance_onsite_qr.sql',
      '202610020111_merchant_attendance_self_clock_identity.sql']},
  ];
  for(const channel of channels)await withAttendanceConcurrencySandbox(native,async(scope)=>{
    for(const name of channel.migrations)
      native.query(scope.sql(readFileSync(path.join(native.root,'scripts/supabase-migrations',name),'utf8')));
    const result=await channel.run(native,scope);
    const {checks,observations,operationIds,...summary}=result;
    console.log(JSON.stringify({channel:channel.name,...summary,checkCount:checks?.length??result.cases,
      observedSubjects:observations?.length??operationIds?.length,productionAccess:false,realAuthService:false}));
  });
}
await runAttendanceLabelsReuse(process.argv.slice(2),check).catch(error=>{console.error(error?.stack??String(error));process.exitCode=1;});
