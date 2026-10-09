// Before/after native comparison. Synthetic service RPC commands in an
// ownership-checked namespace are rolled back; this is not a release or UI test.
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {runAttendanceLabelsReuse} from './merchant-attendance-choice-labels-reuse-native.mjs';
import {withAttendanceConcurrencySandbox} from './merchant-attendance-concurrency-sandbox.mjs';
import {checkAttendanceSelfIdentityNative} from './merchant-attendance-self-identity-native-checks.mjs';

async function check(native){
  await withAttendanceConcurrencySandbox(native,async({sql})=>{
    const fixture={
      exec:source=>native.query(sql(source)),
      querySteps:sources=>native.querySteps(sources.map(sql)),
      pass:native.pass,
    };
    for(const mode of ['legacy','guarded']){
      if(mode==='guarded'){
        const migration=readFileSync(path.join(native.root,'scripts/supabase-migrations',
          '202610020111_merchant_attendance_self_clock_identity.sql'),'utf8');
        fixture.exec(migration);fixture.exec(migration);
      }
      const observed=await checkAttendanceSelfIdentityNative({...fixture,mode});
      console.log(JSON.stringify({selfIdentityNativeComparison:true,mode,
        observedCases:observed.observations.length,
        concernCases:observed.observations.filter(item=>item.concern).map(item=>item.case),
        deniedRequests:observed.observations.flatMap(item=>item.requests).filter(item=>item.error==='attendance_access_denied').length,
        syntheticWritesRolledBack:observed.rolledBack,
        realBrowser:false,realAuthService:false,productionAccess:false}));
    }
  });
}

await runAttendanceLabelsReuse(process.argv.slice(2),check).catch(error=>{
  console.error(error?.stack??String(error));process.exitCode=1;
});
