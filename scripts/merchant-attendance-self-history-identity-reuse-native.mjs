// Explicitly named, already-owned synthetic cluster only. The new reader is
// checked in a disposable namespace; no production, new cluster or data backfill.
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {runAttendanceLabelsReuse} from './merchant-attendance-choice-labels-reuse-native.mjs';
import {withAttendanceConcurrencySandbox} from './merchant-attendance-concurrency-sandbox.mjs';
import {checkAttendanceSelfHistoryIdentityNative} from './merchant-attendance-self-history-identity-native-checks.mjs';

async function check(native){
  await withAttendanceConcurrencySandbox(native,async({sql})=>{
    const exec=source=>native.query(sql(source));
    const querySteps=sources=>native.querySteps(sources.map(sql));
    for(const name of ['202609300068_merchant_attendance_self_history.sql',
      '202610020110_merchant_attendance_self_history_identity.sql',
      '202610020110_merchant_attendance_self_history_identity.sql']){
      exec(readFileSync(path.join(native.root,'scripts/supabase-migrations',name),'utf8'));
    }
    await checkAttendanceSelfHistoryIdentityNative({exec,querySteps,pass:native.pass});
  });
}

await runAttendanceLabelsReuse(process.argv.slice(2),check).catch(error=>{
  console.error(error?.stack??String(error));process.exitCode=1;
});
