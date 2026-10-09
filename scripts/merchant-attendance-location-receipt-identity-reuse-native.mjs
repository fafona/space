// Before/after local verification only. No production, real accounts or location.
// Reuses an owned stopped local cluster; all seeds live in a disposable namespace.
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {runAttendanceLabelsReuse} from './merchant-attendance-choice-labels-reuse-native.mjs';
import {withAttendanceConcurrencySandbox} from './merchant-attendance-concurrency-sandbox.mjs';
import {checkAttendanceLocationReceiptIdentity} from './merchant-attendance-location-receipt-identity-checks.mjs';
const guarded=process.argv.includes('--guarded');

async function check(native){
  for(const mode of guarded?['legacy','guarded']:['legacy']) await withAttendanceConcurrencySandbox(native,async({sql})=>{
    const exec=source=>native.query(sql(source));
    for(const name of ['202609300071_merchant_attendance_location_precheck.sql',
      '202609300072_merchant_attendance_location_clock.sql','202609300073_merchant_attendance_location_policy_drafts.sql',
      '202609300076_merchant_attendance_location_notices.sql','202609300077_merchant_attendance_location_clock_notice_guard.sql']){
      exec(readFileSync(path.join(native.root,'scripts/supabase-migrations',name),'utf8'));
    }
    if(mode==='guarded'){
      const migration=readFileSync(path.join(native.root,'scripts/supabase-migrations',
        '202610020113_merchant_attendance_location_receipt_identity.sql'),'utf8');
      exec(migration);exec(migration);
    }
    await checkAttendanceLocationReceiptIdentity({exec,pass:native.pass,mode});
    console.log(JSON.stringify({locationReceiptIdentityMode:mode,realBrowser:false,
      realAuthService:false,actualGeolocation:false,productionAccess:false,newCluster:false}));
  });
}
await runAttendanceLabelsReuse(process.argv.slice(2).filter(arg=>arg!=='--guarded'),check).catch(error=>{
  console.error(error?.stack??String(error));process.exitCode=1;
});
