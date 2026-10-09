// Explicitly owned local synthetic cluster only. This is not a release, a real
// authentication deployment, or permission to repair any historical actor ID.
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {runAttendanceLabelsReuse} from './merchant-attendance-choice-labels-reuse-native.mjs';
import {withAttendanceConcurrencySandbox} from './merchant-attendance-concurrency-sandbox.mjs';
import {checkAttendancePinIdentityNative} from './merchant-attendance-pin-identity-native-checks.mjs';
import {checkAttendancePinIdentityServiceNative} from './merchant-attendance-pin-identity-service-checks.mjs';

const guarded=process.argv.includes('--guarded');
async function check(native){
  for(const mode of guarded?['legacy','guarded']:['legacy']){
    await withAttendanceConcurrencySandbox(native,async({sql})=>{
      const exec=source=>native.query(sql(source));
      const migrations=['202610010104_merchant_attendance_terminals.sql',
        '202610010106_merchant_attendance_pin_credentials.sql','202610010107_merchant_attendance_pin_clock.sql',
        '202610020111_merchant_attendance_self_clock_identity.sql'];
      if(mode==='guarded')migrations.push('202610020112_merchant_attendance_pin_clock_identity.sql',
        '202610020112_merchant_attendance_pin_clock_identity.sql');
      for(const name of migrations)exec(readFileSync(path.join(native.root,'scripts/supabase-migrations',name),'utf8'));
      await checkAttendancePinIdentityNative({exec,querySteps:steps=>native.querySteps(steps.map(sql)),pass:native.pass,mode});
      await checkAttendancePinIdentityServiceNative({exec,pass:native.pass,mode});
      console.log(JSON.stringify({pinIdentityNativeComparison:true,mode,realBrowser:false,
        realAuthService:false,productionAccess:false,newCluster:false}));
    });
  }
}
await runAttendanceLabelsReuse(process.argv.slice(2).filter(arg=>arg!=='--guarded'),check).catch(error=>{
  console.error(error?.stack??String(error));process.exitCode=1;
});
